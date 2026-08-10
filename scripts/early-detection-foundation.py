#!/usr/bin/env python3
"""Append-only raw-data foundation for the Early-Detection V4 study.

This tool never computes confirmatory outcomes.  It preserves source payloads
byte-for-byte, records what was actually known about retrieval time, and keeps
unknown provenance quarantined instead of inventing point-in-time metadata.
"""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import io
import json
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


SCHEMA = "early-detection-raw-store/v1"
OBSERVATION_SCHEMA = "early-detection-source-observation/v1"
MIDAS_OBSERVATION_SCHEMA = "early-detection-sec-midas-acquisition/v1"
DEFAULT_USER_AGENT = (
    "Growth-Screener-Research/1.0 "
    "contact=https://github.com/Karlryl/screener-data"
)
SEC_FSD_URL = (
    "https://www.sec.gov/files/dera/data/financial-statement-data-sets/"
    "{quarter}.zip"
)
REQUIRED_FSD_MEMBERS = {"sub.txt", "num.txt", "pre.txt", "tag.txt"}
CIK_FILE_RE = re.compile(r"^(\d{10})\.json$")
QUARTER_RE = re.compile(r"^(2009|201\d|202\d)q([1-4])$")
SOURCE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
RESEARCH_SOURCE_CLASS_MAP = {
    "sec_filing": "sec_filing",
    "company_primary": "issuer_release",
    "government_dataset": "government_publication",
    "government_api": "government_publication",
    "government_enforcement": "government_publication",
    "government_lab_report": "government_publication",
    "government_oversight": "government_publication",
    "government_page": "government_publication",
    "government_policy": "government_publication",
    "government_program": "government_publication",
    "government_report": "government_publication",
    "government_research_paper": "government_publication",
    "government_research_program": "government_publication",
    "government_standard": "government_publication",
    "government_strategy": "government_publication",
    "regulatory_review": "government_publication",
    "regulatory_guidance_draft": "government_publication",
    "peer_reviewed_paper": "research_publication",
    "conference_paper": "research_publication",
    "working_paper": "research_publication",
    "intergovernmental_report": "government_publication",
    "industry_association_dataset": "public_web",
    "reliability_assessment": "public_web",
}


class FoundationError(RuntimeError):
    """The research-data contract could not be satisfied."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_timestamp(value: Any, field: str) -> str:
    if not isinstance(value, str) or "T" not in value:
        raise FoundationError(f"{field} is not a timezone-qualified timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise FoundationError(f"{field} is invalid") from exc
    if parsed.tzinfo is None:
        raise FoundationError(f"{field} has no timezone")
    return parsed.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def safe_token(value: str) -> str:
    return re.sub(r"[^0-9A-Za-z]+", "", value)


def ensure_data_root(data_root: Path) -> Path:
    resolved = data_root.expanduser().resolve()
    if resolved == Path(resolved.anchor):
        raise FoundationError("data root cannot be a filesystem root")
    resolved.mkdir(parents=True, exist_ok=True)
    marker = resolved / "STORE.json"
    identity = {
        "schema": SCHEMA,
        "policy": "append_only_content_addressed",
        "createdFor": "FEM-SEC-US@1.2.0",
        "productiveGqsModified": False,
    }
    if marker.exists():
        current = json.loads(marker.read_text(encoding="utf-8"))
        if current != identity:
            raise FoundationError("data root has another store identity")
    else:
        marker.write_bytes(canonical_bytes(identity) + b"\n")
    return resolved


def write_once(path: Path, payload: bytes) -> bool:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != payload:
            raise FoundationError(f"append-only collision at {path}")
        return False
    with path.open("xb") as handle:
        handle.write(payload)
    return True


def write_observation_once(path: Path, observation: dict[str, Any]) -> bool:
    """Keep one immutable observation while making archive replays idempotent.

    Replay response headers contain transport-time values such as Date, cookies
    and serving node IDs.  They are useful in the first evidence record but are
    not part of source identity.  A retry may reuse an existing observation only
    when every non-header field is byte-semantically identical.
    """
    payload = canonical_bytes(observation) + b"\n"
    if not path.exists():
        return write_once(path, payload)
    try:
        current = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise FoundationError(f"existing observation is invalid: {path}") from exc
    replay_fields = {"responseHeaders", "blobCreated"}
    stable_current = {key: value for key, value in current.items() if key not in replay_fields}
    stable_new = {key: value for key, value in observation.items() if key not in replay_fields}
    if stable_current != stable_new:
        raise FoundationError(f"append-only observation identity collision at {path}")
    return False


def store_blob(data_root: Path, suffix: str, payload: bytes) -> tuple[str, Path, bool]:
    digest = sha256_bytes(payload)
    relative = Path("blobs") / "sha256" / digest[:2] / f"{digest}{suffix}"
    created = write_once(data_root / relative, payload)
    return digest, relative, created


def validate_companyfacts(payload: bytes, filename_cik: str) -> tuple[str, str | None]:
    try:
        parsed = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise FoundationError(f"invalid companyfacts JSON for {filename_cik}") from exc
    cik = str(parsed.get("cik", "")).zfill(10)
    if cik != filename_cik:
        raise FoundationError(f"companyfacts CIK mismatch: file={filename_cik}, payload={cik}")
    entity_name = parsed.get("entityName")
    return cik, entity_name if isinstance(entity_name, str) and entity_name else None


def companyfacts_manifest(source_dir: Path) -> dict[str, Any]:
    path = source_dir / "_manifest.json"
    if not path.exists():
        return {}
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise FoundationError("companyfacts source manifest is invalid") from exc
    entries = parsed.get("entries")
    return entries if isinstance(entries, dict) else {}


def import_companyfacts(source_dir: Path, data_root: Path) -> dict[str, Any]:
    source_dir = source_dir.resolve()
    data_root = ensure_data_root(data_root)
    entries = companyfacts_manifest(source_dir)
    imported_at = utc_now()
    counts: Counter[str] = Counter()
    bytes_total = 0
    for path in sorted(source_dir.iterdir()):
        match = CIK_FILE_RE.fullmatch(path.name)
        if not match or not path.is_file():
            continue
        cik = match.group(1)
        payload = path.read_bytes()
        _, entity_name = validate_companyfacts(payload, cik)
        digest, blob_relative, created = store_blob(data_root, ".json", payload)
        source_meta = entries.get(cik) if isinstance(entries.get(cik), dict) else None
        observed_at = None
        evidence = "unknown"
        ticker = None
        if source_meta is not None and source_meta.get("fetchedAt") is not None:
            observed_at = parse_timestamp(source_meta["fetchedAt"], f"manifest.{cik}.fetchedAt")
            evidence = "source_manifest"
            ticker = source_meta.get("ticker") if isinstance(source_meta.get("ticker"), str) else None
        quality = "accepted" if observed_at is not None else "quarantined"
        observation_key = safe_token(observed_at) if observed_at else f"unknown-{digest[:16]}"
        observation = {
            "schema": OBSERVATION_SCHEMA,
            "sourceClass": "sec_companyfacts",
            "sourceUrl": f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json",
            "sourcePathAtImport": str(path),
            "cik": cik,
            "tickerAtSourceManifest": ticker,
            "entityName": entity_name,
            "observedAt": observed_at,
            "observedAtEvidence": evidence,
            "payloadSha256": digest,
            "payloadBytes": len(payload),
            "payloadPath": blob_relative.as_posix(),
            "qualityState": quality,
            "quarantineReasons": [] if quality == "accepted" else ["observed_at_not_proven"],
            "sourcePayloadModified": False,
        }
        observation_relative = (
            Path("observations") / "sec-companyfacts" / cik /
            f"{observation_key}-{digest}.json"
        )
        write_once(data_root / observation_relative, canonical_bytes(observation) + b"\n")
        counts[f"quality:{quality}"] += 1
        counts["blobCreated" if created else "blobReused"] += 1
        bytes_total += len(payload)
    result = {
        "schema": "early-detection-import-result/v1",
        "sourceClass": "sec_companyfacts",
        "sourceDirectory": str(source_dir),
        "dataRoot": str(data_root),
        "importedAt": imported_at,
        "payloads": counts["quality:accepted"] + counts["quality:quarantined"],
        "accepted": counts["quality:accepted"],
        "quarantined": counts["quality:quarantined"],
        "blobCreated": counts["blobCreated"],
        "blobReused": counts["blobReused"],
        "payloadBytesVisited": bytes_total,
    }
    return result


def validate_fsd_zip(payload: bytes, quarter: str) -> dict[str, Any]:
    if not QUARTER_RE.fullmatch(quarter):
        raise FoundationError(f"invalid SEC quarter: {quarter}")
    try:
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            bad_member = archive.testzip()
            if bad_member is not None:
                raise FoundationError(f"corrupt SEC FSD member: {bad_member}")
            names = {Path(name).name.lower() for name in archive.namelist()}
            missing = sorted(REQUIRED_FSD_MEMBERS - names)
            if missing:
                raise FoundationError(f"SEC FSD {quarter} lacks {', '.join(missing)}")
            return {
                "members": len(archive.infolist()),
                "requiredMembers": sorted(REQUIRED_FSD_MEMBERS),
                "uncompressedBytes": sum(item.file_size for item in archive.infolist()),
            }
    except zipfile.BadZipFile as exc:
        raise FoundationError(f"SEC FSD {quarter} is not a ZIP archive") from exc


def validate_midas_zip(payload: bytes) -> dict[str, Any]:
    """Accept direct tables and the official one-level nested 2014q2 archive."""
    try:
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            bad_member = archive.testzip()
            if bad_member is not None:
                raise FoundationError(f"MIDAS ZIP CRC failed for {bad_member}")
            tabular = [
                info.filename for info in archive.infolist()
                if not info.is_dir() and info.filename.lower().endswith((".csv", ".txt"))
            ]
            nested = [
                info for info in archive.infolist()
                if not info.is_dir() and info.filename.lower().endswith(".zip")
            ]
            for info in nested:
                with zipfile.ZipFile(io.BytesIO(archive.read(info))) as inner:
                    nested_bad = inner.testzip()
                    if nested_bad is not None:
                        raise FoundationError(f"nested MIDAS ZIP CRC failed for {info.filename}!{nested_bad}")
                    tabular.extend(
                        f"{info.filename}!{inner_info.filename}"
                        for inner_info in inner.infolist()
                        if not inner_info.is_dir()
                        and inner_info.filename.lower().endswith((".csv", ".txt"))
                    )
            if not tabular:
                raise FoundationError("MIDAS ZIP validation found no direct or one-level nested table")
            return {"tabularMembers": sorted(tabular), "nestedArchives": len(nested)}
    except zipfile.BadZipFile as exc:
        raise FoundationError("MIDAS payload contains an invalid outer or nested ZIP") from exc


def ingest_fsd_bytes(
    data_root: Path,
    quarter: str,
    payload: bytes,
    source_url: str,
    observed_at: str,
    response_headers: dict[str, str] | None = None,
    observed_at_evidence: str = "http_response_completion",
    original_source_url: str | None = None,
    archive_evidence: dict[str, Any] | None = None,
    dataset_variant: str = "direct_current",
) -> dict[str, Any]:
    data_root = ensure_data_root(data_root)
    observed_at = parse_timestamp(observed_at, "observedAt")
    archive = validate_fsd_zip(payload, quarter)
    digest, blob_relative, created = store_blob(data_root, ".zip", payload)
    observation = {
        "schema": OBSERVATION_SCHEMA,
        "sourceClass": "sec_financial_statement_dataset",
        "sourceUrl": source_url,
        "originalSourceUrl": original_source_url or source_url,
        "quarter": quarter,
        "datasetVariant": dataset_variant,
        "observedAt": observed_at,
        "observedAtEvidence": observed_at_evidence,
        "payloadSha256": digest,
        "payloadBytes": len(payload),
        "payloadPath": blob_relative.as_posix(),
        "qualityState": "accepted",
        "quarantineReasons": [],
        "archiveValidation": archive,
        "responseHeaders": response_headers or {},
        "archiveEvidence": archive_evidence,
        "sourcePayloadModified": False,
    }
    token = safe_token(observed_at)
    relative = Path("observations") / "sec-fsd" / quarter / f"{token}-{digest}.json"
    write_observation_once(data_root / relative, observation)
    return {**observation, "blobCreated": created, "observationPath": relative.as_posix()}


def ingest_research_bytes(
    data_root: Path,
    registry_row: dict[str, str],
    payload: bytes,
    observed_at: str,
    response_headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    data_root = ensure_data_root(data_root)
    source_id = str(registry_row.get("source_id", "")).strip()
    if not SOURCE_ID_RE.fullmatch(source_id):
        raise FoundationError(f"invalid research source id: {source_id!r}")
    source_url = str(registry_row.get("url", "")).strip()
    source_is_local = Path(source_url).is_absolute()
    if not source_url.startswith("https://") and not source_is_local:
        raise FoundationError(f"research source must be https or an absolute local file: {source_id}")
    observed_at = parse_timestamp(observed_at, "observedAt")
    declared_published = str(registry_row.get("published_at", "")).strip()
    source_published_at = None
    quarantine: list[str] = []
    if "T" in declared_published:
        source_published_at = parse_timestamp(declared_published, f"{source_id}.published_at")
    else:
        quarantine.append("source_published_at_not_exact")
    registry_class = str(registry_row.get("source_class", "")).strip()
    runner_class = RESEARCH_SOURCE_CLASS_MAP.get(registry_class)
    if runner_class is None:
        quarantine.append("source_class_not_mapped")
    digest, blob_relative, created = store_blob(data_root, ".bin", payload)
    observation = {
        "schema": OBSERVATION_SCHEMA,
        "sourceClass": "research_source_payload",
        "sourceId": source_id,
        "sourceUrl": source_url,
        "sourceTransport": "local_file" if source_is_local else "https",
        "registrySourceClass": registry_class,
        "runnerSourceClass": runner_class,
        "declaredPublishedDateOrTimestamp": declared_published,
        "sourcePublishedAt": source_published_at,
        "observedAt": observed_at,
        "observedAtEvidence": "local_file_read_completion" if source_is_local else "http_response_completion",
        "knownAt": max(value for value in (source_published_at, observed_at) if value is not None),
        "payloadSha256": digest,
        "payloadBytes": len(payload),
        "payloadPath": blob_relative.as_posix(),
        "qualityState": "accepted" if not quarantine else "quarantined",
        "quarantineReasons": quarantine,
        "responseHeaders": response_headers or {},
        "sourcePayloadModified": False,
        "signalEligible": not quarantine,
    }
    relative = (
        Path("observations") / "research-sources" / source_id /
        f"{safe_token(observed_at)}-{digest}.json"
    )
    write_observation_once(data_root / relative, observation)
    return {**observation, "blobCreated": created, "observationPath": relative.as_posix()}


def ingest_archived_research_bytes(
    data_root: Path,
    registry_row: dict[str, str],
    payload: bytes,
    archive_record: bytes,
    observed_at: str,
    source_published_at: str | None,
    archive_evidence: dict[str, Any],
    publication_metadata: list[dict[str, str]],
    response_headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Preserve a web-archive capture without overstating its publication time."""
    data_root = ensure_data_root(data_root)
    source_id = str(registry_row.get("source_id", "")).strip()
    if not SOURCE_ID_RE.fullmatch(source_id):
        raise FoundationError(f"invalid research source id: {source_id!r}")
    source_url = str(registry_row.get("url", "")).strip()
    if not source_url.startswith("https://"):
        raise FoundationError(f"archived research source must be https: {source_id}")
    observed_at = parse_timestamp(observed_at, "observedAt")
    published = (
        parse_timestamp(source_published_at, f"{source_id}.sourcePublishedAt")
        if source_published_at is not None else None
    )
    quarantine: list[str] = []
    if published is None:
        quarantine.append("source_published_at_not_exact_in_archived_payload")
    elif published > observed_at:
        quarantine.append("source_published_at_after_archive_capture")
    registry_class = str(registry_row.get("source_class", "")).strip()
    runner_class = RESEARCH_SOURCE_CLASS_MAP.get(registry_class)
    if runner_class is None:
        quarantine.append("source_class_not_mapped")
    digest, blob_relative, created = store_blob(data_root, ".bin", payload)
    archive_digest, archive_relative, archive_created = store_blob(
        data_root, ".warc.gz", archive_record
    )
    observation = {
        "schema": OBSERVATION_SCHEMA,
        "sourceClass": "research_source_payload",
        "sourceId": source_id,
        "sourceUrl": source_url,
        "sourceTransport": "common_crawl_warc_range",
        "registrySourceClass": registry_class,
        "runnerSourceClass": runner_class,
        "declaredPublishedDateOrTimestamp": str(registry_row.get("published_at", "")).strip(),
        "sourcePublishedAt": published,
        "publicationMetadataEvidence": publication_metadata,
        "observedAt": observed_at,
        "observedAtEvidence": "common_crawl_capture_timestamp",
        "knownAt": max(value for value in (published, observed_at) if value is not None),
        "payloadSha256": digest,
        "payloadBytes": len(payload),
        "payloadPath": blob_relative.as_posix(),
        "archiveRecordSha256": archive_digest,
        "archiveRecordBytes": len(archive_record),
        "archiveRecordPath": archive_relative.as_posix(),
        "archiveEvidence": archive_evidence,
        "qualityState": "accepted" if not quarantine else "quarantined",
        "quarantineReasons": quarantine,
        "responseHeaders": response_headers or {},
        "sourcePayloadModified": False,
        "signalEligible": not quarantine,
    }
    relative = (
        Path("observations") / "research-sources" / source_id /
        f"archive-{safe_token(observed_at)}-{digest}.json"
    )
    write_observation_once(data_root / relative, observation)
    return {
        **observation,
        "blobCreated": created,
        "archiveBlobCreated": archive_created,
        "observationPath": relative.as_posix(),
    }


def quarter_key(value: str) -> int:
    match = QUARTER_RE.fullmatch(value)
    if not match:
        raise FoundationError(f"invalid quarter: {value}")
    return int(match.group(1)) * 4 + int(match.group(2)) - 1


def quarters_between(start: str, end: str) -> Iterable[str]:
    first, last = quarter_key(start), quarter_key(end)
    if first > last:
        raise FoundationError("from-quarter is after to-quarter")
    for value in range(first, last + 1):
        year, index = divmod(value, 4)
        yield f"{year}q{index + 1}"


def download_bytes(url: str, user_agent: str, timeout: int, retries: int) -> tuple[bytes, dict[str, str]]:
    last_error: Exception | None = None
    for attempt in range(retries):
        request = urllib.request.Request(
            url,
            headers={"User-Agent": user_agent, "Accept-Encoding": "identity"},
            method="GET",
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = response.read()
                status = getattr(response, "status", 200)
                if status != 200:
                    raise FoundationError(f"HTTP {status} for {url}")
                headers = {
                    key: value for key, value in {
                        "content-type": response.headers.get("Content-Type"),
                        "content-length": response.headers.get("Content-Length"),
                        "last-modified": response.headers.get("Last-Modified"),
                        "etag": response.headers.get("ETag"),
                    }.items() if value is not None
                }
                return payload, headers
        except (urllib.error.URLError, TimeoutError, FoundationError) as exc:
            last_error = exc
            if attempt + 1 < retries:
                time.sleep(min(8, 2 ** attempt))
    raise FoundationError(f"download failed after {retries} attempts: {url}: {last_error}")


def acquire_sec_fsd(
    data_root: Path,
    start: str,
    end: str,
    user_agent: str,
    timeout: int,
    retries: int,
) -> dict[str, Any]:
    if not user_agent.strip():
        raise FoundationError("a declared SEC user agent is required")
    rows = []
    for quarter in quarters_between(start, end):
        url = SEC_FSD_URL.format(quarter=quarter)
        payload, headers = download_bytes(url, user_agent, timeout, retries)
        row = ingest_fsd_bytes(data_root, quarter, payload, url, utc_now(), headers)
        rows.append({
            "quarter": quarter,
            "payloadSha256": row["payloadSha256"],
            "payloadBytes": row["payloadBytes"],
            "observationPath": row["observationPath"],
        })
    result = {
        "schema": "early-detection-sec-fsd-batch/v1",
        "fromQuarter": start,
        "toQuarter": end,
        "completedAt": utc_now(),
        "dataRoot": str(data_root.resolve()),
        "observations": rows,
    }
    batch_path = ensure_data_root(data_root) / "batches" / "sec-fsd" / (
        f"{start}-{end}-{safe_token(result['completedAt'])}.json"
    )
    write_once(batch_path, canonical_bytes(result) + b"\n")
    return result


def acquire_research_registry(
    data_root: Path,
    registry: Path,
    user_agent: str,
    timeout: int,
    retries: int,
    offset: int,
    limit: int | None,
) -> dict[str, Any]:
    if not user_agent.strip():
        raise FoundationError("a declared research user agent is required")
    with registry.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    required = {"source_id", "url", "published_at", "source_class"}
    if not rows or not required.issubset(rows[0]):
        raise FoundationError("research registry lacks required columns")
    if offset < 0:
        raise FoundationError("research registry offset cannot be negative")
    selected = rows[offset:offset + limit] if limit is not None else rows[offset:]
    completed: list[dict[str, Any]] = []
    failed: list[dict[str, str]] = []
    for row in selected:
        source_id = str(row.get("source_id", "")).strip()
        try:
            location = str(row.get("url", "")).strip()
            local_path = Path(location)
            if local_path.is_absolute():
                if not local_path.is_file():
                    raise FoundationError(f"local research source is missing: {local_path}")
                payload = local_path.read_bytes()
                headers = {"local-file-sha256": sha256_bytes(payload)}
            else:
                payload, headers = download_bytes(location, user_agent, timeout, retries)
            item = ingest_research_bytes(data_root, row, payload, utc_now(), headers)
            completed.append({
                "sourceId": source_id,
                "qualityState": item["qualityState"],
                "payloadSha256": item["payloadSha256"],
                "payloadBytes": item["payloadBytes"],
                "observationPath": item["observationPath"],
            })
        except (FoundationError, OSError) as exc:
            failed.append({"sourceId": source_id, "error": str(exc)})
    result = {
        "schema": "early-detection-research-acquisition/v1",
        "registry": str(registry.resolve()),
        "completedAt": utc_now(),
        "dataRoot": str(data_root.resolve()),
        "selected": len(selected),
        "completed": completed,
        "failed": failed,
        "status": "PASS" if not failed else "PARTIAL",
    }
    batch_path = ensure_data_root(data_root) / "batches" / "research-sources" / (
        f"{safe_token(result['completedAt'])}.json"
    )
    write_once(batch_path, canonical_bytes(result) + b"\n")
    return result


def import_store(source_root: Path, data_root: Path) -> dict[str, Any]:
    source_root = source_root.resolve()
    source_verification = verify_store(source_root)
    if source_verification["status"] != "PASS":
        raise FoundationError("source store verification failed")
    data_root = ensure_data_root(data_root)
    counts: Counter[str] = Counter()
    for directory in ("blobs", "observations", "batches"):
        base = source_root / directory
        if not base.exists():
            continue
        for source_path in sorted(path for path in base.rglob("*") if path.is_file()):
            relative = source_path.relative_to(source_root)
            created = write_once(data_root / relative, source_path.read_bytes())
            counts["created" if created else "reused"] += 1
    target_verification = verify_store(data_root)
    if target_verification["status"] != "PASS":
        raise FoundationError("target store verification failed after import")
    return {
        "schema": "early-detection-store-import/v1",
        "sourceRoot": str(source_root),
        "dataRoot": str(data_root),
        "createdFiles": counts["created"],
        "reusedFiles": counts["reused"],
        "sourceObservationIndexSha256": source_verification["observationIndexSha256"],
        "targetObservationIndexSha256": target_verification["observationIndexSha256"],
        "targetObservations": target_verification["observations"],
        "status": "PASS",
    }


def observation_files(data_root: Path) -> Iterable[Path]:
    base = data_root / "observations"
    if not base.exists():
        return []
    return sorted(base.rglob("*.json"))


def verify_store(data_root: Path) -> dict[str, Any]:
    data_root = ensure_data_root(data_root)
    issues: list[str] = []
    counts: Counter[str] = Counter()
    distinct_payloads: set[str] = set()
    distinct_bytes = 0
    observation_index: list[dict[str, Any]] = []
    payload_index: dict[str, dict[str, Any]] = {}
    for path in observation_files(data_root):
        try:
            row = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            issues.append(f"invalid_observation:{path}:{exc}")
            continue
        row_schema = row.get("schema")
        is_midas = row_schema == MIDAS_OBSERVATION_SCHEMA
        if row_schema not in {OBSERVATION_SCHEMA, MIDAS_OBSERVATION_SCHEMA}:
            issues.append(f"schema:{path}")
            continue
        relative = row.get("blobPath") if is_midas else row.get("payloadPath")
        digest = row.get("payloadSha256")
        if not isinstance(relative, str) or Path(relative).is_absolute() or ".." in Path(relative).parts:
            issues.append(f"payload_path:{path}")
            continue
        payload_path = data_root / relative
        if not payload_path.exists():
            issues.append(f"missing_payload:{path}")
            continue
        actual = sha256_file(payload_path)
        if actual != digest:
            issues.append(f"payload_hash:{path}")
            continue
        if is_midas:
            expected_sha1 = row.get("payloadSha1Base32")
            actual_sha1 = base64.b32encode(hashlib.sha1(payload_path.read_bytes()).digest()).decode("ascii").rstrip("=")
            if expected_sha1 != actual_sha1:
                issues.append(f"payload_sha1:{path}")
                continue
            if row.get("payloadBytes") != payload_path.stat().st_size:
                issues.append(f"payload_bytes:{path}")
                continue
            try:
                validate_midas_zip(payload_path.read_bytes())
            except FoundationError as exc:
                issues.append(f"midas_validation:{path}:{exc}")
                continue
        archive_relative = row.get("archiveRecordPath")
        archive_digest = row.get("archiveRecordSha256")
        if archive_relative is not None or archive_digest is not None:
            if (
                not isinstance(archive_relative, str)
                or Path(archive_relative).is_absolute()
                or ".." in Path(archive_relative).parts
                or not isinstance(archive_digest, str)
            ):
                issues.append(f"archive_record_path:{path}")
                continue
            archive_path = data_root / archive_relative
            if not archive_path.exists():
                issues.append(f"missing_archive_record:{path}")
                continue
            if sha256_file(archive_path) != archive_digest:
                issues.append(f"archive_record_hash:{path}")
                continue
        observation_index.append({
            "path": path.relative_to(data_root).as_posix(),
            "sha256": sha256_file(path),
        })
        if digest not in distinct_payloads:
            distinct_payloads.add(digest)
            distinct_bytes += payload_path.stat().st_size
            payload_index[digest] = {
                "path": payload_path.relative_to(data_root).as_posix(),
                "bytes": payload_path.stat().st_size,
            }
        source_class = "sec_midas_individual_security" if is_midas else str(row.get("sourceClass"))
        quality = "accepted" if is_midas else str(row.get("qualityState"))
        counts[f"source:{source_class}"] += 1
        counts[f"quality:{quality}"] += 1
        counts["observations"] += 1
        if source_class == "sec_financial_statement_dataset":
            try:
                validate_fsd_zip(payload_path.read_bytes(), str(row.get("quarter")))
            except FoundationError as exc:
                issues.append(f"fsd_validation:{path}:{exc}")
    return {
        "schema": "early-detection-store-verification/v1",
        "verifiedAt": utc_now(),
        "dataRoot": str(data_root),
        "status": "PASS" if not issues else "FAIL",
        "observations": counts["observations"],
        "distinctPayloads": len(distinct_payloads),
        "distinctPayloadBytes": distinct_bytes,
        "observationIndexSha256": sha256_bytes(canonical_bytes(observation_index)),
        "payloadIndexSha256": sha256_bytes(canonical_bytes(payload_index)),
        "bySourceClass": {
            key.removeprefix("source:"): value
            for key, value in sorted(counts.items()) if key.startswith("source:")
        },
        "byQualityState": {
            key.removeprefix("quality:"): value
            for key, value in sorted(counts.items()) if key.startswith("quality:")
        },
        "issues": issues,
    }


def make_test_fsd() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(REQUIRED_FSD_MEMBERS):
            archive.writestr(name, "header\nvalue\n")
    return buffer.getvalue()


def self_test() -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="early-detection-foundation-") as temporary:
        base = Path(temporary)
        source = base / "source"
        store = base / "store"
        source.mkdir()
        first = {"cik": 123, "entityName": "Known Corp", "facts": {}}
        second = {"cik": 456, "entityName": "Unknown Corp", "facts": {}}
        (source / "0000000123.json").write_bytes(canonical_bytes(first))
        (source / "0000000456.json").write_bytes(canonical_bytes(second))
        (source / "_manifest.json").write_text(json.dumps({
            "entries": {
                "0000000123": {
                    "ticker": "KNOWN",
                    "fetchedAt": "2026-01-02T03:04:05.000Z",
                }
            }
        }), encoding="utf-8")
        imported = import_companyfacts(source, store)
        if imported["accepted"] != 1 or imported["quarantined"] != 1:
            raise FoundationError("self-test provenance classification failed")
        second_import = import_companyfacts(source, store)
        if second_import["blobReused"] != 2:
            raise FoundationError("self-test idempotent blob reuse failed")
        fsd = ingest_fsd_bytes(
            store,
            "2009q1",
            make_test_fsd(),
            SEC_FSD_URL.format(quarter="2009q1"),
            "2026-01-02T03:05:00.000Z",
        )
        if fsd["archiveValidation"]["members"] != 4:
            raise FoundationError("self-test FSD validation failed")
        fsd_replay = ingest_fsd_bytes(
            store,
            "2009q1",
            make_test_fsd(),
            SEC_FSD_URL.format(quarter="2009q1"),
            "2026-01-02T03:05:00.000Z",
            {"date": "a later transport time", "server": "another replay node"},
        )
        if fsd_replay["blobCreated"]:
            raise FoundationError("self-test FSD replay should reuse the immutable payload")
        research = ingest_research_bytes(
            store,
            {
                "source_id": "SELFTEST-RESEARCH",
                "url": "https://example.test/research",
                "published_at": "2020-01-01T12:00:00.000Z",
                "source_class": "government_lab_report",
            },
            b"research payload",
            "2026-01-02T03:06:00.000Z",
            {"content-type": "text/plain"},
        )
        if research["qualityState"] != "accepted" or not research["signalEligible"]:
            raise FoundationError("self-test research source acceptance failed")
        archived = ingest_archived_research_bytes(
            store,
            {
                "source_id": "SELFTEST-ARCHIVE",
                "url": "https://example.test/archive",
                "published_at": "2020-01-01",
                "source_class": "government_page",
            },
            b"archived source payload",
            b"synthetic compressed WARC range",
            "2020-01-02T03:06:00.000Z",
            "2020-01-01T12:00:00.000Z",
            {"provider": "self-test", "captureTimestamp": "20200102030600"},
            [{"field": "jsonld.datePublished", "normalizedUtc": "2020-01-01T12:00:00.000Z"}],
            {"content-type": "text/html"},
        )
        if archived["qualityState"] != "accepted" or not archived["archiveBlobCreated"]:
            raise FoundationError("self-test archived source acceptance failed")
        midas_buffer = io.BytesIO()
        with zipfile.ZipFile(midas_buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("sample.csv", "Date,Security,Ticker\n20120103,Stock,ABC\n")
        midas_payload = midas_buffer.getvalue()
        midas_digest, midas_relative, _ = store_blob(store, ".zip", midas_payload)
        midas_observation = {
            "schema": MIDAS_OBSERVATION_SCHEMA,
            "dataset": "SEC_MIDAS_INDIVIDUAL_SECURITY",
            "quarter": "2012q1",
            "payloadSha256": midas_digest,
            "payloadSha1Base32": base64.b32encode(hashlib.sha1(midas_payload).digest()).decode("ascii").rstrip("="),
            "payloadBytes": len(midas_payload),
            "blobPath": midas_relative.as_posix(),
        }
        midas_path = store / "observations" / "sec-midas-individual-security" / "2012q1" / f"selftest-{midas_digest}.json"
        write_once(
            midas_path,
            canonical_bytes(midas_observation) + b"\n",
        )
        if write_observation_once(midas_path, {**midas_observation, "blobCreated": False}):
            raise FoundationError("self-test MIDAS replay should ignore blob creation state")
        verification = verify_store(store)
        if verification["status"] != "PASS" or verification["observations"] != 6:
            raise FoundationError("self-test store verification failed")
        imported_store = base / "imported-store"
        transfer = import_store(store, imported_store)
        if transfer["status"] != "PASS" or transfer["targetObservations"] != 6:
            raise FoundationError("self-test append-only store transfer failed")
        return {
            "schema": "early-detection-foundation-self-test/v1",
            "status": "PASS",
            "acceptedCompanyfacts": 1,
            "quarantinedCompanyfacts": 1,
            "fsdArchives": 1,
            "midasArchives": 1,
            "researchSources": 1,
            "archivedResearchSources": 1,
            "observationsVerified": verification["observations"],
            "storeTransferVerified": True,
        }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    import_cf = sub.add_parser("import-companyfacts")
    import_cf.add_argument("--source-dir", type=Path, required=True)
    import_cf.add_argument("--data-root", type=Path, required=True)

    acquire = sub.add_parser("acquire-sec-fsd")
    acquire.add_argument("--data-root", type=Path, required=True)
    acquire.add_argument("--from-quarter", required=True)
    acquire.add_argument("--to-quarter", required=True)
    acquire.add_argument("--user-agent", default=os.environ.get("SEC_USER_AGENT", DEFAULT_USER_AGENT))
    acquire.add_argument("--timeout", type=int, default=120)
    acquire.add_argument("--retries", type=int, default=3)

    verify = sub.add_parser("verify")
    verify.add_argument("--data-root", type=Path, required=True)

    transfer = sub.add_parser("import-store")
    transfer.add_argument("--source-root", type=Path, required=True)
    transfer.add_argument("--data-root", type=Path, required=True)

    research = sub.add_parser("acquire-research-registry")
    research.add_argument("--data-root", type=Path, required=True)
    research.add_argument("--registry", type=Path, required=True)
    research.add_argument("--user-agent", default=os.environ.get("RESEARCH_USER_AGENT", DEFAULT_USER_AGENT))
    research.add_argument("--timeout", type=int, default=60)
    research.add_argument("--retries", type=int, default=2)
    research.add_argument("--offset", type=int, default=0)
    research.add_argument("--limit", type=int)

    sub.add_parser("self-test")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        if args.command == "import-companyfacts":
            result = import_companyfacts(args.source_dir, args.data_root)
        elif args.command == "acquire-sec-fsd":
            result = acquire_sec_fsd(
                args.data_root,
                args.from_quarter,
                args.to_quarter,
                args.user_agent,
                args.timeout,
                args.retries,
            )
        elif args.command == "verify":
            result = verify_store(args.data_root)
        elif args.command == "import-store":
            result = import_store(args.source_root, args.data_root)
        elif args.command == "acquire-research-registry":
            result = acquire_research_registry(
                args.data_root,
                args.registry,
                args.user_agent,
                args.timeout,
                args.retries,
                args.offset,
                args.limit,
            )
        else:
            result = self_test()
        print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
        return 0 if result.get("status", "PASS") == "PASS" else 1
    except (FoundationError, OSError, json.JSONDecodeError) as exc:
        print(f"[early-detection-foundation] {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
