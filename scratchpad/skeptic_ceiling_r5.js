'use strict';
// Adversariale Verifikation (Skeptiker) des Befunds methodology-fdr:
// "score>=90 wird NICHT zu aggressiv unterdrueckt — die >=90-Bande ist fuer 8/8-Namen
//  architektur-bedingt (nicht C4-bedingt) kaum erreichbar."
// score.js loescht e.snapshot am Ende -> base/wcov aus FRISCHEN Snapshots (per Ticker)
// rekonstruieren. FINAL+track+formulaId aus den scoreUniverse-Results.
const fs = require('fs');
const path = require('path');
const REPO = 'C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data';
const { scoreUniverse, rawAxisValue } = require(path.join(REPO, 'src/scoring/score.js'));
const { q, weightedScore, coverageWeight, signTrack } = require(path.join(REPO, 'src/scoring/engine.js'));
const axesFns = require(path.join(REPO, 'src/scoring/axes.js'));
const formulas = require(path.join(REPO, 'src/scoring/formulas/index.js'));
const { norm } = require(path.join(REPO, 'src/scoring/snapshot.js'));
const SNAP_DIR = path.join(REPO, 'snapshots');

const WINSOR_TAIL = 0.01;
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

function loadSnaps() {
  const out = [];
  for (const f of fs.readdirSync(SNAP_DIR)) {
    if (!f.endsWith('.json')) continue;
    if (f.startsWith('_manifest') || f === '_last_good_disk.json') continue;
    try { const s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); if (s && s.meta && s.meta.ticker) out.push(s); } catch (_) {}
  }
  return out;
}
const tickerOf = (s) => s && s.meta && s.meta.ticker;

// 1. scoreUniverse fuer FINAL-Scores (mutiert/loescht eigene Snapshot-Kopien)
const results = scoreUniverse(loadSnaps(), formulas);
const route = results.filter((e) => e.action === 'route');
console.log('route:', route.length, ' survival:', results.filter((e) => e.action === 'survival').length,
  ' data-suspect:', results.filter((e) => e.reason === 'data-suspect').length);
const f90real = route.filter((e) => Number.isFinite(e.score) && e.score >= 90);
console.log('FINAL score>=90:', f90real.length, f90real.map((e) => `${e.ticker}(${e.score.toFixed(2)})`).join(', '));

// 2. FRISCHE Snapshots per Ticker fuer die Achsen-Rekonstruktion
const fresh = new Map();
for (const s of loadSnaps()) fresh.set(tickerOf(s), s);

// winsor exakt: ueber alle route-Snapshots (frisch)
const opmSamples = [], qoqSamples = [];
for (const e of route) { const s = fresh.get(e.ticker); if (!s) continue;
  for (const v of axesFns.quarterOpMargins(s)) opmSamples.push(v);
  for (const v of axesFns.quarterQoQRates(s)) qoqSamples.push(v);
}
const winsorBounds = { opMargin: winsorTailBounds(opmSamples), qoq: winsorTailBounds(qoqSamples) };

// Kohorten aus route-Results (formulaId|track)
const cohorts = {};
for (const e of route) (cohorts[e.formulaId + '|' + e.track] ||= []).push(e);

const rec = [];
for (const key of Object.keys(cohorts)) {
  const entries = cohorts[key];
  const formula = formulas[entries[0].formulaId];
  const track = entries[0].track;
  const snapOf = (e) => fresh.get(e.ticker);
  const profitSign = formula.subCohortByProfit
    ? entries.map((e) => signTrack(norm(snapOf(e), 'annualOpInc')))
    : null;
  const rawByAxis = {};
  for (const ax of formula.axes) {
    rawByAxis[ax.key] = entries.map((e) => rawAxisValue(snapOf(e), ax.key, formula, track, winsorBounds));
  }
  const baseArr = new Array(entries.length), wcovArr = new Array(entries.length);
  for (let i = 0; i < entries.length; i++) {
    const axes = formula.axes.map((ax) => {
      let cohort = rawByAxis[ax.key];
      if (profitSign && ax.key === 'capitalEfficiency') cohort = cohort.filter((_, j) => profitSign[j] === profitSign[i]);
      return { value: q(rawByAxis[ax.key][i], cohort), weight: ax.w[track] };
    });
    baseArr[i] = weightedScore(axes);
    wcovArr[i] = coverageWeight(axes);
  }
  const cohMedian = quantile(baseArr.filter(Number.isFinite), 0.5);
  for (let i = 0; i < entries.length; i++) {
    rec.push({ ticker: entries[i].ticker, formulaId: entries[i].formulaId, track, base: baseArr[i], wcov: wcovArr[i], cohMedian, final: entries[i].score });
  }
}

// SELBSTTEST: rekonstruierter FINAL muss realen score treffen (== exakte Reproduktion)
let mism = 0, maxdiff = 0, ncmp = 0;
for (const r of rec) {
  if (!Number.isFinite(r.base) || !Number.isFinite(r.wcov) || !Number.isFinite(r.cohMedian)) continue;
  const reFinal = (r.wcov === 1) ? r.base : (r.cohMedian + r.wcov * (r.base - r.cohMedian));
  if (Number.isFinite(r.final)) { ncmp++; const d = Math.abs(reFinal - r.final); if (d > maxdiff) maxdiff = d; if (d > 1e-6) mism++; }
}
console.log(`\nSELBSTTEST (rekon vs real final): verglichen=${ncmp} mismatches(>1e-6)=${mism} maxdiff=${maxdiff.toExponential(2)}`);

// wcov-Verteilung
const wAll = rec.filter((r) => Number.isFinite(r.wcov)).map((r) => r.wcov);
console.log(`\nwcov: finite=${wAll.length} exact===1:${rec.filter((r) => r.wcov === 1).length} <1:${rec.filter((r) => Number.isFinite(r.wcov) && r.wcov !== 1).length} max=${Math.max(...wAll).toFixed(6)} min=${Math.min(...wAll).toFixed(6)}`);
console.log('  top distinct wcov:', [...new Set(wAll)].sort((a, b) => b - a).slice(0, 6).map((x) => x.toFixed(8)).join(', '));

// ===== CLAIM 1: kein wcov===1 Name erreicht base>=90; Max base unter wcov===1 =====
const full = rec.filter((r) => Number.isFinite(r.base) && r.wcov === 1);
console.log(`\n== wcov===1 (Exact-Skip score.js:268): ${full.length} Namen ==`);
if (full.length) {
  const fb = full.map((r) => r.base).sort((a, b) => b - a);
  console.log('  Top base unter wcov===1:', full.slice().sort((a, b) => b.base - a.base).slice(0, 3).map((r) => `${r.ticker}=${r.base.toFixed(2)}`).join(', '));
  console.log('  full base p99=', (quantile(fb, 0.99) || 0).toFixed(2), ' p95=', (quantile(fb, 0.95) || 0).toFixed(2), ' max=', fb[0].toFixed(2));
  console.log('  wcov===1 mit base>=90:', full.filter((r) => r.base >= 90).length);
}

// ===== CLAIM 2: alle base>=90 Namen sind wcov<1, hoechstes wcov=0.870 (MU) =====
const base90 = rec.filter((r) => Number.isFinite(r.base) && r.base >= 90).sort((a, b) => b.wcov - a.wcov);
console.log(`\n== base>=90: ${base90.length} Namen ==`);
console.log('  wcov===1:', base90.filter((r) => r.wcov === 1).length, ' wcov<1:', base90.filter((r) => r.wcov !== 1).length);
console.log('  hoechstes wcov:', base90.length ? `${base90[0].ticker}=${base90[0].wcov.toFixed(3)} (base=${base90[0].base.toFixed(2)}, final=${base90[0].final == null ? 'null' : base90[0].final.toFixed(2)})` : 'n/a');
console.log('  Liste (sortiert wcov desc):');
for (const r of base90) console.log(`    ${r.ticker.padEnd(10)} base=${r.base.toFixed(2)} wcov=${r.wcov.toFixed(3)} final=${r.final == null ? 'null' : r.final.toFixed(2)} cohMed=${r.cohMedian == null ? 'n/a' : r.cohMedian.toFixed(1)}`);

// ===== CLAIM 3: nach Shrinkage erreicht nur 9633.HK 91.5 =====
const final90 = rec.filter((r) => Number.isFinite(r.final) && r.final >= 90).sort((a, b) => b.final - a.final);
console.log(`\n== FINAL>=90 (nach C4): ${final90.length} ==`);
for (const r of final90) console.log(`    ${r.ticker.padEnd(10)} final=${r.final.toFixed(2)} base=${r.base == null ? 'n/a' : r.base.toFixed(2)} wcov=${r.wcov == null ? 'n/a' : r.wcov.toFixed(3)} cohMed=${r.cohMedian == null ? 'n/a' : r.cohMedian.toFixed(2)}`);

// ===== Anker byte-identisch (wcov===1 Exact-Skip)? =====
const ANCHORS = ['PLTR', 'CRDO', 'ALAB', 'BE', '2383.TW', '2308.TW', 'WTC.AX'];
console.log('\n== Anker ==');
for (const a of ANCHORS) {
  const r = rec.find((x) => x.ticker === a);
  if (r) console.log(`  ${a.padEnd(9)} base=${r.base == null ? 'n/a' : r.base.toFixed(2)} final=${r.final == null ? 'null' : r.final.toFixed(2)} wcov=${r.wcov == null ? 'n/a' : r.wcov.toFixed(6)} ${r.wcov === 1 ? '[EXACT skip]' : '[shrink]'}`);
  else { const e = results.find((x) => x.ticker === a); console.log(`  ${a.padEnd(9)} (nicht route: ${e ? e.action + '/' + (e.reason || '') : 'fehlt'})`); }
}

// ===== Counterfactual: Top base-Scores GESAMT =====
console.log('\n== Top 12 base-Scores GESAMT (mit wcov) ==');
for (const r of rec.filter((x) => Number.isFinite(x.base)).sort((a, b) => b.base - a.base).slice(0, 12)) {
  console.log(`    ${r.ticker.padEnd(10)} base=${r.base.toFixed(2)} wcov=${r.wcov.toFixed(3)} final=${r.final == null ? 'null' : r.final.toFixed(2)}`);
}

// ===== Mismatch-Diagnose =====
console.log('\n== SELBSTTEST-Mismatches (>1e-6) ==');
for (const r of rec) {
  if (!Number.isFinite(r.base) || !Number.isFinite(r.wcov) || !Number.isFinite(r.cohMedian) || !Number.isFinite(r.final)) continue;
  const reFinal = (r.wcov === 1) ? r.base : (r.cohMedian + r.wcov * (r.base - r.cohMedian));
  const d = Math.abs(reFinal - r.final);
  if (d > 1e-6) console.log(`    ${r.ticker.padEnd(10)} reFinal=${reFinal.toFixed(4)} real=${r.final.toFixed(4)} diff=${d.toFixed(4)} base=${r.base.toFixed(3)} wcov=${r.wcov.toFixed(4)} fId=${r.formulaId} track=${r.track}`);
}
