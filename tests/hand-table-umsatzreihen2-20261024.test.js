'use strict';
// Hand table 24.10.2026, second revenue lane (sd-umsatzreihen-2): wrong growth values on the boards of 23.10.2026.
// - 603993.SS CMOC: the vendor stores 0 for Q2 2026 (growth -100 %). The issuer gives H1 2026 and Q1 2026, so the quarter
//   is corrected to their difference; the other three vendor quarters are confirmed against the issuer's quarterly table
//   (rounded to thousand CNY), so the series is covered through 30.06.2026. The vendor gross profit is 0 in all four
//   quarters although the issuer reports revenue minus cost of sales far above zero: these siblings are withheld.
// - INFRAC.SW Infracore: the vendor stores 2,000 CHF for Q1 2026 and Q1 2025 (growth 0.0 %) and an "other revenue" line
//   as annual revenue (24,000 and 8,000 CHF). Infracore reports half years and years only: both quarters (revenue and
//   operating income) are withheld, FY2025 and FY2024 are corrected from the annual report, FY2023 is withheld.
// - UDR and 0288.HK WH Group need no entry: the issuers report the same quarterly revenue for Q2 2026 and Q2 2025
//   (UDR 10-Q: total revenues 425,399 and 425,399 thousand USD; WH Group: H1 minus Q1 is 6,833 million USD in both years).
//   They stay untouched; the test pins that the table has no authority over them.
// - 002379.SZ was already covered by the first lane (revision 2026-10-24-sdumsatz).
// Real vendor cells of the run 39918190374 (data day 23.10.2026), embedded below. Every red probe changes an in-memory
// table copy only; live files are hashed before and after.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { applyFinancialCases, financialReasons, validateTable, table } = require('../lib/financial-known-cases.js');
const { revQuartalsYoY } = require('../src/scoring/axes.js');
const { g31Shadow } = require('../lib/g31-recency.js');
const root = path.resolve(__dirname, '..');
const live = ['configs/financial-known-cases.json', 'configs/g31-hinweise.json', 'lib/financial-known-cases.js'];
const liveHashes = () => live.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'));
const beforeHashes = liveHashes();
const REV = '2026-10-24-sdumsatz2';
const SNAPS = {"603993.SS":{"meta":{"ticker":"603993.SS","name":"CMOC Group Limited","country":"China","exchangeName":"Shanghai","reportingCurrency":"USD","reportingCurrencyOriginal":"CNY","tradingCurrency":"CNY","tradingCurrencyAssumed":false,"_ccyMissingCompletely":false,"ccyAmbiguous":false,"fxRateApplied":0.14942546,"fxConverted":true,"fetchedAt":"2026-10-14T08:19:21.684Z"},"timeseries":{"revenueQ":[{"value":0},{"value":9144604602.99453},{"value":7577769761.090554},{"value":7286967857.171863}],"revenueQEnds":["2026-06-30","2025-12-31","2025-09-30","2025-06-30"],"grossProfitQ":[{"value":0},{"value":0},{"value":0},{"value":0}],"grossProfitQEnds":["2026-06-30","2025-12-31","2025-09-30","2025-06-30"]},"annual":{"annualRev":[{"value":30847841607.312504},{"value":31804673230.210682},{"value":27790245874.623493},{"value":25803207923.70996}],"annualRevEnds":["2025-12-31","2024-12-31","2023-12-31","2022-12-31"]}},"INFRAC.SW":{"meta":{"ticker":"INFRAC.SW","name":"Infracore SA","country":"Switzerland","exchangeName":"Swiss","reportingCurrency":"USD","reportingCurrencyOriginal":"CHF","tradingCurrency":"CHF","tradingCurrencyAssumed":false,"_ccyMissingCompletely":false,"ccyAmbiguous":false,"fxRateApplied":1.2179971,"fxConverted":true,"fetchedAt":"2026-10-22T08:06:34.451Z"},"timeseries":{"revenueQ":[{"value":2435.9942},{"value":2435.9942}],"revenueQEnds":["2026-03-31","2025-03-31"],"grossProfitQ":[null,null],"grossProfitQEnds":["2026-03-31","2025-03-31"],"opIncQ":[{"value":-1738081.8617},{"value":-1897639.4818000002}],"opIncQEnds":["2026-03-31","2025-03-31"]},"annual":{"annualRev":[{"value":29231.9304},{"value":9743.9768},{"value":24359.942000000003}],"annualRevEnds":["2025-12-31","2024-12-31","2023-12-31"]}},"UDR":{"meta":{"ticker":"UDR","name":"UDR, Inc.","country":"United States","exchangeName":"NYSE","reportingCurrency":"USD","reportingCurrencyOriginal":"USD","tradingCurrency":"USD","tradingCurrencyAssumed":false,"_ccyMissingCompletely":false,"ccyAmbiguous":false,"fxRateApplied":1,"fxConverted":true,"fetchedAt":"2026-10-14T08:45:34.680Z"},"timeseries":{"revenueQ":[{"value":425399000},{"value":425849000},{"value":433106000},{"value":431864000},{"value":425399000}],"revenueQEnds":["2026-06-30","2026-03-31","2025-12-31","2025-09-30","2025-06-30"],"grossProfitQ":[{"value":118357000},{"value":110232000},{"value":121286000},{"value":114827000},{"value":115840000}],"grossProfitQEnds":["2026-06-30","2026-03-31","2025-12-31","2025-09-30","2025-06-30"],"opIncQ":[{"value":115857000},{"value":229805000},{"value":277666000},{"value":76356000},{"value":77389000}],"opIncQEnds":["2026-06-30","2026-03-31","2025-12-31","2025-09-30","2025-06-30"]},"annual":{"annualRev":[{"value":1712317000},{"value":1671842000},{"value":1627501000},{"value":1517386000}],"annualRevEnds":["2025-12-31","2024-12-31","2023-12-31","2022-12-31"]}},"0288.HK":{"meta":{"ticker":"0288.HK","name":"WH Group Limited","country":"Hong Kong","exchangeName":"HKSE","reportingCurrency":"USD","reportingCurrencyOriginal":"USD","tradingCurrency":"HKD","tradingCurrencyAssumed":false,"_ccyMissingCompletely":false,"ccyAmbiguous":false,"fxRateApplied":1,"fxConverted":true,"fetchedAt":"2026-10-14T08:09:32.660Z"},"timeseries":{"revenueQ":[{"value":6833000000},{"value":7549000000},{"value":7090000000},{"value":6833000000}],"revenueQEnds":["2026-06-30","2025-12-31","2025-09-30","2025-06-30"],"grossProfitQ":[{"value":0},{"value":0},{"value":0},{"value":0}],"grossProfitQEnds":["2026-06-30","2025-12-31","2025-09-30","2025-06-30"]},"annual":{"annualRev":[{"value":28026000000},{"value":25941000000},{"value":26236000000},{"value":28136000000}],"annualRevEnds":["2025-12-31","2024-12-31","2023-12-31","2022-12-31"]}}};
const value = row => typeof row === 'number' ? row : row?.value ?? null;
const snap = t => structuredClone(SNAPS[t]);
const apply = (t, cfg) => applyFinancialCases(snap(t), cfg && { table: cfg }).snapshot;
const native = (s, box, field) => s[box][field].map(r => value(r) === null ? null : Math.round(value(r) / s.meta.fxRateApplied * 100) / 100);
const caseOf = id => table.cases.find(c => c.caseId === id);
/** Table copy without this lane's rows (cases and coverage): the state of origin/main before the change. */
function before() {
  const copy = structuredClone(table);
  copy.cases = copy.cases.filter(c => c.revision !== REV);
  copy.coverage = copy.coverage.filter(v => v.ticker !== '603993.SS');
  return validateTable(copy);
}

test('the 14 cases and one coverage row of this lane are in the table and validate', () => {
  const own = table.cases.filter(c => c.revision === REV);
  assert.equal(own.length, 14);
  assert.deepEqual([...new Set(own.map(c => c.ticker))].sort(), ['603993.SS', 'INFRAC.SW']);
  assert.deepEqual(table.coverage.filter(v => v.ticker === '603993.SS'), [{ ticker: '603993.SS', field: 'revenueQ', coversThrough: '2026-06-30' }]);
  for (const c of own) {
    assert.ok(c.sources.every(s => s.url.startsWith('https://') && s.quote && s.page && s.verifiedAt && s.published), c.caseId);
    // Rule #27: every reason names its period.
    assert.match(c.reason, /\d{2}\.\d{2}\.\d{4}/, c.caseId);
  }
});

test('603993.SS: the zero of Q2 2026 becomes H1 minus Q1; the other quarters are confirmed; gross profit zeros are withheld', () => {
  const out = apply('603993.SS');
  assert.deepEqual(native(out, 'timeseries', 'revenueQ'), [68916690474.87, 61198437020, 50712708270, 48766574700]);
  assert.equal(out.timeseries.revenueQ[0].financialCorrection.caseId, '603993.ss-2026-06-30-revenueQ-20261024');
  assert.equal(Math.round(revQuartalsYoY(out) * 1000) / 10, 41.3);
  const leg = g31Shadow(out).v1;
  assert.deepEqual([leg.basis, leg.periodEnd, leg.priorPeriodEnd], ['quarter', '2026-06-30', '2025-06-30']);
  assert.deepEqual(snap('603993.SS').timeseries.grossProfitQ.map(value), [0, 0, 0, 0], 'vendor zeros present in the input');
  out.timeseries.grossProfitQ.forEach((row, i) => {
    assert.equal(value(row), null);
    assert.equal(row.financialCorrection.caseId, `603993.ss-${out.timeseries.grossProfitQEnds[i]}-grossProfitQ-20261024`);
  });
  assert.ok(financialReasons(out).includes(caseOf('603993.ss-2026-06-30-revenueQ-20261024').reason));
});

test('INFRAC.SW: both vendor quarters are withheld, FY2025 and FY2024 come from the annual report, FY2023 is withheld', () => {
  const out = apply('INFRAC.SW');
  assert.deepEqual(out.timeseries.revenueQ.map(value), [null, null]);
  assert.deepEqual(out.timeseries.opIncQ.map(value), [null, null]);
  assert.deepEqual(native(out, 'annual', 'annualRev'), [66363000, 60473000, null]);
  assert.equal(revQuartalsYoY(out), null);
  const leg = g31Shadow(out).v1;
  assert.deepEqual([leg.basis, leg.periodEnd, leg.priorPeriodEnd, Math.round(leg.pct * 10) / 10], ['year', '2025-12-31', '2024-12-31', 9.7]);
  const reasons = financialReasons(out);
  for (const id of ['infrac.sw-2026-03-31-revenueQ-20261024', 'infrac.sw-2025-03-31-opIncQ-20261024', 'infrac.sw-2025-12-31-annualRev-20261024']) {
    assert.ok(reasons.includes(caseOf(id).reason), id);
  }
  assert.ok(reasons.some(r => r.endsWith('Das betrifft die Periode mit Ende 31.12.2023.')));
});

test('UDR and 0288.HK: equal quarters are the issuers\' own figures, so the table leaves them untouched', () => {
  for (const t of ['UDR', '0288.HK']) {
    const s = snap(t), r = applyFinancialCases(s);
    assert.equal(r.snapshot, s, t);
    assert.deepEqual(r.events, [], t);
    assert.equal(value(s.timeseries.revenueQ[0]), value(s.timeseries.revenueQ.at(-1)), t + ' equal Q2 2026 and Q2 2025 in the input');
  }
});

test('break-once on test data: without these rows, or with a mismatching expectedBadValue, the vendor value is back or refused', () => {
  const guard = cfg => {
    assert.equal(value(apply('603993.SS', cfg).timeseries.revenueQ[0]), 68916690474.87 * SNAPS['603993.SS'].meta.fxRateApplied);
    assert.equal(value(apply('INFRAC.SW', cfg).timeseries.revenueQ[0]), null);
    assert.equal(value(apply('INFRAC.SW', cfg).annual.annualRev[0]), 66363000 * SNAPS['INFRAC.SW'].meta.fxRateApplied);
  };
  guard();
  assert.throws(() => guard(before()), assert.AssertionError);
  // A case whose expectedBadValue no longer matches the stored vendor cell never replaces it: the cell is withheld.
  const wrong = structuredClone(table);
  wrong.cases.find(c => c.caseId === '603993.ss-2026-06-30-revenueQ-20261024').expectedBadValue = 1;
  const cell = apply('603993.SS', validateTable(wrong)).timeseries.revenueQ[0];
  assert.equal(cell.value, null);
  assert.equal(cell.financialMissing.reasonCode, 'vendor-value-changed');
  assert.throws(() => guard(validateTable(wrong)), assert.AssertionError);
  // The same for an annual year: the whole series is withheld, never the vendor value shown.
  const wrongYear = structuredClone(table);
  wrongYear.cases.find(c => c.caseId === 'infrac.sw-2025-12-31-annualRev-20261024').expectedBadValue = 1;
  const years = apply('INFRAC.SW', validateTable(wrongYear)).annual.annualRev;
  assert.deepEqual(years.map(value), [null, null, null]);
  assert.equal(years[0].financialMissing.reasonCode, 'vendor-value-changed');
  assert.deepEqual(liveHashes(), beforeHashes, 'live files unchanged');
});
