'use strict';
const assert=require('node:assert/strict'); const cp=require('node:child_process'); const fs=require('node:fs'); const path=require('node:path'); const test=require('node:test');
const ROOT=path.resolve(__dirname,'..'); const SCRIPT=path.join(ROOT,'scripts','run-finra-q004-accounted-handshake-v3.py'); const OUTPUT=path.join(ROOT,'reports','early-detection','finra-q004-public-credential-handshake-v3.json');
function run(args,opt=false){return cp.spawnSync('python',[...(opt?['-O']:[]),SCRIPT,...args],{cwd:ROOT,encoding:'utf8',windowsHide:true});}
test('FINRA V3 handshake is timeline-correct and quarantines V2',()=>{
  for(const opt of [false,true]){
    let call=run(['verify-contract'],opt); assert.equal(call.status,0,call.stderr); let value=JSON.parse(call.stdout); assert.equal(value.status,'PASS'); assert.equal(value.predecessorCredit,'ZERO'); assert.equal(value.outcomesAccessed,false);
    call=run(['self-test'],opt); assert.equal(call.status,0,call.stderr); value=JSON.parse(call.stdout); assert.equal(value.status,'PASS'); assert.ok(Object.values(value.kills).every(Boolean)); assert.equal(value.secretsCaptured,false); assert.doesNotMatch(call.stdout,/SYNTHETIC_TOKEN_NEVER_PERSISTED/);
    if(fs.existsSync(OUTPUT)){call=run(['verify-output','--output',OUTPUT],opt); assert.equal(call.status,0,call.stderr); value=JSON.parse(call.stdout); assert.equal(value.status,'PASS'); assert.equal(value.predecessorCredit,'ZERO');}
  }
});
