'use strict';
// lib/exchange-quarter-store.test.js — standalone runner (node lib/exchange-quarter-store.test.js, exit 0/1).
// Every number below is a real exchange figure from the G2 probes of 02.10.2026
// (Eastmoney RPT_F10_FINANCE_GINCOME for 000958.SZ / 600064.SS, MOPS t164sb04 for 6446.TW / 2548.TW / 6949.TW).
const assert = require('node:assert/strict');
const S = require('./exchange-quarter-store.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.stack || e)); }
}
const near = (a, b, eps = 0.005) => assert.ok(Math.abs(a - b) <= eps, a + ' != ' + b);

// ── Period windows (S2) ──────────────────────────────────────────────────────
test('China window on 02.10.2026: 7 quarter ends before today plus the FY end before the oldest (2024-12-31)', () => {
  assert.deepEqual(S.chinaPeriodWindow('2026-10-02'), [
    '2026-09-30', '2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30', '2025-03-31', '2024-12-31',
  ]);
});
test('China window: a quarter end equal to today is not yet in it; the FY end is strictly before the oldest quarter', () => {
  const w = S.chinaPeriodWindow('2026-12-31');
  assert.equal(w[0], '2026-09-30');
  assert.equal(w[6], '2025-03-31');
  assert.equal(w[7], '2024-12-31');
  const w2 = S.chinaPeriodWindow('2027-01-05'); // oldest quarter is then 2025-06-30
  assert.equal(w2[6], '2025-06-30');
  assert.equal(w2[7], '2024-12-31');
  assert.ok(S.chinaPeriodWindow('2027-10-02').includes('2025-12-31'), 'oldest 2026-03-31 -> FY end 2025-12-31');
});
test('Taiwan window on 02.10.2026: 115Q3 .. 114Q3 (ROC years), newest first', () => {
  assert.deepEqual(S.taiwanSeasonWindow('2026-10-02').map((s) => s.key), ['115Q3', '115Q2', '115Q1', '114Q4', '114Q3']);
  const s = S.taiwanSeasonWindow('2026-10-02')[4];
  assert.deepEqual(s, { key: '114Q3', rocYear: 114, season: 3, periodEnd: '2025-09-30' });
});
test('China report seasons: daily inside 15.03-05.05, 15.07-05.09, 15.10-20.11, not in January', () => {
  for (const d of ['2026-03-15', '2026-05-05', '2026-07-15', '2026-09-05', '2026-10-15', '2026-11-20']) assert.equal(S.inChinaReportSeason(d), true, d);
  for (const d of ['2026-03-14', '2026-05-06', '2026-07-14', '2026-09-06', '2026-10-02', '2026-11-21', '2026-01-20']) assert.equal(S.inChinaReportSeason(d), false, d);
});

// ── China: cumulative -> single quarter with the report-type chain check ─────
const Y = (reportType, total, operate) => ({ reportType, total, operate: operate == null ? total : operate });
const C958 = {
  '2026-06-30': Y('中报', 4832132828.91),
  '2026-03-31': Y('一季报', 2728799208.83),
  '2025-12-31': Y('年报', 12466257345.59),
  '2025-09-30': Y('三季报', 3650029509.49),
  '2025-06-30': Y('中报', 6155289807.22),
  '2025-03-31': Y('一季报', 3300263281.34),
  '2024-12-31': Y('年报', 12238630835.76),
  '2024-09-30': Y('三季报', 3952965579.81),
  '2024-06-30': Y('中报', 2769432791.27),
};
test('000958.SZ: Q2-2026 = H1 - Q1 = 2,103,333,620.08 and Q2-2025 = 2,855,026,525.88 (growth -26.33 %)', () => {
  const q = S.chinaSingleQuarters(C958, 'total');
  near(q['2026-06-30'], 2103333620.08);
  near(q['2025-06-30'], 2855026525.88);
  near((q['2026-06-30'] / q['2025-06-30'] - 1) * 100, -26.3288, 0.0001);
  near(q['2026-03-31'], 2728799208.83);
});
test('000958.SZ: Q3-2025 = 9M - H1 is negative (-2,505,260,297.73, restated H1), Q3-2024 = 1,183,532,788.54', () => {
  const q = S.chinaSingleQuarters(C958, 'total');
  near(q['2025-09-30'], -2505260297.73);
  near(q['2024-09-30'], 1183532788.54);
  near(q['2025-12-31'], 12466257345.59 - 3650029509.49);
});
test('600064.SS: total line Q2-2026 801,410,696.60 (-10.85 %) vs operate line 800,678,340.45 (-10.77 %); Q3-2025 = 439,718,716.79', () => {
  // Eastmoney GINCOME as stored on 02.10.2026 (TOTAL_OPERATE_INCOME, OPERATE_INCOME)
  const c = {
    '2026-06-30': Y('中报', 1408208446.73, 1406734729.77),
    '2026-03-31': Y('一季报', 606797750.13, 606056389.32),
    '2025-09-30': Y('三季报', 2399700641.02, 2395419553.35),
    '2025-06-30': Y('中报', 1959981924.23, 1957020093.24),
    '2025-03-31': Y('一季报', 1061048907.30, 1059709613.12),
  };
  const t = S.chinaSingleQuarters(c, 'total'), o = S.chinaSingleQuarters(c, 'operate');
  near(t['2026-06-30'], 801410696.60);
  near(t['2025-06-30'], 898933016.93);
  near(o['2026-06-30'], 800678340.45);
  near((t['2026-06-30'] / t['2025-06-30'] - 1) * 100, -10.8487, 0.0001);
  near((o['2026-06-30'] / o['2025-06-30'] - 1) * 100, -10.7691, 0.0001);
  near(t['2025-09-30'], 439718716.79);
  delete c['2025-03-31'];
  assert.equal(S.chinaSingleQuarters(c, 'total')['2025-06-30'], null, 'no Q1-2025 stored -> Q2-2025 not derivable');
});
test('a gap in the chain gives null (dekumuliere), not a 6-month value', () => {
  const c = { '2025-09-30': Y('三季报', 300), '2025-03-31': Y('一季报', 100) };
  const q = S.chinaSingleQuarters(c, 'total');
  assert.equal(q['2025-09-30'], null);
  assert.equal(q['2025-03-31'], 100);
});
test('non-December fiscal year (中报 at 09-30) derives nothing: the company is unchecked', () => {
  const c = { '2025-09-30': Y('中报', 300), '2025-06-30': Y('一季报', 100) };
  assert.equal(S.chinaSingleQuarters(c, 'total'), null);
});
test('unknown line name throws (no silent default)', () => {
  assert.throws(() => S.chinaSingleQuarters(C958, 'TOTAL'), /line/);
});

// ── Taiwan: season column order, Q4 = FY - 9M, YTD must start on 01-01, thousand TWD ──
const col = (labels, values) => labels.map((l, i) => [l, values[i]]);
const TW6446 = {
  '114Q3': { columns: col(['114年第3季', '113年第3季', '114年01月01日至114年09月30日', '113年01月01日至113年09月30日'], [3893772, 2713359, 10753539, 6673280]) },
  '114Q4': { columns: col(['114年度', '113年度'], [15634777, 9734814]) },
  '115Q1': { columns: col(['115年01月01日至115年03月31日', '115年第1季', '114年01月01日至114年03月31日', '114年第1季'], [5121378, 5121378, 3257306, 3257306]) },
  '115Q2': { columns: col(['115年第2季', '114年第2季', '115年01月01日至115年06月30日', '114年01月01日至114年06月30日'], [6855431, 3602461, 11976809, 6859767]) },
};
test('6446.TW season 3: [quarter, prior quarter, YTD, prior YTD] in TWD (x1000)', () => {
  assert.deepEqual(S.taiwanSeasonValues(TW6446['114Q3'], 114, 3),
    { quarter: 3893772000, priorQuarter: 2713359000, ytd: 10753539000, priorYtd: 6673280000 });
});
test('6446.TW season 1 has the YTD column first: [YTD, quarter, prior YTD, prior quarter]', () => {
  assert.deepEqual(S.taiwanSeasonValues(TW6446['115Q1'], 115, 1),
    { quarter: 5121378000, priorQuarter: 3257306000, ytd: 5121378000, priorYtd: 3257306000 });
  const swapped = { columns: [TW6446['115Q1'].columns[1], TW6446['115Q1'].columns[0], ...TW6446['115Q1'].columns.slice(2)] };
  assert.equal(S.taiwanSeasonValues(swapped, 115, 1), null, 'season-2 order on a season-1 answer is not accepted');
});
test('6446.TW Q4-2025 = FY - 9M = 15,634,777 - 10,753,539 = 4,881,238 thousand TWD', () => {
  const q = S.taiwanSingleQuarters(TW6446);
  assert.equal(q['2025-12-31'], 4881238000);
  assert.equal(q['2025-09-30'], 3893772000);
  assert.equal(q['2024-09-30'], 2713359000);
  assert.equal(q['2026-06-30'], 6855431000);
  assert.equal(q['2025-06-30'], 3602461000);
  assert.equal(q['2026-03-31'], 5121378000);
  assert.equal(q['2025-03-31'], 3257306000);
  assert.equal(q['2024-12-31'], 9734814000 - 6673280000);
});
test('2548.TW Q3-2025 2,835,266 and Q4-2025 18,238,702 - 4,863,270 = 13,375,432 (thousand TWD)', () => {
  const q = S.taiwanSingleQuarters({
    '114Q3': { columns: col(['114年第3季', '113年第3季', '114年01月01日至114年09月30日', '113年01月01日至113年09月30日'], [2835266, 5423461, 4863270, 7166529]) },
    '114Q4': { columns: col(['114年度', '113年度'], [18238702, 7212415]) },
  });
  assert.equal(q['2025-09-30'], 2835266000);
  assert.equal(q['2025-12-31'], 13375432000);
});
test('a YTD title that does not start on 01-01 (non-calendar fiscal year) is unchecked', () => {
  const c = { columns: col(['114年第3季', '113年第3季', '114年07月01日至114年09月30日', '113年07月01日至113年09月30日'], [1, 2, 3, 4]) };
  assert.equal(S.taiwanSeasonValues(c, 114, 3), null);
  assert.deepEqual(S.taiwanSingleQuarters({ '114Q3': c }), {});
});
test('6949.TW small company: 5,870 thousand TWD is 5,870,000 TWD; printed numbers parse exactly', () => {
  assert.equal(S.parseMopsNumber('5,870') * S.TW_UNIT, 5870000);
  assert.equal(S.parseMopsNumber('15,634,777'), 15634777);
  assert.equal(S.parseMopsNumber('-1,234'), -1234);
  assert.equal(S.parseMopsNumber(''), null);
  assert.throws(() => S.parseMopsNumber('1.234,5'), /unparseable/);
  assert.throws(() => S.parseMopsNumber('12,34'), /unparseable/);
});

// ── Append-only merge with confirmations (S1) ────────────────────────────────
const conf = (src, fetchedAt, updateDate) => ({ src, fetchedAt, updateDate });
test('identical numbers add a confirmation only when updateDate changes; changed numbers append', () => {
  const list = [];
  assert.equal(S.mergeObservation(list, { reportType: '三季报', total: 1, operate: 1, noticeDate: '2025-10-29' }, conf('a', '2026-10-02T07:00:00Z', '2025-10-29')), 'new');
  assert.equal(S.mergeObservation(list, { reportType: '三季报', total: 1, operate: 1, noticeDate: '2025-10-29' }, conf('b', '2026-10-03T07:00:00Z', '2025-10-29')), 'confirmed');
  assert.equal(list.length, 1);
  assert.equal(list[0].confirmedBy.length, 1);
  assert.equal(S.mergeObservation(list, { reportType: '三季报', total: 1, operate: 1, noticeDate: '2025-10-29' }, conf('c', '2026-10-31T07:00:00Z', '2026-10-30')), 'confirmed');
  assert.deepEqual(list[0].confirmedBy.map((c) => c.src), ['a', 'c']);
  assert.equal(S.mergeObservation(list, { reportType: '三季报', total: 2, operate: 2, noticeDate: '2025-10-29' }, conf('d', '2026-11-01T07:00:00Z', '2026-10-30')), 'changed');
  assert.equal(list.length, 2, 'a different number appends a new observation (restatement signal)');
  assert.equal(list[0].total, 1, 'the old observation is kept unchanged');
});

function store(obs) {
  return { schemaVersion: 1, market: 'CN', sources: { a: { fetchedAt: 'x' } }, companies: { '000958.SZ': { ytd: { '2025-09-30': obs } } } };
}
const OBS = () => [{ reportType: '三季报', total: 1, operate: 1, confirmedBy: [conf('a', 't1', 'u1')] }];
test('append-only guard: an identical or extended store passes', () => {
  const prev = store(OBS());
  S.assertAppendOnly(prev, JSON.parse(JSON.stringify(prev)));
  const next = JSON.parse(JSON.stringify(prev));
  next.companies['000958.SZ'].ytd['2025-09-30'][0].confirmedBy.push(conf('b', 't2', 'u2'));
  next.companies['000958.SZ'].ytd['2025-09-30'].push({ reportType: '三季报', total: 2, operate: 2, confirmedBy: [conf('c', 't3', 'u3')] });
  next.companies['600064.SS'] = { ytd: {} };
  next.sources.b = { fetchedAt: 'y' };
  S.assertAppendOnly(prev, next);
});
test('append-only guard: a removed or changed old observation throws', () => {
  const prev = store(OBS());
  const cases = {
    'value changed': (n) => { n.companies['000958.SZ'].ytd['2025-09-30'][0].total = 9; },
    'observation removed': (n) => { n.companies['000958.SZ'].ytd['2025-09-30'] = []; },
    'period removed': (n) => { delete n.companies['000958.SZ'].ytd['2025-09-30']; },
    'company removed': (n) => { delete n.companies['000958.SZ']; },
    'confirmation removed': (n) => { n.companies['000958.SZ'].ytd['2025-09-30'][0].confirmedBy = []; },
    'source removed': (n) => { delete n.sources.a; },
    'field added to an old observation': (n) => { n.companies['000958.SZ'].ytd['2025-09-30'][0].extra = 1; },
  };
  for (const [name, mut] of Object.entries(cases)) {
    const next = JSON.parse(JSON.stringify(prev));
    mut(next);
    assert.throws(() => S.assertAppendOnly(prev, next), /append-only/, name);
  }
});
test('lastConfirmedAt: newest run that read the key again (China: periods minus absent, Taiwan: read list)', () => {
  const cn = { market: 'CN', sources: {
    a: { fetchedAt: '2026-10-02T07:00:00Z', periods: ['2025-09-30'], absent: {} },
    b: { fetchedAt: '2026-10-16T13:47:00Z', periods: ['2025-09-30'], absent: { '2025-09-30': ['000958.SZ'] } },
    c: { fetchedAt: '2026-10-09T13:47:00Z', periods: ['2025-06-30'] } } };
  assert.equal(S.lastConfirmedAt(cn, '000958.SZ', '2025-09-30'), '2026-10-02T07:00:00Z', 'run b did not read 000958.SZ');
  assert.equal(S.lastConfirmedAt(cn, '600064.SS', '2025-09-30'), '2026-10-16T13:47:00Z');
  assert.equal(S.lastConfirmedAt(cn, '600064.SS', '2024-12-31'), null);
  const tw = { market: 'TW', sources: { a: { fetchedAt: '2026-10-02T07:00:00Z', read: ['6446.TW 115Q2'] }, b: { fetchedAt: '2026-10-09T07:00:00Z', read: ['2548.TW 115Q2'] } } };
  assert.equal(S.lastConfirmedAt(tw, '6446.TW', '115Q2'), '2026-10-02T07:00:00Z');
  assert.equal(S.lastConfirmedAt(tw, '6446.TW', '115Q1'), null);
});
test('serialise: one company per line, stable key order, round-trips', () => {
  const s = { schemaVersion: 1, market: 'CN', sources: { a: { fetchedAt: 'x' } }, companies: { 'B.SZ': { ytd: {} }, 'A.SS': { ytd: {} } } };
  const text = S.serialiseStore(s);
  assert.deepEqual(JSON.parse(text), s);
  const lines = text.split('\n');
  assert.ok(lines.indexOf('"A.SS":{"ytd":{}},') < lines.indexOf('"B.SZ":{"ytd":{}}'), text);
  assert.ok(text.endsWith('\n'));
});

console.log('\nexchange-quarter-store: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
