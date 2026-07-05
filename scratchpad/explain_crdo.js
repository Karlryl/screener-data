// Erklaert CRDOs Score: 8-Achsen-Aufschluesselung (Rohwert, Kohorten-Perzentil, Gewicht, Beitrag).
const REPO = 'C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data';
const { loadUniverse } = require(REPO + '/src/scoring/run-screener.js');
const { rawAxisValue } = require(REPO + '/src/scoring/score.js');
const { q } = require(REPO + '/src/scoring/engine.js');
const { route } = require(REPO + '/src/scoring/router.js');
const ax = require(REPO + '/src/scoring/axes.js');
const formulas = require(REPO + '/src/scoring/formulas/index.js');

const u = loadUniverse();
// route + track je Name (nur was CRDOs Kohorte betrifft)
const { scoreUniverse } = require(REPO + '/src/scoring/score.js');
const results = scoreUniverse(u, formulas);
const crdoE = results.find(e => e.ticker === 'CRDO');
console.log('CRDO:', crdoE.action, crdoE.formulaId, crdoE.track, 'FINAL score=', crdoE.score);

// Kohorte = semiconductors|profitable
const cohort = results.filter(e => e.action === 'route' && e.formulaId === 'semiconductors' && e.track === 'profitable');
const byT = {}; for (const s of u) byT[s.meta.ticker] = s;
const formula = formulas.semiconductors;

// Winsor-Schranken universe-weit (wie score.js): opMargin=[p1,1.0], qoq=[p1,p99]
const opm = [], qoq = [];
for (const e of results) { if (e.action !== 'route') continue; for (const v of ax.quarterOpMargins(byT[e.ticker])) opm.push(v); for (const v of ax.quarterQoQRates(byT[e.ticker])) qoq.push(v); }
const quant = (a, p) => { const x = a.filter(Number.isFinite).sort((m, n) => m - n); const i = (x.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return lo === hi ? x[lo] : x[lo] + (x[hi] - x[lo]) * (i - lo); };
const winsorBounds = { opMargin: [quant(opm, 0.01), 1.0], qoq: [quant(qoq, 0.01), quant(qoq, 0.99)] };

// pro Achse: CRDO-Rohwert, Kohorten-Perzentil, Gewicht
const names = { revGrowthLevel: 'Umsatzwachstum (Niveau)', revAcceleration: 'Umsatz-Beschleunigung', gpGrowth: 'Bruttogewinn-Wachstum', ruleOfX: 'Rule-of-X (Wachstum+FCF)', marginTrajectory: 'Margen-Trend', capitalEfficiency: 'Kapitaleffizienz (ROIC)', revisionsMomentum: 'Analysten-Revisionen', dilution: 'Verwaesserung (SBC)' };
console.log('\n=== CRDO 8-Achsen (Kohorte: ' + cohort.length + ' profitable Halbleiter) ===');
let wsum = 0, vsum = 0;
const rows = [];
for (const a of formula.axes) {
  const raw = rawAxisValue(byT['CRDO'], a.key, formula, 'profitable', winsorBounds);
  const cohortRaw = cohort.map(e => rawAxisValue(byT[e.ticker], a.key, formula, 'profitable', winsorBounds));
  const pct = q(raw, cohortRaw);
  const w = a.w.profitable;
  rows.push({ key: a.key, name: names[a.key] || a.key, raw, pct, w });
  if (pct !== null && w > 0) { wsum += w; vsum += w * pct; }
}
rows.sort((x, y) => (y.pct ?? -1) - (x.pct ?? -1));
for (const r of rows) {
  const pctStr = r.pct === null ? 'DROP (keine Daten)' : Math.round(r.pct) + '. Perzentil';
  const bar = r.pct === null ? '' : '█'.repeat(Math.round(r.pct / 5));
  console.log((r.name).padEnd(30), 'w=' + r.w, (pctStr).padEnd(20), bar);
}
console.log('\n-> gewichteter Schnitt (=Basis-Score) =', Math.round(vsum / wsum * 100) / 100);
// Rang in Kohorte
const sorted = [...cohort].sort((a, b) => b.score - a.score);
console.log('-> Rang in Kohorte:', (sorted.findIndex(e => e.ticker === 'CRDO') + 1) + '/' + cohort.length, '(Top ' + Math.round((sorted.findIndex(e => e.ticker === 'CRDO') + 1) / cohort.length * 100) + '%)');
// Was fuehrt die Kohorte an?
console.log('-> Top-3 der Kohorte:', sorted.slice(0, 3).map(e => e.ticker + ':' + e.score).join(', '));
