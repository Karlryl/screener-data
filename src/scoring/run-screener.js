'use strict';
/**
 * CLI: Hypergrowth-Screener ueber das volle Snapshot-Universum laufen lassen und
 * dashboard-integrierbares JSON schreiben (outputs/hypergrowth/).
 *
 *   node src/scoring/run-screener.js [--topN 100]
 *
 * Schreibt: <branche>.json (gerankt je Track), overview.json (cross-branch),
 * survival.json (Pre-Revenue-Biotech), index.json (Zaehlung/Meta).
 */
const fs = require('fs');
const path = require('path');
const { scoreUniverse, produceRankings } = require('./score.js');
const formulas = require('./formulas/index.js');

const ROOT = path.join(__dirname, '..', '..');
const SNAP_DIR = path.join(ROOT, 'snapshots');
const OUT_DIR = path.join(ROOT, 'outputs', 'hypergrowth');

function loadUniverse() {
  const u = [];
  for (const f of fs.readdirSync(SNAP_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8'));
      if (s && s.meta && s.meta.ticker) u.push(s);
    } catch (_) { /* defekte Snapshots ueberspringen */ }
  }
  return u;
}

function run(topN) {
  const universe = loadUniverse();
  const results = scoreUniverse(universe, formulas);
  const ranked = produceRankings(results, { topN: topN || 100 });
  // Echte Kohorten-Counts aus results (NICHT aus der gekappten topN-Anzeigeliste).
  const counts = {};
  for (const e of results) {
    if (e.action === 'route' && e.score !== null) {
      counts[e.formulaId] = counts[e.formulaId] || { profitable: 0, unprofitable: 0 };
      counts[e.formulaId][e.track] = (counts[e.formulaId][e.track] || 0) + 1;
    }
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [id, b] of Object.entries(ranked.branches)) {
    fs.writeFileSync(path.join(OUT_DIR, id + '.json'), JSON.stringify(b, null, 2));
  }
  fs.writeFileSync(path.join(OUT_DIR, 'overview.json'), JSON.stringify(ranked.overview, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'survival.json'), JSON.stringify(ranked.survival, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify({
    generatedFromSnapshots: universe.length,
    branches: Object.keys(ranked.branches),
    counts,
    survivalCount: ranked.survival.length,
    excluded: ranked.excluded,
  }, null, 2));
  return { universe: universe.length, branches: Object.keys(ranked.branches).length, out: OUT_DIR };
}

if (require.main === module) {
  const argIdx = process.argv.indexOf('--topN');
  const topN = argIdx >= 0 ? parseInt(process.argv[argIdx + 1], 10) : 100;
  const r = run(topN);
  console.log(`Screener-Output: ${r.branches} Branchen, Universum ${r.universe} -> ${r.out}`);
}

module.exports = { loadUniverse, run };
