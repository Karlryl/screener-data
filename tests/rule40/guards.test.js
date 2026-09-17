'use strict';
/** tests/rule40/guards.test.js — Standalone-Runner.
 *
 * DIE ZUSICHERUNG: jeder Waechter dieses Bretts schlaegt an, wenn er soll, UND schweigt,
 * wenn er nicht soll. Nur die erste Haelfte zu pruefen erzeugt Waechter, die alles
 * verwerfen; nur die zweite erzeugt Waechter, die nichts tun. Deshalb steht hier zu
 * jedem Guard ein Paar: EINE Zeile gesund, dieselbe Zeile mit genau EINEM gekippten Feld.
 *
 * WARUM ES DIESEN TEST GIBT: die Guards sind der einzige Grund, warum dieses Brett
 * einem Menschen gezeigt werden darf. Ohne sie fuehrte am Stand 2026-08-29 ein
 * Basisquartal von 1,42 Mio. gegen 693 Mio. TTM die Liste mit +29.049 % Wachstum an.
 */
const assert = require('node:assert/strict');

const W = require('../../scripts/write-rule40-export.js');
const { snapshot, boardZeile, baueExport, quartalsreihe, laeufer } = require('./fixture.js');

const { test, bilanz } = laeufer();

/** Baut EIN Brett aus genau einer Zeile und sagt, ob sie es hineingeschafft hat. */
function laufMitEinerZeile(rowOver, snapOver, snapErsatz) {
  const f = baueExport([{
    row: boardZeile(Object.assign({ ticker: 'AAA', revGrowthYoYPct: 60 }, rowOver)),
    snap: snapErsatz !== undefined ? snapErsatz : snapshot(Object.assign({ fcfMarginTTM: 30 }, snapOver)),
  }]);
  let res = null, fehler = null;
  try {
    res = W.build({ v1Dir: f.v1Dir, snapshotsDir: f.snapshotsDir, outDir: f.outDir });
  } catch (e) { fehler = e; }
  f.aufraeumen();
  return { res, fehler };
}

/** Die Zeile muss durchkommen. */
function drin(rowOver, snapOver, snapErsatz) {
  const { res, fehler } = laufMitEinerZeile(rowOver, snapOver, snapErsatz);
  assert.equal(fehler, null, 'Build warf: ' + (fehler && fehler.message));
  assert.equal(res.rows, 1, 'Zeile fehlt im Brett, abgewiesen: ' + JSON.stringify(res.abgewiesen));
  return res;
}

/**
 * Die Zeile muss abgewiesen werden, und zwar mit GENAU diesem Grund. Ohne den Grund
 * bestuende der Test auch, wenn ein ganz anderer Waechter zufaellig zuerst greift.
 */
function abgewiesenWegen(grund, rowOver, snapOver, snapErsatz) {
  const { res, fehler } = laufMitEinerZeile(rowOver, snapOver, snapErsatz);
  // Kein Kandidat -> der Schreiber wirft (ein leeres Brett ist eine unbelegte Aussage).
  assert.ok(fehler, 'erwartet: Abweisung, bekommen: ein Brett');
  const zaehler = JSON.parse(fehler.message.slice(fehler.message.indexOf('{'), fehler.message.lastIndexOf('}') + 1));
  assert.equal(zaehler[grund], 1, 'erwartet Abweisung "' + grund + '", Zaehler: ' + JSON.stringify(zaehler));
}

// --- Basisquartal ----------------------------------------------------------
test('gesundes Basisquartal (0,95 eines Durchschnittsquartals) bleibt drin', () => {
  drin({}, { revenueTTM: 400e6, basisQ: 95e6 });
});

test('Stub-Basisquartal (0,01 eines Durchschnittsquartals) fliegt raus', () => {
  // 2548.TW-Muster: 1,42 Mio. Basisquartal gegen 693 Mio. TTM.
  abgewiesenWegen('basisQuartalStub', {}, { revenueTTM: 400e6, basisQ: 1e6 });
});

test('knapp ueber der Schwelle (0,26) bleibt drin, knapp darunter (0,24) nicht', () => {
  const avg = 400e6 / 4;
  drin({}, { revenueTTM: 400e6, basisQ: 0.26 * avg });
  abgewiesenWegen('basisQuartalStub', {}, { revenueTTM: 400e6, basisQ: 0.24 * avg });
});

test('ohne Quartalsreihe greift der Waechter nicht (der Jahres-Fallback hat kein Basisquartal)', () => {
  drin({}, { revenueQ: [] });
});

// --- FCF-Marge -------------------------------------------------------------
test('gueltige FCF-Marge bleibt drin, unterdrueckte fliegt raus', () => {
  drin({}, { fcfMarginTTM: 30 });
  abgewiesenWegen('fcfUnterdrueckt', {}, { fcfMarginTTM: 30, fcfMarginTTMSuppressed: true });
});

test('fcfMarginValid-Vorzeichenwaechter (G2): positive TTM-Marge gegen negative FCF-Jahre fliegt raus', () => {
  abgewiesenWegen('fcfUngueltig', {}, { fcfMarginTTM: 30, annualFCF: [-50e6, -60e6, -70e6] });
});

test('FCF-Marge ueber dem Umsatz fliegt raus, knapp darunter bleibt drin', () => {
  drin({}, { fcfMarginTTM: 99 });
  abgewiesenWegen('fcfUeberUmsatz', {}, { fcfMarginTTM: 187.4 });   // KLEP.VI-Muster
});

// --- Einheiten -------------------------------------------------------------
test('Dezimal-statt-Prozent-Signatur fliegt raus, echt fast-flache Prozentwerte bleiben', () => {
  // Die Signatur aus 98290452c7: beide in (-1,1) UND Summe unter 1.
  abgewiesenWegen('einheitenVerdacht', { revGrowthYoYPct: 0.4 }, { fcfMarginTTM: 0.3 });
  // Gegenprobe der Funktion selbst: +0,8 % / +0,5 % ist echt fast flach, kein Einheitenfehler.
  assert.equal(W.einheitenVerdacht(0.8, 0.5), false);
  assert.equal(W.einheitenVerdacht(0.4, 0.3), true);
  assert.equal(W.einheitenVerdacht(0, 0), false, 'beide null ist kein Einheitenfehler');
});

test('ebitdaMargins wird als PROZENT genommen und nicht skaliert', () => {
  const res = drin({}, { fcfMarginTTM: 30, ebitdaMargins: 25 });
  assert.equal(res.rows, 1);
  const s = snapshot({ ebitdaMargins: 25 });
  assert.equal(W.ebitdaMargePct(s, 60), 25, 'der Wert muss roh durchgereicht werden');
});

test('sieht ebitdaMargins wie ein BRUCHTEIL aus, faellt nur die Zusatzspalte auf null', () => {
  const s = snapshot({ ebitdaMargins: 0.25 });
  assert.equal(W.ebitdaMargePct(s, 0.4), null, 'Bruchteil-Signatur muss die Spalte nullen');
  // r40 selbst haengt nicht daran: die Zeile bleibt im Brett.
  const res = drin({}, { fcfMarginTTM: 30, ebitdaMargins: 0.25 });
  assert.equal(res.rows, 1);
});

// --- Frische ---------------------------------------------------------------
test('frischer Fundamentalstand bleibt drin, ein halbes Jahr alter fliegt raus', () => {
  drin({}, { fundamentalsAsOf: '2026-09-01T00:00:00.000Z' });     // 16 Tage vor generated_at
  abgewiesenWegen('veraltet', {}, { fundamentalsAsOf: '2026-01-01T00:00:00.000Z' });
});

test('fehlender fundamentalsAsOf wirft die Zeile NICHT raus (nur ein NACHWEISLICH alter Stand)', () => {
  drin({}, { fundamentalsAsOf: null });
});

// --- Belegbarkeit ----------------------------------------------------------
test('Zeile ohne Rang (Belegbarkeits-Gate) kommt nicht ins Brett', () => {
  drin({ rankGrund: null });
  abgewiesenWegen('ohneRang', { rank: null, rankGrund: 'zuWenigBelegteAchsen' });
});

// --- Fehlende Quellen ------------------------------------------------------
test('fehlender Snapshot und fehlendes Wachstum werden gezaehlt, nicht geraten', () => {
  abgewiesenWegen('keinSnapshot', {}, undefined, null);
  abgewiesenWegen('keinWachstum', { revGrowthYoYPct: null });
});

// --- Winsorisierung --------------------------------------------------------
test('unter MIN_WINSOR_SAMPLE wird NICHT geklemmt (die Schranke waere die Zeile selbst)', () => {
  const res = drin({ revGrowthYoYPct: 60 }, { fcfMarginTTM: 30 });
  assert.equal(res.bounds, null);
});

test('ueber MIN_WINSOR_SAMPLE klemmt der Wachstumsterm den Ausreisser, r40 bleibt nachrechenbar', () => {
  const eintraege = [];
  for (let i = 0; i < W.MIN_WINSOR_SAMPLE + 50; i++) {
    eintraege.push({
      row: boardZeile({ ticker: 'T' + i, revGrowthYoYPct: 20 + (i % 40) }),
      snap: snapshot({ fcfMarginTTM: 30 }),
    });
  }
  // Ein Phantom, das jeden Waechter ausser der Winsorisierung passiert.
  eintraege.push({
    row: boardZeile({ ticker: 'PHANTOM', revGrowthYoYPct: 29049 }),
    snap: snapshot({ fcfMarginTTM: 30, revenueTTM: 400e6, basisQ: 95e6 }),
  });
  const f = baueExport(eintraege);
  const res = W.build({ v1Dir: f.v1Dir, snapshotsDir: f.snapshotsDir, outDir: f.outDir });
  const fs = require('node:fs'), path = require('node:path');
  const overview = JSON.parse(fs.readFileSync(path.join(f.outDir, 'overview.json'), 'utf8'));
  const p = overview.rows.find((r) => r.ticker === 'PHANTOM');
  assert.ok(res.bounds, 'ab MIN_WINSOR_SAMPLE muss es Schranken geben');
  assert.ok(p, 'die Zeile bleibt im Brett — nur ihr Wachstumsterm wird geklemmt');
  assert.equal(p.revGrowthYoYPct, 29049, 'der ROHE Wert reist unveraendert mit');
  assert.ok(p.revGrowthPctUsed < 200, 'der verwendete Term muss geklemmt sein, ist ' + p.revGrowthPctUsed);
  assert.ok(Math.abs((p.revGrowthPctUsed + p.fcfMarginPct) - p.r40) <= 0.11, 'r40 muss aufgehen');
  f.aufraeumen();
});

bilanz('tests/rule40/guards.test.js');
