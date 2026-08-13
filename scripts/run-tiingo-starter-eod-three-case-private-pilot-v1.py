#!/usr/bin/env python3
"""Fail-closed private Tiingo Starter EOD three-case entitlement pilot."""

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
CONTRACT_PATH = ROOT / "research" / "early-detection-v4" / "tiingo-starter-eod-three-case-private-pilot-contract-v1.json"
PREREQUISITE_PATH = ROOT / "research" / "early-detection-v4" / "tiingo-free-eod-prerequisite-contract-v1.json"
DECISION_PATH = ROOT / "research" / "early-detection-v4" / "consolidated-adjusted-ohlcv-zero-cost-source-decision-contract-v1.json"
TEST_PATH = ROOT / "tests" / "run-tiingo-starter-eod-three-case-private-pilot-v1.test.js"
CONTRACT_RAW = "6881985f0cbcb474671183ad5a6d3db989b38a50f480310fe62e5922aa06a867"
CONTRACT_SELF = "db87223c93d8400e8fdc580a74965822ef1fe9057f925cf617af302ba8d24c13"
RUNNER_NORMALIZED = "2afb706fb7e872fcc7d55c89e9808fbd965613c546f200110091b01be872dfab"
TEST_NORMALIZED = "7e53edb8a4ef90a0ceb4d5000ab10818cdf922075cdddb7ead660840e6951cf5"
REMOTE_URL = "https://github.com/Karlryl/screener-data.git"
REMOTE_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
BUILD_BASE = "1b812c7e81d01895d6a0a696a9aba303bfdd79f7"
CREDENTIAL_TARGET = "GrowthScreener/Tiingo/StarterAPI"
CREDENTIAL_USERNAME = "TIINGO_STARTER"
OUTPUT_NAME = "tiingo-starter-eod-three-case-private-pilot-v1.json.gz"
AUTHORIZED_PATHS = [
    "research/early-detection-v4/tiingo-starter-eod-three-case-private-pilot-contract-v1.json",
    "scripts/run-tiingo-starter-eod-three-case-private-pilot-v1.py",
    "tests/run-tiingo-starter-eod-three-case-private-pilot-v1.test.js",
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
    exact_keys(value, {"schema", "createdAt", "taskId", "track", "purpose", "inputs", "accountGate", "requestContract", "privateCaptureContract", "qualificationContract", "executionState", "claimLocks", "implementationContract", "contractSha256"}, "contract")
    if value["schema"] != "tiingo-starter-eod-three-case-private-pilot-contract/v1" or value["taskId"] != "Q003-TIINGO-STARTER-EOD-THREE-CASE-PRIVATE-PILOT" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract identity changed")
    parse_zulu(value["createdAt"])
    if value["createdAt"] != "2026-08-13T09:51:17Z":
        fail("createdAt changed")
    expected_purpose = "Authorize a six-request private entitlement pilot for exactly three Tiingo Starter EOD cases after explicit zero-cost account attestation, without admitting provider rows into the study or granting identity, terminal-value, return, outcome or Original-V4 credit."
    if value["purpose"] != expected_purpose:
        fail("purpose changed")
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
            fail("pilot implementation is not remotely introducÛ]=¶‰Ëkºwµç@™…¥° ‰Q¥¥¹¼=É•ÍÁ½¹Í”¥Ì•µÁÑä½È¹½Ğ„±¥ÍĞˆ¤(€€€€€€€€€€€™½ÈÉ½Ü¥¸Á…ÉÍ•è(€€€€€€€€€€€€€€€¥˜¹½Ğ¥Í¥¹ÍÑ…¹”¡É½Ü°‘¥Ğ¤½È¹½ĞÍ•Ğ¡IEU%I}=}%1L¤¹¥ÍÍÕ‰Í•Ğ¡É½Ü¤è(€€€€€€€€€€€€€€€€€€€™…¥° ‰Q¥¥¹¼=É•ÅÕ¥É•™¥•±Í•Ğ¡…¹•ˆ¤(€€€€€€€€€€€™¥•±‘Í}½‰Í•ÉÙ•€ôQÉÕ”(€€€É•ÑÕÉ¸ì‰É•ÅÕ•ÍÑ%ˆèÍÁ•l‰É•ÅÕ•ÍÑ%‰t°€‰…Í•%ˆèÍÁ•l‰…Í•%‰t°€‰Íåµ‰½°ˆèÍÁ•l‰Íåµ‰½°‰t°€‰­¥¹ˆèÍÁ•l‰­¥¹‰t°€‰Á…Ñ¡¹‘EÕ•ÉäˆèÍÁ•l‰Á…Ñ¡¹‘EÕ•Éä‰t°€‰¡ÑÑÁMÑ…ÑÕÌˆèÍÑ…ÑÕÌ°€‰½¹Ñ•¹ÑQåÁ”ˆè½¹Ñ•¹Ñ}ÑåÁ”°€‰É•ÍÁ½¹Í•	åÑ•Ìˆè±•¸¡É…Ü¤°€‰É•ÍÁ½¹Í•I…İM¡„ÈÔØˆèÍ¡„¡É…Ü¤°€‰É•ÍÁ½¹Í•	½‘å	…Í”ØĞˆè‰…Í”ØĞ¹ˆØÑ•¹½‘”¡É…Ü¤¹‘•½‘” ‰…Í¥¤ˆ¤°€‰É•ÅÕ¥É•‘½‘¥•±‘M•Ñ=‰Í•ÉÙ•ˆè™¥•±‘Í}½‰Í•ÉÙ•‘ô(()‘•˜‘•Ñ•Éµ¥¹¥ÍÑ¥}é¥À¡É…Üè‰åÑ•Ì¤€´ø‰åÑ•Ìè(€€€¥µÁ½ÉĞ¥¼(€€€‰Õ™™•È€ô¥¼¹	åÑ•Í%< ¤(€€€İ¥Ñ é¥À¹é¥Á¥±”¡™¥±•¹…µ”ôˆˆ°µ½‘”ô‰İˆˆ°™¥±•½‰¨õ‰Õ™™•È°½µÁÉ•ÍÍ±•Ù•°ôä°µÑ¥µ”ôÀ¤…ÌÍÑÉ•…´è(€€€€€€€ÍÑÉ•…´¹İÉ¥Ñ”¡É…Ü¤(€€€É•ÑÕÉ¸‰Õ™™•È¹•ÑÙ…±Õ” ¤(()‘•˜İÉ¥Ñ•}¹•Ü¡Á…Ñ èA…Ñ °É…Üè‰åÑ•Ì¤€´ø9½¹”è(€€€™°Ñ•µÁ}¹…µ”€ôÑ•µÁ™¥±”¹µ­ÍÑ•µÀ¡ÁÉ•™¥àôˆ¹Ñ¥¥¹¼µÁ¥±½Ğ´ˆ°ÍÕ™™¥àôˆ¹ÑµÀˆ°‘¥ÈõÁ…Ñ ¹Á…É•¹Ğ¤(€€€ÑÉäè(€€€€€€€İ¥Ñ ½Ì¹™‘½Á•¸¡™°€‰İˆˆ¤…Ì¡…¹‘±”è(€€€€€€€€€€€¡…¹‘±”¹İÉ¥Ñ”¡É…Ü¤(€€€€€€€€€€€¡…¹‘±”¹™±ÕÍ  ¤(€€€€€€€€€€€½Ì¹™Íå¹Œ¡¡…¹‘±”¹™¥±•¹¼ ¤¤(€€€€€€€½Ì¹±¥¹¬¡Ñ•µÁ}¹…µ”°Á…Ñ ¤(€€€™¥¹…±±äè(€€€€€€€ÑÉäè(€€€€€€€€€€€½Ì¹Õ¹±¥¹¬¡Ñ•µÁ}¹…µ”¤(€€€€€€€•á•ÁĞ¥±•9½Ñ½Õ¹‘ÉÉ½Èè(€€€€€€€€€€€Á…ÍÌ(()‘•˜Ù…±¥‘…Ñ•}ÁÉ¥Ù…Ñ•}…ÁÑÕÉ”¡…ÁÑÕÉ”è‘¥ÑmÍÑÈ°¹åt°½¹ÑÉ…Ğè‘¥ÑmÍÑÈ°¹åt°ÕÉÉ•¹Ğè‘¥ÑmÍÑÈ°¹åt¤€´ø‘¥ÑmÍÑÈ°¹åtè(€€€•á…Ñ}­•åÌ¡…ÁÑÕÉ”°ì‰Í¡•µ„ˆ°€‰…ÁÑÕÉ•‘Ğˆ°€‰½¹ÑÉ…ÑI…İM¡„ÈÔØˆ°€‰½¹ÑÉ…ÑM¡„ÈÔØˆ°€‰¥µÁ±•µ•¹Ñ…Ñ¥½¸ˆ°€‰…½Õ¹ÑÙ¥‘•¹”ˆ°€‰É•ÍÁ½¹Í•Ìˆ°€‰ÅÕ…±¥™¥…Ñ¥½¸ˆ°€‰±…¥µ1½­Ìˆ°€‰É•ÑÕÉ¹Í½µÁÕÑ•ˆ°€‰½ÕÑ½µ•Í•ÍÍ•ˆ°€‰…ÁÑÕÉ•M¡„ÈÔØ‰ô°€‰ÁÉ¥Ù…Ñ”…ÁÑÕÉ”ˆ¤(€€€¥˜…ÁÑÕÉ•l‰Í¡•µ„‰t€„ô€‰Ñ¥¥¹¼µÍÑ…ÉÑ•Èµ•½µÑ¡É•”µ…Í”µÁÉ¥Ù…Ñ”µ…ÁÑÕÉ”½ØÄˆ½È…ÁÑÕÉ•l‰½¹ÑÉ…ÑI…İM¡„ÈÔØ‰t€„ô=9QIQ}I\½È…ÁÑÕÉ•l‰½¹ÑÉ…ÑM¡„ÈÔØ‰t€„ô=9QIQ}M1è(€€€€€€€™…¥° ‰ÁÉ¥Ù…Ñ”…ÁÑÕÉ”¥‘•¹Ñ¥Ñä¡…¹•ˆ¤(€€€Á…ÉÍ•}éÕ±Ô¡…ÁÑÕÉ•l‰…ÁÑÕÉ•‘Ğ‰t¤(€€€¥µÁ±•µ•¹Ñ…Ñ¥½¸€ô…ÁÑÕÉ•l‰¥µÁ±•µ•¹Ñ…Ñ¥½¸‰t(€€€•á…Ñ}­•åÌ¡¥µÁ±•µ•¹Ñ…Ñ¥½¸°ì‰Á¡…Í”ˆ°€‰¡•…ˆ°€‰¥¹ÑÉ½‘ÕÑ¥½¹½µµ¥Ğˆ°€‰É•µ½Ñ•Y•É¥™¥•‰ô°€‰ÁÉ¥Ù…Ñ”¥µÁ±•µ•¹Ñ…Ñ¥½¸ˆ¤(€€€¥˜¥µÁ±•µ•¹Ñ…Ñ¥½¹l‰Á¡…Í”‰t€„ô€‰A=MQ}%9QI=UQ%=8ˆ½È¥µÁ±•µ•¹Ñ…Ñ¥½¹l‰É•µ½Ñ•Y•É¥™¥•‰t¥Ì¹½ĞQÉÕ”½È¥µÁ±•µ•¹Ñ…Ñ¥½¹l‰¥¹ÑÉ½‘ÕÑ¥½¹½µµ¥Ğ‰t€„ôÕÉÉ•¹Ñl‰¥¹ÑÉ½‘ÕÑ¥½¹½µµ¥Ğ‰tè(€€€€€€€™…¥° ‰ÁÉ¥Ù…Ñ”…ÁÑÕÉ”¥µÁ±•µ•¹Ñ…Ñ¥½¸‰¥¹‘¥¹œ¡…¹•ˆ¤(€€€…ÁÑÕÉ•‘}¡•…€ô¥µÁ±•µ•¹Ñ…Ñ¥½¹l‰¡•…‰t(€€€¥˜¹½Ğ¥Í¥¹ÍÑ…¹”¡…ÁÑÕÉ•‘}¡•…°ÍÑÈ¤½È¹½ĞÉ”¹™Õ±±µ…Ñ ¡È‰lÀ´å„µ™uìĞÁôˆ°…ÁÑÕÉ•‘}¡•…¤è(€€€€€€€™…¥° ‰ÁÉ¥Ù…Ñ”…ÁÑÕÉ”¡•…¡…¹•ˆ¤(€€€¥˜¥Ğ ‰µ•É”µ‰…Í”ˆ°€ˆ´µ¥Ìµ…¹•ÍÑ½Èˆ°¥µÁ±•µ•¹Ñ…Ñ¥½¹l‰¥¹ÑÉ½‘ÕÑ¥½¹½µµ¥Ğ‰t°…ÁÑÕÉ•‘}¡•…¤€„ô€ˆˆ½È¥Ğ ‰µ•É”µ‰…Í”ˆ°€ˆ´µ¥Ìµ…¹•ÍÑ½Èˆ°…ÁÑÕÉ•‘}¡•…°ÕÉÉ•¹Ñl‰¡•…‰t¤€„ô€ˆˆè(€€€€€€€™…¥° ‰ÁÉ¥Ù…Ñ”…ÁÑÕÉ”¥Ì½ÕÑÍ¥‘”Ñ¡”Ù•É¥™¥•±¥¹•…È¡¥ÍÑ½Éäˆ¤(€€€…½Õ¹Ğ€ô…ÁÑÕÉ•l‰…½Õ¹ÑÙ¥‘•¹”‰t(€€€•á…Ñ}­•åÌ¡…½Õ¹Ğ°ì‰Ñ¥•ÉÑÑ•ÍÑ•ˆ°€‰µ½¹Ñ¡±å••UÍ‘ÑÑ•ÍÑ•ˆ°€‰Á…åµ•¹Ñ•Ñ…¥±Í‰Í•¹ÑÑÑ•ÍÑ•ˆ°€‰ÑÉ¥…±‰Í•¹ÑÑÑ•ÍÑ•ˆ°€‰É•‘•¹Ñ¥…±MÑ½É”ˆ°€‰É•‘•¹Ñ¥…±Q…É•Ğˆ°€‰É•‘•¹Ñ¥…±	½Õ¹ˆ°€‰Ñ½­•¹…ÁÑÕÉ•‰ô°€‰…½Õ¹ÑÙ¥‘•¹”ˆ¤(€€€¥˜…½Õ¹Ğ€„ôì‰Ñ¥•ÉÑÑ•ÍÑ•ˆè€‰MQIQHˆ°€‰µ½¹Ñ¡±å••UÍ‘ÑÑ•ÍÑ•ˆè€À°€‰Á…åµ•¹Ñ•Ñ…¥±Í‰Í•¹ÑÑÑ•ÍÑ•ˆèQÉÕ”°€‰ÑÉ¥…±‰Í•¹ÑÑÑ•ÍÑ•ˆèQÉÕ”°€‰É•‘•¹Ñ¥…±MÑ½É”ˆè€‰]%9=]M}I9Q%1}59Hˆ°€‰É•‘•¹Ñ¥…±Q…É•ĞˆèI9Q%1}QIP°€‰É•‘•¹Ñ¥…±	½Õ¹ˆèQÉÕ”°€‰Ñ½­•¹…ÁÑÕÉ•ˆè…±Í•ôè(€€€€€€€™…¥° ‰ÁÉ¥Ù…Ñ”…ÁÑÕÉ”…½Õ¹Ğ•Ù¥‘•¹”¡…¹•ˆ¤(€€€É•ÍÁ½¹Í•Ì€ô…ÁÑÕÉ•l‰É•ÍÁ½¹Í•Ì‰t(€€€¥˜¹½Ğ¥Í¥¹ÍÑ…¹”¡É•ÍÁ½¹Í•Ì°±¥ÍĞ¤½È±•¸¡É•ÍÁ½¹Í•Ì¤€„ô±•¸¡IEUMQL¤è(€€€€€€€™…¥° ‰ÁÉ¥Ù…Ñ”…ÁÑÕÉ”É•ÍÁ½¹Í”½Õ¹Ğ¡…¹•ˆ¤(€€€É•ÅÕ¥É•‘}Í•ÑÌ€ô€À(€€€ÍÕ•ÍÍ™Õ°€ô€À(€€€µ¥ÍÍ¥¹œ€ô€À(€€€É•ÍÁ½¹Í•}­•åÌ€ôì‰É•ÅÕ•ÍÑ%ˆ°€‰…Í•%ˆ°€‰Íåµ‰½°ˆ°€‰­¥¹ˆ°€‰Á…Ñ¡¹‘EÕ•Éäˆ°€‰¡ÑÑÁMÑ…ÑÕÌˆ°€‰½¹Ñ•¹ÑQåÁ”ˆ°€‰É•ÍÁ½¹Í•	åÑ•Ìˆ°€‰É•ÍÁ½¹Í•I…İM¡„ÈÔØˆ°€‰É•ÍÁ½¹Í•	½‘å	…Í”ØĞˆ°€‰É•ÅÕ¥É•‘½‘¥•±‘M•Ñ=‰Í•ÉÙ•‰ô(€€€™½ÈÉ½Ü°ÍÁ•Œ¥¸é¥À¡É•ÍÁ½¹Í•Ì°IEUMQL¤è(€€€€€€€•á…Ñ}­•åÌ¡É½Ü°É•ÍÁ½¹Í•}­•åÌ°€‰ÁÉ¥Ù…Ñ”É•ÍÁ½¹Í”ˆ¤(€€€€€€€™½È­•ä¥¸€ ‰É•ÅÕ•ÍÑ%ˆ°€‰…Í•%ˆ°€‰Íåµ‰½°ˆ°€‰­¥¹ˆ°€‰Á…Ñ¡¹‘EÕ•Éäˆ¤è(€€€€€€€€€€€¥˜É½İm­•åt€„ôÍÁ•m­•åtè(€€€€€€€€€€€€€€€™…¥° ‰ÁÉ¥Ù…Ñ”É•ÍÁ½¹Í”É•ÅÕ•ÍĞ‰¥¹‘¥¹œ¡…¹•ˆ¤(€€€€€€€¥˜É½İl‰¡ÑÑÁMÑ…ÑÕÌ‰t¹½Ğ¥¸ÍÁ•l‰…±±½İ•‘!ÑÑÁMÑ…ÑÕÍ•Ì‰tè(€€€€€€€€€€€™…¥° ‰ÁÉ¥Ù…Ñ”É•ÍÁ½¹Í”ÍÑ…ÑÕÌ¡…¹•ˆ¤(€€€€€€€ÑÉäè(€€€€€€€€€€€É…Ü€ô‰…Í”ØĞ¹ˆØÑ‘•½‘”¡É½İl‰É•ÍÁ½¹Í•	½‘å	…Í”ØĞ‰t°Ù…±¥‘…Ñ”õQÉÕ”¤(€€€€€€€•á•ÁĞá•ÁÑ¥½¸è(€€€€€€€€€€€™…¥° ‰ÁÉ¥Ù…Ñ”É•ÍÁ½¹Í”‰…Í”ØĞ¡…¹•ˆ¤(€€€€€€€¥˜±•¸¡É…Ü¤€„ôÉ½İl‰É•ÍÁ½¹Í•	åÑ•Ì‰t½ÈÍ¡„¡É…Ü¤€„ôÉ½İl‰É•ÍÁ½¹Í•I…İM¡„ÈÔØ‰t½È±•¸¡É…Ü¤€ø€àÌààØÀàè(€€€€€€€€€€€™…¥° ‰ÁÉ¥Ù…Ñ”É•ÍÁ½¹Í”É…Ü‰¥¹‘¥¹œ¡…¹•ˆ¤(€€€€€€€½‰Í•ÉÙ•€ô…±Í”(€€€€€€€¥˜É½İl‰¡ÑÑÁMÑ…ÑÕÌ‰t€ôô€ÈÀÀè(€€€€€€€€€€€ÍÕ•ÍÍ™Õ°€¬ô€Ä(€€€€€€€€€€€¥˜É½İl‰½¹Ñ•¹ÑQåÁ”‰t€„ô€‰…ÁÁ±¥…Ñ¥½¸½©Í½¸ˆè(€€€€€€€€€€€€€€€™…¥° ‰ÁÉ¥Ù…Ñ”É•ÍÁ½¹Í”½¹Ñ•¹ĞÑåÁ”¡…¹•ˆ¤(€€€€€€€€€€€ÑÉäè(€€€€€€€€€€€€€€€Á…ÉÍ•€ô©Í½¸¹±½…‘Ì¡É…Ü¹‘•½‘” ‰ÕÑ˜´àˆ¤¤(€€€€€€€€€€€•á•ÁĞá•ÁÑ¥½¸è(€€€€€€€€€€€€€€€™…¥° ‰ÁÉ¥Ù…Ñ”É•ÍÁ½¹Í”)M=8¡…¹•ˆ¤(€€€€€€€€€€€¥˜ÍÁ•l‰­¥¹‰t€ôô€‰5QQˆè(€€€€€€€€€€€€€€€¥˜¹½Ğ¥Í¥¹ÍÑ…¹”¡Á…ÉÍ•°‘¥Ğ¤è(€€€€€€€€€€€€€€€€€€€™…¥° ‰ÁÉ¥Ù…Ñ”µ•Ñ…‘…Ñ„É•ÍÁ½¹Í”Í¡…Á”¡…¹•ˆ¤(€€€€€€€€€€€•±Í”è(€€€€€€€€€€€€€€€¥˜¹½Ğ¥Í¥¹ÍÑ…¹”¡Á…ÉÍ•°±¥ÍĞ¤½È¹½ĞÁ…ÉÍ•½È…¹ä¡¹½Ğ¥Í¥¹ÍÑ…¹”¡¥Ñ•´°‘¥Ğ¤½È¹½ĞÍ•Ğ¡IEU%I}=}%1L¤¹¥ÍÍÕ‰Í•Ğ¡¥Ñ•´¤™½È¥Ñ•´¥¸Á…ÉÍ•¤è(€€€€€€€€€€€€€€€€€€€™…¥° ‰ÁÉ¥Ù…Ñ”=™¥•±Í•Ğ¡…¹•ˆ¤(€€€€€€€€€€€€€€€½‰Í•ÉÙ•€ôQÉÕ”(€€€€€€€€€€€€€€€É•ÅÕ¥É•‘}Í•ÑÌ€¬ô€Ä(€€€€€€€•±Í”è(€€€€€€€€€€€µ¥ÍÍ¥¹œ€¬ô€Ä(€€€€€€€¥˜É½İl‰É•ÅÕ¥É•‘½‘¥•±‘M•Ñ=‰Í•ÉÙ•‰t¥Ì¹½Ğ½‰Í•ÉÙ•è(€€€€€€€€€€€™…¥° ‰ÁÉ¥Ù…Ñ”=™¥•±½‰Í•ÉÙ…Ñ¥½¸¡…¹•ˆ¤(€€€ÅÕ…±¥™¥…Ñ¥½¸€ô…ÁÑÕÉ•l‰ÅÕ…±¥™¥…Ñ¥½¸‰t(€€€•á…Ñ}­•åÌ¡ÅÕ…±¥™¥…Ñ¥½¸°ì‰…Í•½Õ¹Ğˆ°€‰É•ÅÕ•ÍÑ½Õ¹Ğˆ°€‰ÍÕ•ÍÍ™Õ±I•ÍÁ½¹Í•½Õ¹Ğˆ°€‰¹½Ñ½Õ¹‘I•ÍÁ½¹Í•½Õ¹Ğˆ°€‰É•ÅÕ¥É•‘½‘¥•±‘M•ÑÍ=‰Í•ÉÙ•ˆ°€‰ÁÉ½Ù¥‘•ÉI½İÍI•µ…¥¹AÉ¥Ù…Ñ”ˆ°€‰ÍÑÕ‘åÉ•‘¥Ğ‰ô°€‰ÅÕ…±¥™¥…Ñ¥½¸ˆ¤(€€€¥˜ÅÕ…±¥™¥…Ñ¥½¸€„ôì‰…Í•½Õ¹Ğˆè€Ì°€‰É•ÅÕ•ÍÑ½Õ¹Ğˆè€Ø°€‰ÍÕ•ÍÍ™Õ±I•ÍÁ½¹Í•½Õ¹ĞˆèÍÕ•ÍÍ™Õ°°€‰¹½Ñ½Õ¹‘I•ÍÁ½¹Í•½Õ¹Ğˆèµ¥ÍÍ¥¹œ°€‰É•ÅÕ¥É•‘½‘¥•±‘M•ÑÍ=‰Í•ÉÙ•ˆèÉ•ÅÕ¥É•‘}Í•ÑÌ°€‰ÁÉ½Ù¥‘•ÉI½İÍI•µ…¥¹AÉ¥Ù…Ñ”ˆèQÉÕ”°€‰ÍÑÕ‘åÉ•‘¥Ğˆè€‰9=9‰ôè(€€€€€€€™…¥° ‰ÁÉ¥Ù…Ñ”ÅÕ…±¥™¥…Ñ¥½¸¡…¹•ˆ¤(€€€¥˜…ÁÑÕÉ•l‰±…¥µ1½­Ì‰t€„ô½¹ÑÉ…Ñl‰±…¥µ1½­Ì‰t½È…ÁÑÕÉ•l‰É•ÑÕÉ¹Í½µÁÕÑ•‰t¥Ì¹½Ğ…±Í”½È…ÁÑÕÉ•l‰½ÕÑ½µ•Í•ÍÍ•‰t¥Ì¹½Ğ…±Í”è(€€€€€€€™…¥° ‰ÁÉ¥Ù…Ñ”…ÁÑÕÉ”±…¥´±½¬¡…¹•ˆ¤(€€€½µÁÕÑ•€ôÍ¡„¡…¹½¹¥…°¡í­•äè¥Ñ•´™½È­•ä°¥Ñ•´¥¸…ÁÑÕÉ”¹¥Ñ•µÌ ¤¥˜­•ä€„ô€‰…ÁÑÕÉ•M¡„ÈÔØ‰ô¤¤(€€€¥˜…ÁÑÕÉ•l‰…ÁÑÕÉ•M¡„ÈÔØ‰t€„ô½µÁÕÑ•è(€€€€€€€™…¥° ‰ÁÉ¥Ù…Ñ”…ÁÑÕÉ”Í•±˜¡…Í ¡…¹•ˆ¤(€€€É•ÑÕÉ¸ì‰ÍÕ•ÍÍ™Õ±I•ÍÁ½¹Í•½Õ¹ĞˆèÍÕ•ÍÍ™Õ°°€‰¹½Ñ½Õ¹‘I•ÍÁ½¹Í•½Õ¹Ğˆèµ¥ÍÍ¥¹œ°€‰É•ÅÕ¥É•‘½‘¥•±‘M•ÑÍ=‰Í•ÉÙ•ˆèÉ•ÅÕ¥É•‘}Í•ÑÍô(()‘•˜Ù•É¥™å}ÁÉ¥Ù…Ñ”¡ÁÉ¥Ù…Ñ•}É½½ĞèÍÑÈ¤€´ø‘¥ÑmÍÑÈ°¹åtè(€€€½¹ÑÉ…Ğ€ô±½…‘}½¹ÑÉ…Ğ ¤(€€€ÕÉÉ•¹Ğ€ôÙ•É¥™å}É•µ½Ñ”¡É•ÅÕ¥É•}Á½ÍĞõQÉÕ”¤(€€€½ÕÑÁÕĞ€ôÉ•Í½±Ù•}ÁÉ¥Ù…Ñ•}É½½Ğ¡ÁÉ¥Ù…Ñ•}É½½Ğ¤€¼=UQAUQ}95(€€€¥˜¹½Ğ½ÕÑÁÕĞ¹•á¥ÍÑÌ ¤½È¹½Ğ½ÕÑÁÕĞ¹¥Í}™¥±” ¤è(€€€€€€€™…¥° ‰ÁÉ¥Ù…Ñ”…ÁÑÕÉ”¥Ì…‰Í•¹Ğˆ¤(€€€è€ô½ÕÑÁÕĞ¹É•…‘}‰åÑ•Ì ¤(€€€ÑÉäè(€€€€€€€É…Ü€ôé¥À¹‘•½µÁÉ•ÍÌ¡è¤(€€€•á•ÁĞá•ÁÑ¥½¸è(€€€€€€€™…¥° ‰ÁÉ¥Ù…Ñ”…ÁÑÕÉ”é¥À¡…¹•ˆ¤(€€€¥˜‘•Ñ•Éµ¥¹¥ÍÑ¥}é¥À¡É…Ü¤€„ôè½È¹½ĞÉ…Ü¹•¹‘Íİ¥Ñ ¡ˆ‰q¸ˆ¤è(€€€€€€€™…¥° ‰ÁÉ¥Ù…Ñ”…ÁÑÕÉ”‘•Ñ•Éµ¥¹¥ÍÑ¥Œé¥À¡…¹•ˆ¤(€€€ÑÉäè(€€€€€€€…ÁÑÕÉ”€ô©Í½¸¹±½…‘Ì¡É…Ü¤(€€€•á•ÁĞá•ÁÑ¥½¸è(€€€€€€€™…¥° ‰ÁÉ¥Ù…Ñ”…ÁÑÕÉ”)M=8¡…¹•ˆ¤(€€€½Õ¹ÑÌ€ôÙ…±¥‘…Ñ•}ÁÉ¥Ù…Ñ•}…ÁÑÕÉ”¡…ÁÑÕÉ”°½¹ÑÉ…Ğ°ÕÉÉ•¹Ğ¤(€€€É•ÑÕÉ¸ì‰ÍÑ…ÑÕÌˆè€‰AMM}AI%YQ}AQUI}YI%%ˆ°€‰…ÁÑÕÉ•I…İM¡„ÈÔØˆèÍ¡„¡É…Ü¤°€‰…ÁÑÕÉ•é¥ÁM¡„ÈÔØˆèÍ¡„¡è¤°€‰É•ÅÕ•ÍÑ½Õ¹Ğˆè€Ø°€¨©½Õ¹ÑÌ°€‰ÍÑÕ‘åÉ•‘¥Ğˆè€‰9=9ˆ°€‰ÁÉ¥Ù…Ñ•AÉ½Ù¥‘•ÉAÉ¥•I½İÍ•ÍÍ•ˆèQÉÕ”°€‰É•ÑÕÉ¹Í½µÁÕÑ•ˆè…±Í”°€‰½ÕÑ½µ•Í•ÍÍ•ˆè…±Í•ô(()‘•˜•á•ÕÑ”¡ÁÉ¥Ù…Ñ•}É½½ĞèÍÑÈ°…ÑÑ•ÍÑ•è‰½½°¤€´ø‘¥ÑmÍÑÈ°¹åtè(€€€½¹ÑÉ…Ğ€ô±½…‘}½¹ÑÉ…Ğ ¤(€€€¥˜¹½Ğ…ÑÑ•ÍÑ•è(€€€€€€€™…¥° ‰•áÁ±¥¥Ğé•É¼µ½ÍĞMÑ…ÉÑ•È…ÑÑ•ÍÑ…Ñ¥½¸¥ÌÉ•ÅÕ¥É•ˆ¤(€€€É•µ½Ñ”€ôÙ•É¥™å}É•µ½Ñ”¡É•ÅÕ¥É•}Á½ÍĞõQÉÕ”¤(€€€½ÕÑÁÕĞ€ôÁÉ¥Ù…Ñ•}½ÕÑÁÕÑ}Á…Ñ ¡ÁÉ¥Ù…Ñ•}É½½Ğ¤(€€€Ñ½­•¸€ôÉ•…‘}Ñ½­•¸ ¤(€€€ÑÉäè(€€€€€€€É•ÍÁ½¹Í•Ì€ôm™•Ñ¡}½¹”¡ÍÁ•Œ°Ñ½­•¸¤™½ÈÍÁ•Œ¥¸IEUMQMt(€€€™¥¹…±±äè(€€€€€€€Ñ½­•¸€ô€ˆˆ(€€€¥˜mÉ½İl‰É•ÅÕ•ÍÑ%‰t™½ÈÉ½Ü¥¸É•ÍÁ½¹Í•Ít€„ômÉ½İl‰É•ÅÕ•ÍÑ%‰t™½ÈÉ½Ü¥¸IEUMQMtè(€€€€€€€™…¥° ‰É•ÅÕ•ÍĞ½É‘•È¡…¹•ˆ¤(€€€…ÁÑÕÉ”€ôì‰Í¡•µ„ˆè€‰Ñ¥¥¹¼µÍÑ…ÉÑ•Èµ•½µÑ¡É•”µ…Í”µÁÉ¥Ù…Ñ”µ…ÁÑÕÉ”½ØÄˆ°€‰…ÁÑÕÉ•‘Ğˆè}}¥µÁ½ÉÑ}| ‰‘…Ñ•Ñ¥µ”ˆ¤¹‘…Ñ•Ñ¥µ”¹¹½Ü¡}}¥µÁ½ÉÑ}| ‰‘…Ñ•Ñ¥µ”ˆ¤¹Ñ¥µ•é½¹”¹ÕÑŒ¤¹ÍÑÉ™Ñ¥µ” ˆ•d´•´´•‘P• è•4è•Mhˆ¤°€‰½¹ÑÉ…ÑI…İM¡„ÈÔØˆè=9QIQ}I\°€‰½¹ÑÉ…ÑM¡„ÈÔØˆè=9QIQ}M1°€‰¥µÁ±•µ•¹Ñ…Ñ¥½¸ˆèÉ•µ½Ñ”°€‰…½Õ¹ÑÙ¥‘•¹”ˆèì‰Ñ¥•ÉÑÑ•ÍÑ•ˆè€‰MQIQHˆ°€‰µ½¹Ñ¡±å••UÍ‘ÑÑ•ÍÑ•ˆè€À°€‰Á…åµ•¹Ñ•Ñ…¥±Í‰Í•¹ÑÑÑ•ÍÑ•ˆèQÉÕ”°€‰ÑÉ¥…±‰Í•¹ÑÑÑ•ÍÑ•ˆèQÉÕ”°€‰É•‘•¹Ñ¥…±MÑ½É”ˆè€‰]%9=]M}I9Q%1}59Hˆ°€‰É•‘•¹Ñ¥…±Q…É•ĞˆèI9Q%1}QIP°€‰É•‘•¹Ñ¥…±	½Õ¹ˆèQÉÕ”°€‰Ñ½­•¹…ÁÑÕÉ•ˆè…±Í•ô°€‰É•ÍÁ½¹Í•ÌˆèÉ•ÍÁ½¹Í•Ì°€‰ÅÕ…±¥™¥…Ñ¥½¸ˆèì‰…Í•½Õ¹Ğˆè€Ì°€‰É•ÅÕ•ÍÑ½Õ¹Ğˆè€Ø°€‰ÍÕ•ÍÍ™Õ±I•ÍÁ½¹Í•½Õ¹ĞˆèÍÕ´¡É½İl‰¡ÑÑÁMÑ…ÑÕÌ‰t€ôô€ÈÀÀ™½ÈÉ½Ü¥¸É•ÍÁ½¹Í•Ì¤°€‰¹½Ñ½Õ¹‘I•ÍÁ½¹Í•½Õ¹ĞˆèÍÕ´¡É½İl‰¡ÑÑÁMÑ…ÑÕÌ‰t€ôô€ĞÀĞ™½ÈÉ½Ü¥¸É•ÍÁ½¹Í•Ì¤°€‰É•ÅÕ¥É•‘½‘¥•±‘M•ÑÍ=‰Í•ÉÙ•ˆèÍÕ´¡É½İl‰É•ÅÕ¥É•‘½‘¥•±‘M•Ñ=‰Í•ÉÙ•‰t™½ÈÉ½Ü¥¸É•ÍÁ½¹Í•Ì¤°€‰ÁÉ½Ù¥‘•ÉI½İÍI•µ…¥¹AÉ¥Ù…Ñ”ˆèQÉÕ”°€‰ÍÑÕ‘åÉ•‘¥Ğˆè€‰9=9‰ô°€‰±…¥µ1½­Ìˆè½¹ÑÉ…Ñl‰±…¥µ1½­Ì‰t°€‰É•ÑÕÉ¹Í½µÁÕÑ•ˆè…±Í”°€‰½ÕÑ½µ•Í•ÍÍ•ˆè…±Í•ô(€€€…ÁÑÕÉ•l‰…ÁÑÕÉ•M¡„ÈÔØ‰t€ôÍ¡„¡…¹½¹¥…°¡…ÁÑÕÉ”¤¤(€€€É…Ü€ô…¹½¹¥…°¡…ÁÑÕÉ”¤€¬ˆ‰q¸ˆ(€€€è€ô‘•Ñ•Éµ¥¹¥ÍÑ¥}é¥À¡É…Ü¤(€€€İÉ¥Ñ•}¹•Ü¡½ÕÑÁÕĞ°è¤(€€€…™Ñ•È€ôÙ•É¥™å}É•µ½Ñ”¡É•ÅÕ¥É•}Á½ÍĞõQÉÕ”¤(€€€¥˜…™Ñ•È€„ôÉ•µ½Ñ”½È½ÕÑÁÕĞ¹É•…‘}‰åÑ•Ì ¤€„ôèè(€€€€€€€™…¥° ‰Á½ÍĞµ…ÁÑÕÉ”Ù•É¥™¥…Ñ¥½¸¡…¹•ˆ¤(€€€É•ÑÕÉ¸ì‰ÍÑ…ÑÕÌˆè€‰AMM}AI%YQ}AQUI}5QI%1%iˆ°€‰…ÁÑÕÉ•I…İM¡„ÈÔØˆèÍ¡„¡É…Ü¤°€‰…ÁÑÕÉ•é¥ÁM¡„ÈÔØˆèÍ¡„¡è¤°€‰É•ÅÕ•ÍÑ½Õ¹Ğˆè€Ø°€‰ÍÕ•ÍÍ™Õ±I•ÍÁ½¹Í•½Õ¹Ğˆè…ÁÑÕÉ•l‰ÅÕ…±¥™¥…Ñ¥½¸‰ul‰ÍÕ•ÍÍ™Õ±I•ÍÁ½¹Í•½Õ¹Ğ‰t°€‰¹½Ñ½Õ¹‘I•ÍÁ½¹Í•½Õ¹Ğˆè…ÁÑÕÉ•l‰ÅÕ…±¥™¥…Ñ¥½¸‰ul‰¹½Ñ½Õ¹‘I•ÍÁ½¹Í•½Õ¹Ğ‰t°€‰É•ÅÕ¥É•‘½‘¥•±‘M•ÑÍ=‰Í•ÉÙ•ˆè…ÁÑÕÉ•l‰ÅÕ…±¥™¥…Ñ¥½¸‰ul‰É•ÅÕ¥É•‘½‘¥•±‘M•ÑÍ=‰Í•ÉÙ•‰t°€‰ÍÑÕ‘åÉ•‘¥Ğˆè€‰9=9ˆ°€‰ÁÉ¥Ù…Ñ•AÉ½Ù¥‘•ÉAÉ¥•I½İÍ•ÍÍ•ˆèQÉÕ”°€‰É•ÑÕÉ¹Í½µÁÕÑ•ˆè…±Í”°€‰½ÕÑ½µ•Í•ÍÍ•ˆè…±Í•ô(()‘•˜É•©•Ñ•¡…Ñ¥½¸è…±±…‰±•mmt°¹åt¤€´ø‰½½°è(€€€ÑÉäè(€€€€€€€…Ñ¥½¸ ¤(€€€•á•ÁĞ€¡A¥±½ÑÉÉ½È°-•åÉÉ½È°QåÁ•ÉÉ½È°Y…±Õ•ÉÉ½È°=MÉÉ½È°©Í½¸¹)M=9•½‘•ÉÉ½È¤è(€€€€€€€É•ÑÕÉ¸QÉÕ”(€€€É•ÑÕÉ¸…±Í”(()‘•˜Í•±™}Ñ•ÍĞ ¤€´ø‘¥ÑmÍÑÈ°¹åtè(€€€Í½ÕÉ”€ô±½…‘}½¹ÑÉ…Ğ ¤(€€€µÕÑ…Ñ¥½¹Ìè±¥ÍÑmÑÕÁ±•mÍÑÈ°ÑÕÁ±•m¹ä°€¸¸¹t°¹åut€ôl(€€€€€€€€ ‰ÁÕÉÁ½Í•=Ù•É±…¥´ˆ°€ ‰ÁÕÉÁ½Í”ˆ°¤°€‰Õ±°Õ¹¥Ù•ÉÍ”ÁÉ¥”…¹½ÕÑ½µ”…ÅÕ¥Í¥Ñ¥½¸ˆ¤°(€€€€€€€€ ‰Á…¥‘Q¥•Èˆ°€ ‰…½Õ¹Ñ…Ñ”ˆ°€‰µ½¹Ñ¡±å••UÍˆ¤°€Ä¤°(€€€€€€€€ ‰Á…åµ•¹Ñ±±½İ•ˆ°€ ‰…½Õ¹Ñ…Ñ”ˆ°€‰Á…åµ•¹Ñ•Ñ…¥±Í±±½İ•ˆ¤°QÉÕ”¤°(€€€€€€€€ ‰ÑÉ¥…±±±½İ•ˆ°€ ‰…½Õ¹Ñ…Ñ”ˆ°€‰ÑÉ¥…±±±½İ•ˆ¤°QÉÕ”¤°(€€€€€€€€ ‰•¹Ù¥É½¹µ•¹ÑQ½­•¸ˆ°€ ‰…½Õ¹Ñ…Ñ”ˆ°€‰Ñ½­•¹%¹¹Ù¥É½¹µ•¹Ñ±±½İ•ˆ¤°QÉÕ”¤°(€€€€€€€€ ‰ÕÉ±Q½­•¸ˆ°€ ‰…½Õ¹Ñ…Ñ”ˆ°€‰Ñ½­•¹%¹UÉ±±±½İ•ˆ¤°QÉÕ”¤°(€€€€€€€€ ‰É•ÅÕ•ÍÑ1¥µ¥Ğˆ°€ ‰É•ÅÕ•ÍÑ½¹ÑÉ…Ğˆ°€‰µ…á¥µÕµI•ÅÕ•ÍÑÌˆ¤°€Ü¤°(€€€€€€€€ ‰ÁÉ•µ¥Õµ¹‘Á½¥¹Ğˆ°€ ‰É•ÅÕ•ÍÑ½¹ÑÉ…Ğˆ°€‰ÁÉ•µ¥Õµ¹‘Á½¥¹Ñ±±½İ•ˆ¤°QÉÕ”¤°(€€€€€€€€ ‰ÁÉ½áäˆ°€ ‰É•ÅÕ•ÍÑ½¹ÑÉ…Ğˆ°€‰•¹Ù¥É½¹µ•¹ÑAÉ½áåUÍ•±±½İ•ˆ¤°QÉÕ”¤°(€€€€€€€€ ‰É•ÑÉäˆ°€ ‰É•ÅÕ•ÍÑ½¹ÑÉ…Ğˆ°€‰É•ÑÉå±±½İ•ˆ¤°QÉÕ”¤°(€€€€€€€€ ‰ÁÕ‰±¥I½İÌˆ°€ ‰ÁÉ¥Ù…Ñ•…ÁÑÕÉ•½¹ÑÉ…Ğˆ°€‰ÁÕ‰±¥AÉ½Ù¥‘•ÉI½İÍ±±½İ•ˆ¤°QÉÕ”¤°(€€€€€€€€ ‰¥ÑAÉ¥Ù…Ñ•I½½Ğˆ°€ ‰ÁÉ¥Ù…Ñ•…ÁÑÕÉ•½¹ÑÉ…Ğˆ°€‰¥Ñ]½É­ÑÉ••=ÉI•Á½Í¥Ñ½ÉåA…Ñ¡±±½İ•ˆ¤°QÉÕ”¤°(€€€€€€€€ ‰Ñ¥­•É%‘•¹Ñ¥Ñäˆ°€ ‰ÅÕ…±¥™¥…Ñ¥½¹½¹ÑÉ…Ğˆ°€‰Ñ¥­•É=¹±å%‘•¹Ñ¥ÑåAÉ½µ½Ñ¥½¹±±½İ•ˆ¤°QÉÕ”¤°(€€€€€€€€ ‰Ñ•Éµ¥¹…±EÕ½Ñ”ˆ°€ ‰ÅÕ…±¥™¥…Ñ¥½¹½¹ÑÉ…Ğˆ°€‰±…ÍÑEÕ½Ñ•ÍQ•Éµ¥¹…±A…åµ•¹Ñ±±½İ•ˆ¤°QÉÕ”¤°(€€€€€€€€ ‰İ½ÉÑ¡±•ÍÌĞÀĞˆ°€ ‰ÅÕ…±¥™¥…Ñ¥½¹½¹ÑÉ…Ğˆ°€‰µ¥ÍÍ¥¹=ÈĞÀÑÍ]½ÉÑ¡±•ÍÍ±±½İ•ˆ¤°QÉÕ”¤°(€€€€€€€€ ‰™Õ±±U¹¥Ù•ÉÍ”ˆ°€ ‰ÅÕ…±¥™¥…Ñ¥½¹½¹ÑÉ…Ğˆ°€‰™Õ±±U¹¥Ù•ÉÍ•áÑÉ…Á½±…Ñ¥½¹±±½İ•ˆ¤°QÉÕ”¤°(€€€€€€€€ ‰ÍÑÕ‘åÉ•‘¥Ğˆ°€ ‰•á•ÕÑ¥½¹MÑ…Ñ”ˆ°€‰ÍÑÕ‘åÉ•‘¥Ğˆ¤°€‰U10ˆ¤°(€€€€€€€€ ‰½ÕÑ½µ•1½¬ˆ°€ ‰±…¥µ1½­Ìˆ°€‰½ÕÑ½µ•Í•ÍÍ•ˆ¤°QÉÕ”¤°(€€€€€€€€ ‰É•ÑÕÉ¹1½¬ˆ°€ ‰±…¥µ1½­Ìˆ°€‰É•ÑÕÉ¹Í½µÁÕÑ•ˆ¤°QÉÕ”¤°(€€€€€€€€ ‰ØÑÉ•‘¥Ğˆ°€ ‰±…¥µ1½­Ìˆ°€‰½É¥¥¹…±XÑ…Ñ•É•‘¥Ğˆ¤°QÉÕ”¤°(€€€€€€€€ ‰É•µ½Ñ•=ÁÑ¥½¹…°ˆ°€ ‰¥µÁ±•µ•¹Ñ…Ñ¥½¹½¹ÑÉ…Ğˆ°€‰É•µ½Ñ•Y•É¥™¥…Ñ¥½¹I•ÅÕ¥É•ˆ¤°…±Í”¤°(€€€€€€€€ ‰‰…Í•½Éİ…Éˆ°€ ‰¥µÁ±•µ•¹Ñ…Ñ¥½¹½¹ÑÉ…Ğˆ°€‰‰Õ¥±‘	…Í•½µµ¥Ğˆ¤°€‰˜ˆ€¨€ĞÀ¤°(€€€t(€€€­¥±±Ìè‘¥ÑmÍÑÈ°‰½½±t€ôíô(€€€™½È¹…µ”°Á…Ñ °É•Á±…•µ•¹Ğ¥¸µÕÑ…Ñ¥½¹Ìè(€€€€€€€¥Ñ•´€ô½Áä¹‘••Á½Áä¡Í½ÕÉ”¤(€€€€€€€ÕÉÍ½Èè¹ä€ô¥Ñ•´(€€€€€€€™½ÈÁ…ÉĞ¥¸Á…Ñ¡lè´Åtè(€€€€€€€€€€€ÕÉÍ½È€ôÕÉÍ½ÉmÁ…ÉÑt(€€€€€€€ÕÉÍ½ÉmÁ…Ñ¡l´Åut€ôÉ•Á±…•µ•¹Ğ(€€€€€€€­¥±±Ím¹…µ•t€ôÉ•©•Ñ•¡±…µ‰‘„¥Ñ•´õ¥Ñ•´èÙ…±¥‘…Ñ•}½¹ÑÉ…Ğ¡¥Ñ•´°‘•Á•¹‘•¹¥•Ìõ…±Í”¤¤(€€€¥Ñ•´€ô½Áä¹‘••Á½Áä¡Í½ÕÉ”¤(€€€¥Ñ•µl‰É•ÅÕ•ÍÑ½¹ÑÉ…Ğ‰ul‰É•ÅÕ•ÍÑÌ‰t¹Á½À ¤(€€€­¥±±Íl‰É•ÅÕ•ÍÑI•µ½Ù•‰t€ôÉ•©•Ñ•¡±…µ‰‘„èÙ…±¥‘…Ñ•}½¹ÑÉ…Ğ¡¥Ñ•´°‘•Á•¹‘•¹¥•Ìõ…±Í”¤¤(€€€¥Ñ•´€ô½Áä¹‘••Á½Áä¡Í½ÕÉ”¤(€€€¥Ñ•µl‰ÅÕ…±¥™¥…Ñ¥½¹½¹ÑÉ…Ğ‰ul‰É•ÅÕ¥É•‘½‘¥•±‘Ì‰t¹É•µ½Ù” ‰…‘©±½Í”ˆ¤(€€€­¥±±Íl‰…‘©ÕÍÑ•‘¥•±‘I•µ½Ù•‰t€ôÉ•©•Ñ•¡±…µ‰‘„èÙ…±¥‘…Ñ•}½¹ÑÉ…Ğ¡¥Ñ•´°‘•Á•¹‘•¹¥•Ìõ…±Í”¤¤(€€€¥Ñ•´€ô½Áä¹‘••Á½Áä¡Í½ÕÉ”¤(€€€¥Ñ•µl‰±…¥µ1½­Ì‰ul‰Õ¹­¹½İ¹É•‘¥Ğ‰t€ôQÉÕ”(€€€­¥±±Íl‰Õ¹­¹½İ¹É•‘¥Ñ-•ä‰t€ôÉ•©•Ñ•¡±…µ‰‘„èÙ…±¥‘…Ñ•}½¹ÑÉ…Ğ¡¥Ñ•´°‘•Á•¹‘•¹¥•Ìõ…±Í”¤¤(€€€¥˜¹½Ğ…±°¡­¥±±Ì¹Ù…±Õ•Ì ¤¤è(€€€€€€€™…¥° ‰Í•±˜µÑ•ÍĞµÕÑ…Ñ¥½¸ÍÕÉÙ¥Ù•ˆ¤(€€€É•ÑÕÉ¸ì‰ÍÑ…ÑÕÌˆè€‰AMLˆ°€‰µÕÑ…Ñ¥½¹-¥±±½Õ¹Ğˆè±•¸¡­¥±±Ì¤°€‰µÕÑ…Ñ¥½¹-¥±±Ìˆè­¥±±Ì°€‰¹•Ñİ½É­I•ÅÕ•ÍÑÌˆè€À°€‰™¥±•Í]É¥ÑÑ•¸ˆè€À°€‰ÁÉ¥•Í•ÍÍ•ˆè…±Í”°€‰É•ÑÕÉ¹Í½µÁÕÑ•ˆè…±Í”°€‰½ÕÑ½µ•Í•ÍÍ•ˆè…±Í•ô(()‘•˜µ…¥¸ ¤€´ø¥¹Ğè(€€€Á…ÉÍ•È€ô…ÉÁ…ÉÍ”¹ÉÕµ•¹ÑA…ÉÍ•È ¤(€€€ÍÕˆ€ôÁ…ÉÍ•È¹…‘‘}ÍÕ‰Á…ÉÍ•ÉÌ¡‘•ÍĞô‰½µµ…¹ˆ°É•ÅÕ¥É•õQÉÕ”¤(€€€Ù•É¥™å}Á…ÉÍ•È€ôÍÕˆ¹…‘‘}Á…ÉÍ•È ‰Ù•É¥™äˆ¤(€€€Ù•É¥™å}Á…ÉÍ•È¹…‘‘}…ÉÕµ•¹Ğ ˆ´µÉ•µ½Ñ”ˆ°…Ñ¥½¸ô‰ÍÑ½É•}ÑÉÕ”ˆ¤(€€€ÍÕˆ¹…‘‘}Á…ÉÍ•È ‰Í•±˜µÑ•ÍĞˆ¤(€€€ÉÕ¹}Á…ÉÍ•È€ôÍÕˆ¹…‘‘}Á…ÉÍ•È ‰ÉÕ¸ˆ¤(€€€ÉÕ¹}Á…ÉÍ•È¹…‘‘}…ÉÕµ•¹Ğ ˆ´µÉ•µ½Ñ”ˆ°…Ñ¥½¸ô‰ÍÑ½É•}ÑÉÕ”ˆ¤(€€€ÉÕ¹}Á…ÉÍ•È¹…‘‘}…ÉÕµ•¹Ğ ˆ´µÁÉ¥Ù…Ñ”µÉ½½Ğˆ°É•ÅÕ¥É•õQÉÕ”¤(€€€ÉÕ¹}Á…ÉÍ•È¹…‘‘}…ÉÕµ•¹Ğ ˆ´µ…ÑÑ•ÍĞµÍÑ…ÉÑ•Èµé•É¼µ½ÍĞˆ°…Ñ¥½¸ô‰ÍÑ½É•}ÑÉÕ”ˆ¤(€€€ÁÉ¥Ù…Ñ•}Á…ÉÍ•È€ôÍÕˆ¹…‘‘}Á…ÉÍ•È ‰Ù•É¥™äµÁÉ¥Ù…Ñ”ˆ¤(€€€ÁÉ¥Ù…Ñ•}Á…ÉÍ•È¹…‘‘}…ÉÕµ•¹Ğ ˆ´µÉ•µ½Ñ”ˆ°…Ñ¥½¸ô‰ÍÑ½É•}ÑÉÕ”ˆ¤(€€€ÁÉ¥Ù…Ñ•}Á…ÉÍ•È¹…‘‘}…ÉÕµ•¹Ğ ˆ´µÁÉ¥Ù…Ñ”µÉ½½Ğˆ°É•ÅÕ¥É•õQÉÕ”¤(€€€…ÉÌ€ôÁ…ÉÍ•È¹Á…ÉÍ•}…ÉÌ ¤(€€€ÑÉäè(€€€€€€€¥˜…ÉÌ¹½µµ…¹€ôô€‰Í•±˜µÑ•ÍĞˆè(€€€€€€€€€€€É•ÍÕ±Ğ€ôÍ•±™}Ñ•ÍĞ ¤(€€€€€€€•±¥˜…ÉÌ¹½µµ…¹€ôô€‰Ù•É¥™äˆè(€€€€€€€€€€€±½…‘}½¹ÑÉ…Ğ ¤(€€€€€€€€€€€¥˜¹½Ğ…ÉÌ¹É•µ½Ñ”è(€€€€€€€€€€€€€€€™…¥° ‰Ù•É¥™äÉ•ÅÕ¥É•Ì€´µÉ•µ½Ñ”ˆ¤(€€€€€€€€€€€É•ÍÕ±Ğ€ôì‰ÍÑ…ÑÕÌˆè€‰AMLˆ°€¨©Ù•É¥™å}É•µ½Ñ”¡É•ÅÕ¥É•}Á½ÍĞõ…±Í”¤°€‰Á¥±½Ñ5…åIÕ¹™Ñ•É½Õ¹Ñ…Ñ”ˆèQÉÕ”°€‰ÁÉ½‘ÕÑ¥½¹I•ÅÕ•ÍÑÍá•ÕÑ•ˆè…±Í”°€‰ÁÉ¥•Í•ÍÍ•ˆè…±Í”°€‰É•ÑÕÉ¹Í½µÁÕÑ•ˆè…±Í”°€‰½ÕÑ½µ•Í•ÍÍ•ˆè…±Í•ô(€€€€€€€•±¥˜…ÉÌ¹½µµ…¹€ôô€‰ÉÕ¸ˆè(€€€€€€€€€€€¥˜¹½Ğ…ÉÌ¹É•µ½Ñ”è(€€€€€€€€€€€€€€€™…¥° ‰ÉÕ¸É•ÅÕ¥É•Ì€´µÉ•µ½Ñ”ˆ¤(€€€€€€€€€€€É•ÍÕ±Ğ€ô•á•ÕÑ”¡…ÉÌ¹ÁÉ¥Ù…Ñ•}É½½Ğ°…ÉÌ¹…ÑÑ•ÍÑ}ÍÑ…ÉÑ•É}é•É½}½ÍĞ¤(€€€€€€€•±Í”è(€€€€€€€€€€€¥˜¹½Ğ…ÉÌ¹É•µ½Ñ”è(€€€€€€€€€€€€€€€™…¥° ‰Ù•É¥™äµÁÉ¥Ù…Ñ”É•ÅÕ¥É•Ì€´µÉ•µ½Ñ”ˆ¤(€€€€€€€€€€€É•ÍÕ±Ğ€ôÙ•É¥™å}ÁÉ¥Ù…Ñ”¡…ÉÌ¹ÁÉ¥Ù…Ñ•}É½½Ğ¤(€€€•á•ÁĞ€¡A¥±½ÑÉÉ½È°=MÉÉ½È°©Í½¸¹)M=9•½‘•ÉÉ½È°-•åÉÉ½È°QåÁ•ÉÉ½È°Y…±Õ•ÉÉ½È¤…Ì•áŒè(€€€€€€€Á…ÉÍ•È¹•ÉÉ½È¡ÍÑÈ¡•áŒ¤¤(€€€ÁÉ¥¹Ğ¡©Í½¸¹‘ÕµÁÌ¡É•ÍÕ±Ğ°Í½ÉÑ}­•åÌõQÉÕ”¤¤(€€€É•ÑÕÉ¸€À(()¥˜}}¹…µ•}|€ôô€‰}}µ…¥¹}|ˆè(€€€É…¥Í”MåÍÑ•µá¥Ğ¡µ…¥¸ ¤¤