#!/usr/bin/env python3
"""Verify the append-only, zero-credit SEC 13F disposition V6 trust chain."""

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
CONTRACT_REL = "research/early-detection-v4/sec-13f-official-list-disposition-contract-v6.json"
VERIFIER_REL = "scripts/verify-sec-13f-official-list-disposition-v6.py"
TEST_REL = "tests/verify-sec-13f-official-list-disposition-v6.test.js"
REMOTE = "https://github.com/Karlryl/screener-data.git"
REMOTE_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
BUILD_BASE = "6d69e42eb377b6345f7392e57e693d924b366cc3"
V5_INTRODUCTION = "c172b73a36e7b3001797520514c790925f258784"
V5_BUILD_BASE = "a37df2107ae9837939e036a33c6ef152934c6cfc"
V4_INTRODUCTION = "95b10fe726557c75dc1bcc828f595214fb77c8e2"
V4_BUILD_BASE = "890c0afbf68fde0bbe4d871dcad1b9d48b51149a"
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

V4_FILES = {
    "research/early-detection-v4/sec-13f-official-list-disposition-contract-v4.json": "ba17efd23a14731bf38dea3a4b6c4e6f9bbee5f588a61a6067afecdc3fde72b6",
    "scripts/verify-sec-13f-official-list-disposition-v4.py": "843853c481410f5389b79c5bf5b9490d43ebdf7523f831bbf30171d9e02a77e3",
    "tests/verify-sec-13f-official-list-disposition-v4.test.js": "e3c1056017d858069ef9eac76e65914cc0891eba91fe5295508fa3c2cdf9e802",
}

V5_FILES = {
    "research/early-detection-v4/sec-13f-official-list-disposition-contract-v5.json": "5fc8439f86ade708d85b3ebfb055b9aebddc4f7fe4bf7b9295fdc33088e19f6b",
    "scripts/verify-sec-13f-official-list-disposition-v5.py": "a23724b413c541b393dcd4687cf1c973961d356fe2b1bb8cf4b2a7cf8812bf5e",
    "tests/verify-sec-13f-official-list-disposition-v5.test.js": "6e495995b9af2fedb578e460e0bc72a92e1fa37c1121e3a209d00eeeb624d889",
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


def expected_claim_locks() -> dict[str, bool]:
    return {
        "futureExecutionAuthorized": False,
        "dataRowsPromoted": False,
        "publicIdentifiersPublishedByV6": False,
        "historicalIdentityIntervalsComplete": False,
        "securityIdentityResolved": False,
        "listingIdentityResolved": False,
        "terminalWealthComplete": False,
        "pricesAccessed": False,
        "returnsAccessed": False,
        "outcomesAccessed": False,
        "originalV4GateCredit": False,
        "humanAttestation": False,
    }


def validate_contract(value: dict[str, Any]) -> None:
    exact_keys(value, {
        "schema", "createdAt", "taskId", "track", "purpose", "supersedesV5",
        "v4TrustAnchor", "dependencyGitBindings", "implementationContract",
        "testContract", "sourceDisposition", "incidentDisposition",
        "claimCeiling", "claimLocks", "contractSha256",
    }, "contract")
    body = dict(value)
    claimed_self = body.pop("contractSha256")
    if HEX64.fullmatch(claimed_self) is None or sha(canonical(body)) != claimed_self:
        fail("contract self hash changed")
    if value["schema"] != "sec-13f-official-list-disposition-contract/v6":
        fail("contract schema changed")
    if value["taskId"] != "Q005-SEC-13F-OFFICIAL-LIST-DISPOSITION-V6":
        fail("task ID changed")
    if re.fullmatch(r"2026-08-13T\d{2}:\d{2}:\d{2}Z", value["createdAt"]) is None:
        fail("creation time malformed")
    if value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("track changed")
    if value["supersedesV5"] != {
        "contractPath": "research/early-detection-v4/sec-13f-official-list-disposition-contract-v5.json",
        "contractRawSha256": V5_FILES["research/early-detection-v4/sec-13f-official-list-disposition-contract-v5.json"],
        "verifierPath": "scripts/verify-sec-13f-official-list-disposition-v5.py",
        "verifierRawSha256": V5_FILES["scripts/verify-sec-13f-official-list-disposition-v5.py"],
        "testPath": "tests/verify-sec-13f-official-list-disposition-v5.test.js",
        "testRawSha256": V5_FILES["tests/verify-sec-13f-official-list-disposition-v5.test.js"],
        "introductionCommit": V5_INTRODUCTION,
        "introductionParent": V5_BUILD_BASE,
        "knownOwnHashMismatch": True,
        "repositoryVerificationPassed": False,
        "studyCredit": "ZERO",
    }:
        fail("V5 supersession changed")
    if value["v4TrustAnchor"] != {
        "introductionCommit": V4_INTRODUCTION,
        "introductionParent": V4_BUILD_BASE,
        "files": [{"path": relative, "rawSha256": expected} for relative, expected in V4_FILES.items()],
        "studyCredit": "ZERO",
    }:
        fail("V4 trust anchor changed")
    bindings = value["dependencyGitBindings"]
    if not isinstance(bindings, list) or len(bindings) != len(DEPENDENCIES):
        fail("dependency binding count changed")
    rebuilt: dict[str, str] = {}
    for item in bindings:
        exact_keys(item, {"path", "rawSha256", "requiredAtV4AndV6IntroductionCommits"}, "dependency binding")
        if item["requiredAtV4AndV6IntroductionCommits"] is not True:
            fail("dependency Git binding weakened")
        rebuilt[item["path"]] = item["rawSha256"]
    if rebuilt != DEPENDENCIES:
        fail("dependency Git bindings changed")
    implementation = value["implementationContract"]
    exact_keys(implementation, {
        "buildBaseCommit", "contractPath", "verifierPath", "verifierRawSha256",
        "testPath", "testRawSha256", "remote", "ref",
        "introductionDirectChildOfBuildBase", "singleIntroductionCommitRequired",
        "allOwnPathsAbsentAtBuildBase", "contractUsesCanonicalSelfHashNotRawSelfReference",
    }, "implementation contract")
    if implementation["buildBaseCommit"] != BUILD_BASE:
        fail("build base changed")
    if implementation["contractPath"] != CONTRACT_REL or implementation["verifierPath"] != VERIFIER_REL or implementation["testPath"] != TEST_REL:
        fail("implementation path changed")
    if implementation["remote"] != REMOTE or implementation["ref"] != REMOTE_REF:
        fail("remote binding changed")
    for key in (
        "introductionDirectChildOfBuildBase", "singleIntroductionCommitRequired",
        "allOwnPathsAbsentAtBuildBase", "contractUsesCanonicalSelfHashNotRawSelfReference",
    ):
        if implementation[key] is not True:
            fail("introduction or self-hash contract weakened")
    if HEX64.fullmatch(implementation["verifierRawSha256"]) is None or HEX64.fullmatch(implementation["testRawSha256"]) is None:
        fail("implementation hash malformed")
    if value["testContract"] != {
        "authoritativeNodeRunsVerifyNormal": True,
        "authoritativeNodeRunsVerifyOptimized": True,
        "preIntroductionOwnLocalBytesBound": 3,
        "expectedDependenciesGitBound": 12,
        "expectedV4FilesGitBound": 3,
        "expectedV5FilesGitBound": 3,
        "expectedV6OwnFilesGitBound": 3,
        "expectedV5IntroductionCommit": V5_INTRODUCTION,
        "expectedBuildBaseCommit": BUILD_BASE,
        "wholeTreeAbsenceClaimed": False,
        "studyCredit": "ZERO",
    }:
        fail("authoritative test contract changed")
    if value["sourceDisposition"] != {
        "status": "QUARANTINED_RESTRICTED_INTERNAL_EVALUATION_ONLY",
        "studyCredit": "ZERO",
        "futureExecutionAuthorized": False,
        "automatedArchiveExecutionAuthorized": False,
        "identityCapabilityClosed": False,
        "terminalCapabilityClosed": False,
    }:
        fail("source disposition changed")
    if value["incidentDisposition"] != {
        "exactIdentifierRepeatedInV6": False,
        "removedFromPilotRunnerAndTestCurrentBytes": True,
        "identifierAbsentFromWholeCurrentTree": False,
        "knownPreexistingArtifactCount": 3,
        "historyRewritePerformed": False,
        "providerPdfOrDatasetCapturedByThisPilot": False,
        "providerCaptureNegativeScope": "THIS_PILOT_AND_REPO_DEFAULT_PATHS_ONLY_NOT_MACHINE_WIDE",
    }:
        fail("incident disposition changed")
    exact_keys(value["claimCeiling"], {"allowed", "forbidden"}, "claim ceiling")
    required_forbidden = {
        "PUBLIC_CUSIP_OR_DESCRIPTION", "HISTORICAL_IDENTITY_INTERVAL",
        "CIK_SECURITY_OR_LISTING_IDENTITY_RESOLVED", "TERMINAL_SESSION_PAYMENT_OR_WEALTH",
        "PRICE_RETURN_OR_OUTCOME", "ORIGINAL_V4_GATE_CREDIT", "HUMAN_ATTESTATION",
    }
    if not required_forbidden.issubset(set(value["claimCeiling"]["forbidden"])):
        fail("claim ceiling weakened")
    if value["claimLocks"] != expected_claim_locks():
        fail("claim locks changed")


def load_contract() -> dict[str, Any]:
    value = json.loads(path(CONTRACT_REL).read_bytes())
    validate_contract(value)
    return value


def local_own_hashes(contract: dict[str, Any]) -> dict[str, str]:
    implementation = contract["implementationContract"]
    hashes = {
        CONTRACT_REL: sha(path(CONTRACT_REL).read_bytes()),
        VERIFIER_REL: sha(path(VERIFIER_REL).read_bytes()),
        TEST_REL: sha(path(TEST_REL).read_bytes()),
    }
    if hashes[VERIFIER_REL] != implementation["verifierRawSha256"]:
        fail("local V6 verifier bytes differ from contract")
    if hashes[TEST_REL] != implementation["testRawSha256"]:
        fail("local V6 test bytes differ from contract")
    return hashes


def added_once(relative: str, base: str) -> str:
    rows = [row for row in git_text("log", "--reverse", "--format=%H", "--diff-filter=A", f"{base}..HEAD", "--", relative).splitlines() if row]
    if len(rows) != 1 or COMMIT40.fullmatch(rows[0]) is None:
        fail(f"path must have one introduction commit: {relative}")
    return rows[0]


def introduction_for(paths: tuple[str, ...], base: str, label: str) -> str:
    introductions = {added_once(relative, base) for relative in paths}
    if len(introductions) != 1:
        fail(f"{label} paths were not introduced together")
    introduction = introductions.pop()
    if git_text("show", "-s", "--format=%P", introduction).split() != [base]:
        fail(f"{label} introduction is not the direct single-parent child of build base")
    for relative in paths:
        if subprocess.run(["git", "cat-file", "-e", f"{base}:{relative}"], cwd=ROOT, capture_output=True).returncode == 0:
            fail(f"{label} path existed at build base")
    return introduction


def git_blob(commit: str, relative: str) -> bytes:
    try:
        return git("show", f"{commit}:{relative}")
    except subprocess.CalledProcessError as exc:
        raise DispositionError(f"Git commit lacks bound path: {relative}") from exc


def verify_repository(contract: dict[str, Any], remote_required: bool) -> dict[str, Any]:
    if git_text("remote", "get-url", "origin") != REMOTE:
        fail("origin URL changed")
    head = git_text("rev-parse", "HEAD")
    if git_text("rev-parse", "@{u}") != head:
        fail("HEAD and upstream differ")
    if remote_required:
        remote = git_text("ls-remote", "--refs", "origin", REMOTE_REF).split()
        if len(remote) != 2 or remote[0] != head or remote[1] != REMOTE_REF:
            fail("live remote differs")
    v6_intro = introduction_for((CONTRACT_REL, VERIFIER_REL, TEST_REL), BUILD_BASE, "V6")
    v5_intro = introduction_for(tuple(V5_FILES), V5_BUILD_BASE, "V5")
    if v5_intro != V5_INTRODUCTION:
        fail("V5 introduction commit changed")
    if git_text("show", "-s", "--format=%P", V4_INTRODUCTION).split() != [V4_BUILD_BASE]:
        fail("V4 introduction topology changed")
    if added_once("research/early-detection-v4/sec-13f-official-list-disposition-contract-v4.json", V4_BUILD_BASE) != V4_INTRODUCTION:
        fail("V4 introduction commit changed")
    if subprocess.run(["git", "merge-base", "--is-ancestor", V4_INTRODUCTION, BUILD_BASE], cwd=ROOT, capture_output=True).returncode != 0:
        fail("V4 introduction is not an ancestor of V6 build base")
    for relative, expected in DEPENDENCIES.items():
        local = path(relative).read_bytes()
        if sha(local) != expected or git_blob(V4_INTRODUCTION, relative) != local or git_blob(v6_intro, relative) != local:
            fail(f"dependency local/V4/V6 Git binding changed: {relative}")
    for relative, expected in V4_FILES.items():
        local = path(relative).read_bytes()
        if sha(local) != expected or git_blob(V4_INTRODUCTION, relative) != local or git_blob(v6_intro, relative) != local:
            fail(f"V4 local/introduction/V6 Git binding changed: {relative}")
    for relative, expected in V5_FILES.items():
        local = path(relative).read_bytes()
        if sha(local) != expected or git_blob(V5_INTRODUCTION, relative) != local or git_blob(v6_intro, relative) != local:
            fail(f"V5 local/introduction/V6 Git binding changed: {relative}")
    own = local_own_hashes(contract)
    for relative, expected in own.items():
        if git_blob(v6_intro, relative) != path(relative).read_bytes() or sha(path(relative).read_bytes()) != expected:
            fail(f"V6 own Git binding changed: {relative}")
    return {
        "introductionCommit": v6_intro,
        "buildBaseCommit": BUILD_BASE,
        "v5IntroductionCommit": V5_INTRODUCTION,
        "dependenciesGitBound": len(DEPENDENCIES),
        "v4FilesGitBound": len(V4_FILES),
        "v5FilesGitBound": len(V5_FILES),
        "v6OwnFilesGitBound": len(own),
        "introductionDirectChildOfBuildBase": True,
        "remoteVerified": remote_required,
    }


def rejected(action: Callable[[], None]) -> bool:
    try:
        action()
    except (DispositionError, KeyError, TypeError, ValueError):
        return True
    return False


def reseal(value: dict[str, Any]) -> dict[str, Any]:
    body = dict(value)
    body.pop("contractSha256")
    value["contractSha256"] = sha(canonical(body))
    return value


def self_test(contract: dict[str, Any]) -> dict[str, Any]:
    mutations: list[dict[str, Any]] = []
    for section, key, changed in (
        ("supersedesV5", "knownOwnHashMismatch", False),
        ("sourceDisposition", "studyCredit", "POSITIVE"),
        ("sourceDisposition", "futureExecutionAuthorized", True),
        ("incidentDisposition", "identifierAbsentFromWholeCurrentTree", True),
        ("testContract", "authoritativeNodeRunsVerifyOptimized", False),
        ("implementationContract", "buildBaseCommit", "0" * 40),
        ("claimLocks", "originalV4GateCredit", True),
    ):
        item = copy.deepcopy(contract)
        item[section][key] = changed
        mutations.append(reseal(item))
    if not all(rejected(lambda item=item: validate_contract(item)) for item in mutations):
        fail("semantically resealed contract mutation survived")
    for relative, expected in {**DEPENDENCIES, **V4_FILES, **V5_FILES}.items():
        if sha(path(relative).read_bytes()) != expected:
            fail(f"pre-introduction bound bytes changed: {relative}")
    own = local_own_hashes(contract)
    return {
        "schema": "sec-13f-official-list-disposition-self-test/v6",
        "status": "PASS",
        "semanticMutationsRejected": len(mutations),
        "localDependenciesHashed": len(DEPENDENCIES),
        "localV4FilesHashed": len(V4_FILES),
        "localV5FilesHashed": len(V5_FILES),
        "localOwnBytesBound": len(own),
        "localOwnRawSha256": own,
        "authoritativeNodeMustRunVerifyNormalAndOptimized": True,
        "wholeTreeAbsenceNotClaimed": True,
        "studyCredit": "ZERO",
        "networkRequests": 0,
        "filesWritten": 0,
        "outcomesAccessed": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify", "self-test"))
    parser.add_argument("--remote", action="store_true")
    args = parser.parse_args()
    try:
        contract = load_contract()
        if args.command == "self-test":
            result = self_test(contract)
        else:
            result = {
                "schema": "sec-13f-official-list-disposition-verification/v6",
                "status": "PASS",
                **verify_repository(contract, args.remote),
                "studyCredit": "ZERO",
                "wholeTreeAbsenceClaimed": False,
                "networkRequests": 0,
                "filesWritten": 0,
                "outcomesAccessed": False,
            }
    except (DispositionError, OSError, KeyError, TypeError, ValueError, json.JSONDecodeError, subprocess.CalledProcessError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
