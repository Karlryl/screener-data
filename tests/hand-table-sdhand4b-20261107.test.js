'use strict';
// Follow-up of #112 (07.11.2026, lane sd-hand-4; Codex re-check P112): the vendor leaves the year-ago quarter 30.09.2025 empty
// (Guotai Haitong, 360 ONE) or omits it (Chennai Petroleum), so the boards showed older pairs although the issuers reported the
// September 2026 quarter: Guotai FY 2025 +87.40 % instead of Q3 -46.35 %, Chennai June +57.14 % instead of September +10.09 %,
// 360 ONE June +26.56 % instead of September +4.17 %. vendorGap rows fill the empty cell or insert the omitted quarter with
// the filed value (lib/financial-known-cases.js); Chennai's fiscal years move to the filed line (78,610.79 and 71,049.95 crore).
// Real packets of daily run 42356903064 (tests/fixtures/hand-table-sdhand4-20261107.json). In-memory probes only; live files
// hashed before and after. Break-once: `--prove-red` runs the same assertions on the table without these rows and exits 1.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const H = require('../lib/financial-known-cases.js');
const { g31Shadow } = require('../lib/g31-recency.js');
const F = require('./fixtures/hand-table-sdhand4-20261107.json').snapshots;

const root = path.resolve(__dirname, '..');
const live = ['configs/financial-known-cases.json', 'data-health/erwartungen.json', 'tests/fixtures/hand-table-sdhand4-20261107.json'];
const liveHashes = () => live.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'));
const beforeHashes = liveHashes();
const REV = '2026-11-07-sdhand4b';
const pre = structuredClone(H.table);
pre.cases = pre.cases.filter(c => c.revision !== REV);
H.validateTable(pre);
const active = process.argv.includes('--prove-red') ? pre : H.table;
const value = r => (r && typeof r === 'object' ? r.value ?? null : r ?? null);
const pkt = (t, as) => { const s = structuredClone(F[t]); if (as) s.meta.ticker = as; return s; };
const apply = (s, table = active) => H.applyFinancialCases(s, { table }).snapshot;
const pct = (a, b) => (a / b - 1) * 100;

const ROWS = [
  ['601211.SS', ['year', '2025-12-31', 87.3988], pct(11813133439, 22019291518)],
  ['CHENNPETRO.NS', ['quarter', '2026-06-30', 57.1374], pct(22055.45, 20033.62)],
  ['360ONE.NS', ['quarter', '2026-06-30', 26.5596], pct(1143.83, 1098.06)],
];

test('the newest reported quarter leads: September 2026 against September 2025 on every listing', () => {
  for (const [t, [b0, e0, p0], after] of ROWS) {
    const v0 = g31Shadow(apply(pkt(t), pre)).v1;
    assert.deepEqual([v0.basis, v0.periodEnd], [b0, e0], t + ': precondition');
    assert.ok(Math.abs(v0.pct - p0) < 0.0001, t + ': precondition ' + v0.pct);
    for (const as of t === '360ONE.NS' ? [t, '360ONE.BO'] : [t]) {
      const v1 = g31Shadow(apply(pkt(t, as))).v1;
      assert.deepEqual([v1.basis, v1.periodEnd, v1.priorPeriodEnd], ['quarter', '2026-09-30', '2025-09-30'], as);
      assert.ok(Math.abs(v1.pct - after) < 1e-9, as + ' ' + v1.pct);
    }
  }
  assert.deepEqual(ROWS.map(r => +r[2].toFixed(2)), [-46.35, 10.09, 4.17]);
});

test('an empty vendor cell is filled once, a vendor figure that appears later is withheld, a not yet public value is not used', () => {
  const s = apply(pkt('601211.SS')), i = s.timeseries.revenueQEnds.indexOf('2025-09-30'), f = F['601211.SS'].meta.fxRateApplied;
  assert.equal(value(s.timeseries.revenueQ[i]), 22019291518 * f);
  assert.equal(s.timeseries.revenueQ[i].financialCorrection.caseId, '601211.ss-2025-09-30-revenueQ-20261107b');
  assert.deepEqual(apply(structuredClone(s)), s, 'idempotent');
  const later = pkt('601211.SS'); later.timeseries.revenueQ[i] = { value: 3e9 };
  assert.equal(apply(later).timeseries.revenueQ[i].financialMissing?.reasonCode, 'vendor-value-changed');
  const early = pkt('601211.SS'); early.meta.fetchedAt = '2025-10-15T10:00:00.000Z';
  assert.equal(value(apply(early).timeseries.revenueQ[i]), null, 'fetched before the Q3 2025 report of 31.10.2025');
  // Codex on #116, P1: the same cell checks as every other correction (currency, unit, multiplier, period type, source).
  for (const odd of [{ currency: 'EUR' }, { currencyUnit: 'EUR' }, { unit: 'shares' }, { multiplier: 1000 }, { periodType: '6M' }, { source: 'sec' }]) {
    const p = pkt('601211.SS'); p.timeseries.revenueQ[i] = { value: null, ...odd };
    const o = apply(p).timeseries.revenueQ[i];
    assert.deepEqual([value(o), o.financialMissing?.reasonCode], [null, 'context-changed'], JSON.stringify(odd));
  }
  // A revised row refills its own earlier fill, and its own hold of a still empty cell (blind review M3).
  const revised = structuredClone(active), rc = revised.cases.find(c => c.caseId === '601211.ss-2025-09-30-revenueQ-20261107b');
  rc.replacementValue = 22000000000; rc.sources = [{ ...rc.sources[0], value: 22000000000 }];
  const again = H.applyFinancialCases(structuredClone(s), { table: revised }).snapshot;
  assert.equal(value(again.timeseries.revenueQ[i]), 22000000000 * f);
  const heldEmpty = pkt('601211.SS'); heldEmpty.timeseries.revenueQ[i] = { value: null, financialMissing: { reasonCode: 'context-changed', caseId: rc.caseId, originalVendorRow: null } };
  assert.equal(value(apply(heldEmpty).timeseries.revenueQ[i]), 22019291518 * f);
});

test('Chennai: the omitted quarter is inserted between its neighbours, every position-paired series stays aligned', () => {
  const raw = pkt('CHENNPETRO.NS'), s = apply(raw), ts = s.timeseries;
  const ends = ['2026-09-30', '2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'];
  assert.deepEqual(ts.revenueQEnds, ends);
  for (const f of ['grossProfitQ', 'opIncQ']) {
    assert.deepEqual(ts[f + 'Ends'], ends, f);
    assert.equal(ts[f][4], null, f + ': the inserted quarter stays empty, never invented');
    // grossProfitQ is held as a whole (no filed gross profit line, see below); opIncQ keeps every other cell.
    if (f === 'opIncQ') assert.deepEqual(ts[f].filter((_, k) => k !== 4), raw.timeseries[f].map((r, k) => apply(raw, pre).timeseries[f][k]), f + ': other cells unchanged');
  }
  assert.equal(ts.netIncomeQ.length, raw.timeseries.netIncomeQ.length + 1);
  assert.equal(ts.netIncomeQ[4], null);
  assert.equal(value(ts.revenueQ[4]), 200336200000 * raw.meta.fxRateApplied);
  for (const [f, list] of Object.entries(s.meta.statementPeriods || {})) if (Array.isArray(list) && list.length === ts[f]?.length) assert.equal(list[4].end, '2025-09-30', f);
  assert.deepEqual(apply(structuredClone(s)), s, 'idempotent: a stored packet keeps exactly one inserted quarter');
  // Two quarters missing between the neighbours (31.12.2025 also gone): no insert, logged (blind review N2).
  const hole = pkt('CHENNPETRO.NS'), j = hole.timeseries.revenueQEnds.indexOf('2025-12-31');
  for (const f of ['revenueQ', 'grossProfitQ', 'opIncQ']) { hole.timeseries[f].splice(j, 1); hole.timeseries[f + 'Ends'].splice(j, 1); }
  hole.timeseries.netIncomeQ.splice(j, 1);
  const r = H.applyFinancialCases(hole, { table: active });
  assert.ok(!r.snapshot.timeseries.revenueQEnds.includes('2025-09-30'));
  assert.ok(r.events.some(e => e.reasonCode === 'vendor-gap-unfilled' && e.period === '2025-09-30' && /mehr als dieses eine Quartal/.test(e.reason)));
  // Statement periods on other ends: no insert (blind review N1).
  const off = pkt('CHENNPETRO.NS'); off.meta.statementPeriods = { revenueQ: off.timeseries.revenueQEnds.map(e => ({ end: e === '2025-06-30' ? '2025-03-31' : e })) };
  assert.ok(!H.applyFinancialCases(off, { table: active }).snapshot.timeseries.revenueQEnds.includes('2025-09-30'));
  // netIncomeQ periods on other ends (it already holds 30.09.2025) and a netIncomeQ shorter than revenueQ: no insert (review round 2).
  const niOff = pkt('CHENNPETRO.NS'); niOff.meta.statementPeriods = { netIncomeQ: ['2026-09-30', '2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30'].map(end => ({ end })) };
  assert.ok(!H.applyFinancialCases(niOff, { table: active }).snapshot.timeseries.revenueQEnds.includes('2025-09-30'));
  const niShort = pkt('CHENNPETRO.NS'); niShort.timeseries.netIncomeQ = niShort.timeseries.netIncomeQ.slice(0, -1);
  assert.ok(!H.applyFinancialCases(niShort, { table: active }).snapshot.timeseries.revenueQEnds.includes('2025-09-30'));
  // A quarter older than the oldest vendor quarter is no interior gap: nothing changes.
  const old = pkt('CHENNPETRO.NS'); for (const k of ['revenueQ', 'grossProfitQ', 'opIncQ']) { old.timeseries[k] = old.timeseries[k].slice(0, 4); old.timeseries[k + 'Ends'] = old.timeseries[k + 'Ends'].slice(0, 4); } old.timeseries.netIncomeQ = old.timeseries.netIncomeQ.slice(0, 4);
  assert.ok(!H.applyFinancialCases(old, { table: active }).snapshot.timeseries.revenueQEnds.includes('2025-09-30'));
});

test('Chennai gross profit is withheld: no filed line, and the vendor figure sits on the basis net of excise (Codex on #116, P2)', () => {
  const s = apply(pkt('CHENNPETRO.NS'));
  assert.deepEqual(s.timeseries.grossProfitQ.map(value), [null, null, null, null, null, null]);
  assert.deepEqual(s.annual.annualGP.map(value), [null, null, null, null], 'the fiscal year 2026 and every older one');
  assert.ok(Math.abs(63662000000 / 786107900000 * 100 - 8.10) < 0.01, 'the mixed margin the hold prevents');
  assert.ok(H.financialReasons(s).some(r => /druckt keine Bruttogewinnzeile/.test(r)), 'the hint travels with the row');
});

test('Chennai fiscal years on the filed line: +10.64 % instead of the vendor +7.22 %, older vendor years withheld', () => {
  const s = apply(pkt('CHENNPETRO.NS')), f = F['CHENNPETRO.NS'].meta.fxRateApplied, a = s.annual;
  assert.deepEqual(a.annualRev.slice(0, 2).map(value), [786107900000 * f, 710499500000 * f]);
  assert.ok(Math.abs(pct(786107900000, 710499500000) - 10.6416) < 0.0001);
  assert.ok(Math.abs(pct(635507500000, 592690100000) - 7.2242) < 0.0001, 'the vendor ratio before');
  assert.deepEqual(a.annualRev.slice(2).map(value), [null, null], 'net-of-excise years are not paired with the filed ones');
});

test('rows: eleven, one block after every earlier case, sources traced, reasons name their period, plain German', () => {
  const own = H.table.cases.filter(c => c.revision === REV);
  assert.equal(own.length, 11);
  const at = H.table.cases.indexOf(own[0]);
  assert.deepEqual(H.table.cases.slice(at, at + 11), own);
  assert.deepEqual(own.filter(c => c.vendorGap).map(c => [c.ticker, c.period, c.expectedBadValue, c.replacementValue]),
    [['601211.SS', '2025-09-30', null, 22019291518], ['360ONE.NS', '2025-09-30', null, 10980600000], ['CHENNPETRO.NS', '2025-09-30', null, 200336200000]]);
  for (const c of own) {
    const [y, m, d] = c.period.split('-');
    assert.ok(c.reason.includes(`${d}.${m}.${y}`), c.caseId);
    assert.match(c.reason, /Geprüft am 07\.11\.2026\.$/);
    assert.doesNotMatch(c.reason, /[–—]| - |kauf|verkauf/i);
    if (c.replacementValue !== null) assert.ok(c.sources.some(s => s.value === c.replacementValue && s.end === c.period && s.start && s.filed), c.caseId);
  }
  const g = own[0].sources;
  assert.equal(g[1].value - g[2].value, own[0].replacementValue, 'nine months minus the half year is the printed quarter');
  for (const bad of [c => { c.expectedBadValue = 1; }, c => { c.field = 'opIncQ'; }, c => { delete c.vendorGap; }]) {
    const t = structuredClone(H.table); bad(t.cases.find(c => c.caseId === own[0].caseId));
    assert.throws(() => H.validateTable(t), /Invalid/);
  }
});

test('expectations from the run of 13.11.2026: the September pairs, bound to the issuer name', () => {
  const own = require('../data-health/erwartungen.json').filter(e => e.id.startsWith('sdhand4b-'));
  const names = Object.fromEntries(ROWS.map(([t]) => [t, F[t].meta.name]));
  for (const [t, [, , before], after] of ROWS) {
    const e = own.find(x => x.name === names[t] && x.feld === 'revGrowthYoYPct');
    assert.ok(e, t);
    assert.equal(e.gueltigAb, '2026-11-13');
    assert.ok(e.min < after && after < e.max && !(e.min < before && before < e.max), t);
  }
  assert.equal(own.length, 3);
});

test('Codex R2 on #116 (12.11.2026): stored fills, duplicate dates and short statement periods fail closed', () => {
  // P1: a fill stored by the earlier code on a cell of another context is withheld on the next pass, with a reason and an event.
  for (const t of ['601211.SS', '360ONE.NS']) {
    const c = active.cases.find(x => x.vendorGap && x.ticker === t), base = pkt(t), i = base.timeseries.revenueQEnds.indexOf('2025-09-30');
    const fill = c.replacementValue * base.meta.fxRateApplied;
    for (const odd of [{ currency: 'EUR' }, { currencyUnit: 'EUR' }, { unit: 'shares' }, { multiplier: 1000 }, { periodType: '6M' }, { source: 'sec' }]) {
      const p = pkt(t), origin = { value: null, ...odd };
      p.timeseries.revenueQ[i] = { ...origin, value: fill, financialCorrection: { caseId: c.caseId, originalVendorRow: origin,
        originalNativeValue: null, replacementNativeValue: c.replacementValue, nativeCurrency: c.currency, reason: c.reason, sources: c.sources, revision: c.revision } };
      const r = H.applyFinancialCases(p, { table: active }), o = r.snapshot.timeseries.revenueQ[i];
      assert.deepEqual([value(o), o.financialMissing?.reasonCode], [null, 'context-changed'], t + ' ' + JSON.stringify(odd));
      assert.ok(r.events.some(e => e.caseId === c.caseId && e.reasonCode === 'context-changed'), t + ' event ' + JSON.stringify(odd));
    }
    const ok = apply(pkt(t));
    assert.equal(value(ok.timeseries.revenueQ[i]), fill, t + ': a correct packet keeps its fill');
    assert.deepEqual(apply(structuredClone(ok)), ok, t + ': and stays idempotent');
  }
  // P3: two cells on the same comparison date are both withheld, never one kept.
  const dup = pkt('601211.SS'); dup.timeseries.revenueQEnds[5] = '2025-09-30';
  assert.deepEqual(apply(dup).timeseries.revenueQ.slice(4).map(r => [value(r), r?.financialMissing?.reasonCode]), [[null, 'context-changed'], [null, 'context-changed']]);
  // P2: statement periods shorter than the series or on other ends anywhere: no insert, logged; never a padded or invented duration.
  for (const cut of [3, 4]) {
    const p = pkt('CHENNPETRO.NS'); p.meta.statementPeriods.revenueQ = p.meta.statementPeriods.revenueQ.slice(0, cut);
    const r = H.applyFinancialCases(p, { table: active });
    assert.ok(!r.snapshot.timeseries.revenueQEnds.includes('2025-09-30'), 'cut ' + cut);
    assert.deepEqual(r.snapshot.meta.statementPeriods.revenueQ, p.meta.statementPeriods.revenueQ, 'cut ' + cut + ': periods untouched');
    assert.ok(r.events.some(e => e.reasonCode === 'vendor-gap-unfilled' && e.period === '2025-09-30'), 'cut ' + cut + ': logged');
  }
  const far = pkt('CHENNPETRO.NS'); far.meta.statementPeriods.revenueQ[0] = { ...far.meta.statementPeriods.revenueQ[0], end: '2026-08-31' };
  assert.ok(!apply(far).timeseries.revenueQEnds.includes('2025-09-30'), 'an end away from the insert position also stops it');
  // A stored half year on the newest quarter of a full list is still seen against the inserted 3M quarter.
  const half = pkt('CHENNPETRO.NS'); half.meta.statementPeriods.revenueQ[0] = { ...half.meta.statementPeriods.revenueQ[0], duration: '6M' };
  const hs = apply(half);
  assert.equal(hs.meta.statementPeriods.revenueQ.length, hs.timeseries.revenueQ.length);
  assert.notEqual(g31Shadow(hs).v1.periodEnd, '2026-09-30');
});

test('Codex R3 on #116 (12.11.2026): a stored fill is re-checked (stored cell, statement periods, public date) before it is kept', () => {
  const odds = [{ currency: 'EUR' }, { currencyUnit: 'EUR' }, { unit: 'shares' }, { multiplier: 1000 }, { periodType: '6M' }, { source: 'sec' }];
  // 1: a correct fill whose stored cell later carries another context is withheld, with an event.
  for (const t of ['601211.SS', '360ONE.NS']) {
    const s = apply(pkt(t)), i = s.timeseries.revenueQEnds.indexOf('2025-09-30');
    for (const odd of odds) {
      const p = structuredClone(s); Object.assign(p.timeseries.revenueQ[i], odd);
      const r = H.applyFinancialCases(p, { table: active }), o = r.snapshot.timeseries.revenueQ[i];
      assert.deepEqual([value(o), o.financialMissing?.reasonCode], [null, 'context-changed'], t + ' ' + JSON.stringify(odd));
      assert.ok(r.events.some(e => e.period === '2025-09-30' && e.reasonCode === 'context-changed'), t + ' event ' + JSON.stringify(odd));
    }
  }
  // 2: Chennai stored by the earlier code with a short revenue period list (cut to 3, or cut to 4 and extended to 5) and a 6M
  // on the newest quarter: the stored inserted quarter is held, so the half year is never paired with it.
  const full = apply(pkt('CHENNPETRO.NS')), k = full.timeseries.revenueQEnds.indexOf('2025-09-30');
  for (const keep of [[0, 1, 2], [0, 1, 2, 3, 4]]) {
    const p = structuredClone(full); p.meta.statementPeriods.revenueQ = keep.map(x => ({ ...full.meta.statementPeriods.revenueQ[x] }));
    p.meta.statementPeriods.revenueQ[0].duration = '6M';
    const r = H.applyFinancialCases(p, { table: active });
    assert.deepEqual([value(r.snapshot.timeseries.revenueQ[k]), r.snapshot.timeseries.revenueQ[k]?.financialMissing?.reasonCode], [null, 'context-changed'], 'periods ' + keep.length);
    assert.ok(r.events.some(e => e.period === '2025-09-30' && e.reasonCode === 'context-changed'), 'periods ' + keep.length + ': event');
    assert.notEqual(g31Shadow(r.snapshot).v1.periodEnd, '2026-09-30', 'periods ' + keep.length);
  }
  // 3: a stored fill whose source is now dated after the fetch day is withheld, with a reason; the correct table keeps it.
  const later = structuredClone(active);
  for (const c of later.cases.filter(c => c.vendorGap)) c.sources = c.sources.map(x => ({ ...x, ...(x.filed ? { filed: '2026-11-30' } : { published: '2026-11-30' }) }));
  for (const t of ['601211.SS', '360ONE.NS', 'CHENNPETRO.NS']) {
    const s = apply(pkt(t)), i = s.timeseries.revenueQEnds.indexOf('2025-09-30');
    const r = H.applyFinancialCases(structuredClone(s), { table: later }), o = r.snapshot.timeseries.revenueQ[i];
    assert.deepEqual([value(o), o?.financialMissing?.reasonCode], [null, 'not-public-at-fetch'], t);
    assert.equal(o.financialMissing.reason, H.MISSING_REASONS['not-public-at-fetch'], t);
    assert.ok(r.events.some(e => e.period === '2025-09-30' && e.reasonCode === 'not-public-at-fetch'), t + ': event');
    const back = H.applyFinancialCases(structuredClone(r.snapshot), { table: active }).snapshot;
    assert.ok(value(back.timeseries.revenueQ[i]) > 0, t + ': refilled once the date is admissible again');
  }
});

test('Codex R4 on #116 (12.11.2026): every stored-fill check holds on the second pass too', () => {
  const odds = [{ currency: 'EUR' }, { currencyUnit: 'EUR' }, { unit: 'shares' }, { multiplier: 1000 }, { periodType: '6M' }, { source: 'sec' }];
  const twice = (p, table = active) => { const a = H.applyFinancialCases(p, { table }); return [a, H.applyFinancialCases(structuredClone(a.snapshot), { table })]; };
  const held = (r, i, code, msg) => {
    const o = r.snapshot.timeseries.revenueQ[i];
    assert.deepEqual([value(o), o?.financialMissing?.reasonCode], [null, code], msg);
    assert.ok(r.events.some(e => e.period === '2025-09-30' && e.reasonCode === code), msg + ': event');
  };
  for (const t of ['601211.SS', '360ONE.NS', 'CHENNPETRO.NS']) {
    const s = apply(pkt(t)), i = s.timeseries.revenueQEnds.indexOf('2025-09-30'), c = active.cases.find(x => x.vendorGap && x.ticker === t);
    // B1: the contradicting tag sits on the stored fill (outer level) or on an older own fill under it (middle level).
    for (const odd of odds) {
      const outer = structuredClone(s); Object.assign(outer.timeseries.revenueQ[i], odd);
      twice(outer).forEach((r, n) => held(r, i, 'context-changed', `${t} outer ${JSON.stringify(odd)} pass ${n + 1}`));
      const nested = structuredClone(s), top = nested.timeseries.revenueQ[i];
      nested.timeseries.revenueQ[i] = { ...top, financialCorrection: { ...top.financialCorrection, originalVendorRow: { ...structuredClone(top), ...odd } } };
      twice(nested).forEach((r, n) => held(r, i, 'context-changed', `${t} middle ${JSON.stringify(odd)} pass ${n + 1}`));
    }
    // A correct packet stays filled and identical on every pass.
    const [r1, r2] = twice(pkt(t));
    assert.deepEqual(r2.snapshot, r1.snapshot, t + ': stable');
    assert.ok(value(r2.snapshot.timeseries.revenueQ[i]) > 0, t);
    // The R3 date hold stays a hold on the second pass.
    const later = structuredClone(active), lc = later.cases.find(x => x.caseId === c.caseId);
    lc.sources = lc.sources.map(x => ({ ...x, ...(x.filed ? { filed: '2026-11-30' } : { published: '2026-11-30' }) }));
    twice(structuredClone(s), later).forEach((r, n) => held(r, i, 'not-public-at-fetch', `${t} date pass ${n + 1}`));
  }
  // R3 short period list on a stored Chennai insert: held on both passes.
  const full = apply(pkt('CHENNPETRO.NS')), k = full.timeseries.revenueQEnds.indexOf('2025-09-30');
  const short = structuredClone(full); short.meta.statementPeriods.revenueQ = full.meta.statementPeriods.revenueQ.slice(0, 3).map(x => ({ ...x }));
  short.meta.statementPeriods.revenueQ[0].duration = '6M';
  twice(short).forEach((r, n) => held(r, k, 'context-changed', 'short periods pass ' + n));
  // B2: a net-income series with its own ends is checked against its own ends; the September comparison holds on both passes.
  const own = pkt('CHENNPETRO.NS'); own.timeseries.netIncomeQEnds = own.timeseries.revenueQEnds.slice();
  twice(own).forEach((r, n) => {
    const v = g31Shadow(r.snapshot).v1;
    assert.deepEqual([v.periodEnd, v.priorPeriodEnd], ['2026-09-30', '2025-09-30'], 'own net-income ends pass ' + (n + 1));
    assert.ok(Math.abs(v.pct - pct(22055.45, 20033.62)) < 1e-9, 'own net-income ends pass ' + (n + 1));
  });
});

test('Codex R5 on #116 (12.11.2026): two conflicts in one chain survive the pull, the USD conversion and two reads', () => {
  const Q = require('../lib/yahoo-q4-known-cases.js'), P = require('../pull-yahoo.js');
  // The stored packet in the reporting currency, as the pull sees it before the conversion (Codex review-r5-native-path).
  const native = raw => {
    const s = structuredClone(raw), rate = s.meta.fxRateApplied;
    for (const k of ['revenueQ', 'grossProfitQ', 'opIncQ', 'netIncomeQ']) if (Array.isArray(s.timeseries[k])) s.timeseries[k] = s.timeseries[k].map(r => typeof r === 'number' ? r / rate : r && typeof r.value === 'number' ? { ...r, value: r.value / rate } : r);
    for (const k of ['annualRev', 'annualGP', 'annualOpInc', 'annualNetIncome']) if (Array.isArray(s.annual?.[k])) s.annual[k] = s.annual[k].map(r => typeof r === 'number' ? r / rate : r && typeof r.value === 'number' ? { ...r, value: r.value / rate } : r);
    s.meta.reportingCurrency = s.meta.reportingCurrencyOriginal; s.meta.fxConverted = false;
    for (const k of ['reportingCurrencyOriginal', 'fxRateApplied', 'fxConversionFailed']) delete s.meta[k];
    return s;
  };
  const cell = s => s.timeseries.revenueQ[s.timeseries.revenueQEnds.indexOf('2025-09-30')];
  for (const t of ['601211.SS', '360ONE.NS', 'CHENNPETRO.NS']) {
    for (const bad of [{ source: 'sec' }, { unit: 'shares' }, { multiplier: 1000 }, { periodType: '6M' }]) {
      const s = H.applyFinancialCases(native(F[t])).snapshot, i = s.timeseries.revenueQEnds.indexOf('2025-09-30');
      const top = structuredClone(cell(s)), middle = { ...structuredClone(top), ...bad };
      top.currency = 'USD'; top.financialCorrection.originalVendorRow = middle; s.timeseries.revenueQ[i] = top;
      assert.equal(value(cell(Q.prepareSnapshot(structuredClone(s), { atPull: true }))), null, t + ' pull');
      const disk = structuredClone(s); P._convertSnapshotToUSD(disk);
      const read = Q.prepareSnapshot(structuredClone(disk)), again = Q.prepareSnapshot(structuredClone(read));
      assert.deepEqual([value(cell(read)), value(cell(again))], [null, null], `${t} ${JSON.stringify(bad)}: the inner conflict stays held after the conversion`);
      assert.deepEqual(again, read, t + ': stable');
    }
    // A tag only on the outer own hold (blind review of the R5 fix): kept on every pass.
    const c = active.cases.find(x => x.vendorGap && x.ticker === t), f = apply(pkt(t)), k = f.timeseries.revenueQEnds.indexOf('2025-09-30');
    for (const odd of [{ currency: 'EUR' }, { source: 'sec' }, { periodType: '6M' }]) {
      let h = structuredClone(f);
      h.timeseries.revenueQ[k] = { ...odd, value: null, financialMissing: { reasonCode: 'context-changed', caseId: c.caseId, originalVendorRow: structuredClone(f.timeseries.revenueQ[k]) } };
      for (let n = 1; n <= 3; n++) {
        h = apply(structuredClone(h));
        assert.deepEqual([value(h.timeseries.revenueQ[k]), h.timeseries.revenueQ[k].financialMissing?.reasonCode], [null, 'context-changed'], `${t} outer hold ${JSON.stringify(odd)} pass ${n}`);
      }
    }
    // Positive control: only the now valid USD tag on the stored fill, so after the conversion the fill is released again.
    const ok = H.applyFinancialCases(native(F[t])).snapshot; cell(ok).currency = 'USD'; P._convertSnapshotToUSD(ok);
    assert.ok(value(cell(Q.prepareSnapshot(ok))) > 0, t + ': a resolved conflict releases the cell');
  }
});

test('the live files are unchanged by this test', () => {
  assert.deepEqual(liveHashes(), beforeHashes);
});
