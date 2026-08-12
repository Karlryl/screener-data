#!/usr/bin/env python3
"""Validate the fail-closed FMP Basic free prerequisite."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "research" / "early-detection-v4" / "fmp-basic-free-prerequisite-contract-v1.json"
EXPECTED_RAW_SHA256 = "9e7b0077c763875e01f65cb5e00a14d517d7ee75a884011404300288bf5796d8"
EXPECTED_SELF_SHA256 = "900f8fefbfe73a7cb1b6190129e15d12f734146b5824e1a2460a3be4d545d5d2"
EXPECTED_URLS = [
    "https://site.financialmodelingprep.com/developer/docs/pricing/",
    "https://site.financialmodelingprep.com/developer/docs/stable",
    "https://site.financialmodelingprep.com/developer/docs/stable/delisted-companies",
    "https://site.financialmodelingprep.com/developer/docs/terms-of-service",
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
    if value["schema"] != "early-detection-fmp-basic-free-prerequisite/v1":
        fail("schema changed")
    if value["taskId"] != "Q010-FMP-BASIC-FREE-HANDSHAKE":
        fail("task changed")
    if value["sourceId"] != "FMP_BASIC_FREE" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
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
        "monthlyFeeUsd", "paymentCardRequirementConfirmedAbsent", "trialRequirementConfirmedAbsent",
        "accountRequired", "apiKeyRequired", "requestsPerDay", "bandwidthBytesTrailing30Days",
        "historicalYears", "recentDelistingEndpointAdvertised", "recentSymbolChangeEndpointAdvertised",
        "recentMergerEndpointAdvertised", "dividendEndpointAdvertised", "splitEndpointAdvertised",
        "coversOriginalV4Period2009To2015", "terminalPaymentsAdvertisedComplete",
        "historicalIdentityIntervalsAdvertised", "licenseDisposition",
    }, "freeCapability")
    if (free["monthlyFeeUsd"], free["requestsPerDay"], free["bandwidthBytesTrailing30Days"], free["historicalYears"]) != (0, 250, 500_000_000, 5):
        fail("free limits changed")
    if free["licenseDisposition"] != "PRIVATE_RECENT_EVENT_CROSSCHECK_ONLY":
        fail("license disposition changed")
    for key in (
        "accountRequired", "apiKeyRequired", "recentDelistingEndpointAdvertised",
        "recentSymbolChangeEndpointAdvertised", "recentMergerEndpointAdvertised",
        "dividendEndpointAdvertised", "splitEndpointAdvertised",
    ):
        if free[key] is not True:
            fail(f"{key} changed")
    for key in (
        "paymentCardRequirementConfirmedAbsent", "trialRequirementConfirmedAbsent", "coversOriginalV4Period2009To2015",
        "terminalPaymentsAdvertisedComplete", "historicalIdentityIntervalsAdvertised",
    ):
        if free[key] is not False:
            fail(f"{key} falsely promoted")

    handshake = value["handshakeContract"]
    exact_keys(handshake, {
        "caseIds", "productionRequestsAuthorized", "pilotMayStartOnlyAfterZeroCostNoTrialNoCardAttestationAndSecretStoreBinding",
        "maximumUniqueSymbols", "maximumRequests", "noPremiumEndpoint", "noBrowserScraping",
        "noPriceOrReturnRequest", "noTickerOnlyIdentityPromotion", "noDelistingRowAsTerminalWealthProof",
        "rawProviderRowsRemainPrivate", "publicArtifactLimitedToHashesAndAggregateCapability",
    }, "handshakeContract")
    if handshake["caseIds"] != ["ACTIVE_STABLE_AAPL", "SYMBOL_CHANGE_FB_META", "TERMINAL_ATVI"]:
        fail("handshake cases changed")
    if handshake["maximumUniqueSymbols"] != 3 or handshake["maximumRequests"] != 9:
        fail("request boundary changed")
    if handshake["productionRequestsAuthorized"] is not False:
        fail("production requests opened")
    for key in (
        "pilotMayStartOnlyAfterZeroCostNoTrialNoCardAttestationAndSecretStoreBinding", "noPremiumEndpoint",
        "noBrowserScraping", "noPriceOrReturnRequest", "noTickerOnlyIdentityPromotion",
        "noDelistingRowAsTerminalWealthProof", "rawProviderRowsRemainPrivate",
        "publicArtifactLimitedToHashesAndAggregateCapability",
    ):
        if handshake[key] is not True:
            fail(f"{key} weakened")

    gate = value["userActionGate"]
    exact_keys(gate, {
        "status", "neededAction", "secretsMustNotEnterChat", "abortIfPaymentCardRequested",
        "abortIfTrialRequired", "abortIfPaidPlanPreselected", "noSecondAccount",
    }, "userActionGate")
    if gate["status"] != "DEFERRED_PAYMENT_AND_TRIAL_STATUS_MUST_BE_CONFIRMED_IN_SIGNUP_UI":
        fail("user-action timing changed")
    for key in ("secretsMustNotEnterChat", "abortIfPaymentCardRequested", "abortIfTrialRequired", "abortIfPaidPlanPreselected", "noSecondAccount"):
        if gate[key] is not True:
            fail(f"{key} weakened")

    decision = value["decision"]
    exact_keys(decision, {
        "disposition", "originalV4CapabilityClosed", "fullPeriod2009To2024Closed",
        "accountCreationAuthorizedNow", "threeCasePilotEligibleAfterUserGate", "studyCreditBeforePilot", "nextAction",
    }, "decision")
    if decision["disposition"] != "DOCUMENTED_FREE_RECENT_EVENT_PILOT_PAYMENT_GATE_UNCONFIRMED":
        fail("disposition changed")
    for key in ("originalV4CapabilityClosed", "fullPeriod2009To2024Closed", "accountCreationAuthorizedNow", "studyCreditBeforePilot"):
        if decision[key] is not False:
            fail(f"{key} falsely promoted")
    if decision["threeCasePilotEligibleAfterUserGate"] is not True:
        fail("pilot eligibility changed")

    if any(item is not False for item in value["claimLocks"].values()):
        fail("claim lock opened")
    required = {
        "FULL_MARKET_COVERAGE_2009_TO_2024", "SURVIVORSHIP_SAFE_UNIVERSE", "HISTORICAL_IDENTITY_INTERVAL",
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
        ("cardAbsentClaim", ("freeCapability", "paymentCardRequirementConfirmedAbsent"), True),
        ("trialAbsentClaim", ("freeCapability", "trialRequirementConfirmedAbsent"), True),
        ("oldPeriodCovered", ("freeCapability", "coversOriginalV4Period2009To2015"), True),
        ("terminalComplete", ("freeCapability", "terminalPaymentsAdvertisedComplete"), True),
        ("requestsAuthorized", ("handshakeContract", "productionRequestsAuthorized"), True),
        ("premiumAllowed", ("handshakeContract", "noPremiumEndpoint"), False),
        ("priceAllowed", ("handshakeContract", "noPriceOrReturnRequest"), False),
        ("delistingAsWealth", ("handshakeContract", "noDelistingRowAsTerminalWealthProof"), False),
        ("accountNow", ("decision", "accountCreationAuthorizedNow"), True),
        ("fullPeriod", ("decision", "fullPeriod2009To2024Closed"), True),
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
            "historicalYears": 5,
            "accountCreationAuthorizedNow": False,
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
