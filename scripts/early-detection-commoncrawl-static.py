#!/usr/bin/env python3
"""Query Common Crawl's static ZipNum index with HTTP byte ranges.

This fallback avoids the rate-limited CDX API.  It binary-searches immutable
cluster.idx files, downloads only the referenced compressed CDX block and
keeps every range response content-addressed.  Capture presence is transport
evidence only until the WARC payload itself is verified.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import gzip
import hashlib
import importlib.util
import json
import re
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from types import ModuleType
from typing import Any, Callable


SCHEMA = "early-detection-commoncrawl-static-sec-filing-coverage/v1"
DATA_BASE = "https://data.commoncrawl.org/"
DEFAULT_USER_AGENT = (
    "Growth-Screener-Research/1.0 "
    "contact=https://github.com/Karlryl/screener-data"
)
COLLECTION_RE = re.compile(r"^CC-MAIN-[0-9-]+$")
CDX_SHARD_RE = re.compile(r"^cdx-\d{5}\.gz$")


class StaticIndexError(RuntimeError):
    """The static Common Crawl index contract failed closed."""


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def load_module(filename: str, name: str) -> ModuleType:
    path = Path(__file__).resolve().with_name(filename)
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise StaticIndexError(f"cannot load dependency module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_once(path: Path, payload: bytes) -> bool:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != payload:
            raise StaticIndexError(f"append-only collision at {path}")
        return False
    try:
        with path.open("xb") as handle:
            handle.write(payload)
        return True
    except FileExistsError:
        if path.read_bytes() != payload:
            raise StaticIndexError(f"append-only race collision at {path}")
        return False


def fetch_bytes(
    url: str,
    user_agent: str,
    timeout: int,
    retries: int,
) -> tuple[bytes, dict[str, str]]:
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        try:
            request = urllib.request.Request(
                url,
                headers={"User-Agent": user_agent, "Accept-Encoding": "identity"},
            )
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read(), {
                    key.lower(): value for key, value in response.headers.items()
                }
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
        if attempt < retries:
            time.sleep(min(6.0, 0.5 * (2 ** attempt)))
    raise StaticIndexError(
        f"request failed after {retries + 1} attempts: {type(last_error).__name__}: {last_error}"
    )


def head_resource(
    url: str,
    user_agent: str,
    timeout: int,
    retries: int,
) -> dict[str, Any]:
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        try:
            request = urllib.request.Request(
                url,
                method="HEAD",
                headers={"User-Agent": user_agent, "Accept-Encoding": "identity"},
            )
            with urllib.request.urlopen(request, timeout=timeout) as response:
                headers = {key.lower(): value for key, value in response.headers.items()}
                length = headers.get("content-length", "")
                if not length.isdigit() or int(length) <= 0:
                    raise StaticIndexError(f"invalid resource content-length: {length}")
                return {
                    "bytes": int(length),
                    "etag": headers.get("etag"),
                    "lastModified": headers.get("last-modified"),
                }
        except StaticIndexError:
            raise
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
        if attempt < retries:
            time.sleep(min(6.0, 0.5 * (2 ** attempt)))
    raise StaticIndexError(
        f"HEAD failed after {retries + 1} attempts: {type(last_error).__name__}: {last_error}"
    )


def range_request_key(url: str, start: int, end: int) -> str:
    return hashlib.sha256(f"{url}\0{start}\0{end}".encode("utf-8")).hexdigest()


def range_descriptor_path(data_root: Path, url: str, start: int, end: int) -> Path:
    key = range_request_key(url, start, end)
    return data_root / "archive-indexes" / "cc-range-map" / key[:2] / f"{key}.json"


def range_blob_path(data_root: Path, digest: str) -> Path:
    return data_root / "archive-indexes" / "cc-range-blobs" / digest[:2] / f"{digest}.bin"


def cached_range(data_root: Path, url: str, start: int, end: int) -> tuple[bytes, Path] | None:
    descriptor_path = range_descriptor_path(data_root, url, start, end)
    if not descriptor_path.exists():
        return None
    try:
        descriptor = json.loads(descriptor_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise StaticIndexError(f"invalid range cache descriptor: {descriptor_path}") from exc
    expected = {
        "schema": "early-detection-commoncrawl-range-cache/v1",
        "sourceUrl": url,
        "start": start,
        "end": end,
    }
    if any(descriptor.get(key) != value for key, value in expected.items()):
        raise StaticIndexError(f"range cache descriptor identity failed: {descriptor_path}")
    digest = str(descriptor.get("payloadSha256", ""))
    path = range_blob_path(data_root, digest)
    if str(descriptor.get("payloadPath", "")) != str(path.resolve()) or not path.exists():
        raise StaticIndexError(f"range cache payload is missing: {descriptor_path}")
    payload = path.read_bytes()
    if (
        sha256_bytes(payload) != digest
        or len(payload) != end - start + 1
        or descriptor.get("payloadBytes") != len(payload)
    ):
        raise StaticIndexError(f"range cache payload identity failed: {path}")
    return payload, path


def fetch_range(
    data_root: Path,
    url: str,
    start: int,
    end: int,
    user_agent: str,
    timeout: int,
    retries: int,
) -> tuple[bytes, Path, str]:
    if start < 0 or end < start:
        raise StaticIndexError(f"invalid byte range: {start}-{end}")
    cached = cached_range(data_root, url, start, end)
    if cached is not None:
        return cached[0], cached[1], "CONTENT_ADDRESSED_CACHE"
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        try:
            request = urllib.request.Request(
                url,
                headers={
                    "User-Agent": user_agent,
                    "Accept-Encoding": "identity",
                    "Range": f"bytes={start}-{end}",
                },
            )
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = response.read()
                content_range = response.headers.get("Content-Range", "")
                if response.status != 206:
                    raise StaticIndexError(f"range response status changed: {response.status}")
                if not content_range.startswith(f"bytes {start}-{end}/"):
                    raise StaticIndexError(f"range response identity changed: {content_range}")
            if len(payload) != end - start + 1:
                raise StaticIndexError(
                    f"range payload length mismatch: expected={end-start+1} actual={len(payload)}"
                )
            digest = sha256_bytes(payload)
            path = range_blob_path(data_root, digest)
            write_once(path, payload)
            descriptor = {
                "schema": "early-detection-commoncrawl-range-cache/v1",
                "sourceUrl": url,
                "start": start,
                "end": end,
                "payloadSha256": digest,
                "payloadBytes": len(payload),
                "payloadPath": str(path.resolve()),
            }
            write_once(
                range_descriptor_path(data_root, url, start, end),
                canonical_bytes(descriptor) + b"\n",
            )
            return payload, path, "LIVE_RANGE_AND_CONTENT_ADDRESSED_CACHE"
        except StaticIndexError:
            raise
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
        if attempt < retries:
            time.sleep(min(6.0, 0.5 * (2 ** attempt)))
    raise StaticIndexError(
        f"range request failed after {retries + 1} attempts: {type(last_error).__name__}: {last_error}"
    )


def static_surt(source_url: str) -> str:
    parsed = urllib.parse.urlsplit(source_url)
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
        raise StaticIndexError(f"unsupported source URL: {source_url}")
    host = parsed.hostname.lower()
    if host.startswith("www."):
        host = host[4:]
    surt_host = ",".join(reversed(host.split(".")))
    path = urllib.parse.unquote(parsed.path or "/").lower()
    query = f"?{parsed.query.lower()}" if parsed.query else ""
    return f"{surt_host}){path}{query}"


def parse_cluster_line(payload: bytes) -> dict[str, Any]:
    try:
        text = payload.decode("utf-8").rstrip("\r\n")
    except UnicodeDecodeError as exc:
        raise StaticIndexError("cluster line is not UTF-8") from exc
    fields = text.split("\t")
    if len(fields) != 5:
        raise StaticIndexError(f"cluster line field count changed: {len(fields)}")
    key, shard, offset, length, sequence = fields
    if not CDX_SHARD_RE.fullmatch(shard):
        raise StaticIndexError(f"invalid CDX shard name: {shard}")
    if not all(value.isdigit() for value in [offset, length, sequence]):
        raise StaticIndexError("cluster line numeric field is invalid")
    if int(length) <= 0:
        raise StaticIndexError("cluster block length is not positive")
    return {
        "key": key,
        "shard": shard,
        "offset": int(offset),
        "length": int(length),
        "sequence": int(sequence),
    }


def cluster_predecessor(
    target: str,
    resource_bytes: int,
    range_reader: Callable[[int, int], bytes],
    window: int = 16384,
) -> tuple[dict[str, Any], int]:
    if resource_bytes <= 0 or window < 1024:
        raise StaticIndexError("invalid cluster search configuration")
    low = 0
    high = resource_bytes - 1
    best: dict[str, Any] | None = None
    steps = 0
    while low <= high:
        steps += 1
        if steps > 80:
            raise StaticIndexError("cluster binary search did not converge")
        middle = (low + high) // 2
        start = max(0, middle - window)
        end = min(resource_bytes - 1, middle + window)
        payload = range_reader(start, end)
        relative = middle - start
        line_start = payload.rfind(b"\n", 0, relative) + 1
        line_end = payload.find(b"\n", relative)
        if line_end < 0:
            if end == resource_bytes - 1:
                line_end = len(payload)
            else:
                raise StaticIndexError("cluster line exceeds search window on the right")
        if line_start == 0 and start != 0:
            raise StaticIndexError("cluster line exceeds search window on the left")
        line = parse_cluster_line(payload[line_start:line_end])
        absolute_start = start + line_start
        absolute_end = start + line_end
        if line["key"] <= target:
            best = line
            low = absolute_end + 1
        else:
            high = absolute_start - 1
    if best is None:
        first_payload = range_reader(0, min(resource_bytes - 1, window * 2))
        line_end = first_payload.find(b"\n")
        if line_end < 0:
            raise StaticIndexError("cluster index has no complete first line")
        best = parse_cluster_line(first_payload[:line_end])
    return best, steps


def parse_cdx_block(payload: bytes, target_surt: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    try:
        expanded = gzip.decompress(payload)
    except (OSError, EOFError) as exc:
        raise StaticIndexError(f"CDX block is not valid gzip: {exc}") from exc
    captures: list[dict[str, Any]] = []
    lines = expanded.splitlines()
    first_key = None
    last_key = None
    for line_number, line in enumerate(lines, start=1):
        pieces = line.split(b" ", 2)
        if len(pieces) != 3:
            raise StaticIndexError(f"malformed CDXJ line {line_number}")
        try:
            urlkey = pieces[0].decode("utf-8")
            timestamp = pieces[1].decode("ascii")
            row = json.loads(pieces[2].decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise StaticIndexError(f"invalid CDXJ line {line_number}") from exc
        first_key = first_key or f"{urlkey} {timestamp}"
        last_key = f"{urlkey} {timestamp}"
        if urlkey != target_surt:
            continue
        if not re.fullmatch(r"\d{14}", timestamp) or not isinstance(row, dict):
            raise StaticIndexError("target capture identity is invalid")
        required = ["url", "digest", "filename", "offset", "length", "status"]
        if any(key not in row for key in required):
            raise StaticIndexError("target capture lacks required WARC fields")
        if str(row["status"]) != "200":
            continue
        offset = str(row["offset"])
        length = str(row["length"])
        if not offset.isdigit() or not length.isdigit() or int(length) <= 0:
            raise StaticIndexError("target capture byte range is invalid")
        filename = str(row["filename"])
        if not filename.startswith("crawl-data/") or ".." in filename:
            raise StaticIndexError("target capture WARC path is invalid")
        captures.append({
            "timestamp": timestamp,
            "url": str(row["url"]),
            "digest": str(row["digest"]),
            "mime": str(row.get("mime", "")),
            "filename": filename,
            "offset": int(offset),
            "length": int(length),
        })
    return captures, {
        "compressedBytes": len(payload),
        "expandedBytes": len(expanded),
        "lines": len(lines),
        "firstKey": first_key,
        "lastKey": last_key,
    }


def path_list_url(collection_id: str) -> str:
    if not COLLECTION_RE.fullmatch(collection_id):
        raise StaticIndexError(f"invalid collection id: {collection_id}")
    return f"{DATA_BASE}crawl-data/{collection_id}/cc-index.paths.gz"


def parse_path_list(payload: bytes, collection_id: str) -> dict[str, Any]:
    try:
        lines = gzip.decompress(payload).decode("utf-8").splitlines()
    except (OSError, EOFError, UnicodeDecodeError) as exc:
        raise StaticIndexError(f"invalid cc-index.paths.gz: {exc}") from exc
    prefix = f"cc-index/collections/{collection_id}/indexes/"
    shards = sorted(
        path[len(prefix):] for path in lines
        if path.startswith(prefix) and CDX_SHARD_RE.fullmatch(path[len(prefix):])
    )
    cluster = prefix + "cluster.idx"
    metadata = f"cc-index/collections/{collection_id}/metadata.yaml"
    if cluster not in lines or metadata not in lines or not shards:
        raise StaticIndexError(f"path list lacks cluster/shards for {collection_id}")
    return {"lines": len(lines), "shards": shards, "clusterPath": cluster}


def path_list_cache(data_root: Path, collection_id: str) -> tuple[bytes, Path] | None:
    directory = data_root / "archive-indexes" / "commoncrawl-index-paths" / collection_id
    candidates: list[tuple[int, str, bytes, Path]] = []
    if not directory.exists():
        return None
    for path in sorted(directory.glob("*.gz")):
        try:
            payload = path.read_bytes()
            digest = sha256_bytes(payload)
            if path.stem != digest:
                continue
            parsed = parse_path_list(payload, collection_id)
            candidates.append((len(parsed["shards"]), digest, payload, path))
        except (OSError, StaticIndexError):
            continue
    if not candidates:
        return None
    _, _, payload, path = max(candidates, key=lambda item: item[:2])
    return payload, path


def prepare_collection(
    data_root: Path,
    collection: dict[str, str],
    user_agent: str,
    timeout: int,
    retries: int,
) -> dict[str, Any]:
    collection_id = collection["id"]
    try:
        cached = path_list_cache(data_root, collection_id)
        if cached is None:
            payload, _ = fetch_bytes(path_list_url(collection_id), user_agent, timeout, retries)
            parsed = parse_path_list(payload, collection_id)
            digest = sha256_bytes(payload)
            path = (
                data_root / "archive-indexes" / "commoncrawl-index-paths" /
                collection_id / f"{digest}.gz"
            )
            write_once(path, payload)
            mode = "LIVE_AND_CONTENT_ADDRESSED_CACHE"
        else:
            payload, path = cached
            parsed = parse_path_list(payload, collection_id)
            digest = sha256_bytes(payload)
            mode = "CONTENT_ADDRESSED_CACHE"
        cluster_url = DATA_BASE + parsed["clusterPath"]
        cluster_head = head_resource(cluster_url, user_agent, timeout, retries)
        return {
            "status": "PASS",
            "collectionId": collection_id,
            "role": collection["role"],
            "pathListUrl": path_list_url(collection_id),
            "pathListSha256": digest,
            "pathListCachePath": str(path.resolve()),
            "pathListRetrievalMode": mode,
            "pathListEntries": parsed["lines"],
            "shards": parsed["shards"],
            "clusterUrl": cluster_url,
            "clusterBytes": cluster_head["bytes"],
            "clusterEtag": cluster_head["etag"],
            "clusterLastModified": cluster_head["lastModified"],
        }
    except (StaticIndexError, urllib.error.URLError, TimeoutError, OSError) as exc:
        return {
            "status": "FAILED",
            "collectionId": collection_id,
            "role": collection["role"],
            "error": f"{type(exc).__name__}: {exc}",
        }


def query_static(
    data_root: Path,
    prepared: dict[str, Any],
    source_url: str,
    user_agent: str,
    timeout: int,
    retries: int,
) -> dict[str, Any]:
    if prepared["status"] != "PASS":
        return {
            "queryStatus": "FAILED",
            "collectionId": prepared["collectionId"],
            "sourceUrl": source_url,
            "error": "collection preparation failed",
            "captureCount": None,
            "captures": [],
        }
    try:
        surt = static_surt(source_url)
        evidence_paths: set[str] = set()
        retrieval_modes: Counter[str] = Counter()
        def reader(start: int, end: int) -> bytes:
            payload, path, mode = fetch_range(
                data_root, prepared["clusterUrl"], start, end,
                user_agent, timeout, retries,
            )
            evidence_paths.add(str(path.resolve()))
            retrieval_modes[mode] += 1
            return payload
        cluster, steps = cluster_predecessor(
            surt + " 00000000000000", int(prepared["clusterBytes"]), reader,
        )
        if cluster["shard"] not in set(prepared["shards"]):
            raise StaticIndexError(f"cluster selected an unlisted shard: {cluster['shard']}")
        shard_url = (
            f"{DATA_BASE}cc-index/collections/{prepared['collectionId']}/indexes/"
            f"{cluster['shard']}"
        )
        block, block_path, block_mode = fetch_range(
            data_root, shard_url, cluster["offset"],
            cluster["offset"] + cluster["length"] - 1,
            user_agent, timeout, retries,
        )
        captures, block_meta = parse_cdx_block(block, surt)
        return {
            "queryStatus": "PASS",
            "collectionId": prepared["collectionId"],
            "collectionRole": prepared["role"],
            "sourceUrl": source_url,
            "surt": surt,
            "clusterSearchSteps": steps,
            "clusterLine": cluster,
            "clusterRangeEvidencePaths": sorted(evidence_paths),
            "clusterRangeRetrievalModes": dict(sorted(retrieval_modes.items())),
            "cdxBlockUrl": shard_url,
            "cdxBlockSha256": sha256_bytes(block),
            "cdxBlockCachePath": str(block_path.resolve()),
            "cdxBlockRetrievalMode": block_mode,
            "cdxBlock": block_meta,
            "captureCount": len(captures),
            "captures": captures,
        }
    except (StaticIndexError, urllib.error.URLError, TimeoutError, OSError) as exc:
        return {
            "queryStatus": "FAILED",
            "collectionId": prepared["collectionId"],
            "collectionRole": prepared.get("role"),
            "sourceUrl": source_url,
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
) -> dict[str, Any]:
    if workers <= 0 or workers > 12:
        raise StaticIndexError("workers must be between 1 and 12")
    individual = load_module(
        "early-detection-sec-filing-individual.py", "early_detection_individual_static",
    )
    commoncrawl = load_module(
        "early-detection-commoncrawl-filings.py", "early_detection_commoncrawl_static",
    )
    root = data_root.expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    collections, collinfo_sha, collinfo_path, collinfo_mode = commoncrawl.load_collinfo(
        root, user_agent, timeout, retries, False,
    )
    population = individual.load_candidates(events_database, from_year, to_year)
    sample = individual.deterministic_sample(population, per_stratum, seed)
    collection_plans: dict[str, list[dict[str, str]]] = {}
    unique_collections: dict[str, dict[str, str]] = {}
    for item in sample:
        plans = commoncrawl.choose_collections(collections, int(item["year"]))
        collection_plans[item["accession"]] = plans
        for collection in plans:
            unique_collections[collection["id"]] = collection
    prepared: dict[str, dict[str, Any]] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(workers, 6)) as executor:
        futures = {
            executor.submit(
                prepare_collection, root, collection, user_agent, timeout, retries,
            ): collection_id
            for collection_id, collection in sorted(unique_collections.items())
        }
        for future in concurrent.futures.as_completed(futures):
            prepared[futures[future]] = future.result()
    tasks: dict[tuple[str, str], tuple[dict[str, Any], str]] = {}
    for item in sample:
        for variant in item["urlVariants"]:
            for collection in collection_plans[item["accession"]]:
                tasks[(collection["id"], variant["sourceUrl"])] = (
                    prepared[collection["id"]], variant["sourceUrl"],
                )
    query_results: dict[tuple[str, str], dict[str, Any]] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(
                query_static, root, prep, source_url,
                user_agent, timeout, retries,
            ): key
            for key, (prep, source_url) in sorted(tasks.items())
        }
        for future in concurrent.futures.as_completed(futures):
            query_results[futures[future]] = future.result()
    statuses: Counter[str] = Counter()
    accession_results: list[dict[str, Any]] = []
    for item in sample:
        queries: list[dict[str, Any]] = []
        for variant in item["urlVariants"]:
            for collection in collection_plans[item["accession"]]:
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
            "queries": queries,
        })
    complete = statuses["CAPTURE_FOUND"] + statuses["NO_CAPTURE"]
    unsigned = {
        "schema": SCHEMA,
        "generatedAt": utc_now(),
        "status": "COMMONCRAWL_STATIC_ZIPNUM_STRATIFIED_COVERAGE",
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
        "collinfo": {
            "sourceUrl": commoncrawl.COLLINFO_URL,
            "sha256": collinfo_sha,
            "cachePath": str(collinfo_path.resolve()),
            "retrievalMode": collinfo_mode,
        },
        "collections": [prepared[key] for key in sorted(prepared)],
        "captureFound": statuses["CAPTURE_FOUND"],
        "noCapture": statuses["NO_CAPTURE"],
        "queryIncomplete": statuses["QUERY_INCOMPLETE"],
        "captureRateAmongCompleteQueries": statuses["CAPTURE_FOUND"] / complete if complete else None,
        "accessions": accession_results,
        "officialMethodSources": [
            "https://commoncrawl.org/cdxj-index",
            "https://github.com/commoncrawl/cc-index-server",
        ],
        "interpretation": [
            "Static ZipNum lookups bypass the rate-limited public CDX API.",
            "Every cluster range and compressed CDX block is preserved content-addressed.",
            "Capture presence is not content acceptance; WARC payload verification remains mandatory.",
            "Two selected collections do not prove absence from all Common Crawl collections.",
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
    if static_surt("https://www.sec.gov/Archives/EDGAR/data/7/a.txt") != "gov,sec)/archives/edgar/data/7/a.txt":
        raise StaticIndexError("self-test SURT canonicalization failed")
    cluster_fixture = (
        b"com,a)/ 20200101000000\tcdx-00000.gz\t0\t10\t1\n"
        b"gov,sec)/archives/a 20200101000000\tcdx-00001.gz\t10\t20\t2\n"
        b"org,z)/ 20200101000000\tcdx-00002.gz\t30\t40\t3\n"
    )
    def fixture_reader(start: int, end: int) -> bytes:
        return cluster_fixture[start:end + 1]
    predecessor, steps = cluster_predecessor(
        "gov,sec)/archives/b 00000000000000", len(cluster_fixture), fixture_reader, 1024,
    )
    if predecessor["shard"] != "cdx-00001.gz" or steps <= 0:
        raise StaticIndexError("self-test cluster predecessor failed")
    row = {
        "url": "https://www.sec.gov/Archives/edgar/data/7/a.txt",
        "status": "200", "digest": "ABC", "mime": "text/plain",
        "filename": "crawl-data/CC-MAIN-X/a.warc.gz", "offset": "10", "length": "20",
    }
    block = gzip.compress(
        b"gov,sec)/archives/edgar/data/7/a.txt 20200101000000 " +
        json.dumps(row).encode() + b"\n"
    )
    captures, meta = parse_cdx_block(block, "gov,sec)/archives/edgar/data/7/a.txt")
    if len(captures) != 1 or meta["lines"] != 1 or captures[0]["offset"] != 10:
        raise StaticIndexError("self-test CDX block parse failed")
    path_list = gzip.compress(
        b"cc-index/collections/CC-MAIN-2020-05/indexes/cdx-00000.gz\n"
        b"cc-index/collections/CC-MAIN-2020-05/indexes/cluster.idx\n"
        b"cc-index/collections/CC-MAIN-2020-05/metadata.yaml\n"
    )
    parsed_paths = parse_path_list(path_list, "CC-MAIN-2020-05")
    if parsed_paths["shards"] != ["cdx-00000.gz"]:
        raise StaticIndexError("self-test path list failed")
    with tempfile.TemporaryDirectory() as folder:
        root = Path(folder)
        source_url = "https://data.commoncrawl.org/example"
        payload = b"abc"
        digest = sha256_bytes(payload)
        blob_path = range_blob_path(root, digest)
        write_once(blob_path, payload)
        descriptor = {
            "schema": "early-detection-commoncrawl-range-cache/v1",
            "sourceUrl": source_url,
            "start": 0,
            "end": 2,
            "payloadSha256": digest,
            "payloadBytes": 3,
            "payloadPath": str(blob_path.resolve()),
        }
        write_once(
            range_descriptor_path(root, source_url, 0, 2),
            canonical_bytes(descriptor) + b"\n",
        )
        cached = cached_range(root, source_url, 0, 2)
        if cached is None or cached[0] != payload or cached[1] != blob_path:
            raise StaticIndexError("self-test short range cache failed")
    malformed_rejected = False
    try:
        parse_cluster_line(b"broken")
    except StaticIndexError:
        malformed_rejected = True
    if not malformed_rejected:
        raise StaticIndexError("self-test malformed cluster line did not fail closed")
    return {
        "status": "PASS",
        "surtCanonicalizationVerified": True,
        "binaryClusterSearchVerified": True,
        "cdxBlockVerified": True,
        "pathListVerified": True,
        "shortRangeCacheVerified": True,
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
    coverage.add_argument("--workers", type=int, default=8)
    coverage.add_argument("--user-agent", default=DEFAULT_USER_AGENT)
    coverage.add_argument("--timeout", type=int, default=45)
    coverage.add_argument("--retries", type=int, default=2)
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
            args.timeout, args.retries,
        )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
