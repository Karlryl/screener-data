'use strict';
// Hand table 24.10.2026 (lane sd-umsatzreihen): six wrong growth or margin values on the boards of 23.10.2026.
// - 2498.HK RoboSense: the vendor stores 0 for Q2 2026; the issuer reports 560,999 thousand CNY (HKEX). The series is
//   covered (all four vendor quarters checked), so the quarter is corrected instead of withheld.
// - 300277.SZ Hangzhou Turbine Power: common-control merger with Hangzhou Steam Turbine on 16.03.2026; the issuer
//   restates the 2025 quarters. Q2 2025 is corrected to the restated base (H1 minus Q1, both 调整后), Q4 2025 (old
//   basis, no restated figure) is withheld; G31 hint `uebernahme` for the shown pair.
// - 002379.SZ Hongqiao (optional case of the brief): Q2 2025 (pre-acquisition basis) and Q4 2025 (an annual-size
//   value stored as a quarter) are withheld.
// - EYDAP.AT: the vendor stores 0 as 2025 revenue (issuer: 364.7 million EUR) and skips 2021 to 2024; withheld.
// - MIN.AX: the vendor skips FY2025, so FY2024 sits next to FY2026; FY2024 (and, by the no-gap rule, older years)
//   is withheld, FY2026 stays.
// - IONQ: the vendor scalar ebitdaMargins is 0 although EBITDA is far below zero; the new metric hold withholds it.
// Real vendor cells of the run 39918190374 (data day 23.10.2026), embedded below (no fixture file). Every red probe
// changes an in-memory table copy only; live files are hashed before and after.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { applyFinancialCases, financialReasons, validateTable, table } = require('../lib/financial-known-cases.js');
const { revQuartalsYoY } = require('../src/scoring/axes.js');
const { g31Shadow, g31Export } = require('../lib/g31-recency.js');
const root = path.resolve(__dirname, '..');
const live = ['configs/financial-known-cases.json', 'configs/g31-hinweise.json', 'lib/financial-known-cases.js'];
const liveHashes = () => live.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'));
const beforeHashes = liveHashes();
const REV = '2026-10-24-sdumsatz';
const SNAPS = {"2498.HK":{"meta":{"ticker":"2498.HK","name":"Robosense Technology Co., Ltd","country":"China","exchangeName":"HKSE","reportingCurrency":"USD","reportingCurrencyOriginal":"CNY","tradingCurrency":"HKD","tradingCurrencyAssumed":false,"_ccyMissingCompletely":false,"ccyAmbiguous":false,"fxRateApplied":0.14991829,"fxConverted":true,"fetchedAt":"2026-10-23T08:15:31.362Z"},"timeseries":{"revenueQ":[{"value":0},{"value":112542760.79326001},{"value":61032785.287030004},{"value":68267542.12585}],"revenueQEnds":["2026-06-30","2025-12-31","2025-09-30","2025-06-30"]},"annual":{"annualRev":[{"value":290992600.23632},{"value":247200568.21758002},{"value":167930822.62521002},{"value":79504967.38938001}],"annualRevEnds":["2025-12-31","2024-12-31","2023-12-31","2022-12-31"]},"metrics":{"ebitdaMargins":{"value":-14.863999999999999,"source":"yahoo_quoteSummary","confidence":0.9,"asOf":"2026-10-23T08:15:31.362Z"}}},"EYDAP.AT":{"meta":{"ticker":"EYDAP.AT","name":"Athens Water Supply and Sewerage Company S.A.","country":"Greece","exchangeName":"Athens","reportingCurrency":"USD","reportingCurrencyOriginal":"EUR","tradingCurrency":"EUR","tradingCurrencyAssumed":false,"_ccyMissingCompletely":false,"ccyAmbiguous":false,"fxRateApplied":1.1239743,"fxConverted":true,"fetchedAt":"2026-10-22T08:08:06.131Z"},"timeseries":{"revenueQ":[{"value":89908952.2056},{"value":106329092.7543},{"value":94365510.3051},{"value":125425416.11129999}],"revenueQEnds":["2014-12-31","2014-09-30","2010-03-31","2009-09-30"]},"annual":{"annualRev":[{"value":0},{"value":371276810.6475},{"value":0},{"value":362369314.32}],"annualRevEnds":["2025-12-31","2020-12-31","2019-12-31","2018-12-31"]},"metrics":{"ebitdaMargins":{"value":22.291,"source":"yahoo_quoteSummary","confidence":0.9,"asOf":"2026-10-22T08:08:06.131Z"}}},"IONQ":{"meta":{"ticker":"IONQ","name":"IonQ, Inc.","country":"United States","exchangeName":"NYSE","reportingCurrency":"USD","reportingCurrencyOriginal":"USD","tradingCurrency":"USD","tradingCurrencyAssumed":false,"_ccyMissingCompletely":false,"ccyAmbiguous":false,"fxRateApplied":1,"fxConverted":true,"fetchedAt":"2026-10-14T08:32:10.433Z"},"timeseries":{"revenueQ":[{"value":80050000},{"value":64668000},{"value":61890000},{"value":39866000},{"value":20694000}],"revenueQEnds":["2026-06-30","2026-03-31","2025-12-31","2025-09-30","2025-06-30"]},"annual":{"annualRev":[{"value":130016000},{"value":43073000},{"value":22042000},{"value":11131000}],"annualRevEnds":["2025-12-31","2024-12-31","2023-12-31","2022-12-31"]},"metrics":{"ebitdaMargins":{"value":0,"source":"yahoo_quoteSummary","confidence":0.9,"asOf":"2026-10-14T08:32:10.433Z"}}},"300277.SZ":{"meta":{"ticker":"300277.SZ","name":"Hangzhou Turbine Power Group Co., Ltd.","country":"China","exchangeName":"Shenzhen","reportingCurrency":"USD","reportingCurrencyOriginal":"CNY","tradingCurrency":"CNY","tradingCurrencyAssumed":false,"_ccyMissingCompletely":false,"ccyAmbiguous":false,"fxRateApplied":0.14942546,"fxConverted":true,"fetchedAt":"2026-10-14T08:13:27.144Z"},"timeseries":{"revenueQ":[{"value":235737860.66965178},{"value":194788768.01200765},{"value":10591893.220914727},{"value":7410385.89953712},{"value":164810144.808426}],"revenueQEnds":["2026-06-30","2026-03-31","2025-12-31","2025-06-30","2025-03-31"]},"annual":{"annualRev":[{"value":29228522.6671579},{"value":34077686.78313438},{"value":31832843.877181564},{"value":36127924.87493369}],"annualRevEnds":["2025-12-31","2024-12-31","2023-12-31","2022-12-31"]},"metrics":{"ebitdaMargins":{"value":15.341,"source":"yahoo_quoteSummary","confidence":0.9,"asOf":"2026-10-14T08:13:27.144Z"}}},"002379.SZ":{"meta":{"ticker":"002379.SZ","name":"Shandong Hongqiao Aluminum Industry Holding Company Limited","country":"China","exchangeName":"Shenzhen","reportingCurrency":"USD","reportingCurrencyOriginal":"CNY","tradingCurrency":"CNY","tradingCurrencyAssumed":false,"_ccyMissingCompletely":false,"ccyAmbiguous":false,"fxRateApplied":0.14942546,"fxConverted":true,"fetchedAt":"2026-10-14T08:08:49.756Z"},"timeseries":{"revenueQ":[{"value":6809485908.0260515},{"value":6116410982.575192},{"value":23115315369.149708},{"value":101230046.25708914},{"value":5926462592.369471}],"revenueQEnds":["2026-06-30","2026-03-31","2025-12-31","2025-06-30","2025-03-31"]},"annual":{"annualRev":[{"value":23418085734.867363},{"value":22464023866.711266},{"value":401547400.5709231},{"value":527362780.39947253}],"annualRevEnds":["2025-12-31","2024-12-31","2023-12-31","2022-12-31"]},"metrics":{"ebitdaMargins":{"value":23.076999,"source":"yahoo_quoteSummary","confidence":0.9,"asOf":"2026-10-14T08:08:49.756Z"}}},"MIN.AX":{"meta":{"ticker":"MIN.AX","name":"Mineral Resources Limited","country":"Australia","exchangeName":"ASX","reportingCurrency":"USD","reportingCurrencyOriginal":"AUD","tradingCurrency":"AUD","tradingCurrencyAssumed":false,"_ccyMissingCompletely":false,"ccyAmbiguous":false,"fxRateApplied":0.7007218,"fxConverted":true,"fetchedAt":"2026-10-14T08:37:25.074Z"},"timeseries":{"revenueQ":[],"revenueQEnds":[]},"annual":{"annualRev":[{"value":4527363549.799999},{"value":3685095946.2},{"value":3348819554.3799996},{"value":2395067112.3999996}],"annualRevEnds":["2026-06-30","2024-06-30","2023-06-30","2022-06-30"]},"metrics":{"ebitdaMargins":{"value":37.765,"source":"yahoo_quoteSummary","confidence":0.9,"asOf":"2026-10-14T08:37:25.074Z"}}}};
const value = row => typeof row === 'number' ? row : row?.value ?? null;
const snap = t => structuredClone(SNAPS[t]);
const apply = (t, cfg) => applyFinancialCases(snap(t), cfg && { table: cfg }).snapshot;
const native = (s, box, field) => s[box][field].map(r => value(r) === null ? null : Math.round(value(r) / s.meta.fxRateApplied * 100) / 100);
const caseOf = id => table.cases.find(c => c.caseId === id);
/** Table copy without this lane's rows (cases, coverage, metric holds): the state of origin/main before the change. */
function before() {
  const copy = structuredClone(table);
  copy.cases = copy.cases.filter(c => c.revision !== REV);
  copy.coverage = copy.coverage.filter(v => !['2498.HK', '300277.SZ'].includes(v.ticker));
  copy.metricHolds = (copy.metricHolds || []).filter(h => h.revision !== REV);
  return validateTable(copy);
}

test('the 13 cases and one metric hold of 24.10.2026 are in the table and validate', () => {
  assert.equal(table.cases.filter(c => c.revision === REV).length, 13);
  assert.equal(table.metricHolds.filter(h => h.revision === REV).length, 1);
  for (const c of table.cases.filter(c => c.revision === REV)) {
    assert.ok(c.sources.every(s => s.url.startsWith('https://') && s.quote && s.page && s.verifiedAt), c.caseId);
    // Rule #27: every reason names its period (a date or a fiscal year).
    assert.match(c.reason, /\d{2}\.\d{2}\.\d{4}|\b20\d{2}\b/, c.caseId);
  }
});

test('2498.HK: the zero of Q2 2026 is replaced by the issuer value; the other quarters are confirmed', () => {
  const out = apply('2498.HK');
  assert.deepEqual(native(out, 'timeseries', 'revenueQ'), [560999000, 750694000, 407107000, 455365000]);
  assert.equal(out.timeseries.revenueQ[0].financialCorrection.caseId, '2498.hk-2026-06-30-revenueQ-20261024');
  assert.equal(Math.round(revQuartalsYoY(out) * 1000) / 10, 23.2);
  assert.equal(g31Shadow(out).v1.periodEnd, '2026-06-30');
  assert.ok(financialReasons(out).includes(caseOf('2498.hk-2026-06-30-revenueQ-20261024').reason));
});

test('300277.SZ: the June quarter 2025 is on the restated base, Q4 2025 is withheld, the merger hint shows', () => {
  const out = apply('300277.SZ');
  assert.deepEqual(native(out, 'timeseries', 'revenueQ'), [1577628475.56, 1303584864.4, null, 1419410099.37, 1102958925.53]);
  assert.equal(out.timeseries.revenueQ[2].financialCorrection.reason, caseOf('300277.sz-2025-12-31-revenueQ-20261024').reason);
  const leg = g31Shadow(out).v1;
  assert.deepEqual([leg.basis, leg.periodEnd, leg.priorPeriodEnd, Math.round(leg.pct * 10) / 10], ['quarter', '2026-06-30', '2025-06-30', 11.1]);
  assert.equal(g31Export(out).g31Hinweis.code, 'uebernahme');
});

test('002379.SZ: the pre-acquisition June quarter and the annual-size Q4 2025 are withheld, never 0', () => {
  const out = apply('002379.SZ');
  assert.deepEqual(native(out, 'timeseries', 'revenueQ').map(v => v === null), [false, false, true, true, false]);
  assert.equal(revQuartalsYoY(out), null);
  assert.equal(g31Shadow(out).v1.basis, 'year');
  for (const p of ['2025-12-31', '2025-06-30']) assert.ok(financialReasons(out).includes(caseOf(`002379.sz-${p}-revenueQ-20261024`).reason), p);
});

test('EYDAP.AT and MIN.AX: impossible annual pairs are withheld with their own reason', () => {
  const e = apply('EYDAP.AT');
  assert.deepEqual(e.annual.annualRev.map(value), [null, null, null, null]);
  assert.deepEqual(financialReasons(e), [caseOf('eydap.at-2025-12-31-annualRev-20261024').reason]);
  assert.equal(g31Shadow(e).v1.pct, null);
  const m = apply('MIN.AX');
  assert.deepEqual(native(m, 'annual', 'annualRev'), [6461000000, null, null, null]);
  assert.deepEqual(financialReasons(m), [caseOf('min.ax-2024-06-30-annualRev-nonadjacent-20261024').reason]);
  assert.equal(g31Shadow(m).v1.pct, null);
});

test('IONQ: the vendor EBITDA margin 0 is withheld; another vendor value is shown and logged', () => {
  const out = apply('IONQ');
  assert.equal(out.metrics.ebitdaMargins.value, null);
  assert.equal(out.metrics.ebitdaMargins.financialMissing.originalVendorRow.value, 0);
  assert.deepEqual(financialReasons(out), [table.metricHolds[0].reason]);
  // Idempotent: a second pass keeps the hold.
  assert.equal(applyFinancialCases(out).snapshot.metrics.ebitdaMargins.value, null);
  const moved = snap('IONQ'); moved.metrics.ebitdaMargins.value = -363.7;
  const r = applyFinancialCases(moved);
  assert.equal(r.snapshot.metrics.ebitdaMargins.value, -363.7);
  assert.equal(r.events.find(e => e.field === 'ebitdaMargins').reasonCode, 'metric-value-changed');
  // Validation: an unknown metric or a missing source is refused.
  for (const edit of [h => { h.metric = 'revenueGrowthYoY'; }, h => { h.sources = []; }, h => { h.expectedBadValue = NaN; }]) {
    const copy = structuredClone(table); edit(copy.metricHolds[0]);
    assert.throws(() => validateTable(copy), /Invalid metric hold/);
  }
});

test('break-once on test data: without these rows, or with a mismatching expectedBadValue, the vendor value is back or refused', () => {
  const guard = cfg => {
    assert.equal(value(apply('2498.HK', cfg).timeseries.revenueQ[0]), 560999000 * SNAPS['2498.HK'].meta.fxRateApplied);
    assert.equal(apply('EYDAP.AT', cfg).annual.annualRev[0].value, null);
    assert.equal(apply('IONQ', cfg).metrics.ebitdaMargins.value, null);
  };
  guard();
  assert.throws(() => guard(before()), assert.AssertionError);
  // A case whose expectedBadValue no longer matches the stored vendor cell never replaces it: the cell is withheld.
  const wrong = structuredClone(table);
  wrong.cases.find(c => c.caseId === '2498.hk-2026-06-30-revenueQ-20261024').expectedBadValue = 1;
  const cell = apply('2498.HK', validateTable(wrong)).timeseries.revenueQ[0];
  assert.equal(cell.value, null);
  assert.equal(cell.financialMissing.reasonCode, 'vendor-value-changed');
  const wrongHold = structuredClone(table); wrongHold.metricHolds[0].expectedBadValue = 1;
  assert.equal(apply('IONQ', validateTable(wrongHold)).metrics.ebitdaMargins.value, 0);
  assert.throws(() => guard(validateTable(wrong)), assert.AssertionError);
  assert.deepEqual(liveHashes(), beforeHashes, 'live files unchanged');
});
