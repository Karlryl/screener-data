#!/usr/bin/env python3
"""Independently verify every archived Nasdaq-to-SEC candidate crosswalk row."""

from __future__ import annotations

import argparse
from bisect import bisect_right
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
from typing import Any


SCHEMA = "early-detection-nasdaq-archive-sec-entity-candidate-crosswalk/v1"


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
    unsigned = {key: item for key, item in value.items() if key != "reportSha256"}
    if canonical_sha256(unsigned) != value.get("reportSha256"):
        raise VerificationError(f"signature mismatch: {path}")
    return value


def capture_epoch(value: str) -> float:
    return datetime.strptime(value, "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc).timestamp()


def expected_status(direct: set[int], historical: set[int]) -> tuple[str, list[int]]:
    if len(direct) == 1:
        return "PIT_DIRECT_UNIQUE_CANDIDATE_NOT_IDENTITY", sorted(direct)
    if len(direct) > 1:
        return "PIT_DIRECT_AMBIGUOUS_CANDIDATES", sorted(direct)
    if len(historical) == 1:
        return "RETROSPECTIVE_UNIQUE_CANDIDATE_NOT_PIT_IDENTITY", sorted(historical)
    if len(historical) > 1:
        return "RETROSPECTIVE_AMBIGUOUS_CANDIDATES", sorted(historical)
    return "NO_SEC_TICKER_MATCH", []


def verify(args: argparse.Namespace) -> dict[str, Any]:
    report_path = args.report.expanduser().resolve()
    report = read_signed(report_path)
    if report.get("schema") != SCHEMA or report.get("status") != "PASS_OUTCOME_BLIND_ARCHIVE_TO_SEC_CANDIDATE_CROSSWALK_GATE_REMAINS_RED":
        raise VerificationError("unexpected crosswalk contract")
    if report.get("identityResolvedRows") != 0 or report.get("futureSnapshotsUsed") is not False:
        raise VerificationError("identity or time boundary changed")
    if any(
        report.get(key) is not False
        for key in (
            "confirmatoryEligible",
            "resultComputationAllowed",
            "outcomesAccessed",
            "productiveGqsModified",
        )
    ):
        raise VerificationError("fail-closed flags changed")
    for name in (
        "archiveReport",
        "archiveVerification",
        "entityEvidenceReport",
        "entityEvidenceVerification",
    ):
        binding = report["inputs"][name]
        path = Path(str(binding["path"])).resolve()
        value = read_signed(path)
        if file_sha256(path) != binding["fileSha256"] or value["reportSha256"] != binding["reportSha256"]:
            raise VerificationError(f"input report binding failed: {name}")
    for name in ("archiveDatabase", "secEntityLedgerDatabase"):
        binding = report["inputs"][name]
        path = Path(str(binding["path"])).resolve()
        if file_sha256(path) != binding["fileSha256"]:
            raise VerificationError(f"input database binding failed: {name}")

    archive_path = Path(str(report["inputs"]["archiveDatabase"]["path"])).resolve()
    sec_path = Path(str(report["inputs"]["secEntityLedgerDatabase"]["path"])).resolve()
    crosswalk_path = Path(str(report["database"])).resolve()
    if (
        file_sha256(crosswalk_path) != report["databaseSha256"]
        or crosswalk_path.stat().st_size != int(report["databaseBytes"])
    ):
        raise VerificationError("crosswalk database binding failed")
    archive = sqlite3.connect(f"file:{archive_path.as_posix()}?mode=ro", uri=True)
    sec = sqlite3.connect(f"file:{sec_path.as_posix()}?mode=ro", uri=True)
    crosswalk = sqlite3.connect(f"file:{crosswalk_path.as_posix()}?mode=ro", uri=True)
    for name, connection in (("archive", archive), ("sec", sec), ("crosswalk", crosswalk)):
        if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise VerificationError(f"database integrity failed: {name}")

    snapshot_rows = [
        (float(epoch), int(snapshot_id), str(observed_at))
        for snapshot_id, observed_at, epoch in sec.execute(
            "SELECT snapshot_id,observed_at,observed_epoch FROM sec_snapshots ORDER BY observed_epoch,snapshot_id"
        )
    ]
    ordered_keys = [(epoch, snapshot_id) for epoch, snapshot_id, _ in snapshot_rows]
    meta = {snapshot_id: (epoch, observed_at) for epoch, snapshot_id, observed_at in snapshot_rows}
    by_snapshot: dict[int, dict[str, set[int]]] = {}
    global_map: dict[str, set[int]] = {}
    for snapshot_id, ticker, cik in sec.execute(
        "SELECT snapshot_id,upper(trim(ticker)),cik FROM sec_mappings WHERE trim(ticker)<>''"
    ):
        symbol = str(ticker)
        by_snapshot.setdefault(int(snapshot_id), {}).setdefault(symbol, set()).add(int(cik))
        global_map.setdefault(symbol, set()).add(int(cik))

    saved = crosswalk.execute(
        "SELECT snapshot_id,source_row,capture_timestamp,directory_kind,symbol,security_name,exchange_code,"
        "sec_snapshot_id,sec_observed_at,sec_age_days,candidate_status,candidate_ciks_json,candidate_count,identity_resolved "
        "FROM crosswalk ORDER BY snapshot_id,source_row"
    )
    counts: dict[str, int] = {}
    total = 0
    unique_direct_ciks: set[int] = set()
    sequence = hashlib.sha256()
    for snapshot_id, kind, capture_timestamp in archive.execute(
        "SELECT snapshot_id,kind,capture_timestamp FROM snapshots ORDER BY snapshot_id"
    ):
        epoch = capture_epoch(str(capture_timestamp))
        position = bisect_right(ordered_keys, (epoch, 2**63 - 1)) - 1
        expected_snapshot_id = ordered_keys[position][1] if position >= 0 else None
        expected_observed_at = None
        expected_age_days = None
        mapping: dict[str, set[int]] = {}
        if expected_snapshot_id is not None:
            sec_epoch, expected_observed_at = meta[expected_snapshot_id]
            expected_age_days = int((epoch - sec_epoch) // 86400)
            mapping = by_snapshot.get(expected_snapshot_id, {})
        observations = archive.execute(
            "SELECT source_row,symbol,security_name,exchange_code FROM observations WHERE snapshot_id=? ORDER BY source_row",
            (snapshot_id,),
        )
        for source_row, symbol, security_name, exchange_code in observations:
            row = saved.fetchone()
            if row is None:
                raise VerificationError("crosswalk ended before archive observations")
            ticker = str(symbol).strip().upper()
            status, ciks = expected_status(mapping.get(ticker, set()), global_map.get(ticker, set()))
            expected_prefix = (
                int(snapshot_id),
                int(source_row),
                str(capture_timestamp),
                str(kind),
                ticker,
                str(security_name),
                exchange_code,
                expected_snapshot_id,
                expected_observed_at,
                expected_age_days,
                status,
                json.dumps(ciks, separators=(",", ":")),
                len(ciks),
                0,
            )
            if tuple(row) != expected_prefix:
                raise VerificationError(f"crosswalk row mismatch: {snapshot_id}/{source_row}")
            if status == "PIT_DIRECT_UNIQUE_CANDIDATE_NOT_IDENTITY":
                unique_direct_ciks.add(ciks[0])
            counts[status] = counts.get(status, 0) + 1
            total += 1
            sequence.update(
                json.dumps(
                    [int(snapshot_id), int(source_row), ticker, expected_snapshot_id, status, ciks],
                    separators=(",", ":"),
                    ensure_ascii=False,
                ).encode("utf-8")
                + b"\n"
            )
    if saved.fetchone() is not None:
        raise VerificationError("crosswalk contains extra rows")
    archive.close()
    sec.close()
    crosswalk.close()
    if total != report["coverage"]["archiveObservations"]:
        raise VerificationError("observation recount mismatch")
    if dict(sorted(counts.items())) != report["candidateCounts"]:
        raise VerificationError("candidate recount mismatch")
    if len(unique_direct_ciks) != report["pitDirectUniqueCandidateCiks"]:
        raise VerificationError("unique direct CIK recount mismatch")
    if sequence.hexdigest() != report["logicalSequenceSha256"]:
        raise VerificationError("logical sequence mismatch")

    mutated = json.loads(report_path.read_text(encoding="utf-8-sig"))
    mutated["identityResolvedRows"] = 1
    claimed = mutated.pop("reportSha256")
    mutation_rejected = canonical_sha256(mutated) != claimed
    if not mutation_rejected:
        raise VerificationError("mutation probe failed")
    unsigned: dict[str, Any] = {
        "schema": "early-detection-nasdaq-archive-sec-entity-candidate-crosswalk-verification/v1",
        "generatedAt": utc_now(),
        "status": "PASS",
        "verifierScript": str(Path(__file__).resolve()),
        "verifierScriptSha256": file_sha256(Path(__file__).resolve()),
        "sourceReport": str(report_path),
        "sourceReportFileSha256": file_sha256(report_path),
        "sourceReportSha256": report["reportSha256"],
        "checks": {
            "signedSourceReport": True,
            "sixInputsRehashed": 6,
            "threeDatabaseIntegrityChecks": True,
            "rowsIndependentlyRecomputed": total,
            "candidateCountsRecounted": True,
            "logicalSequenceReproduced": True,
            "futureSnapshotsUsed": False,
            "identityResolvedRows": 0,
            "mutationRejected": mutation_rejected,
        },
        "confirmatoryEligible": False,
        "resultComputationAllowed": False,
        "outcomesAccessed": False,
        "productiveGqsModified": False,
    }
    return {**unsigned, "reportSha256": canonical_sha256(unsigned)}


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    value.add_argument("--report", type=Path, required=True)
    value.add_argument("--output", type=Path, required=True)
    return value


def main() -> int:
    args = parser().parse_args()
    output = args.output.expanduser().resolve()
    if output.exists():
        raise VerificationError("refusing to overwrite immutable output")
    result = verify(args)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "status": result["status"],
                "checks": result["checks"],
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
