'use strict';
/**
 * run-screener — loadUniverse Coverage-Floor (Court Phase A Runde 3, Fall C1).
 * Der Floor floort die GELADENE on-disk-Anzahl gegen eine SELF-BASELINE (der
 * zuletzt erfolgreich geladene on-disk-Count, High-Water in snapshots/
 * _last_good_disk.json) — NICHT mehr gegen manifest.n_ok (das war eine andere,
 * desynchronisierte Population: lokal akkumulierte Disk-Union vs. OK-Count des
 * letzten Pulls). Ein still geschrumpftes Universum (defekte/fehlende Snapshots)
 * MUSS den Lauf abbrechen statt lautlos die Kohorten-Perzentile zu verschieben.
 *
 * Usage:  node tests/scoring/run-screener.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assertCoverageFloor, COVERAGE_FLOOR_RATIO, nextHighWater, writeQualityFailedMarker, runQualityPass, clearStaleQualityIndex } = require('../../src/scoring/run-screener.js');
const wfe = require('../../scripts/write-findash-export.js'); // qualityExportMode (H-B)

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// --- floorRatio ist eine kalibrierte, benannte Konstante (keine Magic Number) --
test('COVERAGE_FLOOR_RATIO ist eine plausible Quote in (0,1]', () => {
  assert.ok(typeof COVERAGE_FLOOR_RATIO === 'number', 'muss number sein');
  assert.ok(COVERAGE_FLOOR_RATIO > 0 && COVERAGE_FLOOR_RATIO <= 1, 'in (0,1]');
  assert.ok(COVERAGE_FLOOR_RATIO >= 0.9, 'streng genug, um stilles Schrumpfen zu fangen');
});

// --- THROW: geladene Anzahl unter floorRatio * baseline ---------------------
test('throw, wenn loaded klar unter dem Floor (Universum geschrumpft ggue. Self-Baseline)', () => {
  const baseline = 4739;
  const belowFloor = Math.floor(COVERAGE_FLOOR_RATIO * baseline) - 1;
  assert.throws(() => assertCoverageFloor(belowFloor, baseline),
    /Coverage-Floor|geschrumpft|abgebrochen/i,
    'muss bei Unterschreitung lautstark werfen');
});

// --- PASS: geladene Anzahl auf/ueber dem Floor ------------------------------
test('kein throw, wenn loaded exakt auf dem Floor', () => {
  const baseline = 4739;
  const atFloor = Math.ceil(COVERAGE_FLOOR_RATIO * baseline);
  assert.doesNotThrow(() => assertCoverageFloor(atFloor, baseline));
});

test('kein throw, wenn loaded klar ueber dem Floor (heutiger Normalfall)', () => {
  assert.doesNotThrow(() => assertCoverageFloor(4681, 4739)); // 98.8% > 95%
});

// --- ROBUST: keine verwertbare Self-Baseline (Erstlauf) -> kein throw -------
test('kein throw, wenn Baseline fehlt/0/unbrauchbar (Erstlauf, fail-open)', () => {
  assert.doesNotThrow(() => assertCoverageFloor(10, 0));
  assert.doesNotThrow(() => assertCoverageFloor(10, null));
  assert.doesNotThrow(() => assertCoverageFloor(10, undefined));
  assert.doesNotThrow(() => assertCoverageFloor(10, NaN));
});

// --- C1-KERN: Self-Baseline heilt den Desync-Fehlabbruch --------------------
test('Self-Baseline: gesunder on-disk-Lauf wirft NICHT (gleiche Population)', () => {
  // Der alte Defekt verglich on-disk (z.B. 4681) gegen manifest.n_ok (volatil, z.B. 5016 aus einer
  // ANDEREN Pull-Population) -> ceil(0.95*5016)=4766 > 4681 -> FALSCH-Abbruch eines gesunden Laufs.
  // Mit Self-Baseline ist die Baseline der zuletzt-gesunde on-disk-Count (~ heutiger), also kein Sturz:
  assert.doesNotThrow(() => assertCoverageFloor(4681, 4681));
  assert.doesNotThrow(() => assertCoverageFloor(4700, 4681)); // gewachsen -> erst recht ok
});
test('Self-Baseline: ein ECHTER on-disk-Sturz (10000 -> 100) wirft weiterhin hart', () => {
  // Wenn die Self-Baseline 10000 war und jetzt nur 100 on-disk liegen, ist das echtes Schrumpfen:
  assert.throws(() => assertCoverageFloor(100, 10000), /Coverage-Floor|geschrumpft/i);
});

// --- High-Water (Self-Baseline) wird monoton angehoben, nie gesenkt ----------
test('nextHighWater: bei Wachstum anheben, bei Dip halten, Erstlauf = loaded', () => {
  assert.equal(nextHighWater(4681, 4700), 4700, 'gewachsen -> anheben');
  assert.equal(nextHighWater(4700, 4690), 4700, 'kleiner Dip (>Floor) -> High-Water halten, nicht senken');
  assert.equal(nextHighWater(null, 4681), 4681, 'Erstlauf (keine Baseline) -> Startwert');
  assert.equal(nextHighWater(0, 4681), 4681, 'leere/0-Baseline -> Startwert');
  assert.equal(nextHighWater(NaN, 4681), 4681, 'unbrauchbare Baseline -> Startwert');
});

// --- F11: QC-Fehl-Marker (explizites Fehlsignal statt stiller Abwesenheit) ----
// Der catch-Zweig von run() schreibt outputs/quality/_failed, wenn der QC-Pass wirft.
// So behandeln write-findash-export + Deploy den QC-Ausfall als Ausfall und reichen
// KEIN stales QC-Board weiter; der frische HG-Stand bleibt unberührt (fail-soft).
test('writeQualityFailedMarker: schreibt _failed mit reason+timestamp ins QC-Out-Dir (hermetisch)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-failed-'));
  const ok = writeQualityFailedMarker('scoreUniverse boom', tmp);
  assert.equal(ok, true, 'Marker best-effort geschrieben');
  const marker = JSON.parse(fs.readFileSync(path.join(tmp, '_failed'), 'utf8'));
  assert.equal(marker.reason, 'scoreUniverse boom', 'Grund festgehalten');
  assert.ok(typeof marker.at === 'string' && marker.at.length > 0, 'Zeitstempel gesetzt');
  fs.rmSync(tmp, { recursive: true, force: true });
});
test('writeQualityFailedMarker: leerer Grund -> "unknown", kein Crash', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-failed2-'));
  writeQualityFailedMarker(undefined, tmp);
  const marker = JSON.parse(fs.readFileSync(path.join(tmp, '_failed'), 'utf8'));
  assert.equal(marker.reason, 'unknown');
  fs.rmSync(tmp, { recursive: true, force: true });
});

// --- H-B (T3, nur lokale Laeufe): QC-Fehlstart darf keinen stalen index hinterlassen ---------
// runQualityPass schreibt index.json ZULETZT. Wirft es davor, bliebe lokal der index eines
// FRUEHEREN Erfolgs liegen; qualityExportMode prueft index ZUERST -> 'export' gewinnt ueber den
// frischen _failed-Marker -> alte Boards mit neuem generated_at re-exportiert (Ausfall maskiert).
// Fix (Variante A): runQualityPass raeumt den stalen index GANZ AM ANFANG. Hermetisch: ein echter
// QC-Fehlstart wird erzwungen, indem overview.json als VERZEICHNIS blockiert wird -> der
// overview-Write (vor dem index-Write) wirft deterministisch.
test('H-B: QC-Fehlstart nach Stale-Index -> Guard raeumt index -> mode=failed (nicht export)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-stale-'));
  // Vorlauf-Erfolg hinterliess einen index.json (+ ein Board):
  fs.writeFileSync(path.join(tmp, 'index.json'), JSON.stringify({ schema: 'quality/diagnostic-v1', boards: ['quality-x'] }));
  fs.writeFileSync(path.join(tmp, 'quality-x.json'), JSON.stringify({ profitable: [], unprofitable: [] }));
  assert.equal(wfe.qualityExportMode(tmp), 'export', 'Vorbedingung: ein stehen gebliebener index erzwingt OHNE Fix export');
  // Throw-Hebel: overview.json als Verzeichnis -> der overview-Write (vor index) wirft (EPERM/EISDIR).
  fs.mkdirSync(path.join(tmp, 'overview.json'));
  // run()-Fehlerpfad nachstellen: runQualityPass (raeumt zuerst den stalen index) wirft, catch schreibt Marker.
  let threw = false;
  try { runQualityPass([], 100, tmp); }
  catch (e) { threw = true; writeQualityFailedMarker(e && e.message, tmp); }
  assert.equal(threw, true, 'QC-Pass muss werfen (Fehlstart simuliert)');
  assert.equal(fs.existsSync(path.join(tmp, 'index.json')), false, 'Guard hat den stalen index entfernt');
  assert.equal(wfe.qualityExportMode(tmp), 'failed', 'Marker gewinnt jetzt -> Ausfall ehrlich ausgewiesen, kein Stale-Export');
  fs.rmSync(tmp, { recursive: true, force: true });
});

// --- Gegen-Test (Tag-343-Semantik darf NICHT kippen): Erfolgslauf schlaegt stalen _failed --------
// Ein ERFOLGREICHER QC-Pass nach einem Fehl-Lauf (stehen gebliebener _failed-Marker) muss weiterhin
// 'export' liefern: der frische index gewinnt ueber den stalen Marker. Der Guard raeumt NUR index,
// nie den Marker; der Erfolgslauf schreibt einen frischen index -> mode=export.
test('Gegen-Test: Erfolgslauf nach Fehl-Lauf -> export (frischer index schlaegt stalen _failed)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-succ-'));
  writeQualityFailedMarker('prior boom', tmp); // stale _failed eines Vorlaufs
  runQualityPass([], 100, tmp);                 // leeres Universum -> Pass laeuft durch, schreibt index.json
  assert.equal(fs.existsSync(path.join(tmp, 'index.json')), true, 'Erfolgslauf schrieb frischen index');
  assert.equal(fs.existsSync(path.join(tmp, '_failed')), true, 'stale _failed weiterhin da (Guard raeumt ihn NICHT)');
  assert.equal(wfe.qualityExportMode(tmp), 'export', 'frischer index gewinnt ueber stalen _failed (Tag-343 haelt)');
  fs.rmSync(tmp, { recursive: true, force: true });
});

// --- Guard-Robustheit: nie werfen, nur index.json betroffen ----------------------------------
test('clearStaleQualityIndex: idempotent, wirft nie, entfernt AUSSCHLIESSLICH index.json', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-guard-'));
  assert.doesNotThrow(() => clearStaleQualityIndex(tmp)); // kein index da -> no-op
  fs.writeFileSync(path.join(tmp, 'index.json'), '{}');
  fs.writeFileSync(path.join(tmp, 'overview.json'), '{}');
  fs.writeFileSync(path.join(tmp, 'quality-x.json'), '{}');
  fs.writeFileSync(path.join(tmp, '_failed'), '{}');
  clearStaleQualityIndex(tmp);
  assert.equal(fs.existsSync(path.join(tmp, 'index.json')), false, 'index.json entfernt');
  assert.equal(fs.existsSync(path.join(tmp, 'overview.json')), true, 'overview.json unberuehrt');
  assert.equal(fs.existsSync(path.join(tmp, 'quality-x.json')), true, 'Board unberuehrt');
  assert.equal(fs.existsSync(path.join(tmp, '_failed')), true, '_failed unberuehrt');
  assert.doesNotThrow(() => clearStaleQualityIndex(path.join(tmp, 'does-not-exist'))); // fehlendes Dir -> kein throw
  fs.rmSync(tmp, { recursive: true, force: true });
});

console.log(`run-screener.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
