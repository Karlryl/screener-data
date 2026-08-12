#!/usr/bin/env python3
"""Verify the append-only operational resume view over frozen source milestones."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import subprocess
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "continuous-free-source-operational-resume-contract-v1.json"
EXPECTED_RAW = "95edf2734e8d850bfb4bb77ae5c283865819409f243fbd30c1220f24ac9e09f7"
EXPECTED_SELF = "2eb939eb3dee6e5318bc0fe6344e84fba1cfbc565d4ea2a7f0e88bb0b255132e"
REMOTE_URL = "https://github.com/Karlryl/screener-data.git"
REMOTE = "origin"
BRANCH = "codex/early-detection-v4-gates-20260810"


class ResumeError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise ResumeError(message)


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def git(*args: str, binary: bool = False) -> bytes | str:
    run = subprocess.run(["git", *args], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if run.returncode:
        fail("git command failed")
    return run.stdout if binary else run.stdout.decode().strip()


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        fail(f"{label} exact keys changed")


def validate(value: dict[str, Any], *, check_bytes: bool = True) -> None:
    exact_keys(value, {"schema", "createdAt", "track", "purpose", "baseState", "milestones", "nextQueue", "scientificLocks", "resumeSha256"}, "resume")
    if value["schema"] != "early-detection-continuous-free-source-operational-resume-contract/v1" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("resume boundary changed")
    body = dict(value)
    claim = body.pop("resumeSha256", None)
    if claim != EXPECTED_SELF or sha(canonical(body)) != EXPECTED_SELF:
        fail("resume self hash changed")
    base = value["baseState"]
    exact_keys(base, {"path", "rawSha256", "stateSha256", "introductionCommit", "supersededOperationalPriorityOnly", "scientificStateRemainsAppendOnly"}, "base state")
    if base != {
        "path": "state/early-detection-free-source-state-v12.json",
        "rawSha256": "8e652e4ebb711a7cbe065799fc74fe3587d389cc313870cfa6d4a7960a78c700",
        "stateSha256": "4b08d22993e31ff24558b76a9739aab8b180eb177f3dd2c3bc6bfaa44cba0439",
        "introductionCommit": "51ee7e4dffcbe543125d371faaf10cf18b9027cd",
        "supersededOperationalPriorityOnly": True,
        "scientificStateRemainsAppendOnly": True,
    }:
        fail("base state contract changed")
    milestones = value["milestones"]
    if not isinstance(milestones, list) or len(milestones) != 6 or len({row.get("milestoneId") for row in milestones}) != 6:
        fail("milestone set changed")
    for row in milestones:
        exact_keys(row, {"milestoneId", "sourceId", "taskId", "path", "rawSha256", "selfSha256", "introductionCommit", "operationalState", "nextActionClass"}, "milestone")
        path = ROOT / row["path"]
        raw = path.read_bytes()
        if check_bytes and sha(raw) != row["rawSha256"]:
            fail("milestone local bytes changed")
        commit_raw = git("show", f"{row['introductionCommit']}:{row['path']}", binary=True)
        if check_bytes and commit_raw != raw:
            fail("milestone introduction blob changed")
        if subprocess.run(["git", "merge-base", "--is-ancestor", row["introductionCommit"], "HEAD"], cwd=ROOT).returncode:
            fail("milestone commit not ancestor")
        decoded = json.loads(raw)
        present_self = decoded.get("reportSha256") or decoded.get("contractSha256") or decoded.get("payloadSha256")
        if present_self != row["selfSha256"]:
            fail("milestone self binding changed")
    queue = value["nextQueue"]
    if not isinstance(queue, list) or [row.get("rank") for row in queue] != [1, 2, 3, 4, 5] or len({row.get("workId") for row in queue}) != 5:
        fail("next queue changed")
    for row in queue:
        exact_keys(row, {"rank", "workId", "entryCriterion", "workClass"}, "next queue row")
    if [row["workClass"] for row in queue] != ["AUTONOMOUS_OUTCOME_BLIND", "AUTONOMOUS_OUTCOME_BLIND", "AUTONOMOUS_OUTCOME_BLIND", "USER_ACTION_REQUIRED", "USER_ACTION_REQUIRED"]:
        fail("queue action classes changed")
    locks = value["scientificLocks"]
    if locks != {
        "originalV4GreenOfficialGates": 2,
        "originalV4OfficialGateCount": 13,
        "originalV4Complete": False,
        "originalV4ResultComputationAllowed": False,
        "publicAiAppendOnly": True,
        "secCikStudyAppendOnly": True,
        "outcomesAccessed": False,
        "humanAttestation": False,
        "addonMilestonesGrantOriginalV4GateCredit": False,
    }:
        fail("scientific lock changed")


def load() -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    if sha(raw) != EXPECTED_RAW:
        fail("resume raw bytes changed")
    value = json.loads(raw)
    validate(value)
    return value


def remote_check() -> None:
    head = str(git("rev-parse", "HEAD"))
    upstream = str(git("rev-parse", "@{upstream}"))
    refs = str(git("ls-remote", REMOTE, f"refs/heads/{BRANCH}")).split()
    remote_head = refs[0] if refs else ""
    if head != upstream or head != remote_head or str(git("remote", "get-url", REMOTE)) != REMOTE_URL:
        fail("remote snapshot changed")


def rejected(action: Callable[[], None]) -> bool:
    try:
        action()
    except (ResumeError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError):
        return True
    return False


def self_test() -> dict[str, Any]:
    source = load()
    kills = {}
    for name, mutate in {
        "originalV4FalselyComplete": lambda x: x["scientificLocks"].__setitem__("originalV4Complete", True),
        "addonV4Credit": lambda x: x["scientificLocks"].__setitem__("addonMilestonesGrantOriginalV4GateCredit", True),
        "outcomeAccessClaimed": lambda x: x["scientificLocks"].__setitem__("outcomesAccessed", True),
        "quantConnectReactivated": lambda x: x["milestones"][0].__setitem__("operationalState", "READY"),
        "finraPre2016Claimed": lambda x: x["milestones"][1].__setitem__("nextActionClass", "FULL_2009_2024_COMPLETE"),
        "userActionPriorityBypass": lambda x: x["nextQueue"][3].__setitem__("workClass", "AUTONOMOUS_OUTCOME_BLIND"),
    }.items():
        item = copy.deepcopy(source)
        mutate(item)
        item["resumeSha256"] = sha(canonical({key: val for key, val in item.items() if key != "resumeSha256"}))
        kills[name] = rejected(lambda item=item: validate(item, check_bytes=False))
    return {"schema": "early-detection-continuous-free-source-operational-resume-self-test/v1", "status": "PASS", "kills": kills, "outcomesAccessed": False}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify", "self-test"))
    parser.add_argument("--remote", action="store_true")
    args = parser.parse_args()
    try:
        value = load()
        if args.remote:
            remote_check()
        result = self_test() if args.command == "self-test" else {
            "schema": "early-detection-continuous-free-source-operational-resume-verification/v1",
            "status": "PASS",
            "milestones": len(value["milestones"]),
            "autonomousNextActions": sum(row["workClass"] == "AUTONOMOUS_OUTCOME_BLIND" for row in value["nextQueue"]),
            "originalV4GreenOfficialGates": 2,
            "originalV4OfficialGateCount": 13,
            "outcomesAccessed": False,
        }
    except (ResumeError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
