#!/usr/bin/env python3
"""Verify the exact private 24-filing periodic SEC content disposition."""
from __future__ import annotations
import argparse,copy,datetime,hashlib,importlib.util,json,re,subprocess
from pathlib import Path
from typing import Any,Callable
ROOT=Path(__file__).resolve().parents[1]
CONTRACT=ROOT/'research'/'early-detection-v4'/'sec-liquidation-periodic-content-disposition-contract-v1.json'
VERIFIER=Path(__file__).resolve();TEST=ROOT/'tests'/'verify-sec-liquidation-periodic-content-disposition-v1.test.js'
DISCOVERY=ROOT/'scripts'/'build-sec-liquidation-periodic-filing-discovery-v1.py';CAPTURE=ROOT/'scripts'/'capture-sec-liquidation-periodic-filings-v1.py';PARSER=ROOT/'scripts'/'build-sec-form25-structured-metadata-v1.py';FROZEN=ROOT/'research'/'early-detection-v4'/'sec-frozen-liquidation-payment-evidence-contract-v1.json'
PRIVATE=Path(r'C:\Users\Anwender\Documents\GrowthScreenerResearchData\early-detection-v4\liquidation-periodic-sec-originals-v1');MANIFEST=PRIVATE/'manifests'/'sha256'/'9d'/'9da9930ea0f6ccd7e1a3f8e919847622b7e083737a688d9614b42b89e641be04.json';OWNED=(CONTRACT,VERIFIER,TEST)
CONTRACT_RAW='95cf24fe0df195d3b0df31dc56c4e913527acdf353fd0f2b5b2973bdcd4dc422'
CONTRACT_SELF='90c8d6327b0bb885f46087e500ae59db83a80448f5a4aca70944234f82eb8171'
TEST_RAW='b07718142e20731f66d341b591b73bd88f57451bb23034d8fba49f66eb4c8d9e'
BASE='4f8492a51690045ea30ce7e6c6b671a4ebb990ef';REMOTE='https://github.com/Karlryl/screener-data.git';REF='refs/heads/codex/early-detection-v4-gates-20260810';CREATED_AT='2026-08-13T14:34:25Z'
DISCOVERY_RAW='9ba8e83b0705ad81e2907e6e72210160c18bfcb37b5a0dd669efc2609a5e6034';CAPTURE_RAW='f3c2c5c9614cf5e9e334c29ed15744ae979df4f7d443d73ea967bf72b9ee6a89';PARSER_RAW='52f78812a7547df4025dd8a48351f2364beb7285cc903bcb1a0df5fbe56d0025';FROZEN_RAW='a282583efe18ae14dfcc2b17db0822c92be75fade962aa53b53d28b05e99ff10';MANIFEST_RAW='a63fa34714f9aea70d07edafc6cf626245db2ade09207398fde89aa82789992b';MANIFEST_SELF='9da9930ea0f6ccd7e1a3f8e919847622b7e083737a688d9614b42b89e641be04'
PURPOSE='Verify all twenty-four privately captured periodic SEC filings, freeze exactly seven narrow same-descriptor later-report corroborations, and record zero original-amount repetitions, past additional-payment statements or no-further-payment statements without claiming security identity, payment completeness, recovery exclusion or terminal wealth.'
TARGETS={'b728c3e21bdbf974c9cb0734dbee941e8ff969038c51f371552f6e100541315c':'LATER_PERIODIC_REPORT_STATES_NAMED_FUND_CLOSED_ON_DATE','d7c57e70341ac9b4b4721d028c8fe7b8e7168ab9c5de3e1d771f3388b8d6ad7f':'LATER_PERIODIC_REPORT_STATES_NAMED_FUND_CLOSED_ON_DATE','dbd2127e1cf8f664978bc258d5cf8a206ae81a8f1da1b1c98dae1cab19807028':'LATER_PERIODIC_REPORT_STATES_NAMED_FUND_CLOSED_ON_DATE','5c2538445198ed13b59f445d03c25aef64438c204377102a428ef44d33589927':'LATER_PERIODIC_REPORT_STATES_NAMED_FUNDS_WERE_LIQUIDATED_SINCE_PRIOR_ANNUAL_LETTER'}
EXPECTED_CASES=['LIQUIDATION-PAYMENT-005','LIQUIDATION-PAYMENT-008','LIQUIDATION-PAYMENT-009','LIQUIDATION-PAYMENT-010','LIQUIDATION-PAYMENT-011','LIQUIDATION-PAYMENT-012','LIQUIDATION-PAYMENT-013']
LOCKS={'sameSecurityVerified':False,'securityIdentityResolved':False,'listingIdentityResolved':False,'originalAmountRepeatedInPeriodicSentence':False,'additionalDistributionVerified':False,'noFurtherPaymentsVerified':False,'laterRecoveriesExcluded':False,'completeCorporateActionChainVerified':False,'terminalWealthComplete':False,'originalV4GateCredit':False,'resultComputationAllowed':False,'pricesAccessed':False,'returnsAccessed':False,'outcomesAccessed':False}
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
  p=re.compile(rf"^{n}='[0-9a-f]{{64}}'$",re.M)
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
def module(n,p,h,head,crlf=False):
 raw=p.read_bytes();g=git_raw(head,p)
 if sha(g)!=h or (raw.replace(b'\r\n',b'\n') if crlf else raw)!=g:fail(n+' bytes changed')
 s=importlib.util.spec_from_file_location(n,p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def expected_inputs():return {'discoveryBuilder':{'path':DISCOVERY.relative_to(ROOT).as_posix(),'rawSha256':DISCOVERY_RAW},'captureRunner':{'path':CAPTURE.relative_to(ROOT).as_posix(),'rawSha256':CAPTURE_RAW},'documentParser':{'path':PARSER.relative_to(ROOT).as_posix(),'rawSha256':PARSER_RAW},'frozenLiquidationContract':{'path':FROZEN.relative_to(ROOT).as_posix(),'rawSha256':FROZEN_RAW},'privateManifest':{'absolutePath':str(MANIFEST),'rawSha256':MANIFEST_RAW,'manifestSha256':MANIFEST_SELF,'capturedCandidates':24,'remainingCandidates':0,'complete':True}}
def expected_scan():return {'candidateFilings':24,'caseCandidateLinks':102,'parsedDocuments':342,'normalizedSentences':35857,'exactDescriptorLinks':20,'exactDescriptorCandidates':5,'exactDescriptorCases':13,'descriptorSentences':15,'corroborationRows':7,'corroborationCases':EXPECTED_CASES,'uniqueCorroborationSentences':4,'closedOnDateRows':3,'liquidatedSincePriorLetterRows':4,'corroborationRowsCanonicalSha256':'c4f003dd5bf56084524a5dd7080eced40fca4334aa876e1bd97e67f098b5f730','originalAmountRepeatedSentenceMatches':0,'pastAdditionalDistributionSentenceMatches':0,'noFurtherPaymentSentenceMatches':0,'claimScope':'EXACT_CAPTURED_24_PERIODIC_FILINGS_DAY_91_TO_455_STAGE_ONLY'}
def validate_contract(v):
 exact(v,{'schema','createdAt','taskId','track','purpose','inputs','scanContract','claimLocks','implementationContract','contractSha256'},'contract')
 if v['schema']!='sec-liquidation-periodic-content-disposition-contract/v1' or v['createdAt']!=CREATED_AT or v['taskId']!='Q003-SEC-LIQUIDATION-PERIODIC-CONTENT-DISPOSITION' or v['track']!='SHARED_OUTCOME_BLIND_INFRA' or v['purpose']!=PURPOSE:fail('identity changed')
 if datetime.datetime.strptime(v['createdAt'],'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=datetime.timezone.utc)>datetime.datetime.now(datetime.timezone.utc):fail('future time')
 if v['inputs']!=expected_inputs() or v['scanContract']!=expected_scan() or v['claimLocks']!=LOCKS:fail('inputs scan or locks changed')
 impl={'baseCommit':BASE,'baseTag':898,'remote':REMOTE,'ref':REF,'contractPath':CONTRACT.relative_to(ROOT).as_posix(),'verifierPath':VERIFIER.relative_to(ROOT).as_posix(),'testPath':TEST.relative_to(ROOT).as_posix(),'verifierNormalizedSha256':sha(normalized(VERIFIER.read_bytes())),'testRawSha256':TEST_RAW,'introductionMustBeDirectSingleParentChildOfBase':True,'introductionAddsExactlyThreeOwnedPaths':True,'laterLinearSingleParentDescendantsAllowed':True,'verificationRequiresLiveRemote':True,'writesAllowed':False}
 if v['implementationContract']!=impl or v['contractSha256']!=CONTRACT_SELF or self_hash(v,'contractSha256')!=CONTRACT_SELF:fail('implementation or self hash changed')
def load_contract():
 raw=CONTRACT.read_bytes()
 if sha(raw)!=CONTRACT_RAW:fail('contract raw changed')
 v=json.loads(raw);validate_contract(v);return v
def scan(head):
 d=module('periodic_discovery_scan',DISCOVERY,DISCOVERY_RAW,head);cmod=module('periodic_capture_scan',CAPTURE,CAPTURE_RAW,head);p=module('periodic_parser_scan',PARSER,PARSER_RAW,head,True)
 if sha(FROZEN.read_bytes())!=FROZEN_RAW or git_raw(head,FROZEN)!=FROZEN.read_bytes():fail('frozen contract changed')
 mr=MANIFEST.read_bytes();mv=json.loads(mr)
 if sha(mr)!=MANIFEST_RAW or mv.get('manifestSha256')!=MANIFEST_SELF or self_hash(mv,'manifestSha256')!=MANIFEST_SELF or (mv.get('capturedCandidates'),mv.get('remainingCandidates'),mv.get('complete'),mv.get('outcomesAccessed'))!=(24,0,True,False):fail('manifest changed')
 seeds,candidates,links,_=d.build_rows();sb={x['caseId']:x for x in seeds};lb={}
 for x in links:lb.setdefault(x['candidateId'],[]).append(x)
 network,c2,l2=cmod.load_inputs(head);cmod.validate_manifest(network,cmod.build_manifest(network,c2));rs={x['candidateId']:x for x in cmod.receipts(network,c2)}
 frozen=json.loads(FROZEN.read_bytes());fb={x['caseId']:x for x in frozen['frozenCases']};docs=sents=desc_sents=amount=additional=no_further=0;dl=set();dc=set();dcase=set();rows=[]
 for candidate in candidates:
  receipt=rs[candidate['candidateId']];raw=(PRIVATE/receipt['blobRelativePath']).read_bytes()
  if sha(raw)!=receipt['rawSha256']:fail('raw blob changed')
  documents=p.extract_documents(raw);sentences=p.sentences_for_documents(documents);docs+=len(documents);sents+=len(sentences)
  for doc,idx,text,mode in sentences:
   norm=' '.join(re.sub(r'[^a-z0-9]+',' ',text.lower()).split());matched=[]
   for link in lb[candidate['candidateId']]:
    seed=sb[link['caseId']];descriptor=' '.join(re.sub(r'[^a-z0-9]+',' ',seed['securityDescription'].lower()).split())
    if descriptor in norm:matched.append((seed,link));dl.add((seed['caseId'],candidate['candidateId']));dc.add(candidate['candidateId']);dcase.add(seed['caseId'])
   if matched:desc_sents+=1
   for seed,link in matched:
    literal=fb[seed['caseId']]['amountLiteral']
    if literal.replace(' ','') in text.replace(' ',''):amount+=1
    if re.search(r'\b(?:additional|further|subsequent|supplemental|second|final)\b.{0,100}\b(?:distribution|payment|proceeds|cash)\b',text,re.I|re.S) and re.search(r'\b(?:was|were|has been|have been)\s+(?:distributed|paid|received|remitted)',text,re.I):additional+=1
    if re.search(r'\b(?:no|not)\s+(?:additional|further|subsequent)\s+(?:distribution|payment)s?\b',text,re.I):no_further+=1
   h=sha(text.encode())
   if h in TARGETS:
    for seed,link in matched:
     rows.append({'caseId':seed['caseId'],'candidateId':candidate['candidateId'],'candidateAccession':candidate['accession'],'form':candidate['form'],'filedDate':candidate['filedDate'],'dayOffset':link['dayOffset'],'candidateRawSha256':receipt['rawSha256'],'documentIndex':doc['index'],'documentType':doc['type'],'documentSequence':doc['sequence'],'documentFilename':doc['filename'],'rawDocumentSha256':sha(doc['raw']),'rawTextSha256':sha(doc['textRaw']),'sentenceIndex':idx,'sentenceSha256':h,'normalizationMode':mode,'evidenceKind':TARGETS[h],'actionDateFromPeriodicSentence':'2014-09-29' if h!='5c2538445198ed13b59f445d03c25aef64438c204377102a428ef44d33589927' else None})
 rows.sort(key=lambda x:x['caseId']);stats={'candidateFilings':len(candidates),'caseCandidateLinks':len(links),'parsedDocuments':docs,'normalizedSentences':sents,'exactDescriptorLinks':len(dl),'exactDescriptorCandidates':len(dc),'exactDescriptorCases':len(dcase),'descriptorSentences':desc_sents,'corroborationRows':len(rows),'corroborationCases':[x['caseId'] for x in rows],'uniqueCorroborationSentences':len({x['sentenceSha256'] for x in rows}),'closedOnDateRows':sum(x['actionDateFromPeriodicSentence'] is not None for x in rows),'liquidatedSincePriorLetterRows':sum(x['actionDateFromPeriodicSentence'] is None for x in rows),'corroborationRowsCanonicalSha256':sha(canonical(rows)),'originalAmountRepeatedSentenceMatches':amount,'pastAdditionalDistributionSentenceMatches':additional,'noFurtherPaymentSentenceMatches':no_further}
 for k,a in stats.items():
  if a!=expected_scan()[k]:fail('source-derived '+k+' changed')
 report={'schema':'sec-liquidation-periodic-content-disposition/v1','scope':expected_scan()['claimScope'],'manifestRawSha256':MANIFEST_RAW,'stats':stats,'rows':rows,'claimLocks':LOCKS,'outcomesAccessed':False,'reportSha256':''};report['reportSha256']=self_hash(report,'reportSha256');return report
def changed(c):
 o=git('diff-tree','--no-commit-id','--name-status','-r',c);return [tuple(x.split('\t',1)) for x in o.splitlines() if x]
def intro(p):
 o=git('log','--reverse','--format=%H','--diff-filter=A',f'{BASE}..HEAD','--',p.relative_to(ROOT).as_posix());return o.splitlines() if o else []
def verify_repo(remote):
 if not remote:fail('live remote mandatory')
 head=git('rev-parse','HEAD')
 if git('remote','get-url','origin')!=REMOTE or git('rev-parse','@{u}')!=head or git('ls-remote','--refs','origin',REF).split()!=[head,REF] or not ancestor(BASE,head):fail('remote topology changed')
 xs=[intro(p) for p in OWNED]
 if all(not x for x in xs):
  if head!=BASE:fail('pre introduction moved')
  return {'phase':'PRE_INTRODUCTION','introductionCommit':None,'remoteVerified':True}
 if any(len(x)!=1 for x in xs) or len({x[0] for x in xs})!=1:fail('introduction split')
 i=xs[0][0]
 if git('show','-s','--format=%P',i).split()!=[BASE] or changed(i)!=[('A',p.relative_to(ROOT).as_posix()) for p in OWNED] or not ancestor(i,head):fail('introduction changed')
 for c in git('rev-list','--first-parent',f'{i}..{head}').splitlines():
  if len(git('show','-s','--format=%P',c).split())!=1:fail('later history non-linear')
 for p in OWNED:
  if git_raw(i,p)!=p.read_bytes() or git_raw(head,p)!=p.read_bytes():fail('owned bytes changed')
 return {'phase':'POST_INTRODUCTION','introductionCommit':i,'remoteVerified':True}
def reseal(v):x=copy.deepcopy(v);x['contractSha256']=self_hash(x,'contractSha256');return x
def rejected(f):
 try:f()
 except (E,KeyError,TypeError,ValueError,OSError,json.JSONDecodeError):return True
 return False
def self_test(v):
 ms={'backdate':lambda x:x.__setitem__('createdAt','1970-01-01T00:00:00Z'),'purpose':lambda x:x.__setitem__('purpose','terminal wealth complete'),'candidate':lambda x:x['scanContract'].__setitem__('candidateFilings',23),'row':lambda x:x['scanContract'].__setitem__('corroborationRows',8),'case':lambda x:x['scanContract']['corroborationCases'].pop(),'amount':lambda x:x['scanContract'].__setitem__('originalAmountRepeatedSentenceMatches',1),'additional':lambda x:x['scanContract'].__setitem__('pastAdditionalDistributionSentenceMatches',1),'noFurther':lambda x:x['scanContract'].__setitem__('noFurtherPaymentSentenceMatches',1),'scope':lambda x:x['scanContract'].__setitem__('claimScope','ALL_FUTURE'),'manifest':lambda x:x['inputs']['privateManifest'].__setitem__('rawSha256','0'*64),'identity':lambda x:x['claimLocks'].__setitem__('sameSecurityVerified',True),'recovery':lambda x:x['claimLocks'].__setitem__('laterRecoveriesExcluded',True),'terminal':lambda x:x['claimLocks'].__setitem__('terminalWealthComplete',True),'outcome':lambda x:x['claimLocks'].__setitem__('outcomesAccessed',True),'unknown':lambda x:x['claimLocks'].__setitem__('unknownCredit',True)};ks={}
 for k,f in ms.items():x=copy.deepcopy(v);f(x);x=reseal(x);ks[k]=rejected(lambda x=x:validate_contract(x))
 if not all(ks.values()):fail('kill failed')
 return ks
def main():
 p=argparse.ArgumentParser();p.add_argument('command',choices=('verify-contract','verify','self-test'));p.add_argument('--remote',action='store_true');a=p.parse_args()
 try:
  v=load_contract();repo=verify_repo(a.remote)
  if a.command=='self-test':out={'schema':'sec-liquidation-periodic-content-disposition-self-test/v1','status':'PASS',**repo,'mutationKills':self_test(v),'outcomesAccessed':False}
  else:r=scan(git('rev-parse','HEAD'));out={'schema':'sec-liquidation-periodic-content-disposition-verification/v1','status':'PASS',**repo,'reportSha256':r['reportSha256'],**r['stats'],'claimLocks':LOCKS,'writes':0,'networkRequests':0,'outcomesAccessed':False}
 except (E,KeyError,TypeError,ValueError,OSError,json.JSONDecodeError) as e:p.error(str(e))
 print(json.dumps(out,sort_keys=True));return 0
if __name__=='__main__':raise SystemExit(main())
