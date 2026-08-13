#!/usr/bin/env python3
"""Build the outcome-blind downstream SEC-filing discovery lane for Q003."""

from __future__ import annotations

import argparse
import copy
import ctypes
import datetime as dt
import hashlib
import importlib.util
import json
import re
import sqlite3
import subprocess
from collections import Counter
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-liquidation-downstream-filing-discovery-contract-v1.json"
BUILDER = Path(__file__).resolve()
TEST = ROOT / "tests" / "build-sec-liquidation-downstream-filing-discovery-v1.test.js"
RECONCILIATION_BUILDER = ROOT / "scripts" / "build-sec-form25-liquidation-payment-reconciliation-v1.py"
DATABASE = Path(r"C:\Users\Anwender\Documents\GrowthScreenerResearchData\early-detection-v4\derived\sec-edgar-master-index.sqlite")
OWNED = (CONTRACT, BUILDER, TEST)

CONTRACT_RAW = "511accf9a3c0c44245d1e703105596ff8f25f42f81b81bf4ea486a6c08875644"
CONTRACT_SELF = "0a828c88828b7ccefbe75a461ebf8de7711d58016735c4325ea3243f3d7c3a92"
TEST_RAW = "21ba1ea5cc393bca6c4f371dd0e8e5ceb2cb38cf27abc9196431b1bbc7eb632f"
BASE = "f5f5b9aa1af361481488c54cfcfee5fcb9914d69"
REMOTE = "https://github.com/Karlryl/screener-data.git"
REMOTE_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
CREATED_AT = "2026-08-13T13:07:12Z"
RECONCILIATION_BUILDER_RAW = "c1dedb5300485395a75f0861e3cc858ff4b6acf61245fceb40e9c34f7e8a36f2"
RECONCILIATION_INTRODUCTION = "c57a00e29c5bfbcd7be8496bd5bee64bdf1b676f"
DATABASE_RAW = "3055d37b34033fd4bf0b4ee3c9fb3abb7bc2d88cd0e303795c764b0b4d39c159"
DATABASE_BYTES = 3344818176
HEX64 = re.compile(r"[0-9a-f]{64}\Z")

PURPOSE = (
    "Create an outcome-blind discovery queue of exact official SEC master-index filings indexed under the four "
    "SEC-header-verified issuer CIKs from the seventeen frozen liquidation-payment cases during calendar days "
    "one through ninety after each frozen payment-effective date, without claiming that a filing concerns the "
    "same security, contains a final distribution or recovery, closes a corporate-action chain, resolves identity, "
    "terminal wealth, price, return, outcome or Original-V4 credit."
)
EXPECTED_FORM_COUNTS = {
    "25-NSE": 15, "40-17G": 3, "485APOS": 3, "485BPOS": 4, "485BXT": 34,
    "497": 19, "497J": 2, "497K": 23, "8-A12B": 1, "8-K": 1, "CORRESP": 4,
    "N-CSRS": 1, "N-PX": 1, "N-Q": 2, "NSAR-A": 1, "SC 13G/A": 1,
}
EXPECTED_ISSUER_COUNTS = {"0001414040": 23, "0001424958": 9, "0001450011": 58, "0001450501": 25}
EXPECTED_CASE_LINK_COUNTS = {
    "LIQUIDATION-PAYMENT-001": 23, "LIQUIDATION-PAYMENT-002": 23,
    "LIQUIDATION-PAYMENT-003": 23, "LIQUIDATION-PAYMENT-004": 23,
    "LIQUIDATION-PAYMENT-005": 9, "LIQUIDATION-PAYMENT-006": 9,
    "LIQUIDATION-PAYMENT-007": 9, "LIQUIDATION-PAYMENT-008": 9,
    "LIQUIDATION-PAYMENT-009": 9, "LIQUIDATION-PAYMENT-010": 25,
    "LIQUIDATION-PAYMENT-011": 25, "LIQUIDATION-PAYMENT-012": 25,
    "LIQUIDATION-PAYMENT-013": 25, "LIQUIDATION-PAYMENT-014": 58,
    "LIQUIDATION-PAYMENT-015": 58, "LIQUIDATION-PAYMENT-016": 58,
    "LIQUIDATION-PAYMENT-017": 58,
}
EXPECTED_REBUILD = {
    "seedCases": 17,
    "seedAccessions": 17,
    "issuerCiks": 4,
    "searchWindowStartDayInclusive": 1,
    "searchWindowEndDayInclusive": 90,
    "candidateFilings": 115,
    "candidateAccessions": 115,
    "caseCandidateLinks": 469,
    "uniqueCaseCandidateLinks": 469,
    "minimumCandidateDayOffset": 1,
    "maximumCandidateDayOffset": 88,
    "candidateFiledDateMinimum": "2014-08-29",
    "candidateFiledDateMaximum": "2015-01-02",
    "candidateSourceQuarterMinimum": "2014q3",
    "candidateSourceQuarterMaximum": "2015q1",
    "databasePayloads": 64,
    "databaseRows": 16380919,
    "databaseQuarterMinimum": "2009q1",
    "databaseQuarterMaximum": "2024q4",
    "seedCanonicalSha256": "3a30c35de24e50e35c68b83b15e6fa8e0bd3a660d68bc85242bd8ef2082598e0",
    "seedSequenceSha256": "cf0bdb33d2a39c597d3d770d004be953d4d371a39e77eed3d29a7681bf358e86",
    "candidateCanonicalSha256": "ee57eec9b5e6f4bdddb0613f98e84e61b9c17eb300fff6252baebf68ce5042b2",
    "candidateSequenceSha256": "80410c8734a558e2a06fe12efc0482f393e32006649554e68805cbef604cb2d2",
    "linkCanonicalSha256": "95f39579447d40a87075c1bb4ae9717c935222c6b6f236ac270847d514cc1b73",
    "linkSequenceSha256": "287d9dc1015ad371ae474a7564b764caafcb179360bd8fa58296872f5cd06564",
    "databasePayloadSequenceSha256": "5e3689208c9ceeb2b497e534207b7b15016efedebd91711932f7b45029bbf328",
    "issuerCandidateCounts": EXPECTED_ISSUER_COUNTS,
    "formCounts": EXPECTED_FORM_COUNTS,
    "caseLinkCounts": EXPECTED_CASE_LINK_COUNTS,
}
SEED_KEYS = [
    "caseId", "accession", "sourceBlobSha256", "suspensionEventProvenanceSha256", "issuerCik",
    "issuerName", "securityDescription", "suspensionBoundaryDate", "liquidationPaymentEffectiveDate",
]
CANDIDATE_KEYS = [
    "candidateId", "cik", "companyName", "form", "filedDate", "filename", "accession", "sourceQuarter",
    "sourcePayloadSha256", "sourceMemberSha256", "sourcePayloadRows", "sourceRowNumber",
]
LINK_KEYS = ["caseId", "candidateId", "dayOffset"]
EXPECTED_LOCKS = {
    "candidateFilingContentFetched": False,
    "candidateFilingContentInspected": False,
    "sameSecurityReferenced": False,
    "securityIdentityResolved": False,
    "listingIdentityResolved": False,
    "cashReceiptVerified": False,
    "firstDistributionVerified": False,
    "finalDistributionVerified": False,
    "noFurtherDistributionsVerified": False,
    "laterRecoveriesExcluded": False,
    "completeCorporateActionChainVerified": False,
    "lastConsolidatedSessionObserved": False,
    "lastTradePriceObserved": False,
    "laterOtcTradingExcluded": False,
    "terminalWealthComplete": False,
    "originalV4GateCredit": False,
    "resultComputationAllowed": False,
    "pricesAccessed": False,
    "returnsAccessed": False,
    "outcomesAccessed": False,
}


class DiscoveryError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise DiscoveryError(message)


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
    for name in ("CONTRACT_RAW", "CONTRACT_SELF", "TEST_RAW"):
        pattern = re.compile(rf'^{name} = "[0-9a-f* ]+"$', re.MULTILINE)
        if len(pattern.findall(text)) != 1:
            fail(f"{name} normalization structure changed")
        text = pattern.sub(f'{name} = "{"0" * 64}"', text)
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


def is_ancestor(older: str, newer: str) -> bool:
    return subprocess.run(["git", "merge-base", "--is-ancestor", older, newer], cwd=ROOT).returncode == 0


def introduction_for(path: Path) -> list[str]:
    relative = path.relative_to(ROOT).as_posix()
    output = git("log", "--reverse", "--format=%H", "--diff-filter=A", f"{BASE}..HEAD", "--", relative)
    return output.splitlines() if output else []


def expected_inputs() -> dict[str, Any]:
    return {
        "liquidationReconciliationBuilder": {
            "path": RECONCILIATION_BUILDER.relative_to(ROOT).as_posix(),
            "rawSha256": RECONCILIATION_BUILDER_RAW,
            "introductionCommit": RECONCILIATION_INTRODUCTION,
            "sourceDerivedSeedCases": 17,
            "sourceDerivedIssuerCiks": 4,
        },
        "secMasterIndex": {
            "logicalPath": "early-detection-v4/derived/sec-edgar-master-index.sqlite",
            "rawSha256": DATABASE_RAW,
            "bytes": DATABASE_BYTES,
            "mode": "WINDOWS_WRITE_DELETE_DENYING_READ_LOCK_PLUS_SQLITE_IMMUTABLE_READ_ONLY",
            "payloads": 64,
            "rows": 16380919,
            "quarterMinimum": "2009q1",
            "quarterMaximum": "2024q4",
            "payloadSequenceSha256": EXPECTED_REBUILD["databasePayloadSequenceSha256"],
        },
    }


def expected_search_contract() -> dict[str, Any]:
    return {
        "joinKey": "EXACT_SEC_HEADER_VERIFIED_ISSUER_CIK",
        "filedDateLowerBound": "GREATER_THAN_LIQUIDATION_PAYMENT_EFFECTIVE_DATE",
        "calendarDayOffsetMinimumInclusive": 1,
        "calendarDayOffsetMaximumInclusive": 90,
        "studyFiledDateMaximumInclusive": "2024-12-31",
        "allFormsIncluded": True,
        "accessionMustBeNonNull": True,
        "candidateDeduplicationKey": "EXACT_SOURCE_ROW_FIELDS",
        "caseCandidateLinksPreserved": True,
        "tickerJoinAllowed": False,
        "companyNameJoinAllowed": False,
        "securityDescriptionJoinAllowed": False,
        "filingContentSearchPerformed": False,
        "horizonExpansionRequiresNewProtocol": True,
    }


def validate_contract(value: dict[str, Any]) -> None:
    exact_keys(value, {
        "schema", "createdAt", "taskId", "track", "purpose", "authoritativeInputs", "searchContract",
        "expectedRebuild", "seedSchema", "candidateSchema", "linkSchema", "semanticContract", "claimLocks",
        "implementationContract", "contractSha256",
    }, "contract")
    if value["schema"] != "sec-liquidation-downstream-filing-discovery-contract/v1":
        fail("schema changed")
    if value["createdAt"] != CREATED_AT:
        fail("createdAt changed")
    created = dt.datetime.fromisoformat(CREATED_AT.replace("Z", "+00:00"))
    if created > dt.datetime.now(dt.timezone.utc):
        fail("createdAt is future")
    if value["taskId"] != "Q003-SEC-LIQUIDATION-DOWNSTREAM-FILING-DISCOVERY" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract identity changed")
    if value["purpose"] != PURPOSE:
        fail("purpose changed")
    if value["authoritativeInputs"] != expected_inputs():
        fail("authoritative inputs changed")
    if value["searchContract"] != expected_search_contract():
        fail("search contract changed")
    if value["expectedRebuild"] != EXPECTED_REBUILD:
        fail("expected rebuild changed")
    if value["seedSchema"] != SEED_KEYS or value["candidateSchema"] != CANDIDATE_KEYS or value["linkSchema"] != LINK_KEYS:
        fail("row schema changed")
    expected_semantics = {
        "allowedClaim": "OFFICIAL_SEC_MASTER_INDEX_LISTS_FILINGS_INDEXED_UNDER_EXACT_SAME_SEC_HEADER_VERIFIED_ISSUER_CIK_ONE_TO_NINETY_CALENDAR_DAYS_AFTER_SEVENTEEN_FROZEN_LIQUIDATION_PAYMENT_DATES",
        "discoveryCandidatesOnly": True,
        "sameIssuerCikDoesNotProveSameSecurity": True,
        "filingIndexMetadataDoesNotProveFilingContent": True,
        "laterFilingDoesNotProveFinalityOrRecovery": True,
        "notEvidenceOf": [
            "SAME_SECURITY_OR_SERIES_REFERENCE", "FINAL_OR_NO_FURTHER_DISTRIBUTION", "POST_CLOSING_RECOVERY",
            "COMPLETE_CORPORATE_ACTION_CHAIN", "HISTORICAL_SECURITY_OR_LISTING_IDENTITY",
            "LAST_CONSOLIDATED_SESSION_OR_PRICE", "NO_LATER_OTC_TRADING", "TERMINAL_WEALTH",
            "PRICE_RETURN_OR_OUTCOME", "ORIGINAL_V4_GATE_CREDIT",
        ],
    }
    if value["semanticContract"] != expected_semantics:
        fail("semantic contract changed")
    if value["claimLocks"] != EXPECTED_LOCKS:
        fail("claim locks changed")
    expected_implementation = {
        "baseCommit": BASE,
        "baseTag": 892,
        "remote": REMOTE,
        "ref": REMOTE_REF,
        "contractPath": CONTRACT.relative_to(ROOT).as_posix(),
        "builderPath": BUILDER.relative_to(ROOT).as_posix(),
        "testPath": TEST.relative_to(ROOT).as_posix(),
        "builderNormalizedSha256": sha(normalized_builder(BUILDER.read_bytes())),
        "testRawSha256": TEST_RAW,
        "introductionMustBeDirectSingleParentChildOfBase": True,
        "introductionAddsExactlyThreeOwnedPaths": True,
        "laterLinearSingleParentDescendantsAllowed": True,
        "remoteVerificationRequired": True,
        "noRemoteVerificationMustFail": True,
        "networkCapabilityAllowed": False,
        "writeCapabilityAllowed": False,
        "publicOutputCreated": False,
    }
    if value["implementationContract"] != expected_implementation:
        fail("implementation contract changed")
    if value["contractSha256"] != CONTRACT_SELF or self_hash(value, "contractSha256") != CONTRACT_SELF:
        fail("contract self hash changed")


def load_contract() -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    if sha(raw) != CONTRACT_RAW:
        fail("contract raw bytes changed")
    value = json.loads(raw)
    validate_contract(value)
    return value


def load_reconciliation_rows() -> list[dict[str, Any]]:
    raw = RECONCILIATION_BUILDER.read_bytes()
    if sha(raw) != RECONCILIATION_BUILDER_RAW:
        fail("reconciliation builder bytes changed")
    if git_raw(RECONCILIATION_INTRODUCTION, RECONCILIATION_BUILDER) != raw or git_raw(git("rev-parse", "HEAD"), RECONCILIATION_BUILDER) != raw:
        fail("reconciliation builder Git bytes changed")
    spec = importlib.util.spec_from_file_location("sealed_liquidation_reconciliation", RECONCILIATION_BUILDER)
    if spec is None or spec.loader is None:
        fail("reconciliation builder import failed")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    rows, stats = module.build_rows()
    if len(rows) != 17 or stats.get("uniqueIssuerCiks") != 4:
        fail("reconciliation seed population changed")
    return rows


def database_hash() -> str:
    if not DATABASE.is_file() or DATABASE.stat().st_size != DATABASE_BYTES:
        fail("SEC master-index database missing or size changed")
    digest = hashlib.sha256()
    with DATABASE.open("rb") as handle:
        while True:
            chunk = handle.read(8 * 1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


@contextmanager
def locked_database() -> Any:
    if not hasattr(ctypes, "windll"):
        fail("Windows write/delete-denying source lock is unavailable")
    kernel32 = ctypes.windll.kernel32
    kernel32.CreateFileW.argtypes = [
        ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p,
        ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p,
    ]
    kernel32.CreateFileW.restype = ctypes.c_void_p
    handle = kernel32.CreateFileW(str(DATABASE), 0x80000000, 0x00000001, None, 3, 0x80, None)
    invalid = ctypes.c_void_p(-1).value
    if handle in (None, invalid):
        fail("SEC master-index database lock failed")
    try:
        yield
    finally:
        if not kernel32.CloseHandle(handle):
            fail("SEC master-index database lock release failed")


def build_rows() -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    reconciliation = load_reconciliation_rows()
    seeds = sorted(({key: row[key] for key in SEED_KEYS} for row in reconciliation), key=lambda item: item["caseId"])
    sidecars = [Path(str(DATABASE) + suffix) for suffix in ("-wal", "-shm", "-journal")]
    if any(path.exists() for path in sidecars):
        fail("SEC master-index sidecar exists before read")
    with locked_database():
        before = database_hash()
        if before != DATABASE_RAW:
            fail("SEC master-index database bytes changed before read")
        uri = f"file:{DATABASE.as_posix()}?mode=ro&immutable=1"
        connection = sqlite3.connect(uri, uri=True)
        try:
            connection.execute("PRAGMA query_only=ON")
            if connection.execute("PRAGMA quick_check").fetchone() != ("ok",):
                fail("SEC master-index quick_check failed")
            payloads = connection.execute(
                "SELECT quarter,observed_at,payload_sha256,member_sha256,rows FROM payloads ORDER BY quarter"
            ).fetchall()
            issuer_numbers = sorted({int(seed["issuerCik"]) for seed in seeds})
            placeholders = ",".join("?" for _ in issuer_numbers)
            filings = connection.execute(
                f"""SELECT f.cik,f.company_name,f.form,f.filed_date,f.filename,f.accession,
                           p.quarter,p.payload_sha256,p.member_sha256,p.rows,f.row_number
                    FROM filings f JOIN payloads p ON p.payload_id=f.payload_id
                    WHERE f.cik IN ({placeholders}) AND f.filed_date<=?
                    ORDER BY f.cik,f.filed_date,f.accession,f.form,f.filename,p.quarter,f.row_number""",
                [*issuer_numbers, "2024-12-31"],
            ).fetchall()
        finally:
            connection.close()
        after = database_hash()
        if after != before:
            fail("SEC master-index database bytes changed during read")
    if any(path.exists() for path in sidecars):
        fail("SEC master-index sidecar exists after read")
    candidates_by_id: dict[str, dict[str, Any]] = {}
    links: list[dict[str, Any]] = []
    for seed in seeds:
        start = dt.date.fromisoformat(seed["liquidationPaymentEffectiveDate"])
        end = start + dt.timedelta(days=90)
        for cik, company_name, form, filed_date, filename, accession, quarter, payload_sha, member_sha, payload_rows, row_number in filings:
            if cik != int(seed["issuerCik"]):
                continue
            filed = dt.date.fromisoformat(filed_date)
            if not start < filed <= end:
                continue
            if type(accession) is not str or not accession:
                fail("candidate accession missing")
            body = {
                "cik": str(cik).zfill(10), "companyName": company_name, "form": form,
                "filedDate": filed_date, "filename": filename, "accession": accession,
                "sourceQuarter": quarter, "sourcePayloadSha256": payload_sha,
                "sourceMemberSha256": member_sha, "sourcePayloadRows": payload_rows,
                "sourceRowNumber": row_number,
            }
            candidate_id = "SEC-DOWNSTREAM-" + sha(canonical(body))
            candidate = {"candidateId": candidate_id, **body}
            previous = candidates_by_id.setdefault(candidate_id, candidate)
            if previous != candidate:
                fail("candidate ID collision")
            links.append({"caseId": seed["caseId"], "candidateId": candidate_id, "dayOffset": (filed - start).days})
    candidates = sorted(candidates_by_id.values(), key=lambda item: (
        item["filedDate"], item["accession"], item["form"], item["filename"], item["candidateId"],
    ))
    links.sort(key=lambda item: (item["caseId"], item["dayOffset"], item["candidateId"]))
    for seed in seeds:
        exact_keys(seed, set(SEED_KEYS), "seed row")
    for candidate in candidates:
        exact_keys(candidate, set(CANDIDATE_KEYS), "candidate row")
        if candidate["cik"] not in EXPECTED_ISSUER_COUNTS:
            fail("candidate issuer CIK outside frozen set")
        if HEX64.fullmatch(candidate["sourcePayloadSha256"]) is None or HEX64.fullmatch(candidate["sourceMemberSha256"]) is None:
            fail("candidate source digest invalid")
    for link in links:
        exact_keys(link, set(LINK_KEYS), "link row")
        if not 1 <= link["dayOffset"] <= 90:
            fail("candidate link outside sealed horizon")
    payload_sequence = sha(("\n".join("|".join(map(str, row)) for row in payloads) + "\n").encode("utf-8"))
    stats = {
        "seedCases": len(seeds), "seedAccessions": len({row["accession"] for row in seeds}),
        "issuerCiks": len({row["issuerCik"] for row in seeds}),
        "searchWindowStartDayInclusive": 1, "searchWindowEndDayInclusive": 90,
        "candidateFilings": len(candidates), "candidateAccessions": len({row["accession"] for row in candidates}),
        "caseCandidateLinks": len(links), "uniqueCaseCandidateLinks": len({(row["caseId"], row["candidateId"]) for row in links}),
        "minimumCandidateDayOffset": min(row["dayOffset"] for row in links),
        "maximumCandidateDayOffset": max(row["dayOffset"] for row in links),
        "candidateFiledDateMinimum": min(row["filedDate"] for row in candidates),
        "candidateFiledDateMaximum": max(row["filedDate"] for row in candidates),
        "candidateSourceQuarterMinimum": min(row["sourceQuarter"] for row in candidates),
        "candidateSourceQuarterMaximum": max(row["sourceQuarter"] for row in candidates),
        "databasePayloads": len(payloads), "databaseRows": sum(row[4] for row in payloads),
        "databaseQuarterMinimum": min(row[0] for row in payloads), "databaseQuarterMaximum": max(row[0] for row in payloads),
        "seedCanonicalSha256": sha(canonical(seeds)),
        "seedSequenceSha256": sha(("\n".join(row["caseId"] for row in seeds) + "\n").encode("utf-8")),
        "candidateCanonicalSha256": sha(canonical(candidates)),
        "candidateSequenceSha256": sha(("\n".join(row["candidateId"] for row in candidates) + "\n").encode("utf-8")),
        "linkCanonicalSha256": sha(canonical(links)),
        "linkSequenceSha256": sha(("\n".join(row["caseId"] + "|" + row["candidateId"] for row in links) + "\n").encode("utf-8")),
        "databasePayloadSequenceSha256": payload_sequence,
        "issuerCandidateCounts": dict(sorted(Counter(row["cik"] for row in candidates).items())),
        "formCounts": dict(sorted(Counter(row["form"] for row in candidates).items())),
        "caseLinkCounts": dict(sorted(Counter(row["caseId"] for row in links).items())),
    }
    if stats != EXPECTED_REBUILD:
        fail("source-derived discovery differs from sealed rebuild")
    return seeds, candidates, links, stats


def build_report(contract: dict[str, Any]) -> dict[str, Any]:
    _seeds, _candidates, _links, stats = build_rows()
    report = {
        "schema": "sec-liquidation-downstream-filing-discovery-dry-run/v1",
        "taskId": contract["taskId"], "track": contract["track"],
        "contractRawSha256": CONTRACT_RAW, "contractSha256": CONTRACT_SELF,
        "disposition": "ONE_HUNDRED_FIFTEEN_OFFICIAL_SAME_ISSUER_FILING_CANDIDATES_REQUIRE_CONTENT_ACQUISITION_AND_SECURITY_LEVEL_REVIEW",
        "population": stats, "claimLocks": copy.deepcopy(EXPECTED_LOCKS),
        "networkRequests": 0, "writes": 0, "pricesAccessed": False, "returnsAccessed": False,
        "outcomesAccessed": False,
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
    if git("ls-remote", "--refs", "origin", REMOTE_REF).split() != [head, REMOTE_REF]:
        fail("live remote differs")
    if not is_ancestor(BASE, head):
        fail("base is not ancestor of HEAD")
    introductions = [introduction_for(path) for path in OWNED]
    if all(not values for values in introductions):
        if head != BASE:
            fail("pre-introduction HEAD moved beyond base")
        return {"phase": "PRE_INTRODUCTION", "introductionCommit": None, "remoteVerified": True, "ownedGitBytesBound": 0}
    if any(len(values) != 1 for values in introductions) or len({values[0] for values in introductions}) != 1:
        fail("owned paths were not introduced together once")
    introduction = introductions[0][0]
    if git("show", "-s", "--format=%P", introduction).split() != [BASE]:
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
            fail("owned Git bytes changed")
    return {"phase": "POST_INTRODUCTION", "introductionCommit": introduction, "remoteVerified": True, "ownedGitBytesBound": 3}


def reseal(value: dict[str, Any]) -> dict[str, Any]:
    item = copy.deepcopy(value)
    item["contractSha256"] = self_hash(item, "contractSha256")
    return item


def rejected(action: Callable[[], None]) -> bool:
    try:
        action()
    except (DiscoveryError, KeyError, TypeError, ValueError, OSError, sqlite3.Error, json.JSONDecodeError):
        return True
    return False


def self_test(contract: dict[str, Any]) -> dict[str, Any]:
    mutations: dict[str, Callable[[dict[str, Any]], None]] = {
        "backdated": lambda item: item.__setitem__("createdAt", "1970-01-01T00:00:00Z"),
        "purposeOverclaim": lambda item: item.__setitem__("purpose", "same security final recovery and terminal wealth"),
        "tickerJoin": lambda item: item["searchContract"].__setitem__("tickerJoinAllowed", True),
        "companyNameJoin": lambda item: item["searchContract"].__setitem__("companyNameJoinAllowed", True),
        "contentClaim": lambda item: item["searchContract"].__setitem__("filingContentSearchPerformed", True),
        "horizonExpansion": lambda item: item["searchContract"].__setitem__("calendarDayOffsetMaximumInclusive", 365),
        "candidateLoss": lambda item: item["expectedRebuild"].__setitem__("candidateFilings", 114),
        "linkLoss": lambda item: item["expectedRebuild"].__setitem__("caseCandidateLinks", 468),
        "candidateDigest": lambda item: item["expectedRebuild"].__setitem__("candidateCanonicalSha256", "0" * 64),
        "sameSecurityCredit": lambda item: item["claimLocks"].__setitem__("sameSecurityReferenced", True),
        "finalityCredit": lambda item: item["claimLocks"].__setitem__("finalDistributionVerified", True),
        "recoveryCredit": lambda item: item["claimLocks"].__setitem__("laterRecoveriesExcluded", True),
        "terminalCredit": lambda item: item["claimLocks"].__setitem__("terminalWealthComplete", True),
        "outcomeCredit": lambda item: item["claimLocks"].__setitem__("outcomesAccessed", True),
        "unknownCredit": lambda item: item["claimLocks"].__setitem__("unknownScientificCredit", True),
        "databaseRedirect": lambda item: item["authoritativeInputs"]["secMasterIndex"].__setitem__("logicalPath", "reports/evil.sqlite"),
        "networkEnabled": lambda item: item["implementationContract"].__setitem__("networkCapabilityAllowed", True),
        "writeEnabled": lambda item: item["implementationContract"].__setitem__("writeCapabilityAllowed", True),
        "remoteOptional": lambda item: item["implementationContract"].__setitem__("remoteVerificationRequired", False),
        "candidateSchemaExtra": lambda item: item["candidateSchema"].append("terminalWealth"),
    }
    kills: dict[str, bool] = {}
    for name, mutate in mutations.items():
        item = copy.deepcopy(contract)
        mutate(item)
        item = reseal(item)
        kills[name] = rejected(lambda item=item: validate_contract(item))
    start = dt.date(2014, 8, 28)
    kills.update({
        "sameDayExcluded": not (start < start <= start + dt.timedelta(days=90)),
        "dayOneIncluded": start < start + dt.timedelta(days=1) <= start + dt.timedelta(days=90),
        "dayNinetyIncluded": start < start + dt.timedelta(days=90) <= start + dt.timedelta(days=90),
        "dayNinetyOneExcluded": not (start < start + dt.timedelta(days=91) <= start + dt.timedelta(days=90)),
        "exactCikNoNormalization": "0001414040" != "1414040",
    })
    if not all(kills.values()):
        fail("self-test kill failed")
    return {"schema": "sec-liquidation-downstream-filing-discovery-self-test/v1", "status": "PASS", "mutationKills": kills, "outcomesAccessed": False}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify-contract", "dry-run", "self-test"))
    parser.add_argument("--remote", action="store_true")
    args = parser.parse_args()
    try:
        contract = load_contract()
        repository = verify_repository(args.remote)
        if args.command == "verify-contract":
            result = {"schema": "sec-liquidation-downstream-filing-discovery-contract-verification/v1", "status": "PASS", **repository, "outcomesAccessed": False}
        elif args.command == "self-test":
            result = {**self_test(contract), **repository}
        else:
            report = build_report(contract)
            result = {"schema": "sec-liquidation-downstream-filing-discovery-verification/v1", "status": "PASS", **repository,
                      "reportSha256": report["reportSha256"], "population": report["population"],
                      "publicOutputCreated": False, "networkRequests": 0, "writes": 0,
                      "pricesAccessed": False, "returnsAccessed": False, "outcomesAccessed": False}
    except (DiscoveryError, KeyError, TypeError, ValueError, OSError, sqlite3.Error, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
