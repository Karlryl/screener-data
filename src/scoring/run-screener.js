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
// audit/fix (C2): Outputs atomar schreiben (tmp+rename), wie das ganze Daten-Fundament —
// plain fs.writeFileSync hinterlaesst bei Crash/CI-Timeout truncated JSON fuers Dashboard.
const { writeJsonAtomic } = require('../../lib/atomic-write.js');

const ROOT = path.join(__dirname, '..', '..');
const SNAP_DIR = path.join(ROOT, 'snapshots');
const OUT_DIR = path.join(ROOT, 'outputs', 'hypergrowth');

function loadUniverse() {
  const u = [];
  let parseFail = 0, skippedNoMeta = 0;
  for (const f of fs.readdirSync(SNAP_DIR)) {
    if (!f.endsWith('.json')) continue;
    // audit/fix (C3): NUR die Manifeste (_manifest.json/_manifest-full.json) explizit skippen,
    // NICHT pauschal jedes "_"-Praefix — safeSnapshotFilename praefixt Windows-Reserved-Ticker
    // (CON/PRN/AUX/NUL/COM1..LPT9 -> z.B. _CON.json), das sind ECHTE Snapshots mit meta.ticker.
    if (f.startsWith('_manifest')) continue;
    let s;
    try {
      s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8'));
    } catch (_) { parseFail++; continue; } // defekter Snapshot
    if (s && s.meta && s.meta.ticker) u.push(s);
    else skippedNoMeta++;
  }
  // audit/fix (C3): still geschluckte Parse-Fehler / Schema-Drift verzerren lautlos die
  // Kohorten-Perzentile (Universum schrumpft unbemerkt) -> sichtbar machen statt verschweigen.
  if (parseFail > 0 || skippedNoMeta > 0) {
    console.warn(`[run-screener] loadUniverse: ${u.length} geladen, ${parseFail} parse-fail, ${skippedNoMeta} ohne meta.ticker uebersprungen`);
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
    writeJsonAtomic(path.join(OUT_DIR, id + '.json'), b); // indent 2 default -> byte-identisch
  }
  writeJsonAtomic(path.join(OUT_DIR, 'overview.json'), ranked.overview);
  writeJsonAtomic(path.join(OUT_DIR, 'survival.json'), ranked.survival);
  writeJsonAtomic(path.join(OUT_DIR, 'index.json'), {
    generatedFromSnapshots: universe.length,
    branches: Object.keys(ranked.branches),
    counts,
    survivalCount: ranked.survival.length,
    excluded: ranked.excluded,
  });
  return { universe: universe.length, branches: Object.keys(ranked.branches).length, out: OUT_DIR };
}

if (require.main === module) {
  const argIdx = process.argv.indexOf('--topN');
  const topN = argIdx >= 0 ? parseInt(process.argv[argIdx + 1], 10) : 100;
  const r = run(topN);
  console.log(`Screener-Output: ${r.branches} Branchen, Universum ${r.universe} -> ${r.out}`);
}

module.exports = { loadUniverse, run };
