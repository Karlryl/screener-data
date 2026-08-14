#!/usr/bin/env python3
"""Prospective Tag919 start gate and bounded raw-capture runner for Q010-SC003."""

from __future__ import annotations

import argparse
import ast
import base64
from collections import Counter
import copy
import ctypes
from ctypes import wintypes
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import http.client
import json
import os
import re
import ssl
import subprocess
import sys
import unicodedata
from urllib.parse import quote, unquote, urlsplit
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "research/early-detection-v4/q010-sc003-dmv7-balanced-tel-raw-capture-governance-contract-v1.json"
EVENTS_PATH = ROOT / "state/early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-events-v1.jsonl"
STATE_PATH = ROOT / "state/early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-state-v1.json"
TEST_PATH = ROOT / "tests/early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-v1.test.js"
CONTROLLER_PATH = Path(__file__).resolve()

EXPECTED_CONTRACT_RAW_SHA256 = "e2b7a61deee94f90e83379dc3fac3ba57bb1a7bc5e949ab9d76c0633f885c247"
EXPECTED_CONTROLLER_NORMALIZED_SHA256 = "28ce8d99856c5e5f2aafc8ddd045f429212bd06803ff19d6da958ba19a1ab307"
EXPECTED_EVENTS_RAW_SHA256 = "813f3ec470be3d3e8eeda7e79d257465849dab6d3232362e16d6d64c30eb2439"
EXPECTED_STATE_RAW_SHA256 = "4d10c48bdc2491e7d5d79435b544f163dff6768ca84f8831be36553f9dc4a2d7"
EXPECTED_TEST_RAW_SHA256 = "14e11e5df179f3c1cfa747445c8681aa892f2c2ceb32f77dd8d3517024286ddb"
EXPECTED_POLICY_PROJECTION_SHA256 = "292ac581b242097b523d593edf177ef12e716dbb06a876ba8f0d873edf39cd0c"
EXPECTED_DECISION_EVENT_SHA256 = "693d1c86049acc4b373c86171d17773b3c8f242e8a94cdd05207f40358f24ee2"
EXPECTED_POPULATION_POLICY_SHA256 = "a99ba3ffe63aea0e8447a7cb8bb8364af7f00361ec4710031ae18e3cd9651495"
EXPECTED_CAPTURE_PLAN_SHA256 = "a231e64ad6338f393ba111a3243e50fe929a59c48df6b7d5e908810552cc455e"
EXPECTED_SOURCE_POLICY_SHA256 = "57bfe2a7bf0234f99f8e3656587eeb065219d28c37d624aa06fde51256f88444"
EXPECTED_QUERY_PROTOCOL_SHA256 = "4eb71546b9f4ba68bb8f7469ab269ca8f67e19cb66ddd432044e6d6ce7a634cf"
EXPECTED_START_TRANSITION_SHA256 = "ed6c32b9f5ab21b5c2e733c21f824f1734716c8def08ef0d173f69c27382e899"
EXPECTED_COMPLETION_POLICY_SHA256 = "dd5a03d2e985fc67d82b0936c01fe38e96cee3b3ad83dbadea382a0e4749f423"

TAG918 = "bdaf8dc911f1ca796f9370627901fd1003083ba3"
TAG918_PARENT = "f606124109b71d20f3ecd555f501afb84d95446c"
TAG918_SUBJECT = "Tag 918: Q010-SC003 Rohquellenkapsel vor Arbeitsbeginn versiegeln"
TAG919 = "6586dc246e842ac3dda6eea67094afd16e38bb46"
TAG919_SUBJECT = "Tag 919: Q010-SC003 Rohquellenkapsel prospektiv starten"
TAG920_SUBJECT = "Tag 920: Q010-SC003 Rohquellenkapsel fail-closed abschließen"
START_REMOTE_OBSERVED_AT = "2026-08-14T01:34:33.454637Z"
WORK_STARTED_AT = "2026-08-14T01:34:34.454637Z"
TAG918_EVENT_PREFIX_SHA256 = "f6b3408acd50409485595b33ae0ca9cbcdc060d91c509f7ab74853341f7b1158"
TAG919_EVENT_PREFIX_SHA256 = "1cf279bfab4104a718f085d22b1842187085f489e3f2cc90dc17c8d48b205b71"
TAG919_EVENT_HEAD_SHA256 = "690b5e13c1c51b7de9a62d63833f6afb2f5c120844ab9c1f375abf8fd34b5009"
TAG918_BLOBS = [
    {"path": "research/early-detection-v4/q010-sc003-dmv7-balanced-tel-raw-capture-governance-contract-v1.json", "gitBlobSha1": "69690f462310ddbecc213e650de3d439c1d05eaf", "rawSha256": "87e1fe77ae1507fe0d6acd6b79b035bb920a2580cea65670f7c44b49ca174218"},
    {"path": "scripts/early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-v1.py", "gitBlobSha1": "a69cce278a11a66528ebefb2cc0907f7bf6ae70b", "rawSha256": "004f4c0ab36815ffdca1df8f0b7f865010be12c0e75abf9fdf5b93d90774ce7f"},
    {"path": "state/early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-events-v1.jsonl", "gitBlobSha1": "f1b522933d42cd22040eca942ee78bf0a9f78699", "rawSha256": "f6b3408acd50409485595b33ae0ca9cbcdc060d91c509f7ab74853341f7b1158"},
    {"path": "state/early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-state-v1.json", "gitBlobSha1": "dbf6458f9c4d8b28bac9f1f3ad410d8b5190c57f", "rawSha256": "0c7732d26c648a6a313820f0b26547899acb0255af90392f5cd188ccf725fa36"},
    {"path": "tests/early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-v1.test.js", "gitBlobSha1": "2ca985c387cbd6da6232180d50d545ac79c0b755", "rawSha256": "b1d012b7d158fda7d186a837fc553d76b728ebef44dc9b22360f99e7df721a0f"},
]
TAG919_BLOBS = [
    {"path": "research/early-detection-v4/q010-sc003-dmv7-balanced-tel-raw-capture-governance-contract-v1.json", "gitBlobSha1": "12a85a8e2d6a086cfe2af302faa3966f0f8b3b60", "rawSha256": "20d76833f55d9ded09a87c033eecd8c53a952dc1e07098ad620d01d08e006f56"},
    {"path": "scripts/early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-v1.py", "gitBlobSha1": "c6c767dad991973307ff2fa07a86c07087e0beac", "rawSha256": "1a7e2f81ead948c1d12d2278ac817d816e9db5d76da882da855600db1cba6446"},
    {"path": "state/early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-events-v1.jsonl", "gitBlobSha1": "28450e54038fce5182d1b25e3759ad270713d357", "rawSha256": "1cf279bfab4104a718f085d22b1842187085f489e3f2cc90dc17c8d48b205b71"},
    {"path": "state/early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-state-v1.json", "gitBlobSha1": "e71dfa3eb2219d8bf49b4ab26fa1255742d34151", "rawSha256": "7f67e141bda7b679a7c454e2074e5b732fad42763db29bddc12df5a4069a4c23"},
    {"path": "tests/early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-v1.test.js", "gitBlobSha1": "6eeb3b8b4f0033871d92598b525019a5a5f74f9f", "rawSha256": "8daaf787e1e2f980acb12ccf0109c707085065649f99a63f6a16e11359ecdb78"},
]
REQUEST_HEADERS = (
    ("Host", "web.archive.org"),
    ("Accept", "*/*"),
    ("Accept-Encoding", "identity"),
    ("User-Agent", "GrowthScreener-Q010-SC003-RawCapture/1.0"),
)
FORBIDDEN_REQUEST_HEADERS = frozenset({"authorization", "cookie", "proxy-authorization"})

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
START_TOP_LEVEL_KEYS = [*PRE_TOP_LEVEL_KEYS, "startIntroductionBinding", "startFinalization"]
POST_TOP_LEVEL_KEYS = [*START_TOP_LEVEL_KEYS, "completionTransitionContract", "completionIntroductionBinding", "completionFinalization"]

PRIVATE_STORE_ROOT = Path(r"C:\Users\Anwender\Documents\GrowthScreenerResearchData\early-detection-v4\q010-sc003-dmv7-balanced-tel-raw-capture-v1")
RUNTIME_MUTEX_NAME = r"Global\GrowthScreener-Q010-SC003-DMV7-RawCapture-v1"
MOVEFILE_REPLACE_EXISTING = 0x00000001
MOVEFILE_WRITE_THROUGH = 0x00000008
GENERIC_WRITE = 0x40000000
FILE_SHARE_READ = 0x00000001
FILE_SHARE_WRITE = 0x00000002
FILE_SHARE_DELETE = 0x00000004
OPEN_EXISTING = 3
FILE_FLAG_BACKUP_SEMANTICS = 0x02000000
INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value
ERROR_ALREADY_EXISTS = 183
KNOWN_OPAQUE_MIME_TYPES = frozenset({
    "application/json", "application/msword", "application/octet-stream", "application/pdf",
    "application/rtf", "application/vnd.ms-excel", "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/xhtml+xml", "application/xml", "application/zip", "image/gif", "image/jpeg",
    "image/png", "image/tiff", "text/csv", "text/html", "text/plain", "text/xml",
})
ENCODING_HOLD_REASONS = frozenset({"HOLD_DUPLICATE_CONTENT_ENCODING_HEADERS", "HOLD_UNEXPECTED_CONTENT_ENCODING"})
CONTENT_TYPE_HOLD_REASONS = frozenset({"HOLD_CONTENT_TYPE_HEADER_MISSING", "HOLD_DUPLICATE_CONTENT_TYPE_HEADERS", "HOLD_UNKNOWN_MIME_TYPE"})
HEADER_HOLD_REASONS = ENCODING_HOLD_REASONS | CONTENT_TYPE_HOLD_REASONS


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


def expected_decision_event() -> dict:
    raw = run_git_bytes(["show", f"{TAG918}:{EVENTS_PATH.relative_to(ROOT).as_posix()}"])
    require(sha256_bytes(raw) == TAG918_EVENT_PREFIX_SHA256, "Tag918 event prefix drift")
    rows = [json.loads(line) for line in raw.decode("utf-8").splitlines() if line]
    require(len(rows) == 1 and rows[0]["eventSha256"] == EXPECTED_DECISION_EVENT_SHA256, "Tag918 decision event drift")
    return rows[0]


def expected_start_event(contract: dict, decision_event: dict) -> dict:
    binding = contract["startIntroductionBinding"]
    finalization = contract["startFinalization"]
    event = {
        "schema": "early-detection-q010-sc003-governance-event/v1",
        "eventId": "Q010-SC003-EVT-00000002",
        "sequence": 2,
        "eventType": "SUBCHUNK_WORK_STARTED",
        "previousEventSha256": decision_event["eventSha256"],
        "createdAt": finalization["workStartedAtUtc"],
        "contractSelfSha256": contract["contractSelfSha256"],
        "payload": {
            "subchunkId": "Q010-SC-003-DMV7-BALANCED-TEL-RAW-CAPTURE",
            "decisionEventId": "Q010-SC003-EVT-00000001",
            "decisionEventSequence": 1,
            "workStarted": True,
            "codingAllowed": False,
            "candidateState": None,
            "controlMatchingAllowed": False,
            "scientificCredit": "NONE",
            "nextQ010SubchunkAuthorized": False,
            "q003SchedulerEligible": False,
            "earlyDetectionSystemBuilt": False,
            "decisionCommit": binding["decisionCommit"],
            "decisionParentBlobs": copy.deepcopy(binding["decisionParentBlobs"]),
            "decisionRemoteRef": binding["decisionRemoteRef"],
            "decisionRemoteObservedAtUtc": finalization["decisionRemoteObservedAtUtc"],
            "decisionRemoteReceiptSha256": finalization["decisionRemoteReceiptSha256"],
            "decisionFrozenPolicyProjectionSha256": binding["decisionFrozenPolicyProjectionSha256"],
            "workStartedAtUtc": finalization["workStartedAtUtc"],
        },
        "eventSha256": None,
    }
    event["eventSha256"] = event_self_sha256(event)
    return event


def tag919_event_prefix() -> tuple[bytes, list[dict]]:
    raw = run_git_bytes(["show", f"{TAG919}:{EVENTS_PATH.relative_to(ROOT).as_posix()}"])
    require(sha256_bytes(raw) == TAG919_EVENT_PREFIX_SHA256, "Tag919 event prefix drift")
    rows = [json.loads(line) for line in raw.decode("utf-8").splitlines() if line]
    require(len(rows) == 2 and rows[-1]["eventSha256"] == TAG919_EVENT_HEAD_SHA256, "Tag919 event head drift")
    return raw, rows


def public_projection_self_sha256(projection: dict) -> str:
    body = copy.deepcopy(projection)
    body["projectionSelfSha256"] = None
    return canonical_sha(body)


def expected_completion_event(contract: dict, start_event: dict) -> dict:
    finalization = contract["completionFinalization"]
    aggregate = finalization["publicAggregateProjection"]
    event = {
        "schema": "early-detection-q010-sc003-governance-event/v1",
        "eventId": "Q010-SC003-EVT-00000003",
        "sequence": 3,
        "eventType": "SUBCHUNK_WORK_COMPLETED",
        "previousEventSha256": start_event["eventSha256"],
        "createdAt": finalization["completionRecordedAtUtc"],
        "contractSelfSha256": contract["contractSelfSha256"],
        "payload": {
            "subchunkId": contract["decision"]["subchunkId"],
            "startEventId": start_event["eventId"],
            "startEventSequence": start_event["sequence"],
            "startCommit": TAG919,
            "workCompleted": True,
            "completionStatus": "HOLD",
            "privateCompletionStatus": finalization["completionStatus"],
            "parentPrivateTag920FinalBindingSha256": finalization["privateTag920BindingSha256"],
            "publicAggregateProjection": copy.deepcopy(aggregate),
            "publicAggregateProjectionSha256": aggregate["projectionSelfSha256"],
            "researchSourceAccessAuthorized": False,
            "runtimeResearchSourceAccessAuthorized": False,
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
            "earlyDetectionSystemBuilt": False,
            "privateContentPublished": False,
        },
        "eventSha256": None,
    }
    event["eventSha256"] = event_self_sha256(event)
    return event


def expected_events(contract: dict) -> list[dict]:
    _, prefix = tag919_event_prefix()
    return [*prefix, expected_completion_event(contract, prefix[-1])]


def expected_projection(contract: dict, events: list[dict]) -> dict:
    event = events[0]
    start_event = events[1]
    completion_event = events[2]
    aggregate = contract["completionFinalization"]["publicAggregateProjection"]
    return {
        "schema": "early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-projection/v1",
        "subchunkId": contract["decision"]["subchunkId"],
        "workClass": "CORE_SOURCE_CORPUS_CAPTURE",
        "decisionRecorded": True,
        "decisionEventId": event["eventId"],
        "decisionEventSequence": event["sequence"],
        "decisionTimingStatus": "REMOTE_INTRODUCED_BEFORE_SEPARATE_START_EVENT",
        "decisionRemoteIntroductionVerified": True,
        "separateRemoteStartRequired": False,
        "startEventId": start_event["eventId"],
        "startEventSequence": start_event["sequence"],
        "startRemoteIntroductionVerified": True,
        "workStarted": True,
        "workStartedAtUtc": start_event["createdAt"],
        "completionEventId": completion_event["eventId"],
        "completionEventSequence": completion_event["sequence"],
        "workCompleted": True,
        "completionStatus": "HOLD",
        "privateCompletionStatus": contract["completionFinalization"]["completionStatus"],
        "completionRemoteIntroductionVerified": False,
        "publicAggregateProjection": copy.deepcopy(aggregate),
        "publicAggregateProjectionSha256": aggregate["projectionSelfSha256"],
        "publicConclusion": aggregate["publicConclusion"],
        "acceptedPrimaryPayloadCount": 0,
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
    require(start["preDecisionContractTopLevelKeysExact"] == PRE_TOP_LEVEL_KEYS and start["postStartContractTopLevelKeysExact"] == START_TOP_LEVEL_KEYS, "start top-level schema drift")
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
    require(not imports.intersection({"requests", "httpx", "aiohttp", "socket"}), "unbounded network import present")
    require("http.client" in imports, "bound HTTP implementation missing")
    attrs = [node for node in ast.walk(tree) if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id == "subprocess"]
    require(all(node.attr in {"TimeoutExpired", "run"} for node in attrs), "subprocess surface drift")
    require(not any(isinstance(node, ast.ImportFrom) and node.module == "subprocess" for node in ast.walk(tree)), "subprocess alias import forbidden")


def validate_start_binding(contract: dict, check_files: bool) -> None:
    binding = contract["startIntroductionBinding"]
    finalization = contract["startFinalization"]
    require(list(binding) == contract["startTransitionContract"]["requiredStartIntroductionBindingExactFields"], "start introduction key surface drift")
    require(list(finalization) == contract["startTransitionContract"]["requiredStartFinalizationExactFields"], "start finalization key surface drift")
    require(binding["schema"] == "early-detection-q010-sc003-start-introduction-binding/v1", "start binding schema drift")
    require(binding["decisionCommit"] == TAG918 and binding["decisionParentBlobs"] == TAG918_BLOBS, "Tag918 parent binding drift")
    require(binding["decisionRemoteRef"] == contract["repository"]["remoteRef"], "start remote ref drift")
    require(binding["decisionFrozenPolicyProjectionSha256"] == EXPECTED_POLICY_PROJECTION_SHA256, "start frozen policy hash drift")
    require(canonical_sha(binding["decisionParentBlobs"]) == "337ea7f86e006cb69a9b92cf5fc02c25415ace1487df23dd31506f0491ab10e7", "Tag918 blob bundle drift")
    receipt = binding["decisionRemoteReceipt"]
    require(list(receipt) == contract["startTransitionContract"]["requiredDecisionRemoteReceiptExactFields"], "decision remote receipt key surface drift")
    body = copy.deepcopy(receipt)
    claim = body["receiptSha256"]
    body["receiptSha256"] = None
    require(canonical_sha(body) == claim == finalization["decisionRemoteReceiptSha256"], "decision remote receipt self hash drift")
    require(receipt["observedHead"] == receipt["observedUpstream"] == receipt["observedRemoteOid"] == TAG918, "decision remote receipt OID drift")
    require(receipt["observedRemoteRef"] == binding["decisionRemoteRef"] and receipt["externallySigned"] is False, "decision remote receipt truth drift")
    require(receipt["decisionParentBlobBindingsSha256"] == canonical_sha(TAG918_BLOBS), "decision parent receipt binding drift")
    expected_remote_raw = f'{TAG918}\t{binding["decisionRemoteRef"]}\n'.encode("utf-8")
    require(receipt["gitLsRemoteRawSha256"] == sha256_bytes(expected_remote_raw), "decision ls-remote receipt drift")
    require(receipt["observedAtUtc"] == finalization["decisionRemoteObservedAtUtc"] == START_REMOTE_OBSERVED_AT, "decision remote observation time drift")
    require(finalization == {
        "schema": "early-detection-q010-sc003-start-finalization/v1",
        "decisionRemoteObservedAtUtc": START_REMOTE_OBSERVED_AT,
        "decisionRemoteReceiptSha256": claim,
        "workStartedAtUtc": WORK_STARTED_AT,
        "privateStoreAbsentAtWorkStart": True,
        "storedResearchSourceAccessAuthorized": False,
        "runtimeResearchSourceAccessRequiresTag919PostGate": True,
    }, "start finalization drift")
    commit_time = datetime.fromisoformat(run_git(["show", "-s", "--format=%cI", TAG918])) if check_files else datetime.fromisoformat("2026-08-14T01:32:21+00:00")
    observed_time = datetime.fromisoformat(START_REMOTE_OBSERVED_AT.replace("Z", "+00:00"))
    started_time = datetime.fromisoformat(WORK_STARTED_AT.replace("Z", "+00:00"))
    require(commit_time <= observed_time < started_time, "start causal time order drift")
    if check_files:
        require(run_git(["show", "-s", "--format=%P", TAG918]) == TAG918_PARENT, "Tag918 parent drift")
        require(run_git(["show", "-s", "--format=%s", TAG918]) == TAG918_SUBJECT, "Tag918 subject drift")
        for blob in TAG918_BLOBS:
            require(run_git(["rev-parse", f'{TAG918}:{blob["path"]}']) == blob["gitBlobSha1"], "Tag918 blob id drift")
            require(sha256_bytes(run_git_bytes(["show", f'{TAG918}:{blob["path"]}'])) == blob["rawSha256"], "Tag918 raw blob drift")
        parent_contract = json.loads(run_git_bytes(["show", f'{TAG918}:{CONTRACT_PATH.relative_to(ROOT).as_posix()}']).decode("utf-8"))
        require({key: contract[key] for key in POLICY_KEYS} == {key: parent_contract[key] for key in POLICY_KEYS}, "Tag918 frozen policy mutation")


def tag919_runtime_contract(contract: dict) -> dict:
    raw = run_git_bytes(["show", f"{TAG919}:{CONTRACT_PATH.relative_to(ROOT).as_posix()}"])
    expected_raw = next(blob["rawSha256"] for blob in TAG919_BLOBS if blob["path"] == CONTRACT_PATH.relative_to(ROOT).as_posix())
    require(sha256_bytes(raw) == expected_raw, "Tag919 runtime contract raw drift")
    runtime_contract = json.loads(raw.decode("utf-8"))
    require(list(runtime_contract) == START_TOP_LEVEL_KEYS, "Tag919 runtime contract key surface drift")
    require({key: runtime_contract[key] for key in POLICY_KEYS} == {key: contract[key] for key in POLICY_KEYS}, "Tag919 runtime policy differs from completion contract")
    require(runtime_contract["contractSelfSha256"] == "ffbc59e57c0e85be1866572cfdcffeaa59cb8c38b4225aa805653119d1e1dbdb", "Tag919 runtime contract self drift")
    return runtime_contract


def validate_strict_private_completion_replay(runtime_contract: dict, finalization: dict, materials: dict, stored_state: dict, stored_binding_raw: bytes, stored_binding: dict) -> tuple[dict, dict]:
    replay_state, issues, pending = replay_private_ledger(runtime_contract, TAG919, materials)
    validated_state = validate_run_state_against_replay(runtime_contract, TAG919, stored_state, replay_state, issues, pending)
    require(validated_state["completed"] and validated_state["completionStatus"] == "TYPED_GLOBAL_HOLD_COMPLETED", "private strict replay is not completed HOLD")
    recomputed_binding = completion_binding(runtime_contract, validated_state, materials)
    expected_binding_raw = json.dumps(recomputed_binding, ensure_ascii=False, indent=2, sort_keys=True).encode("utf-8") + b"\n"
    require(stored_binding == recomputed_binding, "stored Tag920 binding object differs from strict replay")
    require(stored_binding_raw == expected_binding_raw, "stored Tag920 binding bytes differ from strict replay")
    require(sha256_bytes(stored_binding_raw) == finalization["privateTag920JsonRawSha256"], "stored Tag920 binding raw hash differs from public finalization")
    require(recomputed_binding["bindingSha256"] == finalization["privateTag920BindingSha256"], "recomputed Tag920 binding differs from public finalization")
    return validated_state, recomputed_binding


def derive_public_completion_aggregate_from_private(contract: dict, finalization: dict) -> dict:
    runtime_contract = tag919_runtime_contract(contract)
    binding_path = PRIVATE_STORE_ROOT / "tag920-completion-binding-v1.json"
    require(binding_path.is_file(), "private Tag920 completion binding missing")
    materials = read_private_materials(runtime_contract, TAG919)
    stored_state = load_run_state(runtime_contract, TAG919)
    binding_raw = binding_path.read_bytes()
    stored_binding = json.loads(binding_raw.decode("utf-8"))
    state, binding = validate_strict_private_completion_replay(runtime_contract, finalization, materials, stored_state, binding_raw, stored_binding)
    rows = materials["rows"]
    ledger_raw = materials["ledgerRaw"]
    require(rows[-1]["eventSha256"] == finalization["privateLedgerEventHeadSha256"], "private completion ledger head drift")
    require(rows[-1]["eventType"] == "RUN_COMPLETED", "private completion ledger does not end in RUN_COMPLETED")
    require(parse_utc(rows[-1]["createdAtUtc"]) <= parse_utc(finalization["completionRecordedAtUtc"]), "public completion event predates private RUN_COMPLETED")
    state_claim = state["runStateSelfSha256"]
    binding_claim = binding["bindingSha256"]
    material = binding["materialJoinBinding"]
    hist = Counter(row["eventType"] for row in rows)
    cross = Counter((row["eventType"], row.get("payload", {}).get("singleReason")) for row in rows if row.get("payload", {}).get("singleReason") is not None)
    units = list(state["units"].values())
    unit_reasons = Counter(unit["holdReason"] for unit in units if unit["holdReason"] is not None)
    units_with_accepted = sum(1 for unit in units if unit["acceptedPayloads"] > 0)
    projection = {
        "schema": "early-detection-q010-sc003-public-completion-aggregate-projection/v1",
        "parentPrivateTag920FinalBindingSha256": binding_claim,
        "privateTag920JsonRawSha256": sha256_bytes(binding_raw),
        "privateLedger": {"rawSha256": sha256_bytes(ledger_raw), "eventCount": len(rows), "eventHeadSha256": rows[-1]["eventSha256"]},
        "privateRunState": {
            "schema": state["schema"], "selfSha256": state_claim, "completed": state["completed"],
            "completionStatus": state["completionStatus"], "lastDurableEventSequence": state["lastDurableEventSequence"],
            "lastDurableEventSha256": state["lastDurableEventSha256"], "requestsUsed": state["requestsUsed"],
            "acceptedPrimaryPayloads": state["acceptedPayloads"], "incident": state["incident"],
        },
        "materialJoin": {
            "status": material["joinStatus"], "bindingSha256": material["bindingSha256"],
            "receiptCount": binding["receiptCount"], "receiptManifestSha256": binding["receiptManifestSha256"],
            "projectionCount": binding["projectionCount"], "projectionManifestSha256": binding["projectionManifestSha256"],
            "projectionHeadSha256": binding["projectionHeadSha256"], "uniquePhysicalRawBlobCount": binding["rawBlobCount"],
            "rawBlobManifestSha256": binding["rawBlobManifestSha256"], "rawByteCount": binding["rawByteCount"],
            "responseBlobReferenceCount": material["responseBlobReferenceMultiset"]["count"],
            "responseBlobReferenceUniqueCount": material["responseBlobReferenceMultiset"]["uniqueCount"],
            "nullRequiredResponseCount": material["responseBlobReferenceIntegrity"]["nullRequiredQueryIds"]["count"],
            "responseBlobReferenceIntegrityStatus": "EXACT" if material["responseBlobReferenceIntegrity"]["exact"] else "MISMATCH",
        },
        "terminalization": {
            "frozenCaptureUnitCount": len(units), "terminalUnitCount": sum(1 for unit in units if unit["terminal"]),
            "terminalSlotCount": len(state["terminalSlotIds"]), "terminalSlotUniqueCount": len(set(state["terminalSlotIds"])),
            "unitsWithAcceptedPrimaryPayloadCount": units_with_accepted,
            "allFifteenUnitsTerminal": all(unit["terminal"] for unit in units),
            "allFortyFiveSlotsTerminal": len(state["terminalSlotIds"]) == len(set(state["terminalSlotIds"])) == 45,
            "unitTerminalReasonHistogram": [
                {"singleReason": reason, "count": unit_reasons[reason]} for reason in (
                    "HOLD_CDX_COMPLETENESS_UNPROVEN", "HOLD_NO_COMPLETE_SELECTED_CDX_ROW_FOR_DERIVED_SLOT"
                )
            ],
        },
        "eventHistogram": [{"eventType": kind, "count": hist[kind]} for kind in (
            "QUERY_PREPARED", "QUERY_RESPONSE_SEALED", "DERIVED_SLOT_TYPED_HOLD", "GLOBAL_INCIDENT", "RUN_COMPLETED"
        )],
        "eventTypeReasonCrossTable": [
            {"eventType": kind, "singleReason": reason, "count": cross[(kind, reason)]} for kind, reason in (
                ("QUERY_RESPONSE_SEALED", "HOLD_CDX_COMPLETENESS_UNPROVEN"),
                ("QUERY_RESPONSE_SEALED", "TYPED_ERROR_TIMEOUTERROR"),
                ("DERIVED_SLOT_TYPED_HOLD", "HOLD_CDX_COMPLETENESS_UNPROVEN"),
                ("DERIVED_SLOT_TYPED_HOLD", "HOLD_NO_COMPLETE_SELECTED_CDX_ROW_FOR_DERIVED_SLOT"),
            )
        ],
        "networkAccounting": {
            "networkRequestCount": state["requestsUsed"], "queryResponseCount": hist["QUERY_RESPONSE_SEALED"],
            "derivedNullNetworkTerminalizationCount": hist["DERIVED_SLOT_TYPED_HOLD"],
            "acceptedPrimaryPayloadCount": state["acceptedPayloads"],
            "storedLocatorResponseReferenceCount": material["responseBlobReferenceMultiset"]["count"],
            "uniquePhysicalLocatorBlobCount": material["responseBlobReferenceMultiset"]["uniqueCount"],
            "nullRequiredResponseCount": material["responseBlobReferenceIntegrity"]["nullRequiredQueryIds"]["count"],
        },
        "completionMetrics": {
            "allFortyFiveSlotsTerminal": rows[-1]["payload"]["allFortyFiveSlotsTerminal"],
            "allFifteenUnitsTerminal": rows[-1]["payload"]["allFifteenUnitsTerminal"],
            "everyUnitAtLeastOneNewPayload": rows[-1]["payload"]["everyUnitAtLeastOneNewPayload"],
            "perRowEDifferenceFromLAtMostOne": rows[-1]["payload"]["perRowEDifferenceFromLAtMostOne"],
            "incidentFree": rows[-1]["payload"]["incidentFree"],
        },
        "completionStatus": "HOLD",
        "publicConclusion": "full frozen census capture matrix terminal / no accepted payload under frozen routes",
        "semanticLocks": {
            "storedBlobsAreOperativeLocatorResponsesOnly": True,
            "storedBlobCountsAreNotAcceptedPrimarySourceCounts": True,
            "derivedNullNetworkTerminalizationsAreNotNegativeEvidence": True,
            "noEvidenceTelAbsenceClaim": True,
        },
        "projectionSelfSha256": None,
    }
    projection["projectionSelfSha256"] = public_projection_self_sha256(projection)
    return projection


def validate_completion_binding(contract: dict, check_files: bool) -> None:
    transition = contract["completionTransitionContract"]
    intro = contract["completionIntroductionBinding"]
    finalization = contract["completionFinalization"]
    require(transition["requiredCompletionSubject"] == TAG920_SUBJECT, "Tag920 subject drift")
    require(transition["tag920MustBeExactFiveModifyDirectChildOfLiveRemoteTag919"] is True, "Tag920 topology relaxed")
    require(transition["tag920MustBindAllFiveTag919ParentGitBlobSha1AndRawSha256Values"] is True, "Tag919 blob binding relaxed")
    require(transition["tag919EventPrefixMustRemainByteExact"] is True, "Tag919 event prefix relaxed")
    require(transition["tag919ContractTopLevelKeysExact"] == START_TOP_LEVEL_KEYS and transition["postCompletionContractTopLevelKeysExact"] == POST_TOP_LEVEL_KEYS, "completion contract key surface drift")
    require(transition["allowedTag920ContractMutationJsonPointers"] == [
        "/contractSelfSha256", "/implementation/controllerNormalizedSha256", "/implementation/testRawSha256",
        "/completionTransitionContract", "/completionIntroductionBinding", "/completionFinalization",
    ], "Tag920 allowed mutation surface drift")
    require(transition["frozenTag919ContractKeysMustRemainCanonicallyEquivalent"] == [
        "schema", "createdAt", "purpose", "repository", "parentTag917Binding", "parentTag914CorpusBinding",
        "decision", "populationPolicy", "capturePlan", "sourcePolicy", "queryProtocol", "startTransitionContract",
        "controlAndCodingPolicy", "completionPolicy", "carriedIncidents", "frozenPolicyProjectionSha256",
        "outputs", "startIntroductionBinding", "startFinalization",
    ], "Tag919 frozen key surface drift")
    require(transition["requiredCompletionEvent"] == {
        "schema": "early-detection-q010-sc003-governance-event/v1", "eventId": "Q010-SC003-EVT-00000003",
        "sequence": 3, "eventType": "SUBCHUNK_WORK_COMPLETED",
        "previousEventMustEqualCommittedTag919EventHead": True, "createdAtMustEqualCompletionRecordedAtUtc": True,
        "createdAtMustNotExceedTag920CommitTime": True,
    }, "completion event transition drift")
    require(transition["postCompletionRuntimePolicy"] == {
        "researchSourceAccessAuthorized": False, "runCommandAuthorized": False, "sourceCommandAuthorized": False,
        "startCommandAuthorized": False, "nextQ010SubchunkAuthorized": False, "q003SchedulerEligible": False,
        "candidateState": None, "scientificCredit": "NONE",
    }, "post-completion runtime policy drift")
    require(intro == {
        "schema": "early-detection-q010-sc003-completion-introduction-binding/v1",
        "startCommit": TAG919, "startParentBlobs": TAG919_BLOBS,
        "startParentBlobBindingsSha256": canonical_sha(TAG919_BLOBS),
        "startRemoteRef": contract["repository"]["remoteRef"],
        "startRemoteObservedAtUtc": "2026-08-14T03:58:58.630311Z",
    }, "Tag919 completion parent binding drift")
    require(list(finalization) == [
        "schema", "completionRecordedAtUtc", "completionStatus", "workCompleted", "allFifteenUnitsTerminal",
        "allFortyFiveSlotsTerminal", "everyUnitAtLeastOneNewPayload", "unitsWithAcceptedPayloadCount",
        "acceptedPayloads", "networkRequestCount", "derivedNullNetworkTerminalizationCount",
        "eventTypeReasonCrossTable", "privateLedgerEventCount", "privateLedgerRawSha256",
        "privateLedgerEventHeadSha256", "privateTag920JsonRawSha256", "privateTag920BindingSha256",
        "preCompletionEventBindingSha256", "runStateSelfSha256", "materialJoinStatus",
        "materialJoinBindingSha256", "receiptCount", "receiptManifestSha256", "projectionCount",
        "projectionManifestSha256", "projectionHeadSha256", "rawBlobCount", "rawBlobManifestSha256",
        "rawByteCount", "publicAggregateProjection", "idempotentSecondRun", "researchSourceAccessAuthorized",
        "sourceRecordCount", "dimensionLevel", "candidateState", "scientificCredit",
        "nextQ010SubchunkAuthorized", "q003SchedulerEligible", "earlyDetectionSystemBuilt", "privateContentPublished",
    ], "completion finalization exact key surface drift")
    require(finalization["schema"] == "early-detection-q010-sc003-completion-finalization/v1" and finalization["completionRecordedAtUtc"] == "2026-08-14T03:58:59.630311Z", "completion schema/time drift")
    require(finalization["completionStatus"] == "TYPED_GLOBAL_HOLD_COMPLETED" and finalization["workCompleted"] is True, "completion outcome drift")
    require(finalization["allFifteenUnitsTerminal"] is True and finalization["allFortyFiveSlotsTerminal"] is True, "terminal matrix drift")
    require(finalization["everyUnitAtLeastOneNewPayload"] is False and finalization["acceptedPayloads"] == finalization["unitsWithAcceptedPayloadCount"] == 0, "accepted payload drift")
    require(finalization["networkRequestCount"] == 15 and finalization["derivedNullNetworkTerminalizationCount"] == 30, "completion request accounting drift")
    require((finalization["privateLedgerEventCount"], finalization["receiptCount"], finalization["projectionCount"], finalization["rawBlobCount"], finalization["rawByteCount"]) == (61, 15, 12, 7, 473787), "completion private aggregate count drift")
    require((
        finalization["privateLedgerRawSha256"], finalization["privateLedgerEventHeadSha256"],
        finalization["privateTag920JsonRawSha256"], finalization["privateTag920BindingSha256"],
        finalization["preCompletionEventBindingSha256"], finalization["runStateSelfSha256"],
        finalization["materialJoinBindingSha256"], finalization["receiptManifestSha256"],
        finalization["projectionManifestSha256"], finalization["projectionHeadSha256"],
        finalization["rawBlobManifestSha256"],
    ) == (
        "086e6236e1e4acc24f7e3eaaf2c7ae5b1d3f28fcf901e8d48fd2e6919bb8c813",
        "888b1b7db897029ee6fbccc702ce360f310dd2c5d166b7ad09848d2358e08074",
        "c73c14fbb9a974350d450e3c64f926d4f06c055c9c1649a250e3418a21342bae",
        "c9f223cf64146b473555e8b7618e4bc6dd840bc0c8781592869c4057bcb518a4",
        "38847effee7b2338c7e8614a769b4b7c4c14b17f0b3e99e1ee7fee9a9145096d",
        "fe6f93b670da9f1e57bec111d6c9fff57e0261f63299638e12a31fe61ad0e29e",
        "0146729bbafb758fadd080a27a46d38a1628211bc02c53fa165ce4db1e322dc8",
        "d916700751309250744322644554d394a967981b0b534e4a849757fadcaeaa50",
        "1bd53eec4c508536ef7692289660a296e46e261b62cfdce2911a09b96e971d4e",
        "245d49859e3ade6cecd40dd0ae293cbbdca8c31b41079f54e100cd91d062885b",
        "b46da4417a8509f69b3558f9557e2f1dc9ecedc01ac28fc049e866ac54ca33fd",
    ), "completion private hash binding drift")
    require(finalization["eventTypeReasonCrossTable"] == finalization["publicAggregateProjection"]["eventTypeReasonCrossTable"], "completion reason projection drift")
    require(finalization["materialJoinStatus"] == "EXACT" and finalization["privateTag920BindingSha256"] == finalization["publicAggregateProjection"]["parentPrivateTag920FinalBindingSha256"], "completion join/binding drift")
    aggregate = finalization["publicAggregateProjection"]
    require(list(aggregate) == [
        "schema", "parentPrivateTag920FinalBindingSha256", "privateTag920JsonRawSha256", "privateLedger",
        "privateRunState", "materialJoin", "terminalization", "eventHistogram", "eventTypeReasonCrossTable",
        "networkAccounting", "completionMetrics", "completionStatus", "publicConclusion", "semanticLocks",
        "projectionSelfSha256",
    ], "public aggregate exact key surface drift")
    require(public_projection_self_sha256(aggregate) == aggregate["projectionSelfSha256"], "public aggregate self hash drift")
    require(aggregate["completionStatus"] == "HOLD" and aggregate["completionMetrics"] == {
        "allFortyFiveSlotsTerminal": True, "allFifteenUnitsTerminal": True,
        "everyUnitAtLeastOneNewPayload": False, "perRowEDifferenceFromLAtMostOne": True, "incidentFree": True,
    }, "public completion metrics drift")
    require(aggregate["networkAccounting"]["acceptedPrimaryPayloadCount"] == 0 and aggregate["terminalization"]["unitsWithAcceptedPrimaryPayloadCount"] == 0, "public accepted-primary count drift")
    require(aggregate["eventHistogram"] == [
        {"eventType": "QUERY_PREPARED", "count": 15}, {"eventType": "QUERY_RESPONSE_SEALED", "count": 15},
        {"eventType": "DERIVED_SLOT_TYPED_HOLD", "count": 30}, {"eventType": "GLOBAL_INCIDENT", "count": 0},
        {"eventType": "RUN_COMPLETED", "count": 1},
    ], "public event histogram drift")
    require(aggregate["terminalization"]["terminalSlotCount"] == aggregate["terminalization"]["terminalSlotUniqueCount"] == 45 and aggregate["terminalization"]["terminalUnitCount"] == 15, "public terminal uniqueness drift")
    require(finalization["idempotentSecondRun"] == {
        "ledgerEventCountUnchanged": True, "ledgerRawSha256Unchanged": True, "ledgerHeadSha256Unchanged": True,
        "privateTag920BindingSha256Unchanged": True, "ownedFileCountUnchanged": True,
        "requestCountUnchanged": True, "additionalRequests": 0,
    }, "idempotent completion receipt drift")
    require(all(aggregate["semanticLocks"].values()), "public semantic lock drift")
    require(finalization["researchSourceAccessAuthorized"] is False and finalization["sourceRecordCount"] == 0 and finalization["dimensionLevel"] is None and finalization["candidateState"] is None and finalization["scientificCredit"] == "NONE", "completion science lock drift")
    require(finalization["nextQ010SubchunkAuthorized"] is False and finalization["q003SchedulerEligible"] is False and finalization["earlyDetectionSystemBuilt"] is False and finalization["privateContentPublished"] is False, "completion downstream lock drift")
    if check_files:
        require(run_git(["show", "-s", "--format=%P", TAG919]) == TAG918, "Tag919 parent drift")
        require(run_git(["show", "-s", "--format=%s", TAG919]) == TAG919_SUBJECT, "Tag919 subject drift")
        for blob in TAG919_BLOBS:
            require(run_git(["rev-parse", f'{TAG919}:{blob["path"]}']) == blob["gitBlobSha1"], "Tag919 blob id drift")
            require(sha256_bytes(run_git_bytes(["show", f'{TAG919}:{blob["path"]}'])) == blob["rawSha256"], "Tag919 raw blob drift")
        parent_contract = json.loads(run_git_bytes(["show", f'{TAG919}:{CONTRACT_PATH.relative_to(ROOT).as_posix()}']).decode("utf-8"))
        require(list(parent_contract) == START_TOP_LEVEL_KEYS, "Tag919 parent contract key surface drift")
        for key in START_TOP_LEVEL_KEYS:
            if key not in {"contractSelfSha256", "implementation"}:
                require(contract[key] == parent_contract[key], "frozen Tag919 contract drift: " + key)
        require({k: contract["implementation"][k] for k in contract["implementation"] if k not in {"controllerNormalizedSha256", "testRawSha256"}} == {k: parent_contract["implementation"][k] for k in parent_contract["implementation"] if k not in {"controllerNormalizedSha256", "testRawSha256"}}, "Tag919 implementation policy drift")
        require(derive_public_completion_aggregate_from_private(contract, finalization) == aggregate, "public aggregate is not exact strict private runtime replay")


def validate_bundle(contract: dict, events: list[dict], state: dict, check_files: bool = True, allow_private_store: bool = False) -> None:
    require(list(contract) == POST_TOP_LEVEL_KEYS, "POST contract top-level key surface drift")
    require(contract["purpose"] == PURPOSE, "contract purpose drift")
    require(contract["outputs"] == {"eventsPath": "state/early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-events-v1.jsonl", "statePath": "state/early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-state-v1.json"}, "outputs surface drift")
    require(contract["implementation"] == {"controllerPath": "scripts/early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-v1.py", "controllerNormalizedSha256": EXPECTED_CONTROLLER_NORMALIZED_SHA256, "testPath": "tests/early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-v1.test.js", "testRawSha256": EXPECTED_TEST_RAW_SHA256, "controllerChildExecutionsRequired": 0, "sourceAccessImplementationPresentAtDecision": False, "networkImportsForbiddenAtDecision": True}, "implementation surface drift")
    require(contract["schema"] == "early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-governance-contract/v1", "contract schema drift")
    require(contract_self_sha256(contract) == contract["contractSelfSha256"], "contract self hash drift")
    require(policy_projection_sha256(contract) == contract["frozenPolicyProjectionSha256"] == EXPECTED_POLICY_PROJECTION_SHA256, "frozen policy projection drift")
    validate_repository(contract)
    validate_parent_bindings(contract, check_files)
    validate_policy(contract)
    validate_start_binding(contract, check_files)
    validate_completion_binding(contract, check_files)
    expected = expected_events(contract)
    require(len(events) == 3 and events == expected, "completion event/replay drift")
    require(events[0]["eventSha256"] == EXPECTED_DECISION_EVENT_SHA256, "controller-bound decision event head drift")
    require(events[1]["previousEventSha256"] == EXPECTED_DECISION_EVENT_SHA256 and events[1]["createdAt"] == WORK_STARTED_AT, "start event causal binding drift")
    require(events[2]["previousEventSha256"] == TAG919_EVENT_HEAD_SHA256 and events[2]["createdAt"] == contract["completionFinalization"]["completionRecordedAtUtc"], "completion event causal binding drift")
    require(state == expected_state(contract, events), "event-to-state replay drift")
    if check_files:
        prefix, _ = tag919_event_prefix()
        require(EVENTS_PATH.read_bytes().startswith(prefix) and sha256_bytes(prefix) == TAG919_EVENT_PREFIX_SHA256, "Tag919 Event1+Event2 byte-prefix drift")
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


def classify_completion_snapshot(head: str, remote: str, parent: str, subject: str, changes: list[tuple[str, str]], dirty: bool, owned_paths: list[str]) -> str:
    exact_changes = sorted(changes) == sorted(("M", path) for path in owned_paths)
    if head == remote == TAG919 and parent == TAG918 and subject == TAG919_SUBJECT and exact_changes:
        return "COMPLETION_PRE_INTRODUCTION"
    if head == remote and head != TAG919 and parent == TAG919 and subject == TAG920_SUBJECT and exact_changes and not dirty:
        return "COMPLETION_POST_INTRODUCTION"
    fail("completion topology/path snapshot is not an authorized PRE or POST phase")


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
    paths = repo["ownedPaths"]
    require(run_git(["show", "-s", "--format=%P", TAG919]) == TAG918, "Tag919 parent drift")
    require(run_git(["show", "-s", "--format=%s", TAG919]) == TAG919_SUBJECT, "Tag919 subject drift")
    if head == TAG919 and remote == TAG919:
        delta = run_git(["diff", "--name-status", TAG919]).splitlines()
        changes = [tuple(line.split("\t", 1)) for line in delta if line]
        phase = classify_completion_snapshot(head, remote, TAG918, TAG919_SUBJECT, changes, False, paths)
        return phase, None, observed_at
    require(head == remote, "HEAD/live remote mismatch")
    require(run_git(["show", "-s", "--format=%P", "HEAD"]) == TAG919, "completion introduction parent drift")
    require(run_git(["show", "-s", "--format=%s", "HEAD"]) == TAG920_SUBJECT, "completion introduction subject drift")
    commit_time = run_git(["show", "-s", "--format=%cI", "HEAD"])
    require(datetime.fromisoformat(commit_time).timestamp() >= datetime.fromisoformat(contract["completionFinalization"]["completionRecordedAtUtc"].replace("Z", "+00:00")).timestamp(), "Tag920 commit predates completion event")
    require(datetime.fromisoformat(observed_at.replace("Z", "+00:00")).timestamp() >= datetime.fromisoformat(commit_time).timestamp(), "remote observation predates commit")
    delta = run_git(["diff-tree", "--no-commit-id", "--name-status", "-r", "HEAD"]).splitlines()
    changes = [tuple(line.split("\t", 1)) for line in delta if line]
    dirty = bool(run_git(["status", "--porcelain", "--", *paths]))
    phase = classify_completion_snapshot(head, remote, TAG919, TAG920_SUBJECT, changes, dirty, paths)
    for path in paths:
        require(run_git(["hash-object", "--no-filters", path]) == run_git(["rev-parse", f"HEAD:{path}"]), "introduced completion blob differs: " + path)
    return phase, head, observed_at


def verify(remote: bool, private_store_allowed: bool = False) -> dict:
    require(remote, "--remote is mandatory")
    contract, events, state = read_contract(), read_events(), read_state()
    validate_bundle(contract, events, state, check_files=True, allow_private_store=private_store_allowed)
    phase, commit, observed = remote_phase(contract)
    post = phase == "COMPLETION_POST_INTRODUCTION"
    aggregate = contract["completionFinalization"]["publicAggregateProjection"]
    return {
        "schema": "early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-verification/v2",
        "status": "PASS" if post else "COMPLETION_PRE_INTRODUCTION_DIAGNOSTIC",
        "phase": phase,
        "introductionCommit": commit,
        "remoteObservedAtUtc": observed,
        "subchunkId": contract["decision"]["subchunkId"],
        "workClass": contract["decision"]["workClass"],
        "populationCount": 7,
        "captureUnitCount": 15,
        "targetDimensions": ["T", "E", "L"],
        "decisionRecorded": True,
        "decisionRemoteIntroductionVerified": True,
        "startRemoteIntroductionVerified": True,
        "workStarted": True,
        "workStartedAtUtc": WORK_STARTED_AT,
        "workCompleted": True,
        "completionStatus": "HOLD",
        "privateCompletionStatus": contract["completionFinalization"]["completionStatus"],
        "completionRemoteIntroductionVerified": post,
        "publicAggregateProjectionSha256": aggregate["projectionSelfSha256"],
        "publicConclusion": aggregate["publicConclusion"],
        "acceptedPrimaryPayloadCount": 0,
        "researchSourceAccessAuthorized": False,
        "runtimeResearchSourceAccessAuthorized": False,
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
    aggregate = derive_public_completion_aggregate_from_private(contract, contract["completionFinalization"])
    contract["completionFinalization"]["publicAggregateProjection"] = aggregate
    contract["completionFinalization"]["eventTypeReasonCrossTable"] = copy.deepcopy(aggregate["eventTypeReasonCrossTable"])
    contract["implementation"]["controllerNormalizedSha256"] = controller_normalized_sha256()
    contract["implementation"]["testRawSha256"] = sha256_path(TEST_PATH)
    contract["contractSelfSha256"] = contract_self_sha256(contract)
    events = expected_events(contract)
    state = expected_state(contract, events)
    contract_raw = json.dumps(contract, ensure_ascii=False, indent=2) + "\n"
    prefix, _ = tag919_event_prefix()
    events_raw = prefix.decode("utf-8") + json.dumps(events[2], ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
    state_raw = json.dumps(state, ensure_ascii=False, indent=2) + "\n"
    result = {
        "contractRawSha256": sha256_bytes(contract_raw.encode("utf-8")),
        "contractSelfSha256": contract["contractSelfSha256"],
        "controllerNormalizedSha256": controller_normalized_sha256(),
        "eventsRawSha256": sha256_bytes(events_raw.encode("utf-8")),
        "eventSha256": events[-1]["eventSha256"],
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
        "completionTransitionSha256": canonical_sha(contract["completionTransitionContract"]),
        "publicAggregateProjectionSha256": aggregate["projectionSelfSha256"],
        "privateCompletionReplaySnapshotSha256": canonical_sha({
            "privateLedgerRawSha256": contract["completionFinalization"]["privateLedgerRawSha256"],
            "runStateSelfSha256": contract["completionFinalization"]["runStateSelfSha256"],
            "privateTag920JsonRawSha256": contract["completionFinalization"]["privateTag920JsonRawSha256"],
            "privateTag920BindingSha256": contract["completionFinalization"]["privateTag920BindingSha256"],
            "receiptManifestSha256": contract["completionFinalization"]["receiptManifestSha256"],
            "projectionManifestSha256": contract["completionFinalization"]["projectionManifestSha256"],
            "rawBlobManifestSha256": contract["completionFinalization"]["rawBlobManifestSha256"],
        }),
    }
    if write:
        CONTRACT_PATH.write_text(contract_raw, encoding="utf-8", newline="\n")
        EVENTS_PATH.write_text(events_raw, encoding="utf-8", newline="\n")
        STATE_PATH.write_text(state_raw, encoding="utf-8", newline="\n")
    return result


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def parse_utc(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def fsync_directory(path: Path) -> None:
    require(path.is_dir(), "durability directory missing: " + str(path))
    if os.name == "nt":
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        create_file = kernel32.CreateFileW
        create_file.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
        create_file.restype = wintypes.HANDLE
        flush_file_buffers = kernel32.FlushFileBuffers
        flush_file_buffers.argtypes = [wintypes.HANDLE]
        flush_file_buffers.restype = wintypes.BOOL
        close_handle = kernel32.CloseHandle
        close_handle.argtypes = [wintypes.HANDLE]
        close_handle.restype = wintypes.BOOL
        ctypes.set_last_error(0)
        handle = create_file(
            str(path), GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            None, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, None,
        )
        if handle == INVALID_HANDLE_VALUE:
            fail(f"HOLD_WIN32_DIRECTORY_OPEN_FAILED_{ctypes.get_last_error()}")
        try:
            ctypes.set_last_error(0)
            if not flush_file_buffers(handle):
                fail(f"HOLD_WIN32_DIRECTORY_FLUSH_FAILED_{ctypes.get_last_error()}")
        finally:
            require(bool(close_handle(handle)), "HOLD_WIN32_DIRECTORY_HANDLE_CLOSE_FAILED")
        return
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def durable_replace(temporary: Path, target: Path) -> None:
    require(temporary.parent == target.parent, "durable replace must remain within one directory")
    if os.name == "nt":
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        move_file_ex = kernel32.MoveFileExW
        move_file_ex.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD]
        move_file_ex.restype = wintypes.BOOL
        ctypes.set_last_error(0)
        if not move_file_ex(str(temporary), str(target), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH):
            fail(f"HOLD_WIN32_WRITE_THROUGH_REPLACE_FAILED_{ctypes.get_last_error()}")
    else:
        os.replace(temporary, target)
    fsync_directory(target.parent)


def durability_preflight(directory_flush=None) -> None:
    require(os.name == "nt", "HOLD_RUNTIME_REQUIRES_CHECKED_WINDOWS_DURABILITY")
    (directory_flush or fsync_directory)(PRIVATE_STORE_ROOT.parent)


def durable_mkdir(path: Path) -> None:
    if path.exists():
        require(path.is_dir(), "durable directory path is not a directory: " + str(path))
        return
    durable_mkdir(path.parent)
    path.mkdir()
    fsync_directory(path)
    fsync_directory(path.parent)


@contextmanager
def exclusive_runtime_mutex():
    require(os.name == "nt", "HOLD_RUNTIME_REQUIRES_WINDOWS_NAMED_MUTEX")
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    create_mutex = kernel32.CreateMutexW
    create_mutex.argtypes = [ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR]
    create_mutex.restype = wintypes.HANDLE
    release_mutex = kernel32.ReleaseMutex
    release_mutex.argtypes = [wintypes.HANDLE]
    release_mutex.restype = wintypes.BOOL
    close_handle = kernel32.CloseHandle
    close_handle.argtypes = [wintypes.HANDLE]
    close_handle.restype = wintypes.BOOL
    ctypes.set_last_error(0)
    handle = create_mutex(None, True, RUNTIME_MUTEX_NAME)
    error = ctypes.get_last_error()
    require(bool(handle), f"HOLD_WIN32_NAMED_MUTEX_CREATE_FAILED_{error}")
    if error == ERROR_ALREADY_EXISTS:
        close_handle(handle)
        fail("HOLD_CONCURRENT_RUNTIME_MUTEX_ALREADY_EXISTS_BEFORE_PRIVATE_STORE_OR_SOURCE")
    try:
        yield
    finally:
        released = bool(release_mutex(handle))
        closed = bool(close_handle(handle))
        require(released and closed, "HOLD_WIN32_NAMED_MUTEX_RELEASE_FAILED")


def append_fsync(path: Path, raw: bytes) -> None:
    durable_mkdir(path.parent)
    with path.open("ab", buffering=0) as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    fsync_directory(path.parent)


def atomic_json(path: Path, value: dict) -> None:
    durable_mkdir(path.parent)
    temporary = path.with_name(path.name + ".tmp")
    raw = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True).encode("utf-8") + b"\n"
    with temporary.open("wb") as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    durable_replace(temporary, path)


def private_event(event_type: str, payload: dict, sequence: int, previous: str | None, created_at: str | None = None) -> dict:
    event = {
        "schema": "early-detection-q010-sc003-private-query-audit-event/v1",
        "eventType": event_type,
        "eventId": f"Q010-SC003-PRIVATE-EVT-{sequence:08d}",
        "sequence": sequence,
        "previousEventSha256": previous,
        "createdAtUtc": created_at or utc_now(),
        "payload": payload,
        "eventSha256": None,
    }
    event["eventSha256"] = event_self_sha256(event)
    return event


def read_private_ledger(path: Path) -> tuple[list[dict], bytes]:
    if not path.exists():
        return [], b""
    raw = path.read_bytes()
    require(not raw or raw.endswith(b"\n"), "HOLD_PRIVATE_LEDGER_TRUNCATED_NO_FINAL_NEWLINE")
    lines = raw.splitlines(keepends=True)
    require(all(line != b"\n" for line in lines), "HOLD_PRIVATE_LEDGER_BLANK_LINE")
    try:
        rows = [json.loads(line[:-1].decode("utf-8", errors="strict")) for line in lines]
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        fail("HOLD_PRIVATE_LEDGER_PARSE_FAILED_" + type(exc).__name__.upper())
    previous = None
    for index, row in enumerate(rows, 1):
        require(set(row) == {"schema", "eventType", "eventId", "sequence", "previousEventSha256", "createdAtUtc", "payload", "eventSha256"}, "HOLD_PRIVATE_LEDGER_COMMON_SCHEMA_DRIFT")
        require(row["schema"] == "early-detection-q010-sc003-private-query-audit-event/v1", "HOLD_PRIVATE_LEDGER_SCHEMA_DRIFT")
        require(row["eventType"] in {"QUERY_PREPARED", "QUERY_RESPONSE_SEALED", "DERIVED_SLOT_TYPED_HOLD", "GLOBAL_INCIDENT", "RUN_COMPLETED"}, "HOLD_PRIVATE_LEDGER_EVENT_TYPE_DRIFT")
        require(row["eventId"] == f"Q010-SC003-PRIVATE-EVT-{index:08d}", "HOLD_PRIVATE_LEDGER_EVENT_ID_DRIFT")
        require(row["sequence"] == index and row["previousEventSha256"] == previous, "private ledger chain drift")
        require(row["eventSha256"] == event_self_sha256(row), "private ledger event hash drift")
        require(lines[index - 1] == canonical(row) + b"\n", "HOLD_PRIVATE_LEDGER_NONCANONICAL_BYTES")
        parse_utc(row["createdAtUtc"])
        previous = row["eventSha256"]
    return rows, raw


def append_private_event(path: Path, event_type: str, payload: dict, created_at: str | None = None) -> dict:
    rows, _ = read_private_ledger(path)
    event = private_event(event_type, payload, len(rows) + 1, rows[-1]["eventSha256"] if rows else None, created_at)
    append_fsync(path, canonical(event) + b"\n")
    return event


def budget_snapshot(state: dict) -> dict:
    return {
        "slotsTerminal": len(state["terminalSlotIds"]),
        "requestsUsed": state["requestsUsed"],
        "responseBytes": state["responseBytes"],
        "acceptedPayloads": state["acceptedPayloads"],
        "requestHardCap": 45,
        "privateRawBytesHardCap": 900000000,
        "acceptedPayloadHardCap": 30,
    }


def request_headers() -> list[tuple[str, str]]:
    headers = list(REQUEST_HEADERS)
    require(headers == [
        ("Host", "web.archive.org"),
        ("Accept", "*/*"),
        ("Accept-Encoding", "identity"),
        ("User-Agent", "GrowthScreener-Q010-SC003-RawCapture/1.0"),
    ], "frozen request headers drift")
    require(not {key.casefold() for key, _ in headers}.intersection(FORBIDDEN_REQUEST_HEADERS), "cookie/auth header forbidden")
    return headers


def rfc3986(value: str) -> str:
    return quote(value, safe="-._~", encoding="utf-8", errors="strict")


def materialize_locator_uri(slot: dict) -> str:
    pattern = rfc3986(slot["originalUrlPattern"])
    return (
        "https://web.archive.org/cdx/search/cdx?url=" + pattern
        + "&from=2014&to=2020&output=json&fl=timestamp%2Coriginal%2Cstatuscode%2Cmimetype%2Cdigest"
        + "&filter=statuscode%3A200&collapse=digest&limit=500&showResumeKey=true"
    )


def materialize_capture_uri(selected: dict) -> str:
    return f'https://web.archive.org/web/{selected["timestamp"]}id_/{selected["original"]}'


def request_fingerprints(method: str, uri: str) -> tuple[str, str, str]:
    headers = request_headers()
    canonical_request = {"method": method, "uri": uri, "headers": headers, "bodySha256": sha256_bytes(b"")}
    split = urlsplit(uri)
    target = split.path + (("?" + split.query) if split.query else "")
    wire = (method + " " + target + " HTTP/1.1\r\n" + "".join(f"{k}: {v}\r\n" for k, v in headers) + "\r\n").encode("ascii")
    return canonical_sha(headers), canonical_sha(canonical_request), sha256_bytes(wire)


def normalized_locator_text(value: str) -> str:
    decoded = unquote(value, encoding="utf-8", errors="strict")
    folded = unicodedata.normalize("NFKC", decoded).casefold()
    return " ".join("".join(character if character.isalnum() else " " for character in folded).split())


def parse_cdx_complete(raw: bytes, slot: dict) -> dict:
    try:
        text = raw.decode("utf-8", errors="strict")
        decoder = json.JSONDecoder()
        value, end = decoder.raw_decode(text)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        return {"completenessProven": False, "singleReason": "HOLD_CDX_MALFORMED_FULL_BYTES", "error": type(exc).__name__, "selected": []}
    remainder = text[end:]
    unparsed = bool(remainder.strip())
    if not isinstance(value, list) or not value or value[0] != ["timestamp", "original", "statuscode", "mimetype", "digest"]:
        return {"completenessProven": False, "singleReason": "HOLD_CDX_EXACT_HEADER_MISSING", "selected": []}
    rows = value[1:]
    malformed = any(not isinstance(row, list) or len(row) != 5 or not all(isinstance(cell, str) for cell in row) for row in rows)
    invalid_status = any(isinstance(row, list) and len(row) == 5 and all(isinstance(cell, str) for cell in row) and row[2] != "200" for row in rows)
    resume_present = unparsed
    complete = len(rows) < 500 and not resume_present and not unparsed and not malformed and not invalid_status
    projection = {
        "returnedRowCount": len(rows),
        "resumeKeyPresent": resume_present,
        "paginationTrailerParseStatus": "EXACT_NO_TRAILER" if not unparsed else "MALFORMED_OR_RESUME_TRAILER",
        "completenessProven": complete,
        "selected": [],
    }
    if not complete:
        projection["singleReason"] = "HOLD_CDX_RETURNED_STATUSCODE_NOT_EXACT_200" if invalid_status else "HOLD_CDX_COMPLETENESS_UNPROVEN"
        return projection
    candidates = []
    for timestamp, original, statuscode, mimetype, digest in rows:
        if not re.fullmatch(r"\d{14}", timestamp) or not "20140101000000" <= timestamp <= "20201231235959":
            continue
        parsed = urlsplit(original if "://" in original else "http://" + original)
        if (parsed.hostname or "").casefold() != slot["originalHost"].casefold():
            continue
        try:
            normalized = normalized_locator_text(original)
        except (UnicodeDecodeError, ValueError):
            continue
        if not all(normalized_locator_text(term) in normalized for term in slot["termExpression"]):
            continue
        token = slot["rowTokenExpression"]
        if token is not None and normalized_locator_text(token) not in normalized:
            continue
        candidates.append({"timestamp": timestamp, "original": original, "statuscode": statuscode, "mimetype": mimetype, "digest": digest})
    candidates.sort(key=lambda row: (row["timestamp"], row["original"], row["digest"]))
    selected, seen = [], set()
    for row in candidates:
        key = row["digest"].casefold()
        if key not in seen:
            selected.append(row)
            seen.add(key)
        if len(selected) == 2:
            break
    projection["selected"] = selected
    projection["singleReason"] = "LOCATOR_COMPLETE_TAKE2" if selected else "NULL_RESULT_NO_ABSENCE_INFERENCE"
    return projection


def exact_entity_digest_matches(raw: bytes, expected: str) -> bool:
    actual = base64.b32encode(hashlib.sha1(raw).digest()).decode("ascii").rstrip("=")
    return bool(expected) and actual.casefold() == expected.casefold()


def classify_response_headers(headers: list[tuple[str, str]]) -> tuple[str | None, str | None]:
    encodings = [value.strip().casefold() for key, value in headers if key.casefold() == "content-encoding"]
    content_types = [value.split(";", 1)[0].strip().casefold() for key, value in headers if key.casefold() == "content-type"]
    reason = None
    if len(encodings) > 1:
        reason = "HOLD_DUPLICATE_CONTENT_ENCODING_HEADERS"
    elif len(encodings) == 1 and encodings[0] not in {"", "identity"}:
        reason = "HOLD_UNEXPECTED_CONTENT_ENCODING"
    elif len(content_types) == 0:
        reason = "HOLD_CONTENT_TYPE_HEADER_MISSING"
    elif len(content_types) > 1:
        reason = "HOLD_DUPLICATE_CONTENT_TYPE_HEADERS"
    elif content_types[0] not in KNOWN_OPAQUE_MIME_TYPES:
        reason = "HOLD_UNKNOWN_MIME_TYPE"
    mime = content_types[0] if len(content_types) == 1 and content_types[0] in KNOWN_OPAQUE_MIME_TYPES else None
    return mime, reason


def sealed_response_header_projection(status_or_error: int | str, mime_type: str, reason: str, redirect_chain: list) -> dict:
    if reason == "HOLD_DUPLICATE_CONTENT_ENCODING_HEADERS":
        encoding_class = "INVALID_DUPLICATE"
    elif reason == "HOLD_UNEXPECTED_CONTENT_ENCODING":
        encoding_class = "INVALID_VALUE"
    else:
        encoding_class = "ABSENT_OR_IDENTITY"
    if reason == "HOLD_DUPLICATE_CONTENT_TYPE_HEADERS":
        content_type_class = "INVALID_DUPLICATE"
    elif reason == "HOLD_CONTENT_TYPE_HEADER_MISSING":
        content_type_class = "MISSING"
    elif reason == "HOLD_UNKNOWN_MIME_TYPE" or mime_type == "UNKNOWN":
        content_type_class = "INVALID_OR_NOT_UNIQUE"
    else:
        content_type_class = "EXACT_ONE_ALLOWLISTED"
    projection = {
        "httpStatusOrTypedError": status_or_error,
        "normalizedMimeType": mime_type,
        "contentEncodingClass": encoding_class,
        "contentTypeClass": content_type_class,
        "redirectDisposition": "NONE" if redirect_chain == [] else "HOLD_REDIRECT_CHAIN_FORBIDDEN",
    }
    return projection


def response_header_projection(status: int, headers: list[tuple[str, str]]) -> dict:
    mime, reason = classify_response_headers(headers)
    return sealed_response_header_projection(status, mime or "UNKNOWN", reason or "HEADER_VALID", [])


def normalized_response_mime(headers: list[tuple[str, str]]) -> str | None:
    return classify_response_headers(headers)[0]


def parse_locator_http_response(status: int, raw: bytes, slot: dict, header_hold_reason: str | None) -> dict:
    if type(status) is not int or status != 200:
        return {"returnedRowCount": 0, "resumeKeyPresent": False, "paginationTrailerParseStatus": "EXACT_NO_TRAILER", "completenessProven": False, "selected": [], "singleReason": "HOLD_LOCATOR_HTTP_STATUS_NOT_EXACT_200"}
    if header_hold_reason is not None:
        return {"returnedRowCount": 0, "resumeKeyPresent": False, "paginationTrailerParseStatus": "EXACT_NO_TRAILER", "completenessProven": False, "selected": [], "singleReason": header_hold_reason}
    return parse_cdx_complete(raw, slot)


def http_get_exact(uri: str, byte_cap: int, connect_timeout: int, response_timeout: int) -> tuple[int, list[tuple[str, str]], bytes]:
    split = urlsplit(uri)
    require(split.scheme == "https" and split.hostname == "web.archive.org" and split.port is None, "request URI authority drift")
    target = split.path + (("?" + split.query) if split.query else "")
    connection = http.client.HTTPSConnection("web.archive.org", 443, timeout=connect_timeout, context=ssl.create_default_context())
    try:
        connection.putrequest("GET", target, skip_host=True, skip_accept_encoding=True)
        for key, value in request_headers():
            connection.putheader(key, value)
        connection.endheaders()
        if connection.sock is not None:
            connection.sock.settimeout(response_timeout)
        response = connection.getresponse()
        headers = response.getheaders()
        raw = response.read(byte_cap + 1)
        require(len(raw) <= byte_cap, "HOLD_RESPONSE_BYTE_CAP_EXCEEDED")
        return response.status, headers, raw
    finally:
        connection.close()


def owned_blob_bindings_at(commit: str, paths: list[str]) -> list[dict]:
    return [
        {
            "path": path,
            "gitBlobSha1": run_git(["rev-parse", f"{commit}:{path}"]),
            "rawSha256": sha256_bytes(run_git_bytes(["show", f"{commit}:{path}"])),
        }
        for path in paths
    ]


def pre_query_remote_receipt(contract: dict, query_id: str, tag919: str) -> dict:
    paths = contract["repository"]["ownedPaths"]
    require(run_git(["rev-parse", "HEAD"]) == run_git(["rev-parse", "@{u}"]) == tag919, "pre-query head/upstream drift")
    remote_raw = run_git_bytes(["ls-remote", "origin", contract["repository"]["remoteRef"]])
    fields = remote_raw.decode("utf-8").strip().split()
    require(len(fields) == 2 and fields[0] == tag919 and fields[1] == contract["repository"]["remoteRef"], "pre-query live remote drift")
    require(not run_git(["status", "--porcelain", "--", *paths]), "pre-query owned paths dirty")
    bindings = owned_blob_bindings_at(tag919, paths)
    receipt = {
        "schema": "early-detection-q010-sc003-pre-query-remote-receipt/v1",
        "queryId": query_id,
        "observedHead": tag919,
        "observedUpstream": tag919,
        "observedRemoteRef": contract["repository"]["remoteRef"],
        "observedRemoteOid": tag919,
        "gitLsRemoteRawSha256": sha256_bytes(remote_raw),
        "ownedPathBlobBindingsSha256": canonical_sha(bindings),
        "ownedPathsClean": True,
        "observedAtUtc": utc_now(),
        "externallySigned": False,
        "receiptSha256": None,
    }
    receipt["receiptSha256"] = canonical_sha(receipt)
    return receipt


RUN_STATE_KEYS = {
    "schema", "runId", "runtimeBinding", "lastResponseQueryId", "lastResponseEventSequence",
    "lastResponseEventSha256", "lastResponseLedgerRawSha256", "lastResponseSealPreparedAtUtc",
    "lastResponseLedgerFsyncConfirmedAtUtc", "lastDurableEventSequence", "lastDurableEventSha256",
    "lastDurableLedgerRawSha256", "lastDurableEventCreatedAtUtc",
    "lastDurableLedgerFsyncConfirmedAtUtc", "budgetAfter", "nextSlotOrdinal", "terminalSlotIds",
    "requestsUsed", "responseBytes", "acceptedPayloads", "selectedByUnit", "units",
    "seenPayloadSha256", "incident", "completed", "completionStatus", "runStateSelfSha256",
}
PROJECTION_RECORD_KEYS = {
    "schema", "sequence", "previousProjectionRecordSha256", "queryId", "slotId",
    "responseEventSequence", "responseEventSha256", "projectionSchema", "projection",
    "projectionSha256", "projectionRecordSha256",
}
DERIVED_HOLD_KEYS = {"slotId", "unitId", "singleReason", "networkRequestMade", "scientificCredit"}
GLOBAL_INCIDENT_KEYS = {"singleReason", "reconstructionForbidden", "sourceRequestsAfterIncident"}
RUN_COMPLETED_KEYS = {
    "completionStatus", "allFortyFiveSlotsTerminal", "allFifteenUnitsTerminal",
    "everyUnitAtLeastOneNewPayload", "perRowEDifferenceFromLAtMostOne", "incidentFree",
    "preCompletionEventBinding", "researchSourceAccessAuthorized", "scientificCredit",
    "nextQ010SubchunkAuthorized",
}


class RuntimeIncident(GateError):
    def __init__(self, reason: str, replay_state: dict, disposition: str = "INCIDENT") -> None:
        super().__init__(reason)
        self.reason = reason
        self.replay_state = replay_state
        self.disposition = disposition


def runtime_binding(contract: dict, tag919: str) -> dict:
    paths = contract["repository"]["ownedPaths"]
    blobs = owned_blob_bindings_at(tag919, paths)
    binding = {
        "schema": "early-detection-q010-sc003-private-runtime-binding/v1",
        "tag919Commit": tag919,
        "ownedPathBlobs": blobs,
        "ownedPathBlobBindingsSha256": canonical_sha(blobs),
        "contractRawSha256": next(blob["rawSha256"] for blob in TAG919_BLOBS if blob["path"] == CONTRACT_PATH.relative_to(ROOT).as_posix()) if tag919 == TAG919 else sha256_path(CONTRACT_PATH),
        "contractSelfSha256": contract["contractSelfSha256"],
        "frozenPolicyProjectionSha256": contract["frozenPolicyProjectionSha256"],
        "slotScheduleSha256": contract["capturePlan"]["slotScheduleSha256"],
        "controllerNormalizedSha256": contract["implementation"]["controllerNormalizedSha256"] if tag919 == TAG919 else controller_normalized_sha256(),
        "bindingSha256": None,
    }
    binding["bindingSha256"] = canonical_sha(binding)
    return binding


def initial_run_state(contract: dict, tag919: str) -> dict:
    units = {unit["unitId"]: {"acceptedPayloads": 0, "terminal": False, "holdReason": None, "startedAtUtc": None} for unit in contract["capturePlan"]["units"]}
    state = {
        "schema": "early-detection-q010-sc003-private-run-state/v1",
        "runId": "Q010-SC003-RUN-0001",
        "runtimeBinding": runtime_binding(contract, tag919),
        "lastResponseQueryId": None,
        "lastResponseEventSequence": 0,
        "lastResponseEventSha256": None,
        "lastResponseLedgerRawSha256": sha256_bytes(b""),
        "lastResponseSealPreparedAtUtc": None,
        "lastResponseLedgerFsyncConfirmedAtUtc": None,
        "lastDurableEventSequence": 0,
        "lastDurableEventSha256": None,
        "lastDurableLedgerRawSha256": sha256_bytes(b""),
        "lastDurableEventCreatedAtUtc": None,
        "lastDurableLedgerFsyncConfirmedAtUtc": None,
        "budgetAfter": {"slotsTerminal": 0, "requestsUsed": 0, "responseBytes": 0, "acceptedPayloads": 0, "requestHardCap": 45, "privateRawBytesHardCap": 900000000, "acceptedPayloadHardCap": 30},
        "nextSlotOrdinal": 1,
        "terminalSlotIds": [],
        "requestsUsed": 0,
        "responseBytes": 0,
        "acceptedPayloads": 0,
        "selectedByUnit": {},
        "units": units,
        "seenPayloadSha256": [],
        "incident": None,
        "completed": False,
        "completionStatus": None,
        "runStateSelfSha256": None,
    }
    require(set(state) == RUN_STATE_KEYS, "private run-state constructor schema drift")
    state["runStateSelfSha256"] = canonical_sha(state)
    return state


def seal_run_state(path: Path, state: dict) -> None:
    require(set(state) == RUN_STATE_KEYS, "private run-state exact schema drift")
    state["budgetAfter"] = budget_snapshot(state)
    state["runStateSelfSha256"] = None
    state["runStateSelfSha256"] = canonical_sha(state)
    atomic_json(path, state)


def load_run_state(contract: dict, tag919: str) -> dict:
    path = Path(contract["queryProtocol"]["privateRunStatePath"])
    require(path.exists(), "HOLD_PRIVATE_RUN_STATE_MISSING_FROM_NONEMPTY_STORE")
    state = json.loads(path.read_text(encoding="utf-8"))
    require(set(state) == RUN_STATE_KEYS, "HOLD_PRIVATE_RUN_STATE_EXACT_SCHEMA_DRIFT")
    claim = state["runStateSelfSha256"]
    state["runStateSelfSha256"] = None
    require(canonical_sha(state) == claim, "private run-state self hash drift")
    state["runStateSelfSha256"] = claim
    require(state["runtimeBinding"] == runtime_binding(contract, tag919), "HOLD_PRIVATE_RUN_STATE_RUNTIME_BINDING_DRIFT")
    return state


def read_projection_manifest(contract: dict) -> tuple[list[dict], bytes]:
    path = Path(contract["queryProtocol"]["privateProjectionManifestPath"])
    if not path.exists():
        return [], b""
    raw = path.read_bytes()
    require(not raw or raw.endswith(b"\n"), "HOLD_PROJECTION_MANIFEST_TRUNCATED")
    lines = raw.splitlines(keepends=True)
    rows: list[dict] = []
    previous = None
    for sequence, line in enumerate(lines, 1):
        require(line != b"\n", "HOLD_PROJECTION_MANIFEST_BLANK_LINE")
        try:
            row = json.loads(line[:-1].decode("utf-8", errors="strict"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            fail("HOLD_PROJECTION_MANIFEST_PARSE_FAILED_" + type(exc).__name__.upper())
        require(set(row) == PROJECTION_RECORD_KEYS, "HOLD_PROJECTION_RECORD_EXACT_SCHEMA_DRIFT")
        require(row["schema"] == "early-detection-q010-sc003-safe-projection-record/v1", "HOLD_PROJECTION_RECORD_SCHEMA_DRIFT")
        require(row["sequence"] == sequence and row["previousProjectionRecordSha256"] == previous, "HOLD_PROJECTION_RECORD_CHAIN_DRIFT")
        claim = row["projectionRecordSha256"]
        body = copy.deepcopy(row)
        body["projectionRecordSha256"] = None
        require(canonical_sha(body) == claim, "HOLD_PROJECTION_RECORD_SELF_HASH_DRIFT")
        require(row["projectionSha256"] == canonical_sha(row["projection"]), "HOLD_PROJECTION_CONTENT_HASH_DRIFT")
        allowed = set(next(parser for parser in contract["sourcePolicy"]["safeProjectionParsers"] if parser["parserId"] == row["projectionSchema"])["allowedOutputFields"])
        require(set(row["projection"]) == allowed, "HOLD_PROJECTION_EXACT_OUTPUT_KEY_SET_DRIFT")
        require(line == canonical(row) + b"\n", "HOLD_PROJECTION_MANIFEST_NONCANONICAL_BYTES")
        rows.append(row)
        previous = claim
    return rows, raw


def append_projection(contract: dict, query_id: str, slot: dict, response_event: dict, projection: dict) -> dict:
    allowed = set(next(parser for parser in contract["sourcePolicy"]["safeProjectionParsers"] if parser["parserId"] == slot["parserProjectionId"])["allowedOutputFields"])
    content = projection
    require(set(content) == allowed, "safe projection exact output-key set drift")
    rows, _ = read_projection_manifest(contract)
    record = {
        "schema": "early-detection-q010-sc003-safe-projection-record/v1",
        "sequence": len(rows) + 1,
        "previousProjectionRecordSha256": rows[-1]["projectionRecordSha256"] if rows else None,
        "queryId": query_id,
        "slotId": slot["slotId"],
        "responseEventSequence": response_event["sequence"],
        "responseEventSha256": response_event["eventSha256"],
        "projectionSchema": slot["parserProjectionId"],
        "projection": content,
        "projectionSha256": canonical_sha(content),
        "projectionRecordSha256": None,
    }
    record["projectionRecordSha256"] = canonical_sha(record)
    append_fsync(Path(contract["queryProtocol"]["privateProjectionManifestPath"]), canonical(record) + b"\n")
    return record


def inspect_private_store_layout(contract: dict) -> None:
    if not PRIVATE_STORE_ROOT.exists():
        return
    require(PRIVATE_STORE_ROOT.is_dir(), "HOLD_PRIVATE_STORE_ROOT_NOT_DIRECTORY")
    qp = contract["queryProtocol"]
    allowed_files = {
        Path(qp["privateLiveAuditLedgerPath"]).name,
        Path(qp["privateRunStatePath"]).name,
        Path(qp["privateProjectionManifestPath"]).name,
        "tag920-completion-binding-v1.json",
    }
    allowed_directories = {Path(qp["privateRawBlobRoot"]).name, "remote-receipts"}
    for entry in PRIVATE_STORE_ROOT.iterdir():
        if entry.is_file():
            require(entry.name in allowed_files, "HOLD_PRIVATE_STORE_EXTRA_OR_TEMP_FILE_" + entry.name)
        elif entry.is_dir():
            require(entry.name in allowed_directories, "HOLD_PRIVATE_STORE_EXTRA_DIRECTORY_" + entry.name)
        else:
            fail("HOLD_PRIVATE_STORE_NONREGULAR_ENTRY_" + entry.name)


def read_receipts(contract: dict, tag919: str, binding: dict) -> tuple[dict[str, dict], list[dict]]:
    root = PRIVATE_STORE_ROOT / "remote-receipts"
    if not root.exists():
        return {}, []
    require(root.is_dir(), "HOLD_RECEIPT_ROOT_NOT_DIRECTORY")
    receipts: dict[str, dict] = {}
    manifest: list[dict] = []
    required = contract["queryProtocol"]["preQueryRemoteReceiptRequiredFields"]
    for path in sorted(root.iterdir(), key=lambda value: value.name):
        require(path.is_file() and re.fullmatch(r"Q010-SC003-QUERY-\d{3}\.json", path.name) is not None, "HOLD_RECEIPT_EXTRA_OR_TEMP_ENTRY_" + path.name)
        raw = path.read_bytes()
        try:
            receipt = json.loads(raw.decode("utf-8", errors="strict"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            fail("HOLD_RECEIPT_PARSE_FAILED_" + type(exc).__name__.upper())
        require(set(receipt) == set(required), "HOLD_RECEIPT_EXACT_SCHEMA_DRIFT")
        query_id = path.stem
        require(receipt["schema"] == contract["queryProtocol"]["preQueryRemoteReceiptSchema"] and receipt["queryId"] == query_id, "HOLD_RECEIPT_ID_OR_SCHEMA_DRIFT")
        body = copy.deepcopy(receipt)
        claim = body["receiptSha256"]
        body["receiptSha256"] = None
        require(canonical_sha(body) == claim, "HOLD_RECEIPT_SELF_HASH_DRIFT")
        require(receipt["observedHead"] == receipt["observedUpstream"] == receipt["observedRemoteOid"] == tag919, "HOLD_RECEIPT_TAG919_BINDING_DRIFT")
        require(receipt["observedRemoteRef"] == contract["repository"]["remoteRef"], "HOLD_RECEIPT_REMOTE_REF_DRIFT")
        expected_remote_raw = f"{tag919}\t{contract['repository']['remoteRef']}\n".encode("utf-8")
        require(receipt["gitLsRemoteRawSha256"] == sha256_bytes(expected_remote_raw), "HOLD_RECEIPT_LS_REMOTE_RAW_HASH_DRIFT")
        require(receipt["ownedPathBlobBindingsSha256"] == binding["ownedPathBlobBindingsSha256"] and receipt["ownedPathsClean"] is True, "HOLD_RECEIPT_OWNED_BLOB_BINDING_DRIFT")
        require(receipt["externallySigned"] is False, "HOLD_RECEIPT_EXTERNAL_SIGNATURE_FALSE_CLAIM_DRIFT")
        parse_utc(receipt["observedAtUtc"])
        require(query_id not in receipts, "HOLD_DUPLICATE_RECEIPT_QUERY_ID")
        receipts[query_id] = receipt
        manifest.append({"queryId": query_id, "receiptRawSha256": sha256_bytes(raw), "receiptSha256": claim})
    return receipts, manifest


def validate_raw_blob_entry(prefix: str, name: str, raw: bytes) -> None:
    require(re.fullmatch(r"[0-9a-f]{2}", prefix) is not None, "HOLD_RAW_BLOB_PREFIX_FORMAT_DRIFT")
    require(re.fullmatch(r"[0-9a-f]{64}", name) is not None, "HOLD_RAW_BLOB_FILENAME_FORMAT_DRIFT")
    require(name.startswith(prefix), "HOLD_RAW_BLOB_PREFIX_MISMATCH")
    require(sha256_bytes(raw) == name, "HOLD_RAW_BLOB_CONTENT_HASH_MISMATCH")


def read_raw_blobs(contract: dict) -> tuple[dict[str, bytes], list[dict]]:
    root = Path(contract["queryProtocol"]["privateRawBlobRoot"])
    if not root.exists():
        return {}, []
    require(root.is_dir(), "HOLD_RAW_BLOB_ROOT_NOT_DIRECTORY")
    blobs: dict[str, bytes] = {}
    manifest: list[dict] = []
    for prefix in sorted(root.iterdir(), key=lambda value: value.name):
        require(prefix.is_dir() and re.fullmatch(r"[0-9a-f]{2}", prefix.name) is not None, "HOLD_RAW_BLOB_PREFIX_OR_EXTRA_ENTRY_" + prefix.name)
        children = sorted(prefix.iterdir(), key=lambda value: value.name)
        require(bool(children), "HOLD_RAW_BLOB_EMPTY_PREFIX_DIRECTORY_" + prefix.name)
        for path in children:
            require(path.is_file() and re.fullmatch(r"[0-9a-f]{64}", path.name) is not None, "HOLD_RAW_BLOB_FILENAME_OR_TEMP_DRIFT_" + path.name)
            raw = path.read_bytes()
            validate_raw_blob_entry(prefix.name, path.name, raw)
            require(path.name not in blobs, "HOLD_RAW_BLOB_DUPLICATE_CONTENT_ADDRESS")
            blobs[path.name] = raw
            manifest.append({"payloadSha256": path.name, "payloadBytes": len(raw)})
    manifest.sort(key=lambda row: row["payloadSha256"])
    return blobs, manifest


def material_summary(projection_rows: list[dict], projection_raw: bytes, receipt_manifest: list[dict], raw_manifest: list[dict]) -> dict:
    return {
        "projectionManifestSha256": sha256_bytes(projection_raw),
        "projectionCount": len(projection_rows),
        "projectionHeadSha256": projection_rows[-1]["projectionRecordSha256"] if projection_rows else None,
        "receiptManifestSha256": canonical_sha(receipt_manifest),
        "receiptCount": len(receipt_manifest),
        "rawBlobManifestSha256": canonical_sha(raw_manifest),
        "rawBlobCount": len(raw_manifest),
        "rawByteCount": sum(row["payloadBytes"] for row in raw_manifest),
    }


def identifier_multiset_commitment(values: list[str]) -> dict:
    require(all(isinstance(value, str) and value for value in values), "HOLD_MATERIAL_JOIN_IDENTIFIER_DOMAIN_DRIFT")
    ordered = sorted(values)
    unique = sorted(set(values))
    return {
        "count": len(ordered),
        "uniqueCount": len(unique),
        "sortedMultisetSha256": canonical_sha(ordered),
        "sortedUniqueSetSha256": canonical_sha(unique),
    }


def material_join_binding(rows: list[dict], materials: dict) -> dict:
    prepared = [row["payload"]["queryId"] for row in rows if row["eventType"] == "QUERY_PREPARED"]
    real_responses = [
        row["payload"]["queryId"] for row in rows
        if row["eventType"] == "QUERY_RESPONSE_SEALED" and type(row["payload"]["httpStatusOrTypedError"]) is int
    ]
    response_rows = [row for row in rows if row["eventType"] == "QUERY_RESPONSE_SEALED"]
    expected_blobs: list[str] = []
    expected_reference_pairs: list[list[str | None]] = []
    observed_reference_pairs: list[list[str | None]] = []
    storeable_query_ids: list[str] = []
    null_required_query_ids: list[str] = []
    missing_reference_query_ids: list[str] = []
    mismatched_reference_query_ids: list[str] = []
    extra_reference_query_ids: list[str] = []
    for row in response_rows:
        payload = row["payload"]
        query_id = payload["queryId"]
        storeable = (
            type(payload["httpStatusOrTypedError"]) is int
            and type(payload["responseBytes"]) is int
            and payload["responseBytes"] > 0
            and payload["singleReason"] not in ENCODING_HOLD_REASONS
        )
        expected_blob_id = payload["responseSha256"] if storeable else None
        observed_blob_id = payload["privateContentAddressedBlobId"]
        expected_reference_pairs.append([query_id, expected_blob_id])
        observed_reference_pairs.append([query_id, observed_blob_id])
        if storeable:
            expected_blobs.append(expected_blob_id)
            storeable_query_ids.append(query_id)
            if observed_blob_id is None:
                missing_reference_query_ids.append(query_id)
            elif observed_blob_id != expected_blob_id:
                mismatched_reference_query_ids.append(query_id)
        else:
            null_required_query_ids.append(query_id)
            if observed_blob_id is not None:
                extra_reference_query_ids.append(query_id)
    observed_receipts = list(materials["receipts"])
    observed_projections = [row["queryId"] for row in materials["projectionRows"]]
    observed_blobs = list(materials["blobs"])

    def join_surface(expected: list[str], observed: list[str]) -> dict:
        expected_set, observed_set = set(expected), set(observed)
        missing, extra = sorted(expected_set - observed_set), sorted(observed_set - expected_set)
        return {
            "expected": identifier_multiset_commitment(expected),
            "observed": identifier_multiset_commitment(observed),
            "missing": identifier_multiset_commitment(missing),
            "extra": identifier_multiset_commitment(extra),
            "exact": not missing and not extra and len(expected) == len(expected_set) and len(observed) == len(observed_set),
        }

    raw_blob_existence_expected = sorted(set(expected_blobs))
    reference_integrity = {
        "schema": "early-detection-q010-sc003-response-blob-reference-integrity/v1",
        "responseCount": len(response_rows),
        "storeableQueryIds": identifier_multiset_commitment(storeable_query_ids),
        "nullRequiredQueryIds": identifier_multiset_commitment(null_required_query_ids),
        "expectedPerQueryReferenceSha256": canonical_sha(sorted(expected_reference_pairs)),
        "observedPerQueryReferenceSha256": canonical_sha(sorted(observed_reference_pairs)),
        "missing": identifier_multiset_commitment(missing_reference_query_ids),
        "mismatch": identifier_multiset_commitment(mismatched_reference_query_ids),
        "extra": identifier_multiset_commitment(extra_reference_query_ids),
        "exact": not missing_reference_query_ids and not mismatched_reference_query_ids and not extra_reference_query_ids,
        "bindingSha256": None,
    }
    reference_integrity["bindingSha256"] = canonical_sha(reference_integrity)
    binding = {
        "schema": "early-detection-q010-sc003-material-join-binding/v3",
        "receiptJoin": join_surface(prepared, observed_receipts),
        "projectionJoin": join_surface(real_responses, observed_projections),
        "responseBlobReferenceMultiset": identifier_multiset_commitment(expected_blobs),
        "responseBlobReferenceIntegrity": reference_integrity,
        "rawBlobJoin": join_surface(raw_blob_existence_expected, observed_blobs),
        "joinStatus": None,
        "bindingSha256": None,
    }
    binding["joinStatus"] = "EXACT" if all(binding[key]["exact"] for key in ("receiptJoin", "projectionJoin", "rawBlobJoin", "responseBlobReferenceIntegrity")) else "INCIDENT_MISMATCH_BOUND"
    binding["bindingSha256"] = canonical_sha(binding)
    return binding


def read_private_materials(contract: dict, tag919: str) -> dict:
    inspect_private_store_layout(contract)
    rows, ledger_raw = read_private_ledger(Path(contract["queryProtocol"]["privateLiveAuditLedgerPath"]))
    projection_rows, projection_raw = read_projection_manifest(contract)
    binding = runtime_binding(contract, tag919)
    receipts, receipt_manifest = read_receipts(contract, tag919, binding)
    blobs, raw_manifest = read_raw_blobs(contract)
    return {
        "rows": rows, "ledgerRaw": ledger_raw, "projectionRows": projection_rows,
        "projectionRaw": projection_raw, "receipts": receipts, "receiptManifest": receipt_manifest,
        "blobs": blobs, "rawManifest": raw_manifest, "runtimeBinding": binding,
        "summary": material_summary(projection_rows, projection_raw, receipt_manifest, raw_manifest),
    }


def cdx_safe_projection(parsed: dict) -> dict:
    selected = parsed.get("selected", [])
    return {
        "timestamp": [row["timestamp"] for row in selected],
        "originalHostExactMatch": [True for _ in selected],
        "normalizedUriTermMatch": [True for _ in selected],
        "normalizedRowTokenMatch": [True for _ in selected],
        "statuscode": [row["statuscode"] for row in selected],
        "mimetype": [row["mimetype"] for row in selected],
        "digest": [row["digest"] for row in selected],
        "returnedRowCount": int(parsed.get("returnedRowCount", 0)),
        "resumeKeyPresent": bool(parsed.get("resumeKeyPresent", False)),
        "paginationTrailerParseStatus": parsed.get("paginationTrailerParseStatus", "MALFORMED_OR_RESUME_TRAILER"),
        "completenessProven": bool(parsed.get("completenessProven", False)),
    }


def completion_metrics(contract: dict, state: dict) -> dict:
    complete_slots = len(state["terminalSlotIds"]) == 45 and len(set(state["terminalSlotIds"])) == 45
    all_units_terminal = all(state["units"][unit["unitId"]]["terminal"] for unit in contract["capturePlan"]["units"])
    every_unit_success = all(state["units"][unit["unitId"]]["acceptedPayloads"] >= 1 for unit in contract["capturePlan"]["units"])
    balanced = True
    for row in contract["populationPolicy"]["rows"]:
        suffix = row["populationRowId"].removeprefix("DMV2015-")
        balanced = balanced and abs(state["units"][f"SC003-E-{suffix}"]["acceptedPayloads"] - state["units"][f"SC003-L-{suffix}"]["acceptedPayloads"]) <= 1
    return {
        "allFortyFiveSlotsTerminal": complete_slots,
        "allFifteenUnitsTerminal": all_units_terminal,
        "everyUnitAtLeastOneNewPayload": every_unit_success,
        "perRowEDifferenceFromLAtMostOne": balanced,
        "incidentFree": state["incident"] is None,
    }


def completion_status(contract: dict, state: dict) -> str:
    metrics = completion_metrics(contract, state)
    success = all(metrics.values())
    return contract["completionPolicy"]["successStatus"] if success else contract["completionPolicy"]["failureStatus"]


def pre_completion_event_binding(contract: dict, state: dict, ledger_raw: bytes, ledger_rows: list[dict], materials: dict) -> dict:
    summary = materials["summary"]
    joins = material_join_binding(ledger_rows, materials)
    status = completion_status(contract, state)
    if status == contract["completionPolicy"]["successStatus"]:
        require(joins["joinStatus"] == "EXACT", "HOLD_SUCCESS_COMPLETION_REQUIRES_EXACT_MATERIAL_JOINS")
    binding = {
        "schema": "early-detection-q010-sc003-pre-completion-event-binding/v2",
        "completionStatus": status,
        "privateLedgerRawSha256": sha256_bytes(ledger_raw),
        "privateLedgerEventCount": len(ledger_rows),
        "privateLedgerEventHeadSha256": ledger_rows[-1]["eventSha256"] if ledger_rows else None,
        "materialJoinBinding": joins,
        **summary,
        "bindingSha256": None,
    }
    binding["bindingSha256"] = canonical_sha(binding)
    return binding


def apply_durable_head(state: dict, event: dict, prefix_raw: bytes) -> None:
    state["lastDurableEventSequence"] = event["sequence"]
    state["lastDurableEventSha256"] = event["eventSha256"]
    state["lastDurableLedgerRawSha256"] = sha256_bytes(prefix_raw)
    state["lastDurableEventCreatedAtUtc"] = event["createdAtUtc"]
    if event["eventType"] == "QUERY_RESPONSE_SEALED":
        payload = event["payload"]
        state["lastResponseQueryId"] = payload["queryId"]
        state["lastResponseEventSequence"] = event["sequence"]
        state["lastResponseEventSha256"] = event["eventSha256"]
        state["lastResponseLedgerRawSha256"] = sha256_bytes(prefix_raw)
        state["lastResponseSealPreparedAtUtc"] = payload["responseSealPreparedAtUtc"]


def next_slot_ordinal(contract: dict, terminal: set[str]) -> int:
    for ordinal, slot in enumerate(contract["capturePlan"]["slotSchedule"], 1):
        if slot["slotId"] not in terminal:
            return ordinal
    return 46


def replay_private_ledger(contract: dict, tag919: str, materials: dict) -> tuple[dict, list[str], dict | None]:
    rows = materials["rows"]
    projection_query_ids = [row["queryId"] for row in materials["projectionRows"]]
    require(len(projection_query_ids) == len(set(projection_query_ids)), "HOLD_DUPLICATE_PROJECTION_QUERY_ID")
    projections = {row["queryId"]: row for row in materials["projectionRows"]}
    receipts = materials["receipts"]
    blobs = materials["blobs"]
    state = initial_run_state(contract, tag919)
    state["runtimeBinding"] = materials["runtimeBinding"]
    schedule = contract["capturePlan"]["slotSchedule"]
    slots_by_id = {slot["slotId"]: slot for slot in schedule}
    used_receipts: set[str] = set()
    used_projections: set[str] = set()
    used_blobs: set[str] = set()
    issues: list[str] = []
    pending: dict | None = None
    prefix_raw = b""
    for event in rows:
        prefix_before = prefix_raw
        prefix_raw += canonical(event) + b"\n"
        payload = event["payload"]
        event_type = event["eventType"]
        if event_type == "QUERY_PREPARED":
            require(set(payload) == set(contract["queryProtocol"]["queryPreparedRequiredFields"]), "HOLD_QUERY_PREPARED_EXACT_SCHEMA_DRIFT")
            require(pending is None and not state["completed"] and state["incident"] is None, "HOLD_QUERY_PREPARED_STATE_MACHINE_DRIFT")
            ordinal = payload["sequence"]
            require(isinstance(ordinal, int) and 1 <= ordinal <= len(schedule), "HOLD_QUERY_PREPARED_SLOT_ORDINAL_DRIFT")
            slot = schedule[ordinal - 1]
            require(payload["queryId"] == f"Q010-SC003-QUERY-{ordinal:03d}" and payload["slotId"] == slot["slotId"], "HOLD_QUERY_PREPARED_QUERY_SLOT_DRIFT")
            require(ordinal == next_slot_ordinal(contract, set(state["terminalSlotIds"])), "HOLD_QUERY_PREPARED_FROZEN_ORDER_DRIFT")
            require(payload["previousEventSha256"] == event["previousEventSha256"], "HOLD_QUERY_PREPARED_PREVIOUS_HEAD_DRIFT")
            for key in ("templateId", "requestAuthorityId", "publisherAuthorityId", "transportId", "requestRole", "sourceClass", "method"):
                expected = "GET" if key == "method" else slot[key]
                require(payload[key] == expected, "HOLD_QUERY_PREPARED_SLOT_FIELD_DRIFT_" + key)
            if slot["attemptOrdinal"] == 1:
                expected_uri = materialize_locator_uri(slot)
            else:
                selected = state["selectedByUnit"].get(slot["unitId"], [])
                rank = slot["derivedTargetRank"] or 0
                require(rank <= len(selected), "HOLD_QUERY_PREPARED_MISSING_DERIVED_RANK")
                expected_uri = materialize_capture_uri(selected[rank - 1])
            require(payload["canonicalUri"] == expected_uri and payload["bodySha256"] == sha256_bytes(b""), "HOLD_QUERY_PREPARED_URI_OR_BODY_DRIFT")
            headers_sha, canonical_request_sha, request_bytes_sha = request_fingerprints("GET", expected_uri)
            require(payload["allowlistedHeadersSha256"] == headers_sha and payload["requestCanonicalSha256"] == canonical_request_sha and payload["requestBytesSha256"] == request_bytes_sha, "HOLD_QUERY_PREPARED_REQUEST_FINGERPRINT_DRIFT")
            require(payload["budgetBefore"] == budget_snapshot(state), "HOLD_QUERY_PREPARED_BUDGET_BEFORE_DRIFT")
            receipt = receipts.get(payload["queryId"])
            if receipt is None:
                issues.append("HOLD_REQUEST_RECEIPT_MISSING")
            else:
                used_receipts.add(payload["queryId"])
                require(payload["preQueryRemoteReceiptSha256"] == receipt["receiptSha256"] and payload["preQueryRemoteObservedAtUtc"] == receipt["observedAtUtc"], "HOLD_QUERY_PREPARED_RECEIPT_REFERENCE_DRIFT")
                require(payload["preQueryRemoteHead"] == receipt["observedRemoteOid"] == tag919 and payload["preQueryRemoteRef"] == receipt["observedRemoteRef"], "HOLD_QUERY_PREPARED_REMOTE_BINDING_DRIFT")
                require(parse_utc(receipt["observedAtUtc"]) <= parse_utc(payload["requestPreparedAtUtc"]), "HOLD_RECEIPT_AFTER_QUERY_PREPARED")
            state["requestsUsed"] += 1
            unit = state["units"][slot["unitId"]]
            if unit["startedAtUtc"] is None:
                unit["startedAtUtc"] = payload["requestPreparedAtUtc"]
            pending = {"event": event, "payload": payload, "slot": slot}
        elif event_type == "QUERY_RESPONSE_SEALED":
            require(set(payload) == set(contract["queryProtocol"]["queryResponseRequiredFields"]), "HOLD_QUERY_RESPONSE_EXACT_SCHEMA_DRIFT")
            require(pending is not None, "HOLD_QUERY_RESPONSE_WITHOUT_PREPARED")
            slot = pending["slot"]
            prepared = pending["payload"]
            require(payload["queryId"] == prepared["queryId"] and payload["sequence"] == prepared["sequence"], "HOLD_QUERY_RESPONSE_PREPARED_REFERENCE_DRIFT")
            require(payload["previousEventSha256"] == event["previousEventSha256"], "HOLD_QUERY_RESPONSE_PREVIOUS_HEAD_DRIFT")
            require(payload["projectionSchema"] == slot["parserProjectionId"] and payload["redirectChain"] == [] and payload["forbiddenFieldExposure"] is False, "HOLD_QUERY_RESPONSE_STATIC_FIELD_DRIFT")
            require(parse_utc(prepared["requestPreparedAtUtc"]) <= parse_utc(payload["requestStartedAtUtc"]) <= parse_utc(payload["responseObservedAtUtc"]) <= parse_utc(payload["responseSealPreparedAtUtc"]), "HOLD_QUERY_RESPONSE_CAUSAL_TIME_DRIFT")
            response_bytes = payload["responseBytes"]
            require(isinstance(response_bytes, int) and 0 <= response_bytes <= contract["capturePlan"]["maxResponseBytesPerRequest"], "HOLD_QUERY_RESPONSE_BYTE_COUNT_DRIFT")
            state["responseBytes"] += response_bytes
            blob_id = payload["privateContentAddressedBlobId"]
            require(payload["singleReason"] not in ENCODING_HOLD_REASONS or blob_id is None, "HOLD_UNSAFE_CONTENT_ENCODING_MUST_NOT_CLAIM_BLOB_ID")
            raw = blobs.get(blob_id) if isinstance(blob_id, str) else None
            if blob_id is not None:
                require(re.fullmatch(r"[0-9a-f]{64}", blob_id) is not None, "HOLD_RESPONSE_BLOB_ID_FORMAT_DRIFT")
                used_blobs.add(blob_id)
                if raw is None:
                    issues.append("HOLD_RESPONSE_REFERENCED_BLOB_MISSING")
                else:
                    require(len(raw) == response_bytes and sha256_bytes(raw) == payload["responseSha256"] == blob_id, "HOLD_RESPONSE_BLOB_HASH_OR_SIZE_DRIFT")
            elif response_bytes and payload["singleReason"] not in ENCODING_HOLD_REASONS:
                issues.append("HOLD_RESPONSE_NONEMPTY_WITHOUT_BLOB_REFERENCE")
            expected_header_projection = sealed_response_header_projection(
                payload["httpStatusOrTypedError"], payload["mimeType"], payload["singleReason"], payload["redirectChain"]
            )
            require(payload["responseHeaderProjectionSha256"] == canonical_sha(expected_header_projection), "HOLD_RESPONSE_HEADER_PROJECTION_NOT_REPLAYABLE_FROM_EVENT")
            is_real_response = type(payload["httpStatusOrTypedError"]) is int
            projection_record = projections.get(payload["queryId"])
            if is_real_response:
                if projection_record is None:
                    issues.append("HOLD_RESPONSE_PROJECTION_MISSING")
                else:
                    used_projections.add(payload["queryId"])
                    require(projection_record["slotId"] == slot["slotId"] and projection_record["responseEventSequence"] == event["sequence"] and projection_record["responseEventSha256"] == event["eventSha256"], "HOLD_PROJECTION_RESPONSE_LOCATOR_DRIFT")
                    require(projection_record["projectionSchema"] == slot["parserProjectionId"] and projection_record["projectionSha256"] == payload["projectionSha256"], "HOLD_PROJECTION_RESPONSE_HASH_OR_SCHEMA_DRIFT")
            else:
                require(projection_record is None and blob_id is None and response_bytes == 0 and payload["responseSha256"] == sha256_bytes(b""), "HOLD_TYPED_ERROR_RESPONSE_MATERIAL_DRIFT")
            projection = projection_record["projection"] if projection_record is not None else {}
            if not is_real_response:
                require(payload["disposition"] == "TYPED_HOLD" and payload["singleReason"] == payload["httpStatusOrTypedError"], "HOLD_TYPED_TRANSPORT_ERROR_DISPOSITION_DRIFT")
                if slot["attemptOrdinal"] == 1:
                    state["selectedByUnit"][slot["unitId"]] = []
            elif slot["attemptOrdinal"] == 1:
                header_hold_reason = payload["singleReason"] if payload["singleReason"] in HEADER_HOLD_REASONS else None
                parsed = parse_locator_http_response(payload["httpStatusOrTypedError"], raw or b"", slot, header_hold_reason)
                expected_projection = cdx_safe_projection(parsed)
                if projection_record is not None:
                    require(projection == expected_projection, "HOLD_LOCATOR_PROJECTION_NOT_EXACT_RAW_REPLAY")
                expected_disposition = "LOCATOR_COMPLETE_SELECTIONS_FROZEN" if parsed.get("completenessProven") else "WHOLE_UNIT_TYPED_HOLD"
                require(payload["singleReason"] == parsed["singleReason"] and payload["disposition"] == expected_disposition, "HOLD_LOCATOR_STATUS_HEADER_OR_DISPOSITION_REPLAY_DRIFT")
                state["selectedByUnit"][slot["unitId"]] = parsed.get("selected", []) if parsed.get("completenessProven") else []
            else:
                selected = state["selectedByUnit"].get(slot["unitId"], [])
                rank = slot["derivedTargetRank"] or 0
                selected_row = selected[rank - 1] if rank <= len(selected) else None
                require(selected_row is not None, "HOLD_OPAQUE_PROJECTION_WITHOUT_SELECTED_ARCHIVE_ROW")
                mime = payload["mimeType"]
                known_mime = mime in KNOWN_OPAQUE_MIME_TYPES
                cdx_match = bool(raw is not None and selected_row is not None and exact_entity_digest_matches(raw, selected_row["digest"]))
                inherited = payload["responseSha256"] in {row["payloadSha256"] for row in contract["sourcePolicy"]["inheritedTag914PayloadManifest"]}
                duplicate_current = payload["responseSha256"] in state["seenPayloadSha256"]
                header_hold_reason = payload["singleReason"] if payload["singleReason"] in HEADER_HOLD_REASONS else None
                accepted = type(payload["httpStatusOrTypedError"]) is int and payload["httpStatusOrTypedError"] == 200 and bool(raw) and blob_id is not None and cdx_match and known_mime and header_hold_reason is None and not inherited and not duplicate_current
                success_disposition = "NEW_OPAQUE_PRIMARY_PUBLISHER_RAW_BYTES_CAPTURED_DIGEST_MATCHED_NO_SOURCE_RECORD_ENTITY_TEL_CANDIDATE_OR_SCIENTIFIC_CREDIT"
                if header_hold_reason is not None:
                    expected_disposition, expected_reason = "QUARANTINED_HOLD", header_hold_reason
                elif accepted:
                    expected_disposition, expected_reason = success_disposition, "RAW_CAPTURE_ACCEPTED_UNCODED_NO_CREDIT"
                elif inherited:
                    expected_disposition, expected_reason = "INHERITED_DUPLICATE_REFERENCE_ONLY", "DUPLICATE_TAG914_NO_SC003_SUCCESS"
                elif duplicate_current:
                    expected_disposition, expected_reason = "SC003_DUPLICATE_REFERENCE_ONLY", "DUPLICATE_SC003_NO_ADDITIONAL_SUCCESS"
                elif not cdx_match:
                    expected_disposition, expected_reason = "QUARANTINED_HOLD", "HOLD_CDX_DIGEST_MISMATCH_EXACT_ENTITY_BYTES"
                else:
                    expected_disposition, expected_reason = "QUARANTINED_HOLD", "HOLD_HTTP_STATUS_EMPTY_OR_UNSUPPORTED_PAYLOAD"
                require(payload["disposition"] == expected_disposition and payload["singleReason"] == expected_reason, "HOLD_ACCEPTANCE_NOT_EXACT_LEDGER_BLOB_PROJECTION_REPLAY")
                if projection_record is not None:
                    require(projection["retrievedAt"] == projection["capturedAt"], "HOLD_OPAQUE_PROJECTION_RETRIEVAL_CAPTURE_TIME_DRIFT")
                    require(parse_utc(payload["requestStartedAtUtc"]) <= parse_utc(projection["capturedAt"]) <= parse_utc(payload["responseObservedAtUtc"]), "HOLD_OPAQUE_PROJECTION_CAPTURE_TIME_OUTSIDE_RESPONSE_WINDOW")
                    expected_opaque_projection = {
                        "httpStatus": payload["httpStatusOrTypedError"],
                        "mimeType": payload["mimeType"],
                        "responseBytes": response_bytes,
                        "responseSha256": payload["responseSha256"],
                        "archiveObservationTimestampExact": selected_row["timestamp"],
                        "retrievedAt": projection["capturedAt"],
                        "capturedAt": projection["capturedAt"],
                        "payloadCaptureDisposition": expected_disposition,
                        "cdxDigestMatchBoolean": cdx_match,
                        "inheritedPayloadDuplicateBoolean": inherited,
                        "futureSourceRecordStatus": "NOT_CREATED_PENDING_SEPARATE_BLIND_DECISION",
                    }
                    require(projection == expected_opaque_projection, "HOLD_OPAQUE_PROJECTION_NOT_EXACT_DETERMINISTIC_REPLAY")
                if accepted and raw is not None:
                    digest = sha256_bytes(raw)
                    state["seenPayloadSha256"].append(digest)
                    state["acceptedPayloads"] += 1
                    state["units"][slot["unitId"]]["acceptedPayloads"] += 1
            require(slot["slotId"] not in state["terminalSlotIds"], "HOLD_RESPONSE_SLOT_ALREADY_TERMINAL")
            state["terminalSlotIds"].append(slot["slotId"])
            unit_slots = [row for row in schedule if row["unitId"] == slot["unitId"]]
            if all(row["slotId"] in state["terminalSlotIds"] for row in unit_slots):
                state["units"][slot["unitId"]]["terminal"] = True
                if state["units"][slot["unitId"]]["acceptedPayloads"] == 0:
                    state["units"][slot["unitId"]]["holdReason"] = "HOLD_NO_NEW_ACCEPTED_OPAQUE_PRIMARY_PAYLOAD"
            state["nextSlotOrdinal"] = next_slot_ordinal(contract, set(state["terminalSlotIds"]))
            state["budgetAfter"] = budget_snapshot(state)
            require(payload["budgetAfter"] == state["budgetAfter"], "HOLD_QUERY_RESPONSE_BUDGET_AFTER_DRIFT")
            apply_durable_head(state, event, prefix_raw)
            pending = None
        elif event_type == "DERIVED_SLOT_TYPED_HOLD":
            require(set(payload) == DERIVED_HOLD_KEYS, "HOLD_DERIVED_SLOT_EVENT_EXACT_SCHEMA_DRIFT")
            require(pending is None and payload["networkRequestMade"] is False and payload["scientificCredit"] == "NONE", "HOLD_DERIVED_SLOT_EVENT_STATE_DRIFT")
            slot = slots_by_id.get(payload["slotId"])
            require(slot is not None and slot["attemptOrdinal"] > 1 and slot["unitId"] == payload["unitId"], "HOLD_DERIVED_SLOT_EVENT_SLOT_DRIFT")
            require(slot["slotId"] not in state["terminalSlotIds"] and schedule.index(slot) + 1 == next_slot_ordinal(contract, set(state["terminalSlotIds"])), "HOLD_DERIVED_SLOT_EVENT_ORDER_DRIFT")
            state["terminalSlotIds"].append(slot["slotId"])
            unit_slots = [row for row in schedule if row["unitId"] == slot["unitId"]]
            if all(row["slotId"] in state["terminalSlotIds"] for row in unit_slots):
                state["units"][slot["unitId"]]["terminal"] = True
                state["units"][slot["unitId"]]["holdReason"] = payload["singleReason"]
            state["nextSlotOrdinal"] = next_slot_ordinal(contract, set(state["terminalSlotIds"]))
            state["budgetAfter"] = budget_snapshot(state)
            apply_durable_head(state, event, prefix_raw)
        elif event_type == "GLOBAL_INCIDENT":
            require(set(payload) == GLOBAL_INCIDENT_KEYS and payload["reconstructionForbidden"] is True and payload["sourceRequestsAfterIncident"] == 0, "HOLD_GLOBAL_INCIDENT_EXACT_SCHEMA_DRIFT")
            require(not state["completed"], "HOLD_GLOBAL_INCIDENT_AFTER_COMPLETION")
            state["incident"] = payload["singleReason"]
            state["terminalSlotIds"] = [slot["slotId"] for slot in schedule]
            for unit in state["units"].values():
                unit["terminal"] = True
                unit["holdReason"] = payload["singleReason"]
            state["nextSlotOrdinal"] = 46
            state["budgetAfter"] = budget_snapshot(state)
            pending = None
            apply_durable_head(state, event, prefix_raw)
        elif event_type == "RUN_COMPLETED":
            require(set(payload) == RUN_COMPLETED_KEYS and pending is None and not state["completed"], "HOLD_RUN_COMPLETED_EXACT_SCHEMA_OR_STATE_DRIFT")
            metrics = completion_metrics(contract, state)
            require(all(payload[key] == value for key, value in metrics.items()), "HOLD_RUN_COMPLETED_METRICS_DRIFT")
            require(payload["completionStatus"] == completion_status(contract, state), "HOLD_RUN_COMPLETED_STATUS_DRIFT")
            expected_pre = pre_completion_event_binding(contract, state, prefix_before, rows[: event["sequence"] - 1], materials)
            require(payload["preCompletionEventBinding"] == expected_pre, "HOLD_PRE_COMPLETION_EVENT_BINDING_DRIFT")
            require(payload["researchSourceAccessAuthorized"] is False and payload["scientificCredit"] == "NONE" and payload["nextQ010SubchunkAuthorized"] is False, "HOLD_RUN_COMPLETED_CLAIM_DRIFT")
            state["completed"] = True
            state["completionStatus"] = payload["completionStatus"]
            apply_durable_head(state, event, prefix_raw)
    if pending is not None:
        issues.append("GLOBAL_INCIDENT_UNMATCHED_QUERY_PREPARED_NO_TIMESTAMP_OR_RESPONSE_BACKFILL")
    issues.extend("HOLD_EXTRA_REQUEST_RECEIPT" for query_id in sorted(set(receipts) - used_receipts))
    issues.extend("HOLD_EXTRA_RESPONSE_PROJECTION" for query_id in sorted(set(projections) - used_projections))
    issues.extend("HOLD_EXTRA_OR_UNREFERENCED_RAW_BLOB" for blob_id in sorted(set(blobs) - used_blobs))
    state["nextSlotOrdinal"] = next_slot_ordinal(contract, set(state["terminalSlotIds"]))
    state["budgetAfter"] = budget_snapshot(state)
    state["runStateSelfSha256"] = None
    return state, issues, pending


def seal_replayed_state(contract: dict, replay_state: dict, previous_state: dict | None = None) -> dict:
    state = copy.deepcopy(replay_state)
    now = utc_now()
    if state["lastResponseEventSequence"]:
        if previous_state is not None and previous_state.get("lastResponseEventSha256") == state["lastResponseEventSha256"]:
            state["lastResponseLedgerFsyncConfirmedAtUtc"] = previous_state["lastResponseLedgerFsyncConfirmedAtUtc"]
        else:
            state["lastResponseLedgerFsyncConfirmedAtUtc"] = now
        require(state["lastResponseLedgerFsyncConfirmedAtUtc"] is not None and parse_utc(state["lastResponseLedgerFsyncConfirmedAtUtc"]) >= parse_utc(state["lastResponseSealPreparedAtUtc"]), "HOLD_RESPONSE_FSYNC_CONFIRMATION_TIME_DRIFT")
    if state["lastDurableEventSequence"]:
        if previous_state is not None and previous_state.get("lastDurableEventSha256") == state["lastDurableEventSha256"]:
            state["lastDurableLedgerFsyncConfirmedAtUtc"] = previous_state["lastDurableLedgerFsyncConfirmedAtUtc"]
        else:
            state["lastDurableLedgerFsyncConfirmedAtUtc"] = now
        require(state["lastDurableLedgerFsyncConfirmedAtUtc"] is not None and parse_utc(state["lastDurableLedgerFsyncConfirmedAtUtc"]) >= parse_utc(state["lastDurableEventCreatedAtUtc"]), "HOLD_DURABLE_EVENT_FSYNC_CONFIRMATION_TIME_DRIFT")
    state["runStateSelfSha256"] = None
    state["runStateSelfSha256"] = canonical_sha(state)
    seal_run_state(Path(contract["queryProtocol"]["privateRunStatePath"]), state)
    return state


def validate_run_state_against_replay(contract: dict, tag919: str, stored: dict, replay_state: dict, issues: list[str], pending: dict | None) -> dict:
    require(stored["runtimeBinding"] == runtime_binding(contract, tag919), "HOLD_RUN_STATE_RUNTIME_BINDING_DRIFT")
    if replay_state["completed"] and stored["lastDurableEventSequence"] < replay_state["lastDurableEventSequence"]:
        raise RuntimeIncident("FINALIZE_COMPLETION_EVENT_FSYNC_WITHOUT_MATCHING_RUN_STATE", replay_state, "FINALIZE_COMPLETION")
    if issues and replay_state["incident"] is None:
        raise RuntimeIncident(issues[0], replay_state)
    if pending is not None and replay_state["incident"] is None:
        raise RuntimeIncident("GLOBAL_INCIDENT_UNMATCHED_QUERY_PREPARED_NO_TIMESTAMP_OR_RESPONSE_BACKFILL", replay_state)
    if stored["lastDurableEventSequence"] < replay_state["lastDurableEventSequence"]:
        if replay_state["incident"] is not None:
            raise RuntimeIncident("FINALIZE_EXISTING_INCIDENT_EVENT_FSYNC_WITHOUT_MATCHING_RUN_STATE", replay_state, "FINALIZE_EXISTING_INCIDENT")
        raise RuntimeIncident("GLOBAL_INCIDENT_DURABLE_LEDGER_HEAD_WITHOUT_MATCHING_RUN_STATE_NO_RECONSTRUCTION", replay_state)
    expected = copy.deepcopy(replay_state)
    if expected["lastResponseEventSequence"]:
        require(stored["lastResponseEventSha256"] == expected["lastResponseEventSha256"], "HOLD_RUN_STATE_LAST_RESPONSE_HEAD_DRIFT")
        expected["lastResponseLedgerFsyncConfirmedAtUtc"] = stored["lastResponseLedgerFsyncConfirmedAtUtc"]
        require(expected["lastResponseLedgerFsyncConfirmedAtUtc"] is not None and parse_utc(expected["lastResponseLedgerFsyncConfirmedAtUtc"]) >= parse_utc(expected["lastResponseSealPreparedAtUtc"]), "HOLD_RUN_STATE_RESPONSE_FSYNC_TIME_DRIFT")
    if expected["lastDurableEventSequence"]:
        require(stored["lastDurableEventSha256"] == expected["lastDurableEventSha256"], "HOLD_RUN_STATE_LAST_DURABLE_HEAD_DRIFT")
        expected["lastDurableLedgerFsyncConfirmedAtUtc"] = stored["lastDurableLedgerFsyncConfirmedAtUtc"]
        require(expected["lastDurableLedgerFsyncConfirmedAtUtc"] is not None and parse_utc(expected["lastDurableLedgerFsyncConfirmedAtUtc"]) >= parse_utc(expected["lastDurableEventCreatedAtUtc"]), "HOLD_RUN_STATE_DURABLE_FSYNC_TIME_DRIFT")
    expected["runStateSelfSha256"] = None
    expected["runStateSelfSha256"] = canonical_sha(expected)
    require(stored == expected, "HOLD_COHERENTLY_REHASHED_RUN_STATE_NOT_EXACT_LEDGER_REPLAY")
    return stored


def load_validated_runtime(contract: dict, tag919: str) -> tuple[dict, dict]:
    materials = read_private_materials(contract, tag919)
    replay_state, issues, pending = replay_private_ledger(contract, tag919, materials)
    stored = load_run_state(contract, tag919)
    validated = validate_run_state_against_replay(contract, tag919, stored, replay_state, issues, pending)
    completion_path = PRIVATE_STORE_ROOT / "tag920-completion-binding-v1.json"
    if completion_path.exists() and not validated["completed"]:
        raise RuntimeIncident("HOLD_EXTRA_TAG920_BINDING_BEFORE_COMPLETION", replay_state)
    return validated, materials


def assert_durable_query_barrier(contract: dict, tag919: str, state: dict) -> None:
    validated, materials = load_validated_runtime(contract, tag919)
    require(validated == state, "HOLD_QUERY_BARRIER_CALLER_STATE_DRIFT")
    require(not validated["completed"] and validated["incident"] is None, "HOLD_QUERY_BARRIER_TERMINAL_STATE")
    require(materials["rows"] == [] or materials["rows"][-1]["eventType"] != "QUERY_PREPARED", "HOLD_QUERY_BARRIER_UNMATCHED_PREPARED")
    if materials["rows"]:
        require(validated["lastDurableEventSha256"] == materials["rows"][-1]["eventSha256"], "HOLD_QUERY_BARRIER_LAST_DURABLE_EVENT_HEAD_DRIFT")
        require(validated["lastDurableLedgerRawSha256"] == sha256_bytes(materials["ledgerRaw"]), "HOLD_QUERY_BARRIER_LEDGER_RAW_HASH_DRIFT")
        require(validated["lastDurableLedgerFsyncConfirmedAtUtc"] is not None, "HOLD_QUERY_BARRIER_FSYNC_CONFIRMATION_MISSING")


def terminalize_derived_holds(contract: dict, state: dict, ledger: Path, unit_id: str, slots: list[dict], reason: str, tag919: str) -> None:
    for slot in slots:
        if slot["slotId"] in state["terminalSlotIds"]:
            continue
        append_private_event(ledger, "DERIVED_SLOT_TYPED_HOLD", {
            "slotId": slot["slotId"], "unitId": unit_id, "singleReason": reason,
            "networkRequestMade": False, "scientificCredit": "NONE",
        })
        materials = read_private_materials(contract, tag919)
        replay_state, issues, pending = replay_private_ledger(contract, tag919, materials)
        require(not issues and pending is None, "HOLD_DERIVED_SLOT_POST_APPEND_REPLAY_FAILED")
        durable = seal_replayed_state(contract, replay_state, state)
        state.clear()
        state.update(durable)


def store_opaque_blob(contract: dict, raw: bytes) -> tuple[str, Path]:
    digest = sha256_bytes(raw)
    root = Path(contract["queryProtocol"]["privateRawBlobRoot"])
    path = root / digest[:2] / digest
    if path.exists():
        require(path.read_bytes() == raw, "content-address collision")
    else:
        durable_mkdir(path.parent)
        temporary = path.with_name(path.name + ".tmp")
        with temporary.open("xb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        durable_replace(temporary, path)
    return digest, path


def execute_slot(contract: dict, state: dict, slot: dict, tag919: str) -> None:
    qp = contract["queryProtocol"]
    ledger = Path(qp["privateLiveAuditLedgerPath"])
    schedule = contract["capturePlan"]["slotSchedule"]
    ordinal = schedule.index(slot) + 1
    query_id = f"Q010-SC003-QUERY-{ordinal:03d}"
    unit_id = slot["unitId"]
    unit_slots = [row for row in schedule if row["unitId"] == unit_id]
    if slot["attemptOrdinal"] > 1:
        selected = state["selectedByUnit"].get(unit_id, [])
        rank = slot["derivedTargetRank"] or 0
        if rank > len(selected):
            terminalize_derived_holds(contract, state, ledger, unit_id, [slot], "HOLD_NO_COMPLETE_SELECTED_CDX_ROW_FOR_DERIVED_SLOT", tag919)
            return
        uri = materialize_capture_uri(selected[rank - 1])
    else:
        uri = materialize_locator_uri(slot)
    require(state["requestsUsed"] < contract["capturePlan"]["requestHardCap"], "HOLD_GLOBAL_REQUEST_BUDGET_EXHAUSTED")
    require(state["responseBytes"] <= contract["capturePlan"]["privateRawBytesHardCap"] and state["acceptedPayloads"] <= contract["capturePlan"]["acceptedPayloadHardCap"], "HOLD_GLOBAL_BYTE_OR_ACCEPTED_BUDGET_EXHAUSTED")
    unit_state = state["units"][unit_id]
    if unit_state["startedAtUtc"] is not None and (datetime.now(timezone.utc) - parse_utc(unit_state["startedAtUtc"])).total_seconds() > 1200:
        remaining = [row for row in unit_slots if row["slotId"] not in state["terminalSlotIds"]]
        terminalize_derived_holds(contract, state, ledger, unit_id, remaining, "HOLD_UNIT_20_MINUTE_BUDGET_EXHAUSTED", tag919)
        return
    receipt = pre_query_remote_receipt(contract, query_id, tag919)
    headers_sha, request_canonical_sha, request_bytes_sha = request_fingerprints("GET", uri)
    prepared_at = utc_now()
    prepared = {
        "queryId": query_id, "slotId": slot["slotId"], "sequence": ordinal,
        "previousEventSha256": read_private_ledger(ledger)[0][-1]["eventSha256"] if ledger.exists() else None,
        "templateId": slot["templateId"], "requestAuthorityId": slot["requestAuthorityId"],
        "publisherAuthorityId": slot["publisherAuthorityId"], "transportId": slot["transportId"],
        "requestRole": slot["requestRole"], "sourceClass": slot["sourceClass"], "method": "GET",
        "canonicalUri": uri, "bodySha256": sha256_bytes(b""), "allowlistedHeadersSha256": headers_sha,
        "requestCanonicalSha256": request_canonical_sha, "requestBytesSha256": request_bytes_sha,
        "requestPreparedAtUtc": prepared_at, "preQueryRemoteHead": tag919,
        "preQueryRemoteRef": contract["repository"]["remoteRef"],
        "preQueryRemoteObservedAtUtc": receipt["observedAtUtc"], "preQueryRemoteReceiptSha256": receipt["receiptSha256"],
        "budgetBefore": budget_snapshot(state),
    }
    assert_durable_query_barrier(contract, tag919, state)
    append_private_event(ledger, "QUERY_PREPARED", prepared, prepared_at)
    receipt_path = PRIVATE_STORE_ROOT / "remote-receipts" / f"{query_id}.json"
    require(not receipt_path.exists(), "HOLD_DUPLICATE_RECEIPT_PATH_BEFORE_REQUEST")
    atomic_json(receipt_path, receipt)
    request_started = utc_now()
    headers: list[tuple[str, str]] = []
    raw = b""
    response_received = False
    status_or_error: int | str
    try:
        status, headers, raw = http_get_exact(
            uri, contract["capturePlan"]["maxResponseBytesPerRequest"],
            contract["capturePlan"]["connectTimeoutSeconds"], contract["capturePlan"]["responseTimeoutSeconds"],
        )
        status_or_error = status
        response_received = True
    except Exception as exc:
        if isinstance(exc, (KeyboardInterrupt, GateError)):
            raise
        status_or_error = "TYPED_ERROR_" + type(exc).__name__.upper()
    disposition = "TYPED_HOLD"
    reason = "HOLD_UNCLASSIFIED_REQUEST_FAILURE"
    projection: dict = {}
    blob_id: str | None = None
    normalized_mime: str | None = None
    header_hold_reason: str | None = None
    if response_received:
        normalized_mime, header_hold_reason = classify_response_headers(headers)
        encoding_unsafe = header_hold_reason in ENCODING_HOLD_REASONS
        if raw and not encoding_unsafe:
            blob_id, _ = store_opaque_blob(contract, raw)
        if slot["attemptOrdinal"] == 1:
            parsed = parse_locator_http_response(status_or_error, raw, slot, header_hold_reason)
            projection = cdx_safe_projection(parsed)
            reason = parsed["singleReason"]
            disposition = "LOCATOR_COMPLETE_SELECTIONS_FROZEN" if parsed.get("completenessProven") else "WHOLE_UNIT_TYPED_HOLD"
        else:
            selected = state["selectedByUnit"][unit_id][(slot["derivedTargetRank"] or 1) - 1]
            payload_sha = sha256_bytes(raw)
            inherited_hashes = {row["payloadSha256"] for row in contract["sourcePolicy"]["inheritedTag914PayloadManifest"]}
            cdx_match = bool(not encoding_unsafe and exact_entity_digest_matches(raw, selected["digest"]))
            duplicate_inherited = payload_sha in inherited_hashes
            duplicate_current = payload_sha in state["seenPayloadSha256"]
            accepted = type(status_or_error) is int and status_or_error == 200 and bool(raw) and blob_id is not None and cdx_match and header_hold_reason is None and normalized_mime is not None and not duplicate_inherited and not duplicate_current
            if header_hold_reason is not None:
                disposition, reason = "QUARANTINED_HOLD", header_hold_reason
            elif accepted:
                disposition = "NEW_OPAQUE_PRIMARY_PUBLISHER_RAW_BYTES_CAPTURED_DIGEST_MATCHED_NO_SOURCE_RECORD_ENTITY_TEL_CANDIDATE_OR_SCIENTIFIC_CREDIT"
                reason = "RAW_CAPTURE_ACCEPTED_UNCODED_NO_CREDIT"
            elif duplicate_inherited:
                disposition, reason = "INHERITED_DUPLICATE_REFERENCE_ONLY", "DUPLICATE_TAG914_NO_SC003_SUCCESS"
            elif duplicate_current:
                disposition, reason = "SC003_DUPLICATE_REFERENCE_ONLY", "DUPLICATE_SC003_NO_ADDITIONAL_SUCCESS"
            elif not cdx_match:
                disposition, reason = "QUARANTINED_HOLD", "HOLD_CDX_DIGEST_MISMATCH_EXACT_ENTITY_BYTES"
            else:
                disposition, reason = "QUARANTINED_HOLD", "HOLD_HTTP_STATUS_EMPTY_OR_UNSUPPORTED_PAYLOAD"
            captured_at = utc_now()
            projection = {
                "httpStatus": status_or_error, "mimeType": normalized_mime or "UNKNOWN", "responseBytes": len(raw),
                "responseSha256": payload_sha, "archiveObservationTimestampExact": selected["timestamp"],
                "retrievedAt": captured_at, "capturedAt": captured_at, "payloadCaptureDisposition": disposition,
                "cdxDigestMatchBoolean": cdx_match, "inheritedPayloadDuplicateBoolean": duplicate_inherited,
                "futureSourceRecordStatus": "NOT_CREATED_PENDING_SEPARATE_BLIND_DECISION",
            }
    else:
        reason = status_or_error
    projected_requests = state["requestsUsed"] + 1
    projected_slots = len(state["terminalSlotIds"]) + 1
    success_disposition = "NEW_OPAQUE_PRIMARY_PUBLISHER_RAW_BYTES_CAPTURED_DIGEST_MATCHED_NO_SOURCE_RECORD_ENTITY_TEL_CANDIDATE_OR_SCIENTIFIC_CREDIT"
    projected_accepted = state["acceptedPayloads"] + (1 if disposition == success_disposition else 0)
    budget_after = {
        "slotsTerminal": projected_slots, "requestsUsed": projected_requests,
        "responseBytes": state["responseBytes"] + len(raw), "acceptedPayloads": projected_accepted,
        "requestHardCap": 45, "privateRawBytesHardCap": 900000000, "acceptedPayloadHardCap": 30,
    }
    observed_at = utc_now()
    sealed_at = utc_now()
    event_mime = normalized_mime or "UNKNOWN"
    header_projection = sealed_response_header_projection(status_or_error, event_mime, reason, [])
    response_payload = {
        "queryId": query_id, "sequence": ordinal,
        "previousEventSha256": read_private_ledger(ledger)[0][-1]["eventSha256"],
        "requestStartedAtUtc": request_started, "responseObservedAtUtc": observed_at,
        "responseSealPreparedAtUtc": sealed_at, "httpStatusOrTypedError": status_or_error,
        "redirectChain": [], "responseHeaderProjectionSha256": canonical_sha(header_projection),
        "responseBytes": len(raw), "responseSha256": sha256_bytes(raw),
        "mimeType": event_mime,
        "privateContentAddressedBlobId": blob_id,
        "projectionSchema": slot["parserProjectionId"], "projectionSha256": canonical_sha(projection),
        "forbiddenFieldExposure": False, "disposition": disposition, "singleReason": reason,
        "budgetAfter": budget_after,
    }
    response_event = append_private_event(ledger, "QUERY_RESPONSE_SEALED", response_payload, sealed_at)
    if response_received:
        append_projection(contract, query_id, slot, response_event, projection)
    materials = read_private_materials(contract, tag919)
    replay_state, issues, pending = replay_private_ledger(contract, tag919, materials)
    require(not issues and pending is None, "HOLD_RESPONSE_POST_APPEND_REFERENTIAL_REPLAY_FAILED")
    durable = seal_replayed_state(contract, replay_state, state)
    state.clear()
    state.update(durable)
    if slot["attemptOrdinal"] == 1 and disposition == "WHOLE_UNIT_TYPED_HOLD":
        remaining = [row for row in unit_slots if row["attemptOrdinal"] > 1 and row["slotId"] not in state["terminalSlotIds"]]
        terminalize_derived_holds(contract, state, ledger, unit_id, remaining, reason, tag919)


def completion_binding(contract: dict, state: dict, materials: dict) -> dict:
    rows = materials["rows"]
    require(rows and rows[-1]["eventType"] == "RUN_COMPLETED" and state["completed"], "HOLD_FINAL_BINDING_REQUIRES_COMPLETED_REPLAY")
    pre_binding = rows[-1]["payload"]["preCompletionEventBinding"]
    expected_pre = pre_completion_event_binding(contract, state, b"".join(canonical(row) + b"\n" for row in rows[:-1]), rows[:-1], materials)
    require(pre_binding == expected_pre, "HOLD_FINAL_BINDING_PRE_COMPLETION_MATERIAL_JOIN_NOT_EXACTLY_BOUND")
    joins = material_join_binding(rows, materials)
    require(joins == pre_binding["materialJoinBinding"], "HOLD_FINAL_BINDING_POST_COMPLETION_MATERIAL_JOIN_DRIFT")
    binding = {
        "schema": "early-detection-q010-sc003-tag920-final-completion-binding/v2",
        "requiredCompletionSubject": contract["repository"]["expectedCompletionSubject"],
        "requiredCompletionParentSubject": TAG919_SUBJECT,
        "preCompletionEventBindingSha256": pre_binding["bindingSha256"],
        "privateLedgerRawSha256": sha256_bytes(materials["ledgerRaw"]),
        "privateLedgerEventCount": len(rows),
        "privateLedgerEventHeadSha256": rows[-1]["eventSha256"],
        "runStateSha256": state["runStateSelfSha256"],
        "materialJoinBinding": joins,
        **materials["summary"],
        "scientificCredit": "NONE",
        "nextQ010SubchunkAuthorized": False,
        "bindingSha256": None,
    }
    binding["bindingSha256"] = canonical_sha(binding)
    return binding


def finish_run(contract: dict, state: dict, tag919: str) -> dict:
    if state["completed"]:
        return idempotent_completion(contract, state, tag919)
    metrics = completion_metrics(contract, state)
    require(metrics["allFortyFiveSlotsTerminal"] and metrics["allFifteenUnitsTerminal"], "HOLD_FINISH_ATTEMPT_BEFORE_ALL_SLOTS_AND_UNITS_TERMINAL")
    materials = read_private_materials(contract, tag919)
    pre_binding = pre_completion_event_binding(contract, state, materials["ledgerRaw"], materials["rows"], materials)
    append_private_event(Path(contract["queryProtocol"]["privateLiveAuditLedgerPath"]), "RUN_COMPLETED", {
        "completionStatus": pre_binding["completionStatus"],
        **metrics,
        "preCompletionEventBinding": pre_binding,
        "researchSourceAccessAuthorized": False,
        "scientificCredit": "NONE",
        "nextQ010SubchunkAuthorized": False,
    })
    final_materials = read_private_materials(contract, tag919)
    replay_state, issues, pending = replay_private_ledger(contract, tag919, final_materials)
    require(pending is None and (not issues or replay_state["incident"] is not None), "HOLD_COMPLETION_REPLAY_REFERENTIAL_FAILURE")
    durable = seal_replayed_state(contract, replay_state, state)
    state.clear()
    state.update(durable)
    binding = completion_binding(contract, state, final_materials)
    atomic_json(PRIVATE_STORE_ROOT / "tag920-completion-binding-v1.json", binding)
    return {"status": state["completionStatus"], "tag920Binding": binding, "scientificCredit": "NONE"}


def terminalize_global_incident(contract: dict, state: dict, ledger: Path, reason: str, tag919: str, append_incident: bool = True) -> dict:
    if append_incident:
        append_private_event(ledger, "GLOBAL_INCIDENT", {"singleReason": reason, "reconstructionForbidden": True, "sourceRequestsAfterIncident": 0})
    materials = read_private_materials(contract, tag919)
    replay_state, _, pending = replay_private_ledger(contract, tag919, materials)
    require(pending is None and replay_state["incident"] is not None, "HOLD_GLOBAL_INCIDENT_REPLAY_FAILED")
    durable = seal_replayed_state(contract, replay_state, state)
    state.clear()
    state.update(durable)
    return finish_run(contract, state, tag919)


def idempotent_completion(contract: dict, state: dict, tag919: str) -> dict:
    materials = read_private_materials(contract, tag919)
    replay_state, issues, pending = replay_private_ledger(contract, tag919, materials)
    require(replay_state["completed"] and pending is None and (not issues or replay_state["incident"] is not None), "HOLD_IDEMPOTENT_COMPLETION_REPLAY_FAILED")
    validated = validate_run_state_against_replay(contract, tag919, state, replay_state, issues, pending)
    binding = completion_binding(contract, validated, materials)
    path = PRIVATE_STORE_ROOT / "tag920-completion-binding-v1.json"
    if path.exists():
        stored = json.loads(path.read_text(encoding="utf-8"))
        claim = stored.get("bindingSha256")
        body = copy.deepcopy(stored)
        body["bindingSha256"] = None
        require(canonical_sha(body) == claim and stored == binding, "HOLD_STORED_TAG920_FINAL_BINDING_DRIFT")
    else:
        atomic_json(path, binding)
    return {"status": validated["completionStatus"], "alreadyCompleted": True, "tag920Binding": binding, "scientificCredit": "NONE"}


def run_capture(remote: bool) -> dict:
    fail("SC003 is publicly completed; source runtime is permanently closed")
    require(remote, "--remote is mandatory for source runtime")
    gate = verify(True, private_store_allowed=True)
    require(gate["phase"] == "START_POST_INTRODUCTION" and gate["runtimeResearchSourceAccessAuthorized"] is True, "source runtime forbidden before live Tag919 POST gate")
    contract = read_contract()
    tag919 = gate["introductionCommit"]
    require(isinstance(tag919, str), "source runtime missing Tag919 introduction commit")
    with exclusive_runtime_mutex():
        durability_preflight()
        store_was_absent = not PRIVATE_STORE_ROOT.exists()
        if store_was_absent:
            durable_mkdir(PRIVATE_STORE_ROOT)
        store_is_empty = not any(PRIVATE_STORE_ROOT.iterdir())
        if store_is_empty:
            state = initial_run_state(contract, tag919)
            seal_run_state(Path(contract["queryProtocol"]["privateRunStatePath"]), state)
        else:
            require(Path(contract["queryProtocol"]["privateRunStatePath"]).exists(), "HOLD_NONEMPTY_PRIVATE_STORE_WITHOUT_RUN_STATE")
        try:
            state, _ = load_validated_runtime(contract, tag919)
        except RuntimeIncident as incident:
            if incident.disposition == "FINALIZE_COMPLETION":
                state = seal_replayed_state(contract, incident.replay_state, None)
                return idempotent_completion(contract, state, tag919)
            if incident.disposition == "FINALIZE_EXISTING_INCIDENT":
                return terminalize_global_incident(contract, incident.replay_state, Path(contract["queryProtocol"]["privateLiveAuditLedgerPath"]), incident.reason, tag919, append_incident=False)
            return terminalize_global_incident(contract, incident.replay_state, Path(contract["queryProtocol"]["privateLiveAuditLedgerPath"]), incident.reason, tag919)
        if state["completed"]:
            return idempotent_completion(contract, state, tag919)
        if state["incident"] is not None:
            return terminalize_global_incident(contract, state, Path(contract["queryProtocol"]["privateLiveAuditLedgerPath"]), state["incident"], tag919, append_incident=False)
        schedule = contract["capturePlan"]["slotSchedule"]
        while state["nextSlotOrdinal"] <= len(schedule):
            execute_slot(contract, state, schedule[state["nextSlotOrdinal"] - 1], tag919)
        return finish_run(contract, state, tag919)


def self_test() -> dict:
    contract, events, state = read_contract(), read_events(), read_state()
    validate_bundle(contract, events, state, check_files=True)
    attacks: list[str] = []

    def rebind(c: dict) -> tuple[list[dict], dict]:
        c["sourcePolicy"]["frozenQueryTemplatesSha256"] = frozen_query_templates_sha256(c)
        c["capturePlan"]["slotScheduleSha256"] = slot_schedule_sha256(c)
        c["frozenPolicyProjectionSha256"] = policy_projection_sha256(c)
        c["contractSelfSha256"] = contract_self_sha256(c)
        e = expected_events(c)
        return e, expected_state(c, e)

    def rejected(name: str, mutate) -> None:
        try:
            c = copy.deepcopy(contract)
            mutate(c)
            e, s = rebind(c)
            validate_bundle(c, e, s, check_files=False)
        except (GateError, KeyError, TypeError, ValueError):
            attacks.append(name)
            return
        fail("mutation survived: " + name)

    def aggregate_mutation(c: dict, mutate) -> None:
        aggregate = c["completionFinalization"]["publicAggregateProjection"]
        mutate(aggregate)
        aggregate["projectionSelfSha256"] = public_projection_self_sha256(aggregate)

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
    rejected("start-decision-commit", lambda c: c["startIntroductionBinding"].__setitem__("decisionCommit", "0" * 40))
    rejected("start-parent-blob", lambda c: c["startIntroductionBinding"]["decisionParentBlobs"][0].__setitem__("rawSha256", "0" * 64))
    rejected("start-receipt-oid", lambda c: c["startIntroductionBinding"]["decisionRemoteReceipt"].__setitem__("observedRemoteOid", "0" * 40))
    rejected("start-receipt-time", lambda c: c["startIntroductionBinding"]["decisionRemoteReceipt"].__setitem__("observedAtUtc", "2026-08-14T01:40:00Z"))
    rejected("start-work-backdate", lambda c: c["startFinalization"].__setitem__("workStartedAtUtc", "2026-08-14T01:30:00Z"))
    rejected("start-private-store-present", lambda c: c["startFinalization"].__setitem__("privateStoreAbsentAtWorkStart", False))
    rejected("start-stored-access", lambda c: c["startFinalization"].__setitem__("storedResearchSourceAccessAuthorized", True))
    rejected("start-runtime-gate", lambda c: c["startFinalization"].__setitem__("runtimeResearchSourceAccessRequiresTag919PostGate", False))
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
    rejected("tag920-subject", lambda c: c["completionTransitionContract"].__setitem__("requiredCompletionSubject", "Tag 920: drift"))
    rejected("tag920-topology-relaxed", lambda c: c["completionTransitionContract"].__setitem__("tag920MustBeExactFiveModifyDirectChildOfLiveRemoteTag919", False))
    rejected("tag920-mutation-surface-expanded", lambda c: c["completionTransitionContract"]["allowedTag920ContractMutationJsonPointers"].append("/sourcePolicy"))
    rejected("post-completion-run-authorized", lambda c: c["completionTransitionContract"]["postCompletionRuntimePolicy"].__setitem__("runCommandAuthorized", True))
    rejected("tag919-completion-parent", lambda c: c["completionIntroductionBinding"].__setitem__("startCommit", "0" * 40))
    rejected("tag919-completion-parent-blob", lambda c: c["completionIntroductionBinding"]["startParentBlobs"][0].__setitem__("rawSha256", "0" * 64))
    rejected("completion-backdate", lambda c: c["completionFinalization"].__setitem__("completionRecordedAtUtc", "2026-08-14T01:00:00Z"))
    rejected("completion-success-forge", lambda c: c["completionFinalization"].__setitem__("completionStatus", "RAW_CAPTURE_MATRIX_COMPLETE_UNCODED_NO_CREDIT"))
    rejected("completion-accepted-forge", lambda c: c["completionFinalization"].__setitem__("acceptedPayloads", 1))
    rejected("completion-request-forge", lambda c: c["completionFinalization"].__setitem__("networkRequestCount", 16))
    rejected("completion-private-binding-forge", lambda c: c["completionFinalization"].__setitem__("privateTag920BindingSha256", "0" * 64))
    rejected("aggregate-accepted-coherent-rehash", lambda c: aggregate_mutation(c, lambda a: a["networkAccounting"].__setitem__("acceptedPrimaryPayloadCount", 1)))
    rejected("aggregate-terminal-unique-coherent-rehash", lambda c: aggregate_mutation(c, lambda a: a["terminalization"].__setitem__("terminalSlotUniqueCount", 44)))
    rejected("aggregate-incident-coherent-rehash", lambda c: aggregate_mutation(c, lambda a: a["completionMetrics"].__setitem__("incidentFree", False)))
    rejected("aggregate-every-unit-coherent-rehash", lambda c: aggregate_mutation(c, lambda a: a["completionMetrics"].__setitem__("everyUnitAtLeastOneNewPayload", True)))
    rejected("aggregate-negative-evidence-coherent-rehash", lambda c: aggregate_mutation(c, lambda a: a["semanticLocks"].__setitem__("derivedNullNetworkTerminalizationsAreNotNegativeEvidence", False)))
    rejected("aggregate-locator-as-primary-coherent-rehash", lambda c: aggregate_mutation(c, lambda a: a["semanticLocks"].__setitem__("storedBlobCountsAreNotAcceptedPrimarySourceCounts", False)))
    rejected("aggregate-reason-coherent-rehash", lambda c: aggregate_mutation(c, lambda a: a["eventTypeReasonCrossTable"][0].__setitem__("count", 11)))

    runtime_contract_fixture = tag919_runtime_contract(contract)
    strict_materials = read_private_materials(runtime_contract_fixture, TAG919)
    strict_stored_state = load_run_state(runtime_contract_fixture, TAG919)
    strict_binding_path = PRIVATE_STORE_ROOT / "tag920-completion-binding-v1.json"
    strict_binding_raw = strict_binding_path.read_bytes()
    strict_stored_binding = json.loads(strict_binding_raw.decode("utf-8"))
    validate_strict_private_completion_replay(
        runtime_contract_fixture, contract["completionFinalization"], strict_materials,
        strict_stored_state, strict_binding_raw, strict_stored_binding,
    )

    coherent_materials = copy.deepcopy(strict_materials)
    forged_response = next(row for row in coherent_materials["rows"] if row["eventType"] == "QUERY_RESPONSE_SEALED")
    forged_response["payload"]["singleReason"] = "HOLD_CDX_RETURNED_STATUSCODE_NOT_EXACT_200"
    forged_response["payload"]["responseHeaderProjectionSha256"] = canonical_sha(sealed_response_header_projection(
        forged_response["payload"]["httpStatusOrTypedError"], forged_response["payload"]["mimeType"],
        forged_response["payload"]["singleReason"], forged_response["payload"]["redirectChain"],
    ))
    previous = None
    event_hashes: dict[int, str] = {}
    for row in coherent_materials["rows"]:
        row["previousEventSha256"] = previous
        if "previousEventSha256" in row["payload"]:
            row["payload"]["previousEventSha256"] = previous
        row["eventSha256"] = event_self_sha256(row)
        previous = row["eventSha256"]
        event_hashes[row["sequence"]] = previous
    coherent_materials["ledgerRaw"] = b"".join(canonical(row) + b"\n" for row in coherent_materials["rows"])
    previous_projection = None
    for row in coherent_materials["projectionRows"]:
        row["previousProjectionRecordSha256"] = previous_projection
        row["responseEventSha256"] = event_hashes[row["responseEventSequence"]]
        row["projectionRecordSha256"] = None
        row["projectionRecordSha256"] = canonical_sha(row)
        previous_projection = row["projectionRecordSha256"]
    coherent_materials["projectionRaw"] = b"".join(canonical(row) + b"\n" for row in coherent_materials["projectionRows"])
    coherent_materials["summary"] = material_summary(
        coherent_materials["projectionRows"], coherent_materials["projectionRaw"],
        coherent_materials["receiptManifest"], coherent_materials["rawManifest"],
    )
    coherent_state = copy.deepcopy(strict_stored_state)
    coherent_state["lastDurableEventSha256"] = coherent_materials["rows"][-1]["eventSha256"]
    coherent_state["lastDurableLedgerRawSha256"] = sha256_bytes(coherent_materials["ledgerRaw"])
    last_response_sequence = coherent_state["lastResponseEventSequence"]
    coherent_state["lastResponseEventSha256"] = event_hashes[last_response_sequence]
    coherent_state["lastResponseLedgerRawSha256"] = sha256_bytes(b"".join(
        canonical(row) + b"\n" for row in coherent_materials["rows"][:last_response_sequence]
    ))
    coherent_state["runStateSelfSha256"] = None
    coherent_state["runStateSelfSha256"] = canonical_sha(coherent_state)
    coherent_binding = copy.deepcopy(strict_stored_binding)
    coherent_binding["privateLedgerRawSha256"] = sha256_bytes(coherent_materials["ledgerRaw"])
    coherent_binding["privateLedgerEventHeadSha256"] = coherent_materials["rows"][-1]["eventSha256"]
    coherent_binding["runStateSha256"] = coherent_state["runStateSelfSha256"]
    coherent_binding["projectionManifestSha256"] = coherent_materials["summary"]["projectionManifestSha256"]
    coherent_binding["projectionHeadSha256"] = coherent_materials["summary"]["projectionHeadSha256"]
    coherent_binding["bindingSha256"] = None
    coherent_binding["bindingSha256"] = canonical_sha(coherent_binding)
    coherent_binding_raw = json.dumps(coherent_binding, ensure_ascii=False, indent=2, sort_keys=True).encode("utf-8") + b"\n"
    coherent_contract = copy.deepcopy(contract)
    coherent_finalization = coherent_contract["completionFinalization"]
    coherent_finalization["privateLedgerRawSha256"] = coherent_binding["privateLedgerRawSha256"]
    coherent_finalization["privateLedgerEventHeadSha256"] = coherent_binding["privateLedgerEventHeadSha256"]
    coherent_finalization["runStateSelfSha256"] = coherent_state["runStateSelfSha256"]
    coherent_finalization["privateTag920BindingSha256"] = coherent_binding["bindingSha256"]
    coherent_finalization["privateTag920JsonRawSha256"] = sha256_bytes(coherent_binding_raw)
    coherent_aggregate = coherent_finalization["publicAggregateProjection"]
    coherent_aggregate["parentPrivateTag920FinalBindingSha256"] = coherent_binding["bindingSha256"]
    coherent_aggregate["privateTag920JsonRawSha256"] = sha256_bytes(coherent_binding_raw)
    coherent_aggregate["privateLedger"]["rawSha256"] = coherent_binding["privateLedgerRawSha256"]
    coherent_aggregate["privateLedger"]["eventHeadSha256"] = coherent_binding["privateLedgerEventHeadSha256"]
    coherent_aggregate["privateRunState"]["selfSha256"] = coherent_state["runStateSelfSha256"]
    coherent_aggregate["projectionSelfSha256"] = public_projection_self_sha256(coherent_aggregate)
    coherent_contract["contractSelfSha256"] = contract_self_sha256(coherent_contract)
    coherent_events = expected_events(coherent_contract)
    coherent_public_state = expected_state(coherent_contract, coherent_events)
    require(coherent_public_state["stateSelfSha256"] == state_self_sha256(coherent_public_state), "coherent public-five forge fixture did not rehash")
    try:
        validate_strict_private_completion_replay(
            runtime_contract_fixture, coherent_finalization, coherent_materials, coherent_state,
            coherent_binding_raw, coherent_binding,
        )
    except GateError:
        attacks.append("strict-coherent-ledger-state-binding-public-five-forge")
    else:
        fail("coherently rehashed private/public completion forge survived strict runtime replay")

    forged_exact_join_materials = copy.deepcopy(strict_materials)
    forged_exact_join_materials["blobs"].pop(next(iter(forged_exact_join_materials["blobs"])))
    try:
        validate_strict_private_completion_replay(
            runtime_contract_fixture, contract["completionFinalization"], forged_exact_join_materials,
            strict_stored_state, strict_binding_raw, strict_stored_binding,
        )
    except GateError:
        attacks.append("strict-forged-exact-material-join")
    else:
        fail("forged EXACT material join survived strict runtime replay")
    sample_slot = contract["capturePlan"]["slotSchedule"][0]
    sample_rows = [
        ["timestamp", "original", "statuscode", "mimetype", "digest"],
        ["20150101000000", "https://www.dmv.ca.gov/portal/dmv/detail/vr/autonomous/a", "200", "text/html", "AAA"],
        ["20140101000000", "https://www.dmv.ca.gov/portal/dmv/detail/vr/autonomous/b", "200", "text/html", "BBB"],
        ["20140101000000", "https://www.dmv.ca.gov/portal/dmv/detail/vr/autonomous/c", "200", "text/html", "BBB"],
    ]
    parsed = parse_cdx_complete(json.dumps(sample_rows).encode("utf-8"), sample_slot)
    require(parsed["completenessProven"] is True and [row["digest"] for row in parsed["selected"]] == ["BBB", "AAA"], "CDX full-byte sort/dedupe/take2 self-test failed")
    require(parse_cdx_complete(json.dumps(sample_rows).encode("utf-8") + b"\nresume-key", sample_slot)["completenessProven"] is False, "CDX trailer fail-closed self-test failed")
    five_hundred = [sample_rows[0]] + [["20150101000000", f"https://www.dmv.ca.gov/portal/dmv/detail/vr/autonomous/{index}", "200", "text/html", str(index)] for index in range(500)]
    require(parse_cdx_complete(json.dumps(five_hundred).encode("utf-8"), sample_slot)["completenessProven"] is False, "CDX 500-row completeness self-test failed")
    wrong_status = copy.deepcopy(sample_rows)
    wrong_status[1][2] = "302"
    wrong_status_result = parse_cdx_complete(json.dumps(wrong_status).encode("utf-8"), sample_slot)
    require(wrong_status_result["completenessProven"] is False and wrong_status_result["singleReason"] == "HOLD_CDX_RETURNED_STATUSCODE_NOT_EXACT_200", "CDX returned statuscode exact-validation self-test failed")
    require(normalized_locator_text("Autonomous_vehicle--TEST") == "autonomous vehicle test", "non-alphanumeric normalization self-test failed")
    require(normalized_response_mime([]) is None and normalized_response_mime([("Content-Type", "application/x-unknown")]) is None, "unknown MIME HOLD self-test failed")
    duplicate_header_fixtures = [
        ([("Content-Encoding", "identity"), ("content-encoding", "gzip"), ("Content-Type", "application/json")], "HOLD_DUPLICATE_CONTENT_ENCODING_HEADERS"),
        ([("content-encoding", "gzip"), ("Content-Encoding", "identity"), ("Content-Type", "application/json")], "HOLD_DUPLICATE_CONTENT_ENCODING_HEADERS"),
        ([("Content-Encoding", "identity"), ("content-encoding", "identity"), ("Content-Type", "application/json")], "HOLD_DUPLICATE_CONTENT_ENCODING_HEADERS"),
        ([("Content-Type", "application/json"), ("content-type", "text/html")], "HOLD_DUPLICATE_CONTENT_TYPE_HEADERS"),
        ([("content-type", "text/html"), ("Content-Type", "application/json")], "HOLD_DUPLICATE_CONTENT_TYPE_HEADERS"),
        ([("Content-Type", "application/json"), ("content-type", "application/json")], "HOLD_DUPLICATE_CONTENT_TYPE_HEADERS"),
    ]
    require(all(classify_response_headers(headers)[1] == reason for headers, reason in duplicate_header_fixtures), "case-insensitive duplicate response-header fixtures failed")
    require(request_headers()[2] == ("Accept-Encoding", "identity") and request_headers()[1] == ("Accept", "*/*"), "frozen identity header self-test failed")
    require(exact_entity_digest_matches(b"abc", base64.b32encode(hashlib.sha1(b"abc").digest()).decode("ascii").rstrip("=")), "exact entity digest self-test failed")
    durability_preflight()
    source_requests = 0
    try:
        durability_preflight(lambda _: fail("HOLD_WIN32_DIRECTORY_FLUSH_FIXTURE"))
        source_requests += 1
    except GateError:
        pass
    require(source_requests == 0, "Win32 durability failure permitted a source request")
    concurrent_rejected = False
    with exclusive_runtime_mutex():
        try:
            with exclusive_runtime_mutex():
                source_requests += 1
        except GateError:
            concurrent_rejected = True
    require(concurrent_rejected and source_requests == 0, "Windows named mutex concurrent fixture failed")
    validate_raw_blob_entry(sha256_bytes(b"fixture" )[:2], sha256_bytes(b"fixture"), b"fixture")
    try:
        validate_raw_blob_entry("ff", sha256_bytes(b"fixture"), b"forged")
    except GateError:
        pass
    else:
        fail("raw blob coherent filename/content forge survived")

    fixture_tag = TAG918
    fixture_binding = runtime_binding(contract, fixture_tag)
    fixture_raw = json.dumps(sample_rows, separators=(",", ":")).encode("utf-8")
    fixture_blob_id = sha256_bytes(fixture_raw)
    fixture_uri = materialize_locator_uri(sample_slot)
    headers_sha, request_sha, request_bytes_sha = request_fingerprints("GET", fixture_uri)
    receipt = {
        "schema": "early-detection-q010-sc003-pre-query-remote-receipt/v1",
        "queryId": "Q010-SC003-QUERY-001",
        "observedHead": fixture_tag,
        "observedUpstream": fixture_tag,
        "observedRemoteRef": contract["repository"]["remoteRef"],
        "observedRemoteOid": fixture_tag,
        "gitLsRemoteRawSha256": sha256_bytes(f"{fixture_tag}\t{contract['repository']['remoteRef']}\n".encode("utf-8")),
        "ownedPathBlobBindingsSha256": fixture_binding["ownedPathBlobBindingsSha256"],
        "ownedPathsClean": True,
        "observedAtUtc": "2026-08-14T01:34:35.000000Z",
        "externallySigned": False,
        "receiptSha256": None,
    }
    receipt["receiptSha256"] = canonical_sha(receipt)
    initial = initial_run_state(contract, fixture_tag)
    prepared_payload = {
        "queryId": "Q010-SC003-QUERY-001", "slotId": sample_slot["slotId"], "sequence": 1,
        "previousEventSha256": None, "templateId": sample_slot["templateId"],
        "requestAuthorityId": sample_slot["requestAuthorityId"], "publisherAuthorityId": sample_slot["publisherAuthorityId"],
        "transportId": sample_slot["transportId"], "requestRole": sample_slot["requestRole"], "sourceClass": sample_slot["sourceClass"],
        "method": "GET", "canonicalUri": fixture_uri, "bodySha256": sha256_bytes(b""),
        "allowlistedHeadersSha256": headers_sha, "requestCanonicalSha256": request_sha, "requestBytesSha256": request_bytes_sha,
        "requestPreparedAtUtc": "2026-08-14T01:34:36.000000Z", "preQueryRemoteHead": fixture_tag,
        "preQueryRemoteRef": contract["repository"]["remoteRef"], "preQueryRemoteObservedAtUtc": receipt["observedAtUtc"],
        "preQueryRemoteReceiptSha256": receipt["receiptSha256"], "budgetBefore": budget_snapshot(initial),
    }
    prepared_event = private_event("QUERY_PREPARED", prepared_payload, 1, None, prepared_payload["requestPreparedAtUtc"])
    parsed_fixture = parse_cdx_complete(fixture_raw, sample_slot)
    safe_fixture = cdx_safe_projection(parsed_fixture)
    response_payload = {
        "queryId": "Q010-SC003-QUERY-001", "sequence": 1, "previousEventSha256": prepared_event["eventSha256"],
        "requestStartedAtUtc": "2026-08-14T01:34:37.000000Z", "responseObservedAtUtc": "2026-08-14T01:34:38.000000Z",
        "responseSealPreparedAtUtc": "2026-08-14T01:34:39.000000Z", "httpStatusOrTypedError": 200,
        "redirectChain": [], "responseHeaderProjectionSha256": canonical_sha(sealed_response_header_projection(200, "application/json", parsed_fixture["singleReason"], [])),
        "responseBytes": len(fixture_raw), "responseSha256": fixture_blob_id, "mimeType": "application/json",
        "privateContentAddressedBlobId": fixture_blob_id, "projectionSchema": sample_slot["parserProjectionId"],
        "projectionSha256": canonical_sha(safe_fixture), "forbiddenFieldExposure": False,
        "disposition": "LOCATOR_COMPLETE_SELECTIONS_FROZEN", "singleReason": parsed_fixture["singleReason"],
        "budgetAfter": {"slotsTerminal": 1, "requestsUsed": 1, "responseBytes": len(fixture_raw), "acceptedPayloads": 0, "requestHardCap": 45, "privateRawBytesHardCap": 900000000, "acceptedPayloadHardCap": 30},
    }
    response_event = private_event("QUERY_RESPONSE_SEALED", response_payload, 2, prepared_event["eventSha256"], response_payload["responseSealPreparedAtUtc"])
    projection_record = {
        "schema": "early-detection-q010-sc003-safe-projection-record/v1", "sequence": 1,
        "previousProjectionRecordSha256": None, "queryId": "Q010-SC003-QUERY-001", "slotId": sample_slot["slotId"],
        "responseEventSequence": 2, "responseEventSha256": response_event["eventSha256"],
        "projectionSchema": sample_slot["parserProjectionId"], "projection": safe_fixture,
        "projectionSha256": canonical_sha(safe_fixture), "projectionRecordSha256": None,
    }
    projection_record["projectionRecordSha256"] = canonical_sha(projection_record)

    def fixture_materials(rows: list[dict], projections: list[dict] | None = None, receipts: dict[str, dict] | None = None, blobs: dict[str, bytes] | None = None) -> dict:
        projection_rows = [projection_record] if projections is None else projections
        receipt_rows = {receipt["queryId"]: receipt} if receipts is None else receipts
        blob_rows = {fixture_blob_id: fixture_raw} if blobs is None else blobs
        projection_raw = b"".join(canonical(row) + b"\n" for row in projection_rows)
        receipt_manifest = [{"queryId": key, "receiptRawSha256": canonical_sha(value), "receiptSha256": value["receiptSha256"]} for key, value in sorted(receipt_rows.items())]
        raw_manifest = [{"payloadSha256": key, "payloadBytes": len(value)} for key, value in sorted(blob_rows.items())]
        ledger_raw = b"".join(canonical(row) + b"\n" for row in rows)
        result = {"rows": rows, "ledgerRaw": ledger_raw, "projectionRows": projection_rows, "projectionRaw": projection_raw, "receipts": receipt_rows, "receiptManifest": receipt_manifest, "blobs": blob_rows, "rawManifest": raw_manifest, "runtimeBinding": fixture_binding}
        result["summary"] = material_summary(projection_rows, projection_raw, receipt_manifest, raw_manifest)
        return result

    materials = fixture_materials([prepared_event, response_event])
    replayed, replay_issues, pending = replay_private_ledger(contract, fixture_tag, materials)
    require(not replay_issues and pending is None and replayed["requestsUsed"] == 1 and replayed["terminalSlotIds"] == [sample_slot["slotId"]], "exact-schema ledger replay fixture failed")

    def locator_hold_replay_fixture(status: int, headers: list[tuple[str, str]], expected_reason: str) -> None:
        event_mime, header_hold = classify_response_headers(headers)
        parsed_hold = parse_locator_http_response(status, fixture_raw, sample_slot, header_hold)
        require(parsed_hold["singleReason"] == expected_reason and parsed_hold["completenessProven"] is False and parsed_hold["selected"] == [], "runtime locator HOLD classification drift")
        safe_hold = cdx_safe_projection(parsed_hold)
        held_response = copy.deepcopy(response_event)
        held_response["payload"].update({
            "httpStatusOrTypedError": status,
            "responseHeaderProjectionSha256": canonical_sha(sealed_response_header_projection(status, event_mime or "UNKNOWN", expected_reason, [])),
            "mimeType": event_mime or "UNKNOWN",
            "privateContentAddressedBlobId": None if expected_reason in ENCODING_HOLD_REASONS else fixture_blob_id,
            "projectionSha256": canonical_sha(safe_hold),
            "disposition": "WHOLE_UNIT_TYPED_HOLD",
            "singleReason": expected_reason,
        })
        held_response["eventSha256"] = event_self_sha256(held_response)
        held_projection = copy.deepcopy(projection_record)
        held_projection["responseEventSha256"] = held_response["eventSha256"]
        held_projection["projection"] = safe_hold
        held_projection["projectionSha256"] = canonical_sha(safe_hold)
        held_projection["projectionRecordSha256"] = None
        held_projection["projectionRecordSha256"] = canonical_sha(held_projection)
        held_blobs = {} if expected_reason in ENCODING_HOLD_REASONS else {fixture_blob_id: fixture_raw}
        held_materials = fixture_materials([prepared_event, held_response], projections=[held_projection], blobs=held_blobs)
        held_state, held_issues, held_pending = replay_private_ledger(contract, fixture_tag, held_materials)
        require(not held_issues and held_pending is None and held_state["selectedByUnit"][sample_slot["unitId"]] == [] and held_state["requestsUsed"] == 1 and sum(row["eventType"] == "QUERY_PREPARED" for row in held_materials["rows"]) == 1, "coherent locator HOLD replay derived a request or selection")

    locator_hold_replay_fixture(404, [("Content-Type", "application/json")], "HOLD_LOCATOR_HTTP_STATUS_NOT_EXACT_200")
    locator_hold_replay_fixture(500, [("Content-Type", "application/json")], "HOLD_LOCATOR_HTTP_STATUS_NOT_EXACT_200")
    for duplicate_headers, duplicate_reason in duplicate_header_fixtures:
        locator_hold_replay_fixture(200, duplicate_headers, duplicate_reason)

    typed_response = copy.deepcopy(response_event)
    typed_response["payload"].update({
        "httpStatusOrTypedError": "TYPED_ERROR_TIMEOUTERROR",
        "responseHeaderProjectionSha256": canonical_sha(sealed_response_header_projection("TYPED_ERROR_TIMEOUTERROR", "UNKNOWN", "TYPED_ERROR_TIMEOUTERROR", [])),
        "responseBytes": 0,
        "responseSha256": sha256_bytes(b""),
        "mimeType": "UNKNOWN",
        "privateContentAddressedBlobId": None,
        "projectionSha256": canonical_sha({}),
        "disposition": "TYPED_HOLD",
        "singleReason": "TYPED_ERROR_TIMEOUTERROR",
        "budgetAfter": {"slotsTerminal": 1, "requestsUsed": 1, "responseBytes": 0, "acceptedPayloads": 0, "requestHardCap": 45, "privateRawBytesHardCap": 900000000, "acceptedPayloadHardCap": 30},
    })
    typed_response["eventSha256"] = event_self_sha256(typed_response)
    typed_materials = fixture_materials([prepared_event, typed_response], projections=[], blobs={})
    typed_state, typed_issues, typed_pending = replay_private_ledger(contract, fixture_tag, typed_materials)
    require(not typed_issues and typed_pending is None and typed_state["requestsUsed"] == 1 and typed_materials["summary"]["projectionCount"] == 0, "typed transport error did not replay with exactly zero projections")

    derived_slot = contract["capturePlan"]["slotSchedule"][1]
    selected_row = parsed_fixture["selected"][0]
    derived_raw = b"opaque-derived-fixture"
    derived_blob_id = sha256_bytes(derived_raw)
    derived_uri = materialize_capture_uri(selected_row)
    derived_headers_sha, derived_request_sha, derived_request_bytes_sha = request_fingerprints("GET", derived_uri)
    receipt_two = copy.deepcopy(receipt)
    receipt_two.update({"queryId": "Q010-SC003-QUERY-002", "observedAtUtc": "2026-08-14T01:34:40.000000Z", "receiptSha256": None})
    receipt_two["receiptSha256"] = canonical_sha(receipt_two)
    prepared_two_payload = {
        "queryId": "Q010-SC003-QUERY-002", "slotId": derived_slot["slotId"], "sequence": 2,
        "previousEventSha256": response_event["eventSha256"], "templateId": derived_slot["templateId"],
        "requestAuthorityId": derived_slot["requestAuthorityId"], "publisherAuthorityId": derived_slot["publisherAuthorityId"],
        "transportId": derived_slot["transportId"], "requestRole": derived_slot["requestRole"], "sourceClass": derived_slot["sourceClass"],
        "method": "GET", "canonicalUri": derived_uri, "bodySha256": sha256_bytes(b""),
        "allowlistedHeadersSha256": derived_headers_sha, "requestCanonicalSha256": derived_request_sha, "requestBytesSha256": derived_request_bytes_sha,
        "requestPreparedAtUtc": "2026-08-14T01:34:41.000000Z", "preQueryRemoteHead": fixture_tag,
        "preQueryRemoteRef": contract["repository"]["remoteRef"], "preQueryRemoteObservedAtUtc": receipt_two["observedAtUtc"],
        "preQueryRemoteReceiptSha256": receipt_two["receiptSha256"], "budgetBefore": budget_snapshot(replayed),
    }
    prepared_two = private_event("QUERY_PREPARED", prepared_two_payload, 3, response_event["eventSha256"], prepared_two_payload["requestPreparedAtUtc"])
    derived_disposition = "QUARANTINED_HOLD"
    derived_reason = "HOLD_CDX_DIGEST_MISMATCH_EXACT_ENTITY_BYTES"
    captured_at = "2026-08-14T01:34:43.000000Z"
    derived_projection = {
        "httpStatus": 200, "mimeType": "application/pdf", "responseBytes": len(derived_raw),
        "responseSha256": derived_blob_id, "archiveObservationTimestampExact": selected_row["timestamp"],
        "retrievedAt": captured_at, "capturedAt": captured_at, "payloadCaptureDisposition": derived_disposition,
        "cdxDigestMatchBoolean": False, "inheritedPayloadDuplicateBoolean": False,
        "futureSourceRecordStatus": "NOT_CREATED_PENDING_SEPARATE_BLIND_DECISION",
    }
    derived_response_payload = {
        "queryId": "Q010-SC003-QUERY-002", "sequence": 2, "previousEventSha256": prepared_two["eventSha256"],
        "requestStartedAtUtc": "2026-08-14T01:34:42.000000Z", "responseObservedAtUtc": "2026-08-14T01:34:44.000000Z",
        "responseSealPreparedAtUtc": "2026-08-14T01:34:45.000000Z", "httpStatusOrTypedError": 200,
        "redirectChain": [], "responseHeaderProjectionSha256": canonical_sha(sealed_response_header_projection(200, "application/pdf", derived_reason, [])),
        "responseBytes": len(derived_raw), "responseSha256": derived_blob_id, "mimeType": "application/pdf",
        "privateContentAddressedBlobId": derived_blob_id, "projectionSchema": derived_slot["parserProjectionId"],
        "projectionSha256": canonical_sha(derived_projection), "forbiddenFieldExposure": False,
        "disposition": derived_disposition, "singleReason": derived_reason,
        "budgetAfter": {"slotsTerminal": 2, "requestsUsed": 2, "responseBytes": len(fixture_raw) + len(derived_raw), "acceptedPayloads": 0, "requestHardCap": 45, "privateRawBytesHardCap": 900000000, "acceptedPayloadHardCap": 30},
    }
    derived_response = private_event("QUERY_RESPONSE_SEALED", derived_response_payload, 4, prepared_two["eventSha256"], derived_response_payload["responseSealPreparedAtUtc"])
    derived_projection_record = {
        "schema": "early-detection-q010-sc003-safe-projection-record/v1", "sequence": 2,
        "previousProjectionRecordSha256": projection_record["projectionRecordSha256"], "queryId": "Q010-SC003-QUERY-002", "slotId": derived_slot["slotId"],
        "responseEventSequence": 4, "responseEventSha256": derived_response["eventSha256"], "projectionSchema": derived_slot["parserProjectionId"],
        "projection": derived_projection, "projectionSha256": canonical_sha(derived_projection), "projectionRecordSha256": None,
    }
    derived_projection_record["projectionRecordSha256"] = canonical_sha(derived_projection_record)
    derived_rows = [prepared_event, response_event, prepared_two, derived_response]
    derived_receipts = {receipt["queryId"]: receipt, receipt_two["queryId"]: receipt_two}
    derived_blobs = {fixture_blob_id: fixture_raw, derived_blob_id: derived_raw}
    derived_materials = fixture_materials(derived_rows, projections=[projection_record, derived_projection_record], receipts=derived_receipts, blobs=derived_blobs)
    derived_state, derived_issues, derived_pending = replay_private_ledger(contract, fixture_tag, derived_materials)
    require(not derived_issues and derived_pending is None and derived_state["requestsUsed"] == 2 and derived_state["acceptedPayloads"] == 0, "deterministic opaque projection replay fixture failed")

    def reject_coherent_opaque_projection_mutation(mutate: Callable[[dict], None], label: str) -> None:
        mutated_response = copy.deepcopy(derived_response)
        mutated_record = copy.deepcopy(derived_projection_record)
        mutate(mutated_record["projection"])
        mutated_record["projectionSha256"] = canonical_sha(mutated_record["projection"])
        mutated_response["payload"]["projectionSha256"] = mutated_record["projectionSha256"]
        mutated_response["eventSha256"] = event_self_sha256(mutated_response)
        mutated_record["responseEventSha256"] = mutated_response["eventSha256"]
        mutated_record["projectionRecordSha256"] = None
        mutated_record["projectionRecordSha256"] = canonical_sha(mutated_record)
        mutated_materials = fixture_materials([prepared_event, response_event, prepared_two, mutated_response], projections=[projection_record, mutated_record], receipts=derived_receipts, blobs=derived_blobs)
        try:
            replay_private_ledger(contract, fixture_tag, mutated_materials)
        except GateError:
            return
        fail(label + " coherent projection/event rehash survived replay")

    reject_coherent_opaque_projection_mutation(lambda value: value.__setitem__("futureSourceRecordStatus", "CREATED"), "future source-record status")
    reject_coherent_opaque_projection_mutation(lambda value: value.pop("futureSourceRecordStatus"), "deleted future source-record status")
    reject_coherent_opaque_projection_mutation(lambda value: value.__setitem__("retrievedAt", "2026-08-14T01:34:43.500000Z"), "retrieved/captured timestamp divergence")

    def persisted_fixture(replay_state: dict) -> dict:
        stored = copy.deepcopy(replay_state)
        if stored["lastResponseEventSequence"]:
            stored["lastResponseLedgerFsyncConfirmedAtUtc"] = "2026-08-14T01:34:40.000000Z"
        if stored["lastDurableEventSequence"]:
            stored["lastDurableLedgerFsyncConfirmedAtUtc"] = "2026-08-14T01:34:40.000000Z"
        stored["runStateSelfSha256"] = None
        stored["runStateSelfSha256"] = canonical_sha(stored)
        return stored

    persisted = persisted_fixture(replayed)
    validate_run_state_against_replay(contract, fixture_tag, persisted, replayed, [], None)
    forged_state = copy.deepcopy(persisted)
    forged_state["requestsUsed"] = 9
    forged_state["budgetAfter"]["requestsUsed"] = 9
    forged_state["runStateSelfSha256"] = None
    forged_state["runStateSelfSha256"] = canonical_sha(forged_state)
    try:
        validate_run_state_against_replay(contract, fixture_tag, forged_state, replayed, [], None)
    except GateError:
        pass
    else:
        fail("coherently rehashed run-state forge survived exact replay")

    missing_projection = fixture_materials([prepared_event, response_event], projections=[])
    missing_projection_replay, missing_projection_issues, missing_projection_pending = replay_private_ledger(contract, fixture_tag, missing_projection)
    require("HOLD_RESPONSE_PROJECTION_MISSING" in missing_projection_issues, "missing projection did not type HOLD")
    try:
        validate_run_state_against_replay(contract, fixture_tag, persisted, missing_projection_replay, missing_projection_issues, missing_projection_pending)
    except RuntimeIncident:
        pass
    else:
        fail("missing projection did not stop before next request")
    missing_receipt = fixture_materials([prepared_event, response_event], receipts={})
    _, missing_receipt_issues, _ = replay_private_ledger(contract, fixture_tag, missing_receipt)
    require("HOLD_REQUEST_RECEIPT_MISSING" in missing_receipt_issues, "missing receipt did not type HOLD")

    def incident_completion_restart_fixture(crashed: dict, expected_issue: str, join_surface: str) -> dict:
        crashed_state, crashed_issues, crashed_pending = replay_private_ledger(contract, fixture_tag, crashed)
        require(expected_issue in crashed_issues and crashed_state["requestsUsed"] == 1, "restart fixture did not expose the frozen crash gap")
        rows_before = crashed["rows"]
        incident = private_event(
            "GLOBAL_INCIDENT",
            {"singleReason": expected_issue, "reconstructionForbidden": True, "sourceRequestsAfterIncident": 0},
            len(rows_before) + 1,
            rows_before[-1]["eventSha256"],
            "2026-08-14T01:34:50.000000Z",
        )
        incident_materials_local = fixture_materials(
            [*rows_before, incident],
            projections=crashed["projectionRows"], receipts=crashed["receipts"], blobs=crashed["blobs"],
        )
        incident_replay, incident_issues_local, incident_pending_local = replay_private_ledger(contract, fixture_tag, incident_materials_local)
        require(incident_pending_local is None and incident_replay["incident"] == expected_issue and expected_issue in incident_issues_local, "restart did not durably terminalize the material incident")
        join_binding = material_join_binding(incident_materials_local["rows"], incident_materials_local)
        require(join_binding["joinStatus"] == "INCIDENT_MISMATCH_BOUND" and join_binding[join_surface]["missing"]["count"] == 1, "incident completion did not bind the exact missing-material set")
        pre = pre_completion_event_binding(
            contract, incident_replay, incident_materials_local["ledgerRaw"], incident_materials_local["rows"], incident_materials_local
        )
        metrics_local = completion_metrics(contract, incident_replay)
        require(pre["completionStatus"] == "TYPED_GLOBAL_HOLD_COMPLETED", "incident completion did not select the typed global HOLD status")
        completed = private_event(
            "RUN_COMPLETED",
            {"completionStatus": pre["completionStatus"], **metrics_local, "preCompletionEventBinding": pre, "researchSourceAccessAuthorized": False, "scientificCredit": "NONE", "nextQ010SubchunkAuthorized": False},
            len(incident_materials_local["rows"]) + 1,
            incident["eventSha256"],
            "2026-08-14T01:34:51.000000Z",
        )
        completed_materials_local = fixture_materials(
            [*incident_materials_local["rows"], completed],
            projections=crashed["projectionRows"], receipts=crashed["receipts"], blobs=crashed["blobs"],
        )
        completed_replay_local, completed_issues_local, completed_pending_local = replay_private_ledger(contract, fixture_tag, completed_materials_local)
        require(completed_replay_local["completed"] and completed_pending_local is None and expected_issue in completed_issues_local, "incident RUN_COMPLETED did not replay to a terminal HOLD")
        stored_local = copy.deepcopy(completed_replay_local)
        if stored_local["lastResponseEventSequence"]:
            stored_local["lastResponseLedgerFsyncConfirmedAtUtc"] = "2026-08-14T01:34:55.000000Z"
        stored_local["lastDurableLedgerFsyncConfirmedAtUtc"] = "2026-08-14T01:34:55.000000Z"
        stored_local["runStateSelfSha256"] = None
        stored_local["runStateSelfSha256"] = canonical_sha(stored_local)
        validate_run_state_against_replay(contract, fixture_tag, stored_local, completed_replay_local, completed_issues_local, completed_pending_local)
        first_binding = completion_binding(contract, stored_local, completed_materials_local)
        restarted_replay, restarted_issues, restarted_pending = replay_private_ledger(contract, fixture_tag, completed_materials_local)
        validate_run_state_against_replay(contract, fixture_tag, stored_local, restarted_replay, restarted_issues, restarted_pending)
        second_binding = completion_binding(contract, stored_local, completed_materials_local)
        require(first_binding == second_binding and restarted_replay["requestsUsed"] == 1 and sum(row["eventType"] == "QUERY_PREPARED" for row in completed_materials_local["rows"]) == 1, "second incident restart was not request-free and binding-idempotent")

        forged_completed = copy.deepcopy(completed)
        forged_join = forged_completed["payload"]["preCompletionEventBinding"]["materialJoinBinding"]
        forged_join[join_surface]["missing"] = identifier_multiset_commitment([])
        forged_join[join_surface]["exact"] = True
        if join_surface == "rawBlobJoin":
            forged_join["rawBlobJoin"]["observed"] = copy.deepcopy(forged_join["rawBlobJoin"]["expected"])
            integrity = forged_join["responseBlobReferenceIntegrity"]
            integrity["observedPerQueryReferenceSha256"] = integrity["expectedPerQueryReferenceSha256"]
            integrity["missing"] = identifier_multiset_commitment([])
            integrity["mismatch"] = identifier_multiset_commitment([])
            integrity["extra"] = identifier_multiset_commitment([])
            integrity["exact"] = True
            integrity["bindingSha256"] = None
            integrity["bindingSha256"] = canonical_sha(integrity)
        forged_join["joinStatus"] = "EXACT"
        forged_join["bindingSha256"] = None
        forged_join["bindingSha256"] = canonical_sha(forged_join)
        forged_pre = forged_completed["payload"]["preCompletionEventBinding"]
        forged_pre["bindingSha256"] = None
        forged_pre["bindingSha256"] = canonical_sha(forged_pre)
        forged_completed["eventSha256"] = event_self_sha256(forged_completed)
        forged_materials = fixture_materials(
            [*incident_materials_local["rows"], forged_completed],
            projections=crashed["projectionRows"], receipts=crashed["receipts"], blobs=crashed["blobs"],
        )
        try:
            replay_private_ledger(contract, fixture_tag, forged_materials)
        except GateError:
            pass
        else:
            fail("coherently rehashed unbound material join survived RUN_COMPLETED replay")
        return first_binding

    prepared_without_receipt = fixture_materials([prepared_event], projections=[], receipts={}, blobs={})
    missing_receipt_binding = incident_completion_restart_fixture(prepared_without_receipt, "HOLD_REQUEST_RECEIPT_MISSING", "receiptJoin")
    missing_projection_binding = incident_completion_restart_fixture(missing_projection, "HOLD_RESPONSE_PROJECTION_MISSING", "projectionJoin")
    require(missing_receipt_binding["bindingSha256"] != missing_projection_binding["bindingSha256"], "distinct crash gaps collapsed to one Tag920 binding")

    null_blob_sha = "a" * 64
    null_blob_parsed = parse_cdx_complete(b"", sample_slot)
    null_blob_projection = cdx_safe_projection(null_blob_parsed)
    null_blob_response = copy.deepcopy(response_event)
    null_blob_response["payload"].update({
        "responseHeaderProjectionSha256": canonical_sha(sealed_response_header_projection(200, "application/json", null_blob_parsed["singleReason"], [])),
        "responseBytes": 5,
        "responseSha256": null_blob_sha,
        "privateContentAddressedBlobId": None,
        "projectionSha256": canonical_sha(null_blob_projection),
        "disposition": "WHOLE_UNIT_TYPED_HOLD",
        "singleReason": null_blob_parsed["singleReason"],
        "budgetAfter": {"slotsTerminal": 1, "requestsUsed": 1, "responseBytes": 5, "acceptedPayloads": 0, "requestHardCap": 45, "privateRawBytesHardCap": 900000000, "acceptedPayloadHardCap": 30},
    })
    null_blob_response["eventSha256"] = event_self_sha256(null_blob_response)
    null_blob_projection_record = copy.deepcopy(projection_record)
    null_blob_projection_record["responseEventSha256"] = null_blob_response["eventSha256"]
    null_blob_projection_record["projection"] = null_blob_projection
    null_blob_projection_record["projectionSha256"] = canonical_sha(null_blob_projection)
    null_blob_projection_record["projectionRecordSha256"] = None
    null_blob_projection_record["projectionRecordSha256"] = canonical_sha(null_blob_projection_record)
    null_blob_materials = fixture_materials([prepared_event, null_blob_response], projections=[null_blob_projection_record], blobs={})
    null_blob_state, null_blob_issues, null_blob_pending = replay_private_ledger(contract, fixture_tag, null_blob_materials)
    null_blob_join = material_join_binding(null_blob_materials["rows"], null_blob_materials)
    require("HOLD_RESPONSE_NONEMPTY_WITHOUT_BLOB_REFERENCE" in null_blob_issues and null_blob_pending is None and null_blob_state["requestsUsed"] == 1, "nonempty null-id Response did not replay as a typed material incident")
    require(null_blob_join["joinStatus"] == "INCIDENT_MISMATCH_BOUND", "nonempty null-id Response incorrectly produced an exact material join")
    require(null_blob_join["rawBlobJoin"]["missing"] == identifier_multiset_commitment([null_blob_sha]), "responseSha256 was not bound into the physical raw-blob missing set")
    require(null_blob_join["responseBlobReferenceIntegrity"]["missing"] == identifier_multiset_commitment([prepared_payload["queryId"]]), "null blobId was not bound as a per-query reference-integrity gap")
    null_blob_binding = incident_completion_restart_fixture(null_blob_materials, "HOLD_RESPONSE_NONEMPTY_WITHOUT_BLOB_REFERENCE", "rawBlobJoin")
    require(null_blob_binding["materialJoinBinding"]["responseBlobReferenceIntegrity"]["exact"] is False, "incident Tag920 binding lost the null-id reference-integrity gap")
    extra_blob = fixture_materials([prepared_event, response_event], blobs={fixture_blob_id: fixture_raw, sha256_bytes(b"extra"): b"extra"})
    _, extra_blob_issues, _ = replay_private_ledger(contract, fixture_tag, extra_blob)
    require("HOLD_EXTRA_OR_UNREFERENCED_RAW_BLOB" in extra_blob_issues, "extra raw blob did not type HOLD")
    forged_blob = fixture_materials([prepared_event, response_event], blobs={fixture_blob_id: b"forged"})
    try:
        replay_private_ledger(contract, fixture_tag, forged_blob)
    except GateError:
        pass
    else:
        fail("raw blob content forge survived response replay")
    forged_projection_record = copy.deepcopy(projection_record)
    forged_projection_record["projection"]["returnedRowCount"] = 999
    forged_projection_record["projectionSha256"] = canonical_sha(forged_projection_record["projection"])
    forged_projection_record["projectionRecordSha256"] = None
    forged_projection_record["projectionRecordSha256"] = canonical_sha(forged_projection_record)
    forged_projection = fixture_materials([prepared_event, response_event], projections=[forged_projection_record])
    try:
        replay_private_ledger(contract, fixture_tag, forged_projection)
    except GateError:
        pass
    else:
        fail("coherently rehashed projection forge survived raw replay")
    encoded_response = copy.deepcopy(response_event)
    encoded_response["payload"]["singleReason"] = "HOLD_UNEXPECTED_CONTENT_ENCODING"
    encoded_response["eventSha256"] = event_self_sha256(encoded_response)
    encoded_projection = copy.deepcopy(projection_record)
    encoded_projection["responseEventSha256"] = encoded_response["eventSha256"]
    encoded_projection["projectionRecordSha256"] = None
    encoded_projection["projectionRecordSha256"] = canonical_sha(encoded_projection)
    try:
        replay_private_ledger(contract, fixture_tag, fixture_materials([prepared_event, encoded_response], projections=[encoded_projection]))
    except GateError:
        pass
    else:
        fail("unexpected content encoding retained a blob-id claim")
    one_row = [sample_rows[0], sample_rows[1]]
    require(len(parse_cdx_complete(json.dumps(one_row).encode("utf-8"), sample_slot)["selected"]) == 1 and contract["capturePlan"]["slotSchedule"][2]["derivedTargetRank"] == 2, "missing-rank HOLD fixture failed")
    old_start = "2026-08-13T00:00:00.000000Z"
    require((datetime.now(timezone.utc) - parse_utc(old_start)).total_seconds() > 1200, "20-minute unit HOLD fixture failed")
    hold_slot = contract["capturePlan"]["slotSchedule"][1]
    hold_event = private_event("DERIVED_SLOT_TYPED_HOLD", {"slotId": hold_slot["slotId"], "unitId": hold_slot["unitId"], "singleReason": "HOLD_UNIT_20_MINUTE_BUDGET_EXHAUSTED", "networkRequestMade": False, "scientificCredit": "NONE"}, 3, response_event["eventSha256"], "2026-08-14T01:34:41.000000Z")
    hold_materials = fixture_materials([prepared_event, response_event, hold_event])
    hold_replay, hold_issues, hold_pending = replay_private_ledger(contract, fixture_tag, hold_materials)
    try:
        validate_run_state_against_replay(contract, fixture_tag, persisted, hold_replay, hold_issues, hold_pending)
    except RuntimeIncident:
        pass
    else:
        fail("crash-after-hold stale state did not become global incident")
    try:
        validate_run_state_against_replay(contract, fixture_tag, initial, replayed, [], None)
    except RuntimeIncident:
        pass
    else:
        fail("crash-after-response stale state did not become global incident")
    incident_event = private_event("GLOBAL_INCIDENT", {"singleReason": "GLOBAL_INCIDENT_FIXTURE", "reconstructionForbidden": True, "sourceRequestsAfterIncident": 0}, 3, response_event["eventSha256"], "2026-08-14T01:34:41.000000Z")
    incident_materials = fixture_materials([prepared_event, response_event, incident_event])
    incident_state, incident_issues, incident_pending = replay_private_ledger(contract, fixture_tag, incident_materials)
    require(not incident_issues and incident_pending is None and incident_state["incident"] == "GLOBAL_INCIDENT_FIXTURE", "global incident replay fixture failed")
    try:
        validate_run_state_against_replay(contract, fixture_tag, persisted, incident_state, incident_issues, incident_pending)
    except RuntimeIncident as incident_crash:
        require(incident_crash.disposition == "FINALIZE_EXISTING_INCIDENT", "crash-after-incident would duplicate incident event")
    else:
        fail("crash-after-incident stale state was accepted")
    pre_binding = pre_completion_event_binding(contract, incident_state, incident_materials["ledgerRaw"], incident_materials["rows"], incident_materials)
    metrics = completion_metrics(contract, incident_state)
    completed_event = private_event("RUN_COMPLETED", {"completionStatus": pre_binding["completionStatus"], **metrics, "preCompletionEventBinding": pre_binding, "researchSourceAccessAuthorized": False, "scientificCredit": "NONE", "nextQ010SubchunkAuthorized": False}, 4, incident_event["eventSha256"], "2026-08-14T01:34:42.000000Z")
    completed_materials = fixture_materials([prepared_event, response_event, incident_event, completed_event])
    completed_replay, completed_issues, completed_pending = replay_private_ledger(contract, fixture_tag, completed_materials)
    require(completed_replay["completed"] and not completed_issues and completed_pending is None, "two-phase completion replay fixture failed")
    completed_stored = persisted_fixture(completed_replay)
    final_binding = completion_binding(contract, completed_stored, completed_materials)
    final_body = copy.deepcopy(final_binding)
    final_claim = final_body.pop("bindingSha256")
    final_body["bindingSha256"] = None
    require(canonical_sha(final_body) == final_claim and final_binding["projectionCount"] == 1 and final_binding["receiptCount"] == 1, "self-validating Tag920 final binding fixture failed")

    def success_fixture_time(step: int) -> str:
        base = datetime(2026, 8, 14, 2, 0, 0, tzinfo=timezone.utc).timestamp()
        return datetime.fromtimestamp(base + step, timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")

    success_rows: list[dict] = []
    success_projections: list[dict] = []
    success_receipts: dict[str, dict] = {}
    success_blobs: dict[str, bytes] = {}
    success_state = initial_run_state(contract, fixture_tag)
    success_payloads: dict[str, bytes] = {}
    success_selected: dict[str, list[dict]] = {}
    inherited_hashes = {row["payloadSha256"] for row in contract["sourcePolicy"]["inheritedTag914PayloadManifest"]}

    for ordinal, slot in enumerate(contract["capturePlan"]["slotSchedule"], 1):
        query_id = f"Q010-SC003-QUERY-{ordinal:03d}"
        unit_id = slot["unitId"]
        if slot["attemptOrdinal"] == 1:
            primary_raw = ("success-primary-" + unit_id).encode("ascii")
            success_payloads[unit_id] = primary_raw
            primary_digest = base64.b32encode(hashlib.sha1(primary_raw).digest()).decode("ascii").rstrip("=")
            secondary_digest = base64.b32encode(hashlib.sha1(("unused-secondary-" + unit_id).encode("ascii")).digest()).decode("ascii").rstrip("=")
            terms = [*slot["termExpression"], slot["rowTokenExpression"] or "full-census", unit_id]
            path_token = "-".join(quote(term, safe="") for term in terms)
            original_one = f"https://{slot['originalHost']}/{path_token}/rank-one"
            original_two = f"https://{slot['originalHost']}/{path_token}/rank-two"
            cdx_rows = [
                ["timestamp", "original", "statuscode", "mimetype", "digest"],
                ["20150101000000", original_one, "200", "text/html", primary_digest],
                ["20160101000000", original_two, "200", "text/html", secondary_digest],
            ]
            raw = json.dumps(cdx_rows, separators=(",", ":")).encode("utf-8")
            parsed_success = parse_cdx_complete(raw, slot)
            require(parsed_success["completenessProven"] and len(parsed_success["selected"]) == 2, "success fixture locator did not freeze two exact ranks")
            success_selected[unit_id] = parsed_success["selected"]
            uri = materialize_locator_uri(slot)
            projection_success = cdx_safe_projection(parsed_success)
            mime_success = "application/json"
            disposition_success = "LOCATOR_COMPLETE_SELECTIONS_FROZEN"
            reason_success = "LOCATOR_COMPLETE_TAKE2"
            accepted_increment = 0
        else:
            raw = success_payloads[unit_id]
            selected_success = success_selected[unit_id][(slot["derivedTargetRank"] or 1) - 1]
            uri = materialize_capture_uri(selected_success)
            payload_sha_success = sha256_bytes(raw)
            cdx_match_success = exact_entity_digest_matches(raw, selected_success["digest"])
            inherited_success = payload_sha_success in inherited_hashes
            duplicate_current_success = payload_sha_success in success_state["seenPayloadSha256"]
            accepted_success = slot["derivedTargetRank"] == 1 and cdx_match_success and not inherited_success and not duplicate_current_success
            require((slot["derivedTargetRank"] == 1) == accepted_success, "success fixture acceptance/duplicate precondition drift")
            if accepted_success:
                disposition_success = "NEW_OPAQUE_PRIMARY_PUBLISHER_RAW_BYTES_CAPTURED_DIGEST_MATCHED_NO_SOURCE_RECORD_ENTITY_TEL_CANDIDATE_OR_SCIENTIFIC_CREDIT"
                reason_success = "RAW_CAPTURE_ACCEPTED_UNCODED_NO_CREDIT"
                accepted_increment = 1
            else:
                require(duplicate_current_success, "second derived response did not exercise current-run content-addressed duplicate")
                disposition_success = "SC003_DUPLICATE_REFERENCE_ONLY"
                reason_success = "DUPLICATE_SC003_NO_ADDITIONAL_SUCCESS"
                accepted_increment = 0
            captured_success = success_fixture_time(ordinal * 10 + 4)
            projection_success = {
                "httpStatus": 200, "mimeType": "application/pdf", "responseBytes": len(raw),
                "responseSha256": payload_sha_success, "archiveObservationTimestampExact": selected_success["timestamp"],
                "retrievedAt": captured_success, "capturedAt": captured_success,
                "payloadCaptureDisposition": disposition_success, "cdxDigestMatchBoolean": cdx_match_success,
                "inheritedPayloadDuplicateBoolean": inherited_success,
                "futureSourceRecordStatus": "NOT_CREATED_PENDING_SEPARATE_BLIND_DECISION",
            }
            mime_success = "application/pdf"

        receipt_success = copy.deepcopy(receipt)
        receipt_success.update({"queryId": query_id, "observedAtUtc": success_fixture_time(ordinal * 10), "receiptSha256": None})
        receipt_success["receiptSha256"] = canonical_sha(receipt_success)
        success_receipts[query_id] = receipt_success
        headers_success, request_success, request_bytes_success = request_fingerprints("GET", uri)
        prepared_success_payload = {
            "queryId": query_id, "slotId": slot["slotId"], "sequence": ordinal,
            "previousEventSha256": success_rows[-1]["eventSha256"] if success_rows else None,
            "templateId": slot["templateId"], "requestAuthorityId": slot["requestAuthorityId"],
            "publisherAuthorityId": slot["publisherAuthorityId"], "transportId": slot["transportId"],
            "requestRole": slot["requestRole"], "sourceClass": slot["sourceClass"], "method": "GET",
            "canonicalUri": uri, "bodySha256": sha256_bytes(b""), "allowlistedHeadersSha256": headers_success,
            "requestCanonicalSha256": request_success, "requestBytesSha256": request_bytes_success,
            "requestPreparedAtUtc": success_fixture_time(ordinal * 10 + 1), "preQueryRemoteHead": fixture_tag,
            "preQueryRemoteRef": contract["repository"]["remoteRef"], "preQueryRemoteObservedAtUtc": receipt_success["observedAtUtc"],
            "preQueryRemoteReceiptSha256": receipt_success["receiptSha256"], "budgetBefore": budget_snapshot(success_state),
        }
        prepared_success = private_event(
            "QUERY_PREPARED", prepared_success_payload, len(success_rows) + 1,
            success_rows[-1]["eventSha256"] if success_rows else None, prepared_success_payload["requestPreparedAtUtc"],
        )
        response_sha_success = sha256_bytes(raw)
        require(response_sha_success not in inherited_hashes, "success fixture accidentally collided with inherited Tag914 content")
        success_blobs.setdefault(response_sha_success, raw)
        require(success_blobs[response_sha_success] == raw, "content-addressed success fixture collision")
        budget_after_success = {
            "slotsTerminal": len(success_state["terminalSlotIds"]) + 1,
            "requestsUsed": success_state["requestsUsed"] + 1,
            "responseBytes": success_state["responseBytes"] + len(raw),
            "acceptedPayloads": success_state["acceptedPayloads"] + accepted_increment,
            "requestHardCap": 45, "privateRawBytesHardCap": 900000000, "acceptedPayloadHardCap": 30,
        }
        response_success_payload = {
            "queryId": query_id, "sequence": ordinal, "previousEventSha256": prepared_success["eventSha256"],
            "requestStartedAtUtc": success_fixture_time(ordinal * 10 + 2),
            "responseObservedAtUtc": success_fixture_time(ordinal * 10 + 5),
            "responseSealPreparedAtUtc": success_fixture_time(ordinal * 10 + 6), "httpStatusOrTypedError": 200,
            "redirectChain": [],
            "responseHeaderProjectionSha256": canonical_sha(sealed_response_header_projection(200, mime_success, reason_success, [])),
            "responseBytes": len(raw), "responseSha256": response_sha_success, "mimeType": mime_success,
            "privateContentAddressedBlobId": response_sha_success, "projectionSchema": slot["parserProjectionId"],
            "projectionSha256": canonical_sha(projection_success), "forbiddenFieldExposure": False,
            "disposition": disposition_success, "singleReason": reason_success, "budgetAfter": budget_after_success,
        }
        response_success = private_event(
            "QUERY_RESPONSE_SEALED", response_success_payload, len(success_rows) + 2,
            prepared_success["eventSha256"], response_success_payload["responseSealPreparedAtUtc"],
        )
        projection_success_record = {
            "schema": "early-detection-q010-sc003-safe-projection-record/v1", "sequence": len(success_projections) + 1,
            "previousProjectionRecordSha256": success_projections[-1]["projectionRecordSha256"] if success_projections else None,
            "queryId": query_id, "slotId": slot["slotId"], "responseEventSequence": response_success["sequence"],
            "responseEventSha256": response_success["eventSha256"], "projectionSchema": slot["parserProjectionId"],
            "projection": projection_success, "projectionSha256": canonical_sha(projection_success), "projectionRecordSha256": None,
        }
        projection_success_record["projectionRecordSha256"] = canonical_sha(projection_success_record)
        success_rows.extend([prepared_success, response_success])
        success_projections.append(projection_success_record)
        success_materials = fixture_materials(success_rows, projections=success_projections, receipts=success_receipts, blobs=success_blobs)
        success_state, success_issues, success_pending = replay_private_ledger(contract, fixture_tag, success_materials)
        require(not success_issues and success_pending is None, "45-slot success fixture failed incremental exact replay")

    require(success_state["acceptedPayloads"] == 15 and all(unit["acceptedPayloads"] == 1 for unit in success_state["units"].values()), "duplicate blob references received additional success credit")
    success_join = material_join_binding(success_rows, success_materials)
    require(success_join["joinStatus"] == "EXACT" and success_join["responseBlobReferenceMultiset"]["count"] > success_join["responseBlobReferenceMultiset"]["uniqueCount"], "content-addressed multiset references did not produce an exact physical blob join")
    success_pre = pre_completion_event_binding(contract, success_state, success_materials["ledgerRaw"], success_rows, success_materials)
    require(success_pre["completionStatus"] == contract["completionPolicy"]["successStatus"], "complete 45-slot fixture did not reach success completion")
    success_metrics = completion_metrics(contract, success_state)
    success_completed = private_event(
        "RUN_COMPLETED",
        {"completionStatus": success_pre["completionStatus"], **success_metrics, "preCompletionEventBinding": success_pre, "researchSourceAccessAuthorized": False, "scientificCredit": "NONE", "nextQ010SubchunkAuthorized": False},
        len(success_rows) + 1, success_rows[-1]["eventSha256"], "2026-08-14T03:00:00.000000Z",
    )
    success_completed_materials = fixture_materials([*success_rows, success_completed], projections=success_projections, receipts=success_receipts, blobs=success_blobs)
    success_completed_state, success_completed_issues, success_completed_pending = replay_private_ledger(contract, fixture_tag, success_completed_materials)
    require(success_completed_state["completed"] and not success_completed_issues and success_completed_pending is None, "successful content-addressed completion failed exact replay")
    success_stored = copy.deepcopy(success_completed_state)
    success_stored["lastResponseLedgerFsyncConfirmedAtUtc"] = "2026-08-14T03:00:01.000000Z"
    success_stored["lastDurableLedgerFsyncConfirmedAtUtc"] = "2026-08-14T03:00:01.000000Z"
    success_stored["runStateSelfSha256"] = None
    success_stored["runStateSelfSha256"] = canonical_sha(success_stored)
    validate_run_state_against_replay(contract, fixture_tag, success_stored, success_completed_state, success_completed_issues, success_completed_pending)
    success_binding_one = completion_binding(contract, success_stored, success_completed_materials)
    success_restart_state, success_restart_issues, success_restart_pending = replay_private_ledger(contract, fixture_tag, success_completed_materials)
    validate_run_state_against_replay(contract, fixture_tag, success_stored, success_restart_state, success_restart_issues, success_restart_pending)
    success_binding_two = completion_binding(contract, success_stored, success_completed_materials)
    require(success_binding_one == success_binding_two and success_restart_state["requestsUsed"] == 45, "successful duplicate-blob restart was not binding-idempotent and request-free")

    forged_success_completed = copy.deepcopy(success_completed)
    forged_success_join = forged_success_completed["payload"]["preCompletionEventBinding"]["materialJoinBinding"]
    forged_success_join["responseBlobReferenceMultiset"] = identifier_multiset_commitment(sorted(set(
        row["payload"]["privateContentAddressedBlobId"] for row in success_rows
        if row["eventType"] == "QUERY_RESPONSE_SEALED" and row["payload"]["privateContentAddressedBlobId"] is not None
    )))
    forged_success_join["bindingSha256"] = None
    forged_success_join["bindingSha256"] = canonical_sha(forged_success_join)
    forged_success_pre = forged_success_completed["payload"]["preCompletionEventBinding"]
    forged_success_pre["bindingSha256"] = None
    forged_success_pre["bindingSha256"] = canonical_sha(forged_success_pre)
    forged_success_completed["eventSha256"] = event_self_sha256(forged_success_completed)
    forged_success_materials = fixture_materials([*success_rows, forged_success_completed], projections=success_projections, receipts=success_receipts, blobs=success_blobs)
    try:
        replay_private_ledger(contract, fixture_tag, forged_success_materials)
    except GateError:
        pass
    else:
        fail("coherently rehashed unbound response-blob multiset survived successful completion replay")
    paths = contract["repository"]["ownedPaths"]
    completion_post_fixture = classify_completion_snapshot(
        "9" * 40, "9" * 40, TAG919, TAG920_SUBJECT, [("M", path) for path in paths], False, paths
    ) == "COMPLETION_POST_INTRODUCTION"
    require(completion_post_fixture, "completion POST topology fixture failed")
    require(len(attacks) == 138, "self-test kill count drift")
    return {"status": "PASS", "kills": len(attacks), "resumeCrashCases": 11, "p0RuntimeFixtures": 45, "strictCompletionReplayFixtures": 2, "completionPostPhaseFixture": completion_post_fixture, "controllerChildExecutions": 0, "sourceRequests": source_requests}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["bootstrap", "self-test", "verify", "start", "run", "source"])
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
        if args.command in {"run", "source"}:
            result = run_capture(args.remote)
            print(json.dumps(result, sort_keys=True))
            return 0
        result = verify(args.remote)
        if args.command == "start":
            fail("SC003 is publicly completed; start/source runtime is permanently closed")
        print(json.dumps(result, sort_keys=True))
        return 0
    except (GateError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as exc:
        print(json.dumps({"status": "FAIL", "error": str(exc)}, sort_keys=True), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
