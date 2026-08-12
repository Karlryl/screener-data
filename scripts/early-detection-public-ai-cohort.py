#!/usr/bin/env python3
"""Select a sealed, coverage-only public-data cohort without reading outcomes.

Production selection is fail-closed until a pre-outcome seal binds the scope,
this selector, and the exact row manifest. The output is coverage accounting;
it is never an Original-V4, full-market, survivorship-safe, H-LATE, or H-FEM
result.
"""

from __future__ import annotations

import argparse
import bisect
import copy
import hashlib
import json
import math
import re
import sqlite3
import subprocess
import tempfile
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any


LOADED_SELECTOR_SHA256 = hashlib.sha256(Path(__file__).resolve().read_bytes()).hexdigest()
INPUT_SCHEMA = "early-detection-public-ai-row-manifest/v1"
SEAL_SCHEMA = "early-detection-public-ai-selector-seal/v1"
OUTPUT_SCHEMA = "early-detection-public-ai-cohort-selection/v1"
OUTCOME_LEDGER_SCHEMA = "early-detection-public-ai-outcome-ledger/v1"
AUTHORIZATION_SCHEMA = "early-detection-public-ai-remote-authorization/v1"
AI_AUDIT_SCHEMA = "early-detection-public-ai-adversarial-audit/v1"
PROTOCOL_LABEL = "FEM-SEC-US-PUBLIC-AI"
SCOPE_SHA256 = "6b3a0dad926be833eae050354fb08a887362395cfe20e158f6e1e2d51f86520d"
IDENTITY_EVIDENCE_SCHEMA = "early-detection-public-ai-identity-evidence/v1"
V94_CORPUS_SHA256 = "7a6aa70f539ef7d9b5ce714bb09ff0acf81bdf5beb4de3b222d784902de28792"
AUTHORIZATION_REMOTE_URL = "https://github.com/Karlryl/screener-data.git"
AUTHORIZATION_REF = "refs/heads/codex/early-detection-v4-gates-20260810"

TOP_LEVEL_KEYS = {
    "schema",
    "createdAt",
    "sourceInventorySha256",
    "identityEvidenceSha256",
    "outcomesAccessed",
    "containsOutcomeFields",
    "rows",
}
ROW_KEYS = {
    "rowId",
    "dataset",
    "observedAt",
    "ticker",
    "candidateStatus",
    "archivedSnapshotObserved",
    "priceFilePresent",
    "priceFileValid",
    "priceFileTicker",
    "priceFileSha256",
    "priorBarCount",
    "identitySynthetic",
    "identityConflictTypes",
    "laterCorporateActionFactorKnown",
    "identityAdjudication",
    "corporateActionAdjustmentStatus",
    "identityEvidenceRefs",
    "corporateActionEvidenceRefs",
    "identityEvidenceBasis",
    "corporateActionEvidenceBasis",
    "identityClaimBindingSha256",
    "corporateActionClaimBindingSha256",
}
SEAL_KEYS = {
    "schema",
    "protocolLabel",
    "protocolStatus",
    "scopeSha256",
    "selectorSha256",
    "inputManifestSha256",
    "sealedAt",
    "outcomesAccessed",
    "resultComputationAllowed",
    "productiveGqsModified",
}
AUTHORIZATION_KEYS = {
    "schema",
    "protocolLabel",
    "createdAt",
    "authorizationCommit",
    "authorizationRemote",
    "authorizationRef",
    "authorizedArtifacts",
    "outcomesAccessed",
    "resultComputationAllowed",
    "productiveGqsModified",
}
AUTHORIZED_ARTIFACT_KEYS = {"role", "path", "sha256"}
AUTHORIZED_ARTIFACT_ROLES = {
    "SCOPE",
    "SEAL",
    "SELECTOR",
    "INPUT_MANIFEST",
    "IDENTITY_EVIDENCE",
    "OUTCOME_LEDGER",
    "AI_AUDIT_METHOD",
    "AI_AUDIT_DATA",
    "AI_AUDIT_COUNTEREXAMPLE",
}
AI_AUDIT_KEYS = {
    "schema",
    "auditType",
    "status",
    "agentId",
    "runId",
    "completedAt",
    "reviewerType",
    "humanAttestation",
    "outcomesAccessed",
    "scopeSha256",
    "selectorSha256",
    "inputManifestSha256",
    "sourceInventorySha256",
    "identityEvidenceSha256",
    "blockingFindings",
    "rowReviews",
}
AI_AUDIT_TYPES = {"METHOD", "DATA", "COUNTEREXAMPLE"}
AI_AUDIT_ROW_KEYS = {
    "rowId",
    "identityEvidenceRefs",
    "corporateActionEvidenceRefs",
    "identitySemanticVerdict",
    "corporateActionSemanticVerdict",
}
OUTCOME_LEDGER_KEYS = {
    "schema",
    "protocolLabel",
    "lastUpdated",
    "originalV4OutcomesAccessed",
    "publicAiOutcomesAccessed",
    "resultComputationAllowed",
    "productiveGqsModified",
    "events",
}
IDENTITY_EVIDENCE_KEYS = {"schema", "createdAt", "sourceCorpusSha256", "outcomesAccessed", "rows"}
IDENTITY_EVIDENCE_ROW_KEYS = {
    "rowId",
    "identitySynthetic",
    "identityConflictTypes",
    "laterCorporateActionFactorKnown",
    "identityAdjudication",
    "corporateActionAdjustmentStatus",
    "identityEvidenceRefs",
    "corporateActionEvidenceRefs",
    "identityEvidenceBasis",
    "corporateActionEvidenceBasis",
    "identityClaimBindingSha256",
    "corporateActionClaimBindingSha256",
}
EVIDENCE_REF_KEYS = {"sourceId", "payloadSha256"}
DATASETS = {"nasdaqlisted", "otherlisted"}
CANDIDATE_STATUSES = {"CANDIDATE_UNADJUDICATED", "AMBIGUOUS"}
IDENTITY_CONFLICTS = {"TICKER_REUSE", "MULTI_CIK", "MULTI_SYMBOL", "SHARE_CLASS", "SUCCESSOR"}
IDENTITY_ADJUDICATIONS = {"CLEAR", "CONFLICT", "UNRESOLVED"}
CORPORATE_ACTION_STATUSES = {"NO_LATER_FACTOR", "LATER_FACTOR", "UNRESOLVED"}
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
TICKER_RE = re.compile(r"^[A-Z0-9.^-]{1,20}$")
IDENTITY_EVIDENCE_BASES = {
    "POINT_IN_TIME_IDENTITY_MATCH",
    "CONFLICT_EVIDENCE",
    "UNRESOLVED",
}
CORPORATE_ACTION_EVIDENCE_BASES = {
    "NO_LATER_FACTOR_IN_BOUND_EVIDENCE",
    "LATER_FACTOR_EVIDENCE",
    "UNRESOLVED",
}


class PublicAiCohortError(RuntimeError):
    """The public-data cohort selector failed closed."""


def canonical_sha256(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise PublicAiCohortError(f"invalid JSON: {path}") from exc


def read_bound_json(path: Path) -> tuple[bytes, Any]:
    """Read and parse one immutable byte snapshot of a bound JSON artifact."""
    try:
        raw = path.read_bytes()
        return raw, json.loads(raw.decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise PublicAiCohortError(f"invalid JSON: {path}") from exc


def require_exact_keys(value: dict[str, Any], expected: set[str], label: str) -> None:
    actual = set(value)
    if actual != expected:
        raise PublicAiCohortError(
            f"{label} keys changed: missing={sorted(expected - actual)} extra={sorted(actual - expected)}"
        )


def require_bool(value: Any, label: str) -> bool:
    if type(value) is not bool:
        raise PublicAiCohortError(f"{label} must be boolean")
    return value


def require_sha256(value: Any, label: str) -> str:
    if not isinstance(value, str) or SHA256_RE.fullmatch(value) is None:
        raise PublicAiCohortError(f"{label} must be lowercase SHA-256")
    return value


def validate_evidence_refs(value: Any, label: str) -> list[dict[str, str]]:
    if not isinstance(value, list):
        raise PublicAiCohortError(f"{label} must be a list")
    refs: list[dict[str, str]] = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise PublicAiCohortError(f"{label} {index} must be an object")
        require_exact_keys(item, EVIDENCE_REF_KEYS, f"{label} {index}")
        if not isinstance(item["sourceId"], str) or not item["sourceId"].strip():
            raise PublicAiCohortError(f"{label} {index} sourceId missing")
        require_sha256(item["payloadSha256"], f"{label} {index} payloadSha256")
        refs.append(item)
    if refs != sorted(refs, key=lambda item: (item["sourceId"], item["payloadSha256"])):
        raise PublicAiCohortError(f"{label} must be sorted")
    if len({(item["sourceId"], item["payloadSha256"]) for item in refs}) != len(refs):
        raise PublicAiCohortError(f"{label} must be unique")
    return refs


def parse_utc_timestamp(value: Any, label: str) -> datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise PublicAiCohortError(f"{label} must be an ISO-8601 UTC timestamp")
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as exc:
        raise PublicAiCohortError(f"{label} is not a valid timestamp") from exc
    return parsed


def parse_observed_at(value: Any, label: str) -> str:
    parsed = parse_utc_timestamp(value, label)
    if not (2009 <= parsed.year <= 2014):
        raise PublicAiCohortError(f"{label} is outside the frozen 2009-2014 boundary")
    return value


def expected_row_id(row: dict[str, Any]) -> str:
    return canonical_sha256({
        "dataset": row["dataset"],
        "observedAt": row["observedAt"],
        "ticker": row["ticker"],
    })


def expected_claim_binding(row: dict[str, Any], kind: str) -> str:
    if kind == "identity":
        payload = {
            "rowId": row["rowId"],
            "adjudication": row["identityAdjudication"],
            "basis": row["identityEvidenceBasis"],
            "refs": row["identityEvidenceRefs"],
        }
    elif kind == "corporateAction":
        payload = {
            "rowId": row["rowId"],
            "adjustmentStatus": row["corporateActionAdjustmentStatus"],
            "basis": row["corporateActionEvidenceBasis"],
            "refs": row["corporateActionEvidenceRefs"],
        }
    else:
        raise PublicAiCohortError("unknown claim binding kind")
    return canonical_sha256(payload)


def validate_row(row: Any, index: int) -> dict[str, Any]:
    if not isinstance(row, dict):
        raise PublicAiCohortError(f"row {index} must be an object")
    require_exact_keys(row, ROW_KEYS, f"row {index}")
    if row["dataset"] not in DATASETS:
        raise PublicAiCohortError(f"row {index} dataset is not allowed")
    parse_observed_at(row["observedAt"], f"row {index} observedAt")
    if not isinstance(row["ticker"], str) or TICKER_RE.fullmatch(row["ticker"]) is None:
        raise PublicAiCohortError(f"row {index} ticker is invalid")
    if row["rowId"] != expected_row_id(row):
        raise PublicAiCohortError(f"row {index} rowId is not the deterministic source-key hash")
    if row["candidateStatus"] not in CANDIDATE_STATUSES:
        raise PublicAiCohortError(f"row {index} candidateStatus is not allowed")
    for key in (
        "archivedSnapshotObserved",
        "priceFilePresent",
        "priceFileValid",
        "identitySynthetic",
        "laterCorporateActionFactorKnown",
    ):
        require_bool(row[key], f"row {index} {key}")
    if not isinstance(row["priorBarCount"], int) or isinstance(row["priorBarCount"], bool) or row["priorBarCount"] < 0:
        raise PublicAiCohortError(f"row {index} priorBarCount must be a non-negative integer")
    price_ticker = row["priceFileTicker"]
    price_sha = row["priceFileSha256"]
    if row["priceFilePresent"]:
        if not isinstance(price_ticker, str) or TICKER_RE.fullmatch(price_ticker) is None:
            raise PublicAiCohortError(f"row {index} present price file needs a valid ticker")
        require_sha256(price_sha, f"row {index} priceFileSha256")
    elif price_ticker is not None or price_sha is not None or row["priceFileValid"]:
        raise PublicAiCohortError(f"row {index} missing price file has contradictory metadata")
    conflicts = row["identityConflictTypes"]
    if not isinstance(conflicts, list) or any(item not in IDENTITY_CONFLICTS for item in conflicts):
        raise PublicAiCohortError(f"row {index} identityConflictTypes changed")
    if conflicts != sorted(set(conflicts)):
        raise PublicAiCohortError(f"row {index} identityConflictTypes must be sorted and unique")
    if row["identityAdjudication"] not in IDENTITY_ADJUDICATIONS:
        raise PublicAiCohortError(f"row {index} identityAdjudication changed")
    if row["corporateActionAdjustmentStatus"] not in CORPORATE_ACTION_STATUSES:
        raise PublicAiCohortError(f"row {index} corporateActionAdjustmentStatus changed")
    identity_refs = validate_evidence_refs(row["identityEvidenceRefs"], f"row {index} identityEvidenceRefs")
    corporate_action_refs = validate_evidence_refs(
        row["corporateActionEvidenceRefs"],
        f"row {index} corporateActionEvidenceRefs",
    )
    if row["identityAdjudication"] != "UNRESOLVED" and not identity_refs:
        raise PublicAiCohortError(f"row {index} resolved identity lacks evidence refs")
    if row["corporateActionAdjustmentStatus"] != "UNRESOLVED" and not corporate_action_refs:
        raise PublicAiCohortError(f"row {index} resolved corporate-action status lacks evidence refs")
    if row["identityEvidenceBasis"] not in IDENTITY_EVIDENCE_BASES:
        raise PublicAiCohortError(f"row {index} identity evidence basis changed")
    if row["corporateActionEvidenceBasis"] not in CORPORATE_ACTION_EVIDENCE_BASES:
        raise PublicAiCohortError(f"row {index} corporate-action evidence basis changed")
    if row["identityClaimBindingSha256"] != expected_claim_binding(row, "identity"):
        raise PublicAiCohortError(f"row {index} identity claim binding mismatch")
    if row["corporateActionClaimBindingSha256"] != expected_claim_binding(row, "corporateAction"):
        raise PublicAiCohortError(f"row {index} corporate-action claim binding mismatch")
    if row["identityAdjudication"] == "CLEAR" and (conflicts or row["identitySynthetic"]):
        raise PublicAiCohortError(f"row {index} clear identity contradicts conflict metadata")
    if row["identityAdjudication"] == "CONFLICT" and not conflicts:
        raise PublicAiCohortError(f"row {index} conflict identity has no conflict type")
    expected_identity_basis = {
        "CLEAR": "POINT_IN_TIME_IDENTITY_MATCH",
        "CONFLICT": "CONFLICT_EVIDENCE",
        "UNRESOLVED": "UNRESOLVED",
    }[row["identityAdjudication"]]
    if row["identityEvidenceBasis"] != expected_identity_basis:
        raise PublicAiCohortError(f"row {index} identity evidence basis contradicts adjudication")
    if row["corporateActionAdjustmentStatus"] == "NO_LATER_FACTOR" and row["laterCorporateActionFactorKnown"]:
        raise PublicAiCohortError(f"row {index} no-later-factor status contradicts factor flag")
    if row["corporateActionAdjustmentStatus"] == "LATER_FACTOR" and not row["laterCorporateActionFactorKnown"]:
        raise PublicAiCohortError(f"row {index} later-factor status lacks factor flag")
    expected_action_basis = {
        "NO_LATER_FACTOR": "NO_LATER_FACTOR_IN_BOUND_EVIDENCE",
        "LATER_FACTOR": "LATER_FACTOR_EVIDENCE",
        "UNRESOLVED": "UNRESOLVED",
    }[row["corporateActionAdjustmentStatus"]]
    if row["corporateActionEvidenceBasis"] != expected_action_basis:
        raise PublicAiCohortError(f"row {index} corporate-action evidence basis contradicts status")
    return row


def validate_manifest(manifest: Any) -> list[dict[str, Any]]:
    if not isinstance(manifest, dict):
        raise PublicAiCohortError("input manifest must be an object")
    require_exact_keys(manifest, TOP_LEVEL_KEYS, "input manifest")
    if manifest["schema"] != INPUT_SCHEMA:
        raise PublicAiCohortError("unexpected input manifest schema")
    parse_utc_timestamp(manifest["createdAt"], "createdAt")
    require_sha256(manifest["sourceInventorySha256"], "sourceInventorySha256")
    require_sha256(manifest["identityEvidenceSha256"], "identityEvidenceSha256")
    if require_bool(manifest["outcomesAccessed"], "outcomesAccessed"):
        raise PublicAiCohortError("outcomesAccessed must remain false")
    if require_bool(manifest["containsOutcomeFields"], "containsOutcomeFields"):
        raise PublicAiCohortError("outcome fields are forbidden")
    if not isinstance(manifest["rows"], list):
        raise PublicAiCohortError("rows must be a list")
    rows = [validate_row(row, index) for index, row in enumerate(manifest["rows"])]
    row_ids = [row["rowId"] for row in rows]
    if len(row_ids) != len(set(row_ids)):
        raise PublicAiCohortError("duplicate rowId")
    return rows


def parse_price_dates(value: Any, path: Path) -> list[str]:
    if not isinstance(value, list) or not value:
        raise PublicAiCohortError(f"empty price history: {path}")
    dates: list[str] = []
    for index, row in enumerate(value):
        if not isinstance(row, dict) or set(row) != {"date", "close"}:
            raise PublicAiCohortError(f"price schema changed: {path}:{index}")
        try:
            parsed = date.fromisoformat(str(row["date"]))
            close = float(row["close"])
        except (TypeError, ValueError) as exc:
            raise PublicAiCohortError(f"invalid price row: {path}:{index}") from exc
        if not math.isfinite(close) or close <= 0:
            raise PublicAiCohortError(f"non-positive price: {path}:{index}")
        dates.append(parsed.isoformat())
    if dates != sorted(dates) or len(dates) != len(set(dates)):
        raise PublicAiCohortError(f"price dates are not strictly increasing: {path}")
    return dates


def validate_identity_evidence(
    evidence: Any,
    rows: list[dict[str, Any]],
    expected_source_corpus_sha256: str,
    research_corpus: Any,
) -> None:
    if not isinstance(evidence, dict):
        raise PublicAiCohortError("identity evidence must be an object")
    require_exact_keys(evidence, IDENTITY_EVIDENCE_KEYS, "identity evidence")
    if evidence["schema"] != IDENTITY_EVIDENCE_SCHEMA:
        raise PublicAiCohortError("unexpected identity evidence schema")
    parse_utc_timestamp(evidence["createdAt"], "identity evidence createdAt")
    if evidence["sourceCorpusSha256"] != expected_source_corpus_sha256:
        raise PublicAiCohortError("identity evidence is not bound to research corpus V94")
    if require_bool(evidence["outcomesAccessed"], "identity evidence outcomesAccessed"):
        raise PublicAiCohortError("identity evidence reports outcome access")
    if not isinstance(research_corpus, dict) or not isinstance(research_corpus.get("evidence"), list):
        raise PublicAiCohortError("research corpus evidence index missing")
    if research_corpus.get("outcomesAccessed") is not False or research_corpus.get("productiveGqsModified") is not False:
        raise PublicAiCohortError("research corpus outcome lock is not closed")
    corpus_refs: set[tuple[str, str]] = set()
    for index, item in enumerate(research_corpus["evidence"]):
        if not isinstance(item, dict):
            raise PublicAiCohortError(f"research corpus evidence {index} must be an object")
        source_id = item.get("sourceId")
        payload_sha256 = item.get("payloadSha256")
        if not isinstance(source_id, str) or not isinstance(payload_sha256, str):
            raise PublicAiCohortError(f"research corpus evidence {index} lacks source binding")
        require_sha256(payload_sha256, f"research corpus evidence {index} payloadSha256")
        corpus_refs.add((source_id, payload_sha256))
    if not isinstance(evidence["rows"], list):
        raise PublicAiCohortError("identity evidence rows must be a list")
    expected = {
        row["rowId"]: {key: row[key] for key in IDENTITY_EVIDENCE_ROW_KEYS}
        for row in rows
    }
    actual: dict[str, dict[str, Any]] = {}
    for index, item in enumerate(evidence["rows"]):
        if not isinstance(item, dict):
            raise PublicAiCohortError(f"identity evidence row {index} must be an object")
        require_exact_keys(item, IDENTITY_EVIDENCE_ROW_KEYS, f"identity evidence row {index}")
        row_id = item["rowId"]
        if not isinstance(row_id, str) or row_id in actual:
            raise PublicAiCohortError("identity evidence rowId missing or duplicated")
        for refs_key in ("identityEvidenceRefs", "corporateActionEvidenceRefs"):
            refs = validate_evidence_refs(item[refs_key], f"identity evidence row {index} {refs_key}")
            for ref in refs:
                if (ref["sourceId"], ref["payloadSha256"]) not in corpus_refs:
                    raise PublicAiCohortError(f"identity evidence row {index} has an unbound corpus reference")
        actual[row_id] = item
    if actual != expected:
        raise PublicAiCohortError("identity evidence does not exactly bind every cohort row")


def verify_bound_sources(
    manifest: dict[str, Any],
    rows: list[dict[str, Any]],
    source_inventory: Path,
    prices_directory: Path,
    identity_evidence_path: Path,
    research_corpus_path: Path,
    expected_research_corpus_sha256: str = V94_CORPUS_SHA256,
) -> None:
    if (
        not source_inventory.is_file()
        or not prices_directory.is_dir()
        or not identity_evidence_path.is_file()
        or not research_corpus_path.is_file()
    ):
        raise PublicAiCohortError("bound source inventory, prices, identity evidence or research corpus missing")
    inventory_sidecars = [
        Path(f"{source_inventory}-wal"),
        Path(f"{source_inventory}-shm"),
        Path(f"{source_inventory}-journal"),
    ]
    if any(path.exists() for path in inventory_sidecars):
        raise PublicAiCohortError("source inventory has unbound SQLite sidecars")
    inventory_sha256 = sha256_file(source_inventory)
    if inventory_sha256 != manifest["sourceInventorySha256"]:
        raise PublicAiCohortError("source inventory hash mismatch")
    identity_evidence_bytes, identity_evidence = read_bound_json(identity_evidence_path)
    if hashlib.sha256(identity_evidence_bytes).hexdigest() != manifest["identityEvidenceSha256"]:
        raise PublicAiCohortError("identity evidence hash mismatch")
    research_corpus_bytes, research_corpus = read_bound_json(research_corpus_path)
    if hashlib.sha256(research_corpus_bytes).hexdigest() != expected_research_corpus_sha256:
        raise PublicAiCohortError("research corpus hash mismatch")
    validate_identity_evidence(
        identity_evidence,
        rows,
        expected_research_corpus_sha256,
        research_corpus,
    )

    connection = sqlite3.connect(f"file:{source_inventory.as_posix()}?mode=ro&immutable=1", uri=True)
    try:
        schema = connection.execute("SELECT value FROM meta WHERE key='schema'").fetchone()
        if schema is None or schema[0] != "early-detection-entity-bridge/v2":
            raise PublicAiCohortError("unexpected source inventory schema")
        actual_rows = connection.execute(
            """SELECT s.dataset,s.observed_at,c.ticker,c.status
               FROM candidates c JOIN snapshots s USING(snapshot_id)
               WHERE c.status IN ('CANDIDATE_UNADJUDICATED','AMBIGUOUS')
               ORDER BY s.observed_at,s.dataset,c.ticker,c.status"""
        ).fetchall()
    finally:
        connection.close()
    if any(path.exists() for path in inventory_sidecars) or sha256_file(source_inventory) != inventory_sha256:
        raise PublicAiCohortError("source inventory changed during verification")
    expected_rows = sorted(
        (row["dataset"], row["observedAt"], row["ticker"], row["candidateStatus"])
        for row in rows
    )
    if sorted(actual_rows) != expected_rows:
        raise PublicAiCohortError("input rows are not the complete bound source inventory")
    if any(row["archivedSnapshotObserved"] is not True for row in rows):
        raise PublicAiCohortError("bound inventory rows must be marked as archived observations")

    for index, row in enumerate(rows):
        if not row["priceFilePresent"]:
            if (prices_directory / f"{row['ticker']}.json").is_file() or row["priorBarCount"] != 0:
                raise PublicAiCohortError(f"row {index} missing price claim contradicts the bound store")
            continue
        path = prices_directory / f"{row['priceFileTicker']}.json"
        if not path.is_file():
            raise PublicAiCohortError(f"row {index} price file hash mismatch")
        price_bytes, price_rows = read_bound_json(path)
        if hashlib.sha256(price_bytes).hexdigest() != row["priceFileSha256"]:
            raise PublicAiCohortError(f"row {index} price file hash mismatch")
        try:
            dates = parse_price_dates(price_rows, path)
        except PublicAiCohortError:
            if row["priceFileValid"] or row["priorBarCount"] != 0:
                raise PublicAiCohortError(f"row {index} invalid price file metadata mismatch")
            continue
        if not row["priceFileValid"]:
            raise PublicAiCohortError(f"row {index} valid price file was labelled invalid")
        prior = bisect.bisect_left(dates, row["observedAt"][:10])
        if prior != row["priorBarCount"]:
            raise PublicAiCohortError(f"row {index} priorBarCount mismatch")


def rejection_reasons(row: dict[str, Any]) -> list[str]:
    reasons: list[str] = []
    if not row["archivedSnapshotObserved"]:
        reasons.append("SNAPSHOT_NOT_OBSERVED")
    if row["candidateStatus"] == "AMBIGUOUS":
        reasons.append("CANDIDATE_STATUS_AMBIGUOUS")
    if not row["priceFilePresent"]:
        reasons.append("PRICE_FILE_MISSING")
    elif not row["priceFileValid"]:
        reasons.append("PRICE_FILE_INVALID")
    elif row["priceFileTicker"] != row["ticker"]:
        reasons.append("PRICE_TICKER_NOT_EXACT")
    if row["priorBarCount"] < 252:
        reasons.append("INSUFFICIENT_PRIOR_BARS")
    if row["identitySynthetic"]:
        reasons.append("IDENTITY_SYNTHETIC")
    if row["identityAdjudication"] == "UNRESOLVED":
        reasons.append("IDENTITY_UNRESOLVED")
    reasons.extend(f"IDENTITY_CONFLICT_{item}" for item in row["identityConflictTypes"])
    if row["laterCorporateActionFactorKnown"]:
        reasons.append("LATER_CORPORATE_ACTION_FACTOR")
    if row["corporateActionAdjustmentStatus"] == "UNRESOLVED":
        reasons.append("CORPORATE_ACTION_FACTOR_UNRESOLVED")
    return sorted(reasons)


def production_claim_locks() -> dict[str, Any]:
    return {
        "protocolLabel": PROTOCOL_LABEL,
        "status": "COVERAGE_ONLY_NOT_ORIGINAL_V4",
        "confirmatoryEligible": False,
        "survivorshipSafe": False,
        "humanAttestation": False,
        "aiAuditOnly": True,
        "outcomesAccessed": False,
        "resultComputationAllowed": False,
        "productiveGqsModified": False,
    }


def select_manifest(manifest: dict[str, Any]) -> dict[str, Any]:
    rows = validate_manifest(manifest)
    selected = []
    reason_counts: Counter[str] = Counter()
    for row in sorted(rows, key=lambda item: item["rowId"]):
        reasons = rejection_reasons(row)
        reason_counts.update(reasons)
        selected.append({"rowId": row["rowId"], "eligible": not reasons, "rejectionReasons": reasons})
    eligible = sum(1 for row in selected if row["eligible"])
    unsigned = {
        "schema": OUTPUT_SCHEMA,
        "protocolLabel": PROTOCOL_LABEL,
        "status": "UNSEALED_INTERNAL_SELECTION_ONLY",
        "sourceInventorySha256": manifest["sourceInventorySha256"],
        "identityEvidenceSha256": manifest["identityEvidenceSha256"],
        "inputManifestCanonicalSha256": canonical_sha256(manifest),
        "rows": selected,
        "counts": {"inputRows": len(selected), "eligibleRows": eligible, "rejectedRows": len(selected) - eligible},
        "rejectionReasonCounts": dict(sorted(reason_counts.items())),
        "confirmatoryEligible": False,
        "survivorshipSafe": False,
        "humanAttestation": False,
        "aiAuditOnly": True,
        "outcomesAccessed": False,
        "resultComputationAllowed": False,
        "productiveGqsModified": False,
    }
    return {**unsigned, "reportSha256": canonical_sha256(unsigned)}


def verify_seal(
    seal: Any,
    input_sha256: str,
    selector_sha256: str,
    scope_sha256: str,
    manifest_created_at: str,
) -> None:
    if not isinstance(seal, dict):
        raise PublicAiCohortError("seal manifest must be an object")
    require_exact_keys(seal, SEAL_KEYS, "seal manifest")
    if seal["schema"] != SEAL_SCHEMA or seal["protocolLabel"] != PROTOCOL_LABEL:
        raise PublicAiCohortError("seal identity mismatch")
    if seal["protocolStatus"] != "SEALED_PRE_OUTCOME":
        raise PublicAiCohortError("selector is not sealed pre-outcome")
    if scope_sha256 != SCOPE_SHA256 or seal["scopeSha256"] != scope_sha256:
        raise PublicAiCohortError("scope hash mismatch")
    if seal["selectorSha256"] != selector_sha256:
        raise PublicAiCohortError("selector hash mismatch")
    if seal["inputManifestSha256"] != input_sha256:
        raise PublicAiCohortError("input manifest hash mismatch")
    sealed_at = parse_utc_timestamp(seal["sealedAt"], "sealedAt")
    if sealed_at < parse_utc_timestamp(manifest_created_at, "createdAt"):
        raise PublicAiCohortError("seal predates its input manifest")
    if sealed_at > datetime.now(timezone.utc) + timedelta(minutes=5):
        raise PublicAiCohortError("seal timestamp is in the future")
    if require_bool(seal["outcomesAccessed"], "seal outcomesAccessed"):
        raise PublicAiCohortError("seal reports outcome access")
    if require_bool(seal["resultComputationAllowed"], "seal resultComputationAllowed"):
        raise PublicAiCohortError("seal cannot unlock result computation")
    if require_bool(seal["productiveGqsModified"], "seal productiveGqsModified"):
        raise PublicAiCohortError("seal cannot modify productive GQS")


def run_git(repository: Path, arguments: list[str], *, binary: bool = False) -> bytes | str:
    completed = subprocess.run(
        ["git", "-C", str(repository), *arguments],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=not binary,
    )
    if completed.returncode != 0:
        stderr = completed.stderr.decode("utf-8", errors="replace") if binary else completed.stderr
        raise PublicAiCohortError(f"git verification failed: {' '.join(arguments)}: {stderr.strip()}")
    return completed.stdout


def validate_outcome_ledger(value: Any) -> None:
    if not isinstance(value, dict):
        raise PublicAiCohortError("outcome ledger must be an object")
    require_exact_keys(value, OUTCOME_LEDGER_KEYS, "outcome ledger")
    if value["schema"] != OUTCOME_LEDGER_SCHEMA or value["protocolLabel"] != PROTOCOL_LABEL:
        raise PublicAiCohortError("outcome ledger identity mismatch")
    parse_utc_timestamp(value["lastUpdated"], "outcome ledger lastUpdated")
    for key in (
        "originalV4OutcomesAccessed",
        "publicAiOutcomesAccessed",
        "resultComputationAllowed",
        "productiveGqsModified",
    ):
        if require_bool(value[key], f"outcome ledger {key}"):
            raise PublicAiCohortError(f"outcome ledger unlocks {key}")
    if value["events"] != []:
        raise PublicAiCohortError("pre-outcome ledger must contain no events")


def validate_ai_audits(
    paths: dict[str, Path],
    expected_hashes: dict[str, str],
    rows: list[dict[str, Any]],
) -> dict[str, str]:
    expected_roles = {
        "AI_AUDIT_METHOD": "METHOD",
        "AI_AUDIT_DATA": "DATA",
        "AI_AUDIT_COUNTEREXAMPLE": "COUNTEREXAMPLE",
    }
    if set(paths) != set(expected_roles):
        raise PublicAiCohortError("AI audit role set is incomplete")
    artifact_hashes: dict[str, str] = {}
    agent_ids: set[str] = set()
    run_ids: set[str] = set()
    resolved_paths: set[Path] = set()
    expected_reviews = []
    for row in sorted(rows, key=lambda item: item["rowId"]):
        expected_reviews.append({
            "rowId": row["rowId"],
            "identityEvidenceRefs": row["identityEvidenceRefs"],
            "corporateActionEvidenceRefs": row["corporateActionEvidenceRefs"],
            "identitySemanticVerdict": {
                "CLEAR": "IDENTITY_SUPPORTED",
                "CONFLICT": "CONFLICT_CONFIRMED",
                "UNRESOLVED": "UNRESOLVED_CONFIRMED",
            }[row["identityAdjudication"]],
            "corporateActionSemanticVerdict": {
                "NO_LATER_FACTOR": "NO_LATER_FACTOR_SUPPORTED",
                "LATER_FACTOR": "LATER_FACTOR_CONFIRMED",
                "UNRESOLVED": "UNRESOLVED_CONFIRMED",
            }[row["corporateActionAdjustmentStatus"]],
        })
    for role, audit_type in expected_roles.items():
        path = paths[role].resolve()
        if path in resolved_paths or not path.is_file():
            raise PublicAiCohortError("AI audits must be three distinct files")
        resolved_paths.add(path)
        raw, audit = read_bound_json(path)
        if not isinstance(audit, dict):
            raise PublicAiCohortError(f"{role} audit must be an object")
        require_exact_keys(audit, AI_AUDIT_KEYS, f"{role} audit")
        if (
            audit["schema"] != AI_AUDIT_SCHEMA
            or audit["auditType"] != audit_type
            or audit["status"] != "PASS"
            or audit["reviewerType"] != "CODEX_AGENT"
            or audit["blockingFindings"] != []
        ):
            raise PublicAiCohortError(f"{role} audit is not a clean Codex-agent PASS")
        if require_bool(audit["humanAttestation"], f"{role} humanAttestation"):
            raise PublicAiCohortError(f"{role} may not claim HUMAN review")
        if require_bool(audit["outcomesAccessed"], f"{role} outcomesAccessed"):
            raise PublicAiCohortError(f"{role} reports outcome access")
        parse_utc_timestamp(audit["completedAt"], f"{role} completedAt")
        for key in ("agentId", "runId"):
            if not isinstance(audit[key], str) or not audit[key].strip():
                raise PublicAiCohortError(f"{role} {key} missing")
        if audit["agentId"] in agent_ids or audit["runId"] in run_ids:
            raise PublicAiCohortError("AI audits must use distinct agents and runs")
        agent_ids.add(audit["agentId"])
        run_ids.add(audit["runId"])
        for key, expected in expected_hashes.items():
            if audit[key] != expected:
                raise PublicAiCohortError(f"{role} audit binding mismatch: {key}")
        if not isinstance(audit["rowReviews"], list):
            raise PublicAiCohortError(f"{role} rowReviews must be a list")
        for index, review in enumerate(audit["rowReviews"]):
            if not isinstance(review, dict):
                raise PublicAiCohortError(f"{role} row review {index} must be an object")
            require_exact_keys(review, AI_AUDIT_ROW_KEYS, f"{role} row review {index}")
            validate_evidence_refs(review["identityEvidenceRefs"], f"{role} row review {index} identity refs")
            validate_evidence_refs(
                review["corporateActionEvidenceRefs"],
                f"{role} row review {index} corporate-action refs",
            )
        if audit["rowReviews"] != expected_reviews:
            raise PublicAiCohortError(f"{role} does not attest every row and exact evidence reference")
        artifact_hashes[role] = hashlib.sha256(raw).hexdigest()
    return artifact_hashes


def verify_remote_authorization(
    authorization: Any,
    authorization_path: Path,
    repository: Path,
    local_artifact_sha256: dict[str, str],
    outcome_ledger_path: Path,
    expected_remote_url: str = AUTHORIZATION_REMOTE_URL,
    expected_ref: str = AUTHORIZATION_REF,
    selector_path: Path | None = None,
    expected_loaded_selector_sha256: str | None = None,
) -> None:
    if not isinstance(authorization, dict):
        raise PublicAiCohortError("remote authorization must be an object")
    require_exact_keys(authorization, AUTHORIZATION_KEYS, "remote authorization")
    if authorization["schema"] != AUTHORIZATION_SCHEMA or authorization["protocolLabel"] != PROTOCOL_LABEL:
        raise PublicAiCohortError("remote authorization identity mismatch")
    parse_utc_timestamp(authorization["createdAt"], "remote authorization createdAt")
    for key in ("outcomesAccessed", "resultComputationAllowed", "productiveGqsModified"):
        if require_bool(authorization[key], f"remote authorization {key}"):
            raise PublicAiCohortError(f"remote authorization unlocks {key}")
    commit = authorization["authorizationCommit"]
    if not isinstance(commit, str) or COMMIT_RE.fullmatch(commit) is None:
        raise PublicAiCohortError("authorizationCommit must be a full commit SHA")
    if not repository.is_dir() or not outcome_ledger_path.is_file() or not authorization_path.is_file():
        raise PublicAiCohortError("repository, authorization checkpoint or outcome ledger missing")
    try:
        checkpoint_relative = authorization_path.resolve().relative_to(repository.resolve()).as_posix()
    except ValueError as exc:
        raise PublicAiCohortError("authorization checkpoint must be inside the repository") from exc
    artifacts = authorization["authorizedArtifacts"]
    if not isinstance(artifacts, list):
        raise PublicAiCohortError("authorizedArtifacts must be a list")
    by_role: dict[str, dict[str, str]] = {}
    artifact_paths: set[str] = set()
    for index, artifact in enumerate(artifacts):
        if not isinstance(artifact, dict):
            raise PublicAiCohortError(f"authorized artifact {index} must be an object")
        require_exact_keys(artifact, AUTHORIZED_ARTIFACT_KEYS, f"authorized artifact {index}")
        role = artifact["role"]
        path = artifact["path"]
        if role not in AUTHORIZED_ARTIFACT_ROLES or role in by_role or path in artifact_paths:
            raise PublicAiCohortError("authorized artifact roles changed or duplicated")
        if (
            not isinstance(path, str)
            or not path
            or "\\" in path
            or path.startswith("/")
            or any(part in {"", ".", ".."} for part in path.split("/"))
        ):
            raise PublicAiCohortError("authorized artifact path must be a safe repository-relative path")
        require_sha256(artifact["sha256"], f"authorized artifact {index} sha256")
        by_role[role] = artifact
        artifact_paths.add(path)
    if set(by_role) != AUTHORIZED_ARTIFACT_ROLES or set(local_artifact_sha256) != AUTHORIZED_ARTIFACT_ROLES:
        raise PublicAiCohortError("authorized artifact role set is incomplete")
    for role in AUTHORIZED_ARTIFACT_ROLES:
        if by_role[role]["sha256"] != local_artifact_sha256[role]:
            raise PublicAiCohortError(f"authorized artifact local hash mismatch: {role}")

    remote_name = authorization["authorizationRemote"]
    authorization_ref = authorization["authorizationRef"]
    if not isinstance(remote_name, str) or not remote_name.strip():
        raise PublicAiCohortError("authorizationRemote missing")
    configured_remote = str(run_git(repository, ["remote", "get-url", remote_name])).strip()
    if configured_remote != expected_remote_url or authorization_ref != expected_ref:
        raise PublicAiCohortError("authorization remote URL or ref is not the pinned study authority")

    remote_output = str(run_git(
        repository,
        ["ls-remote", "--exit-code", remote_name, authorization_ref],
    )).strip().splitlines()
    if len(remote_output) != 1:
        raise PublicAiCohortError("authorization remote ref is ambiguous")
    remote_head = remote_output[0].split()[0].lower()
    if COMMIT_RE.fullmatch(remote_head) is None:
        raise PublicAiCohortError("authorization remote returned no full commit SHA")
    local_head = str(run_git(repository, ["rev-parse", "HEAD"])).strip().lower()
    if local_head != remote_head:
        raise PublicAiCohortError("selection must run from the exact authorized remote head")
    clean_paths = [checkpoint_relative, *sorted(artifact_paths)]
    if str(run_git(repository, ["status", "--porcelain", "--", *clean_paths])).strip():
        raise PublicAiCohortError("authorized selection artifacts are not a clean checkout")
    if selector_path is not None:
        try:
            selector_relative = selector_path.resolve().relative_to(repository.resolve()).as_posix()
        except ValueError as exc:
            raise PublicAiCohortError("running selector must be inside the authorized repository") from exc
        selector_hash = sha256_file(selector_path)
        if (
            selector_relative != by_role["SELECTOR"]["path"]
            or selector_hash != by_role["SELECTOR"]["sha256"]
            or expected_loaded_selector_sha256 != selector_hash
        ):
            raise PublicAiCohortError("running selector bytes differ from the authorized loaded selector")
    checkpoint_bytes = authorization_path.read_bytes()
    checkpoint_blob = run_git(repository, ["show", f"{remote_head}:{checkpoint_relative}"], binary=True)
    if checkpoint_blob != checkpoint_bytes:
        raise PublicAiCohortError("remote ref does not bind the exact authorization checkpoint")
    run_git(repository, ["cat-file", "-e", f"{commit}^{{commit}}"])
    run_git(repository, ["merge-base", "--is-ancestor", commit, remote_head])
    for role, artifact in by_role.items():
        blob = run_git(
            repository,
            ["show", f"{commit}:{artifact['path']}"],
            binary=True,
        )
        if hashlib.sha256(blob).hexdigest() != artifact["sha256"]:
            raise PublicAiCohortError(f"authorized commit blob hash mismatch: {role}")
    outcome_ledger_bytes, outcome_ledger = read_bound_json(outcome_ledger_path)
    if hashlib.sha256(outcome_ledger_bytes).hexdigest() != local_artifact_sha256["OUTCOME_LEDGER"]:
        raise PublicAiCohortError("local outcome ledger hash changed")
    remote_ledger = run_git(
        repository,
        ["show", f"{remote_head}:{by_role['OUTCOME_LEDGER']['path']}"],
        binary=True,
    )
    if remote_ledger != outcome_ledger_bytes:
        raise PublicAiCohortError("remote head records a different outcome ledger state")
    validate_outcome_ledger(outcome_ledger)


def fixture_row(fixture_name: str, **changes: Any) -> dict[str, Any]:
    ticker = fixture_name.upper().replace("-", "")[:20]
    row = {
        "rowId": "pending",
        "dataset": "nasdaqlisted",
        "observedAt": "2014-06-30T00:00:00Z",
        "ticker": ticker,
        "candidateStatus": "CANDIDATE_UNADJUDICATED",
        "archivedSnapshotObserved": True,
        "priceFilePresent": True,
        "priceFileValid": True,
        "priceFileTicker": ticker,
        "priceFileSha256": "a" * 64,
        "priorBarCount": 252,
        "identitySynthetic": False,
        "identityConflictTypes": [],
        "laterCorporateActionFactorKnown": False,
        "identityAdjudication": "CLEAR",
        "corporateActionAdjustmentStatus": "NO_LATER_FACTOR",
        "identityEvidenceRefs": [{"sourceId": "TEST-ID", "payloadSha256": "d" * 64}],
        "corporateActionEvidenceRefs": [{"sourceId": "TEST-CA", "payloadSha256": "e" * 64}],
        "identityEvidenceBasis": "POINT_IN_TIME_IDENTITY_MATCH",
        "corporateActionEvidenceBasis": "NO_LATER_FACTOR_IN_BOUND_EVIDENCE",
        "identityClaimBindingSha256": "pending",
        "corporateActionClaimBindingSha256": "pending",
    }
    row.update(changes)
    row["identityEvidenceBasis"] = {
        "CLEAR": "POINT_IN_TIME_IDENTITY_MATCH",
        "CONFLICT": "CONFLICT_EVIDENCE",
        "UNRESOLVED": "UNRESOLVED",
    }[row["identityAdjudication"]]
    row["corporateActionEvidenceBasis"] = {
        "NO_LATER_FACTOR": "NO_LATER_FACTOR_IN_BOUND_EVIDENCE",
        "LATER_FACTOR": "LATER_FACTOR_EVIDENCE",
        "UNRESOLVED": "UNRESOLVED",
    }[row["corporateActionAdjustmentStatus"]]
    row["rowId"] = expected_row_id(row)
    row["identityClaimBindingSha256"] = expected_claim_binding(row, "identity")
    row["corporateActionClaimBindingSha256"] = expected_claim_binding(row, "corporateAction")
    return row


def fixture_manifest() -> dict[str, Any]:
    return {
        "schema": INPUT_SCHEMA,
        "createdAt": "2026-08-12T00:00:00Z",
        "sourceInventorySha256": "b" * 64,
        "identityEvidenceSha256": "c" * 64,
        "outcomesAccessed": False,
        "containsOutcomeFields": False,
        "rows": [
            fixture_row("eligible"),
            fixture_row("ticker-reuse", identityConflictTypes=["TICKER_REUSE"], identityAdjudication="CONFLICT"),
            fixture_row("multi-cik", identityConflictTypes=["MULTI_CIK"], identityAdjudication="CONFLICT"),
            fixture_row("multi-symbol", identityConflictTypes=["MULTI_SYMBOL"], identityAdjudication="CONFLICT"),
            fixture_row("share-class", identityConflictTypes=["SHARE_CLASS"], identityAdjudication="CONFLICT"),
            fixture_row("successor", identityConflictTypes=["SUCCESSOR"], identityAdjudication="CONFLICT"),
            fixture_row("short-history", priorBarCount=251),
            fixture_row(
                "later-action-factor",
                laterCorporateActionFactorKnown=True,
                corporateActionAdjustmentStatus="LATER_FACTOR",
            ),
            fixture_row(
                "missing-file",
                priceFilePresent=False,
                priceFileValid=False,
                priceFileTicker=None,
                priceFileSha256=None,
                priorBarCount=0,
            ),
            fixture_row("ambiguous", candidateStatus="AMBIGUOUS"),
        ],
    }


def write_fixture_sources(root: Path, manifest: dict[str, Any]) -> tuple[Path, Path, Path, Path]:
    database = root / "bridge.sqlite"
    connection = sqlite3.connect(database)
    connection.executescript("""
        CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);
        INSERT INTO meta VALUES('schema','early-detection-entity-bridge/v2');
        CREATE TABLE snapshots(snapshot_id INTEGER PRIMARY KEY,dataset TEXT,observed_at TEXT);
        CREATE TABLE candidates(snapshot_id INTEGER,ticker TEXT,status TEXT);
        INSERT INTO snapshots VALUES(1,'nasdaqlisted','2014-06-30T00:00:00Z');
    """)
    connection.executemany(
        "INSERT INTO candidates VALUES(1,?,?)",
        [(row["ticker"], row["candidateStatus"]) for row in manifest["rows"]],
    )
    connection.commit()
    connection.close()

    prices = root / "prices"
    prices.mkdir()
    cutoff = date(2014, 6, 30)
    for row in manifest["rows"]:
        if not row["priceFilePresent"]:
            continue
        count = row["priorBarCount"]
        start = cutoff - timedelta(days=count)
        price_rows = [
            {"date": (start + timedelta(days=index)).isoformat(), "close": 10 + index}
            for index in range(count)
        ]
        path = prices / f"{row['priceFileTicker']}.json"
        path.write_text(json.dumps(price_rows), encoding="utf-8")
        row["priceFileSha256"] = sha256_file(path)

    research_corpus_path = root / "research-corpus.json"
    research_corpus = {
        "schema": "synthetic-research-corpus/v1",
        "evidence": [
            {"sourceId": "TEST-ID", "payloadSha256": "d" * 64},
            {"sourceId": "TEST-CA", "payloadSha256": "e" * 64},
        ],
        "outcomesAccessed": False,
        "productiveGqsModified": False,
    }
    research_corpus_path.write_text(json.dumps(research_corpus), encoding="utf-8")
    evidence = {
        "schema": IDENTITY_EVIDENCE_SCHEMA,
        "createdAt": "2026-08-12T00:00:00Z",
        "sourceCorpusSha256": sha256_file(research_corpus_path),
        "outcomesAccessed": False,
        "rows": [
            {key: row[key] for key in IDENTITY_EVIDENCE_ROW_KEYS}
            for row in manifest["rows"]
        ],
    }
    evidence_path = root / "identity-evidence.json"
    evidence_path.write_text(json.dumps(evidence), encoding="utf-8")
    manifest["sourceInventorySha256"] = sha256_file(database)
    manifest["identityEvidenceSha256"] = sha256_file(evidence_path)
    return database, prices, evidence_path, research_corpus_path


def remote_authorization_self_test(root: Path) -> None:
    repository = root / "authorization-work"
    remote = root / "authorization-remote.git"
    repository.mkdir()
    subprocess.run(["git", "init", "--bare", str(remote)], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    subprocess.run(
        ["git", "init", "--initial-branch=main", str(repository)],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    run_git(repository, ["config", "user.name", "Public AI fixture"])
    run_git(repository, ["config", "user.email", "fixture@example.invalid"])

    outcome_ledger = {
        "schema": OUTCOME_LEDGER_SCHEMA,
        "protocolLabel": PROTOCOL_LABEL,
        "lastUpdated": "2026-08-12T00:00:00Z",
        "originalV4OutcomesAccessed": False,
        "publicAiOutcomesAccessed": False,
        "resultComputationAllowed": False,
        "productiveGqsModified": False,
        "events": [],
    }
    artifacts: list[dict[str, str]] = []
    local_hashes: dict[str, str] = {}
    outcome_ledger_path = repository / "outcome-ledger.json"
    for role in sorted(AUTHORIZED_ARTIFACT_ROLES):
        path = "outcome-ledger.json" if role == "OUTCOME_LEDGER" else f"artifacts/{role.lower()}.txt"
        target = repository / path
        target.parent.mkdir(parents=True, exist_ok=True)
        raw = (
            json.dumps(outcome_ledger, sort_keys=True, separators=(",", ":")).encode("utf-8")
            if role == "OUTCOME_LEDGER"
            else f"fixture:{role}\n".encode("utf-8")
        )
        target.write_bytes(raw)
        digest = hashlib.sha256(raw).hexdigest()
        local_hashes[role] = digest
        artifacts.append({"role": role, "path": path, "sha256": digest})
    run_git(repository, ["add", "."])
    run_git(repository, ["commit", "-m", "fixture sealed artifacts"])
    commit = str(run_git(repository, ["rev-parse", "HEAD"])).strip()
    authorization = {
        "schema": AUTHORIZATION_SCHEMA,
        "protocolLabel": PROTOCOL_LABEL,
        "createdAt": "2026-08-12T00:00:01Z",
        "authorizationCommit": commit,
        "authorizationRemote": "origin",
        "authorizationRef": "refs/heads/main",
        "authorizedArtifacts": artifacts,
        "outcomesAccessed": False,
        "resultComputationAllowed": False,
        "productiveGqsModified": False,
    }
    authorization_path = repository / "authorization.json"
    authorization_path.write_text(
        json.dumps(authorization, sort_keys=True, separators=(",", ":")),
        encoding="utf-8",
    )
    run_git(repository, ["add", "authorization.json"])
    run_git(repository, ["commit", "-m", "fixture authorization checkpoint"])
    run_git(repository, ["remote", "add", "origin", str(remote)])
    run_git(repository, ["push", "-u", "origin", "main"])
    verify_remote_authorization(
        authorization,
        authorization_path,
        repository,
        local_hashes,
        outcome_ledger_path,
        expected_remote_url=str(remote),
        expected_ref="refs/heads/main",
    )

    detached = copy.deepcopy(authorization)
    detached["authorizedArtifacts"][0]["sha256"] = "0" * 64
    try:
        verify_remote_authorization(
            detached,
            authorization_path,
            repository,
            local_hashes,
            outcome_ledger_path,
            expected_remote_url=str(remote),
            expected_ref="refs/heads/main",
        )
    except PublicAiCohortError:
        pass
    else:
        raise PublicAiCohortError("detached remote authorization artifact was accepted")

    stale = copy.deepcopy(outcome_ledger)
    stale["publicAiOutcomesAccessed"] = True
    stale["events"] = [{"event": "fixture-access"}]
    outcome_ledger_path.write_text(json.dumps(stale), encoding="utf-8")
    run_git(repository, ["add", "outcome-ledger.json"])
    run_git(repository, ["commit", "-m", "fixture later outcome access"])
    run_git(repository, ["push", "origin", "main"])
    outcome_ledger_path.write_text(
        json.dumps(outcome_ledger, sort_keys=True, separators=(",", ":")),
        encoding="utf-8",
    )
    try:
        verify_remote_authorization(
            authorization,
            authorization_path,
            repository,
            local_hashes,
            outcome_ledger_path,
            expected_remote_url=str(remote),
            expected_ref="refs/heads/main",
        )
    except PublicAiCohortError:
        pass
    else:
        raise PublicAiCohortError("stale pre-outcome ledger was accepted after recorded access")


def ai_audit_self_test(root: Path, manifest: dict[str, Any]) -> None:
    expected_hashes = {
        "scopeSha256": SCOPE_SHA256,
        "selectorSha256": LOADED_SELECTOR_SHA256,
        "inputManifestSha256": canonical_sha256(manifest),
        "sourceInventorySha256": manifest["sourceInventorySha256"],
        "identityEvidenceSha256": manifest["identityEvidenceSha256"],
    }
    paths: dict[str, Path] = {}
    role_types = {
        "AI_AUDIT_METHOD": "METHOD",
        "AI_AUDIT_DATA": "DATA",
        "AI_AUDIT_COUNTEREXAMPLE": "COUNTEREXAMPLE",
    }
    row_reviews = [
        {
            "rowId": row["rowId"],
            "identityEvidenceRefs": row["identityEvidenceRefs"],
            "corporateActionEvidenceRefs": row["corporateActionEvidenceRefs"],
            "identitySemanticVerdict": {
                "CLEAR": "IDENTITY_SUPPORTED",
                "CONFLICT": "CONFLICT_CONFIRMED",
                "UNRESOLVED": "UNRESOLVED_CONFIRMED",
            }[row["identityAdjudication"]],
            "corporateActionSemanticVerdict": {
                "NO_LATER_FACTOR": "NO_LATER_FACTOR_SUPPORTED",
                "LATER_FACTOR": "LATER_FACTOR_CONFIRMED",
                "UNRESOLVED": "UNRESOLVED_CONFIRMED",
            }[row["corporateActionAdjustmentStatus"]],
        }
        for row in sorted(manifest["rows"], key=lambda item: item["rowId"])
    ]
    for index, (role, audit_type) in enumerate(role_types.items(), start=1):
        audit = {
            "schema": AI_AUDIT_SCHEMA,
            "auditType": audit_type,
            "status": "PASS",
            "agentId": f"fixture-agent-{index}",
            "runId": f"fixture-run-{index}",
            "completedAt": "2026-08-12T00:00:00Z",
            "reviewerType": "CODEX_AGENT",
            "humanAttestation": False,
            "outcomesAccessed": False,
            **expected_hashes,
            "blockingFindings": [],
            "rowReviews": row_reviews,
        }
        path = root / f"audit-{audit_type.lower()}.json"
        path.write_text(json.dumps(audit), encoding="utf-8")
        paths[role] = path
    rows = validate_manifest(manifest)
    validate_ai_audits(paths, expected_hashes, rows)
    duplicate_paths = {**paths, "AI_AUDIT_DATA": paths["AI_AUDIT_METHOD"]}
    try:
        validate_ai_audits(duplicate_paths, expected_hashes, rows)
    except PublicAiCohortError:
        pass
    else:
        raise PublicAiCohortError("duplicate AI agent audit was accepted")
    incomplete = read_json(paths["AI_AUDIT_DATA"])
    incomplete["rowReviews"] = incomplete["rowReviews"][:-1]
    incomplete_path = root / "audit-data-incomplete.json"
    incomplete_path.write_text(json.dumps(incomplete), encoding="utf-8")
    try:
        validate_ai_audits(
            {**paths, "AI_AUDIT_DATA": incomplete_path},
            expected_hashes,
            rows,
        )
    except PublicAiCohortError:
        pass
    else:
        raise PublicAiCohortError("incomplete row-level AI semantic audit was accepted")


def self_test() -> dict[str, Any]:
    manifest = fixture_manifest()
    required_rejections = {
        "IDENTITY_CONFLICT_TICKER_REUSE",
        "IDENTITY_CONFLICT_MULTI_CIK",
        "IDENTITY_CONFLICT_MULTI_SYMBOL",
        "IDENTITY_CONFLICT_SHARE_CLASS",
        "IDENTITY_CONFLICT_SUCCESSOR",
        "INSUFFICIENT_PRIOR_BARS",
        "LATER_CORPORATE_ACTION_FACTOR",
        "PRICE_FILE_MISSING",
        "CANDIDATE_STATUS_AMBIGUOUS",
    }
    with tempfile.TemporaryDirectory() as folder:
        root = Path(folder)
        database, prices, evidence_path, research_corpus_path = write_fixture_sources(root, manifest)
        rows = validate_manifest(manifest)
        fixture_corpus_sha256 = sha256_file(research_corpus_path)
        verify_bound_sources(
            manifest,
            rows,
            database,
            prices,
            evidence_path,
            research_corpus_path,
            fixture_corpus_sha256,
        )
        first = select_manifest(manifest)
        second = select_manifest(copy.deepcopy(manifest))
        if first != second or first["counts"] != {"inputRows": 10, "eligibleRows": 1, "rejectedRows": 9}:
            raise PublicAiCohortError("deterministic selection fixture changed")
        if not required_rejections.issubset(first["rejectionReasonCounts"]):
            raise PublicAiCohortError("negative fixture coverage changed")
        injected = copy.deepcopy(manifest)
        injected["rows"][0]["forwardReturn"] = 1.25
        try:
            validate_manifest(injected)
        except PublicAiCohortError:
            pass
        else:
            raise PublicAiCohortError("outcome injection was accepted")
        forged = copy.deepcopy(manifest)
        forged["rows"][0]["priorBarCount"] += 1
        try:
            verify_bound_sources(
                forged,
                validate_manifest(forged),
                database,
                prices,
                evidence_path,
                research_corpus_path,
                fixture_corpus_sha256,
            )
        except PublicAiCohortError:
            pass
        else:
            raise PublicAiCohortError("forged priorBarCount was accepted")
        forged_evidence_manifest = copy.deepcopy(manifest)
        forged_evidence_manifest["rows"][0]["identityEvidenceRefs"] = [
            {"sourceId": "TEST-ID", "payloadSha256": "f" * 64}
        ]
        forged_evidence_manifest["rows"][0]["identityClaimBindingSha256"] = expected_claim_binding(
            forged_evidence_manifest["rows"][0],
            "identity",
        )
        forged_evidence = read_json(evidence_path)
        forged_evidence["rows"][0]["identityEvidenceRefs"] = copy.deepcopy(
            forged_evidence_manifest["rows"][0]["identityEvidenceRefs"]
        )
        forged_evidence["rows"][0]["identityClaimBindingSha256"] = forged_evidence_manifest["rows"][0][
            "identityClaimBindingSha256"
        ]
        forged_evidence_path = root / "forged-identity-evidence.json"
        forged_evidence_path.write_text(json.dumps(forged_evidence), encoding="utf-8")
        forged_evidence_manifest["identityEvidenceSha256"] = sha256_file(forged_evidence_path)
        try:
            verify_bound_sources(
                forged_evidence_manifest,
                validate_manifest(forged_evidence_manifest),
                database,
                prices,
                forged_evidence_path,
                research_corpus_path,
                fixture_corpus_sha256,
            )
        except PublicAiCohortError:
            pass
        else:
            raise PublicAiCohortError("unbound corpus evidence reference was accepted")
        unobserved_manifest = copy.deepcopy(manifest)
        unobserved_manifest["rows"][0]["archivedSnapshotObserved"] = False
        unobserved_evidence = read_json(evidence_path)
        unobserved_evidence_path = root / "unobserved-identity-evidence.json"
        unobserved_evidence_path.write_text(json.dumps(unobserved_evidence), encoding="utf-8")
        unobserved_manifest["identityEvidenceSha256"] = sha256_file(unobserved_evidence_path)
        try:
            verify_bound_sources(
                unobserved_manifest,
                validate_manifest(unobserved_manifest),
                database,
                prices,
                unobserved_evidence_path,
                research_corpus_path,
                fixture_corpus_sha256,
            )
        except PublicAiCohortError:
            pass
        else:
            raise PublicAiCohortError("bound inventory row was allowed to deny its archive observation")
        same_day_manifest = copy.deepcopy(manifest)
        same_day_row = next(row for row in same_day_manifest["rows"] if row["rowId"] == expected_row_id({
            "dataset": "nasdaqlisted",
            "observedAt": "2014-06-30T00:00:00Z",
            "ticker": "SHORTHISTORY",
        }))
        same_day_path = prices / "SHORTHISTORY.json"
        same_day_rows = read_json(same_day_path)
        same_day_rows.append({"date": "2014-06-30", "close": 999})
        same_day_path.write_text(json.dumps(same_day_rows), encoding="utf-8")
        same_day_row["priceFileSha256"] = sha256_file(same_day_path)
        same_day_row["priorBarCount"] = 252
        try:
            verify_bound_sources(
                same_day_manifest,
                validate_manifest(same_day_manifest),
                database,
                prices,
                evidence_path,
                research_corpus_path,
                fixture_corpus_sha256,
            )
        except PublicAiCohortError:
            pass
        else:
            raise PublicAiCohortError("same-day close was counted as a prior bar")
        input_path = root / "input.json"
        input_path.write_text(json.dumps(manifest), encoding="utf-8")
        fake_seal = {
            "schema": SEAL_SCHEMA,
            "protocolLabel": PROTOCOL_LABEL,
            "protocolStatus": "DRAFT",
            "scopeSha256": SCOPE_SHA256,
            "selectorSha256": LOADED_SELECTOR_SHA256,
            "inputManifestSha256": sha256_file(input_path),
            "sealedAt": "2026-08-12T00:00:00Z",
            "outcomesAccessed": False,
            "resultComputationAllowed": False,
            "productiveGqsModified": False,
        }
        valid_seal = {**fake_seal, "protocolStatus": "SEALED_PRE_OUTCOME"}
        verify_seal(
            valid_seal,
            sha256_file(input_path),
            LOADED_SELECTOR_SHA256,
            SCOPE_SHA256,
            manifest["createdAt"],
        )
        seal_mutations = {
            "protocolStatus": "DRAFT",
            "protocolLabel": "ORIGINAL-V4",
            "scopeSha256": "0" * 64,
            "selectorSha256": "0" * 64,
            "inputManifestSha256": "0" * 64,
            "outcomesAccessed": True,
            "resultComputationAllowed": True,
            "productiveGqsModified": True,
        }
        for field, replacement in seal_mutations.items():
            mutated = {**valid_seal, field: replacement}
            try:
                verify_seal(
                    mutated,
                    sha256_file(input_path),
                    LOADED_SELECTOR_SHA256,
                    SCOPE_SHA256,
                    manifest["createdAt"],
                )
            except PublicAiCohortError:
                pass
            else:
                raise PublicAiCohortError(f"seal mutation was accepted: {field}")
        Path(f"{database}-journal").write_bytes(b"unbound fixture rollback journal")
        try:
            verify_bound_sources(
                manifest,
                rows,
                database,
                prices,
                evidence_path,
                research_corpus_path,
                fixture_corpus_sha256,
            )
        except PublicAiCohortError:
            pass
        else:
            raise PublicAiCohortError("unbound SQLite rollback journal was accepted")
        ai_audit_self_test(root, manifest)
        remote_authorization_self_test(root)
    return {
        "status": "PASS",
        "deterministic": True,
        "syntheticFixtureOnly": True,
        "sealRequiredForProduction": True,
        "realSourceBindingsRecomputed": True,
        "forgedPriorBarCountRejected": True,
        "unboundCorpusReferenceRejected": True,
        "sameDayCloseRejected": True,
        "remoteAuthorizationVerified": True,
        "detachedRemoteArtifactRejected": True,
        "sqliteSidecarRejected": True,
        "archivedObservationRecomputed": True,
        "structuredEvidenceBasisOnly": True,
        "aiAuditSchemaVerified": True,
        "duplicateAiAuditRejected": True,
        "incompleteSemanticAuditRejected": True,
        "staleOutcomeLedgerRejected": True,
        "counts": first["counts"],
        "negativeRejections": sorted(required_rejections),
        "outcomeInjectionRejected": True,
        "unsealedProductionRejected": True,
        "sealMutationsRejected": sorted(seal_mutations),
        "claimLocks": {
            "protocolLabel": first["protocolLabel"],
            "status": production_claim_locks()["status"],
            "confirmatoryEligible": production_claim_locks()["confirmatoryEligible"],
            "survivorshipSafe": production_claim_locks()["survivorshipSafe"],
            "humanAttestation": production_claim_locks()["humanAttestation"],
            "aiAuditOnly": production_claim_locks()["aiAuditOnly"],
            "resultComputationAllowed": production_claim_locks()["resultComputationAllowed"],
            "productiveGqsModified": production_claim_locks()["productiveGqsModified"],
        },
        "outcomesAccessed": False,
    }


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    sub = value.add_subparsers(dest="command", required=True)
    select_parser = sub.add_parser("select")
    select_parser.add_argument("--input-manifest", type=Path, required=True)
    select_parser.add_argument("--seal-manifest", type=Path, required=True)
    select_parser.add_argument("--authorization-checkpoint", type=Path, required=True)
    select_parser.add_argument("--scope-artifact", type=Path, required=True)
    select_parser.add_argument("--source-inventory", type=Path, required=True)
    select_parser.add_argument("--prices-directory", type=Path, required=True)
    select_parser.add_argument("--identity-evidence", type=Path, required=True)
    select_parser.add_argument("--research-corpus", type=Path, required=True)
    select_parser.add_argument("--repository", type=Path, required=True)
    select_parser.add_argument("--outcome-ledger", type=Path, required=True)
    select_parser.add_argument("--ai-audit-method", type=Path, required=True)
    select_parser.add_argument("--ai-audit-data", type=Path, required=True)
    select_parser.add_argument("--ai-audit-counterexample", type=Path, required=True)
    select_parser.add_argument("--output", type=Path, required=True)
    sub.add_parser("self-test")
    return value


def main() -> int:
    args = parser().parse_args()
    if args.command == "self-test":
        printed = self_test()
    else:
        input_path = args.input_manifest.expanduser().resolve()
        seal_path = args.seal_manifest.expanduser().resolve()
        authorization_path = args.authorization_checkpoint.expanduser().resolve()
        scope_path = args.scope_artifact.expanduser().resolve()
        source_inventory = args.source_inventory.expanduser().resolve()
        prices_directory = args.prices_directory.expanduser().resolve()
        identity_evidence_path = args.identity_evidence.expanduser().resolve()
        research_corpus_path = args.research_corpus.expanduser().resolve()
        repository = args.repository.expanduser().resolve()
        outcome_ledger_path = args.outcome_ledger.expanduser().resolve()
        ai_audit_method_path = args.ai_audit_method.expanduser().resolve()
        ai_audit_data_path = args.ai_audit_data.expanduser().resolve()
        ai_audit_counterexample_path = args.ai_audit_counterexample.expanduser().resolve()
        output_path = args.output.expanduser().resolve()
        if output_path.exists():
            raise PublicAiCohortError("output already exists; refusing to overwrite")
        if (
            not input_path.is_file()
            or not seal_path.is_file()
            or not authorization_path.is_file()
            or not scope_path.is_file()
        ):
            raise PublicAiCohortError("input manifest, seal, authorization checkpoint or scope artifact missing")
        try:
            input_bytes = input_path.read_bytes()
            manifest = json.loads(input_bytes.decode("utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise PublicAiCohortError(f"invalid JSON: {input_path}") from exc
        seal_bytes = seal_path.read_bytes()
        try:
            seal = json.loads(seal_bytes.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise PublicAiCohortError(f"invalid JSON: {seal_path}") from exc
        authorization_bytes, authorization = read_bound_json(authorization_path)
        rows = validate_manifest(manifest)
        verify_bound_sources(
            manifest,
            rows,
            source_inventory,
            prices_directory,
            identity_evidence_path,
            research_corpus_path,
        )
        selector_path = Path(__file__).resolve()
        selector_sha256 = sha256_file(selector_path)
        if selector_sha256 != LOADED_SELECTOR_SHA256:
            raise PublicAiCohortError("selector file changed after it was loaded")
        scope_sha256 = sha256_file(scope_path)
        input_sha256 = hashlib.sha256(input_bytes).hexdigest()
        identity_evidence_sha256 = sha256_file(identity_evidence_path)
        verify_seal(
            seal,
            input_sha256,
            selector_sha256,
            scope_sha256,
            manifest["createdAt"],
        )
        audit_hashes = validate_ai_audits(
            {
                "AI_AUDIT_METHOD": ai_audit_method_path,
                "AI_AUDIT_DATA": ai_audit_data_path,
                "AI_AUDIT_COUNTEREXAMPLE": ai_audit_counterexample_path,
            },
            {
                "scopeSha256": scope_sha256,
                "selectorSha256": selector_sha256,
                "inputManifestSha256": input_sha256,
                "sourceInventorySha256": manifest["sourceInventorySha256"],
                "identityEvidenceSha256": identity_evidence_sha256,
            },
            rows,
        )
        verify_remote_authorization(
            authorization,
            authorization_path,
            repository,
            {
                "SCOPE": scope_sha256,
                "SEAL": hashlib.sha256(seal_bytes).hexdigest(),
                "SELECTOR": selector_sha256,
                "INPUT_MANIFEST": input_sha256,
                "IDENTITY_EVIDENCE": identity_evidence_sha256,
                "OUTCOME_LEDGER": sha256_file(outcome_ledger_path),
                **audit_hashes,
            },
            outcome_ledger_path,
            selector_path=selector_path,
            expected_loaded_selector_sha256=LOADED_SELECTOR_SHA256,
        )
        result = select_manifest(manifest)
        unsigned = {key: value for key, value in result.items() if key != "reportSha256"}
        unsigned.update({
            "scopeSha256": scope_sha256,
            "selectorSha256": selector_sha256,
            "sealManifestSha256": hashlib.sha256(seal_bytes).hexdigest(),
            "authorizationCheckpointSha256": hashlib.sha256(authorization_bytes).hexdigest(),
            "authorizationCommit": authorization["authorizationCommit"],
            "authorizationRef": authorization["authorizationRef"],
        })
        unsigned.update(production_claim_locks())
        result = {**unsigned, "reportSha256": canonical_sha256(unsigned)}
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with output_path.open("x", encoding="utf-8", newline="\n") as handle:
            json.dump(result, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        printed = {
            "status": result["status"],
            "counts": result["counts"],
            "reportSha256": result["reportSha256"],
            "outcomesAccessed": result["outcomesAccessed"],
        }
    print(json.dumps(printed, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
