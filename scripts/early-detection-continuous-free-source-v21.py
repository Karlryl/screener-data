#!/usr/bin/env python3
"""Replay-only, remote-gated controller for append-only operational state V21."""
from __future__ import annotations
import argparse,copy,datetime,hashlib,json,re,subprocess
from collections import Counter
from pathlib import Path
from typing import Any,Callable
ROOT=Path(__file__).resolve().parents[1]
CONTRACT=ROOT/'research'/'early-detection-v4'/'continuous-free-source-operational-state-contract-v21.json';EVENTS=ROOT/'state'/'early-detection-free-source-events-v21.jsonl';STATE=ROOT/'state'/'early-detection-free-source-state-v21.json';TEST=ROOT/'tests'/'early-detection-continuous-free-source-v21.test.js'
V20_CONTROLLER=ROOT/'scripts'/'early-detection-continuous-free-source-v20.py';V20_EVENTS=ROOT/'state'/'early-detection-free-source-events-v20.jsonl';V20_STATE=ROOT/'state'/'early-detection-free-source-state-v20.json'
DOWNSTREAM=ROOT/'scripts'/'verify-sec-liquidation-downstream-content-disposition-v1.py';PERIODIC=ROOT/'scripts'/'verify-sec-liquidation-periodic-content-disposition-v1.py'
REMOTE='https://github.com/Karlryl/screener-data.git';REF='refs/heads/codex/early-detection-v4-gates-20260810';BASE='c2a4e08893aad034392b880287641643bb3a8c47';CREATED_AT='2026-08-13T14:50:18Z'
EXPECTED_CONTRACT_RAW='a02d4a432b4cbc55fc13ae0142ed399e60fc76e8dc54be4d3c7b126d4c99d689'
EXPECTED_CONTROLLER_NORMALIZED='19d6a707572945ba37ae988afc30e61bf2f6711e6cc16b5bcf437f34dce9643f'
EXPECTED_TEST_NORMALIZED='15e4a2b53a88cd447bf6630cd5ecf761abf98388c21264a73bfe8bc87f46c26f'
EXPECTED_EVENTS_RAW='c6345b05771715dbca28f67862e036bf9b03df6b007a6d9c380d069facd2fca0'
EXPECTED_STATE_RAW='106e1af72379c061f6b1389649ecca155fd36e60b235ebc952efef3b3d92ec6a'
EXPECTED_STATE_SELF='f9cabe5422ac48aed3197d17ae58f02b651b7d3d47d027e90b0e62cd619e999a'
EXPECTED_PROJECTION_SHA='587c0b2b46e2f4d477123593f8953c2b0ca9ca1a9b4f0e2d2f6248d24c46bb26'
AUTHORIZED=['research/early-detection-v4/continuous-free-source-operational-state-contract-v21.json','scripts/early-detection-continuous-free-source-v21.py','state/early-detection-free-source-events-v21.jsonl','state/early-detection-free-source-state-v21.json','tests/early-detection-continuous-free-source-v21.test.js']
INPUT_PATHS={'v20Contract':'research/early-detection-v4/continuous-free-source-operational-state-contract-v20.json','v20Controller':'scripts/early-detection-continuous-free-source-v20.py','v20Test':'tests/early-detection-continuous-free-source-v20.test.js','v20EventLog':'state/early-detection-free-source-events-v20.jsonl','v20State':'state/early-detection-free-source-state-v20.json','downstreamContract':'research/early-detection-v4/sec-liquidation-downstream-content-disposition-contract-v1.json','downstreamVerifier':'scripts/verify-sec-liquidation-downstream-content-disposition-v1.py','downstreamTest':'tests/verify-sec-liquidation-downstream-content-disposition-v1.test.js','periodicContract':'research/early-detection-v4/sec-liquidation-periodic-content-disposition-contract-v1.json','periodicVerifier':'scripts/verify-sec-liquidation-periodic-content-disposition-v1.py','periodicTest':'tests/verify-sec-liquidation-periodic-content-disposition-v1.test.js'}
EXPECTED_INPUT_RAW={'v20Contract':'4d3003d800fcc008d09c8c5580864f3c785f25cc7d053ba2d8f51754f29e6a48','v20Controller':'e13960617934c10468ab8f92522e745b97580cb7304e85588c14b0787bb72c32','v20Test':'89f7d5df945ba4643f2e8a3edba93c86a8af78b8a3261934f4a3fab8328c6598','v20EventLog':'5fdcf15b333ef319bfc69c297d927a42d8a27dcb688327583d555c0a04f8650a','v20State':'44e9b09497040481b78739cb2fed6af3e6f097c559e4f962790b798317cce11e','downstreamContract':'a9100217bc53e13a9391a2c0971154e28c0f027243de35df886c9328ba9ace7e','downstreamVerifier':'4260ad89a5eb83aabedd85f1c5288ae43869f82bbbe9256ce37e7b570adf5d68','downstreamTest':'ce63b8d0e7b80eb96b845096daf6a174016e334325b6ac9ba38bde209e7a4248','periodicContract':'95cf24fe0df195d3b0df31dc56c4e913527acdf353fd0f2b5b2973bdcd4dc422','periodicVerifier':'28e1e4c35d3bdcc4ed1d3838286bad5dc0c268201ea0af2f870b53346c297f14','periodicTest':'b07718142e20731f66d341b591b73bd88f57451bb23034d8fba49f66eb4c8d9e'}
MILESTONES=[
 {'tag':893,'commit':'6573b0812e09dd12df176c7550800526481aa786','parent':'f5f5b9aa1af361481488c54cfcfee5fcb9914d69','subject':'Tag 893: Spaetere SEC-Emittentenfilings versiegelt entdecken','workstream':'Q003_DOWNSTREAM_SEC_DISCOVERY','artifactCount':3,'deltaSha256':'04c5cca3a05f949652607185f3ced4808f48305269acf6dbe68661a00e1cfa07','status':'OPERATIONAL_MILESTONE_NO_CREDIT'},
 {'tag':894,'commit':'7b434e1a17e4c1f29dc385004beb8afa705cbdd9','parent':'6573b0812e09dd12df176c7550800526481aa786','subject':'Tag 894: SEC-Folgefilings privat und fail-closed erfassen','workstream':'Q003_DOWNSTREAM_SEC_CAPTURE_V1','artifactCount':3,'deltaSha256':'a56f6014c4bcf7ac60ca08ac2f0029cf5f9a00fa5a3837fcb244e439e7e6854b','status':'SUPERSEDED_OPERATIONAL_ATTEMPT_NO_CREDIT'},
 {'tag':895,'commit':'d29d9cf382bbf7d06f7666c01c93f3357ec6122a','parent':'7b434e1a17e4c1f29dc385004beb8afa705cbdd9','subject':'Tag 895: SEC-Folgeerfassung verlustfrei fortsetzbar machen','workstream':'Q003_DOWNSTREAM_SEC_CAPTURE_V2','artifactCount':3,'deltaSha256':'b6dfb468bbf5d5fad8df779ff59d11da7c2aa4500cc25fae27899cf0fff65f75','status':'OPERATIONAL_MILESTONE_NO_CREDIT'},
 {'tag':896,'commit':'aa8b85831e3ce62c0cee5dfebae13111c48c073d','parent':'d29d9cf382bbf7d06f7666c01c93f3357ec6122a','subject':'Tag 896: SEC-Folgefilings inhaltlich eng abgrenzen','workstream':'Q003_DOWNSTREAM_SEC_CONTENT_DISPOSITION','artifactCount':3,'deltaSha256':'13137252280a84fdbd29cc61cacb7867549b10add4473c14fe6dca2bedcd9788','status':'OPERATIONAL_MILESTONE_NO_CREDIT'},
 {'tag':897,'commit':'c6129c49d262e2072d98d8f0bbc1587fddfa8260','parent':'aa8b85831e3ce62c0cee5dfebae13111c48c073d','subject':'Tag 897: Periodische SEC-Folgeberichte vorab versiegeln','workstream':'Q003_PERIODIC_SEC_DISCOVERY','artifactCount':3,'deltaSha256':'4cf6a882996d2ef542aba42c1f39ead5f67f931177a96ff57fc05ad3d2191c9c','status':'OPERATIONAL_MILESTONE_NO_CREDIT'},
 {'tag':898,'commit':'4f8492a51690045ea30ce7e6c6b671a4ebb990ef','parent':'c6129c49d262e2072d98d8f0bbc1587fddfa8260','subject':'Tag 898: Periodische SEC-Folgefilings privat erfassen','workstream':'Q003_PERIODIC_SEC_CAPTURE','artifactCount':3,'deltaSha256':'6ca5423b4b3c73e9b00ee0eea8dc3159a71502a529d0ff5cb9a1aeafd9e4e2b9','status':'OPERATIONAL_MILESTONE_NO_CREDIT'},
 {'tag':899,'commit':BASE,'parent':'4f8492a51690045ea30ce7e6c6b671a4ebb990ef','subject':'Tag 899: Periodische SEC-Berichte eng qualifizieren','workstream':'Q003_PERIODIC_SEC_CONTENT_DISPOSITION','artifactCount':3,'deltaSha256':'e893d8b3a08b8cfe3243e78de25466b81bd9879731b026821a94626df8d1af81','status':'OPERATIONAL_MILESTONE_NO_CREDIT'}]
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
 p=copy.deepcopy(json.loads(V20_STATE.read_bytes())['operationalProjection']);tasks={x['taskId']:x for x in p['tasks']};tasks['Q003-SEC-TERMINAL-WEALTH-QUEUE']['milestoneRefs'].extend([x['tag'] for x in MILESTONES]);tasks['Q003-SEC-TERMINAL-WEALTH-QUEUE']['nextAction']='CONTINUE_IDENTITY_LAST_SESSION_CORPORATE_ACTION_AND_TERMINAL_RECONCILIATION_AFTER_115_SHORT_WINDOW_AND_24_PERIODIC_SEC_FILINGS_PRODUCED_11_NARROW_CORROBORATION_ROWS_FOR_7_UNIQUE_CASES_WITH_ZERO_TERMINAL_OR_RESULT_CREDIT';p['operationalMilestones'].extend([{k:x[k] for k in ('tag','commit','parent','subject','workstream','artifactCount','status')} for x in MILESTONES]);return p
def validate_projection(p):
 if p!=expected_projection() or sha(canonical(p))!=EXPECTED_PROJECTION_SHA:fail('projection changed')
 exact(p,{'taskCounts','tasks','q005Sublanes','scheduler','operationalMilestones','milestoneClaimLocks','lockedStudies','originalV4','scientificLocks'},'projection')
 if [x.get('taskId') for x in p['tasks']]!=EXPECTED_TASK_IDS:fail('tasks changed')
 counts=dict(Counter(x['operationalState'] for x in p['tasks']));counts['RESOLVED']=sum(x['operationalState']=='RESOLVED' for x in p['tasks'])
 if counts!=p['taskCounts'] or counts['RESOLVED']!=0:fail('counts changed')
 eligible=sorted((x for x in p['tasks'] if x['schedulerEligible'] is True and x['operationalState']=='AUTONOMOUS_OPEN'),key=lambda x:(-x['priority'],x['taskId']));ids=[x['taskId'] for x in eligible];blocked=[x['taskId'] for x in p['tasks'] if x['taskId'] not in set(ids)]
 if p['scheduler']!={'strategy':'HIGHEST_PRIORITY_AUTONOMOUS_OPEN_ONLY','eligibleTaskIds':ids,'blockedTaskIds':blocked,'nextTaskId':ids[0],'q002AutoNextForbidden':True} or ids[0]!='Q003-SEC-TERMINAL-WEALTH-QUEUE':fail('scheduler changed')
 if len(p['operationalMilestones'])!=37 or [x['tag'] for x in p['operationalMilestones'][-7:]]!=list(range(893,900)):fail('milestones changed')
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
def expected_consumer():return {'downstreamCandidateFilings':115,'downstreamCorroborationRows':4,'periodicCandidateFilings':24,'periodicCorroborationRows':7,'uniqueCorroboratedCases':7,'terminalWealthComplete':False,'outcomesAccessed':False}
def run_verified(script,expected):
 r=subprocess.run(['python','-B',str(script),'verify','--remote'],cwd=ROOT,capture_output=True,text=True,timeout=300)
 if r.returncode:fail(script.name+' remote verification failed')
 v=json.loads(r.stdout)
 if v.get('status')!='PASS' or v.get('outcomesAccessed') is not False:
  fail(script.name+' semantics changed')
 for k,x in expected.items():
  if v.get(k)!=x:fail(script.name+' count changed '+k)
def verify_consumers():
 run_verified(DOWNSTREAM,{'candidateFilings':115,'laterLiquidationCorroborationRows':4,'sameDescriptorOriginalAmountSentenceMatches':0,'pastAdditionalDistributionSentenceMatches':0,'noFurtherPaymentSentenceMatches':0})
 run_verified(PERIODIC,{'candidateFilings':24,'corroborationRows':7,'originalAmountRepeatedSentenceMatches':0,'pastAdditionalDistributionSentenceMatches':0,'noFurtherPaymentSentenceMatches':0})
def build_event(actual,bundle):
 prev=parse_events(V20_EVENTS.read_bytes(),8)[-1];projection=expected_projection();e={'sequence':9,'eventId':'EVT-00000009','eventType':'OPERATIONAL_MILESTONES_TAG893_TO_TAG899_SEC_DOWNSTREAM_PERIODIC','createdAt':CREATED_AT,'agentId':'ROOT-CONTROLLER','fencingToken':0,'previousEventSha256':prev['eventSha256'],'inputBundleSha256':bundle,'payload':{'baseCommit':BASE,'milestones':copy.deepcopy(MILESTONES),'repositoryRemote':REMOTE,'sourceEventLogRawSha256':actual['v20EventLog'],'sourceStateRawSha256':actual['v20State'],'sourceStateSelfSha256':json.loads(V20_STATE.read_bytes())['stateSha256'],'sourceLastEventSha256':prev['eventSha256'],'replacementStatePath':AUTHORIZED[3],'supersessionReasonCode':'V20_POINTER_PREDATES_TAG893_TO_TAG899_SEC_EVIDENCE','v21EventCarriesCompleteOperationalProjection':True,'consumerVerification':expected_consumer(),'noScientificCredit':True,'outcomesAccessed':False,'operationalProjectionSha256':sha(canonical(projection)),'operationalProjection':projection}};e['eventSha256']=sha(canonical(e));return e
def materialize_state(er,events,actual,bundle):
 last=events[-1]
 if last!=build_event(actual,bundle):fail('last event changed')
 p=last['payload']['operationalProjection'];validate_projection(p);v20=json.loads(V20_STATE.read_bytes());s={'schema':'early-detection-free-source-operational-state/v21','materializedAt':last['createdAt'],'track':'SHARED_OUTCOME_BLIND_INFRA','purpose':'Replay Tags893-899 as seven outcome-blind no-credit SEC downstream and periodic-filing milestones while keeping Q003 unresolved.','repository':{'remote':REMOTE,'ref':REF,'buildBaseCommit':BASE,'buildBaseTag':899},'inputBundleSha256':bundle,'inputRawSha256':actual,'predecessor':{'version':20,'contractPath':INPUT_PATHS['v20Contract'],'contractRawSha256':actual['v20Contract'],'controllerPath':INPUT_PATHS['v20Controller'],'controllerRawSha256':actual['v20Controller'],'testPath':INPUT_PATHS['v20Test'],'testRawSha256':actual['v20Test'],'eventLogPath':INPUT_PATHS['v20EventLog'],'eventLogRawSha256':actual['v20EventLog'],'statePath':INPUT_PATHS['v20State'],'stateRawSha256':actual['v20State'],'stateSelfSha256':v20['stateSha256'],'lastEventSha256':events[-2]['eventSha256'],'appendOnly':True,'remoteVerificationRequired':True,'semanticStatus':'SUPERSEDED_BY_TAG893_TO_TAG899_SEC_EVIDENCE_V21'},'eventLog':{'path':AUTHORIZED[2],'eventCount':9,'rawSha256':sha(er),'lastEventSha256':last['eventSha256'],'v20ByteExactPrefix':True,'hashChainVerified':True,'fullProjectionCarriedByLastEvent':True},'operationalProjection':p};s['stateSha256']=sha(canonical(s));return s
def exact_locks():return {'originalV4GreenOfficialGates':2,'originalV4OfficialGateCount':13,'originalV4Complete':False,'originalV4GateCredit':False,'identityResolved':False,'terminalWealthComplete':False,'fiveRequiredDataSemanticsComplete':False,'resultComputationAllowed':False,'pricesAccessed':False,'returnsAccessed':False,'outcomesAccessed':False}
def validate_contract(v,exact_artifact=True):
 exact(v,{'schema','createdAt','track','purpose','contractSelfSha256','repository','inputs','milestoneBindings','consumerVerification','implementation','outputs','replayContract','scientificLocks'},'contract')
 body=copy.deepcopy(v);claim=body.get('contractSelfSha256');body['contractSelfSha256']=None
 if claim!=sha(canonical(body)) or v['schema']!='early-detection-continuous-free-source-operational-state-contract/v21' or v['createdAt']!=CREATED_AT or v['track']!='SHARED_OUTCOME_BLIND_INFRA' or datetime.datetime.strptime(CREATED_AT,'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=datetime.timezone.utc)>datetime.datetime.now(datetime.timezone.utc):fail('contract identity')
 if v['purpose']!='Append Tags893-899 as exact no-credit SEC downstream and periodic-filing milestones, preserve byte-exact V20 history, and keep Q003 open until all five semantics are actually resolved.':fail('purpose changed')
 if v['repository']!={'remote':REMOTE,'ref':REF,'buildBaseCommit':BASE,'buildBaseTag':899,'introductionMustBeDirectSingleParentChild':True,'introductionAddsExactlyAuthorizedPaths':True,'authorizedPaths':AUTHORIZED}:fail('repository changed')
 bundle=input_bundle(EXPECTED_INPUT_RAW)
 if v['inputs']!={'rawSha256':EXPECTED_INPUT_RAW,'inputBundleSha256':bundle,'inputBundleRecomputedFromRawHashesAndSevenMilestoneDeltas':True,'v20EventLogMustBeByteExactPrefix':True,'v20ControllerMustVerifyRemoteBeforeImportCredit':True,'consumerArtifactsMustVerifyRemoteBeforeImportCredit':True} or v['milestoneBindings']!=MILESTONES or v['consumerVerification']!=expected_consumer():fail('inputs or milestones changed')
 if exact_artifact:
  if v['implementation']!={'controllerNormalizedSha256':EXPECTED_CONTROLLER_NORMALIZED,'testNormalizedSha256':EXPECTED_TEST_NORMALIZED,'selfBindingsNormalizedBeforeHash':True} or normalized_python(Path(__file__).read_bytes())!=EXPECTED_CONTROLLER_NORMALIZED or normalized_test(TEST.read_bytes())!=EXPECTED_TEST_NORMALIZED:fail('implementation changed')
  events=parse_events(EVENTS.read_bytes(),9)
  if v['outputs']!={'eventLogPath':AUTHORIZED[2],'eventLogRawSha256':EXPECTED_EVENTS_RAW,'eventCount':9,'lastEventSha256':events[-1]['eventSha256'],'statePath':AUTHORIZED[3],'stateRawSha256':EXPECTED_STATE_RAW,'stateSelfSha256':EXPECTED_STATE_SELF,'operationalProjectionSha256':EXPECTED_PROJECTION_SHA}:fail('outputs changed')
 if v['replayContract']!={'lastEventCarriesCompleteOperationalProjection':True,'stateMustBeDeterministicallyMaterializedFromEvents':True,'v20EventLogMustBeByteExactPrefix':True,'taskCountsMustBeRecomputedFromTasks':True,'eligibleQueueMustBeRecomputedFromTasks':True,'nextTaskMustBeHighestPriorityEligibleTask':True,'milestoneDeltasMustBeRecomputedFromGitObjects':True,'nextRequiresRemotePostIntroduction':True,'verifyWithoutRemoteMustFail':True,'preIntroductionVerifyIsDiagnosticOnly':True} or v['scientificLocks']!=exact_locks():fail('replay or locks changed')
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
 if sha(er)!=EXPECTED_EVENTS_RAW or sha(sr)!=EXPECTED_STATE_RAW or not er.startswith(V20_EVENTS.read_bytes()):fail('outputs changed')
 events=parse_events(er,9);state=materialize_state(er,events,actual,bundle)
 if json.loads(sr)!=state or state['stateSha256']!=EXPECTED_STATE_SELF:fail('state replay changed')
 if git('remote','get-url','origin')!=REMOTE:fail('origin changed')
 head=git('rev-parse','HEAD');live=git('ls-remote','--refs','origin',REF).split()
 if len(live)!=2 or live[1]!=REF or not head==git('rev-parse','@{u}')==live[0]:fail('remote drift')
 r=subprocess.run(['python','-B',str(V20_CONTROLLER),'verify','--remote'],cwd=ROOT,capture_output=True,text=True,timeout=300)
 if r.returncode or json.loads(r.stdout).get('status')!='PASS':fail('V20 verification failed')
 verify_consumers();phase,i=intro_phase(head);ids=validate_projection(state['operationalProjection'])
 return {'schema':'early-detection-free-source-operational-state-verification/v21','status':'PASS' if phase=='POST_INTRODUCTION' else 'PRE_INTRODUCTION_DIAGNOSTIC','phase':phase,'introductionCommit':i,'controllerResumeAllowed':phase=='POST_INTRODUCTION','eventCount':9,'operationalMilestones':37,'newMilestones':7,'tasksConserved':10,'resolvedTasks':0,'eligibleTasks':len(ids),'nextTaskId':ids[0],'q002AutoNext':False,'originalV4GreenOfficialGates':2,'originalV4OfficialGateCount':13,'v20PrefixVerified':True,'milestoneGitDeltasVerified':7,'v20RemoteVerified':True,'consumerArtifactsRemoteVerified':2,'remoteVerified':True,'outcomesAccessed':False}
def materialize():
 if git('rev-parse','HEAD')!=BASE or git('rev-parse','@{u}')!=BASE or EVENTS.exists() or STATE.exists():fail('materialize base or paths changed')
 c=load_contract(False);actual=input_raw();bundle=input_bundle(actual)
 if c['inputs']['inputBundleSha256']!=bundle:fail('bundle mismatch')
 e=build_event(actual,bundle);er=V20_EVENTS.read_bytes()+canonical(e)+b'\n';events=parse_events(er,9);s=materialize_state(er,events,actual,bundle)
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
 return {'schema':'early-detection-free-source-operational-state-self-test/v21','status':'PASS','killCount':len(kills),'kills':kills,'outcomesAccessed':False}
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
    out={'schema':'early-detection-free-source-next/v21','status':'PASS','nextTaskId':out['nextTaskId'],'remoteVerified':True,'postIntroductionVerified':True,'q002AutoNext':False,'outcomesAccessed':False}
 except (E,OSError,KeyError,TypeError,ValueError,json.JSONDecodeError) as e:p.error(str(e))
 print(json.dumps(out,sort_keys=True));return 0
if __name__=='__main__':raise SystemExit(main())
