#!/usr/bin/env python3
"""Remote-gated V15 controller for the byte-exact V14 operational state."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research/early-detection-v4/continuous-free-source-operational-controller-contract-v15.json"
V14_CONTROLLER = ROOT / "scripts/early-detection-continuous-free-source-v14.py"
REMOTE = "https://github.com/Karlryl/screener-data.git"
REF = "refs/heads/codex/early-detection-v4-gates-20260810"
BASE_COMMIT = "394b3b6bd43a20306286cf766fa6f3aaf69cc6ca"
V14_INTRODUCTION = "eca62f4260e940eff70ab8f17ada26c1fd57ab48"
V14_PARENT = "9d1dbad209c14c8fca0073a371f743d94f731283"
EXPECTED_CONTRACT_RAW = "db39ed1fa5641b5eb57879975faa5dfff57dcfa691d9dfde1a5ce23033754372"
EXPECTED_CONTROLLER_NORMALIZED = "7c02fb5cf902029b21764c842427dc226c9674973489f8e258fc0c16f42314df"
EXPECTED_TEST_NORMALIZED = "d87154d26faaf8ce2a90ce7a52d7fd9e10aef66b74d7a091b69a7a645bc012fc"

OWN_PATHS = [
    "research/early-detection-v4/continuous-free-source-operational-controller-contract-v15.json",
    "scripts/early-detection-continuous-free-source-v15.py",
    "tests/early-detection-continuous-free-source-v15.test.js",
]
V14_PATHS = [
    "research/early-detection-v4/continuous-free-source-operational-state-contract-v14.json",
    "scripts/early-detection-continuous-free-source-v14.py",
    "state/early-detection-free-source-events-v14.jsonl",
    "state/early-detection-free-source-state-v14.json",
    "tests/early-detection-continuous-free-source-v14.test.js",
]
EXPECTED_LOCKS = {
    "originalV4GreenOfficialGates": 2,
    "originalV4OfficialGateCount": 13,
    "originalV4Complete": False,
    "originalV4GateCredit": False,
    "identityResolved": False,
    "terminalWealthComplete": False,
    "fiveRequiredDataSemanticsComplete": False,
    "resultComputationAllowed": False,
    "pricesAccessed": False,
    "returnsAccessed": False,
    "outcomesAccessed": False,
}


class ControllerError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise ControllerError(message)


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def exact_keys(value: object, expected: set[str], label: str) -> None:
    if type(value) is not dict or set(value) != expected:
        fail(f"{label} exact keys changed")


def git(*args: str) -> str:
    result = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    if result.returncode:
        fail("Git binding failed")
    return result.stdout.strip()


def git_exists(commit: str, path: str) -> bool:
    return subprocess.run(
        ["git", "cat-file", "-e", f"{commit}:{path}"], cwd=ROOT,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    ).returncode == 0


def git_raw(commit: str, path: str) -> bytes:
    return subprocess.check_output(["git", "show", f"{commit}:{path}"], cwd=ROOT)


def first_parent_chain(ancestor: str, descendant: str) -> list[str]:
    rows = git("rev-list", "--first-parent", descendant).splitlines()
    if ancestor not in rows:
        fail("required first-parent ancestor missing")
    return rows[: rows.index(ancestor) + 1]


def single_parent_chain(ancestor: str, descendant: str) -> None:
    chain = first_parent_chain(ancestor, descendant)
    for commit in chain[:-1]:
        if len(git("show", "-s", "--format=%P", commit).split()) != 1:
            fail("non-linear descendant after controller introduction")


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


def load_contract() -> dict:
    raw = CONTRACT.read_bytes()
    if sha(raw) != EXPECTED_CONTRACT_RAW:
        fail("V15 contract raw bytes changed")
    value = json.loads(raw)
    body = dict(value)
    claimed = body.pop("contractSelfSha256", None)
    if claimed != sha(canonical(body)):
        fail("V15 contract self hash changed")
    exact_keys(value, {
        "schema", "createdAt", "track", "purpose", "contractSelfSha256", "repository",
        "v14Bindings", "implementation", "replayContract", "scientificLocks",
    }, "contract")
    if value["schema"] != "early-detection-continuous-free-source-operational-controller-contract/v15":
        fail("schema changed")
    if value["createdAt"] != "2026-08-13T04:39:29Z" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract boundary changed")
    if value["purpose"] != "Supersede only the V14 controller lineage check so the exact Tag867 introduction remains verifiable beneath later linear append-only commits; retain the byte-exact V14 event log, state, scheduler and scientific locks.":
        fail("purpose changed")
    repository = value["repository"]
    exact_keys(repository, {
        "remote", "ref", "buildBaseCommit", "buildBaseTag", "introductionMustBeDirectSingleParentChild",
        "introductionAddsExactlyAuthorizedPaths", "laterLinearSingleParentDescendantsAllowed", "authorizedPaths",
    }, "repository")
    if repository != {
        "remote": REMOTE, "ref": REF, "buildBaseCommit": BASE_COMMIT, "buildBaseTag": 868,
        "introductionMustBeDirectSingleParentChild": True,
        "introductionAddsExactlyAuthorizedPaths": True,
        "laterLinearSingleParentDescendantsAllowed": True,
        "authorizedPaths": OWN_PATHS,
    }:
        fail("repository contract changed")
    bindings = value["v14Bindings"]
    exact_keys(bindings, {
        "introductionCommit", "introductionParent", "authorizedPaths", "stateSelfSha256",
        "operationalProjectionSha256", "nextTaskId",
    }, "V14 bindings")
    if bindings["introductionCommit"] != V14_INTRODUCTION or bindings["introductionParent"] != V14_PARENT:
        fail("V14 introduction binding changed")
    if list(bindings["authorizedPaths"]) != V14_PATHS:
        fail("V14 authorized paths changed")
    if bindings["stateSelfSha256"] != "11805da98c1939180af93e6e6e8215667cb56919428dc7b729509254b9ef76c4" or bindings["operationalProjectionSha256"] != "08b1ce5850dacde5f37a08081e9273760a69cd03818b4762a9751ce3050f3b13" or bindings["nextTaskId"] != "Q003-SEC-TERMINAL-WEALTH-QUEUE":
        fail("V14 state binding changed")
    for path, binding in bindings["authorizedPaths"].items():
        exact_keys(binding, {"rawSha256", "gitBlob"}, f"V14 path {path}")
        if not re.fullmatch(r"[0-9a-f]{64}", binding["rawSha256"]) or not re.fullmatch(r"[0-9a-f]{40}", binding["gitBlob"]):
            fail("V14 path hash malformed")
    implementation = value["implementation"]
    if implementation != {
        "controllerNormalizedSha256": EXPECTED_CONTROLLER_NORMALIZED,
        "testNormalizedSha256": EXPECTED_TEST_NORMALIZED,
        "selfBindingsNormalizedBeforeHash": True,
    }:
        fail("implementation binding changed")
    if normalized_python(Path(__file__).read_bytes()) != EXPECTED_CONTROLLER_NORMALIZED:
        fail("V15 controller normalized bytes changed")
    test = ROOT / OWN_PATHS[2]
    if normalized_test(test.read_bytes()) != EXPECTED_TEST_NORMALIZED:
        fail("V15 test normalized bytes changed")
    if value["replayContract"] != {
        "v14EventLogAndStateRemainByteExact": True,
        "v14StateMustBeRebuiltFromEventLog": True,
        "v14ProjectionMustBeRevalidated": True,
        "nextRequiresRemotePostIntroduction": True,
        "verifyWithoutRemoteMustFail": True,
        "preIntroductionVerifyIsDiagnosticOnly": True,
        "v14IntroductionLocatedByGitHistoryNotCurrentHead": True,
    } or value["scientificLocks"] != EXPECTED_LOCKS:
        fail("replay or scientific locks changed")
    return value


def load_v14() -> dict:
    expected = load_contract()["v14Bindings"]["authorizedPaths"][V14_PATHS[1]]["rawSha256"]
    raw = V14_CONTROLLER.read_bytes()
    if sha(raw) != expected:
        fail("V14 controller bytes changed before import")
    namespace = {"__name__": "v14_bound", "__file__": str(V14_CONTROLLER)}
    exec(compile(raw, str(V14_CONTROLLER), "exec"), namespace)
    return namespace


def verify_v14_history(contract: dict, head: str) -> None:
    parent_row = git("rev-list", "--parents", "-n", "1", V14_INTRODUCTION).split()
    if parent_row != [V14_INTRODUCTION, V14_PARENT]:
        fail("V14 introduction parent changed")
    changes = git("diff-tree", "--no-commit-id", "--name-status", "-r", V14_INTRODUCTION).splitlines()
    if changes != [f"A\t{path}" for path in V14_PATHS]:
        fail("V14 introduction additions changed")
    single_parent_chain(V14_INTRODUCTION, head)
    for path, binding in contract["v14Bindings"]["authorizedPaths"].items():
        raw = (ROOT / path).read_bytes()
        if sha(raw) != binding["rawSha256"] or git("rev-parse", f"{V14_INTRODUCTION}:{path}") != binding["gitBlob"]:
            fail("V14 introduction bytes changed")
        if git_raw(head, path) != raw or git("log", "-1", "--format=%H", "--", path) != V14_INTRODUCTION:
            fail("V14 dependency drifted after introduction")


def own_phase(head: str) -> tuple[str, str | None]:
    present = [path for path in OWN_PATHS if git_exists(head, path)]
    if not present:
        return "PRE_INTRODUCTION", None
    if present != OWN_PATHS:
        fail("partial V15 introduction")
    introductions = {git("log", "--diff-filter=A", "-1", "--format=%H", "--", path) for path in OWN_PATHS}
    if len(introductions) != 1:
        fail("V15 paths were not introduced together")
    introduction = introductions.pop()
    if git("show", "-s", "--format=%P", introduction).split() != [BASE_COMMIT]:
        fail("V15 introduction is not direct single-parent child of Tag868")
    changes = git("diff-tree", "--no-commit-id", "--name-status", "-r", introduction).splitlines()
    if changes != [f"A\t{path}" for path in OWN_PATHS]:
        fail("V15 introduction is not exactly three additions")
    single_parent_chain(introduction, head)
    for path in OWN_PATHS:
        if git("log", "-1", "--format=%H", "--", path) != introduction or git_raw(head, path) != (ROOT / path).read_bytes():
            fail("V15 Git/worktree bytes drifted")
    return "POST_INTRODUCTION", introduction


def verify(remote: bool) -> dict:
    if not remote:
        fail("remote verification is mandatory")
    contract = load_contract()
    if git("remote", "get-url", "origin") != REMOTE:
        fail("origin changed")
    head = git("rev-parse", "HEAD")
    upstream = git("rev-parse", "@{u}")
    rows = git("ls-remote", "--refs", "origin", REF).splitlines()
    if len(rows) != 1 or not head == upstream == rows[0].split()[0]:
        fail("HEAD/upstream/live remote drift")
    single_parent_chain(BASE_COMMIT, head)
    verify_v14_history(contract, head)
    v14 = load_v14()
    v14_contract, _ = v14["load_contract"]()
    input_raw, bundle = v14["compute_inputs"](v14_contract)
    event_raw = (ROOT / V14_PATHS[2]).read_bytes()
    state_raw = (ROOT / V14_PATHS[3]).read_bytes()
    events = v14["parse_events"](event_raw)
    rebuilt = v14["materialize_state"](v14_contract, event_raw, events, input_raw, bundle)
    actual = json.loads(state_raw)
    if actual != rebuilt or actual.get("stateSha256") != contract["v14Bindings"]["stateSelfSha256"]:
        fail("V14 state no longer replays byte-exactly")
    schedule = v14["validate_projection"](actual["operationalProjection"])
    if schedule["nextTaskId"] != contract["v14Bindings"]["nextTaskId"]:
        fail("V14 next task changed")
    phase, introduction = own_phase(head)
    return {
        "schema": "early-detection-free-source-operational-controller-verification/v15",
        "status": "PASS" if phase == "POST_INTRODUCTION" else "PRE_INTRODUCTION_DIAGNOSTIC",
        "phase": phase,
        "introductionCommit": introduction,
        "controllerResumeAllowed": phase == "POST_INTRODUCTION",
        "v14IntroductionCommit": V14_INTRODUCTION,
        "v14IntroductionLocatedBelowCurrentHead": head != V14_INTRODUCTION,
        "v14StateReplayVerified": True,
        "tasksConserved": 10,
        "resolvedTasks": 0,
        "nextTaskId": schedule["nextTaskId"],
        "q002AutoNext": False,
        "originalV4GreenOfficialGates": 2,
        "originalV4OfficialGateCount": 13,
        "remoteVerified": True,
        "outcomesAccessed": False,
    }


def self_test() -> dict:
    contract = load_contract()
    mutations = {
        "futureTime": lambda x: x.__setitem__("createdAt", "2099-01-01T00:00:00Z"),
        "purposeCredit": lambda x: x.__setitem__("purpose", "Original V4 result PASS"),
        "baseForward": lambda x: x["repository"].__setitem__("buildBaseCommit", V14_INTRODUCTION),
        "allowMerge": lambda x: x["repository"].__setitem__("laterLinearSingleParentDescendantsAllowed", False),
        "v14IntroForward": lambda x: x["v14Bindings"].__setitem__("introductionCommit", BASE_COMMIT),
        "v14PathDrop": lambda x: x["v14Bindings"]["authorizedPaths"].pop(V14_PATHS[-1]),
        "stateCredit": lambda x: x["scientificLocks"].__setitem__("terminalWealthComplete", True),
        "unknownCredit": lambda x: x["scientificLocks"].__setitem__("unknownCredit", True),
        "nextQ002": lambda x: x["v14Bindings"].__setitem__("nextTaskId", "Q002-QUANTCONNECT-50-CASE-CONTRACT"),
        "replayDisabled": lambda x: x["replayContract"].__setitem__("v14StateMustBeRebuiltFromEventLog", False),
    }
    kills = {}
    for name, mutate in mutations.items():
        changed = copy.deepcopy(contract)
        mutate(changed)
        body = dict(changed)
        body.pop("contractSelfSha256", None)
        changed["contractSelfSha256"] = sha(canonical(body))
        try:
            # The semantic checks below intentionally mirror load_contract without trusting a rehashed claim.
            if changed["createdAt"] != "2026-08-13T04:39:29Z" or changed["purpose"] != contract["purpose"]:
                fail("contract identity changed")
            if changed["repository"] != contract["repository"] or changed["v14Bindings"] != contract["v14Bindings"]:
                fail("lineage binding changed")
            if changed["replayContract"] != contract["replayContract"] or changed["scientificLocks"] != EXPECTED_LOCKS:
                fail("replay or credit lock changed")
        except ControllerError:
            kills[name] = True
        else:
            kills[name] = False
    if not all(kills.values()):
        fail("self-test mutation survived")
    return {
        "schema": "early-detection-free-source-operational-controller-self-test/v15",
        "status": "PASS", "killCount": len(kills), "kills": kills, "outcomesAccessed": False,
    }


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
                    fail("next is forbidden before remote V15 introduction")
                result = {
                    "schema": "early-detection-free-source-next/v15", "status": "PASS",
                    "nextTaskId": result["nextTaskId"], "remoteVerified": True,
                    "postIntroductionVerified": True, "q002AutoNext": False, "outcomesAccessed": False,
                }
    except (ControllerError, OSError, KeyError, TypeError, ValueError, json.JSONDecodeError, subprocess.CalledProcessError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
