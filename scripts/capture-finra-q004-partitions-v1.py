#!/usr/bin/env python3
"""Capture FINRA OTC Daily List partitions and publish only the frozen date queue."""
from __future__ import annotations
import argparse,hashlib,importlib.util,json,os,re,subprocess,sys,tempfile
from datetime import date,datetime,timezone
from pathlib import Path
from urllib import error,request
ROOT=Path(__file__).resolve().parents[1];CONTRACT=ROOT/'research'/'early-detection-v4'/'finra-q004-partitions-contract-v1.json';TEST=ROOT/'tests'/'capture-finra-q004-partitions-v1.test.js';OUTPUT=ROOT/'reports'/'early-detection'/'finra-q004-partitions-2009-2024-v1.json';PILOT_SCRIPT=ROOT/'scripts'/'run-finra-q004-single-day-pilot-v2.py';PILOT_OUTPUT=ROOT/'reports'/'early-detection'/'finra-q004-single-day-pilot-v2.json';CAS=Path(r'C:\Users\Anwender\Documents\GrowthScreenerResearchData\private-evidence\finra-q004\partitions')
PARENT='43626dd3e3f3ab9d60da44065c7345f653d1c492';REMOTE='origin';BRANCH='codex/early-detection-v4-gates-20260810';REMOTE_URL='https://github.com/Karlryl/screener-data.git';PILOT_SCRIPT_SHA='0e08a44a9a75616a15407eb7b5682eed1a663168f39ed69ca5b9bed0492ca22f';PILOT_OUTPUT_SHA='1c51bd9e8776d73863bc9be9d9a16aae953724b1c12fbcf5a61696e3eeb264fe';URL='https://api.finra.org/partitions/group/otcMarket/name/otcDailyList';MIN='2009-01-01';MAX='2024-12-31';HEX64=re.compile(r'^[0-9a-f]{64}$');HEX40=re.compile(r'^[0-9a-f]{40}$');DATE=re.compile(r'^\d{4}-\d{2}-\d{2}$')
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
 if p.returncode:fail('git')
 return p.stdout if binary else p.stdout.decode().strip()
def utc(x):
 try:return datetime.strptime(x,'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
 except Exception:fail('time')
def validate_contract():
 x=load(CONTRACT);b=dict(x);claim=b.pop('contractSha256',None)
 if claim!=sha(canonical(b)) or not isinstance(claim,str) or not HEX64.fullmatch(claim):fail('contract hash')
 if set(x)!={'schema','createdAt','track','taskId','sourceId','purpose','authorization','requestContract','queueContract','privateCas','outputContract','claimLocks','contractSha256'}:fail('keys')
 if x['schema']!='finra-q004-partitions-contract/v1' or x['track']!='SHARED_OUTCOME_BLIND_INFRA' or x['taskId']!='Q004-FINRA-OTC-CATALOG' or x['sourceId']!='FINRA_OTC_PRIMARY':fail('boundary')
 if x['authorization']!={'parentRemoteCommit':PARENT,'singleDayPilotPath':'reports/early-detection/finra-q004-single-day-pilot-v2.json','singleDayPilotRawSha256':PILOT_OUTPUT_SHA,'credentialType':'PUBLIC','monthlyFeeUsd':0} or sha_file(PILOT_SCRIPT)!=PILOT_SCRIPT_SHA or sha_file(PILOT_OUTPUT)!=PILOT_OUTPUT_SHA:fail('authorization')
 if x['requestContract']!={'method':'GET','url':URL,'requests':1,'credentialsSent':False,'redirectsAllowed':False,'environmentProxyUseAllowed':False,'retryAllowed':False,'maximumResponseBytes':2097152}:fail('request')
 if x['queueContract']!={'partitionField':'calendarDay','minimumDate':MIN,'maximumDate':MAX,'datesSortedAscending':True,'datesUnique':True,'liveOrPost2024DatesIncluded':False,'emptyCalendarDaysQueried':False}:fail('queue')
 if x['privateCas']!={'root':CAS.as_posix(),'pathTemplate':'sha256/{sha256[0:2]}/{sha256}','outsideGitRequired':True,'writeNewOnly':True} or x['outputContract']!={'path':'reports/early-detection/finra-q004-partitions-2009-2024-v1.json','rawResponseIncluded':False,'partitionDatesIncluded':True,'recordValuesIncluded':False,'outcomesAccessed':False} or any(x['claimLocks'].values()) or utc(x['createdAt'])>datetime.now(timezone.utc):fail('CAS/output/locks/time')
 return x
if sha_file(PILOT_SCRIPT)!=PILOT_SCRIPT_SHA:fail('helper changed')
spec=importlib.util.spec_from_file_location('finra_pilot_pinned',PILOT_SCRIPT);pilot=importlib.util.module_from_spec(spec);spec.loader.exec_module(pilot)
def snapshot():
 head=git('rev-parse','HEAD');parts=git('ls-remote',REMOTE,f'refs/heads/{BRANCH}').split();remote=parts[0] if parts else ''
 if head!=git('rev-parse','@{upstream}') or head!=remote or git('remote','get-url',REMOTE)!=REMOTE_URL or git('rev-list','--parents','-n','1',head).split()[1:]!=[PARENT]:fail('remote')
 if utc(load(CONTRACT)['createdAt'])>datetime.fromtimestamp(int(git('show','-s','--format=%ct',head)),timezone.utc):fail('timeline')
 files=[]
 for p in (CONTRACT,Path(__file__).resolve(),TEST,PILOT_SCRIPT,PILOT_OUTPUT):
  rel=p.relative_to(ROOT).as_posix();raw=p.read_bytes()
  if git('show',f'{head}:{rel}',binary=True)!=raw:fail('blob')
  files.append({'path':rel,'rawSha256':sha(raw),'gitCommit':head})
 return {'remoteName':REMOTE,'remoteBranch':BRANCH,'remoteHead':head,'files':files}
def binding_ok(x):
 if not isinstance(x,dict) or set(x)!={'remoteName','remoteBranch','remoteHead','files'} or x['remoteName']!=REMOTE or x['remoteBranch']!=BRANCH or not HEX40.fullmatch(x['remoteHead']):fail('binding')
 expected={p.relative_to(ROOT).as_posix() for p in (CONTRACT,Path(__file__).resolve(),TEST,PILOT_SCRIPT,PILOT_OUTPUT)};seen=set()
 for i in x['files']:
  if not isinstance(i,dict) or set(i)!={'path','rawSha256','gitCommit'} or i['path'] in seen or i['path'] not in expected or not HEX64.fullmatch(i['rawSha256']) or i['gitCommit']!=x['remoteHead'] or sha_file(ROOT/i['path'])!=i['rawSha256']:fail('file binding')
  seen.add(i['path'])
 if seen!=expected:fail('coverage')
def fetch():
 req=request.Request(URL,method='GET',headers={'Accept':'application/json','User-Agent':'GrowthScreener-Research/1.0 FINRA-Q004-partitions'});op=request.build_opener(request.ProxyHandler({}),pilot.meta.NoRedirect())
 try:
  with op.open(req,timeout=30) as response:raw=response.read(2097153);status=response.status;ctype=response.headers.get('Content-Type','').split(';',1)[0].strip().casefold()
 except error.HTTPError as e:fail(f'HTTP {e.code}')
 except error.URLError as e:fail(f'transport {type(e.reason).__name__}')
 if status!=200 or len(raw)>2097152 or ctype!='application/json':fail('response')
 try:value=json.loads(raw.decode())
 except Exception:fail('JSON')
 return raw,value,ctype
def validate_partitions(v):
 if not isinstance(v,dict) or set(v)!={'datasetGroup','datasetName','partitionFields','availablePartitions'} or v['datasetGroup'].casefold()!='otcmarket' or v['datasetName'].casefold()!='otcdailylist' or v['partitionFields']!=['calendarDay'] or not isinstance(v['availablePartitions'],list):fail('schema')
 all_dates=[]
 for row in v['availablePartitions']:
  if not isinstance(row,dict) or set(row)!={'partitions'} or not isinstance(row['partitions'],list) or len(row['partitions'])!=1 or not isinstance(row['partitions'][0],str) or not DATE.fullmatch(row['partitions'][0]):fail('row')
  try:date.fromisoformat(row['partitions'][0])
  except Exception:fail('date')
  all_dates.append(row['partitions'][0])
 if len(all_dates)!=len(set(all_dates)):fail('duplicate')
 selected=sorted(x for x in all_dates if MIN<=x<=MAX)
 if not selected or MIN>selected[0] or selected[-1]>MAX:fail('range')
 return all_dates,selected
def cas_write(raw):
 digest=sha(raw);p=CAS/'sha256'/digest[:2]/digest;p.parent.mkdir(parents=True,exist_ok=True)
 if p.exists():
  if p.read_bytes()!=raw:fail('collision')
 else:
  fd,n=tempfile.mkstemp(prefix='.'+digest+'.',suffix='.tmp',dir=p.parent);tmp=Path(n)
  try:
   with os.fdopen(fd,'wb') as h:h.write(raw);h.flush();os.fsync(h.fileno())
   os.link(tmp,p)
  finally:tmp.unlink(missing_ok=True)
 if p.read_bytes()!=raw:fail('readback')
 return digest
def build(c,binding,raw,all_dates,selected,ctype,at):
 r={'schema':'finra-q004-partitions-2009-2024/v1','capturedAt':at,'track':c['track'],'taskId':c['taskId'],'sourceId':c['sourceId'],'contractRawSha256':sha_file(CONTRACT),'contractSha256':c['contractSha256'],'singleDayPilotRawSha256':PILOT_OUTPUT_SHA,'implementationBindings':binding,'responseEvidence':{'httpStatus':200,'contentType':ctype,'rawSha256':sha(raw),'bytes':len(raw),'privateCasRelativePath':f'sha256/{sha(raw)[:2]}/{sha(raw)}','rawResponseIncluded':False},'queue':{'partitionField':'calendarDay','minimumDate':MIN,'maximumDate':MAX,'sourcePartitionCount':len(all_dates),'selectedPartitionCount':len(selected),'dates':selected,'datesSha256':sha(canonical(selected))},'recordValuesIncluded':False,'outcomesAccessed':False,'claimLocks':c['claimLocks']};r['reportSha256']=sha(canonical(r));return r
def validate_report(r,c):
 if set(r)!={'schema','capturedAt','track','taskId','sourceId','contractRawSha256','contractSha256','singleDayPilotRawSha256','implementationBindings','responseEvidence','queue','recordValuesIncluded','outcomesAccessed','claimLocks','reportSha256'}:fail('report keys')
 b=dict(r);claim=b.pop('reportSha256',None)
 if claim!=sha(canonical(b)) or r['schema']!='finra-q004-partitions-2009-2024/v1' or r['contractRawSha256']!=sha_file(CONTRACT) or r['contractSha256']!=c['contractSha256'] or r['singleDayPilotRawSha256']!=PILOT_OUTPUT_SHA or utc(c['createdAt'])>utc(r['capturedAt']):fail('report binding')
 binding_ok(r['implementationBindings']);e=r['responseEvidence']
 if not isinstance(e,dict) or set(e)!={'httpStatus','contentType','rawSha256','bytes','privateCasRelativePath','rawResponseIncluded'} or e['httpStatus']!=200 or e['contentType']!='application/json' or not HEX64.fullmatch(e['rawSha256']) or not isinstance(e['bytes'],int) or not 0<e['bytes']<=2097152 or e['privateCasRelativePath']!=f"sha256/{e['rawSha256'][:2]}/{e['rawSha256']}" or e['rawResponseIncluded'] is not False:fail('evidence')
 q=r['queue']
 if not isinstance(q,dict) or set(q)!={'partitionField','minimumDate','maximumDate','sourcePartitionCount','selectedPartitionCount','dates','datesSha256'} or q['partitionField']!='calendarDay' or q['minimumDate']!=MIN or q['maximumDate']!=MAX or not isinstance(q['dates'],list) or q['dates']!=sorted(set(q['dates'])) or q['selectedPartitionCount']!=len(q['dates']) or q['sourcePartitionCount']<q['selectedPartitionCount'] or q['datesSha256']!=sha(canonical(q['dates'])) or any(not isinstance(x,str) or not DATE.fullmatch(x) or not MIN<=x<=MAX for x in q['dates']):fail('queue')
 if r['recordValuesIncluded'] is not False or r['outcomesAccessed'] is not False or r['claimLocks']!=c['claimLocks'] or any(r['claimLocks'].values()):fail('locks')
def write_new(p,raw):
 if p.exists():fail('exists')
 p.parent.mkdir(parents=True,exist_ok=True);fd,n=tempfile.mkstemp(prefix='.'+p.name+'.',suffix='.tmp',dir=p.parent);tmp=Path(n)
 try:
  with os.fdopen(fd,'wb') as h:h.write(raw);h.flush();os.fsync(h.fileno())
  os.link(tmp,p)
 finally:tmp.unlink(missing_ok=True)
 if p.read_bytes()!=raw:fail('write')
def remote_output(r):
 b=r['implementationBindings'];head=git('rev-parse','HEAD');parts=git('ls-remote',REMOTE,f'refs/heads/{BRANCH}').split();remote=parts[0] if parts else ''
 if head!=git('rev-parse','@{upstream}') or head!=remote or git('remote','get-url',REMOTE)!=REMOTE_URL or git('rev-list','--parents','-n','1',head).split()[1:]!=[b['remoteHead']] or git('diff-tree','--no-commit-id','--name-only','-r',head).splitlines()!=[OUTPUT.relative_to(ROOT).as_posix()] or git('show',f"{head}:{OUTPUT.relative_to(ROOT).as_posix()}",binary=True)!=OUTPUT.read_bytes():fail('remote output')
 for i in b['files']:
  if git('show',f"{b['remoteHead']}:{i['path']}",binary=True)!=(ROOT/i['path']).read_bytes():fail('blob')
def self_test(c):
 fixture={'datasetGroup':'otcMarket','datasetName':'otcDailyList','partitionFields':['calendarDay'],'availablePartitions':[{'partitions':['2024-12-31']},{'partitions':['2018-12-18']},{'partitions':['2008-12-31']}]};all_dates,selected=validate_partitions(fixture);kills={}
 for n,mut in [('duplicate',lambda x:x['availablePartitions'].append({'partitions':['2018-12-18']})),('invalidDate',lambda x:x['availablePartitions'][0].__setitem__('partitions',['2024-02-31'])),('extraField',lambda x:x.__setitem__('price',1))]:
  x=json.loads(json.dumps(fixture));mut(x)
  try:validate_partitions(x);kills[n]=False
  except StudyError:kills[n]=True
 if not all(kills.values()) or selected!=['2018-12-18','2024-12-31']:fail('fixture')
 return {'schema':'finra-q004-partitions-self-test/v1','status':'PASS','kills':kills,'outcomesAccessed':False}
def main():
 p=argparse.ArgumentParser();p.add_argument('command',choices=('verify-contract','self-test','capture','verify-output'));p.add_argument('--output');p.add_argument('--remote',action='store_true');a=p.parse_args()
 try:
  c=validate_contract()
  if a.command=='verify-contract':print(json.dumps({'schema':'finra-q004-partitions-contract-verification/v1','status':'PASS','contractSha256':c['contractSha256'],'outcomesAccessed':False},sort_keys=True))
  elif a.command=='self-test':print(json.dumps(self_test(c),sort_keys=True))
  elif a.command=='capture':
   if a.output is None or Path(a.output).resolve()!=OUTPUT.resolve():fail('path')
   before=snapshot();raw,v,ctype=fetch();all_dates,selected=validate_partitions(v);after=snapshot()
   if before!=after:fail('drift')
   digest=cas_write(raw);at=datetime.now(timezone.utc).replace(microsecond=0).strftime('%Y-%m-%dT%H:%M:%SZ');r=build(c,after,raw,all_dates,selected,ctype,at);validate_report(r,c);out=canonical(r)+b'\n';write_new(OUTPUT,out);print(json.dumps({'schema':'finra-q004-partitions-write-result/v1','status':'PASS','output':OUTPUT.relative_to(ROOT).as_posix(),'rawSha256':sha(out),'reportSha256':r['reportSha256'],'privateResponseSha256':digest,'selectedPartitionCount':len(selected),'outcomesAccessed':False},sort_keys=True))
  else:
   if a.output is None or Path(a.output).resolve()!=OUTPUT.resolve():fail('path')
   r=load(OUTPUT);validate_report(r,c);out=canonical(r)+b'\n'
   if OUTPUT.read_bytes()!=out:fail('canonical')
   raw=(CAS/r['responseEvidence']['privateCasRelativePath']).read_bytes()
   if sha(raw)!=r['responseEvidence']['rawSha256'] or len(raw)!=r['responseEvidence']['bytes']:fail('CAS')
   all_dates,selected=validate_partitions(json.loads(raw.decode()))
   if selected!=r['queue']['dates'] or len(all_dates)!=r['queue']['sourcePartitionCount']:fail('reparse')
   if a.remote:remote_output(r)
   print(json.dumps({'schema':'finra-q004-partitions-output-verification/v1','status':'PASS','rawSha256':sha(out),'reportSha256':r['reportSha256'],'privateCasVerified':True,'remoteVerified':a.remote,'selectedPartitionCount':len(selected),'outcomesAccessed':False},sort_keys=True))
  return 0
 except Exception as e:
  print(f'StudyError: {type(e).__name__}',file=sys.stderr);return 1
if __name__=='__main__':raise SystemExit(main())
