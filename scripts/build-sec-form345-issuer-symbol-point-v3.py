#!/usr/bin/env python3
"""Build Form 3/4/5 issuer-symbol points under the append-only V3 authorization."""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "research" / "early-detection-v4" / "sec-form345-issuer-symbol-point-contract-v3.json"
BUILDER_PATH = Path(__file__).resolve()
TEST_PATH = ROOT / "tests" / "build-sec-form345-issuer-symbol-point-v3.test.js"
OUTPUT_PATH = ROOT / "reports" / "early-detection" / "sec-form345-issuer-symbol-point-v3.json"
V2_CONTRACT_PATH = ROOT / "research" / "early-detection-v4" / "sec-form345-issuer-symbol-point-contract-v2.json"
V2_BUILDER_PATH = ROOT / "scripts" / "build-sec-form345-issuer-symbol-point-v2.py"
V2_TEST_PATH = ROOT / "tests" / "build-sec-form345-issuer-symbol-point-v2.test.js"

CONTRACT_RAW_SHA256 = "fe3ab39b615bd78da92acc3da64575dbb3b66103adccdd9ad9460b2a7631df50"
CONTRACT_SELF_SHA256 = "f4f14ca6c91a06d989e0681d070224d0cb33a2bf929065ce3c37367ce5c1f38f"
PARENT_REMOTE_COMMIT = "c07279bdabf4e4b7f70b0aae7c32ab5da2c1c1f5"
PARENT_TAG = 839
REMOTE_URL = "https://github.com/Karlryl/screener-data.git"
REMOTE_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
REMOTE_TRACKING_REF = "origin/codex/early-detection-v4-gates-20260810"
V2_INTRODUCTION_COMMIT = "6d69e42eb377b6345f7392e57e693d924b366cc3"
V2_INTRODUCTION_PARENT = "c172b73a36e7b3001797520514c790925f258784"
V2_CONTRACT_RAW_SHA256 = "b3d7a6ab30999cac316e7e92b159a2ecf1b6339531c6c8a11dbe93a2003e26c4"
V2_CONTRACT_SELF_SHA256 = "5c721cca043ea68366a67fa4ffd44c81ce6f3f7d6e582373d7c9e3c918a61e5a"
V2_BUILDER_RAW_SHA256 = "ebe692a2532a1aab62bffd4a5b17631bf99c9467828c18585899dfbe551521e7"
V2_TEST_RAW_SHA256 = "72881db9ebe7da649a5a9c489739855a0fe2d4f06895d7663d1073abbf5e9ab1"
V2_GIT_BLOBS = {
    "research/early-detection-v4/sec-form345-issuer-symbol-point-contract-v2.json": "322621a4aa338606581bdbef56bad542645988ba",
    "scripts/build-sec-form345-issuer-symbol-point-v2.py": "fe707a931b9d0cb2ed6c0922d113346835bebc4c",
    "tests/build-sec-form345-issuer-symbol-point-v2.test.js": "25bf1c44e394c684c540ef6c18b70c9130e2505f",
}
CONTRACT_SCHEMA = "sec-form345-issuer-symbol-point-contract/v3"
OUTPUT_SCHEMA = "sec-form345-issuer-symbol-point/v3"
EXPECTED_TOTALS = {
    "allRows": 3_352_003,
    "targetRows": 164_675,
    "blankIssuerNameAllRows": 1_188,
    "blankIssuerNameTargetRows": 23,
}
OWNED_PATHS = (CONTRACT_PATH, BUILDER_PATH, TEST_PATH)


class EvidenceError(RuntimeError):
    """Fail-closed V3 contract, provenance, missingness, or topology error."""


def fail(message: str) -> None:
    raise EvidenceError(message)


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        fail(f"{label} keys changed")


def with_self_hash(value: dict[str, Any], field: str) -> dict[str, Any]:
    value[field] = sha256(canonical_bytes({key: item for key, item in value.items() if key != field}))
    return value


def validate_self_hash(value: dict[str, Any], field: str, label: str) -> None:
    expected = sha256(canonical_bytes({key: item for key, item in value.items() if key != field}))
    if value.get(field) != expected:
        fail(f"{label} self hash changed")


def git_text(*args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=ROOT, check=True, capture_output=True, text=True
    ).stdout.strip()


def git_bytes(*args: str) -> bytes:
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True).stdout


def import_v2() -> Any:
    spec = importlib.util.spec_from_file_location("sec_form345_point_v2_bound", V2_BUILDER_PATH)
    if spec is None or spec.loader is None:
        fail("V2 builder cannot be imported")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def immutable_v2_expected() -> dict[str, Any]:
    return {
        "introductionCommit": V2_INTRODUCTION_COMMIT,
        "introductionParent": V2_INTRODUCTION_PARENT,
        "contract": {
            "path": "research/early-detection-v4/sec-form345-issuer-symbol-point-contract-v2.json",
            "rawSha256": V2_CONTRACT_RAW_SHA256,
            "selfSha256": V2_CONTRACT_SELF_SHA256,
            "gitBlob": V2_GIT_BLOBS["research/early-detection-v4/sec-form345-issuer-symbol-point-contract-v2.json"],
        },
        "builder": {
            "path": "scripts/build-sec-form345-issuer-symbol-point-v2.py",
            "rawSha256": V2_BUILDER_RAW_SHA256,
            "gitBlob": V2_GIT_BLOBS["scripts/build-sec-form345-issuer-symbol-point-v2.py"],
        },
        "test": {
            "path": "tests/build-sec-form345-issuer-symbol-point-v2.test.js",
            "rawSha256": V2_TEST_RAW_SHA256,
            "gitBlob": V2_GIT_BLOBS["tests/build-sec-form345-issuer-symbol-point-v2.test.js"],
        },
        "v2RemainsUnmodified": True,
        "v2SemanticsFullyInherited": True,
        "v2ProductionTopologyExpired": True,
        "v2OutputMayNotBePromotedAsV3": True,
    }


def expected_claim_locks() -> dict[str, bool]:
    return {
        "outcomesAccessed": False,
        "pricesAccessed": False,
        "returnsAccessed": False,
        "ownerTransactionOrHoldingTablesAccessed": False,
        "historicalIdentityIntervalsComplete": False,
        "permanentSecurityIdentityResolved": False,
        "listingIdentityResolved": False,
        "tickerReuseResolved": False,
        "terminalSessionProven": False,
        "terminalPaymentVerified": False,
        "terminalWealthComplete": False,
        "originalV4GateCredit": False,
        "humanAttestation": False,
    }


def validate_contract_value(value: dict[str, Any], v2_contract: dict[str, Any] | None = None) -> None:
    exact_keys(value, {
        "schema", "createdAt", "taskId", "track", "purpose", "remoteBinding",
        "authorizedImplementation", "immutableV2Base", "semanticInheritance",
        "claimCeiling", "claimLocks", "abortCriteria", "contractSha256",
    }, "V3 contract")
    validate_self_hash(value, "contractSha256", "V3 contract")
    if value["contractSha256"] != CONTRACT_SELF_SHA256:
        fail("V3 contract self binding changed")
    if value["schema"] != CONTRACT_SCHEMA or value["taskId"] != "Q005-SEC-FORM345-ISSUER-SYMBOL-POINT-V3":
        fail("V3 contract identity changed")
    if value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("V3 track changed")
    if value["remoteBinding"] != {
        "remote": REMOTE_URL,
        "ref": REMOTE_REF,
        "parentRemoteCommit": PARENT_REMOTE_COMMIT,
        "parentTag": PARENT_TAG,
        "productionExecutionRequiresRemoteDirectChild": True,
        "introductionCommitMustAddExactlyOwnThreePaths": True,
        "precommitCommandsAllowedAtExactParent": ["verify-contract", "dry-run", "self-test"],
    }:
        fail("V3 remote binding changed")
    if value["authorizedImplementation"] != {
        "contractPath": "research/early-detection-v4/sec-form345-issuer-symbol-point-contract-v3.json",
        "builderPath": "scripts/build-sec-form345-issuer-symbol-point-v3.py",
        "testPath": "tests/build-sec-form345-issuer-symbol-point-v3.test.js",
        "futureOutputPath": "reports/early-detection/sec-form345-issuer-symbol-point-v3.json",
    }:
        fail("V3 implementation paths changed")
    if value["immutableV2Base"] != immutable_v2_expected():
        fail("immutable V2 binding changed")
    semantic = value["semanticInheritance"]
    if semantic != {
        "byteExactV2Sections": [
            "immutableV1Base", "privateCapture", "gapQueue", "sourceScope",
            "v1FailureObservation", "missingnessPolicy", "claimCeiling", "claimLocks",
        ],
        "onlyAuthorizedChanges": [
            "REMOTE_DIRECT_CHILD_FROM_TAG839",
            "V3_CONTRACT_BUILDER_TEST_AND_OUTPUT_PATHS",
            "V3_SCHEMA_TASK_AND_PROVENANCE_BINDINGS",
        ],
        "sourceFile": "SUBMISSION.tsv",
        "nullableSourceField": "ISSUERNAME",
        "issuerNameImputationAllowed": False,
        "blankCoreFieldDisposition": "FAIL_CLOSED",
        "tickerOnlyJoinAllowed": False,
        "expectedCounts": EXPECTED_TOTALS,
        "futureOutputSchema": OUTPUT_SCHEMA,
        "pointEvidenceMayResolveHistoricalInterval": False,
        "pointEvidenceMayResolvePermanentIdentity": False,
    }:
        fail("V3 semantic inheritance changed")
    if value["claimLocks"] != expected_claim_locks():
        fail("V3 claim locks changed")
    required_forbidden = {
        "HISTORICAL_IDENTITY_INTERVAL", "PERMANENT_SECURITY_OR_LISTING_IDENTITY",
        "TICKER_REUSE_RESOLVED", "TERMINAL_SESSION_PAYMENT_OR_WEALTH",
        "PRICE_RETURN_OR_OUTCOME", "ORIGINAL_V4_GATE_CREDIT", "HUMAN_ATTESTATION",
    }
    exact_keys(value["claimCeiling"], {"allowed", "forbidden"}, "V3 claim ceiling")
    if not required_forbidden.issubset(set(value["claimCeiling"]["forbidden"])):
        fail("V3 claim ceiling weakened")
    required_aborts = {
        "V2_ARTIFACT_OR_INTRODUCTION_DRIFT", "V1_CAPTURE_MANIFEST_OR_RAW_BLOB_DRIFT",
        "V3_CONTRACT_GIT_OR_REMOTE_DRIFT", "NON_SUBMISSION_MEMBER_ACCESS",
        "BLANK_CORE_SOURCE_FIELD", "INVENTED_IMPUTED_OR_BACKFILLED_ISSUER_NAME",
        "OBSERVED_CAPTURE_COUNTS_DRIFT", "NON_CIK_JOIN_OR_INTERVAL_PROMOTION",
        "PRICE_RETURN_OUTCOME_OR_OTHER_TABLE_ACCESS", "EXISTING_OUTPUT_OR_SIDEPATH",
    }
    if not required_aborts.issubset(set(value["abortCriteria"])):
        fail("V3 abort criteria weakened")
    if v2_contract is not None:
        for section in semantic["byteExactV2Sections"]:
            inherited = value[section] if section in value else v2_contract[section]
            if inherited != v2_contract[section]:
                fail(f"V2 semantic section changed: {section}")
        if value["claimCeiling"] != v2_contract["claimCeiling"] or value["claimLocks"] != v2_contract["claimLocks"]:
            fail("V2 claim boundary was not inherited exactly")
        observed = v2_contract["v1FailureObservation"]
        if {key: observed[key] for key in EXPECTED_TOTALS} != EXPECTED_TOTALS:
            fail("V2 observed counts changed")
        policy = v2_contract["missingnessPolicy"]
        if (
            policy["nullableSourceField"] != "ISSUERNAME"
            or policy["inventedImputedOrBackfilledIssuerNameAllowed"] is not False
            or policy["blankCoreFieldDisposition"] != "FAIL_CLOSED"
        ):
            fail("V2 issuer-name-only missingness semantics changed")


def load_contract() -> tuple[dict[str, Any], bytes]:
    raw = CONTRACT_PATH.read_bytes()
    if sha256(raw) != CONTRACT_RAW_SHA256:
        fail("V3 contract raw binding changed")
    value = json.loads(raw)
    validate_contract_value(value)
    return value, raw


def validate_v2_bindings(contract: dict[str, Any]) -> tuple[Any, dict[str, Any]]:
    expected = {
        V2_CONTRACT_PATH: V2_CONTRACT_RAW_SHA256,
        V2_BUILDER_PATH: V2_BUILDER_RAW_SHA256,
        V2_TEST_PATH: V2_TEST_RAW_SHA256,
    }
    for artifact, expected_hash in expected.items():
        relative = artifact.relative_to(ROOT).as_posix()
        raw = artifact.read_bytes()
        if sha256(raw) != expected_hash:
            fail(f"V2 worktree artifact drift: {relative}")
        if git_text("rev-parse", f"{V2_INTRODUCTION_COMMIT}:{relative}") != V2_GIT_BLOBS[relative]:
            fail(f"V2 introduction Git blob drift: {relative}")
        if git_bytes("show", f"{V2_INTRODUCTION_COMMIT}:{relative}") != raw:
            fail(f"V2 introduction bytes drift: {relative}")
        if git_bytes("show", f"HEAD:{relative}") != raw:
            fail(f"V2 current Git bytes drift: {relative}")
    if git_text("rev-parse", f"{V2_INTRODUCTION_COMMIT}^") != V2_INTRODUCTION_PARENT:
        fail("V2 introduction parent changed")
    if subprocess.run(
        ["git", "merge-base", "--is-ancestor", V2_INTRODUCTION_COMMIT, "HEAD"],
        cwd=ROOT,
    ).returncode != 0:
        fail("V2 introduction is not an ancestor of HEAD")
    v2 = import_v2()
    v2_contract, _ = v2.load_contract()
    if v2_contract["contractSha256"] != V2_CONTRACT_SELF_SHA256:
        fail("V2 contract self hash changed")
    validate_contract_value(contract, v2_contract)
    return v2, v2_contract


def validate_topology_values(head: str, remote: str, parent: str | None, production: bool) -> None:
    if production:
        if head == PARENT_REMOTE_COMMIT or remote != head or parent != PARENT_REMOTE_COMMIT:
            fail("production requires the exact remote direct child of Tag839")
    elif head != PARENT_REMOTE_COMMIT or remote != PARENT_REMOTE_COMMIT:
        fail("precommit verification requires exact Tag839 local and remote base")


def verify_precommit_topology() -> dict[str, str]:
    if git_text("remote", "get-url", "origin") != REMOTE_URL:
        fail("origin URL changed")
    head = git_text("rev-parse", "HEAD")
    remote = git_text("rev-parse", REMOTE_TRACKING_REF)
    validate_topology_values(head, remote, None, False)
    return {"head": head, "remote": remote}


def verify_production_topology() -> dict[str, str]:
    if git_text("remote", "get-url", "origin") != REMOTE_URL:
        fail("origin URL changed")
    head = git_text("rev-parse", "HEAD")
    parents = git_text("show", "-s", "--format=%P", "HEAD").split()
    parent = parents[0] if len(parents) == 1 else None
    lines = git_text("ls-remote", "--exit-code", "origin", REMOTE_REF).splitlines()
    if len(lines) != 1:
        fail("remote ref resolution is ambiguous")
    remote = lines[0].split()[0]
    validate_topology_values(head, remote, parent, True)
    expected_added = {path.relative_to(ROOT).as_posix() for path in OWNED_PATHS}
    added_rows = git_text("diff-tree", "--no-commit-id", "--name-status", "-r", head).splitlines()
    actual_added = {row.split("\t", 1)[1] for row in added_rows if row.startswith("A\t")}
    if len(added_rows) != 3 or actual_added != expected_added:
        fail("V3 introduction commit must add exactly the three owned paths")
    for artifact in OWNED_PATHS:
        relative = artifact.relative_to(ROOT).as_posix()
        if git_bytes("show", f"{head}:{relative}") != artifact.read_bytes():
            fail(f"V3 implementation Git drift: {relative}")
        if subprocess.run(
            ["git", "cat-file", "-e", f"{PARENT_REMOTE_COMMIT}:{relative}"],
            cwd=ROOT,
            capture_output=True,
        ).returncode == 0:
            fail(f"V3 path existed at Tag839: {relative}")
    return {"head": head, "remote": remote, "parent": parent or ""}


def run_v2_self_test(v2: Any) -> dict[str, Any]:
    original = v2.verify_precommit_topology
    v2.verify_precommit_topology = lambda: {
        "head": v2.PARENT_REMOTE_COMMIT,
        "remote": v2.PARENT_REMOTE_COMMIT,
    }
    try:
        result = v2.self_test()
    finally:
        v2.verify_precommit_topology = original
    if result.get("status") != "PASS":
        fail("bound V2 semantic self-test failed")
    return result


def build_v2_payload(v2: Any, private_root_arg: str | None, topology: dict[str, str]) -> dict[str, Any]:
    original = v2.verify_production_topology
    v2.verify_production_topology = lambda: dict(topology)
    try:
        payload = v2.build(private_root_arg)
    finally:
        v2.verify_production_topology = original
    return payload


def convert_to_v3_output(
    payload: dict[str, Any], contract: dict[str, Any], topology: dict[str, str]
) -> dict[str, Any]:
    value = copy.deepcopy(payload)
    value["schema"] = OUTPUT_SCHEMA
    value["taskId"] = contract["taskId"]
    value["contractRawSha256"] = CONTRACT_RAW_SHA256
    value["contractSha256"] = contract["contractSha256"]
    value["v2IntroductionCommit"] = V2_INTRODUCTION_COMMIT
    value["v2ContractRawSha256"] = V2_CONTRACT_RAW_SHA256
    value["v2BuilderRawSha256"] = V2_BUILDER_RAW_SHA256
    value["v2TestRawSha256"] = V2_TEST_RAW_SHA256
    value["introductionCommit"] = topology["head"]
    value["claimCeiling"] = contract["claimCeiling"]
    value["claimLocks"] = contract["claimLocks"]
    return with_self_hash(value, "reportSha256")


def validate_public_output(
    value: dict[str, Any], contract: dict[str, Any], v2: Any,
    v2_contract: dict[str, Any], queue: dict[str, Any], introduction: str,
) -> None:
    v2_keys = {
        "schema", "taskId", "track", "contractRawSha256", "contractSha256",
        "v1IntroductionCommit", "v1ContractRawSha256", "v1BuilderRawSha256",
        "v1TestRawSha256", "captureManifestRawSha256", "captureManifestSha256",
        "gapQueueRawSha256", "gapQueueReportSha256", "introductionCommit",
        "quarterCoverage", "population", "rows", "claimCeiling", "claimLocks", "reportSha256",
    }
    v3_extra = {
        "v2IntroductionCommit", "v2ContractRawSha256", "v2BuilderRawSha256", "v2TestRawSha256",
    }
    exact_keys(value, v2_keys | v3_extra, "V3 public output")
    validate_self_hash(value, "reportSha256", "V3 public output")
    if (
        value["schema"] != OUTPUT_SCHEMA
        or value["taskId"] != contract["taskId"]
        or value["track"] != contract["track"]
        or value["contractRawSha256"] != CONTRACT_RAW_SHA256
        or value["contractSha256"] != contract["contractSha256"]
        or value["introductionCommit"] != introduction
        or value["claimCeiling"] != contract["claimCeiling"]
        or value["claimLocks"] != contract["claimLocks"]
    ):
        fail("V3 public identity or claim binding changed")
    if {
        "v2IntroductionCommit": value["v2IntroductionCommit"],
        "v2ContractRawSha256": value["v2ContractRawSha256"],
        "v2BuilderRawSha256": value["v2BuilderRawSha256"],
        "v2TestRawSha256": value["v2TestRawSha256"],
    } != {
        "v2IntroductionCommit": V2_INTRODUCTION_COMMIT,
        "v2ContractRawSha256": V2_CONTRACT_RAW_SHA256,
        "v2BuilderRawSha256": V2_BUILDER_RAW_SHA256,
        "v2TestRawSha256": V2_TEST_RAW_SHA256,
    }:
        fail("V3 public V2 provenance changed")
    shadow = copy.deepcopy(value)
    for key in v3_extra:
        del shadow[key]
    shadow["schema"] = v2.OUTPUT_SCHEMA
    shadow["taskId"] = v2_contract["taskId"]
    shadow["contractRawSha256"] = V2_CONTRACT_RAW_SHA256
    shadow["contractSha256"] = V2_CONTRACT_SELF_SHA256
    shadow["claimCeiling"] = v2_contract["claimCeiling"]
    shadow["claimLocks"] = v2_contract["claimLocks"]
    v2.with_self_hash(shadow, "reportSha256")
    v2.validate_public_output(shadow, v2_contract, queue, introduction)


def verify_contract() -> dict[str, Any]:
    contract, raw = load_contract()
    topology = verify_precommit_topology()
    _v2, _v2_contract = validate_v2_bindings(contract)
    return {
        "status": "PASS",
        "contractRawSha256": sha256(raw),
        "contractSha256": contract["contractSha256"],
        "head": topology["head"],
        "v2IntroductionCommit": V2_INTRODUCTION_COMMIT,
        "v2FilesGitBound": 3,
        "networkRequests": 0,
        "filesWritten": 0,
        "outcomesAccessed": False,
    }


def dry_run(private_root_arg: str | None) -> dict[str, Any]:
    contract, _ = load_contract()
    topology = verify_precommit_topology()
    v2, v2_contract = validate_v2_bindings(contract)
    v1 = v2.validate_v1_bindings(v2_contract)
    private_root = Path(private_root_arg) if private_root_arg else v2.default_private_root()
    manifest, raw, _v1_contract = v2.load_capture_manifest(private_root, v2_contract, v1, deep=False)
    v2.load_gap_queue()
    return {
        "status": "PASS",
        "head": topology["head"],
        "manifestRawSha256": sha256(raw),
        "manifestSha256": manifest["manifestSha256"],
        "quarters": manifest["quarterCount"],
        "expectedAllRows": EXPECTED_TOTALS["allRows"],
        "expectedTargetRows": EXPECTED_TOTALS["targetRows"],
        "expectedMissingIssuerNameAllRows": EXPECTED_TOTALS["blankIssuerNameAllRows"],
        "expectedMissingIssuerNameTargetRows": EXPECTED_TOTALS["blankIssuerNameTargetRows"],
        "networkRequests": 0,
        "filesWritten": 0,
        "outcomesAccessed": False,
    }


def rejected(callback: Callable[[], Any]) -> bool:
    try:
        callback()
    except (EvidenceError, RuntimeError, OSError, ValueError, KeyError, TypeError):
        return True
    return False


def self_test() -> dict[str, Any]:
    contract, _ = load_contract()
    verify_precommit_topology()
    v2, v2_contract = validate_v2_bindings(contract)
    v2_result = run_v2_self_test(v2)
    checks = {
        "v2SemanticSelfTestPassed": v2_result["status"] == "PASS",
        "blankNameAcceptedExplicitly": v2_result["blankNameAcceptedExplicitly"] is True,
        "inventedMissingNameRejected": v2_result["inventedMissingNameRejected"] is True,
        "unknownNameStateRejected": v2_result["unknownNameStateRejected"] is True,
        "outcomeFieldRejected": v2_result["outcomeFieldRejected"] is True,
        "allRowsBound": v2_contract["v1FailureObservation"]["allRows"] == EXPECTED_TOTALS["allRows"],
        "targetRowsBound": v2_contract["v1FailureObservation"]["targetRows"] == EXPECTED_TOTALS["targetRows"],
        "blankIssuerNameAllRowsBound": v2_contract["v1FailureObservation"]["blankIssuerNameAllRows"] == EXPECTED_TOTALS["blankIssuerNameAllRows"],
        "blankIssuerNameTargetRowsBound": v2_contract["v1FailureObservation"]["blankIssuerNameTargetRows"] == EXPECTED_TOTALS["blankIssuerNameTargetRows"],
        "productionAtParentRejected": rejected(
            lambda: validate_topology_values(PARENT_REMOTE_COMMIT, PARENT_REMOTE_COMMIT, None, True)
        ),
        "remoteDriftRejected": rejected(
            lambda: validate_topology_values("a" * 40, "b" * 40, PARENT_REMOTE_COMMIT, True)
        ),
    }
    for section, key, changed in (
        ("semanticInheritance", "issuerNameImputationAllowed", True),
        ("semanticInheritance", "blankCoreFieldDisposition", "ALLOW"),
        ("semanticInheritance", "expectedCounts", {**EXPECTED_TOTALS, "targetRows": 1}),
        ("claimLocks", "outcomesAccessed", True),
        ("immutableV2Base", "v2SemanticsFullyInherited", False),
    ):
        mutated = copy.deepcopy(contract)
        mutated[section][key] = changed
        with_self_hash(mutated, "contractSha256")
        checks[f"resealedMutationRejected_{section}_{key}"] = rejected(
            lambda item=mutated: validate_contract_value(item, v2_contract)
        )
    if not all(checks.values()):
        fail("V3 self-test failed: " + ",".join(key for key, passed in checks.items() if not passed))
    return {
        "status": "PASS",
        **checks,
        "v2FilesGitBound": 3,
        "networkRequests": 0,
        "filesWritten": 0,
        "outcomesAccessed": False,
    }


def build(private_root_arg: str | None) -> dict[str, Any]:
    contract, _ = load_contract()
    topology = verify_production_topology()
    v2, v2_contract = validate_v2_bindings(contract)
    payload = build_v2_payload(v2, private_root_arg, topology)
    value = convert_to_v3_output(payload, contract, topology)
    queue = v2.load_gap_queue()
    validate_public_output(value, contract, v2, v2_contract, queue, topology["head"])
    if verify_production_topology()["head"] != topology["head"]:
        fail("Git or remote topology drifted during V3 build")
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("verify-contract")
    dry = commands.add_parser("dry-run")
    dry.add_argument("--private-root")
    commands.add_parser("self-test")
    build_parser = commands.add_parser("build")
    build_parser.add_argument("--private-root")
    build_parser.add_argument("--output", default=str(OUTPUT_PATH))
    args = parser.parse_args()
    try:
        if args.command == "verify-contract":
            result = verify_contract()
        elif args.command == "dry-run":
            result = dry_run(args.private_root)
        elif args.command == "self-test":
            result = self_test()
        elif args.command == "build":
            if Path(args.output).resolve(strict=False) != OUTPUT_PATH.resolve(strict=False):
                fail("V3 public output sidepaths are forbidden")
            payload = build(args.private_root)
            encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
            before_write = verify_production_topology()["head"]
            v2 = import_v2()
            v1 = v2.load_v1_module()
            v1.atomic_create_new(OUTPUT_PATH, encoded)
            if verify_production_topology()["head"] != before_write:
                fail("Git or remote topology drifted across V3 output write")
            result = {
                "status": "PASS",
                "rows": payload["population"]["gapRows"],
                "sourceAllRows": payload["population"]["sourceAllRows"],
                "sourceTargetPoints": payload["population"]["sourceTargetPoints"],
                "issuerNameMissingAllRows": payload["population"]["issuerNameMissingAllRows"],
                "issuerNameMissingTargetPoints": payload["population"]["issuerNameMissingTargetPoints"],
                "reportSha256": payload["reportSha256"],
                "outcomesAccessed": False,
            }
        else:
            raise AssertionError("unreachable")
    except (EvidenceError, RuntimeError, OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
