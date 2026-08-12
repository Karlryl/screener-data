#!/usr/bin/env python3
"""Validate the fail-closed Alpaca Basic corporate-actions prerequisite."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "research" / "early-detection-v4" / "alpaca-basic-corporate-actions-prerequisite-contract-v1.json"
EXPECTED_RAW_SHA256 = "cd2bbeabae5fd95aee61ee938fc5746e5ad55305c7ce847aacaef58436cc3c6a"
EXPECTED_SELF_SHA256 = "b8c728e49a7c3fbc2763a81a4168378c94afbf587fe53837cadfc9b371496d4e"
EXPECTED_URLS = [
    "https://docs.alpaca.markets/us/docs/about-market-data-api",
    "https://docs.alpaca.markets/us/v1.1/reference/corporateactions-1",
    "https://docs.alpaca.markets/us/v1.1/changelog/2026-05-22-corporate-actions-5c87d2b",
    "https://files.alpaca.markets/disclosures/library/TermsAndConditions.pdf",
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
    if value["schema"] != "early-detection-alpaca-basic-corporate-actions-prerequisite/v1":
        fail("schema changed")
    if value["taskId"] != "Q009-ALPACA-BASIC-CORPORATE-ACTIONS-HANDSHAKE":
        fail("task changed")
    if value["sourceId"] != "ALPACA_BASIC_MARKET_DATA" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
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
        "monthlyFeeUsd", "paidSubscriptionRequired", "accountRequired", "apiKeyRequired", "paperAccountEligible",
        "fundedBrokerageAccountRequiredForPilot", "historicalCallsPerMinute", "historicalStartYear",
        "currentRealtimeEquityFeed", "corporateActionFamiliesAdvertised", "coversOriginalV4Period2009To2015",
        "terminalPaymentsAdvertisedComplete", "historicalIdentityIntervalsAdvertised", "licenseDisposition",
    }, "freeCapability")
    if (free["monthlyFeeUsd"], free["historicalCallsPerMinute"], free["historicalStartYear"]) != (0, 200, 2016):
        fail("free plan boundary changed")
    if free["currentRealtimeEquityFeed"] != "IEX_ONLY":
        fail("realtime feed boundary changed")
    if free["licenseDisposition"] != "PRIVATE_PERSONAL_NONCOMMERCIAL_PILOT_ONLY":
        fail("license disposition changed")
    for key in ("accountRequired", "apiKeyRequired", "paperAccountEligible"):
        if free[key] is not True:
            fail(f"{key} changed")
    for key in (
        "paidSubscriptionRequired", "fundedBrokerageAccountRequiredForPilot", "coversOriginalV4Period2009To2015",
        "terminalPaymentsAdvertisedComplete", "historicalIdentityIntervalsAdvertised",
    ):
        if free[key] is not False:
            fail(f"{key} falsely promoted")
    required_families = {
        "CASH_DIVIDEND", "CASH_MERGER", "FORWARD_SPLIT", "NAME_CHANGE", "PARTIAL_CALL", "REDEMPTION",
        "REORGANIZATION", "REVERSE_SPLIT", "RIGHTS_DISTRIBUTION", "SPIN_OFF", "STOCK_AND_CASH_MERGER",
        "STOCK_DIVIDEND", "STOCK_MERGER", "UNIT_SPLIT", "WORTHLESS_REMOVAL",
    }
    if set(free["corporateActionFamiliesAdvertised"]) != required_families or len(free["corporateActionFamiliesAdvertised"]) != len(required_families):
        fail("corporate action families changed")

    handshake = value["handshakeContract"]
    exact_keys(handshake, {
        "caseIds", "productionRequestsAuthorized", "pilotMayStartOnlyAfterBasicAccountAttestationAndSecretStoreBinding",
        "maximumUniqueSymbols", "maximumRequests", "corporateActionsEndpointOnly", "noTradingOrder",
        "noAccountFunding", "noPaidSubscription", "noPriceOrReturnRequest", "noTickerOnlyIdentityPromotion",
        "noWorthlessRemovalAsTerminalWealthProof", "rawProviderRowsRemainPrivate",
        "publicArtifactLimitedToHashesAndAggregateCapability",
    }, "handshakeContract")
    if handshake["caseIds"] != ["ACTIVE_STABLE_AAPL", "SYMBOL_CHANGE_FB_META", "TERMINAL_ATVI"]:
        fail("handshake cases changed")
    if handshake["maximumUniqueSymbols"] != 3 or handshake["maximumRequests"] != 9:
        fail("request boundary changed")
    if handshake["productionRequestsAuthorized"] is not False:
        fail("production requests opened")
    for key in (
        "pilotMayStartOnlyAfterBasicAccountAttestationAndSecretStoreBinding", "corporateActionsEndpointOnly",
        "noTradingOrder", "noAccountFunding", "noPaidSubscription", "noPriceOrReturnRequest",
        "noTickerOnlyIdentityPromotion", "noWorthlessRemovalAsTerminalWealthProof", "rawProviderRowsRemainPrivate",
        "publicArtifactLimitedToHashesAndAggregateCapability",
    ):
        if handshake[key] is not True:
            fail(f"{key} weakened")

    gate = value["userActionGate"]
    exact_keys(gate, {
        "status", "neededAction", "secretsMustNotEnterChat", "paymentMustRemainZero",
        "paidSubscriptionMustRemainAbsent", "brokerageFundingMustRemainAbsent", "noSecondAccount",
    }, "userActionGate")
    if gate["status"] != "DEFERRED_UNTIL_FINRA_FINALIZATION_OR_HIGHER_VALUE_AUTONOMOUS_WORK_COMPLETES":
        fail("user-action timing changed")
    for key in (
        "secretsMustNotEnterChat", "paymentMustRemainZero", "paidSubscriptionMustRemainAbsent",
        "brokerageFundingMustRemainAbsent", "noSecondAccount",
    ):
        if gate[key] is not True:
            fail(f"{key} weakened")

    decision = value["decision"]
    exact_keys(decision, {
        "disposition", "originalV4CapabilityClosed", "fullPeriod2009To2024Closed",
        "threeCasePilotEligibleAfterAccountGate", "studyCreditBeforePilot", "nextAction",
    }, "decision")
    if decision["disposition"] != "CONFIRMED_FREE_POST2015_CORPORATE_ACTION_PILOT_ACCOUNT_REQUIRED":
        fail("disposition changed")
    if decision["originalV4CapabilityClosed"] is not False or decision["fullPeriod2009To2024Closed"] is not False:
        fail("original or full-period capability falsely promoted")
    if decision["studyCreditBeforePilot"] is not False or decision["threeCasePilotEligibleAfterAccountGate"] is not True:
        fail("pilot or study-credit boundary changed")

    if any(item is not False for item in value["claimLocks"].values()):
        fail("claim lock opened")
    required_forbidden = {
        "FULL_MARKET_COVERAGE_2009_TO_2024", "SURVIVORSHIP_SAFE_UNIVERSE", "HISTORICAL_IDENTITY_INTERVAL",
        "COMPLETE_CORPORATE_ACTION_CHAIN", "TERMINAL_PAYMENT_VERIFIED", "TERMINAL_WEALTH_COMPLETE",
        "PRICE_RETURN_OR_OUTCOME", "ORIGINAL_V4_GATE_CREDIT", "HUMAN_ATTESTATION",
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
        ("paidRequired", ("freeCapability", "paidSubscriptionRequired"), True),
        ("fundingRequired", ("freeCapability", "fundedBrokerageAccountRequiredForPilot"), True),
        ("periodComplete", ("freeCapability", "coversOriginalV4Period2009To2015"), True),
        ("terminalComplete", ("freeCapability", "terminalPaymentsAdvertisedComplete"), True),
        ("requestsAuthorized", ("handshakeContract", "productionRequestsAuthorized"), True),
        ("tradingAllowed", ("handshakeContract", "noTradingOrder"), False),
        ("priceAllowed", ("handshakeContract", "noPriceOrReturnRequest"), False),
        ("worthlessAsWealth", ("handshakeContract", "noWorthlessRemovalAsTerminalWealthProof"), False),
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
            "historicalStartYear": 2016,
            "productionRequestsAuthorized": False,
            "pricesAccessed": False,
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
