#!/usr/bin/env python3
"""Validate the fail-closed CourtListener/RECAP free API prerequisite."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "research" / "early-detection-v4" / "courtlistener-recap-free-api-prerequisite-contract-v1.json"
EXPECTED_RAW_SHA256 = "c84d6a17faebc48a3d5170669cc176755db9fe4a8031b3100a1ea0722a2198c2"
EXPECTED_SELF_SHA256 = "f8342511f58f4ceedd849472130bf512eb117cfd974282fe5efacc6254888f2b"
EXPECTED_TOP_KEYS = {
    "schema", "createdAt", "taskId", "sourceId", "track", "purpose", "officialEvidence",
    "freeCapability", "userActionGate", "decision", "claimCeiling", "claimLocks", "contractSha256",
}
EXPECTED_URLS = [
    "https://wiki.free.law/c/courtlistener/help/api/rest/v4/overview",
    "https://free.law/membership/",
    "https://wiki.free.law/c/courtlistener/help/api/rest/v4/recap",
    "https://www.courtlistener.com/profile/api-token/",
]
EXPECTED_LOCKS = {
    "productionRequestsAuthorized", "accountAttested", "tokenStored", "pacerCredentialsUsed",
    "pacerPurchaseMade", "archiveCompletenessClaimed", "terminalPaymentVerified",
    "terminalWealthComplete", "pricesAccessed", "returnsAccessed", "outcomesAccessed",
    "originalV4GateCredit", "humanAttestation",
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
    if value["schema"] != "early-detection-courtlistener-recap-free-api-prerequisite/v1":
        fail("schema changed")
    if value["taskId"] != "Q011-COURTLISTENER-RECAP-FREE-API-PREREQUISITE":
        fail("task changed")
    if value["sourceId"] != "COURTLISTENER_RECAP" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
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
        "freeNonMemberTierPublished", "paymentDetailsRequired", "trialRequired",
        "accountRequiredForProduction", "tokenRequiredForProduction", "requestsPerMinute",
        "requestsPerHour", "requestsPerDay", "multipleAccountsAllowed", "existingArchiveReadCandidate",
        "pacerPurchasesAllowed", "recapFetchAllowed", "paidMembershipAllowed",
    }, "freeCapability")
    if free["freeNonMemberTierPublished"] is not True or free["existingArchiveReadCandidate"] is not True:
        fail("free archive-read capability changed")
    if free["accountRequiredForProduction"] is not True or free["tokenRequiredForProduction"] is not True:
        fail("account or token prerequisite weakened")
    if (free["requestsPerMinute"], free["requestsPerHour"], free["requestsPerDay"]) != (5, 50, 125):
        fail("free rate limits changed")
    for key in (
        "paymentDetailsRequired", "trialRequired", "multipleAccountsAllowed", "pacerPurchasesAllowed",
        "recapFetchAllowed", "paidMembershipAllowed",
    ):
        if free[key] is not False:
            fail(f"{key} boundary weakened")

    gate = value["userActionGate"]
    exact_keys(gate, {
        "status", "neededAction", "secretsMustNotEnterChat", "paymentMustRemainZero",
        "trialMustRemainAbsent", "noPacerCredentials", "noPacerPurchase", "noSecondAccount",
    }, "userActionGate")
    if gate["status"] != "DEFERRED_UNTIL_FINRA_CRAWL_OR_HIGHER_VALUE_AUTONOMOUS_WORK_COMPLETES":
        fail("user-action timing changed")
    for key in (
        "secretsMustNotEnterChat", "paymentMustRemainZero", "trialMustRemainAbsent",
        "noPacerCredentials", "noPacerPurchase", "noSecondAccount",
    ):
        if gate[key] is not True:
            fail(f"{key} weakened")

    decision = value["decision"]
    exact_keys(decision, {
        "disposition", "productionRequestsAuthorized",
        "pilotMayStartOnlyAfterAccountAttestationAndSecretStoreBinding", "pilotScope", "nextAction",
    }, "decision")
    if decision["disposition"] != "FREE_ACCOUNT_REQUIRED_EXISTING_RECAP_READ_PILOT_CANDIDATE":
        fail("disposition changed")
    if decision["productionRequestsAuthorized"] is not False:
        fail("production requests falsely authorized")
    if decision["pilotMayStartOnlyAfterAccountAttestationAndSecretStoreBinding"] is not True:
        fail("account gate weakened")
    if decision["pilotScope"] != "QUERY_ONLY_EXISTING_RECAP_ARCHIVE_FOR_PRESELECTED_TERMINAL_EVENT_CASES":
        fail("pilot scope changed")

    exact_keys(value["claimLocks"], EXPECTED_LOCKS, "claimLocks")
    if any(item is not False for item in value["claimLocks"].values()):
        fail("claim lock opened")
    required = {
        "PACER_PURCHASE", "RECAP_ARCHIVE_COMPLETENESS", "HISTORICAL_IDENTITY_INTERVAL",
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
        ("secondAccount", ("freeCapability", "multipleAccountsAllowed"), True),
        ("pacerPurchase", ("freeCapability", "pacerPurchasesAllowed"), True),
        ("recapFetch", ("freeCapability", "recapFetchAllowed"), True),
        ("requestsAuthorized", ("decision", "productionRequestsAuthorized"), True),
        ("terminalVerified", ("claimLocks", "terminalPaymentVerified"), True),
        ("originalCredit", ("claimLocks", "originalV4GateCredit"), True),
    ):
        item = copy.deepcopy(source)
        item[path[0]][path[1]] = replacement
        mutations[name] = item
    mutations["scopeWidened"] = copy.deepcopy(source)
    mutations["scopeWidened"]["decision"]["pilotScope"] = "BUY_MISSING_PACER_CONTENT"
    mutations["forbiddenRemoved"] = copy.deepcopy(source)
    mutations["forbiddenRemoved"]["claimCeiling"]["forbidden"].remove("PACER_PURCHASE")
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
            "productionRequestsAuthorized": False,
            "pacerPurchasesAllowed": False,
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
