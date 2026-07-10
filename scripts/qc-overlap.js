'use strict';
/**
 * QC-Overlap-Artefakt (3.1, BAU-GATE 4) — Eigenstaendigkeits-Beleg des QC-Boards.
 * ==============================================================================
 * Rechnet je sektor|track UND pooled die Spearman-Rang-Korrelation zwischen dem
 * QC-Score und dem HG-Score ueber die GETEILTE Compounder-Menge (Namen, die in
 * BEIDEN Paessen route+finite-score sind). Hohe Korrelation => QC ist nur ein
 * umgewichtetes HG (Muster-Friedhof); niedrige => eigenstaendige Diagnose.
 * Schreibt outputs/quality/_overlap.json (pooled + je Sektor).
 *
 *   node scripts/qc-overlap.js
 */
const fs = require('fs');
const path = require('path');
const { loadUniverse } = require('../src/scoring/run-screener.js');
const { scoreUniverse } = require('../src/scoring/score.js');
const formulas = require('../src/scoring/formulas/index.js');
const { qualityRoute } = require('../src/scoring/quality-route.js');
const qcFormulas = require('../src/scoring/formulas/quality/index.js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'outputs', 'quality', '_overlap.json');

const mean = (a) => a.reduce((p, c) => p + c, 0) / a.length;
// Durchschnitts-Raenge (ties -> mittlerer Rang), 1-basiert.
function rankAvg(arr) {
  const idx = arr.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const ranks = new Array(arr.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[idx[k][1]] = r;
    i = j + 1;
  }
  return ranks;
}
function pearson(a, b) {
  const n = a.length, ma = mean(a), mb = mean(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const u = a[i] - ma, v = b[i] - mb; num += u * v; da += u * u; db += v * v; }
  const den = Math.sqrt(da * db);
  return den > 0 ? num / den : null;
}
function spearman(x, y) {
  if (x.length < 3) return null;
  return pearson(rankAvg(x), rankAvg(y));
}

function run() {
  const universe = loadUniverse();
  const hg = scoreUniverse(universe, formulas);
  const qc = scoreUniverse(universe, qcFormulas, { classify: qualityRoute, growthBoost: false });
  const hgBy = {}, qcBy = {};
  for (const e of hg) if (e.action === 'route' && Number.isFinite(e.score)) hgBy[e.ticker] = e;
  for (const e of qc) if (e.action === 'route' && Number.isFinite(e.score)) qcBy[e.ticker] = e;

  const groups = {};                 // key = base-sector|hg-track
  const pooledQ = [], pooledH = [];
  for (const tk of Object.keys(qcBy)) {
    const h = hgBy[tk];
    if (!h) continue;                // nur die geteilte Menge
    const q = qcBy[tk];
    const sector = q.formulaId.replace(/^quality-/, '');
    const key = sector + '|' + h.track;
    (groups[key] ||= { q: [], h: [] });
    groups[key].q.push(q.score); groups[key].h.push(h.score);
    pooledQ.push(q.score); pooledH.push(h.score);
  }

  const perSector = {};
  for (const [key, g] of Object.entries(groups)) {
    const rho = spearman(g.q, g.h);
    perSector[key] = { n: g.q.length, rho: rho === null ? null : Math.round(rho * 1000) / 1000 };
  }
  const pooledRho = spearman(pooledQ, pooledH);
  const out = {
    generated_at: new Date().toISOString(),
    pooled: { n: pooledQ.length, rho: pooledRho === null ? null : Math.round(pooledRho * 1000) / 1000 },
    perSector,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`[qc-overlap] pooled rho=${out.pooled.rho} (n=${out.pooled.n} geteilte Compounder) -> ${OUT}`);
  for (const [key, v] of Object.entries(perSector).sort()) console.log(`  ${key.padEnd(34)} n=${String(v.n).padStart(4)}  rho=${v.rho}`);
  return out;
}

if (require.main === module) run();
module.exports = { run, spearman, rankAvg, pearson };
