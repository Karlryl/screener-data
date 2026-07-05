// Prueft: bestraft der Screener gerade-profitable / noch-nicht-profitable Firmen?
const REPO = 'C:/Users/Anwender/OneDrive/Dokumente/GitHub/screener-data';
const { loadUniverse } = require(REPO + '/src/scoring/run-screener.js');
const { scoreUniverse, rawAxisValue } = require(REPO + '/src/scoring/score.js');
const { q } = require(REPO + '/src/scoring/engine.js');
const { norm, presentValues } = require(REPO + '/src/scoring/snapshot.js');
const ax = require(REPO + '/src/scoring/axes.js');
const formulas = require(REPO + '/src/scoring/formulas/index.js');
const u = loadUniverse();
const byT = {}; for (const s of u) byT[s.meta.ticker] = s;
const results = scoreUniverse(u, formulas);

// 1) TRACK-Split: wie viele profitable vs unprofitable je Sektor
const cnt = {};
for (const e of results) if (e.action === 'route') { const k = e.formulaId + '|' + e.track; cnt[k] = (cnt[k] || 0) + 1; }

// 2) "Gerade profitabel" = neuestes annualOpInc>0 ABER mind. ein aelteres Jahr <0 (Turnaround/Inflection)
function justProfitable(s) {
  const oi = presentValues(norm(s, 'annualOpInc'));
  if (oi.length < 2) return false;
  return oi[0] > 0 && oi.slice(1).some(v => v < 0);
}
const inflection = results.filter(e => e.action === 'route' && byT[e.ticker] && justProfitable(byT[e.ticker]));
console.log('=== Inflection-Namen (neuestes OpInc>0, aelteres <0):', inflection.length, '===');

// 3) fuer die semiconductors|profitable Kohorte: capEff-Perzentil der Inflection-Namen vs reife
const semiP = results.filter(e => e.action === 'route' && e.formulaId === 'semiconductors' && e.track === 'profitable');
const capRaw = semiP.map(e => rawAxisValue(byT[e.ticker], 'capitalEfficiency', formulas.semiconductors, 'profitable'));
console.log('\n=== semiconductors|profitable: capEff(ROIC)-Perzentil — Inflection vs reif ===');
const rows = semiP.map((e, i) => ({ t: e.ticker, inf: justProfitable(byT[e.ticker]), capPct: q(capRaw[i], capRaw), score: Math.round(e.score * 10) / 10 }));
rows.sort((a, b) => b.score - a.score);
for (const r of rows.slice(0, 15)) console.log(r.t.padEnd(9), 'score=' + r.score, 'capEff-Perzentil=' + (r.capPct === null ? 'DROP' : Math.round(r.capPct)), r.inf ? '<- INFLECTION (gerade profitabel)' : '');

// 4) Werden Inflection-Namen im Schnitt auf capEff bestraft?
const infPct = rows.filter(r => r.inf && r.capPct !== null).map(r => r.capPct);
const matPct = rows.filter(r => !r.inf && r.capPct !== null).map(r => r.capPct);
const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null;
console.log('\ncapEff-Perzentil Schnitt: INFLECTION=' + avg(infPct) + ' (' + infPct.length + ' Namen)  vs  REIF=' + avg(matPct) + ' (' + matPct.length + ')');
console.log('-> wenn INFLECTION deutlich niedriger: ROIC-LEVEL bestraft gerade-profitable Namen');
