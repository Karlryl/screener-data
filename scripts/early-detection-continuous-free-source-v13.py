#!/usr/bin/env python3
"""Read-only, fail-closed controller for the append-only V13 operational state."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research/early-detection-v4/continuous-free-source-operational-state-contract-v13.json"
EVENTS = ROOT / "state/early-detection-free-source-events-v13.jsonl"
STATE = ROOT / "state/early-detection-free-source-state-v13.json"
REMOTE = "https://github.com/Karlryl/screener-data.git"
REF = "refs/heads/codex/early-detection-v4-gates-20260810"


class StateError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise StateError(message)


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def read_exact(path: Path, expected: str) -> bytes:
    raw = path.read_bytes()
    if sha(raw) != expected:
        fail(f"raw bytes changed: {path.relative_to(ROOT).as_posix()}")
    return raw


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def parse_events(raw: bytes) -> list[dict]:
    rows = [json.loads(line) for line in raw.decode().splitlines() if line]
    if len(rows) != 2:
        fail("event count changed")
    for index, row in enumerate(rows):
        claim = row.get("eventSha256")
        item = copy.deepcopy(row)
        item.pop("eventSha256", None)
        if claim != sha(canonical(item)):
            fail("event self hash changed")
        if row.get("sequence") != index + 1:
            fail("event sequence changed")
        if index and row.get("previousEventSha256") != rows[index - 1]["eventSha256"]:
            fail("event hash chain changed")
    return rows


def validate_state(state: dict, contract: dict, events: list[dict]) -> None:
    claim = state.get("stateSha256")
    item = copy.deepcopy(state)
    item.pop("stateSha256", None)
    if claim != sha(canonical(item)) or claim != contract["outputs"]["stateSelfSha256"]:
        fail("state self hash changed")
    expected_tasks = contract["queueContract"]["taskIds"]
    tasks = state.get("tasks")
    if not isinstance(tasks, list) or [row.get("taskId") for row in tasks] != expected_tasks:
        fail("Q001-Q010 conservation changed")
    if len(set(expected_tasks)) != 10:
        fail("task ids are not unique")
    if state.get("taskCounts", {}).get("RESOLVED") != 0:
        fail("resolved task credit is forbidden")
    by_id = {row["taskId"]: row for row in tasks}
    for task_id in (expected_tasks[0], expected_tasks[1]):
        if by_id[task_id].get("operationalState") != "RIGHTS_BLOCKED_EXPORT" or by_id[task_id].get("schedulerEligible") is not False:
            fail("QuantConnect rights block changed")
    if by_id[expected_tasks[6]].get("operationalState") != "MILESTONE_COMPLETE_NO_INTERVAL_CREDIT" or by_id[expected_tasks[6]].get("schedulerEligible") is not False:
        fail("OpenFIGI point-only boundary changed")
    if by_id[expected_tasks[8]].get("operationalState") != "EXTERNAL_DEFERRED" or by_id[expected_tasks[8]].get("schedulerEligible") is not False:
        fail("Alpha Vantage deferral changed")
    scheduler = state.get("scheduler", {})
    if scheduler.get("eligibleTaskIds") != contract["queueContract"]["eligibleTaskIds"]:
        fail("eligible queue changed")
    if scheduler.get("nextTaskId") != contract["queueContract"]["nextTaskId"] or scheduler.get("q002AutoNextForbidden") is not True:
        fail("scheduler next changed")
    lanes = state.get("q005Sublanes")
    if [row.get("laneId") for row in lanes or []] != ["NASDAQ", "NYSE", "NYSE_AMERICAN", "CBOE"]:
        fail("Q005 sublanes changed")
    if not all(row.get("schedulerEligible") is True for row in lanes):
        fail("Q005 open sublane changed")
    if events[-1]["eventSha256"] != state["eventLog"]["lastEventSha256"]:
        fail("state event pointer changed")
    projection_keys = [
        "taskCounts", "tasks", "q005Sublanes", "scheduler", "operationalMilestones",
        "milestoneClaimLocks", "lockedStudies", "originalV4", "scientificLocks",
    ]
    projection = {key: state[key] for key in projection_keys}
    projection_sha = sha(canonical(projection))
    if projection_sha != contract["outputs"]["operationalProjectionSha256"]:
        fail("operational projection changed")
    if events[-1]["payload"].get("operationalProjectionSha256") != projection_sha:
        fail("event does not bind operational projection")
    if state["eventLog"].get("operationalProjectionSha256") != projection_sha:
        fail("state does not bind operational projection")
    if events[-1]["payload"].get("replacementStatePath") != STATE.relative_to(ROOT).as_posix():
        fail("state path changed")
    locks = state.get("scientificLocks", {})
    false_locks = [
        "proposalExecutionAuthorized", "resultComputationAllowed", "originalV4GateCredit",
        "fiveRequiredDataSemanticsComplete", "fullDataAiProtocolSealAllowed",
        "reserved2021To2024OpenedForHypothesisGeneration", "humanAttestation",
        "pricesAccessed", "returnsAccessed", "outcomesAccessed",
    ]
    if any(locks.get(key) is not False for key in false_locks) or locks.get("studyCredit") != "NONE":
        fail("scientific lock changed")
    original = state.get("originalV4", {})
    if original.get("greenOfficialGates") != 2 or original.get("officialGateCount") != 13 or original.get("complete") is not False:
        fail("Original V4 boundary changed")


def verify(remote: bool) -> dict:
    contract = json.loads(CONTRACT.read_bytes())
    outputs = contract["outputs"]
    inputs = contract["inputs"]
    event_raw = read_exact(EVENTS, outputs["eventLogRawSha256"])
    state_raw = read_exact(STATE, outputs["stateRawSha256"])
    paths = [
        ("policyPath", "policyRawSha256"), ("queueSeedPath", "queueSeedRawSha256"),
        ("registryPath", "registryRawSha256"), ("v12ControllerPath", "v12ControllerRawSha256"),
        ("v12TestPath", "v12TestRawSha256"), ("v12EventLogPath", "v12EventLogRawSha256"),
        ("v12StatePath", "v12StateRawSha256"), ("resumeV4ContractPath", "resumeV4ContractRawSha256"),
    ]
    for path_key, sha_key in paths:
        read_exact(ROOT / inputs[path_key], inputs[sha_key])
    events = parse_events(event_raw)
    state = json.loads(state_raw)
    validate_state(state, contract, events)
    if state["eventLog"]["rawSha256"] != sha(event_raw) or state["eventLog"]["eventCount"] != len(events):
        fail("event log binding changed")
    if state["inputBundleSha256"] != inputs["inputBundleSha256"] or events[-1]["inputBundleSha256"] != inputs["inputBundleSha256"]:
        fail("input bundle changed")
    if not git("merge-base", "--is-ancestor", contract["repository"]["minimumAncestor"], "HEAD") == "":
        fail("minimum ancestor changed")
    phase = "PRE_INTRODUCTION"
    authorized = contract["repository"]["authorizedPaths"]
    present = [
        path for path in authorized
        if subprocess.run(
            ["git", "cat-file", "-e", f"HEAD:{path}"], cwd=ROOT,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        ).returncode == 0
    ]
    if present:
        if present != authorized:
            fail("partial V13 introduction")
        phase = "POST_INTRODUCTION"
        for path in authorized:
            if subprocess.check_output(["git", "show", f"HEAD:{path}"], cwd=ROOT) != (ROOT / path).read_bytes():
                fail("HEAD blob differs from worktree")
    if remote:
        if git("remote", "get-url", "origin") != REMOTE:
            fail("origin changed")
        head = git("rev-parse", "HEAD")
        upstream = git("rev-parse", "@{u}")
        remote_head = git("ls-remote", "origin", REF).split()[0]
        if not head == upstream == remote_head:
            fail("HEAD/upstream/remote drift")
    return {
        "schema": "early-detection-free-source-operational-state-verification/v13",
        "status": "PASS", "phase": phase, "eventCount": 2,
        "tasksConserved": 10, "resolvedTasks": 0,
        "eligibleTasks": 4, "nextTaskId": state["scheduler"]["nextTaskId"],
        "q002AutoNext": False, "originalV4GreenOfficialGates": 2,
        "originalV4OfficialGateCount": 13, "outcomesAccessed": False,
    }


def self_test() -> dict:
    contract = json.loads(CONTRACT.read_bytes())
    state = json.loads(STATE.read_bytes())
    events = parse_events(EVENTS.read_bytes())
    mutations = {
        "dropTask": lambda x: x["tasks"].pop(),
        "resolveTask": lambda x: x["taskCounts"].__setitem__("RESOLVED", 1),
        "q002AutoNext": lambda x: x["scheduler"].__setitem__("nextTaskId", "Q002-QUANTCONNECT-50-CASE-CONTRACT"),
        "q002Eligible": lambda x: x["tasks"][1].__setitem__("schedulerEligible", True),
        "q007IntervalCredit": lambda x: x["tasks"][6].__setitem__("operationalState", "AUTONOMOUS_OPEN"),
        "dropCboe": lambda x: x["q005Sublanes"].pop(),
        "outcomes": lambda x: x["scientificLocks"].__setitem__("outcomesAccessed", True),
        "identityCredit": lambda x: x["milestoneClaimLocks"].__setitem__("historicalIdentityResolved", True),
        "originalV4": lambda x: x["originalV4"].__setitem__("greenOfficialGates", 3),
    }
    kills = {}
    for name, mutate in mutations.items():
        item = copy.deepcopy(state)
        mutate(item)
        item.pop("stateSha256", None)
        item["stateSha256"] = sha(canonical(item))
        try:
            validate_state(item, contract, events)
        except (StateError, KeyError, TypeError, ValueError):
            kills[name] = True
        else:
            kills[name] = False
    if not all(kills.values()):
        fail(f"self-test survivors: {sorted(key for key, value in kills.items() if not value)}")
    return {"schema": "early-detection-free-source-operational-state-self-test/v13", "status": "PASS", "killCount": len(kills), "kills": kills, "outcomesAccessed": False}


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    for command in ("verify", "next", "self-test"):
        child = sub.add_parser(command)
        child.add_argument("--remote", action="store_true")
    args = parser.parse_args()
    try:
        if args.command == "self-test":
            result = self_test()
        else:
            result = verify(args.remote)
            if args.command == "next":
                result = {"schema": "early-detection-free-source-next/v13", "status": "PASS", "nextTaskId": result["nextTaskId"], "q002AutoNext": False, "outcomesAccessed": False}
    except (StateError, OSError, KeyError, TypeError, ValueError, json.JSONDecodeError, subprocess.CalledProcessError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
