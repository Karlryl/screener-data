#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const controller=path.join(root,'scripts','early-detection-continuous-free-source-v23.py');
function run(args,optimized=false,ok=true,expectedError=null){
  const started=Date.now();
  const r=spawnSync('python',[...(optimized?['-O']:[]),'-B',controller,...args],{cwd:root,encoding:'utf8',timeout:75000});
  const elapsed=Date.now()-started;
  assert.equal(r.error,undefined,r.error?.stack||String(r.error));
  assert.equal(r.signal,null,`unexpected signal ${r.signal}`);
  assert.ok(elapsed<75000,`runtime regression: ${elapsed} ms`);
  if(!ok){
    assert.notEqual(r.status,0);
    if(expectedError) assert.match(r.stderr||r.stdout,expectedError);
    return null;
  }
  assert.equal(r.status,0,r.stderr||r.stdout);
  return JSON.parse(r.stdout);
}
for(const optimized of [false,true]){
  const self=run(['self-test'],optimized);
  assert.equal(self.killCount,85);
  assert.ok(Object.values(self.kills).every(Boolean));
  run(['verify'],optimized,false,/remote verification mandatory/);
  run(['next'],optimized,false,/remote verification mandatory/);
  const result=run(['verify','--remote'],optimized);
  assert.equal(result.eventCount,11);
  assert.equal(result.operationalMilestones,48);
  assert.equal(result.tasksConserved,10);
  assert.equal(result.resolvedTasks,0);
  assert.equal(result.nextTaskId,'Q010-RESEARCH-ARCHIVE-DISCOVERY');
  assert.equal(result.coreOperationalPriorityProjected,true);
  assert.equal(result.eligibleTasks,1);
  assert.deepEqual(result.pausedSupportingTaskIds,['Q003-SEC-TERMINAL-WEALTH-QUEUE','Q004-FINRA-OTC-CATALOG','Q005-US-EXCHANGE-PUBLIC-CATALOGS']);
  assert.equal(result.implicitSupportingFallbackForbidden,true);
  assert.equal(result.earlyDetectionSystemBuilt,false);
  assert.equal(result.supportingWorkAllowed,true);
  assert.equal(result.workChunkDecisionsVerified,true);
  assert.equal(result.v22TrustAnchorVerified,true);
  assert.equal(result.v22AnchorCaptureReceiptVerified,true);
  assert.equal(result.controllerChildExecutions,0);
  assert.equal(result.remoteTopologyVerified,true);
  assert.equal(result.remoteVerified,true);
  assert.equal(result.q003StillOpen,true);
  assert.equal(result.outcomesAccessed,false);
  if(result.phase==='PRE_INTRODUCTION'){
    assert.equal(result.status,'PRE_INTRODUCTION_DIAGNOSTIC');
    assert.equal(result.controllerResumeAllowed,false);
    assert.equal(result.coreOperationalPriorityRestored,false);
    assert.equal(result.introducedArtifactsRemoteVerified,false);
    assert.equal(result.nextDecisionAuthorizedToStart,false);
    run(['next','--remote'],optimized,false,/next forbidden before introduction/);
  }else{
    assert.equal(result.phase,'POST_INTRODUCTION');
    assert.equal(result.status,'PASS');
    assert.equal(result.controllerResumeAllowed,true);
    assert.equal(result.coreOperationalPriorityRestored,true);
    assert.equal(result.introducedArtifactsRemoteVerified,true);
    assert.equal(result.nextDecisionAuthorizedToStart,true);
    const next=run(['next','--remote'],optimized);
    assert.equal(next.nextTaskId,'Q010-RESEARCH-ARCHIVE-DISCOVERY');
    assert.equal(next.decisionAuthorizedToStart,true);
    assert.equal(next.decisionSourceEventId,'EVT-00000011');
  }
}
console.log('early-detection-continuous-free-source-v23.test.js: PASS');
