#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'); const fs=require('node:fs'); const os=require('node:os'); const path=require('node:path'); const {spawnSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'); const script=path.join(ROOT,'scripts','build-sec-terminal-wealth-queue.py');
const report=JSON.parse(fs.readFileSync(path.join(ROOT,'reports','early-detection','sec-corporate-action-candidates-2009-2024.json'),'utf8'));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'sec-tw-queue-')); const output=path.join(temp,'queue.json');
const run=spawnSync(process.env.PYTHON||'python',['-B',script,'--database',report.database,'--output',output],{cwd:ROOT,encoding:'utf8',windowsHide:true});
assert.equal(run.status,0,run.stderr||run.stdout); const summary=JSON.parse(run.stdout); assert.equal(summary.status,'PASS'); assert.equal(summary.rows,44352); assert.equal(summary.outcomesAccessed,false);
const value=JSON.parse(fs.readFileSync(output,'utf8')); assert.deepEqual(value.counts,{rows:44352,form25Family:27285,form15Family:17067,unresolved:44352,resolved:0}); assert.equal(value.claimLocks.outcomesAccessed,false); assert.equal(value.claimLocks.resultComputationAllowed,false); assert.equal(value.rows.every(x=>x.resolutionState==='UNRESOLVED'&&x.outcomesAccessed===false),true);
const second=spawnSync(process.env.PYTHON||'python',['-B',script,'--database',report.database,'--output',output],{cwd:ROOT,encoding:'utf8',windowsHide:true}); assert.notEqual(second.status,0,'overwrite must fail');
fs.rmSync(temp,{recursive:true,force:true}); console.log('build-sec-terminal-wealth-queue.test.js: PASS');
