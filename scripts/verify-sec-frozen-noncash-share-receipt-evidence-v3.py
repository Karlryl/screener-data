#!/usr/bin/env python3
"""Verify the append-only V3 correction of six frozen SEC share-receipt rows."""

from __future__ import annotations

import argparse
import copy
import hashlib
import html
import json
import re
import subprocess
import sys
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "research" / "early-detection-v4" / "sec-frozen-noncash-share-receipt-evidence-contract-v3.json"
CORPUS = Path(r"C:\Users\Anwender\Documents\GrowthScreenerResearchData\early-detection-v4\corporate-action-originals\blobs\sha256")

CONTRACT_BYTES = 19763
CONTRACT_RAW = "d1e0ff5188332c4840a33e2218c9a54baf743d0327d229ceea363488813d271f"
CONTRACT_SELF = "7974876c527b1157aa6fefb98c5b643fc43841cbbc3beb3e2621702472ef12d5"
DERIVED_VIEW_SHA = "a68f2e51f25f0462381dd86b9cfb429e0c98d063f4712de050ce5311878add0b"
REMOTE_URL = "https://github.com/Karlryl/screener-data.git"
REMOTE_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
MINIMUM_ANCESTOR = "5622b794b0a435c5389707a6777161a33f8a79f7"
EXPECTED_SCOPE = "EXACT_SIX_FROZEN_PRIMARY_SEC_SENTENCES_ONLY_NO_GENERAL_SELECTOR"
EXPECTED_CEILING = "EXACT_SIX_COMPLETED_NONCASH_SHARE_RECEIPTS_WITH_EXPLICIT_RECEIVED_PER_DENOMINATOR_RATIOS_ONLY_APTIV_DENOMINATOR_CANCELLATION_VERIFIED"
EXPECTED_KIND = "ACTUAL_NONCASH_SHARE_RECEIPT_WITH_EXPLICIT_RATIO_STATED"
APTIV_CASE = "NONCASH-RECEIPT-004"

OWN_RELATIVE_PATHS = (
    "research/early-detection-v4/sec-frozen-noncash-share-receipt-evidence-contract-v3.json",
    "scripts/verify-sec-frozen-noncash-share-receipt-evidence-v3.py",
    "tests/verify-sec-frozen-noncash-share-receipt-evidence-v3.test.js",
)
REPO_FILE_PATHS = {
    "v1Contract": "research/early-detection-v4/sec-frozen-noncash-share-receipt-evidence-contract-v1.json",
    "v1Builder": "scripts/build-sec-frozen-noncash-share-receipt-evidence-v1.py",
    "v1Test": "tests/build-sec-frozen-noncash-share-receipt-evidence-v1.test.js",
    "v1Output": "reports/early-detection/sec-frozen-noncash-share-receipt-evidence-v1.json",
    "v2SealContract": "research/early-detection-v4/sec-frozen-noncash-share-receipt-evidence-output-seal-contract-v2.json",
    "v2SealVerifier": "scripts/verify-sec-frozen-noncash-share-receipt-evidence-output-v2.py",
    "v2SealTest": "tests/verify-sec-frozen-noncash-share-receipt-evidence-output-v2.test.js",
}
SEC_RELATIVE_PATHS = (
    "5f/5f156da56338d41827e47f8bbf67818cc61c2ad2505dc5bfdadafd9d087bee01.txt",
    "be/be25cf5f92394d3f7d417632cdf99962ac8f3a69c9f491c5df78f4bfa905cd38.txt",
    "03/03f4bbcb4db8ddfb9abae0ea9c5d396396615395d385bce81252ecb645a9711d.txt",
    "ce/cee15eaafbf98c2aa132588c0307fbfa0f77e57bd8dd5d2b4f1cdaabd1b5874b.txt",
    "e6/e676323d38931162270b387d12ffddca05619cc19cc032122a0caced535b95d7.txt",
    "be/be98222c27d6edcb82ea804970acc9e25b21dbd52927a006fc6a12388c5ed6aa.txt",
)
EXPECTED_CASE_IDS = tuple(f"NONCASH-RECEIPT-{index:03d}" for index in range(1, 7))
EXPECTED_ACCESSIONS = (
    "0000950103-18-000919",
    "0000950103-18-003297",
    "0000950103-20-021106",
    "0001193125-24-286219",
    "0001213900-23-091028",
    "0001213900-24-111979",
)
EXPECTED_POPULATION = {
    "correctedRows": 6,
    "ratioRows": 8,
    "dualRatioRows": 2,
    "uniqueAccessions": 6,
    "denominatorSurrenderOrCancellationVerifiedRows": 1,
    "denominatorSurrenderOrCancellationNotVerifiedRows": 5,
}
CLAIM_LOCK_KEYS = {
    "cashConsiderationVerified",
    "cashReceiptVerified",
    "corporateActionChainComplete",
    "denominatorSurrenderOrCancellationBeyondExactAptivRowVerified",
    "feesOrTaxesVerified",
    "fractionalShareTreatmentVerified",
    "historicalIdentityResolved",
    "laterDistributionsVerified",
    "laterRecoveriesVerified",
    "listingContinuityVerified",
    "noncashReceiptBeyondExactRows",
    "originalV4GateCredit",
    "outcomesAccessed",
    "pricesAccessed",
    "returnsAccessed",
    "terminalSessionComplete",
    "terminalWealthComplete",
    "universalHolderCoverageVerified",
}
LEGACY_RATIO_KEYS = {"surrenderedSecurityText", "surrenderedUnits"}

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
COMPLETION_RE = re.compile(r"\b(?:completed|merged|implemented)\b", re.I)


class EvidenceError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise EvidenceError(message)


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def pretty(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        fail(f"{label} exact keys changed")


def validate_claim_locks(value: Any, label: str) -> None:
    exact_keys(value, CLAIM_LOCK_KEYS, label)
    if any(item is not False for item in value.values()):
        fail(f"{label} value changed")


def validate_contract_value(value: Any) -> dict[str, Any]:
    exact_keys(value, {
        "schema", "createdAt", "taskId", "track", "purpose", "supersession",
        "sourceBase", "materialization", "sourceBindings", "expectedPopulation",
        "semanticPolicy", "claimLocks", "derivedView", "derivedViewSha256",
        "verificationContract", "contractSha256",
    }, "contract")
    if value["schema"] != "early-detection-sec-frozen-noncash-share-receipt-evidence-contract/v3":
        fail("contract schema changed")
    if value["taskId"] != "Q003-SEC-FROZEN-NONCASH-SHARE-RECEIPT-EVIDENCE-V3" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract identity changed")

    if value["supersession"] != {
        "supersededSchemas": [
            "early-detection-sec-frozen-noncash-share-receipt-evidence-contract/v1",
            "early-detection-sec-frozen-noncash-share-receipt-evidence/v1",
            "early-detection-sec-frozen-noncash-share-receipt-evidence-output-seal-contract/v2",
        ],
        "oldBytesRemainAppendOnly": True,
        "oldSurrenderedFieldsGrantNoSurrenderOrCancellationCredit": True,
        "authoritativeDenominatorFields": ["denominatorSecurityText", "denominatorUnits"],
        "authoritativeRowQualificationField": "denominatorSurrenderOrCancellationVerified",
    }:
        fail("supersession contract changed")
    if value["sourceBase"] != {
        "remoteUrl": REMOTE_URL,
        "remoteRef": REMOTE_REF,
        "minimumAncestor": MINIMUM_ANCESTOR,
        "minimumAncestorTag": 861,
        "linearIntermediateCommitsAllowed": True,
        "introductionMustBeSingleParent": True,
        "introductionMustAddExactlyAuthorizedPaths": True,
        "introducedBytesMustRemainUnchanged": True,
        "authorizedPaths": list(OWN_RELATIVE_PATHS),
    }:
        fail("source base changed")
    if value["materialization"] != {
        "mode": "CONTRACT_EMBEDDED_EXACT_DERIVED_VIEW",
        "newOutputRequired": False,
        "newOutputPath": None,
    }:
        fail("materialization contract changed")

    source_bindings = value["sourceBindings"]
    exact_keys(source_bindings, {"repoFiles", "secBlobLogicalRoot", "secBlobs"}, "sourceBindings")
    if source_bindings["secBlobLogicalRoot"] != "early-detection-v4/corporate-action-originals/blobs/sha256":
        fail("SEC logical root changed")
    repo_files = source_bindings["repoFiles"]
    exact_keys(repo_files, set(REPO_FILE_PATHS), "repoFiles")
    for name, expected_path in REPO_FILE_PATHS.items():
        binding = repo_files[name]
        base_keys = {"path", "bytes", "rawSha256", "gitBlob", "introductionCommit"}
        self_keys = {"selfField", "selfSha256"} if name in {"v1Contract", "v1Output", "v2SealContract"} else set()
        exact_keys(binding, base_keys | self_keys, f"repoFiles.{name}")
        if binding["path"] != expected_path:
            fail(f"repo file path changed: {name}")
        if not isinstance(binding["bytes"], int) or binding["bytes"] <= 0:
            fail(f"repo file byte count changed: {name}")
        if not isinstance(binding["rawSha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", binding["rawSha256"]):
            fail(f"repo file raw hash changed: {name}")
        if not isinstance(binding["introductionCommit"], str) or not re.fullmatch(r"[0-9a-f]{40}", binding["introductionCommit"]):
            fail(f"repo file introduction hash changed: {name}")
        if not re.fullmatch(r"[0-9a-f]{40}", binding["gitBlob"]):
            fail(f"repo Git blob changed: {name}")
        if self_keys:
            expected_field = "reportSha256" if name == "v1Output" else "contractSha256"
            if binding["selfField"] != expected_field or not re.fullmatch(r"[0-9a-f]{64}", binding["selfSha256"]):
                fail(f"repo file self binding changed: {name}")

    blobs = source_bindings["secBlobs"]
    if not isinstance(blobs, list) or len(blobs) != 6:
        fail("SEC blob population changed")
    if tuple(row.get("caseId") for row in blobs) != EXPECTED_CASE_IDS:
        fail("SEC case sequence changed")
    if tuple(row.get("accession") for row in blobs) != EXPECTED_ACCESSIONS:
        fail("SEC accession sequence changed")
    if tuple(row.get("relativePath") for row in blobs) != SEC_RELATIVE_PATHS:
        fail("SEC path allowlist changed")
    for row in blobs:
        exact_keys(row, {"caseId", "accession", "relativePath", "bytes", "rawSha256"}, "SEC blob")
        relative = Path(row["relativePath"])
        if relative.is_absolute() or ".." in relative.parts or relative.parts[0] != row["rawSha256"][:2] or relative.stem != row["rawSha256"]:
            fail("SEC content-addressed path changed")
        if not isinstance(row["bytes"], int) or row["bytes"] <= 0:
            fail("SEC byte count changed")

    if value["expectedPopulation"] != EXPECTED_POPULATION:
        fail("expected population changed")
    if value["semanticPolicy"] != {
        "scopeLimit": EXPECTED_SCOPE,
        "semanticCeiling": EXPECTED_CEILING,
        "legacySurrenderedFieldsForbiddenInDerivedView": True,
        "denominatorDoesNotImplySurrenderOrCancellation": True,
        "verifiedSurrenderOrCancellationCaseIds": [APTIV_CASE],
        "allOtherRowsMustBeFalse": True,
        "outcomesAccessed": False,
    }:
        fail("semantic policy changed")
    validate_claim_locks(value["claimLocks"], "claimLocks")
    if value["verificationContract"] != {
        "contractRawSha256CheckedBeforeJsonParse": True,
        "contractSelfSha256Checked": True,
        "exactNestedSchemasRequired": True,
        "allowedPathsHardcodedBeforeReads": True,
        "remoteRequiredForVerifyPass": True,
        "normalAndOptimizedRemoteRunsRequiredByTest": True,
        "sourceRebuildByteExact": True,
        "readOnly": True,
        "outcomesAccessed": False,
    }:
        fail("verification contract changed")

    validate_derived_view_shape(value["derivedView"])
    if value["derivedView"]["population"] != value["expectedPopulation"]:
        fail("derived population binding changed")
    if value["derivedView"]["claimLocks"] != value["claimLocks"]:
        fail("derived claim-lock binding changed")
    if value["derivedViewSha256"] != DERIVED_VIEW_SHA or sha(canonical(value["derivedView"])) != DERIVED_VIEW_SHA:
        fail("derived view hash changed")

    body = copy.deepcopy(value)
    claimed = body.pop("contractSha256", None)
    if claimed != CONTRACT_SELF or sha(canonical(body)) != CONTRACT_SELF:
        fail("contract self hash changed")
    return value


def validate_contract_bytes(raw: bytes) -> dict[str, Any]:
    # This fixed-path raw check intentionally precedes JSON parsing and every contract-directed read.
    if len(raw) != CONTRACT_BYTES or sha(raw) != CONTRACT_RAW:
        fail("V3 contract raw bytes changed before parse")
    return validate_contract_value(json.loads(raw))


def load_contract() -> dict[str, Any]:
    return validate_contract_bytes(CONTRACT_PATH.read_bytes())


def validate_derived_view_shape(view: Any) -> None:
    exact_keys(view, {
        "schema", "supersedesSchemas", "scopeLimit", "semanticCeiling", "population",
        "claimLocks", "outcomesAccessed", "rows",
    }, "derivedView")
    if view["schema"] != "early-detection-sec-frozen-noncash-share-receipt-corrected-derived-view/v3":
        fail("derived view schema changed")
    if view["supersedesSchemas"] != [
        "early-detection-sec-frozen-noncash-share-receipt-evidence-contract/v1",
        "early-detection-sec-frozen-noncash-share-receipt-evidence/v1",
        "early-detection-sec-frozen-noncash-share-receipt-evidence-output-seal-contract/v2",
    ]:
        fail("derived supersession changed")
    if view["scopeLimit"] != EXPECTED_SCOPE or view["semanticCeiling"] != EXPECTED_CEILING:
        fail("derived scope changed")
    if view["population"] != EXPECTED_POPULATION or view["outcomesAccessed"] is not False:
        fail("derived population or outcome boundary changed")
    validate_claim_locks(view["claimLocks"], "derivedView.claimLocks")
    rows = view["rows"]
    if not isinstance(rows, list) or len(rows) != 6:
        fail("derived row population changed")
    if tuple(row.get("caseId") for row in rows) != EXPECTED_CASE_IDS:
        fail("derived case sequence changed")
    if tuple(row.get("accession") for row in rows) != EXPECTED_ACCESSIONS:
        fail("derived accession sequence changed")
    for row in rows:
        exact_keys(row, {
            "caseId", "accession", "evidenceKind", "evidenceText", "evidenceTextSha256",
            "sourceBlobSha256", "denominatorSurrenderOrCancellationVerified", "ratios",
        }, "derived row")
        if row["evidenceKind"] != EXPECTED_KIND:
            fail("derived evidence kind changed")
        if not isinstance(row["denominatorSurrenderOrCancellationVerified"], bool):
            fail("derived denominator qualification changed")
        if not isinstance(row["ratios"], list) or len(row["ratios"]) not in {1, 2}:
            fail("derived ratio cardinality changed")
        for ratio in row["ratios"]:
            exact_keys(ratio, {
                "ratioId", "evidenceFragment", "receivedSecurityText", "receivedUnits",
                "recipientScope", "denominatorSecurityText", "denominatorUnits",
            }, "derived ratio")
            if LEGACY_RATIO_KEYS & set(ratio):
                fail("legacy surrendered field survived")
            if not re.fullmatch(r"[1-9][0-9]*", ratio["receivedUnits"]) or not re.fullmatch(r"[1-9][0-9]*", ratio["denominatorUnits"]):
                fail("derived ratio unit changed")


def git_run(*args: str, binary: bool = False) -> subprocess.CompletedProcess[Any]:
    return subprocess.run(
        ["git", *args], cwd=ROOT, check=False, capture_output=True,
        **({} if binary else {"text": True, "encoding": "utf-8"}),
    )


def git(*args: str) -> str:
    result = git_run(*args)
    if result.returncode:
        fail(f"Git command failed: {' '.join(args)}")
    return result.stdout.strip()


def git_raw(commit: str, relative: str) -> bytes:
    result = git_run("show", f"{commit}:{relative}", binary=True)
    if result.returncode:
        fail(f"Git blob missing: {relative}")
    return result.stdout


def git_path_exists(commit: str, relative: str) -> bool:
    return git_run("cat-file", "-e", f"{commit}:{relative}").returncode == 0


def is_ancestor(ancestor: str, descendant: str) -> bool:
    return git_run("merge-base", "--is-ancestor", ancestor, descendant).returncode == 0


def on_first_parent_chain(ancestor: str, descendant: str) -> bool:
    if not re.fullmatch(r"[0-9a-f]{40}", ancestor) or not re.fullmatch(r"[0-9a-f]{40}", descendant):
        return False
    return ancestor in git("rev-list", "--first-parent", descendant).splitlines()


def require_remote_for_verify(command: str, remote: bool) -> None:
    if command == "verify" and not remote:
        fail("verify requires --remote; local-only PASS is forbidden")


def verify_topology(remote_required: bool) -> dict[str, Any]:
    head = git("rev-parse", "HEAD")
    if git("remote", "get-url", "origin") != REMOTE_URL:
        fail("origin URL changed")
    if git("rev-parse", "@{upstream}") != head:
        fail("upstream differs from HEAD")
    if not on_first_parent_chain(MINIMUM_ANCESTOR, head):
        fail("Tag861 is not on the HEAD first-parent chain")
    for commit in git("rev-list", "--first-parent", f"{MINIMUM_ANCESTOR}..{head}").splitlines():
        if len(git("show", "-s", "--format=%P", commit).split()) != 1:
            fail("nonlinear history after Tag861")
    if remote_required:
        rows = git("ls-remote", "--refs", "origin", REMOTE_REF).splitlines()
        if len(rows) != 1 or rows[0].split()[0] != head:
            fail("live remote ref differs from HEAD")

    committed = [git_path_exists(head, path) for path in OWN_RELATIVE_PATHS]
    if len(set(committed)) != 1:
        fail("partial V3 introduction")
    if not committed[0]:
        return {"phase": "PRE_INTRODUCTION", "head": head, "introductionCommit": None}

    introductions = {
        git("log", "--diff-filter=A", "-1", "--format=%H", "--", path)
        for path in OWN_RELATIVE_PATHS
    }
    if len(introductions) != 1:
        fail("V3 paths were not introduced together")
    introduction = introductions.pop()
    parents = git("show", "-s", "--format=%P", introduction).split()
    if len(parents) != 1 or not on_first_parent_chain(MINIMUM_ANCESTOR, parents[0]):
        fail("V3 introduction parent changed")
    if not on_first_parent_chain(introduction, head):
        fail("V3 introduction is not on the HEAD first-parent chain")
    changes = git("diff-tree", "--root", "--no-commit-id", "--name-status", "-r", introduction).splitlines()
    expected = {f"A\t{path}" for path in OWN_RELATIVE_PATHS}
    if len(changes) != 3 or set(changes) != expected:
        fail("V3 introduction did not add exactly its three paths")
    for relative in OWN_RELATIVE_PATHS:
        local = (ROOT / relative).read_bytes()
        if git_raw(introduction, relative) != local or git_raw(head, relative) != local:
            fail("V3 introduced bytes changed")
        if git("log", "-1", "--format=%H", "--", relative) != introduction:
            fail("V3 path changed after introduction")
    return {"phase": "POST_INTRODUCTION", "head": head, "introductionCommit": introduction}


def validate_repo_files(contract: dict[str, Any], head: str) -> dict[str, bytes]:
    output: dict[str, bytes] = {}
    minimum_first_parent = set(git("rev-list", "--first-parent", MINIMUM_ANCESTOR).splitlines())
    for name, expected_path in REPO_FILE_PATHS.items():
        binding = contract["sourceBindings"]["repoFiles"][name]
        if binding["path"] != expected_path:
            fail(f"late path mismatch: {name}")
        raw = (ROOT / expected_path).read_bytes()
        if len(raw) != binding["bytes"] or sha(raw) != binding["rawSha256"]:
            fail(f"repo file raw bytes changed: {name}")
        if git_raw(head, expected_path) != raw:
            fail(f"repo file Git/worktree bytes differ: {name}")
        if git("rev-parse", f"{head}:{expected_path}") != binding["gitBlob"]:
            fail(f"repo file Git blob changed: {name}")
        introduction = git("log", "--diff-filter=A", "-1", "--format=%H", "--", expected_path)
        if introduction != binding["introductionCommit"] or introduction not in minimum_first_parent:
            fail(f"repo file introduction changed: {name}")
        if git("log", "-1", "--format=%H", "--", expected_path) != introduction:
            fail(f"repo file changed after introduction: {name}")
        if "selfField" in binding:
            parsed = json.loads(raw)
            body = copy.deepcopy(parsed)
            claimed = body.pop(binding["selfField"], None)
            if claimed != binding["selfSha256"] or sha(canonical(body)) != claimed:
                fail(f"repo file self hash changed: {name}")
        output[name] = raw
    return output


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


def normalize_text(raw: bytes) -> str:
    sink = TextSink()
    sink.feed(raw.decode("latin-1"))
    sink.close()
    return " ".join(html.unescape(" ".join(sink.parts)).split())


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


def build_corrected_view(contract: dict[str, Any], repo_raw: dict[str, bytes]) -> dict[str, Any]:
    v1_contract = json.loads(repo_raw["v1Contract"])
    v1_output = json.loads(repo_raw["v1Output"])
    v2_contract = json.loads(repo_raw["v2SealContract"])
    if v1_contract.get("schema") != "early-detection-sec-frozen-noncash-share-receipt-evidence-contract/v1":
        fail("V1 contract identity changed")
    if v1_output.get("schema") != "early-detection-sec-frozen-noncash-share-receipt-evidence/v1":
        fail("V1 output identity changed")
    if v2_contract.get("schema") != "early-detection-sec-frozen-noncash-share-receipt-evidence-output-seal-contract/v2":
        fail("V2 seal identity changed")
    if v1_output.get("outcomesAccessed") is not False or any(v1_output.get("claimLocks", {}).values()):
        fail("V1 output claim boundary changed")
    if any(v2_contract.get("claimLocks", {}).values()):
        fail("V2 seal claim boundary changed")

    cases = v1_contract.get("frozenCases")
    old_rows = v1_output.get("rows")
    sec_bindings = contract["sourceBindings"]["secBlobs"]
    if not isinstance(cases, list) or not isinstance(old_rows, list) or len(cases) != 6 or len(old_rows) != 6:
        fail("V1 row population changed")
    corrected_rows: list[dict[str, Any]] = []
    for case, old_row, blob_binding in zip(cases, old_rows, sec_bindings):
        if case.get("caseId") != blob_binding["caseId"] or old_row.get("caseId") != blob_binding["caseId"]:
            fail("case binding changed")
        if case.get("accession") != blob_binding["accession"] or old_row.get("accession") != blob_binding["accession"]:
            fail("accession binding changed")
        if case.get("relativePath") != blob_binding["relativePath"] or case.get("blobSha256") != blob_binding["rawSha256"]:
            fail("SEC V1/V3 provenance changed")

        raw = (CORPUS / Path(blob_binding["relativePath"])).read_bytes()
        if len(raw) != blob_binding["bytes"] or sha(raw) != blob_binding["rawSha256"]:
            fail("SEC blob bytes changed")
        accessions = ACCESSION_RE.findall(raw)
        if len(accessions) != 1 or accessions[0].decode("ascii") != blob_binding["accession"]:
            fail("SEC accession header changed")
        documents = sec_documents(raw)
        index = case.get("documentIndex")
        if not isinstance(index, int) or index < 1 or index > len(documents):
            fail("SEC document index changed")
        document = documents[index - 1]
        if (
            document["TYPE"] != case.get("documentType")
            or document["SEQUENCE"] != case.get("documentSequence")
            or document["FILENAME"] != case.get("documentFilename")
            or sha(document["raw"]) != case.get("rawDocumentSha256")
            or sha(document["textRaw"]) != case.get("rawTextSha256")
        ):
            fail("SEC document provenance changed")
        rows = sentences(normalize_text(document["textRaw"]))
        evidence_index = case.get("evidenceSentenceIndex")
        context_index = case.get("completionContextSentenceIndex")
        if not isinstance(evidence_index, int) or not isinstance(context_index, int) or max(evidence_index, context_index) > len(rows):
            fail("SEC sentence index changed")
        evidence = rows[evidence_index - 1]
        context = rows[context_index - 1]
        if evidence != case.get("evidenceText") or evidence != old_row.get("evidenceText"):
            fail("SEC evidence text changed")
        if sha(evidence.encode("utf-8")) != case.get("evidenceSentenceSha256") or old_row.get("evidenceTextSha256") != case.get("evidenceSentenceSha256"):
            fail("SEC evidence hash changed")
        if sha(context.encode("utf-8")) != case.get("completionContextSentenceSha256") or not COMPLETION_RE.search(context):
            fail("SEC completion context changed")
        if not re.search(r"\breceived\b", evidence, re.I) or FORBIDDEN_TARGET_RE.search(evidence):
            fail("SEC past-receipt semantics changed")

        exact_keys(old_row, {
            "accession", "caseId", "evidenceKind", "evidenceText", "evidenceTextSha256",
            "ratios", "semanticValues", "sourceCandidateBinding", "sourceRef",
        }, "V1 output row")
        if old_row["evidenceKind"] != EXPECTED_KIND or old_row["sourceRef"].get("blobSha256") != blob_binding["rawSha256"]:
            fail("V1 row provenance changed")
        old_ratios = old_row["ratios"]
        if old_ratios != case.get("ratios") or not isinstance(old_ratios, list):
            fail("V1 ratio binding changed")
        corrected_ratios: list[dict[str, Any]] = []
        for ratio in old_ratios:
            exact_keys(ratio, {
                "ratioId", "evidenceFragment", "receivedSecurityText", "receivedUnits",
                "recipientScope", "surrenderedSecurityText", "surrenderedUnits",
            }, "V1 ratio")
            if ratio["evidenceFragment"] not in evidence:
                fail("V1 ratio is not explicit in evidence")
            corrected_ratios.append({
                "ratioId": ratio["ratioId"],
                "evidenceFragment": ratio["evidenceFragment"],
                "receivedSecurityText": ratio["receivedSecurityText"],
                "receivedUnits": ratio["receivedUnits"],
                "recipientScope": ratio["recipientScope"],
                "denominatorSecurityText": ratio["surrenderedSecurityText"],
                "denominatorUnits": ratio["surrenderedUnits"],
            })

        cancellation_verified = case["caseId"] == APTIV_CASE
        if cancellation_verified:
            if "ordinary shares of the Predecessor Registrant were cancelled" not in evidence:
                fail("Aptiv cancellation evidence changed")
        elif re.search(r"\b(?:surrendered|cancelled)\b", evidence, re.I):
            fail("non-Aptiv surrender or cancellation requires a new contract")
        corrected_rows.append({
            "caseId": case["caseId"],
            "accession": case["accession"],
            "evidenceKind": EXPECTED_KIND,
            "evidenceText": evidence,
            "evidenceTextSha256": case["evidenceSentenceSha256"],
            "sourceBlobSha256": blob_binding["rawSha256"],
            "denominatorSurrenderOrCancellationVerified": cancellation_verified,
            "ratios": corrected_ratios,
        })

    population = {
        "correctedRows": len(corrected_rows),
        "ratioRows": sum(len(row["ratios"]) for row in corrected_rows),
        "dualRatioRows": sum(len(row["ratios"]) == 2 for row in corrected_rows),
        "uniqueAccessions": len({row["accession"] for row in corrected_rows}),
        "denominatorSurrenderOrCancellationVerifiedRows": sum(row["denominatorSurrenderOrCancellationVerified"] for row in corrected_rows),
        "denominatorSurrenderOrCancellationNotVerifiedRows": sum(not row["denominatorSurrenderOrCancellationVerified"] for row in corrected_rows),
    }
    view = {
        "schema": "early-detection-sec-frozen-noncash-share-receipt-corrected-derived-view/v3",
        "supersedesSchemas": contract["supersession"]["supersededSchemas"],
        "scopeLimit": EXPECTED_SCOPE,
        "semanticCeiling": EXPECTED_CEILING,
        "population": population,
        "claimLocks": copy.deepcopy(contract["claimLocks"]),
        "outcomesAccessed": False,
        "rows": corrected_rows,
    }
    validate_derived_view_shape(view)
    if view != contract["derivedView"] or sha(canonical(view)) != DERIVED_VIEW_SHA:
        fail("corrected derived view differs from exact source rebuild")

    incannex = corrected_rows[4]["ratios"]
    bionomics = corrected_rows[5]["ratios"]
    if int(incannex[1]["denominatorUnits"]) * 25 != int(incannex[0]["denominatorUnits"]):
        fail("Incannex ADS/ordinary denominator duality changed")
    if int(bionomics[1]["denominatorUnits"]) * 180 != int(bionomics[0]["denominatorUnits"]):
        fail("Bionomics ADS/ordinary denominator duality changed")
    return view


def rehash_contract(value: dict[str, Any]) -> bytes:
    body = copy.deepcopy(value)
    body.pop("contractSha256", None)
    value["contractSha256"] = sha(canonical(body))
    return pretty(value)


def rejected(action: Callable[[], None]) -> bool:
    try:
        action()
    except (EvidenceError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError):
        return True
    return False


def validate_exact_view(candidate: dict[str, Any], expected: dict[str, Any]) -> None:
    validate_derived_view_shape(candidate)
    if candidate != expected or sha(canonical(candidate)) != DERIVED_VIEW_SHA:
        fail("derived counterexample survived")


def self_test(contract: dict[str, Any], view: dict[str, Any]) -> dict[str, bool]:
    contract_mutations: dict[str, Callable[[dict[str, Any]], None]] = {
        "contractPathRedirect": lambda item: item["sourceBindings"]["repoFiles"]["v1Output"].__setitem__("path", "reports/early-detection/forbidden.json"),
        "authorizedPathsChanged": lambda item: item["sourceBase"].__setitem__("authorizedPaths", ["x", "y", "z"]),
        "populationChanged": lambda item: item["expectedPopulation"].__setitem__("correctedRows", 5),
        "lockKeyRenamed": lambda item: item["claimLocks"].__setitem__("renamedLock", item["claimLocks"].pop("pricesAccessed")),
        "secPathRedirect": lambda item: item["sourceBindings"]["secBlobs"][0].__setitem__("relativePath", "../forbidden.json"),
    }
    kills: dict[str, bool] = {}
    for label, mutate in contract_mutations.items():
        changed = copy.deepcopy(contract)
        mutate(changed)
        changed_raw = rehash_contract(changed)
        kills[label] = rejected(lambda raw=changed_raw: validate_contract_bytes(raw))

    view_mutations: dict[str, Callable[[dict[str, Any]], None]] = {
        "nonAptivSurrenderOverclaim": lambda item: item["rows"][0].__setitem__("denominatorSurrenderOrCancellationVerified", True),
        "aptivCancellationCreditRemoved": lambda item: item["rows"][3].__setitem__("denominatorSurrenderOrCancellationVerified", False),
        "legacySurrenderedFieldRestored": lambda item: item["rows"][0]["ratios"][0].__setitem__("surrenderedUnits", item["rows"][0]["ratios"][0].pop("denominatorUnits")),
        "ratioDirectionReversed": lambda item: (
            item["rows"][1]["ratios"][0].__setitem__("receivedUnits", "10"),
            item["rows"][1]["ratios"][0].__setitem__("denominatorUnits", "1"),
        ),
        "rowRemoved": lambda item: item["rows"].pop(),
    }
    for label, mutate in view_mutations.items():
        changed_view = copy.deepcopy(view)
        mutate(changed_view)
        kills[label] = rejected(lambda candidate=changed_view: validate_exact_view(candidate, view))
    kills["noRemoteVerify"] = rejected(lambda: require_remote_for_verify("verify", False))
    if not kills or any(item is not True for item in kills.values()):
        fail("V3 adversarial mutation survived")
    return kills


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify", "self-test"))
    parser.add_argument("--remote", action="store_true")
    args = parser.parse_args()
    try:
        contract = load_contract()
        require_remote_for_verify(args.command, args.remote)
        state = verify_topology(remote_required=args.remote)
        repo_raw = validate_repo_files(contract, state["head"])
        view = build_corrected_view(contract, repo_raw)
        if args.command == "self-test":
            result = {
                "schema": "early-detection-sec-frozen-noncash-share-receipt-evidence-self-test/v3",
                "status": "PASS",
                "phase": state["phase"],
                "head": state["head"],
                "remoteVerified": args.remote,
                "kills": self_test(contract, view),
                "derivedViewSha256": DERIVED_VIEW_SHA,
                "correctedRows": 6,
                "ratioRows": 8,
                "outcomesAccessed": False,
            }
        else:
            result = {
                "schema": "early-detection-sec-frozen-noncash-share-receipt-evidence-verification/v3",
                "status": "PASS",
                "phase": state["phase"],
                "head": state["head"],
                "remoteVerified": True,
                "contractRawVerifiedBeforeParse": True,
                "sourceRebuildByteExact": True,
                "derivedViewSha256": DERIVED_VIEW_SHA,
                "correctedRows": 6,
                "ratioRows": 8,
                "dualRatioRows": 2,
                "denominatorSurrenderOrCancellationVerifiedCaseIds": [APTIV_CASE],
                "outcomesAccessed": False,
            }
        print(json.dumps(result, sort_keys=True))
        return 0
    except (EvidenceError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError) as exc:
        print(json.dumps({
            "schema": "early-detection-sec-frozen-noncash-share-receipt-evidence-error/v3",
            "status": "FAIL",
            "error": str(exc),
            "outcomesAccessed": False,
        }, sort_keys=True), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
