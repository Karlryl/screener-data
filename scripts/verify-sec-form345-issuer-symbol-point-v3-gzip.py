#!/usr/bin/env python3
"""Fail-closed verifier for the lossless Form345 V3 gzip promotion."""

from __future__ import annotations

import argparse
import copy
import gzip
import hashlib
import importlib.util
import io
import json
import re
import subprocess
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-form345-issuer-symbol-point-v3-gzip-promotion-contract-v1.json"
MANIFEST = ROOT / "reports" / "early-detection" / "sec-form345-issuer-symbol-point-v3-gzip-manifest.json"
GZIP_PATH = ROOT / "reports" / "early-detection" / "sec-form345-issuer-symbol-point-v3.json.gz"
RAW_PATH = ROOT / "reports" / "early-detection" / "sec-form345-issuer-symbol-point-v3.json"
SOURCE_CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-form345-issuer-symbol-point-contract-v3.json"
SOURCE_BUILDER = ROOT / "scripts" / "build-sec-form345-issuer-symbol-point-v3.py"
SOURCE_TEST = ROOT / "tests" / "build-sec-form345-issuer-symbol-point-v3.test.js"
VERIFY_TEST = ROOT / "tests" / "verify-sec-form345-issuer-symbol-point-v3-gzip.test.js"
EXPECTED_CONTRACT_RAW = "2500eda2dd7b7245b2a75ec91146d54873b9c818eb8017b2a8dfe98364472d11"
EXPECTED_CONTRACT_SELF = "b17b5f6bfe877aa312a0ad9f73b00db9609706b59b0c121e534ed8c4d8ce9e8b"
EXPECTED_MANIFEST_RAW = "c353dc63865cd7a0f7ca4b35f5dceb99683424ad55c72f2e57b42f5830e1910b"
EXPECTED_MANIFEST_SELF = "afa872b29cda54493cca8d5a0b69272a42942f3b5aa4b91bc50ceec517cc59ce"
PARENT = "34d7b2be658c95666b6f31be8bdc4cfd2f580875"
INTRODUCTION = "036ba9e53623f47fe8ab0f3b926c5033b629dc2c"
SOURCE_INTRODUCTION = "ab6944a9d79fd3e54a7a881c0be866bcb963c81f"
REMOTE = "https://github.com/Karlryl/screener-data.git"
REF = "refs/heads/codex/early-detection-v4-gates-20260810"
EXPECTED_RAW = "81e748f609cbf8e73de2f5ea91166ce178c71c1df4fa0398ab9821f30459e0f4"
EXPECTED_REPORT = "b27c9a9197088cbf29d0532a0d73c15a35e41c5300bacb12a7fb7f81076c7ef3"
EXPECTED_GZIP = "fe75233db21467dbec453cd8f20e5b25a8a4d4db16317d6b2fc78eaa7c97f484"
EXPECTED_RAW_BYTES = 138_658_140
EXPECTED_GZIP_BYTES = 10_805_035
EXPECTED_COUNTS = {
    "rows": 656,
    "sourceAllRows": 3_352_003,
    "sourceTargetPoints": 164_675,
    "issuerNameMissingAllRows": 1_188,
    "issuerNameMissingTargetPoints": 23,
    "issuerNamePresentAllRows": 3_350_815,
    "issuerNamePresentTargetPoints": 164_652,
}
EXPECTED_LOCKS = {
    "historicalIdentityIntervalsComplete": False,
    "humanAttestation": False,
    "listingIdentityResolved": False,
    "originalV4GateCredit": False,
    "outcomesAccessed": False,
    "ownerTransactionOrHoldingTablesAccessed": False,
    "permanentSecurityIdentityResolved": False,
    "pricesAccessed": False,
    "returnsAccessed": False,
    "terminalPaymentVerified": False,
    "terminalSessionProven": False,
    "terminalWealthComplete": False,
    "tickerReuseResolved": False,
}
OWNED = (CONTRACT, MANIFEST, GZIP_PATH, Path(__file__).resolve(), VERIFY_TEST)
HEX64 = re.compile(r"[0-9a-f]{64}\Z")


class VerifyError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise VerifyError(message)


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


def load_json_bound(path: Path, expected_raw: str, self_field: str, expected_self: str) -> dict[str, Any]:
    raw = path.read_bytes()
    if sha(raw) != expected_raw:
        fail(f"{path.name} raw hash changed")
    value = json.loads(raw)
    body = dict(value)
    claimed = body.pop(self_field)
    actual = sha(canonical(body))
    if claimed != expected_self or actual != expected_self:
        fail(f"{path.name} self hash changed")
    return value


def validate_contract(value: dict[str, Any]) -> None:
    exact_keys(value, {
        "schema", "createdAt", "taskId", "track", "purpose", "remoteBinding",
        "authorizedPaths", "sourceBuildBinding", "decompressed", "gzip",
        "requiredCounts", "verificationPolicy", "claimLocks", "contractSha256",
    }, "promotion contract")
    if value["schema"] != "sec-form345-issuer-symbol-point-gzip-promotion-contract/v1":
        fail("promotion contract schema changed")
    if value["taskId"] != "Q005-SEC-FORM345-ISSUER-SYMBOL-POINT-V3-GZIP-PROMOTION" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("promotion study boundary changed")
    if value["remoteBinding"] != {
        "remote": REMOTE,
        "ref": REF,
        "parentRemoteCommit": PARENT,
        "parentTag": 844,
        "promotionDirectChildRequired": True,
        "linearSingleParentHistoryRequired": True,
        "maximumPromotionBlobBytesExclusive": 100_000_000,
    }:
        fail("promotion remote binding changed")
    paths = value["authorizedPaths"]
    expected_paths = {
        "contract": CONTRACT.relative_to(ROOT).as_posix(),
        "manifest": MANIFEST.relative_to(ROOT).as_posix(),
        "gzip": GZIP_PATH.relative_to(ROOT).as_posix(),
        "verifier": Path(__file__).resolve().relative_to(ROOT).as_posix(),
        "test": VERIFY_TEST.relative_to(ROOT).as_posix(),
        "rawJsonLocalOnly": RAW_PATH.relative_to(ROOT).as_posix(),
    }
    if paths != expected_paths:
        fail("authorized promotion paths changed")
    if value["decompressed"] != {
        "logicalPath": RAW_PATH.relative_to(ROOT).as_posix(),
        "bytes": EXPECTED_RAW_BYTES,
        "rawSha256": EXPECTED_RAW,
        "reportSha256": EXPECTED_REPORT,
        "mustRemainOutsidePromotionCommit": True,
    }:
        fail("decompressed binding changed")
    if value["gzip"] != {
        "path": GZIP_PATH.relative_to(ROOT).as_posix(),
        "bytes": EXPECTED_GZIP_BYTES,
        "rawSha256": EXPECTED_GZIP,
        "method": "GZIP_LEVEL_9_MTIME_0_EMPTY_FILENAME",
    }:
        fail("gzip binding changed")
    if value["requiredCounts"] != EXPECTED_COUNTS or value["claimLocks"] != EXPECTED_LOCKS:
        fail("count or claim-lock contract changed")
    policy = value["verificationPolicy"]
    if policy != {
        "gzipMustRebuildByteIdentically": True,
        "decompressedRawAndSelfHashRequired": True,
        "sourceDerivedFullRebuildNormalRequired": True,
        "sourceDerivedFullRebuildOptimizedRequired": True,
        "claimLocksMustRemainFalse": True,
        "promotionCommitMustAddExactlyFiveAuthorizedPaths": True,
        "rawJsonMayBeReadButNotCommittedOrMutated": True,
        "outcomesMayBeAccessed": False,
    }:
        fail("verification policy changed")


def validate_manifest(value: dict[str, Any], contract: dict[str, Any]) -> None:
    exact_keys(value, {
        "schema", "createdAt", "taskId", "track", "parentRemoteCommit", "remote", "ref",
        "contract", "gzip", "decompressed", "sourceBuild", "counts", "claimLocks", "manifestSha256",
    }, "manifest")
    if value["schema"] != "sec-form345-issuer-symbol-point-gzip-manifest/v1":
        fail("manifest schema changed")
    if value["taskId"] != contract["taskId"] or value["track"] != contract["track"]:
        fail("manifest study boundary changed")
    if value["parentRemoteCommit"] != PARENT or value["remote"] != REMOTE or value["ref"] != REF:
        fail("manifest remote binding changed")
    if value["contract"] != {
        "path": CONTRACT.relative_to(ROOT).as_posix(),
        "rawSha256": EXPECTED_CONTRACT_RAW,
        "selfSha256": EXPECTED_CONTRACT_SELF,
    }:
        fail("manifest contract binding changed")
    for field in ("gzip", "decompressed"):
        expected = dict(contract[field])
        expected.pop("mustRemainOutsidePromotionCommit", None)
        if value[field] != expected:
            fail(f"manifest {field} binding changed")
    if value["counts"] != EXPECTED_COUNTS or value["claimLocks"] != EXPECTED_LOCKS:
        fail("manifest counts or locks changed")
    if value["sourceBuild"] != {
        "introductionCommit": SOURCE_INTRODUCTION,
        "contractRawSha256": "fe3ab39b615bd78da92acc3da64575dbb3b66103adccdd9ad9460b2a7631df50",
        "contractSelfSha256": "f4f14ca6c91a06d989e0681d070224d0cb33a2bf929065ce3c37367ce5c1f38f",
        "builderRawSha256": "12466af13e1960275deda4a9f879cdace4e41f7bc3b5a1e13726b2e477d714a7",
        "testRawSha256": "a5fa1c517bc21757ba0e2395571051939d08aeb2c184ccdb3abbf5a9023ae26b",
    }:
        fail("manifest source-build binding changed")


def import_source_builder() -> Any:
    spec = importlib.util.spec_from_file_location("bound_form345_v3_for_gzip", SOURCE_BUILDER)
    if spec is None or spec.loader is None:
        fail("cannot import bound Form345 V3 builder")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def validate_source_artifacts(contract: dict[str, Any], manifest: dict[str, Any]) -> tuple[Any, dict[str, Any], Any, dict[str, Any]]:
    bindings = contract["sourceBuildBinding"]
    expected = {
        SOURCE_CONTRACT: ("contract", "rawSha256"),
        SOURCE_BUILDER: ("builder", "rawSha256"),
        SOURCE_TEST: ("test", "rawSha256"),
    }
    for artifact, (section, key) in expected.items():
        relative = artifact.relative_to(ROOT).as_posix()
        raw = artifact.read_bytes()
        if sha(raw) != bindings[section][key]:
            fail(f"source artifact local hash changed: {relative}")
        if git_text("rev-parse", f"{SOURCE_INTRODUCTION}:{relative}") != bindings[section]["gitBlob"]:
            fail(f"source artifact Git blob changed: {relative}")
        if git("show", f"{SOURCE_INTRODUCTION}:{relative}") != raw or git("show", f"{PARENT}:{relative}") != raw:
            fail(f"source artifact committed bytes changed: {relative}")
    v3 = import_source_builder()
    source_contract, _ = v3.load_contract()
    v2, v2_contract = v3.validate_v2_bindings(source_contract)
    if source_contract["contractSha256"] != manifest["sourceBuild"]["contractSelfSha256"]:
        fail("source contract self hash changed")
    return v3, source_contract, v2, v2_contract


def validate_payload(payload: dict[str, Any], raw: bytes, manifest: dict[str, Any], source: tuple[Any, dict[str, Any], Any, dict[str, Any]], enforce_raw: bool = True) -> dict[str, int]:
    if enforce_raw and (len(raw) != EXPECTED_RAW_BYTES or sha(raw) != EXPECTED_RAW):
        fail("decompressed raw bytes changed")
    body = dict(payload)
    claimed = body.pop("reportSha256")
    if claimed != EXPECTED_REPORT or sha(canonical(body)) != claimed:
        fail("decompressed self hash changed")
    if payload.get("claimLocks") != EXPECTED_LOCKS or any(value is not False for value in payload["claimLocks"].values()):
        fail("payload claim locks changed")
    v3, source_contract, v2, v2_contract = source
    queue = v2.load_gap_queue()
    try:
        v3.validate_public_output(payload, source_contract, v2, v2_contract, queue, SOURCE_INTRODUCTION)
    except Exception as exc:
        raise VerifyError(f"bound V3 payload validation failed: {exc}") from exc
    population = payload["population"]
    actual = {
        "rows": len(payload["rows"]),
        "sourceAllRows": population["sourceAllRows"],
        "sourceTargetPoints": population["sourceTargetPoints"],
        "issuerNameMissingAllRows": population["issuerNameMissingAllRows"],
        "issuerNameMissingTargetPoints": population["issuerNameMissingTargetPoints"],
        "issuerNamePresentAllRows": population["issuerNamePresentAllRows"],
        "issuerNamePresentTargetPoints": population["issuerNamePresentTargetPoints"],
    }
    if actual != EXPECTED_COUNTS or actual != manifest["counts"]:
        fail("payload counts changed")
    unique_observations: dict[str, str] = {}
    for row in payload["rows"]:
        for observation in row["observations"]:
            prior = unique_observations.setdefault(observation["accessionNumber"], observation["issuerNameState"])
            if prior != observation["issuerNameState"]:
                fail("duplicate accession issuer-name state conflict")
    if len(unique_observations) != EXPECTED_COUNTS["sourceTargetPoints"]:
        fail("unique accession denominator changed")
    missing_points = sum(state == "MISSING_SOURCE_VALUE" for state in unique_observations.values())
    if missing_points != EXPECTED_COUNTS["issuerNameMissingTargetPoints"]:
        fail("row-level issuer-name missingness changed")
    return actual


def deterministic_gzip(raw: bytes) -> bytes:
    stream = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=stream, compresslevel=9, mtime=0) as handle:
        handle.write(raw)
    return stream.getvalue()


def promotion_state(remote_required: bool) -> dict[str, Any]:
    if git_text("remote", "get-url", "origin") != REMOTE:
        fail("origin URL changed")
    head = git_text("rev-parse", "HEAD")
    upstream = git_text("rev-parse", "@{upstream}")
    if head != upstream:
        fail("HEAD and upstream differ")
    if remote_required:
        lines = git_text("ls-remote", "--refs", "origin", REF).splitlines()
        if len(lines) != 1 or lines[0].split()[0] != head:
            fail("live remote checkpoint changed")
    contract_committed = subprocess.run(
        ["git", "cat-file", "-e", f"HEAD:{CONTRACT.relative_to(ROOT).as_posix()}"],
        cwd=ROOT, capture_output=True,
    ).returncode == 0
    expected_paths = {item.relative_to(ROOT).as_posix() for item in OWNED}
    raw_relative = RAW_PATH.relative_to(ROOT).as_posix()
    if not contract_committed:
        if head != PARENT:
            fail("pre-promotion verification requires exact Tag844")
        for item in OWNED:
            if not item.is_file() or item.stat().st_size >= 100_000_000:
                fail(f"planned promotion artifact missing or too large: {item.name}")
            if subprocess.run(
                ["git", "cat-file", "-e", f"{PARENT}:{item.relative_to(ROOT).as_posix()}"],
                cwd=ROOT, capture_output=True,
            ).returncode == 0:
                fail(f"planned promotion path existed at Tag844: {item.name}")
        if subprocess.run(["git", "cat-file", "-e", f"{PARENT}:{raw_relative}"], cwd=ROOT, capture_output=True).returncode == 0:
            fail("raw JSON was committed at promotion parent")
        return {"phase": "PRE_PROMOTION", "head": head, "promotionBlobCount": 5, "maximumBlobBytes": max(item.stat().st_size for item in OWNED)}
    parents = git_text("show", "-s", "--format=%P", INTRODUCTION).split()
    if parents != [PARENT] or subprocess.run(
        ["git", "merge-base", "--is-ancestor", INTRODUCTION, head], cwd=ROOT, capture_output=True
    ).returncode != 0:
        fail("promotion is not the direct single-parent child of Tag844")
    rows = git_text("diff-tree", "--no-commit-id", "--name-status", "-r", INTRODUCTION).splitlines()
    if len(rows) != 5 or any(not row.startswith("A\t") for row in rows):
        fail("promotion commit must contain exactly five additions")
    if {row.split("\t", 1)[1] for row in rows} != expected_paths:
        fail("promotion commit path set changed")
    if subprocess.run(["git", "cat-file", "-e", f"{INTRODUCTION}:{raw_relative}"], cwd=ROOT, capture_output=True).returncode == 0:
        fail("raw JSON entered the promotion commit")
    maximum = 0
    for item in OWNED:
        relative = item.relative_to(ROOT).as_posix()
        blob = git("show", f"{INTRODUCTION}:{relative}")
        if relative in {VERIFY_TEST.relative_to(ROOT).as_posix(), Path(__file__).resolve().relative_to(ROOT).as_posix()}:
            current_blob = git("show", f"{head}:{relative}")
            if current_blob != item.read_bytes():
                fail(f"current harness Git bytes changed: {relative}")
        elif blob != item.read_bytes():
            fail(f"promotion Git bytes changed: {relative}")
        maximum = max(maximum, len(blob))
        if len(blob) >= 100_000_000:
            fail(f"promotion blob reaches GitHub limit: {relative}")
    for line in git_text("rev-list", "--objects", f"{PARENT}..{INTRODUCTION}").splitlines():
        object_id = line.split(" ", 1)[0]
        if git_text("cat-file", "-t", object_id) == "blob" and int(git_text("cat-file", "-s", object_id)) >= 100_000_000:
            fail("promotion delta contains a blob at or above 100 MB")
    return {"phase": "POST_PROMOTION", "head": INTRODUCTION, "promotionBlobCount": 5, "maximumBlobBytes": maximum}


def source_rebuild(expected_raw: bytes, source: tuple[Any, dict[str, Any], Any, dict[str, Any]]) -> None:
    v3, _source_contract, _v2, _v2_contract = source
    original = v3.verify_production_topology
    v3.verify_production_topology = lambda: {"head": SOURCE_INTRODUCTION, "remote": SOURCE_INTRODUCTION, "parent": "c07279bdabf4e4b7f70b0aae7c32ab5da2c1c1f5"}
    try:
        rebuilt = v3.build(None)
    finally:
        v3.verify_production_topology = original
    rebuilt_raw = json.dumps(rebuilt, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
    if rebuilt_raw != expected_raw:
        fail("source-derived full rebuild changed payload bytes")


def verify(remote: bool, rebuild: bool) -> dict[str, Any]:
    contract = load_json_bound(CONTRACT, EXPECTED_CONTRACT_RAW, "contractSha256", EXPECTED_CONTRACT_SELF)
    validate_contract(contract)
    manifest = load_json_bound(MANIFEST, EXPECTED_MANIFEST_RAW, "manifestSha256", EXPECTED_MANIFEST_SELF)
    validate_manifest(manifest, contract)
    state = promotion_state(remote)
    source = validate_source_artifacts(contract, manifest)
    compressed = GZIP_PATH.read_bytes()
    if len(compressed) != EXPECTED_GZIP_BYTES or sha(compressed) != EXPECTED_GZIP:
        fail("gzip bytes changed")
    if compressed[:10] != bytes.fromhex("1f8b08000000000002ff"):
        fail("gzip header is not deterministic")
    raw = gzip.decompress(compressed)
    if deterministic_gzip(raw) != compressed:
        fail("deterministic gzip reconstruction changed")
    payload = json.loads(raw)
    counts = validate_payload(payload, raw, manifest, source)
    if RAW_PATH.exists() and RAW_PATH.read_bytes() != raw:
        fail("local raw JSON differs from promoted decompressed bytes")
    if rebuild:
        source_rebuild(raw, source)
    return {
        "status": "PASS",
        **state,
        **counts,
        "gzipSha256": sha(compressed),
        "decompressedSha256": sha(raw),
        "reportSha256": payload["reportSha256"],
        "sourceDerivedFullRebuild": rebuild,
        "claimLocksFalse": len(EXPECTED_LOCKS),
        "outcomesAccessed": False,
    }


def self_test() -> dict[str, Any]:
    contract = load_json_bound(CONTRACT, EXPECTED_CONTRACT_RAW, "contractSha256", EXPECTED_CONTRACT_SELF)
    validate_contract(contract)
    manifest = load_json_bound(MANIFEST, EXPECTED_MANIFEST_RAW, "manifestSha256", EXPECTED_MANIFEST_SELF)
    validate_manifest(manifest, contract)
    source = validate_source_artifacts(contract, manifest)
    raw = gzip.decompress(GZIP_PATH.read_bytes())
    payload = json.loads(raw)
    missing_row = next(row for row in payload["rows"] if row["issuerNameMissingPointCount"] > 0)
    mutations = {
        "claimLock": lambda item: item["claimLocks"].__setitem__("outcomesAccessed", True),
        "rowLoss": lambda item: item["rows"].pop(),
        "count": lambda item: item["population"].__setitem__("sourceTargetPoints", 1),
        "imputation": lambda item: next(
            observation for row in item["rows"] for observation in row["observations"]
            if observation["issuerNameState"] == "MISSING_SOURCE_VALUE"
        ).__setitem__("issuerName", "Invented"),
        "outcomeField": lambda item: missing_row.__class__ and item["rows"][0].__setitem__("outcome", 1),
    }
    killed: dict[str, bool] = {}
    for name, mutate in mutations.items():
        changed = copy.deepcopy(payload)
        mutate(changed)
        try:
            validate_payload(changed, raw, manifest, source, enforce_raw=False)
            killed[name] = False
        except VerifyError:
            killed[name] = True
    if not all(killed.values()):
        fail("adversarial payload mutation survived")
    if deterministic_gzip(raw) != GZIP_PATH.read_bytes():
        fail("self-test deterministic gzip failed")
    return {
        "status": "PASS",
        "mutationKills": killed,
        "gzipDeterministic": True,
        "claimLocksFalse": len(EXPECTED_LOCKS),
        "filesWritten": 0,
        "outcomesAccessed": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify", "self-test"))
    parser.add_argument("--remote", action="store_true")
    parser.add_argument("--source-rebuild", action="store_true")
    args = parser.parse_args()
    try:
        result = self_test() if args.command == "self-test" else verify(args.remote, args.source_rebuild)
    except (VerifyError, OSError, ValueError, KeyError, TypeError, StopIteration, subprocess.CalledProcessError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
