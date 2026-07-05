'use strict';
const fs = require('fs');
const path = require('path');
const axes = require('./../src/scoring/axes.js');
const SNAP_DIR = path.join(__dirname, '..', 'snapshots');
const VALUE_ANNUAL=['annualRev','annualGP','annualFCF','annualOCF','annualOpInc','annualNetIncome'];
const SCALAR_ANNUAL=['annualSBC','annualRnD','annualCapex','annualSGA','annualDepreciation'];
const MULTIKEY_ANNUAL=['annualBalance'];
const VALUE_TS=['revenueQ','opIncQ','grossProfitQ','netIncomeQ'];
const sv=(e,k)=>e==null?e:(typeof e==='object'&&'value'in e)?{...e,value:typeof e.value==='number'?e.value*k:e.value}:(typeof e==='number'?e*k:e);
const ss=(e,k)=>e==null?e:(typeof e==='number'?e*k:e);
const sm=(e,k)=>{if(e==null||typeof e!=='object')return e;const o={};for(const key of Object.keys(e))o[key]=typeof e[key]==='number'?e[key]*k:e[key];return o;};
function scale(s,k){const c=JSON.parse(JSON.stringify(s));if(c.annual){for(const f of VALUE_ANNUAL)if(Array.isArray(c.annual[f]))c.annual[f]=c.annual[f].map(e=>sv(e,k));for(const f of SCALAR_ANNUAL)if(Array.isArray(c.annual[f]))c.annual[f]=c.annual[f].map(e=>ss(e,k));for(const f of MULTIKEY_ANNUAL)if(Array.isArray(c.annual[f]))c.annual[f]=c.annual[f].map(e=>sm(e,k));}if(c.timeseries){for(const f of VALUE_TS)if(Array.isArray(c.timeseries[f]))c.timeseries[f]=c.timeseries[f].map(e=>sv(e,k));}return c;}
const cmp=(a,b)=>{const an=a==null,bn=b==null;if(an&&bn)return true;if(an!==bn)return false;return Math.abs(a-b)<=1e-9*(1+Math.abs(a));};
const GUARDED=['gpGrowth','marginTrajectory','dilution'];
const FACTORS=[7.5, 0.0136, 1300.0, 83.2, 1e-6, 1e6]; // EURUSD-ish, JPY, INR, micro, mega
const files=fs.readdirSync(SNAP_DIR).filter(f=>f.endsWith('.json')&&!f.startsWith('_'));
for(const k of FACTORS){
  const mm={gpGrowth:0,marginTrajectory:0,dilution:0};
  for(const f of files){let s;try{s=JSON.parse(fs.readFileSync(path.join(SNAP_DIR,f),'utf8'));}catch{continue;}if(!s||!s.meta||!s.meta.ticker)continue;const sc=scale(s,k);for(const ax of GUARDED){if(!cmp(axes[ax](s),axes[ax](sc)))mm[ax]++;}}
  console.log(`k=${k}  gpGrowth=${mm.gpGrowth} marginTrajectory=${mm.marginTrajectory} dilution=${mm.dilution}`);
}
