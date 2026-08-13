#!/usr/bin/env python3
"""Verify complete late periodic SEC content without outcome or price access."""
from __future__ import annotations
import argparse,copy,datetime,hashlib,importlib.util,json,re,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];CONTRACT=ROOT/'research'/'early-detection-v4'/'sec-liquidation-late-periodic-content-disposition-contract-v1.json';VERIFIER=Path(__file__).resolve();TEST=ROOT/'tests'/'verify-sec-liquidation-late-periodic-content-disposition-v1.test.js';DISCOVERY=ROOT/'scripts'/'build-sec-liquidation-late-periodic-filing-discovery-v1.py';V5_CONTRACT=ROOT/'research'/'early-detection-v4'/'sec-liquidation-late-periodic-filing-capture-contract-v5.json';V4=ROOT/'scripts'/'capture-sec-liquidation-late-periodic-filings-v4.py';V5=ROOT/'scripts'/'capture-sec-liquidation-late-periodic-filings-v5.py';V5_TEST=ROOT/'tests'/'capture-sec-liquidation-late-periodic-filings-v5.test.js';PARSER=ROOT/'scripts'/'build-sec-form25-structured-metadata-v1.py';OWNED=(CONTRACT,VERIFIER,TEST)
CONTRACT_RAW='a51ff3c626bf3aed49b66017d8e181ae25af68a9fb557e1d801d4531c0d2996e'
CONTRACT_SELF='a9cef285c5fd53f14e6840f561221d7ab4a869e6e6fb8f671582f9495f6c90e8'
TEST_RAW='d8ce022eaa0fdfce932ea2e0b6b6be8c3790ac991bfd29931c668064f4921560'
BASE='7cc5f2e7acdf568f1bd2d660b0e5bfe38145bac0';REMOTE='https://github.com/Karlryl/screener-data.git';REF='refs/heads/codex/early-detection-v4-gates-20260810';CREATED_AT='2026-08-13T16:41:21Z';DISCOVERY_RAW='5ee4d1467080b69e13f5c319d28c92a79b01140cc75149317de332ef57a40d11';V5_CONTRACT_RAW='1fbbe61edd27d727b430b9d03d810f0b1d2761c7785f116958cdda9235b5418b';V4_RAW='b14468bbabb7139c51f0fb44554ae2529cd67d6103f3ec769457fb9fb5e906db';V5_RAW='f28f4dbf5e8ffc0c097238b5ff46e7d69ef9a6af3034f235c813661fb70e82ab';V5_TEST_RAW='58ea8e398c90dc4e3c21c87b0330e78a492a07a423267e0aa9adcd8ea53c0198';PARSER_GIT_RAW='52f78812a7547df4025dd8a48351f2364beb7285cc903bcb1a0df5fbe56d0025'
PURPOSE='Verify all 122 privately captured classic periodic SEC filings from calendar day 456 through the bound 2024-12-31 database cutoff, record zero source-qualified original-amount repetitions, later additional-distribution statements or no-further-payment statements, and preserve three strongest false-positive controls without claiming security identity, payment completeness, recovery exclusion or terminal wealth.'
LOCKS={'sameSecurityVerified':False,'securityIdentityResolved':False,'listingIdentityResolved':False,'originalAmountRepeatedInPeriodicSentence':False,'additionalDistributionVerified':False,'noFurtherPaymentsVerified':False,'laterRecoveriesExcluded':False,'completeCorporateActionChainVerified':False,'terminalWealthComplete':False,'originalV4GateCredit':False,'resultComputationAllowed':False,'pricesAccessed':False,'returnsAccessed':False,'outcomesAccessed':False}
CONTROLS=[{'category':'ADDITIONAL_INFORMATION_TITLE_NOT_ADDITIONAL_PAYMENT','candidateId':'SEC-LIQ-LATE-PERIODIC-129f0780783b08d037dc9c1b9137314b219d322a14543ab0c9f617d349cbb546','accession':'0001171520-16-001118','documentIndex':4,'sentenceIndex':209,'sentenceSha256':'4d7ea2c1613850911a5b625e8846a68455615c3836f6c35bf234a34e360b8d62'},{'category':'TAX_DISTRIBUTION_TABLE_TARGET_ROW_ALL_DASHES','candidateId':'SEC-LIQ-LATE-PERIODIC-ff00bc0a6eb6d36d16e99ef8234373b260c6b53766c5461aa34b24208d3a85e5','accession':'0001104659-18-000153','documentIndex':1,'sentenceIndex':4671,'sentenceSha256':'2061dcfd0d5e7c4e466c7d059d109055b8c32e145f03680a1cad25d82efaddeb'},{'category':'MULTIFUND_BALANCE_SHEET_RECEIVABLE_NOT_RECOVERY','candidateId':'SEC-LIQ-LATE-PERIODIC-1589d3735920fd4be604e38f5c8f8e546e8362616a5bb39d62f41f3f9ff2214a','accession':'0001104659-16-131500','documentIndex':1,'sentenceIndex':2331,'sentenceSha256':'95074222bb440bf253b37d5649bedd1b880ccdd2fd5204c187635f5dcb026d48'}]
ALIASES={'LIQUIDATION-PAYMENT-001':['asia ex japan','asia ex-japan'],'LIQUIDATION-PAYMENT-002':['growth markets equities'],'LIQUIDATION-PAYMENT-003':['multi asset index','multi-asset index'],'LIQUIDATION-PAYMENT-004':['risk adjusted return','risk-adjusted return'],'LIQUIDATION-PAYMENT-005':['brazil bear 3x'],'LIQUIDATION-PAYMENT-006':['ftse europe bear 3x'],'LIQUIDATION-PAYMENT-007':['natural gas related bear 3x'],'LIQUIDATION-PAYMENT-008':['japan bear 3x'],'LIQUIDATION-PAYMENT-009':['south korea bear 3x'],'LIQUIDATION-PAYMENT-010':['china infrastructure'],'LIQUIDATION-PAYMENT-011':['em intermediate term investment grade'],'LIQUIDATION-PAYMENT-012':['em long term investment grade'],'LIQUIDATION-PAYMENT-013':['em short term investment grade'],'LIQUIDATION-PAYMENT-014':['australia bond index'],'LIQUIDATION-PAYMENT-015':['build america bond'],'LIQUIDATION-PAYMENT-016':['germany bond index'],'LIQUIDATION-PAYMENT-017':['canada bond index']}
EXPECTED={'candidateFilings':122,'caseCandidateLinks':519,'parsedDocuments':3028,'normalizedSentences':328801,'exactFullDescriptorLinks':18,'exactFullDescriptorCandidates':18,'exactFullDescriptorCases':1,'exactFullDescriptorSentences':254,'uniqueExactFullDescriptorSentenceHashes':218,'sourceQualifiedOriginalAmountRepeatedSentenceMatches':0,'sourceQualifiedPastAdditionalDistributionSentenceMatches':0,'sourceQualifiedNoFurtherPaymentSentenceMatches':0,'broadSentenceCandidateRows':3710,'broadPastPaymentDistributionOrRecoveryRows':2291,'broadRecoveryEscrowClaimRows':1678,'broadClosedLiquidatedContextRows':219,'falsePositiveControlRows':3,'falsePositiveControlCanonicalSha256':'335253158de8467638f9f173f9bb6ce86b75b4d624da735566a02d87e369b1b2','claimScope':'EXACT_CAPTURED_122_CLASSIC_PERIODIC_FILINGS_DAY_456_THROUGH_BOUND_2024_12_31_DATABASE_CUTOFF_ONLY'}
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
def module(n,p,h,head,crlf=False):
 raw=p.read_bytes();g=git_raw(head,p)
 if sha(g)!=h or (raw.replace(b'\r\n',b'\n') if crlf else raw)!=g:fail(n+' bytes changed')
 s=importlib.util.spec_from_file_location(n,p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def expected_inputs():return {'discoveryBuilder':{'path':DISCOVERY.relative_to(ROOT).as_posix(),'rawSha256':DISCOVERY_RAW},'captureV5Contract':{'path':V5_CONTRACT.relative_to(ROOT).as_posix(),'rawSha256':V5_CONTRACT_RAW,'introductionCommit':BASE},'journalReaderV4':{'path':V4.relative_to(ROOT).as_posix(),'rawSha256':V4_RAW},'captureV5Runner':{'path':V5.relative_to(ROOT).as_posix(),'rawSha256':V5_RAW},'captureV5Test':{'path':V5_TEST.relative_to(ROOT).as_posix(),'rawSha256':V5_TEST_RAW},'documentParser':{'path':PARSER.relative_to(ROOT).as_posix(),'gitRawSha256':PARSER_GIT_RAW,'workingTreeCrLfNormalizedToGit':True},'privateCapture':{'absoluteRoot':r'C:\Users\Anwender\Documents\GrowthScreenerResearchData\early-detection-v4\liquidation-late-periodic-sec-originals-v1','candidateFilings':122,'acceptedReceipts':122,'incidentCount':7,'requestEventCount':129,'totalRawBytes':1153819931,'receiptSequenceSha256':'21ea0407d6f43d28a3ff0949de378f983978fec6d6f963892e287fd8a28bb31e','rawBlobSequenceSha256':'77b1c787d17e488040782d04d4005a54674f7cb013b4f09caa3cdda77337ba72','incidentSequenceSha256':'f72a10632cd738ffc922c027ac49703d3f15318db6f1c25e061d762d0e9d29b8','requestEventSequenceSha256':'d2b1c4791b36fdb48e16a835718d836c977430e60bac6be35d1241fc3bd196cc','complete':True}}
def validate_contract(v):
 exact(v,{'schema','createdAt','taskId','track','purpose','inputs','scanContract','claimLocks','implementationContract','contractSha256'},'contract')
 if (v['schema'],v['createdAt'],v['taskId'],v['track'],v['purpose'])!=('sec-liquidation-late-periodic-content-disposition-contract/v1',CREATED_AT,'Q003-SEC-LIQUIDATION-LATE-PERIODIC-CONTENT-DISPOSITION','SHARED_OUTCOME_BLIND_INFRA',PURPOSE):fail('identity changed')
 try:created=datetime.datetime.strptime(v['createdAt'],'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=datetime.timezone.utc)
 except ValueError:fail('createdAt changed')
 if created>datetime.datetime.now(datetime.timezone.utc):fail('future time')
 impl={'baseCommit':BASE,'baseTag':906,'remote':REMOTE,'ref':REF,'contractPath':CONTRACT.relative_to(ROOT).as_posix(),'verifierPath':VERIFIER.relative_to(ROOT).as_posix(),'testPath':TEST.relative_to(ROOT).as_posix(),'verifierNormalizedSha256':sha(normalized(VERIFIER.read_bytes())),'testRawSha256':TEST_RAW,'introductionMustBeDirectSingleParentChildOfBase':True,'introductionAddsExactlyThreeOwnedPaths':True,'verificationRequiresLiveRemote':True,'writesAllowed':False}
 if v['inputs']!=expected_inputs() or v['scanContract']!=EXPECTED or v['claimLocks']!=LOCKS or v['implementationContract']!=impl or v['contractSha256']!=CONTRACT_SELF or self_hash(v,'contractSha256')!=CONTRACT_SELF:fail('binding changed')
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
  return {'phase':'PRE_INTRODUCTION','introductionCommit':None,'remoteVerified':True}
 if any(len(x)!=1 for x in xs) or len({x[0] for x in xs})!=1:fail('introduction split')
 i=xs[0][0]
 if git('show','-s','--format=%P',i).split()!=[BASE] or changed(i)!=[('A',p.relative_to(ROOT).as_posix()) for p in OWNED]:fail('introduction changed')
 for p in OWNED:
  if git_raw(i,p)!=p.read_bytes() or git_raw(head,p)!=p.read_bytes():fail('owned bytes changed')
 return {'phase':'POST_INTRODUCTION','introductionCommit':i,'remoteVerified':True}
def line_sha(vals):return sha(('\n'.join(vals)+('\n' if vals else '')).encode())
def scan(head):
 d=module('late_discovery_scan',DISCOVERY,DISCOVERY_RAW,head);v4=module('late_v4_scan',V4,V4_RAW,head);module('late_v5_scan',V5,V5_RAW,head);p=module('late_parser_scan',PARSER,PARSER_GIT_RAW,head,True)
 for q,h in ((V5_CONTRACT,V5_CONTRACT_RAW),(V5_TEST,V5_TEST_RAW)):
  if sha(q.read_bytes())!=h or git_raw(head,q)!=q.read_bytes():fail('capture dependency changed')
 candidates,links,_=d.build_rows();base=d.load_base(head);seeds=base.load_reconciliation_rows();sb={x['caseId']:x for x in seeds};lb={}
 for x in links:lb.setdefault(x['candidateId'],[]).append(x)
 v1,v3,n,c,l,rs,incs,events=v4.load_state();rb={x['candidateId']:x for x in rs}
 if len(rs)!=122 or len(incs)!=7 or events[-1][0]!=129 or line_sha([x['receiptSha256'] for x in rs])!=expected_inputs()['privateCapture']['receiptSequenceSha256'] or line_sha([x['rawSha256'] for x in rs])!=expected_inputs()['privateCapture']['rawBlobSequenceSha256'] or line_sha([x['incidentSha256'] for x in incs])!=expected_inputs()['privateCapture']['incidentSequenceSha256'] or line_sha([x[1] for x in events])!=expected_inputs()['privateCapture']['requestEventSequenceSha256']:fail('complete private journal changed')
 docs=sents=descriptor_sent=amount=additional=no_further=broad=past_rows=recovery_rows=closed_rows=0;dl=set();dc=set();dcase=set();descriptor_hashes=set();control_found=[]
 past=re.compile(r'\b(?:was|were|has been|have been|had been)\s+(?:distributed|paid|received|remitted|released|recovered)|\b(?:distributed|paid|received|remitted|released|recovered)\b',re.I);dist=re.compile(r'\b(?:distribution|payment|proceeds|cash|liquidat(?:e|ed|ion|ing)|escrow|recover(?:y|ies|ed)|receivable|claim)\b',re.I);add=re.compile(r'\b(?:additional|further|subsequent|supplemental|second|final)\b.{0,160}\b(?:distribution|payment|proceeds|cash)\b',re.I|re.S);no_more=re.compile(r'\b(?:no|not)\s+(?:additional|further|subsequent)\s+(?:distribution|payment)s?\b',re.I);recovery=re.compile(r'\b(?:recover(?:y|ies|ed)|escrow|contingent|receivable|claim|residual)\b',re.I);closed=re.compile(r'\b(?:closed|liquidated|terminated|ceased)\b',re.I)
 controls={(x['candidateId'],x['documentIndex'],x['sentenceIndex'],x['sentenceSha256']):x for x in CONTROLS}
 for candidate in candidates:
  receipt=rb[candidate['candidateId']];raw=(v1.PRIVATE/receipt['blobRelativePath']).read_bytes()
  if sha(raw)!=receipt['rawSha256'] or len(raw)!=receipt['rawBytes']:fail('blob changed')
  sentences=p.sentences_for_documents(p.extract_documents(raw));docs+=len(p.extract_documents(raw));sents+=len(sentences)
  for doc,idx,text,mode in sentences:
   ntext=' '.join(re.sub(r'[^a-z0-9]+',' ',text.lower()).split());matched=[]
   for link in lb[candidate['candidateId']]:
    seed=sb[link['caseId']];descriptor=' '.join(re.sub(r'[^a-z0-9]+',' ',seed['securityDescription'].lower()).split())
    if descriptor in ntext:matched.append((seed,link));dl.add((seed['caseId'],candidate['candidateId']));dc.add(candidate['candidateId']);dcase.add(seed['caseId'])
   h=sha(text.encode())
   if matched:
    descriptor_sent+=1;descriptor_hashes.add(h)
    for seed,_ in matched:
     if seed['amountLiteral'].replace(' ','') in text.replace(' ',''):amount+=1
     if add.search(text) and past.search(text):additional+=1
     if no_more.search(text):no_further+=1
   ks=[]
   if past.search(text) and dist.search(text):ks.append('past')
   if recovery.search(text) and dist.search(text):ks.append('recovery')
   if closed.search(text) and (matched or dist.search(text)):ks.append('closed')
   if ks:broad+=1;past_rows+=('past' in ks);recovery_rows+=('recovery' in ks);closed_rows+=('closed' in ks)
   key=(candidate['candidateId'],doc['index'],idx,h)
   if key in controls:control_found.append(controls[key])
 if sorted(control_found,key=lambda x:x['category'])!=sorted(CONTROLS,key=lambda x:x['category']):fail('false-positive controls changed')
 stats={'candidateFilings':len(candidates),'caseCandidateLinks':len(links),'parsedDocuments':docs,'normalizedSentences':sents,'exactFullDescriptorLinks':len(dl),'exactFullDescriptorCandidates':len(dc),'exactFullDescriptorCases':len(dcase),'exactFullDescriptorSentences':descriptor_sent,'uniqueExactFullDescriptorSentenceHashes':len(descriptor_hashes),'sourceQualifiedOriginalAmountRepeatedSentenceMatches':amount,'sourceQualifiedPastAdditionalDistributionSentenceMatches':additional,'sourceQualifiedNoFurtherPaymentSentenceMatches':no_further,'broadSentenceCandidateRows':broad,'broadPastPaymentDistributionOrRecoveryRows':past_rows,'broadRecoveryEscrowClaimRows':recovery_rows,'broadClosedLiquidatedContextRows':closed_rows,'falsePositiveControlRows':len(control_found),'falsePositiveControlCanonicalSha256':sha(canonical(CONTROLS)),'claimScope':EXPECTED['claimScope']}
 if stats!=EXPECTED:fail('source-derived scan changed')
 return stats
def reseal(v):x=copy.deepcopy(v);x['contractSha256']=self_hash(x,'contractSha256');return x
def rejected(f):
 try:f()
 except (E,KeyError,TypeError,ValueError,OSError,json.JSONDecodeError):return True
 return False
def self_test(v):
 ms={'backdate':lambda x:x.__setitem__('createdAt','1970-01-01T00:00:00Z'),'purpose':lambda x:x.__setitem__('purpose','terminal wealth complete'),'candidate':lambda x:x['scanContract'].__setitem__('candidateFilings',121),'docs':lambda x:x['scanContract'].__setitem__('parsedDocuments',3027),'amount':lambda x:x['scanContract'].__setitem__('sourceQualifiedOriginalAmountRepeatedSentenceMatches',1),'additional':lambda x:x['scanContract'].__setitem__('sourceQualifiedPastAdditionalDistributionSentenceMatches',1),'noFurther':lambda x:x['scanContract'].__setitem__('sourceQualifiedNoFurtherPaymentSentenceMatches',1),'control':lambda x:x['scanContract'].__setitem__('falsePositiveControlRows',2),'scope':lambda x:x['scanContract'].__setitem__('claimScope','ALL_FUTURE'),'receipt':lambda x:x['inputs']['privateCapture'].__setitem__('acceptedReceipts',121),'identity':lambda x:x['claimLocks'].__setitem__('sameSecurityVerified',True),'recovery':lambda x:x['claimLocks'].__setitem__('laterRecoveriesExcluded',True),'terminal':lambda x:x['claimLocks'].__setitem__('terminalWealthComplete',True),'outcome':lambda x:x['claimLocks'].__setitem__('outcomesAccessed',True),'unknown':lambda x:x['claimLocks'].__setitem__('unknownCredit',True)};out={}
 for k,f in ms.items():x=copy.deepcopy(v);f(x);x=reseal(x);out[k]=rejected(lambda x=x:validate_contract(x))
 if not all(out.values()):fail('kill failed')
 return out
def main():
 q=argparse.ArgumentParser();q.add_argument('command',choices=('verify-contract','verify','self-test'));q.add_argument('--remote',action='store_true');a=q.parse_args()
 try:
  v=load_contract();repo=verify_repo(a.remote)
  if a.command=='self-test':out={'schema':'sec-liquidation-late-periodic-content-disposition-self-test/v1','status':'PASS',**repo,'mutationKills':self_test(v),'outcomesAccessed':False}
  else:out={'schema':'sec-liquidation-late-periodic-content-disposition-verification/v1','status':'PASS',**repo,**scan(git('rev-parse','HEAD')),'claimLocks':LOCKS,'writes':0,'networkRequests':0,'outcomesAccessed':False}
 except (E,KeyError,TypeError,ValueError,OSError,json.JSONDecodeError) as e:q.error(str(e))
 print(json.dumps(out,sort_keys=True));return 0
if __name__=='__main__':raise SystemExit(main())
