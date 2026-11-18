'use strict';
// 18.11.2026: ONE FCF margin for every board (lib/fcf-ttm.js, scripts/fcf-ttm-overlay.js).
// (A) SEC TTM from companyfacts: fiscal year, YTD arithmetic, amendments win, missing parts give a
//     reason and never a number. Oracle: MU, SNDK, ALAB, PLTR SEC figures of 18.11.2026 (check-D).
// (B) Yahoo trailing row: newest complete row, capex sign.
// (C) Choice: SEC first, vendor only without SEC TTM or with a strictly newer period end, |x| > 200 empty.
// (D) applyChoice keeps the replaced value once as fcfMarginTTMOld and empties instead of inventing.
// (E) apply end to end on temp snapshots and stores; an unreadable store stops the run.
// Hermetic: temp dirs only, no network.
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fcf-ttm-'));
process.env.FCF_TTM_SEC_STORE = path.join(tmp, 'sec.json');
process.env.FCF_TTM_VENDOR_STORE = path.join(tmp, 'vendor.json');

const T = require('../lib/fcf-ttm.js');
const O = require('../scripts/fcf-ttm-overlay.js');

let ok = 0;
function check(name, fn) { fn(); ok++; console.log('  ok   ' + name); }

const fact = (start, end, val, filed, form = '10-Q') => ({ start, end, val, filed, form });
const facts = (concepts) => ({ facts: { 'us-gaap': Object.fromEntries(Object.entries(concepts)
  .map(([k, arr]) => [k, { units: { USD: arr } }])) } });

// ALAB-shaped quarter (USD m): FY2025 + 9M 2026 - 9M 2025.
const alab = facts({
  NetCashProvidedByUsedInOperatingActivities: [
    fact('2025-01-01', '2025-12-31', 319.306, '2026-02-20', '10-K'),
    fact('2026-01-01', '2026-09-30', 341.477, '2026-11-04'),
    fact('2025-01-01', '2025-09-30', 224.041, '2026-11-04'),
  ],
  PaymentsToAcquirePropertyPlantAndEquipment: [
    fact('2025-01-01', '2025-12-31', 37.544, '2026-02-20', '10-K'),
    fact('2026-01-01', '2026-09-30', 73.363, '2026-11-04'),
    fact('2025-01-01', '2025-09-30', 18.855, '2026-11-04'),
  ],
  RevenueFromContractWithCustomerExcludingAssessedTax: [
    fact('2025-01-01', '2025-12-31', 852.525, '2026-02-20', '10-K'),
    fact('2026-01-01', '2026-09-30', 1285.660, '2026-11-04'),
    fact('2025-01-01', '2025-09-30', 581.942, '2026-11-04'),
    fact('2026-07-01', '2026-09-30', 584.899, '2026-11-04'),
  ],
});

check('A1 YTD arithmetic reproduces the SEC TTM of Astera Labs (22.1 %)', () => {
  const r = T.secTtmFromFacts(alab);
  assert.equal(r.ok, true);
  assert.equal(r.end, '2026-09-30');
  assert.ok(Math.abs(r.ocf - 436.742) < 1e-6 && Math.abs(r.capex - 92.052) < 1e-6 && Math.abs(r.revenue - 1556.243) < 1e-6);
  assert.equal(Math.round(r.margin * 10) / 10, 22.1);
});

check('A2 a fiscal year ending last is the TTM itself (Micron 44.3 %)', () => {
  const mu = facts({
    NetCashProvidedByUsedInOperatingActivities: [fact('2025-08-29', '2026-09-03', 89675, '2026-10-09', '10-K')],
    PaymentsToAcquirePropertyPlantAndEquipment: [fact('2025-08-29', '2026-09-03', 30712, '2026-10-09', '10-K')],
    RevenueFromContractWithCustomerExcludingAssessedTax: [fact('2025-08-29', '2026-09-03', 133188, '2026-10-09', '10-K')],
  });
  const r = T.secTtmFromFacts(mu);
  assert.equal(r.ok, true);
  assert.equal(r.end, '2026-09-03');
  assert.equal(Math.round(r.margin * 10) / 10, 44.3);
});

check('A3 an amendment filed later replaces the original figure of the same period', () => {
  const f = facts({
    NetCashProvidedByUsedInOperatingActivities: [fact('2025-01-01', '2025-12-31', 100, '2026-02-01', '10-K'),
      fact('2025-01-01', '2025-12-31', 80, '2026-04-01', '10-K/A')],
    PaymentsToAcquirePropertyPlantAndEquipment: [fact('2025-01-01', '2025-12-31', 10, '2026-02-01', '10-K')],
    Revenues: [fact('2025-01-01', '2025-12-31', 200, '2026-02-01', '10-K')],
  });
  assert.equal(T.secTtmFromFacts(f).ocf, 80);
});

check('A4 missing capex, missing prior YTD, IFRS-only and 20-F facts give a reason, never a number', () => {
  const noCapex = JSON.parse(JSON.stringify(alab));
  delete noCapex.facts['us-gaap'].PaymentsToAcquirePropertyPlantAndEquipment;
  assert.deepEqual(T.secTtmFromFacts(noCapex), { ok: false, reason: 'sec-no-capex' });
  const noPrior = JSON.parse(JSON.stringify(alab));
  noPrior.facts['us-gaap'].NetCashProvidedByUsedInOperatingActivities.units.USD.pop();
  assert.deepEqual(T.secTtmFromFacts(noPrior), { ok: false, reason: 'sec-no-ttm-ocf' });
  assert.deepEqual(T.secTtmFromFacts({ facts: { 'ifrs-full': {} } }), { ok: false, reason: 'sec-no-us-gaap' });
  const twentyF = facts({ NetCashProvidedByUsedInOperatingActivities: [fact('2025-01-01', '2025-12-31', 5, '2026-03-01', '20-F')] });
  assert.deepEqual(T.secTtmFromFacts(twentyF), { ok: false, reason: 'sec-no-ocf' });
});

check('A5 a discrete quarter without a fiscal year right before it is no YTD (no TTM)', () => {
  const f = facts({
    NetCashProvidedByUsedInOperatingActivities: [fact('2025-01-01', '2025-12-31', 100, '2026-02-01', '10-K'),
      fact('2026-04-01', '2026-06-30', 30, '2026-08-01'), fact('2025-04-01', '2025-06-30', 20, '2026-08-01')],
  });
  assert.equal(T.secTtmFromFacts(f).reason, 'sec-no-ttm-ocf');
});

check('B1 Yahoo trailing: newest complete row, capex is negative at Yahoo', () => {
  const r = T.vendorTtmFromRows([
    { date: 1751241600, operatingCashFlow: 7189, capitalExpenditure: -790, totalRevenue: 30000 },
    { date: 1790726400, operatingCashFlow: 9883, capitalExpenditure: -701, totalRevenue: 39387 },
    { date: 1782777600 },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.end, '2026-09-30');
  assert.equal(r.fcf, 9182);
  assert.equal(T.vendorTtmFromRows([{ date: 1, operatingCashFlow: 5 }]).reason, 'vendor-no-ttm');
});

const sec = { ok: true, end: '2026-09-30', margin: 22.1 };
check('C1 SEC wins over Yahoo for the same or an older Yahoo period', () => {
  assert.equal(T.chooseFcfMargin({ sec, vendor: { ok: true, end: '2026-09-30', margin: 8 } }).source, 'sec-ttm');
  assert.equal(T.chooseFcfMargin({ sec, vendor: { ok: true, end: '2026-06-30', margin: 8 } }).value, 22.1);
});
check('C2 Yahoo only without SEC TTM or with a strictly newer period (G31)', () => {
  assert.equal(T.chooseFcfMargin({ sec: { ok: false, reason: 'sec-no-capex' }, vendor: { ok: true, end: '2026-06-30', margin: 8 } }).source, 'yahoo-fts-ttm');
  const newer = T.chooseFcfMargin({ sec, vendor: { ok: true, end: '2026-12-31', margin: 9 } });
  assert.deepEqual([newer.source, newer.periodEnd], ['yahoo-fts-ttm', '2026-12-31']);
});
check('C3 nothing usable: empty with both reasons; beyond 200 % empty and suppressed', () => {
  assert.deepEqual(T.chooseFcfMargin({ sec: { ok: false, reason: 'sec-no-capex' }, vendor: { ok: false, reason: 'vendor-no-ttm' } }),
    { value: null, source: null, periodEnd: null, reason: 'sec-no-capex,vendor-no-ttm', suppressed: false });
  const big = T.chooseFcfMargin({ sec: { ok: true, end: '2026-09-30', margin: -950 }, vendor: null });
  assert.deepEqual([big.value, big.suppressed], [null, true]);
});

check('C4 a TTM ending more than 100 days before the newest quarter is stale and not used (G31)', () => {
  const old = { ok: true, end: '2025-06-30', margin: 41.7 };
  const c = T.chooseFcfMargin({ sec: null, vendor: old, newestQuarterEnd: '2026-09-30' });
  assert.deepEqual([c.value, c.reason], [null, 'vendor-ttm-stale']);
  // SEC stale but a fresh vendor row: the fresh one is used
  const c2 = T.chooseFcfMargin({ sec: { ok: true, end: '2025-12-31', margin: 30 }, vendor: { ok: true, end: '2026-09-30', margin: 20 }, newestQuarterEnd: '2026-09-30' });
  assert.equal(c2.source, 'yahoo-fts-ttm');
  // within one quarter: still used; no quarter end known: no age test
  assert.equal(T.chooseFcfMargin({ sec, vendor: null, newestQuarterEnd: '2026-12-31' }).value, 22.1);
  assert.equal(T.chooseFcfMargin({ sec: null, vendor: old, newestQuarterEnd: null }).value, 41.7);
  assert.equal(O.newestQuarterEnd({ timeseries: { revenueQEnds: [null, '2026-09-30', '2026-06-30'] } }), '2026-09-30');
});

check('D1 applyChoice keeps the replaced value once and labels the period', () => {
  const s = { meta: { ticker: 'ALAB' }, metrics: { fcfMarginTTM: { value: 8.44, source: 'yahoo_quoteSummary' } } };
  assert.equal(O.applyChoice(s, { value: 22.1, source: 'sec-ttm', periodEnd: '2026-09-30', reason: null, suppressed: false }), true);
  assert.equal(s.metrics.fcfMarginTTM.value, 22.1);
  assert.equal(s.metrics.fcfMarginTTMOld.value, 8.44);
  assert.equal(s.metrics.fcfMarginTTMOld.until, T.OLD_COMPARISON_UNTIL);
  assert.deepEqual([s.meta.fcfMarginTTMSource, s.meta.fcfMarginTTMPeriodEnd], ['sec-ttm', '2026-09-30']);
  // second run: idempotent, the comparison is not overwritten with the new value
  assert.equal(O.applyChoice(s, { value: 22.1, source: 'sec-ttm', periodEnd: '2026-09-30', reason: null, suppressed: false }), false);
  assert.equal(s.metrics.fcfMarginTTMOld.value, 8.44);
});
check('D2 no source: the margin is removed (never 0), the reason stays on the row', () => {
  const s = { meta: { ticker: 'X' }, metrics: { fcfMarginTTM: { value: 12, source: 'yahoo_quoteSummary' } } };
  O.applyChoice(s, { value: null, source: null, periodEnd: null, reason: 'sec-no-capex,vendor-no-ttm', suppressed: false });
  assert.equal('fcfMarginTTM' in s.metrics, false);
  assert.equal(s.meta.fcfMarginTTMReason, 'sec-no-capex,vendor-no-ttm');
});

check('E1 apply end to end: US listing from SEC, foreign listing from Yahoo, store failure stops', () => {
  const dir = path.join(tmp, 'snaps');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'MU.json'), JSON.stringify({ meta: { ticker: 'MU' }, metrics: { fcfMarginTTM: { value: 21.9, source: 'yahoo_quoteSummary' } } }));
  fs.writeFileSync(path.join(dir, 'SAP.DE.json'), JSON.stringify({ meta: { ticker: 'SAP.DE' }, metrics: { fcfMarginTTM: { value: 20, source: 'yahoo_quoteSummary' } } }));
  fs.writeFileSync(process.env.FCF_TTM_SEC_STORE, JSON.stringify({ byCik: { '0000723125': { ok: true, end: '2026-09-03', margin: 44.27 } } }));
  fs.writeFileSync(process.env.FCF_TTM_VENDOR_STORE, JSON.stringify({ byTicker: { 'SAP.DE': { ok: true, end: '2026-09-30', margin: 23.3 },
    MU: { ok: true, end: '2026-09-03', margin: 44.27 } } }));
  const c = O.apply([dir], null);
  assert.equal(c['sec-ttm'], 1);
  assert.equal(c['yahoo-fts-ttm'], 1);
  const mu = JSON.parse(fs.readFileSync(path.join(dir, 'MU.json'), 'utf8'));
  assert.deepEqual([mu.metrics.fcfMarginTTM.value, mu.metrics.fcfMarginTTM.source, mu.metrics.fcfMarginTTMOld.value], [44.27, 'sec-ttm', 21.9]);
  fs.writeFileSync(process.env.FCF_TTM_SEC_STORE, '{"broken":');
  assert.throws(() => O.apply([dir], null));
});

// (F) The board guard: write-rule40-export.js --check rejects a row whose margin did not go through
//     the TTM switch (source of the replaced Yahoo financialData field, or no period end).
const R40 = require('../scripts/write-rule40-export.js');
const { snapshot, boardZeile, baueExport } = require('./rule40-fixture.js');
function r40Fehler(snapOver) {
  const f = baueExport([{ row: boardZeile({ ticker: 'AAA', revGrowthYoYPct: 60 }), snap: snapshot(Object.assign({ fcfMarginTTM: 30 }, snapOver)) }]);
  try {
    R40.build({ v1Dir: f.v1Dir, snapshotsDir: f.snapshotsDir, outDir: f.outDir });
    return R40.check({ v1Dir: f.v1Dir, outDir: f.outDir }).errors || [];
  } finally { f.aufraeumen(); }
}
check('F1 guard green on a TTM row, red on the replaced source and on a missing period end', () => {
  const tag = (errs) => errs.filter((e) => /TTM-Quelle|fcfMarginPeriodEnd/.test(e));
  assert.deepEqual(tag(r40Fehler({})), []);
  assert.equal(tag(r40Fehler({ fcfMarginTTMSource: 'yahoo_quoteSummary' })).length, 1);
  assert.equal(tag(r40Fehler({ fcfMarginTTMPeriodEnd: null })).length, 1);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`fcf-ttm: ${ok} checks passed`);
