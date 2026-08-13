#!/usr/bin/env python3
"""Discover the complete frozen NPORT-P/NPORT-P-A lane without reading filing content."""
from __future__ import annotations
import argparse,copy,datetime as dt,hashlib,importlib.util,json,re,sqlite3,subprocess
from collections import Counter
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
CONTRACT=ROOT/'research'/'early-detection-v4'/'sec-liquidation-late-nport-filing-discovery-contract-v1.json'
BUILDER=Path(__file__).resolve();TEST=ROOT/'tests'/'build-sec-liquidation-late-nport-filing-discovery-v1.test.js'
BASE_BUILDER=ROOT/'scripts'/'build-sec-liquidation-downstream-filing-discovery-v1.py'
CLASSIC=ROOT/'research'/'early-detection-v4'/'sec-liquidation-late-periodic-filing-discovery-contract-v1.json'
OWNED=(CONTRACT,BUILDER,TEST)
CONTRACT_RAW='784497e41c3f6b09323a5099c91cdb7dd01073b0fa945079f176281184f112b0';CONTRACT_SELF='4272ae9d541e430cb4c08f16b1151412cd52619b66ce083d27e43c63389c1ee9';TEST_RAW='bf4bb61c433b42da6aff743a1ddb20c5de409f1e34caaf235b9428439969f418'
BASE='c3187d1b1c3d376fd0906192bfac7c5a07910148';REMOTE='https://github.com/Karlryl/screener-data.git';REF='refs/heads/codex/early-detection-v4-gates-20260810';CREATED_AT='2026-08-13T18:06:05Z'
BASE_BUILDER_RAW='69fcca3f46e993af4a78188a78b7726477e74f10c21968e65bfff2679ed945a9';CLASSIC_RAW='259ea5895a7f87f2c93124f347d92295a2e92d73aed1f601cccfe673262ea2f2'
FORMS=('NPORT-P','NPORT-P/A');CLASSIC_FORMS=('N-CSR','N-CSRS','N-Q','NSAR-A','NSAR-B')
PURPOSE='Pre-seal every official NPORT-P and NPORT-P/A filing indexed under the four exact SEC-header-verified issuer CIKs from calendar day 456 after seventeen frozen liquidation-payment dates through the complete bound SEC master-index cutoff of 2024-12-31, before fetching or inspecting any candidate content.'
LOCKS={'candidateContentFetched':False,'candidateContentInspected':False,'sameSecurityVerified':False,'securityIdentityResolved':False,'holdingPresenceInterpreted':False,'additionalDistributionVerified':False,'noFurtherPaymentsVerified':False,'laterRecoveriesExcluded':False,'completeCorporateActionChainVerified':False,'terminalWealthComplete':False,'originalV4GateCredit':False,'resultComputationAllowed':False,'pricesAccessed':False,'returnsAccessed':False,'outcomesAccessed':False}
class E(RuntimeError):pass
def fail(x):raise E(x)
def sha(x:bytes)->str:return hashlib.sha256(x).hexdigest()
def canonical(x):return json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
def exact(x,k,l):
 if type(x) is not dict or set(x)!=set(k):fail(l+' exact keys changed')
def normalized(raw):
 s=raw.decode().replace('\r\n','\n')
 for n in ('CONTRACT_RAW','CONTRACT_SELF','TEST_RAW'):
  p=re.compile(rf"{n}='[0-9a-f]{{64}}'")
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
def expected_rebuild():return {'seedCases':17,'issuerCiks':4,'windowStartDayInclusive':456,'databaseFiledDateMaximumInclusive':'2024-12-31','allowedForms':list(FORMS),'candidateFilings':2433,'candidateAccessions':2433,'caseCandidateLinks':11386,'uniqueCaseCandidateLinks':11386,'minimumDayOffset':1877,'maximumDayOffset':3745,'filedDateMinimum':'2019-11-26','filedDateMaximum':'2024-12-30','candidateSourceQuarterMinimum':'2019q4','candidateSourceQuarterMaximum':'2024q4','candidateCanonicalSha256':'894de4cbfdb9d574e65291f0556d5207c39b6f3d9debd6d9314bb6a54e420924','linkCanonicalSha256':'564bb64abd293600f7c9df5528bb3c50acc679dad8bee2a740d76e34b9abc99d','candidateSequenceSha256':'85b307ec5023c7077970bb565ba2e7a6a8d6b14321ca25f9ceff7d34c3740af9','linkSequenceSha256':'98e90b89c0b20a349fd5a6e7573d799bd7440174cae5474198a4b085d927744c','formCounts':{'NPORT-P':2420,'NPORT-P/A':13},'issuerCandidateCounts':{'0001414040':401,'0001424958':1654,'0001450011':315,'0001450501':63},'caseLinkCounts':{'LIQUIDATION-PAYMENT-001':401,'LIQUIDATION-PAYMENT-002':401,'LIQUIDATION-PAYMENT-003':401,'LIQUIDATION-PAYMENT-004':401,'LIQUIDATION-PAYMENT-005':1654,'LIQUIDATION-PAYMENT-006':1654,'LIQUIDATION-PAYMENT-007':1654,'LIQUIDATION-PAYMENT-008':1654,'LIQUIDATION-PAYMENT-009':1654,'LIQUIDATION-PAYMENT-010':63,'LIQUIDATION-PAYMENT-011':63,'LIQUIDATION-PAYMENT-012':63,'LIQUIDATION-PAYMENT-013':63,'LIQUIDATION-PAYMENT-014':315,'LIQUIDATION-PAYMENT-015':315,'LIQUIDATION-PAYMENT-016':315,'LIQUIDATION-PAYMENT-017':315}}
def contract_self(v):
 x=copy.deepcopy(v);x['contractSelfSha256']=None;return sha(canonical(x))
def validate_contract(v,exact_artifact=True):
 exact(v,{'schema','createdAt','taskId','track','purpose','contractSelfSha256','authoritativeInput','selectionContract','expectedRebuild','claimLocks','implementationContract'},'contract')
 if (v['schema'],v['createdAt'],v['taskId'],v['track'],v['purpose'])!=('sec-liquidation-late-nport-filing-discovery-contract/v1',CREATED_AT,'Q003-SEC-LIQUIDATION-LATE-NPORT-FILING-DISCOVERY','SHARED_OUTCOME_BLIND_INFRA',PURPOSE):fail('contract identity changed')
 try:created=dt.datetime.strptime(CREATED_AT,'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=dt.timezone.utc)
 except ValueError:fail('createdAt changed')
 if created>dt.datetime.now(dt.timezone.utc) or v['contractSelfSha256']!=CONTRACT_SELF or contract_self(v)!=CONTRACT_SELF:fail('contract self or time changed')
 inp={'baseDiscoveryBuilder':{'path':BASE_BUILDER.relative_to(ROOT).as_posix(),'rawSha256':BASE_BUILDER_RAW},'classicLaneContract':{'path':CLASSIC.relative_to(ROOT).as_posix(),'rawSha256':CLASSIC_RAW},'baseCommit':BASE,'databaseRawSha256':'3055d37b34033fd4bf0b4ee3c9fb3abb7bc2d88cd0e303795c764b0b4d39c159','databaseBytes':3344818176}
 sel={'joinKey':'EXACT_SEC_HEADER_VERIFIED_ISSUER_CIK','calendarDayOffsetMinimumInclusive':456,'databaseFiledDateMaximumInclusive':'2024-12-31','allowedForms':list(FORMS),'noticeFormsExcluded':['NT NPORT-P'],'classicPeriodicFormsExcluded':list(CLASSIC_FORMS),'accessionMustBeNonNull':True,'allOtherFormsExcluded':True,'candidateContentFetched':False,'candidateContentInspected':False,'sameIssuerCikDoesNotProveSameSecurity':True,'structuredHoldingsDoNotProveTerminalDistributionOrRecovery':True}
 impl={'baseCommit':BASE,'baseTag':908,'remote':REMOTE,'ref':REF,'contractPath':CONTRACT.relative_to(ROOT).as_posix(),'builderPath':BUILDER.relative_to(ROOT).as_posix(),'testPath':TEST.relative_to(ROOT).as_posix(),'builderNormalizedSha256':sha(normalized(BUILDER.read_bytes())),'testRawSha256':TEST_RAW,'introductionMustBeDirectSingleParentChildOfBase':True,'introductionAddsExactlyThreeOwnedPaths':True,'laterLinearSingleParentDescendantsAllowed':True,'verificationRequiresLiveRemote':True,'networkCapabilityAllowed':False,'writeCapabilityAllowed':False}
 if v['authoritativeInput']!=inp or v['selectionContract']!=sel or v['expectedRebuild']!=expected_rebuild() or v['claimLocks']!=LOCKS or v['implementationContract']!=impl:fail('contract semantics changed')
 if exact_artifact and (sha(CONTRACT.read_bytes())!=CONTRACT_RAW or sha(TEST.read_bytes())!=TEST_RAW):fail('contract or test raw bytes changed')
def load_contract():v=json.loads(CONTRACT.read_bytes());validate_contract(v);return v
def load_base(head):
 raw=BASE_BUILDER.read_bytes()
 if sha(raw)!=BASE_BUILDER_RAW or git_raw(head,BASE_BUILDER)!=raw or sha(CLASSIC.read_bytes())!=CLASSIC_RAW or git_raw(head,CLASSIC)!=CLASSIC.read_bytes():fail('dependency bytes changed')
 s=importlib.util.spec_from_file_location('nport_base',BASE_BUILDER);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def build_rows():
 head=git('rev-parse','HEAD');base=load_base(head);seeds=sorted([{k:r[k] for k in base.SEED_KEYS} for r in base.load_reconciliation_rows()],key=lambda x:x['caseId']);side=[Path(str(base.DATABASE)+x) for x in ('-wal','-shm','-journal')]
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
   body={'cik':str(cik).zfill(10),'companyName':name,'form':form,'filedDate':filed,'filename':filename,'accession':acc,'sourceQuarter':quarter,'sourcePayloadSha256':payload_sha,'sourceMemberSha256':member_sha,'sourcePayloadRows':payload_rows,'sourceRowNumber':row_number};cid='SEC-LIQ-LATE-NPORTP-'+sha(canonical(body));candidate={'candidateId':cid,**body}
   if cid in candidates and candidates[cid]!=candidate:fail('candidate collision')
   candidates[cid]=candidate;links.append({'caseId':seed['caseId'],'candidateId':cid,'dayOffset':day})
 cs=sorted(candidates.values(),key=lambda x:(x['filedDate'],x['accession'],x['form'],x['filename'],x['candidateId']));ls=sorted(links,key=lambda x:(x['caseId'],x['dayOffset'],x['candidateId']))
 stats={'seedCases':len(seeds),'issuerCiks':len({x['issuerCik'] for x in seeds}),'windowStartDayInclusive':456,'databaseFiledDateMaximumInclusive':'2024-12-31','allowedForms':list(FORMS),'candidateFilings':len(cs),'candidateAccessions':len({x['accession'] for x in cs}),'caseCandidateLinks':len(ls),'uniqueCaseCandidateLinks':len({(x['caseId'],x['candidateId']) for x in ls}),'minimumDayOffset':min(x['dayOffset'] for x in ls),'maximumDayOffset':max(x['dayOffset'] for x in ls),'filedDateMinimum':min(x['filedDate'] for x in cs),'filedDateMaximum':max(x['filedDate'] for x in cs),'candidateSourceQuarterMinimum':min(x['sourceQuarter'] for x in cs),'candidateSourceQuarterMaximum':max(x['sourceQuarter'] for x in cs),'candidateCanonicalSha256':sha(canonical(cs)),'linkCanonicalSha256':sha(canonical(ls)),'candidateSequenceSha256':sha(('\n'.join(x['candidateId'] for x in cs)+'\n').encode()),'linkSequenceSha256':sha(('\n'.join(f"{x['caseId']}|{x['candidateId']}|{x['dayOffset']}" for x in ls)+'\n').encode()),'formCounts':dict(sorted(Counter(x['form'] for x in cs).items())),'issuerCandidateCounts':dict(sorted(Counter(x['cik'] for x in cs).items())),'caseLinkCounts':dict(sorted(Counter(x['caseId'] for x in ls).items()))}
 if stats!=expected_rebuild():fail('source rebuild changed')
 return stats
def changed(c):return [tuple(x.split('\t',1)) for x in git('diff-tree','--no-commit-id','--name-status','-r',c).splitlines() if x]
def intro(p):x=git('log','--reverse','--format=%H','--diff-filter=A',f'{BASE}..HEAD','--',p.relative_to(ROOT).as_posix());return x.splitlines() if x else []
def verify_repo(remote):
 if not remote:fail('live remote mandatory')
 head=git('rev-parse','HEAD')
 if git('remote','get-url','origin')!=REMOTE or git('rev-parse','@{u}')!=head or git('ls-remote','--refs','origin',REF).split()!=[head,REF] or not ancestor(BASE,head):fail('repository or remote changed')
 xs=[intro(p) for p in OWNED]
 if all(not x for x in xs):
  if head!=BASE:fail('pre-introduction moved')
  return {'phase':'PRE_INTRODUCTION','introductionCommit':None,'remoteVerified':True}
 if any(len(x)!=1 for x in xs) or len({x[0] for x in xs})!=1:fail('introduction split')
 i=xs[0][0]
 if git('show','-s','--format=%P',i).split()!=[BASE] or changed(i)!=[('A',p.relative_to(ROOT).as_posix()) for p in OWNED]:fail('introduction topology changed')
 chain=git('rev-list','--reverse','--first-parent',f'{i}..{head}').splitlines();prev=i
 for c in chain:
  if git('show','-s','--format=%P',c).split()!=[prev]:fail('history nonlinear')
  prev=c
 for p in OWNED:
  if git_raw(i,p)!=p.read_bytes() or git_raw(head,p)!=p.read_bytes():fail('owned bytes changed')
 return {'phase':'POST_INTRODUCTION','introductionCommit':i,'remoteVerified':True}
def reseal(v):x=copy.deepcopy(v);x['contractSelfSha256']=None;x['contractSelfSha256']=sha(canonical(x));return x
def rejected(f):
 try:f()
 except (E,KeyError,TypeError,ValueError,OSError,sqlite3.Error,json.JSONDecodeError):return True
 return False
def self_test(v):
 ms={'backdated':lambda x:x.__setitem__('createdAt','1970-01-01T00:00:00Z'),'purpose':lambda x:x.__setitem__('purpose','terminal wealth complete'),'start':lambda x:x['selectionContract'].__setitem__('calendarDayOffsetMinimumInclusive',455),'cutoff':lambda x:x['selectionContract'].__setitem__('databaseFiledDateMaximumInclusive','2025-12-31'),'dropAmendments':lambda x:x['selectionContract'].__setitem__('allowedForms',['NPORT-P']),'notice':lambda x:x['selectionContract']['allowedForms'].append('NT NPORT-P'),'classic':lambda x:x['selectionContract']['allowedForms'].append('N-CSR'),'candidateLoss':lambda x:x['expectedRebuild'].__setitem__('candidateFilings',2432),'linkLoss':lambda x:x['expectedRebuild'].__setitem__('caseCandidateLinks',11385),'content':lambda x:x['claimLocks'].__setitem__('candidateContentInspected',True),'holding':lambda x:x['claimLocks'].__setitem__('holdingPresenceInterpreted',True),'sameSecurity':lambda x:x['claimLocks'].__setitem__('sameSecurityVerified',True),'recovery':lambda x:x['claimLocks'].__setitem__('laterRecoveriesExcluded',True),'outcome':lambda x:x['claimLocks'].__setitem__('outcomesAccessed',True),'unknown':lambda x:x['claimLocks'].__setitem__('unknownCredit',True),'network':lambda x:x['implementationContract'].__setitem__('networkCapabilityAllowed',True),'path':lambda x:x['implementationContract'].__setitem__('contractPath','reports/evil.json')};kills={}
 for n,m in ms.items():x=copy.deepcopy(v);m(x);x=reseal(x);kills[n]=rejected(lambda x=x:validate_contract(x,False))
 if not all(kills.values()):fail('mutation kill failed')
 return kills
def main():
 p=argparse.ArgumentParser();p.add_argument('command',choices=('verify-contract','dry-run','self-test'));p.add_argument('--remote',action='store_true');a=p.parse_args()
 try:
  v=load_contract();repo=verify_repo(a.remote);stats=build_rows();out={'schema':'sec-liquidation-late-nport-filing-discovery/v1','status':'PASS',**repo,**stats,'networkRequests':0,'writes':0,'outcomesAccessed':False}
  if a.command=='self-test':out={'schema':'sec-liquidation-late-nport-filing-discovery-self-test/v1','status':'PASS',**repo,'mutationKills':self_test(v),'outcomesAccessed':False}
 except (E,KeyError,TypeError,ValueError,OSError,sqlite3.Error,json.JSONDecodeError) as e:p.error(str(e))
 print(json.dumps(out,sort_keys=True));return 0
if __name__=='__main__':raise SystemExit(main())
