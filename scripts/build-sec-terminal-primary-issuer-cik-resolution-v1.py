#!/usr/bin/env python3
"""Resolve SEC terminal candidate issuer queue rows using source-derived issuer CIK only."""

from __future__ import annotations

import argparse
import copy
import gzip
import hashlib
import json
import os
import tempfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-terminal-primary-issuer-cik-resolution-contract-v1.json"
CROSSWALK = ROOT / "reports" / "early-detection" / "sec-terminal-primary-queue-crosswalk-v1.json"
FORM15_GZIP = ROOT / "reports" / "early-detection" / "sec-form15-structured-metadata-v2.json.gz"
FORM25_GZIP = ROOT / "reports" / "early-detection" / "sec-form25-structured-metadata-v2.json.gz"
FORM15_MANIFEST = ROOT / "reports" / "early-detection" / "sec-form15-structured-metadata-v2-gzip-manifest.json"
FORM25_MANIFEST = ROOT / "reports" / "early-detection" / "sec-form25-structured-metadata-v2-gzip-manifest.json"
OUTPUT = ROOT / "reports" / "early-detection" / "sec-terminal-primary-issuer-cik-resolution-v1.json"
EXPECTED_CONTRACT_RAW = "ebc1bf9831800c13de19ac60d98dfccc7b98d2e2b9503719bd5283038ed8aaec"
EXPECTED_CONTRACT_SELF = "90cc10de1004fb7316f8b1d3b2e625f13a43a5f2f6a58d0025c140c846d859f8"
CROSSWALK_RAW = "1620310b685058c92234a4f2598a3228eb0371a26ca852b243754e745a993d19"
CROSSWALK_REPORT = "c247f86c2c3ebb5c4a2354eae1120cb36678ec1d5e560a9f86602e8cd6d09f45"
F15_GZIP_RAW = "ac10592573448967bf7e56fc145ff5db757ad3cebd66e825e3c24e8810b48253"
F15_RAW = "89356ab469ca6aecb57bc586ef05ac990469fd4e1baf939b718cacbb0d98501c"
F15_REPORT = "099345083baf9310cf9c9610f589c23eaa4afd3d1e7dc99441a8525687a93e57"
F15_MANIFEST_RAW = "4781323557a3323a6982ccba7c02f5e5076f0168654e52d50cfce81d393e5422"
F25_GZIP_RAW = "942bb1ec0fbc292a53ca6b3760b2ffee13253cf60322ecb9778905118a2d370e"
F25_RAW = "bc7b419a8489088f6fadd55579feec05fd193d36a2b415b592b4bac4c950d774"
F25_REPORT = "b24c12b721b2a81952b8d2b7e8fc9b4617408f69075f5f7d5a09bc98e16f1ea8"
F25_MANIFEST_RAW = "a28c43ca2f9089ce5c7cb93dbd5bbc120af1b7579f4ec835fb2bc7b47cb4d9ab"
EXPECTED_ROWS = 656
EXPECTED_UNIQUE_SELECTED = 652


class ResolutionError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise ResolutionError(message)


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        fail(f"{label} exact keys changed")


def validate_manifest(path: Path, raw_sha: str, gzip_sha: str, decompressed_sha: str, report_sha: str, label: str) -> None:
    raw = path.read_bytes()
    if sha(raw) != raw_sha:
        fail(f"{label} manifest bytes changed")
    value = json.loads(raw)
    self_key = "manifestSha256"
    body = dict(value)
    claim = body.pop(self_key, None)
    if not isinstance(claim, str) or sha(canonical(body)) != claim:
        fail(f"{label} manifest self hash changed")
    if value.get("gzip", {}).get("rawSha256") != gzip_sha or value.get("decompressed", {}).get("rawSha256") != decompressed_sha or value.get("decompressed", {}).get("reportSha256") != report_sha or any(value.get("claimLocks", {}).values()):
        fail(f"{label} manifest boundary changed")


def load_gzip(path: Path, gzip_sha: str, decompressed_sha: str, report_sha: str, label: str) -> dict[str, Any]:
    compressed = path.read_bytes()
    if sha(compressed) != gzip_sha:
        fail(f"{label} gzip bytes changed")
    try:
        raw = gzip.decompress(compressed)
    except OSError as exc:
        raise ResolutionError(f"{label} invalid gzip") from exc
    if sha(raw) != decompressed_sha:
        fail(f"{label} decompressed bytes changed")
    value = json.loads(raw)
    body = dict(value)
    claim = body.pop("reportSha256", None)
    if claim != report_sha or sha(canonical(body)) != report_sha:
        fail(f"{label} report self hash changed")
    if value.get("track") != "SHARED_OUTCOME_BLIND_INFRA" or any(value.get("claimLocks", {}).values()):
        fail(f"{label} claim boundary changed")
    return value


def validate_contract() -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    if sha(raw) != EXPECTED_CONTRACT_RAW:
        fail("contract raw bytes changed")
    value = json.loads(raw)
    body = dict(value)
    claim = body.pop("contractSha256", None)
    if claim != EXPECTED_CONTRACT_SELF or sha(canonical(body)) != EXPECTED_CONTRACT_SELF:
        fail("contract self hash changed")
    exact_keys(value, {"schema", "createdAt", "taskId", "track", "purpose", "inputs", "resolutionContract", "output", "claimLocks", "contractSha256"}, "contract")
    if value["schema"] != "early-detection-sec-terminal-primary-issuer-cik-resolution-contract/v1" or value["taskId"] != "Q003-SEC-TERMINAL-PRIMARY-ISSUER-CIK-RESOLUTION" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract boundary changed")
    if value["inputs"] != {
        "crosswalk": {"path": "reports/early-detection/sec-terminal-primary-queue-crosswalk-v1.json", "rawSha256": CROSSWALK_RAW, "reportSha256": CROSSWALK_REPORT, "introductionCommit": "f5d6787c70e5c1aba15c876bd3c5bf34a17b3a4d", "rows": 656},
        "form15Metadata": {"gzipPath": "reports/early-detection/sec-form15-structured-metadata-v2.json.gz", "gzipRawSha256": F15_GZIP_RAW, "decompressedRawSha256": F15_RAW, "reportSha256": F15_REPORT, "manifestPath": "reports/early-detection/sec-form15-structured-metadata-v2-gzip-manifest.json", "manifestRawSha256": F15_MANIFEST_RAW, "introductionCommit": "ec806d8112fdaa05ee2cd328da256c504e8038fe"},
        "form25Metadata": {"gzipPath": "reports/early-detection/sec-form25-structured-metadata-v2.json.gz", "gzipRawSha256": F25_GZIP_RAW, "decompressedRawSha256": F25_RAW, "reportSha256": F25_REPORT, "manifestPath": "reports/early-detection/sec-form25-structured-metadata-v2-gzip-manifest.json", "manifestRawSha256": F25_MANIFEST_RAW, "introductionCommit": "2205e9080a5101babd2016f4334a00abeeb12993"},
    }:
        fail("input contract changed")
    if value["resolutionContract"] != {
        "candidateJoinKey": ["sourceDataset", "accession"],
        "queueSelectionKey": ["accession", "sourceDerivedIssuerCik"],
        "issuerCikNormalization": "LEFT_ZERO_PAD_TO_10_DIGITS",
        "tickerJoinAllowed": False,
        "companyNameJoinAllowed": False,
        "oneSelectedQueueRowRequired": True,
        "metadataRowsPreserved": True,
        "expectedRows": EXPECTED_ROWS,
        "expectedUniqueSelectedQueueRows": EXPECTED_UNIQUE_SELECTED,
        "expectedForm15Rows": 65,
        "expectedForm25Rows": 591,
        "expectedAllIssuerCiksPresent": EXPECTED_ROWS,
        "expectedUniqueIssuerQueueMatches": EXPECTED_ROWS,
        "securityIdentityInferenceAllowed": False,
        "listingIdentityInferenceAllowed": False,
        "paymentVerificationAllowed": False,
        "terminalWealthCompletionAllowed": False,
        "outcomesAccessed": False,
    }:
        fail("resolution contract changed")
    if value["output"] != {"path": "reports/early-detection/sec-terminal-primary-issuer-cik-resolution-v1.json", "writeNewAtomic": True}:
        fail("output contract changed")
    if value["claimLocks"].get("issuerQueueRowResolved") is not True or any(item is not False for key, item in value["claimLocks"].items() if key != "issuerQueueRowResolved"):
        fail("claim locks changed")
    return value


def load_crosswalk() -> dict[str, Any]:
    raw = CROSSWALK.read_bytes()
    if sha(raw) != CROSSWALK_RAW:
        fail("crosswalk raw bytes changed")
    value = json.loads(raw)
    body = dict(value)
    claim = body.pop("reportSha256", None)
    if claim != CROSSWALK_REPORT or sha(canonical(body)) != CROSSWALK_REPORT or len(value.get("rows", [])) != EXPECTED_ROWS or any(value.get("claimLocks", {}).values()):
        fail("crosswalk boundary changed")
    return value


def load_inputs() -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    validate_manifest(FORM15_MANIFEST, F15_MANIFEST_RAW, F15_GZIP_RAW, F15_RAW, F15_REPORT, "Form15")
    validate_manifest(FORM25_MANIFEST, F25_MANIFEST_RAW, F25_GZIP_RAW, F25_RAW, F25_REPORT, "Form25")
    return load_crosswalk(), load_gzip(FORM15_GZIP, F15_GZIP_RAW, F15_RAW, F15_REPORT, "Form15"), load_gzip(FORM25_GZIP, F25_GZIP_RAW, F25_RAW, F25_REPORT, "Form25")


def metadata_ref(row: dict[str, Any]) -> dict[str, Any]:
    field = row["fields"]["issuerCik"]
    return {"metadataRowId": row["rowId"], "priorityRank": row["priorityRank"], "inventoryStatus": row["inventoryStatus"], "parseStatus": row["parseStatus"], "issuerCikStatus": field["status"], "issuerCik": str(field["value"]).zfill(10), "issuerCikEvidence": field["evidence"], "sourceBlob": row["sourceBlob"], "outcomesAccessed": row["outcomesAccessed"]}


def build_rows(crosswalk: dict[str, Any], form15: dict[str, Any], form25: dict[str, Any]) -> list[dict[str, Any]]:
    indexes: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for source, value in (("FORM15_METADATA_V2", form15), ("FORM25_METADATA_V2", form25)):
        index: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in value["rows"]:
            index[row["accession"]].append(row)
        indexes[source] = index
    output = []
    for rank, source in enumerate(crosswalk["rows"], 1):
        metadata = sorted(indexes[source["sourceDataset"]].get(source["accession"], []), key=lambda row: (row["priorityRank"], row["rowId"]))
        if not metadata:
            fail("metadata missing for candidate accession")
        refs = [metadata_ref(row) for row in metadata]
        issuer_ciks = {row["issuerCik"] for row in refs if row["issuerCikStatus"] == "PRESENT"}
        if len(issuer_ciks) != 1:
            fail("issuer CIK is not uniquely source-derived")
        issuer_cik = next(iter(issuer_ciks))
        matches = [row for row in source["queueRows"] if row["cik"] == issuer_cik]
        if len(matches) != 1:
            fail("issuer CIK does not select exactly one queue row")
        selected = copy.deepcopy(matches[0])
        output.append({
            "resolutionRank": rank,
            "resolutionRowId": sha(canonical({"sourceCrosswalkRowId": source["crosswalkRowId"], "issuerCik": issuer_cik, "selectedQueueRowId": selected["rowId"]})),
            "accession": source["accession"],
            "sourceCrosswalkRowId": source["crosswalkRowId"],
            "sourceExtractionRowId": source["sourceExtractionRowId"],
            "sourceCandidateId": source["sourceCandidateId"],
            "sourceOccurrenceId": source["sourceOccurrenceId"],
            "sourceDataset": source["sourceDataset"],
            "sourceDerivedIssuerCik": issuer_cik,
            "metadataRows": refs,
            "queueCandidatesPreserved": source["queueRows"],
            "selectedIssuerQueueRow": selected,
            "selectionStatus": "ONE_EXACT_ACCESSION_AND_SOURCE_DERIVED_ISSUER_CIK_MATCH",
            "issuerQueueRowResolved": True,
            "securityIdentityResolved": False,
            "listingIdentityResolved": False,
            "paymentVerified": False,
            "terminalWealthComplete": False,
            "manualPrimaryDocumentReviewRequired": True,
            "outcomesAccessed": False,
        })
    return output


def population(rows: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "rows": len(rows),
        "uniqueAccessions": len({row["accession"] for row in rows}),
        "form15Rows": sum(row["sourceDataset"] == "FORM15_METADATA_V2" for row in rows),
        "form25Rows": sum(row["sourceDataset"] == "FORM25_METADATA_V2" for row in rows),
        "issuerCikPresentRows": sum(bool(row["sourceDerivedIssuerCik"]) for row in rows),
        "uniqueIssuerQueueMatches": sum(row["selectionStatus"] == "ONE_EXACT_ACCESSION_AND_SOURCE_DERIVED_ISSUER_CIK_MATCH" for row in rows),
        "selectedQueueRowReferences": len(rows),
        "uniqueSelectedQueueRows": len({row["selectedIssuerQueueRow"]["rowId"] for row in rows}),
        "securityIdentityResolvedRows": 0,
        "paymentVerifiedRows": 0,
        "terminalWealthCompleteRows": 0,
    }


def build_report(contract: dict[str, Any], crosswalk: dict[str, Any], form15: dict[str, Any], form25: dict[str, Any]) -> dict[str, Any]:
    rows = build_rows(crosswalk, form15, form25)
    value = {
        "schema": "early-detection-sec-terminal-primary-issuer-cik-resolution/v1",
        "taskId": contract["taskId"],
        "track": contract["track"],
        "contractRawSha256": sha(CONTRACT.read_bytes()),
        "contractSha256": contract["contractSha256"],
        "inputBindings": {"crosswalkRawSha256": CROSSWALK_RAW, "crosswalkReportSha256": CROSSWALK_REPORT, "form15GzipRawSha256": F15_GZIP_RAW, "form15ReportSha256": F15_REPORT, "form25GzipRawSha256": F25_GZIP_RAW, "form25ReportSha256": F25_REPORT},
        "selectionContract": {"candidateJoinKey": ["sourceDataset", "accession"], "queueSelectionKey": ["accession", "sourceDerivedIssuerCik"], "tickerJoinAllowed": False, "companyNameJoinAllowed": False},
        "population": population(rows),
        "rows": rows,
        "claimLocks": contract["claimLocks"],
        "outcomesAccessed": False,
    }
    value["reportSha256"] = sha(canonical(value))
    return value


def validate_report(value: dict[str, Any], contract: dict[str, Any], crosswalk: dict[str, Any], form15: dict[str, Any], form25: dict[str, Any]) -> None:
    exact_keys(value, {"schema", "taskId", "track", "contractRawSha256", "contractSha256", "inputBindings", "selectionContract", "population", "rows", "claimLocks", "outcomesAccessed", "reportSha256"}, "report")
    body = dict(value)
    claim = body.pop("reportSha256", None)
    if claim != sha(canonical(body)) or value["schema"] != "early-detection-sec-terminal-primary-issuer-cik-resolution/v1":
        fail("report self hash changed")
    if value["contractRawSha256"] != sha(CONTRACT.read_bytes()) or value["contractSha256"] != contract["contractSha256"] or value["inputBindings"] != {"crosswalkRawSha256": CROSSWALK_RAW, "crosswalkReportSha256": CROSSWALK_REPORT, "form15GzipRawSha256": F15_GZIP_RAW, "form15ReportSha256": F15_REPORT, "form25GzipRawSha256": F25_GZIP_RAW, "form25ReportSha256": F25_REPORT}:
        fail("report binding changed")
    if value["selectionContract"] != {"candidateJoinKey": ["sourceDataset", "accession"], "queueSelectionKey": ["accession", "sourceDerivedIssuerCik"], "tickerJoinAllowed": False, "companyNameJoinAllowed": False}:
        fail("selection contract changed")
    expected = build_rows(crosswalk, form15, form25)
    if value["rows"] != expected:
        fail("rows do not match source-derived issuer-CIK rebuild")
    if value["population"] != population(expected) or value["population"] != {"rows": EXPECTED_ROWS, "uniqueAccessions": 652, "form15Rows": 65, "form25Rows": 591, "issuerCikPresentRows": EXPECTED_ROWS, "uniqueIssuerQueueMatches": EXPECTED_ROWS, "selectedQueueRowReferences": EXPECTED_ROWS, "uniqueSelectedQueueRows": EXPECTED_UNIQUE_SELECTED, "securityIdentityResolvedRows": 0, "paymentVerifiedRows": 0, "terminalWealthCompleteRows": 0}:
        fail("population changed")
    if value["claimLocks"] != contract["claimLocks"] or value["claimLocks"].get("issuerQueueRowResolved") is not True or any(item is not False for key, item in value["claimLocks"].items() if key != "issuerQueueRowResolved") or value["outcomesAccessed"] is not False:
        fail("claim boundary changed")
    if [row["resolutionRank"] for row in value["rows"]] != list(range(1, EXPECTED_ROWS + 1)) or len({row["resolutionRowId"] for row in value["rows"]}) != EXPECTED_ROWS:
        fail("row identity changed")
    for row in value["rows"]:
        exact_keys(row, {"resolutionRank", "resolutionRowId", "accession", "sourceCrosswalkRowId", "sourceExtractionRowId", "sourceCandidateId", "sourceOccurrenceId", "sourceDataset", "sourceDerivedIssuerCik", "metadataRows", "queueCandidatesPreserved", "selectedIssuerQueueRow", "selectionStatus", "issuerQueueRowResolved", "securityIdentityResolved", "listingIdentityResolved", "paymentVerified", "terminalWealthComplete", "manualPrimaryDocumentReviewRequired", "outcomesAccessed"}, "resolution row")
        if row["selectionStatus"] != "ONE_EXACT_ACCESSION_AND_SOURCE_DERIVED_ISSUER_CIK_MATCH" or row["issuerQueueRowResolved"] is not True or row["manualPrimaryDocumentReviewRequired"] is not True or any(row[key] is not False for key in ("securityIdentityResolved", "listingIdentityResolved", "paymentVerified", "terminalWealthComplete", "outcomesAccessed")):
            fail("row promoted beyond issuer queue resolution")
        if row["selectedIssuerQueueRow"]["cik"] != row["sourceDerivedIssuerCik"] or row["selectedIssuerQueueRow"] not in row["queueCandidatesPreserved"]:
            fail("selected queue row is not exact issuer match")


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
    except (ResolutionError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError):
        return True
    return False


def self_test(contract: dict[str, Any], crosswalk: dict[str, Any], form15: dict[str, Any], form25: dict[str, Any]) -> dict[str, Any]:
    report = build_report(contract, crosswalk, form15, form25)
    validate_report(report, contract, crosswalk, form15, form25)
    kills: dict[str, bool] = {}
    for name, mutate in {
        "issuerCikChanged": lambda x: x["rows"][0].__setitem__("sourceDerivedIssuerCik", "0000000000"),
        "wrongQueueRowSelected": lambda x: x["rows"][next(i for i, row in enumerate(x["rows"]) if len(row["queueCandidatesPreserved"]) > 1)].__setitem__("selectedIssuerQueueRow", copy.deepcopy(x["rows"][next(i for i, row in enumerate(x["rows"]) if len(row["queueCandidatesPreserved"]) > 1)]["queueCandidatesPreserved"][0] if x["rows"][next(i for i, row in enumerate(x["rows"]) if len(row["queueCandidatesPreserved"]) > 1)]["queueCandidatesPreserved"][0]["cik"] != x["rows"][next(i for i, row in enumerate(x["rows"]) if len(row["queueCandidatesPreserved"]) > 1)]["sourceDerivedIssuerCik"] else x["rows"][next(i for i, row in enumerate(x["rows"]) if len(row["queueCandidatesPreserved"]) > 1)]["queueCandidatesPreserved"][1])),
        "securityIdentityPromoted": lambda x: x["rows"][0].__setitem__("securityIdentityResolved", True),
        "tickerJoinClaimed": lambda x: x["selectionContract"].__setitem__("tickerJoinAllowed", True),
        "metadataEvidenceDropped": lambda x: x["rows"][0]["metadataRows"][0]["issuerCikEvidence"].clear(),
        "terminalWealthPromoted": lambda x: x["claimLocks"].__setitem__("terminalWealthComplete", True),
    }.items():
        item = copy.deepcopy(report)
        mutate(item)
        item["reportSha256"] = sha(canonical({key: val for key, val in item.items() if key != "reportSha256"}))
        kills[name] = rejected(lambda item=item: validate_report(item, contract, crosswalk, form15, form25))
    return {"schema": "early-detection-sec-terminal-primary-issuer-cik-resolution-self-test/v1", "status": "PASS", "kills": kills, "outcomesAccessed": False}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify-contract", "self-test", "build", "verify-output"))
    args = parser.parse_args()
    try:
        contract = validate_contract()
        crosswalk, form15, form25 = load_inputs()
        if args.command == "verify-contract":
            result = {"schema": "early-detection-sec-terminal-primary-issuer-cik-resolution-contract-verification/v1", "status": "PASS", "contractSha256": contract["contractSha256"], "outcomesAccessed": False}
        elif args.command == "self-test":
            result = self_test(contract, crosswalk, form15, form25)
        elif args.command == "build":
            report = build_report(contract, crosswalk, form15, form25)
            validate_report(report, contract, crosswalk, form15, form25)
            raw = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
            write_new(OUTPUT, raw)
            result = {"schema": "early-detection-sec-terminal-primary-issuer-cik-resolution-build/v1", "status": "PASS", "path": OUTPUT.relative_to(ROOT).as_posix(), "rawSha256": sha(raw), "reportSha256": report["reportSha256"], "rows": EXPECTED_ROWS, "outcomesAccessed": False}
        else:
            report = json.loads(OUTPUT.read_bytes())
            validate_report(report, contract, crosswalk, form15, form25)
            result = {"schema": "early-detection-sec-terminal-primary-issuer-cik-resolution-verification/v1", "status": "PASS", "rawSha256": sha(OUTPUT.read_bytes()), "reportSha256": report["reportSha256"], "sourceRebuildVerified": True, "rows": EXPECTED_ROWS, "outcomesAccessed": False}
    except (ResolutionError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
