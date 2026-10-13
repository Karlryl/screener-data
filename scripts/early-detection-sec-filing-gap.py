#!/usr/bin/env python3
"""Resolve the remaining free SEC filing transport gap in resumable batches.

The plan is derived only from signed Feed/Oldloads locator reports and the
corporate-action candidate database.  Batch queries reuse the content-addressed
individual-Wayback transport.  A capture is a locator, never an event outcome or
proof that the filing content has already been validated.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import importlib.util
import json
import math
import os
import re
import sqlite3
import tempfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PLAN_SCHEMA = "early-detection-sec-filing-gap-plan/v1"
BATCH_SCHEMA = "early-detection-sec-filing-gap-batch/v1"
AGGREGATE_SCHEMA = "early-detection-sec-filing-gap-aggregate/v1"
ACCESSION_RE = re.compile(r"^\d{10}-\d{2}-\d{6}$")
FILING_PATH_RE = re.compile(r"edgar/data/(\d+)/([^/]+\.txt)", re.IGNORECASE)
DEFAULT_SEED = "FEM-SEC-US@1.2.0-unresolved-filing-gap-v1"


class FilingGapError(RuntimeError):
    """The gap plan or one of its signed inputs was inconsistent."""


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def sign(value: dict[str, Any]) -> dict[str, Any]:
    return {**value, "reportSha256": sha256_bytes(canonical_bytes(value))}


def write_report(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def load_signed_report(path: Path, schema: str) -> dict[str, Any]:
    resolved = path.expanduser().resolve()
    try:
        value = json.loads(resolved.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise FilingGapError(f"invalid report: {resolved}") from exc
    if value.get("schema") != schema:
        raise FilingGapError(f"schema mismatch: {resolved}: {value.get('schema')}")
    unsigned = {key: item for key, item in value.items() if key != "reportSha256"}
    actual = sha256_bytes(canonical_bytes(unsigned))
    if actual != value.get("reportSha256"):
        raise FilingGapError(f"report signature failed: {resolved}")
    return value


def signed_input(path: Path, report: dict[str, Any]) -> dict[str, str]:
    return {
        "path": str(path.expanduser().resolve()),
        "schema": str(report["schema"]),
        "reportSha256": str(report["reportSha256"]),
    }


def missing_dates(report: dict[str, Any], from_year: int, to_year: int) -> set[str]:
    annual = report.get("annual")
    if not isinstance(annual, list):
        raise FilingGapError("coverage report annual rows are missing")
    rows = {int(item.get("year")): item for item in annual if isinstance(item, dict)}
    if set(rows) != set(range(from_year, to_year + 1)):
        raise FilingGapError("coverage report annual year set changed")
    result: set[str] = set()
    for year, row in sorted(rows.items()):
        values = row.get("missingEventDays")
        if not isinstance(values, list):
            raise FilingGapError(f"missingEventDays absent for {year}")
        for value in values:
            text = str(value)
            if not re.fullmatch(rf"{year}\d{{4}}", text):
                raise FilingGapError(f"invalid missing date: {text}")
            result.add(text)
    return result


def filing_url_variants(accession: str, paths: set[str]) -> list[dict[str, str]]:
    if not ACCESSION_RE.fullmatch(accession):
        raise FilingGapError(f"invalid accession: {accession}")
    parsed: list[tuple[bool, str]] = []
    filer_cik = int(accession[:10])
    for path in sorted(paths):
        match = FILING_PATH_RE.fullmatch(path)
        if match is None:
            raise FilingGapError(f"invalid filing path: {path}")
        parsed.append((int(match.group(1)) == filer_cik, path))
    if not parsed:
        raise FilingGapError(f"accession has no valid filing path: {accession}")
    primary = min(parsed, key=lambda item: (not item[0], item[1]))[1]
    match = FILING_PATH_RE.fullmatch(primary)
    assert match is not None
    cik, filename = match.groups()
    base = "https://www.sec.gov/Archives/"
    values = [
        {"variant": "MASTER_INDEX_PATH", "sourceUrl": base + primary},
        {
            "variant": "ACCESSION_DIRECTORY_PATH",
            "sourceUrl": (
                base
                + f"edgar/data/{cik}/{accession.replace('-', '')}/{filename}"
            ),
        },
    ]
    seen: set[str] = set()
    return [
        value
        for value in values
        if not (value["sourceUrl"] in seen or seen.add(value["sourceUrl"]))
    ]


def load_candidates(database: Path, from_year: int, to_year: int) -> list[dict[str, Any]]:
    resolved = database.expanduser().resolve()
    connection = sqlite3.connect(f"file:{resolved.as_posix()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        schema = connection.execute(
            "SELECT value FROM meta WHERE key='schema'"
        ).fetchone()
        if schema is None or schema[0] != "early-detection-sec-corporate-action-candidates/v1":
            raise FilingGapError("corporate-action database identity failed")
        rows = connection.execute(
            """SELECT event_id,event_class,form,filed_date,accession,filing_path,cik
                 FROM events
                WHERE CAST(substr(filed_date,1,4) AS INTEGER) BETWEEN ? AND ?
                ORDER BY event_id""",
            (from_year, to_year),
        ).fetchall()
    finally:
        connection.close()
    grouped: dict[str, dict[str, Any]] = {}
    for row in rows:
        accession = str(row["accession"] or "")
        filed_date = str(row["filed_date"] or "")
        if not ACCESSION_RE.fullmatch(accession):
            raise FilingGapError(f"invalid accession at event {row['event_id']}")
        try:
            parsed = datetime.strptime(filed_date, "%Y-%m-%d")
        except ValueError as exc:
            raise FilingGapError(f"invalid filed date: {filed_date}") from exc
        item = grouped.setdefault(
            accession,
            {
                "accession": accession,
                "year": parsed.year,
                "dateKeys": set(),
                "filedDates": set(),
                "eventClasses": set(),
                "forms": set(),
                "paths": set(),
                "ciks": set(),
                "eventIds": set(),
            },
        )
        if item["year"] != parsed.year:
            raise FilingGapError(f"accession crosses filing years: {accession}")
        item["dateKeys"].add(parsed.strftime("%Y%m%d"))
        item["filedDates"].add(filed_date)
        item["eventClasses"].add(str(row["event_class"]))
        item["forms"].add(str(row["form"]))
        item["paths"].add(str(row["filing_path"]))
        item["ciks"].add(int(row["cik"]))
        item["eventIds"].add(int(row["event_id"]))
    result: list[dict[str, Any]] = []
    for accession, item in sorted(grouped.items()):
        result.append(
            {
                "accession": accession,
                "year": item["year"],
                "dateKeys": sorted(item["dateKeys"]),
                "filedDates": sorted(item["filedDates"]),
                "eventClasses": sorted(item["eventClasses"]),
                "forms": sorted(item["forms"]),
                "pathCount": len(item["paths"]),
                "ciks": sorted(item["ciks"]),
                "eventIds": sorted(item["eventIds"]),
                "urlVariants": filing_url_variants(accession, item["paths"]),
            }
        )
    return result


def build_plan(
    events_database: Path,
    feed_report_path: Path,
    oldloads_report_path: Path,
    report_path: Path,
    batch_size: int,
    seed: str,
) -> dict[str, Any]:
    if batch_size <= 0 or batch_size > 1000:
        raise FilingGapError("batch size must be between 1 and 1000")
    feed = load_signed_report(
        feed_report_path, "early-detection-sec-filing-archive-coverage/v1"
    )
    oldloads = load_signed_report(
        oldloads_report_path, "early-detection-sec-oldloads-coverage/v1"
    )
    from_year = int(feed.get("fromYear", 0))
    to_year = int(feed.get("toYear", 0))
    if (from_year, to_year) != (
        int(oldloads.get("fromYear", -1)),
        int(oldloads.get("toYear", -1)),
    ):
        raise FilingGapError("bulk source year ranges differ")
    candidates = load_candidates(events_database, from_year, to_year)
    if len(candidates) != int(feed.get("uniqueAccessions", -1)):
        raise FilingGapError("feed population count changed")
    if len(candidates) != int(oldloads.get("uniqueAccessions", -1)):
        raise FilingGapError("Oldloads population count changed")
    feed_missing = missing_dates(feed, from_year, to_year)
    oldloads_missing = missing_dates(oldloads, from_year, to_year)
    unresolved: list[dict[str, Any]] = []
    union_count = 0
    for item in candidates:
        feed_found = any(value not in feed_missing for value in item["dateKeys"])
        oldloads_found = any(value not in oldloads_missing for value in item["dateKeys"])
        if feed_found or oldloads_found:
            union_count += 1
        else:
            unresolved.append(item)
    ranked = sorted(
        unresolved,
        key=lambda item: (
            sha256_bytes(f"{seed}|{item['accession']}".encode("utf-8")),
            item["accession"],
        ),
    )
    planned: list[dict[str, Any]] = []
    for index, item in enumerate(ranked):
        planned.append(
            {
                **item,
                "rank": index,
                "batchIndex": index // batch_size,
                "selectionReason": "NO_FEED_OR_OLDLOADS_FILED_DATE_LOCATOR",
            }
        )
    unsigned = {
        "schema": PLAN_SCHEMA,
        "generatedAt": utc_now(),
        "status": "UNRESOLVED_BULK_LOCATOR_ACCESSION_PLAN",
        "eventsDatabase": str(events_database.expanduser().resolve()),
        "fromYear": from_year,
        "toYear": to_year,
        "inputEvidence": [
            signed_input(feed_report_path, feed),
            signed_input(oldloads_report_path, oldloads),
        ],
        "populationAccessions": len(candidates),
        "bulkUnionAccessions": union_count,
        "unresolvedAccessions": len(planned),
        "batching": {
            "method": "SHA256_RANK",
            "seed": seed,
            "batchSize": batch_size,
            "batchCount": math.ceil(len(planned) / batch_size),
        },
        "accessions": planned,
        "interpretation": [
            "Every planned accession lacks both Feed and Oldloads filed-date locators.",
            "The order is deterministic and independent of any event outcome or return.",
            "An individual archive capture is only an incremental locator until its bytes and filing content pass validation.",
        ],
        "confirmatoryEligible": False,
        "productiveGqsModified": False,
    }
    report = sign(unsigned)
    write_report(report_path, report)
    return report


def load_individual_helper(path: Path) -> Any:
    resolved = path.expanduser().resolve()
    spec = importlib.util.spec_from_file_location("fem_sec_filing_individual", resolved)
    if spec is None or spec.loader is None:
        raise FilingGapError(f"cannot load individual transport helper: {resolved}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    for name in ("query_variant", "DEFAULT_USER_AGENT"):
        if not hasattr(module, name):
            raise FilingGapError(f"individual transport helper lacks {name}")
    return module


def build_batch(
    plan_path: Path,
    helper_path: Path,
    data_root: Path,
    report_path: Path,
    batch_index: int,
    workers: int,
    user_agent: str | None,
    timeout: int,
    retries: int,
    refresh: bool,
) -> dict[str, Any]:
    if workers <= 0 or workers > 16:
        raise FilingGapError("workers must be between 1 and 16")
    plan = load_signed_report(plan_path, PLAN_SCHEMA)
    batch_count = int(plan["batching"]["batchCount"])
    if batch_index < 0 or batch_index >= batch_count:
        raise FilingGapError(f"batch index must be between 0 and {batch_count - 1}")
    selected = [
        item for item in plan["accessions"] if int(item["batchIndex"]) == batch_index
    ]
    if not selected:
        raise FilingGapError(f"planned batch is empty: {batch_index}")
    helper = load_individual_helper(helper_path)
    root = data_root.expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    tasks = {
        variant["sourceUrl"]: variant
        for item in selected
        for variant in item["urlVariants"]
    }
    maximum_cache_path_characters = max(
        len(
            str(
                helper.cache_directory(root, source_url)
                / ("f" * 64 + ".json")
            )
        )
        for source_url in tasks
    )
    if os.name == "nt" and maximum_cache_path_characters >= 248:
        raise FilingGapError(
            "data-root is too deep for a fail-safe Windows content cache: "
            f"maximum planned path has {maximum_cache_path_characters} characters"
        )
    results_by_url: dict[str, dict[str, Any]] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(
                helper.query_variant,
                root,
                source_url,
                user_agent or helper.DEFAULT_USER_AGENT,
                timeout,
                retries,
                refresh,
            ): source_url
            for source_url in sorted(tasks)
        }
        for future in concurrent.futures.as_completed(futures):
            source_url = futures[future]
            try:
                results_by_url[source_url] = future.result()
            except Exception as exc:  # the row remains explicitly unknown
                results_by_url[source_url] = {
                    "queryStatus": "FAILED",
                    "sourceUrl": source_url,
                    "error": f"{type(exc).__name__}: {exc}",
                    "captureCount": None,
                    "captures": [],
                }
    statuses: Counter[str] = Counter()
    accessions: list[dict[str, Any]] = []
    for item in sorted(selected, key=lambda value: int(value["rank"])):
        queries: list[dict[str, Any]] = []
        for variant in item["urlVariants"]:
            queries.append(
                {"variant": variant["variant"], **results_by_url[variant["sourceUrl"]]}
            )
        if any(
            query.get("queryStatus") == "PASS"
            and int(query.get("captureCount") or 0) > 0
            for query in queries
        ):
            status = "CAPTURE_FOUND"
        elif all(query.get("queryStatus") == "PASS" for query in queries):
            status = "NO_CAPTURE"
        else:
            status = "QUERY_INCOMPLETE"
        statuses[status] += 1
        accessions.append(
            {
                "accession": item["accession"],
                "rank": item["rank"],
                "batchIndex": batch_index,
                "year": item["year"],
                "eventClasses": item["eventClasses"],
                "forms": item["forms"],
                "status": status,
                "queries": queries,
            }
        )
    complete = statuses["CAPTURE_FOUND"] + statuses["NO_CAPTURE"]
    helper_bytes = helper_path.expanduser().resolve().read_bytes()
    unsigned = {
        "schema": BATCH_SCHEMA,
        "generatedAt": utc_now(),
        "status": (
            "GAP_BATCH_QUERY_COMPLETE"
            if statuses["QUERY_INCOMPLETE"] == 0
            else "GAP_BATCH_QUERY_INCOMPLETE"
        ),
        "plan": signed_input(plan_path, plan),
        "individualTransportHelper": {
            "path": str(helper_path.expanduser().resolve()),
            "sha256": sha256_bytes(helper_bytes),
        },
        "dataRoot": str(root),
        "maximumCachePathCharacters": maximum_cache_path_characters,
        "batchIndex": batch_index,
        "plannedAccessions": len(selected),
        "captureFound": statuses["CAPTURE_FOUND"],
        "noCapture": statuses["NO_CAPTURE"],
        "queryIncomplete": statuses["QUERY_INCOMPLETE"],
        "captureRateAmongCompleteQueries": (
            statuses["CAPTURE_FOUND"] / complete if complete else None
        ),
        "accessions": accessions,
        "interpretation": [
            "This batch queries only accessions unresolved by both bulk locator transports.",
            "A capture is incremental locator evidence, not validated filing content.",
            "Incomplete queries remain unknown and are never counted as no-capture observations.",
        ],
        "confirmatoryEligible": False,
        "productiveGqsModified": False,
    }
    report = sign(unsigned)
    write_report(report_path, report)
    return report


def capture_candidates(source: dict[str, Any]) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for row in source.get("accessions", []):
        if row.get("status") != "CAPTURE_FOUND":
            continue
        for query in row.get("queries", []):
            for capture in query.get("captures", []):
                candidates.append(
                    {
                        "accession": str(row["accession"]),
                        "expectedForms": sorted(str(value) for value in row["forms"]),
                        "variant": str(query["variant"]),
                        "capture": capture,
                    }
                )
    return sorted(
        candidates,
        key=lambda item: (
            item["accession"],
            str(item["capture"]["timestamp"]),
            item["variant"],
        ),
    )


def acquire_found(
    source_batch_path: Path,
    helper_path: Path,
    data_root: Path,
    report_path: Path,
    user_agent: str | None,
    timeout: int,
    retries: int,
    max_payload_bytes: int,
) -> dict[str, Any]:
    source = load_signed_report(source_batch_path, BATCH_SCHEMA)
    candidates = capture_candidates(source)
    if not candidates:
        raise FilingGapError("source batch contains no capture candidate")
    helper = load_individual_helper(helper_path)
    foundation = helper.load_foundation()
    root = foundation.ensure_data_root(data_root)
    grouped: dict[str, list[dict[str, Any]]] = {}
    for candidate in candidates:
        grouped.setdefault(candidate["accession"], []).append(candidate)
    results: list[dict[str, Any]] = []
    total_attempts = 0
    for accession, values in sorted(grouped.items()):
        attempts: list[dict[str, Any]] = []
        verified: dict[str, Any] | None = None
        for candidate in values:
            capture = candidate["capture"]
            replay = helper.replay_url(capture)
            total_attempts += 1
            try:
                payload, headers = helper.fetch_limited_bytes(
                    replay,
                    user_agent or helper.DEFAULT_USER_AGENT,
                    timeout,
                    retries,
                    max_payload_bytes,
                )
                expected_sha1 = str(capture["digest"])
                actual_sha1 = helper.sha1_base32(payload)
                if actual_sha1 != expected_sha1:
                    raise FilingGapError(
                        "Wayback replay digest mismatch: "
                        f"expected={expected_sha1} actual={actual_sha1}"
                    )
                inspection = helper.inspect_submission(
                    payload, accession, set(candidate["expectedForms"])
                )
                if inspection.get("status") != "MATCHED_ACCESSION_AND_FORM":
                    raise FilingGapError(
                        f"submission inspection failed: {inspection.get('status')}"
                    )
                payload_sha256, blob_relative, blob_created = foundation.store_blob(
                    root, ".txt", payload
                )
                observation = {
                    "schema": "early-detection-sec-filing-gap-observation/v1",
                    "sourceClass": "sec_individual_filing_wayback_gap",
                    "sourceUrl": str(capture["original"]),
                    "replayUrl": replay,
                    "captureTimestamp": str(capture["timestamp"]),
                    "captureDigestSha1Base32": expected_sha1,
                    "payloadSha1Base32": actual_sha1,
                    "payloadSha256": payload_sha256,
                    "payloadBytes": len(payload),
                    "payloadPath": blob_relative.as_posix(),
                    "accession": accession,
                    "expectedForms": candidate["expectedForms"],
                    "inspection": inspection,
                    "responseHeaders": headers,
                    "blobCreated": blob_created,
                    "qualityState": "accepted_gap_content",
                    "captureTimeIsAvailabilityTime": False,
                    "sourcePayloadModified": False,
                    "productiveGqsModified": False,
                }
                observation_path = (
                    root
                    / "observations"
                    / "sec-individual-filing-gap"
                    / accession
                    / f"{capture['timestamp']}-{payload_sha256}-inspection-v1.json"
                )
                foundation.write_observation_once(observation_path, observation)
                verified = {
                    "accession": accession,
                    "expectedForms": candidate["expectedForms"],
                    "variant": candidate["variant"],
                    "capture": capture,
                    "replayUrl": replay,
                    "payloadSha256": payload_sha256,
                    "payloadSha1Base32": actual_sha1,
                    "payloadBytes": len(payload),
                    "payloadPath": str((root / blob_relative).resolve()),
                    "blobCreated": blob_created,
                    "observationPath": str(observation_path.resolve()),
                    "inspection": inspection,
                }
                attempts.append(
                    {
                        "captureTimestamp": str(capture["timestamp"]),
                        "status": "VERIFIED",
                    }
                )
                break
            except Exception as exc:  # every rejected transport remains explicit
                attempts.append(
                    {
                        "captureTimestamp": str(capture.get("timestamp", "")),
                        "status": "REJECTED_OR_UNAVAILABLE",
                        "reason": f"{type(exc).__name__}: {exc}",
                    }
                )
        results.append(
            {
                "accession": accession,
                "status": "CONTENT_VERIFIED" if verified else "CONTENT_UNAVAILABLE",
                "attempts": attempts,
                "verified": verified,
            }
        )
    verified_count = sum(row["status"] == "CONTENT_VERIFIED" for row in results)
    unsigned = {
        "schema": "early-detection-sec-filing-gap-content/v1",
        "generatedAt": utc_now(),
        "status": (
            "GAP_CAPTURE_CONTENT_COMPLETE"
            if verified_count == len(results)
            else "GAP_CAPTURE_CONTENT_PARTIAL"
        ),
        "sourceBatch": signed_input(source_batch_path, source),
        "individualTransportHelper": {
            "path": str(helper_path.expanduser().resolve()),
            "sha256": sha256_bytes(helper_path.expanduser().resolve().read_bytes()),
        },
        "dataRoot": str(root),
        "captureLocatorAccessions": len(results),
        "contentVerifiedAccessions": verified_count,
        "contentUnavailableAccessions": len(results) - verified_count,
        "attempts": total_attempts,
        "accessions": results,
        "interpretation": [
            "Every accepted payload passed archive SHA-1, local SHA-256, accession and form validation.",
            "The archive capture timestamp is transport provenance, never historical filing availability.",
            "Content-unavailable accessions remain unresolved and are not converted into negative evidence.",
            "No event outcome or return was accessed.",
        ],
        "confirmatoryEligible": False,
        "productiveGqsModified": False,
    }
    report = sign(unsigned)
    write_report(report_path, report)
    return report


def build_aggregate(
    plan_path: Path, batch_directory: Path, report_path: Path
) -> dict[str, Any]:
    plan = load_signed_report(plan_path, PLAN_SCHEMA)
    directory = batch_directory.expanduser().resolve()
    paths = sorted(directory.glob("*.json"))
    if not paths:
        raise FilingGapError(f"no batch reports found: {directory}")
    reports: list[tuple[Path, dict[str, Any]]] = []
    seen_batches: set[int] = set()
    seen_accessions: set[str] = set()
    statuses: Counter[str] = Counter()
    found: list[str] = []
    expected_plan_hash = str(plan["reportSha256"])
    planned_by_accession = {item["accession"]: item for item in plan["accessions"]}
    for path in paths:
        report = load_signed_report(path, BATCH_SCHEMA)
        if report.get("plan", {}).get("reportSha256") != expected_plan_hash:
            raise FilingGapError(f"batch binds a different plan: {path}")
        batch_index = int(report["batchIndex"])
        if batch_index in seen_batches:
            raise FilingGapError(f"duplicate batch index: {batch_index}")
        seen_batches.add(batch_index)
        for row in report["accessions"]:
            accession = str(row["accession"])
            if accession in seen_accessions:
                raise FilingGapError(f"duplicate accession across batches: {accession}")
            planned = planned_by_accession.get(accession)
            if planned is None or int(planned["batchIndex"]) != batch_index:
                raise FilingGapError(f"accession is outside its planned batch: {accession}")
            seen_accessions.add(accession)
            status = str(row["status"])
            if status not in {"CAPTURE_FOUND", "NO_CAPTURE", "QUERY_INCOMPLETE"}:
                raise FilingGapError(f"invalid batch status: {status}")
            statuses[status] += 1
            if status == "CAPTURE_FOUND":
                found.append(accession)
        reports.append((path, report))
    batch_count = int(plan["batching"]["batchCount"])
    missing_batches = sorted(set(range(batch_count)) - seen_batches)
    expected_accessions = {
        item["accession"]
        for item in plan["accessions"]
        if int(item["batchIndex"]) in seen_batches
    }
    if seen_accessions != expected_accessions:
        raise FilingGapError("one or more present batches do not cover their full plan slice")
    bulk_union = int(plan["bulkUnionAccessions"])
    population = int(plan["populationAccessions"])
    unsigned = {
        "schema": AGGREGATE_SCHEMA,
        "generatedAt": utc_now(),
        "status": (
            "COMPLETE_GAP_LOCATOR_QUERY"
            if not missing_batches and statuses["QUERY_INCOMPLETE"] == 0
            else "PARTIAL_GAP_LOCATOR_QUERY"
        ),
        "plan": signed_input(plan_path, plan),
        "batchReports": [signed_input(path, report) for path, report in reports],
        "plannedBatchCount": batch_count,
        "observedBatchCount": len(seen_batches),
        "missingBatchIndexes": missing_batches,
        "observedAccessions": len(seen_accessions),
        "captureFound": statuses["CAPTURE_FOUND"],
        "noCapture": statuses["NO_CAPTURE"],
        "queryIncomplete": statuses["QUERY_INCOMPLETE"],
        "incrementalLocatorAccessions": sorted(found),
        "bulkUnionAccessions": bulk_union,
        "bulkPlusObservedIndividualLocatorAccessions": bulk_union + len(found),
        "bulkPlusObservedIndividualLocatorRate": (bulk_union + len(found)) / population,
        "remainingUnqueriedOrUnknownAccessions": (
            int(plan["unresolvedAccessions"])
            - statuses["CAPTURE_FOUND"]
            - statuses["NO_CAPTURE"]
        ),
        "interpretation": [
            "Coverage improvement counts only individual captures among bulk-unresolved accessions.",
            "No-capture and query-incomplete accessions remain unresolved for content acquisition.",
            "Even a complete aggregate is locator coverage, not population content completeness.",
        ],
        "confirmatoryEligible": False,
        "productiveGqsModified": False,
    }
    report = sign(unsigned)
    write_report(report_path, report)
    return report


def self_test() -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="early-detection-filing-gap-") as raw_root:
        root = Path(raw_root)
        database = root / "events.sqlite"
        connection = sqlite3.connect(database)
        connection.executescript(
            """
            CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
            INSERT INTO meta VALUES('schema','early-detection-sec-corporate-action-candidates/v1');
            CREATE TABLE events(
              event_id INTEGER PRIMARY KEY,event_class TEXT,form TEXT,filed_date TEXT,
              accession TEXT,filing_path TEXT,cik INTEGER
            );
            INSERT INTO events VALUES
              (1,'DELISTING_FORM25_CANDIDATE','25','2020-01-02','0000000001-20-000001','edgar/data/1/a.txt',1),
              (2,'DEREGISTRATION_FORM15_CANDIDATE','15-12G','2020-01-03','0000000002-20-000002','edgar/data/2/b.txt',2),
              (3,'DELISTING_FORM25_CANDIDATE','25','2020-01-04','0000000003-20-000003','edgar/data/3/c.txt',3);
            """
        )
        connection.commit()
        connection.close()

        def coverage(schema: str, missing: list[str], covered: int) -> dict[str, Any]:
            return sign(
                {
                    "schema": schema,
                    "generatedAt": "2020-01-01T00:00:00.000Z",
                    "eventsDatabase": str(database),
                    "fromYear": 2020,
                    "toYear": 2020,
                    "events": 3,
                    "uniqueAccessions": 3,
                    "coveredEventsByFiledDateLocator": covered,
                    "coveredUniqueAccessionsByFiledDateLocator": covered,
                    "annual": [{"year": 2020, "missingEventDays": missing}],
                }
            )

        feed_path = root / "feed.json"
        old_path = root / "old.json"
        feed = coverage(
            "early-detection-sec-filing-archive-coverage/v1",
            ["20200103", "20200104"],
            1,
        )
        old = coverage(
            "early-detection-sec-oldloads-coverage/v1",
            ["20200102", "20200104"],
            1,
        )
        write_report(feed_path, feed)
        write_report(old_path, old)
        plan_path = root / "plan.json"
        plan = build_plan(database, feed_path, old_path, plan_path, 1, "test-seed")
        if plan["bulkUnionAccessions"] != 2 or plan["unresolvedAccessions"] != 1:
            raise FilingGapError("self-test union plan failed")
        unresolved = plan["accessions"][0]
        if unresolved["accession"] != "0000000003-20-000003":
            raise FilingGapError("self-test unresolved accession changed")

        batch_dir = root / "batches"
        batch_dir.mkdir()
        batch_unsigned = {
            "schema": BATCH_SCHEMA,
            "generatedAt": "2020-01-01T00:00:00.000Z",
            "status": "GAP_BATCH_QUERY_COMPLETE",
            "plan": signed_input(plan_path, plan),
            "batchIndex": 0,
            "plannedAccessions": 1,
            "captureFound": 1,
            "noCapture": 0,
            "queryIncomplete": 0,
            "accessions": [
                {
                    "accession": unresolved["accession"],
                    "rank": 0,
                    "batchIndex": 0,
                    "status": "CAPTURE_FOUND",
                    "forms": ["25"],
                    "queries": [
                        {
                            "variant": "MASTER_INDEX_PATH",
                            "captures": [
                                {
                                    "timestamp": "20200102030405",
                                    "original": "https://www.sec.gov/Archives/edgar/data/3/c.txt",
                                    "digest": "TEST",
                                }
                            ],
                        }
                    ],
                }
            ],
        }
        batch = sign(batch_unsigned)
        write_report(batch_dir / "batch-000.json", batch)
        candidates = capture_candidates(batch)
        if len(candidates) != 1 or candidates[0]["accession"] != unresolved["accession"]:
            raise FilingGapError("self-test capture candidate extraction failed")
        aggregate = build_aggregate(plan_path, batch_dir, root / "aggregate.json")
        if aggregate["bulkPlusObservedIndividualLocatorAccessions"] != 3:
            raise FilingGapError("self-test aggregate union failed")
        if aggregate["status"] != "COMPLETE_GAP_LOCATOR_QUERY":
            raise FilingGapError("self-test aggregate status failed")
        variants = filing_url_variants(
            "0000000001-20-000001",
            {"edgar/data/999/a.txt", "edgar/data/1/a.txt"},
        )
        if "/edgar/data/1/" not in variants[0]["sourceUrl"]:
            raise FilingGapError("self-test filer-CIK path priority failed")
        mutated = json.loads(plan_path.read_text(encoding="utf-8"))
        mutated["unresolvedAccessions"] = 2
        mutated_path = root / "mutated.json"
        write_report(mutated_path, mutated)
        rejected = False
        try:
            load_signed_report(mutated_path, PLAN_SCHEMA)
        except FilingGapError:
            rejected = True
        if not rejected:
            raise FilingGapError("self-test accepted a mutated plan")
    return {
        "status": "PASS",
        "signedInputsVerified": True,
        "bulkUnionGapVerified": True,
        "deterministicBatchPlanVerified": True,
        "aggregateIncrementVerified": True,
        "captureCandidateExtractionVerified": True,
        "filerCikPathPriorityVerified": True,
        "tamperedPlanRejected": True,
        "productiveGqsModified": False,
    }


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    sub = value.add_subparsers(dest="command", required=True)
    plan = sub.add_parser("plan")
    plan.add_argument("--events-database", type=Path, required=True)
    plan.add_argument("--feed-report", type=Path, required=True)
    plan.add_argument("--oldloads-report", type=Path, required=True)
    plan.add_argument("--report", type=Path, required=True)
    plan.add_argument("--batch-size", type=int, default=64)
    plan.add_argument("--seed", default=DEFAULT_SEED)
    batch = sub.add_parser("coverage-batch")
    batch.add_argument("--plan", type=Path, required=True)
    batch.add_argument("--individual-helper", type=Path, required=True)
    batch.add_argument("--data-root", type=Path, required=True)
    batch.add_argument("--report", type=Path, required=True)
    batch.add_argument("--batch-index", type=int, required=True)
    batch.add_argument("--workers", type=int, default=4)
    batch.add_argument("--user-agent")
    batch.add_argument("--timeout", type=int, default=45)
    batch.add_argument("--retries", type=int, default=2)
    batch.add_argument("--refresh", action="store_true")
    content = sub.add_parser("acquire-found")
    content.add_argument("--source-batch", type=Path, required=True)
    content.add_argument("--individual-helper", type=Path, required=True)
    content.add_argument("--data-root", type=Path, required=True)
    content.add_argument("--report", type=Path, required=True)
    content.add_argument("--user-agent")
    content.add_argument("--timeout", type=int, default=90)
    content.add_argument("--retries", type=int, default=3)
    content.add_argument("--max-payload-bytes", type=int, default=20 * 1024 * 1024)
    aggregate = sub.add_parser("aggregate")
    aggregate.add_argument("--plan", type=Path, required=True)
    aggregate.add_argument("--batch-directory", type=Path, required=True)
    aggregate.add_argument("--report", type=Path, required=True)
    sub.add_parser("self-test")
    return value


def main() -> int:
    args = parser().parse_args()
    try:
        if args.command == "plan":
            result = build_plan(
                args.events_database,
                args.feed_report,
                args.oldloads_report,
                args.report,
                args.batch_size,
                args.seed,
            )
        elif args.command == "coverage-batch":
            result = build_batch(
                args.plan,
                args.individual_helper,
                args.data_root,
                args.report,
                args.batch_index,
                args.workers,
                args.user_agent,
                args.timeout,
                args.retries,
                args.refresh,
            )
        elif args.command == "aggregate":
            result = build_aggregate(args.plan, args.batch_directory, args.report)
        elif args.command == "acquire-found":
            result = acquire_found(
                args.source_batch,
                args.individual_helper,
                args.data_root,
                args.report,
                args.user_agent,
                args.timeout,
                args.retries,
                args.max_payload_bytes,
            )
        else:
            result = self_test()
    except (FilingGapError, OSError, ValueError, sqlite3.Error) as exc:
        raise SystemExit(f"ERROR: {exc}") from exc
    if args.command == "self-test":
        output = result
    else:
        output = {
            "schema": result["schema"],
            "status": result["status"],
            "reportSha256": result["reportSha256"],
            "reportPath": str(args.report.expanduser().resolve()),
        }
        for key in (
            "populationAccessions",
            "bulkUnionAccessions",
            "unresolvedAccessions",
            "batchIndex",
            "plannedAccessions",
            "captureFound",
            "noCapture",
            "queryIncomplete",
            "observedBatchCount",
            "remainingUnqueriedOrUnknownAccessions",
            "captureLocatorAccessions",
            "contentVerifiedAccessions",
            "contentUnavailableAccessions",
        ):
            if key in result:
                output[key] = result[key]
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
