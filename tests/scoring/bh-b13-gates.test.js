'use strict';
/**
 * Audit-Batch b13-gates (Tag 356): BH-120, BH-126.
 * (BH-127/BH-132/BH-133 sind in tests/freshness-gate.test.js gepinnt — dort
 * sitzt bereits die passende Fixture-Infrastruktur fuer verify-freshness.js.)
 *
 * Reine Funktionen, keine Netz-/Discord-Zugriffe. Run: node tests/scoring/bh-b13-gates.test.js
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  classify, buildMarker, validateMarker, degradedMarkerBroken,
} = require('../../scripts/coverage-gate.js');
const { detectStatsDrift, HIST_DIR, OUT_DIR } = require('../../scripts/check-pull-stats.js');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); } }

// ---- BH-126: coverage-gate.js darf einen 'degradiert'-Marker mit kaputtem
// Vertrag oder gescheitertem Write nicht mehr blind deployen. ----

test('degradedMarkerBroken: ok-Status blockt nie, egal wie kaputt der Marker waere', () => {
  assert.equal(degradedMarkerBroken('ok', ['schema=x'], true), false);
});

test('degradedMarkerBroken: katastrophal blockt schon ueber den regulaeren exit1-Pfad, hier false', () => {
  // katastrophal exit-1'd bereits vor dieser Pruefung im run()-Ablauf (siehe Kommentar
  // an der Funktion) — die Pruefung selbst betrifft nur den degradiert-Zweig.
  assert.equal(degradedMarkerBroken('katastrophal', [], false), false);
});

test('degradedMarkerBroken: degradiert + valider, geschriebener Marker -> darf deployen', () => {
  assert.equal(degradedMarkerBroken('degradiert', [], false), false);
});

test('degradedMarkerBroken: degradiert + Vertragsbruch -> blockt', () => {
  assert.equal(degradedMarkerBroken('degradiert', ['status=weird'], false), true);
});

test('degradedMarkerBroken: degradiert + Write-Fehler (Marker leer, aber Vertrag ok) -> blockt', () => {
  assert.equal(degradedMarkerBroken('degradiert', [], true), true);
});

// End-to-end durch die echte Klassifikation: ein degradierter Fall (Fail-Mass) muss
// einen validen Marker produzieren -> darf NICHT blockiert werden (Negativ-Kontrolle
// fuer die neue Regel, sonst wuerde jeder degradierte Lauf faelschlich rot).
test('realer degradierter Fall (Fail-Mass) hat einen validen Marker -> kein Fail-Loud noetig', () => {
  const m = { n_ok: 6000, n_total: 30228, partial: false, n_failed: 5000 };
  const res = classify(m, 30228, 0);
  assert.equal(res.status, 'degradiert');
  const marker = buildMarker(res, m);
  const errs = validateMarker(marker);
  assert.deepEqual(errs, []);
  assert.equal(degradedMarkerBroken(res.status, errs, false), false);
});

// ---- BH-120: history.json muss aus dem gh-pages-only outputs/ raus, sonst
// wird MIN_HISTORY_RUNS=4 in CI nie erreicht (jeder Lauf startet leer). ----

test('HIST_DIR liegt NICHT unter outputs/ (das ist gh-pages-only/gitignored)', () => {
  const rel = path.relative(OUT_DIR, HIST_DIR);
  assert.ok(rel.startsWith('..'), `HIST_DIR (${HIST_DIR}) muss ausserhalb von OUT_DIR (${OUT_DIR}) liegen, rel=${rel}`);
  assert.ok(!HIST_DIR.split(path.sep).includes('outputs'), `HIST_DIR darf kein "outputs"-Segment enthalten: ${HIST_DIR}`);
});

// Detektionslogik selbst war nie kaputt — der Bug war rein die Persistenz. Sobald
// history >= MIN_HISTORY_RUNS(4) traegt, muss ein 25%-Einbruch weiterhin feuern.
test('detectStatsDrift feuert sobald genug Historie da ist (Persistenz war der Bug, nicht die Mathematik)', () => {
  const history = [
    { asOf: '2026-07-01', yahooOk: 6000 },
    { asOf: '2026-07-02', yahooOk: 6050 },
    { asOf: '2026-07-03', yahooOk: 5980 },
    { asOf: '2026-07-04', yahooOk: 6010 },
  ];
  const today = { asOf: '2026-07-05', yahooOk: 4000 }; // -33% vs median ~6005
  const alerts = detectStatsDrift(today, history, 0.25);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].metric, 'yahooOk');
});

test('detectStatsDrift bleibt still unter MIN_HISTORY_RUNS (unveraendertes Verhalten)', () => {
  const history = [{ asOf: '2026-07-01', yahooOk: 6000 }];
  const today = { asOf: '2026-07-02', yahooOk: 1 };
  assert.deepEqual(detectStatsDrift(today, history, 0.25), []);
});

console.log(fail ? `\nbh-b13-gates: ${fail} FAILED (${pass} passed)` : `\nbh-b13-gates: all ${pass} passed`);
process.exit(fail ? 1 : 0);
