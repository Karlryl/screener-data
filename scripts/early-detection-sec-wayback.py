#!/usr/bin/env python3
"""Acquire versioned SEC Financial Statement Data Set ZIPs via Wayback.

This is a free transport fallback for networks where sec.gov blocks direct
access.  Every replay payload must validate as an SEC FSD ZIP and its SHA-1
payload digest must equal the digest recorded by the Wayback CDX index.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import importlib.util
import json
import re
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from types import ModuleType
from typing import Any


CDX_BASE = "https://web.archive.org/cdx/search/cdx"
REPLAY_BASE = "https://web.archive.org/web/"
FSD_PREFIX = "https://www.sec.gov/files/dera/data/financial-statement-data-sets/"
DEFAULT_USER_AGENT = "Growth-Screener-Research/1.0 contact=https://github.com/Karlryl/screener-data"
QUARTER_RE = re.compile(r"(20\d{2}q[1-4])")
RESULT_SCHEMA = "early-detection-sec-wayback-acquisition/v1"


class WaybackError(RuntimeError):
    """The archived SEC transport could not be verified."""


def load_foundation() -> ModuleType:
    path = Path(__file__).resolve().with_name("early-detection-foundation.py")
    spec = importlib.util.spec_from_file_location("early_detection_foundation_wayback", path)
    if spec is None or spec.loader is None:
        raise WaybackError(f"cannot load foundation module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fetch_bytes(url: str, user_agent: str, timeout: int, retries: int) -> tuple[bytes, dict[str, str]]:
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        try:
            request = urllib.request.Request(
                url,
                headers={"User-Agent": user_agent, "Accept-Encoding": "identity"},
            )
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read(), {key.lower(): value for key, value in response.headers.items()}
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
        if attempt < retries:
            time.sleep(min(8.0, 1.0 * (2 ** attempt)))
    raise WaybackError(f"download failed after {retries + 1} attempts: {url}: {last_error}")


def cdx_query_url() -> str:
    return CDX_BASE + "?" + urllib.parse.urlencode({
        "url": FSD_PREFIX,
        "matchType": "prefix",
        "output": "json",
        "filter": "statuscode:200",
        "fl": "timestamp,original,mimetype,statuscode,digest,length",
        "collapse": "digest",
        "from": "2009",
        "to": "2026",
        "limit": "1000",
    })


def parse_cdx(payload: bytes) -> list[dict[str, Any]]:
    rows = json.loads(payload.decode("utf-8"))
    if not isinstance(rows, list) or not rows:
        raise WaybackError("Wayback CDX response is empty")
    expected = ["timestamp", "original", "mimetype", "statuscode", "digest", "length"]
    if rows[0] != expected:
        raise WaybackError("Wayback CDX columns changed")
    result: list[dict[str, Any]] = []
    for values in rows[1:]:
        if not isinstance(values, list) or len(values) != len(expected):
            raise WaybackError("invalid Wayback CDX row")
        row = dict(zip(expected, values))
        match = QUARTER_RE.search(str(row["original"]))
        if match is None or str(row["statuscode"]) != "200":
            continue
        row["quarter"] = match.group(1)
        row["length"] = int(row["length"])
        result.append(row)
    return result


def quarter_key(value: str) -> int:
    match = re.fullmatch(r"(20\d{2})q([1-4])", value)
    if match is None:
        raise WaybackError(f"invalid quarter: {value}")
    return int(match.group(1)) * 4 + int(match.group(2)) - 1


def is_current_path(row: dict[str, Any]) -> bool:
    return str(row["original"]).lower().endswith(f"/{row['quarter']}.zip")


def is_archive_path(row: dict[str, Any]) -> bool:
    return str(row["original"]).lower().endswith(f"/{row['quarter']}-archive.zip")


def choose_variants(rows: list[dict[str, Any]], quarter: str, variants: set[str]) -> list[dict[str, Any]]:
    group = sorted((row for row in rows if row["quarter"] == quarter), key=lambda row: str(row["timestamp"]))
    selected: list[dict[str, Any]] = []
    if "legacy" in variants:
        historical = [row for row in group if is_current_path(row) and str(row["timestamp"]) < "20241201000000"]
        archived = [row for row in group if is_archive_path(row)]
        candidate = historical[0] if historical else (archived[0] if archived else None)
        if candidate is not None:
            selected.append({**candidate, "datasetVariant": "legacy_earliest_archived"})
    if "reprocessed" in variants:
        current = [row for row in group if is_current_path(row) and str(row["timestamp"]) >= "20250101000000"]
        if not current and quarter_key(quarter) >= quarter_key("2025q1"):
            current = [row for row in group if is_current_path(row)]
        if current:
            selected.append({**current[0], "datasetVariant": "post_2024_reprocessed_or_current"})
    deduplicated: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for row in selected:
        key = (str(row["timestamp"]), str(row["original"]))
        if key not in seen:
            seen.add(key)
            deduplicated.append(row)
    return deduplicated


def wayback_timestamp(value: str) -> str:
    parsed = datetime.strptime(value, "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
    return parsed.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def sha1_base32(payload: bytes) -> str:
    return base64.b32encode(hashlib.sha1(payload).digest()).decode("ascii").rstrip("=")


def replay_url(row: dict[str, Any]) -> str:
    return f"{REPLAY_BASE}{row['timestamp']}id_/{row['original']}"


def cached_cdx_payload(data_root: Path) -> tuple[bytes, dict[str, str]] | None:
    cache_directory = data_root / "archive-indexes" / "sec-fsd-cdx"
    candidates: list[tuple[int, str, bytes, Path]] = []
    for path in sorted(cache_directory.glob("*.json")) if cache_directory.exists() else []:
        try:
            payload = path.read_bytes()
            rows = parse_cdx(payload)
            digest = hashlib.sha256(payload).hexdigest()
            if path.stem != digest:
                continue
            candidates.append((len(rows), digest, payload, path))
        except (OSError, WaybackError, json.JSONDecodeError, ValueError):
            continue
    if not candidates:
        return None
    _, digest, payload, path = max(candidates, key=lambda item: (item[0], item[1]))
    return payload, {
        "x-local-cache": str(path.resolve()),
        "x-local-cache-sha256": digest,
    }


def load_or_fetch_cdx(
    data_root: Path,
    query_url: str,
    user_agent: str,
    timeout: int,
    retries: int,
    refresh: bool,
) -> tuple[bytes, dict[str, str]]:
    cached = None if refresh else cached_cdx_payload(data_root)
    if cached is not None:
        return cached
    payload, headers = fetch_bytes(query_url, user_agent, timeout, retries)
    parse_cdx(payload)
    digest = hashlib.sha256(payload).hexdigest()
    cache_path = data_root / "archive-indexes" / "sec-fsd-cdx" / f"{digest}.json"
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    if cache_path.exists() and cache_path.read_bytes() != payload:
        raise WaybackError(f"content-addressed CDX cache collision: {cache_path}")
    if not cache_path.exists():
        cache_path.write_bytes(payload)
    return payload, {**headers, "x-local-cache-written": str(cache_path.resolve())}


def acquire(
    data_root: Path,
    from_quarter: str,
    to_quarter: str,
    variants: set[str],
    user_agent: str,
    timeout: int,
    retries: int,
    sleep_ms: int,
    refresh_cdx: bool,
) -> dict[str, Any]:
    foundation = load_foundation()
    if quarter_key(from_quarter) > quarter_key(to_quarter):
        raise WaybackError("from-quarter must not be after to-quarter")
    query_url = cdx_query_url()
    cdx_payload, cdx_headers = load_or_fetch_cdx(
        data_root, query_url, user_agent, timeout, retries, refresh_cdx,
    )
    rows = parse_cdx(cdx_payload)
    expected_quarters = [
        f"{key // 4}q{key % 4 + 1}"
        for key in range(quarter_key(from_quarter), quarter_key(to_quarter) + 1)
    ]
    selected: list[dict[str, Any]] = []
    missing: list[dict[str, str]] = []
    for quarter in expected_quarters:
        chosen = choose_variants(rows, quarter, variants)
        present_variants = {row["datasetVariant"] for row in chosen}
        selected.extend(chosen)
        if "legacy" in variants and "legacy_earliest_archived" not in present_variants:
            missing.append({"quarter": quarter, "variant": "legacy", "reason": "NO_CDX_CAPTURE"})
        if "reprocessed" in variants and "post_2024_reprocessed_or_current" not in present_variants:
            missing.append({"quarter": quarter, "variant": "reprocessed", "reason": "NO_CDX_CAPTURE"})
    completed: list[dict[str, Any]] = []
    failed: list[dict[str, str]] = []
    for row in selected:
        quarter = str(row["quarter"])
        variant = str(row["datasetVariant"])
        url = replay_url(row)
        try:
            payload, headers = fetch_bytes(url, user_agent, timeout, retries)
            actual_sha1 = sha1_base32(payload)
            if actual_sha1 != str(row["digest"]):
                raise WaybackError(
                    f"CDX payload digest mismatch: expected={row['digest']} actual={actual_sha1}"
                )
            archive_evidence = {
                "provider": "Internet Archive Wayback Machine",
                "cdxQueryUrl": query_url,
                "cdxQuerySha256": hashlib.sha256(cdx_payload).hexdigest(),
                "captureTimestamp": str(row["timestamp"]),
                "captureDigestSha1Base32": str(row["digest"]),
                "captureLengthIncludingArchiveRecord": int(row["length"]),
                "replayUrl": url,
            }
            observation = foundation.ingest_fsd_bytes(
                data_root,
                quarter,
                payload,
                url,
                wayback_timestamp(str(row["timestamp"])),
                headers,
                "wayback_cdx_capture_timestamp",
                str(row["original"]),
                archive_evidence,
                variant,
            )
            completed.append({
                "quarter": quarter,
                "variant": variant,
                "captureTimestamp": str(row["timestamp"]),
                "sourceUrl": str(row["original"]),
                "payloadBytes": len(payload),
                "payloadSha256": observation["payloadSha256"],
                "payloadSha1Base32": actual_sha1,
                "observationPath": observation["observationPath"],
                "blobCreated": observation["blobCreated"],
            })
        except (WaybackError, urllib.error.URLError, OSError, ValueError) as exc:
            failed.append({"quarter": quarter, "variant": variant, "reason": str(exc)})
        if sleep_ms:
            time.sleep(sleep_ms / 1000)
    result = {
        "schema": RESULT_SCHEMA,
        "completedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "dataRoot": str(data_root.resolve()),
        "fromQuarter": from_quarter,
        "toQuarter": to_quarter,
        "requestedVariants": sorted(variants),
        "cdxRecords": len(rows),
        "cdxQuerySha256": hashlib.sha256(cdx_payload).hexdigest(),
        "cdxResponseHeaders": cdx_headers,
        "selected": len(selected),
        "completed": completed,
        "missing": missing,
        "failed": failed,
        "status": "PASS" if not missing and not failed else "PARTIAL",
    }
    store = foundation.ensure_data_root(data_root)
    batch_name = foundation.safe_token(result["completedAt"]) + ".json"
    foundation.write_once(
        store / "batches" / "sec-fsd-wayback" / batch_name,
        foundation.canonical_bytes(result) + b"\n",
    )
    return result


def self_test() -> dict[str, Any]:
    rows = [
        {
            "quarter": "2024q1", "timestamp": "20240525215014",
            "original": FSD_PREFIX + "2024q1.zip", "digest": "OLD", "length": 10,
        },
        {
            "quarter": "2024q1", "timestamp": "20250115172704",
            "original": "https://www.sec.gov/files/dera/data/financial-statement-data-sets-archive/2024q1-archive.zip",
            "digest": "OLD", "length": 11,
        },
        {
            "quarter": "2024q1", "timestamp": "20250201045146",
            "original": FSD_PREFIX + "2024q1.zip", "digest": "NEW", "length": 12,
        },
    ]
    chosen = choose_variants(rows, "2024q1", {"legacy", "reprocessed"})
    fixture_cdx = json.dumps([
        ["timestamp", "original", "mimetype", "statuscode", "digest", "length"],
        ["20240525215014", FSD_PREFIX + "2024q1.zip", "application/zip", "200", "OLD", "10"],
    ]).encode()
    with tempfile.TemporaryDirectory() as directory:
        cache = Path(directory) / "archive-indexes" / "sec-fsd-cdx"
        cache.mkdir(parents=True)
        digest = hashlib.sha256(fixture_cdx).hexdigest()
        (cache / f"{digest}.json").write_bytes(fixture_cdx)
        cached = cached_cdx_payload(Path(directory))
        if cached is None or cached[0] != fixture_cdx or cached[1]["x-local-cache-sha256"] != digest:
            raise WaybackError("self-test content-addressed CDX cache failed")
    if [row["digest"] for row in chosen] != ["OLD", "NEW"]:
        raise WaybackError("variant selection failed")
    if wayback_timestamp("20240525215014") != "2024-05-25T21:50:14.000Z":
        raise WaybackError("capture timestamp conversion failed")
    if sha1_base32(b"abc") != "VGMT4NSHA2AWVOR6EVYXQUGCNSONBWE5":
        raise WaybackError("CDX digest conversion failed")
    return {
        "schema": "early-detection-sec-wayback-self-test/v1",
        "status": "PASS",
        "selectedVariants": [row["datasetVariant"] for row in chosen],
        "contentAddressedCdxCache": True,
        "digestVerified": True,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    acquire_parser = sub.add_parser("acquire")
    acquire_parser.add_argument("--data-root", type=Path, required=True)
    acquire_parser.add_argument("--from-quarter", required=True)
    acquire_parser.add_argument("--to-quarter", required=True)
    acquire_parser.add_argument("--variants", default="legacy,reprocessed")
    acquire_parser.add_argument("--user-agent", default=DEFAULT_USER_AGENT)
    acquire_parser.add_argument("--timeout", type=int, default=600)
    acquire_parser.add_argument("--retries", type=int, default=2)
    acquire_parser.add_argument("--sleep-ms", type=int, default=500)
    acquire_parser.add_argument("--refresh-cdx", action="store_true")
    sub.add_parser("self-test")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        if args.command == "self-test":
            result = self_test()
        else:
            variants = {value.strip() for value in args.variants.split(",") if value.strip()}
            if not variants or not variants.issubset({"legacy", "reprocessed"}):
                raise WaybackError("variants must be legacy and/or reprocessed")
            result = acquire(
                args.data_root, args.from_quarter, args.to_quarter, variants,
                args.user_agent, args.timeout, args.retries, args.sleep_ms,
                args.refresh_cdx,
            )
        print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
        return 0 if result.get("status") == "PASS" else 1
    except (WaybackError, OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"[early-detection-sec-wayback] {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
