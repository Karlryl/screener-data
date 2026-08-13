#!/usr/bin/env python3
"""Bind the entire SEC 13F quarantine trust chain to remote Git bytes."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import subprocess
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_REL = "research/early-detection-v4/sec-13f-official-list-disposition-contract-v4.json"
VERIFIER_REL = "scripts/verify-sec-13f-official-list-disposition-v4.py"
TEST_REL = "tests/verify-sec-13f-official-list-disposition-v4.test.js"
REMOTE = "https://github.com/Karlryl/screener-data.git"
REMOTE_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
BUILD_BASE = "890c0afbf68fde0bbe4d871dcad1b9d48b51149a"
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
COMMIT40 = re.compile(r"[0-9a-f]{40}\Z")

DEPENDENCIES = {
    "research/early-detection-v4/sec-13f-official-list-private-pilot-contract-v1.json": "a432e808953f3208cb9f723c5e9778b7257dbbd0df4a7c25f5e359a2ab0e2018",
    "scripts/run-sec-13f-official-list-private-pilot-v1.py": "3c4a0f575891dc002bd19e0e68b5a714a25fbed3b11cab0435a9be1b1c10497a",
    "tests/run-sec-13f-official-list-private-pilot-v1.test.js": "6085403f55b158ff8428f7ee8ad2fbdfb6436d90cbc9080ba67aa9ed1a78cbff",
    "research/early-detection-v4/sec-13f-official-list-disposition-contract-v2.json": "0f17d30808233fad2e76c64dd29b8e2bd56c99503848f72c42a9ccff0a1c41bf",
    "scripts/verify-sec-13f-official-list-disposition-v2.py": "d17158ba30fe8fb63d84c7b073026016d2c142fc786304148b1277a0f8a3c1d5",
    "tests/verify-sec-13f-official-list-disposition-v2.test.js": "450aa617c4f89c5b4351c18dcb3109d0485d6310e167b945a504386ba4ead96b",
    "research/early-detection-v4/sec-13f-official-list-disposition-contract-v3.json": "1e0c91f29e3ceaa8da98b3c8029518a9a9b14c2a1566ff2a6209def46e22ce94",
    "scripts/verify-sec-13f-official-list-disposition-v3.py": "43363cfa831b2ec2e2d6ae25c8d90a46c1e2b60fe1b00b8761777048db6dfc78",
    "tests/verify-sec-13f-official-list-disposition-v3.test.js": "2c6fb24ff3274299c8cc4d986433462f806547f82074f677603f7450ffae990b",
    "reports/early-detection/sec-terminal-candidate-reconciliation-v1.json": "e38823a9701a7ea58afc1a91e5ed209837251f2e397fdf9d31bc4433831b4fa0",
    "reports/early-detection/sec-terminal-candidate-triage-v1.json": "ca879151eebd487609be39a4aa76faf83a1294c86736e00865a2759b5c7a860b",
    "reports/early-detection/sec-terminal-primary-document-extraction-v1.json": "987560ca38931cfa818f6c9fb315be7875ec98fd872518ef51d45f5af3589464",
}


class DispositionError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise DispositionError(message)


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def path(relative: str) -> Path:
    return ROOT / Path(relative)


def git(*args: str) -> bytes:
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True).stdout


def git_text(*args: str) -> str:
    return git(*args).decode("utf-8").strip()


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        fail(f"{label} exact keys changed")


def validate_contract(value: dict[str, Any]) -> None:
    exact_keys(value, {
        "schema", "createdAt", "taskId", "track", "purpose", "supersedesV3",
        "dependencyGitBindings", "implementationContract", "sourceDisposition",
        "incidentDisposition", "claimCeiling", "claimLocks", "contractSha256",
    }, "contract")
    body = dict(value)
    claimed = body.pop("contractSha256")
    if HEX64.fullmatch(claimed) is None or sha(canonical(body)) != claimed:
        fail("contract self hash changed")
    if value["schema"] != "sec-13f-official-list-disposition-contract/v4":
        fail("contract schema changed")
    if value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("track changed")
    if value["supersedesV3"] != {
        "contractPath": "research/early-detection-v4/sec-13f-official-list-disposition-contract-v3.json",
        "contractRawSha256": DEPENDENCIES["research/early-detection-v4/sec-13f-official-list-disposition-contract-v3.json"],
        "verifierPath": "scripts/verify-sec-13f-official-list-disposition-v3.py",
        "verifierRawSha256": DEPENDENCIES["scripts/verify-sec-13f-official-list-disposition-v3.py"],
        "testPath": "tests/verify-sec-13f-official-list-disposition-v3.test.js",
        "testRawSha256": DEPENDENCIES["tests/verify-sec-13f-official-list-disposition-v3.test.js"],
        "studyCredit": "ZERO",
    }:
        fail("V3 supersession changed")
    bindings = value["dependencyGitBindings"]
    if not isinstance(bindings, list) or len(bindings) != len(DEPENDENCIES):
        fail("dependency Git binding count changed")
    rebuilt: dict[str, str] = {}
    for item in bindings:
        exact_keys(item, {"path", "rawSha256", "requiredAtIntroductionCommit"}, "dependency binding")
        if item["requiredAtIntroductionCommit"] is not True:
            fail("dependency Git binding weakened")
        rebuilt[item["path"]] = item["rawSha256"]
    if rebuilt != DEPENDENCIES:
        fail("dependency Git bindings changed")
    implementation = value["implementationContract"]
    exact_keys(implementation, {
        "buildBaseCommit", "contractPath", "verifierPath", "verifierRawSha256",
        "testPath", "testRawSha256", "remote", "ref",
        "introductionDirectChildOfBuildBase", "singleIntroductionCommitRequired",
    }, "implementation contract")
    if implementation["buildBaseCommit"] != BUILD_BASE:
        fail("build base changed")
    if implementation["contractPath"] != CONTRACT_REL or implementation["verifierPath"] != VERIFIER_REL or implementation["testPath"] != TEST_REL:
        fail("implementation path changed")
    if implementation["remote"] != REMOTE or implementation["ref"] != REMOTE_REF:
        fail("remote binding changed")
    if implementation["introductionDirectChildOfBuildBase"] is not True or implementation["singleIntroductionCommitRequired"] is not True:
        fail("introduction topology weakened")
    if HEX64.fullmatch(implementation["verifierRawSha256"]) is None or HEX64.fullmatch(implementation["testRawSha256"]) is None:
        fail("implementation raw hash malformed")
    source = value["sourceDisposition"]
    if source != {
        "status": "QUARANTINED_RESTRICTED_INTERNAL_EVALUATION_ONLY",
        "studyCredit": "ZERO",
        "futureExecutionAuthorized": False,
        "automatedArchiveExecutionAuthorized": False,
        "identityCapabilityClosed": False,
        "terminalCapabilityClosed": False,
    }:
        fail("source disposition changed")
    incident = value["incidentDisposition"]
    if incident != {
        "exactIdentifierRepeatedInV4": False,
        "removedFromPilotRunnerAndTestCurrentBytes": True,
        "identifierAbsentFromWholeCurrentTree": False,
        "knownPreexistingArtifactCount": 3,
        "historyRewritePerformed": False,
        "historyRewriteRequiresExplicitUserApproval": True,
        "providerPdfOrDatasetCapturedByThisPilot": False,
        "providerCaptureNegativeScope": "THIS_PILOT_AND_REPO_DEFAULT_PATHS_ONLY_NOT_MACHINE_WIDE",
    }:
        fail("incident disposition changed")
    if any(item is not False for item in value["claimLocks"].values()):
        fail("claim lock opened")
    required = {
        "PUBLIC_CUSIP_OR_DESCRIPTION", "HISTORICAL_IDENTITY_INTERVAL",
        "CIK_SECURITY_OR_LISTING_IDENTITY_RESOLVED", "TERMINAL_SESSION_PAYMENT_OR_WEALTH",
        "PRICE_RETURN_OR_OUTCOME", "ORIGINAL_V4_GATE_CREDIT", "HUMAN_ATTESTATION",
    }
    if not required.issubset(set(value["claimCeiling"]["forbidden"])):
        fail("claim ceiling weakened")


def load_contract() -> tuple[dict[str, Any], bytes]:
    raw = path(CONTRACT_REL).read_bytes()
    value = json.loads(raw)
    validate_contract(value)
    return value, raw


def introduction_commit() -> str:
    commits = [line for line in git_text("log", "--reverse", "--format=%H", "--diff-filter=A", f"{BUILD_BASE}..HEAD", "--", CONTRACT_REL).splitlines() if line]
    if len(commits) != 1 or COMMIT40.fullmatch(commits[0]) is None:
        fail("V4 contract must have one introduction commit")
    introduction = commits[0]
    if git_text("show", "-s", "--format=%P", introduction).split() != [BUILD_BASE]:
        fail("V4 introduction is not direct single-parent child of build base")
    return introduction


def verify_all_bytes(contract: dict[str, Any], introduction: str) -> None:
    implementation = contract["implementationContract"]
    own = {
        CONTRACT_REL: sha(path(CONTRACT_REL).read_bytes()),
        VERIFIER_REL: implementation["verifierRawSha256"],
        TEST_REL: implementation["testRawSha256"],
    }
    for relative, expected in {**DEPENDENCIES, **own}.items():
        local = path(relative).read_bytes()
        if sha(local) != expected:
            fail(f"local raw binding changed: {relative}")
        try:
            remote_blob = git("show", f"{introduction}:{relative}")
        except subprocess.CalledProcessError as exc:
            raise DispositionError(f"introduction commit lacks dependency: {relative}") from exc
        if remote_blob != local:
            fail(f"introduction Git blob differs: {relative}")


def verify_repository(contract: dict[str, Any], remote_required: bool) -> str:
    if git_text("remote", "get-url", "origin") != REMOTE:
        fail("origin URL changed")
    head = git_text("rev-parse", "HEAD")
    upstream = git_text("rev-parse", "@{u}")
    if head != upstream:
        fail("HEAD and upstream differ")
    if remote_required:
        remote = git_text("ls-remote", "origin", REMOTE_REF).split()
        if len(remote) != 2 or remote[0] != head:
            fail("live remote differs")
    introduction = introduction_commit()
    if subprocess.run(["git", "merge-base", "--is-ancestor", introduction, head], cwd=ROOT, capture_output=True).returncode != 0:
        fail("introduction is not an ancestor of HEAD")
    verify_all_bytes(contract, introduction)
    return introduction


def rejected(action: Callable[[], None]) -> bool:
    try:
        action()
    except (DispositionError, KeyError, TypeError, ValueError):
        return True
    return False


def self_test(contract: dict[str, Any]) -> dict[str, Any]:
    mutations: list[dict[str, Any]] = []
    for section, key, changed in (
        ("sourceDisposition", "studyCredit", "POSITIVE"),
        ("sourceDisposition", "futureExecutionAuthorized", True),
        ("incidentDisposition", "identifierAbsentFromWholeCurrentTree", True),
        ("incidentDisposition", "exactIdentifierRepeatedInV4", True),
        ("implementationContract", "buildBaseCommit", "0" * 40),
        ("claimLocks", "originalV4GateCredit", True),
    ):
        item = copy.deepcopy(contract)
        item[section][key] = changed
        mutations.append(item)
    kills = [rejected(lambda item=item: validate_contract(item)) for item in mutations]
    if not all(kills):
        fail("contract mutation survived")
    for relative, expected in DEPENDENCIES.items():
        if sha(path(relative).read_bytes()) != expected:
            fail(f"dependency raw bytes changed: {relative}")
    return {
        "schema": "sec-13f-official-list-disposition-self-test/v4", "status": "PASS",
        "mutationsRejected": len(kills), "dependenciesBound": len(DEPENDENCIES),
        "wholeTreeAbsenceNotClaimed": True, "studyCredit": "ZERO",
        "networkRequests": 0, "filesWritten": 0, "outcomesAccessed": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify", "self-test"))
    parser.add_argument("--remote", action="store_true")
    args = parser.parse_args()
    try:
        contract, _ = load_contract()
        if args.command == "self-test":
            result = self_test(contract)
        else:
            introduction = verify_repository(contract, args.remote)
            result = {
                "schema": "sec-13f-official-list-disposition-verification/v4", "status": "PASS",
                "introductionCommit": introduction, "dependenciesGitBound": len(DEPENDENCIES),
                "studyCredit": "ZERO", "wholeTreeAbsenceClaimed": False,
                "networkRequests": 0, "filesWritten": 0, "outcomesAccessed": False,
            }
    except (DispositionError, OSError, KeyError, TypeError, ValueError, json.JSONDecodeError, subprocess.CalledProcessError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
