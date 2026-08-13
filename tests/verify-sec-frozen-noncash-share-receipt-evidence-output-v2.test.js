'use strict';
const assert=require('assert');
const path=require('path');
const {spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..');
const script=path.join(root,'scripts','verify-sec-frozen-noncash-share-receipt-evidence-output-v2.py');
function invoke(command,optimized=false){const args=[];if(optimized)args.push('-O');args.push('-B',script,command);const r=spawnSync('python',args,{cwd:root,encoding:'utf8'});assert.strictEqual(r.status,0,r.stderr||r.stdout);return JSON.parse(r.stdout);}
for(const optimized of [false,true]){
  const self=invoke('self-test',optimized);assert.strictEqual(self.status,'PASS');assert.strictEqual(Object.values(self.kills).every(Boolean),true);assert.strictEqual(self.outcomesAccessed,false);
  const out=invoke('verify',optimized);assert.strictEqual(out.status,'PASS');assert.ok(['PRE_INTRODUCTION','POST_INTRODUCTION'].includes(out.phase));assert.strictEqual(out.verifiedRows,6);assert.strictEqual(out.ratioRows,8);assert.strictEqual(out.dualRatioRows,2);assert.strictEqual(out.sourceRebuildByteExact,true);assert.strictEqual(out.outcomesAccessed,false);
}
console.log('verify-sec-frozen-noncash-share-receipt-evidence-output-v2.test.js: PASS');
