// Anker-Inspektor — vor/nach jedem Scoring-Fix laufen lassen.
// Nutzung: node scratchpad/anchor_inspect.js PLTR CRDO ALAB BE 2383.TW 2308.TW WTC.AX
const REPO = 'C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data';
const { loadUniverse } = require(REPO + '/src/scoring/run-screener.js');
const { scoreUniverse, produceRankings } = require(REPO + '/src/scoring/score.js');
const formulas = require(REPO + '/src/scoring/formulas/index.js');
const u = loadUniverse();
const results = scoreUniverse(u, formulas);
const ov = produceRankings(results, { topN: 100 }).overview;
const ovR = {}; ov.forEach((r, i) => ovR[r.ticker] = i + 1);
const bt = {}; for (const e of results) bt[e.ticker] = e;
const cN = {};
for (const e of results) if (e.action === 'route' && e.score != null) { const k = e.formulaId + '|' + e.track; cN[k] = (cN[k] || 0) + 1; }
for (const t of process.argv.slice(2)) {
  const e = bt[t];
  if (!e) { console.log(t, 'NICHT GEFUNDEN'); continue; }
  console.log(t.padEnd(10), 'act=' + e.action, e.formulaId || '', e.track || '', 'score=' + (e.score == null ? null : Math.round(e.score * 100) / 100),
    e.reason || '', (e.action === 'route' && e.score != null) ? 'cohortN=' + cN[e.formulaId + '|' + e.track] : '', ovR[t] ? 'ovRank=' + ovR[t] + '/' + ov.length : '');
}
const c = {}; for (const e of results) c[e.action] = (c[e.action] || 0) + 1;
const ex = {}; for (const e of results) if (e.action === 'exclude') ex[e.reason || '?'] = (ex[e.reason || '?'] || 0) + 1;
const survival = produceRankings(results, { topN: 100 }).survival;
console.log('--- BILANZ ---', JSON.stringify(c), '| survival=' + survival.length, '| excl=', JSON.stringify(ex));
