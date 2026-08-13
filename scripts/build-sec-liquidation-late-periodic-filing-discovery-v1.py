#!/usr/bin/env python3
"""Discover every classic periodic SEC filing after day 455 for 17 liquidation cases."""
from __future__ import annotations
import argparse, copy, datetime as dt, hashlib, importlib.util, json, re, sqlite3, subprocess
from collections import Counter
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
CONTRACT=ROOT/'research'/'early-detection-v4'/'sec-liquidation-late-periodic-filing-discovery-contract-v1.json'
BUILDER=Path(__file__).resolve(); TEST=ROOT/'tests'/'build-sec-liquidation-late-periodic-filing-discovery-v1.test.js'
BASE_BUILDER=ROOT/'scripts'/'build-sec-liquidation-downstream-filing-discovery-v1.py'; OWNED=(CONTRACT,BUILDER,TEST)
CONTRACT_RAW='259ea5895a7f87f2c93124f347d92295a2e92d73aed1f601cccfe673262ea2f2'
CONTRACT_SELF='fa1be309507356ee8069f935536091aa5e963ecd859a14a9316784831464787a'
TEST_RAW='fca879bdf535a5f93730e5e353b9f738bc4f244c68518fab25f2d6980261a995'
BASE='f8ec39ac8b11802050108d43b0ee9bf8dc7eb4e8'; REMOTE='https://github.com/Karlryl/screener-data.git'; REF='refs/heads/codex/early-detection-v4-gates-20260810'
CREATED_AT='2026-08-13T15:34:00Z'; BASE_BUILDER_RAW='69fcca3f46e993af4a78188a78b7726477e74f10c21968e65bfff2679ed945a9'
FORMS=('N-CSR','N-CSRS','N-Q','NSAR-A','NSAR-B')
PURPOSE='Pre-seal every official classic periodic SEC accounting filing indexed under the four exact SEC-header-verified issuer CIKs from calendar day 456 after seventeen frozen liquidation-payment dates through the complete bound SEC master-index cutoff of 2024-12-31, before fetching or inspecting any candidate content.'
LOCKS={'candidateContentFetched':False,'candidateContentInspected':False,'sameSecurityVerified':False,'securityIdentityResolved':False,'additionalDistributionVerified':False,'noFurtherPaymentsVerified':False,'laterRecoveriesExcluded':False,'completeCorporateActionChainVerified':False,'terminalWealthComplete':False,'originalV4GateCredit':False,'resultComputationAllowed':False,'pricesAccessed':False,'returnsAccessed':False,'outcomesAccessed':False}
class E(RuntimeError):pass
def fail(x):raise E(x)
def sha(x:bytes)->str:return hashlib.sha256(x).hexdigest()
def canonical(x):return json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
def self_hash(x,f):y=dict(x);y.pop(f,None);return sha(canonical(y))
def exact(x,k,l):
 if type(x) is not dict or set(x)!=set(k):fail(l+' exact keys changed')
def normalized(raw):
 s=raw.decode().replace('\r\n','\n')
 for n in ('CONTRACT_RAW','CONTRACT_SELF','TEST_RAW'):
  p=re.compile(rf"^{n}='[0-9a-f]{{64}}'$",re.M)
  if len(p.findall(s))!=1:fail(n+' normalization changed')
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
def load_base(head):
 raw=BASE_BUILDER.read_bytes()
 if sha(raw)!=BASE_BUILDER_RAW or git_raw(head,BASE_BUILDER)!=raw:fail('base builder changed')
 s=importlib.util.spec_from_file_location('base_late_periodic',BASE_BUILDER);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def expected_rebuild():return {'seedCases':17,'issuerCiks':4,'windowStartDayInclusive':456,'databaseFiledDateMaximumInclusive':'2024-12-31','allowedForms':list(FORMS),'candidateFilings':122,'candidateAccessions':122,'caseCandidateLinks':519,'uniqueCaseCandidateLinks':519,'minimumDayOffset':457,'maximumDayOffset':3717,'filedDateMinimum':'2015-12-30','filedDateMaximum':'2024-12-05','candidateSourceQuarterMinimum':'2015q4','candidateSourceQuarterMaximum':'2024q4','candidateCanonicalSha256':'2576cd99eebddde4f41b2728167458c43799f3a0e4ddb038e941a95cd3d02e8c','linkCanonicalSha256':'2454b68eeb7534b95c4f7ae5da52d27e90093ccea0a30cfee1597a7e1236ce6c','candidateSequenceSha256':'2b3af3d2286e0c37261a1ac7299b06d7b00814f1cc09000820712949c0aa41b9','linkSequenceSha256':'33f2736cf5cbc3a04659f51355bc1650f1fc98f62ae71e7246ee27c4b8fa6f5f','formCounts':{'N-CSR':39,'N-CSRS':36,'N-Q':27,'NSAR-A':9,'NSAR-B':11},'issuerCandidateCounts':{'0001414040':31,'0001424958':31,'0001450011':30,'0001450501':30},'caseLinkCounts':{'LIQUIDATION-PAYMENT-001':31,'LIQUIDATION-PAYMENT-002':31,'LIQUIDATION-PAYMENT-003':31,'LIQUIDATION-PAYMENT-004':31,'LIQUIDATION-PAYMENT-005':31,'LIQUIDATION-PAYMENT-006':31,'LIQUIDATION-PAYMENT-007':31,'LIQUIDATION-PAYMENT-008':31,'LIQUIDATION-PAYMENT-009':31,'LIQUIDATION-PAYMENT-010':30,'LIQUIDATION-PAYMENT-011':30,'LIQUIDATION-PAYMENT-012':30,'LIQUIDATION-PAYMENT-013':30,'LIQUIDATION-PAYMENT-014':30,'LIQUIDATION-PAYMENT-015':30,'LIQUIDATION-PAYMENT-016':30,'LIQUIDATION-PAYMENT-017':30}}
def validate_contract(v):
 exact(v,{'schema','createdAt','taskId','track','purpose','authoritativeInput','selectionContract','expectedRebuild','claimLocks','implementationContract','contractSha256'},'contract')
 if (v['schema'],v['createdAt'],v['taskId'],v['track'])!=('sec-liquidation-late-periodic-filing-discovery-contract/v1',CREATED_AT,'Q003-SEC-LIQUIDATION-LATE-PERIODIC-FILING-DISCOVERY','SHARED_OUTCOME_BLIND_INFRA'):fail('identity changed')
 if v['purpose']!=PURPOSE:fail('purpose changed')
 inp={'baseDiscoveryBuilder':{'path':BASE_BUILDER.relative_to(ROOT).as_posix(),'rawSha256':BASE_BUILDER_RAW},'baseCommit':BASE,'databaseRawSha256':'3055d37b34033fd4bf0b4ee3c9fb3abb7bc2d88cd0e303795c764b0b4d39c159','databaseBytes':3344818176}
 sel={'joinKey':'EXACT_SEC_HEADER_VERIFIED_ISSUER_CIK','calendarDayOffsetMinimumInclusive':456,'databaseFiledDateMaximumInclusive':'2024-12-31','allowedClassicPeriodicForms':list(FORMS),'nportPExcludedForSeparateStructuredLane':True,'accessionMustBeNonNull':True,'allOtherFormsExcluded':True,'candidateContentFetched':False,'candidateContentInspected':False,'sameIssuerCikDoesNotProveSameSecurity':True}
 if v['authoritativeInput']!=inp or v['selectionContract']!=sel or v['expectedRebuild']!=expected_rebuild() or v['claimLocks']!=LOCKS:fail('input, selection, rebuild or locks changed')
 impl={'baseCommit':BASE,'baseTag':900,'remote':REMOTE,'ref':REF,'contractPath':CONTRACT.relative_to(ROOT).as_posix(),'builderPath':BUILDER.relative_to(ROOT).as_posix(),'testPath':TEST.relative_to(ROOT).as_posix(),'builderNormalizedSha256':sha(normalized(BUILDER.read_bytes())),'testRawSha256':TEST_RAW,'introductionMustBeDirectSingleParentChildOfBase':True,'introductionAddsExactlyThreeOwnedPaths':True,'laterLinearSingleParentDescendantsAllowed':True,'verificationRequiresLiveRemote':True,'networkCapabilityAllowed':False,'writeCapabilityAllowed':False}
 if v['implementationContract']!=impl:fail('implementation changed')
 if v['contractSha256']!=CONTRACT_SELF or self_hash(v,'contractSha256')!=CONTRACT_SELF:fail('self hash changed')
def load_contract():
 raw=CONTRACT.read_bytes()
 if sha(raw)!=CONTRACT_RAW:fail('contract raw changed')
 v=json.loads(raw);validate_contract(v);return v
def build_rows():
 head=git('rev-parse','HEAD');base=load_base(head);recon=base.load_reconciliation_rows();seeds=sorted([{k:r[k] for k in base.SEED_KEYS} for r in recon],key=lambda x:x['caseId'])
 side=[Path(str(base.DATABASE)+x) for x in ('-wal','-shm','-journal')]
 if any(x.exists() for x in side):fail('database sidecar before read')
 with base.locked_database():
  before=base.database_hash()
  if before!=base.DATABASE_RAW:fail('database changed before read')
  con=sqlite3.connect(f'file:{base.DATABASE.as_posix()}?mode=ro&immutable=1',uri=True);con.execute('pragma query_only=on')
  if con.execute('pragma quick_check').fetchone()!=('ok',):fail('database quick_check failed')
  ciks=sorted({int(x['issuerCik']) for x in seeds});ph=','.join('?' for _ in ciks);fh=','.join('?' for _ in FORMS)
  rows=con.execute(f'''select f.cik,f.company_name,f.form,f.filed_date,f.filename,f.accession,p.quarter,p.payload_sha256,p.member_sha256,p.rows,f.row_number from filings f join payloads p on p.payload_id=f.payload_id where f.cik in ({ph}) and f.form in ({fh}) and f.filed_date<=? order by f.cik,f.filed_date,f.accession,f.form,f.filename,p.quarter,f.row_number''',[*ciks,*FORMS,'2024-12-31']).fetchall();con.close()
  if base.database_hash()!=before:fail('database changed during read')
 if any(x.exists() for x in side):fail('database sidecar after read')
 candidates={};links=[]
 for seed in seeds:
  start=dt.date.fromisoformat(seed['liquidationPaymentEffectiveDate'])
  for cik,name,form,filed,filename,acc,quarter,payload_sha,member_sha,payload_rows,row_number in rows:
   day=(dt.date.fromisoformat(filed)-start).days
   if cik!=int(seed['issuerCik']) or day<456 or acc is None:continue
   body={'cik':str(cik).zfill(10),'companyName':name,'form':form,'filedDate':filed,'filename':filename,'accession':acc,'sourceQuarter':quarter,'sourcePayloadSha256':payload_sha,'sourceMemberSha256':member_sha,'sourcePayloadRows':payload_rows,'sourceRowNumber':row_number}
   cid='SEC-LIQ-LATE-PERIODIC-'+sha(canonical(body));candidate={'candidateId':cid,**body}
   if cid in candidates and candidates[cid]!=candidate:fail('candidate collision')
   candidates[cid]=candidate;links.append({'caseId':seed['caseId'],'candidateId':cid,'dayOffset':day})
 cs=sorted(candidates.values(),key=lambda x:(x['filedDate'],x['accession'],x['form'],x['filename'],x['candidateId']));ls=sorted(links,key=lambda x:(x['caseId'],x['dayOffset'],x['candidateId']))
 stats={'seedCases':len(seeds),'issuerCiks':len({x['issuerCik'] for x in seeds}),'windowStartDayInclusive':456,'databaseFiledDateMaximumInclusive':'2024-12-31','allowedForms':list(FORMS),'candidateFilings':len(cs),'candidateAccessions':len({x['accession'] for x in cs}),'caseCandidateLinks':len(ls),'uniqueCaseCandidateLinks':len({(x['caseId'],x['candidateId']) for x in ls}),'minimumDayOffset':min(x['dayOffset'] for x in ls),'maximumDayOffset':max(x['dayOffset'] for x in ls),'filedDateMinimum':min(x['filedDate'] for x in cs),'filedDateMaximum':max(x['filedDate'] for x in cs),'candidateSourceQuarterMinimum':min(x['sourceQuarter'] for x in cs),'candidateSourceQuarterMaximum':max(x['sourceQuarter'] for x in cs),'candidateCanonicalSha256':sha(canonical(cs)),'linkCanonicalSha256':sha(canonical(ls)),'candidateSequenceSha256':sha(('\n'.join(x['candidateId'] for x in cs)+'\n').encode()),'linkSequenceSha256':sha(('\n'.join(f"{x['caseId']}|{x['candidateId']}|{x['dayOffset']}" for x in ls)+'\n').encode()),'formCounts':dict(sorted(Counter(x['form'] for x in cs).items())),'issuerCandidateCounts':dict(sorted(Counter(x['cik'] for x in cs).items())),'caseLinkCounts':dict(sorted(Counter(x['caseId'] for x in ls).items()))}
 if stats!=expected_rebuild():fail('source rebuild changed')
 return cs,ls,stats
def changed(c):
 o=git('diff-tree','--no-commit-id','--name-status','-r',c);return [tuple(x.split('\t',1)) for x in o.splitlines() if x]
def intro(p):
 o=git('log','--reverse','--format=%H','--diff-filter=A',f'{BASE}..HEAD','--',p.relative_to(ROOT).as_posix());return o.splitlines() if o else []
def verify_repo(remote):
 if not remote:fail('live remote mandatory')
 if git('remote','get-url','origin')!=REMOTE:fail('origin changed')
 head=git('rev-parse','HEAD')
 if git('rev-parse','@{u}')!=head or git('ls-remote','--refs','origin',REF).split()!=[head,REF]:fail('HEAD upstream remote differ')
 if not ancestor(BASE,head):fail('base not ancestor')
 xs=[intro(p) for p in OWNED]
 if all(not x for x in xs):
  if head!=BASE:fail('pre-introduction moved')
  return {'phase':'PRE_INTRODUCTION','introductionCommit':None,'remoteVerified':True}
 if any(len(x)!=1 for x in xs) or len({x[0] for x in xs})!=1:fail('introduction differs')
 i=xs[0][0]
 if git('show','-s','--format=%P',i).split()!=[BASE] or changed(i)!=[('A',p.relative_to(ROOT).as_posix()) for p in OWNED]:fail('introduction topology changed')
 prev=i
 for c in git('rev-list','--reverse','--first-parent',f'{i}..{head}').splitlines():
  if git('show','-s','--format=%P',c).split()!=[prev]:fail('history nonlinear')
  prev=c
 for p in OWNED:
  if git_raw(i,p)!=p.read_bytes() or git_raw(head,p)!=p.read_bytes():fail('owned bytes changed')
 return {'phase':'POST_INTRODUCTION','introductionCommit':i,'remoteVerified':True}
def reseal(v):x=copy.deepcopy(v);x['contractSha256']=self_hash(x,'contractSha256');return x
def rejected(f):
 try:f()
 except (E,KeyError,TypeError,ValueError,OSError,sqlite3.Error,json.JSONDecodeError):return True
 return False
def self_test(v):
 ms={'backdated':lambda x:x.__setitem__('createdAt','1970-01-01T00:00:00Z'),'purpose':lambda x:x.__setitem__('purpose','terminal wealth'),'start':lambda x:x['selectionContract'].__setitem__('calendarDayOffsetMinimumInclusive',455),'cutoff':lambda x:x['selectionContract'].__setitem__('databaseFiledDateMaximumInclusive','2025-12-31'),'nport':lambda x:x['selectionContract'].__setitem__('nportPExcludedForSeparateStructuredLane',False),'form':lambda x:x['selectionContract']['allowedClassicPeriodicForms'].append('NPORT-P'),'candidateLoss':lambda x:x['expectedRebuild'].__setitem__('candidateFilings',121),'linkLoss':lambda x:x['expectedRebuild'].__setitem__('caseCandidateLinks',518),'content':lambda x:x['claimLocks'].__setitem__('candidateContentInspected',True),'sameSecurity':lambda x:x['claimLocks'].__setitem__('sameSecurityVerified',True),'recovery':lambda x:x['claimLocks'].__setitem__('laterRecoveriesExcluded',True),'outcome':lambda x:x['claimLocks'].__setitem__('outcomesAccessed',True),'unknown':lambda x:x['claimLocks'].__setitem__('unknownCredit',True),'network':lambda x:x['implementationContract'].__setitem__('networkCapabilityAllowed',True),'builder':lambda x:x['implementationContract'].__setitem__('builderNormalizedSha256','0'*64)}
 kills={}
 for n,m in ms.items():x=copy.deepcopy(v);m(x);x=reseal(x);kills[n]=rejected(lambda x=x:validate_contract(x))
 if not all(kills.values()):fail('kill failed')
 return kills
def main():
 a=argparse.ArgumentParser();a.add_argument('command',choices=('verify-contract','dry-run','self-test'));a.add_argument('--remote',action='store_true');z=a.parse_args()
 try:
  v=load_contract();r=verify_repo(z.remote);_c,_l,stats=build_rows()
  if z.command=='self-test':out={'schema':'sec-liquidation-late-periodic-filing-discovery-self-test/v1','status':'PASS',**r,'mutationKills':self_test(v),'outcomesAccessed':False}
  else:out={'schema':'sec-liquidation-late-periodic-filing-discovery/v1','status':'PASS',**r,**stats,'networkRequests':0,'writes':0,'outcomesAccessed':False}
 except (E,KeyError,TypeError,ValueError,OSError,sqlite3.Error,json.JSONDecodeError) as e:a.error(str(e))
 print(json.dumps(out,sort_keys=True));return 0
if __name__=='__main__':raise SystemExit(main())
