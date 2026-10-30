'use strict';
// sd-p2 (29.10.2026): G31 takes the newest complete quarter pair before the annual pair. When the newest quarter has no
// valid dated year-ago pair, the next older quarter pair that quarterCandidate accepts is shown if it ends after the
// fiscal year and the exchange check would not withhold it (G2). Fixtures: real cells of the 29.10.2026 run.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Module, createRequire } = require('node:module');
const X = require('../lib/exchange-quarter-check.js');
const G = require('../lib/g31-recency.js');
const axes = require('../src/scoring/axes.js');
const { revGrowthLeg } = require('../lib/rev-growth-basis.js');
const F = require('./fixtures/g31-older-quarter-pair.json');

const ROOT = path.resolve(__dirname, '..');
const GFILE = path.join(ROOT, 'lib/g31-recency.js');
const sha = () => crypto.createHash('sha256').update(fs.readFileSync(GFILE)).digest('hex');
const before = sha();
// The exchange verdict reads the fixture store (cut from cn.json), never the live store; no baseline is needed here.
X.defaultContext = () => ({ stores: { cn: F.store.cn, tw: null, warnings: [] }, baseline: { date: null, rows: new Map(), warnings: [] }, warnings: [] });
const snap = t => structuredClone(F.snapshots[t]);
const v = c => (c && typeof c === 'object' ? c.value : c);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('002448.SZ: newest quarter 30.09.2026 has no year-ago quarter; the June 2026 pair is shown (28.53 %)', () => {
  const s = snap('002448.SZ');
  assert.equal(G.quarterCandidate(s).pct, null);
  const leg = revGrowthLeg(s);
  assert.deepEqual([leg.basis, leg.periodEnd, leg.priorPeriodEnd, leg.sourcePeriodEnd], ['quarter', '2026-06-30', '2025-06-30', '2026-06-30']);
  assert.equal(leg.pct, 28.53102510166723);
  // The score axis and the growth bonus read the same pair.
  assert.equal(axes.revGrowthLevel(s), 28.53102510166723);
  const bonus = G.g31Shadow(s).v1.bonusComponents;
  assert.equal(bonus.length, 2); close(bonus[1], 0.2853102510166723);
  // The legacy comparison arm keeps the old formula: the fiscal year 2025.
  assert.deepEqual(G.withG31Variant('legacy', () => [revGrowthLeg(s).basis, revGrowthLeg(s).periodEnd]), ['year', '2025-12-31']);
  // Export provenance cites exactly the two cells of the shown pair (before: index 0 and a partner that does not exist).
  const e = s.timeseries.revenueQEnds, inputs = require('../lib/export-provenance.js').captureSnapshot(s).inputs;
  assert.deepEqual(inputs.map(x => [x.fieldPath, x.periodEnd, x.normalizedValue]), [
    [`timeseries.revenueQ.${e.indexOf('2026-06-30')}`, '2026-06-30', v(s.timeseries.revenueQ[e.indexOf('2026-06-30')])],
    [`timeseries.revenueQ.${e.indexOf('2025-06-30')}`, '2025-06-30', v(s.timeseries.revenueQ[e.indexOf('2025-06-30')])]]);
});

test('603991.SS: the June 2026 pair is shown (1,983.58 %), with its checked takeover hint', () => {
  const s = snap('603991.SS');
  const leg = revGrowthLeg(s), q = s.timeseries.revenueQ.map(v), e = s.timeseries.revenueQEnds;
  assert.deepEqual([leg.basis, leg.periodEnd, leg.priorPeriodEnd], ['quarter', '2026-06-30', '2025-06-30']);
  assert.equal(leg.pct.toFixed(2), '1983.58');
  close(leg.pct, (q[e.indexOf('2026-06-30')] / q[e.indexOf('2025-06-30')] - 1) * 100);
  assert.equal(G.g31Hinweis(s)?.code, 'uebernahme');
});

test('000595.SZ: the exchange check would withhold the older pair (G2), so the fiscal year stays', () => {
  const s = snap('000595.SZ');
  const res = X.evaluate(X.stripOwn(s), X.defaultContext());
  assert.equal(res.category, 'would-withhold');
  assert.ok(res.withhold.some(w => w.period === '2025-06-30'), 'the vendor June 2025 cell disagrees with the exchange figure');
  const leg = revGrowthLeg(s);
  assert.deepEqual([leg.basis, leg.periodEnd, leg.priorPeriodEnd], ['year', '2025-12-31', '2024-12-31']);
  close(leg.pct, 5.976444598488317);
  // The pair the guard refuses is a valid quarterCandidate pair (187.07 % on vendor cells).
  close(G.quarterCandidate(s, 'revenueQ', 1).pct, 187.07453425011892);
  // Fails closed: an unreadable exchange verdict never admits the older pair.
  const keep = X.defaultContext;
  X.defaultContext = () => { throw new Error('store unreadable'); };
  try { assert.equal(revGrowthLeg(snap('002448.SZ')).basis, 'year'); } finally { X.defaultContext = keep; }
});

test('000423.SZ: a newest quarter with a valid year-ago pair is unchanged (no walk)', () => {
  const s = snap('000423.SZ'), q = s.timeseries.revenueQ.map(v), e = s.timeseries.revenueQEnds;
  const leg = revGrowthLeg(s), first = G.quarterCandidate(s);
  assert.equal(e[0], '2026-09-30');
  assert.deepEqual([leg.basis, leg.sourcePeriodEnd, leg.sourcePriorPeriodEnd], ['quarter', '2026-09-30', '2025-09-30']);
  assert.equal(leg.pct, first.pct);
  close(leg.pct, (q[0] / q[e.indexOf('2025-09-30')] - 1) * 100);
});

test('A17U.SI: the older complete pair ends before the fiscal year end, so the fiscal year stays', () => {
  const s = snap('A17U.SI');
  assert.equal(G.quarterCandidate(s).pct, null);
  const older = G.quarterCandidate(s, 'revenueQ', 2);
  assert.ok(older.pct !== null && older.sourcePeriodEnd < s.annual.annualRevEnds[0], 'a valid but older quarter pair exists');
  const leg = revGrowthLeg(s);
  assert.deepEqual([leg.basis, leg.periodEnd], ['year', '2025-12-31']);
  assert.equal(G.g31Shadow(s).v1.bonusComponents.length, 1, 'the stale quarter pair does not feed the bonus either');
});

test('break-once: with the walk disabled the June 2026 pair of 002448.SZ is lost; live source unchanged', () => {
  const source = fs.readFileSync(GFILE, 'utf8'), lines = source.split(/\r?\n/);
  const anchor = "  for (let i = 1; i < norm(s, 'revenueQ').length; i++) {";
  assert.equal(lines.filter(l => l === anchor).length, 1, 'exact whole-line anchor');
  const m = new Module(GFILE, module), req = createRequire(GFILE);
  m.filename = GFILE; m.paths = module.paths; m.require = req;
  m._compile(lines.map(l => (l === anchor ? '  for (let i = 1; i < 1; i++) {' : l)).join('\n'), GFILE);
  const broken = m.exports.g31Shadow(snap('002448.SZ')).v1;
  assert.throws(() => assert.equal(broken.sourcePeriodEnd, '2026-06-30'), assert.AssertionError);
  assert.equal(G.g31Shadow(snap('002448.SZ')).v1.sourcePeriodEnd, '2026-06-30');
  assert.equal(sha(), before);
});

// Review I1 (29.10.2026): an unusable exchange store means the check did not run; a CN/TW older pair stays unused.
const withStore = (cn, fn) => {
  const keep = X.defaultContext;
  X.defaultContext = () => ({ stores: { cn, tw: null, warnings: [] }, baseline: { date: null, rows: new Map(), warnings: [] }, warnings: [] });
  try { return fn(); } finally { X.defaultContext = keep; }
};
const shiftedStore = days => {
  const cn = structuredClone(F.store.cn), shift = t => new Date(Date.parse(t) - days * 864e5).toISOString();
  for (const src of Object.values(cn.sources)) src.fetchedAt = shift(src.fetchedAt);
  for (const c of Object.values(cn.companies)) for (const list of Object.values(c.ytd || {}))
    for (const o of list) for (const conf of o.confirmedBy || []) if (conf.fetchedAt) conf.fetchedAt = shift(conf.fetchedAt);
  return cn;
};

test('no exchange store: 002448.SZ and 000595.SZ keep the fiscal year (fail closed)', () => {
  withStore(null, () => {
    assert.equal(X.evaluate(X.stripOwn(snap('000595.SZ')), X.defaultContext()).why, 'store-missing');
    assert.deepEqual([revGrowthLeg(snap('002448.SZ')).basis, revGrowthLeg(snap('002448.SZ')).periodEnd], ['year', '2025-12-31']);
    const leg = revGrowthLeg(snap('000595.SZ'));
    assert.deepEqual([leg.basis, leg.periodEnd], ['year', '2025-12-31']); close(leg.pct, 5.976444598488317);
  });
});

test('exchange store older than the limit: the older pair stays unused; one day old (inside the limit) it is used', () => {
  withStore(shiftedStore(10), () => {
    assert.equal(X.evaluate(X.stripOwn(snap('002448.SZ')), X.defaultContext()).why, 'store-old');
    assert.deepEqual([revGrowthLeg(snap('002448.SZ')).basis, revGrowthLeg(snap('002448.SZ')).periodEnd], ['year', '2025-12-31']);
  });
  withStore(shiftedStore(1), () => assert.equal(revGrowthLeg(snap('002448.SZ')).pct, 28.53102510166723));
});

test('break-once: without the positive pair-proof line the stale store admits the 002448.SZ June pair; live source unchanged', () => {
  const source = fs.readFileSync(GFILE, 'utf8'), lines = source.split(/\r?\n/);
  const anchor = "    if (!['agree', 'would-fill'].includes(res?.category) || !res.pairs?.some(p => p.status === 'agree' && p.end === q.sourcePeriodEnd && p.priorEnd === q.sourcePriorPeriodEnd)) return true;";
  assert.equal(lines.filter(l => l === anchor).length, 1, 'exact whole-line anchor');
  const m = new Module(GFILE, module), req = createRequire(GFILE);
  m.filename = GFILE; m.paths = module.paths; m.require = req;
  m._compile(lines.filter(l => l !== anchor).join('\n'), GFILE);
  const broken = withStore(shiftedStore(10), () => m.exports.g31Shadow(snap('002448.SZ')).v1);
  assert.throws(() => assert.equal(broken.basis, 'year'), assert.AssertionError);
  assert.equal(withStore(shiftedStore(10), () => G.g31Shadow(snap('002448.SZ')).v1.basis), 'year');
  assert.equal(sha(), before);
});
