#!/usr/bin/env python3
"""Build and verify the outcome-blind Q003 partial-evidence coverage ledger."""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-terminal-wealth-evidence-coverage-ledger-contract-v1.json"
BUILDER = Path(__file__).resolve()
TEST = ROOT / "tests" / "build-sec-terminal-wealth-evidence-coverage-ledger-v1.test.js"
OUTPUT = ROOT / "reports" / "early-detection" / "sec-terminal-wealth-evidence-coverage-ledger-v1.json"
CELL_CONTRACT = ROOT / "research" / "early-detection-v4" / "evidence-cell-contract-v1.json"
QUEUE = ROOT / "reports" / "early-detection" / "sec-terminal-wealth-queue-v5.json"
BOUNDARY = ROOT / "reports" / "early-detection" / "sec-form25-suspension-boundary-v2.json"
CLOSURE = ROOT / "reports" / "early-detection" / "sec-terminal-closure-exhaustion-v1.json"
FIXED = ROOT / "reports" / "early-detection" / "sec-effective-fixed-cash-conversion-evidence-v2.json"
SAME = ROOT / "reports" / "early-detection" / "sec-same-sentence-effective-fixed-cash-v5.json"
DISTRIBUTION = ROOT / "reports" / "early-detection" / "sec-frozen-terminal-distribution-receipt-evidence-v2.json"
NONCASH = ROOT / "reports" / "early-detection" / "sec-frozen-noncash-share-receipt-evidence-v1.json"
NONCASH_V3_CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-frozen-noncash-share-receipt-evidence-contract-v3.json"
NONCASH_V3_VERIFIER = ROOT / "scripts" / "verify-sec-frozen-noncash-share-receipt-evidence-v3.py"
NONCASH_V3_TEST = ROOT / "tests" / "verify-sec-frozen-noncash-share-receipt-evidence-v3.test.js"
LIQUIDATION = ROOT / "reports" / "early-detection" / "sec-frozen-liquidation-payment-evidence-v1.json"
EXTRACTION = ROOT / "reports" / "early-detection" / "sec-terminal-primary-document-extraction-v1.json"
ISSUER_RESOLUTION = ROOT / "reports" / "early-detection" / "sec-terminal-primary-issuer-cik-resolution-v1.json"
LIQ_CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-form25-liquidation-payment-reconciliation-contract-v1.json"
LIQ_BUILDER = ROOT / "scripts" / "build-sec-form25-liquidation-payment-reconciliation-v1.py"
LIQ_TEST = ROOT / "tests" / "build-sec-form25-liquidation-payment-reconciliation-v1.test.js"
OWNED = (CONTRACT, BUILDER, TEST)

CONTRACT_RAW = "3c8cf48275040568c6c8c4b5f903b3dcde10d275adfee63c548d97475a8e5cb1"
CONTRACT_SELF = "4ebd158438e4e0126999f1b3d11bd2a98216f7b5aaea6c5488a85ba51fb341b1"
BASE = "096793e785ff093773bb124df8c204d9043ab469"
REMOTE = "https://github.com/Karlryl/screener-data.git"
REMOTE_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
CREATED_AT = "2026-08-13T09:02:00Z"
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
COMMIT40 = re.compile(r"[0-9a-f]{40}\Z")

SEMANTICS = [
    "HISTORICAL_VALIDITY_INTERVAL",
    "CONSOLIDATED_ADJUSTED_OHLCV",
    "COMPLETE_CORPORATE_ACTIONS",
    "OBSERVED_TERMINAL_SESSION",
    "TERMINAL_WEALTH",
]
LANE_ORDER = [
    "FORM25_SUSPENSION_BOUNDARY",
    "LAST_NAMED_EXCHANGE_TRADING_DAY",
    "EFFECTIVE_FIXED_CASH_CONVERSION",
    "SAME_SENTENCE_FIXED_CASH_CONVERSION",
    "FROZEN_TERMINAL_DISTRIBUTION_OR_RECEIPT",
    "CORRECTED_NONCASH_SHARE_RECEIPT",
    "LIQUIDATION_PAYMENT_DISTRIBUTION",
]
ROW_KEYS = [
    "queueRowId", "accession", "priorityRank", "canonicalEvidenceCellMaterialized",
    "identityKeyState", "semanticStates", "partialEvidenceRefs", "rowSha256", "outcomesAccessed",
]
REF_KEYS = ["semantic", "laneId", "sourceRecordId"]
EXPECTED_LOCKS = {
    "canonicalEvidenceCellsMaterialized": False,
    "historicalValidityIntervalResolved": False,
    "consolidatedAdjustedOhlcvResolved": False,
    "completeCorporateActionsResolved": False,
    "observedTerminalSessionResolved": False,
    "terminalWealthComplete": False,
    "identityResolved": False,
    "listingIdentityResolved": False,
    "notFoundPromotedToComplete": False,
    "candidateEvidencePromotedToResolved": False,
    "originalV4GateCredit": False,
    "resultComputationAllowed": False,
    "pricesAccessed": False,
    "returnsAccessed": False,
    "outcomesAccessed": False,
}
EXPECTED_DISTRIBUTION_MAP = {
    "0000891377-11-000008": {"queueRowId": "SEC-TW-00005967", "queueCik": "0000891377", "queueCompanyName": "BERKELEY TECHNOLOGY LTD", "titleClassText": "Ordinary Shares"},
    "0000903423-11-000138": {"queueRowId": "SEC-TW-00005705", "queueCik": "0001167888", "queueCompanyName": "MS STRUCTURED SATURNS SERIES 2002-3", "titleClassText": "SATURNS DPL Capital Security Backed Series 2002-3 Class A Callable Units"},
    "0000903423-11-000139": {"queueRowId": "SEC-TW-00005706", "queueCik": "0001175209", "queueCompanyName": "MS STRUCTURED SATURNS SERIES 2002-7", "titleClassText": "SATURNS DPL Capital Security Backed Series 2002-7 Class A Callable Units"},
    "0000903423-11-000140": {"queueRowId": "SEC-TW-00005704", "queueCik": "0001166802", "queueCompanyName": "MS STRUCTURED SATURNS SERIES 2002-4", "titleClassText": "SATURNS DPL Capital Security Backed Series 2002-4 Class A Callable Units"},
    "0000950157-22-000333": {"queueRowId": "SEC-TW-00035761", "queueCik": "0000899611", "queueCompanyName": "NEWCREST MINING LTD", "titleClassText": "Ordinary shares"},
}


class CoverageError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise CoverageError(message)


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def pretty(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def self_hash(value: dict[str, Any], field: str) -> str:
    body = copy.deepcopy(value)
    body.pop(field, None)
    return sha(canonical(body))


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if type(value) is not dict or set(value) != expected:
        fail(f"{label} exact keys changed")


def normalized_builder(raw: bytes) -> bytes:
    text = raw.decode("utf-8").replace("\r\n", "\n")
    for name in ("CONTRACT_RAW", "CONTRACT_SELF"):
        pattern = re.compile(rf'^{name} = "[0-9a-fA-Z_]+"$', re.MULTILINE)
        if len(pattern.findall(text)) != 1:
            fail(f"{name} normalization structure changed")
        text = pattern.sub(f'{name} = "{"0" * 64}"', text)
    return text.encode("utf-8")


def normalized_test(raw: bytes) -> bytes:
    text = raw.decode("utf-8").replace("\r\n", "\n")
    for name in ("EXPECTED_CONTRACT_RAW", "EXPECTED_BUILDER_NORMALIZED", "EXPECTED_TEST_NORMALIZED"):
        pattern = re.compile(rf"^const {name} = '[0-9a-fA-Z_]+';$", re.MULTILINE)
        if len(pattern.findall(text)) != 1:
            fail(f"{name} normalization structure changed")
        text = pattern.sub(f"const {name} = '{'0' * 64}';", text)
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


def introduction_for(path: Path) -> list[str]:
    relative = path.relative_to(ROOT).as_posix()
    output = git("log", "--reverse", "--format=%H", "--diff-filter=A", f"{BASE}..HEAD", "--", relative)
    return [line for line in output.splitlines() if line]


def remote_head() -> str:
    lines = git("ls-remote", "origin", REMOTE_REF).splitlines()
    if len(lines) != 1:
        fail("live remote ref unavailable or ambiguous")
    return lines[0].split()[0]


def load_json_bound(path: Path, expected_raw: str, report_field: str | None = None, expected_report: str | None = None, verify_self: bool = True) -> dict[str, Any]:
    raw = path.read_bytes()
    if sha(raw) != expected_raw:
        fail(f"raw bytes changed for {path.relative_to(ROOT).as_posix()}")
    try:
        value = json.loads(raw)
    except Exception as error:
        fail(f"JSON parse failed for {path.name}: {error}")
    if type(value) is not dict:
        fail(f"{path.name} must contain an object")
    if report_field and value.get(report_field) != expected_report:
        fail(f"self-hash claim changed for {path.name}")
    if report_field and verify_self and self_hash(value, report_field) != expected_report:
        fail(f"self hash changed for {path.name}")
    return value


def validate_contract(value: dict[str, Any], verify_dependencies: bool = True) -> None:
    top = {
        "schema", "createdAt", "taskId", "track", "purpose", "authoritativeCellContract",
        "authoritativeInputs", "evidenceLaneContract", "projectionContract", "expectedCoverage",
        "claimLocks", "implementationContract", "contractSha256",
    }
    exact_keys(value, top, "contract")
    if value["schema"] != "sec-terminal-wealth-evidence-coverage-ledger-contract/v1":
        fail("contract schema changed")
    if value["createdAt"] != CREATED_AT:
        fail("createdAt changed")
    if value["taskId"] != "Q003-SEC-TERMINAL-WEALTH-EVIDENCE-COVERAGE-LEDGER" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract identity changed")
    expected_purpose = (
        "Project every one of the 44,352 sealed terminal-wealth queue rows across all five required evidence semantics, "
        "attach only exact row-level partial-evidence references from already sealed primary-source lanes, preserve every "
        "semantic as UNRESOLVED, and expose the remaining evidence gaps without materializing identity-keyed evidence cells "
        "or opening prices, returns, outcomes or Original-V4 credit."
    )
    if value["purpose"] != expected_purpose:
        fail("purpose changed")
    if value["contractSha256"] != CONTRACT_SELF or self_hash(value, "contractSha256") != CONTRACT_SELF:
        fail("contract self hash changed")
    cell = value["authoritativeCellContract"]
    exact_keys(cell, {"path", "rawSha256", "semantics", "projectionIsCanonicalEvidenceCell", "reason"}, "cell contract binding")
    if cell != {
        "path": CELL_CONTRACT.relative_to(ROOT).as_posix(),
        "rawSha256": "8bd9f5edd8100fbf855587272e892bd48d1e904fe7ad1ccc778851888fd09d73",
        "semantics": SEMANTICS,
        "projectionIsCanonicalEvidenceCell": False,
        "reason": "The queue does not yet contain resolved entityId, securityId and listingId keys required by the authoritative evidence-cell contract.",
    }:
        fail("authoritative evidence-cell boundary changed")
    inputs = value["authoritativeInputs"]
    expected_input_keys = {
        "terminalWealthQueue", "suspensionBoundary", "terminalClosure", "effectiveFixedCash",
        "sameSentenceFixedCash", "terminalDistributionReceipt", "noncashShareReceipt",
        "noncashSemanticCorrection", "liquidationPayment", "primaryDocumentExtraction",
        "primaryIssuerResolution", "liquidationReconciliation",
    }
    exact_keys(inputs, expected_input_keys, "authoritative inputs")
    simple = {
        "terminalWealthQueue": (QUEUE, "cfc6b1c98e159e0d086bdad72a495ebe1c34b208975f145a8f96f903ada8798e", "a840de2297de3a04afc1f1bcb76139fb36297369b6765f73683db9bc2a92e825"),
        "suspensionBoundary": (BOUNDARY, "4e9b33086ff6120de04110deb1e6e3916d2ca5001384729bbc28b273efd8735f", "99199da6cf5b9c4ffc7416c5e97dc4fd9f6300ba3e7c731b123c11fa4c030345"),
        "terminalClosure": (CLOSURE, "68d1002e6aa0836a39fc29d982bd1a91001ab626976f0472a74c69bf133d12ed", "9d0f7377952821796c5c709dc9baf9bd62aab74058277c7a98780b14f23daf7a"),
        "effectiveFixedCash": (FIXED, "7516ef1e4eb7c0bbaf59175a6f79b775471a5a79c40ad5d754746ddea50434ed", "b58693161a9b50142633dffd59e5d7187644f4326f1ef8a86fc3383960e87b25"),
        "sameSentenceFixedCash": (SAME, "f48ac224fdf889fc8b03b8494b93048501c0cd53179656cd01f77468f97a1167", "e8fb04deef3914733f612b327ec1cd022ed621690846520b1b2d6c3010974aea"),
        "terminalDistributionReceipt": (DISTRIBUTION, "bfd0b4e4582e1267a311e5d79a63a19339e3a9967980f542148c9173c97d13dc", "7967bd2ed2634568a785a5ec4e76d209db7ae10dc9ec9b1d72681144f5200104"),
        "noncashShareReceipt": (NONCASH, "d02cb40ca4c38212af29c00d8c08a54fee120df615e44418cc120ed8a0575f07", "8c892de667133e43d287ca20970f12da5cdce2a4ef71b5d684657a6446f8b1a2"),
        "liquidationPayment": (LIQUIDATION, "962b86e9ede09741c96a67fc853bffda101f9f6b5c0883b7da4ae23a7b416bc4", "c7b37f025ba20f1b816c69f0ac0e372df36e17dc9e2cc9136f448c13e24406d9"),
        "primaryDocumentExtraction": (EXTRACTION, "987560ca38931cfa818f6c9fb315be7875ec98fd872518ef51d45f5af3589464", "9fd402508ff75ab0d3265cc15c7f77a6e6fa2f659749a43f5719db207d094000"),
        "primaryIssuerResolution": (ISSUER_RESOLUTION, "f89767daf43c2d06ca87c0b57919b450749620026724b700ff94572117da7cfb", "3b450bef0120eee49fc4ab0f188578097ffd2fb53d781675b33c6db84809ead6"),
    }
    for key, (path, raw_hash, report_hash) in simple.items():
        expected = {"path": path.relative_to(ROOT).as_posix(), "rawSha256": raw_hash, "reportSha256": report_hash}
        if key == "terminalWealthQueue":
            expected["rows"] = 44352
        if inputs[key] != expected:
            fail(f"{key} binding changed")
        if verify_dependencies:
            load_json_bound(path, raw_hash, "reportSha256", report_hash, verify_self=(key != "terminalClosure"))
    noncash_correction = inputs["noncashSemanticCorrection"]
    exact_keys(noncash_correction, {"contractPath", "contractRawSha256", "verifierPath", "verifierRawSha256", "testPath", "testRawSha256", "derivedViewSha256"}, "noncash correction")
    expected_noncash_correction = {
        "contractPath": NONCASH_V3_CONTRACT.relative_to(ROOT).as_posix(),
        "contractRawSha256": "d1e0ff5188332c4840a33e2218c9a54baf743d0327d229ceea363488813d271f",
        "verifierPath": NONCASH_V3_VERIFIER.relative_to(ROOT).as_posix(),
        "verifierRawSha256": "4d70c0bfe412a45bb676a0fc8dce9ef1ce40f3a72100423cbb6366f23a84140b",
        "testPath": NONCASH_V3_TEST.relative_to(ROOT).as_posix(),
        "testRawSha256": "e7f512a555c1f9f7dfdbe9426610cfb29579b08fa9d031d42ecf62a63f05181a",
        "derivedViewSha256": "a68f2e51f25f0462381dd86b9cfb429e0c98d063f4712de050ce5311878add0b",
    }
    if noncash_correction != expected_noncash_correction:
        fail("noncash semantic correction binding changed")
    liq = inputs["liquidationReconciliation"]
    exact_keys(liq, {"contractPath", "contractRawSha256", "contractSha256", "builderPath", "builderRawSha256", "testPath", "testRawSha256"}, "liquidation reconciliation")
    expected_liq = {
        "contractPath": LIQ_CONTRACT.relative_to(ROOT).as_posix(),
        "contractRawSha256": "0db44a1a16a7a838f4e48a76c774aa8dff3b98bc365073ccca9f11bdf96564ca",
        "contractSha256": "495ed141bb43aa963e16e0b21b0a89dc37f92c7a9f05e5eafb2ab91a504f604c",
        "builderPath": LIQ_BUILDER.relative_to(ROOT).as_posix(),
        "builderRawSha256": "c1dedb5300485395a75f0861e3cc858ff4b6acf61245fceb40e9c34f7e8a36f2",
        "testPath": LIQ_TEST.relative_to(ROOT).as_posix(),
        "testRawSha256": "28c24db10164bb00335b395a2415e81e96d7424dac0e67e90905072a9663aeb7",
    }
    if liq != expected_liq:
        fail("liquidation reconciliation binding changed")
    if verify_dependencies:
        for path, expected in (
            (CELL_CONTRACT, cell["rawSha256"]),
            (NONCASH_V3_CONTRACT, expected_noncash_correction["contractRawSha256"]),
            (NONCASH_V3_VERIFIER, expected_noncash_correction["verifierRawSha256"]),
            (NONCASH_V3_TEST, expected_noncash_correction["testRawSha256"]),
            (LIQ_CONTRACT, expected_liq["contractRawSha256"]),
            (LIQ_BUILDER, expected_liq["builderRawSha256"]),
            (LIQ_TEST, expected_liq["testRawSha256"]),
        ):
            if sha(path.read_bytes()) != expected:
                fail(f"dependency bytes changed for {path.relative_to(ROOT).as_posix()}")
    lanes = value["evidenceLaneContract"]
    exact_keys(lanes, {"laneOrder", "lanes", "frozenDistributionQueueMappings"}, "evidence lanes")
    if lanes["laneOrder"] != LANE_ORDER or set(lanes["lanes"]) != set(LANE_ORDER):
        fail("lane set or order changed")
    if lanes["frozenDistributionQueueMappings"] != EXPECTED_DISTRIBUTION_MAP:
        fail("frozen distribution mappings changed")
    expected_lane_static = {
        "FORM25_SUSPENSION_BOUNDARY": (["HISTORICAL_VALIDITY_INTERVAL"], 12727, 6366, "bbda73e6df1c9d3cf270592d3c9822548e4989ae8e7814198d53940cfd828c5b", "DATED_NAMED_EXCHANGE_SUSPENSION_BOUNDARY_ONLY"),
        "LAST_NAMED_EXCHANGE_TRADING_DAY": (["OBSERVED_TERMINAL_SESSION"], 28, 23, "62c15cde48640180d721f30a562910992439520cdc3e2cbfe5d39b96e1e5842c", "LAST_TRADING_DAY_ON_NAMED_EXCHANGE_ONLY_NOT_CONSOLIDATED_OR_OTC_EXHAUSTIVE"),
        "EFFECTIVE_FIXED_CASH_CONVERSION": (["COMPLETE_CORPORATE_ACTIONS", "TERMINAL_WEALTH"], 4, 4, "740c17b2d64d5f255cda68d847305b5b1f1dc51a7bce92d38a8c2c828b834298", "EFFECTIVE_TRANSACTION_AND_FIXED_CASH_CONVERSION_RIGHT_ONLY"),
        "SAME_SENTENCE_FIXED_CASH_CONVERSION": (["COMPLETE_CORPORATE_ACTIONS", "TERMINAL_WEALTH"], 11, 11, "38fb4765c361f6edc1747043a091621b7a36a23f2397bd9ab23f53fea6926a93", "EXACT_ELEVEN_FROZEN_EFFECTIVE_DATE_AND_FIXED_CASH_CONVERSION_SENTENCES_ONLY"),
        "FROZEN_TERMINAL_DISTRIBUTION_OR_RECEIPT": (["COMPLETE_CORPORATE_ACTIONS", "TERMINAL_WEALTH"], 5, 5, "3ed70f20ea667dbe123ac03d58ffc95f9dd212f87b3a6b3357028860e15a0d5a", "EXACT_FIVE_FROZEN_DISTRIBUTION_OR_RESTRICTED_RECEIPT_STATEMENTS_ONLY"),
        "CORRECTED_NONCASH_SHARE_RECEIPT": (["COMPLETE_CORPORATE_ACTIONS", "TERMINAL_WEALTH"], 6, 6, "7b274805e8b7349fbfffbb8f494795e28218fe52f0a51ed04bc0bcedf0b3dcaa", "EXACT_SIX_FROZEN_NONCASH_RECEIPT_STATEMENTS_WITH_CORRECTED_DENOMINATOR_TERMINOLOGY_ONLY"),
        "LIQUIDATION_PAYMENT_DISTRIBUTION": (["COMPLETE_CORPORATE_ACTIONS", "TERMINAL_WEALTH"], 34, 17, "0d87ec0ef0fd2f993a18028b54bb618974b1019365a1f50affc04d690f34189d", "SEVENTEEN_UNIQUE_EVENTS_PROJECTED_TO_THIRTY_FOUR_ISSUER_AND_EXCHANGE_ROLE_ROWS_ONLY"),
    }
    for lane_id, values in expected_lane_static.items():
        exact_keys(lanes["lanes"][lane_id], {"semantics", "queueRows", "uniqueAccessions", "queueRowIdSequenceSha256", "claimLimit"}, f"lane {lane_id}")
        expected = dict(zip(("semantics", "queueRows", "uniqueAccessions", "queueRowIdSequenceSha256", "claimLimit"), values))
        if lanes["lanes"][lane_id] != expected:
            fail(f"lane {lane_id} contract changed")
    projection = value["projectionContract"]
    exact_keys(projection, {"rowSchema", "evidenceRefSchema", "semanticStateForEveryRow", "canonicalEvidenceCellMaterializedForEveryRow", "identityKeyStateForEveryRow", "partialEvidenceDoesNotChangeSemanticState", "notFoundDoesNotMeanComplete", "rowOrder", "rowSelfHashRequired", "rowSelfSequenceSha256", "rowsCanonicalSha256"}, "projection contract")
    if projection["rowSchema"] != ROW_KEYS or projection["evidenceRefSchema"] != REF_KEYS:
        fail("projection schema changed")
    if projection["semanticStateForEveryRow"] != "UNRESOLVED" or projection["canonicalEvidenceCellMaterializedForEveryRow"] is not False:
        fail("projection resolution boundary changed")
    if projection["identityKeyStateForEveryRow"] != "UNMATERIALIZED_ENTITY_SECURITY_LISTING_KEY" or projection["partialEvidenceDoesNotChangeSemanticState"] is not True or projection["notFoundDoesNotMeanComplete"] is not True:
        fail("projection identity or missingness boundary changed")
    if projection["rowOrder"] != "QUEUE_PRIORITY_RANK_ASCENDING" or projection["rowSelfHashRequired"] is not True:
        fail("projection ordering or self hash changed")
    for field in ("rowSelfSequenceSha256", "rowsCanonicalSha256"):
        if not HEX64.fullmatch(projection[field]):
            fail(f"{field} invalid")
    coverage = value["expectedCoverage"]
    exact_keys(coverage, {"queueRows", "targetSemanticCells", "resolvedSemanticCells", "unresolvedSemanticCells", "canonicalEvidenceCellsMaterialized", "rowsWithAnyPartialEvidence", "rowsWithoutPartialEvidence", "partialEvidenceSemanticCells", "semanticCoverage", "coveragePatternCounts"}, "expected coverage")
    if {key: coverage[key] for key in ("queueRows", "targetSemanticCells", "resolvedSemanticCells", "unresolvedSemanticCells", "canonicalEvidenceCellsMaterialized", "rowsWithAnyPartialEvidence", "rowsWithoutPartialEvidence", "partialEvidenceSemanticCells")} != {
        "queueRows": 44352, "targetSemanticCells": 221760, "resolvedSemanticCells": 0,
        "unresolvedSemanticCells": 221760, "canonicalEvidenceCellsMaterialized": 0,
        "rowsWithAnyPartialEvidence": 12770, "rowsWithoutPartialEvidence": 31582,
        "partialEvidenceSemanticCells": 12875,
    }:
        fail("expected coverage totals changed")
    expected_sem = {
        "HISTORICAL_VALIDITY_INTERVAL": (12727, "bbda73e6df1c9d3cf270592d3c9822548e4989ae8e7814198d53940cfd828c5b"),
        "CONSOLIDATED_ADJUSTED_OHLCV": (0, "01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b"),
        "COMPLETE_CORPORATE_ACTIONS": (60, "68124f0ccf334c3003dca937868e972752337d2ebc41d5efc45f3b6501a8812c"),
        "OBSERVED_TERMINAL_SESSION": (28, "62c15cde48640180d721f30a562910992439520cdc3e2cbfe5d39b96e1e5842c"),
        "TERMINAL_WEALTH": (60, "68124f0ccf334c3003dca937868e972752337d2ebc41d5efc45f3b6501a8812c"),
    }
    exact_keys(coverage["semanticCoverage"], set(SEMANTICS), "semantic coverage")
    for semantic, (partial, sequence) in expected_sem.items():
        expected = {"partialEvidenceRows": partial, "resolvedRows": 0, "unresolvedRows": 44352, "queueRowIdSequenceSha256": sequence}
        if coverage["semanticCoverage"][semantic] != expected:
            fail(f"semantic coverage changed for {semantic}")
    if coverage["coveragePatternCounts"] != {"00000": 31582, "00010": 28, "00101": 15, "10000": 12682, "10101": 45}:
        fail("coverage patterns changed")
    if value["claimLocks"] != EXPECTED_LOCKS:
        fail("claim locks changed")
    impl = value["implementationContract"]
    exact_keys(impl, {"baseCommit", "remote", "ref", "contractPath", "builderPath", "testPath", "outputPath", "builderNormalizedSha256", "testNormalizedSha256", "introductionMustBeDirectSingleParentChildOfBase", "introductionAddsExactlyThreeOwnedPaths", "outputIntroductionMustBeDirectSingleParentChildOfImplementationIntroduction", "outputIntroductionAddsExactlyOutputPath", "laterLinearSingleParentDescendantsAllowed", "remoteVerificationRequired", "noRemoteVerificationMustFail", "writeNewOnly"}, "implementation contract")
    expected_paths = {
        "baseCommit": BASE, "remote": REMOTE, "ref": REMOTE_REF,
        "contractPath": CONTRACT.relative_to(ROOT).as_posix(),
        "builderPath": BUILDER.relative_to(ROOT).as_posix(),
        "testPath": TEST.relative_to(ROOT).as_posix(),
        "outputPath": OUTPUT.relative_to(ROOT).as_posix(),
    }
    for key, expected in expected_paths.items():
        if impl[key] != expected:
            fail(f"implementation {key} changed")
    for key in ("builderNormalizedSha256", "testNormalizedSha256"):
        if not HEX64.fullmatch(impl[key]):
            fail(f"implementation {key} invalid")
    for key in ("introductionMustBeDirectSingleParentChildOfBase", "introductionAddsExactlyThreeOwnedPaths", "outputIntroductionMustBeDirectSingleParentChildOfImplementationIntroduction", "outputIntroductionAddsExactlyOutputPath", "laterLinearSingleParentDescendantsAllowed", "remoteVerificationRequired", "noRemoteVerificationMustFail", "writeNewOnly"):
        if impl[key] is not True:
            fail(f"implementation boolean changed: {key}")


def load_contract() -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    if sha(raw) != CONTRACT_RAW:
        fail("contract raw bytes changed")
    value = json.loads(raw)
    validate_contract(value, verify_dependencies=True)
    return value


def id_sequence(ids: set[str]) -> str:
    return sha(("\n".join(sorted(ids)) + "\n").encode("utf-8"))


def import_bound_module(path: Path, expected_raw: str, name: str) -> Any:
    raw = path.read_bytes()
    if sha(raw) != expected_raw:
        fail(f"module bytes changed before import: {path.name}")
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        fail(f"cannot import {path.name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def build_lanes(contract: dict[str, Any]) -> tuple[dict[str, dict[str, str]], dict[str, set[str]]]:
    inputs = contract["authoritativeInputs"]
    queue = load_json_bound(QUEUE, inputs["terminalWealthQueue"]["rawSha256"], "reportSha256", inputs["terminalWealthQueue"]["reportSha256"])["rows"]
    if len(queue) != 44352:
        fail("queue row count changed")
    by_id = {row["rowId"]: row for row in queue}
    by_accession: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in queue:
        if row["resolutionState"] != "UNRESOLVED" or row["outcomesAccessed"] is not False:
            fail("queue resolution or outcome lock changed")
        by_accession[row["accession"]].append(row)
    if len(by_id) != len(queue):
        fail("queue row ids are not unique")
    lane_records: dict[str, dict[str, str]] = {lane: {} for lane in LANE_ORDER}

    boundaries = load_json_bound(BOUNDARY, inputs["suspensionBoundary"]["rawSha256"], "reportSha256", inputs["suspensionBoundary"]["reportSha256"])["rows"]
    for row in boundaries:
        row_id = row["sourceRowId"]
        if row_id not in by_id or by_id[row_id]["accession"] != row["accession"]:
            fail("suspension boundary queue binding failed")
        if row["identityResolved"] is not False or row["lastConsolidatedSessionObserved"] is not False or row["laterOtcTradingExcluded"] is not False or row["terminalWealthComplete"] is not False or row["outcomesAccessed"] is not False:
            fail("suspension boundary overclaim detected")
        lane_records["FORM25_SUSPENSION_BOUNDARY"][row_id] = row["boundaryId"]

    closures = load_json_bound(CLOSURE, inputs["terminalClosure"]["rawSha256"], "reportSha256", inputs["terminalClosure"]["reportSha256"], verify_self=False)["rows"]
    for row in closures:
        if row["lastNamedExchangeTradingDayVerified"] is not True or row["lastConsolidatedSessionVerified"] is not False or row["laterOtcTradingExcluded"] is not False or row["terminalWealthComplete"] is not False or row["outcomesAccessed"] is not False:
            fail("terminal closure claim boundary changed")
        for row_id in row["queueRowIds"]:
            if row_id not in by_id or by_id[row_id]["accession"] != row["accession"]:
                fail("terminal closure queue binding failed")
            lane_records["LAST_NAMED_EXCHANGE_TRADING_DAY"][row_id] = row["sourceRef"]["evidenceSha256"]

    fixed_rows = load_json_bound(FIXED, inputs["effectiveFixedCash"]["rawSha256"], "reportSha256", inputs["effectiveFixedCash"]["reportSha256"])["rows"]
    for row in fixed_rows:
        matches = [qrow for qrow in by_accession[row["accession"]] if qrow["cik"].zfill(10) == row["issuerCik"].zfill(10)]
        if len(matches) != 1 or row["actualCashReceiptVerified"] is not False or row["terminalWealthComplete"] is not False or row["outcomesAccessed"] is not False:
            fail("effective fixed-cash issuer join or locks changed")
        lane_records["EFFECTIVE_FIXED_CASH_CONVERSION"][matches[0]["rowId"]] = row["evidenceRowId"]

    extraction_rows = load_json_bound(EXTRACTION, inputs["primaryDocumentExtraction"]["rawSha256"], "reportSha256", inputs["primaryDocumentExtraction"]["reportSha256"])["rows"]
    extraction_by_id = {row["extractionRowId"]: row for row in extraction_rows}
    issuer_rows = load_json_bound(ISSUER_RESOLUTION, inputs["primaryIssuerResolution"]["rawSha256"], "reportSha256", inputs["primaryIssuerResolution"]["reportSha256"])["rows"]
    issuer_by_extraction = {row["sourceExtractionRowId"]: row for row in issuer_rows}
    same_rows = load_json_bound(SAME, inputs["sameSentenceFixedCash"]["rawSha256"], "reportSha256", inputs["sameSentenceFixedCash"]["reportSha256"])["rows"]
    for row in same_rows:
        extraction = extraction_by_id.get(row["sourceExtractionRowId"])
        resolution = issuer_by_extraction.get(row["sourceExtractionRowId"])
        if extraction is None or resolution is None:
            fail("same-sentence source chain missing")
        if resolution["selectionStatus"] != "ONE_EXACT_ACCESSION_AND_SOURCE_DERIVED_ISSUER_CIK_MATCH" or resolution["issuerQueueRowResolved"] is not True or resolution["securityIdentityResolved"] is not False or resolution["listingIdentityResolved"] is not False:
            fail("same-sentence issuer-only resolution boundary changed")
        selected = resolution["selectedIssuerQueueRow"]
        row_id = selected["rowId"]
        if row_id not in by_id or by_id[row_id]["accession"] != row["accession"] or selected["cik"] != resolution["sourceDerivedIssuerCik"]:
            fail("same-sentence issuer queue join failed")
        if row["actualCashReceiptVerified"] is not False or row["terminalSessionComplete"] is not False or row["terminalWealthComplete"] is not False or row["outcomesAccessed"] is not False:
            fail("same-sentence overclaim detected")
        lane_records["SAME_SENTENCE_FIXED_CASH_CONVERSION"][row_id] = row["evidenceRowId"]

    distribution_rows = load_json_bound(DISTRIBUTION, inputs["terminalDistributionReceipt"]["rawSha256"], "reportSha256", inputs["terminalDistributionReceipt"]["reportSha256"])["rows"]
    if {row["accession"] for row in distribution_rows} != set(EXPECTED_DISTRIBUTION_MAP):
        fail("frozen distribution population changed")
    for row in distribution_rows:
        mapping = EXPECTED_DISTRIBUTION_MAP[row["accession"]]
        row_id = mapping["queueRowId"]
        queue_row = by_id.get(row_id)
        if (
            queue_row is None
            or queue_row["accession"] != row["accession"]
            or queue_row["cik"] != mapping["queueCik"]
            or queue_row["companyName"] != mapping["queueCompanyName"]
            or row["titleClassText"] != mapping["titleClassText"]
            or row["sourceRef"]["titleClassText"] != mapping["titleClassText"]
        ):
            fail("frozen distribution exact queue mapping failed")
        lane_records["FROZEN_TERMINAL_DISTRIBUTION_OR_RECEIPT"][row_id] = row["evidenceTextSha256"]

    noncash_v3 = import_bound_module(NONCASH_V3_VERIFIER, inputs["noncashSemanticCorrection"]["verifierRawSha256"], "coverage_noncash_v3")
    noncash_contract = noncash_v3.load_contract()
    noncash_state = noncash_v3.verify_topology(True)
    noncash_repo_raw = noncash_v3.validate_repo_files(noncash_contract, noncash_state["head"])
    corrected_view = noncash_v3.build_corrected_view(noncash_contract, noncash_repo_raw)
    if sha(canonical(corrected_view)) != inputs["noncashSemanticCorrection"]["derivedViewSha256"]:
        fail("noncash corrected view hash changed")
    corrected = corrected_view["rows"]
    noncash_rows = load_json_bound(NONCASH, inputs["noncashShareReceipt"]["rawSha256"], "reportSha256", inputs["noncashShareReceipt"]["reportSha256"])["rows"]
    noncash_by_case = {row["caseId"]: row for row in noncash_rows}
    if {row["caseId"] for row in corrected} != set(noncash_by_case):
        fail("noncash corrected population changed")
    for row in corrected:
        source = noncash_by_case[row["caseId"]]
        row_id = source["sourceCandidateBinding"]["sourceRowId"]
        if row_id not in by_id or by_id[row_id]["accession"] != row["accession"]:
            fail("noncash queue binding failed")
        lane_records["CORRECTED_NONCASH_SHARE_RECEIPT"][row_id] = row["caseId"]

    liq_module = import_bound_module(LIQ_BUILDER, inputs["liquidationReconciliation"]["builderRawSha256"], "coverage_liq_reconciliation")
    liq_rows, liq_stats = liq_module.build_rows()
    if liq_stats["liquidationRows"] != 17 or liq_stats["uniqueBoundaryEventProvenances"] != 17 or liq_stats["queueRoleProjectionRows"] != 34 or liq_stats["queueRoleProjectionRowIds"] != 34:
        fail("liquidation reconciliation stats changed")
    for row in liq_rows:
        for link in row["boundaryRoleProjectionLinks"]:
            row_id = link["queueRowId"]
            if row_id not in by_id or by_id[row_id]["accession"] != row["accession"] or link["sourceRowId"] != row_id:
                fail("liquidation reconciliation queue link failed")
            lane_records["LIQUIDATION_PAYMENT_DISTRIBUTION"][row_id] = f'{row["caseId"]}:{link["queueRole"]}'

    expected_lanes = contract["evidenceLaneContract"]["lanes"]
    lane_sets: dict[str, set[str]] = {}
    for lane_id in LANE_ORDER:
        ids = set(lane_records[lane_id])
        lane_sets[lane_id] = ids
        actual_accessions = {by_id[row_id]["accession"] for row_id in ids}
        expected = expected_lanes[lane_id]
        if len(ids) != expected["queueRows"] or len(actual_accessions) != expected["uniqueAccessions"] or id_sequence(ids) != expected["queueRowIdSequenceSha256"]:
            fail(f"lane rebuild mismatch: {lane_id}")
    return lane_records, lane_sets


def build_rows(contract: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    queue = load_json_bound(QUEUE, contract["authoritativeInputs"]["terminalWealthQueue"]["rawSha256"], "reportSha256", contract["authoritativeInputs"]["terminalWealthQueue"]["reportSha256"])["rows"]
    lane_records, lane_sets = build_lanes(contract)
    lane_semantics = {lane: contract["evidenceLaneContract"]["lanes"][lane]["semantics"] for lane in LANE_ORDER}
    semantic_sets = {semantic: set() for semantic in SEMANTICS}
    rows: list[dict[str, Any]] = []
    patterns: Counter[str] = Counter()
    for expected_rank, source in enumerate(queue, start=1):
        if source["priorityRank"] != expected_rank:
            fail("queue priority order changed")
        refs = []
        for lane_id in LANE_ORDER:
            source_record = lane_records[lane_id].get(source["rowId"])
            if source_record is None:
                continue
            for semantic in lane_semantics[lane_id]:
                semantic_sets[semantic].add(source["rowId"])
                refs.append({"semantic": semantic, "laneId": lane_id, "sourceRecordId": source_record})
        refs.sort(key=lambda ref: (SEMANTICS.index(ref["semantic"]), LANE_ORDER.index(ref["laneId"]), ref["sourceRecordId"]))
        semantic_states = {semantic: "UNRESOLVED" for semantic in SEMANTICS}
        pattern = "".join("1" if source["rowId"] in semantic_sets[semantic] else "0" for semantic in SEMANTICS)
        patterns[pattern] += 1
        row = {
            "queueRowId": source["rowId"],
            "accession": source["accession"],
            "priorityRank": source["priorityRank"],
            "canonicalEvidenceCellMaterialized": False,
            "identityKeyState": "UNMATERIALIZED_ENTITY_SECURITY_LISTING_KEY",
            "semanticStates": semantic_states,
            "partialEvidenceRefs": refs,
            "outcomesAccessed": False,
        }
        row["rowSha256"] = sha(canonical(row))
        rows.append(row)
    sem_stats = {}
    for semantic in SEMANTICS:
        ids = semantic_sets[semantic]
        sem_stats[semantic] = {
            "partialEvidenceRows": len(ids), "resolvedRows": 0, "unresolvedRows": len(rows),
            "queueRowIdSequenceSha256": id_sequence(ids),
        }
    any_rows = set().union(*semantic_sets.values())
    stats = {
        "queueRows": len(rows),
        "targetSemanticCells": len(rows) * len(SEMANTICS),
        "resolvedSemanticCells": 0,
        "unresolvedSemanticCells": len(rows) * len(SEMANTICS),
        "canonicalEvidenceCellsMaterialized": 0,
        "rowsWithAnyPartialEvidence": len(any_rows),
        "rowsWithoutPartialEvidence": len(rows) - len(any_rows),
        "partialEvidenceSemanticCells": sum(len(ids) for ids in semantic_sets.values()),
        "semanticCoverage": sem_stats,
        "coveragePatternCounts": dict(sorted(patterns.items())),
        "rowSelfSequenceSha256": sha(("\n".join(row["rowSha256"] for row in rows) + "\n").encode("utf-8")),
        "rowsCanonicalSha256": sha(canonical(rows)),
    }
    expected = copy.deepcopy(contract["expectedCoverage"])
    expected["rowSelfSequenceSha256"] = contract["projectionContract"]["rowSelfSequenceSha256"]
    expected["rowsCanonicalSha256"] = contract["projectionContract"]["rowsCanonicalSha256"]
    if stats != expected:
        fail("coverage rebuild differs from sealed expectations")
    return rows, stats


def validate_rows(rows: Any, contract: dict[str, Any]) -> dict[str, Any]:
    if type(rows) is not list or len(rows) != 44352:
        fail("ledger rows changed")
    seen = set()
    semantic_sets = {semantic: set() for semantic in SEMANTICS}
    patterns: Counter[str] = Counter()
    for rank, row in enumerate(rows, start=1):
        exact_keys(row, set(ROW_KEYS), "ledger row")
        if row["priorityRank"] != rank or row["queueRowId"] in seen:
            fail("ledger row order or uniqueness changed")
        seen.add(row["queueRowId"])
        if row["canonicalEvidenceCellMaterialized"] is not False or row["identityKeyState"] != "UNMATERIALIZED_ENTITY_SECURITY_LISTING_KEY" or row["outcomesAccessed"] is not False:
            fail("ledger row lock changed")
        if row["semanticStates"] != {semantic: "UNRESOLVED" for semantic in SEMANTICS}:
            fail("semantic state promoted")
        if type(row["partialEvidenceRefs"]) is not list:
            fail("partial evidence refs changed")
        previous = None
        for ref in row["partialEvidenceRefs"]:
            exact_keys(ref, set(REF_KEYS), "evidence ref")
            if ref["semantic"] not in SEMANTICS or ref["laneId"] not in LANE_ORDER or type(ref["sourceRecordId"]) is not str or not ref["sourceRecordId"]:
                fail("evidence ref value changed")
            if ref["semantic"] not in contract["evidenceLaneContract"]["lanes"][ref["laneId"]]["semantics"]:
                fail("evidence lane mapped to unauthorized semantic")
            order = (SEMANTICS.index(ref["semantic"]), LANE_ORDER.index(ref["laneId"]), ref["sourceRecordId"])
            if previous is not None and order <= previous:
                fail("evidence refs are not strict canonical order")
            previous = order
            semantic_sets[ref["semantic"]].add(row["queueRowId"])
        body = copy.deepcopy(row)
        claimed = body.pop("rowSha256")
        if claimed != sha(canonical(body)):
            fail("row self hash changed")
        pattern = "".join("1" if any(ref["semantic"] == semantic for ref in row["partialEvidenceRefs"]) else "0" for semantic in SEMANTICS)
        patterns[pattern] += 1
    stats = {
        "queueRows": len(rows), "targetSemanticCells": len(rows) * 5, "resolvedSemanticCells": 0,
        "unresolvedSemanticCells": len(rows) * 5, "canonicalEvidenceCellsMaterialized": 0,
        "rowsWithAnyPartialEvidence": sum(bool(row["partialEvidenceRefs"]) for row in rows),
        "rowsWithoutPartialEvidence": sum(not row["partialEvidenceRefs"] for row in rows),
        "partialEvidenceSemanticCells": sum(len(ids) for ids in semantic_sets.values()),
        "semanticCoverage": {semantic: {"partialEvidenceRows": len(ids), "resolvedRows": 0, "unresolvedRows": len(rows), "queueRowIdSequenceSha256": id_sequence(ids)} for semantic, ids in semantic_sets.items()},
        "coveragePatternCounts": dict(sorted(patterns.items())),
        "rowSelfSequenceSha256": sha(("\n".join(row["rowSha256"] for row in rows) + "\n").encode("utf-8")),
        "rowsCanonicalSha256": sha(canonical(rows)),
    }
    expected = copy.deepcopy(contract["expectedCoverage"])
    expected["rowSelfSequenceSha256"] = contract["projectionContract"]["rowSelfSequenceSha256"]
    expected["rowsCanonicalSha256"] = contract["projectionContract"]["rowsCanonicalSha256"]
    if stats != expected:
        fail("validated ledger coverage differs from contract")
    return stats


def build_report(contract: dict[str, Any]) -> dict[str, Any]:
    rows, stats = build_rows(contract)
    report = {
        "schema": "sec-terminal-wealth-evidence-coverage-ledger/v1",
        "taskId": contract["taskId"],
        "track": contract["track"],
        "contractRawSha256": CONTRACT_RAW,
        "queueRawSha256": contract["authoritativeInputs"]["terminalWealthQueue"]["rawSha256"],
        "coverage": stats,
        "claimLocks": copy.deepcopy(EXPECTED_LOCKS),
        "rows": rows,
        "outcomesAccessed": False,
    }
    report["reportSha256"] = self_hash(report, "reportSha256")
    return report


def validate_report(value: dict[str, Any], contract: dict[str, Any], source_rebuild: bool = True) -> dict[str, Any]:
    exact_keys(value, {"schema", "taskId", "track", "contractRawSha256", "queueRawSha256", "coverage", "claimLocks", "rows", "outcomesAccessed", "reportSha256"}, "report")
    if value["schema"] != "sec-terminal-wealth-evidence-coverage-ledger/v1" or value["taskId"] != contract["taskId"] or value["track"] != contract["track"]:
        fail("report identity changed")
    if value["contractRawSha256"] != CONTRACT_RAW or value["queueRawSha256"] != contract["authoritativeInputs"]["terminalWealthQueue"]["rawSha256"]:
        fail("report bindings changed")
    if value["claimLocks"] != EXPECTED_LOCKS or value["outcomesAccessed"] is not False:
        fail("report claim locks changed")
    if value["reportSha256"] != self_hash(value, "reportSha256"):
        fail("report self hash changed")
    stats = validate_rows(value["rows"], contract)
    if value["coverage"] != stats:
        fail("report coverage differs from rows")
    if source_rebuild:
        rebuilt = build_report(contract)
        if canonical(value) != canonical(rebuilt):
            fail("report differs from source-derived rebuild")
    return stats


def verify_repository(remote_required: bool, allow_output: bool = True) -> dict[str, Any]:
    if not remote_required:
        fail("remote verification is required")
    contract = load_contract()
    impl = contract["implementationContract"]
    if git("remote", "get-url", "origin") != REMOTE:
        fail("origin URL changed")
    head = git("rev-parse", "HEAD")
    upstream = git("rev-parse", "@{u}")
    live = remote_head()
    if head != upstream or head != live:
        fail("HEAD, upstream and live remote differ")
    result = subprocess.run(["git", "merge-base", "--is-ancestor", BASE, head], cwd=ROOT, check=False)
    if result.returncode:
        fail("base commit is not an ancestor")
    if sha(BUILDER.read_bytes()) == "":
        fail("builder unavailable")
    if sha(normalized_builder(BUILDER.read_bytes())) != impl["builderNormalizedSha256"]:
        fail("builder normalized bytes changed")
    if sha(normalized_test(TEST.read_bytes())) != impl["testNormalizedSha256"]:
        fail("test normalized bytes changed")
    introductions = [introduction_for(path) for path in OWNED]
    if all(not entries for entries in introductions):
        if head != BASE:
            fail("pre-introduction phase requires exact base HEAD")
        if any(path.exists() and sha(path.read_bytes()) == "" for path in OWNED):
            fail("owned pre-introduction file unavailable")
        if OUTPUT.exists():
            fail("output exists before implementation introduction")
        return {"phase": "PRE_INTRODUCTION", "head": head, "introductionCommit": None, "outputPresent": False, "remoteVerified": True}
    if not all(len(entries) == 1 for entries in introductions):
        fail("owned introduction topology changed")
    intro = introductions[0][0]
    if any(entries[0] != intro for entries in introductions):
        fail("owned files do not share one introduction")
    parents = git("show", "-s", "--format=%P", intro).split()
    if parents != [BASE]:
        fail("implementation introduction is not direct single-parent child of base")
    expected_adds = [("A", path.relative_to(ROOT).as_posix()) for path in OWNED]
    if changed_paths(intro) != expected_adds:
        fail("implementation introduction diff changed")
    for path in OWNED:
        if git_raw(intro, path) != path.read_bytes() or git_raw(head, path) != path.read_bytes():
            fail("owned Git bytes changed")
    output_intros = introduction_for(OUTPUT)
    if not output_intros:
        if OUTPUT.exists():
            fail("untracked output exists after implementation introduction")
        return {"phase": "IMPLEMENTED_NO_OUTPUT", "head": head, "introductionCommit": intro, "outputPresent": False, "remoteVerified": True}
    if len(output_intros) != 1:
        fail("output introduction topology changed")
    output_intro = output_intros[0]
    if git("show", "-s", "--format=%P", output_intro).split() != [intro]:
        fail("output introduction is not direct child of implementation introduction")
    if changed_paths(output_intro) != [("A", OUTPUT.relative_to(ROOT).as_posix())]:
        fail("output introduction diff changed")
    if not allow_output:
        fail("output forbidden in this phase")
    if not OUTPUT.exists() or git_raw(head, OUTPUT) != OUTPUT.read_bytes():
        fail("output Git/worktree bytes differ")
    report = json.loads(OUTPUT.read_bytes())
    stats = validate_report(report, contract)
    return {"phase": "OUTPUT_INTRODUCED", "head": head, "introductionCommit": intro, "outputIntroductionCommit": output_intro, "outputPresent": True, "remoteVerified": True, "reportSha256": report["reportSha256"], "coverage": stats}


def reseal_contract(value: dict[str, Any]) -> None:
    value["contractSha256"] = self_hash(value, "contractSha256")


def self_test() -> dict[str, bool]:
    contract = load_contract()
    baseline = build_report(contract)
    validate_report(copy.deepcopy(baseline), contract)
    checks: dict[str, bool] = {}

    def killed(name: str, mutate: Callable[[dict[str, Any]], None], source_rebuild: bool = False) -> None:
        candidate = copy.deepcopy(baseline)
        mutate(candidate)
        for row in candidate["rows"]:
            body = copy.deepcopy(row)
            body.pop("rowSha256", None)
            row["rowSha256"] = sha(canonical(body))
        candidate["reportSha256"] = self_hash(candidate, "reportSha256")
        try:
            validate_report(candidate, contract, source_rebuild=source_rebuild)
        except Exception:
            checks[name] = True
        else:
            fail(f"mutation survived: {name}")

    def contract_killed(name: str, mutate: Callable[[dict[str, Any]], None]) -> None:
        candidate = copy.deepcopy(contract)
        mutate(candidate)
        reseal_contract(candidate)
        try:
            validate_contract(candidate, verify_dependencies=False)
        except Exception:
            checks[name] = True
        else:
            fail(f"contract mutation survived: {name}")

    killed("rowLoss", lambda item: item["rows"].pop())
    killed("rowReorder", lambda item: item["rows"].__setitem__(slice(0, 2), list(reversed(item["rows"][:2]))))
    killed("semanticPromotion", lambda item: item["rows"][0]["semanticStates"].__setitem__("HISTORICAL_VALIDITY_INTERVAL", "RESOLVED"))
    killed("canonicalCellPromotion", lambda item: item["rows"][0].__setitem__("canonicalEvidenceCellMaterialized", True))
    killed("identityPromotion", lambda item: item["rows"][0].__setitem__("identityKeyState", "RESOLVED"))
    killed("outcomesPromotion", lambda item: item["rows"][0].__setitem__("outcomesAccessed", True))
    killed("laneSemanticSwap", lambda item: item["rows"][0]["partialEvidenceRefs"][0].__setitem__("semantic", "TERMINAL_WEALTH"))
    killed("sourceRecordMutation", lambda item: item["rows"][0]["partialEvidenceRefs"][0].__setitem__("sourceRecordId", "0" * 64), source_rebuild=True)
    killed("coverageOverclaim", lambda item: item["coverage"].__setitem__("resolvedSemanticCells", 1))
    killed("gateCredit", lambda item: item["claimLocks"].__setitem__("originalV4GateCredit", True))
    contract_killed("purposeOverclaim", lambda item: item.__setitem__("purpose", "All five semantics are complete."))
    contract_killed("cellMaterializedOverclaim", lambda item: item["authoritativeCellContract"].__setitem__("projectionIsCanonicalEvidenceCell", True))
    contract_killed("missingnessOverclaim", lambda item: item["projectionContract"].__setitem__("notFoundDoesNotMeanComplete", False))
    contract_killed("resolvedCountOverclaim", lambda item: item["expectedCoverage"].__setitem__("resolvedSemanticCells", 1))
    contract_killed("ohlcvPartialOverclaim", lambda item: item["expectedCoverage"]["semanticCoverage"]["CONSOLIDATED_ADJUSTED_OHLCV"].__setitem__("partialEvidenceRows", 1))
    contract_killed("laneMapMutation", lambda item: item["evidenceLaneContract"]["frozenDistributionQueueMappings"]["0000891377-11-000008"].__setitem__("queueRowId", "SEC-TW-00000001"))
    contract_killed("inputPathRedirect", lambda item: item["authoritativeInputs"]["terminalWealthQueue"].__setitem__("path", "reports/early-detection/other.json"))
    contract_killed("dependencyHashDrift", lambda item: item["authoritativeInputs"]["liquidationReconciliation"].__setitem__("builderRawSha256", "0" * 64))
    contract_killed("remoteDrift", lambda item: item["implementationContract"].__setitem__("remote", "https://example.invalid/repo.git"))
    contract_killed("futureTimestamp", lambda item: item.__setitem__("createdAt", "2099-01-01T00:00:00Z"))
    contract_killed("unknownCreditKey", lambda item: item["claimLocks"].__setitem__("unknownScientificCredit", True))
    return checks


def atomic_create(path: Path, raw: bytes) -> None:
    if path.exists():
        fail("output already exists")
    temp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    if temp.exists():
        fail("temporary output path already exists")
    try:
        with temp.open("xb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.link(temp, path)
    finally:
        if temp.exists():
            temp.unlink()


def result_base(status: str) -> dict[str, Any]:
    return {"schema": "sec-terminal-wealth-evidence-coverage-ledger-verification/v1", "status": status, "outcomesAccessed": False}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["verify-contract", "self-test", "dry-run", "verify-output", "build"])
    parser.add_argument("--remote", action="store_true")
    args = parser.parse_args()
    try:
        contract = load_contract()
        if args.command == "verify-contract":
            result = result_base("PASS")
            result.update({"contractRawSha256": CONTRACT_RAW, "contractSha256": CONTRACT_SELF})
        elif args.command == "self-test":
            checks = self_test()
            result = result_base("PASS")
            result.update({"mutationKills": checks, "mutationKillCount": len(checks)})
        elif args.command == "dry-run":
            repository = verify_repository(args.remote, allow_output=False)
            report = build_report(contract)
            result = result_base("PASS")
            result.update(repository)
            result.update({"publicOutputCreated": False, "reportSha256": report["reportSha256"], "coverage": report["coverage"]})
        elif args.command == "verify-output":
            repository = verify_repository(args.remote, allow_output=True)
            if repository["phase"] != "OUTPUT_INTRODUCED":
                fail("output has not been introduced")
            result = result_base("PASS")
            result.update(repository)
        else:
            repository = verify_repository(args.remote, allow_output=False)
            if repository["phase"] != "IMPLEMENTED_NO_OUTPUT":
                fail("build requires committed implementation without output")
            report = build_report(contract)
            raw = pretty(report)
            atomic_create(OUTPUT, raw)
            result = result_base("PASS")
            result.update(repository)
            result.update({"outputCreated": True, "outputPath": OUTPUT.relative_to(ROOT).as_posix(), "rawSha256": sha(raw), "bytes": len(raw), "reportSha256": report["reportSha256"], "coverage": report["coverage"]})
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        return 0
    except Exception as error:
        print(json.dumps({"schema": "sec-terminal-wealth-evidence-coverage-ledger-verification/v1", "status": "FAIL", "error": str(error), "outcomesAccessed": False}, ensure_ascii=False, sort_keys=True), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
