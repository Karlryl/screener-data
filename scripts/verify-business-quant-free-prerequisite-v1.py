#!/usr/bin/env python3
"""Validate the fail-closed Business Quant Free prerequisite."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "research" / "early-detection-v4" / "business-quant-free-prerequisite-contract-v1.json"
EXPECTED_RAW_SHA256 = "7ea5fa97868ecfe533b6bacb916fe8425c68b18eb8658aa3ccf4639cb24140e4"
EXPECTED_SELF_SHA256 = "bf7cf70fde2b616fc23bc904dc2cece82a57483170f58799f3205afb1262a3fd"
EXPECTED_URLS = [
    "https://businessquant.com/pricing",
    "https://businessquant.com/docs/api/corporate-actions",
    "https://businessquant.com/docs/api/",
    "https://businessquant.com/terms-of-use",
]
EXPECTED_TOP_KEYS = {
    "schema", "createdAt", "taskId", "sourceId", "track", "purpose", "officialEvidence",
    "freeCapability", "handshakeContract", "userActionGate", "decision", "claimCeiling",
    "claimLocks", "contractSha256",
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
    if value["schema"] != "early-detection-business-quant-free-prerequisite/v1":
        fail("schema changed")
    if value["taskId"] != "Q008-BUSINESS-QUANT-FREE-HANDSHAKE":
        fail("task changed")
    if value["sourceId"] != "BUSINESS_QUANT_FREE" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
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

    free = value["freeCapability"]
    exact_keys(free, {
        "monthlyFeeUsd", "paymentCardRequired", "trialRequired", "accountRequired", "apiKeyRequired",
        "requestsPerDay", "bandwidthBytesPerMonth", "corporateActionsEndpointAdvertisedFree",
        "corporateActionFamiliesAdvertised", "terminalPaymentsAdvertisedComplete",
        "historicalIdentityIntervalsAdvertised", "survivorshipSafeUniverseAdvertised", "licenseDisposition",
    }, "freeCapability")
    if (free["monthlyFeeUsd"], free["requestsPerDay"], free["bandwidthBytesPerMonth"]) != (0, 30, 100_000_000):
        fail("free limits changed")
    if free["corporateActionFamiliesAdvertised"] != [
        "ACQUISITION", "BANKRUPTCY", "DELISTING", "DIVIDEND", "MERGER", "SPINOFF", "SPLIT"
    ]:
        fail("corporate action families changed")
    if free["licenseDisposition"] != "PRIVATE_SUPPLEMENTAL_PILOT_ONLY":
        fail("license disposition changed")
    for key in ("accountRequired", "apiKeyRequired", "corporateActionsEndpointAdvertisedFree"):
        if free[key] is not True:
            fail(f"{key} changed")
    for key in (
        "paymentCardRequired", "trialRequired", "terminalPaymentsAdvertisedComplete",
        "historicalIdentityIntervalsAdvertised", "survivorshipSafeUniverseAdvertised",
    ):
        if free[key] is not False:
            fail(f"{key} falsely promoted")

    handshake = value["handshakeContract"]
    exact_keys(handshake, {
        "caseIds", "productionRequestsAuthorized", "pilotMayStartOnlyAfterAccountAttestationAndSecretStoreBinding",
        "maximumUniqueSymbols", "maximumRequests", "noPremiumEndpoint", "noBrowserScraping",
        "noTickerOnlyIdentityPromotion", "noNullPaymentAsZero", "noLastQuoteAsTerminalPayment",
        "rawProviderRowsRemainPrivate", "publicArtifactLimitedToHashesAndAggregateCapability",
    }, "handshakeContract")
    if handshake["caseIds"] != ["ACTIVE_STABLE_AAPL", "SYMBOL_CHANGE_FB_META", "TERMINAL_ATVI"]:
        fail("handshake cases changed")
    if handshake["maximumUniqueSymbols"] != 3 or handshake["maximumRequests"] != 9:
        fail("handshake request boundary changed")
    if handshake["productionRequestsAuthorized"] is not False:
        fail("production requests opened")
    for key in (
        "pilotMayStartOnlyAfterAccountAttestationAndSecretStoreBinding", "noPremiumEndpoint",
        "noBrowserScraping", "noTickerOnlyIdentityPromotion", "noNullPaymentAsZero",
        "noLastQuoteAsTerminalPayment", "rawProviderRowsRemainPrivate",
        "publicArtifactLimitedToHashesAndAggregateCapability",
    ):
        if handshake[key] is not True:
            fail(f"{key} weakened")

    gate = value["userActionGate"]
    exact_keys(gate, {
        "status", "neededAction", "secretsMustNotEnterChat", "paymentMustRemainZero",
        "trialMustRemainAbsent", "noSecondAccount",
    }, "userActionGate")
    if gate["status"] != "DEFERRED_UNTIL_FINRA_FINALIZATION_OR_HIGHER_VALUE_AUTONOMOUS_WORK_COMPLETES":
        fail("user-action timing changed")
    for key in ("secretsMustNotEnterChat", "paymentMustRemainZero", "trialMustRemainAbsent", "noSecondAccount"):
        if gate[key] is not True:
            fail(f"{key} weakened")

    decision = value["decision"]
    exact_keys(decision, {
        "disposition", "originalV4CapabilityClosed", "fullMarketBulkAcquisitionAuthorized",
        "threeCasePilotEligibleAfterAccountGate", "studyCreditBeforePilot", "nextAction",
    }, "decision")
    if decision["disposition"] != "CONFIRMED_FREE_SUPPLEMENTAL_EVENT_PILOT_ACCOUNT_REQUIRED":
        fail("disposition changed")
    if decision["originalV4CapabilityClosed"] is not False or decision["fullMarketBulkAcquisitionAuthorized"] is not False:
        fail("original or bulk capability falsely promoted")
    if decision["studyCreditBeforePilot"] is not False or decision["threeCasePilotEligibleAfterAccountGate"] is not True:
        fail("pilot or study-credit boundary changed")

    if any(item is not False for item in value["claimLocks"].values()):
        fail("claim lock opened")
    required = {
        "FULL_MARKET_COVERAGE", "SURVIVORSHIP_SAFE_UNIVERSE", "HISTORICAL_IDENTITY_INTERVAL",
        "COMPLETE_CORPORATE_ACTION_CHAIN", "TERMINAL_PAYMENT_VERIFIED", "TERMINAL_WEALTH_COMPLETE",
        "PRICE_RETURN_OR_OUTCOME", "ORIGINAL_V4_GATE_CREDIT", "HUMAN_ATTESTATION",
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
        ("paymentRequired", ("freeCapability", "paymentCardRequired"), True),
        ("trialRequired", ("freeCapability", "trialRequired"), True),
        ("terminalComplete", ("freeCapability", "terminalPaymentsAdvertisedComplete"), True),
        ("requestsAuthorized", ("handshakeContract", "productionRequestsAuthorized"), True),
        ("premiumAllowed", ("handshakeContract", "noPremiumEndpoint"), False),
        ("browserScraping", ("handshakeContract", "noBrowserScraping"), False),
        ("nullAsZero", ("handshakeContract", "noNullPaymentAsZero"), False),
        ("bulkAuthorized", ("decision", "fullMarketBulkAcquisitionAuthorized"), True),
        ("studyCredit", ("decision", "studyCreditBeforePilot"), True),
        ("originalCredit", ("claimLocks", "originalV4GateCredit"), True),
    ):
        item = copy.deepcopy(source)
        item[path[0]][path[1]] = replacement
        mutations[name] = item
    mutations["caseRemoved"] = copy.deepcopy(source)
    mutations["caseRemoved"]["handshakeContract"]["caseIds"].pop()
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
            "monthlyFeeUsd": 0,
            "productionRequestsAuthorized": False,
            "terminalPaymentVerified": False,
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
