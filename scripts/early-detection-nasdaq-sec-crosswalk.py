#!/usr/bin/env python3
"""Build an outcome-blind candidate crosswalk from archived Nasdaq states to SEC snapshots."""

from __future__ import annotations

import argparse
from bisect import bisect_right
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
from typing import Any


REPORT_SCHEMA = "early-detection-nasdaq-archive-sec-entity-candidate-crosswalk/v1"


class CrosswalkError(RuntimeError):
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
    unsigned = {key: item for key, item in value.items() if key != "reportSha256"}
    if canonical_sha256(unsigned) != value.get("reportSha256"):
        raise CrosswalkError(f"signature mismatch: {path}")
    return value


def report_binding(path: Path, value: dict[str, Any]) -> dict[str, str]:
    return {
        "path": str(path.resolve()),
        "fileSha256": file_sha256(path.resolve()),
        "reportSha256": str(value["reportSha256"]),
    }


def parse_capture_epoch(value: str) -> float:
    return datetime.strptime(value, "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc).timestamp()


def load_sec_maps(
    connection: sqlite3.Connection,
) -> tuple[list[tuple[float, int, str]], dict[int, dict[str, set[int]]], dict[str, set[int]]]:
    snapshots = [
        (float(epoch), int(snapshot_id), str(observed_at))
        for snapshot_id, observed_at, epoch in connection.execute(
            "SELECT snapshot_id,observed_at,observed_epoch FROM sec_snapshots ORDER BY observed_epoch,snapshot_id"
        )
    ]
    by_snapshot: dict[int, dict[str, set[int]]] = {}
    global_map: dict[str, set[int]] = {}
    for snapshot_id, ticker, cik in connection.execute(
        "SELECT snapshot_id,upper(trim(ticker)),cik FROM sec_mappings WHERE trim(ticker)<>'' ORDER BY snapshot_id,ticker,cik"
    ):
        ticker_text = str(ticker)
        cik_value = int(cik)
        by_snapshot.setdefault(int(snapshot_id), {}).setdefault(ticker_text, set()).add(cik_value)
        global_map.setdefault(ticker_text, set()).add(cik_value)
    return snapshots, by_snapshot, global_map


def classify(direct: set[int], retrospective: set[int]) -> tuple[str, list[int]]:
    if len(direct) == 1:
        return "PIT_DIRECT_UNIQUE_CANDIDATE_NOT_IDENTITY", sorted(direct)
    if len(direct) > 1:
        return "PIT_DIRECT_AMBIGUOUS_CANDIDATES", sorted(direct)
    if len(retrospective) == 1:
        return "RETROSPECTIVE_UNIQUE_CANDIDATE_NOT_PIT_IDENTITY", sorted(retrospective)
    if len(retrospective) > 1:
        return "RETROSPECTIVE_AMBIGUOUS_CANDIDATES", sorted(retrospective)
    return "NO_SEC_TICKER_MATCH", []


def build(args: argparse.Namespace) -> dict[str, Any]:
    output_database = args.output_database.expanduser().resolve()
    output_report = args.output_report.expanduser().resolve()
    if output_database.exists() or output_report.exists():
        raise CrosswalkError("refusing to overwrite immutable output")
    producer = Path(__file__).resolve()
    archive_report_path = args.archive_report.expanduser().resolve()
    archive_verify_path = args.archive_verification.expanduser().resolve()
    entity_report_path = args.entity_evidence_report.expanduser().resolve()
    entity_verify_path = args.entity_evidence_verification.expanduser().resolve()
    archive_report = read_signed(archive_report_path)
    archive_verify = read_signed(archive_verify_path)
    entity_report = read_signed(entity_report_path)
    entity_verify = read_signed(entity_verify_path)
    if archive_report.get("status") != "ARCHIVE_SNAPSHOT_EVIDENCE_COMPLETE":
        raise CrosswalkError("archive report is not complete")
    if (
        archive_verify.get("status") != "PASS"
        or Path(str(archive_verify.get("sourceReport"))).resolve() != archive_report_path
        or archive_verify.get("sourceReportSha256") != archive_report["reportSha256"]
    ):
        raise CrosswalkError("archive verification binding failed")
    if entity_report.get("status") != "SOURCE_POPULATIONS_COMPLETE_EVENT_EVIDENCE_PASS_GATE_REMAINS_RED":
        raise CrosswalkError("entity evidence is not the complete population contract")
    if (
        entity_verify.get("status") != "PASS"
        or Path(str(entity_verify.get("sourceReport"))).resolve() != entity_report_path
        or entity_verify.get("sourceReportSha256") != entity_report["reportSha256"]
    ):
        raise CrosswalkError("entity evidence verification binding failed")
    if any(
        report.get("outcomesAccessed") is not False
        for report in (archive_report, archive_verify, entity_report, entity_verify)
    ):
        raise CrosswalkError("upstream outcome-access boundary changed")

    archive_database = Path(str(archive_report["database"])).resolve()
    if file_sha256(archive_database) != archive_report["databaseSha256"]:
        raise CrosswalkError("archive database hash mismatch")
    ledger = entity_report["baseEntityLedger"]
    sec_database = Path(str(ledger["database"])).resolve()
    if file_sha256(sec_database) != ledger["databaseSha256"]:
        raise CrosswalkError("SEC entity-ledger database hash mismatch")

    archive = sqlite3.connect(f"file:{archive_database.as_posix()}?mode=ro", uri=True)
    sec = sqlite3.connect(f"file:{sec_database.as_posix()}?mode=ro", uri=True)
    if archive.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise CrosswalkError("archive database integrity failed")
    if sec.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise CrosswalkError("SEC database integrity failed")
    sec_snapshots, sec_maps, global_map = load_sec_maps(sec)
    sec_epochs = [(epoch, snapshot_id) for epoch, snapshot_id, _ in sec_snapshots]
    sec_meta = {snapshot_id: (epoch, observed_at) for epoch, snapshot_id, observed_at in sec_snapshots}

    output_database.parent.mkdir(parents=True, exist_ok=True)
    output = sqlite3.connect(output_database)
    output.executescript(
        """
        CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE crosswalk(
          snapshot_id INTEGER NOT NULL,source_row INTEGER NOT NULL,capture_timestamp TEXT NOT NULL,
          directory_kind TEXT NOT NULL,symbol TEXT NOT NULL,security_name TEXT NOT NULL,
          exchange_code TEXT,sec_snapshot_id INTEGER,sec_observed_at TEXT,sec_age_days INTEGER,
          candidate_status TEXT NOT NULL,candidate_ciks_json TEXT NOT NULL,candidate_count INTEGER NOT NULL,
          identity_resolved INTEGER NOT NULL CHECK(identity_resolved=0),
          PRIMARY KEY(snapshot_id,source_row)
        );
        CREATE INDEX crosswalk_status ON crosswalk(candidate_status,symbol,snapshot_id);
        CREATE INDEX crosswalk_symbol ON crosswalk(symbol,capture_timestamp);
        """
    )
    counts: dict[str, int] = {}
    total = 0
    direct_unique_ciks: set[int] = set()
    sequence = hashlib.sha256()
    snapshot_rows = archive.execute(
        "SELECT snapshot_id,kind,capture_timestamp FROM snapshots ORDER BY snapshot_id"
    ).fetchall()
    for snapshot_id, kind, capture_timestamp in snapshot_rows:
        capture_epoch = parse_capture_epoch(str(capture_timestamp))
        position = bisect_right(sec_epochs, (capture_epoch, 2**63 - 1)) - 1
        sec_snapshot_id: int | None = sec_epochs[position][1] if position >= 0 else None
        sec_observed_at: str | None = None
        sec_age_days: int | None = None
        mapping: dict[str, set[int]] = {}
        if sec_snapshot_id is not None:
            sec_epoch, sec_observed_at = sec_meta[sec_snapshot_id]
            sec_age_days = int((capture_epoch - sec_epoch) // 86400)
            mapping = sec_maps.get(sec_snapshot_id, {})
        for source_row, symbol, security_name, exchange_code in archive.execute(
            "SELECT source_row,symbol,security_name,exchange_code FROM observations WHERE snapshot_id=? ORDER BY source_row",
            (snapshot_id,),
        ):
            ticker = str(symbol).strip().upper()
            direct = mapping.get(ticker, set())
            retrospective = global_map.get(ticker, set())
            status, candidates = classify(direct, retrospective)
            if status == "PIT_DIRECT_UNIQUE_CANDIDATE_NOT_IDENTITY":
                direct_unique_ciks.add(candidates[0])
            candidate_json = json.dumps(candidates, separators=(",", ":"))
            output.execute(
                "INSERT INTO crosswalk VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,0)",
                (
                    int(snapshot_id),
                    int(source_row),
                    str(capture_timestamp),
                    str(kind),
                    ticker,
                    str(security_name),
                    exchange_code,
                    sec_snapshot_id,
                    sec_observed_at,
                    sec_age_days,
                    status,
                    candidate_json,
                    len(candidates),
                ),
            )
            counts[status] = counts.get(status, 0) + 1
            total += 1
            sequence.update(
                json.dumps(
                    [
                        int(snapshot_id),
                        int(source_row),
                        ticker,
                        sec_snapshot_id,
                        status,
                        candidates,
                    ],
                    separators=(",", ":"),
                    ensure_ascii=False,
                ).encode("utf-8")
                + b"\n"
            )
    bindings = {
        "schema": REPORT_SCHEMA,
        "producerScriptSha256": file_sha256(producer),
        "archiveReportSha256": archive_report["reportSha256"],
        "archiveDatabaseSha256": archive_report["databaseSha256"],
        "entityEvidenceReportSha256": entity_report["reportSha256"],
        "secEntityLedgerDatabaseSha256": ledger["databaseSha256"],
    }
    output.executemany("INSERT INTO meta VALUES(?,?)", sorted(bindings.items()))
    output.commit()
    if output.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise CrosswalkError("crosswalk database integrity failed")
    if int(output.execute("SELECT COUNT(*) FROM crosswalk").fetchone()[0]) != total:
        raise CrosswalkError("crosswalk row count mismatch")
    output.close()
    archive.close()
    sec.close()

    unsigned: dict[str, Any] = {
        "schema": REPORT_SCHEMA,
        "generatedAt": utc_now(),
        "status": "PASS_OUTCOME_BLIND_ARCHIVE_TO_SEC_CANDIDATE_CROSSWALK_GATE_REMAINS_RED",
        "producerScript": str(producer),
        "producerScriptSha256": file_sha256(producer),
        "database": str(output_database),
        "databaseBytes": output_database.stat().st_size,
        "databaseSha256": file_sha256(output_database),
        "coverage": {
            "archiveSnapshots": len(snapshot_rows),
            "archiveObservations": total,
            "secMappingSnapshots": len(sec_snapshots),
            "secMappingSnapshotRange": {
                "first": sec_snapshots[0][2],
                "last": sec_snapshots[-1][2],
            },
        },
        "candidateCounts": dict(sorted(counts.items())),
        "pitDirectUniqueCandidateRows": counts.get(
            "PIT_DIRECT_UNIQUE_CANDIDATE_NOT_IDENTITY", 0
        ),
        "pitDirectUniqueCandidateCiks": len(direct_unique_ciks),
        "identityResolvedRows": 0,
        "futureSnapshotsUsed": False,
        "logicalSequenceSha256": sequence.hexdigest(),
        "interpretation": (
            "Exact ticker matches to the latest SEC mapping known no later than each archive capture are point-in-time "
            "identity candidates only. Retrospective matches are separately labeled and no row establishes permanent "
            "security identity, continuous listing or an outcome."
        ),
        "limitations": [
            "SEC ticker snapshots start in 2017 and are sparse.",
            "Exact ticker equality does not resolve ticker reuse, share classes or reorganizations.",
            "Retrospective candidates are not point-in-time identity evidence.",
            "Archive states contain no prices, returns or terminal-session proof.",
        ],
        "inputs": {
            "archiveReport": report_binding(archive_report_path, archive_report),
            "archiveVerification": report_binding(archive_verify_path, archive_verify),
            "entityEvidenceReport": report_binding(entity_report_path, entity_report),
            "entityEvidenceVerification": report_binding(entity_verify_path, entity_verify),
            "archiveDatabase": {
                "path": str(archive_database),
                "fileSha256": archive_report["databaseSha256"],
            },
            "secEntityLedgerDatabase": {
                "path": str(sec_database),
                "fileSha256": ledger["databaseSha256"],
            },
        },
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
    value.add_argument("--entity-evidence-report", type=Path, required=True)
    value.add_argument("--entity-evidence-verification", type=Path, required=True)
    value.add_argument("--output-database", type=Path, required=True)
    value.add_argument("--output-report", type=Path, required=True)
    return value


def main() -> int:
    args = parser().parse_args()
    result = build(args)
    output = args.output_report.expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "status": result["status"],
                "coverage": result["coverage"],
                "candidateCounts": result["candidateCounts"],
                "identityResolvedRows": 0,
                "output": str(output),
                "reportSha256": result["reportSha256"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
