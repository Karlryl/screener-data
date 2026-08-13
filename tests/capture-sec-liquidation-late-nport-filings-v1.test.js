#!/usr/bin/env node
'use strict';
const assert=require('assert'),path=require('path'),{spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..'),runner=path.join(root,'scripts','capture-sec-liquidation-late-nport-filings-v1.py');
function run(cmd,opt=false){const a=[...(opt?['-O']:[]),'-B',runner,cmd,'--remote'],r=spawnSync('python',a,{cwd:root,encoding:'utf8'});assert.strictEqual(r.status,0,`${a.join(' ')}\n${r.stdout}\n${r.stderr}`);return JSON.parse(r.stdout)}
for(const opt of [false,true]){
 const d=run('dry-run',opt);assert.strictEqual(d.candidateFilings,2433);assert.strictEqual(d.caseCandidateLinks,11386);assert.strictEqual(d.networkRequests,0);assert.strictEqual(d.writes,0);assert.strictEqual(d.outcomesAccessed,false);
 const s=run('self-test',opt);assert.strictEqual(Object.keys(s.mutationKills).length,16);assert.ok(Object.values(s.mutationKills).every(Boolean));
 const n=spawnSync('python',[...(opt?['-O']:[]),'-B',runner,'dry-run'],{cwd:root,encoding:'utf8'});assert.strictEqual(n.status,2);
}
console.log(JSON.stringify({status:'PASS',candidateFilings:2433,caseCandidateLinks:11386,outcomesAccessed:false}));
