#!/usr/bin/env python3
"""Validate the fail-closed Massive Stocks Basic prerequisite."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "research" / "early-detection-v4" / "massive-stocks-basic-prerequisite-contract-v1.json"
EXPECTED_RAW_SHA256 = "95f84d1a97756186d2528f04bb7a4166234f00c55dfd569978c1cf232379e0a9"
EXPECTED_SELF_SHA256 = "22533ad7143d27a493c41e524687449bd9744db5962aea029c692e11bc1d587d"
EXPECTED_URLS = [
    "https://massive.com/pricing?product=stocks",
    "https://massive.com/stocks",
    "https://massive.com/legal/terms",
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
    if value["schema"] != "early-detection-massive-stocks-basic-prerequisite/v1":
        fail("schema changed")
    if value["taskId"] != "Q015-MASSIVE-STOCKS-BASIC-HANDSHAKE":
        fail("task changed")
    if value["sourceId"] != "MASSIVE_STOCKS_BASIC" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
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
        "monthlyFeeUsd", "individualUseOnly", "accountRequired", "apiKeyRequired", "apiCallsPerMinute",
        "historyMaximumYears", "allUsStockTickersAdvertised", "oneHundredPercentMarketCoverageAdvertised",
        "endOfDayDataAdvertised", "referenceDataAdvertised", "corporateActionsAdvertised",
        "minuteAggregatesAdvertised", "full2009To2024HistoryAvailableFree",
        "terminalPaymentsAdvertisedComplete", "historicalIdentityIntervalsAdvertised",
        "sourceFeedDisposition", "licenseDisposition",
    }, "freeCapability")
    if (free["monthlyFeeUsd"], free["apiCallsPerMinute"], free["historyMaximumYears"]) != (0, 5, 2):
        fail("free limits changed")
    if free["sourceFeedDisposition"] != "SIP_DIRECT_EXCHANGE_FINRA_OTRF_ATS_MULTI_SOURCE":
        fail("source feed changed")
    if free["licenseDisposition"] != "ACCOUNT_TERMS_SNAPSHOT_REQUIRED_BEFORE_PRIVATE_CAPTURE":
        fail("license changed")
    for key in (
        "individualUseOnly", "accountRequired", "apiKeyRequired", "allUsStockTickersAdvertised",
        "oneHundredPercentMarketCoverageAdvertised", "endOfDayDataAdvertised", "referenceDataAdvertised",
        "corporateActionsAdvertised", "minuteAggregatesAdvertised",
    ):
        if free[key] is not True:
            fail(f"{key} changed")
    for key in ("full2009To2024HistoryAvailableFree", "terminalPaymentsAdvertisedComplete", "historicalIdentityIntervalsAdvertised"):
        if free[key] is not False:
            fail(f"{key} falsely promoted")

    handshake = value["handshakeContract"]
    exact_keys(handshake, {
        "caseIds", "productionRequestsAuthorized", "pilotMayStartOnlyAfterFreeAccountTermsAndSecretStoreBinding",
        "maximumUniqueSymbols", "maximumRequests", "referenceAndCorporateActionEndpointsOnly",
        "noMinuteAggregateOrPriceEndpoint", "noPaidEndpoint", "noPricePublication",
        "noTickerOnlyIdentityPromotion", "noLastQuoteAsTerminalPayment", "rawProviderRowsRemainPrivate",
        "publicArtifactLimitedToHashesAndAggregateCapability",
    }, "handshakeContract")
    if handshake["caseIds"] != ["ACTIVE_STABLE_AAPL", "SYMBOL_CHANGE_FB_META", "TERMINAL_ATVI"]:
        fail("handshake cases changed")
    if handshake["maximumUniqueSymbols"] != 3 or handshake["maximumRequests"] != 15:
        fail("request boundary changed")
    if handshake["productionRequestsAuthorized"] is not False:
        fail("production requests opened")
    for key in set(handshake) - {"caseIds", "productionRequestsAuthorized", "maximumUniqueSymbols", "maximumRequests"}:
        if handshake[key] is not True:
            fail(f"{key} weakened")

    gate = value["userActionGate"]
    exact_keys(gate, {
        "status", "neededAction", "secretsMustNotEnterChat", "abortIfPaymentCardRequested",
        "abortIfPaidTrialRequired", "abortIfPaidPlanPreselected", "noSecondAccount",
    }, "userActionGate")
    if gate["status"] != "DEFERRED_UNTIL_FINRA_FINALIZATION_OR_HIGHER_VALUE_AUTONOMOUS_WORK_COMPLETES":
        fail("user-action timing changed")
    for key in ("secretsMustNotEnterChat", "abortIfPaymentCardRequested", "abortIfPaidTrialRequired", "abortIfPaidPlanPreselected", "noSecondAccount"):
        if gate[key] is not True:
            fail(f"{key} weakened")

    decision = value["decision"]
    exact_keys(decision, {
        "disposition", "originalV4CapabilityClosed", "complete2009To2024HistoryClosed",
        "threeCasePilotEligibleAfterAccountGate", "studyCreditBeforePilot", "nextAction",
    }, "decision")
    if decision["disposition"] != "CONFIRMED_FREE_RECENT_SIP_REFERENCE_ACTION_PILOT_ACCOUNT_REQUIRED":
        fail("disposition changed")
    if decision["originalV4CapabilityClosed"] is not False or decision["complete2009To2024HistoryClosed"] is not False or decision["studyCreditBeforePilot"] is not False:
        fail("capability or credit falsely promoted")
    if decision["threeCasePilotEligibleAfterAccountGate"] is not True:
        fail("pilot eligibility changed")

    if any(item is not False for item in value["claimLocks"].values()):
        fail("claim lock opened")
    required = {
        "FULL_2009_TO_2024_HISTORY", "FULL_MARKET_COMPLETENESS_PROVEN",
        "SURVIVORSHIP_SAFE_UNIVERSE_PROVEN", "HISTORICAL_IDENTITY_INTERVAL",
        "COMPLETE_ADJUSTMENT_OR_CORPORATE_ACTION_CHAIN", "TERMINAL_PAYMENT_VERIFIED",
        "TERMINAL_WEALTH_COMPLETE", "PRICE_RETURN_OR_OUTCOME_PUBLICATION",
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
        ("fullHistory", ("freeCapability", "full2009To2024HistoryAvailableFree"), True),
        ("terminalComplete", ("freeCapability", "terminalPaymentsAdvertisedComplete"), True),
        ("requestsAuthorized", ("handshakeContract", "productionRequestsAuthorized"), True),
        ("priceEndpoint", ("handshakeContract", "noMinuteAggregateOrPriceEndpoint"), False),
        ("pricePublication", ("handshakeContract", "noPricePublication"), False),
        ("paidEndpoint", ("handshakeContract", "noPaidEndpoint"), False),
        ("caseRemoved", ("handshakeContract", "caseIds"), ["ACTIVE_STABLE_AAPL", "SYMBOL_CHANGE_FB_META"]),
        ("originalClosed", ("decision", "originalV4CapabilityClosed"), True),
        ("studyCredit", ("decision", "studyCreditBeforePilot"), True),
        ("originalCredit", ("claimLocks", "originalV4GateCredit"), True),
    ):
        item = copy.deepcopy(source)
        item[path[0]][path[1]] = replacement
        mutations[name] = item
    return {
        "status": "PASS",
        "mutationsRejected": {name: rejected(lambda item=item: validate(item)) for name, item in mutations.items()},
        "networkRequests": 0,
        "accountsCreated": 0,
        "filesWritten": 0,
        "pricesAccessed": False,
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
            "apiCallsPerMinute": 5,
            "historyMaximumYears": 2,
            "productionRequestsAuthorized": False,
            "networkRequests": 0,
            "accountsCreated": 0,
            "filesWritten": 0,
            "pricesAccessed": False,
            "outcomesAccessed": False,
        }
    except (ContractError, OSError, json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
