'use strict';
// R4: an absent exchange-fill quarter obeys the same financial guards as a real null vendor row.
// Base observations are the existing real-data fixture; structural and guard variations are memory-only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Module, createRequire } = require('node:module');
const X = require('../lib/exchange-quarter-check.js');
const F = require('./fixtures/exchange-quarter-check.json');
const { revGrowthLeg } = require('../lib/rev-growth-basis.js');
const { quarterOpMargins, revGrowthLevel } = require('../src/scoring/axes.js');
const { financialReasons } = require('../lib/financial-known-cases.js');
const P = '2025-09-30', T = '000002.SZ';
const file = path.resolve(__dirname, '../lib/exchange-quarter-check.js');
const hash = () => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const beforeHash = hash(), clone = structuredClone, serial = JSON.stringify;
const value = r => typeof r === 'number' ? r : r?.value;
const context = (store = F.store, baseline = F.baseline) => ({ stores: store,
  baseline: { date: baseline.date, rows: new Map(Object.entries(baseline.rows)) } });
const base = () => clone(F.snapshots[T]);
function absent(s = base()) {
  const k = s.timeseries.revenueQEnds.indexOf(P);
  assert.ok(k >= 0);
  s.timeseries.revenueQ.splice(k, 1); s.timeseries.revenueQEnds.splice(k, 1);
  return s;
}
const run = (s, ctx = context(), mode = 'fill-only', lib = X) => lib.applyExchangeCheck(s, { mode, context: ctx });
const block = (s, ctx) => { const r = run(s, ctx, 'shadow').result; return r.fill?.blocked || r.why || r.category; };
let passed = 0, failed = 0, breaks = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
}
function november(confirm) {
  const store = clone(F.store), y = store.cn.companies[T].ytd;
  const conf = { src: 'cn-20261030T070000Z', fetchedAt: '2026-10-30T07:00:00.000Z', updateDate: '2026-10-30' };
  store.cn.sources[conf.src] = { fetchedAt: conf.fetchedAt, periods: [...Object.keys(y), '2026-09-30'], absent: {} };
  const h1 = y['2026-06-30'].at(-1), q3 = 60000000000;
  y['2026-09-30'] = [{ ...h1, total: h1.total + q3, operate: h1.operate + q3,
    reportType: '\u4e09\u5b63\u62a5', noticeDate: '2026-10-30', confirmedBy: [conf] }];
  for (const [p, list] of Object.entries(y)) if (p !== '2026-09-30') {
    const prior = list.at(-1).confirmedBy.at(-1);
    list.at(-1).confirmedBy.push({ ...conf, updateDate: p === P && confirm ? conf.updateDate : prior.updateDate });
  }
  const s = absent(); s.meta.fetchedAt = '2026-10-30T09:00:00.000Z';
  s.timeseries.revenueQ.unshift({ value: q3 * s.meta.fxRateApplied });
  s.timeseries.revenueQEnds.unshift('2026-09-30');
  return { s, ctx: context(store), q3 };
}
function aligned() {
  const s = absent(), ts = s.timeseries, ends = ts.revenueQEnds;
  for (const [field, margin] of [['opIncQ', 0.17], ['grossProfitQ', 0.32], ['netIncomeQ', 0.09]]) {
    ts[field] = ts.revenueQ.map(r => ({ value: value(r) * margin }));
    if (field !== 'netIncomeQ') ts[field + 'Ends'] = ends.slice();
  }
  ts.reportedRevenueQEnds = ends.slice();
  s.meta.statementPeriods = {};
  for (const field of ['revenueQ', 'opIncQ', 'grossProfitQ', 'netIncomeQ']) {
    s.meta.statementPeriods[field] = ends.map(end => ({ end, duration: '3M', currency: 'CNY', unit: 'currency', basis: 'yahoo-statement' }));
  }
  return s;
}
test('the genuine null vendor row still fills without changing its date axis', () => {
  const s = base(), original = serial(s), k = s.timeseries.revenueQEnds.indexOf(P);
  assert.equal(s.timeseries.revenueQ[k], null);
  const nullGuard = lib => assert.equal(run(base(), context(), 'fill-only', lib).result.category, 'would-fill');
  const withoutNullFill = mutant('    if (k >= 0 && native[k] !== null) continue; // the vendor delivered', '    if (k >= 0) continue; // test-only: wrongly skip an existing null');
  if (process.argv.includes('--prove-empty-red')) nullGuard(withoutNullFill);
  assert.throws(() => nullGuard(withoutNullFill), assert.AssertionError); nullGuard(X); breaks++;
  const a = run(s);
  assert.equal(a.result.category, 'would-fill');
  assert.equal(a.snapshot.timeseries.revenueQEnds, s.timeseries.revenueQEnds);
  assert.equal(a.snapshot.timeseries.revenueQ.length, s.timeseries.revenueQ.length);
  assert.equal(a.snapshot.timeseries.revenueQ[k].exchangeFill.originalVendorRow, null);
  assert.equal(serial(X.stripOwn(a.snapshot)), original);
  assert.equal(serial(s), original);
});
test('an absent row fills once in descending date order with the existing source reason', () => {
  const s = absent(), original = serial(s), a = run(s), k = 3;
  assert.equal(a.result.category, 'would-fill'); assert.equal(a.result.fill.index, k);
  assert.equal(a.result.fill.inserted, true);
  assert.deepEqual(a.snapshot.timeseries.revenueQEnds, base().timeseries.revenueQEnds);
  const row = a.snapshot.timeseries.revenueQ[k];
  assert.equal(row.value, run(base()).snapshot.timeseries.revenueQ[k].value);
  assert.equal(row.exchangeFill.insertedRow, true);
  assert.equal(row.exchangeFill.derivation, '9M-H1');
  assert.equal(row.exchangeFill.nativeCurrency, 'CNY');
  assert.equal(row.exchangeFill.operands.length, 2);
  assert.ok(financialReasons(a.snapshot).includes(row.exchangeFill.reason));
  assert.equal(X.exchangeRecord(a.snapshot).filled[0].period, P);
  assert.equal(serial(run(a.snapshot).snapshot), serial(a.snapshot), 'idempotent read-time overlay');
  assert.equal(serial(run(clone(a.snapshot), context(), 'off').snapshot), original);
  assert.equal(serial(X.stripOwn(JSON.parse(serial(a.snapshot)))), original, 'JSON round trip retains absence');
  assert.equal(serial(s), original, 'input is unchanged');
  assert.equal(run(s, context(), 'shadow').snapshot, s, 'shadow never inserts');
});
test('October report cutoff: absent row needs confirmation at or after next-year notice', () => {
  const no = november(false);
  assert.equal(block(no.s, no.ctx), 'november-not-confirmed');
  assert.equal(run(no.s, no.ctx).snapshot, no.s);
  const yes = november(true), a = run(yes.s, yes.ctx), leg = revGrowthLeg(a.snapshot);
  assert.equal(a.result.category, 'would-fill');
  assert.equal(leg.basis, 'quarter'); assert.equal(leg.periodEnd, '2026-09-30'); assert.equal(leg.priorPeriodEnd, P);
  assert.ok(Math.abs(leg.pct - (yes.q3 / a.result.fill.nativeValue - 1) * 100) < 1e-9);
  assert.equal(revGrowthLevel(a.snapshot), leg.pct, 'ordinary shared growth path');
});
test('all existing financial guards still reject absent rows with their original reason', () => {
  const cases = [];
  let store = clone(F.store), baseline = clone(F.baseline), s;
  store.cn.companies[T].ytd['2024-12-31'].push({ ...store.cn.companies[T].ytd['2024-12-31'][0], total: 1 });
  cases.push(['restatement-signal', absent(), context(store)]);
  baseline.rows[T].revenueQ[3] *= 1.0001;
  cases.push(['vendor-2025-changed', absent(), context(F.store, baseline)]);
  baseline = clone(F.baseline); delete baseline.rows[T];
  cases.push(['no-baseline', absent(), context(F.store, baseline)]);
  baseline = clone(F.baseline); baseline.rows[T].revenueQ[3] = null;
  cases.push(['baseline-quarter-missing', absent(), context(F.store, baseline)]);
  store = clone(F.store); delete store.cn.companies[T].ytd['2025-03-31'];
  cases.push(['store-period-missing', absent(), context(store)]);
  store = clone(F.store); store.cn.sources['cn-20261003T000000Z'] = { fetchedAt: '2026-10-03T00:00:00.000Z', periods: [P], absent: {} };
  cases.push(['store-period-missing', absent(), context(store)]);
  store = clone(F.store); for (const list of Object.values(store.cn.companies[T].ytd)) for (const row of list) row.table = 'SINCOME';
  cases.push(['not-general', absent(), context(store)]);
  store = clone(F.store); const y = store.cn.companies[T].ytd, h1 = y['2025-06-30'].at(-1).total, nine = y[P].at(-1);
  y['2025-12-31'].at(-1).total -= nine.total - (h1 - 1); nine.total = h1 - 1;
  cases.push(['exchange-quarter-not-positive', absent(), context(store)]);
  s = absent(); const k = s.timeseries.revenueQEnds.indexOf('2025-12-31'); s.timeseries.revenueQ[k].value *= 1.2;
  baseline = clone(F.baseline); baseline.rows[T].revenueQ[baseline.rows[T].revenueQEnds.indexOf('2025-12-31')] *= 1.2;
  cases.push(['neighbour-disagrees', s, context(F.store, baseline)]);
  s = absent(); s.meta.fetchedAt = '2026-10-20T12:00:00.000Z'; cases.push(['store-old', s, context()]);
  s = absent(); for (const field of ['revenueQ', 'revenueQEnds']) s.timeseries[field] = s.timeseries[field].slice(3);
  cases.push(['newest-cell', s, context()]);
  for (const [why, snapshot, ctx] of cases) {
    const old = serial(snapshot); assert.equal(block(snapshot, ctx), why, why);
    assert.equal(run(snapshot, ctx).snapshot, snapshot, why + ' no application');
    assert.equal(serial(snapshot), old, why + ' no input mutation');
  }
});
test('sibling values, dates, labels and statement metadata stay aligned and fully restore', () => {
  const s = aligned(), old = serial(s), margins = quarterOpMargins(s), a = run(s).snapshot, k = 3;
  assert.equal(a.timeseries.revenueQ.length, s.timeseries.revenueQ.length + 1);
  assert.deepEqual(quarterOpMargins(a), margins, 'no false margin at the inserted quarter or older quarters');
  for (const field of ['opIncQ', 'grossProfitQ', 'netIncomeQ']) {
    assert.equal(a.timeseries[field][k], null, field + ' no invented value');
    assert.deepEqual(a.timeseries[field].filter((_, i) => i !== k), s.timeseries[field]);
    if (field !== 'netIncomeQ') assert.deepEqual(a.timeseries[field + 'Ends'], a.timeseries.revenueQEnds);
    assert.equal(a.meta.statementPeriods[field][k], null, field + ' no invented statement identity');
    assert.deepEqual(a.meta.statementPeriods[field].filter((_, i) => i !== k), s.meta.statementPeriods[field]);
  }
  assert.deepEqual(a.timeseries.reportedRevenueQEnds, a.timeseries.revenueQEnds);
  assert.equal(a.meta.statementPeriods.revenueQ[k].end, P);
  assert.equal(a.meta.statementPeriods.revenueQ[k].duration, '3M');
  assert.equal(a.meta.statementPeriods.revenueQ[k].basis, 'exchange-fill');
  assert.equal(serial(X.stripOwn(JSON.parse(serial(a)))), old);
  assert.equal(serial(s), old);
});
test('a sibling already carrying the target quarter is not shifted twice', () => {
  const s = aligned(), k = 3;
  s.timeseries.opIncQ.splice(k, 0, null); s.timeseries.opIncQEnds.splice(k, 0, P);
  s.meta.statementPeriods.opIncQ.splice(k, 0, null);
  const old = serial(s), a = run(s);
  assert.equal(a.result.category, 'would-fill');
  assert.deepEqual(a.snapshot.timeseries.opIncQ, s.timeseries.opIncQ);
  assert.deepEqual(a.snapshot.timeseries.opIncQEnds, a.snapshot.timeseries.revenueQEnds);
  assert.equal(serial(X.stripOwn(a.snapshot)), old);
});
test('incompatible sibling dates reject only insertion, retaining a precise fill reason', () => {
  const s = aligned(); s.timeseries.opIncQEnds[2] = '2024-12-31';
  const r = run(s); assert.equal(r.result.fill.blocked, 'vendor-series'); assert.equal(r.snapshot, s);
  const existing = base(); existing.timeseries.opIncQ = s.timeseries.opIncQ; existing.timeseries.opIncQEnds = s.timeseries.opIncQEnds;
  assert.equal(run(existing).result.category, 'would-fill', 'existing-null financial eligibility is unchanged');
});
test('short and empty sibling arrays preserve every original value and restore exactly', () => {
  const s = aligned(); s.timeseries.opIncQ = []; s.timeseries.opIncQEnds = [];
  s.timeseries.grossProfitQ = s.timeseries.grossProfitQ.slice(0, 2); s.timeseries.grossProfitQEnds = s.timeseries.grossProfitQEnds.slice(0, 2);
  s.meta.statementPeriods.grossProfitQ = s.meta.statementPeriods.grossProfitQ.slice(0, 2);
  const old = serial(s), a = run(s);
  assert.equal(a.result.category, 'would-fill');
  assert.deepEqual(a.snapshot.timeseries.opIncQ, []);
  assert.deepEqual(a.snapshot.timeseries.grossProfitQ, s.timeseries.grossProfitQ);
  assert.equal(serial(X.stripOwn(a.snapshot)), old);
});
test('tail insertion and unrelated metadata survive a precise rollback', () => {
  const s = aligned();
  for (const field of ['revenueQ', 'opIncQ', 'grossProfitQ', 'netIncomeQ']) {
    s.timeseries[field] = s.timeseries[field].slice(0, 3);
    if (s.timeseries[field + 'Ends']) s.timeseries[field + 'Ends'] = s.timeseries[field + 'Ends'].slice(0, 3);
    s.meta.statementPeriods[field] = s.meta.statementPeriods[field].slice(0, 3);
  }
  s.timeseries.reportedRevenueQEnds = s.timeseries.reportedRevenueQEnds.slice(0, 3);
  const a = run(s);
  assert.equal(a.result.category, 'would-fill');
  assert.equal(a.snapshot.timeseries.revenueQEnds.at(-1), P);
  a.snapshot.timeseries.unrelated = ['kept']; a.snapshot.meta.unrelated = 'kept';
  const restored = X.stripOwn(a.snapshot), expected = clone(s);
  expected.timeseries.unrelated = ['kept']; expected.meta.unrelated = 'kept';
  assert.equal(serial(restored), serial(expected));
});
test('Taiwan absent row uses the printed quarter and restores absence', () => {
  const s = absent(clone(F.snapshots['6446.TW'])), old = serial(s), a = run(s);
  assert.equal(a.result.category, 'would-fill'); assert.equal(a.result.fill.derivation, 'printed-quarter');
  assert.equal(a.result.fill.nativeValue, 3893772 * 1000);
  assert.equal(serial(X.stripOwn(a.snapshot)), old);
});
function mutant(anchor, replacement) {
  const source = fs.readFileSync(file, 'utf8'), lines = source.split(/\r?\n/);
  assert.equal(lines.filter(line => line === anchor).length, 1, 'exact whole-line mutation anchor');
  const m = new Module(file, module); m.filename = file; m.paths = module.paths; m.require = createRequire(file);
  m._compile(lines.map(line => line === anchor ? replacement : line).join('\n'), file);
  return m.exports;
}
test('break once: removing insertion or November protection is caught in memory', () => {
  const checkFill = lib => assert.equal(run(absent(), context(), 'fill-only', lib).result.category, 'would-fill');
  const brokenFill = mutant('    if (k >= 0 && native[k] !== null) continue; // the vendor delivered', '    if (k < 0 || native[k] !== null) continue; // old absent-row omission');
  assert.throws(() => checkFill(brokenFill), assert.AssertionError); checkFill(X); breaks++;
  const anchor = "      if (!(x.latest[P].confirmedBy || []).some(c => c.updateDate && notice && c.updateDate >= notice)) return block('november-not-confirmed');";
  const no = november(false), checkGuard = lib => assert.equal(run(no.s, no.ctx, 'shadow', lib).result.fill.blocked, 'november-not-confirmed');
  assert.throws(() => checkGuard(mutant(anchor, '')), assert.AssertionError); checkGuard(X); breaks++;
  const checkAlignment = lib => { const s = aligned(); assert.deepEqual(quarterOpMargins(run(s, context(), 'fill-only', lib).snapshot), quarterOpMargins(s)); };
  assert.throws(() => checkAlignment(mutant("  for (const field of ['opIncQ', 'grossProfitQ', 'netIncomeQ']) {", '  for (const field of []) {')), assert.AssertionError);
  checkAlignment(X); breaks++;
  const checkRestore = lib => { const s = aligned(), a = run(s, context(), 'fill-only', lib).snapshot; assert.equal(serial(lib.stripOwn(a)), serial(s)); };
  assert.throws(() => checkRestore(mutant('    if (!saved) continue;', '    continue; // omit insertion rollback')), assert.AssertionError);
  checkRestore(X); breaks++;
});
test('all break-once changes stayed in memory', () => assert.equal(hash(), beforeHash));
console.log(`exchange-absent-row-r4: ${passed} passed, ${failed} failed, ${breaks} break-once red`);
process.exitCode = failed ? 1 : 0;
