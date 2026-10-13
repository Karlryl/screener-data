#!/usr/bin/env python3
"""Quantify archived Nasdaq identity transitions without resolving identity or outcomes."""

from __future__ import annotations

import argparse
from bisect import bisect_left, bisect_right
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
from typing import Any, Iterable


SCHEMA = "early-detection-identity-transition-dossiers/v2"
DIRECT = "PIT_DIRECT_UNIQUE_CANDIDATE_NOT_IDENTITY"
RETROSPECTIVE = "RETROSPECTIVE_UNIQUE_CANDIDATE_NOT_PIT_IDENTITY"
NO_MATCH = "NO_SEC_TICKER_MATCH"


class DossierError(RuntimeError):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")


def canonical_sha256(value: Any) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_signed(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(value, dict):
        raise DossierError(f"not a JSON object: {path}")
    unsigned = {key: item for key, item in value.items() if key != "reportSha256"}
    if canonical_sha256(unsigned) != value.get("reportSha256"):
        raise DossierError(f"signature mismatch: {path}")
    return value


def binding(path: Path, value: dict[str, Any]) -> dict[str, Any]:
    return {
        "path": str(path.resolve()),
        "fileSha256": file_sha256(path.resolve()),
        "reportSha256": value["reportSha256"],
    }


def validate_bound_report(bound: dict[str, Any]) -> tuple[Path, dict[str, Any]]:
    path = Path(str(bound["path"])).resolve()
    value = read_signed(path)
    if file_sha256(path) != bound["fileSha256"] or value["reportSha256"] != bound["reportSha256"]:
        raise DossierError(f"bound report changed: {path}")
    return path, value


def readonly(path: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{path.resolve().as_posix()}?mode=ro", uri=True)


def timestamp_day(value: str) -> datetime:
    return datetime.strptime(value[:8], "%Y%m%d").replace(tzinfo=timezone.utc)


def filed_day(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=timezone.utc)


def gap_days(first: datetime, second: datetime) -> int:
    return int((second - first).total_seconds() // 86400)


def is_non_test(value: Any) -> bool:
    return str(value or "").strip().upper() not in {"Y", "YES", "1", "TRUE"}


def normalized_name(value: str) -> str:
    return " ".join(value.upper().split())


def table_sequence(connection: sqlite3.Connection, table: str, order: str) -> tuple[int, str]:
    digest = hashlib.sha256()
    rows = 0
    for row in connection.execute(f'SELECT * FROM "{table}" ORDER BY {order}'):
        digest.update(json.dumps(row, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n")
        rows += 1
    return rows, digest.hexdigest()


def create_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        PRAGMA journal_mode=DELETE;
        PRAGMA foreign_keys=ON;
        CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE snapshot_deltas(
          directory_kind TEXT NOT NULL,previous_snapshot_id INTEGER NOT NULL,current_snapshot_id INTEGER NOT NULL,
          previous_timestamp TEXT NOT NULL,current_timestamp TEXT NOT NULL,gap_days INTEGER NOT NULL,
          previous_symbols INTEGER NOT NULL,current_symbols INTEGER NOT NULL,appeared INTEGER NOT NULL,
          disappeared INTEGER NOT NULL,name_changed INTEGER NOT NULL,
          PRIMARY KEY(directory_kind,previous_snapshot_id,current_snapshot_id)
        );
        CREATE TABLE observed_transitions(
          transition_id INTEGER PRIMARY KEY,directory_kind TEXT NOT NULL,transition_type TEXT NOT NULL,
          previous_snapshot_id INTEGER NOT NULL,current_snapshot_id INTEGER NOT NULL,
          previous_timestamp TEXT NOT NULL,current_timestamp TEXT NOT NULL,gap_days INTEGER NOT NULL,
          symbol TEXT NOT NULL,before_name TEXT,after_name TEXT,before_candidate_status TEXT,
          after_candidate_status TEXT,before_candidate_ciks_json TEXT NOT NULL,
          after_candidate_ciks_json TEXT NOT NULL,not_effective_event INTEGER NOT NULL CHECK(not_effective_event=1)
        );
        CREATE TABLE symbol_profiles(
          directory_kind TEXT NOT NULL,symbol TEXT NOT NULL,first_timestamp TEXT NOT NULL,last_timestamp TEXT NOT NULL,
          observation_rows INTEGER NOT NULL,distinct_names INTEGER NOT NULL,direct_candidate_rows INTEGER NOT NULL,
          direct_candidate_ciks_json TEXT NOT NULL,direct_candidate_cik_count INTEGER NOT NULL,
          retrospective_rows INTEGER NOT NULL,no_match_rows INTEGER NOT NULL,appearance_rows INTEGER NOT NULL,
          disappearance_rows INTEGER NOT NULL,name_change_rows INTEGER NOT NULL,profile_status TEXT NOT NULL,
          identity_resolved INTEGER NOT NULL CHECK(identity_resolved=0),PRIMARY KEY(directory_kind,symbol)
        );
        CREATE TABLE cik_symbol_profiles(
          cik INTEGER PRIMARY KEY,first_timestamp TEXT NOT NULL,last_timestamp TEXT NOT NULL,
          observation_rows INTEGER NOT NULL,symbols_json TEXT NOT NULL,symbol_count INTEGER NOT NULL,
          names_json TEXT NOT NULL,name_count INTEGER NOT NULL,profile_status TEXT NOT NULL,
          identity_resolved INTEGER NOT NULL CHECK(identity_resolved=0)
        );
        CREATE TABLE corporate_event_candidate_links(
          event_id INTEGER PRIMARY KEY,event_class TEXT NOT NULL,form TEXT NOT NULL,filed_date TEXT NOT NULL,
          accession TEXT NOT NULL,issuer_cik INTEGER NOT NULL,issuer_name TEXT NOT NULL,
          security_titles_json TEXT NOT NULL,previous_capture_timestamp TEXT,previous_gap_days INTEGER,
          previous_symbols_json TEXT NOT NULL,next_capture_timestamp TEXT,next_gap_days INTEGER,
          next_symbols_json TEXT NOT NULL,link_status TEXT NOT NULL,
          identity_resolved INTEGER NOT NULL CHECK(identity_resolved=0)
        );
        """
    )


def load_states(
    archive_db: Path, crosswalk_db: Path
) -> tuple[
    dict[str, list[tuple[int, str]]],
    dict[int, dict[str, dict[str, Any]]],
    dict[tuple[str, str], dict[str, Any]],
    dict[int, dict[str, Any]],
    dict[int, dict[str, set[str]]],
]:
    archive = readonly(archive_db)
    crosswalk = readonly(crosswalk_db)
    if archive.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise DossierError("archive database integrity failed")
    if crosswalk.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise DossierError("crosswalk database integrity failed")
    candidates = {
        (int(snapshot_id), int(source_row)): (str(status), json.loads(ciks_json))
        for snapshot_id, source_row, status, ciks_json in crosswalk.execute(
            "SELECT snapshot_id,source_row,candidate_status,candidate_ciks_json FROM crosswalk"
        )
    }
    snapshots: dict[str, list[tuple[int, str]]] = defaultdict(list)
    states: dict[int, dict[str, dict[str, Any]]] = defaultdict(dict)
    symbol_profiles: dict[tuple[str, str], dict[str, Any]] = {}
    cik_profiles: dict[int, dict[str, Any]] = {}
    cik_states: dict[int, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    snapshot_meta = {
        int(snapshot_id): (str(kind), str(capture_timestamp))
        for snapshot_id, kind, capture_timestamp in archive.execute(
            "SELECT snapshot_id,kind,capture_timestamp FROM snapshots ORDER BY kind,capture_timestamp,snapshot_id"
        )
    }
    for snapshot_id, (kind, timestamp) in snapshot_meta.items():
        snapshots[kind].append((snapshot_id, timestamp))
    for snapshot_id, source_row, symbol, security_name, test_issue in archive.execute(
        "SELECT snapshot_id,source_row,symbol,security_name,test_issue FROM observations ORDER BY snapshot_id,source_row"
    ):
        if not is_non_test(test_issue):
            continue
        snapshot_id = int(snapshot_id)
        source_row = int(source_row)
        kind, timestamp = snapshot_meta[snapshot_id]
        symbol = str(symbol).strip().upper()
        if not symbol:
            raise DossierError(f"blank non-test symbol: {snapshot_id}/{source_row}")
        if symbol in states[snapshot_id]:
            raise DossierError(f"duplicate non-test symbol in snapshot: {snapshot_id}/{symbol}")
        status, ciks = candidates[(snapshot_id, source_row)]
        row = {
            "name": str(security_name),
            "status": status,
            "ciks": [int(item) for item in ciks],
            "timestamp": timestamp,
            "kind": kind,
        }
        states[snapshot_id][symbol] = row
        profile = symbol_profiles.setdefault(
            (kind, symbol),
            {
                "timestamps": [], "names": set(), "direct_rows": 0, "direct_ciks": set(),
                "retrospective": 0, "no_match": 0, "appeared": 0, "disappeared": 0,
                "name_changed": 0,
            },
        )
        profile["timestamps"].append(timestamp)
        profile["names"].add(str(security_name))
        if status == DIRECT:
            if len(ciks) != 1:
                raise DossierError("direct unique candidate does not contain exactly one CIK")
            cik = int(ciks[0])
            profile["direct_rows"] += 1
            profile["direct_ciks"].add(cik)
            cik_profile = cik_profiles.setdefault(
                cik, {"timestamps": [], "symbols": set(), "names": set(), "rows": 0}
            )
            cik_profile["timestamps"].append(timestamp)
            cik_profile["symbols"].add(symbol)
            cik_profile["names"].add(str(security_name))
            cik_profile["rows"] += 1
            cik_states[cik][timestamp].add(symbol)
        elif status == RETROSPECTIVE:
            profile["retrospective"] += 1
        elif status == NO_MATCH:
            profile["no_match"] += 1
    archive.close()
    crosswalk.close()
    return snapshots, states, symbol_profiles, cik_profiles, cik_states


def write_transitions(
    connection: sqlite3.Connection,
    snapshots: dict[str, list[tuple[int, str]]],
    states: dict[int, dict[str, dict[str, Any]]],
    profiles: dict[tuple[str, str], dict[str, Any]],
) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)
    transition_id = 0
    for kind in sorted(snapshots):
        sequence = snapshots[kind]
        for (previous_id, previous_at), (current_id, current_at) in zip(sequence, sequence[1:], strict=False):
            before = states[previous_id]
            after = states[current_id]
            appeared = sorted(set(after) - set(before))
            disappeared = sorted(set(before) - set(after))
            changed = sorted(
                symbol for symbol in set(before) & set(after)
                if normalized_name(before[symbol]["name"]) != normalized_name(after[symbol]["name"])
            )
            gap = gap_days(timestamp_day(previous_at), timestamp_day(current_at))
            connection.execute(
                "INSERT INTO snapshot_deltas VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (kind, previous_id, current_id, previous_at, current_at, gap, len(before), len(after),
                 len(appeared), len(disappeared), len(changed)),
            )
            for transition_type, symbols in (
                ("OBSERVED_APPEARANCE", appeared),
                ("OBSERVED_DISAPPEARANCE", disappeared),
                ("OBSERVED_NAME_CHANGE", changed),
            ):
                for symbol in symbols:
                    transition_id += 1
                    old = before.get(symbol)
                    new = after.get(symbol)
                    connection.execute(
                        "INSERT INTO observed_transitions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)",
                        (
                            transition_id, kind, transition_type, previous_id, current_id,
                            previous_at, current_at, gap, symbol,
                            old["name"] if old else None, new["name"] if new else None,
                            old["status"] if old else None, new["status"] if new else None,
                            json.dumps(old["ciks"] if old else [], separators=(",", ":")),
                            json.dumps(new["ciks"] if new else [], separators=(",", ":")),
                        ),
                    )
                    key = (kind, symbol)
                    if transition_type == "OBSERVED_APPEARANCE":
                        profiles[key]["appeared"] += 1
                    elif transition_type == "OBSERVED_DISAPPEARANCE":
                        profiles[key]["disappeared"] += 1
                    else:
                        profiles[key]["name_changed"] += 1
                    counts[transition_type] += 1
            counts["SNAPSHOT_PAIRS"] += 1
    return dict(sorted(counts.items()))


def write_profiles(
    connection: sqlite3.Connection,
    symbol_profiles: dict[tuple[str, str], dict[str, Any]],
    cik_profiles: dict[int, dict[str, Any]],
) -> tuple[dict[str, int], dict[str, int]]:
    symbol_counts: dict[str, int] = defaultdict(int)
    for (kind, symbol), profile in sorted(symbol_profiles.items()):
        direct_ciks = sorted(profile["direct_ciks"])
        if len(direct_ciks) > 1:
            status = "MULTIPLE_PIT_DIRECT_CIKS_CONFLICT_NOT_RESOLVED"
        elif len(direct_ciks) == 1:
            status = "ONE_PIT_DIRECT_CIK_CANDIDATE_NOT_IDENTITY"
        else:
            status = "NO_PIT_DIRECT_CIK_CANDIDATE"
        timestamps = sorted(profile["timestamps"])
        connection.execute(
            "INSERT INTO symbol_profiles VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)",
            (
                kind, symbol, timestamps[0], timestamps[-1], len(timestamps), len(profile["names"]),
                profile["direct_rows"], json.dumps(direct_ciks, separators=(",", ":")), len(direct_ciks),
                profile["retrospective"], profile["no_match"], profile["appeared"],
                profile["disappeared"], profile["name_changed"], status,
            ),
        )
        symbol_counts[status] += 1
    cik_counts: dict[str, int] = defaultdict(int)
    for cik, profile in sorted(cik_profiles.items()):
        symbols = sorted(profile["symbols"])
        names = sorted(profile["names"])
        status = (
            "MULTIPLE_SYMBOLS_FOR_CIK_CANDIDATE_NOT_TICKER_CHANGE"
            if len(symbols) > 1 else "ONE_SYMBOL_FOR_CIK_CANDIDATE_NOT_IDENTITY"
        )
        timestamps = sorted(profile["timestamps"])
        connection.execute(
            "INSERT INTO cik_symbol_profiles VALUES(?,?,?,?,?,?,?,?,?,0)",
            (cik, timestamps[0], timestamps[-1], profile["rows"],
             json.dumps(symbols, ensure_ascii=False, separators=(",", ":")), len(symbols),
             json.dumps(names, ensure_ascii=False, separators=(",", ":")), len(names), status),
        )
        cik_counts[status] += 1
    return dict(sorted(symbol_counts.items())), dict(sorted(cik_counts.items()))


def corporate_events(corporate_gate: dict[str, Any]) -> tuple[list[tuple[Any, ...]], list[dict[str, Any]]]:
    rows: list[tuple[Any, ...]] = []
    inputs: list[dict[str, Any]] = []
    for range_entry in corporate_gate["ranges"]:
        parse_path, parse_report = validate_bound_report(range_entry["artifacts"]["parseReport"])
        verify_path, parse_verify = validate_bound_report(range_entry["artifacts"]["parseVerification"])
        if parse_verify.get("status") != "PASS":
            raise DossierError(f"corporate parse verification not PASS: {verify_path}")
        database = Path(str(parse_report["database"])).resolve()
        if file_sha256(database) != parse_report["databaseSha256"]:
            raise DossierError(f"corporate parse database changed: {database}")
        connection = readonly(database)
        if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise DossierError(f"corporate parse database integrity failed: {database}")
        event_rows = connection.execute(
            """
            SELECT DISTINCT e.event_id,e.event_class,e.form,e.filed_date,e.accession,
                   COALESCE(e.issuer_cik,e.cik),COALESCE(e.issuer_name,e.company_name)
            FROM events e JOIN securities s ON s.event_id=e.event_id
            WHERE s.security_class='COMMON_EQUITY'
            ORDER BY e.event_id
            """
        ).fetchall()
        titles_by_event: dict[int, set[str]] = defaultdict(set)
        for event_id, title in connection.execute(
            "SELECT event_id,title FROM securities WHERE security_class='COMMON_EQUITY' ORDER BY event_id,ordinal"
        ):
            titles_by_event[int(event_id)].add(str(title))
        for row in event_rows:
            rows.append(tuple(row) + (sorted(titles_by_event[int(row[0])]),))
        connection.close()
        inputs.append(
            {
                "parseReport": binding(parse_path, parse_report),
                "parseVerification": binding(verify_path, parse_verify),
                "database": {
                    "path": str(database),
                    "fileSha256": parse_report["databaseSha256"],
                    "bytes": parse_report["databaseBytes"],
                },
            }
        )
    if len(rows) != int(corporate_gate["coverage"]["commonEquityEvents"]):
        raise DossierError("common-equity corporate event count differs from gate")
    return rows, inputs


def write_corporate_links(
    connection: sqlite3.Connection,
    events: Iterable[tuple[Any, ...]],
    cik_states: dict[int, dict[str, set[str]]],
) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)
    for event_id, event_class, form, filed_date, accession, issuer_cik, issuer_name, titles in events:
        issuer_cik = int(issuer_cik)
        event_date = filed_day(str(filed_date))
        states = cik_states.get(issuer_cik, {})
        timestamps = sorted(states)
        days = [timestamp_day(value) for value in timestamps]
        before_index = bisect_right(days, event_date) - 1
        after_index = bisect_left(days, event_date)
        previous_at = timestamps[before_index] if before_index >= 0 else None
        next_at = timestamps[after_index] if after_index < len(timestamps) else None
        previous_symbols = sorted(states[previous_at]) if previous_at else []
        next_symbols = sorted(states[next_at]) if next_at else []
        if previous_at and next_at:
            status = (
                "BOTH_SIDES_SAME_SYMBOL_SET_CANDIDATE_NOT_IDENTITY"
                if previous_symbols == next_symbols
                else "BOTH_SIDES_SYMBOL_SET_CHANGED_CANDIDATE_NOT_SUCCESSOR_PROOF"
            )
        elif previous_at:
            status = "PRE_EVENT_ONLY_DIRECTORY_CANDIDATE"
        elif next_at:
            status = "POST_EVENT_ONLY_DIRECTORY_CANDIDATE"
        else:
            status = "NO_PIT_DIRECT_DIRECTORY_CANDIDATE"
        connection.execute(
            "INSERT INTO corporate_event_candidate_links VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)",
            (
                int(event_id), str(event_class), str(form), str(filed_date), str(accession),
                issuer_cik, str(issuer_name), json.dumps(titles, ensure_ascii=False, separators=(",", ":")),
                previous_at, gap_days(timestamp_day(previous_at), event_date) if previous_at else None,
                json.dumps(previous_symbols, separators=(",", ":")), next_at,
                gap_days(event_date, timestamp_day(next_at)) if next_at else None,
                json.dumps(next_symbols, separators=(",", ":")), status,
            ),
        )
        counts[status] += 1
    return dict(sorted(counts.items()))


def build(args: argparse.Namespace) -> dict[str, Any]:
    producer = Path(__file__).resolve()
    paths = {
        "archiveReport": args.archive_report.expanduser().resolve(),
        "archiveVerification": args.archive_verification.expanduser().resolve(),
        "crosswalkReport": args.crosswalk_report.expanduser().resolve(),
        "crosswalkVerification": args.crosswalk_verification.expanduser().resolve(),
        "corporateGate": args.corporate_gate.expanduser().resolve(),
        "corporateVerification": args.corporate_verification.expanduser().resolve(),
    }
    reports = {name: read_signed(path) for name, path in paths.items()}
    if reports["archiveVerification"].get("status") != "PASS":
        raise DossierError("archive verification not PASS")
    if reports["crosswalkVerification"].get("status") != "PASS":
        raise DossierError("crosswalk verification not PASS")
    if reports["corporateVerification"].get("status") != "PASS":
        raise DossierError("corporate verification not PASS")
    if reports["crosswalkReport"].get("identityResolvedRows") != 0:
        raise DossierError("upstream crosswalk resolved identity")
    if any(report.get("outcomesAccessed") is not False for report in reports.values()):
        raise DossierError("upstream outcome-access boundary changed")
    archive_db = Path(str(reports["archiveReport"]["database"])).resolve()
    crosswalk_db = Path(str(reports["crosswalkReport"]["database"])).resolve()
    if file_sha256(archive_db) != reports["archiveReport"]["databaseSha256"]:
        raise DossierError("archive database binding mismatch")
    if file_sha256(crosswalk_db) != reports["crosswalkReport"]["databaseSha256"]:
        raise DossierError("crosswalk database binding mismatch")
    output_db = args.output_database.expanduser().resolve()
    output_report = args.output_report.expanduser().resolve()
    if output_db.exists() or output_report.exists():
        raise DossierError("refusing to overwrite immutable output")
    output_db.parent.mkdir(parents=True, exist_ok=True)
    snapshots, states, symbol_profiles, cik_profiles, cik_states = load_states(archive_db, crosswalk_db)
    events, corporate_inputs = corporate_events(reports["corporateGate"])
    connection = sqlite3.connect(output_db)
    try:
        create_schema(connection)
        transition_counts = write_transitions(connection, snapshots, states, symbol_profiles)
        symbol_counts, cik_counts = write_profiles(connection, symbol_profiles, cik_profiles)
        corporate_counts = write_corporate_links(connection, events, cik_states)
        meta = {
            "schema": SCHEMA,
            "producerScriptSha256": file_sha256(producer),
            "archiveReportSha256": reports["archiveReport"]["reportSha256"],
            "crosswalkReportSha256": reports["crosswalkReport"]["reportSha256"],
            "corporateGateReportSha256": reports["corporateGate"]["reportSha256"],
            "identityResolvedRows": "0",
            "outcomesAccessed": "false",
        }
        connection.executemany("INSERT INTO meta VALUES(?,?)", sorted(meta.items()))
        connection.commit()
        if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise DossierError("output database integrity failed")
        sequences = {}
        for table, order in (
            ("snapshot_deltas", "directory_kind,previous_snapshot_id,current_snapshot_id"),
            ("observed_transitions", "transition_id"),
            ("symbol_profiles", "directory_kind,symbol"),
            ("cik_symbol_profiles", "cik"),
            ("corporate_event_candidate_links", "event_id"),
        ):
            rows, sha = table_sequence(connection, table, order)
            sequences[table] = {"rows": rows, "sequenceSha256": sha}
    finally:
        connection.close()
    unsigned: dict[str, Any] = {
        "schema": SCHEMA,
        "generatedAt": utc_now(),
        "status": "PASS_OUTCOME_BLIND_IDENTITY_TRANSITIONS_QUANTIFIED_GATES_REMAIN_RED",
        "gates": ["entityListingLedger", "historicalUniverse", "corporateActionsDelistings"],
        "producerScript": str(producer),
        "producerScriptSha256": file_sha256(producer),
        "database": str(output_db),
        "databaseBytes": output_db.stat().st_size,
        "databaseSha256": file_sha256(output_db),
        "counts": {
            "archiveSnapshots": sum(len(value) for value in snapshots.values()),
            "nonTestPositiveObservationRows": sum(len(value) for value in states.values()),
            "snapshotPairs": transition_counts.get("SNAPSHOT_PAIRS", 0),
            "observedAppearances": transition_counts.get("OBSERVED_APPEARANCE", 0),
            "observedDisappearances": transition_counts.get("OBSERVED_DISAPPEARANCE", 0),
            "observedNameChanges": transition_counts.get("OBSERVED_NAME_CHANGE", 0),
            "symbolProfiles": len(symbol_profiles),
            "cikProfiles": len(cik_profiles),
            "commonEquityCorporateEvents": len(events),
        },
        "symbolProfileStatusCounts": symbol_counts,
        "cikProfileStatusCounts": cik_counts,
        "corporateEventLinkStatusCounts": corporate_counts,
        "tableSequences": sequences,
        "interpretation": (
            "Every appearance, disappearance, name change, multi-CIK symbol and multi-symbol CIK is now "
            "quantified between observed archive states. SEC Form 25/15 common-equity events are linked only "
            "to preceding/following point-in-time CIK candidates. No row proves an effective listing interval, "
            "ticker succession, permanent identity, terminal session or delisting return."
        ),
        "limitations": [
            "Archive absence is unknown between sparse snapshots; observed transitions are not listing events.",
            "An SEC ticker-to-CIK match is a candidate and cannot adjudicate ticker reuse or share classes.",
            "A common-equity Form 25/15 event does not identify a terminal market session or successor security.",
            "No prices, returns, volumes or outcome labels are stored or accessed.",
        ],
        "inputs": {
            **{name: binding(paths[name], reports[name]) for name in paths},
            "archiveDatabase": {"path": str(archive_db), "fileSha256": reports["archiveReport"]["databaseSha256"]},
            "crosswalkDatabase": {"path": str(crosswalk_db), "fileSha256": reports["crosswalkReport"]["databaseSha256"]},
            "corporateRanges": corporate_inputs,
        },
        "identityResolvedRows": 0,
        "confirmatoryEligible": False,
        "resultComputationAllowed": False,
        "outcomesAccessed": False,
        "productiveGqsModified": False,
    }
    return {**unsigned, "reportSha256": canonical_sha256(unsigned)}


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    value.add_argument("--archive-report", type=Path, required=True)
    value.add_argument("--archive-verification", type=Path, required=True)
    value.add_argument("--crosswalk-report", type=Path, required=True)
    value.add_argument("--crosswalk-verification", type=Path, required=True)
    value.add_argument("--corporate-gate", type=Path, required=True)
    value.add_argument("--corporate-verification", type=Path, required=True)
    value.add_argument("--output-database", type=Path, required=True)
    value.add_argument("--output-report", type=Path, required=True)
    return value


def main() -> int:
    args = parser().parse_args()
    result = build(args)
    output = args.output_report.expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "status": result["status"], "counts": result["counts"],
        "symbolProfileStatusCounts": result["symbolProfileStatusCounts"],
        "cikProfileStatusCounts": result["cikProfileStatusCounts"],
        "corporateEventLinkStatusCounts": result["corporateEventLinkStatusCounts"],
        "reportSha256": result["reportSha256"],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
