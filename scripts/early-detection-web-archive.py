#!/usr/bin/env python3
"""Acquire free point-in-time web evidence from Common Crawl WARC records.

The crawler timestamp is an observation time, not a publication time.  A
capture is signal-eligible only when the archived payload itself also contains
one unambiguous exact publication timestamp consistent with the registered day.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import importlib.util
import io
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from types import ModuleType
from typing import Any


COLLINFO_URL = "https://index.commoncrawl.org/collinfo.json"
DATA_ROOT_URL = "https://data.commoncrawl.org/"
DEFAULT_USER_AGENT = "Growth-Screener-Research/1.0 contact=https://github.com/Karlryl/screener-data"
ARCHIVE_SCHEMA = "early-detection-common-crawl-acquisition/v1"


class ArchiveError(RuntimeError):
    """A web-archive record could not satisfy the evidence contract."""


def load_local_module(name: str, filename: str) -> ModuleType:
    path = Path(__file__).resolve().with_name(filename)
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ArchiveError(f"cannot load local module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fetch_bytes(url: str, user_agent: str, timeout: int, retries: int, headers: dict[str, str] | None = None) -> tuple[bytes, dict[str, str]]:
    request_headers = {"User-Agent": user_agent, "Accept-Encoding": "identity"}
    request_headers.update(headers or {})
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        try:
            request = urllib.request.Request(url, headers=request_headers)
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read(), {key.lower(): value for key, value in response.headers.items()}
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                raise
            last_error = exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
        if attempt < retries:
            time.sleep(min(4.0, 0.5 * (2 ** attempt)))
    raise ArchiveError(f"download failed after {retries + 1} attempts: {url}: {last_error}")


def parse_collection_time(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)


def eligible_collections(collections: list[dict[str, Any]], published_day: date, max_days: int) -> list[dict[str, Any]]:
    lower = datetime.combine(published_day, datetime.min.time(), tzinfo=timezone.utc)
    upper = lower + timedelta(days=max_days)
    selected = [
        row for row in collections
        if parse_collection_time(str(row["to"])) >= lower
        and parse_collection_time(str(row["from"])) <= upper
    ]
    return sorted(selected, key=lambda row: parse_collection_time(str(row["from"])))


def archive_index_url(collection: dict[str, Any], source_url: str) -> str:
    target = re.sub(r"^https?://", "", source_url, flags=re.IGNORECASE)
    return str(collection["cdx-api"]) + "?" + urllib.parse.urlencode({
        "url": target,
        "output": "json",
        "filter": "status:200",
    })


def query_collection(collection: dict[str, Any], source_url: str, user_agent: str, timeout: int, retries: int) -> tuple[str, list[dict[str, Any]]]:
    query_url = archive_index_url(collection, source_url)
    try:
        payload, _ = fetch_bytes(query_url, user_agent, timeout, retries)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return query_url, []
        raise
    rows: list[dict[str, Any]] = []
    for line in payload.decode("utf-8").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    rows = [row for row in rows if str(row.get("status")) == "200"]
    rows.sort(key=lambda row: str(row.get("timestamp", "")))
    return query_url, rows


def timestamp_utc(value: str) -> str:
    parsed = datetime.strptime(value, "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
    return parsed.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def first_capture(
    collections: list[dict[str, Any]],
    source_url: str,
    published_day: date,
    max_days: int,
    user_agent: str,
    timeout: int,
    retries: int,
    sleep_ms: int,
    max_collections: int,
) -> tuple[dict[str, Any], str, str] | None:
    lower = published_day.strftime("%Y%m%d")
    candidates = eligible_collections(collections, published_day, max_days)[:max_collections]
    for collection in candidates:
        query_url, rows = query_collection(collection, source_url, user_agent, timeout, retries)
        for row in rows:
            capture = str(row.get("timestamp", ""))
            if capture[:8] >= lower:
                return row, str(collection["id"]), query_url
        if sleep_ms:
            time.sleep(sleep_ms / 1000)
    return None


def decode_chunked(payload: bytes) -> bytes:
    source = io.BytesIO(payload)
    result = bytearray()
    while True:
        line = source.readline()
        if not line:
            raise ArchiveError("truncated chunked HTTP payload")
        size_token = line.strip().split(b";", 1)[0]
        try:
            size = int(size_token, 16)
        except ValueError as exc:
            raise ArchiveError("invalid chunked HTTP payload") from exc
        if size == 0:
            break
        chunk = source.read(size)
        if len(chunk) != size:
            raise ArchiveError("truncated HTTP chunk")
        result.extend(chunk)
        ending = source.read(2)
        if ending != b"\r\n":
            raise ArchiveError("invalid HTTP chunk terminator")
    return bytes(result)


def split_headers(payload: bytes) -> tuple[bytes, bytes]:
    for separator in (b"\r\n\r\n", b"\n\n"):
        if separator in payload:
            return tuple(payload.split(separator, 1))  # type: ignore[return-value]
    raise ArchiveError("header terminator is missing")


def parse_header_block(payload: bytes) -> dict[str, str]:
    lines = payload.decode("iso-8859-1", errors="replace").splitlines()
    result: dict[str, str] = {}
    for line in lines[1:]:
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        result[key.strip().lower()] = value.strip()
    return result


def parse_warc_response(compressed_record: bytes) -> tuple[bytes, dict[str, str], dict[str, str]]:
    try:
        record = gzip.decompress(compressed_record)
    except (gzip.BadGzipFile, EOFError, zlib.error) as exc:
        raise ArchiveError("Common Crawl range is not a complete gzip member") from exc
    warc_block, http_record = split_headers(record)
    http_block, body = split_headers(http_record)
    warc_headers = parse_header_block(warc_block)
    http_headers = parse_header_block(http_block)
    if "chunked" in http_headers.get("transfer-encoding", "").lower():
        body = decode_chunked(body)
    content_encoding = http_headers.get("content-encoding", "").lower()
    if content_encoding == "gzip":
        body = gzip.decompress(body)
    elif content_encoding == "deflate":
        body = zlib.decompress(body)
    elif content_encoding and content_encoding != "identity":
        raise ArchiveError(f"unsupported archived content encoding: {content_encoding}")
    return body, http_headers, warc_headers


def fetch_capture(row: dict[str, Any], user_agent: str, timeout: int, retries: int) -> tuple[bytes, bytes, dict[str, str], dict[str, str], str]:
    filename = str(row.get("filename", ""))
    try:
        offset = int(row["offset"])
        length = int(row["length"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ArchiveError("archive index row lacks valid range fields") from exc
    if not filename.startswith("crawl-data/") or ".." in Path(filename).parts:
        raise ArchiveError("invalid Common Crawl filename")
    if offset < 0 or length <= 0:
        raise ArchiveError("invalid Common Crawl byte range")
    range_header = f"bytes={offset}-{offset + length - 1}"
    warc_url = DATA_ROOT_URL + filename
    compressed, response_headers = fetch_bytes(
        warc_url, user_agent, timeout, retries, {"Range": range_header}
    )
    if len(compressed) != length:
        raise ArchiveError(f"WARC range length mismatch: expected={length} actual={len(compressed)}")
    body, http_headers, warc_headers = parse_warc_response(compressed)
    return compressed, body, http_headers, warc_headers, warc_url


def publication_evidence(metadata_module: ModuleType, body: bytes, content_type: str, declared_day: str) -> tuple[str | None, list[dict[str, str]], str]:
    if body.startswith(b"%PDF-") or "application/pdf" in content_type.lower():
        strong, _ = metadata_module.extract_pdf(body)
    else:
        strong, _ = metadata_module.extract_html(body)
    matched = [
        row for row in strong
        if row.get("rawValue", "")[:10] == declared_day
        or row.get("normalizedUtc", "")[:10] == declared_day
    ]
    values = sorted({row["normalizedUtc"] for row in matched})
    if len(values) == 1:
        return values[0], matched, "UNIQUE_EXACT_PUBLICATION_METADATA"
    if not matched:
        return None, strong, "NO_DAY_CONSISTENT_EXACT_PUBLICATION_METADATA"
    return None, matched, "AMBIGUOUS_EXACT_PUBLICATION_METADATA"


def acquire_registry(
    data_root: Path,
    registry: Path,
    user_agent: str,
    timeout: int,
    retries: int,
    offset: int,
    limit: int | None,
    max_days: int,
    sleep_ms: int,
    max_collections: int,
) -> dict[str, Any]:
    foundation = load_local_module("early_detection_foundation", "early-detection-foundation.py")
    metadata = load_local_module("early_detection_research_metadata", "early-detection-research-metadata.py")
    collinfo_payload, _ = fetch_bytes(COLLINFO_URL, user_agent, timeout, retries)
    collections = json.loads(collinfo_payload.decode("utf-8"))
    with registry.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    selected = rows[offset:offset + limit] if limit is not None else rows[offset:]
    completed: list[dict[str, Any]] = []
    unresolved: list[dict[str, str]] = []
    for row in selected:
        source_id = str(row.get("source_id", ""))
        source_url = str(row.get("url", ""))
        published = str(row.get("published_at", ""))
        if not source_url.startswith("https://"):
            unresolved.append({"sourceId": source_id, "reason": "NOT_HTTPS_PUBLIC_SOURCE"})
            continue
        try:
            published_day = date.fromisoformat(published[:10])
            found = first_capture(
                collections, source_url, published_day, max_days,
                user_agent, timeout, retries, sleep_ms, max_collections,
            )
            if found is None:
                unresolved.append({"sourceId": source_id, "reason": "NO_CAPTURE_WITHIN_WINDOW"})
                continue
            capture, collection_id, query_url = found
            compressed, body, http_headers, warc_headers, warc_url = fetch_capture(
                capture, user_agent, timeout, retries
            )
            source_published_at, metadata_evidence, metadata_decision = publication_evidence(
                metadata, body, http_headers.get("content-type", str(capture.get("mime", ""))), published[:10]
            )
            observed_at = timestamp_utc(str(capture["timestamp"]))
            archive_evidence = {
                "provider": "Common Crawl",
                "collectionId": collection_id,
                "indexQueryUrl": query_url,
                "captureTimestamp": str(capture["timestamp"]),
                "captureUrl": str(capture.get("url", "")),
                "captureDigest": str(capture.get("digest", "")),
                "warcFilename": str(capture.get("filename", "")),
                "warcOffset": int(capture["offset"]),
                "warcLength": int(capture["length"]),
                "warcUrl": warc_url,
                "warcHeaders": warc_headers,
                "publicationMetadataDecision": metadata_decision,
            }
            observation = foundation.ingest_archived_research_bytes(
                data_root, row, body, compressed, observed_at, source_published_at,
                archive_evidence, metadata_evidence, http_headers,
            )
            completed.append({
                "sourceId": source_id,
                "captureTimestamp": str(capture["timestamp"]),
                "sourcePublishedAt": source_published_at,
                "metadataDecision": metadata_decision,
                "qualityState": observation["qualityState"],
                "payloadSha256": observation["payloadSha256"],
                "archiveRecordSha256": observation["archiveRecordSha256"],
                "observationPath": observation["observationPath"],
            })
        except (ArchiveError, urllib.error.HTTPError, OSError, ValueError, json.JSONDecodeError) as exc:
            unresolved.append({"sourceId": source_id, "reason": str(exc)})
        if sleep_ms:
            time.sleep(sleep_ms / 1000)
    return {
        "schema": ARCHIVE_SCHEMA,
        "completedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "provider": "Common Crawl",
        "registry": str(registry.resolve()),
        "dataRoot": str(data_root.resolve()),
        "selected": len(selected),
        "completed": completed,
        "unresolved": unresolved,
        "accepted": sum(row["qualityState"] == "accepted" for row in completed),
        "quarantined": sum(row["qualityState"] == "quarantined" for row in completed),
        "status": "PASS" if not unresolved else "PARTIAL",
    }


def self_test() -> dict[str, Any]:
    http = (
        b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n"
        b"<meta property=\"article:published_time\" content=\"2024-08-13T08:00:00-04:00\">"
    )
    record = b"WARC/1.0\r\nWARC-Type: response\r\n\r\n" + http
    compressed = gzip.compress(record)
    body, headers, warc_headers = parse_warc_response(compressed)
    if b"article:published_time" not in body or headers.get("content-type") != "text/html":
        raise ArchiveError("WARC response parsing failed")
    if warc_headers.get("warc-type") != "response":
        raise ArchiveError("WARC header parsing failed")
    metadata = load_local_module("early_detection_research_metadata_test", "early-detection-research-metadata.py")
    published, evidence, decision = publication_evidence(metadata, body, "text/html", "2024-08-13")
    if published != "2024-08-13T12:00:00.000Z" or len(evidence) != 1:
        raise ArchiveError("publication metadata selection failed")
    collections = [
        {"id": "late", "from": "2024-09-01T00:00:00", "to": "2024-09-02T00:00:00"},
        {"id": "early", "from": "2024-08-14T00:00:00", "to": "2024-08-15T00:00:00"},
    ]
    if [row["id"] for row in eligible_collections(collections, date(2024, 8, 13), 30)] != ["early", "late"]:
        raise ArchiveError("collection ordering failed")
    return {
        "schema": "early-detection-web-archive-self-test/v1",
        "status": "PASS",
        "warcParsed": True,
        "exactPublicationSelected": published,
        "metadataDecision": decision,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    acquire = sub.add_parser("acquire")
    acquire.add_argument("--data-root", type=Path, required=True)
    acquire.add_argument("--registry", type=Path, required=True)
    acquire.add_argument("--user-agent", default=DEFAULT_USER_AGENT)
    acquire.add_argument("--timeout", type=int, default=90)
    acquire.add_argument("--retries", type=int, default=2)
    acquire.add_argument("--offset", type=int, default=0)
    acquire.add_argument("--limit", type=int)
    acquire.add_argument("--max-days", type=int, default=366)
    acquire.add_argument("--max-collections", type=int, default=6)
    acquire.add_argument("--sleep-ms", type=int, default=150)
    sub.add_parser("self-test")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        if args.command == "self-test":
            result = self_test()
        else:
            result = acquire_registry(
                args.data_root, args.registry, args.user_agent, args.timeout,
                args.retries, args.offset, args.limit, args.max_days, args.sleep_ms,
                args.max_collections,
            )
        print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
        return 0 if result.get("status") == "PASS" else 1
    except (ArchiveError, OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"[early-detection-web-archive] {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
