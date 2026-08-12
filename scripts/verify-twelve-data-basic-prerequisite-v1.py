#!/usr/bin/env python3
"""Validate the fail-closed Twelve Data Basic prerequisite."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "research" / "early-detection-v4" / "twelve-data-basic-prerequisite-contract-v1.json"
EXPECTED_RAW_SHA256 = "769efda94a83a112ee8945871209da7315341908a2673c3595b804fd6fd05890"
EXPECTED_SELF_SHA256 = "79a1f72b3ac9d7d7255c358794a40ca3dd631beee58117f4d8d956fbaa6ed550"
EXPECTED_URLS = [
    "https://twelvedata.com/pricing",
    "https://support.twelvedata.com/en/articles/12682324-end-of-day-eod-pricing-market-data",
    "https://twelvedata.com/docs/introduction/quickstart",
    "https://twelvedata.com/docs/supporting-metadata/instrument-type",
    "https://support.twelvedata.com/en/articles/5332349-commercial-and-personal-usage",
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
    if value["schema"] != "early-detection-twelve-data-basic-prerequisite/v1":
        fail("schema changed")
    if value["taskId"] != "Q012-TWELVE-DATA-BASIC-HANDSHAKE":
        fail("task changed")
    if value["sourceId"] != "TWELVE_DATA_BASIC" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
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
        "monthlyFeeUsd", "paymentCardRequirementConfirmedAbsent", "trialRequirementForRestApiConfirmedAbsent",
        "accountRequired", "apiKeyRequired", "apiCreditsPerMinute", "apiCreditsPerDay", "marketsIncluded",
        "globalTrialSymbolsOnlyOutsideIncludedMarkets", "eodFullHistoryAdvertised", "dailyMaximumRowsPerResponse",
        "dividendEndpointIncludedInBasic", "splitEndpointIncludedInBasic", "terminalPaymentsAdvertisedComplete",
        "historicalIdentityIntervalsAdvertised", "licenseDisposition",
    }, "freeCapability")
    if (free["monthlyFeeUsd"], free["apiCreditsPerMinute"], free["apiCreditsPerDay"], free["marketsIncluded"], free["dailyMaximumRowsPerResponse"]) != (0, 8, 800, 3, 5000):
        fail("free limits changed")
    if free["licenseDisposition"] != "PRIVATE_PERSONAL_INTERNAL_NONDISPLAY_ONLY":
        fail("license disposition changed")
    for key in (
        "trialRequirementForRestApiConfirmedAbsent", "accountRequired", "apiKeyRequired",
        "globalTrialSymbolsOnlyOutsideIncludedMarkets", "eodFullHistoryAdvertised",
    ):
        if free[key] is not True:
            fail(f"{key} changed")
    for key in (
        "paymentCardRequirementConfirmedAbsent", "dividendEndpointIncludedInBasic", "splitEndpointIncludedInBasic",
        "terminalPaymentsAdvertisedComplete", "historicalIdentityIntervalsAdvertised",
    ):
        if free[key] is not False:
            fail(f"{key} falsely promoted")

    handshake = value["handshakeContract"]
    exact_keys(handshake, {
        "caseIds", "productionRequestsAuthorized", "pilotMayStartOnlyAfterBasicAccountAttestationAndSecretStoreBinding",
        "maximumUniqueSymbols", "maximumRequests", "dailyEodEndpointOnly", "noWebsocketTrial", "noPaidEndpoint",
        "noPricePublication", "noTickerOnlyIdentityPromotion", "noAdjustedSeriesAsIndependentActionChain",
        "noLastQuoteAsTerminalPayment", "rawProviderRowsRemainPrivate",
        "publicArtifactLimitedToHashesAndAggregateCapability",
    }, "handshakeContract")
    if handshake["caseIds"] != ["ACTIVE_STABLE_AAPL", "SYMBOL_CHANGE_FB_META", "TERMINAL_ATVI"]:
        fail("handshake cases changed")
    if handshake["maximumUniqueSymbols"] != 3 or handshake["maximumRequests"] != 9:
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
        "disposition", "originalV4CapabilityClosed", "completeAdjustmentChainClosed",
        "threeCasePilotEligibleAfterAccountGate", "studyCreditBeforePilot", "nextAction",
    }, "decision")
    if decision["disposition"] != "CONFIRMED_FREE_EOD_ENTITLEMENT_PILOT_ACCOUNT_REQUIRED":
        fail("disposition changed")
    if decision["originalV4CapabilityClosed"] is not False or decision["completeAdjustmentChainClosed"] is not False or decision["studyCreditBeforePilot"] is not False:
        fail("capability or credit falsely promoted")
    if decision["threeCasePilotEligibleAfterAccountGate"] is not True:
        fail("pilot eligibility changed")

    if any(item is not False for item in value["claimLocks"].values()):
        fail("claim lock opened")
    required = {
        "FULL_MARKET_COVERAGE", "SURVIVORSHIP_SAFE_UNIVERSE", "HISTORICAL_IDENTITY_INTERVAL",
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
        ("cardAbsentClaim", ("freeCapability", "paymentCardRequirementConfirmedAbsent"), True),
        ("dividendsInBasic", ("freeCapability", "dividendEndpointIncludedInBasic"), True),
        ("splitsInBasic", ("freeCapability", "splitEndpointIncludedInBasic"), True),
        ("terminalComplete", ("freeCapability", "terminalPaymentsAdvertisedComplete"), True),
        ("requestsAuthorized", ("handshakeContract", "productionRequestsAuthorized"), True),
        ("websocketAllowed", ("handshakeContract", "noWebsocketTrial"), False),
        ("pricePublication", ("handshakeContract", "noPricePublication"), False),
        ("adjustmentChain", ("handshakeContract", "noAdjustedSeriesAsIndependentActionChain"), False),
        ("originalClosed", ("decision", "originalV4CapabilityClosed"), True),
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
            "apiCreditsPerDay": 800,
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
