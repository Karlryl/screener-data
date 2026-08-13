#!/usr/bin/env python3
"""Replay-only, remote-gated controller for append-only operational state V19."""

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
CONTRACT = ROOT / "research" / "early-detection-v4" / "continuous-free-source-operational-state-contract-v19.json"
EVENTS = ROOT / "state" / "early-detection-free-source-events-v19.jsonl"
STATE = ROOT / "state" / "early-detection-free-source-state-v19.json"
TEST = ROOT / "tests" / "early-detection-continuous-free-source-v19.test.js"
V18_CONTROLLER = ROOT / "scripts" / "early-detection-continuous-free-source-v18.py"
V18_EVENTS = ROOT / "state" / "early-detection-free-source-events-v18.jsonl"
V18_STATE = ROOT / "state" / "early-detection-free-source-state-v18.json"
ROLE_BUILDER = ROOT / "scripts" / "build-sec-form25-suspension-boundary-role-reconciliation-v1.py"

REMOTE = "https://github.com/Karlryl/screener-data.git"
REF = "refs/heads/codex/early-detection-v4-gates-20260810"
BASE = "9705c9814fe8410401f5ec0d808b9424689f639e"
CREATED_AT = "2026-08-13T11:19:32Z"
EXPECTED_CONTRACT_RAW = "ba35f9616cac19ca4b403533439d3fdf1a88d5d22fe786d573456996e1658cd8"
EXPECTED_CONTROLLER_NORMALIZED = "843b8fae81fedefaa58a9f97f2c53dc1ddcc45934dbf66d03481e3685c209387"
EXPECTED_TEST_NORMALIZED = "bb4a9cd4d10161d0134d1fb8a02ce4ed50cf6d34804b992ecdc22b73881aec25"
EXPECTED_EVENTS_RAW = "c9851dca2c68582e0fd1a5fd9301d86e3bc18d5e968cb3b1b4d8d56f231edd1b"
EXPECTED_STATE_RAW = "a241a9e77d1f49e2741ebab3b7f21fdf0025f71730abe5c341a648b7c2caafee"
EXPECTED_STATE_SELF = "73d0f6db6d8300c07bb8a7c079bfeb9b638aa36e39d2befde1f9c8c02978c5be"
EXPECTED_PROJECTION_SHA = "35691ff8c61bfed20e6fae73647e02eca073d1bdbb23aa10311c981d9f0c0297"

AUTHORIZED = [
    "research/early-detection-v4/continuous-free-source-operational-state-contract-v19.json",
    "scripts/early-detection-continuous-free-source-v19.py",
    "state/early-detection-free-source-events-v19.jsonl",
    "state/early-detection-free-source-state-v19.json",
    "tests/early-detection-continuous-free-source-v19.test.js",
]
INPUT_PATHS = {
    "policy": "research/early-detection-v4/continuous-free-source-policy-v1.md",
    "queueSeed": "research/early-detection-v4/continuous-free-source-queue-seed-v1.json",
    "registry": "research/early-detection-v4/continuous-free-source-registry-v1.json",
    "v18Contract": "research/early-detection-v4/continuous-free-source-operational-state-contract-v18.json",
    "v18Controller": "scripts/early-detection-continuous-free-source-v18.py",
    "v18ControllerTest": "tests/early-detection-continuous-free-source-v18.test.js",
    "v18EventLog": "state/early-detection-free-source-events-v18.jsonl",
    "v18State": "state/early-detection-free-source-state-v18.json",
    "roleContract": "research/early-detection-v4/sec-form25-suspension-boundary-role-reconciliation-contract-v1.json",
    "roleBuilder": "scripts/build-sec-form25-suspension-boundary-role-reconciliation-v1.py",
    "roleTest": "tests/build-sec-form25-suspension-boundary-role-reconciliation-v1.test.js",
}
EXPECTED_INPUT_RAW = {
    "policy": "dd2acf4d50e324060ef2d8938a6f340e9f3ddabd9312be0d6e316ad0bf046b89",
    "queueSeed": "9d192851b4be9ee965a522dd67e2818ac807e220d1a982694dc61e141e9f7f3b",
    "registry": "d07ba18a969aced361fb638d52226f373ec64052dba30ddf36789a2a130a8927",
    "v18Contract": "37bf21c8a80c9904c1dc93a8729af8e757a934f9f6b87922389ac4a206f92492",
    "v18Controller": "e6ef14573149c326473d925697968f40a1dbd738901c399c29a873648c8c503f",
    "v18ControllerTest": "3491e8812c7de0adcfd30443a2bae4ccefd6ecf7395a879f43f959f8a6d39d9e",
    "v18EventLog": "715514032dd5cfd7fa570dc3e47a96d2be46ead4a8a969e14cb5c05521d6c01f",
    "v18State": "0d2b92c5b6ced877593878dba5cdd40d4690b4081ed83bb5d12f000ac2304f43",
    "roleContract": "ad858bb73cc1c727916b5bb66848a164a429c814f84b24a8ea0209dd06888f98",
    "roleBuilder": "d8189abdd7d0e0c4d767df525c9ea4c1049a77f7a2fbed0d548a11643cfed381",
    "roleTest": "9d3e1c96392e8bd3e7385c69e3e1d3acab27062cab83929fa6406759ffa10041",
}
MILESTONE = {
    "tag": 889,
    "commit": BASE,
    "parent": "a0d61880f14b7f4abe742a9c58b21e22f16b3641",
    "subject": "Tag 889: SEC-Aussetzungsereignisse und Rollen reconciliieren",
    "workstream": "Q003_SEC_FORM25_SUSPENSION_EVENT_ROLE_RECONCILIATION",
    "artifactCount": 3,
    "deltaSha256": "4fd8492d0f45112477cbdbcb09e25c1c73cb4f94e2ef9a88150cc4ac82f065b7",
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
    projection = copy.deepcopy(json.loads(V18_STATE.read_bytes())["operationalProjection"])
    tasks = {task["taskId"]: task for task in projection["tasks"]}
    tasks["Q003-SEC-TERMINAL-WEALTH-QUEUE"]["milestoneRefs"].append(889)
    tasks["Q003-SEC-TERMINAL-WEALTH-QUEUE"]["nextAction"] = (
        "CONTINUE_FINRA_OTC_AND_PRIMARY_DOCUMENT_IDENTITY_LAST_SESSION_CORPORATE_ACTION_AND_TERMINAL_"
        "RECONCILIATION_AFTER_6366_FORM25_EVENTS_AND_12727_QUEUE_ROLES_RECONCILED_WITH_ZERO_CREDIT"
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
    if len(projection["operationalMilestones"]) != 29 or projection["operationalMilestones"][-1]["tag"] != 889:
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
        fail("Tag889 delta changed")
    if git("show", "-s", "--format=%P", BASE).split() != [MILESTONE["parent"]]:
        fail("Tag889 parent changed")
    if git("show", "-s", "--format=%s", BASE) != MILESTONE["subject"]:
        fail("Tag889 subject changed")
    return sha(canonical({"baseCommit": BASE, "inputRawSha256": actual, "milestoneDeltaSha256": [digest]}))


def expected_consumer() -> dict[str, Any]:
    return {
        "uniqueSuspensionEvents": 6366, "boundaryRoleProjectionRows": 12727,
        "modernPairedEvents": 6361, "legacySingleFilerEvents": 5,
        "secOriginalBlobsVerified": 6366, "allQueueRowsStillUnresolved": 44352,
        "identityResolved": False, "outcomesAccessed": False,
    }


def verify_v18_remote() -> None:
    if sha(V18_CONTROLLER.read_bytes()) != EXPECTED_INPUT_RAW["v18Controller"]:
        fail("V18 controller changed before execution")
    result = subprocess.run(
        ["python", "-B", str(V18_CONTROLLER), "verify", "--remote"], cwd=ROOT,
        capture_output=True, text=True, timeout=240,
    )
    if result.returncode:
        fail("V18 remote verification failed")
    value = json.loads(result.stdout)
    if value.get("status") != "PASS" or value.get("nextTaskId") != "Q003-SEC-TERMINAL-WEALTH-QUEUE" or value.get("outcomesAccessed") is not False:
        fail("V18 predecessor semantics changed")


def verify_consumer_remote() -> None:
    if sha(ROLE_BUILDER.read_bytes()) != EXPECTED_INPUT_RAW["roleBuilder"]:
        fail("role builder changed before execution")
    result = subprocess.run(
        ["python", "-B", str(ROLE_BUILDER), "dry-run", "--remote"], cwd=ROOT,
        capture_output=True, text=True, timeout=240,
    )
    if result.returncode:
        fail("role reconciliation remote verification failed")
    value = json.loads(result.stdout)
    population = value.get("population", {})
    observed = {key: population.get(key) for key in expected_consumer() if key not in {"identityResolved", "outcomesAccessed"}}
    observed["identityResolved"] = value.get("identityResolved")
    observed["outcomesAccessed"] = value.get("outcomesAccessed")
    if value.get("status") != "PASS" or observed != expected_consumer():
        fail("role reconciliation consumer evidence changed")


def build_event(actual: dict[str, str], bundle: str) -> dict[str, Any]:
    previous = parse_events(V18_EVENTS.read_bytes(), 6)[-1]
    projection = expected_projection()
    event = {
        "sequence": 7, "eventId": "EVT-00000007",
        "eventType": "OPERATIONAL_MILESTONE_TAG889_RECONCILED",
        "createdAt": CREATED_AT, "agentId": "ROOT-CONTROLLER", "fencingToken": 0,
        "previousEventSha256": previous["eventSha256"], "inputBundleSha256": bundle,
        "payload": {
            "baseCommit": BASE, "milestone": copy.deepcopy(MILESTONE), "repositoryRemote": REMOTE,
            "sourceEventLogRawSha256": actual["v18EventLog"], "sourceStateRawSha256": actual["v18State"],
            "sourceStateSelfSha256": json.loads(V18_STATE.read_bytes())["stateSha256"],
            "sourceLastEventSha256": previous["eventSha256"], "replacementStatePath": AUTHORIZED[3],
            "supersessionReasonCode": "V18_POINTER_PREDATES_TAG889_ROLE_RECONCILIATION",
            "v19EventCarriesCompleteOperationalProjection": True,
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
    v18 = json.loads(V18_STATE.read_bytes())
    state = {
        "schema": "early-detection-free-source-operational-state/v19", "materializedAt": last["createdAt"],
        "track": "SHARED_OUTCOME_BLIND_INFRA",
        "purpose": "Deterministically replay Tag889 as an outcome-blind no-credit Form-25 event/role reconciliation milestone while keeping Q003 unresolved.",
        "repository": {"remote": REMOTE, "ref": REF, "buildBaseCommit": BASE, "buildBaseTag": 889},
        "inputBundleSha256": bundle, "inputRawSha256": actual,
        "predecessor": {
            "version": 18, "contractPath": INPUT_PATHS["v18Contract"], "contractRawSha256": actual["v18Contract"],
            "controllerPath": INPUT_PATHS["v18Controller"], "controllerRawSha256": actual["v18Controller"],
            "testPath": INPUT_PATHS["v18ControllerTest"], "testRawSha256": actual["v18ControllerTest"],
            "eventLogPath": INPUT_PATHS["v18EventLog"], "eventLogRawSha256": actual["v18EventLog"],
            "statePath": INPUT_PATHS["v18State"], "stateRawSha256": actual["v18State"],
            "stateSelfSha256": v18["stateSha256"], "lastEventSha256": events[-2]["eventSha256"],
            "appendOnly": True, "remoteVerificationRequired": True,
            "semanticStatus": "SUPERSEDED_BY_TAG889_RECONCILED_V19",
        },
        "eventLog": {
            "path": AUTHORIZED[2], "eventCount": 7, "rawSha256": sha(event_raw),
            "lastEventSha256": last["eventSha256"], "v18ByteExactPrefix": True,
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
        fail("V19 contract raw bytes changed")
    value = json.loads(raw)
    body = copy.deepcopy(value)
    claim = body.get("contractSelfSha256")
    body["contractSelfSha256"] = None
    if claim != sha(canonical(body)):
        fail("V19 contract self hash changed")
    exact_keys(value, {
        "schema", "createdAt", "track", "purpose", "contractSelfSha256", "repository", "inputs",
        "milestoneBinding", "implementation", "outputs", "replayContract", "scientificLocks",
    }, "contract")
    if value["schema"] != "early-detection-continuous-free-source-operational-state-contract/v19" or value["createdAt"] != CREATED_AT or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract identity or timeline changed")
    if datetime.fromisoformat(CREATED_AT.replace("Z", "+00:00")) > datetime.now(timezone.utc):
        fail("contract createdAt is future")
    if value["purpose"] != "Append Tag889 as an exact no-credit Form-25 suspension-event/queue-role reconciliation milestone, preserve byte-exact V18 history, and keep Q003 open until all five semantics are actually resolved.":
        fail("contract purpose changed")
    if value["repository"] != {
        "remote": REMOTE, "ref": REF, "buildBaseCommit": BASE, "buildBaseTag": 889,
        "introductionMustBeDirectSingleParentChild": True, "introductionAddsExactlyAuthorizedPaths": True,
        "authorizedPaths": AUTHORIZED,
    }:
        fail("repository contract changed")
    exact_keys(value["inputs"], {
        "rawSha256", "inputBundleSha256", "inputBundleRecomputedFromBaseRawHashesAndMilestoneDelta",
        "v18EventLogMustBeByteExactPrefix", "v18ControllerMustVerifyRemoteBeforeImportCredit",
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
            "eventLogPath": AUTHORIZED[2], "eventLogRawSha256": EXPECTED_EVENTS_RAW, "eventCount": 7,
            "lastEventSha256": parse_events(EVENTS.read_bytes(), 7)[-1]["eventSha256"],
            "statePath": AUTHORIZED[3], "stateRawSha256": EXPECTED_STATE_RAW,
            "stateSelfSha256": EXPECTED_STATE_SELF, "operationalProjectionSha256": EXPECTED_PROJECTION_SHA,
        }:
            fail("output binding changed")
    if value["replayContract"] != {
        "lastEventCarriesCompleteOperationalProjection": True,
        "stateMustBeDeterministicallyMaterializedFromEvents": True,
        "v18EventLogMustBeByteExactPrefix": True, "taskCountsMustBeRecomputedFromTasks": True,
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
            fail("pre-introduction HEAD moved beyond Tag889")
        return "PRE_INTRODUCTION", None
    if present != AUTHORIZED:
        fail("partial V19 introduction")
    introductions = {git("log", "--diff-filter=A", "-1", "--format=%H", "--", path) for path in AUTHORIZED}
    if len(introductions) != 1:
        fail("V19 paths were not introduced together")
    introduction = introductions.pop()
    if git("show", "-s", "--format=%P", introduction).split() != [BASE]:
        fail("V19 introduction is not direct single-parent child of Tag889")
    expected_delta = [f"A\t{path}" for path in AUTHORIZED]
    if git("diff-tree", "--no-commit-id", "--name-status", "-r", introduction).splitlines() != expected_delta:
        fail("V19 introduction is not exactly five additions")
    chain = git("rev-list", "--first-parent", head).splitlines()
    if introduction not in chain:
        fail("V19 introduction absent from first-parent history")
    for commit in chain[:chain.index(introduction)]:
        if len(git("show", "-s", "--format=%P", commit).split()) != 1:
            fail("non-linear descendant after V19 introduction")
    for path in AUTHORIZED:
        if git("log", "-1", "--format=%H", "--", path) != introduction or git_raw(head, path) != (ROOT / path).read_bytes():
            fail("V19 Git/worktree bytes drifted")
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
    if sha(event_raw) != EXPECTED_EVENTS_RAW or sha(state_raw) != EXPECTED_STATE_RAW or not event_raw.startswith(V18_EVENTS.read_bytes()):
        fail("V19 output bytes or V18 prefix changed")
    events = parse_events(event_raw, 7)
    state = materialize_state(event_raw, events, actual, bundle)
    if json.loads(state_raw) != state or state["stateSha256"] != EXPECTED_STATE_SELF:
        fail("state is not deterministic replay")
    if git("remote", "get-url", "origin") != REMOTE:
        fail("origin changed")
    head = git("rev-parse", "HEAD")
    live = git("ls-remote", "--refs", "origin", REF).split()
    if len(live) != 2 or live[1] != REF or not head == git("rev-parse", "@{u}") == live[0]:
        fail("HEAD/upstream/live remote drift")
    verify_v18_remote()
    verify_consumer_remote()
    phase, introduction = introduction_phase(head)
    schedule = validate_projection(state["operationalProjection"])
    return {
        "schema": "early-detection-free-source-operational-state-verification/v19",
        "status": "PASS" if phase == "POST_INTRODUCTION" else "PRE_INTRODUCTION_DIAGNOSTIC",
        "phase": phase, "introductionCommit": introduction,
        "controllerResumeAllowed": phase == "POST_INTRODUCTION", "eventCount": 7,
        "operationalMilestones": 29, "newMilestones": 1, "tasksConserved": 10,
        "resolvedTasks": 0, "eligibleTasks": len(schedule["eligibleTaskIds"]),
        "nextTaskId": schedule["nextTaskId"], "q002AutoNext": False,
        "originalV4GreenOfficialGates": 2, "originalV4OfficialGateCount": 13,
        "v18PrefixVerified": True, "milestoneGitDeltasVerified": 1,
        "v18RemoteVerified": True, "consumerArtifactsRemoteVerified": 1,
        "remoteVerified": True, "outcomesAccessed": False,
    }


def materialize_pre_introduction() -> dict[str, Any]:
    if git("rev-parse", "HEAD") != BASE or git("rev-parse", "@{u}") != BASE:
        fail("materialization requires exact Tag889 base")
    if EVENTS.exists() or STATE.exists():
        fail("V19 materialization targets already exist")
    contract = load_contract(False)
    actual = input_raw()
    bundle = input_bundle(actual)
    if contract["inputs"]["inputBundleSha256"] != bundle:
        fail("materialization input bundle differs from contract")
    event = build_event(actual, bundle)
    event_raw = V18_EVENTS.read_bytes() + canonical(event) + b"\n"
    events = parse_events(event_raw, 7)
    state = materialize_state(event_raw, events, actual, bundle)
    with EVENTS.open("xb") as handle:
        handle.write(event_raw)
    with STATE.open("xb") as handle:
        handle.write(json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True).encode("utf-8") + b"\n")
    return {
        "schema": "early-detection-free-source-operational-state-materialization/v19", "status": "PASS",
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
        "dropTag889": lambda x: x["tasks"][2]["milestoneRefs"].pop(),
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
        "schema": "early-detection-free-source-operational-state-self-test/v19",
        "status": "PASS", "killCount": len(kills), "kills": kills, "outcomesAccessed": False,
    }


def validate_contract_semantics(value: dict[str, Any]) -> None:
    exact_keys(value, {
        "schema", "createdAt", "track", "purpose", "contractSelfSha256", "repository", "inputs",
        "milestoneBinding", "implementation", "outputs", "replayContract", "scientificLocks",
    }, "contract")
    if value["schema"] != "early-detection-continuous-free-source-operational-state-contract/v19":
        fail("schema changed")
    if value["createdAt"] != CREATED_AT or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("identity or timeline changed")
    if value["purpose"] != "Append Tag889 as an exact no-credit Form-25 suspension-event/queue-role reconciliation milestone, preserve byte-exact V18 history, and keep Q003 open until all five semantics are actually resolved.":
        fail("purpose changed")
    if value["repository"] != {
        "remote": REMOTE, "ref": REF, "buildBaseCommit": BASE, "buildBaseTag": 889,
        "introductionMustBeDirectSingleParentChild": True,
        "introductionAddsExactlyAuthorizedPaths": True, "authorizedPaths": AUTHORIZED,
    }:
        fail("repository contract changed")
    if value["inputs"] != {
        "rawSha256": EXPECTED_INPUT_RAW,
        "inputBundleSha256": "4beac6d881549726364d4683f02e910699c3a48be26ea28e6ec0066d8ff72645",
        "inputBundleRecomputedFromBaseRawHashesAndMilestoneDelta": True,
        "v18EventLogMustBeByteExactPrefix": True,
        "v18ControllerMustVerifyRemoteBeforeImportCredit": True,
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
        "eventLogPath": AUTHORIZED[2], "eventLogRawSha256": EXPECTED_EVENTS_RAW, "eventCount": 7,
        "lastEventSha256": parse_events(EVENTS.read_bytes(), 7)[-1]["eventSha256"],
        "statePath": AUTHORIZED[3], "stateRawSha256": EXPECTED_STATE_RAW,
        "stateSelfSha256": EXPECTED_STATE_SELF, "operationalProjectionSha256": EXPECTED_PROJECTION_SHA,
    }:
        fail("output contract changed")
    if value["replayContract"] != {
        "lastEventCarriesCompleteOperationalProjection": True,
        "stateMustBeDeterministicallyMaterializedFromEvents": True,
        "v18EventLogMustBeByteExactPrefix": True, "taskCountsMustBeRecomputedFromTasks": True,
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
                    fail("next is forbidden before remote V19 introduction")
                result = {
                    "schema": "early-detection-free-source-next/v19", "status": "PASS",
                    "nextTaskId": result["nextTaskId"], "remoteVerified": True,
                    "postIntroductionVerified": True, "q002AutoNext": False, "outcomesAccessed": False,
                }
    except (StateError, OSError, KeyError, TypeError, ValueError, json.JSONDecodeError, subprocess.CalledProcessError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
