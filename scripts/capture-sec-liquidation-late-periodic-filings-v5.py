#!/usr/bin/env python3
"""Capture the final large official SEC submissions under an explicit larger ceiling."""
from __future__ import annotations
import argparse,copy,datetime,hashlib,http.client,importlib.util,json,re,subprocess,time,urllib.error
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];CONTRACT=ROOT/'research'/'early-detection-v4'/'sec-liquidation-late-periodic-filing-capture-contract-v5.json';RUNNER=Path(__file__).resolve();TEST=ROOT/'tests'/'capture-sec-liquidation-late-periodic-filings-v5.test.js';V4_CONTRACT=ROOT/'research'/'early-detection-v4'/'sec-liquidation-late-periodic-filing-capture-contract-v4.json';V4=ROOT/'scripts'/'capture-sec-liquidation-late-periodic-filings-v4.py';V4_TEST=ROOT/'tests'/'capture-sec-liquidation-late-periodic-filings-v4.test.js';NETWORK=ROOT/'scripts'/'capture-sec-liquidation-downstream-filings-v1.py';OWNED=(CONTRACT,RUNNER,TEST)
CONTRACT_RAW='1fbbe61edd27d727b430b9d03d810f0b1d2761c7785f116958cdda9235b5418b'
CONTRACT_SELF='8d25530f6e3489d11dbc3b79ec27e3d41d5c86d9fa9d61ecea36d7926dfadcdd'
TEST_RAW='58ea8e398c90dc4e3c21c87b0330e78a492a07a423267e0aa9adcd8ea53c0198'
BASE='e6d19f41126c73007f2ff58e3a062dd202edf42b';REMOTE='https://github.com/Karlryl/screener-data.git';REF='refs/heads/codex/early-detection-v4-gates-20260810';CREATED_AT='2026-08-13T16:22:07Z';V4_CONTRACT_RAW='b8c95443a3bcc38a1e3b34b0b44b9e41cf978a8fd151fb1628f3c43a2cb02e19';V4_RAW='b14468bbabb7139c51f0fb44554ae2529cd67d6103f3ec769457fb9fb5e906db';V4_TEST_RAW='24393ff37b21bd30751e3e4115680911a4fa238f92b3c4753730851f2f8de1c3';NETWORK_RAW='4e36f022144f31defc129ec059b717a9c4a219cc49c15905ab584f5c5e9ce7d7';MAX_BYTES=500_000_000
PURPOSE='Resume the final three pre-sealed official SEC periodic submissions with an explicit 500,000,000-byte ceiling, journaling the prior 50,000,000-byte validation rejection and every later failure while granting no scientific credit.'
PENDING={'requestSequence':126,'candidateId':'SEC-LIQ-LATE-PERIODIC-4e6fb98b894cdfde67d9d51cfdcab539db58fa89c988316bf433c513c43fe0fd','accession':'0001193125-24-213058','filedDate':'2024-09-04','form':'N-CSR','exceptionKind':'SOURCE_VALIDATION_REJECTED_RESPONSE_SIZE_OVER_50000000','partialBytesReportedByException':50000001,'acceptedRawBytes':0,'partialBytesPersisted':False,'contentInspected':False,'scientificCredit':False,'outcomesAccessed':False}
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
def module(name,p,h,head):
 raw=p.read_bytes()
 if sha(raw)!=h or git_raw(head,p)!=raw:fail(name+' bytes changed')
 s=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def validate_contract(v):
 exact(v,{'schema','createdAt','taskId','track','purpose','inputs','sealedJournalPrefix','unrecordedObservedIncident','captureContract','claimLocks','implementationContract','contractSha256'},'contract')
 if (v['schema'],v['createdAt'],v['taskId'],v['track'],v['purpose'])!=('sec-liquidation-late-periodic-filing-capture-contract/v5',CREATED_AT,'Q003-SEC-LIQUIDATION-LATE-PERIODIC-FILING-CAPTURE-LARGE-OFFICIAL-SUBMISSIONS','SHARED_OUTCOME_BLIND_INFRA',PURPOSE):fail('identity changed')
 try:created=datetime.datetime.strptime(v['createdAt'],'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=datetime.timezone.utc)
 except ValueError:fail('createdAt changed')
 if created>datetime.datetime.now(datetime.timezone.utc):fail('createdAt future')
 if v['unrecordedObservedIncident']!=PENDING or v['sealedJournalPrefix']!={'acceptedReceipts':119,'remainingCandidates':3,'receiptSequenceSha256':'9995675a9183a71e8ee78c9d1112bf67b80263cf42ccd508dcc374bd6c2fdac2','incidentCount':6,'incidentSequences':[26,65,81,93,99,122],'incidentSequenceSha256':'8dee25961b54c4f392bc70cae1df2063a32f60b560579d6f2033b18cbfac0d26','requestEventCount':125,'requestEventSequenceSha256':'08af18aeaf6858797520da6438a5f3a9bed844cfb8f27fc8eadc45b5f0cc0764','lastAcceptedRequestSequence':125,'lastAcceptedReceiptSha256':'8dd0b2fa389e71374dff9a557fb90cbb6cfbb1f90078e46ceae073ad79bc75cc'}:fail('prefix changed')
 if v['captureContract']!={'maximumResponseBytes':MAX_BYTES,'minimumResponseBytes':1,'maximumNewRequestsPerInvocation':3,'automaticRetryWithinInvocation':False,'redirectsAllowed':False,'proxiesAllowed':False,'acceptedContentTypePrefixes':['text/plain','application/octet-stream','text/html'],'everyFailureMustPersistIncident':True,'existingBytesMustMatch':True,'atomicWriteNew':True,'publicRawBytesAllowed':False} or any(v['claimLocks'].values()) or set(v['claimLocks'])!={'contentInterpretationPerformed','sameSecurityVerified','securityIdentityResolved','additionalDistributionVerified','noFurtherPaymentsVerified','laterRecoveriesExcluded','completeCorporateActionChainVerified','terminalWealthComplete','originalV4GateCredit','resultComputationAllowed','pricesAccessed','returnsAccessed','outcomesAccessed'}:fail('capture or locks changed')
 inp={'v4Contract':{'path':V4_CONTRACT.relative_to(ROOT).as_posix(),'rawSha256':V4_CONTRACT_RAW,'introductionCommit':BASE},'v4Runner':{'path':V4.relative_to(ROOT).as_posix(),'rawSha256':V4_RAW},'v4Test':{'path':V4_TEST.relative_to(ROOT).as_posix(),'rawSha256':V4_TEST_RAW},'networkImplementation':{'path':NETWORK.relative_to(ROOT).as_posix(),'rawSha256':NETWORK_RAW}}
 impl={'baseCommit':BASE,'baseTag':905,'remote':REMOTE,'ref':REF,'contractPath':CONTRACT.relative_to(ROOT).as_posix(),'runnerPath':RUNNER.relative_to(ROOT).as_posix(),'testPath':TEST.relative_to(ROOT).as_posix(),'runnerNormalizedSha256':sha(normalized(RUNNER.read_bytes())),'testRawSha256':TEST_RAW,'introductionMustBeDirectSingleParentChildOfBase':True,'introductionAddsExactlyThreeOwnedPaths':True,'productionResumeRequiresPostIntroductionRemoteVerification':True}
 if v['inputs']!=inp or v['implementationContract']!=impl or v['contractSha256']!=CONTRACT_SELF or self_hash(v,'contractSha256')!=CONTRACT_SELF:fail('binding changed')
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
 head=git('rev-parse','HEAD')
 for p,h in ((V4_CONTRACT,V4_CONTRACT_RAW),(V4_TEST,V4_TEST_RAW),(NETWORK,NETWORK_RAW)):
  if sha(p.read_bytes())!=h or git_raw(head,p)!=p.read_bytes():fail('dependency changed')
 v4=module('sealed_v4_for_v5',V4,V4_RAW,head);state=v4.load_state()
 if len(state[5])!=119 or len(state[6])!=6 or state[7][-1][0]!=125:fail('sealed state changed')
 return v4,state
def persist(v4,state,body):return v4.persist_failure(state[1],state[0],state[2],body['candidate'],body['seq'],body['kind'],body['partial'])
def fetch_large(n,candidate,seq):
 url=n.candidate_url(candidate);request=n.urllib.request.Request(url,headers={'User-Agent':f'GrowthScreenerResearchData liquidation-late-periodic-large/1.0 {n.contact()}','Accept-Encoding':'identity','Accept':'text/plain,application/octet-stream,text/html'})
 try:
  with n.OPENER.open(request,timeout=n.TIMEOUT_SECONDS) as response:
   if response.geturl()!=url:raise n.CaptureError('SEC response redirected')
   status=int(response.status);headers=n.safe_headers(response.headers)
   if status!=200:raise n.CaptureError(f'unexpected SEC HTTP status {status}')
   if not any(headers.get('content-type','').lower().startswith(x) for x in ('text/plain','application/octet-stream','text/html')):raise n.CaptureError('SEC content type changed')
   raw=response.read(MAX_BYTES+1)
 except urllib.error.HTTPError as e:
  headers=n.safe_headers(e.headers)
  if e.code in n.DEFERRED_HTTP:raise n.RateDeferred(e.code,headers,candidate['candidateId'],url) from e
  raise n.CaptureError(f'unexpected SEC HTTP status {e.code}') from e
 if not raw or len(raw)>MAX_BYTES:raise n.CaptureError('SEC response size invalid under V5 ceiling')
 return raw,headers,seq
def resume_capture():
 repo=verify_repo(True)
 if not repo['resumeAuthorized']:fail('resume unauthorized')
 v4,s=load_state();v1,v3,n,c,l,rs,incs,events=s
 v4.persist_failure(v3,v1,n,next(x for x in c if x['candidateId']==PENDING['candidateId']),126,PENDING['exceptionKind'],PENDING['partialBytesReportedByException'])
 s=v4.load_state();v1,v3,n,c,l,rs,incs,events=s;done={x['candidateId'] for x in rs};seq=events[-1][0]+1;requests=0;last=0.;status='PASS'
 for candidate in c:
  if candidate['candidateId'] in done:continue
  wait=n.MIN_INTERVAL_SECONDS-(time.monotonic()-last)
  if wait>0:time.sleep(wait)
  requests+=1
  try:raw,headers,_=fetch_large(n,candidate,seq)
  except n.RateDeferred as e:v4.persist_failure(v3,v1,n,candidate,seq,f'HTTP_{e.status}_DEFERRED',None);status='DEFERRED';break
  except Exception as e:
   if not isinstance(e,(n.CaptureError,OSError,http.client.IncompleteRead,urllib.error.URLError,TimeoutError)):raise
   v4.persist_failure(v3,v1,n,candidate,seq,type(e).__name__+':'+str(e),None);status='SOURCE_OR_TRANSPORT_DEFERRED';break
  last=time.monotonic();h=sha(raw);n.atomic_create(n.blob_path(h),raw);r=n.make_receipt(candidate,n.candidate_url(candidate),time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),headers,raw,seq);n.atomic_create(n.receipt_path(candidate['candidateId']),n.encode_json(r));seq+=1
 s2=v4.load_state();return {'schema':'sec-liquidation-late-periodic-filing-capture-resume/v5','status':status,**repo,'requests':requests,'capturedCandidates':len(s2[5]),'remainingCandidates':122-len(s2[5]),'incidentCount':len(s2[6]),'maximumAttemptSequence':s2[7][-1][0],'outcomesAccessed':False}
def reseal(v):x=copy.deepcopy(v);x['contractSha256']=self_hash(x,'contractSha256');return x
def rejected(f):
 try:f()
 except (E,KeyError,TypeError,ValueError,OSError,json.JSONDecodeError):return True
 return False
def self_test(v):
 ms={'ceiling':lambda x:x['captureContract'].__setitem__('maximumResponseBytes',50_000_000),'retry':lambda x:x['captureContract'].__setitem__('automaticRetryWithinInvocation',True),'redirect':lambda x:x['captureContract'].__setitem__('redirectsAllowed',True),'partial':lambda x:x['unrecordedObservedIncident'].__setitem__('acceptedRawBytes',1),'sequence':lambda x:x['unrecordedObservedIncident'].__setitem__('requestSequence',125),'credit':lambda x:x['claimLocks'].__setitem__('originalV4GateCredit',True),'unknown':lambda x:x['claimLocks'].__setitem__('unknownCredit',False)};out={}
 for k,f in ms.items():x=copy.deepcopy(v);f(x);x=reseal(x);out[k]=rejected(lambda x=x:validate_contract(x))
 if not all(out.values()):fail('kill failed')
 return out
def main():
 p=argparse.ArgumentParser();p.add_argument('command',choices=('verify-contract','dry-run','self-test','resume'));p.add_argument('--remote',action='store_true');a=p.parse_args()
 try:
  v=load_contract();repo=verify_repo(a.remote)
  if a.command=='resume':out=resume_capture()
  else:
   _,s=load_state();out={'schema':'sec-liquidation-late-periodic-filing-capture-resume-check/v5','status':'PASS',**repo,'capturedCandidates':len(s[5]),'remainingCandidates':122-len(s[5]),'incidentCount':len(s[6]),'pendingIncidentRequestSequence':126,'nextRetryRequestSequence':127,'maximumResponseBytes':MAX_BYTES,'networkRequests':0,'writes':0,'outcomesAccessed':False}
   if a.command=='self-test':out['mutationKills']=self_test(v)
 except (E,KeyError,TypeError,ValueError,OSError,json.JSONDecodeError) as e:p.error(str(e))
 print(json.dumps(out,sort_keys=True));return 0
if __name__=='__main__':raise SystemExit(main())
