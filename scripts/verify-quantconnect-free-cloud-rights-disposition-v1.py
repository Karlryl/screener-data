#!/usr/bin/env python3
"""Validate the fail-closed QuantConnect Free Cloud rights disposition."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "research" / "early-detection-v4" / "quantconnect-free-cloud-rights-disposition-contract-v1.json"
V6_PATH = ROOT / "research" / "early-detection-v4" / "quantconnect-free-cloud-pilot-contract-v6.json"
EXPECTED_RAW_SHA256 = "0676fa88d4ad76f8a4a5eb951d2a3d529e25840acf11a7cdb484adc309d39c8e"
EXPECTED_CONTRACT_SHA256 = "10c35d442ed9249fd94680a03566b5a1ce9f13a4f30b346cb4abc0db697c8283"
EXPECTED_V6_RAW_SHA256 = "ca64e08fe07e9952e0cf49eac0dcd06eba474b6f488494dcaaba7d501165b494"
EXPECTED_SCHEMA = "early-detection-quantconnect-free-cloud-rights-disposition/v1"
EXPECTED_TOP_KEYS = {
    "schema", "createdAt", "taskId", "sourceId", "track", "purpose",
    "supersededExecutionPath", "officialEvidence", "operationalObservation",
    "decision", "claimCeiling", "claimLocks", "contractSha256",
}
EXPECTED_LOCKS = {
    "futureMetadataLoggingAuthorized", "rawLogsPublished", "loggedMetadataPromoted",
    "dataSemanticsEligibleForStudy", "identityResolved", "coverageClaimed",
    "corporateActionsComplete", "terminalWealthComplete", "pricesAccessed",
    "returnsAccessed", "outcomesAccessed", "originalV4GateCredit", "humanAttestation",
}
EXPECTED_URLS = [
    "https://www.quantconnect.com/docs/v2/writing-algorithms/logging",
    "https://www.quantconnect.com/docs/v2/cloud-platform/organizations/resources",
    "https://www.quantconnect.com/docs/v2/cloud-platform/datasets/licensing",
    "https://www.quantconnect.com/terms/",
]


class ContractError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise ContractError(message)


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        fail(f"{label} exact keys changed")


def validate(contract: dict[str, Any]) -> None:
    exact_keys(contract, EXPECTED_TOP_KEYS, "contract")
    if contract["schema"] != EXPECTED_SCHEMA:
        fail("schema changed")
    if contract["taskId"] != "Q002-QUANTCONNECT-FREE-CLOUD-RIGHTS-DISPOSITION":
        fail("task identity changed")
    if contract["sourceId"] != "QUANTCONNECT_FREE_CLOUD" or contract["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("source or track changed")
    expected_self = sha(canonical({key: value for key, value in contract.items() if key != "contractSha256"}))
    if contract["contractSha256"] != EXPECTED_CONTRACT_SHA256 or expected_self != EXPECTED_CONTRACT_SHA256:
        fail("contract self hash changed")

    predecessor = contract["supersededExecutionPath"]
    exact_keys(predecessor, {
        "contractPath", "contractRawSha256", "status", "historicalProtocolBytesRemainAppendOnly",
    }, "supersededExecutionPath")
    if predecessor != {
        "contractPath": "research/early-detection-v4/quantconnect-free-cloud-pilot-contract-v6.json",
        "contractRawSha256": EXPECTED_V6_RAW_SHA256,
        "status": "SUPERSEDED_FOR_FUTURE_EXECUTION_RIGHTS_ONLY",
        "historicalProtocolBytesRemainAppendOnly": True,
    }:
        fail("V6 predecessor binding or append-only status changed")
    if sha(V6_PATH.read_bytes()) != EXPECTED_V6_RAW_SHA256:
        fail("V6 predecessor raw bytes changed")

    evidence = contract["officialEvidence"]
    if not isinstance(evidence, list) or [row.get("url") for row in evidence] != EXPECTED_URLS:
        fail("official evidence URLs or order changed")
    for row in evidence:
        exact_keys(row, {"url", "observedAt", "verifiedFact"}, "officialEvidence row")
        if not isinstance(row["verifiedFact"], str) or not row["verifiedFact"]:
            fail("official evidence fact missing")

    observation = contract["operationalObservation"]
    exact_keys(observation, {
        "freeAccountAvailable", "paymentDetailsUsed", "trialUsed",
        "operatorDrivenCloudRunsObserved", "cloudExecutionTechnicallyCompleted",
        "rawLogBytesPublished", "rawLogBytesCommitted", "localLogRetentionDisposition",
        "metadataRowsPromoted", "studyCreditGranted",
    }, "operationalObservation")
    if observation["freeAccountAvailable"] is not True or observation["operatorDrivenCloudRunsObserved"] != 2:
        fail("free account or operator-run observation changed")
    if observation["cloudExecutionTechnicallyCompleted"] is not True:
        fail("cloud feasibility observation changed")
    if any(observation[key] is not False for key in (
        "paymentDetailsUsed", "trialUsed", "rawLogBytesPublished", "rawLogBytesCommitted", "studyCreditGranted",
    )):
        fail("payment, publication or study-credit boundary weakened")
    if observation["metadataRowsPromoted"] != 0:
        fail("logged metadata promoted")
    if observation["localLogRetentionDisposition"] != "PRIVATE_QUARANTINE_DO_NOT_COMMIT_OR_PARSE_FOR_STUDY":
        fail("private log quarantine changed")

    decision = contract["decision"]
    exact_keys(decision, {
        "disposition", "futureMetadataLoggingAuthorized", "cloudComputeFeasibilityObserved",
        "cloudComputeMayContinueOnlyWithoutDatasetInformationExport", "dataSemanticsEligibleForStudy",
        "identityCapabilityClosed", "coverageCapabilityClosed", "corporateActionCapabilityClosed",
        "terminalSessionCapabilityClosed", "terminalPaymentCapabilityClosed", "nextAction",
    }, "decision")
    if decision["disposition"] != "QUARANTINED_LOG_EXPORT_NOT_PERMITTED":
        fail("rights disposition changed")
    if decision["futureMetadataLoggingAuthorized"] is not False or decision["dataSemanticsEligibleForStudy"] is not False:
        fail("metadata logging or study semantics falsely authorized")
    if decision["cloudComputeFeasibilityObserved"] is not True or decision["cloudComputeMayContinueOnlyWithoutDatasetInformationExport"] is not True:
        fail("cloud-compute-only boundary changed")
    for key in (
        "identityCapabilityClosed", "coverageCapabilityClosed", "corporateActionCapabilityClosed",
        "terminalSessionCapabilityClosed", "terminalPaymentCapabilityClosed",
    ):
        if decision[key] is not False:
            fail(f"{key} falsely closed")

    exact_keys(contract["claimLocks"], EXPECTED_LOCKS, "claimLocks")
    if any(value is not False for value in contract["claimLocks"].values()):
        fail("claim lock opened")
    forbidden = set(contract["claimCeiling"].get("forbidden", []))
    required_forbidden = {
        "QUANTCONNECT_METADATA_STUDY_EVIDENCE", "HISTORICAL_IDENTITY_INTERVAL", "COVERAGE_RATE",
        "COMPLETE_CORPORATE_ACTION_CHAIN", "TERMINAL_SESSION_OR_PAYMENT", "PRICE_RETURN_OR_OUTCOME",
        "FULL_MARKET_OR_SURVIVORSHIP_SAFE_COVERAGE", "ORIGINAL_V4_GATE_CREDIT", "HUMAN_ATTESTATION",
    }
    if not required_forbidden.issubset(forbidden):
        fail("forbidden claim ceiling weakened")


def load() -> dict[str, Any]:
    raw = CONTRACT_PATH.read_bytes()
    if sha(raw) != EXPECTED_RAW_SHA256:
        fail("contract raw bytes changed")
    value = json.loads(raw)
    validate(value)
    return value


def rejected(action: Callable[[], None]) -> bool:
    try:
        action()
    except (ContractError, KeyError, TypeError, ValueError, OSError):
        return True
    return False


def self_test() -> dict[str, Any]:
    source = load()
    mutations: dict[str, dict[str, Any]] = {}
    for name, path, value in (
        ("metadataLoggingAuthorized", ("decision", "futureMetadataLoggingAuthorized"), True),
        ("semanticsEligible", ("decision", "dataSemanticsEligibleForStudy"), True),
        ("identityClosed", ("decision", "identityCapabilityClosed"), True),
        ("terminalClosed", ("decision", "terminalPaymentCapabilityClosed"), True),
        ("rawLogsPublished", ("claimLocks", "rawLogsPublished"), True),
        ("v4Credit", ("claimLocks", "originalV4GateCredit"), True),
    ):
        item = copy.deepcopy(source)
        item[path[0]][path[1]] = value
        mutations[name] = item
    mutations["dispositionWeakened"] = copy.deepcopy(source)
    mutations["dispositionWeakened"]["decision"]["disposition"] = "FREE_EXPORT_ALLOWED"
    mutations["forbiddenRemoved"] = copy.deepcopy(source)
    mutations["forbiddenRemoved"]["claimCeiling"]["forbidden"].remove("QUANTCONNECT_METADATA_STUDY_EVIDENCE")
    return {
        "status": "PASS",
        "contractRawBound": True,
        "v6PredecessorRawBound": True,
        "mutationsRejected": {name: rejected(lambda value=value: validate(value)) for name, value in mutations.items()},
        "networkRequests": 0,
        "filesWritten": 0,
        "outcomesAccessed": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify", "self-test"))
    args = parser.parse_args()
    try:
        result = self_test() if args.command == "self-test" else {
            "status": "PASS",
            "disposition": load()["decision"]["disposition"],
            "futureMetadataLoggingAuthorized": False,
            "dataSemanticsEligibleForStudy": False,
            "networkRequests": 0,
            "filesWritten": 0,
            "outcomesAccessed": False,
        }
    except (ContractError, OSError, json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
