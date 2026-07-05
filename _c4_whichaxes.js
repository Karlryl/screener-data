'use strict';
const fs=require('fs'),path=require('path');
const { norm } = require('./src/scoring/snapshot.js');
const { q } = require('./src/scoring/engine.js');
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

// materials|profitable: which axes are present/dropped across the whole cohort?
const key='materials|profitable';
const entries=cohorts[key];const formula=entries[0].formula,track=entries[0].track;
const rawByAxis={};for(const ax of formula.axes)rawByAxis[ax.key]=entries.map(e=>rawAxisValue(e.snapshot,ax.key,formula,track,wb));
console.log('materials axes(weights):',formula.axes.map(a=>`${a.key}=${a.w[track]}`).join(' '));
console.log('\nPer-axis PRESENT count across '+entries.length+' materials|profitable names:');
for(const ax of formula.axes){
  const present=entries.filter((_,i)=>{const p=q(rawByAxis[ax.key][i],rawByAxis[ax.key]);return p!==null&&Number.isFinite(p);}).length;
  console.log(`  ${ax.key.padEnd(20)} w=${ax.w[track]}  present ${present}/${entries.length} (${(100*present/entries.length).toFixed(0)}%)`);
}
// NGD specifically
const idx=entries.findIndex(e=>e.ticker==='NGD');
console.log('\nNGD axis presence:');
for(const ax of formula.axes){const p=q(rawByAxis[ax.key][idx],rawByAxis[ax.key]);console.log(`  ${ax.key.padEnd(20)} w=${ax.w[track]} ${p===null?'DROP':'pct='+p.toFixed(1)}`);}
