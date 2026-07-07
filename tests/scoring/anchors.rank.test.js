'use strict';
/**
 * Rang-Anker-Gate (Direktive 4 + Task 2.10) — der Bless-Gate fuer score-veraendernde Tasks (R-Gate,
 * Grundgesetz 8). Pinnt die DURABLE Direktive-4-Invariante: Karls Hypergrowth-Anker stehen "oben" =
 * im oberen Bereich IHRES BOARDS (within-Kohorten-Rang). Dieser Rang ist gegen die EB-Shrinkage (2.10)
 * invariant (uniforme affine Transformation je Kohorte -> Ordnung erhalten) und damit der richtige,
 * stabile Anker — anders als die Grundgesetz-3-kompromittierte globale Cross-Kohorten-Overview.
 *
 * Zusaetzlich 2.10-spezifisch: (a) kein cohortFallback-Name (duenne Kohorte) draengt in die Overview-Spitze;
 * (b) cohortN/cohortFallback-Feld-Integritaet auf den Anker-Zeilen.
 *
 * Ein score-veraendernder Bless (Fixture-Bless) DARF diesen Test nur mit dokumentierter Begruendung
 * beruehren und Regressionstests nur HINZUFUEGEN, nie relaxen (L6).
 *
 * Usage:  node tests/scoring/anchors.rank.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scoreUniverse, rankBy, produceRankings } = require('../../src/scoring/score.js');
const formulas = require('../../src/scoring/formulas/index.js');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); } }

const SNAP_DIR = path.join(__dirname, '..', '..', 'snapshots');
const universe = [];
try {
  for (const f of fs.readdirSync(SNAP_DIR).filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
    try { const s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); if (s && s.meta && s.meta.ticker) universe.push(s); } catch (_) {}
  }
} catch (_) {}

if (universe.length < 100) {
  console.log('  (Universum < 100 -> Rang-Anker uebersprungen, KEIN Fail — pre-pull-Gate)');
  console.log('anchors.rank.test.js: 0 ok, 0 fail (skipped: kein Universum)');
  process.exit(0);
}
console.log(`  (Universum: ${universe.length} Snapshots geladen)`);
const results = scoreUniverse(universe, formulas);
const byTicker = Object.fromEntries(results.map((r) => [r.ticker, r]));

// within-Board-Rang eines Ankers als Prozentil seines Track-Rankings (0 = Spitze).
function boardPct(ticker, formulaId, track) {
  const cohort = rankBy(results, formulaId, track);
  const i = cohort.findIndex((e) => e.ticker === ticker);
  assert.ok(i >= 0, `${ticker} nicht im ${formulaId}|${track}-Ranking`);
  return { pct: i / cohort.length, rank: i + 1, n: cohort.length };
}

// --- Direktive 4: die Anker stehen oben in IHREM Board -----------------------
const ANCHORS = [
  { t: 'CRDO', fid: 'semiconductors', track: 'profitable', max: 0.15 }, // real 1.1%
  { t: 'ALAB', fid: 'semiconductors', track: 'profitable', max: 0.15 }, // real 8.9%
  { t: 'PLTR', fid: 'software-comm-services', track: 'profitable', max: 0.05 }, // real 1.1%
  { t: 'BE', fid: 'industrials', track: 'profitable', max: 0.25 }, // real 20.3%
];
for (const a of ANCHORS) {
  test(`Direktive 4: ${a.t} oben in ${a.fid}|${a.track} (<= ${a.max * 100}%)`, () => {
    const e = byTicker[a.t];
    if (!e || e.action !== 'route') { console.log(`       (${a.t} nicht im Universum — uebersprungen)`); return; }
    assert.equal(e.formulaId, a.fid, `${a.t} formulaId=${e.formulaId}`);
    const r = boardPct(a.t, a.fid, a.track);
    console.log(`       ${a.t} Rang ${r.rank}/${r.n} = ${(r.pct * 100).toFixed(1)}% (Score ${e.score.toFixed(1)})`);
    assert.ok(r.pct <= a.max, `${a.t} Rang ${r.rank}/${r.n} = ${(r.pct * 100).toFixed(1)}% > ${a.max * 100}%`);
  });
}

// --- Direktive 4: CRDO steht ueber ALAB im semiconductors-Board (Hypergrowth-Ordnung) ----
test('Direktive 4: CRDO rankt >= ALAB im semiconductors|profitable-Board', () => {
  const crdo = byTicker['CRDO'], alab = byTicker['ALAB'];
  if (!crdo || !alab || crdo.action !== 'route' || alab.action !== 'route') { console.log('       (CRDO/ALAB nicht beide da — uebersprungen)'); return; }
  assert.ok(crdo.score >= alab.score, `CRDO ${crdo.score.toFixed(1)} sollte >= ALAB ${alab.score.toFixed(1)}`);
});

// --- 2.10: kein cohortFallback-Name (duenne Kohorte) in der Overview-Spitze -----------
test('2.10: kein cohortFallback-Name (n < MIN_COHORT_N) in den Overview-Top-25', () => {
  const routed = results.filter((e) => e.action === 'route' && Number.isFinite(e.score));
  const ov = routed.slice().sort((a, b) => b.score - a.score || (a.ticker < b.ticker ? -1 : 1)).slice(0, 25);
  const bad = ov.filter((e) => e.cohortFallback === true);
  assert.equal(bad.length, 0, `duenne-Kohorten-Namen in Overview-Top-25: ${bad.map((e) => e.ticker + '(' + e.formulaId + '|' + e.track + ' n=' + e.cohortN + ')').join(', ')}`);
});

// --- 2.10: cohortN/cohortFallback-Feld-Integritaet auf Anker-Zeilen ------------
test('2.10: Anker-Zeilen tragen finite cohortN == Kohortengroesse, cohortFallback=false (fette Kohorten)', () => {
  for (const a of ANCHORS) {
    const e = byTicker[a.t];
    if (!e || e.action !== 'route') continue;
    const cohort = rankBy(results, a.fid, a.track);
    assert.ok(Number.isFinite(e.cohortN) && e.cohortN === cohort.length, `${a.t} cohortN=${e.cohortN} != ${cohort.length}`);
    assert.equal(e.cohortFallback, false, `${a.t} sollte in fetter Kohorte (fb=false) sein`);
  }
});

// --- 2.10: cohortN wandert in den v1-Export (produceRankings-Zeilen) -----------
test('2.10: produceRankings-Board/Overview-Zeilen tragen cohortN + cohortFallback', () => {
  const r = produceRankings(results, { topN: 50 });
  const semis = r.branches['semiconductors'].profitable;
  assert.ok(semis.length > 0, 'semis-Board leer');
  for (const row of semis) {
    assert.ok(Number.isFinite(row.cohortN), `${row.ticker} cohortN nicht finit im Board-Export`);
    assert.equal(typeof row.cohortFallback, 'boolean', `${row.ticker} cohortFallback nicht boolean`);
  }
  assert.ok(r.overview.length > 0 && Number.isFinite(r.overview[0].cohortN), 'overview-Zeile ohne cohortN');
});

console.log(`\nanchors.rank.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
