#!/usr/bin/env python3
"""Validate the fail-closed DTCC corporate-actions access disposition."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "research" / "early-detection-v4" / "dtcc-corporate-actions-access-disposition-contract-v1.json"
EXPECTED_RAW_SHA256 = "957d9150d4643e6c3073c5c61e7a6c52ebab8695ecc0fb91b76be590d75a8561"
EXPECTED_SELF_SHA256 = "a6cfc9e851ec54841f47ccf5e7b830259fd4c3681f289734a1f87a98a8fa15d9"
EXPECTED_TOP_KEYS = {
    "schema", "createdAt", "taskId", "sourceId", "track", "purpose", "officialEvidence",
    "capabilityAssessment", "decision", "claimCeiling", "claimLocks", "contractSha256",
}
EXPECTED_URLS = [
    "https://www.dtcc.com/data-services/corporate-actions-and-reference-data",
    "https://www.dtcc.com/terms",
    "https://www.dtcc.com/asset-services/corporate-actions-processing/scenarios",
    "https://www.dtcc.com/asset-services/corporate-actions-processing/iso-20022-messaging-specifications",
]
EXPECTED_LOCKS = {
    "automatedAccessAuthorized", "historicalEventsAcquired", "dataServiceEntitled",
    "historicalIdentityResolved", "corporateActionsComplete", "terminalWealthComplete",
    "pricesAccessed", "returnsAccessed", "outcomesAccessed", "originalV4GateCredit",
    "humanAttestation",
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
    if value["schema"] != "early-detection-dtcc-corporate-actions-access-disposition/v1":
        fail("schema changed")
    if value["taskId"] != "Q010-DTCC-CORPORATE-ACTIONS-ACCESS-DISPOSITION":
        fail("task changed")
    if value["sourceId"] != "DTCC_CORPORATE_ACTIONS" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("source or track changed")
    computed = sha(canonical({key: item for key, item in value.items() if key != "contractSha256"}))
    if computed != EXPECTED_SELF_SHA256 or value["contractSha256"] != EXPECTED_SELF_SHA256:
        fail("self hash changed")
    evidence = value["officialEvidence"]
    if not isinstance(evidence, list) or [row.get("url") for row in evidence] != EXPECTED_URLS:
        fail("official evidence changed")
    for row in evidence:
        exact_keys(row, {"url", "observedAt", "verifiedFact"}, "officialEvidence row")
        if not isinstance(row["verifiedFact"], str) or not row["verifiedFact"]:
            fail("official evidence fact missing")

    capability = value["capabilityAssessment"]
    exact_keys(capability, {
        "publicSchemaDocumentationAvailable", "publicScenarioDocumentationAvailable",
        "publicHistoricalEventCorpusAvailable", "freeCorporateActionDataServiceConfirmed",
        "automatedWebsiteExtractionAuthorized", "databaseCompilationAuthorized",
        "clientAgreementObtained", "pricingConfirmedZero",
    }, "capabilityAssessment")
    if capability["publicSchemaDocumentationAvailable"] is not True or capability["publicScenarioDocumentationAvailable"] is not True:
        fail("public schema capability changed")
    for key in (
        "publicHistoricalEventCorpusAvailable", "freeCorporateActionDataServiceConfirmed",
        "automatedWebsiteExtractionAuthorized", "databaseCompilationAuthorized",
        "clientAgreementObtained", "pricingConfirmedZero",
    ):
        if capability[key] is not False:
            fail(f"{key} falsely promoted")

    decision = value["decision"]
    exact_keys(decision, {
        "disposition", "schemaMayInformOutcomeBlindDataContract", "websiteCrawlerMustNotRun",
        "productDataMustNotBeRequestedWithoutZeroCostEntitlementAndAgreement",
        "publicPagesMustNotBeTreatedAsEventDatabase", "nextAction",
    }, "decision")
    if decision["disposition"] != "SCHEMA_ONLY_AUTOMATION_PROHIBITED_DATA_SERVICE_NOT_FREE_CONFIRMED":
        fail("disposition changed")
    for key in (
        "schemaMayInformOutcomeBlindDataContract", "websiteCrawlerMustNotRun",
        "productDataMustNotBeRequestedWithoutZeroCostEntitlementAndAgreement",
        "publicPagesMustNotBeTreatedAsEventDatabase",
    ):
        if decision[key] is not True:
            fail(f"{key} weakened")

    exact_keys(value["claimLocks"], EXPECTED_LOCKS, "claimLocks")
    if any(item is not False for item in value["claimLocks"].values()):
        fail("claim lock opened")
    required = {
        "DTCC_EVENT_CORPUS", "DTCC_DATA_SERVICE_FREE_ACCESS", "HISTORICAL_IDENTITY_INTERVAL",
        "COMPLETE_CORPORATE_ACTION_CHAIN", "TERMINAL_WEALTH_COMPLETE", "PRICE_RETURN_OR_OUTCOME",
        "ORIGINAL_V4_GATE_CREDIT", "HUMAN_ATTESTATION",
    }
    if not required.issubset(set(value["claimCeiling"].get("forbidden", []))):
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
        ("freeDataService", ("capabilityAssessment", "freeCorporateActionDataServiceConfirmed"), True),
        ("automation", ("capabilityAssessment", "automatedWebsiteExtractionAuthorized"), True),
        ("eventCorpus", ("capabilityAssessment", "publicHistoricalEventCorpusAvailable"), True),
        ("crawlerAllowed", ("decision", "websiteCrawlerMustNotRun"), False),
        ("pagesAsDatabase", ("decision", "publicPagesMustNotBeTreatedAsEventDatabase"), False),
        ("terminalComplete", ("claimLocks", "terminalWealthComplete"), True),
        ("originalCredit", ("claimLocks", "originalV4GateCredit"), True),
    ):
        item = copy.deepcopy(source)
        item[path[0]][path[1]] = replacement
        mutations[name] = item
    mutations["dispositionWeakened"] = copy.deepcopy(source)
    mutations["dispositionWeakened"]["decision"]["disposition"] = "FREE_EVENT_CORPUS"
    mutations["forbiddenRemoved"] = copy.deepcopy(source)
    mutations["forbiddenRemoved"]["claimCeiling"]["forbidden"].remove("DTCC_EVENT_CORPUS")
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
            "historicalEventsAcquired": False,
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
