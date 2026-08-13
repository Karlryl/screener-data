#!/usr/bin/env python3
"""Fail-closed follow-up seal for the Form345 V3 gzip harness and rebuild receipts."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import subprocess
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-form345-issuer-symbol-point-v3-gzip-harness-seal-contract-v2.json"
VERIFY_TEST = ROOT / "tests" / "verify-sec-form345-issuer-symbol-point-v3-gzip-harness-seal-v2.test.js"
EXPECTED_CONTRACT_RAW = "68a528b933698305caff19b23ab6c5e93f1d59315dc97b2b6e16a5c7e7e53e52"
EXPECTED_CONTRACT_SELF = "7d8f5b21b749be317b817dac1f0ab76218252e97e81aca1a94ae5817265934bd"
BUILD_BASE = "ee21b932abbb31c24c97fab093d8b98b62f7c3e9"
REBUILD_HEAD = "3dafd784e3fcfe6da053c710d0b5a5d4b002939b"
GZIP_INTRODUCTION = "036ba9e53623f47fe8ab0f3b926c5033b629dc2c"
REMOTE = "https://github.com/Karlryl/screener-data.git"
REF = "refs/heads/codex/early-detection-v4-gates-20260810"
ZERO64 = "0" * 64
HEX64 = re.compile(r"[0-9a-f]{64}\Z")

OWNED = (CONTRACT, Path(__file__).resolve(), VERIFY_TEST)
PRIOR = {
    "gzipContract": ROOT / "research" / "early-detection-v4" / "sec-form345-issuer-symbol-point-v3-gzip-promotion-contract-v1.json",
    "gzipManifest": ROOT / "reports" / "early-detection" / "sec-form345-issuer-symbol-point-v3-gzip-manifest.json",
    "gzipPayload": ROOT / "reports" / "early-detection" / "sec-form345-issuer-symbol-point-v3.json.gz",
    "rootVerifier": ROOT / "scripts" / "verify-sec-form345-issuer-symbol-point-v3-gzip.py",
    "rootTest": ROOT / "tests" / "verify-sec-form345-issuer-symbol-point-v3-gzip.test.js",
}
EXPECTED_RESULT = {
    "claimLocksFalse": 13,
    "decompressedSha256": "81e748f609cbf8e73de2f5ea91166ce178c71c1df4fa0398ab9821f30459e0f4",
    "gzipSha256": "fe75233db21467dbec453cd8f20e5b25a8a4d4db16317d6b2fc78eaa7c97f484",
    "head": GZIP_INTRODUCTION,
    "issuerNameMissingAllRows": 1188,
    "issuerNameMissingTargetPoints": 23,
    "issuerNamePresentAllRows": 3350815,
    "issuerNamePresentTargetPoints": 164652,
    "maximumBlobBytes": 10805035,
    "outcomesAccessed": False,
    "phase": "POST_PROMOTION",
    "promotionBlobCount": 5,
    "reportSha256": "b27c9a9197088cbf29d0532a0d73c15a35e41c5300bacb12a7fb7f81076c7ef3",
    "rows": 656,
    "sourceAllRows": 3352003,
    "sourceDerivedFullRebuild": True,
    "sourceTargetPoints": 164675,
    "status": "PASS",
}


class SealError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise SealError(message)


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        fail(f"{label} keys changed")


def git(*args: str) -> bytes:
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True).stdout


def git_text(*args: str) -> str:
    return git(*args).decode("utf-8").strip()


def normalize_owned(path: Path, raw: bytes) -> bytes:
    if path == Path(__file__).resolve():
        patterns = (
            rb'EXPECTED_CONTRACT_RAW = "[0-9a-f]{64}"',
            rb'EXPECTED_CONTRACT_SELF = "[0-9a-f]{64}"',
        )
        replacements = (
            b'EXPECTED_CONTRACT_RAW = "' + b"0" * 64 + b'"',
            b'EXPECTED_CONTRACT_SELF = "' + b"0" * 64 + b'"',
        )
    elif path == VERIFY_TEST:
        patterns = (
            rb"const EXPECTED_CONTRACT_RAW = '[0-9a-f]{64}';",
            rb"const EXPECTED_CONTRACT_SELF = '[0-9a-f]{64}';",
        )
        replacements = (
            b"const EXPECTED_CONTRACT_RAW = '" + b"0" * 64 + b"';",
            b"const EXPECTED_CONTRACT_SELF = '" + b"0" * 64 + b"';",
        )
    else:
        fail(f"normalization is not authorized for {path.name}")
    normalized = raw
    for pattern, replacement in zip(patterns, replacements):
        normalized, count = re.subn(pattern, replacement, normalized)
        if count != 1:
            fail(f"owned normalization marker count changed: {path.name}")
    return normalized


def load_contract() -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    if sha(raw) != EXPECTED_CONTRACT_RAW:
        fail("V2 contract raw hash changed")
    value = json.loads(raw)
    body = dict(value)
    claimed = body.pop("contractSha256")
    actual = sha(canonical(body))
    if claimed != EXPECTED_CONTRACT_SELF or actual != EXPECTED_CONTRACT_SELF:
        fail("V2 contract self hash changed")
    validate_contract(value)
    return value


def validate_contract(value: dict[str, Any]) -> None:
    exact_keys(value, {
        "schema", "createdAt", "taskId", "track", "purpose", "authority",
        "remoteBinding", "lineage", "priorArtifactBindings", "ownedBindings",
        "rebuildReceipts", "receiptPolicy", "claimLocks", "contractSha256",
    }, "V2 contract")
    if value["schema"] != "sec-form345-issuer-symbol-point-v3-gzip-harness-seal-contract/v2":
        fail("V2 schema changed")
    if value["taskId"] != "Q005-SEC-FORM345-V3-GZIP-HARNESS-SEAL-V2" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("V2 study boundary changed")
    if value["authority"] != {
        "authoritativeArtifact": CONTRACT.relative_to(ROOT).as_posix(),
        "compatibility": "APPEND_ONLY_SUPERSEDES_HARNESS_ASSURANCE_ONLY",
        "dataPayloadSuperseded": False,
    }:
        fail("V2 authority changed")
    if value["remoteBinding"] != {
        "remote": REMOTE,
        "ref": REF,
        "buildBase": BUILD_BASE,
        "liveRemoteHeadRequired": True,
        "sealIntroductionPolicy": "FIRST_LINEAR_SINGLE_PARENT_COMMIT_AFTER_BUILD_BASE",
        "sealAddsExactlyThreeOwnedPaths": True,
    }:
        fail("V2 remote binding changed")
    lineage = value["lineage"]
    exact_keys(lineage, {"gzipPromotionIntroduction", "buildBase", "requiredSingleParentChain"}, "lineage")
    if lineage["gzipPromotionIntroduction"] != GZIP_INTRODUCTION or lineage["buildBase"] != BUILD_BASE:
        fail("V2 lineage anchors changed")
    expected_chain = [
        {"commit": "036ba9e53623f47fe8ab0f3b926c5033b629dc2c", "parent": "34d7b2be658c95666b6f31be8bdc4cfd2f580875", "tag": 845},
        {"commit": "1981f25864404b40cd728c65784967516d7d2aad", "parent": "036ba9e53623f47fe8ab0f3b926c5033b629dc2c", "tag": 846},
        {"commit": "959c0f6b4c3c9ef4364dfc7084f7adb045cf791a", "parent": "1981f25864404b40cd728c65784967516d7d2aad", "tag": 847},
        {"commit": REBUILD_HEAD, "parent": "959c0f6b4c3c9ef4364dfc7084f7adb045cf791a", "tag": 848},
        {"commit": "3460af91b083b6e4a142479a7dcb376ef37c2df6", "parent": REBUILD_HEAD, "tag": 849},
        {"commit": BUILD_BASE, "parent": "3460af91b083b6e4a142479a7dcb376ef37c2df6", "tag": 850},
    ]
    if lineage["requiredSingleParentChain"] != expected_chain:
        fail("V2 required chain changed")
    expected_prior = {
        "gzipContract": ("research/early-detection-v4/sec-form345-issuer-symbol-point-v3-gzip-promotion-contract-v1.json", 4316, "2500eda2dd7b7245b2a75ec91146d54873b9c818eb8017b2a8dfe98364472d11", "9b5d6a1a66044e5197c852c88c548fbadeaa4120"),
        "gzipManifest": ("reports/early-detection/sec-form345-issuer-symbol-point-v3-gzip-manifest.json", 2601, "c353dc63865cd7a0f7ca4b35f5dceb99683424ad55c72f2e57b42f5830e1910b", "2bee3c7be0c35cbc1fb420a3896cd485a23c4308"),
        "gzipPayload": ("reports/early-detection/sec-form345-issuer-symbol-point-v3.json.gz", 10805035, "fe75233db21467dbec453cd8f20e5b25a8a4d4db16317d6b2fc78eaa7c97f484", "dc646db0846f5d6318a05b316067ceaf4251f685"),
        "rootVerifier": ("scripts/verify-sec-form345-issuer-symbol-point-v3-gzip.py", 21530, "ae157ee721d78e19699d9aabce0af70e54e423f78145d7c144d29bb4ef6cb4ce", "d68db65f3c7d91709a174c17827243d23313c403"),
        "rootTest": ("tests/verify-sec-form345-issuer-symbol-point-v3-gzip.test.js", 4409, "e966423d1e2dd510bb0d6270b93d28b56a6362bf4f126632022235c0f0718707", "45b0c860a59c5ab6e4c87d183f7d9b47dccdadad"),
    }
    if set(value["priorArtifactBindings"]) != set(expected_prior):
        fail("prior artifact binding names changed")
    for name, (path, size, raw_hash, blob) in expected_prior.items():
        if value["priorArtifactBindings"][name] != {
            "path": path, "bytes": size, "rawSha256": raw_hash, "gitBlobAtBuildBase": blob,
        }:
            fail(f"prior artifact contract changed: {name}")
    owned = value["ownedBindings"]
    if set(owned) != {"contract", "verifier", "test"}:
        fail("owned binding names changed")
    if owned["contract"] != {
        "path": CONTRACT.relative_to(ROOT).as_posix(),
        "binding": "EXACT_RAW_AND_CANONICAL_SELF",
    }:
        fail("owned contract binding changed")
    for name, path in (("verifier", Path(__file__).resolve()), ("test", VERIFY_TEST)):
        item = owned[name]
        exact_keys(item, {"path", "binding", "normalizedRawSha256", "normalization"}, f"owned {name}")
        if item["path"] != path.relative_to(ROOT).as_posix() or item["binding"] != "NORMALIZED_RAW_SHA256":
            fail(f"owned path or binding changed: {name}")
        if not HEX64.fullmatch(item["normalizedRawSha256"]):
            fail(f"owned normalized hash malformed: {name}")
        if item["normalization"] != "ONLY_CONTRACT_RAW_AND_SELF_CONSTANT_VALUES_ZEROED":
            fail(f"owned normalization changed: {name}")
    validate_receipts(value["rebuildReceipts"], value["receiptPolicy"])
    if value["claimLocks"] != {
        "humanAttestation": False,
        "originalV4GateCredit": False,
        "outcomesAccessed": False,
        "sourceRebuildNormalReceiptBound": True,
        "sourceRebuildOptimizedReceiptBound": True,
    }:
        fail("V2 claim locks changed")


def validate_receipts(receipts: Any, policy: Any) -> None:
    if policy != {
        "receiptType": "AI_EXECUTION_RECEIPT",
        "cryptographicSignaturePresent": False,
        "exactTimestampsRecorded": False,
        "stdoutBytesAndResultSemanticsRequired": True,
        "rootVerifierBytesRequired": True,
        "normalAndOptimizedCommandsRequired": True,
        "receiptDoesNotCreateHumanAttestation": True,
    }:
        fail("receipt policy changed")
    if not isinstance(receipts, list) or len(receipts) != 2:
        fail("exactly two rebuild receipts required")
    expected_modes = (("NORMAL", ["python", "-B"]), ("OPTIMIZED", ["python", "-O", "-B"]))
    stdout = (json.dumps(EXPECTED_RESULT, sort_keys=True) + "\n").encode("utf-8")
    for receipt, (mode, prefix) in zip(receipts, expected_modes):
        exact_keys(receipt, {
            "receiptId", "mode", "commandTokens", "cwd", "workingTreeHead", "rootVerifier",
            "python", "exitCode", "approximateDurationSeconds", "observedCompletion",
            "stdout", "result", "humanAttestation",
        }, f"{mode} receipt")
        command = prefix + ["scripts/verify-sec-form345-issuer-symbol-point-v3-gzip.py", "verify", "--remote", "--source-rebuild"]
        if receipt["receiptId"] != f"FORM345-GZIP-SOURCE-REBUILD-{mode}-TAG848" or receipt["mode"] != mode:
            fail(f"receipt identity changed: {mode}")
        if receipt["commandTokens"] != command or receipt["cwd"] != "REPOSITORY_ROOT" or receipt["workingTreeHead"] != REBUILD_HEAD:
            fail(f"receipt execution binding changed: {mode}")
        if receipt["rootVerifier"] != {
            "path": PRIOR["rootVerifier"].relative_to(ROOT).as_posix(),
            "rawSha256": "ae157ee721d78e19699d9aabce0af70e54e423f78145d7c144d29bb4ef6cb4ce",
            "gitBlobAtBuildBase": "d68db65f3c7d91709a174c17827243d23313c403",
        }:
            fail(f"receipt root verifier changed: {mode}")
        if receipt["python"] != {
            "version": "3.12.10",
            "executable": "C:\\Users\\Anwender\\AppData\\Local\\Programs\\Python\\Python312\\python.exe",
        }:
            fail(f"receipt Python changed: {mode}")
        if receipt["exitCode"] != 0 or receipt["approximateDurationSeconds"] != 415:
            fail(f"receipt completion changed: {mode}")
        completion = receipt["observedCompletion"]
        if completion != {
            "timezone": "Europe/Berlin",
            "approximateEndLocal": "2026-08-13T03:32:00+02:00" if mode == "NORMAL" else "2026-08-13T03:40:00+02:00",
            "precision": "APPROXIMATE_FROM_OPERATOR_REPORT",
            "exactTimestampsRecorded": False,
        }:
            fail(f"receipt time disclosure changed: {mode}")
        if receipt["stdout"] != {"bytes": len(stdout), "rawSha256": sha(stdout), "encoding": "UTF-8_JSON_SORTED_KEYS_PLUS_LF"}:
            fail(f"receipt stdout binding changed: {mode}")
        if receipt["result"] != EXPECTED_RESULT or receipt["humanAttestation"] is not False:
            fail(f"receipt result changed: {mode}")


def validate_owned(contract: dict[str, Any]) -> None:
    for name, path in (("verifier", Path(__file__).resolve()), ("test", VERIFY_TEST)):
        actual = sha(normalize_owned(path, path.read_bytes()))
        if actual != contract["ownedBindings"][name]["normalizedRawSha256"]:
            fail(f"owned normalized bytes changed: {name}")


def validate_prior(contract: dict[str, Any]) -> None:
    for name, path in PRIOR.items():
        binding = contract["priorArtifactBindings"][name]
        raw = path.read_bytes()
        relative = path.relative_to(ROOT).as_posix()
        if len(raw) != binding["bytes"] or sha(raw) != binding["rawSha256"]:
            fail(f"prior local artifact changed: {name}")
        if git_text("rev-parse", f"{BUILD_BASE}:{relative}") != binding["gitBlobAtBuildBase"]:
            fail(f"prior Git blob changed: {name}")
        if git("show", f"{BUILD_BASE}:{relative}") != raw:
            fail(f"prior committed bytes differ: {name}")
    root_text = PRIOR["rootVerifier"].read_text(encoding="utf-8")
    required = (
        'parser.add_argument("--source-rebuild", action="store_true")',
        "if rebuild:\n        source_rebuild(raw, source)",
        '"sourceDerivedFullRebuild": rebuild',
    )
    if any(item not in root_text for item in required):
        fail("root verifier source-rebuild semantics changed")


def validate_chain(contract: dict[str, Any]) -> None:
    for item in contract["lineage"]["requiredSingleParentChain"]:
        parents = git_text("show", "-s", "--format=%P", item["commit"]).split()
        if parents != [item["parent"]]:
            fail(f"required single-parent chain changed at Tag {item['tag']}")


def seal_state(contract: dict[str, Any], require_remote: bool) -> dict[str, Any]:
    if not require_remote:
        fail("live remote verification is mandatory")
    if git_text("remote", "get-url", "origin") != REMOTE:
        fail("origin URL changed")
    head = git_text("rev-parse", "HEAD")
    upstream = git_text("rev-parse", "@{upstream}")
    if head != upstream:
        fail("HEAD and upstream differ")
    lines = git_text("ls-remote", "--refs", "origin", REF).splitlines()
    if len(lines) != 1 or lines[0].split()[0] != head:
        fail("live remote checkpoint differs from current HEAD")
    owned_paths = {path.relative_to(ROOT).as_posix() for path in OWNED}
    contract_committed = subprocess.run(
        ["git", "cat-file", "-e", f"HEAD:{CONTRACT.relative_to(ROOT).as_posix()}"],
        cwd=ROOT, capture_output=True,
    ).returncode == 0
    if not contract_committed:
        if head != BUILD_BASE:
            fail("pre-seal verification requires exact Tag850")
        for path in OWNED:
            relative = path.relative_to(ROOT).as_posix()
            if not path.is_file():
                fail(f"planned seal path missing: {relative}")
            if subprocess.run(["git", "cat-file", "-e", f"{BUILD_BASE}:{relative}"], cwd=ROOT, capture_output=True).returncode == 0:
                fail(f"planned seal path already existed: {relative}")
        return {"sealPhase": "PRE_SEAL", "promotionIntroduction": GZIP_INTRODUCTION, "harnessSealIntroduction": None, "currentHead": head}
    commits = git_text("rev-list", "--ancestry-path", "--reverse", f"{BUILD_BASE}..{head}").splitlines()
    if not commits:
        fail("committed seal has no introduction commit")
    previous = BUILD_BASE
    for commit in commits:
        parents = git_text("show", "-s", "--format=%P", commit).split()
        if parents != [previous]:
            fail("post-Tag848 history is not a linear single-parent chain")
        previous = commit
    introduction = commits[0]
    rows = git_text("diff-tree", "--no-commit-id", "--name-status", "-r", introduction).splitlines()
    if len(rows) != 3 or any(not row.startswith("A\t") for row in rows):
        fail("seal introduction must contain exactly three additions")
    if {row.split("\t", 1)[1] for row in rows} != owned_paths:
        fail("seal introduction path set changed")
    for path in OWNED:
        relative = path.relative_to(ROOT).as_posix()
        raw = path.read_bytes()
        if git("show", f"{introduction}:{relative}") != raw or git("show", f"{head}:{relative}") != raw:
            fail(f"seal-owned committed bytes changed: {relative}")
    return {"sealPhase": "POST_SEAL", "promotionIntroduction": GZIP_INTRODUCTION, "harnessSealIntroduction": introduction, "currentHead": head}


def verify(require_remote: bool) -> dict[str, Any]:
    contract = load_contract()
    validate_owned(contract)
    validate_prior(contract)
    validate_chain(contract)
    state = seal_state(contract, require_remote)
    return {
        "status": "PASS",
        **state,
        "priorArtifactsBound": 5,
        "ownedArtifactsBound": 3,
        "sourceRebuildReceiptsBound": ["NORMAL", "OPTIMIZED"],
        "receiptStdoutSha256": "4a5c934af0a9fa3f05b9929772851e01a08b41f47eb244152b0f3dc1dd592c19",
        "exactTimestampsRecorded": False,
        "humanAttestation": False,
        "outcomesAccessed": False,
    }


def self_test() -> dict[str, Any]:
    contract = load_contract()
    validate_owned(contract)
    validate_prior(contract)
    validate_chain(contract)
    mutations = {
        "normalCommandDropsSourceRebuild": lambda item: item["rebuildReceipts"][0]["commandTokens"].pop(),
        "optimizedResultDropsSourceRebuild": lambda item: item["rebuildReceipts"][1]["result"].__setitem__("sourceDerivedFullRebuild", False),
        "stdoutHash": lambda item: item["rebuildReceipts"][0]["stdout"].__setitem__("rawSha256", ZERO64),
        "rootVerifierHash": lambda item: item["priorArtifactBindings"]["rootVerifier"].__setitem__("rawSha256", ZERO64),
        "lineageParent": lambda item: item["lineage"]["requiredSingleParentChain"][3].__setitem__("parent", ZERO64[:40]),
        "ownedVerifierHash": lambda item: item["ownedBindings"]["verifier"].__setitem__("normalizedRawSha256", ZERO64),
        "humanAttestation": lambda item: item["claimLocks"].__setitem__("humanAttestation", True),
    }
    killed: dict[str, bool] = {}
    for name, mutate in mutations.items():
        changed = copy.deepcopy(contract)
        mutate(changed)
        try:
            validate_contract(changed)
            validate_owned(changed)
            killed[name] = False
        except SealError:
            killed[name] = True
    if not all(killed.values()):
        fail("V2 adversarial contract mutation survived")
    return {
        "status": "PASS",
        "mutationKills": killed,
        "filesWritten": 0,
        "humanAttestation": False,
        "outcomesAccessed": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify", "self-test"))
    parser.add_argument("--remote", action="store_true")
    args = parser.parse_args()
    try:
        result = self_test() if args.command == "self-test" else verify(args.remote)
    except (SealError, OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
