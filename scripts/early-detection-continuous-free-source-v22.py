#!/usr/bin/env python3
"""Replay-only, remote-gated controller for append-only operational state V22."""
from __future__ import annotations
import argparse,copy,datetime,hashlib,json,re,subprocess
from collections import Counter
from pathlib import Path
from typing import Any,Callable
ROOT=Path(__file__).resolve().parents[1]
CONTRACT=ROOT/'research'/'early-detection-v4'/'continuous-free-source-operational-state-contract-v22.json';EVENTS=ROOT/'state'/'early-detection-free-source-events-v22.jsonl';STATE=ROOT/'state'/'early-detection-free-source-state-v22.json';TEST=ROOT/'tests'/'early-detection-continuous-free-source-v22.test.js'
V21_CONTROLLER=ROOT/'scripts'/'early-detection-continuous-free-source-v21.py';V21_EVENTS=ROOT/'state'/'early-detection-free-source-events-v21.jsonl';V21_STATE=ROOT/'state'/'early-detection-free-source-state-v21.json'
LATE_PERIODIC=ROOT/'scripts'/'verify-sec-liquidation-late-periodic-content-disposition-v1.py'
REMOTE='https://github.com/Karlryl/screener-data.git';REF='refs/heads/codex/early-detection-v4-gates-20260810';BASE='b39a0b269a0562ec746a286a95df2f59a9f18588';CREATED_AT='2026-08-13T17:06:43Z'
EXPECTED_CONTRACT_RAW='49a1f176971ec0e587de946b7c12fb43343bb4e14ad7e17ccc22f10069a87294'
EXPECTED_CONTROLLER_NORMALIZED='213def62362b60057c04233f14332b7b4e5c22f536b3cc8d0b2b13852c9d5cca'
EXPECTED_TEST_NORMALIZED='15e470bded0a8afca5720d430bad995e5ce2d8890dbb5569a804ad7c8818baf0'
EXPECTED_EVENTS_RAW='3b78c6604578417e629b121a7829073dbd4c870e2fc111521e6eaa561c8b5ecc'
EXPECTED_STATE_RAW='9439271eec9c95eb52ae270264b6607e65037a779f58bdcf95eece52c48ab298'
EXPECTED_STATE_SELF='f41b3981fb2fabddb75a50d4ab105f1172a96aa0c880bdbc5bb9e978816cb4c4'
EXPECTED_PROJECTION_SHA='b986114a4a4994103cbd9bf30d3b976c59295c31278710d616557fd4bba6b5ef'
AUTHORIZED=['research/early-detection-v4/continuous-free-source-operational-state-contract-v22.json','scripts/early-detection-continuous-free-source-v22.py','state/early-detection-free-source-events-v22.jsonl','state/early-detection-free-source-state-v22.json','tests/early-detection-continuous-free-source-v22.test.js']
INPUT_PATHS={'v21Contract':'research/early-detection-v4/continuous-free-source-operational-state-contract-v21.json','v21Controller':'scripts/early-detection-continuous-free-source-v21.py','v21Test':'tests/early-detection-continuous-free-source-v21.test.js','v21EventLog':'state/early-detection-free-source-events-v21.jsonl','v21State':'state/early-detection-free-source-state-v21.json','latePeriodicContract':'research/early-detection-v4/sec-liquidation-late-periodic-content-disposition-contract-v1.json','latePeriodicVerifier':'scripts/verify-sec-liquidation-late-periodic-content-disposition-v1.py','latePeriodicTest':'tests/verify-sec-liquidation-late-periodic-content-disposition-v1.test.js'}
EXPECTED_INPUT_RAW={'v21Contract':'a02d4a432b4cbc55fc13ae0142ed399e60fc76e8dc54be4d3c7b126d4c99d689','v21Controller':'56a5e7afcf71df7550ca42990b857f4c2596f6a3575b939b89b3230733967e5b','v21Test':'15e4a2b53a88cd447bf6630cd5ecf761abf98388c21264a73bfe8bc87f46c26f','v21EventLog':'c6345b05771715dbca28f67862e036bf9b03df6b007a6d9c380d069facd2fca0','v21State':'106e1af72379c061f6b1389649ecca155fd36e60b235ebc952efef3b3d92ec6a','latePeriodicContract':'a51ff3c626bf3aed49b66017d8e181ae25af68a9fb557e1d801d4531c0d2996e','latePeriodicVerifier':'c2b085d27ed12489d9e9451792c62d0bfea69708e598f7a0c31288047c4369ab','latePeriodicTest':'d8ce022eaa0fdfce932ea2e0b6b6be8c3790ac991bfd29931c668064f4921560'}
MILESTONES=[
 {'tag':900,'commit':'f8ec39ac8b11802050108d43b0ee9bf8dc7eb4e8','parent':'c2a4e08893aad034392b880287641643bb3a8c47','subject':'Tag 900: SEC-Folgebelege operativ fortschreiben','workstream':'CONTROLLER_LINEAGE_V21','artifactCount':5,'deltaSha256':'662b711163c8cc750d361b157013bd16a06c2d38255fd41807b11b7722c9cfa5','status':'OPERATIONAL_MILESTONE_NO_CREDIT'},
 {'tag':901,'commit':'1131def14d7d9cc2380e70c8f2c2d2a12f20a60a','parent':'f8ec39ac8b11802050108d43b0ee9bf8dc7eb4e8','subject':'Tag 901: Spaete SEC-Periodik vollstaendig vorsortieren','workstream':'Q003_LATE_PERIODIC_DISCOVERY','artifactCount':3,'deltaSha256':'f67c9d1e1864ca50d2aaef6d8a0278215d55bbbbed5ea9053fcc16eda4c60c50','status':'OPERATIONAL_MILESTONE_NO_CREDIT'},
 {'tag':902,'commit':'698cb1633510aaf8a3473dc6689a390fdb566949','parent':'1131def14d7d9cc2380e70c8f2c2d2a12f20a60a','subject':'Tag 902: Spaete SEC-Periodik privat erfassen','workstream':'Q003_LATE_PERIODIC_CAPTURE_V1','artifactCount':3,'deltaSha256':'46776739bf7a0dcf092a1aa83682dcefbb4a35ae4706017d18d29ecee7a1d0be','status':'SUPERSEDED_OPERATIONAL_ATTEMPT_NO_CREDIT'},
 {'tag':903,'commit':'00e55a5cc1da8c22f54932429d5c5e5101f79dbd','parent':'698cb1633510aaf8a3473dc6689a390fdb566949','subject':'Tag 903: Abgebrochenen SEC-Transfer revisionssicher fortsetzen','workstream':'Q003_LATE_PERIODIC_CAPTURE_V2','artifactCount':3,'deltaSha256':'b24e02bd6d06b0f385c1965867cfed981a7405ccd30a28d033786755350be005','status':'SUPERSEDED_OPERATIONAL_ATTEMPT_NO_CREDIT'},
 {'tag':904,'commit':'8a223c237b8a7f8ddfe518a3e8b33b8364473b4e','parent':'00e55a5cc1da8c22f54932429d5c5e5101f79dbd','subject':'Tag 904: SEC-Transferabbrueche lueckenlos journalisieren','workstream':'Q003_LATE_PERIODIC_CAPTURE_V3','artifactCount':3,'deltaSha256':'00c6867eb7a76c148f7896cb2ba541547300bdc062665294741d13b7d1e8b7d7','status':'SUPERSEDED_OPERATIONAL_ATTEMPT_NO_CREDIT'},
 {'tag':905,'commit':'e6d19f41126c73007f2ff58e3a062dd202edf42b','parent':'8a223c237b8a7f8ddfe518a3e8b33b8364473b4e','subject':'Tag 905: SEC-Fortsetzung wiederanlaufbar versiegeln','workstream':'Q003_LATE_PERIODIC_CAPTURE_V4','artifactCount':3,'deltaSha256':'bd63462fa75e143ced1986c67d6cbdd36c39450d30e7899adf0c31d8c1d07dc0','status':'SUPERSEDED_OPERATIONAL_ATTEMPT_NO_CREDIT'},
 {'tag':906,'commit':'7cc5f2e7acdf568f1bd2d660b0e5bfe38145bac0','parent':'e6d19f41126c73007f2ff58e3a062dd202edf42b','subject':'Tag 906: Grosse SEC-Originale sicher zulassen','workstream':'Q003_LATE_PERIODIC_CAPTURE_V5_COMPLETE','artifactCount':3,'deltaSha256':'b700af02cdf7a1bc3f9fa56976e1da52b594e04aa74bc50d1ee6d40d410508c7','status':'OPERATIONAL_MILESTONE_NO_CREDIT'},
 {'tag':907,'commit':BASE,'parent':'7cc5f2e7acdf568f1bd2d660b0e5bfe38145bac0','subject':'Tag 907: Spaete SEC-Periodik inhaltlich ausschliessen','workstream':'Q003_LATE_PERIODIC_CONTENT_DISPOSITION','artifactCount':3,'deltaSha256':'54abde2faa8f3c00185756c0ff80439a4e95c0fab4e1ee1716a8e1f1f57f2fab','status':'OPERATIONAL_MILESTONE_NO_CREDIT'}]
EXPECTED_TASK_IDS=['Q001-QUANTCONNECT-TERMS-ACCOUNT','Q002-QUANTCONNECT-50-CASE-CONTRACT','Q003-SEC-TERMINAL-WEALTH-QUEUE','Q004-FINRA-OTC-CATALOG','Q005-US-EXCHANGE-PUBLIC-CATALOGS','Q006-TIINGO-FREE-ENTITLEMENT','Q007-OPENFIGI-ANONYMOUS-HANDSHAKE','Q008-BUSINESS-QUANT-FREE-HANDSHAKE','Q009-ALPHA-VANTAGE-NEGATIVE-CONTROL','Q010-RESEARCH-ARCHIVE-DISCOVERY']
SELF_NAMES=('EXPECTED_CONTRACT_RAW','EXPECTED_CONTROLLER_NORMALIZED','EXPECTED_TEST_NORMALIZED','EXPECTED_EVENTS_RAW','EXPECTED_STATE_RAW','EXPECTED_STATE_SELF','EXPECTED_PROJECTION_SHA')
class E(RuntimeError):pass
def fail(x):raise E(x)
def sha(x):return hashlib.sha256(x).hexdigest()
def canonical(x):return json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
def exact(x,k,l):
 if type(x) is not dict or set(x)!=set(k):fail(l+' keys changed')
def normalized_python(raw):
 s=raw.decode().replace('\r\n','\n')
 for n in SELF_NAMES:s=re.sub(rf'({n}\s*=\s*)\'[^\']+\'',rf"\g<1>'{n}_NORMALIZED'",s)
 return sha(s.encode())
def normalized_test(raw):return sha(raw.replace(b'\r\n',b'\n'))
def git(*a):
 r=subprocess.run(['git',*a],cwd=ROOT,capture_output=True,text=True,encoding='utf-8')
 if r.returncode:fail(r.stderr.strip() or 'Git failed')
 return r.stdout.strip()
def git_raw(c,p):
 r=subprocess.run(['git','show',f'{c}:{p}'],cwd=ROOT,capture_output=True)
 if r.returncode:fail('Git blob missing '+p)
 return r.stdout
def git_exists(c,p):return subprocess.run(['git','cat-file','-e',f'{c}:{p}'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0
def parse_events(raw,n):
 rows=[json.loads(x) for x in raw.decode().splitlines() if x]
 if len(rows)!=n:fail('event count changed')
 for i,row in enumerate(rows):
  b=copy.deepcopy(row);claim=b.pop('eventSha256',None)
  if claim!=sha(canonical(b)) or row.get('sequence')!=i+1 or row.get('previousEventSha256')!=(None if i==0 else rows[i-1]['eventSha256']):fail('event chain changed')
 return rows
def delta(c):
 a=[]
 for line in git('diff-tree','--no-commit-id','--name-status','-r',c).splitlines():
  st,p=line.split('\t',1);a.append({'status':st,'path':p,'sha256':sha(git_raw(c,p))})
 return a,sha(canonical(a))
def expected_projection():
 p=copy.deepcopy(json.loads(V21_STATE.read_bytes())['operationalProjection']);tasks={x['taskId']:x for x in p['tasks']};tasks['Q003-SEC-TERMINAL-WEALTH-QUEUE']['milestoneRefs'].extend([x['tag'] for x in MILESTONES if x['tag']!=900]);tasks['Q003-SEC-TERMINAL-WEALTH-QUEUE']['nextAction']='CONTINUE_IDENTITY_LAST_SESSION_CORPORATE_ACTION_AND_TERMINAL_RECONCILIATION_AFTER_COMPLETE_122_CLASSIC_PERIODIC_FILINGS_THROUGH_THE_BOUND_2024_12_31_CUTOFF_FOUND_ZERO_SOURCE_QUALIFIED_LATER_PAYMENT_OR_NO_FURTHER_PAYMENT_STATEMENTS_WITH_ZERO_TERMINAL_OR_RESULT_CREDIT';p['operationalMilestones'].extend([{k:x[k] for k in ('tag','commit','parent','subject','workstream','artifactCount','status')} for x in MILESTONES]);return p
def validate_projection(p):
 if p!=expected_projection() or sha(canonical(p))!=EXPECTED_PROJECTION_SHA:fail('projection changed')
 exact(p,{'taskCounts','tasks','q005Sublanes','scheduler','operationalMilestones','milestoneClaimLocks','lockedStudies','originalV4','scientificLocks'},'projection')
 if [x.get('taskId') for x in p['tasks']]!=EXPECTED_TASK_IDS:fail('tasks changed')
 counts=dict(Counter(x['operationalState'] for x in p['tasks']));counts['RESOLVED']=sum(x['operationalState']=='RESOLVED' for x in p['tasks'])
 if counts!=p['taskCounts'] or counts['RESOLVED']!=0:fail('counts changed')
 eligible=sorted((x for x in p['tasks'] if x['schedulerEligible'] is True and x['operationalState']=='AUTONOMOUS_OPEN'),key=lambda x:(-x['priority'],x['taskId']));ids=[x['taskId'] for x in eligible];blocked=[x['taskId'] for x in p['tasks'] if x['taskId'] not in set(ids)]
 if p['scheduler']!={'strategy':'HIGHEST_PRIORITY_AUTONOMOUS_OPEN_ONLY','eligibleTaskIds':ids,'blockedTaskIds':blocked,'nextTaskId':ids[0],'q002AutoNextForbidden':True} or ids[0]!='Q003-SEC-TERMINAL-WEALTH-QUEUE':fail('scheduler changed')
 if len(p['operationalMilestones'])!=45 or [x['tag'] for x in p['operationalMilestones'][-8:]]!=list(range(900,908)):fail('milestones changed')
 if any(x['status'] not in {'OPERATIONAL_MILESTONE_NO_CREDIT','SUPERSEDED_OPERATIONAL_ATTEMPT_NO_CREDIT'} for x in p['operationalMilestones']) or any(x is not False for x in p['milestoneClaimLocks'].values()):fail('credit changed')
 if p['originalV4']!={'protocol':'FEM-SEC-US@1.2.0','greenOfficialGates':2,'officialGateCount':13,'complete':False,'resultComputationAllowed':False,'outcomesAccessed':False}:fail('V4 changed')
 if p['scientificLocks'].get('studyCredit')!='NONE' or any(v is not False for k,v in p['scientificLocks'].items() if k!='studyCredit'):fail('scientific locks changed')
 return ids
def input_raw():
 a={k:sha((ROOT/p).read_bytes()) for k,p in INPUT_PATHS.items()}
 if a!=EXPECTED_INPUT_RAW:fail('input bytes changed')
 for k,p in INPUT_PATHS.items():
  if git_raw(BASE,p)!=(ROOT/p).read_bytes():fail('input Git bytes changed '+k)
 return a
def input_bundle(actual):
 ds=[]
 for m in MILESTONES:
  arts,d=delta(m['commit'])
  if len(arts)!=m['artifactCount'] or d!=m['deltaSha256'] or git('show','-s','--format=%P',m['commit']).split()!=[m['parent']] or git('show','-s','--format=%s',m['commit'])!=m['subject']:fail('milestone delta changed')
  ds.append(d)
 return sha(canonical({'baseCommit':BASE,'inputRawSha256':actual,'milestoneDeltaSha256':ds}))
def expected_consumer():return {'candidateFilings':122,'acceptedReceipts':122,'incidentCount':7,'requestEventCount':129,'totalRawBytes':1153819931,'normalizedSentences':328801,'broadSentenceCandidateRows':3710,'sourceQualifiedOriginalAmountRepeatedSentenceMatches':0,'sourceQualifiedPastAdditionalDistributionSentenceMatches':0,'sourceQualifiedNoFurtherPaymentSentenceMatches':0,'terminalWealthComplete':False,'outcomesAccessed':False}
def run_verified(script,expected):
 r=subprocess.run(['python','-B',str(script),'verify','--remote'],cwd=ROOT,capture_output=True,text=True,timeout=300)
 if r.returncode:fail(script.name+' remote verification failed')
 v=json.loads(r.stdout)
 if v.get('status')!='PASS' or v.get('outcomesAccessed') is not False:
  fail(script.name+' semantics changed')
 for k,x in expected.items():
  if v.get(k)!=x:fail(script.name+' count changed '+k)
def verify_consumers():
 run_verified(LATE_PERIODIC,{'candidateFilings':122,'normalizedSentences':328801,'broadSentenceCandidateRows':3710,'sourceQualifiedOriginalAmountRepeatedSentenceMatches':0,'sourceQualifiedPastAdditionalDistributionSentenceMatches':0,'sourceQualifiedNoFurtherPaymentSentenceMatches':0})
def build_event(actual,bundle):
 prev=parse_events(V21_EVENTS.read_bytes(),9)[-1];projection=expected_projection();e={'sequence':10,'eventId':'EVT-00000010','eventType':'OPERATIONAL_MILESTONES_TAG900_TO_TAG907_SEC_LATE_PERIODIC','createdAt':CREATED_AT,'agentId':'ROOT-CONTROLLER','fencingToken':0,'previousEventSha256':prev['eventSha256'],'inputBundleSha256':bundle,'payload':{'baseCommit':BASE,'milestones':copy.deepcopy(MILESTONES),'repositoryRemote':REMOTE,'sourceEventLogRawSha256':actual['v21EventLog'],'sourceStateRawSha256':actual['v21State'],'sourceStateSelfSha256':json.loads(V21_STATE.read_bytes())['stateSha256'],'sourceLastEventSha256':prev['eventSha256'],'replacementStatePath':AUTHORIZED[3],'supersessionReasonCode':'V21_POINTER_PREDATES_TAG900_TO_TAG907_SEC_LATE_PERIODIC_EVIDENCE','v22EventCarriesCompleteOperationalProjection':True,'consumerVerification':expected_consumer(),'noScientificCredit':True,'outcomesAccessed':False,'operationalProjectionSha256':sha(canonical(projection)),'operationalProjection':projection}};e['eventSha256']=sha(canonical(e));return e
def materialize_state(er,events,actual,bundle):
 last=events[-1]
 if last!=build_event(actual,bundle):fail('last event changed')
 p=last['payload']['operationalProjection'];validate_projection(p);v21=json.loads(V21_STATE.read_bytes());s={'schema':'early-detection-free-source-operational-state/v22','materializedAt':last['createdAt'],'track':'SHARED_OUTCOME_BLIND_INFRA','purpose':'Replay Tags900-907 as eight outcome-blind no-credit SEC late-periodic milestones while keeping Q003 unresolved.','repository':{'remote':REMOTE,'ref':REF,'buildBaseCommit':BASE,'buildBaseTag':907},'inputBundleSha256':bundle,'inputRawSha256':actual,'predecessor':{'version':21,'contractPath':INPUT_PATHS['v21Contract'],'contractRawSha256':actual['v21Contract'],'controllerPath':INPUT_PATHS['v21Controller'],'controllerRawSha256':actual['v21Controller'],'testPath':INPUT_PATHS['v21Test'],'testRawSha256':actual['v21Test'],'eventLogPath':INPUT_PATHS['v21EventLog'],'eventLogRawSha256':actual['v21EventLog'],'statePath':INPUT_PATHS['v21State'],'stateRawSha256':actual['v21State'],'stateSelfSha256':v21['stateSha256'],'lastEventSha256':events[-2]['eventSha256'],'appendOnly':True,'remoteVerificationRequired':True,'semanticStatus':'SUPERSEDED_BY_TAG900_TO_TAG907_SEC_LATE_PERIODIC_EVIDENCE_V22'},'eventLog':{'path':AUTHORIZED[2],'eventCount':10,'rawSha256':sha(er),'lastEventSha256':last['eventSha256'],'v21ByteExactPrefix':True,'hashChainVerified':True,'fullProjectionCarriedByLastEvent':True},'operationalProjection':p};s['stateSha256']=sha(canonical(s));return s
def exact_locks():return {'originalV4GreenOfficialGates':2,'originalV4OfficialGateCount':13,'originalV4Complete':False,'originalV4GateCredit':False,'identityResolved':False,'terminalWealthComplete':False,'fiveRequiredDataSemanticsComplete':False,'resultComputationAllowed':False,'pricesAccessed':False,'returnsAccessed':False,'outcomesAccessed':False}
def validate_contract(v,exact_artifact=True):
 exact(v,{'schema','createdAt','track','purpose','contractSelfSha256','repository','inputs','milestoneBindings','consumerVerification','implementation','outputs','replayContract','scientificLocks'},'contract')
 body=copy.deepcopy(v);claim=body.get('contractSelfSha256');body['contractSelfSha256']=None
 if claim!=sha(canonical(body)) or v['schema']!='early-detection-continuous-free-source-operational-state-contract/v22' or v['createdAt']!=CREATED_AT or v['track']!='SHARED_OUTCOME_BLIND_INFRA' or datetime.datetime.strptime(CREATED_AT,'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=datetime.timezone.utc)>datetime.datetime.now(datetime.timezone.utc):fail('contract identity')
 if v['purpose']!='Append Tags900-907 as exact no-credit SEC late-periodic discovery, private-capture and content-disposition milestones, preserve byte-exact V21 history, and keep Q003 open because this bounded lane found no source-qualified later payment or no-further-payment statement.':fail('purpose changed')
 if v['repository']!={'remote':REMOTE,'ref':REF,'buildBaseCommit':BASE,'buildBaseTag':907,'introductionMustBeDirectSingleParentChild':True,'introductionAddsExactlyAuthorizedPaths':True,'authorizedPaths':AUTHORIZED}:fail('repository changed')
 bundle=input_bundle(EXPECTED_INPUT_RAW)
 if v['inputs']!={'rawSha256':EXPECTED_INPUT_RAW,'inputBundleSha256':bundle,'inputBundleRecomputedFromRawHashesAndEightMilestoneDeltas':True,'v21EventLogMustBeByteExactPrefix':True,'v21ControllerMustVerifyRemoteBeforeImportCredit':True,'consumerArtifactMustVerifyRemoteBeforeImportCredit':True} or v['milestoneBindings']!=MILESTONES or v['consumerVerification']!=expected_consumer():fail('inputs or milestones changed')
 if exact_artifact:
  if v['implementation']!={'controllerNormalizedSha256':EXPECTED_CONTROLLER_NORMALIZED,'testNormalizedSha256':EXPECTED_TEST_NORMALIZED,'selfBindingsNormalizedBeforeHash':True} or normalized_python(Path(__file__).read_bytes())!=EXPECTED_CONTROLLER_NORMALIZED or normalized_test(TEST.read_bytes())!=EXPECTED_TEST_NORMALIZED:fail('implementation changed')
  events=parse_events(EVENTS.read_bytes(),10)
  if v['outputs']!={'eventLogPath':AUTHORIZED[2],'eventLogRawSha256':EXPECTED_EVENTS_RAW,'eventCount':10,'lastEventSha256':events[-1]['eventSha256'],'statePath':AUTHORIZED[3],'stateRawSha256':EXPECTED_STATE_RAW,'stateSelfSha256':EXPECTED_STATE_SELF,'operationalProjectionSha256':EXPECTED_PROJECTION_SHA}:fail('outputs changed')
 if v['replayContract']!={'lastEventCarriesCompleteOperationalProjection':True,'stateMustBeDeterministicallyMaterializedFromEvents':True,'v21EventLogMustBeByteExactPrefix':True,'taskCountsMustBeRecomputedFromTasks':True,'eligibleQueueMustBeRecomputedFromTasks':True,'nextTaskMustBeHighestPriorityEligibleTask':True,'milestoneDeltasMustBeRecomputedFromGitObjects':True,'nextRequiresRemotePostIntroduction':True,'verifyWithoutRemoteMustFail':True,'preIntroductionVerifyIsDiagnosticOnly':True} or v['scientificLocks']!=exact_locks():fail('replay or locks changed')
def load_contract(exact_artifact=True):
 raw=CONTRACT.read_bytes()
 if exact_artifact and sha(raw)!=EXPECTED_CONTRACT_RAW:fail('contract raw changed')
 v=json.loads(raw);validate_contract(v,exact_artifact);return v
def intro_phase(head):
 present=[p for p in AUTHORIZED if git_exists(head,p)]
 if not present:
  if head!=BASE:fail('pre intro moved')
  return 'PRE_INTRODUCTION',None
 if present!=AUTHORIZED:fail('partial intro')
 ins={git('log','--diff-filter=A','-1','--format=%H','--',p) for p in AUTHORIZED}
 if len(ins)!=1:fail('split intro')
 i=ins.pop()
 if git('show','-s','--format=%P',i).split()!=[BASE] or git('diff-tree','--no-commit-id','--name-status','-r',i).splitlines()!=[f'A\t{p}' for p in AUTHORIZED]:fail('intro topology')
 chain=git('rev-list','--first-parent',head).splitlines()
 if i not in chain:fail('intro absent')
 for c in chain[:chain.index(i)]:
  if len(git('show','-s','--format=%P',c).split())!=1:fail('nonlinear descendant')
 for p in AUTHORIZED:
  if git('log','-1','--format=%H','--',p)!=i or git_raw(head,p)!=(ROOT/p).read_bytes():fail('owned drift')
 return 'POST_INTRODUCTION',i
def verify(remote):
 if not remote:fail('remote mandatory')
 c=load_contract();actual=input_raw();bundle=input_bundle(actual)
 if c['inputs']['inputBundleSha256']!=bundle:fail('bundle changed')
 er=EVENTS.read_bytes();sr=STATE.read_bytes()
 if sha(er)!=EXPECTED_EVENTS_RAW or sha(sr)!=EXPECTED_STATE_RAW or not er.startswith(V21_EVENTS.read_bytes()):fail('outputs changed')
 events=parse_events(er,10);state=materialize_state(er,events,actual,bundle)
 if json.loads(sr)!=state or state['stateSha256']!=EXPECTED_STATE_SELF:fail('state replay changed')
 if git('remote','get-url','origin')!=REMOTE:fail('origin changed')
 head=git('rev-parse','HEAD');live=git('ls-remote','--refs','origin',REF).split()
 if len(live)!=2 or live[1]!=REF or not head==git('rev-parse','@{u}')==live[0]:fail('remote drift')
 r=subprocess.run(['python','-B',str(V21_CONTROLLER),'verify','--remote'],cwd=ROOT,capture_output=True,text=True,timeout=900)
 if r.returncode or json.loads(r.stdout).get('status')!='PASS':fail('V21 verification failed')
 verify_consumers();phase,i=intro_phase(head);ids=validate_projection(state['operationalProjection'])
 return {'schema':'early-detection-free-source-operational-state-verification/v22','status':'PASS' if phase=='POST_INTRODUCTION' else 'PRE_INTRODUCTION_DIAGNOSTIC','phase':phase,'introductionCommit':i,'controllerResumeAllowed':phase=='POST_INTRODUCTION','eventCount':10,'operationalMilestones':45,'newMilestones':8,'tasksConserved':10,'resolvedTasks':0,'eligibleTasks':len(ids),'nextTaskId':ids[0],'q002AutoNext':False,'originalV4GreenOfficialGates':2,'originalV4OfficialGateCount':13,'v21PrefixVerified':True,'milestoneGitDeltasVerified':8,'v21RemoteVerified':True,'consumerArtifactsRemoteVerified':1,'remoteVerified':True,'outcomesAccessed':False}
def materialize():
 if git('rev-parse','HEAD')!=BASE or git('rev-parse','@{u}')!=BASE or EVENTS.exists() or STATE.exists():fail('materialize base or paths changed')
 c=load_contract(False);actual=input_raw();bundle=input_bundle(actual)
 if c['inputs']['inputBundleSha256']!=bundle:fail('bundle mismatch')
 e=build_event(actual,bundle);er=V21_EVENTS.read_bytes()+canonical(e)+b'\n';events=parse_events(er,10);s=materialize_state(er,events,actual,bundle)
 EVENTS.write_bytes(er);STATE.write_text(json.dumps(s,ensure_ascii=False,indent=2,sort_keys=True)+'\n',encoding='utf-8')
 return {'status':'PASS','eventRawSha256':sha(er),'stateRawSha256':sha(STATE.read_bytes()),'stateSelfSha256':s['stateSha256'],'projectionSha256':sha(canonical(s['operationalProjection'])),'outcomesAccessed':False}
def rejected(f):
 try:f()
 except (E,OSError,KeyError,TypeError,ValueError,json.JSONDecodeError):return True
 return False
def self_test():
 p=expected_projection();ms={'dropTask':lambda x:x['tasks'].pop(),'resolve':lambda x:(x['tasks'][2].__setitem__('operationalState','RESOLVED'),x['taskCounts'].__setitem__('AUTONOMOUS_OPEN',3),x['taskCounts'].__setitem__('RESOLVED',1)),'rename':lambda x:x['tasks'][2].__setitem__('taskId','Q003-FAKE'),'next':lambda x:x['scheduler'].__setitem__('nextTaskId','Q010-RESEARCH-ARCHIVE-DISCOVERY'),'dropMilestone':lambda x:x['operationalMilestones'].pop(),'milestoneCredit':lambda x:x['operationalMilestones'][-1].__setitem__('status','SCIENTIFIC_CREDIT_GRANTED'),'taskCredit':lambda x:x['tasks'][2].__setitem__('originalV4GateCredit',True),'studyOutcome':lambda x:x['lockedStudies'][0].__setitem__('outcomesAccessed',True),'unknown':lambda x:x['scientificLocks'].__setitem__('unknownCredit',True),'v4':lambda x:x['originalV4'].__setitem__('greenOfficialGates',3)};kills={}
 for k,f in ms.items():x=copy.deepcopy(p);f(x);kills[k]=rejected(lambda x=x:validate_projection(x))
 c=load_contract(False)
 for k,f in {'backdate':lambda x:x.__setitem__('createdAt','1970-01-01T00:00:00Z'),'purpose':lambda x:x.__setitem__('purpose','complete'),'milestone':lambda x:x['milestoneBindings'].pop(),'consumer':lambda x:x['consumerVerification'].__setitem__('periodicCorroborationRows',8),'remote':lambda x:x['repository'].__setitem__('remote','https://example.invalid'),'path':lambda x:x['repository']['authorizedPaths'].__setitem__(3,'reports/x.json'),'bundle':lambda x:x['inputs'].__setitem__('inputBundleSha256','0'*64),'lock':lambda x:x['scientificLocks'].__setitem__('terminalWealthComplete',True),'extra':lambda x:x.__setitem__('credit',True)}.items():
  x=copy.deepcopy(c);f(x);x['contractSelfSha256']=None;x['contractSelfSha256']=sha(canonical(x));kills[k]=rejected(lambda x=x:validate_contract(x,False))
 if not all(kills.values()):fail('kill survived')
 return {'schema':'early-detection-free-source-operational-state-self-test/v22','status':'PASS','killCount':len(kills),'kills':kills,'outcomesAccessed':False}
def main():
 p=argparse.ArgumentParser();s=p.add_subparsers(dest='command',required=True)
 for x in ('verify','next'):q=s.add_parser(x);q.add_argument('--remote',action='store_true')
 s.add_parser('self-test');s.add_parser('materialize-pre-introduction');a=p.parse_args()
 try:
  if a.command=='self-test':out=self_test()
  elif a.command=='materialize-pre-introduction':out=materialize()
  else:
   out=verify(a.remote)
   if a.command=='next':
    if out['phase']!='POST_INTRODUCTION' or out['controllerResumeAllowed'] is not True:fail('next forbidden before introduction')
    out={'schema':'early-detection-free-source-next/v22','status':'PASS','nextTaskId':out['nextTaskId'],'remoteVerified':True,'postIntroductionVerified':True,'q002AutoNext':False,'outcomesAccessed':False}
 except (E,OSError,KeyError,TypeError,ValueError,json.JSONDecodeError) as e:p.error(str(e))
 print(json.dumps(out,sort_keys=True));return 0
if __name__=='__main__':raise SystemExit(main())
