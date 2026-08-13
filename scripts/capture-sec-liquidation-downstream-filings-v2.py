#!/usr/bin/env python3
"""Resume the sealed SEC capture with append-only manifest snapshots."""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import time
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-liquidation-downstream-filing-capture-contract-v2.json"
RUNNER = Path(__file__).resolve()
TEST = ROOT / "tests" / "capture-sec-liquidation-downstream-filings-v2.test.js"
V1_CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-liquidation-downstream-filing-capture-contract-v1.json"
V1_RUNNER = ROOT / "scripts" / "capture-sec-liquidation-downstream-filings-v1.py"
V1_TEST = ROOT / "tests" / "capture-sec-liquidation-downstream-filings-v1.test.js"
PRIVATE_ROOT = Path(r"C:\Users\Anwender\Documents\GrowthScreenerResearchData\early-detection-v4\liquidation-downstream-sec-originals-v1")
OWNED = (CONTRACT, RUNNER, TEST)

CONTRACT_RAW = "60ce91e6305f6cc7ed8df1082ffd1a4286a8dbc65fb99c74a0f8deb3439847d0"
CONTRACT_SELF = "4b6eb6d378970edaffc1e42c72dd5df05765327cc9819b92b8711060192f7911"
TEST_RAW = "14438da42373fabcdbf0fa940556d03f6544adc12bc598d145084fa6adcf8a4c"
BASE = "7b434e1a17e4c1f29dc385004beb8afa705cbdd9"
REMOTE = "https://github.com/Karlryl/screener-data.git"
REMOTE_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
CREATED_AT = "2026-08-13T13:31:06Z"
V1_CONTRACT_RAW = "bca2d0b60584f42d949c892f7103b2992a1b648ed6e910c2ef2610272d6ae8a6"
V1_RUNNER_RAW = "4e36f022144f31defc129ec059b717a9c4a219cc49c15905ab584f5c5e9ce7d7"
V1_TEST_RAW = "6d55fe65ad562547e3c3d10cbd50fd518e332a7729002c08dce12ebf00f3a4c3"
V1_INTRODUCTION = "7b434e1a17e4c1f29dc385004beb8afa705cbdd9"
V1_MANIFEST_RAW = "68d0c28537762321028aa638b5b2e83b071bae656d2bb82726f8f8e1cd8981dd"
V1_MANIFEST_SELF = "2fa0247b293f9c222ef947701c73d145938d74a518e8834905603a5d06e09bf5"
V1_RECEIPT_SEQUENCE = "e5e470a9722aae9f1b145f095d2b454fabf165aab468993f39ebb21974a9a4fe"
V1_RAW_SEQUENCE = "4a26071e66c0ef753ec4ebd887f67d32695e5f75a550566ea37934f7222872bc"
V1_DEFERRED_RAW = "1f0afd49b7cf420666e69fb4c0836a123b1237958172bcbea9907921abf20ddc"
EXPECTED_CANDIDATE_SHA = "ee57eec9b5e6f4bdddb0613f98e84e61b9c17eb300fff6252baebf68ce5042b2"
EXPECTED_LINK_SHA = "95f39579447d40a87075c1bb4ae9717c935222c6b6f236ac270847d514cc1b73"

PURPOSE = (
    "Resume the exact V1 private SEC capture from its immutable 72-receipt and one-deferred checkpoint, preserve "
    "all V1 bytes, write each later V2 manifest as a new content-addressed snapshot plus an append-only snapshot index, "
    "and retain every V1 network, privacy, no-interpretation and no-credit restriction."
)
EXPECTED_LOCKS = {
    "v1BytesModified": False,
    "contentInterpretationPerformed": False,
    "sameSecurityReferenced": False,
    "securityIdentityResolved": False,
    "listingIdentityResolved": False,
    "cashReceiptVerified": False,
    "finalDistributionVerified": False,
    "noFurtherDistributionsVerified": False,
    "laterRecoveriesExcluded": False,
    "completeCorporateActionChainVerified": False,
    "lastConsolidatedSessionObserved": False,
    "lastTradePriceObserved": False,
    "laterOtcTradingExcluded": False,
    "terminalWealthComplete": False,
    "originalV4GateCredit": False,
    "resultComputationAllowed": False,
    "pricesAccessed": False,
    "returnsAccessed": False,
    "outcomesAccessed": False,
}


class ResumeError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise ResumeError(message)


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def self_hash(value: dict[str, Any], field: str) -> str:
    body = dict(value)
    body.pop(field, None)
    return sha(canonical(body))


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if type(value) is not dict or set(value) != expected:
        fail(f"{label} exact keys changed")


def normalized_runner(raw: bytes) -> bytes:
    text = raw.decode("utf-8").replace("\r\n", "\n")
    for name in ("CONTRACT_RAW", "CONTRACT_SELF", "TEST_RAW"):
        pattern = re.compile(rf'^{name} = "[0-9a-f ]+"$', re.MULTILINE)
        if len(pattern.findall(text)) != 1:
            fail(f"{name} normalization structure changed")
        text = pattern.sub(f'{name} = "{"0" * 64}"', text)
    return text.encode("utf-8")


def git(*args: str, check: bool = True) -> str:
    result = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=False)
    if check and result.returncode:
        fail(result.stderr.strip() or "git command failed")
    return result.stdout.strip()


def git_raw(commit: str, path: Path) -> bytes:
    relative = path.relative_to(ROOT).as_posix()
    result = subprocess.run(["git", "show", f"{commit}:{relative}"], cwd=ROOT, capture_output=True, check=False)
    if result.returncode:
        fail(f"Git blob unavailable for {relative}")
    return result.stdout


def is_ancestor(older: str, newer: str) -> bool:
    return subprocess.run(["git", "merge-base", "--is-ancestor", older, newer], cwd=ROOT).returncode == 0


def changed_paths(commit: str) -> list[tuple[str, str]]:
    output = git("diff-tree", "--no-commit-id", "--name-status", "-r", commit)
    return [tuple(line.split("\t", 1)) for line in output.splitlines() if line]


def introduction_for(path: Path) -> list[str]:
    relative = path.relative_to(ROOT).as_posix()
    output = git("log", "--reverse", "--format=%H", "--diff-filter=A", f"{BASE}..HEAD", "--", relative)
    return output.splitlines() if output else []


def expected_v1() -> dict[str, Any]:
    return {
        "contract": {"path": V1_CONTRACT.relative_to(ROOT).as_posix(), "rawSha256": V1_CONTRACT_RAW},
        "runner": {"path": V1_RUNNER.relative_to(ROOT).as_posix(), "rawSha256": V1_RUNNER_RAW},
        "test": {"path": V1_TEST.relative_to(ROOT).as_posix(), "rawSha256": V1_TEST_RAW},
        "introductionCommit": V1_INTRODUCTION,
        "privateRoot": str(PRIVATE_ROOT),
        "checkpointManifest": {
            "path": "manifest.json", "rawSha256": V1_MANIFEST_RAW, "manifestSha256": V1_MANIFEST_SELF,
            "capturedCandidates": 72, "deferredCandidates": 1, "complete": False,
            "receiptSequenceSha256": V1_RECEIPT_SEQUENCE, "rawBlobSequenceSha256": V1_RAW_SEQUENCE,
            "capturedRawBytes": 14669514, "requestSequenceMinimum": 1, "requestSequenceMaximum": 72,
            "deferredRawSha256": V1_DEFERRED_RAW,
        },
    }


def validate_contract(value: dict[str, Any]) -> None:
    exact_keys(value, {
        "schema", "createdAt", "taskId", "track", "purpose", "supersededV1", "resumeContract",
        "claimLocks", "implementationContract", "contractSha256",
    }, "contract")
    if value["schema"] != "sec-liquidation-downstream-filing-capture-contract/v2":
        fail("schema changed")
    if value["createdAt"] != CREATED_AT:
        fail("createdAt changed")
    from datetime import datetime, timezone
    if datetime.fromisoformat(CREATED_AT.replace("Z", "+00:00")) > datetime.now(timezone.utc):
        fail("createdAt is future")
    if value["taskId"] != "Q003-SEC-LIQUIDATION-DOWNSTREAM-FILING-CAPTURE-V2" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract identity changed")
    if value["purpose"] != PURPOSE or value["supersededV1"] != expected_v1():
        fail("purpose or V1 binding changed")
    expected_resume = {
        "candidateFilings": 115, "candidateCanonicalSha256": EXPECTED_CANDIDATE_SHA,
        "caseCandidateLinks": 469, "linkCanonicalSha256": EXPECTED_LINK_SHA,
        "capturedReceiptsAreSkippedAfterFullValidation": True,
        "deferredReceiptDoesNotSkipCandidate": True,
        "requestSequenceContinuesFromMaximumExistingReceipt": True,
        "oneRequestPerRemainingCandidatePerRun": True, "retryCount": 0,
        "minimumIntervalMilliseconds": 250, "rateDeferredStopsRun": True,
        "manifestSnapshotLayout": "manifests/sha256/<first2>/<manifestSha256>.json",
        "manifestIndexLayout": "manifest-index/<capturedCandidates>-<manifestSha256>.json",
        "manifestSchema": [
            "schema", "contractRawSha256", "v1CheckpointManifestRawSha256", "candidateCanonicalSha256",
            "expectedCandidates", "capturedCandidates", "remainingCandidates", "historicalDeferredEvents",
            "complete", "maximumRequestSequence", "requestEventSequenceSha256", "receiptSequenceSha256",
            "rawBlobSequenceSha256", "outcomesAccessed", "manifestSha256",
        ],
        "requestEventsMustBeUniqueAndContiguous": True,
        "v1DeferredRequestSequence": 73,
        "existingV1ManifestIsNeverModified": True, "allSnapshotsAtomicWriteNew": True,
        "privateOnly": True, "publicRawBytesAllowed": False,
    }
    if value["resumeContract"] != expected_resume:
        fail("resume contract changed")
    if value["claimLocks"] != EXPECTED_LOCKS:
        fail("claim locks changed")
    expected_implementation = {
        "baseCommit": BASE, "baseTag": 894, "remote": REMOTE, "ref": REMOTE_REF,
        "contractPath": CONTRACT.relative_to(ROOT).as_posix(), "runnerPath": RUNNER.relative_to(ROOT).as_posix(),
        "testPath": TEST.relative_to(ROOT).as_posix(), "runnerNormalizedSha256": sha(normalized_runner(RUNNER.read_bytes())),
        "testRawSha256": TEST_RAW, "introductionMustBeDirectSingleParentChildOfBase": True,
        "introductionAddsExactlyThreeOwnedPaths": True, "laterLinearSingleParentDescendantsAllowed": True,
        "productionResumeRequiresPostIntroductionRemoteVerification": True,
        "dryRunMustUseZeroNetworkAndZeroWrites": True,
    }
    if value["implementationContract"] != expected_implementation:
        fail("implementation contract changed")
    if value["contractSha256"] != CONTRACT_SELF or self_hash(value, "contractSha256") != CONTRACT_SELF:
        fail("contract self hash changed")


def load_contract() -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    if sha(raw) != CONTRACT_RAW:
        fail("contract raw bytes changed")
    value = json.loads(raw)
    validate_contract(value)
    return value


def load_v1(head: str) -> Any:
    for path, expected in ((V1_CONTRACT, V1_CONTRACT_RAW), (V1_RUNNER, V1_RUNNER_RAW), (V1_TEST, V1_TEST_RAW)):
        raw = path.read_bytes()
        if sha(raw) != expected or git_raw(V1_INTRODUCTION, path) != raw or git_raw(head, path) != raw:
            fail("V1 implementation bytes changed")
    spec = importlib.util.spec_from_file_location("sealed_capture_v1", V1_RUNNER)
    if spec is None or spec.loader is None:
        fail("V1 import failed")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_receipts(v1: Any, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id = {candidate["candidateId"]: candidate for candidate in candidates}
    expected_paths = {v1.receipt_path(candidate_id) for candidate_id in by_id}
    actual_paths = set((PRIVATE_ROOT / "receipts").glob("*.json"))
    if not actual_paths <= expected_paths:
        fail("orphan private receipt found")
    receipts: list[dict[str, Any]] = []
    for path in actual_paths:
        value = json.loads(path.read_bytes())
        candidate = by_id.get(value.get("candidateId"))
        if candidate is None or path != v1.receipt_path(candidate["candidateId"]):
            fail("private receipt path changed")
        v1.validate_receipt(value, candidate)
        receipts.append(value)
    receipts.sort(key=lambda item: item["requestSequence"])
    if len({item["candidateId"] for item in receipts}) != len(receipts):
        fail("duplicate captured candidate")
    return receipts


def validate_deferred(v1: Any, value: dict[str, Any], candidates: dict[str, dict[str, Any]]) -> None:
    exact_keys(value, {
        "schema", "candidateId", "url", "httpStatus", "responseHeaders", "requestSequence",
        "outcomesAccessed", "deferredSha256",
    }, "deferred event")
    candidate = candidates.get(value["candidateId"])
    if candidate is None or value["schema"] != "sec-liquidation-downstream-private-deferred/v1":
        fail("deferred event identity changed")
    if value["url"] != v1.candidate_url(candidate) or value["httpStatus"] not in v1.DEFERRED_HTTP:
        fail("deferred event URL or status changed")
    if type(value["responseHeaders"]) is not dict or value["outcomesAccessed"] is not False:
        fail("deferred event fields changed")
    if type(value["requestSequence"]) is not int or value["requestSequence"] < 1:
        fail("deferred request sequence changed")
    if value["deferredSha256"] != v1.self_hash(value, "deferredSha256"):
        fail("deferred event self hash changed")


def load_deferred_events(v1: Any, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id = {candidate["candidateId"]: candidate for candidate in candidates}
    paths = list((PRIVATE_ROOT / "deferred").glob("*.json"))
    paths.extend((PRIVATE_ROOT / "deferred-v2").glob("*/*.json"))
    events: list[dict[str, Any]] = []
    for path in paths:
        raw = path.read_bytes()
        value = json.loads(raw)
        validate_deferred(v1, value, by_id)
        if path.is_relative_to(PRIVATE_ROOT / "deferred-v2"):
            raw_sha = sha(raw)
            expected = PRIVATE_ROOT / "deferred-v2" / raw_sha[:2] / f"{raw_sha}.json"
            if path != expected:
                fail("V2 deferred event path changed")
        events.append(value)
    events.sort(key=lambda item: item["requestSequence"])
    return events


def request_events(receipts: list[dict[str, Any]], deferred: list[dict[str, Any]]) -> list[tuple[int, str]]:
    events = [(item["requestSequence"], f"R|{item['requestSequence']}|{item['candidateId']}|{item['receiptSha256']}") for item in receipts]
    events.extend((item["requestSequence"], f"D|{item['requestSequence']}|{item['candidateId']}|{item['deferredSha256']}") for item in deferred)
    events.sort(key=lambda item: item[0])
    sequences = [sequence for sequence, _line in events]
    if sequences != list(range(1, len(events) + 1)):
        fail("request events are not unique and contiguous")
    return events


def verify_v1_checkpoint(v1: Any, candidates: list[dict[str, Any]]) -> dict[str, Any]:
    manifest_path = PRIVATE_ROOT / "manifest.json"
    raw = manifest_path.read_bytes()
    if sha(raw) != V1_MANIFEST_RAW:
        fail("V1 checkpoint manifest bytes changed")
    manifest = json.loads(raw)
    if manifest["manifestSha256"] != V1_MANIFEST_SELF or v1.self_hash(manifest, "manifestSha256") != V1_MANIFEST_SELF:
        fail("V1 checkpoint manifest self hash changed")
    exact_keys(manifest, {
        "schema", "contractRawSha256", "candidateCanonicalSha256", "expectedCandidates", "capturedCandidates",
        "deferredCandidates", "complete", "receiptSequenceSha256", "rawBlobSequenceSha256", "outcomesAccessed",
        "manifestSha256",
    }, "V1 checkpoint manifest")
    expected_checkpoint = expected_v1()["checkpointManifest"]
    for key in ("capturedCandidates", "deferredCandidates", "complete", "receiptSequenceSha256", "rawBlobSequenceSha256"):
        if manifest[key] != expected_checkpoint[key]:
            fail("V1 checkpoint manifest claim changed")
    receipts = load_receipts(v1, candidates)
    checkpoint_receipts = [item for item in receipts if item["requestSequence"] <= 72]
    if len(checkpoint_receipts) != 72 or sum(item["rawBytes"] for item in checkpoint_receipts) != 14669514:
        fail("V1 captured raw-byte total changed")
    if [item["requestSequence"] for item in checkpoint_receipts] != list(range(1, 73)):
        fail("V1 request sequence changed")
    receipt_sequence = sha(("\n".join(item["receiptSha256"] for item in checkpoint_receipts) + "\n").encode("utf-8"))
    raw_sequence = sha(("\n".join(item["rawSha256"] for item in checkpoint_receipts) + "\n").encode("utf-8"))
    if receipt_sequence != V1_RECEIPT_SEQUENCE or raw_sequence != V1_RAW_SEQUENCE:
        fail("V1 checkpoint receipt sequences changed")
    deferred_paths = list((PRIVATE_ROOT / "deferred").glob("*.json"))
    if len(deferred_paths) != 1 or sha(deferred_paths[0].read_bytes()) != V1_DEFERRED_RAW:
        fail("V1 deferred receipt changed")
    deferred = load_deferred_events(v1, candidates)
    old = [item for item in deferred if item["requestSequence"] == 73]
    if len(old) != 1:
        fail("V1 deferred request sequence changed")
    return manifest


def build_v2_manifest(v1: Any, candidates: list[dict[str, Any]]) -> dict[str, Any]:
    receipts = load_receipts(v1, candidates)
    deferred = load_deferred_events(v1, candidates)
    events = request_events(receipts, deferred)
    receipt_lines = "\n".join(item["receiptSha256"] for item in receipts) + ("\n" if receipts else "")
    raw_lines = "\n".join(item["rawSha256"] for item in receipts) + ("\n" if receipts else "")
    event_lines = "\n".join(line for _sequence, line in events) + ("\n" if events else "")
    manifest = {
        "schema": "sec-liquidation-downstream-private-capture-manifest/v2",
        "contractRawSha256": CONTRACT_RAW,
        "v1CheckpointManifestRawSha256": V1_MANIFEST_RAW,
        "candidateCanonicalSha256": EXPECTED_CANDIDATE_SHA,
        "expectedCandidates": 115,
        "capturedCandidates": len(receipts),
        "remainingCandidates": 115 - len(receipts),
        "historicalDeferredEvents": len(deferred),
        "complete": len(receipts) == 115,
        "maximumRequestSequence": events[-1][0] if events else 0,
        "requestEventSequenceSha256": sha(event_lines.encode("utf-8")),
        "receiptSequenceSha256": sha(receipt_lines.encode("utf-8")),
        "rawBlobSequenceSha256": sha(raw_lines.encode("utf-8")),
        "outcomesAccessed": False,
        "manifestSha256": "",
    }
    manifest["manifestSha256"] = v1.self_hash(manifest, "manifestSha256")
    return manifest


def validate_v2_manifest(v1: Any, manifest: dict[str, Any], candidates: list[dict[str, Any]]) -> None:
    exact_keys(manifest, set(validate_contract_manifest_schema()), "V2 manifest")
    if manifest != build_v2_manifest(v1, candidates):
        fail("V2 manifest differs from private evidence")


def validate_contract_manifest_schema() -> list[str]:
    return [
        "schema", "contractRawSha256", "v1CheckpointManifestRawSha256", "candidateCanonicalSha256",
        "expectedCandidates", "capturedCandidates", "remainingCandidates", "historicalDeferredEvents",
        "complete", "maximumRequestSequence", "requestEventSequenceSha256", "receiptSequenceSha256",
        "rawBlobSequenceSha256", "outcomesAccessed", "manifestSha256",
    ]


def write_manifest_snapshot(v1: Any, manifest: dict[str, Any]) -> tuple[str, str]:
    raw = v1.encode_json(manifest)
    manifest_sha = manifest["manifestSha256"]
    snapshot = PRIVATE_ROOT / "manifests" / "sha256" / manifest_sha[:2] / f"{manifest_sha}.json"
    index = PRIVATE_ROOT / "manifest-index" / f"{manifest['capturedCandidates']:03d}-{manifest_sha}.json"
    v1.atomic_create(snapshot, raw)
    v1.atomic_create(index, raw)
    return snapshot.relative_to(PRIVATE_ROOT).as_posix(), index.relative_to(PRIVATE_ROOT).as_posix()


def verify_repository(remote_required: bool) -> dict[str, Any]:
    if not remote_required:
        fail("live remote verification is mandatory")
    if git("remote", "get-url", "origin") != REMOTE:
        fail("origin URL changed")
    head = git("rev-parse", "HEAD")
    if git("rev-parse", "@{u}") != head or git("ls-remote", "--refs", "origin", REMOTE_REF).split() != [head, REMOTE_REF]:
        fail("HEAD, upstream and live remote differ")
    if not is_ancestor(BASE, head):
        fail("base is not ancestor of HEAD")
    load_v1(head)
    introductions = [introduction_for(path) for path in OWNED]
    if all(not values for values in introductions):
        if head != BASE:
            fail("pre-introduction HEAD moved beyond base")
        return {"phase": "PRE_INTRODUCTION", "introductionCommit": None, "remoteVerified": True, "resumeAuthorized": False}
    if any(len(values) != 1 for values in introductions) or len({values[0] for values in introductions}) != 1:
        fail("owned paths were not introduced together once")
    introduction = introductions[0][0]
    if git("show", "-s", "--format=%P", introduction).split() != [BASE]:
        fail("introduction is not direct single-parent child of base")
    if changed_paths(introduction) != [("A", path.relative_to(ROOT).as_posix()) for path in OWNED]:
        fail("introduction does not add exactly owned paths")
    if not is_ancestor(introduction, head):
        fail("introduction is not ancestor of HEAD")
    previous = introduction
    for commit in git("rev-list", "--reverse", "--first-parent", f"{introduction}..{head}").splitlines():
        if git("show", "-s", "--format=%P", commit).split() != [previous]:
            fail("post-introduction history is not linear single-parent")
        previous = commit
    for path in OWNED:
        raw = path.read_bytes()
        if git_raw(introduction, path) != raw or git_raw(head, path) != raw:
            fail("owned Git bytes changed")
    return {"phase": "POST_INTRODUCTION", "introductionCommit": introduction, "remoteVerified": True, "resumeAuthorized": True}


def reseal(value: dict[str, Any]) -> dict[str, Any]:
    item = copy.deepcopy(value)
    item["contractSha256"] = self_hash(item, "contractSha256")
    return item


def rejected(action: Callable[[], None]) -> bool:
    try:
        action()
    except (ResumeError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError):
        return True
    return False


def self_test(value: dict[str, Any]) -> dict[str, Any]:
    mutations: dict[str, Callable[[dict[str, Any]], None]] = {
        "backdated": lambda item: item.__setitem__("createdAt", "1970-01-01T00:00:00Z"),
        "purposeOverclaim": lambda item: item.__setitem__("purpose", "final recovery and terminal wealth"),
        "checkpointCount": lambda item: item["supersededV1"]["checkpointManifest"].__setitem__("capturedCandidates", 73),
        "checkpointDigest": lambda item: item["supersededV1"]["checkpointManifest"].__setitem__("rawSha256", "0" * 64),
        "v1RunnerDrift": lambda item: item["supersededV1"]["runner"].__setitem__("rawSha256", "0" * 64),
        "candidateLoss": lambda item: item["resumeContract"].__setitem__("candidateFilings", 114),
        "deferredSkipped": lambda item: item["resumeContract"].__setitem__("deferredReceiptDoesNotSkipCandidate", False),
        "sequenceReset": lambda item: item["resumeContract"].__setitem__("requestSequenceContinuesFromMaximumExistingReceipt", False),
        "retryEnabled": lambda item: item["resumeContract"].__setitem__("retryCount", 1),
        "manifestOverwrite": lambda item: item["resumeContract"].__setitem__("existingV1ManifestIsNeverModified", False),
        "manifestSchemaLoss": lambda item: item["resumeContract"]["manifestSchema"].pop(),
        "sequenceCollision": lambda item: item["resumeContract"].__setitem__("requestEventsMustBeUniqueAndContiguous", False),
        "deferredSequence": lambda item: item["resumeContract"].__setitem__("v1DeferredRequestSequence", 72),
        "publicRaw": lambda item: item["resumeContract"].__setitem__("publicRawBytesAllowed", True),
        "v1Modified": lambda item: item["claimLocks"].__setitem__("v1BytesModified", True),
        "contentCredit": lambda item: item["claimLocks"].__setitem__("contentInterpretationPerformed", True),
        "sameSecurityCredit": lambda item: item["claimLocks"].__setitem__("sameSecurityReferenced", True),
        "finalityCredit": lambda item: item["claimLocks"].__setitem__("finalDistributionVerified", True),
        "recoveryCredit": lambda item: item["claimLocks"].__setitem__("laterRecoveriesExcluded", True),
        "terminalCredit": lambda item: item["claimLocks"].__setitem__("terminalWealthComplete", True),
        "outcomeCredit": lambda item: item["claimLocks"].__setitem__("outcomesAccessed", True),
        "unknownCredit": lambda item: item["claimLocks"].__setitem__("unknownScientificCredit", True),
        "runnerDrift": lambda item: item["implementationContract"].__setitem__("runnerNormalizedSha256", "0" * 64),
    }
    kills: dict[str, bool] = {}
    for name, mutate in mutations.items():
        item = copy.deepcopy(value)
        mutate(item)
        item = reseal(item)
        kills[name] = rejected(lambda item=item: validate_contract(item))
    if not all(kills.values()):
        fail("self-test kill failed")
    return {"schema": "sec-liquidation-downstream-filing-capture-self-test/v2", "status": "PASS", "mutationKills": kills, "outcomesAccessed": False}


def resume() -> dict[str, Any]:
    repository = verify_repository(True)
    if not repository["resumeAuthorized"]:
        fail("production resume requires post-introduction remote verification")
    v1 = load_v1(git("rev-parse", "HEAD"))
    v1.ensure_private_root()
    candidates, _links = v1.load_candidates()
    verify_v1_checkpoint(v1, candidates)
    initial_manifest = build_v2_manifest(v1, candidates)
    validate_v2_manifest(v1, initial_manifest, candidates)
    write_manifest_snapshot(v1, initial_manifest)
    receipts = load_receipts(v1, candidates)
    deferred_events = load_deferred_events(v1, candidates)
    existing_events = request_events(receipts, deferred_events)
    next_sequence = existing_events[-1][0] + 1
    requests = 0
    last_request = 0.0
    status = "PASS"
    for candidate in candidates:
        receipt_target = v1.receipt_path(candidate["candidateId"])
        if receipt_target.exists():
            continue
        elapsed = time.monotonic() - last_request
        if elapsed < v1.MIN_INTERVAL_SECONDS:
            time.sleep(v1.MIN_INTERVAL_SECONDS - elapsed)
        requests += 1
        sequence = next_sequence
        next_sequence += 1
        try:
            raw, headers, _unused = v1.fetch(candidate, sequence)
        except v1.RateDeferred as exc:
            deferred = {
                "schema": "sec-liquidation-downstream-private-deferred/v1", "candidateId": exc.candidate_id,
                "url": exc.url, "httpStatus": exc.status, "responseHeaders": exc.headers,
                "requestSequence": sequence, "outcomesAccessed": False, "deferredSha256": "",
            }
            deferred["deferredSha256"] = v1.self_hash(deferred, "deferredSha256")
            deferred_raw = v1.encode_json(deferred)
            deferred_sha = sha(deferred_raw)
            target = PRIVATE_ROOT / "deferred-v2" / deferred_sha[:2] / f"{deferred_sha}.json"
            v1.atomic_create(target, deferred_raw)
            status = "DEFERRED"
            break
        last_request = time.monotonic()
        raw_sha = sha(raw)
        v1.atomic_create(v1.blob_path(raw_sha), raw)
        captured_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        receipt = v1.make_receipt(candidate, v1.candidate_url(candidate), captured_at, headers, raw, sequence)
        v1.atomic_create(receipt_target, v1.encode_json(receipt))
    manifest = build_v2_manifest(v1, candidates)
    validate_v2_manifest(v1, manifest, candidates)
    snapshot, index = write_manifest_snapshot(v1, manifest)
    if status == "PASS" and not manifest["complete"]:
        status = "INCOMPLETE"
    return {"schema": "sec-liquidation-downstream-filing-capture/v2", "status": status, **repository,
            "requests": requests, "capturedCandidates": manifest["capturedCandidates"],
            "remainingCandidates": 115 - manifest["capturedCandidates"], "manifestSha256": manifest["manifestSha256"],
            "manifestSnapshot": snapshot, "manifestIndex": index, "maximumRequestSequence": manifest["maximumRequestSequence"],
            "historicalDeferredEvents": manifest["historicalDeferredEvents"],
            "v1ManifestPreserved": sha((PRIVATE_ROOT / "manifest.json").read_bytes()) == V1_MANIFEST_RAW,
            "outcomesAccessed": False}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify-contract", "dry-run", "self-test", "resume"))
    parser.add_argument("--remote", action="store_true")
    args = parser.parse_args()
    try:
        value = load_contract()
        if args.command == "resume":
            result = resume()
        else:
            repository = verify_repository(args.remote)
            v1 = load_v1(git("rev-parse", "HEAD"))
            candidates, links = v1.load_candidates()
            checkpoint = verify_v1_checkpoint(v1, candidates)
            current = build_v2_manifest(v1, candidates)
            validate_v2_manifest(v1, current, candidates)
            if args.command == "verify-contract":
                result = {"schema": "sec-liquidation-downstream-filing-capture-contract-verification/v2", "status": "PASS", **repository,
                          "checkpointCaptured": checkpoint["capturedCandidates"], "candidateFilings": len(candidates), "outcomesAccessed": False}
            elif args.command == "self-test":
                result = {**self_test(value), **repository}
            else:
                result = {"schema": "sec-liquidation-downstream-filing-capture-dry-run/v2", "status": "PASS", **repository,
                          "checkpointCaptured": checkpoint["capturedCandidates"], "currentCaptured": current["capturedCandidates"],
                          "remainingCandidates": current["remainingCandidates"], "historicalDeferredEvents": current["historicalDeferredEvents"],
                          "maximumRequestSequence": current["maximumRequestSequence"], "currentManifestSha256": current["manifestSha256"],
                          "candidateFilings": len(candidates), "caseCandidateLinks": len(links), "networkRequests": 0, "writes": 0,
                          "outcomesAccessed": False}
    except (ResumeError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
