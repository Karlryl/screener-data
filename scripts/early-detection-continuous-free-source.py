#!/usr/bin/env python3
"""Append-only controller for the continuous no-cost source research queue."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import tempfile
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator


ROOT = Path(__file__).resolve().parents[1]
RESEARCH_ROOT = ROOT / "research" / "early-detection-v4"
STATE_ROOT = ROOT / "state"
POLICY_PATH = RESEARCH_ROOT / "continuous-free-source-policy-v1.md"
CONTRACT_PATH = RESEARCH_ROOT / "evidence-cell-contract-v1.json"
REGISTRY_PATH = RESEARCH_ROOT / "continuous-free-source-registry-v1.json"
QUEUE_SEED_PATH = RESEARCH_ROOT / "continuous-free-source-queue-seed-v1.json"
HYPOTHESIS_PATH = RESEARCH_ROOT / "hypothesis-register-v1.json"
READINESS_PATH = ROOT / "reports" / "early-detection" / "readiness.json"
DEFAULT_EVENTS_PATH = STATE_ROOT / "early-detection-free-source-events-v2.jsonl"
DEFAULT_STATE_PATH = STATE_ROOT / "early-detection-free-source-state-v2.json"
LOCK_PATH = STATE_ROOT / ".early-detection-free-source-controller.lock"
CAS_ROOT = STATE_ROOT / "early-detection-free-source-cas-v1" / "sha256"
SCRIPT_PATH = Path(__file__).resolve()
TEST_PATH = ROOT / "tests" / "early-detection-continuous-free-source.test.js"

SHA_RE = re.compile(r"^[0-9a-f]{64}$")
RFC3339_Z_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
ID_RE = re.compile(r"^[A-Z0-9][A-Z0-9._-]{2,119}$")

CAPABILITIES = (
    "HISTORICAL_VALIDITY_INTERVAL",
    "CONSOLIDATED_ADJUSTED_OHLCV",
    "COMPLETE_CORPORATE_ACTIONS",
    "OBSERVED_TERMINAL_SESSION",
    "TERMINAL_WEALTH",
)
CAPABILITY_STATES = {"NO", "PARTIAL", "POTENTIAL"}
ARTIFACT_CLASSES = {"SOURCE_CAPTURE", "CONTRACT", "INDEPENDENT_VERIFICATION", "RATE_LIMIT_EVIDENCE"}
LICENSE_DISPOSITIONS = {
    "PUBLIC_DOMAIN", "FREE_INTERNAL_USE_ALLOWED", "LICENSE_REVIEW_PENDING", "QUARANTINE_ONLY",
}
TASK_STATES = {
    "READY",
    "CLAIMED",
    "USER_ACTION_REQUIRED",
    "RATE_DEFERRED",
    "NOT_FOUND",
    "NOT_ENTITLED",
    "LICENSE_BLOCKED",
    "AMBIGUOUS",
    "CONFLICT",
    "RESOLVED",
    "REJECTED",
}
TERMINAL_TASK_STATES = {"NOT_FOUND", "NOT_ENTITLED", "LICENSE_BLOCKED", "RESOLVED", "REJECTED"}
ALLOWED_TRANSITIONS = {
    "READY": {"CLAIMED", "USER_ACTION_REQUIRED", "RATE_DEFERRED", "REJECTED"},
    "CLAIMED": {
        "READY", "RATE_DEFERRED", "NOT_FOUND", "NOT_ENTITLED", "LICENSE_BLOCKED",
        "AMBIGUOUS", "CONFLICT", "RESOLVED", "REJECTED",
    },
    "USER_ACTION_REQUIRED": {"READY", "REJECTED"},
    "RATE_DEFERRED": {"READY", "REJECTED"},
    "AMBIGUOUS": {"READY", "CONFLICT", "RESOLVED", "REJECTED"},
    "CONFLICT": {"READY", "RESOLVED", "REJECTED"},
    "NOT_FOUND": set(),
    "NOT_ENTITLED": set(),
    "LICENSE_BLOCKED": set(),
    "RESOLVED": set(),
    "REJECTED": set(),
}
EVENT_TYPES = {
    "QUEUE_INITIALIZED",
    "SOURCE_DISCOVERED",
    "TASK_ADDED",
    "TASK_CLAIMED",
    "TASK_TRANSITIONED",
    "ARTIFACT_CAPTURED",
}
FORBIDDEN_PRIORITY_INPUTS = {
    "RETURN", "P_VALUE", "ENDPOINT_VALUE", "FAVORABLE_RESULT", "POST_OUTCOME_ELIGIBILITY",
}
HANDSHAKE_CONTRACT = {
    "ACTIVE_STABLE": {
        "label": "AAPL",
        "requiredAssertions": {
            "IDENTITY_UNAMBIGUOUS", "HISTORY_ENTITLEMENT_EXPLICIT",
            "RAW_AND_ADJUSTED_SEMANTICS_EXPLICIT", "NO_PREMIUM_ENDPOINT_USED",
        },
    },
    "SAME_SECURITY_SYMBOL_CHANGE": {
        "label": "FB_TO_META",
        "requiredAssertions": {
            "STABLE_SECURITY_ID_OR_FAIL_CLOSED", "EFFECTIVE_CHANGE_DATE_BOUND",
            "NO_TICKER_ONLY_STITCH",
        },
    },
    "TERMINAL_CASH_MERGER_OR_DELISTING": {
        "label": "ATVI_TO_MSFT",
        "requiredAssertions": {
            "LAST_SESSION_STATUS_EXPLICIT", "DELISTING_OR_MERGER_EVENT_BOUND",
            "TERMINAL_PAYMENT_EXPLICIT_OR_UNRESOLVED", "NO_LAST_QUOTE_AS_PAYMENT_INFERENCE",
        },
    },
}
ORIGINAL_GATE_NAMES = {
    "protocolSealed",
    "confirmatoryAnalysisImplementationSealed",
    "entityListingLedger",
    "appendOnlySecStore",
    "historicalUniverse",
    "asOfLeakageGate",
    "adjustedOhlcv",
    "corporateActionsDelistings",
    "historicalGqsAdapter",
    "conceptMapFrozen",
    "independentAuditPassed",
    "blindCodingAgreementPassed",
    "researchCorpusSealed",
}
EVENT_KEYS = {
    "schema", "sequence", "eventId", "previousEventSha256", "createdAt", "agentId",
    "runId", "taskId", "eventType", "fencingToken", "inputBundleSha256", "payload",
    "eventSha256",
}
TASK_KEYS = {
    "taskId", "sourceId", "priority", "state", "action", "entryCriteria",
    "exitCriteria", "abortCriteria",
}
ARTIFACT_KEYS = {
    "artifactClass", "path", "rawSha256", "bytes", "mediaType", "observedAt",
    "knownAt", "outcomesAccessed", "sourceId", "licenseDisposition", "accountTier",
    "semantic", "cellKey", "supportedCriteria", "casPath", "gitCommit", "gitPath",
}
SOURCE_KEYS = {
    "sourceId", "name", "authority", "priority", "officialUrls", "access",
    "capabilities", "exportRisk", "licenseRisk", "qualificationState",
}


class ControllerError(RuntimeError):
    pass


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def canonical_sha256(value: Any) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def raw_sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(4 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def git_text(*args: str) -> str:
    completed = subprocess.run(
        ["git", *args], cwd=ROOT, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    return completed.stdout.decode("utf-8").strip()


def git_bytes(*args: str) -> bytes:
    return subprocess.run(
        ["git", *args], cwd=ROOT, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    ).stdout


def validate_state_paths(events_path: Path, state_path: Path) -> tuple[Path, Path]:
    events_path = events_path.resolve()
    state_path = state_path.resolve()
    allowed = STATE_ROOT.resolve()
    for path, label in ((events_path, "events"), (state_path, "state")):
        try:
            path.relative_to(allowed)
        except ValueError as exc:
            raise ControllerError(f"{label} path must remain below state root") from exc
    if events_path == state_path:
        raise ControllerError("events and state paths must differ")
    if events_path.suffix != ".jsonl" or state_path.suffix != ".json":
        raise ControllerError("events/state path suffix changed")
    return events_path, state_path


def entry_criteria_satisfied(contracts: dict[str, Any], task: dict[str, Any]) -> bool:
    source = next(row for row in contracts["registry"]["sources"] if row["sourceId"] == task["sourceId"])
    for criterion in task["entryCriteria"]:
        if criterion in {"OFFICIAL_DOCUMENTATION_URLS_FROZEN", "PUBLIC_CATALOG_URLS", "PUBLIC_SEARCH_AVAILABLE"}:
            satisfied = bool(source["officialUrls"])
        elif criterion == "PUBLIC_ENDPOINT_AVAILABLE":
            satisfied = source["access"]["state"] == "READY" and bool(source["officialUrls"])
        elif criterion == "NO_KEY_REQUIRED":
            satisfied = not source["access"]["freeApiKeyRequired"] and not source["access"]["freeAccountRequired"]
        elif criterion == "BOUND_EXISTING_EVENT_INVENTORY":
            inventory = ROOT / "reports" / "early-detection" / "sec-corporate-action-candidates-2009-2024.json"
            satisfied = inventory.is_file()
        elif criterion in {"NO_PAYMENT_DETAILS", "NO_TRIAL", "FREE_KEY", "NO_EXISTING_ACCOUNT_SESSION"}:
            satisfied = False
        else:
            satisfied = False
        if not satisfied:
            return False
    return True


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_z(value: str, label: str) -> datetime:
    if not RFC3339_Z_RE.fullmatch(value):
        raise ControllerError(f"{label} must be canonical RFC3339 Z without fractions")
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError as exc:
        raise ControllerError(f"invalid {label}: {value}") from exc


def exact_keys(value: dict[str, Any], expected: set[str], label: str) -> None:
    actual = set(value)
    if actual != expected:
        raise ControllerError(f"{label} keys changed: missing={sorted(expected-actual)} extra={sorted(actual-expected)}")


def require_sha(value: Any, label: str) -> str:
    text = str(value)
    if not SHA_RE.fullmatch(text):
        raise ControllerError(f"{label} must be lowercase SHA-256")
    return text


def require_id(value: Any, label: str) -> str:
    text = str(value)
    if not ID_RE.fullmatch(text):
        raise ControllerError(f"invalid {label}: {text}")
    return text


def load_json_raw(path: Path) -> tuple[dict[str, Any], bytes]:
    raw = path.read_bytes()
    if raw.startswith(b"\xef\xbb\xbf"):
        raise ControllerError(f"UTF-8 BOM forbidden: {path}")
    if b"\r" in raw:
        raise ControllerError(f"CR bytes forbidden in sealed input: {path}")
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ControllerError(f"invalid UTF-8 JSON: {path}") from exc
    if not isinstance(value, dict):
        raise ControllerError(f"JSON root must be object: {path}")
    return value, raw


def validate_artifact_envelope(path: Path, payload: dict[str, Any], task: dict[str, Any]) -> None:
    value, _ = load_json_raw(path)
    exact_keys(value, {
        "schema", "sourceId", "taskId", "observedAt", "knownAt", "licenseDisposition",
        "accountTier", "semantics", "supportedCriteria", "outcomesAccessed", "rawInputs", "content",
    }, "artifact envelope")
    if value["schema"] != "early-detection-free-source-artifact/v1":
        raise ControllerError("artifact envelope schema changed")
    if value["sourceId"] != task["sourceId"] or value["taskId"] != task["taskId"]:
        raise ControllerError("artifact envelope task/source mismatch")
    if value["observedAt"] != payload["observedAt"] or value["knownAt"] != payload["knownAt"]:
        raise ControllerError("artifact envelope time mismatch")
    if value["licenseDisposition"] != payload["licenseDisposition"] or value["accountTier"] != payload["accountTier"]:
        raise ControllerError("artifact envelope license/account mismatch")
    if value["outcomesAccessed"] is not False:
        raise ControllerError("artifact envelope opened outcomes")
    if value["semantics"] != [payload["semantic"]]:
        raise ControllerError("artifact envelope semantic mismatch")
    if sorted(set(value["supportedCriteria"])) != payload["supportedCriteria"]:
        raise ControllerError("artifact envelope criteria mismatch")
    if not isinstance(value["rawInputs"], list):
        raise ControllerError("artifact rawInputs must be an array")
    for index, source in enumerate(value["rawInputs"]):
        exact_keys(source, {"url", "retrievedAt", "rawSha256", "bytes", "status"}, f"rawInput[{index}]")
        if not str(source["url"]).startswith("https://"):
            raise ControllerError("artifact raw input URL must use HTTPS")
        parse_z(source["retrievedAt"], f"rawInput[{index}].retrievedAt")
        require_sha(source["rawSha256"], f"rawInput[{index}].rawSha256")
        if not isinstance(source["bytes"], int) or source["bytes"] < 0:
            raise ControllerError("artifact raw input bytes invalid")


def safe_repo_path(relative: str, *, must_exist: bool = True) -> Path:
    if not relative or "\\" in relative or ":" in relative or relative.startswith("/"):
        raise ControllerError(f"unsafe repo path: {relative}")
    parts = Path(relative).parts
    if any(part in {"", ".", ".."} for part in parts):
        raise ControllerError(f"unsafe repo path: {relative}")
    candidate = (ROOT / Path(*parts)).resolve()
    try:
        candidate.relative_to(ROOT.resolve())
    except ValueError as exc:
        raise ControllerError(f"path escapes repository: {relative}") from exc
    if must_exist and not candidate.is_file():
        raise ControllerError(f"bound file missing: {relative}")
    return candidate


def validate_source(source: dict[str, Any], label: str) -> None:
    exact_keys(source, SOURCE_KEYS, label)
    require_id(source["sourceId"], f"{label}.sourceId")
    if not isinstance(source["priority"], int) or isinstance(source["priority"], bool):
        raise ControllerError(f"{label}.priority must be integer")
    if not isinstance(source["officialUrls"], list) or not source["officialUrls"]:
        raise ControllerError(f"{label}.officialUrls must be nonempty")
    if any(not isinstance(url, str) or not url.startswith("https://") for url in source["officialUrls"]):
        raise ControllerError(f"{label}.officialUrls must be HTTPS")
    access = source["access"]
    exact_keys(access, {
        "state", "freeAccountRequired", "freeApiKeyRequired", "paymentDetailsRequired",
        "browserAllowed", "cloudOnlyPilotAllowed",
    }, f"{label}.access")
    if access["paymentDetailsRequired"] is not False:
        raise ControllerError(f"paid/payment source forbidden: {label}")
    capabilities = source["capabilities"]
    if set(capabilities) != set(CAPABILITIES):
        raise ControllerError(f"{label}.capabilities incomplete")
    if any(value not in CAPABILITY_STATES for value in capabilities.values()):
        raise ControllerError(f"{label}.capabilities has invalid state")


def validate_task(task: dict[str, Any], source_ids: set[str], label: str) -> None:
    exact_keys(task, TASK_KEYS, label)
    require_id(task["taskId"], f"{label}.taskId")
    if task["sourceId"] not in source_ids:
        raise ControllerError(f"{label}.sourceId unknown: {task['sourceId']}")
    if (not isinstance(task["priority"], int) or isinstance(task["priority"], bool)
            or not 0 <= task["priority"] <= 100):
        raise ControllerError(f"{label}.priority must be integer")
    if task["state"] not in TASK_STATES or task["state"] == "CLAIMED":
        raise ControllerError(f"{label}.state invalid for seed")
    for key in ("entryCriteria", "exitCriteria", "abortCriteria"):
        if not isinstance(task[key], list) or not task[key] or any(not isinstance(item, str) for item in task[key]):
            raise ControllerError(f"{label}.{key} must be nonempty string array")
    priority_text = canonical_bytes({
        "priority": task["priority"], "action": task["action"],
        "entryCriteria": task["entryCriteria"], "exitCriteria": task["exitCriteria"],
    }).decode("utf-8").upper()
    for forbidden in FORBIDDEN_PRIORITY_INPUTS:
        if re.search(rf"(?<![A-Z0-9]){re.escape(forbidden)}(?![A-Z0-9])", priority_text):
            raise ControllerError(f"outcome-dependent priority forbidden: {label}")


def validate_contracts() -> dict[str, Any]:
    policy_raw = POLICY_PATH.read_bytes()
    if policy_raw.startswith(b"\xef\xbb\xbf") or b"\r" in policy_raw:
        raise ControllerError("policy bytes must be UTF-8 without BOM and LF-only")

    contract, contract_raw = load_json_raw(CONTRACT_PATH)
    exact_keys(contract, {
        "schema", "studyBoundary", "cellKey", "semantics", "requiredEvidenceFields",
        "cellStatuses", "sourceAuthorityOrder", "forbiddenResolutionMethods",
        "terminalWealthComponents", "completionRule", "outcomesAccessed",
    }, "evidence contract")
    if contract["schema"] != "early-detection-evidence-cell-contract/v1":
        raise ControllerError("evidence contract schema changed")
    exact_keys(contract["studyBoundary"], {
        "originalV4GateCreditRequiresExactSealedSemantics", "originalV4OutcomesLocked",
        "publicAiAppendOnly", "secCikStudyAppendOnly", "humanAttestationByAgentsForbidden",
    }, "evidence contract studyBoundary")
    if contract["studyBoundary"] != {
        "originalV4GateCreditRequiresExactSealedSemantics": True,
        "originalV4OutcomesLocked": True,
        "publicAiAppendOnly": True,
        "secCikStudyAppendOnly": True,
        "humanAttestationByAgentsForbidden": True,
    }:
        raise ControllerError("evidence contract study boundary changed")
    if contract["cellKey"] != ["entityId", "securityId", "listingId", "evaluationDate", "semantic"]:
        raise ControllerError("evidence cell key changed")
    if tuple(contract["semantics"]) != CAPABILITIES:
        raise ControllerError("evidence contract semantics changed")
    if set(contract["requiredEvidenceFields"]) != {
        "sourceId", "sourceRecordId", "sourceUrl", "retrievedAt", "knownAt", "validFrom",
        "validTo", "eventDates", "entityId", "securityId", "listingId", "cik", "figi",
        "permId", "exchangeMic", "rawSha256", "termsSnapshotSha256", "accountTier",
        "licenseDisposition", "conflictGroup", "status",
    }:
        raise ControllerError("required evidence fields changed")
    if contract["cellStatuses"] != [
        "QUARANTINE_EVIDENCE", "UNRESOLVED", "CONFLICT", "NOT_APPLICABLE_PROVEN", "RESOLVED",
    ]:
        raise ControllerError("evidence cell statuses changed")
    if contract["sourceAuthorityOrder"] != [
        "PRIMARY_EXCHANGE_REGULATOR_TRANSACTION_DOCUMENT", "CONSOLIDATED_SIP_OR_SECURITY_MASTER",
        "VENDOR_CORPORATE_ACTION", "ARCHIVE_COPY", "COMMUNITY_MIRROR",
    ]:
        raise ControllerError("source authority order changed")
    if set(contract["forbiddenResolutionMethods"]) != {
        "TICKER_ONLY_JOIN", "SOURCE_MAJORITY_VOTE", "CHART_PIXEL_INFERENCE",
        "NOT_FOUND_AS_COMPLETE", "CURRENT_SYMBOL_BACKFILL", "POST_OUTCOME_REPLACEMENT",
    }:
        raise ControllerError("forbidden evidence-resolution methods changed")
    if set(contract["terminalWealthComponents"]) != {
        "LAST_CONSOLIDATED_SESSION_VALUE", "POST_SESSION_CASH_CONSIDERATION",
        "STOCK_CONSIDERATION", "LIQUIDATION_DISTRIBUTIONS", "BANKRUPTCY_RECOVERIES",
        "OTC_CONTINUATION_VALUE",
    }:
        raise ControllerError("terminal-wealth components changed")
    exact_keys(contract["completionRule"], {
        "unresolvedTargetCells", "notApplicableRequiresAuthorityEvidence",
        "independentRebuildsRequired", "identicalRowSetsRequired", "identicalHashesRequired",
        "lawfulStorageAndInternalAnalysisRequired",
    }, "evidence contract completionRule")
    if contract["completionRule"] != {
        "unresolvedTargetCells": 0,
        "notApplicableRequiresAuthorityEvidence": True,
        "independentRebuildsRequired": 2,
        "identicalRowSetsRequired": True,
        "identicalHashesRequired": True,
        "lawfulStorageAndInternalAnalysisRequired": True,
    }:
        raise ControllerError("evidence completion rule changed")
    if contract["outcomesAccessed"] is not False:
        raise ControllerError("evidence contract opened outcomes")

    registry, registry_raw = load_json_raw(REGISTRY_PATH)
    exact_keys(registry, {
        "schema", "createdAt", "appendOnly", "costPolicy", "capabilityKeys", "sources",
        "outcomesAccessed",
    }, "source registry")
    if registry["schema"] != "early-detection-continuous-free-source-registry/v1":
        raise ControllerError("source registry schema changed")
    if registry["appendOnly"] is not True or registry["outcomesAccessed"] is not False:
        raise ControllerError("registry locks changed")
    if tuple(registry["capabilityKeys"]) != CAPABILITIES:
        raise ControllerError("registry capability keys changed")
    cost = registry["costPolicy"]
    exact_keys(cost, {
        "mustBeFree", "paymentDetailsAllowed", "trialAllowed",
        "multipleAccountsForLimitEvasionAllowed", "secretsInRepositoryAllowed",
    }, "cost policy")
    if cost != {
        "mustBeFree": True,
        "paymentDetailsAllowed": False,
        "trialAllowed": False,
        "multipleAccountsForLimitEvasionAllowed": False,
        "secretsInRepositoryAllowed": False,
    }:
        raise ControllerError("no-cost policy changed")
    sources = registry["sources"]
    if not isinstance(sources, list) or not sources:
        raise ControllerError("source registry empty")
    source_ids: set[str] = set()
    for index, source in enumerate(sources):
        validate_source(source, f"source[{index}]")
        if source["sourceId"] in source_ids:
            raise ControllerError(f"duplicate sourceId: {source['sourceId']}")
        source_ids.add(source["sourceId"])

    queue, queue_raw = load_json_raw(QUEUE_SEED_PATH)
    exact_keys(queue, {
        "schema", "createdAt", "track", "registryPath", "registryRawSha256", "policyPath",
        "policyRawSha256", "evidenceContractPath", "evidenceContractRawSha256",
        "priorityPolicy", "forbiddenPriorityInputs", "taskStates", "handshakeCases", "tasks",
        "outcomesAccessed",
    }, "queue seed")
    if queue["schema"] != "early-detection-continuous-free-source-queue-seed/v1":
        raise ControllerError("queue schema changed")
    if queue["track"] != "SHARED_OUTCOME_BLIND_INFRASTRUCTURE" or queue["outcomesAccessed"] is not False:
        raise ControllerError("queue outcome boundary changed")
    bindings = (
        (queue["registryPath"], queue["registryRawSha256"], REGISTRY_PATH, registry_raw),
        (queue["policyPath"], queue["policyRawSha256"], POLICY_PATH, policy_raw),
        (queue["evidenceContractPath"], queue["evidenceContractRawSha256"], CONTRACT_PATH, contract_raw),
    )
    for relative, expected_sha, expected_path, raw in bindings:
        bound = safe_repo_path(str(relative))
        if bound != expected_path.resolve() or require_sha(expected_sha, f"binding {relative}") != raw_sha256_bytes(raw):
            raise ControllerError(f"queue input binding changed: {relative}")
    if set(queue["taskStates"]) != TASK_STATES:
        raise ControllerError("queue task-state enum changed")
    if set(queue["forbiddenPriorityInputs"]) != FORBIDDEN_PRIORITY_INPUTS:
        raise ControllerError("priority outcome locks changed")
    if queue["priorityPolicy"] != [
        "NEW_ORIGINAL_V4_SEMANTIC", "PRIMARY_AUTHORITY", "REPRODUCIBLE_FREE_CAPTURE",
        "TERMINAL_WEALTH_GAP", "IDENTITY_AND_UNIVERSE_GAP", "CROSSCHECK_ONLY",
    ]:
        raise ControllerError("priority policy changed")
    handshakes = queue["handshakeCases"]
    if not isinstance(handshakes, list) or len(handshakes) != 3:
        raise ControllerError("three-case handshake contract changed")
    observed_handshakes: dict[str, dict[str, Any]] = {}
    for index, handshake in enumerate(handshakes):
        exact_keys(handshake, {"caseId", "label", "requiredAssertions"}, f"handshake[{index}]")
        if handshake["caseId"] in observed_handshakes:
            raise ControllerError("duplicate handshake case")
        observed_handshakes[handshake["caseId"]] = handshake
    if set(observed_handshakes) != set(HANDSHAKE_CONTRACT):
        raise ControllerError("handshake case IDs changed")
    for case_id, expected in HANDSHAKE_CONTRACT.items():
        observed = observed_handshakes[case_id]
        if observed["label"] != expected["label"] or set(observed["requiredAssertions"]) != expected["requiredAssertions"]:
            raise ControllerError(f"handshake contract changed: {case_id}")
    task_ids: set[str] = set()
    for index, task in enumerate(queue["tasks"]):
        validate_task(task, source_ids, f"task[{index}]")
        if task["taskId"] in task_ids:
            raise ControllerError(f"duplicate taskId: {task['taskId']}")
        task_ids.add(task["taskId"])

    hypotheses, hypotheses_raw = load_json_raw(HYPOTHESIS_PATH)
    exact_keys(hypotheses, {
        "schema", "createdAt", "track", "generationBoundary", "statuses", "requiredFields",
        "hypotheses",
    }, "hypothesis register")
    if hypotheses["schema"] != "early-detection-hypothesis-register/v1":
        raise ControllerError("hypothesis register schema changed")
    if hypotheses["track"] != "ADDON_PROPOSALS_ONLY":
        raise ControllerError("hypothesis track changed")
    boundary = hypotheses["generationBoundary"]
    exact_keys(boundary, {
        "maximumDevelopmentDate", "reservedOriginalV4Period",
        "reservedPeriodMayBeUsedForIdeaGeneration", "secCikCompletedStudyThresholdOptimizationForbidden",
        "originalV4GateCredit", "humanAttestation", "outcomesAccessed",
    }, "hypothesis generationBoundary")
    if boundary != {
        "maximumDevelopmentDate": "2020-12-31",
        "reservedOriginalV4Period": "2021-01-01/2024-12-31",
        "reservedPeriodMayBeUsedForIdeaGeneration": False,
        "secCikCompletedStudyThresholdOptimizationForbidden": True,
        "originalV4GateCredit": False,
        "humanAttestation": False,
        "outcomesAccessed": False,
    }:
        raise ControllerError("hypothesis generation boundary changed")
    if hypotheses["statuses"] != ["PROPOSAL", "PREREGISTERED", "TESTED", "REJECTED"]:
        raise ControllerError("hypothesis status enum changed")
    required_hypothesis_fields = set(hypotheses["requiredFields"])
    hypothesis_ids: set[str] = set()
    for index, hypothesis in enumerate(hypotheses["hypotheses"]):
        if set(hypothesis) != required_hypothesis_fields:
            raise ControllerError(f"hypothesis[{index}] fields changed")
        require_id(hypothesis["hypothesisId"], f"hypothesis[{index}].hypothesisId")
        if hypothesis["hypothesisId"] in hypothesis_ids:
            raise ControllerError(f"duplicate hypothesisId: {hypothesis['hypothesisId']}")
        hypothesis_ids.add(hypothesis["hypothesisId"])
        if hypothesis["status"] not in hypotheses["statuses"]:
            raise ControllerError(f"invalid hypothesis status: {hypothesis['hypothesisId']}")
        if hypothesis["status"] != "PROPOSAL":
            raise ControllerError("seed register contains non-proposal; preregistration needs a separate sealed protocol")
        if not {"ORIGINAL_V4", "H_LATE", "H_FEM", "CAUSALITY"}.issubset(set(hypothesis["forbiddenClaims"])):
            raise ControllerError(f"hypothesis forbidden claims weakened: {hypothesis['hypothesisId']}")
        if "2021-" in hypothesis["primaryClaim"] or "2022-" in hypothesis["primaryClaim"] or "2023-" in hypothesis["primaryClaim"] or "2024-" in hypothesis["primaryClaim"]:
            raise ControllerError(f"hypothesis claim enters reserved period: {hypothesis['hypothesisId']}")
        if hypothesis["validationPeriod"].split("/")[-1] > "2020-12-31":
            raise ControllerError(f"hypothesis validation enters reserved period: {hypothesis['hypothesisId']}")

    readiness, readiness_raw = load_json_raw(READINESS_PATH)
    if set(readiness.get("gates", {})) != ORIGINAL_GATE_NAMES:
        raise ControllerError("Original-V4 13-gate set changed")
    if any(type(value) is not bool for value in readiness["gates"].values()):
        raise ControllerError("Original-V4 gates must be booleans")
    green = sorted(name for name, value in readiness["gates"].items() if value is True)
    if len(green) < 13 and readiness.get("resultComputationAllowed") is not False:
        raise ControllerError("Original-V4 result lock opened before 13/13")

    raw_bindings = {
        "policy": raw_sha256_bytes(policy_raw),
        "evidenceContract": raw_sha256_bytes(contract_raw),
        "registry": raw_sha256_bytes(registry_raw),
        "queueSeed": raw_sha256_bytes(queue_raw),
        "hypothesisRegister": raw_sha256_bytes(hypotheses_raw),
        "controller": file_sha256(SCRIPT_PATH),
        "controllerTest": file_sha256(TEST_PATH),
    }
    return {
        "registry": registry,
        "queue": queue,
        "hypotheses": hypotheses,
        "readiness": readiness,
        "readinessRawSha256": raw_sha256_bytes(readiness_raw),
        "rawBindings": raw_bindings,
        "inputBundleSha256": canonical_sha256(raw_bindings),
    }


def event_hash(event: dict[str, Any]) -> str:
    return canonical_sha256({key: value for key, value in event.items() if key != "eventSha256"})


def validate_event(event: dict[str, Any], previous: dict[str, Any] | None, input_bundle_sha: str) -> None:
    exact_keys(event, EVENT_KEYS, f"event[{event.get('sequence')}]")
    if event["schema"] != "early-detection-free-source-event/v1":
        raise ControllerError("event schema changed")
    if not isinstance(event["sequence"], int) or event["sequence"] <= 0:
        raise ControllerError("event sequence must be positive integer")
    require_id(event["eventId"], "eventId")
    require_id(event["agentId"], "agentId")
    require_id(event["runId"], "runId")
    created = parse_z(event["createdAt"], "event.createdAt")
    if created > datetime.now(timezone.utc) + timedelta(minutes=5):
        raise ControllerError("future-dated event rejected")
    if event["eventType"] not in EVENT_TYPES:
        raise ControllerError(f"unknown event type: {event['eventType']}")
    if event["inputBundleSha256"] != input_bundle_sha:
        raise ControllerError("event input bundle drift")
    if require_sha(event["eventSha256"], "eventSha256") != event_hash(event):
        raise ControllerError("event self-hash mismatch")
    if previous is None:
        if event["sequence"] != 1 or event["previousEventSha256"] is not None:
            raise ControllerError("genesis event sequence/hash invalid")
        if event["eventType"] != "QUEUE_INITIALIZED":
            raise ControllerError("first event must initialize queue")
        exact_keys(event["payload"], {
            "queueSeedRawSha256", "repositoryRemote", "baseCommit", "controllerRawSha256",
            "controllerTestRawSha256",
        }, "QUEUE_INITIALIZED payload")
    else:
        if event["sequence"] != previous["sequence"] + 1:
            raise ControllerError("event sequence gap or duplicate")
        if event["previousEventSha256"] != previous["eventSha256"]:
            raise ControllerError("event predecessor hash mismatch")
        if parse_z(event["createdAt"], "event.createdAt") < parse_z(previous["createdAt"], "previous.createdAt"):
            raise ControllerError("event time moved backwards")


def read_events(path: Path, input_bundle_sha: str) -> tuple[list[dict[str, Any]], bytes]:
    if not path.is_file():
        raise ControllerError(f"event log missing: {path}")
    raw = path.read_bytes()
    if raw.startswith(b"\xef\xbb\xbf") or b"\r" in raw or (raw and not raw.endswith(b"\n")):
        raise ControllerError("event log must be UTF-8 without BOM, LF-only and newline-terminated")
    events: list[dict[str, Any]] = []
    previous = None
    for line_number, line in enumerate(raw.splitlines(), start=1):
        try:
            value = json.loads(line.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ControllerError(f"invalid event JSON at line {line_number}") from exc
        if not isinstance(value, dict):
            raise ControllerError(f"event line {line_number} must be object")
        validate_event(value, previous, input_bundle_sha)
        events.append(value)
        previous = value
    if not events:
        raise ControllerError("event log empty")
    if len({event["eventId"] for event in events}) != len(events):
        raise ControllerError("duplicate eventId")
    return events, raw


def materialize_state(contracts: dict[str, Any], events: list[dict[str, Any]], events_raw: bytes) -> dict[str, Any]:
    sources = {source["sourceId"]: source for source in contracts["registry"]["sources"]}
    tasks: dict[str, dict[str, Any]] = {}
    for seed in contracts["queue"]["tasks"]:
        tasks[seed["taskId"]] = {
            **seed,
            "fencingToken": 0,
            "claimedByAgentId": None,
            "claimedByRunId": None,
            "leaseExpiresAt": None,
            "lastEventId": None,
            "artifacts": [],
        }
    last_created = None
    for event in events:
        last_created = event["createdAt"]
        event_type = event["eventType"]
        payload = event["payload"]
        task_id = event["taskId"]
        if event_type == "QUEUE_INITIALIZED":
            exact_keys(payload, {
                "queueSeedRawSha256", "repositoryRemote", "baseCommit", "controllerRawSha256",
                "controllerTestRawSha256",
            }, "QUEUE_INITIALIZED payload")
            if payload["queueSeedRawSha256"] != contracts["rawBindings"]["queueSeed"]:
                raise ControllerError("genesis queue seed hash mismatch")
            if payload["repositoryRemote"] != git_text("remote", "get-url", "origin"):
                raise ControllerError("queue genesis remote mismatch")
            if payload["controllerRawSha256"] != contracts["rawBindings"]["controller"]:
                raise ControllerError("queue genesis controller mismatch")
            if payload["controllerTestRawSha256"] != contracts["rawBindings"]["controllerTest"]:
                raise ControllerError("queue genesis controller test mismatch")
            try:
                git_text("cat-file", "-e", f"{payload['baseCommit']}^{{commit}}")
                subprocess.run(
                    ["git", "merge-base", "--is-ancestor", payload["baseCommit"], "@{upstream}"],
                    cwd=ROOT, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                )
            except subprocess.CalledProcessError as exc:
                raise ControllerError("queue genesis base commit is not remote-authorized") from exc
            continue
        if event_type == "SOURCE_DISCOVERED":
            exact_keys(payload, {"source"}, "SOURCE_DISCOVERED payload")
            source = payload["source"]
            validate_source(source, "discovered source")
            if source["sourceId"] in sources:
                if sources[source["sourceId"]] != source:
                    raise ControllerError("sourceId reused with different bytes")
                raise ControllerError("duplicate source discovery")
            sources[source["sourceId"]] = source
            continue
        if event_type == "TASK_ADDED":
            exact_keys(payload, {"task"}, "TASK_ADDED payload")
            task = payload["task"]
            validate_task(task, set(sources), "added task")
            if task["taskId"] in tasks:
                if {key: tasks[task["taskId"]][key] for key in TASK_KEYS} != task:
                    raise ControllerError("taskId reused with different bytes")
                raise ControllerError("duplicate task addition")
            tasks[task["taskId"]] = {
                **task,
                "fencingToken": 0,
                "claimedByAgentId": None,
                "claimedByRunId": None,
                "leaseExpiresAt": None,
                "lastEventId": event["eventId"],
                "artifacts": [],
            }
            continue
        if task_id not in tasks:
            raise ControllerError(f"event references unknown task: {task_id}")
        task = tasks[task_id]
        if event_type == "TASK_CLAIMED":
            exact_keys(payload, {"fromState", "toState", "leaseExpiresAt"}, "TASK_CLAIMED payload")
            if task["state"] != payload["fromState"] or payload["toState"] != "CLAIMED":
                raise ControllerError("claim state mismatch")
            if "CLAIMED" not in ALLOWED_TRANSITIONS[task["state"]]:
                raise ControllerError("task cannot be claimed from current state")
            if event["fencingToken"] != task["fencingToken"] + 1:
                raise ControllerError("claim fencing token not monotonic")
            if parse_z(payload["leaseExpiresAt"], "leaseExpiresAt") <= parse_z(event["createdAt"], "claim.createdAt"):
                raise ControllerError("claim lease is not in the future")
            task.update({
                "state": "CLAIMED",
                "fencingToken": event["fencingToken"],
                "claimedByAgentId": event["agentId"],
                "claimedByRunId": event["runId"],
                "leaseExpiresAt": payload["leaseExpiresAt"],
                "lastEventId": event["eventId"],
            })
        elif event_type == "TASK_TRANSITIONED":
            exact_keys(payload, {"fromState", "toState", "reasonCode", "note"}, "TASK_TRANSITIONED payload")
            if task["state"] != payload["fromState"]:
                raise ControllerError("transition fromState mismatch")
            target = payload["toState"]
            if target not in ALLOWED_TRANSITIONS[task["state"]]:
                raise ControllerError(f"illegal task transition: {task['state']}->{target}")
            if event["fencingToken"] != task["fencingToken"]:
                raise ControllerError("stale/zombie fencing token")
            if task["state"] == "CLAIMED":
                if event["agentId"] != task["claimedByAgentId"] or event["runId"] != task["claimedByRunId"]:
                    raise ControllerError("only the active claim owner/run may transition a claimed task")
                if parse_z(event["createdAt"], "transition.createdAt") > parse_z(task["leaseExpiresAt"], "leaseExpiresAt"):
                    raise ControllerError("task lease expired before transition")
            note_upper = str(payload["note"]).upper()
            if any(re.search(rf"(?<![A-Z0-9]){re.escape(token)}(?![A-Z0-9])", note_upper)
                   for token in FORBIDDEN_PRIORITY_INPUTS):
                raise ControllerError("outcome-sensitive transition note rejected")
            if target == "RESOLVED":
                proven = {criterion for artifact in task["artifacts"] for criterion in artifact["supportedCriteria"]}
                missing = sorted(set(task["exitCriteria"]) - proven)
                if not task["artifacts"] or missing:
                    raise ControllerError(f"RESOLVED requires bound evidence for exit criteria: {missing}")
            task.update({
                "state": target,
                "claimedByAgentId": None if target != "CLAIMED" else task["claimedByAgentId"],
                "claimedByRunId": None if target != "CLAIMED" else task["claimedByRunId"],
                "leaseExpiresAt": None if target != "CLAIMED" else task["leaseExpiresAt"],
                "lastEventId": event["eventId"],
            })
        elif event_type == "ARTIFACT_CAPTURED":
            exact_keys(payload, ARTIFACT_KEYS, "ARTIFACT_CAPTURED payload")
            if task["state"] != "CLAIMED" or event["fencingToken"] != task["fencingToken"]:
                raise ControllerError("artifact supplied by unclaimed or zombie task")
            if event["agentId"] != task["claimedByAgentId"] or event["runId"] != task["claimedByRunId"]:
                raise ControllerError("only the active claim owner/run may capture an artifact")
            if parse_z(event["createdAt"], "artifact event.createdAt") > parse_z(task["leaseExpiresAt"], "leaseExpiresAt"):
                raise ControllerError("task lease expired before artifact capture")
            artifact_path = safe_repo_path(payload["path"])
            if payload["outcomesAccessed"] is not False:
                raise ControllerError("pre-outcome source artifact accessed outcomes")
            parse_z(payload["observedAt"], "artifact.observedAt")
            parse_z(payload["knownAt"], "artifact.knownAt")
            if payload["sourceId"] != task["sourceId"]:
                raise ControllerError("artifact source/task mismatch")
            if payload["artifactClass"] not in ARTIFACT_CLASSES:
                raise ControllerError("invalid artifact class")
            if payload["licenseDisposition"] not in LICENSE_DISPOSITIONS:
                raise ControllerError("invalid artifact license disposition")
            if payload["semantic"] not in CAPABILITIES:
                raise ControllerError("artifact semantic changed")
            if payload["cellKey"] is not None:
                if not isinstance(payload["cellKey"], dict) or set(payload["cellKey"]) != {
                    "entityId", "securityId", "listingId", "evaluationDate", "semantic",
                }:
                    raise ControllerError("artifact cell key invalid")
                if payload["cellKey"]["semantic"] != payload["semantic"]:
                    raise ControllerError("artifact cell semantic mismatch")
            if (not isinstance(payload["supportedCriteria"], list) or not payload["supportedCriteria"]
                    or not set(payload["supportedCriteria"]).issubset(set(task["exitCriteria"]))):
                raise ControllerError("artifact supportedCriteria must prove declared exit criteria")
            if artifact_path.stat().st_size != payload["bytes"] or file_sha256(artifact_path) != payload["rawSha256"]:
                raise ControllerError("captured artifact byte binding mismatch")
            validate_artifact_envelope(artifact_path, payload, task)
            cas_path = safe_repo_path(payload["casPath"])
            expected_cas = (CAS_ROOT / payload["rawSha256"]).resolve()
            if cas_path != expected_cas or file_sha256(cas_path) != payload["rawSha256"]:
                raise ControllerError("artifact CAS binding mismatch")
            require_sha(payload["gitCommit"], "artifact.gitCommit")
            if payload["gitPath"] != payload["path"]:
                raise ControllerError("artifact git path mismatch")
            git_blob = subprocess.run(
                ["git", "show", f"{payload['gitCommit']}:{payload['gitPath']}"], cwd=ROOT,
                check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            ).stdout
            if raw_sha256_bytes(git_blob) != payload["rawSha256"]:
                raise ControllerError("artifact Git blob binding mismatch")
            artifact = dict(payload)
            key = (artifact["path"], artifact["rawSha256"])
            if any((row["path"], row["rawSha256"]) == key for row in task["artifacts"]):
                raise ControllerError("duplicate artifact capture")
            task["artifacts"].append(artifact)
            task["lastEventId"] = event["eventId"]
        else:
            raise ControllerError(f"unsupported materialization event: {event_type}")

    counts = {state: 0 for state in sorted(TASK_STATES)}
    for task in tasks.values():
        counts[task["state"]] += 1
    readiness = contracts["readiness"]
    original = {
        "protocol": readiness["protocol"],
        "greenOfficialGates": sum(1 for value in readiness["gates"].values() if value is True),
        "officialGateCount": 13,
        "gates": readiness["gates"],
        "readinessRawSha256": contracts["readinessRawSha256"],
        "resultComputationAllowed": bool(readiness.get("resultComputationAllowed")),
        "outcomesAccessed": False,
        "complete": all(value is True for value in readiness["gates"].values()),
    }
    if original["complete"] != (original["greenOfficialGates"] == 13):
        raise ControllerError("Original-V4 completion arithmetic mismatch")
    state: dict[str, Any] = {
        "schema": "early-detection-free-source-materialized-state/v1",
        "materializedAt": last_created,
        "inputBundleSha256": contracts["inputBundleSha256"],
        "inputRawSha256": contracts["rawBindings"],
        "eventLogRawSha256": raw_sha256_bytes(events_raw),
        "eventCount": len(events),
        "lastEventSha256": events[-1]["eventSha256"],
        "queueAnchor": {
            "repositoryRemote": events[0]["payload"]["repositoryRemote"],
            "baseCommit": events[0]["payload"]["baseCommit"],
            "controllerRawSha256": events[0]["payload"]["controllerRawSha256"],
            "controllerTestRawSha256": events[0]["payload"]["controllerTestRawSha256"],
        },
        "sources": [sources[key] for key in sorted(sources)],
        "tasks": [tasks[key] for key in sorted(tasks)],
        "taskCounts": counts,
        "originalV4": original,
        "lockedStudies": [
            {
                "studyId": "PUBLIC-AI-COVERAGE-2009-2014",
                "status": "LOCKED_APPEND_ONLY",
                "appendOnly": True,
                "originalV4GateCredit": False,
            },
            {
                "studyId": "SEC-CIK-GROWTH-PERSISTENCE@1.0.0",
                "status": "LOCKED_APPEND_ONLY",
                "appendOnly": True,
                "originalV4GateCredit": False,
            },
        ],
        "resultComputationAllowed": False,
        "outcomesAccessed": False,
        "stateSha256": None,
    }
    state["stateSha256"] = canonical_sha256({key: value for key, value in state.items() if key != "stateSha256"})
    return state


def pretty_json_bytes(value: dict[str, Any]) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def atomic_write_new_or_replace(path: Path, raw: bytes, *, require_new: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if require_new and path.exists():
        raise ControllerError(f"refusing to overwrite existing file: {path}")
    descriptor, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temp_path = Path(temp_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        if require_new:
            try:
                os.link(temp_path, path)
            except FileExistsError as exc:
                raise ControllerError(f"target appeared during write: {path}") from exc
        else:
            os.replace(temp_path, path)
    finally:
        if temp_path.exists():
            temp_path.unlink()


@contextmanager
def exclusive_lock() -> Iterator[None]:
    STATE_ROOT.mkdir(parents=True, exist_ok=True)
    descriptor = None
    try:
        descriptor = os.open(LOCK_PATH, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        try:
            lock = LOCK_PATH.read_text(encoding="ascii")
            match = re.fullmatch(r"pid=(\d+) createdAt=([^\n]+)\n", lock)
            if not match:
                raise ControllerError("malformed controller lock")
            pid = int(match.group(1))
            created = parse_z(match.group(2), "lock.createdAt")
            age = datetime.now(timezone.utc) - created
            running = True
            try:
                os.kill(pid, 0)
            except OSError:
                running = False
            if running or age <= timedelta(minutes=10):
                raise ControllerError("continuous-source controller already has a live writer lock")
            LOCK_PATH.unlink()
            descriptor = os.open(LOCK_PATH, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except ControllerError:
            raise
        except Exception as exc:
            raise ControllerError("continuous-source controller lock recovery failed") from exc
    try:
        assert descriptor is not None
        os.write(descriptor, f"pid={os.getpid()} createdAt={utc_now()}\n".encode("ascii"))
        os.fsync(descriptor)
        os.close(descriptor)
        yield
    finally:
        try:
            os.close(descriptor)
        except OSError:
            pass
        if LOCK_PATH.exists():
            LOCK_PATH.unlink()


def make_event(
    *, sequence: int, previous_sha: str | None, created_at: str, agent_id: str, run_id: str,
    task_id: str | None, event_type: str, fencing_token: int, input_bundle_sha: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    event = {
        "schema": "early-detection-free-source-event/v1",
        "sequence": sequence,
        "eventId": f"EVT-{sequence:08d}",
        "previousEventSha256": previous_sha,
        "createdAt": created_at,
        "agentId": require_id(agent_id, "agentId"),
        "runId": require_id(run_id, "runId"),
        "taskId": task_id,
        "eventType": event_type,
        "fencingToken": fencing_token,
        "inputBundleSha256": input_bundle_sha,
        "payload": payload,
        "eventSha256": None,
    }
    event["eventSha256"] = event_hash(event)
    return event


def append_event_and_state(
    events_path: Path, state_path: Path, contracts: dict[str, Any], event: dict[str, Any],
    expected_head: str,
) -> dict[str, Any]:
    events, old_raw = read_events(events_path, contracts["inputBundleSha256"])
    if events[-1]["eventSha256"] != expected_head:
        raise ControllerError("queue head changed; compare-and-swap rejected")
    validate_event(event, events[-1], contracts["inputBundleSha256"])
    new_raw = old_raw + canonical_bytes(event) + b"\n"
    new_events = events + [event]
    new_state = materialize_state(contracts, new_events, new_raw)
    atomic_write_new_or_replace(events_path, new_raw, require_new=False)
    try:
        atomic_write_new_or_replace(state_path, pretty_json_bytes(new_state), require_new=False)
    except Exception:
        # The event log is authoritative; verify/replay will deterministically heal state.
        raise
    return new_state


def command_init(args: argparse.Namespace) -> dict[str, Any]:
    contracts = validate_contracts()
    events_path, state_path = validate_state_paths(Path(args.events), Path(args.state))
    with exclusive_lock():
        if events_path.exists() or state_path.exists():
            raise ControllerError("init is write-new and refuses existing event/state files")
        created_at = utc_now()
        event = make_event(
            sequence=1,
            previous_sha=None,
            created_at=created_at,
            agent_id=args.agent_id,
            run_id=args.run_id,
            task_id=None,
            event_type="QUEUE_INITIALIZED",
            fencing_token=0,
            input_bundle_sha=contracts["inputBundleSha256"],
            payload={
                "queueSeedRawSha256": contracts["rawBindings"]["queueSeed"],
                "repositoryRemote": git_text("remote", "get-url", "origin"),
                "baseCommit": git_text("rev-parse", "HEAD"),
                "controllerRawSha256": contracts["rawBindings"]["controller"],
                "controllerTestRawSha256": contracts["rawBindings"]["controllerTest"],
            },
        )
        raw = canonical_bytes(event) + b"\n"
        state = materialize_state(contracts, [event], raw)
        atomic_write_new_or_replace(events_path, raw, require_new=True)
        atomic_write_new_or_replace(state_path, pretty_json_bytes(state), require_new=True)
    return {
        "status": "PASS",
        "eventCount": 1,
        "lastEventSha256": event["eventSha256"],
        "stateSha256": state["stateSha256"],
        "tasks": len(state["tasks"]),
        "ready": state["taskCounts"]["READY"],
        "userActionRequired": state["taskCounts"]["USER_ACTION_REQUIRED"],
        "originalV4GreenGates": state["originalV4"]["greenOfficialGates"],
        "outcomesAccessed": False,
    }


def verify_current(
    events_path: Path, state_path: Path, *, heal: bool = False, synthetic_fixture: bool = False,
) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    if not synthetic_fixture:
        events_path, state_path = validate_state_paths(events_path, state_path)
    else:
        events_path, state_path = events_path.resolve(), state_path.resolve()
        if events_path == state_path:
            raise ControllerError("events and state paths must differ")
    contracts = validate_contracts()
    events, raw = read_events(events_path, contracts["inputBundleSha256"])
    expected = materialize_state(contracts, events, raw)
    if not state_path.is_file():
        if not heal:
            raise ControllerError("materialized state missing")
        atomic_write_new_or_replace(state_path, pretty_json_bytes(expected), require_new=True)
    observed, observed_raw = load_json_raw(state_path)
    if require_sha(observed.get("stateSha256"), "stateSha256") != canonical_sha256(
        {key: value for key, value in observed.items() if key != "stateSha256"}
    ):
        raise ControllerError("materialized state self-hash mismatch")
    if observed != expected or observed_raw != pretty_json_bytes(expected):
        if not heal:
            raise ControllerError("materialized state differs from deterministic event replay")
        observed_readiness = observed.get("originalV4", {}).get("readinessRawSha256")
        if observed_readiness != contracts["readinessRawSha256"]:
            raise ControllerError("readiness changed; create a separately versioned readiness event/controller revision")
        atomic_write_new_or_replace(state_path, pretty_json_bytes(expected), require_new=False)
        observed = expected
    return contracts, events, observed


def command_verify(args: argparse.Namespace) -> dict[str, Any]:
    if args.heal:
        with exclusive_lock():
            contracts, events, state = verify_current(Path(args.events), Path(args.state), heal=True)
    else:
        contracts, events, state = verify_current(Path(args.events), Path(args.state), heal=False)
    return {
        "status": "PASS",
        "inputBundleSha256": contracts["inputBundleSha256"],
        "eventCount": len(events),
        "lastEventSha256": events[-1]["eventSha256"],
        "stateSha256": state["stateSha256"],
        "tasks": len(state["tasks"]),
        "taskCounts": state["taskCounts"],
        "originalV4GreenGates": state["originalV4"]["greenOfficialGates"],
        "originalV4Complete": state["originalV4"]["complete"],
        "outcomesAccessed": state["outcomesAccessed"],
    }


def command_next(args: argparse.Namespace) -> dict[str, Any]:
    _, events, state = verify_current(Path(args.events).resolve(), Path(args.state).resolve())
    ready = [task for task in state["tasks"] if task["state"] == "READY"]
    ready.sort(key=lambda task: (-task["priority"], task["taskId"]))
    return {
        "status": "PASS",
        "lastEventSha256": events[-1]["eventSha256"],
        "nextTask": ready[0] if ready else None,
        "readyTasks": len(ready),
        "outcomesAccessed": False,
    }


def command_claim(args: argparse.Namespace) -> dict[str, Any]:
    events_path, state_path = validate_state_paths(Path(args.events), Path(args.state))
    with exclusive_lock():
        contracts, events, state = verify_current(events_path, state_path)
        task = next((row for row in state["tasks"] if row["taskId"] == args.task_id), None)
        if task is None or task["state"] != "READY":
            raise ControllerError("task is not READY")
        if not entry_criteria_satisfied(contracts, task):
            raise ControllerError("task entry criteria are not satisfied")
        created_at = utc_now()
        lease = (parse_z(created_at, "createdAt") + timedelta(minutes=args.lease_minutes)).strftime("%Y-%m-%dT%H:%M:%SZ")
        event = make_event(
            sequence=len(events) + 1,
            previous_sha=events[-1]["eventSha256"],
            created_at=created_at,
            agent_id=args.agent_id,
            run_id=args.run_id,
            task_id=args.task_id,
            event_type="TASK_CLAIMED",
            fencing_token=task["fencingToken"] + 1,
            input_bundle_sha=contracts["inputBundleSha256"],
            payload={"fromState": "READY", "toState": "CLAIMED", "leaseExpiresAt": lease},
        )
        new_state = append_event_and_state(events_path, state_path, contracts, event, args.expected_head)
    claimed = next(row for row in new_state["tasks"] if row["taskId"] == args.task_id)
    return {"status": "PASS", "lastEventSha256": event["eventSha256"], "task": claimed, "outcomesAccessed": False}


def command_transition(args: argparse.Namespace) -> dict[str, Any]:
    events_path, state_path = validate_state_paths(Path(args.events), Path(args.state))
    with exclusive_lock():
        contracts, events, state = verify_current(events_path, state_path)
        task = next((row for row in state["tasks"] if row["taskId"] == args.task_id), None)
        if task is None:
            raise ControllerError("unknown task")
        if args.to_state not in TASK_STATES:
            raise ControllerError("unknown target state")
        event = make_event(
            sequence=len(events) + 1,
            previous_sha=events[-1]["eventSha256"],
            created_at=utc_now(),
            agent_id=args.agent_id,
            run_id=args.run_id,
            task_id=args.task_id,
            event_type="TASK_TRANSITIONED",
            fencing_token=args.fencing_token,
            input_bundle_sha=contracts["inputBundleSha256"],
            payload={
                "fromState": task["state"],
                "toState": args.to_state,
                "reasonCode": require_id(args.reason_code, "reasonCode"),
                "note": args.note,
            },
        )
        new_state = append_event_and_state(events_path, state_path, contracts, event, args.expected_head)
    changed = next(row for row in new_state["tasks"] if row["taskId"] == args.task_id)
    return {"status": "PASS", "lastEventSha256": event["eventSha256"], "task": changed, "outcomesAccessed": False}


def command_capture(args: argparse.Namespace) -> dict[str, Any]:
    events_path, state_path = validate_state_paths(Path(args.events), Path(args.state))
    artifact_path = safe_repo_path(args.path)
    raw_sha = file_sha256(artifact_path)
    cas_path = CAS_ROOT / raw_sha
    with exclusive_lock():
        contracts, events, state = verify_current(events_path, state_path)
        task = next((row for row in state["tasks"] if row["taskId"] == args.task_id), None)
        if task is None or task["state"] != "CLAIMED":
            raise ControllerError("task is not CLAIMED")
        if not cas_path.exists():
            atomic_write_new_or_replace(cas_path, artifact_path.read_bytes(), require_new=True)
        elif file_sha256(cas_path) != raw_sha:
            raise ControllerError("existing CAS object is corrupt")
        git_commit = git_text("rev-parse", args.git_commit)
        git_path = artifact_path.relative_to(ROOT).as_posix()
        if raw_sha256_bytes(git_bytes("show", f"{git_commit}:{git_path}")) != raw_sha:
            raise ControllerError("artifact bytes are not bound at the requested Git commit")
        event = make_event(
            sequence=len(events) + 1,
            previous_sha=events[-1]["eventSha256"],
            created_at=utc_now(),
            agent_id=args.agent_id,
            run_id=args.run_id,
            task_id=args.task_id,
            event_type="ARTIFACT_CAPTURED",
            fencing_token=args.fencing_token,
            input_bundle_sha=contracts["inputBundleSha256"],
            payload={
                "artifactClass": args.artifact_class,
                "path": git_path,
                "rawSha256": raw_sha,
                "bytes": artifact_path.stat().st_size,
                "mediaType": args.media_type,
                "observedAt": args.observed_at,
                "knownAt": args.known_at,
                "outcomesAccessed": False,
                "sourceId": task["sourceId"],
                "licenseDisposition": args.license_disposition,
                "accountTier": args.account_tier,
                "semantic": args.semantic,
                "cellKey": None,
                "supportedCriteria": sorted(set(args.supports)),
                "casPath": cas_path.relative_to(ROOT).as_posix(),
                "gitCommit": git_commit,
                "gitPath": git_path,
            },
        )
        new_state = append_event_and_state(events_path, state_path, contracts, event, args.expected_head)
    changed = next(row for row in new_state["tasks"] if row["taskId"] == args.task_id)
    return {"status": "PASS", "lastEventSha256": event["eventSha256"], "task": changed, "outcomesAccessed": False}


def self_test() -> dict[str, Any]:
    contracts = validate_contracts()
    with tempfile.TemporaryDirectory() as temp_name:
        temp = Path(temp_name)
        events_path = temp / "events.jsonl"
        state_path = temp / "state.json"
        init_args = argparse.Namespace(
            events=str(events_path), state=str(state_path), agent_id="SELF-TEST-AGENT", run_id="SELF-TEST-RUN",
        )
        # Avoid the global lock in the synthetic fixture while exercising identical bytes.
        created_at = "2026-01-01T00:00:00Z"
        genesis = make_event(
            sequence=1, previous_sha=None, created_at=created_at, agent_id=init_args.agent_id,
            run_id=init_args.run_id, task_id=None, event_type="QUEUE_INITIALIZED", fencing_token=0,
            input_bundle_sha=contracts["inputBundleSha256"],
            payload={
                "queueSeedRawSha256": contracts["rawBindings"]["queueSeed"],
                "repositoryRemote": git_text("remote", "get-url", "origin"),
                "baseCommit": git_text("rev-parse", "HEAD"),
                "controllerRawSha256": contracts["rawBindings"]["controller"],
                "controllerTestRawSha256": contracts["rawBindings"]["controllerTest"],
            },
        )
        raw = canonical_bytes(genesis) + b"\n"
        state = materialize_state(contracts, [genesis], raw)
        events_path.write_bytes(raw)
        state_path.write_bytes(pretty_json_bytes(state))
        _, events, verified = verify_current(events_path, state_path, synthetic_fixture=True)
        task = next(row for row in verified["tasks"] if row["state"] == "READY")
        claim = make_event(
            sequence=2, previous_sha=events[-1]["eventSha256"], created_at="2026-01-01T00:01:00Z",
            agent_id="SELF-TEST-WORKER-A", run_id="SELF-TEST-CLAIM-A", task_id=task["taskId"],
            event_type="TASK_CLAIMED", fencing_token=1, input_bundle_sha=contracts["inputBundleSha256"],
            payload={"fromState": "READY", "toState": "CLAIMED", "leaseExpiresAt": "2026-01-01T01:01:00Z"},
        )
        raw2 = raw + canonical_bytes(claim) + b"\n"
        state2 = materialize_state(contracts, [genesis, claim], raw2)
        events_path.write_bytes(raw2)
        state_path.write_bytes(pretty_json_bytes(state2))
        release = make_event(
            sequence=3, previous_sha=claim["eventSha256"], created_at="2026-01-01T00:02:00Z",
            agent_id="SELF-TEST-WORKER-A", run_id="SELF-TEST-CLAIM-A", task_id=task["taskId"],
            event_type="TASK_TRANSITIONED", fencing_token=1, input_bundle_sha=contracts["inputBundleSha256"],
            payload={"fromState": "CLAIMED", "toState": "READY", "reasonCode": "SAFE-RETRY", "note": "fixture"},
        )
        raw3 = raw2 + canonical_bytes(release) + b"\n"
        state3 = materialize_state(contracts, [genesis, claim, release], raw3)
        reclaim = make_event(
            sequence=4, previous_sha=release["eventSha256"], created_at="2026-01-01T00:03:00Z",
            agent_id="SELF-TEST-WORKER-B", run_id="SELF-TEST-CLAIM-B", task_id=task["taskId"],
            event_type="TASK_CLAIMED", fencing_token=2, input_bundle_sha=contracts["inputBundleSha256"],
            payload={"fromState": "READY", "toState": "CLAIMED", "leaseExpiresAt": "2026-01-01T01:03:00Z"},
        )
        raw4 = raw3 + canonical_bytes(reclaim) + b"\n"
        state4 = materialize_state(contracts, [genesis, claim, release, reclaim], raw4)
        stale = make_event(
            sequence=5, previous_sha=reclaim["eventSha256"], created_at="2026-01-01T00:04:00Z",
            agent_id="SELF-TEST-WORKER-A", run_id="SELF-TEST-ZOMBIE", task_id=task["taskId"],
            event_type="TASK_TRANSITIONED", fencing_token=1, input_bundle_sha=contracts["inputBundleSha256"],
            payload={"fromState": "CLAIMED", "toState": "RESOLVED", "reasonCode": "STALE-RESULT", "note": "fixture"},
        )
        stale_rejected = False
        try:
            materialize_state(contracts, [genesis, claim, release, reclaim, stale], raw4 + canonical_bytes(stale) + b"\n")
        except ControllerError:
            stale_rejected = True

        cross_agent = make_event(
            sequence=5, previous_sha=reclaim["eventSha256"], created_at="2026-01-01T00:04:00Z",
            agent_id="SELF-TEST-WORKER-C", run_id="SELF-TEST-CLAIM-B", task_id=task["taskId"],
            event_type="TASK_TRANSITIONED", fencing_token=2, input_bundle_sha=contracts["inputBundleSha256"],
            payload={"fromState": "CLAIMED", "toState": "RESOLVED", "reasonCode": "FALSE-PASS", "note": "fixture"},
        )
        cross_agent_rejected = False
        try:
            materialize_state(contracts, [genesis, claim, release, reclaim, cross_agent], raw4 + canonical_bytes(cross_agent) + b"\n")
        except ControllerError:
            cross_agent_rejected = True

        no_evidence = make_event(
            sequence=5, previous_sha=reclaim["eventSha256"], created_at="2026-01-01T00:04:00Z",
            agent_id="SELF-TEST-WORKER-B", run_id="SELF-TEST-CLAIM-B", task_id=task["taskId"],
            event_type="TASK_TRANSITIONED", fencing_token=2, input_bundle_sha=contracts["inputBundleSha256"],
            payload={"fromState": "CLAIMED", "toState": "RESOLVED", "reasonCode": "FALSE-PASS", "note": "fixture"},
        )
        resolved_without_evidence_rejected = False
        try:
            materialize_state(contracts, [genesis, claim, release, reclaim, no_evidence], raw4 + canonical_bytes(no_evidence) + b"\n")
        except ControllerError:
            resolved_without_evidence_rejected = True

        future = dict(reclaim)
        future["createdAt"] = "2099-01-01T00:00:00Z"
        future["eventSha256"] = event_hash(future)
        future_event_rejected = False
        try:
            validate_event(future, release, contracts["inputBundleSha256"])
        except ControllerError:
            future_event_rejected = True

        priority_task = dict(task)
        priority_task["action"] = "Rank by ENDPOINT_VALUE"
        outcome_priority_rejected = False
        try:
            validate_task(priority_task, {row["sourceId"] for row in contracts["registry"]["sources"]}, "priority-task")
        except ControllerError:
            outcome_priority_rejected = True

        external_state_path_rejected = False
        try:
            validate_state_paths(Path(temp_name) / "outside.jsonl", Path(temp_name) / "outside.json")
        except ControllerError:
            external_state_path_rejected = True

        same_state_path_rejected = False
        try:
            validate_state_paths(DEFAULT_STATE_PATH, DEFAULT_STATE_PATH)
        except ControllerError:
            same_state_path_rejected = True

        broken = dict(reclaim)
        broken["previousEventSha256"] = "0" * 64
        broken["eventSha256"] = event_hash(broken)
        predecessor_rejected = False
        try:
            validate_event(broken, release, contracts["inputBundleSha256"])
        except ControllerError:
            predecessor_rejected = True

        raw_drift_rejected = raw_sha256_bytes(QUEUE_SEED_PATH.read_bytes().replace(b"\n", b"\r\n", 1)) != contracts["rawBindings"]["queueSeed"]

        path_traversal_rejected = False
        try:
            safe_repo_path("../escape.json", must_exist=False)
        except ControllerError:
            path_traversal_rejected = True

        duplicate_task_rejected = False
        duplicate = dict(contracts["queue"]["tasks"][0])
        try:
            validate_task(duplicate, set(source["sourceId"] for source in contracts["registry"]["sources"]), "duplicate")
            if duplicate["taskId"] in {task["taskId"] for task in contracts["queue"]["tasks"]}:
                raise ControllerError("duplicate")
        except ControllerError:
            duplicate_task_rejected = True

        return {
            "status": "PASS",
            "syntheticFixtureOnly": True,
            "inputBundleBound": verified["inputBundleSha256"] == contracts["inputBundleSha256"],
            "eventPredecessorMismatchRejected": predecessor_rejected,
            "rawLineEndingDriftRejected": raw_drift_rejected,
            "pathTraversalRejected": path_traversal_rejected,
            "duplicateTaskRejected": duplicate_task_rejected,
            "zombieFencingTokenRejected": stale_rejected,
            "crossAgentTransitionRejected": cross_agent_rejected,
            "resolvedWithoutEvidenceRejected": resolved_without_evidence_rejected,
            "futureDatedEventRejected": future_event_rejected,
            "outcomeDependentPriorityRejected": outcome_priority_rejected,
            "externalStatePathRejected": external_state_path_rejected,
            "sameEventsAndStatePathRejected": same_state_path_rejected,
            "fencingTokenAdvanced": next(row for row in state4["tasks"] if row["taskId"] == task["taskId"])["fencingToken"] == 2,
            "originalV4CannotBeCompleteAtTwoOfThirteen": verified["originalV4"]["complete"] is False,
            "addOnStudiesLockedAppendOnly": all(row["appendOnly"] for row in verified["lockedStudies"]),
            "outcomesAccessed": False,
        }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    def add_state_paths(target: argparse.ArgumentParser) -> None:
        target.add_argument("--events", default=str(DEFAULT_EVENTS_PATH))
        target.add_argument("--state", default=str(DEFAULT_STATE_PATH))

    init_parser = subparsers.add_parser("init")
    add_state_paths(init_parser)
    init_parser.add_argument("--agent-id", required=True)
    init_parser.add_argument("--run-id", required=True)

    verify_parser = subparsers.add_parser("verify")
    add_state_paths(verify_parser)
    verify_parser.add_argument("--heal", action="store_true")

    next_parser = subparsers.add_parser("next")
    add_state_paths(next_parser)

    claim_parser = subparsers.add_parser("claim")
    add_state_paths(claim_parser)
    claim_parser.add_argument("--task-id", required=True)
    claim_parser.add_argument("--agent-id", required=True)
    claim_parser.add_argument("--run-id", required=True)
    claim_parser.add_argument("--expected-head", required=True)
    claim_parser.add_argument("--lease-minutes", type=int, default=60)

    transition_parser = subparsers.add_parser("transition")
    add_state_paths(transition_parser)
    transition_parser.add_argument("--task-id", required=True)
    transition_parser.add_argument("--to-state", required=True)
    transition_parser.add_argument("--reason-code", required=True)
    transition_parser.add_argument("--note", default="")
    transition_parser.add_argument("--agent-id", required=True)
    transition_parser.add_argument("--run-id", required=True)
    transition_parser.add_argument("--expected-head", required=True)
    transition_parser.add_argument("--fencing-token", type=int, required=True)

    capture_parser = subparsers.add_parser("capture")
    add_state_paths(capture_parser)
    capture_parser.add_argument("--task-id", required=True)
    capture_parser.add_argument("--path", required=True)
    capture_parser.add_argument("--artifact-class", required=True, choices=sorted(ARTIFACT_CLASSES))
    capture_parser.add_argument("--media-type", default="application/json")
    capture_parser.add_argument("--observed-at", required=True)
    capture_parser.add_argument("--known-at", required=True)
    capture_parser.add_argument("--license-disposition", required=True, choices=sorted(LICENSE_DISPOSITIONS))
    capture_parser.add_argument("--account-tier", required=True)
    capture_parser.add_argument("--semantic", required=True, choices=CAPABILITIES)
    capture_parser.add_argument("--supports", action="append", required=True)
    capture_parser.add_argument("--git-commit", required=True)
    capture_parser.add_argument("--agent-id", required=True)
    capture_parser.add_argument("--run-id", required=True)
    capture_parser.add_argument("--expected-head", required=True)
    capture_parser.add_argument("--fencing-token", type=int, required=True)

    subparsers.add_parser("self-test")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        if args.command == "init":
            result = command_init(args)
        elif args.command == "verify":
            result = command_verify(args)
        elif args.command == "next":
            result = command_next(args)
        elif args.command == "claim":
            result = command_claim(args)
        elif args.command == "transition":
            result = command_transition(args)
        elif args.command == "capture":
            result = command_capture(args)
        elif args.command == "self-test":
            result = self_test()
        else:
            raise ControllerError(f"unsupported command: {args.command}")
    except ControllerError as exc:
        parser.error(str(exc))
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
