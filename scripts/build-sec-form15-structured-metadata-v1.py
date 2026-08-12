#!/usr/bin/env python3
"""Build outcome-blind, document-bound metadata from local SEC Form 15 originals."""
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
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "research" / "early-detection-v4" / "sec-form15-structured-metadata-contract-v1.json"
CONTRACT_RAW_SHA256 = "a433c283c0ab3bcb4613136dbf62ff0b21d45c285403b9b0df57e1e8cfa25fa8"
QUEUE_PATH = ROOT / "reports" / "early-detection" / "sec-terminal-wealth-queue-v5.json"
INVENTORY_PATH = ROOT / "reports" / "early-detection" / "sec-terminal-wealth-original-inventory-v4.json"
OUTPUT_PATH = ROOT / "reports" / "early-detection" / "sec-form15-structured-metadata-v1.json"
SCRIPT_PATH = Path(__file__).resolve()
TEST_PATH = ROOT / "tests" / "build-sec-form15-structured-metadata-v1.test.js"

AUTHORIZED_REMOTE = "https://github.com/Karlryl/screener-data.git"
AUTHORIZED_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
SOURCE_COMMIT = "ea03e44d8ce805a08c4dc627caafc7080357b40f"
QUEUE_RAW_SHA256 = "cfc6b1c98e159e0d086bdad72a495ebe1c34b208975f145a8f96f903ada8798e"
QUEUE_REPORT_SHA256 = "a840de2297de3a04afc1f1bcb76139fb36297369b6765f73683db9bc2a92e825"
INVENTORY_RAW_SHA256 = "7a2947b66b9cdc26e829d19a4342b7effbbcea1c8296ca0bc46d4e05217c9711"
INVENTORY_REPORT_SHA256 = "b52b25d27e826872c83d920c3976a6aa9185c337ac48620e85ffbf323d550ab2"
BLOB_TREE_SEQUENCE_SHA256 = "47b24e7e3fefe343656eaee8b256cf0a4978c3b9e39d3d1932a4265ad976ed4f"
OUTPUT_SCHEMA = "early-detection-sec-form15-structured-metadata/v1"

ALLOWED_FORMS = {
    "15-12B", "15-12B/A", "15-12G", "15-12G/A", "15-15D", "15-15D/A",
    "15F-12B", "15F-12B/A", "15F-12G", "15F-12G/A", "15F-15D", "15F-15D/A",
}
ALL_FIELDS = ("issuerCik", "issuerName", "securityTitleClass", "formSubtype", "filingDate")
FIELD_STATUSES = {"PRESENT", "MISSING", "AMBIGUOUS_DUPLICATE", "AMBIGUOUS_CONFLICT", "UNAVAILABLE"}
PARSE_STATUSES = {
    "TEXTUAL_FORM_DOCUMENT_PRESENT", "TEXTUAL_FORM_DOCUMENT_MISSING", "SGML_MALFORMED",
    "SOURCE_AMBIGUOUS_INVENTORY",
}
CANDIDATE_KINDS = {
    "TERMINATION_LANGUAGE", "WITHDRAWAL_LANGUAGE", "EFFECTIVE_LANGUAGE",
    "PAYMENT_OR_TERMINAL_LANGUAGE",
}

SEC_HEADER_START_RE = re.compile(rb"(?m)^<SEC-HEADER>[^\r\n]*\r?$")
SEC_HEADER_END_RE = re.compile(rb"(?m)^</SEC-HEADER>\r?$")
ACCESSION_FIELD_RE = re.compile(rb"(?m)^ACCESSION NUMBER:[ \t]*([0-9]{10}-[0-9]{2}-[0-9]{6})[ \t]*\r?$")
DOCUMENT_START_RE = re.compile(rb"(?m)^<DOCUMENT>[ \t]*\r?$")
DOCUMENT_END_RE = re.compile(rb"(?m)^</DOCUMENT>[ \t]*\r?$")
DOCUMENT_BLOCK_RE = re.compile(rb"(?ms)^<DOCUMENT>[ \t]*\r?$.*?^</DOCUMENT>[ \t]*\r?$")
TEXT_START_RE = re.compile(rb"(?m)^<TEXT>[ \t]*\r?$")
TEXT_END_RE = re.compile(rb"(?m)^</TEXT>[ \t]*\r?$")
HEX64_RE = re.compile(r"^[0-9a-f]{64}$")
SCRIPT_STYLE_RE = re.compile(r"(?is)<(?:script|style)\b[^>]*>.*?</(?:script|style)\s*>")
COMMENT_RE = re.compile(r"(?s)<!--.*?-->")
TAG_RE = re.compile(r"(?s)<[^<>]{0,65536}>")
DATE_8_RE = re.compile(r"^[0-9]{8}$")
BINARY_DOCUMENT_TYPES = {"GRAPHIC", "PDF", "ZIP", "EXCEL", "XLS", "XLSX"}
BINARY_FILENAME_SUFFIXES = {
    ".bmp", ".gif", ".ico", ".jpeg", ".jpg", ".pdf", ".png", ".tif", ".tiff",
    ".xls", ".xlsx", ".zip",
}
SECURITY_LABEL_RE = re.compile(
    r"^\(?titles? of (?:(?:each|all) )?(?:class|classes) of securities "
    r"(?:covered by|to which|for which) this form(?: relates)?\)?$",
    re.IGNORECASE,
)
PREVIOUS_FORM_LABEL_RE = re.compile(
    r"^\(?(?:address, including|exact name of registrant|name and address of agent)", re.IGNORECASE
)
TERMINATION_RE = re.compile(
    r"\b(?:termination of (?:registration|the duty to file reports)|terminate(?:s|d|ing)? "
    r"(?:its|the)?\s*(?:registration|duty to file reports))\b",
    re.IGNORECASE,
)
WITHDRAWAL_RE = re.compile(r"\b(?:withdrawal|withdrawn|withdraws?|withdrawing|rescinds?|rescission)\b", re.IGNORECASE)
EFFECTIVE_RE = re.compile(
    r"\b(?:shall become|becomes?|became|is|was) effective\b|\beffective "
    r"(?:on|as of|upon|immediately)\b|\beffectiveness\b",
    re.IGNORECASE,
)
PAYMENT_TRIGGER_RE = re.compile(
    r"\b(?:right to receive|converted into|exchange(?:d)? for|merger consideration|"
    r"liquidation distribution|cash payment|distribution of|terminal value|final distribution)\b",
    re.IGNORECASE,
)
AMOUNT_RE = re.compile(
    r"(?:(?:U\.S\.|US)\s*)?\$\s*[0-9]+(?:\.[0-9]+)?|"
    r"\b[0-9]+(?:\.[0-9]+)?\s+(?:of a\s+)?shares?\b|"
    r"\b[0-9]+(?:\.[0-9]+)?\s+(?:in cash\s+)?per share\b",
    re.IGNORECASE,
)


class MetadataError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise MetadataError(message)


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def exact_keys(value: dict, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        fail(f"{label} keyset changed")


def git_bytes(*args: str) -> bytes:
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True).stdout


def git_text(*args: str) -> str:
    return git_bytes(*args).decode("utf-8").strip()


def require_current_remote_snapshot() -> str:
    if git_text("remote", "get-url", "origin") != AUTHORIZED_REMOTE:
        fail("repository remote changed")
    head = git_text("rev-parse", "HEAD")
    upstream = git_text("rev-parse", "@{upstream}")
    lines = git_text("ls-remote", "origin", AUTHORIZED_REF).splitlines()
    if len(lines) != 1:
        fail("authorized remote ref is not unique")
    remote_head = lines[0].split()[0]
    if head != upstream or head != remote_head:
        fail("local/upstream/remote checkpoint mismatch")
    if subprocess.run(
        ["git", "merge-base", "--is-ancestor", SOURCE_COMMIT, head], cwd=ROOT,
        check=False, capture_output=True,
    ).returncode != 0:
        fail("authorized source snapshot is not an ancestor of the build commit")
    return head


def bind_implementation(build_commit: str) -> dict:
    source_inputs = {
        "queueRawSha256": (QUEUE_PATH, QUEUE_RAW_SHA256),
        "inventoryRawSha256": (INVENTORY_PATH, INVENTORY_RAW_SHA256),
    }
    for label, (path, expected) in source_inputs.items():
        raw = path.read_bytes()
        if sha256(raw) != expected:
            fail(f"{label} local bytes changed")
        relative = path.relative_to(ROOT).as_posix()
        if git_bytes("show", f"{SOURCE_COMMIT}:{relative}") != raw:
            fail(f"{label} is not bound by the authorized source commit")
        if git_bytes("show", f"{build_commit}:{relative}") != raw:
            fail(f"{label} changed after the authorized source commit")
    result = {
        "sourceCommit": SOURCE_COMMIT,
        "buildCommit": build_commit,
        "remote": AUTHORIZED_REMOTE,
        "ref": AUTHORIZED_REF,
    }
    for label, path in {
        "contractRawSha256": CONTRACT_PATH,
        "builderRawSha256": SCRIPT_PATH,
        "testRawSha256": TEST_PATH,
    }.items():
        raw = path.read_bytes()
        relative = path.relative_to(ROOT).as_posix()
        committed_raw = git_bytes("show", f"{build_commit}:{relative}")
        # Git's configured CRLF checkout must not invalidate the immutable Git
        # object. Only that reversible newline transport is accepted.
        if raw != committed_raw and raw.replace(b"\r\n", b"\n") != committed_raw:
            fail(f"build commit does not bind {path.name}")
        result[label] = sha256(committed_raw)
    if result["contractRawSha256"] != CONTRACT_RAW_SHA256:
        fail("implementation contract binding changed")
    return result


def validate_claim_locks(locks: dict, expected: dict) -> None:
    if locks != expected or any(value is not False for value in locks.values()):
        fail("claim locks changed")


def load_contract() -> tuple[dict, bytes]:
    raw = CONTRACT_PATH.read_bytes()
    if sha256(raw) != CONTRACT_RAW_SHA256:
        fail("contract raw binding changed")
    value = json.loads(raw)
    exact_keys(value, {
        "schema", "createdAt", "taskId", "track", "authorizedSnapshot", "queueInput",
        "inventoryInput", "blobInput", "population", "parserPolicy", "fieldStatuses",
        "authorizedImplementation", "claimLocks",
    }, "contract")
    if value["schema"] != "early-detection-sec-form15-structured-metadata-contract/v1":
        fail("contract schema changed")
    if value["authorizedSnapshot"] != {
        "remote": AUTHORIZED_REMOTE, "ref": AUTHORIZED_REF, "commit": SOURCE_COMMIT,
    }:
        fail("authorized source snapshot changed")
    if set(value["queueInput"]["allowedForms"]) != ALLOWED_FORMS:
        fail("Form-15 allowed-form population changed")
    if value["population"] != {
        "selector": "EVENT_CLASS_EQUALS_DEREGISTRATION_FORM15_CANDIDATE_AND_FORM_IN_ALLOWED_FORMS",
        "joinKey": "EXACT_ROW_ID_THEN_EXACT_ACCESSION", "tickerJoinAllowed": False,
        "oneOutputRowPerForm15QueueRow": True, "ambiguousInventoryBlobSelectionAllowed": False,
    }:
        fail("population policy changed")
    if set(value["fieldStatuses"]) != FIELD_STATUSES:
        fail("field status vocabulary changed")
    if set(value["parserPolicy"]["candidateKinds"]) != CANDIDATE_KINDS:
        fail("candidate vocabulary changed")
    expected_locks = {
        "originalV4GateCredit": False, "terminalWealthComplete": False,
        "lastTradingSessionProven": False, "terminalPaymentVerified": False,
        "identityResolved": False, "form15LegalEffectVerified": False,
        "resultComputationAllowed": False, "outcomesAccessed": False,
    }
    validate_claim_locks(value["claimLocks"], expected_locks)
    return value, raw


def sec_header(raw: bytes) -> tuple[bytes, str]:
    starts = list(SEC_HEADER_START_RE.finditer(raw))
    ends = list(SEC_HEADER_END_RE.finditer(raw))
    if len(starts) != 1 or len(ends) != 1 or starts[0].end() >= ends[0].start():
        fail("SEC original must have exactly one ordered SEC-HEADER block")
    header = raw[starts[0].start():ends[0].end()]
    accessions = list(ACCESSION_FIELD_RE.finditer(header))
    if len(accessions) != 1:
        fail("SEC-HEADER must contain exactly one accession field")
    return header, accessions[0].group(1).decode("ascii")


def unique_line_field(raw: bytes, label: bytes) -> str:
    pattern = re.compile(rb"(?m)^<" + re.escape(label) + rb">([^\r\n]+)\r?$")
    values = pattern.findall(raw)
    if len(values) != 1:
        fail(f"SGML document must contain exactly one {label.decode('ascii')} field")
    return values[0].decode("latin-1").strip()


def extract_documents(raw: bytes) -> list[dict]:
    starts = list(DOCUMENT_START_RE.finditer(raw))
    ends = list(DOCUMENT_END_RE.finditer(raw))
    blocks = list(DOCUMENT_BLOCK_RE.finditer(raw))
    if not starts or len(starts) != len(ends) or len(blocks) != len(starts):
        fail("malformed SGML DOCUMENT boundaries")
    documents = []
    for index, match in enumerate(blocks, start=1):
        block = match.group(0)
        text_starts = list(TEXT_START_RE.finditer(block))
        text_ends = list(TEXT_END_RE.finditer(block))
        if len(text_starts) != 1 or len(text_ends) != 1 or text_starts[0].end() >= text_ends[0].start():
            fail("SGML document must contain exactly one ordered TEXT block")
        header_part = block[:text_starts[0].start()]
        documents.append({
            "index": index,
            "type": unique_line_field(header_part, b"TYPE"),
            "sequence": unique_line_field(header_part, b"SEQUENCE"),
            "filename": unique_line_field(header_part, b"FILENAME"),
            "raw": block,
            "textRaw": block[text_starts[0].end():text_ends[0].start()].strip(b"\r\n"),
        })
    return documents


def normalize_text(value: str) -> str:
    return " ".join(html.unescape(value).split())


class _TextSink(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


class _LineSink(HTMLParser):
    BLOCKS = {"br", "div", "p", "td", "tr", "li", "h1", "h2", "h3", "h4", "center"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() in self.BLOCKS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in self.BLOCKS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def _fallback_text(decoded: str, line_mode: bool) -> str:
    stripped = SCRIPT_STYLE_RE.sub(" ", decoded)
    stripped = COMMENT_RE.sub(" ", stripped)
    replacement = "\n" if line_mode else " "
    return TAG_RE.sub(replacement, stripped)


def normalized_document_text(raw: bytes) -> tuple[str, str]:
    decoded = raw.decode("latin-1")
    sink = _TextSink()
    try:
        sink.feed(decoded)
        sink.close()
    except (AssertionError, ValueError):
        return normalize_text(_fallback_text(decoded, False)), "CONSERVATIVE_TAG_STRIP_FALLBACK"
    return normalize_text(" ".join(sink.parts)), "HTML_PARSER"


def document_text_lines(raw: bytes) -> tuple[list[str], str]:
    decoded = raw.decode("latin-1")
    sink = _LineSink()
    try:
        sink.feed(decoded)
        sink.close()
        value = "".join(sink.parts)
        mode = "HTML_PARSER"
    except (AssertionError, ValueError):
        value = _fallback_text(decoded, True)
        mode = "CONSERVATIVE_TAG_STRIP_FALLBACK"
    return [line for raw_line in value.splitlines() if (line := normalize_text(raw_line))], mode


def is_textual_document(document: dict) -> bool:
    return (
        document["type"].upper() not in BINARY_DOCUMENT_TYPES
        and Path(document["filename"]).suffix.lower() not in BINARY_FILENAME_SUFFIXES
    )


def source_ref(blob_ref: dict, document: dict, locator_kind: str, locator: str, evidence: str,
               normalization_mode: str = "NOT_APPLICABLE") -> dict:
    return {
        "blobSha256": blob_ref["blobSha256"],
        "relativePath": blob_ref["relativePath"],
        "documentIndex": document["index"],
        "documentType": document["type"],
        "documentSequence": document["sequence"],
        "documentFilename": document["filename"],
        "rawDocumentSha256": sha256(document["raw"]),
        "rawTextSha256": sha256(document["textRaw"]),
        "locatorKind": locator_kind,
        "locator": locator,
        "normalizationMode": normalization_mode,
        "evidenceSha256": sha256(evidence.encode("utf-8")),
    }


def empty_field(status: str) -> dict:
    return {"status": status, "value": None, "evidence": []}


def field_from_evidence(evidence: list[dict]) -> dict:
    if not evidence:
        return empty_field("MISSING")
    values = {item["value"] for item in evidence}
    if len(values) == 1:
        return {"status": "PRESENT", "value": next(iter(values)), "evidence": evidence}
    return {"status": "AMBIGUOUS_CONFLICT", "value": None, "evidence": evidence}


def header_field(header: bytes, blob_ref: dict, header_doc: dict, label: str, transform=None) -> dict:
    pattern = re.compile(rb"(?m)^[ \t]*" + re.escape(label.encode("ascii")) + rb":[ \t]*(.*?)[ \t]*\r?$")
    evidence = []
    for index, match in enumerate(pattern.finditer(header), start=1):
        value = normalize_text(match.group(1).decode("latin-1"))
        if transform is not None:
            value = transform(value)
        if value:
            evidence.append({
                "value": value,
                "sourceRef": source_ref(
                    blob_ref, header_doc, "SEC_HEADER_LINE", f"{label}[{index}]", value,
                ),
            })
    return field_from_evidence(evidence)


def filer_pairs(header: bytes, blob_ref: dict, header_doc: dict) -> list[dict]:
    markers = list(re.finditer(rb"(?m)^FILER:[ \t]*\r?$", header))
    pairs = []
    for filer_index, marker in enumerate(markers, start=1):
        end = markers[filer_index].start() if filer_index < len(markers) else len(header)
        block = header[marker.end():end]
        cik_matches = list(re.finditer(rb"(?m)^[ \t]*CENTRAL INDEX KEY:[ \t]*(.*?)[ \t]*\r?$", block))
        name_matches = list(re.finditer(rb"(?m)^[ \t]*COMPANY CONFORMED NAME:[ \t]*(.*?)[ \t]*\r?$", block))
        if len(cik_matches) != 1 or len(name_matches) != 1:
            continue
        cik = normalize_cik(normalize_text(cik_matches[0].group(1).decode("latin-1")))
        name = normalize_text(name_matches[0].group(1).decode("latin-1"))
        if not name:
            continue
        pairs.append({
            "cik": cik,
            "name": name,
            "cikEvidence": {
                "value": cik,
                "sourceRef": source_ref(
                    blob_ref, header_doc, "SEC_HEADER_LINE",
                    f"FILER[{filer_index}]/CENTRAL INDEX KEY", cik,
                ),
            },
            "nameEvidence": {
                "value": name,
                "sourceRef": source_ref(
                    blob_ref, header_doc, "SEC_HEADER_LINE",
                    f"FILER[{filer_index}]/COMPANY CONFORMED NAME", name,
                ),
            },
        })
    return pairs


def normalize_cik(value: str) -> str:
    if not re.fullmatch(r"[0-9]{1,10}", value):
        fail("SEC header CIK is malformed")
    return value.zfill(10)


def normalize_filing_date(value: str) -> str:
    if not DATE_8_RE.fullmatch(value):
        fail("SEC header filing date is malformed")
    return datetime.strptime(value, "%Y%m%d").date().isoformat()


def security_title_field(documents: list[dict], blob_ref: dict) -> dict:
    evidence = []
    for document in documents:
        if document["type"].upper() not in ALLOWED_FORMS or not is_textual_document(document):
            continue
        lines, mode = document_text_lines(document["textRaw"])
        label_spans = []
        for label_start in range(len(lines)):
            combined = ""
            for label_end in range(label_start, min(len(lines), label_start + 4)):
                combined = normalize_text(combined + " " + lines[label_end])
                if SECURITY_LABEL_RE.fullmatch(combined):
                    label_spans.append((label_start, label_end))
                    break
        for label_start, label_end in label_spans:
            start = max(0, label_start - 1)
            for probe in range(label_start - 1, max(-1, label_start - 31), -1):
                if PREVIOUS_FORM_LABEL_RE.match(lines[probe]):
                    start = probe + 1
                    break
            selected = [
                item for item in lines[start:label_start]
                if not item.startswith("(") and len(item) <= 1000
            ]
            value = " | ".join(selected).strip(" |")
            if not value or len(value) > 5000:
                continue
            evidence.append({
                "value": value,
                "sourceRef": source_ref(
                    blob_ref, document, "NORMALIZED_TEXT_WINDOW",
                    f"lines[{start + 1}:{label_start}]/securityTitleLabel[{label_start + 1}:{label_end + 1}]",
                    value, mode,
                ),
            })
    return field_from_evidence(evidence)


def form_subtype_field(header: bytes, blob_ref: dict, header_doc: dict, documents: list[dict]) -> dict:
    field = header_field(header, blob_ref, header_doc, "CONFORMED SUBMISSION TYPE", str.upper)
    evidence = list(field["evidence"])
    for document in documents:
        value = document["type"].upper()
        if value in ALLOWED_FORMS:
            evidence.append({
                "value": value,
                "sourceRef": source_ref(blob_ref, document, "SGML_DOCUMENT_TYPE", "TYPE", value),
            })
    return field_from_evidence(evidence)


def candidate_snippets(documents: list[dict], blob_ref: dict) -> list[dict]:
    candidates = []
    seen: set[str] = set()
    patterns = (
        ("TERMINATION_LANGUAGE", TERMINATION_RE),
        ("WITHDRAWAL_LANGUAGE", WITHDRAWAL_RE),
        ("EFFECTIVE_LANGUAGE", EFFECTIVE_RE),
    )
    for document in documents:
        if not is_textual_document(document):
            continue
        normalized, mode = normalized_document_text(document["textRaw"])
        sentences = [item.strip() for item in re.split(r"(?<=[.!?])\s+", normalized) if item.strip()]
        for sentence_index, sentence in enumerate(sentences, start=1):
            if len(sentence) > 4000:
                continue
            matched_kinds = [kind for kind, pattern in patterns if pattern.search(sentence)]
            if PAYMENT_TRIGGER_RE.search(sentence) and AMOUNT_RE.search(sentence):
                matched_kinds.append("PAYMENT_OR_TERMINAL_LANGUAGE")
            for kind in matched_kinds:
                ref = source_ref(
                    blob_ref, document, "NORMALIZED_TEXT_SENTENCE",
                    f"sentence[{sentence_index}]/{kind}", sentence, mode,
                )
                candidate_id = sha256(canonical_bytes({"kind": kind, "text": sentence, "sourceRef": ref}))
                if candidate_id in seen:
                    continue
                seen.add(candidate_id)
                candidates.append({
                    "candidateId": candidate_id,
                    "kind": kind,
                    "verificationStatus": "CANDIDATE_ONLY",
                    "text": sentence,
                    "sourceRef": ref,
                })
    return candidates


def unavailable_metadata() -> dict:
    return {
        "parseStatus": "SOURCE_AMBIGUOUS_INVENTORY",
        "fields": {name: empty_field("UNAVAILABLE") for name in ALL_FIELDS},
        "candidateSnippets": [],
    }


def parse_blob(raw: bytes, blob_ref: dict, expected_accession: str) -> dict:
    if sha256(raw) != blob_ref["blobSha256"] or Path(blob_ref["relativePath"]).stem != blob_ref["blobSha256"]:
        fail("source blob hash binding changed")
    if len(raw) != blob_ref["bytes"]:
        fail("source blob byte length changed")
    header, accession = sec_header(raw)
    if accession != expected_accession:
        fail("source blob accession changed")
    header_doc = {
        "index": 0, "type": "SEC-HEADER", "sequence": "0", "filename": "SEC-HEADER",
        "raw": header, "textRaw": header,
    }
    try:
        documents = extract_documents(raw)
    except MetadataError:
        return {
            "parseStatus": "SGML_MALFORMED",
            "fields": {name: empty_field("UNAVAILABLE") for name in ALL_FIELDS},
            "candidateSnippets": [],
            "filerPairs": [],
        }
    textual_forms = [
        document for document in documents
        if document["type"].upper() in ALLOWED_FORMS and is_textual_document(document)
    ]
    pairs = filer_pairs(header, blob_ref, header_doc)
    fields = {
        "issuerCik": field_from_evidence([item["cikEvidence"] for item in pairs]),
        "issuerName": field_from_evidence([item["nameEvidence"] for item in pairs]),
        "securityTitleClass": security_title_field(documents, blob_ref),
        "formSubtype": form_subtype_field(header, blob_ref, header_doc, documents),
        "filingDate": header_field(header, blob_ref, header_doc, "FILED AS OF DATE", normalize_filing_date),
    }
    return {
        "parseStatus": "TEXTUAL_FORM_DOCUMENT_PRESENT" if textual_forms else "TEXTUAL_FORM_DOCUMENT_MISSING",
        "fields": fields,
        "candidateSnippets": candidate_snippets(documents, blob_ref),
        "filerPairs": pairs,
    }


def build_row(queue_row: dict, inventory_row: dict, parsed: dict | None) -> dict:
    if queue_row["rowId"] != inventory_row["rowId"] or queue_row["accession"] != inventory_row["accession"]:
        fail("rowId/accession join mismatch")
    if queue_row.get("eventClass") != "DEREGISTRATION_FORM15_CANDIDATE" or queue_row["form"] not in ALLOWED_FORMS:
        fail("non-Form-15 row entered metadata population")
    if inventory_row["inventoryStatus"] == "LOCAL_PRIMARY_PRESENT":
        if len(inventory_row["blobRefs"]) != 1 or parsed is None:
            fail("local primary row lacks exactly one parsed source")
        source_blob = copy.deepcopy(inventory_row["blobRefs"][0])
        metadata = parsed
    elif inventory_row["inventoryStatus"] == "AMBIGUOUS_MULTIPLE_LOCAL_BLOBS":
        if parsed is not None:
            fail("ambiguous source was parsed or selected")
        source_blob = None
        metadata = unavailable_metadata()
    else:
        fail("unexpected Form-15 inventory status")
    fields = metadata["fields"]
    matching_pairs = [item for item in metadata.get("filerPairs", []) if item["cik"] == queue_row["cik"]]
    if matching_pairs:
        fields["issuerCik"] = field_from_evidence([item["cikEvidence"] for item in matching_pairs])
        fields["issuerName"] = field_from_evidence([item["nameEvidence"] for item in matching_pairs])
    if fields["issuerCik"]["status"] == "PRESENT" and fields["issuerCik"]["value"] != queue_row["cik"]:
        fail("document CIK conflicts with queue CIK")
    if fields["filingDate"]["status"] == "PRESENT" and fields["filingDate"]["value"] != queue_row["filedDate"]:
        fail("document filing date conflicts with queue filing date")
    if fields["formSubtype"]["status"] == "PRESENT" and fields["formSubtype"]["value"] != queue_row["form"]:
        fail("document form subtype conflicts with queue form")
    missingness = sorted(name for name, field in fields.items() if field["status"] == "MISSING")
    ambiguities = sorted(name for name, field in fields.items() if field["status"].startswith("AMBIGUOUS"))
    if metadata["parseStatus"] == "SOURCE_AMBIGUOUS_INVENTORY":
        ambiguities.insert(0, "sourceBlob")
    return {
        "rowId": queue_row["rowId"],
        "priorityRank": queue_row["priorityRank"],
        "accession": queue_row["accession"],
        "form": queue_row["form"],
        "queueFiledDate": queue_row["filedDate"],
        "inventoryStatus": inventory_row["inventoryStatus"],
        "sourceBlob": source_blob,
        "parseStatus": metadata["parseStatus"],
        "fields": fields,
        "candidateSnippets": metadata["candidateSnippets"],
        "missingness": missingness,
        "ambiguities": ambiguities,
        "outcomesAccessed": False,
    }


def validate_source_ref(ref: dict) -> None:
    exact_keys(ref, {
        "blobSha256", "relativePath", "documentIndex", "documentType", "documentSequence",
        "documentFilename", "rawDocumentSha256", "rawTextSha256", "locatorKind", "locator",
        "normalizationMode", "evidenceSha256",
    }, "sourceRef")
    for name in ("blobSha256", "rawDocumentSha256", "rawTextSha256", "evidenceSha256"):
        if not isinstance(ref[name], str) or not HEX64_RE.fullmatch(ref[name]):
            fail(f"sourceRef {name} is not a SHA-256")
    if Path(ref["relativePath"]).stem != ref["blobSha256"]:
        fail("sourceRef path/hash mismatch")
    if not isinstance(ref["documentIndex"], int) or ref["documentIndex"] < 0:
        fail("sourceRef document index invalid")
    modes = {
        "SEC_HEADER_LINE": {"NOT_APPLICABLE"},
        "SGML_DOCUMENT_TYPE": {"NOT_APPLICABLE"},
        "NORMALIZED_TEXT_WINDOW": {"HTML_PARSER", "CONSERVATIVE_TAG_STRIP_FALLBACK"},
        "NORMALIZED_TEXT_SENTENCE": {"HTML_PARSER", "CONSERVATIVE_TAG_STRIP_FALLBACK"},
    }
    if ref["locatorKind"] not in modes or ref["normalizationMode"] not in modes[ref["locatorKind"]]:
        fail("sourceRef locator or normalization mode invalid")
    if not all(isinstance(ref[name], str) and ref[name] for name in (
        "documentType", "documentSequence", "documentFilename", "locator",
    )):
        fail("sourceRef string locator missing")


def validate_field(name: str, field: dict) -> None:
    exact_keys(field, {"status", "value", "evidence"}, f"field {name}")
    if field["status"] not in FIELD_STATUSES or not isinstance(field["evidence"], list):
        fail(f"field {name} status invalid")
    for evidence in field["evidence"]:
        exact_keys(evidence, {"value", "sourceRef"}, f"field {name} evidence")
        if not isinstance(evidence["value"], str) or not evidence["value"]:
            fail(f"field {name} evidence value missing")
        validate_source_ref(evidence["sourceRef"])
        if evidence["sourceRef"]["evidenceSha256"] != sha256(evidence["value"].encode("utf-8")):
            fail(f"field {name} evidence hash changed")
    if field["status"] == "PRESENT":
        if not field["evidence"] or {item["value"] for item in field["evidence"]} != {field["value"]}:
            fail(f"present field {name} lacks agreeing evidence")
    elif field["value"] is not None:
        fail(f"non-present field {name} has a promoted value")
    if field["status"] in {"MISSING", "UNAVAILABLE"} and field["evidence"]:
        fail(f"empty field {name} has evidence")
    if field["status"] == "AMBIGUOUS_DUPLICATE" and (
        len(field["evidence"]) < 2 or len({item["value"] for item in field["evidence"]}) != 1
    ):
        fail(f"duplicate ambiguity {name} invalid")
    if field["status"] == "AMBIGUOUS_CONFLICT" and len({item["value"] for item in field["evidence"]}) < 2:
        fail(f"conflict ambiguity {name} invalid")


def validate_candidate(candidate: dict) -> None:
    exact_keys(candidate, {"candidateId", "kind", "verificationStatus", "text", "sourceRef"}, "candidate")
    if candidate["kind"] not in CANDIDATE_KINDS or candidate["verificationStatus"] != "CANDIDATE_ONLY":
        fail("language snippet was promoted beyond candidate-only evidence")
    if not isinstance(candidate["text"], str) or not candidate["text"]:
        fail("candidate text missing")
    validate_source_ref(candidate["sourceRef"])
    expected = sha256(canonical_bytes({
        "kind": candidate["kind"], "text": candidate["text"], "sourceRef": candidate["sourceRef"],
    }))
    if candidate["candidateId"] != expected:
        fail("candidate id changed")


def validate_row_shape(row: dict) -> None:
    exact_keys(row, {
        "rowId", "priorityRank", "accession", "form", "queueFiledDate", "inventoryStatus",
        "sourceBlob", "parseStatus", "fields", "candidateSnippets", "missingness", "ambiguities",
        "outcomesAccessed",
    }, "metadata row")
    if row["outcomesAccessed"] is not False or row["parseStatus"] not in PARSE_STATUSES:
        fail("row outcome or parse lock changed")
    if row["form"] not in ALLOWED_FORMS or set(row["fields"]) != set(ALL_FIELDS):
        fail("row population or field set changed")
    for name, field in row["fields"].items():
        validate_field(name, field)
    for candidate in row["candidateSnippets"]:
        validate_candidate(candidate)
    expected_missing = sorted(name for name, field in row["fields"].items() if field["status"] == "MISSING")
    expected_ambiguous = sorted(name for name, field in row["fields"].items() if field["status"].startswith("AMBIGUOUS"))
    if row["parseStatus"] == "SOURCE_AMBIGUOUS_INVENTORY":
        expected_ambiguous.insert(0, "sourceBlob")
        if row["sourceBlob"] is not None or row["inventoryStatus"] != "AMBIGUOUS_MULTIPLE_LOCAL_BLOBS":
            fail("ambiguous source was selected")
    else:
        exact_keys(row["sourceBlob"], {"blobSha256", "bytes", "relativePath"}, "sourceBlob")
        if not HEX64_RE.fullmatch(row["sourceBlob"]["blobSha256"]):
            fail("sourceBlob hash missing")
        if Path(row["sourceBlob"]["relativePath"]).stem != row["sourceBlob"]["blobSha256"]:
            fail("sourceBlob path/hash mismatch")
    if row["missingness"] != expected_missing or row["ambiguities"] != expected_ambiguous:
        fail("row missingness/ambiguity ledger changed")


def load_bound_json(path: Path, raw_sha: str, report_sha: str) -> tuple[dict, bytes]:
    raw = path.read_bytes()
    if sha256(raw) != raw_sha:
        fail(f"{path.name} raw binding changed")
    value = json.loads(raw)
    if value.get("reportSha256") != report_sha:
        fail(f"{path.name} self binding changed")
    return value, raw


def validate_output(payload: dict, expected_rows: list[dict], contract: dict,
                    implementation: dict, input_bindings: dict) -> None:
    exact_keys(payload, {
        "schema", "track", "taskId", "inputBindings", "implementationBindings", "population",
        "parseStatusCounts", "fieldStatusCounts", "candidateKindCounts", "candidateSnippetCount",
        "claimLocks", "rows", "reportSha256",
    }, "output")
    if payload["schema"] != OUTPUT_SCHEMA:
        fail("output schema changed")
    if payload["inputBindings"] != input_bindings or payload["implementationBindings"] != implementation:
        fail("output binding changed")
    validate_claim_locks(payload["claimLocks"], contract["claimLocks"])
    if payload["rows"] != expected_rows or len(payload["rows"]) != 17067:
        fail("Form-15 denominator or source-derived rows changed")
    if len({row["rowId"] for row in payload["rows"]}) != len(payload["rows"]):
        fail("duplicate metadata rowId")
    parse_counts = {status: 0 for status in sorted(PARSE_STATUSES)}
    field_counts = {name: {status: 0 for status in sorted(FIELD_STATUSES)} for name in ALL_FIELDS}
    candidate_counts = {kind: 0 for kind in sorted(CANDIDATE_KINDS)}
    for row in payload["rows"]:
        validate_row_shape(row)
        parse_counts[row["parseStatus"]] += 1
        for name, field in row["fields"].items():
            field_counts[name][field["status"]] += 1
        for candidate in row["candidateSnippets"]:
            candidate_counts[candidate["kind"]] += 1
    if payload["parseStatusCounts"] != parse_counts or payload["fieldStatusCounts"] != field_counts:
        fail("metadata count ledger changed")
    if payload["candidateKindCounts"] != candidate_counts:
        fail("candidate-kind ledger changed")
    if payload["candidateSnippetCount"] != sum(candidate_counts.values()):
        fail("candidate snippet count changed")
    expected_sha = sha256(canonical_bytes({key: value for key, value in payload.items() if key != "reportSha256"}))
    if payload["reportSha256"] != expected_sha:
        fail("output self hash changed")


def build(blob_root: Path) -> dict:
    build_commit = require_current_remote_snapshot()
    implementation = bind_implementation(build_commit)
    contract, contract_raw = load_contract()
    queue, queue_raw = load_bound_json(QUEUE_PATH, QUEUE_RAW_SHA256, QUEUE_REPORT_SHA256)
    inventory, inventory_raw = load_bound_json(INVENTORY_PATH, INVENTORY_RAW_SHA256, INVENTORY_REPORT_SHA256)
    if inventory.get("blobTreeSequenceSha256") != BLOB_TREE_SEQUENCE_SHA256:
        fail("inventory blob-tree binding changed")
    if len(queue.get("rows", [])) != 44352 or len(inventory.get("rows", [])) != 44352:
        fail("queue/inventory denominator changed")
    form_rows = [
        row for row in queue["rows"]
        if row.get("eventClass") == "DEREGISTRATION_FORM15_CANDIDATE" and row.get("form") in ALLOWED_FORMS
    ]
    if len(form_rows) != 17067 or len({row["accession"] for row in form_rows}) != 12923:
        fail("Form-15 population changed")
    inventory_by_row_id = {row["rowId"]: row for row in inventory["rows"]}
    if len(inventory_by_row_id) != len(inventory["rows"]):
        fail("inventory duplicate rowId")
    inventory_counts = {"LOCAL_PRIMARY_PRESENT": 0, "AMBIGUOUS_MULTIPLE_LOCAL_BLOBS": 0, "FETCH_REQUIRED": 0}
    parsed_cache: dict[str, dict] = {}
    rows = []
    for queue_row in form_rows:
        inventory_row = inventory_by_row_id.get(queue_row["rowId"])
        if inventory_row is None:
            fail("Form-15 row missing from inventory")
        inventory_counts[inventory_row["inventoryStatus"]] += 1
        parsed = None
        if inventory_row["inventoryStatus"] == "LOCAL_PRIMARY_PRESENT":
            blob_ref = inventory_row["blobRefs"][0]
            digest = blob_ref["blobSha256"]
            if digest not in parsed_cache:
                path = blob_root / blob_ref["relativePath"]
                if not path.is_file():
                    fail("inventory source blob missing")
                parsed_cache[digest] = parse_blob(path.read_bytes(), blob_ref, queue_row["accession"])
            parsed = copy.deepcopy(parsed_cache[digest])
        row = build_row(queue_row, inventory_row, parsed)
        validate_row_shape(row)
        rows.append(row)
    if inventory_counts != {
        "LOCAL_PRIMARY_PRESENT": 17067, "AMBIGUOUS_MULTIPLE_LOCAL_BLOBS": 0, "FETCH_REQUIRED": 0,
    }:
        fail("Form-15 inventory status counts changed")
    input_bindings = {
        "authorizedSourceCommit": SOURCE_COMMIT,
        "contractRawSha256": sha256(contract_raw),
        "queueRawSha256": sha256(queue_raw),
        "queueReportSha256": queue["reportSha256"],
        "inventoryRawSha256": sha256(inventory_raw),
        "inventoryReportSha256": inventory["reportSha256"],
        "blobTreeSequenceSha256": inventory["blobTreeSequenceSha256"],
    }
    parse_counts = {status: 0 for status in sorted(PARSE_STATUSES)}
    field_counts = {name: {status: 0 for status in sorted(FIELD_STATUSES)} for name in ALL_FIELDS}
    candidate_counts = {kind: 0 for kind in sorted(CANDIDATE_KINDS)}
    for row in rows:
        parse_counts[row["parseStatus"]] += 1
        for name, field in row["fields"].items():
            field_counts[name][field["status"]] += 1
        for candidate in row["candidateSnippets"]:
            candidate_counts[candidate["kind"]] += 1
    payload = {
        "schema": OUTPUT_SCHEMA,
        "track": contract["track"],
        "taskId": contract["taskId"],
        "inputBindings": input_bindings,
        "implementationBindings": implementation,
        "population": {
            "rows": len(rows), "uniqueAccessions": len({row["accession"] for row in rows}),
            "inventoryStatusCounts": inventory_counts,
        },
        "parseStatusCounts": parse_counts,
        "fieldStatusCounts": field_counts,
        "candidateKindCounts": candidate_counts,
        "candidateSnippetCount": sum(candidate_counts.values()),
        "claimLocks": contract["claimLocks"],
        "rows": rows,
        "reportSha256": None,
    }
    payload["reportSha256"] = sha256(canonical_bytes({key: value for key, value in payload.items() if key != "reportSha256"}))
    validate_output(payload, rows, contract, implementation, input_bindings)
    if require_current_remote_snapshot() != build_commit or bind_implementation(build_commit) != implementation:
        fail("remote or implementation changed during metadata build")
    return payload


def atomic_write_new(path: Path, raw: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(mode="wb", dir=path.parent, prefix=path.name + ".", suffix=".tmp", delete=False) as handle:
            temp = Path(handle.name)
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.link(temp, path)
    except FileExistsError:
        fail("output already exists")
    finally:
        if temp is not None and temp.exists():
            temp.unlink()
    if path.read_bytes() != raw:
        fail("output readback mismatch")


def fixture_blob(body: str, form: str = "15-12B", exhibit: str = "",
                 exhibit_type: str = "EX-99", exhibit_filename: str = "notice.htm") -> tuple[bytes, dict, str]:
    accession = "0000000001-20-000001"
    raw = (
        f"<SEC-DOCUMENT>{accession}.txt : 20200102\n"
        f"<SEC-HEADER>{accession}.hdr.sgml : 20200102\n"
        f"ACCESSION NUMBER:\t\t{accession}\n"
        f"CONFORMED SUBMISSION TYPE:\t{form}\n"
        "FILED AS OF DATE:\t\t20200102\nFILER:\n\tCOMPANY DATA:\n"
        "\t\tCOMPANY CONFORMED NAME:\t\t\tTEST ISSUER\n"
        "\t\tCENTRAL INDEX KEY:\t\t\t0000000001\n</SEC-HEADER>\n"
        f"<DOCUMENT>\n<TYPE>{form}\n<SEQUENCE>1\n<FILENAME>form15.htm\n<TEXT>\n{body}\n</TEXT>\n</DOCUMENT>\n"
        f"<DOCUMENT>\n<TYPE>{exhibit_type}\n<SEQUENCE>2\n<FILENAME>{exhibit_filename}\n<TEXT>\n{exhibit}\n</TEXT>\n</DOCUMENT>\n"
        "</SEC-DOCUMENT>\n"
    ).encode("utf-8")
    digest = sha256(raw)
    return raw, {"blobSha256": digest, "bytes": len(raw), "relativePath": f"{digest[:2]}/{digest}.txt"}, accession


def rejected(mutated: dict) -> bool:
    try:
        validate_row_shape(mutated)
    except MetadataError:
        return True
    return False


def self_test() -> dict:
    contract, _ = load_contract()
    body = (
        "<html><body><div>(Address, including zip code, and telephone number, including area code, of registrant's principal executive offices)</div>"
        "<div>Common Stock, par value $0.01 per share<br>Series A Preferred Stock</div>"
        "<div>(Title of each class of securities covered by this Form)</div>"
        "<p>The registrant terminates the duty to file reports.</p>"
        "<p>This notice shall become effective on January 2, 2020.</p>"
        "<p>The registrant withdraws its earlier notice.</p></body></html>"
    )
    exhibit = "Each holder has the right to receive $2.50 per share as a final distribution."
    raw, blob_ref, accession = fixture_blob(body, exhibit=exhibit)
    parsed = parse_blob(raw, blob_ref, accession)
    valid_exact = (
        parsed["parseStatus"] == "TEXTUAL_FORM_DOCUMENT_PRESENT"
        and parsed["fields"]["issuerCik"]["value"] == "0000000001"
        and parsed["fields"]["issuerName"]["value"] == "TEST ISSUER"
        and parsed["fields"]["formSubtype"]["value"] == "15-12B"
        and parsed["fields"]["filingDate"]["value"] == "2020-01-02"
        and parsed["fields"]["securityTitleClass"]["value"] == "Common Stock, par value $0.01 per share | Series A Preferred Stock"
        and {item["kind"] for item in parsed["candidateSnippets"]} == CANDIDATE_KINDS
        and all(item["verificationStatus"] == "CANDIDATE_ONLY" for item in parsed["candidateSnippets"])
    )
    mismatch_raw, mismatch_ref, mismatch_accession = fixture_blob(body, form="15-12B")
    mismatch_raw = mismatch_raw.replace(b"<TYPE>15-12B", b"<TYPE>15-12G", 1)
    mismatch_digest = sha256(mismatch_raw)
    mismatch_ref = {
        "blobSha256": mismatch_digest, "bytes": len(mismatch_raw),
        "relativePath": f"{mismatch_digest[:2]}/{mismatch_digest}.txt",
    }
    form_conflict = parse_blob(mismatch_raw, mismatch_ref, mismatch_accession)["fields"]["formSubtype"]["status"]
    duplicate_header = raw.replace(
        f"ACCESSION NUMBER:\t\t{accession}\n".encode(),
        f"ACCESSION NUMBER:\t\t{accession}\nACCESSION NUMBER:\t\t{accession}\n".encode(),
    )
    strict_header_rejected = False
    try:
        sec_header(duplicate_header)
    except MetadataError:
        strict_header_rejected = True
    malformed_raw, malformed_ref, malformed_accession = fixture_blob("<![YH >Visible malformed text.")
    malformed_parsed = parse_blob(malformed_raw, malformed_ref, malformed_accession)
    malformed_fallback = (
        malformed_parsed["parseStatus"] == "TEXTUAL_FORM_DOCUMENT_PRESENT"
        and normalized_document_text(b"<![YH >Visible malformed text.")
        == ("Visible malformed text.", "CONSERVATIVE_TAG_STRIP_FALLBACK")
    )
    graphic_raw, graphic_ref, graphic_accession = fixture_blob(
        body, exhibit="The registrant withdraws and each holder receives $999.00 per share.",
        exhibit_type="GRAPHIC", exhibit_filename="image.jpg",
    )
    graphic_parsed = parse_blob(graphic_raw, graphic_ref, graphic_accession)
    binary_excluded = (
        "PAYMENT_OR_TERMINAL_LANGUAGE" not in {item["kind"] for item in graphic_parsed["candidateSnippets"]}
        and len([item for item in graphic_parsed["candidateSnippets"] if item["kind"] == "WITHDRAWAL_LANGUAGE"]) == 1
    )
    queue_row = {
        "rowId": "SEC-TW-00000001", "priorityRank": 1, "accession": accession,
        "form": "15-12B", "filedDate": "2020-01-02", "cik": "0000000001",
        "eventClass": "DEREGISTRATION_FORM15_CANDIDATE",
    }
    inventory_row = {
        "rowId": queue_row["rowId"], "accession": accession, "inventoryStatus": "LOCAL_PRIMARY_PRESENT",
        "blobRefs": [blob_ref],
    }
    valid_row = build_row(queue_row, inventory_row, parsed)
    validate_row_shape(valid_row)
    ticker_mutation = copy.deepcopy(valid_row); ticker_mutation["ticker"] = "TEST"
    missing_hash_mutation = copy.deepcopy(valid_row); missing_hash_mutation["sourceBlob"]["blobSha256"] = ""
    promoted_candidate = copy.deepcopy(valid_row); promoted_candidate["candidateSnippets"][0]["verificationStatus"] = "VERIFIED"
    locks_mutation = copy.deepcopy(contract["claimLocks"]); locks_mutation["form15LegalEffectVerified"] = True
    false_claim_rejected = False
    try:
        validate_claim_locks(locks_mutation, contract["claimLocks"])
    except MetadataError:
        false_claim_rejected = True
    return {
        "status": "PASS",
        "contractRawBound": sha256(CONTRACT_PATH.read_bytes()) == CONTRACT_RAW_SHA256,
        "authorizedSourceCommitBound": contract["authorizedSnapshot"]["commit"] == SOURCE_COMMIT,
        "validExactExtractionAccepted": valid_exact,
        "formSubtypeConflictRejected": form_conflict == "AMBIGUOUS_CONFLICT",
        "strictSecHeaderRejected": strict_header_rejected,
        "malformedHtmlFallbackDeterministic": malformed_fallback,
        "binaryDocumentEvidenceRejected": binary_excluded,
        "tickerOnlyJoinMutationRejected": rejected(ticker_mutation),
        "missingSourceHashMutationRejected": rejected(missing_hash_mutation),
        "candidatePromotionMutationRejected": rejected(promoted_candidate),
        "falseClaimMutationRejected": false_claim_rejected,
        "outcomesAccessed": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--blob-root")
    parser.add_argument("--output", default=str(OUTPUT_PATH))
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    try:
        if args.self_test:
            result = self_test()
        else:
            if not args.blob_root:
                parser.error("--blob-root is required")
            payload = build(Path(args.blob_root))
            encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
            atomic_write_new(Path(args.output), encoded)
            result = {
                "status": "PASS", "rows": payload["population"]["rows"],
                "uniqueAccessions": payload["population"]["uniqueAccessions"],
                "candidateSnippetCount": payload["candidateSnippetCount"],
                "reportSha256": payload["reportSha256"], "outcomesAccessed": False,
            }
    except (MetadataError, OSError, ValueError, KeyError, subprocess.CalledProcessError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
