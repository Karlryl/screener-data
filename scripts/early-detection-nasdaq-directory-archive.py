#!/usr/bin/env python3
"""Capture and parse free Wayback snapshots of Nasdaq symbol directories."""

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
import time
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen


SCHEMA = "early-detection-nasdaq-symbol-directory-archive/v1"
CDX = "https://web.archive.org/cdx/search/cdx"
USER_AGENT = "Karl-Growth-Screener-Research/1.0 (free historical data audit)"
SOURCES = {
    "NASDAQ": "www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt",
    "OTHER_LISTED": "www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt",
}
FILE_TIME_RE = re.compile(r"File Creation Time:\s*(.+)$", re.I)


class CaptureError(RuntimeError):
    """The archive contract or an immutable output invariant failed."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


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


def fetch(url: str, attempts: int = 5) -> bytes:
    error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            request = Request(url, headers={"User-Agent": USER_AGENT})
            with urlopen(request, timeout=90) as response:
                payload = response.read()
                if int(response.status) != 200 or not payload:
                    raise CaptureError(f"unexpected archive response: {response.status}")
                return payload
        except Exception as exc:  # network boundary; retried and then fail-closed
            error = exc
            if attempt < attempts:
                time.sleep(min(2**attempt, 20))
    raise CaptureError(f"download failed after {attempts} attempts: {url}: {error}")


def discover(kind: str, target: str, start_year: int, end_year: int) -> list[dict[str, Any]]:
    query = urlencode(
        {
            "url": target,
            "from": start_year,
            "to": end_year,
            "output": "json",
            "filter": "statuscode:200",
            "collapse": "digest",
            "fl": "timestamp,original,digest,statuscode,mimetype,length",
        }
    )
    payload = json.loads(fetch(f"{CDX}?{query}").decode("utf-8"))
    if not isinstance(payload, list) or len(payload) < 2:
        raise CaptureError(f"no CDX captures found for {kind}")
    header = payload[0]
    expected = ["timestamp", "original", "digest", "statuscode", "mimetype", "length"]
    if header != expected:
        raise CaptureError(f"unexpected CDX header for {kind}: {header}")
    rows: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for values in payload[1:]:
        row = dict(zip(header, values, strict=True))
        key = (str(row["timestamp"]), str(row["original"]), str(row["digest"]))
        if key in seen:
            continue
        seen.add(key)
        timestamp = str(row["timestamp"])
        if not re.fullmatch(r"\d{14}", timestamp):
            raise CaptureError(f"invalid CDX timestamp: {timestamp}")
        rows.append(
            {
                "kind": kind,
                **row,
                "waybackUrl": f"https://web.archive.org/web/{timestamp}id_/{row['original']}",
            }
        )
    return sorted(rows, key=lambda item: (item["timestamp"], item["original"], item["digest"]))


def decode(payload: bytes) -> str:
    for encoding in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return payload.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise CaptureError("symbol-directory payload cannot be decoded")


def logical_payload(payload: bytes) -> tuple[bytes, str]:
    if payload.startswith(b"\x1f\x8b"):
        try:
            return gzip.decompress(payload), "gzip"
        except (OSError, EOFError) as exc:
            raise CaptureError(f"invalid gzip symbol-directory payload: {exc}") from exc
    return payload, "identity"


def normalized_header(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")


def parse_directory(kind: str, payload: bytes) -> tuple[list[str], list[dict[str, str]], str | None]:
    content, _ = logical_payload(payload)
    text = decode(content).replace("\x00", "")
    lines = [line for line in text.splitlines() if line.strip()]
    if len(lines) < 3 or "|" not in lines[0]:
        raise CaptureError(f"invalid {kind} symbol-directory payload")
    reader = csv.reader(io.StringIO("\n".join(lines)), delimiter="|")
    raw_header = next(reader)
    header = [normalized_header(value) for value in raw_header]
    if len(set(header)) != len(header) or "security_name" not in header:
        raise CaptureError(f"invalid {kind} directory header: {raw_header}")
    symbol_candidates = (
        ("symbol", "nasdaq_symbol") if kind == "NASDAQ" else ("act_symbol", "cqs_symbol", "nasdaq_symbol")
    )
    if not any(value in header for value in symbol_candidates):
        raise CaptureError(f"missing symbol field in {kind} directory")
    rows: list[dict[str, str]] = []
    file_creation_time = None
    for raw in reader:
        if not raw:
            continue
        joined = "|".join(raw).strip()
        match = FILE_TIME_RE.search(raw[0].strip())
        if match:
            file_creation_time = match.group(1).strip()
            continue
        if len(raw) != len(header):
            raise CaptureError(
                f"{kind} row has {len(raw)} fields; expected {len(header)}: {joined[:120]}"
            )
        row = {name: value.strip() for name, value in zip(header, raw, strict=True)}
        if not any(row.values()):
            continue
        rows.append(row)
    if not rows:
        raise CaptureError(f"empty {kind} directory")
    return raw_header, rows, file_creation_time


def get_first(row: dict[str, str], names: tuple[str, ...]) -> str | None:
    for name in names:
        value = row.get(name)
        if value:
            return value
    return None


def store_blob(root: Path, payload: bytes) -> tuple[Path, str]:
    digest = hashlib.sha256(payload).hexdigest()
    path = root / "blobs" / "sha256" / digest[:2] / f"{digest}.txt"
    if path.exists():
        if file_sha256(path) != digest:
            raise CaptureError(f"existing blob hash mismatch: {path}")
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)
    return path.resolve(), digest


def create_database(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        PRAGMA foreign_keys=ON;
        CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE snapshots(
          snapshot_id INTEGER PRIMARY KEY,kind TEXT NOT NULL,capture_timestamp TEXT NOT NULL,
          original_url TEXT NOT NULL,wayback_url TEXT NOT NULL,cdx_digest TEXT NOT NULL,
          cdx_mimetype TEXT,cdx_length INTEGER,payload_path TEXT NOT NULL,
          payload_sha256 TEXT NOT NULL,payload_bytes INTEGER NOT NULL,row_count INTEGER NOT NULL,
          file_creation_time TEXT,header_json TEXT NOT NULL,
          UNIQUE(kind,capture_timestamp,original_url,cdx_digest)
        );
        CREATE TABLE observations(
          snapshot_id INTEGER NOT NULL REFERENCES snapshots(snapshot_id),source_row INTEGER NOT NULL,
          symbol TEXT NOT NULL,security_name TEXT NOT NULL,exchange_code TEXT,market_category TEXT,
          test_issue TEXT,financial_status TEXT,etf TEXT,round_lot_size TEXT,cqs_symbol TEXT,
          nasdaq_symbol TEXT,next_shares TEXT,raw_json TEXT NOT NULL,
          PRIMARY KEY(snapshot_id,source_row)
        );
        CREATE INDEX observations_symbol_snapshot ON observations(symbol,snapshot_id);
        CREATE INDEX observations_exchange_snapshot ON observations(exchange_code,snapshot_id,symbol);
        """
    )
    return connection


def build(args: argparse.Namespace) -> dict[str, Any]:
    producer = Path(__file__).resolve()
    output_database = args.output_database.expanduser().resolve()
    output_report = args.output_report.expanduser().resolve()
    store_root = args.store_root.expanduser().resolve()
    if output_database.exists() or output_report.exists():
        raise CaptureError("refusing to overwrite archive artifacts")
    discovered = [
        row
        for kind, target in SOURCES.items()
        for row in discover(kind, target, args.start_year, args.end_year)
    ]
    if not discovered:
        raise CaptureError("archive discovery returned no snapshots")
    connection = create_database(output_database)
    snapshot_evidence: list[dict[str, Any]] = []
    year_counts: dict[str, int] = {}
    total_rows = 0
    try:
        for snapshot_id, item in enumerate(discovered, start=1):
            payload = fetch(str(item["waybackUrl"]))
            blob_path, payload_hash = store_blob(store_root, payload)
            raw_header, rows, file_creation_time = parse_directory(item["kind"], payload)
            connection.execute(
                "INSERT INTO snapshots VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    snapshot_id,
                    item["kind"],
                    item["timestamp"],
                    item["original"],
                    item["waybackUrl"],
                    item["digest"],
                    item.get("mimetype"),
                    int(item["length"]) if str(item.get("length", "")).isdigit() else None,
                    str(blob_path),
                    payload_hash,
                    len(payload),
                    len(rows),
                    file_creation_time,
                    json.dumps(raw_header, ensure_ascii=False, separators=(",", ":")),
                ),
            )
            for source_row, row in enumerate(rows, start=1):
                symbol = get_first(
                    row,
                    ("symbol", "act_symbol", "nasdaq_symbol", "cqs_symbol"),
                )
                if not symbol:
                    raise CaptureError(f"blank symbol in snapshot {snapshot_id}, row {source_row}")
                connection.execute(
                    "INSERT INTO observations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        snapshot_id,
                        source_row,
                        symbol,
                        row["security_name"],
                        get_first(row, ("exchange",)),
                        get_first(row, ("market_category",)),
                        get_first(row, ("test_issue",)),
                        get_first(row, ("financial_status",)),
                        get_first(row, ("etf",)),
                        get_first(row, ("round_lot_size",)),
                        get_first(row, ("cqs_symbol",)),
                        get_first(row, ("nasdaq_symbol",)),
                        get_first(row, ("nextshares", "next_shares")),
                        json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
                    ),
                )
            year = str(item["timestamp"])[:4]
            year_counts[year] = year_counts.get(year, 0) + 1
            total_rows += len(rows)
            snapshot_evidence.append(
                {
                    "snapshotId": snapshot_id,
                    "kind": item["kind"],
                    "captureTimestamp": item["timestamp"],
                    "originalUrl": item["original"],
                    "waybackUrl": item["waybackUrl"],
                    "cdxDigest": item["digest"],
                    "payloadPath": str(blob_path),
                    "payloadSha256": payload_hash,
                    "payloadBytes": len(payload),
                    "contentEncoding": logical_payload(payload)[1],
                    "rows": len(rows),
                    "fileCreationTime": file_creation_time,
                    "header": raw_header,
                }
            )
            if snapshot_id % 10 == 0:
                connection.commit()
                print(
                    json.dumps(
                        {"capturedSnapshots": snapshot_id, "observations": total_rows},
                        separators=(",", ":"),
                    ),
                    flush=True,
                )
            time.sleep(args.delay_seconds)
        connection.executemany(
            "INSERT INTO meta VALUES(?,?)",
            (
                ("schema", SCHEMA),
                ("producerScriptSha256", file_sha256(producer)),
                ("startYear", str(args.start_year)),
                ("endYear", str(args.end_year)),
            ),
        )
        connection.commit()
        if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise CaptureError("output database integrity check failed")
        observed_snapshots = int(connection.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0])
        observed_rows = int(connection.execute("SELECT COUNT(*) FROM observations").fetchone()[0])
    finally:
        connection.close()
    if observed_snapshots != len(discovered) or observed_rows != total_rows:
        raise CaptureError("output database counts do not match captured evidence")
    by_kind: dict[str, int] = {}
    for item in snapshot_evidence:
        by_kind[item["kind"]] = by_kind.get(item["kind"], 0) + 1
    unsigned = {
        "schema": SCHEMA,
        "generatedAt": utc_now(),
        "status": "ARCHIVE_SNAPSHOT_EVIDENCE_COMPLETE",
        "producerScript": str(producer),
        "producerScriptSha256": file_sha256(producer),
        "cdxEndpoint": CDX,
        "sourceDefinitions": SOURCES,
        "period": {"startYear": args.start_year, "endYear": args.end_year},
        "discoveryContract": {
            "statusCode": 200,
            "collapse": "digest",
            "note": "Wayback availability is sparse and snapshots are positive as-of states, not exact effective-date intervals.",
        },
        "database": str(output_database),
        "databaseBytes": output_database.stat().st_size,
        "databaseSha256": file_sha256(output_database),
        "storeRoot": str(store_root),
        "snapshots": len(snapshot_evidence),
        "observations": total_rows,
        "snapshotsByKind": dict(sorted(by_kind.items())),
        "snapshotsByYear": dict(sorted(year_counts.items())),
        "snapshotSequenceSha256": canonical_sha256(snapshot_evidence),
        "snapshotEvidence": snapshot_evidence,
        "limitations": [
            "Archive snapshots prove positive directory presence only at captured as-of states.",
            "Sparse captures cannot establish exact first or final trading dates or continuous presence between snapshots.",
            "Nasdaq directory symbols are not permanent security identifiers and require ticker-reuse adjudication.",
            "Directory snapshots contain no adjusted OHLCV or delisting returns.",
        ],
        "confirmatoryEligible": False,
        "resultComputationAllowed": False,
        "outcomesAccessed": False,
        "productiveGqsModified": False,
    }
    result = {**unsigned, "reportSha256": canonical_sha256(unsigned)}
    output_report.parent.mkdir(parents=True, exist_ok=True)
    output_report.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return result


def self_test() -> dict[str, Any]:
    payload = (
        b"Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size\r\n"
        b"TEST|Example Common Stock|Q|N|N|100\r\n"
        b"File Creation Time: 0101202412:00|||||\r\n"
    )
    header, rows, created = parse_directory("NASDAQ", payload)
    if len(rows) != 1 or rows[0]["symbol"] != "TEST" or created != "0101202412:00":
        raise CaptureError("directory parser self-test failed")
    gzip_header, gzip_rows, gzip_created = parse_directory("NASDAQ", gzip.compress(payload))
    if (gzip_header, gzip_rows, gzip_created) != (header, rows, created):
        raise CaptureError("gzip directory parser self-test failed")
    return {
        "status": "PASS",
        "header": header,
        "row": rows[0],
        "fileCreationTime": created,
        "gzipVariant": "PASS",
    }


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    commands = value.add_subparsers(dest="command", required=True)
    run = commands.add_parser("run")
    run.add_argument("--start-year", type=int, default=2009)
    run.add_argument("--end-year", type=int, default=2024)
    run.add_argument("--store-root", type=Path, required=True)
    run.add_argument("--output-database", type=Path, required=True)
    run.add_argument("--output-report", type=Path, required=True)
    run.add_argument("--delay-seconds", type=float, default=0.25)
    commands.add_parser("self-test")
    return value


def main() -> int:
    args = parser().parse_args()
    result = self_test() if args.command == "self-test" else build(args)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
