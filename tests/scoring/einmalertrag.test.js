'use strict';
/**
 * Waechter fuer die Einmalertrags-Lampe (Tag 474).
 *
 * DER BEFUND: Zealand Pharma stand am 27.07.2026 auf Rang 1 der Uebersicht, Score 100,1, mit
 * SECHS Achsen ueber dem 99. Perzentil - Umsatzniveau 99,5 · Beschleunigung 99,7 ·
 * Rohertragswachstum 99,9 · Rule-of-X 99,9 · Kapitaleffizienz 99 · Verwaesserung 99,5.
 * Grundlage waren die Quartalsumsaetze 5 / 10 / 8 / 1.382 Mio. USD: ein einziger
 * Lizenzertrag, gebucht als Umsatz. Karl fiel das beim Draufschauen auf, dem Screener nicht.
 *
 * WARUM UEBER QUARTALE UND NICHT UEBER DIE JAHRESREIHE: ein echter Hypergrowth kann auch das
 * Fuenffache wachsen - aus der Jahresreihe allein sind beide Faelle nicht zu trennen. Der
 * Unterschied ist die WIEDERHOLBARKEIT, und die steht in den Quartalen.
 *
 * GEMESSEN am ausgelieferten Bestand des 27.07. (151 Zeilen mit vier verwertbaren Quartalen):
 * Median 0,301 · p90 0,374 · nur FUENF Zeilen ueber 0,50. Die Firmen, die Karl sehen WILL,
 * liegen alle im Normalbereich: CRDO 0,327 · ALAB 0,308 · BE 0,318 · NVDA 0,322 · PLTR 0,313.
 *
 * DIE LAMPE VERRECHNET NICHTS (nicht in DATA_SUSPECT_LAMPS): kein Score-, kein
 * Exclude-Effekt. Sie macht den Fall zuerst SICHTBAR; ob er den Score druecken soll, ist eine
 * eigene Frage mit Gauntlet-Pflicht.
 *
 * GEGENPROBE (durchgefuehrt): Schwelle entfernt -> die echten Wachstumsfirmen feuern mit und
 * der Test wird rot; Saison-Schutz entfernt -> der Einzelhandels-Fall wird rot.
 *
 * Usage:  node tests/scoring/einmalertrag.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const { einmalertrag, evaluateLamps } = require('../../src/scoring/lamps.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// revenueQ liegt newest-first. Baut einen Snapshot mit genau dieser Reihe.
const snap = (quartale) => ({ timeseries: { revenueQ: quartale.map((v) => (v === null ? null : { value: v })) } });

test('der echte Zealand-Fall feuert', () => {
  // Die Zahlen aus dem ausgelieferten Stand vom 27.07., in Mio. USD.
  assert.equal(einmalertrag(snap([1382, 8, 10, 5])), true);
});

test('der echte ABUS-Fall feuert', () => {
  assert.equal(einmalertrag(snap([179, 1, 1, 11])), true);
});

test('die Firmen, die Karl sehen will, feuern NICHT', () => {
  // Echte Quartalsreihen vom 27.07. - faellt einer dieser Faelle, ist die Lampe unbrauchbar,
  // weil sie genau die Namen trifft, um die es Karl geht.
  const echte = {
    CRDO: [437, 407, 268, 223],
    ALAB: [308, 271, 231, 192],
    BE: [751, 778, 519, 401],
    NVDA: [81615, 68127, 57006, 46743],
    PLTR: [1633, 1407, 1181, 1004],
    CELH: [783, 722, 725, 739],
    DAVE: [158, 164, 151, 132],
  };
  for (const [name, q] of Object.entries(echte)) {
    assert.equal(einmalertrag(snap(q)), false, `${name} darf nicht feuern`);
  }
});

test('vier gleich grosse Quartale feuern nie', () => {
  assert.equal(einmalertrag(snap([100, 100, 100, 100])), false);
});

test('genau an der Schwelle feuert es, knapp darunter nicht', () => {
  // 50 % heisst: ein Quartal traegt so viel wie die anderen drei zusammen.
  assert.equal(einmalertrag(snap([100, 40, 30, 30])), true, 'genau 0,50 muss feuern');
  assert.equal(einmalertrag(snap([99, 40, 31, 30])), false, 'knapp darunter darf nicht feuern');
});

test('Saison feuert NICHT - dasselbe Quartal dominiert auch im Vorjahr', () => {
  // Einzelhaendler mit Weihnachtsgeschaeft: Q4 ist beide Jahre das groesste, jeweils ueber
  // der Schwelle. Das ist keine Einmalzahlung, sondern das Geschaeftsmodell.
  assert.equal(einmalertrag(snap([600, 200, 100, 100, 580, 190, 95, 95])), false);
});

test('ein Ausreisser OHNE Vorjahres-Entsprechung feuert trotz acht Quartalen', () => {
  // Dieselbe Laenge, aber im Vorjahr war die Verteilung normal -> echter Einmaleffekt.
  assert.equal(einmalertrag(snap([600, 200, 100, 100, 110, 105, 100, 95])), true);
});

test('dominiert im Vorjahr ein ANDERES Quartal, ist es kein Saisonmuster', () => {
  assert.equal(einmalertrag(snap([600, 200, 100, 100, 95, 580, 190, 95])), true);
});

test('unvollstaendige oder unbrauchbare Reihen ergeben null, nicht false', () => {
  // "Nicht bewertbar" ist etwas anderes als "sauber" - eine Lampe, die bei fehlenden Daten
  // Entwarnung gibt, ist schlimmer als keine.
  assert.equal(einmalertrag(snap([100, 100, 100])), null, 'nur drei Quartale');
  assert.equal(einmalertrag(snap([100, null, 100, 100])), null, 'Luecke in den letzten vier');
  assert.equal(einmalertrag(snap([100, 0, 100, 100])), null, 'Nullquartal ist kein Umsatz');
  assert.equal(einmalertrag(snap([100, -5, 100, 100])), null, 'negativer Umsatz');
  assert.equal(einmalertrag(snap([])), null, 'leere Reihe');
  assert.equal(einmalertrag({}), null, 'kein timeseries-Container');
});

test('eine Luecke im VORJAHR laesst den Verdacht stehen, statt ihn wegzuraten', () => {
  // Ohne vollstaendiges Vorjahr kann Saison nicht ausgeschlossen werden - dann bleibt es
  // beim Verdacht. Der umgekehrte Weg (Entwarnung bei fehlenden Daten) waere gefaehrlich.
  assert.equal(einmalertrag(snap([600, 200, 100, 100, 580, null, 95, 95])), true);
});

test('die Lampe ist registriert und laeuft im normalen Durchlauf mit', () => {
  const r = evaluateLamps(snap([1382, 8, 10, 5]));
  assert.ok('einmalertrag' in r.flags, 'Lampe fehlt in der Auswertung');
  assert.ok(r.active.includes('einmalertrag'), 'Lampe steht nicht in der aktiven Liste');
});

test('die Lampe druckt den Score NICHT - sie ist keine data-suspect-Lampe', () => {
  // Der entscheidende Punkt fuer diesen Schritt: sichtbar machen, nichts verrechnen.
  // Sonst waeren morgen frueh alle Scores verschoben und das Wert-Gate schluege an.
  const { einmalertrag: _, ...rest } = require('../../src/scoring/lamps.js').LAMPS;
  assert.ok(rest, 'LAMPS lesbar');
  const score = require('../../src/scoring/score.js');
  assert.ok(!String(score.DATA_SUSPECT_LAMPS || '').includes('einmalertrag'),
    'einmalertrag darf NICHT in DATA_SUSPECT_LAMPS stehen');
});

console.log(`\neinmalertrag: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
