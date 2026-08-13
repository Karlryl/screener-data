#!/usr/bin/env python3
"""Verify the append-only V4 operational resume without opening outcomes."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import subprocess
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "continuous-free-source-operational-resume-contract-v4.json"
SCRIPT = Path(__file__).resolve()
TEST = ROOT / "tests" / "verify-continuous-free-source-operational-resume-v4.test.js"
REMOTE_URL = "https://github.com/Karlryl/screener-data.git"
REF = "refs/heads/codex/early-detection-v4-gates-20260810"
MINIMUM = "996fd2eeb7f2193cfc6352ca15ab544d3f09ae4c"
CONSTRUCTION = "f875f0849459d696963fddd1bc3c51a91df03cf8"
EXPECTED_CONTRACT_RAW = "a8df69dabe3d09cef5bcd735d09d3eebd5a02860598583af5c146e8b43533fee"
EXPECTED_CONTRACT_SELF = "e1ee55f0702d29fcf98ec46cc1991159068cf7f694c49d3b12485983291a75ae"
EXPECTED_VERIFIER_NORMALIZED = "8990d6580715f7d16dd0df591300bc0aed9f0aeb5898e9ac855861ff0c5bfc33"
EXPECTED_TEST_RAW = "5d5d7a07dba5d552a190b3152b855dcd2a1bbd87c901a680ccc0db74b790a98a"
OWNED_PATHS = [
    "research/early-detection-v4/continuous-free-source-operational-resume-contract-v4.json",
    "scripts/verify-continuous-free-source-operational-resume-v4.py",
    "tests/verify-continuous-free-source-operational-resume-v4.test.js",
]
CLOSED_SEALS = {
    "authorizationSeal": "CLOSED", "endpointSeal": "CLOSED", "resultSeal": "CLOSED",
    "outcomeSeal": "CLOSED", "fullDataSeal": "CLOSED", "fullDataAiProtocolSeal": "CLOSED",
}
LOCKS = {
    "originalV4GreenOfficialGates": 2, "originalV4OfficialGateCount": 13,
    "originalV4Complete": False, "originalV4ResultComputationAllowed": False,
    "addonMilestonesGrantOriginalV4GateCredit": False,
    "fiveRequiredDataSemanticsComplete": False, "fullDataAiProtocolSealAllowed": False,
    "analysisAuthorized": False, "resultComputationAllowed": False,
    "resultsAccessed": False, "outcomesAccessed": False,
    "pricesAccessed": False, "returnsAccessed": False,
    "reserved2021To2024OpenedForHypothesisGeneration": False,
    "humanAttestation": False, "publicAiAppendOnly": True, "secCikStudyAppendOnly": True,
}
NEXT_QUEUE = [
    {"rank": 1, "workId": "SEC-TERMINAL-REMAINING-CASH-LIQUIDATION-RECOVERY-RECONCILIATION", "entryCriterion": "EXACT_SIX_NONCASH_RECEIPTS_BOUND_WITHOUT_TERMINAL_WEALTH_CREDIT", "workClass": "AUTONOMOUS_OUTCOME_BLIND"},
    {"rank": 2, "workId": "SEC-IDENTITY-INTERVAL-CORPORATE-ACTION-RECONCILIATION", "entryCriterion": "656_DESCRIPTOR_ROWS_BOUND_WITH_ZERO_IDENTITY_CREDIT", "workClass": "AUTONOMOUS_OUTCOME_BLIND"},
    {"rank": 3, "workId": "US-EXCHANGE-NASDAQ-GAPS-NYSE-NYSE-AMERICAN-CBOE-RECONCILIATION", "entryCriterion": "NASDAQ_384_CELL_MATRIX_BOUND_WITH_124_NO_SNAPSHOT_MONTHS_AND_OTHER_THREE_EXCHANGE_FAMILIES_REMAIN_OPEN", "workClass": "AUTONOMOUS_OUTCOME_BLIND"},
    {"rank": 4, "workId": "RESEARCH-ARCHIVE-DISCOVERY-CONTINUATION", "entryCriterion": "LEGACY_Q010_REMAINS_OPEN_AND_ONLY_PROVENANCE_LICENSE_HASH_FIRST_DISCOVERY_IS_ALLOWED", "workClass": "AUTONOMOUS_OUTCOME_BLIND"},
    {"rank": 5, "workId": "PRE2021-SOURCE-QUALITY-SEPARATE-PROTOCOL-SEAL", "entryCriterion": "ONE_NONEXECUTABLE_PROPOSAL_BOUND_AND_2021_2024_RESERVED", "workClass": "AUTONOMOUS_OUTCOME_BLIND"},
    {"rank": 6, "workId": "FINRA-2016-2024-ROW-LEVEL-RECONCILIATION", "entryCriterion": "REMOTE_VERIFIED_FINRA_CAPTURE_INHERITED_VIA_TAG854_HARNESS", "workClass": "AUTONOMOUS_OUTCOME_BLIND"},
]
LEGACY_QUEUE_CONSERVATION = [
    {"legacyTaskId": "Q001-QUANTCONNECT-TERMS-ACCOUNT", "legacyState": "USER_ACTION_REQUIRED", "recoveryRouting": "EXTERNAL_DEFERRED", "recoveryWorkId": "QUANTCONNECT-FREE-CLOUD-RIGHTS"},
    {"legacyTaskId": "Q002-QUANTCONNECT-50-CASE-CONTRACT", "legacyState": "READY", "recoveryRouting": "BLOCKED_BY_RIGHTS_NOT_AUTONOMOUS", "recoveryWorkId": "QUANTCONNECT-FREE-CLOUD-RIGHTS"},
    {"legacyTaskId": "Q003-SEC-TERMINAL-WEALTH-QUEUE", "legacyState": "READY", "recoveryRouting": "AUTONOMOUS_REMAINDER", "recoveryWorkId": "SEC-TERMINAL-REMAINING-CASH-LIQUIDATION-RECOVERY-RECONCILIATION"},
    {"legacyTaskId": "Q004-FINRA-OTC-CATALOG", "legacyState": "READY", "recoveryRouting": "AUTONOMOUS_REMAINDER", "recoveryWorkId": "FINRA-2016-2024-ROW-LEVEL-RECONCILIATION"},
    {"legacyTaskId": "Q005-US-EXCHANGE-PUBLIC-CATALOGS", "legacyState": "READY", "recoveryRouting": "PARTIAL_NASDAQ_ONLY_AUTONOMOUS_REMAINDER", "recoveryWorkId": "US-EXCHANGE-NASDAQ-GAPS-NYSE-NYSE-AMERICAN-CBOE-RECONCILIATION"},
    {"legacyTaskId": "Q006-TIINGO-FREE-ENTITLEMENT", "legacyState": "USER_ACTION_REQUIRED", "recoveryRouting": "EXTERNAL_DEFERRED", "recoveryWorkId": "TIINGO-FREE-ENTITLEMENT"},
    {"legacyTaskId": "Q007-OPENFIGI-ANONYMOUS-HANDSHAKE", "legacyState": "READY", "recoveryRouting": "INHERITED_POINT_EVIDENCE_COMPLETE_NO_INTERVAL_CREDIT", "recoveryWorkId": None},
    {"legacyTaskId": "Q008-BUSINESS-QUANT-FREE-HANDSHAKE", "legacyState": "USER_ACTION_REQUIRED", "recoveryRouting": "EXTERNAL_DEFERRED", "recoveryWorkId": "BUSINESS-QUANT-FREE-HANDSHAKE"},
    {"legacyTaskId": "Q009-ALPHA-VANTAGE-NEGATIVE-CONTROL", "legacyState": "USER_ACTION_REQUIRED", "recoveryRouting": "EXTERNAL_DEFERRED", "recoveryWorkId": "ALPHA-VANTAGE-NEGATIVE-CONTROL"},
    {"legacyTaskId": "Q010-RESEARCH-ARCHIVE-DISCOVERY", "legacyState": "READY", "recoveryRouting": "AUTONOMOUS_REMAINDER", "recoveryWorkId": "RESEARCH-ARCHIVE-DISCOVERY-CONTINUATION"},
]
EXTERNAL_DEFERRED = [
    {"workId": "QUANTCONNECT-FREE-CLOUD-RIGHTS", "state": "BLOCKED_BY_WRITTEN_EXPORT_RIGHTS", "autonomous": False},
    {"workId": "TIINGO-FREE-ENTITLEMENT", "state": "USER_ACCOUNT_ACTION_REQUIRED_NO_CARD_NO_TRIAL", "autonomous": False},
    {"workId": "ALPHA-VANTAGE-NEGATIVE-CONTROL", "state": "USER_FREE_KEY_ACTION_REQUIRED_NO_CARD_NO_TRIAL", "autonomous": False},
    {"workId": "BUSINESS-QUANT-FREE-HANDSHAKE", "state": "USER_ACCOUNT_ACTION_REQUIRED_NO_CARD_NO_TRIAL", "autonomous": False},
    {"workId": "COURTLISTENER-RECAP-FREE-ACCOUNT", "state": "USER_ACCOUNT_ACTION_REQUIRED_NO_PAID_PACER_PURCHASE", "autonomous": False},
]
QUEUE_DISPOSITION = [
    {"previousWorkId": "NASDAQ-SPARSE-COVERAGE-GAP-MATRIX", "status": "COMPLETED", "evidenceMilestoneId": "NASDAQ-MONTHLY-GAP-MATRIX-TAG855", "remainingWorkId": "US-EXCHANGE-NASDAQ-GAPS-NYSE-NYSE-AMERICAN-CBOE-RECONCILIATION"},
    {"previousWorkId": "OUTCOME-BLIND-HYPOTHESIS-REGISTER-PRE2021", "status": "COMPLETED_PROPOSAL_ONLY", "evidenceMilestoneId": "PRE2021-HYPOTHESIS-REGISTER-TAGS859-863", "remainingWorkId": "PRE2021-SOURCE-QUALITY-SEPARATE-PROTOCOL-SEAL"},
    {"previousWorkId": "SEC-TERMINAL-PRIMARY-RECONCILIATION", "status": "PARTIALLY_COMPLETED", "evidenceMilestoneId": "SEC-NONCASH-SHARE-RECEIPTS-TAGS856-858-864", "remainingWorkId": "SEC-TERMINAL-REMAINING-CASH-LIQUIDATION-RECOVERY-RECONCILIATION"},
    {"previousWorkId": "SEC-IDENTITY-CORPORATE-ACTION-PRIMARY-RECONCILIATION", "status": "PARTIALLY_COMPLETED_ZERO_IDENTITY_CREDIT", "evidenceMilestoneId": "SEC-FORM345-DESCRIPTOR-CROSSWALK-TAGS860-862", "remainingWorkId": "SEC-IDENTITY-INTERVAL-CORPORATE-ACTION-RECONCILIATION"},
    {"previousWorkId": "OPENFIGI-ANONYMOUS-HANDSHAKE", "status": "COMPLETED_POINT_EVIDENCE_ONLY", "evidenceMilestoneId": "INHERITED_VIA_TAG854_HARNESS", "remainingWorkId": None},
    {"previousWorkId": "RESEARCH-ARCHIVE-DISCOVERY", "status": "OPEN_AUTONOMOUS_CONTINUATION", "evidenceMilestoneId": None, "remainingWorkId": "RESEARCH-ARCHIVE-DISCOVERY-CONTINUATION"},
    {"previousWorkId": "QUANTCONNECT-FREE-CLOUD-RIGHTS", "status": "EXTERNAL_RIGHTS_BLOCKER", "evidenceMilestoneId": None, "remainingWorkId": None},
    {"previousWorkId": "TIINGO-FREE-ENTITLEMENT", "status": "USER_ACTION_REQUIRED", "evidenceMilestoneId": None, "remainingWorkId": None},
    {"previousWorkId": "ALPHA-VANTAGE-NEGATIVE-CONTROL", "status": "USER_ACTION_REQUIRED", "evidenceMilestoneId": None, "remainingWorkId": None},
    {"previousWorkId": "BUSINESS-QUANT-FREE-HANDSHAKE", "status": "USER_ACTION_REQUIRED", "evidenceMilestoneId": None, "remainingWorkId": None},
    {"previousWorkId": "COURTLISTENER-RECAP-FREE-ACCOUNT", "status": "USER_ACTION_REQUIRED", "evidenceMilestoneId": None, "remainingWorkId": None},
]
LINEAGE = [
    (855, "e9db6cb337f46e7b0824a17f464793da47de9cf0", "Tag 855: Nasdaq-Archivluecken verifizieren", "COMPLETED_ZERO_CREDIT"),
    (856, "8ea3c8e488bd68091fc197edd5d75660406db019", "Tag 856: Aktiengegenleistungen einfrieren", "APPEND_ONLY_SEMANTICS_SUPERSEDED_BY_TAG864"),
    (857, "cc20000a578ea99699fbb18a845b4cecfcc4d57d", "Tag 857: Aktiengegenleistungen materialisieren", "COMPLETED_MATERIALIZATION"),
    (858, "86e0e0c399d780d775b6a3142f4f4958d1560a18", "Tag 858: Aktiengegenleistungen versiegeln", "COMPLETED_OUTPUT_SEAL_SEMANTICS_CORRECTED_BY_TAG864"),
    (859, "912ed611aae9081c528cb8e39f8017a290fd4258", "Tag 859: Hypothesenregister outcome-blind haerten", "APPEND_ONLY_SUPERSEDED_BY_TAG863"),
    (860, "cd2cb2ec8c43df97c9803a6549eaef813b10a82b", "Tag 860: SEC-Punktidentitaet abgleichen", "COMPLETED_IMPLEMENTATION_ZERO_CREDIT"),
    (861, "5622b794b0a435c5389707a6777161a33f8a79f7", "Tag 861: SEC-Punktidentitaet materialisieren", "COMPLETED_MATERIALIZATION_ZERO_CREDIT"),
    (862, "0a87a7ff37c899db1e272910e8f395f4a145c7c2", "Tag 862: SEC-Punktidentitaet versiegeln", "COMPLETED_OUTPUT_SEAL_ZERO_IDENTITY_CREDIT"),
    (863, "933ab61e4fbe5f0f11a7be3e24daf1893eeb9a85", "Tag 863: Hypothesenprovenienz korrigieren", "AUTHORITATIVE_PROPOSAL_ONLY_NO_CREDIT"),
    (864, "f875f0849459d696963fddd1bc3c51a91df03cf8", "Tag 864: Aktienquoten neutral bezeichnen", "AUTHORITATIVE_DENOMINATOR_SEMANTICS_NO_TERMINAL_WEALTH_CREDIT"),
]
MILESTONE_EXPECTED = {
    "NASDAQ-MONTHLY-GAP-MATRIX-TAG855": {
        "state": "COMPLETED_384_CELL_GAP_MATRIX_REMOTE_SEALED",
        "facts": {"months": 192, "cells": 384, "monthsWithNoSnapshot": 124, "monthsWithAnySnapshot": 68, "missingArchiveSnapshotCells": 288, "snapshots": 103, "positivePresenceOnly": True, "missingSnapshotIsNotAbsenceEvidence": True},
        "credit": {"scientificCapability": "NONE", "originalV4GateCredit": False, "historicalUniverseComplete": False, "historicalIdentityResolved": False},
        "completed": ["NASDAQ-SPARSE-COVERAGE-GAP-MATRIX"],
    },
    "SEC-NONCASH-SHARE-RECEIPTS-TAGS856-858-864": {
        "state": "COMPLETED_EXACT_SIX_RECEIPTS_EIGHT_RATIOS_CORRECTED_DENOMINATOR_SEMANTICS",
        "facts": {"completedNoncashShareReceiptRows": 6, "ratioRows": 8, "dualRatioRows": 2, "uniqueAccessions": 6, "denominatorSurrenderOrCancellationVerifiedRows": 1, "denominatorSurrenderOrCancellationNotVerifiedRows": 5, "verifiedSurrenderOrCancellationCaseIds": ["NONCASH-RECEIPT-004"], "denominatorDoesNotImplySurrenderOrCancellation": True},
        "credit": {"scientificCapability": "EXACT_SIX_RECEIPTS_ONLY", "originalV4GateCredit": False, "terminalWealthComplete": False, "cashReceiptVerified": False, "laterDistributionsVerified": False, "laterRecoveriesVerified": False},
        "completed": ["SEC-NONCASH-SHARE-RECEIPT-SIX-ROW-SUBSTEP"],
    },
    "PRE2021-HYPOTHESIS-REGISTER-TAGS859-863": {
        "state": "COMPLETED_ONE_PROPOSAL_NONEXECUTABLE_NO_CREDIT",
        "facts": {"proposalCount": 1, "eventCount": 1, "derivedStatus": "PROPOSAL", "maximumObservedDate": "2020-12-31", "reserved2021To2024OpenedForGeneration": False, "proposalExecutionAuthorized": False, "resultComputationAllowed": False, "studyCredit": "NONE"},
        "credit": {"scientificCapability": "PROPOSAL_ONLY", "originalV4GateCredit": False, "preregistered": False, "tested": False, "resultCredit": False},
        "completed": ["OUTCOME-BLIND-HYPOTHESIS-REGISTER-PRE2021"],
    },
    "SEC-FORM345-DESCRIPTOR-CROSSWALK-TAGS860-862": {
        "state": "COMPLETED_656_ROW_DESCRIPTOR_CROSSWALK_OUTPUT_SEALED_ZERO_IDENTITY_CREDIT",
        "facts": {"rows": 656, "uniqueAccessions": 652, "uniqueIssuerCiks": 607, "form15Rows": 65, "form25Rows": 591, "resolvedRows": 0, "gapNoArchiveSnapshotRows": 452, "singlePointNeedsIntervalAndCorroborationRows": 143, "historicalPublicKnownAtEstablished": False},
        "credit": {"scientificCapability": "RETROSPECTIVE_DESCRIPTOR_CROSSWALK_ONLY", "originalV4GateCredit": False, "identityResolutionCredit": False, "historicalIdentityResolved": False, "securityIdentityResolved": False, "tickerReuseResolved": False},
        "completed": ["SEC-FORM345-DESCRIPTOR-CROSSWALK-656-ROW-SUBSTEP"],
    },
}
BINDING_EXPECTED = {
    "TAG854_OPERATIONAL_RESUME_HARNESS_V3": ("research/early-detection-v4/continuous-free-source-operational-resume-harness-contract-v3.json", 4167, "84fc2a7aec9603193764104742735c36fe0da77be3b477411de6a50199ae4a5e", "55df901b8d4f520542afe6df12cd09f920a0e62e", "contractSha256", "751fff7a32bede74696c011380e8f56b0525d14f778b7df37b7b4835b88a06c8", "996fd2eeb7f2193cfc6352ca15ab544d3f09ae4c", 854),
    "V12_LEGACY_MATERIALIZED_STATE": ("state/early-detection-free-source-state-v12.json", 26073, "8e652e4ebb711a7cbe065799fc74fe3587d389cc313870cfa6d4a7960a78c700", "6146b6f58dd464d137a2af52a434b45b341ba2cc", "stateSha256", "4b08d22993e31ff24558b76a9739aab8b180eb177f3dd2c3bc6bfaa44cba0439", "51ee7e4dffcbe543125d371faaf10cf18b9027cd", 712),
    "TAG855_OUTPUT_SEAL": ("research/early-detection-v4/nasdaq-symbol-directory-monthly-gap-matrix-output-seal-contract-v2.json", 4133, "8b15f9186e9e49b387a90c8bc355e31c82eeb76334fb969345924febaee26351", "8fde26e89b2a725fe9519db0e847ecdf55f805ec", "contractSha256", "2a971e62567008c099785d9fbc73aa960aa6a044ae4237ab76c640f4546d2c16", "e9db6cb337f46e7b0824a17f464793da47de9cf0", 855),
    "TAG856_FROZEN_CONTRACT_V1": ("research/early-detection-v4/sec-frozen-noncash-share-receipt-evidence-contract-v1.json", 18894, "9451a82d6a7e51d7d531b6a035fdc9afb1d3794fd117e677c1021d6a68fa83b2", "842875090aba2582c408afd60436da2038b806f9", "contractSha256", "5dc2eb5bb282203c03cafa5cef44e4329c5082d850b0faf57c1512aefff96131", "8ea3c8e488bd68091fc197edd5d75660406db019", 856),
    "TAG857_OUTPUT_V1": ("reports/early-detection/sec-frozen-noncash-share-receipt-evidence-v1.json", 20735, "d02cb40ca4c38212af29c00d8c08a54fee120df615e44418cc120ed8a0575f07", "6586da12adfd1466893f74851a9237f70bb43b4a", "reportSha256", "8c892de667133e43d287ca20970f12da5cdce2a4ef71b5d684657a6446f8b1a2", "cc20000a578ea99699fbb18a845b4cecfcc4d57d", 857),
    "TAG858_OUTPUT_SEAL_V2": ("research/early-detection-v4/sec-frozen-noncash-share-receipt-evidence-output-seal-contract-v2.json", 3880, "eaa6a4f00cf4e2b5f803ea819ab76aace9dbd83849014a08451f20fdb9c650dd", "9f981a57402d46a07405f179ebbbb3c22f26065b", "contractSha256", "5fd01ef7b50992a7207cec256e782658f9b28df281e633a11f12a59a1e3e87cb", "86e0e0c399d780d775b6a3142f4f4958d1560a18", 858),
    "TAG864_CORRECTED_SEMANTIC_CONTRACT_V3": ("research/early-detection-v4/sec-frozen-noncash-share-receipt-evidence-contract-v3.json", 19763, "d1e0ff5188332c4840a33e2218c9a54baf743d0327d229ceea363488813d271f", "e3b2e052a3bf14b4a77e7292c923c1b0f655792e", "contractSha256", "7974876c527b1157aa6fefb98c5b643fc43841cbbc3beb3e2621702472ef12d5", "f875f0849459d696963fddd1bc3c51a91df03cf8", 864),
    "TAG859_REGISTER_V2_SUPERSEDED": ("research/early-detection-v4/hypothesis-register-contract-v2.json", 12145, "6c12b139edf61757dc9c457d75a4647974bb13da8473dc1b0e4fd5d3c31e24f4", "2e0bb9c645c3662638841595b5fd198858255a28", "contractSha256", "199164de8a6251409b671c669c44acc1bf2577d95f534ff7bebb4b961006e4a2", "912ed611aae9081c528cb8e39f8017a290fd4258", 859),
    "TAG863_REGISTER_V3_AUTHORITATIVE": ("research/early-detection-v4/hypothesis-register-contract-v3.json", 15179, "253cd6b42d40da895d09d36bf6448a7051a12bb6bea27f77248addb793a83a9d", "a425883f6b446145ee1e83862df8da1686b057a4", "contractSha256", "8c29ab1195246fcd30aa0044c9797a1b5b3a940c5d6f8cef93eff27b3e4c4af1", "933ab61e4fbe5f0f11a7be3e24daf1893eeb9a85", 863),
    "TAG860_CROSSWALK_CONTRACT_V1": ("research/early-detection-v4/sec-form345-primary-descriptor-crosswalk-contract-v1.json", 11098, "2c866f99e723e8faf72750eb99f695864a38199a415bbb2c738d11fd0cf7dc33", "77fda35a3a6e09c24c58d1789dfb1c2d02e18a9c", "contractSha256", "e142799d16e7d0764792486627740c3dd224a3d46b154678e6b75941bdf80cdb", "cd2cb2ec8c43df97c9803a6549eaef813b10a82b", 860),
    "TAG861_CROSSWALK_OUTPUT_V1": ("reports/early-detection/sec-form345-primary-descriptor-crosswalk-v1.json", 10359039, "041383521506c7315078954824cabb2f11f46c4135ce83e80cf22621ae811ed5", "70fe57fa30600b5cd4268574361db5552432b204", "reportSha256", "b22597d08c176388973cfc3a9547d51344090ad8f35d0ca831b7ef06615a8dc1", "5622b794b0a435c5389707a6777161a33f8a79f7", 861),
    "TAG862_CROSSWALK_OUTPUT_SEAL_V2": ("research/early-detection-v4/sec-form345-primary-descriptor-crosswalk-output-seal-contract-v2.json", 6382, "c6d02d12c07eaeeac95bb4518691773fb724deb6b73f29afa721a5ff938e8449", "728326aacb7b4c4184fb86e2c2d1702ca773cc4e", "contractSha256", "8efedf9455bca90c5716ab56c44b1db6b9b5d005b98b27703f323435f90af520", "0a87a7ff37c899db1e272910e8f395f4a145c7c2", 862),
}
MILESTONE_BINDING_ROLES = {
    "NASDAQ-MONTHLY-GAP-MATRIX-TAG855": ["TAG855_OUTPUT_SEAL"],
    "SEC-NONCASH-SHARE-RECEIPTS-TAGS856-858-864": ["TAG856_FROZEN_CONTRACT_V1", "TAG857_OUTPUT_V1", "TAG858_OUTPUT_SEAL_V2", "TAG864_CORRECTED_SEMANTIC_CONTRACT_V3"],
    "PRE2021-HYPOTHESIS-REGISTER-TAGS859-863": ["TAG859_REGISTER_V2_SUPERSEDED", "TAG863_REGISTER_V3_AUTHORITATIVE"],
    "SEC-FORM345-DESCRIPTOR-CROSSWALK-TAGS860-862": ["TAG860_CROSSWALK_CONTRACT_V1", "TAG861_CROSSWALK_OUTPUT_V1", "TAG862_CROSSWALK_OUTPUT_SEAL_V2"],
}

class ContractError(RuntimeError):
    pass

def fail(message: str) -> None:
    raise ContractError(message)

def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")

def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()

def canonical_sha(value: Any) -> str:
    return sha(canonical(value))

def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if type(value) is not dict or set(value) != expected:
        fail(f"{label} keys changed")

def typed_equal(value: Any, expected: Any, label: str) -> None:
    if type(value) is not type(expected):
        fail(f"{label} type changed")
    if isinstance(expected, dict):
        exact_keys(value, set(expected), label)
        for key in expected:
            typed_equal(value[key], expected[key], f"{label}.{key}")
    elif isinstance(expected, list):
        if len(value) != len(expected):
            fail(f"{label} length changed")
        for index, (item, wanted) in enumerate(zip(value, expected)):
            typed_equal(item, wanted, f"{label}[{index}]")
    elif value != expected:
        fail(f"{label} value changed")

def expected_binding(role: str) -> dict[str, Any]:
    path, size, raw, blob, self_field, self_hash, introduction, tag = BINDING_EXPECTED[role]
    return {
        "role": role, "path": path, "bytes": size, "rawSha256": raw,
        "gitBlob": blob, "selfField": self_field, "selfSha256": self_hash,
        "introductionCommit": introduction, "introductionTag": tag,
    }

def require_sha(value: Any, label: str, length: int = 64) -> str:
    if type(value) is not str or re.fullmatch(rf"[0-9a-f]{{{length}}}", value) is None:
        fail(f"{label} hash changed")
    return value

def safe_path(relative: Any) -> Path:
    if type(relative) is not str or not relative or "\\" in relative:
        fail("non-canonical repository path")
    path = (ROOT / relative).resolve()
    try:
        path.relative_to(ROOT.resolve())
    except ValueError as exc:
        raise ContractError("repository path escapes root") from exc
    return path

def git_text(*args: str) -> str:
    result = subprocess.run(["git", *args], cwd=ROOT, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return result.stdout.decode("utf-8").strip()

def git_bytes(*args: str) -> bytes:
    result = subprocess.run(["git", *args], cwd=ROOT, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return result.stdout

def first_parent_ancestor(ancestor: str, descendant: str, label: str) -> None:
    require_sha(ancestor, label, 40)
    require_sha(descendant, label, 40)
    if ancestor not in git_text("rev-list", "--first-parent", descendant).splitlines():
        fail(f"{label} left authorized first-parent line")

def normalize_verifier(raw: bytes) -> bytes:
    names = (b"EXPECTED_CONTRACT_RAW", b"EXPECTED_CONTRACT_SELF", b"EXPECTED_VERIFIER_NORMALIZED", b"EXPECTED_TEST_RAW")
    normalized = raw
    for name in names:
        pattern = rb'(?m)^(' + re.escape(name) + rb' = ")[0-9a-f]{64}("\r?$)'
        normalized, count = re.subn(pattern, rb"\g<1>" + b"0" * 64 + rb"\g<2>", normalized)
        if count != 1:
            fail("verifier normalization target changed")
    return normalized

def validate_binding(binding: dict[str, Any], *, head: str) -> dict[str, Any]:
    exact_keys(binding, {"role", "path", "bytes", "rawSha256", "gitBlob", "selfField", "selfSha256", "introductionCommit", "introductionTag"}, "binding")
    if type(binding["role"]) is not str or not binding["role"] or type(binding["bytes"]) is not int or binding["bytes"] < 1:
        fail("binding scalar type changed")
    require_sha(binding["rawSha256"], "binding raw")
    require_sha(binding["gitBlob"], "binding blob", 40)
    require_sha(binding["introductionCommit"], "binding introduction", 40)
    if type(binding["introductionTag"]) is not int:
        fail("binding introduction tag type changed")
    path = safe_path(binding["path"])
    raw = path.read_bytes()
    if len(raw) != binding["bytes"] or sha(raw) != binding["rawSha256"]:
        fail(f"binding local bytes changed: {binding['role']}")
    if git_text("hash-object", str(path)) != binding["gitBlob"]:
        fail(f"binding Git blob changed: {binding['role']}")
    if git_bytes("show", f"{binding['introductionCommit']}:{binding['path']}") != raw:
        fail(f"binding introduction bytes changed: {binding['role']}")
    if git_bytes("show", f"{head}:{binding['path']}") != raw:
        fail(f"binding current Git bytes changed: {binding['role']}")
    first_parent_ancestor(binding["introductionCommit"], head, f"binding {binding['role']}")
    subject = git_text("show", "-s", "--format=%s", binding["introductionCommit"])
    if not subject.startswith(f"Tag {binding['introductionTag']}:"):
        fail(f"binding tag/commit mismatch: {binding['role']}")
    if binding["selfField"] is None:
        if binding["selfSha256"] is not None:
            fail("binding self hash without field")
    else:
        if type(binding["selfField"]) is not str:
            fail("binding self field type changed")
        parsed = json.loads(raw)
        claim = parsed.pop(binding["selfField"], None)
        if claim != binding["selfSha256"] or canonical_sha(parsed) != binding["selfSha256"]:
            fail(f"binding canonical self hash changed: {binding['role']}")
    return json.loads(raw)

def validate_contract(value: dict[str, Any], *, exact_artifact: bool, dependencies: bool) -> None:
    exact_keys(value, {"schema", "createdAt", "taskId", "track", "purpose", "sourceBase", "predecessorHarness", "legacyMaterializedStatePointer", "remoteMilestoneLineage", "milestones", "legacyQueueConservation", "queueDisposition", "nextQueue", "externalDeferred", "sealStates", "scientificLocks", "ownedBindings", "resumeSha256"}, "contract")
    if value["schema"] != "early-detection-continuous-free-source-operational-resume-contract/v4" or value["taskId"] != "CONTINUOUS-FREE-SOURCE-OPERATIONAL-RESUME-V4" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract identity changed")
    for field in ("createdAt", "purpose"):
        if type(value[field]) is not str or not value[field]:
            fail(f"{field} type changed")
    body = dict(value)
    claim = body.pop("resumeSha256", None)
    if require_sha(claim, "resumeSha256") != canonical_sha(body):
        fail("resume self hash changed")
    if exact_artifact and claim != EXPECTED_CONTRACT_SELF:
        fail("expected resume self hash changed")

    expected_base = {
        "remote": REMOTE_URL, "ref": REF, "minimumAncestor": MINIMUM, "minimumAncestorTag": 854,
        "constructionHead": CONSTRUCTION, "constructionHeadTag": 864, "exactRemoteAtContractBuild": True,
        "minimumAncestorMustRemainFirstParentAncestor": True, "constructionHeadMustRemainFirstParentAncestor": True,
        "linearIntermediateCommitsBeforeIntroductionAllowed": True,
        "introductionPolicy": "FIRST_REMOTE_FIRST_PARENT_DESCENDANT_OF_CONSTRUCTION_HEAD_THAT_ADDS_ALL_THREE_OWNED_PATHS",
        "introductionCommitAddsExactlyAuthorizedPaths": True, "authorizedPaths": OWNED_PATHS,
    }
    typed_equal(value["sourceBase"], expected_base, "sourceBase")

    predecessor = value["predecessorHarness"]
    exact_keys(predecessor, {"binding", "v2ResumeInheritedViaHarness", "inheritedMilestones", "inheritedOriginalV4GreenOfficialGates", "inheritedOriginalV4OfficialGateCount", "priorBytesRemainAppendOnly", "grantsOriginalV4GateCredit", "outcomesAccessed"}, "predecessorHarness")
    if predecessor["inheritedMilestones"] != 9 or predecessor["inheritedOriginalV4GreenOfficialGates"] != 2 or predecessor["inheritedOriginalV4OfficialGateCount"] != 13:
        fail("predecessor counts changed")
    for field in ("v2ResumeInheritedViaHarness", "priorBytesRemainAppendOnly"):
        if predecessor[field] is not True:
            fail("predecessor append-only truth changed")
    for field in ("grantsOriginalV4GateCredit", "outcomesAccessed"):
        if predecessor[field] is not False:
            fail("predecessor credit lock changed")
    typed_equal(predecessor["binding"], expected_binding("TAG854_OPERATIONAL_RESUME_HARNESS_V3"), "predecessor binding")

    legacy = value["legacyMaterializedStatePointer"]
    exact_keys(legacy, {"binding", "materializedAt", "taskCounts", "readyTaskIds", "legacySelectorWouldChoose", "operationalPointerStatus", "resumeViewStatus", "scientificHistoryStatus", "recoveryPlanningQueueField", "mayReplaceControllerState", "v13MaterializedStateRequiredBeforeLegacyControllerMayResume", "legacyControllerBlockedUntilV13", "v13MaterializationPolicy", "resolvedScienceClaimsInferredFromQueueDisposition", "q002AutonomousSelectionAllowed", "outcomesAccessed"}, "legacyMaterializedStatePointer")
    typed_equal(legacy["taskCounts"], {"READY": 6, "RESOLVED": 0, "USER_ACTION_REQUIRED": 4}, "legacy task counts")
    typed_equal(legacy["readyTaskIds"], ["Q002-QUANTCONNECT-50-CASE-CONTRACT", "Q003-SEC-TERMINAL-WEALTH-QUEUE", "Q004-FINRA-OTC-CATALOG", "Q005-US-EXCHANGE-PUBLIC-CATALOGS", "Q007-OPENFIGI-ANONYMOUS-HANDSHAKE", "Q010-RESEARCH-ARCHIVE-DISCOVERY"], "legacy ready tasks")
    if legacy["legacySelectorWouldChoose"] != "Q002-QUANTCONNECT-50-CASE-CONTRACT" or legacy["operationalPointerStatus"] != "STALE_MATERIALIZED_STATE_PRESERVED_NOT_SUPERSEDED" or legacy["resumeViewStatus"] != "RECOVERY_VIEW_ONLY_NOT_MATERIALIZED_STATE" or legacy["scientificHistoryStatus"] != "PRESERVED_APPEND_ONLY_NOT_REINTERPRETED" or legacy["recoveryPlanningQueueField"] != "nextQueue":
        fail("legacy state pointer disposition changed")
    if legacy["v13MaterializedStateRequiredBeforeLegacyControllerMayResume"] is not True or legacy["legacyControllerBlockedUntilV13"] is not True:
        fail("V13 migration gate changed")
    typed_equal(legacy["v13MaterializationPolicy"], {
        "requiredPredecessorStateSha256": "4b08d22993e31ff24558b76a9739aab8b180eb177f3dd2c3bc6bfaa44cba0439",
        "appendOnlyHashChainedEventRequired": True,
        "materializedStateSelfHashRequired": True,
        "controllerResumeRequiresRemoteVerifiedV13": True,
    }, "V13 materialization policy")
    for field in ("mayReplaceControllerState", "resolvedScienceClaimsInferredFromQueueDisposition", "q002AutonomousSelectionAllowed", "outcomesAccessed"):
        if legacy[field] is not False:
            fail("legacy scientific or Q002 lock changed")
    typed_equal(legacy["binding"], expected_binding("V12_LEGACY_MATERIALIZED_STATE"), "legacy binding")

    lineage = value["remoteMilestoneLineage"]
    if type(lineage) is not list or len(lineage) != len(LINEAGE):
        fail("remote milestone lineage count changed")
    for item, expected in zip(lineage, LINEAGE):
        typed_equal(item, {"tag": expected[0], "commit": expected[1], "subject": expected[2], "disposition": expected[3]}, "remote milestone lineage")

    milestones = value["milestones"]
    if type(milestones) is not list or len(milestones) != 4:
        fail("milestone count changed")
    if [row.get("milestoneId") for row in milestones] != list(MILESTONE_EXPECTED):
        fail("milestone order changed")
    for row in milestones:
        exact_keys(row, {"milestoneId", "operationalState", "bindings", "facts", "credit", "completedQueueWorkIds"}, "milestone")
        expected = MILESTONE_EXPECTED[row["milestoneId"]]
        if row["operationalState"] != expected["state"]:
            fail("milestone operational state changed")
        typed_equal(row["facts"], expected["facts"], f"{row['milestoneId']} facts")
        typed_equal(row["credit"], expected["credit"], f"{row['milestoneId']} credit")
        typed_equal(row["completedQueueWorkIds"], expected["completed"], f"{row['milestoneId']} completed queue")
        roles = MILESTONE_BINDING_ROLES[row["milestoneId"]]
        typed_equal(row["bindings"], [expected_binding(role) for role in roles], f"{row['milestoneId']} bindings")

    typed_equal(value["legacyQueueConservation"], LEGACY_QUEUE_CONSERVATION, "legacy queue conservation")
    if len({row["legacyTaskId"] for row in value["legacyQueueConservation"]}) != 10:
        fail("legacy task conservation is not exhaustive")
    typed_equal(value["queueDisposition"], QUEUE_DISPOSITION, "queue disposition")

    typed_equal(value["nextQueue"], NEXT_QUEUE, "nextQueue")
    if any(row["workId"].startswith("Q002") or "QUANTCONNECT" in row["workId"] for row in value["nextQueue"]):
        fail("Q002 or QuantConnect may not be an autonomous next action")
    if any(row["workClass"] != "AUTONOMOUS_OUTCOME_BLIND" for row in value["nextQueue"]):
        fail("nextQueue contains non-autonomous work")

    typed_equal(value["externalDeferred"], EXTERNAL_DEFERRED, "external deferred")

    typed_equal(value["sealStates"], CLOSED_SEALS, "sealStates")
    typed_equal(value["scientificLocks"], LOCKS, "scientificLocks")
    owned = value["ownedBindings"]
    exact_keys(owned, {"contract", "verifier", "test"}, "ownedBindings")
    typed_equal(owned["contract"], {"path": OWNED_PATHS[0], "binding": "EXACT_RAW_AND_CANONICAL_SELF"}, "owned contract")
    typed_equal(owned["verifier"], {"path": OWNED_PATHS[1], "binding": "NORMALIZED_RAW_SHA256", "normalization": "ONLY_FOUR_EXPECTED_HASH_CONSTANT_VALUES_ZEROED", "normalizedRawSha256": EXPECTED_VERIFIER_NORMALIZED}, "owned verifier")
    typed_equal(owned["test"], {"path": OWNED_PATHS[2], "binding": "EXACT_RAW_SHA256", "rawSha256": EXPECTED_TEST_RAW}, "owned test")

    if exact_artifact:
        if sha(CONTRACT.read_bytes()) != EXPECTED_CONTRACT_RAW or sha(normalize_verifier(SCRIPT.read_bytes())) != EXPECTED_VERIFIER_NORMALIZED or sha(TEST.read_bytes()) != EXPECTED_TEST_RAW:
            fail("owned artifact bytes changed")
    if dependencies:
        validate_dependencies(value)

def validate_dependencies(value: dict[str, Any]) -> None:
    head = git_text("rev-parse", "HEAD")
    predecessor = validate_binding(value["predecessorHarness"]["binding"], head=head)
    if predecessor.get("schema") != "early-detection-continuous-free-source-operational-resume-harness-contract/v3" or predecessor.get("scientificLocks", {}).get("outcomesAccessed") is not False or predecessor.get("providerPolicy", {}).get("requiredMilestones") != 9 or predecessor.get("providerPolicy", {}).get("requiredOriginalV4GreenOfficialGates") != 2:
        fail("Tag854 predecessor harness semantics changed")

    legacy = validate_binding(value["legacyMaterializedStatePointer"]["binding"], head=head)
    if legacy.get("schema") != "early-detection-free-source-materialized-state/v1" or legacy.get("taskCounts", {}).get("READY") != 6 or legacy.get("taskCounts", {}).get("RESOLVED") != 0:
        fail("legacy V12 state counts changed")
    if [row["taskId"] for row in legacy.get("tasks", []) if row.get("state") == "READY"] != value["legacyMaterializedStatePointer"]["readyTaskIds"]:
        fail("legacy V12 ready tasks changed")
    legacy_states = {row["taskId"]: row["state"] for row in legacy.get("tasks", [])}
    if legacy_states != {row["legacyTaskId"]: row["legacyState"] for row in value["legacyQueueConservation"]}:
        fail("legacy V12 task conservation changed")

    bound: dict[str, dict[str, Any]] = {}
    for milestone in value["milestones"]:
        for binding in milestone["bindings"]:
            bound[binding["role"]] = validate_binding(binding, head=head)

    nasdaq = bound["TAG855_OUTPUT_SEAL"]
    if nasdaq["expectedPopulation"]["cells"] != 384 or nasdaq["expectedPopulation"]["monthsWithNoSnapshot"] != 124 or nasdaq["claimLocks"]["originalV4GateCredit"] is not False or nasdaq["claimLocks"]["outcomesAccessed"] is not False:
        fail("Nasdaq milestone semantics changed")
    noncash = bound["TAG864_CORRECTED_SEMANTIC_CONTRACT_V3"]
    if noncash["expectedPopulation"] != {"correctedRows": 6, "ratioRows": 8, "dualRatioRows": 2, "uniqueAccessions": 6, "denominatorSurrenderOrCancellationVerifiedRows": 1, "denominatorSurrenderOrCancellationNotVerifiedRows": 5}:
        fail("noncash corrected population changed")
    if noncash["semanticPolicy"]["denominatorDoesNotImplySurrenderOrCancellation"] is not True or noncash["claimLocks"]["terminalWealthComplete"] is not False:
        fail("noncash denominator or terminal-wealth semantics changed")
    hypothesis = bound["TAG863_REGISTER_V3_AUTHORITATIVE"]
    if len(hypothesis["proposals"]) != 1 or hypothesis["scientificLocks"]["proposalExecutionAuthorized"] is not False or hypothesis["scientificLocks"]["studyCredit"] != "NONE" or hypothesis["generationBoundary"]["maximumObservedDate"] != "2020-12-31":
        fail("hypothesis-register milestone semantics changed")
    crosswalk = bound["TAG862_CROSSWALK_OUTPUT_SEAL_V2"]
    if crosswalk["expectedPopulation"]["rows"] != 656 or crosswalk["expectedPopulation"]["resolvedRows"] != 0 or crosswalk["requiredClaims"]["resolutionCredit"] is not False or crosswalk["claimLocks"]["historicalIdentityResolved"] is not False:
        fail("Form345 crosswalk milestone semantics changed")

def introduction_phase(*, remote: bool) -> str:
    head = git_text("rev-parse", "HEAD")
    if remote:
        if git_text("remote", "get-url", "origin") != REMOTE_URL:
            fail("origin URL changed")
        rows = git_text("ls-remote", "--refs", REMOTE_URL, REF).splitlines()
        if len(rows) != 1:
            fail("authorized remote ref resolution changed")
        remote_head, remote_ref = rows[0].split()
        if remote_head != head or remote_ref != REF:
            fail("local HEAD is not exact authorized remote HEAD")
    first_parent_ancestor(MINIMUM, head, "minimum ancestor")
    first_parent_ancestor(CONSTRUCTION, head, "construction head")
    for tag, commit, subject, _ in LINEAGE:
        first_parent_ancestor(commit, head, f"Tag {tag}")
        if git_text("show", "-s", "--format=%s", commit) != subject:
            fail(f"Tag {tag} subject changed")

    present = []
    for path in OWNED_PATHS:
        result = subprocess.run(["git", "cat-file", "-e", f"{head}:{path}"], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        present.append(result.returncode == 0)
    if not any(present):
        return "PRE_INTRODUCTION"
    if not all(present):
        fail("owned paths partially introduced")
    introductions = []
    for path in OWNED_PATHS:
        rows = git_text("log", "--format=%H", "--diff-filter=A", "--reverse", f"{CONSTRUCTION}..{head}", "--", path).splitlines()
        if len(rows) != 1:
            fail("owned path introduction is not unique")
        introductions.append(rows[0])
    if len(set(introductions)) != 1:
        fail("owned paths not introduced together")
    introduction = introductions[0]
    first_parent_ancestor(CONSTRUCTION, introduction, "introduction construction head")
    first_parent_ancestor(introduction, head, "introduction current head")
    if len(git_text("show", "-s", "--format=%P", introduction).split()) != 1:
        fail("introduction is not single-parent")
    changed = [line.split("\t", 1) for line in git_text("diff-tree", "--no-commit-id", "--name-status", "-r", "--no-renames", introduction).splitlines()]
    if changed != [["A", path] for path in OWNED_PATHS]:
        fail("introduction did not add exactly owned paths")
    for path in OWNED_PATHS:
        local = safe_path(path).read_bytes()
        if git_bytes("show", f"{introduction}:{path}") != local or git_bytes("show", f"{head}:{path}") != local:
            fail("owned bytes changed after introduction")
    return "POST_INTRODUCTION"

def reseal(value: dict[str, Any]) -> None:
    value["resumeSha256"] = canonical_sha({key: item for key, item in value.items() if key != "resumeSha256"})

def self_test(base: dict[str, Any]) -> dict[str, Any]:
    mutations: dict[str, Callable[[dict[str, Any]], None]] = {
        "minimumAncestor": lambda x: x["sourceBase"].__setitem__("minimumAncestor", "1" * 40),
        "constructionHead": lambda x: x["sourceBase"].__setitem__("constructionHead", "1" * 40),
        "ownedPathOrder": lambda x: x["sourceBase"]["authorizedPaths"].reverse(),
        "predecessorCredit": lambda x: x["predecessorHarness"].__setitem__("grantsOriginalV4GateCredit", True),
        "legacyReadyCount": lambda x: x["legacyMaterializedStatePointer"]["taskCounts"].__setitem__("READY", 5),
        "legacyResolvedOverclaim": lambda x: x["legacyMaterializedStatePointer"]["taskCounts"].__setitem__("RESOLVED", 1),
        "falseStateSupersession": lambda x: x["legacyMaterializedStatePointer"].__setitem__("operationalPointerStatus", "SUPERSEDED_BY_THIS_APPEND_ONLY_V4_RESUME_VIEW"),
        "recoveryViewClaimsMaterializedState": lambda x: x["legacyMaterializedStatePointer"].__setitem__("resumeViewStatus", "MATERIALIZED_STATE"),
        "controllerBeforeV13": lambda x: x["legacyMaterializedStatePointer"].__setitem__("legacyControllerBlockedUntilV13", False),
        "v13BreaksStateHashChain": lambda x: x["legacyMaterializedStatePointer"]["v13MaterializationPolicy"].__setitem__("requiredPredecessorStateSha256", "1" * 64),
        "recoveryViewReplacesController": lambda x: x["legacyMaterializedStatePointer"].__setitem__("mayReplaceControllerState", True),
        "legacyScienceReinterpreted": lambda x: x["legacyMaterializedStatePointer"].__setitem__("resolvedScienceClaimsInferredFromQueueDisposition", True),
        "dropLegacyQ010": lambda x: x["legacyQueueConservation"].pop(),
        "dropLegacyQ007": lambda x: x["legacyQueueConservation"].pop(6),
        "dropQ010AutonomousRemainder": lambda x: x["nextQueue"].pop(3),
        "narrowQ005ToNasdaqOnly": lambda x: x["nextQueue"][2].__setitem__("workId", "NASDAQ-124-NO-SNAPSHOT-MONTH-PRIMARY-ALTERNATIVE-RECONCILIATION"),
        "dropAlphaVantageDeferred": lambda x: x["externalDeferred"].pop(2),
        "q002AutonomousNext": lambda x: x["nextQueue"].insert(0, {"rank": 0, "workId": "Q002-QUANTCONNECT-50-CASE-CONTRACT", "entryCriterion": "STALE_V12", "workClass": "AUTONOMOUS_OUTCOME_BLIND"}),
        "lineageTag": lambda x: x["remoteMilestoneLineage"][0].__setitem__("tag", 854),
        "nasdaqCells": lambda x: x["milestones"][0]["facts"].__setitem__("cells", 383),
        "nasdaqCredit": lambda x: x["milestones"][0]["credit"].__setitem__("historicalUniverseComplete", True),
        "noncashRows": lambda x: x["milestones"][1]["facts"].__setitem__("completedNoncashShareReceiptRows", 7),
        "noncashDenominatorOverclaim": lambda x: x["milestones"][1]["facts"].__setitem__("denominatorSurrenderOrCancellationVerifiedRows", 6),
        "terminalWealthOverclaim": lambda x: x["milestones"][1]["credit"].__setitem__("terminalWealthComplete", True),
        "hypothesisExecutable": lambda x: x["milestones"][2]["facts"].__setitem__("proposalExecutionAuthorized", True),
        "hypothesisCredit": lambda x: x["milestones"][2]["facts"].__setitem__("studyCredit", "SCIENTIFIC"),
        "reservedPeriodOpened": lambda x: x["milestones"][2]["facts"].__setitem__("reserved2021To2024OpenedForGeneration", True),
        "identityRows": lambda x: x["milestones"][3]["facts"].__setitem__("rows", 657),
        "identityResolutionCredit": lambda x: x["milestones"][3]["credit"].__setitem__("identityResolutionCredit", True),
        "queueOrder": lambda x: x["nextQueue"].reverse(),
        "userActionInNextQueue": lambda x: x["nextQueue"][0].__setitem__("workClass", "USER_ACTION_REQUIRED"),
        "externalAutonomous": lambda x: x["externalDeferred"][0].__setitem__("autonomous", True),
        "resultSealOpened": lambda x: x["sealStates"].__setitem__("resultSeal", "OPEN"),
        "outcomeSealOpened": lambda x: x["sealStates"].__setitem__("outcomeSeal", "OPEN"),
        "fullDataSealOpened": lambda x: x["sealStates"].__setitem__("fullDataSeal", "OPEN"),
        "originalV4GateCredit": lambda x: x["scientificLocks"].__setitem__("addonMilestonesGrantOriginalV4GateCredit", True),
        "originalV4Count": lambda x: x["scientificLocks"].__setitem__("originalV4GreenOfficialGates", 3),
        "resultComputation": lambda x: x["scientificLocks"].__setitem__("resultComputationAllowed", True),
        "outcomesAccess": lambda x: x["scientificLocks"].__setitem__("outcomesAccessed", True),
        "bindingHash": lambda x: x["milestones"][0]["bindings"][0].__setitem__("rawSha256", "1" * 64),
        "verifierBinding": lambda x: x["ownedBindings"]["verifier"].__setitem__("normalizedRawSha256", "1" * 64),
        "testBinding": lambda x: x["ownedBindings"]["test"].__setitem__("rawSha256", "1" * 64),
        "resumeSelf": lambda x: x.__setitem__("resumeSha256", "1" * 64),
    }
    kills: dict[str, bool] = {}
    for name, mutate in mutations.items():
        item = copy.deepcopy(base)
        mutate(item)
        if name != "resumeSelf":
            reseal(item)
        try:
            validate_contract(item, exact_artifact=False, dependencies=False)
        except (ContractError, KeyError, TypeError, ValueError):
            kills[name] = True
        else:
            kills[name] = False
    if not all(kills.values()):
        fail(f"self-test survivors: {sorted(key for key, killed in kills.items() if not killed)}")
    return {"schema": "early-detection-continuous-free-source-operational-resume-self-test/v4", "status": "PASS", "phase": "IN_MEMORY", "killCount": len(kills), "kills": kills, "outcomesAccessed": False}

def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    for command in ("verify", "self-test"):
        child = sub.add_parser(command)
        child.add_argument("--remote", action="store_true")
    args = parser.parse_args()
    try:
        value = json.loads(CONTRACT.read_bytes())
        validate_contract(value, exact_artifact=True, dependencies=True)
        if args.command == "self-test":
            result = self_test(value)
        else:
            result = {
                "schema": "early-detection-continuous-free-source-operational-resume-verification/v4",
                "status": "PASS", "phase": introduction_phase(remote=args.remote),
                "milestones": 4, "autonomousNextActions": len(value["nextQueue"]),
                "externalDeferred": len(value["externalDeferred"]),
                "legacyV12Ready": 6, "legacyV12Resolved": 0,
                "legacyTasksConserved": len(value["legacyQueueConservation"]),
                "recoveryViewOnly": True, "legacyControllerBlockedUntilV13": True,
                "recoveryPlanningNext": value["nextQueue"][0]["workId"],
                "q002Autonomous": False, "originalV4GreenOfficialGates": 2,
                "originalV4OfficialGateCount": 13, "outcomesAccessed": False,
            }
    except (ContractError, OSError, json.JSONDecodeError, subprocess.CalledProcessError, KeyError, TypeError, ValueError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
