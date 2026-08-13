#!/usr/bin/env python3
"""Build source-bound SEC security descriptors for the frozen identity-gap queue."""

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
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-primary-security-descriptor-contract-v1.json"
SCRIPT = Path(__file__).resolve()
TEST = ROOT / "tests" / "build-sec-primary-security-descriptor-v1.test.js"
OUTPUT = ROOT / "reports" / "early-detection" / "sec-primary-security-descriptor-v1.json"
GAP_QUEUE = ROOT / "reports" / "early-detection" / "sec-terminal-identity-evidence-gap-queue-v1.json"
FORM15_GZIP = ROOT / "reports" / "early-detection" / "sec-form15-structured-metadata-v2.json.gz"
FORM15_MANIFEST = ROOT / "reports" / "early-detection" / "sec-form15-structured-metadata-v2-gzip-manifest.json"
FORM25_GZIP = ROOT / "reports" / "early-detection" / "sec-form25-structured-metadata-v2.json.gz"
FORM25_MANIFEST = ROOT / "reports" / "early-detection" / "sec-form25-structured-metadata-v2-gzip-manifest.json"

CONTRACT_RAW_SHA256 = "fd16eac12600c8d297677a5801d1429cb6706c22bf294dd9b5a8933f4e9516ad"
GAP_RAW_SHA256 = "4c5bff255368bb0d9f498a8f367c65964c0de80d577cca70c695afe50ce0c650"
GAP_REPORT_SHA256 = "cb0b6272b1c07a8091354336bd9e5e1195ba43f766d393fe46fbebf04874e954"
FORM15_MANIFEST_RAW_SHA256 = "4781323557a3323a6982ccba7c02f5e5076f0168654e52d50cfce81d393e5422"
FORM15_GZIP_RAW_SHA256 = "ac10592573448967bf7e56fc145ff5db757ad3cebd66e825e3c24e8810b48253"
FORM25_MANIFEST_RAW_SHA256 = "a28c43ca2f9089ce5c7cb93dbd5bbc120af1b7579f4ec835fb2bc7b47cb4d9ab"
FORM25_GZIP_RAW_SHA256 = "942bb1ec0fbc292a53ca6b3760b2ffee13253cf60322ecb9778905118a2d370e"

REMOTE = "https://github.com/Karlryl/screener-data.git"
REMOTE_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
PARENT_REMOTE_COMMIT = "a4a06368149efe67e8418e489510fd6e88d277a4"
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
COMMIT40 = re.compile(r"[0-9a-f]{40}\Z")
ACCESSION = re.compile(r"[0-9]{10}-[0-9]{2}-[0-9]{6}\Z")

LANE_FIELDS = {
    "FORM15_V2": {
        "issuerCik": "issuerCik",
        "issuerName": "issuerName",
        "securityTitleClass": "securityTitleClass",
        "securityDescription": None,
        "exchangeCik": None,
        "exchangeName": None,
    },
    "FORM25_V2": {
        "issuerCik": "issuerCik",
        "issuerName": "issuerName",
        "securityTitleClass": None,
        "securityDescription": "securityDescription",
        "exchangeCik": "exchangeCik",
        "exchangeName": "exchangeName",
    },
}
DESCRIPTOR_FIELDS = tuple(sorted(next(iter(LANE_FIELDS.values()))))
OUTPUT_STATUSES = {"OBSERVED_SOURCE_DESCRIPTOR", "MISSING", "AMBIGUOUS"}
SOURCE_FIELD_STATUSES = {
    "PRESENT", "MISSING", "AMBIGUOUS_DUPLICATE", "AMBIGUOUS_CONFLICT", "UNAVAILABLE",
}
PARSE_STATUSES = {
    "FORM15_V2": {
        "SGML_MALFORMED", "SOURCE_AMBIGUOUS_INVENTORY", "TEXTUAL_FORM_DOCUMENT_MISSING",
        "TEXTUAL_FORM_DOCUMENT_PRESENT",
    },
    "FORM25_V2": {
        "SGML_MALFORMED", "SOURCE_AMBIGUOUS_INVENTORY", "STRUCTURED_XML_PRESENT",
        "XML_DOCUMENT_MISSING", "XML_DOCUMENT_MULTIPLE", "XML_MALFORMED",
    },
}
FORM15_CANDIDATE_KINDS = {
    "EFFECTIVE_LANGUAGE", "PAYMENT_OR_TERMINAL_LANGUAGE", "TERMINATION_LANGUAGE",
    "WITHDRAWAL_LANGUAGE",
}
SOURCE_REF_KEYS = {
    "blobSha256", "relativePath", "documentIndex", "documentType", "documentSequence",
    "documentFilename", "rawDocumentSha256", "rawTextSha256", "locatorKind", "locator",
    "normalizationMode", "evidenceSha256",
}
CLAIM_LOCK_KEYS = {
    "continuousValidityIntervalProven", "cusipInvented", "historicalIdentityResolved",
    "listingIdentityResolved", "originalV4GateCredit", "outcomesAccessed", "priceDataAccessed",
    "returnComputed", "securityIdentityResolved", "terminalPaymentVerified",
    "terminalSessionProven", "terminalWealthComplete", "tickerJoinUsed",
}


class DescriptorError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise DescriptorError(message)


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        fail(f"{label} exact keys changed")


def git_bytes(*args: str) -> bytes:
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True).stdout


def git_text(*args: str) -> str:
    return git_bytes(*args).decode("utf-8").strip()


def normalized_cik(value: str) -> str:
    if not isinstance(value, str) or not value.isdigit() or len(value) > 10:
        fail("CIK is not a source string of at most ten digits")
    return value.zfill(10)


def validate_contract() -> tuple[dict[str, Any], bytes]:
    raw = CONTRACT.read_bytes()
    if sha(raw) != CONTRACT_RAW_SHA256:
        fail("contract raw binding changed")
    value = json.loads(raw)
    exact_keys(value, {
        "authorizedImplementation", "claimLocks", "createdAt", "inputBindings", "output",
        "populationContract", "purpose", "remoteBinding", "schema", "selectionContract",
        "taskId", "track",
    }, "contract")
    if value["schema"] != "early-detection-sec-primary-security-descriptor-contract/v1":
        fail("contract schema changed")
    if value["taskId"] != "Q003-SEC-PRIMARY-SECURITY-DESCRIPTOR" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract study boundary changed")
    exact_keys(value["claimLocks"], CLAIM_LOCK_KEYS, "contract claimLocks")
    if any(item is not False for item in value["claimLocks"].values()):
        fail("contract claim lock changed")
    expected_implementation = {
        "builderPath": "scripts/build-sec-primary-security-descriptor-v1.py",
        "outputPath": "reports/early-detection/sec-primary-security-descriptor-v1.json",
        "testPath": "tests/build-sec-primary-security-descriptor-v1.test.js",
    }
    if value["authorizedImplementation"] != expected_implementation:
        fail("authorized implementation paths changed")
    if value["output"] != {"path": expected_implementation["outputPath"], "writeNewAtomic": True}:
        fail("output write policy changed")
    population = value["populationContract"]
    exact_keys(population, {
        "crossAccessionSelectionAllowed", "expectedRows", "expectedSourceLaneCounts",
        "expectedUniqueAccessions", "issuerCikConsistencyIsGuardOnly", "joinKey",
        "oneOutputRowPerGapWorkItem", "tickerJoinAllowed",
    }, "populationContract")
    if population != {
        "crossAccessionSelectionAllowed": False,
        "expectedRows": 656,
        "expectedSourceLaneCounts": {"FORM15_V2": 65, "FORM25_V2": 591},
        "expectedUniqueAccessions": 652,
        "issuerCikConsistencyIsGuardOnly": True,
        "joinKey": "EXACT_ACCESSION_PLUS_EXCLUSIVE_SOURCE_LANE_WITH_QUEUE_CIK_CONSISTENCY_GUARD",
        "oneOutputRowPerGapWorkItem": True,
        "tickerJoinAllowed": False,
    }:
        fail("population contract changed")
    selection = value["selectionContract"]
    exact_keys(selection, {
        "allowedOutputStatuses", "descriptorFields", "duplicateMetadataRows", "fieldSplittingAllowed",
        "form15SecurityTitleClassIsIndivisible", "missingOrUnavailableSourceField",
        "sourceAmbiguityPromotionAllowed", "sourceRefsPreservedVerbatim",
    }, "selectionContract")
    if selection["descriptorFields"] != {
        field: {lane: LANE_FIELDS[lane][field] for lane in ("FORM15_V2", "FORM25_V2")}
        for field in DESCRIPTOR_FIELDS
    }:
        fail("descriptor source mapping changed")
    if set(selection["allowedOutputStatuses"]) != OUTPUT_STATUSES:
        fail("descriptor status vocabulary changed")
    if selection["duplicateMetadataRows"] != "PRESERVE_ALL_SOURCE_ROW_IDS_AND_DEDUPLICATE_ONLY_BYTE_IDENTICAL_EVIDENCE":
        fail("duplicate-row evidence policy changed")
    if any(selection[key] is not expected for key, expected in {
        "fieldSplittingAllowed": False,
        "form15SecurityTitleClassIsIndivisible": True,
        "sourceAmbiguityPromotionAllowed": False,
        "sourceRefsPreservedVerbatim": True,
    }.items()):
        fail("descriptor claim ceiling changed")
    if selection["missingOrUnavailableSourceField"] != "MISSING":
        fail("missingness policy changed")
    if value["remoteBinding"] != {
        "parentRemoteCommit": PARENT_REMOTE_COMMIT, "ref": REMOTE_REF, "remote": REMOTE,
    }:
        fail("remote binding changed")
    return value, raw


def verify_repository_binding(contract: dict[str, Any]) -> None:
    if git_text("remote", "get-url", "origin") != REMOTE:
        fail("origin URL changed")
    head = git_text("rev-parse", "HEAD")
    if COMMIT40.fullmatch(head) is None or subprocess.run(
        ["git", "merge-base", "--is-ancestor", PARENT_REMOTE_COMMIT, head],
        cwd=ROOT, check=False, capture_output=True,
    ).returncode != 0:
        fail("parent remote commit is not an ancestor of HEAD")
    remote_tracking_ref = "refs/remotes/origin/codex/early-detection-v4-gates-20260810"
    tracking_commit = git_text("rev-parse", remote_tracking_ref)
    if subprocess.run(
        ["git", "merge-base", "--is-ancestor", PARENT_REMOTE_COMMIT, tracking_commit],
        cwd=ROOT, check=False, capture_output=True,
    ).returncode != 0:
        fail("parent commit is not in the remote-tracking lineage")
    bound_paths = [GAP_QUEUE, FORM15_MANIFEST, FORM15_GZIP, FORM25_MANIFEST, FORM25_GZIP]
    for path in bound_paths:
        relative = path.relative_to(ROOT).as_posix()
        if git_bytes("show", f"{PARENT_REMOTE_COMMIT}:{relative}") != path.read_bytes():
            fail(f"input is not exact at parent remote commit: {relative}")
    if contract["remoteBinding"]["parentRemoteCommit"] != PARENT_REMOTE_COMMIT:
        fail("contract parent remote commit changed")


def validate_gap_queue(raw: bytes) -> dict[str, Any]:
    if sha(raw) != GAP_RAW_SHA256:
        fail("gap queue raw binding changed")
    value = json.loads(raw)
    exact_keys(value, {
        "claimLocks", "contractRawSha256", "outcomesAccessed", "population", "profileRawSha256",
        "profileReportSha256", "reportSha256", "resolutionRawSha256", "resolutionReportSha256",
        "rows", "schema", "taskId", "track",
    }, "gap queue")
    body = dict(value)
    report_sha = body.pop("reportSha256", None)
    if report_sha != GAP_REPORT_SHA256 or report_sha != sha(canonical(body)):
        fail("gap queue self binding changed")
    if value["schema"] != "early-detection-sec-terminal-identity-evidence-gap-queue/v1":
        fail("gap queue schema changed")
    if value["outcomesAccessed"] is not False or any(item is not False for item in value["claimLocks"].values()):
        fail("gap queue claim boundary changed")
    expected_population = {
        "byGapClass": {
            "GAP_NO_ARCHIVE_SNAPSHOT": 452,
            "GAP_PRIOR_SNAPSHOT_ISSUER_ABSENT": 19,
            "GAP_PRIOR_SNAPSHOT_MULTIPLE_TICKERS": 42,
            "GAP_SINGLE_POINT_TICKER_NEEDS_INTERVAL_AND_CORROBORATION": 143,
        },
        "resolvedRows": 0, "rows": 656, "uniqueAccessions": 652,
        "uniqueIssuerCiks": 607, "unresolvedRows": 656,
    }
    if value["population"] != expected_population or len(value["rows"]) != 656:
        fail("gap queue denominator changed")
    row_keys = {
        "accession", "filedDate", "gapClass", "gapPriority", "historicalIdentityResolved",
        "issuerCik", "listingIdentityResolved", "outcomesAccessed", "pointEvidence",
        "queuePriorityRank", "requiredEvidence", "resolutionCreditGranted", "securityIdentityResolved",
        "sourceExtractionRowId", "sourceOccurrenceId", "sourceProfileRank", "sourceProfileRowId",
        "sourceResolutionRowId", "tickerReuseResolved", "workItemId", "workItemState", "workRank",
    }
    if [row.get("workRank") for row in value["rows"]] != list(range(1, 657)):
        fail("gap queue order changed")
    if len({row.get("workItemId") for row in value["rows"]}) != 656:
        fail("gap work-item uniqueness changed")
    for row in value["rows"]:
        exact_keys(row, row_keys, "gap row")
        exact_keys(row["pointEvidence"], {"pointState", "snapshot", "tickerCandidates"}, "gap point evidence")
        if ACCESSION.fullmatch(row["accession"]) is None or normalized_cik(row["issuerCik"]) != row["issuerCik"]:
            fail("gap accession or CIK changed")
        if row["workItemState"] != "UNRESOLVED_IDENTITY_EVIDENCE_REQUIRED":
            fail("gap work item was promoted")
        for key in (
            "historicalIdentityResolved", "listingIdentityResolved", "outcomesAccessed",
            "resolutionCreditGranted", "securityIdentityResolved", "tickerReuseResolved",
        ):
            if row[key] is not False:
                fail("gap row claim boundary changed")
        expected_id = sha(canonical({key: item for key, item in row.items() if key != "workItemId"}))
        if row["workItemId"] != expected_id:
            fail("gap work-item hash changed")
    return value


def validate_source_ref(
    ref: dict[str, Any], evidence: str, lane: str, require_evidence_hash: bool = True,
) -> None:
    exact_keys(ref, SOURCE_REF_KEYS, f"{lane} sourceRef")
    for key in ("blobSha256", "rawDocumentSha256", "rawTextSha256", "evidenceSha256"):
        if not isinstance(ref[key], str) or HEX64.fullmatch(ref[key]) is None:
            fail(f"{lane} sourceRef hash changed: {key}")
    if Path(ref["relativePath"]).stem != ref["blobSha256"]:
        fail(f"{lane} sourceRef path/hash changed")
    if not isinstance(ref["documentIndex"], int) or ref["documentIndex"] < 0:
        fail(f"{lane} sourceRef document index changed")
    if not all(isinstance(ref[key], str) and ref[key] for key in (
        "documentType", "documentSequence", "documentFilename", "locator",
    )):
        fail(f"{lane} sourceRef locator changed")
    allowed = {
        "SEC_HEADER_LINE": {"NOT_APPLICABLE"},
        "SGML_DOCUMENT_TYPE": {"NOT_APPLICABLE"},
        "XML_PATH": {"NOT_APPLICABLE"},
        "NORMALIZED_TEXT_WINDOW": {"HTML_PARSER", "CONSERVATIVE_TAG_STRIP_FALLBACK"},
        "NORMALIZED_TEXT_SENTENCE": {"HTML_PARSER", "CONSERVATIVE_TAG_STRIP_FALLBACK"},
    }
    if ref["locatorKind"] not in allowed or ref["normalizationMode"] not in allowed[ref["locatorKind"]]:
        fail(f"{lane} sourceRef locator mode changed")
    if require_evidence_hash and ref["evidenceSha256"] != sha(evidence.encode("utf-8")):
        fail(f"{lane} sourceRef evidence hash changed")


def validate_source_field(field: dict[str, Any], lane: str, field_name: str) -> None:
    exact_keys(field, {"status", "value", "evidence"}, f"{lane} field {field_name}")
    if field["status"] not in SOURCE_FIELD_STATUSES or not isinstance(field["evidence"], list):
        fail(f"{lane} field status changed: {field_name}")
    values = []
    for evidence in field["evidence"]:
        exact_keys(evidence, {"sourceRef", "value"}, f"{lane} field evidence")
        if not isinstance(evidence["value"], str) or not evidence["value"]:
            fail(f"{lane} empty evidence value")
        # Form-25 semantic-date evidence stores the source sentence hash while
        # exposing its normalized ISO date as the field value. The bound raw
        # report remains authoritative; only XML/value locators can be checked
        # against the emitted field value here.
        require_hash = not (
            lane == "FORM25_V2"
            and evidence["sourceRef"]["locatorKind"] == "NORMALIZED_TEXT_SENTENCE"
        )
        validate_source_ref(evidence["sourceRef"], evidence["value"], lane, require_hash)
        values.append(evidence["value"])
    unique = set(values)
    if field["status"] == "PRESENT":
        if not isinstance(field["value"], str) or not field["value"] or unique != {field["value"]}:
            fail(f"{lane} present field lacks agreeing evidence: {field_name}")
    elif field["value"] is not None:
        fail(f"{lane} non-present field has promoted value: {field_name}")
    if field["status"] in {"MISSING", "UNAVAILABLE"} and field["evidence"]:
        fail(f"{lane} missing field carries evidence: {field_name}")
    if field["status"] == "AMBIGUOUS_DUPLICATE" and (len(values) < 2 or len(unique) != 1):
        fail(f"{lane} duplicate ambiguity changed: {field_name}")
    if field["status"] == "AMBIGUOUS_CONFLICT" and len(unique) < 2:
        fail(f"{lane} conflict ambiguity changed: {field_name}")


def validate_source_candidate(candidate: dict[str, Any], lane: str) -> None:
    if lane == "FORM15_V2":
        exact_keys(candidate, {"candidateId", "kind", "verificationStatus", "text", "sourceRef"}, "Form15 candidate")
    else:
        exact_keys(candidate, {
            "amountSignal", "candidateId", "kind", "verificationStatus", "text", "sourceRef",
        }, "Form25 candidate")
        if candidate["amountSignal"] not in {"CURRENCY_AMOUNT", "PER_SHARE_AMOUNT", "SHARE_RATIO"}:
            fail("Form25 candidate amount signal changed")
    if candidate["verificationStatus"] != "CANDIDATE_ONLY":
        fail(f"{lane} candidate was promoted")
    if not isinstance(candidate["candidateId"], str) or HEX64.fullmatch(candidate["candidateId"]) is None:
        fail(f"{lane} candidate id changed")
    if not isinstance(candidate["text"], str) or not candidate["text"]:
        fail(f"{lane} candidate text changed")
    validate_source_ref(candidate["sourceRef"], candidate["text"], lane)


def validate_metadata_payload(payload: dict[str, Any], lane: str, raw: bytes, contract_input: dict[str, Any]) -> None:
    if lane == "FORM15_V2":
        top_keys = {
            "candidateKindCounts", "candidateSnippetCount", "claimLocks", "fieldStatusCounts",
            "implementationBindings", "inputBindings", "parseStatusCounts", "population",
            "reportSha256", "rows", "schema", "taskId", "track",
        }
        row_keys = {
            "accession", "ambiguities", "candidateSnippets", "fields", "form", "inventoryStatus",
            "missingness", "outcomesAccessed", "parseStatus", "priorityRank", "queueFiledDate",
            "rowId", "sourceBlob",
        }
        field_names = {"filingDate", "formSubtype", "issuerCik", "issuerName", "securityTitleClass"}
        expected_rows, expected_accessions = 17067, 12923
    else:
        top_keys = {
            "candidateSnippetCount", "claimLocks", "fieldStatusCounts", "implementationBindings",
            "inputBindings", "parseStatusCounts", "population", "reportSha256", "rows", "schema",
            "taskId", "track",
        }
        row_keys = {
            "accession", "ambiguities", "candidateSnippets", "fields", "filedDate", "form",
            "inventoryStatus", "missingness", "outcomesAccessed", "parseStatus", "priorityRank",
            "rowId", "sourceBlob",
        }
        field_names = {
            "exchangeCik", "exchangeName", "issuerCik", "issuerName", "removalEffectiveDate",
            "ruleProvision", "securityDescription", "signatureDate", "suspensionDate",
        }
        expected_rows, expected_accessions = 27285, 14504
    exact_keys(payload, top_keys, f"{lane} payload")
    if payload["schema"] != contract_input["schema"]:
        fail(f"{lane} schema changed")
    expected_self = sha(canonical({key: item for key, item in payload.items() if key != "reportSha256"}))
    if payload["reportSha256"] != contract_input["decompressed"]["reportSha256"] or payload["reportSha256"] != expected_self:
        fail(f"{lane} report self binding changed")
    if len(raw) != contract_input["decompressed"]["bytes"] or sha(raw) != contract_input["decompressed"]["rawSha256"]:
        fail(f"{lane} decompressed raw binding changed")
    if any(item is not False for item in payload["claimLocks"].values()):
        fail(f"{lane} claim locks changed")
    rows = payload["rows"]
    if len(rows) != expected_rows or len({row.get("rowId") for row in rows}) != expected_rows:
        fail(f"{lane} row denominator or uniqueness changed")
    if len({row.get("accession") for row in rows}) != expected_accessions:
        fail(f"{lane} accession denominator changed")
    priorities = [row.get("priorityRank") for row in rows]
    if priorities != sorted(priorities) or len(set(priorities)) != len(priorities):
        fail(f"{lane} priority order changed")
    parse_counts: Counter[str] = Counter()
    field_counts = {field: Counter() for field in sorted(field_names)}
    candidate_count = 0
    candidate_kind_counts: Counter[str] = Counter()
    for row in rows:
        exact_keys(row, row_keys, f"{lane} row")
        if ACCESSION.fullmatch(row["accession"]) is None or row["outcomesAccessed"] is not False:
            fail(f"{lane} row boundary changed")
        if not isinstance(row["sourceBlob"], (dict, type(None))):
            fail(f"{lane} sourceBlob type changed")
        if row["sourceBlob"] is not None:
            exact_keys(row["sourceBlob"], {"blobSha256", "bytes", "relativePath"}, f"{lane} sourceBlob")
            if HEX64.fullmatch(row["sourceBlob"]["blobSha256"]) is None:
                fail(f"{lane} sourceBlob hash changed")
            if Path(row["sourceBlob"]["relativePath"]).stem != row["sourceBlob"]["blobSha256"]:
                fail(f"{lane} sourceBlob path changed")
        exact_keys(row["fields"], field_names, f"{lane} fields")
        for field_name, field in row["fields"].items():
            validate_source_field(field, lane, field_name)
            field_counts[field_name][field["status"]] += 1
        if not isinstance(row["candidateSnippets"], list):
            fail(f"{lane} candidate list changed")
        for candidate in row["candidateSnippets"]:
            validate_source_candidate(candidate, lane)
            candidate_count += 1
            candidate_kind_counts[candidate["kind"]] += 1
        expected_missing = sorted(name for name, field in row["fields"].items() if field["status"] == "MISSING")
        expected_ambiguous = sorted(name for name, field in row["fields"].items() if field["status"].startswith("AMBIGUOUS"))
        if row["parseStatus"] == "SOURCE_AMBIGUOUS_INVENTORY":
            expected_ambiguous.insert(0, "sourceBlob")
        if row["missingness"] != expected_missing or row["ambiguities"] != expected_ambiguous:
            fail(f"{lane} missingness ledger changed")
        parse_counts[row["parseStatus"]] += 1
    expected_parse_counts = {
        status: parse_counts.get(status, 0) for status in sorted(PARSE_STATUSES[lane])
    }
    if payload["parseStatusCounts"] != expected_parse_counts:
        fail(f"{lane} parse-status ledger changed")
    expected_field_counts = {
        field: {status: field_counts[field].get(status, 0) for status in sorted(SOURCE_FIELD_STATUSES)}
        for field in sorted(field_names)
    }
    if payload["fieldStatusCounts"] != expected_field_counts:
        fail(f"{lane} field-status ledger changed")
    if payload["candidateSnippetCount"] != candidate_count:
        fail(f"{lane} candidate count changed")
    if lane == "FORM15_V2":
        expected_candidate_counts = {
            kind: candidate_kind_counts.get(kind, 0) for kind in sorted(FORM15_CANDIDATE_KINDS)
        }
        if payload["candidateKindCounts"] != expected_candidate_counts:
            fail("Form15 candidate-kind ledger changed")


def load_manifest(path: Path, raw_claim: str, contract_input: dict[str, Any], lane: str) -> dict[str, Any]:
    raw = path.read_bytes()
    if sha(raw) != raw_claim or raw_claim != contract_input["manifest"]["rawSha256"]:
        fail(f"{lane} manifest raw binding changed")
    value = json.loads(raw)
    exact_keys(value, {
        "bindings", "claimLocks", "counts", "createdAt", "decompressed", "gzip",
        "manifestSha256", "parentRemoteCommit", "ref", "remote", "schema", "taskId", "track",
    }, f"{lane} manifest")
    expected_self = sha(canonical({key: item for key, item in value.items() if key != "manifestSha256"}))
    if value["manifestSha256"] != contract_input["manifest"]["manifestSha256"] or value["manifestSha256"] != expected_self:
        fail(f"{lane} manifest self binding changed")
    if value["gzip"]["path"] != contract_input["gzip"]["path"]:
        fail(f"{lane} manifest gzip path changed")
    if value["gzip"]["bytes"] != contract_input["gzip"]["bytes"] or value["gzip"]["rawSha256"] != contract_input["gzip"]["rawSha256"]:
        fail(f"{lane} manifest gzip binding changed")
    if value["decompressed"]["bytes"] != contract_input["decompressed"]["bytes"]:
        fail(f"{lane} manifest decompressed bytes changed")
    if value["decompressed"]["rawSha256"] != contract_input["decompressed"]["rawSha256"]:
        fail(f"{lane} manifest decompressed raw hash changed")
    if value["decompressed"]["reportSha256"] != contract_input["decompressed"]["reportSha256"]:
        fail(f"{lane} manifest report hash changed")
    if value["remote"] != REMOTE or value["ref"] != REMOTE_REF or any(item is not False for item in value["claimLocks"].values()):
        fail(f"{lane} manifest boundary changed")
    return value


def load_metadata(
    path: Path, manifest_path: Path, gzip_claim: str, manifest_claim: str,
    contract_input: dict[str, Any], lane: str, target_accessions: set[str],
) -> list[dict[str, Any]]:
    load_manifest(manifest_path, manifest_claim, contract_input, lane)
    compressed = path.read_bytes()
    if len(compressed) != contract_input["gzip"]["bytes"] or sha(compressed) != gzip_claim:
        fail(f"{lane} gzip raw binding changed")
    raw = gzip.decompress(compressed)
    payload = json.loads(raw)
    validate_metadata_payload(payload, lane, raw, contract_input)
    selected = [copy.deepcopy(row) for row in payload["rows"] if row["accession"] in target_accessions]
    return selected


def load_inputs(contract: dict[str, Any]) -> tuple[dict[str, Any], dict[str, list[dict[str, Any]]]]:
    gap = validate_gap_queue(GAP_QUEUE.read_bytes())
    accessions = {row["accession"] for row in gap["rows"]}
    form15 = load_metadata(
        FORM15_GZIP, FORM15_MANIFEST, FORM15_GZIP_RAW_SHA256, FORM15_MANIFEST_RAW_SHA256,
        contract["inputBindings"]["form15Metadata"], "FORM15_V2", accessions,
    )
    form25 = load_metadata(
        FORM25_GZIP, FORM25_MANIFEST, FORM25_GZIP_RAW_SHA256, FORM25_MANIFEST_RAW_SHA256,
        contract["inputBindings"]["form25Metadata"], "FORM25_V2", accessions,
    )
    return gap, {"FORM15_V2": form15, "FORM25_V2": form25}


def merged_descriptor(metadata_rows: list[dict[str, Any]], lane: str, output_field: str) -> dict[str, Any]:
    source_field = LANE_FIELDS[lane][output_field]
    if source_field is None:
        return {
            "status": "MISSING", "value": None, "sourceField": None,
            "dispositionReason": "FIELD_NOT_IN_SOURCE_LANE_SCHEMA", "evidence": [],
        }
    fields = [row["fields"][source_field] for row in metadata_rows]
    evidence_by_raw: dict[bytes, dict[str, Any]] = {}
    for field in fields:
        for evidence in field["evidence"]:
            evidence_by_raw.setdefault(canonical(evidence), copy.deepcopy(evidence))
    evidence = [evidence_by_raw[key] for key in sorted(evidence_by_raw)]
    if not evidence:
        return {
            "status": "MISSING", "value": None, "sourceField": source_field,
            "dispositionReason": "SOURCE_FIELD_MISSING_OR_UNAVAILABLE", "evidence": [],
        }
    statuses = {field["status"] for field in fields}
    values = {item["value"] for item in evidence}
    field_values = {field["value"] for field in fields}
    if statuses == {"PRESENT"} and len(values) == 1 and field_values == values:
        return {
            "status": "OBSERVED_SOURCE_DESCRIPTOR", "value": next(iter(values)),
            "sourceField": source_field, "dispositionReason": "SOURCE_EVIDENCE_AGREES", "evidence": evidence,
        }
    return {
        "status": "AMBIGUOUS", "value": None, "sourceField": source_field,
        "dispositionReason": "SOURCE_FIELD_AMBIGUOUS_OR_ROW_DISAGREEMENT", "evidence": evidence,
    }


def index_metadata(lane_rows: dict[str, list[dict[str, Any]]]) -> dict[str, dict[str, list[dict[str, Any]]]]:
    result: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for lane, rows in lane_rows.items():
        by_accession: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in rows:
            by_accession[row["accession"]].append(row)
        for accession, items in by_accession.items():
            items.sort(key=lambda row: (row["priorityRank"], row["rowId"]))
        result[lane] = dict(by_accession)
    return result


def build_rows(
    gap_rows: list[dict[str, Any]], lane_rows: dict[str, list[dict[str, Any]]],
    claim_locks: dict[str, bool], enforce_population: bool = True,
) -> list[dict[str, Any]]:
    indices = index_metadata(lane_rows)
    result = []
    lane_counts: Counter[str] = Counter()
    for gap in gap_rows:
        lanes = [lane for lane in ("FORM15_V2", "FORM25_V2") if gap["accession"] in indices[lane]]
        if len(lanes) != 1:
            fail("gap accession does not map to exactly one source lane")
        lane = lanes[0]
        metadata_rows = indices[lane][gap["accession"]]
        if any(row["accession"] != gap["accession"] for row in metadata_rows):
            fail("cross-accession metadata selection attempted")
        date_key = "queueFiledDate" if lane == "FORM15_V2" else "filedDate"
        if any(row[date_key] != gap["filedDate"] for row in metadata_rows):
            fail("source filing-date selection changed")
        for metadata in metadata_rows:
            issuer = metadata["fields"]["issuerCik"]
            if issuer["status"] == "PRESENT" and normalized_cik(issuer["value"]) != gap["issuerCik"]:
                fail("source issuer CIK conflicts with queue guard")
        descriptors = {
            field: merged_descriptor(metadata_rows, lane, field) for field in DESCRIPTOR_FIELDS
        }
        row = {
            "descriptorRowId": "",
            "workRank": gap["workRank"],
            "gapWorkItemId": gap["workItemId"],
            "accession": gap["accession"],
            "filedDate": gap["filedDate"],
            "queueIssuerCikGuard": gap["issuerCik"],
            "sourceLane": lane,
            "sourceMetadataRowIds": [item["rowId"] for item in metadata_rows],
            "sourceMetadataForms": [item["form"] for item in metadata_rows],
            "sourceMetadataParseStatuses": [item["parseStatus"] for item in metadata_rows],
            "descriptors": descriptors,
            "missingFields": sorted(field for field, item in descriptors.items() if item["status"] == "MISSING"),
            "ambiguousFields": sorted(field for field, item in descriptors.items() if item["status"] == "AMBIGUOUS"),
            "claimLocks": copy.deepcopy(claim_locks),
        }
        row["descriptorRowId"] = sha(canonical({key: item for key, item in row.items() if key != "descriptorRowId"}))
        result.append(row)
        lane_counts[lane] += 1
    if enforce_population:
        if len(result) != 656 or len({row["gapWorkItemId"] for row in result}) != 656:
            fail("descriptor denominator changed")
        if len({row["accession"] for row in result}) != 652:
            fail("descriptor accession denominator changed")
        if dict(sorted(lane_counts.items())) != {"FORM15_V2": 65, "FORM25_V2": 591}:
            fail("descriptor lane counts changed")
        if [row["workRank"] for row in result] != list(range(1, 657)):
            fail("descriptor row order changed")
    return result


def field_status_counts(rows: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    return {
        field: {
            status: sum(row["descriptors"][field]["status"] == status for row in rows)
            for status in sorted(OUTPUT_STATUSES)
        }
        for field in DESCRIPTOR_FIELDS
    }


def population(rows: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "rows": len(rows),
        "uniqueAccessions": len({row["accession"] for row in rows}),
        "sourceLaneCounts": dict(sorted(Counter(row["sourceLane"] for row in rows).items())),
        "uniqueSourceMetadataRows": len({item for row in rows for item in row["sourceMetadataRowIds"]}),
        "identityResolvedRows": 0,
        "listingResolvedRows": 0,
        "gateCreditRows": 0,
    }


def bind_implementation() -> dict[str, str]:
    head = git_text("rev-parse", "HEAD")
    if COMMIT40.fullmatch(head) is None:
        fail("implementation HEAD is not a commit")
    values = {
        "contractRawSha256": sha(CONTRACT.read_bytes()),
        "builderRawSha256": sha(SCRIPT.read_bytes()),
        "testRawSha256": sha(TEST.read_bytes()),
    }
    for path, key in ((CONTRACT, "contractRawSha256"), (SCRIPT, "builderRawSha256"), (TEST, "testRawSha256")):
        relative = path.relative_to(ROOT).as_posix()
        try:
            committed = git_bytes("show", f"{head}:{relative}")
        except subprocess.CalledProcessError as exc:
            raise DescriptorError("production build requires committed contract, builder, and test") from exc
        if committed != path.read_bytes() or sha(committed) != values[key]:
            fail("production implementation differs from bound HEAD")
    return {"sourceCommit": head, **values}


def build_report(
    contract: dict[str, Any], gap: dict[str, Any], lane_rows: dict[str, list[dict[str, Any]]],
    implementation: dict[str, str],
) -> dict[str, Any]:
    rows = build_rows(gap["rows"], lane_rows, contract["claimLocks"])
    value = {
        "schema": "early-detection-sec-primary-security-descriptor/v1",
        "taskId": contract["taskId"],
        "track": contract["track"],
        "contractRawSha256": CONTRACT_RAW_SHA256,
        "inputBindings": copy.deepcopy(contract["inputBindings"]),
        "remoteBinding": copy.deepcopy(contract["remoteBinding"]),
        "implementationBindings": copy.deepcopy(implementation),
        "population": population(rows),
        "fieldStatusCounts": field_status_counts(rows),
        "claimLocks": copy.deepcopy(contract["claimLocks"]),
        "rows": rows,
    }
    value["reportSha256"] = sha(canonical(value))
    return value


def validate_descriptor(field: dict[str, Any], field_name: str, lane: str) -> None:
    exact_keys(field, {"dispositionReason", "evidence", "sourceField", "status", "value"}, "descriptor field")
    if field["status"] not in OUTPUT_STATUSES or not isinstance(field["evidence"], list):
        fail("descriptor field status changed")
    expected_source = LANE_FIELDS[lane][field_name]
    if field["sourceField"] != expected_source:
        fail("descriptor source-field mapping changed")
    if field["status"] == "OBSERVED_SOURCE_DESCRIPTOR":
        if not isinstance(field["value"], str) or not field["value"] or not field["evidence"]:
            fail("observed descriptor lacks source evidence")
        if {item["value"] for item in field["evidence"]} != {field["value"]}:
            fail("observed descriptor evidence disagrees")
    elif field["value"] is not None:
        fail("missing or ambiguous descriptor has a promoted value")
    if field["status"] == "MISSING" and field["evidence"]:
        fail("missing descriptor carries evidence")
    for evidence in field["evidence"]:
        exact_keys(evidence, {"sourceRef", "value"}, "descriptor evidence")
        validate_source_ref(evidence["sourceRef"], evidence["value"], lane)


def validate_rows(rows: list[dict[str, Any]], expected: list[dict[str, Any]], claim_locks: dict[str, bool]) -> None:
    if rows != expected:
        fail("descriptor rows do not match exact source rebuild")
    row_keys = {
        "accession", "ambiguousFields", "claimLocks", "descriptorRowId", "descriptors", "filedDate",
        "gapWorkItemId", "missingFields", "queueIssuerCikGuard", "sourceLane", "sourceMetadataForms",
        "sourceMetadataParseStatuses", "sourceMetadataRowIds", "workRank",
    }
    if [row["workRank"] for row in rows] != list(range(1, 657)):
        fail("descriptor row order changed")
    if len({row["descriptorRowId"] for row in rows}) != 656 or len({row["gapWorkItemId"] for row in rows}) != 656:
        fail("descriptor row identity changed")
    for row in rows:
        exact_keys(row, row_keys, "descriptor row")
        if row["sourceLane"] not in LANE_FIELDS or row["claimLocks"] != claim_locks:
            fail("descriptor row claim boundary changed")
        if any(item is not False for item in row["claimLocks"].values()):
            fail("descriptor row claim was promoted")
        exact_keys(row["descriptors"], set(DESCRIPTOR_FIELDS), "descriptor fields")
        for field_name, field in row["descriptors"].items():
            validate_descriptor(field, field_name, row["sourceLane"])
        if row["missingFields"] != sorted(field for field, item in row["descriptors"].items() if item["status"] == "MISSING"):
            fail("descriptor missingness ledger changed")
        if row["ambiguousFields"] != sorted(field for field, item in row["descriptors"].items() if item["status"] == "AMBIGUOUS"):
            fail("descriptor ambiguity ledger changed")
        expected_id = sha(canonical({key: item for key, item in row.items() if key != "descriptorRowId"}))
        if row["descriptorRowId"] != expected_id:
            fail("descriptor row self hash changed")


def validate_report(
    value: dict[str, Any], contract: dict[str, Any], gap: dict[str, Any],
    lane_rows: dict[str, list[dict[str, Any]]],
) -> None:
    exact_keys(value, {
        "claimLocks", "contractRawSha256", "fieldStatusCounts", "implementationBindings",
        "inputBindings", "population", "remoteBinding", "reportSha256", "rows", "schema",
        "taskId", "track",
    }, "descriptor report")
    body = dict(value)
    report_sha = body.pop("reportSha256", None)
    if report_sha != sha(canonical(body)):
        fail("descriptor report self hash changed")
    if value["schema"] != "early-detection-sec-primary-security-descriptor/v1":
        fail("descriptor report schema changed")
    if value["contractRawSha256"] != CONTRACT_RAW_SHA256 or value["inputBindings"] != contract["inputBindings"]:
        fail("descriptor report input binding changed")
    if value["remoteBinding"] != contract["remoteBinding"] or value["claimLocks"] != contract["claimLocks"]:
        fail("descriptor report boundary changed")
    implementation = value["implementationBindings"]
    exact_keys(implementation, {"builderRawSha256", "contractRawSha256", "sourceCommit", "testRawSha256"}, "implementation binding")
    if COMMIT40.fullmatch(implementation["sourceCommit"]) is None:
        fail("implementation source commit changed")
    head = git_text("rev-parse", "HEAD")
    for ancestor, descendant, label in (
        (PARENT_REMOTE_COMMIT, implementation["sourceCommit"], "parent-to-source"),
        (implementation["sourceCommit"], head, "source-to-HEAD"),
    ):
        if subprocess.run(
            ["git", "merge-base", "--is-ancestor", ancestor, descendant],
            cwd=ROOT, check=False, capture_output=True,
        ).returncode != 0:
            fail(f"implementation lineage changed: {label}")
    for key in ("builderRawSha256", "contractRawSha256", "testRawSha256"):
        if HEX64.fullmatch(implementation[key]) is None:
            fail("implementation raw hash changed")
    for relative, key in (
        (contract["authorizedImplementation"]["builderPath"], "builderRawSha256"),
        ("research/early-detection-v4/sec-primary-security-descriptor-contract-v1.json", "contractRawSha256"),
        (contract["authorizedImplementation"]["testPath"], "testRawSha256"),
    ):
        try:
            raw = git_bytes("show", f"{implementation['sourceCommit']}:{relative}")
        except subprocess.CalledProcessError as exc:
            raise DescriptorError("implementation source commit lacks a bound file") from exc
        if sha(raw) != implementation[key]:
            fail("implementation Git/raw binding changed")
    expected = build_rows(gap["rows"], lane_rows, contract["claimLocks"])
    validate_rows(value["rows"], expected, contract["claimLocks"])
    if value["population"] != population(expected) or value["fieldStatusCounts"] != field_status_counts(expected):
        fail("descriptor report count ledger changed")


def write_new(path: Path, raw: bytes) -> None:
    if path.exists():
        fail("output already exists")
    path.parent.mkdir(parents=True, exist_ok=True)
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


def rejected(action: Callable[[], None]) -> bool:
    try:
        action()
    except (DescriptorError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError):
        return True
    return False


def self_test(
    contract: dict[str, Any], gap: dict[str, Any], lane_rows: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    expected = build_rows(gap["rows"], lane_rows, contract["claimLocks"])
    validate_rows(expected, expected, contract["claimLocks"])
    kills: dict[str, bool] = {}

    cross_gap = copy.deepcopy(gap["rows"][0])
    cross_gap["accession"] = "9999999999-99-999999"
    kills["crossAccession"] = rejected(
        lambda: build_rows([cross_gap], lane_rows, contract["claimLocks"], enforce_population=False)
    )

    mutations: dict[str, Callable[[list[dict[str, Any]]], None]] = {
        "sourceRefHash": lambda rows: next(
            field for row in rows for field in row["descriptors"].values() if field["evidence"]
        )["evidence"][0]["sourceRef"].__setitem__("evidenceSha256", "0" * 64),
        "descriptorPromotion": lambda rows: next(
            field for row in rows for field in row["descriptors"].values() if field["status"] == "MISSING"
        ).update({"status": "OBSERVED_SOURCE_DESCRIPTOR", "value": "FORGED", "dispositionReason": "SOURCE_EVIDENCE_AGREES"}),
        "rowLoss": lambda rows: rows.pop(),
        "rowReorder": lambda rows: rows.__setitem__(slice(0, 2), list(reversed(rows[:2]))),
        "outcomes": lambda rows: rows[0]["claimLocks"].__setitem__("outcomesAccessed", True),
    }
    for name, mutate in mutations.items():
        item = copy.deepcopy(expected)
        mutate(item)
        for row in item:
            row["descriptorRowId"] = sha(canonical({key: value for key, value in row.items() if key != "descriptorRowId"}))
        kills[name] = rejected(lambda item=item: validate_rows(item, expected, contract["claimLocks"]))
    if not all(kills.values()):
        fail("one or more adversarial mutations survived")
    return {
        "schema": "early-detection-sec-primary-security-descriptor-self-test/v1",
        "status": "PASS", "kills": kills, "rows": len(expected), "outcomesAccessed": False,
    }


def rebuild_digest(
    contract: dict[str, Any], gap: dict[str, Any], lane_rows: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    first = build_rows(gap["rows"], lane_rows, contract["claimLocks"])
    second = build_rows(gap["rows"], lane_rows, contract["claimLocks"])
    first_raw = canonical(first)
    second_raw = canonical(second)
    if first_raw != second_raw:
        fail("two independent row rebuilds differ")
    return {
        "schema": "early-detection-sec-primary-security-descriptor-rebuild-digest/v1",
        "status": "PASS", "rows": len(first), "uniqueAccessions": len({row["accession"] for row in first}),
        "sourceLaneCounts": dict(sorted(Counter(row["sourceLane"] for row in first).items())),
        "uniqueSourceMetadataRows": population(first)["uniqueSourceMetadataRows"],
        "fieldStatusCounts": field_status_counts(first), "rowsCanonicalSha256": sha(first_raw),
        "twoRebuildsIdentical": True, "outcomesAccessed": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify-contract", "self-test", "rebuild-digest", "build", "verify-output"))
    args = parser.parse_args()
    try:
        contract, _ = validate_contract()
        verify_repository_binding(contract)
        if args.command == "verify-contract":
            result = {
                "schema": "early-detection-sec-primary-security-descriptor-contract-verification/v1",
                "status": "PASS", "contractRawSha256": CONTRACT_RAW_SHA256, "outcomesAccessed": False,
            }
        else:
            gap, lanes = load_inputs(contract)
            if args.command == "self-test":
                result = self_test(contract, gap, lanes)
            elif args.command == "rebuild-digest":
                result = rebuild_digest(contract, gap, lanes)
            elif args.command == "build":
                implementation = bind_implementation()
                report = build_report(contract, gap, lanes, implementation)
                validate_report(report, contract, gap, lanes)
                raw = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
                write_new(OUTPUT, raw)
                result = {
                    "schema": "early-detection-sec-primary-security-descriptor-build/v1",
                    "status": "PASS", "path": OUTPUT.relative_to(ROOT).as_posix(),
                    "rawSha256": sha(raw), "reportSha256": report["reportSha256"],
                    "rows": len(report["rows"]), "outcomesAccessed": False,
                }
            else:
                raw = OUTPUT.read_bytes()
                report = json.loads(raw)
                validate_report(report, contract, gap, lanes)
                result = {
                    "schema": "early-detection-sec-primary-security-descriptor-verification/v1",
                    "status": "PASS", "rawSha256": sha(raw), "reportSha256": report["reportSha256"],
                    "rows": len(report["rows"]), "sourceRebuildVerified": True, "outcomesAccessed": False,
                }
    except (
        DescriptorError, OSError, KeyError, TypeError, ValueError, json.JSONDecodeError,
        gzip.BadGzipFile, subprocess.CalledProcessError,
    ) as exc:
        parser.error(str(exc))
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
