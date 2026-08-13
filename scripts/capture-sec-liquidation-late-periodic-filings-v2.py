#!/usr/bin/env python3
"""Resume the sealed late-periodic SEC capture after an explicit incomplete-transfer event."""
from __future__ import annotations
import argparse,copy,datetime,hashlib,http.client,importlib.util,json,re,subprocess,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];CONTRACT=ROOT/'research'/'early-detection-v4'/'sec-liquidation-late-periodic-filing-capture-contract-v2.json';RUNNER=Path(__file__).resolve();TEST=ROOT/'tests'/'capture-sec-liquidation-late-periodic-filings-v2.test.js';V1=ROOT/'scripts'/'capture-sec-liquidation-late-periodic-filings-v1.py';NETWORK=ROOT/'scripts'/'capture-sec-liquidation-downstream-filings-v1.py';OWNED=(CONTRACT,RUNNER,TEST)
CONTRACT_RAW='4676f0967ec48bd66ecfcbdc83c84cdec8a58b72a9e65f13d1171353679f5132'
CONTRACT_SELF='ccd286a386eb019e26f2e1748d719f87d4ddb042eaa8915eebc324cff7ec5c7e'
TEST_RAW='5d04d4bd0ba54b0b88073ede5b98b7db1b0ab11a352ad318c99c1a0ecca5bfc0'
BASE='698cb1633510aaf8a3473dc6689a390fdb566949';REMOTE='https://github.com/Karlryl/screener-data.git';REF='refs/heads/codex/early-detection-v4-gates-20260810';CREATED_AT='2026-08-13T15:50:05Z';V1_RAW='e74ddc95a579b00a294c29dc96c76dde27e5e83b73cd9d116cfafe89454ea558';NETWORK_RAW='4e36f022144f31defc129ec059b717a9c4a219cc49c15905ab584f5c5e9ce7d7'
PURPOSE='Resume the exact private capture after recording the observed incomplete HTTP transfer as request event 26, while preserving the twenty-five accepted receipts, accepting zero partial bytes and allowing no automatic retry, public raw bytes, content interpretation, recovery, terminal wealth, price, return, outcome or Original-V4 credit.'
INCIDENT={'requestSequence':26,'candidateId':'SEC-LIQ-LATE-PERIODIC-344485f07ab0d19bd6c9337d7d6ed6bb08c9a0c68942611ca217507b29eb94bc','accession':'0001104659-17-000187','filedDate':'2017-01-03','form':'N-CSR','exceptionKind':'HTTP_CLIENT_INCOMPLETE_READ','partialBytesReportedByException':22415822,'acceptedRawBytes':0,'partialBytesPersisted':False,'contentInspected':False,'scientificCredit':False,'outcomesAccessed':False}
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
def resume_contract(v1):return {'candidateFilings':122,'privateRoot':str(v1.PRIVATE),'incidentLayout':'incidents/sha256/<first2>/<incidentRawSha256>.json','maximumNewRequestsPerRun':97,'automaticRetryCount':0,'nextRequestSequence':27,'rateDeferredStopsRun':True,'transportIncidentStopsRun':True,'existingBytesMustMatch':True,'atomicWriteNew':True,'publicRawBytesAllowed':False}
def validate_contract(v):
 exact(v,{'schema','createdAt','taskId','track','purpose','inputs','observedPreSealState','transportIncident','resumeContract','claimLocks','implementationContract','contractSha256'},'contract')
 if (v['schema'],v['createdAt'],v['taskId'],v['track'],v['purpose'])!=('sec-liquidation-late-periodic-filing-capture-contract/v2',CREATED_AT,'Q003-SEC-LIQUIDATION-LATE-PERIODIC-FILING-CAPTURE-RESUME','SHARED_OUTCOME_BLIND_INFRA',PURPOSE):fail('identity changed')
 try:created=datetime.datetime.strptime(v['createdAt'],'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=datetime.timezone.utc)
 except ValueError:fail('createdAt changed')
 if created>datetime.datetime.now(datetime.timezone.utc):fail('createdAt future')
 head=git('rev-parse','HEAD');v1=module('sealed_v1_for_contract',V1,V1_RAW,head)
 inp={'v1Runner':{'path':V1.relative_to(ROOT).as_posix(),'rawSha256':V1_RAW,'introductionCommit':BASE},'networkImplementation':{'path':NETWORK.relative_to(ROOT).as_posix(),'rawSha256':NETWORK_RAW}}
 pre={'acceptedReceipts':25,'remainingCandidatesBeforeIncidentRecording':97,'lastAcceptedRequestSequence':25,'lastAcceptedReceiptSha256':'3c891fdc286eea4cb644c0023d2c35b1a42414ee64b627c07d1d01c39fe39085','lastAcceptedCapturedAt':'2026-08-13T15:48:12Z','v1ManifestSha256':'962f84e72a65dcfc9223a6eb8e2985fb817242ae8e7e1b1165c00fbf4850a2fe'}
 if v['inputs']!=inp or v['observedPreSealState']!=pre or v['transportIncident']!=INCIDENT or v['resumeContract']!=resume_contract(v1) or v['claimLocks']!=LOCKS:fail('inputs state incident resume or locks changed')
 impl={'baseCommit':BASE,'baseTag':902,'remote':REMOTE,'ref':REF,'contractPath':CONTRACT.relative_to(ROOT).as_posix(),'runnerPath':RUNNER.relative_to(ROOT).as_posix(),'testPath':TEST.relative_to(ROOT).as_posix(),'runnerNormalizedSha256':sha(normalized(RUNNER.read_bytes())),'testRawSha256':TEST_RAW,'introductionMustBeDirectSingleParentChildOfBase':True,'introductionAddsExactlyThreeOwnedPaths':True,'productionResumeRequiresPostIntroductionRemoteVerification':True,'dryRunMustUseZeroNetworkAndZeroWrites':True}
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
 head=git('rev-parse','HEAD');v1=module('sealed_v1',V1,V1_RAW,head);network=module('sealed_network',NETWORK,NETWORK_RAW,head);n,c,l=v1.load_inputs(head);rs=v1.receipts(n,c)
 if len(rs)!=25 or rs[-1]['requestSequence']!=25 or rs[-1]['receiptSha256']!='3c891fdc286eea4cb644c0023d2c35b1a42414ee64b627c07d1d01c39fe39085':fail('accepted state changed')
 return v1,network,n,c,l,rs
def incident_record():x={'schema':'sec-liquidation-late-periodic-private-transport-incident/v1',**INCIDENT,'incidentSha256':''};x['incidentSha256']=self_hash(x,'incidentSha256');return x
def incident_path(v1,x):return v1.PRIVATE/'incidents'/'sha256'/x['incidentSha256'][:2]/f"{x['incidentSha256']}.json"
def ensure_incident(v1,n):
 x=incident_record();p=incident_path(v1,x);raw=n.encode_json(x);n.atomic_create(p,raw);return x
def reseal(v):x=copy.deepcopy(v);x['contractSha256']=self_hash(x,'contractSha256');return x
def rejected(f):
 try:f()
 except (E,KeyError,TypeError,ValueError,OSError,json.JSONDecodeError):return True
 return False
def self_test(v):
 ms={'purpose':lambda x:x.__setitem__('purpose','silent retry'),'accepted':lambda x:x['observedPreSealState'].__setitem__('acceptedReceipts',26),'sequence':lambda x:x['transportIncident'].__setitem__('requestSequence',25),'bytes':lambda x:x['transportIncident'].__setitem__('acceptedRawBytes',22415822),'persisted':lambda x:x['transportIncident'].__setitem__('partialBytesPersisted',True),'credit':lambda x:x['transportIncident'].__setitem__('scientificCredit',True),'retry':lambda x:x['resumeContract'].__setitem__('automaticRetryCount',1),'next':lambda x:x['resumeContract'].__setitem__('nextRequestSequence',26),'outcome':lambda x:x['claimLocks'].__setitem__('outcomesAccessed',True),'unknown':lambda x:x['claimLocks'].__setitem__('unknownCredit',True)};ks={}
 for k,f in ms.items():x=copy.deepcopy(v);f(x);x=reseal(x);ks[k]=rejected(lambda x=x:validate_contract(x))
 if not all(ks.values()):fail('kill failed')
 return ks
def resume_capture():
 repo=verify_repo(True)
 if not repo['resumeAuthorized']:fail('resume unauthorized')
 v1,network,n,c,l,rs=load_state();incident=ensure_incident(v1,n);done={x['candidateId'] for x in rs};seq=27;requests=0;last=0.;status='PASS'
 for candidate in c:
  if candidate['candidateId'] in done:continue
  wait=n.MIN_INTERVAL_SECONDS-(time.monotonic()-last)
  if wait>0:time.sleep(wait)
  requests+=1
  try:raw,headers,_=n.fetch(candidate,seq)
  except n.RateDeferred as e:
   status='DEFERRED';break
  except (http.client.IncompleteRead,ConnectionError,TimeoutError,OSError):
   status='TRANSPORT_DEFERRED';break
  last=time.monotonic();h=sha(raw);n.atomic_create(n.blob_path(h),raw);r=n.make_receipt(candidate,n.candidate_url(candidate),time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),headers,raw,seq);n.atomic_create(n.receipt_path(candidate['candidateId']),n.encode_json(r));seq+=1
 rs2=v1.receipts(n,c);return {'schema':'sec-liquidation-late-periodic-filing-capture-resume/v2','status':status,**repo,'requests':requests,'capturedCandidates':len(rs2),'remainingCandidates':122-len(rs2),'incidentRequestSequence':incident['requestSequence'],'incidentSha256':incident['incidentSha256'],'maximumAcceptedRequestSequence':max(x['requestSequence'] for x in rs2),'outcomesAccessed':False}
def main():
 p=argparse.ArgumentParser();p.add_argument('command',choices=('verify-contract','dry-run','self-test','resume'));p.add_argument('--remote',action='store_true');a=p.parse_args()
 try:
  v=load_contract();repo=verify_repo(a.remote)
  if a.command=='resume':out=resume_capture()
  else:
   v1,network,n,c,l,rs=load_state();inc=incident_record();out={'schema':'sec-liquidation-late-periodic-filing-capture-resume-check/v2','status':'PASS',**repo,'candidateFilings':len(c),'caseCandidateLinks':len(l),'capturedCandidates':len(rs),'remainingCandidates':122-len(rs),'incidentRequestSequence':26,'incidentSha256':inc['incidentSha256'],'networkRequests':0,'writes':0,'outcomesAccessed':False}
   if a.command=='self-test':out['mutationKills']=self_test(v)
 except (E,KeyError,TypeError,ValueError,OSError,json.JSONDecodeError) as e:p.error(str(e))
 print(json.dumps(out,sort_keys=True));return 0
if __name__=='__main__':raise SystemExit(main())
