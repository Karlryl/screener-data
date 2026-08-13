#!/usr/bin/env python3
"""Verify the zero-credit, zero-network SEC 13F source disposition."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-13f-official-list-disposition-contract-v2.json"
V1_CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-13f-official-list-private-pilot-contract-v1.json"
V1_RUNNER = ROOT / "scripts" / "run-sec-13f-official-list-private-pilot-v1.py"
V1_TEST = ROOT / "tests" / "run-sec-13f-official-list-private-pilot-v1.test.js"
EXPECTED_CONTRACT_RAW = "0f17d30808233fad2e76c64dd29b8e2bd56c99503848f72c42a9ccff0a1c41bf"
EXPECTED_CONTRACT_SELF = "1c19567c10402c228a2444bd5ac41d1dcdf8a8c719fe1849463381ed2d4f073b"
EXPECTED_V1_CONTRACT_RAW = "a432e808953f3208cb9f723c5e9778b7257dbbd0df4a7c25f5e359a2ab0e2018"
EXPECTED_REMEDIATED_RUNNER_RAW = "f74425b7915b6e38a0f2e537f3337373be575ca6f587283df794566592f4aa0c"
EXPECTED_REMEDIATED_TEST_RAW = "a05989fbfd56fb24a38a1e88dbde7194c909907767989058d390cc68c7ef6072"


class DispositionError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise DispositionError(message)


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def validate(value: dict[str, Any]) -> None:
    if set(value) != {
        "schema", "createdAt", "taskId", "track", "purpose", "supersededV1",
        "incidentDisposition", "remediationBindings", "sourceDisposition", "eligibilityCensus",
        "futureReconsiderationRequires", "claimCeiling", "claimLocks", "contractSha256",
    }:
        fail("contract exact keys changed")
    body = dict(value)
    claimed = body.pop("contractSha256")
    if claimed != EXPECTED_CONTRACT_SELF or sha(canonical(body)) != EXPECTED_CONTRACT_SELF:
        fail("contract self hash changed")
    if value["supersededV1"] != {
        "contractPath": "research/early-detection-v4/sec-13f-official-list-private-pilot-contract-v1.json",
        "contractRawSha256": EXPECTED_V1_CONTRACT_RAW,
        "introductionCommit": "a4a06368149efe67e8418e489510fd6e88d277a4",
        "introductionTag": 828,
        "historicalBytesRemainAppendOnly": True,
        "futureExecutionAuthorized": False,
        "studyCredit": "ZERO",
    }:
        fail("V1 disposition changed")
    incident = value["incidentDisposition"]
    if incident != {
        "classification": "PUBLIC_TEST_FIXTURE_CONTAINED_ONE_RIGHTS_BOUND_IDENTIFIER",
        "exactIdentifierRepeatedInDisposition": False,
        "identifierRemovedFromCurrentTree": True,
        "historyRewritePerformed": False,
        "historyRewriteForbiddenWithoutUserApproval": True,
        "providerPdfCaptured": False,
        "providerDatasetCaptured": False,
        "publicProviderRowsProduced": 0,
        "privateProviderRowsProduced": 0,
    }:
        fail("incident disclosure changed")
    if value["remediationBindings"] != {
        "runnerPath": "scripts/run-sec-13f-official-list-private-pilot-v1.py",
        "runnerRawSha256": EXPECTED_REMEDIATED_RUNNER_RAW,
        "testPath": "tests/run-sec-13f-official-list-private-pilot-v1.test.js",
        "testRawSha256": EXPECTED_REMEDIATED_TEST_RAW,
        "futureDataRequestFailsClosed": True,
    }:
        fail("remediation bindings changed")
    source = value["sourceDisposition"]
    if source["status"] != "QUARANTINED_RESTRICTED_INTERNAL_EVALUATION_ONLY":
        fail("source quarantine changed")
    for key in ("rawCusipPublicationAllowed", "issuerDescriptionPublicationAllowed", "automatedArchiveExecutionAuthorized", "identityCapabilityClosed", "terminalCapabilityClosed"):
        if source[key] is not False:
            fail(f"source boundary opened: {key}")
    census = value["eligibilityCensus"]
    if census["frozenGapRows"] != 656 or census["rowsWithLabelBoundCusipEvidence"] != 1 or census["rowsWithoutLabelBoundCusipEvidence"] != 655:
        fail("eligibility census changed")
    if census["fullArchivePilotWorthExecutingNow"] is not False:
        fail("low-utility archive execution enabled")
    if any(item is not False for item in value["claimLocks"].values()):
        fail("claim lock opened")
    required_forbidden = {"PUBLIC_CUSIP_OR_DESCRIPTION", "HISTORICAL_IDENTITY_INTERVAL", "CIK_SECURITY_OR_LISTING_IDENTITY_RESOLVED", "PRICE_RETURN_OR_OUTCOME", "ORIGINAL_V4_GATE_CREDIT"}
    if not required_forbidden.issubset(set(value["claimCeiling"]["forbidden"])):
        fail("claim ceiling weakened")


def load() -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    if sha(raw) != EXPECTED_CONTRACT_RAW:
        fail("contract raw bytes changed")
    if sha(V1_CONTRACT.read_bytes()) != EXPECTED_V1_CONTRACT_RAW:
        fail("V1 contract bytes changed")
    if sha(V1_RUNNER.read_bytes()) != EXPECTED_REMEDIATED_RUNNER_RAW or sha(V1_TEST.read_bytes()) != EXPECTED_REMEDIATED_TEST_RAW:
        fail("remediated V1 bytes changed")
    value = json.loads(raw)
    validate(value)
    fixture_shape = re.compile(
        rb"(?<![0-9A-Z*@#])[0-9A-Z*@#]{6}\s+[0-9A-Z*@#]{2}\s+[0-9](?![0-9A-Z*@#])"
    )
    if fixture_shape.search(V1_RUNNER.read_bytes()) or fixture_shape.search(V1_TEST.read_bytes()):
        fail("CUSIP-shaped fixture remains in current tree")
    return value


def self_test() -> dict[str, Any]:
    source = load()
    mutations: list[dict[str, Any]] = []
    for section, key, changed in (
        ("supersededV1", "futureExecutionAuthorized", True),
        ("incidentDisposition", "exactIdentifierRepeatedInDisposition", True),
        ("sourceDisposition", "rawCusipPublicationAllowed", True),
        ("sourceDisposition", "automatedArchiveExecutionAuthorized", True),
        ("eligibilityCensus", "fullArchivePilotWorthExecutingNow", True),
        ("claimLocks", "originalV4GateCredit", True),
    ):
        item = copy.deepcopy(source)
        item[section][key] = changed
        mutations.append(item)
    rejected = 0
    for item in mutations:
        try:
            validate(item)
        except (DispositionError, KeyError, TypeError, ValueError):
            rejected += 1
    if rejected != len(mutations):
        fail("mutation survived")
    return {"status": "PASS", "mutationsRejected": rejected, "networkRequests": 0, "filesWritten": 0, "outcomesAccessed": False}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify", "self-test"))
    args = parser.parse_args()
    result = self_test() if args.command == "self-test" else {
        "status": "PASS",
        "disposition": load()["sourceDisposition"]["status"],
        "studyCredit": "ZERO",
        "networkRequests": 0,
        "filesWritten": 0,
        "outcomesAccessed": False,
    }
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
