#!/usr/bin/env python3
"""Fail-closed, secret-safe FINRA Public credential authentication handshake."""

from __future__ import annotations

import argparse
import base64
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from urllib import error, request


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "research" / "early-detection-v4" / "finra-q004-accounted-handshake-contract-v2.json"
PRIOR_PATH = ROOT / "research" / "early-detection-v4" / "finra-q004-public-catalog-contract-v1.json"
TEST_PATH = ROOT / "tests" / "run-finra-q004-accounted-handshake-v2.test.js"
OUTPUT_PATH = ROOT / "reports" / "early-detection" / "finra-q004-public-credential-handshake-v2.json"
EXPECTED_CONTRACT_SCHEMA = "finra-q004-accounted-handshake-contract/v2"
EXPECTED_PRIOR_SHA256 = "fc85cc48194b4408ec7f917321a71d85cf7c1265d56acbec42b6a5e76a489654"
EXPECTED_CREDENTIAL_TARGET = "GrowthScreener/FINRA/PublicAPI"
EXPECTED_TOKEN_ENDPOINT = "https://ews.fip.finra.org/fip/rest/ews/oauth2/access_token?grant_type=client_credentials"
EXPECTED_OUTPUT_REL = "reports/early-detection/finra-q004-public-credential-handshake-v2.json"
EXPECTED_REMOTE_URL = "https://github.com/Karlryl/screener-data.git"
EXPECTED_REMOTE_NAME = "origin"
EXPECTED_REMOTE_BRANCH = "codex/early-detection-v4-gates-20260810"
HEX64 = re.compile(r"^[0-9a-f]{64}$")
HEX40 = re.compile(r"^[0-9a-f]{40}$")
RFC3339_Z = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


class StudyError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise StudyError(message)


def canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def load_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        fail(f"invalid JSON at {path}: {exc}")
    if not isinstance(value, dict):
        fail(f"top-level JSON object required at {path}")
    return value


def git(*args: str) -> str:
    proc = subprocess.run(
        ["git", *args], cwd=ROOT, text=True, encoding="utf-8", errors="strict",
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
    )
    if proc.returncode != 0:
        fail(f"git command failed: {' '.join(args)}")
    return proc.stdout.strip()


def contract_hash(contract: dict) -> str:
    body = dict(contract)
    body.pop("contractSha256", None)
    return sha256_bytes(canonical(body))


def exact_keys(value: dict, expected: set[str], label: str) -> None:
    if set(value) != expected:
        fail(f"{label} keyset changed")


def validate_contract() -> dict:
    contract = load_json(CONTRACT_PATH)
    exact_keys(contract, {
        "schema", "createdAt", "track", "taskId", "sourceId", "purpose",
        "priorDiscoveryContract", "officialDocumentation", "accountContract",
        "handshakeContract", "outputContract", "claimLocks", "contractSha256",
    }, "contract")
    if contract["schema"] != EXPECTED_CONTRACT_SCHEMA:
        fail("contract schema changed")
    if contract["track"] != "SHARED_OUTCOME_BLIND_INFRA" or contract["taskId"] != "Q004-FINRA-OTC-CATALOG" or contract["sourceId"] != "FINRA_OTC_PRIMARY":
        fail("study boundary changed")
    if contract["contractSha256"] != contract_hash(contract) or not HEX64.fullmatch(contract["contractSha256"]):
        fail("contract self-hash mismatch")
    prior = contract["priorDiscoveryContract"]
    if prior != {
        "path": "research/early-detection-v4/finra-q004-public-catalog-contract-v1.json",
        "rawSha256": EXPECTED_PRIOR_SHA256,
    } or sha256_file(PRIOR_PATH) != EXPECTED_PRIOR_SHA256:
        fail("prior discovery contract binding changed")
    docs = contract["officialDocumentation"]
    expected_refs = {
        "FINRA_DEVELOPER_DOCS", "FINRA_PUBLIC_FEES", "FINRA_API_SUPPORT",
        "FINRA_EQUITY_SPECIFIC_TERMS", "FINRA_API_TERMS",
    }
    if not isinstance(docs, list) or {x.get("sourceRef") for x in docs if isinstance(x, dict)} != expected_refs:
        fail("official documentation set changed")
    for item in docs:
        exact_keys(item, {"sourceRef", "url", "requiredFacts"}, "documentation item")
        if not isinstance(item["url"], str) or not item["url"].startswith("https://developer.finra.org/"):
            fail("non-official documentation URL")
        if not isinstance(item["requiredFacts"], list) or not item["requiredFacts"] or not all(isinstance(x, str) and x for x in item["requiredFacts"]):
            fail("documentation facts missing")
    account = contract["accountContract"]
    exact_keys(account, {
        "userType", "credentialType", "monthlyFeeUsd", "monthlyUsageCapLabel",
        "paymentDetailsRequired", "trialUsed", "paidCredentialTypesAllowed",
        "credentialStoreTarget", "credentialStore", "clientIdMayBePrinted",
        "apiSecretMayBePrinted", "apiSecretMayBeWrittenToFile",
    }, "account contract")
    expected_account = {
        "userType": "INDIVIDUAL", "credentialType": "PUBLIC", "monthlyFeeUsd": 0,
        "monthlyUsageCapLabel": "10 GB", "paymentDetailsRequired": False,
        "trialUsed": False, "paidCredentialTypesAllowed": False,
        "credentialStoreTarget": EXPECTED_CREDENTIAL_TARGET,
        "credentialStore": "WINDOWS_CREDENTIAL_MANAGER", "clientIdMayBePrinted": False,
        "apiSecretMayBePrinted": False, "apiSecretMayBeWrittenToFile": False,
    }
    if account != expected_account:
        fail("free account or secret-storage contract changed")
    handshake = contract["handshakeContract"]
    exact_keys(handshake, {
        "tokenEndpoint", "method", "grantType", "authorizationScheme",
        "maximumRequests", "redirectsAllowed", "environmentProxyUseAllowed",
        "retryAllowed", "productionDataRequestsAllowed", "metadataRequestsAllowed",
        "accessTokenMayBePersisted", "accessTokenMayBePrinted", "allowedResponseKeys",
        "requiredTokenType", "minimumExpiresInSeconds", "maximumExpiresInSeconds",
    }, "handshake contract")
    if handshake != {
        "tokenEndpoint": EXPECTED_TOKEN_ENDPOINT, "method": "POST",
        "grantType": "client_credentials", "authorizationScheme": "Basic",
        "maximumRequests": 1, "redirectsAllowed": False,
        "environmentProxyUseAllowed": False, "retryAllowed": False,
        "productionDataRequestsAllowed": False, "metadataRequestsAllowed": False,
        "accessTokenMayBePersisted": False, "accessTokenMayBePrinted": False,
        "allowedResponseKeys": ["access_token", "expires_in", "scope", "token_type"],
        "requiredTokenType": "Bearer", "minimumExpiresInSeconds": 60,
        "maximumExpiresInSeconds": 86400,
    }:
        fail("single-request handshake contract changed")
    output = contract["outputContract"]
    exact_keys(output, {
        "path", "writeNewOnly", "canonicalJson", "utf8NoBom", "lfFinalNewline",
        "secretsCaptured", "outcomesAccessed", "productionRowsCaptured",
    }, "output contract")
    if output != {
        "path": EXPECTED_OUTPUT_REL, "writeNewOnly": True, "canonicalJson": True,
        "utf8NoBom": True, "lfFinalNewline": True, "secretsCaptured": False,
        "outcomesAccessed": False, "productionRowsCaptured": 0,
    }:
        fail("output contract changed")
    locks = contract["claimLocks"]
    if set(locks) != {
        "historicalIdentityIntervalsComplete", "terminalPaymentsComplete",
        "terminalSessionsComplete", "adjustedOhlcvComplete", "corporateActionsComplete",
        "originalV4GateCredit", "resultComputationAllowed", "outcomesAccessed",
    } or any(value is not False for value in locks.values()):
        fail("claim locks changed")
    return contract


def verify_remote_snapshot() -> dict:
    head = git("rev-parse", "HEAD")
    upstream = git("rev-parse", "@{upstream}")
    remote_url = git("remote", "get-url", EXPECTED_REMOTE_NAME)
    if remote_url != EXPECTED_REMOTE_URL:
        fail("remote URL changed")
    remote_line = git("ls-remote", EXPECTED_REMOTE_NAME, f"refs/heads/{EXPECTED_REMOTE_BRANCH}")
    remote_head = remote_line.split()[0] if remote_line else ""
    if not HEX40.fullmatch(head):
        fail("invalid local commit identity")
    if head != upstream or head != remote_head:
        fail("local/upstream/remote drift")
    bindings = []
    for path in (CONTRACT_PATH, Path(__file__).resolve(), TEST_PATH):
        rel = path.relative_to(ROOT).as_posix()
        local = path.read_bytes()
        committed = subprocess.run(
            ["git", "show", f"{head}:{rel}"], cwd=ROOT, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, check=False,
        )
        if committed.returncode != 0 or committed.stdout != local:
            fail(f"implementation file not byte-bound at remote HEAD: {rel}")
        bindings.append({"path": rel, "rawSha256": sha256_bytes(local), "gitCommit": head})
    return {"remoteName": EXPECTED_REMOTE_NAME, "remoteBranch": EXPECTED_REMOTE_BRANCH, "remoteHead": head, "files": bindings}


def validate_implementation_bindings(bindings: dict) -> None:
    exact_keys(bindings, {"remoteName", "remoteBranch", "remoteHead", "files"}, "implementation bindings")
    if bindings["remoteName"] != EXPECTED_REMOTE_NAME or bindings["remoteBranch"] != EXPECTED_REMOTE_BRANCH:
        fail("implementation remote identity changed")
    commit = bindings["remoteHead"]
    if not isinstance(commit, str) or not HEX40.fullmatch(commit):
        fail("implementation commit identity is invalid")
    files = bindings["files"]
    expected_paths = {
        CONTRACT_PATH.relative_to(ROOT).as_posix(): sha256_file(CONTRACT_PATH),
        Path(__file__).resolve().relative_to(ROOT).as_posix(): sha256_file(Path(__file__).resolve()),
        TEST_PATH.relative_to(ROOT).as_posix(): sha256_file(TEST_PATH),
    }
    if not isinstance(files, list) or len(files) != len(expected_paths):
        fail("implementation file binding count changed")
    actual: dict[str, str] = {}
    for item in files:
        if not isinstance(item, dict):
            fail("implementation file binding must be an object")
        exact_keys(item, {"path", "rawSha256", "gitCommit"}, "implementation file binding")
        path = item["path"]
        raw_sha = item["rawSha256"]
        if not isinstance(path, str) or path in actual or not isinstance(raw_sha, str) or not HEX64.fullmatch(raw_sha):
            fail("implementation file binding is invalid or duplicated")
        if item["gitCommit"] != commit:
            fail("implementation file commit differs from snapshot commit")
        actual[path] = raw_sha
    if actual != expected_paths:
        fail("implementation file bindings changed")


def verify_report_remote_binding(report: dict) -> None:
    bindings = report["implementationBindings"]
    validate_implementation_bindings(bindings)
    current = verify_remote_snapshot()
    base_commit = bindings["remoteHead"]
    if git("merge-base", "--is-ancestor", base_commit, current["remoteHead"]) != "":
        fail("unexpected output from ancestry check")
    for item in bindings["files"]:
        proc = subprocess.run(
            ["git", "show", f"{base_commit}:{item['path']}"], cwd=ROOT,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
        )
        if proc.returncode != 0 or sha256_bytes(proc.stdout) != item["rawSha256"]:
            fail("recorded implementation Git blob mismatch")
    rel = OUTPUT_PATH.relative_to(ROOT).as_posix()
    proc = subprocess.run(
        ["git", "show", f"{current['remoteHead']}:{rel}"], cwd=ROOT,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
    )
    if proc.returncode != 0 or proc.stdout != OUTPUT_PATH.read_bytes():
        fail("output is not byte-bound at the current remote HEAD")


class CREDENTIAL(ctypes.Structure):
    _fields_ = [
        ("Flags", wintypes.DWORD), ("Type", wintypes.DWORD), ("TargetName", wintypes.LPWSTR),
        ("Comment", wintypes.LPWSTR), ("LastWritten", wintypes.FILETIME),
        ("CredentialBlobSize", wintypes.DWORD), ("CredentialBlob", ctypes.POINTER(ctypes.c_byte)),
        ("Persist", wintypes.DWORD), ("AttributeCount", wintypes.DWORD),
        ("Attributes", ctypes.c_void_p), ("TargetAlias", wintypes.LPWSTR), ("UserName", wintypes.LPWSTR),
    ]


PCREDENTIAL = ctypes.POINTER(CREDENTIAL)


def read_windows_credential() -> tuple[str, str]:
    if os.name != "nt":
        fail("Windows Credential Manager is required")
    advapi = ctypes.WinDLL("Advapi32.dll")
    cred_read = advapi.CredReadW
    cred_read.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(PCREDENTIAL)]
    cred_read.restype = wintypes.BOOL
    cred_free = advapi.CredFree
    cred_free.argtypes = [ctypes.c_void_p]
    ptr = PCREDENTIAL()
    if not cred_read(EXPECTED_CREDENTIAL_TARGET, 1, 0, ctypes.byref(ptr)):
        fail("FINRA credential is absent from Windows Credential Manager")
    try:
        cred = ptr.contents
        username = cred.UserName or ""
        if not username or cred.CredentialBlobSize <= 0 or cred.CredentialBlobSize % 2:
            fail("FINRA credential is incomplete")
        secret = ctypes.wstring_at(cred.CredentialBlob, cred.CredentialBlobSize // 2)
        if not secret:
            fail("FINRA API Secret is empty")
        return username, secret
    finally:
        cred_free(ptr)


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        fail("FINRA token endpoint redirected unexpectedly")


def sanitize_token_response(raw: bytes, http_status: int, content_type: str) -> dict:
    if http_status != 200:
        fail(f"FINRA token endpoint returned HTTP {http_status}")
    if len(raw) < 20 or len(raw) > 16384:
        fail("FINRA token response size is invalid")
    try:
        value = json.loads(raw.decode("utf-8"))
    except Exception:
        fail("FINRA token response is not valid UTF-8 JSON")
    if not isinstance(value, dict) or set(value) != {"access_token", "expires_in", "scope", "token_type"}:
        fail("FINRA token response keyset changed")
    token = value["access_token"]
    if not isinstance(token, str) or len(token) < 16 or len(token) > 8192 or any(ch.isspace() for ch in token):
        fail("FINRA access token shape is invalid")
    if value["token_type"] != "Bearer":
        fail("FINRA token type changed")
    expires = value["expires_in"]
    if isinstance(expires, str) and expires.isdigit():
        expires = int(expires)
    if not isinstance(expires, int) or isinstance(expires, bool) or not 60 <= expires <= 86400:
        fail("FINRA token lifetime is outside the frozen range")
    if not isinstance(value["scope"], str) or not value["scope"]:
        fail("FINRA token scope is missing")
    sanitized = {
        "httpStatus": 200, "contentType": content_type.split(";", 1)[0].strip().lower(),
        "accessTokenPresent": True, "accessTokenPersisted": False,
        "accessTokenPrinted": False, "tokenType": "Bearer",
        "expiresInSeconds": expires, "scope": value["scope"],
    }
    if sanitized["contentType"] != "application/json":
        fail("FINRA token response content type changed")
    return sanitized


def token_request(username: str, secret: str) -> dict:
    basic = base64.b64encode(f"{username}:{secret}".encode("utf-8")).decode("ascii")
    req = request.Request(EXPECTED_TOKEN_ENDPOINT, data=b"", method="POST", headers={
        "Authorization": f"Basic {basic}", "Accept": "application/json",
        "User-Agent": "GrowthScreener-Research/1.0 FINRA-Q004-auth-handshake",
    })
    opener = request.build_opener(request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(req, timeout=30) as response:
            raw = response.read(16385)
            status = response.status
            content_type = response.headers.get("Content-Type", "")
    except error.HTTPError as exc:
        fail(f"FINRA token request failed with HTTP {exc.code}")
    except error.URLError as exc:
        fail(f"FINRA token request failed without a response: {type(exc.reason).__name__}")
    finally:
        basic = ""
    return sanitize_token_response(raw, status, content_type)


def build_report(contract: dict, remote: dict, token_meta: dict, captured_at: str) -> dict:
    report = {
        "schema": "finra-q004-public-credential-handshake/v2",
        "capturedAt": captured_at,
        "track": contract["track"], "taskId": contract["taskId"], "sourceId": contract["sourceId"],
        "contractRawSha256": sha256_file(CONTRACT_PATH),
        "contractSha256": contract["contractSha256"],
        "priorDiscoveryContractRawSha256": EXPECTED_PRIOR_SHA256,
        "implementationBindings": remote,
        "credentialEvidence": {
            "credentialStore": "WINDOWS_CREDENTIAL_MANAGER",
            "credentialStoreTarget": EXPECTED_CREDENTIAL_TARGET,
            "userType": "INDIVIDUAL", "credentialType": "PUBLIC",
            "monthlyFeeUsd": 0, "monthlyUsageCapLabel": "10 GB",
            "credentialAuthenticationSucceeded": True,
            "clientIdCaptured": False, "apiSecretCaptured": False,
        },
        "handshake": token_meta,
        "requestCounts": {"tokenRequests": 1, "metadataRequests": 0, "productionDataRequests": 0},
        "secretsCaptured": False, "outcomesAccessed": False, "productionRowsCaptured": 0,
        "claimLocks": contract["claimLocks"],
    }
    report["reportSha256"] = sha256_bytes(canonical(report))
    return report


def validate_report(report: dict, contract: dict) -> None:
    expected = {
        "schema", "capturedAt", "track", "taskId", "sourceId", "contractRawSha256",
        "contractSha256", "priorDiscoveryContractRawSha256", "implementationBindings",
        "credentialEvidence", "handshake", "requestCounts", "secretsCaptured",
        "outcomesAccessed", "productionRowsCaptured", "claimLocks", "reportSha256",
    }
    exact_keys(report, expected, "report")
    if report["schema"] != "finra-q004-public-credential-handshake/v2":
        fail("report schema changed")
    if report["track"] != contract["track"] or report["taskId"] != contract["taskId"] or report["sourceId"] != contract["sourceId"]:
        fail("report study boundary changed")
    if not isinstance(report["capturedAt"], str) or not RFC3339_Z.fullmatch(report["capturedAt"]):
        fail("report capture timestamp is invalid")
    try:
        datetime.strptime(report["capturedAt"], "%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        fail("report capture timestamp is not a real UTC timestamp")
    body = dict(report)
    claimed = body.pop("reportSha256")
    if claimed != sha256_bytes(canonical(body)) or not HEX64.fullmatch(claimed):
        fail("report self-hash mismatch")
    if report["contractRawSha256"] != sha256_file(CONTRACT_PATH) or report["contractSha256"] != contract["contractSha256"]:
        fail("report contract binding mismatch")
    if report["priorDiscoveryContractRawSha256"] != EXPECTED_PRIOR_SHA256:
        fail("report prior-contract binding mismatch")
    validate_implementation_bindings(report["implementationBindings"])
    if report["credentialEvidence"] != {
        "credentialStore": "WINDOWS_CREDENTIAL_MANAGER", "credentialStoreTarget": EXPECTED_CREDENTIAL_TARGET,
        "userType": "INDIVIDUAL", "credentialType": "PUBLIC", "monthlyFeeUsd": 0,
        "monthlyUsageCapLabel": "10 GB", "credentialAuthenticationSucceeded": True,
        "clientIdCaptured": False, "apiSecretCaptured": False,
    }:
        fail("credential evidence changed")
    if report["requestCounts"] != {"tokenRequests": 1, "metadataRequests": 0, "productionDataRequests": 0}:
        fail("request counts changed")
    handshake = report["handshake"]
    if not isinstance(handshake, dict):
        fail("handshake evidence must be an object")
    exact_keys(handshake, {
        "httpStatus", "contentType", "accessTokenPresent", "accessTokenPersisted",
        "accessTokenPrinted", "tokenType", "expiresInSeconds", "scope",
    }, "handshake evidence")
    if handshake["httpStatus"] != 200 or handshake["contentType"] != "application/json":
        fail("handshake HTTP evidence changed")
    if handshake["accessTokenPresent"] is not True or handshake["accessTokenPersisted"] is not False or handshake["accessTokenPrinted"] is not False:
        fail("handshake token boundary changed")
    if handshake["tokenType"] != "Bearer":
        fail("handshake token type changed")
    expires = handshake["expiresInSeconds"]
    if not isinstance(expires, int) or isinstance(expires, bool) or not 60 <= expires <= 86400:
        fail("handshake token lifetime changed")
    if not isinstance(handshake["scope"], str) or not handshake["scope"] or len(handshake["scope"]) > 256:
        fail("handshake scope is invalid")
    if report["secretsCaptured"] is not False or report["outcomesAccessed"] is not False or report["productionRowsCaptured"] != 0:
        fail("outcome or secret boundary changed")
    if report["claimLocks"] != contract["claimLocks"] or any(report["claimLocks"].values()):
        fail("report claim locks changed")
    serialized = canonical(report).decode("utf-8").casefold()
    for forbidden in ("access_token", "authorization", "api secret", "client id\":\""):
        if forbidden in serialized:
            fail("secret-bearing field leaked into report")


def atomic_write_new(path: Path, raw: bytes) -> None:
    if path.exists():
        fail("output already exists")
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temp = Path(temp_name)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.link(temp, path)
    finally:
        temp.unlink(missing_ok=True)
    if path.read_bytes() != raw:
        fail("output readback mismatch")


def self_test(contract: dict) -> dict:
    fake_token = "SYNTHETIC_TOKEN_MUST_NEVER_APPEAR_123456"
    raw = canonical({"access_token": fake_token, "expires_in": "43170", "scope": "any", "token_type": "Bearer"})
    meta = sanitize_token_response(raw, 200, "application/json; charset=utf-8")
    fake_remote = {
        "remoteName": EXPECTED_REMOTE_NAME, "remoteBranch": EXPECTED_REMOTE_BRANCH,
        "remoteHead": "a" * 40,
        "files": [
            {"path": CONTRACT_PATH.relative_to(ROOT).as_posix(), "rawSha256": sha256_file(CONTRACT_PATH), "gitCommit": "a" * 40},
            {"path": Path(__file__).resolve().relative_to(ROOT).as_posix(), "rawSha256": sha256_file(Path(__file__).resolve()), "gitCommit": "a" * 40},
            {"path": TEST_PATH.relative_to(ROOT).as_posix(), "rawSha256": sha256_file(TEST_PATH), "gitCommit": "a" * 40},
        ],
    }
    report = build_report(contract, fake_remote, meta, "2026-08-12T19:05:00Z")
    validate_report(report, contract)
    serialized = canonical(report)
    if fake_token.encode() in serialized:
        fail("synthetic access token leaked")
    kills = {}
    cases = {
        "wrongTokenTypeRejected": {"access_token": fake_token, "expires_in": 43170, "scope": "any", "token_type": "Basic"},
        "shortLifetimeRejected": {"access_token": fake_token, "expires_in": 1, "scope": "any", "token_type": "Bearer"},
        "extraResponseKeyRejected": {"access_token": fake_token, "expires_in": 43170, "scope": "any", "token_type": "Bearer", "refresh_token": "x"},
        "emptyTokenRejected": {"access_token": "", "expires_in": 43170, "scope": "any", "token_type": "Bearer"},
    }
    for name, value in cases.items():
        try:
            sanitize_token_response(canonical(value), 200, "application/json")
            kills[name] = False
        except StudyError:
            kills[name] = True
    mutated = json.loads(json.dumps(report))
    mutated["requestCounts"]["productionDataRequests"] = 1
    body = dict(mutated); body.pop("reportSha256")
    mutated["reportSha256"] = sha256_bytes(canonical(body))
    try:
        validate_report(mutated, contract); kills["productionRequestRejected"] = False
    except StudyError:
        kills["productionRequestRejected"] = True
    mutated = json.loads(json.dumps(report)); mutated["claimLocks"]["originalV4GateCredit"] = True
    body = dict(mutated); body.pop("reportSha256")
    mutated["reportSha256"] = sha256_bytes(canonical(body))
    try:
        validate_report(mutated, contract); kills["gateCreditRejected"] = False
    except StudyError:
        kills["gateCreditRejected"] = True
    if not all(kills.values()):
        fail("one or more self-test kills failed")
    return {"schema": "finra-q004-accounted-handshake-self-test/v2", "status": "PASS", "kills": kills, "outcomesAccessed": False, "secretsCaptured": False}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("verify-contract", "self-test", "verify-output", "handshake"))
    parser.add_argument("--output")
    parser.add_argument("--remote", action="store_true")
    args = parser.parse_args()
    try:
        contract = validate_contract()
        if args.command == "verify-contract":
            print(json.dumps({"schema": "finra-q004-accounted-handshake-contract-verification/v2", "status": "PASS", "contractSha256": contract["contractSha256"], "outcomesAccessed": False}, sort_keys=True))
        elif args.command == "self-test":
            print(json.dumps(self_test(contract), sort_keys=True))
        elif args.command == "verify-output":
            if args.output is None or Path(args.output).resolve() != OUTPUT_PATH.resolve():
                fail("output verification requires the frozen output path")
            report = load_json(OUTPUT_PATH)
            validate_report(report, contract)
            expected_raw = canonical(report) + b"\n"
            if OUTPUT_PATH.read_bytes() != expected_raw:
                fail("output is not canonical JSON with one LF newline")
            if args.remote:
                verify_report_remote_binding(report)
            print(json.dumps({"schema": "finra-q004-accounted-handshake-output-verification/v2", "status": "PASS", "rawSha256": sha256_bytes(expected_raw), "reportSha256": report["reportSha256"], "remoteVerified": args.remote, "outcomesAccessed": False, "secretsCaptured": False}, sort_keys=True))
        else:
            if args.output is None or Path(args.output).resolve() != OUTPUT_PATH.resolve():
                fail("handshake requires the frozen output path")
            remote_before = verify_remote_snapshot()
            username, secret = read_windows_credential()
            try:
                token_meta = token_request(username, secret)
            finally:
                username = ""; secret = ""
            captured_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
            remote_after = verify_remote_snapshot()
            if remote_before != remote_after:
                fail("remote or implementation drifted during handshake")
            report = build_report(contract, remote_after, token_meta, captured_at)
            validate_report(report, contract)
            raw = canonical(report) + b"\n"
            atomic_write_new(OUTPUT_PATH, raw)
            validate_report(load_json(OUTPUT_PATH), contract)
            print(json.dumps({"schema": "finra-q004-accounted-handshake-write-result/v2", "status": "PASS", "output": EXPECTED_OUTPUT_REL, "rawSha256": sha256_bytes(raw), "reportSha256": report["reportSha256"], "outcomesAccessed": False, "secretsCaptured": False}, sort_keys=True))
        return 0
    except StudyError as exc:
        print(f"StudyError: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
