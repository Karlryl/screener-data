#!/usr/bin/env python3
"""Capture the sealed 115 downstream SEC submissions into a private CAS."""

from __future__ import annotations

import argparse
import base64
import copy
import hashlib
import importlib.util
import json
import os
import re
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-liquidation-downstream-filing-capture-contract-v1.json"
RUNNER = Path(__file__).resolve()
TEST = ROOT / "tests" / "capture-sec-liquidation-downstream-filings-v1.test.js"
DISCOVERY_CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-liquidation-downstream-filing-discovery-contract-v1.json"
DISCOVERY_BUILDER = ROOT / "scripts" / "build-sec-liquidation-downstream-filing-discovery-v1.py"
DISCOVERY_TEST = ROOT / "tests" / "build-sec-liquidation-downstream-filing-discovery-v1.test.js"
PRIVATE_ROOT = Path(r"C:\Users\Anwender\Documents\GrowthScreenerResearchData\early-detection-v4\liquidation-downstream-sec-originals-v1")
OWNED = (CONTRACT, RUNNER, TEST)

CONTRACT_RAW = "bca2d0b60584f42d949c892f7103b2992a1b648ed6e910c2ef2610272d6ae8a6"
CONTRACT_SELF = "8c9b79d0909bd8ff9b29e2eb5897e9fba09ed4b41696614ac793864fda3a2992"
TEST_RAW = "6d55fe65ad562547e3c3d10cbd50fd518e332a7729002c08dce12ebf00f3a4c3"
BASE = "6573b0812e09dd12df176c7550800526481aa786"
REMOTE = "https://github.com/Karlryl/screener-data.git"
REMOTE_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
CREATED_AT = "2026-08-13T13:18:41Z"
DISCOVERY_CONTRACT_RAW = "511accf9a3c0c44245d1e703105596ff8f25f42f81b81bf4ea486a6c08875644"
DISCOVERY_BUILDER_RAW = "69fcca3f46e993af4a78188a78b7726477e74f10c21968e65bfff2679ed945a9"
DISCOVERY_TEST_RAW = "21ba1ea5cc393bca6c4f371dd0e8e5ceb2cb38cf27abc9196431b1bbc7eb632f"
DISCOVERY_INTRODUCTION = "6573b0812e09dd12df176c7550800526481aa786"
EXPECTED_CANDIDATE_SHA = "ee57eec9b5e6f4bdddb0613f98e84e61b9c17eb300fff6252baebf68ce5042b2"
EXPECTED_LINK_SHA = "95f39579447d40a87075c1bb4ae9717c935222c6b6f236ac270847d514cc1b73"
MAX_RESPONSE_BYTES = 50_000_000
MIN_INTERVAL_SECONDS = 0.25
TIMEOUT_SECONDS = 120
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
ACCESSION = re.compile(r"[0-9]{10}-[0-9]{2}-[0-9]{6}\Z")
FILENAME = re.compile(r"edgar/data/[0-9]+/([0-9]{10}-[0-9]{2}-[0-9]{6})\.txt\Z")
ALLOWED_HEADERS = {"content-type", "content-length", "etag", "last-modified", "cache-control", "date", "retry-after"}
DEFERRED_HTTP = {403, 429, 503}

PURPOSE = (
    "Capture exactly the 115 pre-sealed official SEC submission URLs from the downstream liquidation discovery "
    "lane once each into a private content-addressed store, with no redirects, proxies, retries, public raw bytes, "
    "content interpretation, security linkage, finality, recovery, terminal wealth, price, return, outcome or "
    "Original-V4 credit."
)
EXPECTED_LOCKS = {
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


class CaptureError(RuntimeError):
    pass


class RateDeferred(CaptureError):
    def __init__(self, status: int, headers: dict[str, str], candidate_id: str, url: str):
        super().__init__(f"SEC request deferred with HTTP {status}")
        self.status = status
        self.headers = headers
        self.candidate_id = candidate_id
        self.url = url


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str) -> None:
        return None


OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())


def fail(message: str) -> None:
    raise CaptureError(message)


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


def changed_paths(commit: str) -> list[tuple[str, str]]:
    output = git("diff-tree", "--no-commit-id", "--name-status", "-r", commit)
    return [tuple(line.split("\t", 1)) for line in output.splitlines() if line]


def is_ancestor(older: str, newer: str) -> bool:
    return subprocess.run(["git", "merge-base", "--is-ancestor", older, newer], cwd=ROOT).returncode == 0


def introduction_for(path: Path) -> list[str]:
    relative = path.relative_to(ROOT).as_posix()
    output = git("log", "--reverse", "--format=%H", "--diff-filter=A", f"{BASE}..HEAD", "--", relative)
    return output.splitlines() if output else []


def expected_inputs() -> dict[str, Any]:
    return {
        "discoveryContract": {"path": DISCOVERY_CONTRACT.relative_to(ROOT).as_posix(), "rawSha256": DISCOVERY_CONTRACT_RAW},
        "discoveryBuilder": {"path": DISCOVERY_BUILDER.relative_to(ROOT).as_posix(), "rawSha256": DISCOVERY_BUILDER_RAW},
        "discoveryTest": {"path": DISCOVERY_TEST.relative_to(ROOT).as_posix(), "rawSha256": DISCOVERY_TEST_RAW},
        "discoveryIntroductionCommit": DISCOVERY_INTRODUCTION,
        "candidateFilings": 115,
        "candidateCanonicalSha256": EXPECTED_CANDIDATE_SHA,
        "caseCandidateLinks": 469,
        "linkCanonicalSha256": EXPECTED_LINK_SHA,
    }


def validate_contract(value: dict[str, Any]) -> None:
    exact_keys(value, {
        "schema", "createdAt", "taskId", "track", "purpose", "authoritativeInput", "urlContract",
        "networkPolicy", "privateCapture", "receiptSchema", "manifestSchema", "claimLocks",
        "implementationContract", "contractSha256",
    }, "contract")
    if value["schema"] != "sec-liquidation-downstream-filing-capture-contract/v1":
        fail("schema changed")
    if value["createdAt"] != CREATED_AT:
        fail("createdAt changed")
    from datetime import datetime, timezone
    if datetime.fromisoformat(CREATED_AT.replace("Z", "+00:00")) > datetime.now(timezone.utc):
        fail("createdAt is future")
    if value["taskId"] != "Q003-SEC-LIQUIDATION-DOWNSTREAM-FILING-CAPTURE" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract identity changed")
    if value["purpose"] != PURPOSE or value["authoritativeInput"] != expected_inputs():
        fail("purpose or authoritative input changed")
    expected_url = {
        "scheme": "https", "host": "www.sec.gov", "pathPrefix": "/Archives/",
        "pathDerivedOnlyFromExactMasterIndexFilename": True,
        "filenamePattern": "edgar/data/[0-9]+/[0-9]{10}-[0-9]{2}-[0-9]{6}.txt",
        "filenameAccessionMustEqualCandidateAccession": True,
        "queryForbidden": True, "fragmentForbidden": True,
    }
    if value["urlContract"] != expected_url:
        fail("URL contract changed")
    expected_network = {
        "secContactEnvironmentVariable": "SEC_CONTACT", "contactMustContainEmail": True,
        "requestsPerCandidate": 1, "maximumRequests": 115, "retryCount": 0,
        "minimumIntervalMilliseconds": 250, "requestTimeoutSeconds": 120,
        "acceptEncoding": "identity", "proxyEnvironmentIgnored": True,
        "redirectPolicy": "FORBID_ALL_REDIRECTS", "allowedHttpStatus": [200],
        "rateDeferredHttpStatuses": [403, 429, 503], "maximumResponseBytes": MAX_RESPONSE_BYTES,
        "contentTypePrefixAllowlist": ["text/plain", "application/octet-stream", "text/html"],
        "responseHeaderAllowlist": sorted(ALLOWED_HEADERS),
    }
    if value["networkPolicy"] != expected_network:
        fail("network policy changed")
    expected_private = {
        "absoluteRoot": str(PRIVATE_ROOT), "mustBeOutsideEveryGitWorktree": True,
        "rawBlobLayout": "blobs/sha256/<first2>/<sha256>", "receiptLayout": "receipts/<candidateId>.json",
        "deferredLayout": "deferred/<candidateId>.json", "manifestPath": "manifest.json",
        "atomicWriteNew": True, "existingBytesMustMatch": True,
        "rawBytesPublicGitAllowed": False, "receiptsPublicGitAllowed": False,
        "stdoutRawBytesAllowed": False, "stdoutCandidateRowsAllowed": False,
    }
    if value["privateCapture"] != expected_private:
        fail("private capture policy changed")
    receipt_keys = [
        "schema", "candidateId", "url", "capturedAt", "httpStatus", "responseHeaders",
        "rawSha256", "rawBytes", "blobRelativePath", "requestSequence", "receiptSha256",
    ]
    manifest_keys = [
        "schema", "contractRawSha256", "candidateCanonicalSha256", "expectedCandidates",
        "capturedCandidates", "deferredCandidates", "complete", "receiptSequenceSha256",
        "rawBlobSequenceSha256", "outcomesAccessed", "manifestSha256",
    ]
    if value["receiptSchema"] != receipt_keys or value["manifestSchema"] != manifest_keys:
        fail("capture schema changed")
    if value["claimLocks"] != EXPECTED_LOCKS:
        fail("claim locks changed")
    expected_implementation = {
        "baseCommit": BASE, "baseTag": 893, "remote": REMOTE, "ref": REMOTE_REF,
        "contractPath": CONTRACT.relative_to(ROOT).as_posix(),
        "runnerPath": RUNNER.relative_to(ROOT).as_posix(), "testPath": TEST.relative_to(ROOT).as_posix(),
        "runnerNormalizedSha256": sha(normalized_runner(RUNNER.read_bytes())), "testRawSha256": TEST_RAW,
        "introductionMustBeDirectSingleParentChildOfBase": True,
        "introductionAddsExactlyThreeOwnedPaths": True, "laterLinearSingleParentDescendantsAllowed": True,
        "productionCaptureRequiresPostIntroductionRemoteVerification": True,
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


def verify_discovery_inputs(head: str) -> None:
    for path, expected in (
        (DISCOVERY_CONTRACT, DISCOVERY_CONTRACT_RAW),
        (DISCOVERY_BUILDER, DISCOVERY_BUILDER_RAW),
        (DISCOVERY_TEST, DISCOVERY_TEST_RAW),
    ):
        raw = path.read_bytes()
        if sha(raw) != expected or git_raw(DISCOVERY_INTRODUCTION, path) != raw or git_raw(head, path) != raw:
            fail("discovery implementation bytes changed")


def load_candidates() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    raw = DISCOVERY_BUILDER.read_bytes()
    if sha(raw) != DISCOVERY_BUILDER_RAW:
        fail("discovery builder bytes changed before import")
    spec = importlib.util.spec_from_file_location("sealed_downstream_discovery", DISCOVERY_BUILDER)
    if spec is None or spec.loader is None:
        fail("discovery import failed")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    _seeds, candidates, links, stats = module.build_rows()
    if len(candidates) != 115 or len(links) != 469:
        fail("discovery population changed")
    if sha(module.canonical(candidates)) != EXPECTED_CANDIDATE_SHA or sha(module.canonical(links)) != EXPECTED_LINK_SHA:
        fail("discovery canonical bytes changed")
    if stats["candidateCanonicalSha256"] != EXPECTED_CANDIDATE_SHA or stats["linkCanonicalSha256"] != EXPECTED_LINK_SHA:
        fail("discovery stats changed")
    return candidates, links


def candidate_url(candidate: dict[str, Any]) -> str:
    match = FILENAME.fullmatch(candidate["filename"])
    if match is None or match.group(1) != candidate["accession"] or ACCESSION.fullmatch(candidate["accession"]) is None:
        fail("candidate filename/accession changed")
    return "https://www.sec.gov/Archives/" + candidate["filename"]


def contact() -> str:
    value = os.environ.get("SEC_CONTACT", "")
    if not value or "@" not in value or any(char in value for char in "\r\n"):
        fail("SEC_CONTACT is required and must contain an email address")
    return value


def safe_headers(headers: Any) -> dict[str, str]:
    return {key.lower(): value for key, value in headers.items() if key.lower() in ALLOWED_HEADERS}


def fetch(candidate: dict[str, Any], request_sequence: int) -> tuple[bytes, dict[str, str], int]:
    url = candidate_url(candidate)
    request = urllib.request.Request(url, headers={
        "User-Agent": f"GrowthScreenerResearchData liquidation-downstream/1.0 {contact()}",
        "Accept-Encoding": "identity", "Accept": "text/plain,application/octet-stream,text/html",
    })
    try:
        with OPENER.open(request, timeout=TIMEOUT_SECONDS) as response:
            if response.geturl() != url:
                fail("SEC response redirected")
            status = int(response.status)
            headers = safe_headers(response.headers)
            if status != 200:
                fail(f"unexpected SEC HTTP status {status}")
            content_type = headers.get("content-type", "").lower()
            if not any(content_type.startswith(prefix) for prefix in ("text/plain", "application/octet-stream", "text/html")):
                fail("SEC content type changed")
            raw = response.read(MAX_RESPONSE_BYTES + 1)
    except urllib.error.HTTPError as exc:
        headers = safe_headers(exc.headers)
        if exc.code in DEFERRED_HTTP:
            raise RateDeferred(exc.code, headers, candidate["candidateId"], url) from exc
        raise CaptureError(f"unexpected SEC HTTP status {exc.code}") from exc
    except (urllib.error.URLError, TimeoutError, socket.timeout, OSError) as exc:
        raise CaptureError(f"SEC request failed: {type(exc).__name__}") from exc
    if len(raw) > MAX_RESPONSE_BYTES or not raw:
        fail("SEC response size invalid")
    return raw, headers, request_sequence


def ensure_private_root() -> None:
    resolved = PRIVATE_ROOT.resolve()
    for worktree in git("worktree", "list", "--porcelain").splitlines():
        if not worktree.startswith("worktree "):
            continue
        base = Path(worktree.removeprefix("worktree ")).resolve()
        try:
            resolved.relative_to(base)
        except ValueError:
            continue
        fail("private capture root is inside a Git worktree")
    if (resolved / ".git").exists():
        fail("private capture root is a Git repository")


def atomic_create(path: Path, raw: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != raw:
            fail("existing private bytes differ")
        return
    descriptor, name = tempfile.mkstemp(prefix=".capture-", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.link(temporary, path)
    except FileExistsError:
        if path.read_bytes() != raw:
            fail("capture race produced different bytes")
    finally:
        temporary.unlink(missing_ok=True)


def encode_json(value: dict[str, Any]) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"


def receipt_path(candidate_id: str) -> Path:
    return PRIVATE_ROOT / "receipts" / f"{candidate_id}.json"


def deferred_path(candidate_id: str) -> Path:
    return PRIVATE_ROOT / "deferred" / f"{candidate_id}.json"


def blob_path(raw_sha: str) -> Path:
    return PRIVATE_ROOT / "blobs" / "sha256" / raw_sha[:2] / raw_sha


def make_receipt(candidate: dict[str, Any], url: str, captured_at: str, headers: dict[str, str], raw: bytes, sequence: int) -> dict[str, Any]:
    raw_sha = sha(raw)
    receipt = {
        "schema": "sec-liquidation-downstream-private-receipt/v1", "candidateId": candidate["candidateId"],
        "url": url, "capturedAt": captured_at, "httpStatus": 200, "responseHeaders": headers,
        "rawSha256": raw_sha, "rawBytes": len(raw),
        "blobRelativePath": blob_path(raw_sha).relative_to(PRIVATE_ROOT).as_posix(),
        "requestSequence": sequence, "receiptSha256": "",
    }
    receipt["receiptSha256"] = self_hash(receipt, "receiptSha256")
    return receipt


def validate_receipt(receipt: dict[str, Any], candidate: dict[str, Any]) -> None:
    exact_keys(receipt, {
        "schema", "candidateId", "url", "capturedAt", "httpStatus", "responseHeaders", "rawSha256",
        "rawBytes", "blobRelativePath", "requestSequence", "receiptSha256",
    }, "receipt")
    if receipt["schema"] != "sec-liquidation-downstream-private-receipt/v1" or receipt["candidateId"] != candidate["candidateId"]:
        fail("receipt identity changed")
    if receipt["url"] != candidate_url(candidate) or receipt["httpStatus"] != 200:
        fail("receipt URL or status changed")
    if HEX64.fullmatch(receipt["rawSha256"]) is None or receipt["receiptSha256"] != self_hash(receipt, "receiptSha256"):
        fail("receipt digest changed")
    path = PRIVATE_ROOT / receipt["blobRelativePath"]
    raw = path.read_bytes()
    if len(raw) != receipt["rawBytes"] or sha(raw) != receipt["rawSha256"] or path != blob_path(receipt["rawSha256"]):
        fail("private blob differs from receipt")


def build_manifest(candidates: list[dict[str, Any]]) -> dict[str, Any]:
    receipts: list[dict[str, Any]] = []
    deferred = 0
    for candidate in candidates:
        path = receipt_path(candidate["candidateId"])
        if path.exists():
            value = json.loads(path.read_bytes())
            validate_receipt(value, candidate)
            receipts.append(value)
        if deferred_path(candidate["candidateId"]).exists():
            deferred += 1
    receipts.sort(key=lambda item: item["requestSequence"])
    manifest = {
        "schema": "sec-liquidation-downstream-private-capture-manifest/v1",
        "contractRawSha256": CONTRACT_RAW, "candidateCanonicalSha256": EXPECTED_CANDIDATE_SHA,
        "expectedCandidates": 115, "capturedCandidates": len(receipts), "deferredCandidates": deferred,
        "complete": len(receipts) == 115,
        "receiptSequenceSha256": sha(("\n".join(item["receiptSha256"] for item in receipts) + ("\n" if receipts else "")).encode("utf-8")),
        "rawBlobSequenceSha256": sha(("\n".join(item["rawSha256"] for item in receipts) + ("\n" if receipts else "")).encode("utf-8")),
        "outcomesAccessed": False, "manifestSha256": "",
    }
    manifest["manifestSha256"] = self_hash(manifest, "manifestSha256")
    return manifest


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
    verify_discovery_inputs(head)
    introductions = [introduction_for(path) for path in OWNED]
    if all(not values for values in introductions):
        if head != BASE:
            fail("pre-introduction HEAD moved beyond base")
        return {"phase": "PRE_INTRODUCTION", "introductionCommit": None, "remoteVerified": True, "captureAuthorized": False}
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
    return {"phase": "POST_INTRODUCTION", "introductionCommit": introduction, "remoteVerified": True, "captureAuthorized": True}


def reseal(value: dict[str, Any]) -> dict[str, Any]:
    item = copy.deepcopy(value)
    item["contractSha256"] = self_hash(item, "contractSha256")
    return item


def rejected(action: Callable[[], None]) -> bool:
    try:
        action()
    except (CaptureError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError):
        return True
    return False


def self_test(contract_value: dict[str, Any]) -> dict[str, Any]:
    mutations: dict[str, Callable[[dict[str, Any]], None]] = {
        "backdated": lambda item: item.__setitem__("createdAt", "1970-01-01T00:00:00Z"),
        "purposeOverclaim": lambda item: item.__setitem__("purpose", "same security final recovery and terminal wealth"),
        "candidateLoss": lambda item: item["authoritativeInput"].__setitem__("candidateFilings", 114),
        "candidateDigest": lambda item: item["authoritativeInput"].__setitem__("candidateCanonicalSha256", "0" * 64),
        "hostDrift": lambda item: item["urlContract"].__setitem__("host", "example.com"),
        "queryEnabled": lambda item: item["urlContract"].__setitem__("queryForbidden", False),
        "proxyEnabled": lambda item: item["networkPolicy"].__setitem__("proxyEnvironmentIgnored", False),
        "redirectEnabled": lambda item: item["networkPolicy"].__setitem__("redirectPolicy", "FOLLOW"),
        "retryEnabled": lambda item: item["networkPolicy"].__setitem__("retryCount", 1),
        "rateRaised": lambda item: item["networkPolicy"].__setitem__("minimumIntervalMilliseconds", 0),
        "publicRaw": lambda item: item["privateCapture"].__setitem__("rawBytesPublicGitAllowed", True),
        "privateRedirect": lambda item: item["privateCapture"].__setitem__("absoluteRoot", str(ROOT / "reports")),
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
        item = copy.deepcopy(contract_value)
        mutate(item)
        item = reseal(item)
        kills[name] = rejected(lambda item=item: validate_contract(item))
    fixture = {"filename": "edgar/data/1414040/0001143362-14-000101.txt", "accession": "0001143362-14-000101"}
    kills.update({
        "validOfficialUrl": candidate_url(fixture) == "https://www.sec.gov/Archives/edgar/data/1414040/0001143362-14-000101.txt",
        "accessionMismatch": rejected(lambda: candidate_url({**fixture, "accession": "0001143362-14-000103"})),
        "pathTraversal": rejected(lambda: candidate_url({**fixture, "filename": "edgar/data/1414040/../evil.txt"})),
        "queryInjection": rejected(lambda: candidate_url({**fixture, "filename": fixture["filename"] + "?x=1"})),
        "proxyHandlerDisabled": all(not isinstance(handler, urllib.request.ProxyHandler) or not handler.proxies for handler in OPENER.handlers),
    })
    if not all(kills.values()):
        fail("self-test kill failed")
    return {"schema": "sec-liquidation-downstream-filing-capture-self-test/v1", "status": "PASS", "mutationKills": kills, "outcomesAccessed": False}


def capture() -> dict[str, Any]:
    repository = verify_repository(True)
    if not repository["captureAuthorized"]:
        fail("production capture requires post-introduction remote verification")
    ensure_private_root()
    candidates, _links = load_candidates()
    PRIVATE_ROOT.mkdir(parents=True, exist_ok=True)
    last_request = 0.0
    requests = 0
    for candidate in candidates:
        receipt_target = receipt_path(candidate["candidateId"])
        if receipt_target.exists():
            validate_receipt(json.loads(receipt_target.read_bytes()), candidate)
            continue
        elapsed = time.monotonic() - last_request
        if elapsed < MIN_INTERVAL_SECONDS:
            time.sleep(MIN_INTERVAL_SECONDS - elapsed)
        requests += 1
        try:
            raw, headers, sequence = fetch(candidate, requests)
        except RateDeferred as exc:
            deferred = {
                "schema": "sec-liquidation-downstream-private-deferred/v1",
                "candidateId": exc.candidate_id, "url": exc.url, "httpStatus": exc.status,
                "responseHeaders": exc.headers, "requestSequence": requests,
                "outcomesAccessed": False, "deferredSha256": "",
            }
            deferred["deferredSha256"] = self_hash(deferred, "deferredSha256")
            atomic_create(deferred_path(candidate["candidateId"]), encode_json(deferred))
            manifest = build_manifest(candidates)
            atomic_create(PRIVATE_ROOT / "manifest.json", encode_json(manifest))
            return {"schema": "sec-liquidation-downstream-filing-capture/v1", "status": "DEFERRED", **repository,
                    "requests": requests, "capturedCandidates": manifest["capturedCandidates"],
                    "deferredCandidates": manifest["deferredCandidates"], "outcomesAccessed": False}
        last_request = time.monotonic()
        raw_sha = sha(raw)
        atomic_create(blob_path(raw_sha), raw)
        captured_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        receipt = make_receipt(candidate, candidate_url(candidate), captured_at, headers, raw, sequence)
        atomic_create(receipt_target, encode_json(receipt))
    manifest = build_manifest(candidates)
    atomic_create(PRIVATE_ROOT / "manifest.json", encode_json(manifest))
    return {"schema": "sec-liquidation-downstream-filing-capture/v1", "status": "PASS" if manifest["complete"] else "INCOMPLETE",
            **repository, "requests": requests, "capturedCandidates": manifest["capturedCandidates"],
            "deferredCandidates": manifest["deferredCandidates"], "manifestSha256": manifest["manifestSha256"],
            "outcomesAccessed": False}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify-contract", "dry-run", "self-test", "capture"))
    parser.add_argument("--remote", action="store_true")
    args = parser.parse_args()
    try:
        value = load_contract()
        if args.command == "capture":
            result = capture()
        else:
            repository = verify_repository(args.remote)
            candidates, links = load_candidates()
            if args.command == "verify-contract":
                result = {"schema": "sec-liquidation-downstream-filing-capture-contract-verification/v1", "status": "PASS", **repository,
                          "candidateFilings": len(candidates), "caseCandidateLinks": len(links), "outcomesAccessed": False}
            elif args.command == "self-test":
                result = {**self_test(value), **repository}
            else:
                ensure_private_root()
                result = {"schema": "sec-liquidation-downstream-filing-capture-dry-run/v1", "status": "PASS", **repository,
                          "candidateFilings": len(candidates), "caseCandidateLinks": len(links), "networkRequests": 0,
                          "writes": 0, "privateRootExists": PRIVATE_ROOT.exists(), "outcomesAccessed": False}
    except (CaptureError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
