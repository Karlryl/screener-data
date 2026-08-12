#!/usr/bin/env python3
"""Timeline-correct, append-only FINRA Public authentication handshake."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "finra-q004-accounted-handshake-contract-v3.json"
TEST = ROOT / "tests" / "run-finra-q004-accounted-handshake-v3.test.js"
BASE = ROOT / "scripts" / "run-finra-q004-accounted-handshake-v2.py"
V2_CONTRACT = ROOT / "research" / "early-detection-v4" / "finra-q004-accounted-handshake-contract-v2.json"
V2_OUTPUT = ROOT / "reports" / "early-detection" / "finra-q004-public-credential-handshake-v2.json"
OUTPUT = ROOT / "reports" / "early-detection" / "finra-q004-public-credential-handshake-v3.json"
REMOTE_NAME = "origin"
REMOTE_BRANCH = "codex/early-detection-v4-gates-20260810"
REMOTE_URL = "https://github.com/Karlryl/screener-data.git"
PARENT = "8c1aca6688b8d266b261d685d70a72573e041a2f"
BASE_SHA = "983d346d04365c482aeb5b5247f14a68a328c280d5451f2274f5cecaf4bca5e3"
V2_CONTRACT_SHA = "449139e652d4b76cf570c232764f018a868f1cf7c99f27952d3ef57212d89798"
V2_OUTPUT_SHA = "b57bc675a219317642bb740f80503e0d94420972dc233cc7a5641547859df394"
HEX64 = re.compile(r"^[0-9a-f]{64}$")
HEX40 = re.compile(r"^[0-9a-f]{40}$")

class StudyError(RuntimeError):
    pass

def fail(message: str) -> None:
    raise StudyError(message)

def canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

def sha_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()

def sha_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def load(path: Path) -> dict:
    try:
        value = json.loads(path.read_text("utf-8"))
    except Exception as exc:
        fail(f"invalid JSON: {path}: {exc}")
    if not isinstance(value, dict):
        fail("top-level JSON object required")
    return value

def git(*args: str, binary: bool = False):
    proc = subprocess.run(["git", *args], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if proc.returncode:
        fail(f"git command failed: {' '.join(args)}")
    return proc.stdout if binary else proc.stdout.decode("utf-8").strip()

def contract_hash(value: dict) -> str:
    body = dict(value); body.pop("contractSha256", None)
    return sha_bytes(canonical(body))

def parse_utc(value: str) -> datetime:
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except Exception:
        fail("invalid UTC timestamp")

def validate_contract() -> dict:
    value = load(CONTRACT)
    if set(value) != {"schema","createdAt","track","taskId","sourceId","purpose","quarantinedPredecessor","preAuthorization","accountContract","handshakeContract","outputContract","claimLocks","contractSha256"}:
        fail("contract keyset changed")
    if value["schema"] != "finra-q004-accounted-handshake-contract/v3" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA" or value["taskId"] != "Q004-FINRA-OTC-CATALOG" or value["sourceId"] != "FINRA_OTC_PRIMARY":
        fail("contract study boundary changed")
    if value["contractSha256"] != contract_hash(value) or not HEX64.fullmatch(value["contractSha256"]):
        fail("contract self-hash mismatch")
    predecessor = value["quarantinedPredecessor"]
    if predecessor != {
        "contractPath":"research/early-detection-v4/finra-q004-accounted-handshake-contract-v2.json",
        "contractRawSha256":V2_CONTRACT_SHA,"contractCreatedAt":"2026-08-12T19:04:00Z",
        "outputPath":"reports/early-detection/finra-q004-public-credential-handshake-v2.json",
        "outputRawSha256":V2_OUTPUT_SHA,"outputCapturedAt":"2026-08-12T18:51:51Z",
        "disposition":"QUARANTINED_INVALID_TIMELINE_ZERO_CREDIT",
        "reason":"The V2 contract timestamp is later than its output capture timestamp. Authentication succeeded, but the evidence cannot establish pre-authorization.",
    }:
        fail("predecessor quarantine changed")
    if sha_file(V2_CONTRACT) != V2_CONTRACT_SHA or sha_file(V2_OUTPUT) != V2_OUTPUT_SHA:
        fail("quarantined predecessor bytes changed")
    if not parse_utc(predecessor["outputCapturedAt"]) < parse_utc(predecessor["contractCreatedAt"]):
        fail("quarantine reason no longer reproduced")
    if value["preAuthorization"] != {
        "parentRemoteCommit":PARENT,"remoteName":REMOTE_NAME,"remoteBranch":REMOTE_BRANCH,
        "repository":REMOTE_URL,"baseImplementationPath":"scripts/run-finra-q004-accounted-handshake-v2.py",
        "baseImplementationRawSha256":BASE_SHA,
    }:
        fail("pre-authorization binding changed")
    if sha_file(BASE) != BASE_SHA:
        fail("base implementation bytes changed")
    if value["accountContract"] != {
        "userType":"INDIVIDUAL","credentialType":"PUBLIC","monthlyFeeUsd":0,
        "monthlyUsageCapLabel":"10 GB","paymentDetailsRequired":False,"trialUsed":False,
        "paidCredentialTypesAllowed":False,"credentialStoreTarget":"GrowthScreener/FINRA/PublicAPI",
        "credentialStore":"WINDOWS_CREDENTIAL_MANAGER",
    }:
        fail("free account boundary changed")
    if value["handshakeContract"] != {
        "tokenEndpoint":"https://ews.fip.finra.org/fip/rest/ews/oauth2/access_token?grant_type=client_credentials",
        "method":"POST","grantType":"client_credentials","maximumRequests":1,
        "redirectsAllowed":False,"environmentProxyUseAllowed":False,"retryAllowed":False,
        "productionDataRequestsAllowed":False,"metadataRequestsAllowed":False,
        "accessTokenMayBePersisted":False,"accessTokenMayBePrinted":False,
    }:
        fail("handshake boundary changed")
    if value["outputContract"] != {
        "path":"reports/early-detection/finra-q004-public-credential-handshake-v3.json",
        "writeNewOnly":True,"canonicalJson":True,"utf8NoBom":True,"lfFinalNewline":True,
        "secretsCaptured":False,"outcomesAccessed":False,"productionRowsCaptured":0,
    }:
        fail("output boundary changed")
    if set(value["claimLocks"]) != {"historicalIdentityIntervalsComplete","terminalPaymentsComplete","terminalSessionsComplete","adjustedOhlcvComplete","corporateActionsComplete","originalV4GateCredit","resultComputationAllowed","outcomesAccessed"} or any(x is not False for x in value["claimLocks"].values()):
        fail("claim locks changed")
    if parse_utc(value["createdAt"]) > datetime.now(timezone.utc):
        fail("contract timestamp is in the future")
    return value

def verify_remote() -> dict:
    head = git("rev-parse","HEAD"); upstream = git("rev-parse","@{upstream}")
    remote_line = git("ls-remote",REMOTE_NAME,f"refs/heads/{REMOTE_BRANCH}")
    remote = remote_line.split()[0] if remote_line else ""
    if git("remote","get-url",REMOTE_NAME) != REMOTE_URL or head != upstream or head != remote or not HEX40.fullmatch(head):
        fail("local/upstream/remote drift")
    if git("rev-parse",f"{head}^") != PARENT:
        fail("implementation commit is not the direct child of pre-authorization parent")
    contract = load(CONTRACT)
    commit_time = datetime.fromtimestamp(int(git("show","-s","--format=%ct",head)), tz=timezone.utc)
    if parse_utc(contract["createdAt"]) > commit_time:
        fail("contract was not created before its implementation commit")
    paths = [CONTRACT,Path(__file__).resolve(),TEST,BASE,V2_CONTRACT,V2_OUTPUT]
    files=[]
    for path in paths:
        rel=path.relative_to(ROOT).as_posix(); local=path.read_bytes(); committed=git("show",f"{head}:{rel}",binary=True)
        if committed != local:
            fail(f"remote Git blob mismatch: {rel}")
        files.append({"path":rel,"rawSha256":sha_bytes(local),"gitCommit":head})
    return {"remoteName":REMOTE_NAME,"remoteBranch":REMOTE_BRANCH,"remoteHead":head,"files":files}

def load_base():
    if sha_file(BASE) != BASE_SHA:
        fail("base implementation changed before import")
    spec=importlib.util.spec_from_file_location("finra_q004_v2_pinned",BASE)
    if spec is None or spec.loader is None:
        fail("base implementation cannot be loaded")
    module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module

def build_report(contract: dict, remote: dict, token_meta: dict, captured_at: str) -> dict:
    report={
        "schema":"finra-q004-public-credential-handshake/v3","capturedAt":captured_at,
        "track":contract["track"],"taskId":contract["taskId"],"sourceId":contract["sourceId"],
        "contractRawSha256":sha_file(CONTRACT),"contractSha256":contract["contractSha256"],
        "quarantinedPredecessor":contract["quarantinedPredecessor"],"implementationBindings":remote,
        "credentialEvidence":{"credentialStore":"WINDOWS_CREDENTIAL_MANAGER","credentialStoreTarget":"GrowthScreener/FINRA/PublicAPI","userType":"INDIVIDUAL","credentialType":"PUBLIC","monthlyFeeUsd":0,"monthlyUsageCapLabel":"10 GB","credentialAuthenticationSucceeded":True,"clientIdCaptured":False,"apiSecretCaptured":False},
        "handshake":token_meta,"requestCounts":{"tokenRequests":1,"metadataRequests":0,"productionDataRequests":0},
        "secretsCaptured":False,"outcomesAccessed":False,"productionRowsCaptured":0,"claimLocks":contract["claimLocks"],
    }
    report["reportSha256"]=sha_bytes(canonical(report)); return report

def validate_report(report: dict, contract: dict) -> None:
    if set(report) != {"schema","capturedAt","track","taskId","sourceId","contractRawSha256","contractSha256","quarantinedPredecessor","implementationBindings","credentialEvidence","handshake","requestCounts","secretsCaptured","outcomesAccessed","productionRowsCaptured","claimLocks","reportSha256"}:
        fail("report keyset changed")
    body=dict(report); claimed=body.pop("reportSha256")
    if claimed != sha_bytes(canonical(body)) or not HEX64.fullmatch(claimed): fail("report self-hash mismatch")
    if report["schema"] != "finra-q004-public-credential-handshake/v3" or report["track"] != contract["track"] or report["taskId"] != contract["taskId"] or report["sourceId"] != contract["sourceId"]: fail("report boundary changed")
    if report["contractRawSha256"] != sha_file(CONTRACT) or report["contractSha256"] != contract["contractSha256"] or report["quarantinedPredecessor"] != contract["quarantinedPredecessor"]: fail("report contract binding changed")
    if not parse_utc(contract["createdAt"]) <= parse_utc(report["capturedAt"]): fail("contract was not frozen before capture")
    if report["requestCounts"] != {"tokenRequests":1,"metadataRequests":0,"productionDataRequests":0}: fail("request counts changed")
    if report["secretsCaptured"] is not False or report["outcomesAccessed"] is not False or report["productionRowsCaptured"] != 0 or report["claimLocks"] != contract["claimLocks"] or any(report["claimLocks"].values()): fail("secret, outcome, or claim boundary changed")
    evidence=report["credentialEvidence"]
    if evidence != {"credentialStore":"WINDOWS_CREDENTIAL_MANAGER","credentialStoreTarget":"GrowthScreener/FINRA/PublicAPI","userType":"INDIVIDUAL","credentialType":"PUBLIC","monthlyFeeUsd":0,"monthlyUsageCapLabel":"10 GB","credentialAuthenticationSucceeded":True,"clientIdCaptured":False,"apiSecretCaptured":False}: fail("credential evidence changed")
    handshake=report["handshake"]
    if set(handshake) != {"httpStatus","contentType","accessTokenPresent","accessTokenPersisted","accessTokenPrinted","tokenType","expiresInSeconds","scope"} or handshake["httpStatus"] != 200 or handshake["contentType"] != "application/json" or handshake["accessTokenPresent"] is not True or handshake["accessTokenPersisted"] is not False or handshake["accessTokenPrinted"] is not False or handshake["tokenType"] != "Bearer" or not isinstance(handshake["expiresInSeconds"],int) or not 60 <= handshake["expiresInSeconds"] <= 86400 or not isinstance(handshake["scope"],str) or not handshake["scope"]: fail("handshake evidence changed")
    serialized=canonical(report).decode("utf-8").casefold()
    for token in ("access_token",'"authorization":"basic ',"api secret","client id\":\""):
        if token in serialized: fail("secret-bearing field leaked")

def write_new(path: Path, raw: bytes) -> None:
    if path.exists(): fail("output already exists")
    path.parent.mkdir(parents=True,exist_ok=True)
    fd,name=tempfile.mkstemp(prefix=f".{path.name}.",suffix=".tmp",dir=path.parent); tmp=Path(name)
    try:
        with os.fdopen(fd,"wb") as handle: handle.write(raw); handle.flush(); os.fsync(handle.fileno())
        os.link(tmp,path)
    finally: tmp.unlink(missing_ok=True)
    if path.read_bytes()!=raw: fail("output readback mismatch")

def self_test(contract: dict) -> dict:
    if not parse_utc(contract["createdAt"]) < datetime.now(timezone.utc): fail("contract timeline not yet active")
    base=load_base(); fake=canonical({"access_token":"SYNTHETIC_TOKEN_NEVER_PERSISTED_123456","expires_in":"43170","scope":"any","token_type":"Bearer"})
    meta=base.sanitize_token_response(fake,200,"application/json")
    remote={"remoteName":REMOTE_NAME,"remoteBranch":REMOTE_BRANCH,"remoteHead":"a"*40,"files":[]}
    report=build_report(contract,remote,meta,"2026-08-12T19:03:00Z"); validate_report(report,contract)
    kills={"predecessorQuarantined":report["quarantinedPredecessor"]["disposition"]=="QUARANTINED_INVALID_TIMELINE_ZERO_CREDIT","syntheticTokenAbsent":b"SYNTHETIC_TOKEN" not in canonical(report)}
    bad=json.loads(json.dumps(report)); bad["capturedAt"]="2026-08-12T19:01:00Z"; body=dict(bad); body.pop("reportSha256"); bad["reportSha256"]=sha_bytes(canonical(body))
    try: validate_report(bad,contract); kills["preContractCaptureRejected"]=False
    except StudyError: kills["preContractCaptureRejected"]=True
    if not all(kills.values()): fail("self-test kill failed")
    return {"schema":"finra-q004-accounted-handshake-self-test/v3","status":"PASS","kills":kills,"outcomesAccessed":False,"secretsCaptured":False}

def main() -> int:
    parser=argparse.ArgumentParser(); parser.add_argument("command",choices=("verify-contract","self-test","handshake","verify-output")); parser.add_argument("--output"); parser.add_argument("--remote",action="store_true"); args=parser.parse_args()
    try:
        contract=validate_contract()
        if args.command=="verify-contract": print(json.dumps({"schema":"finra-q004-accounted-handshake-contract-verification/v3","status":"PASS","contractSha256":contract["contractSha256"],"predecessorCredit":"ZERO","outcomesAccessed":False},sort_keys=True))
        elif args.command=="self-test": print(json.dumps(self_test(contract),sort_keys=True))
        elif args.command=="handshake":
            if args.output is None or Path(args.output).resolve()!=OUTPUT.resolve(): fail("frozen output path required")
            before=verify_remote(); base=load_base(); username,secret=base.read_windows_credential()
            try: meta=base.token_request(username,secret)
            finally: username=""; secret=""
            captured=datetime.now(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ"); after=verify_remote()
            if before!=after: fail("remote drift during handshake")
            report=build_report(contract,after,meta,captured); validate_report(report,contract); raw=canonical(report)+b"\n"; write_new(OUTPUT,raw)
            print(json.dumps({"schema":"finra-q004-accounted-handshake-write-result/v3","status":"PASS","output":OUTPUT.relative_to(ROOT).as_posix(),"rawSha256":sha_bytes(raw),"reportSha256":report["reportSha256"],"predecessorCredit":"ZERO","outcomesAccessed":False,"secretsCaptured":False},sort_keys=True))
        else:
            if args.output is None or Path(args.output).resolve()!=OUTPUT.resolve(): fail("frozen output path required")
            report=load(OUTPUT); validate_report(report,contract); raw=canonical(report)+b"\n"
            if OUTPUT.read_bytes()!=raw: fail("output canonical bytes changed")
            if args.remote:
                current=verify_remote(); rel=OUTPUT.relative_to(ROOT).as_posix(); blob=git("show",f"{current['remoteHead']}:{rel}",binary=True)
                if blob!=raw: fail("output is not byte-bound at remote HEAD")
            print(json.dumps({"schema":"finra-q004-accounted-handshake-output-verification/v3","status":"PASS","rawSha256":sha_bytes(raw),"reportSha256":report["reportSha256"],"remoteVerified":args.remote,"predecessorCredit":"ZERO","outcomesAccessed":False,"secretsCaptured":False},sort_keys=True))
        return 0
    except (StudyError, getattr(load_base() if False else type("X",(),{}),"StudyError",StudyError)) as exc:
        print(f"StudyError: {exc}",file=sys.stderr); return 1

if __name__=="__main__": raise SystemExit(main())
