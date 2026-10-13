#!/usr/bin/env python3
"""Summarize verified archived Nasdaq symbol-directory states without closing gates."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
from typing import Any


CAPTURE_SCHEMA = "early-detection-nasdaq-symbol-directory-archive/v1"
VERIFY_SCHEMA = "early-detection-nasdaq-symbol-directory-archive-verification/v1"
OUTPUT_SCHEMA = "early-detection-nasdaq-symbol-directory-evidence-addendum/v1"


class AddendumError(RuntimeError):
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
        raise AddendumError(f"not a JSON object: {path}")
    unsigned = {key: item for key, item in value.items() if key != "reportSha256"}
    if canonical_sha256(unsigned) != value.get("reportSha256"):
        raise AddendumError(f"signature mismatch: {path}")
    return value


def report_binding(path: Path, value: dict[str, Any]) -> dict[str, str]:
    return {
        "path": str(path.resolve()),
        "fileSha256": file_sha256(path.resolve()),
        "reportSha256": str(value["reportSha256"]),
    }


def grouped_counts(
    connection: sqlite3.Connection, query: str
) -> dict[str, int]:
    return {str(key): int(value) for key, value in connection.execute(query)}


def recount(connection: sqlite3.Connection, start_year: int, end_year: int) -> dict[str, Any]:
    first_capture, last_capture = connection.execute(
        "SELECT MIN(capture_timestamp),MAX(capture_timestamp) FROM snapshots"
    ).fetchone()
    covered_years = [
        str(row[0])
        for row in connection.execute(
            "SELECT DISTINCT substr(capture_timestamp,1,4) FROM snapshots ORDER BY 1"
        )
    ]
    return {
        "snapshots": int(connection.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0]),
        "observations": int(
            connection.execute("SELECT COUNT(*) FROM observations").fetchone()[0]
        ),
        "captureTimestampRange": {"first": first_capture, "last": last_capture},
        "coveredCaptureYears": covered_years,
        "missingCaptureYears": [
            str(year)
            for year in range(start_year, end_year + 1)
            if str(year) not in set(covered_years)
        ],
        "snapshotsByKind": grouped_counts(
            connection,
            "SELECT kind,COUNT(*) FROM snapshots GROUP BY kind ORDER BY kind",
        ),
        "snapshotsByCaptureYear": grouped_counts(
            connection,
            "SELECT substr(capture_timestamp,1,4),COUNT(*) FROM snapshots GROUP BY 1 ORDER BY 1",
        ),
        "observationsByKind": grouped_counts(
            connection,
            "SELECT s.kind,COUNT(*) FROM observations o JOIN snapshots s USING(snapshot_id) GROUP BY s.kind ORDER BY s.kind",
        ),
        "observationsByExchangeCode": grouped_counts(
            connection,
            "SELECT exchange_code,COUNT(*) FROM observations WHERE exchange_code IS NOT NULL AND exchange_code<>'' GROUP BY exchange_code ORDER BY exchange_code",
        ),
        "distinctSymbols": int(
            connection.execute("SELECT COUNT(DISTINCT symbol) FROM observations").fetchone()[0]
        ),
        "distinctSymbolNamePairs": int(
            connection.execute(
                "SELECT COUNT(*) FROM (SELECT symbol,security_name FROM observations GROUP BY symbol,security_name)"
            ).fetchone()[0]
        ),
        "symbolsWithMultipleObservedNames": int(
            connection.execute(
                "SELECT COUNT(*) FROM (SELECT symbol FROM observations GROUP BY symbol HAVING COUNT(DISTINCT security_name)>1)"
            ).fetchone()[0]
        ),
        "observationsWithExchangeCode": int(
            connection.execute(
                "SELECT COUNT(*) FROM observations WHERE exchange_code IS NOT NULL AND exchange_code<>''"
            ).fetchone()[0]
        ),
        "observationsWithoutExchangeCode": int(
            connection.execute(
                "SELECT COUNT(*) FROM observations WHERE exchange_code IS NULL OR exchange_code=''"
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
                "SELECT COUNT(*) FROM snapshots WHERE file_creation_time IS NOT NULL AND file_creation_time<>''"
            ).fetchone()[0]
        ),
        "headerVariantsByKind": grouped_counts(
            connection,
            "SELECT kind,COUNT(DISTINCT header_json) FROM snapshots GROUP BY kind ORDER BY kind",
        ),
        "identityResolvedRows": 0,
    }


def build(args: argparse.Namespace) -> dict[str, Any]:
    output = args.output.expanduser().resolve()
    if output.exists():
        raise AddendumError("refusing to overwrite immutable output")
    capture_path = args.capture.expanduser().resolve()
    verification_path = args.verification.expanduser().resolve()
    capture = read_signed(capture_path)
    verification = read_signed(verification_path)
    if (
        capture.get("schema") != CAPTURE_SCHEMA
        or capture.get("status") != "ARCHIVE_SNAPSHOT_EVIDENCE_COMPLETE"
    ):
        raise AddendumError("unexpected capture contract")
    if verification.get("schema") != VERIFY_SCHEMA or verification.get("status") != "PASS":
        raise AddendumError("archive verification did not pass")
    if (
        Path(str(verification.get("sourceReport"))).resolve() != capture_path
        or verification.get("sourceReportSha256") != capture["reportSha256"]
        or verification.get("sourceReportFileSha256") != file_sha256(capture_path)
    ):
        raise AddendumError("verification is not bound to the capture report")
    if (
        verification.get("checks", {}).get("snapshotsRehashedAndReparsed")
        != capture.get("snapshots")
        or verification.get("checks", {}).get("observationsReparsed")
        != capture.get("observations")
        or verification.get("checks", {}).get("forbiddenOutcomeColumnsAbsent") is not True
    ):
        raise AddendumError("verification counts or outcome quarantine differ")
    if any(
        item.get("outcomesAccessed") is not False
        for item in (capture, verification)
    ):
        raise AddendumError("upstream outcome-access boundary changed")

    database_path = Path(str(capture["database"])).resolve()
    if (
        database_path.stat().st_size != int(capture["databaseBytes"])
        or file_sha256(database_path) != capture["databaseSha256"]
    ):
        raise AddendumError("database binding mismatch")
    connection = sqlite3.connect(
        f"file:{database_path.as_posix()}?mode=ro", uri=True
    )
    try:
        if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise AddendumError("database integrity check failed")
        evidence = recount(
            connection,
            int(capture["period"]["startYear"]),
            int(capture["period"]["endYear"]),
        )
    finally:
        connection.close()
    if (
        evidence["snapshots"] != capture["snapshots"]
        or evidence["observations"] != capture["observations"]
        or evidence["snapshotsByKind"] != capture["snapshotsByKind"]
        or evidence["snapshotsByCaptureYear"] != capture["snapshotsByYear"]
    ):
        raise AddendumError("database recount differs from capture report")

    unsigned: dict[str, Any] = {
        "schema": OUTPUT_SCHEMA,
        "generatedAt": utc_now(),
        "gates": ["entityListingLedger", "historicalUniverse"],
        "status": "PARTIAL_FREE_ARCHIVED_NASDAQ_DIRECTORY_STATES_GATE_REMAINS_RED",
        "verdict": (
            "Archived Nasdaq Trader symbol-directory files add independently verified positive security states "
            "for the observed 2009-2024 capture timestamps. Their sparse Internet Archive availability cannot "
            "prove continuous listing intervals, permanent identity, exact first or final sessions, adjusted "
            "OHLCV or delisting returns."
        ),
        "period": capture["period"],
        "evidence": evidence,
        "sourceQualification": (
            "Nasdaq Trader Symbol Directory content replayed through Internet Archive; original URL, archive "
            "capture timestamp, embedded file-creation time, payload hash and raw bytes remain bound per snapshot."
        ),
        "acceptedUses": [
            "Positive as-of security presence at each observed archived directory state.",
            "Observed symbol, security-name and source exchange-code cross-checks.",
            "Survivorship and ticker-reuse diagnostics without identity promotion.",
        ],
        "forbiddenUses": [
            "Inferring absence or continuous listing between sparse archive states.",
            "Treating a symbol or symbol-name pair as a permanent security identifier.",
            "Inferring exact first or final trading sessions, adjusted OHLCV, returns or delisting returns.",
            "Backfilling dates without a captured source state.",
        ],
        "whatWouldChangeDecision": (
            "A lawful zero-cost security-level 2009-2024 master with stable identity, exchange-effective listing "
            "intervals, corporate actions, terminal sessions and delisting returns must pass independent audit."
        ),
        "inputs": {
            "captureReport": report_binding(capture_path, capture),
            "captureVerification": report_binding(verification_path, verification),
            "database": {
                "path": str(database_path),
                "fileSha256": capture["databaseSha256"],
                "bytes": capture["databaseBytes"],
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
    value.add_argument("--capture", type=Path, required=True)
    value.add_argument("--verification", type=Path, required=True)
    value.add_argument("--output", type=Path, required=True)
    return value


def main() -> int:
    args = parser().parse_args()
    result = build(args)
    output = args.output.expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "status": result["status"],
                "snapshots": result["evidence"]["snapshots"],
                "observations": result["evidence"]["observations"],
                "distinctSymbols": result["evidence"]["distinctSymbols"],
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
