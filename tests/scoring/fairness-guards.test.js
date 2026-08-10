'use strict';
/**
 * 2.13 #23 — Coverage-Ausweis (coverageAxes/coverageWeight). Additives, SCORE-INERTES
 * Anzeigefeld je Board-Zeile ("ausweisen statt verrechnen", Design-Doc §2/§5). Laedt das
 * echte Universum, scored, und prueft den coverageAxes-CONTRACT (Format "n/m", Range,
 * n/n <=> weight 1, reale Variation, Region-Signal US >= JP) + Anker-Inertness.
 * #24 inflationSuspect wird in lamps.test.js getestet (Auflage A2 dort erfuellt).
 *
 * Usage:  node tests/scoring/fairness-guards.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scoreUniverse } = require('../../src/scoring/score.js');
const formulas = require('../../src/scoring/formulas/index.js');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); } }

// SCREENER_SNAPSHOTS_DIR: nur Test-Seam (wie score.integration/anchors.rank) — laesst den
// Leer-Universum-Waechter in tests/skip-honesty.test.js ein leeres Verzeichnis injizieren;
// ohne die Variable unveraendert das echte snapshots/.
const SNAP_DIR = process.env.SCREENER_SNAPSHOTS_DIR || path.join(__dirname, '..', '..', 'snapshots');
const universe = [];
// snapFiles = Rohdatei-Zahl im Verzeichnis. universe zaehlt nur die JSON.parse+meta.ticker-Ueberlebenden;
// ohne die Rohzahl sehen "Verzeichnis leer" und "Tausende Dateien, aber Schema unlesbar" gleich aus.
let snapFiles = 0;
try {
  const files = fs.readdirSync(SNAP_DIR).filter((x) => x.endsWith('.json'));
  snapFiles = files.length;
  for (const f of files) {
    try { const s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); if (s && s.meta && s.meta.ticker) universe.push(s); } catch (_) { /* defekt -> skip */ }
  }
} catch (_) { /* snapshots/ fehlt (pre-pull-Gate) */ }

// Pre-pull-CI-Gate: snapshots/ leer -> Universum-abhaengige Anker N/A (wie score.integration),
// KEIN Engine-Regress -> sauber ueberspringen statt strukturell rot.
if (universe.length === 0) {
  // P1-Chunk 4 Stufe 1 (Tag 623): sichtbar statt still — console.log direkt auf stdout (F2964).
  console.log(`::warning::fairness-guards.test.js: ${snapFiles} Dateien im Snapshot-Verzeichnis, davon 0 lesbar — leeres Universum ODER Schema unlesbar. Alle fuenf coverageAxes-/Fairness-Tests wurden NICHT gemessen; diese Suite meldet gruen, ohne etwas geprueft zu haben.`);
  console.log('  (Universum leer -> coverageAxes-Anker uebersprungen, KEIN Fail)');
  console.log('fairness-guards.test.js: 0 ok, 0 fail (skipped: kein Universum)');
  process.exit(0);
}

console.log(`  (Universum: ${universe.length} Snapshots geladen)`);
const results = scoreUniverse(universe, formulas);
const routed = results.filter((e) => e.action === 'route' && e.score !== null);
const nm = (e) => e.coverageAxes.split('/').map(Number);

test('coverageAxes: jede geroutete Zeile hat Format "n/m" (0<=n<=m, m>0)', () => {
  assert.ok(routed.length > 0, 'es gibt geroutete Zeilen');
  for (const e of routed) {
    assert.match(String(e.coverageAxes), /^\d+\/\d+$/, `${e.ticker}: coverageAxes="${e.coverageAxes}"`);
    const [n, m] = nm(e);
    assert.ok(m > 0 && n >= 0 && n <= m, `${e.ticker}: ${n}/${m} ausserhalb Range`);
  }
});

test('coverageWeight: in [0,1] und n/n <=> weight===1 (volle Achsen = kein Shrink, byte-identisch)', () => {
  for (const e of routed) {
    assert.ok(e.coverageWeight >= 0 && e.coverageWeight <= 1, `${e.ticker}: w=${e.coverageWeight}`);
    const [n, m] = nm(e);
    if (n === m) assert.equal(e.coverageWeight, 1, `${e.ticker}: volle Achsen muessen weight 1 haben`);
  }
});

test('coverageAxes variiert real (mind. eine voll- UND eine teil-abgedeckte Zeile)', () => {
  const full = routed.filter((e) => { const [n, m] = nm(e); return n === m; });
  const partial = routed.filter((e) => { const [n, m] = nm(e); return n < m; });
  assert.ok(full.length > 0, 'mind. eine voll-abgedeckte Zeile');
  assert.ok(partial.length > 0, 'mind. eine teil-abgedeckte Zeile (Coverage-Kluft ist real)');
});

test('Region-Signal: Ø coverageWeight US >= JP (Design-Diagnose belegt)', () => {
  const avg = (c) => { const r = routed.filter((e) => e.country === c && Number.isFinite(e.coverageWeight)); return r.length ? r.reduce((s, e) => s + e.coverageWeight, 0) / r.length : null; };
  const us = avg('United States'), jp = avg('Japan');
  if (us != null && jp != null) assert.ok(us >= jp, `US ${us.toFixed(3)} >= JP ${jp.toFixed(3)} erwartet`);
});

test('Anker-Inertness: CRDO/PLTR routen mit finiter Score UND tragen coverageAxes (additiv, nie im Score)', () => {
  const byTicker = Object.fromEntries(routed.map((e) => [e.ticker, e]));
  for (const t of ['CRDO', 'PLTR']) {
    const e = byTicker[t];
    if (!e) continue; // im Universum evtl. nicht vorhanden -> ueberspringen (wie integration-Anker)
    assert.ok(Number.isFinite(e.score), `${t}: finite Score`);
    assert.match(String(e.coverageAxes), /^\d+\/\d+$/, `${t}: coverageAxes vorhanden`);
  }
});

console.log(`fairness-guards.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
