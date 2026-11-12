'use strict';
// sd-halbjahr (12.11.2026): Hong Kong half-year reporters showed fiscal 2025 although the interim to 30.06.2026 was out
// since August, because Yahoo delivers no six-month figures. G31 now takes the newest Eastmoney interim pair that passes
// the G2 conditions of lib/hk-interim.js. Fixtures: real cells, see tests/fixtures/hk-interim.json.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const H = require('../lib/hk-interim.js');
const G = require('../lib/g31-recency.js');
const axes = require('../src/scoring/axes.js');
const { revGrowthLeg } = require('../lib/rev-growth-basis.js');
const { captureSnapshot } = require('../lib/export-provenance.js');
const F = require('./fixtures/hk-interim.json');
const fetchHk = require('../scripts/fetch-hk-interims.js');

const snap = (t) => structuredClone(F.snapshots[t]);
const ORIGINAL_DEFAULT_STORE = H.defaultStore;
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const withStore = (store, fn) => {
  const prev = H.defaultStore;
  H.defaultStore = () => store;
  try { return fn(); } finally { H.defaultStore = prev; }
};
const withDay = (d, fn) => {
  const prev = process.env.RUN_DATE_UTC;
  if (d === null) delete process.env.RUN_DATE_UTC; else process.env.RUN_DATE_UTC = d;
  try { return fn(); } finally { if (prev === undefined) delete process.env.RUN_DATE_UTC; else process.env.RUN_DATE_UTC = prev; }
};
const POP_H1 = (17172921000 / 13876276000 - 1) * 100; // 23.757 %, Eastmoney prints 23.7574187772
const popHalf = (st) => st.companies['9992.HK'].halfYear['2026-06-30'][0];
const popYear = (st) => st.companies['9992.HK'].fiscalYear['2025-12-31'][0];

test('Pop Mart: the interim to 30.06.2026 replaces fiscal 2025 (+184.7 % -> +23.8 %), label, axis and bonus agree', () => withDay(null, () => withStore(F.store, () => {
  const s = snap('9992.HK');
  const leg = revGrowthLeg(s);
  assert.deepEqual([leg.basis, leg.periodEnd, leg.priorPeriodEnd, leg.sourcePeriodEnd], ['halfYear', '2026-06-30', '2025-06-30', '2026-06-30']);
  close(leg.pct, POP_H1);
  assert.equal(G.g31Shadow(s).v1.label, 'Halbjahr bis 30.06.2026');
  close(axes.revGrowthLevel(s), POP_H1);
  const bonus = G.g31Shadow(s).v1.bonusComponents;
  assert.equal(bonus.length, 2);
  assert.ok(Math.abs(bonus[1] - POP_H1 / 100) < 1e-12);
  // No quarter diagnostic is attached to a pair that is not in revenueQ.
  assert.equal(G.g31Hinweis(s), null);
  // The legacy comparison arm keeps the recorded fiscal year.
  assert.deepEqual(G.withG31Variant('legacy', () => revGrowthLeg(s).basis), 'yearNewerRecord');
})));

test('Pop Mart: the export provenance cites both Eastmoney operands with periods, reading time and rate', () => withDay(null, () => withStore(F.store, () => {
  const c = captureSnapshot(snap('9992.HK'));
  assert.equal(c.inputs.length, 2);
  const [cur, prior] = c.inputs;
  assert.equal(cur.provider, 'Eastmoney (RPT_HKF10_FN_MAININDICATOR)');
  assert.deepEqual([cur.periodStart, cur.periodEnd, cur.nativeValue, cur.nativeCurrency, cur.retrievedAt],
    ['2026-01-01', '2026-06-30', 17172921000, 'CNY', popHalf(F.store).confirmedBy[0].fetchedAt]);
  assert.deepEqual([prior.periodEnd, prior.nativeValue], ['2025-06-30', 13876276000]);
  close(cur.normalizedValue / prior.normalizedValue, POP_H1 / 100 + 1, 1e-12);
})));

test('GenScript: Eastmoney holds converted amounts and a restated year ago; fiscal 2025 (+61.4 %) stays', () => withDay(null, () => withStore(F.store, () => {
  const s = snap('1548.HK');
  assert.equal(H.hkInterimPair(s), null);
  const leg = revGrowthLeg(s);
  assert.deepEqual([leg.basis, leg.periodEnd], ['year', '2025-12-31']);
  assert.ok(Math.abs(leg.pct - 61.404) < 0.001, String(leg.pct));
  assert.deepEqual(captureSnapshot(s).inputs.length, 2); // the fiscal-year pair keeps its own Yahoo operands
})));

test('without a store, or before the interim was first read (point in time), nothing changes', () => {
  const s = snap('9992.HK');
  const before = withStore(null, () => withDay(null, () => revGrowthLeg(s)));
  assert.deepEqual([before.basis, before.periodEnd], ['yearNewerRecord', '2025-12-31']);
  // First read 12.11.2026: a run on data day 11.11. does not know it yet.
  assert.equal(withStore(F.store, () => withDay('2026-11-11', () => H.hkInterimPair(s))), null);
  assert.equal(withStore(F.store, () => withDay('2026-11-12', () => H.hkInterimPair(s)))?.end, '2026-06-30');
});

test('a reading that is not exactly six months, or misses an operand, or whose ratio and growth disagree, is no pair', () => withDay(null, () => {
  const s = snap('9992.HK');
  for (const [k, v] of [['start', '2026-04-01'], ['priorEnd', '2025-12-31'], ['priorRevenue', null], ['yoyPct', null], ['yoyPct', 23.5]]) {
    const st = structuredClone(F.store);
    popHalf(st)[k] = v;
    assert.equal(H.hkInterimPair(s, st), null, k);
  }
  // Operands come back in the snapshot's stored unit (USD at the snapshot's own rate), not in Eastmoney's amounts.
  close(H.hkInterimPair(s, F.store).current, popHalf(F.store).revenue * s.meta.fxRateApplied, 1e-3);
  // Other markets never read the store.
  assert.equal(H.hkInterimPair({ ...s, meta: { ...s.meta, ticker: '9992.T' } }, F.store), null);
}));

// ── Codex review of 12.11.2026, finding 1: unit and the year-ago value against a second source ─────────────────────
test('Codex scenario 1: both Eastmoney amounts in another unit (/1000, /7, x7), growth unchanged, is no pair', () => withDay(null, () => {
  for (const f of [1 / 1000, 1 / 7, 7]) {
    const st = structuredClone(F.store);
    popHalf(st).revenue *= f; popHalf(st).priorRevenue *= f; popYear(st).revenue *= f; // the whole company in the wrong unit
    assert.equal(H.hkInterimPair(snap('9992.HK'), st), null, String(f));
    const st2 = structuredClone(F.store);
    popHalf(st2).revenue *= f; popHalf(st2).priorRevenue *= f; // only the half years in the wrong unit
    assert.equal(H.hkInterimPair(snap('9992.HK'), st2), null, 'half years ' + f);
  }
}));

test('Codex scenario 2: a wrong year-ago half with a growth figure computed from it is caught by Yahoo trailing twelve months', () => withDay(null, () => {
  const st = structuredClone(F.store);
  const o = popHalf(st);
  o.priorRevenue /= 7; o.yoyPct = (o.revenue / o.priorRevenue - 1) * 100; // 766 % instead of 23.8 %
  assert.equal(H.hkInterimPair(snap('9992.HK'), st), null);
  // Without Yahoo's trailing figure for exactly this end there is no check, so no pair.
  const s = snap('9992.HK'); s.meta.mostRecentQuarter = '2026-03-31T00:00:00.000Z';
  assert.equal(H.hkInterimPair(s, F.store), null);
  const t = snap('9992.HK'); delete t.metrics.revenueTTM;
  assert.equal(H.hkInterimPair(t, F.store), null);
}));

test('the Eastmoney fiscal year must match Yahoo within 1 %, and must exist', () => withDay(null, () => {
  const st = structuredClone(F.store);
  popYear(st).revenue *= 1.02;
  assert.equal(H.hkInterimPair(snap('9992.HK'), st), null);
  const st2 = structuredClone(F.store);
  delete st2.companies['9992.HK'].fiscalYear;
  assert.equal(H.hkInterimPair(snap('9992.HK'), st2), null);
  // Without the Yahoo fiscal year that contains the year-ago half there is no check either.
  const s = snap('9992.HK'); delete s.meta.annualRevNewerYear;
  assert.equal(H.hkInterimPair(s, F.store), null);
}));

// ── Fetch script ────────────────────────────────────────────────────────────────────────────────────────────────
const row = (code, over = {}) => ({ SECUCODE: code, REPORT_DATE: '2026-06-30 00:00:00', DATE_TYPE_CODE: '002', START_DATE: '2026-01-01 00:00:00',
  REPORT_DATE_SQ: '2025-06-30 00:00:00', OPERATE_INCOME: 17172921000, OPERATE_INCOME_SQ: 13876276000, OPERATE_INCOME_YOY: 23.7574187772,
  ORG_TYPE: '一般企业', FISCAL_YEAR: '12-31', ...over });
const year = (code, over = {}) => row(code, { REPORT_DATE: '2025-12-31 00:00:00', DATE_TYPE_CODE: '001', START_DATE: '2025-01-01 00:00:00',
  REPORT_DATE_SQ: '2024-12-31 00:00:00', OPERATE_INCOME: 37120052000, OPERATE_INCOME_SQ: 13037749000, OPERATE_INCOME_YOY: 184.7, ...over });
// Answers per report type, like the endpoint: the query names its DATE_TYPE_CODE.
const answer = (data, count) => async (url) => {
  const type = decodeURIComponent(url).match(/DATE_TYPE_CODE="(\d+)"/)[1];
  const rows = data.filter((r) => (r.__type || r.DATE_TYPE_CODE) === type).map(({ __type, ...r }) => r);
  return { success: true, result: { pages: 1, count: count ?? rows.length, data: rows } };
};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hk-interims-'));

test('fetch: whole-market rows map to Yahoo tickers of the watchlist, a changed number is appended, nothing is lost', async () => {
  const dir = tmp();
  const c1 = await fetchHk.run({ minRows: 1, dir, now: '2026-11-12T10:00:00.000Z', tickers: ['9992.HK', '0700.HK'],
    fetchJson: answer([row('09992.HK'), row('00700.HK', { OPERATE_INCOME: 5 }), row('01548.HK'), year('09992.HK'), year('00700.HK')]) });
  assert.deepEqual([c1.halfYear, c1.fiscalYear, c1.new], [{ rows: 3, matched: 2, usable: 2 }, { rows: 2, matched: 2, usable: 2 }, 4]);
  const s1 = JSON.parse(fs.readFileSync(path.join(dir, 'hk.json'), 'utf8'));
  assert.deepEqual(Object.keys(s1.companies).sort(), ['0700.HK', '9992.HK']);
  assert.equal(s1.companies['9992.HK'].fiscalYear['2025-12-31'][0].revenue, 37120052000);
  const c2 = await fetchHk.run({ minRows: 1, dir, now: '2026-11-13T10:00:00.000Z', tickers: ['9992.HK', '0700.HK'],
    fetchJson: answer([row('09992.HK'), row('00700.HK', { OPERATE_INCOME: 6 }), year('09992.HK'), year('00700.HK')]) });
  assert.deepEqual([c2.confirmed, c2.changed], [3, 1]);
  const list = JSON.parse(fs.readFileSync(path.join(dir, 'hk.json'), 'utf8')).companies['0700.HK'].halfYear['2026-06-30'];
  assert.deepEqual(list.map((o) => o.revenue), [5, 6]);
  assert.equal(fetchHk.yahooTicker('80737.HK'), '80737.HK');
});

test('fetch: a short answer, a duplicate, a row of another type or an empty number column aborts and writes nothing', async () => {
  const dir = tmp();
  const opts = { minRows: 1, dir, now: '2026-11-12T10:00:00.000Z', tickers: ['9992.HK', '0700.HK'] };
  const ok = [year('09992.HK')];
  await assert.rejects(fetchHk.run({ ...opts, fetchJson: answer([row('09992.HK'), ...ok], 2) }), /1 rows read, header says 2/);
  await assert.rejects(fetchHk.run({ ...opts, fetchJson: answer([row('09992.HK'), row('09992.HK'), ...ok]) }), /duplicate/);
  await assert.rejects(fetchHk.run({ ...opts, fetchJson: answer([{ ...row('09992.HK', { DATE_TYPE_CODE: '001' }), __type: '002' }, ...ok]) }), /type 001 in a 002 query/);
  await assert.rejects(fetchHk.run({ ...opts, fetchJson: async () => ({ success: false, message: 'x' }) }), /without success/);
  await assert.rejects(fetchHk.run({ ...opts, minRows: undefined, fetchJson: answer([row('09992.HK'), ...ok]) }), /only 1 interim rows, expected at least 500/);
  // Codex finding 3: rows arrive, but the number column is empty or renamed; the store must not freeze silently.
  const empty = { OPERATE_INCOME: null, OPERATE_INCOME_SQ: null };
  await assert.rejects(fetchHk.run({ ...opts, fetchJson: answer([row('09992.HK', empty), row('00700.HK', empty), ...ok]) }), /only 0 of 2 watchlist interim rows carry usable revenue/);
  await assert.rejects(fetchHk.run({ ...opts, fetchJson: answer([row('09992.HK'), year('09992.HK', { OPERATE_INCOME: '1,0' })]) }), /only 0 of 1 watchlist fiscal-year rows/);
  assert.equal(fs.existsSync(path.join(dir, 'hk.json')), false);
  // One company without a figure among usable ones is a missing report, not a broken source: it is listed, the run goes on.
  const c = await fetchHk.run({ ...opts, fetchJson: answer([row('09992.HK'), row('00700.HK', { OPERATE_INCOME_SQ: null }), row('01548.HK'), year('09992.HK'), year('00700.HK')]) });
  assert.deepEqual(c.halfYear, { rows: 3, matched: 2, usable: 1 });
  const src = Object.values(JSON.parse(fs.readFileSync(path.join(dir, 'hk.json'), 'utf8')).sources)[0];
  assert.deepEqual(src.types['002'].unusable, ['0700.HK 2026-06-30']);
});

// ── Review conditions of 12.11.2026 (blind Opus review) ─────────────────────────────────────────────────────────
const renamed = (store, to) => { const st = structuredClone(store); st.companies[to] = st.companies['9992.HK']; return st; };
const asTicker = (t) => { const s = snap('9992.HK'); s.meta.ticker = t; return s; };

test('banks, brokers and insurers (orgType other than general) keep their fiscal year', () => withDay(null, () => {
  const st = structuredClone(F.store);
  popHalf(st).orgType = '证券';
  assert.equal(H.hkInterimPair(snap('9992.HK'), st), null);
}));

test('a listing named in the financial hand table keeps its reviewed figures (1088.HK); the same cells elsewhere pass', () => withDay(null, () => {
  assert.equal(H.hkInterimPair(asTicker('1088.HK'), renamed(F.store, '1088.HK')), null);
  assert.equal(H.hkInterimPair(asTicker('9999.HK'), renamed(F.store, '9999.HK'))?.end, '2026-06-30');
}));

test('the committed store is read only inside a run with a data day', () => {
  assert.equal(withDay(null, () => ORIGINAL_DEFAULT_STORE()), null);
  assert.equal(withDay('2026-11-12', () => ORIGINAL_DEFAULT_STORE())?.market, 'HK');
});
