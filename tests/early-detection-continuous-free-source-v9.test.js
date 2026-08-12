#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'); const path=require('node:path'); const {spawnSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'); const script=path.join(ROOT,'scripts','early-detection-continuous-free-source-v9.py');
for(const optimization of [[],['-O']]){const run=spawnSync(process.env.PYTHON||'python',[...optimization,'-B',script,'self-test'],{cwd:ROOT,encoding:'utf8',windowsHide:true}); assert.equal(run.status,0,run.stderr||run.stdout); const v=JSON.parse(run.stdout); assert.equal(v.status,'PASS'); assert.equal(v.truthfulMaterializedAt,true); assert.equal(v.expiredLeaseRecovered,true); assert.equal(v.exactTransitionTemplatesRejectArbitraryText,true); assert.equal(v.v8PreImportBytesBound,true); assert.equal(v.outcomesAccessed,false);}
console.log('early-detection-continuous-free-source-v9.test.js: PASS');
