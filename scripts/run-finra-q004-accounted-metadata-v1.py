#!/usr/bin/env python3
"""Single-request, secret-safe FINRA OTC Daily List metadata capture."""
from __future__ import annotations
import argparse, ctypes, hashlib, importlib.util, json, os, re, subprocess, sys, tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib import error, request

ROOT=Path(__file__).resolve().parents[1]
CONTRACT=ROOT/'research'/'early-detection-v4'/'finra-q004-accounted-metadata-contract-v1.json'
TEST=ROOT/'tests'/'run-finra-q004-accounted-metadata-v1.test.js'
HANDSHAKE_SCRIPT=ROOT/'scripts'/'run-finra-q004-accounted-handshake-v3.py'
HANDSHAKE_CONTRACT=ROOT/'research'/'early-detection-v4'/'finra-q004-accounted-handshake-contract-v3.json'
HANDSHAKE_OUTPUT=ROOT/'reports'/'early-detection'/'finra-q004-public-credential-handshake-v3.json'
OUTPUT=ROOT/'reports'/'early-detection'/'finra-q004-otc-daily-list-metadata-v1.json'
PRIVATE_CAS=Path(r'C:\Users\Anwender\Documents\GrowthScreenerResearchData\private-evidence\finra-q004')
TOKEN='https://ews.fip.finra.org/fip/rest/ews/oauth2/access_token?grant_type=client_credentials'
METADATA='https://api.finra.org/metadata/group/otcMarket/name/otcdailylist'
PARENT='3e67349ef9243b68e0ee4c75f87d5e3b4e90b564'; REMOTE='origin'; BRANCH='codex/early-detection-v4-gates-20260810'; REMOTE_URL='https://github.com/Karlryl/screener-data.git'
HSC='22ee205d9a9ba30f8de0ad7e3b8f5833a72a778f77b6bea0dae406d24d6b42b5'; HSO='aa1dbac9a9441800c6ef0a1b263e061bcbd205fdd221cbd69706e442da6e3062'; HSS='68a2c79ada20015a477af121b69c37d0499649e725852e07b2a758c4af72d75e'
HEX64=re.compile(r'^[0-9a-f]{64}$'); HEX40=re.compile(r'^[0-9a-f]{40}$')
REQUIRED={'OTCDailyListID','calendarDay','dailyListDatetime','dailyListEventCode','securityAddFlag','securityDeleteFlag','changeSymbolFlag','changeSecurityDescriptionFlag','changeSecurityAttributeFlag','changeFinancialStatusFlag','bankruptcyFlag','dividendNonADRFlag','dividendADRFlag','paymentDate','cashAmountText','stockPercentage','forwardSplitRate','reverseSplitRate'}
class StudyError(RuntimeError): pass
def fail(x): raise StudyError(x)
def canonical(x): return json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
def sha_bytes(x): return hashlib.sha256(x).hexdigest()
def sha_file(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for c in iter(lambda:f.read(1048576),b''): h.update(c)
 return h.hexdigest()
def load(p):
 try:x=json.loads(p.read_text('utf-8'))
 except Exception as e: fail(f'invalid JSON {p}: {e}')
 if not isinstance(x,dict):fail('object required')
 return x
def git(*a,binary=False):
 p=subprocess.run(['git',*a],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=False)
 if p.returncode:fail('git command failed')
 return p.stdout if binary else p.stdout.decode().strip()
def parse_time(x):
 try:return datetime.strptime(x,'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
 except:fail('invalid timestamp')
def validate_contract():
 x=load(CONTRACT); body=dict(x); claimed=body.pop('contractSha256',None)
 if claimed!=sha_bytes(canonical(body)) or not isinstance(claimed,str) or not HEX64.fullmatch(claimed):fail('contract self-hash')
 if set(x)!={'schema','createdAt','track','taskId','sourceId','purpose','authorization','requestContract','metadataContract','privateCas','outputContract','claimLocks','contractSha256'}:fail('contract keys')
 if x['schema']!='finra-q004-accounted-metadata-contract/v1' or x['track']!='SHARED_OUTCOME_BLIND_INFRA' or x['taskId']!='Q004-FINRA-OTC-CATALOG' or x['sourceId']!='FINRA_OTC_PRIMARY':fail('boundary')
 if x['authorization']!={'parentRemoteCommit':PARENT,'handshakeContractPath':'research/early-detection-v4/finra-q004-accounted-handshake-contract-v3.json','handshakeContractRawSha256':HSC,'handshakeOutputPath':'reports/early-detection/finra-q004-public-credential-handshake-v3.json','handshakeOutputRawSha256':HSO,'credentialType':'PUBLIC','monthlyFeeUsd':0,'monthlyUsageCapLabel':'10 GB'}:fail('authorization')
 if sha_file(HANDSHAKE_CONTRACT)!=HSC or sha_file(HANDSHAKE_OUTPUT)!=HSO or sha_file(HANDSHAKE_SCRIPT)!=HSS:fail('handshake bytes')
 if x['requestContract']!={'tokenEndpoint':TOKEN,'metadataEndpoint':METADATA,'tokenRequests':1,'metadataRequests':1,'productionDataRequests':0,'redirectsAllowed':False,'environmentProxyUseAllowed':False,'retryAllowed':False,'maximumMetadataResponseBytes':262144,'rawResponsePublicGitAllowed':False,'rawResponsePrivateCasRequired':True,'accessTokenPersisted':False}:fail('request contract')
 m=x['metadataContract']
 if m!={'datasetGroup':'OTCMARKET','datasetName':'OTCDAILYLIST','partitionFields':['calendarDay'],'requiredFieldNames':sorted(REQUIRED),'publishedValuesAllowed':False,'publishedFieldNamesAndTypesAllowed':True,'schemaPointEvidenceOnly':True}:fail('metadata contract')
 if x['privateCas']!={'root':PRIVATE_CAS.as_posix(),'pathTemplate':'sha256/{sha256[0:2]}/{sha256}','outsideGitRequired':True,'writeNewOnly':True}:fail('private CAS')
 if x['outputContract']!={'path':'reports/early-detection/finra-q004-otc-daily-list-metadata-v1.json','writeNewOnly':True,'rawResponseIncluded':False,'recordValuesIncluded':False,'secretsCaptured':False,'outcomesAccessed':False,'productionRowsCaptured':0}:fail('output')
 if any(v is not False for v in x['claimLocks'].values()):fail('locks')
 if parse_time(x['createdAt'])>datetime.now(timezone.utc):fail('future contract')
 return x
def verify_remote():
 head=git('rev-parse','HEAD'); remote=git('ls-remote',REMOTE,f'refs/heads/{BRANCH}').split()[0]
 if head!=git('rev-parse','@{upstream}') or head!=remote or git('remote','get-url',REMOTE)!=REMOTE_URL or git('rev-parse',f'{head}^')!=PARENT:fail('remote or lineage')
 ct=datetime.fromtimestamp(int(git('show','-s','--format=%ct',head)),timezone.utc)
 if parse_time(load(CONTRACT)['createdAt'])>ct:fail('contract after commit')
 files=[]
 for p in (CONTRACT,Path(__file__).resolve(),TEST,HANDSHAKE_SCRIPT,HANDSHAKE_CONTRACT,HANDSHAKE_OUTPUT):
  rel=p.relative_to(ROOT).as_posix(); raw=p.read_bytes()
  if git('show',f'{head}:{rel}',binary=True)!=raw:fail(f'blob mismatch {rel}')
  files.append({'path':rel,'rawSha256':sha_bytes(raw),'gitCommit':head})
 return {'remoteName':REMOTE,'remoteBranch':BRANCH,'remoteHead':head,'files':files}
def validate_implementation_bindings(value):
 if not isinstance(value,dict) or set(value)!={'remoteName','remoteBranch','remoteHead','files'}:fail('implementation binding schema')
 if value['remoteName']!=REMOTE or value['remoteBranch']!=BRANCH or not HEX40.fullmatch(value['remoteHead']) or not isinstance(value['files'],list):fail('implementation binding identity')
 expected={p.relative_to(ROOT).as_posix() for p in (CONTRACT,Path(__file__).resolve(),TEST,HANDSHAKE_SCRIPT,HANDSHAKE_CONTRACT,HANDSHAKE_OUTPUT)}
 seen=set()
 for item in value['files']:
  if not isinstance(item,dict) or set(item)!={'path','rawSha256','gitCommit'} or item['path'] in seen or item['path'] not in expected or not HEX64.fullmatch(item['rawSha256']) or item['gitCommit']!=value['remoteHead']:fail('implementation file binding')
  seen.add(item['path']); local=ROOT/item['path']
  if sha_file(local)!=item['rawSha256']:fail('implementation local bytes changed')
 if seen!=expected:fail('implementation binding coverage')
def verify_output_remote(report):
 binding=report['implementationBindings'];validate_implementation_bindings(binding)
 head=git('rev-parse','HEAD'); remote=git('ls-remote',REMOTE,f'refs/heads/{BRANCH}').split()[0]
 if head!=git('rev-parse','@{upstream}') or head!=remote or git('remote','get-url',REMOTE)!=REMOTE_URL:fail('output remote identity')
 parents=git('rev-list','--parents','-n','1',head).split()[1:]
 if parents!=[binding['remoteHead']]:fail('output must directly follow implementation')
 changed=[x for x in git('diff-tree','--no-commit-id','--name-only','-r',head).splitlines() if x]
 if changed!=[OUTPUT.relative_to(ROOT).as_posix()]:fail('output commit content')
 if git('show',f"{head}:{OUTPUT.relative_to(ROOT).as_posix()}",binary=True)!=OUTPUT.read_bytes():fail('output Git blob mismatch')
 for item in binding['files']:
  if git('show',f"{binding['remoteHead']}:{item['path']}",binary=True)!=(ROOT/item['path']).read_bytes():fail('implementation Git blob mismatch')
def load_hs():
 if sha_file(HANDSHAKE_SCRIPT)!=HSS:fail('handshake helper changed')
 s=importlib.util.spec_from_file_location('finra_hs_v3_pinned',HANDSHAKE_SCRIPT); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); return m
class NoRedirect(request.HTTPRedirectHandler):
 def redirect_request(self,*a,**k):fail('redirect')
def metadata_request(token):
 req=request.Request(METADATA,method='GET',headers={'Authorization':f'Bearer {token}','Accept':'application/json','User-Agent':'GrowthScreener-Research/1.0 FINRA-Q004-metadata'})
 opener=request.build_opener(request.ProxyHandler({}),NoRedirect())
 try:
  with opener.open(req,timeout=30) as response: raw=response.read(262145); status=response.status; ctype=response.headers.get('Content-Type','')
 except error.HTTPError as e:fail(f'metadata HTTP {e.code}')
 except error.URLError as e:fail(f'metadata transport {type(e.reason).__name__}')
 if status!=200 or len(raw)>262144 or ctype.split(';',1)[0].strip().lower()!='application/json':fail('metadata response boundary')
 try:value=json.loads(raw.decode('utf-8'))
 except:fail('metadata JSON')
 return raw,value,ctype
def validate_metadata(v):
 if not isinstance(v,dict) or set(v)!={'datasetGroup','datasetName','description','partitionFields','fields'}:fail('metadata top schema')
 if v['datasetGroup']!='OTCMARKET' or v['datasetName']!='OTCDAILYLIST' or v['partitionFields']!=['calendarDay'] or not isinstance(v['fields'],list):fail('dataset identity')
 rows=[]; names=set()
 for f in v['fields']:
  if not isinstance(f,dict) or set(f) not in ({'name','type','description'},{'name','type','description','format'}) or not isinstance(f['name'],str) or not f['name'] or not isinstance(f['type'],str) or not f['type'] or not isinstance(f['description'],str) or f['name'] in names:fail('field schema')
  fmt=f.get('format')
  if fmt is not None and not isinstance(fmt,str):fail('field format')
  names.add(f['name']); rows.append({'name':f['name'],'type':f['type'],'format':fmt})
 if not REQUIRED.issubset(names):fail('required fields missing')
 rows.sort(key=lambda r:r['name']); return rows
def cas_write(raw):
 digest=sha_bytes(raw); path=PRIVATE_CAS/'sha256'/digest[:2]/digest
 path.parent.mkdir(parents=True,exist_ok=True)
 if path.exists():
  if path.read_bytes()!=raw:fail('CAS collision')
 else:
  fd,n=tempfile.mkstemp(prefix='.'+digest+'.',suffix='.tmp',dir=path.parent); tmp=Path(n)
  try:
   with os.fdopen(fd,'wb') as h:h.write(raw);h.flush();os.fsync(h.fileno())
   os.link(tmp,path)
  finally:tmp.unlink(missing_ok=True)
 if path.read_bytes()!=raw:fail('CAS readback')
 return digest,path
def build_report(c,remote,raw,fields,captured,cas_path):
 r={'schema':'finra-q004-otc-daily-list-metadata/v1','capturedAt':captured,'track':c['track'],'taskId':c['taskId'],'sourceId':c['sourceId'],'contractRawSha256':sha_file(CONTRACT),'contractSha256':c['contractSha256'],'handshakeOutputRawSha256':HSO,'implementationBindings':remote,'requestCounts':{'tokenRequests':1,'metadataRequests':1,'productionDataRequests':0},'responseEvidence':{'httpStatus':200,'contentType':'application/json','rawSha256':sha_bytes(raw),'bytes':len(raw),'privateCasRelativePath':f'sha256/{sha_bytes(raw)[:2]}/{sha_bytes(raw)}','rawResponseIncluded':False},'dataset':{'datasetGroup':'OTCMARKET','datasetName':'OTCDAILYLIST','partitionFields':['calendarDay'],'fieldCount':len(fields),'fields':fields,'schemaPointEvidenceOnly':True},'secretsCaptured':False,'outcomesAccessed':False,'productionRowsCaptured':0,'claimLocks':c['claimLocks']}
 r['reportSha256']=sha_bytes(canonical(r));return r
def validate_report(r,c):
 if set(r)!={'schema','capturedAt','track','taskId','sourceId','contractRawSha256','contractSha256','handshakeOutputRawSha256','implementationBindings','requestCounts','responseEvidence','dataset','secretsCaptured','outcomesAccessed','productionRowsCaptured','claimLocks','reportSha256'}:fail('report keys')
 b=dict(r);cl=b.pop('reportSha256');
 if cl!=sha_bytes(canonical(b)):fail('report hash')
 if r['schema']!='finra-q004-otc-daily-list-metadata/v1' or r['contractRawSha256']!=sha_file(CONTRACT) or r['contractSha256']!=c['contractSha256'] or r['handshakeOutputRawSha256']!=HSO:fail('bindings')
 validate_implementation_bindings(r['implementationBindings'])
 if parse_time(c['createdAt'])>parse_time(r['capturedAt']):fail('timeline')
 if r['requestCounts']!={'tokenRequests':1,'metadataRequests':1,'productionDataRequests':0} or r['secretsCaptured'] is not False or r['outcomesAccessed'] is not False or r['productionRowsCaptured']!=0 or r['claimLocks']!=c['claimLocks'] or any(r['claimLocks'].values()):fail('boundary')
 e=r['responseEvidence'];
 if set(e)!={'httpStatus','contentType','rawSha256','bytes','privateCasRelativePath','rawResponseIncluded'} or e['httpStatus']!=200 or e['contentType']!='application/json' or not HEX64.fullmatch(e['rawSha256']) or not isinstance(e['bytes'],int) or e['bytes']<=0 or e['bytes']>262144 or e['privateCasRelativePath']!=f"sha256/{e['rawSha256'][:2]}/{e['rawSha256']}" or e['rawResponseIncluded'] is not False:fail('response evidence')
 if set(r['dataset'])!={'datasetGroup','datasetName','partitionFields','fieldCount','fields','schemaPointEvidenceOnly'} or r['dataset']['datasetGroup']!='OTCMARKET' or r['dataset']['datasetName']!='OTCDAILYLIST' or r['dataset']['partitionFields']!=['calendarDay'] or r['dataset']['fieldCount']!=len(r['dataset']['fields']) or r['dataset']['schemaPointEvidenceOnly'] is not True:fail('dataset report')
 if r['dataset']['fields']!=sorted(r['dataset']['fields'],key=lambda x:x.get('name','') if isinstance(x,dict) else ''):fail('field order')
 for field in r['dataset']['fields']:
  if not isinstance(field,dict) or set(field)!={'name','type','format'} or not isinstance(field['name'],str) or not isinstance(field['type'],str) or (field['format'] is not None and not isinstance(field['format'],str)):fail('public field schema')
 if not REQUIRED.issubset({x.get('name') for x in r['dataset']['fields'] if isinstance(x,dict)}):fail('required report fields')
 text=canonical(r).decode().casefold()
 for x in ('access_token','authorization":"bearer','oldsymbolcode":"','cashamounttext":"'): 
  if x in text:fail('secret or value leak')
def write_new(p,raw):
 if p.exists():fail('output exists')
 p.parent.mkdir(parents=True,exist_ok=True);fd,n=tempfile.mkstemp(prefix='.'+p.name+'.',suffix='.tmp',dir=p.parent);tmp=Path(n)
 try:
  with os.fdopen(fd,'wb') as h:h.write(raw);h.flush();os.fsync(h.fileno())
  os.link(tmp,p)
 finally:tmp.unlink(missing_ok=True)
 if p.read_bytes()!=raw:fail('output readback')
def self_test(c):
 fixture={'datasetGroup':'OTCMARKET','datasetName':'OTCDAILYLIST','description':'fixture','partitionFields':['calendarDay'],'fields':[{'name':n,'type':'String','description':'x'} for n in sorted(REQUIRED)]}
 fields=validate_metadata(fixture);head='a'*40;paths=(CONTRACT,Path(__file__).resolve(),TEST,HANDSHAKE_SCRIPT,HANDSHAKE_CONTRACT,HANDSHAKE_OUTPUT);remote={'remoteName':REMOTE,'remoteBranch':BRANCH,'remoteHead':head,'files':[{'path':p.relative_to(ROOT).as_posix(),'rawSha256':sha_file(p),'gitCommit':head} for p in paths]};raw=canonical(fixture);r=build_report(c,remote,raw,fields,'2026-08-12T19:08:00Z','unused');validate_report(r,c)
 kills={}
 for name,mut in [('missingRequired',lambda x:x['fields'].pop()),('extraTop',lambda x:x.__setitem__('price',1)),('fieldValueLeak',lambda x:x['fields'][0].__setitem__('value','secret-record-value')),('fieldExtraKey',lambda x:x['fields'][0].__setitem__('nullable',True))]:
  x=json.loads(json.dumps(fixture));mut(x)
  try:validate_metadata(x);kills[name]=False
  except StudyError:kills[name]=True
 if not all(kills.values()):fail('kill failed')
 bad=json.loads(json.dumps(r));bad['claimLocks']['corporateActionsComplete']=True;body=dict(bad);body.pop('reportSha256');bad['reportSha256']=sha_bytes(canonical(body))
 try:validate_report(bad,c);kills['claimPromotion']=False
 except StudyError:kills['claimPromotion']=True
 if not all(kills.values()):fail('report kill failed')
 return {'schema':'finra-q004-accounted-metadata-self-test/v1','status':'PASS','kills':kills,'outcomesAccessed':False,'secretsCaptured':False}
def main():
 p=argparse.ArgumentParser();p.add_argument('command',choices=('verify-contract','self-test','capture','verify-output'));p.add_argument('--output');p.add_argument('--remote',action='store_true');a=p.parse_args()
 try:
  c=validate_contract()
  if a.command=='verify-contract':print(json.dumps({'schema':'finra-q004-accounted-metadata-contract-verification/v1','status':'PASS','contractSha256':c['contractSha256'],'outcomesAccessed':False},sort_keys=True))
  elif a.command=='self-test':print(json.dumps(self_test(c),sort_keys=True))
  elif a.command=='capture':
   if a.output is None or Path(a.output).resolve()!=OUTPUT.resolve():fail('frozen output')
   before=verify_remote();hs=load_hs();user,secret=hs.load_base().read_windows_credential();basic='';token='';token_raw=b''
   try:
    import base64
    basic=base64.b64encode(f'{user}:{secret}'.encode()).decode();req=request.Request(TOKEN,data=b'',method='POST',headers={'Authorization':f'Basic {basic}','Accept':'application/json','User-Agent':'GrowthScreener-Research/1.0 FINRA-Q004-metadata'});op=request.build_opener(request.ProxyHandler({}),NoRedirect())
    with op.open(req,timeout=30) as resp:token_raw=resp.read(16385);status=resp.status;ctype=resp.headers.get('Content-Type','')
    token_obj=json.loads(token_raw.decode());token=token_obj.get('access_token');hs.load_base().sanitize_token_response(token_raw,status,ctype)
    raw,value,_=metadata_request(token)
   finally:user='';secret='';basic='';token='';token_raw=b''
   fields=validate_metadata(value);captured=datetime.now(timezone.utc).replace(microsecond=0).strftime('%Y-%m-%dT%H:%M:%SZ');after=verify_remote()
   if before!=after:fail('remote drift')
   digest,cas=cas_write(raw)
   report=build_report(c,after,raw,fields,captured,cas);validate_report(report,c);out=canonical(report)+b'\n';write_new(OUTPUT,out)
   print(json.dumps({'schema':'finra-q004-accounted-metadata-write-result/v1','status':'PASS','output':OUTPUT.relative_to(ROOT).as_posix(),'rawSha256':sha_bytes(out),'reportSha256':report['reportSha256'],'privateResponseSha256':digest,'productionRowsCaptured':0,'outcomesAccessed':False,'secretsCaptured':False},sort_keys=True))
  else:
   if a.output is None or Path(a.output).resolve()!=OUTPUT.resolve():fail('frozen output')
   r=load(OUTPUT);validate_report(r,c);out=canonical(r)+b'\n'
   if OUTPUT.read_bytes()!=out:fail('canonical output')
   cas=PRIVATE_CAS/r['responseEvidence']['privateCasRelativePath'];raw=cas.read_bytes()
   if sha_bytes(raw)!=r['responseEvidence']['rawSha256'] or len(raw)!=r['responseEvidence']['bytes']:fail('private CAS')
   fields=validate_metadata(json.loads(raw.decode()))
   if fields!=r['dataset']['fields']:fail('metadata reparse')
   if a.remote:verify_output_remote(r)
   print(json.dumps({'schema':'finra-q004-accounted-metadata-output-verification/v1','status':'PASS','rawSha256':sha_bytes(out),'reportSha256':r['reportSha256'],'privateCasVerified':True,'remoteVerified':a.remote,'productionRowsCaptured':0,'outcomesAccessed':False,'secretsCaptured':False},sort_keys=True))
  return 0
 except (StudyError,Exception) as e:
  print(f'StudyError: {type(e).__name__}',file=sys.stderr);return 1
if __name__=='__main__':raise SystemExit(main())
