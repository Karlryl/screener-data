#!/usr/bin/env python3
"""Independently recompute every row in the outcome-blind identity dossier ledger."""

from __future__ import annotations

import argparse
from bisect import bisect_left, bisect_right
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
from typing import Any, Iterator


SOURCE_SCHEMA = "early-detection-identity-transition-dossiers/v2"
VERIFY_SCHEMA = "early-detection-identity-transition-dossiers-verification/v2"
DIRECT = "PIT_DIRECT_UNIQUE_CANDIDATE_NOT_IDENTITY"
RETROSPECTIVE = "RETROSPECTIVE_UNIQUE_CANDIDATE_NOT_PIT_IDENTITY"
NO_MATCH = "NO_SEC_TICKER_MATCH"


class VerificationError(RuntimeError):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def canonical_sha256(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_signed(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(value, dict):
        raise VerificationError(f"not a JSON object: {path}")
    unsigned = {key: item for key, item in value.items() if key != "reportSha256"}
    if canonical_sha256(unsigned) != value.get("reportSha256"):
        raise VerificationError(f"signature mismatch: {path}")
    return value


def check_binding(value: dict[str, Any]) -> tuple[Path, dict[str, Any]]:
    path = Path(str(value["path"])).resolve()
    report = read_signed(path)
    if file_sha256(path) != value["fileSha256"] or report["reportSha256"] != value["reportSha256"]:
        raise VerificationError(f"input binding mismatch: {path}")
    return path, report


def readonly(path: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{path.resolve().as_posix()}?mode=ro", uri=True)


def day_from_capture(value: str) -> datetime:
    return datetime.strptime(value[:8], "%Y%m%d").replace(tzinfo=timezone.utc)


def day_from_filing(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=timezone.utc)


def days_between(first: datetime, second: datetime) -> int:
    return int((second - first).total_seconds() // 86400)


def eligible(test_issue: Any) -> bool:
    return str(test_issue or "").strip().upper() not in {"Y", "YES", "1", "TRUE"}


def name_key(value: str) -> str:
    return " ".join(value.upper().split())


def compare_rows(
    connection: sqlite3.Connection, table: str, order: str, expected: Iterator[tuple[Any, ...]]
) -> tuple[int, str]:
    saved = connection.execute(f'SELECT * FROM "{table}" ORDER BY {order}')
    digest = hashlib.sha256()
    rows = 0
    for rows, expected_row in enumerate(expected, start=1):
        actual = saved.fetchone()
        if actual is None:
            raise VerificationError(f"{table} ended early at row {rows}")
        if tuple(actual) != tuple(expected_row):
            raise VerificationError(f"{table} row mismatch at row {rows}")
        digest.update(
            json.dumps(tuple(expected_row), ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n"
        )
    if saved.fetchone() is not None:
        raise VerificationError(f"{table} contains extra rows")
    return rows, digest.hexdigest()


def load_source_states(
    archive_db: Path, crosswalk_db: Path
) -> tuple[
    dict[str, list[tuple[int, str]]], dict[int, dict[str, dict[str, Any]]],
    dict[tuple[str, str], dict[str, Any]], dict[int, dict[str, Any]],
    dict[int, dict[str, set[str]]],
]:
    archive = readonly(archive_db)
    crosswalk = readonly(crosswalk_db)
    if archive.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise VerificationError("archive database integrity failed")
    if crosswalk.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise VerificationError("crosswalk database integrity failed")
    candidate_rows = {
        (int(snapshot_id), int(source_row)): (str(status), [int(item) for item in json.loads(ciks)])
        for snapshot_id, source_row, status, ciks in crosswalk.execute(
            "SELECT snapshot_id,source_row,candidate_status,candidate_ciks_json FROM crosswalk"
        )
    }
    snapshot_meta = {
        int(snapshot_id): (str(kind), str(timestamp))
        for snapshot_id, kind, timestamp in archive.execute(
            "SELECT snapshot_id,kind,capture_timestamp FROM snapshots ORDER BY snapshot_id"
        )
    }
    by_kind: dict[str, list[tuple[int, str]]] = defaultdict(list)
    for snapshot_id, (kind, timestamp) in snapshot_meta.items():
        by_kind[kind].append((snapshot_id, timestamp))
    for kind in by_kind:
        by_kind[kind].sort(key=lambda item: (item[1], item[0]))
    states: dict[int, dict[str, dict[str, Any]]] = defaultdict(dict)
    symbols: dict[tuple[str, str], dict[str, Any]] = {}
    ciks: dict[int, dict[str, Any]] = {}
    cik_states: dict[int, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    for snapshot_id, source_row, symbol, security_name, test_issue in archive.execute(
        "SELECT snapshot_id,source_row,symbol,security_name,test_issue FROM observations ORDER BY snapshot_id,source_row"
    ):
        if not eligible(test_issue):
            continue
        snapshot_id = int(snapshot_id)
        source_row = int(source_row)
        kind, timestamp = snapshot_meta[snapshot_id]
        symbol = str(symbol).strip().upper()
        status, candidate_ciks = candidate_rows[(snapshot_id, source_row)]
        if symbol in states[snapshot_id]:
            raise VerificationError(f"duplicate symbol in source snapshot: {snapshot_id}/{symbol}")
        states[snapshot_id][symbol] = {
            "name": str(security_name), "status": status, "ciks": candidate_ciks,
        }
        profile = symbols.setdefault(
            (kind, symbol),
            {"times": [], "names": set(), "direct_rows": 0, "direct_ciks": set(),
             "retro": 0, "none": 0, "appear": 0, "disappear": 0, "rename": 0},
        )
        profile["times"].append(timestamp)
        profile["names"].add(str(security_name))
        if status == DIRECT:
            if len(candidate_ciks) != 1:
                raise VerificationError("invalid unique direct candidate")
            cik = candidate_ciks[0]
            profile["direct_rows"] += 1
            profile["direct_ciks"].add(cik)
            cik_profile = ciks.setdefault(cik, {"times": [], "symbols": set(), "names": set(), "rows": 0})
            cik_profile["times"].append(timestamp)
            cik_profile["symbols"].add(symbol)
            cik_profile["names"].add(str(security_name))
            cik_profile["rows"] += 1
            cik_states[cik][timestamp].add(symbol)
        elif status == RETROSPECTIVE:
            profile["retro"] += 1
        elif status == NO_MATCH:
            profile["none"] += 1
    archive.close()
    crosswalk.close()
    return by_kind, states, symbols, ciks, cik_states


def transition_rows(
    by_kind: dict[str, list[tuple[int, str]]], states: dict[int, dict[str, dict[str, Any]]],
    profiles: dict[tuple[str, str], dict[str, Any]],
) -> tuple[list[tuple[Any, ...]], list[tuple[Any, ...]], dict[str, int]]:
    deltas: list[tuple[Any, ...]] = []
    transitions: list[tuple[Any, ...]] = []
    counts: dict[str, int] = defaultdict(int)
    transition_id = 0
    for kind in sorted(by_kind):
        sequence = by_kind[kind]
        for index in range(1, len(sequence)):
            previous_id, previous_at = sequence[index - 1]
            current_id, current_at = sequence[index]
            before = states[previous_id]
            after = states[current_id]
            appeared = sorted(set(after).difference(before))
            disappeared = sorted(set(before).difference(after))
            renamed = sorted(
                symbol for symbol in set(before).intersection(after)
                if name_key(before[symbol]["name"]) != name_key(after[symbol]["name"])
            )
            gap = days_between(day_from_capture(previous_at), day_from_capture(current_at))
            deltas.append((kind, previous_id, current_id, previous_at, current_at, gap,
                           len(before), len(after), len(appeared), len(disappeared), len(renamed)))
            counts["SNAPSHOT_PAIRS"] += 1
            for transition_type, candidates in (
                ("OBSERVED_APPEARANCE", appeared),
                ("OBSERVED_DISAPPEARANCE", disappeared),
                ("OBSERVED_NAME_CHANGE", renamed),
            ):
                for symbol in candidates:
                    transition_id += 1
                    old = before.get(symbol)
                    new = after.get(symbol)
                    transitions.append((
                        transition_id, kind, transition_type, previous_id, current_id,
                        previous_at, current_at, gap, symbol,
                        old["name"] if old else None, new["name"] if new else None,
                        old["status"] if old else None, new["status"] if new else None,
                        json.dumps(old["ciks"] if old else [], separators=(",", ":")),
                        json.dumps(new["ciks"] if new else [], separators=(",", ":")), 1,
                    ))
                    if transition_type == "OBSERVED_APPEARANCE":
                        profiles[(kind, symbol)]["appear"] += 1
                    elif transition_type == "OBSERVED_DISAPPEARANCE":
                        profiles[(kind, symbol)]["disappear"] += 1
                    else:
                        profiles[(kind, symbol)]["rename"] += 1
                    counts[transition_type] += 1
    return deltas, transitions, dict(sorted(counts.items()))


def symbol_rows(profiles: dict[tuple[str, str], dict[str, Any]]) -> tuple[list[tuple[Any, ...]], dict[str, int]]:
    rows: list[tuple[Any, ...]] = []
    counts: dict[str, int] = defaultdict(int)
    for (kind, symbol), profile in sorted(profiles.items()):
        direct_ciks = sorted(profile["direct_ciks"])
        if len(direct_ciks) > 1:
            status = "MULTIPLE_PIT_DIRECT_CIKS_CONFLICT_NOT_RESOLVED"
        elif len(direct_ciks) == 1:
            status = "ONE_PIT_DIRECT_CIK_CANDIDATE_NOT_IDENTITY"
        else:
            status = "NO_PIT_DIRECT_CIK_CANDIDATE"
        times = sorted(profile["times"])
        rows.append((
            kind, symbol, times[0], times[-1], len(times), len(profile["names"]),
            profile["direct_rows"], json.dumps(direct_ciks, separators=(",", ":")), len(direct_ciks),
            profile["retro"], profile["none"], profile["appear"], profile["disappear"],
            profile["rename"], status, 0,
        ))
        counts[status] += 1
    return rows, dict(sorted(counts.items()))


def cik_rows(profiles: dict[int, dict[str, Any]]) -> tuple[list[tuple[Any, ...]], dict[str, int]]:
    rows: list[tuple[Any, ...]] = []
    counts: dict[str, int] = defaultdict(int)
    for cik, profile in sorted(profiles.items()):
        times = sorted(profile["times"])
        symbols = sorted(profile["symbols"])
        names = sorted(profile["names"])
        status = (
            "MULTIPLE_SYMBOLS_FOR_CIK_CANDIDATE_NOT_TICKER_CHANGE"
            if len(symbols) > 1 else "ONE_SYMBOL_FOR_CIK_CANDIDATE_NOT_IDENTITY"
        )
        rows.append((
            cik, times[0], times[-1], profile["rows"],
            json.dumps(symbols, ensure_ascii=False, separators=(",", ":")), len(symbols),
            json.dumps(names, ensure_ascii=False, separators=(",", ":")), len(names), status, 0,
        ))
        counts[status] += 1
    return rows, dict(sorted(counts.items()))


def load_corporate_events(source: dict[str, Any]) -> list[tuple[Any, ...]]:
    rows: list[tuple[Any, ...]] = []
    for item in source["inputs"]["corporateRanges"]:
        _, parse_report = check_binding(item["parseReport"])
        check_binding(item["parseVerification"])
        database = Path(str(item["database"]["path"])).resolve()
        if file_sha256(database) != item["database"]["fileSha256"]:
            raise VerificationError(f"corporate database changed: {database}")
        db = readonly(database)
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise VerificationError(f"corporate database integrity failed: {database}")
        event_rows = db.execute(
            """
            SELECT DISTINCT e.event_id,e.event_class,e.form,e.filed_date,e.accession,
                   COALESCE(e.issuer_cik,e.cik),COALESCE(e.issuer_name,e.company_name)
            FROM events e JOIN securities s ON s.event_id=e.event_id
            WHERE s.security_class='COMMON_EQUITY' ORDER BY e.event_id
            """
        ).fetchall()
        titles: dict[int, set[str]] = defaultdict(set)
        for event_id, title in db.execute(
            "SELECT event_id,title FROM securities WHERE security_class='COMMON_EQUITY' ORDER BY event_id,ordinal"
        ):
            titles[int(event_id)].add(str(title))
        for event in event_rows:
            rows.append(tuple(event) + (sorted(titles[int(event[0])]),))
        db.close()
        if file_sha256(database) != parse_report["databaseSha256"]:
            raise VerificationError("corporate report database hash differs")
    rows.sort(key=lambda item: int(item[0]))
    return rows


def corporate_rows(
    events: list[tuple[Any, ...]], cik_states: dict[int, dict[str, set[str]]]
) -> tuple[list[tuple[Any, ...]], dict[str, int]]:
    rows: list[tuple[Any, ...]] = []
    counts: dict[str, int] = defaultdict(int)
    for event_id, event_class, form, filed_date, accession, issuer_cik, issuer_name, titles in events:
        cik = int(issuer_cik)
        event_day = day_from_filing(str(filed_date))
        states = cik_states.get(cik, {})
        timestamps = sorted(states)
        days = [day_from_capture(item) for item in timestamps]
        previous_index = bisect_right(days, event_day) - 1
        next_index = bisect_left(days, event_day)
        previous_at = timestamps[previous_index] if previous_index >= 0 else None
        next_at = timestamps[next_index] if next_index < len(timestamps) else None
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
        rows.append((
            int(event_id), str(event_class), str(form), str(filed_date), str(accession), cik,
            str(issuer_name), json.dumps(titles, ensure_ascii=False, separators=(",", ":")),
            previous_at, days_between(day_from_capture(previous_at), event_day) if previous_at else None,
            json.dumps(previous_symbols, separators=(",", ":")), next_at,
            days_between(event_day, day_from_capture(next_at)) if next_at else None,
            json.dumps(next_symbols, separators=(",", ":")), status, 0,
        ))
        counts[status] += 1
    return rows, dict(sorted(counts.items()))


def verify(args: argparse.Namespace) -> dict[str, Any]:
    source_path = args.report.expanduser().resolve()
    source = read_signed(source_path)
    if source.get("schema") != SOURCE_SCHEMA or source.get("status") != "PASS_OUTCOME_BLIND_IDENTITY_TRANSITIONS_QUANTIFIED_GATES_REMAIN_RED":
        raise VerificationError("unexpected source contract")
    if source.get("identityResolvedRows") != 0:
        raise VerificationError("identity boundary changed")
    if any(source.get(key) is not False for key in (
        "confirmatoryEligible", "resultComputationAllowed", "outcomesAccessed", "productiveGqsModified"
    )):
        raise VerificationError("fail-closed flags changed")
    for name in (
        "archiveReport", "archiveVerification", "crosswalkReport", "crosswalkVerification",
        "corporateGate", "corporateVerification",
    ):
        check_binding(source["inputs"][name])
    archive_db = Path(str(source["inputs"]["archiveDatabase"]["path"])).resolve()
    crosswalk_db = Path(str(source["inputs"]["crosswalkDatabase"]["path"])).resolve()
    if file_sha256(archive_db) != source["inputs"]["archiveDatabase"]["fileSha256"]:
        raise VerificationError("archive database binding mismatch")
    if file_sha256(crosswalk_db) != source["inputs"]["crosswalkDatabase"]["fileSha256"]:
        raise VerificationError("crosswalk database binding mismatch")
    database = Path(str(source["database"])).resolve()
    if file_sha256(database) != source["databaseSha256"] or database.stat().st_size != source["databaseBytes"]:
        raise VerificationError("output database binding mismatch")
    output = readonly(database)
    if output.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise VerificationError("output database integrity failed")
    columns = {
        str(row[1]).lower()
        for table in (
            "snapshot_deltas", "observed_transitions", "symbol_profiles",
            "cik_symbol_profiles", "corporate_event_candidate_links",
        )
        for row in output.execute(f'PRAGMA table_info("{table}")')
    }
    forbidden = {
        column for column in columns
        if any(token in column for token in ("price", "return", "volume", "outcome", "future"))
    }
    if forbidden:
        raise VerificationError(f"forbidden outcome columns: {sorted(forbidden)}")
    by_kind, states, symbols, ciks, cik_states = load_source_states(archive_db, crosswalk_db)
    deltas, transitions, transition_counts = transition_rows(by_kind, states, symbols)
    symbol_values, symbol_counts = symbol_rows(symbols)
    cik_values, cik_counts = cik_rows(ciks)
    events = load_corporate_events(source)
    corporate_values, corporate_counts = corporate_rows(events, cik_states)
    expectations = (
        ("snapshot_deltas", "directory_kind,previous_snapshot_id,current_snapshot_id", deltas),
        ("observed_transitions", "transition_id", transitions),
        ("symbol_profiles", "directory_kind,symbol", symbol_values),
        ("cik_symbol_profiles", "cik", cik_values),
        ("corporate_event_candidate_links", "event_id", corporate_values),
    )
    reproduced: dict[str, dict[str, Any]] = {}
    for table, order, expected in expectations:
        rows, sequence = compare_rows(output, table, order, iter(expected))
        reproduced[table] = {"rows": rows, "sequenceSha256": sequence}
    output.close()
    if reproduced != source["tableSequences"]:
        raise VerificationError("table sequence contract mismatch")
    expected_counts = {
        "archiveSnapshots": sum(len(value) for value in by_kind.values()),
        "nonTestPositiveObservationRows": sum(len(value) for value in states.values()),
        "snapshotPairs": transition_counts.get("SNAPSHOT_PAIRS", 0),
        "observedAppearances": transition_counts.get("OBSERVED_APPEARANCE", 0),
        "observedDisappearances": transition_counts.get("OBSERVED_DISAPPEARANCE", 0),
        "observedNameChanges": transition_counts.get("OBSERVED_NAME_CHANGE", 0),
        "symbolProfiles": len(symbols), "cikProfiles": len(ciks),
        "commonEquityCorporateEvents": len(events),
    }
    if expected_counts != source["counts"]:
        raise VerificationError("summary counts mismatch")
    if symbol_counts != source["symbolProfileStatusCounts"]:
        raise VerificationError("symbol status counts mismatch")
    if cik_counts != source["cikProfileStatusCounts"]:
        raise VerificationError("CIK status counts mismatch")
    if corporate_counts != source["corporateEventLinkStatusCounts"]:
        raise VerificationError("corporate link counts mismatch")
    mutated = json.loads(source_path.read_text(encoding="utf-8-sig"))
    mutated["identityResolvedRows"] = 1
    claimed = mutated.pop("reportSha256")
    mutation_rejected = canonical_sha256(mutated) != claimed
    if not mutation_rejected:
        raise VerificationError("mutation probe failed")
    unsigned: dict[str, Any] = {
        "schema": VERIFY_SCHEMA,
        "generatedAt": utc_now(),
        "status": "PASS",
        "verifierScript": str(Path(__file__).resolve()),
        "verifierScriptSha256": file_sha256(Path(__file__).resolve()),
        "sourceReport": str(source_path),
        "sourceReportFileSha256": file_sha256(source_path),
        "sourceReportSha256": source["reportSha256"],
        "checks": {
            "signedSourceAndInputsRehashed": True,
            "threeSourceDatabasesIntegrityChecked": True,
            "fiveOutputTablesIndependentlyRecomputed": True,
            "rowsIndependentlyRecomputed": sum(item["rows"] for item in reproduced.values()),
            "tableSequencesReproduced": reproduced,
            "summaryCountsReproduced": True,
            "identityResolvedRows": 0,
            "forbiddenOutcomeColumnsAbsent": True,
            "mutationRejected": mutation_rejected,
        },
        "interpretation": (
            "PASS authenticates the complete source-bound transition and corporate-event dossier ledger. "
            "It does not establish permanent identity, exact listing intervals, terminal sessions or returns."
        ),
        "confirmatoryEligible": False,
        "resultComputationAllowed": False,
        "outcomesAccessed": False,
        "productiveGqsModified": False,
    }
    return {**unsigned, "reportSha256": canonical_sha256(unsigned)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.expanduser().resolve()
    if output.exists():
        raise VerificationError("refusing to overwrite immutable verification")
    result = verify(args)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "status": result["status"], "checks": result["checks"],
        "reportSha256": result["reportSha256"],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
