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
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-form25-suspension-boundary-contract-v2.json"
BUILDER = Path(__file__).resolve()
TEST = ROOT / "tests" / "build-sec-form25-suspension-boundary-v2.test.js"
OUTPUT = ROOT / "reports" / "early-detection" / "sec-form25-suspension-boundary-v2.json"
SOURCE_GZIP = ROOT / "reports" / "early-detection" / "sec-form25-structured-metadata-v2.json.gz"
SOURCE_MANIFEST = ROOT / "reports" / "early-detection" / "sec-form25-structured-metadata-v2-gzip-manifest.json"
SOURCE_VERIFIER = ROOT / "scripts" / "verify-sec-form25-structured-metadata-v2-gzip.py"
SOURCE_TEST = ROOT / "tests" / "verify-sec-form25-structured-metadata-v2-gzip.test.js"
PARSER = ROOT / "scripts" / "build-sec-form25-structured-metadata-v1.py"
CORPUS = Path(r"C:\Users\Anwender\Documents\GrowthScreenerResearchData\early-detection-v4\corporate-action-originals\blobs\sha256")

CONTRACT_RAW = "e0c8f304b42f2a7993cc9092b19f245f5538cea589d4b0e0a780204ffdd74eba"
CONTRACT_SELF = "a69971baba9acc14ddfc0637c9d3c9d89c563a9c6ed3930d6740ff8c240e1e68"
BASE_COMMIT = "cb95704a6d989e6595908056c1b4e5d686cc519d"
REMOTE_URL = "https://github.com/Karlryl/screener-data.git"
REMOTE_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
SOURCE_INTRODUCTION = "2205e9080a5101babd2016f4334a00abeeb12993"
SOURCE_GZIP_INTRODUCTION = "ea03e44d8ce805a08c4dc627caafc7080357b40f"
SOURCE_VERIFIER_INTRODUCTION = "6bdbee402f9feef281a5a36660d28a3664f0fde4"
PARSER_FIX_COMMIT = "9bd88bb08ce7e3b35d91bec9491f9614d61b3175"
PARSER_RAW = "52f78812a7547df4025dd8a48351f2364beb7285cc903bcb1a0df5fbe56d0025"
EXPECTED_PURPOSE = (
    "Supersede the truncated Tag-873 implementation attempt and materialize only primary-SEC statements "
    "of an exchange-trading suspension boundary for exact "
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
        "schema", "createdAt", "taskId", "track", "purpose", "supersededV1", "sourceInput", "parserInput", "corpusInput",
        "populationContract", "timingQualifierContract", "semanticContract", "rowSchema", "claimLocks",
        "implementationContract", "contractSha256",
    }, "contract")
    if value["schema"] != "early-detection-sec-form25-suspension-boundary-contract/v2":
        fail("contract schema changed")
    if value["createdAt"] != "2026-08-13T05:30:52Z" or value["purpose"] != EXPECTED_PURPOSE:
        fail("contract purpose or creation time changed")
    if value["taskId"] != "Q003-SEC-FORM25-SUSPENSION-BOUNDARY" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract task or track changed")
    if value["supersededV1"] != {
        "introductionCommit": "cb95704a6d989e6595908056c1b4e5d686cc519d",
        "studyCredit": "ZERO",
        "executionAllowed": False,
        "reason": "PUBLISHED_BUILDER_BLOB_TRUNCATED_DURING_TRANSPORT",
        "contractPath": "research/early-detection-v4/sec-form25-suspension-boundary-contract-v1.json",
        "contractRawSha256": "4a72220de33987708d5a8d9b3e72dfeb4bba3a00733054de609b8b35ff736bed",
        "publishedBuilderPath": "scripts/build-sec-form25-suspension-boundary-v1.py",
        "publishedBuilderRawSha256": "41203850ff2d6025b9c15d8b38622a54603f0b2d1c262536c8455b56c88f3a7c",
        "publishedBuilderBytes": 16086,
        "expectedCompleteBuilderRawSha256": "7bc9908417814692489f9f66bbec475bb38d8c8815a19b0149ac2df42de2b3ab",
        "expectedCompleteBuilderBytes": 42949,
    }:
        fail("superseded V1 disposition changed")
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
        "baseTag": 873,
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
    require_sha(implementation["ownedByteBindings"]["testRawSha256"], "test raw binding")
    if value["contractSha256"] != contract_self(value):
        fail("contract self hash changed")
    if own_bytes:
        if raw is None or sha(raw) != CONTRACT_RAW or value["contractSha256"] != CONTRACT_SELF:
            fail("contract raw binding changed")
        if sha(normalized_builder(BUILDER.read_bytes())) != implementation["ownedByteBindings"]["builderNormalizedSha256"]:
            fail("builder normalized bytes changed")
        if sha(TEST.read_bytes()) != implementation["ownedByteBindings"]["testRawSha256"]:
            fail("test raw bytes changed")


def load_contract() -> tuple[dict[str, Any], bytes]:
    raw = CONTRACT.read_bytes()
    value = json.loads(raw)
    validate_contract(value, raw, True)
    return value, raw


def load_parser() -> SimpleNamespace:
    raw = git_raw(PARSER_FIX_COMMIT, PARSER)
    if sha(raw) != PARSER_RAW:
        fail("bound parser Git bytes changed")
    namespace: dict[str, Any] = {"__name__": "bound_form25_parser", "__file__": str(PARSER)}
    exec(compile(raw, str(PARSER), "exec"), namespace)
    for name in ("extract_documents", "sentences_for_documents", "parsed_iso_date", "accession_from_sec_header", "SUSPENSION_RE"):
        if name not in namespace:
            fail("bound parser API changed")
    return SimpleNamespace(**namespace)


def verify_source_git() -> None:
    expected = {
        SOURCE_GZIP: ("942bb1ec0fbc292a53ca6b3760b2ffee13253cf60322ecb9778905118a2d370e", SOURCE_GZIP_INTRODUCTION),
        SOURCE_MANIFEST: ("a28c43ca2f9089ce5c7cb93dbd5bbc120af1b7579f4ec835fb2bc7b47cb4d9ab", SOURCE_INTRODUCTION),
        SOURCE_VERIFIER: ("1974be471d478ce2e04857fbebfc24528ebc69f10801b334e72b17a8a316fff6", SOURCE_VERIFIER_INTRODUCTION),
        SOURCE_TEST: ("63fc7ecc36449dd3c0d2430edb344eca7ba97341d26a78036aabfc17507aa84e", SOURCE_VERIFIER_INTRODUCTION),
    }
    head = git("rev-parse", "HEAD")
    for path, (expected_sha, introduction) in expected.items():
        if not is_ancestor(introduction, head):
            fail("source introduction is not an ancestor")
        local = path.read_bytes()
        if sha(local) != expected_sha or git_raw(introduction, path) != local or git_raw(head, path) != local:
            fail(f"source Git binding changed: {path.name}")


def load_source() -> tuple[dict[str, Any], dict[str, Any]]:
    verify_source_git()
    manifest_raw = SOURCE_MANIFEST.read_bytes()
    manifest = json.loads(manifest_raw)
    if manifest.get("manifestSha256") != sha(canonical({k: v for k, v in manifest.items() if k != "manifestSha256"})):
        fail("source manifest self hash changed")
    gz = SOURCE_GZIP.read_bytes()
    if len(gz) != 13197732 or sha(gz) != "942bb1ec0fbc292a53ca6b3760b2ffee13253cf60322ecb9778905118a2d370e":
        fail("source gzip changed")
    raw = gzip.decompress(gz)
    if len(raw) != 257997067 or sha(raw) != "bc7b419a8489088f6fadd55579feec05fd193d36a2b415b592b4bac4c950d774":
        fail("source decompressed bytes changed")
    payload = json.loads(raw)
    exact_keys(payload, {
        "schema", "taskId", "track", "inputBindings", "implementationBindings", "population",
        "parseStatusCounts", "fieldStatusCounts", "candidateSnippetCount", "claimLocks", "rows", "reportSha256",
    }, "source payload")
    if payload["schema"] != "early-detection-sec-form25-structured-metadata/v2" or len(payload["rows"]) != 27285:
        fail("source payload population changed")
    if payload["reportSha256"] != "b24c12b721b2a81952b8d2b7e8fc9b4617408f69075f5f7d5a09bc98e16f1ea8":
        fail("source report binding changed")
    if payload["reportSha256"] != sha(canonical({k: v for k, v in payload.items() if k != "reportSha256"})):
        fail("source report self hash changed")
    if any(value is not False for value in payload["claimLocks"].values()):
        fail("source claim lock changed")
    if any(row.get("outcomesAccessed") is not False for row in payload["rows"]):
        fail("source row outcome lock changed")
    return payload, manifest


def classify_timing(sentence: str) -> str:
    lowered = " ".join(sentence.lower().split())
    if re.search(r"\bat the open of trading on\b", lowered):
        return "AT_OPEN_OF_TRADING"
    if re.search(r"\bat (?:the )?close of (?:the )?trading session on\b", lowered):
        return "AT_CLOSE_OF_TRADING_SESSION"
    if re.search(r"\bsuspended from trading on\b", lowered):
        return "DATE_ONLY_TIME_UNSPECIFIED"
    fail("suspension timing phrase is not allowlisted")


def validate_source_ref(ref: dict[str, Any], blob: bytes, document: dict[str, Any], sentence: str, mode: str) -> None:
    exact_keys(ref, SOURCE_REF_KEYS, "source reference")
    for key in ("blobSha256", "rawDocumentSha256", "rawTextSha256", "evidenceSha256"):
        require_sha(ref[key], f"source reference {key}")
    if ref["blobSha256"] != sha(blob) or Path(ref["relativePath"]).stem != ref["blobSha256"]:
        fail("source blob binding changed")
    if ref["documentIndex"] != document["index"] or ref["documentType"] != document["type"]:
        fail("source document identity changed")
    if ref["documentSequence"] != document["sequence"] or ref["documentFilename"] != document["filename"]:
        fail("source document fields changed")
    if ref["rawDocumentSha256"] != sha(document["raw"]) or ref["rawTextSha256"] != sha(document["textRaw"]):
        fail("source document bytes changed")
    if ref["locatorKind"] != "NORMALIZED_TEXT_SENTENCE" or ref["normalizationMode"] != mode:
        fail("source normalization binding changed")
    if ref["evidenceSha256"] != sha(sentence.encode("utf-8")):
        fail("source sentence hash changed")


def field_literal(row: dict[str, Any], name: str) -> tuple[str | None, str]:
    field = row["fields"][name]
    exact_keys(field, {"status", "value", "evidence"}, f"source field {name}")
    if field["status"] not in {"PRESENT", "UNAVAILABLE"}:
        fail(f"source identifier field {name} state changed")
    if field["status"] == "PRESENT":
        if type(field["value"]) is not str or not field["value"] or not field["evidence"]:
            fail(f"source identifier field {name} value changed")
    elif field["value"] is not None or field["evidence"]:
        fail(f"unavailable source identifier field {name} changed")
    return field["value"], field["status"]


def build_rows(payload: dict[str, Any], parser: SimpleNamespace) -> list[dict[str, Any]]:
    selected = [row for row in payload["rows"] if row["fields"]["suspensionDate"]["status"] == "PRESENT"]
    rows: list[dict[str, Any]] = []
    cache: dict[str, tuple[bytes, list[dict[str, Any]], list[tuple[dict[str, Any], int, str, str]]]] = {}
    for source in selected:
        exact_keys(source, {
            "rowId", "priorityRank", "accession", "form", "filedDate", "inventoryStatus", "sourceBlob",
            "parseStatus", "fields", "candidateSnippets", "missingness", "ambiguities", "outcomesAccessed",
        }, "source row")
        if source["outcomesAccessed"] is not False or source["sourceBlob"] is None:
            fail("selected source row is not outcome-blind local evidence")
        blob_ref = source["sourceBlob"]
        exact_keys(blob_ref, {"blobSha256", "bytes", "relativePath"}, "source blob")
        blob_sha = require_sha(blob_ref["blobSha256"], "source blob")
        if Path(blob_ref["relativePath"]).stem != blob_sha:
            fail("source blob path changed")
        if blob_sha not in cache:
            path = CORPUS / blob_ref["relativePath"]
            blob = path.read_bytes()
            if len(blob) != blob_ref["bytes"] or sha(blob) != blob_sha:
                fail("corpus blob bytes changed")
            if parser.accession_from_sec_header(blob) != source["accession"]:
                fail("corpus accession changed")
            documents = parser.extract_documents(blob)
            sentence_values = parser.sentences_for_documents(documents)
            cache[blob_sha] = (blob, documents, sentence_values)
        blob, documents, sentence_values = cache[blob_sha]
        suspension = source["fields"]["suspensionDate"]
        exact_keys(suspension, {"status", "value", "evidence"}, "suspension field")
        if type(suspension["value"]) is not str or not suspension["evidence"]:
            fail("suspension value changed")
        evidence_output: list[dict[str, Any]] = []
        qualifiers: set[str] = set()
        for evidence in suspension["evidence"]:
            exact_keys(evidence, {"value", "sourceRef"}, "suspension evidence")
            if evidence["value"] != suspension["value"]:
                fail("suspension evidence value changed")
            ref = evidence["sourceRef"]
            locator = LOCATOR_RE.fullmatch(ref.get("locator", ""))
            if locator is None:
                fail("suspension locator changed")
            sentence_number, match_number = map(int, locator.groups())
            candidates = [item for item in sentence_values if item[0]["index"] == ref["documentIndex"] and item[1] == sentence_number]
            if len(candidates) != 1:
                fail("suspension sentence locator is not unique")
            document, _, sentence, mode = candidates[0]
            validate_source_ref(ref, blob, document, sentence, mode)
            matches = list(parser.SUSPENSION_RE.finditer(sentence))
            if match_number > len(matches) or parser.parsed_iso_date(matches[match_number - 1].group(1)) != suspension["value"]:
                fail("suspension date reparse changed")
            qualifier = classify_timing(sentence)
            qualifiers.add(qualifier)
            evidence_output.append({"value": suspension["value"], "evidenceText": sentence, "sourceRef": copy.deepcopy(ref)})
        if len(qualifiers) != 1:
            fail("suspension timing evidence conflicts")
        issuer_cik, issuer_cik_state = field_literal(source, "issuerCik")
        issuer_name, issuer_name_state = field_literal(source, "issuerName")
        exchange_name, exchange_name_state = field_literal(source, "exchangeName")
        security_description, security_description_state = field_literal(source, "securityDescription")
        boundary_id = sha(canonical({
            "sourceRowId": source["rowId"], "accession": source["accession"],
            "suspensionBoundaryDate": suspension["value"], "blobSha256": blob_sha,
        }))
        rows.append({
            "boundaryId": boundary_id,
            "sourceRowId": source["rowId"],
            "priorityRank": source["priorityRank"],
            "accession": source["accession"],
            "filedDate": source["filedDate"],
            "form": source["form"],
            "sourceBlob": copy.deepcopy(blob_ref),
            "issuerCik": issuer_cik,
            "issuerCikState": issuer_cik_state,
            "issuerName": issuer_name,
            "issuerNameState": issuer_name_state,
            "exchangeName": exchange_name,
            "exchangeNameState": exchange_name_state,
            "securityDescription": security_description,
            "securityDescriptionState": security_description_state,
            "suspensionBoundaryDate": suspension["value"],
            "suspensionTimingQualifier": next(iter(qualifiers)),
            "evidenceOccurrences": evidence_output,
            "evidenceKind": EXPECTED_KIND,
            "lastTradePriceObserved": False,
            "lastConsolidatedSessionObserved": False,
            "laterOtcTradingExcluded": False,
            "delistingCompletionVerified": False,
            "identityResolved": False,
            "terminalWealthComplete": False,
            "outcomesAccessed": False,
        })
    return rows


def validate_rows(rows: list[dict[str, Any]], contract: dict[str, Any]) -> dict[str, Any]:
    if type(rows) is not list or len(rows) != 12727:
        fail("derived row count changed")
    if len({row.get("boundaryId") for row in rows}) != len(rows) or len({row.get("sourceRowId") for row in rows}) != len(rows):
        fail("derived row identity changed")
    if rows != sorted(rows, key=lambda row: row["priorityRank"]):
        fail("derived row order changed")
    for row in rows:
        exact_keys(row, ROW_KEYS, "derived row")
        if row["evidenceKind"] != EXPECTED_KIND or type(row["evidenceOccurrences"]) is not list or not row["evidenceOccurrences"]:
            fail("derived row evidence changed")
        if any(row[key] is not False for key in (
            "lastTradePriceObserved", "lastConsolidatedSessionObserved", "laterOtcTradingExcluded",
            "delistingCompletionVerified", "identityResolved", "terminalWealthComplete", "outcomesAccessed",
        )):
            fail("derived row claim lock changed")
        for occurrence in row["evidenceOccurrences"]:
            exact_keys(occurrence, {"value", "evidenceText", "sourceRef"}, "evidence occurrence")
            if occurrence["value"] != row["suspensionBoundaryDate"]:
                fail("derived evidence date changed")
            if sha(occurrence["evidenceText"].encode("utf-8")) != occurrence["sourceRef"]["evidenceSha256"]:
                fail("derived evidence text changed")
    qualifiers = Counter(row["suspensionTimingQualifier"] for row in rows)
    forms = Counter(row["form"] for row in rows)
    occurrence_counts = Counter(str(len(row["evidenceOccurrences"])) for row in rows)
    identifier_states = Counter(row["issuerCikState"] for row in rows)
    if dict(qualifiers) != EXPECTED_QUALIFIERS:
        fail("timing qualifier counts changed")
    if dict(forms) != {"25-NSE": 12582, "25-NSE/A": 140, "25": 5}:
        fail("Form population changed")
    if dict(occurrence_counts) != {"1": 12715, "2": 12} or sum(len(row["evidenceOccurrences"]) for row in rows) != 12739:
        fail("evidence occurrence counts changed")
    if dict(identifier_states) != {"PRESENT": 12722, "UNAVAILABLE": 5}:
        fail("identifier state counts changed")
    if len({row["accession"] for row in rows}) != 6366 or len({row["sourceBlob"]["blobSha256"] for row in rows}) != 6366:
        fail("unique accession/blob counts changed")
    dates = [row["suspensionBoundaryDate"] for row in rows]
    if min(dates) != "2006-02-27" or max(dates) != "2024-12-30":
        fail("suspension date range changed")
    return {
        "rows": len(rows),
        "uniqueAccessions": 6366,
        "uniqueBlobs": 6366,
        "evidenceOccurrences": 12739,
        "timingQualifierCounts": dict(sorted(qualifiers.items())),
        "formCounts": dict(sorted(forms.items())),
        "identifierStateCounts": dict(sorted(identifier_states.items())),
        "suspensionDateMinimum": min(dates),
        "suspensionDateMaximum": max(dates),
    }


def build_report(contract: dict[str, Any]) -> dict[str, Any]:
    payload, _ = load_source()
    parser = load_parser()
    rows = build_rows(payload, parser)
    population = validate_rows(rows, contract)
    report: dict[str, Any] = {
        "schema": "early-detection-sec-form25-suspension-boundary/v2",
        "taskId": "Q003-SEC-FORM25-SUSPENSION-BOUNDARY",
        "track": "SHARED_OUTCOME_BLIND_INFRA",
        "sourceBindings": {
            "gzipRawSha256": contract["sourceInput"]["gzipRawSha256"],
            "decompressedRawSha256": contract["sourceInput"]["decompressedRawSha256"],
            "decompressedReportSha256": contract["sourceInput"]["decompressedReportSha256"],
            "manifestRawSha256": contract["sourceInput"]["manifestRawSha256"],
            "parserGitBlobRawSha256": PARSER_RAW,
            "parserFixCommit": PARSER_FIX_COMMIT,
        },
        "population": population,
        "semanticCeiling": EXPECTED_CEILING,
        "notEvidenceOf": EXPECTED_NOT_EVIDENCE,
        "claimLocks": copy.deepcopy(EXPECTED_LOCKS),
        "rowsSha256": sha(canonical(rows)),
        "rows": rows,
    }
    report["reportSha256"] = sha(canonical(report))
    return report


def validate_report(report: dict[str, Any], expected: dict[str, Any] | None = None) -> None:
    exact_keys(report, {
        "schema", "taskId", "track", "sourceBindings", "population", "semanticCeiling", "notEvidenceOf",
        "claimLocks", "rowsSha256", "rows", "reportSha256",
    }, "report")
    if report["schema"] != "early-detection-sec-form25-suspension-boundary/v2":
        fail("report schema changed")
    if report["taskId"] != "Q003-SEC-FORM25-SUSPENSION-BOUNDARY" or report["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("report task or track changed")
    if report["semanticCeiling"] != EXPECTED_CEILING or report["notEvidenceOf"] != EXPECTED_NOT_EVIDENCE:
        fail("report semantic ceiling changed")
    if report["claimLocks"] != EXPECTED_LOCKS:
        fail("report claim locks changed")
    validate_rows(report["rows"], json.loads(CONTRACT.read_bytes()))
    if report["rowsSha256"] != sha(canonical(report["rows"])):
        fail("report row hash changed")
    if report["reportSha256"] != sha(canonical({k: v for k, v in report.items() if k != "reportSha256"})):
        fail("report self hash changed")
    if expected is not None and report != expected:
        fail("report differs from source-derived rebuild")


def changed_paths(commit: str) -> list[tuple[str, str]]:
    parent = git("rev-parse", f"{commit}^")
    output: list[tuple[str, str]] = []
    for line in git("diff", "--name-status", parent, commit).splitlines():
        status, path = line.split("\t", 1)
        output.append((status, path))
    return output


def introduction_for(path: Path) -> str | None:
    commits = git("log", "--diff-filter=A", "--format=%H", "--reverse", "--", path.relative_to(ROOT).as_posix()).splitlines()
    return commits[0] if commits else None


def verify_topology(remote: bool, require_output_absent: bool = False) -> dict[str, Any]:
    if not remote:
        fail("remote verification is required")
    head = git("rev-parse", "HEAD")
    upstream = git("rev-parse", "@{upstream}")
    origin = git("remote", "get-url", "origin")
    remote_head = git("ls-remote", origin, REMOTE_REF).split()[0]
    if origin != REMOTE_URL or len({head, upstream, remote_head}) != 1:
        fail("HEAD/upstream/live remote binding changed")
    contract, _ = load_contract()
    intro = introduction_for(CONTRACT)
    output_intro = introduction_for(OUTPUT)
    if intro is None:
        if head != BASE_COMMIT or any(git_path_exists(head, path) for path in (CONTRACT, BUILDER, TEST)):
            fail("pre-introduction topology changed")
        phase = "PRE_INTRODUCTION"
    else:
        parents = git("rev-list", "--parents", "-n", "1", intro).split()
        if parents != [intro, BASE_COMMIT]:
            fail("implementation introduction is not direct single-parent child")
        expected_adds = [("A", path.relative_to(ROOT).as_posix()) for path in (CONTRACT, BUILDER, TEST)]
        if changed_paths(intro) != expected_adds:
            fail("implementation introduction diff changed")
        for path in (CONTRACT, BUILDER, TEST):
            if git_raw(intro, path) != path.read_bytes() or git_raw(head, path) != path.read_bytes():
                fail("implementation Git bytes changed")
        if not is_ancestor(intro, head):
            fail("implementation introduction is not ancestor")
        if output_intro is None:
            phase = "IMPLEMENTED_NO_OUTPUT"
        else:
            parents = git("rev-list", "--parents", "-n", "1", output_intro).split()
            if parents != [output_intro, intro] or changed_paths(output_intro) != [("A", OUTPUT.relative_to(ROOT).as_posix())]:
                fail("output introduction topology changed")
            if not is_ancestor(output_intro, head) or git_raw(output_intro, OUTPUT) != OUTPUT.read_bytes() or git_raw(head, OUTPUT) != OUTPUT.read_bytes():
                fail("output Git bytes changed")
            phase = "OUTPUT_INTRODUCED"
    if require_output_absent and (OUTPUT.exists() or output_intro is not None):
        fail("build requires absent output")
    return {"phase": phase, "head": head, "implementationIntroduction": intro, "outputIntroduction": output_intro,
            "remoteVerified": True, "contractSha256": contract["contractSha256"]}


def atomic_create_new(path: Path, raw: bytes) -> None:
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
        if path.read_bytes() != raw:
            fail("output readback changed")
    finally:
        temp.unlink(missing_ok=True)


def mutation_killed(mutator: Callable[[dict[str, Any]], None], validator: Callable[[dict[str, Any]], None], original: dict[str, Any]) -> bool:
    changed = copy.deepcopy(original)
    mutator(changed)
    if "contractSha256" in changed:
        changed["contractSha256"] = contract_self(changed)
    if "reportSha256" in changed:
        changed["reportSha256"] = sha(canonical({k: v for k, v in changed.items() if k != "reportSha256"}))
    try:
        validator(changed)
    except (BoundaryError, KeyError, TypeError, ValueError):
        return True
    return False


def self_test(remote: bool) -> dict[str, Any]:
    contract, _ = load_contract()
    report = build_report(contract)
    validate_report(report, report)
    contract_mutations: dict[str, Callable[[dict[str, Any]], None]] = {
        "futureTime": lambda value: value.__setitem__("createdAt", "2099-01-01T00:00:00Z"),
        "purposeOverclaim": lambda value: value.__setitem__("purpose", "last price and terminal wealth verified"),
        "supersededV1Credit": lambda value: value["supersededV1"].__setitem__("studyCredit", "FULL"),
        "supersededV1Execution": lambda value: value["supersededV1"].__setitem__("executionAllowed", True),
        "sourceOutcome": lambda value: value["sourceInput"].__setitem__("sourceOutcomesAccessed", True),
        "sourcePath": lambda value: value["sourceInput"].__setitem__("gzipPath", "reports/other.json.gz"),
        "corpusCount": lambda value: value["corpusInput"].__setitem__("selectedUniqueBlobs", 1),
        "populationDrop": lambda value: value["populationContract"].__setitem__("expectedRows", 1),
        "populationExtra": lambda value: value["populationContract"].__setitem__("resolvedRows", 12727),
        "qualifierCount": lambda value: value["timingQualifierContract"]["expectedCounts"].__setitem__("DATE_ONLY_TIME_UNSPECIFIED", 12710),
        "qualifierClaim": lambda value: value["timingQualifierContract"].__setitem__("atCloseDoesNotProveAnyTradeOccurredThatDay", False),
        "ceiling": lambda value: value["semanticContract"].__setitem__("claimCeiling", "LAST_CONSOLIDATED_SESSION"),
        "notEvidence": lambda value: value["semanticContract"]["notEvidenceOf"].pop(),
        "pricesRead": lambda value: value["semanticContract"].__setitem__("pricesRead", True),
        "lock": lambda value: value["claimLocks"].__setitem__("terminalWealthComplete", True),
        "lockExtra": lambda value: value["claimLocks"].__setitem__("unknownCredit", True),
        "outputPath": lambda value: value["implementationContract"].__setitem__("outputPath", "state/evil.json"),
    }
    report_mutations: dict[str, Callable[[dict[str, Any]], None]] = {
        "rowLoss": lambda value: value["rows"].pop(),
        "rowOrder": lambda value: value["rows"].reverse(),
        "date": lambda value: value["rows"][0].__setitem__("suspensionBoundaryDate", "2099-01-01"),
        "qualifier": lambda value: value["rows"][0].__setitem__("suspensionTimingQualifier", "DATE_ONLY_TIME_UNSPECIFIED" if value["rows"][0]["suspensionTimingQualifier"] != "DATE_ONLY_TIME_UNSPECIFIED" else "AT_OPEN_OF_TRADING"),
        "evidenceText": lambda value: value["rows"][0]["evidenceOccurrences"][0].__setitem__("evidenceText", "suspended someday"),
        "sourceRef": lambda value: value["rows"][0]["evidenceOccurrences"][0]["sourceRef"].__setitem__("documentIndex", 99),
        "lastPrice": lambda value: value["rows"][0].__setitem__("lastTradePriceObserved", True),
        "lastSession": lambda value: value["rows"][0].__setitem__("lastConsolidatedSessionObserved", True),
        "otc": lambda value: value["rows"][0].__setitem__("laterOtcTradingExcluded", True),
        "delistingComplete": lambda value: value["rows"][0].__setitem__("delistingCompletionVerified", True),
        "identity": lambda value: value["rows"][0].__setitem__("identityResolved", True),
        "terminal": lambda value: value["rows"][0].__setitem__("terminalWealthComplete", True),
        "outcome": lambda value: value["rows"][0].__setitem__("outcomesAccessed", True),
        "extraRowKey": lambda value: value["rows"][0].__setitem__("terminalPrice", 0),
        "ceiling": lambda value: value.__setitem__("semanticCeiling", "TERMINAL_WEALTH_COMPLETE"),
        "reportLock": lambda value: value["claimLocks"].__setitem__("originalV4GateCredit", True),
    }
    kills = {name: mutation_killed(mutator, lambda item: validate_contract(item, None, False), contract)
             for name, mutator in contract_mutations.items()}
    kills.update({name: mutation_killed(mutator, validate_report, report) for name, mutator in report_mutations.items()})
    if not all(kills.values()):
        fail("self-test mutation survived")
    topology = verify_topology(remote)
    return {"status": "PASS", "phase": topology["phase"], "mutationKills": kills, "verifiedRows": 12727,
            "uniqueAccessions": 6366, "outcomesAccessed": False}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify-contract", "dry-run", "build", "verify-output", "self-test"))
    parser.add_argument("--remote", action="store_true")
    args = parser.parse_args()
    try:
        if not args.remote:
            fail("--remote is required")
        contract, _ = load_contract()
        if args.command == "self-test":
            result = self_test(True)
        elif args.command == "verify-contract":
            topology = verify_topology(True)
            result = {"status": "PASS", **topology, "expectedRows": 12727, "outcomesAccessed": False}
        else:
            topology = verify_topology(True, args.command == "build")
            report = build_report(contract)
            validate_report(report, report)
            raw = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
            if args.command == "build":
                if topology["phase"] != "IMPLEMENTED_NO_OUTPUT":
                    fail("build requires implemented-no-output phase")
                atomic_create_new(OUTPUT, raw)
                result = {"status": "PASS", **topology, "outputCreated": True, "outputRawSha256": sha(raw),
                          "reportSha256": report["reportSha256"], "rowsSha256": report["rowsSha256"],
                          "verifiedRows": 12727, "outcomesAccessed": False}
            elif args.command == "verify-output":
                if not OUTPUT.exists():
                    fail("output missing")
                stored_raw = OUTPUT.read_bytes()
                stored = json.loads(stored_raw)
                validate_report(stored, report)
                result = {"status": "PASS", **topology, "outputRawSha256": sha(stored_raw),
                          "reportSha256": stored["reportSha256"], "rowsSha256": stored["rowsSha256"],
                          "verifiedRows": 12727, "outcomesAccessed": False}
            else:
                result = {"status": "PASS", **topology, "report": report, "outputCreated": False,
                          "verifiedRows": 12727, "outcomesAccessed": False}
        print(json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
        return 0
    except (BoundaryError, OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as exc:
        parser.error(str(exc))
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
