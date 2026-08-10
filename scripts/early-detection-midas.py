#!/usr/bin/env python3
"""Acquire and verify the free SEC MIDAS individual-security archive.

The official files are used as a daily survivorship-aware security universe and
market-activity proxy from 2012 onward.  They are not represented as OHLCV.
When sec.gov is unavailable, the earliest byte-distinct Wayback capture of the
official Data.gov distribution URL is used and verified against the CDX SHA-1.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import importlib.util
import io
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from types import ModuleType
from typing import Any


SCHEMA = "early-detection-sec-midas-acquisition/v1"
CATALOG_URL = "https://catalog.data.gov/dataset/metrics-by-individual-security"
CDX_BASE = "https://web.archive.org/cdx/search/cdx"
REPLAY_BASE = "https://web.archive.org/web/"
DEFAULT_USER_AGENT = "Growth-Screener-Research/1.0 contact=https://github.com/Karlryl/screener-data"
QUARTER_RE = re.compile(r"(20\d{2})q([1-4])")


class MidasError(RuntimeError):
    """The MIDAS source or archive transport failed validation."""


def load_foundation() -> ModuleType:
    path = Path(__file__).resolve().with_name("early-detection-foundation.py")
    spec = importlib.util.spec_from_file_location("early_detection_foundation_midas", path)
    if spec is None or spec.loader is None:
        raise MidasError(f"cannot load foundation module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def quarter_key(value: str) -> int:
    match = QUARTER_RE.fullmatch(value.lower())
    if match is None:
        raise MidasError(f"invalid quarter: {value}")
    return int(match.group(1)) * 4 + int(match.group(2)) - 1


def quarter_range(start: str, end: str) -> list[str]:
    first, last = quarter_key(start), quarter_key(end)
    if first > last:
        raise MidasError("from-quarter must not be after to-quarter")
    if first < quarter_key("2012q1"):
        raise MidasError("SEC MIDAS individual-security coverage starts in 2012q1")
    return [f"{key // 4}q{key % 4 + 1}" for key in range(first, last + 1)]


def official_urls(quarter: str) -> list[str]:
    catalog_token = quarter.replace("q", "_q")
    standard = (
        "https://www.sec.gov/files/opa/data/market-structure/metrics-individual-security/"
        f"individual_security_{catalog_token}.zip"
    )
    if quarter == "2012q1":
        # Data.gov currently publishes the historical distribution with q10.
        return [standard.replace("2012_q1.zip", "2012_q10.zip"), standard]
    if quarter == "2019q4":
        return [
            "https://www.sec.gov/files/node/add/data_distribution/individual_security_2019_q4.zip",
            standard,
        ]
    return [standard]


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
            time.sleep(min(8.0, 2 ** attempt))
    raise MidasError(f"download failed after {retries + 1} attempts: {url}: {last_error}")


def cdx_url(original: str) -> str:
    return CDX_BASE + "?" + urllib.parse.urlencode({
        "url": original,
        "matchType": "exact",
        "output": "json",
        "filter": "statuscode:200",
        "fl": "timestamp,original,mimetype,statuscode,digest,length",
        "collapse": "digest",
        "limit": "100",
    })


def parse_cdx(payload: bytes) -> list[dict[str, Any]]:
    try:
        rows = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise MidasError("Wayback CDX response is not valid UTF-8 JSON") from exc
    expected = ["timestamp", "original", "mimetype", "statuscode", "digest", "length"]
    if not isinstance(rows, list) or not rows or rows[0] != expected:
        raise MidasError("Wayback CDX response is empty or its columns changed")
    result = []
    for values in rows[1:]:
        if not isinstance(values, list) or len(values) != len(expected):
            raise MidasError("invalid Wayback CDX row")
        row = dict(zip(expected, values))
        if row["statuscode"] == "200" and isinstance(row["digest"], str) and row["digest"] not in {"", "-"}:
            row["length"] = int(row["length"])
            result.append(row)
    return sorted(result, key=lambda row: str(row["timestamp"]))


def sha1_base32(payload: bytes) -> str:
    return base64.b32encode(hashlib.sha1(payload).digest()).decode("ascii").rstrip("=")


def capture_timestamp(value: str) -> str:
    parsed = datetime.strptime(value, "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
    return parsed.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def validate_zip(payload: bytes) -> dict[str, Any]:
    try:
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            bad_member = archive.testzip()
            if bad_member is not None:
                raise MidasError(f"ZIP CRC failed for {bad_member}")
            members = [info for info in archive.infolist() if not info.is_dir()]
            if not members:
                raise MidasError("MIDAS ZIP is empty")
            tabular = [info.filename for info in members if info.filename.lower().endswith((".csv", ".txt"))]
            nested_zip_members: list[str] = []
            for info in members:
                if not info.filename.lower().endswith(".zip"):
                    continue
                nested_payload = archive.read(info)
                try:
                    with zipfile.ZipFile(io.BytesIO(nested_payload)) as nested:
                        nested_bad = nested.testzip()
                        if nested_bad is not None:
                            raise MidasError(f"nested ZIP CRC failed for {info.filename}!{nested_bad}")
                        nested_tabular = [
                            nested_info.filename for nested_info in nested.infolist()
                            if not nested_info.is_dir()
                            and nested_info.filename.lower().endswith((".csv", ".txt"))
                        ]
                except zipfile.BadZipFile as exc:
                    raise MidasError(f"nested MIDAS member is not a valid ZIP: {info.filename}") from exc
                nested_zip_members.append(info.filename)
                tabular.extend(f"{info.filename}!{name}" for name in nested_tabular)
            if not tabular:
                raise MidasError("MIDAS ZIP contains no direct or one-level nested CSV/TXT member")
            return {
                "members": len(members),
                "uncompressedBytes": sum(info.file_size for info in members),
                "tabularMembers": sorted(tabular),
                "nestedZipMembers": sorted(nested_zip_members),
            }
    except zipfile.BadZipFile as exc:
        raise MidasError("payload is not a valid ZIP") from exc


def select_capture(quarter: str, user_agent: str, timeout: int, retries: int) -> tuple[dict[str, Any], bytes, str]:
    attempts: list[str] = []
    for original in official_urls(quarter):
        query = cdx_url(original)
        try:
            payload, _ = fetch_bytes(query, user_agent, timeout, retries)
            rows = parse_cdx(payload)
        except MidasError as exc:
            attempts.append(f"{original}: {exc}")
            continue
        if rows:
            return rows[0], payload, query
        attempts.append(f"{original}: no verified 200 capture")
    raise MidasError(f"no archived official distribution for {quarter}: {' | '.join(attempts)}")


def inspect_quarter(quarter: str, user_agent: str, timeout: int, retries: int) -> dict[str, Any]:
    """Inspect an archived ZIP without relaxing or bypassing the ingest gate."""
    row, _, query = select_capture(quarter, user_agent, timeout, retries)
    replay = f"{REPLAY_BASE}{row['timestamp']}id_/{row['original']}"
    payload, _ = fetch_bytes(replay, user_agent, timeout, retries)
    actual_sha1 = sha1_base32(payload)
    if actual_sha1 != row["digest"]:
        raise MidasError(f"CDX digest mismatch: expected={row['digest']} actual={actual_sha1}")
    try:
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            bad_member = archive.testzip()
            members = [
                {"name": info.filename, "bytes": info.file_size, "crc32": f"{info.CRC:08x}"}
                for info in archive.infolist() if not info.is_dir()
            ]
    except zipfile.BadZipFile as exc:
        raise MidasError("payload is not a valid ZIP") from exc
    return {
        "schema": "early-detection-sec-midas-inspection/v1",
        "status": "PASS" if bad_member is None else "CRC_FAIL",
        "quarter": quarter,
        "officialDistributionUrl": row["original"],
        "captureTimestamp": capture_timestamp(str(row["timestamp"])),
        "cdxQueryUrl": query,
        "payloadSha1Base32": actual_sha1,
        "payloadSha256": hashlib.sha256(payload).hexdigest(),
        "payloadBytes": len(payload),
        "members": members,
    }


def acquire_quarter(
    data_root: Path,
    quarter: str,
    user_agent: str,
    timeout: int,
    retries: int,
) -> dict[str, Any]:
    foundation = load_foundation()
    store = foundation.ensure_data_root(data_root)
    row, cdx_payload, query = select_capture(quarter, user_agent, timeout, retries)
    existing_root = store / "observations" / "sec-midas-individual-security" / quarter
    if existing_root.exists():
        for existing_path in sorted(existing_root.glob("*.json")):
            try:
                existing = json.loads(existing_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if (
                existing.get("captureTimestamp") != capture_timestamp(str(row["timestamp"]))
                or existing.get("payloadSha1Base32") != row["digest"]
                or existing.get("officialDistributionUrl") != row["original"]
            ):
                continue
            blob = store / Path(str(existing.get("blobPath", "")))
            if not blob.is_file():
                raise MidasError(f"existing MIDAS observation has no blob: {existing_path}")
            payload = blob.read_bytes()
            if hashlib.sha256(payload).hexdigest() != existing.get("payloadSha256"):
                raise MidasError(f"existing MIDAS observation has a SHA-256 mismatch: {existing_path}")
            if sha1_base32(payload) != row["digest"]:
                raise MidasError(f"existing MIDAS observation has a CDX digest mismatch: {existing_path}")
            validate_zip(payload)
            return {
                **existing,
                "blobCreated": False,
                "observationPath": str(existing_path.relative_to(store)).replace("\\", "/"),
                "acquisitionStatus": "ALREADY_VERIFIED",
            }
    replay = f"{REPLAY_BASE}{row['timestamp']}id_/{row['original']}"
    payload, headers = fetch_bytes(replay, user_agent, timeout, retries)
    actual_sha1 = sha1_base32(payload)
    if actual_sha1 != row["digest"]:
        raise MidasError(f"CDX digest mismatch: expected={row['digest']} actual={actual_sha1}")
    structure = validate_zip(payload)
    sha256 = hashlib.sha256(payload).hexdigest()
    blob_relative = Path("blobs") / "sha256" / sha256[:2] / f"{sha256}.zip"
    blob_created = foundation.write_once(store / blob_relative, payload)
    observation = {
        "schema": SCHEMA,
        "dataset": "SEC_MIDAS_INDIVIDUAL_SECURITY",
        "quarter": quarter,
        "catalogUrl": CATALOG_URL,
        "officialDistributionUrl": row["original"],
        "transport": "Internet Archive Wayback Machine",
        "captureTimestamp": capture_timestamp(str(row["timestamp"])),
        "cdxQueryUrl": query,
        "cdxQuerySha256": hashlib.sha256(cdx_payload).hexdigest(),
        "cdxDigestSha1Base32": row["digest"],
        "replayUrl": replay,
        "payloadSha1Base32": actual_sha1,
        "payloadSha256": sha256,
        "payloadBytes": len(payload),
        "blobPath": str(blob_relative).replace("\\", "/"),
        "responseHeaders": headers,
        "zip": structure,
        "role": "survivorship_aware_daily_security_universe_and_market_activity_proxy_not_ohlcv",
        "license": "US public domain",
    }
    token = foundation.safe_token(observation["captureTimestamp"])
    relative = Path("observations") / "sec-midas-individual-security" / quarter / f"{token}-{sha256}.json"
    foundation.write_observation_once(store / relative, observation)
    return {
        **observation,
        "blobCreated": blob_created,
        "observationPath": str(relative).replace("\\", "/"),
        "acquisitionStatus": "DOWNLOADED_AND_VERIFIED",
    }


def acquire(
    data_root: Path,
    start: str,
    end: str,
    user_agent: str,
    timeout: int,
    retries: int,
    sleep_ms: int,
) -> dict[str, Any]:
    completed, failed = [], []
    for quarter in quarter_range(start, end):
        try:
            completed.append(acquire_quarter(data_root, quarter, user_agent, timeout, retries))
        except (MidasError, OSError, ValueError) as exc:
            failed.append({"quarter": quarter, "reason": str(exc)})
        if sleep_ms:
            time.sleep(sleep_ms / 1000)
    result = {
        "schema": "early-detection-sec-midas-batch/v1",
        "completedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "dataRoot": str(data_root.expanduser().resolve()),
        "fromQuarter": start,
        "toQuarter": end,
        "completed": completed,
        "failed": failed,
        "status": "PASS" if not failed else "PARTIAL",
    }
    foundation = load_foundation()
    store = foundation.ensure_data_root(data_root)
    name = foundation.safe_token(result["completedAt"]) + ".json"
    foundation.write_once(store / "batches" / "sec-midas-individual-security" / name, foundation.canonical_bytes(result) + b"\n")
    return result


def self_test() -> dict[str, Any]:
    if quarter_range("2012q4", "2013q2") != ["2012q4", "2013q1", "2013q2"]:
        raise MidasError("quarter range failed")
    rows = [["timestamp", "original", "mimetype", "statuscode", "digest", "length"],
            ["20130101000000", official_urls("2012q2")[0], "application/zip", "200", "ABC", "10"]]
    parsed = parse_cdx(json.dumps(rows).encode("utf-8"))
    if parsed[0]["digest"] != "ABC":
        raise MidasError("CDX parser failed")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("sample.csv", "Date,Ticker\n2012-01-03,ABC\n")
    structure = validate_zip(buffer.getvalue())
    if structure["tabularMembers"] != ["sample.csv"]:
        raise MidasError("ZIP validator failed")
    nested_buffer = io.BytesIO()
    with zipfile.ZipFile(nested_buffer, "w", zipfile.ZIP_DEFLATED) as nested:
        nested.writestr("sample_all.csv", "Date,Ticker\n2012-01-03,ABC\n")
    outer_buffer = io.BytesIO()
    with zipfile.ZipFile(outer_buffer, "w", zipfile.ZIP_DEFLATED) as outer:
        outer.writestr("nested.zip", nested_buffer.getvalue())
    nested_structure = validate_zip(outer_buffer.getvalue())
    if nested_structure["tabularMembers"] != ["nested.zip!sample_all.csv"]:
        raise MidasError("nested ZIP validator failed")
    return {
        "schema": "early-detection-sec-midas-self-test/v1",
        "status": "PASS",
        "catalogQuarterCount2012To2025": len(quarter_range("2012q1", "2025q4")),
        "q1CatalogTypoPreserved": official_urls("2012q1")[0].endswith("individual_security_2012_q10.zip"),
        "archiveDigestVerificationRequired": True,
        "roleExcludesOhlcv": True,
        "nestedArchiveSupported": True,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    acquire_parser = sub.add_parser("acquire")
    acquire_parser.add_argument("--data-root", required=True, type=Path)
    acquire_parser.add_argument("--from-quarter", required=True)
    acquire_parser.add_argument("--to-quarter", required=True)
    acquire_parser.add_argument("--user-agent", default=DEFAULT_USER_AGENT)
    acquire_parser.add_argument("--timeout", type=int, default=600)
    acquire_parser.add_argument("--retries", type=int, default=2)
    acquire_parser.add_argument("--sleep-ms", type=int, default=500)
    inspect_parser = sub.add_parser("inspect")
    inspect_parser.add_argument("--quarter", required=True)
    inspect_parser.add_argument("--user-agent", default=DEFAULT_USER_AGENT)
    inspect_parser.add_argument("--timeout", type=int, default=600)
    inspect_parser.add_argument("--retries", type=int, default=2)
    sub.add_parser("self-test")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        if args.command == "self-test":
            result = self_test()
        elif args.command == "inspect":
            result = inspect_quarter(args.quarter, args.user_agent, args.timeout, args.retries)
        else:
            result = acquire(
                args.data_root,
                args.from_quarter,
                args.to_quarter,
                args.user_agent,
                args.timeout,
                args.retries,
                args.sleep_ms,
            )
        display = result if args.command in {"self-test", "inspect"} else {
            "schema": result["schema"],
            "status": result["status"],
            "fromQuarter": result["fromQuarter"],
            "toQuarter": result["toQuarter"],
            "completed": [
                {
                    "quarter": row["quarter"],
                    "acquisitionStatus": row.get("acquisitionStatus"),
                    "payloadSha256": row["payloadSha256"],
                    "payloadBytes": row["payloadBytes"],
                }
                for row in result["completed"]
            ],
            "failed": result["failed"],
        }
        print(json.dumps(display, ensure_ascii=False, indent=2, sort_keys=True))
        return 0 if result["status"] == "PASS" else 1
    except (MidasError, OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"[early-detection-midas] {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
