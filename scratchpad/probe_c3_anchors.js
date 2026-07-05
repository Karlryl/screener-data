'use strict';
const fs=require('fs'), path=require('path');
const SNAP='snapshots';
const ANCHORS=['PLTR','CRDO','ALAB','BE','2383.TW','2308.TW','WTC.AX'];

function loadUniverse(){
  const u=[];
  for(const f of fs.readdirSync(SNAP)){
    if(!f.endsWith('.json')||f.startsWith('_manifest'))continue;
    let s; try{ s=JSON.parse(fs.readFileSync(path.join(SNAP,f),'utf8')); }catch(_){continue;}
    if(s&&s.meta&&s.meta.ticker)u.push(s);
  }
  return u;
}
function scoreWith(patch){
  for(const k of Object.keys(require.cache)) if(k.includes('scoring')||k.includes('data-quality')) delete require.cache[k];
  const dq=require('../methods/data-quality.js');
  if(patch){
    const orig=dq.gradeSnapshot;
    dq.gradeSnapshot=function(s){
      const g=orig(s);
      if(g.grade==='D'&&g.criticalMissing){
        // option (a): only floor if marketCap missing OR the axis-read fields missing
        const hasMc=g.missingFields? !g.missingFields.includes('marketCap'):true;
        // re-derive band ignoring TTM-only floor
        const nr=g.nanRatio; let grade;
        if(nr<=0.20)grade='A+';else if(nr<=0.40)grade='A';else if(nr<=0.60)grade='B';else if(nr<=0.85)grade='C';else grade='D';
        // keep D only if marketCap actually missing
        const mcVal=s&&s.marketCap;
        const mcPresent=mcVal&&((typeof mcVal==='number'&&Number.isFinite(mcVal))||(typeof mcVal==='object'&&Number.isFinite(mcVal.value)));
        if(mcPresent) return {...g, grade, criticalMissing:false};
        return {...g, grade:'D'};
      }
      return g;
    };
  }
  const { scoreUniverse, produceRankings }=require('../src/scoring/score.js');
  const formulas=require('../src/scoring/formulas/index.js');
  const u=loadUniverse();
  const results=scoreUniverse(u, formulas);
  const byT={}; for(const r of results) byT[r.ticker]=r;
  return {results, byT};
}

const base=scoreWith(false);
const patched=scoreWith(true);
console.log('ticker     | baseScore | patchedScore | baseRank/cohort | patchRank/cohort');
function cohortRank(results, t){
  const e=results.byT[t];
  if(!e||e.action!=='route'||e.score===null)return {score:e?e.score:null,action:e?e.action:'??',rank:null,n:null};
  const co=results.results.filter(x=>x.action==='route'&&x.formulaId===e.formulaId&&x.track===e.track&&x.score!==null).sort((a,b)=>b.score-a.score);
  const rank=co.findIndex(x=>x.ticker===t)+1;
  return {score:Math.round(e.score*10)/10, action:e.action, rank, n:co.length, cohort:e.formulaId+'|'+e.track};
}
for(const t of ANCHORS){
  const b=cohortRank(base,t), p=cohortRank(patched,t);
  console.log(`${t.padEnd(10)} | ${String(b.score).padEnd(9)} | ${String(p.score).padEnd(12)} | ${b.rank}/${b.n} ${b.cohort} | ${p.rank}/${p.n} ${p.cohort}`);
}
// summary counts
function counts(r){
  let route=0,surv=0,ds=0;
  for(const e of r.results){ if(e.action==='route'&&e.score!==null)route++; else if(e.action==='survival')surv++; else if(e.reason==='data-suspect')ds++; }
  return {route,surv,ds};
}
console.log('--- universe counts ---');
console.log('base   :', JSON.stringify(counts(base)));
console.log('patched:', JSON.stringify(counts(patched)));
