'use strict';
/**
 * Engine — Integrations-Test (Erfolgs-Gate (1)/(2), Halbleiter).
 * Laedt das ECHTE Snapshot-Universum, scored die Semiconductor-Kohorte und
 * prueft: Anker CRDO (+ ALAB falls vorhanden) im oberen Dezil ihres Tracks,
 * Decliner (NVTS/AEHR falls vorhanden) im unteren Bereich. Keine NaN-Scores.
 *
 * Usage:  node tests/scoring/score.integration.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scoreUniverse, rankBy } = require('../../src/scoring/score.js');
const formulas = require('../../src/scoring/formulas/index.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

const SNAP_DIR = path.join(__dirname, '..', '..', 'snapshots');
const files = fs.readdirSync(SNAP_DIR).filter((f) => f.endsWith('.json'));
const universe = [];
for (const f of files) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8'));
    if (s && s.meta && s.meta.ticker) universe.push(s);
  } catch (_) { /* defekte/teil-Snapshots ueberspringen */ }
}
console.log(`  (Universum: ${universe.length} Snapshots geladen)`);

const results = scoreUniverse(universe, formulas);
const byTicker = Object.fromEntries(results.map((r) => [r.ticker, r]));
const rankIn = (cohort, ticker) => cohort.findIndex((e) => e.ticker === ticker);

// --- keine NaN/Infinity-Scores ueber das ganze Universum --------------------
test('kein Score ist NaN/Infinity', () => {
  for (const r of results) {
    if (r.score !== null) assert.ok(Number.isFinite(r.score), r.ticker + ' Score=' + r.score);
  }
});

// --- CRDO: geroutet, profitable-Track, oberes Dezil -------------------------
test('CRDO -> semiconductors, profitabler Track, Score finit', () => {
  const c = byTicker['CRDO'];
  assert.ok(c, 'CRDO-Snapshot fehlt');
  assert.equal(c.action, 'route');
  assert.equal(c.formulaId, 'semiconductors');
  assert.equal(c.track, 'profitable'); // annualOpInc juengstes Jahr +37.997M
  assert.ok(Number.isFinite(c.score));
});
test('CRDO im oberen 20% seines Track-Kohorten-Rankings', () => {
  const c = byTicker['CRDO'];
  const cohort = rankBy(results, 'semiconductors', c.track);
  assert.ok(cohort.length >= 5, 'Kohorte zu klein: ' + cohort.length);
  const rank = rankIn(cohort, 'CRDO');
  console.log(`       CRDO Rang ${rank + 1}/${cohort.length} (profitable), Score ${c.score.toFixed(1)}`);
  assert.ok(rank >= 0 && (rank / cohort.length) <= 0.20, `CRDO Rang ${rank + 1}/${cohort.length}`);
});

// --- ALAB (falls vorhanden) ebenfalls oben ----------------------------------
test('ALAB (falls vorhanden) im oberen 25% seines Tracks', () => {
  const a = byTicker['ALAB'];
  if (!a || a.action !== 'route') { console.log('       (ALAB nicht im Universum — uebersprungen)'); return; }
  const cohort = rankBy(results, 'semiconductors', a.track);
  const rank = rankIn(cohort, 'ALAB');
  console.log(`       ALAB Rang ${rank + 1}/${cohort.length} (${a.track}), Score ${a.score.toFixed(1)}`);
  assert.ok((rank / cohort.length) <= 0.25, `ALAB Rang ${rank + 1}/${cohort.length}`);
});

// --- Decliner (NVTS/AEHR falls vorhanden) im unteren Bereich ----------------
test('Decliner NVTS/AEHR (falls vorhanden) in unterer Haelfte ihres Tracks', () => {
  for (const t of ['NVTS', 'AEHR']) {
    const d = byTicker[t];
    if (!d || d.action !== 'route' || d.score === null) { console.log(`       (${t} nicht scorebar — uebersprungen)`); continue; }
    const cohort = rankBy(results, 'semiconductors', d.track);
    const rank = rankIn(cohort, t);
    console.log(`       ${t} Rang ${rank + 1}/${cohort.length} (${d.track}), Score ${d.score.toFixed(1)}`);
    assert.ok((rank / cohort.length) >= 0.5, `${t} sollte unten ranken: ${rank + 1}/${cohort.length}`);
  }
});

// --- weitere Anker in anderen Branchen --------------------------------------
function assertAnchorTop(ticker, formulaId, maxPct) {
  const a = byTicker[ticker];
  if (!a || a.action !== 'route' || a.score === null) { console.log(`       (${ticker} nicht scorebar — uebersprungen)`); return; }
  assert.equal(a.formulaId, formulaId, `${ticker} formulaId=${a.formulaId}`);
  const cohort = rankBy(results, formulaId, a.track);
  const rank = rankIn(cohort, ticker);
  console.log(`       ${ticker} Rang ${rank + 1}/${cohort.length} (${formulaId}/${a.track}), Score ${a.score.toFixed(1)}`);
  assert.ok((rank / cohort.length) <= maxPct, `${ticker} Rang ${rank + 1}/${cohort.length} > ${maxPct * 100}%`);
}
test('PLTR -> software-comm-services, oberes 20% seines Tracks', () => {
  assertAnchorTop('PLTR', 'software-comm-services', 0.20);
});
test('BE/Bloom Energy -> industrials, PROFITABLE-Track, oberes 20% (Karl-Anker)', () => {
  const b = byTicker['BE'];
  assert.ok(b && b.action === 'route', 'BE fehlt/ungeroutet');
  assert.equal(b.formulaId, 'industrials');
  assert.equal(b.track, 'profitable'); // Turnaround: juengstes annualOpInc +72.8M
  assertAnchorTop('BE', 'industrials', 0.20);
});

// --- VIELLEICHT-Branchen produzieren Rankings -------------------------------
test('VIELLEICHT-Branchen (utilities/staples/materials/real-estate/it-services) gerankt', () => {
  for (const fid of ['utilities', 'consumer-staples', 'materials', 'real-estate', 'it-services']) {
    const n = rankBy(results, fid).length;
    console.log(`       ${fid}: ${n} gerankt`);
    assert.ok(n > 0, fid + ' leer');
  }
});

// --- Pre-Revenue-Biotech: Survival-Track, KEIN Growth-Score -----------------
test('Pre-Revenue-Biotech -> survival-track, score=null, Runway-Badge', () => {
  const surv = results.filter((e) => e.action === 'survival');
  console.log(`       survival-Eintraege: ${surv.length}`);
  assert.ok(surv.length > 0, 'keine survival-Eintraege im Universum');
  for (const e of surv) {
    assert.equal(e.score, null, e.ticker + ' darf keinen Growth-Score haben');
    assert.ok(e.overview && e.overview.kind === 'runway-badge', e.ticker + ' Runway-Badge fehlt');
  }
});

// --- Real-Estate: Overview = FFO-Badge (Nicht-GP) ---------------------------
test('Real-Estate Overview ist ffo-badge (track-eigene Badge)', () => {
  const reits = results.filter((e) => e.formulaId === 'real-estate' && e.action === 'route');
  if (!reits.length) { console.log('       (keine REITs — uebersprungen)'); return; }
  assert.ok(reits.every((e) => e.overview && e.overview.kind === 'ffo-badge'), 'REIT Overview != ffo-badge');
});

// --- Sichtbarkeit: Top 6 je Branche/Track -----------------------------------
for (const fid of ['semiconductors', 'software-comm-services', 'industrials', 'energy', 'health-care']) {
  for (const track of ['profitable', 'unprofitable']) {
    const cohort = rankBy(results, fid, track);
    if (!cohort.length) continue;
    console.log(`\n  Top 6 ${fid}/${track} (von ${cohort.length}):`);
    cohort.slice(0, 6).forEach((e, i) => {
      console.log(`    ${String(i + 1).padStart(2)}. ${e.ticker.padEnd(7)} ${e.score.toFixed(1).padStart(6)}  [${e.lamps.join(',')}]`);
    });
  }
}

console.log(`\nscore.integration.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
