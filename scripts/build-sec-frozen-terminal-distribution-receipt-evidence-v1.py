#!/usr/bin/env python3
"""Rebuild exactly five frozen SEC distribution/receipt evidence statements."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import subprocess
import tempfile
import types
from collections import Counter
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-frozen-terminal-distribution-receipt-evidence-contract-v1.json"
RECONCILIATION = ROOT / "reports" / "early-detection" / "sec-terminal-candidate-reconciliation-v1.json"
INVENTORY = ROOT / "reports" / "early-detection" / "sec-terminal-wealth-original-inventory-v4.json"
OUTPUT = ROOT / "reports" / "early-detection" / "sec-frozen-terminal-distribution-receipt-evidence-v1.json"
BUILDER = Path(__file__).resolve()
TEST = ROOT / "tests" / "build-sec-frozen-terminal-distribution-receipt-evidence-v1.test.js"
SOURCE_REBUILD_BUILDER = ROOT / "scripts" / "build-sec-same-sentence-effective-fixed-cash-v2.py"
RECONCILIATION_CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-terminal-candidate-reconciliation-contract-v1.json"
RECONCILIATION_BUILDER = ROOT / "scripts" / "build-sec-terminal-candidate-reconciliation-v1.py"
RECONCILIATION_TEST = ROOT / "tests" / "build-sec-terminal-candidate-reconciliation-v1.test.js"
INVENTORY_CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-terminal-wealth-original-inventory-contract-v4.json"
INVENTORY_BUILDER = ROOT / "scripts" / "build-sec-terminal-wealth-original-inventory-v4.py"
INVENTORY_TEST = ROOT / "tests" / "build-sec-terminal-wealth-original-inventory-v4.test.js"
CORPUS_ROOT = Path(r"C:\Users\Anwender\Documents\GrowthScreenerResearchData\early-detection-v4\corporate-action-originals\blobs\sha256")
AUTHORIZED_REMOTE_URL = "https://github.com/Karlryl/screener-data.git"
AUTHORIZED_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
PRE_IMPLEMENTATION_PARENT = "9695c0f7fdc04d145c52afba8a242baed3fdb7b3"
EXPECTED_CONTRACT_RAW = "ac6e7fb337c897b1c7b6829c9beb0136e5a1d902e38d6f9e9bac261421edb9f4"
EXPECTED_RECONCILIATION_RAW = "e38823a9701a7ea58afc1a91e5ed209837251f2e397fdf9d31bc4433831b4fa0"
EXPECTED_RECONCILIATION_REPORT = "a05ba1777da74a076698dfbb8bcbb43315f6ddcd1eb78cb5d7c3e5b64e7761ab"
EXPECTED_RECONCILIATION_ROWS = 16507
EXPECTED_RECONCILIATION_INTRO = "8ff267c0afc257ec2db3e72c512050fbcbb102f8"
EXPECTED_RECONCILIATION_CONTRACT_RAW = "eb079123cd3f7aadae577ef811dd4b8f729f53b5fc29c403af9dee99b35225cf"
EXPECTED_RECONCILIATION_BUILDER_RAW = "d2b4c9ec91ed5f54971edb6dbe8c581ae9d4644f657f66397e662ca2e6ab6bb7"
EXPECTED_RECONCILIATION_TEST_RAW = "3d91c52cf2c4de38329773a3abbbabd75b0137f0221cce52aa4e1ae09d947445"
EXPECTED_INVENTORY_RAW = "7a2947b66b9cdc26e829d19a4342b7effbbcea1c8296ca0bc46d4e05217c9711"
EXPECTED_INVENTORY_REPORT = "b52b25d27e826872c83d920c3976a6aa9185c337ac48620e85ffbf323d550ab2"
EXPECTED_INVENTORY_ROWS = 44352
EXPECTED_INVENTORY_TREE = "47b24e7e3fefe343656eaee8b256cf0a4978c3b9e39d3d1932a4265ad976ed4f"
EXPECTED_INVENTORY_INTRO = "a0218f4344ffa853f83a7123f886fb289cfda2e4"
EXPECTED_INVENTORY_CONTRACT_RAW = "a59a7fc9d1f2c6e1e19b9469d32fc7852f4d899374672480b8cbc690cfdf0d76"
EXPECTED_INVENTORY_BUILDER_RAW = "cb46d6d97d7da4433f9436ca20c18cf02ddfdeee1a7851618c3d719377ae2178"
EXPECTED_INVENTORY_TEST_RAW = "28d799c9961bcd4f0f33d6833d8d73aa52b75c9bd8ad621de826630fb8bcf080"
EXPECTED_SOURCE_REBUILD_BUILDER_RAW = "3edea67db65e2923adb1d816c81c2201a80fa87dd246b6af2418ef5c32d38095"
EXPECTED_SCOPE = "EXACT_FIVE_FROZEN_PRIMARY_SEC_SENTENCES_ONLY_NO_GENERAL_SELECTOR"
EXPECTED_SEMANTIC_CEILING = "THREE_DATED_FINAL_DISTRIBUTION_STATEMENTS_ONE_EFFECTED_FIRST_LIQUIDATING_DISTRIBUTION_BY_CHECKS_STATEMENT_AND_ONE_ACTUAL_DEFAULT_MIXED_CONSIDERATION_RECEIPT_STATEMENT"
EXPECTED_KINDS = {
    "ACTUAL_DEFAULT_MIXED_CONSIDERATION_RECEIVED_STATED": 1,
    "ACTUAL_FIRST_LIQUIDATING_DISTRIBUTION_BY_CHECKS_STATED": 1,
    "DATED_FINAL_DISTRIBUTION_TO_HOLDERS_STATED": 3,
}
EXPECTED_NO_GO = [
    "ALL_HOLDERS_RECEIVED",
    "CASH_ONLY_CONSIDERATION",
    "FINAL_LIQUIDATING_DISTRIBUTION",
    "FULL_CORPORATE_ACTION_CHAIN",
    "NO_FURTHER_DISTRIBUTIONS",
    "ORIGINAL_V4_GATE_CREDIT",
    "POST_CLOSING_RECOVERY",
    "TERMINAL_SESSION_COMPLETE",
    "TERMINAL_WEALTH_COMPLETE",
]
EXPECTED_EXCLUSIONS = [
    "CONDITIONAL_OR_IF_ANY_PAYMENT",
    "CURRENTLY_ESTIMATED_OR_UP_TO_AMOUNT",
    "CVR_OR_OTHER_RIGHT_WITHOUT_PAYMENT",
    "FIRST_OR_INITIAL_DISTRIBUTION_AS_FINAL",
    "FUTURE_PAYMENT_OR_RELEASE",
    "GENERIC_SENTENCE_WITHOUT_ACCESSION_AND_TITLE_CLASS_BINDING",
    "PERMITS_DISTRIBUTION_WITHOUT_PAYMENT_OR_RECEIPT",
    "PRE_CLOSING_PROCEEDS_AS_POST_CLOSING_RECOVERY",
    "RIGHT_TO_RECEIVE_AS_ACTUAL_RECEIPT",
    "TENDER_PAYMENT_AS_NON_TENDERED_HOLDER_RECEIPT",
]
EXPECTED_CLAIM_LOCKS = {
    "actualCashReceiptForAllRows": False,
    "allHoldersVerified": False,
    "cashOnlyVerified": False,
    "corporateActionChainComplete": False,
    "finalLiquidatingDistributionVerified": False,
    "historicalIdentityResolved": False,
    "noFurtherDistributionsVerified": False,
    "noLaterRecoveryVerified": False,
    "originalV4GateCredit": False,
    "outcomesAccessed": False,
    "postClosingRecoveryVerified": False,
    "terminalSessionComplete": False,
    "terminalWealthComplete": False,
}
SOURCE_REF_KEYS = {
    "blobSha256", "bytes", "documentFilename", "documentIndex", "documentSequence",
    "documentType", "evidenceSentenceIndex", "evidenceSentenceSha256", "normalizationMode",
    "rawDocumentSha256", "rawTextSha256", "relativePath", "titleClassEnd",
    "titleClassSentenceIndex", "titleClassSentenceSha256", "titleClassStart", "titleClassText",
}
SEMANTIC_KEYS = {
    "actualCashReceiptVerified", "cashAmount", "currencyMarker", "distributionDate",
    "distributionDateQualifier", "distributionEffectedStated", "finalDistributionStated",
    "firstDistributionStated", "liquidatingDistributionStated", "mixedConsiderationStated",
    "recipientScope", "stockRatio", "stockSecurityText",
}
ROW_SPEC_KEYS = {
    "accession", "evidenceKind", "evidenceText", "inventoryAccessionRowCount",
    "reconciliationWitness", "semanticValues", "sourceRef",
}
REPORT_ROW_KEYS = {
    "accession", "evidenceKind", "evidenceText", "evidenceTextSha256", "semanticValues",
    "sourceRef", "titleClassText",
}
EXCLUSION_FIXTURES = {
    "CONDITIONAL_OR_IF_ANY_PAYMENT": "a contingent cash payment will be made if a future milestone is achieved",
    "CURRENTLY_ESTIMATED_OR_UP_TO_AMOUNT": "currently estimated to be up to $0.04 per share",
    "CVR_OR_OTHER_RIGHT_WITHOUT_PAYMENT": "holders received contingent value rights",
    "FIRST_OR_INITIAL_DISTRIBUTION_AS_FINAL": "the initial liquidating distribution was made",
    "FUTURE_PAYMENT_OR_RELEASE": "the amount will be paid into escrow and released following closing",
    "GENERIC_SENTENCE_WITHOUT_ACCESSION_AND_TITLE_CLASS_BINDING": "a final distribution to holders occurred",
    "PERMITS_DISTRIBUTION_WITHOUT_PAYMENT_OR_RECEIPT": "the proceeds permit a net distribution per ADS",
    "PRE_CLOSING_PROCEEDS_AS_POST_CLOSING_RECOVERY": "additional cash includes proceeds received prior to closing",
    "RIGHT_TO_RECEIVE_AS_ACTUAL_RECEIPT": "shares were converted into the right to receive cash",
    "TENDER_PAYMENT_AS_NON_TENDERED_HOLDER_RECEIPT": "the same consideration was paid in the tender offer",
}


class EvidenceError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise EvidenceError(message)


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        fail(f"{label} exact keys changed")


def git(*args: str) -> str:
    run = subprocess.run(["git", *args], cwd=ROOT, check=False, capture_output=True, text=True, encoding="utf-8")
    if run.returncode:
        fail("git binding failed")
    return run.stdout.strip()


def git_bytes(commit: str, path: Path) -> bytes:
    run = subprocess.run(["git", "show", f"{commit}:{path.relative_to(ROOT).as_posix()}"], cwd=ROOT, check=False, capture_output=True)
    if run.returncode:
        fail("Git blob missing")
    return run.stdout


def load_source_module() -> types.ModuleType:
    raw = SOURCE_REBUILD_BUILDER.read_bytes()
    if sha(raw) != EXPECTED_SOURCE_REBUILD_BUILDER_RAW:
        fail("source rebuild implementation changed")
    module = types.ModuleType("frozen_terminal_source_rebuild_bound")
    module.__file__ = str(SOURCE_REBUILD_BUILDER)
    exec(compile(raw, str(SOURCE_REBUILD_BUILDER), "exec"), module.__dict__)
    return module


BASE = load_source_module()


def expected_inputs() -> dict[str, Any]:
    return {
        "candidateReconciliation": {
            "builderRawSha256": EXPECTED_RECONCILIATION_BUILDER_RAW,
            "contractRawSha256": EXPECTED_RECONCILIATION_CONTRACT_RAW,
            "introductionCommit": EXPECTED_RECONCILIATION_INTRO,
            "path": "reports/early-detection/sec-terminal-candidate-reconciliation-v1.json",
            "rawSha256": EXPECTED_RECONCILIATION_RAW,
            "reportSha256": EXPECTED_RECONCILIATION_REPORT,
            "rows": EXPECTED_RECONCILIATION_ROWS,
            "testRawSha256": EXPECTED_RECONCILIATION_TEST_RAW,
        },
        "originalInventory": {
            "blobTreeSequenceSha256": EXPECTED_INVENTORY_TREE,
            "builderRawSha256": EXPECTED_INVENTORY_BUILDER_RAW,
            "contractRawSha256": EXPECTED_INVENTORY_CONTRACT_RAW,
            "introductionCommit": EXPECTED_INVENTORY_INTRO,
            "path": "reports/early-detection/sec-terminal-wealth-original-inventory-v4.json",
            "rawSha256": EXPECTED_INVENTORY_RAW,
            "reportSha256": EXPECTED_INVENTORY_REPORT,
            "rows": EXPECTED_INVENTORY_ROWS,
            "testRawSha256": EXPECTED_INVENTORY_TEST_RAW,
        },
        "sourceRebuildImplementation": {
            "builderPath": "scripts/build-sec-same-sentence-effective-fixed-cash-v2.py",
            "builderRawSha256": EXPECTED_SOURCE_REBUILD_BUILDER_RAW,
        },
    }


def expected_implementation_contract() -> dict[str, Any]:
    return {
        "builderPath": "scripts/build-sec-frozen-terminal-distribution-receipt-evidence-v1.py",
        "outputAbsentAtBuildBase": True,
        "outputIntroductionDirectChildOfBuildBase": True,
        "preImplementationParentCommit": PRE_IMPLEMENTATION_PARENT,
        "remoteRef": AUTHORIZED_REF,
        "remoteUrl": AUTHORIZED_REMOTE_URL,
        "singleParentBuildBase": True,
        "testPath": "tests/build-sec-frozen-terminal-distribution-receipt-evidence-v1.test.js",
    }


def validate_contract_value(value: dict[str, Any]) -> None:
    exact_keys(value, {"schema", "createdAt", "taskId", "track", "purpose", "inputs", "evidenceContract", "implementationContract", "output", "claimLocks"}, "contract")
    if value["schema"] != "early-detection-sec-frozen-terminal-distribution-receipt-evidence-contract/v1" or value["taskId"] != "Q003-SEC-FROZEN-TERMINAL-DISTRIBUTION-RECEIPT-EVIDENCE-V1" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract boundary changed")
    if value["inputs"] != expected_inputs() or value["implementationContract"] != expected_implementation_contract():
        fail("input or implementation binding changed")
    if value["output"] != {"path": "reports/early-detection/sec-frozen-terminal-distribution-receipt-evidence-v1.json", "writeNewAtomic": True}:
        fail("output contract changed")
    if value["claimLocks"] != EXPECTED_CLAIM_LOCKS:
        fail("claim locks changed")
    policy = value["evidenceContract"]
    exact_keys(policy, {"exactFrozenSentenceSetRequired", "excludedSemanticClasses", "expectedEvidenceKindCounts", "expectedRows", "frozenRows", "futureRowsRequireNewProtocol", "noGoClaims", "scopeLimit", "semanticCeiling"}, "evidence contract")
    if policy["exactFrozenSentenceSetRequired"] is not True or policy["futureRowsRequireNewProtocol"] is not True or policy["expectedRows"] != 5:
        fail("frozen population requirements changed")
    if policy["expectedEvidenceKindCounts"] != EXPECTED_KINDS or policy["noGoClaims"] != EXPECTED_NO_GO or policy["excludedSemanticClasses"] != EXPECTED_EXCLUSIONS:
        fail("evidence kinds, no-go claims or exclusions changed")
    if policy["scopeLimit"] != EXPECTED_SCOPE or policy["semanticCeiling"] != EXPECTED_SEMANTIC_CEILING:
        fail("semantic scope changed")
    rows = policy["frozenRows"]
    if not isinstance(rows, list) or len(rows) != 5 or [row.get("accession") for row in rows] != sorted(row.get("accession") for row in rows):
        fail("frozen row ordering changed")
    if Counter(row.get("evidenceKind") for row in rows) != Counter(EXPECTED_KINDS):
        fail("frozen evidence kind counts changed")
    if len({row.get("accession") for row in rows}) != 5 or len({row.get("sourceRef", {}).get("blobSha256") for row in rows}) != 5:
        fail("frozen accession or blob cardinality changed")
    for row in rows:
        exact_keys(row, ROW_SPEC_KEYS, "frozen row")
        exact_keys(row["reconciliationWitness"], {"accessionOccurrenceCount", "occurrenceId", "sourceRowId"}, "reconciliation witness")
        exact_keys(row["semanticValues"], SEMANTIC_KEYS, "semantic values")
        exact_keys(row["sourceRef"], SOURCE_REF_KEYS, "source reference")
        ref = row["sourceRef"]
        for key in ("blobSha256", "evidenceSentenceSha256", "rawDocumentSha256", "rawTextSha256", "titleClassSentenceSha256"):
            if not isinstance(ref[key], str) or re.fullmatch(r"[0-9a-f]{64}", ref[key]) is None:
                fail("source hash changed")
        if ref["relativePath"] != f"{ref['blobSha256'][:2]}/{ref['blobSha256']}.txt" or ref["evidenceSentenceSha256"] != sha(row["evidenceText"].encode("utf-8")):
            fail("source path or evidence hash changed")
        if not isinstance(row["inventoryAccessionRowCount"], int) or row["inventoryAccessionRowCount"] < 1 or not isinstance(row["reconciliationWitness"]["accessionOccurrenceCount"], int) or row["reconciliationWitness"]["accessionOccurrenceCount"] < 1:
            fail("source population count changed")
        if not isinstance(ref["titleClassStart"], int) or not isinstance(ref["titleClassEnd"], int) or ref["titleClassStart"] < 0 or ref["titleClassEnd"] <= ref["titleClassStart"]:
            fail("title-class offsets changed")


def validate_contract() -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    if sha(raw) != EXPECTED_CONTRACT_RAW:
        fail("contract raw bytes changed")
    value = json.loads(raw)
    validate_contract_value(value)
    return value


def validate_self_hash(value: dict[str, Any], expected: str, label: str) -> None:
    body = dict(value)
    claim = body.pop("reportSha256", None)
    if claim != expected or sha(canonical(body)) != expected:
        fail(f"{label} self hash changed")


def load_reconciliation() -> dict[str, Any]:
    raw = RECONCILIATION.read_bytes()
    if sha(raw) != EXPECTED_RECONCILIATION_RAW:
        fail("reconciliation raw bytes changed")
    value = json.loads(raw)
    exact_keys(value, {"claimLocks", "implementationBindings", "inputBindings", "population", "reportSha256", "rows", "schema", "taskId", "track"}, "reconciliation")
    validate_self_hash(value, EXPECTED_RECONCILIATION_REPORT, "reconciliation")
    if value["schema"] != "early-detection-sec-terminal-candidate-reconciliation/v1" or len(value["rows"]) != EXPECTED_RECONCILIATION_ROWS:
        fail("reconciliation schema or population changed")
    expected_locks = {
        "candidateStatusOnly": True,
        "identityResolved": False,
        "lastTradingSessionProven": False,
        "originalV4GateCredit": False,
        "outcomesAccessed": False,
        "paymentVerified": False,
        "priceDataAccessed": False,
        "primaryDocumentReconciled": False,
        "resultComputationAllowed": False,
        "returnComputed": False,
        "terminalWealthComplete": False,
    }
    if value["inputBindings"].get("blobTreeSequenceSha256") != EXPECTED_INVENTORY_TREE or value["claimLocks"] != expected_locks:
        fail("reconciliation provenance or locks changed")
    if len({row.get("occurrenceId") for row in value["rows"]}) != EXPECTED_RECONCILIATION_ROWS or any(row.get("outcomesAccessed") is not False for row in value["rows"]):
        fail("reconciliation row identity or outcome lock changed")
    return value


def load_inventory() -> dict[str, Any]:
    raw = INVENTORY.read_bytes()
    if sha(raw) != EXPECTED_INVENTORY_RAW:
        fail("inventory raw bytes changed")
    value = json.loads(raw)
    exact_keys(value, {"blobTreeSequenceSha256", "claimLocks", "contractRawSha256", "counts", "duplicateAccessions", "implementationBindings", "queueRawSha256", "reportSha256", "rows", "schema", "taskId", "track"}, "inventory")
    validate_self_hash(value, EXPECTED_INVENTORY_REPORT, "inventory")
    if value["schema"] != "early-detection-sec-terminal-wealth-original-inventory/v4" or len(value["rows"]) != EXPECTED_INVENTORY_ROWS or value["blobTreeSequenceSha256"] != EXPECTED_INVENTORY_TREE:
        fail("inventory schema, population or tree changed")
    if any(item is not False for item in value["claimLocks"].values()) or any(row.get("outcomesAccessed") is not False for row in value["rows"]):
        fail("inventory outcome lock changed")
    return value


def validate_dependency_bytes() -> None:
    expected = {
        RECONCILIATION_CONTRACT: EXPECTED_RECONCILIATION_CONTRACT_RAW,
        RECONCILIATION_BUILDER: EXPECTED_RECONCILIATION_BUILDER_RAW,
        RECONCILIATION_TEST: EXPECTED_RECONCILIATION_TEST_RAW,
        INVENTORY_CONTRACT: EXPECTED_INVENTORY_CONTRACT_RAW,
        INVENTORY_BUILDER: EXPECTED_INVENTORY_BUILDER_RAW,
        INVENTORY_TEST: EXPECTED_INVENTORY_TEST_RAW,
        SOURCE_REBUILD_BUILDER: EXPECTED_SOURCE_REBUILD_BUILDER_RAW,
    }
    for path, claim in expected.items():
        if sha(path.read_bytes()) != claim:
            fail("dependency bytes changed")
    for path, intro in ((RECONCILIATION, EXPECTED_RECONCILIATION_INTRO), (INVENTORY, EXPECTED_INVENTORY_INTRO)):
        rows = subprocess.run(["git", "log", "--diff-filter=A", "--format=%H", "--", path.relative_to(ROOT).as_posix()], cwd=ROOT, check=False, capture_output=True, text=True, encoding="utf-8").stdout.strip().splitlines()
        if rows != [intro] or git("merge-base", "--is-ancestor", intro, "HEAD") != "":
            fail("input introduction lineage changed")


def verify_reconciliation_witness(spec: dict[str, Any], reconciliation: dict[str, Any]) -> None:
    rows = [row for row in reconciliation["rows"] if row.get("accession") == spec["accession"]]
    witness = spec["reconciliationWitness"]
    if len(rows) != witness["accessionOccurrenceCount"]:
        fail("reconciliation accession occurrence count changed")
    matches = [row for row in rows if row.get("occurrenceId") == witness["occurrenceId"]]
    if len(matches) != 1 or matches[0].get("sourceRowId") != witness["sourceRowId"]:
        fail("reconciliation witness changed")
    for row in rows:
        if row.get("sourceRowId") != witness["sourceRowId"] or row.get("sourceRef", {}).get("blobSha256") != spec["sourceRef"]["blobSha256"] or row.get("inventoryStatus") != "LOCAL_PRIMARY_PRESENT" or row.get("verificationStatus") != "CANDIDATE_ONLY" or row.get("reconciliationStatus") != "PRIMARY_DOCUMENT_REVIEW_REQUIRED":
            fail("reconciliation accession/blob/status binding changed")


def verify_inventory_witness(spec: dict[str, Any], inventory: dict[str, Any]) -> None:
    rows = [row for row in inventory["rows"] if row.get("accession") == spec["accession"]]
    if len(rows) != spec["inventoryAccessionRowCount"]:
        fail("inventory accession row count changed")
    witness_row_id = spec["reconciliationWitness"]["sourceRowId"]
    if len([row for row in rows if row.get("rowId") == witness_row_id]) != 1:
        fail("inventory witness row changed")
    for row in rows:
        refs = row.get("blobRefs")
        if row.get("inventoryStatus") != "LOCAL_PRIMARY_PRESENT" or not isinstance(refs, list) or len(refs) != 1 or refs[0].get("blobSha256") != spec["sourceRef"]["blobSha256"] or refs[0].get("relativePath") != spec["sourceRef"]["relativePath"] or refs[0].get("bytes") != spec["sourceRef"]["bytes"]:
            fail("inventory blob binding changed")


def source_document_and_sentences(spec: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    ref = spec["sourceRef"]
    root = CORPUS_ROOT.resolve()
    path = (CORPUS_ROOT / Path(ref["relativePath"])).resolve()
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise EvidenceError("source sidepath escaped CAS root") from exc
    if path.is_symlink() or not path.is_file():
        fail("source blob path changed")
    raw = path.read_bytes()
    if len(raw) != ref["bytes"] or sha(raw) != ref["blobSha256"]:
        fail("source blob bytes changed")
    accessions = BASE.ACCESSION_RE.findall(raw)
    if len(accessions) != 1 or accessions[0].decode("ascii") != spec["accession"]:
        fail("source accession changed")
    documents = BASE.sec_documents(raw)
    index = ref["documentIndex"]
    if not isinstance(index, int) or index < 1 or index > len(documents):
        fail("source document index changed")
    document = documents[index - 1]
    if document["TYPE"] != ref["documentType"] or document["SEQUENCE"] != ref["documentSequence"] or document["FILENAME"] != ref["documentFilename"] or sha(document["raw"]) != ref["rawDocumentSha256"] or sha(document["textRaw"]) != ref["rawTextSha256"]:
        fail("source document provenance changed")
    normalized, mode = BASE.normalize_text(document["textRaw"])
    if mode != ref["normalizationMode"]:
        fail("source normalization mode changed")
    return document, BASE.sentences(normalized)


def derive_semantics(spec: dict[str, Any], evidence: str) -> dict[str, Any]:
    kind = spec["evidenceKind"]
    if kind == "DATED_FINAL_DISTRIBUTION_TO_HOLDERS_STATED":
        match = re.fullmatch(r"Such filing preceded the ([A-Z][a-z]+ \d{1,2}, \d{4}) final distribution to the holders, which was the subject of a Form 8-K filed on ([A-Z][a-z]+ \d{1,2}, \d{4})\.", evidence)
        if match is None or BASE.parse_date(match.group(2)) != "2011-02-23":
            fail("frozen final-distribution grammar changed")
        return {
            "actualCashReceiptVerified": False, "cashAmount": None, "currencyMarker": None,
            "distributionDate": BASE.parse_date(match.group(1)), "distributionDateQualifier": "EXACT_DATE_STATED",
            "distributionEffectedStated": False, "finalDistributionStated": True,
            "firstDistributionStated": False, "liquidatingDistributionStated": False,
            "mixedConsiderationStated": False, "recipientScope": "HOLDERS_OF_BOUND_TITLE_CLASS",
            "stockRatio": None, "stockSecurityText": None,
        }
    if kind == "ACTUAL_FIRST_LIQUIDATING_DISTRIBUTION_BY_CHECKS_STATED":
        match = re.fullmatch(r"The Company is in summary wind up and liquidation under the laws of its jurisdiction, and has effected its first liquidating distribution to confirmed shareholders of record as of ([A-Z][a-z]+ \d{1,2}, \d{4}), by mailing checks to such shareholders on or about ([A-Z][a-z]+ \d{1,2}, \d{4})\.", evidence)
        if match is None or BASE.parse_date(match.group(1)) != "2011-01-05":
            fail("frozen first-liquidating-distribution grammar changed")
        return {
            "actualCashReceiptVerified": False, "cashAmount": None, "currencyMarker": None,
            "distributionDate": BASE.parse_date(match.group(2)), "distributionDateQualifier": "ON_OR_ABOUT",
            "distributionEffectedStated": True, "finalDistributionStated": False,
            "firstDistributionStated": True, "liquidatingDistributionStated": True,
            "mixedConsiderationStated": False, "recipientScope": f"CONFIRMED_SHAREHOLDERS_OF_RECORD_AS_OF_{BASE.parse_date(match.group(1))}",
            "stockRatio": None, "stockSecurityText": None,
        }
    if kind == "ACTUAL_DEFAULT_MIXED_CONSIDERATION_RECEIVED_STATED":
        match = re.fullmatch(r"Pretivm shareholders who did not elect cash or Newcrest Shares received default consideration of C\$(\d+\.\d+) per Pretivm Share in cash and (\d+\.\d+) Newcrest Shares per Pretivm Share\.", evidence)
        if match is None:
            fail("frozen mixed-receipt grammar changed")
        return {
            "actualCashReceiptVerified": True, "cashAmount": match.group(1), "currencyMarker": "C$",
            "distributionDate": None, "distributionDateQualifier": None, "distributionEffectedStated": False,
            "finalDistributionStated": False, "firstDistributionStated": False,
            "liquidatingDistributionStated": False, "mixedConsiderationStated": True,
            "recipientScope": "PRETIVM_SHAREHOLDERS_WHO_DID_NOT_ELECT_CASH_OR_NEWCREST_SHARES",
            "stockRatio": match.group(2), "stockSecurityText": "Newcrest Shares",
        }
    fail("unknown frozen evidence kind")


def rebuild_frozen_row(spec: dict[str, Any], reconciliation: dict[str, Any], inventory: dict[str, Any]) -> dict[str, Any]:
    verify_reconciliation_witness(spec, reconciliation)
    verify_inventory_witness(spec, inventory)
    _, sentences = source_document_and_sentences(spec)
    ref = spec["sourceRef"]
    evidence_index = ref["evidenceSentenceIndex"]
    title_index = ref["titleClassSentenceIndex"]
    if not isinstance(evidence_index, int) or evidence_index < 1 or evidence_index > len(sentences) or not isinstance(title_index, int) or title_index < 1 or title_index > len(sentences):
        fail("source sentence index changed")
    evidence = sentences[evidence_index - 1]
    title_sentence = sentences[title_index - 1]
    if evidence != spec["evidenceText"] or sha(evidence.encode("utf-8")) != ref["evidenceSentenceSha256"] or sha(title_sentence.encode("utf-8")) != ref["titleClassSentenceSha256"]:
        fail("frozen evidence or title-class sentence changed")
    start, end, title = ref["titleClassStart"], ref["titleClassEnd"], ref["titleClassText"]
    if end > len(title_sentence) or title_sentence[start:end] != title or title_sentence.count(title) != 1:
        fail("title-class text or offsets changed")
    semantics = derive_semantics(spec, evidence)
    if semantics != spec["semanticValues"]:
        fail("derived semantic values changed")
    return {
        "accession": spec["accession"],
        "evidenceKind": spec["evidenceKind"],
        "evidenceText": evidence,
        "evidenceTextSha256": sha(evidence.encode("utf-8")),
        "semanticValues": semantics,
        "sourceRef": copy.deepcopy(ref),
        "titleClassText": title,
    }


def build_rows(contract: dict[str, Any], reconciliation: dict[str, Any], inventory: dict[str, Any]) -> list[dict[str, Any]]:
    validate_contract_value(contract)
    rows = [rebuild_frozen_row(spec, reconciliation, inventory) for spec in contract["evidenceContract"]["frozenRows"]]
    if len(rows) != 5 or Counter(row["evidenceKind"] for row in rows) != Counter(EXPECTED_KINDS) or [row["accession"] for row in rows] != sorted(row["accession"] for row in rows):
        fail("built frozen population changed")
    return rows


def implementation_bindings(base_commit: str | None = None, remote_required: bool = False) -> dict[str, Any]:
    head = git("rev-parse", "HEAD")
    base = head if base_commit is None else base_commit
    if not isinstance(base, str) or re.fullmatch(r"[0-9a-f]{40}", base) is None:
        fail("invalid implementation base")
    builder_raw = git_bytes(base, BUILDER) if remote_required else BUILDER.read_bytes()
    test_raw = git_bytes(base, TEST) if remote_required else TEST.read_bytes()
    bindings = {
        "buildBaseCommit": base,
        "remoteUrl": AUTHORIZED_REMOTE_URL,
        "remoteRef": AUTHORIZED_REF,
        "contractRawSha256": sha(CONTRACT.read_bytes()),
        "builderRawSha256": sha(builder_raw),
        "testRawSha256": sha(test_raw),
        "reconciliationRawSha256": EXPECTED_RECONCILIATION_RAW,
        "inventoryRawSha256": EXPECTED_INVENTORY_RAW,
        "sourceRebuildBuilderRawSha256": EXPECTED_SOURCE_REBUILD_BUILDER_RAW,
    }
    if remote_required:
        if git("remote", "get-url", "origin") != AUTHORIZED_REMOTE_URL:
            fail("remote URL changed")
        remote = git("ls-remote", "--refs", "origin", AUTHORIZED_REF).splitlines()
        if len(remote) != 1 or remote[0].split()[0] != head or git("rev-parse", "@{upstream}") != head:
            fail("local, upstream and remote head differ")
        if git("rev-list", "--parents", "-n", "1", base).split() != [base, PRE_IMPLEMENTATION_PARENT]:
            fail("build base is not the sealed direct child")
        if subprocess.run(["git", "cat-file", "-e", f"{base}:{OUTPUT.relative_to(ROOT).as_posix()}"], cwd=ROOT, check=False, capture_output=True).returncode == 0:
            fail("output existed at build base")
        bound = {
            CONTRACT: bindings["contractRawSha256"], BUILDER: bindings["builderRawSha256"], TEST: bindings["testRawSha256"],
            RECONCILIATION: EXPECTED_RECONCILIATION_RAW, INVENTORY: EXPECTED_INVENTORY_RAW,
            RECONCILIATION_CONTRACT: EXPECTED_RECONCILIATION_CONTRACT_RAW, RECONCILIATION_BUILDER: EXPECTED_RECONCILIATION_BUILDER_RAW,
            RECONCILIATION_TEST: EXPECTED_RECONCILIATION_TEST_RAW, INVENTORY_CONTRACT: EXPECTED_INVENTORY_CONTRACT_RAW,
            INVENTORY_BUILDER: EXPECTED_INVENTORY_BUILDER_RAW, INVENTORY_TEST: EXPECTED_INVENTORY_TEST_RAW,
            SOURCE_REBUILD_BUILDER: EXPECTED_SOURCE_REBUILD_BUILDER_RAW,
        }
        for path, claim in bound.items():
            raw = git_bytes(base, path)
            if sha(raw) != claim or raw != path.read_bytes():
                fail("implementation or input Git blob changed")
        for path in (CONTRACT, BUILDER, TEST):
            if git("log", "-1", "--format=%H", "--", path.relative_to(ROOT).as_posix()) != base:
                fail("implementation path was not introduced at build base")
    return bindings


def build_report(contract: dict[str, Any], reconciliation: dict[str, Any], inventory: dict[str, Any], implementation: dict[str, Any]) -> dict[str, Any]:
    rows = build_rows(contract, reconciliation, inventory)
    counts = Counter(row["evidenceKind"] for row in rows)
    value = {
        "schema": "early-detection-sec-frozen-terminal-distribution-receipt-evidence/v1",
        "taskId": contract["taskId"],
        "track": contract["track"],
        "contractRawSha256": sha(CONTRACT.read_bytes()),
        "inputBindings": expected_inputs(),
        "implementationBindings": implementation,
        "scopeLimit": contract["evidenceContract"]["scopeLimit"],
        "semanticCeiling": contract["evidenceContract"]["semanticCeiling"],
        "noGoClaims": copy.deepcopy(contract["evidenceContract"]["noGoClaims"]),
        "population": {
            "frozenEvidenceRows": len(rows),
            "uniqueAccessions": len({row["accession"] for row in rows}),
            "datedFinalDistributionStatementRows": counts["DATED_FINAL_DISTRIBUTION_TO_HOLDERS_STATED"],
            "actualFirstLiquidatingDistributionByChecksStatementRows": counts["ACTUAL_FIRST_LIQUIDATING_DISTRIBUTION_BY_CHECKS_STATED"],
            "actualDefaultMixedConsiderationReceiptStatementRows": counts["ACTUAL_DEFAULT_MIXED_CONSIDERATION_RECEIVED_STATED"],
            "finalLiquidatingDistributionVerifiedRows": 0,
            "noFurtherDistributionsVerifiedRows": 0,
            "postClosingRecoveryVerifiedRows": 0,
            "terminalWealthCompleteRows": 0,
        },
        "rows": rows,
        "claimLocks": copy.deepcopy(contract["claimLocks"]),
        "outcomesAccessed": False,
    }
    value["reportSha256"] = sha(canonical(value))
    return value


def validate_report(value: dict[str, Any], contract: dict[str, Any], reconciliation: dict[str, Any], inventory: dict[str, Any], implementation: dict[str, Any]) -> None:
    exact_keys(value, {"schema", "taskId", "track", "contractRawSha256", "inputBindings", "implementationBindings", "scopeLimit", "semanticCeiling", "noGoClaims", "population", "rows", "claimLocks", "outcomesAccessed", "reportSha256"}, "report")
    for row in value.get("rows", []):
        exact_keys(row, REPORT_ROW_KEYS, "report row")
    body = dict(value)
    claim = body.pop("reportSha256", None)
    if claim != sha(canonical(body)) or value != build_report(contract, reconciliation, inventory, implementation):
        fail("report does not match exact source rebuild")
    if value["claimLocks"] != EXPECTED_CLAIM_LOCKS or value["outcomesAccessed"] is not False:
        fail("report claim boundary changed")


def rejected(action: Callable[[], None]) -> bool:
    try:
        action()
    except (EvidenceError, BASE.EvidenceError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError):
        return True
    return False


def rehash_report(value: dict[str, Any]) -> None:
    value["reportSha256"] = sha(canonical({key: item for key, item in value.items() if key != "reportSha256"}))


def self_test(contract: dict[str, Any], reconciliation: dict[str, Any], inventory: dict[str, Any]) -> dict[str, Any]:
    implementation = implementation_bindings()
    report = build_report(contract, reconciliation, inventory, implementation)
    validate_report(report, contract, reconciliation, inventory, implementation)
    kills: dict[str, bool] = {}
    for label, mutate in {
        "rowRemoved": lambda item: item["rows"].pop(),
        "evidenceKindChanged": lambda item: item["rows"][0].__setitem__("evidenceKind", "POST_CLOSING_RECOVERY"),
        "titleClassChanged": lambda item: item["rows"][1].__setitem__("titleClassText", "wrong class"),
        "semanticValueChanged": lambda item: item["rows"][4]["semanticValues"].__setitem__("cashAmount", "99"),
        "cashOnlyClaimed": lambda item: item["claimLocks"].__setitem__("cashOnlyVerified", True),
        "terminalWealthClaimed": lambda item: item["claimLocks"].__setitem__("terminalWealthComplete", True),
        "postClosingRecoveryClaimed": lambda item: item["population"].__setitem__("postClosingRecoveryVerifiedRows", 1),
        "noGoClaimRemoved": lambda item: item["noGoClaims"].pop(),
        "outcomeClaimed": lambda item: item.__setitem__("outcomesAccessed", True),
        "sourceEvidenceHashChanged": lambda item: item["rows"][0]["sourceRef"].__setitem__("evidenceSentenceSha256", "0" * 64),
        "sourceTitleHashChanged": lambda item: item["rows"][1]["sourceRef"].__setitem__("titleClassSentenceSha256", "0" * 64),
        "accessionCrossover": lambda item: item["rows"][0].__setitem__("accession", item["rows"][1]["accession"]),
        "inputBindingChanged": lambda item: item["inputBindings"]["candidateReconciliation"].__setitem__("rawSha256", "0" * 64),
    }.items():
        changed = copy.deepcopy(report)
        mutate(changed)
        rehash_report(changed)
        kills[label] = rejected(lambda changed=changed: validate_report(changed, contract, reconciliation, inventory, implementation))
    changed_contract = copy.deepcopy(contract)
    changed_contract["evidenceContract"]["frozenRows"].append(copy.deepcopy(changed_contract["evidenceContract"]["frozenRows"][0]))
    changed_contract["evidenceContract"]["expectedRows"] = 6
    kills["sixthRowAdded"] = rejected(lambda: build_rows(changed_contract, reconciliation, inventory))
    changed_contract = copy.deepcopy(contract)
    first = changed_contract["evidenceContract"]["frozenRows"][0]
    first["evidenceText"] += " altered"
    first["sourceRef"]["evidenceSentenceSha256"] = sha(first["evidenceText"].encode("utf-8"))
    kills["sourceSentenceChangedAndRehashed"] = rejected(lambda: build_rows(changed_contract, reconciliation, inventory))
    changed_contract = copy.deepcopy(contract)
    title = changed_contract["evidenceContract"]["frozenRows"][1]["sourceRef"]
    title["titleClassText"] = "SATURNS WRONG CLASS"
    title["titleClassEnd"] = title["titleClassStart"] + len(title["titleClassText"])
    kills["titleClassChangedAndOffsetsRehashed"] = rejected(lambda: build_rows(changed_contract, reconciliation, inventory))
    changed_contract = copy.deepcopy(contract)
    changed_contract["evidenceContract"]["frozenRows"][0]["sourceRef"] = copy.deepcopy(changed_contract["evidenceContract"]["frozenRows"][1]["sourceRef"])
    kills["accessionBlobDocumentCrossover"] = rejected(lambda: build_rows(changed_contract, reconciliation, inventory))
    changed_reconciliation = copy.deepcopy(reconciliation)
    witness_id = contract["evidenceContract"]["frozenRows"][0]["reconciliationWitness"]["occurrenceId"]
    next(row for row in changed_reconciliation["rows"] if row["occurrenceId"] == witness_id)["sourceRef"]["blobSha256"] = "0" * 64
    kills["reconciliationWitnessBlobChanged"] = rejected(lambda: build_rows(contract, changed_reconciliation, inventory))
    changed_inventory = copy.deepcopy(inventory)
    witness_row = contract["evidenceContract"]["frozenRows"][0]["reconciliationWitness"]["sourceRowId"]
    next(row for row in changed_inventory["rows"] if row["rowId"] == witness_row)["blobRefs"][0]["bytes"] += 1
    kills["inventoryWitnessBytesChanged"] = rejected(lambda: build_rows(contract, reconciliation, changed_inventory))
    for label, text in EXCLUSION_FIXTURES.items():
        target = contract["evidenceContract"]["frozenRows"][0]
        kills[f"excluded_{label}"] = rejected(lambda target=target, text=text: derive_semantics(target, text))
    if set(kills.values()) != {True}:
        fail("mutation kill failed")
    return {
        "schema": "early-detection-sec-frozen-terminal-distribution-receipt-evidence-self-test/v1",
        "status": "PASS",
        "kills": kills,
        "verifiedRows": 5,
        "scopeLimit": EXPECTED_SCOPE,
        "outcomesAccessed": False,
    }


def write_new(path: Path, raw: bytes) -> None:
    if path != OUTPUT or path.exists():
        fail("output path changed or already exists")
    descriptor, name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.link(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def output_introduction(base: str) -> str:
    rows = subprocess.run(["git", "log", "--diff-filter=A", "--format=%H", "--", OUTPUT.relative_to(ROOT).as_posix()], cwd=ROOT, check=False, capture_output=True, text=True, encoding="utf-8").stdout.strip().splitlines()
    if len(rows) != 1 or git("rev-list", "--parents", "-n", "1", rows[0]).split() != [rows[0], base]:
        fail("output introduction is not the direct child of build base")
    return rows[0]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify-contract", "self-test", "dry-run", "build", "verify-output"))
    args = parser.parse_args()
    try:
        validate_dependency_bytes()
        contract = validate_contract()
        reconciliation = load_reconciliation()
        inventory = load_inventory()
        if args.command == "verify-contract":
            build_rows(contract, reconciliation, inventory)
            result = {"schema": "early-detection-sec-frozen-terminal-distribution-receipt-evidence-contract-verification/v1", "status": "PASS", "verifiedRows": 5, "scopeLimit": EXPECTED_SCOPE, "outcomesAccessed": False}
        elif args.command == "self-test":
            result = self_test(contract, reconciliation, inventory)
        elif args.command == "dry-run":
            implementation = implementation_bindings()
            report = build_report(contract, reconciliation, inventory, implementation)
            validate_report(report, contract, reconciliation, inventory, implementation)
            result = {"schema": "early-detection-sec-frozen-terminal-distribution-receipt-evidence-dry-run/v1", "status": "PASS", "reportSha256": report["reportSha256"], "population": report["population"], "noGoClaims": report["noGoClaims"], "verifiedRows": 5, "scopeLimit": EXPECTED_SCOPE, "outcomesAccessed": False}
        elif args.command == "build":
            implementation = implementation_bindings(remote_required=True)
            report = build_report(contract, reconciliation, inventory, implementation)
            validate_report(report, contract, reconciliation, inventory, implementation)
            raw = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
            write_new(OUTPUT, raw)
            result = {"schema": "early-detection-sec-frozen-terminal-distribution-receipt-evidence-build/v1", "status": "PASS", "path": OUTPUT.relative_to(ROOT).as_posix(), "rawSha256": sha(raw), "reportSha256": report["reportSha256"], "verifiedRows": 5, "scopeLimit": EXPECTED_SCOPE, "outcomesAccessed": False}
        else:
            raw = OUTPUT.read_bytes()
            report = json.loads(raw)
            base = report.get("implementationBindings", {}).get("buildBaseCommit")
            implementation = implementation_bindings(base, remote_required=True)
            output_introduction(base)
            validate_report(report, contract, reconciliation, inventory, implementation)
            if git_bytes(git("rev-parse", "HEAD"), OUTPUT) != raw:
                fail("output Git blob changed")
            result = {"schema": "early-detection-sec-frozen-terminal-distribution-receipt-evidence-verification/v1", "status": "PASS", "rawSha256": sha(raw), "reportSha256": report["reportSha256"], "sourceRebuildVerified": True, "verifiedRows": 5, "scopeLimit": EXPECTED_SCOPE, "outcomesAccessed": False}
    except (EvidenceError, BASE.EvidenceError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
