#!/usr/bin/env python3
"""Audit captured research payloads for exact publication-time evidence.

The audit never turns document creation, modification or HTTP cache times into
publication times.  Only an exact, timezone-qualified value carried by an
explicit publication field in the source payload is a promotion candidate.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


OBSERVATION_SCHEMA = "early-detection-source-observation/v1"
AUDIT_SCHEMA = "early-detection-research-metadata-audit/v1"
EXACT_TIME_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$",
    re.IGNORECASE,
)
JSON_PUBLICATION_RE = re.compile(
    r'(?i)["\'](?:datePublished|date_created|publication_date)["\']\s*:\s*["\']([^"\']+)["\']'
)
META_TAG_RE = re.compile(r"<meta\b[^>]*>", re.IGNORECASE)
ATTRIBUTE_RE = re.compile(
    r"(?i)\b([a-z_:.-]+)\s*=\s*(?:\"([^\"]*)\"|'([^']*)'|([^\s>]+))"
)
PDF_STRONG_RE = re.compile(
    rb"(?i)<(?:xmp:)?(?:DatePublished|PublicationDate)>([^<]{8,80})</"
)
PDF_WEAK_RE = re.compile(
    rb"(?i)(?:/(?:CreationDate|ModDate)\s*\(([^)]{8,80})\)|"
    rb"<(?:xmp:)?(?:CreateDate|ModifyDate)>([^<]{8,80})</)"
)


class MetadataAuditError(RuntimeError):
    """The immutable payload or observation contract is invalid."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def normalize_exact(value: str) -> str | None:
    candidate = html.unescape(value).strip()
    if not EXACT_TIME_RE.fullmatch(candidate):
        return None
    try:
        parsed = datetime.fromisoformat(candidate.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def meta_attributes(tag: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for match in ATTRIBUTE_RE.finditer(tag):
        result[match.group(1).lower()] = html.unescape(
            next(value for value in match.groups()[1:] if value is not None)
        )
    return result


def add_candidate(
    target: list[dict[str, str]],
    seen: set[tuple[str, str]],
    field: str,
    raw_value: str,
) -> None:
    exact = normalize_exact(raw_value)
    if exact is None:
        return
    key = (field, exact)
    if key in seen:
        return
    seen.add(key)
    target.append({"field": field, "rawValue": raw_value.strip(), "normalizedUtc": exact})


def extract_html(payload: bytes) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    text = payload.decode("utf-8", errors="replace")
    strong: list[dict[str, str]] = []
    weak: list[dict[str, str]] = []
    strong_seen: set[tuple[str, str]] = set()
    weak_seen: set[tuple[str, str]] = set()
    for match in JSON_PUBLICATION_RE.finditer(text):
        add_candidate(strong, strong_seen, "jsonld.datePublished", match.group(1))
    for tag_match in META_TAG_RE.finditer(text):
        attrs = meta_attributes(tag_match.group(0))
        label = (attrs.get("property") or attrs.get("name") or attrs.get("itemprop") or "").lower()
        value = attrs.get("content") or attrs.get("value") or ""
        if label in {"article:published_time", "datepublished", "date_created", "publication_date"}:
            add_candidate(strong, strong_seen, f"meta.{label}", value)
        elif label in {"article:modified_time", "datemodified", "last-modified", "dcterms.modified"}:
            add_candidate(weak, weak_seen, f"meta.{label}", value)
    return strong, weak


def extract_pdf(payload: bytes) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    strong: list[dict[str, str]] = []
    weak: list[dict[str, str]] = []
    strong_seen: set[tuple[str, str]] = set()
    weak_seen: set[tuple[str, str]] = set()
    for match in PDF_STRONG_RE.finditer(payload):
        add_candidate(
            strong,
            strong_seen,
            "pdf.publicationDate",
            match.group(1).decode("utf-8", errors="replace"),
        )
    for match in PDF_WEAK_RE.finditer(payload):
        raw = next(group for group in match.groups() if group is not None).decode("utf-8", errors="replace")
        add_candidate(weak, weak_seen, "pdf.creationOrModificationDate", raw)
    return strong, weak


def source_observations(data_root: Path) -> dict[str, dict[str, Any]]:
    base = data_root / "observations" / "research-sources"
    if not base.is_dir():
        raise MetadataAuditError("research-source observations are missing")
    latest: dict[str, dict[str, Any]] = {}
    for path in sorted(base.rglob("*.json")):
        row = json.loads(path.read_text(encoding="utf-8"))
        if row.get("schema") != OBSERVATION_SCHEMA:
            raise MetadataAuditError(f"unexpected observation schema: {path}")
        source_id = row.get("sourceId")
        observed_at = row.get("observedAt")
        if not isinstance(source_id, str) or not isinstance(observed_at, str):
            raise MetadataAuditError(f"observation lacks sourceId/observedAt: {path}")
        current = latest.get(source_id)
        if current is None or observed_at > str(current["observedAt"]):
            row["_observationPath"] = path.relative_to(data_root).as_posix()
            latest[source_id] = row
    return latest


def audit_store(data_root: Path) -> dict[str, Any]:
    resolved = data_root.resolve()
    rows: list[dict[str, Any]] = []
    counts = {
        "sources": 0,
        "localArtifacts": 0,
        "exactPublicationCandidates": 0,
        "dayMatchedCandidates": 0,
        "weakMetadataOnly": 0,
        "noExactMetadata": 0,
    }
    for source_id, observation in sorted(source_observations(resolved).items()):
        payload_relative = observation.get("payloadPath")
        if not isinstance(payload_relative, str) or Path(payload_relative).is_absolute():
            raise MetadataAuditError(f"invalid payloadPath for {source_id}")
        payload_path = resolved / payload_relative
        payload = payload_path.read_bytes()
        content_type = str(observation.get("responseHeaders", {}).get("content-type", "")).lower()
        is_pdf = payload.startswith(b"%PDF-") or "application/pdf" in content_type
        is_local = observation.get("sourceTransport") == "local_file"
        if is_pdf:
            strong, weak = extract_pdf(payload)
            payload_type = "pdf"
        else:
            strong, weak = extract_html(payload)
            payload_type = "html_or_text"
        declared = str(observation.get("declaredPublishedDateOrTimestamp", ""))
        day_matched = [item for item in strong if item["normalizedUtc"][:10] == declared[:10]]
        if is_local:
            decision = "LOCAL_ARTIFACT_NOT_A_PUBLICATION_SOURCE"
            counts["localArtifacts"] += 1
        elif day_matched:
            decision = "EXACT_PUBLICATION_METADATA_CANDIDATE_REQUIRES_SOURCE_REVIEW"
            counts["dayMatchedCandidates"] += 1
        elif strong:
            decision = "EXACT_METADATA_CONFLICTS_WITH_DECLARED_DAY"
        elif weak:
            decision = "WEAK_METADATA_NOT_PROMOTABLE"
            counts["weakMetadataOnly"] += 1
        else:
            decision = "NO_EXACT_PUBLICATION_METADATA"
            counts["noExactMetadata"] += 1
        counts["sources"] += 1
        if strong:
            counts["exactPublicationCandidates"] += 1
        rows.append({
            "sourceId": source_id,
            "observationPath": observation["_observationPath"],
            "payloadSha256": observation.get("payloadSha256"),
            "payloadType": payload_type,
            "declaredPublishedDateOrTimestamp": declared,
            "strongPublicationMetadata": strong,
            "dayMatchedStrongMetadata": day_matched,
            "weakNonPublicationMetadata": weak,
            "decision": decision,
        })
    return {
        "schema": AUDIT_SCHEMA,
        "generatedAt": utc_now(),
        "dataRoot": str(resolved),
        "policy": {
            "strong": "An explicit publication field with an exact timezone-qualified timestamp embedded in the captured source payload.",
            "weak": "Creation, modification or cache metadata is recorded but never promoted to publication time.",
            "automaticPromotion": False,
        },
        "counts": counts,
        "sources": rows,
        "status": "PASS",
    }


def self_test() -> dict[str, Any]:
    html_payload = b'''<html><head>
      <meta property="article:published_time" content="2025-01-06T08:30:00-05:00">
      <meta property="article:modified_time" content="2025-01-07T09:00:00-05:00">
      <script type="application/ld+json">{"datePublished":"2025-01-06T13:30:00Z"}</script>
    </head></html>'''
    strong, weak = extract_html(html_payload)
    if len(strong) != 2 or len(weak) != 1:
        raise MetadataAuditError("HTML metadata classification failed")
    if {row["normalizedUtc"] for row in strong} != {"2025-01-06T13:30:00.000Z"}:
        raise MetadataAuditError("timezone normalization failed")
    pdf_payload = b"%PDF-1.7 /CreationDate (2025-01-06T13:30:00Z)"
    pdf_strong, pdf_weak = extract_pdf(pdf_payload)
    if pdf_strong or len(pdf_weak) != 1:
        raise MetadataAuditError("PDF creation time was incorrectly promoted")
    if normalize_exact("2025-01-06") is not None:
        raise MetadataAuditError("day-level date was incorrectly accepted")
    with tempfile.TemporaryDirectory(prefix="research-metadata-") as directory:
        if not Path(directory).is_dir():
            raise MetadataAuditError("temporary directory failed")
    return {
        "schema": "early-detection-research-metadata-self-test/v1",
        "status": "PASS",
        "strongHtmlCandidates": len(strong),
        "weakHtmlCandidates": len(weak),
        "pdfCreationDatePromoted": False,
        "dayLevelDateAccepted": False,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    audit = sub.add_parser("audit")
    audit.add_argument("--data-root", type=Path, required=True)
    sub.add_parser("self-test")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        result = audit_store(args.data_root) if args.command == "audit" else self_test()
        print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
        return 0
    except (MetadataAuditError, OSError, json.JSONDecodeError) as exc:
        print(f"[early-detection-research-metadata] {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
