'use strict';
// sd-halbjahr (12.11.2026): Hong Kong half-year reporters showed fiscal 2025 although the interim to 30.06.2026 was out
// since August, because Yahoo delivers no six-month figures. G31 now takes the newest Eastmoney interim pair where its own
// ratio agrees with Eastmoney's growth figure (lib/hk-interim.js). Fixtures: real cells, see tests/fixtures/hk-interim.json.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const H = require('../lib/hk-interim.js');
const G = require('../lib/g31-recency.js');
const axes = require('../src/scoring/axes.js');
const { revGrowthLeg } = require('../lib/rev-growth-basis.js');
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

test('GenScript: ratio -25.9 % against Eastmoney -22.1 % (restated year ago, report +27.3 %) keeps fiscal 2025 (+61.4 %)', () => withDay(null, () => withStore(F.store, () => {
  const s = snap('1548.HK');
  assert.equal(H.hkInterimPair(s), null);
  const leg = revGrowthLeg(s);
  assert.deepEqual([leg.basis, leg.periodEnd], ['year', '2025-12-31']);
  assert.ok(Math.abs(leg.pct - 61.404) < 0.001, String(leg.pct));
})));

test('without a store, or before the interim was first read (point in time), nothing changes', () => {
  const s = snap('9992.HK');
  const before = withStore(null, () => withDay(null, () => revGrowthLeg(s)));
  assert.deepEqual([before.basis, before.periodEnd], ['yearNewerRecord', '2025-12-31']);
  // First read 12.11.2026: a run on data day 11.11. does not know it yet.
  assert.equal(withStore(F.store, () => withDay('2026-11-11', () => H.hkInterimPair(s))), null);
  assert.equal(withStore(F.store, () => withDay('2026-11-12', () => H.hkInterimPair(s)))?.end, '2026-06-30');
});

test('a reading that is not exactly six months, or misses an operand, is no pair', () => withDay(null, () => {
  const s = snap('9992.HK');
  const store = structuredClone(F.store);
  const o = store.companies['9992.HK'].halfYear['2026-06-30'][0];
  for (const [k, v] of [['start', '2026-04-01'], ['priorEnd', '2025-12-31'], ['priorRevenue', null], ['yoyPct', null], ['yoyPct', 23.5]]) {
    const st = structuredClone(store);
    st.companies['9992.HK'].halfYear['2026-06-30'][0][k] = v;
    assert.equal(H.hkInterimPair(s, st), null, k);
  }
  // Operands come back in the snapshot's stored unit (USD at the snapshot's own rate), not in Eastmoney's amounts.
  close(H.hkInterimPair(s, store).current, o.revenue * s.meta.fxRateApplied, 1e-3);
  // Other markets never read the store.
  assert.equal(H.hkInterimPair({ ...s, meta: { ...s.meta, ticker: '9992.T' } }, store), null);
}));

// ── Fetch script ────────────────────────────────────────────────────────────────────────────────────────────────
const row = (code, over = {}) => ({ SECUCODE: code, REPORT_DATE: '2026-06-30 00:00:00', DATE_TYPE_CODE: '002', START_DATE: '2026-01-01 00:00:00',
  REPORT_DATE_SQ: '2025-06-30 00:00:00', OPERATE_INCOME: 17172921000, OPERATE_INCOME_SQ: 13876276000, OPERATE_INCOME_YOY: 23.7574187772,
  ORG_TYPE: '一般企业', FISCAL_YEAR: '12-31', ...over });
const answer = (data, count = data.length) => async () => ({ success: true, result: { pages: 1, count, data } });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hk-interims-'));

test('fetch: whole-market rows map to Yahoo tickers of the watchlist, a changed number is appended, nothing is lost', async () => {
  const dir = tmp();
  const c1 = await fetchHk.run({ minRows: 1, dir, now: '2026-11-12T10:00:00.000Z', tickers: ['9992.HK', '0700.HK'],
    fetchJson: answer([row('09992.HK'), row('00700.HK', { OPERATE_INCOME: 5 }), row('01548.HK')]) });
  assert.deepEqual([c1.rows, c1.kept, c1.new], [3, 2, 2]);
  const s1 = JSON.parse(fs.readFileSync(path.join(dir, 'hk.json'), 'utf8'));
  assert.deepEqual(Object.keys(s1.companies).sort(), ['0700.HK', '9992.HK']);
  const c2 = await fetchHk.run({ minRows: 1, dir, now: '2026-11-13T10:00:00.000Z', tickers: ['9992.HK', '0700.HK'],
    fetchJson: answer([row('09992.HK'), row('00700.HK', { OPERATE_INCOME: 6 })]) });
  assert.deepEqual([c2.confirmed, c2.changed], [1, 1]);
  const list = JSON.parse(fs.readFileSync(path.join(dir, 'hk.json'), 'utf8')).companies['0700.HK'].halfYear['2026-06-30'];
  assert.deepEqual(list.map((o) => o.revenue), [5, 6]);
  assert.equal(fetchHk.yahooTicker('80737.HK'), '80737.HK');
});

test('fetch: a short answer, a duplicate or a row of another type aborts and writes nothing', async () => {
  const dir = tmp();
  const opts = { minRows: 1, dir, now: '2026-11-12T10:00:00.000Z', tickers: ['9992.HK'] };
  await assert.rejects(fetchHk.run({ ...opts, fetchJson: answer([row('09992.HK')], 2) }), /1 rows read, header says 2/);
  await assert.rejects(fetchHk.run({ ...opts, fetchJson: answer([row('09992.HK'), row('09992.HK')]) }), /duplicate/);
  await assert.rejects(fetchHk.run({ ...opts, fetchJson: answer([row('09992.HK', { DATE_TYPE_CODE: '001' })]) }), /type 001/);
  await assert.rejects(fetchHk.run({ ...opts, fetchJson: async () => ({ success: false, message: 'x' }) }), /without success/);
  await assert.rejects(fetchHk.run({ ...opts, minRows: undefined, fetchJson: answer([row('09992.HK')]) }), /only 1 interim rows, expected at least 500/);
  assert.equal(fs.existsSync(path.join(dir, 'hk.json')), false);
});

// ── Review conditions of 12.11.2026 (blind Opus review) ─────────────────────────────────────────────────────────
const renamed = (store, to) => { const st = structuredClone(store); st.companies[to] = st.companies['9992.HK']; return st; };
const asTicker = (t) => { const s = snap('9992.HK'); s.meta.ticker = t; return s; };

test('banks, brokers and insurers (orgType other than general) keep their fiscal year', () => withDay(null, () => {
  const st = structuredClone(F.store);
  st.companies['9992.HK'].halfYear['2026-06-30'][0].orgType = '证券';
  assert.equal(H.hkInterimPair(snap('9992.HK'), st), null);
}));

test('size and unit check: a year-ago half above 90 % of its fiscal year (a currency slip) is no pair', () => withDay(null, () => {
  const st = structuredClone(F.store);
  const o = st.companies['9992.HK'].halfYear['2026-06-30'][0];
  o.revenue *= 7; o.priorRevenue *= 7; // ratio and Eastmoney growth unchanged, amounts in the wrong unit
  assert.equal(H.hkInterimPair(snap('9992.HK'), st), null);
  // Without the fiscal year that contains the year-ago half there is no check, so no pair.
  const s = snap('9992.HK'); delete s.meta.annualRevNewerYear;
  assert.equal(H.hkInterimPair(s, F.store), null);
}));

test('a listing named in the financial hand table keeps its reviewed figures (1088.HK); the same cells elsewhere pass', () => withDay(null, () => {
  assert.equal(H.hkInterimPair(asTicker('1088.HK'), renamed(F.store, '1088.HK')), null);
  assert.equal(H.hkInterimPair(asTicker('9999.HK'), renamed(F.store, '9999.HK'))?.end, '2026-06-30');
}));

test('the committed store is read only inside a run with a data day', () => {
  assert.equal(withDay(null, () => ORIGINAL_DEFAULT_STORE()), null);
  assert.equal(withDay('2026-11-12', () => ORIGINAL_DEFAULT_STORE())?.market, 'HK');
});
