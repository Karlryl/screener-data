#!/usr/bin/env python3
"""Acquire digest-verified historical Nasdaq symbol-directory snapshots.

The public files are current-state snapshots, not an event ledger.  Archived
captures can therefore prove presence only at their exact capture time.  This
adapter keeps the raw exchange payload and Wayback digest append-only and never
fills a missing quarter from a later snapshot.
"""

from __future__ import annotations

import argparse
import base64
import csv
import gzip
import hashlib
import importlib.util
import io
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from types import ModuleType
from typing import Any


CDX_BASE = "https://web.archive.org/cdx/search/cdx"
REPLAY_BASE = "https://web.archive.org/web/"
DEFAULT_USER_AGENT = "Growth-Screener-Research/1.0 contact=https://github.com/Karlryl/screener-data"
DATASETS = {
    "nasdaqlisted": "nasdaqlisted.txt",
    "otherlisted": "otherlisted.txt",
}
RESULT_SCHEMA = "early-detection-nasdaq-symbol-directory-batch/v1"


class NasdaqSymbolError(RuntimeError):
    """A Nasdaq symbol-directory capture failed its evidence contract."""


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def signed_report(value: dict[str, Any]) -> dict[str, Any]:
    return {**value, "reportSha256": hashlib.sha256(canonical_bytes(value)).hexdigest()}


def write_report_once(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(report, ensure_ascii=False, indent=2).encode("utf-8") + b"\n"
    if path.exists():
        if path.read_bytes() != payload:
            raise NasdaqSymbolError(f"report path already contains different bytes: {path}")
        return
    with path.open("xb") as handle:
        handle.write(payload)


def load_foundation() -> ModuleType:
    path = Path(__file__).resolve().with_name("early-detection-foundation.py")
    spec = importlib.util.spec_from_file_location("early_detection_foundation_nasdaq", path)
    if spec is None or spec.loader is None:
        raise NasdaqSymbolError(f"cannot load foundation module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fetch_bytes(url: str, user_agent: str, timeout: int, retries: int) -> tuple[bytes, dict[str, str]]:
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": user_agent, "Accept-Encoding": "identity"})
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read(), {key.lower(): value for key, value in response.headers.items()}
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
        if attempt < retries:
            time.sleep(min(8.0, 1.0 * (2 ** attempt)))
    raise NasdaqSymbolError(f"download failed after {retries + 1} attempts: {url}: {last_error}")


def cdx_url(filename: str, from_year: int, to_year: int) -> str:
    original = f"http://www.nasdaqtrader.com/dynamic/SymDir/{filename}"
    return CDX_BASE + "?" + urllib.parse.urlencode({
        "url": original,
        "output": "json",
        "filter": "statuscode:200",
        "fl": "timestamp,original,mimetype,statuscode,digest,length",
        "collapse": "digest",
        "from": str(from_year),
        "to": str(to_year),
        "limit": "1000",
    })


def parse_cdx(payload: bytes) -> list[dict[str, Any]]:
    try:
        rows = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise NasdaqSymbolError("Wayback CDX response is not UTF-8 JSON") from exc
    expected = ["timestamp", "original", "mimetype", "statuscode", "digest", "length"]
    if not isinstance(rows, list) or not rows or rows[0] != expected:
        raise NasdaqSymbolError("Wayback CDX columns changed")
    result: list[dict[str, Any]] = []
    for values in rows[1:]:
        if not isinstance(values, list) or len(values) != len(expected):
            raise NasdaqSymbolError("invalid Wayback CDX row")
        row = dict(zip(expected, values))
        if not re.fullmatch(r"20\d{12}", str(row["timestamp"])) or row["statuscode"] != "200":
            continue
        row["length"] = int(row["length"])
        result.append(row)
    return result


def capture_quarter(timestamp: str) -> str:
    parsed = datetime.strptime(timestamp, "%Y%m%d%H%M%S")
    return f"{parsed.year}q{(parsed.month - 1) // 3 + 1}"


def select_last_capture_per_quarter(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[capture_quarter(str(row["timestamp"]))].append(row)
    return [max(grouped[quarter], key=lambda row: str(row["timestamp"])) for quarter in sorted(grouped)]


def sha1_base32(payload: bytes) -> str:
    return base64.b32encode(hashlib.sha1(payload).digest()).decode("ascii").rstrip("=")


def replay_url(row: dict[str, Any]) -> str:
    return f"{REPLAY_BASE}{row['timestamp']}id_/{row['original']}"


def observed_at(timestamp: str) -> str:
    value = datetime.strptime(timestamp, "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
    return value.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_directory(payload: bytes, dataset: str) -> dict[str, Any]:
    decoded_payload = payload
    transport_compression = None
    if payload.startswith(b"\x1f\x8b"):
        try:
            decoded_payload = gzip.decompress(payload)
        except (EOFError, OSError) as exc:
            raise NasdaqSymbolError(f"{dataset} gzip transport decoding failed: {exc}") from exc
        transport_compression = "gzip"
    text = decoded_payload.decode("utf-8-sig", errors="replace")
    try:
        rows = list(csv.reader(io.StringIO(text, newline=""), delimiter="|"))
    except csv.Error as exc:
        raise NasdaqSymbolError(f"symbol-directory CSV parsing failed: {exc}") from exc
    if len(rows) < 2:
        raise NasdaqSymbolError(f"{dataset} payload has no data rows")
    header = [value.strip() for value in rows[0]]
    required = {"Security Name", "Test Issue"}
    if dataset == "nasdaqlisted":
        symbol_column = "Symbol"
    elif "ACT Symbol" in header:
        symbol_column = "ACT Symbol"
    else:
        symbol_column = "Symbol"
    required.add(symbol_column)
    if not required.issubset(set(header)):
        raise NasdaqSymbolError(f"{dataset} required columns missing: {header}")
    footer = None
    data_rows: list[list[str]] = []
    for row in rows[1:]:
        if row and row[0].startswith("File Creation Time"):
            footer = row[0].strip()
            continue
        if not row or not any(value.strip() for value in row):
            continue
        if len(row) != len(header):
            raise NasdaqSymbolError(f"{dataset} row width changed: {len(row)} != {len(header)}")
        data_rows.append(row)
    if not data_rows:
        raise NasdaqSymbolError(f"{dataset} payload contains no securities")
    symbol_index = header.index(symbol_column)
    symbols = [row[symbol_index].strip() for row in data_rows]
    if any(not symbol for symbol in symbols) or len(symbols) != len(set(symbols)):
        raise NasdaqSymbolError(f"{dataset} contains blank or duplicate primary symbols")
    return {
        "header": header,
        "primarySymbolColumn": symbol_column,
        "rows": len(data_rows),
        "distinctSymbols": len(set(symbols)),
        "fileCreationTimeRaw": footer,
        "transportCompression": transport_compression,
        "decodedBytes": len(decoded_payload),
    }


def write_or_reuse_observation(foundation: ModuleType, path: Path, observation: dict[str, Any]) -> bool:
    """Reuse a raw capture when only derived parser/query metadata evolved."""
    if not path.exists():
        foundation.write_observation_once(path, observation)
        return True
    try:
        current = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise NasdaqSymbolError(f"existing Nasdaq observation is invalid: {path}") from exc
    identity_fields = (
        "schema", "sourceClass", "sourceId", "sourceUrl", "originalSourceUrl", "observedAt",
        "observedAtEvidence", "payloadSha256", "payloadSha1Base32", "payloadBytes", "payloadPath",
        "qualityState",
    )
    if any(current.get(key) != observation.get(key) for key in identity_fields):
        raise NasdaqSymbolError(f"append-only Nasdaq observation identity collision at {path}")
    current_archive = current.get("archiveEvidence", {})
    new_archive = observation.get("archiveEvidence", {})
    for key in ("provider", "captureTimestamp", "captureDigestSha1Base32", "captureLengthIncludingArchiveRecord"):
        if current_archive.get(key) != new_archive.get(key):
            raise NasdaqSymbolError(f"append-only Nasdaq archive evidence collision at {path}")
    return False


def cached_observation_index(data_root: Path, dataset: str) -> dict[str, dict[str, Any]]:
    root = data_root / "observations" / "nasdaq-symbol-directory" / dataset
    index: dict[str, dict[str, Any]] = {}
    if not root.exists():
        return index
    for path in sorted(root.glob("*.json")):
        try:
            observation = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise NasdaqSymbolError(f"cached Nasdaq observation is invalid: {path}") from exc
        archive = observation.get("archiveEvidence", {})
        timestamp = str(archive.get("captureTimestamp", ""))
        if not re.fullmatch(r"\d{14}", timestamp):
            raise NasdaqSymbolError(f"cached Nasdaq observation has invalid capture timestamp: {path}")
        if observation.get("sourceId") != dataset:
            raise NasdaqSymbolError(f"cached Nasdaq observation dataset mismatch: {path}")
        if timestamp in index and index[timestamp].get("payloadSha256") != observation.get("payloadSha256"):
            raise NasdaqSymbolError(f"conflicting cached Nasdaq observations for {dataset} {timestamp}")
        index[timestamp] = observation
    return index


def validate_cached_capture(
    data_root: Path,
    dataset: str,
    row: dict[str, Any],
    observation: dict[str, Any],
) -> tuple[bytes, dict[str, Any]]:
    archive = observation.get("archiveEvidence", {})
    if archive.get("captureDigestSha1Base32") != row["digest"]:
        raise NasdaqSymbolError(
            f"cached CDX digest mismatch for {dataset} {row['timestamp']}"
        )
    relative = observation.get("payloadPath")
    if not isinstance(relative, str) or not relative:
        raise NasdaqSymbolError(f"cached Nasdaq payload path missing for {dataset} {row['timestamp']}")
    blob_path = data_root / Path(relative)
    try:
        payload = blob_path.read_bytes()
    except OSError as exc:
        raise NasdaqSymbolError(f"cached Nasdaq payload is unreadable: {blob_path}") from exc
    actual_sha256 = hashlib.sha256(payload).hexdigest()
    actual_sha1 = sha1_base32(payload)
    if actual_sha256 != observation.get("payloadSha256"):
        raise NasdaqSymbolError(f"cached Nasdaq SHA-256 mismatch: {blob_path}")
    if actual_sha1 != row["digest"] or actual_sha1 != observation.get("payloadSha1Base32"):
        raise NasdaqSymbolError(f"cached Nasdaq Wayback SHA1 mismatch: {blob_path}")
    if len(payload) != observation.get("payloadBytes"):
        raise NasdaqSymbolError(f"cached Nasdaq byte-length mismatch: {blob_path}")
    return payload, parse_directory(payload, dataset)


def acquire(
    data_root: Path,
    from_year: int,
    to_year: int,
    user_agent: str,
    timeout: int,
    retries: int,
    sleep_ms: int,
) -> dict[str, Any]:
    if from_year > to_year:
        raise NasdaqSymbolError("from-year must not be after to-year")
    planned_path = (
        data_root
        / "observations"
        / "nasdaq-symbol-directory"
        / "nasdaqlisted"
        / ("2024-12-31T23-59-59-000Z-" + "f" * 64 + ".json")
    )
    if os.name == "nt" and len(str(planned_path.resolve())) >= 248:
        raise NasdaqSymbolError(
            "data-root is too deep for a fail-safe Windows observation path: "
            f"planned path has {len(str(planned_path.resolve()))} characters"
        )
    foundation = load_foundation()
    completed: list[dict[str, Any]] = []
    failed: list[dict[str, str]] = []
    cdx_manifests: list[dict[str, Any]] = []
    captured_quarters: dict[str, set[str]] = {dataset: set() for dataset in DATASETS}
    for dataset, filename in DATASETS.items():
        cache_index = cached_observation_index(data_root, dataset)
        query_url = cdx_url(filename, from_year, to_year)
        cdx_payload, _ = fetch_bytes(query_url, user_agent, timeout, retries)
        rows = parse_cdx(cdx_payload)
        selected = select_last_capture_per_quarter(rows)
        cdx_manifests.append({
            "dataset": dataset,
            "queryUrl": query_url,
            "querySha256": hashlib.sha256(cdx_payload).hexdigest(),
            "distinctCaptures": len(rows),
            "selectedQuarterCaptures": len(selected),
        })
        for row in selected:
            timestamp = str(row["timestamp"])
            quarter = capture_quarter(timestamp)
            url = replay_url(row)
            try:
                cached = cache_index.get(timestamp)
                if cached is not None:
                    payload, parsed = validate_cached_capture(data_root, dataset, row, cached)
                    captured_quarters[dataset].add(quarter)
                    completed.append({
                        "dataset": dataset,
                        "captureQuarter": quarter,
                        "captureTimestamp": timestamp,
                        "rows": parsed["rows"],
                        "payloadBytes": len(payload),
                        "payloadSha256": cached["payloadSha256"],
                        "transportCompression": parsed["transportCompression"],
                        "blobCreated": False,
                        "observationCreated": False,
                        "cacheReused": True,
                    })
                    continue
                payload, headers = fetch_bytes(url, user_agent, timeout, retries)
                actual_sha1 = sha1_base32(payload)
                if actual_sha1 != row["digest"]:
                    raise NasdaqSymbolError(
                        f"CDX payload digest mismatch: expected={row['digest']} actual={actual_sha1}"
                    )
                parsed = parse_directory(payload, dataset)
                digest, relative, blob_created = foundation.store_blob(data_root, ".txt", payload)
                observation = {
                    "schema": foundation.OBSERVATION_SCHEMA,
                    "sourceClass": "nasdaq_symbol_directory_snapshot",
                    "sourceId": dataset,
                    "sourceUrl": url,
                    "originalSourceUrl": str(row["original"]),
                    "observedAt": observed_at(timestamp),
                    "observedAtEvidence": "wayback_cdx_capture_timestamp",
                    "captureQuarter": quarter,
                    "payloadSha256": digest,
                    "payloadSha1Base32": actual_sha1,
                    "payloadBytes": len(payload),
                    "payloadPath": relative.as_posix(),
                    "responseHeaders": headers,
                    "qualityState": "accepted_exact_capture",
                    "directory": parsed,
                    "archiveEvidence": {
                        "provider": "Internet Archive Wayback Machine",
                        "cdxQueryUrl": query_url,
                        "cdxQuerySha256": hashlib.sha256(cdx_payload).hexdigest(),
                        "captureTimestamp": timestamp,
                        "captureDigestSha1Base32": str(row["digest"]),
                        "captureLengthIncludingArchiveRecord": int(row["length"]),
                    },
                }
                token = foundation.safe_token(observation["observedAt"])
                path = data_root / "observations" / "nasdaq-symbol-directory" / dataset / f"{token}-{digest}.json"
                observation_created = write_or_reuse_observation(foundation, path, observation)
                captured_quarters[dataset].add(quarter)
                completed.append({
                    "dataset": dataset,
                    "captureQuarter": quarter,
                    "captureTimestamp": timestamp,
                    "rows": parsed["rows"],
                    "payloadBytes": len(payload),
                    "payloadSha256": digest,
                    "transportCompression": parsed["transportCompression"],
                    "blobCreated": blob_created,
                    "observationCreated": observation_created,
                    "cacheReused": False,
                })
            except (NasdaqSymbolError, OSError, foundation.FoundationError) as exc:
                failed.append({"dataset": dataset, "captureTimestamp": timestamp, "error": str(exc)})
            if sleep_ms:
                time.sleep(sleep_ms / 1000)
    expected = [
        f"{year}q{quarter}"
        for year in range(from_year, to_year + 1)
        for quarter in range(1, 5)
    ]
    missing = [
        {"dataset": dataset, "quarter": quarter, "reason": "NO_CAPTURE_IN_QUARTER"}
        for dataset in DATASETS
        for quarter in expected
        if quarter not in captured_quarters[dataset]
    ]
    unsigned = {
        "schema": RESULT_SCHEMA,
        "generatedAt": utc_now(),
        "status": "PASS" if not failed and not missing else "PARTIAL",
        "fromYear": from_year,
        "toYear": to_year,
        "completed": completed,
        "failed": failed,
        "missing": missing,
        "cdxManifests": cdx_manifests,
        "interpretation": "Each snapshot proves symbol-directory state only at its exact capture timestamp; missing quarters are never forward-filled.",
    }
    return signed_report(unsigned)


def self_test() -> dict[str, Any]:
    payload = (
        b"Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF\r\n"
        b"ABCD|Example Corp|Q|N|N|100|N\r\n"
        b"File Creation Time: 0101201217:00||||||\r\n"
    )
    parsed = parse_directory(payload, "nasdaqlisted")
    if parsed["rows"] != 1 or parsed["distinctSymbols"] != 1:
        raise NasdaqSymbolError("directory parsing self-test failed")
    compressed = gzip.compress(payload, mtime=0)
    parsed_compressed = parse_directory(compressed, "nasdaqlisted")
    if (
        parsed_compressed["rows"] != 1
        or parsed_compressed["transportCompression"] != "gzip"
        or parsed_compressed["decodedBytes"] != len(payload)
    ):
        raise NasdaqSymbolError("gzip transport parsing self-test failed")
    historical_other = (
        b"Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue\r\n"
        b"WXYZ|Other Corp|N|WXYZ|N|100|N\r\n"
    )
    if parse_directory(historical_other, "otherlisted")["primarySymbolColumn"] != "Symbol":
        raise NasdaqSymbolError("historical Other Listed symbol alias self-test failed")
    rows = [
        {"timestamp": "20120101000000"},
        {"timestamp": "20120331000000"},
        {"timestamp": "20120401000000"},
    ]
    selected = select_last_capture_per_quarter(rows)
    if [row["timestamp"] for row in selected] != ["20120331000000", "20120401000000"]:
        raise NasdaqSymbolError("quarter selection self-test failed")
    signed = signed_report({"schema": "fixture", "value": 1})
    if signed["reportSha256"] != hashlib.sha256(
        canonical_bytes({"schema": "fixture", "value": 1})
    ).hexdigest():
        raise NasdaqSymbolError("signed report self-test failed")
    return {
        "schema": "early-detection-nasdaq-symbol-directory-self-test/v1",
        "status": "PASS",
        "rows": parsed["rows"],
        "selectedCaptures": len(selected),
        "payloadSha1Base32": sha1_base32(payload),
        "historicalOtherListedAlias": True,
        "gzipTransportVerified": True,
        "signedReportVerified": True,
    }


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    commands = value.add_subparsers(dest="command", required=True)
    acquire_parser = commands.add_parser("acquire")
    acquire_parser.add_argument("--data-root", required=True)
    acquire_parser.add_argument("--from-year", type=int, required=True)
    acquire_parser.add_argument("--to-year", type=int, required=True)
    acquire_parser.add_argument("--user-agent", default=DEFAULT_USER_AGENT)
    acquire_parser.add_argument("--timeout", type=int, default=120)
    acquire_parser.add_argument("--retries", type=int, default=2)
    acquire_parser.add_argument("--sleep-ms", type=int, default=1000)
    acquire_parser.add_argument("--report", type=Path)
    commands.add_parser("self-test")
    return value


def main() -> int:
    args = parser().parse_args()
    if args.command == "self-test":
        result = self_test()
    else:
        result = acquire(
            Path(args.data_root).resolve(), args.from_year, args.to_year,
            args.user_agent, args.timeout, args.retries, args.sleep_ms,
        )
        if args.report is not None:
            write_report_once(args.report.expanduser().resolve(), result)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0 if result["status"] in {"PASS", "PARTIAL"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
