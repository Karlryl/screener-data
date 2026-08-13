#!/usr/bin/env python3
"""Verify the outcome-blind Form-25 suspension-boundary role reconciliation."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import subprocess
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-form25-suspension-boundary-role-reconciliation-contract-v1.json"
BUILDER = Path(__file__).resolve()
TEST = ROOT / "tests" / "build-sec-form25-suspension-boundary-role-reconciliation-v1.test.js"
BOUNDARY = ROOT / "reports" / "early-detection" / "sec-form25-suspension-boundary-v2.json"
QUEUE = ROOT / "reports" / "early-detection" / "sec-terminal-wealth-queue-v5.json"
CORPUS = Path(r"C:\Users\Anwender\Documents\GrowthScreenerResearchData\early-detection-v4\corporate-action-originals\blobs\sha256")
OWNED = (CONTRACT, BUILDER, TEST)

CONTRACT_RAW = "ad858bb73cc1c727916b5bb66848a164a429c814f84b24a8ea0209dd06888f98"
CONTRACT_SELF = "a1f49ecca0f53fe5e5343e77ed5d073b962181ee59dc4856cbdfaa2a3407f68e"
BASE = "a0d61880f14b7f4abe742a9c58b21e22f16b3641"
REMOTE = "https://github.com/Karlryl/screener-data.git"
REMOTE_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
CREATED_AT = "2026-08-13T11:03:08Z"
BOUNDARY_RAW = "4e9b33086ff6120de04110deb1e6e3916d2ca5001384729bbc28b273efd8735f"
BOUNDARY_SELF = "99199da6cf5b9c4ffc7416c5e97dc4fd9f6300ba3e7c731b123c11fa4c030345"
QUEUE_RAW = "cfc6b1c98e159e0d086bdad72a495ebe1c34b208975f145a8f96f903ada8798e"
QUEUE_SELF = "a840de2297de3a04afc1f1bcb76139fb36297369b6765f73683db9bc2a92e825"
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
COMMIT40 = re.compile(r"[0-9a-f]{40}\Z")

EXPECTED_PURPOSE = (
    "Reconcile all 12,727 Form-25 suspension-boundary role projections to exactly 6,366 unique "
    "source-derived suspension-event provenances and their exact terminal-wealth queue rows; distinguish "
    "6,361 modern SUBJECT COMPANY plus FILED BY pairs from five legacy single-FILER submissions; preserve "
    "descriptor mismatches explicitly; and grant no security identity, listing identity, interval, last-session, "
    "terminal-wealth, price, return, outcome or Original-V4 credit."
)
EVENT_KEYS = [
    "accession", "eventProvenanceSha256", "sourceBlobSha256", "documentIndex", "evidenceContentSha256",
    "evidenceOccurrenceSetSha256",
    "suspensionBoundaryDate", "suspensionTimingQualifier", "secHeaderMode",
    "boundaryIssuerCikComparisonState", "boundaryIssuerNameComparisonState",
    "boundaryExchangeNameComparisonState", "roleLinks",
]
LINK_KEYS = ["boundaryId", "queueRowId", "role", "queuePartySha256"]
EXPECTED_LOCKS = {
    "candidateRowsPromoted": False, "entityIdentityResolved": False,
    "securityIdentityResolved": False, "listingIdentityResolved": False,
    "historicalIntervalComplete": False, "lastConsolidatedSessionObserved": False,
    "lastTradePriceObserved": False, "laterOtcTradingExcluded": False,
    "delistingCompletionVerified": False, "completeCorporateActionChainVerified": False,
    "cashReceiptVerified": False, "noncashReceiptVerified": False,
    "noFurtherDistributionsVerified": False, "laterRecoveriesExcluded": False,
    "terminalWealthComplete": False, "originalV4GateCredit": False,
    "resultComputationAllowed": False, "pricesAccessed": False,
    "returnsAccessed": False, "outcomesAccessed": False,
}
EXPECTED_NOT_EVIDENCE = [
    "PERMANENT_SECURITY_IDENTITY", "HISTORICAL_LISTING_IDENTITY", "COMPLETE_HISTORICAL_INTERVAL",
    "LAST_CONSOLIDATED_SESSION", "LAST_TRADE_PRICE", "NO_LATER_OTC_TRADING",
    "DELISTING_COMPLETION", "COMPLETE_CORPORATE_ACTION_CHAIN", "CASH_OR_NONCASH_RECEIPT",
    "NO_FURTHER_DISTRIBUTION_OR_RECOVERY", "TERMINAL_WEALTH", "PRICE_RETURN_OR_OUTCOME",
    "ORIGINAL_V4_GATE_CREDIT",
]


class ReconciliationError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise ReconciliationError(message)


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


def normalized_builder(raw: bytes) -> bytes:
    text = raw.decode("utf-8").replace("\r\n", "\n")
    for name in ("CONTRACT_RAW", "CONTRACT_SELF"):
        expression = re.compile(rf'^{name} = "[0-9a-fA-Z_]+"$', re.MULTILINE)
        if len(expression.findall(text)) != 1:
            fail(f"{name} normalization structure changed")
        text = expression.sub(f'{name} = "{"0" * 64}"', text)
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


def is_ancestor(older: str, newer: str) -> bool:
    return subprocess.run(["git", "merge-base", "--is-ancestor", older, newer], cwd=ROOT).returncode == 0


def expected_inputs() -> dict[str, Any]:
    return {
        "suspensionBoundary": {
            "path": BOUNDARY.relative_to(ROOT).as_posix(), "rawSha256": BOUNDARY_RAW,
            "reportSha256": BOUNDARY_SELF, "introductionCommit": "609f37df9e9c277323c5c8e24d6accfa3d1f3ea7",
            "rows": 12727, "uniqueAccessions": 6366,
        },
        "terminalWealthQueue": {
            "path": QUEUE.relative_to(ROOT).as_posix(), "rawSha256": QUEUE_RAW,
            "reportSha256": QUEUE_SELF, "introductionCommit": "0148a3e14d7aa3cdfd493de2ca399fa876357a1e",
            "rows": 44352, "unresolvedRows": 44352, "resolvedRows": 0,
        },
        "secOriginalCorpus": {
            "logicalRoot": "early-detection-v4/corporate-action-originals/blobs/sha256",
            "requiredDistinctBlobReads": 6366, "contentAddressedBytesMustMatchSourceBlobSha256": True,
        },
    }


def expected_join() -> dict[str, Any]:
    return {
        "joinKey": "EXACT_ACCESSION_AND_EXACT_SOURCE_ROW_ID_ONLY", "oneEventPerExactAccession": True,
        "boundarySourceRowIdMustEqualQueueRowId": True,
        "allRoleProjectionsWithinAccessionMustShareEventProvenance": True,
        "modernEventRequiresExactlyOneSubjectAndOneFiledByProjection": True,
        "legacyEventRequiresExactlyOneSingleFilerProjection": True, "tickerJoinAllowed": False,
        "descriptionJoinAllowed": False, "caseFoldedNameJoinAllowed": False,
        "normalizedCikUsedOnlyForHeaderDescriptorComparison": True,
        "deduplicationAcrossAccessionsAllowed": False,
    }


def expected_header_contract() -> dict[str, Any]:
    return {
        "exactlyOneBalancedSecHeaderRequired": True, "exactlyOneAccessionLineRequired": True,
        "modernHeaderMode": "EXACTLY_ONE_SUBJECT_COMPANY_AND_ONE_FILED_BY_IN_ORDER",
        "legacyHeaderMode": "NO_SUBJECT_OR_FILED_BY_AND_EXACTLY_ONE_TOP_LEVEL_FILER_PARTY",
        "modernQueueSubjectMustMatchHeaderCikAndNameExactly": True,
        "modernQueueFiledByMustMatchHeaderCikAndNameExactly": True,
        "legacyQueueFilerMustMatchHeaderCikAndNameExactly": True,
        "boundaryIssuerCikComparison": "LEFT_ZERO_PAD_TO_TEN_ONLY_NO_IDENTITY_CREDIT",
        "boundaryIssuerNameMismatchMustRemainExplicit": True, "arbitraryThirdPartyRoleForbidden": True,
    }


def expected_semantic() -> dict[str, Any]:
    return {
        "allowedClaim": "SIX_THOUSAND_THREE_HUNDRED_SIXTY_SIX_EXACT_SEC_FORM25_ACCESSIONS_HAVE_SOURCE_DERIVED_SUSPENSION_EVENT_PROVENANCE_AND_TWELVE_THOUSAND_SEVEN_HUNDRED_TWENTY_SEVEN_EXPLICIT_QUEUE_ROLE_PROJECTIONS",
        "eventDenominatorIs6366Not12727": True, "projectionDenominatorIs12727": True,
        "modernRolePairsAre6361": True, "legacySingleFilerEventsAre5": True,
        "boundaryDescriptorMismatchIsNotIdentityResolution": True,
        "allRowsRemainCandidateEvidenceOnly": True, "notEvidenceOf": EXPECTED_NOT_EVIDENCE,
    }


def expected_implementation(value: dict[str, Any]) -> dict[str, Any]:
    return {
        "baseCommit": BASE, "baseTag": 888, "remote": REMOTE, "ref": REMOTE_REF,
        "contractPath": CONTRACT.relative_to(ROOT).as_posix(), "builderPath": BUILDER.relative_to(ROOT).as_posix(),
        "testPath": TEST.relative_to(ROOT).as_posix(),
        "builderNormalizedSha256": value["builderNormalizedSha256"], "testRawSha256": value["testRawSha256"],
        "introductionMustBeDirectSingleParentChildOfBase": True,
        "introductionAddsExactlyThreeOwnedPaths": True, "laterLinearSingleParentDescendantsAllowed": True,
        "remoteVerificationRequired": True, "noRemoteVerificationMustFail": True,
        "writeCapabilityAllowed": False, "publicOutputCreated": False,
    }


def validate_expected_rebuild(value: dict[str, Any]) -> None:
    expected_keys = {
        "boundaryRoleProjectionRows", "boundaryRoleProjectionIds", "queueRoleProjectionRows",
        "queueRoleProjectionRowIds", "uniqueSuspensionEvents", "uniqueAccessions", "modernPairedEvents",
        "legacySingleFilerEvents", "modernSubjectRoleRows", "modernFiledByRoleRows",
        "legacySingleFilerRoleRows", "secHeadersVerified", "secOriginalBlobsVerified",
        "secOriginalBytesVerified", "queueRowsStillUnresolved", "queueRowsOutcomesAccessedFalse",
        "allQueueRowsStillUnresolved", "allQueueRowsOutcomesAccessedFalse", "uniqueModernSubjectParties",
        "uniqueModernFiledByParties", "uniqueLegacyFilerParties",
        "boundaryIssuerCikZeroPaddedHeaderExactRows", "boundaryIssuerNameHeaderExactRows",
        "boundaryIssuerNameHeaderMismatchRows", "boundaryExchangeNameHeaderExactRows",
        "descriptorPresentRoleRows", "descriptorUnavailableRoleRows", "totalEvidenceOccurrences",
        "distinctEvidenceOccurrenceLocators", "roleProjectionRowsWithRepeatedEvidenceTextOccurrences",
        "eventsWithRepeatedEvidenceTextOccurrences", "eventProjectionCountDistribution",
        "roleProjectionFormCounts", "roleProjectionTimingQualifierCounts", "roleProjectionDocumentIndexCounts",
        "roleProjectionEvidenceKindCounts", "eventRowsCanonicalSha256", "eventRowSelfSequenceSha256",
    }
    exact_keys(value, expected_keys, "expected rebuild")
    fixed = {
        "boundaryRoleProjectionRows": 12727, "boundaryRoleProjectionIds": 12727,
        "queueRoleProjectionRows": 12727, "queueRoleProjectionRowIds": 12727,
        "uniqueSuspensionEvents": 6366, "uniqueAccessions": 6366, "modernPairedEvents": 6361,
        "legacySingleFilerEvents": 5, "modernSubjectRoleRows": 6361, "modernFiledByRoleRows": 6361,
        "legacySingleFilerRoleRows": 5, "secHeadersVerified": 6366, "secOriginalBlobsVerified": 6366,
        "secOriginalBytesVerified": 25001687, "queueRowsStillUnresolved": 12727,
        "queueRowsOutcomesAccessedFalse": 12727, "allQueueRowsStillUnresolved": 44352,
        "allQueueRowsOutcomesAccessedFalse": 44352, "uniqueModernSubjectParties": 3084,
        "uniqueModernFiledByParties": 8, "uniqueLegacyFilerParties": 5,
        "boundaryIssuerCikZeroPaddedHeaderExactRows": 12722, "boundaryIssuerNameHeaderExactRows": 12714,
        "boundaryIssuerNameHeaderMismatchRows": 8, "boundaryExchangeNameHeaderExactRows": 12722,
        "descriptorPresentRoleRows": 12722, "descriptorUnavailableRoleRows": 5,
        "totalEvidenceOccurrences": 12739, "distinctEvidenceOccurrenceLocators": 12739,
        "roleProjectionRowsWithRepeatedEvidenceTextOccurrences": 12,
        "eventsWithRepeatedEvidenceTextOccurrences": 6,
        "eventProjectionCountDistribution": {"1": 5, "2": 6361},
        "roleProjectionFormCounts": {"25": 5, "25-NSE": 12582, "25-NSE/A": 140},
        "roleProjectionTimingQualifierCounts": {
            "AT_CLOSE_OF_TRADING_SESSION": 6, "AT_OPEN_OF_TRADING": 12,
            "DATE_ONLY_TIME_UNSPECIFIED": 12709,
        },
        "roleProjectionDocumentIndexCounts": {"2": 12727},
        "roleProjectionEvidenceKindCounts": {
            "PRIMARY_SEC_FORM25_EXCHANGE_TRADING_SUSPENSION_BOUNDARY_STATEMENT": 12727,
        },
    }
    for key, expected in fixed.items():
        if value[key] != expected:
            fail(f"expected rebuild {key} changed")
    for key in ("eventRowsCanonicalSha256", "eventRowSelfSequenceSha256"):
        if HEX64.fullmatch(value[key]) is None:
            fail(f"{key} is malformed")


def validate_contract(value: dict[str, Any]) -> None:
    exact_keys(value, {
        "schema", "createdAt", "taskId", "track", "purpose", "authoritativeInputs", "joinContract",
        "secHeaderRoleContract", "expectedRebuild", "eventSchema", "roleLinkSchema", "semanticContract",
        "claimLocks", "implementationContract", "contractSha256",
    }, "contract")
    if value["schema"] != "sec-form25-suspension-boundary-role-reconciliation-contract/v1":
        fail("schema changed")
    if value["createdAt"] != CREATED_AT:
        fail("createdAt changed")
    created = datetime.fromisoformat(CREATED_AT.replace("Z", "+00:00"))
    if created.tzinfo is None or created > datetime.now(timezone.utc):
        fail("createdAt invalid or future")
    if value["taskId"] != "Q003-SEC-FORM25-SUSPENSION-BOUNDARY-ROLE-RECONCILIATION" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract identity changed")
    if value["purpose"] != EXPECTED_PURPOSE or value["authoritativeInputs"] != expected_inputs():
        fail("purpose or inputs changed")
    if value["joinContract"] != expected_join() or value["secHeaderRoleContract"] != expected_header_contract():
        fail("join or SEC-header role contract changed")
    validate_expected_rebuild(value["expectedRebuild"])
    if value["eventSchema"] != EVENT_KEYS or value["roleLinkSchema"] != LINK_KEYS:
        fail("row schema changed")
    if value["semanticContract"] != expected_semantic() or value["claimLocks"] != EXPECTED_LOCKS:
        fail("semantic contract or claim locks changed")
    implementation = value["implementationContract"]
    if implementation != expected_implementation(implementation):
        fail("implementation contract changed")
    if sha(normalized_builder(BUILDER.read_bytes())) != implementation["builderNormalizedSha256"]:
        fail("builder normalized bytes changed")
    if sha(TEST.read_bytes()) != implementation["testRawSha256"]:
        fail("test raw bytes changed")
    if value["contractSha256"] != CONTRACT_SELF or self_hash(value, "contractSha256") != CONTRACT_SELF:
        fail("contract self hash changed")


def load_contract() -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    if sha(raw) != CONTRACT_RAW:
        fail("contract raw bytes changed")
    value = json.loads(raw)
    validate_contract(value)
    return value


def load_report(path: Path, raw_sha: str, self_sha: str) -> dict[str, Any]:
    raw = path.read_bytes()
    if sha(raw) != raw_sha:
        fail(f"{path.name} raw bytes changed")
    value = json.loads(raw)
    if value.get("reportSha256") != self_sha or self_hash(value, "reportSha256") != self_sha:
        fail(f"{path.name} report self hash changed")
    return value


def one_header_value(block: bytes, label: bytes, context: str) -> str:
    matches = re.findall(rb"(?m)^[ \t]*" + re.escape(label) + rb":[ \t]*(.*?)[ \t]*\r?$", block)
    if len(matches) != 1:
        fail(f"{context} must contain exactly one {label.decode('ascii')} line")
    value = matches[0].decode("latin-1").strip()
    if not value:
        fail(f"{context} {label.decode('ascii')} is empty")
    return value


def party(block: bytes, context: str) -> dict[str, str]:
    cik = one_header_value(block, b"CENTRAL INDEX KEY", context)
    if re.fullmatch(r"[0-9]{10}", cik) is None:
        fail(f"{context} CIK malformed")
    return {"cik": cik, "name": one_header_value(block, b"COMPANY CONFORMED NAME", context)}


def sec_header(raw: bytes, accession: str) -> tuple[str, dict[str, dict[str, str]]]:
    openings = list(re.finditer(rb"<SEC-HEADER>(?:[^\r\n]*)", raw))
    closings = list(re.finditer(rb"</SEC-HEADER>", raw))
    if len(openings) != 1 or len(closings) != 1 or openings[0].end() >= closings[0].start():
        fail("SEC original must contain exactly one balanced SEC header")
    header = raw[openings[0].end():closings[0].start()]
    if one_header_value(header, b"ACCESSION NUMBER", "SEC header") != accession:
        fail("SEC-header accession changed")
    subjects = list(re.finditer(rb"(?m)^SUBJECT COMPANY:[ \t]*\r?$", header))
    filed_by = list(re.finditer(rb"(?m)^FILED BY:[ \t]*\r?$", header))
    filers = list(re.finditer(rb"(?m)^FILER:[ \t]*\r?$", header))
    if len(subjects) == 1 and len(filed_by) == 1 and subjects[0].end() < filed_by[0].start():
        return "MODERN_SUBJECT_AND_FILED_BY", {
            "SUBJECT_COMPANY": party(header[subjects[0].end():filed_by[0].start()], "SUBJECT_COMPANY"),
            "FILED_BY": party(header[filed_by[0].end():], "FILED_BY"),
        }
    if not subjects and not filed_by and len(filers) == 1:
        return "LEGACY_SINGLE_FILER", {"LEGACY_FILER": party(header[filers[0].end():], "LEGACY_FILER")}
    fail("SEC-header role mode changed")


def read_blob(source: dict[str, Any], accession: str) -> tuple[bytes, str, dict[str, dict[str, str]]]:
    relative = source.get("relativePath")
    if type(relative) is not str or Path(relative).is_absolute():
        fail("source path changed")
    root = CORPUS.resolve()
    path = (CORPUS / relative).resolve()
    try:
        path.relative_to(root)
    except ValueError:
        fail("source path escaped corpus")
    raw = path.read_bytes()
    if sha(raw) != source.get("blobSha256") or path.name != f'{source.get("blobSha256")}.txt':
        fail("source blob bytes or content-addressed filename changed")
    mode, parties = sec_header(raw, accession)
    return raw, mode, parties


def normalized_occurrences(row: dict[str, Any]) -> list[dict[str, Any]]:
    occurrences = row.get("evidenceOccurrences")
    if type(occurrences) is not list or len(occurrences) not in (1, 2):
        fail("boundary evidence occurrence count changed")
    normalized: list[dict[str, Any]] = []
    for occurrence in occurrences:
        ref = occurrence["sourceRef"]
        if sha(occurrence["evidenceText"].encode("utf-8")) != ref["evidenceSha256"]:
            fail("boundary evidence text hash changed")
        if ref["blobSha256"] != row["sourceBlob"]["blobSha256"]:
            fail("boundary evidence blob changed")
        normalized.append({
            "evidenceText": occurrence["evidenceText"], "value": occurrence["value"],
            "sourceRef": copy.deepcopy(ref),
        })
    normalized.sort(key=lambda item: item["sourceRef"]["locator"])
    if len(normalized) == 2:
        left, right = copy.deepcopy(normalized[0]), copy.deepcopy(normalized[1])
        left_locator = left["sourceRef"].pop("locator")
        right_locator = right["sourceRef"].pop("locator")
        if left != right or left_locator == right_locator:
            fail("repeated evidence text occurrences differ beyond locator")
    return normalized


def event_provenance(row: dict[str, Any]) -> str:
    occurrences = normalized_occurrences(row)
    ref = occurrences[0]["sourceRef"]
    return sha(canonical({
        "accession": row["accession"], "blobSha256": row["sourceBlob"]["blobSha256"],
        "documentIndex": ref["documentIndex"], "evidenceOccurrences": occurrences,
        "suspensionBoundaryDate": row["suspensionBoundaryDate"],
        "suspensionTimingQualifier": row["suspensionTimingQualifier"],
    }))


def queue_party(row: dict[str, Any]) -> dict[str, str]:
    return {"cik": str(row["cik"]).zfill(10), "name": row["companyName"]}


def classify_queue_role(mode: str, parties: dict[str, dict[str, str]], candidate: dict[str, str]) -> str:
    if mode == "MODERN_SUBJECT_AND_FILED_BY":
        matching = [role for role, value in parties.items() if candidate == value]
        if len(matching) != 1:
            fail("modern queue row is not exactly one SEC-header party")
        return matching[0]
    if mode == "LEGACY_SINGLE_FILER" and candidate == parties.get("LEGACY_FILER"):
        return "LEGACY_FILER"
    fail("legacy queue row is not exact top-level FILER")


def build_rows() -> tuple[list[dict[str, Any]], dict[str, Any]]:
    boundary = load_report(BOUNDARY, BOUNDARY_RAW, BOUNDARY_SELF)
    queue = load_report(QUEUE, QUEUE_RAW, QUEUE_SELF)
    if len(boundary.get("rows", [])) != 12727 or len(queue.get("rows", [])) != 44352:
        fail("input row counts changed")
    queue_by_id: dict[str, dict[str, Any]] = {}
    all_queue_unresolved = 0
    all_queue_outcomes_false = 0
    for row in queue["rows"]:
        if row["rowId"] in queue_by_id:
            fail("duplicate queue rowId")
        queue_by_id[row["rowId"]] = row
        all_queue_unresolved += row["resolutionState"] == "UNRESOLVED"
        all_queue_outcomes_false += row["outcomesAccessed"] is False
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in boundary["rows"]:
        groups[row["accession"]].append(row)
    if len(groups) != 6366:
        fail("boundary accession count changed")

    output: list[dict[str, Any]] = []
    boundary_ids: set[str] = set()
    queue_ids: set[str] = set()
    event_hashes: set[str] = set()
    subject_parties: set[tuple[str, str]] = set()
    filed_by_parties: set[tuple[str, str]] = set()
    legacy_parties: set[tuple[str, str]] = set()
    counts = Counter()
    projection_distribution = Counter()
    forms = Counter()
    timing = Counter()
    document_indexes = Counter()
    evidence_kinds = Counter()
    total_bytes = 0
    duplicate_evidence_events = 0

    for accession, rows in sorted(groups.items()):
        projection_distribution[str(len(rows))] += 1
        first = rows[0]
        raw, mode, parties = read_blob(first["sourceBlob"], accession)
        total_bytes += len(raw)
        counts["secOriginalBlobsVerified"] += 1
        counts["secHeadersVerified"] += 1
        provenances = {event_provenance(row) for row in rows}
        if len(provenances) != 1:
            fail("role projections do not share one event provenance")
        event_hash = provenances.pop()
        if event_hash in event_hashes:
            fail("event provenance reused across accessions")
        event_hashes.add(event_hash)
        if any(len(row["evidenceOccurrences"]) == 2 for row in rows):
            if not all(len(row["evidenceOccurrences"]) == 2 for row in rows):
                fail("duplicate evidence occurrence is asymmetric across role projections")
            duplicate_evidence_events += 1
        refs = {canonical({
            "blob": row["sourceBlob"], "documentIndex": row["evidenceOccurrences"][0]["sourceRef"]["documentIndex"],
            "evidenceOccurrences": normalized_occurrences(row),
            "date": row["suspensionBoundaryDate"], "timing": row["suspensionTimingQualifier"],
        }) for row in rows}
        if len(refs) != 1:
            fail("event source fields differ across role projections")
        links: list[dict[str, Any]] = []
        roles: list[str] = []
        cik_states: list[str] = []
        name_states: list[str] = []
        exchange_states: list[str] = []
        for row in rows:
            if row["sourceBlob"] != first["sourceBlob"]:
                fail("role projection source blob changed")
            if any(row[key] is not False for key in (
                "delistingCompletionVerified", "identityResolved", "lastConsolidatedSessionObserved",
                "lastTradePriceObserved", "laterOtcTradingExcluded", "outcomesAccessed", "terminalWealthComplete",
            )):
                fail("boundary row scientific lock opened")
            queue_row = queue_by_id.get(row["sourceRowId"])
            if queue_row is None or queue_row["rowId"] != row["sourceRowId"] or queue_row["accession"] != accession:
                fail("boundary-to-queue exact join changed")
            if queue_row["resolutionState"] != "UNRESOLVED" or queue_row["outcomesAccessed"] is not False:
                fail("linked queue row was promoted")
            candidate = queue_party(queue_row)
            if mode == "MODERN_SUBJECT_AND_FILED_BY":
                role = classify_queue_role(mode, parties, candidate)
                subject = parties["SUBJECT_COMPANY"]
                filed_by = parties["FILED_BY"]
                subject_parties.add((subject["cik"], subject["name"]))
                filed_by_parties.add((filed_by["cik"], filed_by["name"]))
                cik_state = "ZERO_PADDED_EXACT" if str(row["issuerCik"]).zfill(10) == subject["cik"] else "MISMATCH_PRESERVED"
                name_state = "EXACT" if row["issuerName"] == subject["name"] else "MISMATCH_PRESERVED"
                exchange_state = "EXACT" if row["exchangeName"] == filed_by["name"] else "MISMATCH_PRESERVED"
                if cik_state == "ZERO_PADDED_EXACT": counts["boundaryIssuerCikZeroPaddedHeaderExactRows"] += 1
                if name_state == "EXACT": counts["boundaryIssuerNameHeaderExactRows"] += 1
                else: counts["boundaryIssuerNameHeaderMismatchRows"] += 1
                if exchange_state == "EXACT": counts["boundaryExchangeNameHeaderExactRows"] += 1
                if not all(row[key] == "PRESENT" for key in (
                    "issuerCikState", "issuerNameState", "securityDescriptionState", "exchangeNameState",
                )):
                    fail("modern descriptors are not all PRESENT")
                counts["descriptorPresentRoleRows"] += 1
            else:
                filer = parties["LEGACY_FILER"]
                role = classify_queue_role(mode, parties, candidate)
                legacy_parties.add((filer["cik"], filer["name"]))
                cik_state = name_state = exchange_state = "UNAVAILABLE"
                if not all(row[key] == "UNAVAILABLE" for key in (
                    "issuerCikState", "issuerNameState", "securityDescriptionState", "exchangeNameState",
                )):
                    fail("legacy descriptors are not all UNAVAILABLE")
                counts["descriptorUnavailableRoleRows"] += 1
            roles.append(role)
            counts[f"role::{role}"] += 1
            cik_states.append(cik_state)
            name_states.append(name_state)
            exchange_states.append(exchange_state)
            if row["boundaryId"] in boundary_ids or queue_row["rowId"] in queue_ids:
                fail("role projection identifiers reused")
            boundary_ids.add(row["boundaryId"])
            queue_ids.add(queue_row["rowId"])
            forms[row["form"]] += 1
            timing[row["suspensionTimingQualifier"]] += 1
            ref = row["evidenceOccurrences"][0]["sourceRef"]
            document_indexes[str(ref["documentIndex"])] += 1
            evidence_kinds[row["evidenceKind"]] += 1
            links.append({
                "boundaryId": row["boundaryId"], "queueRowId": queue_row["rowId"], "role": role,
                "queuePartySha256": sha(canonical(candidate)),
            })
        if mode == "MODERN_SUBJECT_AND_FILED_BY":
            if Counter(roles) != {"SUBJECT_COMPANY": 1, "FILED_BY": 1} or len(rows) != 2:
                fail("modern role pair cardinality changed")
            counts["modernPairedEvents"] += 1
        else:
            if roles != ["LEGACY_FILER"] or len(rows) != 1:
                fail("legacy filer cardinality changed")
            counts["legacySingleFilerEvents"] += 1
        if len(set(cik_states)) != 1 or len(set(name_states)) != 1 or len(set(exchange_states)) != 1:
            fail("descriptor comparison state differs within event")
        ref = first["evidenceOccurrences"][0]["sourceRef"]
        output.append({
            "accession": accession, "eventProvenanceSha256": event_hash,
            "sourceBlobSha256": first["sourceBlob"]["blobSha256"], "documentIndex": ref["documentIndex"],
            "evidenceContentSha256": ref["evidenceSha256"],
            "evidenceOccurrenceSetSha256": sha(canonical(normalized_occurrences(first))),
            "suspensionBoundaryDate": first["suspensionBoundaryDate"],
            "suspensionTimingQualifier": first["suspensionTimingQualifier"], "secHeaderMode": mode,
            "boundaryIssuerCikComparisonState": cik_states[0],
            "boundaryIssuerNameComparisonState": name_states[0],
            "boundaryExchangeNameComparisonState": exchange_states[0],
            "roleLinks": sorted(links, key=lambda link: link["queueRowId"]),
        })

    for row in output:
        exact_keys(row, set(EVENT_KEYS), "event row")
        for link in row["roleLinks"]:
            exact_keys(link, set(LINK_KEYS), "role link")
    sequence = "\n".join(sha(canonical(row)) for row in output) + "\n"
    stats = {
        "boundaryRoleProjectionRows": sum(len(row["roleLinks"]) for row in output),
        "boundaryRoleProjectionIds": len(boundary_ids), "queueRoleProjectionRows": len(queue_ids),
        "queueRoleProjectionRowIds": len(queue_ids), "uniqueSuspensionEvents": len(event_hashes),
        "uniqueAccessions": len(output), "modernPairedEvents": counts["modernPairedEvents"],
        "legacySingleFilerEvents": counts["legacySingleFilerEvents"],
        "modernSubjectRoleRows": counts["role::SUBJECT_COMPANY"],
        "modernFiledByRoleRows": counts["role::FILED_BY"],
        "legacySingleFilerRoleRows": counts["role::LEGACY_FILER"],
        "secHeadersVerified": counts["secHeadersVerified"],
        "secOriginalBlobsVerified": counts["secOriginalBlobsVerified"], "secOriginalBytesVerified": total_bytes,
        "queueRowsStillUnresolved": len(queue_ids), "queueRowsOutcomesAccessedFalse": len(queue_ids),
        "allQueueRowsStillUnresolved": all_queue_unresolved,
        "allQueueRowsOutcomesAccessedFalse": all_queue_outcomes_false,
        "uniqueModernSubjectParties": len(subject_parties), "uniqueModernFiledByParties": len(filed_by_parties),
        "uniqueLegacyFilerParties": len(legacy_parties),
        "boundaryIssuerCikZeroPaddedHeaderExactRows": counts["boundaryIssuerCikZeroPaddedHeaderExactRows"],
        "boundaryIssuerNameHeaderExactRows": counts["boundaryIssuerNameHeaderExactRows"],
        "boundaryIssuerNameHeaderMismatchRows": counts["boundaryIssuerNameHeaderMismatchRows"],
        "boundaryExchangeNameHeaderExactRows": counts["boundaryExchangeNameHeaderExactRows"],
        "descriptorPresentRoleRows": counts["descriptorPresentRoleRows"],
        "descriptorUnavailableRoleRows": counts["descriptorUnavailableRoleRows"],
        "totalEvidenceOccurrences": sum(
            len(row["evidenceOccurrences"]) for rows in groups.values() for row in rows
        ),
        "distinctEvidenceOccurrenceLocators": sum(
            len({occurrence["sourceRef"]["locator"] for occurrence in row["evidenceOccurrences"]})
            for rows in groups.values() for row in rows
        ),
        "roleProjectionRowsWithRepeatedEvidenceTextOccurrences": sum(
            len(row["evidenceOccurrences"]) == 2 for rows in groups.values() for row in rows
        ),
        "eventsWithRepeatedEvidenceTextOccurrences": duplicate_evidence_events,
        "eventProjectionCountDistribution": dict(sorted(projection_distribution.items())),
        "roleProjectionFormCounts": dict(sorted(forms.items())),
        "roleProjectionTimingQualifierCounts": dict(sorted(timing.items())),
        "roleProjectionDocumentIndexCounts": dict(sorted(document_indexes.items())),
        "roleProjectionEvidenceKindCounts": dict(sorted(evidence_kinds.items())),
        "eventRowsCanonicalSha256": sha(canonical(output)),
        "eventRowSelfSequenceSha256": sha(sequence.encode("utf-8")),
    }
    return output, stats


def build_report(contract: dict[str, Any]) -> dict[str, Any]:
    rows, stats = build_rows()
    if stats != contract["expectedRebuild"]:
        fail("source-derived reconciliation differs from sealed rebuild")
    report = {
        "schema": "sec-form25-suspension-boundary-role-reconciliation-dry-run/v1",
        "taskId": contract["taskId"], "track": contract["track"], "contractRawSha256": CONTRACT_RAW,
        "contractSha256": CONTRACT_SELF,
        "disposition": "EXACT_EVENT_AND_ROLE_RECONCILIATION_NO_IDENTITY_OR_TERMINAL_CREDIT",
        "population": stats, "eventRowsCanonicalSha256": sha(canonical(rows)),
        "claimLocks": copy.deepcopy(EXPECTED_LOCKS), "outcomesAccessed": False,
    }
    report["reportSha256"] = sha(canonical(report))
    return report


def verify_repository(remote_required: bool) -> dict[str, Any]:
    if not remote_required:
        fail("live remote verification is mandatory")
    if git("remote", "get-url", "origin") != REMOTE:
        fail("origin URL changed")
    head = git("rev-parse", "HEAD")
    if git("rev-parse", "@{u}") != head:
        fail("HEAD and upstream differ")
    live = git("ls-remote", "--refs", "origin", REMOTE_REF).split()
    if live != [head, REMOTE_REF]:
        fail("live remote differs")
    for path, expected_raw, introduction in (
        (BOUNDARY, BOUNDARY_RAW, "609f37df9e9c277323c5c8e24d6accfa3d1f3ea7"),
        (QUEUE, QUEUE_RAW, "0148a3e14d7aa3cdfd493de2ca399fa876357a1e"),
    ):
        raw = path.read_bytes()
        if sha(raw) != expected_raw or git_raw(introduction, path) != raw or git_raw(head, path) != raw:
            fail("input local/introduction/HEAD bytes changed")
    introductions = [introduction_for(path) for path in OWNED]
    if all(not values for values in introductions):
        if head != BASE:
            fail("pre-introduction HEAD moved beyond base")
        return {"phase": "PRE_INTRODUCTION", "introductionCommit": None, "remoteVerified": True, "ownedGitBytesBound": 0}
    if any(len(values) != 1 for values in introductions) or len({values[0] for values in introductions}) != 1:
        fail("owned paths were not introduced together exactly once")
    introduction = introductions[0][0]
    if COMMIT40.fullmatch(introduction) is None or git("show", "-s", "--format=%P", introduction).split() != [BASE]:
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
            fail("owned local/introduction/HEAD bytes changed")
    return {"phase": "POST_INTRODUCTION", "introductionCommit": introduction, "remoteVerified": True, "ownedGitBytesBound": 3}


def reseal(value: dict[str, Any]) -> dict[str, Any]:
    item = copy.deepcopy(value)
    item["contractSha256"] = self_hash(item, "contractSha256")
    return item


def rejected(action: Callable[[], None]) -> bool:
    try:
        action()
    except (ReconciliationError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError):
        return True
    return False


def self_test(contract: dict[str, Any]) -> dict[str, Any]:
    mutations: dict[str, Callable[[dict[str, Any]], None]] = {
        "backdated": lambda x: x.__setitem__("createdAt", "1970-01-01T00:00:00Z"),
        "nonZuluTime": lambda x: x.__setitem__("createdAt", "2026-08-13T11:03:08+00:00"),
        "purposeOverclaim": lambda x: x.__setitem__("purpose", "identity and terminal wealth resolved"),
        "sourceRedirect": lambda x: x["authoritativeInputs"]["suspensionBoundary"].__setitem__("path", "state/evil.json"),
        "queueRedirect": lambda x: x["authoritativeInputs"]["terminalWealthQueue"].__setitem__("path", "state/evil.json"),
        "tickerJoin": lambda x: x["joinContract"].__setitem__("tickerJoinAllowed", True),
        "descriptionJoin": lambda x: x["joinContract"].__setitem__("descriptionJoinAllowed", True),
        "caseFoldJoin": lambda x: x["joinContract"].__setitem__("caseFoldedNameJoinAllowed", True),
        "crossAccessionDedup": lambda x: x["joinContract"].__setitem__("deduplicationAcrossAccessionsAllowed", True),
        "arbitraryThirdParty": lambda x: x["secHeaderRoleContract"].__setitem__("arbitraryThirdPartyRoleForbidden", False),
        "modernCount": lambda x: x["expectedRebuild"].__setitem__("modernPairedEvents", 6366),
        "legacyDrop": lambda x: x["expectedRebuild"].__setitem__("legacySingleFilerEvents", 0),
        "eventInflation": lambda x: x["expectedRebuild"].__setitem__("uniqueSuspensionEvents", 12727),
        "projectionLoss": lambda x: x["expectedRebuild"].__setitem__("boundaryRoleProjectionRows", 6366),
        "nameMismatchHidden": lambda x: x["expectedRebuild"].__setitem__("boundaryIssuerNameHeaderMismatchRows", 0),
        "eventHashDrift": lambda x: x["expectedRebuild"].__setitem__("eventRowsCanonicalSha256", "0" * 64),
        "eventSchemaExtra": lambda x: x["eventSchema"].append("terminalWealth"),
        "linkSchemaExtra": lambda x: x["roleLinkSchema"].append("ticker"),
        "eventDenominatorInflated": lambda x: x["semanticContract"].__setitem__("eventDenominatorIs6366Not12727", False),
        "identityCredit": lambda x: x["claimLocks"].__setitem__("securityIdentityResolved", True),
        "listingCredit": lambda x: x["claimLocks"].__setitem__("listingIdentityResolved", True),
        "intervalCredit": lambda x: x["claimLocks"].__setitem__("historicalIntervalComplete", True),
        "lastSessionCredit": lambda x: x["claimLocks"].__setitem__("lastConsolidatedSessionObserved", True),
        "terminalCredit": lambda x: x["claimLocks"].__setitem__("terminalWealthComplete", True),
        "outcomeCredit": lambda x: x["claimLocks"].__setitem__("outcomesAccessed", True),
        "unknownCredit": lambda x: x["claimLocks"].__setitem__("unknownScientificCredit", True),
        "outputEnabled": lambda x: x["implementationContract"].__setitem__("publicOutputCreated", True),
        "writeEnabled": lambda x: x["implementationContract"].__setitem__("writeCapabilityAllowed", True),
        "remoteOptional": lambda x: x["implementationContract"].__setitem__("remoteVerificationRequired", False),
        "topologyWeakened": lambda x: x["implementationContract"].__setitem__("introductionAddsExactlyThreeOwnedPaths", False),
    }
    kills: dict[str, bool] = {}
    for name, mutate in mutations.items():
        item = copy.deepcopy(contract)
        mutate(item)
        item = reseal(item)
        kills[name] = rejected(lambda item=item: validate_contract(item))
    modern_header = (
        b"<SEC-HEADER>\nACCESSION NUMBER: 0000000001-20-000001\nSUBJECT COMPANY:\n"
        b"COMPANY CONFORMED NAME: Issuer\nCENTRAL INDEX KEY: 0000000001\nFILED BY:\n"
        b"COMPANY CONFORMED NAME: Exchange\nCENTRAL INDEX KEY: 0000000002\n</SEC-HEADER>"
    )
    legacy_header = (
        b"<SEC-HEADER>\nACCESSION NUMBER: 0000000001-20-000001\nFILER:\n"
        b"COMPANY CONFORMED NAME: Legacy Filer\nCENTRAL INDEX KEY: 0000000003\n</SEC-HEADER>"
    )
    kills.update({
        "modernFixtureClassified": sec_header(modern_header, "0000000001-20-000001")[0] == "MODERN_SUBJECT_AND_FILED_BY",
        "legacyFixtureClassified": sec_header(legacy_header, "0000000001-20-000001")[0] == "LEGACY_SINGLE_FILER",
        "thirdPartyFixtureRejected": rejected(lambda: classify_queue_role(
            "MODERN_SUBJECT_AND_FILED_BY",
            {"SUBJECT_COMPANY": {"cik": "0000000001", "name": "Issuer"},
             "FILED_BY": {"cik": "0000000002", "name": "Exchange"}},
            {"cik": "0000000003", "name": "Third Party"},
        )),
        "duplicateSubjectRejected": rejected(lambda: sec_header(modern_header.replace(b"SUBJECT COMPANY:", b"SUBJECT COMPANY:\nSUBJECT COMPANY:"), "0000000001-20-000001")),
        "modernWithoutFiledByRejected": rejected(lambda: sec_header(modern_header.replace(b"FILED BY:", b"OTHER ROLE:"), "0000000001-20-000001")),
        "legacyExtraFilerRejected": rejected(lambda: sec_header(legacy_header.replace(b"FILER:", b"FILER:\nFILER:"), "0000000001-20-000001")),
        "wrongAccessionRejected": rejected(lambda: sec_header(modern_header, "0000000001-20-000002")),
    })
    if not all(kills.values()):
        fail("self-test kill failed")
    return {
        "schema": "sec-form25-suspension-boundary-role-reconciliation-self-test/v1",
        "status": "PASS", "mutationKills": kills, "outcomesAccessed": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify-contract", "dry-run", "self-test"))
    parser.add_argument("--remote", action="store_true")
    args = parser.parse_args()
    try:
        contract = load_contract()
        repository = verify_repository(args.remote)
        if args.command == "verify-contract":
            result = {
                "schema": "sec-form25-suspension-boundary-role-reconciliation-contract-verification/v1",
                "status": "PASS", **repository, "outcomesAccessed": False,
            }
        elif args.command == "self-test":
            result = {**self_test(contract), **repository}
        else:
            report = build_report(contract)
            result = {
                "schema": "sec-form25-suspension-boundary-role-reconciliation-verification/v1",
                "status": "PASS", **repository, "reportSha256": report["reportSha256"],
                "population": report["population"], "publicOutputCreated": False,
                "identityResolved": False, "pricesAccessed": False, "returnsAccessed": False,
                "outcomesAccessed": False,
            }
    except (ReconciliationError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
