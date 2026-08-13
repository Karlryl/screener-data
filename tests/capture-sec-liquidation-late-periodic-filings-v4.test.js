#!/usr/bin/env node
'use strict';
const assert=require('assert'),path=require('path'),{spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..'),runner=path.join(root,'scripts','capture-sec-liquidation-late-periodic-filings-v4.py');
function run(c,o=false,remote=true,code=0){const a=[...(o?['-O']:[]),'-B',runner,c,...(remote?['--remote']:[])],r=spawnSync('python',a,{cwd:root,encoding:'utf8'});assert.strictEqual(r.status,code,`${a.join(' ')}\n${r.stdout}\n${r.stderr}`);return code?null:JSON.parse(r.stdout)}
for(const o of [false,true]){const r=run('dry-run',o);assert.strictEqual(r.candidateFilings,122);assert.strictEqual(r.capturedCandidates,78);assert.strictEqual(r.remainingCandidates,44);assert.strictEqual(r.incidentCount,3);assert.strictEqual(r.maximumAttemptSequence,81);assert.strictEqual(r.nextRequestSequence,82);assert.strictEqual(r.networkRequests,0);assert.strictEqual(r.writes,0);assert.strictEqual(r.outcomesAccessed,false);const s=run('self-test',o);assert.strictEqual(Object.keys(s.mutationKills).length,9);assert.ok(Object.values(s.mutationKills).every(Boolean));run('dry-run',o,false,2)}
console.log(JSON.stringify({status:'PASS',capturedCandidates:78,incidentCount:3,nextRequestSequence:82,outcomesAccessed:false}));
