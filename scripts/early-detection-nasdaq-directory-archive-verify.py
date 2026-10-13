#!/usr/bin/env python3
"""Independently verify the archived Nasdaq symbol-directory snapshot ledger."""

from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import sqlite3
from typing import Any


SOURCE_SCHEMA = "early-detection-nasdaq-symbol-directory-archive/v1"
REPORT_SCHEMA = "early-detection-nasdaq-symbol-directory-archive-verification/v1"


class VerificationError(RuntimeError):
    pass


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
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
    if not isinstance(value, dict) or value.get("schema") != SOURCE_SCHEMA:
        raise VerificationError("source schema mismatch")
    unsigned = {key: item for key, item in value.items() if key != "reportSha256"}
    if canonical_sha256(unsigned) != value.get("reportSha256"):
        raise VerificationError("source report signature mismatch")
    return value


def normalize_header(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")


def decode(payload: bytes) -> str:
    for encoding in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return payload.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise VerificationError("snapshot cannot be decoded")


def logical_payload(payload: bytes) -> tuple[bytes, str]:
    if payload.startswith(b"\x1f\x8b"):
        try:
            return gzip.decompress(payload), "gzip"
        except (OSError, EOFError) as exc:
            raise VerificationError(f"invalid gzip snapshot: {exc}") from exc
    return payload, "identity"


def parse_rows(payload: bytes) -> tuple[list[str], list[dict[str, str]]]:
    content, _ = logical_payload(payload)
    lines = [
        line
        for line in decode(content).replace("\x00", "").splitlines()
        if line.strip()
    ]
    reader = csv.reader(io.StringIO("\n".join(lines)), delimiter="|")
    raw_header = next(reader)
    header = [normalize_header(value) for value in raw_header]
    rows: list[dict[str, str]] = []
    for raw in reader:
        if raw and raw[0].strip().lower().startswith("file creation time:"):
            continue
        if len(raw) != len(header):
            raise VerificationError("snapshot row width mismatch")
        row = {name: value.strip() for name, value in zip(header, raw, strict=True)}
        if any(row.values()):
            rows.append(row)
    return raw_header, rows


def first(row: dict[str, str], *names: str) -> str | None:
    for name in names:
        if row.get(name):
            return row[name]
    return None


def sqlite_columns(connection: sqlite3.Connection) -> set[str]:
    result: set[str] = set()
    tables = connection.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).fetchall()
    for (table,) in tables:
        result.update(str(row[1]).lower() for row in connection.execute(f'PRAGMA table_info("{table}")'))
    return result


def verify(args: argparse.Namespace) -> dict[str, Any]:
    verifier = Path(__file__).resolve()
    source_path = args.report.expanduser().resolve()
    source = read_signed(source_path)
    producer = Path(str(source["producerScript"])).resolve()
    if not producer.is_file() or file_sha256(producer) != source.get("producerScriptSha256"):
        raise VerificationError("producer binding mismatch")
    database_path = Path(str(source["database"])).resolve()
    if file_sha256(database_path) != source.get("databaseSha256"):
        raise VerificationError("database hash mismatch")
    if database_path.stat().st_size != int(source["databaseBytes"]):
        raise VerificationError("database byte count mismatch")
    connection = sqlite3.connect(f"file:{database_path.as_posix()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise VerificationError("database integrity check failed")
    forbidden = {
        column
        for column in sqlite_columns(connection)
        if any(token in column for token in ("future_return", "forward_return", "outcome", "price"))
    }
    if forbidden:
        raise VerificationError(f"forbidden outcome columns found: {sorted(forbidden)}")
    snapshots = list(connection.execute("SELECT * FROM snapshots ORDER BY snapshot_id"))
    evidence = source.get("snapshotEvidence")
    if not isinstance(evidence, list) or len(evidence) != len(snapshots):
        raise VerificationError("snapshot evidence count mismatch")
    if len(snapshots) != int(source["snapshots"]):
        raise VerificationError("reported snapshot count mismatch")
    sequence: list[dict[str, Any]] = []
    observations = 0
    for ordinal, (stored, item) in enumerate(zip(snapshots, evidence, strict=True), start=1):
        if int(stored["snapshot_id"]) != ordinal or int(item["snapshotId"]) != ordinal:
            raise VerificationError("snapshot sequence is not contiguous")
        payload_path = Path(str(stored["payload_path"])).resolve()
        payload = payload_path.read_bytes()
        payload_hash = hashlib.sha256(payload).hexdigest()
        if (
            payload_hash != stored["payload_sha256"]
            or payload_hash != item["payloadSha256"]
            or len(payload) != int(stored["payload_bytes"])
            or len(payload) != int(item["payloadBytes"])
        ):
            raise VerificationError(f"snapshot payload mismatch: {ordinal}")
        raw_header, rows = parse_rows(payload)
        if raw_header != json.loads(stored["header_json"]) or raw_header != item["header"]:
            raise VerificationError(f"snapshot header mismatch: {ordinal}")
        stored_rows = list(
            connection.execute(
                "SELECT * FROM observations WHERE snapshot_id=? ORDER BY source_row",
                (ordinal,),
            )
        )
        if len(rows) != len(stored_rows) or len(rows) != int(stored["row_count"]):
            raise VerificationError(f"snapshot row count mismatch: {ordinal}")
        for source_row, (parsed, saved) in enumerate(zip(rows, stored_rows, strict=True), start=1):
            if int(saved["source_row"]) != source_row:
                raise VerificationError("observation sequence mismatch")
            symbol = first(parsed, "symbol", "act_symbol", "nasdaq_symbol", "cqs_symbol")
            if symbol != saved["symbol"] or parsed.get("security_name") != saved["security_name"]:
                raise VerificationError(f"observation identity mismatch: {ordinal}/{source_row}")
            if canonical_bytes(parsed).decode("utf-8") != saved["raw_json"]:
                raise VerificationError(f"raw observation mismatch: {ordinal}/{source_row}")
        observations += len(rows)
        sequence.append(
            {
                "snapshotId": ordinal,
                "kind": stored["kind"],
                "captureTimestamp": stored["capture_timestamp"],
                "originalUrl": stored["original_url"],
                "waybackUrl": stored["wayback_url"],
                "cdxDigest": stored["cdx_digest"],
                "payloadPath": str(payload_path),
                "payloadSha256": payload_hash,
                "payloadBytes": len(payload),
                "contentEncoding": logical_payload(payload)[1],
                "rows": len(rows),
                "fileCreationTime": stored["file_creation_time"],
                "header": raw_header,
            }
        )
    if observations != int(source["observations"]):
        raise VerificationError("total observation count mismatch")
    if canonical_sha256(sequence) != source.get("snapshotSequenceSha256"):
        raise VerificationError("snapshot sequence hash mismatch")
    connection.close()
    mutated = dict(source)
    mutated["status"] = "MUTATED"
    mutation_rejected = canonical_sha256(
        {key: item for key, item in mutated.items() if key != "reportSha256"}
    ) != mutated["reportSha256"]
    if not mutation_rejected:
        raise VerificationError("report mutation probe failed")
    unsigned = {
        "schema": REPORT_SCHEMA,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
            "+00:00", "Z"
        ),
        "status": "PASS",
        "verifierScript": str(verifier),
        "verifierScriptSha256": file_sha256(verifier),
        "sourceReport": str(source_path),
        "sourceReportFileSha256": file_sha256(source_path),
        "sourceReportSha256": source["reportSha256"],
        "checks": {
            "signedSourceContract": True,
            "producerBinding": True,
            "sqliteIntegrity": True,
            "snapshotsRehashedAndReparsed": len(sequence),
            "observationsReparsed": observations,
            "forbiddenOutcomeColumnsAbsent": True,
            "snapshotSequenceReproduced": True,
            "reportMutationRejected": mutation_rejected,
        },
        "snapshots": len(sequence),
        "observations": observations,
        "snapshotSequenceSha256": canonical_sha256(sequence),
        "sampleFirstAndLast": sequence[:3] + sequence[-3:],
        "confirmatoryEligible": False,
        "outcomesAccessed": False,
        "productiveGqsModified": False,
    }
    return {**unsigned, "reportSha256": canonical_sha256(unsigned)}


def self_test() -> dict[str, Any]:
    payload = (
        b"ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size\r\n"
        b"TEST|Example Common Stock|N|TEST|N|100\r\n"
        b"File Creation Time: 0101202412:00|||||\r\n"
    )
    header, rows = parse_rows(payload)
    if len(rows) != 1 or first(rows[0], "act_symbol") != "TEST":
        raise VerificationError("independent parser self-test failed")
    gzip_header, gzip_rows = parse_rows(gzip.compress(payload))
    if (gzip_header, gzip_rows) != (header, rows):
        raise VerificationError("independent gzip parser self-test failed")
    return {
        "status": "PASS",
        "header": header,
        "row": rows[0],
        "gzipVariant": "PASS",
    }


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    commands = value.add_subparsers(dest="command", required=True)
    run = commands.add_parser("verify")
    run.add_argument("--report", type=Path, required=True)
    run.add_argument("--output", type=Path, required=True)
    commands.add_parser("self-test")
    return value


def main() -> int:
    args = parser().parse_args()
    if args.command == "self-test":
        result = self_test()
    else:
        output = args.output.expanduser().resolve()
        if output.exists():
            raise VerificationError("refusing to overwrite verification report")
        result = verify(args)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(
            json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
