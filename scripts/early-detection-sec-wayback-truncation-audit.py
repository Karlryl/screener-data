#!/usr/bin/env python3
"""Prove that a truncated Wayback FSD capture is not a distinct valid revision."""

from __future__ import annotations

import argparse
import base64
import hashlib
import http.client
import json
import tempfile
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REQUIRED_MEMBERS = {"num.txt", "pre.txt", "sub.txt", "tag.txt"}
USER_AGENT = "Growth-Screener-Research/1.0 contact=https://github.com/Karlryl/screener-data"


class AuditError(RuntimeError):
    pass


def canonical_sha256(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(4 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def sha1_base32(payload: bytes) -> str:
    return base64.b32encode(hashlib.sha1(payload).digest()).decode("ascii").rstrip("=")


def safe_child(root: Path, relative: str) -> Path:
    candidate = (root / relative).resolve()
    try:
        candidate.relative_to(root.resolve())
    except ValueError as exc:
        raise AuditError(f"path escapes data root: {relative}") from exc
    return candidate


def cdx_rows(path: Path) -> list[dict[str, Any]]:
    raw = json.loads(path.read_text(encoding="utf-8-sig"))
    columns = ["timestamp", "original", "mimetype", "statuscode", "digest", "length"]
    if not isinstance(raw, list) or not raw or raw[0] != columns:
        raise AuditError("CDX cache schema changed")
    result: list[dict[str, Any]] = []
    for values in raw[1:]:
        if not isinstance(values, list) or len(values) != len(columns):
            raise AuditError("invalid CDX row")
        row = dict(zip(columns, values))
        row["length"] = int(row["length"])
        result.append(row)
    return result


def validate_complete_candidate(data_root: Path, observation: dict[str, Any], partial: bytes, full_bytes: int) -> dict[str, Any] | None:
    if observation.get("qualityState") != "accepted" or int(observation.get("payloadBytes", -1)) != full_bytes:
        return None
    payload_path = safe_child(data_root, str(observation.get("payloadPath", "")))
    if not payload_path.is_file() or file_sha256(payload_path) != observation.get("payloadSha256"):
        return None
    with payload_path.open("rb") as handle:
        if handle.read(len(partial)) != partial:
            return None
    try:
        with zipfile.ZipFile(payload_path) as archive:
            names = {Path(name).name.lower() for name in archive.namelist()}
            missing = sorted(REQUIRED_MEMBERS - names)
            corrupt_member = archive.testzip()
    except (OSError, zipfile.BadZipFile) as exc:
        raise AuditError(f"matched complete payload is not a readable ZIP: {exc}") from exc
    if missing or corrupt_member is not None:
        raise AuditError(f"matched complete payload failed ZIP contract: missing={missing} corrupt={corrupt_member}")
    return {
        "payloadPath": str(payload_path),
        "payloadBytes": full_bytes,
        "payloadSha256": observation["payloadSha256"],
        "observedAt": observation["observedAt"],
        "datasetVariant": observation["datasetVariant"],
        "requiredMembersPresent": sorted(REQUIRED_MEMBERS),
        "zipIntegrity": "PASS",
        "partialIsExactPrefix": True,
    }


def match_complete_payload(data_root: Path, quarter: str, partial: bytes, full_bytes: int) -> dict[str, Any]:
    observation_root = data_root / "observations" / "sec-fsd" / quarter
    for path in sorted(observation_root.glob("*.json")):
        observation = json.loads(path.read_text(encoding="utf-8-sig"))
        matched = validate_complete_candidate(data_root, observation, partial, full_bytes)
        if matched is not None:
            return {"observationPath": str(path), **matched}
    raise AuditError("no complete accepted payload matches the truncated prefix and declared full length")


def fetch_truncated(url: str, timeout: int) -> tuple[bytes, int]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept-Encoding": "identity"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            response.read()
    except http.client.IncompleteRead as exc:
        return bytes(exc.partial), len(exc.partial) + int(exc.expected)
    raise AuditError("Wayback replay is no longer truncated; ingest it as a normal revision")


def audit(data_root: Path, cdx_cache: Path, quarter: str, digest: str, output: Path, timeout: int) -> dict[str, Any]:
    if output.exists():
        raise AuditError("refusing to overwrite output")
    matches = [row for row in cdx_rows(cdx_cache) if row["digest"] == digest and quarter in str(row["original"])]
    if len(matches) != 1:
        raise AuditError(f"expected one CDX row, found {len(matches)}")
    row = matches[0]
    replay_url = f"https://web.archive.org/web/{row['timestamp']}id_/{row['original']}"
    partial, declared_full_bytes = fetch_truncated(replay_url, timeout)
    actual_digest = sha1_base32(partial)
    if actual_digest != digest:
        raise AuditError(f"truncated payload digest mismatch: expected={digest} actual={actual_digest}")
    complete = match_complete_payload(data_root, quarter, partial, declared_full_bytes)
    unsigned = {
        "schema": "early-detection-sec-wayback-truncation-audit/v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "status": "PASS_TRUNCATED_ARCHIVE_DUPLICATE_NOT_DISTINCT_REVISION",
        "quarter": quarter,
        "cdxCache": str(cdx_cache.resolve()),
        "cdxCacheSha256": file_sha256(cdx_cache),
        "cdxRow": row,
        "replayUrl": replay_url,
        "partialBytes": len(partial),
        "partialSha1Base32": actual_digest,
        "declaredFullPayloadBytes": declared_full_bytes,
        "archiveRecordOverheadBytes": int(row["length"]) - len(partial),
        "completePayloadMatch": complete,
        "decision": "The CDX record is a truncated prefix of an already captured complete SEC ZIP with the same declared full length; it is not counted as a distinct valid source revision.",
        "confirmatoryEligible": False,
        "outcomesAccessed": False,
        "productiveGqsModified": False,
    }
    result = {**unsigned, "reportSha256": canonical_sha256(unsigned)}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return result


def self_test() -> dict[str, Any]:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        payload_path = root / "blobs" / "sha256" / "fixture.zip"
        payload_path.parent.mkdir(parents=True)
        with zipfile.ZipFile(payload_path, "w", zipfile.ZIP_DEFLATED) as archive:
            for name in sorted(REQUIRED_MEMBERS):
                archive.writestr(name, name.encode("ascii") * 100)
        payload = payload_path.read_bytes()
        partial = payload[: max(1, len(payload) // 3)]
        observation_root = root / "observations" / "sec-fsd" / "2020q4"
        observation_root.mkdir(parents=True)
        observation = {
            "qualityState": "accepted",
            "payloadBytes": len(payload),
            "payloadPath": payload_path.relative_to(root).as_posix(),
            "payloadSha256": file_sha256(payload_path),
            "observedAt": "2021-01-01T00:00:00.000Z",
            "datasetVariant": "fixture_complete",
        }
        (observation_root / "fixture.json").write_text(json.dumps(observation), encoding="utf-8")
        matched = match_complete_payload(root, "2020q4", partial, len(payload))
        if not matched["partialIsExactPrefix"] or matched["zipIntegrity"] != "PASS":
            raise AuditError("self-test failed")
    return {"status": "PASS", "partialDigestVerified": bool(sha1_base32(partial)), "completePrefixMatched": True}


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    commands = value.add_subparsers(dest="command", required=True)
    run = commands.add_parser("audit")
    run.add_argument("--data-root", type=Path, required=True)
    run.add_argument("--cdx-cache", type=Path, required=True)
    run.add_argument("--quarter", required=True)
    run.add_argument("--digest", required=True)
    run.add_argument("--output", type=Path, required=True)
    run.add_argument("--timeout", type=int, default=300)
    commands.add_parser("self-test")
    return value


def main() -> int:
    args = parser().parse_args()
    result = self_test() if args.command == "self-test" else audit(
        args.data_root.resolve(), args.cdx_cache.resolve(), args.quarter, args.digest, args.output.resolve(), args.timeout,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
