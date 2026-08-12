#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'); const path=require('node:path'); const os=require('node:os'); const fs=require('node:fs'); const crypto=require('node:crypto'); const {spawnSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'); const script=path.join(ROOT,'scripts','verify-quantconnect-free-cloud-pilot-v4.py');
function run(pyFlags=[],scriptArgs=[]){return spawnSync(process.env.PYTHON||'python',[...pyFlags,'-B',script,...scriptArgs],{cwd:ROOT,encoding:'utf8',windowsHide:true});}
for(const flags of [[],['-O']]){const call=run(flags); assert.equal(call.status,0,call.stderr||call.stdout); const value=JSON.parse(call.stdout); assert.equal(value.status,'PASS'); assert.equal(value.staticContractVerified,true); assert.equal(value.executionBlocked,true); assert.equal(value.providerRunEnvelopesRequired,true); assert.equal(value.outcomesAccessed,false);}
function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']'; if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}'; return JSON.stringify(value);}
function finish(report){const copy=structuredClone(report); delete copy.reportSha256; report.reportSha256=crypto.createHash('sha256').update(canonical(copy)).digest('hex'); return report;}
const cases=JSON.parse(fs.readFileSync(path.join(ROOT,'research','early-detection-v4','quantconnect-free-cloud-pilot-cases-v1.json'),'utf8'));
const contract=JSON.parse(fs.readFileSync(path.join(ROOT,'research','early-detection-v4','quantconnect-free-cloud-pilot-contract-v4.json'),'utf8'));
function alias(ticker,role){return {role,requestedTicker:ticker,subscriptionAccepted:false,securityIdentifier:null,barCount:0,firstBarDate:null,lastBarDate:null,splitDates:[],dividendDates:[],symbolChanges:[],delistingEvents:[],errors:[]};}
function output(runId,time){return finish({schema:'early-detection-quantconnect-free-cloud-metadata-output/v4',pilotCoreSha256:contract.pilotCoreSha256,casesRawSha256:contract.boundFiles.casesRawSha256,providerRunId:runId,executedAt:time,leanVersion:'SYNTHETIC-SCHEMA-ONLY',datasetVersion:'SYNTHETIC-SCHEMA-ONLY',runMode:'DISCOVERY_ONLY',caseCount:50,rows:cases.cases.map(c=>({caseId:c.caseId,category:c.category,querySymbol:c.querySymbol,alternateSymbols:c.alternateSymbols,referenceStart:c.referenceStart,referenceEnd:c.referenceEnd,identityAssessment:'DISCOVERY_ONLY_UNRESOLVED',aliasResults:[alias(c.querySymbol,'PRIMARY'),...c.alternateSymbols.map(x=>alias(x,'ALTERNATE'))],errors:[]})),outcomesAccessed:false,priceValuesExported:false,returnsComputed:false,ordersSubmitted:false});}
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'qc-v3-')); const a=path.join(temp,'a.json'),b=path.join(temp,'b.json');
function writePair(left,right=left){fs.writeFileSync(a,JSON.stringify(finish(left))+'\n');fs.writeFileSync(b,JSON.stringify(finish(right))+'\n');}
writePair(output('RUN-A','2026-01-01T00:00:00Z'),output('RUN-B','2026-01-01T00:01:00Z'));
for(const flags of [[],['-O']]){const call=run(flags,['--run-a',a,'--run-b',b]); assert.equal(call.status,0,call.stderr||call.stdout); const value=JSON.parse(call.stdout); assert.equal(value.localTwoFileParityVerified,true); assert.equal(value.executionBlocked,true); assert.equal(value.providerRunEnvelopesRequired,true);}
const mutations=[
  x=>{x.rows[0].errors=[{CLOSE:123.45}];},
  x=>{x.rows[0].aliasResults[0].symbolChanges=[{date:'2010-01-01',requestedTicker:'AAPL',oldSymbol:'AAPL',newSymbol:'APPL',adjustedClose:120}];},
  x=>{x.rows[0].errors=[123.45];},
  x=>{x.rows[0].aliasResults[0].barCount='lots';},
  x=>{x.rows[0].aliasResults[0].barCount=-1;},
  x=>{x.rows[8].aliasResults[0].role='ALTERNATE';x.rows[8].aliasResults[1].role='PRIMARY';},
  x=>{x.rows[0].aliasResults[0].symbolChanges=[{date:'2025-01-01',requestedTicker:'AAPL',oldSymbol:'AAPL',newSymbol:'APPL'}];},
  x=>{x.rows[0].aliasResults[0].delistingEvents=[{date:'2008-01-01',requestedTicker:'AAPL',eventType:'Delisted'}];},
  x=>{x.rows[0].aliasResults[0].firstBarDate='2010-02-31';x.rows[0].aliasResults[0].lastBarDate='2010-02-31';x.rows[0].aliasResults[0].barCount=1;},
  x=>{x.rows[0].aliasResults[0].subscriptionAccepted=true;},
  x=>{x.rows[0].aliasResults[0].securityIdentifier='SID';x.rows[0].aliasResults[0].barCount=1;},
  x=>{x.rows[0].aliasResults[0].securityIdentifier='';},
  x=>{x.rows[0].aliasResults[0].errors=[''];},
  x=>{x.rows[0].aliasResults[0].barCount=999999;},
  x=>{x.rows[0].aliasResults[0].subscriptionAccepted=true;x.rows[0].aliasResults[0].securityIdentifier='SID';x.rows[0].aliasResults[0].symbolChanges=[{date:'2010-01-02',requestedTicker:'AAPL',oldSymbol:'AAPL',newSymbol:'APPL'},{date:'2010-01-01',requestedTicker:'AAPL',oldSymbol:'APPL',newSymbol:'AAPL'}];},
];
for(const mutate of mutations){const left=output('BAD-A','2026-01-01T00:00:00Z'); const right=output('BAD-B','2026-01-01T00:01:00Z'); mutate(left); mutate(right); writePair(left,right); const rejected=run(['-O'],['--run-a',a,'--run-b',b]); assert.notEqual(rejected.status,0,'malicious nested/type/date/role mutation must fail');}
fs.rmSync(temp,{recursive:true,force:true});
console.log('quantconnect-free-cloud-pilot-v4.test.js: PASS');
