// tests/fts-leading-empty-quarter.test.js — Standalone-Runner (framework-los).
// Run: node tests/fts-leading-empty-quarter.test.js
//
// WOFUER (06.09.2026, Worker 3, Master-Entscheid): Yahoo FTS liefert das NEUESTE Quartal zeitweise
// als Zeile mit Perioden-Ende, aber ohne Umsatz/GP/OpInc (nur Aktienzahl/EPS — CVCO 2026-06-30:
// 8 statt 39 Felder). mapFTSToQuarterly behielt die Zeile als Platzhalter (F-002 gilt INNEREN
// Nullzeilen), also stand revenueQ[0] = null: 305 Snapshots / 141 Board-Zeilen im CI-Artefakt
// 33967836117, marginTrajectory ehrlich null (BH-080), WB-4'-Klasse 4. Seit heute verwirft
// _dropLeadingEmptyQuarters(buendel, ni) einen fuehrenden komplett leeren Slot — Buendel UND
// Nettoergebnis-Reihe im Gleichschritt (Re-Review HIGH: ftsQuarterlyNI wird in _mergeQuarterBundle
// index-aligned gezippt), an BEIDEN Stellen (nach dem Fetch vor dem Cache-Write, auf jedem
// Cache-Treffer), je Lauf gezaehlt. Teil-Zeilen (irgendein Wert, auch NI) bleiben.
// Sabotage-Nachweis (Anker 06.09. N19): Helfer zu no-op -> P1/P4/P6 rot; Cache-Aufruf entfernt -> P7 rot.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const P = require('../pull-yahoo.js');
const W = require('../scripts/write-board-history.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message || e)); }
}
// FTS-Rows chronologisch aufsteigend (so kommen sie vom Anbieter); die Mapper drehen auf newest-first.
const row = (date, rev, gp, op, ni) => ({ date: new Date(date + 'T00:00:00Z'), totalRevenue: rev, grossProfit: gp, operatingIncome: op, netIncome: ni, periodType: '3M' });
const voll = [row('2025-09-30', 500, 120, 40, 30), row('2025-12-31', 580, 135, 54, 41), row('2026-03-31', 550, 127, 51, 38)];
const vals = (a) => a.map((x) => (x == null ? null : x.value));
// Wie an den Aufrufstellen: beide Mapper auf denselben Rows, dann der Helfer.
function gemappt(rows) {
  const b = P.mapFTSToQuarterly(rows);
  const ni = P._mapFTSQuarterlyNI(rows);
  const n = P._dropLeadingEmptyQuarters(b, ni);
  return { b, ni, n };
}

check('P1: fuehrende Zeile ohne Umsatz/GP/OpInc/NI wird verworfen — sechs Arrays und NI-Reihe im Gleichschritt, Zaehler 1', () => {
  const { b, ni, n } = gemappt([...voll, row('2026-06-30', null, null, null, null)]);
  assert.strictEqual(n, 1);
  assert.deepStrictEqual(vals(b.revenueQ), [550, 580, 500]);
  assert.deepStrictEqual(b.revenueQEnds, ['2026-03-31', '2025-12-31', '2025-09-30']);
  assert.deepStrictEqual(b.opIncQEnds, b.revenueQEnds);
  assert.deepStrictEqual(b.grossProfitQEnds, b.revenueQEnds);
  assert.deepStrictEqual(ni, [38, 41, 30]);
  assert.strictEqual(b.revenueQ.length, b.opIncQ.length);
  assert.strictEqual(b.revenueQ.length, b.grossProfitQ.length);
  assert.strictEqual(b.revenueQ.length, ni.length);
});
check('P2: fuehrende TEIL-Zeile (nur OpInc gemeldet) bleibt — sie ist Datum, kein Platzhalter', () => {
  const { b, n } = gemappt([...voll, row('2026-06-30', null, null, 49, null)]);
  assert.strictEqual(n, 0);
  assert.deepStrictEqual(vals(b.revenueQ), [null, 550, 580, 500]);
  assert.deepStrictEqual(vals(b.opIncQ), [49, 51, 54, 40]);
  assert.strictEqual(b.revenueQEnds[0], '2026-06-30');
});
check('P3: INNERE Nullzeile bleibt Platzhalter (F-002, Kalenderposition fuer YoY)', () => {
  const { b } = gemappt([row('2025-09-30', 500, 120, 40, 30), row('2025-12-31', null, null, null, null), row('2026-03-31', 550, 127, 51, 38)]);
  assert.deepStrictEqual(vals(b.revenueQ), [550, null, 500]);
  assert.deepStrictEqual(b.revenueQEnds, ['2026-03-31', '2025-12-31', '2025-09-30']);
});
check('P4: mehrere fuehrende leere Zeilen fallen alle (Zaehler 2); eine komplett leere Reihe bleibt Sache des hinteren Trims', () => {
  const { b, ni, n } = gemappt([...voll, row('2026-06-30', null, null, null, null), row('2026-09-30', null, null, null, null)]);
  assert.strictEqual(n, 2);
  assert.deepStrictEqual(b.revenueQEnds, ['2026-03-31', '2025-12-31', '2025-09-30']);
  assert.deepStrictEqual(ni, [38, 41, 30]);
  const leer = gemappt([row('2026-03-31', null, null, null, null), row('2026-06-30', null, null, null, null)]);
  assert.strictEqual(leer.b.revenueQ.length, 0);
  assert.strictEqual(leer.n, 0);
});
// Review 06.09. (silent-failure): P5 pinnt NICHT fuehrenderNullSlot (das tun wertgate-wb4strich A1-A7),
// sondern nur, dass der Uebergang „leerer Kopf -> Kopf verworfen" in KEINEM Arm von integritaetsVerfall
// als Verfall gilt — Arm (b) sieht zwei gefuellte Reihen, Arm (a) einen Achsen-Zuwachs, Arm (c) keine Lampe.
check('P5: der Uebergang leerer Kopf -> Kopf verworfen loest in integritaetsVerfall keinen Arm aus (Arm (b) bleibt scharf, Gegenprobe)', () => {
  const vorher = { ticker: 'CVCO', coverageAxes: '6/7', lamps: [], axisBreakdown: { marginTrajectory: null, gpGrowth: 1 },
    pit: { revenueQ: [null, { value: 550 }, { value: 580 }], revenueQEnds: ['2026-06-30', '2026-03-31', '2025-12-31'], grossProfitQ: [null, { value: 127 }, { value: 135 }], grossProfitQEnds: ['2026-06-30', '2026-03-31', '2025-12-31'] } };
  const nachher = { ticker: 'CVCO', coverageAxes: '7/7', lamps: [], axisBreakdown: { marginTrajectory: 0.4, gpGrowth: 1 },
    pit: { revenueQ: [{ value: 550 }, { value: 580 }], revenueQEnds: ['2026-03-31', '2025-12-31'], grossProfitQ: [{ value: 127 }, { value: 135 }], grossProfitQEnds: ['2026-03-31', '2025-12-31'] } };
  assert.strictEqual(W.integritaetsVerfall(vorher, nachher, {}), null);
  const kaputt = { ...nachher, pit: { ...nachher.pit, revenueQ: [null, null] } };
  assert.strictEqual(W.integritaetsVerfall(vorher, kaputt, {}), 'revenueQ gefuellt -> leer/null');
});
check('P6: ein gecachtes Buendel (vor dem Merge gemappt, mit und ohne Enden-Arrays, mit und ohne NI) verliert seinen leeren Kopf ueber den Helfer', () => {
  const mitEnden = { revenueQ: [null, { value: 550 }, { value: 580 }], opIncQ: [null, { value: 51 }, { value: 54 }], grossProfitQ: [null, { value: 127 }, { value: 135 }],
    revenueQEnds: ['2026-06-30', '2026-03-31', '2025-12-31'], grossProfitQEnds: ['2026-06-30', '2026-03-31', '2025-12-31'], opIncQEnds: ['2026-06-30', '2026-03-31', '2025-12-31'] };
  const ni = [null, 38, 41];
  assert.strictEqual(P._dropLeadingEmptyQuarters(mitEnden, ni), 1);
  assert.deepStrictEqual(vals(mitEnden.revenueQ), [550, 580]);
  assert.deepStrictEqual(mitEnden.revenueQEnds, ['2026-03-31', '2025-12-31']);
  assert.deepStrictEqual(ni, [38, 41]);
  const ohneEnden = { revenueQ: [null, { value: 550 }], opIncQ: [null, { value: 51 }], grossProfitQ: [null, { value: 127 }] };   // Cache vor A10, NI-Reihe leer
  assert.strictEqual(P._dropLeadingEmptyQuarters(ohneEnden, []), 1);
  assert.deepStrictEqual(vals(ohneEnden.revenueQ), [550]);
  assert.strictEqual(P._dropLeadingEmptyQuarters(ohneEnden, []), 0);   // idempotent
  assert.strictEqual(P._dropLeadingEmptyQuarters(null, []), 0);
  assert.strictEqual(P._dropLeadingEmptyQuarters(undefined, undefined), 0);
  assert.strictEqual(P._dropLeadingEmptyQuarters({ revenueQ: [null] }, [null]), 0);   // Laenge 1 bleibt
});
check('P7: der Helfer ist an BEIDEN Stellen verdrahtet — Cache-Treffer (nach dem Lesen der NI-Reihe) und Fetch-Zweig (vor dem Cache-Write) — jeweils mit Buendel UND NI', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'pull-yahoo.js'), 'utf8');
  const aufruf = /_ftsLeadingEmptyDropped \+= _dropLeadingEmptyQuarters\(ftsQuarterly, ftsQuarterlyNI\)/g;
  const c = src.indexOf('ftsQuarterlyNI = cached.payload.ftsQuarterlyNI || [];');
  assert.ok(c > 0, 'Cache-Treffer-Zuweisung der NI-Reihe nicht gefunden');
  assert.ok(aufruf.test(src.slice(c, c + 700)), 'Helfer im Cache-Zweig nicht (mit NI) aufgerufen');
  const f = src.indexOf('ftsQuarterlyNI = _mapFTSQuarterlyNI(fts.quarterlyFin);');
  assert.ok(f > 0, 'Fetch-Zweig-Zuweisung der NI-Reihe nicht gefunden');
  const w = src.indexOf('_writeFTSCache(cachePath', f);
  assert.ok(w > f, 'Cache-Write nach der NI-Zuweisung nicht gefunden');
  aufruf.lastIndex = 0;
  assert.ok(aufruf.test(src.slice(f, w)), 'Helfer im Fetch-Zweig nicht VOR dem Cache-Write (mit NI) aufgerufen');
});
check('P8: eine Kopfzeile MIT Nettoergebnis (Umsatz/GP/OpInc leer) ist Datum — sie bleibt, nichts rutscht', () => {
  const { b, ni, n } = gemappt([...voll, row('2026-06-30', null, null, null, 999)]);
  assert.strictEqual(n, 0);
  assert.strictEqual(b.revenueQEnds[0], '2026-06-30');
  assert.deepStrictEqual(ni, [999, 38, 41, 30]);
});
check('P9: nach dem Trim zippt _mergeQuarterBundle Nettoergebnis und Umsatz auf DIESELBE Periode (keine Verschiebung um ein Quartal)', () => {
  const { b, ni } = gemappt([...voll, row('2026-06-30', null, null, null, null)]);
  const merged = P._mergeQuarterBundle({ revenueQ: [], opIncQ: [], grossProfitQ: [], netIncomeQ: [] }, { ...b, netIncomeQ: ni.map((v) => (v != null ? { value: v } : null)) });
  assert.deepStrictEqual(vals(merged.revenueQ), [550, 580, 500]);
  assert.deepStrictEqual(vals(merged.netIncomeQ), [38, 41, 30]);
  assert.deepStrictEqual(merged.revenueQEnds, ['2026-03-31', '2025-12-31', '2025-09-30']);
});

if (fail) { console.log('FAIL: fts-leading-empty-quarter (' + fail + ')'); process.exit(1); }
console.log('OK: fts-leading-empty-quarter (06.09.2026)');
