'use strict';
const fs = require('fs');
const path = require('path');
const { norm, metricVal, firstPresent, presentValues } = require('./src/scoring/snapshot.js');
const { q, weightedScore, coverageWeight, signTrack, fcfTrack } = require('./src/scoring/engine.js');
const { route, isUS } = require('./src/scoring/router.js');
const { evaluateLamps } = require('./src/scoring/lamps.js');
const axesFns = require('./src/scoring/axes.js');
const formulas = require('./src/scoring/formulas/index.js');
const { scoreUniverse } = require('./src/scoring/score.js');

const SNAP_DIR = path.join(__dirname, 'snapshots');
function loadUniverse() {
  const u = [];
  for (const f of fs.readdirSync(SNAP_DIR)) {
    if (!f.endsWith('.json')) continue;
    if (f.startsWith('_manifest') || f === '_last_good_disk.json') continue;
    let s; try { s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); } catch(_) { continue; }
    if (s && s.meta && s.meta.ticker) u.push(s);
  }
  return u;
}

const universe = loadUniverse();
console.log('universe:', universe.length);

// Replicate the internal scoring to capture BASE score, wcov, and FINAL score per cohort.
const { route: rt } = require('./src/scoring/router.js');
const tickerOf = (s) => (s && s.meta && s.meta.ticker) || '?';

// Build routed entries
const results = [];
for (const s of universe) {
  const r = route(s);
  const lampsActive = evaluateLamps(s).active;
  results.push({ ticker: tickerOf(s), snapshot: s, action: r.action, formulaId: r.formulaId, r, lamps: lampsActive });
}

// Use the real scoreUniverse but instrument via re-derivation.
// Simpler: reproduce cohort loop with base/wcov/final.
// We reuse rawAxisValue logic from score.js by requiring it.
const { rawAxisValue } = require('./src/scoring/score.js');

// Recompute winsor bounds like score.js
const WINSOR_TAIL = 0.01, OPMARGIN_CAP = 1.0;
function quantile(samples, p) {
  const a = samples.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  const idx = (a.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (idx - lo);
}
function winsorTailBounds(samples) {
  const lo = quantile(samples, WINSOR_TAIL), hi = quantile(samples, 1 - WINSOR_TAIL);
  return (lo === null || hi === null) ? null : [lo, hi];
}

// Only real routed names (approximate — ignoring data-suspect/dedup gating for the aggregate stats;
// we'll separately use scoreUniverse for exact final scores).
const routed = results.filter(e => e.action === 'route' && formulas[e.formulaId]);
for (const e of routed) { e.formula = formulas[e.formulaId]; e.track = require('./src/scoring/score.js').trackOf(e.snapshot, e.formula); }

const opmSamples = [], qoqSamples = [];
for (const e of routed) {
  for (const v of axesFns.quarterOpMargins(e.snapshot)) opmSamples.push(v);
  for (const v of axesFns.quarterQoQRates(e.snapshot)) qoqSamples.push(v);
}
const opmTail = winsorTailBounds(opmSamples);
const winsorBounds = { opMargin: opmTail ? [opmTail[0], OPMARGIN_CAP] : null, qoq: winsorTailBounds(qoqSamples) };

const cohorts = {};
for (const e of routed) (cohorts[e.formulaId + '|' + e.track] ||= []).push(e);

const cohortStats = [];
for (const [key, entries] of Object.entries(cohorts)) {
  const formula = entries[0].formula, track = entries[0].track;
  const profitSign = formula.subCohortByProfit ? entries.map(e => signTrack(norm(e.snapshot,'annualOpInc'))) : null;
  const rawByAxis = {};
  for (const ax of formula.axes) rawByAxis[ax.key] = entries.map(e => rawAxisValue(e.snapshot, ax.key, formula, track, winsorBounds));
  const base = new Array(entries.length), wcov = new Array(entries.length);
  for (let i=0;i<entries.length;i++){
    const axes = formula.axes.map(ax => {
      let cohort = rawByAxis[ax.key];
      if (profitSign && ax.key==='capitalEfficiency') cohort = cohort.filter((_,j)=>profitSign[j]===profitSign[i]);
      return { value: q(rawByAxis[ax.key][i], cohort), weight: ax.w[track] };
    });
    base[i] = weightedScore(axes);
    wcov[i] = coverageWeight(axes);
  }
  const cohMedian = quantile(base.filter(Number.isFinite), 0.5);
  const final = base.map((b,i)=> (b!==null&&Number.isFinite(b)&&Number.isFinite(wcov[i])&&wcov[i]!==1&&cohMedian!==null) ? cohMedian + wcov[i]*(b-cohMedian) : b);
  // wcov distribution
  const wcovVals = wcov.filter(Number.isFinite);
  const nFull = wcovVals.filter(w=>w===1).length;
  const nPartial = wcovVals.filter(w=>w<1).length;
  cohortStats.push({ key, n: entries.length, nScored: base.filter(Number.isFinite).length, cohMedian, nFull, nPartial,
    wcovMin: wcovVals.length?Math.min(...wcovVals):null, entries, base, wcov, final, formula, track });
}

cohortStats.sort((a,b)=>b.n-a.n);
console.log('\n=== COHORTS (formulaId|track): n, scored, nFull(8/8), nPartial, cohMedian, wcovMin ===');
for (const c of cohortStats) {
  console.log(`${c.key.padEnd(28)} n=${String(c.n).padStart(4)} scored=${String(c.nScored).padStart(4)} full=${String(c.nFull).padStart(4)} partial=${String(c.nPartial).padStart(4)} med=${c.cohMedian!==null?c.cohMedian.toFixed(1):'--'} wcovMin=${c.wcovMin!==null?c.wcovMin.toFixed(3):'--'}`);
}
console.log('\ntotal cohorts:', cohortStats.length);

// === Methodology deep-dive ===
console.log('\n\n=== SHRINKAGE EFFECT ANALYSIS ===');

// Q1: Does shrinkage introduce mid-field compression? Check delta = final-base by base-percentile bucket.
// Q2: Top-of-cohort: are partial-coverage names still able to reach high scores? Can a 8/8 name reach >=90?
let anyPartialAbove90 = 0, anyFullAbove90 = 0;
let allBaseFinal = [];
for (const c of cohortStats) {
  for (let i=0;i<c.entries.length;i++){
    if (!Number.isFinite(c.base[i])) continue;
    allBaseFinal.push({key:c.key, ticker:c.entries[i].ticker, base:c.base[i], final:c.final[i], wcov:c.wcov[i], med:c.cohMedian});
    if (c.final[i]>=90) { if (c.wcov[i]===1) anyFullAbove90++; else anyPartialAbove90++; }
  }
}
console.log('names with FINAL >=90: full(8/8)=', anyFullAbove90, ' partial=', anyPartialAbove90);

// Distribution of |delta| for partial names
const partial = allBaseFinal.filter(x=>x.wcov<1);
const deltas = partial.map(x=>x.final-x.base);
const absMean = deltas.reduce((a,b)=>a+Math.abs(b),0)/deltas.length;
console.log('partial names:', partial.length, ' mean|delta|=', absMean.toFixed(2), ' max|delta|=', Math.max(...deltas.map(Math.abs)).toFixed(1));

// Q: mid-field compression — how many DISTINCT names collapse toward median? measure how top-quartile base names get pulled DOWN
// Bucket by base decile, report mean delta (signed)
function bucketStats(arr) {
  const s = arr.slice().sort((a,b)=>a.base-b.base);
  const buckets = 10;
  for (let b=0;b<buckets;b++){
    const lo=Math.floor(b/buckets*s.length), hi=Math.floor((b+1)/buckets*s.length);
    const seg = s.slice(lo,hi);
    if(!seg.length) continue;
    const md = seg.reduce((a,x)=>a+(x.final-x.base),0)/seg.length;
    const mb = seg.reduce((a,x)=>a+x.base,0)/seg.length;
    console.log(`  base-decile ${b}: baseMean=${mb.toFixed(1)} meanDelta=${md>=0?'+':''}${md.toFixed(2)}`);
  }
}
console.log('\nSigned delta by base-score decile (ALL names, incl full where delta=0):');
bucketStats(allBaseFinal);

// Q: does shrinkage help or hurt RANK of full-coverage names at the top? 
// Compare a full-coverage name at base=80 vs a partial name at base=95 with wcov=0.5, median=50.
console.log('\n=== RANK-FLIP demonstration (partial high-base pulled below full name) ===');
// Count within each cohort: how many rank inversions between base-order and final-order
let totalInversionsHelpingFull = 0;
for (const c of cohortStats) {
  const idx = c.entries.map((_,i)=>i).filter(i=>Number.isFinite(c.base[i]));
  // pairs where base order and final order differ
  for (let a=0;a<idx.length;a++) for (let b=a+1;b<idx.length;b++){
    const i=idx[a], j=idx[b];
    const baseDiff = c.base[i]-c.base[j];
    const finDiff = c.final[i]-c.final[j];
    if (Math.sign(baseDiff)!==Math.sign(finDiff) && baseDiff!==0 && finDiff!==0) {
      // an inversion happened
    }
  }
}
