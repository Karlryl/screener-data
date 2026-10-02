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
const snap = t => clone(F.snapshots[t]);
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
test('committed policy: mode off, tolerance 0.1 %, fill period 2025-09-30, baseline before 2026-08-01', () => {
  assert.equal(X.policy.mode, 'off');
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
  for (const t of F.mustWithhold) {
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
  // A securities firm is never filled.
  assert.equal(res(snap('6023.TWO')).stratum, 'broker');
});

test('reason text: level pair says the annual figure is shown; a non-level pair gets the acceleration text', () => {
  const lvl = run(snap('000599.SZ'), 'active').snapshot;
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
  const r = res(snap('000599.SZ'));
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
  assert.equal(revGrowthLeg(s).basis, 'year'); assert.equal(revGrowthLeg(a).basis, 'quarter');
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
  const nb = clone(F.baseline); delete nb.rows['000002.SZ'];
  const r = res(base(), ctxOf(F.store, nb));
  assert.equal(r.fill.blocked, 'no-baseline'); assert.equal(r.fill.otherwiseFillable, true); assert.equal(r.category, 'agree');
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
  assert.equal(revGrowthLeg(yes.s).basis, 'year', 'without the fill the gap blocks the quarterly leg');
});
test('drift: the vendor later delivers Q3-2025 with a different value -> withheld as the year-ago partner and counted', () => {
  const { s, ctx } = november(true), k = s.timeseries.revenueQEnds.indexOf('2025-09-30');
  s.timeseries.revenueQ[k] = { value: res(november(true).s, ctx).fill.nativeValue * s.meta.fxRateApplied * 1.05 };
  const r = res(s, ctx);
  assert.equal(r.fillPeriodVendorDisagrees, true);
  assert.ok(r.withhold.some(w => w.period === '2025-09-30' && w.level));
  assert.equal(revGrowthLeg(run(s, 'active', ctx).snapshot).basis !== 'quarter', true);
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
  assert.notEqual(revGrowthLeg(a).basis, 'quarter', 'the gap rule blocks the quarterly leg again');
  assert.equal(X.exchangeRecord(a).withheld.find(x => x.period === '2025-09-30').reasonCode, 'exchange-quarter-mismatch');
  assert.equal(serial(X.stripOwn(a)), serial(s), 'strip restores');
  assert.ok(r.growth && r.growth.basisAfter !== 'quarter', 'it took the quarterly leg away: the annual leg is checked (G4)');
  // Growth already on the annual leg before (level partner empty): withheld, but no annual check and no growth withhold.
  const y = clone(s); y.timeseries.revenueQ[y.timeseries.revenueQEnds.indexOf('2025-06-30')] = null;
  assert.equal(revGrowthLeg(y).basis, 'year');
  const ry = res(y);
  assert.equal(ry.category, 'would-withhold'); assert.equal(ry.growth, null);
  assert.equal(revGrowthLeg(run(clone(y), 'active').snapshot).pct, revGrowthLeg(y).pct, 'growth figure unchanged');
  // A broker's level gap is definition, never a fill-period mismatch.
  const br = clone(F.store); for (const list of Object.values(br.cn.companies['000002.SZ'].ytd)) for (const o of list) o.table = 'SINCOME';
  assert.ok(!res(clone(s), ctxOf(br)).withhold.some(x => x.fillPeriod));
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
  const s = snap('000599.SZ'); s.annual.annualRev = s.annual.annualRev.map(() => null);
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
  assert.ok(changed >= 24, 'active changed ' + changed);
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
  red("      if (!(x.latest[P].confirmedBy || []).some(c => c.updateDate && notice && c.updateDate >= notice)) return block('november-not-confirmed');", "",
    lib => { const n = november(false); assert.notEqual(r(lib, n.s, n.ctx).category, 'would-fill'); });
  // baseline (restatement since July)
  red("    const base = baselineCheck(s, ends, native, env, ctx, P.slice(0, 4));", "    const base = null;",
    lib => { const b = clone(F.baseline); b.rows['000002.SZ'].revenueQ[3] *= 1.0001; assert.notEqual(r(lib, base(), ctxOf(F.store, b)).category, 'would-fill'); });
  // annual fallback check
  red("        if (!['agree', 'none', 'quarter'].includes(res.growth.status)) res.category = 'would-withhold-growth';", "",
    lib => assert.equal(r(lib, snap('600150.SS')).category, 'would-withhold-growth'));
  // strip restores
  red("      else if (OWN_CODES.has(row.financialMissing?.reasonCode)) w.put(container, field, i, row.financialMissing.originalVendorRow);", "",
    lib => { const s = snap('000599.SZ'), a = lib.applyExchangeCheck(clone(s), { mode: 'active', context: CTX }).snapshot;
      assert.equal(serial(lib.applyExchangeCheck(a, { mode: 'off' }).snapshot), serial(s)); });
  // F5: a disagreeing delivered fill-period cell is withheld in any position
  red("        res.withhold.push({ index: k, period: P, level: false, fillPeriod: true, vendorNative: native[k], exchangeNative: ex[k] });", "",
    lib => { const s = base(), k = s.timeseries.revenueQEnds.indexOf('2025-09-30');
      s.timeseries.revenueQ[k] = { value: res(base()).fill.nativeValue * s.meta.fxRateApplied * 1.05 };
      assert.ok(r(lib, s).withhold.some(w => w.period === '2025-09-30')); });
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
  red("      if (level || (revGrowthLeg(s).basis === 'quarter' && revGrowthLeg(guarded).basis !== 'quarter')) {", "      if (true) {",
    lib => { const y = base(), k = y.timeseries.revenueQEnds.indexOf('2025-09-30');
      y.timeseries.revenueQ[k] = { value: res(base()).fill.nativeValue * y.meta.fxRateApplied * 1.05 };
      y.timeseries.revenueQ[y.timeseries.revenueQEnds.indexOf('2025-06-30')] = null;
      assert.equal(r(lib, y).growth, null); });
  assert.equal(breaks, 14);
});

test('live files unchanged by this test run', () => {
  assert.deepEqual(LIVE.map(sha), liveBefore);
});

console.log(`exchange-quarter-check: ${pass} passed, ${fail} failed, ${breaks} break-once red`);
process.exit(fail ? 1 : 0);
