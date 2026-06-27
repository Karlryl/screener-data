'use strict';
/**
 * Engine Schicht 3 — Lampen-Test. Warn-Flags gegen echte BE/NVTS/CRDO-Snapshots
 * + Synthetik. Kernpunkt: Lampen sind reine Warnungen, Turnarounds (BE/CRDO)
 * werden NICHT als FCF-Artefakt fehl-geflaggt.
 *
 * Usage:  node tests/scoring/lamps.test.js   (Exit 0 gruen / 1 Fehler)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../../src/scoring/lamps.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}
function snap(t) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'snapshots', t + '.json'), 'utf8'));
}
const BE = snap('BE'), NVTS = snap('NVTS'), CRDO = snap('CRDO');

// --- fcfArtefact: NUR echtes Artefakt, NICHT Turnarounds --------------------
test('fcfArtefact: NVTS true (+108% bei neg. juengstem Jahr)', () => {
  assert.equal(L.fcfArtefact(NVTS), true);
});
test('fcfArtefact: BE false (Turnaround, juengstes FCF-Jahr positiv)', () => {
  assert.equal(L.fcfArtefact(BE), false);
});
test('fcfArtefact: CRDO false (Turnaround, juengstes Jahr +29M)', () => {
  assert.equal(L.fcfArtefact(CRDO), false);
});

// --- unprofit / burning -----------------------------------------------------
test('unprofit: BE false (jetzt profitabel), NVTS true', () => {
  assert.equal(L.unprofit(BE), false);
  assert.equal(L.unprofit(NVTS), true);
  assert.equal(L.unprofit(CRDO), false);
});
test('burning: BE false (juengstes FCF +57M), NVTS true', () => {
  assert.equal(L.burning(BE), false);
  assert.equal(L.burning(NVTS), true);
});

// --- crashRisk (Beta) -------------------------------------------------------
test('crashRisk: BE true (Beta 3.7 > 2.5)', () => {
  assert.equal(L.crashRisk(BE), true);
});
test('crashRisk: kein Beta -> null', () => {
  assert.equal(L.crashRisk({ metrics: {} }), null);
});

// --- highDilution -----------------------------------------------------------
test('highDilution: CRDO true (SBC/Rev 0.177 > 0.15), BE false (0.069)', () => {
  assert.equal(L.highDilution(CRDO), true);
  assert.equal(L.highDilution(BE), false);
});
test('highDilution: kein SBC -> null', () => {
  assert.equal(L.highDilution({ annual: { annualSBC: [] } }), null);
});

// --- shortRunway (synthetisch) ----------------------------------------------
test('shortRunway: brennend + wenig Cash -> true', () => {
  const s = { annual: { annualFCF: [{ value: -400 }], annualBalance: [{ totalCash: 200 }] } };
  assert.equal(L.shortRunway(s), true); // 200 / (400/4=100) = 2 Quartale < 8
});
test('shortRunway: cash-generierend -> false', () => {
  assert.equal(L.shortRunway({ annual: { annualFCF: [{ value: 50 }], annualBalance: [{ totalCash: 10 }] } }), false);
});
test('shortRunway: kein FCF -> null', () => {
  assert.equal(L.shortRunway({ annual: {} }), null);
});

// --- arDivergence (synthetisch) ---------------------------------------------
test('arDivergence: AR waechst viel schneller als Umsatz -> true', () => {
  const s = { annual: { annualRev: [{ value: 110 }, { value: 100 }],
    annualBalance: [{ accountsReceivable: 150 }, { accountsReceivable: 100 }] } };
  assert.equal(L.arDivergence(s), true); // AR +50% vs Rev +10%
});

// --- lowRoic (synthetisch) --------------------------------------------------
test('lowRoic: schwacher OpInc/Invested -> true', () => {
  const s = { annual: { annualOpInc: [{ value: 1 }],
    annualBalance: [{ totalAssets: 1000, currentLiabilities: 0 }] } };
  assert.equal(L.lowRoic(s), true); // 1/1000 = 0.001 < 0.09
});

// --- evaluateLamps Aggregat -------------------------------------------------
test('evaluateLamps: aktive Liste enthaelt true-Lampen, Score unberuehrt', () => {
  const r = L.evaluateLamps(BE);
  assert.ok(Array.isArray(r.active));
  assert.ok(r.active.includes('crashRisk')); // BE hat Crash-Lampe
  assert.equal(r.flags.unprofit, false);     // aber profitabel
  assert.equal(typeof r.flags, 'object');
});

// --- peakMargin isoliert (Testluecke aus Review geschlossen) ----------------
test('peakMargin: aktuelle Marge >> historischer Schnitt -> true', () => {
  const s = { metrics: { operatingMargin: { value: 40 } },
    annual: { annualOpInc: [{ value: 40 }, { value: 10 }, { value: 12 }, { value: 8 }],
      annualRev: [{ value: 100 }, { value: 100 }, { value: 100 }, { value: 100 }] } };
  assert.equal(L.peakMargin(s), true); // 0.40 > 1.3 * mean(0.10,0.12,0.08)
});
test('peakMargin: stabile Marge -> false', () => {
  const s = { metrics: { operatingMargin: { value: 11 } },
    annual: { annualOpInc: [{ value: 11 }, { value: 10 }, { value: 12 }, { value: 9 }],
      annualRev: [{ value: 100 }, { value: 100 }, { value: 100 }, { value: 100 }] } };
  assert.equal(L.peakMargin(s), false);
});

// --- cyclePeak: Zyklus-Peak (kippend) vs. struktureller Durchbruch (steigend) -
test('cyclePeak: Marge weit ueber Schnitt UND kippend -> true', () => {
  const s = { annual: { annualOpInc: [{ value: 35 }, { value: 40 }, { value: 12 }, { value: 10 }],
    annualRev: [{ value: 100 }, { value: 100 }, { value: 100 }, { value: 100 }] } };
  assert.equal(L.cyclePeak(s), true); // cur 0.35 > 1.3*mean(0.40,0.12,0.10), nicht steigend (0.35<0.40)
});
test('cyclePeak: Marge hoch ABER steigend (Durchbruch) -> false', () => {
  const s = { annual: { annualOpInc: [{ value: 45 }, { value: 30 }, { value: 15 }, { value: 10 }],
    annualRev: [{ value: 100 }, { value: 100 }, { value: 100 }, { value: 100 }] } };
  assert.equal(L.cyclePeak(s), false); // cur 0.45 > hist, aber steigend (0.45>0.30) -> kein Peak
});
test('cyclePeak: < 3 Marge-Jahre -> null', () => {
  assert.equal(L.cyclePeak({ annual: { annualOpInc: [{ value: 5 }, { value: 4 }], annualRev: [{ value: 100 }, { value: 100 }] } }), null);
});

// --- A4: Daten-Qualitaets-Lampen (disqualifizierend, Port aus lib/) ----------
const V = (arr) => arr.map((v) => ({ value: v })); // -> [{value:N}] (timeseries/annual-Shape)

// newestQtrSuspect (4-Leg, precision-first): neuestes Quartal vs eigene trailing-Quartale.
test('newestQtrSuspect: Samsung-Muster (opM-Spike 43% vs 10%) -> true', () => {
  const s = { timeseries: { revenueQ: V([100, 70, 70, 70, 70]), opIncQ: V([43, 7, 7, 7, 7]), grossProfitQ: V([62, 28, 28, 28, 28]) } };
  assert.equal(L.newestQtrSuspect(s), true);
});
test('newestQtrSuspect: monotoner Aufschwung (MU-Muster, kein Spike) -> false', () => {
  const s = { timeseries: { revenueQ: V([100, 90, 80, 70, 60]), opIncQ: V([30, 25, 20, 15, 10]), grossProfitQ: V([40, 36, 32, 28, 24]) } };
  assert.equal(L.newestQtrSuspect(s), false);
});
test('newestQtrSuspect: < 5 Quartale -> null (nicht bewertbar)', () => {
  const s = { timeseries: { revenueQ: V([100, 70, 70]), opIncQ: V([43, 7, 7]), grossProfitQ: V([62, 28, 28]) } };
  assert.equal(L.newestQtrSuspect(s), null);
});

// annualCurrencyLeak (3-Leg): USD-Reporter mit annualRev in Trading-ccy, Quartale gesund.
test('annualCurrencyLeak: AKRBP-Muster (annual x10 vs Quartals-TTM, ccy-mismatch) -> true', () => {
  const s = { meta: { reportingCurrencyOriginal: 'USD', tradingCurrency: 'NOK' },
    annual: { annualRev: V([1000]) }, timeseries: { revenueQ: V([25, 25, 25, 25]) }, metrics: { revenueTTM: { value: 100 } } };
  assert.equal(L.annualCurrencyLeak(s), true);
});
test('annualCurrencyLeak: gleiche Reporting-/Trading-ccy -> false (kein Leak moeglich)', () => {
  const s = { meta: { reportingCurrencyOriginal: 'USD', tradingCurrency: 'USD' },
    annual: { annualRev: V([1000]) }, timeseries: { revenueQ: V([25, 25, 25, 25]) }, metrics: { revenueTTM: { value: 100 } } };
  assert.equal(L.annualCurrencyLeak(s), false);
});
test('annualCurrencyLeak: annual NICHT inflationiert (ratio ~1) -> false', () => {
  const s = { meta: { reportingCurrencyOriginal: 'USD', tradingCurrency: 'NOK' },
    annual: { annualRev: V([100]) }, timeseries: { revenueQ: V([25, 25, 25, 25]) }, metrics: { revenueTTM: { value: 100 } } };
  assert.equal(L.annualCurrencyLeak(s), false);
});
test('annualCurrencyLeak: kaputtes Quartals-TTM (anderes Defekt, kein ccy-Leak) -> false', () => {
  const s = { meta: { reportingCurrencyOriginal: 'USD', tradingCurrency: 'NOK' },
    annual: { annualRev: V([1000]) }, timeseries: { revenueQ: V([25, 25, 25, 25]) }, metrics: { revenueTTM: { value: 1000 } } };
  assert.equal(L.annualCurrencyLeak(s), false); // ttmRatio=10 ausserhalb [0.6,1.6]
});
test('annualCurrencyLeak: fehlende ccy-Felder (US-Name) -> null', () => {
  const s = { meta: {}, annual: { annualRev: V([1000]) }, timeseries: { revenueQ: V([25, 25, 25, 25]) }, metrics: { revenueTTM: { value: 100 } } };
  assert.equal(L.annualCurrencyLeak(s), null);
});

console.log(`\nlamps.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
