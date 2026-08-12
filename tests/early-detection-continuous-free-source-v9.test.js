#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'); const path=require('node:path'); const {spawnSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'); const script=path.join(ROOT,'scripts','early-detection-continuous-free-source-v9.py');
for(const optimization of [[],['-O']]){
  const run=spawnSync(process.env.PYTHON||'python',[...optimization,'-B',script,'self-test'],{cwd:ROOT,encoding:'utf8',windowsHide:true});
  assert.notEqual(run.status,0,'superseded V9 must remain non-executable');
  assert.match(run.stderr,/RecursionError|maximum recursion depth exceeded/);
  assert.doesNotMatch(run.stdout,/"status"\s*:\s*"PASS"/);
}
console.log('early-detection-continuous-free-source-v9.test.js: PASS (superseded version fails closed)');
