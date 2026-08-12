#!/usr/bin/env python3
"""Validate the fail-closed OCC Information Memos access disposition."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "research" / "early-detection-v4" / "occ-information-memos-access-disposition-contract-v1.json"
EXPECTED_RAW_SHA256 = "3588d5ff1ca8eec4a496b11647ae0f02cd514ec50fdd25f6cad901228a31f835"
EXPECTED_SELF_SHA256 = "5b346887b7b167eb35bb9af27bc86678a0e9a7e551d349356c88af24bc6a90e2"
EXPECTED_URLS = [
    "https://infomemo.theocc.com/infomemo/search",
    "https://www.theocc.com/specialpages/whats-changed",
    "https://www.theocc.com/specialpages/legal/terms-and-conditions",
    "https://infomemo.theocc.com/infomemos?number=50515",
]
EXPECTED_LOCKS = {
    "automatedAccessAuthorized", "systematicExtractionAuthorized", "databaseCompiled",
    "historicalIdentityResolved", "corporateActionsComplete", "terminalWealthComplete",
    "pricesAccessed", "returnsAccessed", "outcomesAccessed", "originalV4GateCredit",
    "humanAttestation",
}
EXPECTED_TOP_KEYS = {
    "schema", "createdAt", "taskId", "sourceId", "track", "purpose", "officialEvidence",
    "capabilityAssessment", "decision", "claimCeiling", "claimLocks", "contractSha256",
}


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


def validate(value: dict[str, Any]) -> None:
    exact_keys(value, EXPECTED_TOP_KEYS, "contract")
    if value["schema"] != "early-detection-occ-information-memos-access-disposition/v1":
        fail("schema changed")
    if value["taskId"] != "Q006-OCC-INFORMATION-MEMOS-ACCESS-DISPOSITION":
        fail("task changed")
    if value["sourceId"] != "OCC_INFORMATION_MEMOS" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("source or track changed")
    computed = sha(canonical({key: item for key, item in value.items() if key != "contractSha256"}))
    if computed != EXPECTED_SELF_SHA256 or value["contractSha256"] != EXPECTED_SELF_SHA256:
        fail("contract self hash changed")

    evidence = value["officialEvidence"]
    if not isinstance(evidence, list) or [row.get("url") for row in evidence] != EXPECTED_URLS:
        fail("official evidence changed")
    for row in evidence:
        exact_keys(row, {"url", "observedAt", "verifiedFact"}, "officialEvidence row")
        if not isinstance(row["verifiedFact"], str) or not row["verifiedFact"]:
            fail("official evidence fact missing")

    capability = value["capabilityAssessment"]
    exact_keys(capability, {
        "historicalMemoAvailabilityObserved", "manualPublicSearchAvailable", "manualCsvControlObserved",
        "terminalEventEvidencePotential", "automatedAccessAuthorized", "systematicExtractionAuthorized",
        "databaseCompilationAuthorized", "freeMachineAcquisitionEligible", "writtenPermissionObtained",
    }, "capabilityAssessment")
    for key in ("historicalMemoAvailabilityObserved", "manualPublicSearchAvailable", "manualCsvControlObserved", "terminalEventEvidencePotential"):
        if capability[key] is not True:
            fail(f"{key} changed")
    for key in ("automatedAccessAuthorized", "systematicExtractionAuthorized", "databaseCompilationAuthorized", "freeMachineAcquisitionEligible", "writtenPermissionObtained"):
        if capability[key] is not False:
            fail(f"{key} falsely authorized")

    decision = value["decision"]
    exact_keys(decision, {
        "disposition", "automatedCrawlerMustNotRun", "manualMemoReviewMayBeUsedCaseByCase",
        "manualEvidenceRequiresMemoUrlNumberAndRetrievalTimestamp", "manualEvidenceRequiresIndependentPrimaryDocumentReconciliation",
        "bulkOrCsvExportMustNotBeAutomated", "nextAction",
    }, "decision")
    if decision["disposition"] != "MANUAL_PRIMARY_DOCUMENT_COUNTERCHECK_ONLY_AUTOMATION_PROHIBITED":
        fail("disposition changed")
    for key in (
        "automatedCrawlerMustNotRun", "manualMemoReviewMayBeUsedCaseByCase",
        "manualEvidenceRequiresMemoUrlNumberAndRetrievalTimestamp",
        "manualEvidenceRequiresIndependentPrimaryDocumentReconciliation", "bulkOrCsvExportMustNotBeAutomated",
    ):
        if decision[key] is not True:
            fail(f"{key} weakened")

    exact_keys(value["claimLocks"], EXPECTED_LOCKS, "claimLocks")
    if any(item is not False for item in value["claimLocks"].values()):
        fail("claim lock opened")
    required_forbidden = {
        "AUTOMATED_OCC_CORPUS", "OCC_DATABASE_COMPLETENESS", "HISTORICAL_IDENTITY_INTERVAL",
        "COMPLETE_CORPORATE_ACTION_CHAIN", "TERMINAL_WEALTH_COMPLETE", "PRICE_RETURN_OR_OUTCOME",
        "ORIGINAL_V4_GATE_CREDIT", "HUMAN_ATTESTATION",
    }
    if not required_forbidden.issubset(set(value["claimCeiling"].get("forbidden", []))):
        fail("claim ceiling weakened")


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
    for name, path, replacement in (
        ("automatedAccess", ("capabilityAssessment", "automatedAccessAuthorized"), True),
        ("systematicExtraction", ("capabilityAssessment", "systematicExtractionAuthorized"), True),
        ("freeMachineAcquisition", ("capabilityAssessment", "freeMachineAcquisitionEligible"), True),
        ("crawlerAllowed", ("decision", "automatedCrawlerMustNotRun"), False),
        ("csvAutomationAllowed", ("decision", "bulkOrCsvExportMustNotBeAutomated"), False),
        ("terminalComplete", ("claimLocks", "terminalWealthComplete"), True),
        ("originalCredit", ("claimLocks", "originalV4GateCredit"), True),
    ):
        item = copy.deepcopy(source)
        item[path[0]][path[1]] = replacement
        mutations[name] = item
    mutations["dispositionWeakened"] = copy.deepcopy(source)
    mutations["dispositionWeakened"]["decision"]["disposition"] = "AUTOMATED_FREE_CORPUS"
    mutations["forbiddenRemoved"] = copy.deepcopy(source)
    mutations["forbiddenRemoved"]["claimCeiling"]["forbidden"].remove("AUTOMATED_OCC_CORPUS")
    return {
        "status": "PASS",
        "mutationsRejected": {name: rejected(lambda item=item: validate(item)) for name, item in mutations.items()},
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
            "automatedAccessAuthorized": False,
            "terminalWealthComplete": False,
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
