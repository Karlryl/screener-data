'use strict';
const fs=require('fs'),path=require('path');
const { norm, metricVal, firstPresent, presentValues } = require('./src/scoring/snapshot.js');
const { q, weightedScore, coverageWeight, signTrack } = require('./src/scoring/engine.js');
const { route } = require('./src/scoring/router.js');
const axesFns = require('./src/scoring/axes.js');
const formulas = require('./src/scoring/formulas/index.js');
const { rawAxisValue, trackOf } = require('./src/scoring/score.js');
const SNAP_DIR = path.join(__dirname,'snapshots');
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

// Inspect consumer-staples|profitable cohort, axis by axis, for 9633.HK
const key='consumer-staples|profitable';
const entries=cohorts[key];
const formula=entries[0].formula,track=entries[0].track;
console.log('formula:',formula.id,' axes:',formula.axes.map(a=>a.key+'(w='+a.w[track]+')').join(', '));
const rawByAxis={};for(const ax of formula.axes)rawByAxis[ax.key]=entries.map(e=>rawAxisValue(e.snapshot,ax.key,formula,track,wb));
const idx=entries.findIndex(e=>e.ticker==='9633.HK');
console.log('\n9633.HK axis breakdown:');
let wsum=0,vsum=0,totalW=0;
for(const ax of formula.axes){
  const raw=rawByAxis[ax.key][idx];
  const pct=q(raw,rawByAxis[ax.key]);
  totalW+=ax.w[track];
  const present=(pct!==null&&Number.isFinite(pct));
  if(present){wsum+=ax.w[track];vsum+=ax.w[track]*pct;}
  console.log(`  ${ax.key.padEnd(20)} w=${ax.w[track]} raw=${raw===null?'null':raw.toFixed(3)} pct=${pct===null?'DROP':pct.toFixed(1)}`);
}
console.log(`base=${(vsum/wsum).toFixed(2)} wcov=${(wsum/totalW).toFixed(3)}`);

// Now the counterfactual: what would 9633's score be if the missing axis were present at cohort-MEDIAN(50)?
// The renorm-on-drop gives it the average of its PRESENT axes; a present-median-axis would pull it toward 50.
console.log('\nCounterfactual: which axis dropped? and what does its absence do to the base?');
