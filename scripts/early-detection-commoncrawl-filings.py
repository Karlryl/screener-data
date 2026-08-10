#!/usr/bin/env python3
"""Measure Common Crawl coverage for a deterministic SEC filing sample.

Each filing URL is queried in the nearest later crawl collection and the latest
collection.  Captures remain transport candidates until a byte-range WARC
record is downloaded and its SEC accession/form content is verified.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import importlib.util
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from types import ModuleType
from typing import Any


SCHEMA = "early-detection-commoncrawl-sec-filing-coverage/v1"
COLLINFO_URL = "https://index.commoncrawl.org/collinfo.json"
DEFAULT_USER_AGENT = (
    "Growth-Screener-Research/1.0 "
    "contact=https://github.com/Karlryl/screener-data"
)
COLLECTION_ID_RE = re.compile(r"^CC-MAIN-[0-9-]+$")


class CommonCrawlFilingError(RuntimeError):
    """Common Crawl filing coverage could not be established."""


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def load_individual_module() -> ModuleType:
    path = Path(__file__).resolve().with_name("early-detection-sec-filing-individual.py")
    spec = importlib.util.spec_from_file_location("early_detection_individual_for_cc", path)
    if spec is None or spec.loader is None:
        raise CommonCrawlFilingError(f"cannot load individual filing module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fetch_bytes(
    url: str,
    user_agent: str,
    timeout: int,
    retries: int,
    allow_empty: bool,
) -> bytes:
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        try:
            request = urllib.request.Request(
                url,
                headers={"User-Agent": user_agent, "Accept-Encoding": "identity"},
            )
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = response.read()
            if not payload and not allow_empty:
                raise CommonCrawlFilingError("empty response body")
            return payload
        except CommonCrawlFilingError:
            raise
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
        if attempt < retries:
            time.sleep(min(8.0, 0.75 * (2 ** attempt)))
    raise CommonCrawlFilingError(
        f"request failed after {retries + 1} attempts: {type(last_error).__name__}: {last_error}"
    )


def parse_collinfo(payload: bytes) -> list[dict[str, str]]:
    try:
        rows = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CommonCrawlFilingError("collinfo is not valid UTF-8 JSON") from exc
    if not isinstance(rows, list) or not rows:
        raise CommonCrawlFilingError("collinfo is empty")
    result: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            raise CommonCrawlFilingError("collinfo contains a non-object row")
        identifier = str(row.get("id", ""))
        endpoint = str(row.get("cdx-api", ""))
        if not COLLECTION_ID_RE.fullmatch(identifier) or not endpoint.startswith("https://index.commoncrawl.org/"):
            raise CommonCrawlFilingError(f"invalid collection row: {identifier}")
        if identifier in seen:
            raise CommonCrawlFilingError(f"duplicate collection id: {identifier}")
        seen.add(identifier)
        result.append({"id": identifier, "cdxApi": endpoint})
    return result


def collection_year(identifier: str) -> int:
    years = [int(value) for value in re.findall(r"(?:19|20)\d{2}", identifier)]
    if not years:
        raise CommonCrawlFilingError(f"collection id has no year: {identifier}")
    return max(years)


def collection_sort_key(row: dict[str, str]) -> tuple[int, tuple[int, ...], str]:
    numeric = tuple(int(value) for value in re.findall(r"\d+", row["id"]))
    return collection_year(row["id"]), numeric, row["id"]


def choose_collections(
    collections: list[dict[str, str]],
    filing_year: int,
) -> list[dict[str, str]]:
    ordered = sorted(collections, key=collection_sort_key)
    later = [row for row in ordered if collection_year(row["id"]) > filing_year]
    nearest = later[0] if later else ordered[-1]
    latest = ordered[-1]
    result: list[dict[str, str]] = []
    seen: set[str] = set()
    for role, row in [("NEAREST_LATER_COLLECTION", nearest), ("LATEST_COLLECTION", latest)]:
        if row["id"] in seen:
            continue
        seen.add(row["id"])
        result.append({**row, "role": role})
    return result


def collinfo_cache(data_root: Path) -> tuple[bytes, Path] | None:
    directory = data_root / "archive-indexes" / "commoncrawl-collinfo"
    candidates: list[tuple[int, str, bytes, Path]] = []
    if not directory.exists():
        return None
    for path in sorted(directory.glob("*.json")):
        try:
            payload = path.read_bytes()
            digest = sha256_bytes(payload)
            if path.stem != digest:
                continue
            rows = parse_collinfo(payload)
            candidates.append((len(rows), digest, payload, path))
        except (OSError, CommonCrawlFilingError):
            continue
    if not candidates:
        return None
    _, _, payload, path = max(candidates, key=lambda item: item[:2])
    return payload, path


def load_collinfo(
    data_root: Path,
    user_agent: str,
    timeout: int,
    retries: int,
    refresh: bool,
) -> tuple[list[dict[str, str]], str, Path, str]:
    cached = None if refresh else collinfo_cache(data_root)
    if cached is not None:
        payload, path = cached
        return parse_collinfo(payload), sha256_bytes(payload), path, "CONTENT_ADDRESSED_CACHE"
    payload = fetch_bytes(COLLINFO_URL, user_agent, timeout, retries, False)
    rows = parse_collinfo(payload)
    digest = sha256_bytes(payload)
    path = data_root / "archive-indexes" / "commoncrawl-collinfo" / f"{digest}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_bytes() != payload:
        raise CommonCrawlFilingError(f"collinfo cache collision: {path}")
    if not path.exists():
        with path.open("xb") as handle:
            handle.write(payload)
    return rows, digest, path, "LIVE_AND_CONTENT_ADDRESSED_CACHE"


def capture_query_url(collection: dict[str, str], source_url: str) -> str:
    separator = "&" if "?" in collection["cdxApi"] else "?"
    return collection["cdxApi"] + separator + urllib.parse.urlencode([
        ("url", source_url),
        ("output", "json"),
        ("filter", "status:200"),
    ])


def parse_captures(payload: bytes) -> list[dict[str, Any]]:
    if not payload.strip():
        return []
    result: list[dict[str, Any]] = []
    for line_number, line in enumerate(payload.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            row = json.loads(line.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise CommonCrawlFilingError(f"invalid capture JSON line {line_number}") from exc
        if not isinstance(row, dict) or str(row.get("status")) != "200":
            raise CommonCrawlFilingError(f"invalid capture row {line_number}")
        required = ["timestamp", "url", "digest", "filename", "offset", "length"]
        if any(key not in row for key in required):
            raise CommonCrawlFilingError(f"capture row {line_number} lacks required fields")
        timestamp = str(row["timestamp"])
        if not re.fullmatch(r"\d{14}", timestamp):
            raise CommonCrawlFilingError(f"invalid capture timestamp: {timestamp}")
        offset_text = str(row["offset"])
        length_text = str(row["length"])
        if not offset_text.isdigit() or not length_text.isdigit() or int(length_text) <= 0:
            raise CommonCrawlFilingError("invalid capture byte range")
        filename = str(row["filename"])
        if not filename.startswith("crawl-data/") or ".." in filename:
            raise CommonCrawlFilingError(f"invalid WARC filename: {filename}")
        result.append({
            "timestamp": timestamp,
            "url": str(row["url"]),
            "digest": str(row["digest"]),
            "mime": str(row.get("mime", "")),
            "filename": filename,
            "offset": int(offset_text),
            "length": int(length_text),
        })
    return result


def query_cache_directory(data_root: Path, collection_id: str, source_url: str) -> Path:
    key = hashlib.sha256(source_url.encode("utf-8")).hexdigest()
    return data_root / "archive-indexes" / "commoncrawl-sec-filings" / collection_id / key


def cached_query(
    data_root: Path,
    collection_id: str,
    source_url: str,
) -> tuple[bytes, Path] | None:
    directory = query_cache_directory(data_root, collection_id, source_url)
    candidates: list[tuple[int, str, bytes, Path]] = []
    if not directory.exists():
        return None
    for path in sorted(directory.glob("*.jsonl")):
        try:
            payload = path.read_bytes()
            digest = sha256_bytes(payload)
            if path.stem != digest:
                continue
            rows = parse_captures(payload)
            candidates.append((len(rows), digest, payload, path))
        except (OSError, CommonCrawlFilingError):
            continue
    if not candidates:
        return None
    _, _, payload, path = max(candidates, key=lambda item: item[:2])
    return payload, path


def query_capture(
    data_root: Path,
    collection: dict[str, str],
    source_url: str,
    user_agent: str,
    timeout: int,
    retries: int,
    refresh: bool,
) -> dict[str, Any]:
    cached = None if refresh else cached_query(data_root, collection["id"], source_url)
    try:
        if cached is not None:
            payload, path = cached
            mode = "CONTENT_ADDRESSED_CACHE"
        else:
            payload = fetch_bytes(
                capture_query_url(collection, source_url), user_agent, timeout, retries, True,
            )
            parse_captures(payload)
            digest = sha256_bytes(payload)
            path = query_cache_directory(data_root, collection["id"], source_url) / f"{digest}.jsonl"
            path.parent.mkdir(parents=True, exist_ok=True)
            if path.exists() and path.read_bytes() != payload:
                raise CommonCrawlFilingError(f"query cache collision: {path}")
            if not path.exists():
                with path.open("xb") as handle:
                    handle.write(payload)
            mode = "LIVE_AND_CONTENT_ADDRESSED_CACHE"
        captures = parse_captures(payload)
        return {
            "queryStatus": "PASS",
            "collectionId": collection["id"],
            "collectionRole": collection["role"],
            "sourceUrl": source_url,
            "queryUrl": capture_query_url(collection, source_url),
            "retrievalMode": mode,
            "querySha256": sha256_bytes(payload),
            "queryCachePath": str(path.resolve()),
            "captureCount": len(captures),
            "captures": captures,
        }
    except (CommonCrawlFilingError, urllib.error.URLError, TimeoutError, OSError) as exc:
        return {
            "queryStatus": "FAILED",
            "collectionId": collection["id"],
            "collectionRole": collection["role"],
            "sourceUrl": source_url,
            "queryUrl": capture_query_url(collection, source_url),
            "error": f"{type(exc).__name__}: {exc}",
            "captureCount": None,
            "captures": [],
        }


def build_coverage(
    events_database: Path,
    data_root: Path,
    report_path: Path,
    from_year: int,
    to_year: int,
    per_stratum: int,
    seed: str,
    workers: int,
    user_agent: str,
    timeout: int,
    retries: int,
    refresh: bool,
) -> dict[str, Any]:
    if workers <= 0 or workers > 12:
        raise CommonCrawlFilingError("workers must be between 1 and 12")
    individual = load_individual_module()
    root = data_root.expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    collections, collinfo_sha, collinfo_path, collinfo_mode = load_collinfo(
        root, user_agent, timeout, retries, refresh,
    )
    population = individual.load_candidates(events_database, from_year, to_year)
    sample = individual.deterministic_sample(population, per_stratum, seed)
    tasks: dict[tuple[str, str], tuple[dict[str, str], str]] = {}
    plans: dict[str, list[dict[str, str]]] = {}
    for item in sample:
        chosen = choose_collections(collections, int(item["year"]))
        plans[item["accession"]] = chosen
        for variant in item["urlVariants"]:
            for collection in chosen:
                tasks[(collection["id"], variant["sourceUrl"])] = (collection, variant["sourceUrl"])
    query_results: dict[tuple[str, str], dict[str, Any]] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(
                query_capture, root, collection, source_url,
                user_agent, timeout, retries, refresh,
            ): key
            for key, (collection, source_url) in sorted(tasks.items())
        }
        for future in concurrent.futures.as_completed(futures):
            query_results[futures[future]] = future.result()
    statuses: Counter[str] = Counter()
    accession_results: list[dict[str, Any]] = []
    for item in sample:
        queries: list[dict[str, Any]] = []
        for variant in item["urlVariants"]:
            for collection in plans[item["accession"]]:
                query = query_results[(collection["id"], variant["sourceUrl"])]
                queries.append({"variant": variant["variant"], **query})
        if any(query["queryStatus"] == "PASS" and int(query["captureCount"]) > 0 for query in queries):
            status = "CAPTURE_FOUND"
        elif all(query["queryStatus"] == "PASS" for query in queries):
            status = "NO_CAPTURE"
        else:
            status = "QUERY_INCOMPLETE"
        statuses[status] += 1
        accession_results.append({
            "accession": item["accession"],
            "year": item["year"],
            "eventClass": item["eventClass"],
            "forms": item["forms"],
            "primaryPath": item["primaryPath"],
            "status": status,
            "collections": plans[item["accession"]],
            "queries": queries,
        })
    complete = statuses["CAPTURE_FOUND"] + statuses["NO_CAPTURE"]
    unsigned = {
        "schema": SCHEMA,
        "generatedAt": utc_now(),
        "status": "COMMONCRAWL_STRATIFIED_FILING_ARCHIVE_COVERAGE",
        "eventsDatabase": str(events_database.expanduser().resolve()),
        "dataRoot": str(root),
        "fromYear": from_year,
        "toYear": to_year,
        "populationAccessions": len(population),
        "sampling": {
            "method": "SAME_SHA256_YEAR_EVENT_CLASS_SAMPLE_AS_WAYBACK",
            "seed": seed,
            "perStratum": per_stratum,
            "sampledAccessions": len(sample),
        },
        "collectionPolicy": "NEAREST_LATER_AND_LATEST",
        "availableCollections": len(collections),
        "collinfo": {
            "sourceUrl": COLLINFO_URL,
            "sha256": collinfo_sha,
            "cachePath": str(collinfo_path.resolve()),
            "retrievalMode": collinfo_mode,
        },
        "captureFound": statuses["CAPTURE_FOUND"],
        "noCapture": statuses["NO_CAPTURE"],
        "queryIncomplete": statuses["QUERY_INCOMPLETE"],
        "captureRateAmongCompleteQueries": statuses["CAPTURE_FOUND"] / complete if complete else None,
        "accessions": accession_results,
        "officialMethodSources": [
            "https://commoncrawl.org/cdxj-index",
            "https://index.commoncrawl.org/",
        ],
        "interpretation": [
            "Common Crawl WARC filename, offset and length enable byte-range retrieval of a single record.",
            "Index presence is not content acceptance; SEC accession and form validation remain mandatory.",
            "Two selected collections do not prove absence from all Common Crawl collections.",
            "Query failures remain unknown and are excluded from the capture-rate denominator.",
            "No outcome or return was computed.",
        ],
        "confirmatoryEligible": False,
        "productiveGqsModified": False,
    }
    report = {**unsigned, "reportSha256": sha256_bytes(canonical_bytes(unsigned))}
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def self_test() -> dict[str, Any]:
    collinfo = parse_collinfo(json.dumps([
        {"id": "CC-MAIN-2025-30", "cdx-api": "https://index.commoncrawl.org/CC-MAIN-2025-30-index"},
        {"id": "CC-MAIN-2012", "cdx-api": "https://index.commoncrawl.org/CC-MAIN-2012-index"},
        {"id": "CC-MAIN-2008-2009", "cdx-api": "https://index.commoncrawl.org/CC-MAIN-2008-2009-index"},
    ]).encode())
    chosen = choose_collections(collinfo, 2009)
    if [row["id"] for row in chosen] != ["CC-MAIN-2012", "CC-MAIN-2025-30"]:
        raise CommonCrawlFilingError("self-test collection selection failed")
    fixture = json.dumps({
        "timestamp": "20250102030405",
        "url": "https://www.sec.gov/Archives/edgar/data/7/a.txt",
        "status": "200",
        "digest": "ABC",
        "filename": "crawl-data/CC-MAIN-2025-30/a.warc.gz",
        "offset": "100",
        "length": "200",
    }).encode() + b"\n"
    captures = parse_captures(fixture)
    if len(captures) != 1 or captures[0]["offset"] != 100 or captures[0]["length"] != 200:
        raise CommonCrawlFilingError("self-test capture parser failed")
    malformed_rejected = False
    try:
        parse_captures(b"{}\n")
    except CommonCrawlFilingError:
        malformed_rejected = True
    if not malformed_rejected:
        raise CommonCrawlFilingError("self-test malformed capture did not fail closed")
    return {
        "status": "PASS",
        "collinfoParsed": len(collinfo),
        "nearestLaterAndLatestVerified": True,
        "emptyCaptureSetAccepted": parse_captures(b"") == [],
        "byteRangeMetadataVerified": True,
        "malformedRejected": True,
    }


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    sub = value.add_subparsers(dest="command", required=True)
    coverage = sub.add_parser("coverage")
    coverage.add_argument("--events-database", type=Path, required=True)
    coverage.add_argument("--data-root", type=Path, required=True)
    coverage.add_argument("--report", type=Path, required=True)
    coverage.add_argument("--from-year", type=int, required=True)
    coverage.add_argument("--to-year", type=int, required=True)
    coverage.add_argument("--sample-per-stratum", type=int, default=1)
    coverage.add_argument("--seed", default="FEM-SEC-US@1.2.0-individual-archive-v1")
    coverage.add_argument("--workers", type=int, default=4)
    coverage.add_argument("--user-agent", default=DEFAULT_USER_AGENT)
    coverage.add_argument("--timeout", type=int, default=45)
    coverage.add_argument("--retries", type=int, default=2)
    coverage.add_argument("--refresh", action="store_true")
    sub.add_parser("self-test")
    return value


def main() -> int:
    args = parser().parse_args()
    if args.command == "self-test":
        result = self_test()
    else:
        result = build_coverage(
            args.events_database, args.data_root, args.report,
            args.from_year, args.to_year, args.sample_per_stratum,
            args.seed, args.workers, args.user_agent,
            args.timeout, args.retries, args.refresh,
        )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
