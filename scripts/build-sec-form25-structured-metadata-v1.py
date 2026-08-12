#!/usr/bin/env python3
"""Build outcome-blind, document-bound metadata from local SEC Form 25 originals."""
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
import xml.etree.ElementTree as ET
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "research" / "early-detection-v4" / "sec-form25-structured-metadata-contract-v1.json"
CONTRACT_RAW_SHA256 = "a73fc3bd80bac8cb2e7fc0c2a7d6e058432ff8571b678a278be4742b27b29e13"
QUEUE_PATH = ROOT / "reports" / "early-detection" / "sec-terminal-wealth-queue-v5.json"
INVENTORY_PATH = ROOT / "reports" / "early-detection" / "sec-terminal-wealth-original-inventory-v3.json"
OUTPUT_PATH = ROOT / "reports" / "early-detection" / "sec-form25-structured-metadata-v1.json"
SCRIPT_PATH = Path(__file__).resolve()
TEST_PATH = ROOT / "tests" / "build-sec-form25-structured-metadata-v1.test.js"
AUTHORIZED_REMOTE = "https://github.com/Karlryl/screener-data.git"
AUTHORIZED_REF = "refs/heads/codex/early-detection-v4-gates-20260810"

SEC_HEADER_START_RE = re.compile(rb"(?m)^<SEC-HEADER>[^\r\n]*\r?$")
SEC_HEADER_END_RE = re.compile(rb"(?m)^</SEC-HEADER>\r?$")
ACCESSION_FIELD_RE = re.compile(rb"(?m)^ACCESSION NUMBER:[ \t]*([0-9]{10}-[0-9]{2}-[0-9]{6})[ \t]*\r?$")
DOCUMENT_START_RE = re.compile(rb"(?m)^<DOCUMENT>[ \t]*\r?$")
DOCUMENT_END_RE = re.compile(rb"(?m)^</DOCUMENT>[ \t]*\r?$")
DOCUMENT_BLOCK_RE = re.compile(rb"(?ms)^<DOCUMENT>[ \t]*\r?$.*?^</DOCUMENT>[ \t]*\r?$")
TEXT_START_RE = re.compile(rb"(?m)^<TEXT>[ \t]*\r?$")
TEXT_END_RE = re.compile(rb"(?m)^</TEXT>[ \t]*\r?$")
XML_START_RE = re.compile(rb"(?m)^<XML>[ \t]*\r?$")
XML_END_RE = re.compile(rb"(?m)^</XML>[ \t]*\r?$")
XML_BLOCK_RE = re.compile(rb"(?ms)^<XML>[ \t]*\r?$\r?\n?(.*?)^</XML>[ \t]*\r?$")
HEX64_RE = re.compile(r"^[0-9a-f]{64}$")
DATE_TOKEN = (
    r"(?:January|February|March|April|May|June|July|August|September|October|November|December)"
    r"\s+[0-9]{1,2},\s+[0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2}"
)
SUSPENSION_RE = re.compile(
    rf"\b(?:was|were)\s+suspended\s+from\s+trading(?:\s+at\s+[^.;]{{0,120}})?\s+on\s+({DATE_TOKEN})\b",
    re.IGNORECASE,
)
OPENING_REMOVAL_RE = re.compile(rf"\bat\s+the\s+opening\s+of\s+business\s+on\s+({DATE_TOKEN})\b", re.IGNORECASE)
EFFECTIVE_REMOVAL_RE = re.compile(
    rf"\b(?:removal|remove|delisting)\b[^.;]{{0,180}}\b(?:effective|effectiveness)\b[^.;]{{0,80}}\b({DATE_TOKEN})\b",
    re.IGNORECASE,
)
CONSIDERATION_TRIGGER_RE = re.compile(
    r"\b(?:converted\s+into|right\s+to\s+receive|exchange(?:d)?\s+for|merger\s+consideration|"
    r"liquidation\s+distribution|cash\s+payment|distribution\s+of)\b",
    re.IGNORECASE,
)
CURRENCY_AMOUNT_RE = re.compile(r"(?:(?:U\.S\.|US)\s*)?\$\s*[0-9]+(?:\.[0-9]+)?", re.IGNORECASE)
SHARE_RATIO_RE = re.compile(r"\b[0-9]+(?:\.[0-9]+)?\s+(?:of\s+a\s+)?shares?\b", re.IGNORECASE)
PER_SHARE_RE = re.compile(r"\b[0-9]+(?:\.[0-9]+)?\s+(?:in\s+cash\s+)?per\s+share\b", re.IGNORECASE)

FIELD_PATHS = {
    "issuerCik": ("issuer", "cik"),
    "issuerName": ("issuer", "entityName"),
    "exchangeCik": ("exchange", "cik"),
    "exchangeName": ("exchange", "entityName"),
    "securityDescription": ("descriptionClassSecurity",),
    "ruleProvision": ("ruleProvision",),
    "signatureDate": ("signatureData", "signatureDate"),
}
TEXT_DATE_FIELDS = ("removalEffectiveDate", "suspensionDate")
ALL_FIELDS = tuple(FIELD_PATHS) + TEXT_DATE_FIELDS
FIELD_STATUSES = {"PRESENT", "MISSING", "AMBIGUOUS_DUPLICATE", "AMBIGUOUS_CONFLICT", "UNAVAILABLE"}
PARSE_STATUSES = {
    "STRUCTURED_XML_PRESENT", "XML_DOCUMENT_MISSING", "XML_DOCUMENT_MULTIPLE",
    "XML_MALFORMED", "SGML_MALFORMED", "SOURCE_AMBIGUOUS_INVENTORY",
}


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


def require_remote_snapshot() -> str:
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
    return head


def bind_implementation(base_commit: str) -> dict:
    paths = {
        "contractRawSha256": CONTRACT_PATH,
        "builderRawSha256": SCRIPT_PATH,
        "testRawSha256": TEST_PATH,
        "queueRawSha256": QUEUE_PATH,
        "inventoryRawSha256": INVENTORY_PATH,
    }
    result = {"baseCommit": base_commit, "remote": AUTHORIZED_REMOTE, "ref": AUTHORIZED_REF}
    for key, path in paths.items():
        raw = path.read_bytes()
        if git_bytes("show", f"{base_commit}:{path.relative_to(ROOT).as_posix()}") != raw:
            fail(f"base commit does not bind {path.name}")
        result[key] = sha256(raw)
    if result["contractRawSha256"] != CONTRACT_RAW_SHA256:
        fail("implementation contract binding changed")
    return result


def load_contract() -> tuple[dict, bytes]:
    raw = CONTRACT_PATH.read_bytes()
    if sha256(raw) != CONTRACT_RAW_SHA256:
        fail("contract raw binding changed")
    value = json.loads(raw)
    exact_keys(value, {
        "schema", "createdAt", "taskId", "track", "queueInput", "inventoryInput", "blobInput",
        "population", "parserPolicy", "fieldStatuses", "authorizedImplementation", "claimLocks",
    }, "contract")
    if value["schema"] != "early-detection-sec-form25-structured-metadata-contract/v1":
        fail("contract schema changed")
    if value["population"] != {
        "joinKey": "EXACT_ROW_ID_THEN_EXACT_ACCESSION", "tickerJoinAllowed": False,
        "oneOutputRowPerForm25QueueRow": True, "ambiguousInventoryBlobSelectionAllowed": False,
    }:
        fail("population policy changed")
    expected_locks = {
        "originalV4GateCredit": False, "terminalWealthComplete": False,
        "lastTradingSessionProven": False, "terminalPaymentVerified": False,
        "identityResolved": False, "resultComputationAllowed": False, "outcomesAccessed": False,
    }
    validate_claim_locks(value["claimLocks"], expected_locks)
    if set(value["fieldStatuses"]) != FIELD_STATUSES:
        fail("field status vocabulary changed")
    return value, raw


def validate_claim_locks(locks: dict, expected: dict) -> None:
    if locks != expected or any(item is not False for item in locks.values()):
        fail("claim locks changed")


def accession_from_sec_header(raw: bytes) -> str:
    starts = list(SEC_HEADER_START_RE.finditer(raw))
    ends = list(SEC_HEADER_END_RE.finditer(raw))
    if len(starts) != 1 or len(ends) != 1 or starts[0].end() >= ends[0].start():
        fail("SEC original must have exactly one ordered SEC-HEADER block")
    fields = list(ACCESSION_FIELD_RE.finditer(raw, starts[0].end(), ends[0].start()))
    if len(fields) != 1:
        fail("SEC-HEADER must contain exactly one accession field")
    return fields[0].group(1).decode("ascii")


def unique_line_field(raw: bytes, label: bytes) -> str:
    pattern = re.compile(rb"(?m)^<" + re.escape(label) + rb">([^\r\n]+)\r?$")
    matches = pattern.findall(raw)
    if len(matches) != 1:
        fail(f"SGML document must contain exactly one {label.decode('ascii')} field")
    return matches[0].decode("latin-1").strip()


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
        text_raw = block[text_starts[0].end():text_ends[0].start()].strip(b"\r\n")
        documents.append({
            "index": index,
            "type": unique_line_field(block[:text_starts[0].start()], b"TYPE"),
            "sequence": unique_line_field(block[:text_starts[0].start()], b"SEQUENCE"),
            "filename": unique_line_field(block[:text_starts[0].start()], b"FILENAME"),
            "raw": block,
            "textRaw": text_raw,
        })
    return documents


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def normalize_text(value: str) -> str:
    return " ".join(html.unescape(value).split())


class _TextSink(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def normalized_document_text(raw: bytes) -> str:
    sink = _TextSink()
    sink.feed(raw.decode("latin-1"))
    sink.close()
    return normalize_text(" ".join(sink.parts))


def source_ref(blob_ref: dict, document: dict, locator_kind: str, locator: str, evidence: str) -> dict:
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
        "evidenceSha256": sha256(evidence.encode("utf-8")),
    }


def empty_field(status: str) -> dict:
    return {"status": status, "value": None, "evidence": []}


def field_from_xml(root: ET.Element, path: tuple[str, ...], document: dict, blob_ref: dict) -> dict:
    nodes = [root]
    for segment in path:
        nodes = [child for node in nodes for child in list(node) if local_name(child.tag) == segment]
    evidence = []
    locator = "/notificationOfRemoval/" + "/".join(path)
    for index, node in enumerate(nodes, start=1):
        value = normalize_text("".join(node.itertext()))
        if not value:
            continue
        evidence.append({
            "value": value,
            "sourceRef": source_ref(blob_ref, document, "XML_PATH", f"{locator}[{index}]", value),
        })
    if not evidence:
        return empty_field("MISSING")
    if len(evidence) == 1:
        return {"status": "PRESENT", "value": evidence[0]["value"], "evidence": evidence}
    values = {item["value"] for item in evidence}
    status = "AMBIGUOUS_DUPLICATE" if len(values) == 1 else "AMBIGUOUS_CONFLICT"
    return {"status": status, "value": None, "evidence": evidence}


def parsed_iso_date(value: str) -> str | None:
    for pattern in ("%B %d, %Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(value.title() if pattern.startswith("%B") else value, pattern).date().isoformat()
        except ValueError:
            continue
    return None


def sentences_for_documents(documents: list[dict]) -> list[tuple[dict, int, str]]:
    values: list[tuple[dict, int, str]] = []
    for document in documents:
        normalized = normalized_document_text(document["textRaw"])
        sentences = [item.strip() for item in re.split(r"(?<=[.!?])\s+", normalized) if item.strip()]
        for index, sentence in enumerate(sentences, start=1):
            values.append((document, index, sentence))
    return values


def semantic_date_field(kind: str, sentence_values: list[tuple[dict, int, str]], blob_ref: dict) -> dict:
    evidence = []
    for document, sentence_index, sentence in sentence_values:
        matches: list[re.Match[str]] = []
        if kind == "suspensionDate":
            matches = list(SUSPENSION_RE.finditer(sentence))
        elif re.search(r"\bremov(?:e|al|ing)\b|\bdelisting\b", sentence, re.IGNORECASE):
            matches = list(OPENING_REMOVAL_RE.finditer(sentence)) + list(EFFECTIVE_REMOVAL_RE.finditer(sentence))
        for match_index, match in enumerate(matches, start=1):
            value = parsed_iso_date(match.group(1))
            if value is None:
                continue
            evidence.append({
                "value": value,
                "sourceRef": source_ref(
                    blob_ref, document, "NORMALIZED_TEXT_SENTENCE",
                    f"sentence[{sentence_index}]/{kind}[{match_index}]", sentence,
                ),
            })
    if not evidence:
        return empty_field("MISSING")
    unique = {item["value"] for item in evidence}
    if len(unique) == 1:
        return {"status": "PRESENT", "value": next(iter(unique)), "evidence": evidence}
    return {"status": "AMBIGUOUS_CONFLICT", "value": None, "evidence": evidence}


def candidate_snippets(sentence_values: list[tuple[dict, int, str]], blob_ref: dict) -> list[dict]:
    candidates = []
    for document, sentence_index, sentence in sentence_values:
        if not CONSIDERATION_TRIGGER_RE.search(sentence):
            continue
        if CURRENCY_AMOUNT_RE.search(sentence):
            signal = "CURRENCY_AMOUNT"
        elif PER_SHARE_RE.search(sentence):
            signal = "PER_SHARE_AMOUNT"
        elif SHARE_RATIO_RE.search(sentence):
            signal = "SHARE_RATIO"
        else:
            continue
        ref = source_ref(
            blob_ref, document, "NORMALIZED_TEXT_SENTENCE",
            f"sentence[{sentence_index}]/considerationPaymentCandidate", sentence,
        )
        candidate_id = sha256(canonical_bytes({"sourceRef": ref, "text": sentence, "amountSignal": signal}))
        candidates.append({
            "candidateId": candidate_id,
            "kind": "CONSIDERATION_OR_PAYMENT_TEXT",
            "verificationStatus": "CANDIDATE_ONLY",
            "amountSignal": signal,
            "text": sentence,
            "sourceRef": ref,
        })
    return candidates


def parse_blob(raw: bytes, blob_ref: dict, expected_accession: str) -> dict:
    if sha256(raw) != blob_ref["blobSha256"] or Path(blob_ref["relativePath"]).stem != blob_ref["blobSha256"]:
        fail("source blob hash binding changed")
    if len(raw) != blob_ref["bytes"]:
        fail("source blob byte length changed")
    if accession_from_sec_header(raw) != expected_accession:
        fail("source blob accession changed")
    try:
        documents = extract_documents(raw)
    except MetadataError:
        return {
            "parseStatus": "SGML_MALFORMED",
            "fields": {name: empty_field("UNAVAILABLE") for name in ALL_FIELDS},
            "candidateSnippets": [],
        }
    sentences = sentences_for_documents(documents)
    xml_blocks: list[tuple[dict, bytes]] = []
    xml_boundary_malformed = False
    for document in documents:
        starts = list(XML_START_RE.finditer(document["textRaw"]))
        ends = list(XML_END_RE.finditer(document["textRaw"]))
        blocks = list(XML_BLOCK_RE.finditer(document["textRaw"]))
        if len(starts) != len(ends) or len(blocks) != len(starts):
            xml_boundary_malformed = True
        for block in blocks:
            xml_blocks.append((document, block.group(1).strip()))
    fields: dict[str, dict]
    if xml_boundary_malformed:
        parse_status = "XML_MALFORMED"
        fields = {name: empty_field("UNAVAILABLE") for name in FIELD_PATHS}
    elif not xml_blocks:
        parse_status = "XML_DOCUMENT_MISSING"
        fields = {name: empty_field("UNAVAILABLE") for name in FIELD_PATHS}
    elif len(xml_blocks) != 1:
        parse_status = "XML_DOCUMENT_MULTIPLE"
        fields = {name: empty_field("UNAVAILABLE") for name in FIELD_PATHS}
    else:
        document, xml_raw = xml_blocks[0]
        try:
            root = ET.fromstring(xml_raw)
            if local_name(root.tag) != "notificationOfRemoval":
                raise ET.ParseError("unexpected XML root")
        except ET.ParseError:
            parse_status = "XML_MALFORMED"
            fields = {name: empty_field("UNAVAILABLE") for name in FIELD_PATHS}
        else:
            parse_status = "STRUCTURED_XML_PRESENT"
            fields = {name: field_from_xml(root, path, document, blob_ref) for name, path in FIELD_PATHS.items()}
    for name in TEXT_DATE_FIELDS:
        fields[name] = semantic_date_field(name, sentences, blob_ref)
    return {
        "parseStatus": parse_status,
        "fields": fields,
        "candidateSnippets": candidate_snippets(sentences, blob_ref),
    }


def unavailable_metadata() -> dict:
    return {
        "parseStatus": "SOURCE_AMBIGUOUS_INVENTORY",
        "fields": {name: empty_field("UNAVAILABLE") for name in ALL_FIELDS},
        "candidateSnippets": [],
    }


def build_row(queue_row: dict, inventory_row: dict, parsed: dict | None) -> dict:
    if queue_row["rowId"] != inventory_row["rowId"] or queue_row["accession"] != inventory_row["accession"]:
        fail("rowId/accession join mismatch")
    if queue_row["form"] not in {"25", "25-NSE", "25-NSE/A", "25/A"}:
        fail("non-Form-25 row entered metadata population")
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
        fail("unexpected Form-25 inventory status")
    fields = metadata["fields"]
    missingness = sorted(name for name, field in fields.items() if field["status"] == "MISSING")
    ambiguities = sorted(name for name, field in fields.items() if field["status"].startswith("AMBIGUOUS"))
    if metadata["parseStatus"] == "SOURCE_AMBIGUOUS_INVENTORY":
        ambiguities.insert(0, "sourceBlob")
    return {
        "rowId": queue_row["rowId"],
        "priorityRank": queue_row["priorityRank"],
        "accession": queue_row["accession"],
        "form": queue_row["form"],
        "filedDate": queue_row["filedDate"],
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
        "documentFilename", "rawDocumentSha256", "rawTextSha256", "locatorKind", "locator", "evidenceSha256",
    }, "sourceRef")
    for name in ("blobSha256", "rawDocumentSha256", "rawTextSha256", "evidenceSha256"):
        if not isinstance(ref[name], str) or not HEX64_RE.fullmatch(ref[name]):
            fail(f"sourceRef {name} is not a SHA-256")
    if Path(ref["relativePath"]).stem != ref["blobSha256"]:
        fail("sourceRef path/hash mismatch")
    if not isinstance(ref["documentIndex"], int) or ref["documentIndex"] < 1:
        fail("sourceRef document index invalid")
    if ref["locatorKind"] not in {"XML_PATH", "NORMALIZED_TEXT_SENTENCE"}:
        fail("sourceRef locator kind invalid")
    if not all(isinstance(ref[name], str) and ref[name] for name in (
        "documentType", "documentSequence", "documentFilename", "locator"
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
            # Text-date evidence hashes the full sentence, so only XML paths bind the scalar value.
            if evidence["sourceRef"]["locatorKind"] == "XML_PATH":
                fail(f"field {name} XML evidence hash changed")
    if field["status"] == "PRESENT":
        if not isinstance(field["value"], str) or not field["value"] or not field["evidence"]:
            fail(f"present field {name} lacks value/evidence")
        if {item["value"] for item in field["evidence"]} != {field["value"]}:
            fail(f"present field {name} evidence conflicts")
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
    exact_keys(candidate, {
        "candidateId", "kind", "verificationStatus", "amountSignal", "text", "sourceRef",
    }, "candidate snippet")
    if candidate["kind"] != "CONSIDERATION_OR_PAYMENT_TEXT" or candidate["verificationStatus"] != "CANDIDATE_ONLY":
        fail("candidate was promoted beyond candidate-only evidence")
    if candidate["amountSignal"] not in {"CURRENCY_AMOUNT", "SHARE_RATIO", "PER_SHARE_AMOUNT"}:
        fail("candidate amount signal invalid")
    if not isinstance(candidate["text"], str) or not candidate["text"]:
        fail("candidate text missing")
    validate_source_ref(candidate["sourceRef"])
    expected = sha256(canonical_bytes({
        "sourceRef": candidate["sourceRef"], "text": candidate["text"], "amountSignal": candidate["amountSignal"],
    }))
    if candidate["candidateId"] != expected:
        fail("candidate id changed")


def validate_row_shape(row: dict) -> None:
    exact_keys(row, {
        "rowId", "priorityRank", "accession", "form", "filedDate", "inventoryStatus", "sourceBlob",
        "parseStatus", "fields", "candidateSnippets", "missingness", "ambiguities", "outcomesAccessed",
    }, "metadata row")
    if row["outcomesAccessed"] is not False or row["parseStatus"] not in PARSE_STATUSES:
        fail("row outcome or parse lock changed")
    if set(row["fields"]) != set(ALL_FIELDS):
        fail("metadata field set changed")
    for name, field in row["fields"].items():
        validate_field(name, field)
    for candidate in row["candidateSnippets"]:
        validate_candidate(candidate)
    expected_missing = sorted(name for name, field in row["fields"].items() if field["status"] == "MISSING")
    expected_ambiguous = sorted(name for name, field in row["fields"].items() if field["status"].startswith("AMBIGUOUS"))
    if row["parseStatus"] == "SOURCE_AMBIGUOUS_INVENTORY":
        expected_ambiguous.insert(0, "sourceBlob")
        if row["sourceBlob"] is not None or row["inventoryStatus"] != "AMBIGUOUS_MULTIPLE_LOCAL_BLOBS":
            fail("ambiguous inventory source was selected")
    else:
        if not isinstance(row["sourceBlob"], dict):
            fail("parsed row lacks source blob")
        exact_keys(row["sourceBlob"], {"blobSha256", "bytes", "relativePath"}, "sourceBlob")
        if not HEX64_RE.fullmatch(row["sourceBlob"]["blobSha256"]):
            fail("sourceBlob hash missing")
        if Path(row["sourceBlob"]["relativePath"]).stem != row["sourceBlob"]["blobSha256"]:
            fail("sourceBlob path/hash mismatch")
    if row["missingness"] != expected_missing or row["ambiguities"] != expected_ambiguous:
        fail("row missingness/ambiguity ledger changed")


def validate_output(payload: dict, expected_rows: list[dict], contract: dict, implementation: dict,
                    input_bindings: dict) -> None:
    exact_keys(payload, {
        "schema", "track", "taskId", "inputBindings", "implementationBindings", "population",
        "parseStatusCounts", "fieldStatusCounts", "candidateSnippetCount", "claimLocks", "rows", "reportSha256",
    }, "output")
    if payload["schema"] != "early-detection-sec-form25-structured-metadata/v1":
        fail("output schema changed")
    if payload["inputBindings"] != input_bindings or payload["implementationBindings"] != implementation:
        fail("output binding changed")
    validate_claim_locks(payload["claimLocks"], contract["claimLocks"])
    if payload["rows"] != expected_rows:
        fail("output rows do not match source-derived rows")
    if len(payload["rows"]) != contract["queueInput"]["form25Rows"]:
        fail("Form-25 denominator changed")
    if len({row["rowId"] for row in payload["rows"]}) != len(payload["rows"]):
        fail("duplicate metadata rowId")
    for row in payload["rows"]:
        validate_row_shape(row)
    parse_counts = {status: 0 for status in sorted(PARSE_STATUSES)}
    field_counts = {name: {status: 0 for status in sorted(FIELD_STATUSES)} for name in ALL_FIELDS}
    for row in payload["rows"]:
        parse_counts[row["parseStatus"]] += 1
        for name, field in row["fields"].items():
            field_counts[name][field["status"]] += 1
    if payload["parseStatusCounts"] != parse_counts or payload["fieldStatusCounts"] != field_counts:
        fail("metadata count ledger changed")
    if payload["candidateSnippetCount"] != sum(len(row["candidateSnippets"]) for row in payload["rows"]):
        fail("candidate snippet count changed")
    expected_sha = sha256(canonical_bytes({key: value for key, value in payload.items() if key != "reportSha256"}))
    if payload["reportSha256"] != expected_sha:
        fail("output self hash changed")


def load_bound_json(path: Path, raw_sha: str, report_sha: str) -> tuple[dict, bytes]:
    raw = path.read_bytes()
    if sha256(raw) != raw_sha:
        fail(f"{path.name} raw binding changed")
    value = json.loads(raw)
    if value.get("reportSha256") != report_sha:
        fail(f"{path.name} self binding changed")
    return value, raw


def build(blob_root: Path) -> dict:
    base_commit = require_remote_snapshot()
    implementation = bind_implementation(base_commit)
    contract, contract_raw = load_contract()
    queue, queue_raw = load_bound_json(
        QUEUE_PATH, contract["queueInput"]["rawSha256"], contract["queueInput"]["reportSha256"]
    )
    inventory, inventory_raw = load_bound_json(
        INVENTORY_PATH, contract["inventoryInput"]["rawSha256"], contract["inventoryInput"]["reportSha256"]
    )
    if inventory.get("blobTreeSequenceSha256") != contract["inventoryInput"]["blobTreeSequenceSha256"]:
        fail("inventory blob-tree binding changed")
    if len(queue.get("rows", [])) != contract["queueInput"]["rows"] or len(inventory.get("rows", [])) != len(queue["rows"]):
        fail("queue/inventory denominator changed")
    allowed_forms = set(contract["queueInput"]["allowedForms"])
    form_rows = [row for row in queue["rows"] if row.get("form") in allowed_forms]
    if len(form_rows) != contract["queueInput"]["form25Rows"]:
        fail("Form-25 population changed")
    if len({row["accession"] for row in form_rows}) != contract["queueInput"]["form25UniqueAccessions"]:
        fail("Form-25 accession population changed")
    inventory_by_row_id = {row["rowId"]: row for row in inventory["rows"]}
    if len(inventory_by_row_id) != len(inventory["rows"]):
        fail("inventory duplicate rowId")
    inventory_counts = {"LOCAL_PRIMARY_PRESENT": 0, "AMBIGUOUS_MULTIPLE_LOCAL_BLOBS": 0, "FETCH_REQUIRED": 0}
    parsed_cache: dict[str, dict] = {}
    rows = []
    for queue_row in form_rows:
        inventory_row = inventory_by_row_id.get(queue_row["rowId"])
        if inventory_row is None:
            fail("Form-25 row missing from inventory")
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
    expected_inventory_counts = {
        "LOCAL_PRIMARY_PRESENT": contract["inventoryInput"]["localPrimaryPresentForm25Rows"],
        "AMBIGUOUS_MULTIPLE_LOCAL_BLOBS": contract["inventoryInput"]["ambiguousMultipleLocalBlobsForm25Rows"],
        "FETCH_REQUIRED": contract["inventoryInput"]["fetchRequiredForm25Rows"],
    }
    if inventory_counts != expected_inventory_counts:
        fail("Form-25 inventory status counts changed")
    input_bindings = {
        "contractRawSha256": sha256(contract_raw),
        "queueRawSha256": sha256(queue_raw),
        "queueReportSha256": queue["reportSha256"],
        "inventoryRawSha256": sha256(inventory_raw),
        "inventoryReportSha256": inventory["reportSha256"],
        "blobTreeSequenceSha256": inventory["blobTreeSequenceSha256"],
    }
    parse_counts = {status: 0 for status in sorted(PARSE_STATUSES)}
    field_counts = {name: {status: 0 for status in sorted(FIELD_STATUSES)} for name in ALL_FIELDS}
    for row in rows:
        parse_counts[row["parseStatus"]] += 1
        for name, field in row["fields"].items():
            field_counts[name][field["status"]] += 1
    payload = {
        "schema": "early-detection-sec-form25-structured-metadata/v1",
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
        "candidateSnippetCount": sum(len(row["candidateSnippets"]) for row in rows),
        "claimLocks": contract["claimLocks"],
        "rows": rows,
        "reportSha256": None,
    }
    payload["reportSha256"] = sha256(canonical_bytes({key: value for key, value in payload.items() if key != "reportSha256"}))
    validate_output(payload, rows, contract, implementation, input_bindings)
    if require_remote_snapshot() != base_commit or bind_implementation(base_commit) != implementation:
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


def fixture_blob(xml: str, exhibit_sentences: str = "") -> tuple[bytes, dict, str]:
    accession = "0000000001-20-000001"
    raw = (
        f"<SEC-DOCUMENT>{accession}.txt : 20200102\n"
        f"<SEC-HEADER>{accession}.hdr.sgml : 20200102\n"
        f"ACCESSION NUMBER:\t\t{accession}\n</SEC-HEADER>\n"
        "<DOCUMENT>\n<TYPE>25-NSE\n<SEQUENCE>1\n<FILENAME>primary.xml\n<TEXT>\n<XML>\n"
        f"{xml}\n</XML>\n</TEXT>\n</DOCUMENT>\n"
        "<DOCUMENT>\n<TYPE>EX-99.25\n<SEQUENCE>2\n<FILENAME>notice.htm\n<TEXT>\n"
        f"{exhibit_sentences}\n</TEXT>\n</DOCUMENT>\n</SEC-DOCUMENT>\n"
    ).encode("utf-8")
    digest = sha256(raw)
    return raw, {"blobSha256": digest, "bytes": len(raw), "relativePath": f"{digest[:2]}/{digest}.txt"}, accession


def fixture_xml(extra_issuer: str = "") -> str:
    return (
        "<?xml version=\"1.0\"?><notificationOfRemoval>"
        "<exchange><cik>0000876661</cik><entityName>TEST EXCHANGE</entityName></exchange>"
        f"<issuer><cik>1</cik>{extra_issuer}<entityName>TEST ISSUER</entityName></issuer>"
        "<descriptionClassSecurity>Common Stock</descriptionClassSecurity>"
        "<ruleProvision>17 CFR 240.12d2-2(a)(3)</ruleProvision>"
        "<signatureData><signatureDate>2020-01-02</signatureDate></signatureData>"
        "</notificationOfRemoval>"
    )


def rejected(mutated: dict) -> bool:
    try:
        validate_row_shape(mutated)
    except MetadataError:
        return True
    return False


def self_test() -> dict:
    contract, _ = load_contract()
    exhibit = (
        "The Exchange intends to remove the security at the opening of business on January 12, 2020. "
        "The security was suspended from trading on January 3, 2020. "
        "Each share was converted into 0.8595 of a share of Acquirer Common Stock."
    )
    raw, blob_ref, accession = fixture_blob(fixture_xml(), exhibit)
    parsed = parse_blob(raw, blob_ref, accession)
    valid_exact_extraction = (
        parsed["parseStatus"] == "STRUCTURED_XML_PRESENT"
        and parsed["fields"]["issuerCik"]["value"] == "1"
        and parsed["fields"]["removalEffectiveDate"]["value"] == "2020-01-12"
        and parsed["fields"]["suspensionDate"]["value"] == "2020-01-03"
        and len(parsed["candidateSnippets"]) == 1
        and parsed["candidateSnippets"][0]["verificationStatus"] == "CANDIDATE_ONLY"
    )
    malformed_raw, malformed_ref, malformed_accession = fixture_blob("<notificationOfRemoval><issuer></notificationOfRemoval>")
    malformed_xml_rejected = parse_blob(malformed_raw, malformed_ref, malformed_accession)["parseStatus"] == "XML_MALFORMED"
    second_xml = "<XML>\n<notificationOfRemoval/>\n</XML>"
    multiple_raw, multiple_ref, multiple_accession = fixture_blob(fixture_xml(), second_xml)
    multiple_xml_rejected = parse_blob(multiple_raw, multiple_ref, multiple_accession)["parseStatus"] == "XML_DOCUMENT_MULTIPLE"
    duplicate_raw, duplicate_ref, duplicate_accession = fixture_blob(fixture_xml("<cik>1</cik>"))
    duplicate_status = parse_blob(duplicate_raw, duplicate_ref, duplicate_accession)["fields"]["issuerCik"]["status"]
    conflict_raw, conflict_ref, conflict_accession = fixture_blob(fixture_xml("<cik>2</cik>"))
    conflict_status = parse_blob(conflict_raw, conflict_ref, conflict_accession)["fields"]["issuerCik"]["status"]
    date_raw, date_ref, date_accession = fixture_blob(
        fixture_xml(),
        "The security was suspended from trading on January 3, 2020. "
        "The security was suspended from trading on January 4, 2020.",
    )
    date_ambiguity_rejected = (
        parse_blob(date_raw, date_ref, date_accession)["fields"]["suspensionDate"]["status"] == "AMBIGUOUS_CONFLICT"
    )
    amountless_raw, amountless_ref, amountless_accession = fixture_blob(
        fixture_xml(), "Each holder has the right to receive an immediate cash payment."
    )
    payment_without_amount_rejected = not parse_blob(
        amountless_raw, amountless_ref, amountless_accession
    )["candidateSnippets"]
    queue_row = {
        "rowId": "SEC-TW-00000001", "priorityRank": 1, "accession": accession,
        "form": "25-NSE", "filedDate": "2020-01-02",
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
    locks_mutation = copy.deepcopy(contract["claimLocks"]); locks_mutation["terminalPaymentVerified"] = True
    false_claim_rejected = False
    try:
        validate_claim_locks(locks_mutation, contract["claimLocks"])
    except MetadataError:
        false_claim_rejected = True
    return {
        "status": "PASS",
        "contractRawBound": sha256(CONTRACT_PATH.read_bytes()) == CONTRACT_RAW_SHA256,
        "validExactExtractionAccepted": valid_exact_extraction,
        "malformedXmlRejected": malformed_xml_rejected,
        "multipleXmlDocumentsRejected": multiple_xml_rejected,
        "duplicateXmlFieldRejected": duplicate_status == "AMBIGUOUS_DUPLICATE",
        "conflictingXmlFieldRejected": conflict_status == "AMBIGUOUS_CONFLICT",
        "dateAmbiguityRejected": date_ambiguity_rejected,
        "paymentLanguageWithoutAmountRejected": payment_without_amount_rejected,
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
