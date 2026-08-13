#!/usr/bin/env python3
"""Build exactly six frozen, outcome-blind SEC noncash share-receipt rows."""

from __future__ import annotations

import argparse
import copy
import hashlib
import html
import json
import os
import re
import subprocess
import tempfile
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-frozen-noncash-share-receipt-evidence-contract-v1.json"
BUILDER = Path(__file__).resolve()
TEST = ROOT / "tests" / "build-sec-frozen-noncash-share-receipt-evidence-v1.test.js"
OUTPUT = ROOT / "reports" / "early-detection" / "sec-frozen-noncash-share-receipt-evidence-v1.json"
RECONCILIATION = ROOT / "reports" / "early-detection" / "sec-terminal-candidate-reconciliation-v1.json"
FROZEN_FIVE = ROOT / "reports" / "early-detection" / "sec-frozen-terminal-distribution-receipt-evidence-v2.json"
CORPUS = Path(r"C:\Users\Anwender\Documents\GrowthScreenerResearchData\early-detection-v4\corporate-action-originals\blobs\sha256")

CONTRACT_RAW = "9451a82d6a7e51d7d531b6a035fdc9afb1d3794fd117e677c1021d6a68fa83b2"
CONTRACT_SELF = "5dc2eb5bb282203c03cafa5cef44e4329c5082d850b0faf57c1512aefff96131"
BASE_COMMIT = "996fd2eeb7f2193cfc6352ca15ab544d3f09ae4c"
REMOTE_URL = "https://github.com/Karlryl/screener-data.git"
REMOTE_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
EXPECTED_SCOPE = "EXACT_SIX_FROZEN_PRIMARY_SEC_SENTENCES_ONLY_NO_GENERAL_SELECTOR"
EXPECTED_CEILING = "EXACT_SIX_COMPLETED_NONCASH_SHARE_RECEIPTS_WITH_EXPLICIT_RATIOS"
EXPECTED_KIND = "ACTUAL_NONCASH_SHARE_RECEIPT_WITH_EXPLICIT_RATIO_STATED"
EXPECTED_CASE_IDS = [f"NONCASH-RECEIPT-{index:03d}" for index in range(1, 7)]
EXPECTED_ACCESSIONS = [
    "0000950103-18-000919",
    "0000950103-18-003297",
    "0000950103-20-021106",
    "0001193125-24-286219",
    "0001213900-23-091028",
    "0001213900-24-111979",
]
OWN_PATHS = (CONTRACT, BUILDER, TEST)
ACCESSION_RE = re.compile(rb"(?m)^ACCESSION NUMBER:[ \t]*([0-9]{10}-[0-9]{2}-[0-9]{6})[ \t]*\r?$")
DOCUMENT_RE = re.compile(br"<DOCUMENT>.*?</DOCUMENT>", re.I | re.S)
TEXT_RE = re.compile(br"<TEXT>(.*?)</TEXT>", re.I | re.S)
FIELD_RE = {
    name: re.compile(rb"(?m)^<" + name + rb">([^\r\n]+)\r?$")
    for name in (b"TYPE", b"SEQUENCE", b"FILENAME")
}
FORBIDDEN_TARGET_RE = re.compile(
    r"\b(?:cash|payment|proceeds|dividend|will|shall|may|might|could|would|"
    r"entitled|right\s+to\s+receive|subject\s+to|contingent|estimated|estimate|"
    r"if|unless|future|tender)\b|(?:C\$|US\$|U\.S\.\$|USD\s*|CAD\s*|EUR\s*|\$)\s*[0-9]",
    re.I,
)
PAST_RECEIPT_RE = re.compile(r"\b(?:received|distributed)\b", re.I)


class EvidenceError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise EvidenceError(message)


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        fail(f"{label} exact keys changed")


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
    if not re.fullmatch(r"[0-9a-f]{40}", ancestor) or not re.fullmatch(r"[0-9a-f]{40}", descendant):
        return False
    rows = git("rev-list", "--first-parent", descendant).splitlines()
    return ancestor in rows


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
        texts = TEXT_RE.findall(block)
        if len(texts) != 1:
            fail("SEC document text cardinality changed")
        fields: dict[str, str] = {}
        for name, pattern in FIELD_RE.items():
            matches = pattern.findall(block)
            if len(matches) != 1:
                fail("SEC document field cardinality changed")
            fields[name.decode("ascii")] = matches[0].decode("latin-1").strip()
        output.append({"index": index, "raw": block, "textRaw": texts[0].strip(b"\r\n"), **fields})
    return output


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
    if value["schema"] != "early-detection-sec-frozen-noncash-share-receipt-evidence-contract/v1":
        fail("contract schema changed")
    if value["taskId"] != "Q003-SEC-FROZEN-NONCASH-SHARE-RECEIPT-EVIDENCE-V1" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("study boundary changed")
    if value["baseSeal"] != {
        "baseCommit": BASE_COMMIT,
        "baseTag": 854,
        "implementationIntroductionMayFollowLinearIntermediateCommits": True,
        "implementationIntroductionMustBeFirstParentDescendantOfBase": True,
        "implementationIntroductionMustAddExactlyOwnThreePaths": True,
        "remoteRef": REMOTE_REF,
        "remoteUrl": REMOTE_URL,
    }:
        fail("base seal changed")
    policy = value["evidencePolicy"]
    if policy != {
        "allRatiosMustBeExplicitInSameFrozenSentence": True,
        "allRowsMustStatePastReceiptOrDistribution": True,
        "expectedDualRatioRows": 2,
        "expectedEvidenceKind": EXPECTED_KIND,
        "expectedRatioRows": 8,
        "expectedRows": 6,
        "futureRowsRequireNewProtocol": True,
        "scopeLimit": EXPECTED_SCOPE,
        "semanticCeiling": EXPECTED_CEILING,
        "targetSentencesMustContainNoCashOrFutureConditionalClaim": True,
    }:
        fail("evidence policy changed")
    if value["implementationContract"] != {
        "builderPath": BUILDER.relative_to(ROOT).as_posix(),
        "futureOutputPath": OUTPUT.relative_to(ROOT).as_posix(),
        "futureOutputWriteNewAtomic": True,
        "implementationPaths": [path.relative_to(ROOT).as_posix() for path in OWN_PATHS],
        "preImplementationCommands": ["verify-contract", "self-test", "dry-run"],
        "testPath": TEST.relative_to(ROOT).as_posix(),
    }:
        fail("implementation contract changed")
    if any(item is not False for item in value["claimLocks"].values()):
        fail("claim lock changed")
    cases = value["frozenCases"]
    if len(cases) != 6 or [row["caseId"] for row in cases] != EXPECTED_CASE_IDS:
        fail("frozen case sequence changed")
    if [row["accession"] for row in cases] != EXPECTED_ACCESSIONS:
        fail("frozen accession sequence changed")
    if Counter(len(row["ratios"]) for row in cases) != Counter({1: 4, 2: 2}):
        fail("ratio structure changed")
    if sum(len(row["ratios"]) for row in cases) != 8:
        fail("ratio count changed")
    for row in cases:
        if row["evidenceKind"] != EXPECTED_KIND or row["normalizationMode"] != "HTML_PARSER":
            fail("frozen evidence kind changed")
        if len({ratio["ratioId"] for ratio in row["ratios"]}) != len(row["ratios"]):
            fail("ratio ID cardinality changed")
        for ratio in row["ratios"]:
            exact_keys(ratio, {
                "evidenceFragment", "ratioId", "receivedSecurityText", "receivedUnits",
                "recipientScope", "surrenderedSecurityText", "surrenderedUnits",
            }, "ratio")
            if not re.fullmatch(r"[1-9][0-9]*", ratio["receivedUnits"]) or not re.fullmatch(r"[1-9][0-9]*", ratio["surrenderedUnits"]):
                fail("ratio unit changed")
    return value


def validate_committed_input(head: str, path: Path, expected: dict[str, Any]) -> None:
    raw = path.read_bytes()
    if sha(raw) != expected["rawSha256"] or git_raw(head, path) != raw:
        fail(f"input raw/Git binding changed: {path.name}")
    if git("rev-parse", f"{head}:{path.relative_to(ROOT).as_posix()}") != expected["gitBlob"]:
        fail(f"input Git blob changed: {path.name}")
    if git("log", "--diff-filter=A", "-1", "--format=%H", "--", path.relative_to(ROOT).as_posix()) != expected["introductionCommit"]:
        fail(f"input introduction changed: {path.name}")
    if not is_ancestor(expected["introductionCommit"], BASE_COMMIT):
        fail(f"input is not sealed by Tag854: {path.name}")


def load_inputs(contract: dict[str, Any], head: str) -> tuple[dict[str, Any], dict[str, Any]]:
    reconciliation_binding = contract["inputs"]["candidateReconciliation"]
    validate_committed_input(head, RECONCILIATION, reconciliation_binding)
    reconciliation = json.loads(RECONCILIATION.read_bytes())
    body = dict(reconciliation)
    claimed = body.pop("reportSha256", None)
    if claimed != reconciliation_binding["reportSha256"] or sha(canonical(body)) != claimed:
        fail("reconciliation self hash changed")
    if len(reconciliation.get("rows", [])) != 16507 or reconciliation.get("claimLocks", {}).get("outcomesAccessed") is not False:
        fail("reconciliation boundary changed")

    frozen_binding = contract["deduplicationContract"]["frozenFiveInput"]
    validate_committed_input(head, FROZEN_FIVE, frozen_binding)
    frozen = json.loads(FROZEN_FIVE.read_bytes())
    frozen_body = dict(frozen)
    frozen_claimed = frozen_body.pop("reportSha256", None)
    if frozen_claimed != frozen_binding["reportSha256"] or sha(canonical(frozen_body)) != frozen_claimed:
        fail("frozen-five self hash changed")
    if len(frozen.get("rows", [])) != 5 or frozen.get("outcomesAccessed") is not False:
        fail("frozen-five boundary changed")
    if any(item is not False for item in frozen.get("claimLocks", {}).values()):
        fail("frozen-five claim lock changed")
    return reconciliation, frozen


def validate_candidate_binding(case: dict[str, Any], reconciliation: dict[str, Any]) -> None:
    matches = [
        row for row in reconciliation["rows"]
        if row.get("sourceRowId") == case["sourceRowId"]
        and row.get("occurrenceId") == case["sourceOccurrenceId"]
        and row.get("accession") == case["accession"]
    ]
    if len(matches) != 1:
        fail("source candidate cardinality changed")
    row = matches[0]
    ref = row.get("sourceRef", {})
    if row.get("candidateKind") != case["sourceCandidateKind"]:
        fail("source candidate kind changed")
    if ref.get("evidenceSha256") != case["sourceCandidateEvidenceSha256"]:
        fail("source candidate evidence changed")
    if (
        ref.get("blobSha256") != case["blobSha256"]
        or ref.get("relativePath") != case["relativePath"]
        or ref.get("documentIndex") != case["documentIndex"]
        or ref.get("documentType") != case["documentType"]
        or ref.get("documentSequence") != case["documentSequence"]
        or ref.get("documentFilename") != case["documentFilename"]
    ):
        fail("source candidate provenance changed")
    if row.get("outcomesAccessed") is not False or any(
        row.get(key) is True
        for key in ("terminalWealthComplete", "paymentVerified", "resultComputationAllowed", "returnComputed")
    ):
        fail("source candidate claim boundary changed")


def rebuild_case(case: dict[str, Any], reconciliation: dict[str, Any]) -> dict[str, Any]:
    validate_candidate_binding(case, reconciliation)
    relative = Path(case["relativePath"])
    if relative.stem != case["blobSha256"] or relative.parts[0] != case["blobSha256"][:2]:
        fail("content-addressed path changed")
    blob_path = CORPUS / relative
    raw = blob_path.read_bytes()
    if len(raw) != case["blobBytes"] or sha(raw) != case["blobSha256"]:
        fail("SEC blob bytes changed")
    accessions = ACCESSION_RE.findall(raw)
    if len(accessions) != 1 or accessions[0].decode("ascii") != case["accession"]:
        fail("SEC accession header changed")
    documents = sec_documents(raw)
    index = case["documentIndex"]
    if not isinstance(index, int) or index < 1 or index > len(documents):
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
    rows = sentences(text)
    evidence_index = case["evidenceSentenceIndex"]
    context_index = case["completionContextSentenceIndex"]
    if max(evidence_index, context_index) > len(rows):
        fail("SEC sentence index changed")
    evidence = rows[evidence_index - 1]
    context = rows[context_index - 1]
    if evidence != case["evidenceText"] or sha(evidence.encode("utf-8")) != case["evidenceSentenceSha256"]:
        fail("frozen evidence sentence changed")
    if sha(context.encode("utf-8")) != case["completionContextSentenceSha256"]:
        fail("completion context sentence changed")
    if not PAST_RECEIPT_RE.search(evidence) or FORBIDDEN_TARGET_RE.search(evidence):
        fail("receipt or exclusion semantics changed")
    for ratio in case["ratios"]:
        if ratio["evidenceFragment"] not in evidence:
            fail("ratio is not explicit in the frozen sentence")
    return {
        "accession": case["accession"],
        "caseId": case["caseId"],
        "evidenceKind": EXPECTED_KIND,
        "evidenceText": evidence,
        "evidenceTextSha256": case["evidenceSentenceSha256"],
        "ratios": copy.deepcopy(case["ratios"]),
        "semanticValues": {
            "actualPastReceiptOrDistributionStated": True,
            "cashInTargetSentence": False,
            "completedTransactionContextBound": True,
            "futureOrConditionalInTargetSentence": False,
            "ratioCount": len(case["ratios"]),
        },
        "sourceCandidateBinding": {
            "candidateKind": case["sourceCandidateKind"],
            "evidenceSha256": case["sourceCandidateEvidenceSha256"],
            "occurrenceId": case["sourceOccurrenceId"],
            "sourceRowId": case["sourceRowId"],
        },
        "sourceRef": {
            "blobSha256": case["blobSha256"],
            "bytes": case["blobBytes"],
            "completionContextSentenceIndex": context_index,
            "completionContextSentenceSha256": case["completionContextSentenceSha256"],
            "documentFilename": case["documentFilename"],
            "documentIndex": index,
            "documentSequence": case["documentSequence"],
            "documentType": case["documentType"],
            "evidenceSentenceIndex": evidence_index,
            "evidenceSentenceSha256": case["evidenceSentenceSha256"],
            "normalizationMode": mode,
            "rawDocumentSha256": case["rawDocumentSha256"],
            "rawTextSha256": case["rawTextSha256"],
            "relativePath": case["relativePath"],
        },
    }


def deduplication(rows: list[dict[str, Any]], frozen: dict[str, Any]) -> dict[str, Any]:
    def provenance(row: dict[str, Any]) -> tuple[Any, ...]:
        ref = row["sourceRef"]
        index = ref.get("evidenceSentenceIndex", ref.get("evidenceSentenceIndex"))
        evidence_hash = ref.get("evidenceSentenceSha256", row.get("evidenceTextSha256"))
        return (row["accession"], ref["blobSha256"], ref["documentIndex"], index, evidence_hash)

    frozen_rows = frozen["rows"]
    intersections = {
        "ACCESSION": len({row["accession"] for row in rows} & {row["accession"] for row in frozen_rows}),
        "BLOB_SHA256": len({row["sourceRef"]["blobSha256"] for row in rows} & {row["sourceRef"]["blobSha256"] for row in frozen_rows}),
        "EVIDENCE_SENTENCE_SHA256": len({row["evidenceTextSha256"] for row in rows} & {row["evidenceTextSha256"] for row in frozen_rows}),
        "ACCESSION_BLOB_DOCUMENT_SENTENCE_PROVENANCE": len({provenance(row) for row in rows} & {provenance(row) for row in frozen_rows}),
    }
    if set(intersections.values()) != {0}:
        fail("frozen-five deduplication failed")
    return {
        "dimensions": [
            "ACCESSION", "BLOB_SHA256", "EVIDENCE_SENTENCE_SHA256",
            "ACCESSION_BLOB_DOCUMENT_SENTENCE_PROVENANCE",
        ],
        "frozenFiveRawSha256": sha(FROZEN_FIVE.read_bytes()),
        "frozenFiveRows": len(frozen_rows),
        "intersectionCountByDimension": intersections,
    }


def topology(remote_required: bool = True) -> dict[str, Any]:
    head = git("rev-parse", "HEAD")
    if git("remote", "get-url", "origin") != REMOTE_URL:
        fail("origin URL changed")
    if not is_ancestor(BASE_COMMIT, head) or not on_first_parent_chain(BASE_COMMIT, head):
        fail("HEAD is not a linear first-parent descendant of Tag854")
    if remote_required:
        rows = git("ls-remote", "--refs", "origin", REMOTE_REF).splitlines()
        if len(rows) != 1 or rows[0].split()[0] != head:
            fail("live remote ref differs from local HEAD")
        if git("rev-parse", "@{upstream}") != head:
            fail("upstream differs from local HEAD")
    committed = [git_path_exists(head, path) for path in OWN_PATHS]
    if len(set(committed)) != 1:
        fail("partial implementation introduction")
    if git_path_exists(head, OUTPUT) or OUTPUT.exists():
        fail("future output must remain absent")
    if not committed[0]:
        if any(git_path_exists(head, path) for path in OWN_PATHS):
            fail("implementation path unexpectedly committed")
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
        fail("implementation introduction is not a single-parent commit")
    parent = parent_row[1]
    if not is_ancestor(BASE_COMMIT, parent) or not on_first_parent_chain(BASE_COMMIT, parent):
        fail("implementation parent is not a linear Tag854 descendant")
    if not on_first_parent_chain(introduction, head):
        fail("implementation introduction is not on HEAD first-parent chain")
    changes = git("diff-tree", "--no-commit-id", "--name-status", "-r", introduction).splitlines()
    expected = {f"A\t{path.relative_to(ROOT).as_posix()}" for path in OWN_PATHS}
    if set(changes) != expected or len(changes) != 3:
        fail("implementation introduction did not add exactly its three paths")
    for path in OWN_PATHS:
        relative = path.relative_to(ROOT).as_posix()
        if git("log", "-1", "--format=%H", "--", relative) != introduction:
            fail("implementation path changed after introduction")
        if git_raw(head, path) != path.read_bytes():
            fail("implementation Git/worktree bytes differ")
    return {
        "baseSealCommit": BASE_COMMIT,
        "currentCommit": head,
        "implementationIntroductionCommit": introduction,
        "implementationIntroductionParent": parent,
        "linearIntermediateCommitsAllowed": True,
        "phase": "IMPLEMENTED_NO_OUTPUT",
    }


def implementation_bindings(state: dict[str, Any]) -> dict[str, Any]:
    return {
        **copy.deepcopy(state),
        "builderRawSha256": sha(BUILDER.read_bytes()),
        "contractRawSha256": sha(CONTRACT.read_bytes()),
        "remoteRef": REMOTE_REF,
        "remoteUrl": REMOTE_URL,
        "testRawSha256": sha(TEST.read_bytes()),
    }


def build_report(
    contract: dict[str, Any], reconciliation: dict[str, Any], frozen: dict[str, Any], state: dict[str, Any]
) -> dict[str, Any]:
    rows = [rebuild_case(case, reconciliation) for case in contract["frozenCases"]]
    if len(rows) != 6 or len({row["accession"] for row in rows}) != 6:
        fail("rebuilt population changed")
    if sum(len(row["ratios"]) for row in rows) != 8:
        fail("rebuilt ratio population changed")
    dedup = deduplication(rows, frozen)
    value = {
        "claimLocks": copy.deepcopy(contract["claimLocks"]),
        "contractRawSha256": CONTRACT_RAW,
        "deduplication": dedup,
        "implementationBindings": implementation_bindings(state),
        "inputBindings": {
            "candidateReconciliation": copy.deepcopy(contract["inputs"]["candidateReconciliation"]),
            "corpus": copy.deepcopy(contract["inputs"]["corpus"]),
            "frozenFive": copy.deepcopy(contract["deduplicationContract"]["frozenFiveInput"]),
        },
        "outcomesAccessed": False,
        "population": {
            "actualNoncashShareReceiptStatementRows": 6,
            "dualRatioRows": 2,
            "frozenEvidenceRows": 6,
            "ratioRows": 8,
            "uniqueAccessions": 6,
        },
        "rows": rows,
        "schema": "early-detection-sec-frozen-noncash-share-receipt-evidence/v1",
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
    if any(item is not False for item in value["claimLocks"].values()):
        fail("report claim lock changed")
    if value["outcomesAccessed"] is not False:
        fail("report outcomes boundary changed")


def rejected(action: Callable[[], None]) -> bool:
    try:
        action()
    except (EvidenceError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError):
        return True
    return False


def self_test(
    contract: dict[str, Any], reconciliation: dict[str, Any], frozen: dict[str, Any], state: dict[str, Any]
) -> dict[str, Any]:
    expected = build_report(contract, reconciliation, frozen, state)
    validate_report(expected, build_report(contract, reconciliation, frozen, state))
    mutations: dict[str, Callable[[dict[str, Any]], None]] = {
        "receiptEvidenceHashChanged": lambda item: item["rows"][0].__setitem__("evidenceTextSha256", "0" * 64),
        "receiptEvidenceTextChanged": lambda item: item["rows"][0].__setitem__("evidenceText", "received shares"),
        "receiptSemanticChanged": lambda item: item["rows"][0]["semanticValues"].__setitem__("actualPastReceiptOrDistributionStated", False),
        "ratioRemoved": lambda item: item["rows"][0]["ratios"].clear(),
        "ratioUnitChanged": lambda item: item["rows"][1]["ratios"][0].__setitem__("surrenderedUnits", "9"),
        "ratioDualCollapsed": lambda item: item["rows"][4]["ratios"].pop(),
        "sourceBlobChanged": lambda item: item["rows"][0]["sourceRef"].__setitem__("blobSha256", "0" * 64),
        "sourceDocumentChanged": lambda item: item["rows"][0]["sourceRef"].__setitem__("documentIndex", 2),
        "sourceContextChanged": lambda item: item["rows"][0]["sourceRef"].__setitem__("completionContextSentenceSha256", "0" * 64),
        "sourceCandidateChanged": lambda item: item["rows"][0]["sourceCandidateBinding"].__setitem__("occurrenceId", "0" * 64),
        "dedupAccessionOverlap": lambda item: item["deduplication"]["intersectionCountByDimension"].__setitem__("ACCESSION", 1),
        "dedupBlobOverlap": lambda item: item["deduplication"]["intersectionCountByDimension"].__setitem__("BLOB_SHA256", 1),
        "dedupEvidenceOverlap": lambda item: item["deduplication"]["intersectionCountByDimension"].__setitem__("EVIDENCE_SENTENCE_SHA256", 1),
        "dedupProvenanceOverlap": lambda item: item["deduplication"]["intersectionCountByDimension"].__setitem__("ACCESSION_BLOB_DOCUMENT_SENTENCE_PROVENANCE", 1),
        "claimCashRaised": lambda item: item["claimLocks"].__setitem__("cashReceiptVerified", True),
        "claimTerminalRaised": lambda item: item["claimLocks"].__setitem__("terminalWealthComplete", True),
        "claimIdentityRaised": lambda item: item["claimLocks"].__setitem__("historicalIdentityResolved", True),
        "outcomesRaised": lambda item: item.__setitem__("outcomesAccessed", True),
        "topologyBaseChanged": lambda item: item["implementationBindings"].__setitem__("baseSealCommit", "0" * 64),
        "topologyIntroductionChanged": lambda item: item["implementationBindings"].__setitem__("implementationIntroductionCommit", "0" * 64),
        "implementationBytesChanged": lambda item: item["implementationBindings"].__setitem__("builderRawSha256", "0" * 64),
        "scopeRaised": lambda item: item.__setitem__("scopeLimit", "ALL_NONCASH_RECEIPTS"),
        "rowAdded": lambda item: item["rows"].append(copy.deepcopy(item["rows"][0])),
        "rowRemoved": lambda item: item["rows"].pop(),
    }
    kills: dict[str, bool] = {}
    for label, mutate in mutations.items():
        changed = copy.deepcopy(expected)
        mutate(changed)
        changed["reportSha256"] = sha(canonical({key: row for key, row in changed.items() if key != "reportSha256"}))
        kills[label] = rejected(lambda changed=changed: validate_report(changed, expected))
    if set(kills.values()) != {True}:
        fail("adversarial mutation survived")
    return {
        "schema": "early-detection-sec-frozen-noncash-share-receipt-evidence-self-test/v1",
        "status": "PASS",
        "mutationKills": kills,
        "verifiedRows": 6,
        "ratioRows": 8,
        "outcomesAccessed": False,
    }


def pretty_bytes(report: dict[str, Any]) -> bytes:
    return json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"


def write_new(raw: bytes) -> None:
    if OUTPUT.exists():
        fail("future output already exists")
    descriptor, name = tempfile.mkstemp(prefix=f".{OUTPUT.name}.", suffix=".tmp", dir=OUTPUT.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.link(temporary, OUTPUT)
    finally:
        temporary.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify-contract", "self-test", "dry-run", "build"))
    args = parser.parse_args()
    try:
        contract = load_contract()
        state = topology(remote_required=True)
        reconciliation, frozen = load_inputs(contract, state["currentCommit"])
        report = build_report(contract, reconciliation, frozen, state)
        validate_report(report, build_report(contract, reconciliation, frozen, state))
        raw = pretty_bytes(report)
        if args.command == "verify-contract":
            result = {
                "schema": "early-detection-sec-frozen-noncash-share-receipt-evidence-contract-verification/v1",
                "status": "PASS", **state,
                "verifiedRows": 6, "ratioRows": 8,
                "scopeLimit": EXPECTED_SCOPE, "outcomesAccessed": False,
            }
        elif args.command == "self-test":
            result = self_test(contract, reconciliation, frozen, state)
        elif args.command == "dry-run":
            result = {
                "schema": "early-detection-sec-frozen-noncash-share-receipt-evidence-dry-run/v1",
                "status": "PASS", **state,
                "population": report["population"],
                "rawSha256": sha(raw), "reportSha256": report["reportSha256"],
                "scopeLimit": EXPECTED_SCOPE, "semanticCeiling": EXPECTED_CEILING,
                "outcomesAccessed": False,
            }
        else:
            if state["phase"] != "IMPLEMENTED_NO_OUTPUT":
                fail("build requires a committed, remote-verified implementation introduction")
            write_new(raw)
            result = {
                "schema": "early-detection-sec-frozen-noncash-share-receipt-evidence-build/v1",
                "status": "PASS", "rawSha256": sha(raw),
                "reportSha256": report["reportSha256"], "verifiedRows": 6,
                "ratioRows": 8, "outcomesAccessed": False,
            }
    except (EvidenceError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
