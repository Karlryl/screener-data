'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const yahoo = require('../pull-yahoo.js');
const { mergeManifests } = require('../scripts/merge-shard-manifests.js');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.stack || e)); }
}
function mapped(price, financialData) {
  return yahoo.mapYahooToCanonical({ price, financialData }, { ticker: 'NOCCY', name: 'Fixture' }, '2026-08-10T00:00:00.000Z');
}

(async () => {
  await test('(a) Nicht-OTC: echter Altbestand bleibt byte-identisch; Status und Zaehler feuern', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f-neu-01-'));
    try {
      const file = path.join(tmp, yahoo.safeSnapshotFilename('NOCCY'));
      const vorher = Buffer.from('{"meta":{"ticker":"NOCCY"},"alt":true}\n');
      fs.writeFileSync(file, vorher);
      const results = [];
      const snap = mapped({ regularMarketPrice: 100, exchangeName: 'NasdaqGS' });
      assert.equal(snap.meta._ccyMissingCompletely, true);
      assert.equal(yahoo.preserveSnapshotForMissingCurrency(snap, { ticker: 'NOCCY' }, tmp, results), true);
      assert.deepEqual(fs.readFileSync(file), vorher, 'Skip darf weder writeFileAtomic noch _removeStaleFiles erreichen');
      assert.equal(results[0].status, 'ccy-missing-completely');
      assert.ok(results.filter(r => r.status === 'ccy-missing-completely').length > 0);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  await test('(b) leere Strings gelten als komplett fehlende Waehrung', () => {
    const snap = mapped({ currency: '   ', financialCurrency: '', exchangeName: 'NYSE' }, { financialCurrency: '\t' });
    assert.equal(snap.meta._ccyMissingCompletely, true);
    assert.equal(yahoo.preserveSnapshotForMissingCurrency(snap, { ticker: 'NOCCY' }, os.tmpdir(), []), true);
  });

  await test('(c) nur financialCurrency fehlt: ccyAmbiguous bleibt, neuer Kanal schweigt', () => {
    const snap = mapped({ currency: 'EUR', exchangeName: 'XETRA' });
    assert.equal(snap.meta.ccyAmbiguous, true);
    assert.equal(snap.meta._ccyMissingCompletely, false);
    assert.equal(yahoo.preserveSnapshotForMissingCurrency(snap, { ticker: 'NOCCY' }, os.tmpdir(), []), false);
  });

  await test('(d) OTC bleibt im F-NY-004-fxConversionFailed-Loeschpfad erreichbar', () => {
    const snap = mapped({ regularMarketPrice: 100, exchangeName: 'Other OTC' });
    assert.equal(snap.meta._ccyMissingCompletely, true);
    assert.equal(yahoo.preserveSnapshotForMissingCurrency(snap, { ticker: 'NOCCY' }, os.tmpdir(), []), false);
    yahoo._convertSnapshotToUSD(snap);
    assert.equal(snap.meta.fxConversionFailed, true);
    assert.equal(snap.meta.fxConverted, false);
  });

  await test('(e) Merge summiert n_ccy_missing_completely ueber Shards', () => {
    const merged = mergeManifests([
      { n_ok: 4, n_full: 2, n_priceonly: 2, n_failed: 0, n_ccy_missing_completely: 2 },
      { n_ok: 5, n_full: 1, n_priceonly: 4, n_failed: 0, n_ccy_missing_completely: 3 },
    ], 10, 2);
    assert.equal(merged.n_ccy_missing_completely, 5);
  });

  await test('(f) hartes Coverage-Gate endet bei gemergtem Feld >0 mit ::error:: und Exit != 0', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f-neu-gate-'));
    try {
      fs.mkdirSync(path.join(tmp, 'snapshots'));
      fs.writeFileSync(path.join(tmp, 'snapshots', '_manifest.json'), JSON.stringify({ n_ok: 1, n_total: 1, n_failed: 0, n_ccy_missing_completely: 2 }));
      fs.writeFileSync(path.join(tmp, 'watchlist.json'), JSON.stringify({ stocks: [{ ticker: 'A' }] }));
      const run = cp.spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'coverage-gate.js')], { cwd: tmp, encoding: 'utf8' });
      assert.notEqual(run.status, 0, run.stdout + run.stderr);
      assert.match(run.stderr + run.stdout, /^::error::2 Ticker ohne jede Waehrungsangabe/m);
      assert.match(run.stderr + run.stdout, /Snapshots NICHT ueberschrieben, Altbestand bleibt/);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  await test('Verdrahtung: Skip liegt vor Konverter; inkrementelles und finales Slim tragen den Zaehler', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'pull-yahoo.js'), 'utf8');
    const processStart = src.indexOf('async function processOne(stock)');
    const skip = src.indexOf('preserveSnapshotForMissingCurrency(canonical', processStart);
    const convert = src.indexOf('_convertSnapshotToUSDGuarded(canonical', processStart);
    assert.ok(processStart > 0 && skip > processStart && convert > skip, 'echter processOne-Skip muss vor Konverter/Loeschpfaden liegen');
    assert.ok((src.match(/n_ccy_missing_completely:/g) || []).length >= 2, 'inkrementelles UND finales Slim-Manifest muessen zaehlen');
  });

  console.log(`\nf-neu-01-ccy-ehrlichkeit: ${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail ? 1 : 0);
})();
