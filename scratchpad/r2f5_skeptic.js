'use strict';
// Independent skeptic reproduction of R2F5: FX-invariance of the 3 guarded axes.
// Calls the REAL axes.js functions (not a re-implementation) on base vs FX-scaled snapshots.
const fs = require('fs');
const path = require('path');
const axes = require('./../src/scoring/axes.js');
const SNAP_DIR = path.join(__dirname, '..', 'snapshots');

// All monetary fields touched by the 3 guarded axes (+ everything else they read),
// per FIELD_REGISTRY. We scale EVERY monetary field a real FX conversion would touch.
// value-format and scalar-format annual + timeseries fields:
const VALUE_ANNUAL  = ['annualRev','annualGP','annualFCF','annualOCF','annualOpInc','annualNetIncome'];
const SCALAR_ANNUAL = ['annualSBC','annualRnD','annualCapex','annualSGA','annualDepreciation'];
const MULTIKEY_ANNUAL = ['annualBalance']; // totalAssets, currentLiabilities, ... all monetary
const VALUE_TS = ['revenueQ','opIncQ','grossProfitQ','netIncomeQ'];

function scaleValueEntry(e, k){
  if (e === null || e === undefined) return e;
  if (typeof e === 'object' && 'value' in e) return { ...e, value: (typeof e.value === 'number') ? e.value * k : e.value };
  return (typeof e === 'number') ? e * k : e;
}
function scaleScalarEntry(e, k){
  if (e === null || e === undefined) return e;
  return (typeof e === 'number') ? e * k : e;
}
function scaleMultikeyEntry(e, k){
  if (e === null || e === undefined || typeof e !== 'object') return e;
  const out = {};
  for (const key of Object.keys(e)) out[key] = (typeof e[key] === 'number') ? e[key] * k : e[key];
  return out;
}

function scaleSnapshot(s, k){
  const c = JSON.parse(JSON.stringify(s));
  if (c.annual){
    for (const f of VALUE_ANNUAL)  if (Array.isArray(c.annual[f])) c.annual[f] = c.annual[f].map(e => scaleValueEntry(e,k));
    for (const f of SCALAR_ANNUAL) if (Array.isArray(c.annual[f])) c.annual[f] = c.annual[f].map(e => scaleScalarEntry(e,k));
    for (const f of MULTIKEY_ANNUAL) if (Array.isArray(c.annual[f])) c.annual[f] = c.annual[f].map(e => scaleMultikeyEntry(e,k));
  }
  if (c.timeseries){
    for (const f of VALUE_TS) if (Array.isArray(c.timeseries[f])) c.timeseries[f] = c.timeseries[f].map(e => scaleValueEntry(e,k));
  }
  return c;
}

const GUARDED = ['gpGrowth','marginTrajectory','dilution'];
const K = 7.5;

function cmp(a, b){
  const aNull = (a === null || a === undefined);
  const bNull = (b === null || b === undefined);
  if (aNull && bNull) return true;
  if (aNull !== bNull) return false;             // null-status flip = mismatch
  return Math.abs(a - b) <= 1e-9 * (1 + Math.abs(a)); // relative fp tolerance
}

let total = 0, parsed = 0;
const mismatch = { gpGrowth: 0, marginTrajectory: 0, dilution: 0 };
const nonNull  = { gpGrowth: 0, marginTrajectory: 0, dilution: 0 };
const samples  = { gpGrowth: [], marginTrajectory: [], dilution: [] };

for (const f of fs.readdirSync(SNAP_DIR)){
  if (!f.endsWith('.json') || f.startsWith('_manifest') || f.startsWith('_')) continue;
  total++;
  let s;
  try { s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); } catch { continue; }
  if (!s || !s.meta || !s.meta.ticker) continue;
  parsed++;
  const sc = scaleSnapshot(s, K);
  for (const ax of GUARDED){
    const base = axes[ax](s);
    const scaled = axes[ax](sc);
    if (base !== null && base !== undefined) nonNull[ax]++;
    if (!cmp(base, scaled)){
      mismatch[ax]++;
      if (samples[ax].length < 8) samples[ax].push(`${s.meta.ticker}: base=${base} scaled=${scaled}`);
    }
  }
}

console.log('snapshot files     :', total);
console.log('parsed w/ ticker   :', parsed);
console.log('FX factor          :', K);
for (const ax of GUARDED){
  console.log(`${ax.padEnd(18)} non-null=${nonNull[ax]}  FX-mismatches=${mismatch[ax]}`, mismatch[ax] ? samples[ax] : '');
}
