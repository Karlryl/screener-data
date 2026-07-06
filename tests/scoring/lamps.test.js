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
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', t + '.json'), 'utf8'));
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
// Bug 30 (wie F14/axes.js): fehlende currentLiabilities darf NICHT zu 0 koerziert werden
// (sonst invested=totalAssets -> Lampe misst ROA statt ROIC). Ohne curLiab-Jahr -> null.
test('lowRoic: fehlende currentLiabilities -> null (keine ROA-Maskerade)', () => {
  // alt: invested=1000, ROA=80/1000=0.08 < 0.09 -> spurious true. neu: curLiab absent -> null.
  const s = { annual: { annualOpInc: [{ value: 80 }],
    annualBalance: [{ totalAssets: 1000 }] } };
  assert.equal(L.lowRoic(s), null);
});
test('lowRoic: curLiab present, ROIC unter Huerde -> true', () => {
  const s = { annual: { annualOpInc: [{ value: 60 }],
    annualBalance: [{ totalAssets: 1000, currentLiabilities: 200 }] } };
  assert.equal(L.lowRoic(s), true); // 60/(1000-200)=0.075 < 0.09 -> true (curLiab korrekt abgezogen)
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
test('peakMargin: fuehrende null-Luecke wird kompaktiert (NEU/UVV under-fire-Bug behoben)', () => {
  // margins=[null,0.258,0.220,0.173]: kompaktiert cur=0.258 vs histRest=mean(0.220,0.173)=0.1965
  // -> 0.258 > 1.3*0.1965=0.255 -> feuert. Vorher mittelte das positionalem slice(1) cur in die
  // eigene Baseline (histRest=mean(0.258,0.220,0.173)=0.217 -> 0.258 < 0.282 -> feuerte faelschlich nicht).
  const s = { annual: { annualOpInc: [{ value: null }, { value: 25.8 }, { value: 22.0 }, { value: 17.3 }],
    annualRev: [{ value: 100 }, { value: 100 }, { value: 100 }, { value: 100 }] } };
  assert.equal(L.peakMargin(s), true);
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
// Court Fall 2: 5. Leg (YoY-De-Fire). q0 sieht vs trailing anomal aus, gleicht aber dem
// VORJAHRES-gleichen Quartal (Index 4) -> Saisonalitaet, kein korruptes Quartal -> de-fire.
test('newestQtrSuspect: saisonaler Trog (VCEL-Muster, q0~q4 YoY) -> de-fired false', () => {
  // leg1-leg4 wuerden alle feuern (q0opm 24% vs trailMed ~1.8%), aber q4opm=24% == q0opm -> saisonal.
  const s = { timeseries: { revenueQ: V([100, 70, 70, 70, 100]), opIncQ: V([24, 1.5, 1, 1, 24]), grossProfitQ: V([62, 28, 28, 28, 62]) } };
  assert.equal(L.newestQtrSuspect(s), false);
});
test('newestQtrSuspect: echte Diskontinuitaet (q0 != q4 YoY) feuert trotz aehnlicher leg1-4 -> true', () => {
  // Gleiche leg1-4-Konstellation, aber q4opm=1.4% != q0opm 24% (|d|=0.226>0.20) -> NICHT saisonal -> feuert.
  const s = { timeseries: { revenueQ: V([100, 70, 70, 70, 70]), opIncQ: V([24, 1.5, 1, 1, 1]), grossProfitQ: V([62, 28, 28, 28, 28]) } };
  assert.equal(L.newestQtrSuspect(s), true);
});
// Court Fall R6: 6. Leg legRamp. Eine echte monotone Frueh-Kommerzialisierungs-Rampe (LQDA-Muster,
// alle 4 QoQ-Umsatz-Schritte > 1.35) triggert leg4 faelschlich, ist aber keine Fabrikation -> de-fire.
test('newestQtrSuspect: durchgehende explosive Umsatz-Rampe (LQDA) -> de-fired false', () => {
  // revQ-Schritte 1.6/1.67/3.0/4.0 (alle >1.35); leg1-4 wuerden feuern, legSeasonal de-firet nicht (q4opm=-6).
  const s = { timeseries: { revenueQ: V([160, 100, 60, 20, 5]), opIncQ: V([80, 24, 2, -60, -30]), grossProfitQ: V([112, 40, 30, 10, 2]) } };
  assert.equal(L.newestQtrSuspect(s), false);
});
test('newestQtrSuspect: EIN QoQ-Schritt < 1.35 (kein durchgehender Ramp) feuert weiter -> true', () => {
  // revQ[0]/revQ[1]=160/130=1.23 < 1.35 -> legRamp=false -> Spike-Verdacht bleibt (Samsung/SNDK-Klasse).
  const s = { timeseries: { revenueQ: V([160, 130, 60, 20, 5]), opIncQ: V([80, 24, 2, -60, -30]), grossProfitQ: V([112, 40, 30, 10, 2]) } };
  assert.equal(L.newestQtrSuspect(s), true);
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
// burnAccelerating + burnPressFactor (Court, Karl-Direktive Teil 2) ----------
test('burnAccelerating: Burn UND Verlust vertiefen sich -> true; Turnaround (FCF>=0) -> false', () => {
  const burner = { annual: { annualFCF: V([-300, -100]), annualOpInc: V([-50, -20]) } };
  assert.equal(L.burnAccelerating(burner), true);
  const turn = { annual: { annualFCF: V([29, -46]), annualOpInc: V([38, -10]) } }; // CRDO-Muster (neuestes positiv)
  assert.equal(L.burnAccelerating(turn), false);
});
test('burnPressFactor: Verbrenner -> Faktor <1 (Score gedrueckt), Nicht-Verbrenner -> exakt 1.0', () => {
  const burner = { annual: { annualFCF: V([-300, -100]), annualOpInc: V([-50, -20]), annualRev: V([100, 80]) } };
  const f = L.burnPressFactor(burner); // mag = dBurn 200 / scale max(80,300,100)=300 = 0.667 -> 1/1.667 = 0.6
  assert.ok(Math.abs(f - 1 / (1 + 200 / 300)) < 1e-9, 'Verbrenner-Faktor ~0.6, war ' + f);
  const turn = { annual: { annualFCF: V([29, -46]), annualOpInc: V([38, -10]), annualRev: V([100, 80]) } };
  assert.equal(L.burnPressFactor(turn), 1); // feuert nicht -> byte-identisch
});

console.log(`\nlamps.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
