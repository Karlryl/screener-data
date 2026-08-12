#!/usr/bin/env python3
"""Add exact effective-date sentence provenance to the fixed-cash evidence."""

from __future__ import annotations

import argparse
import copy
import hashlib
import html
import json
import os
import re
import tempfile
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-effective-fixed-cash-conversion-evidence-contract-v2.json"
V1 = ROOT / "reports" / "early-detection" / "sec-effective-fixed-cash-conversion-evidence-v1.json"
V1_CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-effective-fixed-cash-conversion-evidence-contract-v1.json"
V1_BUILDER = ROOT / "scripts" / "build-sec-effective-fixed-cash-conversion-evidence-v1.py"
V1_TEST = ROOT / "tests" / "build-sec-effective-fixed-cash-conversion-evidence-v1.test.js"
OUTPUT = ROOT / "reports" / "early-detection" / "sec-effective-fixed-cash-conversion-evidence-v2.json"
CORPUS_ROOT = Path(r"C:\Users\Anwender\Documents\GrowthScreenerResearchData\early-detection-v4\corporate-action-originals\blobs\sha256")
EXPECTED_CONTRACT_RAW = "bf13286dd749108b0b6728e61955af38514b7783d3f424caed2db39a93905ee7"
V1_RAW = "a10789421e970b0531323e585618243e99dc07cb72a5e0c4c387854c65a76645"
V1_REPORT = "c83e41ecbf4ac0f3c33bf8d47c92d5db6b83da1b22d9dd2623c863df1e4a5b4d"
V1_SHAS = {
    V1_CONTRACT: "091cecc6331b1b74b6bb5243313f73eaa331ad3a30fd37e9af0d589fbbe09bcd",
    V1_BUILDER: "09467f8e1ce132fa57882b9f2c84526077bd131d884dfccebf59c30d97da46b6",
    V1_TEST: "b9f38ff33a2baebf9bdfe744e71726b71c0b4210078ffc217ed31814df397344",
}
EXPECTED_DATES = {
    "0000876661-12-000192": "2012-04-30",
    "0000876661-13-000902": "2013-12-19",
    "0000876661-21-001108": "2021-07-23",
    "0001104659-19-049572": "2019-08-30",
}
DATE_PHRASES = {
    "0000876661-12-000192": "became effective on april 30, 2012",
    "0000876661-13-000902": "became effective on december 19, 2013",
    "0000876661-21-001108": "became effective before market open on july 23, 2021",
    "0001104659-19-049572": "effective as of august 30, 2019",
}
DOCUMENT_BLOCK_RE = re.compile(br"<DOCUMENT>.*?</DOCUMENT>", re.I | re.S)
TEXT_BLOCK_RE = re.compile(br"<TEXT>(.*?)</TEXT>", re.I | re.S)
FIELD_RE = {name: re.compile(rb"(?m)^<" + name + rb">([^\r\n]+)\r?$") for name in (b"TYPE", b"SEQUENCE", b"FILENAME")}


class EvidenceError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise EvidenceError(message)


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def file_sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        fail(f"{label} exact keys changed")


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


def normalize(value: str) -> str:
    return " ".join(html.unescape(value).split())


def document_text(raw: bytes) -> tuple[str, str]:
    sink = TextSink()
    decoded = raw.decode("latin-1")
    try:
        sink.feed(decoded)
        sink.close()
    except (AssertionError, ValueError):
        stripped = re.sub(r"(?is)<(?:script|style)\b.*?</(?:script|style)\s*>", " ", decoded)
        stripped = re.sub(r"(?s)<!--.*?-->", " ", stripped)
        stripped = re.sub(r"(?s)<[^>]+>", " ", stripped)
        return normalize(stripped), "CONSERVATIVE_TAG_STRIP_FALLBACK"
    return normalize(" ".join(sink.parts)), "HTML_PARSER"


def extract_documents(raw: bytes) -> list[dict[str, Any]]:
    blocks = DOCUMENT_BLOCK_RE.findall(raw)
    if not blocks:
        fail("source blob has no SGML documents")
    result = []
    for index, block in enumerate(blocks, 1):
        text_matches = TEXT_BLOCK_RE.findall(block)
        if len(text_matches) != 1:
            fail("source document text cardinality changed")
        fields = {}
        for name, pattern in FIELD_RE.items():
            matches = pattern.findall(block)
            if len(matches) != 1:
                fail("source document field cardinality changed")
            fields[name.decode("ascii")] = matches[0].decode("latin-1").strip()
        result.append({"index": index, "raw": block, "textRaw": text_matches[0].strip(b"\r\n"), **fields})
    return result


def sentences(text: str) -> list[str]:
    return [item.strip() for item in re.split(r"(?<=[.!?])\s+", text) if item.strip()]


def load_v1() -> dict[str, Any]:
    raw = V1.read_bytes()
    if sha(raw) != V1_RAW:
        fail("V1 raw bytes changed")
    value = json.loads(raw)
    body = dict(value)
    claim = body.pop("reportSha256", None)
    if claim != V1_REPORT or sha(canonical(body)) != V1_REPORT or value.get("outcomesAccessed") is not False:
        fail("V1 self binding changed")
    return value


def validate_contract() -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    if sha(raw) != EXPECTED_CONTRACT_RAW:
        fail("contract raw bytes changed")
    value = json.loads(raw)
    exact_keys(value, {"schema", "createdAt", "taskId", "track", "purpose", "inputs", "evidenceContract", "output", "claimLocks"}, "contract")
    if value["schema"] != "early-detection-sec-effective-fixed-cash-conversion-evidence-contract/v2" or value["taskId"] != "Q003-SEC-EFFECTIVE-FIXED-CASH-CONVERSION-EVIDENCE-V2" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract boundary changed")
    if value["inputs"] != {"v1Evidence": {"builderRawSha256": V1_SHAS[V1_BUILDER], "contractRawSha256": V1_SHAS[V1_CONTRACT], "path": "reports/early-detection/sec-effective-fixed-cash-conversion-evidence-v1.json", "rawSha256": V1_RAW, "reportSha256": V1_REPORT, "testRawSha256": V1_SHAS[V1_TEST]}}:
        fail("input binding changed")
    evidence = value["evidenceContract"]
    if evidence != {"actualCashReceiptNotInferred": True, "effectiveDateEvidenceLocatorRequired": True, "expectedAccessions": sorted(EXPECTED_DATES), "expectedEffectiveDatesByAccession": EXPECTED_DATES, "expectedRows": 4, "sameDocumentAsFixedCashEvidenceRequired": True, "semanticCeiling": "PRIMARY_SEC_STATEMENT_SAYS_TRANSACTION_BECAME_EFFECTIVE_AND_SOURCE_SHARE_WAS_CONVERTED_INTO_FIXED_CASH_RIGHT", "sourceDerivedSentenceLocatorRequired": True}:
        fail("evidence contract changed")
    if value["output"] != {"path": "reports/early-detection/sec-effective-fixed-cash-conversion-evidence-v2.json", "writeNewAtomic": True} or any(item is not False for item in value["claimLocks"].values()):
        fail("output or claim boundary changed")
    for path, claim in V1_SHAS.items():
        if file_sha(path) != claim:
            fail("V1 implementation changed")
    return value


def build_date_ref(source: dict[str, Any]) -> dict[str, Any]:
    accession = source["accession"]
    fixed_ref = source["sourceRef"]
    blob_sha = fixed_ref["blobSha256"]
    relative = fixed_ref["relativePath"]
    if relative != f"{blob_sha[:2]}/{blob_sha}.txt":
        fail("V1 source path changed")
    raw = (CORPUS_ROOT / relative).read_bytes()
    if sha(raw) != blob_sha:
        fail("source blob bytes changed")
    docs = extract_documents(raw)
    index = fixed_ref["documentIndex"]
    if not isinstance(index, int) or index < 1 or index > len(docs):
        fail("source document index changed")
    doc = docs[index - 1]
    if doc["TYPE"] != fixed_ref["documentType"] or doc["SEQUENCE"] != fixed_ref["documentSequence"] or doc["FILENAME"] != fixed_ref["documentFilename"] or sha(doc["raw"]) != fixed_ref["rawDocumentSha256"] or sha(doc["textRaw"]) != fixed_ref["rawTextSha256"]:
        fail("V1 source document binding changed")
    text, mode = document_text(doc["textRaw"])
    found = [(position, sentence) for position, sentence in enumerate(sentences(text), 1) if DATE_PHRASES[accession] in sentence.lower()]
    if len(found) != 1:
        fail("effective date evidence cardinality changed")
    position, sentence = found[0]
    return {
        "blobSha256": blob_sha,
        "relativePath": relative,
        "documentIndex": index,
        "documentType": doc["TYPE"],
        "documentSequence": doc["SEQUENCE"],
        "documentFilename": doc["FILENAME"],
        "rawDocumentSha256": sha(doc["raw"]),
        "rawTextSha256": sha(doc["textRaw"]),
        "locatorKind": "NORMALIZED_TEXT_SENTENCE",
        "locator": f"sentence[{position}]/transactionEffectiveDate",
        "normalizationMode": mode,
        "evidenceSha256": sha(sentence.encode("utf-8")),
        "evidenceText": sentence,
    }


def build_report(contract: dict[str, Any], v1: dict[str, Any]) -> dict[str, Any]:
    rows = []
    if not isinstance(v1.get("rows"), list) or len(v1["rows"]) != 4:
        fail("V1 denominator changed")
    for source in v1["rows"]:
        if source["accession"] not in EXPECTED_DATES or source["transactionEffectiveDate"] != EXPECTED_DATES[source["accession"]]:
            fail("V1 effective date changed")
        row = copy.deepcopy(source)
        row["sourceV1EvidenceRowId"] = row.pop("evidenceRowId")
        row["effectiveDateSourceRef"] = build_date_ref(source)
        if row["effectiveDateSourceRef"]["blobSha256"] != row["sourceRef"]["blobSha256"] or row["effectiveDateSourceRef"]["documentIndex"] != row["sourceRef"]["documentIndex"]:
            fail("effective date and cash conversion are not in the same document")
        row["evidenceStatus"] = "EFFECTIVE_DATE_AND_FIXED_CASH_CONVERSION_RIGHT_LOCATOR_VERIFIED_FROM_PRIMARY_SEC_STATEMENT"
        row["evidenceRowId"] = ""
        row["evidenceRowId"] = sha(canonical({key: value for key, value in row.items() if key != "evidenceRowId"}))
        rows.append(row)
    value = {
        "schema": "early-detection-sec-effective-fixed-cash-conversion-evidence/v2",
        "taskId": contract["taskId"],
        "track": contract["track"],
        "contractRawSha256": sha(CONTRACT.read_bytes()),
        "v1RawSha256": V1_RAW,
        "v1ReportSha256": V1_REPORT,
        "semanticCeiling": contract["evidenceContract"]["semanticCeiling"],
        "population": {"v1Rows": 4, "effectiveDateLocatorVerifiedRows": 4, "sameDocumentVerifiedRows": 4, "actualCashReceiptVerifiedRows": 0, "terminalWealthCompleteRows": 0},
        "rows": rows,
        "claimLocks": contract["claimLocks"],
        "outcomesAccessed": False,
    }
    value["reportSha256"] = sha(canonical(value))
    return value


def validate_report(value: dict[str, Any], contract: dict[str, Any], v1: dict[str, Any]) -> None:
    exact_keys(value, {"schema", "taskId", "track", "contractRawSha256", "v1RawSha256", "v1ReportSha256", "semanticCeiling", "population", "rows", "claimLocks", "outcomesAccessed", "reportSha256"}, "report")
    body = dict(value)
    claim = body.pop("reportSha256", None)
    if claim != sha(canonical(body)) or value != build_report(contract, v1):
        fail("report does not match source rebuild")
    if any(item is not False for item in value["claimLocks"].values()) or value["outcomesAccessed"] is not False:
        fail("claim boundary changed")


def write_new(path: Path, raw: bytes) -> None:
    if path.exists():
        fail("output exists")
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
    except (EvidenceError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError):
        return True
    return False


def self_test(contract: dict[str, Any], v1: dict[str, Any]) -> dict[str, Any]:
    report = build_report(contract, v1)
    validate_report(report, contract, v1)
    kills = {}
    for name, mutate in {
        "dateEvidenceRemoved": lambda x: x["rows"][0].pop("effectiveDateSourceRef"),
        "dateLocatorChanged": lambda x: x["rows"][0]["effectiveDateSourceRef"].__setitem__("locator", "sentence[999]/transactionEffectiveDate"),
        "dateEvidenceHashChanged": lambda x: x["rows"][0]["effectiveDateSourceRef"].__setitem__("evidenceSha256", "0" * 64),
        "differentDocumentClaimed": lambda x: x["rows"][0]["effectiveDateSourceRef"].__setitem__("documentIndex", 999),
        "actualReceiptClaimed": lambda x: x["rows"][0].__setitem__("actualCashReceiptVerified", True),
        "terminalWealthClaimed": lambda x: x["claimLocks"].__setitem__("terminalWealthComplete", True),
    }.items():
        item = copy.deepcopy(report)
        mutate(item)
        item["reportSha256"] = sha(canonical({key: val for key, val in item.items() if key != "reportSha256"}))
        kills[name] = rejected(lambda item=item: validate_report(item, contract, v1))
    if set(kills.values()) != {True}:
        fail("mutation kill failed")
    return {"schema": "early-detection-sec-effective-fixed-cash-conversion-evidence-self-test/v2", "status": "PASS", "kills": kills, "outcomesAccessed": False}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify-contract", "self-test", "build", "verify-output"))
    args = parser.parse_args()
    try:
        contract = validate_contract()
        v1 = load_v1()
        if args.command == "verify-contract":
            result = {"schema": "early-detection-sec-effective-fixed-cash-conversion-evidence-contract-verification/v2", "status": "PASS", "outcomesAccessed": False}
        elif args.command == "self-test":
            result = self_test(contract, v1)
        elif args.command == "build":
            report = build_report(contract, v1)
            validate_report(report, contract, v1)
            raw = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
            write_new(OUTPUT, raw)
            result = {"schema": "early-detection-sec-effective-fixed-cash-conversion-evidence-build/v2", "status": "PASS", "path": OUTPUT.relative_to(ROOT).as_posix(), "rawSha256": sha(raw), "reportSha256": report["reportSha256"], "verifiedRows": 4, "outcomesAccessed": False}
        else:
            raw = OUTPUT.read_bytes()
            report = json.loads(raw)
            validate_report(report, contract, v1)
            result = {"schema": "early-detection-sec-effective-fixed-cash-conversion-evidence-verification/v2", "status": "PASS", "rawSha256": sha(raw), "reportSha256": report["reportSha256"], "sourceRebuildVerified": True, "verifiedRows": 4, "outcomesAccessed": False}
    except (EvidenceError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
