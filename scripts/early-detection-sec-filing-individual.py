#!/usr/bin/env python3
"""Measure individual Wayback coverage for SEC Form 25/15 submissions.

The sample is deterministic and stratified by filing year and candidate class.
Query failures remain unknown; they are never silently counted as no capture.
No filing outcome or return is computed by this transport-only tool.
"""

from __future__ import annotations

import argparse
import base64
import concurrent.futures
import hashlib
import importlib.util
import json
import re
import sqlite3
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from types import ModuleType
from typing import Any


SCHEMA = "early-detection-sec-filing-individual-coverage/v1"
CDX_BASE = "https://web.archive.org/cdx/search/cdx"
CDX_COLUMNS = ["timestamp", "original", "mimetype", "statuscode", "digest", "length"]
DEFAULT_USER_AGENT = (
    "Growth-Screener-Research/1.0 "
    "contact=https://github.com/Karlryl/screener-data"
)
ACCESSION_RE = re.compile(r"^\d{10}-\d{2}-\d{6}$")
FILING_PATH_RE = re.compile(r"^edgar/data/(\d+)/([^/]+\.txt)$", re.IGNORECASE)
HEADER_ACCESSION_RE = re.compile(
    br"(?:<ACCESSION-NUMBER>\s*|ACCESSION\s+NUMBER:\s*)([0-9-]+)",
    re.IGNORECASE,
)
HEADER_FORM_RE = re.compile(
    br"(?:<(?:CONFORMED-SUBMISSION-TYPE|FORM-TYPE|TYPE)>\s*|"
    br"CONFORMED\s+SUBMISSION\s+TYPE:\s*)([^\r\n<]+)",
    re.IGNORECASE,
)


class IndividualFilingError(RuntimeError):
    """Individual filing archive coverage could not be proven."""


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def sha1_base32(payload: bytes) -> str:
    return base64.b32encode(hashlib.sha1(payload).digest()).decode("ascii").rstrip("=")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def load_foundation() -> ModuleType:
    path = Path(__file__).resolve().with_name("early-detection-foundation.py")
    spec = importlib.util.spec_from_file_location("early_detection_foundation_individual", path)
    if spec is None or spec.loader is None:
        raise IndividualFilingError(f"cannot load foundation module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def query_url(source_url: str) -> str:
    return CDX_BASE + "?" + urllib.parse.urlencode([
        ("url", source_url),
        ("output", "json"),
        ("filter", "statuscode:200"),
        ("fl", ",".join(CDX_COLUMNS)),
        ("collapse", "digest"),
        ("limit", "100"),
    ])


def fetch_bytes(url: str, user_agent: str, timeout: int, retries: int) -> bytes:
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        try:
            request = urllib.request.Request(
                url,
                headers={"User-Agent": user_agent, "Accept-Encoding": "identity"},
            )
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = response.read()
            if not payload:
                raise IndividualFilingError("empty CDX response body")
            return payload
        except IndividualFilingError:
            raise
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
        if attempt < retries:
            time.sleep(min(8.0, 0.75 * (2 ** attempt)))
    raise IndividualFilingError(
        f"CDX query failed after {retries + 1} attempts: {type(last_error).__name__}: {last_error}"
    )


def fetch_limited_bytes(
    url: str,
    user_agent: str,
    timeout: int,
    retries: int,
    max_payload_bytes: int,
) -> tuple[bytes, dict[str, str]]:
    if max_payload_bytes <= 0:
        raise IndividualFilingError("max payload bytes must be positive")
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        try:
            request = urllib.request.Request(
                url,
                headers={"User-Agent": user_agent, "Accept-Encoding": "identity"},
            )
            with urllib.request.urlopen(request, timeout=timeout) as response:
                headers = {key.lower(): value for key, value in response.headers.items()}
                length = headers.get("content-length", "")
                if length.isdigit() and int(length) > max_payload_bytes:
                    raise IndividualFilingError(
                        f"replay content-length exceeds cap: {length}>{max_payload_bytes}"
                    )
                chunks: list[bytes] = []
                total = 0
                while True:
                    chunk = response.read(min(1024 * 1024, max_payload_bytes + 1 - total))
                    if not chunk:
                        break
                    chunks.append(chunk)
                    total += len(chunk)
                    if total > max_payload_bytes:
                        raise IndividualFilingError("replay payload exceeds cap")
            payload = b"".join(chunks)
            if not payload:
                raise IndividualFilingError("empty replay payload")
            return payload, headers
        except IndividualFilingError:
            raise
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
        if attempt < retries:
            time.sleep(min(8.0, 0.75 * (2 ** attempt)))
    raise IndividualFilingError(
        f"replay failed after {retries + 1} attempts: {type(last_error).__name__}: {last_error}"
    )


def replay_url(capture: dict[str, Any]) -> str:
    return f"https://web.archive.org/web/{capture['timestamp']}id_/{capture['original']}"


def inspect_submission(
    payload: bytes,
    accession: str,
    expected_forms: set[str],
) -> dict[str, Any]:
    accessions = {
        match.group(1).decode("ascii", errors="strict")
        for match in HEADER_ACCESSION_RE.finditer(payload)
    }
    forms = {
        match.group(1).decode("ascii", errors="replace").strip()
        for match in HEADER_FORM_RE.finditer(payload)
    }
    accession_match = accession in accessions
    matching_forms = sorted(expected_forms.intersection(forms))
    if accession_match and matching_forms:
        status = "MATCHED_ACCESSION_AND_FORM"
    elif not accession_match:
        status = "ACCESSION_NOT_FOUND"
    elif forms:
        status = "ACCESSION_FOUND_FORM_MISMATCH"
    else:
        status = "ACCESSION_FOUND_FORM_HEADER_MISSING"
    return {
        "schema": "early-detection-sec-individual-submission-inspection/v2",
        "accession": accession,
        "expectedForms": sorted(expected_forms),
        "observedAccessions": sorted(accessions),
        "observedForms": sorted(forms),
        "matchingForms": matching_forms,
        "status": status,
    }


def parse_cdx(payload: bytes) -> list[dict[str, Any]]:
    try:
        rows = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise IndividualFilingError("CDX response is not valid UTF-8 JSON") from exc
    if rows == []:
        return []
    if not isinstance(rows, list) or not rows or rows[0] != CDX_COLUMNS:
        raise IndividualFilingError("CDX response columns changed")
    result: list[dict[str, Any]] = []
    for values in rows[1:]:
        if not isinstance(values, list) or len(values) != len(CDX_COLUMNS):
            raise IndividualFilingError("malformed CDX row")
        row = dict(zip(CDX_COLUMNS, values))
        if str(row["statuscode"]) != "200":
            raise IndividualFilingError("non-200 row escaped CDX filter")
        timestamp = str(row["timestamp"])
        if not re.fullmatch(r"\d{14}", timestamp):
            raise IndividualFilingError(f"invalid capture timestamp: {timestamp}")
        length_text = str(row["length"])
        if not length_text.isdigit() or int(length_text) <= 0:
            raise IndividualFilingError(f"invalid capture WARC length: {length_text}")
        result.append({
            "timestamp": timestamp,
            "original": str(row["original"]),
            "mimetype": str(row["mimetype"]),
            "digest": str(row["digest"]),
            "warcRecordBytes": int(length_text),
        })
    return result


def choose_primary_path(accession: str, paths: list[str]) -> str:
    if not ACCESSION_RE.fullmatch(accession):
        raise IndividualFilingError(f"invalid accession: {accession}")
    parsed: list[tuple[bool, str]] = []
    filer_cik = int(accession[:10])
    for path in sorted(set(paths)):
        match = FILING_PATH_RE.fullmatch(path)
        if match is None:
            raise IndividualFilingError(f"invalid master-index filing path: {path}")
        parsed.append((int(match.group(1)) == filer_cik, path))
    if not parsed:
        raise IndividualFilingError(f"accession has no filing path: {accession}")
    return min(parsed, key=lambda item: (not item[0], item[1]))[1]


def filing_url_variants(accession: str, filing_path: str) -> list[dict[str, str]]:
    match = FILING_PATH_RE.fullmatch(filing_path)
    if match is None:
        raise IndividualFilingError(f"invalid filing path: {filing_path}")
    cik, filename = match.groups()
    base = "https://www.sec.gov/Archives/"
    direct = base + filing_path
    directory = base + f"edgar/data/{cik}/{accession.replace('-', '')}/{filename}"
    variants = [
        {"variant": "MASTER_INDEX_PATH", "sourceUrl": direct},
        {"variant": "ACCESSION_DIRECTORY_PATH", "sourceUrl": directory},
    ]
    seen: set[str] = set()
    return [item for item in variants if not (item["sourceUrl"] in seen or seen.add(item["sourceUrl"]))]


def load_candidates(database: Path, from_year: int, to_year: int) -> list[dict[str, Any]]:
    path = database.expanduser().resolve()
    connection = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        schema = connection.execute("SELECT value FROM meta WHERE key='schema'").fetchone()
        if schema is None or schema[0] != "early-detection-sec-corporate-action-candidates/v1":
            raise IndividualFilingError("corporate-action database identity failed")
        rows = connection.execute(
            """SELECT event_class,filed_date,accession,filing_path,form,cik
                 FROM events
                WHERE CAST(substr(filed_date,1,4) AS INTEGER) BETWEEN ? AND ?
                ORDER BY accession,filing_path""",
            (from_year, to_year),
        ).fetchall()
    finally:
        connection.close()
    grouped: dict[str, dict[str, Any]] = {}
    for row in rows:
        accession = str(row["accession"] or "")
        if not ACCESSION_RE.fullmatch(accession):
            raise IndividualFilingError(f"missing or malformed accession: {accession}")
        year = int(str(row["filed_date"])[:4])
        item = grouped.setdefault(accession, {
            "accession": accession,
            "year": year,
            "eventClasses": set(),
            "forms": set(),
            "paths": set(),
            "ciks": set(),
        })
        if item["year"] != year:
            raise IndividualFilingError(f"accession occurs in multiple filing years: {accession}")
        item["eventClasses"].add(str(row["event_class"]))
        item["forms"].add(str(row["form"]))
        item["paths"].add(str(row["filing_path"]))
        item["ciks"].add(int(row["cik"]))
    result: list[dict[str, Any]] = []
    for accession, item in grouped.items():
        if len(item["eventClasses"]) != 1:
            raise IndividualFilingError(f"accession crosses event classes: {accession}")
        path = choose_primary_path(accession, sorted(item["paths"]))
        result.append({
            "accession": accession,
            "year": item["year"],
            "eventClass": next(iter(item["eventClasses"])),
            "forms": sorted(item["forms"]),
            "primaryPath": path,
            "pathCount": len(item["paths"]),
            "cikCount": len(item["ciks"]),
            "urlVariants": filing_url_variants(accession, path),
        })
    return sorted(result, key=lambda item: (item["year"], item["eventClass"], item["accession"]))


def deterministic_sample(
    candidates: list[dict[str, Any]],
    per_stratum: int,
    seed: str,
) -> list[dict[str, Any]]:
    if per_stratum <= 0 or per_stratum > 100:
        raise IndividualFilingError("sample per stratum must be between 1 and 100")
    groups: dict[tuple[int, str], list[dict[str, Any]]] = defaultdict(list)
    for item in candidates:
        groups[(int(item["year"]), str(item["eventClass"]))].append(item)
    result: list[dict[str, Any]] = []
    for stratum, values in sorted(groups.items()):
        ranked = sorted(
            values,
            key=lambda item: (
                hashlib.sha256(f"{seed}|{item['accession']}".encode()).hexdigest(),
                item["accession"],
            ),
        )
        for item in ranked[:per_stratum]:
            result.append({**item, "stratum": {"year": stratum[0], "eventClass": stratum[1]}})
    return result


def cache_directory(data_root: Path, source_url: str) -> Path:
    key = hashlib.sha256(source_url.encode("utf-8")).hexdigest()
    return data_root / "archive-indexes" / "sec-edgar-individual-cdx" / key


def cached_payload(data_root: Path, source_url: str) -> tuple[bytes, Path] | None:
    directory = cache_directory(data_root, source_url)
    candidates: list[tuple[int, str, bytes, Path]] = []
    if not directory.exists():
        return None
    for path in sorted(directory.glob("*.json")):
        try:
            payload = path.read_bytes()
            digest = sha256_bytes(payload)
            if path.stem != digest:
                continue
            rows = parse_cdx(payload)
            candidates.append((len(rows), digest, payload, path))
        except (OSError, IndividualFilingError):
            continue
    if not candidates:
        return None
    _, _, payload, path = max(candidates, key=lambda item: item[:2])
    return payload, path


def query_variant(
    data_root: Path,
    source_url: str,
    user_agent: str,
    timeout: int,
    retries: int,
    refresh: bool,
) -> dict[str, Any]:
    cached = None if refresh else cached_payload(data_root, source_url)
    try:
        if cached is not None:
            payload, path = cached
            mode = "CONTENT_ADDRESSED_CACHE"
        else:
            payload = fetch_bytes(query_url(source_url), user_agent, timeout, retries)
            captures = parse_cdx(payload)
            digest = sha256_bytes(payload)
            path = cache_directory(data_root, source_url) / f"{digest}.json"
            path.parent.mkdir(parents=True, exist_ok=True)
            if path.exists() and path.read_bytes() != payload:
                raise IndividualFilingError(f"content-addressed cache collision: {path}")
            if not path.exists():
                with path.open("xb") as handle:
                    handle.write(payload)
            mode = "LIVE_CDX_AND_CONTENT_ADDRESSED_CACHE"
            return {
                "queryStatus": "PASS",
                "sourceUrl": source_url,
                "queryUrl": query_url(source_url),
                "retrievalMode": mode,
                "cdxSha256": digest,
                "cdxCachePath": str(path.resolve()),
                "captureCount": len(captures),
                "captures": captures,
            }
        captures = parse_cdx(payload)
        return {
            "queryStatus": "PASS",
            "sourceUrl": source_url,
            "queryUrl": query_url(source_url),
            "retrievalMode": mode,
            "cdxSha256": sha256_bytes(payload),
            "cdxCachePath": str(path.resolve()),
            "captureCount": len(captures),
            "captures": captures,
        }
    except (IndividualFilingError, urllib.error.URLError, TimeoutError, OSError) as exc:
        return {
            "queryStatus": "FAILED",
            "sourceUrl": source_url,
            "queryUrl": query_url(source_url),
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
    if workers <= 0 or workers > 16:
        raise IndividualFilingError("workers must be between 1 and 16")
    root = data_root.expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    population = load_candidates(events_database, from_year, to_year)
    sample = deterministic_sample(population, per_stratum, seed)
    tasks: dict[str, dict[str, Any]] = {}
    for item in sample:
        for variant in item["urlVariants"]:
            tasks[variant["sourceUrl"]] = variant
    results_by_url: dict[str, dict[str, Any]] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(
                query_variant, root, source_url, user_agent, timeout, retries, refresh,
            ): source_url
            for source_url in sorted(tasks)
        }
        for future in concurrent.futures.as_completed(futures):
            results_by_url[futures[future]] = future.result()
    statuses: Counter[str] = Counter()
    accession_results: list[dict[str, Any]] = []
    for item in sample:
        queries: list[dict[str, Any]] = []
        for variant in item["urlVariants"]:
            query = results_by_url[variant["sourceUrl"]]
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
            "pathCount": item["pathCount"],
            "status": status,
            "queries": queries,
        })
    complete = statuses["CAPTURE_FOUND"] + statuses["NO_CAPTURE"]
    by_stratum: list[dict[str, Any]] = []
    for (year, event_class), items in sorted(
        ((key, [row for row in accession_results if (row["year"], row["eventClass"]) == key])
         for key in {(row["year"], row["eventClass"]) for row in accession_results}),
        key=lambda value: value[0],
    ):
        counter = Counter(row["status"] for row in items)
        denominator = counter["CAPTURE_FOUND"] + counter["NO_CAPTURE"]
        by_stratum.append({
            "year": year,
            "eventClass": event_class,
            "sampled": len(items),
            "captureFound": counter["CAPTURE_FOUND"],
            "noCapture": counter["NO_CAPTURE"],
            "queryIncomplete": counter["QUERY_INCOMPLETE"],
            "captureRateAmongCompleteQueries": (
                counter["CAPTURE_FOUND"] / denominator if denominator else None
            ),
        })
    unsigned = {
        "schema": SCHEMA,
        "generatedAt": utc_now(),
        "status": "STRATIFIED_INDIVIDUAL_FILING_ARCHIVE_COVERAGE",
        "eventsDatabase": str(events_database.expanduser().resolve()),
        "dataRoot": str(root),
        "fromYear": from_year,
        "toYear": to_year,
        "populationAccessions": len(population),
        "sampling": {
            "method": "SHA256_RANK_WITHIN_YEAR_AND_EVENT_CLASS",
            "seed": seed,
            "perStratum": per_stratum,
            "sampledAccessions": len(sample),
        },
        "urlVariants": ["MASTER_INDEX_PATH", "ACCESSION_DIRECTORY_PATH"],
        "captureFound": statuses["CAPTURE_FOUND"],
        "noCapture": statuses["NO_CAPTURE"],
        "queryIncomplete": statuses["QUERY_INCOMPLETE"],
        "captureRateAmongCompleteQueries": statuses["CAPTURE_FOUND"] / complete if complete else None,
        "byStratum": by_stratum,
        "accessions": accession_results,
        "interpretation": [
            "The sample measures archive discovery only; capture content is not accepted until digest and form validation pass.",
            "Failed CDX queries remain unknown and are excluded from the capture-rate denominator.",
            "A stratified sample cannot prove population completeness.",
            "No current ticker, event outcome or return is inferred from capture presence.",
        ],
        "confirmatoryEligible": False,
        "productiveGqsModified": False,
    }
    report = {**unsigned, "reportSha256": sha256_bytes(canonical_bytes(unsigned))}
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def acquire_sample(
    source_report_path: Path,
    data_root: Path,
    report_path: Path,
    user_agent: str,
    timeout: int,
    retries: int,
    max_payload_bytes: int,
) -> dict[str, Any]:
    foundation = load_foundation()
    root = foundation.ensure_data_root(data_root)
    source_path = source_report_path.expanduser().resolve()
    try:
        source = json.loads(source_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise IndividualFilingError(f"invalid source coverage report: {source_path}") from exc
    if source.get("schema") != SCHEMA:
        raise IndividualFilingError("source coverage report identity failed")
    unsigned_source = {key: value for key, value in source.items() if key != "reportSha256"}
    if sha256_bytes(canonical_bytes(unsigned_source)) != source.get("reportSha256"):
        raise IndividualFilingError("source coverage report signature failed")
    candidates: list[dict[str, Any]] = []
    for accession_row in source.get("accessions", []):
        if accession_row.get("status") != "CAPTURE_FOUND":
            continue
        for query in accession_row.get("queries", []):
            for capture in query.get("captures", []):
                candidates.append({
                    "accession": str(accession_row["accession"]),
                    "expectedForms": set(str(value) for value in accession_row["forms"]),
                    "variant": str(query["variant"]),
                    "capture": capture,
                })
    candidates.sort(key=lambda item: (
        str(item["capture"]["timestamp"]), item["accession"], item["variant"],
    ))
    if not candidates:
        raise IndividualFilingError("source coverage report contains no capture candidate")
    attempts: list[dict[str, Any]] = []
    verified: dict[str, Any] | None = None
    for candidate in candidates:
        capture = candidate["capture"]
        url = replay_url(capture)
        try:
            payload, headers = fetch_limited_bytes(
                url, user_agent, timeout, retries, max_payload_bytes,
            )
            actual_sha1 = sha1_base32(payload)
            expected_sha1 = str(capture["digest"])
            if actual_sha1 != expected_sha1:
                raise IndividualFilingError(
                    f"Wayback replay digest mismatch: expected={expected_sha1} actual={actual_sha1}"
                )
            inspection = inspect_submission(
                payload, candidate["accession"], candidate["expectedForms"],
            )
            if inspection["status"] != "MATCHED_ACCESSION_AND_FORM":
                raise IndividualFilingError(f"submission inspection failed: {inspection['status']}")
            payload_sha256, blob_relative, blob_created = foundation.store_blob(
                root, ".txt", payload,
            )
            observation = {
                "schema": "early-detection-sec-individual-filing-observation/v2",
                "sourceClass": "sec_individual_filing_wayback",
                "sourceUrl": str(capture["original"]),
                "replayUrl": url,
                "captureTimestamp": str(capture["timestamp"]),
                "captureDigestSha1Base32": expected_sha1,
                "payloadSha1Base32": actual_sha1,
                "payloadSha256": payload_sha256,
                "payloadBytes": len(payload),
                "payloadPath": blob_relative.as_posix(),
                "accession": candidate["accession"],
                "expectedForms": sorted(candidate["expectedForms"]),
                "inspection": inspection,
                "responseHeaders": headers,
                "blobCreated": blob_created,
                "qualityState": "accepted_sample",
                "sourcePayloadModified": False,
                "productiveGqsModified": False,
            }
            observation_path = (
                root / "observations" / "sec-individual-filings" /
                candidate["accession"] /
                f"{capture['timestamp']}-{payload_sha256}-inspection-v2.json"
            )
            foundation.write_observation_once(observation_path, observation)
            verified = {
                "accession": candidate["accession"],
                "expectedForms": sorted(candidate["expectedForms"]),
                "variant": candidate["variant"],
                "capture": capture,
                "replayUrl": url,
                "payloadSha256": payload_sha256,
                "payloadSha1Base32": actual_sha1,
                "payloadBytes": len(payload),
                "payloadPath": str((root / blob_relative).resolve()),
                "blobCreated": blob_created,
                "observationPath": str(observation_path.resolve()),
                "inspection": inspection,
            }
            attempts.append({
                "accession": candidate["accession"],
                "captureTimestamp": str(capture["timestamp"]),
                "status": "VERIFIED",
            })
            break
        except (IndividualFilingError, urllib.error.URLError, TimeoutError, OSError) as exc:
            attempts.append({
                "accession": candidate["accession"],
                "captureTimestamp": str(capture.get("timestamp", "")),
                "status": "REJECTED_OR_UNAVAILABLE",
                "reason": f"{type(exc).__name__}: {exc}",
            })
    unsigned = {
        "schema": "early-detection-sec-individual-filing-sample/v2",
        "generatedAt": utc_now(),
        "status": "INDIVIDUAL_FILING_SAMPLE_VERIFIED" if verified else "NO_INDIVIDUAL_SAMPLE_VERIFIED",
        "sourceCoverageReport": str(source_path),
        "attempts": attempts,
        "verified": verified,
        "interpretation": [
            "This proves byte-level individual filing transport for one sample only.",
            "Capture time is transport provenance, not the filing's historical availability time.",
            "Population coverage remains governed by the separate stratified coverage report.",
            "No event outcome or return was computed.",
        ],
        "sampleOnly": True,
        "confirmatoryEligible": False,
        "productiveGqsModified": False,
    }
    report = {**unsigned, "reportSha256": sha256_bytes(canonical_bytes(unsigned))}
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def self_test() -> dict[str, Any]:
    empty = parse_cdx(b"[]\n")
    fixture = json.dumps([
        CDX_COLUMNS,
        ["20200102030405", "https://www.sec.gov/Archives/edgar/data/7/a.txt", "text/plain", "200", "ABC", "123"],
    ]).encode()
    parsed = parse_cdx(fixture)
    if empty != [] or len(parsed) != 1 or parsed[0]["warcRecordBytes"] != 123:
        raise IndividualFilingError("self-test CDX parser failed")
    path = choose_primary_path(
        "0000000007-20-000001",
        ["edgar/data/8/0000000007-20-000001.txt", "edgar/data/7/0000000007-20-000001.txt"],
    )
    variants = filing_url_variants("0000000007-20-000001", path)
    if path != "edgar/data/7/0000000007-20-000001.txt" or len(variants) != 2:
        raise IndividualFilingError("self-test URL selection failed")
    candidates = [
        {"accession": f"0000000007-20-{value:06d}", "year": 2020, "eventClass": "A"}
        for value in range(1, 6)
    ]
    first = deterministic_sample(candidates, 2, "seed")
    second = deterministic_sample(list(reversed(candidates)), 2, "seed")
    if [row["accession"] for row in first] != [row["accession"] for row in second]:
        raise IndividualFilingError("self-test deterministic sampling failed")
    malformed_rejected = False
    try:
        parse_cdx(b"{}")
    except IndividualFilingError:
        malformed_rejected = True
    if not malformed_rejected:
        raise IndividualFilingError("self-test malformed CDX did not fail closed")
    submission = (
        b"<SEC-HEADER>\nACCESSION NUMBER:\t0000000007-20-000001\n"
        b"CONFORMED SUBMISSION TYPE:\t25-NSE\n</SEC-HEADER>\n"
    )
    inspection = inspect_submission(
        submission, "0000000007-20-000001", {"25-NSE"},
    )
    if inspection["status"] != "MATCHED_ACCESSION_AND_FORM":
        raise IndividualFilingError("self-test submission inspection failed")
    return {
        "status": "PASS",
        "emptyCaptureSetAccepted": True,
        "captureParsed": True,
        "primaryPathVerified": True,
        "urlVariantsVerified": True,
        "deterministicSampleVerified": True,
        "malformedRejected": True,
        "submissionInspectionVerified": True,
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
    sample = sub.add_parser("acquire-sample")
    sample.add_argument("--source-report", type=Path, required=True)
    sample.add_argument("--data-root", type=Path, required=True)
    sample.add_argument("--report", type=Path, required=True)
    sample.add_argument("--user-agent", default=DEFAULT_USER_AGENT)
    sample.add_argument("--timeout", type=int, default=90)
    sample.add_argument("--retries", type=int, default=3)
    sample.add_argument("--max-payload-bytes", type=int, default=20 * 1024 * 1024)
    sub.add_parser("self-test")
    return value


def main() -> int:
    args = parser().parse_args()
    if args.command == "self-test":
        result = self_test()
    elif args.command == "acquire-sample":
        result = acquire_sample(
            args.source_report, args.data_root, args.report,
            args.user_agent, args.timeout, args.retries,
            args.max_payload_bytes,
        )
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
