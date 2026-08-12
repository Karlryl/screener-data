#!/usr/bin/env python3
from __future__ import annotations
import argparse, hashlib, json, re
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
CASES=ROOT/'research'/'early-detection-v4'/'quantconnect-free-cloud-pilot-cases-v1.json'
CONTRACT=ROOT/'research'/'early-detection-v4'/'quantconnect-free-cloud-pilot-contract-v2.json'
SCRIPT=ROOT/'scripts'/'quantconnect-free-cloud-metadata-pilot-v2.py'
TEST=ROOT/'tests'/'quantconnect-free-cloud-pilot-v2.test.js'
SHA=re.compile(r'^[0-9a-f]{64}$')
FORBIDDEN={'open','high','low','close','volume','price','return','pValue','endpointValue','holdings','portfolioValue','originalV4Result'}
ROW_KEYS={'caseId','category','querySymbol','alternateSymbols','referenceStart','referenceEnd','identityAssessment','aliasResults','barCount','firstBarDate','lastBarDate','splitDates','dividendDates','symbolChanges','delistingEvents','errors'}
ALIAS_KEYS={'role','requestedTicker','subscriptionAccepted','securityIdentifier','errors'}

class VerificationError(RuntimeError): pass
def require(ok,msg):
    if not ok: raise VerificationError(msg)
def raw(path):
    data=path.read_bytes(); require(not data.startswith(b'\xef\xbb\xbf') and b'\r' not in data,f'noncanonical bytes: {path}'); return data
def load(path): return json.loads(raw(path))
def sha(path): return hashlib.sha256(raw(path)).hexdigest()
def canonical(value): return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
def no_forbidden(value,path='root'):
    if isinstance(value,dict):
        for key,item in value.items():
            require(key not in FORBIDDEN,f'forbidden field {path}.{key}'); no_forbidden(item,f'{path}.{key}')
    elif isinstance(value,list):
        for i,item in enumerate(value): no_forbidden(item,f'{path}[{i}]')
def validate_static():
    cases,contract=load(CASES),load(CONTRACT)
    require(contract['schema']=='early-detection-quantconnect-free-cloud-pilot-contract/v2','contract schema')
    require(contract['phase']=='DISCOVERY_ONLY_PRE_IDENTITY_VALIDATION','phase')
    require(contract['outcomesAccessed'] is False and contract['humanAttestation'] is False,'locks')
    require(contract['boundFiles']=={
      'casesPath':CASES.relative_to(ROOT).as_posix(),'casesRawSha256':sha(CASES),
      'cloudScriptPath':SCRIPT.relative_to(ROOT).as_posix(),'cloudScriptRawSha256':sha(SCRIPT),
      'verifierPath':Path(__file__).resolve().relative_to(ROOT).as_posix(),'verifierRawSha256':sha(Path(__file__).resolve()),
      'testPath':TEST.relative_to(ROOT).as_posix(),'testRawSha256':sha(TEST)},'bindings')
    require(contract['executionBlockedUntil']==['FREE_ACCOUNT_ATTESTED_NO_PAYMENT_NO_TRIAL','TERMS_AND_EXPORT_BOUND','TWO_DISTINCT_CLOUD_RUNS_CAPTURED'],'execution locks')
    require(set(contract['claimBoundary']['forbidden'])=={'IDENTITY_RESOLVED','TERMINAL_WEALTH_COMPLETE','COVERAGE_RATE','FULL_MARKET','SURVIVORSHIP_SAFE','ORIGINAL_V4_GATE_PASS','H_LATE','H_FEM'},'forbidden claims')
    require(contract['claimBoundary']['allowed']==['METADATA_DISCOVERY_AND_REPRODUCIBILITY_ONLY'],'allowed claims')
    rows=cases['cases']; require(len(rows)==cases['caseCount']==50,'case count')
    require([x['caseId'] for x in rows]==[f'QC-{i:03d}' for i in range(1,51)],'case IDs')
    for row in rows:
        require(row['referenceStart']<=row['referenceEnd']<='2024-12-31','case chronology')
    core=contract['pilotCore']; require(contract['pilotCoreSha256']==hashlib.sha256(canonical(core)).hexdigest(),'core hash')
    require(core['casesRawSha256']==sha(CASES),'core cases hash')
    script=SCRIPT.read_text('utf-8'); require(contract['pilotCoreSha256'] in script and sha(CASES) in script,'script core binding')
    for token in ('alternateSymbols','referenceStart','referenceEnd','DISCOVERY_ONLY_UNRESOLVED','symbolChanges','delistingEvents'):
        require(token in script,f'runner missing {token}')
    return cases,contract
def validate_output(path,cases,contract):
    value=load(path); require(set(value)=={'schema','pilotCoreSha256','casesRawSha256','providerRunId','executedAt','leanVersion','datasetVersion','runMode','caseCount','rows','outcomesAccessed','priceValuesExported','returnsComputed','ordersSubmitted','reportSha256'},'output keys')
    require(value['schema']=='early-detection-quantconnect-free-cloud-metadata-output/v2','output schema')
    require(value['pilotCoreSha256']==contract['pilotCoreSha256'] and value['casesRawSha256']==sha(CASES),'output bindings')
    require(value['runMode']=='DISCOVERY_ONLY' and value['caseCount']==50 and len(value['rows'])==50,'output mode/count')
    require(all(value[k] is False for k in ('outcomesAccessed','priceValuesExported','returnsComputed','ordersSubmitted')),'outcome locks')
    require(value['providerRunId'] not in ('','MISSING') and value['leanVersion']!='UNAVAILABLE' and value['datasetVersion']!='UNAVAILABLE','run metadata')
    datetime.strptime(value['executedAt'],'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
    copy=dict(value); stored=copy.pop('reportSha256'); require(SHA.fullmatch(stored or '') and stored==hashlib.sha256(canonical(copy)).hexdigest(),'report self hash')
    expected={row['caseId']:row for row in cases['cases']}; require([r['caseId'] for r in value['rows']]==sorted(expected),'row order')
    for row in value['rows']:
        require(set(row)==ROW_KEYS,'row keys'); case=expected[row['caseId']]
        for key in ('category','querySymbol','alternateSymbols','referenceStart','referenceEnd'): require(row[key]==case[key],f'row binding {row["caseId"]}.{key}')
        require(row['identityAssessment']=='DISCOVERY_ONLY_UNRESOLVED','identity overclaim')
        require(len(row['aliasResults'])==1+len(case['alternateSymbols']),'aliases missing')
        require([x['requestedTicker'] for x in row['aliasResults']]==[case['querySymbol'],*case['alternateSymbols']],'alias order')
        for alias in row['aliasResults']: require(set(alias)==ALIAS_KEYS and alias['role'] in {'PRIMARY','ALTERNATE'},'alias schema')
        for date_key in ('firstBarDate','lastBarDate'):
            if row[date_key] is not None: require(case['referenceStart']<=row[date_key]<=case['referenceEnd'],'date clipping')
        for dates in (row['splitDates'],row['dividendDates']): require(all(case['referenceStart']<=x<=case['referenceEnd'] for x in dates),'event clipping')
    no_forbidden(value)
    return value
def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--run-a'); parser.add_argument('--run-b'); args=parser.parse_args()
    cases,contract=validate_static(); result={'status':'PASS','staticContractVerified':True,'executionBlocked':args.run_a is None and args.run_b is None,'outcomesAccessed':False}
    require((args.run_a is None)==(args.run_b is None),'both cloud outputs required')
    if args.run_a:
        a,b=validate_output(Path(args.run_a),cases,contract),validate_output(Path(args.run_b),cases,contract)
        require(a['providerRunId']!=b['providerRunId'],'run IDs must differ')
        require(a['leanVersion']==b['leanVersion'] and a['datasetVersion']==b['datasetVersion'],'version mismatch')
        ac,bc=dict(a),dict(b)
        for obj in (ac,bc): obj.pop('providerRunId'); obj.pop('executedAt'); obj.pop('reportSha256')
        require(ac==bc,'cloud runs are not reproducible')
        result.update({'executionBlocked':False,'twoRunParityVerified':True,'runARawSha256':sha(Path(args.run_a)),'runBRawSha256':sha(Path(args.run_b))})
    print(json.dumps(result,sort_keys=True)); return 0
if __name__=='__main__':
    try: raise SystemExit(main())
    except (VerificationError,KeyError,ValueError,json.JSONDecodeError,OSError) as exc:
        print(json.dumps({'status':'FAIL','error':str(exc),'outcomesAccessed':False},sort_keys=True)); raise SystemExit(2)
