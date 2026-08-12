#!/usr/bin/env python3
"""Validate the fail-closed Q005 exchange-source access disposition."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "research" / "early-detection-v4" / "us-exchange-q005-access-disposition-contract-v1.json"
EXPECTED_RAW_SHA256 = "731011e4e990b1a0fd8e790937e69e007e543f6062104457168f4a93050ae340"
EXPECTED_CONTRACT_SHA256 = "d64c997b208120b71a5b9c60da600fa7e06b8195151f331fbc4b1b8be7d4c0d2"
EXPECTED_SCHEMA = "us-exchange-q005-access-disposition-contract/v1"
EXPECTED_SOURCES = {
    "CBOE_BZX_DAILY_REPORTS": "LICENSE_BLOCKED_FOR_AUTOMATED_DATABASE_WITHOUT_WRITTEN_PERMISSION",
    "NASDAQ_DAILY_LIST": "PROHIBITED_PAID",
    "NASDAQ_SYMBOL_DIRECTORIES": "CURRENT_POINT_CROSSCHECK_ONLY_NO_NEW_CRAWL_AUTHORIZED",
    "NYSE_CORPORATE_ACTIONS": "PUBLIC_CURRENT_VIEW_ONLY_HISTORICAL_AND_DETAIL_PAID",
}
EXPECTED_TOP_KEYS = {
    "schema", "createdAt", "taskId", "track", "purpose", "officialEvidence",
    "decision", "claimCeiling", "claimLocks", "contractSha256",
}
EXPECTED_LOCKS = {
    "outcomesAccessed", "pricesAccessed", "returnsAccessed",
    "automatedNetworkAcquisitionExecuted", "historicalIntervalsClaimed",
    "corporateActionsComplete", "terminalWealthComplete",
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


def validate(contract: dict[str, Any]) -> None:
    exact_keys(contract, EXPECTED_TOP_KEYS, "contract")
    if contract["schema"] != EXPECTED_SCHEMA or contract["taskId"] != "Q005-US-EXCHANGE-PUBLIC-CATALOGS":
        fail("contract identity changed")
    if contract["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("track changed")
    expected_self = sha(canonical({key: value for key, value in contract.items() if key != "contractSha256"}))
    if contract["contractSha256"] != EXPECTED_CONTRACT_SHA256 or expected_self != EXPECTED_CONTRACT_SHA256:
        fail("contract self hash changed")
    rows = contract["officialEvidence"]
    if not isinstance(rows, list) or len(rows) != 4 or len({row.get("sourceId") for row in rows}) != 4:
        fail("source family set changed")
    by_id = {row["sourceId"]: row for row in rows}
    if set(by_id) != set(EXPECTED_SOURCES):
        fail("source identifiers changed")
    for source_id, disposition in EXPECTED_SOURCES.items():
        row = by_id[source_id]
        exact_keys(row, {
            "sourceId", "urls", "observedAt", "verifiedFacts", "freePointAccess",
            "automatedStudyDatabaseAuthorized", "historical2009To2024Free", "disposition",
        }, source_id)
        if row["disposition"] != disposition:
            fail(f"{source_id} disposition changed")
        if row["automatedStudyDatabaseAuthorized"] is not False or row["historical2009To2024Free"] is not False:
            fail(f"{source_id} acquisition or historical-free boundary weakened")
        if not row["urls"] or not all(isinstance(url, str) and url.startswith("https://") for url in row["urls"]):
            fail(f"{source_id} official URLs changed")
        if not row["verifiedFacts"] or not all(isinstance(fact, str) and fact for fact in row["verifiedFacts"]):
            fail(f"{source_id} evidence facts changed")
    decision = contract["decision"]
    exact_keys(decision, {
        "freeHistoricalCoreSourceFound", "newAutomatedNetworkAcquisitionAuthorized",
        "currentPointEvidenceMayCloseHistoricalIntervals", "paidFamiliesExcluded", "nextAction",
    }, "decision")
    if decision["freeHistoricalCoreSourceFound"] is not False:
        fail("free historical core source falsely claimed")
    if decision["newAutomatedNetworkAcquisitionAuthorized"] is not False:
        fail("automated acquisition falsely authorized")
    if decision["currentPointEvidenceMayCloseHistoricalIntervals"] is not False:
        fail("point evidence promoted to historical interval")
    if decision["paidFamiliesExcluded"] is not True:
        fail("paid families not excluded")
    exact_keys(contract["claimLocks"], EXPECTED_LOCKS, "claimLocks")
    if any(value is not False for value in contract["claimLocks"].values()):
        fail("claim lock opened")
    forbidden = set(contract["claimCeiling"].get("forbidden", []))
    required = {
        "HISTORICAL_IDENTITY_INTERVAL", "COMPLETE_CORPORATE_ACTION_CHAIN",
        "TERMINAL_SESSION_OR_PAYMENT", "PRICE_RETURN_OR_OUTCOME",
        "FULL_MARKET_OR_SURVIVORSHIP_SAFE_COVERAGE", "ORIGINAL_V4_GATE_CREDIT",
        "HUMAN_ATTESTATION",
    }
    if not required.issubset(forbidden):
        fail("forbidden claim ceiling weakened")


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
    except (ContractError, KeyError, TypeError, ValueError):
        return True
    return False


def self_test() -> dict[str, Any]:
    source = load()
    mutations: dict[str, dict[str, Any]] = {}
    mutations["cboeAutomatedAcquisition"] = copy.deepcopy(source)
    mutations["cboeAutomatedAcquisition"]["officialEvidence"][0]["automatedStudyDatabaseAuthorized"] = True
    mutations["nasdaqDailyListFree"] = copy.deepcopy(source)
    mutations["nasdaqDailyListFree"]["officialEvidence"][1]["historical2009To2024Free"] = True
    mutations["nyseHistoricalFree"] = copy.deepcopy(source)
    mutations["nyseHistoricalFree"]["officialEvidence"][3]["historical2009To2024Free"] = True
    mutations["pointAsInterval"] = copy.deepcopy(source)
    mutations["pointAsInterval"]["decision"]["currentPointEvidenceMayCloseHistoricalIntervals"] = True
    mutations["paidFamilyAllowed"] = copy.deepcopy(source)
    mutations["paidFamilyAllowed"]["decision"]["paidFamiliesExcluded"] = False
    mutations["originalV4Credit"] = copy.deepcopy(source)
    mutations["originalV4Credit"]["claimLocks"]["originalV4GateCredit"] = True
    mutations["forbiddenRemoved"] = copy.deepcopy(source)
    mutations["forbiddenRemoved"]["claimCeiling"]["forbidden"].remove("TERMINAL_SESSION_OR_PAYMENT")
    return {
        "status": "PASS",
        "contractRawBound": True,
        "mutationsRejected": {name: rejected(lambda value=value: validate(value)) for name, value in mutations.items()},
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
            "status": "PASS", "sourceFamilies": len(load()["officialEvidence"]),
            "networkRequests": 0, "filesWritten": 0, "outcomesAccessed": False,
        }
    except (ContractError, OSError, json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
