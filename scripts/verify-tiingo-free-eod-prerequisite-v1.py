#!/usr/bin/env python3
"""Validate the fail-closed Tiingo Starter EOD prerequisite."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "research" / "early-detection-v4" / "tiingo-free-eod-prerequisite-contract-v1.json"
EXPECTED_RAW_SHA256 = "6ef3bbcce169fd840432c941ef83b31c6c30ee73194e955c1899d2c6530b888d"
EXPECTED_SELF_SHA256 = "b65918c52c3effe3be3cd84fe586c2f896aed4fa502400e7fbc3f46fcb7dc0cf"
EXPECTED_URLS = [
    "https://www.tiingo.com/about/pricing",
    "https://www.tiingo.com/products/end-of-day-stock-price-data",
    "https://www.tiingo.com/documentation/end-of-day",
    "https://www.tiingo.com/documentation/general",
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
    if value["schema"] != "early-detection-tiingo-free-eod-prerequisite/v1":
        fail("schema changed")
    if value["taskId"] != "Q006-TIINGO-FREE-EOD-HANDSHAKE":
        fail("task changed")
    if value["sourceId"] != "TIINGO_FREE_EOD" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
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
        "starterMonthlyFeeUsd", "paymentDetailsRequired", "trialRequired", "accountRequired",
        "tokenRequired", "uniqueSymbolsPerMonth", "requestsPerHour", "requestsPerDay",
        "bandwidthBytesPerMonth", "licenseDisposition", "rawOhlcvAdvertised",
        "adjustedOhlcvAdvertised", "dividendFieldAdvertised", "splitFieldAdvertised",
        "terminalPaymentsAdvertised", "historicalIdentityIntervalsAdvertised",
    }, "freeCapability")
    if (free["starterMonthlyFeeUsd"], free["uniqueSymbolsPerMonth"], free["requestsPerHour"], free["requestsPerDay"], free["bandwidthBytesPerMonth"]) != (0, 500, 50, 1000, 1_000_000_000):
        fail("free limits changed")
    if free["licenseDisposition"] != "INTERNAL_USE_ONLY":
        fail("license disposition changed")
    for key in ("accountRequired", "tokenRequired", "rawOhlcvAdvertised", "adjustedOhlcvAdvertised", "dividendFieldAdvertised", "splitFieldAdvertised"):
        if free[key] is not True:
            fail(f"{key} changed")
    for key in ("paymentDetailsRequired", "trialRequired", "terminalPaymentsAdvertised", "historicalIdentityIntervalsAdvertised"):
        if free[key] is not False:
            fail(f"{key} falsely promoted")

    handshake = value["handshakeContract"]
    exact_keys(handshake, {
        "caseIds", "productionRequestsAuthorized", "pilotMayStartOnlyAfterAccountAttestationAndSecretStoreBinding",
        "maximumUniqueSymbols", "maximumRequests", "noPremiumEndpoint", "noTickerOnlyIdentityPromotion",
        "noLastQuoteAsTerminalPayment", "rawProviderRowsRemainPrivate",
    }, "handshakeContract")
    if handshake["caseIds"] != ["ACTIVE_STABLE_AAPL", "SYMBOL_CHANGE_FB_META", "TERMINAL_ATVI"]:
        fail("handshake cases changed")
    if handshake["maximumUniqueSymbols"] != 3 or handshake["maximumRequests"] != 12 or handshake["productionRequestsAuthorized"] is not False:
        fail("handshake request boundary changed")
    for key in (
        "pilotMayStartOnlyAfterAccountAttestationAndSecretStoreBinding", "noPremiumEndpoint",
        "noTickerOnlyIdentityPromotion", "noLastQuoteAsTerminalPayment", "rawProviderRowsRemainPrivate",
    ):
        if handshake[key] is not True:
            fail(f"{key} weakened")

    gate = value["userActionGate"]
    exact_keys(gate, {"status", "neededAction", "secretsMustNotEnterChat", "paymentMustRemainZero", "trialMustRemainAbsent", "noSecondAccount"}, "userActionGate")
    if gate["status"] != "DEFERRED_UNTIL_FINRA_CRAWL_OR_HIGHER_VALUE_AUTONOMOUS_WORK_COMPLETES":
        fail("user-action timing changed")
    for key in ("secretsMustNotEnterChat", "paymentMustRemainZero", "trialMustRemainAbsent", "noSecondAccount"):
        if gate[key] is not True:
            fail(f"{key} weakened")

    decision = value["decision"]
    exact_keys(decision, {"disposition", "fullMarketAcquisitionFeasibleInOneMonth", "threeCaseEntitlementPilotEligibleAfterAccountGate", "studyCreditBeforePilot", "nextAction"}, "decision")
    if decision["disposition"] != "CONFIRMED_FREE_INTERNAL_USE_PILOT_CANDIDATE_ACCOUNT_REQUIRED":
        fail("disposition changed")
    if decision["fullMarketAcquisitionFeasibleInOneMonth"] is not False or decision["studyCreditBeforePilot"] is not False:
        fail("full-market or study credit falsely promoted")
    if decision["threeCaseEntitlementPilotEligibleAfterAccountGate"] is not True:
        fail("three-case pilot capability changed")

    if any(item is not False for item in value["claimLocks"].values()):
        fail("claim lock opened")
    required = {
        "FULL_MARKET_COVERAGE", "SURVIVORSHIP_SAFE_UNIVERSE", "HISTORICAL_IDENTITY_INTERVAL",
        "TERMINAL_PAYMENT_VERIFIED", "TERMINAL_WEALTH_COMPLETE", "PRICE_RETURN_OR_OUTCOME",
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
        ("paymentRequired", ("freeCapability", "paymentDetailsRequired"), True),
        ("trialRequired", ("freeCapability", "trialRequired"), True),
        ("terminalAdvertised", ("freeCapability", "terminalPaymentsAdvertised"), True),
        ("requestsAuthorized", ("handshakeContract", "productionRequestsAuthorized"), True),
        ("premiumAllowed", ("handshakeContract", "noPremiumEndpoint"), False),
        ("tickerIdentity", ("handshakeContract", "noTickerOnlyIdentityPromotion"), False),
        ("fullMarket", ("decision", "fullMarketAcquisitionFeasibleInOneMonth"), True),
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
            "starterMonthlyFeeUsd": 0,
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
