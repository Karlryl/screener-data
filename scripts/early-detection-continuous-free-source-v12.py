#!/usr/bin/env python3
"""Fail-closed V12 controller: V11 semantics plus exact Q003-V5 trust binding."""
from __future__ import annotations

import hashlib
import json
import subprocess
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
V11_PATH = ROOT / "scripts" / "early-detection-continuous-free-source-v11.py"
TEST_PATH = ROOT / "tests" / "early-detection-continuous-free-source-v12.test.js"
Q003_CONTRACT_PATH = ROOT / "research" / "early-detection-v4" / "sec-terminal-wealth-queue-contract-v5.json"
Q003_BUILDER_PATH = ROOT / "scripts" / "build-sec-terminal-wealth-queue-v5.py"
Q003_TEST_PATH = ROOT / "tests" / "build-sec-terminal-wealth-queue-v5.test.js"
V11_SHA256 = "cdddf7d75949b990bb711ac20a918a4c5602a885022c30f6cb8b14ffb75064af"
Q003_CONTRACT_SHA256 = "ea9f1c09a5e2e1536513e53677c941ca8ce737b9d867f330b3052e26515e8124"
Q003_BUILDER_SHA256 = "e54c04a5abf798f2836dbc27e6821aad0befc8d6733c623fc9893c02b21ad9f4"
Q003_TEST_SHA256 = "b1782bfd19b3142592782bcac0e591e6e3b00e4c03998854142019cf32d0c74e"


def checked_bytes(path: Path, expected: str) -> bytes:
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != expected:
        raise RuntimeError(f"frozen bytes changed before import: {path.name}")
    return raw


v11_source = checked_bytes(V11_PATH, V11_SHA256)
checked_bytes(Q003_CONTRACT_PATH, Q003_CONTRACT_SHA256)
checked_bytes(Q003_BUILDER_PATH, Q003_BUILDER_SHA256)
checked_bytes(Q003_TEST_PATH, Q003_TEST_SHA256)
v11 = types.ModuleType("free_source_v11")
v11.__file__ = str(V11_PATH)
exec(compile(v11_source, str(V11_PATH), "exec"), v11.__dict__)
base = v11.base
v7 = v11.v7
v8 = v11.v8
V11_VALIDATE_CONTRACTS = v11.validate_contracts
V11_VALIDATE_EVENTS = v11.validate_v10_events

base.SCRIPT_PATH = Path(__file__).resolve()
base.TEST_PATH = TEST_PATH
base.DEFAULT_EVENTS_PATH = ROOT / "state" / "early-detection-free-source-events-v12.jsonl"
base.DEFAULT_STATE_PATH = ROOT / "state" / "early-detection-free-source-state-v12.json"
base.LOCK_PATH = ROOT / "state" / ".early-detection-free-source-controller-v12.lock"


def fail(message: str) -> None:
    raise base.ControllerError(message)


def validate_state_paths_v12(events_path: Path, state_path: Path) -> tuple[Path, Path]:
    events, state = base.validate_state_paths(events_path, state_path)
    if events != base.DEFAULT_EVENTS_PATH.resolve() or state != base.DEFAULT_STATE_PATH.resolve():
        fail("V12 accepts only the single frozen event/state path pair")
    return events, state


def validate_contracts() -> dict:
    contracts = V11_VALIDATE_CONTRACTS()
    contracts["rawBindings"].update({
        "controller": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "controllerTest": hashlib.sha256(TEST_PATH.read_bytes()).hexdigest(),
        "v11Controller": V11_SHA256,
        "q003ContractV5": Q003_CONTRACT_SHA256,
        "q003BuilderV5": Q003_BUILDER_SHA256,
        "q003TestV5": Q003_TEST_SHA256,
    })
    contracts["inputBundleSha256"] = base.canonical_sha256(contracts["rawBindings"])
    return contracts


def materialize_state_v12(contracts: dict, events: list[dict], events_raw: bytes) -> dict:
    return v11.materialize_state_v10(contracts, events, events_raw)


def validate_v12_events(events: list[dict], state: dict) -> None:
    V11_VALIDATE_EVENTS(events, state)
    commit = v7.git_commit_authorized(events[0]["payload"]["baseCommit"])
    bindings = (
        (Path(__file__).resolve(), None),
        (TEST_PATH, None),
        (V11_PATH, V11_SHA256),
        (Q003_CONTRACT_PATH, Q003_CONTRACT_SHA256),
        (Q003_BUILDER_PATH, Q003_BUILDER_SHA256),
        (Q003_TEST_PATH, Q003_TEST_SHA256),
    )
    for path, expected in bindings:
        raw = path.read_bytes()
        if expected and hashlib.sha256(raw).hexdigest() != expected:
            fail(f"frozen bytes changed: {path.name}")
        remote_raw = base.git_bytes("show", f"{commit}:{path.relative_to(ROOT).as_posix()}")
        if remote_raw != raw:
            fail(f"genesis does not bind exact bytes: {path.name}")
    raw_bindings = state["inputRawSha256"]
    expected_bindings = {
        "v11Controller": V11_SHA256,
        "q003ContractV5": Q003_CONTRACT_SHA256,
        "q003BuilderV5": Q003_BUILDER_SHA256,
        "q003TestV5": Q003_TEST_SHA256,
    }
    for key, expected in expected_bindings.items():
        if raw_bindings.get(key) != expected:
            fail(f"V12 state does not bind {key}")


base.materialize_state = materialize_state_v12
base.validate_contracts = validate_contracts
v7.validate_contracts = validate_contracts
v7.validate_state_paths_v7 = validate_state_paths_v12
v8.validate_contracts = validate_contracts
v8.validate_state_paths_v8 = validate_state_paths_v12
v8.validate_v8_events = validate_v12_events


def verify_current(events_path: Path, state_path: Path, *, heal: bool = False):
    events_path, state_path = validate_state_paths_v12(events_path, state_path)
    contracts, events, state = base.verify_current(events_path, state_path, heal=heal)
    validate_v12_events(events, state)
    return contracts, events, state


def self_test() -> dict:
    contracts = validate_contracts()
    inherited = v11.self_test()
    required = {
        "q003ContractV5": Q003_CONTRACT_SHA256,
        "q003BuilderV5": Q003_BUILDER_SHA256,
        "q003TestV5": Q003_TEST_SHA256,
    }
    return {
        "status": "PASS",
        "v11SemanticsPass": inherited.get("status") == "PASS"
            and all(value is True for key, value in inherited.items() if key not in {"status", "outcomesAccessed"}),
        "q003V5BindingsExact": all(contracts["rawBindings"].get(key) == value for key, value in required.items()),
        "q003V4CannotSubstituteV5": contracts["rawBindings"].get("q003ContractV5") != contracts["rawBindings"].get("q003ContractV4"),
        "outcomesAccessed": False,
    }


def main() -> int:
    parser = base.build_parser()
    args = parser.parse_args()
    try:
        if args.command == "init":
            result = v7.command_init(args)
        elif args.command == "verify":
            contracts, events, state = verify_current(Path(args.events), Path(args.state), heal=args.heal)
            v7.require_remote_queue_snapshot(Path(args.events), Path(args.state))
            result = {
                "status": "PASS", "inputBundleSha256": contracts["inputBundleSha256"],
                "eventCount": len(events), "lastEventSha256": events[-1]["eventSha256"],
                "stateSha256": state["stateSha256"], "tasks": len(state["tasks"]),
                "taskCounts": state["taskCounts"],
                "originalV4GreenGates": state["originalV4"]["greenOfficialGates"],
                "originalV4Complete": state["originalV4"]["complete"], "outcomesAccessed": False,
            }
        elif args.command == "next":
            _, events, state = verify_current(Path(args.events), Path(args.state))
            v7.require_remote_queue_snapshot(Path(args.events), Path(args.state))
            ready = sorted((row for row in state["tasks"] if row["state"] == "READY"),
                           key=lambda row: (-row["priority"], row["taskId"]))
            result = {"status": "PASS", "lastEventSha256": events[-1]["eventSha256"],
                      "nextTask": ready[0] if ready else None, "readyTasks": len(ready),
                      "outcomesAccessed": False}
        elif args.command == "claim":
            result = v7.command_claim(args)
        elif args.command == "transition":
            _, _, state = verify_current(Path(args.events), Path(args.state))
            task = next((row for row in state["tasks"] if row["taskId"] == args.task_id), None)
            if task is None:
                fail("unknown task")
            key = (task["state"], args.to_state, args.reason_code)
            if key not in v11.ALLOWED_TRANSITION_NOTES or args.note != v11.ALLOWED_TRANSITION_NOTES[key]:
                fail("transition must use an exact outcome-blind template")
            result = v7.command_transition(args)
        elif args.command == "capture":
            result = v7.command_capture(args)
        elif args.command == "self-test":
            result = self_test()
        else:
            fail("unsupported V12 command")
    except (base.ControllerError, subprocess.CalledProcessError, KeyError, ValueError, OSError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
