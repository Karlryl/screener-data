#!/usr/bin/env python3
"""Capture the exact pre-sealed 24 periodic SEC filings into a private CAS."""
from __future__ import annotations
import argparse,copy,datetime,hashlib,importlib.util,json,os,re,subprocess,time
from pathlib import Path
from typing import Any,Callable
ROOT=Path(__file__).resolve().parents[1];CONTRACT=ROOT/'research'/'early-detection-v4'/'sec-liquidation-periodic-filing-capture-contract-v1.json';RUNNER=Path(__file__).resolve();TEST=ROOT/'tests'/'capture-sec-liquidation-periodic-filings-v1.test.js';DISCOVERY=ROOT/'scripts'/'build-sec-liquidation-periodic-filing-discovery-v1.py';V1=ROOT/'scripts'/'capture-sec-liquidation-downstream-filings-v1.py';PRIVATE=Path(r'C:\Users\Anwender\Documents\GrowthScreenerResearchData\early-detection-v4\liquidation-periodic-sec-originals-v1');OWNED=(CONTRACT,RUNNER,TEST)
CONTRACT_RAW='5e3604e7a1334fa0267c8be430e593068a968ad55b778fb46dd615668045114a'
CONTRACT_SELF='a0d008c94b4dcd902bfc934e0e8b1d2bf3426f83259f8ef430d29cb471a14122'
TEST_RAW='81f7f1312d4fa2ddb25eab65966d43fb84baa8d3d7d59d52d29972f008ffeac0'
BASE='c6129c49d262e2072d98d8f0bbc1587fddfa8260';REMOTE='https://github.com/Karlryl/screener-data.git';REF='refs/heads/codex/early-detection-v4-gates-20260810';CREATED_AT='2026-08-13T14:16:12Z';DISCOVERY_RAW='9ba8e83b0705ad81e2907e6e72210160c18bfcb37b5a0dd669efc2609a5e6034';V1_RAW='4e36f022144f31defc129ec059b717a9c4a219cc49c15905ab584f5c5e9ce7d7';CANDIDATE_SHA='1d98ca8643652a2958fdcf5e4ce37fdc98e20c8d2fd83b854523b3fb2cdbb043';LINK_SHA='8080fb406e07fe435865effdeb6022b21b69934ab95913ad6214936cfa9ad62e'
PURPOSE='Capture exactly the twenty-four pre-sealed periodic SEC accounting filings once each into a private content-addressed store, without redirects, proxies, retries, public raw bytes, content interpretation, security linkage, finality, recovery, terminal wealth, price, return, outcome or Original-V4 credit.'
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
def ancestor(a,b):return subprocess.run(['git','merge-base','--is-ancestor',a,b],cwd=ROOT).returncode==0
def module(name,p,expected,head):
 raw=p.read_bytes()
 if sha(raw)!=expected or git_raw(head,p)!=raw:fail(name+' bytes changed')
 s=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def resume_contract():return {'candidateFilings':24,'candidateCanonicalSha256':CANDIDATE_SHA,'caseCandidateLinks':102,'linkCanonicalSha256':LINK_SHA,'privateRoot':str(PRIVATE),'rawBlobLayout':'blobs/sha256/<first2>/<sha256>','receiptLayout':'receipts/<candidateId>.json','deferredLayout':'deferred/sha256/<first2>/<deferredRawSha256>.json','manifestLayout':'manifests/sha256/<first2>/<manifestSha256>.json','maximumRequestsPerRun':24,'retryCount':0,'minimumIntervalMilliseconds':250,'rateDeferredStopsRun':True,'existingBytesMustMatch':True,'atomicWriteNew':True,'publicRawBytesAllowed':False}
def validate_contract(v):
 exact(v,{'schema','createdAt','taskId','track','purpose','inputs','captureContract','claimLocks','implementationContract','contractSha256'},'contract')
 if v['schema']!='sec-liquidation-periodic-filing-capture-contract/v1' or v['createdAt']!=CREATED_AT or v['taskId']!='Q003-SEC-LIQUIDATION-PERIODIC-FILING-CAPTURE' or v['track']!='SHARED_OUTCOME_BLIND_INFRA' or v['purpose']!=PURPOSE:fail('identity changed')
 try:created=datetime.datetime.strptime(v['createdAt'],'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=datetime.timezone.utc)
 except ValueError:fail('createdAt changed')
 if created>datetime.datetime.now(datetime.timezone.utc):fail('createdAt is in the future')
 inp={'discovery':{'path':DISCOVERY.relative_to(ROOT).as_posix(),'rawSha256':DISCOVERY_RAW,'introductionCommit':BASE},'networkImplementation':{'path':V1.relative_to(ROOT).as_posix(),'rawSha256':V1_RAW}}
 if v['inputs']!=inp or v['captureContract']!=resume_contract() or v['claimLocks']!=LOCKS:fail('inputs capture or locks changed')
 impl={'baseCommit':BASE,'baseTag':897,'remote':REMOTE,'ref':REF,'contractPath':CONTRACT.relative_to(ROOT).as_posix(),'runnerPath':RUNNER.relative_to(ROOT).as_posix(),'testPath':TEST.relative_to(ROOT).as_posix(),'runnerNormalizedSha256':sha(normalized(RUNNER.read_bytes())),'testRawSha256':TEST_RAW,'introductionMustBeDirectSingleParentChildOfBase':True,'introductionAddsExactlyThreeOwnedPaths':True,'laterLinearSingleParentDescendantsAllowed':True,'productionCaptureRequiresPostIntroductionRemoteVerification':True,'dryRunMustUseZeroNetworkAndZeroWrites':True}
 if v['implementationContract']!=impl:fail('implementation changed')
 if v['contractSha256']!=CONTRACT_SELF or self_hash(v,'contractSha256')!=CONTRACT_SELF:fail('self hash')
def load_contract():
 raw=CONTRACT.read_bytes()
 if sha(raw)!=CONTRACT_RAW:fail('contract raw changed')
 v=json.loads(raw);validate_contract(v);return v
def load_inputs(head):
 d=module('periodic_discovery',DISCOVERY,DISCOVERY_RAW,head);n=module('sealed_network',V1,V1_RAW,head);_s,c,l,_=d.build_rows();
 if len(c)!=24 or len(l)!=102 or sha(canonical(c))!=CANDIDATE_SHA or sha(canonical(l))!=LINK_SHA:fail('population changed')
 n.PRIVATE_ROOT=PRIVATE;return n,c,l
def deferred_events(n,candidates):
 by={x['candidateId']:x for x in candidates};out=[]
 for p in (PRIVATE/'deferred'/'sha256').glob('*/*.json'):
  raw=p.read_bytes();v=json.loads(raw);exact(v,{'schema','candidateId','url','httpStatus','responseHeaders','requestSequence','outcomesAccessed','deferredSha256'},'deferred')
  if v['candidateId'] not in by or v['url']!=n.candidate_url(by[v['candidateId']]) or v['httpStatus'] not in n.DEFERRED_HTTP or v['outcomesAccessed'] is not False or v['deferredSha256']!=n.self_hash(v,'deferredSha256') or p!=PRIVATE/'deferred'/'sha256'/sha(raw)[:2]/f'{sha(raw)}.json':fail('deferred changed')
  out.append(v)
 return sorted(out,key=lambda x:x['requestSequence'])
def receipts(n,candidates):
 out=[]
 for c in candidates:
  p=n.receipt_path(c['candidateId'])
  if p.exists():v=json.loads(p.read_bytes());n.validate_receipt(v,c);out.append(v)
 out.sort(key=lambda x:x['requestSequence']);return out
def build_manifest(n,candidates):
 rs=receipts(n,candidates);ds=deferred_events(n,candidates);events=[(x['requestSequence'],f"R|{x['requestSequence']}|{x['candidateId']}|{x['receiptSha256']}") for x in rs]+[(x['requestSequence'],f"D|{x['requestSequence']}|{x['candidateId']}|{x['deferredSha256']}") for x in ds];events.sort()
 if [x[0] for x in events]!=list(range(1,len(events)+1)):fail('request sequence changed')
 def seq(vals):return sha(('\n'.join(vals)+('\n' if vals else '')).encode())
 m={'schema':'sec-liquidation-periodic-private-capture-manifest/v1','contractRawSha256':CONTRACT_RAW,'candidateCanonicalSha256':CANDIDATE_SHA,'expectedCandidates':24,'capturedCandidates':len(rs),'remainingCandidates':24-len(rs),'historicalDeferredEvents':len(ds),'complete':len(rs)==24,'maximumRequestSequence':events[-1][0] if events else 0,'requestEventSequenceSha256':seq([x[1] for x in events]),'receiptSequenceSha256':seq([x['receiptSha256'] for x in rs]),'rawBlobSequenceSha256':seq([x['rawSha256'] for x in rs]),'outcomesAccessed':False,'manifestSha256':''};m['manifestSha256']=n.self_hash(m,'manifestSha256');return m
def validate_manifest(n,m):
 exact(m,{'schema','contractRawSha256','candidateCanonicalSha256','expectedCandidates','capturedCandidates','remainingCandidates','historicalDeferredEvents','complete','maximumRequestSequence','requestEventSequenceSha256','receiptSequenceSha256','rawBlobSequenceSha256','outcomesAccessed','manifestSha256'},'manifest')
 if m['schema']!='sec-liquidation-periodic-private-capture-manifest/v1' or m['contractRawSha256']!=CONTRACT_RAW or m['candidateCanonicalSha256']!=CANDIDATE_SHA or m['expectedCandidates']!=24 or m['capturedCandidates']+m['remainingCandidates']!=24 or m['complete']!=(m['capturedCandidates']==24) or m['outcomesAccessed'] is not False or m['manifestSha256']!=n.self_hash(m,'manifestSha256'):fail('manifest changed')
def write_manifest(n,m):raw=n.encode_json(m);p=PRIVATE/'manifests'/'sha256'/m['manifestSha256'][:2]/f"{m['manifestSha256']}.json";n.atomic_create(p,raw);return p.relative_to(PRIVATE).as_posix()
def changed(c):o=git('diff-tree','--no-commit-id','--name-status','-r',c);return [tuple(x.split('\t',1)) for x in o.splitlines() if x]
def intro(p):o=git('log','--reverse','--format=%H','--diff-filter=A',f'{BASE}..HEAD','--',p.relative_to(ROOT).as_posix());return o.splitlines() if o else []
def verify_repo(remote):
 if not remote:fail('live remote mandatory')
 head=git('rev-parse','HEAD')
 if git('remote','get-url','origin')!=REMOTE or git('rev-parse','@{u}')!=head or git('ls-remote','--refs','origin',REF).split()!=[head,REF] or not ancestor(BASE,head):fail('remote topology changed')
 xs=[intro(p) for p in OWNED]
 if all(not x for x in xs):
  if head!=BASE:fail('pre introduction moved')
  return {'phase':'PRE_INTRODUCTION','introductionCommit':None,'remoteVerified':True,'captureAuthorized':False}
 if any(len(x)!=1 for x in xs) or len({x[0] for x in xs})!=1:fail('introduction split')
 i=xs[0][0]
 if git('show','-s','--format=%P',i).split()!=[BASE] or changed(i)!=[('A',p.relative_to(ROOT).as_posix()) for p in OWNED]:fail('introduction changed')
 if not ancestor(i,head):fail('introduction not ancestor')
 chain=git('rev-list','--first-parent',f'{i}..{head}').splitlines()
 for c in chain:
  if len(git('show','-s','--format=%P',c).split())!=1:fail('later history is not linear single-parent')
 for p in OWNED:
  if git_raw(i,p)!=p.read_bytes() or git_raw(head,p)!=p.read_bytes():fail('owned bytes changed')
 return {'phase':'POST_INTRODUCTION','introductionCommit':i,'remoteVerified':True,'captureAuthorized':True}
def reseal(v):x=copy.deepcopy(v);x['contractSha256']=self_hash(x,'contractSha256');return x
def rejected(f):
 try:f()
 except (E,KeyError,TypeError,ValueError,OSError,json.JSONDecodeError):return True
 return False
def self_test(v):
 ms={'purpose':lambda x:x.__setitem__('purpose','terminal'),'candidate':lambda x:x['captureContract'].__setitem__('candidateFilings',23),'retry':lambda x:x['captureContract'].__setitem__('retryCount',1),'public':lambda x:x['captureContract'].__setitem__('publicRawBytesAllowed',True),'content':lambda x:x['claimLocks'].__setitem__('contentInterpretationPerformed',True),'terminal':lambda x:x['claimLocks'].__setitem__('terminalWealthComplete',True),'outcome':lambda x:x['claimLocks'].__setitem__('outcomesAccessed',True),'unknown':lambda x:x['claimLocks'].__setitem__('unknownCredit',True),'network':lambda x:x['implementationContract'].__setitem__('productionCaptureRequiresPostIntroductionRemoteVerification',False)};ks={}
 for k,f in ms.items():x=copy.deepcopy(v);f(x);x=reseal(x);ks[k]=rejected(lambda x=x:validate_contract(x))
 if not all(ks.values()):fail('kill failed')
 return ks
def capture():
 repo=verify_repo(True)
 if not repo['captureAuthorized']:fail('capture unauthorized')
 n,c,_=load_inputs(git('rev-parse','HEAD'));n.ensure_private_root();rs=receipts(n,c);ds=deferred_events(n,c);events=rs+ds;seq=max([x['requestSequence'] for x in events],default=0)+1;requests=0;last=0.;status='PASS'
 for candidate in c:
  if n.receipt_path(candidate['candidateId']).exists():continue
  wait=n.MIN_INTERVAL_SECONDS-(time.monotonic()-last)
  if wait>0:time.sleep(wait)
  requests+=1
  try:raw,headers,_=n.fetch(candidate,seq)
  except n.RateDeferred as e:
   x={'schema':'sec-liquidation-downstream-private-deferred/v1','candidateId':e.candidate_id,'url':e.url,'httpStatus':e.status,'responseHeaders':e.headers,'requestSequence':seq,'outcomesAccessed':False,'deferredSha256':''};x['deferredSha256']=n.self_hash(x,'deferredSha256');b=n.encode_json(x);h=sha(b);n.atomic_create(PRIVATE/'deferred'/'sha256'/h[:2]/f'{h}.json',b);status='DEFERRED';break
  last=time.monotonic();h=sha(raw);n.atomic_create(n.blob_path(h),raw);r=n.make_receipt(candidate,n.candidate_url(candidate),time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),headers,raw,seq);n.atomic_create(n.receipt_path(candidate['candidateId']),n.encode_json(r));seq+=1
 m=build_manifest(n,c);validate_manifest(n,m);mp=write_manifest(n,m)
 if status=='PASS' and not m['complete']:status='INCOMPLETE'
 return {'schema':'sec-liquidation-periodic-filing-capture/v1','status':status,**repo,'requests':requests,'capturedCandidates':m['capturedCandidates'],'remainingCandidates':m['remainingCandidates'],'maximumRequestSequence':m['maximumRequestSequence'],'manifestSha256':m['manifestSha256'],'manifestPath':mp,'outcomesAccessed':False}
def main():
 p=argparse.ArgumentParser();p.add_argument('command',choices=('verify-contract','dry-run','self-test','capture'));p.add_argument('--remote',action='store_true');a=p.parse_args()
 try:
  v=load_contract()
  if a.command=='capture':out=capture()
  else:
   repo=verify_repo(a.remote);n,c,l=load_inputs(git('rev-parse','HEAD'));m=build_manifest(n,c);validate_manifest(n,m)
   out={'schema':'sec-liquidation-periodic-filing-capture-check/v1','status':'PASS',**repo,'candidateFilings':len(c),'caseCandidateLinks':len(l),'capturedCandidates':m['capturedCandidates'],'remainingCandidates':m['remainingCandidates'],'historicalDeferredEvents':m['historicalDeferredEvents'],'maximumRequestSequence':m['maximumRequestSequence'],'manifestSha256':m['manifestSha256'],'networkRequests':0,'writes':0,'outcomesAccessed':False}
   if a.command=='self-test':out['mutationKills']=self_test(v)
 except (E,KeyError,TypeError,ValueError,OSError,json.JSONDecodeError) as e:p.error(str(e))
 print(json.dumps(out,sort_keys=True));return 0
if __name__=='__main__':raise SystemExit(main())
