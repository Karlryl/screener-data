#!/usr/bin/env python3
"""Acquire historical SEC CIK/name/ticker(/exchange) snapshots fail closed.

Each digest-addressed archive capture proves the official SEC mapping only at
its exact timestamp. Missing quarters are never filled and current identifiers
are never projected backward.
"""

from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import importlib.util
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from types import ModuleType
from typing import Any


SCHEMA = "early-detection-sec-company-ticker-snapshot-batch/v1"
DEFAULT_USER_AGENT = "GrowthScreenerResearch/1.0 research@example.invalid"
CDX_BASE = "https://web.archive.org/cdx/search/cdx"
REPLAY_BASE = "https://web.archive.org/web/"
SOURCES = {
    "company_tickers": "https://www.sec.gov/files/company_tickers.json",
    "company_tickers_exchange": "https://www.sec.gov/files/company_tickers_exchange.json",
}


class SecTickerError(RuntimeError):
    """Historical SEC ticker evidence failed a deterministic contract."""


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def signed_report(value: dict[str, Any]) -> dict[str, Any]:
    return {**value, "reportSha256": hashlib.sha256(canonical_bytes(value)).hexdigest()}


def write_report_once(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(report, ensure_ascii=False, indent=2).encode("utf-8") + b"\n"
    if path.exists():
        if path.read_bytes() != payload:
            raise SecTickerError(f"signed report already exists with different bytes: {path}")
        return
    path.write_bytes(payload)


def load_foundation() -> ModuleType:
    path = Path(__file__).with_name("early-detection-foundation.py")
    spec = importlib.util.spec_from_file_location("early_detection_foundation", path)
    if spec is None or spec.loader is None:
        raise SecTickerError(f"cannot load foundation adapter: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fetch_bytes(url: str, user_agent: str, timeout: int, retries: int) -> tuple[bytes, dict[str, str]]:
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": user_agent})
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read(), {key.lower(): value for key, value in response.headers.items()}
        except (OSError, urllib.error.URLError, urllib.error.HTTPError) as exc:
            last_error = exc
            if attempt < retries:
                time.sleep(min(2 ** attempt, 8))
    raise SecTickerError(f"download failed after {retries + 1} attempts: {url}: {last_error}")


def cdx_url(source_url: str, from_year: int, to_year: int) -> str:
    return f"{CDX_BASE}?" + urllib.parse.urlencode({
        "url": source_url, "output": "json", "filter": "statuscode:200",
        "fl": "timestamp,original,mimetype,statuscode,digest,length",
        "collapse": "digest", "from": str(from_year), "to": str(to_year), "limit": "1000",
    })


def parse_cdx(payload: bytes) -> list[dict[str, Any]]:
    try:
        rows = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SecTickerError("Wayback CDX response is not valid JSON") from exc
    expected = ["timestamp", "original", "mimetype", "statuscode", "digest", "length"]
    if not isinstance(rows, list) or not rows or rows[0] != expected:
        raise SecTickerError("Wayback CDX schema changed")
    result: list[dict[str, Any]] = []
    for values in rows[1:]:
        if not isinstance(values, list) or len(values) != len(expected):
            raise SecTickerError("Wayback CDX row width changed")
        row = dict(zip(expected, values))
        if not re.fullmatch(r"\d{14}", str(row["timestamp"])):
            raise SecTickerError("Wayback CDX timestamp is invalid")
        digest = str(row["digest"])
        if str(row["statuscode"]) != "200" or not (
            re.fullmatch(r"[A-Z2-7]+", digest) or re.fullmatch(r"[0-9a-fA-F]{40}", digest)
        ):
            raise SecTickerError("Wayback CDX status or digest is invalid")
        row["length"] = int(row["length"])
        result.append(row)
    return result


def capture_quarter(timestamp: str) -> str:
    value = datetime.strptime(timestamp, "%Y%m%d%H%M%S")
    return f"{value.year}q{((value.month - 1) // 3) + 1}"


def select_last_capture_per_quarter(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    selected: dict[str, dict[str, Any]] = {}
    for row in rows:
        key = capture_quarter(str(row["timestamp"]))
        if key not in selected or str(row["timestamp"]) > str(selected[key]["timestamp"]):
            selected[key] = row
    return [selected[key] for key in sorted(selected)]


def sha1_base32(payload: bytes) -> str:
    return base64.b32encode(hashlib.sha1(payload).digest()).decode("ascii").rstrip("=")


def archive_digest_matches(payload: bytes, digest: str) -> bool:
    if re.fullmatch(r"[A-Z2-7]+", digest):
        return sha1_base32(payload) == digest
    if re.fullmatch(r"[0-9a-fA-F]{40}", digest):
        return hashlib.sha1(payload).hexdigest() == digest.lower()
    return False


def decode_transport(payload: bytes) -> tuple[bytes, str | None]:
    if not payload.startswith(b"\x1f\x8b"):
        return payload, None
    try:
        return gzip.decompress(payload), "gzip"
    except (EOFError, OSError) as exc:
        raise SecTickerError(f"SEC ticker gzip transport decoding failed: {exc}") from exc


def parse_snapshot(payload: bytes, source_id: str) -> dict[str, Any]:
    decoded, compression = decode_transport(payload)
    try:
        value = json.loads(decoded.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SecTickerError(f"{source_id} payload is not valid JSON") from exc
    records: list[dict[str, Any]] = []
    if source_id == "company_tickers":
        if not isinstance(value, dict):
            raise SecTickerError("company_tickers root is not an object")
        for key in sorted(value, key=lambda item: int(item)):
            row = value[key]
            if not isinstance(row, dict) or not {"cik_str", "ticker", "title"}.issubset(row):
                raise SecTickerError("company_tickers row contract changed")
            records.append({"cik": int(row["cik_str"]), "name": str(row["title"]), "ticker": str(row["ticker"]), "exchange": None})
    elif source_id == "company_tickers_exchange":
        if not isinstance(value, dict) or not isinstance(value.get("fields"), list) or not isinstance(value.get("data"), list):
            raise SecTickerError("company_tickers_exchange root contract changed")
        fields = list(value["fields"])
        if not {"cik", "name", "ticker", "exchange"}.issubset(fields):
            raise SecTickerError(f"company_tickers_exchange fields changed: {fields}")
        for values in value["data"]:
            if not isinstance(values, list) or len(values) != len(fields):
                raise SecTickerError("company_tickers_exchange row width changed")
            row = dict(zip(fields, values))
            records.append({"cik": int(row["cik"]), "name": str(row["name"]), "ticker": str(row["ticker"]), "exchange": str(row["exchange"])})
    else:
        raise SecTickerError(f"unsupported SEC ticker source: {source_id}")
    source_rows = len(records)
    deduplicated: list[dict[str, Any]] = []
    by_identity: dict[tuple[int, str, str | None], dict[str, Any]] = {}
    exact_duplicates = 0
    for row in records:
        identity = (row["cik"], row["ticker"], row["exchange"])
        if row["cik"] <= 0 or not row["ticker"]:
            raise SecTickerError(f"{source_id} has a blank or invalid mapping row")
        previous = by_identity.get(identity)
        if previous is None:
            by_identity[identity] = row
            deduplicated.append(row)
        elif previous == row:
            exact_duplicates += 1
        else:
            raise SecTickerError(f"{source_id} has conflicting rows for identity {identity}")
    records = deduplicated
    if not records:
        raise SecTickerError(f"{source_id} has no mapping rows")
    return {
        "records": records, "rows": len(records), "sourceRows": source_rows,
        "exactDuplicateRows": exact_duplicates,
        "distinctCiks": len({row["cik"] for row in records}),
        "distinctTickers": len({row["ticker"] for row in records}),
        "transportCompression": compression, "decodedBytes": len(decoded),
    }


def observed_at(timestamp: str) -> str:
    value = datetime.strptime(timestamp, "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
    return value.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def replay_url(row: dict[str, Any]) -> str:
    return f"{REPLAY_BASE}{row['timestamp']}id_/{row['original']}"


def cached_index(data_root: Path, source_id: str) -> dict[str, dict[str, Any]]:
    root = data_root / "observations" / "sec-company-tickers" / source_id
    result: dict[str, dict[str, Any]] = {}
    if not root.exists():
        return result
    for path in sorted(root.glob("*.json")):
        try:
            observation = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise SecTickerError(f"cached SEC ticker observation is invalid: {path}") from exc
        timestamp = str(observation.get("archiveEvidence", {}).get("captureTimestamp", ""))
        if observation.get("sourceId") != source_id or not re.fullmatch(r"\d{14}", timestamp):
            raise SecTickerError(f"cached SEC ticker observation identity is invalid: {path}")
        if timestamp in result and result[timestamp].get("payloadSha256") != observation.get("payloadSha256"):
            raise SecTickerError(f"conflicting cached SEC ticker observations at {timestamp}")
        result[timestamp] = observation
    return result


def validate_cached(data_root: Path, source_id: str, row: dict[str, Any], observation: dict[str, Any]) -> tuple[bytes, dict[str, Any]]:
    relative = observation.get("payloadPath")
    if not isinstance(relative, str) or not relative:
        raise SecTickerError("cached SEC ticker payload path is missing")
    path = data_root / Path(relative)
    try:
        payload = path.read_bytes()
    except OSError as exc:
        raise SecTickerError(f"cached SEC ticker payload is unreadable: {path}") from exc
    if hashlib.sha256(payload).hexdigest() != observation.get("payloadSha256"):
        raise SecTickerError(f"cached SEC ticker SHA-256 mismatch: {path}")
    if not archive_digest_matches(payload, str(row["digest"])):
        raise SecTickerError(f"cached SEC ticker Wayback SHA1 mismatch: {path}")
    if observation.get("archiveEvidence", {}).get("captureDigest") != row["digest"]:
        raise SecTickerError(f"cached SEC ticker CDX digest identity mismatch: {path}")
    if len(payload) != observation.get("payloadBytes"):
        raise SecTickerError(f"cached SEC ticker byte-length mismatch: {path}")
    return payload, parse_snapshot(payload, source_id)


def acquire(data_root: Path, from_year: int, to_year: int, user_agent: str, timeout: int, retries: int, sleep_ms: int) -> dict[str, Any]:
    if from_year > to_year:
        raise SecTickerError("from-year must not be after to-year")
    planned = data_root / "observations" / "sec-company-tickers" / "company_tickers_exchange" / ("2024-12-31T23-59-59-000Z-" + "f" * 64 + ".json")
    if os.name == "nt" and len(str(planned.resolve())) >= 248:
        raise SecTickerError(f"data-root is too deep for Windows observation paths: {len(str(planned.resolve()))}")
    foundation = load_foundation()
    completed: list[dict[str, Any]] = []
    failed: list[dict[str, str]] = []
    missing: list[dict[str, str]] = []
    manifests: list[dict[str, Any]] = []
    for source_id, source_url in SOURCES.items():
        query_url = cdx_url(source_url, from_year, to_year)
        cdx_payload, _ = fetch_bytes(query_url, user_agent, timeout, retries)
        all_rows = parse_cdx(cdx_payload)
        selected = select_last_capture_per_quarter(all_rows)
        manifests.append({
            "sourceId": source_id, "officialUrl": source_url, "queryUrl": query_url,
            "querySha256": hashlib.sha256(cdx_payload).hexdigest(),
            "distinctCaptures": len(all_rows), "selectedQuarterCaptures": len(selected),
        })
        selected_quarters = {capture_quarter(str(row["timestamp"])) for row in selected}
        missing.extend(
            {"sourceId": source_id, "quarter": f"{year}q{q}", "reason": "NO_CAPTURE_IN_QUARTER"}
            for year in range(from_year, to_year + 1) for q in range(1, 5)
            if f"{year}q{q}" not in selected_quarters
        )
        cache = cached_index(data_root, source_id)
        for row in selected:
            timestamp = str(row["timestamp"])
            capture_q = capture_quarter(timestamp)
            try:
                cached = cache.get(timestamp)
                if cached is not None:
                    payload, parsed = validate_cached(data_root, source_id, row, cached)
                    completed.append({
                        "sourceId": source_id, "captureQuarter": capture_q, "captureTimestamp": timestamp,
                        "rows": parsed["rows"], "payloadBytes": len(payload), "payloadSha256": cached["payloadSha256"],
                        "sourceRows": parsed["sourceRows"], "exactDuplicateRows": parsed["exactDuplicateRows"],
                        "transportCompression": parsed["transportCompression"], "cacheReused": True,
                        "blobCreated": False, "observationCreated": False,
                    })
                    continue
                url = replay_url(row)
                payload, headers = fetch_bytes(url, user_agent, timeout, retries)
                actual_sha1 = sha1_base32(payload)
                if not archive_digest_matches(payload, str(row["digest"])):
                    raise SecTickerError(
                        f"CDX payload digest mismatch: expected={row['digest']} "
                        f"actualBase32={actual_sha1} actualHex={hashlib.sha1(payload).hexdigest()}"
                    )
                parsed = parse_snapshot(payload, source_id)
                digest, relative, blob_created = foundation.store_blob(data_root, ".json", payload)
                observation = {
                    "schema": foundation.OBSERVATION_SCHEMA, "sourceClass": "sec_company_ticker_snapshot",
                    "sourceId": source_id, "sourceUrl": url, "originalSourceUrl": source_url,
                    "observedAt": observed_at(timestamp), "observedAtEvidence": "wayback_cdx_capture_timestamp",
                    "captureQuarter": capture_q, "payloadSha256": digest, "payloadSha1Base32": actual_sha1,
                    "payloadSha1Hex": hashlib.sha1(payload).hexdigest(),
                    "payloadBytes": len(payload), "payloadPath": relative.as_posix(), "responseHeaders": headers,
                    "qualityState": "accepted_exact_capture",
                    "mapping": {key: value for key, value in parsed.items() if key != "records"},
                    "archiveEvidence": {
                        "provider": "Internet Archive Wayback Machine", "officialPublisher": "U.S. Securities and Exchange Commission",
                        "cdxQueryUrl": query_url, "cdxQuerySha256": hashlib.sha256(cdx_payload).hexdigest(),
                        "captureTimestamp": timestamp, "captureDigest": str(row["digest"]),
                        "captureDigestFormat": "base32" if re.fullmatch(r"[A-Z2-7]+", str(row["digest"])) else "hex",
                        "captureLengthIncludingArchiveRecord": int(row["length"]),
                    },
                }
                token = foundation.safe_token(observation["observedAt"])
                path = data_root / "observations" / "sec-company-tickers" / source_id / f"{token}-{digest}.json"
                foundation.write_observation_once(path, observation)
                completed.append({
                    "sourceId": source_id, "captureQuarter": capture_q, "captureTimestamp": timestamp,
                    "rows": parsed["rows"], "payloadBytes": len(payload), "payloadSha256": digest,
                    "sourceRows": parsed["sourceRows"], "exactDuplicateRows": parsed["exactDuplicateRows"],
                    "transportCompression": parsed["transportCompression"], "cacheReused": False,
                    "blobCreated": blob_created, "observationCreated": True,
                })
            except (SecTickerError, OSError, foundation.FoundationError) as exc:
                failed.append({"sourceId": source_id, "captureTimestamp": timestamp, "error": str(exc)})
            if sleep_ms:
                time.sleep(sleep_ms / 1000)
    unsigned = {
        "schema": SCHEMA, "generatedAt": utc_now(),
        "status": "PASS" if not failed and not missing else "PARTIAL",
        "fromYear": from_year, "toYear": to_year, "completed": completed,
        "failed": failed, "missing": missing, "cdxManifests": manifests,
        "interpretation": "Each row is an official SEC mapping observed at one exact archive timestamp; gaps are never filled and capture time is not backdated to publication time.",
    }
    return signed_report(unsigned)


def self_test() -> dict[str, Any]:
    simple = json.dumps({
        "0": {"cik_str": 1, "ticker": "ABC", "title": "Example Corp"},
        "1": {"cik_str": 1, "ticker": "ABC", "title": "Example Corp"},
    }).encode()
    exchange = json.dumps({"fields": ["cik", "name", "ticker", "exchange"], "data": [[1, "Example Corp", "ABC", "Nasdaq"]]}).encode()
    first = parse_snapshot(simple, "company_tickers")
    second = parse_snapshot(gzip.compress(exchange, mtime=0), "company_tickers_exchange")
    if first["records"][0]["cik"] != 1 or second["records"][0]["exchange"] != "Nasdaq":
        raise SecTickerError("SEC ticker parser self-test failed")
    if first["sourceRows"] != 2 or first["rows"] != 1 or first["exactDuplicateRows"] != 1:
        raise SecTickerError("SEC ticker exact-duplicate self-test failed")
    if second["transportCompression"] != "gzip":
        raise SecTickerError("SEC ticker gzip self-test failed")
    if not archive_digest_matches(simple, hashlib.sha1(simple).hexdigest()):
        raise SecTickerError("SEC ticker hexadecimal CDX digest self-test failed")
    rows = [{"timestamp": "20210101000000"}, {"timestamp": "20210331000000"}, {"timestamp": "20210401000000"}]
    selected = select_last_capture_per_quarter(rows)
    if [row["timestamp"] for row in selected] != ["20210331000000", "20210401000000"]:
        raise SecTickerError("SEC ticker quarter selection self-test failed")
    unsigned = {"schema": "fixture", "value": 1}
    if signed_report(unsigned)["reportSha256"] != hashlib.sha256(canonical_bytes(unsigned)).hexdigest():
        raise SecTickerError("SEC ticker report-signature self-test failed")
    return {
        "schema": "early-detection-sec-company-ticker-self-test/v1", "status": "PASS",
        "companyTickersRows": first["rows"], "companyTickersExchangeRows": second["rows"],
        "gzipTransportVerified": True, "selectedCaptures": len(selected), "signedReportVerified": True,
        "hexDigestVerified": True,
        "exactDuplicateRowsVerified": True,
    }


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    commands = value.add_subparsers(dest="command", required=True)
    acquire_parser = commands.add_parser("acquire")
    acquire_parser.add_argument("--data-root", required=True)
    acquire_parser.add_argument("--from-year", type=int, required=True)
    acquire_parser.add_argument("--to-year", type=int, required=True)
    acquire_parser.add_argument("--user-agent", default=DEFAULT_USER_AGENT)
    acquire_parser.add_argument("--timeout", type=int, default=60)
    acquire_parser.add_argument("--retries", type=int, default=2)
    acquire_parser.add_argument("--sleep-ms", type=int, default=100)
    acquire_parser.add_argument("--report", type=Path)
    commands.add_parser("self-test")
    return value


def main() -> int:
    args = parser().parse_args()
    if args.command == "self-test":
        result = self_test()
    else:
        result = acquire(Path(args.data_root).resolve(), args.from_year, args.to_year, args.user_agent, args.timeout, args.retries, args.sleep_ms)
        if args.report is not None:
            write_report_once(args.report.expanduser().resolve(), result)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0 if result["status"] in {"PASS", "PARTIAL"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
