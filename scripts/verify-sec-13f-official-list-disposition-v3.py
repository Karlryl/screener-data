#!/usr/bin/env python3
"""Verify the honest, zero-credit SEC 13F quarantine disposition."""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_REL = "research/early-detection-v4/sec-13f-official-list-disposition-contract-v3.json"
VERIFIER_REL = "scripts/verify-sec-13f-official-list-disposition-v3.py"
TEST_REL = "tests/verify-sec-13f-official-list-disposition-v3.test.js"
V1_CONTRACT_REL = "research/early-detection-v4/sec-13f-official-list-private-pilot-contract-v1.json"
V1_RUNNER_REL = "scripts/run-sec-13f-official-list-private-pilot-v1.py"
V1_TEST_REL = "tests/run-sec-13f-official-list-private-pilot-v1.test.js"
V2_CONTRACT_REL = "research/early-detection-v4/sec-13f-official-list-disposition-contract-v2.json"
V2_VERIFIER_REL = "scripts/verify-sec-13f-official-list-disposition-v2.py"
V2_TEST_REL = "tests/verify-sec-13f-official-list-disposition-v2.test.js"
REMOTE = "https://github.com/Karlryl/screener-data.git"
REMOTE_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
BUILD_BASE = "773b17f8f4dfb063258299d7cdcc97a1ff0c0b32"
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
COMMIT40 = re.compile(r"[0-9a-f]{40}\Z")
CUSIP_SHAPE = re.compile(rb"(?<![0-9A-Z*@#])[0-9A-Z*@#]{6}\s+[0-9A-Z*@#]{2}\s+[0-9](?![0-9A-Z*@#])")


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
        "schema", "createdAt", "taskId", "track", "purpose", "supersedes",
        "incidentDisposition", "remediationBindings", "implementationContract",
        "sourceDisposition", "eligibilityCensus", "claimCeiling", "claimLocks",
        "contractSha256",
    }, "contract")
    body = dict(value)
    claim = body.pop("contractSha256")
    if HEX64.fullmatch(claim) is None or sha(canonical(body)) != claim:
        fail("contract self hash changed")
    if value["schema"] != "sec-13f-official-list-disposition-contract/v3":
        fail("contract schema changed")
    if value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("track changed")
    supersedes = value["supersedes"]
    exact_keys(supersedes, {"v1", "v2"}, "supersedes")
    exact_keys(supersedes["v1"], {"contractPath", "contractRawSha256", "introductionCommit", "studyCredit"}, "superseded V1")
    exact_keys(supersedes["v2"], {"contractPath", "contractRawSha256", "verifierPath", "verifierRawSha256", "testPath", "testRawSha256", "studyCredit"}, "superseded V2")
    if supersedes["v1"] != {
        "contractPath": V1_CONTRACT_REL,
        "contractRawSha256": "a432e808953f3208cb9f723c5e9778b7257dbbd0df4a7c25f5e359a2ab0e2018",
        "introductionCommit": "a4a06368149efe67e8418e489510fd6e88d277a4",
        "studyCredit": "ZERO",
    }:
        fail("superseded V1 binding changed")
    if supersedes["v2"] != {
        "contractPath": V2_CONTRACT_REL,
        "contractRawSha256": "0f17d30808233fad2e76c64dd29b8e2bd56c99503848f72c42a9ccff0a1c41bf",
        "verifierPath": V2_VERIFIER_REL,
        "verifierRawSha256": "d17158ba30fe8fb63d84c7b073026016d2c142fc786304148b1277a0f8a3c1d5",
        "testPath": V2_TEST_REL,
        "testRawSha256": "450aa617c4f89c5b4351c18dcb3109d0485d6310e167b945a504386ba4ead96b",
        "studyCredit": "ZERO",
    }:
        fail("superseded V2 binding changed")
    incident = value["incidentDisposition"]
    exact_keys(incident, {
        "classification", "exactIdentifierRepeatedInDisposition", "removedFromPilotRunnerAndTestCurrentBytes",
        "identifierAbsentFromWholeCurrentTree", "knownPreexistingArtifactsContainingSameIdentifier",
        "historyRewritePerformed", "historyRewriteRequiresExplicitUserApproval",
        "providerPdfOrDatasetCapturedByThisPilot", "providerCaptureNegativeScope",
    }, "incident disposition")
    if incident["exactIdentifierRepeatedInDisposition"] is not False:
        fail("identifier repetition enabled")
    if incident["removedFromPilotRunnerAndTestCurrentBytes"] is not True:
        fail("pilot-byte remediation changed")
    if incident["identifierAbsentFromWholeCurrentTree"] is not False:
        fail("whole-tree absence falsely asserted")
    artifacts = incident["knownPreexistingArtifactsContainingSameIdentifier"]
    if not isinstance(artifacts, list) or len(artifacts) != 3:
        fail("known preexisting artifact disclosure changed")
    expected_artifacts = {
        "reports/early-detection/sec-terminal-candidate-reconciliation-v1.json": "e38823a9701a7ea58afc1a91e5ed209837251f2e397fdf9d31bc4433831b4fa0",
        "reports/early-detection/sec-terminal-candidate-triage-v1.json": "ca879151eebd487609be39a4aa76faf83a1294c86736e00865a2759b5c7a860b",
        "reports/early-detection/sec-terminal-primary-document-extraction-v1.json": "987560ca38931cfa818f6c9fb315be7875ec98fd872518ef51d45f5af3589464",
    }
    actual_artifacts: dict[str, str] = {}
    for item in artifacts:
        exact_keys(item, {"path", "rawSha256", "disposition"}, "preexisting artifact")
        if item["disposition"] != "PREEXISTING_APPEND_ONLY_SEC_RESEARCH_ARTIFACT_NOT_A_13F_CAPTURE":
            fail("preexisting artifact disposition changed")
        actual_artifacts[item["path"]] = item["rawSha256"]
    if actual_artifacts != expected_artifacts:
        fail("preexisting artifact bindings changed")
    if incident["historyRewritePerformed"] is not False or incident["historyRewriteRequiresExplicitUserApproval"] is not True:
        fail("history disposition changed")
    if incident["providerPdfOrDatasetCapturedByThisPilot"] is not False:
        fail("provider capture claim changed")
    if incident["providerCaptureNegativeScope"] != "THIS_PILOT_AND_REPO_DEFAULT_PATHS_ONLY_NOT_MACHINE_WIDE":
        fail("provider capture negative scope changed")
    remediation = value["remediationBindings"]
    exact_keys(remediation, {
        "runnerPath", "runnerRawSha256", "testPath", "testRawSha256",
        "cliExecutionDisabled", "networkEntrypointDisabled", "reportEntrypointDisabled", "writeEntrypointDisabled",
    }, "remediation bindings")
    if remediation != {
        "runnerPath": V1_RUNNER_REL,
        "runnerRawSha256": "3c4a0f575891dc002bd19e0e68b5a714a25fbed3b11cab0435a9be1b1c10497a",
        "testPath": V1_TEST_REL,
        "testRawSha256": "6085403f55b158ff8428f7ee8ad2fbdfb6436d90cbc9080ba67aa9ed1a78cbff",
        "cliExecutionDisabled": True,
        "networkEntrypointDisabled": True,
        "reportEntrypointDisabled": True,
        "writeEntrypointDisabled": True,
    }:
        fail("remediation bindings changed")
    implementation = value["implementationContract"]
    exact_keys(implementation, {
        "buildBaseCommit", "contractPath", "verifierPath", "verifierRawSha256", "testPath", "testRawSha256",
        "remote", "ref", "introductionDirectChildOfBuildBase", "singleIntroductionCommitRequired",
    }, "implementation contract")
    if implementation["buildBaseCommit"] != BUILD_BASE or implementation["contractPath"] != CONTRACT_REL:
        fail("implementation base changed")
    if implementation["verifierPath"] != VERIFIER_REL or implementation["testPath"] != TEST_REL:
        fail("implementation paths changed")
    if implementation["remote"] != REMOTE or implementation["ref"] != REMOTE_REF:
        fail("remote binding changed")
    if implementation["introductionDirectChildOfBuildBase"] is not True or implementation["singleIntroductionCommitRequired"] is not True:
        fail("introduction topology weakened")
    if HEX64.fullmatch(implementation["verifierRawSha256"]) is None or HEX64.fullmatch(implementation["testRawSha256"]) is None:
        fail("implementation hash malformed")
    source = value["sourceDisposition"]
    if source["status"] != "QUARANTINED_RESTRICTED_INTERNAL_EVALUATION_ONLY":
        fail("source quarantine changed")
    for key in (
        "rawCusipPublicationAllowed", "issuerDescriptionPublicationAllowed", "automatedArchiveExecutionAuthorized",
        "identityCapabilityClosed", "terminalCapabilityClosed", "futureExecutionAuthorized",
    ):
        if source[key] is not False:
            fail(f"source boundary opened: {key}")
    census = value["eligibilityCensus"]
    if census["frozenGapRows"] != 656 or census["rowsWithLabelBoundCusipEvidence"] != 1 or census["rowsWithoutLabelBoundCusipEvidence"] != 655:
        fail("eligibility census changed")
    if census["fullArchivePilotWorthExecutingNow"] is not False:
        fail("low-utility archive execution enabled")
    if any(item is not False for item in value["claimLocks"].values()):
        fail("claim lock opened")
    forbidden = set(value["claimCeiling"]["forbidden"])
    required = {
        "PUBLIC_CUSIP_OR_DESCRIPTION", "HISTORICAL_IDENTITY_INTERVAL", "CIK_SECURITY_OR_LISTING_IDENTITY_RESOLVED",
        "TERMINAL_SESSION_PAYMENT_OR_WEALTH", "PRICE_RETURN_OR_OUTCOME", "ORIGINAL_V4_GATE_CREDIT", "HUMAN_ATTESTATION",
    }
    if not required.issubset(forbidden):
        fail("claim ceiling weakened")


def load_contract() -> tuple[dict[str, Any], bytes]:
    raw = path(CONTRACT_REL).read_bytes()
    value = json.loads(raw)
    validate_contract(value)
    return value, raw


def introduction_commit() -> str:
    commits = [line for line in git_text("log", "--reverse", "--format=%H", "--diff-filter=A", f"{BUILD_BASE}..HEAD", "--", CONTRACT_REL).splitlines() if line]
    if len(commits) != 1 or COMMIT40.fullmatch(commits[0]) is None:
        fail("V3 contract must have one introduction commit")
    introduction = commits[0]
    parents = git_text("show", "-s", "--format=%P", introduction).split()
    if parents != [BUILD_BASE]:
        fail("V3 introduction is not the direct single-parent child of build base")
    return introduction


def verify_git_and_remote(contract: dict[str, Any], remote_required: bool) -> str:
    if git_text("remote", "get-url", "origin") != REMOTE:
        fail("origin URL changed")
    head = git_text("rev-parse", "HEAD")
    upstream = git_text("rev-parse", "@{u}")
    if head != upstream:
        fail("HEAD and upstream differ")
    if remote_required:
        remote_lines = git_text("ls-remote", "origin", REMOTE_REF).split()
        if len(remote_lines) != 2 or remote_lines[0] != head:
            fail("live remote differs")
    introduction = introduction_commit()
    if subprocess.run(["git", "merge-base", "--is-ancestor", introduction, head], cwd=ROOT, capture_output=True).returncode != 0:
        fail("introduction is not an ancestor of HEAD")
    implementation = contract["implementationContract"]
    for relative, expected in (
        (CONTRACT_REL, sha(path(CONTRACT_REL).read_bytes())),
        (VERIFIER_REL, implementation["verifierRawSha256"]),
        (TEST_REL, implementation["testRawSha256"]),
    ):
        local = path(relative).read_bytes()
        if sha(local) != expected or git("show", f"{introduction}:{relative}") != local:
            fail(f"V3 implementation binding changed: {relative}")
    for item in contract["incidentDisposition"]["knownPreexistingArtifactsContainingSameIdentifier"]:
        local = path(item["path"]).read_bytes()
        if sha(local) != item["rawSha256"] or git("show", f"{BUILD_BASE}:{item['path']}") != local:
            fail("preexisting SEC artifact binding changed")
    return introduction


def load_v1_module() -> Any:
    spec = importlib.util.spec_from_file_location("sec13f_v1_disabled", path(V1_RUNNER_REL))
    if spec is None or spec.loader is None:
        fail("cannot load remediated V1")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def entrypoints_disabled() -> dict[str, bool]:
    module = load_v1_module()
    network_reached = False

    def forbidden_urlopen(*args: Any, **kwargs: Any) -> Any:
        nonlocal network_reached
        network_reached = True
        raise AssertionError("network boundary reached")

    module.urllib.request.urlopen = forbidden_urlopen
    results: dict[str, bool] = {}
    actions: dict[str, Callable[[], Any]] = {
        "networkEntrypointDisabled": module.fetch,
        "reportEntrypointDisabled": lambda: module.build_private_report(b"%PDF-disabled"),
    }
    with tempfile.TemporaryDirectory() as temporary:
        target = Path(temporary) / "forbidden.bin"
        actions["writeEntrypointDisabled"] = lambda: module.atomic_create(target, b"forbidden")
        for name, action in actions.items():
            try:
                action()
            except module.PilotError:
                results[name] = True
            else:
                results[name] = False
        if target.exists():
            results["writeEntrypointDisabled"] = False
    if network_reached:
        results["networkEntrypointDisabled"] = False
    return results


def verify_current_bytes(contract: dict[str, Any]) -> None:
    supersedes = contract["supersedes"]
    expected = {
        V1_CONTRACT_REL: supersedes["v1"]["contractRawSha256"],
        V2_CONTRACT_REL: supersedes["v2"]["contractRawSha256"],
        V2_VERIFIER_REL: supersedes["v2"]["verifierRawSha256"],
        V2_TEST_REL: supersedes["v2"]["testRawSha256"],
        V1_RUNNER_REL: contract["remediationBindings"]["runnerRawSha256"],
        V1_TEST_REL: contract["remediationBindings"]["testRawSha256"],
    }
    for relative, expected_raw in expected.items():
        if sha(path(relative).read_bytes()) != expected_raw:
            fail(f"bound bytes changed: {relative}")
    if CUSIP_SHAPE.search(path(V1_RUNNER_REL).read_bytes()) or CUSIP_SHAPE.search(path(V1_TEST_REL).read_bytes()):
        fail("CUSIP-shaped fixture remains in pilot runner/test")
    disabled = entrypoints_disabled()
    if disabled != {
        "networkEntrypointDisabled": True,
        "reportEntrypointDisabled": True,
        "writeEntrypointDisabled": True,
    }:
        fail("one or more V1 callable entrypoints remain enabled")


def rejected(action: Callable[[], None]) -> bool:
    try:
        action()
    except (DispositionError, KeyError, TypeError, ValueError):
        return True
    return False


def self_test(contract: dict[str, Any]) -> dict[str, Any]:
    mutations: list[dict[str, Any]] = []
    for section, key, changed in (
        ("incidentDisposition", "identifierAbsentFromWholeCurrentTree", True),
        ("incidentDisposition", "exactIdentifierRepeatedInDisposition", True),
        ("sourceDisposition", "automatedArchiveExecutionAuthorized", True),
        ("sourceDisposition", "futureExecutionAuthorized", True),
        ("eligibilityCensus", "fullArchivePilotWorthExecutingNow", True),
        ("claimLocks", "originalV4GateCredit", True),
    ):
        item = copy.deepcopy(contract)
        item[section][key] = changed
        mutations.append(item)
    kills = [rejected(lambda item=item: validate_contract(item)) for item in mutations]
    if not all(kills):
        fail("contract mutation survived")
    verify_current_bytes(contract)
    return {
        "schema": "sec-13f-official-list-disposition-self-test/v3",
        "status": "PASS", "mutationsRejected": len(kills),
        "V1NetworkReportAndWriteEntrypointsDisabled": True,
        "wholeTreeAbsenceNotClaimed": True, "studyCredit": "ZERO",
        "networkRequests": 0, "filesWritten": 0, "outcomesAccessed": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify", "self-test"))
    parser.add_argument("--remote", action="store_true")
    args = parser.parse_args()
    contract, _ = load_contract()
    if args.command == "self-test":
        result = self_test(contract)
    else:
        verify_current_bytes(contract)
        introduction = verify_git_and_remote(contract, args.remote)
        result = {
            "schema": "sec-13f-official-list-disposition-verification/v3",
            "status": "PASS", "introductionCommit": introduction,
            "disposition": contract["sourceDisposition"]["status"],
            "studyCredit": "ZERO", "wholeTreeAbsenceClaimed": False,
            "networkRequests": 0, "filesWritten": 0, "outcomesAccessed": False,
        }
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
