'use strict';
/**
 * Nachtflags-Batch (2026-07-19) — zwei kleine, unabhaengige Fixes:
 *
 * 1) macro-regime.js: `--history <datei.json>` wurde ignoriert, sobald der Dateiname
 *    vom Standard-Legacy-Namen ('history.json') abwich — nur das Elternverzeichnis
 *    floss in den Shard/Legacy-Loader, der intern IMMER 'history.json' sucht. Ein
 *    explizit benannter Fixture-Pfad wurde also nie gelesen. Fix: weicht der Dateiname
 *    vom Standard ab, wird GENAU diese Datei gelesen (Default-Pfad unveraendert).
 * 2) write-findash-export.js buildQuality(): der 'failed'-Zweig raeumt den QC-Export-
 *    Ordner (qoutDir) vor dem Schreiben (Tag-349-Muster), der 'absent'-Zweig (kein
 *    quality/ vorhanden) tat das NICHT — ein QC-Board-Stand eines frueheren, erfolg-
 *    reichen Laufs blieb liegen und waere von validateQualityExport weiter als
 *    gueltig gelesen worden. Fix: 'absent' raeumt jetzt genauso wie 'failed'.
 *
 * Standalone runner (node <datei>, exit 0/1) — kein Netzzugriff, hermetische Tempdirs.
 * Run standalone: node tests/scoring/bh-nachtflags.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const MACRO_REGIME = path.join(ROOT, 'scripts', 'macro-regime.js');
const wfe = require('../../scripts/write-findash-export.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// ---- Fix 1: macro-regime.js --history <datei.json> muss GENAU diese Datei lesen ----
function makeSeries(n) {
  const out = [];
  const d = new Date('2024-01-01T00:00:00Z');
  for (let i = 0; i < n; i++) {
    out.push({ date: d.toISOString().slice(0, 10), close: 100 + i }); // steigend -> deterministisch BULL
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

test('macro-regime --history <custom.json>: liest die benannte Datei, nicht nur ihr Elternverzeichnis', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'macro-hist-'));
  // Koeder im selben Verzeichnis unter dem Standard-Legacy-Namen — kennt den Ticker NICHT.
  fs.writeFileSync(path.join(tmp, 'history.json'), JSON.stringify({ WRONG: makeSeries(5) }));
  // Die tatsaechlich uebergebene Datei traegt den echten Ticker mit genug Punkten fuer 1 Regime.
  const customFile = path.join(tmp, 'custom-history.json');
  fs.writeFileSync(customFile, JSON.stringify({ TESTX: makeSeries(205) }));
  const outFile = path.join(tmp, 'out.json');

  const r = spawnSync(process.execPath, [MACRO_REGIME, '--history', customFile, '--out', outFile, '--ticker', 'TESTX'],
    { encoding: 'utf8', timeout: 15000 });
  assert.equal(r.status, 0, 'CLI-Lauf muss exit 0 sein: ' + (r.stderr || r.stdout));

  const out = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  assert.equal(out.error, undefined, 'kein Fallback-Fehler — die genannte Datei muss gefunden worden sein');
  assert.equal(out.ticker, 'TESTX');
  const dates = Object.keys(out.regimes);
  assert.ok(dates.length > 0, 'regimes muss aus custom-history.json berechnet worden sein, nicht leer (Koeder-Bug)');
  assert.ok(out.regimeCounts.BULL >= 1, 'steigende Serie -> mind. 1 BULL-Regime');

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('macro-regime --history <default-name>: Standardpfad-Verhalten unveraendert (Shard/Legacy-Loader weiter aktiv)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'macro-hist-default-'));
  const legacyFile = path.join(tmp, 'history.json'); // Standard-Legacy-Name
  fs.writeFileSync(legacyFile, JSON.stringify({ TESTX: makeSeries(205) }));
  const outFile = path.join(tmp, 'out.json');

  const r = spawnSync(process.execPath, [MACRO_REGIME, '--history', legacyFile, '--out', outFile, '--ticker', 'TESTX'],
    { encoding: 'utf8', timeout: 15000 });
  assert.equal(r.status, 0, 'CLI-Lauf muss exit 0 sein: ' + (r.stderr || r.stdout));

  const out = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  assert.equal(out.error, undefined);
  assert.ok(Object.keys(out.regimes).length > 0, 'Legacy-Loader muss den Standardnamen weiterhin finden');

  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---- Fix 2: buildQuality() 'absent'-Zweig raeumt qoutDir wie 'failed' -------------------
test("buildQuality 'absent': raeumt ein stales export-qoutDir (Boards + index.json weg, nichts Neues geschrieben)", () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'qsrc-absent-')); // leer -> mode 'absent'
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'qout-absent-'));
  // qoutDir traegt noch den vollen Board-Satz eines frueheren erfolgreichen Laufs.
  fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify({ schema: wfe.SCHEMA, boards: ['quality-alpha'] }));
  fs.writeFileSync(path.join(out, 'alpha.json'), JSON.stringify({ schema: wfe.SCHEMA, branch: 'alpha' }));
  fs.writeFileSync(path.join(out, 'overview.json'), JSON.stringify({ schema: wfe.SCHEMA, rows: [] }));

  assert.equal(wfe.qualityExportMode(src), 'absent', 'Vorbedingung: leeres qualityDir = absent');

  const origWarn = console.warn; console.warn = () => {}; // ::warning:: nicht in stdout leaken
  let r;
  try { r = wfe.buildQuality(null, { qualityDir: src, qoutDir: out }); } finally { console.warn = origWarn; }

  assert.deepEqual(r, { boards: 0 });
  assert.ok(!fs.existsSync(path.join(out, 'index.json')), 'stales index.json muss weg sein');
  assert.ok(!fs.existsSync(path.join(out, 'alpha.json')), 'stale Board-Datei muss weg sein');
  assert.ok(!fs.existsSync(path.join(out, 'overview.json')), 'stale overview.json muss weg sein');
  assert.deepEqual(fs.readdirSync(out), [], 'qoutDir muss nach absent komplett leer sein — kein stales QC-Board');

  fs.rmSync(src, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true });
});

test("buildQuality 'absent': ohne vorherigen Export bleibt qoutDir einfach leer (kein Crash bei fehlendem qoutDir)", () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'qsrc-absent2-'));
  const out = path.join(os.tmpdir(), 'qout-absent2-' + Date.now()); // existiert noch NICHT

  const origWarn = console.warn; console.warn = () => {};
  let r;
  try { r = wfe.buildQuality(null, { qualityDir: src, qoutDir: out }); } finally { console.warn = origWarn; }

  assert.deepEqual(r, { boards: 0 });
  assert.ok(fs.existsSync(out), 'qoutDir wird angelegt (Tag-349-Muster: rmSync dann mkdirSync)');
  assert.deepEqual(fs.readdirSync(out), []);

  fs.rmSync(src, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true });
});

console.log(`\nbh-nachtflags.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
