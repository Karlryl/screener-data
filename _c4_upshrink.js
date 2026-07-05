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

// Global: how does C4 change the distribution of names AROUND the median?
// Concern: low-coverage BELOW-median names pulled UP toward 50 -> mid-field crowding.
let pulledUpAcrossMed=0, pulledDownAcrossMed=0, total=0;
let midBefore=0,midAfter=0; // count of scores in [45,55]
const allFinals=[];
for(const[key,entries]of Object.entries(cohorts)){
  const formula=entries[0].formula,track=entries[0].track;
  const rawByAxis={};for(const ax of formula.axes)rawByAxis[ax.key]=entries.map(e=>rawAxisValue(e.snapshot,ax.key,formula,track,wb));
  const rows=[];
  for(let i=0;i<entries.length;i++){
    const axes=formula.axes.map(ax=>({value:q(rawByAxis[ax.key][i],rawByAxis[ax.key]),weight:ax.w[track]}));
    rows.push({base:weightedScore(axes),wcov:coverageWeight(axes)});
  }
  const med=quantile(rows.map(r=>r.base).filter(Number.isFinite),0.5);
  if(med===null)continue;
  for(const r of rows){
    if(!Number.isFinite(r.base)||!Number.isFinite(r.wcov))continue;
    const fin=(r.wcov===1)?r.base:med+r.wcov*(r.base-med);
    total++;
    if(r.base>=45&&r.base<=55)midBefore++;
    if(fin>=45&&fin<=55)midAfter++;
    allFinals.push(fin);
  }
}
console.log('total scored names:',total);
console.log('names in [45,55] BEFORE C4:',midBefore,'('+(100*midBefore/total).toFixed(1)+'%)  AFTER C4:',midAfter,'('+(100*midAfter/total).toFixed(1)+'%)');
console.log('=> mid-field crowding increase:',(midAfter-midBefore),'names ('+(100*(midAfter-midBefore)/total).toFixed(1)+'pp)');

// Tail thinning: names >=80 before vs after (the artifact C4 targets)
let hi80b=0,hi80a=0,lo20b=0,lo20a=0;
for(const[key,entries]of Object.entries(cohorts)){
  const formula=entries[0].formula,track=entries[0].track;
  const rawByAxis={};for(const ax of formula.axes)rawByAxis[ax.key]=entries.map(e=>rawAxisValue(e.snapshot,ax.key,formula,track,wb));
  const rows=[];for(let i=0;i<entries.length;i++){const axes=formula.axes.map(ax=>({value:q(rawByAxis[ax.key][i],rawByAxis[ax.key]),weight:ax.w[track]}));rows.push({base:weightedScore(axes),wcov:coverageWeight(axes)});}
  const med=quantile(rows.map(r=>r.base).filter(Number.isFinite),0.5);if(med===null)continue;
  for(const r of rows){if(!Number.isFinite(r.base)||!Number.isFinite(r.wcov))continue;const fin=(r.wcov===1)?r.base:med+r.wcov*(r.base-med);if(r.base>=80)hi80b++;if(fin>=80)hi80a++;if(r.base<=20)lo20b++;if(fin<=20)lo20a++;}
}
console.log('\nnames base>=80:',hi80b,' final>=80:',hi80a,' (tail thinned by',hi80b-hi80a,')');
console.log('names base<=20:',lo20b,' final<=20:',lo20a,' (low-tail thinned by',lo20b-lo20a,')');
