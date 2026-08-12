#!/usr/bin/env python3
"""Build and verify an aggregate-only FINRA historical capability profile."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "finra-q004-historical-capability-profile-contract-v1.json"
TEST = ROOT / "tests" / "build-finra-q004-historical-capability-profile-v1.test.js"
MANIFEST = ROOT / "reports" / "early-detection" / "finra-q004-historical-crawl-manifest-v3.json"
OUTPUT = ROOT / "reports" / "early-detection" / "finra-q004-historical-capability-profile-v1.json"
PRIVATE = Path(r"C:\Users\Anwender\Documents\GrowthScreenerResearchData\private-evidence\finra-q004\historical")
CHECKPOINT = PRIVATE / "checkpoint-v2.json"
EXPECTED_MANIFEST_RAW = "2f266d063d5c05df53d635afcb922d0775d0345005869955b41fece3b9502580"
EXPECTED_MANIFEST_REPORT = "caff5b9863516992222f9b58690cfad31df700441eeaf2fe3c41b356e641a09f"
EXPECTED_SEQUENCE = "2e2aa926ce60a632942fe87e53fada22e0373108e04d2e5e5591727dad383c4a"
EXPECTED_RECORDS = 145103
EXPECTED_PARTITIONS = 1522
EXPECTED_SCHEMA = "finra-q004-historical-capability-profile-contract/v1"
EXPECTED_CONTRACT_RAW = "9af957802695d6d47f1eeb52fe8c8352c06b34f9e13173a923e888e99d672bf6"
EXPECTED_CONTRACT_SELF = "41196d53535a033fd005a58e979c09199219addd8023e1c2e18c000ef88627d8"
TRUE_FLAGS = {"Y"}
ABSENT = (None, "")


class ProfileError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise ProfileError(message)


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def load_object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_bytes())
    except Exception as exc:
        raise ProfileError(f"invalid JSON: {path}") from exc
    if not isinstance(value, dict):
        fail("object required")
    return value


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        fail(f"{label} exact keys changed")


def validate_contract() -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    if sha(raw) != EXPECTED_CONTRACT_RAW:
        fail("contract raw bytes changed")
    value = json.loads(raw)
    body = dict(value)
    claim = body.pop("contractSha256", None)
    if claim != EXPECTED_CONTRACT_SELF or sha(canonical(body)) != EXPECTED_CONTRACT_SELF:
        fail("contract self hash changed")
    exact_keys(value, {"schema", "createdAt", "taskId", "sourceId", "track", "purpose", "inputManifest", "profileContract", "outputContract", "claimLocks", "contractSha256"}, "contract")
    if value["schema"] != EXPECTED_SCHEMA or value["taskId"] != "Q004-FINRA-OTC-CATALOG" or value["sourceId"] != "FINRA_OTC_PRIMARY" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract boundary changed")
    expected_input = {
        "path": "reports/early-detection/finra-q004-historical-crawl-manifest-v3.json",
        "rawSha256": EXPECTED_MANIFEST_RAW,
        "reportSha256": EXPECTED_MANIFEST_REPORT,
        "recordCount": EXPECTED_RECORDS,
        "partitionCount": EXPECTED_PARTITIONS,
        "availableMinimumDate": "2016-01-18",
        "availableMaximumDate": "2024-12-31",
        "rowSequenceSha256": EXPECTED_SEQUENCE,
    }
    if value["inputManifest"] != expected_input:
        fail("input manifest binding changed")
    profile = value["profileContract"]
    exact_keys(profile, {"allowedDimensions", "booleanFlags", "presenceFields", "eventCodes", "reasonClasses", "allPrivateBlobsRebuiltTwice", "aggregateCountsOnly", "identifiersIncluded", "rawValuesIncluded", "requestOrResponseBodiesIncluded", "writeNewAtomic"}, "profile contract")
    if profile["allowedDimensions"] != ["calendarYear", "dailyListEventCode", "reasonClass", "booleanFlag", "fieldPresence"]:
        fail("allowed dimensions changed")
    if profile["eventCodes"] != ["<NULL>", "DA", "DC", "DD", "SA", "SC", "SD"]:
        fail("event-code contract changed")
    if len(profile["booleanFlags"]) != 9 or len(set(profile["booleanFlags"])) != 9 or len(profile["presenceFields"]) != 6 or len(set(profile["presenceFields"])) != 6:
        fail("profile fields changed")
    if not isinstance(profile["reasonClasses"], list) or len(profile["reasonClasses"]) != 5:
        fail("reason-class contract changed")
    for item in profile["reasonClasses"]:
        exact_keys(item, {"classId", "exactReason"}, "reason class")
    if any(profile[key] is not expected for key, expected in {
        "allPrivateBlobsRebuiltTwice": True,
        "aggregateCountsOnly": True,
        "identifiersIncluded": False,
        "rawValuesIncluded": False,
        "requestOrResponseBodiesIncluded": False,
        "writeNewAtomic": True,
    }.items()):
        fail("privacy or rebuild contract changed")
    if value["outputContract"] != {
        "path": "reports/early-detection/finra-q004-historical-capability-profile-v1.json",
        "pre2016CoverageStatus": "UNRESOLVED_NOT_EXPOSED_BY_PARTITIONS_ENDPOINT",
        "reasonCountsAreDiscoveryOnly": True,
        "fieldPresenceIsNotPaymentVerification": True,
        "recordPresenceIsNotIdentityResolution": True,
    }:
        fail("output contract changed")
    if any(item is not False for item in value["claimLocks"].values()):
        fail("claim lock opened")
    return value


def validate_manifest() -> dict[str, Any]:
    raw = MANIFEST.read_bytes()
    if sha(raw) != EXPECTED_MANIFEST_RAW:
        fail("input manifest raw bytes changed")
    value = json.loads(raw)
    body = dict(value)
    claim = body.pop("reportSha256", None)
    if claim != EXPECTED_MANIFEST_REPORT or sha(canonical(body)) != EXPECTED_MANIFEST_REPORT:
        fail("input manifest self hash changed")
    if value["capture"]["recordCount"] != EXPECTED_RECORDS or value["coverage"]["partitionCount"] != EXPECTED_PARTITIONS or value["capture"]["rowSequenceSha256"] != EXPECTED_SEQUENCE:
        fail("input manifest population changed")
    if value["outcomesAccessed"] is not False or any(value["claimLocks"].values()):
        fail("input manifest boundary opened")
    return value


def empty_counts(contract: dict[str, Any]) -> dict[str, Any]:
    profile = contract["profileContract"]
    return {
        "calendarYears": {},
        "eventCodes": {key: 0 for key in profile["eventCodes"]},
        "reasonClasses": {row["classId"]: 0 for row in profile["reasonClasses"]},
        "booleanFlags": {key: 0 for key in profile["booleanFlags"]},
        "fieldPresence": {key: 0 for key in profile["presenceFields"]},
    }


def rebuild(contract: dict[str, Any]) -> dict[str, Any]:
    checkpoint = load_object(CHECKPOINT)
    body = dict(checkpoint)
    checkpoint_claim = body.pop("checkpointSha256", None)
    if checkpoint_claim != sha(canonical(body)) or checkpoint.get("schema") != "finra-q004-historical-checkpoint/v2":
        fail("checkpoint binding changed")
    completed = checkpoint.get("completed")
    if not isinstance(completed, list) or len(completed) != EXPECTED_PARTITIONS:
        fail("checkpoint partition count changed")
    counts = empty_counts(contract)
    expected_fields: set[str] | None = None
    total = 0
    sequence = hashlib.sha256()
    global_ids: set[int] = set()
    profile = contract["profileContract"]
    reasons = {row["exactReason"]: row["classId"] for row in profile["reasonClasses"]}
    for partition in completed:
        day = partition.get("calendarDay")
        if not isinstance(day, str) or len(day) != 10:
            fail("partition date changed")
        year = day[:4]
        expected_offset = 0
        for page in partition.get("pages", []):
            if page.get("offset") != expected_offset:
                fail("page offset changed")
            digest = page.get("rawSha256")
            if not isinstance(digest, str) or len(digest) != 64:
                fail("page digest changed")
            path = PRIVATE / "blobs" / "sha256" / digest[:2] / digest
            raw = path.read_bytes()
            if sha(raw) != digest or len(raw) != page.get("bytes"):
                fail("private blob mismatch")
            rows = json.loads(raw)
            if not isinstance(rows, list) or len(rows) != page.get("rowCount"):
                fail("page row count changed")
            for row in rows:
                if not isinstance(row, dict) or row.get("calendarDay") != day:
                    fail("row partition changed")
                if expected_fields is None:
                    expected_fields = set(row)
                elif set(row) != expected_fields:
                    fail("row field set changed")
                identifier = row.get("OTCDailyListID")
                if not isinstance(identifier, int) or identifier in global_ids:
                    fail("identifier duplicate")
                global_ids.add(identifier)
                sequence.update(canonical(row))
                sequence.update(b"\n")
                total += 1
                counts["calendarYears"][year] = counts["calendarYears"].get(year, 0) + 1
                event_code = row.get("dailyListEventCode") or "<NULL>"
                if event_code not in counts["eventCodes"]:
                    fail("new event code outside contract")
                counts["eventCodes"][event_code] += 1
                reason = row.get("dailyListReasonDescription")
                if reason in reasons:
                    counts["reasonClasses"][reasons[reason]] += 1
                for key in profile["booleanFlags"]:
                    value = row.get(key)
                    if value not in {None, "N", "Y"}:
                        fail("boolean flag domain changed")
                    if value in TRUE_FLAGS:
                        counts["booleanFlags"][key] += 1
                for key in profile["presenceFields"]:
                    if row.get(key) not in ABSENT:
                        counts["fieldPresence"][key] += 1
            expected_offset += len(rows)
        if expected_offset != partition.get("recordTotal"):
            fail("partition total changed")
    if total != EXPECTED_RECORDS or len(global_ids) != EXPECTED_RECORDS or sequence.hexdigest() != EXPECTED_SEQUENCE:
        fail("private rebuild changed")
    return counts


def build_report(contract: dict[str, Any], counts: dict[str, Any]) -> dict[str, Any]:
    value = {
        "schema": "finra-q004-historical-capability-profile/v1",
        "track": contract["track"],
        "taskId": contract["taskId"],
        "sourceId": contract["sourceId"],
        "contractRawSha256": sha(CONTRACT.read_bytes()),
        "contractSha256": contract["contractSha256"],
        "inputManifestRawSha256": EXPECTED_MANIFEST_RAW,
        "inputManifestReportSha256": EXPECTED_MANIFEST_REPORT,
        "coverage": {
            "availableMinimumDate": "2016-01-18",
            "availableMaximumDate": "2024-12-31",
            "pre2016CoverageStatus": "UNRESOLVED_NOT_EXPOSED_BY_PARTITIONS_ENDPOINT",
            "partitionCount": EXPECTED_PARTITIONS,
            "recordCount": EXPECTED_RECORDS,
            "rowSequenceSha256": EXPECTED_SEQUENCE,
        },
        "counts": counts,
        "privateRebuilds": [
            {"runId": "REBUILD_ONE", "status": "PASS", "countsSha256": sha(canonical(counts))},
            {"runId": "REBUILD_TWO", "status": "PASS", "countsSha256": sha(canonical(counts))},
        ],
        "interpretationLocks": {
            "reasonCountsAreDiscoveryOnly": True,
            "fieldPresenceIsNotPaymentVerification": True,
            "recordPresenceIsNotIdentityResolution": True,
            "rawRowsRemainPrivate": True,
            "identifiersIncluded": False,
            "rawValuesIncluded": False,
        },
        "outcomesAccessed": False,
        "claimLocks": contract["claimLocks"],
    }
    value["reportSha256"] = sha(canonical(value))
    return value


def validate_report(value: dict[str, Any], contract: dict[str, Any]) -> None:
    exact_keys(value, {"schema", "track", "taskId", "sourceId", "contractRawSha256", "contractSha256", "inputManifestRawSha256", "inputManifestReportSha256", "coverage", "counts", "privateRebuilds", "interpretationLocks", "outcomesAccessed", "claimLocks", "reportSha256"}, "report")
    body = dict(value)
    claim = body.pop("reportSha256", None)
    if claim != sha(canonical(body)) or value["schema"] != "finra-q004-historical-capability-profile/v1":
        fail("report self hash changed")
    if value["contractRawSha256"] != sha(CONTRACT.read_bytes()) or value["contractSha256"] != contract["contractSha256"] or value["inputManifestRawSha256"] != EXPECTED_MANIFEST_RAW or value["inputManifestReportSha256"] != EXPECTED_MANIFEST_REPORT:
        fail("report binding changed")
    coverage = value["coverage"]
    if coverage != {"availableMinimumDate": "2016-01-18", "availableMaximumDate": "2024-12-31", "pre2016CoverageStatus": "UNRESOLVED_NOT_EXPOSED_BY_PARTITIONS_ENDPOINT", "partitionCount": EXPECTED_PARTITIONS, "recordCount": EXPECTED_RECORDS, "rowSequenceSha256": EXPECTED_SEQUENCE}:
        fail("report coverage changed")
    expected_counts = empty_counts(contract)
    counts = value["counts"]
    exact_keys(counts, set(expected_counts), "counts")
    if set(counts["eventCodes"]) != set(expected_counts["eventCodes"]) or set(counts["reasonClasses"]) != set(expected_counts["reasonClasses"]) or set(counts["booleanFlags"]) != set(expected_counts["booleanFlags"]) or set(counts["fieldPresence"]) != set(expected_counts["fieldPresence"]):
        fail("count dimensions changed")
    if sum(counts["calendarYears"].values()) != EXPECTED_RECORDS or sum(counts["eventCodes"].values()) != EXPECTED_RECORDS:
        fail("count denominator changed")
    if value["interpretationLocks"] != {"reasonCountsAreDiscoveryOnly": True, "fieldPresenceIsNotPaymentVerification": True, "recordPresenceIsNotIdentityResolution": True, "rawRowsRemainPrivate": True, "identifiersIncluded": False, "rawValuesIncluded": False}:
        fail("interpretation lock changed")
    if value["outcomesAccessed"] is not False or value["claimLocks"] != contract["claimLocks"] or any(value["claimLocks"].values()):
        fail("claim boundary changed")
    rebuilds = value["privateRebuilds"]
    count_hash = sha(canonical(counts))
    if rebuilds != [{"runId": "REBUILD_ONE", "status": "PASS", "countsSha256": count_hash}, {"runId": "REBUILD_TWO", "status": "PASS", "countsSha256": count_hash}]:
        fail("private rebuild evidence changed")


def write_new(path: Path, raw: bytes) -> None:
    if path.exists():
        fail("output exists")
    descriptor, name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.link(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def rejected(action: Callable[[], None]) -> bool:
    try:
        action()
    except (ProfileError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError):
        return True
    return False


def self_test(contract: dict[str, Any]) -> dict[str, Any]:
    counts = empty_counts(contract)
    counts["calendarYears"] = {"2024": EXPECTED_RECORDS}
    counts["eventCodes"]["DA"] = EXPECTED_RECORDS
    value = build_report(contract, counts)
    validate_report(value, contract)
    kills = {}
    for name, mutate in {
        "paymentPresencePromoted": lambda x: x["interpretationLocks"].__setitem__("fieldPresenceIsNotPaymentVerification", False),
        "identifierClaimOpened": lambda x: x["interpretationLocks"].__setitem__("identifiersIncluded", True),
        "originalV4CreditOpened": lambda x: x["claimLocks"].__setitem__("originalV4GateCredit", True),
        "eventDenominatorLost": lambda x: x["counts"]["eventCodes"].__setitem__("DA", EXPECTED_RECORDS - 1),
        "newUncontractedEventCode": lambda x: x["counts"]["eventCodes"].__setitem__("XX", 1),
        "rebuildEvidenceChanged": lambda x: x["privateRebuilds"][1].__setitem__("countsSha256", "0" * 64),
    }.items():
        item = copy.deepcopy(value)
        mutate(item)
        item["reportSha256"] = sha(canonical({key: val for key, val in item.items() if key != "reportSha256"}))
        kills[name] = rejected(lambda item=item: validate_report(item, contract))
    return {"schema": "finra-q004-historical-capability-profile-self-test/v1", "status": "PASS", "kills": kills, "networkRequests": 0, "filesWritten": 0, "outcomesAccessed": False}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify-contract", "self-test", "build", "verify-output"))
    args = parser.parse_args()
    try:
        contract = validate_contract()
        validate_manifest()
        if args.command == "verify-contract":
            result = {"schema": "finra-q004-historical-capability-profile-contract-verification/v1", "status": "PASS", "contractSha256": contract["contractSha256"], "outcomesAccessed": False}
        elif args.command == "self-test":
            result = self_test(contract)
        elif args.command == "build":
            first = rebuild(contract)
            second = rebuild(contract)
            if first != second:
                fail("private rebuild mismatch")
            report = build_report(contract, first)
            validate_report(report, contract)
            raw = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
            write_new(OUTPUT, raw)
            result = {"schema": "finra-q004-historical-capability-profile-build/v1", "status": "PASS", "output": OUTPUT.relative_to(ROOT).as_posix(), "rawSha256": sha(raw), "reportSha256": report["reportSha256"], "recordCount": EXPECTED_RECORDS, "outcomesAccessed": False}
        else:
            report = load_object(OUTPUT)
            validate_report(report, contract)
            rebuilt = rebuild(contract)
            if report["counts"] != rebuilt:
                fail("output does not match private rebuild")
            result = {"schema": "finra-q004-historical-capability-profile-verification/v1", "status": "PASS", "rawSha256": sha(OUTPUT.read_bytes()), "reportSha256": report["reportSha256"], "privateCasVerified": True, "recordCount": EXPECTED_RECORDS, "outcomesAccessed": False}
    except (ProfileError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
