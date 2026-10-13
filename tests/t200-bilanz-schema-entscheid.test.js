'use strict';
/**
 * tests/t200-bilanz-schema-entscheid.test.js — T200.
 *
 * DER BEFUND (Messung 2026-08-30, `agent-reports/t198-t200-messung-2026-08-30.md`, und am
 * Live-Bestand 2026-09-22 nachgemessen): die Bilanzreihe wurde allein nach der Zahl
 * "brauchbarer" Zeilen gewaehlt. Die aeltere quoteSummary-Reihe kann die Tag-211l-Felder
 * (currentAssets, currentLiabilities, totalLiabilities, accountsReceivable, netPPE)
 * strukturell nie tragen — ihr Zeilenbauer kennt die Schluessel nicht. Trug sie ueber
 * Cash/Debt/Assets genug Zeilen, gewann sie und nahm jeden currentAssets-Wert mit.
 * Gemessen: BLD und CWAN, je 4 Bilanzzeilen im Cache gegen 0 im Snapshot.
 *
 * Der Waechter FUEHRT die Produktionsregel AUS (`chooseAnnualBalance`), er baut sie nicht
 * nach — dieselbe Begruendung wie bei _nonNullCount/parseVollPullTicker (Fehlerklasse
 * F1334): ein Nachbau misst sich selbst.
 */
const assert = require('node:assert/strict');
const P = require('../pull-yahoo.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.message)); }
}

// quoteSummary-Zeile: NUR die drei Altfelder — genau das, was der Zeilenbauer erzeugen kann.
const qsRow = (i) => ({ totalCash: 100 + i, totalDebt: 200 + i, totalAssets: 300 + i });
// FTS-Zeile: dieselben Altfelder PLUS die Tag-211l-Klasse.
const ftsRow = (i) => ({
  totalCash: 100 + i, totalDebt: 200 + i, totalAssets: 300 + i,
  currentAssets: 400 + i, currentLiabilities: 500 + i, totalLiabilities: 600 + i,
  accountsReceivable: 700 + i, netPPE: 800 + i,
});

test('T200 das BLD/CWAN-Muster: die reichere FTS-Reihe gewinnt, auch ohne Zaehl-Vorsprung', () => {
  // Gleichstand 4:4 — unter der alten Regel (`neu > alt`) blieb quoteSummary stehen und
  // currentAssets war weg. Das ist der gemessene Total-Verlust.
  const gleich = P.chooseAnnualBalance([0, 1, 2, 3].map(qsRow), [0, 1, 2, 3].map(ftsRow));
  assert.equal(gleich.reason, 'schema-fts');
  assert.equal(gleich.rows[0].currentAssets, 400, 'currentAssets ueberlebt den Gleichstand nicht');
  // Und sogar bei Unterzahl: 4 quoteSummary-Zeilen gegen 2 FTS-Zeilen.
  const unterzahl = P.chooseAnnualBalance([0, 1, 2, 3].map(qsRow), [0, 1].map(ftsRow));
  assert.equal(unterzahl.reason, 'schema-fts');
  assert.equal(unterzahl.rows.length, 2);
  assert.equal(unterzahl.qsUsable, 4);
  assert.equal(unterzahl.ftsUsable, 2);
});

test('T200 BRUCHPROBE: ohne die Schema-Regel faellt genau dieser Fall wieder durch', () => {
  // Die alte Regel, hier als Orakel nachgestellt: sie haette bei 4:4 quoteSummary behalten.
  const alt = (qs, fts) => (fts.filter(Boolean).length > qs.filter(Boolean).length ? fts : qs);
  const qs = [0, 1, 2, 3].map(qsRow), fts = [0, 1, 2, 3].map(ftsRow);
  assert.equal(alt(qs, fts)[0].currentAssets, undefined,
    'das Orakel der alten Regel verliert currentAssets nicht mehr — dann misst dieser Test nichts');
  assert.equal(P.chooseAnnualBalance(qs, fts).rows[0].currentAssets, 400);
});

test('T200 die Zaehlung entscheidet unveraendert, wenn beide Reihen dieselbe Klasse tragen', () => {
  const mehrFts = P.chooseAnnualBalance([0, 1].map(ftsRow), [0, 1, 2].map(ftsRow));
  assert.equal(mehrFts.reason, 'count-fts');
  assert.equal(mehrFts.rows.length, 3);
  const mehrQs = P.chooseAnnualBalance([0, 1, 2].map(ftsRow), [0, 1].map(ftsRow));
  assert.equal(mehrQs.reason, 'count-qs', 'bei Ueberzahl der alten Reihe bleibt sie stehen');
  // Gleichstand ohne Schema-Unterschied: die alte Reihe behaelt den Vorrang (Vorverhalten).
  assert.equal(P.chooseAnnualBalance([0, 1].map(ftsRow), [0, 1].map(ftsRow)).reason, 'count-qs');
  // Und ohne 211l auf BEIDEN Seiten ebenso.
  assert.equal(P.chooseAnnualBalance([0, 1].map(qsRow), [0, 1].map(qsRow)).reason, 'count-qs');
});

test('T200 eine leere oder unbrauchbare FTS-Reihe verdraengt NIE eine gefuellte Reihe', () => {
  const qs = [0, 1, 2, 3].map(qsRow);
  for (const leer of [[], null, undefined, [null, null]]) {
    const r = P.chooseAnnualBalance(qs, leer);
    assert.equal(r.rows.length, 4, 'eine leere FTS-Reihe hat die gefuellte verdraengt: ' + JSON.stringify(leer));
    assert.equal(r.ftsUsable, 0);
  }
  // Der Spiegelfall: traegt nur die ALTE Reihe die Klasse, gewinnt sie (kein Rueckschritt).
  const nurQs = P.chooseAnnualBalance([0, 1].map(ftsRow), [0, 1, 2, 3].map(qsRow));
  assert.equal(nurQs.reason, 'schema-qs');
  assert.equal(nurQs.rows[0].currentAssets, 400);
});

test('T200 null-Platzhalter zaehlen nicht als brauchbar und werfen nicht', () => {
  // mapFTSToBalance schiebt explizite null-Zeilen ein (Jahres-Ausrichtung, F-001).
  const mitLuecken = [null, ftsRow(1), null, ftsRow(3)];
  const r = P.chooseAnnualBalance([0, 1, 2, 3].map(qsRow), mitLuecken);
  assert.equal(r.ftsUsable, 2, 'null-Platzhalter wurden mitgezaehlt');
  assert.equal(r.reason, 'schema-fts');
  assert.equal(r.rows.length, 4, 'die Reihe wird als GANZE uebernommen, Luecken inklusive');
});

test('T200 die Feldliste ist die des Produktionscodes, nicht eine Kopie im Test', () => {
  assert.deepEqual(P.BALANCE_TAG211L_FIELDS,
    ['currentAssets', 'currentLiabilities', 'totalLiabilities', 'accountsReceivable', 'netPPE']);
  // Jedes einzelne Feld muss den Schema-Zweig ausloesen koennen — sonst ist die Liste Zierde.
  for (const feld of P.BALANCE_TAG211L_FIELDS) {
    const nur = [{ totalCash: 1 }]; nur[0][feld] = 42;
    assert.equal(P.chooseAnnualBalance([qsRow(0), qsRow(1)], nur).reason, 'schema-fts',
      'das Feld ' + feld + ' loest den Schema-Zweig nicht aus');
  }
});

console.log(`\nt200-bilanz-schema-entscheid.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
