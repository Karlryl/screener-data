#!/usr/bin/env python3
"""Capture the sealed NPORT-P lane into a private restartable CAS."""
from __future__ import annotations
import argparse,copy,datetime,hashlib,http.client,importlib.util,json,os,re,sqlite3,subprocess,tempfile,time,urllib.error
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
CONTRACT=ROOT/'research'/'early-detection-v4'/'sec-liquidation-late-nport-filing-capture-contract-v1.json';RUNNER=Path(__file__).resolve();TEST=ROOT/'tests'/'capture-sec-liquidation-late-nport-filings-v1.test.js'
DISCOVERY_CONTRACT=ROOT/'research'/'early-detection-v4'/'sec-liquidation-late-nport-filing-discovery-contract-v1.json';DISCOVERY=ROOT/'scripts'/'build-sec-liquidation-late-nport-filing-discovery-v1.py';DISCOVERY_TEST=ROOT/'tests'/'build-sec-liquidation-late-nport-filing-discovery-v1.test.js';NETWORK=ROOT/'scripts'/'capture-sec-liquidation-downstream-filings-v1.py'
PRIVATE=Path(r'C:\Users\Anwender\Documents\GrowthScreenerResearchData\early-detection-v4\liquidation-late-nport-sec-originals-v1');OWNED=(CONTRACT,RUNNER,TEST)
CONTRACT_RAW='b0c473222f06956d736a5752d2df6af859e2ec96499bdf62053428c329d94f56'
CONTRACT_SELF='25eb3e71a1d9b2b8c6cd2c3081b6538d4b8de9038a5e30c55e614c8fab7e94a2'
TEST_RAW='3b73edf88b38bb9b78dff067fd8cb7418287b0e4e920dad9661234e05fe8c248'
BASE='ccc15de0666e605e7a3a211dead6c9f8e8b05ea9';REMOTE='https://github.com/Karlryl/screener-data.git';REF='refs/heads/codex/early-detection-v4-gates-20260810';CREATED_AT='2026-08-13T18:24:00Z'
DISCOVERY_CONTRACT_RAW='784497e41c3f6b09323a5099c91cdb7dd01073b0fa945079f176281184f112b0';DISCOVERY_RAW='1a4f34bc70dff0d95fb7547d94b215e74ad2575c14554bb84c945d18407bdb66';DISCOVERY_TEST_RAW='bf4bb61c433b42da6aff743a1ddb20c5de409f1e34caaf235b9428439969f418';NETWORK_RAW='4e36f022144f31defc129ec059b717a9c4a219cc49c15905ab584f5c5e9ce7d7'
CANDIDATE_SHA='894de4cbfdb9d574e65291f0556d5207c39b6f3d9debd6d9314bb6a54e420924';LINK_SHA='564bb64abd293600f7c9df5528bb3c50acc679dad8bee2a740d76e34b9abc99d';COUNT=2433;LINKS=11386;MAX_BYTES=500_000_000
PURPOSE='Capture exactly the 2,433 pre-sealed official NPORT-P and NPORT-P/A SEC submission URLs once each into a private restartable content-addressed store, without redirects, proxies, automatic retries, public raw bytes, content interpretation, holding interpretation, security linkage, recovery, terminal wealth, price, return, outcome or Original-V4 credit.'
LOCKS={'contentInterpretationPerformed':False,'holdingPresenceInterpreted':False,'sameSecurityVerified':False,'securityIdentityResolved':False,'additionalDistributionVerified':False,'noFurtherPaymentsVerified':False,'laterRecoveriesExcluded':False,'completeCorporateActionChainVerified':False,'terminalWealthComplete':False,'originalV4GateCredit':False,'resultComputationAllowed':False,'pricesAccessed':False,'returnsAccessed':False,'outcomesAccessed':False}
class E(RuntimeError):pass
def fail(x):raise E(x)
def sha(x):return hashlib.sha256(x).hexdigest()
def canonical(x):return json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
def exact(x,k,l):
 if type(x) is not dict or set(x)!=set(k):fail(l+' exact keys changed')
def self_hash(x,f):y=copy.deepcopy(x);y[f]=None;return sha(canonical(y))
def normalized(raw):
 s=raw.decode().replace('\r\n','\n')
 for n in ('CONTRACT_RAW','CONTRACT_SELF','TEST_RAW'):
  p=re.compile(rf"^{n}='[0-9a-f]{{64}}'",re.M)
  if len(p.findall(s))!=1:fail(n+' normalization changed')
  s=p.sub(f"{n}='{'0'*64}'",s)
 return s.encode()
def git(*a):
 r=subprocess.run(['git',*a],cwd=ROOT,capture_output=True,text=True,encoding='utf-8')
 if r.returncode:fail(r.stderr.strip() or 'git failed')
 return r.stdout.strip()
def git_raw(c,p):
 r=subprocess.run(['git','show',f'{c}:{p.relative_to(ROOT).as_posix()}'],cwd=ROOT,capture_output=True)
 if r.returncode:fail('Git blob unavailable '+p.name)
 return r.stdout
def ancestor(a,b):return subprocess.run(['git','merge-base','--is-ancestor',a,b],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0
def module(name,p,h,head):
 raw=p.read_bytes()
 if sha(raw)!=h or git_raw(head,p)!=raw:fail(name+' bytes changed')
 s=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def expected_inputs():return {'discoveryContract':{'path':DISCOVERY_CONTRACT.relative_to(ROOT).as_posix(),'rawSha256':DISCOVERY_CONTRACT_RAW,'introductionCommit':BASE},'discoveryBuilder':{'path':DISCOVERY.relative_to(ROOT).as_posix(),'rawSha256':DISCOVERY_RAW},'discoveryTest':{'path':DISCOVERY_TEST.relative_to(ROOT).as_posix(),'rawSha256':DISCOVERY_TEST_RAW},'networkImplementation':{'path':NETWORK.relative_to(ROOT).as_posix(),'rawSha256':NETWORK_RAW},'candidateFilings':COUNT,'candidateCanonicalSha256':CANDIDATE_SHA,'caseCandidateLinks':LINKS,'linkCanonicalSha256':LINK_SHA}
def validate_contract(v,exact_artifact=True):
 exact(v,{'schema','createdAt','taskId','track','purpose','contractSelfSha256','inputs','networkPolicy','privateCapture','claimLocks','implementationContract'},'contract')
 if (v['schema'],v['createdAt'],v['taskId'],v['track'],v['purpose'])!=('sec-liquidation-late-nport-filing-capture-contract/v1',CREATED_AT,'Q003-SEC-LIQUIDATION-LATE-NPORT-FILING-CAPTURE','SHARED_OUTCOME_BLIND_INFRA',PURPOSE):fail('identity changed')
 try:created=datetime.datetime.strptime(CREATED_AT,'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=datetime.timezone.utc)
 except ValueError:fail('createdAt changed')
 if created>datetime.datetime.now(datetime.timezone.utc) or v['contractSelfSha256']!=CONTRACT_SELF or self_hash(v,'contractSelfSha256')!=CONTRACT_SELF:fail('contract self or time changed')
 net={'secContactEnvironmentVariable':'SEC_CONTACT','contactMustContainEmail':True,'requestsPerUncapturedCandidatePerInvocation':1,'maximumRequestsPerInvocation':COUNT,'automaticRetryWithinInvocation':False,'minimumIntervalMilliseconds':250,'requestTimeoutSeconds':120,'maximumResponseBytes':MAX_BYTES,'acceptEncoding':'identity','proxyEnvironmentIgnored':True,'redirectsAllowed':False,'allowedHttpStatus':[200],'rateDeferredHttpStatuses':[403,429,503],'contentTypePrefixAllowlist':['text/plain','application/octet-stream','text/html'],'everyFailureMustPersistIncidentAndStopInvocation':True,'partialResponseBytesPersisted':False}
 private={'absoluteRoot':str(PRIVATE),'mustBeOutsideEveryGitWorktree':True,'rawBlobLayout':'blobs/sha256/<first2>/<sha256>','receiptLayout':'receipts/<candidateId>.json','incidentLayout':'incidents/request-<zero-padded-sequence>.json','manifestLayout':'manifests/sha256/<first2>/<manifestSha256>.json','atomicCreateNew':True,'existingBytesMustMatch':True,'publicRawBytesAllowed':False,'publicReceiptsAllowed':False,'stdoutRawBytesAllowed':False,'stdoutCandidateRowsAllowed':False}
 impl={'baseCommit':BASE,'baseTag':909,'remote':REMOTE,'ref':REF,'contractPath':CONTRACT.relative_to(ROOT).as_posix(),'runnerPath':RUNNER.relative_to(ROOT).as_posix(),'testPath':TEST.relative_to(ROOT).as_posix(),'runnerNormalizedSha256':sha(normalized(RUNNER.read_bytes())),'testRawSha256':TEST_RAW,'introductionMustBeDirectSingleParentChildOfBase':True,'introductionAddsExactlyThreeOwnedPaths':True,'laterLinearSingleParentDescendantsAllowed':True,'productionCaptureRequiresPostIntroductionRemoteVerification':True,'dryRunMustUseZeroNetworkAndZeroWrites':True}
 if v['inputs']!=expected_inputs() or v['networkPolicy']!=net or v['privateCapture']!=private or v['claimLocks']!=LOCKS or v['implementationContract']!=impl:fail('contract semantics changed')
 if exact_artifact and (sha(CONTRACT.read_bytes())!=CONTRACT_RAW or sha(TEST.read_bytes())!=TEST_RAW):fail('contract or test bytes changed')
def load_contract():v=json.loads(CONTRACT.read_bytes());validate_contract(v);return v
def load_inputs(head):
 d=module('nport_discovery',DISCOVERY,DISCOVERY_RAW,head);n=module('nport_network',NETWORK,NETWORK_RAW,head)
 if sha(DISCOVERY_CONTRACT.read_bytes())!=DISCOVERY_CONTRACT_RAW or git_raw(head,DISCOVERY_CONTRACT)!=DISCOVERY_CONTRACT.read_bytes() or sha(DISCOVERY_TEST.read_bytes())!=DISCOVERY_TEST_RAW or git_raw(head,DISCOVERY_TEST)!=DISCOVERY_TEST.read_bytes():fail('discovery dependency changed')
 base=d.load_base(head);seeds=sorted([{k:r[k] for k in base.SEED_KEYS} for r in base.load_reconciliation_rows()],key=lambda x:x['caseId']);ciks=sorted({int(x['issuerCik']) for x in seeds});ph=','.join('?' for _ in ciks);fh=','.join('?' for _ in d.FORMS)
 with base.locked_database():
  before=base.database_hash();con=sqlite3.connect(f'file:{base.DATABASE.as_posix()}?mode=ro&immutable=1',uri=True);con.execute('pragma query_only=on');rows=con.execute(f'''select f.cik,f.company_name,f.form,f.filed_date,f.filename,f.accession,p.quarter,p.payload_sha256,p.member_sha256,p.rows,f.row_number from filings f join payloads p on p.payload_id=f.payload_id where f.cik in ({ph}) and f.form in ({fh}) and f.filed_date<=? order by f.cik,f.filed_date,f.accession,f.form,f.filename,p.quarter,f.row_number''',[*ciks,*d.FORMS,'2024-12-31']).fetchall();con.close()
  if before!=base.DATABASE_RAW or base.database_hash()!=before:fail('database changed')
 cs={};ls=[]
 for seed in seeds:
  start=datetime.date.fromisoformat(seed['liquidationPaymentEffectiveDate'])
  for cik,name,form,filed,filename,acc,quarter,pay,mem,pr,rn in rows:
   day=(datetime.date.fromisoformat(filed)-start).days
   if cik!=int(seed['issuerCik']) or day<456 or acc is None:continue
   body={'cik':str(cik).zfill(10),'companyName':name,'form':form,'filedDate':filed,'filename':filename,'accession':acc,'sourceQuarter':quarter,'sourcePayloadSha256':pay,'sourceMemberSha256':mem,'sourcePayloadRows':pr,'sourceRowNumber':rn};cid='SEC-LIQ-LATE-NPORTP-'+sha(canonical(body));cs[cid]={'candidateId':cid,**body};ls.append({'caseId':seed['caseId'],'candidateId':cid,'dayOffset':day})
 cs=sorted(cs.values(),key=lambda x:(x['filedDate'],x['accession'],x['form'],x['filename'],x['candidateId']));ls=sorted(ls,key=lambda x:(x['caseId'],x['dayOffset'],x['candidateId']))
 if len(cs)!=COUNT or len(ls)!=LINKS or sha(canonical(cs))!=CANDIDATE_SHA or sha(canonical(ls))!=LINK_SHA:fail('candidate population changed')
 n.PRIVATE_ROOT=PRIVATE;return n,cs,ls
def ensure_private(n):n.ensure_private_root();PRIVATE.mkdir(parents=True,exist_ok=True)
def receipt_path(cid):return PRIVATE/'receipts'/f'{cid}.json'
def incident_path(seq):return PRIVATE/'incidents'/f'request-{seq:08d}.json'
def blob_path(h):return PRIVATE/'blobs'/'sha256'/h[:2]/h
def encode(x):return json.dumps(x,ensure_ascii=False,sort_keys=True,indent=2).encode()+b'\n'
def receipt(candidate,url,headers,raw,seq):
 x={'schema':'sec-liquidation-late-nport-private-receipt/v1','candidateId':candidate['candidateId'],'url':url,'capturedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'httpStatus':200,'responseHeaders':headers,'rawSha256':sha(raw),'rawBytes':len(raw),'blobRelativePath':blob_path(sha(raw)).relative_to(PRIVATE).as_posix(),'requestSequence':seq,'outcomesAccessed':False,'receiptSha256':None};x['receiptSha256']=self_hash(x,'receiptSha256');return x
def validate_receipt(x,candidate,n):
 exact(x,{'schema','candidateId','url','capturedAt','httpStatus','responseHeaders','rawSha256','rawBytes','blobRelativePath','requestSequence','outcomesAccessed','receiptSha256'},'receipt')
 if x['schema']!='sec-liquidation-late-nport-private-receipt/v1' or x['candidateId']!=candidate['candidateId'] or x['url']!=n.candidate_url(candidate) or x['httpStatus']!=200 or x['outcomesAccessed'] is not False or x['receiptSha256']!=self_hash(x,'receiptSha256'):fail('receipt changed')
 p=PRIVATE/x['blobRelativePath'];raw=p.read_bytes()
 if p!=blob_path(x['rawSha256']) or len(raw)!=x['rawBytes'] or sha(raw)!=x['rawSha256']:fail('receipt blob changed')
def load_events(candidates,n):
 by={x['candidateId']:x for x in candidates};rs=[];incs=[]
 for p in (PRIVATE/'receipts').glob('*.json'):
  x=json.loads(p.read_bytes())
  if x.get('candidateId') not in by or p!=receipt_path(x['candidateId']):fail('unknown receipt')
  validate_receipt(x,by[x['candidateId']],n);rs.append(x)
 for p in (PRIVATE/'incidents').glob('request-*.json'):
  x=json.loads(p.read_bytes());exact(x,{'schema','requestSequence','candidateId','url','incidentKind','httpStatus','responseHeaders','partialBytesReported','partialBytesPersisted','capturedAt','outcomesAccessed','incidentSha256'},'incident')
  if x['schema']!='sec-liquidation-late-nport-private-incident/v1' or x['candidateId'] not in by or x['url']!=n.candidate_url(by[x['candidateId']]) or x['partialBytesPersisted'] is not False or x['outcomesAccessed'] is not False or x['incidentSha256']!=self_hash(x,'incidentSha256') or p!=incident_path(x['requestSequence']):fail('incident changed')
  incs.append(x)
 events=sorted([(x['requestSequence'],'R',x['candidateId'],x['receiptSha256']) for x in rs]+[(x['requestSequence'],'I',x['candidateId'],x['incidentSha256']) for x in incs])
 if [x[0] for x in events]!=list(range(1,len(events)+1)):fail('request sequence changed')
 if len({x['candidateId'] for x in rs})!=len(rs):fail('duplicate receipt')
 return sorted(rs,key=lambda x:x['requestSequence']),sorted(incs,key=lambda x:x['requestSequence']),events
def manifest(candidates,n):
 rs,incs,events=load_events(candidates,n);captured={x['candidateId'] for x in rs};seq=lambda xs:sha(('\n'.join(xs)+('\n' if xs else '')).encode());m={'schema':'sec-liquidation-late-nport-private-capture-manifest/v1','contractRawSha256':CONTRACT_RAW,'candidateCanonicalSha256':CANDIDATE_SHA,'expectedCandidates':COUNT,'capturedCandidates':len(rs),'remainingCandidates':COUNT-len(rs),'incidentCount':len(incs),'complete':len(rs)==COUNT,'maximumRequestSequence':events[-1][0] if events else 0,'requestEventSequenceSha256':seq([f'{a}|{b}|{c}|{d}' for a,b,c,d in events]),'receiptSequenceSha256':seq([x['receiptSha256'] for x in rs]),'rawBlobSequenceSha256':seq([x['rawSha256'] for x in rs]),'outcomesAccessed':False,'manifestSha256':None};m['manifestSha256']=self_hash(m,'manifestSha256');return m,captured
def persist_incident(n,candidate,seq,kind,status=None,headers=None,partial=None):
 x={'schema':'sec-liquidation-late-nport-private-incident/v1','requestSequence':seq,'candidateId':candidate['candidateId'],'url':n.candidate_url(candidate),'incidentKind':kind,'httpStatus':status,'responseHeaders':headers or {},'partialBytesReported':partial,'partialBytesPersisted':False,'capturedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'outcomesAccessed':False,'incidentSha256':None};x['incidentSha256']=self_hash(x,'incidentSha256');n.atomic_create(incident_path(seq),encode(x));return x
def fetch(n,candidate):
 url=n.candidate_url(candidate);req=n.urllib.request.Request(url,headers={'User-Agent':f'GrowthScreenerResearchData liquidation-late-nport/1.0 {n.contact()}','Accept-Encoding':'identity','Accept':'text/plain,application/octet-stream,text/html'})
 try:
  with n.OPENER.open(req,timeout=120) as response:
   if response.geturl()!=url:raise E('SEC response redirected')
   status=int(response.status);headers=n.safe_headers(response.headers)
   if status!=200:raise E('unexpected SEC status '+str(status))
   if not any(headers.get('content-type','').lower().startswith(x) for x in ('text/plain','application/octet-stream','text/html')):raise E('SEC content type changed')
   raw=response.read(MAX_BYTES+1)
 except urllib.error.HTTPError as e:
  if e.code in (403,429,503):raise n.RateDeferred(e.code,n.safe_headers(e.headers),candidate['candidateId'],url) from e
  raise E('unexpected SEC HTTP '+str(e.code)) from e
 if not raw or len(raw)>MAX_BYTES:raise E('SEC response size invalid')
 return raw,headers
def changed(c):return [tuple(x.split('\t',1)) for x in git('diff-tree','--no-commit-id','--name-status','-r',c).splitlines() if x]
def intro(p):x=git('log','--reverse','--format=%H','--diff-filter=A',f'{BASE}..HEAD','--',p.relative_to(ROOT).as_posix());return x.splitlines() if x else []
def verify_repo(remote):
 if not remote:fail('live remote mandatory')
 head=git('rev-parse','HEAD')
 if git('remote','get-url','origin')!=REMOTE or git('rev-parse','@{u}')!=head or git('ls-remote','--refs','origin',REF).split()!=[head,REF] or not ancestor(BASE,head):fail('remote changed')
 xs=[intro(p) for p in OWNED]
 if all(not x for x in xs):
  if head!=BASE:fail('pre-introduction moved')
  return {'phase':'PRE_INTRODUCTION','introductionCommit':None,'remoteVerified':True,'captureAuthorized':False}
 if any(len(x)!=1 for x in xs) or len({x[0] for x in xs})!=1:fail('introduction split')
 i=xs[0][0]
 if git('show','-s','--format=%P',i).split()!=[BASE] or changed(i)!=[('A',p.relative_to(ROOT).as_posix()) for p in OWNED]:fail('introduction changed')
 chain=git('rev-list','--reverse','--first-parent',f'{i}..{head}').splitlines();prev=i
 for c in chain:
  if git('show','-s','--format=%P',c).split()!=[prev]:fail('history nonlinear')
  prev=c
 for p in OWNED:
  if git_raw(i,p)!=p.read_bytes() or git_raw(head,p)!=p.read_bytes():fail('owned bytes changed')
 return {'phase':'POST_INTRODUCTION','introductionCommit':i,'remoteVerified':True,'captureAuthorized':True}
def reseal(v):x=copy.deepcopy(v);x['contractSelfSha256']=None;x['contractSelfSha256']=sha(canonical(x));return x
def rejected(f):
 try:f()
 except (E,KeyError,TypeError,ValueError,OSError,sqlite3.Error,json.JSONDecodeError):return True
 return False
def self_test(v,n):
 ms={'purpose':lambda x:x.__setitem__('purpose','terminal wealth'),'candidate':lambda x:x['inputs'].__setitem__('candidateFilings',2432),'retry':lambda x:x['networkPolicy'].__setitem__('automaticRetryWithinInvocation',True),'redirect':lambda x:x['networkPolicy'].__setitem__('redirectsAllowed',True),'proxy':lambda x:x['networkPolicy'].__setitem__('proxyEnvironmentIgnored',False),'partial':lambda x:x['networkPolicy'].__setitem__('partialResponseBytesPersisted',True),'public':lambda x:x['privateCapture'].__setitem__('publicRawBytesAllowed',True),'insideRepo':lambda x:x['privateCapture'].__setitem__('absoluteRoot',str(ROOT/'private')),'holding':lambda x:x['claimLocks'].__setitem__('holdingPresenceInterpreted',True),'terminal':lambda x:x['claimLocks'].__setitem__('terminalWealthComplete',True),'outcome':lambda x:x['claimLocks'].__setitem__('outcomesAccessed',True),'unknown':lambda x:x['claimLocks'].__setitem__('unknownCredit',True),'network':lambda x:x['implementationContract'].__setitem__('productionCaptureRequiresPostIntroductionRemoteVerification',False)};kills={}
 for k,f in ms.items():x=copy.deepcopy(v);f(x);x=reseal(x);kills[k]=rejected(lambda x=x:validate_contract(x,False))
 fixture={'candidateId':'SEC-LIQ-LATE-NPORTP-'+'0'*64,'filename':'edgar/data/1414040/0001143362-21-000001.txt','accession':'0001143362-21-000001'};kills['validUrl']=n.candidate_url(fixture)=='https://www.sec.gov/Archives/edgar/data/1414040/0001143362-21-000001.txt'
 try:n.candidate_url({**fixture,'accession':'0001143362-21-000002'})
 except n.CaptureError:kills['accessionMismatch']=True
 else:kills['accessionMismatch']=False
 kills['proxyDisabled']=all(not isinstance(h,n.urllib.request.ProxyHandler) or not h.proxies for h in n.OPENER.handlers)
 if not all(kills.values()):fail('self-test failed')
 return kills
def capture():
 repo=verify_repo(True)
 if not repo['captureAuthorized']:fail('capture unauthorized')
 n,candidates,_=load_inputs(git('rev-parse','HEAD'));ensure_private(n);m,captured=manifest(candidates,n);seq=m['maximumRequestSequence']+1;last=0.;requests=0;status='PASS'
 for candidate in candidates:
  if candidate['candidateId'] in captured:continue
  wait=.25-(time.monotonic()-last)
  if wait>0:time.sleep(wait)
  requests+=1
  try:raw,headers=fetch(n,candidate)
  except n.RateDeferred as e:persist_incident(n,candidate,seq,'HTTP_'+str(e.status)+'_DEFERRED',e.status,e.headers,None);status='DEFERRED';break
  except Exception as e:
   if not isinstance(e,(E,OSError,http.client.IncompleteRead,urllib.error.URLError,TimeoutError)):raise
   persist_incident(n,candidate,seq,type(e).__name__+':'+str(e));status='SOURCE_OR_TRANSPORT_DEFERRED';break
  last=time.monotonic();h=sha(raw);n.atomic_create(blob_path(h),raw);n.atomic_create(receipt_path(candidate['candidateId']),encode(receipt(candidate,n.candidate_url(candidate),headers,raw,seq)));seq+=1
 m,_=manifest(candidates,n);raw=encode(m);n.atomic_create(PRIVATE/'manifests'/'sha256'/m['manifestSha256'][:2]/f"{m['manifestSha256']}.json",raw)
 if status=='PASS' and not m['complete']:status='INCOMPLETE'
 return {'schema':'sec-liquidation-late-nport-filing-capture/v1','status':status,**repo,'requests':requests,'capturedCandidates':m['capturedCandidates'],'remainingCandidates':m['remainingCandidates'],'incidentCount':m['incidentCount'],'maximumRequestSequence':m['maximumRequestSequence'],'manifestSha256':m['manifestSha256'],'outcomesAccessed':False}
def main():
 p=argparse.ArgumentParser();p.add_argument('command',choices=('verify-contract','dry-run','self-test','capture'));p.add_argument('--remote',action='store_true');a=p.parse_args()
 try:
  v=load_contract();repo=verify_repo(a.remote)
  if a.command=='capture':out=capture()
  else:
   n,c,l=load_inputs(git('rev-parse','HEAD'));ensure_private(n);m,_=manifest(c,n);out={'schema':'sec-liquidation-late-nport-filing-capture-check/v1','status':'PASS',**repo,'candidateFilings':len(c),'caseCandidateLinks':len(l),'capturedCandidates':m['capturedCandidates'],'remainingCandidates':m['remainingCandidates'],'incidentCount':m['incidentCount'],'maximumRequestSequence':m['maximumRequestSequence'],'manifestSha256':m['manifestSha256'],'networkRequests':0,'writes':0,'outcomesAccessed':False}
   if a.command=='self-test':out['mutationKills']=self_test(v,n)
 except (E,KeyError,TypeError,ValueError,OSError,sqlite3.Error,json.JSONDecodeError) as e:p.error(str(e))
 print(json.dumps(out,sort_keys=True));return 0
if __name__=='__main__':raise SystemExit(main())
