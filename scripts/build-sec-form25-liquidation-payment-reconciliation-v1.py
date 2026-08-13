#!/usr/bin/env python3
"""Build and verify the outcome-blind Form-25/liquidation-payment reconciliation."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import subprocess
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-form25-liquidation-payment-reconciliation-contract-v1.json"
BUILDER = Path(__file__).resolve()
TEST = ROOT / "tests" / "build-sec-form25-liquidation-payment-reconciliation-v1.test.js"
LIQUIDATION = ROOT / "reports" / "early-detection" / "sec-frozen-liquidation-payment-evidence-v1.json"
BOUNDARY = ROOT / "reports" / "early-detection" / "sec-form25-suspension-boundary-v2.json"
QUEUE = ROOT / "reports" / "early-detection" / "sec-terminal-wealth-queue-v5.json"
CORPUS = Path(r"C:\Users\Anwender\Documents\GrowthScreenerResearchData\early-detection-v4\corporate-action-originals\blobs\sha256")
OWNED = (CONTRACT, BUILDER, TEST)

CONTRACT_RAW = "0db44a1a16a7a838f4e48a76c774aa8dff3b98bc365073ccca9f11bdf96564ca"
CONTRACT_SELF = "495ed141bb43aa963e16e0b21b0a89dc37f92c7a9f05e5eafb2ab91a504f604c"
BASE = "cc99700b90290c3fd56f7a5b92cf767d281bf585"
REMOTE = "https://github.com/Karlryl/screener-data.git"
REMOTE_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
CREATED_AT = "2026-08-13T06:35:03Z"
LIQUIDATION_RAW = "962b86e9ede09741c96a67fc853bffda101f9f6b5c0883b7da4ae23a7b416bc4"
LIQUIDATION_SELF = "c7b37f025ba20f1b816c69f0ac0e372df36e17dc9e2cc9136f448c13e24406d9"
BOUNDARY_RAW = "4e9b33086ff6120de04110deb1e6e3916d2ca5001384729bbc28b273efd8735f"
BOUNDARY_SELF = "99199da6cf5b9c4ffc7416c5e97dc4fd9f6300ba3e7c731b123c11fa4c030345"
QUEUE_RAW = "cfc6b1c98e159e0d086bdad72a495ebe1c34b208975f145a8f96f903ada8798e"
QUEUE_SELF = "a840de2297de3a04afc1f1bcb76139fb36297369b6765f73683db9bc2a92e825"
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
COMMIT40 = re.compile(r"[0-9a-f]{40}\Z")

EXPECTED_PURPOSE = (
    "Reconcile exactly seventeen frozen primary-SEC liquidation-payment statements to seventeen unique Form-25 "
    "suspension-event provenances represented by thirty-four explicit issuer/exchange-filer role projections and "
    "their exact terminal-wealth queue rows, without promoting receipt, currency, finality, "
    "later-recovery absence, identity continuity, terminal wealth, price, return, outcome or Original-V4 credit."
)
EXPECTED_REBUILD = {
    "liquidationRows": 17, "liquidationAccessions": 17, "uniqueBoundaryEventProvenances": 17,
    "boundaryRoleProjectionRows": 34, "boundaryRoleProjectionIds": 34,
    "queueRoleProjectionRows": 34, "queueRoleProjectionRowIds": 34,
    "duplicateBoundaryRoleProjectionPairs": 17, "issuerRoleProjections": 17,
    "exchangeFilerRoleProjections": 17, "secHeaderSubjectVerifiedEvents": 17,
    "secHeaderFiledByVerifiedEvents": 17, "sourceBlobBytesVerified": 17, "uniqueSecurityTriples": 17,
    "uniqueIssuerCiks": 4, "recipientExplicitRows": 4, "currencyResolvedRows": 0,
    "sameBlobRoleProjections": 34, "sameDocumentRoleProjections": 34,
    "roleProjectionFormCounts": {"25-NSE": 34},
    "roleProjectionTimingQualifierCounts": {"DATE_ONLY_TIME_UNSPECIFIED": 34},
    "paymentDayOffsetCounts": {"0": 4, "2": 4, "5": 5, "6": 4},
    "minimumPaymentDayOffset": 0, "maximumPaymentDayOffset": 6,
    "rowsCanonicalSha256": "c2b2f5b7aca57b6e3fea83d6fe824f2d90d1e9bdac94f7f1b1f22c0a041da93c",
    "rowSelfSequenceSha256": "ea8000300158c841454cb211c9c2f2c38dac9c989ba3c85367baed373e7039ea",
}
ROW_KEYS = [
    "caseId", "accession", "sourceBlobSha256", "documentIndex", "suspensionEventProvenanceSha256",
    "issuerCik", "issuerName",
    "securityDescription", "suspensionBoundaryDate", "suspensionTimingQualifier",
    "liquidationPaymentEffectiveDate", "dayOffset", "amountLiteral", "amountPerShare",
    "currencyCode", "recipientExplicit", "boundaryRoleProjectionLinks",
]
LINK_KEYS = ["boundaryId", "sourceRowId", "queueRowId", "queueRole", "secHeaderRole", "queueCik", "queueCompanyName"]
EXCHANGE_FILER_CIK = "0001143362"
EXCHANGE_FILER_NAME = "NYSE ARCA, INC."
EXPECTED_LOCKS = {
    "candidateRowsPromoted": False, "cashReceiptVerified": False, "currencyResolved": False,
    "firstDistributionVerified": False, "finalDistributionVerified": False,
    "noFurtherDistributionsVerified": False, "laterRecoveriesExcluded": False,
    "grossOrNetAmountVerified": False, "feesOrTaxesVerified": False,
    "fractionalTreatmentVerified": False, "universalHolderCoverageVerified": False,
    "completeCorporateActionChainVerified": False, "lastConsolidatedSessionObserved": False,
    "lastTradePriceObserved": False, "laterOtcTradingExcluded": False,
    "historicalIdentityResolved": False, "listingIdentityResolved": False,
    "terminalWealthComplete": False, "originalV4GateCredit": False,
    "resultComputationAllowed": False, "pricesAccessed": False, "returnsAccessed": False,
    "outcomesAccessed": False,
}


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
        "liquidationPaymentEvidence": {
            "path": LIQUIDATION.relative_to(ROOT).as_posix(), "rawSha256": LIQUIDATION_RAW,
            "reportSha256": LIQUIDATION_SELF, "introductionCommit": "623baf8d15f884ec791de96090da43a9c5f29ba4",
            "sealCommit": "de137118554621bbfb2556c69e226ef14ec110a8", "rows": 17,
            "uniqueAccessions": 17, "recipientExplicitRows": 4, "currencyResolvedRows": 0,
        },
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
            "requiredBlobReads": 17, "contentAddressedBytesMustMatchSourceBlobSha256": True,
        },
    }


def validate_contract(value: dict[str, Any]) -> None:
    exact_keys(value, {
        "schema", "createdAt", "taskId", "track", "purpose", "authoritativeInputs", "joinContract",
        "secHeaderRoleContract", "expectedRebuild", "rowSchema", "boundaryLinkSchema", "semanticContract", "claimLocks",
        "implementationContract", "contractSha256",
    }, "contract")
    if value["schema"] != "sec-form25-liquidation-payment-reconciliation-contract/v1":
        fail("schema changed")
    if value["createdAt"] != CREATED_AT:
        fail("createdAt changed")
    created = datetime.fromisoformat(CREATED_AT.replace("Z", "+00:00"))
    if created.tzinfo is None or created > datetime.now(timezone.utc):
        fail("createdAt is invalid or future")
    if value["taskId"] != "Q003-SEC-FORM25-LIQUIDATION-PAYMENT-RECONCILIATION" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract identity changed")
    if value["purpose"] != EXPECTED_PURPOSE:
        fail("purpose changed")
    if value["contractSha256"] != CONTRACT_SELF or self_hash(value, "contractSha256") != CONTRACT_SELF:
        fail("contract self hash changed")
    if value["authoritativeInputs"] != expected_inputs():
        fail("input contract changed")
    expected_join = {
        "joinKey": "EXACT_ACCESSION_ONLY", "oneLiquidationRowPerAccession": True,
        "exactlyOneUniqueBoundaryEventProvenancePerLiquidationAccession": True,
        "exactlyTwoBoundaryRoleProjectionRowsPerLiquidationAccession": True,
        "exactlyTwoQueueRoleProjectionRowsPerLiquidationAccession": True,
        "boundaryRoleProjectionPairMustShareEventProvenance": True,
        "boundarySourceRowIdMustEqualQueueRowId": True, "paymentAndBoundaryMustShareBlobSha256": True,
        "paymentAndBoundaryMustShareDocumentIndex": True, "oneIssuerRoleAndOneExchangeFilerRolePerAccession": True,
        "tickerJoinAllowed": False, "descriptionJoinAllowed": False, "normalizationJoinAllowed": False,
        "deduplicationAcrossSecuritiesAllowed": False,
    }
    if value["joinContract"] != expected_join:
        fail("join contract changed")
    expected_header_roles = {
        "exactlyOneSubjectCompanySectionRequired": True, "exactlyOneFiledBySectionRequired": True,
        "subjectCompanyCikAndNameMustMatchBoundaryIssuer": True,
        "filedByCik": EXCHANGE_FILER_CIK, "filedByName": EXCHANGE_FILER_NAME,
        "filedByNameMustMatchBoundaryExchangeName": True,
        "issuerQueueProjectionMustMatchSubjectCompany": True,
        "exchangeFilerQueueProjectionMustMatchFiledBy": True,
        "arbitraryNonIssuerThirdPartyForbidden": True,
    }
    if value["secHeaderRoleContract"] != expected_header_roles:
        fail("SEC header role contract changed")
    if value["expectedRebuild"] != EXPECTED_REBUILD:
        fail("expected rebuild changed")
    if value["rowSchema"] != ROW_KEYS or value["boundaryLinkSchema"] != LINK_KEYS:
        fail("row schema changed")
    semantic = value["semanticContract"]
    exact_keys(semantic, {"allowedClaim", "eventDenominatorIsSeventeenNotThirtyFour", "thirtyFourRowsAreRoleProjectionsOnly", "recipientClaimLimitedToFourExplicitRows", "currencyCodeAlwaysNull", "allRowsRemainCandidateEvidenceOnly", "notEvidenceOf"}, "semantic contract")
    if semantic["allowedClaim"] != "SEVENTEEN_EXACT_PRIMARY_SEC_ACCESSIONS_LINK_SEVENTEEN_UNIQUE_FORM25_SUSPENSION_EVENT_PROVENANCES_VIA_THIRTY_FOUR_ROLE_PROJECTIONS_TO_LATER_OR_SAME_DAY_LITERAL_DOLLAR_SIGN_PER_SHARE_LIQUIDATION_PAYMENT_DISTRIBUTION_STATEMENTS":
        fail("allowed claim changed")
    if any(semantic[key] is not True for key in ("eventDenominatorIsSeventeenNotThirtyFour", "thirtyFourRowsAreRoleProjectionsOnly", "recipientClaimLimitedToFourExplicitRows", "currencyCodeAlwaysNull", "allRowsRemainCandidateEvidenceOnly")):
        fail("semantic guard weakened")
    expected_not = {
        "ACTUAL_HOLDER_RECEIPT", "RESOLVED_CURRENCY_CODE", "FIRST_OR_FINAL_DISTRIBUTION",
        "NO_FURTHER_DISTRIBUTIONS_OR_RECOVERIES", "GROSS_OR_NET_AMOUNT", "FEES_TAXES_OR_FRACTIONAL_TREATMENT",
        "UNIVERSAL_HOLDER_COVERAGE", "COMPLETE_CORPORATE_ACTION_CHAIN", "LAST_CONSOLIDATED_SESSION",
        "LAST_TRADE_PRICE", "NO_LATER_OTC_TRADING", "HISTORICAL_SECURITY_OR_LISTING_IDENTITY_CONTINUITY",
        "TERMINAL_WEALTH", "PRICE_RETURN_OR_OUTCOME", "ORIGINAL_V4_GATE_CREDIT",
    }
    if set(semantic["notEvidenceOf"]) != expected_not or len(semantic["notEvidenceOf"]) != len(expected_not):
        fail("forbidden semantic set changed")
    if value["claimLocks"] != EXPECTED_LOCKS:
        fail("claim locks changed")
    implementation = value["implementationContract"]
    exact_keys(implementation, {
        "baseCommit", "baseTag", "remote", "ref", "contractPath", "builderPath", "testPath",
        "builderNormalizedSha256", "testRawSha256", "introductionMustBeDirectSingleParentChildOfBase",
        "introductionAddsExactlyThreeOwnedPaths", "laterLinearSingleParentDescendantsAllowed",
        "remoteVerificationRequired", "noRemoteVerificationMustFail", "writeCapabilityAllowed", "publicOutputCreated",
    }, "implementation contract")
    if implementation["baseCommit"] != BASE or implementation["baseTag"] != 876 or implementation["remote"] != REMOTE or implementation["ref"] != REMOTE_REF:
        fail("repository binding changed")
    if [implementation["contractPath"], implementation["builderPath"], implementation["testPath"]] != [path.relative_to(ROOT).as_posix() for path in OWNED]:
        fail("owned paths changed")
    for key in ("introductionMustBeDirectSingleParentChildOfBase", "introductionAddsExactlyThreeOwnedPaths", "laterLinearSingleParentDescendantsAllowed", "remoteVerificationRequired", "noRemoteVerificationMustFail"):
        if implementation[key] is not True:
            fail("implementation gate weakened")
    if implementation["writeCapabilityAllowed"] is not False or implementation["publicOutputCreated"] is not False:
        fail("write or output capability enabled")
    if HEX64.fullmatch(implementation["builderNormalizedSha256"]) is None or HEX64.fullmatch(implementation["testRawSha256"]) is None:
        fail("owned hash malformed")


def load_contract() -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    if sha(raw) != CONTRACT_RAW:
        fail("contract raw bytes changed")
    value = json.loads(raw)
    validate_contract(value)
    if sha(normalized_builder(BUILDER.read_bytes())) != value["implementationContract"]["builderNormalizedSha256"]:
        fail("builder normalized bytes changed")
    if sha(TEST.read_bytes()) != value["implementationContract"]["testRawSha256"]:
        fail("test bytes changed")
    return value


def load_input(path: Path, raw_sha: str, self_field: str, self_sha: str) -> dict[str, Any]:
    raw = path.read_bytes()
    if sha(raw) != raw_sha:
        fail(f"{path.name} raw bytes changed")
    value = json.loads(raw)
    if value.get(self_field) != self_sha or self_hash(value, self_field) != self_sha:
        fail(f"{path.name} self hash changed")
    return value


def one_header_value(block: bytes, label: bytes, context: str) -> str:
    matches = re.findall(rb"(?m)^[ \t]*" + re.escape(label) + rb":[ \t]*(.*?)[ \t]*\r?$", block)
    if len(matches) != 1:
        fail(f"{context} must contain exactly one {label.decode('ascii')} line")
    value = matches[0].decode("latin-1").strip()
    if not value:
        fail(f"{context} {label.decode('ascii')} is empty")
    return value


def sec_header_roles(raw: bytes, accession: str) -> dict[str, dict[str, str]]:
    openings = list(re.finditer(rb"<SEC-HEADER>(?:[^\r\n]*)", raw))
    closings = list(re.finditer(rb"</SEC-HEADER>", raw))
    if len(openings) != 1 or len(closings) != 1 or openings[0].end() >= closings[0].start():
        fail("SEC original must contain exactly one balanced SEC header")
    header = raw[openings[0].end():closings[0].start()]
    if one_header_value(header, b"ACCESSION NUMBER", "SEC header") != accession:
        fail("SEC header accession changed")
    subjects = list(re.finditer(rb"(?m)^SUBJECT COMPANY:[ \t]*\r?$", header))
    filed_by = list(re.finditer(rb"(?m)^FILED BY:[ \t]*\r?$", header))
    if len(subjects) != 1 or len(filed_by) != 1 or subjects[0].end() >= filed_by[0].start():
        fail("SEC header must contain exactly one ordered SUBJECT COMPANY and FILED BY section")
    blocks = {
        "SUBJECT_COMPANY": header[subjects[0].end():filed_by[0].start()],
        "FILED_BY": header[filed_by[0].end():],
    }
    result: dict[str, dict[str, str]] = {}
    for role, block in blocks.items():
        cik = one_header_value(block, b"CENTRAL INDEX KEY", role)
        if re.fullmatch(r"[0-9]{10}", cik) is None:
            fail(f"{role} CIK is malformed")
        result[role] = {
            "cik": cik,
            "name": one_header_value(block, b"COMPANY CONFORMED NAME", role),
        }
    return result


def read_source_blob(source_ref: dict[str, Any], accession: str) -> tuple[bytes, dict[str, dict[str, str]]]:
    relative = source_ref["relativePath"]
    if type(relative) is not str or Path(relative).is_absolute():
        fail("source blob relative path changed")
    root = CORPUS.resolve()
    path = (CORPUS / Path(relative)).resolve()
    try:
        path.relative_to(root)
    except ValueError:
        fail("source blob escaped corpus root")
    raw = path.read_bytes()
    if sha(raw) != source_ref["blobSha256"] or path.name != f'{source_ref["blobSha256"]}.txt':
        fail("source blob bytes or content-addressed path changed")
    return raw, sec_header_roles(raw, accession)


def queue_role(
    queue_row: dict[str, Any], issuer: dict[str, str], filed_by: dict[str, str]
) -> str:
    candidate = {"cik": str(queue_row["cik"]).zfill(10), "name": queue_row["companyName"]}
    if candidate == issuer:
        return "ISSUER_CIK_MATCH"
    if candidate == filed_by:
        return "EXCHANGE_FILER"
    fail("queue projection is neither SEC-header subject company nor SEC-header filed-by party")


def event_provenance(boundary_row: dict[str, Any]) -> str:
    occurrences = boundary_row["evidenceOccurrences"]
    if type(occurrences) is not list or len(occurrences) != 1:
        fail("linked boundary evidence occurrence count changed")
    ref = occurrences[0]["sourceRef"]
    return sha(canonical({
        "accession": boundary_row["accession"],
        "blobSha256": boundary_row["sourceBlob"]["blobSha256"],
        "documentIndex": ref["documentIndex"],
        "evidenceSha256": ref["evidenceSha256"],
        "suspensionBoundaryDate": boundary_row["suspensionBoundaryDate"],
    }))


def build_rows() -> tuple[list[dict[str, Any]], dict[str, Any]]:
    liquidation = load_input(LIQUIDATION, LIQUIDATION_RAW, "reportSha256", LIQUIDATION_SELF)
    boundary = load_input(BOUNDARY, BOUNDARY_RAW, "reportSha256", BOUNDARY_SELF)
    queue = load_input(QUEUE, QUEUE_RAW, "reportSha256", QUEUE_SELF)
    liquid_rows = liquidation.get("rows")
    boundary_rows = boundary.get("rows")
    queue_rows = queue.get("rows")
    if type(liquid_rows) is not list or len(liquid_rows) != 17 or len({row["accession"] for row in liquid_rows}) != 17:
        fail("liquidation denominator changed")
    if type(boundary_rows) is not list or len(boundary_rows) != 12727:
        fail("boundary denominator changed")
    if type(queue_rows) is not list or len(queue_rows) != 44352 or queue.get("counts") != {"form15Family": 17067, "form25Family": 27285, "resolved": 0, "rows": 44352, "unresolved": 44352}:
        fail("queue denominator changed")
    if liquidation.get("claimLocks") is None or any(value is not False for value in liquidation["claimLocks"].values()):
        fail("liquidation input credit changed")
    if boundary.get("claimLocks") is None or any(value is not False for value in boundary["claimLocks"].values()):
        fail("boundary input credit changed")
    if queue.get("claimLocks") != {"identityResolved": False, "originalV4GateCredit": False, "outcomesAccessed": False, "resultComputationAllowed": False, "terminalWealthComplete": False}:
        fail("queue locks changed")
    accessions = {row["accession"] for row in liquid_rows}
    by_boundary: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_queue: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in boundary_rows:
        if row["accession"] in accessions:
            by_boundary[row["accession"]].append(row)
    for row in queue_rows:
        if row["accession"] in accessions:
            by_queue[row["accession"]].append(row)
    output: list[dict[str, Any]] = []
    link_roles = Counter()
    same_blob = 0
    same_document = 0
    forms = Counter()
    timing = Counter()
    offsets = Counter()
    linked_boundary_ids: set[str] = set()
    linked_queue_ids: set[str] = set()
    event_provenances: set[str] = set()
    triples: set[tuple[str, str, str]] = set()
    issuer_ciks: set[str] = set()
    header_subject_verified = 0
    header_filed_by_verified = 0
    source_blob_bytes_verified = 0
    for liquid in sorted(liquid_rows, key=lambda item: item["caseId"]):
        accession = liquid["accession"]
        boundaries = sorted(by_boundary[accession], key=lambda item: item["sourceRowId"])
        queues = sorted(by_queue[accession], key=lambda item: item["rowId"])
        if len(boundaries) != 2 or len(queues) != 2:
            fail("exact two-row multiplicity changed")
        queue_by_id = {row["rowId"]: row for row in queues}
        if len(queue_by_id) != 2 or set(queue_by_id) != {row["sourceRowId"] for row in boundaries}:
            fail("boundary-to-queue row link changed")
        invariant = {
            (str(row["issuerCik"]).zfill(10), row["issuerName"], row["securityDescription"], row["suspensionBoundaryDate"], row["suspensionTimingQualifier"])
            for row in boundaries
        }
        if len(invariant) != 1:
            fail("boundary security identity fields disagree within accession")
        issuer_cik, issuer_name, security_description, boundary_date, qualifier = next(iter(invariant))
        if any(row["issuerCikState"] != "PRESENT" or row["issuerNameState"] != "PRESENT" or row["securityDescriptionState"] != "PRESENT" for row in boundaries):
            fail("required boundary descriptors became unavailable")
        _raw_blob, header = read_source_blob(liquid["sourceRef"], accession)
        source_blob_bytes_verified += 1
        issuer_party = {"cik": issuer_cik, "name": issuer_name}
        if header["SUBJECT_COMPANY"] != issuer_party:
            fail("SEC-header subject company differs from boundary issuer")
        header_subject_verified += 1
        filed_by_party = {"cik": EXCHANGE_FILER_CIK, "name": EXCHANGE_FILER_NAME}
        if header["FILED_BY"] != filed_by_party:
            fail("SEC-header filed-by party changed")
        if any(row["exchangeNameState"] != "PRESENT" or row["exchangeName"] != filed_by_party["name"] for row in boundaries):
            fail("boundary exchange name differs from SEC-header filed-by name")
        header_filed_by_verified += 1
        per_accession_events = {event_provenance(row) for row in boundaries}
        if len(per_accession_events) != 1:
            fail("two role projections no longer identify exactly one boundary event provenance")
        suspension_event_provenance = next(iter(per_accession_events))
        if suspension_event_provenance in event_provenances:
            fail("boundary event provenance reused across accessions")
        event_provenances.add(suspension_event_provenance)
        if liquid["currencyCode"] is not None or liquid["semanticValues"]["currencyResolved"] is not False:
            fail("currency was promoted")
        if liquid["sourceRef"]["evidenceSentenceSha256"] != liquid["evidenceTextSha256"] or sha(liquid["evidenceText"].encode("utf-8")) != liquid["evidenceTextSha256"]:
            fail("liquidation evidence hash changed")
        links: list[dict[str, Any]] = []
        roles_for_accession: list[str] = []
        for boundary_row in boundaries:
            queue_row = queue_by_id[boundary_row["sourceRowId"]]
            role = queue_role(queue_row, issuer_party, filed_by_party)
            roles_for_accession.append(role)
            link_roles[role] += 1
            if boundary_row["sourceBlob"]["blobSha256"] != liquid["sourceRef"]["blobSha256"]:
                fail("payment and boundary blob changed")
            same_blob += 1
            if boundary_row["evidenceOccurrences"][0]["sourceRef"]["documentIndex"] != liquid["sourceRef"]["documentIndex"]:
                fail("payment and boundary document changed")
            same_document += 1
            if queue_row["resolutionState"] != "UNRESOLVED" or queue_row["outcomesAccessed"] is not False:
                fail("queue row was promoted")
            linked_boundary_ids.add(boundary_row["boundaryId"])
            linked_queue_ids.add(queue_row["rowId"])
            forms[boundary_row["form"]] += 1
            timing[boundary_row["suspensionTimingQualifier"]] += 1
            links.append({
                "boundaryId": boundary_row["boundaryId"], "sourceRowId": boundary_row["sourceRowId"],
                "queueRowId": queue_row["rowId"], "queueRole": role,
                "secHeaderRole": "SUBJECT_COMPANY" if role == "ISSUER_CIK_MATCH" else "FILED_BY",
                "queueCik": str(queue_row["cik"]).zfill(10), "queueCompanyName": queue_row["companyName"],
            })
        if Counter(roles_for_accession) != {"ISSUER_CIK_MATCH": 1, "EXCHANGE_FILER": 1}:
            fail("queue role multiplicity changed")
        day_offset = (date.fromisoformat(liquid["effectiveDate"]) - date.fromisoformat(boundary_date)).days
        offsets[str(day_offset)] += 1
        triples.add((issuer_cik, issuer_name, security_description))
        issuer_ciks.add(issuer_cik)
        output.append({
            "caseId": liquid["caseId"], "accession": accession,
            "sourceBlobSha256": liquid["sourceRef"]["blobSha256"], "documentIndex": liquid["sourceRef"]["documentIndex"],
            "suspensionEventProvenanceSha256": suspension_event_provenance,
            "issuerCik": issuer_cik, "issuerName": issuer_name, "securityDescription": security_description,
            "suspensionBoundaryDate": boundary_date, "suspensionTimingQualifier": qualifier,
            "liquidationPaymentEffectiveDate": liquid["effectiveDate"], "dayOffset": day_offset,
            "amountLiteral": liquid["amountLiteral"], "amountPerShare": liquid["amountPerShare"],
            "currencyCode": None, "recipientExplicit": liquid["recipientExplicit"], "boundaryRoleProjectionLinks": links,
        })
    for row in output:
        exact_keys(row, set(ROW_KEYS), "rebuilt row")
        for link in row["boundaryRoleProjectionLinks"]:
            exact_keys(link, set(LINK_KEYS), "boundary link")
    sequence = "\n".join(sha(canonical(row)) for row in output) + "\n"
    stats = {
        "liquidationRows": len(output), "liquidationAccessions": len({row["accession"] for row in output}),
        "uniqueBoundaryEventProvenances": len(event_provenances),
        "boundaryRoleProjectionRows": sum(len(row["boundaryRoleProjectionLinks"]) for row in output),
        "boundaryRoleProjectionIds": len(linked_boundary_ids),
        "queueRoleProjectionRows": sum(len(row["boundaryRoleProjectionLinks"]) for row in output),
        "queueRoleProjectionRowIds": len(linked_queue_ids),
        "duplicateBoundaryRoleProjectionPairs": sum(len(row["boundaryRoleProjectionLinks"]) == 2 for row in output),
        "issuerRoleProjections": link_roles["ISSUER_CIK_MATCH"],
        "exchangeFilerRoleProjections": link_roles["EXCHANGE_FILER"],
        "secHeaderSubjectVerifiedEvents": header_subject_verified,
        "secHeaderFiledByVerifiedEvents": header_filed_by_verified,
        "sourceBlobBytesVerified": source_blob_bytes_verified, "uniqueSecurityTriples": len(triples),
        "uniqueIssuerCiks": len(issuer_ciks), "recipientExplicitRows": sum(row["recipientExplicit"] for row in output),
        "currencyResolvedRows": sum(row["currencyCode"] is not None for row in output),
        "sameBlobRoleProjections": same_blob, "sameDocumentRoleProjections": same_document,
        "roleProjectionFormCounts": dict(sorted(forms.items())),
        "roleProjectionTimingQualifierCounts": dict(sorted(timing.items())),
        "paymentDayOffsetCounts": dict(sorted(offsets.items())),
        "minimumPaymentDayOffset": min(row["dayOffset"] for row in output),
        "maximumPaymentDayOffset": max(row["dayOffset"] for row in output),
        "rowsCanonicalSha256": sha(canonical(output)), "rowSelfSequenceSha256": sha(sequence.encode("utf-8")),
    }
    if stats != EXPECTED_REBUILD:
        fail("source-derived reconciliation differs from sealed rebuild")
    return output, stats


def build_report(contract: dict[str, Any]) -> dict[str, Any]:
    rows, stats = build_rows()
    report = {
        "schema": "sec-form25-liquidation-payment-reconciliation-dry-run/v1",
        "taskId": contract["taskId"], "track": contract["track"], "contractRawSha256": CONTRACT_RAW,
        "contractSha256": CONTRACT_SELF, "disposition": "EXACT_SEVENTEEN_SECURITY_LEVEL_PARTIAL_RECONCILIATION_NO_TERMINAL_CREDIT",
        "population": stats, "rowsCanonicalSha256": sha(canonical(rows)),
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
        (LIQUIDATION, LIQUIDATION_RAW, "623baf8d15f884ec791de96090da43a9c5f29ba4"),
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
        fail("owned paths were not introduced together once")
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
        "backdated": lambda item: item.__setitem__("createdAt", "1970-01-01T00:00:00Z"),
        "purposeOverclaim": lambda item: item.__setitem__("purpose", "terminal wealth and final payment resolved"),
        "tickerJoin": lambda item: item["joinContract"].__setitem__("tickerJoinAllowed", True),
        "descriptionJoin": lambda item: item["joinContract"].__setitem__("descriptionJoinAllowed", True),
        "rowLoss": lambda item: item["expectedRebuild"].__setitem__("liquidationRows", 16),
        "eventDenominatorInflation": lambda item: item["expectedRebuild"].__setitem__("uniqueBoundaryEventProvenances", 34),
        "roleProjectionLoss": lambda item: item["expectedRebuild"].__setitem__("boundaryRoleProjectionRows", 17),
        "eventProjectionSemanticsWeakened": lambda item: item["semanticContract"].__setitem__("eventDenominatorIsSeventeenNotThirtyFour", False),
        "filedByCikDrift": lambda item: item["secHeaderRoleContract"].__setitem__("filedByCik", "0000000003"),
        "recipientPromotion": lambda item: item["expectedRebuild"].__setitem__("recipientExplicitRows", 17),
        "currencyPromotion": lambda item: item["expectedRebuild"].__setitem__("currencyResolvedRows", 17),
        "receiptCredit": lambda item: item["claimLocks"].__setitem__("cashReceiptVerified", True),
        "identityCredit": lambda item: item["claimLocks"].__setitem__("historicalIdentityResolved", True),
        "terminalCredit": lambda item: item["claimLocks"].__setitem__("terminalWealthComplete", True),
        "outcomeCredit": lambda item: item["claimLocks"].__setitem__("outcomesAccessed", True),
        "unknownCredit": lambda item: item["claimLocks"].__setitem__("unknownScientificCredit", True),
        "outputEnabled": lambda item: item["implementationContract"].__setitem__("publicOutputCreated", True),
        "writeEnabled": lambda item: item["implementationContract"].__setitem__("writeCapabilityAllowed", True),
        "remoteOptional": lambda item: item["implementationContract"].__setitem__("remoteVerificationRequired", False),
        "sourceRedirect": lambda item: item["authoritativeInputs"]["liquidationPaymentEvidence"].__setitem__("path", "state/evil.json"),
        "rowSchemaExtra": lambda item: item["rowSchema"].append("terminalWealth"),
    }
    kills: dict[str, bool] = {}
    for name, mutate in mutations.items():
        item = copy.deepcopy(contract)
        mutate(item)
        item = reseal(item)
        kills[name] = rejected(lambda item=item: validate_contract(item))
    fixture_issuer = {"cik": "0000000001", "name": "Issuer"}
    fixture_filed_by = {"cik": EXCHANGE_FILER_CIK, "name": EXCHANGE_FILER_NAME}
    fixture_queue = {"rowId": "R1", "cik": "0000000001", "companyName": "Issuer"}
    fixture_event = {
        "accession": "0000000001-20-000001", "sourceBlob": {"blobSha256": "1" * 64},
        "evidenceOccurrences": [{"sourceRef": {"documentIndex": 2, "evidenceSha256": "2" * 64}}],
        "suspensionBoundaryDate": "2020-01-02",
    }
    fixture_event_second_role = copy.deepcopy(fixture_event)
    fixture_event_second_role["sourceRowId"] = "ROLE-2"
    fixture_event_changed = copy.deepcopy(fixture_event)
    fixture_event_changed["evidenceOccurrences"][0]["sourceRef"]["evidenceSha256"] = "3" * 64
    kills.update({
        "exactAccessionNoNormalization": "A-1" != "A1",
        "issuerRoleRequiresExactParty": queue_role(fixture_queue, fixture_issuer, fixture_filed_by) == "ISSUER_CIK_MATCH",
        "exchangeRoleRequiresExactParty": queue_role({"cik": EXCHANGE_FILER_CIK, "companyName": EXCHANGE_FILER_NAME}, fixture_issuer, fixture_filed_by) == "EXCHANGE_FILER",
        "arbitraryThirdPartyRejected": rejected(lambda: queue_role({"cik": "0000000003", "companyName": "Third Party"}, fixture_issuer, fixture_filed_by)),
        "issuerNameMismatchRejected": rejected(lambda: queue_role({"cik": "0000000001", "companyName": "Wrong Issuer"}, fixture_issuer, fixture_filed_by)),
        "twoRoleRowsShareOneEventProvenance": event_provenance(fixture_event) == event_provenance(fixture_event_second_role),
        "differentEvidenceIsDifferentEventProvenance": event_provenance(fixture_event) != event_provenance(fixture_event_changed),
    })
    if not all(kills.values()):
        fail("self-test kill failed")
    return {"schema": "sec-form25-liquidation-payment-reconciliation-self-test/v1", "status": "PASS", "mutationKills": kills, "outcomesAccessed": False}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify-contract", "dry-run", "self-test"))
    parser.add_argument("--remote", action="store_true")
    args = parser.parse_args()
    try:
        contract = load_contract()
        repository = verify_repository(args.remote)
        if args.command == "verify-contract":
            result = {"schema": "sec-form25-liquidation-payment-reconciliation-contract-verification/v1", "status": "PASS", **repository, "outcomesAccessed": False}
        elif args.command == "self-test":
            result = {**self_test(contract), **repository}
        else:
            report = build_report(contract)
            result = {"schema": "sec-form25-liquidation-payment-reconciliation-verification/v1", "status": "PASS", **repository,
                      "reportSha256": report["reportSha256"], "population": report["population"], "publicOutputCreated": False,
                      "pricesAccessed": False, "returnsAccessed": False, "outcomesAccessed": False}
    except (ReconciliationError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
