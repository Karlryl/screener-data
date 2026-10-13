#!/usr/bin/env python3
"""Build a compact, lossless derived SEC FSD point-in-time index.

The append-only raw store remains the evidence source.  This index replaces
repeated payload hashes, accession strings, concepts, units and tag definition
texts with integer keys, stores row hashes as 32-byte blobs, and commits one
payload at a time.  No source row or source version is dropped.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import io
import json
import re
import sqlite3
import sys
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from types import ModuleType
from typing import Any


SCHEMA = "early-detection-pit-compact-sqlite/v1"
TIME_POLICY = "SEC_EASTERN_US_DST_2007PLUS_V1"


class CompactPitError(RuntimeError):
    """The compact PIT contract could not be satisfied."""


def load_wide_module() -> ModuleType:
    path = Path(__file__).resolve().with_name("early-detection-pit.py")
    spec = importlib.util.spec_from_file_location("early_detection_pit_wide", path)
    if spec is None or spec.loader is None:
        raise CompactPitError(f"cannot load PIT parser module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def hash_blob(hex_digest: str) -> bytes:
    try:
        value = bytes.fromhex(hex_digest)
    except ValueError as exc:
        raise CompactPitError("invalid SHA-256 hex digest") from exc
    if len(value) != 32:
        raise CompactPitError("SHA-256 digest must contain 32 bytes")
    return value


def date_integer(value: str | None) -> int | None:
    return int(value.replace("-", "")) if value else None


def timestamp_epoch(value: str) -> int:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise CompactPitError("timestamp is not timezone-qualified")
    return int(parsed.timestamp())


def quarter_key(value: str) -> int:
    match = re.fullmatch(r"(20\d{2})q([1-4])", value)
    if match is None:
        raise CompactPitError(f"invalid quarter: {value}")
    return int(match.group(1)) * 4 + int(match.group(2)) - 1


def connect(database: Path) -> sqlite3.Connection:
    resolved = database.expanduser().resolve()
    if resolved == Path(resolved.anchor):
        raise CompactPitError("database path cannot be a filesystem root")
    resolved.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(resolved)
    connection.execute("PRAGMA foreign_keys=ON")
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA synchronous=NORMAL")
    connection.execute("PRAGMA temp_store=MEMORY")
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        ) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS source_payloads (
          payload_id INTEGER PRIMARY KEY,
          payload_sha256 TEXT NOT NULL UNIQUE,
          quarter TEXT NOT NULL,
          observed_at_epoch INTEGER NOT NULL,
          observed_at TEXT NOT NULL,
          source_url TEXT NOT NULL,
          payload_path TEXT NOT NULL,
          payload_bytes INTEGER NOT NULL,
          observation_sha256 BLOB NOT NULL,
          imported_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS concepts (
          concept_id INTEGER PRIMARY KEY,
          tag TEXT NOT NULL,
          version TEXT NOT NULL,
          UNIQUE(tag, version)
        );
        CREATE TABLE IF NOT EXISTS units (
          unit_id INTEGER PRIMARY KEY,
          uom TEXT NOT NULL UNIQUE
        );
        CREATE TABLE IF NOT EXISTS submissions (
          submission_id INTEGER PRIMARY KEY,
          payload_id INTEGER NOT NULL,
          adsh TEXT NOT NULL,
          cik INTEGER NOT NULL,
          name TEXT NOT NULL,
          sic INTEGER,
          countryba TEXT,
          form TEXT NOT NULL,
          period_end INTEGER,
          fy INTEGER,
          fp TEXT,
          filed_date INTEGER NOT NULL,
          accepted_raw TEXT NOT NULL,
          accepted_at_epoch INTEGER NOT NULL,
          prevrpt INTEGER NOT NULL,
          detail INTEGER NOT NULL,
          instance TEXT,
          row_sha256 BLOB NOT NULL,
          UNIQUE(payload_id, adsh),
          FOREIGN KEY(payload_id) REFERENCES source_payloads(payload_id)
        );
        CREATE TABLE IF NOT EXISTS facts (
          payload_id INTEGER NOT NULL,
          row_number INTEGER NOT NULL,
          submission_id INTEGER NOT NULL,
          concept_id INTEGER NOT NULL,
          ddate INTEGER NOT NULL,
          qtrs INTEGER NOT NULL,
          unit_id INTEGER NOT NULL,
          coreg TEXT,
          value_text TEXT,
          footnote TEXT,
          row_sha256 BLOB NOT NULL,
          PRIMARY KEY(payload_id, row_number),
          FOREIGN KEY(payload_id) REFERENCES source_payloads(payload_id),
          FOREIGN KEY(submission_id) REFERENCES submissions(submission_id),
          FOREIGN KEY(concept_id) REFERENCES concepts(concept_id),
          FOREIGN KEY(unit_id) REFERENCES units(unit_id)
        ) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS presentations (
          payload_id INTEGER NOT NULL,
          row_number INTEGER NOT NULL,
          submission_id INTEGER NOT NULL,
          report INTEGER NOT NULL,
          line INTEGER NOT NULL,
          stmt TEXT,
          inpth INTEGER NOT NULL,
          rfile TEXT,
          concept_id INTEGER NOT NULL,
          plabel TEXT,
          negating INTEGER NOT NULL,
          row_sha256 BLOB NOT NULL,
          PRIMARY KEY(payload_id, row_number),
          FOREIGN KEY(payload_id) REFERENCES source_payloads(payload_id),
          FOREIGN KEY(submission_id) REFERENCES submissions(submission_id),
          FOREIGN KEY(concept_id) REFERENCES concepts(concept_id)
        ) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS tag_definitions (
          definition_id INTEGER PRIMARY KEY,
          concept_id INTEGER NOT NULL,
          custom INTEGER NOT NULL,
          abstract INTEGER NOT NULL,
          datatype TEXT,
          iord TEXT,
          crdr TEXT,
          tlabel TEXT,
          doc TEXT,
          row_sha256 BLOB NOT NULL UNIQUE,
          FOREIGN KEY(concept_id) REFERENCES concepts(concept_id)
        );
        CREATE TABLE IF NOT EXISTS payload_tags (
          payload_id INTEGER NOT NULL,
          row_number INTEGER NOT NULL,
          definition_id INTEGER NOT NULL,
          PRIMARY KEY(payload_id, row_number),
          FOREIGN KEY(payload_id) REFERENCES source_payloads(payload_id),
          FOREIGN KEY(definition_id) REFERENCES tag_definitions(definition_id)
        ) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS payload_stats (
          payload_id INTEGER PRIMARY KEY,
          submissions INTEGER NOT NULL,
          facts INTEGER NOT NULL,
          presentations INTEGER NOT NULL,
          tags INTEGER NOT NULL,
          submission_rows_sha256 BLOB NOT NULL,
          fact_rows_sha256 BLOB NOT NULL,
          presentation_rows_sha256 BLOB NOT NULL,
          tag_rows_sha256 BLOB NOT NULL,
          FOREIGN KEY(payload_id) REFERENCES source_payloads(payload_id)
        ) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS orphan_rows (
          payload_id INTEGER NOT NULL,
          member TEXT NOT NULL,
          row_number INTEGER NOT NULL,
          foreign_key TEXT NOT NULL,
          reason TEXT NOT NULL,
          row_json TEXT NOT NULL,
          row_sha256 BLOB NOT NULL,
          PRIMARY KEY(payload_id,member,row_number),
          FOREIGN KEY(payload_id) REFERENCES source_payloads(payload_id)
        ) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS payload_orphan_stats (
          payload_id INTEGER PRIMARY KEY,
          rows INTEGER NOT NULL,
          rows_sha256 BLOB NOT NULL,
          FOREIGN KEY(payload_id) REFERENCES source_payloads(payload_id)
        ) WITHOUT ROWID;
        """
    )
    current = connection.execute("SELECT value FROM meta WHERE key='schema'").fetchone()
    if current and current[0] != SCHEMA:
        raise CompactPitError(f"database has incompatible schema {current[0]}")
    connection.execute("INSERT OR IGNORE INTO meta VALUES('schema',?)", (SCHEMA,))
    connection.execute("INSERT OR IGNORE INTO meta VALUES('time_policy',?)", (TIME_POLICY,))
    connection.execute(
        "INSERT OR IGNORE INTO payload_orphan_stats(payload_id,rows,rows_sha256) "
        "SELECT payload_id,0,? FROM payload_stats",
        (hashlib.sha256().digest(),),
    )
    connection.commit()
    return connection


def dictionary_id(
    connection: sqlite3.Connection,
    cache: dict[Any, int],
    key: Any,
    table: str,
    id_column: str,
    insert_sql: str,
    insert_values: tuple[Any, ...],
    lookup_sql: str,
    lookup_values: tuple[Any, ...],
) -> int:
    cached = cache.get(key)
    if cached is not None:
        return cached
    connection.execute(insert_sql, insert_values)
    row = connection.execute(lookup_sql, lookup_values).fetchone()
    if row is None:
        raise CompactPitError(f"failed to resolve {table}.{id_column}")
    cache[key] = int(row[0])
    return int(row[0])


def import_payload(
    connection: sqlite3.Connection,
    parser: ModuleType,
    data_root: Path,
    observation_path: Path,
    observation: dict[str, Any],
    concept_cache: dict[tuple[str, str], int],
    unit_cache: dict[str, int],
) -> dict[str, int]:
    digest = str(observation["payloadSha256"])
    if connection.execute("SELECT 1 FROM source_payloads WHERE payload_sha256=?", (digest,)).fetchone():
        return {"payloadsReused": 1, "submissions": 0, "facts": 0, "presentations": 0, "tags": 0, "orphans": 0}
    payload_path = data_root / str(observation["payloadPath"])
    counts = {"payloadsImported": 1, "submissions": 0, "facts": 0, "presentations": 0, "tags": 0, "orphans": 0}
    hashers = {name: hashlib.sha256() for name in ("submissions", "facts", "presentations", "tags")}
    orphan_hasher = hashlib.sha256()
    with zipfile.ZipFile(payload_path) as archive:
        members = parser.archive_members(archive)
        with connection:
            cursor = connection.execute(
                """INSERT INTO source_payloads(
                     payload_sha256,quarter,observed_at_epoch,observed_at,source_url,
                     payload_path,payload_bytes,observation_sha256,imported_at
                   ) VALUES(?,?,?,?,?,?,?,?,?)""",
                (
                    digest, str(observation["quarter"]), timestamp_epoch(str(observation["observedAt"])),
                    str(observation["observedAt"]), str(observation["sourceUrl"]),
                    str(observation["payloadPath"]), int(observation["payloadBytes"]),
                    hash_blob(sha256_file(observation_path)), utc_now(),
                ),
            )
            payload_id = int(cursor.lastrowid)
            submissions: dict[str, int] = {}
            for row in parser.tsv_rows(archive, members["sub.txt"]):
                parser.require(row, ("adsh", "cik", "name", "form", "filed", "accepted", "prevrpt", "detail"), "sub")
                row_hash = parser.row_digest(row)
                accepted_at = parser.sec_eastern_to_utc(row["accepted"])
                cursor = connection.execute(
                    """INSERT INTO submissions(
                         payload_id,adsh,cik,name,sic,countryba,form,period_end,fy,fp,
                         filed_date,accepted_raw,accepted_at_epoch,prevrpt,detail,instance,row_sha256
                       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        payload_id, row["adsh"], parser.integer(row["cik"], "sub.cik", False), row["name"],
                        parser.integer(row.get("sic"), "sub.sic"), row.get("countryba") or None, row["form"],
                        date_integer(parser.parse_date(row.get("period"), "sub.period")),
                        parser.integer(row.get("fy"), "sub.fy"), row.get("fp") or None,
                        date_integer(parser.parse_date(row["filed"], "sub.filed")), row["accepted"],
                        timestamp_epoch(accepted_at), parser.boolean_int(row["prevrpt"], "sub.prevrpt"),
                        parser.boolean_int(row["detail"], "sub.detail"), row.get("instance") or None,
                        hash_blob(row_hash),
                    ),
                )
                submissions[row["adsh"]] = int(cursor.lastrowid)
                hashers["submissions"].update(hash_blob(row_hash))
                counts["submissions"] += 1
            for number, row in enumerate(parser.tsv_rows(archive, members["num.txt"]), start=1):
                parser.require(row, ("adsh", "tag", "version", "ddate", "qtrs", "uom"), "num")
                submission_id = submissions.get(row["adsh"])
                if submission_id is None:
                    row_hash = parser.row_digest(row)
                    connection.execute(
                        "INSERT INTO orphan_rows VALUES(?,?,?,?,?,?,?)",
                        (
                            payload_id, "num.txt", number, row["adsh"], "missing_submission",
                            json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
                            hash_blob(row_hash),
                        ),
                    )
                    orphan_hasher.update(hash_blob(row_hash))
                    counts["orphans"] += 1
                    continue
                concept_key = (row["tag"], row["version"])
                concept_id = dictionary_id(
                    connection, concept_cache, concept_key, "concepts", "concept_id",
                    "INSERT OR IGNORE INTO concepts(tag,version) VALUES(?,?)", concept_key,
                    "SELECT concept_id FROM concepts WHERE tag=? AND version=?", concept_key,
                )
                unit_id = dictionary_id(
                    connection, unit_cache, row["uom"], "units", "unit_id",
                    "INSERT OR IGNORE INTO units(uom) VALUES(?)", (row["uom"],),
                    "SELECT unit_id FROM units WHERE uom=?", (row["uom"],),
                )
                row_hash = parser.row_digest(row)
                connection.execute(
                    "INSERT INTO facts VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        payload_id, number, submission_id, concept_id,
                        date_integer(parser.parse_date(row["ddate"], "num.ddate")),
                        parser.integer(row["qtrs"], "num.qtrs", False), unit_id,
                        row.get("coreg") or None, row.get("value") or None,
                        row.get("footnote") or None, hash_blob(row_hash),
                    ),
                )
                hashers["facts"].update(hash_blob(row_hash))
                counts["facts"] += 1
            for number, row in enumerate(parser.tsv_rows(archive, members["pre.txt"]), start=1):
                parser.require(row, ("adsh", "report", "line", "inpth", "tag", "version", "negating"), "pre")
                submission_id = submissions.get(row["adsh"])
                if submission_id is None:
                    row_hash = parser.row_digest(row)
                    connection.execute(
                        "INSERT INTO orphan_rows VALUES(?,?,?,?,?,?,?)",
                        (
                            payload_id, "pre.txt", number, row["adsh"], "missing_submission",
                            json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
                            hash_blob(row_hash),
                        ),
                    )
                    orphan_hasher.update(hash_blob(row_hash))
                    counts["orphans"] += 1
                    continue
                concept_key = (row["tag"], row["version"])
                concept_id = dictionary_id(
                    connection, concept_cache, concept_key, "concepts", "concept_id",
                    "INSERT OR IGNORE INTO concepts(tag,version) VALUES(?,?)", concept_key,
                    "SELECT concept_id FROM concepts WHERE tag=? AND version=?", concept_key,
                )
                row_hash = parser.row_digest(row)
                connection.execute(
                    "INSERT INTO presentations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        payload_id, number, submission_id, parser.integer(row["report"], "pre.report", False),
                        parser.integer(row["line"], "pre.line", False), row.get("stmt") or None,
                        parser.integer(row["inpth"], "pre.inpth", False), row.get("rfile") or None,
                        concept_id, row.get("plabel") or None,
                        parser.boolean_int(row["negating"], "pre.negating"), hash_blob(row_hash),
                    ),
                )
                hashers["presentations"].update(hash_blob(row_hash))
                counts["presentations"] += 1
            for number, row in enumerate(parser.tsv_rows(archive, members["tag.txt"]), start=1):
                parser.require(row, ("tag", "version", "custom", "abstract"), "tag")
                concept_key = (row["tag"], row["version"])
                concept_id = dictionary_id(
                    connection, concept_cache, concept_key, "concepts", "concept_id",
                    "INSERT OR IGNORE INTO concepts(tag,version) VALUES(?,?)", concept_key,
                    "SELECT concept_id FROM concepts WHERE tag=? AND version=?", concept_key,
                )
                row_hash = parser.row_digest(row)
                row_hash_blob = hash_blob(row_hash)
                connection.execute(
                    """INSERT OR IGNORE INTO tag_definitions(
                         concept_id,custom,abstract,datatype,iord,crdr,tlabel,doc,row_sha256
                       ) VALUES(?,?,?,?,?,?,?,?,?)""",
                    (
                        concept_id, parser.boolean_int(row["custom"], "tag.custom"),
                        parser.boolean_int(row["abstract"], "tag.abstract"), row.get("datatype") or None,
                        row.get("iord") or None, row.get("crdr") or None, row.get("tlabel") or None,
                        row.get("doc") or None, row_hash_blob,
                    ),
                )
                definition = connection.execute(
                    "SELECT definition_id FROM tag_definitions WHERE row_sha256=?", (row_hash_blob,)
                ).fetchone()
                if definition is None:
                    raise CompactPitError("failed to resolve tag definition")
                connection.execute(
                    "INSERT INTO payload_tags VALUES(?,?,?)",
                    (payload_id, number, int(definition[0])),
                )
                hashers["tags"].update(row_hash_blob)
                counts["tags"] += 1
            connection.execute(
                "INSERT INTO payload_stats VALUES(?,?,?,?,?,?,?,?,?)",
                (
                    payload_id, counts["submissions"], counts["facts"], counts["presentations"], counts["tags"],
                    hashers["submissions"].digest(), hashers["facts"].digest(),
                    hashers["presentations"].digest(), hashers["tags"].digest(),
                ),
            )
            connection.execute(
                "INSERT INTO payload_orphan_stats VALUES(?,?,?)",
                (payload_id, counts["orphans"], orphan_hasher.digest()),
            )
    return counts


def status_database(connection: sqlite3.Connection) -> dict[str, Any]:
    issues: list[str] = []
    schema = connection.execute("SELECT value FROM meta WHERE key='schema'").fetchone()
    if not schema or schema[0] != SCHEMA:
        issues.append("schema")
    rows = connection.execute(
        """SELECT p.quarter, COUNT(*), SUM(s.submissions), SUM(s.facts),
                  SUM(s.presentations), SUM(s.tags), SUM(COALESCE(o.rows,0))
           FROM source_payloads p JOIN payload_stats s USING(payload_id)
           LEFT JOIN payload_orphan_stats o USING(payload_id)
           GROUP BY p.quarter ORDER BY p.quarter"""
    ).fetchall()
    return {
        "schema": "early-detection-pit-compact-status/v1",
        "status": "PASS" if not issues else "FAIL",
        "checkedAt": utc_now(),
        "sourcePayloads": sum(int(row[1]) for row in rows),
        "totals": {
            "submissions": sum(int(row[2] or 0) for row in rows),
            "facts": sum(int(row[3] or 0) for row in rows),
            "presentations": sum(int(row[4] or 0) for row in rows),
            "tags": sum(int(row[5] or 0) for row in rows),
            "orphans": sum(int(row[6] or 0) for row in rows),
        },
        "quarters": [
            {
                "quarter": row[0], "payloads": int(row[1]), "submissions": int(row[2] or 0),
                "facts": int(row[3] or 0), "presentations": int(row[4] or 0), "tags": int(row[5] or 0),
                "orphans": int(row[6] or 0),
            }
            for row in rows
        ],
        "issues": issues,
        "readiness": "COMPACT_IMPORT_PASS_NOT_FULL_INTEGRITY_AUDIT" if rows else "NOT_READY_EMPTY",
    }


def import_store(
    data_root: Path,
    database: Path,
    from_quarter: str | None = None,
    to_quarter: str | None = None,
) -> dict[str, Any]:
    parser = load_wide_module()
    root = data_root.expanduser().resolve()
    connection = connect(database)
    totals: dict[str, int] = {}
    concept_cache: dict[tuple[str, str], int] = {
        (str(row[1]), str(row[2])): int(row[0])
        for row in connection.execute("SELECT concept_id,tag,version FROM concepts")
    }
    unit_cache: dict[str, int] = {
        str(row[1]): int(row[0]) for row in connection.execute("SELECT unit_id,uom FROM units")
    }
    try:
        lower = quarter_key(from_quarter) if from_quarter else None
        upper = quarter_key(to_quarter) if to_quarter else None
        if lower is not None and upper is not None and lower > upper:
            raise CompactPitError("from-quarter must not be after to-quarter")
        for observation_path, observation in parser.accepted_observations(root):
            current = quarter_key(str(observation["quarter"]))
            if lower is not None and current < lower:
                continue
            if upper is not None and current > upper:
                continue
            result = import_payload(
                connection, parser, root, observation_path, observation,
                concept_cache, unit_cache,
            )
            for key, value in result.items():
                totals[key] = totals.get(key, 0) + value
        status = status_database(connection)
    finally:
        connection.close()
    return {
        "schema": "early-detection-pit-compact-import-result/v1",
        "status": status["status"],
        "dataRoot": str(root),
        "database": str(database.expanduser().resolve()),
        "fromQuarter": from_quarter,
        "toQuarter": to_quarter,
        "import": totals,
        "verification": status,
    }


def status_file(database: Path) -> dict[str, Any]:
    if not database.exists():
        raise CompactPitError("compact PIT database does not exist")
    connection = connect(database)
    try:
        return status_database(connection)
    finally:
        connection.close()


def asof_submission_count(connection: sqlite3.Connection, cutoff: str) -> int:
    return int(connection.execute(
        "SELECT COUNT(*) FROM submissions WHERE accepted_at_epoch<=?",
        (timestamp_epoch(cutoff),),
    ).fetchone()[0])


def self_test() -> dict[str, Any]:
    parser = load_wide_module()
    with tempfile.TemporaryDirectory(prefix="early-detection-pit-compact-") as temporary:
        root = Path(temporary) / "store"
        database = Path(temporary) / "compact.sqlite"
        original = parser.synthetic_fsd()
        tables: dict[str, bytes] = {}
        with zipfile.ZipFile(io.BytesIO(original)) as archive:
            for name in archive.namelist():
                tables[name] = archive.read(name)
        tables["num.txt"] += b"0000000999-20-000001\tRevenues\tus-gaap/2019\t20191231\t1\tUSD\t\t999\t\n"
        tables["pre.txt"] += b"0000000999-20-000001\t1\t1\tIS\t0\tH\tRevenues\tus-gaap/2019\tOrphan\t0\n"
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for name, content in tables.items():
                archive.writestr(name, content)
        payload = buffer.getvalue()
        digest = hashlib.sha256(payload).hexdigest()
        relative = Path("blobs") / "sha256" / digest[:2] / f"{digest}.zip"
        (root / relative).parent.mkdir(parents=True)
        (root / relative).write_bytes(payload)
        (root / "STORE.json").write_text(
            json.dumps({"schema": "early-detection-raw-store/v1"}) + "\n", encoding="utf-8"
        )
        observation = {
            "schema": "early-detection-source-observation/v1",
            "sourceClass": "sec_financial_statement_dataset",
            "sourceUrl": "https://www.sec.gov/example.zip",
            "quarter": "2020q1",
            "observedAt": "2026-01-01T00:00:00.000Z",
            "payloadSha256": digest,
            "payloadBytes": len(payload),
            "payloadPath": relative.as_posix(),
            "qualityState": "accepted",
        }
        observation_path = root / "observations" / "sec-fsd" / "2020q1" / "test.json"
        observation_path.parent.mkdir(parents=True)
        observation_path.write_text(json.dumps(observation) + "\n", encoding="utf-8")
        first = import_store(root, database)
        second = import_store(root, database)
        connection = connect(database)
        try:
            before = asof_submission_count(connection, "2020-02-01T00:00:00.000Z")
            after = asof_submission_count(connection, "2020-03-01T00:00:00.000Z")
            definition_count = int(connection.execute("SELECT COUNT(*) FROM tag_definitions").fetchone()[0])
        finally:
            connection.close()
        if first["verification"]["totals"] != {
            "submissions": 2, "facts": 2, "presentations": 2, "tags": 1, "orphans": 2,
        }:
            raise CompactPitError("compact self-test logical totals failed")
        if second["import"].get("payloadsReused") != 1:
            raise CompactPitError("compact self-test idempotence failed")
        if (before, after) != (1, 2):
            raise CompactPitError("compact self-test as-of exclusion failed")
        if definition_count != 1:
            raise CompactPitError("compact tag definition deduplication failed")
        return {
            "schema": "early-detection-pit-compact-self-test/v1",
            "status": "PASS",
            "totals": first["verification"]["totals"],
            "futureFilingExcludedBeforeCutoff": True,
            "idempotentPayloadReuse": True,
            "tagDefinitions": definition_count,
            "orphanRowsQuarantined": 2,
        }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    ingest = sub.add_parser("import-fsd-store")
    ingest.add_argument("--data-root", type=Path, required=True)
    ingest.add_argument("--database", type=Path, required=True)
    ingest.add_argument("--from-quarter")
    ingest.add_argument("--to-quarter")
    status = sub.add_parser("status")
    status.add_argument("--database", type=Path, required=True)
    sub.add_parser("self-test")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        if args.command == "import-fsd-store":
            result = import_store(
                args.data_root, args.database, args.from_quarter, args.to_quarter
            )
        elif args.command == "status":
            result = status_file(args.database)
        else:
            result = self_test()
        print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
        return 0 if result["status"] == "PASS" else 1
    except (
        CompactPitError, OSError, UnicodeError, ValueError, json.JSONDecodeError,
        sqlite3.Error, zipfile.BadZipFile,
    ) as exc:
        print(f"[early-detection-pit-compact] {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
