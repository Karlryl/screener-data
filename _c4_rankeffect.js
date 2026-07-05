'use strict';
const fs=require('fs'),path=require('path');
const { norm } = require('./src/scoring/snapshot.js');
const { q, weightedScore, coverageWeight } = require('./src/scoring/engine.js');
const { route } = require('./src/scoring/router.js');
const axesFns = require('./src/scoring/axes.js');
const formulas = require('./src/scoring/formulas/index.js');
const { rawAxisValue, trackOf } = require('./src/scoring/score.js');
const SNAP_DIR=path.join(__dirname,'snapshots');
function loadUniverse(){const u=[];for(const f of fs.readdirSync(SNAP_DIR)){if(!f.endsWith('.json'))continue;if(f.startsWith('_manifest')||f==='_last_good_disk.json')continue;let s;try{s=JSON.parse(fs.readFileSync(path.join(SNAP_DIR,f),'utf8'));}catch(_){continue;}if(s&&s.meta&&s.meta.ticker)u.push(s);}return u;}
const universe=loadUniverse();
const routedRaw=[];
for(const s of universe){const r=route(s);if(r.action!=='route'||!formulas[r.formulaId])continue;const e={ticker:(s.meta&&s.meta.ticker),snapshot:s,formulaId:r.formulaId,formula:formulas[r.formulaId]};e.track=trackOf(s,e.formula);routedRaw.push(e);}
const WINSOR_TAIL=0.01,OPMARGIN_CAP=1.0;
function quantile(a,p){a=a.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const idx=(a.length-1)*p,lo=Math.floor(idx),hi=Math.ceil(idx);return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(idx-lo);}
function wtb(s){const lo=quantile(s,WINSOR_TAIL),hi=quantile(s,1-WINSOR_TAIL);return(lo===null||hi===null)?null:[lo,hi];}
const opm=[],qoq=[];for(const e of routedRaw){for(const v of axesFns.quarterOpMargins(e.snapshot))opm.push(v);for(const v of axesFns.quarterQoQRates(e.snapshot))qoq.push(v);}
const ot=wtb(opm);const wb={opMargin:ot?[ot[0],OPMARGIN_CAP]:null,qoq:wtb(qoq)};
const cohorts={};for(const e of routedRaw)(cohorts[e.formulaId+'|'+e.track]||=[]).push(e);

function cohortScores(key){
  const entries=cohorts[key];const formula=entries[0].formula,track=entries[0].track;
  const wts=formula.axes.map(a=>a.w[track]);const sumAll=wts.reduce((a,b)=>a+b,0);const varFull=wts.reduce((a,b)=>a+b*b,0)/(sumAll*sumAll);
  const rawByAxis={};for(const ax of formula.axes)rawByAxis[ax.key]=entries.map(e=>rawAxisValue(e.snapshot,ax.key,formula,track,wb));
  const rows=[];
  for(let i=0;i<entries.length;i++){
    const mask=formula.axes.map(ax=>{const p=q(rawByAxis[ax.key][i],rawByAxis[ax.key]);return p!==null&&Number.isFinite(p);});
    const axes=formula.axes.map((ax,j)=>({value:mask[j]?q(rawByAxis[ax.key][i],rawByAxis[ax.key]):null,weight:ax.w[track]}));
    const base=weightedScore(axes),wcov=coverageWeight(axes);
    rows.push({t:entries[i].ticker,base,wcov,mask});
  }
  const med=quantile(rows.map(r=>r.base).filter(Number.isFinite),0.5);
  for(const r of rows){
    if(!Number.isFinite(r.base)){r.final=null;r.finalCorrect=null;continue;}
    r.final=(r.wcov===1)?r.base:med+r.wcov*(r.base-med);
    const pw=wts.filter((_,j)=>r.mask[j]);const sumP=pw.reduce((a,b)=>a+b,0);const varPart=pw.reduce((a,b)=>a+b*b,0)/(sumP*sumP);
    const sd=Math.sqrt(varFull/varPart);
    r.finalCorrect=(r.wcov===1)?r.base:med+sd*(r.base-med);
  }
  return {rows:rows.filter(r=>r.final!==null),med};
}

for(const key of['materials|profitable','consumer-discretionary|profitable']){
  const {rows,med}=cohortScores(key);
  const byBase=[...rows].sort((a,b)=>b.base-a.base).map(r=>r.t);
  const byFinal=[...rows].sort((a,b)=>b.final-a.final).map(r=>r.t);
  const byCorrect=[...rows].sort((a,b)=>b.finalCorrect-a.finalCorrect).map(r=>r.t);
  console.log(`\n=== ${key} (n=${rows.length}, med=${med.toFixed(1)}) ===`);
  console.log('TOP10 by C4-final : ',byFinal.slice(0,10).join(', '));
  console.log('TOP10 by var-correct: ',byCorrect.slice(0,10).join(', '));
  // how many names in C4-top10 are absent from var-correct-top10?
  const c4t=new Set(byFinal.slice(0,10)),cot=new Set(byCorrect.slice(0,10));
  const droppedByC4=[...cot].filter(t=>!c4t.has(t));
  console.log('In var-correct top10 but PUSHED OUT of C4 top10:',droppedByC4.join(', ')||'(none)');
}
