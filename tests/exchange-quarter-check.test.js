'use strict';
// tests/exchange-quarter-check.test.js — standalone runner (node tests/exchange-quarter-check.test.js, exit 0/1).
// Tag 1403 (G2b): exchange cross-check guard and fill of 2025-09-30. Real data only: the fixture is cut from the
// committed store (Tag 1399), the snapshots of daily run 36984285974 and board-history/2026-07-29
// (tests/fixtures/exchange-quarter-check.json, "about"). Break-once targets memory-only module copies.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { Module, createRequire } = require('node:module');
const X = require('../lib/exchange-quarter-check.js');
const { revGrowthLeg } = require('../lib/rev-growth-basis.js');
const { withG31Variant, withoutOlderPair } = require('../lib/g31-recency.js');
const axes = require('../src/scoring/axes.js');
const { norm } = require('../src/scoring/snapshot.js');
const F = require('./fixtures/exchange-quarter-check.json');

const ROOT = path.resolve(__dirname, '..');
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex');
const LIVE = ['configs/exchange-quarter-policy.json', 'lib/exchange-quarter-check.js', 'external-data/exchange-quarters/cn.json',
  'external-data/exchange-quarters/tw.json'];
const liveBefore = LIVE.map(sha);
const clone = x => structuredClone(x), serial = JSON.stringify;
const v = r => typeof r === 'number' ? r : r?.value;
let pass = 0, fail = 0, breaks = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.stack || e)); }
}
const ctxOf = (store = F.store, baseline = F.baseline) => ({
  stores: { cn: store.cn, tw: store.tw, warnings: [] },
  baseline: { date: baseline.date, rows: new Map(Object.entries(baseline.rows)), warnings: [] } });
const CTX = ctxOf();
const snap = t => require('./helpers/dated-series.js').withEnds(clone(F.snapshots[t]));
const run = (s, mode = 'shadow', ctx = CTX) => X.applyExchangeCheck(s, { mode, context: ctx });
const res = (s, ctx) => run(s, 'shadow', ctx).result;
const ytd = (store, t, p) => store.cn.companies[t].ytd[p].at(-1);
function moduleCopy(relative, transform, overrides = {}) {
  const file = path.join(ROOT, relative), m = new Module(file, module), real = createRequire(file);
  m.filename = file; m.paths = module.paths;
  m.require = id => Object.hasOwn(overrides, id) ? overrides[id] : real(id);
  m._compile(transform(fs.readFileSync(file, 'utf8')), file);
  return m.exports;
}
function replaceLine(source, oldLine, newLine) {
  const lines = source.split(/\r?\n/);
  assert.equal(lines.filter(l => l === oldLine).length, 1, 'Exact whole-line mutation anchor: ' + oldLine);
  assert.notEqual(oldLine, newLine);
  return lines.map(l => l === oldLine ? newLine : l).join('\n');
}
const mutant = (oldLine, newLine) => moduleCopy('lib/exchange-quarter-check.js', s => replaceLine(s, oldLine, newLine));

// ── Policy and mode off ──────────────────────────────────────────────────────
test('committed policy: mode fill-only, tolerance 0.1 %, fill period 2025-09-30, baseline before 2026-08-01', () => {
  assert.equal(X.policy.mode, 'fill-only');
  assert.deepEqual(X.MODES, ['off', 'shadow', 'fill-only', 'active']);
  for (const mode of X.MODES) assert.equal(X.validatePolicy({ ...X.policy, mode }).mode, mode);
  assert.equal(X.policy.tolerance, 0.001);
  assert.deepEqual(X.policy.fillPeriods, ['2025-09-30']);
  assert.equal(X.policy.restatementBaselineBefore, '2026-08-01');
  for (const bad of [{ ...X.policy, mode: 'on' }, { ...X.policy, tolerance: 0.05 }, { ...X.policy, fillPeriods: ['2025-12-31'] }, {}]) {
    assert.throws(() => X.validatePolicy(bad), /Invalid exchange-quarter policy/);
  }
  assert.throws(() => X.applyExchangeCheck(snap('000002.SZ'), { mode: 'on' }), /Invalid exchange-quarter mode/);
});

test('mode off: the identical object for every fixture snapshot; the store is never read', () => {
  const trap = { get stores() { throw new Error('store read in mode off'); }, get baseline() { throw new Error('baseline read'); } };
  for (const t of Object.keys(F.snapshots)) {
    const s = snap(t), before = serial(s);
    const out = X.applyExchangeCheck(s, { mode: 'off', context: trap });
    assert.equal(out.snapshot, s, t);
    assert.equal(out.result, null);
    assert.equal(serial(s), before);
  }
  assert.equal(X.applyExchangeCheck(null, { mode: 'off' }).snapshot, null);
  // JSON data: an accessor is never executed (tests/p0-haertung2-fx-ehrlichkeit.test.js A-001 throws from one mid-conversion).
  const trapSnap = { meta: { ticker: '000002.SZ' } };
  Object.defineProperty(trapSnap, 'annual', { enumerable: true, get() { throw new Error('accessor executed'); } });
  for (const mode of ['off', 'shadow']) assert.equal(X.applyExchangeCheck(trapSnap, { mode, context: CTX }).snapshot, trapSnap);
});

// ── Real-data acceptance: the 16 wrong board rows and the 5 wrong risers ────
test('all 21 known wrong rows are checked and withheld (none unchecked); the withheld cell is the year-ago partner', () => {
  assert.equal(F.mustWithhold.length, 21);
  // P138: 000688.SZ is now corrected by the hand table, so the exchange check leaves it alone (unchecked, hand-table).
  // G31 switch (P268, 18.10.2026): 000599.SZ's unrestated Q2 2025 is held by the hand table, the same treatment.
  // 301297.SZ (ranks 11 to 25 of 30.10.2026) likewise. The other 17 stay withheld; the level examples below use 000564.SZ, the same kind of level mismatch.
  // Board-top check of 30.10.2026: 600292.SS's pre-merger Q2 2025 is corrected by the hand table, the same treatment.
  // Hand table of 07.11.2026 (sd-hand-4): 601211.SS's quarters and fiscal years are corrected to the filed CAS values, the same treatment.
  for (const t of ['000688.SZ', '000599.SZ', '600292.SS', '301297.SZ', '601211.SS']) {
    const handOwned = res(snap(t));
    assert.equal(handOwned.category, 'unchecked', t);
    assert.equal(handOwned.why, 'hand-table', t);
  }
  for (const t of F.mustWithhold.filter(t => !['000688.SZ', '000599.SZ', '600292.SS', '301297.SZ', '601211.SS'].includes(t))) {
    const s = snap(t), r = res(s);
    assert.ok(['would-withhold', 'would-withhold-growth'].includes(r.category), t + ' ' + r.category + ' ' + r.why);
    const lvl = r.withhold.find(w => w.level);
    assert.ok(lvl, t + ' level pair withheld');
    assert.ok(r.withhold.every(w => w.index > 0), t + ' newest never withheld');
    const a = run(snap(t), 'active').snapshot;
    assert.equal(a.timeseries.revenueQ[lvl.index].financialMissing.reasonCode, 'exchange-pair-mismatch');
    assert.equal(a.timeseries.revenueQ[lvl.index].value, null);
    assert.deepEqual(a.timeseries.revenueQ[lvl.index].financialMissing.originalVendorRow, s.timeseries.revenueQ[lvl.index]);
    assert.ok(['year', 'none'].includes(revGrowthLeg(a).basis), t + ' growth leaves the quarterly leg');
    assert.equal(revGrowthLeg(s).basis === 'quarter' || revGrowthLeg(s).basis === 'year', true);
    assert.equal(v(a.timeseries.revenueQ[0]), v(s.timeseries.revenueQ[0]), t + ' newest cell unchanged');
  }
});

test('securities firms are their own stratum: ratio consistency, not the level ratio', () => {
  // 601377.SS: vendor/exchange ratio about 0.86 on Q2-2025 and 0.91 on Q2-2026 -> mixed.
  const r = res(snap('601377.SS'));
  assert.equal(r.stratum, 'broker'); assert.equal(r.line, 'operate');
  const p = r.pairs.find(x => x.level);
  assert.ok(Math.abs(p.ratio[0] / p.ratio[1] - 1) > 0.001 && p.status === 'mixed');
  // 002945.SZ: levels differ from the exchange line (definition) but the ratio is constant -> agree, nothing withheld.
  const ok = res(snap('002945.SZ'));
  assert.equal(ok.stratum, 'broker'); assert.equal(ok.withhold.length, 0); assert.equal(ok.category, 'agree');
  assert.equal(serial(run(snap('002945.SZ'), 'active').snapshot), serial(snap('002945.SZ')));
  // A constant definition gap (every vendor quarter 4 % below the exchange line) is not a mixed pair for a broker ...
  const gap = s => { s.timeseries.revenueQ = s.timeseries.revenueQ.map(x => x && Number.isFinite(v(x)) ? { ...x, value: v(x) * 0.96 } : x); return s; };
  const g = res(gap(snap('002945.SZ')));
  assert.equal(g.category, 'agree'); assert.equal(g.withhold.length, 0);
  // ... but it is one for a general company.
  assert.ok(res(gap(snap('000006.SZ'))).withhold.length > 0);
  // 6023.TWO (the Taiwanese broker example) is hand-owned since 07.11.2026 (sd-hand-4): the exchange check leaves it alone.
  assert.deepEqual([res(snap('6023.TWO')).category, res(snap('6023.TWO')).why], ['unchecked', 'hand-table']);
});

test('reason text: level pair says the annual figure is shown; a non-level pair gets the acceleration text', () => {
  const lvl = run(snap('000564.SZ'), 'active').snapshot;
  const cell = lvl.timeseries.revenueQ.find(x => x?.financialMissing);
  assert.equal(cell.financialMissing.reason, X.REASONS.level);
  const r = res(snap('601901.SS'));
  assert.ok(r.withhold.length && r.withhold.every(w => !w.level), '601901.SS: only a non-level pair is mixed');
  const a = run(snap('601901.SS'), 'active').snapshot;
  assert.ok(a.timeseries.revenueQ.filter(x => x?.financialMissing).every(x => x.financialMissing.reason === X.REASONS.acceleration));
  assert.equal(revGrowthLeg(a).basis, revGrowthLeg(snap('601901.SS')).basis, 'level leg unchanged');
  assert.equal(revGrowthLeg(a).pct, revGrowthLeg(snap('601901.SS')).pct);
});

test('mixed pair leaves the acceleration input', () => {
  const s = snap('601901.SS'), a = run(snap('601901.SS'), 'active').snapshot;
  const pairs = x => { const rq = norm(x, 'revenueQ'); return rq.map((_, i) => i).filter(i => { const j = require('../src/scoring/snapshot.js').jahresVergleichIdx(x, 'revenueQ', i);
    return j && j.idx < rq.length && rq[i] != null && rq[j.idx] != null; }); };
  assert.ok(pairs(a).length < pairs(s).length);
  for (const w of res(s).withhold) assert.ok(!pairs(a).includes(w.index - 4) || norm(a, 'revenueQ')[w.index] === null);
});

// ── G4: the annual fallback of a withheld row ────────────────────────────────
test('annual fallback agrees with the exchange full years: growth shows the annual figure', () => {
  const r = res(snap('000564.SZ'));
  assert.equal(r.category, 'would-withhold'); assert.equal(r.growth.basisAfter, 'year'); assert.equal(r.growth.status, 'agree');
  assert.deepEqual(r.growth.periodsChecked, ['2025-12-31', '2024-12-31'], 'undated vendor years compared by value');
});

test('annual fallback disagrees: the growth figure is withheld entirely (null with a reason), not replaced', () => {
  const s = snap('600150.SS'), r = res(s);
  assert.equal(r.category, 'would-withhold-growth'); assert.equal(r.growth.status, 'mixed');
  const a = run(snap('600150.SS'), 'active').snapshot;
  assert.equal(revGrowthLeg(a).basis, 'none'); assert.equal(axes.revGrowthLevel(a), null);
  assert.equal(axes.revAcceleration(a), null, 'no pairing of non-adjacent years');
  assert.equal(v(a.annual.annualRev[0]), v(s.annual.annualRev[0]), 'newest year kept');
  for (let i = 1; i < s.annual.annualRev.length; i++) if (Number.isFinite(v(s.annual.annualRev[i]))) {
    assert.equal(a.annual.annualRev[i].financialMissing.reasonCode, 'exchange-annual-mismatch');
    assert.equal(a.annual.annualRev[i].financialMissing.reason, X.REASONS.growth);
  }
  assert.ok(a.timeseries.revenueQ.some(x => x?.financialMissing?.reason === X.REASONS.growth), 'level cell carries the growth text');
  assert.equal(serial(X.stripOwn(a)), serial(s), 'strip restores');
});

test('annual fallback through a recorded newer fiscal year: checked, withheld as a whole, restored in place', () => {
  const s = snap('600150.SS'), x = F.store.cn.companies['600150.SS'].ytd;
  const fy = p => x[p].at(-1).total;
  const r0 = norm(s, 'annualRev')[0];
  // Agreeing record: the exchange full years themselves.
  s.meta.annualRevNewerYear = { end: '2025-12-31', revenue: fy('2025-12-31'), priorEnd: '2024-12-31', priorRevenue: fy('2024-12-31'), priorStored: r0 };
  const keys = Object.keys(s.meta);
  assert.equal(res(s).growth.basisAfter, 'yearNewerRecord'); assert.equal(res(s).growth.status, 'agree');
  s.meta.annualRevNewerYear.priorRevenue *= 0.9;
  const r = res(s); assert.equal(r.category, 'would-withhold-growth');
  const a = run(clone(s), 'active').snapshot;
  assert.equal(a.meta.annualRevNewerYear, null); assert.deepEqual(a.meta.exchangeCheck.withheldAnnualRevNewerYear, s.meta.annualRevNewerYear);
  assert.equal(revGrowthLeg(a).basis, 'none');
  const back = X.stripOwn(a);
  assert.deepEqual(Object.keys(back.meta), keys, 'key order unchanged'); assert.equal(serial(back), serial(s));
});

// ── Fill presence ────────────────────────────────────────────────────────────
test('fill presence: 000002.SZ gets Q3-2025 = 9M - H1 from one Eastmoney vintage; the quarterly leg is restored', () => {
  const s = snap('000002.SZ'), r = res(s);
  assert.equal(r.category, 'would-fill');
  const nineM = ytd(F.store, '000002.SZ', '2025-09-30').total, h1 = ytd(F.store, '000002.SZ', '2025-06-30').total;
  assert.equal(r.fill.nativeValue, nineM - h1); // 161,388,415,447.04 - 105,323,304,409.14
  const a = run(snap('000002.SZ'), 'active').snapshot, k = s.timeseries.revenueQEnds.indexOf('2025-09-30');
  const cell = a.timeseries.revenueQ[k];
  assert.equal(cell.value, (nineM - h1) * s.meta.fxRateApplied);
  for (const key of ['period', 'nativeValue', 'nativeCurrency', 'line', 'derivation', 'operands', 'source', 'dataDate', 'fetchedAt', 'reason', 'originalVendorRow']) assert.ok(Object.hasOwn(cell.exchangeFill, key), key);
  assert.equal(cell.exchangeFill.nativeCurrency, 'CNY'); assert.equal(cell.exchangeFill.derivation, '9M-H1');
  assert.equal(cell.exchangeFill.dataDate, '2025-10-31');
  assert.equal(cell.exchangeFill.reason, 'Umsatz 3. Quartal 2025 fehlte beim Datenanbieter und stammt aus der Börsenmeldung (Eastmoney, veröffentlicht 31.10.2025).');
  // G31 switch (18.10.2026): the dated Q1 pair already carried growth across the empty Q3 row; the fill only
  // completes the series. Legacy arm (pre-G31 gap rule): the fill restored the quarterly leg.
  assert.equal(revGrowthLeg(s).basis, 'quarter'); assert.equal(revGrowthLeg(a).basis, 'quarter');
  withG31Variant('legacy', () => { assert.equal(revGrowthLeg(s).basis, 'year'); assert.equal(revGrowthLeg(a).basis, 'quarter'); });
  assert.equal(X.exchangeRecord(a).filled[0].period, '2025-09-30'); assert.equal(X.exchangeRecord(s), null);
});

test('fill presence: Taiwan printed quarter (6446.TW, thousand TWD); 6949.TW agrees within the 500 TWD floor', () => {
  const r = res(snap('6446.TW'));
  assert.equal(r.category, 'would-fill'); assert.equal(r.fill.nativeValue, 3893772 * 1000); assert.equal(r.fill.derivation, 'printed-quarter');
  const a = run(snap('6446.TW'), 'active').snapshot;
  assert.equal(revGrowthLeg(a).basis, 'quarter');
  assert.match(a.timeseries.revenueQ[3].exchangeFill.reason, /^Umsatz 3\. Quartal 2025 fehlte beim Datenanbieter und stammt aus der Börsenmeldung \(MOPS, abgerufen \d\d\.\d\d\.\d{4}\)\.$/);
  assert.equal(res(snap('6949.TW')).category, 'would-fill');
});

// ── Fill absence: each condition alone blocks it ─────────────────────────────
const base = () => snap('000002.SZ');
const blocked = (s, ctx = CTX) => { const r = res(s, ctx); return r.category === 'would-fill' ? null : (r.fill?.blocked || r.why || r.category); };
const scaleCell = (s, end, f) => { const i = s.timeseries.revenueQEnds.indexOf(end); s.timeseries.revenueQ[i] = { ...s.timeseries.revenueQ[i], value: v(s.timeseries.revenueQ[i]) * f }; return s; };
test('fill absence: neighbour off by 0.1001 % blocks it, 0.0999 % passes (tolerance boundary)', () => {
  assert.equal(blocked(scaleCell(base(), '2026-03-31', 1.000999)), null);
  assert.notEqual(blocked(scaleCell(base(), '2026-03-31', 1.001001)), null);
  assert.equal(blocked(scaleCell(base(), '2026-03-31', 0.999001)), null);
  assert.notEqual(blocked(scaleCell(base(), '2026-03-31', 0.998999)), null);
});
test('fill absence: exchange Q3 <= 0 blocks it', () => {
  const st = clone(F.store), y = st.cn.companies['000002.SZ'].ytd;
  const h1 = y['2025-06-30'].at(-1).total, nine = y['2025-09-30'].at(-1);
  const delta = nine.total - (h1 - 1);
  nine.total = h1 - 1; y['2025-12-31'].at(-1).total -= delta; // Q4 = FY - 9M stays unchanged
  assert.equal(blocked(base(), ctxOf(st)), 'exchange-quarter-not-positive');
});
test('fill absence: restatement signal in the store blocks it', () => {
  const st = clone(F.store), list = st.cn.companies['000002.SZ'].ytd['2024-12-31'];
  list.push({ ...list[0], total: list[0].total + 1e6, operate: list[0].operate + 1e6 });
  assert.equal(blocked(base(), ctxOf(st)), 'restatement-signal');
});
test('fill absence: vendor 2025 quarter changed since board-history 2026-07-29, or no baseline row', () => {
  const b = clone(F.baseline); b.rows['000002.SZ'].revenueQ[3] *= 1.0001; // 2025-06-30
  assert.equal(b.rows['000002.SZ'].revenueQEnds[3], '2025-06-30');
  assert.equal(blocked(base(), ctxOf(F.store, b)), 'vendor-2025-changed');
  // sd-quellen 12.11.2026: a fill without a July row was built and withdrawn (Codex R-pr124 R3 P1: no source proves
  // the common reporting basis of 9M and H1); no baseline row stays a block
  const nb = clone(F.baseline); delete nb.rows['000002.SZ'];
  const withQ3 = firstRead => {
    const st = clone(F.store), y = st.cn.companies['000002.SZ'].ytd, q3 = y['2025-09-30'].at(-1);
    y['2026-09-30'] = [{ ...q3, noticeDate: '2026-10-28', confirmedBy: [{ src: 'x', fetchedAt: '2026-10-29T00:00:00.000Z', updateDate: '2026-10-28' }] }];
    q3.confirmedBy = [{ ...q3.confirmedBy[0], fetchedAt: firstRead }, { ...q3.confirmedBy[0], fetchedAt: '2026-10-30T00:00:00.000Z', updateDate: '2026-10-28' }];
    return st;
  };
  const early = withQ3('2026-10-02T07:07:40.607Z'), late = withQ3('2026-10-30T00:00:00.000Z');
  late.cn.companies['000002.SZ'].ytd['2025-09-30'].at(-1).confirmedBy.shift();   // first read after the Q3-2026 notice
  const r = res(base(), ctxOf(early, nb));
  assert.equal(r.fill.blocked, 'no-baseline'); assert.equal(r.fill.otherwiseFillable, true); assert.equal(r.category, 'agree');
  assert.equal(r.fill.baseline, undefined);
  // July row, 9M as filed (updateDate = its own notice), read before the Q3-2026 notice and unchanged after it: fills
  const ok = res(base(), ctxOf(early, F.baseline));
  assert.equal(ok.category, 'would-fill'); assert.equal(ok.fill.blocked, null);
  // risk signals on the July path (Codex R-pr124 R1/R2, Opus R3): late first read, Beijing day boundary, no updateDate,
  // a 9M row rewritten before the first read, impossible calendar days at the first or at the later confirmation
  assert.equal(res(base(), ctxOf(late, F.baseline)).fill.blocked, 'november-read-late', 'first read after the Q3-2026 notice');
  const edge = withQ3('2026-10-27T19:00:00.000Z'); edge.cn.companies['000002.SZ'].ytd['2025-09-30'].at(-1).confirmedBy[0].updateDate = '2026-10-28';
  assert.equal(res(base(), ctxOf(edge, F.baseline)).fill.blocked, 'november-read-late', 'UTC day before the notice, row already rewritten');
  const noUpd = withQ3('2026-10-02T07:07:40.607Z'); delete noUpd.cn.companies['000002.SZ'].ytd['2025-09-30'].at(-1).confirmedBy[0].updateDate;
  assert.equal(res(base(), ctxOf(noUpd, F.baseline)).fill.blocked, 'november-read-late', 'first read without updateDate');
  const pre = withQ3('2026-10-21T02:00:00.000Z'); pre.cn.companies['000002.SZ'].ytd['2025-09-30'].at(-1).confirmedBy[0].updateDate = '2026-10-20';
  assert.equal(res(base(), ctxOf(pre, F.baseline)).fill.blocked, 'rewritten-before-first-read', 'rewritten on 20.10., before the notice of 28.10.');
  for (const d of ['0000-00-00', '2026-02-30', '2025-1-31']) {
    const bad = withQ3('2026-10-02T07:07:40.607Z'); bad.cn.companies['000002.SZ'].ytd['2025-09-30'].at(-1).confirmedBy[0].updateDate = d;
    assert.equal(res(base(), ctxOf(bad, F.baseline)).fill.blocked, 'november-read-late', 'first updateDate ' + d);
  }
  for (const d of ['9999-99-99', 'not-a-date', '2026-11-31']) {   // Codex R-pr124 R3 P2-1: the later confirmation too
    const bad = withQ3('2026-10-02T07:07:40.607Z'); bad.cn.companies['000002.SZ'].ytd['2025-09-30'].at(-1).confirmedBy[1].updateDate = d;
    assert.equal(res(base(), ctxOf(bad, F.baseline)).fill.blocked, 'november-not-confirmed', 'later updateDate ' + d);
  }
  // Codex R-pr124 R2 P2-2: the same quarter listed twice
  const dup = base(), dts = dup.timeseries, i2 = dts.revenueQEnds.indexOf('2025-06-30');
  dts.revenueQEnds.splice(i2, 0, '2025-06-30'); dts.revenueQ.splice(i2, 0, structuredClone(dts.revenueQ[i2]));
  assert.equal(res(dup, ctxOf(early, F.baseline)).fill.blocked, 'duplicate-quarter-end');
  // ... and a baseline row that exists fills without any marker of the withdrawn path
  const rb = res(base(), ctxOf(F.store, F.baseline));
  assert.equal(rb.category, 'would-fill'); assert.equal(rb.fill.baseline, undefined);
});
test('fill absence: store period missing, currency, envelope, broker table, hand table, non-empty cell, newest cell', () => {
  const st = clone(F.store); delete st.cn.companies['000002.SZ'].ytd['2025-03-31'];
  assert.equal(blocked(base(), ctxOf(st)), 'store-period-missing');
  const eur = base(); eur.meta.reportingCurrencyOriginal = 'EUR'; assert.equal(blocked(eur), 'currency');
  for (const k of ['statementCurrencySource', 'ccyAmbiguous', 'fxConversionFailed']) { const s = base(); s.meta[k] = k === 'statementCurrencySource' ? 'sec' : true; assert.equal(blocked(s), 'envelope', k); }
  const src = base(); src.meta.source = 'fmp'; assert.equal(blocked(src), 'envelope');
  const br = clone(F.store); for (const list of Object.values(br.cn.companies['000002.SZ'].ytd)) for (const o of list) o.table = 'SINCOME';
  assert.equal(blocked(base(), ctxOf(br)), 'not-general');
  const ht = base(); ht.timeseries.revenueQ[0] = { ...ht.timeseries.revenueQ[0], yahooQ4Correction: { caseId: 'x' } };
  assert.equal(blocked(ht), 'hand-table');
  const full = base(), k = full.timeseries.revenueQEnds.indexOf('2025-09-30');
  full.timeseries.revenueQ[k] = { value: res(base()).fill.nativeValue * full.meta.fxRateApplied };
  const rf = res(full); assert.equal(rf.category, 'agree'); assert.equal(rf.fill, null);
  assert.equal(serial(run(clone(full), 'active').snapshot), serial(full), 'vendor delivered and agrees: no marker');
  const newest = base(); for (const f of ['revenueQ', 'revenueQEnds']) newest.timeseries[f] = newest.timeseries[f].slice(3);
  assert.equal(blocked(newest), 'newest-cell');
});
test('banks and insurers stay unchecked; a store without the company stays unchecked', () => {
  const s = base(); s.meta.industry = 'Banks - Regional'; assert.equal(res(s).why, 'bank-insurer');
  const i = base(); i.meta.industry = 'Insurance - Life'; assert.equal(res(i).why, 'bank-insurer');
  assert.equal(res(snap('1101.TW')).why, 'no-store-entry');
  assert.equal(serial(run(snap('1101.TW'), 'active').snapshot), serial(snap('1101.TW')));
});

// ── November replay (constructed): Q3-2026 reported ─────────────────────────
function november(confirm) {
  const st = clone(F.store), y = st.cn.companies['000002.SZ'].ytd;
  const h1 = y['2026-06-30'].at(-1), conf = { src: 'cn-20261110T070000Z', fetchedAt: '2026-11-10T07:00:00.000Z', updateDate: '2026-10-30' };
  st.cn.sources[conf.src] = { fetchedAt: conf.fetchedAt, periods: Object.keys(y).concat('2026-09-30'), absent: {} };
  const q3 = 60000000000;
  y['2026-09-30'] = [{ ...h1, reportType: '三季报', total: h1.total + q3, operate: h1.operate + q3, noticeDate: '2026-10-30', confirmedBy: [conf] }];
  if (confirm) for (const list of Object.values(y)) list.at(-1).confirmedBy.push({ ...conf, updateDate: list === y['2025-09-30'] ? '2026-10-30' : list.at(-1).confirmedBy.at(-1).updateDate });
  else for (const [p, list] of Object.entries(y)) if (p !== '2026-09-30') list.at(-1).confirmedBy.push({ ...conf, updateDate: list.at(-1).confirmedBy.at(-1).updateDate });
  const s = base();
  s.meta.fetchedAt = '2026-11-10T09:00:00.000Z';
  s.timeseries.revenueQ.unshift({ value: q3 * s.meta.fxRateApplied }); s.timeseries.revenueQEnds.unshift('2026-09-30');
  return { s, ctx: ctxOf(st) };
}
test('November replay: Q3-2025 counts only when confirmed after the Q3-2026 notice; then it is the year-ago partner', () => {
  const no = november(false);
  assert.equal(blocked(no.s, no.ctx), 'november-not-confirmed');
  const yes = november(true), r = res(yes.s, yes.ctx);
  assert.equal(r.category, 'would-fill');
  const a = run(yes.s, 'active', yes.ctx).snapshot;
  const leg = revGrowthLeg(a);
  assert.equal(leg.basis, 'quarter'); assert.equal(leg.periodEnd, '2026-09-30'); assert.equal(leg.priorPeriodEnd, '2025-09-30');
  assert.ok(Math.abs(leg.pct - (60000000000 / r.fill.nativeValue - 1) * 100) < 1e-9);
  // Adapted for PR "G31: newest complete quarter pair before the annual pair" (sd-p2, 29.10.2026): without the fill the
  // September quarter has no partner. The index-0 selection, which this check judges, then falls back to the fiscal year;
  // the shown growth may now take the older June pair instead, whose verdict reads the live exchange store and is pinned
  // with a fixture store in tests/g31-older-quarter-pair.test.js.
  assert.equal(withoutOlderPair(() => revGrowthLeg(yes.s)).basis, 'year', 'without the fill the gap blocks the quarterly leg');
});
test('drift: the vendor later delivers Q3-2025 with a different value -> withheld as the year-ago partner and counted', () => {
  const { s, ctx } = november(true), k = s.timeseries.revenueQEnds.indexOf('2025-09-30');
  s.timeseries.revenueQ[k] = { value: res(november(true).s, ctx).fill.nativeValue * s.meta.fxRateApplied * 1.05 };
  const r = res(s, ctx);
  assert.equal(r.fillPeriodVendorDisagrees, true);
  assert.ok(r.withhold.some(w => w.period === '2025-09-30' && w.level));
  assert.ok(!r.withhold.some(w => w.fillPeriod), 'the November level partner is one entry and keeps the pair code');
  const a = run(s, 'active', ctx).snapshot;
  assert.equal(a.timeseries.revenueQ[a.timeseries.revenueQEnds.indexOf('2025-09-30')].financialMissing.reasonCode, 'exchange-pair-mismatch');
  assert.equal(revGrowthLeg(a).basis !== 'quarter', true);
});

test('F5 October: a delivered Q3-2025 off the exchange value outside the level pair is withheld with its own reason', () => {
  const s = base(), k = s.timeseries.revenueQEnds.indexOf('2025-09-30');
  s.timeseries.revenueQ[k] = { value: res(base()).fill.nativeValue * s.meta.fxRateApplied * 1.05 };
  assert.equal(revGrowthLeg(s).basis, 'quarter', 'the wrong quarter reopens the quarterly leg');
  const r = res(s);
  assert.equal(r.fillPeriodVendorDisagrees, true);
  assert.ok(r.category.startsWith('would-withhold'), r.category);
  const w = r.withhold.find(x => x.period === '2025-09-30');
  assert.ok(w && !w.level && w.fillPeriod, 'fill-period cell withheld');
  assert.ok(r.withhold.every(x => x.index > 0), 'newest never withheld');
  const a = run(clone(s), 'active').snapshot, cell = a.timeseries.revenueQ[k];
  assert.equal(cell.value, null);
  assert.equal(cell.financialMissing.reasonCode, 'exchange-quarter-mismatch');
  assert.equal(cell.financialMissing.reason, X.REASONS.lateQuarter);
  assert.deepEqual(cell.financialMissing.originalVendorRow, s.timeseries.revenueQ[k]);
  // G31 switch (18.10.2026): the withheld Q3 sits between the dated endpoints, so the quarterly leg stays and
  // G4 has no annual leg to check. Legacy arm (pre-G31 gap rule): it blocked the quarterly leg and G4 ran.
  assert.equal(revGrowthLeg(a).basis, 'quarter', 'an empty intermediate quarter does not block the dated pair');
  assert.ok(!r.growth, 'no annual check: the quarterly leg was not taken away');
  withG31Variant('legacy', () => {
    assert.notEqual(revGrowthLeg(a).basis, 'quarter', 'the gap rule blocks the quarterly leg again');
    const rl = res(s);
    assert.ok(rl.growth && rl.growth.basisAfter !== 'quarter', 'it took the quarterly leg away: the annual leg is checked (G4)');
  });
  assert.equal(X.exchangeRecord(a).withheld.find(x => x.period === '2025-09-30').reasonCode, 'exchange-quarter-mismatch');
  assert.equal(serial(X.stripOwn(a)), serial(s), 'strip restores');
  // Growth already on the annual leg before (level partner empty): withheld, but no annual check and no growth withhold.
  const y = clone(s); y.timeseries.revenueQ[y.timeseries.revenueQEnds.indexOf('2025-06-30')] = null;
  assert.equal(withoutOlderPair(() => revGrowthLeg(y)).basis, 'year');
  const ry = res(y);
  assert.equal(ry.category, 'would-withhold'); assert.equal(ry.growth, null);
  assert.equal(withoutOlderPair(() => revGrowthLeg(run(clone(y), 'active').snapshot).pct), withoutOlderPair(() => revGrowthLeg(y).pct), 'annual growth figure unchanged');
  // A broker's level gap is definition, never a fill-period mismatch.
  const br = clone(F.store); for (const list of Object.values(br.cn.companies['000002.SZ'].ytd)) for (const o of list) o.table = 'SINCOME';
  assert.ok(!res(clone(s), ctxOf(br)).withhold.some(x => x.fillPeriod));
});
// Review of deddc959d3: 4 of 8 holds on the data of 02.10. were on-time cells with correct values.
const offQ3 = () => { const s = base(), k = s.timeseries.revenueQEnds.indexOf('2025-09-30');
  s.timeseries.revenueQ[k] = { value: res(base()).fill.nativeValue * s.meta.fxRateApplied * 1.05 }; return { s, k }; };
test('F5 on time: a Q3-2025 cell the July vintage already carried is not withheld when it misses the store, only counted', () => {
  const { s, k } = offQ3(), b = clone(F.baseline), pit = b.rows['000002.SZ'];
  pit.revenueQ[pit.revenueQEnds.indexOf('2025-09-30')] = v(s.timeseries.revenueQ[k]);
  const r = res(clone(s), ctxOf(F.store, b));
  assert.equal(r.fillPeriodVendorDisagrees, true, 'still counted (warning)');
  assert.ok(!r.withhold.some(w => w.period === '2025-09-30'), 'on-time cell stays (G1)');
  assert.equal(serial(run(clone(s), 'active', ctxOf(F.store, b)).snapshot.timeseries.revenueQ[k]), serial(s.timeseries.revenueQ[k]));
  // No baseline row for the company: late delivery is unproven, nothing is withheld on that ground.
  const none = clone(F.baseline); delete none.rows['000002.SZ'];
  const rn = res(clone(s), ctxOf(F.store, none));
  assert.equal(rn.fillPeriodVendorDisagrees, true);
  assert.ok(!rn.withhold.some(w => w.period === '2025-09-30'));
  // Opposite case (L10): the vintage has the company but not the quarter -> proven late delivery, withheld.
  assert.ok(res(clone(s)).withhold.some(w => w.period === '2025-09-30' && w.fillPeriod));
});
test('F5 newest: Q3-2025 as the newest cell is never withheld, even when delivered late and off the store', () => {
  const { s } = offQ3();
  for (const f of ['revenueQ', 'revenueQEnds']) s.timeseries[f] = s.timeseries[f].slice(3);
  assert.equal(s.timeseries.revenueQEnds[0], '2025-09-30');
  const r = res(clone(s));
  assert.ok(!r.withhold.some(w => w.index === 0 || w.period === '2025-09-30'));
  const a = run(clone(s), 'active').snapshot;
  assert.equal(serial(a.timeseries.revenueQ[0]), serial(s.timeseries.revenueQ[0]));
});
test('fill absence: the two YTD operands of Q3-2025 last read by different fetches derive no quarter (one vintage)', () => {
  const st = clone(F.store);
  st.cn.sources['cn-20261003T000000Z'] = { fetchedAt: '2026-10-03T00:00:00.000Z', periods: ['2025-09-30'], absent: {} };
  assert.equal(blocked(base(), ctxOf(st)), 'store-period-missing');
});
test('fill absence: a disagreeing neighbour outside every pair blocks it even when the July vintage carries the same value', () => {
  const s = scaleCell(base(), '2025-12-31', 1.2), b = clone(F.baseline), pit = b.rows['000002.SZ'];
  pit.revenueQ[pit.revenueQEnds.indexOf('2025-12-31')] *= 1.2;
  assert.equal(blocked(s, ctxOf(F.store, b)), 'neighbour-disagrees');
});
test('fill absence: a vendor 2025 quarter the July vintage did not carry is not proven unchanged', () => {
  const b = clone(F.baseline); b.rows['000002.SZ'].revenueQ[3] = null; // 2025-06-30
  assert.equal(blocked(base(), ctxOf(F.store, b)), 'baseline-quarter-missing');
  const gone = clone(F.baseline), pit = gone.rows['000002.SZ'];
  for (const f of ['revenueQ', 'revenueQEnds']) pit[f] = pit[f].slice(0, 3); // window ends before 2025-06-30
  assert.equal(blocked(base(), ctxOf(F.store, gone)), 'baseline-quarter-missing');
});
function taiwanNovember(prior) {
  const st = clone(F.store), seasons = st.tw.companies['6446.TW'].seasons, q3 = seasons['114Q3'].at(-1);
  seasons['115Q3'] = [{ ...q3, columns: [['115年第3季', 4500000], ['114年第3季', prior],
    ['115年01月01日至115年09月30日', 15000000], ['114年01月01日至114年09月30日', 10753539]] }];
  return ctxOf(st);
}
test('November replay Taiwan: Q3-2025 then comes from the Q3-2026 filing comparative; without it no fill', () => {
  assert.equal(blocked(snap('6446.TW'), taiwanNovember(null)), 'november-not-confirmed');
  const r = res(snap('6446.TW'), taiwanNovember(3900000));
  assert.equal(r.category, 'would-fill'); assert.equal(r.fill.nativeValue, 3900000 * 1000);
});
test('reason text: level pair withheld and no annual figure -> the text says no growth is shown', () => {
  const s = snap('000564.SZ'); s.annual.annualRev = s.annual.annualRev.map(() => null);
  const r = res(s);
  assert.equal(r.growth.status, 'none'); assert.equal(r.category, 'would-withhold');
  const cell = run(clone(s), 'active').snapshot.timeseries.revenueQ.find(x => x?.financialMissing);
  assert.equal(cell.financialMissing.reason, X.REASONS.levelNoAnnual);
  assert.doesNotMatch(X.REASONS.levelNoAnnual, /Gezeigt wird der Jahreswert/);
});

// ── Guard absence, fiscal years, store state ─────────────────────────────────
test('guard absence: agreeing rows serialise identically; a disagreeing cell outside every pair is untouched', () => {
  for (const t of ['000006.SZ', '002945.SZ']) assert.equal(serial(run(snap(t), 'active').snapshot), serial(snap(t)), t);
  const s = scaleCell(base(), '2025-12-31', 1.2), r = res(s);
  assert.deepEqual(r.outsideDisagree, ['2025-12-31']); assert.equal(r.withhold.length, 0);
  assert.equal(v(run(clone(s), 'active').snapshot.timeseries.revenueQ[2]), v(s.timeseries.revenueQ[2]));
});
test('non-December fiscal year: a China chain off the calendar or a MOPS YTD from 07-01 derives nothing', () => {
  const st = clone(F.store); st.cn.companies['000002.SZ'].ytd['2025-09-30'].at(-1).reportType = '中报';
  assert.equal(res(base(), ctxOf(st)).why, 'fiscal-year-chain');
  const tw = clone(F.store);
  for (const list of Object.values(tw.tw.companies['6446.TW'].seasons)) for (const o of list) o.columns = o.columns.map(([l, n]) => [l.replace('01月01日', '07月01日').replace('年度', '會計年度'), n]);
  const r = res(snap('6446.TW'), ctxOf(tw));
  assert.equal(r.category, 'unchecked'); assert.equal(r.why, 'no-checkable-pair');
});
test('store missing, unreadable or old: unchecked plus one warning, never a failure', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xq-'));
  assert.notEqual(path.resolve(dir), path.join(ROOT, 'external-data', 'exchange-quarters'));
  fs.writeFileSync(path.join(dir, 'cn.json'), '{"schemaVersion":1,"market":"CN"'); // truncated
  const st = X.loadStores(dir);
  assert.equal(st.cn, null); assert.equal(st.tw, null); assert.equal(st.warnings.length, 2);
  assert.equal(res(base(), { stores: st, baseline: CTX.baseline }).why, 'store-missing');
  const old = base(); old.meta.fetchedAt = '2026-10-11T09:00:00.000Z'; assert.equal(res(old).why, 'store-old'); // 9 days
  const ok = base(); ok.meta.fetchedAt = '2026-10-09T09:00:00.000Z'; assert.equal(res(ok).category, 'would-fill');
  const season = base(); season.meta.fetchedAt = '2026-10-15T09:00:00.000Z'; assert.equal(res(season).why, 'store-old'); // 2 days in season
  assert.equal(X.loadBaseline(dir).date, null);
});
// Codex review of 176e0ad6dd: a partial Taiwan pass wrote a new run entry and made companies it did not read look fresh.
const partialTaiwan = read => { const st = clone(F.store);
  st.tw.sources['tw-20261020T070000Z'] = { fetchedAt: '2026-10-20T07:00:00.000Z', read };
  const s = snap('6446.TW'); s.meta.fetchedAt = '2026-10-20T09:00:00.000Z'; return { s, ctx: ctxOf(st) }; };
test('store age per company: a later run that did not read the company leaves its data old; one that read it makes it fresh', () => {
  const alone = snap('6446.TW'); alone.meta.fetchedAt = '2026-10-20T09:00:00.000Z';
  assert.equal(res(alone).why, 'store-old', '18 days after the only run');
  const other = partialTaiwan(['2548.TW 115Q2']);
  assert.equal(res(other.s, other.ctx).why, 'store-old', 'the run of 20.10. read only 2548.TW');
  const own = partialTaiwan(['6446.TW 115Q2']);
  assert.notEqual(res(own.s, own.ctx).why, 'store-old', 'the run of 20.10. read 6446.TW again');
  // China: a run that lists the period but has the company absent for every listed period does not count for it.
  const st = clone(F.store);
  st.cn.sources['cn-20261009T070000Z'] = { fetchedAt: '2026-10-09T07:00:00.000Z', periods: ['2026-06-30'], absent: { '2026-06-30': ['000002.SZ'] } };
  const cn = base(); cn.meta.fetchedAt = '2026-10-11T09:00:00.000Z';
  assert.equal(res(cn, ctxOf(st)).why, 'store-old', 'absent in the newer run: still 9 days old');
  st.cn.sources['cn-20261009T070000Z'].absent = {};
  assert.notEqual(res(clone(cn), ctxOf(clone(st))).why, 'store-old', 'read by the newer run: fresh');
  // A company without a store entry is reported as such, not as old.
  assert.equal(res(snap('1101.TW')).why, 'no-store-entry');
});

// P151: the empty MOPS entry shape seen for no-line and letter-suffixed bad-id companies.
const neverReadTaiwan = (ticker = '2885.TW', code = 'no-line', industry = 'Financial Conglomerates') => {
  const st = clone(F.store), s = snap('6446.TW'), at = '2026-10-02T07:00:00.000Z';
  st.tw.companies[ticker] = { companyId: ticker.split('.')[0], seasons: {},
    noData: Object.fromEntries(['115Q2', '115Q1', '114Q4', '114Q3'].map(k => [k, { at, code }])) };
  Object.assign(s.meta, { ticker, industry, fetchedAt: '2026-10-02T09:00:00.000Z' });
  return { s, st, ctx: ctxOf(st) };
};
test('no-own-read: Taiwan no-line, including banks/insurers, keeps all snapshot values', () => {
  const { s, st, ctx } = neverReadTaiwan(), storeBefore = serial(st);
  for (const industry of ['Financial Conglomerates', 'Banks - Regional', 'Insurance - Life']) {
    s.meta.industry = industry;
    const before = serial(s);
    for (const mode of ['shadow', 'fill-only', 'active']) {
      const out = run(s, mode, ctx), r = out.result;
      assert.equal(r.why, 'no-own-read'); assert.equal(r.category, 'unchecked');
      assert.equal(r.whyText, 'Börsenquelle hat diese Firma noch nie geliefert');
      assert.deepEqual(r.noDataCodes, ['no-line']);
      assert.deepEqual(r.withhold, []); assert.equal(r.fill, null); assert.equal(r.growth, null);
      assert.equal(out.snapshot, s); assert.equal(serial(s), before);
      assert.equal(serial(st), storeBefore);
    }
  }
  assert.deepEqual(X.UNCHECKED_TEXT, {
    'no-own-read': 'Börsenquelle hat diese Firma noch nie geliefert',
    'store-old': 'Der letzte Abruf der Börsenquelle für diese Firma ist älter als die Frist',
  });
});
for (const [ticker, industry] of [['1312A.TW', 'Chemicals'], ['2002A.TW', 'Steel']]) {
  test('no-own-read: ' + ticker + ' keeps its bad-id diagnosis', () => {
    const { s, st, ctx } = neverReadTaiwan(ticker, 'bad-id', industry), before = serial(s), storeBefore = serial(st);
    const out = run(s, 'fill-only', ctx);
    assert.equal(out.result.why, 'no-own-read'); assert.equal(out.result.category, 'unchecked');
    assert.equal(out.result.whyText, 'Börsenquelle hat diese Firma noch nie geliefert');
    assert.deepEqual(out.result.noDataCodes, ['bad-id']);
    assert.equal(out.snapshot, s); assert.equal(serial(s), before); assert.equal(serial(st), storeBefore);
  });
}
test('no-own-read: China with no YTD observations has no diagnostic codes', () => {
  const st = clone(F.store), s = base();
  st.cn.companies[s.meta.ticker].ytd = {};
  s.meta.fetchedAt = '2026-10-02T09:00:00.000Z';
  const before = serial(s), storeBefore = serial(st), out = run(s, 'fill-only', ctxOf(st));
  assert.equal(out.result.why, 'no-own-read'); assert.equal(out.result.category, 'unchecked');
  assert.equal(out.result.whyText, 'Börsenquelle hat diese Firma noch nie geliefert');
  assert.deepEqual(out.result.noDataCodes, []);
  assert.equal(out.snapshot, s); assert.equal(serial(s), before); assert.equal(serial(st), storeBefore);
});
test('no-own-read: codes are sorted and unique; empty lists are not observations', () => {
  const { s, st } = neverReadTaiwan();
  st.tw.companies[s.meta.ticker].seasons = { '115Q2': [] };
  st.tw.companies[s.meta.ticker].noData['114Q4'].code = 'bad-id';
  const r = res(s, ctxOf(st));
  assert.equal(r.why, 'no-own-read'); assert.deepEqual(r.noDataCodes, ['bad-id', 'no-line']);
  const empty = clone(st); empty.tw.companies[s.meta.ticker].noData = {};
  assert.deepEqual(res(s, ctxOf(empty)).noDataCodes, []);
});
test('no-own-read: global age wins; absent entries and observations without a run keep their reasons', () => {
  const { s, st } = neverReadTaiwan();
  assert.equal(res(s, ctxOf(st)).why, 'no-own-read', 'fresh store, no observations or own read');
  const checkOld = (snapshot, stores) => {
    const r = res(snapshot, ctxOf(stores));
    assert.equal(r.why, 'store-old'); assert.equal(r.category, 'unchecked');
    assert.equal(r.whyText, 'Der letzte Abruf der Börsenquelle für diese Firma ist älter als die Frist');
    assert.ok(!Object.hasOwn(r, 'noDataCodes'));
  };
  const old = clone(st);
  for (const src of Object.values(old.tw.sources)) src.fetchedAt = '2026-01-01T00:00:00.000Z';
  checkOld(s, old);
  const later = clone(s); later.meta.fetchedAt = '2026-10-11T09:00:00.000Z';
  checkOld(later, clone(st)); // newest run nine days before the snapshot
  const invalid = clone(s); invalid.meta.fetchedAt = 'invalid'; checkOld(invalid, clone(st));
  const noRuns = clone(st); noRuns.tw.sources = {}; checkOld(s, noRuns);
  assert.equal(res(snap('1101.TW'), ctxOf(clone(st))).why, 'no-store-entry');
  const inconsistent = clone(F.store);
  for (const src of Object.values(inconsistent.tw.sources)) src.read = src.read.filter(r => !r.startsWith('6446.TW '));
  checkOld(snap('6446.TW'), inconsistent);
  const cn = clone(F.store);
  for (const src of Object.values(cn.cn.sources)) for (const p of src.periods) src.absent[p] = ['000002.SZ'];
  checkOld(base(), cn);
  const malformedRead = clone(st);
  malformedRead.tw.sources.bad = { fetchedAt: 'invalid', read: [s.meta.ticker + ' 115Q2'] };
  checkOld(s, malformedRead); // a recorded but invalid own read is not a missing read
});

// ── Mode switch leaves no residue ────────────────────────────────────────────
test('mode switch: active -> off restores every cell; active twice = active once; shadow never changes', () => {
  const all = [...Object.keys(F.snapshots).map(t => [snap(t), CTX]), [november(true).s, november(true).ctx]];
  let changed = 0;
  for (const [s, ctx] of all) {
    const before = serial(s), a = run(clone(s), 'active', ctx).snapshot;
    if (serial(a) !== before) changed++;
    assert.equal(serial(X.applyExchangeCheck(a, { mode: 'off' }).snapshot), before, 'off strips: ' + s.meta.ticker);
    assert.equal(serial(run(a, 'shadow', ctx).snapshot), before, 'shadow strips');
    assert.equal(serial(run(a, 'active', ctx).snapshot), serial(a), 'idempotent: ' + s.meta.ticker);
    const sh = run(s, 'shadow', ctx); assert.equal(sh.snapshot, s); assert.equal(serial(s), before);
  }
  assert.ok(changed >= 21, 'active changed ' + changed); // 301297.SZ is hand-owned since 30.10.2026; 601211.SS and 6023.TWO since 07.11.2026 (measured 21)
});

// ── Break-once (memory-only module copies, whole-line anchors) ───────────────
test('break-once: each guard line, when removed, turns its check red; the live module is unchanged', () => {
  const red = (oldLine, newLine, check) => {
    const broken = mutant(oldLine, newLine);
    assert.throws(() => check(broken), assert.AssertionError, oldLine);
    check(X); breaks++;
  };
  const r = (lib, s, ctx = CTX) => lib.applyExchangeCheck(s, { mode: 'shadow', context: ctx }).result;
  // tolerance comparison
  red("  const agree = (v, e) => finite(v) && finite(e) && Math.abs(v - e) <= Math.max(tol * Math.abs(e), x.floor);",
    "  const agree = (v, e) => finite(v) && finite(e);",
    lib => assert.notEqual(r(lib, scaleCell(base(), '2026-03-31', 1.001001)).category, 'would-fill'));
  // Codex R-pr124 P1: 9M of the fill year first read after the next-year notice (one basis unproven)
  const lateRead = clone(F.store), ly = lateRead.cn.companies['000002.SZ'].ytd, lq3 = ly['2025-09-30'].at(-1);
  ly['2026-09-30'] = [{ ...lq3, noticeDate: '2026-10-28', confirmedBy: [{ src: 'x', fetchedAt: '2026-10-29T00:00:00.000Z', updateDate: '2026-10-28' }] }];
  lq3.confirmedBy = [{ ...lq3.confirmedBy[0], fetchedAt: '2026-10-30T00:00:00.000Z', updateDate: '2026-10-28' }];
  red("      if (!(isDay(firstUpdate) && firstUpdate < notice)) return block('november-read-late');",
    '      // november-read-late removed',
    lib => assert.equal(r(lib, base(), ctxOf(lateRead, F.baseline)).fill.blocked, 'november-read-late'));
  // Codex R-pr124 R2 P1: 9M rewritten before the first read (one basis unproven)
  const rewr = clone(lateRead), rq3 = rewr.cn.companies['000002.SZ'].ytd['2025-09-30'].at(-1);
  rq3.confirmedBy = [{ ...rq3.confirmedBy[0], fetchedAt: '2026-10-21T02:00:00.000Z', updateDate: '2026-10-20' },
    { ...rq3.confirmedBy[0], fetchedAt: '2026-10-30T00:00:00.000Z', updateDate: '2026-10-28' }];
  red("      if (!(isDay(o.noticeDate) && firstUpdate === o.noticeDate)) return block('rewritten-before-first-read');",
    '      // rewritten-before-first-read removed',
    lib => assert.equal(r(lib, base(), ctxOf(rewr, F.baseline)).fill.blocked, 'rewritten-before-first-read'));
  // Q3 > 0
  red("    if (!(xq[P] > 0)) return block('exchange-quarter-not-positive');", "",
    lib => { const st = clone(F.store), y = st.cn.companies['000002.SZ'].ytd, h1 = y['2025-06-30'].at(-1).total, nine = y['2025-09-30'].at(-1);
      y['2025-12-31'].at(-1).total -= nine.total - (h1 - 1); nine.total = h1 - 1; assert.notEqual(r(lib, base(), ctxOf(st)).category, 'would-fill'); });
  // hand-table authority
  red("  if (handTableAuthority(s)) return un('hand-table');", "",
    lib => { const s = base(); s.timeseries.revenueQ[0] = { ...s.timeseries.revenueQ[0], yahooQ4Correction: { caseId: 'x' } }; assert.equal(r(lib, s).why, 'hand-table'); });
  // broker ratio consistency
  red("    p.status = ex[i] === null || ex[j] === null ? 'unchecked' : pairAgree(p.vendor, p.exchange) ? 'agree' : 'mixed';",
    "    p.status = ex[i] === null || ex[j] === null ? 'unchecked' : 'agree';",
    lib => assert.ok(r(lib, snap('601377.SS')).withhold.length > 0));
  // November confirmation
  red("      if (!isDay(notice) || !(x.latest[P].confirmedBy || []).some(c => isDay(c.updateDate) && c.updateDate >= notice)) return block('november-not-confirmed');", "",
    lib => { const n = november(false); assert.notEqual(r(lib, n.s, n.ctx).category, 'would-fill'); });
  // baseline (restatement since July)
  red("    const base = baselineCheck(s, ends, native, env, ctx, P.slice(0, 4));", "    const base = null;",
    lib => { const b = clone(F.baseline); b.rows['000002.SZ'].revenueQ[3] *= 1.0001; assert.notEqual(r(lib, base(), ctxOf(F.store, b)).category, 'would-fill'); });
  // annual fallback check
  red("        if (!['agree', 'none', 'quarter'].includes(res.growth.status)) res.category = 'would-withhold-growth';", "",
    lib => assert.equal(r(lib, snap('600150.SS')).category, 'would-withhold-growth'));
  // strip restores
  red("      else if (OWN_CODES.has(row.financialMissing?.reasonCode)) w.put(container, field, i, row.financialMissing.originalVendorRow);", "",
    lib => { const s = snap('000564.SZ'), a = lib.applyExchangeCheck(clone(s), { mode: 'active', context: CTX }).snapshot;
      assert.equal(serial(lib.applyExchangeCheck(a, { mode: 'off' }).snapshot), serial(s)); });
  // F5: a disagreeing delivered fill-period cell is withheld in any position
  red("        res.withhold.push({ index: k, period: P, level: false, fillPeriod: true, vendorNative: native[k], exchangeNative: ex[k] });", "",
    lib => { const s = base(), k = s.timeseries.revenueQEnds.indexOf('2025-09-30');
      s.timeseries.revenueQ[k] = { value: res(base()).fill.nativeValue * s.meta.fxRateApplied * 1.05 };
      assert.ok(r(lib, s).withhold.some(w => w.period === '2025-09-30')); });
  // F5 holds only a proven late delivery (an on-time cell in the vintage stays)
  red("      if (deliveredAfterBaseline(s, P, env, ctx) && !res.withhold.some(w => w.index === k)) {", "      if (!res.withhold.some(w => w.index === k)) {",
    lib => { const { s, k } = offQ3(), b = clone(F.baseline), pit = b.rows['000002.SZ'];
      pit.revenueQ[pit.revenueQEnds.indexOf('2025-09-30')] = v(s.timeseries.revenueQ[k]);
      assert.ok(!r(lib, s, ctxOf(F.store, b)).withhold.some(w => w.period === '2025-09-30')); });
  // F5 never withholds the newest cell
  red("    if (k > 0 && native[k] !== null && ex[k] !== null && !agree(native[k], ex[k])) {", "    if (k >= 0 && native[k] !== null && ex[k] !== null && !agree(native[k], ex[k])) {",
    lib => { const { s } = offQ3(); for (const f of ['revenueQ', 'revenueQEnds']) s.timeseries[f] = s.timeseries[f].slice(3);
      assert.ok(!r(lib, s).withhold.some(w => w.index === 0)); });
  // F5 duplicate guard: the November level partner keeps the pair code
  red("      if (deliveredAfterBaseline(s, P, env, ctx) && !res.withhold.some(w => w.index === k)) {", "      if (deliveredAfterBaseline(s, P, env, ctx)) {",
    lib => { const { s, ctx } = november(true), k = s.timeseries.revenueQEnds.indexOf('2025-09-30');
      s.timeseries.revenueQ[k] = { value: res(november(true).s, ctx).fill.nativeValue * s.meta.fxRateApplied * 1.05 };
      assert.ok(!r(lib, s, ctx).withhold.some(w => w.fillPeriod)); });
  // store age is measured per company, not on the newest run of the market
  red("  return !finite(own) || (at - own) / 864e5 > limit ? 'store-old' : false;", "  return false;",
    lib => { const o = partialTaiwan(['2548.TW 115Q2']); assert.equal(r(lib, o.s, o.ctx).why, 'store-old'); });
  // one fetch vintage per derived quarter
  red("          S.lastConfirmedAt(store, ticker, p) !== S.lastConfirmedAt(store, ticker, p.slice(0, 5) + prev)) single[p] = null;",
    "          false) single[p] = null;",
    lib => { const st = clone(F.store);
      st.cn.sources['cn-20261003T000000Z'] = { fetchedAt: '2026-10-03T00:00:00.000Z', periods: ['2025-09-30'], absent: {} };
      assert.notEqual(r(lib, base(), ctxOf(st)).category, 'would-fill'); });
  // neighbour outside every pair
  red("    if (native.some((v, i) => v !== null && !agree(v, ex[i]))) return block('neighbour-disagrees');", "",
    lib => { const s = scaleCell(base(), '2025-12-31', 1.2), b = clone(F.baseline), pit = b.rows['000002.SZ'];
      pit.revenueQ[pit.revenueQEnds.indexOf('2025-12-31')] *= 1.2;
      assert.notEqual(r(lib, s, ctxOf(F.store, b)).category, 'would-fill'); });
  // Taiwan November rule
  red("      if (!v || !finite(v.priorQuarter)) return block('november-not-confirmed');", "",
    lib => assert.notEqual(r(lib, snap('6446.TW'), taiwanNovember(null)).category, 'would-fill'));
  // baseline: absent in the vintage is unproven
  red("    if (!finite(b)) { missing++; continue; } // absent or null in the vintage: unproven, not unchanged", "    if (!finite(b)) continue;",
    lib => { const b = clone(F.baseline); b.rows['000002.SZ'].revenueQ[3] = null; assert.notEqual(r(lib, base(), ctxOf(F.store, b)).category, 'would-fill'); });
  // F5 annual check only when the quarterly leg is lost
  red("      if (level || (interim(revGrowthLeg(s).basis) && !interim(revGrowthLeg(guarded).basis))) {", "      if (true) {",
    lib => { const y = base(), k = y.timeseries.revenueQEnds.indexOf('2025-09-30');
      y.timeseries.revenueQ[k] = { value: res(base()).fill.nativeValue * y.meta.fxRateApplied * 1.05 };
      y.timeseries.revenueQ[y.timeseries.revenueQEnds.indexOf('2025-06-30')] = null;
      assert.equal(r(lib, y).growth, null); });
  assert.equal(breaks, 20); // +1 november-read-late (Codex R-pr124 P1), +1 rewritten-before-first-read (R2 P1), 12.11.2026
});

test('fill-only: identical active fills, no withholding, no residue on mode switches, no input mutation', () => {
  for (const t of Object.keys(F.snapshots)) {
    const s = snap(t), before = serial(s), a = run(s, 'active'), f = run(s, 'fill-only');
    const expected = a.result?.category === 'would-fill' ? a.snapshot : s;
    assert.equal(serial(f.snapshot), serial(expected), t);
    assert.deepEqual(f.result, a.result, t + ': evaluation unchanged');
    assert.equal(serial(s), before, t + ': input untouched');
    assert.equal(serial(run(a.snapshot, 'fill-only').snapshot), serial(expected), t + ': old holds restored');
    assert.equal(serial(run(f.snapshot, 'fill-only').snapshot), serial(expected), t + ': idempotent');
    assert.equal(serial(run(f.snapshot, 'off').snapshot), before, t + ': off restores');
    assert.equal(serial(run(f.snapshot, 'shadow').snapshot), before, t + ': shadow restores');
    assert.ok(!/exchange-(pair|annual|quarter)-mismatch/.test(serial(f.snapshot)), t);
  }
});

test('fill-only break-once: fills, all four withholding paths, default policy and off no-op turn red in memory', () => {
  const anchor = "  const apply = mode === 'active' || (mode === 'fill-only' && result?.category === 'would-fill');";
  const checkFill = lib => {
    for (const t of ['000002.SZ', '6446.TW']) {
      const s = snap(t), expected = run(clone(s), 'active').snapshot;
      assert.equal(serial(lib.applyExchangeCheck(s, { mode: 'fill-only', context: CTX }).snapshot), serial(expected));
    }
  };
  assert.throws(() => checkFill(mutant(anchor, "  const apply = mode === 'active';")), assert.AssertionError);
  checkFill(X); breaks++;
  const cases = [['level', snap('000564.SZ'), X.REASONS.level], ['acceleration', snap('601901.SS'), X.REASONS.acceleration],
    ['growth', snap('600150.SS'), X.REASONS.growth], ['late-quarter', offQ3().s, X.REASONS.lateQuarter]];
  const broken = mutant(anchor, "  const apply = mode === 'active' || mode === 'fill-only';");
  for (const [name, s, reason] of cases) {
    const check = lib => {
      const f = lib.applyExchangeCheck(clone(s), { mode: 'fill-only', context: CTX }).snapshot;
      assert.equal(serial(f), serial(s), name + ': no cell or reason changes');
      const a = lib.applyExchangeCheck(clone(s), { mode: 'active', context: CTX }).snapshot;
      assert.ok(serial(a).includes(reason), name + ': active still withholds');
    };
    assert.throws(() => check(broken), assert.AssertionError); check(X); breaks++;
  }
  const policyCheck = lib => {
    assert.equal(lib.policy.mode, 'fill-only');
    assert.ok(lib.applyExchangeCheck(base(), { context: CTX }).snapshot.timeseries.revenueQ.some(c => c?.exchangeFill));
  };
  const policyOff = moduleCopy('lib/exchange-quarter-check.js', s => s,
    { '../configs/exchange-quarter-policy.json': { ...X.policy, mode: 'off' } });
  assert.throws(() => policyCheck(policyOff), assert.AssertionError); policyCheck(X); breaks++;
  const offCheck = lib => assert.equal(serial(lib.applyExchangeCheck(base(), { mode: 'off', context: CTX }).snapshot), serial(base()));
  const offBroken = moduleCopy('lib/exchange-quarter-check.js', s => replaceLine(replaceLine(s,
    "  if (mode === 'off' || !base?.meta?.ticker) return { snapshot: base, mode, result: null };",
    "  if (!base?.meta?.ticker) return { snapshot: base, mode, result: null };"), anchor, '  const apply = true;'));
  assert.throws(() => offCheck(offBroken), assert.AssertionError); offCheck(X); breaks++;
});

// ── K2: printed-check fill without a July row (constructed from the 000002.SZ fixture) ───────────────────────
// The Q3-2026 9M row is a copy of the Q3-2025 9M row (as in the no-baseline case above); the printed report carries
// the anchored quarter and a growth whose inverted rounding band contains the Eastmoney Q3-2025 single quarter.
function printedCase({ growthShift = 0, parseStatus = 'parsed', notice = '2026-10-28', totalShift = 0, company = true, priorLayout = null } = {}) {
  const st = clone(F.store), y = st.cn.companies['000002.SZ'].ytd, q3 = y['2025-09-30'].at(-1);
  y['2026-09-30'] = [{ ...q3, noticeDate: '2026-10-28', confirmedBy: [{ src: 'x', fetchedAt: '2026-10-29T00:00:00.000Z', updateDate: '2026-10-28' }] }];
  q3.confirmedBy = [q3.confirmedBy[0], { ...q3.confirmedBy[0], src: 'x', fetchedAt: '2026-10-29T00:00:00.000Z', updateDate: '2026-10-28' }];
  if (totalShift) { q3.total += totalShift; y['2025-12-31'].at(-1).total += totalShift; }
  st.cn.sources.x = { fetchedAt: '2026-10-29T00:00:00.000Z', periods: Object.keys(y), absent: {} };
  const nb = clone(F.baseline); delete nb.rows['000002.SZ'];
  const current = y['2026-09-30'][0].operate - y['2026-06-30'].at(-1).operate, prior = q3.operate - y['2025-06-30'].at(-1).operate;
  const cell = value => ({ printed: value.toFixed(2), value: Number(value.toFixed(2)), decimals: 2, roundingHalfWidth: 0.005 });
  const g = Number(((current / prior - 1) * 100).toFixed(2)) + growthShift;
  const obs = { periodEnd: '2026-09-30', announcementId: '1225600001', url: 'https://static.cninfo.com.cn/finalpage/2026-10-28/1225600001.PDF',
    noticeDate: notice, parseStatus, reason: parseStatus === 'parsed' ? null : 'growth-row-unbound', parserVersion: 'cn-q3-layout-v5',
    ...(parseStatus === 'parsed' ? { layout: 'table-row', unit: 1, current: cell(current), ytd: cell(y['2026-09-30'][0].operate),
      growth: { printed: g.toFixed(2) + '%', value: g, decimals: 2, roundingHalfWidth: 0.005 }, priorValues: null } : {}),
    confirmedBy: [{ src: 'p', fetchedAt: '2026-11-22T00:00:00.000Z' }] };
  if (priorLayout) Object.assign(obs, { layout: priorLayout, priorValues: { after: cell(prior) } }); // report prints the prior quarter
  const printed = { schemaVersion: 1, market: 'CN-PRINTED', currency: 'CNY', shadow: true,
    sources: { p: { year: 2026, fetchedAt: '2026-11-22T00:00:00.000Z', mode: 'live', read: ['000002.SZ'], errors: [] } },
    companies: company ? { '000002.SZ': { reports: { [obs.announcementId]: [obs] } } } : {} };
  const s = base(); s.meta.fetchedAt = '2026-10-29T09:00:00.000Z';
  return { s, ctx: { ...ctxOf(st, nb), printed }, prior, st, obs, g };
}
test('K2 printed-check: the reason names what the report prints, per method (review 22.11.)', () => {
  const head = 'Umsatz 3. Quartal 2025 fehlte beim Datenanbieter und stammt aus der Börsenmeldung (';
  const c = printedCase(), r = res(c.s, c.ctx), pct = '+' + c.g.toFixed(2).replace('.', ',') + ' %';
  assert.ok(c.g > 0 && r.fill.reason.startsWith(head), r.fill.reason);
  assert.equal(r.fill.printedCheck.growth, c.obs.growth.printed);
  assert.ok(r.fill.reason.endsWith(` Der Wert passt zu der Veränderung gegenüber dem Vorjahresquartal (${pct}), die die Firma im CNINFO-Bericht zum 3. Quartal 2026 (veröffentlicht 28.10.2026) selbst angibt.`), r.fill.reason);
  assert.doesNotMatch(r.fill.reason, /gedruckte|abgegrenzt/);
  c.obs.growth.printed = '-1,234.50%'; // text only: the band uses growth.value
  assert.match(res(c.s, c.ctx).fill.reason, /Vorjahresquartal \(-1\.234,50 %\)/);
  c.obs.growth.printed = '0.0'; assert.match(res(c.s, c.ctx).fill.reason, /Vorjahresquartal \(0,0 %\)/);
  for (const [layout, method] of [['single-prior', 'printed-prior'], ['table-row-restated-prior', 'printed-adjusted-prior']]) {
    const p = printedCase({ priorLayout: layout }), rp = res(p.s, p.ctx);
    assert.equal(rp.category, 'would-fill', layout); assert.equal(rp.fill.printedCheck.method, method);
    assert.equal(rp.fill.printedCheck.growth, undefined); assert.equal(rp.fill.nativeValue, p.prior);
    assert.ok(rp.fill.reason.endsWith(' Der Wert entspricht dem im CNINFO-Bericht zum 3. Quartal 2026 (veröffentlicht 28.10.2026) gedruckten Vorjahresquartal.'), rp.fill.reason);
  }
});
test('K2 printed-check: asOf, not fetchedAt, is the snapshot day of the notice check', () => {
  const status = (asOf, fetchedAt) => { const c = printedCase(); c.s.meta.asOf = asOf; c.s.meta.fetchedAt = fetchedAt;
    return X.printedCheck(c.s, c.ctx, '2026-09-30', c.prior).status; };
  assert.equal(status('2026-10-28T09:00:00.000Z', '2026-10-29T09:00:00.000Z'), 'notice-not-before-snapshot');
  assert.equal(status('2026-10-29T09:00:00.000Z', '2026-10-28T09:00:00.000Z'), 'agree');
});
test('K2 printed-check: a context without the printed store warns once per process when the switch is on', () => {
  const fresh = () => moduleCopy('lib/exchange-quarter-check.js', s => s);
  const warnings = lib => { const c = printedCase(), seen = [], warn = console.warn; delete c.ctx.printed; console.warn = m => seen.push(String(m));
    try { for (let i = 0; i < 3; i++) assert.equal(lib.printedCheck(c.s, c.ctx, '2026-09-30', c.prior).status, 'printed-store-missing'); } finally { console.warn = warn; }
    return seen; };
  const seen = warnings(fresh());
  assert.equal(seen.length, 1); assert.match(seen[0], /printedQ3Check is on but the context has no cn-printed store/);
  const off = moduleCopy('lib/exchange-quarter-check.js', s => s, { '../configs/exchange-quarter-policy.json': { ...X.policy, printedQ3Check: false } });
  assert.deepEqual(warnings(off), [], 'switch off: no warning');
  const c = printedCase(), seen2 = [], warn = console.warn; console.warn = m => seen2.push(m);
  try { fresh().printedCheck(c.s, c.ctx, '2026-09-30', c.prior); } finally { console.warn = warn; }
  assert.deepEqual(seen2, [], 'store present: no warning');
});
test('K2 printed-check: an agreeing printed prior quarter fills the Eastmoney value, with CNINFO reason', () => {
  const c = printedCase(), r = res(c.s, c.ctx);
  assert.equal(r.category, 'would-fill'); assert.equal(r.fill.blocked, null); assert.equal(r.fill.derivation, 'printed-check');
  assert.equal(r.fill.nativeValue, c.prior, 'the filled number is Eastmoney 9M - H1, never the printed value');
  assert.equal(r.fill.otherwiseFillable, undefined);
  assert.equal(r.fill.printedCheck.agree, true); assert.equal(r.fill.printedCheck.method, 'inverted-printed-growth');
  assert.ok(r.fill.printedCheck.lower <= c.prior && c.prior <= r.fill.printedCheck.upper);
  assert.match(r.fill.reason, /CNINFO-Bericht zum 3\. Quartal 2026 \(veröffentlicht 28\.10\.2026\)/);
  const out = run(clone(c.s), 'fill-only', c.ctx).snapshot, k = out.timeseries.revenueQEnds.indexOf('2025-09-30');
  assert.equal(out.timeseries.revenueQ[k].exchangeFill.derivation, 'printed-check');
  assert.equal(out.timeseries.revenueQ[k].exchangeFill.printedCheck.announcementId, '1225600001');
  assert.equal(out.timeseries.revenueQ[k].value, c.prior * c.s.meta.fxRateApplied);
  assert.equal(serial(X.stripOwn(out)), serial(c.s), 'the marker is removable like every own fill');
});
test('K2 printed-check: disagreeing, unparsed, missing, late or other-line reports keep no-baseline', () => {
  const kept = (c, status) => {
    const r = res(c.s, c.ctx);
    assert.equal(r.category, 'agree'); assert.equal(r.fill.blocked, 'no-baseline'); assert.equal(r.fill.otherwiseFillable, true);
    assert.equal(r.fill.printedCheck?.status ?? 'none', status);
    assert.equal(serial(run(clone(c.s), 'fill-only', c.ctx).snapshot), serial(c.s), status + ': no cell changes');
  };
  kept(printedCase({ growthShift: 0.02 }), 'mixed-basis');
  kept(printedCase({ parseStatus: 'unparsed' }), 'unparsed');
  kept(printedCase({ company: false }), 'unparsed');
  kept(printedCase({ notice: '2026-10-29' }), 'notice-not-before-snapshot');
  kept(printedCase({ totalShift: 1e7 }), 'fill-value-outside-printed-band');
  const noStore = printedCase(); delete noStore.ctx.printed; kept(noStore, 'printed-store-missing');
  const c = printedCase(), y = c.ctx.stores.cn.companies['000002.SZ'].ytd;
  y['2026-06-30'].at(-1).operate += 1; // today's Eastmoney anchor no longer the anchor the report was parsed against
  assert.equal(X.printedCheck(c.s, c.ctx, '2026-09-30', c.prior).status, 'unparsed');
});
test('K2 printed-check: printed-only never fills, and a broken agreement check turns red (break once)', () => {
  const c = printedCase(), cn = clone(c.ctx.stores.cn);
  cn.companies['000002.SZ'].ytd['2025-06-30'].at(-1).reportType = 'other'; // no Eastmoney prior-year anchor
  const only = lib => assert.equal(lib.printedCheck(c.s, { ...c.ctx, stores: { ...c.ctx.stores, cn } }, '2026-09-30', c.prior).agree, false);
  only(X);
  assert.equal(X.printedCheck(c.s, { ...c.ctx, stores: { ...c.ctx.stores, cn } }, '2026-09-30', c.prior).status, 'printed-only');
  assert.throws(() => only(mutant("  if (comparison.status !== 'agree') return out;", "  if (comparison.status === 'unparsed') return out;")), assert.AssertionError);
  breaks++;
  const band = lib => assert.equal(lib.applyExchangeCheck(printedCase({ totalShift: 1e7 }).s, { mode: 'shadow', context: printedCase({ totalShift: 1e7 }).ctx }).result.fill.blocked, 'no-baseline');
  band(X);
  assert.throws(() => band(mutant("  if (Parser.compare(obs, { current: value }).status !== 'agree') return { ...out, status: 'fill-value-outside-printed-band' };", '')), assert.AssertionError);
  breaks++;
});
test('K2 printed-check: switch off restores the previous no-baseline result exactly', () => {
  const c = printedCase();
  const off = moduleCopy('lib/exchange-quarter-check.js', s => s, { '../configs/exchange-quarter-policy.json': { ...X.policy, printedQ3Check: false } });
  const r = off.applyExchangeCheck(clone(c.s), { mode: 'shadow', context: c.ctx }).result;
  assert.deepEqual(Object.keys(r.fill), ['period', 'index', 'blocked', 'nativeValue', 'otherwiseFillable']);
  assert.equal(r.fill.blocked, 'no-baseline'); assert.equal(r.category, 'agree');
  assert.equal(serial(off.applyExchangeCheck(clone(c.s), { mode: 'fill-only', context: c.ctx }).snapshot), serial(c.s));
  assert.equal(X.policy.printedQ3Check, true, 'committed switch');
  for (const bad of ['yes', 1, null]) assert.throws(() => X.validatePolicy({ ...X.policy, printedQ3Check: bad }), /Invalid exchange-quarter policy/);
  assert.equal(X.validatePolicy({ ...X.policy, printedQ3Check: undefined }).mode, 'fill-only');
});

// ── K2-TW: printed check without a July row (constructed from the 6446.TW fixture) ─────────────────────────
// The MOPS 115Q3 season prints 114Q3 = 3,893,772 thousand TWD (the fixture's own 114Q3 quarter); the July row is removed.
function twPrintedCase({ season = true, readAt = '2026-09-24T21:00:00.000Z', prior = 3893772 } = {}) {
  const st = clone(F.store), nb = clone(F.baseline);
  delete nb.rows['6446.TW'];
  if (season) st.tw.companies['6446.TW'].seasons['115Q3'] = [{ reportType: '合併', line: '營業收入合計',
    columns: [['115年第3季', 5000000], ['114年第3季', prior], ['115年01月01日至115年09月30日', 16976809], ['114年01月01日至114年09月30日', 10753539]],
    confirmedBy: [{ src: 'tw-20261002T071224Z', fetchedAt: readAt, updateDate: null }] }];
  return { s: snap('6446.TW'), ctx: ctxOf(st, nb), st, nb };
}
// The store derives Q3-2025 from the 115Q3 comparative, so a disagreement needs a store module that derives it otherwise.
const S = require('../lib/exchange-quarter-store.js');
const shiftedStore = f => ({ ...S, taiwanSingleQuarters: seasons => { const q = S.taiwanSingleQuarters(seasons);
  return { ...q, '2025-09-30': q['2025-09-30'] * f }; } });
const twLib = (transform = s => s, policyPatch = {}, store = S) => moduleCopy('lib/exchange-quarter-check.js', transform,
  { '../configs/exchange-quarter-policy.json': { ...X.policy, ...policyPatch }, './exchange-quarter-store.js': store });

test('K2-TW printed check: an agreeing MOPS print fills the MOPS quarter, with season, line, column and printed figure', () => {
  const c = twPrintedCase(), r = res(c.s, c.ctx);
  assert.equal(r.category, 'would-fill'); assert.equal(r.fill.blocked, null); assert.equal(r.fill.derivation, 'printed-quarter');
  assert.equal(r.fill.nativeValue, 3893772 * 1000);
  assert.equal(r.fill.printedCheck.agree, true); assert.equal(r.fill.printedCheck.source, 'MOPS'); assert.equal(r.fill.printedCheck.season, '115Q3');
  assert.equal(r.fill.printedCheck.printedPriorQuarter, 3893772 * 1000); assert.equal(r.fill.operands[0].season, '115Q3');
  assert.equal(r.fill.reason, 'Umsatz 3. Quartal 2025 fehlte beim Datenanbieter und stammt aus der Börsenmeldung (MOPS, abgerufen 24.09.2026). ' +
    'Die Firma druckt diesen Wert selbst als Vorjahresquartal im MOPS-Bericht zum 3. Quartal 2026 (Saison 115Q3, Jahr 115 der taiwanischen Zählung = 2026), Zeile ' +
    '營業收入合計, Spalte 114年第3季 (gedruckt „3,893,772“ in Tausend TWD, also rund 3,9 Mrd. TWD).');
  const out = run(c.s, 'fill-only', c.ctx).snapshot, cell = out.timeseries.revenueQ[3];
  assert.equal(cell.exchangeFill.printedCheck.column, '114年第3季'); assert.equal(cell.exchangeFill.nativeValue, 3893772 * 1000);
  assert.equal(revGrowthLeg(out).basis, 'quarter');
});
test('K2-TW printed check: missing, late or disagreeing prints keep no-baseline; every other block keeps blocking', () => {
  const kept = (c, status, lib = X) => {
    const r = lib.applyExchangeCheck(clone(c.s), { mode: 'shadow', context: c.ctx }).result;
    assert.equal(r.fill.blocked, 'no-baseline', status); assert.equal(r.fill.otherwiseFillable, true, status);
    assert.equal(r.fill.printedCheck.status, status); assert.notEqual(r.category, 'would-fill');
    assert.equal(serial(lib.applyExchangeCheck(clone(c.s), { mode: 'fill-only', context: c.ctx }).snapshot), serial(c.s), status);
  };
  kept(twPrintedCase({ season: false }), 'no-printed-report');
  kept(twPrintedCase({ readAt: '2026-09-26T00:00:00.000Z' }), 'read-after-snapshot');
  kept(twPrintedCase(), 'fill-value-differs-from-print', twLib(s => s, {}, shiftedStore(1.002)));
  assert.equal(twLib(s => s, {}, shiftedStore(1.0009)).applyExchangeCheck(clone(twPrintedCase().s), { mode: 'shadow', context: twPrintedCase().ctx })
    .result.category, 'would-fill', 'inside the 0.1 % tolerance');
  // A season without a printed prior quarter stays blocked earlier (november-not-confirmed), as before.
  const blank = twPrintedCase(); blank.st.tw.companies['6446.TW'].seasons['115Q3'][0].columns[1][1] = null;
  assert.equal(blocked(blank.s, blank.ctx), 'november-not-confirmed');
  const restated = twPrintedCase(), list = restated.st.tw.companies['6446.TW'].seasons['114Q4'];
  list.push(clone(list[0]));
  assert.equal(blocked(restated.s, restated.ctx), 'restatement-signal');
  // With the July row back, the baseline path decides and the print is not consulted (no printedCheck on the fill).
  const july = twPrintedCase(), withRow = ctxOf(july.st, F.baseline);
  const rj = res(july.s, withRow); assert.equal(rj.category, 'would-fill'); assert.equal(rj.fill.printedCheck, undefined);
  // Direct call: the agreement test is the one passed in.
  const c = twPrintedCase(), xs = { keyOf: () => '115Q3', latest: { '115Q3': c.st.tw.companies['6446.TW'].seasons['115Q3'][0] } };
  assert.equal(X.twPrintedCheck(c.s, xs, '2026-09-30', 1, () => false).status, 'fill-value-differs-from-print');
  assert.equal(X.twPrintedCheck(c.s, xs, '2026-09-30', 1, () => true).agree, true);
});
test('K2-TW printed check: a broken agreement or read-day check turns red (break once)', () => {
  const disagree = lib => assert.equal(lib.applyExchangeCheck(clone(twPrintedCase().s), { mode: 'shadow', context: twPrintedCase().ctx }).result.fill.blocked, 'no-baseline', 'tw disagreement blocks');
  disagree(twLib(s => s, {}, shiftedStore(1.002)));
  assert.throws(() => disagree(twLib(s => replaceLine(s, "  if (!agree(value, v.priorQuarter)) return { ...evidence, status: 'fill-value-differs-from-print' };", ''), {}, shiftedStore(1.002))), /tw disagreement blocks/); // review 23.11. N3: a missing anchor no longer counts as red
  breaks++;
  const late = lib => assert.equal(lib.applyExchangeCheck(clone(twPrintedCase().s), { mode: 'shadow', context: twPrintedCase({ readAt: '2026-09-26T00:00:00.000Z' }).ctx }).result.fill.blocked, 'no-baseline', 'tw late read blocks');
  late(X);
  assert.throws(() => late(twLib(s => replaceLine(s, "  if (!isDay(firstRead) || !isDay(snapshotDay) || firstRead > snapshotDay) return { ...evidence, status: 'read-after-snapshot' };", ''))), /tw late read blocks/);
  breaks++;
});
// Review 23.11. N4: the three read-day branches without a test.
test('K2-TW printed check: a read on the snapshot day fills, a season without a first read does not, asOf wins over fetchedAt', () => {
  const c0 = twPrintedCase(), day0 = String(c0.s.meta.asOf || c0.s.meta.fetchedAt).slice(0, 10);
  const same = twPrintedCase({ readAt: day0 + 'T23:59:00.000Z' });
  assert.equal(res(same.s, same.ctx).category, 'would-fill', 'same calendar day as the snapshot');
  const none = twPrintedCase(); none.st.tw.companies['6446.TW'].seasons['115Q3'][0].confirmedBy = [];
  assert.equal(res(none.s, none.ctx).fill.printedCheck.status, 'read-after-snapshot');
  const later = new Date(Date.parse(day0 + 'T00:00:00Z') + 3 * 864e5).toISOString().slice(0, 10);
  const asOf = twPrintedCase({ readAt: later + 'T08:00:00.000Z' }); asOf.s.meta.fetchedAt = later + 'T09:00:00.000Z';
  asOf.s.meta.asOf = day0 + 'T03:00:00.000Z';
  assert.equal(res(asOf.s, asOf.ctx).fill.printedCheck.status, 'read-after-snapshot', 'asOf decides, not the later fetchedAt');
  delete asOf.s.meta.asOf;
  assert.equal(res(asOf.s, asOf.ctx).category, 'would-fill', 'without asOf the fetchedAt day decides');
});
test('K2-TW printed check: switch off restores the previous no-baseline result exactly; own switch, China unaffected', () => {
  const c = twPrintedCase(), off = twLib(s => s, { printedQ3CheckTw: false });
  const r = off.applyExchangeCheck(clone(c.s), { mode: 'shadow', context: c.ctx }).result;
  assert.deepEqual(Object.keys(r.fill), ['period', 'index', 'blocked', 'nativeValue', 'otherwiseFillable']);
  assert.equal(r.fill.blocked, 'no-baseline');
  assert.equal(serial(off.applyExchangeCheck(clone(c.s), { mode: 'fill-only', context: c.ctx }).snapshot), serial(c.s));
  const p = printedCase(), cnOff = twLib(s => s, { printedQ3CheckTw: false });
  assert.equal(serial(cnOff.applyExchangeCheck(clone(p.s), { mode: 'shadow', context: p.ctx }).result), serial(res(p.s, p.ctx)), 'China path unchanged');
  assert.equal(twLib(s => s, { printedQ3Check: false }).applyExchangeCheck(clone(c.s), { mode: 'shadow', context: c.ctx }).result.category, 'would-fill',
    'the China switch does not gate Taiwan');
  assert.equal(X.policy.printedQ3CheckTw, true, 'committed switch');
  for (const bad of ['yes', 1, null]) assert.throws(() => X.validatePolicy({ ...X.policy, printedQ3CheckTw: bad }), /Invalid exchange-quarter policy/);
  assert.equal(X.validatePolicy({ ...X.policy, printedQ3CheckTw: undefined }).mode, 'fill-only');
});

// ── S1 withhold then fill (policy.withholdThenFill) ──────────────────────────
// 000002.SZ with its Q1-2025 vendor cell off the exchange by 5 %: only the acceleration pair Q1-2026/Q1-2025 is mixed,
// Q3-2025 is empty and otherwise fillable (the 22 A-shares of 21.11.2026 have this shape with Q2-2025).
const accelOff = () => scaleCell(base(), '2025-03-31', 1.05);
const wtfLib = on => twLib(s => s, { withholdThenFill: on });
test('S1 withhold then fill: an acceleration-only mismatch is withheld and Q3-2025 filled in fill-only mode', () => {
  const s = accelOff(), before = serial(s), f = run(s, 'fill-only');
  assert.equal(f.result.category, 'would-fill'); assert.deepEqual(f.result.withhold.map(w => w.period), ['2025-03-31']);
  assert.equal(f.result.fill.period, '2025-09-30'); assert.deepEqual(f.result.fill.afterWithhold, ['2025-03-31']);
  const ends = s.timeseries.revenueQEnds, held = f.snapshot.timeseries.revenueQ[ends.indexOf('2025-03-31')];
  assert.equal(held.value, null); assert.equal(held.financialMissing.reasonCode, 'exchange-pair-mismatch');
  assert.equal(held.financialMissing.reason, X.REASONS.acceleration);
  assert.equal(v(held.financialMissing.originalVendorRow), v(s.timeseries.revenueQ[ends.indexOf('2025-03-31')]));
  const filled = f.snapshot.timeseries.revenueQ[ends.indexOf('2025-09-30')];
  assert.equal(filled.exchangeFill.nativeValue, res(base()).fill.nativeValue, 'same Eastmoney value as without the mismatch');
  assert.equal(revGrowthLeg(f.snapshot).periodEnd, '2026-06-30');
  const rec = X.exchangeRecord(f.snapshot);
  assert.deepEqual([rec.filled.map(x => x.period), rec.withheld.map(x => x.period)], [['2025-09-30'], ['2025-03-31']]);
  assert.deepEqual(run(s, 'active').snapshot, f.snapshot, 'active applies the same');
  assert.equal(serial(s), before, 'input untouched');
  assert.equal(serial(run(f.snapshot, 'off').snapshot), before, 'off restores every vendor cell');
  assert.equal(serial(run(f.snapshot, 'fill-only').snapshot), serial(f.snapshot), 'idempotent');
});
test('S1 withhold then fill: level or fill-period mismatches and a blocked fill keep the previous result', () => {
  const lvl = scaleCell(base(), '2025-06-30', 1.05); // Q2-2026/Q2-2025 is the level pair
  const rl = res(lvl); assert.equal(rl.category, 'would-withhold'); assert.equal(rl.fill, null);
  assert.equal(serial(run(lvl, 'fill-only').snapshot), serial(lvl), 'fill-only changes nothing');
  const st = clone(F.store), list = st.cn.companies['000002.SZ'].ytd['2024-12-31'];
  list.push({ ...list[0], total: list[0].total + 1e6, operate: list[0].operate + 1e6 }); // restatement signal blocks the fill
  const rb = res(accelOff(), ctxOf(st)); assert.equal(rb.category, 'would-withhold'); assert.equal(rb.fill, null);
  assert.equal(serial(run(accelOff(), 'fill-only', ctxOf(st)).snapshot), serial(accelOff()), 'blocked fill: nothing withheld');
});
test('S1 withhold then fill: switch off restores the previous would-withhold result exactly; malformed switch throws', () => {
  const off = wtfLib(false), s = accelOff();
  const a = off.applyExchangeCheck(clone(s), { mode: 'fill-only', context: CTX });
  assert.equal(a.result.category, 'would-withhold'); assert.equal(a.result.fill, null);
  assert.equal(serial(a.snapshot), serial(s));
  assert.equal(X.policy.withholdThenFill, true, 'committed switch');
  for (const bad of ['yes', 1, null]) assert.throws(() => X.validatePolicy({ ...X.policy, withholdThenFill: bad }), /Invalid exchange-quarter policy/);
});
test('S1 withhold then fill: a broken gate or a fill without its withhold turns red (break once)', () => {
  const ok = lib => { const f = lib.applyExchangeCheck(accelOff(), { mode: 'fill-only', context: CTX });
    assert.equal(f.result.category, 'would-fill');
    const at = end => f.snapshot.timeseries.revenueQ[f.snapshot.timeseries.revenueQEnds.indexOf(end)];
    assert.equal(v(at('2025-03-31')), null, 'wrong cell withheld'); assert.ok(at('2025-09-30')?.exchangeFill, 'Q3-2025 filled'); };
  ok(X);
  const line = "  if (res.withhold.length && res.category === 'would-fill') s = withholdQuarters(s, res); // S1: withhold, then fill";
  assert.throws(() => ok(mutant(line, line.replace('s = withholdQuarters(s, res);', 's = s;'))), /wrong cell withheld/); // fill without withhold
  assert.throws(() => ok(mutant(line, line.replace('if (res.withhold.length &&', 'if (false &&'))), /Q3-2025 filled/); // withhold without fill
  breaks += 2;
  const lvl = lib => assert.equal(lib.applyExchangeCheck(scaleCell(base(), '2025-06-30', 1.05), { mode: 'shadow', context: CTX }).result.category, 'would-withhold', 'level stays withheld');
  lvl(X);
  assert.throws(() => lvl(mutant("      !res.withhold.some(w => w.level || w.fillPeriod || policy.fillPeriods.includes(w.period))) {", '      true) {')), /level stays withheld/);
  breaks++;
});

test('live files unchanged by this test run', () => {
  assert.deepEqual(LIVE.map(sha), liveBefore);
});

console.log(`exchange-quarter-check: ${pass} passed, ${fail} failed, ${breaks} break-once red`);
process.exit(fail ? 1 : 0);
