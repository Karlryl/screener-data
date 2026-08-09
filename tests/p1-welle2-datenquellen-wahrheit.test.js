'use strict';
/**
 * P1-Welle 2 (09.08.2026) — stille Loeschung/stille Ersetzung an der Datenquelle.
 *
 * Rot-zuerst am HEAD (Tag 614) belegt, jeder Test scheiterte vor dem Fix:
 *   F-CGPT-004/NRG-SK-001  fehlgeschlagenes unlink wurde verschluckt, der Ticker galt
 *                          als entfernt, der Altsnapshot lief weiter ins Scoring.
 *   F-CGPT-014             writeJsonAtomic schrieb NaN/Infinity ohne Opt-in als null.
 *   S4-SEC-004             eine SEC-Wartungsseite mit HTTP 200 ersetzte companyfacts.
 *   S4-SEC-002             bei gleichem Perioden-Ende gewann der zuerst gelesene
 *                          (= aeltere) Wert; `filed` blieb ungenutzt.
 *   AE-CI-004              leeres Small-Cap-Universum = erfolgreicher No-Op, die
 *                          Ausgabedatei alterte still weiter.
 *
 * Kein Netz, keine Frameworks. AE-CI-004 laeuft am ECHTEN Einstiegspunkt (run()),
 * nicht nur an der Wache — dort ist die Bugklasse rueckfaellig.
 * Run: node tests/p1-welle2-datenquellen-wahrheit.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const yahoo = require('../pull-yahoo.js');
const { writeJsonAtomic } = require('../lib/atomic-write.js');
const { validateCompanyfactsBody } = require('../pull-sec-xbrl.js');
const { annualConcept } = require('../merge-sec-xbrl.js');

// AE-CI-004 laeuft am Einstiegspunkt: SNAP/CACHE werden beim Modul-Load aus der
// Umgebung gelesen, deshalb MUSS das require danach kommen.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'p1w2-'));
const LEER = fs.mkdtempSync(path.join(TMP, 'leeres-universum-'));
process.env.SEC_SMALLCAP_SNAPSHOTS_DIR = LEER;
process.env.SEC_XBRL_CACHE_DIR = fs.mkdtempSync(path.join(TMP, 'seccache-'));
const smallcap = require('../scripts/build-secannual-smallcap.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.stack || e)); }
}
async function atest(name, fn) {
  try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.stack || e)); }
}

// ── F-CGPT-004 / NRG-SK-001 ────────────────────────────────────────────────────
// Wahrheits-Semantik: ein Ticker gilt nur dann als entfernt, wenn seine Dateien
// wirklich weg sind; sonst zaehlt der Lauf den Loeschfehler und meldet ihn.
test('F-CGPT-004/NRG-SK-001: fehlgeschlagenes unlink wird gemeldet und gezaehlt', () => {
  const dir = fs.mkdtempSync(path.join(TMP, 'unlink-'));
  const stale = path.join(dir, 'ALT.json'); fs.writeFileSync(stale, '{}');
  yahoo._resetSilentErrorCounts();
  const r = yahoo._removeStaleFiles([stale], 'ALT', () => { throw new Error('EPERM repro'); });
  assert.equal(r.length, 1, 'der Ticker darf nach fehlgeschlagenem Unlink nicht als sauber entfernt gelten');
  assert.equal(yahoo._silentErrorCounts().snapshotDelete, 1, 'der Loeschfehler fehlt im Laufzaehler');
  assert.ok(fs.existsSync(stale), 'die Repro-Datei muss den liegen gebliebenen Altbestand belegen');
});

// Gegenprobe: die gueltige Form muss DURCHGEHEN — ein Waechter, der immer meldet,
// waere genauso wertlos wie der verschluckte Fehler.
test('F-CGPT-004: erfolgreiche Loeschung meldet nichts und laesst nichts liegen', () => {
  const dir = fs.mkdtempSync(path.join(TMP, 'unlink-ok-'));
  const a = path.join(dir, 'A.json'); fs.writeFileSync(a, '{}');
  const fehlt = path.join(dir, 'GIBTESNICHT.json');
  yahoo._resetSilentErrorCounts();
  assert.deepEqual(yahoo._removeStaleFiles([a, fehlt], 'A'), []);
  assert.equal(yahoo._silentErrorCounts().snapshotDelete, 0);
  assert.ok(!fs.existsSync(a));
});

// ── F-CGPT-014 ─────────────────────────────────────────────────────────────────
// Wahrheits-Semantik: NaN/Infinity sind ein Rechenfehler und werden beim Schreiben
// laut abgewiesen; wer den JSON-Verlust bewusst will, sagt assertFinite:false.
test('F-CGPT-014: writeJsonAtomic verweigert NaN standardmaessig', () => {
  const p = path.join(fs.mkdtempSync(path.join(TMP, 'json-')), 'x.json');
  assert.throws(() => writeJsonAtomic(p, { broken: NaN }), /non-finite/);
  assert.ok(!fs.existsSync(p), 'ein stilles {"broken":null} wurde persistiert');
  writeJsonAtomic(p, { acceptedLoss: Infinity }, { assertFinite: false });
  assert.deepEqual(JSON.parse(fs.readFileSync(p, 'utf8')), { acceptedLoss: null }, 'explizites Opt-out muss moeglich bleiben');
  // echte nulls waren nie das Problem und muessen weiter durchgehen
  writeJsonAtomic(p, { leer: null, zahl: 0 });
  assert.deepEqual(JSON.parse(fs.readFileSync(p, 'utf8')), { leer: null, zahl: 0 });
});

// ── S4-SEC-004 ─────────────────────────────────────────────────────────────────
// Wahrheits-Semantik: nur ein parsbarer companyfacts-Koerper ersetzt den Cache;
// eine HTML-Wartungsseite mit Status 200 zaehlt als Fehler und laesst den Altstand.
test('S4-SEC-004: SEC-200-HTML wird vor der Persistenz abgewiesen', () => {
  assert.throws(() => validateCompanyfactsBody('<html>SEC maintenance</html>'), /invalid SEC companyfacts JSON/);
  assert.deepEqual(validateCompanyfactsBody('{"facts":{}}'), { facts: {} });
});

// ── S4-SEC-002 ─────────────────────────────────────────────────────────────────
// Wahrheits-Semantik: bei identischem Perioden-Ende gewinnt die SPAETER eingereichte
// Fassung (die Korrektur), unabhaengig von der Reihenfolge im SEC-Array.
const secZeile = (filed, accn, val) => ({ form: '10-K', fp: 'FY', fy: 2025, end: '2025-12-31', filed, accn, val });
test('S4-SEC-002: gleiches Periodenende nimmt die spaeter eingereichte Korrektur', () => {
  const vorwaerts = { Revenue: { units: { USD: [secZeile('2026-02-01', 'orig', 10), secZeile('2026-03-15', 'restated', 12)] } } };
  const r1 = annualConcept(vorwaerts, 'Revenue').get(2025);
  assert.equal(r1.val, 12, 'die Korrektur muss den Original-Filing-Wert schlagen');
  assert.equal(r1.accn, 'restated');
  // Gegenrichtung: ein naives "letzter gewinnt" waere hier falsch und faellt auf.
  const rueckwaerts = { Revenue: { units: { USD: [secZeile('2026-03-15', 'restated', 12), secZeile('2026-02-01', 'orig', 10)] } } };
  const r2 = annualConcept(rueckwaerts, 'Revenue').get(2025);
  assert.equal(r2.val, 12, 'die Array-Reihenfolge darf nicht ueber den Gewinner entscheiden');
  assert.equal(r2.accn, 'restated');
});

// ── AE-CI-004 ──────────────────────────────────────────────────────────────────
// Wahrheits-Semantik: ohne Universum gibt es kein Ergebnis — der Lauf faellt hart
// aus (Step rot), statt den No-Op als Erfolg zu tarnen; die Altdatei bleibt.
(async () => {
  await atest('AE-CI-004: leeres Small-Cap-Universum ist kein erfolgreicher No-Op (run())', async () => {
    assert.deepEqual(fs.readdirSync(LEER), [], 'Repro-Voraussetzung: das Universums-Verzeichnis ist leer');
    const OUT = path.join(__dirname, '..', 'external-data', 'sec-secannual-smallcap.json');
    const vorher = fs.existsSync(OUT) ? fs.statSync(OUT) : null;
    await assert.rejects(() => smallcap.run(), /Build fehlgeschlagen/,
      'der Lauf kehrte erfolgreich zurueck — genau so alterte sec-secannual-smallcap.json still weiter');
    if (vorher) {
      const nachher = fs.statSync(OUT);
      assert.equal(nachher.size, vorher.size, 'der Altbestand darf beim Fehlschlag nicht angefasst werden');
      assert.equal(nachher.mtimeMs, vorher.mtimeMs, 'der Altbestand wurde neu geschrieben');
    } else {
      console.log('  skip AE-CI-004 Altbestand-Check: ' + OUT + ' fehlt (sparse checkout)');
    }
  });
  test('AE-CI-004: die Wache selbst laesst ein vorhandenes Universum durch', () => {
    assert.doesNotThrow(() => smallcap.assertNonEmptyUniverse([{}]));
  });

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\nP1-Welle 2: ${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exitCode = fail ? 1 : 0;
})();
