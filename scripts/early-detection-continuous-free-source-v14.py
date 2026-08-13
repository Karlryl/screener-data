#!/usr/bin/env python3
"""Replay-only, remote-gated controller for the append-only V14 state."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import subprocess
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research/early-detection-v4/continuous-free-source-operational-state-contract-v14.json"
EVENTS = ROOT / "state/early-detection-free-source-events-v14.jsonl"
STATE = ROOT / "state/early-detection-free-source-state-v14.json"
REMOTE = "https://github.com/Karlryl/screener-data.git"
REF = "refs/heads/codex/early-detection-v4-gates-20260810"
BASE_COMMIT = "9d1dbad209c14c8fca0073a371f743d94f731283"
EXPECTED_CONTRACT_RAW = "d4f5d53fb42edc192cf614b3910476b53140bf7432edb2225aa2e6584d966eff"
EXPECTED_CONTROLLER_NORMALIZED = "b457b13b95d3b5c198d3f87c528f5b9b777d8856b5c75f7553fc99160207eb08"
EXPECTED_TEST_NORMALIZED = "b93ea3c7e8f61f0e92e566f159904a9f48f562a7ed48f3dec9c7ec7c84da8878"
EXPECTED_PROJECTION_SHA = "08b1ce5850dacde5f37a08081e9273760a69cd03818b4762a9751ce3050f3b13"

AUTHORIZED = [
    "research/early-detection-v4/continuous-free-source-operational-state-contract-v14.json",
    "scripts/early-detection-continuous-free-source-v14.py",
    "state/early-detection-free-source-events-v14.jsonl",
    "state/early-detection-free-source-state-v14.json",
    "tests/early-detection-continuous-free-source-v14.test.js",
]

EXPECTED_TASK_IDS = [
    "Q001-QUANTCONNECT-TERMS-ACCOUNT",
    "Q002-QUANTCONNECT-50-CASE-CONTRACT",
    "Q003-SEC-TERMINAL-WEALTH-QUEUE",
    "Q004-FINRA-OTC-CATALOG",
    "Q005-US-EXCHANGE-PUBLIC-CATALOGS",
    "Q006-TIINGO-FREE-ENTITLEMENT",
    "Q007-OPENFIGI-ANONYMOUS-HANDSHAKE",
    "Q008-BUSINESS-QUANT-FREE-HANDSHAKE",
    "Q009-ALPHA-VANTAGE-NEGATIVE-CONTROL",
    "Q010-RESEARCH-ARCHIVE-DISCOVERY",
]

INPUT_PATHS = {
    "policy": "research/early-detection-v4/continuous-free-source-policy-v1.md",
    "queueSeed": "research/early-detection-v4/continuous-free-source-queue-seed-v1.json",
    "registry": "research/early-detection-v4/continuous-free-source-registry-v1.json",
    "resumeV4Contract": "research/early-detection-v4/continuous-free-source-operational-resume-contract-v4.json",
    "v12EventLog": "state/early-detection-free-source-events-v12.jsonl",
    "v13Contract": "research/early-detection-v4/continuous-free-source-operational-state-contract-v13.json",
    "v13Controller": "scripts/early-detection-continuous-free-source-v13.py",
    "v13ControllerTest": "tests/early-detection-continuous-free-source-v13.test.js",
    "v13EventLog": "state/early-detection-free-source-events-v13.jsonl",
    "v13State": "state/early-detection-free-source-state-v13.json",
}


class StateError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise StateError(message)


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def normalized_python(raw: bytes) -> str:
    text = raw.decode()
    for name in ("EXPECTED_CONTRACT_RAW", "EXPECTED_CONTROLLER_NORMALIZED", "EXPECTED_TEST_NORMALIZED"):
        text = re.sub(rf'({name}\s*=\s*")[^"]+("\s*)', rf'\g<1>{name}_NORMALIZED\g<2>', text)
    return sha(text.encode())


def normalized_test(raw: bytes) -> str:
    text = raw.decode()
    for name in ("EXPECTED_CONTRACT_RAW", "EXPECTED_CONTROLLER_NORMALIZED", "EXPECTED_TEST_NORMALIZED"):
        text = re.sub(rf'(const {name}\s*=\s*\')[^\']+(\'\s*;)', rf'\g<1>{name}_NORMALIZED\g<2>', text)
    return sha(text.encode())


def assert_exact_keys(value: object, keys: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != keys:
        fail(f"{label} schema changed")


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def read_exact(path: str, expected: str) -> bytes:
    raw = (ROOT / path).read_bytes()
    if sha(raw) != expected:
        fail(f"raw bytes changed: {path}")
    return raw


def load_contract() -> tuple[dict, bytes]:
    raw = CONTRACT.read_bytes()
    if sha(raw) != EXPECTED_CONTRACT_RAW:
        fail("V14 contract raw bytes changed")
    contract = json.loads(raw)
    claim = contract.get("contractSelfSha256")
    item = copy.deepcopy(contract)
    item["contractSelfSha256"] = None
    if claim != sha(canonical(item)):
        fail("V14 contract self hash changed")
    if contract.get("schema") != "early-detection-continuous-free-source-operational-state-contract/v14":
        fail("V14 contract schema changed")
    if contract.get("repository", {}).get("authorizedPaths") != AUTHORIZED:
        fail("authorized paths changed")
    own = contract.get("implementation", {})
    if own.get("controllerNormalizedSha256") != EXPECTED_CONTROLLER_NORMALIZED:
        fail("controller normalized binding changed")
    if own.get("testNormalizedSha256") != EXPECTED_TEST_NORMALIZED:
        fail("test normalized binding changed")
    if normalized_python(Path(__file__).read_bytes()) != EXPECTED_CONTROLLER_NORMALIZED:
        fail("controller bytes changed")
    test_raw = (ROOT / AUTHORIZED[-1]).read_bytes()
    if normalized_test(test_raw) != EXPECTED_TEST_NORMALIZED:
        fail("test bytes changed")
    return contract, raw


def parse_events(raw: bytes) -> list[dict]:
    rows = [json.loads(line) for line in raw.decode().splitlines() if line]
    if len(rows) != 3:
        fail("event count changed")
    for index, row in enumerate(rows):
        claim = row.get("eventSha256")
        item = copy.deepcopy(row)
        item.pop("eventSha256", None)
        if claim != sha(canonical(item)):
            fail("event self hash changed")
        if row.get("sequence") != index + 1:
            fail("event sequence changed")
        expected_previous = None if index == 0 else rows[index - 1]["eventSha256"]
        if row.get("previousEventSha256") != expected_previous:
            fail("event hash chain changed")
    if rows[-1].get("eventType") != "OPERATIONAL_STATE_V13_REPLAY_HARDENED":
        fail("V14 replay event changed")
    return rows


def compute_inputs(contract: dict) -> tuple[dict, str]:
    expected = contract["inputs"]["rawSha256"]
    if set(expected) != set(INPUT_PATHS):
        fail("input key set changed")
    actual = {key: sha((ROOT / path).read_bytes()) for key, path in INPUT_PATHS.items()}
    if actual != expected:
        fail("input raw binding changed")
    for key, path in INPUT_PATHS.items():
        base_raw = subprocess.check_output(["git", "show", f"{BASE_COMMIT}:{path}"], cwd=ROOT)
        if sha(base_raw) != actual[key] or base_raw != (ROOT / path).read_bytes():
            fail(f"input Git blob changed: {key}")
    bundle = sha(canonical({"baseCommit": BASE_COMMIT, "inputRawSha256": actual}))
    if bundle != contract["inputs"]["inputBundleSha256"]:
        fail("input bundle recomputation changed")
    return actual, bundle


def validate_projection(projection: dict) -> dict:
    expected_keys = [
        "taskCounts", "tasks", "q005Sublanes", "scheduler", "operationalMilestones",
        "milestoneClaimLocks", "lockedStudies", "originalV4", "scientificLocks",
    ]
    if list(projection) != expected_keys:
        fail("operational projection key order or set changed")
    if sha(canonical(projection)) != EXPECTED_PROJECTION_SHA:
        fail("operational projection bytes changed")
    tasks = projection["tasks"]
    if not isinstance(tasks, list) or [task.get("taskId") for task in tasks] != EXPECTED_TASK_IDS:
        fail("Q001-Q010 conservation changed")
    task_keys = {"taskId", "sourceId", "legacyV12State", "operationalState", "schedulerEligible", "priority", "milestoneRefs", "nextAction"}
    for task in tasks:
        assert_exact_keys(task, task_keys, "task")
    counts = dict(Counter(task["operationalState"] for task in tasks))
    counts["RESOLVED"] = sum(task["operationalState"] == "RESOLVED" for task in tasks)
    if counts != projection["taskCounts"]:
        fail("task counts are not source-derived")
    if counts["RESOLVED"] != 0:
        fail("resolved task credit is forbidden")
    eligible = sorted(
        (task for task in tasks if task.get("schedulerEligible") is True and task.get("operationalState") == "AUTONOMOUS_OPEN"),
        key=lambda task: (-task["priority"], task["taskId"]),
    )
    eligible_ids = [task["taskId"] for task in eligible]
    blocked_ids = [task["taskId"] for task in tasks if task["taskId"] not in set(eligible_ids)]
    scheduler = projection["scheduler"]
    if scheduler.get("strategy") != "HIGHEST_PRIORITY_AUTONOMOUS_OPEN_ONLY":
        fail("scheduler strategy changed")
    if scheduler.get("eligibleTaskIds") != eligible_ids or scheduler.get("blockedTaskIds") != blocked_ids:
        fail("scheduler queue is not task-derived")
    if not eligible_ids or scheduler.get("nextTaskId") != eligible_ids[0]:
        fail("scheduler next is not priority-derived")
    if scheduler.get("q002AutoNextForbidden") is not True or eligible_ids[0].startswith("Q002-"):
        fail("Q002 autonomous scheduling is forbidden")
    by_id = {task["taskId"]: task for task in tasks}
    for task_id in (tasks[0]["taskId"], tasks[1]["taskId"]):
        if by_id[task_id]["operationalState"] != "RIGHTS_BLOCKED_EXPORT" or by_id[task_id]["schedulerEligible"] is not False:
            fail("QuantConnect rights block changed")
    if tasks[6]["operationalState"] != "MILESTONE_COMPLETE_NO_INTERVAL_CREDIT" or tasks[6]["schedulerEligible"] is not False:
        fail("OpenFIGI point-only boundary changed")
    if tasks[8]["operationalState"] != "EXTERNAL_DEFERRED" or tasks[8]["schedulerEligible"] is not False:
        fail("Alpha Vantage deferral changed")
    lanes = projection["q005Sublanes"]
    if [lane.get("laneId") for lane in lanes] != ["NASDAQ", "NYSE", "NYSE_AMERICAN", "CBOE"]:
        fail("Q005 sublane conservation changed")
    lane_keys = {"laneId", "state", "schedulerEligible", "boundary"}
    for lane in lanes:
        assert_exact_keys(lane, lane_keys, "Q005 sublane")
    if any(lane.get("schedulerEligible") is not True for lane in lanes):
        fail("Q005 sublane eligibility changed")
    if lanes[0].get("state") != "PARTIAL_MILESTONE_OPEN_GAPS" or any(lane.get("state") != "AUTONOMOUS_OPEN" for lane in lanes[1:]):
        fail("Q005 sublane state changed")
    milestone_locks = projection["milestoneClaimLocks"]
    milestone_lock_keys = {
        "resolvedTaskCredit", "historicalIdentityResolved", "listingIdentityResolved",
        "securityIdentityResolved", "tickerReuseResolved", "corporateActionChainComplete",
        "terminalPaymentVerified", "terminalSessionProven", "terminalWealthComplete",
        "originalV4GateCredit", "resultComputationAllowed", "outcomesAccessed",
    }
    if not isinstance(milestone_locks, dict) or set(milestone_locks) != milestone_lock_keys or any(value is not False for value in milestone_locks.values()):
        fail("milestone claim lock changed")
    milestones = projection["operationalMilestones"]
    if not isinstance(milestones, list) or len(milestones) != 10:
        fail("operational milestone population changed")
    milestone_keys = {"tag", "commit", "parent", "subject", "workstream", "artifactCount", "status"}
    if any(set(row) != milestone_keys or row.get("status") != "OPERATIONAL_MILESTONE_NO_CREDIT" for row in milestones):
        fail("operational milestone credit changed")
    studies = projection["lockedStudies"]
    if not isinstance(studies, list) or len(studies) != 2:
        fail("locked study population changed")
    study_keys = {"studyId", "status", "appendOnly", "originalV4GateCredit"}
    if any(set(row) != study_keys or row.get("status") != "LOCKED_APPEND_ONLY" or row.get("appendOnly") is not True or row.get("originalV4GateCredit") is not False for row in studies):
        fail("locked study credit changed")
    locks = projection["scientificLocks"]
    expected_lock_keys = {
        "proposalExecutionAuthorized", "resultComputationAllowed", "studyCredit",
        "originalV4GateCredit", "fiveRequiredDataSemanticsComplete",
        "fullDataAiProtocolSealAllowed", "reserved2021To2024OpenedForHypothesisGeneration",
        "humanAttestation", "pricesAccessed", "returnsAccessed", "outcomesAccessed",
    }
    if not isinstance(locks, dict) or set(locks) != expected_lock_keys:
        fail("scientific lock schema changed")
    for key in (
        "proposalExecutionAuthorized", "resultComputationAllowed", "originalV4GateCredit",
        "fiveRequiredDataSemanticsComplete", "fullDataAiProtocolSealAllowed",
        "reserved2021To2024OpenedForHypothesisGeneration", "humanAttestation",
        "pricesAccessed", "returnsAccessed", "outcomesAccessed",
    ):
        if locks.get(key) is not False:
            fail(f"scientific lock changed: {key}")
    if locks.get("studyCredit") != "NONE":
        fail("study credit changed")
    original = projection["originalV4"]
    if original != {
        "protocol": "FEM-SEC-US@1.2.0", "greenOfficialGates": 2, "officialGateCount": 13,
        "complete": False, "resultComputationAllowed": False, "outcomesAccessed": False,
    }:
        fail("Original V4 boundary changed")
    return {"eligibleTaskIds": eligible_ids, "nextTaskId": eligible_ids[0]}


def materialize_state(contract: dict, event_raw: bytes, events: list[dict], input_raw: dict, bundle: str) -> dict:
    last = events[-1]
    payload = last["payload"]
    v13_state = json.loads((ROOT / INPUT_PATHS["v13State"]).read_bytes())
    v13_last = json.loads((ROOT / INPUT_PATHS["v13EventLog"]).read_text().strip().splitlines()[-1])
    if last.get("inputBundleSha256") != bundle or payload.get("baseCommit") != BASE_COMMIT:
        fail("event input bundle or build base changed")
    if payload.get("repositoryRemote") != REMOTE or payload.get("replacementStatePath") != AUTHORIZED[3]:
        fail("event repository or state path changed")
    if payload.get("sourceEventLogRawSha256") != input_raw["v13EventLog"] or payload.get("sourceStateRawSha256") != input_raw["v13State"]:
        fail("event predecessor raw binding changed")
    if payload.get("sourceLastEventSha256") != v13_last.get("eventSha256") or payload.get("sourceStateSelfSha256") != v13_state.get("stateSha256"):
        fail("event predecessor self binding changed")
    if payload.get("noScientificCredit") is not True or payload.get("outcomesAccessed") is not False:
        fail("event scientific boundary changed")
    projection = payload.get("operationalProjection")
    if not isinstance(projection, dict):
        fail("event does not carry complete operational projection")
    if payload.get("operationalProjectionSha256") != sha(canonical(projection)):
        fail("event projection hash changed")
    validate_projection(projection)
    expected = {
        "schema": "early-detection-free-source-operational-state/v14",
        "materializedAt": last["createdAt"],
        "track": "SHARED_OUTCOME_BLIND_INFRA",
        "purpose": "Deterministically replay the complete outcome-blind operational projection from the append-only event log and release scheduling only after exact remote introduction.",
        "repository": {"remote": REMOTE, "ref": REF, "buildBaseCommit": BASE_COMMIT, "buildBaseTag": 866},
        "inputBundleSha256": bundle,
        "inputRawSha256": input_raw,
        "predecessor": {
            "version": 13,
            "contractPath": INPUT_PATHS["v13Contract"], "contractRawSha256": input_raw["v13Contract"],
            "controllerPath": INPUT_PATHS["v13Controller"], "controllerRawSha256": input_raw["v13Controller"],
            "eventLogPath": INPUT_PATHS["v13EventLog"], "eventLogRawSha256": input_raw["v13EventLog"],
            "statePath": INPUT_PATHS["v13State"], "stateRawSha256": input_raw["v13State"],
            "stateSelfSha256": payload["sourceStateSelfSha256"], "lastEventSha256": payload["sourceLastEventSha256"],
            "appendOnly": True, "semanticStatus": "SUPERSEDED_BY_REPLAY_HARDENED_V14",
        },
        "eventLog": {
            "path": AUTHORIZED[2], "eventCount": 3, "rawSha256": sha(event_raw),
            "lastEventSha256": last["eventSha256"], "v12GenesisByteExactPrefix": True,
            "v13ByteExactPrefix": True, "hashChainVerified": True, "fullProjectionCarriedByLastEvent": True,
        },
        "operationalProjection": projection,
    }
    expected["stateSha256"] = sha(canonical(expected))
    return expected


def exact_introduction(contract: dict) -> tuple[str, str]:
    present = [path for path in AUTHORIZED if subprocess.run(
        ["git", "cat-file", "-e", f"HEAD:{path}"], cwd=ROOT,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    ).returncode == 0]
    if not present:
        return "PRE_INTRODUCTION", ""
    if present != AUTHORIZED:
        fail("partial V14 introduction")
    head = git("rev-parse", "HEAD")
    parents = git("show", "-s", "--format=%P", head).split()
    if parents != [BASE_COMMIT]:
        fail("V14 introduction is not the direct single-parent child of Tag866")
    changes = git("diff-tree", "--no-commit-id", "--name-status", "-r", head).splitlines()
    if changes != [f"A\t{path}" for path in AUTHORIZED]:
        fail("V14 introduction is not exactly five authorized additions")
    for path in AUTHORIZED:
        if subprocess.check_output(["git", "show", f"{head}:{path}"], cwd=ROOT) != (ROOT / path).read_bytes():
            fail("V14 introduction blob differs from worktree")
    return "POST_INTRODUCTION", head


def verify(remote: bool) -> dict:
    if not remote:
        fail("remote verification is mandatory")
    contract, _ = load_contract()
    input_raw, bundle = compute_inputs(contract)
    event_raw = read_exact(AUTHORIZED[2], contract["outputs"]["eventLogRawSha256"])
    state_raw = read_exact(AUTHORIZED[3], contract["outputs"]["stateRawSha256"])
    v13_raw = (ROOT / INPUT_PATHS["v13EventLog"]).read_bytes()
    v12_raw = (ROOT / INPUT_PATHS["v12EventLog"]).read_bytes()
    if not event_raw.startswith(v13_raw) or not v13_raw.startswith(v12_raw):
        fail("V12/V13 event logs are not byte-exact prefixes")
    events = parse_events(event_raw)
    expected_state = materialize_state(contract, event_raw, events, input_raw, bundle)
    actual_state = json.loads(state_raw)
    if actual_state != expected_state or actual_state.get("stateSha256") != contract["outputs"]["stateSelfSha256"]:
        fail("state is not a deterministic replay of the event log")
    phase, introduction = exact_introduction(contract)
    if git("remote", "get-url", "origin") != REMOTE:
        fail("origin changed")
    head = git("rev-parse", "HEAD")
    upstream = git("rev-parse", "@{u}")
    remote_head = git("ls-remote", "origin", REF).split()[0]
    if not head == upstream == remote_head:
        fail("HEAD/upstream/remote drift")
    schedule = validate_projection(actual_state["operationalProjection"])
    return {
        "schema": "early-detection-free-source-operational-state-verification/v14",
        "status": "PASS" if phase == "POST_INTRODUCTION" else "PRE_INTRODUCTION_DIAGNOSTIC",
        "phase": phase, "introductionCommit": introduction or None,
        "controllerResumeAllowed": phase == "POST_INTRODUCTION",
        "eventCount": 3, "tasksConserved": 10, "resolvedTasks": 0,
        "eligibleTasks": len(schedule["eligibleTaskIds"]), "nextTaskId": schedule["nextTaskId"],
        "q002AutoNext": False, "originalV4GreenOfficialGates": 2,
        "originalV4OfficialGateCount": 13, "remoteVerified": True, "outcomesAccessed": False,
    }


def self_test() -> dict:
    contract, _ = load_contract()
    input_raw, bundle = compute_inputs(contract)
    event_raw = EVENTS.read_bytes()
    events = parse_events(event_raw)
    state = materialize_state(contract, event_raw, events, input_raw, bundle)
    projection = state["operationalProjection"]
    mutations = {
        "dropTask": lambda x: x["tasks"].pop(),
        "resolveTask": lambda x: (x["tasks"][5].__setitem__("operationalState", "RESOLVED"), x["taskCounts"].__setitem__("ACCOUNT_DEFERRED", 1), x["taskCounts"].__setitem__("RESOLVED", 1)),
        "renameTask": lambda x: (x["tasks"][5].__setitem__("taskId", "Q006-FAKE-TASK"), x["scheduler"]["blockedTaskIds"].__setitem__(3, "Q006-FAKE-TASK")),
        "q002Eligible": lambda x: x["tasks"][1].__setitem__("schedulerEligible", True),
        "q007IntervalCredit": lambda x: x["tasks"][6].__setitem__("operationalState", "AUTONOMOUS_OPEN"),
        "dropCboe": lambda x: x["q005Sublanes"].pop(),
        "closeCboe": lambda x: (x["q005Sublanes"][3].__setitem__("state", "CLOSED"), x["q005Sublanes"][3].__setitem__("schedulerEligible", False)),
        "outcomes": lambda x: x["scientificLocks"].__setitem__("outcomesAccessed", True),
        "identityCredit": lambda x: x["milestoneClaimLocks"].__setitem__("historicalIdentityResolved", True),
        "studyCredit": lambda x: x["lockedStudies"][0].__setitem__("originalV4GateCredit", True),
        "milestoneCredit": lambda x: x["operationalMilestones"][0].__setitem__("status", "SCIENTIFIC_CREDIT_GRANTED"),
        "unknownCredit": lambda x: x["scientificLocks"].__setitem__("unknownScientificCredit", True),
        "taskCredit": lambda x: x["tasks"][2].__setitem__("originalV4GateCredit", True),
        "laneCredit": lambda x: x["q005Sublanes"][0].__setitem__("identityResolved", True),
        "studyOutcome": lambda x: x["lockedStudies"][1].__setitem__("outcomesAccessed", True),
        "originalV4": lambda x: x["originalV4"].__setitem__("greenOfficialGates", 3),
        "priorityDrift": lambda x: x["tasks"][3].__setitem__("priority", 200),
        "forgedNext": lambda x: x["scheduler"].__setitem__("nextTaskId", "Q010-RESEARCH-ARCHIVE-DISCOVERY"),
    }
    kills = {}
    for name, mutate in mutations.items():
        item = copy.deepcopy(projection)
        mutate(item)
        try:
            validate_projection(item)
        except (StateError, KeyError, TypeError, ValueError):
            kills[name] = True
        else:
            kills[name] = False
    tampered_events = copy.deepcopy(events)
    tampered_events[-1]["payload"].pop("operationalProjection")
    try:
        materialize_state(contract, event_raw, tampered_events, input_raw, bundle)
    except (StateError, KeyError, TypeError, ValueError):
        kills["missingReplayProjection"] = True
    else:
        kills["missingReplayProjection"] = False
    if not all(kills.values()):
        fail(f"self-test survivors: {sorted(key for key, value in kills.items() if not value)}")
    return {"schema": "early-detection-free-source-operational-state-self-test/v14", "status": "PASS", "killCount": len(kills), "kills": kills, "outcomesAccessed": False}


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    for command in ("verify", "next"):
        child = sub.add_parser(command)
        child.add_argument("--remote", action="store_true")
    sub.add_parser("self-test")
    args = parser.parse_args()
    try:
        if args.command == "self-test":
            result = self_test()
        else:
            result = verify(args.remote)
            if args.command == "next":
                if result["phase"] != "POST_INTRODUCTION" or result["controllerResumeAllowed"] is not True:
                    fail("next is forbidden before remote POST_INTRODUCTION")
                result = {"schema": "early-detection-free-source-next/v14", "status": "PASS", "nextTaskId": result["nextTaskId"], "remoteVerified": True, "postIntroductionVerified": True, "q002AutoNext": False, "outcomesAccessed": False}
    except (StateError, OSError, KeyError, TypeError, ValueError, json.JSONDecodeError, subprocess.CalledProcessError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
