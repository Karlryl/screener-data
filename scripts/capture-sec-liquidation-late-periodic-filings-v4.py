#!/usr/bin/env python3
"""Repeatably resume private SEC capture from an append-only receipt/incident journal."""
from __future__ import annotations
import argparse,copy,datetime,hashlib,http.client,importlib.util,json,re,subprocess,time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
CONTRACT=ROOT/'research'/'early-detection-v4'/'sec-liquidation-late-periodic-filing-capture-contract-v4.json'
RUNNER=Path(__file__).resolve()
TEST=ROOT/'tests'/'capture-sec-liquidation-late-periodic-filings-v4.test.js'
V1=ROOT/'scripts'/'capture-sec-liquidation-late-periodic-filings-v1.py'
V3_CONTRACT=ROOT/'research'/'early-detection-v4'/'sec-liquidation-late-periodic-filing-capture-contract-v3.json'
V3=ROOT/'scripts'/'capture-sec-liquidation-late-periodic-filings-v3.py'
V3_TEST=ROOT/'tests'/'capture-sec-liquidation-late-periodic-filings-v3.test.js'
OWNED=(CONTRACT,RUNNER,TEST)

CONTRACT_RAW='b8c95443a3bcc38a1e3b34b0b44b9e41cf978a8fd151fb1628f3c43a2cb02e19'
CONTRACT_SELF='73054b81142ef0bedc235784f759933eb3431418918fe572363a76c15c1934ca'
TEST_RAW='24393ff37b21bd30751e3e4115680911a4fa238f92b3c4753730851f2f8de1c3'
BASE='8a223c237b8a7f8ddfe518a3e8b33b8364473b4e'
REMOTE='https://github.com/Karlryl/screener-data.git'
REF='refs/heads/codex/early-detection-v4-gates-20260810'
CREATED_AT='2026-08-13T16:10:30Z'
V1_RAW='e74ddc95a579b00a294c29dc96c76dde27e5e83b73cd9d116cfafe89454ea558'
V3_CONTRACT_RAW='e50cfdc212304a0fc1b2542fe8b006542f24fb1e6a5ca2197c7e1eb1091c034b'
V3_RAW='52ee3d33c32de97663dc95737dc8a4aeee0055342f30c298bc61dc737ab363b4'
V3_TEST_RAW='ef06cee233d1558b760a8dcf8bc0f2e8df480368cbaa6927205d543054c719f7'
PURPOSE='Continue the exact private late-periodic capture through any number of explicit invocations, deriving the next request sequence from the complete append-only receipt and incident journal while accepting no partial transport bytes and granting no scientific credit.'
RECEIPT_PREFIX_SHA='24543ffbb5448d5a54e41ad1f9ca2b64b7498fbb0e898a2f1d0ed98318d23330'
INCIDENT_PREFIX_SHA='fb2d1729d29c67eaccc9f34e40f181fadfafeb566423b88edc4071e9ad15fb43'
EVENT_PREFIX_SHA='0473b38606e363ec1d8d623d249f3233a5614522edb62bd56be0295e019e7a8e'
LOCKS={'contentInterpretationPerformed':False,'sameSecurityVerified':False,'securityIdentityResolved':False,'additionalDistributionVerified':False,'noFurtherPaymentsVerified':False,'laterRecoveriesExcluded':False,'completeCorporateActionChainVerified':False,'terminalWealthComplete':False,'originalV4GateCredit':False,'resultComputationAllowed':False,'pricesAccessed':False,'returnsAccessed':False,'outcomesAccessed':False}

class E(RuntimeError): pass
def fail(x): raise E(x)
def sha(x): return hashlib.sha256(x).hexdigest()
def canonical(x): return json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
def self_hash(x,f):
 y=dict(x);y.pop(f,None);return sha(canonical(y))
def line_sha(vals): return sha(('\n'.join(vals)+('\n' if vals else '')).encode())
def exact(x,k,l):
 if type(x) is not dict or set(x)!=set(k): fail(l+' keys changed')
def normalized(raw):
 s=raw.decode().replace('\r\n','\n')
 for n in ('CONTRACT_RAW','CONTRACT_SELF','TEST_RAW'):
  p=re.compile(rf"^{n}='[0-9a-f]{{64}}'",re.M)
  if len(p.findall(s))!=1: fail(n+' normalization')
  s=p.sub(f"{n}='{'0'*64}'",s)
 return s.encode()
def git(*a):
 r=subprocess.run(['git',*a],cwd=ROOT,capture_output=True,text=True)
 if r.returncode: fail(r.stderr.strip() or 'git failed')
 return r.stdout.strip()
def git_raw(c,p):
 r=subprocess.run(['git','show',f'{c}:{p.relative_to(ROOT).as_posix()}'],cwd=ROOT,capture_output=True)
 if r.returncode: fail('Git blob unavailable')
 return r.stdout
def module(name,p,expected,head):
 raw=p.read_bytes()
 if sha(raw)!=expected or git_raw(head,p)!=raw: fail(name+' bytes changed')
 s=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

def expected_inputs():
 return {
  'v1CaptureRunner':{'path':V1.relative_to(ROOT).as_posix(),'rawSha256':V1_RAW},
  'v3JournalContract':{'path':V3_CONTRACT.relative_to(ROOT).as_posix(),'rawSha256':V3_CONTRACT_RAW,'introductionCommit':BASE},
  'v3JournalRunner':{'path':V3.relative_to(ROOT).as_posix(),'rawSha256':V3_RAW},
  'v3JournalTest':{'path':V3_TEST.relative_to(ROOT).as_posix(),'rawSha256':V3_TEST_RAW}}
def expected_prefix():
 return {'candidateFilings':122,'acceptedReceipts':78,'remainingCandidates':44,'receiptSequenceSha256':RECEIPT_PREFIX_SHA,'incidentCount':3,'incidentSequences':[26,65,81],'incidentSequenceSha256':INCIDENT_PREFIX_SHA,'requestEventCount':81,'requestEventSequenceSha256':EVENT_PREFIX_SHA,'lastAcceptedRequestSequence':80,'lastAcceptedReceiptSha256':'9fc578103445eab72f5bc7c18c5e689a3e07a01d50be3fe9f3f4b78794242986','lastIncidentRequestSequence':81,'lastIncidentSha256':'b02d743888bd5c6218bdc356d523743c890f3874889c1eab154e61fcc3d425c6','nextRequestSequenceAtSeal':82}
def expected_resume():
 return {'privateRoot':r'C:\Users\Anwender\Documents\GrowthScreenerResearchData\early-detection-v4\liquidation-late-periodic-sec-originals-v1','explicitInvocationMayRetryPreviouslyFailedCandidate':True,'automaticRetryWithinInvocation':False,'nextSequenceDerivedFromAllReceiptsAndIncidents':True,'requestSequencesMustRemainUniqueAndContiguous':True,'sealedJournalPrefixMustRemainByteExact':True,'everyTransportFailureMustPersistIncident':True,'rateDeferredStopsInvocation':True,'transportIncidentStopsInvocation':True,'partialTransportBytesAccepted':False,'partialTransportBytesPersisted':False,'existingBytesMustMatch':True,'atomicWriteNew':True,'publicRawBytesAllowed':False}
def expected_impl():
 return {'baseCommit':BASE,'baseTag':904,'remote':REMOTE,'ref':REF,'contractPath':CONTRACT.relative_to(ROOT).as_posix(),'runnerPath':RUNNER.relative_to(ROOT).as_posix(),'testPath':TEST.relative_to(ROOT).as_posix(),'runnerNormalizedSha256':sha(normalized(RUNNER.read_bytes())),'testRawSha256':TEST_RAW,'introductionMustBeDirectSingleParentChildOfBase':True,'introductionAddsExactlyThreeOwnedPaths':True,'productionResumeRequiresPostIntroductionRemoteVerification':True,'dryRunMustUseZeroNetworkAndZeroWrites':True}
def validate_contract(v):
 exact(v,{'schema','createdAt','taskId','track','purpose','inputs','sealedJournalPrefix','resumeContract','claimLocks','implementationContract','contractSha256'},'contract')
 if (v['schema'],v['createdAt'],v['taskId'],v['track'],v['purpose'])!=('sec-liquidation-late-periodic-filing-capture-contract/v4',CREATED_AT,'Q003-SEC-LIQUIDATION-LATE-PERIODIC-FILING-CAPTURE-REPEATABLE-JOURNALED-RESUME','SHARED_OUTCOME_BLIND_INFRA',PURPOSE): fail('identity changed')
 try: created=datetime.datetime.strptime(v['createdAt'],'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=datetime.timezone.utc)
 except ValueError: fail('createdAt changed')
 if created>datetime.datetime.now(datetime.timezone.utc): fail('createdAt future')
 if v['inputs']!=expected_inputs() or v['sealedJournalPrefix']!=expected_prefix() or v['resumeContract']!=expected_resume() or v['claimLocks']!=LOCKS or v['implementationContract']!=expected_impl(): fail('inputs prefix resume locks or implementation changed')
 if v['contractSha256']!=CONTRACT_SELF or self_hash(v,'contractSha256')!=CONTRACT_SELF: fail('self hash')
def load_contract():
 raw=CONTRACT.read_bytes()
 if sha(raw)!=CONTRACT_RAW: fail('contract raw changed')
 v=json.loads(raw);validate_contract(v);return v
def changed(c):
 o=git('diff-tree','--no-commit-id','--name-status','-r',c);return [tuple(x.split('\t',1)) for x in o.splitlines() if x]
def intro(p):
 o=git('log','--reverse','--format=%H','--diff-filter=A',f'{BASE}..HEAD','--',p.relative_to(ROOT).as_posix());return o.splitlines() if o else []
def verify_repo(remote):
 if not remote: fail('live remote mandatory')
 head=git('rev-parse','HEAD')
 if git('remote','get-url','origin')!=REMOTE or git('rev-parse','@{u}')!=head or git('ls-remote','--refs','origin',REF).split()!=[head,REF]: fail('remote differs')
 xs=[intro(p) for p in OWNED]
 if all(not x for x in xs):
  if head!=BASE: fail('pre introduction moved')
  return {'phase':'PRE_INTRODUCTION','introductionCommit':None,'remoteVerified':True,'resumeAuthorized':False}
 if any(len(x)!=1 for x in xs) or len({x[0] for x in xs})!=1: fail('introduction split')
 i=xs[0][0]
 if git('show','-s','--format=%P',i).split()!=[BASE] or changed(i)!=[('A',p.relative_to(ROOT).as_posix()) for p in OWNED]: fail('introduction changed')
 for p in OWNED:
  if git_raw(i,p)!=p.read_bytes() or git_raw(head,p)!=p.read_bytes(): fail('owned bytes changed')
 return {'phase':'POST_INTRODUCTION','introductionCommit':i,'remoteVerified':True,'resumeAuthorized':True}

def load_state():
 head=git('rev-parse','HEAD')
 for p,h in ((V3_CONTRACT,V3_CONTRACT_RAW),(V3_TEST,V3_TEST_RAW)):
  if sha(p.read_bytes())!=h or git_raw(head,p)!=p.read_bytes(): fail('v3 dependency bytes changed')
 v1=module('sealed_v1_for_v4',V1,V1_RAW,head)
 v3=module('sealed_v3_for_v4',V3,V3_RAW,head)
 n,c,l=v1.load_inputs(head);rs=v1.receipts(n,c);incs=v3.incident_records(v1)
 if len(c)!=122 or len(rs)<78 or len(incs)<3: fail('journal regressed')
 if line_sha([x['receiptSha256'] for x in rs[:78]])!=RECEIPT_PREFIX_SHA: fail('receipt prefix changed')
 if [x['requestSequence'] for x in incs[:3]]!=[26,65,81] or line_sha([x['incidentSha256'] for x in incs[:3]])!=INCIDENT_PREFIX_SHA: fail('incident prefix changed')
 by={x['candidateId'] for x in c}
 if len({x['candidateId'] for x in rs})!=len(rs) or any(x['candidateId'] not in by for x in incs): fail('candidate journal changed')
 events=[(x['requestSequence'],f"R|{x['requestSequence']}|{x['candidateId']}|{x['receiptSha256']}") for x in rs]+[(x['requestSequence'],f"I|{x['requestSequence']}|{x['candidateId']}|{x['incidentSha256']}") for x in incs]
 events.sort()
 if [x[0] for x in events]!=list(range(1,len(events)+1)): fail('request sequence changed')
 if line_sha([x[1] for x in events[:81]])!=EVENT_PREFIX_SHA: fail('event prefix changed')
 return v1,v3,n,c,l,rs,incs,events
def rejected(f):
 try: f()
 except (E,KeyError,TypeError,ValueError,OSError,json.JSONDecodeError): return True
 return False
def reseal(v):
 x=copy.deepcopy(v);x['contractSha256']=self_hash(x,'contractSha256');return x
def self_test(v):
 ms={'purpose':lambda x:x.__setitem__('purpose','silent auto retry'),'prefix':lambda x:x['sealedJournalPrefix'].__setitem__('acceptedReceipts',79),'sequence':lambda x:x['sealedJournalPrefix']['incidentSequences'].__setitem__(2,80),'autoRetry':lambda x:x['resumeContract'].__setitem__('automaticRetryWithinInvocation',True),'derive':lambda x:x['resumeContract'].__setitem__('nextSequenceDerivedFromAllReceiptsAndIncidents',False),'partial':lambda x:x['resumeContract'].__setitem__('partialTransportBytesAccepted',True),'journal':lambda x:x['resumeContract'].__setitem__('everyTransportFailureMustPersistIncident',False),'outcome':lambda x:x['claimLocks'].__setitem__('outcomesAccessed',True),'unknown':lambda x:x['claimLocks'].__setitem__('scientificCredit',True)}
 ks={}
 for k,f in ms.items():
  x=copy.deepcopy(v);f(x);x=reseal(x);ks[k]=rejected(lambda x=x:validate_contract(x))
 if not all(ks.values()): fail('kill failed')
 return ks
def persist_failure(v3,v1,n,candidate,seq,kind,partial):
 return v3.persist_incident(v1,n,{'requestSequence':seq,'candidateId':candidate['candidateId'],'accession':candidate['accession'],'filedDate':candidate['filedDate'],'form':candidate['form'],'exceptionKind':kind,'partialBytesReportedByException':partial,'acceptedRawBytes':0,'partialBytesPersisted':False,'contentInspected':False,'scientificCredit':False,'outcomesAccessed':False})
def resume_capture():
 repo=verify_repo(True)
 if not repo['resumeAuthorized']: fail('resume unauthorized')
 v1,v3,n,c,l,rs,incs,events=load_state();done={x['candidateId'] for x in rs};seq=events[-1][0]+1;requests=0;last=0.;status='PASS'
 for candidate in c:
  if candidate['candidateId'] in done: continue
  wait=n.MIN_INTERVAL_SECONDS-(time.monotonic()-last)
  if wait>0: time.sleep(wait)
  requests+=1
  try: raw,headers,_=n.fetch(candidate,seq)
  except n.RateDeferred as e:
   persist_failure(v3,v1,n,candidate,seq,f'HTTP_{e.status}_DEFERRED',None);status='DEFERRED';break
  except (http.client.IncompleteRead,ConnectionError,TimeoutError,OSError) as e:
   partial=len(e.partial) if isinstance(e,http.client.IncompleteRead) else None
   persist_failure(v3,v1,n,candidate,seq,type(e).__name__,partial);status='TRANSPORT_DEFERRED';break
  last=time.monotonic();h=sha(raw);n.atomic_create(n.blob_path(h),raw);r=n.make_receipt(candidate,n.candidate_url(candidate),time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),headers,raw,seq);n.atomic_create(n.receipt_path(candidate['candidateId']),n.encode_json(r));seq+=1
 _,_,_,_,_,rs2,incs2,events2=load_state()
 return {'schema':'sec-liquidation-late-periodic-filing-capture-resume/v4','status':status,**repo,'requests':requests,'capturedCandidates':len(rs2),'remainingCandidates':122-len(rs2),'incidentCount':len(incs2),'maximumAttemptSequence':events2[-1][0],'nextRequestSequence':events2[-1][0]+1,'outcomesAccessed':False}
def main():
 p=argparse.ArgumentParser();p.add_argument('command',choices=('verify-contract','dry-run','self-test','resume'));p.add_argument('--remote',action='store_true');a=p.parse_args()
 try:
  v=load_contract();repo=verify_repo(a.remote)
  if a.command=='resume': out=resume_capture()
  else:
   _,_,_,c,l,rs,incs,events=load_state();out={'schema':'sec-liquidation-late-periodic-filing-capture-resume-check/v4','status':'PASS',**repo,'candidateFilings':len(c),'caseCandidateLinks':len(l),'capturedCandidates':len(rs),'remainingCandidates':122-len(rs),'incidentCount':len(incs),'maximumAttemptSequence':events[-1][0],'nextRequestSequence':events[-1][0]+1,'networkRequests':0,'writes':0,'outcomesAccessed':False}
   if a.command=='self-test': out['mutationKills']=self_test(v)
 except (E,KeyError,TypeError,ValueError,OSError,json.JSONDecodeError) as e: p.error(str(e))
 print(json.dumps(out,sort_keys=True));return 0
if __name__=='__main__': raise SystemExit(main())
