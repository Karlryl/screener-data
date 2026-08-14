#!/usr/bin/env python3
"""Fail-closed Tag922 decision-only checkpoint for the deferred SC004 methods path."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "research/early-detection-v4/q010-sc004-methods-path-deferred-governance-contract-v1.json"
EVENTS_PATH = ROOT / "state/early-detection-q010-sc004-methods-path-deferred-events-v1.jsonl"
STATE_PATH = ROOT / "state/early-detection-q010-sc004-methods-path-deferred-state-v1.json"
TEST_PATH = ROOT / "tests/early-detection-q010-sc004-methods-path-deferred-v1.test.js"

TAG921 = "d1768fe86422287b39fdf7b13531a8336cfe5f9b"
TAG920 = "8cca973274361b14dc0749f34b852d5c4423785a"
REMOTE_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
SUBJECT = "Tag 922: Q010-SC004 AI-Methodenpfad pausieren"
NEXT_SUBCHUNK = "Q010-SC005-PRE2021-MULTITHEME-TEL-CORPUS-DECISION"
NEXT_ACTION = "BUILD_SEPARATE_OUTCOME_INPUT_WITHHELD_PRE2021_PRIMARY_SOURCE_MULTITHEME_TEL_CORPUS_DECISION_BEFORE_ANY_SOURCE_ACCESS"
EVENT_TIME = "2026-08-14T11:07:18.0200887Z"
EVENT_ID = "Q010-SC004-DEFER-EVT-00000001"
EVENT_SHA256 = "5fe5aaea6dbe69c670554904db2209efb3e0efc40520e0b5b9650795495028a8"
EVENT_RAW_SHA256 = "a8152fab07f21908e15f90de435ae3eb99c30c1b0965e5bc36d159c10d782371"
EVENT_RAW_BYTES = 2141
FROZEN_STATIC_POLICY_SHA256 = "ed31701e40b73ac2bc8f9a4976a9e40aeeb2a92875c844998e4232fb07ab2823"
TAG921_COMMITTED_AT_UTC = "2026-08-14T05:32:18Z"

TAG921_BLOB_BINDINGS = [
    {"path":"research/early-detection-v4/q010-sc003-dmv7-balanced-tel-raw-capture-governance-contract-v1.json","gitBlobSha1":"9e86dc034e6ff707751d03142e0354e7967eaa81","rawSha256":"339cf43b6295b6798079e75d8978cb1056775b762252bafdc4662654d29802d6","rawBytes":123827},
    {"path":"scripts/early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-v1.py","gitBlobSha1":"406634b0a0f4361b1f4f63f7fea9c238d0987578","rawSha256":"d3bbe261d92aae44d705e8da7d875893dbe1de9a8cf918624594f54280a05b90","rawBytes":284451},
    {"path":"state/early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-events-v1.jsonl","gitBlobSha1":"2b0a261658701d93722e63251e216491f5fbfc46","rawSha256":"cd52579f0525587e37df4177d029c40af90ce70381b060a36550c5db5ddcf846","rawBytes":12295},
    {"path":"state/early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-state-v1.json","gitBlobSha1":"0dd277c20a0923ef8c11bb34ef9ed91769182c1b","rawSha256":"88ab45d4eb99393f5018839bf2aa68d0b190a7d820436dab3e9a6558d1d1a14e","rawBytes":7903},
    {"path":"tests/early-detection-q010-sc003-dmv7-balanced-tel-raw-capture-v1.test.js","gitBlobSha1":"d6618938dd69237ace71ebb415a26a6cf4aa6f6f","rawSha256":"84ea19e1cb4f40207b3779c23d45dd65ecfc8413c7cb3acbdf46554029245807","rawBytes":7619},
]
PRIOR_V4_GOVERNANCE_BINDING = {
    "tag911Commit":"ba90828892932147c93afe2040498116982bd416",
    "path":"state/early-detection-free-source-state-v23.json",
    "gitBlobSha1":"167566f732f4e2519909f72905cc8cfe36b453ce",
    "rawSha256":"29d40b8d2a34c8d2377b086ea92154ddbc41a72670bff79bd9b41922a1cb5297",
    "rawBytes":52300,
    "sourceJsonPointer":"operationalProjection.originalV4",
    "originalV4Protocol":"FEM-SEC-US@1.2.0",
    "originalV4GreenOfficialGates":2,
    "originalV4OfficialGateCount":13,
    "originalV4Complete":False,
    "originalV4ResultComputationAllowed":False,
    "originalV4OutcomesAccessed":False,
    "governanceBlobUnchangedAtTag921":True,
}

OWNED_PATHS = [
    "research/early-detection-v4/q010-sc004-methods-path-deferred-governance-contract-v1.json",
    "scripts/early-detection-q010-sc004-methods-path-deferred-v1.py",
    "state/early-detection-q010-sc004-methods-path-deferred-events-v1.jsonl",
    "state/early-detection-q010-sc004-methods-path-deferred-state-v1.json",
    "tests/early-detection-q010-sc004-methods-path-deferred-v1.test.js",
]
FORBIDDEN_COMMANDS = ["start", "source", "run", "packet", "open", "aggregate", "coding", "ai-run"]
HEX40 = re.compile(r"[0-9a-f]{40}")
HEX64 = re.compile(r"[0-9a-f]{64}")

TOP_KEYS = ["schema","createdAtUtc","purpose","frozenStaticPolicySha256","contractCoreSha256","contractSelfSha256","repository","parentTag921Binding","priorV4GovernanceBinding","decision","incumbentLocks","eventContract","stateContract","phasePolicy","hashPolicy","implementation"]
POLICY_KEYS = {
    "repository": ["worktree","branch","upstreamName","remoteUrl","remoteRef","baseCommit","expectedIntroductionSubject","expectedIntroductionPaths","introductionMustBeExactFiveAdditionsDirectChildOfBase","foreignUntrackedPathsIgnoredButNeverIntroduced"],
    "parentTag921Binding": ["commit","parentCommit","subject","committedAtUtc","introducedBlobBindings"],
    "priorV4GovernanceBinding": ["tag911Commit","path","gitBlobSha1","rawSha256","rawBytes","sourceJsonPointer","originalV4Protocol","originalV4GreenOfficialGates","originalV4OfficialGateCount","originalV4Complete","originalV4ResultComputationAllowed","originalV4OutcomesAccessed","governanceBlobUnchangedAtTag921"],
    "decision": ["subchunkId","decisionStatus","workDisposition","decisionRecordedAtUtc","decisionEffectiveOnlyAfterRemoteIntroduction","externalHumanCodersUnavailableExternallyReported","externalHumanCodersUnavailableMachineProven","assessedAiRunPathSlotCount","reasonCodes","toolFreeIsolationCapabilityStatus","humanAgreementGate","scientificCredit","candidateState","signalState","telFinalState","timeCapsuleState","prospectivePitVerified","outcomeBlindClaimed","packetOutcomeInputPolicy","modernModelCurrentKnowledgeContaminationStatus","originalV4Protocol","originalV4GreenOfficialGates","originalV4OfficialGateCount","originalV4Complete","originalV4ResultComputationAllowed","originalV4OutcomesAccessed","systemEstablished","workStarted","startAuthorized","sourceAccessAuthorized","packetAccessAuthorized","aiRunAuthorized","aggregationAuthorized","sourceRequests","aiRuns","priceReturnGqsOutcomeAccessed","sc004ResumeAuthorized","nextSubchunkId","nextAction","resumeOnlyAfterAll","resumeRequiresNewProspectiveRemoteDecision","currentTaskEndsAfterTag922CheckpointPostGates"],
    "incumbentLocks": ["sc001Tag914Commit","sc001HoldEffective","sc002Tag917Commit","sc002HoldEffective","sc003Tag920Commit","sc003Tag921VerificationRepairCommit","sc003TypedGlobalHoldCompletedEffective","q003State","q004State","q005State"],
    "eventContract": ["eventCount","eventId","eventType","eventCreatedAtUtc","eventSha256","eventFileRawSha256","eventFileRawBytes","eventSelfHashNormalization","eventLineRule","eventRewriteForbidden","event1LegacyToolFreeReasonCode","event1LegacyToolFreeReasonOperationalDisposition"],
    "stateContract": ["materializedAtUtc","eventCount","eventHeadSha256","stateSelfSha256","stateRawSha256"],
    "phasePolicy": ["verifyRequiresRemote","preIntroductionStatus","postIntroductionStatus","preIntroductionNextAuthorized","postIntroductionNextAuthorized","startAuthorizedAlways","sourceAccessAuthorizedAlways","packetAccessAuthorizedAlways","aiRunAuthorizedAlways","aggregationAuthorizedAlways","commitTimeSource","remoteObservedAtSource","tag921CommitAtOrBeforeDecisionRequired","tag922CommitAtOrAfterDecisionRequired","tag922CommitAtOrBeforeRemoteObservedRequired","forbiddenCommands"],
    "hashPolicy": ["canonicalJson","frozenStaticPolicyNormalization","contractCoreNormalization","contractSelfNormalization","stateSelfNormalization","duplicateJsonKeysForbidden","nonFiniteJsonNumbersForbidden"],
    "implementation": ["controllerPath","controllerRawSha256","eventsPath","eventsRawSha256","statePath","stateRawSha256","testPath","testRawSha256","controllerExecutesPredecessorControllers","sourceRequestsDuringBootstrapVerifySelfTest","aiRunsDuringBootstrapVerifySelfTest"],
}


class GovernanceError(RuntimeError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise GovernanceError(message)


def canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical_sha(value: object) -> str:
    return sha256_bytes(canonical(value))


def exact_keys(value: object, expected: list[str], label: str) -> None:
    require(isinstance(value, dict), f"{label} must be object")
    require(list(value.keys()) == expected, f"{label} exact key/order drift")


def strict_json_loads(text: str, label: str) -> object:
    def pairs_hook(pairs: list[tuple[str, object]]) -> dict:
        result: dict = {}
        for key, value in pairs:
            if key in result:
                raise GovernanceError(f"{label} duplicate JSON key: {key}")
            result[key] = value
        return result

    def reject_constant(value: str) -> None:
        raise GovernanceError(f"{label} non-finite JSON number: {value}")

    try:
        return json.loads(text, object_pairs_hook=pairs_hook, parse_constant=reject_constant)
    except json.JSONDecodeError as exc:
        raise GovernanceError(f"{label} invalid JSON") from exc


def parse_utc(value: str) -> datetime:
    require(isinstance(value, str) and value.endswith("Z"), "timestamp is not strict UTC")
    try:
        return datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as exc:
        raise GovernanceError("timestamp is not strict UTC") from exc


def validate_commit_causality(parent_at: str, decision_at: str, introduction_at: str | None = None, remote_observed_at: str | None = None) -> None:
    parent_time = parse_utc(parent_at)
    decision_time = parse_utc(decision_at)
    require(parent_time <= decision_time, "Tag921 commit is after Event1 decision")
    if introduction_at is None:
        require(remote_observed_at is None, "remote observation without Tag922 introduction")
        return
    require(remote_observed_at is not None, "Tag922 introduction lacks remote observation time")
    introduction_time = parse_utc(introduction_at)
    observed_time = parse_utc(remote_observed_at)
    require(decision_time <= introduction_time, "Tag922 commit backdates Event1 decision")
    require(introduction_time <= observed_time, "Tag922 commit is later than remote observation")


def expected_event() -> dict:
    payload = {
        "aggregationAuthorized": False, "aiRunAuthorized": False, "aiRuns": 0,
        "assessedAiRunPathSlotCount": 56, "candidateState": None,
        "currentTaskEndsAfterTag922CheckpointPostGates": True,
        "decisionStatus": "DEFERRED_METHODS_EXPLORATION",
        "externalHumanCodersUnavailableExternallyReported": True,
        "externalHumanCodersUnavailableMachineProven": False,
        "humanAgreementGate": "OPEN",
        "modernModelCurrentKnowledgeContaminationStatus": "UNRESOLVED",
        "nextAction": NEXT_ACTION, "nextSubchunkId": NEXT_SUBCHUNK,
        "originalV4Complete": False, "originalV4GreenOfficialGates": 2,
        "originalV4OfficialGateCount": 13, "originalV4OutcomesAccessed": False,
        "originalV4Protocol": "FEM-SEC-US@1.2.0", "originalV4ResultComputationAllowed": False,
        "outcomeBlindClaimed": False, "packetAccessAuthorized": False,
        "packetOutcomeInputPolicy": "NO_EXPLICIT_OUTCOME_INPUT_ONLY_TRUE_OUTCOME_BLINDNESS_NOT_CLAIMED",
        "priceReturnGqsOutcomeAccessed": False, "prospectivePitVerified": False,
        "q003State": "PAUSED_NONELIGIBLE", "q004State": "PAUSED_NONELIGIBLE", "q005State": "PAUSED_NONELIGIBLE",
        "reasonCodes": ["MARGINAL_NO_CREDIT_DIAGNOSTIC_BENEFIT_BELOW_NEXT_CORE_CORPUS","TOOL_FREE_ISOLATION_UNAVAILABLE","MODERN_MODEL_CURRENT_KNOWLEDGE_CONTAMINATION_UNRESOLVED"],
        "resumeOnlyAfterAll": ["CORE_CORPUS_EXISTS","STABLE_CODEBOOK_EXISTS","MACHINE_ENFORCEABLE_TOOL_MEMORY_EGRESS_ISOLATION_OR_HUMANS_AVAILABLE"],
        "resumeRequiresNewProspectiveRemoteDecision": True,
        "sc001HoldEffective": True, "sc002HoldEffective": True, "sc003TypedGlobalHoldCompletedEffective": True,
        "scientificCredit": "NONE", "signalState": None, "sourceAccessAuthorized": False,
        "sourceRequests": 0, "startAuthorized": False, "systemEstablished": False,
        "telFinalState": None, "timeCapsuleState": None, "workStarted": False,
    }
    event = {"createdAtUtc": EVENT_TIME, "eventId": EVENT_ID, "eventSha256": None,
             "eventType": "METHODS_PATH_DEFERRED_DECISION_RECORDED", "payload": payload,
             "schema": "early-detection-q010-sc004-methods-path-deferred-events/v1", "sequence": 1}
    event["eventSha256"] = canonical_sha(event)
    return event


EXPECTED_EVENT_RAW = canonical(expected_event()) + b"\n"


def frozen_static_policy_sha(contract: dict) -> str:
    body = copy.deepcopy(contract)
    body["frozenStaticPolicySha256"] = None
    body["contractCoreSha256"] = None
    body["contractSelfSha256"] = None
    body["stateContract"]["stateSelfSha256"] = None
    body["stateContract"]["stateRawSha256"] = None
    for key in ("controllerRawSha256", "eventsRawSha256", "stateRawSha256", "testRawSha256"):
        body["implementation"][key] = None
    return canonical_sha(body)


def contract_core_sha(contract: dict) -> str:
    body = copy.deepcopy(contract)
    body["contractCoreSha256"] = None
    body["contractSelfSha256"] = None
    body["stateContract"]["stateSelfSha256"] = None
    body["stateContract"]["stateRawSha256"] = None
    for key in ("controllerRawSha256", "eventsRawSha256", "stateRawSha256", "testRawSha256"):
        body["implementation"][key] = None
    return canonical_sha(body)


def contract_self_sha(contract: dict) -> str:
    body = copy.deepcopy(contract)
    body["contractSelfSha256"] = None
    return canonical_sha(body)


def validate_shapes(contract: dict) -> None:
    exact_keys(contract, TOP_KEYS, "contract")
    for key, keys in POLICY_KEYS.items():
        exact_keys(contract[key], keys, key)
    for index, binding in enumerate(contract["parentTag921Binding"]["introducedBlobBindings"]):
        exact_keys(binding, ["path","gitBlobSha1","rawSha256","rawBytes"], f"parent binding {index}")


def validate_contract(contract: dict, check_artifacts: bool = True) -> None:
    validate_shapes(contract)
    require(contract["schema"] == "early-detection-q010-sc004-methods-path-deferred-governance-contract/v1", "contract schema drift")
    require(contract["purpose"] == "Prospectively record a no-start methods-path deferral and route the next decision to the pre-2021 multitheme TEL corpus without source or model execution.", "purpose drift")
    require(contract["createdAtUtc"] == EVENT_TIME, "contract timestamp drift")
    require(frozen_static_policy_sha(contract) == contract["frozenStaticPolicySha256"] == FROZEN_STATIC_POLICY_SHA256, "frozen static policy hash drift")
    require(contract_core_sha(contract) == contract["contractCoreSha256"], "contract core hash drift")
    require(contract_self_sha(contract) == contract["contractSelfSha256"], "contract self hash drift")
    repository = contract["repository"]
    require(repository == {
        "worktree": str(ROOT), "branch": "codex/form25-v2-promotion-20260812",
        "upstreamName": "origin/codex/early-detection-v4-gates-20260810",
        "remoteUrl": "https://github.com/Karlryl/screener-data.git", "remoteRef": REMOTE_REF,
        "baseCommit": TAG921, "expectedIntroductionSubject": SUBJECT,
        "expectedIntroductionPaths": OWNED_PATHS,
        "introductionMustBeExactFiveAdditionsDirectChildOfBase": True,
        "foreignUntrackedPathsIgnoredButNeverIntroduced": True,
    }, "repository policy drift")
    parent = contract["parentTag921Binding"]
    require(parent["commit"] == TAG921 and parent["parentCommit"] == TAG920 and parent["subject"] == "Tag 921: Q010-SC003 Abschlussverifikation UTF-8 haerten" and parent["committedAtUtc"] == TAG921_COMMITTED_AT_UTC, "Tag921 binding drift")
    validate_commit_causality(parent["committedAtUtc"], EVENT_TIME)
    require(parent["introducedBlobBindings"] == TAG921_BLOB_BINDINGS, "Tag921 exact ordered blob binding drift")
    require(len({item["path"] for item in parent["introducedBlobBindings"]}) == 5, "Tag921 introduced paths not unique")
    require(contract["priorV4GovernanceBinding"] == PRIOR_V4_GOVERNANCE_BINDING, "prior V4 governance binding drift")
    decision = contract["decision"]
    require(decision["subchunkId"] == "Q010-SC-004-METHODS-PATH-DEFERRED" and decision["decisionStatus"] == "DEFERRED_METHODS_EXPLORATION" and decision["workDisposition"] == "NO_START", "decision status drift")
    require(decision["decisionRecordedAtUtc"] == EVENT_TIME and parse_utc(EVENT_TIME), "decision timestamp drift")
    require(decision["reasonCodes"] == ["MARGINAL_NO_CREDIT_DIAGNOSTIC_BENEFIT_BELOW_NEXT_CORE_CORPUS","TOOL_FREE_ISOLATION_NOT_MACHINE_VERIFIED_ESTABLISHED","MODERN_MODEL_CURRENT_KNOWLEDGE_CONTAMINATION_UNRESOLVED"], "deferral reasons drift")
    require(decision["toolFreeIsolationCapabilityStatus"] == "NOT_MACHINE_VERIFIED_ESTABLISHED", "tool-free isolation truth drift")
    require(decision["externalHumanCodersUnavailableExternallyReported"] is True and decision["externalHumanCodersUnavailableMachineProven"] is False and decision["assessedAiRunPathSlotCount"] == 56, "human/AI assessment truth drift")
    for key in ("decisionEffectiveOnlyAfterRemoteIntroduction", "resumeRequiresNewProspectiveRemoteDecision", "currentTaskEndsAfterTag922CheckpointPostGates"):
        require(decision[key] is True, f"decision gate relaxed: {key}")
    for key in ("prospectivePitVerified","outcomeBlindClaimed","systemEstablished","workStarted","startAuthorized","sourceAccessAuthorized","packetAccessAuthorized","aiRunAuthorized","aggregationAuthorized","priceReturnGqsOutcomeAccessed","sc004ResumeAuthorized"):
        require(decision[key] is False, f"false claim/authorization promoted: {key}")
    require(decision["sourceRequests"] == 0 and decision["aiRuns"] == 0 and decision["humanAgreementGate"] == "OPEN" and decision["scientificCredit"] == "NONE", "run/source/human/credit drift")
    require(all(decision[key] is None for key in ("candidateState","signalState","telFinalState","timeCapsuleState")), "candidate/signal/TEL/timecapsule promoted")
    require(decision["originalV4GreenOfficialGates"] == 2 and decision["originalV4OfficialGateCount"] == 13, "original V4 gate counts drift")
    require(decision["originalV4Protocol"] == "FEM-SEC-US@1.2.0", "original V4 protocol drift")
    require(decision["originalV4Complete"] is False and decision["originalV4ResultComputationAllowed"] is False and decision["originalV4OutcomesAccessed"] is False, "original V4 completion/result-computation/outcomes-access drift")
    require(decision["packetOutcomeInputPolicy"] == "NO_EXPLICIT_OUTCOME_INPUT_ONLY_TRUE_OUTCOME_BLINDNESS_NOT_CLAIMED" and decision["modernModelCurrentKnowledgeContaminationStatus"] == "UNRESOLVED", "outcome/current-knowledge overclaim")
    require(decision["nextSubchunkId"] == NEXT_SUBCHUNK and decision["nextAction"] == NEXT_ACTION, "next action drift")
    require(decision["resumeOnlyAfterAll"] == ["CORE_CORPUS_EXISTS","STABLE_CODEBOOK_EXISTS","MACHINE_ENFORCEABLE_TOOL_MEMORY_EGRESS_ISOLATION_OR_HUMANS_AVAILABLE"], "resume criterion drift")
    locks = contract["incumbentLocks"]
    require(locks["sc001Tag914Commit"] == "2d744159e4a001bfe1e2ff5b9d31113cbc347487" and locks["sc002Tag917Commit"] == "f606124109b71d20f3ecd555f501afb84d95446c" and locks["sc003Tag920Commit"] == TAG920 and locks["sc003Tag921VerificationRepairCommit"] == TAG921, "incumbent commit binding drift")
    require(locks["sc001HoldEffective"] is True and locks["sc002HoldEffective"] is True and locks["sc003TypedGlobalHoldCompletedEffective"] is True, "incumbent hold removed")
    require([locks["q003State"],locks["q004State"],locks["q005State"]] == ["PAUSED_NONELIGIBLE"] * 3, "Q003/Q004/Q005 eligibility drift")
    event_contract = contract["eventContract"]
    require(event_contract["eventCount"] == 1 and event_contract["eventId"] == EVENT_ID and event_contract["eventType"] == "METHODS_PATH_DEFERRED_DECISION_RECORDED" and event_contract["eventSha256"] == EVENT_SHA256, "event binding drift")
    require(event_contract["eventFileRawSha256"] == EVENT_RAW_SHA256 and event_contract["eventFileRawBytes"] == EVENT_RAW_BYTES and event_contract["eventRewriteForbidden"] is True, "event raw binding drift")
    require(event_contract["event1LegacyToolFreeReasonCode"] == "TOOL_FREE_ISOLATION_UNAVAILABLE" and event_contract["event1LegacyToolFreeReasonOperationalDisposition"] == "SUPERSEDED_BEFORE_ANY_START_BY_CONTRACT_NOT_MACHINE_VERIFIED_ESTABLISHED", "Event1 tool-free clarification drift")
    state_contract = contract["stateContract"]
    require(state_contract["materializedAtUtc"] == EVENT_TIME and state_contract["eventCount"] == 1 and state_contract["eventHeadSha256"] == EVENT_SHA256, "state contract drift")
    phase = contract["phasePolicy"]
    require(phase["verifyRequiresRemote"] is True and phase["preIntroductionStatus"] == "METHODS_PATH_DEFERRED_PRE_INTRODUCTION_DIAGNOSTIC" and phase["postIntroductionStatus"] == "PASS" and phase["preIntroductionNextAuthorized"] is False and phase["postIntroductionNextAuthorized"] is True, "phase/next gate drift")
    for key in ("startAuthorizedAlways","sourceAccessAuthorizedAlways","packetAccessAuthorizedAlways","aiRunAuthorizedAlways","aggregationAuthorizedAlways"):
        require(phase[key] is False, f"phase authorization drift: {key}")
    require(phase["forbiddenCommands"] == FORBIDDEN_COMMANDS, "forbidden commands drift")
    require(phase["commitTimeSource"] == "RAW_GIT_COMMITTER_EPOCH_SECONDS_NORMALIZED_UTC" and phase["remoteObservedAtSource"] == "CONTROLLER_UTC_AFTER_EXACT_LS_REMOTE_RESPONSE", "commit timing source drift")
    require(phase["tag921CommitAtOrBeforeDecisionRequired"] is True and phase["tag922CommitAtOrAfterDecisionRequired"] is True and phase["tag922CommitAtOrBeforeRemoteObservedRequired"] is True, "commit timing gate relaxed")
    require(contract["hashPolicy"] == {
        "canonicalJson":"UTF8_SORT_KEYS_TRUE_SEPARATORS_COMMA_COLON_ENSURE_ASCII_FALSE",
        "frozenStaticPolicyNormalization":"SET_FROZEN_STATIC_CORE_AND_SELF_TO_NULL;SET_STATE_SELF_AND_RAW_TO_NULL;SET_IMPLEMENTATION_RAW_HASHES_TO_NULL",
        "contractCoreNormalization":"SET_CONTRACT_CORE_AND_SELF_TO_NULL;SET_STATE_SELF_AND_RAW_TO_NULL;SET_IMPLEMENTATION_RAW_HASHES_TO_NULL",
        "contractSelfNormalization":"SET_CONTRACT_SELF_TO_NULL","stateSelfNormalization":"SET_STATE_SELF_TO_NULL",
        "duplicateJsonKeysForbidden":True,"nonFiniteJsonNumbersForbidden":True,
    }, "hash policy drift")
    if check_artifacts:
        implementation = contract["implementation"]
        require(implementation["controllerExecutesPredecessorControllers"] is False and implementation["sourceRequestsDuringBootstrapVerifySelfTest"] == 0 and implementation["aiRunsDuringBootstrapVerifySelfTest"] == 0, "implementation no-execution policy drift")
        expected_paths = OWNED_PATHS[1:]
        require([implementation["controllerPath"],implementation["eventsPath"],implementation["statePath"],implementation["testPath"]] == expected_paths, "implementation path drift")
        for path_key, hash_key in (("controllerPath","controllerRawSha256"),("eventsPath","eventsRawSha256"),("statePath","stateRawSha256"),("testPath","testRawSha256")):
            path = ROOT / implementation[path_key]
            require(path.is_file() and HEX64.fullmatch(implementation[hash_key]) is not None and sha256_bytes(path.read_bytes()) == implementation[hash_key], f"artifact raw drift: {path_key}")


def load_contract(check_artifacts: bool = True) -> dict:
    try:
        contract = strict_json_loads(CONTRACT_PATH.read_bytes().decode("utf-8", errors="strict"), "contract")
    except (OSError, UnicodeDecodeError) as exc:
        raise GovernanceError("contract is not strict UTF-8 JSON") from exc
    require(isinstance(contract, dict), "contract must be object")
    validate_contract(contract, check_artifacts=check_artifacts)
    return contract


def load_events(contract: dict) -> list[dict]:
    raw = EVENTS_PATH.read_bytes()
    require(raw == EXPECTED_EVENT_RAW and len(raw) == EVENT_RAW_BYTES and sha256_bytes(raw) == EVENT_RAW_SHA256, "immutable Event1 raw rewrite")
    event = strict_json_loads(raw[:-1].decode("utf-8", errors="strict"), "Event1")
    require(event == expected_event() and event["eventSha256"] == EVENT_SHA256, "Event1 semantic/selfhash drift")
    require(contract["eventContract"]["eventFileRawSha256"] == sha256_bytes(raw), "contract/Event1 divergence")
    return [event]


def replay_state(contract: dict, events: list[dict]) -> dict:
    decision = contract["decision"]
    projection = {
        "contractCoreSha256": contract["contractCoreSha256"], "decisionStatus": decision["decisionStatus"],
        "subchunkId": decision["subchunkId"], "workDisposition": "NO_START",
        "decisionRemoteIntroductionVerified": False, "nextAuthorized": False, "workStarted": False,
        "startAuthorized": False, "sourceAccessAuthorized": False, "packetAccessAuthorized": False,
        "aiRunAuthorized": False, "aggregationAuthorized": False,
        "externalHumanCodersUnavailableExternallyReported": True,
        "externalHumanCodersUnavailableMachineProven": False,
        "assessedAiRunPathSlotCount": 56, "sourceRequests": 0, "aiRuns": 0,
        "humanAgreementGate": "OPEN", "scientificCredit": "NONE",
        "candidateState": None, "signalState": None, "telFinalState": None, "timeCapsuleState": None,
        "prospectivePitVerified": False, "outcomeBlindClaimed": False,
        "priceReturnGqsOutcomeAccessed": False,
        "decisionEffectiveOnlyAfterRemoteIntroduction": True,
        "sc004ResumeAuthorized": False,
        "toolFreeIsolationCapabilityStatus": "NOT_MACHINE_VERIFIED_ESTABLISHED",
        "reasonCodes": ["MARGINAL_NO_CREDIT_DIAGNOSTIC_BENEFIT_BELOW_NEXT_CORE_CORPUS","TOOL_FREE_ISOLATION_NOT_MACHINE_VERIFIED_ESTABLISHED","MODERN_MODEL_CURRENT_KNOWLEDGE_CONTAMINATION_UNRESOLVED"],
        "modernModelCurrentKnowledgeContaminationStatus": "UNRESOLVED",
        "originalV4Protocol": "FEM-SEC-US@1.2.0",
        "originalV4GreenOfficialGates": 2, "originalV4OfficialGateCount": 13,
        "originalV4Complete": False, "originalV4ResultComputationAllowed": False, "originalV4OutcomesAccessed": False,
        "systemEstablished": False, "sc001HoldEffective": True, "sc002HoldEffective": True,
        "sc003TypedGlobalHoldCompletedEffective": True,
        "q003State": "PAUSED_NONELIGIBLE", "q004State": "PAUSED_NONELIGIBLE", "q005State": "PAUSED_NONELIGIBLE",
        "nextSubchunkId": NEXT_SUBCHUNK, "nextAction": NEXT_ACTION,
        "resumeOnlyAfterAll": ["CORE_CORPUS_EXISTS","STABLE_CODEBOOK_EXISTS","MACHINE_ENFORCEABLE_TOOL_MEMORY_EGRESS_ISOLATION_OR_HUMANS_AVAILABLE"],
        "resumeRequiresNewProspectiveRemoteDecision": True,
        "currentTaskEndsAfterTag922CheckpointPostGates": True,
        "priorV4GovernanceRawSha256": PRIOR_V4_GOVERNANCE_BINDING["rawSha256"],
    }
    state = {"schema":"early-detection-q010-sc004-methods-path-deferred-state/v1","materializedAtUtc":EVENT_TIME,"eventCount":1,"eventHeadSha256":events[0]["eventSha256"],"projection":projection,"stateSelfSha256":None}
    state["stateSelfSha256"] = canonical_sha(state)
    return state


def render_state(contract: dict) -> bytes:
    return json.dumps(replay_state(contract, [expected_event()]), ensure_ascii=False, indent=2).encode("utf-8") + b"\n"


def validate_materialized(contract: dict) -> tuple[list[dict], dict]:
    events = load_events(contract)
    expected = replay_state(contract, events)
    try:
        state = strict_json_loads(STATE_PATH.read_bytes().decode("utf-8", errors="strict"), "state")
    except (OSError, UnicodeDecodeError) as exc:
        raise GovernanceError("state is not strict UTF-8 JSON") from exc
    require(state == expected, "event-to-state replay drift")
    require(contract["stateContract"]["stateSelfSha256"] == state["stateSelfSha256"] and contract["stateContract"]["stateRawSha256"] == sha256_bytes(STATE_PATH.read_bytes()), "state hash binding drift")
    return events, state


def run_git_bytes(args: list[str]) -> bytes:
    result = subprocess.run(["git", *args], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if result.returncode != 0:
        raise GovernanceError(f"git {' '.join(args)} failed: {result.stderr.decode('utf-8', errors='replace').strip()}")
    return result.stdout


def run_git(args: list[str]) -> str:
    try:
        return run_git_bytes(args).decode("utf-8", errors="strict").strip()
    except UnicodeDecodeError as exc:
        raise GovernanceError("decision-relevant git stdout is not strict UTF-8") from exc


def raw_commit_subject(commit: str) -> str:
    raw = run_git_bytes(["cat-file", "commit", commit])
    separator = raw.find(b"\n\n")
    require(separator >= 0, "raw commit object malformed")
    try:
        return raw[separator + 2:].split(b"\n", 1)[0].decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise GovernanceError("commit subject is not strict UTF-8") from exc


def raw_commit_committed_at_utc(commit: str) -> str:
    raw = run_git_bytes(["cat-file", "commit", commit])
    committer_lines = [line for line in raw.splitlines() if line.startswith(b"committer ")]
    require(len(committer_lines) == 1, "raw commit committer line missing or ambiguous")
    match = re.search(rb" ([0-9]+) ([+-][0-9]{4})$", committer_lines[0])
    require(match is not None, "raw commit committer timestamp malformed")
    timestamp = datetime.fromtimestamp(int(match.group(1)), timezone.utc)
    return timestamp.strftime("%Y-%m-%dT%H:%M:%SZ")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def verify_parent(contract: dict) -> None:
    parent = contract["parentTag921Binding"]
    require(run_git(["show","-s","--format=%P",TAG921]) == TAG920, "Tag921 parent drift")
    require(raw_commit_subject(TAG921) == parent["subject"], "Tag921 subject drift")
    require(raw_commit_committed_at_utc(TAG921) == parent["committedAtUtc"] == TAG921_COMMITTED_AT_UTC, "Tag921 actual commit time drift")
    for binding in parent["introducedBlobBindings"]:
        spec = f"{TAG921}:{binding['path']}"
        require(run_git(["rev-parse", spec]) == binding["gitBlobSha1"], "Tag921 git blob drift")
        raw = run_git_bytes(["cat-file","blob",spec])
        require(len(raw) == binding["rawBytes"] and sha256_bytes(raw) == binding["rawSha256"], "Tag921 raw blob drift")
    prior = contract["priorV4GovernanceBinding"]
    prior_spec = f"{prior['tag911Commit']}:{prior['path']}"
    head_spec = f"{TAG921}:{prior['path']}"
    require(run_git(["rev-parse",prior_spec]) == prior["gitBlobSha1"] and run_git(["rev-parse",head_spec]) == prior["gitBlobSha1"], "prior V4 governance git blob drift")
    prior_raw = run_git_bytes(["cat-file","blob",prior_spec])
    require(len(prior_raw) == prior["rawBytes"] and sha256_bytes(prior_raw) == prior["rawSha256"], "prior V4 governance raw binding drift")
    try:
        prior_json = strict_json_loads(prior_raw.decode("utf-8", errors="strict"), "Tag911 governance state")
        original_v4 = prior_json["operationalProjection"]["originalV4"]
    except (UnicodeDecodeError, KeyError, TypeError) as exc:
        raise GovernanceError("Tag911 originalV4 governance pointer unavailable") from exc
    require(original_v4 == {"protocol":"FEM-SEC-US@1.2.0","greenOfficialGates":2,"officialGateCount":13,"complete":False,"resultComputationAllowed":False,"outcomesAccessed":False}, "Tag911 originalV4 six-value projection drift")


def owned_statuses() -> dict[str, str]:
    raw = run_git_bytes(["status","--porcelain=v1","-z","--untracked-files=all"])
    statuses: dict[str, str] = {}
    records = raw.split(b"\0")
    index = 0
    while index < len(records):
        record = records[index]
        if not record:
            index += 1
            continue
        require(len(record) >= 4, "git status record malformed")
        status = record[:2].decode("ascii", errors="strict")
        path = record[3:].decode("utf-8", errors="strict").replace("\\", "/")
        if status[0] in "RC":
            index += 1
        if path in OWNED_PATHS:
            statuses[path] = status
        index += 1
    return statuses


def remote_head() -> str:
    lines = run_git(["ls-remote","origin",REMOTE_REF]).splitlines()
    require(len(lines) == 1, "remote ref missing or ambiguous")
    fields = lines[0].split()
    require(len(fields) == 2 and fields[1] == REMOTE_REF and HEX40.fullmatch(fields[0]), "remote ref malformed")
    return fields[0]


def classify_phase(head: str, upstream: str, live: str, statuses: dict[str, str], parent: str | None, subject: str | None, delta: list[tuple[str, str]] | None) -> str:
    if head == upstream == live == TAG921 and statuses == {path: "??" for path in OWNED_PATHS}:
        return "PRE"
    if head == upstream == live and head != TAG921 and statuses == {} and parent == TAG921 and subject == SUBJECT and delta == [("A", path) for path in OWNED_PATHS]:
        return "POST"
    raise GovernanceError("snapshot is neither exact PRE nor exact POST introduction")


def verify(remote: bool) -> dict:
    require(remote, "verify requires --remote")
    contract = load_contract(check_artifacts=True)
    events, state = validate_materialized(contract)
    verify_parent(contract)
    repository = contract["repository"]
    require(run_git(["remote","get-url","origin"]) == repository["remoteUrl"], "origin remote URL drift")
    require(run_git(["branch","--show-current"]) == repository["branch"], "current branch drift")
    require(run_git(["rev-parse","--abbrev-ref","--symbolic-full-name","@{u}"]) == repository["upstreamName"], "upstream name drift")
    head = run_git(["rev-parse","HEAD"]); upstream = run_git(["rev-parse","@{u}"]); live = remote_head(); remote_observed_at = utc_now()
    statuses = owned_statuses(); parent = subject = None; delta = None
    if head != TAG921:
        parent = run_git(["show","-s","--format=%P",head]); subject = raw_commit_subject(head)
        delta = []
        for line in run_git(["diff-tree","--no-commit-id","--name-status","-r",head]).splitlines():
            fields = line.split("\t"); require(len(fields) == 2, "commit delta malformed")
            delta.append((fields[0], fields[1].replace("\\", "/")))
    phase = classify_phase(head, upstream, live, statuses, parent, subject, delta)
    post = phase == "POST"
    tag922_committed_at = raw_commit_committed_at_utc(head) if post else None
    validate_commit_causality(TAG921_COMMITTED_AT_UTC, EVENT_TIME, tag922_committed_at, remote_observed_at if post else None)
    if post:
        for path in OWNED_PATHS:
            require((ROOT / path).read_bytes() == run_git_bytes(["cat-file","blob",f"{head}:{path}"]), f"introduced/local byte drift: {path}")
    return {"schema":"early-detection-q010-sc004-methods-path-deferred-verify/v1","phase":phase,"status":contract["phasePolicy"]["postIntroductionStatus" if post else "preIntroductionStatus"],"head":head,"upstream":upstream,"liveRemote":live,"remoteObservedAtUtc":remote_observed_at,"tag921CommittedAtUtc":TAG921_COMMITTED_AT_UTC,"tag922CommittedAtUtc":tag922_committed_at,"decisionRemoteIntroductionVerified":post,"nextAuthorized":post,"nextSubchunkId":NEXT_SUBCHUNK if post else None,"startAuthorized":False,"sourceAccessAuthorized":False,"packetAccessAuthorized":False,"aiRunAuthorized":False,"aggregationAuthorized":False,"eventCount":len(events),"eventHeadSha256":events[0]["eventSha256"],"stateSelfSha256":state["stateSelfSha256"],"scientificCredit":"NONE","sourceRequests":0,"aiRuns":0}


def bootstrap() -> dict:
    contract = load_contract(check_artifacts=True)
    events, state = validate_materialized(contract)
    return {"schema":"early-detection-q010-sc004-methods-path-deferred-bootstrap/v1","status":"PASS","writePerformed":False,"contractCoreSha256":contract["contractCoreSha256"],"contractSelfSha256":contract["contractSelfSha256"],"eventsRawSha256":sha256_bytes(EVENTS_PATH.read_bytes()),"stateRawSha256":sha256_bytes(STATE_PATH.read_bytes()),"eventHeadSha256":events[0]["eventSha256"],"stateSelfSha256":state["stateSelfSha256"],"sourceRequests":0,"aiRuns":0}


def expect_rejected(contract: dict, label: str, mutator) -> None:
    changed = copy.deepcopy(contract); mutator(changed)
    changed["frozenStaticPolicySha256"] = None; changed["frozenStaticPolicySha256"] = frozen_static_policy_sha(changed)
    changed["contractCoreSha256"] = None; changed["contractCoreSha256"] = contract_core_sha(changed)
    changed["contractSelfSha256"] = None; changed["contractSelfSha256"] = contract_self_sha(changed)
    try:
        validate_contract(changed, check_artifacts=False)
    except GovernanceError:
        return
    raise GovernanceError(f"coherent mutation survived: {label}")


def self_test() -> dict:
    contract = load_contract(check_artifacts=True); events, state = validate_materialized(contract)
    mutations = [
        ("resume now", lambda c: c["decision"].__setitem__("startAuthorized", True)),
        ("credit", lambda c: c["decision"].__setitem__("scientificCredit", "METHODS")),
        ("green official gates", lambda c: c["decision"].__setitem__("originalV4GreenOfficialGates", 3)),
        ("official gate count", lambda c: c["decision"].__setitem__("originalV4OfficialGateCount", 12)),
        ("original V4 complete", lambda c: c["decision"].__setitem__("originalV4Complete", True)),
        ("original V4 protocol", lambda c: c["decision"].__setitem__("originalV4Protocol", "OTHER")),
        ("original V4 result computation", lambda c: c["decision"].__setitem__("originalV4ResultComputationAllowed", True)),
        ("original V4 outcomes accessed", lambda c: c["decision"].__setitem__("originalV4OutcomesAccessed", True)),
        ("system", lambda c: c["decision"].__setitem__("systemEstablished", True)),
        ("outcome blind", lambda c: c["decision"].__setitem__("outcomeBlindClaimed", True)),
        ("PIT", lambda c: c["decision"].__setitem__("prospectivePitVerified", True)),
        ("candidate", lambda c: c["decision"].__setitem__("candidateState", "CANDIDATE")),
        ("Q003 eligible", lambda c: c["incumbentLocks"].__setitem__("q003State", "ELIGIBLE")),
        ("next action", lambda c: c["decision"].__setitem__("nextAction", "RUN_AI")),
        ("next subchunk", lambda c: c["decision"].__setitem__("nextSubchunkId", "Q010-SC004")),
        ("reason removed", lambda c: c["decision"]["reasonCodes"].pop()),
        ("resume criterion", lambda c: c["decision"]["resumeOnlyAfterAll"].pop()),
        ("wrong parent", lambda c: c["repository"].__setitem__("baseCommit", TAG920)),
        ("wrong subject", lambda c: c["repository"].__setitem__("expectedIntroductionSubject", SUBJECT + "x")),
        ("path topology", lambda c: c["repository"]["expectedIntroductionPaths"].pop()),
        ("source request", lambda c: c["decision"].__setitem__("sourceRequests", 1)),
        ("AI run", lambda c: c["decision"].__setitem__("aiRuns", 1)),
        ("human machine proof", lambda c: c["decision"].__setitem__("externalHumanCodersUnavailableMachineProven", True)),
        ("hold removed", lambda c: c["incumbentLocks"].__setitem__("sc003TypedGlobalHoldCompletedEffective", False)),
        ("PRE next", lambda c: c["phasePolicy"].__setitem__("preIntroductionNextAuthorized", True)),
        ("top-level override", lambda c: c.__setitem__("sourceRecordCount", 1)),
        ("SC001 commit", lambda c: c["incumbentLocks"].__setitem__("sc001Tag914Commit", "a" * 40)),
        ("SC002 commit", lambda c: c["incumbentLocks"].__setitem__("sc002Tag917Commit", "b" * 40)),
        ("SC003 Tag920 commit", lambda c: c["incumbentLocks"].__setitem__("sc003Tag920Commit", "c" * 40)),
        ("SC003 Tag921 commit", lambda c: c["incumbentLocks"].__setitem__("sc003Tag921VerificationRepairCommit", "d" * 40)),
        ("PRE status", lambda c: c["phasePolicy"].__setitem__("preIntroductionStatus", "PASS")),
        ("POST status", lambda c: c["phasePolicy"].__setitem__("postIntroductionStatus", "DIAGNOSTIC")),
        ("event type", lambda c: c["eventContract"].__setitem__("eventType", "OTHER")),
        ("purpose", lambda c: c.__setitem__("purpose", "OTHER")),
        ("predecessor controller execution", lambda c: c["implementation"].__setitem__("controllerExecutesPredecessorControllers", True)),
        ("bootstrap source requests", lambda c: c["implementation"].__setitem__("sourceRequestsDuringBootstrapVerifySelfTest", 1)),
        ("bootstrap AI runs", lambda c: c["implementation"].__setitem__("aiRunsDuringBootstrapVerifySelfTest", 1)),
        ("prior V4 Tag911", lambda c: c["priorV4GovernanceBinding"].__setitem__("tag911Commit", "e" * 40)),
        ("prior V4 raw", lambda c: c["priorV4GovernanceBinding"].__setitem__("rawSha256", "f" * 64)),
        ("tool-free truth", lambda c: c["decision"].__setitem__("toolFreeIsolationCapabilityStatus", "AVAILABLE")),
        ("SC004 resume", lambda c: c["decision"].__setitem__("sc004ResumeAuthorized", True)),
        ("Tag921 blob reorder", lambda c: c["parentTag921Binding"]["introducedBlobBindings"].reverse()),
        ("Tag921 duplicate path", lambda c: c["parentTag921Binding"]["introducedBlobBindings"][1].__setitem__("path", c["parentTag921Binding"]["introducedBlobBindings"][0]["path"])),
        ("legacy tool-free phrase operative", lambda c: c["eventContract"].__setitem__("event1LegacyToolFreeReasonOperationalDisposition", "OPERATIVE")),
        ("Tag921 committed time", lambda c: c["parentTag921Binding"].__setitem__("committedAtUtc", "2026-08-14T05:32:17Z")),
        ("Tag922 backdating gate", lambda c: c["phasePolicy"].__setitem__("tag922CommitAtOrAfterDecisionRequired", False)),
        ("remote observation gate", lambda c: c["phasePolicy"].__setitem__("tag922CommitAtOrBeforeRemoteObservedRequired", False)),
    ]
    for label, mutator in mutations:
        expect_rejected(contract, label, mutator)
    try:
        strict_json_loads('{"startAuthorized":true,"startAuthorized":false}', "duplicate fixture")
    except GovernanceError:
        pass
    else:
        raise GovernanceError("duplicate JSON key survived")
    rewritten = EXPECTED_EVENT_RAW.replace(b'"workStarted":false', b'"workStarted":true ')
    require(rewritten != EXPECTED_EVENT_RAW and sha256_bytes(rewritten) != EVENT_RAW_SHA256, "Event rewrite fixture failed")
    pre = classify_phase(TAG921,TAG921,TAG921,{path:"??" for path in OWNED_PATHS},None,None,None)
    fake = "9" * 40
    post = classify_phase(fake,fake,fake,{},TAG921,SUBJECT,[("A",path) for path in OWNED_PATHS])
    require(pre == "PRE" and post == "POST", "phase fixtures failed")
    try:
        validate_commit_causality(TAG921_COMMITTED_AT_UTC, EVENT_TIME, "2026-08-14T11:07:17Z", "2026-08-14T11:08:00Z")
    except GovernanceError:
        pass
    else:
        raise GovernanceError("backdated Tag922 commit fixture survived")
    try:
        validate_commit_causality(TAG921_COMMITTED_AT_UTC, EVENT_TIME, "2026-08-14T11:08:00Z", "2026-08-14T11:07:59Z")
    except GovernanceError:
        pass
    else:
        raise GovernanceError("post-observation Tag922 commit fixture survived")
    require(state["projection"]["candidateState"] is None and state["projection"]["scientificCredit"] == "NONE", "state science lock drift")
    return {"schema":"early-detection-q010-sc004-methods-path-deferred-self-test/v1","status":"PASS","mutationKills":len(mutations)+4,"eventCount":len(events),"stateSelfSha256":state["stateSelfSha256"],"nextSubchunkId":NEXT_SUBCHUNK,"scientificCredit":"NONE","sourceRequests":0,"aiRuns":0}


def forbidden(command: str) -> None:
    raise GovernanceError(f"{command} is forbidden: Tag922 records DEFERRED_METHODS_EXPLORATION and authorizes no work")


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    verify_parser = sub.add_parser("verify"); verify_parser.add_argument("--remote", action="store_true")
    next_parser = sub.add_parser("next"); next_parser.add_argument("--remote", action="store_true")
    sub.add_parser("bootstrap"); sub.add_parser("self-test")
    for command in FORBIDDEN_COMMANDS:
        command_parser = sub.add_parser(command); command_parser.add_argument("--remote", action="store_true")
    args = parser.parse_args()
    try:
        if args.command == "verify":
            result = verify(args.remote)
        elif args.command == "next":
            snapshot = verify(args.remote)
            require(snapshot["phase"] == "POST" and snapshot["nextAuthorized"] is True, "next requires exact Tag922 remote POST introduction")
            result = {"schema":"early-detection-q010-sc004-methods-path-deferred-next/v1","status":"PASS","nextSubchunkId":NEXT_SUBCHUNK,"nextAction":NEXT_ACTION,"sourceAccessAuthorized":False,"scientificCredit":"NONE"}
        elif args.command == "bootstrap":
            result = bootstrap()
        elif args.command == "self-test":
            result = self_test()
        else:
            forbidden(args.command); return 2
    except GovernanceError as exc:
        print(json.dumps({"status":"FAIL_CLOSED","error":str(exc)}, separators=(",", ":")), file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
