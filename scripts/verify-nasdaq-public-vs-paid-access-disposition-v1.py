#!/usr/bin/env python3
"""Validate Nasdaq public-point versus paid-history disposition."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "research" / "early-detection-v4" / "nasdaq-public-vs-paid-access-disposition-contract-v1.json"
EXPECTED_RAW_SHA256 = "e98310267a9c43bd1369d0a193a52a84e7f08a18986e7baeac9354a818a99dad"
EXPECTED_SELF_SHA256 = "a286b3236db89fc59af85c735a572b60e1466c110e26a2ed28573b330bd22331"
EXPECTED_URLS = [
    "https://nasdaqtrader.com/Trader.aspx?id=DailyListPD",
    "https://www.nasdaqtrader.com/TraderNews.aspx?id=nva2004-8",
    "https://nasdaqtrader.com/Trader.aspx?id=SymbolDirDefs",
    "https://nasdaqtrader.com/trader.aspx?id=symbollookup",
]
EXPECTED_TOP_KEYS = {
    "schema", "createdAt", "taskId", "sourceId", "track", "purpose", "officialEvidence",
    "accessClasses", "acquisitionBoundary", "decision", "claimCeiling", "claimLocks", "contractSha256",
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
    if value["schema"] != "early-detection-nasdaq-public-vs-paid-access-disposition/v1":
        fail("schema changed")
    if value["taskId"] != "Q011-NASDAQ-PUBLIC-ACCESS-DISPOSITION":
        fail("task changed")
    if value["sourceId"] != "NASDAQ_TRADER_PUBLIC_AND_DAILY_LIST" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
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

    classes = value["accessClasses"]
    exact_keys(classes, {"historicalDailyList", "publicSymbolDirectory", "publicNasdaqEventsData"}, "accessClasses")
    for key, expected in (
        ("historicalDailyList", ("PAID_SUBSCRIPTION_REQUIRED", False, False, "PROHIBITED_PAID")),
        ("publicSymbolDirectory", ("PUBLIC_NO_ACCOUNT", True, True, "CURRENT_POINT_STATE_ONLY_INTERNAL_NONCOMMERCIAL")),
        ("publicNasdaqEventsData", ("PUBLIC_NO_FURTHER_LICENSE", True, True, "CURRENT_EVENT_POINT_EVIDENCE_ONLY")),
    ):
        row = classes[key]
        exact_keys(row, {"costDisposition", "freeAcquisitionAuthorized", "automatedAcquisitionAuthorized", "studyUse"}, key)
        actual = (row["costDisposition"], row["freeAcquisitionAuthorized"], row["automatedAcquisitionAuthorized"], row["studyUse"])
        if actual != expected:
            fail(f"{key} access disposition changed")

    boundary = value["acquisitionBoundary"]
    exact_keys(boundary, {
        "productionRequestsAuthorized", "futurePublicCaptureMayUseOnlyWhitelistedPublicFiles",
        "futureCaptureMustStoreObservedAtAndFileGenerationTimestamp", "historicalBackfillFromCurrentDirectoriesForbidden",
        "dailyListLoginOrSubscriptionForbidden", "cusipAcquisitionForbidden", "noTickerOnlyIdentityPromotion",
        "noPointStateAsHistoricalInterval", "noEventDateAsTerminalWealth",
    }, "acquisitionBoundary")
    if boundary["productionRequestsAuthorized"] is not False:
        fail("production requests opened")
    for key in set(boundary) - {"productionRequestsAuthorized"}:
        if boundary[key] is not True:
            fail(f"{key} weakened")

    decision = value["decision"]
    exact_keys(decision, {
        "disposition", "userActionRequired", "historicalDailyListEligible",
        "publicPointSnapshotEligibleAfterCaptureContract", "originalV4CapabilityClosed", "nextAction",
    }, "decision")
    if decision["disposition"] != "PUBLIC_POINT_STATE_ELIGIBLE_PAID_HISTORICAL_DAILY_LIST_PROHIBITED":
        fail("disposition changed")
    if decision["userActionRequired"] is not False or decision["historicalDailyListEligible"] is not False or decision["originalV4CapabilityClosed"] is not False:
        fail("paid, user-action or original capability falsely promoted")
    if decision["publicPointSnapshotEligibleAfterCaptureContract"] is not True:
        fail("public point eligibility changed")

    if any(item is not False for item in value["claimLocks"].values()):
        fail("claim lock opened")
    required = {
        "HISTORICAL_DAILY_LIST_ACQUIRED_FREE", "HISTORICAL_IDENTITY_INTERVAL", "COMPLETE_CORPORATE_ACTION_CHAIN",
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
        ("dailyListFree", ("accessClasses", "historicalDailyList", "freeAcquisitionAuthorized"), True),
        ("dailyListAutomated", ("accessClasses", "historicalDailyList", "automatedAcquisitionAuthorized"), True),
        ("dailyListEligible", ("decision", "historicalDailyListEligible"), True),
        ("userAction", ("decision", "userActionRequired"), True),
        ("requestsAuthorized", ("acquisitionBoundary", "productionRequestsAuthorized"), True),
        ("loginAllowed", ("acquisitionBoundary", "dailyListLoginOrSubscriptionForbidden"), False),
        ("cusipAllowed", ("acquisitionBoundary", "cusipAcquisitionForbidden"), False),
        ("pointAsInterval", ("acquisitionBoundary", "noPointStateAsHistoricalInterval"), False),
        ("originalClosed", ("decision", "originalV4CapabilityClosed"), True),
        ("originalCredit", ("claimLocks", "originalV4GateCredit"), True),
    ):
        item = copy.deepcopy(source)
        target: Any = item
        for part in path[:-1]:
            target = target[part]
        target[path[-1]] = replacement
        mutations[name] = item
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
            "historicalDailyListEligible": False,
            "publicPointSnapshotEligibleAfterCaptureContract": True,
            "productionRequestsAuthorized": False,
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
