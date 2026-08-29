'use strict';
/**
 * Belegpunkte im findash-Export — Waechter zu Abhilfe A der Coverage-Akte
 * (agent-reports/befund-coverage-luege-2026-08-29.md, Orchestrator ENTSCHIED 20).
 *
 * DER BEFUND: `coverageAxes` (src/scoring/score.js, versiegelt) zaehlt "die Achsenfunktion
 * hat eine Zahl zurueckgegeben", nicht "wie viele Rohdatenpunkte standen dahinter". Die
 * meisten Achsen liefern schon ab ZWEI Punkten einen Wert. Ergebnis: eine Zeile kann
 * `coverageAxes: "7/7"` tragen und real auf zwei Quartalen ruhen — `7666.HK` tut das am
 * Vintage 2026-08-29 auf Rang 7 des health-care-Boards, und das Belegbarkeits-Gate
 * (RANK_MIN_AXES) laesst sie durch, weil es gegen genau diesen Zaehler prueft.
 *
 * WAS DIESER WAECHTER PINNT — beide Richtungen, wie beauftragt:
 *   (a) DUENNE ZEILE ZEIGT ES: bei zwei echten Quartalspunkten steht neben `"7/7"` jetzt
 *       `qPunkte: 2`. Ohne das Feld war die Behauptung unwiderlegbar.
 *   (b) BELEGTE ZEILE BLEIBT UNVERAENDERT: bei acht Quartalen steht `qPunkte: 8` — nichts
 *       wird markiert, nichts umsortiert, kein Score und kein Rang aendert sich. Ein
 *       Waechter, der nur Richtung (a) prueft, wuerde ein Feld durchwinken, das JEDE Zeile
 *       verdaechtigt.
 *
 * Der Waechter FUEHRT die Ableitung und die Mapper AUS (Seam: wx.belegPunkte /
 * wx.mapBoardRow), statt den Quelltext nach Schreibmustern abzusuchen.
 *
 * Usage:  node tests/belegpunkte.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
// M9: EIGENER Snapshot-Bestand, VOR dem require des Moduls gesetzt. Vorher legte dieser
// Waechter seine Fixture im produktiven snapshots/ ab — genau dem readdirSync, aus dem
// run-screener.js (:287/:411) das Universum und den universeHash baut. Ein Abbruch im
// Fenster bis zum unlinkSync hinterliess die Phantom-Firma "Beleg AG" im Universum.
const FIXTURE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'belegpunkte-'));
process.env.FINDASH_SNAPSHOTS_DIR = FIXTURE_DIR;
const wx = require('../scripts/write-findash-export.js');
const { safeSnapshotFilename } = require('../lib/snapshot-fs.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

const B = wx.belegPunkte;
// pull-yahoo serialisiert die Reihe als [{value}]; Enden sind ISO-Tage, neueste zuerst.
const q = (...werte) => werte.map((v) => ({ value: v }));

// ---------------------------------------------------------------------------
// RICHTUNG (a) — die duenne Zeile muss ihre Beleglage zeigen
// ---------------------------------------------------------------------------
check('(a) 7666.HK-Fall: zwei Quartale, ein Jahr auseinander -> qPunkte 2, Spanne 365', () => {
  // Exakt die im Befund reproduzierte Zeile: coverageAxes "7/7", pit.revenueQ zwei Werte,
  // revenueQEnds ["2025-12-31","2024-12-31"].
  const p = B({ revenueQ: q(498672.9, 65392.4), revenueQEnds: ['2025-12-31', '2024-12-31'] });
  assert.equal(p.qPunkte, 2, 'zwei echte Punkte muessen als 2 sichtbar werden');
  assert.equal(p.qSpanTage, 365, 'ein Jahr Abstand ist eine Jahres-, keine Quartals-Kadenz');
});

check('(a) Luecken zaehlen nicht mit: null/NaN sind keine Belege', () => {
  assert.equal(B({ revenueQ: q(10, null, 30, undefined, NaN) }).qPunkte, 2);
  assert.equal(B({ revenueQ: [] }).qPunkte, 0, 'leere Reihe IST gemessen: null Punkte');
});

// ---------------------------------------------------------------------------
// RICHTUNG (b) — die voll belegte Zeile bleibt unangetastet
// ---------------------------------------------------------------------------
check('(b) acht echte Quartale -> qPunkte 8, Spanne = 7 Quartale, nichts markiert', () => {
  const ends = ['2025-12-31', '2025-09-30', '2025-06-30', '2025-03-31',
    '2024-12-31', '2024-09-30', '2024-06-30', '2024-03-31'];
  const p = B({ revenueQ: q(8, 7, 6, 5, 4, 3, 2, 1), revenueQEnds: ends });
  assert.equal(p.qPunkte, 8);
  assert.equal(p.qSpanTage, 640, 'aeltestes bis juengstes Ende, ganze Tage');
});

check('(b) dieselbe Zeile mit und ohne Belegpunkte: Score, Rang, coverageAxes unberuehrt', () => {
  const roh = { ticker: 'ZZVOLLZZ', score: 88.2, track: 'profitable', lamps: ['x'], overview: null,
    name: 'Voll AG', coverageAxes: '7/7', coverageWeight: 1, cohortN: 424, cohortFallback: false };
  const zeile = wx.mapBoardRow(roh, 6);
  assert.equal(zeile.score, 88.2, 'Belegpunkte veraendern den Score nicht');
  assert.equal(zeile.rank, 7, 'und den Rang nicht');
  assert.equal(zeile.coverageAxes, '7/7', 'und die Coverage-Behauptung nicht');
  assert.equal(zeile.rankGrund, null, 'kein neues Gate, keine neue Entrangung');
});

// ---------------------------------------------------------------------------
// Ehrlichkeit der Abwesenheit: null heisst "nicht gemessen", nie "null Punkte"
// ---------------------------------------------------------------------------
check('kein Snapshot / keine Reihe -> null, KEINE erfundene 0', () => {
  assert.deepEqual(B(null), { qPunkte: null, qSpanTage: null }, 'kein Snapshot: nichts gemessen');
  assert.deepEqual(B({}), { qPunkte: null, qSpanTage: null }, 'keine revenueQ-Reihe: nichts gemessen');
  // Gegenprobe zur Abgrenzung: eine VORHANDENE, leere Reihe ist gemessen (0), s.o.
  assert.equal(B({ revenueQ: [] }).qPunkte, 0);
});

check('Punkte ohne Datumsanker: Anzahl zaehlt, Spanne bleibt null (A10-Nachzuegler)', () => {
  const p = B({ revenueQ: q(1, 2, 3), revenueQEnds: null });
  assert.equal(p.qPunkte, 3);
  assert.equal(p.qSpanTage, null, 'ohne Datum ist keine Spanne belegbar');
  assert.equal(B({ revenueQ: q(1, 2), revenueQEnds: [null, null] }).qSpanTage, null,
    'eine Reihe aus lauter null-Enden ist kein Datum');
});

check('Altform (blanke Zahlen statt {value}) wird mitgezaehlt', () => {
  assert.equal(B({ revenueQ: [1, 2, 3] }).qPunkte, 3);
});

// ---------------------------------------------------------------------------
// Verdrahtung: fuehren die Zeilen-Mapper die Ableitung wirklich aus?
// ---------------------------------------------------------------------------
const SNAP_DIR = FIXTURE_DIR;
const TESTTICKER = 'ZZBELEGZZ';
const TESTDATEI = path.join(SNAP_DIR, safeSnapshotFilename(TESTTICKER));

// M9-Wache: der produktive Bestand darf von diesem Waechter NIE beschrieben werden.
check('(M9) die Fixture liegt NICHT im produktiven snapshots/', () => {
  const produktiv = path.join(__dirname, '..', 'snapshots');
  assert.notEqual(path.resolve(SNAP_DIR), path.resolve(produktiv),
    'der Fixture-Bestand darf nicht der Produktiv-Bestand sein');
  assert.ok(!fs.existsSync(path.join(produktiv, safeSnapshotFilename(TESTTICKER))),
    'ZZBELEGZZ darf im produktiven Store nicht auftauchen — run-screener.js baut daraus sein Universum');
});
let fixtureGelegt = false;
try {
  fs.mkdirSync(SNAP_DIR, { recursive: true });
  fs.writeFileSync(TESTDATEI, JSON.stringify({
    meta: { ticker: TESTTICKER, name: 'Beleg AG' },
    timeseries: { revenueQ: q(4, 3, 2, 1), revenueQEnds: ['2025-12-31', '2025-09-30', '2025-06-30', '2025-03-31'] },
  }), 'utf8');
  fixtureGelegt = true;
} catch (e) {
  // N6: frueher ein ::warning:: mit `fail` unveraendert 0 — der Waechter endete mit
  // Exit 0, waehrend GENAU die drei Pruefungen entfielen, die die Commit-Message als
  // Bruchstelle ausweist (Mapper-Verdrahtung, "liest die Reihe wirklich",
  // Survival-Ausschluss). scripts/test-gate.js sah das nicht: sein SKIP-Detektor
  // verlangt 0 ok UND 0 fail, hier standen 6 ok. Seit M9 schreibt die Fixture in ein
  // mkdtemp-Verzeichnis — ein Fehlschlag ist damit kein legitimer Umweltzustand mehr,
  // sondern ein echter Defekt. Wer nicht messen kann, meldet das rot, nicht beilaeufig.
  fail++;
  console.error('FAIL   (N6) Fixture-Snapshot nicht schreibbar (' + e.message +
    ') — der Verdrahtungs-Durchgang wurde NICHT gemessen und darf nicht als gruen gelten.');
}

if (fixtureGelegt) {
  try {
    check('mapBoardRow traegt die echten Belegpunkte aus dem Snapshot', () => {
      const z = wx.mapBoardRow({ ticker: TESTTICKER, score: 50, track: 'profitable', lamps: [],
        overview: null, name: 'Beleg AG', coverageAxes: '7/7' }, 0);
      assert.equal(z.qPunkte, 4, 'der Mapper muss die Reihe wirklich lesen, nicht nur das Feld setzen');
      assert.equal(z.qSpanTage, 275);
    });
    check('mapOverviewRow traegt dieselbe Regel', () => {
      const o = wx.mapOverviewRow({ ticker: TESTTICKER, formulaId: 'x', track: 'profitable', score: 1,
        overviewKind: null, overviewValue: null, overviewCompanion: null, lamps: [] }, 0);
      assert.equal(o.qPunkte, 4);
      assert.equal(o.qSpanTage, 275);
    });
    check('mapSurvivalRow traegt sie NICHT (nie gescort, keine Coverage-Behauptung)', () => {
      const s = wx.mapSurvivalRow({ ticker: TESTTICKER, runwayQuarters: 4, lamps: [] }, 0);
      assert.ok(!('qPunkte' in s), 'survival-Zeilen haben keine Beleg-Behauptung zu stuetzen');
    });
  } finally {
    try { fs.rmSync(FIXTURE_DIR, { recursive: true, force: true }); } catch (_) { /* Fixture weg = gut */ }
  }
}

check('ohne Snapshot: Felder sind DA und null (nicht gemessen), nicht 0', () => {
  const z = wx.mapBoardRow({ ticker: 'ZZOHNESNAPZZ', score: 50, track: 'profitable', lamps: [],
    overview: null, name: 'Ohne AG' }, 0);
  assert.ok('qPunkte' in z && 'qSpanTage' in z, 'die Felder muessen auf jeder gescorten Zeile stehen');
  assert.equal(z.qPunkte, null);
  assert.equal(z.qSpanTage, null);
});

// ---------------------------------------------------------------------------
// --check: Form akzeptiert, Unsinn faellt auf, Abwesenheit bleibt legitim
// ---------------------------------------------------------------------------
check('--check nimmt die neuen Felder und faengt einen kaputten Zaehler', () => {
  const basis = { ticker: 'X', score: 1, rank: 1, track: 'profitable', lamps: [], overview: null,
    name: 'X', country: null, region: null, sector: null, marketCap: null, phase: null,
    mcapBand: null, ipoRecency: null, profitTier: null, ipoYear: null, cohortN: 1,
    cohortFallback: false, coverageAxes: '7/7' };
  let e = [];
  wx.validateBoardRow({ ...basis, qPunkte: 2, qSpanTage: 365 }, 'w', e);
  assert.equal(e.length, 0, 'saubere Zeile muss durchgehen: ' + e.join('; '));
  e = []; wx.validateBoardRow({ ...basis, qPunkte: null, qSpanTage: null }, 'w', e);
  assert.equal(e.length, 0, 'nicht gemessen ist ein legitimer Zustand');
  e = []; wx.validateBoardRow({ ...basis, qPunkte: 2.5 }, 'w', e);
  assert.ok(e.some((x) => /qPunkte/.test(x)), 'eine gebrochene Anzahl muss auffliegen');
  e = []; wx.validateBoardRow({ ...basis, qPunkte: -1 }, 'w', e);
  assert.ok(e.some((x) => /qPunkte/.test(x)), 'eine negative Anzahl muss auffliegen');
  e = []; wx.validateBoardRow({ ...basis, qSpanTage: 'GARBAGE' }, 'w', e);
  assert.ok(e.some((x) => /qSpanTage/.test(x)), 'eine kaputte Spanne muss auffliegen');
  e = []; wx.validateBoardRow(basis, 'w', e);
  assert.equal(e.length, 0, 'Abwesenheit bleibt legitim (Altbestands-Export darf nicht rot werden)');
});

console.log('\nbelegpunkte: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
