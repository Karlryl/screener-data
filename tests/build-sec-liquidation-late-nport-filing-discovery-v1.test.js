#!/usr/bin/env node
'use strict';
const assert=require('assert'),path=require('path'),{spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..'),builder=path.join(root,'scripts','build-sec-liquidation-late-nport-filing-discovery-v1.py');
function run(cmd,opt=false){const a=[...(opt?['-O']:[]),'-B',builder,cmd,'--remote'],r=spawnSync('python',a,{cwd:root,encoding:'utf8'});assert.strictEqual(r.status,0,`${a.join(' ')}\n${r.stdout}\n${r.stderr}`);return JSON.parse(r.stdout)}
for(const opt of [false,true]){
 const r=run('dry-run',opt);assert.strictEqual(r.candidateFilings,2433);assert.strictEqual(r.caseCandidateLinks,11386);assert.deepStrictEqual(r.formCounts,{'NPORT-P':2420,'NPORT-P/A':13});assert.strictEqual(r.networkRequests,0);assert.strictEqual(r.writes,0);assert.strictEqual(r.outcomesAccessed,false);
 const s=run('self-test',opt);assert.strictEqual(Object.keys(s.mutationKills).length,17);assert.ok(Object.values(s.mutationKills).every(Boolean));
 const n=spawnSync('python',[...(opt?['-O']:[]),'-B',builder,'dry-run'],{cwd:root,encoding:'utf8'});assert.strictEqual(n.status,2);
}
console.log(JSON.stringify({status:'PASS',candidateFilings:2433,caseCandidateLinks:11386,outcomesAccessed:false}));
