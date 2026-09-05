// tests/gp-derived-cogs.test.js — Standalone-Runner (framework-los).
// Run: node tests/gp-derived-cogs.test.js
//
// WOFUER: Waechter zu A' (Master-Ratifikation 05.09.2026, Anker orchestrator-2026-09-05-tag N13):
// annualGP = annualRev − annualCostOfRevenue, wo Yahoo den Bruttogewinn nicht liefert. Anlass FTI:
// quoteSummary kodiert grossProfit UND costOfRevenue als 0, fundamentalsTimeSeries liefert keinen
// grossProfit, aber costOfRevenue — rev − COGS reproduziert die alten GP-Werte exakt. Abnahme am
// Rohbezug 05.09.: 30 Ticker, 120 Jahre mit berichtetem GP, 120/120 innerhalb 0,5 % (max 0,003 %).
//
// DIE REGELN, jede hier gepinnt und je einmal absichtlich gebrochen (Anker N14):
//   R1 nur wenn annualGP[i] null ODER literal 0 (0-kodiert)   R2 berichteter Wert != 0 wird NIE ueberschrieben
//   R3 Umsatz UND COGS am selben Index, beide > 0               R4 COGS <= Umsatz, sonst bleibt null + gezaehlt
//   R5 jeder abgeleitete Wert traegt source 'derived_rev_minus_cogs'
//   R6 Laengen-Mismatch = keine Ableitung (fail-closed)           R7 COGS reist in BEIDEN Mappern zeilen-aligniert mit
// Gefahren wird der ECHTE exportierte Seam (F1334), kein Nachbau.
'use strict';
const assert = require('assert');
const M = require('../pull-yahoo.js');
const { _deriveGrossProfitFromCogs: ableiten, GP_DERIVED_SOURCE: SRC, mapFTSToAnnual, mapYahooToCanonical } = M;

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message || e)); }
}
const V = (arr) => arr.map((x) => (x == null ? null : { value: x }));

// FTI, wie am 05.09. live gemessen (Mio): Umsatz, COGS aus fundamentalsTimeSeries; GP dort undefined.
const FTI_REV = [9932.6, 9083.3, 7824.2, 6700.4];
const FTI_COGS = [7751.2, 7360.2, 6550.1, 5804.1];
const FTI_GP_ALT = [2181.4, 1723.1, 1274.1, 896.3];   // Snapshot 01.09. (damals noch aus quoteSummary)

check('R1/R5 FTI: GP null, Umsatz+COGS da -> vier Jahre abgeleitet, exakt die alten Werte, mit Quell-Tag', () => {
  const gp = [null, null, null, null];
  const r = ableiten(V(FTI_REV), gp, V(FTI_COGS));
  assert.deepStrictEqual(r, { derived: 4, rejected: 0 });
  for (let i = 0; i < 4; i++) {
    assert.ok(Math.abs(gp[i].value - FTI_GP_ALT[i]) < 0.15, 'Jahr ' + i + ': ' + gp[i].value + ' vs ' + FTI_GP_ALT[i]);
    assert.strictEqual(gp[i].source, SRC);
  }
});
check('R2: berichteter GP != 0 wird NIE ueberschrieben, auch wenn rev−COGS etwas anderes ergaebe', () => {
  const gp = V([100, 90, null, 70]);
  const r = ableiten(V([300, 280, 260, 240]), gp, V([150, 140, 130, 120]));
  assert.deepStrictEqual(r, { derived: 1, rejected: 0 });
  assert.deepStrictEqual(gp[0], { value: 100 }); assert.deepStrictEqual(gp[1], { value: 90 }); assert.deepStrictEqual(gp[3], { value: 70 });
  assert.deepStrictEqual(gp[2], { value: 130, source: SRC });
});
check('R1: literal 0 (0-kodiert) gilt als fehlend und wird abgeleitet', () => {
  const gp = V([0, 0]);
  const r = ableiten(V([300, 280]), gp, V([150, 140]));
  assert.deepStrictEqual(r, { derived: 2, rejected: 0 });
  assert.deepStrictEqual(gp, [{ value: 150, source: SRC }, { value: 140, source: SRC }]);
});
check('R4: COGS > Umsatz -> bleibt null und wird als abgelehnt gezaehlt (nie negativer GP)', () => {
  const gp = [null, null];
  const r = ableiten(V([300, 280]), gp, V([350, 140]));
  assert.deepStrictEqual(r, { derived: 1, rejected: 1 });
  assert.strictEqual(gp[0], null); assert.deepStrictEqual(gp[1], { value: 140, source: SRC });
});
check('R3: COGS fehlt / 0 oder Umsatz fehlt / 0 -> keine Ableitung (nichts erfunden)', () => {
  const gp = [null, null, null, null];
  const r = ableiten(V([300, 0, null, 240]), gp, V([null, 140, 130, 0]));
  assert.deepStrictEqual(r, { derived: 0, rejected: 0 });
  assert.deepStrictEqual(gp, [null, null, null, null]);
});
check('R6: Laengen-Mismatch (COGS-Reihe kuerzer/laenger) -> keine Ableitung, fail-closed', () => {
  const gp = [null, null, null];
  assert.deepStrictEqual(ableiten(V([300, 280, 260]), gp, V([150, 140])), { derived: 0, rejected: 0 });
  assert.deepStrictEqual(ableiten(V([300, 280, 260]), gp, V([150, 140, 130, 120])), { derived: 0, rejected: 0 });
  assert.deepStrictEqual(ableiten(V([300, 280, 260]), gp, undefined), { derived: 0, rejected: 0 });
  assert.deepStrictEqual(gp, [null, null, null]);
});
check('R7 FTS-Mapper: costOfRevenue reist zeilen-aligniert mit annualRev, Trim haelt die Ausrichtung', () => {
  const rows = [
    { date: '2021-12-31' },                                                                   // aelteste Zeile komplett leer -> getrimmt
    { date: '2022-12-31', totalRevenue: 6700.4, costOfRevenue: 5804.1, operatingIncome: 212.5, netIncome: 1 },
    { date: '2023-12-31', totalRevenue: 7824.2, costOfRevenue: 6550.1, operatingIncome: 529.2, netIncome: 1 },
    { date: '2024-12-31', totalRevenue: 9083.3, costOfRevenue: 7360.2, operatingIncome: 982.6, netIncome: 1 },
    { date: '2025-12-31', totalRevenue: 9932.6, costOfRevenue: 7751.2, operatingIncome: 1393.0, netIncome: 1 },
  ];
  const a = mapFTSToAnnual(rows, []);
  assert.strictEqual(a.annualRev.length, 4, 'Trim: ' + a.annualRev.length);
  assert.strictEqual(a.annualCostOfRevenue.length, a.annualRev.length, 'COGS nicht aligniert');
  assert.deepStrictEqual(a.annualCostOfRevenue.map((x) => x && x.value), FTI_COGS);
  assert.deepStrictEqual(a.annualGP, [null, null, null, null], 'FTS ohne grossProfit muss null liefern (Ableitung passiert erst im Seam)');
  const gp = a.annualGP.slice();
  assert.deepStrictEqual(ableiten(a.annualRev, gp, a.annualCostOfRevenue), { derived: 4, rejected: 0 });
});
check('R7 QS-Mapper: annualCostOfRevenue steht im canonical.annual, index-aligned zu annualRev', () => {
  const isHist = [
    { endDate: '2025-12-31', totalRevenue: 300, operatingIncome: 30, grossProfit: 0, costOfRevenue: 180 },
    { endDate: '2024-12-31', totalRevenue: 250, operatingIncome: 25, grossProfit: 0, costOfRevenue: 160 },
  ];
  const c = mapYahooToCanonical({ incomeStatementHistory: { incomeStatementHistory: isHist }, summaryDetail: { marketCap: 1 } }, { ticker: 'GPX' }, '2026-09-05T00:00:00Z');
  assert.deepStrictEqual(c.annual.annualCostOfRevenue.map((x) => x && x.value), [180, 160]);
  assert.strictEqual(c.annual.annualCostOfRevenue.length, c.annual.annualRev.length);
});
check('R8 (Review HIGH) QS-Mapper: COGS fehlt nur im aeltesten Jahr -> Reihe an annualRev ausgerichtet, die juengeren Jahre werden abgeleitet', () => {
  const isHist = [
    { endDate: '2025-12-31', totalRevenue: 300, grossProfit: 0, costOfRevenue: 180 },
    { endDate: '2024-12-31', totalRevenue: 250, grossProfit: 0, costOfRevenue: 160 },
    { endDate: '2023-12-31', totalRevenue: 200, grossProfit: 90, costOfRevenue: 110 },
    { endDate: '2022-12-31', totalRevenue: 150, grossProfit: 60 },                       // kein COGS
  ];
  const c = mapYahooToCanonical({ incomeStatementHistory: { incomeStatementHistory: isHist }, summaryDetail: { marketCap: 1 } }, { ticker: 'GPY' }, '2026-09-05T00:00:00Z');
  assert.strictEqual(c.annual.annualCostOfRevenue.length, c.annual.annualRev.length, 'COGS-Reihe nicht an annualRev ausgerichtet: ' + c.annual.annualCostOfRevenue.length + ' vs ' + c.annual.annualRev.length);
  assert.strictEqual(c.annual.annualCostOfRevenue[3], null, 'fehlendes COGS-Jahr muss null bleiben');
  const gp = c.annual.annualGP.slice();
  const r = ableiten(c.annual.annualRev, gp, c.annual.annualCostOfRevenue);
  assert.deepStrictEqual(r, { derived: 2, rejected: 0 }, JSON.stringify(r));
  assert.deepStrictEqual(gp.map((x) => x && x.value), [120, 90, 90, 60]);
  assert.strictEqual(gp[0].source, SRC); assert.strictEqual(gp[2].source, undefined, 'berichteter Wert bleibt ohne Tag');
});
check('Zaehler: _gpDerivedTally existiert und startet bei 0 rows / 0 rejectedRows', () => {
  const t = M._gpDerivedTally();
  assert.ok(Number.isFinite(t.rows) && Number.isFinite(t.rejectedRows), JSON.stringify(t));
});

if (fail) { console.log('\nFAIL: gp-derived-cogs (' + fail + ')'); process.exit(1); }
console.log('\nOK: gp-derived-cogs (A\' Master-Ratifikation 05.09.2026)');
