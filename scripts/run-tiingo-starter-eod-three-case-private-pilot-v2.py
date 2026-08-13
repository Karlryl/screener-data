#!/usr/bin/env python3
"""Fail-closed repaired private Tiingo Starter EOD three-case entitlement pilot."""

from __future__ import annotations

import argparse
import base64
import copy
import ctypes
from ctypes import wintypes
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from typing import Any, Callable
from urllib import error, request


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "research" / "early-detection-v4" / "tiingo-starter-eod-three-case-private-pilot-contract-v2.json"
PREREQUISITE_PATH = ROOT / "research" / "early-detection-v4" / "tiingo-free-eod-prerequisite-contract-v1.json"
DECISION_PATH = ROOT / "research" / "early-detection-v4" / "consolidated-adjusted-ohlcv-zero-cost-source-decision-contract-v1.json"
TEST_PATH = ROOT / "tests" / "run-tiingo-starter-eod-three-case-private-pilot-v2.test.js"
CONTRACT_RAW = "5113eb8177d2b2f8aaac07067f025b8e2489277c1c5d25d9c01adb8b2c30118a"
CONTRACT_SELF = "b44d3cdb3dad7c37ede96eb38c392b1461401e917b91aa2b1fb60ee2b5fd7422"
RUNNER_NORMALIZED = "7d54dc1e93341832fac6cd1dc00fb23530fed2dac54c5cd3d1679225627a6bf9"
TEST_NORMALIZED = "5d03eb3edfaa59ea0f10368814a9d8f12a2134e509551e9002a39a15debd3776"
REMOTE_URL = "https://github.com/Karlryl/screener-data.git"
REMOTE_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
BUILD_BASE = "034b279eb39ec2ac9e5b85dddf237677d0769767"
CREDENTIAL_TARGET = "GrowthScreener/Tiingo/StarterAPI"
CREDENTIAL_USERNAME = "TIINGO_STARTER"
OUTPUT_NAME = "tiingo-starter-eod-three-case-private-pilot-v2.json.gz"
AUTHORIZED_PATHS = [
    "research/early-detection-v4/tiingo-starter-eod-three-case-private-pilot-contract-v2.json",
    "scripts/run-tiingo-starter-eod-three-case-private-pilot-v2.py",
    "tests/run-tiingo-starter-eod-three-case-private-pilot-v2.test.js",
]
DEPENDENCIES = {
    "prerequisiteContract": (PREREQUISITE_PATH, "6ef3bbcce169fd840432c941ef83b31c6c30ee73194e955c1899d2c6530b888d", "b65918c52c3effe3be3cd84fe586c2f896aed4fa502400e7fbc3f46fcb7dc0cf"),
    "sourceDecisionContract": (DECISION_PATH, "dbcbd44a5acbd5b30334f2a3047ed37515a02eb15de5a19fc3aec98629f40d1b", "82729a5441926ab8fcc51c7bddb38070adce35230e7f9e4f5e4388ced1c983f5"),
}
REQUIRED_EOD_FIELDS = [
    "date", "open", "high", "low", "close", "volume", "adjOpen", "adjHigh", "adjLow",
    "adjClose", "adjVolume", "divCash", "splitFactor",
]
REQUESTS = [
    {"requestId": "ACTIVE_STABLE_AAPL_METADATA", "caseId": "ACTIVE_STABLE_AAPL", "symbol": "AAPL", "kind": "METADATA", "pathAndQuery": "/tiingo/daily/AAPL", "allowedHttpStatuses": [200]},
    {"requestId": "ACTIVE_STABLE_AAPL_EOD", "caseId": "ACTIVE_STABLE_AAPL", "symbol": "AAPL", "kind": "EOD", "pathAndQuery": "/tiingo/daily/AAPL/prices?startDate=2024-01-02&endDate=2024-01-05&format=json&resampleFreq=daily", "allowedHttpStatuses": [200]},
    {"requestId": "SYMBOL_CHANGE_FB_META_METADATA", "caseId": "SYMBOL_CHANGE_FB_META", "symbol": "META", "kind": "METADATA", "pathAndQuery": "/tiingo/daily/META", "allowedHttpStatuses": [200]},
    {"requestId": "SYMBOL_CHANGE_FB_META_EOD", "caseId": "SYMBOL_CHANGE_FB_META", "symbol": "META", "kind": "EOD", "pathAndQuery": "/tiingo/daily/META/prices?startDate=2022-06-01&endDate=2022-06-15&format=json&resampleFreq=daily", "allowedHttpStatuses": [200]},
    {"requestId": "TERMINAL_ATVI_METADATA", "caseId": "TERMINAL_ATVI", "symbol": "ATVI", "kind": "METADATA", "pathAndQuery": "/tiingo/daily/ATVI", "allowedHttpStatuses": [200, 404]},
    {"requestId": "TERMINAL_ATVI_EOD", "caseId": "TERMINAL_ATVI", "symbol": "ATVI", "kind": "EOD", "pathAndQuery": "/tiingo/daily/ATVI/prices?startDate=2023-10-09&endDate=2023-10-20&format=json&resampleFreq=daily", "allowedHttpStatuses": [200, 404]},
]


class PilotError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise PilotError(message)


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        fail(f"{label} exact keys changed")


def normalized_runner(raw: bytes) -> bytes:
    text = raw.decode("utf-8").replace("\r\n", "\n")
    for name in ("CONTRACT_RAW", "CONTRACT_SELF", "RUNNER_NORMALIZED", "TEST_NORMALIZED"):
        pattern = rf'^{name} = "[0-9a-fA-Z_]+"$'
        if len(re.findall(pattern, text, flags=re.MULTILINE)) != 1:
            fail(f"{name} normalization target changed")
        text = re.sub(pattern, f'{name} = "{"0" * 64}"', text, flags=re.MULTILINE)
    return text.encode("utf-8")


def normalized_test(raw: bytes) -> bytes:
    text = raw.decode("utf-8").replace("\r\n", "\n")
    for name in ("EXPECTED_CONTRACT_RAW", "EXPECTED_RUNNER_NORMALIZED", "EXPECTED_TEST_NORMALIZED"):
        pattern = rf"^const {name} = '[0-9a-fA-Z_]+';$"
        if len(re.findall(pattern, text, flags=re.MULTILINE)) != 1:
            fail(f"{name} normalization target changed")
        text = re.sub(pattern, f"const {name} = '{'0' * 64}';", text, flags=re.MULTILINE)
    return text.encode("utf-8")


def git(*args: str, check: bool = True) -> str:
    proc = subprocess.run(["git", *args], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if check and proc.returncode != 0:
        fail("git verification failed")
    return proc.stdout.decode("utf-8", errors="strict").strip()


def git_path_exists(commit: str, path: str) -> bool:
    proc = subprocess.run(["git", "cat-file", "-e", f"{commit}:{path}"], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    return proc.returncode == 0


def parse_zulu(value: Any) -> None:
    if not isinstance(value, str) or not re.fullmatch(r"20\d\d-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\dZ", value):
        fail("createdAt must be an exact Zulu timestamp")


def validate_contract(value: dict[str, Any], *, dependencies: bool = True) -> None:
    exact_keys(value, {"schema", "createdAt", "taskId", "track", "purpose", "inputs", "repairProvenance", "accountGate", "requestContract", "privateCaptureContract", "qualificationContract", "executionState", "claimLocks", "implementationContract", "contractSha256"}, "contract")
    if value["schema"] != "tiingo-starter-eod-three-case-private-pilot-contract/v2" or value["taskId"] != "Q003-TIINGO-STARTER-EOD-THREE-CASE-PRIVATE-PILOT-REPAIR" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract identity changed")
    parse_zulu(value["createdAt"])
    if value["createdAt"] != "2026-08-13T10:12:00Z":
        fail("createdAt changed")
    expected_purpose = "Transparently supersede the truncated Tag-886 runner and authorize the same six-request private Tiingo Starter EOD entitlement pilot only under new V2 implementation paths, without admitting provider rows into the study or granting identity, terminal-value, return, outcome or Original-V4 credit."
    if value["purpose"] != expected_purpose:
        fail("purpose changed")
    repair = value["repairProvenance"]
    exact_keys(repair, {"brokenIntroductionCommit", "brokenContractPath", "brokenContractRawSha256", "brokenRunnerPath", "brokenRunnerRawSha256", "brokenTestPath", "brokenTestRawSha256", "failureClass", "productionRequestsExecuted", "privateCaptureMaterialized", "studyCredit"}, "repairProvenance")
    expected_repair = {"brokenIntroductionCommit": BUILD_BASE, "brokenContractPath": "research/early-detection-v4/tiingo-starter-eod-three-case-private-pilot-contract-v1.json", "brokenContractRawSha256": "6881985f0cbcb474671183ad5a6d3db989b38a50f480310fe62e5922aa06a867", "brokenRunnerPath": "scripts/run-tiingo-starter-eod-three-case-private-pilot-v1.py", "brokenRunnerRawSha256": "55890d11f4cd6e09de332336516dd7651e05a6609d1018c1a6f940a713b22755", "brokenTestPath": "tests/run-tiingo-starter-eod-three-case-private-pilot-v1.test.js", "brokenTestRawSha256": "8176bf680f09affb27a96b20e32a74b849f9f8b1646df8f9a4a4b22bc1a9ded6", "failureClass": "TRUNCATED_INVALID_PYTHON_RUNNER", "productionRequestsExecuted": False, "privateCaptureMaterialized": False, "studyCredit": "NONE"}
    if repair != expected_repair:
        fail("repair provenance changed")
    for stem in ("brokenContract", "brokenRunner", "brokenTest"):
        proc = subprocess.run(["git", "show", f"{BUILD_BASE}:{repair[stem + 'Path']}"], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        if proc.returncode or sha(proc.stdout) != repair[stem + "RawSha256"]:
            fail("broken introduction bytes changed")
    exact_keys(value["inputs"], set(DEPENDENCIES), "inputs")
    for key, (path, raw_expected, self_expected) in DEPENDENCIES.items():
        row = value["inputs"][key]
        exact_keys(row, {"path", "rawSha256", "contractSha256"}, f"inputs.{key}")
        if row != {"path": path.relative_to(ROOT).as_posix(), "rawSha256": raw_expected, "contractSha256": self_expected}:
            fail(f"inputs.{key} changed")
        if dependencies:
            raw = path.read_bytes()
            if sha(raw) != raw_expected:
                fail(f"{key} raw bytes changed")
            parsed = json.loads(raw)
            if parsed.get("contractSha256") != self_expected or sha(canonical({k: v for k, v in parsed.items() if k != "contractSha256"})) != self_expected:
                fail(f"{key} self hash changed")

    gate = value["accountGate"]
    exact_keys(gate, {"provider", "requiredTier", "monthlyFeeUsd", "paymentDetailsAllowed", "trialAllowed", "secondAccountAllowed", "explicitZeroCostAttestationFlag", "credentialStore", "credentialTarget", "credentialUsername", "tokenInChatAllowed", "tokenInEnvironmentAllowed", "tokenInFilesAllowed", "tokenInUrlAllowed", "tokenInStdoutAllowed"}, "accountGate")
    expected_gate = {"provider": "TIINGO", "requiredTier": "STARTER", "monthlyFeeUsd": 0, "paymentDetailsAllowed": False, "trialAllowed": False, "secondAccountAllowed": False, "explicitZeroCostAttestationFlag": "--attest-starter-zero-cost", "credentialStore": "WINDOWS_CREDENTIAL_MANAGER", "credentialTarget": CREDENTIAL_TARGET, "credentialUsername": CREDENTIAL_USERNAME, "tokenInChatAllowed": False, "tokenInEnvironmentAllowed": False, "tokenInFilesAllowed": False, "tokenInUrlAllowed": False, "tokenInStdoutAllowed": False}
    if gate != expected_gate:
        fail("account gate changed")

    req = value["requestContract"]
    exact_keys(req, {"apiOrigin", "authorizationScheme", "accept", "userAgent", "maximumUniqueSymbols", "maximumRequests", "maximumResponseBytesPerRequest", "redirectsAllowed", "environmentProxyUseAllowed", "retryAllowed", "parallelRequestsAllowed", "premiumEndpointAllowed", "requests"}, "requestContract")
    if req != {"apiOrigin": "https://api.tiingo.com", "authorizationScheme": "Token", "accept": "application/json", "userAgent": "GrowthScreener-Research/1.0 Tiingo-Private-Entitlement-Pilot", "maximumUniqueSymbols": 3, "maximumRequests": 6, "maximumResponseBytesPerRequest": 8388608, "redirectsAllowed": False, "environmentProxyUseAllowed": False, "retryAllowed": False, "parallelRequestsAllowed": False, "premiumEndpointAllowed": False, "requests": REQUESTS}:
        fail("request contract changed")

    private = value["privateCaptureContract"]
    exact_keys(private, {"explicitAbsolutePrivateRootRequired", "gitWorktreeOrRepositoryPathAllowed", "outputFileName", "writeNewOnly", "deterministicGzip", "rawResponsesStoredAsBase64", "requestAuthorizationStored", "tokenStored", "publicProviderRowsAllowed", "stdoutMayContainOnly"}, "privateCaptureContract")
    expected_stdout = ["status", "captureRawSha256", "captureGzipSha256", "requestCount", "successfulResponseCount", "notFoundResponseCount", "requiredEodFieldSetsObserved", "studyCredit", "privateProviderPriceRowsAccessed", "returnsComputed", "outcomesAccessed"]
    if private != {"explicitAbsolutePrivateRootRequired": True, "gitWorktreeOrRepositoryPathAllowed": False, "outputFileName": OUTPUT_NAME, "writeNewOnly": True, "deterministicGzip": True, "rawResponsesStoredAsBase64": True, "requestAuthorizationStored": False, "tokenStored": False, "publicProviderRowsAllowed": False, "stdoutMayContainOnly": expected_stdout}:
        fail("private capture contract changed")

    qual = value["qualificationContract"]
    exact_keys(qual, {"requiredEodFields", "aaplMetadataAndEodMustReturn200", "metaMetadataAndEodMustReturn200", "atviMayReturn200Or404", "providerRowsRemainPrivate", "tickerOnlyIdentityPromotionAllowed", "lastQuoteAsTerminalPaymentAllowed", "missingOr404AsWorthlessAllowed", "fullUniverseExtrapolationAllowed", "studyAdmissionRequiresSeparateFutureContract"}, "qualificationContract")
    if qual != {"requiredEodFields": REQUIRED_EOD_FIELDS, "aaplMetadataAndEodMustReturn200": True, "metaMetadataAndEodMustReturn200": True, "atviMayReturn200Or404": True, "providerRowsRemainPrivate": True, "tickerOnlyIdentityPromotionAllowed": False, "lastQuoteAsTerminalPaymentAllowed": False, "missingOr404AsWorthlessAllowed": False, "fullUniverseExtrapolationAllowed": False, "studyAdmissionRequiresSeparateFutureContract": True}:
        fail("qualification contract changed")

    state = value["executionState"]
    exact_keys(state, {"accountAttested", "credentialBound", "productionRequestsExecuted", "privateCaptureMaterialized", "studyCredit", "pilotMayRunAfterAccountGate"}, "executionState")
    if state != {"accountAttested": False, "credentialBound": False, "productionRequestsExecuted": False, "privateCaptureMaterialized": False, "studyCredit": "NONE", "pilotMayRunAfterAccountGate": True}:
        fail("execution state changed")
    locks = value["claimLocks"]
    exact_keys(locks, {"fullUniverseCoverageVerified", "historicalIdentityResolved", "symbolChangeContinuityVerified", "delistedCoverageComplete", "terminalPaymentVerified", "terminalSessionVerified", "terminalWealthComplete", "corporateActionsComplete", "candidateRowsAuthorizedForStudy", "resultComputationAllowed", "returnsComputed", "outcomesAccessed", "originalV4GateCredit"}, "claimLocks")
    if any(item is not False for item in locks.values()):
        fail("claim lock opened")

    impl = value["implementationContract"]
    exact_keys(impl, {"repository", "remoteUrl", "remoteRef", "buildBaseCommit", "introductionDirectChildOfBuildBase", "introductionAddsExactlyAuthorizedPaths", "linearSingleParentDescendantsRequired", "remoteVerificationRequired", "authorizedPaths", "runnerNormalizedSha256", "testNormalizedSha256"}, "implementationContract")
    expected_impl = {"repository": "Karlryl/screener-data", "remoteUrl": REMOTE_URL, "remoteRef": REMOTE_REF, "buildBaseCommit": BUILD_BASE, "introductionDirectChildOfBuildBase": True, "introductionAddsExactlyAuthorizedPaths": True, "linearSingleParentDescendantsRequired": True, "remoteVerificationRequired": True, "authorizedPaths": AUTHORIZED_PATHS, "runnerNormalizedSha256": RUNNER_NORMALIZED, "testNormalizedSha256": TEST_NORMALIZED}
    if impl != expected_impl:
        fail("implementation contract changed")
    computed = sha(canonical({k: v for k, v in value.items() if k != "contractSha256"}))
    if value["contractSha256"] != CONTRACT_SELF or computed != CONTRACT_SELF:
        fail("contract self hash changed")


def load_contract() -> dict[str, Any]:
    raw = CONTRACT_PATH.read_bytes()
    if len(raw) <= 1000 or sha(raw) != CONTRACT_RAW:
        fail("contract raw bytes changed")
    value = json.loads(raw)
    validate_contract(value)
    if sha(normalized_runner(Path(__file__).read_bytes())) != RUNNER_NORMALIZED:
        fail("runner normalized bytes changed")
    if sha(normalized_test(TEST_PATH.read_bytes())) != TEST_NORMALIZED:
        fail("test normalized bytes changed")
    return value


def verify_remote(*, require_post: bool) -> dict[str, Any]:
    if git("remote", "get-url", "origin") != REMOTE_URL:
        fail("origin URL changed")
    head = git("rev-parse", "HEAD")
    upstream = git("rev-parse", "@{u}")
    remote_line = git("ls-remote", "origin", REMOTE_REF)
    remote = remote_line.split()[0] if remote_line else ""
    if head != upstream or head != remote:
        fail("HEAD, upstream and live remote differ")
    if git("merge-base", "--is-ancestor", BUILD_BASE, head) != "":
        fail("build base is not an ancestor")
    present = [git_path_exists(head, path) for path in AUTHORIZED_PATHS]
    if not any(present):
        if head != BUILD_BASE or require_post:
            fail("pilot implementation is not remotely introduced")
        return {"phase": "PRE_INTRODUCTION", "head": head, "introductionCommit": None, "remoteVerified": True}
    if not all(present):
        fail("partial implementation introduction")
    commits = git("rev-list", "--reverse", f"{BUILD_BASE}..{head}").splitlines()
    introductions = []
    for commit in commits:
        if all(git_path_exists(commit, path) for path in AUTHORIZED_PATHS):
            introductions.append(commit)
    if not introductions:
        fail("implementation introduction missing")
    intro = introductions[0]
    if git("rev-parse", f"{intro}^") != BUILD_BASE or len(git("rev-list", "--parents", "-n", "1", intro).split()) != 2:
        fail("introduction is not the direct single-parent child")
    diff = git("diff-tree", "--no-commit-id", "--name-status", "-r", intro).splitlines()
    expected_diff = [f"A\t{path}" for path in AUTHORIZED_PATHS]
    if diff != expected_diff:
        fail("introduction did not add exactly the authorized paths")
    cursor = head
    while cursor != intro:
        parts = git("rev-list", "--parents", "-n", "1", cursor).split()
        if len(parts) != 2:
            fail("nonlinear descendant history")
        cursor = parts[1]
    for path in AUTHORIZED_PATHS:
        disk = (ROOT / path).read_bytes()
        proc = subprocess.run(["git", "show", f"{head}:{path}"], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        intro_proc = subprocess.run(["git", "show", f"{intro}:{path}"], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        if proc.returncode or intro_proc.returncode or proc.stdout != disk or intro_proc.stdout != disk:
            fail("implementation bytes are not immutable Git bytes")
    return {"phase": "POST_INTRODUCTION", "head": head, "introductionCommit": intro, "remoteVerified": True}


class CREDENTIAL(ctypes.Structure):
    _fields_ = [("Flags", wintypes.DWORD), ("Type", wintypes.DWORD), ("TargetName", wintypes.LPWSTR), ("Comment", wintypes.LPWSTR), ("LastWritten", wintypes.FILETIME), ("CredentialBlobSize", wintypes.DWORD), ("CredentialBlob", ctypes.POINTER(ctypes.c_byte)), ("Persist", wintypes.DWORD), ("AttributeCount", wintypes.DWORD), ("Attributes", ctypes.c_void_p), ("TargetAlias", wintypes.LPWSTR), ("UserName", wintypes.LPWSTR)]


PCREDENTIAL = ctypes.POINTER(CREDENTIAL)


def read_token() -> str:
    if os.name != "nt":
        fail("Windows Credential Manager is required")
    advapi = ctypes.WinDLL("Advapi32.dll")
    cred_read = advapi.CredReadW
    cred_read.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(PCREDENTIAL)]
    cred_read.restype = wintypes.BOOL
    cred_free = advapi.CredFree
    cred_free.argtypes = [ctypes.c_void_p]
    ptr = PCREDENTIAL()
    if not cred_read(CREDENTIAL_TARGET, 1, 0, ctypes.byref(ptr)):
        fail("Tiingo Starter credential is absent from Windows Credential Manager")
    try:
        cred = ptr.contents
        if (cred.UserName or "") != CREDENTIAL_USERNAME or cred.CredentialBlobSize <= 0 or cred.CredentialBlobSize % 2:
            fail("Tiingo Starter credential shape changed")
        token = ctypes.wstring_at(cred.CredentialBlob, cred.CredentialBlobSize // 2)
        if not 16 <= len(token) <= 512 or any(ch.isspace() for ch in token):
            fail("Tiingo token shape is invalid")
        return token
    finally:
        cred_free(ptr)


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        fail("Tiingo endpoint redirected unexpectedly")


def resolve_private_root(root_text: str) -> Path:
    private_root = Path(root_text)
    if not private_root.is_absolute() or not private_root.exists() or not private_root.is_dir():
        fail("an existing absolute private root is required")
    resolved = private_root.resolve()
    if resolved == ROOT.resolve() or ROOT.resolve() in resolved.parents or resolved in ROOT.resolve().parents:
        fail("private root overlaps the study repository")
    for candidate in (resolved, *resolved.parents):
        if (candidate / ".git").exists():
            fail("private root is inside a Git repository or worktree")
    probe = subprocess.run(["git", "-C", str(resolved), "rev-parse", "--is-inside-work-tree"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    if probe.returncode == 0:
        fail("private root resolves inside a Git worktree")
    return resolved


def private_output_path(root_text: str) -> Path:
    resolved = resolve_private_root(root_text)
    output = resolved / OUTPUT_NAME
    if output.exists():
        fail("private capture already exists")
    return output


def fetch_one(spec: dict[str, Any], token: str) -> dict[str, Any]:
    url = "https://api.tiingo.com" + spec["pathAndQuery"]
    req = request.Request(url, method="GET", headers={"Authorization": f"Token {token}", "Accept": "application/json", "User-Agent": "GrowthScreener-Research/1.0 Tiingo-Private-Entitlement-Pilot"})
    opener = request.build_opener(request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(req, timeout=30) as response:
            status = response.status
            content_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
            raw = response.read(8388609)
    except error.HTTPError as exc:
        status = exc.code
        content_type = exc.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        raw = exc.read(8388609)
    except error.URLError as exc:
        fail(f"Tiingo request failed without a response: {type(exc.reason).__name__}")
    if status not in spec["allowedHttpStatuses"] or len(raw) > 8388608:
        fail("Tiingo response status or size changed")
    parsed = None
    fields_observed = False
    if status == 200:
        if content_type != "application/json":
            fail("Tiingo response content type changed")
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except Exception:
            fail("Tiingo response is not UTF-8 JSON")
        if spec["kind"] == "METADATA":
            if not isinstance(parsed, dict):
                fail("Tiingo metadata response shape changed")
        else:
            if not isinstance(parsed, list) or not parsed:
                fail("Tiingo EOD response is empty or not a list")
            for row in parsed:
                if not isinstance(row, dict) or not set(REQUIRED_EOD_FIELDS).issubset(row):
                    fail("Tiingo EOD required field set changed")
            fields_observed = True
    return {"requestId": spec["requestId"], "caseId": spec["caseId"], "symbol": spec["symbol"], "kind": spec["kind"], "pathAndQuery": spec["pathAndQuery"], "httpStatus": status, "contentType": content_type, "responseBytes": len(raw), "responseRawSha256": sha(raw), "responseBodyBase64": base64.b64encode(raw).decode("ascii"), "requiredEodFieldSetObserved": fields_observed}


def deterministic_gzip(raw: bytes) -> bytes:
    import io
    buffer = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=buffer, compresslevel=9, mtime=0) as stream:
        stream.write(raw)
    return buffer.getvalue()


def write_new(path: Path, raw: bytes) -> None:
    fd, temp_name = tempfile.mkstemp(prefix=".tiingo-pilot-", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.link(temp_name, path)
    finally:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass


def validate_private_capture(capture: dict[str, Any], contract: dict[str, Any], current: dict[str, Any]) -> dict[str, Any]:
    exact_keys(capture, {"schema", "capturedAt", "contractRawSha256", "contractSha256", "implementation", "accountEvidence", "responses", "qualification", "claimLocks", "returnsComputed", "outcomesAccessed", "captureSha256"}, "private capture")
    if capture["schema"] != "tiingo-starter-eod-three-case-private-capture/v2" or capture["contractRawSha256"] != CONTRACT_RAW or capture["contractSha256"] != CONTRACT_SELF:
        fail("private capture identity changed")
    parse_zulu(capture["capturedAt"])
    implementation = capture["implementation"]
    exact_keys(implementation, {"phase", "head", "introductionCommit", "remoteVerified"}, "private implementation")
    if implementation["phase"] != "POST_INTRODUCTION" or implementation["remoteVerified"] is not True or implementation["introductionCommit"] != current["introductionCommit"]:
        fail("private capture implementation binding changed")
    captured_head = implementation["head"]
    if not isinstance(captured_head, str) or not re.fullmatch(r"[0-9a-f]{40}", captured_head):
        fail("private capture head changed")
    if git("merge-base", "--is-ancestor", implementation["introductionCommit"], captured_head) != "" or git("merge-base", "--is-ancestor", captured_head, current["head"]) != "":
        fail("private capture is outside the verified linear history")
    account = capture["accountEvidence"]
    exact_keys(account, {"tierAttested", "monthlyFeeUsdAttested", "paymentDetailsAbsentAttested", "trialAbsentAttested", "credentialStore", "credentialTarget", "credentialBound", "tokenCaptured"}, "accountEvidence")
    if account != {"tierAttested": "STARTER", "monthlyFeeUsdAttested": 0, "paymentDetailsAbsentAttested": True, "trialAbsentAttested": True, "credentialStore": "WINDOWS_CREDENTIAL_MANAGER", "credentialTarget": CREDENTIAL_TARGET, "credentialBound": True, "tokenCaptured": False}:
        fail("private capture account evidence changed")
    responses = capture["responses"]
    if not isinstance(responses, list) or len(responses) != len(REQUESTS):
        fail("private capture response count changed")
    required_sets = 0
    successful = 0
    missing = 0
    response_keys = {"requestId", "caseId", "symbol", "kind", "pathAndQuery", "httpStatus", "contentType", "responseBytes", "responseRawSha256", "responseBodyBase64", "requiredEodFieldSetObserved"}
    for row, spec in zip(responses, REQUESTS):
        exact_keys(row, response_keys, "private response")
        for key in ("requestId", "caseId", "symbol", "kind", "pathAndQuery"):
            if row[key] != spec[key]:
                fail("private response request binding changed")
        if row["httpStatus"] not in spec["allowedHttpStatuses"]:
            fail("private response status changed")
        try:
            raw = base64.b64decode(row["responseBodyBase64"], validate=True)
        except Exception:
            fail("private response base64 changed")
        if len(raw) != row["responseBytes"] or sha(raw) != row["responseRawSha256"] or len(raw) > 8388608:
            fail("private response raw binding changed")
        observed = False
        if row["httpStatus"] == 200:
            successful += 1
            if row["contentType"] != "application/json":
                fail("private response content type changed")
            try:
                parsed = json.loads(raw.decode("utf-8"))
            except Exception:
                fail("private response JSON changed")
            if spec["kind"] == "METADATA":
                if not isinstance(parsed, dict):
                    fail("private metadata response shape changed")
            else:
                if not isinstance(parsed, list) or not parsed or any(not isinstance(item, dict) or not set(REQUIRED_EOD_FIELDS).issubset(item) for item in parsed):
                    fail("private EOD field set changed")
                observed = True
                required_sets += 1
        else:
            missing += 1
        if row["requiredEodFieldSetObserved"] is not observed:
            fail("private EOD field observation changed")
    qualification = capture["qualification"]
    exact_keys(qualification, {"caseCount", "requestCount", "successfulResponseCount", "notFoundResponseCount", "requiredEodFieldSetsObserved", "providerRowsRemainPrivate", "studyCredit"}, "qualification")
    if qualification != {"caseCount": 3, "requestCount": 6, "successfulResponseCount": successful, "notFoundResponseCount": missing, "requiredEodFieldSetsObserved": required_sets, "providerRowsRemainPrivate": True, "studyCredit": "NONE"}:
        fail("private qualification changed")
    if capture["claimLocks"] != contract["claimLocks"] or capture["returnsComputed"] is not False or capture["outcomesAccessed"] is not False:
        fail("private capture claim lock changed")
    computed = sha(canonical({key: item for key, item in capture.items() if key != "captureSha256"}))
    if capture["captureSha256"] != computed:
        fail("private capture self hash changed")
    return {"successfulResponseCount": successful, "notFoundResponseCount": missing, "requiredEodFieldSetsObserved": required_sets}


def verify_private(private_root: str) -> dict[str, Any]:
    contract = load_contract()
    current = verify_remote(require_post=True)
    output = resolve_private_root(private_root) / OUTPUT_NAME
    if not output.exists() or not output.is_file():
        fail("private capture is absent")
    gz = output.read_bytes()
    try:
        raw = gzip.decompress(gz)
    except Exception:
        fail("private capture gzip changed")
    if deterministic_gzip(raw) != gz or not raw.endswith(b"\n"):
        fail("private capture deterministic gzip changed")
    try:
        capture = json.loads(raw)
    except Exception:
        fail("private capture JSON changed")
    counts = validate_private_capture(capture, contract, current)
    return {"status": "PASS_PRIVATE_CAPTURE_VERIFIED", "captureRawSha256": sha(raw), "captureGzipSha256": sha(gz), "requestCount": 6, **counts, "studyCredit": "NONE", "privateProviderPriceRowsAccessed": True, "returnsComputed": False, "outcomesAccessed": False}


def execute(private_root: str, attested: bool) -> dict[str, Any]:
    contract = load_contract()
    if not attested:
        fail("explicit zero-cost Starter attestation is required")
    remote = verify_remote(require_post=True)
    output = private_output_path(private_root)
    token = read_token()
    try:
        responses = [fetch_one(spec, token) for spec in REQUESTS]
    finally:
        token = ""
    if [row["requestId"] for row in responses] != [row["requestId"] for row in REQUESTS]:
        fail("request order changed")
    capture = {"schema": "tiingo-starter-eod-three-case-private-capture/v2", "capturedAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "contractRawSha256": CONTRACT_RAW, "contractSha256": CONTRACT_SELF, "implementation": remote, "accountEvidence": {"tierAttested": "STARTER", "monthlyFeeUsdAttested": 0, "paymentDetailsAbsentAttested": True, "trialAbsentAttested": True, "credentialStore": "WINDOWS_CREDENTIAL_MANAGER", "credentialTarget": CREDENTIAL_TARGET, "credentialBound": True, "tokenCaptured": False}, "responses": responses, "qualification": {"caseCount": 3, "requestCount": 6, "successfulResponseCount": sum(row["httpStatus"] == 200 for row in responses), "notFoundResponseCount": sum(row["httpStatus"] == 404 for row in responses), "requiredEodFieldSetsObserved": sum(row["requiredEodFieldSetObserved"] for row in responses), "providerRowsRemainPrivate": True, "studyCredit": "NONE"}, "claimLocks": contract["claimLocks"], "returnsComputed": False, "outcomesAccessed": False}
    capture["captureSha256"] = sha(canonical(capture))
    raw = canonical(capture) + b"\n"
    gz = deterministic_gzip(raw)
    write_new(output, gz)
    after = verify_remote(require_post=True)
    if after != remote or output.read_bytes() != gz:
        fail("post-capture verification changed")
    return {"status": "PASS_PRIVATE_CAPTURE_MATERIALIZED", "captureRawSha256": sha(raw), "captureGzipSha256": sha(gz), "requestCount": 6, "successfulResponseCount": capture["qualification"]["successfulResponseCount"], "notFoundResponseCount": capture["qualification"]["notFoundResponseCount"], "requiredEodFieldSetsObserved": capture["qualification"]["requiredEodFieldSetsObserved"], "studyCredit": "NONE", "privateProviderPriceRowsAccessed": True, "returnsComputed": False, "outcomesAccessed": False}


def rejected(action: Callable[[], Any]) -> bool:
    try:
        action()
    except (PilotError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError):
        return True
    return False


def self_test() -> dict[str, Any]:
    source = load_contract()
    mutations: list[tuple[str, tuple[Any, ...], Any]] = [
        ("purposeOverclaim", ("purpose",), "Full universe price and outcome acquisition"),
        ("paidTier", ("accountGate", "monthlyFeeUsd"), 1),
        ("paymentAllowed", ("accountGate", "paymentDetailsAllowed"), True),
        ("trialAllowed", ("accountGate", "trialAllowed"), True),
        ("environmentToken", ("accountGate", "tokenInEnvironmentAllowed"), True),
        ("urlToken", ("accountGate", "tokenInUrlAllowed"), True),
        ("requestLimit", ("requestContract", "maximumRequests"), 7),
        ("premiumEndpoint", ("requestContract", "premiumEndpointAllowed"), True),
        ("proxy", ("requestContract", "environmentProxyUseAllowed"), True),
        ("retry", ("requestContract", "retryAllowed"), True),
        ("publicRows", ("privateCaptureContract", "publicProviderRowsAllowed"), True),
        ("gitPrivateRoot", ("privateCaptureContract", "gitWorktreeOrRepositoryPathAllowed"), True),
        ("tickerIdentity", ("qualificationContract", "tickerOnlyIdentityPromotionAllowed"), True),
        ("terminalQuote", ("qualificationContract", "lastQuoteAsTerminalPaymentAllowed"), True),
        ("worthless404", ("qualificationContract", "missingOr404AsWorthlessAllowed"), True),
        ("fullUniverse", ("qualificationContract", "fullUniverseExtrapolationAllowed"), True),
        ("studyCredit", ("executionState", "studyCredit"), "FULL"),
        ("outcomeLock", ("claimLocks", "outcomesAccessed"), True),
        ("returnLock", ("claimLocks", "returnsComputed"), True),
        ("v4Credit", ("claimLocks", "originalV4GateCredit"), True),
        ("remoteOptional", ("implementationContract", "remoteVerificationRequired"), False),
        ("baseForward", ("implementationContract", "buildBaseCommit"), "f" * 40),
    ]
    kills: dict[str, bool] = {}
    for name, path, replacement in mutations:
        item = copy.deepcopy(source)
        cursor: Any = item
        for part in path[:-1]:
            cursor = cursor[part]
        cursor[path[-1]] = replacement
        kills[name] = rejected(lambda item=item: validate_contract(item, dependencies=False))
    item = copy.deepcopy(source)
    item["requestContract"]["requests"].pop()
    kills["requestRemoved"] = rejected(lambda: validate_contract(item, dependencies=False))
    item = copy.deepcopy(source)
    item["qualificationContract"]["requiredEodFields"].remove("adjClose")
    kills["adjustedFieldRemoved"] = rejected(lambda: validate_contract(item, dependencies=False))
    item = copy.deepcopy(source)
    item["claimLocks"]["unknownCredit"] = True
    kills["unknownCreditKey"] = rejected(lambda: validate_contract(item, dependencies=False))
    if not all(kills.values()):
        fail("self-test mutation survived")
    return {"status": "PASS", "mutationKillCount": len(kills), "mutationKills": kills, "networkRequests": 0, "filesWritten": 0, "pricesAccessed": False, "returnsComputed": False, "outcomesAccessed": False}


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    verify_parser = sub.add_parser("verify")
    verify_parser.add_argument("--remote", action="store_true")
    sub.add_parser("self-test")
    run_parser = sub.add_parser("run")
    run_parser.add_argument("--remote", action="store_true")
    run_parser.add_argument("--private-root", required=True)
    run_parser.add_argument("--attest-starter-zero-cost", action="store_true")
    private_parser = sub.add_parser("verify-private")
    private_parser.add_argument("--remote", action="store_true")
    private_parser.add_argument("--private-root", required=True)
    args = parser.parse_args()
    try:
        if args.command == "self-test":
            result = self_test()
        elif args.command == "verify":
            load_contract()
            if not args.remote:
                fail("verify requires --remote")
            result = {"status": "PASS", **verify_remote(require_post=False), "pilotMayRunAfterAccountGate": True, "productionRequestsExecuted": False, "pricesAccessed": False, "returnsComputed": False, "outcomesAccessed": False}
        elif args.command == "run":
            if not args.remote:
                fail("run requires --remote")
            result = execute(args.private_root, args.attest_starter_zero_cost)
        else:
            if not args.remote:
                fail("verify-private requires --remote")
            result = verify_private(args.private_root)
    except (PilotError, OSError, json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
