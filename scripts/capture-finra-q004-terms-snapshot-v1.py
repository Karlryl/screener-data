#!/usr/bin/env python3
"""Capture exact official FINRA terms bytes privately; publish only hashes."""
from __future__ import annotations
import argparse,hashlib,json,os,re,subprocess,sys,tempfile
from datetime import datetime,timezone
from html import unescape
from pathlib import Path
from urllib import error,request
ROOT=Path(__file__).resolve().parents[1]
CONTRACT=ROOT/'research'/'early-detection-v4'/'finra-q004-terms-snapshot-contract-v1.json'
TEST=ROOT/'tests'/'capture-finra-q004-terms-snapshot-v1.test.js'
OUTPUT=ROOT/'reports'/'early-detection'/'finra-q004-api-terms-snapshot-v1.json'
CAS=Path(r'C:\Users\Anwender\Documents\GrowthScreenerResearchData\private-evidence\finra-q004\terms')
PARENT='a9d66d6ec578f9ab9454bb92a6a167b692a7897c';REMOTE='origin';BRANCH='codex/early-detection-v4-gates-20260810';REMOTE_URL='https://github.com/Karlryl/screener-data.git'
DOCS=[('FINRA_API_TERMS','https://developer.finra.org/finra-api-terms-service',['finra api terms of service','access credentials']),('FINRA_EQUITY_SPECIFIC_TERMS','https://developer.finra.org/specific-terms-equity-data',['equity data','otcmarket','public credential'])]
HEX64=re.compile(r'^[0-9a-f]{64}$');HEX40=re.compile(r'^[0-9a-f]{40}$')
class StudyError(RuntimeError):pass
def fail(x):raise StudyError(x)
def canonical(x):return json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
def sha(x):return hashlib.sha256(x).hexdigest()
def sha_file(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for c in iter(lambda:f.read(1048576),b''):h.update(c)
 return h.hexdigest()
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
 if set(x)!={'schema','createdAt','track','taskId','sourceId','purpose','authorization','documents','networkContract','privateCas','outputContract','licenseDisposition','claimLocks','contractSha256'}:fail('contract keys')
 if x['schema']!='finra-q004-terms-snapshot-contract/v1' or x['track']!='SHARED_OUTCOME_BLIND_INFRA' or x['taskId']!='Q004-FINRA-OTC-CATALOG' or x['sourceId']!='FINRA_OTC_PRIMARY':fail('boundary')
 if x['authorization']!={'parentRemoteCommit':PARENT,'credentialType':'PUBLIC','monthlyFeeUsd':0,'productionDataRequests':0}:fail('authorization')
 expected=[{'documentId':i,'url':u,'requiredCasefoldPhrases':p} for i,u,p in DOCS]
 if x['documents']!=expected:fail('documents')
 if x['networkContract']!={'requests':2,'methods':['GET'],'redirectsAllowed':False,'environmentProxyUseAllowed':False,'retryAllowed':False,'maximumBytesPerDocument':2097152,'credentialsSent':False}:fail('network')
 if x['privateCas']!={'root':CAS.as_posix(),'pathTemplate':'sha256/{sha256[0:2]}/{sha256}','outsideGitRequired':True,'writeNewOnly':True}:fail('CAS')
 if x['outputContract']!={'path':'reports/early-detection/finra-q004-api-terms-snapshot-v1.json','rawBodiesIncluded':False,'secretsCaptured':False,'outcomesAccessed':False,'productionRowsCaptured':0}:fail('output')
 if x['licenseDisposition']!='FREE_INTERNAL_NONCOMMERCIAL_API_USE_ALLOWED_SUBJECT_TO_CAPTURED_TERMS_NO_RAW_REDISTRIBUTION' or any(x['claimLocks'].values()):fail('license or locks')
 if utc(x['createdAt'])>datetime.now(timezone.utc):fail('future contract')
 return x
class NoRedirect(request.HTTPRedirectHandler):
 def redirect_request(self,*a,**k):fail('redirect')
def remote_snapshot():
 head=git('rev-parse','HEAD');up=git('rev-parse','@{upstream}');line=git('ls-remote',REMOTE,f'refs/heads/{BRANCH}').split();remote=line[0] if line else ''
 if head!=up or head!=remote or git('remote','get-url',REMOTE)!=REMOTE_URL or git('rev-list','--parents','-n','1',head).split()[1:]!=[PARENT]:fail('remote lineage')
 ct=datetime.fromtimestamp(int(git('show','-s','--format=%ct',head)),timezone.utc)
 if utc(load(CONTRACT)['createdAt'])>ct:fail('contract after commit')
 files=[]
 for p in (CONTRACT,Path(__file__).resolve(),TEST):
  rel=p.relative_to(ROOT).as_posix();raw=p.read_bytes()
  if git('show',f'{head}:{rel}',binary=True)!=raw:fail('blob mismatch')
  files.append({'path':rel,'rawSha256':sha(raw),'gitCommit':head})
 return {'remoteName':REMOTE,'remoteBranch':BRANCH,'remoteHead':head,'files':files}
def text_for_checks(raw):
 value=unescape(re.sub(r'<[^>]+>',' ',raw.decode('utf-8','strict')))
 return re.sub(r'\s+',' ',value).casefold()
def fetch(doc):
 ident,url,phrases=doc;req=request.Request(url,method='GET',headers={'Accept':'text/html,application/xhtml+xml','User-Agent':'GrowthScreener-Research/1.0 FINRA-Q004-terms'})
 opener=request.build_opener(request.ProxyHandler({}),NoRedirect())
 try:
  with opener.open(req,timeout=30) as response:raw=response.read(2097153);status=response.status;ctype=response.headers.get('Content-Type','').split(';',1)[0].strip().lower()
 except error.HTTPError as e:fail(f'HTTP {e.code}')
 except error.URLError as e:fail(f'transport {type(e.reason).__name__}')
 if status!=200 or len(raw)>2097152 or ctype not in ('text/html','application/xhtml+xml'):fail('response boundary')
 text=text_for_checks(raw)
 if any(p not in text for p in phrases):fail('required terms phrase missing')
 return raw,ctype
def cas_write(raw):
 digest=sha(raw);p=CAS/'sha256'/digest[:2]/digest;p.parent.mkdir(parents=True,exist_ok=True)
 if p.exists():
  if p.read_bytes()!=raw:fail('CAS collision')
 else:
  fd,n=tempfile.mkstemp(prefix='.'+digest+'.',suffix='.tmp',dir=p.parent);tmp=Path(n)
  try:
   with os.fdopen(fd,'wb') as h:h.write(raw);h.flush();os.fsync(h.fileno())
   os.link(tmp,p)
  finally:tmp.unlink(missing_ok=True)
 if p.read_bytes()!=raw:fail('CAS readback')
 return digest
def validate_binding(x):
 if not isinstance(x,dict) or set(x)!={'remoteName','remoteBranch','remoteHead','files'} or x['remoteName']!=REMOTE or x['remoteBranch']!=BRANCH or not HEX40.fullmatch(x['remoteHead']):fail('binding')
 expected={p.relative_to(ROOT).as_posix() for p in (CONTRACT,Path(__file__).resolve(),TEST)};seen=set()
 for item in x['files']:
  if not isinstance(item,dict) or set(item)!={'path','rawSha256','gitCommit'} or item['path'] in seen or item['path'] not in expected or not HEX64.fullmatch(item['rawSha256']) or item['gitCommit']!=x['remoteHead'] or sha_file(ROOT/item['path'])!=item['rawSha256']:fail('file binding')
  seen.add(item['path'])
 if seen!=expected:fail('binding coverage')
def build(c,binding,docs,at):
 r={'schema':'finra-q004-api-terms-snapshot/v1','capturedAt':at,'track':c['track'],'taskId':c['taskId'],'sourceId':c['sourceId'],'contractRawSha256':sha_file(CONTRACT),'contractSha256':c['contractSha256'],'implementationBindings':binding,'documents':docs,'requestCounts':{'publicTermsRequests':2,'credentialedRequests':0,'productionDataRequests':0},'licenseDisposition':c['licenseDisposition'],'rawBodiesIncluded':False,'secretsCaptured':False,'outcomesAccessed':False,'productionRowsCaptured':0,'claimLocks':c['claimLocks']};r['reportSha256']=sha(canonical(r));return r
def validate_report(r,c):
 if set(r)!={'schema','capturedAt','track','taskId','sourceId','contractRawSha256','contractSha256','implementationBindings','documents','requestCounts','licenseDisposition','rawBodiesIncluded','secretsCaptured','outcomesAccessed','productionRowsCaptured','claimLocks','reportSha256'}:fail('report keys')
 b=dict(r);claim=b.pop('reportSha256',None)
 if claim!=sha(canonical(b)):fail('report hash')
 if r['schema']!='finra-q004-api-terms-snapshot/v1' or r['contractRawSha256']!=sha_file(CONTRACT) or r['contractSha256']!=c['contractSha256'] or utc(c['createdAt'])>utc(r['capturedAt']):fail('report binding')
 validate_binding(r['implementationBindings'])
 if r['requestCounts']!={'publicTermsRequests':2,'credentialedRequests':0,'productionDataRequests':0} or r['licenseDisposition']!=c['licenseDisposition'] or r['rawBodiesIncluded'] is not False or r['secretsCaptured'] is not False or r['outcomesAccessed'] is not False or r['productionRowsCaptured']!=0 or r['claimLocks']!=c['claimLocks'] or any(r['claimLocks'].values()):fail('report boundary')
 if not isinstance(r['documents'],list) or len(r['documents'])!=2:fail('document count')
 for row,expected in zip(r['documents'],DOCS):
  if not isinstance(row,dict) or set(row)!={'documentId','url','httpStatus','contentType','rawSha256','bytes','privateCasRelativePath','requiredPhrasesVerified'} or row['documentId']!=expected[0] or row['url']!=expected[1] or row['httpStatus']!=200 or row['contentType'] not in ('text/html','application/xhtml+xml') or not HEX64.fullmatch(row['rawSha256']) or not isinstance(row['bytes'],int) or not 0<row['bytes']<=2097152 or row['privateCasRelativePath']!=f"sha256/{row['rawSha256'][:2]}/{row['rawSha256']}" or row['requiredPhrasesVerified'] is not True:fail('document row')
def write_new(p,raw):
 if p.exists():fail('output exists')
 p.parent.mkdir(parents=True,exist_ok=True);fd,n=tempfile.mkstemp(prefix='.'+p.name+'.',suffix='.tmp',dir=p.parent);tmp=Path(n)
 try:
  with os.fdopen(fd,'wb') as h:h.write(raw);h.flush();os.fsync(h.fileno())
  os.link(tmp,p)
 finally:tmp.unlink(missing_ok=True)
 if p.read_bytes()!=raw:fail('write readback')
def verify_remote_output(r):
 b=r['implementationBindings'];head=git('rev-parse','HEAD');line=git('ls-remote',REMOTE,f'refs/heads/{BRANCH}').split();remote=line[0] if line else ''
 if head!=git('rev-parse','@{upstream}') or head!=remote or git('remote','get-url',REMOTE)!=REMOTE_URL or git('rev-list','--parents','-n','1',head).split()[1:]!=[b['remoteHead']]:fail('output lineage')
 if git('diff-tree','--no-commit-id','--name-only','-r',head).splitlines()!=[OUTPUT.relative_to(ROOT).as_posix()] or git('show',f"{head}:{OUTPUT.relative_to(ROOT).as_posix()}",binary=True)!=OUTPUT.read_bytes():fail('output commit')
 for item in b['files']:
  if git('show',f"{b['remoteHead']}:{item['path']}",binary=True)!=(ROOT/item['path']).read_bytes():fail('implementation blob')
def self_test(c):
 binding={'remoteName':REMOTE,'remoteBranch':BRANCH,'remoteHead':'a'*40,'files':[{'path':p.relative_to(ROOT).as_posix(),'rawSha256':sha_file(p),'gitCommit':'a'*40} for p in (CONTRACT,Path(__file__).resolve(),TEST)]}
 docs=[{'documentId':i,'url':u,'httpStatus':200,'contentType':'text/html','rawSha256':sha(i.encode()),'bytes':123,'privateCasRelativePath':f"sha256/{sha(i.encode())[:2]}/{sha(i.encode())}",'requiredPhrasesVerified':True} for i,u,_ in DOCS]
 r=build(c,binding,docs,'2026-08-12T19:20:00Z');validate_report(r,c);kills={}
 for name,mut in [('bodyLeak',lambda x:x.__setitem__('rawBody','x')),('licensePromotion',lambda x:x['claimLocks'].__setitem__('redistributionAllowed',True)),('wrongHash',lambda x:x['documents'][0].__setitem__('rawSha256','0'*64))]:
  x=json.loads(json.dumps(r));mut(x);b=dict(x);b.pop('reportSha256',None);x['reportSha256']=sha(canonical(b))
  try:validate_report(x,c);kills[name]=False
  except StudyError:kills[name]=True
 if not all(kills.values()):fail('kill failed')
 return {'schema':'finra-q004-terms-snapshot-self-test/v1','status':'PASS','kills':kills,'outcomesAccessed':False}
def main():
 p=argparse.ArgumentParser();p.add_argument('command',choices=('verify-contract','self-test','capture','verify-output'));p.add_argument('--output');p.add_argument('--remote',action='store_true');a=p.parse_args()
 try:
  c=validate_contract()
  if a.command=='verify-contract':print(json.dumps({'schema':'finra-q004-terms-snapshot-contract-verification/v1','status':'PASS','contractSha256':c['contractSha256'],'outcomesAccessed':False},sort_keys=True))
  elif a.command=='self-test':print(json.dumps(self_test(c),sort_keys=True))
  elif a.command=='capture':
   if a.output is None or Path(a.output).resolve()!=OUTPUT.resolve():fail('frozen output')
   before=remote_snapshot();captured=[]
   for doc in DOCS:
    raw,ctype=fetch(doc);digest=cas_write(raw);captured.append({'documentId':doc[0],'url':doc[1],'httpStatus':200,'contentType':ctype,'rawSha256':digest,'bytes':len(raw),'privateCasRelativePath':f'sha256/{digest[:2]}/{digest}','requiredPhrasesVerified':True})
   after=remote_snapshot()
   if before!=after:fail('remote drift')
   at=datetime.now(timezone.utc).replace(microsecond=0).strftime('%Y-%m-%dT%H:%M:%SZ');r=build(c,after,captured,at);validate_report(r,c);raw=canonical(r)+b'\n';write_new(OUTPUT,raw);print(json.dumps({'schema':'finra-q004-terms-snapshot-write-result/v1','status':'PASS','output':OUTPUT.relative_to(ROOT).as_posix(),'rawSha256':sha(raw),'reportSha256':r['reportSha256'],'outcomesAccessed':False},sort_keys=True))
  else:
   if a.output is None or Path(a.output).resolve()!=OUTPUT.resolve():fail('frozen output')
   r=load(OUTPUT);validate_report(r,c);out=canonical(r)+b'\n'
   if OUTPUT.read_bytes()!=out:fail('canonical output')
   for row,doc in zip(r['documents'],DOCS):
    raw=(CAS/row['privateCasRelativePath']).read_bytes()
    if sha(raw)!=row['rawSha256'] or len(raw)!=row['bytes'] or any(p not in text_for_checks(raw) for p in doc[2]):fail('private reparse')
   if a.remote:verify_remote_output(r)
   print(json.dumps({'schema':'finra-q004-terms-snapshot-output-verification/v1','status':'PASS','rawSha256':sha(out),'reportSha256':r['reportSha256'],'privateCasVerified':True,'remoteVerified':a.remote,'outcomesAccessed':False},sort_keys=True))
  return 0
 except Exception as e:
  print(f'StudyError: {type(e).__name__}',file=sys.stderr);return 1
if __name__=='__main__':raise SystemExit(main())
