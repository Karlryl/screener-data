#!/usr/bin/env python3
"""Replay-only, remote-gated controller for append-only operational state V20."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import subprocess
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "continuous-free-source-operational-state-contract-v20.json"
EVENTS = ROOT / "state" / "early-detection-free-source-events-v20.jsonl"
STATE = ROOT / "state" / "early-detection-free-source-state-v20.json"
TEST = ROOT / "tests" / "early-detection-continuous-free-source-v20.test.js"
V19_CONTROLLER = ROOT / "scripts" / "early-detection-continuous-free-source-v19.py"
V19_EVENTS = ROOT / "state" / "early-detection-free-source-events-v19.jsonl"
V19_STATE = ROOT / "state" / "early-detection-free-source-state-v19.json"
DESCRIPTION_VERIFIER = ROOT / "scripts" / "verify-sec-form25-finra-exact-description-bridge-disposition-v1.py"

REMOTE = "https://github.com/Karlryl/screener-data.git"
REF = "refs/heads/codex/early-detection-v4-gates-20260810"
BASE = "fed957d0a984f08918cabd19b6951d87a3c297a4"
CREATED_AT = "2026-08-13T12:15:02Z"
EXPECTED_CONTRACT_RAW = "4d3003d800fcc008d09c8c5580864f3c785f25cc7d053ba2d8f51754f29e6a48"
EXPECTED_CONTROLLER_NORMALIZED = "7ad2ad192146411ed8d5902f0f1424b70eb659028883c5dd09b2520d6a87ac1d"
EXPECTED_TEST_NORMALIZED = "c158fc4649be5bd5f1b628dd6ce7a973648bd5da822095c20dd96174a660b77a"
EXPECTED_EVENTS_RAW = "5fdcf15b333ef319bfc69c297d927a42d8a27dcb688327583d555c0a04f8650a"
EXPECTED_STATE_RAW = "44e9b09497040481b78739cb2fed6af3e6f097c559e4f962790b798317cce11e"
EXPECTED_STATE_SELF = "96a5bc6e1635a25627c610cc0a122a802c7f421fc03ebf7523b596ee9bcda9b8"
EXPECTED_PROJECTION_SHA = "bb16321ece1bbbc3353c86f234fbbe0dedb9bc4bff8192d4464d5d5f6c3dfabf"

AUTHORIZED = [
    "research/early-detection-v4/continuous-free-source-operational-state-contract-v20.json",
    "scripts/early-detection-continuous-free-source-v20.py",
    "state/early-detection-free-source-events-v20.jsonl",
    "state/early-detection-free-source-state-v20.json",
    "tests/early-detection-continuous-free-source-v20.test.js",
]
INPUT_PATHS = {
    "policy": "research/early-detection-v4/continuous-free-source-policy-v1.md",
    "queueSeed": "research/early-detection-v4/continuous-free-source-queue-seed-v1.json",
    "registry": "research/early-detection-v4/continuous-free-source-registry-v1.json",
    "v19Contract": "research/early-detection-v4/continuous-free-source-operational-state-contract-v19.json",
    "v19Controller": "scripts/early-detection-continuous-free-source-v19.py",
    "v19ControllerTest": "tests/early-detection-continuous-free-source-v19.test.js",
    "v19EventLog": "state/early-detection-free-source-events-v19.jsonl",
    "v19State": "state/early-detection-free-source-state-v19.json",
    "descriptionContract": "research/early-detection-v4/sec-form25-finra-exact-description-bridge-disposition-contract-v1.json",
    "descriptionVerifier": "scripts/verify-sec-form25-finra-exact-description-bridge-disposition-v1.py",
    "descriptionTest": "tests/verify-sec-form25-finra-exact-description-bridge-disposition-v1.test.js",
}
EXPECTED_INPUT_RAW = {
    "policy": "dd2acf4d50e324060ef2d8938a6f340e9f3ddabd9312be0d6e316ad0bf046b89",
    "queueSeed": "9d192851b4be9ee965a522dd67e2818ac807e220d1a982694dc61e141e9f7f3b",
    "registry": "d07ba18a969aced361fb638d52226f373ec64052dba30ddf36789a2a130a8927",
    "v19Contract": "ba35f9616cac19ca4b403533439d3fdf1a88d5d22fe786d573456996e1658cd8",
    "v19Controller": "09fa1af2cd60981a4e2a19963a1841dd9f7aae8389afd45c66d714c42800debf",
    "v19ControllerTest": "ff69914e8daf09e623e3907dd85620691fba5ad99bdb5123fd8d8db686bd7e6d",
    "v19EventLog": "c9851dca2c68582e0fd1a5fd9301d86e3bc18d5e968cb3b1b4d8d56f231edd1b",
    "v19State": "a241a9e77d1f49e2741ebab3b7f21fdf0025f71730abe5c341a648b7c2caafee",
    "descriptionContract": "7f74d85e8112fedc4181a936da09ae909f6c80564803076fb8e704e76c0c74e4",
    "descriptionVerifier": "fa29cf7b7f7aceebc7be4e13d7991c78b05edcc09e2e8bf8159c63719ff852dc",
    "descriptionTest": "886fa7f82aecd5df9e80b6e0571a179c235a2a3df7c03834abd5bd2e44a42236",
}
MILESTONE = {
    "tag": 891,
    "commit": BASE,
    "parent": "f5925ae8b5735f8119f3098ef5fdfe89628041b6",
    "subject": "Tag 891: FINRA-Beschreibungsbruecke fail-closed pruefen",
    "workstream": "Q003_FINRA_EXACT_DESCRIPTION_BRIDGE_NULL",
    "artifactCount": 3,
    "deltaSha256": "1d9cd3379577756157103182ffdca2fb160f2d5964e463ec2d4628ec1e5e08c0",
    "status": "OPERATIONAL_MILESTONE_NO_CREDIT",
}
EXPECTED_TASK_IDS = [
    "Q001-QUANTCONNECT-TERMS-ACCOUNT", "Q002-QUANTCONNECT-50-CASE-CONTRACT",
    "Q003-SEC-TERMINAL-WEALTH-QUEUE", "Q004-FINRA-OTC-CATALOG",
    "Q005-US-EXCHANGE-PUBLIC-CATALOGS", "Q006-TIINGO-FREE-ENTITLEMENT",
    "Q007-OPENFIGI-ANONYMOUS-HANDSHAKE", "Q008-BUSINESS-QUANT-FREE-HANDSHAKE",
    "Q009-ALPHA-VANTAGE-NEGATIVE-CONTROL", "Q010-RESEARCH-ARCHIVE-DISCOVERY",
]
SELF_NAMES = (
    "EXPECTED_CONTRACT_RAW", "EXPECTED_CONTROLLER_NORMALIZED", "EXPECTED_TEST_NORMALIZED",
    "EXPECTED_EVENTS_RAW", "EXPECTED_STATE_RAW", "EXPECTED_STATE_SELF", "EXPECTED_PROJECTION_SHA",
)


class StateError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise StateError(message)


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if type(value) is not dict or set(value) != expected:
        fail(f"{label} exact keys changed")


def normalized_python(raw: bytes) -> str:
    text = raw.decode("utf-8").replace("\r\n", "\n")
    for name in SELF_NAMES:
        text = re.sub(rf'({name}\s*=\s*")[^"]+("\s*)', rf'\g<1>{name}_NORMALIZED\g<2>', text)
    return sha(text.encode("utf-8"))


def normalized_test(raw: bytes) -> str:
    text = raw.decode("utf-8").replace("\r\n", "\n")
    for name in SELF_NAMES:
        text = re.sub(rf'(const {name}\s*=\s*\')[^\']+(\'\s*;)', rf'\g<1>{name}_NORMALIZED\g<2>', text)
    return sha(text.encode("utf-8"))


def git(*args: str) -> str:
    result = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    if result.returncode:
        fail(result.stderr.strip() or "Git binding failed")
    return result.stdout.strip()


def git_raw(commit: str, path: str) -> bytes:
    result = subprocess.run(["git", "show", f"{commit}:{path}"], cwd=ROOT, capture_output=True)
    if result.returncode:
        fail(f"Git blob missing: {path}")
    return result.stdout


def git_exists(commit: str, path: str) -> bool:
    return subprocess.run(
        ["git", "cat-file", "-e", f"{commit}:{path}"], cwd=ROOT,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    ).returncode == 0


def parse_events(raw: bytes, expected_count: int) -> list[dict[str, Any]]:
    rows = [json.loads(line) for line in raw.decode("utf-8").splitlines() if line]
    if len(rows) != expected_count:
        fail("event count changed")
    for index, row in enumerate(rows):
        body = copy.deepcopy(row)
        claim = body.pop("eventSha256", None)
        if claim != sha(canonical(body)) or row.get("sequence") != index + 1:
            fail("event self hash or sequence changed")
        expected_previous = None if index == 0 else rows[index - 1]["eventSha256"]
        if row.get("previousEventSha256") != expected_previous:
            fail("event hash chain changed")
    return rows


def delta(commit: str) -> tuple[list[dict[str, str]], str]:
    artifacts = []
    for line in git("diff-tree", "--no-commit-id", "--name-status", "-r", commit).splitlines():
        status, path = line.split("\t", 1)
        artifacts.append({"status": status, "path": path, "sha256": sha(git_raw(commit, path))})
    return artifacts, sha(canonical(artifacts))


def expected_projection() -> dict[str, Any]:
    projection = copy.deepcopy(json.loads(V19_STATE.read_bytes())["operationalProjection"])
    tasks = {task["taskId"]: task for task in projection["tasks"]}
    tasks["Q003-SEC-TERMINAL-WEALTH-QUEUE"]["milestoneRefs"].append(891)
    tasks["Q003-SEC-TERMINAL-WEALTH-QUEUE"]["nextAction"] = (
        "CONTINUE_PRIMARY_DOCUMENT_IDENTITY_LAST_SESSION_CORPORATE_ACTION_AND_TERMINAL_RECONCILIATION_"
        "AFTER_EXACT_FINRA_DESCRIPTION_BRIDGE_PRODUCED_TWO_AMBIGUOUS_EVENTS_FOR_ONE_SEC_EVENT_AND_ZERO_"
        "UNIQUE_CANDIDATES_WITH_ZERO_CREDIT"
    )
    projection["operationalMilestones"].append({
        key: MILESTONE[key] for key in
        ("tag", "commit", "parent", "subject", "workstream", "artifactCount", "status")
    })
    return projection


def validate_projection(projection: dict[str, Any]) -> dict[str, Any]:
    expected = expected_projection()
    if projection != expected or sha(canonical(projection)) != EXPECTED_PROJECTION_SHA:
        fail("operational projection changed")
    exact_keys(projection, {
        "taskCounts", "tasks", "q005Sublanes", "scheduler", "operationalMilestones",
        "milestoneClaimLocks", "lockedStudies", "originalV4", "scientificLocks",
    }, "projection")
    tasks = projection["tasks"]
    if [task.get("taskId") for task in tasks] != EXPECTED_TASK_IDS:
        fail("Q001-Q010 conservation changed")
    task_keys = {"taskId", "sourceId", "legacyV12State", "operationalState", "schedulerEligible", "priority", "milestoneRefs", "nextAction"}
    for task in tasks:
        exact_keys(task, task_keys, "task")
    counts = dict(Counter(task["operationalState"] for task in tasks))
    counts["RESOLVED"] = sum(task["operationalState"] == "RESOLVED" for task in tasks)
    if counts != projection["taskCounts"] or counts["RESOLVED"] != 0:
        fail("task counts or resolution credit changed")
    eligible = sorted(
        (task for task in tasks if task["schedulerEligible"] is True and task["operationalState"] == "AUTONOMOUS_OPEN"),
        key=lambda task: (-task["priority"], task["taskId"]),
    )
    eligible_ids = [task["taskId"] for task in eligible]
    blocked_ids = [task["taskId"] for task in tasks if task["taskId"] not in set(eligible_ids)]
    expected_scheduler = {
        "strategy": "HIGHEST_PRIORITY_AUTONOMOUS_OPEN_ONLY", "eligibleTaskIds": eligible_ids,
        "blockedTaskIds": blocked_ids, "nextTaskId": eligible_ids[0], "q002AutoNextForbidden": True,
    }
    if projection["scheduler"] != expected_scheduler or eligible_ids[0] != "Q003-SEC-TERMINAL-WEALTH-QUEUE":
        fail("scheduler changed")
    if len(projection["operationalMilestones"]) != 30 or projection["operationalMilestones"][-1]["tag"] != 891:
        fail("milestone conservation changed")
    if any(row["status"] not in {"OPERATIONAL_MILESTONE_NO_CREDIT", "SUPERSEDED_OPERATIONAL_ATTEMPT_NO_CREDIT"} for row in projection["operationalMilestones"]):
        fail("milestone credit changed")
    if any(value is not False for value in projection["milestoneClaimLocks"].values()):
        fail("milestone claim lock changed")
    if projection["originalV4"] != {
        "protocol": "FEM-SEC-US@1.2.0", "greenOfficialGates": 2, "officialGateCount": 13,
        "complete": False, "resultComputationAllowed": False, "outcomesAccessed": False,
    }:
        fail("Original V4 changed")
    locks = projection["scientificLocks"]
    if locks.get("studyCredit") != "NONE" or any(value is not False for key, value in locks.items() if key != "studyCredit"):
        fail("scientific lock changed")
    return {"eligibleTaskIds": eligible_ids, "nextTaskId": eligible_ids[0]}


def input_raw() -> dict[str, str]:
    actual = {key: sha((ROOT / path).read_bytes()) for key, path in INPUT_PATHS.items()}
    if actual != EXPECTED_INPUT_RAW:
        fail("input raw bytes changed")
    for key, path in INPUT_PATHS.items():
        if git_raw(BASE, path) != (ROOT / path).read_bytes():
            fail(f"input Git bytes changed: {key}")
    return actual


def input_bundle(actual: dict[str, str]) -> str:
    artifacts, digest = delta(BASE)
    if len(artifacts) != MILESTONE["artifactCount"] or digest != MILESTONE["deltaSha256"]:
        fail("Tag891 delta changed")
    if git("show", "-s", "--format=%P", BASE).split() != [MILESTONE["parent"]]:
        fail("Tag891 parent changed")
    if git("show", "-s", "--format=%s", BASE) != MILESTONE["subject"]:
        fail("Tag891 subject changed")
    return sha(canonical({"baseCommit": BASE, "inputRawSha256": actual, "milestoneDeltaSha256": [digest]}))


def expected_consumer() -> dict[str, Any]:
    return {
        "uniqueSuspensionEvents": 6366, "modernDescriptorEvents": 6361,
        "finraRows": 145103, "primaryCandidatePairs": 2,
        "primaryCandidateSecEvents": 1, "primaryCandidateFinraEvents": 2,
        "primaryUniqueSecEvents": 0, "studyCredit": "ZERO",
        "identityResolved": False, "outcomesAccessed": False,
    }


def verify_v19_remote() -> None:
    if sha(V19_CONTROLLER.read_bytes()) != EXPECTED_INPUT_RAW["v19Controller"]:
        fail("V19 controller changed before execution")
    result = subprocess.run(
        ["python", "-B", str(V19_CONTROLLER), "verify", "--remote"], cwd=ROOT,
        capture_output=True, text=True, timeout=240,
    )
    if result.returncode:
        fail("V19 remote verification failed")
    value = json.loads(result.stdout)
    if value.get("status") != "PASS" or value.get("nextTaskId") != "Q003-SEC-TERMINAL-WEALTH-QUEUE" or value.get("outcomesAccessed") is not False:
        fail("V19 predecessor semantics changed")


def verify_consumer_remote() -> None:
    if sha(DESCRIPTION_VERIFIER.read_bytes()) != EXPECTED_INPUT_RAW["descriptionVerifier"]:
        fail("description verifier changed before execution")
    result = subprocess.run(
        ["python", "-B", str(DESCRIPTION_VERIFIER), "verify", "--remote"], cwd=ROOT,
        capture_output=True, text=True, timeout=600,
    )
    if result.returncode:
        fail("exact description bridge remote verification failed")
    value = json.loads(result.stdout)
    rebuild = value.get("rebuild", {})
    primary = rebuild.get("primaryPost120", {})
    observed = {
        "uniqueSuspensionEvents": rebuild.get("uniqueSuspensionEvents"),
        "modernDescriptorEvents": rebuild.get("modernDescriptorEvents"),
        "finraRows": rebuild.get("finraRows"),
        "primaryCandidatePairs": primary.get("candidatePairs"),
        "primaryCandidateSecEvents": primary.get("candidateSecEvents"),
        "primaryCandidateFinraEvents": primary.get("candidateFinraEvents"),
        "primaryUniqueSecEvents": primary.get("secEventsWithExactlyOneFinraEvent"),
        "studyCredit": value.get("studyCredit"), "identityResolved": False,
        "outcomesAccessed": value.get("outcomesAccessed"),
    }
    observed["outcomesAccessed"] = value.get("outcomesAccessed")
    if value.get("status") != "PASS" or observed != expected_consumer():
        fail("exact description bridge consumer evidence changed")


def build_event(actual: dict[str, str], bundle: str) -> dict[str, Any]:
    previous = parse_events(V19_EVENTS.read_bytes(), 7)[-1]
    projection = expected_projection()
    event = {
        "sequence": 8, "eventId": "EVT-00000008",
        "eventType": "OPERATIONAL_MILESTONE_TAG891_EXACT_DESCRIPTION_BRIDGE_NULL",
        "createdAt": CREATED_AT, "agentId": "ROOT-CONTROLLER", "fencingToken": 0,
        "previousEventSha256": previous["eventSha256"], "inputBundleSha256": bundle,
        "payload": {
            "baseCommit": BASE, "milestone": copy.deepcopy(MILESTONE), "repositoryRemote": REMOTE,
            "sourceEventLogRawSha256": actual["v19EventLog"], "sourceStateRawSha256": actual["v19State"],
            "sourceStateSelfSha256": json.loads(V19_STATE.read_bytes())["stateSha256"],
            "sourceLastEventSha256": previous["eventSha256"], "replacementStatePath": AUTHORIZED[3],
            "supersessionReasonCode": "V19_POINTER_PREDATES_TAG891_EXACT_DESCRIPTION_BRIDGE_NULL",
            "v20EventCarriesCompleteOperationalProjection": True,
            "consumerVerification": expected_consumer(), "noScientificCredit": True,
            "outcomesAccessed": False, "operationalProjectionSha256": sha(canonical(projection)),
            "operationalProjection": projection,
        },
    }
    event["eventSha256"] = sha(canonical(event))
    return event


def materialize_state(event_raw: bytes, events: list[dict[str, Any]], actual: dict[str, str], bundle: str) -> dict[str, Any]:
    last = events[-1]
    expected = build_event(actual, bundle)
    if last != expected:
        fail("last event differs from deterministic reconstruction")
    projection = last["payload"]["operationalProjection"]
    validate_projection(projection)
    v19 = json.loads(V19_STATE.read_bytes())
    state = {
        "schema": "early-detection-free-source-operational-state/v20", "materializedAt": last["createdAt"],
        "track": "SHARED_OUTCOME_BLIND_INFRA",
        "purpose": "Deterministically replay Tag891 as an outcome-blind no-credit FINRA exact-description bridge null milestone while keeping Q003 unresolved.",
        "repository": {"remote": REMOTE, "ref": REF, "buildBaseCommit": BASE, "buildBaseTag": 891},
        "inputBundleSha256": bundle, "inputRawSha256": actual,
        "predecessor": {
            "version": 19, "contractPath": INPUT_PATHS["v19Contract"], "contractRawSha256": actual["v19Contract"],
            "controllerPath": INPUT_PATHS["v19Controller"], "controllerRawSha256": actual["v19Controller"],
            "testPath": INPUT_PATHS["v19ControllerTest"], "testRawSha256": actual["v19ControllerTest"],
            "eventLogPath": INPUT_PATHS["v19EventLog"], "eventLogRawSha256": actual["v19EventLog"],
            "statePath": INPUT_PATHS["v19State"], "stateRawSha256": actual["v19State"],
            "stateSelfSha256": v19["stateSha256"], "lastEventSha256": events[-2]["eventSha256"],
            "appendOnly": True, "remoteVerificationRequired": True,
            "semanticStatus": "SUPERSEDED_BY_TAG891_DESCRIPTION_NULL_V20",
        },
        "eventLog": {
            "path": AUTHORIZED[2], "eventCount": 8, "rawSha256": sha(event_raw),
            "lastEventSha256": last["eventSha256"], "v19ByteExactPrefix": True,
            "hashChainVerified": True, "fullProjectionCarriedByLastEvent": True,
        },
        "operationalProjection": projection,
    }
    state["stateSha256"] = sha(canonical(state))
    return state


def expected_scientific_locks() -> dict[str, Any]:
    return {
        "originalV4GreenOfficialGates": 2, "originalV4OfficialGateCount": 13,
        "originalV4Complete": False, "originalV4GateCredit": False, "identityResolved": False,
        "terminalWealthComplete": False, "fiveRequiredDataSemanticsComplete": False,
        "resultComputationAllowed": False, "pricesAccessed": False, "returnsAccessed": False,
        "outcomesAccessed": False,
    }


def load_contract(exact_artifact: bool = True) -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    if exact_artifact and sha(raw) != EXPECTED_CONTRACT_RAW:
        fail("V20 contract raw bytes changed")
    value = json.loads(raw)
    body = copy.deepcopy(value)
    claim = body.get("contractSelfSha256")
    body["contractSelfSha256"] = None
    if claim != sha(canonical(body)):
        fail("V20 contract self hash changed")
    exact_keys(value, {
        "schema", "createdAt", "track", "purpose", "contractSelfSha256", "repository", "inputs",
        "milestoneBinding", "implementation", "outputs", "replayContract", "scientificLocks",
    }, "contract")
    if value["schema"] != "early-detection-continuous-free-source-operational-state-contract/v20" or value["createdAt"] != CREATED_AT or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract identity or timeline changed")
    if datetime.fromisoformat(CREATED_AT.replace("Z", "+00:00")) > datetime.now(timezone.utc):
        fail("contract createdAt is future")
    if value["purpose"] != "Append Tag891 as an exact no-credit FINRA description-bridge null milestone, preserve byte-exact V19 history, and keep Q003 open until all five semantics are actually resolved.":
        fail("contract purpose changed")
    if value["repository"] != {
        "remote": REMOTE, "ref": REF, "buildBaseCommit": BASE, "buildBaseTag": 891,
        "introductionMustBeDirectSingleParentChild": True, "introductionAddsExactlyAuthorizedPaths": True,
        "authorizedPaths": AUTHORIZED,
    }:
        fail("repository contract changed")
    exact_keys(value["inputs"], {
        "rawSha256", "inputBundleSha256", "inputBundleRecomputedFromBaseRawHashesAndMilestoneDelta",
        "v19EventLogMustBeByteExactPrefix", "v19ControllerMustVerifyRemoteBeforeImportCredit",
        "consumerArtifactMustVerifyRemoteBeforeImportCredit",
    }, "inputs")
    if value["inputs"]["rawSha256"] != EXPECTED_INPUT_RAW:
        fail("input bindings changed")
    if value["milestoneBinding"] != MILESTONE:
        fail("milestone binding changed")
    if exact_artifact:
        if value["implementation"] != {
            "controllerNormalizedSha256": EXPECTED_CONTROLLER_NORMALIZED,
            "testNormalizedSha256": EXPECTED_TEST_NORMALIZED, "selfBindingsNormalizedBeforeHash": True,
        }:
            fail("implementation binding changed")
        if normalized_python(Path(__file__).read_bytes()) != EXPECTED_CONTROLLER_NORMALIZED or normalized_test(TEST.read_bytes()) != EXPECTED_TEST_NORMALIZED:
            fail("implementation bytes changed")
        if value["outputs"] != {
            "eventLogPath": AUTHORIZED[2], "eventLogRawSha256": EXPECTED_EVENTS_RAW, "eventCount": 8,
            "lastEventSha256": parse_events(EVENTS.read_bytes(), 8)[-1]["eventSha256"],
            "statePath": AUTHORIZED[3], "stateRawSha256": EXPECTED_STATE_RAW,
            "stateSelfSha256": EXPECTED_STATE_SELF, "operationalProjectionSha256": EXPECTED_PROJECTION_SHA,
        }:
            fail("output binding changed")
    if value["replayContract"] != {
        "lastEventCarriesCompleteOperationalProjection": True,
        "stateMustBeDeterministicallyMaterializedFromEvents": True,
        "v19EventLogMustBeByteExactPrefix": True, "taskCountsMustBeRecomputedFromTasks": True,
        "eligibleQueueMustBeRecomputedFromTasks": True, "nextTaskMustBeHighestPriorityEligibleTask": True,
        "milestoneDeltaMustBeRecomputedFromGitObjects": True, "nextRequiresRemotePostIntroduction": True,
        "verifyWithoutRemoteMustFail": True, "preIntroductionVerifyIsDiagnosticOnly": True,
    } or value["scientificLocks"] != expected_scientific_locks():
        fail("replay or scientific contract changed")
    return value


def introduction_phase(head: str) -> tuple[str, str | None]:
    present = [path for path in AUTHORIZED if git_exists(head, path)]
    if not present:
        if head != BASE:
            fail("pre-introduction HEAD moved beyond Tag891")
        return "PRE_INTRODUCTION", None
    if present != AUTHORIZED:
        fail("partial V20 introduction")
    introductions = {git("log", "--diff-filter=A", "-1", "--format=%H", "--", path) for path in AUTHORIZED}
    if len(introductions) != 1:
        fail("V20 paths were not introduced together")
    introduction = introductions.pop()
    if git("show", "-s", "--format=%P", introduction).split() != [BASE]:
        fail("V20 introduction is not direct single-parent child of Tag891")
    expected_delta = [f"A\t{path}" for path in AUTHORIZED]
    if git("diff-tree", "--no-commit-id", "--name-status", "-r", introduction).splitlines() != expected_delta:
        fail("V20 introduction is not exactly five additions")
    chain = git("rev-list", "--first-parent", head).splitlines()
    if introduction not in chain:
        fail("V20 introduction absent from first-parent history")
    for commit in chain[:chain.index(introduction)]:
        if len(git("show", "-s", "--format=%P", commit).split()) != 1:
            fail("non-linear descendant after V20 introduction")
    for path in AUTHORIZED:
        if git("log", "-1", "--format=%H", "--", path) != introduction or git_raw(head, path) != (ROOT / path).read_bytes():
            fail("V20 Git/worktree bytes drifted")
    return "POST_INTRODUCTION", introduction


def verify(remote: bool) -> dict[str, Any]:
    if not remote:
        fail("remote verification is mandatory")
    contract = load_contract()
    actual = input_raw()
    bundle = input_bundle(actual)
    if contract["inputs"]["inputBundleSha256"] != bundle:
        fail("input bundle changed")
    event_raw = EVENTS.read_bytes()
    state_raw = STATE.read_bytes()
    if sha(event_raw) != EXPECTED_EVENTS_RAW or sha(state_raw) != EXPECTED_STATE_RAW or not event_raw.startswith(V19_EVENTS.read_bytes()):
        fail("V20 output bytes or V19 prefix changed")
    events = parse_events(event_raw, 8)
    state = materialize_state(event_raw, events, actual, bundle)
    if json.loads(state_raw) != state or state["stateSha256"] != EXPECTED_STATE_SELF:
        fail("state is not deterministic replay")
    if git("remote", "get-url", "origin") != REMOTE:
        fail("origin changed")
    head = git("rev-parse", "HEAD")
    live = git("ls-remote", "--refs", "origin", REF).split()
    if len(live) != 2 or live[1] != REF or not head == git("rev-parse", "@{u}") == live[0]:
        fail("HEAD/upstream/live remote drift")
    verify_v19_remote()
    verify_consumer_remote()
    phase, introduction = introduction_phase(head)
    schedule = validate_projection(state["operationalProjection"])
    return {
        "schema": "early-detection-free-source-operational-state-verification/v20",
        "status": "PASS" if phase == "POST_INTRODUCTION" else "PRE_INTRODUCTION_DIAGNOSTIC",
        "phase": phase, "introductionCommit": introduction,
        "controllerResumeAllowed": phase == "POST_INTRODUCTION", "eventCount": 8,
        "operationalMilestones": 30, "newMilestones": 1, "tasksConserved": 10,
        "resolvedTasks": 0, "eligibleTasks": len(schedule["eligibleTaskIds"]),
        "nextTaskId": schedule["nextTaskId"], "q002AutoNext": False,
        "originalV4GreenOfficialGates": 2, "originalV4OfficialGateCount": 13,
        "v19PrefixVerified": True, "milestoneGitDeltasVerified": 1,
        "v19RemoteVerified": True, "consumerArtifactsRemoteVerified": 1,
        "remoteVerified": True, "outcomesAccessed": False,
    }


def materialize_pre_introduction() -> dict[str, Any]:
    if git("rev-parse", "HEAD") != BASE or git("rev-parse", "@{u}") != BASE:
        fail("materialization requires exact Tag891 base")
    if EVENTS.exists() or STATE.exists():
        fail("V20 materialization targets already exist")
    contract = load_contract(False)
    actual = input_raw()
    bundle = input_bundle(actual)
    if contract["inputs"]["inputBundleSha256"] != bundle:
        fail("materialization input bundle differs from contract")
    event = build_event(actual, bundle)
    event_raw = V19_EVENTS.read_bytes() + canonical(event) + b"\n"
    events = parse_events(event_raw, 8)
    state = materialize_state(event_raw, events, actual, bundle)
    with EVENTS.open("xb") as handle:
        handle.write(event_raw)
    with STATE.open("xb") as handle:
        handle.write(json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True).encode("utf-8") + b"\n")
    return {
        "schema": "early-detection-free-source-operational-state-materialization/v20", "status": "PASS",
        "eventRawSha256": sha(event_raw), "stateRawSha256": sha(STATE.read_bytes()),
        "stateSelfSha256": state["stateSha256"], "projectionSha256": sha(canonical(state["operationalProjection"])),
        "outcomesAccessed": False,
    }


def rejected(action: Callable[[], None]) -> bool:
    try:
        action()
    except (StateError, OSError, KeyError, TypeError, ValueError, json.JSONDecodeError, subprocess.CalledProcessError):
        return True
    return False


def self_test() -> dict[str, Any]:
    projection = expected_projection()
    mutations: dict[str, Callable[[dict[str, Any]], None]] = {
        "dropTask": lambda x: x["tasks"].pop(),
        "resolvedCounter": lambda x: (x["tasks"][5].__setitem__("operationalState", "RESOLVED"), x["taskCounts"].__setitem__("ACCOUNT_DEFERRED", 1), x["taskCounts"].__setitem__("RESOLVED", 1)),
        "renameTask": lambda x: (x["tasks"][5].__setitem__("taskId", "Q006-FAKE"), x["scheduler"]["blockedTaskIds"].__setitem__(3, "Q006-FAKE")),
        "q002Eligible": lambda x: x["tasks"][1].__setitem__("schedulerEligible", True),
        "forgedNext": lambda x: x["scheduler"].__setitem__("nextTaskId", "Q010-RESEARCH-ARCHIVE-DISCOVERY"),
        "dropTag891": lambda x: x["tasks"][2]["milestoneRefs"].pop(),
        "milestoneCredit": lambda x: x["operationalMilestones"][-1].__setitem__("status", "SCIENTIFIC_CREDIT_GRANTED"),
        "taskCredit": lambda x: x["tasks"][2].__setitem__("originalV4GateCredit", True),
        "studyOutcome": lambda x: x["lockedStudies"][0].__setitem__("outcomesAccessed", True),
        "unknownCredit": lambda x: x["scientificLocks"].__setitem__("unknownCredit", True),
        "originalV4": lambda x: x["originalV4"].__setitem__("greenOfficialGates", 3),
    }
    kills = {}
    for name, mutate in mutations.items():
        changed = copy.deepcopy(projection)
        mutate(changed)
        kills[name] = rejected(lambda changed=changed: validate_projection(changed))
    contract = load_contract(False)
    for name, mutate in {
        "contractMilestoneCredit": lambda x: x["milestoneBinding"].__setitem__("status", "SCIENTIFIC_CREDIT_GRANTED"),
        "contractOutputCredit": lambda x: x["scientificLocks"].__setitem__("terminalWealthComplete", True),
        "contractRemoteOptional": lambda x: x["replayContract"].__setitem__("verifyWithoutRemoteMustFail", False),
        "contractBackdated": lambda x: x.__setitem__("createdAt", "1970-01-01T00:00:00Z"),
        "contractRemoteChanged": lambda x: x["repository"].__setitem__("remote", "https://example.invalid/repo.git"),
        "contractPathRedirect": lambda x: x["repository"]["authorizedPaths"].__setitem__(3, "reports/forbidden.json"),
        "contractInputBundle": lambda x: x["inputs"].__setitem__("inputBundleSha256", "0" * 64),
        "contractOutputPath": lambda x: x["outputs"].__setitem__("statePath", "reports/forbidden.json"),
        "contractUnknownKey": lambda x: x.__setitem__("scientificCredit", True),
    }.items():
        changed = copy.deepcopy(contract)
        mutate(changed)
        changed["contractSelfSha256"] = None
        changed["contractSelfSha256"] = sha(canonical(changed))
        kills[name] = rejected(lambda changed=changed: validate_contract_semantics(changed))
    if not all(kills.values()):
        fail("self-test mutation survived")
    return {
        "schema": "early-detection-free-source-operational-state-self-test/v20",
        "status": "PASS", "killCount": len(kills), "kills": kills, "outcomesAccessed": False,
    }


def validate_contract_semantics(value: dict[str, Any]) -> None:
    exact_keys(value, {
        "schema", "createdAt", "track", "purpose", "contractSelfSha256", "repository", "inputs",
        "milestoneBinding", "implementation", "outputs", "replayContract", "scientificLocks",
    }, "contract")
    if value["schema"] != "early-detection-continuous-free-source-operational-state-contract/v20":
        fail("schema changed")
    if value["createdAt"] != CREATED_AT or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("identity or timeline changed")
    if value["purpose"] != "Append Tag891 as an exact no-credit FINRA description-bridge null milestone, preserve byte-exact V19 history, and keep Q003 open until all five semantics are actually resolved.":
        fail("purpose changed")
    if value["repository"] != {
        "remote": REMOTE, "ref": REF, "buildBaseCommit": BASE, "buildBaseTag": 891,
        "introductionMustBeDirectSingleParentChild": True,
        "introductionAddsExactlyAuthorizedPaths": True, "authorizedPaths": AUTHORIZED,
    }:
        fail("repository contract changed")
    if value["inputs"] != {
        "rawSha256": EXPECTED_INPUT_RAW,
        "inputBundleSha256": "57666f480cb21704b0ce9ce483e3f9b41fa34a8fae205ceaf056e85c0fce0ee4",
        "inputBundleRecomputedFromBaseRawHashesAndMilestoneDelta": True,
        "v19EventLogMustBeByteExactPrefix": True,
        "v19ControllerMustVerifyRemoteBeforeImportCredit": True,
        "consumerArtifactMustVerifyRemoteBeforeImportCredit": True,
    }:
        fail("input contract changed")
    if value["milestoneBinding"] != MILESTONE:
        fail("milestone binding changed")
    if value["implementation"] != {
        "controllerNormalizedSha256": EXPECTED_CONTROLLER_NORMALIZED,
        "testNormalizedSha256": EXPECTED_TEST_NORMALIZED,
        "selfBindingsNormalizedBeforeHash": True,
    }:
        fail("implementation binding changed")
    if value["outputs"] != {
        "eventLogPath": AUTHORIZED[2], "eventLogRawSha256": EXPECTED_EVENTS_RAW, "eventCount": 8,
        "lastEventSha256": parse_events(EVENTS.read_bytes(), 8)[-1]["eventSha256"],
        "statePath": AUTHORIZED[3], "stateRawSha256": EXPECTED_STATE_RAW,
        "stateSelfSha256": EXPECTED_STATE_SELF, "operationalProjectionSha256": EXPECTED_PROJECTION_SHA,
    }:
        fail("output contract changed")
    if value["replayContract"] != {
        "lastEventCarriesCompleteOperationalProjection": True,
        "stateMustBeDeterministicallyMaterializedFromEvents": True,
        "v19EventLogMustBeByteExactPrefix": True, "taskCountsMustBeRecomputedFromTasks": True,
        "eligibleQueueMustBeRecomputedFromTasks": True, "nextTaskMustBeHighestPriorityEligibleTask": True,
        "milestoneDeltaMustBeRecomputedFromGitObjects": True, "nextRequiresRemotePostIntroduction": True,
        "verifyWithoutRemoteMustFail": True, "preIntroductionVerifyIsDiagnosticOnly": True,
    }:
        fail("replay contract changed")
    if value["scientificLocks"] != expected_scientific_locks():
        fail("scientific locks changed")


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    for command in ("verify", "next"):
        child = sub.add_parser(command)
        child.add_argument("--remote", action="store_true")
    sub.add_parser("self-test")
    sub.add_parser("materialize-pre-introduction")
    args = parser.parse_args()
    try:
        if args.command == "self-test":
            result = self_test()
        elif args.command == "materialize-pre-introduction":
            result = materialize_pre_introduction()
        else:
            result = verify(args.remote)
            if args.command == "next":
                if result["phase"] != "POST_INTRODUCTION" or result["controllerResumeAllowed"] is not True:
                    fail("next is forbidden before remote V20 introduction")
                result = {
                    "schema": "early-detection-free-source-next/v20", "status": "PASS",
                    "nextTaskId": result["nextTaskId"], "remoteVerified": True,
                    "postIntroductionVerified": True, "q002AutoNext": False, "outcomesAccessed": False,
                }
    except (StateError, OSError, KeyError, TypeError, ValueError, json.JSONDecodeError, subprocess.CalledProcessError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
