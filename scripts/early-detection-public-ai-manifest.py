#!/usr/bin/env python3
"""Build the complete outcome-blind input manifest for the public-data AI path.

The builder binds every bridge candidate to the existing current-ticker price
store without selecting a cohort or computing a return, signal, or outcome.
Identity and corporate-action semantics remain UNRESOLVED until separately
supported by bound evidence and three AI audits.
"""

from __future__ import annotations

import argparse
import bisect
import hashlib
import json
import math
import re
import sqlite3
import tempfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any


INPUT_SCHEMA = "early-detection-public-ai-row-manifest/v1"
IDENTITY_EVIDENCE_SCHEMA = "early-detection-public-ai-identity-evidence/v1"
BRIDGE_SCHEMA = "early-detection-entity-bridge/v2"
V94_CORPUS_SHA256 = "7a6aa70f539ef7d9b5ce714bb09ff0acf81bdf5beb4de3b222d784902de28792"
TICKER_RE = re.compile(r"^[A-Z0-9.^$-]{1,20}$")
OBSERVED_AT_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$")
WINDOWS_RESERVED_RE = re.compile(r"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9]|CONIN\$|CONOUT\$)$", re.I)
ALLOWED_DATASETS = {"nasdaqlisted", "otherlisted"}
ALLOWED_STATUSES = {"CANDIDATE_UNADJUDICATED", "AMBIGUOUS"}
IDENTITY_EVIDENCE_ROW_KEYS = {
    "rowId",
    "identitySynthetic",
    "identityConflictTypes",
    "laterCorporateActionFactorKnown",
    "identityAdjudication",
    "corporateActionAdjustmentStatus",
    "identityEvidenceRefs",
    "corporateActionEvidenceRefs",
    "identityEvidenceBasis",
    "corporateActionEvidenceBasis",
    "identityClaimBindingSha256",
    "corporateActionClaimBindingSha256",
}


class PublicAiManifestError(RuntimeError):
    """The outcome-blind manifest build failed closed."""


def canonical_sha256(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def serialize_json(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_created_at(value: str) -> str:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise PublicAiManifestError("createdAt must be an ISO-8601 UTC timestamp ending in Z")
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as exc:
        raise PublicAiManifestError("createdAt must be a valid UTC timestamp") from exc
    if parsed.tzinfo is None or parsed.utcoffset() != timedelta(0):
        raise PublicAiManifestError("createdAt must be a UTC timestamp")
    return value


def parse_observed_at(value: Any) -> str:
    if not isinstance(value, str) or OBSERVED_AT_RE.fullmatch(value) is None:
        raise PublicAiManifestError("observedAt must use canonical calendar ISO-8601 UTC form")
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as exc:
        raise PublicAiManifestError(f"invalid observedAt: {value}") from exc
    if parsed.tzinfo is None or parsed.utcoffset() != timedelta(0) or not (2009 <= parsed.year <= 2014):
        raise PublicAiManifestError(f"observedAt outside frozen 2009-2014 UTC boundary: {value}")
    return value


def expected_row_id(dataset: str, observed_at: str, ticker: str) -> str:
    return canonical_sha256({"dataset": dataset, "observedAt": observed_at, "ticker": ticker})


def safe_price_filename(ticker: str) -> str:
    sanitized = re.sub(r"[^A-Z0-9.-]", "_", ticker.upper(), flags=re.I)
    if not sanitized or set(sanitized) == {"_"}:
        raise PublicAiManifestError("ticker is empty after filename sanitisation")
    stem = sanitized.split(".", 1)[0].strip(".")
    prefix = "_" if not stem or WINDOWS_RESERVED_RE.fullmatch(stem) else ""
    return f"{prefix}{sanitized}.json"


def expected_claim_binding(row: dict[str, Any], kind: str) -> str:
    if kind == "identity":
        payload = {
            "rowId": row["rowId"],
            "adjudication": row["identityAdjudication"],
            "basis": row["identityEvidenceBasis"],
            "refs": row["identityEvidenceRefs"],
        }
    elif kind == "corporateAction":
        payload = {
            "rowId": row["rowId"],
            "adjustmentStatus": row["corporateActionAdjustmentStatus"],
            "basis": row["corporateActionEvidenceBasis"],
            "refs": row["corporateActionEvidenceRefs"],
        }
    else:
        raise PublicAiManifestError("unknown claim-binding kind")
    return canonical_sha256(payload)


def inventory_sidecars(path: Path) -> list[Path]:
    return [Path(f"{path}-wal"), Path(f"{path}-shm"), Path(f"{path}-journal")]


def load_candidates(source_inventory: Path) -> tuple[str, list[tuple[str, str, str, str]]]:
    if not source_inventory.is_file() or any(path.exists() for path in inventory_sidecars(source_inventory)):
        raise PublicAiManifestError("source inventory missing or has unbound SQLite sidecars")
    before_sha256 = sha256_file(source_inventory)
    connection = sqlite3.connect(f"file:{source_inventory.as_posix()}?mode=ro&immutable=1", uri=True)
    try:
        schema = connection.execute("SELECT value FROM meta WHERE key='schema'").fetchone()
        if schema is None or schema[0] != BRIDGE_SCHEMA:
            raise PublicAiManifestError("unexpected source inventory schema")
        rows = connection.execute(
            """SELECT s.dataset,s.observed_at,c.ticker,c.status
               FROM candidates c JOIN snapshots s USING(snapshot_id)
               WHERE c.status IN ('CANDIDATE_UNADJUDICATED','AMBIGUOUS')
               ORDER BY s.observed_at,s.dataset,c.ticker,c.status"""
        ).fetchall()
    finally:
        connection.close()
    if any(path.exists() for path in inventory_sidecars(source_inventory)):
        raise PublicAiManifestError("source inventory sidecar appeared during build")
    if sha256_file(source_inventory) != before_sha256:
        raise PublicAiManifestError("source inventory changed during build")
    if not rows:
        raise PublicAiManifestError("source inventory has no candidate rows")
    normalized: list[tuple[str, str, str, str]] = []
    source_keys: set[tuple[str, str, str]] = set()
    for dataset, observed_at, ticker, status in rows:
        if dataset not in ALLOWED_DATASETS or status not in ALLOWED_STATUSES:
            raise PublicAiManifestError("source inventory contains an unsupported candidate row")
        observed_at = parse_observed_at(observed_at)
        if not isinstance(ticker, str) or TICKER_RE.fullmatch(ticker) is None:
            raise PublicAiManifestError(f"source inventory ticker is unsafe: {ticker!r}")
        source_key = (dataset, observed_at, ticker)
        if source_key in source_keys:
            raise PublicAiManifestError(f"duplicate source key: {source_key}")
        source_keys.add(source_key)
        normalized.append((dataset, observed_at, ticker, status))
    return before_sha256, normalized


def decode_price_bytes(raw: bytes, path: Path) -> Any:
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise PublicAiManifestError(f"invalid price JSON cannot be bound: {path}") from exc


def prior_price_count(value: Any, cutoff: str) -> tuple[bool, int]:
    if not isinstance(value, list) or not value:
        return False, 0
    previous_prior_date: str | None = None
    prior = 0
    for row in value:
        if not isinstance(row, dict) or "date" not in row:
            return False, 0
        try:
            parsed_date = date.fromisoformat(str(row["date"]))
        except (TypeError, ValueError):
            return False, 0
        parsed = parsed_date.isoformat()
        if parsed < cutoff:
            if previous_prior_date is not None and parsed <= previous_prior_date:
                return False, 0
            previous_prior_date = parsed
            if set(row) != {"date", "close"}:
                return False, 0
            try:
                close = float(row["close"])
            except (TypeError, ValueError):
                return False, 0
            if not math.isfinite(close) or close <= 0:
                return False, 0
            prior += 1
    return True, prior


def load_price_metadata(prices_directory: Path, tickers: set[str]) -> dict[str, dict[str, Any] | None]:
    if not prices_directory.is_dir():
        raise PublicAiManifestError("prices directory missing")
    expected_paths = {ticker: prices_directory / safe_price_filename(ticker) for ticker in sorted(tickers)}
    filenames = list(path.name for path in expected_paths.values())
    if len(filenames) != len(set(filenames)):
        raise PublicAiManifestError("candidate tickers collide in the canonical price filename mapping")
    present_before = {ticker for ticker, path in expected_paths.items() if path.is_file()}
    metadata: dict[str, dict[str, Any] | None] = {}
    for ticker, path in expected_paths.items():
        if ticker not in present_before:
            metadata[ticker] = None
            continue
        raw = path.read_bytes()
        metadata[ticker] = {
            "sha256": sha256_bytes(raw),
            "value": decode_price_bytes(raw, path),
        }
    present_after = {ticker for ticker, path in expected_paths.items() if path.is_file()}
    if present_before != present_after:
        raise PublicAiManifestError("candidate price-file membership changed during build")
    return metadata


def unresolved_row(
    dataset: str,
    observed_at: str,
    ticker: str,
    status: str,
    price: dict[str, Any] | None,
) -> dict[str, Any]:
    price_valid, prior_bar_count = (False, 0)
    if price is not None:
        price_valid, prior_bar_count = prior_price_count(price["value"], observed_at[:10])
    row: dict[str, Any] = {
        "rowId": expected_row_id(dataset, observed_at, ticker),
        "dataset": dataset,
        "observedAt": observed_at,
        "ticker": ticker,
        "candidateStatus": status,
        "archivedSnapshotObserved": True,
        "priceFilePresent": price is not None,
        "priceFileValid": price_valid,
        "priceFileTicker": ticker if price is not None else None,
        "priceFileSha256": price["sha256"] if price is not None else None,
        "priorBarCount": prior_bar_count,
        "identitySynthetic": False,
        "identityConflictTypes": [],
        "laterCorporateActionFactorKnown": False,
        "identityAdjudication": "UNRESOLVED",
        "corporateActionAdjustmentStatus": "UNRESOLVED",
        "identityEvidenceRefs": [],
        "corporateActionEvidenceRefs": [],
        "identityEvidenceBasis": "UNRESOLVED",
        "corporateActionEvidenceBasis": "UNRESOLVED",
        "identityClaimBindingSha256": "",
        "corporateActionClaimBindingSha256": "",
    }
    row["identityClaimBindingSha256"] = expected_claim_binding(row, "identity")
    row["corporateActionClaimBindingSha256"] = expected_claim_binding(row, "corporateAction")
    return row


def build_artifacts(
    source_inventory: Path,
    prices_directory: Path,
    research_corpus: Path,
    created_at: str,
) -> tuple[dict[str, Any], dict[str, Any], bytes, bytes]:
    created_at = parse_created_at(created_at)
    if not research_corpus.is_file():
        raise PublicAiManifestError("research corpus is not exact V94")
    corpus_bytes = research_corpus.read_bytes()
    if sha256_bytes(corpus_bytes) != V94_CORPUS_SHA256:
        raise PublicAiManifestError("research corpus is not exact V94")
    try:
        corpus = json.loads(corpus_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise PublicAiManifestError("research corpus is invalid JSON") from exc
    if corpus.get("outcomesAccessed") is not False or corpus.get("productiveGqsModified") is not False:
        raise PublicAiManifestError("research corpus outcome lock is open")
    source_sha256, candidates = load_candidates(source_inventory)
    price_metadata = load_price_metadata(prices_directory, {row[2] for row in candidates})
    rows = [
        unresolved_row(dataset, observed_at, ticker, status, price_metadata[ticker])
        for dataset, observed_at, ticker, status in candidates
    ]
    evidence = {
        "schema": IDENTITY_EVIDENCE_SCHEMA,
        "createdAt": created_at,
        "sourceCorpusSha256": V94_CORPUS_SHA256,
        "outcomesAccessed": False,
        "rows": [
            {key: row[key] for key in sorted(IDENTITY_EVIDENCE_ROW_KEYS)}
            for row in rows
        ],
    }
    evidence_bytes = serialize_json(evidence)
    manifest = {
        "schema": INPUT_SCHEMA,
        "createdAt": created_at,
        "sourceInventorySha256": source_sha256,
        "identityEvidenceSha256": sha256_bytes(evidence_bytes),
        "outcomesAccessed": False,
        "containsOutcomeFields": False,
        "rows": rows,
    }
    manifest_bytes = serialize_json(manifest)
    return manifest, evidence, manifest_bytes, evidence_bytes


def write_new(path: Path, value: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as handle:
        handle.write(value)


def self_test() -> dict[str, Any]:
    with tempfile.TemporaryDirectory() as folder:
        root = Path(folder)
        database = root / "bridge.sqlite"
        connection = sqlite3.connect(database)
        connection.executescript(
            """
            CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);
            INSERT INTO meta VALUES('schema','early-detection-entity-bridge/v2');
            CREATE TABLE snapshots(snapshot_id INTEGER PRIMARY KEY,dataset TEXT,observed_at TEXT);
            CREATE TABLE candidates(snapshot_id INTEGER,ticker TEXT,status TEXT);
            INSERT INTO snapshots VALUES(1,'nasdaqlisted','2014-06-30T00:00:00Z');
            INSERT INTO candidates VALUES
                (1,'AGO$B','CANDIDATE_UNADJUDICATED'),
                (1,'MISS','AMBIGUOUS');
            """
        )
        connection.commit()
        connection.close()
        prices = root / "prices"
        prices.mkdir()
        price_rows = [
            {"date": (date(2013, 1, 1) + timedelta(days=index)).isoformat(), "close": index + 1}
            for index in range(600)
        ]
        price_rows[-1]["close"] = 0
        (prices / safe_price_filename("AGO$B")).write_text(json.dumps(price_rows), encoding="utf-8")
        corpus = root / "v94.json"
        corpus.write_text(json.dumps({"outcomesAccessed": False, "productiveGqsModified": False}), encoding="utf-8")
        global V94_CORPUS_SHA256
        expected_v94 = V94_CORPUS_SHA256
        try:
            V94_CORPUS_SHA256 = sha256_file(corpus)
            manifest, evidence, manifest_bytes, evidence_bytes = build_artifacts(
                database,
                prices,
                corpus,
                "2026-08-12T00:00:00Z",
            )
        finally:
            V94_CORPUS_SHA256 = expected_v94
        if len(manifest["rows"]) != 2 or manifest["identityEvidenceSha256"] != sha256_bytes(evidence_bytes):
            raise PublicAiManifestError("fixture row or evidence binding changed")
        preferred = manifest["rows"][0]
        if preferred["ticker"] != "AGO$B" or preferred["priorBarCount"] != 545:
            raise PublicAiManifestError("preferred ticker or strict-before bar count changed")
        if any(row["identityAdjudication"] != "UNRESOLVED" for row in manifest["rows"]):
            raise PublicAiManifestError("builder inferred an identity adjudication")
        if manifest["outcomesAccessed"] or manifest["containsOutcomeFields"] or evidence["outcomesAccessed"]:
            raise PublicAiManifestError("fixture opened an outcome lock")
        if json.loads(manifest_bytes.decode("utf-8")) != manifest:
            raise PublicAiManifestError("manifest serialization changed")
        cross_boundary_rows = [
            {"date": "2014-06-29", "close": 10},
            {"date": "2014-06-30", "close": 0},
            {"date": "2014-06-28", "close": 10},
        ]
        if prior_price_count(cross_boundary_rows, "2014-06-30") != (False, 0):
            raise PublicAiManifestError("post-boundary prior row was accepted")
        future_reordered_rows = [
            {"date": "2014-06-29", "close": 10},
            {"date": "2014-07-02", "close": 0},
            {"date": "2014-07-01", "close": 0},
        ]
        if prior_price_count(future_reordered_rows, "2014-06-30") != (True, 1):
            raise PublicAiManifestError("future-only date order changed prior price validity")
        try:
            load_price_metadata(prices, {"AGO$B", "AGO^B"})
        except PublicAiManifestError:
            pass
        else:
            raise PublicAiManifestError("canonical price filename collision was accepted")
        try:
            parse_created_at("2026-08-12T00:00:00+00:00")
        except PublicAiManifestError:
            pass
        else:
            raise PublicAiManifestError("non-canonical createdAt was accepted")
        try:
            parse_observed_at("2014-06-30T00:00:00+00:00")
        except PublicAiManifestError:
            pass
        else:
            raise PublicAiManifestError("non-canonical observedAt was accepted")
        try:
            parse_observed_at("20140630T000000Z")
        except PublicAiManifestError:
            pass
        else:
            raise PublicAiManifestError("compact observedAt was accepted")
        return {
            "status": "PASS",
            "syntheticFixtureOnly": True,
            "rows": len(manifest["rows"]),
            "historicalPreferredTickerBound": True,
            "strictBeforeObservedDate": True,
            "identitySemanticsInferred": False,
            "futurePriceRowsIgnored": True,
            "postBoundaryPriorRowRejected": True,
            "futureDateOrderIgnored": True,
            "priceFilenameCollisionRejected": True,
            "nonCanonicalCreatedAtRejected": True,
            "nonCanonicalObservedAtRejected": True,
            "compactObservedAtRejected": True,
            "priceFilenameExamples": {
                "preferred": safe_price_filename("AGO$B"),
                "reserved": safe_price_filename("CON"),
            },
            "outcomesAccessed": False,
        }


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    sub = value.add_subparsers(dest="command", required=True)
    build = sub.add_parser("build")
    build.add_argument("--source-inventory", type=Path, required=True)
    build.add_argument("--prices-directory", type=Path, required=True)
    build.add_argument("--research-corpus", type=Path, required=True)
    build.add_argument("--created-at", required=True)
    build.add_argument("--input-manifest-output", type=Path, required=True)
    build.add_argument("--identity-evidence-output", type=Path, required=True)
    sub.add_parser("self-test")
    return value


def main() -> int:
    args = parser().parse_args()
    if args.command == "self-test":
        printed = self_test()
    else:
        input_output = args.input_manifest_output.expanduser().resolve()
        evidence_output = args.identity_evidence_output.expanduser().resolve()
        if input_output == evidence_output or input_output.exists() or evidence_output.exists():
            raise PublicAiManifestError("outputs must be distinct and must not already exist")
        manifest, _evidence, manifest_bytes, evidence_bytes = build_artifacts(
            args.source_inventory.expanduser().resolve(),
            args.prices_directory.expanduser().resolve(),
            args.research_corpus.expanduser().resolve(),
            args.created_at,
        )
        write_new(evidence_output, evidence_bytes)
        write_new(input_output, manifest_bytes)
        printed = {
            "status": "OUTCOME_BLIND_INPUTS_BUILT",
            "inputRows": len(manifest["rows"]),
            "inputManifestSha256": sha256_bytes(manifest_bytes),
            "identityEvidenceSha256": sha256_bytes(evidence_bytes),
            "sourceInventorySha256": manifest["sourceInventorySha256"],
            "identitySemantics": "UNRESOLVED",
            "cohortSelected": False,
            "outcomesAccessed": False,
        }
    print(json.dumps(printed, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
