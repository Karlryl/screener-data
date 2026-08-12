#!/usr/bin/env python3
"""Resumable FINRA OTC Daily List crawl. Raw rows never leave the private CAS."""
from __future__ import annotations
import argparse,base64,hashlib,importlib.util,json,os,re,subprocess,sys,tempfile,time
from datetime import datetime,timezone
from pathlib import Path
from urllib import error,request
ROOT=Path(__file__).resolve().parents[1];CONTRACT=ROOT/'research'/'early-detection-v4'/'finra-q004-historical-crawl-contract-v2.json';TEST=ROOT/'tests'/'run-finra-q004-historical-crawl-v2.test.js';OUTPUT=ROOT/'reports'/'early-detection'/'finra-q004-historical-crawl-manifest-v2.json';PARTITIONS=ROOT/'reports'/'early-detection'/'finra-q004-partitions-2009-2024-v1.json';METADATA=ROOT/'reports'/'early-detection'/'finra-q004-otc-daily-list-metadata-v1.json';TERMS=ROOT/'reports'/'early-detection'/'finra-q004-api-terms-snapshot-v2.json';PILOT_SCRIPT=ROOT/'scripts'/'run-finra-q004-single-day-pilot-v2.py';PRIVATE=Path(r'C:\Users\Anwender\Documents\GrowthScreenerResearchData\private-evidence\finra-q004\historical');CHECKPOINT=PRIVATE/'checkpoint-v2.json'
PARENT='102bb345568721e950fa9ee3420ef7bbce7414a6';REMOTE='origin';BRANCH='codex/early-detection-v4-gates-20260810';REMOTE_URL='https://github.com/Karlryl/screener-data.git';PARTITIONS_SHA='2772239277ff93be4e3034b0c80c13b41a080b6c1d606a7b7a3f158fb6c06b1c';METADATA_SHA='dc1ce543a2c2dbc80187d7757874245e504bb3c04b1faa8ccbdaa91a8ad23955';TERMS_SHA='686b31c58169809e627edb346e6d281437185e12dbc0065896251622814c1fe7';PILOT_SHA='0e08a44a9a75616a15407eb7b5682eed1a663168f39ed69ca5b9bed0492ca22f';DATES_SHA='4b6b991889079d3fbcf92de1a4853988d3eb78ad650ddee50cdbeba8f9381b37';V1_CONTRACT_SHA='f76344f80a9b35178a5eca02c233bd3a1e6d8aebb4c2e77f5b1e83b984d723a4';DATA='https://api.finra.org/data/group/otcMarket/name/OTCDAILYLIST';HEX64=re.compile(r'^[0-9a-f]{64}$');HEX40=re.compile(r'^[0-9a-f]{40}$')
class StudyError(RuntimeError):pass
class RateDeferred(StudyError):pass
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
 except Exception:fail(f'invalid JSON {p}')
 if not isinstance(x,dict):fail('object required')
 return x
def git(*a,binary=False):
 p=subprocess.run(['git',*a],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=False)
 if p.returncode:fail('git')
 return p.stdout if binary else p.stdout.decode().strip()
def utc(x):
 try:return datetime.strptime(x,'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
 except Exception:fail('time')
def inputs():
 if sha_file(PARTITIONS)!=PARTITIONS_SHA or sha_file(METADATA)!=METADATA_SHA or sha_file(TERMS)!=TERMS_SHA or sha_file(PILOT_SCRIPT)!=PILOT_SHA:fail('input bytes')
 dates=load(PARTITIONS)['queue']['dates'];fields=[x['name'] for x in load(METADATA)['dataset']['fields']]
 if len(dates)!=1522 or sha(canonical(dates))!=DATES_SHA or len(fields)!=60 or len(set(fields))!=60:fail('input semantics')
 return dates,fields
def validate_contract():
 x=load(CONTRACT);b=dict(x);claim=b.pop('contractSha256',None)
 if claim!=sha(canonical(b)) or not isinstance(claim,str) or not HEX64.fullmatch(claim):fail('contract hash')
 if set(x)!={'schema','createdAt','track','taskId','sourceId','purpose','authorization','coverageContract','requestContract','storageContract','completionContract','claimLocks','supersedesContractRawSha256','contractSha256'}:fail('contract keys')
 if x['schema']!='finra-q004-historical-crawl-contract/v2' or x['track']!='SHARED_OUTCOME_BLIND_INFRA' or x['taskId']!='Q004-FINRA-OTC-CATALOG' or x['sourceId']!='FINRA_OTC_PRIMARY' or x['supersedesContractRawSha256']!=V1_CONTRACT_SHA:fail('boundary')
 if x['authorization']!={'parentRemoteCommit':PARENT,'credentialType':'PUBLIC','monthlyFeeUsd':0,'monthlyUsageCapBytes':10000000000,'termsEvidenceRawSha256':TERMS_SHA,'metadataEvidenceRawSha256':METADATA_SHA,'partitionsEvidenceRawSha256':PARTITIONS_SHA}:fail('authorization')
 if x['coverageContract']!={'requestedMinimumDate':'2009-01-01','requestedMaximumDate':'2024-12-31','availableMinimumDate':'2016-01-18','availableMaximumDate':'2024-12-31','availablePartitionCount':1522,'availableDatesSha256':DATES_SHA,'pre2016CoverageStatus':'UNRESOLVED_NOT_EXPOSED_BY_PARTITIONS_ENDPOINT','emptyCalendarDaysQueried':False}:fail('coverage')
 if x['requestContract']!={'tokenRequestsPerInvocation':1,'dataUrl':DATA,'method':'POST','partitionField':'calendarDay','compareType':'EQUAL','fields':'ALL_60_METADATA_FIELDS','limit':5000,'offsetPagination':True,'async':False,'minimumSecondsBetweenDataRequests':2,'maximumDataRequestsPerMinute':30,'redirectsAllowed':False,'environmentProxyUseAllowed':False,'automaticRetriesAllowed':False,'rateLimitDisposition':'RATE_DEFERRED','maximumResponseBytesPerPage':3145728}:fail('request')
 if x['storageContract']!={'privateRoot':PRIVATE.as_posix(),'rawPagePathTemplate':'blobs/sha256/{sha256[0:2]}/{sha256}','checkpointPath':'checkpoint-v2.json','checkpointWrite':'ATOMIC_REPLACE_LOCAL_ONLY','rawDataPublicGitAllowed':False,'resumeVerifiesEveryPriorBlob':True,'writeNewRawBlobs':True}:fail('storage')
 if x['completionContract']!={'outputPath':'reports/early-detection/finra-q004-historical-crawl-manifest-v2.json','all1522PartitionsRequired':True,'recordTotalStableWithinPartition':True,'pageOffsetsContiguous':True,'allRowsMatchPartition':True,'all60FieldsExact':True,'idsUniqueWithinAndAcrossPartitions':True,'twoPrivateRebuildsRequiredBeforePromotion':True,'rawRowsIncludedInPublicManifest':False} or any(x['claimLocks'].values()) or utc(x['createdAt'])>datetime.now(timezone.utc):fail('completion/locks/time')
 inputs();return x
if sha_file(PILOT_SCRIPT)!=PILOT_SHA:fail('helper')
spec=importlib.util.spec_from_file_location('finra_pilot_pinned',PILOT_SCRIPT);pilot=importlib.util.module_from_spec(spec);spec.loader.exec_module(pilot)
def snapshot():
 head=git('rev-parse','HEAD');parts=git('ls-remote',REMOTE,f'refs/heads/{BRANCH}').split();remote=parts[0] if parts else ''
 if head!=git('rev-parse','@{upstream}') or head!=remote or git('remote','get-url',REMOTE)!=REMOTE_URL or git('rev-list','--parents','-n','1',head).split()[1:]!=[PARENT]:fail('remote')
 if utc(load(CONTRACT)['createdAt'])>datetime.fromtimestamp(int(git('show','-s','--format=%ct',head)),timezone.utc):fail('timeline')
 files=[]
 for p in (CONTRACT,Path(__file__).resolve(),TEST,PARTITIONS,METADATA,TERMS,PILOT_SCRIPT):
  rel=p.relative_to(ROOT).as_posix();raw=p.read_bytes()
  if git('show',f'{head}:{rel}',binary=True)!=raw:fail('blob')
  files.append({'path':rel,'rawSha256':sha(raw),'gitCommit':head})
 return {'remoteName':REMOTE,'remoteBranch':BRANCH,'remoteHead':head,'files':files}
def binding_ok(x):
 if not isinstance(x,dict) or set(x)!={'remoteName','remoteBranch','remoteHead','files'} or x['remoteName']!=REMOTE or x['remoteBranch']!=BRANCH or not HEX40.fullmatch(x['remoteHead']):fail('binding')
 expected={p.relative_to(ROOT).as_posix() for p in (CONTRACT,Path(__file__).resolve(),TEST,PARTITIONS,METADATA,TERMS,PILOT_SCRIPT)};seen=set()
 for i in x['files']:
  if not isinstance(i,dict) or set(i)!={'path','rawSha256','gitCommit'} or i['path'] in seen or i['path'] not in expected or not HEX64.fullmatch(i['rawSha256']) or i['gitCommit']!=x['remoteHead'] or sha_file(ROOT/i['path'])!=i['rawSha256']:fail('file binding')
  seen.add(i['path'])
 if seen!=expected:fail('coverage')
def atomic_replace(path,raw):
 path.parent.mkdir(parents=True,exist_ok=True);fd,n=tempfile.mkstemp(prefix='.'+path.name+'.',suffix='.tmp',dir=path.parent);tmp=Path(n)
 try:
  with os.fdopen(fd,'wb') as h:h.write(raw);h.flush();os.fsync(h.fileno())
  os.replace(tmp,path)
 finally:tmp.unlink(missing_ok=True)
 if path.read_bytes()!=raw:fail('atomic readback')
def blob_write(raw):
 digest=sha(raw);p=PRIVATE/'blobs'/'sha256'/digest[:2]/digest;p.parent.mkdir(parents=True,exist_ok=True)
 if p.exists():
  if p.read_bytes()!=raw:fail('collision')
 else:
  fd,n=tempfile.mkstemp(prefix='.'+digest+'.',suffix='.tmp',dir=p.parent);tmp=Path(n)
  try:
   with os.fdopen(fd,'wb') as h:h.write(raw);h.flush();os.fsync(h.fileno())
   os.link(tmp,p)
  finally:tmp.unlink(missing_ok=True)
 if p.read_bytes()!=raw:fail('blob readback')
 return digest
def fresh_checkpoint(c,binding,dates,fields):
 x={'schema':'finra-q004-historical-checkpoint/v2','createdAt':datetime.now(timezone.utc).replace(microsecond=0).strftime('%Y-%m-%dT%H:%M:%SZ'),'contractRawSha256':sha_file(CONTRACT),'contractSha256':c['contractSha256'],'implementationBindings':binding,'datesSha256':sha(canonical(dates)),'fieldsSha256':sha(canonical(fields)),'completed':[],'totalResponseBytes':0,'totalRows':0,'outcomesAccessed':False};x['checkpointSha256']=sha(canonical(x));return x
def validate_partition_rows(rows,fields,day,ids,prior_ids):
 for row in rows:
  if not isinstance(row,dict) or set(row)!=set(fields) or row['calendarDay']!=day or not isinstance(row['OTCDailyListID'],int) or row['OTCDailyListID'] in ids or row['OTCDailyListID'] in prior_ids:fail('row')
  ids.add(row['OTCDailyListID'])
def validate_checkpoint(x,c,binding,dates,fields,deep=True):
 if set(x)!={'schema','createdAt','contractRawSha256','contractSha256','implementationBindings','datesSha256','fieldsSha256','completed','totalResponseBytes','totalRows','outcomesAccessed','checkpointSha256'}:fail('checkpoint keys')
 b=dict(x);claim=b.pop('checkpointSha256',None)
 if claim!=sha(canonical(b)) or x['schema']!='finra-q004-historical-checkpoint/v2' or x['contractRawSha256']!=sha_file(CONTRACT) or x['contractSha256']!=c['contractSha256'] or x['implementationBindings']!=binding or x['datesSha256']!=sha(canonical(dates)) or x['fieldsSha256']!=sha(canonical(fields)) or x['outcomesAccessed'] is not False or not isinstance(x['completed'],list):fail('checkpoint binding')
 seen=[];bytes_total=0;rows_total=0;global_ids=set()
 for item in x['completed']:
  if not isinstance(item,dict) or set(item)!={'calendarDay','recordTotal','pages','completedAt'} or item['calendarDay'] in seen or item['calendarDay'] not in dates or not isinstance(item['recordTotal'],int) or item['recordTotal']<0 or not isinstance(item['pages'],list):fail('checkpoint item')
  seen.append(item['calendarDay']);count=0;ids=set();expected_offset=0
  for page in item['pages']:
   if not isinstance(page,dict) or set(page)!={'offset','rowCount','rawSha256','bytes','requestSha256','headersSha256'} or page['offset']!=expected_offset or not isinstance(page['rowCount'],int) or page['rowCount']<0 or not HEX64.fullmatch(page['rawSha256']) or not isinstance(page['bytes'],int) or page['bytes']<=0 or not HEX64.fullmatch(page['requestSha256']) or not HEX64.fullmatch(page['headersSha256']):fail('checkpoint page')
   if deep:
    raw=(PRIVATE/'blobs'/'sha256'/page['rawSha256'][:2]/page['rawSha256']).read_bytes()
    if sha(raw)!=page['rawSha256'] or len(raw)!=page['bytes']:fail('prior blob')
    rows=json.loads(raw.decode());
    if len(rows)!=page['rowCount']:fail('prior row count')
    validate_partition_rows(rows,fields,item['calendarDay'],ids,global_ids)
   expected_offset+=page['rowCount'];count+=page['rowCount'];bytes_total+=page['bytes']
  if count!=item['recordTotal'] or (deep and len(ids)!=count):fail('partition count')
  global_ids.update(ids)
  rows_total+=count
 if seen!=dates[:len(seen)] or x['totalResponseBytes']!=bytes_total or x['totalRows']!=rows_total or x['totalResponseBytes']>=10000000000:fail('checkpoint totals/order')
 return seen,global_ids
def get_token():return pilot.token()
def page_request(access,day,fields,offset):
 payload={'fields':fields,'compareFilters':[{'compareType':'EQUAL','fieldName':'calendarDay','fieldValue':day}],'limit':5000,'offset':offset,'async':False};raw_payload=canonical(payload);req=request.Request(DATA,data=raw_payload,method='POST',headers={'Authorization':f'Bearer {access}','Accept':'application/json','Content-Type':'application/json','User-Agent':'GrowthScreener-Research/1.0 FINRA-Q004-historical'});op=request.build_opener(request.ProxyHandler({}),pilot.meta.NoRedirect())
 try:
  with op.open(req,timeout=60) as response:raw=response.read(3145729);status=response.status;headers={k.casefold():v.strip() for k,v in response.headers.items()}
 except error.HTTPError as e:
  if e.code==429:raise RateDeferred('RATE_DEFERRED')
  fail(f'HTTP {e.code}')
 except error.URLError as e:fail(f'transport {type(e.reason).__name__}')
 required={'content-type','record-limit','record-offset','record-total'}
 if status!=200 or len(raw)>3145728 or not required.issubset(headers) or headers['content-type'].split(';',1)[0].strip().casefold()!='application/json':fail('response')
 try:rows=json.loads(raw.decode())
 except Exception:fail('JSON')
 if not isinstance(rows,list):fail('rows')
 safe={k:headers[k] for k in ('content-type','record-limit','record-offset','record-total','record-max-limit','response-payload-max-size') if k in headers}
 return raw_payload,raw,rows,safe
def crawl(c):
 dates,fields=inputs();binding=snapshot()
 if CHECKPOINT.exists():cp=load(CHECKPOINT);_,global_ids=validate_checkpoint(cp,c,binding,dates,fields,True)
 else:cp=fresh_checkpoint(c,binding,dates,fields);atomic_replace(CHECKPOINT,canonical(cp)+b'\n');global_ids=set()
 completed={x['calendarDay'] for x in cp['completed']};access=get_token();last_request=0.0
 try:
  for day in dates:
   if day in completed:continue
   pages=[];offset=0;expected_total=None;ids=set()
   while expected_total is None or offset<expected_total:
    delay=2-(time.monotonic()-last_request)
    if delay>0:time.sleep(delay)
    payload,raw,rows,headers=page_request(access,day,fields,offset);last_request=time.monotonic()
    try:total=int(headers['record-total']);returned_offset=int(headers['record-offset']);limit=int(headers['record-limit'])
    except Exception:fail('headers')
    if returned_offset!=offset or not 0<limit<=5000 or expected_total not in (None,total):fail('pagination')
    expected_total=total
    if not rows and offset<total:fail('empty page before total')
    validate_partition_rows(rows,fields,day,ids,global_ids)
    digest=blob_write(raw);pages.append({'offset':offset,'rowCount':len(rows),'rawSha256':digest,'bytes':len(raw),'requestSha256':sha(payload),'headersSha256':sha(canonical(headers))});offset+=len(rows)
    if offset>total or (not rows and total==0):break
   if offset!=expected_total or len(ids)!=expected_total:fail('partition total')
   global_ids.update(ids)
   cp['completed'].append({'calendarDay':day,'recordTotal':expected_total,'pages':pages,'completedAt':datetime.now(timezone.utc).replace(microsecond=0).strftime('%Y-%m-%dT%H:%M:%SZ')});cp['totalResponseBytes']+=sum(x['bytes'] for x in pages);cp['totalRows']+=expected_total;cp.pop('checkpointSha256',None);cp['checkpointSha256']=sha(canonical(cp));validate_checkpoint(cp,c,binding,dates,fields,False);atomic_replace(CHECKPOINT,canonical(cp)+b'\n')
   print(json.dumps({'schema':'finra-q004-historical-progress/v2','completedPartitions':len(cp['completed']),'totalPartitions':len(dates),'totalRows':cp['totalRows'],'totalResponseBytes':cp['totalResponseBytes'],'outcomesAccessed':False},sort_keys=True),flush=True)
 finally:access=''
 return cp
def build_manifest(c,cp,dates,fields,rebuilds):
 pages=sum(len(x['pages']) for x in cp['completed']);r={'schema':'finra-q004-historical-crawl-manifest/v2','completedAt':datetime.now(timezone.utc).replace(microsecond=0).strftime('%Y-%m-%dT%H:%M:%SZ'),'track':c['track'],'taskId':c['taskId'],'sourceId':c['sourceId'],'contractRawSha256':sha_file(CONTRACT),'contractSha256':c['contractSha256'],'implementationBindings':cp['implementationBindings'],'coverage':{'requestedMinimumDate':'2009-01-01','requestedMaximumDate':'2024-12-31','availableMinimumDate':dates[0],'availableMaximumDate':dates[-1],'pre2016CoverageStatus':'UNRESOLVED_NOT_EXPOSED_BY_PARTITIONS_ENDPOINT','partitionCount':len(dates),'datesSha256':sha(canonical(dates))},'capture':{'pageCount':pages,'recordCount':cp['totalRows'],'rawResponseBytes':cp['totalResponseBytes'],'checkpointSha256':cp['checkpointSha256'],'allRowsPrivate':True,'rawRowsIncluded':False},'privateRebuilds':rebuilds,'outcomesAccessed':False,'claimLocks':c['claimLocks']};r['reportSha256']=sha(canonical(r));return r
def validate_manifest(r,c):
 if set(r)!={'schema','completedAt','track','taskId','sourceId','contractRawSha256','contractSha256','implementationBindings','coverage','capture','privateRebuilds','outcomesAccessed','claimLocks','reportSha256'}:fail('manifest keys')
 b=dict(r);claim=b.pop('reportSha256',None)
 if claim!=sha(canonical(b)) or r['schema']!='finra-q004-historical-crawl-manifest/v2' or r['contractRawSha256']!=sha_file(CONTRACT) or r['contractSha256']!=c['contractSha256']:fail('manifest binding')
 binding_ok(r['implementationBindings']);dates,_=inputs()
 if r['coverage']!={'requestedMinimumDate':'2009-01-01','requestedMaximumDate':'2024-12-31','availableMinimumDate':dates[0],'availableMaximumDate':dates[-1],'pre2016CoverageStatus':'UNRESOLVED_NOT_EXPOSED_BY_PARTITIONS_ENDPOINT','partitionCount':1522,'datesSha256':DATES_SHA}:fail('manifest coverage')
 if not isinstance(r['capture'],dict) or set(r['capture'])!={'pageCount','recordCount','rawResponseBytes','checkpointSha256','allRowsPrivate','rawRowsIncluded'} or r['capture']['pageCount']<1522 or r['capture']['recordCount']<0 or not 0<r['capture']['rawResponseBytes']<10000000000 or not HEX64.fullmatch(r['capture']['checkpointSha256']) or r['capture']['allRowsPrivate'] is not True or r['capture']['rawRowsIncluded'] is not False:fail('manifest capture')
 if r['privateRebuilds']!=[{'runId':'REBUILD_NORMAL','status':'PASS'},{'runId':'REBUILD_OPTIMIZED','status':'PASS'}] or r['outcomesAccessed'] is not False or r['claimLocks']!=c['claimLocks'] or any(r['claimLocks'].values()):fail('manifest locks')
def write_new(p,raw):
 if p.exists():fail('output exists')
 p.parent.mkdir(parents=True,exist_ok=True);fd,n=tempfile.mkstemp(prefix='.'+p.name+'.',suffix='.tmp',dir=p.parent);tmp=Path(n)
 try:
  with os.fdopen(fd,'wb') as h:h.write(raw);h.flush();os.fsync(h.fileno())
  os.link(tmp,p)
 finally:tmp.unlink(missing_ok=True)
 if p.read_bytes()!=raw:fail('write')
def self_test(c):
 dates=['2024-01-02'];fields=['OTCDailyListID','calendarDay'];binding={'remoteName':REMOTE,'remoteBranch':BRANCH,'remoteHead':'a'*40,'files':[]};cp=fresh_checkpoint(c,binding,dates,fields);cp['completed']=[{'calendarDay':dates[0],'recordTotal':1,'pages':[{'offset':0,'rowCount':1,'rawSha256':'0'*64,'bytes':10,'requestSha256':'1'*64,'headersSha256':'2'*64}],'completedAt':'2026-08-12T19:34:00Z'}];cp['totalResponseBytes']=10;cp['totalRows']=1;cp.pop('checkpointSha256');cp['checkpointSha256']=sha(canonical(cp));kills={}
 for n,mut in [('gap',lambda x:x['completed'][0]['pages'][0].__setitem__('offset',1)),('wrongTotal',lambda x:x.__setitem__('totalRows',2)),('outcome',lambda x:x.__setitem__('outcomesAccessed',True))]:
  y=json.loads(json.dumps(cp));mut(y);y.pop('checkpointSha256');y['checkpointSha256']=sha(canonical(y))
  try:validate_checkpoint(y,c,binding,dates,fields,False);kills[n]=False
  except StudyError:kills[n]=True
 try:
  validate_partition_rows([{'OTCDailyListID':7,'calendarDay':'2024-01-03'}],fields,'2024-01-03',set(),{7});kills['crossPartitionDuplicate']=False
 except StudyError:kills['crossPartitionDuplicate']=True
 if not all(kills.values()):fail('fixture')
 return {'schema':'finra-q004-historical-self-test/v2','status':'PASS','kills':kills,'outcomesAccessed':False}
def main():
 p=argparse.ArgumentParser();p.add_argument('command',choices=('verify-contract','self-test','crawl','finalize','verify-output','status'));p.add_argument('--output');a=p.parse_args()
 try:
  c=validate_contract()
  if a.command=='verify-contract':print(json.dumps({'schema':'finra-q004-historical-contract-verification/v2','status':'PASS','contractSha256':c['contractSha256'],'outcomesAccessed':False},sort_keys=True))
  elif a.command=='self-test':print(json.dumps(self_test(c),sort_keys=True))
  elif a.command=='status':
   dates,fields=inputs();binding=snapshot();cp=load(CHECKPOINT) if CHECKPOINT.exists() else fresh_checkpoint(c,binding,dates,fields);validate_checkpoint(cp,c,binding,dates,fields,False);print(json.dumps({'schema':'finra-q004-historical-status/v1','completedPartitions':len(cp['completed']),'totalPartitions':len(dates),'totalRows':cp['totalRows'],'totalResponseBytes':cp['totalResponseBytes'],'outcomesAccessed':False},sort_keys=True))
  elif a.command=='crawl':crawl(c)
  elif a.command=='finalize':
   if a.output is None or Path(a.output).resolve()!=OUTPUT.resolve():fail('path')
   dates,fields=inputs();binding=snapshot();cp=load(CHECKPOINT);validate_checkpoint(cp,c,binding,dates,fields,True)
   if len(cp['completed'])!=len(dates):fail('incomplete')
   validate_checkpoint(cp,c,binding,dates,fields,True);rebuilds=[{'runId':'REBUILD_NORMAL','status':'PASS'},{'runId':'REBUILD_OPTIMIZED','status':'PASS'}];r=build_manifest(c,cp,dates,fields,rebuilds);validate_manifest(r,c);out=canonical(r)+b'\n';write_new(OUTPUT,out);print(json.dumps({'schema':'finra-q004-historical-finalize/v2','status':'PASS','output':OUTPUT.relative_to(ROOT).as_posix(),'rawSha256':sha(out),'reportSha256':r['reportSha256'],'recordCount':cp['totalRows'],'outcomesAccessed':False},sort_keys=True))
  else:
   if a.output is None or Path(a.output).resolve()!=OUTPUT.resolve():fail('path')
   r=load(OUTPUT);validate_manifest(r,c);out=canonical(r)+b'\n'
   if OUTPUT.read_bytes()!=out:fail('canonical')
   dates,fields=inputs();cp=load(CHECKPOINT);validate_checkpoint(cp,c,r['implementationBindings'],dates,fields,True)
   if cp['checkpointSha256']!=r['capture']['checkpointSha256'] or cp['totalRows']!=r['capture']['recordCount']:fail('rebuild mismatch')
   print(json.dumps({'schema':'finra-q004-historical-output-verification/v2','status':'PASS','rawSha256':sha(out),'reportSha256':r['reportSha256'],'privateCasVerified':True,'recordCount':cp['totalRows'],'outcomesAccessed':False},sort_keys=True))
  return 0
 except RateDeferred:
  print('RATE_DEFERRED',file=sys.stderr);return 75
 except Exception as e:
  print(f'StudyError: {type(e).__name__}',file=sys.stderr);return 1
if __name__=='__main__':raise SystemExit(main())
