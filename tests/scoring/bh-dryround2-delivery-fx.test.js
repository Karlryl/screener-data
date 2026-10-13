'use strict';
/**
 * bh-dryround2-delivery-fx.test.js — Dry Round #2 Fund T2-1 (20.07.2026).
 *
 * deliveryIC (§4b) nahm rev0 aus dem t0-Vintage (Pull-FX von t0) und rev1 aus
 * dem ~180d spaeteren Vintage (Pull-FX von t1): fuer Nicht-USD-Reporter steckte
 * damit ~6 Monate FX-Drift im "realisierten" Umsatz-Delta (BH-108 dokumentiert
 * die Drift und weist den Konsum auf konsistenter FX-Basis rank-ic.js zu).
 * Fix: beide Werte aus DEMSELBEN Later-Vintage (ein Pull-FX); end0-Anker
 * bleibt PIT aus t0. Fehlt das end0-Quartal im Later-Vintage -> fail-loud
 * skippedNoBase, nie FX-gemischte Basis.
 */
const assert = require('node:assert/strict');
const ric = require('../../scripts/rank-ic.js');

// JPY-Szenario: Umsatz real flach (10 Mrd JPY). t0-Pull-FX 0.0070 -> 70M USD;
// t1-Pull-FX 0.0063 -> beide Quartale im Later-Vintage je 63M USD.
// Alt (FX-gemischt): 63/70-1 = -10% Schein-Schrumpfung. Neu: 63/63-1 = 0.
const mkRow = (ticker, score, revenueQ, revenueQEnds) => ({ ticker, score, pit: { revenueQ, revenueQEnds } });
const E0 = '2026-03-31', E1 = '2026-09-30'; // 183 Tage Abstand (im 150-210d-Band)

const rows0 = [];
const rowsL = [];
for (let k = 0; k < 12; k++) {
  const t = 'JP' + k;
  rows0.push(mkRow(t, 90 - k, [70 + k], [E0]));
  rowsL.push(mkRow(t, 0, [63 + k, 63 + k], [E1, E0])); // Later-Vintage: beide Quartale, EIN FX
}
const v0 = { cohort: { profitable: rows0, unprofitable: [] } };
const vL = { cohort: { profitable: rowsL, unprofitable: [] } };

const d = ric.deliveryIC(v0, vL);
assert.equal(d.n, 12, 'alle 12 Ticker messbar');
assert.equal(d.skippedNoBase, 0);
// Reales Delta ist fuer jeden Ticker exakt 0 (gleiches Quartalspaar im Later-Vintage).
// Mit der alten FX-gemischten Basis waere ys = 63+k/70+k - 1 != 0 gewesen.
// Wir pruefen das Delta direkt ueber einen Einzelfall:
const single0 = { cohort: { profitable: [mkRow('JP', 50, [70], [E0])].concat(rows0.slice(0, 9)), unprofitable: [] } };
void single0; // Spearman braucht n>=10 — Delta-Pruefung unten via ic-Eigenschaft:
// Bei ys identisch 0 fuer alle Ticker ist die Spearman-Korrelation degeneriert;
// entscheidend: kein Ticker liefert ein negatives Schein-Delta. Das machen wir
// ueber eine Variante sichtbar, in der ein echtes Wachstum nur im Later-Vintage
// steht und die Rangfolge exakt dem echten Delta folgen muss.
const rowsL2 = [];
for (let k = 0; k < 12; k++) {
  const t = 'JP' + k;
  rowsL2.push(mkRow(t, 0, [63 * (1 + k / 100), 63], [E1, E0])); // echtes Wachstum k% auf EINER FX-Basis
}
const d2 = ric.deliveryIC(v0, { cohort: { profitable: rowsL2, unprofitable: [] } });
assert.equal(d2.n, 12);
assert.ok(Math.abs(d2.ic - (-1)) < 1e-9, 'Score faellt mit k, echtes Delta steigt mit k -> IC exakt -1 (FX-frei): ' + d2.ic);

// end0-Quartal fehlt im Later-Vintage -> skippedNoBase, kein FX-Misch-Fallback.
const rowsL3 = rowsL.map((r) => ({ ...r, pit: { revenueQ: [63], revenueQEnds: [E1] } }));
const d3 = ric.deliveryIC(v0, { cohort: { profitable: rowsL3, unprofitable: [] } });
assert.equal(d3.n, 0);
assert.equal(d3.skippedNoBase, 12, 'fehlende FX-konsistente Basis wird ausgewiesen, nie gemischt');

console.log('PASS bh-dryround2-delivery-fx: eine FX-Basis, echtes Delta, fail-loud ohne Basis');
process.exit(0);
