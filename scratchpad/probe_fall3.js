// Probe Fall 3: capEff-Drop-Verhalten + Anker-curLiab + overview-Dichte.
const REPO = 'C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data';
const { loadUniverse } = require(REPO + '/src/scoring/run-screener.js');
const { scoreUniverse, produceRankings } = require(REPO + '/src/scoring/score.js');
const { norm } = require(REPO + '/src/scoring/snapshot.js');
const ax = require(REPO + '/src/scoring/axes.js');
const formulas = require(REPO + '/src/scoring/formulas/index.js');
const u = loadUniverse();
const byT = {}; for (const s of u) byT[s.meta.ticker] = s;

// 1) Anker: hat jeder present curLiab? capEff null oder Wert?
console.log('=== Anker capEff-Achse (null=gedroppt -> Gefahr renorm-Inflation) ===');
for (const t of ['PLTR', 'CRDO', 'ALAB', 'BE', '2383.TW', '2308.TW', 'WTC.AX']) {
  const s = byT[t]; if (!s) { console.log(t, 'fehlt'); continue; }
  const cl = norm(s, 'annualBalance', 'currentLiabilities');
  const hasCl = Array.isArray(cl) && cl.some((v) => v !== null && v !== undefined && Number.isFinite(v));
  console.log(t.padEnd(9), 'capEff=' + JSON.stringify(ax.capitalEfficiency(s)), 'hasPresentCurLiab=' + hasCl, 'curLiab=' + JSON.stringify(cl));
}

// 2) Wie viele route-Namen droppen capEff jetzt (null)?
let routeN = 0, capNull = 0;
for (const s of u) {
  const cap = ax.capitalEfficiency(s);
  // grobe route-Annaeherung: hat annualOpInc+assets
  routeN++;
  if (cap === null) capNull++;
}
console.log('\n=== capEff===null ueber ALLE', routeN, 'Namen:', capNull, '(', (100 * capNull / routeN).toFixed(1) + '%) ===');

// 3) overview-Dichte um PLTR (warum Rang 63->137 bei nur -1.5 Score)
const results = scoreUniverse(u, formulas);
const ov = produceRankings(results, { topN: 100 }).overview;
const pi = ov.findIndex((e) => e.ticker === 'PLTR');
console.log('\n=== overview um PLTR (Rang', pi + 1, 'von', ov.length, ') ===');
if (pi >= 0) {
  const around = ov.slice(Math.max(0, pi - 3), pi + 4).map((e) => e.ticker + ':' + Math.round(e.score * 10) / 10);
  console.log(around.join('  '));
  // wie viele Namen liegen innerhalb 2 Punkten von PLTR?
  const ps = ov[pi].score;
  const near = ov.filter((e) => Math.abs(e.score - ps) <= 2).length;
  console.log('Namen innerhalb +-2 Score-Punkte von PLTR(' + Math.round(ps * 10) / 10 + '):', near, '-> dichte Verteilung erklaert grossen Rangsprung bei kleinem Score-Delta');
}
