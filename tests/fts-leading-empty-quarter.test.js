// tests/fts-leading-empty-quarter.test.js — Standalone-Runner (framework-los).
// Run: node tests/fts-leading-empty-quarter.test.js
//
// WOFUER (06.09.2026, Worker 3, Master-Entscheid): Yahoo FTS liefert das NEUESTE Quartal zeitweise
// als Zeile mit Perioden-Ende, aber ohne Umsatz/GP/OpInc (nur Aktienzahl/EPS — CVCO 2026-06-30:
// 8 statt 39 Felder). mapFTSToQuarterly behielt die Zeile als Platzhalter (F-002 gilt INNEREN
// Nullzeilen), also stand revenueQ[0] = null: 305 Snapshots / 141 Board-Zeilen im CI-Artefakt
// 33967836117, marginTrajectory ehrlich null (BH-080), WB-4'-Klasse 4. Seit heute wird ein
// fuehrender komplett leerer Slot verworfen und je Lauf gezaehlt; Teil-Zeilen bleiben.
// Sabotage-Nachweis (Anker 06.09. N16): shift-Schleife entfernt -> P1 rot.
'use strict';
const assert = require('assert');
const P = require('../pull-yahoo.js');
const W = require('../scripts/write-board-history.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message || e)); }
}
// FTS-Rows chronologisch aufsteigend (so kommen sie vom Anbieter); der Mapper dreht auf newest-first.
const row = (date, rev, gp, op) => ({ date: new Date(date + 'T00:00:00Z'), totalRevenue: rev, grossProfit: gp, operatingIncome: op, periodType: '3M' });
const voll = [row('2025-09-30', 500, 120, 40), row('2025-12-31', 580, 135, 54), row('2026-03-31', 550, 127, 51)];
const vals = (a) => a.map((x) => (x == null ? null : x.value));

check('P1: fuehrende Zeile ohne Umsatz/GP/OpInc wird verworfen, Enden im Gleichschritt, Zaehler +1', () => {
  P._resetFtsLeadingEmptyTally();
  const b = P.mapFTSToQuarterly([...voll, row('2026-06-30', null, null, null)]);
  assert.deepStrictEqual(vals(b.revenueQ), [550, 580, 500]);
  assert.deepStrictEqual(b.revenueQEnds, ['2026-03-31', '2025-12-31', '2025-09-30']);
  assert.deepStrictEqual(b.opIncQEnds, b.revenueQEnds);
  assert.deepStrictEqual(b.grossProfitQEnds, b.revenueQEnds);
  assert.strictEqual(b.revenueQ.length, b.opIncQ.length);
  assert.strictEqual(b.revenueQ.length, b.grossProfitQ.length);
  assert.deepStrictEqual(P._ftsLeadingEmptyTally(), { dropped: 1 });
});
check('P2: fuehrende TEIL-Zeile (nur OpInc gemeldet) bleibt — sie ist Datum, kein Platzhalter', () => {
  P._resetFtsLeadingEmptyTally();
  const b = P.mapFTSToQuarterly([...voll, row('2026-06-30', null, null, 49)]);
  assert.deepStrictEqual(vals(b.revenueQ), [null, 550, 580, 500]);
  assert.deepStrictEqual(vals(b.opIncQ), [49, 51, 54, 40]);
  assert.strictEqual(b.revenueQEnds[0], '2026-06-30');
  assert.deepStrictEqual(P._ftsLeadingEmptyTally(), { dropped: 0 });
});
check('P3: INNERE Nullzeile bleibt Platzhalter (F-002, Kalenderposition fuer YoY)', () => {
  const b = P.mapFTSToQuarterly([row('2025-09-30', 500, 120, 40), row('2025-12-31', null, null, null), row('2026-03-31', 550, 127, 51)]);
  assert.deepStrictEqual(vals(b.revenueQ), [550, null, 500]);
  assert.deepStrictEqual(b.revenueQEnds, ['2026-03-31', '2025-12-31', '2025-09-30']);
});
check('P4: mehrere fuehrende leere Zeilen fallen alle; eine komplett leere Reihe wird nicht zu -1 (Laenge >= 1 bleibt beim Trim vorne, hinten wie bisher)', () => {
  P._resetFtsLeadingEmptyTally();
  const b = P.mapFTSToQuarterly([...voll, row('2026-06-30', null, null, null), row('2026-09-30', null, null, null)]);
  assert.deepStrictEqual(b.revenueQEnds, ['2026-03-31', '2025-12-31', '2025-09-30']);
  assert.deepStrictEqual(P._ftsLeadingEmptyTally(), { dropped: 2 });
  const leer = P.mapFTSToQuarterly([row('2026-03-31', null, null, null), row('2026-06-30', null, null, null)]);
  assert.strictEqual(leer.revenueQ.length, 0);   // hinterer Trim (bestehend) raeumt komplett leere Reihen
});
check('P5: WB-4\' sieht im Vintage-Vergleich KEINEN Verfall — Kopf zurueck auf das letzte gemeldete Quartal, Achse marginTrajectory kommt wieder', () => {
  // Vorher (Vintage 05.09.): Slot 2026-06-30 leer, marginTrajectory null (6/7). Nachher: Slot weg, 7/7.
  const vorher = { ticker: 'CVCO', coverageAxes: '6/7', lamps: [], axisBreakdown: { marginTrajectory: null, gpGrowth: 1 },
    pit: { revenueQ: [null, { value: 550 }, { value: 580 }], revenueQEnds: ['2026-06-30', '2026-03-31', '2025-12-31'], grossProfitQ: [null, { value: 127 }, { value: 135 }], grossProfitQEnds: ['2026-06-30', '2026-03-31', '2025-12-31'] } };
  const nachher = { ticker: 'CVCO', coverageAxes: '7/7', lamps: [], axisBreakdown: { marginTrajectory: 0.4, gpGrowth: 1 },
    pit: { revenueQ: [{ value: 550 }, { value: 580 }], revenueQEnds: ['2026-03-31', '2025-12-31'], grossProfitQ: [{ value: 127 }, { value: 135 }], grossProfitQEnds: ['2026-03-31', '2025-12-31'] } };
  assert.strictEqual(W.integritaetsVerfall(vorher, nachher, {}), null);
  // Gegenprobe: dieselbe Funktion feuert weiterhin, wenn eine gefuellte Reihe wirklich leer wird.
  const kaputt = { ...nachher, pit: { ...nachher.pit, revenueQ: [null, null] } };
  assert.strictEqual(W.integritaetsVerfall(vorher, kaputt, {}), 'revenueQ gefuellt -> leer/null');
});

if (fail) { console.log('FAIL: fts-leading-empty-quarter (' + fail + ')'); process.exit(1); }
console.log('OK: fts-leading-empty-quarter (06.09.2026)');
