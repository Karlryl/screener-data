'use strict';
/** tests/rule40-guards.test.js — Standalone-Runner.
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

const W = require('../scripts/write-rule40-export.js');
const { snapshot, boardZeile, baueExport, quartalsreihe, laeufer } = require('./rule40-fixture.js');

const { test, bilanz } = laeufer();

/** Baut EIN Brett aus genau einer Zeile und sagt, ob sie es hineingeschafft hat. */
function laufMitEinerZeile(rowOver, snapOver, snapErsatz, reihe) {
  const f = baueExport([{
    row: boardZeile(Object.assign({ ticker: 'AAA', revGrowthYoYPct: 60 }, rowOver)),
    snap: snapErsatz !== undefined ? snapErsatz : snapshot(Object.assign({ fcfMarginTTM: 30 }, snapOver)),
    // reihe:false laesst die Quartalsreihe des Snapshots stehen, statt sie aus
    // revGrowthYoYPct neu zu bauen — noetig fuer jeden Test, der genau sie prueft.
    reihe,
  }]);
  let res = null, fehler = null;
  try {
    res = W.build({ v1Dir: f.v1Dir, snapshotsDir: f.snapshotsDir, outDir: f.outDir });
  } catch (e) { fehler = e; }
  f.aufraeumen();
  return { res, fehler };
}

/** Die Zeile muss durchkommen. */
function drin(rowOver, snapOver, snapErsatz, reihe) {
  const { res, fehler } = laufMitEinerZeile(rowOver, snapOver, snapErsatz, reihe);
  assert.equal(fehler, null, 'Build warf: ' + (fehler && fehler.message));
  assert.equal(res.rows, 1, 'Zeile fehlt im Brett, abgewiesen: ' + JSON.stringify(res.abgewiesen));
  return res;
}

/**
 * Die Zeile muss abgewiesen werden, und zwar mit GENAU diesem Grund. Ohne den Grund
 * bestuende der Test auch, wenn ein ganz anderer Waechter zufaellig zuerst greift.
 */
function abgewiesenWegen(grund, rowOver, snapOver, snapErsatz, reihe) {
  const { res, fehler } = laufMitEinerZeile(rowOver, snapOver, snapErsatz, reihe);
  // Kein Kandidat -> der Schreiber wirft (ein leeres Brett ist eine unbelegte Aussage).
  assert.ok(fehler, 'erwartet: Abweisung, bekommen: ein Brett');
  const zaehler = JSON.parse(fehler.message.slice(fehler.message.indexOf('{'), fehler.message.lastIndexOf('}') + 1));
  assert.equal(zaehler[grund], 1, 'erwartet Abweisung "' + grund + '", Zaehler: ' + JSON.stringify(zaehler));
}

// --- Basisquartal ----------------------------------------------------------
test('gesundes Basisquartal (0,95 eines Durchschnittsquartals) bleibt drin', () => {
  drin({}, { revenueTTM: 400e6, basisQ: 95e6 }, undefined, false);
});

test('Stub-Basisquartal (0,01 eines Durchschnittsquartals) fliegt raus', () => {
  // 2548.TW-Muster: 1,42 Mio. Basisquartal gegen 693 Mio. TTM.
  abgewiesenWegen('basisQuartalStub', {}, { revenueTTM: 400e6, basisQ: 1e6 }, undefined, false);
});

test('knapp ueber der Schwelle (0,26) bleibt drin, knapp darunter (0,24) nicht', () => {
  const avg = 400e6 / 4;
  drin({}, { revenueTTM: 400e6, basisQ: 0.26 * avg }, undefined, false);
  abgewiesenWegen('basisQuartalStub', {}, { revenueTTM: 400e6, basisQ: 0.24 * avg }, undefined, false);
});

test('ohne Quartalsreihe greift der Waechter nicht (der Jahres-Fallback hat kein Basisquartal)', () => {
  drin({}, { revenueQ: [] }, undefined, false);
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
test('frisches Quartalsende bleibt drin, ein jahrealtes fliegt raus', () => {
  // Der Anker ist revenueQEnds[0], NICHT fundamentalsAsOf: letzteres ist auf jedem
  // geprueften Snapshot byte-gleich mit fetchedAt und misst den ABRUF, nicht den Zeitraum
  // (Befund N5/E2 an LTC/PLTR/CRM/RYN/SII).
  drin({}, { revenueQEnds: ['2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'] });
  abgewiesenWegen('veraltet', {}, { revenueQEnds: ['2020-09-30', '2020-06-30', '2020-03-31', '2019-12-31', '2019-09-30'] });
});

test('ein Jahresmelder mit 241 Tagen Abstand bleibt drin (Meldekadenz, kein toter Datenstand)', () => {
  // Die neun Auslandsmelder, die N5/E2 als normal eingestuft hat: Geschaeftsjahresende
  // 2025-12-31 gegen generated_at 2026-09-17. MAX_FISCAL_AGE_DAYS darf sie nicht treffen.
  drin({}, { revenueQEnds: ['2025-12-31', '2025-09-30', '2025-06-30', '2025-03-31', '2024-12-31'] });
});

test('fundamentalsAsOf ist KEIN Waechter mehr (es misst den Abruf, nicht den Zeitraum)', () => {
  drin({}, { fundamentalsAsOf: '2019-01-01T00:00:00.000Z' });
});

test('ohne Quartalsenden zieht der Waechter die JAHRESreihe heran', () => {
  // Jahresmelder (revenueQ leer -> revGrowthLevel nimmt den Jahres-Fallback) haben trotzdem
  // einen Zeitraum. Frueher uebersprang der Waechter sie stillschweigend.
  drin({}, { revenueQEnds: [], annualRevEnds: ['2026-03-31', '2025-03-31', '2024-03-31'] });
  abgewiesenWegen('veraltet', {}, { revenueQEnds: [], annualRevEnds: ['2020-03-31', '2019-03-31'] });
});

test('ohne JEDEN Zeitraum wird nicht blind verworfen, aber gezaehlt', () => {
  const { res } = laufMitEinerZeile({}, { revenueQEnds: [] });
  assert.equal(res.rows, 1, 'die Zeile darf bleiben');
  assert.equal(res.abgewiesen.frischeUnbekannt, 1,
    'ohne Zaehler sieht "nicht pruefbar" aus wie "geprueft und in Ordnung"');
});

// --- Belegbarkeit ----------------------------------------------------------
test('Zeile ohne Rang (Belegbarkeits-Gate) kommt nicht ins Brett', () => {
  drin({ rankGrund: null });
  abgewiesenWegen('ohneRang', { rank: null, rankGrund: 'zuWenigBelegteAchsen' });
});

// --- Fehlende Quellen ------------------------------------------------------
test('eine Zeile ohne bildbares Wachstum wird gezaehlt, nicht geraten', () => {
  // Umsatz JA (sonst routet der Router sie als pre-revenue weg), aber nur EIN Jahr und
  // keine Quartale — revGrowthLevel hat dann kein Vorjahr und liefert null.
  abgewiesenWegen('keinWachstum', {}, { revenueQ: [], annualRev: [400e6] }, undefined, false);
});

test('ein Snapshot ohne Brett-Zeile ist trotzdem im Universum (der Sinn des gerouteten Wegs)', () => {
  const f = baueExport([
    { row: boardZeile({ ticker: 'AAA', revGrowthYoYPct: 60 }), snap: snapshot({ fcfMarginTTM: 30 }) },
  ]);
  // Ein zweiter Snapshot OHNE Zeile in irgendeinem Vollboard.
  const ohneBrett = snapshot({ fcfMarginTTM: 28, ticker: 'ZZZ', name: 'Zeta Inc' });
  require('./rule40-fixture.js').setzeWachstum(ohneBrett, 55);
  ohneBrett.meta.ticker = 'ZZZ';
  require('node:fs').writeFileSync(require('node:path').join(f.snapshotsDir, 'ZZZ.json'), JSON.stringify(ohneBrett));
  const res = W.build({ v1Dir: f.v1Dir, snapshotsDir: f.snapshotsDir, outDir: f.outDir });
  const o = JSON.parse(require('node:fs').readFileSync(require('node:path').join(f.outDir, 'overview.json'), 'utf8'));
  const zzz = o.rows.find((r) => r.ticker === 'ZZZ');
  f.aufraeumen();
  assert.equal(res.rows, 2, 'der Name ohne Brett-Zeile fehlt');
  assert.equal(zzz.onBoard, false);
  assert.equal(zzz.score, null, 'ohne Brett-Zeile gibt es keinen Engine-Score — eine 0 waere eine Behauptung');
  assert.equal(zzz.marketCap, null, 'ohne geprueften FX-Beleg bleibt marketCap null');
  assert.deepEqual(zzz.lamps, []);
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

bilanz('tests/rule40-guards.test.js');
