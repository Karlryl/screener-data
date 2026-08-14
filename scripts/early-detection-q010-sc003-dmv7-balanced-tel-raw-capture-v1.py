#!/usr/bin/env python3
"""Decision-only governance for Q010-SC003. Network/source access is intentionally absent."""

from __future__ import annotations

import argparse
import ast
import copy
from datetime import datetime, timezone
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "research/early-detection-v4/q010-sc003-dmv7-balanced-tel-raw-capture-governance-contract-v1.json"
EVENTS_PATH = ROOT / "state/early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-events-v1.jsonl"
STATE_PATH = ROOT / "state/early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-state-v1.json"
TEST_PATH = ROOT / "tests/early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-v1.test.js"
CONTROLLER_PATH = Path(__file__).resolve()

EXPECTED_CONTRACT_RAW_SHA256 = "87e1fe77ae1507fe0d6acd6b79b035bb920a2580cea65670f7c44b49ca174218"
EXPECTED_CONTROLLER_NORMALIZED_SHA256 = "1ced35bb3287c11d537a30b23da31f056add0daeaa21df69930a5d0e3d009ba0"
EXPECTED_EVENTS_RAW_SHA256 = "f6b3408acd50409485595b33ae0ca9cbcdc060d91c509f7ab74853341f7b1158"
EXPECTED_STATE_RAW_SHA256 = "0c7732d26c648a6a313820f0b26547899acb0255af90392f5cd188ccf725fa36"
EXPECTED_TEST_RAW_SHA256 = "b1d012b7d158fda7d186a837fc553d76b728ebef44dc9b22360f99e7df721a0f"
EXPECTED_POLICY_PROJECTION_SHA256 = "292ac581b242097b523d593edf177ef12e716dbb06a876ba8f0d873edf39cd0c"
EXPECTED_DECISION_EVENT_SHA256 = "693d1c86049acc4b373c86171d17773b3c8f242e8a94cdd05207f40358f24ee2"
EXPECTED_POPULATION_POLICY_SHA256 = "a99ba3ffe63aea0e8447a7cb8bb8364af7f00361ec4710031ae18e3cd9651495"
EXPECTED_CAPTURE_PLAN_SHA256 = "a231e64ad6338f393ba111a3243e50fe929a59c48df6b7d5e908810552cc455e"
EXPECTED_SOURCE_POLICY_SHA256 = "57bfe2a7bf0234f99f8e3656587eeb065219d28c37d624aa06fde51256f88444"
EXPECTED_QUERY_PROTOCOL_SHA256 = "4eb71546b9f4ba68bb8f7469ab269ca8f67e19cb66ddd432044e6d6ce7a634cf"
EXPECTED_START_TRANSITION_SHA256 = "ed6c32b9f5ab21b5c2e733c21f824f1734716c8def08ef0d173f69c27382e899"
EXPECTED_COMPLETION_POLICY_SHA256 = "dd5a03d2e985fc67d82b0936c01fe38e96cee3b3ad83dbadea382a0e4749f423"

POLICY_KEYS = (
    "decision", "populationPolicy", "capturePlan", "sourcePolicy", "queryProtocol",
    "controlAndCodingPolicy", "completionPolicy", "carriedIncidents", "startTransitionContract",
)

PURPOSE = "Prospectively authorize one bounded CORE raw-primary-source capture across the complete frozen Tag914 DMV7 census; this decision authorizes no source access, coding, level, candidate, control or scientific claim."
PRE_TOP_LEVEL_KEYS = [
    "schema", "createdAt", "purpose", "contractSelfSha256", "repository",
    "parentTag917Binding", "parentTag914CorpusBinding", "decision", "populationPolicy",
    "capturePlan", "sourcePolicy", "queryProtocol", "startTransitionContract",
    "controlAndCodingPolicy", "completionPolicy", "carriedIncidents",
    "frozenPolicyProjectionSha256", "outputs", "implementation",
]
POST_TOP_LEVEL_KEYS = [*PRE_TOP_LEVEL_KEYS, "startIntroductionBinding", "startFinalization"]

PRIVATE_STORE_ROOT = Path(r"C:\Users\Anwender\Documents\GrowthScreenerResearchData\early-detection-v4\q010-sc003-dmv7-balanced-tel-raw-capture-v1")


class GateError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise GateError(message)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_path(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def canonical_sha(value: object) -> str:
    return sha256_bytes(canonical(value))


def contract_self_sha256(contract: dict) -> str:
    obj = copy.deepcopy(contract)
    obj["contractSelfSha256"] = None
    return canonical_sha(obj)


def event_self_sha256(event: dict) -> str:
    obj = copy.deepcopy(event)
    obj.pop("eventSha256", None)
    return canonical_sha(obj)


def state_self_sha256(state: dict) -> str:
    obj = copy.deepcopy(state)
    obj["stateSelfSha256"] = None
    return canonical_sha(obj)


def policy_projection(contract: dict) -> dict:
    return {key: copy.deepcopy(contract[key]) for key in POLICY_KEYS}


def policy_projection_sha256(contract: dict) -> str:
    return canonical_sha(policy_projection(contract))


def frozen_query_templates_sha256(contract: dict) -> str:
    return canonical_sha(contract["sourcePolicy"]["queryTemplates"])


def slot_schedule_sha256(contract: dict) -> str:
    return canonical_sha(contract["capturePlan"]["slotSchedule"])


def controller_normalized_sha256() -> str:
    text = CONTROLLER_PATH.read_text(encoding="utf-8")
    for name in (
        "EXPECTED_CONTRACT_RAW_SHA256", "EXPECTED_CONTROLLER_NORMALIZED_SHA256",
        "EXPECTED_EVENTS_RAW_SHA256", "EXPECTED_STATE_RAW_SHA256", "EXPECTED_TEST_RAW_SHA256",
        "EXPECTED_DECISION_EVENT_SHA256",
    ):
        text = re.sub(rf'{name} = "[^\"]+"', f'{name} = "' + ("0" * 64) + '"', text)
    return sha256_bytes(text.encode("utf-8"))


def read_contract() -> dict:
    return json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))


def read_events() -> list[dict]:
    return [json.loads(line) for line in EVENTS_PATH.read_text(encoding="utf-8").splitlines() if line]


def read_state() -> dict:
    return json.loads(STATE_PATH.read_text(encoding="utf-8"))


def decision_payload(contract: dict) -> dict:
    return {
        "subchunkId": contract["decision"]["subchunkId"],
        "workClass": "CORE_SOURCE_CORPUS_CAPTURE",
        "populationId": contract["decision"]["targetPopulationId"],
        "populationCount": 7,
        "captureUnitCount": 15,
        "targetDimensions": ["T", "E", "L"],
        "balancedMeaning": contract["decision"]["balancedMeaning"],
        "workStarted": False,
        "researchSourceAccessAuthorized": False,
        "codingAllowed": False,
        "candidateState": None,
        "controlMatchingAllowed": False,
        "scientificCredit": "NONE",
        "nextQ010SubchunkAuthorized": False,
        "q003SchedulerEligible": False,
        "sc001IncidentId": "Q010-SC001-INCIDENT-0001",
        "sc002IncidentId": "Q010-SC002-INCIDENT-0001",
        "earlyDetectionSystemBuilt": False,
        "frozenPolicyProjectionSha256": contract["frozenPolicyProjectionSha256"],
    }


def expected_event(contract: dict) -> dict:
    event = {
        "schema": "early-detection-q010-sc003-governance-event/v1",
        "eventId": "Q010-SC003-EVT-00000001",
        "sequence": 1,
        "eventType": "SUBCHUNK_DECISION_RECORDED",
        "previousEventSha256": None,
        "createdAt": contract["decision"]["decisionRecordedAtUtc"],
        "contractSelfSha256": contract["contractSelfSha256"],
        "payload": decision_payload(contract),
        "eventSha256": None,
    }
    event["eventSha256"] = event_self_sha256(event)
    return event


def expected_projection(contract: dict, events: list[dict]) -> dict:
    event = events[0]
    return {
        "schema": "early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-projection/v1",
        "subchunkId": contract["decision"]["subchunkId"],
        "workClass": "CORE_SOURCE_CORPUS_CAPTURE",
        "decisionRecorded": True,
        "decisionEventId": event["eventId"],
        "decisionEventSequence": event["sequence"],
        "decisionTimingStatus": "PENDING_REMOTE_INTRODUCTION",
        "decisionRemoteIntroductionVerified": False,
        "separateRemoteStartRequired": True,
        "workStarted": False,
        "workStartedAtUtc": None,
        "researchSourceAccessAuthorized": False,
        "populationId": contract["decision"]["targetPopulationId"],
        "populationCount": 7,
        "captureUnitCount": 15,
        "targetDimensions": ["T", "E", "L"],
        "balancedMeaning": contract["decision"]["balancedMeaning"],
        "matchedControlPopulationStatus": "REJECTED_HOLD_CARRIED_FROM_SC002",
        "codingStatus": "NOT_CODED",
        "codingAllowed": False,
        "dimensionLevel": None,
        "candidateState": None,
        "timeCapsuleState": None,
        "futureSourceRecordStatus": "NOT_CREATED_PENDING_SEPARATE_BLIND_DECISION",
        "sourceRecordCount": 0,
        "controlMatchingAllowed": False,
        "scientificCredit": "NONE",
        "nextQ010SubchunkAuthorized": False,
        "q003SchedulerEligible": False,
        "sc001IncidentRemainsEffective": True,
        "sc002IncidentRemainsEffective": True,
        "priceVolumeReturnGqsOutcomeCurrentProfileAccess": False,
        "earlyDetectionSystemBuilt": False,
        "frozenPolicyProjectionSha256": contract["frozenPolicyProjectionSha256"],
    }


def expected_state(contract: dict, events: list[dict]) -> dict:
    state = {
        "schema": "early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-state/v1",
        "materializedAt": events[-1]["createdAt"],
        "contractSelfSha256": contract["contractSelfSha256"],
        "eventCount": len(events),
        "eventHeadSha256": events[-1]["eventSha256"],
        "projection": expected_projection(contract, events),
        "stateSelfSha256": None,
    }
    state["stateSelfSha256"] = state_self_sha256(state)
    return state


def run_git(args: list[str]) -> str:
    result = subprocess.run(["git", *args], cwd=ROOT, text=True, capture_output=True, timeout=60)
    if result.returncode != 0:
        fail("git failed: " + " ".join(args) + ": " + result.stderr.strip())
    return result.stdout.strip()


def run_git_bytes(args: list[str]) -> bytes:
    result = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, timeout=60)
    if result.returncode != 0:
        fail("git bytes failed: " + " ".join(args) + ": " + result.stderr.decode("utf-8", errors="replace").strip())
    return result.stdout


def validate_repository(contract: dict) -> None:
    repo = contract["repository"]
    paths = [
        "research/early-detection-v4/q010-sc003-dmv7-balanced-tel-raw-capture-governance-contract-v1.json",
        "scripts/early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-v1.py",
        "state/early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-events-v1.jsonl",
        "state/early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-state-v1.json",
        "tests/early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-v1.test.js",
    ]
    require(repo == {
        "worktree": r"C:\Users\Anwender\Documents\GrowthScreenerResearchData\worktrees\form25-v2-promotion-20260812",
        "branch": "codex/form25-v2-promotion-20260812",
        "remoteUrl": "https://github.com/Karlryl/screener-data.git",
        "remoteRef": "refs/heads/codex/early-detection-v4-gates-20260810",
        "baseCommit": "f606124109b71d20f3ecd555f501afb84d95446c",
        "expectedDecisionSubject": "Tag 918: Q010-SC003 Rohquellenkapsel vor Arbeitsbeginn versiegeln",
        "expectedStartSubject": "Tag 919: Q010-SC003 Rohquellenkapsel prospektiv starten",
        "expectedCompletionSubject": "Tag 920: Q010-SC003 Rohquellenkapsel fail-closed abschließen",
        "ownedPaths": paths,
        "decisionMustBeExactFiveAddDirectChildOfBase": True,
        "startMustBeExactFiveModifyDirectChildOfDecision": True,
        "completionMustBeExactFiveModifyDirectChildOfStart": True,
    }, "repository binding drift")


def expected_rows() -> list[dict]:
    return [
        {"populationRowId": "DMV2015-BOSCH", "reportedLegalName": "Bosch, LLC", "identityStatus": "HOLD_LISTED_IDENTITY_UNRESOLVED"},
        {"populationRowId": "DMV2015-DELPHI", "reportedLegalName": "Delphi Automotive Systems, LLC", "identityStatus": "HOLD_LISTED_IDENTITY_UNRESOLVED"},
        {"populationRowId": "DMV2015-GOOGLE", "reportedLegalName": "Google Auto, LLC", "identityStatus": "HOLD_LISTED_IDENTITY_UNRESOLVED"},
        {"populationRowId": "DMV2015-NISSAN", "reportedLegalName": "Nissan North America, Inc", "identityStatus": "HOLD_LISTED_IDENTITY_UNRESOLVED"},
        {"populationRowId": "DMV2015-MERCEDES", "reportedLegalName": "Mercedes-Benz Research & Development North America, Inc", "identityStatus": "HOLD_LISTED_IDENTITY_UNRESOLVED"},
        {"populationRowId": "DMV2015-TESLA", "reportedLegalName": "Tesla Motors, Inc.", "identityStatus": "SOURCE_REPORTED_NAME_EXACT_NO_SC003_LISTING_CREDIT"},
        {"populationRowId": "DMV2015-VOLKSWAGEN", "reportedLegalName": "Volkswagen Group of America, Inc.", "identityStatus": "HOLD_LISTED_IDENTITY_UNRESOLVED"},
    ]


def expected_routes() -> list[dict]:
    row_routes = [
        ("BOSCH", "DMV2015-BOSCH", "BOSCH_OFFICIAL", "www.bosch.com", "bosch"),
        ("DELPHI", "DMV2015-DELPHI", "DELPHI_HISTORICAL_OFFICIAL", "www.delphi.com", "delphi"),
        ("GOOGLE", "DMV2015-GOOGLE", "GOOGLE_OFFICIAL", "googleblog.com", "google"),
        ("NISSAN", "DMV2015-NISSAN", "NISSAN_OFFICIAL", "www.nissan-global.com", "nissan"),
        ("MERCEDES", "DMV2015-MERCEDES", "MERCEDES_HISTORICAL_OFFICIAL", "www.daimler.com", "mercedes"),
        ("TESLA", "DMV2015-TESLA", "TESLA_OFFICIAL", "www.tesla.com", "tesla"),
        ("VOLKSWAGEN", "DMV2015-VOLKSWAGEN", "VOLKSWAGEN_OFFICIAL", "www.volkswagengroupofamerica.com", "volkswagen"),
    ]
    routes = [{
        "templateId": "SC003-ROUTE-T-SHARED",
        "unitId": "SC003-T-SHARED",
        "dimensionRouting": "T",
        "populationRowId": None,
        "publisherAuthorityId": "CALIFORNIA_DMV",
        "originalHost": "www.dmv.ca.gov",
        "originalUrlPattern": "www.dmv.ca.gov/portal/dmv/detail/vr/autonomous/*",
        "primaryPayloadSourceClass": "OFFICIAL_GOVERNMENT_REGULATORY_RULE_PROGRAM_OR_CENSUS",
        "termExpression": [],
        "rowTokenExpression": None,
    }]
    for short, row_id, authority, host, row_token in row_routes:
        routes.append({
            "templateId": f"SC003-ROUTE-E-{short}",
            "unitId": f"SC003-E-{short}",
            "dimensionRouting": "E",
            "populationRowId": row_id,
            "publisherAuthorityId": authority,
            "originalHost": host,
            "originalUrlPattern": host + "/*",
            "primaryPayloadSourceClass": "OFFICIAL_ISSUER_CONTEMPORANEOUS_TECHNICAL_CUSTOMER_OR_OPERATIONS_DOCUMENT",
            "termExpression": ["autonomous vehicle"],
            "rowTokenExpression": None,
        })
        routes.append({
            "templateId": f"SC003-ROUTE-L-{short}",
            "unitId": f"SC003-L-{short}",
            "dimensionRouting": "L",
            "populationRowId": row_id,
            "publisherAuthorityId": "CALIFORNIA_DMV",
            "originalHost": "www.dmv.ca.gov",
            "originalUrlPattern": "www.dmv.ca.gov/portal/*",
            "primaryPayloadSourceClass": "OFFICIAL_GOVERNMENT_PERMIT_FILING_OPERATIONS_OR_DEPLOYMENT_RECORD",
            "termExpression": [],
            "rowTokenExpression": row_token,
        })
    return routes


def expected_slot_schedule() -> list[dict]:
    slots: list[dict] = []
    for route in expected_routes():
        common = {
            "unitId": route["unitId"],
            "dimensionRouting": route["dimensionRouting"],
            "populationRowId": route["populationRowId"],
            "templateId": route["templateId"],
            "requestAuthorityId": "INTERNET_ARCHIVE_WAYBACK",
            "publisherAuthorityId": route["publisherAuthorityId"],
            "transportId": "INTERNET_ARCHIVE_WAYBACK",
            "method": "GET",
            "originalHost": route["originalHost"],
            "originalUrlPattern": route["originalUrlPattern"],
            "termExpression": route["termExpression"],
            "rowTokenExpression": route["rowTokenExpression"],
            "resultSelectionAlgorithmId": "SC003-CDX-FILTER-SORT-TAKE2/V2",
        }
        slots.append({
            "slotId": route["unitId"] + "-01", "attemptOrdinal": 1, **common,
            "requestRole": "LOCATOR_ONLY_NO_SIGNAL_OR_CREDIT",
            "sourceClass": "ARCHIVE_TRANSPORT_LOCATOR_NO_SIGNAL",
            "uriMaterializerId": "WAYBACK_CDX_EXACT_V2",
            "parserProjectionId": "SC003-CDX-JSON-METADATA-ONLY/V1",
            "derivedTargetRank": None,
        })
        for rank in (1, 2):
            slots.append({
                "slotId": route["unitId"] + f"-{rank + 1:02d}", "attemptOrdinal": rank + 1, **common,
                "requestRole": "PRIMARY_PAYLOAD_CAPTURE",
                "sourceClass": route["primaryPayloadSourceClass"],
                "uriMaterializerId": "WAYBACK_CAPTURE_SELECTED_ROW_V2",
                "parserProjectionId": "SC003-OPAQUE-RAW-TECHNICAL-METADATA/V1",
                "derivedTargetRank": rank,
            })
    return slots


def expected_inherited_payload_manifest() -> list[dict]:
    return [
        {"sourceId": "SRC-CA-DMV-2015-DISENGAGEMENT-INDEX", "payloadSha256": "8b7bbb7c51f6c346b385364898007c8058653f98e694f866a687cfa870b1f349", "payloadBytes": 52893},
        {"sourceId": "SRC-CA-DMV-BOSCH-2015", "payloadSha256": "dcdeac8e98788256fb9642967eb5fe64bff28be8b67a9af7bc58bfaddb4dff54", "payloadBytes": 92579},
        {"sourceId": "SRC-CA-DMV-DELPHI-2015", "payloadSha256": "25d937581b1b994076cab8d10bd08c508b6fe2a5f47929c8ed35e4dce31d9a58", "payloadBytes": 375265},
        {"sourceId": "SRC-CA-DMV-GOOGLE-2015", "payloadSha256": "701a6472abb52da5a8798208694dba531c419d79b9897ba510d1a4ba963fc904", "payloadBytes": 9803786},
        {"sourceId": "SRC-CA-DMV-NISSAN-2015", "payloadSha256": "5a4378d9e85a825b8f24bd3142ea1754cbebbbe2576a8215a617bee17d43b448", "payloadBytes": 527234},
        {"sourceId": "SRC-CA-DMV-MERCEDES-2015", "payloadSha256": "8f8bfec22f8bdfae384ae358bca94585e089ceb9b98f08189df97501be339f26", "payloadBytes": 1916746},
        {"sourceId": "SRC-CA-DMV-TESLA-2015", "payloadSha256": "239dd8db3e8a82315c2a176def980bd0b4766bf3f51c8ba47d631d19c3f73607", "payloadBytes": 105027},
        {"sourceId": "SRC-CA-DMV-VOLKSWAGEN-2015", "payloadSha256": "187f354d5a7064e46c0144bc1050ce9cc375136b9c1334d2ec9852e0182b07bc", "payloadBytes": 340513},
        {"sourceId": "SRC-SEC-TESLA-2015Q3-INDEX", "payloadSha256": "8798ff07146138bfc2e87b12acbd9c29cd8f26184a39ff5fb8def5fafb8796b1", "payloadBytes": 10067},
        {"sourceId": "SRC-SEC-TESLA-2015Q3-10Q", "payloadSha256": "a3f67e41d84bea45b32a4b2c461e360f3e2aa939a73134c51d4310f30ff6b541", "payloadBytes": 1530754},
        {"sourceId": "SRC-SEC-TESLA-2014-10K-INDEX", "payloadSha256": "dda2043fee9a93ab6c51fcdce2d87118481528b8751c8194d2c4b70e516073dc", "payloadBytes": 10850},
        {"sourceId": "SRC-SEC-TESLA-2014-10K", "payloadSha256": "0760784e2efc94e1d89ce35e3f12a6dd48ab0168a39b96683744420da0273d85", "payloadBytes": 3660944},
    ]


def validate_parent_bindings(contract: dict, check_files: bool) -> None:
    p = contract["parentTag917Binding"]
    require(p["commit"] == contract["repository"]["baseCommit"] == "f606124109b71d20f3ecd555f501afb84d95446c", "Tag917 commit drift")
    require(p["parent"] == "9ba44d160cddeba728cbca5dfdb46bd09511e2be" and p["subject"] == "Tag 917: Q010-SC002 Quellenrahmen fail-closed halten", "Tag917 topology drift")
    require(p["commitTimeUtc"] == "2026-08-14T00:04:19Z", "Tag917 time drift")
    require(p["requiredChunkStatus"] == "TYPED_GLOBAL_HOLD_COMPLETED" and p["requiredGlobalHoldReason"] == "HOLD_OFFICIAL_LISTING_UNIVERSE_INCOMPLETE", "SC002 HOLD drift")
    require(p["requiredLocatorTimingIncidentId"] == "Q010-SC002-INCIDENT-0001" and p["requiredProspectiveLocatorTimingMachineVerified"] is False, "SC002 incident drift")
    require(p["requiredResearchSourceAccessAuthorized"] is False and p["requiredScientificCredit"] == "NONE" and p["requiredNextQ010SubchunkAuthorized"] is False, "SC002 authorization drift")
    require(p["requiredQ003SchedulerEligible"] is False and p["requiredEarlyDetectionSystemBuilt"] is False, "SC002 scheduler/build drift")
    expected_blobs = [
        {"path": "research/early-detection-v4/q010-sc002-pit-listing-ledger-governance-contract-v1.json", "gitBlobSha1": "c7ad56f7b4a84c46f3181f18cbb663c5bb9a0dba", "rawSha256": "fa57cd80f1512a801dad5dddad2291c10370d09d0a4954b8d129565006cb8051"},
        {"path": "scripts/early-detection-q010-sc002-pit-listing-ledger-v1.py", "gitBlobSha1": "17465c0019d3f06dc934ddb23aaae6513c43c7ca", "rawSha256": "426943feec35cdb67e3911c04a152f099b653e1421d97db6140db3a011dd89e9"},
        {"path": "state/early-detection-q010-sc002-pit-listing-ledger-events-v1.jsonl", "gitBlobSha1": "6eb73207e52cb94cf227386a78472e55ed70e45e", "rawSha256": "a4fcef9d6e1e55f767c911d70e70b499e81110a67fb27b8f49dcd1873fbefb2c"},
        {"path": "state/early-detection-q010-sc002-pit-listing-ledger-state-v1.json", "gitBlobSha1": "262786c8071c6fce36e8102cf0b2ecd181a8e681", "rawSha256": "86d5661844243171fba8d452a0883c62a934a523a7db1f12e8891db15272251f"},
        {"path": "tests/early-detection-q010-sc002-pit-listing-ledger-v1.test.js", "gitBlobSha1": "59fa3dbed2d17da0cc80aa345c0472af8a6429b5", "rawSha256": "7192b7c86f7b9a0e4e892dc02d580bb7f54c794d566c308f31ec07a84ddadb91"},
    ]
    require(p["parentBlobs"] == expected_blobs, "Tag917 blob binding drift")
    t = contract["parentTag914CorpusBinding"]
    require(t == {
        "commit": "2d744159e4a001bfe1e2ff5b9d31113cbc347487",
        "reportPath": "reports/early-detection/q010-sc001-ca-dmv-av-2015-tel-v1.json",
        "reportGitBlobSha1": "2139337fc9a061e1aa0c9e85f4e4ff938d9815ef",
        "reportRawSha256": "fecbcf29d38176e6218fe4e1cd7de33690889feedd6930f2a7ec4501fd1aee3d",
        "reportSelfSha256": "21ad19897f0cffc54606ceb02ebfcd824c14c681b0ba6a2b1b9d75d7cbbe5651",
        "frozenTreatmentPopulationSha256": "4717b3847f11a5e3e05e9290890c6ceab493d3197b2ef5b9dfd75cb0ee0ceffd",
        "populationId": "POP-CA-DMV-AV-PERMIT-HOLDERS-2015-FULL-CENSUS",
        "populationCount": 7,
        "requiredSc001IncidentId": "Q010-SC001-INCIDENT-0001",
        "requiredChunkStatus": "TYPED_HOLD_COMPLETED",
        "requiredCandidateState": None,
        "requiredScientificCredit": "NONE",
    }, "Tag914 corpus binding drift")
    if not check_files:
        return
    require(run_git(["show", "-s", "--format=%P", p["commit"]]) == p["parent"], "Tag917 Git parent drift")
    require(run_git(["show", "-s", "--format=%s", p["commit"]]) == p["subject"], "Tag917 Git subject drift")
    for blob in expected_blobs:
        require(run_git(["rev-parse", f'{p["commit"]}:{blob["path"]}']) == blob["gitBlobSha1"], "Tag917 git blob id drift")
        require(sha256_bytes(run_git_bytes(["show", f'{p["commit"]}:{blob["path"]}'])) == blob["rawSha256"], "Tag917 raw blob drift")
    sc002_state = json.loads(run_git_bytes(["show", f'{p["commit"]}:state/early-detection-q010-sc002-pit-listing-ledger-state-v1.json']).decode("utf-8"))
    sp = sc002_state["projection"]
    require(sp["chunkStatus"] == p["requiredChunkStatus"] and sp["globalHoldReason"] == p["requiredGlobalHoldReason"], "Tag917 state HOLD drift")
    require(sp["locatorTimingIncidentId"] == p["requiredLocatorTimingIncidentId"] and sp["prospectiveLocatorTimingMachineVerified"] is False, "Tag917 state incident drift")
    require(run_git(["rev-parse", f'{t["commit"]}:{t["reportPath"]}']) == t["reportGitBlobSha1"], "Tag914 report blob id drift")
    report_raw = run_git_bytes(["show", f'{t["commit"]}:{t["reportPath"]}'])
    require(sha256_bytes(report_raw) == t["reportRawSha256"], "Tag914 report raw drift")
    report = json.loads(report_raw.decode("utf-8"))
    require(report["reportSelfSha256"] == t["reportSelfSha256"], "Tag914 report self drift")
    require(canonical_sha(report["frozenTreatmentPopulation"]) == t["frozenTreatmentPopulationSha256"], "Tag914 frozen population drift")
    require(report["frozenTreatmentPopulation"]["populationCount"] == 7, "Tag914 population count drift")
    require([{"populationRowId": row["populationRowId"], "reportedLegalName": row["reportedLegalName"]} for row in report["frozenTreatmentPopulation"]["rows"]] == [{"populationRowId": row["populationRowId"], "reportedLegalName": row["reportedLegalName"]} for row in expected_rows()], "Tag914 row identity drift")
    require(report["sourceManifestSha256"] == contract["sourcePolicy"]["inheritedPayloadManifestBinding"]["sourceManifestSha256"], "Tag914 source manifest binding drift")
    require([{"sourceId": row["sourceId"], "payloadSha256": row["payloadSha256"], "payloadBytes": row["payloadBytes"]} for row in report["sourceManifest"]] == expected_inherited_payload_manifest(), "Tag914 inherited payload manifest drift")


def validate_policy(contract: dict) -> None:
    d = contract["decision"]
    require(d["subchunkId"] == "Q010-SC-003-DMV7-BALANCED-TEL-RAW-CAPTURE" and d["workClass"] == "CORE_SOURCE_CORPUS_CAPTURE", "decision identity/class drift")
    require(d["targetDimensions"] == ["T", "E", "L"] and d["balancedMeaning"] == "EQUAL_PREDECLARED_CAPTURE_OPPORTUNITY_AND_BUDGET_NOT_EQUAL_HITS_OR_EVIDENCE", "dimension/balance drift")
    require(d["populationReferenceAtUtc"] == "2015-12-31T23:59:59Z" and d["reportedActivityWindowStartDate"] == "2014-01-01" and d["reportedActivityWindowEndDate"] == "2016-12-31" and d["sourceKnownAtCutoffInclusiveUtc"] == "2020-12-31T23:59:59Z", "population/window/cutoff drift")
    require(d["decisionRecordedAtUtc"] == contract["createdAt"] == "2026-08-14T00:16:11.3761192Z", "decision time drift")
    require(d["decisionTimingStatus"] == "PENDING_REMOTE_INTRODUCTION" and d["preChunkTimingClaimRecorded"] is True and d["preChunkTimingVerifiedAtDraft"] is False, "decision timing claim drift")
    for key in ("workStarted", "researchSourceAccessAuthorized", "codingAllowed", "candidateStateComputationAllowed", "controlMatchingAllowed", "nextQ010SubchunkAuthorized", "q003SchedulerEligible"):
        require(d[key] is False, "decision prohibited flag drift: " + key)
    require(d["workStartedAtUtc"] is None and d["scientificCredit"] == "NONE" and d["noRetroactiveAuthorization"] is True, "decision no-credit/retroactive drift")
    require(len(d["namedBiasesPrevented"]) == 6 and "FAMOUS_WINNER_EXTRA_RESEARCH" in d["namedBiasesPrevented"] and "BEST_INSTRUMENTED_DIMENSION_DRIFT" in d["namedBiasesPrevented"], "named bias drift")
    require(d["continuationCriterion"] == "CONTINUE_ONLY_THROUGH_THE_EXACT_FORTY_FIVE_FROZEN_SLOTS_IN_ORDER_UNTIL_EVERY_SLOT_AND_ALL_FIFTEEN_UNITS_ARE_TERMINAL_RAW_CAPTURED_NULL_RESULT_QUARANTINED_OR_TYPED_HOLD", "continuation drift")
    require(d["pauseOrStopCriterion"].startswith("STOP_IMMEDIATELY_ON_PRESTART_ACCESS"), "stop drift")
    pop = contract["populationPolicy"]
    require(pop["rows"] == expected_rows() and pop["rowOrderFrozen"] is True and pop["teslaResolvedIdentityCannotChangeBudgetRouteOrAcceptance"] is True, "population drift")
    require(pop["payloadMayBeStoredByFrozenSlotBeforeEntityAttribution"] is True, "pre-attribution raw storage drift")
    require(pop["capturePopulationRowAttributionStatus"] == "UNRESOLVED_UNTIL_SEPARATE_BLIND_HUMAN_CODING_DECISION", "capture attribution status drift")
    require(pop["entityAttributionRequiresLaterBlindHumanCoding"] is True and pop["captureRouteOrFilenameMatchCannotSetEntityTELCandidateOrScientificCredit"] is True, "capture/entity separation drift")
    require(pop["currentTickerCikParentSuccessorOrProfileLookupForbidden"] is True and pop["unresolvedRowsNeverDroppedOrMerged"] is True, "identity leakage drift")
    plan = contract["capturePlan"]
    require(plan["unitCount"] == 15 and len(plan["units"]) == 15 and plan["requestHardCap"] == 45 and plan["acceptedPayloadHardCap"] == 30, "capture plan totals drift")
    require(plan["acceptedPayloadTermDefinition"] == "NEW_OPAQUE_PRIMARY_PUBLISHER_RAW_BYTES_CAPTURED_DIGEST_MATCHED_NOT_A_COMPLETE_SOURCE_RECORD_SIGNAL_ENTITY_TEL_CANDIDATE_OR_SCIENTIFIC_CREDIT", "accepted raw-payload term drift")
    require(plan["maxResponseBytesPerRequest"] == 20000000 and plan["privateRawBytesHardCap"] == 900000000 and plan["connectTimeoutSeconds"] == 15 and plan["responseTimeoutSeconds"] == 45 and plan["automaticRetryCount"] == 0, "capture resource boundary drift")
    require(plan["units"][0] == {"unitId": "SC003-T-SHARED", "dimension": "T", "populationRowId": None, "maxRequests": 3, "maxAcceptedPayloads": 2, "maxMinutes": 20}, "shared T unit drift")
    require([u["populationRowId"] for u in plan["units"][1::2]] == [r["populationRowId"] for r in expected_rows()] and all(u["dimension"] == "E" for u in plan["units"][1::2]), "E unit coverage/order drift")
    require([u["populationRowId"] for u in plan["units"][2::2]] == [r["populationRowId"] for r in expected_rows()] and all(u["dimension"] == "L" for u in plan["units"][2::2]), "L unit coverage/order drift")
    require(all(u["maxRequests"] == 3 and u["maxMinutes"] == 20 for u in plan["units"]), "unit budget asymmetry")
    require(plan["perRowAcceptedPayloadDifferenceBetweenEAndLMaximum"] == 1, "E/L accepted-payload balance drift")
    require(plan["slotScheduleSchema"] == "SC003-FORTY-FIVE-MATERIALLY-FROZEN-SLOTS/V2" and len(plan["slotSchedule"]) == 45, "slot schedule shape drift")
    require(plan["slotScheduleSha256"] == slot_schedule_sha256(contract), "slot schedule hash drift")
    require(plan["slotSchedule"] == expected_slot_schedule(), "materially frozen slot schedule drift")
    for key in ("fixedExecutionOrder", "failedRequestsAndRedirectHopsConsumeBudget", "budgetTransferForbidden", "earlyStopAfterSuccessForbidden", "extraResearchForKnownOrInterestingRowsForbidden", "sharedThemePayloadMayBeReferencedByAllRowsButCountsOnce"):
        require(plan[key] is True, "capture balance safeguard drift: " + key)
    src = contract["sourcePolicy"]
    require(src["primaryFreeLawfulReproducibleOnly"] is True and src["secondarySources"] == "LOCATOR_ONLY_NO_PAYLOAD_SIGNAL_OR_CREDIT" and src["paidSourcesForbidden"] is True, "source authority/cost drift")
    require(src["publicationCutoffInclusiveUtc"] == "2020-12-31T23:59:59Z" and src["retrievedAtNeverSubstitutesForHistoricalKnownAt"] is True and src["effectiveDateNeverSubstitutesForAvailabilityKnownAt"] is True, "knownAt drift")
    require(len(src["acceptedSourceClassPriority"]) == 3 and len(src["knownAtRules"]) == 3 and set(src["acceptedSourceClassPriority"]) == set(src["knownAtRules"]), "source-class contract drift")
    require(len(src["publisherAuthorityAllowlist"]) == 8 and src["secondaryLocatorPublisherAllowlist"] == [], "publisher allowlist drift")
    require(src["archiveTransportAllowlist"] == [{"transportId": "INTERNET_ARCHIVE_WAYBACK", "allowedHost": "web.archive.org", "role": "TRANSPORT_ONLY", "embeddedOriginalHostMustBePublisherAllowlisted": True, "archiveMetadataCannotSetTELOrScientificCredit": True}], "archive transport drift")
    require(src["unlistedPublisherOrTransportDisposition"] == "REJECTED_HOLD_NO_DYNAMIC_EXPANSION" and src["redirectOutsidePublisherOrTransportAllowlistDisposition"] == "REJECTED_HOLD_AND_SLOT_CONSUMED", "dynamic publisher/redirect drift")
    require(src["publisherAuthorityMustBeProvenByHistoricalPayloadOrTransportMetadataNotCurrentProfile"] is True, "publisher authority proof drift")
    require(src["frozenQueryTemplateVersion"] == "SC003-WAYBACK-CDX-DETERMINISTIC-ROUTES/V2" and src["queryTemplates"] == expected_routes(), "query route drift")
    require(src["frozenQueryTemplatesSha256"] == frozen_query_templates_sha256(contract), "query template hash drift")
    require(src["frozenContemporaneousTermsSource"] == "TAG914_REPORT_EXACT_CASEFOLDED_PHRASES_AND_FROZEN_SOURCE_REPORTED_LEGAL_NAMES_ONLY" and src["frozenContemporaneousTerms"] == ["autonomous vehicle", "testing permit", "disengagement report"], "frozen contemporaneous terms drift")
    require(len(src["queryTermProvenance"]) == 3 and [x["term"] for x in src["queryTermProvenance"]] == src["frozenContemporaneousTerms"] and all(x["parentRawSha256"] == contract["parentTag914CorpusBinding"]["reportRawSha256"] for x in src["queryTermProvenance"]), "query term provenance drift")
    require(len(src["uriMaterializers"]) == 2 and len(src["resultSelectionAlgorithms"]) == 1 and len(src["safeProjectionParsers"]) == 2, "deterministic locator/parser surface drift")
    raw_capture_fields = ["captureId", "queryId", "slotId", "populationRowId", "dimensionRouting", "publisherAuthority", "originalSourceUri", "archiveCaptureUri", "archiveObservationTimestamp", "retrievedAt", "capturedAt", "payloadSha256", "archivedRawPayloadId", "mimeType", "responseBytes", "cdxDigestMatchBoolean", "inheritedPayloadDuplicateBoolean", "payloadCaptureDisposition"]
    require(src["rawCaptureManifestRequiredFields"] == raw_capture_fields, "raw-capture manifest fields drift")
    v23_source_fields = ["sourceId", "queryId", "slotId", "populationRowId", "dimensionRouting", "sourceClass", "sourceAuthority", "sourceAuthorityTier", "sourceUri", "sourceTimestamp", "observationTimestamp", "knownAt", "retrievedAt", "capturedAt", "payloadSha256", "archivedRawPayloadId", "cutoff", "acquisitionCost", "accessRights", "acquisitionProvenance", "contemporaneousTerminology", "rawExcerptMapping"]
    require(src["requiredFutureSignalEligibleSourceRecordFields"] == v23_source_fields, "future V23 source-record fields drift")
    separation = src["rawCaptureAndSourceRecordSeparation"]
    require(separation["rawCaptureUnitSuccessDisposition"] == "NEW_OPAQUE_PRIMARY_PUBLISHER_RAW_BYTES_CAPTURED_DIGEST_MATCHED_NO_SOURCE_RECORD_ENTITY_TEL_CANDIDATE_OR_SCIENTIFIC_CREDIT", "raw-capture success disposition drift")
    require(separation["rawCaptureUnitSuccessRequirements"] == ["FROZEN_SLOT_AND_PUBLISHER_AUTHORITY_MATCH", "HTTP_200_NONEMPTY_RESPONSE_WITHIN_FROZEN_BYTE_CAP", "WAYBACK_CDX_DIGEST_MATCHES_EXACT_OPAQUE_RESPONSE_ENTITY_BYTES", "PAYLOAD_SHA256_NOT_PRESENT_IN_INHERITED_TAG914_MANIFEST", "ARCHIVE_OBSERVATION_TIMESTAMP_AT_OR_BEFORE_2020_12_31T23_59_59Z", "OPAQUE_CONTENT_ADDRESSED_PRIVATE_STORAGE_AND_SAFE_TECHNICAL_PROJECTION_ONLY"], "raw-capture success requirements drift")
    require(separation["rawCaptureMayCountWithoutOfficialPublicationTimestamp"] is True and separation["missingOfficialPublicationTimestampDisposition"] == "RAW_CAPTURE_RETAINED_BUT_FUTURE_SIGNAL_ELIGIBLE_SOURCE_RECORD_TYPED_HOLD_MISSING_SOURCE_TIMESTAMP" and separation["completeFutureSignalEligibleSourceRecordRequiredForRawCaptureUnitSuccess"] is False and separation["rawCaptureUnitSuccessCannotSetKnownAtEntityTELCandidateTimeCapsuleOrScientificCredit"] is True, "raw-capture/source-record separation drift")
    require(separation["futureSourceRecordStatusAtCaptureMustEqual"] == "NOT_CREATED_PENDING_SEPARATE_BLIND_DECISION" and separation["rawCaptureProjectionSourceTimestampAndKnownAtFieldsForbidden"] is True, "future source-record hold drift")
    require(src["rawExcerptMappingAtCaptureMustEqual"] == "DEFERRED_TO_SEPARATE_BLIND_HUMAN_CODING_DECISION_NO_SIGNAL_ELIGIBILITY" and src["captureSourceRecordsAreNotSignalEligible"] is True, "raw-capture/source eligibility drift")
    require(src["inheritedTag914PayloadManifest"] == expected_inherited_payload_manifest(), "inherited payload manifest drift")
    require(src["inheritedPayloadManifestBinding"] == {"parentCommit": "2d744159e4a001bfe1e2ff5b9d31113cbc347487", "parentReportRawSha256": "fecbcf29d38176e6218fe4e1cd7de33690889feedd6930f2a7ec4501fd1aee3d", "sourceManifestSha256": "7628a9299d2053bb48b727b184901beb7ecd4563b31622e2fc0139cbad8806bc"}, "inherited payload source binding drift")
    require(src["payloadHashMatchingInheritedManifestDisposition"] == "INHERITED_DUPLICATE_REFERENCE_ONLY_NO_SC003_ACCEPTED_PAYLOAD_UNIT_SUCCESS_SIGNAL_OR_CREDIT" and src["inheritedDuplicatesStillConsumeTheFrozenSlotRequestAndByteBudget"] is True, "inherited duplicate credit/budget drift")
    require(src["waybackSelectedPayloadDigestRule"] == {"cdxDigestEncoding": "BASE32_SHA1_OF_EXACT_ARCHIVED_RESPONSE_ENTITY_BYTES", "requiredComparison": "COMPUTE_SHA1_OVER_EXACT_OPAQUE_RESPONSE_ENTITY_BYTES_ENCODE_BASE32_WITHOUT_PADDING_AND_REQUIRE_CASE_INSENSITIVE_EQUALITY_TO_SELECTED_CDX_DIGEST", "missingUnsupportedOrMismatchedDigestDisposition": "QUARANTINED_HOLD_NO_ACCEPTED_PAYLOAD_UNIT_SUCCESS_SIGNAL_OR_CREDIT"}, "Wayback payload digest binding drift")
    cdx = [p for p in src["safeProjectionParsers"] if p["parserId"] == "SC003-CDX-JSON-METADATA-ONLY/V1"][0]
    require(cdx["allowedOutputFields"] == ["timestamp", "originalHostExactMatch", "normalizedUriTermMatch", "normalizedRowTokenMatch", "statuscode", "mimetype", "digest", "returnedRowCount", "resumeKeyPresent", "paginationTrailerParseStatus", "completenessProven"], "CDX completeness projection drift")
    require(src["locatorCompletenessContract"] == {"returnedRowCountHardHoldAtOrAbove": 500, "requiredPaginationTrailerParseStatusForComplete": "EXACT_NO_TRAILER", "resumeKeyMustBeAbsentForComplete": True, "unparsedNonWhitespaceBytesForbiddenForComplete": True, "completenessProvenMustBeTrueBeforeDerivedPayloadRequest": True, "incompleteOrUnprovenDisposition": "WHOLE_UNIT_TYPED_HOLD_BOTH_DERIVED_PAYLOAD_SLOTS_TERMINAL_WITHOUT_NETWORK_REQUEST_NO_ABSENCE_SIGNAL_OR_CREDIT"}, "locator completeness contract drift")
    opaque = [p for p in src["safeProjectionParsers"] if p["parserId"] == "SC003-OPAQUE-RAW-TECHNICAL-METADATA/V1"][0]
    require(opaque["allowedOutputFields"] == ["httpStatus", "mimeType", "responseBytes", "responseSha256", "archiveObservationTimestampExact", "retrievedAt", "capturedAt", "payloadCaptureDisposition", "cdxDigestMatchBoolean", "inheritedPayloadDuplicateBoolean", "futureSourceRecordStatus"], "opaque projection fields drift")
    require(opaque["payloadContentMustRemainOpaqueAtCapture"] is True and opaque["htmlTextOrRawExcerptOutputForbidden"] is True and opaque["htmlPdfXmlOrBinaryContentDisposition"] == "RAW_CAPTURED_UNPARSED_FORMAL_PRIMARY_NO_ENTITY_TEL_CANDIDATE_OR_SCIENTIFIC_CREDIT" and opaque["unknownContentDisposition"] == "QUARANTINED_HOLD_NO_TEXT_EXTRACTION_OR_OCR" and opaque["ocrForbidden"] is True, "opaque raw-content disposition drift")
    for key in ("queryTermsMustBeFrozenContemporaneousTermsFromTag914Sources", "modernTermBackprojectionForbidden", "currentIdentifierProfileParentSuccessorAndTickerSearchForbidden", "priceVolumeReturnGqsOutcomeCandidateAndCurrentProfileFieldsForbiddenFromOperatorLlmAndCoderProjection", "rawResponseMustBeOpaqueContentAddressedPrivateAndNeverRenderedToOperatorLlmOrCoder", "projectionMustBeFieldAllowlistedAndForbiddenFieldExposureFalse", "deduplicateExactPayloadBytes", "duplicatePayloadAdditionalSlotsReferenceOnlyNoAdditionalSuccess"):
        require(src[key] is True, "source leakage safeguard drift: " + key)
    require(src["null404TimeoutOrMissingDocumentMeaning"] == "NULL_RESULT_NO_ABSENCE_INFERENCE" and src["supportDirectionAtCapture"] == "UNCODED", "null/coding drift")
    qp = contract["queryProtocol"]
    for key in ("networkAccessMustBeExecutedOnlyByTheBoundController", "manualBrowserWebToolPowerShellCurlAndPrefetchForbiddenAfterStart", "automaticRedirectsDisabledAndEachRedirectHopCountsAsRequest", "beforeEveryRequestAppendFlushAndFsyncQueryPrepared", "afterEveryResponseBeforeNextRequestAppendFlushAndFsyncQueryResponseSealed", "requestNPlusOneBeforeResponseNSealedForbidden", "localClockIsNotExternalSignedAbsoluteTimeAttestation", "prospectiveQueryTimingMachineVerifiedMayBeTrueOnlyWithExternalReceipt", "tag919OwnedPathsMustMatchExactCommittedBlobsWithNoTrackedOrUntrackedDriftBeforeEveryRequest", "privateStoreMustBeAbsentUntilTag919IsLiveRemoteAndStartGatePasses", "privateAuditLedgerMustAppendFlushAndFsyncBeforeNetworkAndAfterResponse", "privateAuditLedgerIsOutsideGitOwnedPathsAndNeverCommitted", "tag920MustBindPrivateLedgerRawSha256EventCountEventHeadRunStateSha256ProjectionManifestSha256RawBlobManifestSha256BlobCountAndRawByteCount", "decisionPreRequiresPrivateStoreAbsent", "noPrivatePayloadMayBeCommitted"):
        require(qp[key] is True, "query protocol drift: " + key)
    require(len(qp["queryPreparedRequiredFields"]) == 22 and len(qp["queryResponseRequiredFields"]) == 19, "query event field count drift")
    require(qp["crashOrMissingBackfilledTimestampHashOrResponsePolicy"] == "GLOBAL_INCIDENT_AND_TYPED_HOLD_NO_RECONSTRUCTION", "query crash policy drift")
    require(Path(qp["privateStoreRoot"]) == PRIVATE_STORE_ROOT and Path(qp["privateLiveAuditLedgerPath"]).parent == PRIVATE_STORE_ROOT and Path(qp["privateRunStatePath"]).parent == PRIVATE_STORE_ROOT and Path(qp["privateRawBlobRoot"]).parent == PRIVATE_STORE_ROOT and Path(qp["privateProjectionManifestPath"]).parent == PRIVATE_STORE_ROOT, "private audit path drift")
    require(qp["privateAuditEventTypes"] == ["QUERY_PREPARED", "QUERY_RESPONSE_SEALED", "DERIVED_SLOT_TYPED_HOLD", "GLOBAL_INCIDENT", "RUN_COMPLETED"], "private audit event domain drift")
    require(qp["privateAuditCommonRequiredFields"] == ["schema", "eventType", "eventId", "sequence", "previousEventSha256", "createdAtUtc", "payload", "eventSha256"], "private audit common fields drift")
    require(qp["responseSealPreparedAtUtcIsCapturedImmediatelyBeforeAppendingTheCompleteResponseEventAndIsNotFsyncCompletionTime"] is True and qp["afterResponseEventFsyncRunStateMustBeAtomicallyTempWrittenFileFsyncedReplacedAndParentDirectoryFsynced"] is True, "response fsync truth drift")
    require(qp["runStateRequiredFields"] == ["schema", "runId", "lastResponseQueryId", "lastResponseEventSequence", "lastResponseEventSha256", "lastResponseLedgerRawSha256", "lastResponseSealPreparedAtUtc", "lastResponseLedgerFsyncConfirmedAtUtc", "budgetAfter", "nextSlotOrdinal", "runStateSelfSha256"], "durable run-state field drift")
    require(qp["requestNPlusOneRequiresRunStateLastResponseSequenceHeadAndLedgerRawShaToMatchLedgerAndFsyncConfirmationTimeNotBeforeSealPreparedTime"] is True and qp["crashAfterLedgerFsyncBeforeDurableMatchingRunState"] == "GLOBAL_INCIDENT_AND_TYPED_HOLD_NO_RECONSTRUCTION", "next-request/fsync gate drift")
    require(qp["preQueryRemoteReceiptRequiredFields"] == ["schema", "queryId", "observedHead", "observedUpstream", "observedRemoteRef", "observedRemoteOid", "gitLsRemoteRawSha256", "ownedPathBlobBindingsSha256", "ownedPathsClean", "observedAtUtc", "externallySigned", "receiptSha256"], "remote receipt fields drift")
    require(qp["preQueryRemoteReceiptExternallySignedMustBeFalse"] is True and qp["prospectiveAbsoluteQueryTimingScientificCredit"] == "NONE_LOCAL_CLOCK_AND_UNSIGNED_REMOTE_RECEIPT", "remote receipt timing-credit drift")
    cc = contract["controlAndCodingPolicy"]
    require(cc["matchedControlPopulationStatus"] == "REJECTED_HOLD_CARRIED_FROM_SC002" and cc["codingStatus"] == "NOT_CODED" and cc["dimensionLevel"] is None and cc["candidateState"] is None and cc["timeCapsuleState"] is None, "control/coding state drift")
    require(cc["codingAllowed"] is False and cc["controlBalanceClaimAllowed"] is False and cc["winnerFailureBalanceClaimAllowed"] is False and cc["scientificCredit"] == "NONE", "coding/credit drift")
    comp = contract["completionPolicy"]
    require(comp["successStatus"] == "RAW_CAPTURE_MATRIX_COMPLETE_UNCODED_NO_CREDIT" and comp["failureStatus"] == "TYPED_GLOBAL_HOLD_COMPLETED", "completion status drift")
    require(comp["successRequiresAllFortyFiveSlotsAndAllFifteenUnitsTerminalEachUnitAtLeastOneNewOpaquePrimaryRawPayloadPerRowAcceptedEDifferenceFromLAtMostOneBudgetSymmetryAndNoIncident"] is True, "completion success threshold drift")
    require(comp["partialMatrixPopulationControlEvidenceBundleOrCandidateUseForbidden"] is True and comp["afterCompletionAllSourceAccessSurfacesFalse"] is True, "completion partial/access drift")
    require(comp["nextQ010SubchunkAuthorized"] is False and comp["q003SchedulerEligible"] is False and comp["candidateState"] is None and comp["futureSourceRecordStatus"] == "NOT_CREATED_PENDING_SEPARATE_BLIND_DECISION" and comp["sourceRecordCount"] == 0 and comp["rawCaptureProjectionKnownAtValuesMustBeAbsent"] is True and comp["scientificCredit"] == "NONE" and comp["earlyDetectionSystemBuilt"] is False, "completion claim drift")
    inc = contract["carriedIncidents"]
    require(inc["sc001"] == {"incidentId": "Q010-SC001-INCIDENT-0001", "type": "OPERATOR_BLINDING_BREACH", "remainsEffective": True, "cannotBeCuredBySc003": True}, "SC001 incident carry drift")
    require(inc["sc002"] == {"incidentId": "Q010-SC002-INCIDENT-0001", "type": "LOCATOR_QUERY_AND_PROBE_TIMESTAMPS_NOT_RECORDED", "remainsEffective": True, "cannotBeCuredBySc003": True}, "SC002 incident carry drift")
    start = contract["startTransitionContract"]
    require(start["schema"] == "early-detection-q010-sc003-prospective-start-transition/v1" and start["tag919MustBeExactFiveModifyDirectChildOfLiveRemoteTag918"] is True and start["tag919MustBindAllFiveTag918ParentGitBlobSha1AndRawSha256Values"] is True, "start transition topology drift")
    require(start["frozenPolicyKeysMustRemainCanonicallyByteEquivalentToTag918"] == list(POLICY_KEYS) and start["frozenPolicyProjectionSha256MustEqualCommittedTag918Value"] is True, "start frozen-policy carry drift")
    require(start["preDecisionContractTopLevelKeysExact"] == PRE_TOP_LEVEL_KEYS and start["postStartContractTopLevelKeysExact"] == POST_TOP_LEVEL_KEYS, "start top-level schema drift")
    require(start["allowedTag919ContractMutationJsonPointers"] == ["/contractSelfSha256", "/implementation/controllerNormalizedSha256", "/implementation/testRawSha256", "/startIntroductionBinding", "/startFinalization"], "start mutation allowlist drift")
    require(start["requiredStartEvent"]["eventId"] == "Q010-SC003-EVT-00000002" and start["requiredStartEvent"]["sequence"] == 2 and start["requiredStartEvent"]["eventType"] == "SUBCHUNK_WORK_STARTED", "start event identity drift")
    require(start["causalOrderRequired"] == "TAG918_COMMIT_LE_DECISION_REMOTE_OBSERVED_LT_START_EVENT_CREATED_AT_LE_TAG919_COMMIT_LE_TAG919_REMOTE_OBSERVED_LT_FIRST_QUERY_PREPARED_LE_REQUEST_STARTED_LE_RESPONSE_OBSERVED_LE_RESPONSE_SEAL_PREPARED_LE_LEDGER_FSYNC_CONFIRMED_LT_NEXT_QUERY_PREPARED", "start/query causal order drift")
    require(start["requiredStartIntroductionBindingExactFields"] == ["schema", "decisionCommit", "decisionParentBlobs", "decisionRemoteRef", "decisionRemoteReceipt", "decisionFrozenPolicyProjectionSha256"], "start introduction field schema drift")
    require(start["requiredDecisionParentBlobFields"] == ["path", "gitBlobSha1", "rawSha256"], "start parent-blob field schema drift")
    require(start["requiredDecisionRemoteReceiptExactFields"] == ["schema", "observedHead", "observedUpstream", "observedRemoteRef", "observedRemoteOid", "gitLsRemoteRawSha256", "decisionParentBlobBindingsSha256", "observedAtUtc", "externallySigned", "receiptSha256"], "decision remote receipt schema drift")
    require(start["decisionRemoteReceiptHashRule"] == "SHA256_CANONICAL_JSON_SORTED_KEYS_COMPACT_UTF8_WITH_receiptSha256_NULL" and start["decisionRemoteReceiptExternallySignedMustBeFalse"] is True, "decision remote receipt truth drift")
    require(start["requiredStartFinalizationExactFields"] == ["schema", "decisionRemoteObservedAtUtc", "decisionRemoteReceiptSha256", "workStartedAtUtc", "privateStoreAbsentAtWorkStart", "storedResearchSourceAccessAuthorized", "runtimeResearchSourceAccessRequiresTag919PostGate"], "start finalization field schema drift")
    require(start["requiredStartBindingRules"] == {"decisionCommitMustEqualLiveRemoteTag918": True, "decisionParentBlobsMustBindExactlyAllFiveTag918PathsInRepositoryOrder": True, "decisionRemoteRefMustEqualFrozenRepositoryRemoteRef": True, "receiptObservedHeadUpstreamOidMustAllEqualDecisionCommit": True, "receiptObservedRemoteRefMustEqualFrozenRepositoryRemoteRef": True, "receiptObservedAtMustEqualStartFinalizationDecisionRemoteObservedAtUtc": True, "receiptSha256MustEqualStartFinalizationDecisionRemoteReceiptSha256": True, "decisionFrozenPolicyProjectionSha256MustEqualCommittedTag918Value": True, "workStartedAtUtcMustEqualRequiredStartEventCreatedAt": True, "privateStoreAbsentAtWorkStartMustBeTrue": True, "storedResearchSourceAccessAuthorizedMustBeFalse": True, "runtimeResearchSourceAccessRequiresTag919PostGateMustBeTrue": True, "additionalStartIntroductionOrFinalizationFieldsForbidden": True}, "start binding rules drift")
    require(start["researchSourceAccessAuthorizationIsRuntimeDerivedOnlyAfterTag919LiveRemoteGate"] is True and start["tag919StoredStateCannotClaimResearchSourceAccessAuthorizedBeforeRemoteObservation"] is True and start["tag919IndependentReviewRequiredBeforeCommit"] is True, "start authorization/review drift")
    require(canonical_sha(contract["populationPolicy"]) == EXPECTED_POPULATION_POLICY_SHA256, "population policy canonical drift")
    require(canonical_sha(contract["capturePlan"]) == EXPECTED_CAPTURE_PLAN_SHA256, "capture plan canonical drift")
    require(canonical_sha(contract["sourcePolicy"]) == EXPECTED_SOURCE_POLICY_SHA256, "source policy canonical drift")
    require(canonical_sha(contract["queryProtocol"]) == EXPECTED_QUERY_PROTOCOL_SHA256, "query protocol canonical drift")
    require(canonical_sha(contract["startTransitionContract"]) == EXPECTED_START_TRANSITION_SHA256, "start transition canonical drift")
    require(canonical_sha(contract["completionPolicy"]) == EXPECTED_COMPLETION_POLICY_SHA256, "completion policy canonical drift")


def validate_process_surface() -> None:
    tree = ast.parse(CONTROLLER_PATH.read_text(encoding="utf-8"))
    imports = {node.names[0].name for node in ast.walk(tree) if isinstance(node, ast.Import)}
    require(not imports.intersection({"requests", "urllib", "httpx", "aiohttp", "socket"}), "network import present in decision-only controller")
    attrs = [node for node in ast.walk(tree) if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id == "subprocess"]
    require(len(attrs) == 3 and sorted(node.attr for node in attrs) == ["TimeoutExpired", "run", "run"], "subprocess surface drift")
    require(not any(isinstance(node, ast.ImportFrom) and node.module == "subprocess" for node in ast.walk(tree)), "subprocess alias import forbidden")


def validate_bundle(contract: dict, events: list[dict], state: dict, check_files: bool = True) -> None:
    require(list(contract) == PRE_TOP_LEVEL_KEYS, "PRE contract top-level key surface drift")
    require(contract["purpose"] == PURPOSE, "contract purpose drift")
    require(contract["outputs"] == {"eventsPath": "state/early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-events-v1.jsonl", "statePath": "state/early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-state-v1.json"}, "outputs surface drift")
    require(contract["implementation"] == {"controllerPath": "scripts/early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-v1.py", "controllerNormalizedSha256": EXPECTED_CONTROLLER_NORMALIZED_SHA256, "testPath": "tests/early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-v1.test.js", "testRawSha256": EXPECTED_TEST_RAW_SHA256, "controllerChildExecutionsRequired": 0, "sourceAccessImplementationPresentAtDecision": False, "networkImportsForbiddenAtDecision": True}, "implementation surface drift")
    require(contract["schema"] == "early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-governance-contract/v1", "contract schema drift")
    require(contract_self_sha256(contract) == contract["contractSelfSha256"], "contract self hash drift")
    require(policy_projection_sha256(contract) == contract["frozenPolicyProjectionSha256"] == EXPECTED_POLICY_PROJECTION_SHA256, "frozen policy projection drift")
    validate_repository(contract)
    validate_parent_bindings(contract, check_files)
    validate_policy(contract)
    require(len(events) == 1 and events[0] == expected_event(contract), "decision event/replay drift")
    require(EXPECTED_DECISION_EVENT_SHA256 == "0" * 64 or events[0]["eventSha256"] == EXPECTED_DECISION_EVENT_SHA256, "controller-bound decision event head drift")
    require(state == expected_state(contract, events), "event-to-state replay drift")
    if check_files:
        require(not PRIVATE_STORE_ROOT.exists(), "private SC003 store must not exist before Tag919 POST start gate")
        validate_process_surface()
        require(sha256_path(CONTRACT_PATH) == EXPECTED_CONTRACT_RAW_SHA256, "contract raw hash drift")
        require(controller_normalized_sha256() == EXPECTED_CONTROLLER_NORMALIZED_SHA256, "controller normalized hash drift")
        require(sha256_path(EVENTS_PATH) == EXPECTED_EVENTS_RAW_SHA256, "events raw hash drift")
        require(sha256_path(STATE_PATH) == EXPECTED_STATE_RAW_SHA256, "state raw hash drift")
        require(sha256_path(TEST_PATH) == EXPECTED_TEST_RAW_SHA256, "test raw hash drift")
        impl = contract["implementation"]
        require(impl["controllerPath"] == "scripts/early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-v1.py" and impl["controllerNormalizedSha256"] == EXPECTED_CONTROLLER_NORMALIZED_SHA256, "controller implementation binding drift")
        require(impl["testPath"] == "tests/early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-v1.test.js" and impl["testRawSha256"] == EXPECTED_TEST_RAW_SHA256, "test implementation binding drift")
        require(impl["controllerChildExecutionsRequired"] == 0 and impl["sourceAccessImplementationPresentAtDecision"] is False and impl["networkImportsForbiddenAtDecision"] is True, "decision-only implementation drift")


def remote_phase(contract: dict) -> tuple[str, str | None, str | None]:
    repo = contract["repository"]
    require(run_git(["rev-parse", "--show-toplevel"]).replace("\\", "/") == str(ROOT).replace("\\", "/"), "wrong worktree")
    require(run_git(["branch", "--show-current"]) == repo["branch"], "wrong branch")
    require(run_git(["remote", "get-url", "origin"]) == repo["remoteUrl"], "origin URL drift")
    head = run_git(["rev-parse", "HEAD"])
    upstream = run_git(["rev-parse", "@{u}"])
    remote_line = run_git(["ls-remote", "origin", repo["remoteRef"]])
    observed_at = datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")
    remote = remote_line.split()[0] if remote_line else ""
    require(remote and upstream == remote, "upstream/live remote mismatch")
    base = repo["baseCommit"]
    require(run_git(["show", "-s", "--format=%P", base]) == contract["parentTag917Binding"]["parent"], "base parent drift")
    require(run_git(["show", "-s", "--format=%s", base]) == contract["parentTag917Binding"]["subject"], "base subject drift")
    paths = repo["ownedPaths"]
    if head == base and remote == base:
        status = run_git(["status", "--porcelain", "--", *paths]).splitlines()
        require(len(status) == 5 and all(line.startswith("?? ") for line in status), "decision PRE requires exact five untracked paths")
        require(not run_git(["diff", "--cached", "--name-only", "--", *paths]), "decision paths must be unstaged during PRE diagnostic")
        return "DECISION_PRE_INTRODUCTION", None, None
    require(head == remote, "HEAD/live remote mismatch")
    require(run_git(["show", "-s", "--format=%P", "HEAD"]) == base, "decision introduction parent drift")
    require(run_git(["show", "-s", "--format=%s", "HEAD"]) == repo["expectedDecisionSubject"], "decision introduction subject drift")
    commit_time = run_git(["show", "-s", "--format=%cI", "HEAD"])
    require(datetime.fromisoformat(commit_time).timestamp() >= datetime.fromisoformat(contract["decision"]["decisionRecordedAtUtc"].replace("Z", "+00:00")).timestamp(), "decision commit predates recorded decision")
    require(datetime.fromisoformat(observed_at.replace("Z", "+00:00")).timestamp() >= datetime.fromisoformat(commit_time).timestamp(), "remote observation predates commit")
    delta = run_git(["diff-tree", "--no-commit-id", "--name-status", "-r", "HEAD"]).splitlines()
    require(sorted(tuple(line.split("\t", 1)) for line in delta if line) == sorted(("A", path) for path in paths), "decision introduction must be exact five additions")
    require(not run_git(["status", "--porcelain", "--", *paths]), "post-decision owned paths dirty")
    for path in paths:
        require(run_git(["hash-object", "--no-filters", path]) == run_git(["rev-parse", f"HEAD:{path}"]), "introduced decision blob differs: " + path)
    return "DECISION_POST_INTRODUCTION", head, observed_at


def verify(remote: bool) -> dict:
    require(remote, "--remote is mandatory")
    contract, events, state = read_contract(), read_events(), read_state()
    validate_bundle(contract, events, state, check_files=True)
    phase, commit, observed = remote_phase(contract)
    post = phase == "DECISION_POST_INTRODUCTION"
    return {
        "schema": "early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-verification/v1",
        "status": "PASS" if post else "DECISION_PRE_INTRODUCTION_DIAGNOSTIC",
        "phase": phase,
        "introductionCommit": commit,
        "remoteObservedAtUtc": observed,
        "subchunkId": contract["decision"]["subchunkId"],
        "workClass": contract["decision"]["workClass"],
        "populationCount": 7,
        "captureUnitCount": 15,
        "targetDimensions": ["T", "E", "L"],
        "decisionRecorded": True,
        "decisionRemoteIntroductionVerified": post,
        "workStarted": False,
        "researchSourceAccessAuthorized": False,
        "codingAllowed": False,
        "candidateState": None,
        "futureSourceRecordStatus": "NOT_CREATED_PENDING_SEPARATE_BLIND_DECISION",
        "sourceRecordCount": 0,
        "controlMatchingAllowed": False,
        "scientificCredit": "NONE",
        "nextQ010SubchunkAuthorized": False,
        "q003SchedulerEligible": False,
        "sc001IncidentRemainsEffective": True,
        "sc002IncidentRemainsEffective": True,
        "earlyDetectionSystemBuilt": False,
        "frozenPolicyProjectionSha256": contract["frozenPolicyProjectionSha256"],
        "controllerChildExecutions": 0,
    }


def bootstrap(write: bool) -> dict:
    contract = read_contract()
    contract["sourcePolicy"]["queryTemplates"] = expected_routes()
    contract["capturePlan"]["slotSchedule"] = expected_slot_schedule()
    contract["sourcePolicy"]["frozenQueryTemplatesSha256"] = frozen_query_templates_sha256(contract)
    contract["capturePlan"]["slotScheduleSha256"] = slot_schedule_sha256(contract)
    contract["frozenPolicyProjectionSha256"] = policy_projection_sha256(contract)
    contract["implementation"]["controllerNormalizedSha256"] = controller_normalized_sha256()
    contract["implementation"]["testRawSha256"] = sha256_path(TEST_PATH)
    contract["contractSelfSha256"] = contract_self_sha256(contract)
    events = [expected_event(contract)]
    state = expected_state(contract, events)
    contract_raw = json.dumps(contract, ensure_ascii=False, indent=2) + "\n"
    events_raw = json.dumps(events[0], ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
    state_raw = json.dumps(state, ensure_ascii=False, indent=2) + "\n"
    result = {
        "contractRawSha256": sha256_bytes(contract_raw.encode("utf-8")),
        "contractSelfSha256": contract["contractSelfSha256"],
        "controllerNormalizedSha256": controller_normalized_sha256(),
        "eventsRawSha256": sha256_bytes(events_raw.encode("utf-8")),
        "eventSha256": events[0]["eventSha256"],
        "stateRawSha256": sha256_bytes(state_raw.encode("utf-8")),
        "stateSelfSha256": state["stateSelfSha256"],
        "projectionSha256": canonical_sha(state["projection"]),
        "frozenPolicyProjectionSha256": contract["frozenPolicyProjectionSha256"],
        "testRawSha256": contract["implementation"]["testRawSha256"],
        "populationPolicySha256": canonical_sha(contract["populationPolicy"]),
        "capturePlanSha256": canonical_sha(contract["capturePlan"]),
        "sourcePolicySha256": canonical_sha(contract["sourcePolicy"]),
        "queryProtocolSha256": canonical_sha(contract["queryProtocol"]),
        "startTransitionSha256": canonical_sha(contract["startTransitionContract"]),
        "completionPolicySha256": canonical_sha(contract["completionPolicy"]),
    }
    if write:
        CONTRACT_PATH.write_text(contract_raw, encoding="utf-8", newline="\n")
        EVENTS_PATH.write_text(events_raw, encoding="utf-8", newline="\n")
        STATE_PATH.write_text(state_raw, encoding="utf-8", newline="\n")
    return result


def self_test() -> dict:
    contract, events, state = read_contract(), read_events(), read_state()
    validate_bundle(contract, events, state, check_files=True)
    attacks: list[str] = []

    def rebind(c: dict) -> tuple[list[dict], dict]:
        c["sourcePolicy"]["frozenQueryTemplatesSha256"] = frozen_query_templates_sha256(c)
        c["capturePlan"]["slotScheduleSha256"] = slot_schedule_sha256(c)
        c["frozenPolicyProjectionSha256"] = policy_projection_sha256(c)
        c["contractSelfSha256"] = contract_self_sha256(c)
        e = [expected_event(c)]
        return e, expected_state(c, e)

    def rejected(name: str, mutate) -> None:
        c = copy.deepcopy(contract)
        mutate(c)
        e, s = rebind(c)
        try:
            validate_bundle(c, e, s, check_files=False)
        except GateError:
            attacks.append(name)
            return
        fail("mutation survived: " + name)

    rejected("base-commit", lambda c: c["repository"].__setitem__("baseCommit", "0" * 40))
    rejected("top-level-source-access", lambda c: c.__setitem__("researchSourceAccessAuthorized", True))
    rejected("premature-start-finalization", lambda c: c.__setitem__("startFinalization", {"storedResearchSourceAccessAuthorized": True}))
    rejected("purpose-authorizes-credit", lambda c: c.__setitem__("purpose", "Authorize source access and scientific credit"))
    rejected("implementation-network-allowed", lambda c: c["implementation"].__setitem__("networkAllowed", True))
    rejected("outputs-scientific-credit", lambda c: c["outputs"].__setitem__("scientificCredit", "FULL"))
    rejected("subject", lambda c: c["repository"].__setitem__("expectedDecisionSubject", "Tag 918: drift"))
    rejected("parent-blob", lambda c: c["parentTag917Binding"]["parentBlobs"][0].__setitem__("rawSha256", "0" * 64))
    rejected("parent-hold", lambda c: c["parentTag917Binding"].__setitem__("requiredChunkStatus", "PASS"))
    rejected("parent-timing-incident", lambda c: c["parentTag917Binding"].__setitem__("requiredProspectiveLocatorTimingMachineVerified", True))
    rejected("tag914-report", lambda c: c["parentTag914CorpusBinding"].__setitem__("reportRawSha256", "0" * 64))
    rejected("work-class", lambda c: c["decision"].__setitem__("workClass", "SUPPORTING"))
    rejected("dimension", lambda c: c["decision"].__setitem__("targetDimensions", ["T", "E"]))
    rejected("balance-claim", lambda c: c["decision"].__setitem__("balancedMeaning", "EQUAL_EVIDENCE"))
    rejected("cutoff", lambda c: c["decision"].__setitem__("sourceKnownAtCutoffInclusiveUtc", "2026-12-31T23:59:59Z"))
    rejected("decision-time", lambda c: c["decision"].__setitem__("decisionRecordedAtUtc", "2026-08-13T00:00:00Z"))
    rejected("timing-verified-local", lambda c: c["decision"].__setitem__("preChunkTimingVerifiedAtDraft", True))
    rejected("work-started", lambda c: c["decision"].__setitem__("workStarted", True))
    rejected("source-authorized", lambda c: c["decision"].__setitem__("researchSourceAccessAuthorized", True))
    rejected("coding-allowed", lambda c: c["decision"].__setitem__("codingAllowed", True))
    rejected("candidate-allowed", lambda c: c["decision"].__setitem__("candidateStateComputationAllowed", True))
    rejected("credit", lambda c: c["decision"].__setitem__("scientificCredit", "FULL"))
    rejected("next", lambda c: c["decision"].__setitem__("nextQ010SubchunkAuthorized", True))
    rejected("q003", lambda c: c["decision"].__setitem__("q003SchedulerEligible", True))
    rejected("bias", lambda c: c["decision"]["namedBiasesPrevented"].pop())
    rejected("continue-forever", lambda c: c["decision"].__setitem__("continuationCriterion", "CONTINUE_FOREVER"))
    rejected("never-stop", lambda c: c["decision"].__setitem__("pauseOrStopCriterion", "NEVER_STOP"))
    rejected("row-drop", lambda c: c["populationPolicy"]["rows"].pop())
    rejected("row-rename", lambda c: c["populationPolicy"]["rows"][0].__setitem__("reportedLegalName", "Winner Inc"))
    rejected("tesla-budget-special", lambda c: c["populationPolicy"].__setitem__("teslaResolvedIdentityCannotChangeBudgetRouteOrAcceptance", False))
    rejected("current-id", lambda c: c["populationPolicy"].__setitem__("currentTickerCikParentSuccessorOrProfileLookupForbidden", False))
    rejected("unit-drop", lambda c: c["capturePlan"]["units"].pop())
    rejected("request-cap", lambda c: c["capturePlan"].__setitem__("requestHardCap", 99))
    rejected("accepted-payload-means-source-record", lambda c: c["capturePlan"].__setitem__("acceptedPayloadTermDefinition", "COMPLETE_SOURCE_RECORD"))
    rejected("response-byte-cap", lambda c: c["capturePlan"].__setitem__("maxResponseBytesPerRequest", 999999999))
    rejected("automatic-retry", lambda c: c["capturePlan"].__setitem__("automaticRetryCount", 1))
    rejected("failed-free", lambda c: c["capturePlan"].__setitem__("failedRequestsAndRedirectHopsConsumeBudget", False))
    rejected("budget-transfer", lambda c: c["capturePlan"].__setitem__("budgetTransferForbidden", False))
    rejected("early-stop", lambda c: c["capturePlan"].__setitem__("earlyStopAfterSuccessForbidden", False))
    rejected("tesla-extra-request", lambda c: c["capturePlan"]["units"][11].__setitem__("maxRequests", 4))
    rejected("slot-drop", lambda c: c["capturePlan"]["slotSchedule"].pop())
    rejected("slot-template", lambda c: c["capturePlan"]["slotSchedule"][0].__setitem__("templateId", "DYNAMIC"))
    rejected("el-hit-balance", lambda c: c["capturePlan"].__setitem__("perRowAcceptedPayloadDifferenceBetweenEAndLMaximum", 99))
    rejected("secondary-credit", lambda c: c["sourcePolicy"].__setitem__("secondarySources", "SIGNAL"))
    rejected("paid", lambda c: c["sourcePolicy"].__setitem__("paidSourcesForbidden", False))
    rejected("knownat", lambda c: c["sourcePolicy"].__setitem__("effectiveDateNeverSubstitutesForAvailabilityKnownAt", False))
    rejected("source-class", lambda c: c["sourcePolicy"]["acceptedSourceClassPriority"].pop())
    rejected("publisher-add", lambda c: c["sourcePolicy"]["publisherAuthorityAllowlist"].append({"authorityId": "WINNER_NEWS", "allowedHosts": ["example.com"], "populationRowIds": ["DMV2015-TESLA"], "role": "PRIMARY_PUBLISHER"}))
    rejected("publisher-coherent-replace", lambda c: c["sourcePolicy"]["publisherAuthorityAllowlist"][1]["allowedHosts"].__setitem__(0, "winner-selection.example"))
    rejected("archive-signal", lambda c: c["sourcePolicy"]["archiveTransportAllowlist"][0].__setitem__("archiveMetadataCannotSetTELOrScientificCredit", False))
    rejected("secondary-locator-add", lambda c: c["sourcePolicy"]["secondaryLocatorPublisherAllowlist"].append("SEARCH_ENGINE"))
    rejected("dynamic-publisher", lambda c: c["sourcePolicy"].__setitem__("unlistedPublisherOrTransportDisposition", "ACCEPT"))
    rejected("query-template-term", lambda c: c["sourcePolicy"]["queryTemplates"][0]["termExpression"].append("robotaxi"))
    rejected("query-template-version", lambda c: c["sourcePolicy"].__setitem__("frozenQueryTemplateVersion", "LATEST"))
    rejected("future-source-record-field", lambda c: c["sourcePolicy"]["requiredFutureSignalEligibleSourceRecordFields"].remove("knownAt"))
    rejected("raw-capture-manifest-field", lambda c: c["sourcePolicy"]["rawCaptureManifestRequiredFields"].remove("cdxDigestMatchBoolean"))
    rejected("raw-capture-falsely-requires-source-record", lambda c: c["sourcePolicy"]["rawCaptureAndSourceRecordSeparation"].__setitem__("completeFutureSignalEligibleSourceRecordRequiredForRawCaptureUnitSuccess", True))
    rejected("raw-capture-sets-knownat", lambda c: c["sourcePolicy"]["rawCaptureAndSourceRecordSeparation"].__setitem__("rawCaptureUnitSuccessCannotSetKnownAtEntityTELCandidateTimeCapsuleOrScientificCredit", False))
    rejected("cdx-truncation-ignored", lambda c: c["sourcePolicy"]["resultSelectionAlgorithms"][0]["steps"].remove("IF_COMPLETENESS_IS_NOT_PROVEN_MARK_WHOLE_UNIT_TYPED_HOLD_AND_TERMINALIZE_BOTH_DERIVED_PAYLOAD_SLOTS_WITHOUT_NETWORK_REQUEST"))
    rejected("cdx-completeness-field-drop", lambda c: c["sourcePolicy"]["safeProjectionParsers"][0]["allowedOutputFields"].remove("completenessProven"))
    rejected("cdx-row-limit-fail-open", lambda c: c["sourcePolicy"]["locatorCompletenessContract"].__setitem__("returnedRowCountHardHoldAtOrAbove", 501))
    rejected("opaque-knownat-output", lambda c: c["sourcePolicy"]["safeProjectionParsers"][1]["allowedOutputFields"].append("knownAt"))
    rejected("future-source-status-created", lambda c: c["sourcePolicy"]["rawCaptureAndSourceRecordSeparation"].__setitem__("futureSourceRecordStatusAtCaptureMustEqual", "CREATED"))
    rejected("capture-signal-eligible", lambda c: c["sourcePolicy"].__setitem__("captureSourceRecordsAreNotSignalEligible", False))
    rejected("inherited-payload-drop", lambda c: c["sourcePolicy"]["inheritedTag914PayloadManifest"].pop())
    rejected("inherited-payload-counted", lambda c: c["sourcePolicy"].__setitem__("payloadHashMatchingInheritedManifestDisposition", "ACCEPTED_SC003_SUCCESS"))
    rejected("slot-authority-coherent-rehash", lambda c: c["capturePlan"]["slotSchedule"][3].__setitem__("publisherAuthorityId", "TESLA_OFFICIAL"))
    rejected("slot-method-coherent-rehash", lambda c: c["capturePlan"]["slotSchedule"][0].__setitem__("method", "POST"))
    rejected("uri-materializer-free-choice", lambda c: c["sourcePolicy"]["uriMaterializers"][0].__setitem__("pagination", "OPERATOR_CHOICE"))
    rejected("knownat-min-not-max", lambda c: c["sourcePolicy"]["knownAtRules"]["OFFICIAL_ISSUER_CONTEMPORANEOUS_TECHNICAL_CUSTOMER_OR_OPERATIONS_DOCUMENT"].__setitem__("formula", "MIN_SOURCE_TIMESTAMP_AND_OBSERVATION_TIMESTAMP"))
    rejected("unsupported-term-provenance", lambda c: c["sourcePolicy"]["frozenContemporaneousTerms"].append("robotaxi"))
    rejected("query-prepared-field-substitution", lambda c: c["queryProtocol"]["queryPreparedRequiredFields"].__setitem__(c["queryProtocol"]["queryPreparedRequiredFields"].index("requestBytesSha256"), "arbitraryField"))
    rejected("private-ledger-in-repo", lambda c: c["queryProtocol"].__setitem__("privateLiveAuditLedgerPath", str(EVENTS_PATH)))
    rejected("response-seal-time-drop", lambda c: c["queryProtocol"]["queryResponseRequiredFields"].remove("responseSealPreparedAtUtc"))
    rejected("run-state-ledger-sha-drop", lambda c: c["queryProtocol"]["runStateRequiredFields"].remove("lastResponseLedgerRawSha256"))
    rejected("fsync-crash-reconstruct", lambda c: c["queryProtocol"].__setitem__("crashAfterLedgerFsyncBeforeDurableMatchingRunState", "RECONSTRUCT"))
    rejected("remote-receipt-signed-claim", lambda c: c["queryProtocol"].__setitem__("preQueryRemoteReceiptExternallySignedMustBeFalse", False))
    rejected("start-policy-mutation-expanded", lambda c: c["startTransitionContract"]["allowedTag919ContractMutationJsonPointers"].append("/sourcePolicy"))
    rejected("start-causal-order", lambda c: c["startTransitionContract"].__setitem__("causalOrderRequired", "QUERY_BEFORE_REMOTE_ALLOWED"))
    rejected("start-static-candidate", lambda c: c["startTransitionContract"]["requiredStartEvent"]["staticPayload"].__setitem__("candidateState", "RESEARCH_WATCH"))
    rejected("start-introduction-free-field", lambda c: c["startTransitionContract"]["requiredStartIntroductionBindingExactFields"].append("operatorChoice"))
    rejected("start-finalization-stored-access", lambda c: c["startTransitionContract"]["requiredStartBindingRules"].__setitem__("storedResearchSourceAccessAuthorizedMustBeFalse", False))
    rejected("raw-storage-pre-attribution-disabled", lambda c: c["populationPolicy"].__setitem__("payloadMayBeStoredByFrozenSlotBeforeEntityAttribution", False))
    rejected("capture-attribution-asserted", lambda c: c["populationPolicy"].__setitem__("capturePopulationRowAttributionStatus", "ATTRIBUTED"))
    rejected("capture-route-sets-entity", lambda c: c["populationPolicy"].__setitem__("captureRouteOrFilenameMatchCannotSetEntityTELCandidateOrScientificCredit", False))
    rejected("wayback-digest-not-required", lambda c: c["sourcePolicy"]["waybackSelectedPayloadDigestRule"].__setitem__("requiredComparison", "TRUST_CDX_DIGEST"))
    rejected("opaque-pdf-quarantined", lambda c: c["sourcePolicy"]["safeProjectionParsers"][1].__setitem__("htmlPdfXmlOrBinaryContentDisposition", "QUARANTINED_HOLD"))
    rejected("opaque-content-parsed", lambda c: c["sourcePolicy"]["safeProjectionParsers"][1].__setitem__("payloadContentMustRemainOpaqueAtCapture", False))
    rejected("completion-before-all-slots", lambda c: c["completionPolicy"].__setitem__("successRequiresAllFortyFiveSlotsAndAllFifteenUnitsTerminalEachUnitAtLeastOneNewOpaquePrimaryRawPayloadPerRowAcceptedEDifferenceFromLAtMostOneBudgetSymmetryAndNoIncident", False))
    rejected("modern-term", lambda c: c["sourcePolicy"].__setitem__("modernTermBackprojectionForbidden", False))
    rejected("raw-render", lambda c: c["sourcePolicy"].__setitem__("rawResponseMustBeOpaqueContentAddressedPrivateAndNeverRenderedToOperatorLlmOrCoder", False))
    rejected("forbidden-projection", lambda c: c["sourcePolicy"].__setitem__("projectionMustBeFieldAllowlistedAndForbiddenFieldExposureFalse", False))
    rejected("null-negative", lambda c: c["sourcePolicy"].__setitem__("null404TimeoutOrMissingDocumentMeaning", "NEGATIVE_EVIDENCE"))
    rejected("dedupe", lambda c: c["sourcePolicy"].__setitem__("deduplicateExactPayloadBytes", False))
    rejected("manual-network", lambda c: c["queryProtocol"].__setitem__("manualBrowserWebToolPowerShellCurlAndPrefetchForbiddenAfterStart", False))
    rejected("prequery-log", lambda c: c["queryProtocol"].__setitem__("beforeEveryRequestAppendFlushAndFsyncQueryPrepared", False))
    rejected("response-log", lambda c: c["queryProtocol"].__setitem__("afterEveryResponseBeforeNextRequestAppendFlushAndFsyncQueryResponseSealed", False))
    rejected("request-overlap", lambda c: c["queryProtocol"].__setitem__("requestNPlusOneBeforeResponseNSealedForbidden", False))
    rejected("backfill", lambda c: c["queryProtocol"].__setitem__("crashOrMissingBackfilledTimestampHashOrResponsePolicy", "RECONSTRUCT"))
    rejected("external-time-claim", lambda c: c["queryProtocol"].__setitem__("localClockIsNotExternalSignedAbsoluteTimeAttestation", False))
    rejected("dirty-query", lambda c: c["queryProtocol"].__setitem__("tag919OwnedPathsMustMatchExactCommittedBlobsWithNoTrackedOrUntrackedDriftBeforeEveryRequest", False))
    rejected("control-pass", lambda c: c["controlAndCodingPolicy"].__setitem__("matchedControlPopulationStatus", "PASS"))
    rejected("level", lambda c: c["controlAndCodingPolicy"].__setitem__("dimensionLevel", 2))
    rejected("candidate", lambda c: c["controlAndCodingPolicy"].__setitem__("candidateState", "RESEARCH_WATCH"))
    rejected("partial-use", lambda c: c["completionPolicy"].__setitem__("partialMatrixPopulationControlEvidenceBundleOrCandidateUseForbidden", False))
    rejected("completion-next", lambda c: c["completionPolicy"].__setitem__("nextQ010SubchunkAuthorized", True))
    rejected("completion-source-record-count", lambda c: c["completionPolicy"].__setitem__("sourceRecordCount", 1))
    rejected("sc001-drop", lambda c: c["carriedIncidents"]["sc001"].__setitem__("remainsEffective", False))
    rejected("sc002-drop", lambda c: c["carriedIncidents"]["sc002"].__setitem__("remainsEffective", False))
    rejected("system-built", lambda c: c["completionPolicy"].__setitem__("earlyDetectionSystemBuilt", True))
    require(len(attacks) == 110, "self-test kill count drift")
    return {"status": "PASS", "kills": len(attacks), "controllerChildExecutions": 0}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["bootstrap", "self-test", "verify", "start"])
    parser.add_argument("--remote", action="store_true")
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    try:
        if args.command == "bootstrap":
            print(json.dumps(bootstrap(args.write), sort_keys=True))
            return 0
        if args.command == "self-test":
            print(json.dumps(self_test(), sort_keys=True))
            return 0
        result = verify(args.remote)
        if args.command == "start":
            fail("SC003 source access requires a separately introduced and verified Tag919 start event")
        print(json.dumps(result, sort_keys=True))
        return 0
    except (GateError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as exc:
        print(json.dumps({"status": "FAIL", "error": str(exc)}, sort_keys=True), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
