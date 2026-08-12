#!/usr/bin/env python3
"""Outcome-blind exposure builder for SEC-CIK-GROWTH-PERSISTENCE@1.0.0.

The exposure command is deliberately unable to query submissions accepted
after the frozen cutoff. Endpoint extraction belongs to a later, separately
authorized command and artifact.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import statistics
import tempfile
from collections import defaultdict
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterable


PROTOCOL = "SEC-CIK-GROWTH-PERSISTENCE@1.0.0"
EXPOSURE_SCHEMA = "sec-cik-growth-persistence-exposure/v1"
SOURCE_SCHEMA = "sec-cik-growth-persistence-source-line/v1"
DATABASE_ATTESTATION_SCHEMA = "sec-cik-growth-persistence-database-attestation/v1"
CUTOFF = "2014-06-30T23:59:59Z"
CUTOFF_EPOCH = int(datetime(2014, 6, 30, 23, 59, 59, tzinfo=timezone.utc).timestamp())
CUTOFF_QUARTER = "2014q2"
ENDPOINT_LAST_QUARTER = "2015q3"
MAX_ANCHOR_LAG_DAYS = 183
QUARTER_GAP_MIN = 70
QUARTER_GAP_MAX = 110
MIN_REVENUE_YOY = Decimal("0.20")
MIN_ACCELERATION = Decimal("0.05")
ZERO = Decimal("0")

INTEGRITY_REPORT_CANONICAL_SHA256 = "9b2b660bd0d5cc65b49618a2e4a119359e33c07891d045817e2d41a000a1885f"
LOGICAL_EVIDENCE_SHA256 = "69bc58ee84bf936e25a5d0d56699dff6d588b34500a5d51ef68aba2bf9c937de"
PAYLOAD_MANIFEST_SHA256 = "5bb597d4d08e5ed1aa1a289c1c646ffcf5e971547f0f66ac441b3ee629057b27"
CONCEPT_MAP_CANONICAL_SHA256 = "af80351e46f1716628460bd275ae9144716f5e655d44b741639a2e8c993d7f87"
SOURCE_LINE_PAYLOADS_SHA256 = "77fa257774fe94e4f4902cec0487153ae1418ee58197c3c566e873ba20b28cf9"
DATABASE_BYTES = 41141956608
DATABASE_SHA256 = "aacd729b4dccc4924f0223cc24b549742180e01156717de2f888d5913b2b2df7"

REPO = Path(__file__).resolve().parents[1]
CONTRACT_PATH = REPO / "reports" / "early-detection" / "sec-cik-growth-persistence-claim-contract-v1.json"
SCOPE_PATH = REPO / "reports" / "early-detection" / "sec-cik-growth-persistence-scope-v1.md"
CONCEPT_MAP_PATH = REPO / "research" / "early-detection-v4" / "sec-concept-map-1.0.0.json"
INTEGRITY_REPORT_PATH = REPO / "reports" / "early-detection" / "sec-fsd-compact-full-integrity-2009-2024.json"
CONCEPT_COVERAGE_PATH = REPO / "reports" / "early-detection" / "sec-concept-coverage-2009-2024.json"
SOURCE_LINE_PATH = REPO / "reports" / "early-detection" / "sec-cik-growth-persistence-source-line-v2.json"
DATABASE_ATTESTATION_PATH = REPO / "reports" / "early-detection" / "sec-cik-growth-persistence-database-attestation-v1.json"

CLAIM_LOCKS = {
    "coverageBoundedSecRegistrantsOnly": True,
    "fullMarket": False,
    "survivorshipSafe": False,
    "stockReturns": False,
    "originalV4Result": False,
    "humanAttestation": False,
    "aiAuditOnly": True,
    "cikIsPermanentSecurityId": False,
}


class StudyError(RuntimeError):
    pass


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def canonical_sha256(value: Any) -> str:
    return sha256_bytes(canonical_bytes(value))


def normalized_text_sha256(path: Path) -> str:
    text = path.read_text(encoding="utf-8").replace("\r\n", "\n").replace("\r", "\n")
    return sha256_bytes(text.encode("utf-8"))


def unsigned_canonical_sha256(value: dict[str, Any], field: str) -> str:
    unsigned = dict(value)
    unsigned.pop(field, None)
    return canonical_sha256(unsigned)


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise StudyError(f"cannot load JSON: {path}") from exc
    if not isinstance(value, dict):
        raise StudyError(f"JSON root must be an object: {path}")
    return value


def load_contracts() -> tuple[dict[str, Any], dict[str, list[str]]]:
    contract = load_json(CONTRACT_PATH)
    if contract.get("schema") != "sec-cik-growth-persistence-claim-contract/v1" or contract.get("protocol") != PROTOCOL:
        raise StudyError("claim contract identity changed")
    if contract.get("outcomeBarrier") != {
        "outcomesAccessed": False,
        "postAnchorFactsMaterialized": False,
        "remotePreOutcomeCheckpointRequired": True,
        "separateExposureAndEndpointPassesRequired": True,
    }:
        raise StudyError("claim contract outcome barrier changed")
    source = contract.get("source")
    if source != {
        "ledgerSchema": "early-detection-pit-compact-sqlite/v1",
        "databaseBytes": DATABASE_BYTES,
        "databaseSha256": DATABASE_SHA256,
        "payloadSelection": "EARLIEST_OBSERVED_PAYLOAD_PER_FSD_QUARTER",
        "integrityReport": "reports/early-detection/sec-fsd-compact-full-integrity-2009-2024.json",
        "integrityReportCanonicalSha256": INTEGRITY_REPORT_CANONICAL_SHA256,
        "logicalEvidenceSha256": LOGICAL_EVIDENCE_SHA256,
        "conceptCoverageReport": "reports/early-detection/sec-concept-coverage-2009-2024.json",
        "conceptCoveragePayloadManifestSha256": PAYLOAD_MANIFEST_SHA256,
        "conceptMap": "research/early-detection-v4/sec-concept-map-1.0.0.json",
        "conceptMapCanonicalSha256": CONCEPT_MAP_CANONICAL_SHA256,
        "sourceLinePayloadsCanonicalSha256": SOURCE_LINE_PAYLOADS_SHA256,
    }:
        raise StudyError("claim contract source binding changed")
    exposure = contract.get("exposure", {})
    if (
        exposure.get("currentRevenueYoyMinimum") != 0.2
        or exposure.get("accelerationMinimumPercentagePoints") != 5.0
        or exposure.get("lastFourQuarterOperatingCashFlowMinimumExclusive") != 0.0
    ):
        raise StudyError("claim contract exposure thresholds changed")
    concept_map = load_json(CONCEPT_MAP_PATH)
    if concept_map.get("schema") != "early-detection-sec-concept-map/v1" or concept_map.get("version") != "FEM-SEC-CONCEPT-MAP@1.0.0":
        raise StudyError("concept map identity changed")
    if canonical_sha256(concept_map) != CONCEPT_MAP_CANONICAL_SHA256:
        raise StudyError("concept map canonical bytes changed")
    coverage = load_json(CONCEPT_COVERAGE_PATH)
    if coverage.get("scope", {}).get("payloadManifestSha256") != PAYLOAD_MANIFEST_SHA256:
        raise StudyError("concept coverage payload manifest changed")
    roles = concept_map.get("roles", {})
    role_concepts = {
        role: list(roles[role]["conceptPriority"])
        for role in ("revenue", "operatingCashFlow")
    }
    return contract, role_concepts


def database_snapshot_state(path: Path) -> tuple[int, int, int, int, int]:
    resolved = path.expanduser().resolve()
    if resolved.stat().st_size != DATABASE_BYTES:
        raise StudyError("database byte length changed from the bound integrity report")
    for suffix in ("-wal", "-journal"):
        sidecar = Path(str(resolved) + suffix)
        if sidecar.exists() and sidecar.stat().st_size > 0:
            raise StudyError(f"SQLite data-bearing sidecar is not allowed: {sidecar}")
    stat = resolved.stat()
    return stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns, stat.st_dev, stat.st_ino


def verify_snapshot_sha256(path: Path, expected_bytes: int, expected_sha256: str) -> None:
    before = path.stat()
    if before.st_size != expected_bytes:
        raise StudyError("snapshot byte length changed")
    if sha256_file(path) != expected_sha256:
        raise StudyError("snapshot SHA-256 changed")
    after = path.stat()
    if (after.st_size, after.st_mtime_ns) != (before.st_size, before.st_mtime_ns):
        raise StudyError("snapshot changed during SHA-256 verification")


def verify_database_sha256(path: Path) -> tuple[int, int, int, int, int]:
    before = database_snapshot_state(path)
    verify_snapshot_sha256(path, DATABASE_BYTES, DATABASE_SHA256)
    if database_snapshot_state(path) != before:
        raise StudyError("database snapshot changed during SHA-256 verification")
    return before


def build_database_attestation(path: Path) -> dict[str, Any]:
    verify_database_sha256(path)
    value = {
        "schema": DATABASE_ATTESTATION_SCHEMA,
        "protocol": PROTOCOL,
        "status": "PRE_OUTCOME_DATABASE_BYTES_VERIFIED",
        "databaseBytes": DATABASE_BYTES,
        "databaseSha256": DATABASE_SHA256,
        "integrityReportCanonicalSha256": INTEGRITY_REPORT_CANONICAL_SHA256,
        "logicalEvidenceSha256": LOGICAL_EVIDENCE_SHA256,
        "outcomesAccessed": False,
        "postAnchorFactsRead": False,
    }
    value["attestationSha256"] = canonical_sha256(value)
    return value


def validate_database_attestation(value: dict[str, Any], raw: bytes) -> str:
    expected = {
        "schema", "protocol", "status", "databaseBytes", "databaseSha256",
        "integrityReportCanonicalSha256", "logicalEvidenceSha256", "outcomesAccessed",
        "postAnchorFactsRead", "attestationSha256",
    }
    if set(value) != expected:
        raise StudyError("database attestation key set changed")
    if value.get("schema") != DATABASE_ATTESTATION_SCHEMA or value.get("protocol") != PROTOCOL:
        raise StudyError("database attestation identity changed")
    if value.get("status") != "PRE_OUTCOME_DATABASE_BYTES_VERIFIED":
        raise StudyError("database attestation status changed")
    if value.get("databaseBytes") != DATABASE_BYTES or value.get("databaseSha256") != DATABASE_SHA256:
        raise StudyError("database attestation file binding changed")
    if value.get("integrityReportCanonicalSha256") != INTEGRITY_REPORT_CANONICAL_SHA256:
        raise StudyError("database attestation integrity binding changed")
    if value.get("logicalEvidenceSha256") != LOGICAL_EVIDENCE_SHA256:
        raise StudyError("database attestation logical binding changed")
    if value.get("outcomesAccessed") is not False or value.get("postAnchorFactsRead") is not False:
        raise StudyError("database attestation outcome lock is open")
    claimed = value.get("attestationSha256")
    if claimed != unsigned_canonical_sha256(value, "attestationSha256"):
        raise StudyError("database attestation self-hash changed")
    if not raw:
        raise StudyError("database attestation byte snapshot is empty")
    return claimed


def open_database(path: Path) -> sqlite3.Connection:
    resolved = path.expanduser().resolve()
    database_snapshot_state(resolved)
    connection = sqlite3.connect(f"file:{resolved.as_posix()}?mode=ro&immutable=1", uri=True)
    schema = connection.execute("SELECT value FROM meta WHERE key='schema'").fetchone()
    if schema is None or schema[0] != "early-detection-pit-compact-sqlite/v1":
        connection.close()
        raise StudyError("database is not the expected compact PIT ledger")
    return connection


def selected_payloads(connection: sqlite3.Connection, last_quarter: str) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT payload_id,payload_sha256,quarter,observed_at,source_url
          FROM source_payloads p
         WHERE quarter<=?
           AND observed_at_epoch=(
             SELECT MIN(p2.observed_at_epoch)
               FROM source_payloads p2
              WHERE p2.quarter=p.quarter
           )
         ORDER BY quarter,payload_sha256
        """,
        (last_quarter,),
    ).fetchall()
    by_quarter: dict[str, list[tuple[Any, ...]]] = defaultdict(list)
    for row in rows:
        by_quarter[row[2]].append(row)
    ambiguous = [quarter for quarter, values in by_quarter.items() if len(values) != 1]
    if ambiguous:
        raise StudyError(f"ambiguous earliest payload for quarters: {ambiguous}")
    return [
        {
            "payloadId": row[0],
            "payloadSha256": row[1],
            "quarter": row[2],
            "observedAt": compact_observed_at(row[3]),
            "sourceUrl": None,
        }
        for row in rows
    ]


def compact_observed_at(raw: str) -> str:
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise StudyError(f"invalid source payload observedAt: {raw}") from exc
    return parsed.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%S000Z")


def build_source_line(integrity_report: Path) -> dict[str, Any]:
    integrity = load_json(integrity_report)
    if integrity.get("schema") != "early-detection-pit-compact-integrity/v1" or integrity.get("status") != "PASS_FULL_INTEGRITY":
        raise StudyError("source-line input is not a passing compact-ledger integrity report")
    if unsigned_canonical_sha256(integrity, "reportSha256") != INTEGRITY_REPORT_CANONICAL_SHA256:
        raise StudyError("compact-ledger integrity report canonical hash changed")
    if integrity.get("reportSha256") != INTEGRITY_REPORT_CANONICAL_SHA256:
        raise StudyError("compact-ledger integrity report self-hash changed")
    if integrity.get("logicalEvidenceSha256") != LOGICAL_EVIDENCE_SHA256:
        raise StudyError("compact-ledger logical evidence identity changed")
    payloads = [
        {
            "payloadId": row["payloadId"],
            "payloadSha256": row["payloadSha256"],
            "quarter": row["quarter"],
            "observedAt": Path(row["observationPath"]).name.split("-", 1)[0],
            "sourceUrl": None,
        }
        for row in integrity.get("payloads", [])
        if row.get("quarter") <= ENDPOINT_LAST_QUARTER
    ]
    by_quarter: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in payloads:
        by_quarter[row["quarter"]].append(row)
    selected = []
    for quarter in sorted(by_quarter):
        values = sorted(by_quarter[quarter], key=lambda row: (row["observedAt"], row["payloadSha256"]))
        if len(values) > 1 and values[0]["observedAt"] == values[1]["observedAt"]:
            raise StudyError(f"ambiguous earliest payload observation for quarter: {quarter}")
        selected.append(values[0])
    payloads = selected
    if canonical_sha256(payloads) != SOURCE_LINE_PAYLOADS_SHA256:
        raise StudyError("selected source-line payload set changed")
    value = {
        "schema": SOURCE_SCHEMA,
        "protocol": PROTOCOL,
        "status": "PRE_OUTCOME_SOURCE_LINE",
        "selection": "EARLIEST_OBSERVED_PAYLOAD_PER_FSD_QUARTER",
        "firstQuarter": payloads[0]["quarter"],
        "lastQuarter": payloads[-1]["quarter"],
        "payloadCount": len(payloads),
        "payloads": payloads,
        "integrityReportCanonicalSha256": integrity.get("reportSha256"),
        "outcomesAccessed": False,
        "postAnchorFactsRead": False,
    }
    value["sourceLineSha256"] = canonical_sha256(value)
    return value


def validate_source_line(source_line: dict[str, Any]) -> str:
    expected_keys = {
        "schema", "protocol", "status", "selection", "firstQuarter", "lastQuarter",
        "payloadCount", "payloads", "integrityReportCanonicalSha256",
        "outcomesAccessed", "postAnchorFactsRead",
        "sourceLineSha256",
    }
    if set(source_line) != expected_keys:
        raise StudyError("source-line key set changed")
    claimed = source_line.get("sourceLineSha256")
    if source_line.get("schema") != SOURCE_SCHEMA or source_line.get("protocol") != PROTOCOL:
        raise StudyError("source-line identity changed")
    if claimed != unsigned_canonical_sha256(source_line, "sourceLineSha256"):
        raise StudyError("source-line manifest self-hash is invalid")
    if source_line.get("status") != "PRE_OUTCOME_SOURCE_LINE":
        raise StudyError("source-line status changed")
    if source_line.get("selection") != "EARLIEST_OBSERVED_PAYLOAD_PER_FSD_QUARTER":
        raise StudyError("source-line selection changed")
    if source_line.get("integrityReportCanonicalSha256") != INTEGRITY_REPORT_CANONICAL_SHA256:
        raise StudyError("source-line integrity canonical binding changed")
    if source_line.get("outcomesAccessed") is not False or source_line.get("postAnchorFactsRead") is not False:
        raise StudyError("source-line outcome lock is open")
    payloads = source_line.get("payloads")
    if not isinstance(payloads, list) or canonical_sha256(payloads) != SOURCE_LINE_PAYLOADS_SHA256:
        raise StudyError("source-line payload set changed")
    if source_line.get("payloadCount") != len(payloads) or len(payloads) != 27:
        raise StudyError("source-line payload count changed")
    if source_line.get("firstQuarter") != "2009q1" or source_line.get("lastQuarter") != ENDPOINT_LAST_QUARTER:
        raise StudyError("source-line quarter bounds changed")
    return claimed


def load_json_snapshot(path: Path) -> tuple[dict[str, Any], bytes]:
    raw = path.read_bytes()
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise StudyError(f"cannot load JSON snapshot: {path}") from exc
    if not isinstance(value, dict):
        raise StudyError(f"JSON snapshot root must be an object: {path}")
    return value, raw


def parse_date_int(raw: int) -> date:
    try:
        return datetime.strptime(str(raw), "%Y%m%d").date()
    except ValueError as exc:
        raise StudyError(f"invalid FSD date: {raw}") from exc


def finite(raw: str | None) -> Decimal | None:
    if raw is None:
        return None
    try:
        value = Decimal(raw)
    except InvalidOperation:
        return None
    return value if value.is_finite() else None


def decimal_text(value: Decimal) -> str:
    if value == ZERO:
        return "0"
    return format(value.normalize(), "f")


def source_ref(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "payloadId": row["payloadId"],
        "rowNumber": row["rowNumber"],
        "accession": row["accession"],
        "acceptedAtEpoch": row["acceptedAtEpoch"],
        "form": row["form"],
        "fiscalYear": row["fiscalYear"],
        "fiscalPeriod": row["fiscalPeriod"],
        "filingPeriodEnd": row["filingPeriodEnd"],
        "concept": row["concept"],
        "qtrs": row["qtrs"],
        "periodEnd": row["periodEnd"],
        "unit": row["unit"],
        "rowSha256": row["rowSha256"],
    }


def candidate_revision(row: dict[str, Any]) -> tuple[int, str]:
    return row["acceptedAtEpoch"], row["accession"]


def add_candidate(
    target: dict[str, dict[int, dict[int, dict[str, Any]]]], row: dict[str, Any]
) -> None:
    bucket = target[row["concept"]][row["qtrs"]]
    existing = bucket.get(row["periodEnd"])
    if existing is None:
        bucket[row["periodEnd"]] = row
        return
    if existing.get("ambiguous"):
        return
    new_key = candidate_revision(row)
    old_key = candidate_revision(existing)
    if (
        row["value"] != existing["value"]
        or row["fiscalYear"] != existing["fiscalYear"]
        or row["fiscalPeriod"] != existing["fiscalPeriod"]
    ):
        bucket[row["periodEnd"]] = {
            "ambiguous": True,
            "periodEnd": row["periodEnd"],
            "concept": row["concept"],
        }
    elif new_key > old_key:
        bucket[row["periodEnd"]] = row


def validate_precutoff_row(row: dict[str, Any]) -> None:
    if row["acceptedAtEpoch"] > CUTOFF_EPOCH:
        raise StudyError("post-cutoff acceptedAt crossed the exposure boundary")
    if row["periodEnd"] > 20140630 or row["filingPeriodEnd"] != row["periodEnd"]:
        raise StudyError("future or comparative period crossed the exposure boundary")
    accepted_date = datetime.fromtimestamp(row["acceptedAtEpoch"], timezone.utc).date()
    if accepted_date < parse_date_int(row["periodEnd"]):
        raise StudyError("fact was accepted before its reported period ended")


def fiscal_quarter_number(fiscal_period: str | None) -> int | None:
    return {"Q1": 1, "Q2": 2, "Q3": 3, "Q4": 4, "FY": 4}.get(fiscal_period)


def choose_direct(
    facts: dict[str, dict[int, dict[int, dict[str, Any]]]], concepts: list[str]
) -> dict[int, dict[str, Any]]:
    out: dict[int, dict[str, Any]] = {}
    all_dates = sorted({d for concept in concepts for d in facts.get(concept, {}).get(1, {})})
    for period_end in all_dates:
        for concept in concepts:
            row = facts.get(concept, {}).get(1, {}).get(period_end)
            if row is None:
                continue
            if row.get("ambiguous"):
                out[period_end] = {"ambiguous": True, "periodEnd": period_end, "concept": concept}
            elif fiscal_quarter_number(row.get("fiscalPeriod")) not in {1, 2, 3}:
                out[period_end] = {"ambiguous": True, "periodEnd": period_end, "concept": concept}
            else:
                out[period_end] = {
                    "value": row["value"],
                    "concept": concept,
                    "periodEnd": period_end,
                    "fiscalYear": row["fiscalYear"],
                    "fiscalQuarter": fiscal_quarter_number(row["fiscalPeriod"]),
                    "derivation": "DIRECT_QTRS1",
                    "acceptedAtEpoch": row["acceptedAtEpoch"],
                    "sourceRefs": [source_ref(row)],
                }
            break
    return out


def matching_prior(
    rows: dict[int, dict[str, Any]], period_end: int, fiscal_year: int, fiscal_period: str
) -> dict[str, Any] | None:
    current_date = parse_date_int(period_end)
    candidates = []
    for prior_end, row in rows.items():
        if (
            prior_end >= period_end
            or row.get("fiscalYear") != fiscal_year
            or row.get("fiscalPeriod") != fiscal_period
        ):
            continue
        gap = (current_date - parse_date_int(prior_end)).days
        if QUARTER_GAP_MIN <= gap <= QUARTER_GAP_MAX:
            candidates.append((prior_end, row))
    if len(candidates) != 1:
        return None
    return candidates[0][1]


def derive_q4(
    facts: dict[str, dict[int, dict[int, dict[str, Any]]]], concepts: list[str]
) -> dict[int, dict[str, Any]]:
    out: dict[int, dict[str, Any]] = {}
    claimed_dates = sorted({d for concept in concepts for d in facts.get(concept, {}).get(4, {})})
    for period_end in claimed_dates:
        selected_concept = next(
            (concept for concept in concepts if period_end in facts.get(concept, {}).get(4, {})),
            None,
        )
        if selected_concept is None:
            continue
        annual = facts[selected_concept][4][period_end]
        if annual.get("fiscalPeriod") not in {"FY", "Q4"}:
            out[period_end] = {"ambiguous": True, "periodEnd": period_end, "concept": selected_concept}
            continue
        prior = matching_prior(
            facts.get(selected_concept, {}).get(3, {}), period_end,
            annual.get("fiscalYear"), "Q3",
        )
        if annual.get("ambiguous") or (prior is not None and prior.get("ambiguous")):
            out[period_end] = {"ambiguous": True, "periodEnd": period_end, "concept": selected_concept}
            continue
        if prior is None:
            out[period_end] = {"ambiguous": True, "periodEnd": period_end, "concept": selected_concept}
            continue
        out[period_end] = {
            "value": annual["value"] - prior["value"],
            "concept": selected_concept,
            "periodEnd": period_end,
            "fiscalYear": annual["fiscalYear"],
            "fiscalQuarter": 4,
            "derivation": "QTRS4_MINUS_QTRS3_SAME_CIK_CONCEPT_UNIT_FY",
            "acceptedAtEpoch": max(annual["acceptedAtEpoch"], prior["acceptedAtEpoch"]),
            "sourceRefs": [source_ref(annual), source_ref(prior)],
        }
    return out


def revenue_quarters(
    facts: dict[str, dict[int, dict[int, dict[str, Any]]]], concepts: list[str]
) -> dict[int, dict[str, Any]]:
    direct = choose_direct(facts, concepts)
    derived = derive_q4(facts, concepts)
    result: dict[int, dict[str, Any]] = {}
    for period_end in sorted(set(direct) | set(derived)):
        selected_concept = next(
            (
                concept for concept in concepts
                if (
                    direct.get(period_end, {}).get("concept") == concept
                    or derived.get(period_end, {}).get("concept") == concept
                )
            ),
            None,
        )
        candidates = [
            row for row in (direct.get(period_end), derived.get(period_end))
            if row is not None and row.get("concept") == selected_concept
        ]
        if len(candidates) != 1:
            result[period_end] = {"ambiguous": True, "periodEnd": period_end, "concept": selected_concept}
        else:
            result[period_end] = candidates[0]
    return result


def cash_flow_quarters(
    facts: dict[str, dict[int, dict[int, dict[str, Any]]]], concepts: list[str]
) -> dict[int, dict[str, Any]]:
    out: dict[int, dict[str, Any]] = {}
    claimed_dates = sorted({
        period_end
        for concept in concepts
        for qtrs in (1, 2, 3, 4)
        for period_end in facts.get(concept, {}).get(qtrs, {})
    })
    for period_end in claimed_dates:
        selected_concept = next(
            (
                concept for concept in concepts
                if any(period_end in facts.get(concept, {}).get(qtrs, {}) for qtrs in (1, 2, 3, 4))
            ),
            None,
        )
        if selected_concept is None:
            continue
        by_qtrs = facts[selected_concept]
        direct = by_qtrs.get(1, {}).get(period_end)
        cumulative_qtrs = [qtrs for qtrs in (2, 3, 4) if period_end in by_qtrs.get(qtrs, {})]
        if direct is not None and not direct.get("ambiguous"):
            fiscal_quarter = fiscal_quarter_number(direct.get("fiscalPeriod"))
            if fiscal_quarter in {1, 2, 3} and not cumulative_qtrs:
                out[period_end] = {
                    "value": direct["value"],
                    "concept": selected_concept,
                    "periodEnd": period_end,
                    "fiscalYear": direct["fiscalYear"],
                    "fiscalQuarter": fiscal_quarter,
                    "derivation": "DIRECT_QTRS1",
                    "acceptedAtEpoch": direct["acceptedAtEpoch"],
                    "sourceRefs": [source_ref(direct)],
                }
                continue
        if direct is not None or len(cumulative_qtrs) != 1:
            out[period_end] = {"ambiguous": True, "periodEnd": period_end, "concept": selected_concept}
            continue
        qtrs = cumulative_qtrs[0]
        current = by_qtrs[qtrs][period_end]
        allowed_periods = {"FY", "Q4"} if qtrs == 4 else {{2: "Q2", 3: "Q3"}[qtrs]}
        prior_period = {2: "Q1", 3: "Q2", 4: "Q3"}[qtrs]
        prior = matching_prior(
            by_qtrs.get(qtrs - 1, {}), period_end, current.get("fiscalYear"), prior_period
        )
        if (
            current.get("ambiguous")
            or current.get("fiscalPeriod") not in allowed_periods
            or prior is None
            or prior.get("ambiguous")
        ):
            out[period_end] = {"ambiguous": True, "periodEnd": period_end, "concept": selected_concept}
            continue
        out[period_end] = {
            "value": current["value"] - prior["value"],
            "concept": selected_concept,
            "periodEnd": period_end,
            "fiscalYear": current["fiscalYear"],
            "fiscalQuarter": qtrs,
            "derivation": f"QTRS{qtrs}_MINUS_QTRS{qtrs - 1}_SAME_CIK_CONCEPT_UNIT_FY",
            "acceptedAtEpoch": max(current["acceptedAtEpoch"], prior["acceptedAtEpoch"]),
            "sourceRefs": [source_ref(current), source_ref(prior)],
        }
    return out


def exact_nine_sequences(revenue: dict[int, dict[str, Any]]) -> list[list[int]]:
    by_fiscal_quarter: dict[int, list[tuple[int, dict[str, Any]]]] = defaultdict(list)
    for period_end, row in revenue.items():
        if row.get("ambiguous"):
            continue
        fy = row.get("fiscalYear")
        fq = row.get("fiscalQuarter")
        if not isinstance(fy, int) or fq not in {1, 2, 3, 4}:
            continue
        by_fiscal_quarter[fy * 4 + fq - 1].append((period_end, row))
    cutoff_date = datetime.fromtimestamp(CUTOFF_EPOCH, timezone.utc).date()
    sequences = []
    for ordinal in sorted(by_fiscal_quarter, reverse=True):
        slots = [by_fiscal_quarter.get(ordinal - offset, []) for offset in range(9)]
        if any(len(slot) != 1 for slot in slots):
            continue
        sequence = [slot[0][0] for slot in slots]
        anchor_date = parse_date_int(sequence[0])
        lag = (cutoff_date - anchor_date).days
        if lag < 0 or lag > MAX_ANCHOR_LAG_DAYS:
            continue
        gaps = [
            (parse_date_int(sequence[index]) - parse_date_int(sequence[index + 1])).days
            for index in range(8)
        ]
        if all(QUARTER_GAP_MIN <= gap <= QUARTER_GAP_MAX for gap in gaps):
            sequences.append(sequence)
    return sequences


def classify_entity(entity: dict[str, Any], facts: dict[str, Any]) -> dict[str, Any]:
    revenue = revenue_quarters(facts, entity["roleConcepts"]["revenue"])
    operating_cash_flow = cash_flow_quarters(facts, entity["roleConcepts"]["operatingCashFlow"])
    base = {
        "cik": str(entity["cik"]).zfill(10),
        "name": entity["name"],
        "sic": entity["sic"],
    }
    sequences = exact_nine_sequences(revenue)
    if not sequences:
        return {**base, "status": "EXCLUDED", "reason": "NO_EXACT_NINE_QUARTER_REVENUE_SEQUENCE"}
    last_reason = "PREOUTCOME_NOT_COMPUTABLE"
    selected = None
    for dates in sequences:
        rows = [revenue[d] for d in dates]
        values = [row["value"] for row in rows]
        if any(values[i + 4] <= ZERO for i in range(5)):
            last_reason = "NONPOSITIVE_REVENUE_BASE"
            continue
        ocf_dates = dates[:4]
        if any(d not in operating_cash_flow or operating_cash_flow[d].get("ambiguous") for d in ocf_dates):
            last_reason = "INCOMPLETE_LAST_FOUR_QUARTER_OCF"
            continue
        ocf_rows = [operating_cash_flow[d] for d in ocf_dates]
        if len({row["concept"] for row in ocf_rows}) != 1:
            last_reason = "CROSS_CONCEPT_OCF_SEQUENCE"
            continue
        selected = (dates, values, ocf_dates, ocf_rows)
        break
    if selected is None:
        return {**base, "status": "EXCLUDED", "reason": last_reason}
    dates, values, ocf_dates, ocf_rows = selected
    yoy = [values[i] / values[i + 4] - Decimal(1) for i in range(5)]
    ocf_sum = sum((row["value"] for row in ocf_rows), ZERO)
    acceleration = yoy[0] - statistics.median(yoy[1:5])
    positive = yoy[0] >= MIN_REVENUE_YOY and acceleration >= MIN_ACCELERATION and ocf_sum > ZERO
    return {
        **base,
        "status": "ELIGIBLE",
        "anchorPeriodEnd": str(dates[0]),
        "exposure": "TRIGGER_POSITIVE" if positive else "TRIGGER_NEGATIVE",
        "currentRevenueYoy": decimal_text(yoy[0]),
        "previousFourRevenueYoyMedian": decimal_text(statistics.median(yoy[1:5])),
        "revenueYoyAcceleration": decimal_text(acceleration),
        "lastFourQuarterOperatingCashFlow": decimal_text(ocf_sum),
        "quarterlyRevenue": [
            {"periodEnd": str(d), "value": decimal_text(revenue[d]["value"]), "concept": revenue[d]["concept"],
             "fiscalYear": revenue[d]["fiscalYear"], "fiscalQuarter": revenue[d]["fiscalQuarter"],
             "derivation": revenue[d]["derivation"], "sourceRefs": revenue[d]["sourceRefs"]}
            for d in dates
        ],
        "quarterlyOperatingCashFlow": [
            {"periodEnd": str(d), "value": decimal_text(operating_cash_flow[d]["value"]),
             "concept": operating_cash_flow[d]["concept"],
             "fiscalYear": operating_cash_flow[d]["fiscalYear"],
             "fiscalQuarter": operating_cash_flow[d]["fiscalQuarter"],
             "derivation": operating_cash_flow[d]["derivation"],
             "sourceRefs": operating_cash_flow[d]["sourceRefs"]}
            for d in ocf_dates
        ],
    }


def load_precutoff(connection: sqlite3.Connection, role_concepts: dict[str, list[str]]) -> tuple[dict[int, dict[str, Any]], dict[int, Any], list[dict[str, Any]]]:
    payloads = selected_payloads(connection, CUTOFF_QUARTER)
    payload_ids = [row["payloadId"] for row in payloads]
    if not payload_ids:
        raise StudyError("no pre-cutoff payloads")
    marks = ",".join("?" for _ in payload_ids)
    entities: dict[int, dict[str, Any]] = {}
    for cik, name, sic, accepted_at, accession in connection.execute(
        f"""
        SELECT cik,name,sic,accepted_at_epoch,adsh
          FROM submissions
         WHERE payload_id IN ({marks})
           AND form IN ('10-Q','10-K')
           AND accepted_at_epoch<=?
         ORDER BY cik,accepted_at_epoch,adsh
        """,
        [*payload_ids, CUTOFF_EPOCH],
    ):
        entities[cik] = {"cik": cik, "name": name, "sic": sic, "acceptedAtEpoch": accepted_at,
                         "accession": accession, "roleConcepts": role_concepts}

    tags = sorted({tag for concepts in role_concepts.values() for tag in concepts})
    tag_marks = ",".join("?" for _ in tags)
    facts: dict[int, Any] = defaultdict(lambda: defaultdict(lambda: defaultdict(dict)))
    rows = connection.execute(
        f"""
        SELECT s.cik,s.adsh,s.form,s.accepted_at_epoch,s.period_end,s.fy,s.fp,
               c.tag,f.ddate,f.qtrs,u.uom,f.value_text,f.row_number,f.payload_id,
               hex(f.row_sha256)
          FROM facts f
          JOIN submissions s ON s.submission_id=f.submission_id
          JOIN concepts c ON c.concept_id=f.concept_id
          JOIN units u ON u.unit_id=f.unit_id
         WHERE f.payload_id IN ({marks})
           AND c.tag IN ({tag_marks})
           AND f.qtrs IN (1,2,3,4)
           AND f.coreg IS NULL
           AND u.uom='USD'
           AND s.form IN ('10-Q','10-K')
           AND s.accepted_at_epoch<=?
           AND s.period_end=f.ddate
           AND f.ddate<=20140630
         ORDER BY s.cik,c.tag,f.qtrs,f.ddate,s.accepted_at_epoch,s.adsh,f.row_number
        """,
        [*payload_ids, *tags, CUTOFF_EPOCH],
    )
    for (
        cik, accession, form, accepted_at, filing_period_end, fiscal_year, fiscal_period,
        concept, period_end, qtrs, unit, raw_value, row_number, payload_id, row_sha,
    ) in rows:
        value = finite(raw_value)
        if value is None or fiscal_year is None or fiscal_period not in {"Q1", "Q2", "Q3", "Q4", "FY"}:
            continue
        row = {
            "payloadId": payload_id,
            "rowNumber": row_number,
            "accession": accession,
            "form": form,
            "acceptedAtEpoch": accepted_at,
            "filingPeriodEnd": filing_period_end,
            "fiscalYear": fiscal_year,
            "fiscalPeriod": fiscal_period,
            "concept": concept,
            "periodEnd": period_end,
            "qtrs": qtrs,
            "unit": unit,
            "value": value,
            "rowSha256": row_sha.lower(),
        }
        validate_precutoff_row(row)
        add_candidate(facts[cik], row)
    return entities, facts, payloads


def build_exposure(database: Path, source_line_path: Path) -> dict[str, Any]:
    contract, role_concepts = load_contracts()
    source_line, source_line_bytes = load_json_snapshot(source_line_path)
    claimed = validate_source_line(source_line)
    database_attestation, database_attestation_bytes = load_json_snapshot(DATABASE_ATTESTATION_PATH)
    database_attestation_claimed = validate_database_attestation(database_attestation, database_attestation_bytes)
    snapshot_before = verify_database_sha256(database)
    connection = open_database(database)
    if database_snapshot_state(database) != snapshot_before:
        connection.close()
        raise StudyError("database snapshot changed between hash verification and query")
    try:
        entities, facts, payloads = load_precutoff(connection, role_concepts)
    finally:
        connection.close()
    snapshot_after = verify_database_sha256(database)
    if snapshot_after != snapshot_before:
        raise StudyError("database identity changed during exposure extraction")
    if payloads != [row for row in source_line["payloads"] if row["quarter"] <= CUTOFF_QUARTER]:
        raise StudyError("database pre-cutoff payloads do not match the bound source line")
    rows = [classify_entity(entities[cik], facts.get(cik, {})) for cik in sorted(entities)]
    eligible = [row for row in rows if row["status"] == "ELIGIBLE"]
    exposure_counts = defaultdict(int)
    exclusion_counts = defaultdict(int)
    for row in rows:
        if row["status"] == "ELIGIBLE":
            exposure_counts[row["exposure"]] += 1
        else:
            exclusion_counts[row["reason"]] += 1
    result = {
        "schema": EXPOSURE_SCHEMA,
        "protocol": PROTOCOL,
        "status": "PREOUTCOME_EXPOSURE_ONLY",
        "commonObservationCutoff": CUTOFF,
        "scopeNormalizedTextSha256": normalized_text_sha256(SCOPE_PATH),
        "claimContractCanonicalSha256": canonical_sha256(contract),
        "conceptMapCanonicalSha256": canonical_sha256(load_json(CONCEPT_MAP_PATH)),
        "databaseAttestationFileSha256": sha256_bytes(database_attestation_bytes),
        "databaseAttestationCanonicalSha256": database_attestation_claimed,
        "sourceLineFileSha256": sha256_bytes(source_line_bytes),
        "sourceLineCanonicalSha256": claimed,
        "precutoffPayloads": payloads,
        "counts": {
            "candidateCiks": len(rows),
            "eligibleCiks": len(eligible),
            "excludedCiks": len(rows) - len(eligible),
            "exposures": dict(sorted(exposure_counts.items())),
            "exclusions": dict(sorted(exclusion_counts.items())),
        },
        "rows": rows,
        "claimLocks": CLAIM_LOCKS,
        "outcomesAccessed": False,
        "postAnchorFactsRead": False,
        "postAnchorFactsMaterialized": False,
        "analysisExecuted": False,
    }
    result["reportSha256"] = canonical_sha256(result)
    return result


SOURCE_REF_KEYS = {
    "payloadId", "rowNumber", "accession", "acceptedAtEpoch", "form",
    "fiscalYear", "fiscalPeriod", "filingPeriodEnd", "concept", "qtrs",
    "periodEnd", "unit", "rowSha256",
}
QUARTER_ITEM_KEYS = {
    "periodEnd", "value", "concept", "fiscalYear", "fiscalQuarter",
    "derivation", "sourceRefs",
}


def validate_source_ref(ref: dict[str, Any], allowed_payload_ids: set[int]) -> None:
    if not isinstance(ref, dict) or set(ref) != SOURCE_REF_KEYS:
        raise StudyError("invalid source reference schema")
    if ref.get("payloadId") not in allowed_payload_ids or not isinstance(ref.get("rowNumber"), int):
        raise StudyError("source reference is not bound to the pre-cutoff source line")
    if not isinstance(ref.get("accession"), str) or not ref["accession"]:
        raise StudyError("invalid source reference accession")
    if ref.get("form") not in {"10-Q", "10-K"} or ref.get("unit") != "USD":
        raise StudyError("source reference form or unit changed")
    if not isinstance(ref.get("acceptedAtEpoch"), int) or ref["acceptedAtEpoch"] > CUTOFF_EPOCH:
        raise StudyError("post-cutoff source reference detected")
    if not isinstance(ref.get("fiscalYear"), int) or ref.get("fiscalPeriod") not in {"Q1", "Q2", "Q3", "Q4", "FY"}:
        raise StudyError("invalid source reference fiscal identity")
    if not isinstance(ref.get("periodEnd"), int) or ref["periodEnd"] > 20140630:
        raise StudyError("future source reference period detected")
    if ref.get("filingPeriodEnd") != ref.get("periodEnd"):
        raise StudyError("comparative source reference detected")
    accepted_date = datetime.fromtimestamp(ref["acceptedAtEpoch"], timezone.utc).date()
    if accepted_date < parse_date_int(ref["periodEnd"]):
        raise StudyError("source reference predates its reporting period")
    if not isinstance(ref.get("concept"), str) or not ref["concept"]:
        raise StudyError("invalid source reference concept")
    if ref.get("qtrs") not in {1, 2, 3, 4}:
        raise StudyError("invalid source reference duration")
    if not isinstance(ref.get("rowSha256"), str) or re.fullmatch(r"[0-9a-f]{64}", ref["rowSha256"]) is None:
        raise StudyError("invalid source reference row hash")


def validate_quarter_item(
    item: dict[str, Any], allowed_concepts: set[str], allowed_payload_ids: set[int]
) -> tuple[int, Decimal, int, int]:
    if not isinstance(item, dict) or set(item) != QUARTER_ITEM_KEYS:
        raise StudyError("invalid quarterly item schema")
    if not isinstance(item.get("periodEnd"), str) or re.fullmatch(r"\d{8}", item["periodEnd"]) is None:
        raise StudyError("invalid quarterly period end")
    period_end = int(item["periodEnd"])
    if period_end > 20140630:
        raise StudyError("quarterly item crosses the cutoff")
    parse_date_int(period_end)
    if not isinstance(item.get("value"), str):
        raise StudyError("quarterly value is not canonical text")
    value = finite(item["value"])
    if value is None or decimal_text(value) != item["value"]:
        raise StudyError("quarterly value is not a canonical finite decimal")
    concept = item.get("concept")
    fiscal_year = item.get("fiscalYear")
    fiscal_quarter = item.get("fiscalQuarter")
    if concept not in allowed_concepts or not isinstance(fiscal_year, int) or fiscal_quarter not in {1, 2, 3, 4}:
        raise StudyError("quarterly concept or fiscal identity changed")
    refs = item.get("sourceRefs")
    if not isinstance(refs, list) or not refs:
        raise StudyError("quarterly item has no source references")
    for ref in refs:
        validate_source_ref(ref, allowed_payload_ids)
        if ref["concept"] != concept or ref["fiscalYear"] != fiscal_year:
            raise StudyError("quarterly source reference does not bind the item")
    derivation = item.get("derivation")
    if derivation == "DIRECT_QTRS1":
        if len(refs) != 1 or refs[0]["qtrs"] != 1 or refs[0]["periodEnd"] != period_end:
            raise StudyError("invalid direct-quarter derivation")
        if fiscal_quarter not in {1, 2, 3} or fiscal_quarter_number(refs[0]["fiscalPeriod"]) != fiscal_quarter:
            raise StudyError("direct-quarter fiscal identity changed")
    else:
        expected = f"QTRS{fiscal_quarter}_MINUS_QTRS{fiscal_quarter - 1}_SAME_CIK_CONCEPT_UNIT_FY"
        if fiscal_quarter not in {2, 3, 4} or derivation != expected or len(refs) != 2:
            raise StudyError("invalid cumulative-quarter derivation")
        current, prior = refs
        if current["qtrs"] != fiscal_quarter or prior["qtrs"] != fiscal_quarter - 1:
            raise StudyError("cumulative-quarter durations changed")
        if current["periodEnd"] != period_end or prior["periodEnd"] >= period_end:
            raise StudyError("cumulative-quarter period ordering changed")
        gap = (parse_date_int(period_end) - parse_date_int(prior["periodEnd"])).days
        if not QUARTER_GAP_MIN <= gap <= QUARTER_GAP_MAX:
            raise StudyError("cumulative-quarter gap changed")
        expected_current_period = {2: "Q2", 3: "Q3", 4: None}[fiscal_quarter]
        if expected_current_period is None:
            if current["fiscalPeriod"] not in {"FY", "Q4"}:
                raise StudyError("annual source fiscal period changed")
        elif current["fiscalPeriod"] != expected_current_period:
            raise StudyError("cumulative source fiscal period changed")
        if prior["fiscalPeriod"] != {2: "Q1", 3: "Q2", 4: "Q3"}[fiscal_quarter]:
            raise StudyError("prior cumulative source fiscal period changed")
    return period_end, value, fiscal_year, fiscal_quarter


def validate_eligible_semantics(
    row: dict[str, Any], role_concepts: dict[str, list[str]], allowed_payload_ids: set[int]
) -> None:
    revenue_items = row["quarterlyRevenue"]
    ocf_items = row["quarterlyOperatingCashFlow"]
    revenue = [
        validate_quarter_item(item, set(role_concepts["revenue"]), allowed_payload_ids)
        for item in revenue_items
    ]
    ocf = [
        validate_quarter_item(item, set(role_concepts["operatingCashFlow"]), allowed_payload_ids)
        for item in ocf_items
    ]
    dates = [item[0] for item in revenue]
    if row.get("anchorPeriodEnd") != str(dates[0]):
        raise StudyError("eligible anchor does not match the frozen quarter sequence")
    ordinals = [fy * 4 + fq - 1 for _, _, fy, fq in revenue]
    if any(ordinals[index] - ordinals[index + 1] != 1 for index in range(8)):
        raise StudyError("revenue fiscal-quarter sequence is not exact")
    gaps = [(parse_date_int(dates[index]) - parse_date_int(dates[index + 1])).days for index in range(8)]
    if not all(QUARTER_GAP_MIN <= gap <= QUARTER_GAP_MAX for gap in gaps):
        raise StudyError("revenue calendar-quarter sequence changed")
    values = [item[1] for item in revenue]
    if any(values[index + 4] <= ZERO for index in range(5)):
        raise StudyError("eligible revenue base is not positive")
    if [item[0] for item in ocf] != dates[:4]:
        raise StudyError("cash-flow quarters do not match the anchor sequence")
    if [(item[2], item[3]) for item in ocf] != [(item[2], item[3]) for item in revenue[:4]]:
        raise StudyError("cash-flow fiscal quarters do not match revenue")
    if len({item["concept"] for item in ocf_items}) != 1:
        raise StudyError("cash-flow sequence crosses concepts")
    yoy = [values[index] / values[index + 4] - Decimal(1) for index in range(5)]
    median = statistics.median(yoy[1:5])
    acceleration = yoy[0] - median
    ocf_sum = sum((item[1] for item in ocf), ZERO)
    expected_metrics = {
        "currentRevenueYoy": decimal_text(yoy[0]),
        "previousFourRevenueYoyMedian": decimal_text(median),
        "revenueYoyAcceleration": decimal_text(acceleration),
        "lastFourQuarterOperatingCashFlow": decimal_text(ocf_sum),
    }
    if any(row.get(key) != expected for key, expected in expected_metrics.items()):
        raise StudyError("eligible metrics do not recompute from frozen quarters")
    positive = yoy[0] >= MIN_REVENUE_YOY and acceleration >= MIN_ACCELERATION and ocf_sum > ZERO
    expected_exposure = "TRIGGER_POSITIVE" if positive else "TRIGGER_NEGATIVE"
    if row.get("exposure") != expected_exposure:
        raise StudyError("eligible exposure does not recompute from frozen quarters")


def verify_exposure_contract(path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    value = load_json(path)
    claimed = value.get("reportSha256")
    expected_top_keys = {
        "schema", "protocol", "status", "commonObservationCutoff",
        "scopeNormalizedTextSha256", "claimContractCanonicalSha256",
        "conceptMapCanonicalSha256", "databaseAttestationFileSha256",
        "databaseAttestationCanonicalSha256", "sourceLineFileSha256",
        "sourceLineCanonicalSha256", "precutoffPayloads", "counts", "rows",
        "claimLocks", "outcomesAccessed", "postAnchorFactsRead",
        "postAnchorFactsMaterialized", "analysisExecuted", "reportSha256",
    }
    if set(value) != expected_top_keys:
        raise StudyError("exposure top-level key set changed")
    if value.get("schema") != EXPOSURE_SCHEMA or value.get("protocol") != PROTOCOL:
        raise StudyError("exposure identity mismatch")
    if value.get("status") != "PREOUTCOME_EXPOSURE_ONLY" or value.get("commonObservationCutoff") != CUTOFF:
        raise StudyError("exposure status or cutoff changed")
    if claimed != unsigned_canonical_sha256(value, "reportSha256"):
        raise StudyError("exposure report hash mismatch")
    contract, role_concepts = load_contracts()
    database_attestation, database_attestation_bytes = load_json_snapshot(DATABASE_ATTESTATION_PATH)
    database_attestation_claimed = validate_database_attestation(database_attestation, database_attestation_bytes)
    source_line, source_line_bytes = load_json_snapshot(SOURCE_LINE_PATH)
    source_claimed = validate_source_line(source_line)
    expected_bindings = {
        "scopeNormalizedTextSha256": normalized_text_sha256(SCOPE_PATH),
        "claimContractCanonicalSha256": canonical_sha256(contract),
        "conceptMapCanonicalSha256": CONCEPT_MAP_CANONICAL_SHA256,
        "databaseAttestationFileSha256": sha256_bytes(database_attestation_bytes),
        "databaseAttestationCanonicalSha256": database_attestation_claimed,
        "sourceLineFileSha256": sha256_bytes(source_line_bytes),
        "sourceLineCanonicalSha256": source_claimed,
    }
    if any(value.get(key) != expected for key, expected in expected_bindings.items()):
        raise StudyError("exposure artifact binding changed")
    expected_payloads = [row for row in source_line["payloads"] if row["quarter"] <= CUTOFF_QUARTER]
    if value.get("precutoffPayloads") != expected_payloads:
        raise StudyError("exposure pre-cutoff payload binding changed")
    allowed_payload_ids = {row["payloadId"] for row in expected_payloads}
    if value.get("claimLocks") != CLAIM_LOCKS:
        raise StudyError("exposure claim locks changed")
    for key in ("outcomesAccessed", "postAnchorFactsRead", "postAnchorFactsMaterialized", "analysisExecuted"):
        if value.get(key) is not False:
            raise StudyError(f"exposure lock is open: {key}")
    rows = value.get("rows")
    if not isinstance(rows, list) or not rows:
        raise StudyError("exposure rows must be a non-empty list")
    ciks = [row.get("cik") for row in rows]
    if ciks != sorted(ciks) or len(ciks) != len(set(ciks)):
        raise StudyError("exposure rows are not CIK-sorted")
    forbidden_row_keys = {"endpoint", "outcome", "futureQuarters", "persistence"}
    exposure_counts: dict[str, int] = defaultdict(int)
    exclusion_counts: dict[str, int] = defaultdict(int)
    for row in rows:
        if forbidden_row_keys & set(row):
            raise StudyError("exposure row contains a forbidden post-cutoff field")
        if not isinstance(row.get("cik"), str) or len(row["cik"]) != 10 or not row["cik"].isdigit():
            raise StudyError("invalid CIK key")
        if row.get("status") == "EXCLUDED":
            if set(row) != {"cik", "name", "sic", "status", "reason"} or not isinstance(row.get("reason"), str):
                raise StudyError("invalid excluded row schema")
            exclusion_counts[row["reason"]] += 1
        elif row.get("status") == "ELIGIBLE":
            eligible_keys = {
                "cik", "name", "sic", "status", "anchorPeriodEnd", "exposure",
                "currentRevenueYoy", "previousFourRevenueYoyMedian",
                "revenueYoyAcceleration", "lastFourQuarterOperatingCashFlow",
                "quarterlyRevenue", "quarterlyOperatingCashFlow",
            }
            if set(row) != eligible_keys or row.get("exposure") not in {"TRIGGER_POSITIVE", "TRIGGER_NEGATIVE"}:
                raise StudyError("invalid eligible row schema")
            if len(row.get("quarterlyRevenue", [])) != 9 or len(row.get("quarterlyOperatingCashFlow", [])) != 4:
                raise StudyError("eligible row has incomplete pre-cutoff quarters")
            validate_eligible_semantics(row, role_concepts, allowed_payload_ids)
            exposure_counts[row["exposure"]] += 1
        else:
            raise StudyError("invalid row status")
    recomputed_counts = {
        "candidateCiks": len(rows),
        "eligibleCiks": sum(exposure_counts.values()),
        "excludedCiks": sum(exclusion_counts.values()),
        "exposures": dict(sorted(exposure_counts.items())),
        "exclusions": dict(sorted(exclusion_counts.items())),
    }
    if value.get("counts") != recomputed_counts:
        raise StudyError("exposure counts do not match rows")
    verdict = {
        "status": "PASS", "rows": len(rows), "eligible": value["counts"]["eligibleCiks"],
        "reportSha256": claimed,
    }
    return value, verdict


def verify_exposure(path: Path, database: Path) -> dict[str, Any]:
    value, verdict = verify_exposure_contract(path)
    rebuilt = build_exposure(database, SOURCE_LINE_PATH)
    if value != rebuilt:
        raise StudyError("exposure does not match a deterministic database rebuild")
    return {**verdict, "deterministicDatabaseRebuild": True}


def fixture_row(
    concept: str, qtrs: int, period_end: int, value: str | int, accepted: int,
    accession: str, fiscal_year: int, fiscal_period: str, row_number: int = 1,
) -> dict[str, Any]:
    row_sha = canonical_sha256({
        "concept": concept, "qtrs": qtrs, "periodEnd": period_end, "value": str(value),
        "accepted": accepted, "accession": accession, "fiscalYear": fiscal_year,
        "fiscalPeriod": fiscal_period, "rowNumber": row_number,
    })
    return {
        "payloadId": 1, "rowNumber": row_number, "accession": accession, "form": "10-Q",
        "acceptedAtEpoch": accepted, "concept": concept, "periodEnd": period_end, "qtrs": qtrs,
        "filingPeriodEnd": period_end, "fiscalYear": fiscal_year, "fiscalPeriod": fiscal_period,
        "unit": "USD", "value": Decimal(str(value)), "rowSha256": row_sha,
    }


def fixture_facts(revenues: list[str | int], ocf: list[str | int]) -> dict[str, Any]:
    dates = [
        20140630, 20140331, 20131231, 20130930, 20130630,
        20130331, 20121231, 20120930, 20120630, 20120331,
    ]
    fiscal = [
        (2014, "Q2"), (2014, "Q1"), (2013, "FY"), (2013, "Q3"), (2013, "Q2"),
        (2013, "Q1"), (2012, "FY"), (2012, "Q3"), (2012, "Q2"), (2012, "Q1"),
    ]
    accepted = CUTOFF_EPOCH - 10
    facts: dict[str, Any] = defaultdict(lambda: defaultdict(dict))
    for index, (period_end, value, (fy, fp)) in enumerate(zip(dates, revenues, fiscal)):
        if fp == "FY":
            q3_value = Decimal("300")
            add_candidate(facts, fixture_row("Revenue", 3, dates[index + 1], q3_value, accepted - index, f"rytd{index}", fy, "Q3", 300 + index))
            add_candidate(facts, fixture_row("Revenue", 4, period_end, Decimal(str(value)) + q3_value, accepted - index, f"r{index}", fy, fp, 400 + index))
        else:
            add_candidate(facts, fixture_row("Revenue", 1, period_end, value, accepted - index, f"r{index}", fy, fp, 100 + index))
    for index, (period_end, value, (fy, fp)) in enumerate(zip(dates[:len(ocf)], ocf, fiscal[:len(ocf)])):
        if fp == "Q1":
            add_candidate(facts, fixture_row("OCF", 1, period_end, value, accepted - index, f"c{index}", fy, fp, 500 + index))
        elif fp == "Q2":
            prior = Decimal("10")
            add_candidate(facts, fixture_row("OCF", 1, dates[index + 1], prior, accepted - index, f"cprior{index}", fy, "Q1", 510 + index))
            add_candidate(facts, fixture_row("OCF", 2, period_end, Decimal(str(value)) + prior, accepted - index, f"c{index}", fy, fp, 520 + index))
        elif fp == "Q3":
            prior = Decimal("20")
            add_candidate(facts, fixture_row("OCF", 2, dates[index + 1], prior, accepted - index, f"cprior{index}", fy, "Q2", 530 + index))
            add_candidate(facts, fixture_row("OCF", 3, period_end, Decimal(str(value)) + prior, accepted - index, f"c{index}", fy, fp, 540 + index))
        else:
            prior = Decimal("30")
            add_candidate(facts, fixture_row("OCF", 3, dates[index + 1], prior, accepted - index, f"cprior{index}", fy, "Q3", 550 + index))
            add_candidate(facts, fixture_row("OCF", 4, period_end, Decimal(str(value)) + prior, accepted - index, f"c{index}", fy, fp, 560 + index))
    return facts


def self_test() -> dict[str, Any]:
    _, roles = load_contracts()
    revenue_concept = roles["revenue"][0]
    ocf_concept = roles["operatingCashFlow"][0]
    entity = {"cik": 1, "name": "Fixture", "sic": 3571, "roleConcepts": roles}
    facts = fixture_facts([120, 115, 115, 115, 100, 100, 100, 100, 100, 100], [10, 10, 10, 10])
    facts[revenue_concept] = facts.pop("Revenue")
    facts[ocf_concept] = facts.pop("OCF")
    for by_qtrs in facts.values():
        for by_date in by_qtrs.values():
            for fact in by_date.values():
                if not fact.get("ambiguous"):
                    fact["concept"] = revenue_concept if fact["accession"].startswith("r") else ocf_concept
    accepted = CUTOFF_EPOCH - 10
    positive = classify_entity(entity, facts)
    if positive.get("exposure") != "TRIGGER_POSITIVE":
        raise StudyError("positive fixture was not positive")
    if positive["currentRevenueYoy"] != "0.2" or positive["revenueYoyAcceleration"] != "0.05":
        raise StudyError("exact decimal exposure boundaries drifted")

    zero_facts = fixture_facts(
        [120, 115, 115, 115, 100, 100, 100, 100, 100, 100], [10, 10, 10, 10]
    )
    zero_facts[revenue_concept] = zero_facts.pop("Revenue")
    zero_facts.pop("OCF")
    for by_date in zero_facts[revenue_concept].values():
        for fact in by_date.values():
            if not fact.get("ambiguous"):
                fact["concept"] = revenue_concept
    zero_facts[ocf_concept] = defaultdict(dict)
    for row in (
        fixture_row(ocf_concept, 1, 20140331, "0.2", accepted, "zq1", 2014, "Q1", 601),
        fixture_row(ocf_concept, 2, 20140630, "0.3", accepted, "zq2", 2014, "Q2", 602),
        fixture_row(ocf_concept, 2, 20130630, "1.0", accepted, "zy2", 2013, "Q2", 603),
        fixture_row(ocf_concept, 3, 20130930, "0.7", accepted, "zy3", 2013, "Q3", 604),
        fixture_row(ocf_concept, 4, 20131231, "0.7", accepted, "zy4", 2013, "FY", 605),
    ):
        add_candidate(zero_facts, row)
    zero_ocf = classify_entity(entity, zero_facts)
    if zero_ocf.get("exposure") != "TRIGGER_NEGATIVE" or zero_ocf.get("lastFourQuarterOperatingCashFlow") != "0":
        raise StudyError("exact zero OCF was not kept non-positive")

    future = fixture_row("Revenue", 1, 20140930, 9999, CUTOFF_EPOCH + 1, "future", 2014, "Q3")
    try:
        validate_precutoff_row(future)
    except StudyError:
        post_cutoff_rejected = True
    else:
        post_cutoff_rejected = False
    if not post_cutoff_rejected:
        raise StudyError("post-cutoff fixture crossed the exposure boundary")

    duplicate = fixture_row(revenue_concept, 1, 20130630, 101, accepted - 4, "r4", 2013, "Q2", 999)
    add_candidate(facts, duplicate)
    ambiguous = classify_entity(entity, facts)
    if ambiguous.get("status") != "EXCLUDED":
        raise StudyError("conflicting same-identity value was not rejected")

    cross_fy: dict[str, Any] = defaultdict(lambda: defaultdict(dict))
    add_candidate(cross_fy, fixture_row("Revenue", 4, 20141231, 400, accepted, "annual", 2014, "FY"))
    add_candidate(cross_fy, fixture_row("Revenue", 3, 20140930, 250, accepted, "ytd", 2015, "Q3"))
    cross_fy_result = derive_q4(cross_fy, ["Revenue"])
    if not cross_fy_result[20141231].get("ambiguous"):
        raise StudyError("cross-fiscal-year Q4 derivation was accepted")

    priority_facts: dict[str, Any] = defaultdict(lambda: defaultdict(dict))
    add_candidate(priority_facts, fixture_row("High", 4, 20131231, 400, accepted, "high-annual", 2013, "FY"))
    add_candidate(priority_facts, fixture_row("Low", 4, 20131231, 400, accepted, "low-annual", 2013, "FY"))
    add_candidate(priority_facts, fixture_row("Low", 3, 20130930, 250, accepted, "low-ytd", 2013, "Q3"))
    priority_revenue = derive_q4(priority_facts, ["High", "Low"])
    if not priority_revenue[20131231].get("ambiguous") or priority_revenue[20131231].get("concept") != "High":
        raise StudyError("lower-priority revenue concept substituted for an incomplete higher-priority slot")
    priority_ocf = cash_flow_quarters(priority_facts, ["High", "Low"])
    if not priority_ocf[20131231].get("ambiguous") or priority_ocf[20131231].get("concept") != "High":
        raise StudyError("lower-priority cash-flow concept substituted for an incomplete higher-priority slot")

    cross_derivation_priority: dict[str, Any] = defaultdict(lambda: defaultdict(dict))
    add_candidate(cross_derivation_priority, fixture_row("High", 1, 20140331, 10, accepted, "high-q1", 2014, "Q1"))
    add_candidate(cross_derivation_priority, fixture_row("High", 2, 20140630, 30, accepted, "high-q2", 2014, "Q2"))
    add_candidate(cross_derivation_priority, fixture_row("Low", 1, 20140630, 999, accepted, "low-direct-q2", 2014, "Q2"))
    preferred_ocf = cash_flow_quarters(cross_derivation_priority, ["High", "Low"])[20140630]
    if preferred_ocf.get("concept") != "High" or preferred_ocf.get("value") != Decimal("20"):
        raise StudyError("direct lower-priority concept displaced a derivable higher-priority concept")

    conflicting_derivations: dict[str, Any] = defaultdict(lambda: defaultdict(dict))
    add_candidate(conflicting_derivations, fixture_row("High", 1, 20140331, 10, accepted, "high-q1", 2014, "Q1"))
    add_candidate(conflicting_derivations, fixture_row("High", 1, 20140630, 999, accepted, "high-direct-q2", 2014, "Q2"))
    add_candidate(conflicting_derivations, fixture_row("High", 2, 20140630, 30, accepted, "high-ytd-q2", 2014, "Q2"))
    if not cash_flow_quarters(conflicting_derivations, ["High"])[20140630].get("ambiguous"):
        raise StudyError("conflicting direct and derived cash-flow facts were accepted")

    revenue_derivation_priority: dict[str, Any] = defaultdict(lambda: defaultdict(dict))
    add_candidate(revenue_derivation_priority, fixture_row("High", 1, 20131231, 111, accepted, "high-direct", 2013, "Q3"))
    add_candidate(revenue_derivation_priority, fixture_row("Low", 4, 20131231, 500, accepted, "low-annual", 2013, "FY"))
    add_candidate(revenue_derivation_priority, fixture_row("Low", 3, 20130930, 300, accepted, "low-ytd", 2013, "Q3"))
    preferred_revenue = revenue_quarters(revenue_derivation_priority, ["High", "Low"])[20131231]
    if preferred_revenue.get("concept") != "High" or preferred_revenue.get("value") != Decimal("111"):
        raise StudyError("derived lower-priority concept displaced a direct higher-priority revenue concept")

    revision_facts: dict[str, Any] = defaultdict(lambda: defaultdict(dict))
    add_candidate(revision_facts, fixture_row("Revenue", 1, 20140331, 100, accepted - 100, "old", 2014, "Q1", 701))
    add_candidate(revision_facts, fixture_row("Revenue", 1, 20140331, 999, accepted, "new", 2014, "Q1", 702))
    if not revision_facts["Revenue"][1][20140331].get("ambiguous"):
        raise StudyError("conflicting later original fact silently replaced the earlier fact")

    with tempfile.TemporaryDirectory() as temporary:
        fake_database = Path(temporary) / "tampered.sqlite"
        fake_database.write_bytes(b"not-the-bound-database")
        try:
            verify_snapshot_sha256(fake_database, fake_database.stat().st_size, "0" * 64)
        except StudyError:
            tampered_database_rejected = True
        else:
            tampered_database_rejected = False
    if not tampered_database_rejected:
        raise StudyError("tampered database snapshot was accepted")

    original_verify_database_sha256 = globals()["verify_database_sha256"]
    original_open_database = globals()["open_database"]
    original_database_snapshot_state = globals()["database_snapshot_state"]
    try:
        globals()["verify_database_sha256"] = lambda _path: (DATABASE_BYTES, 100)
        globals()["open_database"] = lambda _path: type("FakeConnection", (), {"close": lambda self: None})()
        globals()["database_snapshot_state"] = lambda _path: (DATABASE_BYTES, 101)
        try:
            build_exposure(Path("synthetic.sqlite"), SOURCE_LINE_PATH)
        except StudyError as exc:
            interposed_database_rejected = "between hash verification and query" in str(exc)
        else:
            interposed_database_rejected = False
    finally:
        globals()["verify_database_sha256"] = original_verify_database_sha256
        globals()["open_database"] = original_open_database
        globals()["database_snapshot_state"] = original_database_snapshot_state
    if not interposed_database_rejected:
        raise StudyError("database interposition after hash verification was accepted")

    fallback_facts = fixture_facts([120, 115, 115, 115, 100, 100, 100, 100, 100, 100], [10, 10, 10, 10, 10])
    fallback_facts[revenue_concept] = fallback_facts.pop("Revenue")
    fallback_facts[ocf_concept] = fallback_facts.pop("OCF")
    for concept, by_qtrs in fallback_facts.items():
        for by_date in by_qtrs.values():
            for fact in by_date.values():
                if not fact.get("ambiguous"):
                    fact["concept"] = concept
    fallback_facts[ocf_concept][2].pop(20140630)
    fallback = classify_entity(entity, fallback_facts)
    if fallback.get("status") != "ELIGIBLE" or fallback.get("anchorPeriodEnd") != "20140331":
        raise StudyError("latest fully computable fallback anchor was not selected")

    source_line, source_line_bytes = load_json_snapshot(SOURCE_LINE_PATH)
    source_claimed = validate_source_line(source_line)
    database_attestation, database_attestation_bytes = load_json_snapshot(DATABASE_ATTESTATION_PATH)
    database_attestation_claimed = validate_database_attestation(database_attestation, database_attestation_bytes)
    sample = {
        "schema": EXPOSURE_SCHEMA,
        "protocol": PROTOCOL,
        "status": "PREOUTCOME_EXPOSURE_ONLY",
        "commonObservationCutoff": CUTOFF,
        "scopeNormalizedTextSha256": normalized_text_sha256(SCOPE_PATH),
        "claimContractCanonicalSha256": canonical_sha256(load_json(CONTRACT_PATH)),
        "conceptMapCanonicalSha256": CONCEPT_MAP_CANONICAL_SHA256,
        "databaseAttestationFileSha256": sha256_bytes(database_attestation_bytes),
        "databaseAttestationCanonicalSha256": database_attestation_claimed,
        "sourceLineFileSha256": sha256_bytes(source_line_bytes),
        "sourceLineCanonicalSha256": source_claimed,
        "precutoffPayloads": [row for row in source_line["payloads"] if row["quarter"] <= CUTOFF_QUARTER],
        "counts": {"candidateCiks": 1, "eligibleCiks": 1, "excludedCiks": 0,
                   "exposures": {"TRIGGER_POSITIVE": 1}, "exclusions": {}},
        "rows": [positive],
        "claimLocks": CLAIM_LOCKS,
        "outcomesAccessed": False,
        "postAnchorFactsRead": False,
        "postAnchorFactsMaterialized": False,
        "analysisExecuted": False,
    }
    sample["reportSha256"] = canonical_sha256(sample)
    with tempfile.TemporaryDirectory() as temporary:
        path = Path(temporary) / "exposure.json"
        path.write_text(json.dumps(sample), encoding="utf-8")
        _, verified = verify_exposure_contract(path)
        metric_mutation = json.loads(json.dumps(sample))
        metric_mutation["rows"][0]["currentRevenueYoy"] = "999"
        metric_mutation["reportSha256"] = unsigned_canonical_sha256(metric_mutation, "reportSha256")
        path.write_text(json.dumps(metric_mutation), encoding="utf-8")
        try:
            verify_exposure_contract(path)
        except StudyError:
            metric_mutation_rejected = True
        else:
            metric_mutation_rejected = False
        empty = dict(sample)
        empty["rows"] = []
        empty["counts"] = {"candidateCiks": 0, "eligibleCiks": 0, "excludedCiks": 0, "exposures": {}, "exclusions": {}}
        empty["reportSha256"] = unsigned_canonical_sha256(empty, "reportSha256")
        path.write_text(json.dumps(empty), encoding="utf-8")
        try:
            verify_exposure_contract(path)
        except StudyError:
            empty_rejected = True
        else:
            empty_rejected = False
        sample["outcomesAccessed"] = True
        sample["reportSha256"] = unsigned_canonical_sha256(sample, "reportSha256")
        path.write_text(json.dumps(sample), encoding="utf-8")
        try:
            verify_exposure_contract(path)
        except StudyError:
            outcome_injection_rejected = True
        else:
            outcome_injection_rejected = False
    if not outcome_injection_rejected:
        raise StudyError("outcome-lock mutation was accepted")
    if not empty_rejected:
        raise StudyError("empty exposure artifact was accepted")
    if not metric_mutation_rejected:
        raise StudyError("rehashed metric mutation was accepted")
    return {
        "status": "PASS",
        "positiveFixture": positive["exposure"],
        "exactThresholdsPreserved": True,
        "zeroOcfRejected": True,
        "ambiguousDuplicateRejected": True,
        "crossFiscalYearRejected": True,
        "conceptPriorityFailClosed": True,
        "crossDerivationConceptPriorityPreserved": True,
        "conflictingOcfDerivationsRejected": True,
        "revenueCrossDerivationPriorityPreserved": True,
        "laterRevisionConflictRejected": True,
        "tamperedDatabaseRejected": tampered_database_rejected,
        "interposedDatabaseRejected": interposed_database_rejected,
        "fallbackAnchorSelected": fallback["anchorPeriodEnd"],
        "postCutoffFixtureQuarantined": post_cutoff_rejected,
        "outcomeInjectionRejected": True,
        "emptyExposureRejected": empty_rejected,
        "rehashedMetricMutationRejected": metric_mutation_rejected,
        "validExposureVerified": verified["status"],
    }


def write_new(path: Path, value: dict[str, Any]) -> None:
    resolved = path.expanduser().resolve()
    resolved.parent.mkdir(parents=True, exist_ok=True)
    if resolved.exists():
        raise StudyError(f"refusing to overwrite: {resolved}")
    with resolved.open("x", encoding="utf-8", newline="\n") as handle:
        json.dump(value, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write("\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    source = sub.add_parser("source-line")
    source.add_argument("--integrity-report", required=True, type=Path)
    source.add_argument("--output", required=True, type=Path)
    database_attestation = sub.add_parser("database-attestation")
    database_attestation.add_argument("--database", required=True, type=Path)
    database_attestation.add_argument("--output", required=True, type=Path)
    exposure = sub.add_parser("exposure")
    exposure.add_argument("--database", required=True, type=Path)
    exposure.add_argument("--source-line", required=True, type=Path)
    exposure.add_argument("--output", required=True, type=Path)
    verify = sub.add_parser("verify-exposure")
    verify.add_argument("--input", required=True, type=Path)
    verify.add_argument("--database", required=True, type=Path)
    sub.add_parser("self-test")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.command == "self-test":
        print(json.dumps(self_test(), indent=2))
    elif args.command == "source-line":
        write_new(args.output, build_source_line(args.integrity_report))
        print(json.dumps({"status": "PASS", "output": str(args.output.resolve())}))
    elif args.command == "database-attestation":
        write_new(args.output, build_database_attestation(args.database))
        print(json.dumps({"status": "PASS", "output": str(args.output.resolve())}))
    elif args.command == "exposure":
        write_new(args.output, build_exposure(args.database, args.source_line))
        print(json.dumps({"status": "PASS", "output": str(args.output.resolve())}))
    elif args.command == "verify-exposure":
        print(json.dumps(verify_exposure(args.input, args.database), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
