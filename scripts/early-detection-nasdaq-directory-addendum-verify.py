#!/usr/bin/env python3
"""Independently verify the archived Nasdaq directory evidence addendum."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
from typing import Any


ADDENDUM_SCHEMA = "early-detection-nasdaq-symbol-directory-evidence-addendum/v1"
CAPTURE_SCHEMA = "early-detection-nasdaq-symbol-directory-archive/v1"
VERIFY_SCHEMA = "early-detection-nasdaq-symbol-directory-archive-verification/v1"
OUTPUT_SCHEMA = "early-detection-nasdaq-symbol-directory-evidence-addendum-verification/v1"


class VerificationError(RuntimeError):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def canonical_sha256(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
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


def grouped(connection: sqlite3.Connection, query: str) -> dict[str, int]:
    return {str(key): int(value) for key, value in connection.execute(query)}


def independent_recount(
    connection: sqlite3.Connection, start_year: int, end_year: int
) -> dict[str, Any]:
    first_capture, last_capture = connection.execute(
        "SELECT MIN(capture_timestamp),MAX(capture_timestamp) FROM snapshots"
    ).fetchone()
    years = [
        str(row[0])
        for row in connection.execute(
            "SELECT DISTINCT substr(capture_timestamp,1,4) FROM snapshots ORDER BY 1"
        )
    ]
    year_set = set(years)
    return {
        "snapshots": int(connection.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0]),
        "observations": int(
            connection.execute("SELECT COUNT(*) FROM observations").fetchone()[0]
        ),
        "captureTimestampRange": {"first": first_capture, "last": last_capture},
        "coveredCaptureYears": years,
        "missingCaptureYears": [
            str(year)
            for year in range(start_year, end_year + 1)
            if str(year) not in year_set
        ],
        "snapshotsByKind": grouped(
            connection,
            "SELECT kind,COUNT(*) FROM snapshots GROUP BY kind ORDER BY kind",
        ),
        "snapshotsByCaptureYear": grouped(
            connection,
            "SELECT substr(capture_timestamp,1,4),COUNT(*) FROM snapshots GROUP BY 1 ORDER BY 1",
        ),
        "observationsByKind": grouped(
            connection,
            "SELECT s.kind,COUNT(*) FROM observations o JOIN snapshots s ON s.snapshot_id=o.snapshot_id GROUP BY s.kind ORDER BY s.kind",
        ),
        "observationsByExchangeCode": grouped(
            connection,
            "SELECT exchange_code,COUNT(*) FROM observations WHERE COALESCE(exchange_code,'')<>'' GROUP BY exchange_code ORDER BY exchange_code",
        ),
        "distinctSymbols": int(
            connection.execute("SELECT COUNT(DISTINCT symbol) FROM observations").fetchone()[0]
        ),
        "distinctSymbolNamePairs": int(
            connection.execute(
                "SELECT COUNT(*) FROM (SELECT 1 FROM observations GROUP BY symbol,security_name)"
            ).fetchone()[0]
        ),
        "symbolsWithMultipleObservedNames": int(
            connection.execute(
                "SELECT COUNT(*) FROM (SELECT symbol FROM observations GROUP BY symbol HAVING COUNT(DISTINCT security_name)>1)"
            ).fetchone()[0]
        ),
        "observationsWithExchangeCode": int(
            connection.execute(
                "SELECT COUNT(*) FROM observations WHERE COALESCE(exchange_code,'')<>''"
            ).fetchone()[0]
        ),
        "observationsWithoutExchangeCode": int(
            connection.execute(
                "SELECT COUNT(*) FROM observations WHERE COALESCE(exchange_code,'')=''"
            ).fetchone()[0]
        ),
        "testIssueObservations": int(
            connection.execute(
                "SELECT COUNT(*) FROM observations WHERE upper(COALESCE(test_issue,''))='Y'"
            ).fetchone()[0]
        ),
        "nonTestPositivePresenceObservations": int(
            connection.execute(
                "SELECT COUNT(*) FROM observations WHERE upper(COALESCE(test_issue,''))<>'Y'"
            ).fetchone()[0]
        ),
        "snapshotsWithEmbeddedFileCreationTime": int(
            connection.execute(
                "SELECT COUNT(*) FROM snapshots WHERE COALESCE(file_creation_time,'')<>''"
            ).fetchone()[0]
        ),
        "headerVariantsByKind": grouped(
            connection,
            "SELECT kind,COUNT(DISTINCT header_json) FROM snapshots GROUP BY kind ORDER BY kind",
        ),
        "identityResolvedRows": 0,
    }


def verify(args: argparse.Namespace) -> dict[str, Any]:
    decision_path = args.decision.expanduser().resolve()
    decision = read_signed(decision_path)
    if (
        decision.get("schema") != ADDENDUM_SCHEMA
        or decision.get("status")
        != "PARTIAL_FREE_ARCHIVED_NASDAQ_DIRECTORY_STATES_GATE_REMAINS_RED"
    ):
        raise VerificationError("unexpected addendum contract")
    if decision.get("evidence", {}).get("identityResolvedRows") != 0:
        raise VerificationError("symbol evidence was promoted to identity")
    if any(
        decision.get(key) is not False
        for key in (
            "confirmatoryEligible",
            "resultComputationAllowed",
            "outcomesAccessed",
            "productiveGqsModified",
        )
    ):
        raise VerificationError("fail-closed flags changed")

    inputs = decision.get("inputs", {})
    if set(inputs) != {"captureReport", "captureVerification", "database"}:
        raise VerificationError("input set changed")
    capture_path = Path(str(inputs["captureReport"]["path"])).resolve()
    verification_path = Path(str(inputs["captureVerification"]["path"])).resolve()
    capture = read_signed(capture_path)
    upstream_verification = read_signed(verification_path)
    for name, path, report in (
        ("captureReport", capture_path, capture),
        ("captureVerification", verification_path, upstream_verification),
    ):
        if file_sha256(path) != inputs[name]["fileSha256"]:
            raise VerificationError(f"input file hash mismatch: {name}")
        if report["reportSha256"] != inputs[name]["reportSha256"]:
            raise VerificationError(f"input report hash mismatch: {name}")
    if capture.get("schema") != CAPTURE_SCHEMA:
        raise VerificationError("capture schema changed")
    if (
        upstream_verification.get("schema") != VERIFY_SCHEMA
        or upstream_verification.get("status") != "PASS"
        or Path(str(upstream_verification.get("sourceReport"))).resolve()
        != capture_path
        or upstream_verification.get("sourceReportSha256")
        != capture["reportSha256"]
    ):
        raise VerificationError("upstream archive verification binding failed")

    database_path = Path(str(inputs["database"]["path"])).resolve()
    if (
        file_sha256(database_path) != inputs["database"]["fileSha256"]
        or file_sha256(database_path) != capture["databaseSha256"]
        or database_path.stat().st_size != int(inputs["database"]["bytes"])
    ):
        raise VerificationError("database binding failed")
    connection = sqlite3.connect(
        f"file:{database_path.as_posix()}?mode=ro", uri=True
    )
    try:
        if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise VerificationError("database integrity check failed")
        columns = {
            str(row[1]).lower()
            for table in ("snapshots", "observations")
            for row in connection.execute(f'PRAGMA table_info("{table}")')
        }
        forbidden = {
            column
            for column in columns
            if any(
                token in column
                for token in ("outcome", "future_return", "forward_return", "price")
            )
        }
        if forbidden:
            raise VerificationError(f"forbidden outcome columns: {sorted(forbidden)}")
        expected = independent_recount(
            connection,
            int(capture["period"]["startYear"]),
            int(capture["period"]["endYear"]),
        )
    finally:
        connection.close()
    if decision.get("evidence") != expected:
        raise VerificationError("independent database recount mismatch")
    if (
        expected["snapshots"]
        != upstream_verification.get("checks", {}).get("snapshotsRehashedAndReparsed")
        or expected["observations"]
        != upstream_verification.get("checks", {}).get("observationsReparsed")
    ):
        raise VerificationError("upstream reparse counts differ")

    mutated = json.loads(decision_path.read_text(encoding="utf-8-sig"))
    mutated["evidence"]["identityResolvedRows"] = 1
    claimed = mutated.pop("reportSha256")
    mutation_rejected = canonical_sha256(mutated) != claimed
    if not mutation_rejected:
        raise VerificationError("mutation probe failed")

    unsigned: dict[str, Any] = {
        "schema": OUTPUT_SCHEMA,
        "generatedAt": utc_now(),
        "status": "PASS",
        "verifierScript": str(Path(__file__).resolve()),
        "verifierScriptSha256": file_sha256(Path(__file__).resolve()),
        "sourceDecision": str(decision_path),
        "sourceDecisionFileSha256": file_sha256(decision_path),
        "sourceDecisionReportSha256": decision["reportSha256"],
        "checks": {
            "signedDecision": True,
            "boundReportsRehashed": 2,
            "upstreamFullReparseVerificationPassed": True,
            "databaseIntegrity": True,
            "evidenceIndependentlyRecounted": True,
            "snapshots": expected["snapshots"],
            "observations": expected["observations"],
            "distinctSymbols": expected["distinctSymbols"],
            "identityResolvedRows": 0,
            "forbiddenOutcomeColumnsAbsent": True,
            "redGateBoundaryPreserved": True,
            "mutationRejected": mutation_rejected,
        },
        "interpretation": (
            "PASS verifies the archive addendum and its positive-state counts. It does not prove continuous "
            "listings, permanent identity, prices, returns or either affected gate."
        ),
        "confirmatoryEligible": False,
        "resultComputationAllowed": False,
        "outcomesAccessed": False,
        "productiveGqsModified": False,
    }
    return {**unsigned, "reportSha256": canonical_sha256(unsigned)}


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    value.add_argument("--decision", type=Path, required=True)
    value.add_argument("--output", type=Path, required=True)
    return value


def main() -> int:
    args = parser().parse_args()
    output = args.output.expanduser().resolve()
    if output.exists():
        raise VerificationError("refusing to overwrite immutable output")
    result = verify(args)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
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
