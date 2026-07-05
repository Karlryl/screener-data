'use strict';
const fs = require('fs');
const path = require('path');
const REPO = 'C:\\Users\\Anwender\\OneDrive\\Dokumente\\GitHub\\screener-data';
const axes = require(path.join(REPO, 'src', 'scoring', 'axes.js'));

const SNAP_DIR = path.join(REPO, 'snapshots');
const files = fs.readdirSync(SNAP_DIR).filter(f => f.endsWith('.json'));

const VALUE_FIELDS = ['annualRev','annualGP','annualFCF','annualOCF','annualOpInc','annualNetIncome'];
const SCALAR_FIELDS = ['annualSBC','annualRnD','annualCapex','annualSGA','annualDepreciation'];
const TS_VALUE_FIELDS = ['revenueQ','opIncQ','grossProfitQ','netIncomeQ'];
const BAL_KEYS = ['totalCash','totalDebt','totalAssets','accountsReceivable','netPPE','currentAssets','currentLiabilities','totalLiabilities'];

function scaleSnap(s, k){
  const c = JSON.parse(JSON.stringify(s));
  if (c.annual){
    for (const f of VALUE_FIELDS){
      if (Array.isArray(c.annual[f])) c.annual[f] = c.annual[f].map(e => (e && typeof e==='object' && typeof e.value==='number') ? {...e, value: e.value*k} : (typeof e==='number'? e*k : e));
    }
    for (const f of SCALAR_FIELDS){
      if (Array.isArray(c.annual[f])) c.annual[f] = c.annual[f].map(e => (typeof e==='number') ? e*k : e);
    }
    if (Array.isArray(c.annual.annualBalance)){
      c.annual.annualBalance = c.annual.annualBalance.map(e => {
        if (!e || typeof e!=='object') return e;
        const o = {...e};
        for (const bk of BAL_KEYS){ if (typeof o[bk]==='number') o[bk]=o[bk]*k; }
        return o;
      });
    }
  }
  if (c.timeseries){
    for (const f of TS_VALUE_FIELDS){
      if (Array.isArray(c.timeseries[f])) c.timeseries[f] = c.timeseries[f].map(e => (e && typeof e==='object' && typeof e.value==='number') ? {...e, value:e.value*k} : (typeof e==='number'? e*k : e));
    }
  }
  return c;
}

function eqNum(a,b){
  if (a===null||a===undefined) return b===null||b===undefined;
  if (b===null||b===undefined) return false;
  if (!Number.isFinite(a)||!Number.isFinite(b)) return a===b || (Number.isNaN(a)&&Number.isNaN(b));
  const denom = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a-b)/denom < 1e-9;
}

const AXES = ['gpGrowth','marginTrajectory','dilution'];
const factors = [7.5, 0.3137, 1000];

for (const k of factors){
  const mism = {gpGrowth:0, marginTrajectory:0, dilution:0};
  const examples = {gpGrowth:[], marginTrajectory:[], dilution:[]};
  let checked = 0;
  for (const f of files){
    let s;
    try { s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR,f),'utf8')); } catch(e){ continue; }
    const sc = scaleSnap(s, k);
    checked++;
    for (const ax of AXES){
      const a = axes[ax](s);
      const b = axes[ax](sc);
      if (!eqNum(a,b)){
        mism[ax]++;
        if (examples[ax].length<5) examples[ax].push({ticker:f.replace('.json',''), base:a, scaled:b});
      }
    }
  }
  console.log(`=== factor ${k} === checked ${checked}`);
  for (const ax of AXES){
    console.log(`  ${ax}: ${mism[ax]} mismatches`);
    if (examples[ax].length) console.log('     ex:', JSON.stringify(examples[ax]));
  }
}
