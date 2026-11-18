'use strict';
// 18.11.2026: ONE FCF margin for every board (lib/fcf-ttm.js, scripts/fcf-ttm-overlay.js).
// (A) SEC TTM from companyfacts: fiscal year, YTD arithmetic, amendments win, capex lines, missing parts
//     give a reason and never a number. Oracles: ALAB and MU SEC figures of 18.11.2026 (plan 3, check D).
// (B) Yahoo trailing row: newest complete row, capex sign.
// (C) Choice: SEC first but cross-checked against a Yahoo row of the same period (month-end dates count
//     as the same period); a mismatch falls back to Yahoo with the reason (EOG capex, FIX/bank revenue);
//     a newer Yahoo period wins; stale rows are not used; beyond 200 % the other source is tried.
// (D) applyChoice keeps the replaced value once (outside metrics), drops it after its end date, and
//     empties instead of inventing.
// (E) apply end to end; a missing or unreadable store and a collapsed SEC path stop the run.
// (F) The board guard reads the metric's own source and period.
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
const alabConcepts = {
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
};
const alab = facts(alabConcepts);
const fy = (val) => [fact('2025-01-01', '2025-12-31', val, '2026-02-20', '10-K')];

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
  assert.equal(r.end, '2026-09-03');
  assert.equal(Math.round(r.margin * 10) / 10, 44.3);
});

check('A3 an amendment filed later replaces the original figure of the same period', () => {
  const f = facts({
    NetCashProvidedByUsedInOperatingActivities: [fact('2025-01-01', '2025-12-31', 100, '2026-02-01', '10-K'),
      fact('2025-01-01', '2025-12-31', 80, '2026-04-01', '10-K/A')],
    PaymentsToAcquirePropertyPlantAndEquipment: fy(10),
    Revenues: fy(200),
  });
  assert.equal(T.secTtmFromFacts(f).ocf, 80);
});

check('A4 capex lines: software added, oil-and-gas without PP&E, a lone "other PP&E" line is no capex', () => {
  const base = { NetCashProvidedByUsedInOperatingActivities: fy(100), Revenues: fy(400) };
  const soft = T.secTtmFromFacts(facts({ ...base, PaymentsToAcquirePropertyPlantAndEquipment: fy(10), PaymentsToDevelopSoftware: fy(15) }));
  assert.equal(soft.capex, 25);
  const oil = T.secTtmFromFacts(facts({ ...base, PaymentsToAcquireOilAndGasPropertyAndEquipment: fy(60) }));
  assert.equal(oil.capex, 60);
  assert.equal(T.secTtmFromFacts(facts({ ...base, PaymentsToAcquireOtherPropertyPlantAndEquipment: fy(5) })).reason, 'sec-no-capex');
  assert.equal(T.secTtmFromFacts(facts({ ...base, PaymentsToAcquirePropertyPlantAndEquipment: fy(-3) })).reason, 'sec-negative-capex');
});

check('A5 missing parts, IFRS-only, 20-F and a discrete quarter give a reason, never a number', () => {
  const noCapex = JSON.parse(JSON.stringify(alab));
  delete noCapex.facts['us-gaap'].PaymentsToAcquirePropertyPlantAndEquipment;
  assert.deepEqual(T.secTtmFromFacts(noCapex), { ok: false, reason: 'sec-no-capex' });
  const noPrior = JSON.parse(JSON.stringify(alab));
  noPrior.facts['us-gaap'].NetCashProvidedByUsedInOperatingActivities.units.USD.pop();
  assert.deepEqual(T.secTtmFromFacts(noPrior), { ok: false, reason: 'sec-no-ttm-ocf' });
  assert.deepEqual(T.secTtmFromFacts({ facts: { 'ifrs-full': {} } }), { ok: false, reason: 'sec-no-us-gaap' });
  assert.deepEqual(T.secTtmFromFacts(facts({ NetCashProvidedByUsedInOperatingActivities: [fact('2025-01-01', '2025-12-31', 5, '2026-03-01', '20-F')] })),
    { ok: false, reason: 'sec-no-ocf' });
  const discrete = facts({ NetCashProvidedByUsedInOperatingActivities: [...fy(100),
    fact('2026-04-01', '2026-06-30', 30, '2026-08-01'), fact('2025-04-01', '2025-06-30', 20, '2026-08-01')] });
  assert.equal(T.secTtmFromFacts(discrete).reason, 'sec-no-ttm-ocf');
});

check('B1 Yahoo trailing: newest complete row, capex is negative at Yahoo', () => {
  const r = T.vendorTtmFromRows([
    { date: 1751241600, operatingCashFlow: 7189, capitalExpenditure: -790, totalRevenue: 30000 },
    { date: 1790726400, operatingCashFlow: 9883, capitalExpenditure: -701, totalRevenue: 39387 },
    { date: 1782777600 },
  ]);
  assert.deepEqual([r.ok, r.end, r.fcf], [true, '2026-09-30', 9182]);
  assert.equal(T.vendorTtmFromRows([{ date: 1, operatingCashFlow: 5 }]).reason, 'vendor-no-ttm');
});

// Store entries as the refresh writes them.
const secE = (o) => Object.assign({ ok: true, end: '2026-09-30', ocf: 436.7, capex: 92.1, revenue: 1556.2,
  revenues: { RevenueFromContractWithCustomerExcludingAssessedTax: 1556.2 }, margin: 22.15 }, o);
const venE = (o) => Object.assign({ ok: true, end: '2026-09-30', ocf: 436.7, capex: 92.1, revenue: 1556.2, margin: 22.15 }, o);

check('C1 agreeing SEC and Yahoo of the same period: SEC; month-end Yahoo dates are the same period', () => {
  assert.equal(T.chooseFcfMargin({ sec: secE(), vendor: venE() }).source, 'sec-ttm');
  const aapl = T.chooseFcfMargin({ sec: secE({ end: '2026-09-26' }), vendor: venE({ end: '2026-09-30' }) });
  assert.deepEqual([aapl.source, aapl.periodEnd], ['sec-ttm', '2026-09-26']);
});

check('C2 SEC extraction disagreeing with Yahoo of the same period falls back to Yahoo with the reason', () => {
  // EOG: SEC capex 0.53 bn vs Yahoo 6.68 bn
  const eog = T.chooseFcfMargin({ sec: secE({ ocf: 10, capex: 0.53, revenue: 22, revenues: { Revenues: 22 }, margin: 43 }),
    vendor: venE({ ocf: 10.2, capex: 6.68, revenue: 22.4, margin: 15.7 }) });
  assert.deepEqual([eog.source, eog.reason], ['yahoo-fts-ttm', 'sec-yahoo-mismatch-capex']);
  // FIX / banks: no SEC revenue concept near Yahoo's total revenue
  const fix = T.chooseFcfMargin({ sec: secE({ revenue: 5.27, revenues: { Revenues: 5.27 }, ocf: 2.6, capex: 0.17 }),
    vendor: venE({ revenue: 12.5, ocf: 2.6, capex: 0.17, margin: 19.4 }) });
  assert.deepEqual([fix.source, fix.reason], ['yahoo-fts-ttm', 'sec-yahoo-mismatch-revenue']);
  // the SEC revenue concept closest to Yahoo is taken (excise tax: excluding vs including)
  const mo = T.chooseFcfMargin({ sec: secE({ ocf: 9, capex: 0.2, revenue: 20.4,
    revenues: { RevenueFromContractWithCustomerExcludingAssessedTax: 20.4, RevenueFromContractWithCustomerIncludingAssessedTax: 25.1 } }),
    vendor: venE({ ocf: 9, capex: 0.2, revenue: 20.5 }) });
  assert.deepEqual([mo.source, Math.round(mo.value * 10) / 10], ['sec-ttm', 43.1]);
});

check('C3 a Yahoo row more than 20 days newer wins (G31); an older one never replaces SEC', () => {
  const newer = T.chooseFcfMargin({ sec: secE({ end: '2026-06-30' }), vendor: venE({ end: '2026-09-30', margin: 30 }) });
  assert.deepEqual([newer.source, newer.reason], ['yahoo-fts-ttm', 'yahoo-newer']);
  const older = T.chooseFcfMargin({ sec: secE(), vendor: venE({ end: '2026-06-30', margin: 8 }) });
  assert.deepEqual([older.source, older.value], ['sec-ttm', 22.15]);
  assert.equal(T.chooseFcfMargin({ sec: { ok: false, reason: 'sec-no-capex' }, vendor: venE() }).source, 'yahoo-fts-ttm');
});

check('C4 stale rows are not used: 100 days behind the newest quarter or 450 days before the run day', () => {
  const old = venE({ end: '2025-06-30', margin: 41.7 });
  assert.deepEqual([T.chooseFcfMargin({ sec: null, vendor: old, newestQuarterEnd: '2026-09-30' }).reason], ['vendor-ttm-stale']);
  assert.equal(T.chooseFcfMargin({ sec: null, vendor: venE({ end: '2012-12-31' }), newestQuarterEnd: '2012-12-31', today: '2026-11-18' }).reason, 'vendor-ttm-stale');
  assert.equal(T.chooseFcfMargin({ sec: null, vendor: old, newestQuarterEnd: null, today: '2026-08-01' }).value, 41.7);
  const c2 = T.chooseFcfMargin({ sec: secE({ end: '2025-12-31' }), vendor: venE({ margin: 20 }), newestQuarterEnd: '2026-09-30' });
  assert.equal(c2.source, 'yahoo-fts-ttm');
  assert.equal(O.newestQuarterEnd({ timeseries: { revenueQEnds: [null, '2026-09-30', '2026-06-30'] } }), '2026-09-30');
});

check('C5 beyond 200 %: the other source is tried, else suppressed; nothing usable: empty with reasons', () => {
  const cpt = T.chooseFcfMargin({ sec: secE({ end: '2026-06-30', margin: 4726 }), vendor: null });
  assert.deepEqual([cpt.value, cpt.suppressed], [null, true]);
  assert.deepEqual(T.chooseFcfMargin({ sec: { ok: false, reason: 'sec-no-capex' }, vendor: { ok: false, reason: 'vendor-no-ttm' } }),
    { value: null, source: null, periodEnd: null, reason: 'sec-no-capex,vendor-no-ttm', suppressed: false });
});

check('D1 applyChoice keeps the replaced value once outside metrics, labels the period, asOf is the run day', () => {
  const s = { meta: { ticker: 'ALAB' }, metrics: { fcfMarginTTM: { value: 8.44, source: 'yahoo_quoteSummary', asOf: '2026-11-04' } } };
  const ch = { value: 22.1, source: 'sec-ttm', periodEnd: '2026-09-30', reason: null, suppressed: false };
  assert.equal(O.applyChoice(s, ch, '2026-11-18'), true);
  assert.deepEqual(s.metrics.fcfMarginTTM, { value: 22.1, source: 'sec-ttm', confidence: 0.95, asOf: '2026-11-18', periodEnd: '2026-09-30' });
  assert.equal('fcfMarginTTMOld' in s.metrics, false);
  assert.deepEqual([s.meta.fcfMarginTTMOld.value, s.meta.fcfMarginTTMOld.until], [8.44, T.OLD_COMPARISON_UNTIL]);
  assert.equal(O.applyChoice(s, ch, '2026-11-18'), false); // idempotent
  assert.equal(s.meta.fcfMarginTTMOld.value, 8.44);
});

check('D2 the comparison ends after its day; no source: the margin is removed (never 0)', () => {
  const s = { meta: { ticker: 'X' }, metrics: { fcfMarginTTM: { value: 12, source: 'yahoo_quoteSummary' } } };
  O.applyChoice(s, { value: null, source: null, periodEnd: null, reason: 'sec-no-capex,vendor-no-ttm', suppressed: false }, '2026-11-18');
  assert.equal('fcfMarginTTM' in s.metrics, false);
  assert.equal(s.meta.fcfMarginTTMReason, 'sec-no-capex,vendor-no-ttm');
  assert.equal(s.meta.fcfMarginTTMOld.value, 12);
  O.applyChoice(s, { value: null, source: null, periodEnd: null, reason: 'x', suppressed: false }, '2026-12-17');
  assert.equal('fcfMarginTTMOld' in s.meta, false);
});

const dir = path.join(tmp, 'snaps');
fs.mkdirSync(dir);
const writeSnaps = () => {
  fs.writeFileSync(path.join(dir, 'MU.json'), JSON.stringify({ meta: { ticker: 'MU' }, metrics: { fcfMarginTTM: { value: 21.9, source: 'yahoo_quoteSummary' } } }));
  fs.writeFileSync(path.join(dir, 'SAP.DE.json'), JSON.stringify({ meta: { ticker: 'SAP.DE' }, metrics: { fcfMarginTTM: { value: 20, source: 'yahoo_quoteSummary' } } }));
  fs.writeFileSync(path.join(dir, '_manifest.json'), JSON.stringify({ meta: { ticker: 'NOT-A-SNAPSHOT' } }));
};
const writeStores = () => {
  fs.writeFileSync(process.env.FCF_TTM_SEC_STORE, JSON.stringify({ byCik: { '0000723125': secE({ end: '2026-09-03', ocf: 89675, capex: 30712,
    revenue: 133188, revenues: { RevenueFromContractWithCustomerExcludingAssessedTax: 133188 }, margin: 44.27 }) } }));
  fs.writeFileSync(process.env.FCF_TTM_VENDOR_STORE, JSON.stringify({ byTicker: { 'SAP.DE': venE({ margin: 23.3 }),
    MU: venE({ end: '2026-08-31', ocf: 89675, capex: 30712, revenue: 133188, margin: 44.27 }) } }));
};

check('E1 apply end to end: US listing from SEC, foreign listing from Yahoo, metadata files skipped', () => {
  writeSnaps(); writeStores();
  const c = O.apply([dir], null, '2026-11-18');
  assert.deepEqual([c['sec-ttm'], c['yahoo-fts-ttm'], c.total], [1, 1, 2]);
  const mu = JSON.parse(fs.readFileSync(path.join(dir, 'MU.json'), 'utf8'));
  assert.deepEqual([Math.round(mu.metrics.fcfMarginTTM.value * 100) / 100, mu.metrics.fcfMarginTTM.source, mu.meta.fcfMarginTTMOld.value], [44.27, 'sec-ttm', 21.9]);
});

check('E2 a missing store, an unreadable store and a collapsed SEC path stop the run before writing', () => {
  writeSnaps();
  fs.rmSync(process.env.FCF_TTM_SEC_STORE);
  assert.throws(() => O.apply([dir], null, '2026-11-18'), /missing/);
  fs.writeFileSync(process.env.FCF_TTM_SEC_STORE, '{"broken":');
  assert.throws(() => O.apply([dir], null, '2026-11-18'));
  // 1,000 US listings and not one SEC margin: the floor guard stops before any snapshot is written
  writeStores();
  fs.writeFileSync(process.env.FCF_TTM_SEC_STORE, JSON.stringify({ byCik: {} }));
  const map = require('../external-data/sec-ticker-cik-map.json').byTicker;
  const big = path.join(tmp, 'big'); fs.mkdirSync(big);
  const tickers = Object.keys(map).filter((t) => !t.includes('.')).slice(0, 1000);
  for (const t of tickers) fs.writeFileSync(path.join(big, t.replace(/[^A-Za-z0-9-]/g, '_') + '.json'), JSON.stringify({ meta: { ticker: t }, metrics: {} }));
  const before = fs.readFileSync(path.join(big, fs.readdirSync(big)[0]), 'utf8');
  assert.throws(() => O.apply([big], null, '2026-11-18'), /floor/);
  assert.equal(fs.readFileSync(path.join(big, fs.readdirSync(big)[0]), 'utf8'), before);
});

check('E3 re-reads are spread over 14 days by CIK', () => {
  const days = new Set(['0000723125', '0001736297', '0001321655', '0002023554', '0000320193'].map(O.recheckDays));
  assert.ok(days.size > 1 && [...days].every((d) => d >= 23 && d <= 36));
});

// (G) Codex review round 2 regressions.
check('G1 EOG: oil-and-gas line plus "other PP&E" are both capex (6,148 + 530)', () => {
  const r = T.secTtmFromFacts(facts({ NetCashProvidedByUsedInOperatingActivities: fy(14060),
    PaymentsToAcquireOilAndGasPropertyAndEquipment: fy(6148), PaymentsToAcquireOtherPropertyPlantAndEquipment: fy(530), Revenues: fy(29728) }));
  assert.equal(r.capex, 6678);
  assert.equal(Math.round(r.margin * 10) / 10, 24.8);
  // the combined productive-assets line takes no add-ons (no double count)
  const pa = T.secTtmFromFacts(facts({ NetCashProvidedByUsedInOperatingActivities: fy(100),
    PaymentsToAcquireProductiveAssets: fy(30), PaymentsToAcquireOtherPropertyPlantAndEquipment: fy(5), Revenues: fy(400) }));
  assert.equal(pa.capex, 30);
});
check('G2 VET: negative Yahoo capex is rejected with a reason, also for stored entries', () => {
  assert.equal(T.vendorTtmFromRows([{ date: 1790726400, operatingCashFlow: 600, capitalExpenditure: 504.7, totalRevenue: 1820 }]).reason, 'vendor-negative-capex');
  const c = T.chooseFcfMargin({ sec: null, vendor: venE({ capex: -504.7, margin: 60.8 }) });
  assert.deepEqual([c.value, c.reason], [null, 'vendor-invalid-entry']);
});
check('G3 an eleven-month 10-KT is not twelve months; 52- and 53-week years are', () => {
  const kt = facts({ NetCashProvidedByUsedInOperatingActivities: [fact('2025-12-01', '2026-10-31', 120, '2026-12-20', '10-KT')],
    PaymentsToAcquirePropertyPlantAndEquipment: [fact('2025-12-01', '2026-10-31', 20, '2026-12-20', '10-KT')],
    Revenues: [fact('2025-12-01', '2026-10-31', 400, '2026-12-20', '10-KT')] });
  assert.equal(T.secTtmFromFacts(kt).ok, false);
  const w53 = facts({ NetCashProvidedByUsedInOperatingActivities: [fact('2025-08-29', '2026-09-03', 100, '2026-10-09', '10-K')],
    PaymentsToAcquirePropertyPlantAndEquipment: [fact('2025-08-29', '2026-09-03', 10, '2026-10-09', '10-K')],
    Revenues: [fact('2025-08-29', '2026-09-03', 400, '2026-10-09', '10-K')] });
  assert.equal(T.secTtmFromFacts(w53).ok, true); // 371 days
});
check('G4 the newest period across both OCF concepts wins (concept switch)', () => {
  const f = facts({
    NetCashProvidedByUsedInOperatingActivities: fy(100),
    NetCashProvidedByUsedInOperatingActivitiesContinuingOperations: [...fy(100),
      fact('2026-01-01', '2026-09-30', 90, '2026-11-05'), fact('2025-01-01', '2025-09-30', 60, '2026-11-05')],
    PaymentsToAcquirePropertyPlantAndEquipment: [...fy(10), fact('2026-01-01', '2026-09-30', 9, '2026-11-05'), fact('2025-01-01', '2025-09-30', 7, '2026-11-05')],
    Revenues: [...fy(480), fact('2026-01-01', '2026-09-30', 380, '2026-11-05'), fact('2025-01-01', '2025-09-30', 340, '2026-11-05')],
  });
  const r = T.secTtmFromFacts(f);
  // (100 + 90 - 60) - (10 + 9 - 7) = 118 over 480 + 380 - 340 = 520
  assert.deepEqual([r.end, Math.round(r.margin * 10000) / 10000], ['2026-09-30', 22.6923]);
});
check('G5 impossible or future period ends are unusable; the export guard also rejects them', () => {
  assert.equal(T.isCalendarDay('2026-99-99'), false);
  assert.equal(T.isCalendarDay('2026-02-30'), false);
  assert.equal(T.chooseFcfMargin({ sec: secE({ end: '2026-99-99' }), vendor: null, today: '2026-11-18' }).reason, 'sec-invalid-entry');
  assert.equal(T.chooseFcfMargin({ sec: secE({ end: '2099-09-30' }), vendor: null, today: '2026-11-18' }).reason, 'sec-invalid-entry');
  // round 3: the whole string is the date, no prefix match
  assert.equal(T.isCalendarDay('2012-12-31T00:00:00Z'), false);
  assert.equal(T.isCalendarDay('2026-09-30garbage'), false);
  assert.equal(T.chooseFcfMargin({ sec: secE({ end: '2026-09-30garbage' }), vendor: null, today: '2026-11-18' }).reason, 'sec-invalid-entry');
});
check('G6 Yahoo retries: a failed read is retried after a day, a good one only after a newer full pull', () => {
  const now = Date.parse('2026-11-19T10:00:00Z');
  const good = { ok: true, fetchedAt: '2026-11-10T00:00:00Z' };
  assert.equal(O.vendorDue(good, '2026-11-05T00:00:00Z', now), false);
  assert.equal(O.vendorDue(good, '2026-11-18T00:00:00Z', now), true);
  assert.equal(O.vendorDue({ ...good, lastAttemptAt: '2026-11-19T08:00:00Z' }, '2026-11-18T00:00:00Z', now), false);
  assert.equal(O.vendorDue({ ...good, lastAttemptAt: '2026-11-18T08:00:00Z' }, '2026-11-18T00:00:00Z', now), true);
  assert.equal(O.vendorDue({ ok: false, reason: 'vendor-not-found', fetchedAt: '2026-11-18T08:00:00Z' }, null, now), true);
  assert.equal(O.vendorDue({ ok: false, reason: 'vendor-not-found', fetchedAt: '2026-11-19T08:00:00Z' }, null, now), false);
});
check('G7 a suppressed margin whose period moves is written again (change detection)', () => {
  const s = { meta: { ticker: 'S' }, metrics: {} };
  O.applyChoice(s, { value: null, source: null, periodEnd: '2026-06-30', reason: 'abs-margin-over-200', suppressed: true }, '2026-11-18');
  assert.equal(O.applyChoice(s, { value: null, source: null, periodEnd: '2026-09-30', reason: 'abs-margin-over-200', suppressed: true }, '2026-11-18'), true);
  assert.equal(s.meta.fcfMarginTTMPeriodEnd, '2026-09-30');
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

// G8 (async, stubbed network): a filer found in the daily index but not read this run (max=1) stays
// pending and is read the next day, although the cursor moved past its index day.
async function g8() {
  const snaps = path.join(tmp, 'g8'); fs.mkdirSync(snaps);
  for (const t of ['MU', 'ALAB']) fs.writeFileSync(path.join(snaps, t + '.json'), JSON.stringify({ meta: { ticker: t }, metrics: {} }));
  // both read on 10.11., before their filing of 13.11.; one of them already read again (16.11.) must not re-enter
  const prior = { '0000723125': secE({ fetchedAt: '2026-11-10' }), '0001736297': secE({ fetchedAt: '2026-11-10' }) };
  fs.writeFileSync(process.env.FCF_TTM_SEC_STORE, JSON.stringify({ byCik: prior, lastIndexDate: '2026-11-12' }));
  const realFetch = global.fetch, realDate = process.env.RUN_DATE_UTC, realContact = process.env.SEC_CONTACT;
  const reads = [];
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('form.20261113.idx')) {
      const body = '10-Q   MICRON   723125   20261113   x\n10-Q   ASTERA   1736297   20261113   y\n';
      return { status: 200, ok: true, text: async () => body };
    }
    if (u.includes('/daily-index/')) return { status: 404, ok: false };
    reads.push(u.match(/CIK(\d+)/)[1]);
    return { status: 200, ok: true, json: async () => alab };
  };
  try {
    process.env.SEC_CONTACT = 'test admin@example.org';
    process.env.RUN_DATE_UTC = '2026-11-18';
    await O.refreshSec([snaps], 1, 1);
    let st = JSON.parse(fs.readFileSync(process.env.FCF_TTM_SEC_STORE, 'utf8'));
    assert.equal(reads.length, 1);
    assert.equal(st.pendingCiks.length, 1);
    assert.equal(st.lastIndexDate, '2026-11-13');
    process.env.RUN_DATE_UTC = '2026-11-19';
    await O.refreshSec([snaps], 1, 1);
    st = JSON.parse(fs.readFileSync(process.env.FCF_TTM_SEC_STORE, 'utf8'));
    assert.equal(reads.length, 2);
    assert.notEqual(reads[0], reads[1]);
    assert.deepEqual(st.pendingCiks, []);
  } finally {
    global.fetch = realFetch;
    if (realDate === undefined) delete process.env.RUN_DATE_UTC; else process.env.RUN_DATE_UTC = realDate;
    if (realContact === undefined) delete process.env.SEC_CONTACT; else process.env.SEC_CONTACT = realContact;
  }
  ok++; console.log('  ok   G8 a filer not read this run stays pending and is read the next day');
}

g8().then(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`fcf-ttm: ${ok} checks passed`);
}).catch((e) => { console.error(e); process.exitCode = 1; });
