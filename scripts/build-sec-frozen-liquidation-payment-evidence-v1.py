#!/usr/bin/env python3
"""Verify and dry-build exactly seventeen frozen SEC liquidation-payment sentences."""

from __future__ import annotations

import argparse
import copy
import hashlib
import html
import json
import re
import subprocess
from collections import Counter
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-frozen-liquidation-payment-evidence-contract-v1.json"
BUILDER = Path(__file__).resolve()
TEST = ROOT / "tests" / "build-sec-frozen-liquidation-payment-evidence-v1.test.js"
OUTPUT = ROOT / "reports" / "early-detection" / "sec-frozen-liquidation-payment-evidence-v1.json"
FROZEN_FIVE = ROOT / "reports" / "early-detection" / "sec-frozen-terminal-distribution-receipt-evidence-v2.json"
NONCASH_SIX = ROOT / "reports" / "early-detection" / "sec-frozen-noncash-share-receipt-evidence-v1.json"
CORPUS = Path(r"C:\Users\Anwender\Documents\GrowthScreenerResearchData\early-detection-v4\corporate-action-originals\blobs\sha256")

CONTRACT_RAW = "a282583efe18ae14dfcc2b17db0822c92be75fade962aa53b53d28b05e99ff10"
CONTRACT_SELF = "d1074b371b90c4e5e43ad509858b1b597ee33601190ac971b68c43cb61d6746a"
BASE_COMMIT = "eca62f4260e940eff70ab8f17ada26c1fd57ab48"
REMOTE_URL = "https://github.com/Karlryl/screener-data.git"
REMOTE_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
EXPECTED_KIND = "ACTUAL_LIQUIDATION_PAYMENT_WAS_DISTRIBUTED_WITH_LITERAL_DOLLAR_SIGN_PER_SHARE"
EXPECTED_SCOPE = "EXACT_SEVENTEEN_FROZEN_PRIMARY_SEC_EXHIBIT_SENTENCES_ONLY_NO_GENERAL_SELECTOR"
EXPECTED_CEILING = "SEVENTEEN_PRIMARY_SEC_EXHIBIT_SENTENCES_STATE_EFFECTIVE_LIQUIDATION_TERMINATION_AND_LITERAL_DOLLAR_SIGN_PER_SHARE_LIQUIDATION_PAYMENT_WAS_DISTRIBUTED"
EXPECTED_PURPOSE = "Freeze exactly seventeen outcome-blind primary SEC exhibit sentences that state an effective liquidation or termination and a literal dollar-sign per-share liquidation payment was distributed, while refusing currency resolution, finality, no-further-payment, recovery, terminal-wealth, identity, listing, fee, tax, fractional, universal-holder and Original-V4 claims."
EXPECTED_CREATED_AT = "2026-08-13T04:17:01Z"
EXPECTED_DEDUP_DIMENSIONS = [
    "ACCESSION", "BLOB_SHA256", "EVIDENCE_SENTENCE_SHA256",
    "ACCESSION_BLOB_DOCUMENT_SENTENCE_PROVENANCE",
]
EXPECTED_ACCESSIONS = [f"0001143362-14-{number:06d}" for number in (101, 103, 105, 107, 112, 114, 116, 118, 120, 122, 124, 126, 128, 134, 136, 138, 140)]
EXPECTED_CASE_IDS = [f"LIQUIDATION-PAYMENT-{number:03d}" for number in range(1, 18)]
OWN_PATHS = (CONTRACT, BUILDER, TEST)
EXPECTED_CLAIM_LOCKS = {
    "cashReceiptVerified", "completeCorporateActionChainVerified", "currencyResolved",
    "feesOrTaxesVerified", "finalDistributionVerified", "firstDistributionVerified",
    "fractionalTreatmentVerified", "grossOrNetAmountVerified", "historicalIdentityResolved",
    "laterDistributionsVerified", "laterRecoveriesVerified", "listingContinuityVerified",
    "noFurtherClaimsVerified", "originalV4GateCredit", "outcomesAccessed", "pricesAccessed",
    "recoveryVerified", "returnsAccessed", "terminalWealthComplete",
    "universalHolderCoverageVerified",
}

DOCUMENT_RE = re.compile(rb"(?is)<DOCUMENT>(.*?)</DOCUMENT>")
TEXT_RE = re.compile(rb"(?is)<TEXT>\s*(.*?)\s*</TEXT>")
ACCESSION_RE = re.compile(rb"(?m)^ACCESSION NUMBER:\s*([0-9-]+)\s*$")
FIELD_RE = {
    name: re.compile(rb"(?m)^<" + name + rb">([^\r\n]+)\r?$")
    for name in (b"TYPE", b"SEQUENCE", b"FILENAME")
}
AMOUNT_RE = re.compile(r"a liquidation payment of (\$([0-9]+(?:\.[0-9]+)?)) per share was distributed(?: to holders)?\.")
DATE_RE = re.compile(r"became effective on ([A-Z][a-z]+ [0-9]{1,2}, [0-9]{4}),")
FORBIDDEN_CEILING_RE = re.compile(
    r"\b(?:final|further|recovery|recoveries|terminal wealth|right to receive|entitled|"
    r"future|conditional|contingent|estimated|estimate|gross|net|fees?|tax(?:es)?|fractional)\b",
    re.I,
)


class EvidenceError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise EvidenceError(message)


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if type(value) is not dict or set(value) != expected:
        fail(f"{label} exact keys changed")


def require_sha(value: Any, label: str) -> str:
    if type(value) is not str or re.fullmatch(r"[0-9a-f]{64}", value) is None:
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
    relative = path.relative_to(ROOT).as_posix()
    return git_run("cat-file", "-e", f"{commit}:{relative}").returncode == 0


def is_ancestor(ancestor: str, descendant: str) -> bool:
    return git_run("merge-base", "--is-ancestor", ancestor, descendant).returncode == 0


def on_first_parent_chain(ancestor: str, descendant: str) -> bool:
    if re.fullmatch(r"[0-9a-f]{40}", ancestor) is None or re.fullmatch(r"[0-9a-f]{40}", descendant) is None:
        return False
    return ancestor in git("rev-list", "--first-parent", descendant).splitlines()


def normalized_builder(raw: bytes) -> bytes:
    normalized = raw.replace(b"\r\n", b"\n")
    for name in (b"CONTRACT_RAW", b"CONTRACT_SELF"):
        pattern = rb"(?m)^" + name + rb' = "[0-9a-f]{64}"$'
        replacement = name + b' = "' + (b"0" * 64) + b'"'
        normalized, count = re.subn(pattern, replacement, normalized)
        if count != 1:
            fail("builder hash-normalization structure changed")
    return normalized


class TextSink(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.hidden = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() in {"script", "style"}:
            self.hidden += 1

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in {"script", "style"} and self.hidden:
            self.hidden -= 1

    def handle_data(self, data: str) -> None:
        if not self.hidden:
            self.parts.append(data)


def normalize_text(raw: bytes) -> tuple[str, str]:
    decoded = raw.decode("latin-1")
    sink = TextSink()
    try:
        sink.feed(decoded)
        sink.close()
    except (AssertionError, ValueError):
        stripped = re.sub(r"(?is)<(?:script|style)\b.*?</(?:script|style)\s*>", " ", decoded)
        stripped = re.sub(r"(?s)<!--.*?-->", " ", stripped)
        stripped = re.sub(r"(?s)<[^>]+>", " ", stripped)
        return " ".join(html.unescape(stripped).split()), "CONSERVATIVE_TAG_STRIP_FALLBACK"
    return " ".join(html.unescape(" ".join(sink.parts)).split()), "HTML_PARSER"


def sentences(text: str) -> list[str]:
    return [item.strip() for item in re.split(r"(?<=[.!?])\s+", text) if item.strip()]


def sec_documents(raw: bytes) -> list[dict[str, Any]]:
    blocks = DOCUMENT_RE.findall(raw)
    if not blocks:
        fail("SEC blob has no SGML document")
    output: list[dict[str, Any]] = []
    for index, block in enumerate(blocks, 1):
        text_matches = TEXT_RE.findall(block)
        if len(text_matches) != 1:
            fail("SEC document text cardinality changed")
        fields: dict[str, str] = {}
        for name, pattern in FIELD_RE.items():
            matches = pattern.findall(block)
            if len(matches) != 1:
                fail("SEC document field cardinality changed")
            fields[name.decode("ascii")] = matches[0].decode("latin-1").strip()
        output.append({"index": index, "raw": block, "textRaw": text_matches[0], **fields})
    return output


def validate_contract_semantics(value: dict[str, Any]) -> None:
    if value.get("createdAt") != EXPECTED_CREATED_AT:
        fail("contract creation time changed")
    if value.get("purpose") != EXPECTED_PURPOSE:
        fail("contract purpose changed")
    exact_keys(value.get("inputs"), {"corpus"}, "inputs")
    corpus = value["inputs"]["corpus"]
    if corpus != {
        "expectedFrozenBlobBytes": 64395,
        "expectedFrozenBlobs": 17,
        "logicalRoot": "early-detection-v4/corporate-action-originals/blobs/sha256",
        "physicalRoot": str(CORPUS),
    }:
        fail("corpus binding changed")
    dedup_contract = value.get("deduplicationContract")
    exact_keys(dedup_contract, {
        "dimensions", "expectedIntersectionCountByDimension", "frozenFiveInput", "noncashSixInput",
    }, "deduplication contract")
    if dedup_contract["dimensions"] != EXPECTED_DEDUP_DIMENSIONS:
        fail("dedup dimensions changed")
    expected_intersections = {dimension: 0 for dimension in EXPECTED_DEDUP_DIMENSIONS}
    if dedup_contract["expectedIntersectionCountByDimension"] != expected_intersections:
        fail("dedup expected intersections changed")
    for name in ("frozenFiveInput", "noncashSixInput"):
        exact_keys(dedup_contract[name], {
            "bytes", "gitBlob", "introductionCommit", "path", "rawSha256", "reportSha256", "rows",
        }, f"dedup {name}")


def load_contract() -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    if sha(raw) != CONTRACT_RAW:
        fail("contract raw bytes changed")
    value = json.loads(raw)
    body = dict(value)
    claimed = body.pop("contractSha256", None)
    if claimed != CONTRACT_SELF or sha(canonical(body)) != CONTRACT_SELF:
        fail("contract self hash changed")
    exact_keys(value, {
        "baseSeal", "claimLocks", "contractSha256", "createdAt", "deduplicationContract",
        "evidencePolicy", "frozenCases", "implementationContract", "inputs", "purpose",
        "schema", "taskId", "track",
    }, "contract")
    if value["schema"] != "early-detection-sec-frozen-liquidation-payment-evidence-contract/v1":
        fail("contract schema changed")
    if value["taskId"] != "Q003-SEC-FROZEN-LIQUIDATION-PAYMENT-EVIDENCE-V1" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("study boundary changed")
    validate_contract_semantics(value)
    if value["baseSeal"] != {
        "baseCommit": BASE_COMMIT,
        "baseTag": 867,
        "implementationIntroductionMayFollowLinearIntermediateCommits": True,
        "implementationIntroductionMustAddExactlyOwnThreePaths": True,
        "implementationIntroductionMustBeFirstParentDescendantOfBase": True,
        "remoteRef": REMOTE_REF,
        "remoteUrl": REMOTE_URL,
    }:
        fail("base seal changed")
    policy = value["evidencePolicy"]
    if policy != {
        "allRowsMustContainExactPastPhrase": "was distributed",
        "allRowsMustContainLiteralDollarSignPerShareAmount": True,
        "currencyCodeMustRemainNull": True,
        "expectedEvidenceKind": EXPECTED_KIND,
        "expectedRecipientExplicitRows": 4,
        "expectedRows": 17,
        "futureRowsRequireNewProtocol": True,
        "scopeLimit": EXPECTED_SCOPE,
        "semanticCeiling": EXPECTED_CEILING,
    }:
        fail("evidence policy changed")
    if type(value["claimLocks"]) is not dict or set(value["claimLocks"]) != EXPECTED_CLAIM_LOCKS or any(item is not False for item in value["claimLocks"].values()):
        fail("claim lock changed")
    implementation = value["implementationContract"]
    if set(implementation) != {"builderPath", "futureOutputPath", "implementationPaths", "ownedByteBindings", "preImplementationCommands", "testPath"}:
        fail("implementation contract shape changed")
    if implementation["builderPath"] != BUILDER.relative_to(ROOT).as_posix() or implementation["testPath"] != TEST.relative_to(ROOT).as_posix():
        fail("implementation path changed")
    if implementation["futureOutputPath"] != OUTPUT.relative_to(ROOT).as_posix():
        fail("output path changed")
    if implementation["implementationPaths"] != [path.relative_to(ROOT).as_posix() for path in OWN_PATHS]:
        fail("owned path set changed")
    if implementation["preImplementationCommands"] != ["verify-contract", "self-test", "dry-run"]:
        fail("pre-implementation commands changed")
    owned = implementation["ownedByteBindings"]
    exact_keys(owned, {"builderNormalizedSha256", "testRawSha256"}, "owned byte bindings")
    if sha(normalized_builder(BUILDER.read_bytes())) != require_sha(owned["builderNormalizedSha256"], "builder normalized hash"):
        fail("builder normalized bytes changed")
    if sha(TEST.read_bytes()) != require_sha(owned["testRawSha256"], "test raw hash"):
        fail("test raw bytes changed")
    cases = value["frozenCases"]
    if type(cases) is not list or len(cases) != 17:
        fail("frozen case count changed")
    if [row.get("caseId") for row in cases] != EXPECTED_CASE_IDS or [row.get("accession") for row in cases] != EXPECTED_ACCESSIONS:
        fail("frozen case sequence changed")
    expected_case_keys = {
        "accession", "amountLiteral", "amountPerShare", "blobBytes", "blobSha256", "caseId",
        "currencyCode", "documentFilename", "documentIndex", "documentSequence", "documentType",
        "effectiveDate", "evidenceKind", "evidenceSentenceIndex", "evidenceSentenceSha256",
        "evidenceText", "normalizationMode", "rawDocumentSha256", "rawTextSha256",
        "recipientExplicit", "relativePath",
    }
    for case in cases:
        exact_keys(case, expected_case_keys, "frozen case")
        if type(case["blobBytes"]) is not int or type(case["documentIndex"]) is not int or type(case["evidenceSentenceIndex"]) is not int:
            fail("frozen numeric type changed")
        if type(case["recipientExplicit"]) is not bool or case["currencyCode"] is not None:
            fail("recipient or currency nullability changed")
        for field in ("blobSha256", "evidenceSentenceSha256", "rawDocumentSha256", "rawTextSha256"):
            require_sha(case[field], f"case {field}")
        if case["evidenceKind"] != EXPECTED_KIND or case["normalizationMode"] != "HTML_PARSER":
            fail("frozen semantics changed")
        if type(case["amountPerShare"]) is not str or re.fullmatch(r"[0-9]+\.[0-9]+", case["amountPerShare"]) is None:
            fail("amount string changed")
    if sum(case["blobBytes"] for case in cases) != 64395:
        fail("frozen byte count changed")
    if Counter(case["recipientExplicit"] for case in cases) != Counter({False: 13, True: 4}):
        fail("recipient-explicit count changed")
    return value


def validate_committed_input(head: str, path: Path, binding: dict[str, Any]) -> dict[str, Any]:
    exact_keys(binding, {"bytes", "gitBlob", "introductionCommit", "path", "rawSha256", "reportSha256", "rows"}, "dedup input")
    if binding["path"] != path.relative_to(ROOT).as_posix() or type(binding["bytes"]) is not int or type(binding["rows"]) is not int:
        fail("dedup input metadata changed")
    raw = path.read_bytes()
    if len(raw) != binding["bytes"] or sha(raw) != binding["rawSha256"] or git_raw(head, path) != raw:
        fail(f"dedup input local/Git bytes changed: {path.name}")
    if git("rev-parse", f"{head}:{binding['path']}") != binding["gitBlob"]:
        fail(f"dedup input Git blob changed: {path.name}")
    introduction = binding["introductionCommit"]
    if git("log", "--diff-filter=A", "-1", "--format=%H", "--", binding["path"]) != introduction or not is_ancestor(introduction, BASE_COMMIT):
        fail(f"dedup input introduction changed: {path.name}")
    value = json.loads(raw)
    body = dict(value)
    claimed = body.pop("reportSha256", None)
    if claimed != binding["reportSha256"] or sha(canonical(body)) != claimed:
        fail(f"dedup input self hash changed: {path.name}")
    if len(value.get("rows", [])) != binding["rows"] or value.get("outcomesAccessed") is not False:
        fail(f"dedup input population or outcome boundary changed: {path.name}")
    if any(item is not False for item in value.get("claimLocks", {}).values()):
        fail(f"dedup input claim lock changed: {path.name}")
    return value


def load_inputs(contract: dict[str, Any], head: str) -> tuple[dict[str, Any], dict[str, Any]]:
    bindings = contract["deduplicationContract"]
    return (
        validate_committed_input(head, FROZEN_FIVE, bindings["frozenFiveInput"]),
        validate_committed_input(head, NONCASH_SIX, bindings["noncashSixInput"]),
    )


def rebuild_case(case: dict[str, Any]) -> dict[str, Any]:
    relative = Path(case["relativePath"])
    if len(relative.parts) != 2 or relative.parts[0] != case["blobSha256"][:2] or relative.stem != case["blobSha256"]:
        fail("content-addressed path changed")
    blob_path = CORPUS / relative
    raw = blob_path.read_bytes()
    if len(raw) != case["blobBytes"] or sha(raw) != case["blobSha256"]:
        fail("SEC CAS blob bytes changed")
    accessions = ACCESSION_RE.findall(raw)
    if len(accessions) != 1 or accessions[0].decode("ascii") != case["accession"]:
        fail("SEC accession header changed")
    documents = sec_documents(raw)
    index = case["documentIndex"]
    if index < 1 or index > len(documents):
        fail("SEC document index changed")
    document = documents[index - 1]
    if (
        document["TYPE"] != case["documentType"]
        or document["SEQUENCE"] != case["documentSequence"]
        or document["FILENAME"] != case["documentFilename"]
        or sha(document["raw"]) != case["rawDocumentSha256"]
        or sha(document["textRaw"]) != case["rawTextSha256"]
    ):
        fail("SEC document provenance changed")
    text, mode = normalize_text(document["textRaw"])
    if mode != case["normalizationMode"]:
        fail("SEC normalization mode changed")
    sentence_rows = sentences(text)
    sentence_index = case["evidenceSentenceIndex"]
    if sentence_index < 1 or sentence_index > len(sentence_rows):
        fail("SEC sentence index changed")
    evidence = sentence_rows[sentence_index - 1]
    if evidence != case["evidenceText"] or sha(evidence.encode("utf-8")) != case["evidenceSentenceSha256"]:
        fail("frozen evidence sentence changed")
    if evidence.count("was distributed") != 1 or FORBIDDEN_CEILING_RE.search(evidence):
        fail("past-payment or ceiling semantics changed")
    amount_match = AMOUNT_RE.search(evidence)
    if amount_match is None or amount_match.group(1) != case["amountLiteral"] or amount_match.group(2) != case["amountPerShare"]:
        fail("literal per-share amount changed")
    date_match = DATE_RE.search(evidence)
    if date_match is None or datetime.strptime(date_match.group(1), "%B %d, %Y").date().isoformat() != case["effectiveDate"]:
        fail("effective date changed")
    recipient_explicit = evidence.endswith("was distributed to holders.")
    if recipient_explicit is not case["recipientExplicit"]:
        fail("recipient-explicit semantics changed")
    return {
        "accession": case["accession"],
        "amountLiteral": case["amountLiteral"],
        "amountPerShare": case["amountPerShare"],
        "caseId": case["caseId"],
        "currencyCode": None,
        "effectiveDate": case["effectiveDate"],
        "evidenceKind": EXPECTED_KIND,
        "evidenceText": evidence,
        "evidenceTextSha256": case["evidenceSentenceSha256"],
        "recipientExplicit": recipient_explicit,
        "semanticValues": {
            "actualPastDistributionStated": True,
            "currencyResolved": False,
            "literalDollarSignPerShareAmountStated": True,
            "recipientExplicit": recipient_explicit,
        },
        "sourceRef": {
            "blobSha256": case["blobSha256"],
            "bytes": case["blobBytes"],
            "documentFilename": case["documentFilename"],
            "documentIndex": index,
            "documentSequence": case["documentSequence"],
            "documentType": case["documentType"],
            "evidenceSentenceIndex": sentence_index,
            "evidenceSentenceSha256": case["evidenceSentenceSha256"],
            "normalizationMode": mode,
            "rawDocumentSha256": case["rawDocumentSha256"],
            "rawTextSha256": case["rawTextSha256"],
            "relativePath": case["relativePath"],
        },
    }


def evidence_hash(row: dict[str, Any]) -> str:
    return row.get("evidenceTextSha256", row.get("sourceRef", {}).get("evidenceSentenceSha256"))


def provenance(row: dict[str, Any]) -> tuple[Any, ...]:
    ref = row["sourceRef"]
    return (row["accession"], ref["blobSha256"], ref["documentIndex"], ref["evidenceSentenceIndex"], evidence_hash(row))


def deduplication(
    rows: list[dict[str, Any]], frozen_five: dict[str, Any], noncash_six: dict[str, Any],
    expected_intersections: dict[str, int],
) -> dict[str, Any]:
    existing = frozen_five["rows"] + noncash_six["rows"]
    intersections = {
        "ACCESSION": len({row["accession"] for row in rows} & {row["accession"] for row in existing}),
        "BLOB_SHA256": len({row["sourceRef"]["blobSha256"] for row in rows} & {row["sourceRef"]["blobSha256"] for row in existing}),
        "EVIDENCE_SENTENCE_SHA256": len({evidence_hash(row) for row in rows} & {evidence_hash(row) for row in existing}),
        "ACCESSION_BLOB_DOCUMENT_SENTENCE_PROVENANCE": len({provenance(row) for row in rows} & {provenance(row) for row in existing}),
    }
    if intersections != expected_intersections:
        fail("Frozen5+Noncash6 deduplication differs from contract")
    return {
        "dimensions": copy.deepcopy(EXPECTED_DEDUP_DIMENSIONS),
        "existingDistinctAccessions": len({row["accession"] for row in existing}),
        "existingDistinctBlobs": len({row["sourceRef"]["blobSha256"] for row in existing}),
        "existingDistinctEvidenceSentenceSha256": len({evidence_hash(row) for row in existing}),
        "existingRows": len(existing),
        "frozenFiveRawSha256": sha(FROZEN_FIVE.read_bytes()),
        "intersectionCountByDimension": intersections,
        "noncashSixRawSha256": sha(NONCASH_SIX.read_bytes()),
    }


def topology(remote_required: bool) -> dict[str, Any]:
    head = git("rev-parse", "HEAD")
    if git("remote", "get-url", "origin") != REMOTE_URL:
        fail("origin URL changed")
    if not is_ancestor(BASE_COMMIT, head) or not on_first_parent_chain(BASE_COMMIT, head):
        fail("HEAD is not a linear first-parent descendant of Tag867")
    if remote_required:
        rows = git("ls-remote", "--refs", "origin", REMOTE_REF).splitlines()
        if len(rows) != 1 or rows[0].split()[0] != head or git("rev-parse", "@{upstream}") != head:
            fail("local, upstream and live remote differ")
    committed = [git_path_exists(head, path) for path in OWN_PATHS]
    if len(set(committed)) != 1:
        fail("partial implementation introduction")
    if git_path_exists(head, OUTPUT) or OUTPUT.exists():
        fail("future output must remain absent")
    if not committed[0]:
        return {
            "baseSealCommit": BASE_COMMIT,
            "currentCommit": head,
            "implementationIntroductionCommit": None,
            "implementationIntroductionParent": None,
            "linearIntermediateCommitsAllowed": True,
            "phase": "PRE_IMPLEMENTATION",
        }
    introductions = {
        git("log", "--diff-filter=A", "-1", "--format=%H", "--", path.relative_to(ROOT).as_posix())
        for path in OWN_PATHS
    }
    if len(introductions) != 1:
        fail("implementation paths were not introduced together")
    introduction = introductions.pop()
    parent_row = git("rev-list", "--parents", "-n", "1", introduction).split()
    if len(parent_row) != 2:
        fail("implementation introduction is not single-parent")
    parent = parent_row[1]
    if not on_first_parent_chain(BASE_COMMIT, parent) or not on_first_parent_chain(introduction, head):
        fail("implementation introduction topology changed")
    changes = git("diff-tree", "--no-commit-id", "--name-status", "-r", introduction).splitlines()
    expected = {f"A\t{path.relative_to(ROOT).as_posix()}" for path in OWN_PATHS}
    if set(changes) != expected or len(changes) != 3:
        fail("implementation introduction did not add exactly its three paths")
    for path in OWN_PATHS:
        relative = path.relative_to(ROOT).as_posix()
        if git("log", "-1", "--format=%H", "--", relative) != introduction or git_raw(head, path) != path.read_bytes():
            fail("implementation Git/local bytes drifted")
    return {
        "baseSealCommit": BASE_COMMIT,
        "currentCommit": head,
        "implementationIntroductionCommit": introduction,
        "implementationIntroductionParent": parent,
        "linearIntermediateCommitsAllowed": True,
        "phase": "IMPLEMENTED_NO_OUTPUT",
    }


def implementation_bindings(state: dict[str, Any], contract: dict[str, Any]) -> dict[str, Any]:
    return {
        **copy.deepcopy(state),
        "builderNormalizedSha256": sha(normalized_builder(BUILDER.read_bytes())),
        "contractRawSha256": CONTRACT_RAW,
        "contractSha256": CONTRACT_SELF,
        "remoteRef": REMOTE_REF,
        "remoteUrl": REMOTE_URL,
        "testRawSha256": sha(TEST.read_bytes()),
    }


def build_report(contract: dict[str, Any], frozen_five: dict[str, Any], noncash_six: dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    rows = [rebuild_case(case) for case in contract["frozenCases"]]
    if len(rows) != 17 or len({row["accession"] for row in rows}) != 17 or len({row["sourceRef"]["blobSha256"] for row in rows}) != 17:
        fail("rebuilt frozen population changed")
    if Counter(row["recipientExplicit"] for row in rows) != Counter({False: 13, True: 4}):
        fail("rebuilt recipient population changed")
    value = {
        "claimLocks": copy.deepcopy(contract["claimLocks"]),
        "contractRawSha256": CONTRACT_RAW,
        "contractSha256": CONTRACT_SELF,
        "deduplication": deduplication(
            rows, frozen_five, noncash_six,
            contract["deduplicationContract"]["expectedIntersectionCountByDimension"],
        ),
        "implementationBindings": implementation_bindings(state, contract),
        "inputBindings": copy.deepcopy(contract["inputs"]),
        "outcomesAccessed": False,
        "population": {
            "actualPastLiquidationPaymentDistributedStatementRows": 17,
            "currencyResolvedRows": 0,
            "frozenEvidenceRows": 17,
            "literalDollarSignPerShareAmountRows": 17,
            "recipientExplicitRows": 4,
            "uniqueAccessions": 17,
            "uniqueBlobs": 17,
        },
        "rows": rows,
        "schema": "early-detection-sec-frozen-liquidation-payment-evidence/v1",
        "scopeLimit": EXPECTED_SCOPE,
        "semanticCeiling": EXPECTED_CEILING,
        "taskId": contract["taskId"],
        "track": contract["track"],
    }
    value["reportSha256"] = sha(canonical(value))
    return value


def validate_report(value: dict[str, Any], expected: dict[str, Any]) -> None:
    if value != expected:
        fail("report differs from exact source rebuild")
    body = dict(value)
    claimed = body.pop("reportSha256", None)
    if claimed != sha(canonical(body)):
        fail("report self hash changed")
    if any(item is not False for item in value["claimLocks"].values()) or value["outcomesAccessed"] is not False:
        fail("report claim boundary changed")


def rejected(action: Callable[[], None]) -> bool:
    try:
        action()
    except (EvidenceError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError):
        return True
    return False


def self_test(contract: dict[str, Any], frozen_five: dict[str, Any], noncash_six: dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    expected = build_report(contract, frozen_five, noncash_six, state)
    validate_report(expected, build_report(contract, frozen_five, noncash_six, state))
    mutations: dict[str, Callable[[dict[str, Any]], None]] = {
        "rowRemoved": lambda item: item["rows"].pop(),
        "rowAdded": lambda item: item["rows"].append(copy.deepcopy(item["rows"][0])),
        "accessionChanged": lambda item: item["rows"][0].__setitem__("accession", "0000000000-00-000000"),
        "sourceBlobChanged": lambda item: item["rows"][0]["sourceRef"].__setitem__("blobSha256", "0" * 64),
        "sourceDocumentChanged": lambda item: item["rows"][0]["sourceRef"].__setitem__("documentIndex", 1),
        "sourceSentenceChanged": lambda item: item["rows"][0]["sourceRef"].__setitem__("evidenceSentenceSha256", "0" * 64),
        "evidenceTextChanged": lambda item: item["rows"][0].__setitem__("evidenceText", "payment was distributed"),
        "pastDistributionChanged": lambda item: item["rows"][0]["semanticValues"].__setitem__("actualPastDistributionStated", False),
        "amountLiteralChanged": lambda item: item["rows"][0].__setitem__("amountLiteral", "$0.00"),
        "effectiveDateChanged": lambda item: item["rows"][0].__setitem__("effectiveDate", "2014-08-29"),
        "currencyRaised": lambda item: item["rows"][0].__setitem__("currencyCode", "USD"),
        "recipientRaised": lambda item: item["rows"][4].__setitem__("recipientExplicit", True),
        "recipientCountRaised": lambda item: item["population"].__setitem__("recipientExplicitRows", 17),
        "dedupAccessionOverlap": lambda item: item["deduplication"]["intersectionCountByDimension"].__setitem__("ACCESSION", 1),
        "dedupBlobOverlap": lambda item: item["deduplication"]["intersectionCountByDimension"].__setitem__("BLOB_SHA256", 1),
        "dedupSentenceOverlap": lambda item: item["deduplication"]["intersectionCountByDimension"].__setitem__("EVIDENCE_SENTENCE_SHA256", 1),
        "dedupProvenanceOverlap": lambda item: item["deduplication"]["intersectionCountByDimension"].__setitem__("ACCESSION_BLOB_DOCUMENT_SENTENCE_PROVENANCE", 1),
        "claimFinalRaised": lambda item: item["claimLocks"].__setitem__("finalDistributionVerified", True),
        "claimFirstRaised": lambda item: item["claimLocks"].__setitem__("firstDistributionVerified", True),
        "claimCashReceiptRaised": lambda item: item["claimLocks"].__setitem__("cashReceiptVerified", True),
        "claimNoFurtherRaised": lambda item: item["claimLocks"].__setitem__("noFurtherClaimsVerified", True),
        "claimRecoveryRaised": lambda item: item["claimLocks"].__setitem__("recoveryVerified", True),
        "claimTerminalRaised": lambda item: item["claimLocks"].__setitem__("terminalWealthComplete", True),
        "claimIdentityRaised": lambda item: item["claimLocks"].__setitem__("historicalIdentityResolved", True),
        "claimV4Raised": lambda item: item["claimLocks"].__setitem__("originalV4GateCredit", True),
        "outcomesRaised": lambda item: item.__setitem__("outcomesAccessed", True),
        "scopeRaised": lambda item: item.__setitem__("scopeLimit", "ALL_LIQUIDATION_PAYMENTS"),
        "ceilingRaised": lambda item: item.__setitem__("semanticCeiling", "FINAL_TERMINAL_WEALTH"),
        "topologyBaseChanged": lambda item: item["implementationBindings"].__setitem__("baseSealCommit", "0" * 40),
        "implementationHashChanged": lambda item: item["implementationBindings"].__setitem__("builderNormalizedSha256", "0" * 64),
        "inputRootChanged": lambda item: item["inputBindings"]["corpus"].__setitem__("physicalRoot", "C:\\other"),
    }
    kills: dict[str, bool] = {}
    for label, mutate in mutations.items():
        changed = copy.deepcopy(expected)
        mutate(changed)
        changed["reportSha256"] = sha(canonical({key: row for key, row in changed.items() if key != "reportSha256"}))
        kills[label] = rejected(lambda changed=changed: validate_report(changed, expected))
    contract_mutations: dict[str, Callable[[dict[str, Any]], None]] = {
        "contractPurposeOverclaimRehashed": lambda item: item.__setitem__("purpose", "FINAL USD CASH RECEIPT AND TERMINAL WEALTH COMPLETE"),
        "contractDedupExpectedOverlapRehashed": lambda item: item["deduplicationContract"]["expectedIntersectionCountByDimension"].__setitem__("ACCESSION", 1),
        "contractDedupCreditFieldRehashed": lambda item: item["deduplicationContract"].__setitem__("originalV4GateCredit", True),
        "contractInputOutcomeFieldRehashed": lambda item: item["inputs"].__setitem__("outcomesAccessed", True),
        "contractFutureCreationTimeRehashed": lambda item: item.__setitem__("createdAt", "2099-01-01T00:00:00Z"),
    }
    for label, mutate in contract_mutations.items():
        changed_contract = copy.deepcopy(contract)
        mutate(changed_contract)
        contract_body = {key: row for key, row in changed_contract.items() if key != "contractSha256"}
        changed_contract["contractSha256"] = sha(canonical(contract_body))
        kills[label] = rejected(lambda changed_contract=changed_contract: validate_contract_semantics(changed_contract))
    if set(kills.values()) != {True}:
        fail("adversarial mutation survived")
    return {
        "mutationKills": kills,
        "outcomesAccessed": False,
        "recipientExplicitRows": 4,
        "schema": "early-detection-sec-frozen-liquidation-payment-evidence-self-test/v1",
        "status": "PASS",
        "verifiedRows": 17,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify-contract", "self-test", "dry-run"))
    parser.add_argument("--remote", action="store_true")
    args = parser.parse_args()
    try:
        contract = load_contract()
        state = topology(remote_required=args.remote)
        frozen_five, noncash_six = load_inputs(contract, state["currentCommit"])
        if args.command == "verify-contract":
            report = build_report(contract, frozen_five, noncash_six, state)
            result = {
                **state,
                "outcomesAccessed": False,
                "recipientExplicitRows": 4,
                "schema": "early-detection-sec-frozen-liquidation-payment-evidence-contract-verification/v1",
                "scopeLimit": EXPECTED_SCOPE,
                "status": "PASS",
                "verifiedRows": len(report["rows"]),
            }
        elif args.command == "self-test":
            result = self_test(contract, frozen_five, noncash_six, state)
        else:
            report = build_report(contract, frozen_five, noncash_six, state)
            validate_report(report, build_report(contract, frozen_five, noncash_six, state))
            result = {
                **state,
                "outcomesAccessed": False,
                "report": report,
                "schema": "early-detection-sec-frozen-liquidation-payment-evidence-dry-run/v1",
                "status": "PASS",
                "verifiedRows": 17,
            }
    except (EvidenceError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
