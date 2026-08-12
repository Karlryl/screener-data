#!/usr/bin/env python3
"""Fail-closed V10 controller: exact notes and truthful lease-recovery time."""
from __future__ import annotations

import hashlib
import json
import subprocess
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
V8_PATH = ROOT / "scripts" / "early-detection-continuous-free-source-v8.py"
FAILED_V9_PATH = ROOT / "scripts" / "early-detection-continuous-free-source-v9.py"
TEST_PATH = ROOT / "tests" / "early-detection-continuous-free-source-v10.test.js"
V8_SHA256 = "6cd0380e6088782ed9a7deebe759d62754d3b38165b38704196848a36d1645fa"
FAILED_V9_SHA256 = "e29c8957d5a736f6657c84322e90c2826f0fb03947e871176d3b7a6dff28616d"
ALLOWED_TRANSITION_NOTES = {
    ("CLAIMED", "READY", "WORK_CHUNK_COMPLETE"): "OUTCOME_BLIND_WORK_CHUNK_COMPLETE",
    ("CLAIMED", "RATE_DEFERRED", "PROVIDER_RATE_LIMIT"): "RATE_LIMIT_RECORDED;QUEUE_SWITCH_REQUIRED",
    ("RATE_DEFERRED", "READY", "RATE_WINDOW_REOPENED"): "RATE_WINDOW_REOPENED;NO_OUTCOME_ACCESS",
    ("CLAIMED", "NOT_FOUND", "SOURCE_EXHAUSTED"): "SOURCE_EXHAUSTED_WITH_BOUND_NEGATIVE_EVIDENCE",
    ("CLAIMED", "NOT_ENTITLED", "FREE_TIER_NOT_ENTITLED"): "FREE_TIER_NOT_ENTITLED;NO_PREMIUM_ACCESS",
    ("CLAIMED", "LICENSE_BLOCKED", "LICENSE_NOT_ELIGIBLE"): "LICENSE_NOT_ELIGIBLE_FOR_INTERNAL_REPRODUCTION",
    ("CLAIMED", "AMBIGUOUS", "EVIDENCE_AMBIGUOUS"): "EVIDENCE_AMBIGUOUS;FAIL_CLOSED",
    ("CLAIMED", "CONFLICT", "EVIDENCE_CONFLICT"): "EVIDENCE_CONFLICT;FAIL_CLOSED",
    ("CLAIMED", "REJECTED", "METHOD_REJECTED"): "METHOD_CONTRACT_NOT_SATISFIED",
    ("READY", "REJECTED", "TASK_REJECTED"): "TASK_REJECTED_WITHOUT_OUTCOME_CREDIT",
    ("USER_ACTION_REQUIRED", "REJECTED", "ACCESS_REJECTED"): "FREE_ACCESS_NOT_CONFIRMED",
    ("CLAIMED", "READY", "LEASE_EXPIRED_RECOVERY"): "EXPIRED_LEASE_RELEASED;NO_EVIDENCE_OR_OUTCOME_CREDIT",
}

v8_source = V8_PATH.read_bytes()
if hashlib.sha256(v8_source).hexdigest() != V8_SHA256:
    raise RuntimeError("immutable V8 controller bytes changed before import")
if hashlib.sha256(FAILED_V9_PATH.read_bytes()).hexdigest() != FAILED_V9_SHA256:
    raise RuntimeError("superseded V9 record changed")
v8 = types.ModuleType("free_source_v8")
v8.__file__ = str(V8_PATH)
exec(compile(v8_source, str(V8_PATH), "exec"), v8.__dict__)
v7 = v8.v7; base = v8.base

base.SCRIPT_PATH = Path(__file__).resolve(); base.TEST_PATH = TEST_PATH
base.DEFAULT_EVENTS_PATH = ROOT / "state" / "early-detection-free-source-events-v10.jsonl"
base.DEFAULT_STATE_PATH = ROOT / "state" / "early-detection-free-source-state-v10.json"
base.LOCK_PATH = ROOT / "state" / ".early-detection-free-source-controller-v10.lock"
V8_VALIDATE_CONTRACTS = v8.validate_contracts
V8_VALIDATE_EVENTS = v8.validate_v8_events
V8_MATERIALIZE_STATE = v8.materialize_state_v8


def fail(message: str) -> None:
    raise base.ControllerError(message)


def validate_state_paths_v10(events_path: Path, state_path: Path) -> tuple[Path, Path]:
    events, state = base.validate_state_paths(events_path, state_path)
    if events != base.DEFAULT_EVENTS_PATH.resolve() or state != base.DEFAULT_STATE_PATH.resolve():
        fail("V10 accepts only the single frozen event/state path pair")
    return events, state


def validate_contracts() -> dict:
    contracts = V8_VALIDATE_CONTRACTS()
    contracts["rawBindings"].update({
        "controller": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "controllerTest": hashlib.sha256(TEST_PATH.read_bytes()).hexdigest(),
        "v8Controller": V8_SHA256, "supersededV9Controller": FAILED_V9_SHA256,
    })
    contracts["inputBundleSha256"] = base.canonical_sha256(contracts["rawBindings"])
    return contracts


def materialize_state_v10(contracts: dict, events: list[dict], events_raw: bytes) -> dict:
    state = V8_MATERIALIZE_STATE(contracts, events, events_raw)
    state["materializedAt"] = events[-1]["createdAt"]
    state["stateSha256"] = None
    state["stateSha256"] = base.canonical_sha256({key:value for key,value in state.items() if key != "stateSha256"})
    return state


def validate_transition_templates(events: list[dict]) -> None:
    for event in events:
        if event["eventType"] != "TASK_TRANSITIONED":
            continue
        payload = event["payload"]
        key = (payload["fromState"], payload["toState"], payload["reasonCode"])
        if key not in ALLOWED_TRANSITION_NOTES or payload["note"] != ALLOWED_TRANSITION_NOTES[key]:
            fail("transition reason/note is not an exact outcome-blind template")


def validate_v10_events(events: list[dict], state: dict) -> None:
    V8_VALIDATE_EVENTS(events, state)
    commit = v7.git_commit_authorized(events[0]["payload"]["baseCommit"])
    for path, expected in ((Path(__file__).resolve(), None), (TEST_PATH, None),
                           (V8_PATH, V8_SHA256), (FAILED_V9_PATH, FAILED_V9_SHA256)):
        raw = path.read_bytes()
        if expected and hashlib.sha256(raw).hexdigest() != expected:
            fail(f"frozen bytes changed: {path.name}")
        if base.git_bytes("show", f"{commit}:{path.relative_to(ROOT).as_posix()}") != raw:
            fail(f"genesis does not bind exact bytes: {path.name}")
    validate_transition_templates(events)
    if state["materializedAt"] != events[-1]["createdAt"]:
        fail("materializedAt differs from the actual final event time")


base.materialize_state = materialize_state_v10
base.validate_contracts = validate_contracts
v7.validate_contracts = validate_contracts
v7.validate_state_paths_v7 = validate_state_paths_v10
v8.validate_contracts = validate_contracts
v8.validate_state_paths_v8 = validate_state_paths_v10
v8.validate_v8_events = validate_v10_events


def verify_current(events_path: Path, state_path: Path, *, heal: bool=False):
    events_path,state_path=validate_state_paths_v10(events_path,state_path)
    contracts,events,state=base.verify_current(events_path,state_path,heal=heal)
    validate_v10_events(events,state)
    return contracts,events,state


def self_test() -> dict:
    contracts=validate_contracts(); created="2026-08-12T00:00:00Z"
    genesis=base.make_event(sequence=1,previous_sha=None,created_at=created,agent_id="V10-SELFTEST",run_id="V10-SELFTEST-RUN",task_id=None,event_type="QUEUE_INITIALIZED",fencing_token=0,input_bundle_sha=contracts["inputBundleSha256"],payload={"queueSeedRawSha256":contracts["rawBindings"]["queueSeed"],"repositoryRemote":v7.AUTHORIZED_REMOTE,"baseCommit":base.git_text("rev-parse","HEAD"),"controllerRawSha256":contracts["rawBindings"]["controller"],"controllerTestRawSha256":contracts["rawBindings"]["controllerTest"]})
    task_id="Q003-SEC-TERMINAL-WEALTH-QUEUE"
    claim=base.make_event(sequence=2,previous_sha=genesis["eventSha256"],created_at="2026-08-12T00:01:00Z",agent_id="V10-CLAIMER",run_id="V10-CLAIMER-RUN",task_id=task_id,event_type="TASK_CLAIMED",fencing_token=1,input_bundle_sha=contracts["inputBundleSha256"],payload={"fromState":"READY","toState":"CLAIMED","leaseExpiresAt":"2026-08-12T00:02:00Z"})
    recovery=base.make_event(sequence=3,previous_sha=claim["eventSha256"],created_at="2026-08-12T00:30:00Z",agent_id="V10-RECOVERY",run_id="V10-RECOVERY-RUN",task_id=task_id,event_type="TASK_TRANSITIONED",fencing_token=1,input_bundle_sha=contracts["inputBundleSha256"],payload={"fromState":"CLAIMED","toState":"READY","reasonCode":v8.RECOVERY_REASON,"note":v8.RECOVERY_NOTE})
    events=[genesis,claim,recovery]; raw=b"".join(base.canonical_bytes(event)+b"\n" for event in events)
    state=materialize_state_v10(contracts,events,raw); validate_transition_templates(events)
    arbitrary=("outcome=positive","outcomePositive","profitability high","significant effect","win rate 75 percent","result=PASS")
    arbitrary_rejected=True
    for note in arbitrary:
        poisoned=json.loads(json.dumps(events)); poisoned[-1]["payload"]["note"]=note
        try: validate_transition_templates(poisoned)
        except base.ControllerError: continue
        arbitrary_rejected=False
    return {"status":"PASS","truthfulMaterializedAt":state["materializedAt"]=="2026-08-12T00:30:00Z","expiredLeaseRecovered":next(row for row in state["tasks"] if row["taskId"]==task_id)["state"]=="READY","exactTransitionTemplatesRejectArbitraryText":arbitrary_rejected,"v8PreImportBytesBound":hashlib.sha256(v8_source).hexdigest()==V8_SHA256,"supersededV9Bound":hashlib.sha256(FAILED_V9_PATH.read_bytes()).hexdigest()==FAILED_V9_SHA256,"outcomesAccessed":False}


def main() -> int:
    parser=base.build_parser(); args=parser.parse_args()
    try:
        if args.command=="init": result=v7.command_init(args)
        elif args.command=="verify":
            contracts,events,state=verify_current(Path(args.events),Path(args.state),heal=args.heal); v7.require_remote_queue_snapshot(Path(args.events),Path(args.state))
            result={"status":"PASS","inputBundleSha256":contracts["inputBundleSha256"],"eventCount":len(events),"lastEventSha256":events[-1]["eventSha256"],"stateSha256":state["stateSha256"],"tasks":len(state["tasks"]),"taskCounts":state["taskCounts"],"originalV4GreenGates":state["originalV4"]["greenOfficialGates"],"originalV4Complete":state["originalV4"]["complete"],"outcomesAccessed":False}
        elif args.command=="next":
            _,events,state=verify_current(Path(args.events),Path(args.state)); v7.require_remote_queue_snapshot(Path(args.events),Path(args.state)); ready=sorted((row for row in state["tasks"] if row["state"]=="READY"),key=lambda row:(-row["priority"],row["taskId"])); result={"status":"PASS","lastEventSha256":events[-1]["eventSha256"],"nextTask":ready[0] if ready else None,"readyTasks":len(ready),"outcomesAccessed":False}
        elif args.command=="claim": result=v7.command_claim(args)
        elif args.command=="transition":
            _,_,state=verify_current(Path(args.events),Path(args.state)); task=next((row for row in state["tasks"] if row["taskId"]==args.task_id),None)
            if task is None: fail("unknown task")
            key=(task["state"],args.to_state,args.reason_code)
            if key not in ALLOWED_TRANSITION_NOTES or args.note!=ALLOWED_TRANSITION_NOTES[key]: fail("transition must use an exact outcome-blind template")
            result=v7.command_transition(args)
        elif args.command=="capture": result=v7.command_capture(args)
        elif args.command=="self-test": result=self_test()
        else: fail("unsupported V10 command")
    except (base.ControllerError,subprocess.CalledProcessError,KeyError,ValueError,OSError) as exc: parser.error(str(exc))
    print(json.dumps(result,ensure_ascii=False,sort_keys=True)); return 0

if __name__=="__main__": raise SystemExit(main())
