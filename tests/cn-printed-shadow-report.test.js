'use strict';
const assert = require('assert/strict');
const H = require('./cn-printed.helpers');
const P = require('../scripts/cn-printed-parser');
const R = require('../scripts/cn-printed-shadow-report');
const a = H.fixture('002415.SZ'), b = H.fixture('002475.SZ');
const makeObs = f => ({ ...P.parseText(f.text, f.anchor, { ticker: f.ticker }), periodEnd: '2026-09-30',
  noticeDate: '2026-10-30', url: f.url, confirmedBy: [{ fetchedAt: '2026-11-12T12:00:00Z' }] });
const obs = makeObs(a);
const snapshot = f => ({ meta: { ticker: f.ticker, reportingCurrency: 'CNY', asOf: '2026-11-11T10:00:00Z' },
  timeseries: { revenueQEnds: ['2026-09-30', '2026-06-30', '2025-09-30', '2025-06-30'],
    revenueQ: [{ value: f.anchor.current }, { value: 120 }, null, { value: 100 }] } });
const baseline = { date: '2026-07-29', rows: new Map([[a.ticker, {}]]), warnings: [] };
const store = { sources: { run: { fetchedAt: '2026-11-12T12:00:00Z', year: 2026, mode: 'offline-sample',
  read: [a.ticker, b.ticker], parsed: 2, unparsed: 0, errors: [] } },
  companies: { [a.ticker]: { reports: { one: [obs] } }, [b.ticker]: { reports: { two: [makeObs(b)] } } } };
const cn = H.vendorStore([a, b]);
const build = overrides => R.buildReport({ store, cn, snapshots: [snapshot(a), snapshot(b)], baseline, ...overrides });
let passed = 0;
function test(name, fn) { fn(); passed++; }
test('cohorts use current snapshots and count tickers once', () => {
  const r = build();
  assert.equal(r.countingLevel, 'ticker'); assert.equal(r.cohorts['july-row'].candidates, 1);
  assert.equal(r.cohorts['no-july-row'].candidates, 1); assert.equal(r.counts.agree, 2);
  assert.equal(r.gate300, null); assert.equal(r.proposalState, 'held-until-live-300-gate');
});
test('unfetched tickers are gaps, not parser failures or a positive coverage result', () => {
  const s = JSON.parse(JSON.stringify(store)); delete s.companies[b.ticker];
  const r = build({ store: s });
  assert.equal(r.counts.unparsed, 1); assert.equal(r.rows[1].reason, 'not-fetched');
  assert.equal(r.exchanges.SZ.attempted, 1); assert.equal(r.cohorts['no-july-row'].candidateStatuses.unparsed, 1);
});
test('mixed basis on same operating line stays out of proposed fill', () => {
  const v = JSON.parse(JSON.stringify(cn)); v.companies[a.ticker].ytd['2025-09-30'][0].operate *= 1.1;
  const r = build({ cn: v }); assert.equal(r.rows[0].status, 'mixed-basis'); assert.equal(r.rows[0].proposal, null);
});
test('missing prior has its own category', () => {
  const v = JSON.parse(JSON.stringify(cn)); delete v.companies[a.ticker].ytd['2025-09-30'];
  const r = build({ cn: v }); assert.equal(r.rows[0].status, 'printed-only');
});
test('stale current store anchor invalidates old parsed value', () => {
  const v = JSON.parse(JSON.stringify(cn)); v.companies[a.ticker].ytd['2026-09-30'][0].operate *= 1.001;
  const r = build({ cn: v }); assert.equal(r.rows[0].status, 'unparsed'); assert.equal(r.rows[0].current, null);
  assert.equal(r.rows[0].reason, 'current-store-anchor-changed');
});
test('same-day before/after is explicit and input immutable', () => {
  const snaps = [snapshot(a), snapshot(b)], before = JSON.stringify(snaps);
  const r = build({ snapshots: snaps }); const p = r.rows[0].proposal;
  assert.equal(p.eligible, true); assert.equal(p.beforeCell, null);
  assert.equal(p.afterQuarterPair.growthPct, 13.71);
  assert.ok(Math.abs(p.beforeQuarterPair.growthPct - 20) < 1e-10);
  assert.equal(p.beforeQuarterPair.periodEnd, '2026-06-30');
  assert.equal(JSON.stringify(snaps), before);
});
test('no silent switch between total and operating revenue', () => {
  const s = snapshot(a); s.timeseries.revenueQ[0].value *= 1.00001;
  const r = build({ snapshots: [s] }); assert.equal(r.rows[0].proposal.eligible, false);
  assert.equal(r.rows[0].proposal.reason, 'snapshot-current-line-or-value-mismatch');
});
test('one data day only and no future notice', () => {
  const s = snapshot(b); s.meta.asOf = '2026-11-10T12:00:00Z';
  const r = build({ snapshots: [snapshot(a), s] }); assert.equal(r.dataDay, null); assert.ok(r.rows.every(r => r.proposal === null));
  const explicit = build({ snapshots: [snapshot(a), s], dataDay: '2026-11-11' });
  assert.equal(explicit.rows[1].proposal.eligible, false);
  const info = R.snapshotInfo(snapshot(a), baseline, 2026);
  assert.equal(R.proposal(info, { ...obs, noticeDate: '2026-11-12' }, P.compare(obs, a.priorAnchor), '2026-11-11').eligible, false);
});
test('FX factor, currency and unit are checked', () => {
  const s = snapshot(a); s.meta.reportingCurrency = 'USD';
  assert.equal(build({ snapshots: [s] }).rows[0].proposal.eligible, false);
  s.meta.fxConverted = true; s.meta.reportingCurrencyOriginal = 'CNY'; s.meta.fxRateApplied = 0.15;
  s.timeseries.revenueQ[0].value = a.anchor.current * 0.15;
  assert.equal(build({ snapshots: [s] }).rows[0].proposal.eligible, true);
  s.timeseries.revenueQ[0].unit = 'thousand';
  assert.equal(build({ snapshots: [s] }).rows[0].proposal.eligible, false);
});
test('existing prior cell and duplicate period are never proposed', () => {
  const s = snapshot(a); s.timeseries.revenueQ[2] = { value: 123 };
  assert.equal(build({ snapshots: [s] }).rows[0].proposal, null);
  s.timeseries.revenueQ[2] = null; s.timeseries.revenueQEnds.push('2026-09-30'); s.timeseries.revenueQ.push({ value: 99 });
  assert.equal(build({ snapshots: [s] }).rows[0].candidate, false);
});
test('duplicate snapshot ticker rejected', () => assert.throws(() => build({ snapshots: [snapshot(a), snapshot(a)] }), /duplicate-snapshot/));
test('missing July vintage never means absent July row', () => assert.equal(build({ baseline: { date: null, rows: new Map() } }).rows[0].cohort, 'baseline-unavailable'));
test('failed latest attempt supersedes stale success and newest notice supersedes old one', () => {
  const s = JSON.parse(JSON.stringify(store));
  s.sources.later = { fetchedAt: '2026-11-13T12:00:00Z', year: 2026, read: [a.ticker], errors: [{ ticker: a.ticker, reason: 'cninfo-http-503' }] };
  assert.equal(R.latestObservation(s, a.ticker, 2026).reason, 'cninfo-http-503');
  s.sources.later.errors = [];
  s.companies[a.ticker].reports.new = [{ ...obs, noticeDate: '2026-11-01', parseStatus: 'unparsed', reason: 'unknown-layout' }];
  assert.equal(R.latestObservation(s, a.ticker, 2026).reason, 'unknown-layout');
});
test('300 gate cannot pass with offline or incomplete evidence', () => {
  const s = JSON.parse(JSON.stringify(store));
  s.sources.run.read = Array.from({ length: 300 }, (_, i) => 'ticker' + i); s.sources.run.parsed = 269;
  assert.equal(build({ store: s }).gate300, null);
  s.sources.run.mode = 'live'; assert.equal(build({ store: s }).gate300, false);
  s.sources.run.parsed = 270; assert.equal(build({ store: s }).gate300, true);
  s.sources.run.read.pop(); assert.equal(build({ store: s }).gate300, null);
});
test('German report distinguishes historical denominators and uncertainty', () => {
  const text = R.markdown(build());
  assert.match(text, /Zählebene: Ticker/); assert.match(text, /1.086 und 1.222/);
  assert.match(text, /noch nicht gemessen/); assert.match(text, /OPERATE_INCOME/);
});
console.log(`${passed} shadow report tests passed (no network, no input writes).`);
