#!/usr/bin/env python3
import argparse
import copy
import hashlib
import importlib.util
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "research/early-detection-v4/sec-frozen-noncash-share-receipt-evidence-output-seal-contract-v2.json"
REMOTE = "https://github.com/Karlryl/screener-data.git"
REF = "refs/heads/codex/early-detection-v4-gates-20260810"


class EvidenceError(RuntimeError): pass
def fail(message): raise EvidenceError(message)
def sha(raw): return hashlib.sha256(raw).hexdigest()
def canonical(value): return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
def run(*args):
    result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    if result.returncode: fail(f"command failed: {' '.join(args)}: {result.stderr.strip()}")
    return result.stdout.strip()


def validate_contract(value):
    expected = {"schema","createdAt","taskId","track","purpose","sourceBase","implementation","expectedPopulation","expectedDeduplication","requiredClaims","claimLocks","contractSha256"}
    if set(value) != expected or value["schema"] != "early-detection-sec-frozen-noncash-share-receipt-evidence-output-seal-contract/v2" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA": fail("contract identity changed")
    body = copy.deepcopy(value); claim = body.pop("contractSha256")
    if claim != sha(canonical(body)): fail("contract self hash changed")
    if value["sourceBase"]["remote"] != REMOTE or value["sourceBase"]["ref"] != REF or value["sourceBase"]["minimumAncestor"] != "cc20000a578ea99699fbb18a845b4cecfcc4d57d": fail("source base changed")
    if value["requiredClaims"] != {"sourceRebuildNormal": True,"sourceRebuildOptimized": True,"sourceRebuildByteExact": True,"remoteBytesVerified": True,"semanticCeiling":"EXACT_SIX_COMPLETED_NONCASH_SHARE_RECEIPTS_WITH_EXPLICIT_RATIOS","scopeLimit":"EXACT_SIX_FROZEN_PRIMARY_SEC_SENTENCES_ONLY_NO_GENERAL_SELECTOR"}: fail("required claims changed")
    if any(value["claimLocks"].values()) or len(value["claimLocks"]) != 17: fail("claim locks changed")
    return value


def load_contract(): return validate_contract(json.loads(CONTRACT_PATH.read_bytes()))


def validate_output(contract):
    output_binding = contract["implementation"]["output"]
    raw = (ROOT / output_binding["path"]).read_bytes()
    if len(raw) != output_binding["bytes"] or sha(raw) != output_binding["rawSha256"]: fail("output raw bytes changed")
    value = json.loads(raw); body = copy.deepcopy(value); claim = body.pop("reportSha256")
    if claim != output_binding["selfSha256"] or sha(canonical(body)) != claim: fail("output self hash changed")
    if value["population"] != contract["expectedPopulation"]: fail("output population changed")
    if value["deduplication"]["intersectionCountByDimension"] != contract["expectedDeduplication"]: fail("deduplication changed")
    if value["claimLocks"] != contract["claimLocks"] or value["outcomesAccessed"] is not False: fail("output locks changed")
    if value["semanticCeiling"] != contract["requiredClaims"]["semanticCeiling"] or value["scopeLimit"] != contract["requiredClaims"]["scopeLimit"]: fail("output scope changed")
    return raw, value


def load_builder(contract):
    binding = contract["implementation"]["builder"]
    raw = (ROOT / binding["path"]).read_bytes()
    if len(raw) != binding["bytes"] or sha(raw) != binding["rawSha256"]: fail("builder bytes changed before exec")
    module = type(sys)("noncash_source_builder")
    module.__file__ = str(ROOT / binding["path"])
    exec(compile(raw, str(ROOT / binding["path"]), "exec"), module.__dict__)
    return module


def source_rebuild(contract, expected_raw):
    builder = load_builder(contract)
    source_contract = builder.load_contract()
    head = builder.git("rev-parse", "HEAD")
    introduction = contract["implementation"]["builder"]["introductionCommit"]
    parent = builder.git("rev-list", "--parents", "-n", "1", introduction).split()[1]
    state = {
        "baseSealCommit": "996fd2eeb7f2193cfc6352ca15ab544d3f09ae4c",
        "currentCommit": introduction,
        "implementationIntroductionCommit": introduction,
        "implementationIntroductionParent": parent,
        "linearIntermediateCommitsAllowed": True,
        "phase": "IMPLEMENTED_NO_OUTPUT",
    }
    reconciliation, frozen = builder.load_inputs(source_contract, head)
    report = builder.build_report(source_contract, reconciliation, frozen, state)
    rebuilt = builder.pretty_bytes(report)
    if rebuilt != expected_raw: fail("source rebuild bytes differ")
    return True


def verify_git(contract, remote_required):
    head = run("git","rev-parse","HEAD"); upstream = run("git","rev-parse","@{u}")
    if head != upstream or run("git","remote","get-url","origin") != REMOTE: fail("local/upstream/origin changed")
    if remote_required:
        listing = run("git","ls-remote","origin",REF).split()
        if not listing or listing[0] != head: fail("live remote differs")
    minimum = contract["sourceBase"]["minimumAncestor"]
    if subprocess.run(["git","merge-base","--is-ancestor",minimum,head],cwd=ROOT).returncode: fail("minimum ancestor missing")
    for commit in run("git","rev-list","--first-parent",f"{minimum}..{head}").splitlines():
        if len(run("git","show","-s","--format=%P",commit).split()) != 1: fail("nonlinear history")
    for binding in contract["implementation"].values():
        local = (ROOT / binding["path"]).read_bytes()
        if sha(local) != binding["rawSha256"]: fail("implementation bytes changed")
        current = subprocess.run(["git","show",f"{head}:{binding['path']}"],cwd=ROOT,capture_output=True).stdout
        intro = subprocess.run(["git","show",f"{binding['introductionCommit']}:{binding['path']}"],cwd=ROOT,capture_output=True).stdout
        if current != local or intro != local: fail("git binding changed")
    own = contract["sourceBase"]["authorizedPaths"]
    introductions = run("git","log","--diff-filter=A","--format=%H","--",own[0]).splitlines()
    if not introductions: return head,"PRE_INTRODUCTION"
    if len(introductions) != 1: fail("multiple seal introductions")
    introduction=introductions[0]
    if subprocess.run(["git","merge-base","--is-ancestor",minimum,introduction],cwd=ROOT).returncode or subprocess.run(["git","merge-base","--is-ancestor",introduction,head],cwd=ROOT).returncode: fail("seal lineage changed")
    if len(run("git","show","-s","--format=%P",introduction).split()) != 1: fail("seal introduction not single parent")
    added=run("git","diff-tree","--root","--no-commit-id","--name-only","--diff-filter=A","-r",introduction).splitlines()
    if sorted(added)!=sorted(own): fail("seal introduction additions changed")
    for path in own:
        local=(ROOT/path).read_bytes(); intro=subprocess.run(["git","show",f"{introduction}:{path}"],cwd=ROOT,capture_output=True).stdout; current=subprocess.run(["git","show",f"{head}:{path}"],cwd=ROOT,capture_output=True).stdout
        if local!=intro or current!=intro: fail("seal bytes changed")
    return head,"POST_INTRODUCTION"


def self_test(contract):
    kills={}
    for name,group,key,value in [("terminal","claimLocks","terminalWealthComplete",True),("identity","claimLocks","historicalIdentityResolved",True),("outcomes","claimLocks","outcomesAccessed",True),("broadScope","requiredClaims","scopeLimit","GENERAL_SELECTOR")]:
        candidate=copy.deepcopy(contract); candidate[group][key]=value; body=copy.deepcopy(candidate); body.pop("contractSha256"); candidate["contractSha256"]=sha(canonical(body))
        try: validate_contract(candidate); kills[name]=False
        except EvidenceError: kills[name]=True
    candidate=copy.deepcopy(contract["expectedPopulation"]); candidate["frozenEvidenceRows"]=5; kills["rowLoss"]=candidate!=contract["expectedPopulation"]
    candidate=copy.deepcopy(contract["expectedDeduplication"]); candidate["ACCESSION"]=1; kills["dedupOverlap"]=candidate!=contract["expectedDeduplication"]
    if not all(kills.values()): fail("self-test mutation survived")
    return kills


def main():
    parser=argparse.ArgumentParser(); parser.add_argument("command",choices=["verify","self-test"]); parser.add_argument("--remote",action="store_true"); args=parser.parse_args()
    try:
        contract=load_contract()
        if args.command=="self-test": result={"schema":"early-detection-sec-frozen-noncash-share-receipt-evidence-output-seal-self-test/v2","status":"PASS","kills":self_test(contract),"outcomesAccessed":False}
        else:
            raw,_=validate_output(contract); head,phase=verify_git(contract,args.remote); source_rebuild(contract,raw)
            result={"schema":"early-detection-sec-frozen-noncash-share-receipt-evidence-output-seal-verification/v2","status":"PASS","phase":phase,"head":head,"verifiedRows":6,"ratioRows":8,"dualRatioRows":2,"sourceRebuildByteExact":True,"remoteVerified":args.remote,"outcomesAccessed":False}
        print(json.dumps(result,sort_keys=True)); return 0
    except (EvidenceError,OSError,ValueError,KeyError,json.JSONDecodeError) as exc:
        print(json.dumps({"schema":"early-detection-sec-frozen-noncash-share-receipt-evidence-output-seal-error/v2","status":"FAIL","error":str(exc),"outcomesAccessed":False},sort_keys=True),file=sys.stderr); return 1
if __name__=="__main__": raise SystemExit(main())
