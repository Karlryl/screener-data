'use strict';
const fs=require('fs'),path=require('path');
const { norm, metricVal, firstPresent, presentValues } = require('./src/scoring/snapshot.js');
const { q, weightedScore, coverageWeight, signTrack } = require('./src/scoring/engine.js');
const { route } = require('./src/scoring/router.js');
const { evaluateLamps } = require('./src/scoring/lamps.js');
const axesFns = require('./src/scoring/axes.js');
const formulas = require('./src/scoring/formulas/index.js');
const { rawAxisValue, trackOf, scoreUniverse } = require('./src/scoring/score.js');
const SNAP_DIR = path.join(__dirname,'snapshots');
function loadUniverse(){const u=[];for(const f of fs.readdirSync(SNAP_DIR)){if(!f.endsWith('.json'))continue;if(f.startsWith('_manifest')||f==='_last_good_disk.json')continue;let s;try{s=JSON.parse(fs.readFileSync(path.join(SNAP_DIR,f),'utf8'));}catch(_){continue;}if(s&&s.meta&&s.meta.ticker)u.push(s);}return u;}
const universe=loadUniverse();

// Reconstruct base+wcov+final for every routed name using the exact score.js path minus gating.
const routedRaw=[];
for(const s of universe){const r=route(s);if(r.action!=='route'||!formulas[r.formulaId])continue;const e={ticker:(s.meta&&s.meta.ticker),snapshot:s,formulaId:r.formulaId,formula:formulas[r.formulaId]};e.track=trackOf(s,e.formula);routedRaw.push(e);}
const WINSOR_TAIL=0.01,OPMARGIN_CAP=1.0;
function quantile(a,p){a=a.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const idx=(a.length-1)*p,lo=Math.floor(idx),hi=Math.ceil(idx);return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(idx-lo);}
function wtb(s){const lo=quantile(s,WINSOR_TAIL),hi=quantile(s,1-WINSOR_TAIL);return(lo===null||hi===null)?null:[lo,hi];}
const opm=[],qoq=[];for(const e of routedRaw){for(const v of axesFns.quarterOpMargins(e.snapshot))opm.push(v);for(const v of axesFns.quarterQoQRates(e.snapshot))qoq.push(v);}
const ot=wtb(opm);const wb={opMargin:ot?[ot[0],OPMARGIN_CAP]:null,qoq:wtb(qoq)};
const cohorts={};for(const e of routedRaw)(cohorts[e.formulaId+'|'+e.track]||=[]).push(e);
const info={};
for(const[key,entries]of Object.entries(cohorts)){
  const formula=entries[0].formula,track=entries[0].track;
  const profitSign=formula.subCohortByProfit?entries.map(e=>signTrack(norm(e.snapshot,'annualOpInc'))):null;
  const rawByAxis={};for(const ax of formula.axes)rawByAxis[ax.key]=entries.map(e=>rawAxisValue(e.snapshot,ax.key,formula,track,wb));
  const base=[],wcov=[];
  for(let i=0;i<entries.length;i++){const axes=formula.axes.map(ax=>{let c=rawByAxis[ax.key];if(profitSign&&ax.key==='capitalEfficiency')c=c.filter((_,j)=>profitSign[j]===profitSign[i]);return{value:q(rawByAxis[ax.key][i],c),weight:ax.w[track]};});base[i]=weightedScore(axes);wcov[i]=coverageWeight(axes);}
  const med=quantile(base.filter(Number.isFinite),0.5);
  for(let i=0;i<entries.length;i++){const b=base[i],w=wcov[i];const fin=(b!==null&&Number.isFinite(b)&&Number.isFinite(w)&&w!==1&&med!==null)?med+w*(b-med):b;info[entries[i].ticker]={key,base:b,wcov:w,final:fin,med,nAxes:formula.axes.length};}
}
for(const t of['9633.HK','2360.TW','INOD','000660.KS','2308.TW','NVDA','PLTR','CRDO']){const x=info[t];if(x)console.log(`${t.padEnd(12)} ${x.key.padEnd(28)} base=${x.base.toFixed(2)} wcov=${x.wcov.toFixed(3)} final=${x.final.toFixed(2)} med=${x.med.toFixed(1)} axes=${x.nAxes}`);}

// What's the HIGHEST base score among FULL-coverage (wcov==1) names, and what final do they get?
const all=Object.entries(info).map(([t,x])=>({t,...x})).filter(x=>Number.isFinite(x.base));
const full=all.filter(x=>x.wcov===1).sort((a,b)=>b.final-a.final);
console.log('\n=== TOP 10 FULL-COVERAGE (wcov==1, final==base, no shrinkage) ===');
for(const x of full.slice(0,10))console.log(`${x.t.padEnd(12)} ${x.key.padEnd(28)} base=final=${x.final.toFixed(2)}`);
console.log('max full-coverage final:',full[0].final.toFixed(2));

// How many partial names have final > best full name?
const bestFull=full[0].final;
const partialAbove=all.filter(x=>x.wcov<1&&x.final>bestFull).sort((a,b)=>b.final-a.final);
console.log('\npartial names with final > best-full('+bestFull.toFixed(2)+'):',partialAbove.length);
for(const x of partialAbove.slice(0,10))console.log(`  ${x.t.padEnd(12)} ${x.key.padEnd(28)} base=${x.base.toFixed(2)} wcov=${x.wcov.toFixed(3)} final=${x.final.toFixed(2)}`);
