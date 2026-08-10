#!/usr/bin/env python3
"""Measure and verify free SEC Oldloads coverage through immutable archives.

SEC Oldloads are daily gzip files containing complete public submissions.  The
tool uses Wayback only as a transport for the official SEC bytes because the
current runtime receives HTTP 403 from direct SEC archive requests.  A CDX hit
is only a locator.  Filing evidence is accepted only after payload digest,
gzip integrity, accession and form validation all pass.
"""

from __future__ import annotations

import argparse
import base64
import concurrent.futures
import gzip
import hashlib
import importlib.util
import io
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


SCHEMA = "early-detection-sec-oldloads-coverage/v1"
INSPECTION_SCHEMA = "early-detection-sec-oldloads-inspection/v2"
CDX_BASE = "https://web.archive.org/cdx/search/cdx"
OLDLOAD_PREFIX = "https://www.sec.gov/Archives/edgar/Oldloads/{year}/"
CDX_COLUMNS = ["timestamp", "original", "mimetype", "statuscode", "digest", "length"]
DEFAULT_USER_AGENT = (
    "Growth-Screener-Research/1.0 "
    "contact=https://github.com/Karlryl/screener-data"
)
OLDLOAD_RE = re.compile(
    r"/Oldloads/(\d{4})/QTR([1-4])/(\d{8})\.gz(?:[?#].*)?$",
    re.IGNORECASE,
)
ACCESSION_RE = re.compile(r"^\d{10}-\d{2}-\d{6}$")
HEADER_ACCESSION_RE = re.compile(
    br"(?:<ACCESSION-NUMBER>\s*|ACCESSION\s+NUMBER:\s*)([0-9-]+)",
    re.IGNORECASE,
)
HEADER_FORM_RE = re.compile(
    br"(?:<(?:CONFORMED-SUBMISSION-TYPE|FORM-TYPE|TYPE)>\s*|"
    br"CONFORMED\s+SUBMISSION\s+TYPE:\s*)([^\r\n<]+)",
    re.IGNORECASE,
)
BOUNDARY_RE = re.compile(br"<(?:SEC-DOCUMENT|SUBMISSION)>", re.IGNORECASE)


class OldloadsError(RuntimeError):
    """The Oldloads coverage or byte-level evidence contract failed."""


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


def load_module(filename: str, module_name: str) -> ModuleType:
    path = Path(__file__).resolve().with_name(filename)
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise OldloadsError(f"cannot load module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def validate_year(year: int) -> int:
    if year < 1996 or year > 2100:
        raise OldloadsError(f"year outside SEC Oldloads range: {year}")
    return year


def query_url(year: int) -> str:
    validate_year(year)
    return CDX_BASE + "?" + urllib.parse.urlencode([
        ("url", OLDLOAD_PREFIX.format(year=year)),
        ("matchType", "prefix"),
        ("output", "json"),
        ("filter", "statuscode:200"),
        ("fl", ",".join(CDX_COLUMNS)),
        ("limit", "10000"),
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
                raise OldloadsError("empty archive response")
            return payload
        except OldloadsError:
            raise
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
        if attempt < retries:
            time.sleep(min(8.0, 0.75 * (2 ** attempt)))
    raise OldloadsError(
        f"request failed after {retries + 1} attempts: {url}: "
        f"{type(last_error).__name__}: {last_error}"
    )


def fetch_limited_bytes(
    url: str,
    user_agent: str,
    timeout: int,
    retries: int,
    max_payload_bytes: int,
) -> tuple[bytes, dict[str, str]]:
    if max_payload_bytes <= 0:
        raise OldloadsError("max payload bytes must be positive")
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
                    raise OldloadsError(
                        f"replay content-length exceeds cap: {length}>{max_payload_bytes}"
                    )
                chunks: list[bytes] = []
                total = 0
                while True:
                    remaining = max_payload_bytes + 1 - total
                    chunk = response.read(min(1024 * 1024, remaining))
                    if not chunk:
                        break
                    chunks.append(chunk)
                    total += len(chunk)
                    if total > max_payload_bytes:
                        raise OldloadsError(f"replay payload exceeds cap: >{max_payload_bytes}")
            payload = b"".join(chunks)
            if not payload:
                raise OldloadsError("empty replay payload")
            return payload, headers
        except OldloadsError:
            raise
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
        if attempt < retries:
            time.sleep(min(8.0, 0.75 * (2 ** attempt)))
    raise OldloadsError(
        f"replay failed after {retries + 1} attempts: "
        f"{type(last_error).__name__}: {last_error}"
    )


def parse_positive_length(value: Any) -> int:
    text = str(value)
    if not text.isdigit() or int(text) <= 0:
        raise OldloadsError(f"invalid positive CDX record length: {value}")
    return int(text)


def parse_cdx(payload: bytes, expected_year: int) -> list[dict[str, Any]]:
    try:
        rows = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise OldloadsError("CDX response is not valid UTF-8 JSON") from exc
    if not isinstance(rows, list) or not rows or rows[0] != CDX_COLUMNS:
        raise OldloadsError("CDX columns changed or response is empty")
    parsed: list[dict[str, Any]] = []
    for values in rows[1:]:
        if not isinstance(values, list) or len(values) != len(CDX_COLUMNS):
            raise OldloadsError("malformed CDX row")
        row = dict(zip(CDX_COLUMNS, values))
        if str(row["statuscode"]) != "200":
            raise OldloadsError("non-200 row escaped CDX filter")
        match = OLDLOAD_RE.search(str(row["original"]))
        if match is None:
            continue
        year, quarter, date = int(match.group(1)), int(match.group(2)), match.group(3)
        if year != expected_year:
            raise OldloadsError(
                f"Oldloads year mismatch: expected={expected_year} actual={year}"
            )
        try:
            parsed_date = datetime.strptime(date, "%Y%m%d")
        except ValueError as exc:
            raise OldloadsError(f"invalid Oldloads date: {date}") from exc
        expected_quarter = ((parsed_date.month - 1) // 3) + 1
        if parsed_date.year != year or quarter != expected_quarter:
            raise OldloadsError(f"Oldloads path date/quarter mismatch: {row['original']}")
        timestamp = str(row["timestamp"])
        digest = str(row["digest"])
        if not re.fullmatch(r"\d{14}", timestamp):
            raise OldloadsError(f"invalid CDX timestamp: {timestamp}")
        if not re.fullmatch(r"[A-Z2-7]+", digest):
            raise OldloadsError(f"invalid CDX SHA-1 base32 digest: {digest}")
        parsed.append({
            "date": date,
            "year": year,
            "quarter": quarter,
            "timestamp": timestamp,
            "original": str(row["original"]),
            "mimetype": str(row["mimetype"]),
            "digest": digest,
            "warcRecordBytes": parse_positive_length(row["length"]),
        })
    return parsed


def select_daily_captures(
    rows: list[dict[str, Any]],
) -> tuple[dict[str, dict[str, Any]], dict[str, int]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[str(row["date"])].append(row)
    selected: dict[str, dict[str, Any]] = {}
    multiple = 0
    ambiguous = 0
    for date, candidates in sorted(grouped.items()):
        if len(candidates) > 1:
            multiple += 1
        if len({str(item["digest"]) for item in candidates}) > 1:
            ambiguous += 1
        selected[date] = min(
            candidates,
            key=lambda item: (
                int(item["warcRecordBytes"]),
                str(item["timestamp"]),
                str(item["digest"]),
                str(item["original"]),
            ),
        )
    return selected, {
        "multipleCaptureDays": multiple,
        "ambiguousDigestDays": ambiguous,
    }


def replay_url(capture: dict[str, Any]) -> str:
    return (
        f"https://web.archive.org/web/{capture['timestamp']}id_/"
        f"{capture['original']}"
    )


def cache_directory(data_root: Path, year: int) -> Path:
    return data_root / "archive-indexes" / "sec-edgar-oldloads-cdx" / str(year)


def cached_payload(data_root: Path, year: int) -> tuple[bytes, Path] | None:
    candidates: list[tuple[int, int, str, bytes, Path]] = []
    directory = cache_directory(data_root, year)
    if not directory.exists():
        return None
    for path in sorted(directory.glob("*.json")):
        try:
            payload = path.read_bytes()
            digest = sha256_bytes(payload)
            if path.stem != digest:
                continue
            rows = parse_cdx(payload, year)
            selected, _ = select_daily_captures(rows)
            candidates.append((len(selected), len(rows), digest, payload, path))
        except (OSError, OldloadsError):
            continue
    if not candidates:
        return None
    _, _, _, payload, path = max(candidates, key=lambda item: item[:3])
    return payload, path


def load_or_fetch_cdx(
    data_root: Path,
    year: int,
    user_agent: str,
    timeout: int,
    retries: int,
    offline: bool,
    refresh: bool,
) -> tuple[bytes, Path, str]:
    cached = None if refresh else cached_payload(data_root, year)
    if cached is not None:
        return cached[0], cached[1], "CONTENT_ADDRESSED_CACHE"
    if offline:
        raise OldloadsError(f"no valid cached Oldloads CDX payload for {year}")
    payload = fetch_bytes(query_url(year), user_agent, timeout, retries)
    parse_cdx(payload, year)
    digest = sha256_bytes(payload)
    path = cache_directory(data_root, year) / f"{digest}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_bytes() != payload:
        raise OldloadsError(f"content-addressed cache collision: {path}")
    if not path.exists():
        with path.open("xb") as handle:
            handle.write(payload)
    return payload, path, "LIVE_CDX_AND_CONTENT_ADDRESSED_CACHE"


def load_events(database: Path, from_year: int, to_year: int) -> list[dict[str, Any]]:
    path = database.expanduser().resolve()
    connection = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        schema = connection.execute("SELECT value FROM meta WHERE key='schema'").fetchone()
        if schema is None or schema[0] != "early-detection-sec-corporate-action-candidates/v1":
            raise OldloadsError("corporate-action database identity failed")
        rows = connection.execute(
            """SELECT event_id,event_class,cik,form,filed_date,accession,filing_path
                 FROM events
                WHERE CAST(substr(filed_date,1,4) AS INTEGER) BETWEEN ? AND ?
                ORDER BY filed_date,event_id""",
            (from_year, to_year),
        ).fetchall()
    finally:
        connection.close()
    events: list[dict[str, Any]] = []
    for row in rows:
        filed_date = str(row["filed_date"])
        try:
            date = datetime.strptime(filed_date, "%Y-%m-%d")
        except ValueError as exc:
            raise OldloadsError(f"invalid event filed_date: {filed_date}") from exc
        accession = str(row["accession"] or "")
        if not ACCESSION_RE.fullmatch(accession):
            raise OldloadsError(f"invalid accession for event {row['event_id']}")
        events.append({
            "eventId": int(row["event_id"]),
            "eventClass": str(row["event_class"]),
            "cik": int(row["cik"]),
            "form": str(row["form"]),
            "filedDate": filed_date,
            "dateKey": date.strftime("%Y%m%d"),
            "year": date.year,
            "accession": accession,
            "filingPath": str(row["filing_path"]),
        })
    return events


def coverage_for_year(
    year: int,
    events: list[dict[str, Any]],
    captures: dict[str, dict[str, Any]],
    diagnostics: dict[str, int],
    cdx_sha256: str,
    cdx_path: Path,
    retrieval_mode: str,
) -> dict[str, Any]:
    event_dates = {str(event["dateKey"]) for event in events}
    covered_events = [event for event in events if str(event["dateKey"]) in captures]
    accessions = {str(event["accession"]) for event in events}
    covered_accessions = {str(event["accession"]) for event in covered_events}
    selected_dates = sorted(event_dates.intersection(captures))
    lengths = [int(captures[date]["warcRecordBytes"]) for date in selected_dates]
    return {
        "year": year,
        "events": len(events),
        "uniqueAccessions": len(accessions),
        "eventDays": len(event_dates),
        "oldloadCaptureDays": len(captures),
        "coveredEventDays": len(selected_dates),
        "coveredEvents": len(covered_events),
        "coveredUniqueAccessions": len(covered_accessions),
        "eventCoverageRate": len(covered_events) / len(events) if events else None,
        "accessionCoverageRate": len(covered_accessions) / len(accessions) if accessions else None,
        "missingEventDays": sorted(event_dates.difference(captures)),
        "selectedCaptureWarcRecordBytes": sum(lengths),
        **diagnostics,
        "cdxSha256": cdx_sha256,
        "cdxCachePath": str(cdx_path.resolve()),
        "cdxRetrievalMode": retrieval_mode,
    }


def build_coverage(
    events_database: Path,
    data_root: Path,
    report_path: Path,
    from_year: int,
    to_year: int,
    workers: int,
    user_agent: str,
    timeout: int,
    retries: int,
    offline: bool,
    refresh: bool,
) -> dict[str, Any]:
    if from_year > to_year:
        raise OldloadsError("from-year must not exceed to-year")
    if workers <= 0 or workers > 16:
        raise OldloadsError("workers must be between 1 and 16")
    root = data_root.expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    events = load_events(events_database, from_year, to_year)
    by_year: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for event in events:
        by_year[int(event["year"])].append(event)

    def acquire_year(year: int) -> tuple[int, bytes, Path, str]:
        payload, path, mode = load_or_fetch_cdx(
            root, year, user_agent, timeout, retries, offline, refresh
        )
        return year, payload, path, mode

    acquired: dict[int, tuple[bytes, Path, str]] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(acquire_year, year): year
            for year in range(from_year, to_year + 1)
        }
        for future in concurrent.futures.as_completed(futures):
            year, payload, path, mode = future.result()
            acquired[year] = (payload, path, mode)

    annual: list[dict[str, Any]] = []
    all_captured_events: list[dict[str, Any]] = []
    for year in range(from_year, to_year + 1):
        payload, path, mode = acquired[year]
        rows = parse_cdx(payload, year)
        captures, diagnostics = select_daily_captures(rows)
        year_events = by_year.get(year, [])
        annual.append(coverage_for_year(
            year, year_events, captures, diagnostics,
            sha256_bytes(payload), path, mode,
        ))
        all_captured_events.extend(
            event for event in year_events if str(event["dateKey"]) in captures
        )
    accessions = {str(event["accession"]) for event in events}
    covered_accessions = {str(event["accession"]) for event in all_captured_events}
    unsigned = {
        "schema": SCHEMA,
        "generatedAt": utc_now(),
        "status": "OLDLOADS_LOCATOR_COVERAGE_ONLY_CONTENT_NOT_PROVEN",
        "eventsDatabase": str(events_database.expanduser().resolve()),
        "dataRoot": str(root),
        "fromYear": from_year,
        "toYear": to_year,
        "events": len(events),
        "uniqueAccessions": len(accessions),
        "coveredEventsByFiledDateLocator": len(all_captured_events),
        "coveredUniqueAccessionsByFiledDateLocator": len(covered_accessions),
        "eventLocatorCoverageRate": len(all_captured_events) / len(events) if events else None,
        "accessionLocatorCoverageRate": len(covered_accessions) / len(accessions) if accessions else None,
        "selectedCaptureWarcRecordBytes": sum(
            int(item["selectedCaptureWarcRecordBytes"]) for item in annual
        ),
        "annual": annual,
        "officialSource": "https://www.sec.gov/Archives/edgar/Oldloads/",
        "officialDocumentation": (
            "https://www.sec.gov/search-filings/edgar-search-assistance/"
            "accessing-edgar-data"
        ),
        "interpretation": [
            "SEC documents Oldloads as daily concatenated complete public submissions.",
            "A Wayback capture is only a locator until the raw gzip digest and filing headers pass.",
            "CDX WARC record length is resource planning evidence, not a replay byte guarantee.",
            "Missing archive dates are never imputed.",
            "No event outcome, return or confirmatory statistic was computed.",
        ],
        "confirmatoryEligible": False,
        "productiveGqsModified": False,
    }
    report = {**unsigned, "reportSha256": sha256_bytes(canonical_bytes(unsigned))}
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return report


def inspect_oldload(
    payload: bytes,
    targets: dict[str, set[str]],
    max_expanded_bytes: int,
    max_header_bytes: int = 1024 * 1024,
) -> dict[str, Any]:
    if max_expanded_bytes <= 0 or max_header_bytes <= 0:
        raise OldloadsError("inspection byte caps must be positive")
    findings = {
        accession: {"blockNumbers": set(), "observedForms": set()}
        for accession in targets
    }
    expanded = 0
    blocks = 0
    header = bytearray()

    def finalize() -> None:
        nonlocal blocks, header
        if not header:
            return
        blocks += 1
        data = bytes(header)
        accessions = {
            match.group(1).decode("ascii", errors="strict")
            for match in HEADER_ACCESSION_RE.finditer(data)
        }
        forms = {
            match.group(1).decode("ascii", errors="replace").strip()
            for match in HEADER_FORM_RE.finditer(data)
        }
        for accession in set(targets).intersection(accessions):
            findings[accession]["blockNumbers"].add(blocks)
            findings[accession]["observedForms"].update(forms)
        header = bytearray()

    try:
        with gzip.GzipFile(fileobj=io.BytesIO(payload), mode="rb") as source:
            for line in source:
                expanded += len(line)
                if expanded > max_expanded_bytes:
                    raise OldloadsError(
                        f"expanded Oldloads payload exceeds cap: {expanded}>{max_expanded_bytes}"
                    )
                if BOUNDARY_RE.search(line):
                    finalize()
                if len(header) < max_header_bytes:
                    remaining = max_header_bytes - len(header)
                    header.extend(line[:remaining])
            finalize()
    except (gzip.BadGzipFile, EOFError, OSError) as exc:
        raise OldloadsError(f"payload is not a complete readable gzip: {exc}") from exc
    if blocks == 0:
        raise OldloadsError("Oldloads gzip contained no submission blocks")
    results: list[dict[str, Any]] = []
    counts: Counter[str] = Counter()
    for accession, expected_forms in sorted(targets.items()):
        block_numbers = sorted(findings[accession]["blockNumbers"])
        observed_forms = sorted(findings[accession]["observedForms"])
        if not block_numbers:
            status = "ACCESSION_NOT_FOUND"
        elif expected_forms.intersection(observed_forms):
            status = "MATCHED_ACCESSION_AND_FORM"
        elif observed_forms:
            status = "ACCESSION_FOUND_FORM_MISMATCH"
        else:
            status = "ACCESSION_FOUND_FORM_HEADER_MISSING"
        counts[status] += 1
        results.append({
            "accession": accession,
            "expectedForms": sorted(expected_forms),
            "observedForms": observed_forms,
            "blockNumbers": block_numbers,
            "status": status,
        })
    return {
        "schema": INSPECTION_SCHEMA,
        "expandedBytes": expanded,
        "submissionBlocks": blocks,
        "maxHeaderBytesPerBlock": max_header_bytes,
        "targets": len(targets),
        "statusCounts": dict(sorted(counts.items())),
        "accessions": results,
    }


def acquire_sample(
    events_database: Path,
    data_root: Path,
    report_path: Path,
    date: str,
    user_agent: str,
    timeout: int,
    retries: int,
    max_payload_bytes: int,
    max_expanded_bytes: int,
) -> dict[str, Any]:
    if not re.fullmatch(r"\d{8}", date):
        raise OldloadsError("sample date must use YYYYMMDD")
    parsed_date = datetime.strptime(date, "%Y%m%d")
    year = parsed_date.year
    foundation = load_module("early-detection-foundation.py", "early_detection_foundation_oldloads")
    root = foundation.ensure_data_root(data_root)
    cdx_payload, cdx_path, cdx_mode = load_or_fetch_cdx(
        root, year, user_agent, timeout, retries, False, False
    )
    captures, _ = select_daily_captures(parse_cdx(cdx_payload, year))
    capture = captures.get(date)
    if capture is None:
        raise OldloadsError(f"no archived Oldloads locator for requested date: {date}")
    events = [
        event for event in load_events(events_database, year, year)
        if str(event["dateKey"]) == date
    ]
    targets: dict[str, set[str]] = defaultdict(set)
    for event in events:
        targets[str(event["accession"])].add(str(event["form"]))
    if not targets:
        raise OldloadsError(f"no candidate accessions on requested date: {date}")
    url = replay_url(capture)
    payload, headers = fetch_limited_bytes(
        url, user_agent, timeout, retries, max_payload_bytes
    )
    actual_sha1 = sha1_base32(payload)
    expected_sha1 = str(capture["digest"])
    if actual_sha1 != expected_sha1:
        raise OldloadsError(
            f"Wayback payload digest mismatch: expected={expected_sha1} actual={actual_sha1}"
        )
    inspection = inspect_oldload(payload, targets, max_expanded_bytes)
    all_matched = inspection["statusCounts"].get("MATCHED_ACCESSION_AND_FORM", 0) == len(targets)
    payload_sha256, blob_relative, blob_created = foundation.store_blob(root, ".gz", payload)
    retrieved_at = utc_now()
    observation = {
        "schema": "early-detection-sec-oldloads-observation/v1",
        "sourceClass": "sec_edgar_oldloads_wayback",
        "sourceUrl": str(capture["original"]),
        "replayUrl": url,
        "oldloadDate": date,
        "captureTimestamp": str(capture["timestamp"]),
        "captureDigestSha1Base32": expected_sha1,
        "captureWarcRecordBytes": int(capture["warcRecordBytes"]),
        "payloadSha1Base32": actual_sha1,
        "payloadSha256": payload_sha256,
        "payloadBytes": len(payload),
        "payloadPath": blob_relative.as_posix(),
        "responseHeaders": headers,
        "blobCreated": blob_created,
        "qualityState": "accepted_sample" if all_matched else "quarantined_sample",
        "inspection": inspection,
        "sourcePayloadModified": False,
        "productiveGqsModified": False,
    }
    observation_path = (
        root / "observations" / "sec-edgar-oldloads" / date /
        f"{capture['timestamp']}-{payload_sha256}-inspection-v1.json"
    )
    foundation.write_observation_once(observation_path, observation)
    unsigned = {
        "schema": "early-detection-sec-oldloads-sample/v1",
        "generatedAt": retrieved_at,
        "status": (
            "SAMPLE_CONTENT_AND_FORMS_VERIFIED"
            if all_matched else "SAMPLE_CONTENT_PARTIAL_OR_REJECTED"
        ),
        "oldloadDate": date,
        "eventRows": len(events),
        "uniqueAccessions": len(targets),
        "cdx": {
            "sha256": sha256_bytes(cdx_payload),
            "cachePath": str(cdx_path.resolve()),
            "retrievalMode": cdx_mode,
        },
        "capture": {
            "timestamp": str(capture["timestamp"]),
            "original": str(capture["original"]),
            "replayUrl": url,
            "digestSha1Base32": expected_sha1,
            "warcRecordBytes": int(capture["warcRecordBytes"]),
        },
        "payload": {
            "sha256": payload_sha256,
            "sha1Base32": actual_sha1,
            "bytes": len(payload),
            "path": str((root / blob_relative).resolve()),
            "blobCreated": blob_created,
        },
        "observationPath": str(observation_path.resolve()),
        "inspection": inspection,
        "interpretation": [
            "This proves official SEC Oldloads transport and parsing for one archived day.",
            "Population coverage remains a locator claim until every selected payload is verified.",
            "No event outcome, return or confirmatory statistic was computed.",
        ],
        "sampleOnly": True,
        "confirmatoryEligible": False,
        "productiveGqsModified": False,
    }
    report = {**unsigned, "reportSha256": sha256_bytes(canonical_bytes(unsigned))}
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return report


def reinspect_sample(
    events_database: Path,
    data_root: Path,
    source_report_path: Path,
    report_path: Path,
    max_expanded_bytes: int,
) -> dict[str, Any]:
    foundation = load_module("early-detection-foundation.py", "early_detection_foundation_oldloads_reinspect")
    root = foundation.ensure_data_root(data_root)
    source_path = source_report_path.expanduser().resolve()
    try:
        source = json.loads(source_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise OldloadsError(f"invalid source sample report: {source_path}") from exc
    if source.get("schema") != "early-detection-sec-oldloads-sample/v1":
        raise OldloadsError("source sample report identity failed")
    unsigned_source = {key: value for key, value in source.items() if key != "reportSha256"}
    if sha256_bytes(canonical_bytes(unsigned_source)) != source.get("reportSha256"):
        raise OldloadsError("source sample report signature failed")
    date = str(source.get("oldloadDate", ""))
    if not re.fullmatch(r"\d{8}", date):
        raise OldloadsError("source sample date is invalid")
    payload_path = Path(str(source.get("payload", {}).get("path", ""))).expanduser().resolve()
    if not payload_path.is_file():
        raise OldloadsError(f"preserved Oldloads payload is missing: {payload_path}")
    payload = payload_path.read_bytes()
    payload_sha256 = sha256_bytes(payload)
    if payload_sha256 != source.get("payload", {}).get("sha256"):
        raise OldloadsError("preserved Oldloads SHA-256 changed")
    capture = source.get("capture")
    if not isinstance(capture, dict):
        raise OldloadsError("source capture is missing")
    actual_sha1 = sha1_base32(payload)
    if actual_sha1 != capture.get("digestSha1Base32"):
        raise OldloadsError("preserved Oldloads Wayback SHA-1 changed")
    year = int(date[:4])
    events = [
        event for event in load_events(events_database, year, year)
        if str(event["dateKey"]) == date
    ]
    targets: dict[str, set[str]] = defaultdict(set)
    for event in events:
        targets[str(event["accession"])].add(str(event["form"]))
    if not targets:
        raise OldloadsError("no candidate accessions remain for source sample date")
    inspection = inspect_oldload(payload, targets, max_expanded_bytes)
    all_matched = inspection["statusCounts"].get("MATCHED_ACCESSION_AND_FORM", 0) == len(targets)
    stored_sha256, blob_relative, blob_created = foundation.store_blob(root, ".gz", payload)
    if stored_sha256 != payload_sha256 or blob_created:
        raise OldloadsError("preserved payload did not resolve to the immutable existing blob")
    observation = {
        "schema": "early-detection-sec-oldloads-observation/v2",
        "sourceClass": "sec_edgar_oldloads_wayback",
        "sourceUrl": str(capture.get("original", "")),
        "replayUrl": str(capture.get("replayUrl", "")),
        "oldloadDate": date,
        "captureTimestamp": str(capture.get("timestamp", "")),
        "captureDigestSha1Base32": actual_sha1,
        "captureWarcRecordBytes": int(capture.get("warcRecordBytes", 0)),
        "payloadSha1Base32": actual_sha1,
        "payloadSha256": payload_sha256,
        "payloadBytes": len(payload),
        "payloadPath": blob_relative.as_posix(),
        "blobCreated": False,
        "qualityState": "accepted_sample" if all_matched else "quarantined_sample",
        "inspection": inspection,
        "reinspectionSourceReport": str(source_path),
        "sourcePayloadModified": False,
        "productiveGqsModified": False,
    }
    observation_path = (
        root / "observations" / "sec-edgar-oldloads" / date /
        f"{capture.get('timestamp', '')}-{payload_sha256}-inspection-v2.json"
    )
    foundation.write_observation_once(observation_path, observation)
    unsigned = {
        "schema": "early-detection-sec-oldloads-sample/v2",
        "generatedAt": utc_now(),
        "status": (
            "SAMPLE_CONTENT_AND_FORMS_VERIFIED"
            if all_matched else "SAMPLE_CONTENT_PARTIAL_OR_REJECTED"
        ),
        "sourceReport": str(source_path),
        "oldloadDate": date,
        "eventRows": len(events),
        "uniqueAccessions": len(targets),
        "capture": capture,
        "payload": {
            "sha256": payload_sha256,
            "sha1Base32": actual_sha1,
            "bytes": len(payload),
            "path": str(payload_path),
            "blobCreated": False,
        },
        "observationPath": str(observation_path.resolve()),
        "inspection": inspection,
        "interpretation": [
            "The raw payload and rejected v1 inspection remain immutable.",
            "Parser v2 recognizes the actual SUBMISSION boundaries in SEC Oldloads.",
            "This proves byte-level transport and header matching only for one day.",
            "No event outcome, return or confirmatory statistic was computed.",
        ],
        "sampleOnly": True,
        "confirmatoryEligible": False,
        "productiveGqsModified": False,
    }
    report = {**unsigned, "reportSha256": sha256_bytes(canonical_bytes(unsigned))}
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return report


def self_test() -> dict[str, Any]:
    fixture = json.dumps([
        CDX_COLUMNS,
        [
            "20210101010101",
            "https://www.sec.gov/Archives/edgar/Oldloads/2020/QTR1/20200102.gz",
            "application/gzip", "200", "A", "100",
        ],
        [
            "20210102010101",
            "https://www.sec.gov/Archives/edgar/Oldloads/2020/QTR1/20200102.gz",
            "application/gzip", "200", "B", "90",
        ],
        [
            "20210103010101",
            "https://www.sec.gov/Archives/edgar/Oldloads/2020/QTR1/20200103.gz",
            "application/gzip", "200", "C", "200",
        ],
        [
            "20210104010101",
            "https://www.sec.gov/Archives/edgar/Oldloads/2020/QTR1/index.json",
            "application/json", "200", "D", "12",
        ],
    ]).encode("utf-8")
    rows = parse_cdx(fixture, 2020)
    captures, diagnostics = select_daily_captures(rows)
    if len(rows) != 3 or len(captures) != 2:
        raise OldloadsError("self-test CDX parse failed")
    if captures["20200102"]["digest"] != "B" or diagnostics != {
        "multipleCaptureDays": 1, "ambiguousDigestDays": 1,
    }:
        raise OldloadsError("self-test capture selection failed")
    submission_a = (
        b"<SEC-DOCUMENT>\n"
        b"ACCESSION NUMBER: 0000000000-20-000001\n"
        b"CONFORMED SUBMISSION TYPE: 25-NSE\n"
        b"<DOCUMENT>\nhello\n"
    )
    submission_b = (
        b"<SEC-DOCUMENT>\n"
        b"<ACCESSION-NUMBER>0000000000-20-000002\n"
        b"<TYPE>15-12G\n"
        b"<DOCUMENT>\nworld\n"
    )
    buffer = io.BytesIO()
    with gzip.GzipFile(fileobj=buffer, mode="wb") as target:
        target.write(submission_a + submission_b)
    inspection = inspect_oldload(
        buffer.getvalue(),
        {
            "0000000000-20-000001": {"25-NSE"},
            "0000000000-20-000002": {"15-12G"},
            "0000000000-20-999999": {"15-12G"},
        },
        1024 * 1024,
    )
    if inspection["statusCounts"] != {
        "ACCESSION_NOT_FOUND": 1,
        "MATCHED_ACCESSION_AND_FORM": 2,
    }:
        raise OldloadsError("self-test gzip inspection failed")
    with tempfile.TemporaryDirectory() as folder:
        root = Path(folder)
        database = root / "events.sqlite"
        connection = sqlite3.connect(database)
        connection.executescript("""
            CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
            INSERT INTO meta VALUES('schema','early-detection-sec-corporate-action-candidates/v1');
            CREATE TABLE events(
              event_id INTEGER PRIMARY KEY,event_class TEXT,cik INTEGER,form TEXT,
              filed_date TEXT,accession TEXT,filing_path TEXT
            );
            INSERT INTO events VALUES(1,'DELISTING_FORM25_CANDIDATE',7,'25-NSE','2020-01-02','0000000000-20-000001','edgar/data/7/a.txt');
            INSERT INTO events VALUES(2,'DEREGISTRATION_FORM15_CANDIDATE',8,'15-12G','2020-01-04','0000000000-20-000002','edgar/data/8/b.txt');
        """)
        connection.commit()
        connection.close()
        directory = cache_directory(root, 2020)
        directory.mkdir(parents=True)
        digest = sha256_bytes(fixture)
        (directory / f"{digest}.json").write_bytes(fixture)
        report = build_coverage(
            database, root, root / "report.json", 2020, 2020, 1,
            DEFAULT_USER_AGENT, 1, 0, True, False,
        )
        if report["events"] != 2 or report["coveredEventsByFiledDateLocator"] != 1:
            raise OldloadsError("self-test coverage math failed")
        if report["selectedCaptureWarcRecordBytes"] != 90:
            raise OldloadsError("self-test resource accounting failed")
    malformed_rejected = False
    try:
        parse_cdx(json.dumps([CDX_COLUMNS, ["x"]]).encode("utf-8"), 2020)
    except OldloadsError:
        malformed_rejected = True
    if not malformed_rejected:
        raise OldloadsError("self-test malformed CDX did not fail closed")
    return {
        "status": "PASS",
        "cdxParsed": True,
        "deterministicCaptureSelection": True,
        "offlineCacheVerified": True,
        "coverageMathVerified": True,
        "gzipInspectionVerified": True,
        "classicAndSgmlHeadersVerified": True,
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
    coverage.add_argument("--workers", type=int, default=4)
    coverage.add_argument("--user-agent", default=DEFAULT_USER_AGENT)
    coverage.add_argument("--timeout", type=int, default=60)
    coverage.add_argument("--retries", type=int, default=3)
    coverage.add_argument("--offline", action="store_true")
    coverage.add_argument("--refresh", action="store_true")
    sample = sub.add_parser("acquire-sample")
    sample.add_argument("--events-database", type=Path, required=True)
    sample.add_argument("--data-root", type=Path, required=True)
    sample.add_argument("--report", type=Path, required=True)
    sample.add_argument("--date", required=True)
    sample.add_argument("--user-agent", default=DEFAULT_USER_AGENT)
    sample.add_argument("--timeout", type=int, default=180)
    sample.add_argument("--retries", type=int, default=2)
    sample.add_argument("--max-payload-bytes", type=int, default=1024 * 1024 * 1024)
    sample.add_argument("--max-expanded-bytes", type=int, default=8 * 1024 * 1024 * 1024)
    reinspect = sub.add_parser("reinspect-sample")
    reinspect.add_argument("--events-database", type=Path, required=True)
    reinspect.add_argument("--data-root", type=Path, required=True)
    reinspect.add_argument("--source-report", type=Path, required=True)
    reinspect.add_argument("--report", type=Path, required=True)
    reinspect.add_argument("--max-expanded-bytes", type=int, default=8 * 1024 * 1024 * 1024)
    sub.add_parser("self-test")
    return value


def main() -> int:
    args = parser().parse_args()
    try:
        if args.command == "coverage":
            result = build_coverage(
                args.events_database, args.data_root, args.report,
                args.from_year, args.to_year, args.workers,
                args.user_agent, args.timeout, args.retries,
                args.offline, args.refresh,
            )
        elif args.command == "acquire-sample":
            result = acquire_sample(
                args.events_database, args.data_root, args.report, args.date,
                args.user_agent, args.timeout, args.retries,
                args.max_payload_bytes, args.max_expanded_bytes,
            )
        elif args.command == "reinspect-sample":
            result = reinspect_sample(
                args.events_database, args.data_root, args.source_report,
                args.report, args.max_expanded_bytes,
            )
        else:
            result = self_test()
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (OldloadsError, OSError, ValueError, sqlite3.Error) as exc:
        print(json.dumps({
            "status": "FAIL", "error": f"{type(exc).__name__}: {exc}"
        }, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
