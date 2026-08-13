#!/usr/bin/env python3
"""Resume private SEC capture with a generic append-only transport incident journal."""
from __future__ import annotations
import argparse,copy,datetime,hashlib,http.client,importlib.util,json,re,subprocess,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];CONTRACT=ROOT/'research'/'early-detection-v4'/'sec-liquidation-late-periodic-filing-capture-contract-v3.json';RUNNER=Path(__file__).resolve();TEST=ROOT/'tests'/'capture-sec-liquidation-late-periodic-filings-v3.test.js';V1=ROOT/'scripts'/'capture-sec-liquidation-late-periodic-filings-v1.py';V2=ROOT/'scripts'/'capture-sec-liquidation-late-periodic-filings-v2.py';NETWORK=ROOT/'scripts'/'capture-sec-liquidation-downstream-filings-v1.py';OWNED=(CONTRACT,RUNNER,TEST)
CONTRACT_RAW='e50cfdc212304a0fc1b2542fe8b006542f24fb1e6a5ca2197c7e1eb1091c034b'
CONTRACT_SELF='b0c02a2a3116729350370c3cb0fc6ec076bd54857614f2a691ef51f9921279ac'
TEST_RAW='ef06cee233d1558b760a8dcf8bc0f2e8df480368cbaa6927205d543054c719f7'
BASE='00e55a5cc1da8c22f54932429d5c5e5101f79dbd';REMOTE='https://github.com/Karlryl/screener-data.git';REF='refs/heads/codex/early-detection-v4-gates-20260810';CREATED_AT='2026-08-13T15:58:58Z';V1_RAW='e74ddc95a579b00a294c29dc96c76dde27e5e83b73cd9d116cfafe89454ea558';V2_RAW='f9aec46392af94d331b0e6b787def1272a0b7e1acd189f0812678d2a6292ccff';NETWORK_RAW='4e36f022144f31defc129ec059b717a9c4a219cc49c15905ab584f5c5e9ce7d7'
PURPOSE='Resume the exact private late-periodic capture from request sequence 66 with a generic append-only incident journal for every future transport failure, preserving sixty-three accepted receipts and two failed request events while accepting zero partial bytes and granting zero scientific credit.'
INCIDENT65={'requestSequence':65,'candidateId':'SEC-LIQ-LATE-PERIODIC-1b1fa397ae21ce197c543c60ee1ff156353fa2e9889e4a333cd9bcea7e7534c3','accession':'0001193125-18-260754','filedDate':'2018-08-28','form':'N-CSR','exceptionKind':'TRANSPORT_EXCEPTION_CAUGHT_BY_V2','partialBytesReportedByException':None,'acceptedRawBytes':0,'partialBytesPersisted':False,'contentInspected':False,'scientificCredit':False,'outcomesAccessed':False}
LOCKS={'contentInterpretationPerformed':False,'sameSecurityVerified':False,'securityIdentityResolved':False,'additionalDistributionVerified':False,'noFurtherPaymentsVerified':False,'laterRecoveriesExcluded':False,'completeCorporateActionChainVerified':False,'terminalWealthComplete':False,'originalV4GateCredit':False,'resultComputationAllowed':False,'pricesAccessed':False,'returnsAccessed':False,'outcomesAccessed':False}
class E(RuntimeError):pass
def fail(x):raise E(x)
def sha(x):return hashlib.sha256(x).hexdigest()
def canonical(x):return json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
def self_hash(x,f):y=dict(x);y.pop(f,None);return sha(canonical(y))
def exact(x,k,l):
 if type(x) is not dict or set(x)!=set(k):fail(l+' keys changed')
def normalized(raw):
 s=raw.decode().replace('\r\n','\n')
 for n in ('CONTRACT_RAW','CONTRACT_SELF','TEST_RAW'):
  p=re.compile(rf"^{n}='[0-9a-f]{{64}}'",re.M)
  if len(p.findall(s))!=1:fail(n+' normalization')
  s=p.sub(f"{n}='{'0'*64}'",s)
 return s.encode()
def git(*a):
 r=subprocess.run(['git',*a],cwd=ROOT,capture_output=True,text=True)
 if r.returncode:fail(r.stderr.strip() or 'git failed')
 return r.stdout.strip()
def git_raw(c,p):
 r=subprocess.run(['git','show',f'{c}:{p.relative_to(ROOT).as_posix()}'],cwd=ROOT,capture_output=True)
 if r.returncode:fail('Git blob unavailable')
 return r.stdout
def module(name,p,expected,head):
 raw=p.read_bytes()
 if sha(raw)!=expected or git_raw(head,p)!=raw:fail(name+' bytes changed')
 s=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def incident_record(body):x={'schema':'sec-liquidation-late-periodic-private-transport-incident/v1',**body,'incidentSha256':''};x['incidentSha256']=self_hash(x,'incidentSha256');return x
def incident_path(v1,x):return v1.PRIVATE/'incidents'/'sha256'/x['incidentSha256'][:2]/f"{x['incidentSha256']}.json"
def incident_records(v1):
 out=[]
 for p in (v1.PRIVATE/'incidents'/'sha256').glob('*/*.json'):
  raw=p.read_bytes();x=json.loads(raw);exact(x,{'schema','requestSequence','candidateId','accession','filedDate','form','exceptionKind','partialBytesReportedByException','acceptedRawBytes','partialBytesPersisted','contentInspected','scientificCredit','outcomesAccessed','incidentSha256'},'incident')
  if x['schema']!='sec-liquidation-late-periodic-private-transport-incident/v1' or x['acceptedRawBytes']!=0 or x['partialBytesPersisted'] is not False or x['contentInspected'] is not False or x['scientificCredit'] is not False or x['outcomesAccessed'] is not False or x['incidentSha256']!=self_hash(x,'incidentSha256') or p!=incident_path(v1,x):fail('incident changed')
  out.append(x)
 return sorted(out,key=lambda x:x['requestSequence'])
def validate_contract(v):
 exact(v,{'schema','createdAt','taskId','track','purpose','inputs','observedPreSealState','unrecordedObservedIncident','resumeContract','claimLocks','implementationContract','contractSha256'},'contract')
 if (v['schema'],v['createdAt'],v['taskId'],v['track'],v['purpose'])!=('sec-liquidation-late-periodic-filing-capture-contract/v3',CREATED_AT,'Q003-SEC-LIQUIDATION-LATE-PERIODIC-FILING-CAPTURE-JOURNALED-RESUME','SHARED_OUTCOME_BLIND_INFRA',PURPOSE):fail('identity changed')
 try:created=datetime.datetime.strptime(v['createdAt'],'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=datetime.timezone.utc)
 except ValueError:fail('createdAt changed')
 if created>datetime.datetime.now(datetime.timezone.utc):fail('createdAt future')
 inp={'v1CaptureRunner':{'path':V1.relative_to(ROOT).as_posix(),'rawSha256':V1_RAW},'v2ResumeRunner':{'path':V2.relative_to(ROOT).as_posix(),'rawSha256':V2_RAW,'introductionCommit':BASE},'networkImplementation':{'path':NETWORK.relative_to(ROOT).as_posix(),'rawSha256':NETWORK_RAW}}
 pre={'acceptedReceipts':63,'remainingCandidates':59,'lastAcceptedRequestSequence':64,'lastAcceptedReceiptSha256':'0aa9251389cff1944313c9e4d57192130193d16b9f2fb13265410fa4a2b30520','recordedIncidentCount':1,'recordedIncidentSha256':'9bc024f539262297d524ee019083217b860a1353abebb2967730157b8d755119'}
 resume={'candidateFilings':122,'privateRoot':r'C:\Users\Anwender\Documents\GrowthScreenerResearchData\early-detection-v4\liquidation-late-periodic-sec-originals-v1','incidentLayout':'incidents/sha256/<first2>/<incidentRawSha256>.json','maximumNewRequestsPerRun':59,'automaticRetryCount':0,'nextRequestSequence':66,'everyAttemptMustConsumeOneSequence':True,'everyTransportFailureMustPersistIncident':True,'rateDeferredStopsRun':True,'transportIncidentStopsRun':True,'existingBytesMustMatch':True,'atomicWriteNew':True,'publicRawBytesAllowed':False}
 if v['inputs']!=inp or v['observedPreSealState']!=pre or v['unrecordedObservedIncident']!=INCIDENT65 or v['resumeContract']!=resume or v['claimLocks']!=LOCKS:fail('inputs state incident resume or locks changed')
 impl={'baseCommit':BASE,'baseTag':903,'remote':REMOTE,'ref':REF,'contractPath':CONTRACT.relative_to(ROOT).as_posix(),'runnerPath':RUNNER.relative_to(ROOT).as_posix(),'testPath':TEST.relative_to(ROOT).as_posix(),'runnerNormalizedSha256':sha(normalized(RUNNER.read_bytes())),'testRawSha256':TEST_RAW,'introductionMustBeDirectSingleParentChildOfBase':True,'introductionAddsExactlyThreeOwnedPaths':True,'productionResumeRequiresPostIntroductionRemoteVerification':True,'dryRunMustUseZeroNetworkAndZeroWrites':True}
 if v['implementationContract']!=impl:fail('implementation changed')
 if v['contractSha256']!=CONTRACT_SELF or self_hash(v,'contractSha256')!=CONTRACT_SELF:fail('self hash')
def load_contract():
 raw=CONTRACT.read_bytes()
 if sha(raw)!=CONTRACT_RAW:fail('contract raw changed')
 v=json.loads(raw);validate_contract(v);return v
def changed(c):o=git('diff-tree','--no-commit-id','--name-status','-r',c);return [tuple(x.split('\t',1)) for x in o.splitlines() if x]
def intro(p):o=git('log','--reverse','--format=%H','--diff-filter=A',f'{BASE}..HEAD','--',p.relative_to(ROOT).as_posix());return o.splitlines() if o else []
def verify_repo(remote):
 if not remote:fail('live remote mandatory')
 head=git('rev-parse','HEAD')
 if git('remote','get-url','origin')!=REMOTE or git('rev-parse','@{u}')!=head or git('ls-remote','--refs','origin',REF).split()!=[head,REF]:fail('remote differs')
 xs=[intro(p) for p in OWNED]
 if all(not x for x in xs):
  if head!=BASE:fail('pre introduction moved')
  return {'phase':'PRE_INTRODUCTION','introductionCommit':None,'remoteVerified':True,'resumeAuthorized':False}
 if any(len(x)!=1 for x in xs) or len({x[0] for x in xs})!=1:fail('introduction split')
 i=xs[0][0]
 if git('show','-s','--format=%P',i).split()!=[BASE] or changed(i)!=[('A',p.relative_to(ROOT).as_posix()) for p in OWNED]:fail('introduction changed')
 for p in OWNED:
  if git_raw(i,p)!=p.read_bytes() or git_raw(head,p)!=p.read_bytes():fail('owned bytes changed')
 return {'phase':'POST_INTRODUCTION','introductionCommit':i,'remoteVerified':True,'resumeAuthorized':True}
def load_state():
 head=git('rev-parse','HEAD');v1=module('sealed_v1',V1,V1_RAW,head);v2=module('sealed_v2',V2,V2_RAW,head);n,c,l=v1.load_inputs(head);rs=v1.receipts(n,c);incs=incident_records(v1)
 if len(rs)!=63 or rs[-1]['requestSequence']!=64 or rs[-1]['receiptSha256']!='0aa9251389cff1944313c9e4d57192130193d16b9f2fb13265410fa4a2b30520':fail('accepted state changed')
 if len(incs)!=1 or incs[0]['incidentSha256']!='9bc024f539262297d524ee019083217b860a1353abebb2967730157b8d755119':fail('incident state changed')
 return v1,n,c,l,rs,incs
def persist_incident(v1,n,body):
 x=incident_record(body);n.atomic_create(incident_path(v1,x),n.encode_json(x));return x
def reseal(v):x=copy.deepcopy(v);x['contractSha256']=self_hash(x,'contractSha256');return x
def rejected(f):
 try:f()
 except (E,KeyError,TypeError,ValueError,OSError,json.JSONDecodeError):return True
 return False
def self_test(v):
 ms={'purpose':lambda x:x.__setitem__('purpose','silent retry'),'accepted':lambda x:x['observedPreSealState'].__setitem__('acceptedReceipts',64),'unknownBytes':lambda x:x['unrecordedObservedIncident'].__setitem__('partialBytesReportedByException',1),'credit':lambda x:x['unrecordedObservedIncident'].__setitem__('scientificCredit',True),'retry':lambda x:x['resumeContract'].__setitem__('automaticRetryCount',1),'journal':lambda x:x['resumeContract'].__setitem__('everyTransportFailureMustPersistIncident',False),'next':lambda x:x['resumeContract'].__setitem__('nextRequestSequence',65),'outcome':lambda x:x['claimLocks'].__setitem__('outcomesAccessed',True),'unknown':lambda x:x['claimLocks'].__setitem__('unknownCredit',True)};ks={}
 for k,f in ms.items():x=copy.deepcopy(v);f(x);x=reseal(x);ks[k]=rejected(lambda x=x:validate_contract(x))
 if not all(ks.values()):fail('kill failed')
 return ks
def resume_capture():
 repo=verify_repo(True)
 if not repo['resumeAuthorized']:fail('resume unauthorized')
 v1,n,c,l,rs,incs=load_state();persist_incident(v1,n,INCIDENT65);done={x['candidateId'] for x in rs};seq=66;requests=0;last=0.;status='PASS';last_incident=None
 for candidate in c:
  if candidate['candidateId'] in done:continue
  wait=n.MIN_INTERVAL_SECONDS-(time.monotonic()-last)
  if wait>0:time.sleep(wait)
  requests+=1
  try:raw,headers,_=n.fetch(candidate,seq)
  except n.RateDeferred as e:
   body={'requestSequence':seq,'candidateId':candidate['candidateId'],'accession':candidate['accession'],'filedDate':candidate['filedDate'],'form':candidate['form'],'exceptionKind':f'HTTP_{e.status}_DEFERRED','partialBytesReportedByException':None,'acceptedRawBytes':0,'partialBytesPersisted':False,'contentInspected':False,'scientificCredit':False,'outcomesAccessed':False};last_incident=persist_incident(v1,n,body);status='DEFERRED';break
  except (http.client.IncompleteRead,ConnectionError,TimeoutError,OSError) as e:
   partial=len(e.partial) if isinstance(e,http.client.IncompleteRead) else None;body={'requestSequence':seq,'candidateId':candidate['candidateId'],'accession':candidate['accession'],'filedDate':candidate['filedDate'],'form':candidate['form'],'exceptionKind':type(e).__name__,'partialBytesReportedByException':partial,'acceptedRawBytes':0,'partialBytesPersisted':False,'contentInspected':False,'scientificCredit':False,'outcomesAccessed':False};last_incident=persist_incident(v1,n,body);status='TRANSPORT_DEFERRED';break
  last=time.monotonic();h=sha(raw);n.atomic_create(n.blob_path(h),raw);r=n.make_receipt(candidate,n.candidate_url(candidate),time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),headers,raw,seq);n.atomic_create(n.receipt_path(candidate['candidateId']),n.encode_json(r));seq+=1
 rs2=v1.receipts(n,c);incs2=incident_records(v1);return {'schema':'sec-liquidation-late-periodic-filing-capture-resume/v3','status':status,**repo,'requests':requests,'capturedCandidates':len(rs2),'remainingCandidates':122-len(rs2),'incidentCount':len(incs2),'lastIncidentRequestSequence':incs2[-1]['requestSequence'],'lastIncidentSha256':incs2[-1]['incidentSha256'],'maximumAcceptedRequestSequence':max(x['requestSequence'] for x in rs2),'outcomesAccessed':False}
def main():
 p=argparse.ArgumentParser();p.add_argument('command',choices=('verify-contract','dry-run','self-test','resume'));p.add_argument('--remote',action='store_true');a=p.parse_args()
 try:
  v=load_contract();repo=verify_repo(a.remote)
  if a.command=='resume':out=resume_capture()
  else:
   v1,n,c,l,rs,incs=load_state();inc65=incident_record(INCIDENT65);out={'schema':'sec-liquidation-late-periodic-filing-capture-resume-check/v3','status':'PASS',**repo,'candidateFilings':len(c),'caseCandidateLinks':len(l),'capturedCandidates':len(rs),'remainingCandidates':122-len(rs),'recordedIncidentCount':len(incs),'pendingIncidentRequestSequence':65,'pendingIncidentSha256':inc65['incidentSha256'],'networkRequests':0,'writes':0,'outcomesAccessed':False}
   if a.command=='self-test':out['mutationKills']=self_test(v)
 except (E,KeyError,TypeError,ValueError,OSError,json.JSONDecodeError) as e:p.error(str(e))
 print(json.dumps(out,sort_keys=True));return 0
if __name__=='__main__':raise SystemExit(main())
