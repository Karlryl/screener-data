#!/usr/bin/env python3
"""Corrected, append-only FINRA terms capture; V1 remains zero-credit."""
from __future__ import annotations
import argparse,hashlib,importlib.util,json,subprocess,sys
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
CONTRACT=ROOT/'research'/'early-detection-v4'/'finra-q004-terms-snapshot-contract-v2.json';TEST=ROOT/'tests'/'capture-finra-q004-terms-snapshot-v2.test.js';OUTPUT=ROOT/'reports'/'early-detection'/'finra-q004-api-terms-snapshot-v2.json';V1=ROOT/'scripts'/'capture-finra-q004-terms-snapshot-v1.py'
V1_SHA='d269e3cea0a216b5d26218a35afe5163fd9ad056439335fbf7bfb48481e7e5bf';PARENT='5bf663b271ca63d1447aa237ab1d2f04b6473262';REMOTE='origin';BRANCH='codex/early-detection-v4-gates-20260810';REMOTE_URL='https://github.com/Karlryl/screener-data.git'
DOCS=[('FINRA_API_TERMS','https://developer.finra.org/finra-api-terms-service',['finra api terms of service','access credentials']),('FINRA_EQUITY_SPECIFIC_TERMS','https://developer.finra.org/specific-terms-equity-data',['equity data','otcmarket','public','credential'])]
HEX64=__import__('re').compile(r'^[0-9a-f]{64}$');HEX40=__import__('re').compile(r'^[0-9a-f]{40}$')
class StudyError(RuntimeError):pass
def fail(x):raise StudyError(x)
def canonical(x):return json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
def sha(x):return hashlib.sha256(x).hexdigest()
def sha_file(p):return sha(p.read_bytes())
if sha_file(V1)!=V1_SHA:fail('pinned V1 helper changed')
spec=importlib.util.spec_from_file_location('finra_terms_v1_pinned',V1);base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
def load(p):
 try:x=json.loads(p.read_text('utf-8'))
 except Exception:fail('invalid JSON')
 if not isinstance(x,dict):fail('object required')
 return x
def git(*a,binary=False):
 p=subprocess.run(['git',*a],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=False)
 if p.returncode:fail('git command failed')
 return p.stdout if binary else p.stdout.decode().strip()
def utc(x):
 try:return datetime.strptime(x,'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
 except Exception:fail('invalid time')
def validate_contract():
 x=load(CONTRACT);b=dict(x);claim=b.pop('contractSha256',None)
 if claim!=sha(canonical(b)) or not isinstance(claim,str) or not HEX64.fullmatch(claim):fail('contract hash')
 if set(x)!={'schema','createdAt','track','taskId','sourceId','purpose','authorization','supersededAttempt','documents','networkContract','privateCas','outputContract','licenseDisposition','claimLocks','contractSha256'}:fail('contract keys')
 if x['schema']!='finra-q004-terms-snapshot-contract/v2' or x['track']!='SHARED_OUTCOME_BLIND_INFRA' or x['taskId']!='Q004-FINRA-OTC-CATALOG' or x['sourceId']!='FINRA_OTC_PRIMARY':fail('boundary')
 if x['authorization']!={'parentRemoteCommit':PARENT,'credentialType':'PUBLIC','monthlyFeeUsd':0,'productionDataRequests':0}:fail('authorization')
 if x['supersededAttempt']!={'schema':'finra-q004-terms-snapshot-contract/v1','contractRawSha256':'23772edb3e23049252f72753f65638778dbc1bfc1c0a76a4bfbe7294eef70442','disposition':'FAILED_REQUIRED_PHRASE_EXACTNESS_ZERO_CREDIT_NO_PUBLIC_OUTPUT'}:fail('predecessor')
 if x['documents']!=[{'documentId':i,'url':u,'requiredCasefoldPhrases':p} for i,u,p in DOCS]:fail('documents')
 if x['networkContract']!={'requests':2,'methods':['GET'],'redirectsAllowed':False,'environmentProxyUseAllowed':False,'retryAllowed':False,'maximumBytesPerDocument':2097152,'credentialsSent':False}:fail('network')
 if x['privateCas']!={'root':base.CAS.as_posix(),'pathTemplate':'sha256/{sha256[0:2]}/{sha256}','outsideGitRequired':True,'writeNewOnly':True}:fail('CAS')
 if x['outputContract']!={'path':'reports/early-detection/finra-q004-api-terms-snapshot-v2.json','rawBodiesIncluded':False,'secretsCaptured':False,'outcomesAccessed':False,'productionRowsCaptured':0}:fail('output')
 if x['licenseDisposition']!='FREE_INTERNAL_NONCOMMERCIAL_API_USE_ALLOWED_SUBJECT_TO_CAPTURED_TERMS_NO_RAW_REDISTRIBUTION' or any(x['claimLocks'].values()) or utc(x['createdAt'])>datetime.now(timezone.utc):fail('license, locks, or time')
 return x
def snapshot():
 head=git('rev-parse','HEAD');parts=git('ls-remote',REMOTE,f'refs/heads/{BRANCH}').split();remote=parts[0] if parts else ''
 if head!=git('rev-parse','@{upstream}') or head!=remote or git('remote','get-url',REMOTE)!=REMOTE_URL or git('rev-list','--parents','-n','1',head).split()[1:]!=[PARENT]:fail('remote lineage')
 if utc(load(CONTRACT)['createdAt'])>datetime.fromtimestamp(int(git('show','-s','--format=%ct',head)),timezone.utc):fail('contract after commit')
 files=[]
 for p in (CONTRACT,Path(__file__).resolve(),TEST,V1):
  rel=p.relative_to(ROOT).as_posix();raw=p.read_bytes()
  if git('show',f'{head}:{rel}',binary=True)!=raw:fail('blob mismatch')
  files.append({'path':rel,'rawSha256':sha(raw),'gitCommit':head})
 return {'remoteName':REMOTE,'remoteBranch':BRANCH,'remoteHead':head,'files':files}
def binding_ok(x):
 if not isinstance(x,dict) or set(x)!={'remoteName','remoteBranch','remoteHead','files'} or x['remoteName']!=REMOTE or x['remoteBranch']!=BRANCH or not HEX40.fullmatch(x['remoteHead']):fail('binding')
 expected={p.relative_to(ROOT).as_posix() for p in (CONTRACT,Path(__file__).resolve(),TEST,V1)};seen=set()
 for i in x['files']:
  if not isinstance(i,dict) or set(i)!={'path','rawSha256','gitCommit'} or i['path'] in seen or i['path'] not in expected or not HEX64.fullmatch(i['rawSha256']) or i['gitCommit']!=x['remoteHead'] or sha_file(ROOT/i['path'])!=i['rawSha256']:fail('file binding')
  seen.add(i['path'])
 if seen!=expected:fail('binding coverage')
def build(c,binding,docs,at):
 r={'schema':'finra-q004-api-terms-snapshot/v2','capturedAt':at,'track':c['track'],'taskId':c['taskId'],'sourceId':c['sourceId'],'contractRawSha256':sha_file(CONTRACT),'contractSha256':c['contractSha256'],'implementationBindings':binding,'supersededAttempt':c['supersededAttempt'],'documents':docs,'requestCounts':{'publicTermsRequests':2,'credentialedRequests':0,'productionDataRequests':0},'licenseDisposition':c['licenseDisposition'],'rawBodiesIncluded':False,'secretsCaptured':False,'outcomesAccessed':False,'productionRowsCaptured':0,'claimLocks':c['claimLocks']};r['reportSha256']=sha(canonical(r));return r
def validate_report(r,c):
 if set(r)!={'schema','capturedAt','track','taskId','sourceId','contractRawSha256','contractSha256','implementationBindings','supersededAttempt','documents','requestCounts','licenseDisposition','rawBodiesIncluded','secretsCaptured','outcomesAccessed','productionRowsCaptured','claimLocks','reportSha256'}:fail('report keys')
 b=dict(r);claim=b.pop('reportSha256',None)
 if claim!=sha(canonical(b)) or r['schema']!='finra-q004-api-terms-snapshot/v2' or r['contractRawSha256']!=sha_file(CONTRACT) or r['contractSha256']!=c['contractSha256'] or utc(c['createdAt'])>utc(r['capturedAt']):fail('report binding')
 binding_ok(r['implementationBindings'])
 if r['supersededAttempt']!=c['supersededAttempt'] or r['requestCounts']!={'publicTermsRequests':2,'credentialedRequests':0,'productionDataRequests':0} or r['licenseDisposition']!=c['licenseDisposition'] or r['rawBodiesIncluded'] is not False or r['secretsCaptured'] is not False or r['outcomesAccessed'] is not False or r['productionRowsCaptured']!=0 or r['claimLocks']!=c['claimLocks'] or any(r['claimLocks'].values()):fail('boundary')
 if not isinstance(r['documents'],list) or len(r['documents'])!=2:fail('documents')
 for row,expected in zip(r['documents'],DOCS):
  if not isinstance(row,dict) or set(row)!={'documentId','url','httpStatus','contentType','rawSha256','bytes','privateCasRelativePath','requiredPhrasesVerified'} or row['documentId']!=expected[0] or row['url']!=expected[1] or row['httpStatus']!=200 or row['contentType'] not in ('text/html','application/xhtml+xml') or not HEX64.fullmatch(row['rawSha256']) or not isinstance(row['bytes'],int) or not 0<row['bytes']<=2097152 or row['privateCasRelativePath']!=f"sha256/{row['rawSha256'][:2]}/{row['rawSha256']}" or row['requiredPhrasesVerified'] is not True:fail('document row')
def verify_remote_output(r):
 b=r['implementationBindings'];head=git('rev-parse','HEAD');parts=git('ls-remote',REMOTE,f'refs/heads/{BRANCH}').split();remote=parts[0] if parts else ''
 if head!=git('rev-parse','@{upstream}') or head!=remote or git('remote','get-url',REMOTE)!=REMOTE_URL or git('rev-list','--parents','-n','1',head).split()[1:]!=[b['remoteHead']] or git('diff-tree','--no-commit-id','--name-only','-r',head).splitlines()!=[OUTPUT.relative_to(ROOT).as_posix()] or git('show',f"{head}:{OUTPUT.relative_to(ROOT).as_posix()}",binary=True)!=OUTPUT.read_bytes():fail('output remote')
 for i in b['files']:
  if git('show',f"{b['remoteHead']}:{i['path']}",binary=True)!=(ROOT/i['path']).read_bytes():fail('implementation blob')
def self_test(c):
 head='a'*40;binding={'remoteName':REMOTE,'remoteBranch':BRANCH,'remoteHead':head,'files':[{'path':p.relative_to(ROOT).as_posix(),'rawSha256':sha_file(p),'gitCommit':head} for p in (CONTRACT,Path(__file__).resolve(),TEST,V1)]};docs=[{'documentId':i,'url':u,'httpStatus':200,'contentType':'text/html','rawSha256':sha(i.encode()),'bytes':123,'privateCasRelativePath':f"sha256/{sha(i.encode())[:2]}/{sha(i.encode())}",'requiredPhrasesVerified':True} for i,u,_ in DOCS];r=build(c,binding,docs,'2026-08-12T19:21:00Z');validate_report(r,c);kills={}
 for n,mut in [('rawLeak',lambda x:x.__setitem__('rawBody','x')),('creditOld',lambda x:x['supersededAttempt'].__setitem__('disposition','PASS')),('licensePromotion',lambda x:x['claimLocks'].__setitem__('commercialUseAllowed',True))]:
  x=json.loads(json.dumps(r));mut(x);body=dict(x);body.pop('reportSha256',None);x['reportSha256']=sha(canonical(body))
  try:validate_report(x,c);kills[n]=False
  except StudyError:kills[n]=True
 if not all(kills.values()):fail('kill')
 return {'schema':'finra-q004-terms-snapshot-self-test/v2','status':'PASS','kills':kills,'outcomesAccessed':False}
def main():
 p=argparse.ArgumentParser();p.add_argument('command',choices=('verify-contract','self-test','capture','verify-output'));p.add_argument('--output');p.add_argument('--remote',action='store_true');a=p.parse_args()
 try:
  c=validate_contract()
  if a.command=='verify-contract':print(json.dumps({'schema':'finra-q004-terms-snapshot-contract-verification/v2','status':'PASS','contractSha256':c['contractSha256'],'outcomesAccessed':False},sort_keys=True))
  elif a.command=='self-test':print(json.dumps(self_test(c),sort_keys=True))
  elif a.command=='capture':
   if a.output is None or Path(a.output).resolve()!=OUTPUT.resolve():fail('frozen output')
   before=snapshot();docs=[]
   for doc in DOCS:
    raw,ctype=base.fetch(doc);digest=base.cas_write(raw);docs.append({'documentId':doc[0],'url':doc[1],'httpStatus':200,'contentType':ctype,'rawSha256':digest,'bytes':len(raw),'privateCasRelativePath':f'sha256/{digest[:2]}/{digest}','requiredPhrasesVerified':True})
   after=snapshot()
   if before!=after:fail('remote drift')
   at=datetime.now(timezone.utc).replace(microsecond=0).strftime('%Y-%m-%dT%H:%M:%SZ');r=build(c,after,docs,at);validate_report(r,c);out=canonical(r)+b'\n';base.write_new(OUTPUT,out);print(json.dumps({'schema':'finra-q004-terms-snapshot-write-result/v2','status':'PASS','output':OUTPUT.relative_to(ROOT).as_posix(),'rawSha256':sha(out),'reportSha256':r['reportSha256'],'outcomesAccessed':False},sort_keys=True))
  else:
   if a.output is None or Path(a.output).resolve()!=OUTPUT.resolve():fail('frozen output')
   r=load(OUTPUT);validate_report(r,c);out=canonical(r)+b'\n'
   if OUTPUT.read_bytes()!=out:fail('canonical output')
   for row,doc in zip(r['documents'],DOCS):
    raw=(base.CAS/row['privateCasRelativePath']).read_bytes()
    if sha(raw)!=row['rawSha256'] or len(raw)!=row['bytes'] or any(p not in base.text_for_checks(raw) for p in doc[2]):fail('private reparse')
   if a.remote:verify_remote_output(r)
   print(json.dumps({'schema':'finra-q004-terms-snapshot-output-verification/v2','status':'PASS','rawSha256':sha(out),'reportSha256':r['reportSha256'],'privateCasVerified':True,'remoteVerified':a.remote,'outcomesAccessed':False},sort_keys=True))
  return 0
 except Exception as e:
  print(f'StudyError: {type(e).__name__}',file=sys.stderr);return 1
if __name__=='__main__':raise SystemExit(main())
