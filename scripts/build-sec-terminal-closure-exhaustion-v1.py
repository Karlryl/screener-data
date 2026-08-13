#!/usr/bin/env python3
"""Exhaustively rebuild narrow terminal-closure evidence from the frozen SEC corpus."""

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
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-terminal-closure-exhaustion-contract-v1.json"
BUILDER = Path(__file__).resolve()
TEST = ROOT / "tests" / "build-sec-terminal-closure-exhaustion-v1.test.js"
OUTPUT = ROOT / "reports" / "early-detection" / "sec-terminal-closure-exhaustion-v1.json"
INVENTORY = ROOT / "reports" / "early-detection" / "sec-terminal-wealth-original-inventory-v4.json"
EXISTING = ROOT / "reports" / "early-detection" / "sec-frozen-terminal-distribution-receipt-evidence-v2.json"
CORPUS = Path(r"C:\Users\Anwender\Documents\GrowthScreenerResearchData\early-detection-v4\corporate-action-originals\blobs\sha256")
REMOTE_URL = "https://github.com/Karlryl/screener-data.git"
REMOTE_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
SOURCE_BASE = "cb75c5c6efdae34533c8cf004aca93f3c5387810"
EXPECTED_CREATED_AT = "2026-08-13T07:35:18Z"
EXPECTED_PURPOSE = "Bind an exhaustive outcome-blind scan of the frozen SEC corpus, materialize only exact primary-SEC statements of a last trading day on a named exchange, and record narrow corpus-bounded null results for no-further-distribution and actual post-closing recovery language."
EXPECTED_CEILING = "EXACT_TWENTY_THREE_PRIMARY_SEC_SENTENCES_STATE_A_LAST_TRADING_DAY_ON_THE_NAMED_EXCHANGE_AND_THE_FROZEN_CORPUS_SCAN_FOUND_NO_QUALIFYING_NO_FURTHER_DISTRIBUTION_OR_ACTUAL_POST_CLOSING_RECOVERY_SENTENCE"
EXPECTED_CONTRACT_RAW = "533ba2bd165e6e10898be900da4da437bf6fd361c9b3335d2028e57660d9ab8c"
EXPECTED_CONTRACT_SELF = "c797c86818e7a8e5e6f47000da1e5a2ae50404268030db6d39f6c2a671aab76b"
EXPECTED_BUILDER_NORMALIZED = "bbcef3869e9e44a4d77ea2e2b4643f4204d7f8a313ac9c98cbf86e9d47533473"
EXPECTED_TEST_RAW = "b8fa48084d01fbcd08bf2023c774adaceb68476eae215f71ac758a3a1b6b4dce"
EXPECTED_OUTPUT_RAW: str | None = None
EXPECTED_OUTPUT_SELF: str | None = None

DOCUMENT_RE = re.compile(br"(?is)<DOCUMENT>(.*?)</DOCUMENT>")
TEXT_RE = re.compile(br"(?is)<TEXT>(.*?)</TEXT>")
FIELD_RE = {
    "TYPE": re.compile(br"(?im)^<TYPE>([^\r\n<]+)"),
    "SEQUENCE": re.compile(br"(?im)^<SEQUENCE>([^\r\n<]+)"),
    "FILENAME": re.compile(br"(?im)^<FILENAME>([^\r\n<]+)"),
}
ACCESSION_RE = re.compile(br"(?m)^ACCESSION NUMBER:\s*([0-9]{10}-[0-9]{2}-[0-9]{6})\s*\r?$")
LAST_TRADING_RE = re.compile(r"(?i)\b(?:last|final)\s+(?:day|date|session)\s+(?:of\s+)?trading\b|\b(?:last|finally)\s+traded\b")
DATE_RE = re.compile(r"(?i)\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b")
MONTHS = {name: index for index, name in enumerate("January February March April May June July August September October November December".split(), 1)}
BROAD_TRADING_RE = re.compile(r"(?i)(?:\b(?:last|final)\s+(?:day|date|session)\s+(?:of\s+)?trading\b|\btrading\s+(?:in|of)\b.{0,140}\b(?:ceased|ended|terminated|suspended)\b|\b(?:ceased|ended|terminated)\s+(?:to\s+)?trade\b|\b(?:last|finally)\s+traded\b|\bno\s+longer\s+(?:traded|trading)\b)")
BROAD_FINAL_RE = re.compile(r"(?i)(?:\b(?:final|last)\s+(?:liquidating\s+)?distribution\b|\bno\s+(?:further|additional|subsequent)\s+(?:cash\s+)?distributions?\b|\bwill\s+be\s+no\s+(?:further|additional|subsequent)\b|\bcompleted\s+(?:the\s+)?(?:final\s+)?distribution\b)")
BROAD_RECOVERY_RE = re.compile(r"(?i)(?:(?:\bescrow\b|\bholdback\b|\bcontingent\b|\bCVR\b|\brecovery\b|\bpost[- ]closing\b|\bsubsequent\b|\badditional\b).{0,180}\b(?:paid|received|released|distributed|remitted)\b|\b(?:paid|received|released|distributed|remitted)\b.{0,180}(?:\bescrow\b|\bholdback\b|\bcontingent\b|\bCVR\b|\brecovery\b|\bpost[- ]closing\b|\bsubsequent\b|\badditional\b))")
RECOVERY_ANCHOR_RE = re.compile(r"(?i)\b(?:post[- ]closing|escrow|holdback|contingent(?: value right)?|CVR|recovery|subsequent (?:cash )?(?:payment|distribution|consideration)|additional (?:cash )?(?:payment|distribution|consideration))\b")
RECOVERY_ACTUAL_RE = re.compile(r"(?i)\b(?:was|were|has been|have been|had been)?\s*(?:paid|received|released|distributed|remitted)\b")
RECOVERY_MONEY_RE = re.compile(r"(?i)(?:[$€£¥]|\b(?:cash|proceeds|payment|distribution|consideration|per share|holders?)\b)")
RECOVERY_EXCLUDE_RE = re.compile(r"(?i)\b(?:will|would|may|might|could|if|unless|expected|estimated|up to|right to receive|to be paid|to be released|payable|prior to (?:the )?closing|noteholders?|receivables?|delist determination)\b")
ACTUAL_RECOVERY_TARGET_RE = re.compile(r"(?i)\b(?:cash|proceeds|payment|distribution|consideration)\b.{0,120}\b(?:paid|received|released|distributed|remitted)\b|\b(?:paid|received|released|distributed|remitted)\b.{0,120}\b(?:cash|proceeds|payment|distribution|consideration)\b")
RECOVERY_FALSE_CONTEXT_RE = re.compile(r"(?i)\b(?:demand of payment|convertible senior notes|contingent value rights|approved for listing|issued for distribution)\b")
NO_FURTHER_RE = re.compile(r"(?i)\b(?:no\s+(?:further|additional|subsequent)\s+(?:cash\s+)?distributions?|final\s+liquidating\s+distribution)\b")


class EvidenceError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise EvidenceError(message)


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        fail(f"{label} keys changed")


def git(*args: str, binary: bool = False) -> Any:
    result = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, check=True, text=not binary)
    return result.stdout if binary else result.stdout.strip()


def git_raw(commit: str, path: Path) -> bytes:
    return git("show", f"{commit}:{path.relative_to(ROOT).as_posix()}", binary=True)


def contract_self(value: dict[str, Any]) -> str:
    clone = copy.deepcopy(value)
    clone["contractSha256"] = None
    return sha(canonical(clone))


def normalized_builder(raw: bytes) -> bytes:
    text = raw.decode("utf-8").replace("\r\n", "\n")
    for name in ("EXPECTED_CONTRACT_RAW", "EXPECTED_CONTRACT_SELF", "EXPECTED_BUILDER_NORMALIZED", "EXPECTED_TEST_RAW"):
        text = re.sub(rf'(?m)^{name} = "[0-9a-f_]{{64}}"$', f'{name} = "<SELF>"', text)
    return text.encode("utf-8")


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
    output = []
    for index, block in enumerate(blocks, 1):
        text_matches = TEXT_RE.findall(block)
        if len(text_matches) != 1:
            fail("SEC document text cardinality changed")
        fields: dict[str, str] = {}
        for name, pattern in FIELD_RE.items():
            matches = pattern.findall(block)
            if len(matches) != 1:
                fail("SEC document field cardinality changed")
            fields[name] = matches[0].decode("latin-1").strip()
        output.append({"index": index, "raw": block, "textRaw": text_matches[0], **fields})
    return output


def validate_contract(value: dict[str, Any], raw: bytes | None = None, own_bytes: bool = True) -> None:
    exact_keys(value, {"schema", "createdAt", "purpose", "taskId", "track", "sourceBase", "inputs", "scanContract", "semanticCeiling", "claimLocks", "authorizedImplementation", "contractSha256"}, "contract")
    if value["schema"] != "early-detection-sec-terminal-closure-exhaustion-contract/v1" or value["createdAt"] != EXPECTED_CREATED_AT:
        fail("contract identity or time changed")
    if value["purpose"] != EXPECTED_PURPOSE or value["semanticCeiling"] != EXPECTED_CEILING:
        fail("contract claim changed")
    if datetime.fromisoformat(value["createdAt"].replace("Z", "+00:00")) > datetime.now(timezone.utc):
        fail("contract creation time is in the future")
    if value["taskId"] != "Q003-SEC-TERMINAL-CLOSURE-EXHAUSTION" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("task or track changed")
    expected_base = {"commit": SOURCE_BASE, "remote": REMOTE_URL, "ref": REMOTE_REF, "introductionRequiresDirectChild": True, "introductionAddsExactlyAuthorizedPaths": True}
    if value["sourceBase"] != expected_base:
        fail("source base changed")
    exact_keys(value["inputs"], {"inventory", "existingTerminalEvidence", "corpus"}, "inputs")
    inventory = value["inputs"]["inventory"]
    if inventory != {"path": INVENTORY.relative_to(ROOT).as_posix(), "rawSha256": "7a2947b66b9cdc26e829d19a4342b7effbbcea1c8296ca0bc46d4e05217c9711", "reportSha256": "b52b25d27e826872c83d920c3976a6aa9185c337ac48620e85ffbf323d550ab2", "introductionCommit": "a0218f4344ffa853f83a7123f886fb289cfda2e4", "expectedRows": 44352, "expectedBlobCount": 27438, "expectedBlobBytes": 326221948, "expectedBlobTreeSequenceSha256": "47b24e7e3fefe343656eaee8b256cf0a4978c3b9e39d3d1932a4265ad976ed4f"}:
        fail("inventory binding changed")
    existing = value["inputs"]["existingTerminalEvidence"]
    if existing != {"path": EXISTING.relative_to(ROOT).as_posix(), "rawSha256": "bfd0b4e4582e1267a311e5d79a63a19339e3a9967980f542148c9173c97d13dc", "reportSha256": "7967bd2ed2634568a785a5ec4e76d209db7ae10dc9ec9b1d72681144f5200104", "introductionCommit": "ee21b932abbb31c24c97fab093d8b98b62f7c3e9", "expectedRows": 5}:
        fail("existing evidence binding changed")
    if value["inputs"]["corpus"] != {"logicalRoot": "early-detection-v4/corporate-action-originals/blobs/sha256", "physicalRoot": str(CORPUS), "fileGlob": "*/*.txt"}:
        fail("corpus binding changed")
    expected_scan = {"normalization": "HTML_PARSER_WITH_SCRIPT_STYLE_EXCLUSION_AND_CONSERVATIVE_FALLBACK", "sentenceSegmentation": "REGEX_AFTER_PERIOD_EXCLAMATION_OR_QUESTION_MARK", "documentsScanned": 40818, "sentencesScanned": 1022061, "parseErrors": 0, "broadTradingEndMatches": 840, "broadFinalOrNoFurtherMatches": 5, "broadRecoveryMatches": 95, "qualifiedLastTradingRows": 23, "qualifiedNoFurtherDistributionRows": 0, "qualifiedActualPostClosingRecoveryRows": 0, "existingFinalDistributionRows": 3, "fullCorpusScanRequired": True, "twoIndependentRecoveryFiltersRequired": True, "futureConditionalEstimatedLanguageRejected": True}
    if value["scanContract"] != expected_scan:
        fail("scan contract changed")
    expected_locks = {"lastNamedExchangeTradingDayVerified": True, "lastConsolidatedSessionVerified": False, "laterOtcTradingExcluded": False, "finalLiquidatingDistributionVerified": False, "noFurtherDistributionsVerified": False, "postClosingRecoveryVerified": False, "noLaterRecoveryVerified": False, "terminalWealthComplete": False, "historicalIdentityResolved": False, "originalV4GateCredit": False, "resultComputationAllowed": False, "pricesAccessed": False, "returnsAccessed": False, "outcomesAccessed": False}
    if value["claimLocks"] != expected_locks:
        fail("claim locks changed")
    expected_impl = {"builderPath": BUILDER.relative_to(ROOT).as_posix(), "testPath": TEST.relative_to(ROOT).as_posix(), "outputPath": OUTPUT.relative_to(ROOT).as_posix()}
    if value["authorizedImplementation"] != expected_impl:
        fail("authorized implementation changed")
    if value["contractSha256"] != contract_self(value) or value["contractSha256"] != EXPECTED_CONTRACT_SELF:
        fail("contract self hash changed")
    if own_bytes:
        if raw is None or sha(raw) != EXPECTED_CONTRACT_RAW:
            fail("contract raw bytes changed")
        if sha(normalized_builder(BUILDER.read_bytes())) != EXPECTED_BUILDER_NORMALIZED or sha(TEST.read_bytes()) != EXPECTED_TEST_RAW:
            fail("implementation bytes changed")


def load_contract() -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    value = json.loads(raw)
    validate_contract(value, raw)
    return value


def load_json(path: Path, binding: dict[str, Any]) -> dict[str, Any]:
    raw = path.read_bytes()
    if sha(raw) != binding["rawSha256"]:
        fail(f"{path.name} raw bytes changed")
    value = json.loads(raw)
    if value.get("reportSha256") != binding["reportSha256"]:
        fail(f"{path.name} report binding changed")
    return value


def corpus_records(inventory: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    blob_to_rows: dict[str, list[dict[str, Any]]] = {}
    for row in inventory["rows"]:
        for blob in row["blobRefs"]:
            blob_to_rows.setdefault(blob["blobSha256"], []).append(row)
    records = []
    for path in sorted(CORPUS.rglob("*.txt"), key=lambda item: item.relative_to(CORPUS).as_posix()):
        raw = path.read_bytes()
        digest = sha(raw)
        if path.stem != digest or digest not in blob_to_rows:
            fail("corpus content address or inventory membership changed")
        accessions = {row["accession"] for row in blob_to_rows[digest]}
        if len(accessions) != 1:
            fail("corpus blob maps to multiple accessions")
        records.append({"accession": next(iter(accessions)), "blobSha256": digest, "bytes": len(raw), "relativePath": path.relative_to(CORPUS).as_posix(), "raw": raw})
    stream = hashlib.sha256()
    for item in records:
        stream.update(json.dumps({key: item[key] for key in ("accession", "blobSha256", "bytes", "relativePath")}, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8") + b"\n")
    # The caller validates the resulting count/bytes; the existing inventory
    # report binds the canonical record stream itself.
    if stream.hexdigest() != "47b24e7e3fefe343656eaee8b256cf0a4978c3b9e39d3d1932a4265ad976ed4f":
        fail("corpus tree sequence changed")
    return records, blob_to_rows


def scan(inventory: dict[str, Any], existing: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    records, blob_to_rows = corpus_records(inventory)
    rows = []
    documents = sentences_seen = broad_trading = broad_final = broad_recovery = 0
    qualified_no_further = qualified_recovery_a = qualified_recovery_b = 0
    for record in records:
        for document in sec_documents(record["raw"]):
            text, mode = normalize_text(document["textRaw"])
            sentence_rows = sentences(text)
            documents += 1
            sentences_seen += len(sentence_rows)
            for index, sentence in enumerate(sentence_rows):
                broad_trading += bool(BROAD_TRADING_RE.search(sentence))
                broad_final += bool(BROAD_FINAL_RE.search(sentence))
                broad_recovery += bool(BROAD_RECOVERY_RE.search(sentence))
                qualified_no_further += bool(NO_FURTHER_RE.search(sentence))
                recovery_a = bool(RECOVERY_ANCHOR_RE.search(sentence) and RECOVERY_ACTUAL_RE.search(sentence) and RECOVERY_MONEY_RE.search(sentence) and ACTUAL_RECOVERY_TARGET_RE.search(sentence) and not RECOVERY_EXCLUDE_RE.search(sentence) and not RECOVERY_FALSE_CONTEXT_RE.search(sentence))
                recovery_b = bool(BROAD_RECOVERY_RE.search(sentence) and ACTUAL_RECOVERY_TARGET_RE.search(sentence) and not RECOVERY_EXCLUDE_RE.search(sentence) and not RECOVERY_FALSE_CONTEXT_RE.search(sentence) and re.search(r"(?i)\b(?:was|were|has been|have been|had been)\b", sentence))
                qualified_recovery_a += recovery_a
                qualified_recovery_b += recovery_b
                if not LAST_TRADING_RE.search(sentence):
                    continue
                dates = DATE_RE.findall(sentence)
                if not dates:
                    fail("last-trading sentence lacks a date")
                month, day, year = dates[-1]
                last_date = f"{int(year):04d}-{MONTHS[month.title()]:02d}-{int(day):02d}"
                queue_rows = sorted(row["rowId"] for row in blob_to_rows[record["blobSha256"]])
                rows.append({
                    "accession": record["accession"],
                    "evidenceKind": "PRIMARY_SEC_SENTENCE_STATES_LAST_TRADING_DAY_ON_NAMED_EXCHANGE",
                    "lastNamedExchangeTradingDate": last_date,
                    "lastNamedExchangeTradingDayVerified": True,
                    "lastConsolidatedSessionVerified": False,
                    "laterOtcTradingExcluded": False,
                    "terminalWealthComplete": False,
                    "outcomesAccessed": False,
                    "queueRowIds": queue_rows,
                    "sourceRef": {"blobSha256": record["blobSha256"], "bytes": record["bytes"], "relativePath": record["relativePath"], "documentIndex": document["index"], "documentType": document["TYPE"], "documentSequence": document["SEQUENCE"], "documentFilename": document["FILENAME"], "rawDocumentSha256": sha(document["raw"]), "rawTextSha256": sha(document["textRaw"]), "normalizationMode": mode, "locator": f"sentence[{index}]", "evidenceSha256": sha(sentence.encode("utf-8"))},
                })
    rows.sort(key=lambda row: (row["lastNamedExchangeTradingDate"], row["accession"], row["sourceRef"]["blobSha256"]))
    if len({row["accession"] for row in rows}) != len(rows) or len({row["sourceRef"]["blobSha256"] for row in rows}) != len(rows):
        fail("qualified rows are not unique")
    final_rows = [row for row in existing["rows"] if row["evidenceKind"] == "DATED_FINAL_DISTRIBUTION_TO_HOLDERS_STATED"]
    summary = {"blobCount": len(records), "blobBytes": sum(item["bytes"] for item in records), "documentsScanned": documents, "sentencesScanned": sentences_seen, "parseErrors": 0, "broadTradingEndMatches": broad_trading, "broadFinalOrNoFurtherMatches": broad_final, "broadRecoveryMatches": broad_recovery, "qualifiedLastTradingRows": len(rows), "qualifiedNoFurtherDistributionRows": qualified_no_further, "qualifiedActualPostClosingRecoveryRowsFilterA": qualified_recovery_a, "qualifiedActualPostClosingRecoveryRowsFilterB": qualified_recovery_b, "existingFinalDistributionRows": len(final_rows)}
    return rows, summary


def topology(remote_required: bool) -> dict[str, Any]:
    head = git("rev-parse", "HEAD")
    upstream = git("rev-parse", "@{u}")
    if git("config", "--get", "remote.origin.url") != REMOTE_URL or upstream != head:
        fail("local Git binding changed")
    remote = git("ls-remote", "origin", REMOTE_REF).split()[0] if remote_required else None
    if remote_required and remote != head:
        fail("live remote changed")
    authorized = sorted([CONTRACT.relative_to(ROOT).as_posix(), BUILDER.relative_to(ROOT).as_posix(), TEST.relative_to(ROOT).as_posix()])
    exists = []
    for path in authorized:
        probe = subprocess.run(["git", "cat-file", "-e", f"HEAD:{path}"], cwd=ROOT, capture_output=True)
        exists.append(probe.returncode == 0)
    if all(exists):
        parent = git("rev-parse", "HEAD^")
        if parent != SOURCE_BASE or len(git("rev-list", "--parents", "-n", "1", head).split()) != 2:
            fail("introduction topology changed")
        changed = sorted(line.split("\t", 1) for line in git("diff-tree", "--no-commit-id", "--name-status", "-r", head).splitlines())
        if changed != [["A", path] for path in authorized]:
            fail("introduction delta changed")
        for path in (CONTRACT, BUILDER, TEST):
            if git_raw(head, path) != path.read_bytes():
                fail("introduction bytes changed")
        phase = "POST_INTRODUCTION"
    elif not any(exists) and head == SOURCE_BASE:
        phase = "PRE_INTRODUCTION"
    else:
        fail("partial or displaced introduction")
    return {"phase": phase, "head": head, "remoteVerified": bool(remote_required), "introductionCommit": head if phase == "POST_INTRODUCTION" else None}


def build_report(contract: dict[str, Any], inventory: dict[str, Any], existing: dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    rows, summary = scan(inventory, existing)
    expected = {"blobCount": 27438, "blobBytes": 326221948, "documentsScanned": 40818, "sentencesScanned": 1022061, "parseErrors": 0, "broadTradingEndMatches": 840, "broadFinalOrNoFurtherMatches": 5, "broadRecoveryMatches": 95, "qualifiedLastTradingRows": 23, "qualifiedNoFurtherDistributionRows": 0, "qualifiedActualPostClosingRecoveryRowsFilterA": 0, "qualifiedActualPostClosingRecoveryRowsFilterB": 0, "existingFinalDistributionRows": 3}
    if summary != expected:
        fail("scan population changed: " + json.dumps(summary, sort_keys=True))
    report = {"schema": "early-detection-sec-terminal-closure-exhaustion/v1", "taskId": contract["taskId"], "track": contract["track"], "semanticCeiling": contract["semanticCeiling"], "claimLocks": copy.deepcopy(contract["claimLocks"]), "inputBindings": {"inventoryRawSha256": contract["inputs"]["inventory"]["rawSha256"], "inventoryReportSha256": contract["inputs"]["inventory"]["reportSha256"], "existingTerminalEvidenceRawSha256": contract["inputs"]["existingTerminalEvidence"]["rawSha256"], "existingTerminalEvidenceReportSha256": contract["inputs"]["existingTerminalEvidence"]["reportSha256"], "blobTreeSequenceSha256": contract["inputs"]["inventory"]["expectedBlobTreeSequenceSha256"]}, "implementationBindings": {"contractRawSha256": EXPECTED_CONTRACT_RAW, "builderNormalizedSha256": EXPECTED_BUILDER_NORMALIZED, "testRawSha256": EXPECTED_TEST_RAW, "sourceBaseCommit": SOURCE_BASE, "introductionCommit": state["introductionCommit"], "remote": REMOTE_URL, "ref": REMOTE_REF}, "scanSummary": summary, "rows": rows, "reportSha256": None}
    report["reportSha256"] = sha(canonical({key: value for key, value in report.items() if key != "reportSha256"}))
    return report


def validate_report(value: dict[str, Any], expected: dict[str, Any]) -> None:
    if value != expected:
        fail("report changed from exact source rebuild")


def rejected(action: Callable[[], None]) -> bool:
    try:
        action()
    except Exception:
        return True
    return False


def self_test(contract: dict[str, Any], inventory: dict[str, Any], existing: dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    report = build_report(contract, inventory, existing, state)
    mutations: dict[str, bool] = {}
    for name, mutate in {
        "dropRow": lambda x: x["rows"].pop(),
        "lastDate": lambda x: x["rows"][0].__setitem__("lastNamedExchangeTradingDate", "1970-01-01"),
        "consolidated": lambda x: x["rows"][0].__setitem__("lastConsolidatedSessionVerified", True),
        "otc": lambda x: x["rows"][0].__setitem__("laterOtcTradingExcluded", True),
        "terminal": lambda x: x["rows"][0].__setitem__("terminalWealthComplete", True),
        "outcome": lambda x: x["claimLocks"].__setitem__("outcomesAccessed", True),
        "recovery": lambda x: x["claimLocks"].__setitem__("postClosingRecoveryVerified", True),
        "noFurther": lambda x: x["scanSummary"].__setitem__("qualifiedNoFurtherDistributionRows", 1),
        "source": lambda x: x["rows"][0]["sourceRef"].__setitem__("evidenceSha256", "0" * 64),
        "queue": lambda x: x["rows"][0]["queueRowIds"].pop(),
    }.items():
        altered = copy.deepcopy(report)
        mutate(altered)
        altered["reportSha256"] = sha(canonical({key: value for key, value in altered.items() if key != "reportSha256"}))
        mutations[name] = rejected(lambda altered=altered: validate_report(altered, report))
    contract_attacks = {}
    for name, mutate in {
        "purpose": lambda x: x.__setitem__("purpose", "terminal wealth complete"),
        "backdate": lambda x: x.__setitem__("createdAt", "1970-01-01T00:00:00Z"),
        "input": lambda x: x["inputs"]["inventory"].__setitem__("expectedRows", 1),
        "zero": lambda x: x["scanContract"].__setitem__("qualifiedActualPostClosingRecoveryRows", 1),
        "credit": lambda x: x["claimLocks"].__setitem__("originalV4GateCredit", True),
        "path": lambda x: x["authorizedImplementation"].__setitem__("outputPath", "private.json"),
    }.items():
        altered = copy.deepcopy(contract)
        mutate(altered)
        altered["contractSha256"] = contract_self(altered)
        contract_attacks[name] = rejected(lambda altered=altered: validate_contract(altered, own_bytes=False))
    if not all(mutations.values()) or not all(contract_attacks.values()):
        fail("adversarial mutation survived")
    return {"status": "PASS", "mutationsKilled": mutations, "contractMutationsKilled": contract_attacks, "verifiedRows": len(report["rows"]), "outcomesAccessed": False}


def write_new(raw: bytes) -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    if OUTPUT.exists():
        fail("output already exists")
    fd, temporary = tempfile.mkstemp(prefix=f".{OUTPUT.name}.", suffix=".tmp", dir=OUTPUT.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.link(temporary, OUTPUT)
    finally:
        Path(temporary).unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify-contract", "dry-run", "self-test", "build", "verify-output"))
    parser.add_argument("--remote", action="store_true")
    args = parser.parse_args()
    if not args.remote:
        fail("live remote verification required")
    contract = load_contract()
    inventory = load_json(INVENTORY, contract["inputs"]["inventory"])
    existing = load_json(EXISTING, contract["inputs"]["existingTerminalEvidence"])
    state = topology(True)
    if args.command == "verify-contract":
        print(json.dumps({"status": "PASS", **state, "outcomesAccessed": False}, sort_keys=True))
        return 0
    if args.command == "self-test":
        print(json.dumps(self_test(contract, inventory, existing, state), sort_keys=True))
        return 0
    report = build_report(contract, inventory, existing, state)
    raw = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
    if args.command == "dry-run":
        print(json.dumps({"status": "PASS", **state, "rows": len(report["rows"]), "scanSummary": report["scanSummary"], "reportSha256": report["reportSha256"], "rawSha256": sha(raw), "outcomesAccessed": False}, sort_keys=True))
        return 0
    if args.command == "build":
        if state["phase"] != "POST_INTRODUCTION":
            fail("build requires remote introduction")
        write_new(raw)
        print(json.dumps({"status": "PASS", "outputCreated": True, "rawSha256": sha(raw), "reportSha256": report["reportSha256"], "outcomesAccessed": False}, sort_keys=True))
        return 0
    if not OUTPUT.exists():
        fail("output missing")
    actual_raw = OUTPUT.read_bytes()
    if EXPECTED_OUTPUT_RAW is not None and sha(actual_raw) != EXPECTED_OUTPUT_RAW:
        fail("output raw bytes changed")
    actual = json.loads(actual_raw)
    validate_report(actual, report)
    if EXPECTED_OUTPUT_SELF is not None and actual["reportSha256"] != EXPECTED_OUTPUT_SELF:
        fail("output self hash changed")
    print(json.dumps({"status": "PASS", **state, "rows": len(actual["rows"]), "rawSha256": sha(actual_raw), "reportSha256": actual["reportSha256"], "outcomesAccessed": False}, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (EvidenceError, subprocess.CalledProcessError, json.JSONDecodeError, OSError) as exc:
        print(json.dumps({"status": "FAIL", "error": str(exc)}))
        raise SystemExit(2)
