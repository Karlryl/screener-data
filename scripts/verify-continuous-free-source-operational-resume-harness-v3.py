#!/usr/bin/env python3
"""Verify the append-only V3 harness for the post-introduction V2 resume."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "continuous-free-source-operational-resume-harness-contract-v3.json"
SCRIPT = ROOT / "scripts" / "verify-continuous-free-source-operational-resume-harness-v3.py"
TEST = ROOT / "tests" / "verify-continuous-free-source-operational-resume-harness-v3.test.js"
EXPECTED_RAW = "84fc2a7aec9603193764104742735c36fe0da77be3b477411de6a50199ae4a5e"
EXPECTED_SELF = "751fff7a32bede74696c011380e8f56b0525d14f778b7df37b7b4835b88a06c8"
EXPECTED_SCRIPT_NORMALIZED = "7bcaf079510a32bcc2a4387b461692d6eafd6da94f327fb37e18a16c05a5f6b6"
EXPECTED_TEST_NORMALIZED = "2948f4565aef0064cc2a4eb914da20c3fe91b0f9d67a2aa45e1bdc716054253e"
REMOTE_URL = "https://github.com/Karlryl/screener-data.git"
REMOTE = "origin"
REF = "refs/heads/codex/early-detection-v4-gates-20260810"
BUILD_BASE = "2d0b8ee0e1cf3d9fea6489d529b8bf85774bcfb9"
BUILD_BASE_PARENT = "f530362a17a693e744e31d9eb4cdb6b61564f41a"
V2_PATHS = [
    "research/early-detection-v4/continuous-free-source-operational-resume-contract-v2.json",
    "scripts/verify-continuous-free-source-operational-resume-v2.py",
    "tests/verify-continuous-free-source-operational-resume-v2.test.js",
]
AUTHORIZED_PATHS = [
    "research/early-detection-v4/continuous-free-source-operational-resume-harness-contract-v3.json",
    "scripts/verify-continuous-free-source-operational-resume-harness-v3.py",
    "tests/verify-continuous-free-source-operational-resume-harness-v3.test.js",
]
EXPECTED_SOURCE_BASE = {
    "remote": REMOTE_URL,
    "ref": REF,
    "buildBase": BUILD_BASE,
    "buildBaseTag": 853,
    "buildBaseParent": BUILD_BASE_PARENT,
    "futureIntroductionDirectSingleParentChildRequired": True,
    "futureIntroductionAddsExactlyAuthorizedPaths": True,
    "authorizedPaths": AUTHORIZED_PATHS,
}
EXPECTED_LINEAGE = {
    "v2BuildBase": BUILD_BASE_PARENT,
    "v2BuildBaseTag": 852,
    "v2IntroductionCommit": BUILD_BASE,
    "v2IntroductionTag": 853,
    "v2IntroductionParent": BUILD_BASE_PARENT,
    "v2IntroductionDirectSingleParentChild": True,
    "v2IntroductionAddedExactlyOwnThreePaths": True,
    "v2AppendOnly": True,
}
EXPECTED_BINDINGS = {
    "contract": {
        "path": V2_PATHS[0], "bytes": 13760,
        "rawSha256": "084bbfc27e10bbb444c369bb488ddf60d6ed4c1547a2a5c807f700862a70eb5d",
        "gitBlob": "ab077a35d5612f2693efbb78885073b60469a695",
        "selfField": "resumeSha256",
        "selfSha256": "9a24cea57cbc5340e88836399fee297ad186de5fd00c058a3ea206626d8eaa1b",
    },
    "verifier": {
        "path": V2_PATHS[1], "bytes": 22574,
        "rawSha256": "eea350e039fd5f24bdc89e8e744738fa19a11da22a2ef01b40f9ae429794de54",
        "gitBlob": "3e61d0dba5e3df77df966a3d5f0cff4cd6e6d6e9",
        "normalizedRawSha256": "1afcdb9ab3f9dd0809108e55abbba80298722ff340aa1c383d3854b40b69fea9",
    },
    "test": {
        "path": V2_PATHS[2], "bytes": 3561,
        "rawSha256": "faf9a41667888a380cfd25ae0a023789f037f676d0e1ffed1b4bc9903969a6b8",
        "gitBlob": "00631d5e3fd8bd6f05b9849c908b7e9b0b856529",
        "normalizedRawSha256": "c31fa49c1a3139a0302ab9696bc856c4a2bbdbb67e2bb164015def46bf8e464a",
    },
}
EXPECTED_PROVIDER = {
    "providerPath": V2_PATHS[1],
    "commands": [
        ["python", "-B", V2_PATHS[1], "verify", "--remote"],
        ["python", "-O", "-B", V2_PATHS[1], "verify", "--remote"],
    ],
    "requiredProviderPhase": "POST_INTRODUCTION",
    "requiredStatus": "PASS",
    "requiredMilestones": 9,
    "requiredInheritedV1Milestones": 6,
    "requiredNewMilestones": 3,
    "requiredAutonomousNextActions": 4,
    "requiredBlockedByRights": 1,
    "requiredUserActionRequired": 3,
    "requiredOriginalV4GreenOfficialGates": 2,
    "requiredOriginalV4OfficialGateCount": 13,
    "requiredOutcomesAccessed": False,
}
EXPECTED_LOCKS = {
    "originalV4GreenOfficialGates": 2,
    "originalV4OfficialGateCount": 13,
    "originalV4Complete": False,
    "originalV4ResultComputationAllowed": False,
    "v2ProviderGrantsOriginalV4GateCredit": False,
    "v3HarnessGrantsOriginalV4GateCredit": False,
    "outcomesAccessed": False,
    "humanAttestation": False,
    "publicAiAppendOnly": True,
    "secCikStudyAppendOnly": True,
}


class HarnessError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise HarnessError(message)


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def git(*args: str, binary: bool = False) -> bytes | str:
    run = subprocess.run(["git", *args], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if run.returncode:
        fail("git command failed")
    return run.stdout if binary else run.stdout.decode().strip()


def is_ancestor(older: str, newer: str) -> bool:
    return subprocess.run(
        ["git", "merge-base", "--is-ancestor", older, newer], cwd=ROOT,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
    ).returncode == 0


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        fail(f"{label} exact keys changed")


def normalized_own(path: Path) -> str:
    raw = path.read_bytes()
    for token in (EXPECTED_SCRIPT_NORMALIZED, EXPECTED_TEST_NORMALIZED):
        raw = raw.replace(token.encode(), b"0" * 64)
    return sha(raw)


def validate(value: dict[str, Any], *, check_bytes: bool = True) -> None:
    exact_keys(value, {"schema", "createdAt", "taskId", "track", "purpose", "sourceBase", "v2Lineage", "v2Bindings", "providerPolicy", "scientificLocks", "contractSha256"}, "contract")
    if value["schema"] != "early-detection-continuous-free-source-operational-resume-harness-contract/v3" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract boundary changed")
    body = dict(value)
    claim = body.pop("contractSha256", None)
    if claim != EXPECTED_SELF or sha(canonical(body)) != EXPECTED_SELF:
        fail("contract self hash changed")
    if value["sourceBase"] != EXPECTED_SOURCE_BASE:
        fail("source base changed")
    exact_keys(value["sourceBase"], set(EXPECTED_SOURCE_BASE), "source base")
    if value["v2Lineage"] != EXPECTED_LINEAGE:
        fail("V2 lineage changed")
    exact_keys(value["v2Lineage"], set(EXPECTED_LINEAGE), "V2 lineage")
    if value["v2Bindings"] != EXPECTED_BINDINGS:
        fail("V2 binding changed")
    exact_keys(value["v2Bindings"], {"contract", "verifier", "test"}, "V2 bindings")
    if value["providerPolicy"] != EXPECTED_PROVIDER:
        fail("provider policy changed")
    exact_keys(value["providerPolicy"], set(EXPECTED_PROVIDER), "provider policy")
    if value["scientificLocks"] != EXPECTED_LOCKS:
        fail("scientific lock changed")
    exact_keys(value["scientificLocks"], set(EXPECTED_LOCKS), "scientific locks")

    if check_bytes:
        for binding in value["v2Bindings"].values():
            path = ROOT / binding["path"]
            raw = path.read_bytes()
            if len(raw) != binding["bytes"] or sha(raw) != binding["rawSha256"]:
                fail("V2 local artifact changed")
            if str(git("rev-parse", f"{BUILD_BASE}:{binding['path']}")) != binding["gitBlob"]:
                fail("V2 Git blob changed")
            if git("show", f"{BUILD_BASE}:{binding['path']}", binary=True) != raw:
                fail("V2 binding commit bytes changed")
        decoded = json.loads((ROOT / value["v2Bindings"]["contract"]["path"]).read_bytes())
        self_field = value["v2Bindings"]["contract"]["selfField"]
        self_value = value["v2Bindings"]["contract"]["selfSha256"]
        if decoded.get(self_field) != self_value:
            fail("V2 contract self field changed")
        decoded_body = dict(decoded)
        decoded_body.pop(self_field)
        if sha(canonical(decoded_body)) != self_value:
            fail("V2 contract canonical self changed")


def load() -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    if sha(raw) != EXPECTED_RAW:
        fail("contract raw bytes changed")
    if normalized_own(SCRIPT) != EXPECTED_SCRIPT_NORMALIZED:
        fail("V3 verifier normalized bytes changed")
    if TEST.exists() and normalized_own(TEST) != EXPECTED_TEST_NORMALIZED:
        fail("V3 test normalized bytes changed")
    value = json.loads(raw)
    validate(value)
    return value


def verify_v2_introduction() -> None:
    if str(git("show", "-s", "--format=%P", BUILD_BASE)).split() != [BUILD_BASE_PARENT]:
        fail("V2 introduction parent changed")
    changed = str(git("diff-tree", "--root", "--no-commit-id", "--name-only", "-r", BUILD_BASE)).splitlines()
    if sorted(changed) != sorted(V2_PATHS):
        fail("V2 introduction path set changed")


def introduction_phase(head: str) -> str:
    if not is_ancestor(BUILD_BASE, head):
        fail("V3 build base is not ancestor")
    if head == BUILD_BASE:
        tracked = set(str(git("ls-tree", "-r", "--name-only", head)).splitlines())
        if any(path in tracked for path in AUTHORIZED_PATHS):
            fail("V3 path unexpectedly tracked before introduction")
        return "PRE_INTRODUCTION"
    chain = str(git("rev-list", "--reverse", "--ancestry-path", f"{BUILD_BASE}..{head}")).splitlines()
    if not chain:
        fail("V3 introduction chain missing")
    introduction = chain[0]
    if str(git("show", "-s", "--format=%P", introduction)).split() != [BUILD_BASE]:
        fail("V3 introduction is not direct single-parent child")
    changed = str(git("diff-tree", "--root", "--no-commit-id", "--name-only", "-r", introduction)).splitlines()
    if sorted(changed) != sorted(AUTHORIZED_PATHS):
        fail("V3 introduction path set changed")
    for path in AUTHORIZED_PATHS:
        if git("show", f"{introduction}:{path}", binary=True) != (ROOT / path).read_bytes():
            fail("V3 artifact changed after introduction")
    return "POST_INTRODUCTION"


def remote_check() -> str:
    if str(git("remote", "get-url", REMOTE)) != REMOTE_URL:
        fail("remote URL changed")
    head = str(git("rev-parse", "HEAD"))
    upstream = str(git("rev-parse", "@{upstream}"))
    refs = str(git("ls-remote", REMOTE, REF)).split()
    remote_head = refs[0] if refs else ""
    if head != upstream or head != remote_head:
        fail("remote snapshot changed")
    verify_v2_introduction()
    if not is_ancestor(BUILD_BASE, remote_head):
        fail("V2 introduction is not in live remote ancestry")
    return introduction_phase(head)


def run_provider() -> list[dict[str, Any]]:
    results = []
    for optimized in (False, True):
        args = [sys.executable]
        if optimized:
            args.append("-O")
        args.extend(["-B", EXPECTED_PROVIDER["providerPath"], "verify", "--remote"])
        run = subprocess.run(args, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False, text=True)
        if run.returncode:
            fail("V2 provider execution failed")
        result = json.loads(run.stdout.strip())
        expected = {
            "status": EXPECTED_PROVIDER["requiredStatus"],
            "phase": EXPECTED_PROVIDER["requiredProviderPhase"],
            "milestones": EXPECTED_PROVIDER["requiredMilestones"],
            "inheritedV1Milestones": EXPECTED_PROVIDER["requiredInheritedV1Milestones"],
            "newMilestones": EXPECTED_PROVIDER["requiredNewMilestones"],
            "autonomousNextActions": EXPECTED_PROVIDER["requiredAutonomousNextActions"],
            "blockedByRights": EXPECTED_PROVIDER["requiredBlockedByRights"],
            "userActionRequired": EXPECTED_PROVIDER["requiredUserActionRequired"],
            "originalV4GreenOfficialGates": EXPECTED_PROVIDER["requiredOriginalV4GreenOfficialGates"],
            "originalV4OfficialGateCount": EXPECTED_PROVIDER["requiredOriginalV4OfficialGateCount"],
            "outcomesAccessed": EXPECTED_PROVIDER["requiredOutcomesAccessed"],
        }
        if any(result.get(key) != expected_value for key, expected_value in expected.items()):
            fail("V2 provider result changed")
        results.append(result)
    return results


def rejected(action: Callable[[], None]) -> bool:
    try:
        action()
    except (HarnessError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError):
        return True
    return False


def reseal(item: dict[str, Any]) -> None:
    item["contractSha256"] = sha(canonical({key: val for key, val in item.items() if key != "contractSha256"}))


def self_test() -> dict[str, Any]:
    source = load()
    mutations: dict[str, Callable[[dict[str, Any]], None]] = {
        "sourceBuildBase": lambda x: x["sourceBase"].__setitem__("buildBase", "0" * 40),
        "remoteUrl": lambda x: x["sourceBase"].__setitem__("remote", "https://example.invalid/repo.git"),
        "remoteRef": lambda x: x["sourceBase"].__setitem__("ref", "refs/heads/main"),
        "lineageParent": lambda x: x["v2Lineage"].__setitem__("v2IntroductionParent", "0" * 40),
        "v2ContractHash": lambda x: x["v2Bindings"]["contract"].__setitem__("rawSha256", "0" * 64),
        "v2VerifierHash": lambda x: x["v2Bindings"]["verifier"].__setitem__("rawSha256", "0" * 64),
        "v2TestBlob": lambda x: x["v2Bindings"]["test"].__setitem__("gitBlob", "0" * 40),
        "providerPhase": lambda x: x["providerPolicy"].__setitem__("requiredProviderPhase", "PRE_INTRODUCTION"),
        "providerMilestones": lambda x: x["providerPolicy"].__setitem__("requiredMilestones", 10),
        "originalV4GateCredit": lambda x: x["scientificLocks"].__setitem__("v3HarnessGrantsOriginalV4GateCredit", True),
        "outcomeAccess": lambda x: x["scientificLocks"].__setitem__("outcomesAccessed", True),
        "authorizedPathOrder": lambda x: x["sourceBase"]["authorizedPaths"].reverse(),
    }
    kills: dict[str, bool] = {}
    for name, mutate in mutations.items():
        item = copy.deepcopy(source)
        mutate(item)
        reseal(item)
        kills[name] = rejected(lambda item=item: validate(item, check_bytes=False))
    if set(kills.values()) != {True}:
        fail("V3 adversarial self-test did not fail closed")
    return {
        "schema": "early-detection-continuous-free-source-operational-resume-harness-self-test/v3",
        "status": "PASS", "kills": kills, "outcomesAccessed": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify", "self-test"))
    parser.add_argument("--remote", action="store_true")
    args = parser.parse_args()
    try:
        load()
        phase = remote_check() if args.remote else introduction_phase(str(git("rev-parse", "HEAD")))
        if args.command == "self-test":
            result = self_test()
            result["phase"] = phase
        else:
            provider = run_provider()
            result = {
                "schema": "early-detection-continuous-free-source-operational-resume-harness-verification/v3",
                "status": "PASS", "phase": phase, "v2ProviderRuns": len(provider),
                "v2ProviderPhase": "POST_INTRODUCTION", "v2Milestones": 9,
                "originalV4GreenOfficialGates": 2, "originalV4OfficialGateCount": 13,
                "outcomesAccessed": False,
            }
    except (HarnessError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
