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
// Tag 629 (Review-Nachzug b): der Kanal feuert nur bei einer Antwort MIT belastbarem
// marketCap — die Fixtures tragen ihn deshalb, ausser wo genau das geprueft wird.
function mapped(price, financialData) {
  return yahoo.mapYahooToCanonical({ price, financialData }, { ticker: 'NOCCY', name: 'Fixture' }, '2026-08-10T00:00:00.000Z');
}
const MCAP = 5e9;
const GATE = path.join(__dirname, '..', 'scripts', 'ccy-alarm-gate.js');
function runGate(manifestInhalt) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f-neu-gate-'));
  try {
    if (manifestInhalt !== null) {
      fs.mkdirSync(path.join(tmp, 'snapshots'));
      fs.writeFileSync(path.join(tmp, 'snapshots', '_manifest.json'), JSON.stringify(manifestInhalt));
    }
    const r = cp.spawnSync(process.execPath, [GATE], { cwd: tmp, encoding: 'utf8' });
    return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

(async () => {
  await test('(a) Nicht-OTC: echter Altbestand bleibt byte-identisch; Status, preserved und Zaehler feuern', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f-neu-01-'));
    try {
      const file = path.join(tmp, yahoo.safeSnapshotFilename('NOCCY'));
      const vorher = Buffer.from('{"meta":{"ticker":"NOCCY"},"alt":true}\n');
      fs.writeFileSync(file, vorher);
      const results = [];
      const snap = mapped({ regularMarketPrice: 100, marketCap: MCAP, exchangeName: 'NasdaqGS' });
      assert.equal(snap.meta._ccyMissingCompletely, true);
      assert.equal(yahoo.preserveSnapshotForMissingCurrency(snap, { ticker: 'NOCCY' }, tmp, results), true);
      assert.deepEqual(fs.readFileSync(file), vorher, 'Skip darf weder writeFileAtomic noch _removeStaleFiles erreichen');
      assert.equal(results[0].status, 'ccy-missing-completely');
      assert.equal(results[0].preserved, true, 'preserved traegt die ::warning::-Zeile (Nachzug h)');
      assert.ok(results.filter(r => r.status === 'ccy-missing-completely').length > 0);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  await test('(a2) ohne Altbestand meldet preserved=false, der Kanal feuert trotzdem', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f-neu-01-'));
    try {
      const results = [];
      const snap = mapped({ regularMarketPrice: 100, marketCap: MCAP, exchangeName: 'NasdaqGS' });
      assert.equal(yahoo.preserveSnapshotForMissingCurrency(snap, { ticker: 'NOCCY' }, tmp, results), true);
      assert.equal(results[0].preserved, false);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  await test('(b) leere Strings gelten als komplett fehlende Waehrung', () => {
    const snap = mapped({ currency: '   ', financialCurrency: '', marketCap: MCAP, exchangeName: 'NYSE' }, { financialCurrency: '\t' });
    assert.equal(snap.meta._ccyMissingCompletely, true);
    assert.equal(yahoo.preserveSnapshotForMissingCurrency(snap, { ticker: 'NOCCY' }, os.tmpdir(), []), true);
  });

  await test('(b2) Nachzug b: ohne brauchbaren marketCap schweigt der Kanal — der alte skipped-mcap-Loeschpfad bleibt zustaendig', () => {
    const ohneMcap = mapped({ regularMarketPrice: 100, exchangeName: 'NasdaqGS' });
    assert.equal(ohneMcap.meta._ccyMissingCompletely, true, 'Waehrung fehlt weiterhin komplett');
    assert.equal(ohneMcap.marketCap, null, 'duenne Yahoo-Antwort: kein marketCap');
    const results = [];
    assert.equal(yahoo.preserveSnapshotForMissingCurrency(ohneMcap, { ticker: 'NOCCY' }, os.tmpdir(), results), false);
    assert.equal(results.length, 0, 'kein Status, kein Zaehler — sonst faerbte jeder tote Ticker den Lauf rot');
    const mcapNull = mapped({ regularMarketPrice: 100, marketCap: null, exchangeName: 'NasdaqGS' });
    assert.equal(yahoo.preserveSnapshotForMissingCurrency(mcapNull, { ticker: 'NOCCY' }, os.tmpdir(), []), false);
    const mcapNaN = mapped({ regularMarketPrice: 100, marketCap: NaN, exchangeName: 'NasdaqGS' });
    assert.equal(yahoo.preserveSnapshotForMissingCurrency(mcapNaN, { ticker: 'NOCCY' }, os.tmpdir(), []), false);
  });

  await test('(c) nur financialCurrency fehlt: ccyAmbiguous bleibt, neuer Kanal schweigt', () => {
    const snap = mapped({ currency: 'EUR', marketCap: MCAP, exchangeName: 'XETRA' });
    assert.equal(snap.meta.ccyAmbiguous, true);
    assert.equal(snap.meta._ccyMissingCompletely, false);
    assert.equal(yahoo.preserveSnapshotForMissingCurrency(snap, { ticker: 'NOCCY' }, os.tmpdir(), []), false);
  });

  await test('(d) OTC alles-null: Kanal schweigt, F-NY-004-fxConversionFailed-Loeschpfad bleibt erreichbar', () => {
    const snap = mapped({ regularMarketPrice: 100, marketCap: MCAP, exchangeName: 'Other OTC' });
    assert.equal(snap.meta._ccyMissingCompletely, true);
    assert.equal(snap.meta.ccyAmbiguous, true, 'null-Waehrung: F-NY-004 greift nachweislich');
    assert.equal(yahoo.preserveSnapshotForMissingCurrency(snap, { ticker: 'NOCCY' }, os.tmpdir(), []), false);
    yahoo._convertSnapshotToUSD(snap);
    assert.equal(snap.meta.fxConversionFailed, true);
    assert.equal(snap.meta.fxConverted, false);
  });

  await test('(d2) Nachzug c: OTC mit Leerstring-Waehrungen — F-NY-004 greift NICHT, also feuert der Kanal', () => {
    const snap = mapped({ regularMarketPrice: 100, marketCap: MCAP, currency: '', financialCurrency: '', exchangeName: 'Other OTC' }, { financialCurrency: '' });
    assert.equal(snap.meta._ccyMissingCompletely, true);
    assert.equal(snap.meta.ccyAmbiguous, false, 'Leerstring ist nicht null — genau das Loch');
    // Beleg, dass F-NY-004 hier wirklich untaetig bleibt (sonst waere der Kanal ueberfluessig):
    const kopie = JSON.parse(JSON.stringify(snap));
    yahoo._convertSnapshotToUSD(kopie);
    assert.notEqual(kopie.meta.fxConversionFailed, true, 'ohne den neuen Kanal bliebe es beim stillen USD');
    assert.equal(yahoo.preserveSnapshotForMissingCurrency(snap, { ticker: 'NOCCY' }, os.tmpdir(), []), true);
  });

  await test('(e) Merge summiert n_ccy_missing_completely ueber Shards', () => {
    const merged = mergeManifests([
      { n_ok: 4, n_full: 2, n_priceonly: 2, n_failed: 0, n_ccy_missing_completely: 2 },
      { n_ok: 5, n_full: 1, n_priceonly: 4, n_failed: 0, n_ccy_missing_completely: 3 },
    ], 10, 2);
    assert.equal(merged.n_ccy_missing_completely, 5);
  });

  await test('(f) Sammel-Alarm-Gate: Feld >0 endet mit ::error:: am Zeilenanfang und Exit != 0', () => {
    const r = runGate({ n_ok: 1, n_total: 1, n_failed: 0, n_ccy_missing_completely: 2 });
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.out, /^::error::2 Ticker ohne jede Waehrungsangabe/m);
    assert.match(r.out, /Snapshots NICHT ueberschrieben, Altbestand bleibt/);
  });

  await test('(f2) Negativ-Kontrollen: Feld 0, Feld fehlt, Datei fehlt -> Exit 0 und kein ::error::', () => {
    for (const [name, inhalt] of [
      ['Feld 0', { n_ok: 1, n_total: 1, n_failed: 0, n_ccy_missing_completely: 0 }],
      ['Feld fehlt', { n_ok: 1, n_total: 1, n_failed: 0 }],
      ['Datei fehlt', null],
    ]) {
      const r = runGate(inhalt);
      assert.equal(r.status, 0, `${name}: ${r.out}`);
      assert.doesNotMatch(r.out, /::error::/, name);
    }
  });

  await test('(g) Verdrahtung: Skip liegt im echten processOne vor Konverter und Loeschpfaden', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'pull-yahoo.js'), 'utf8');
    const processStart = src.indexOf('async function processOne(stock)');
    const skip = src.indexOf('preserveSnapshotForMissingCurrency(canonical', processStart);
    const convert = src.indexOf('_convertSnapshotToUSDGuarded(canonical', processStart);
    assert.ok(processStart > 0 && skip > processStart && convert > skip, 'echter processOne-Skip muss vor Konverter/Loeschpfaden liegen');
  });

  // Nachzug (d): Waechter AM OBJEKT statt tautologischer Zustandspruefung. Der frueher
  // hier stehende Test blieb gruen, als das `return;` testweise entfernt wurde — die
  // Funktion meldete dann zwar weiter true, der Lauf lief aber trotzdem in Konverter
  // und Loeschpfad weiter. Dieser Waechter nagelt genau die Form fest.
  const SKIP_BLOCK = /\n {6}if \(preserveSnapshotForMissingCurrency\(canonical, stock, outputDir, results\)\) \{\n[\s\S]{0,300}?\n {8}return;\n {6}\}/;
  await test('(h) Objekt-Waechter: der Skip-Block in processOne traegt sein return; (Ausbau muss rot werden)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'pull-yahoo.js'), 'utf8').replace(/\r\n/g, '\n');
    const von = src.indexOf('const canonical = mapYahooToCanonical', src.indexOf('async function processOne(stock)'));
    const bis = src.indexOf('_convertSnapshotToUSDGuarded', von);
    assert.ok(von > 0 && bis > von, 'Block-Anker nicht gefunden');
    const block = src.slice(von, bis);
    assert.match(block, SKIP_BLOCK, 'if (preserveSnapshotForMissingCurrency(...)) { … return; } fehlt oder hat sein return; verloren');
    // Selbstprobe des Waechters: gueltige Form MUSS durchgehen, kaputte MUSS auffliegen.
    const gueltig = '\n      if (preserveSnapshotForMissingCurrency(canonical, stock, outputDir, results)) {\n        _log(\'INFO\', `x`);\n        return;\n      }\n';
    assert.match(gueltig, SKIP_BLOCK, 'Waechter wuerde die gueltige Form ablehnen');
    assert.doesNotMatch(gueltig.replace('        return;\n', ''), SKIP_BLOCK, 'Waechter merkt ein entferntes return; nicht');
    assert.doesNotMatch(gueltig.replace(/if \(preserveSnapshotForMissingCurrency[\s\S]*?\n {6}\}\n/, ''), SKIP_BLOCK, 'Waechter merkt einen entfernten Block nicht');
  });

  await test('(i) Objekt-Waechter: beide Manifest-Schreibpfade tragen n_ccy_missing_completely', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'pull-yahoo.js'), 'utf8');
    const incVon = src.indexOf('function writeManifestIncremental');
    assert.ok(incVon > 0, 'writeManifestIncremental nicht gefunden');
    const incBlock = src.slice(incVon, src.indexOf('\n  }', incVon));
    assert.match(incBlock, /n_ccy_missing_completely:/, 'inkrementelles Manifest zaehlt nicht mit');
    const finVon = src.indexOf('const slim = {', src.indexOf('async function processOne(stock)'));
    assert.ok(finVon > 0, 'finales Slim-Manifest nicht gefunden');
    const finBlock = src.slice(finVon, src.indexOf('\n', finVon));
    assert.match(finBlock, /n_ccy_missing_completely:/, 'finales Slim-Manifest zaehlt nicht mit');
  });

  console.log(`\nf-neu-01-ccy-ehrlichkeit: ${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail ? 1 : 0);
})();
