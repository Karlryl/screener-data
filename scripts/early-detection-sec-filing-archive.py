#!/usr/bin/env python3
"""Quantify free archive coverage for SEC Form 25/15 source submissions.

The tool is deliberately limited to archive discovery and transport planning.
It does not treat a Wayback capture as proof that an accession is present in a
daily EDGAR feed.  Content eligibility requires a later byte-level download,
archive parse and accession match.
"""

from __future__ import annotations

import argparse
import base64
import concurrent.futures
import hashlib
import importlib.util
import io
import json
import re
import sqlite3
import statistics
import tarfile
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


SCHEMA = "early-detection-sec-filing-archive-coverage/v1"
CDX_BASE = "https://web.archive.org/cdx/search/cdx"
FEED_PREFIX = "https://www.sec.gov/Archives/edgar/Feed/{year}/"
DEFAULT_USER_AGENT = (
    "Growth-Screener-Research/1.0 "
    "contact=https://github.com/Karlryl/screener-data"
)
CDX_COLUMNS = ["timestamp", "original", "mimetype", "statuscode", "digest", "length"]
FEED_RE = re.compile(r"/(\d{8})\.nc\.tar\.gz(?:[?#].*)?$", re.IGNORECASE)
ACCESSION_RE = re.compile(r"^\d{10}-\d{2}-\d{6}$")
HEADER_ACCESSION_RE = re.compile(br"<ACCESSION-NUMBER>\s*([0-9-]+)", re.IGNORECASE)
HEADER_FORM_RE = re.compile(
    br"<(?:CONFORMED-SUBMISSION-TYPE|FORM-TYPE|TYPE)>\s*([^\r\n<]+)",
    re.IGNORECASE,
)
INSPECTION_SCHEMA = "early-detection-sec-edgar-feed-inspection/v2"


class FilingArchiveError(RuntimeError):
    """The archive coverage contract could not be proven."""


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def sha1_base32(payload: bytes) -> str:
    return base64.b32encode(hashlib.sha1(payload).digest()).decode("ascii").rstrip("=")


def load_foundation() -> ModuleType:
    path = Path(__file__).resolve().with_name("early-detection-foundation.py")
    spec = importlib.util.spec_from_file_location("early_detection_foundation_filing_archive", path)
    if spec is None or spec.loader is None:
        raise FilingArchiveError(f"cannot load foundation module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def validate_year(value: int) -> int:
    if value < 1994 or value > 2100:
        raise FilingArchiveError(f"year outside EDGAR archive range: {value}")
    return value


def query_url(year: int) -> str:
    validate_year(year)
    parameters = [
        ("url", FEED_PREFIX.format(year=year)),
        ("matchType", "prefix"),
        ("output", "json"),
        ("filter", "statuscode:200"),
        ("fl", ",".join(CDX_COLUMNS)),
        ("limit", "5000"),
    ]
    return CDX_BASE + "?" + urllib.parse.urlencode(parameters)


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
                raise FilingArchiveError("empty CDX response")
            return payload
        except (urllib.error.URLError, TimeoutError, OSError, FilingArchiveError) as exc:
            last_error = exc
        if attempt < retries:
            time.sleep(min(10.0, 1.0 * (2 ** attempt)))
    raise FilingArchiveError(
        f"CDX request failed after {retries + 1} attempts: {url}: {last_error}"
    )


def fetch_limited_bytes(
    url: str,
    user_agent: str,
    timeout: int,
    retries: int,
    max_payload_bytes: int,
) -> tuple[bytes, dict[str, str]]:
    if max_payload_bytes <= 0:
        raise FilingArchiveError("max payload bytes must be positive")
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        try:
            request = urllib.request.Request(
                url,
                headers={"User-Agent": user_agent, "Accept-Encoding": "identity"},
            )
            with urllib.request.urlopen(request, timeout=timeout) as response:
                headers = {key.lower(): value for key, value in response.headers.items()}
                content_length = headers.get("content-length", "")
                if content_length.isdigit() and int(content_length) > max_payload_bytes:
                    raise FilingArchiveError(
                        f"replay content-length exceeds cap: {content_length}>{max_payload_bytes}"
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
                        raise FilingArchiveError(
                            f"replay payload exceeds cap: >{max_payload_bytes}"
                        )
            payload = b"".join(chunks)
            if not payload:
                raise FilingArchiveError("empty replay payload")
            return payload, headers
        except FilingArchiveError:
            raise
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
        if attempt < retries:
            time.sleep(min(10.0, 1.0 * (2 ** attempt)))
    raise FilingArchiveError(
        f"replay request failed after {retries + 1} attempts: {url}: {last_error}"
    )


def parse_content_length(headers: dict[str, str]) -> int | None:
    value = headers.get("content-length", "")
    if not value:
        return None
    if not value.isdigit() or int(value) <= 0:
        raise FilingArchiveError(f"invalid replay content-length: {value}")
    return int(value)


def probe_replay(
    capture: dict[str, Any],
    user_agent: str,
    timeout: int,
    retries: int,
) -> dict[str, Any]:
    url = replay_url(capture)
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
                return {
                    "status": "HEAD_PASS",
                    "httpStatus": int(response.status),
                    "resolvedUrl": response.geturl(),
                    "contentLength": parse_content_length(headers),
                    "contentType": headers.get("content-type"),
                    "lastModified": headers.get("last-modified"),
                    "etag": headers.get("etag"),
                }
        except FilingArchiveError:
            raise
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
        if attempt < retries:
            time.sleep(min(5.0, 0.5 * (2 ** attempt)))
    return {
        "status": "HEAD_FAILED",
        "error": f"{type(last_error).__name__}: {last_error}",
        "contentLength": None,
    }


def parse_length(value: Any) -> int:
    text = str(value)
    if not text.isdigit() or int(text) <= 0:
        raise FilingArchiveError(f"invalid positive CDX record length: {value}")
    return int(text)


def parse_cdx(payload: bytes, expected_year: int) -> list[dict[str, Any]]:
    try:
        rows = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise FilingArchiveError("CDX response is not valid UTF-8 JSON") from exc
    if not isinstance(rows, list) or not rows or rows[0] != CDX_COLUMNS:
        raise FilingArchiveError("CDX columns changed or response is empty")
    parsed: list[dict[str, Any]] = []
    for values in rows[1:]:
        if not isinstance(values, list) or len(values) != len(CDX_COLUMNS):
            raise FilingArchiveError("malformed CDX row")
        row = dict(zip(CDX_COLUMNS, values))
        if str(row["statuscode"]) != "200":
            raise FilingArchiveError("non-200 row escaped the CDX filter")
        match = FEED_RE.search(str(row["original"]))
        if match is None:
            continue
        date = match.group(1)
        try:
            parsed_date = datetime.strptime(date, "%Y%m%d")
        except ValueError as exc:
            raise FilingArchiveError(f"invalid feed date in CDX row: {date}") from exc
        if parsed_date.year != expected_year:
            raise FilingArchiveError(
                f"feed archive year mismatch: expected={expected_year} actual={parsed_date.year}"
            )
        timestamp = str(row["timestamp"])
        if not re.fullmatch(r"\d{14}", timestamp):
            raise FilingArchiveError(f"invalid CDX timestamp: {timestamp}")
        parsed.append({
            "date": date,
            "timestamp": timestamp,
            "original": str(row["original"]),
            "mimetype": str(row["mimetype"]),
            "digest": str(row["digest"]),
            "warcRecordBytes": parse_length(row["length"]),
        })
    return parsed


def select_daily_captures(rows: list[dict[str, Any]]) -> tuple[dict[str, dict[str, Any]], dict[str, int]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[str(row["date"])].append(row)
    selected: dict[str, dict[str, Any]] = {}
    ambiguous_digest_days = 0
    multiple_capture_days = 0
    for date, candidates in sorted(grouped.items()):
        if len(candidates) > 1:
            multiple_capture_days += 1
        if len({str(item["digest"]) for item in candidates}) > 1:
            ambiguous_digest_days += 1
        # Prefer the smallest positive WARC record to minimize transport.  The
        # digest ambiguity remains explicit; no capture becomes filing proof.
        chosen = min(
            candidates,
            key=lambda item: (
                int(item["warcRecordBytes"]),
                str(item["timestamp"]),
                str(item["digest"]),
                str(item["original"]),
            ),
        )
        selected[date] = chosen
    return selected, {
        "multipleCaptureDays": multiple_capture_days,
        "ambiguousDigestDays": ambiguous_digest_days,
    }


def replay_url(capture: dict[str, Any]) -> str:
    return (
        f"https://web.archive.org/web/{capture['timestamp']}id_/"
        f"{capture['original']}"
    )


def feed_segment(payload: bytes, offset: int) -> bytes:
    marker = b"<SEC-DOCUMENT>"
    end_marker = b"</SEC-DOCUMENT>"
    start = payload.rfind(marker, 0, offset + 1)
    end = payload.find(end_marker, offset)
    if start < 0:
        start = max(0, offset - 65536)
    if end < 0:
        end = min(len(payload), offset + 1024 * 1024)
    else:
        end += len(end_marker)
    return payload[start:end]


def inspect_feed_archive(
    payload: bytes,
    targets: dict[str, set[str]],
    max_expanded_bytes: int,
) -> dict[str, Any]:
    if max_expanded_bytes <= 0:
        raise FilingArchiveError("max expanded bytes must be positive")
    findings: dict[str, dict[str, Any]] = {
        accession: {"members": set(), "observedForms": set()}
        for accession in targets
    }
    regular_members = 0
    declared_expanded = 0
    read_expanded = 0
    member_names: list[str] = []
    try:
        with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as archive:
            members = archive.getmembers()
            for member in members:
                if not member.isfile():
                    continue
                regular_members += 1
                declared_expanded += int(member.size)
                if declared_expanded > max_expanded_bytes:
                    raise FilingArchiveError(
                        f"declared expanded archive exceeds cap: {declared_expanded}>{max_expanded_bytes}"
                    )
                handle = archive.extractfile(member)
                if handle is None:
                    raise FilingArchiveError(f"cannot read regular tar member: {member.name}")
                data = handle.read()
                read_expanded += len(data)
                if len(data) != int(member.size):
                    raise FilingArchiveError(f"tar member size mismatch: {member.name}")
                member_names.append(member.name)
                for accession in targets:
                    needle = accession.encode("ascii")
                    offset = data.find(needle)
                    if offset < 0:
                        continue
                    segment = feed_segment(data, offset)
                    parsed_accessions = {
                        match.group(1).decode("ascii", errors="strict")
                        for match in HEADER_ACCESSION_RE.finditer(segment)
                    }
                    if parsed_accessions and accession not in parsed_accessions:
                        continue
                    forms = {
                        match.group(1).decode("ascii", errors="replace").strip()
                        for match in HEADER_FORM_RE.finditer(segment)
                    }
                    findings[accession]["members"].add(member.name)
                    findings[accession]["observedForms"].update(forms)
    except (tarfile.TarError, EOFError, OSError) as exc:
        raise FilingArchiveError(f"replay payload is not a valid readable tar.gz: {exc}") from exc
    if regular_members == 0:
        raise FilingArchiveError("feed archive has no regular files")
    results: list[dict[str, Any]] = []
    status_counts: Counter[str] = Counter()
    for accession, expected_forms in sorted(targets.items()):
        members = sorted(findings[accession]["members"])
        observed_forms = sorted(findings[accession]["observedForms"])
        if not members:
            status = "ACCESSION_NOT_FOUND"
        elif expected_forms.intersection(observed_forms):
            status = "MATCHED_ACCESSION_AND_FORM"
        elif observed_forms:
            status = "ACCESSION_FOUND_FORM_MISMATCH"
        else:
            status = "ACCESSION_FOUND_FORM_HEADER_MISSING"
        status_counts[status] += 1
        results.append({
            "accession": accession,
            "expectedForms": sorted(expected_forms),
            "observedForms": observed_forms,
            "members": members,
            "status": status,
        })
    return {
        "schema": INSPECTION_SCHEMA,
        "regularMembers": regular_members,
        "memberNames": member_names,
        "declaredExpandedBytes": declared_expanded,
        "readExpandedBytes": read_expanded,
        "targets": len(targets),
        "statusCounts": dict(sorted(status_counts.items())),
        "accessions": results,
    }


def cache_directory(data_root: Path, year: int) -> Path:
    return data_root / "archive-indexes" / "sec-edgar-feed-cdx" / str(year)


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
            captures, _ = select_daily_captures(rows)
            candidates.append((len(captures), len(rows), digest, payload, path))
        except (OSError, FilingArchiveError):
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
        raise FilingArchiveError(f"no valid cached CDX payload for {year}")
    payload = fetch_bytes(query_url(year), user_agent, timeout, retries)
    parse_cdx(payload, year)
    digest = sha256_bytes(payload)
    path = cache_directory(data_root, year) / f"{digest}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_bytes() != payload:
        raise FilingArchiveError(f"content-addressed cache collision: {path}")
    if not path.exists():
        with path.open("xb") as handle:
            handle.write(payload)
    return payload, path, "LIVE_CDX_AND_CONTENT_ADDRESSED_CACHE"


def load_events(database: Path, from_year: int, to_year: int) -> list[dict[str, Any]]:
    path = database.expanduser().resolve()
    connection = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        schema_row = connection.execute(
            "SELECT value FROM meta WHERE key='schema'"
        ).fetchone()
        if schema_row is None or schema_row[0] != "early-detection-sec-corporate-action-candidates/v1":
            raise FilingArchiveError("corporate-action database identity failed")
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
            parsed_date = datetime.strptime(filed_date, "%Y-%m-%d")
        except ValueError as exc:
            raise FilingArchiveError(f"invalid event filed_date: {filed_date}") from exc
        accession = str(row["accession"] or "")
        if not ACCESSION_RE.fullmatch(accession):
            raise FilingArchiveError(f"missing or malformed accession for event {row['event_id']}")
        events.append({
            "eventId": int(row["event_id"]),
            "eventClass": str(row["event_class"]),
            "cik": int(row["cik"]),
            "form": str(row["form"]),
            "filedDate": filed_date,
            "dateKey": parsed_date.strftime("%Y%m%d"),
            "year": parsed_date.year,
            "accession": accession,
            "filingPath": str(row["filing_path"]),
        })
    return events


def byte_summary(values: list[int]) -> dict[str, int | None]:
    if not values:
        return {"sum": 0, "minimum": None, "median": None, "maximum": None}
    return {
        "sum": sum(values),
        "minimum": min(values),
        "median": int(statistics.median(values)),
        "maximum": max(values),
    }


def coverage_for_year(
    year: int,
    events: list[dict[str, Any]],
    captures: dict[str, dict[str, Any]],
    diagnostics: dict[str, int],
    cdx_sha256: str,
    cdx_path: Path,
    retrieval_mode: str,
) -> dict[str, Any]:
    dates = {str(item["dateKey"]) for item in events}
    covered_dates = dates.intersection(captures)
    accessions = {str(item["accession"]) for item in events}
    accession_dates: dict[str, set[str]] = defaultdict(set)
    for item in events:
        accession_dates[str(item["accession"])].add(str(item["dateKey"]))
    multi_date_accessions = sorted(key for key, values in accession_dates.items() if len(values) != 1)
    covered_accessions = {
        accession for accession, accession_date_values in accession_dates.items()
        if accession_date_values.intersection(captures)
    }
    covered_events = [item for item in events if str(item["dateKey"]) in captures]
    selected_lengths = [int(captures[date]["warcRecordBytes"]) for date in sorted(covered_dates)]
    return {
        "year": year,
        "events": len(events),
        "uniqueAccessions": len(accessions),
        "eventDays": len(dates),
        "feedCaptureDays": len(captures),
        "coveredEventDays": len(covered_dates),
        "coveredEvents": len(covered_events),
        "coveredUniqueAccessions": len(covered_accessions),
        "eventCoverageRate": len(covered_events) / len(events) if events else None,
        "accessionCoverageRate": len(covered_accessions) / len(accessions) if accessions else None,
        "missingEventDays": sorted(dates.difference(captures)),
        "multiDateAccessions": multi_date_accessions,
        "selectedCaptureWarcRecordBytes": byte_summary(selected_lengths),
        "multipleCaptureDays": diagnostics["multipleCaptureDays"],
        "ambiguousDigestDays": diagnostics["ambiguousDigestDays"],
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
    user_agent: str,
    timeout: int,
    retries: int,
    sleep_ms: int,
    offline: bool,
    refresh: bool,
) -> dict[str, Any]:
    validate_year(from_year)
    validate_year(to_year)
    if from_year > to_year:
        raise FilingArchiveError("from-year must not be after to-year")
    root = data_root.expanduser().resolve()
    if root == Path(root.anchor):
        raise FilingArchiveError("data root cannot be a filesystem root")
    root.mkdir(parents=True, exist_ok=True)
    events = load_events(events_database, from_year, to_year)
    events_by_year: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for event in events:
        events_by_year[int(event["year"])].append(event)
    annual: list[dict[str, Any]] = []
    for year in range(from_year, to_year + 1):
        payload, path, mode = load_or_fetch_cdx(
            root, year, user_agent, timeout, retries, offline, refresh,
        )
        rows = parse_cdx(payload, year)
        captures, diagnostics = select_daily_captures(rows)
        annual.append(coverage_for_year(
            year, events_by_year.get(year, []), captures, diagnostics,
            sha256_bytes(payload), path, mode,
        ))
        if sleep_ms and year != to_year and mode.startswith("LIVE"):
            time.sleep(sleep_ms / 1000)
    total_events = sum(int(row["events"]) for row in annual)
    total_accessions = len({str(item["accession"]) for item in events})
    covered_events = sum(int(row["coveredEvents"]) for row in annual)
    # Accessions are SEC-global.  The fail-closed multi-date check prevents
    # summing one accession twice across different filing dates or years.
    multi_date = sorted({value for row in annual for value in row["multiDateAccessions"]})
    if multi_date:
        raise FilingArchiveError(
            f"accessions occur on multiple filed dates; coverage is ambiguous: {multi_date[:5]}"
        )
    covered_accessions = sum(int(row["coveredUniqueAccessions"]) for row in annual)
    locator_bytes = sum(
        int(row["selectedCaptureWarcRecordBytes"]["sum"]) for row in annual
    )
    unsigned = {
        "schema": SCHEMA,
        "generatedAt": utc_now(),
        "status": "ARCHIVE_LOCATOR_COVERAGE_ONLY_CONTENT_NOT_PROVEN",
        "eventsDatabase": str(events_database.expanduser().resolve()),
        "dataRoot": str(root),
        "fromYear": from_year,
        "toYear": to_year,
        "events": total_events,
        "uniqueAccessions": total_accessions,
        "coveredEventsByFiledDateLocator": covered_events,
        "coveredUniqueAccessionsByFiledDateLocator": covered_accessions,
        "eventLocatorCoverageRate": covered_events / total_events if total_events else None,
        "accessionLocatorCoverageRate": covered_accessions / total_accessions if total_accessions else None,
        "selectedCaptureWarcRecordBytes": locator_bytes,
        "annual": annual,
        "interpretation": [
            "A captured daily feed is only a locator; it does not prove that a candidate accession is present.",
            "CDX length is the archived WARC record length, not a byte-exact promise for replay payload size.",
            "The smallest capture per date is selected for resource planning; digest ambiguity remains reported.",
            "A filing becomes eligible only after raw-byte preservation, archive parsing, accession matching and form validation.",
            "Missing feed dates require a separate per-accession archive fallback and cannot be imputed.",
        ],
        "confirmatoryEligible": False,
        "productiveGqsModified": False,
    }
    report = {**unsigned, "reportSha256": sha256_bytes(canonical_bytes(unsigned))}
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def choose_sample(
    events: list[dict[str, Any]],
    data_root: Path,
    requested_date: str | None,
) -> tuple[str, dict[str, Any], Path, str]:
    event_dates = {str(event["dateKey"]) for event in events}
    if requested_date is not None:
        if not re.fullmatch(r"\d{8}", requested_date):
            raise FilingArchiveError("sample date must use YYYYMMDD")
        try:
            datetime.strptime(requested_date, "%Y%m%d")
        except ValueError as exc:
            raise FilingArchiveError(f"invalid sample date: {requested_date}") from exc
        if requested_date not in event_dates:
            raise FilingArchiveError(f"sample date has no candidate events: {requested_date}")
    candidates: list[tuple[int, str, str, dict[str, Any], Path]] = []
    for year in sorted({int(event["year"]) for event in events}):
        cached = cached_payload(data_root, year)
        if cached is None:
            raise FilingArchiveError(f"no valid cached CDX payload for sample year {year}")
        captures, _ = select_daily_captures(parse_cdx(cached[0], year))
        for date, capture in captures.items():
            if date not in event_dates or (requested_date is not None and date != requested_date):
                continue
            candidates.append((
                int(capture["warcRecordBytes"]),
                date,
                str(capture["timestamp"]),
                capture,
                cached[1],
            ))
    if not candidates:
        qualifier = requested_date or "any candidate date"
        raise FilingArchiveError(f"no cached feed capture covers {qualifier}")
    _, date, _, capture, cache_path = min(candidates, key=lambda item: item[:3])
    return date, capture, cache_path, sha256_bytes(cache_path.read_bytes())


def sample_candidates(
    events: list[dict[str, Any]],
    data_root: Path,
) -> list[dict[str, Any]]:
    event_dates = {str(event["dateKey"]) for event in events}
    result: list[dict[str, Any]] = []
    for year in sorted({int(event["year"]) for event in events}):
        cached = cached_payload(data_root, year)
        if cached is None:
            raise FilingArchiveError(f"no valid cached CDX payload for probe year {year}")
        captures, _ = select_daily_captures(parse_cdx(cached[0], year))
        for date, capture in captures.items():
            if date in event_dates:
                result.append({"date": date, **capture})
    return sorted(
        result,
        key=lambda row: (
            int(row["warcRecordBytes"]), str(row["date"]), str(row["timestamp"]),
        ),
    )


def probe_sizes(
    events_database: Path,
    data_root: Path,
    report_path: Path,
    from_year: int,
    to_year: int,
    limit: int,
    workers: int,
    user_agent: str,
    timeout: int,
    retries: int,
) -> dict[str, Any]:
    if limit <= 0 or limit > 5000:
        raise FilingArchiveError("probe limit must be between 1 and 5000")
    if workers <= 0 or workers > 16:
        raise FilingArchiveError("probe workers must be between 1 and 16")
    root = data_root.expanduser().resolve()
    events = load_events(events_database, from_year, to_year)
    candidates = sample_candidates(events, root)[:limit]
    def run(candidate: dict[str, Any]) -> dict[str, Any]:
        probe = probe_replay(candidate, user_agent, timeout, retries)
        return {
            "date": str(candidate["date"]),
            "captureTimestamp": str(candidate["timestamp"]),
            "original": str(candidate["original"]),
            "replayUrl": replay_url(candidate),
            "digestSha1Base32": str(candidate["digest"]),
            "cdxWarcRecordBytes": int(candidate["warcRecordBytes"]),
            **probe,
        }
    results: list[dict[str, Any]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(run, candidate) for candidate in candidates]
        for future in concurrent.futures.as_completed(futures):
            results.append(future.result())
    results.sort(key=lambda row: (str(row["date"]), str(row["captureTimestamp"])))
    measured = sorted(
        (row for row in results if isinstance(row.get("contentLength"), int)),
        key=lambda row: (int(row["contentLength"]), str(row["date"])),
    )
    unsigned = {
        "schema": "early-detection-sec-filing-archive-size-probe/v1",
        "generatedAt": utc_now(),
        "status": "HEAD_SIZE_PROBE_PASS" if measured else "HEAD_SIZE_PROBE_NO_MEASUREMENTS",
        "eventsDatabase": str(events_database.expanduser().resolve()),
        "dataRoot": str(root),
        "selection": "SMALLEST_CDX_WARC_RECORDS_ON_CANDIDATE_EVENT_DAYS",
        "candidateDaysAvailable": len(sample_candidates(events, root)),
        "candidateDaysProbed": len(results),
        "headPass": sum(row["status"] == "HEAD_PASS" for row in results),
        "headFailed": sum(row["status"] == "HEAD_FAILED" for row in results),
        "contentLengthMeasured": len(measured),
        "smallestMeasured": measured[0] if measured else None,
        "results": results,
        "interpretation": [
            "HEAD Content-Length is a preflight guard, not a payload-integrity proof.",
            "The CDX WARC record length can differ radically from replay payload size.",
            "A selected sample must still pass replay digest, tar and accession/form validation.",
        ],
        "confirmatoryEligible": False,
        "productiveGqsModified": False,
    }
    report = {**unsigned, "reportSha256": sha256_bytes(canonical_bytes(unsigned))}
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def acquire_sample(
    events_database: Path,
    data_root: Path,
    report_path: Path,
    from_year: int,
    to_year: int,
    requested_date: str | None,
    user_agent: str,
    timeout: int,
    retries: int,
    max_payload_bytes: int,
    max_expanded_bytes: int,
) -> dict[str, Any]:
    foundation = load_foundation()
    root = foundation.ensure_data_root(data_root)
    events = load_events(events_database, from_year, to_year)
    date, capture, cdx_path, cdx_sha256 = choose_sample(events, root, requested_date)
    sample_events = [event for event in events if str(event["dateKey"]) == date]
    targets: dict[str, set[str]] = defaultdict(set)
    for event in sample_events:
        targets[str(event["accession"])].add(str(event["form"]))
    url = replay_url(capture)
    retrieved_at = utc_now()
    payload, headers = fetch_limited_bytes(
        url, user_agent, timeout, retries, max_payload_bytes,
    )
    actual_sha1 = sha1_base32(payload)
    expected_sha1 = str(capture["digest"])
    if actual_sha1 != expected_sha1:
        raise FilingArchiveError(
            f"Wayback replay digest mismatch: expected={expected_sha1} actual={actual_sha1}"
        )
    inspection = inspect_feed_archive(payload, targets, max_expanded_bytes)
    payload_sha256, blob_relative, blob_created = foundation.store_blob(
        root, ".tar.gz", payload,
    )
    all_matched = inspection["statusCounts"].get("MATCHED_ACCESSION_AND_FORM", 0) == len(targets)
    observation = {
        "schema": "early-detection-sec-edgar-feed-observation/v2",
        "sourceClass": "sec_edgar_daily_feed_wayback",
        "sourceUrl": str(capture["original"]),
        "replayUrl": url,
        "feedDate": date,
        "captureTimestamp": str(capture["timestamp"]),
        "captureDigestSha1Base32": expected_sha1,
        "captureWarcRecordBytes": int(capture["warcRecordBytes"]),
        "cdxCachePath": str(cdx_path.resolve()),
        "cdxSha256": cdx_sha256,
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
        root / "observations" / "sec-edgar-feed" / date /
        f"{capture['timestamp']}-{payload_sha256}-inspection-v2.json"
    )
    foundation.write_observation_once(observation_path, observation)
    unsigned = {
        "schema": "early-detection-sec-filing-archive-sample/v1",
        "generatedAt": retrieved_at,
        "status": (
            "SAMPLE_CONTENT_AND_FORMS_VERIFIED"
            if all_matched else "SAMPLE_CONTENT_PARTIAL_OR_REJECTED"
        ),
        "sampleSelection": "REQUESTED_DATE" if requested_date else "SMALLEST_CDX_WARC_RECORD_ON_EVENT_DATE",
        "feedDate": date,
        "eventRows": len(sample_events),
        "uniqueAccessions": len(targets),
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
            "This proves transport and parsing only for one daily archive sample.",
            "It does not close original-filing coverage for missing feed dates or all candidate accessions.",
            "No event outcome, return or confirmatory statistic was computed.",
        ],
        "sampleOnly": True,
        "confirmatoryEligible": False,
        "productiveGqsModified": False,
    }
    report = {**unsigned, "reportSha256": sha256_bytes(canonical_bytes(unsigned))}
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def reinspect_sample(
    events_database: Path,
    data_root: Path,
    source_report_path: Path,
    report_path: Path,
    max_expanded_bytes: int,
) -> dict[str, Any]:
    foundation = load_foundation()
    root = foundation.ensure_data_root(data_root)
    source_path = source_report_path.expanduser().resolve()
    try:
        source = json.loads(source_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise FilingArchiveError(f"invalid source sample report: {source_path}") from exc
    if source.get("schema") != "early-detection-sec-filing-archive-sample/v1":
        raise FilingArchiveError("source sample report identity failed")
    source_unsigned = {key: value for key, value in source.items() if key != "reportSha256"}
    if sha256_bytes(canonical_bytes(source_unsigned)) != source.get("reportSha256"):
        raise FilingArchiveError("source sample report signature failed")
    date = str(source.get("feedDate", ""))
    if not re.fullmatch(r"\d{8}", date):
        raise FilingArchiveError("source sample report feed date is invalid")
    payload_path = Path(str(source.get("payload", {}).get("path", ""))).expanduser().resolve()
    if not payload_path.is_file():
        raise FilingArchiveError(f"preserved sample payload is missing: {payload_path}")
    payload = payload_path.read_bytes()
    payload_sha256 = sha256_bytes(payload)
    if payload_sha256 != source.get("payload", {}).get("sha256"):
        raise FilingArchiveError("preserved sample SHA-256 changed")
    capture = source.get("capture")
    if not isinstance(capture, dict):
        raise FilingArchiveError("source sample capture is missing")
    actual_sha1 = sha1_base32(payload)
    if actual_sha1 != capture.get("digestSha1Base32"):
        raise FilingArchiveError("preserved sample Wayback SHA-1 changed")
    year = int(date[:4])
    events = load_events(events_database, year, year)
    sample_events = [event for event in events if str(event["dateKey"]) == date]
    targets: dict[str, set[str]] = defaultdict(set)
    for event in sample_events:
        targets[str(event["accession"])].add(str(event["form"]))
    if not targets:
        raise FilingArchiveError("no candidate accessions remain for preserved sample date")
    inspection = inspect_feed_archive(payload, targets, max_expanded_bytes)
    all_matched = inspection["statusCounts"].get("MATCHED_ACCESSION_AND_FORM", 0) == len(targets)
    payload_sha256_again, blob_relative, blob_created = foundation.store_blob(root, ".tar.gz", payload)
    if payload_sha256_again != payload_sha256 or blob_created:
        raise FilingArchiveError("preserved payload did not resolve to the existing immutable blob")
    observation = {
        "schema": "early-detection-sec-edgar-feed-observation/v2",
        "sourceClass": "sec_edgar_daily_feed_wayback",
        "sourceUrl": str(capture.get("original", "")),
        "replayUrl": str(capture.get("replayUrl", "")),
        "feedDate": date,
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
        root / "observations" / "sec-edgar-feed" / date /
        f"{capture.get('timestamp', '')}-{payload_sha256}-inspection-v2.json"
    )
    foundation.write_observation_once(observation_path, observation)
    unsigned = {
        "schema": "early-detection-sec-filing-archive-sample/v2",
        "generatedAt": utc_now(),
        "status": (
            "SAMPLE_CONTENT_AND_FORMS_VERIFIED"
            if all_matched else "SAMPLE_CONTENT_PARTIAL_OR_REJECTED"
        ),
        "sampleSelection": "LOCAL_REINSPECTION_OF_PRESERVED_PAYLOAD",
        "sourceReport": str(source_path),
        "feedDate": date,
        "eventRows": len(sample_events),
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
            "This proves transport and versioned parsing only for one daily archive sample.",
            "The original raw payload and failed v1 inspection remain immutable.",
            "It does not close original-filing coverage for all candidate accessions.",
            "No event outcome, return or confirmatory statistic was computed.",
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
    if parse_content_length({"content-length": "123"}) != 123:
        raise FilingArchiveError("self-test content-length parser failed")
    invalid_length_rejected = False
    try:
        parse_content_length({"content-length": "12.3"})
    except FilingArchiveError:
        invalid_length_rejected = True
    if not invalid_length_rejected:
        raise FilingArchiveError("self-test invalid content-length did not fail closed")
    if "from=" in query_url(2020) or "to=" in query_url(2020):
        raise FilingArchiveError("self-test query incorrectly filters capture year")
    fixture_2020 = json.dumps([
        CDX_COLUMNS,
        ["20210101010101", FEED_PREFIX.format(year=2020) + "20200102.nc.tar.gz", "application/gzip", "200", "A", "100"],
        ["20210102010101", FEED_PREFIX.format(year=2020) + "20200102.nc.tar.gz", "application/gzip", "200", "B", "90"],
        ["20210103010101", FEED_PREFIX.format(year=2020) + "20200103.nc.tar.gz", "application/gzip", "200", "C", "200"],
        ["20210104010101", FEED_PREFIX.format(year=2020) + "index.json", "application/json", "200", "D", "12"],
    ]).encode("utf-8")
    rows = parse_cdx(fixture_2020, 2020)
    captures, diagnostics = select_daily_captures(rows)
    if len(rows) != 3 or len(captures) != 2:
        raise FilingArchiveError("self-test feed parser failed")
    if captures["20200102"]["digest"] != "B" or diagnostics != {
        "multipleCaptureDays": 1, "ambiguousDigestDays": 1,
    }:
        raise FilingArchiveError("self-test capture selection failed")
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
            INSERT INTO events VALUES(2,'DEREGISTRATION_FORM15_CANDIDATE',8,'15-12G','2020-01-02','0000000000-20-000002','edgar/data/8/b.txt');
            INSERT INTO events VALUES(3,'DEREGISTRATION_FORM15_CANDIDATE',9,'15-12G','2020-01-04','0000000000-20-000003','edgar/data/9/c.txt');
        """)
        connection.commit()
        connection.close()
        directory = cache_directory(root, 2020)
        directory.mkdir(parents=True)
        digest = sha256_bytes(fixture_2020)
        (directory / f"{digest}.json").write_bytes(fixture_2020)
        report = build_coverage(
            database, root, root / "report.json", 2020, 2020,
            DEFAULT_USER_AGENT, 1, 0, 0, True, False,
        )
        if report["events"] != 3 or report["coveredEventsByFiledDateLocator"] != 2:
            raise FilingArchiveError("self-test event coverage failed")
        if report["coveredUniqueAccessionsByFiledDateLocator"] != 2:
            raise FilingArchiveError("self-test accession coverage failed")
        if report["selectedCaptureWarcRecordBytes"] != 90:
            raise FilingArchiveError("self-test byte accounting failed")
        second = build_coverage(
            database, root, root / "second.json", 2020, 2020,
            DEFAULT_USER_AGENT, 1, 0, 0, True, False,
        )
        # generatedAt is intentionally observational; all substantive fields
        # and the content-addressed CDX evidence remain stable.
        comparable = lambda item: {
            key: value for key, value in item.items()
            if key not in {"generatedAt", "reportSha256"}
        }
        if comparable(report) != comparable(second):
            raise FilingArchiveError("self-test cached rerun changed substantive coverage")
    malformed_rejected = False
    try:
        parse_cdx(json.dumps([CDX_COLUMNS, ["x"]]).encode(), 2020)
    except FilingArchiveError:
        malformed_rejected = True
    if not malformed_rejected:
        raise FilingArchiveError("self-test malformed CDX did not fail closed")
    feed = (
        b"<SEC-DOCUMENT>\n"
        b"<ACCESSION-NUMBER>0000000000-20-000001\n"
        b"<TYPE>25-NSE\n"
        b"</SEC-DOCUMENT>\n"
    )
    archive_buffer = io.BytesIO()
    with tarfile.open(fileobj=archive_buffer, mode="w:gz") as archive:
        member = tarfile.TarInfo("20200102.nc")
        member.size = len(feed)
        archive.addfile(member, io.BytesIO(feed))
    archive_inspection = inspect_feed_archive(
        archive_buffer.getvalue(),
        {
            "0000000000-20-000001": {"25-NSE"},
            "0000000000-20-999999": {"15-12G"},
        },
        1024 * 1024,
    )
    if archive_inspection["statusCounts"] != {
        "ACCESSION_NOT_FOUND": 1, "MATCHED_ACCESSION_AND_FORM": 1,
    }:
        raise FilingArchiveError("self-test archive accession/form inspection failed")
    return {
        "status": "PASS",
        "parsedFeedCaptures": 3,
        "selectedDays": 2,
        "malformedRejected": True,
        "offlineCacheVerified": True,
        "coverageMathVerified": True,
        "archiveInspectionVerified": True,
        "contentLengthGuardVerified": True,
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
    coverage.add_argument("--user-agent", default=DEFAULT_USER_AGENT)
    coverage.add_argument("--timeout", type=int, default=60)
    coverage.add_argument("--retries", type=int, default=3)
    coverage.add_argument("--sleep-ms", type=int, default=500)
    coverage.add_argument("--offline", action="store_true")
    coverage.add_argument("--refresh", action="store_true")
    sample = sub.add_parser("acquire-sample")
    sample.add_argument("--events-database", type=Path, required=True)
    sample.add_argument("--data-root", type=Path, required=True)
    sample.add_argument("--report", type=Path, required=True)
    sample.add_argument("--from-year", type=int, required=True)
    sample.add_argument("--to-year", type=int, required=True)
    sample.add_argument("--date")
    sample.add_argument("--user-agent", default=DEFAULT_USER_AGENT)
    sample.add_argument("--timeout", type=int, default=120)
    sample.add_argument("--retries", type=int, default=3)
    sample.add_argument("--max-payload-bytes", type=int, default=100 * 1024 * 1024)
    sample.add_argument("--max-expanded-bytes", type=int, default=2 * 1024 * 1024 * 1024)
    probe = sub.add_parser("probe-sizes")
    probe.add_argument("--events-database", type=Path, required=True)
    probe.add_argument("--data-root", type=Path, required=True)
    probe.add_argument("--report", type=Path, required=True)
    probe.add_argument("--from-year", type=int, required=True)
    probe.add_argument("--to-year", type=int, required=True)
    probe.add_argument("--limit", type=int, default=50)
    probe.add_argument("--workers", type=int, default=4)
    probe.add_argument("--user-agent", default=DEFAULT_USER_AGENT)
    probe.add_argument("--timeout", type=int, default=60)
    probe.add_argument("--retries", type=int, default=2)
    reinspect = sub.add_parser("reinspect-sample")
    reinspect.add_argument("--events-database", type=Path, required=True)
    reinspect.add_argument("--data-root", type=Path, required=True)
    reinspect.add_argument("--source-report", type=Path, required=True)
    reinspect.add_argument("--report", type=Path, required=True)
    reinspect.add_argument("--max-expanded-bytes", type=int, default=2 * 1024 * 1024 * 1024)
    sub.add_parser("self-test")
    return value


def main() -> int:
    args = parser().parse_args()
    if args.command == "self-test":
        result = self_test()
    elif args.command == "acquire-sample":
        result = acquire_sample(
            args.events_database, args.data_root, args.report,
            args.from_year, args.to_year, args.date,
            args.user_agent, args.timeout, args.retries,
            args.max_payload_bytes, args.max_expanded_bytes,
        )
    elif args.command == "probe-sizes":
        result = probe_sizes(
            args.events_database, args.data_root, args.report,
            args.from_year, args.to_year, args.limit, args.workers,
            args.user_agent, args.timeout, args.retries,
        )
    elif args.command == "reinspect-sample":
        result = reinspect_sample(
            args.events_database, args.data_root, args.source_report,
            args.report, args.max_expanded_bytes,
        )
    else:
        result = build_coverage(
            args.events_database, args.data_root, args.report,
            args.from_year, args.to_year, args.user_agent,
            args.timeout, args.retries, args.sleep_ms,
            args.offline, args.refresh,
        )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
