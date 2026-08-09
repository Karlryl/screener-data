'use strict';
/**
 * P1-Welle 3 (09.08.2026) — Waechter-Baselines duerfen Blindheit nicht seeden.
 *
 * Rot-zuerst gegen e75e206525 belegt: A/B warfen korrupte Baselines nicht,
 * C kannte keine Liste ungepruefter Metriken, D erzeugte bei null/null keine
 * Messwarnung, E meldete KOSDAQ bei Median 0 nicht und F kannte nur den Index.
 * Run: node tests/p1-welle3-waechter-wahrheit.test.js (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const exchange = require('../scripts/watch-exchange-coverage.js');
const fx = require('../scripts/watch-fx-sanity.js');
const unrouted = require('../scripts/watch-unrouted-quote.js');
const pullStats = require('../scripts/check-pull-stats.js');
const plan = require('../scripts/plan-check.js');
const annual = require('../scripts/watch-annual-spikes.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'p1w3-'));
let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.stack || e)); }
}
function corrupt(name) { const p = path.join(TMP, name); fs.writeFileSync(p, '{kaputt'); return p; }

test('Cluster A: korrupte Exchange-/FX-Baselines sind kein Erstseeding', () => {
  assert.throws(() => exchange.loadBaseline(corrupt('exchange.json')), /NICHT ueberschrieben/);
  assert.throws(() => fx.loadBaseline(corrupt('fx.json')), /NICHT ueberschrieben/);
  assert.deepEqual(exchange.loadBaseline(path.join(TMP, 'fehlt-exchange.json')), {});
  assert.equal(fx.loadBaseline(path.join(TMP, 'fehlt-fx.json')), null);
});

test('Cluster B: korrupte Label-Baseline wirft; leerer Scan ist sichtbar leer', () => {
  assert.throws(() => unrouted.loadBaseline(corrupt('labels.json')), /NICHT ueberschrieben/);
  assert.equal(unrouted.loadBaseline(path.join(TMP, 'fehlt-labels.json')), null);
  const leer = unrouted.scanSnapshots(path.join(TMP, 'kein-snapshot-dir'));
  assert.equal(leer.routable, 0);
  const source = fs.readFileSync(require.resolve('../scripts/watch-unrouted-quote.js'), 'utf8');
  assert.match(source, /if \(routable === 0\) problems\.push/);
  assert.match(source, /if \(routable > 0\)[\s\S]*writeJsonAtomic/);
});

test('Cluster C: Null-Metrik bleibt im Gesamtfazit als ungeprueft sichtbar', () => {
  const history = Array.from({ length: 4 }, (_, i) => ({ asOf: String(i), yahooOk: 100, fxRatesCount: 10,
    earningsWithDate: 20, priceTickerCount: 30, snapshotsCount: 40 }));
  const today = { yahooOk: 100, fxRatesCount: 10, earningsWithDate: 20, priceTickerCount: null, snapshotsCount: 40 };
  assert.deepEqual(pullStats.uncheckedStats(today, history), ['priceTickerCount']);
  assert.deepEqual(pullStats.detectStatsDrift(today, history), []);
});

test('Cluster D: nicht messbare Manifest-/Snapshot-Fakten verbieten "im Rahmen"', () => {
  const vendors = plan.VENDORS.map(v => ({ name: v.name, ok: true, code: 200 }));
  const status = plan.buildStatus(vendors, { missing: [], hard: false }, null, null,
    '2026-08-09T00:00:00Z', '2026-08', ['Manifest: kaputtes JSON', 'Snapshot-Zahl: EACCES']);
  assert.equal(status.measurement_errors.length, 2);
  assert.match(plan.renderReport(status), /NICHT MESSBAR/);
  assert.doesNotMatch(plan.renderReport(status), /Universe\/Detektoren\/Cache im Rahmen/);
});

test('Cluster E: aktive KOSDAQ-Phase alarmiert trotz alter Nullen; tote Reihen bleiben still', () => {
  const kosdaq = [0, 0, 0, 0, 0, 0, 0, 0, 68, 71, 72, 70, 72, 72];
  assert.equal(exchange.isExchangeAlarming(0, kosdaq), true);
  for (const tot of ['Kuala Lumpur', 'Dubai', '(unknown)']) {
    assert.equal(exchange.isExchangeAlarming(0, Array(14).fill(0)), false, tot + ' ist durchgehend tot');
  }
});

test('Cluster F: stabile Signatur ueberlebt Indexverschiebung und liest Altbestand', () => {
  const vor = { ticker: 'ABC', reihe: 'annualRev', index: 1, wert: 900, links: 100, rechts: 110, periode: null };
  const nach = { ...vor, index: 2 };
  assert.equal(annual.stabilerSchluessel(vor), annual.stabilerSchluessel(nach));
  assert.equal(annual.istBekannt(nach, new Set(['ABC|annualRev|1'])), true, 'eine neue FY-Zeile verschiebt Legacy-Index um eins');
  assert.equal(annual.istBekannt(nach, new Set([annual.stabilerSchluessel(vor)])), true);
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\nP1-Welle 3: ${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
