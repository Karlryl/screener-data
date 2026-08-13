#!/usr/bin/env python3
"""Build and verify the outcome-blind Form-25 exchange-suspension boundary view."""

from __future__ import annotations

import argparse
import copy
import gzip
import hashlib
import json
import os
import re
import subprocess
import tempfile
from collections import Counter
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-form25-suspension-boundary-contract-v1.json"
BUILDER = Path(__file__).resolve()
TEST = ROOT / "tests" / "build-sec-form25-suspension-boundary-v1.test.js"
OUTPUT = ROOT / "reports" / "early-detection" / "sec-form25-suspension-boundary-v1.json"
SOURCE_GZIP = ROOT / "reports" / "early-detection" / "sec-form25-structured-metadata-v2.json.gz"
SOURCE_MANIFEST = ROOT / "reports" / "early-detection" / "sec-form25-structured-metadata-v2-gzip-manifest.json"
SOURCE_VERIFIER = ROOT / "scripts" / "verify-sec-form25-structured-metadata-v2-gzip.py"
SOURCE_TEST = ROOT / "tests" / "verify-sec-form25-structured-metadata-v2-gzip.test.js"
PARSER = ROOT / "scripts" / "build-sec-form25-structured-metadata-v1.py"
CORPUS = Path(r"C:\Users\Anwender\Documents\GrowthScreenerResearchData\early-detection-v4\corporate-action-originals\blobs\sha256")

CONTRACT_RAW = "4a72220de33987708d5a8d9b3e72dfeb4bba3a00733054de609b8b35ff736bed"
CONTRACT_SELF = "65c15407d53b2ab6f7b257868427601462cc06f935ff72e6a210c64dac12763c"
BASE_COMMIT = "de137118554621bbfb2556c69e226ef14ec110a8"
REMOTE_URL = "https://github.com/Karlryl/screener-data.git"
REMOTE_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
SOURCE_INTRODUCTION = "2205e9080a5101babd2016f4334a00abeeb12993"
SOURCE_GZIP_INTRODUCTION = "ea03e44d8ce805a08c4dc627caafc7080357b40f"
SOURCE_VERIFIER_INTRODUCTION = "6bdbee402f9feef281a5a36660d28a3664f0fde4"
PARSER_FIX_COMMIT = "9bd88bb08ce7e3b35d91bec9491f9614d61b3175"
PARSER_RAW = "52f78812a7547df4025dd8a48351f2364beb7285cc903bcb1a0df5fbe56d0025"
EXPECTED_PURPOSE = (
    "Materialize only primary-SEC statements of an exchange-trading suspension boundary for exact "
    "Form-25 queue rows, while refusing last-price, observed-last-consolidated-session, later-OTC-absence, "
    "completed-delisting, identity, terminal-wealth and Original-V4 credit claims."
)
EXPECTED_KIND = "PRIMARY_SEC_FORM25_EXCHANGE_TRADING_SUSPENSION_BOUNDARY_STATEMENT"
EXPECTED_CEILING = (
    "EXACT_SOURCE_ROW_AND_PRIMARY_SEC_SENTENCE_STATE_EXCHANGE_TRADING_WAS_SUSPENDED_ON_OR_AT_A_QUALIFIED_"
    "BOUNDARY_OF_THE_STATED_DATE"
)
EXPECTED_NOT_EVIDENCE = [
    "LAST_TRADE_PRICE",
    "OBSERVED_LAST_CONSOLIDATED_SESSION",
    "NO_LATER_OTC_TRADING",
    "COMPLETED_DELISTING_OR_REGISTRATION_TERMINATION",
    "SECURITY_IDENTITY_CONTINUITY",
    "TERMINAL_WEALTH",
]
EXPECTED_QUALIFIERS = {
    "DATE_ONLY_TIME_UNSPECIFIED": 12709,
    "AT_OPEN_OF_TRADING": 12,
    "AT_CLOSE_OF_TRADING_SESSION": 6,
}
EXPECTED_LOCKS = {
    "lastTradePriceObserved": False,
    "lastConsolidatedSessionObserved": False,
    "laterOtcTradingExcluded": False,
    "delistingCompletionVerified": False,
    "completeCorporateActionChainVerified": False,
    "identityResolved": False,
    "terminalWealthComplete": False,
    "originalV4GateCredit": False,
    "resultComputationAllowed": False,
    "pricesAccessed": False,
    "returnsAccessed": False,
    "outcomesAccessed": False,
}
EXPECTED_ROW_SCHEMA = [
    "boundaryId", "sourceRowId", "priorityRank", "accession", "filedDate", "form", "sourceBlob",
    "issuerCik", "issuerCikState", "issuerName", "issuerNameState", "exchangeName", "exchangeNameState",
    "securityDescription", "securityDescriptionState", "suspensionBoundaryDate",
    "suspensionTimingQualifier", "evidenceOccurrences", "evidenceKind", "lastTradePriceObserved",
    "lastConsolidatedSessionObserved", "laterOtcTradingExcluded", "delistingCompletionVerified",
    "identityResolved", "terminalWealthComplete", "outcomesAccessed",
]
ROW_KEYS = set(EXPECTED_ROW_SCHEMA)
SOURCE_REF_KEYS = {
    "blobSha256", "relativePath", "documentIndex", "documentType", "documentSequence", "documentFilename",
    "rawDocumentSha256", "rawTextSha256", "locatorKind", "locator", "normalizationMode", "evidenceSha256",
}
HEX64 = re.compile(r"[0-9a-f]{64}")
LOCATOR_RE = re.compile(r"sentence\[([1-9][0-9]*)\]/suspensionDate\[([1-9][0-9]*)\]")


class BoundaryError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise BoundaryError(message)


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if type(value) is not dict or set(value) != expected:
        fail(f"{label} exact keys changed")


def require_sha(value: Any, label: str) -> str:
    if type(value) is not str or HEX64.fullmatch(value) is None:
        fail(f"{label} must be SHA-256")
    return value


def git_run(*args: str, binary: bool = False) -> subprocess.CompletedProcess[Any]:
    return subprocess.run(
        ["git", *args], cwd=ROOT, check=False, capture_output=True,
        **({} if binary else {"text": True, "encoding": "utf-8"}),
    )


def git(*args: str) -> str:
    run = git_run(*args)
    if run.returncode:
        fail("Git binding failed")
    return run.stdout.strip()


def git_raw(commit: str, path: Path) -> bytes:
    relative = path.relative_to(ROOT).as_posix()
    run = git_run("show", f"{commit}:{relative}", binary=True)
    if run.returncode:
        fail(f"Git blob missing: {relative}")
    return run.stdout


def git_path_exists(commit: str, path: Path) -> bool:
    return git_run("cat-file", "-e", f"{commit}:{path.relative_to(ROOT).as_posix()}").returncode == 0


def is_ancestor(ancestor: str, descendant: str) -> bool:
    return git_run("merge-base", "--is-ancestor", ancestor, descendant).returncode == 0


def normalized_builder(raw: bytes) -> bytes:
    normalized = raw.replace(b"\r\n", b"\n")
    for name in (b"CONTRACT_RAW", b"CONTRACT_SELF"):
        pattern = rb"(?m)^" + name + rb' = "[0-9a-f]{64}"$'
        replacement = name + b' = "' + (b"0" * 64) + b'"'
        normalized, count = re.subn(pattern, replacement, normalized)
        if count != 1:
            fail("builder normalization structure changed")
    return normalized


def contract_self(value: dict[str, Any]) -> str:
    return sha(canonical({key: item for key, item in value.items() if key != "contractSha256"}))


def validate_contract(value: dict[str, Any], raw: bytes | None = None, own_bytes: bool = True) -> None:
    exact_keys(value, {
        "schema", "createdAt", "taskId", "track", "purpose", "sourceInput", "parserInput", "corpusInput",
        "populationContract", "timingQualifierContract", "semanticContract", "rowSchema", "claimLocks",
        "implementationContract", "contractSha256",
    }, "contract")
    if value["schema"] != "early-detection-sec-form25-suspension-boundary-contract/v1":
        fail("contract schema changed")
    if value["createdAt"] != "2026-08-13T05:10:53Z" or value["purpose"] != EXPECTED_PURPOSE:
        fail("contract purpose or creation time changed")
    if value["taskId"] != "Q003-SEC-FORM25-SUSPENSION-BOUNDARY" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract task or track changed")
    exact_keys(value["sourceInput"], {
        "gzipPath", "gzipBytes", "gzipRawSha256", "decompressedBytes", "decompressedRawSha256",
        "decompressedReportSha256", "manifestPath", "manifestRawSha256", "verifierPath", "verifierRawSha256",
        "testPath", "testRawSha256", "manifestIntroductionCommit", "gzipIntroductionCommit",
        "verifierAndTestIntroductionCommit", "sourceRows", "sourceUniqueAccessions",
        "sourceOutcomesAccessed",
    }, "source input")
    if value["sourceInput"] != {
        "gzipPath": "reports/early-detection/sec-form25-structured-metadata-v2.json.gz",
        "gzipBytes": 13197732,
        "gzipRawSha256": "942bb1ec0fbc292a53ca6b3760b2ffee13253cf60322ecb9778905118a2d370e",
        "decompressedBytes": 257997067,
        "decompressedRawSha256": "bc7b419a8489088f6fadd55579feec05fd193d36a2b415b592b4bac4c950d774",
        "decompressedReportSha256": "b24c12b721b2a81952b8d2b7e8fc9b4617408f69075f5f7d5a09bc98e16f1ea8",
        "manifestPath": "reports/early-detection/sec-form25-structured-metadata-v2-gzip-manifest.json",
        "manifestRawSha256": "a28c43ca2f9089ce5c7cb93dbd5bbc120af1b7579f4ec835fb2bc7b47cb4d9ab",
        "verifierPath": "scripts/verify-sec-form25-structured-metadata-v2-gzip.py",
        "verifierRawSha256": "1974be471d478ce2e04857fbebfc24528ebc69f10801b334e72b17a8a316fff6",
        "testPath": "tests/verify-sec-form25-structured-metadata-v2-gzip.test.js",
        "testRawSha256": "63fc7ecc36449dd3c0d2430edb344eca7ba97341d26a78036aabfc17507aa84e",
        "manifestIntroductionCommit": SOURCE_INTRODUCTION,
        "gzipIntroductionCommit": SOURCE_GZIP_INTRODUCTION,
        "verifierAndTestIntroductionCommit": SOURCE_VERIFIER_INTRODUCTION,
        "sourceRows": 27285,
        "sourceUniqueAccessions": 14504,
        "sourceOutcomesAccessed": False,
    }:
        fail("source input binding changed")
    exact_keys(value["parserInput"], {
        "path", "fixCommit", "gitBlobRawSha256", "requiredFunctions", "loadOnlyAfterRawHashCheck",
    }, "parser input")
    if value["parserInput"] != {
        "path": "scripts/build-sec-form25-structured-metadata-v1.py",
        "fixCommit": PARSER_FIX_COMMIT,
        "gitBlobRawSha256": PARSER_RAW,
        "requiredFunctions": ["extract_documents", "sentences_for_documents", "parsed_iso_date"],
        "loadOnlyAfterRawHashCheck": True,
    }:
        fail("parser input binding changed")
    exact_keys(value["corpusInput"], {
        "logicalRoot", "expectedInventoryBlobCount", "expectedInventoryBlobBytes", "selectedUniqueBlobs",
        "sourceDerivedRebuildRequired", "sourceDerivedRebuildNormalAndOptimizedRequired",
    }, "corpus input")
    if value["corpusInput"] != {
        "logicalRoot": "early-detection-v4/corporate-action-originals/blobs/sha256",
        "expectedInventoryBlobCount": 27438,
        "expectedInventoryBlobBytes": 326221948,
        "selectedUniqueBlobs": 6366,
        "sourceDerivedRebuildRequired": True,
        "sourceDerivedRebuildNormalAndOptimizedRequired": True,
    }:
        fail("corpus contract changed")
    exact_keys(value["populationContract"], {
        "selection", "expectedRows", "expectedUniqueAccessions", "expectedUniqueBlobs",
        "expectedEvidenceOccurrences", "expectedEvidenceOccurrenceCountByRow", "expectedForms",
        "expectedSuspensionDateRange", "expectedIdentifierStates", "oneOutputRowPerSelectedSourceRow",
        "tickerJoinAllowed", "normalizationJoinAllowed", "deduplicationAcrossQueueRowsAllowed",
    }, "population contract")
    population = value["populationContract"]
    if population != {
        "selection": "SOURCE_FORM25_METADATA_ROW_WITH_SUSPENSION_DATE_STATUS_PRESENT",
        "expectedRows": 12727,
        "expectedUniqueAccessions": 6366,
        "expectedUniqueBlobs": 6366,
        "expectedEvidenceOccurrences": 12739,
        "expectedEvidenceOccurrenceCountByRow": {"1": 12715, "2": 12},
        "expectedForms": {"25": 5, "25-NSE": 12582, "25-NSE/A": 140},
        "expectedSuspensionDateRange": {"minimum": "2006-02-27", "maximum": "2024-12-30"},
        "expectedIdentifierStates": {"PRESENT": 12722, "UNAVAILABLE": 5},
        "oneOutputRowPerSelectedSourceRow": True,
        "tickerJoinAllowed": False,
        "normalizationJoinAllowed": False,
        "deduplicationAcrossQueueRowsAllowed": False,
    }:
        fail("population contract changed")
    exact_keys(value["timingQualifierContract"], {
        "allowedValues", "expectedCounts", "dateOnlyDoesNotIdentifySession",
        "atOpenDoesNotIdentifyPriorSessionWithoutCalendar", "atCloseDoesNotProveAnyTradeOccurredThatDay",
    }, "timing qualifier contract")
    if value["timingQualifierContract"] != {
        "allowedValues": list(EXPECTED_QUALIFIERS),
        "expectedCounts": EXPECTED_QUALIFIERS,
        "dateOnlyDoesNotIdentifySession": True,
        "atOpenDoesNotIdentifyPriorSessionWithoutCalendar": True,
        "atCloseDoesNotProveAnyTradeOccurredThatDay": True,
    }:
        fail("timing qualifier contract changed")
    exact_keys(value["semanticContract"], {
        "evidenceKind", "claimCeiling", "notEvidenceOf", "outcomeBlind", "pricesRead", "returnsRead",
    }, "semantic contract")
    if value["semanticContract"] != {
        "evidenceKind": EXPECTED_KIND,
        "claimCeiling": EXPECTED_CEILING,
        "notEvidenceOf": EXPECTED_NOT_EVIDENCE,
        "outcomeBlind": True,
        "pricesRead": False,
        "returnsRead": False,
    }:
        fail("semantic claim ceiling changed")
    if value["rowSchema"] != EXPECTED_ROW_SCHEMA:
        fail("row schema changed")
    if value["claimLocks"] != EXPECTED_LOCKS:
        fail("claim locks changed")
    exact_keys(value["implementationContract"], {
        "baseCommit", "baseTag", "remote", "ref", "contractPath", "builderPath", "testPath", "outputPath",
        "ownedByteBindings", "introductionMustBeDirectSingleParentChildOfBase",
        "introductionAddsExactlyContractBuilderTest", "outputIntroductionMustBeDirectSingleParentChild",
        "outputIntroductionAddsExactlyOutput", "remoteVerificationRequired", "atomicCreateNewRequired",
        "sidePathAllowed",
    }, "implementation contract")
    implementation = value["implementationContract"]
    exact_keys(implementation["ownedByteBindings"], {"builderNormalizedSha256", "testRawSha256"}, "owned byte bindings")
    expected_implementation = {
        "baseCommit": BASE_COMMIT,
        "baseTag": 872,
        "remote": REMOTE_URL,
        "ref": REMOTE_REF,
        "contractPath": CONTRACT.relative_to(ROOT).as_posix(),
        "builderPath": BUILDER.relative_to(ROOT).as_posix(),
        "testPath": TEST.relative_to(ROOT).as_posix(),
        "outputPath": OUTPUT.relative_to(ROOT).as_posix(),
        "ownedByteBindings": implementation["ownedByteBindings"],
        "introductionMustBeDirectSingleParentChildOfBase": True,
        "introductionAddsExactlyContractBuilderTest": True,
        "outputIntroductionMustBeDirectSingleParentChild": True,
        "outputIntroductionAddsExactlyOutput": True,
        "remoteVerificationRequired": True,
        "atomicCreateNewRequired": True,
        "sidePathAllowed": False,
    }
    if implementation != expected_implementation:
        fail("implementation contract changed")
    require_sha(implementation["ownedByteBindings"]["builderNormalizedSha256"], "builder normalized binding")
    require_shaóŞ´¶‰Ëkºwµçb&W÷'E²'&W÷'E6†#Sb%ÒÂ'&÷w56†#Sb#¢&W÷'E²'&÷w56†#Sb%ÒÀ¢'fW&–f–VE&÷w2#¢#s#rÂ&÷WF6öÖW466W76VB#¢fÇ6WĞ¢VÆ–b&w2æ6öÖÖæBÓÒ'fW&–g’Ö÷WGWB# ¢–bæ÷BõUEUBæW†—7G2‚“ ¢f–Â‚&÷WGWBÖ—76–ær"¢7F÷&VE÷&rÒõUEUBç&VEö'—FW2‚¢7F÷&VBÒ§6öâæÆöG2‡7F÷&VE÷&r¢fÆ–FFU÷&W÷'B‡7F÷&VBÂ&W÷'B¢&W7VÇBÒ²'7FGW2#¢%52"Â¢§F÷öÆöw’Â&÷WGWE&u6†#Sb#¢6†‡7F÷&VE÷&r’À¢'&W÷'E6†#Sb#¢7F÷&VE²'&W÷'E6†#Sb%ÒÂ'&÷w56†#Sb#¢7F÷&VE²'&÷w56†#Sb%ÒÀ¢'fW&–f–VE&÷w2#¢#s#rÂ&÷WF6öÖW466W76VB#¢fÇ6WĞ¢VÇ6S ¢&W7VÇBÒ²'7FGW2#¢%52"Â¢§F÷öÆöw’Â'&W÷'B#¢&W÷'BÂ&÷WGWD7&VFVB#¢fÇ6RÀ¢'fW&–f–VE&÷w2#¢#s#rÂ&÷WF6öÖW466W76VB#¢fÇ6WĞ¢&–çB†§6öâæGV×2‡&W7VÇBÂVç7W&Uö66–“ÔfÇ6RÂ6÷'Eö¶W—3ÕG'VRÂ6W&F÷'3Ò‚"Â"Â#¢"’’¢&WGW&â ¢W†6WB„&÷VæF'”W'&÷"Âõ4W'&÷"ÂfÇVTW'&÷"Â¶W”W'&÷"ÂG—TW'&÷"Â7V'&ö6W72å7V'&ö6W74W'&÷"’2W†3 ¢'6W"æW'&÷"‡7G"†W†2’¢&WGW&â   ¦–bõöæÖUõòÓÒ%õöÖ–åõò# ¢&—6R7—7FVÔW†—B†Ö–â‚’ 