#!/usr/bin/env python3
"""One FINRA production query, private row capture, public aggregate evidence only."""
from __future__ import annotations
import argparse,base64,hashlib,importlib.util,json,os,re,subprocess,sys,tempfile
from datetime import datetime,timezone
from pathlib import Path
from urllib import error,request
ROOT=Path(__file__).resolve().parents[1];CONTRACT=ROOT/'research'/'early-detection-v4'/'finra-q004-single-day-pilot-contract-v1.json';TEST=ROOT/'tests'/'run-finra-q004-single-day-pilot-v1.test.js';OUTPUT=ROOT/'reports'/'early-detection'/'finra-q004-single-day-pilot-v1.json';META=ROOT/'scripts'/'run-finra-q004-accounted-metadata-v1.py';META_OUT=ROOT/'reports'/'early-detection'/'finra-q004-otc-daily-list-metadata-v1.json';TERMS=ROOT/'reports'/'early-detection'/'finra-q004-api-terms-snapshot-v2.json';CAS=Path(r'C:\Users\Anwender\Documents\GrowthScreenerResearchData\private-evidence\finra-q004\data')
PARENT='e6193347e943a36f351a15b25b438c77c16c8c41';REMOTE='origin';BRANCH='codex/early-detection-v4-gates-20260810';REMOTE_URL='https://github.com/Karlryl/screener-data.git';META_SHA='aee78a1dfd2b946937fed9451340bb76afa7e137e05d234a76bc1c4f0889e52a';META_OUT_SHA='dc1ce543a2c2dbc80187d7757874245e504bb3c04b1faa8ccbdaa91a8ad23955';TERMS_SHA='686b31c58169809e627edb346e6d281437185e12dbc0065896251622814c1fe7'
TOKEN='https://ews.fip.finra.org/fip/rest/ews/oauth2/access_token?grant_type=client_credentials';DATA='https://api.finra.org/data/group/otcMarket/name/OTCDAILYLIST';DAY='2018-12-18';FIELDS=['OTCDailyListID','calendarDay','dailyListDatetime','dailyListEventCode'];QUERY={'fields':FIELDS,'compareFilters':[{'compareType':'EQUAL','fieldName':'calendarDay','fieldValue':DAY}],'limit':1000,'offset':0,'async':False};HEX64=re.compile(r'^[0-9a-f]{64}$');HEX40=re.compile(r'^[0-9a-f]{40}$')
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
 if set(x)!={'schema','createdAt','track','taskId','sourceId','purpose','authorization','query','networkContract','privateCas','outputContract','claimLocks','contractSha256'}:fail('contract keys')
 if x['schema']!='finra-q004-single-day-pilot-contract/v1' or x['track']!='SHARED_OUTCOME_BLIND_INFRA' or x['taskId']!='Q004-FINRA-OTC-CATALOG' or x['sourceId']!='FINRA_OTC_PRIMARY':fail('boundary')
 if x['authorization']!={'parentRemoteCommit':PARENT,'credentialType':'PUBLIC','monthlyFeeUsd':0,'monthlyUsageCapLabel':'10 GB','metadataEvidencePath':'reports/early-detection/finra-q004-otc-daily-list-metadata-v1.json','metadataEvidenceRawSha256':META_OUT_SHA,'termsEvidencePath':'reports/early-detection/finra-q004-api-terms-snapshot-v2.json','termsEvidenceRawSha256':TERMS_SHA}:fail('authorization')
 if sha_file(META_OUT)!=META_OUT_SHA or sha_file(TERMS)!=TERMS_SHA or sha_file(META)!=META_SHA:fail('input bytes')
 expected={'method':'POST','url':DATA,'calendarDay':DAY,**QUERY}
 if x['query']!=expected:fail('query')
 if x['networkContract']!={'tokenRequests':1,'dataRequests':1,'redirectsAllowed':False,'environmentProxyUseAllowed':False,'retryAllowed':False,'maximumResponseBytes':3145728,'maximumRows':1000,'requiredResponseHeaders':['content-type','record-limit','record-offset','record-total','total-records-on-page']}:fail('network')
 if x['privateCas']!={'root':CAS.as_posix(),'pathTemplate':'sha256/{sha256[0:2]}/{sha256}','outsideGitRequired':True,'writeNewOnly':True}:fail('CAS')
 if x['outputContract']!={'path':'reports/early-detection/finra-q004-single-day-pilot-v1.json','rowValuesIncluded':False,'rawResponseIncluded':False,'secretsCaptured':False,'outcomesAccessed':False} or any(x['claimLocks'].values()) or utc(x['createdAt'])>datetime.now(timezone.utc):fail('output, locks, or time')
 return x
if sha_file(META)!=META_SHA:fail('metadata helper changed')
spec=importlib.util.spec_from_file_location('finra_meta_pinned',META);meta=importlib.util.module_from_spec(spec);spec.loader.exec_module(meta)
def snapshot():
 head=git('rev-parse','HEAD');parts=git('ls-remote',REMOTE,f'refs/heads/{BRANCH}').split();remote=parts[0] if parts else ''
 if head!=git('rev-parse','@{upstream}') or head!=remote or git('remote','get-url',REMOTE)!=REMOTE_URL or git('rev-list','--parents','-n','1',head).split()[1:]!=[PARENT]:fail('remote lineage')
 if utc(load(CONTRACT)['createdAt'])>datetime.fromtimestamp(int(git('show','-s','--format=%ct',head)),timezone.utc):fail('contract after commit')
 files=[]
 for p in (CONTRACT,Path(__file__).resolve(),TEST,META,META_OUT,TERMS):
  rel=p.relative_to(ROOT).as_posix();raw=p.read_bytes()
  if git('show',f'{head}:{rel}',binary=True)!=raw:fail('blob mismatch')
  files.append({'path':rel,'rawSha256':sha(raw),'gitCommit':head})
 return {'remoteName':REMOTE,'remoteBranch':BRANCH,'remoteHead':head,'files':files}
def binding_ok(x):
 if not isinstance(x,dict) or set(x)!={'remoteName','remoteBranch','remoteHead','files'} or x['remoteName']!=REMOTE or x['remoteBranch']!=BRANCH or not HEX40.fullmatch(x['remoteHead']):fail('binding')
 expected={p.relative_to(ROOT).as_posix() for p in (CONTRACT,Path(__file__).resolve(),TEST,META,META_OUT,TERMS)};seen=set()
 for i in x['files']:
  if not isinstance(i,dict) or set(i)!={'path','rawSha256','gitCommit'} or i['path'] in seen or i['path'] not in expected or not HEX64.fullmatch(i['rawSha256']) or i['gitCommit']!=x['remoteHead'] or sha_file(ROOT/i['path'])!=i['rawSha256']:fail('file binding')
  seen.add(i['path'])
 if seen!=expected:fail('binding coverage')
def token():
 hs=meta.load_hs();base=hs.load_base();user,secret=base.read_windows_credential();basic='';raw=b''
 try:
  basic=base64.b64encode(f'{user}:{secret}'.encode()).decode();req=request.Request(TOKEN,data=b'',method='POST',headers={'Authorization':f'Basic {basic}','Accept':'application/json','User-Agent':'GrowthScreener-Research/1.0 FINRA-Q004-day-pilot'});op=request.build_opener(request.ProxyHandler({}),meta.NoRedirect())
  with op.open(req,timeout=30) as response:raw=response.read(16385);status=response.status;ctype=response.headers.get('Content-Type','')
  obj=json.loads(raw.decode());access=obj.get('access_token');base.sanitize_token_response(raw,status,ctype)
  if not isinstance(access,str):fail('token')
  return access
 finally:user='';secret='';basic='';raw=b''
def data_request(access):
 payload=canonical(QUERY);req=request.Request(DATA,data=payload,method='POST',headers={'Authorization':f'Bearer {access}','Accept':'application/json','Content-Type':'application/json','User-Agent':'GrowthScreener-Research/1.0 FINRA-Q004-day-pilot'});op=request.build_opener(request.ProxyHandler({}),meta.NoRedirect())
 try:
  with op.open(req,timeout=60) as response:raw=response.read(3145729);status=response.status;headers={k.casefold():v.strip() for k,v in response.headers.items()}
 except error.HTTPError as e:fail(f'data HTTP {e.code}')
 except error.URLError as e:fail(f'data transport {type(e.reason).__name__}')
 required={'content-type','record-limit','record-offset','record-total','total-records-on-page'}
 if status!=200 or len(raw)>3145728 or not required.issubset(headers) or headers['content-type'].split(';',1)[0].strip().casefold()!='application/json':fail('data boundary')
 try:rows=json.loads(raw.decode('utf-8'))
 except Exception:fail('data JSON')
 return payload,raw,rows,headers
def validate_rows(rows,headers):
 if not isinstance(rows,list) or len(rows)>1000:fail('rows')
 ids=set()
 for row in rows:
  if not isinstance(row,dict) or set(row)!=set(FIELDS):fail('row schema')
  ident=row['OTCDailyListID']
  if not isinstance(ident,int) or isinstance(ident,bool) or ident in ids or row['calendarDay']!=DAY or not isinstance(row['dailyListDatetime'],str) or not row['dailyListDatetime'].startswith(DAY+' ') or not isinstance(row['dailyListEventCode'],str):fail('row semantics')
  ids.add(ident)
 try:total=int(headers['record-total']);offset=int(headers['record-offset']);limit=int(headers['record-limit']);page=int(headers['total-records-on-page'])
 except Exception:fail('header integers')
 if offset!=0 or not 0<limit<=1000 or page!=len(rows) or total!=len(rows) or total>limit:fail('count parity')
 return {'recordTotal':total,'recordOffset':offset,'recordLimit':limit,'recordsOnPage':page,'uniqueIdCount':len(ids),'allRowsMatchCalendarDay':True}
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
def safe_headers(headers):
 keys=['content-type','record-limit','record-offset','record-total','total-records-on-page','record-max-limit','response-payload-max-size'];return {k:headers[k] for k in keys if k in headers}
def build(c,binding,payload,raw,headers,counts,at):
 hs=safe_headers(headers);r={'schema':'finra-q004-single-day-pilot/v1','capturedAt':at,'track':c['track'],'taskId':c['taskId'],'sourceId':c['sourceId'],'contractRawSha256':sha_file(CONTRACT),'contractSha256':c['contractSha256'],'metadataEvidenceRawSha256':META_OUT_SHA,'termsEvidenceRawSha256':TERMS_SHA,'implementationBindings':binding,'requestEvidence':{'method':'POST','url':DATA,'canonicalPayloadSha256':sha(payload),'calendarDay':DAY,'fields':FIELDS,'limit':1000,'offset':0},'responseEvidence':{'httpStatus':200,'rawSha256':sha(raw),'bytes':len(raw),'privateCasRelativePath':f'sha256/{sha(raw)[:2]}/{sha(raw)}','headersCanonicalSha256':sha(canonical(hs)),'headers':hs,'rawResponseIncluded':False},'counts':counts,'rowValuesIncluded':False,'secretsCaptured':False,'outcomesAccessed':False,'claimLocks':c['claimLocks']};r['reportSha256']=sha(canonical(r));return r
def validate_report(r,c):
 if set(r)!={'schema','capturedAt','track','taskId','sourceId','contractRawSha256','contractSha256','metadataEvidenceRawSha256','termsEvidenceRawSha256','implementationBindings','requestEvidence','responseEvidence','counts','rowValuesIncluded','secretsCaptured','outcomesAccessed','claimLocks','reportSha256'}:fail('report keys')
 b=dict(r);claim=b.pop('reportSha256',None)
 if claim!=sha(canonical(b)) or r['schema']!='finra-q004-single-day-pilot/v1' or r['contractRawSha256']!=sha_file(CONTRACT) or r['contractSha256']!=c['contractSha256'] or r['metadataEvidenceRawSha256']!=META_OUT_SHA or r['termsEvidenceRawSha256']!=TERMS_SHA or utc(c['createdAt'])>utc(r['capturedAt']):fail('report binding')
 binding_ok(r['implementationBindings'])
 if r['requestEvidence']!={'method':'POST','url':DATA,'canonicalPayloadSha256':sha(canonical(QUERY)),'calendarDay':DAY,'fields':FIELDS,'limit':1000,'offset':0}:fail('request evidence')
 e=r['responseEvidence']
 if not isinstance(e,dict) or set(e)!={'httpStatus','rawSha256','bytes','privateCasRelativePath','headersCanonicalSha256','headers','rawResponseIncluded'} or e['httpStatus']!=200 or not HEX64.fullmatch(e['rawSha256']) or not isinstance(e['bytes'],int) or not 0<e['bytes']<=3145728 or e['privateCasRelativePath']!=f"sha256/{e['rawSha256'][:2]}/{e['rawSha256']}" or e['headersCanonicalSha256']!=sha(canonical(e['headers'])) or e['rawResponseIncluded'] is not False:fail('response evidence')
 if set(r['counts'])!={'recordTotal','recordOffset','recordLimit','recordsOnPage','uniqueIdCount','allRowsMatchCalendarDay'} or r['counts']['recordTotal']!=r['counts']['recordsOnPage'] or r['counts']['recordTotal']!=r['counts']['uniqueIdCount'] or r['counts']['recordOffset']!=0 or r['counts']['allRowsMatchCalendarDay'] is not True:fail('counts')
 if r['rowValuesIncluded'] is not False or r['secretsCaptured'] is not False or r['outcomesAccessed'] is not False or r['claimLocks']!=c['claimLocks'] or any(r['claimLocks'].values()):fail('locks')
 text=canonical(r).decode().casefold()
 for term in ('oldsymbolcode','newsymbolcode','cashamounttext','access_token','dailylistdatetime":"','dailylisteventcode":"'):
  if term in text:fail('row or secret leak')
def write_new(p,raw):
 if p.exists():fail('output exists')
 p.parent.mkdir(parents=True,exist_ok=True);fd,n=tempfile.mkstemp(prefix='.'+p.name+'.',suffix='.tmp',dir=p.parent);tmp=Path(n)
 try:
  with os.fdopen(fd,'wb') as h:h.write(raw);h.flush();os.fsync(h.fileno())
  os.link(tmp,p)
 finally:tmp.unlink(missing_ok=True)
 if p.read_bytes()!=raw:fail('write readback')
def verify_remote_output(r):
 b=r['implementationBindings'];head=git('rev-parse','HEAD');parts=git('ls-remote',REMOTE,f'refs/heads/{BRANCH}').split();remote=parts[0] if parts else ''
 if head!=git('rev-parse','@{upstream}') or head!=remote or git('remote','get-url',REMOTE)!=REMOTE_URL or git('rev-list','--parents','-n','1',head).split()[1:]!=[b['remoteHead']] or git('diff-tree','--no-commit-id','--name-only','-r',head).splitlines()!=[OUTPUT.relative_to(ROOT).as_posix()] or git('show',f"{head}:{OUTPUT.relative_to(ROOT).as_posix()}",binary=True)!=OUTPUT.read_bytes():fail('output remote')
 for i in b['files']:
  if git('show',f"{b['remoteHead']}:{i['path']}",binary=True)!=(ROOT/i['path']).read_bytes():fail('implementation blob')
def self_test(c):
 headers={'content-type':'application/json','record-limit':'1000','record-offset':'0','record-total':'2','total-records-on-page':'2'};rows=[{'OTCDailyListID':1,'calendarDay':DAY,'dailyListDatetime':DAY+' 10:00:00.0','dailyListEventCode':'A'},{'OTCDailyListID':2,'calendarDay':DAY,'dailyListDatetime':DAY+' 11:00:00.0','dailyListEventCode':'D'}];counts=validate_rows(rows,headers);kills={}
 for n,mut in [('duplicateId',lambda x:x[1].__setitem__('OTCDailyListID',1)),('wrongDay',lambda x:x[0].__setitem__('calendarDay','2018-12-19')),('extraValue',lambda x:x[0].__setitem__('cashAmountText','1.00'))]:
  x=json.loads(json.dumps(rows));mut(x)
  try:validate_rows(x,headers);kills[n]=False
  except StudyError:kills[n]=True
 bad=dict(headers);bad['record-total']='3'
 try:validate_rows(rows,bad);kills['headerCountDrift']=False
 except StudyError:kills['headerCountDrift']=True
 if not all(kills.values()):fail('kill')
 return {'schema':'finra-q004-single-day-pilot-self-test/v1','status':'PASS','kills':kills,'fixtureCount':counts['recordTotal'],'outcomesAccessed':False}
def main():
 p=argparse.ArgumentParser();p.add_argument('command',choices=('verify-contract','self-test','capture','verify-output'));p.add_argument('--output');p.add_argument('--remote',action='store_true');a=p.parse_args()
 try:
  c=validate_contract()
  if a.command=='verify-contract':print(json.dumps({'schema':'finra-q004-single-day-pilot-contract-verification/v1','status':'PASS','contractSha256':c['contractSha256'],'outcomesAccessed':False},sort_keys=True))
  elif a.command=='self-test':print(json.dumps(self_test(c),sort_keys=True))
  elif a.command=='capture':
   if a.output is None or Path(a.output).resolve()!=OUTPUT.resolve():fail('frozen output')
   before=snapshot();access=token()
   try:payload,raw,rows,headers=data_request(access)
   finally:access=''
   counts=validate_rows(rows,headers);after=snapshot()
   if before!=after:fail('remote drift')
   digest=cas_write(raw);at=datetime.now(timezone.utc).replace(microsecond=0).strftime('%Y-%m-%dT%H:%M:%SZ');r=build(c,after,payload,raw,headers,counts,at);validate_report(r,c);out=canonical(r)+b'\n';write_new(OUTPUT,out);print(json.dumps({'schema':'finra-q004-single-day-pilot-write-result/v1','status':'PASS','output':OUTPUT.relative_to(ROOT).as_posix(),'rawSha256':sha(out),'reportSha256':r['reportSha256'],'privateResponseSha256':digest,'recordTotal':counts['recordTotal'],'outcomesAccessed':False},sort_keys=True))
  else:
   if a.output is None or Path(a.output).resolve()!=OUTPUT.resolve():fail('frozen output')
   r=load(OUTPUT);validate_report(r,c);out=canonical(r)+b'\n'
   if OUTPUT.read_bytes()!=out:fail('canonical output')
   raw=(CAS/r['responseEvidence']['privateCasRelativePath']).read_bytes()
   if sha(raw)!=r['responseEvidence']['rawSha256'] or len(raw)!=r['responseEvidence']['bytes']:fail('CAS bytes')
   rows=json.loads(raw.decode());headers=r['responseEvidence']['headers'];counts=validate_rows(rows,headers)
   if counts!=r['counts']:fail('private reparse')
   if a.remote:verify_remote_output(r)
   print(json.dumps({'schema':'finra-q004-single-day-pilot-output-verification/v1','status':'PASS','rawSha256':sha(out),'reportSha256':r['reportSha256'],'privateCasVerified':True,'remoteVerified':a.remote,'recordTotal':r['counts']['recordTotal'],'outcomesAccessed':False},sort_keys=True))
  return 0
 except Exception as e:
  print(f'StudyError: {type(e).__name__}',file=sys.stderr);return 1
if __name__=='__main__':raise SystemExit(main())
