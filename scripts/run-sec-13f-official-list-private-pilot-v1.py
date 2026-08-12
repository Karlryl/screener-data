#!/usr/bin/env python3
"""Run one private, rights-aware SEC 13F-list capability pilot."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import tempfile
import urllib.request
from pathlib import Path
from typing import Any

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-13f-official-list-private-pilot-contract-v1.json"
GAP = ROOT / "reports" / "early-detection" / "sec-terminal-identity-evidence-gap-queue-v1.json"
EXTRACTION = ROOT / "reports" / "early-detection" / "sec-terminal-primary-document-extraction-v1.json"
PRIVATE_ROOT = Path(os.environ.get("GROWTH_SCREENER_PRIVATE_EVIDENCE", ROOT.parents[1] / "private-evidence"))
PRIVATE_DIR = PRIVATE_ROOT / "sec-13f-official-list" / "2009q4"
PRIVATE_PDF = PRIVATE_DIR / "13flist2009q4.pdf"
PRIVATE_REPORT = PRIVATE_DIR / "pilot-report-v1.json"
EXPECTED_CONTRACT_RAW = "a432e808953f3208cb9f723c5e9778b7257dbbd0df4a7c25f5e359a2ab0e2018"
EXPECTED_CONTRACT_SELF = "7f7c4f3ed03dbd3c631a950eb5192eaa613cff01c0025c70cb096334ab2051a9"
EXPECTED_GAP_RAW = "4c5bff255368bb0d9f498a8f367c65964c0de80d577cca70c695afe50ce0c650"
EXPECTED_EXTRACTION_RAW = "987560ca38931cfa818f6c9fb315be7875ec98fd872518ef51d45f5af3589464"
SOURCE_URL = "https://www.sec.gov/divisions/investment/13f/13flist2009q4.pdf"
USER_AGENT = "Growth-Screener-Research/1.0 contact=https://github.com/Karlryl/screener-data"
CUSIP_TEXT = re.compile(r"(?i)\bCUSIP\s*(?:NO\.?|NUMBER)?\s*[:#]?\s*([0-9A-Z]{6})\s*[- ]?\s*([0-9A-Z]{2})\s*[- ]?\s*([0-9A-Z])\b")
LIST_ROW = re.compile(r"^([0-9A-Z]{6})\s+([0-9A-Z]{2})\s+([0-9A-Z])\s+(.+)$")
RIGHTS_MARKERS = (
    "No redistribution without permission",
    "CUSIP Numbers and descriptions are used with permission",
)


class PilotError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise PilotError(message)


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def load_json(path: Path, expected_raw: str) -> dict[str, Any]:
    raw = path.read_bytes()
    if sha(raw) != expected_raw:
        fail(f"input bytes changed: {path}")
    value = json.loads(raw)
    if not isinstance(value, dict):
        fail("object required")
    return value


def validate_contract() -> dict[str, Any]:
    value = load_json(CONTRACT, EXPECTED_CONTRACT_RAW)
    body = dict(value)
    claim = body.pop("contractSha256", None)
    if claim != EXPECTED_CONTRACT_SELF or sha(canonical(body)) != EXPECTED_CONTRACT_SELF:
        fail("contract self hash changed")
    policy = value["pilotPolicy"]
    if policy != {
        "networkRequests": 1,
        "quarter": "2009Q4",
        "privateRawStorageRequired": True,
        "publicRawCusipStorageAllowed": False,
        "publicIssuerDescriptionStorageAllowed": False,
        "publicOutputAllowed": "AGGREGATE_COUNTS_HASHES_AND_NON_CUSIP_ROW_IDS_ONLY",
        "matchPolicy": "EXACT_CUSIP_ONLY_WHEN_A_PRIMARY_SEC_SOURCE_ROW_ALREADY_CONTAINS_THE_SAME_CUSIP",
        "issuerNameOnlyMatchAllowed": False,
        "tickerOnlyJoinAllowed": False,
        "pointEvidenceMayResolveIdentity": False,
        "futureFullArchiveRequiresNewContract": True,
    }:
        fail("pilot policy changed")
    if value["officialSource"]["pilotUrl"] != SOURCE_URL or value["claimLocks"] != {
        "outcomesAccessed": False,
        "pricesAccessed": False,
        "returnsAccessed": False,
        "historicalIdentityIntervalsComplete": False,
        "securityIdentityResolved": False,
        "listingIdentityResolved": False,
        "terminalWealthComplete": False,
        "originalV4GateCredit": False,
        "humanAttestation": False,
    }:
        fail("claim boundary changed")
    return value


def extract_text(pdf_raw: bytes) -> list[str]:
    if not pdf_raw.startswith(b"%PDF-"):
        fail("PDF signature missing")
    reader = PdfReader(io.BytesIO(pdf_raw))
    pages = [(page.extract_text() or "") for page in reader.pages]
    if len(pages) < 400:
        fail("unexpected PDF page count")
    return pages


def parse_list_cusips(pages: list[str]) -> set[str]:
    rows: set[str] = set()
    for page in pages[2:]:
        for source_line in page.splitlines():
            line = " ".join(source_line.split())
            match = LIST_ROW.fullmatch(line)
            if match:
                rows.add("".join(match.groups()[:3]))
    if len(rows) < 8_000:
        fail("too few strict CUSIP rows")
    return rows


def source_candidates(gap: dict[str, Any], extraction: dict[str, Any]) -> list[dict[str, str]]:
    gap_accessions = {row["accession"] for row in gap["rows"]}
    candidates: list[dict[str, str]] = []
    for row in extraction["rows"]:
        if row["accession"] not in gap_accessions:
            fail("extraction row not in frozen gap")
        matches = {"".join(match.groups()).upper() for match in CUSIP_TEXT.finditer(row["text"])}
        for cusip in sorted(matches):
            candidates.append({"accession": row["accession"], "extractionRowId": row["extractionRowId"], "cusip": cusip})
    return candidates


def build_private_report(pdf_raw: bytes) -> dict[str, Any]:
    gap = load_json(GAP, EXPECTED_GAP_RAW)
    extraction = load_json(EXTRACTION, EXPECTED_EXTRACTION_RAW)
    pages = extract_text(pdf_raw)
    first_text = "\n".join(pages[:2])
    if not all(marker.casefold() in first_text.casefold() for marker in RIGHTS_MARKERS):
        fail("rights notice missing")
    official_cusips = parse_list_cusips(pages)
    candidates = source_candidates(gap, extraction)
    exact_matches = [item for item in candidates if item["cusip"] in official_cusips]
    report: dict[str, Any] = {
        "schema": "sec-13f-official-list-private-pilot-report/v1",
        "sourceUrl": SOURCE_URL,
        "quarter": "2009Q4",
        "pdfRawSha256": sha(pdf_raw),
        "pdfBytes": len(pdf_raw),
        "pdfPages": len(pages),
        "rightsNoticeDetected": True,
        "strictOfficialCusipRows": len(official_cusips),
        "eligiblePrimarySecCusipOccurrences": len(candidates),
        "eligiblePrimarySecRowsWithCusip": len({item["extractionRowId"] for item in candidates}),
        "privateExactCusipMatches": len(exact_matches),
        "matchedExtractionRowIds": sorted({item["extractionRowId"] for item in exact_matches}),
        "publicCusipOrDescriptionExported": False,
        "identityCreditGranted": False,
        "outcomesAccessed": False,
        "pricesAccessed": False,
    }
    report["reportSha256"] = sha(canonical(report))
    return report


def atomic_create(path: Path, raw: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        fail(f"refusing overwrite: {path}")
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.link(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def fetch() -> bytes:
    request = urllib.request.Request(SOURCE_URL, headers={"User-Agent": USER_AGENT, "Accept": "application/pdf"})
    with urllib.request.urlopen(request, timeout=120) as response:
        if response.status != 200 or "application/pdf" not in response.headers.get("Content-Type", "").casefold():
            fail("unexpected SEC response")
        return response.read()


def self_test() -> dict[str, Any]:
    return {
        "historicalRealIdentifierFixtureRemoved": True,
        "futureExecutionSuperseded": True,
        "publicCusipExportForbidden": validate_contract()["pilotPolicy"]["publicRawCusipStorageAllowed"] is False,
        "identityCreditForbidden": validate_contract()["pilotPolicy"]["pointEvidenceMayResolveIdentity"] is False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("verify-contract")
    sub.add_parser("self-test")
    sub.add_parser("run")
    args = parser.parse_args()
    validate_contract()
    if args.command == "verify-contract":
        print(json.dumps({"status": "PASS", "contractSha256": EXPECTED_CONTRACT_SELF}, sort_keys=True))
        return 0
    if args.command == "self-test":
        result = self_test()
        if not all(result.values()):
            fail("self-test failed")
        print(json.dumps({"status": "PASS", **result}, sort_keys=True))
        return 0
    fail("V1 execution superseded by zero-credit V2 disposition")
    pdf_raw = fetch()
    report = build_private_report(pdf_raw)
    atomic_create(PRIVATE_PDF, pdf_raw)
    atomic_create(PRIVATE_REPORT, json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n")
    if PRIVATE_PDF.read_bytes() != pdf_raw or json.loads(PRIVATE_REPORT.read_bytes()) != report:
        fail("private readback mismatch")
    print(json.dumps({"status": "PASS", **{key: value for key, value in report.items() if key not in {"matchedExtractionRowIds"}}}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
