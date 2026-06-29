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

// audit/fix (Court Phase A Runde 3, Fall C1): Coverage-Floor gegen eine SELF-BASELINE.
// Weil das Scoring kohorten-relativ perzentil-normiert, verschiebt ein still geschrumpftes
// Universum (defekte/nicht-parsbare Snapshots) lautlos ALLE Perzentile. Der R2-Fall-7-Floor
// verglich on-disk (lokal akkumulierte Snapshot-Union) gegen manifest.n_ok (OK-Count des
// LETZTEN Pulls) — zwei DESYNCHRONISIERTE Populationen (n_ok git-volatil 3978..11827 -> 20%
// der juengsten Manifeste haetten einen GESUNDEN Lauf falsch abgebrochen). Jetzt: Schwelle
// = COVERAGE_FLOOR_RATIO * Self-Baseline (= zuletzt erfolgreich geladener on-disk-Count,
// High-Water in snapshots/_last_good_disk.json) — disk-jetzt vs disk-zuletzt-gesund, DIESELBE
// lokal akkumulierende Population. KEINE absolute Magic Number, skaliert mit dem Universum.
// manifest.n_ok ist nur noch console.warn-Diagnose. COVERAGE_FLOOR_RATIO=0.95 bleibt kalibriert.
const COVERAGE_FLOOR_RATIO = 0.95;
const LAST_GOOD_DISK = path.join(SNAP_DIR, '_last_good_disk.json'); // git-ignored (wie snapshots/)

/**
 * Wirft (Fail-Loud), wenn die geladene Snapshot-Anzahl unter den Self-Baseline-relativen
 * Coverage-Floor faellt. Reine Funktion (testbar, kein I/O). Ohne verwertbare Baseline
 * (Erstlauf: fehlt/0/NaN) ist der relative Floor nicht berechenbar -> kein throw (fail-open).
 */
function assertCoverageFloor(loadedCount, baseline, floorRatio = COVERAGE_FLOOR_RATIO) {
  if (!Number.isFinite(baseline) || baseline <= 0) return; // keine Baseline (Erstlauf) -> nicht erzwingbar
  const floor = Math.ceil(floorRatio * baseline);
  if (loadedCount < floor) {
    throw new Error(
      `[run-screener] loadUniverse: nur ${loadedCount} Snapshots on-disk, unter Coverage-Floor ` +
      `${floor} (= ${floorRatio} x Self-Baseline ${baseline}, zuletzt-gesunder on-disk-Count). Universum ` +
      `geschrumpft — Kohorten-Perzentile waeren unzuverlaessig. Lauf abgebrochen (defekte/fehlende ` +
      `Snapshots pruefen; bei legitimem Schrumpfen snapshots/_last_good_disk.json loeschen zum Reset).`
    );
  }
}

/**
 * Self-Baseline (High-Water) wird MONOTON angehoben (nie gesenkt): ein gewachsenes Universum
 * hebt die Baseline, ein kleiner Dip (>Floor) haelt sie -> echtes Schrumpfen ZWISCHEN Laeufen
 * wirft weiterhin hart. Reine Funktion. Erstlauf/unbrauchbare Baseline -> der frische loaded-Wert.
 */
function nextHighWater(prevBaseline, loadedCount) {
  const prev = Number.isFinite(prevBaseline) && prevBaseline > 0 ? prevBaseline : 0;
  return Math.max(prev, loadedCount);
}

function loadUniverse() {
  const u = [];
  let parseFail = 0, skippedNoMeta = 0;
  for (const f of fs.readdirSync(SNAP_DIR)) {
    if (!f.endsWith('.json')) continue;
    // audit/fix (C3): NUR die Manifeste (_manifest.json/_manifest-full.json) explizit skippen,
    // NICHT pauschal jedes "_"-Praefix — safeSnapshotFilename praefixt Windows-Reserved-Ticker
    // (CON/PRN/AUX/NUL/COM1..LPT9 -> z.B. _CON.json), das sind ECHTE Snapshots mit meta.ticker.
    if (f.startsWith('_manifest') || f === '_last_good_disk.json') continue;
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
  // audit/fix (Court Fall C1): HARTER Floor gegen die Self-Baseline (zuletzt-gesunder on-disk-Count).
  // I/O hier isoliert, die Floor-/High-Water-Logik bleibt rein (assertCoverageFloor/nextHighWater).
  let baseline = null;
  try {
    baseline = JSON.parse(fs.readFileSync(LAST_GOOD_DISK, 'utf8')).value;
  } catch (_) { /* Erstlauf / kein High-Water -> fail-open, gleich Startwert schreiben */ }
  // manifest.n_ok nur noch als Diagnose (NICHT mehr als Floor-Referenz — andere Population).
  try {
    const nOk = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, '_manifest.json'), 'utf8')).n_ok;
    if (Number.isFinite(nOk) && Math.abs(u.length - nOk) > 0.2 * nOk) {
      console.warn(`[run-screener] loadUniverse: on-disk ${u.length} weicht >20% von manifest n_ok ${nOk} ab (verschiedene Populationen — nur Diagnose).`);
    }
  } catch (_) { /* manifest optional fuer die Diagnose */ }
  assertCoverageFloor(u.length, baseline);
  // High-Water nach bestandenem Floor monoton fortschreiben (best effort, kein Abbruch bei I/O-Fehler).
  try {
    fs.writeFileSync(LAST_GOOD_DISK, JSON.stringify({ value: nextHighWater(baseline, u.length), generatedAt: new Date().toISOString() }, null, 2));
  } catch (e) {
    console.warn('[run-screener] loadUniverse: _last_good_disk.json nicht schreibbar — Self-Baseline nicht fortgeschrieben:', e.message);
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
  // audit/fix (Court Fall 7, F6/F46): index.json byte-deterministisch machen. Die Key-Reihenfolge
  // von branches/counts/excluded erbte von fs.readdirSync (OS-abhaengig -> CI-ubuntu != Windows).
  // Werte unveraendert, nur Keys deterministisch sortieren (kein Score-/Membership-Effekt).
  const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  writeJsonAtomic(path.join(OUT_DIR, 'index.json'), {
    generatedFromSnapshots: universe.length,
    branches: Object.keys(ranked.branches).sort(),
    counts: sortKeys(counts),
    survivalCount: ranked.survival.length,
    excluded: sortKeys(ranked.excluded),
  });
  return { universe: universe.length, branches: Object.keys(ranked.branches).length, out: OUT_DIR };
}

if (require.main === module) {
  const argIdx = process.argv.indexOf('--topN');
  const topN = argIdx >= 0 ? parseInt(process.argv[argIdx + 1], 10) : 100;
  const r = run(topN);
  console.log(`Screener-Output: ${r.branches} Branchen, Universum ${r.universe} -> ${r.out}`);
}

module.exports = { loadUniverse, run, assertCoverageFloor, nextHighWater, COVERAGE_FLOOR_RATIO };
