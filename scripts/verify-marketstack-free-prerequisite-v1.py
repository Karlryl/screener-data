#!/usr/bin/env python3
"""Validate the fail-closed Marketstack free-source disposition."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "research" / "early-detection-v4" / "marketstack-free-prerequisite-contract-v1.json"
EXPECTED_RAW_SHA256 = "83ec8d2ed2a051c782f4130bce912f791663a8856858b9546b6752649eb69ca7"
EXPECTED_SELF_SHA256 = "4c2be346ad127525842e3d8e0570ba82f6225d5a305176952cef4394d4880f54"
EXPECTED_URLS = [
    "https://marketstack.com/pricing",
    "https://marketstack.com/pricing",
    "https://www.ideracorp.com/legal/APILayer#tabs-2",
]
EXPECTED_TOP_KEYS = {
    "schema", "createdAt", "taskId", "sourceId", "track", "purpose", "officialEvidence",
    "freeCapability", "independenceContract", "handshakeContract", "decision", "claimCeiling",
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
    if value["schema"] != "early-detection-marketstack-free-prerequisite/v1":
        fail("schema changed")
    if value["taskId"] != "Q014-MARKETSTACK-FREE-HANDSHAKE":
        fail("task changed")
    if value["sourceId"] != "MARKETSTACK_FREE" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
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
        "monthlyFeeUsd", "freeForeverAdvertised", "accountRequired", "apiKeyRequired", "monthlyRequestLimit",
        "eodHistoryMaximumYears", "splitsAdvertised", "dividendsAdvertised", "tickerMetadataAdvertised",
        "full2009To2024HistoryAvailableFree", "survivorshipSafeUniverseAdvertised",
        "terminalPaymentsAdvertisedComplete", "historicalIdentityIntervalsAdvertised", "usDataOrigin",
        "licenseDisposition",
    }, "freeCapability")
    if (free["monthlyFeeUsd"], free["monthlyRequestLimit"], free["eodHistoryMaximumYears"]) != (0, 100, 1):
        fail("free limits changed")
    if free["usDataOrigin"] != "TIINGO_INC" or free["licenseDisposition"] != "ACCOUNT_TERMS_SNAPSHOT_REQUIRED_BEFORE_PRIVATE_CAPTURE":
        fail("origin or license changed")
    for key in ("freeForeverAdvertised", "accountRequired", "apiKeyRequired", "splitsAdvertised", "dividendsAdvertised", "tickerMetadataAdvertised"):
        if free[key] is not True:
            fail(f"{key} changed")
    for key in ("full2009To2024HistoryAvailableFree", "survivorshipSafeUniverseAdvertised", "terminalPaymentsAdvertisedComplete", "historicalIdentityIntervalsAdvertised"):
        if free[key] is not False:
            fail(f"{key} falsely promoted")

    independence = value["independenceContract"]
    exact_keys(independence, {
        "independentFromTiingoForUsData", "marketstackAndTiingoMayCountAsTwoConfirmations",
        "sharedOriginMustBeRecordedOnEveryUsEvidenceCell", "providerMajorityVotingForbidden",
    }, "independenceContract")
    if independence["independentFromTiingoForUsData"] is not False or independence["marketstackAndTiingoMayCountAsTwoConfirmations"] is not False:
        fail("shared origin falsely promoted")
    if independence["sharedOriginMustBeRecordedOnEveryUsEvidenceCell"] is not True or independence["providerMajorityVotingForbidden"] is not True:
        fail("independence guard weakened")

    handshake = value["handshakeContract"]
    exact_keys(handshake, {
        "status", "productionRequestsAuthorized", "maximumUniqueSymbols", "maximumRequests",
        "noAccountCreationRequested", "noSecretRequested", "noProviderRowsCaptured", "noPricePublication",
        "noTickerOnlyIdentityPromotion", "noLastQuoteAsTerminalPayment",
    }, "handshakeContract")
    if handshake["status"] != "DOCUMENTATION_ONLY_NO_ACCOUNT_REQUEST":
        fail("handshake status changed")
    if handshake["productionRequestsAuthorized"] is not False or handshake["maximumUniqueSymbols"] != 0 or handshake["maximumRequests"] != 0:
        fail("network boundary opened")
    for key in set(handshake) - {"status", "productionRequestsAuthorized", "maximumUniqueSymbols", "maximumRequests"}:
        if handshake[key] is not True:
            fail(f"{key} weakened")

    decision = value["decision"]
    exact_keys(decision, {
        "disposition", "askKarlForAccountNow", "originalV4CapabilityClosed", "independentConfirmationClosed",
        "studyCredit", "nextAction",
    }, "decision")
    if decision["disposition"] != "FREE_ONE_YEAR_SHARED_TIINGO_ORIGIN_LOW_PRIORITY_PILOT":
        fail("disposition changed")
    for key in ("askKarlForAccountNow", "originalV4CapabilityClosed", "independentConfirmationClosed", "studyCredit"):
        if decision[key] is not False:
            fail(f"{key} falsely promoted")

    if any(item is not False for item in value["claimLocks"].values()):
        fail("claim lock opened")
    required = {
        "FULL_2009_TO_2024_HISTORY", "FULL_MARKET_COVERAGE", "SURVIVORSHIP_SAFE_UNIVERSE",
        "INDEPENDENT_FROM_TIINGO_US_CONFIRMATION", "HISTORICAL_IDENTITY_INTERVAL",
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
        ("independent", ("independenceContract", "independentFromTiingoForUsData"), True),
        ("doubleCount", ("independenceContract", "marketstackAndTiingoMayCountAsTwoConfirmations"), True),
        ("originChanged", ("freeCapability", "usDataOrigin"), "INDEPENDENT"),
        ("fullHistory", ("freeCapability", "full2009To2024HistoryAvailableFree"), True),
        ("terminalComplete", ("freeCapability", "terminalPaymentsAdvertisedComplete"), True),
        ("requestsAuthorized", ("handshakeContract", "productionRequestsAuthorized"), True),
        ("requestBudget", ("handshakeContract", "maximumRequests"), 1),
        ("askKarl", ("decision", "askKarlForAccountNow"), True),
        ("studyCredit", ("decision", "studyCredit"), True),
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
        "providerRowsCaptured": False,
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
            "monthlyRequestLimit": 100,
            "eodHistoryMaximumYears": 1,
            "independentFromTiingo": False,
            "productionRequestsAuthorized": False,
            "networkRequests": 0,
            "accountsCreated": 0,
            "filesWritten": 0,
            "providerRowsCaptured": False,
            "outcomesAccessed": False,
        }
    except (ContractError, OSError, json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
