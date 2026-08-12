#!/usr/bin/env python3
"""Fail-closed V8 controller with deterministic expired-lease recovery."""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
V7_PATH = ROOT / "scripts" / "early-detection-continuous-free-source-v7.py"
TEST_PATH = ROOT / "tests" / "early-detection-continuous-free-source-v8.test.js"
Q003_CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-terminal-wealth-queue-contract-v4.json"
Q003_BUILDER = ROOT / "scripts" / "build-sec-terminal-wealth-queue-v4.py"
Q003_TEST = ROOT / "tests" / "build-sec-terminal-wealth-queue-v4.test.js"
V7_SHA256 = "090c3f2bbbd4625e7dd42ac9872ca50799e919cbbfe4fec508c79ed2d597da61"
Q003_CONTRACT_SHA256 = "a776528e4ab488ddafaecf857fac8436c3c2f85731b846ef9862fb18cb4ce96c"
RECOVERY_REASON = "LEASE_EXPIRED_RECOVERY"
RECOVERY_NOTE = "EXPIRED_LEASE_RELEASED;NO_EVIDENCE_OR_OUTCOME_CREDIT"
GENERIC_OUTCOME_TOKENS = {
    "RESULT", "ANALYSIS_RESULT", "STUDY_RESULT", "STUDY_PASSED", "PASSED_GATE",
    "PROFIT", "LOSS", "PERFORMANCE", "POSITIVE_RESULT", "NEGATIVE_RESULT",
}

v7_source = V7_PATH.read_bytes()
if hashlib.sha256(v7_source).hexdigest() != V7_SHA256:
    raise RuntimeError("immutable V7 controller bytes changed before import")
v7 = types.ModuleType("free_source_v7")
v7.__file__ = str(V7_PATH)
exec(compile(v7_source, str(V7_PATH), "exec"), v7.__dict__)
base = v7.base

base.SCRIPT_PATH = Path(__file__).resolve()
base.TEST_PATH = TEST_PATH
base.DEFAULT_EVENTS_PATH = ROOT / "state" / "early-detection-free-source-events-v8.jsonl"
base.DEFAULT_STATE_PATH = ROOT / "state" / "early-detection-free-source-state-v8.json"
base.LOCK_PATH = ROOT / "state" / ".early-detection-free-source-controller-v8.lock"
V7_VALIDATE_EVENTS = v7.validate_v4_events
BASE_MATERIALIZE_STATE = base.materialize_state


def fail(message: str) -> None:
    raise base.ControllerError(message)


def raw_sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate_state_paths_v8(events_path: Path, state_path: Path) -> tuple[Path, Path]:
    events, state = base.validate_state_paths(events_path, state_path)
    if events != base.DEFAULT_EVENTS_PATH.resolve() or state != base.DEFAULT_STATE_PATH.resolve():
        fail("V8 accepts only the single frozen event/state path pair")
    return events, state


def validate_contracts() -> dict:
    contracts = v7.BASE_VALIDATE_CONTRACTS()
    if raw_sha(V7_PATH) != V7_SHA256 or raw_sha(Q003_CONTRACT) != Q003_CONTRACT_SHA256:
        fail("V7 or Q003 authorized bytes changed")
    v7.validate_hypothesis_blindness(contracts["hypotheses"])
    contracts["rawBindings"].update({
        "controller": raw_sha(Path(__file__).resolve()), "controllerTest": raw_sha(TEST_PATH),
        "baseController": v7.BASE_CONTROLLER_SHA256, "v7Controller": V7_SHA256,
        "q003ContractV4": Q003_CONTRACT_SHA256, "q003BuilderV4": raw_sha(Q003_BUILDER),
        "q003TestV4": raw_sha(Q003_TEST),
    })
    contracts["inputBundleSha256"] = base.canonical_sha256(contracts["rawBindings"])
    return contracts


def recovery_claim(events: list[dict], index: int, task_id: str) -> dict:
    state = None
    claim = None
    for event in events[:index]:
        if event.get("taskId") != task_id:
            continue
        if event["eventType"] == "TASK_CLAIMED":
            state = "CLAIMED"; claim = event
        elif event["eventType"] == "TASK_TRANSITIONED":
            state = event["payload"]["toState"]
    if state != "CLAIMED" or claim is None:
        fail("lease recovery requires an actively claimed task")
    return claim


def materialize_state_v8(contracts: dict, events: list[dict], events_raw: bytes) -> dict:
    transformed = json.loads(json.dumps(events))
    for index, event in enumerate(events):
        if event["eventType"] != "TASK_TRANSITIONED" or event["payload"].get("reasonCode") != RECOVERY_REASON:
            continue
        claim = recovery_claim(events, index, event["taskId"])
        if event["payload"] != {
            "fromState": "CLAIMED", "toState": "READY", "reasonCode": RECOVERY_REASON,
            "note": RECOVERY_NOTE,
        }:
            fail("expired-lease recovery payload changed")
        if event["fencingToken"] != claim["fencingToken"]:
            fail("expired-lease recovery fencing token changed")
        lease = claim["payload"]["leaseExpiresAt"]
        if base.parse_z(event["createdAt"], "recovery.createdAt") <= base.parse_z(lease, "leaseExpiresAt"):
            fail("lease recovery happened before expiry")
        transformed[index]["createdAt"] = lease
        transformed[index]["agentId"] = claim["agentId"]
        transformed[index]["runId"] = claim["runId"]
    return BASE_MATERIALIZE_STATE(contracts, transformed, events_raw)


def validate_v8_events(events: list[dict], state: dict) -> None:
    V7_VALIDATE_EVENTS(events, state)
    genesis = events[0]
    commit = v7.git_commit_authorized(genesis["payload"]["baseCommit"])
    bindings = ((Path(__file__).resolve(), None), (TEST_PATH, None), (V7_PATH, V7_SHA256),
                (Q003_CONTRACT, Q003_CONTRACT_SHA256), (Q003_BUILDER, None), (Q003_TEST, None))
    for path, expected in bindings:
        raw = path.read_bytes()
        if expected is not None and hashlib.sha256(raw).hexdigest() != expected:
            fail(f"frozen byte hash changed: {path.name}")
        if base.git_bytes("show", f"{commit}:{path.relative_to(ROOT).as_posix()}") != raw:
            fail(f"genesis does not bind exact byte: {path.name}")
    for event in events:
        if event["eventType"] == "TASK_TRANSITIONED":
            inspected = {"reasonCode": event["payload"]["reasonCode"], "note": event["payload"]["note"]}
            if v7.text_has_token(inspected, GENERIC_OUTCOME_TOKENS | v7.FORBIDDEN_EVIDENCE_TOKENS):
                if event["payload"].get("reasonCode") != RECOVERY_REASON:
                    fail("transition contains generic outcome-sensitive text")


base.materialize_state = materialize_state_v8
base.validate_contracts = validate_contracts
v7.validate_contracts = validate_contracts
v7.validate_state_paths_v7 = validate_state_paths_v8
v7.validate_v4_events = validate_v8_events


def verify_current(events_path: Path, state_path: Path, *, heal: bool = False):
    return v7.verify_current(events_path, state_path, heal=heal)


def self_test() -> dict:
    contracts = validate_contracts()
    created = "2026-08-12T00:00:00Z"
    genesis = base.make_event(sequence=1, previous_sha=None, created_at=created,
        agent_id="V8-SELFTEST", run_id="V8-SELFTEST-RUN", task_id=None,
        event_type="QUEUE_INITIALIZED", fencing_token=0,
        input_bundle_sha=contracts["inputBundleSha256"], payload={
            "queueSeedRawSha256": contracts["rawBindings"]["queueSeed"],
            "repositoryRemote": v7.AUTHORIZED_REMOTE, "baseCommit": base.git_text("rev-parse", "HEAD"),
            "controllerRawSha256": contracts["rawBindings"]["controller"],
            "controllerTestRawSha256": contracts["rawBindings"]["controllerTest"],
        })
    task_id = "Q003-SEC-TERMINAL-WEALTH-QUEUE"
    claim = base.make_event(sequence=2, previous_sha=genesis["eventSha256"], created_at="2026-08-12T00:01:00Z",
        agent_id="V8-CLAIMER", run_id="V8-CLAIMER-RUN", task_id=task_id, event_type="TASK_CLAIMED",
        fencing_token=1, input_bundle_sha=contracts["inputBundleSha256"],
        payload={"fromState":"READY", "toState":"CLAIMED", "leaseExpiresAt":"2026-08-12T00:02:00Z"})
    recovery = base.make_event(sequence=3, previous_sha=claim["eventSha256"], created_at="2026-08-12T00:03:00Z",
        agent_id="V8-RECOVERY", run_id="V8-RECOVERY-RUN", task_id=task_id, event_type="TASK_TRANSITIONED",
        fencing_token=1, input_bundle_sha=contracts["inputBundleSha256"], payload={
            "fromState":"CLAIMED", "toState":"READY", "reasonCode":RECOVERY_REASON, "note":RECOVERY_NOTE})
    events = [genesis, claim, recovery]
    raw = b"".join(base.canonical_bytes(event) + b"\n" for event in events)
    state = materialize_state_v8(contracts, events, raw)
    recovered = next(row for row in state["tasks"] if row["taskId"] == task_id)
    generic_rejected = all(v7.text_has_token({"note": text}, GENERIC_OUTCOME_TOKENS) for text in (
        "result=PASS", "analysis result positive", "study passed gate", "profit=42 percent",
    ))
    return {"status":"PASS", "expiredLeaseRecovered":recovered["state"] == "READY",
            "recoveryFencingPreserved":recovered["fencingToken"] == 1,
            "genericOutcomeTermsRejected":generic_rejected,
            "q003ContractBound":raw_sha(Q003_CONTRACT) == Q003_CONTRACT_SHA256,
            "v7PreImportBytesBound":hashlib.sha256(v7_source).hexdigest() == V7_SHA256,
            "outcomesAccessed":False}


def main() -> int:
    parser = base.build_parser(); args = parser.parse_args()
    try:
        if args.command == "init": result = v7.command_init(args)
        elif args.command == "verify":
            contracts, events, state = verify_current(Path(args.events), Path(args.state), heal=args.heal)
            v7.require_remote_queue_snapshot(Path(args.events), Path(args.state))
            result={"status":"PASS","inputBundleSha256":contracts["inputBundleSha256"],"eventCount":len(events),
                    "lastEventSha256":events[-1]["eventSha256"],"stateSha256":state["stateSha256"],
                    "tasks":len(state["tasks"]),"taskCounts":state["taskCounts"],
                    "originalV4GreenGates":state["originalV4"]["greenOfficialGates"],
                    "originalV4Complete":state["originalV4"]["complete"],"outcomesAccessed":False}
        elif args.command == "next":
            _, events, state=verify_current(Path(args.events),Path(args.state)); v7.require_remote_queue_snapshot(Path(args.events),Path(args.state))
            ready=sorted((row for row in state["tasks"] if row["state"]=="READY"),key=lambda row:(-row["priority"],row["taskId"]))
            result={"status":"PASS","lastEventSha256":events[-1]["eventSha256"],"nextTask":ready[0] if ready else None,"readyTasks":len(ready),"outcomesAccessed":False}
        elif args.command == "claim": result=v7.command_claim(args)
        elif args.command == "transition": result=v7.command_transition(args)
        elif args.command == "capture": result=v7.command_capture(args)
        elif args.command == "self-test": result=self_test()
        else: fail("unsupported V8 command")
    except (base.ControllerError, subprocess.CalledProcessError, KeyError, ValueError, OSError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, ensure_ascii=False, sort_keys=True)); return 0


if __name__ == "__main__":
    raise SystemExit(main())
