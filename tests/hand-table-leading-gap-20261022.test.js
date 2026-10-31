'use strict';
// Leading gap (22.10.2026): since the pull of 14.10.2026 the vendor returns the PLUS quarter ending 2026-06-30 as an
// empty row (the pull trims it), so the series ends at 2026-03-31. The hand table holds source-checked cases for exactly
// that quarter (10-Q of 2026-08-04: revenue 649,113, gross profit 151,329, operating income 38,832 TUSD), but a case
// only acted on an existing cell, so the board fell back to the fiscal year to 31.03.2026 (22.1 % instead of 1.0 %).
// In a covered series a source-backed case newer than the vendor's newest dated end now fills that quarter (G2).
// Real frozen packet of the daily run 39741351636 (tests/fixtures/hand-table-leading-gap-plus.json). Every probe works
// on copies; live files are hashed before and after.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { applyFinancialCases, financialReasons, table } = require('../lib/financial-known-cases.js');
const { g31Shadow } = require('../lib/g31-recency.js');
const { diffCells } = require('../scripts/financial-corrections-replay.js');
const { latestReportedQuarter, planReload } = require('../lib/stale-quarter-reload.js');
const { quarterOpMargins } = require('../src/scoring/axes.js');
const { newestQtrSuspect } = require('../src/scoring/lamps.js');
const stored = require('./fixtures/hand-table-leading-gap-plus.json').snapshots.PLUS;
const root = path.resolve(__dirname, '..');
const value = row => typeof row === 'number' ? row : row?.value ?? null;
const live = ['configs/financial-known-cases.json', 'lib/financial-known-cases.js', 'tests/fixtures/hand-table-leading-gap-plus.json'];
const liveHashes = () => live.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'));
const beforeHashes = liveHashes();
const apply = s => applyFinancialCases(structuredClone(s)).snapshot;
// The raw vendor packet as the pull sees it: every hand-table marker unwrapped to its original vendor row.
const raw = (() => {
  const s = structuredClone(stored);
  for (const f of ['revenueQ', 'grossProfitQ', 'opIncQ']) s.timeseries[f] = s.timeseries[f].map(r =>
    r?.financialCorrection ? r.financialCorrection.originalVendorRow : r?.financialMissing ? r.financialMissing.originalVendorRow : r);
  return s;
})();

const june = { revenueQ: 649113000, grossProfitQ: 151329000, opIncQ: 38832000 };

test('fixture: the vendor series ends at 2026-03-31 although the table verified 2026-06-30', () => {
  for (const f of Object.keys(june)) {
    assert.equal(stored.timeseries[f + 'Ends'][0], '2026-03-31');
    assert.ok(table.cases.some(c => c.ticker === 'PLUS' && c.field === f && c.period === '2026-06-30' && c.replacementValue === june[f]));
    assert.equal(table.coverage.find(v => v.ticker === 'PLUS' && v.field === f).coversThrough, '2026-06-30');
  }
});

for (const [name, input] of [['stored packet (read time)', stored], ['raw packet (pull time)', raw]]) {
  test(`guard: the verified June quarter is shown, never the fiscal year (${name})`, () => {
    const s = apply(input);
    for (const f of Object.keys(june)) {
      assert.equal(s.timeseries[f + 'Ends'][0], '2026-06-30', f);
      assert.equal(value(s.timeseries[f][0]), june[f], f);
      assert.equal(s.timeseries[f][0].financialCorrection.caseId, `plus-2026-06-30-${f}`);
      assert.equal(s.timeseries[f][0].financialCorrection.originalVendorRow, null);
      assert.equal(s.timeseries[f].length, s.timeseries[f + 'Ends'].length);
      // The older cells keep their verified values and positions behind the filled quarter.
      assert.deepEqual(s.timeseries[f + 'Ends'].slice(1), stored.timeseries[f + 'Ends']);
    }
    // netIncomeQ has no own ends and is read against revenueQEnds: it gets an empty cell, its values do not move.
    assert.deepEqual(s.timeseries.netIncomeQ.map(value), [null, ...stored.timeseries.netIncomeQ.map(value)]);
    assert.equal(s.meta.statementPeriods.revenueQ.length, s.timeseries.revenueQ.length);
    assert.equal(s.meta.statementPeriods.revenueQ[0].end, '2026-06-30');
    assert.equal(s.meta.statementPeriods.netIncomeQ.length, s.timeseries.netIncomeQ.length);
    const leg = g31Shadow(s).v1;
    assert.equal(leg.basis, 'quarter');
    assert.equal(leg.periodEnd, '2026-06-30');
    assert.equal(leg.priorPeriodEnd, '2025-06-30');
    assert.equal(Math.round(leg.pct * 100) / 100, 0.99); // 649,113 / 642,775
    assert.ok(financialReasons(s).some(r => /Anbieter liefert dieses Quartal nicht mehr/.test(r)));
    // A second pass (read time over a persisted fill) changes nothing.
    assert.deepEqual(apply(s).timeseries, s.timeseries);
  });
}

// Export of 23.10.2026: the PLUS row showed the verified June quarter (+0.99 %) next to "Quartalswert fehlt: Periode nicht
// gegen Primärquelle geprüft", which was about the withheld quarter to 31.03.2025. A missing text names its period.
test('a withheld older quarter never reads as the shown one: its hint names its period', () => {
  for (const input of [stored, raw]) {
    const s = apply(input), reasons = financialReasons(s);
    assert.equal(s.timeseries.revenueQ[0].financialMissing, undefined);
    const missing = reasons.filter(r => r.startsWith('Quartalswert fehlt'));
    assert.deepEqual(missing, ['Quartalswert fehlt: Periode nicht gegen Primärquelle geprüft; die Anbieterreihe dieser Firma ' +
      'hat eine falsche Basis. Das betrifft die Periode mit Ende 31.03.2025.']);
  }
});

// Currency path of the fill: a non-USD case converts with the stored rate and still waits for its filing day.
test('fill in a converted reporting currency uses the stored rate and the point-in-time rule', () => {
  const rate = 1.25, eur = structuredClone(table);
  for (const c of eur.cases) if (c.ticker === 'PLUS') c.currency = 'EUR';
  const s = structuredClone(raw);
  Object.assign(s.meta, { reportingCurrencyOriginal: 'EUR', fxRateApplied: rate });
  for (const f of Object.keys(june)) s.timeseries[f] = s.timeseries[f].map((r, i) => {
    const c = eur.cases.find(c => c.ticker === 'PLUS' && c.field === f && c.period === s.timeseries[f + 'Ends'][i]);
    return c ? { value: c.expectedBadValue * rate } : r;
  });
  const out = applyFinancialCases(structuredClone(s), { table: eur }).snapshot;
  for (const f of Object.keys(june)) {
    assert.equal(out.timeseries[f + 'Ends'][0], '2026-06-30', f);
    assert.equal(value(out.timeseries[f][0]), june[f] * rate, f);
    assert.equal(out.timeseries[f][0].financialCorrection.nativeCurrency, 'EUR');
  }
  s.meta.fetchedAt = '2026-08-04T12:00:00Z'; // filing day of the 10-Q: not public yet at fetch time
  assert.equal(applyFinancialCases(s, { table: eur }).snapshot.timeseries.revenueQEnds[0], '2026-03-31');
});

test('no fill when the vendor delivers the quarter itself or a newer one', () => {
  const back = structuredClone(raw);
  const ts = back.timeseries;
  for (const f of Object.keys(june)) { ts[f] = [{ value: june[f] }, ...ts[f]]; ts[f + 'Ends'] = ['2026-06-30', ...ts[f + 'Ends']]; }
  ts.netIncomeQ = [{ value: 37000000 }, ...ts.netIncomeQ];
  back.meta.statementPeriods.revenueQ = [{ ...back.meta.statementPeriods.revenueQ[0], end: '2026-06-30' }, ...back.meta.statementPeriods.revenueQ];
  const s = apply(back);
  for (const f of Object.keys(june)) assert.deepEqual(s.timeseries[f + 'Ends'], back.timeseries[f + 'Ends'], f);
  assert.equal(value(s.timeseries.revenueQ[0]), june.revenueQ);
  // A newer vendor quarter (after coverage) is withheld as before; the June case is then interior and not inserted.
  const newer = structuredClone(raw);
  newer.timeseries.revenueQ = [{ value: 700000000 }, ...newer.timeseries.revenueQ];
  newer.timeseries.revenueQEnds = ['2026-09-30', ...newer.timeseries.revenueQEnds];
  newer.timeseries.netIncomeQ = [{ value: 1 }, ...newer.timeseries.netIncomeQ];
  const n = apply(newer);
  assert.deepEqual(n.timeseries.revenueQEnds, newer.timeseries.revenueQEnds);
  assert.equal(n.timeseries.revenueQ[0].financialMissing.reasonCode, 'period-after-coverage');
  // The same quarter on a shifted vendor end (within a week) is no gap: it is withheld as unverified, never doubled.
  const shifted = structuredClone(raw);
  shifted.timeseries.revenueQ = [{ value: june.revenueQ }, ...shifted.timeseries.revenueQ];
  shifted.timeseries.revenueQEnds = ['2026-06-27', ...shifted.timeseries.revenueQEnds];
  shifted.timeseries.netIncomeQ = [{ value: 1 }, ...shifted.timeseries.netIncomeQ];
  const sh = apply(shifted);
  assert.deepEqual(sh.timeseries.revenueQEnds, shifted.timeseries.revenueQEnds);
  assert.equal(sh.timeseries.revenueQ[0].financialMissing.reasonCode, 'period-not-verified');
});

// Review of PR #22 (22.10.2026): the pull often keeps one older, empty netIncomeQ cell more than revenueQ (FSK: 6 vs 5,
// trailing null). netIncomeQ is read by position from index 0 against revenueQEnds, so it must shift at any length, and
// its statement periods with it; before this fix the March value sat under the June end.
const longer = input => {
  const s = structuredClone(input);
  s.timeseries.netIncomeQ.push(null);
  s.meta.statementPeriods.netIncomeQ.push(null);
  return s;
};
for (const [name, input] of [['stored', stored], ['raw', raw], ['stored, netIncomeQ one longer', longer(stored)],
  ['raw, netIncomeQ one longer', longer(raw)]]) {
  test(`netIncomeQ, statement periods and event indices stay aligned after the fill (${name})`, () => {
    const logged = [], before = structuredClone(input);
    const { snapshot: s, events } = applyFinancialCases(structuredClone(input), { onEvent: e => logged.push(e) });
    const ts = s.timeseries, ends = ts.revenueQEnds;
    assert.equal(ends[0], '2026-06-30');
    assert.equal(ts.netIncomeQ.length, input.timeseries.netIncomeQ.length + 1);
    assert.deepEqual(ts.netIncomeQ.map(value), [null, ...input.timeseries.netIncomeQ.map(value)]);
    // Every stored netIncomeQ value still sits under its own quarter end.
    input.timeseries.netIncomeQ.forEach((row, i) => { if (value(row) != null) assert.equal(ends[i + 1], input.timeseries.revenueQEnds[i]); });
    for (const f of ['revenueQ', 'netIncomeQ']) {
      const periods = s.meta.statementPeriods[f];
      assert.equal(periods.length, input.meta.statementPeriods[f].length + 1, f);
      periods.forEach((p, i) => { if (p) assert.equal(p.end, ends[i], `${f} ${i}`); });
    }
    // Events name output positions: the fill, the corrected March cell and the withheld coverage cell alike.
    for (const e of events.filter(e => e.container === 'timeseries' && Number.isInteger(e.index))) {
      assert.equal(ts[e.field + 'Ends'][e.index], e.period, e.caseId);
    }
    assert.deepEqual(logged, events);
    // The replay's byte check (scripts/financial-corrections-replay.js) passes: only the named cells changed.
    const changes = diffCells(before, s, events);
    const filled = changes.filter(c => c.reasonCode === 'vendor-gap-filled');
    assert.deepEqual(filled.map(c => [c.field, c.oldRow, value(c.newRow)]),
      Object.entries(june).map(([f, v]) => [f, null, v]));
  });
}

test('replay byte check stays strict on a filled series', () => {
  const { snapshot: s, events } = applyFinancialCases(structuredClone(raw));
  // The pre-fix shape (netIncomeQ not shifted) is an unrelated byte change and must still throw.
  const unshifted = structuredClone(s);
  unshifted.timeseries.netIncomeQ = unshifted.timeseries.netIncomeQ.slice(1);
  assert.throws(() => diffCells(raw, unshifted, events), /all unrelated bytes must match/);
  // A fill event whose cell is not at its period end throws instead of passing silently.
  const moved = structuredClone(s);
  moved.timeseries.revenueQEnds[0] = '2026-07-31';
  assert.throws(() => diffCells(raw, moved, events), /inserted cell plus-2026-06-30-revenueQ not found/);
});

// Review of PR #22, third point: the stale-quarter reload plans from latestReportedQuarter (hand tables applied) but
// compares the reload bundle without them (pull-yahoo.js, "older than stored"). Counting the fill there would hide
// PLUS from the reload until 28.10. and then reject each reload as older than stored; the fill is no vendor delivery.
test('the stale-quarter reload still sees the vendor newest quarter, not the fill', () => {
  const now = Date.parse('2026-10-22T12:00:00Z');
  for (const input of [stored, raw, apply(stored), apply(raw)]) {
    assert.equal(latestReportedQuarter(structuredClone(input), now), '2026-03-31');
  }
  // The real planner keeps PLUS a reload candidate (March is 205 days old, limit 120). With the fill counted as delivered
  // (June, 114 days) it would not be one. Fundamentals fetched 8 days earlier, past the 7-day retry window.
  const filled = apply(raw);
  filled.meta.fundamentalsTimeseriesFetchedAt = '2026-10-14T08:00:00.000Z';
  const io = { existsSync: () => true, readFileSync: () => JSON.stringify(filled) };
  const plan = planReload([{ ticker: 'PLUS' }], { snapshotDir: 'mem', cacheDir: null, now, io,
    config: require('../configs/stale-quarter-reload.json') });
  assert.deepEqual(plan.candidates.map(c => [c.ticker, c.end, c.basis]), [['PLUS', '2026-03-31', 'quarter']]);
});

// Hand-table variants on copies of the real table (applyFinancialCases validates them again).
const tableWith = edit => { const t = structuredClone(table); edit(t); return t; };
const revenueOnly = tableWith(t => {
  const other = x => x.ticker === 'PLUS' && x.field !== 'revenueQ';
  t.cases = t.cases.filter(c => !other(c));
  t.coverage = t.coverage.filter(v => !other(v));
});
const quarterly = ['revenueQ', 'grossProfitQ', 'opIncQ'];
const newestEnds = s => quarterly.map(f => s.timeseries[f + 'Ends'][0]);
const gapEvents = events => events.filter(e => /^vendor-gap/.test(e.reasonCode || ''));

// Review of PR #22, round 2 (P1): readers pair revenueQ, grossProfitQ and opIncQ by position (axes.js quarterOpMargins,
// lamps.js newestQtrSuspect). With revenue-only coverage (22 issuers, e.g. ARCC, 8020.T, 000688.SZ) a revenue fill
// alone put the June revenue over the March operating income (first margin 0.0476 instead of 0.0536). A series with
// values and no own case for the quarter now blocks the fill: every series stays on March, the quarter is logged.
test('no fill unless every quarterly series with values is filled for the same quarter', () => {
  for (const input of [stored, raw]) {
    const { snapshot: s, events } = applyFinancialCases(structuredClone(input), { table: revenueOnly });
    for (const f of quarterly) {
      assert.deepEqual(s.timeseries[f + 'Ends'], input.timeseries.revenueQEnds, f);
      assert.equal(s.timeseries[f].length, input.timeseries[f].length, f);
    }
    assert.deepEqual(s.timeseries.netIncomeQ.map(value), input.timeseries.netIncomeQ.map(value));
    // March revenue (576,174 TUSD) under March operating income, never the June revenue (649,113) over it.
    assert.equal(value(s.timeseries.revenueQ[0]), 576174000);
    assert.equal(quarterOpMargins(s)[0], value(s.timeseries.opIncQ[0]) / 576174000);
    assert.equal(newestQtrSuspect(s), newestQtrSuspect(input));
    assert.deepEqual(gapEvents(events).map(e => [e.caseId, e.status, e.reasonCode]),
      [['plus-2026-06-30-revenueQ', 'stale', 'vendor-gap-unfilled']]);
    assert.match(gapEvents(events)[0].reason, /Nicht jede Quartalsreihe/);
    diffCells(input, s, events);
  }
});

// A series without any value (BDC gross profit and operating income, e.g. ARCC or FSK on 22.10.) cannot be paired
// wrongly; it gets an empty cell for the filled quarter, so every series ends on June.
test('empty sibling series get an empty cell and stay aligned with the fill', () => {
  for (const input of [stored, raw]) {
    const bdc = structuredClone(input);
    for (const f of ['grossProfitQ', 'opIncQ']) bdc.timeseries[f] = bdc.timeseries[f].map(() => null);
    const { snapshot: s, events } = applyFinancialCases(structuredClone(bdc), { table: revenueOnly });
    assert.equal(value(s.timeseries.revenueQ[0]), june.revenueQ);
    for (const f of ['grossProfitQ', 'opIncQ']) {
      assert.deepEqual(s.timeseries[f + 'Ends'], s.timeseries.revenueQEnds, f);
      assert.deepEqual(s.timeseries[f], [null, ...bdc.timeseries[f]], f);
      assert.equal(s.meta.statementPeriods[f][0].end, '2026-06-30', f);
    }
    assert.deepEqual(gapEvents(events).map(e => [e.field, e.reasonCode, e.index]), [['revenueQ', 'vendor-gap-filled', 0],
      ['grossProfitQ', 'vendor-gap-aligned', 0], ['opIncQ', 'vendor-gap-aligned', 0]]);
    assert.deepEqual(quarterOpMargins(s), []);
    assert.equal(newestQtrSuspect(s), null);
    // The replay's byte check cuts the aligned cells too and throws when one is missing; a second pass changes nothing.
    assert.equal(diffCells(bdc, s, events).filter(x => /^vendor-gap/.test(x.reasonCode)).length, 3);
    const lost = structuredClone(s);
    lost.timeseries.opIncQ.shift(); lost.timeseries.opIncQEnds.shift();
    assert.throws(() => diffCells(bdc, lost, events), /not found by period end in opIncQ/);
    assert.deepEqual(applyFinancialCases(structuredClone(s), { table: revenueOnly }).snapshot.timeseries, s.timeseries);
  }
});

// Review of PR #22, round 2 (P2, G6/G7): a replay or back-test of an older snapshot must not see a quarter that was not
// public yet. The June 10-Q was filed on 04.08.2026: a snapshot fetched that day gets no fill, one fetched the next day
// does. The latest source date counts (a difference of two filings is known from the later one), and a case without a
// source date, or a packet without a fetch time, never fills.
test('point in time: a fill needs a source published before the fetch day', () => {
  const at = fetchedAt => { const s = structuredClone(raw); s.meta.fetchedAt = fetchedAt; return s; };
  const filingDay = applyFinancialCases(at('2026-08-04T21:00:00Z'));
  assert.deepEqual(newestEnds(filingDay.snapshot), Array(3).fill('2026-03-31'));
  assert.deepEqual(gapEvents(filingDay.events), []);
  assert.deepEqual(newestEnds(apply(at('2026-08-05T06:00:00Z'))), Array(3).fill('2026-06-30'));
  const unclocked = applyFinancialCases(at(undefined));
  assert.deepEqual(newestEnds(unclocked.snapshot), Array(3).fill('2026-03-31'));
  assert.deepEqual(gapEvents(unclocked.events).map(e => /Veröffentlichungsdatum/.test(e.reason)), [true, true, true]);
  const june = t => t.cases.find(c => c.caseId === 'plus-2026-06-30-revenueQ');
  const later = tableWith(t => june(t).sources.push({ ...june(t).sources[0], filed: '2026-10-22' }));
  const undated = tableWith(t => { delete june(t).sources[0].filed; });
  for (const [tbl, first] of [[later, 'Nicht jede Quartalsreihe'], [undated, 'Veröffentlichungsdatum']]) {
    const { snapshot: s, events } = applyFinancialCases(structuredClone(raw), { table: tbl });
    assert.deepEqual(newestEnds(s), Array(3).fill('2026-03-31'));
    const logged = gapEvents(events);
    assert.ok(logged.every(e => e.status === 'stale' && e.reasonCode === 'vendor-gap-unfilled'));
    assert.deepEqual(logged.map(e => e.caseId).sort(), (tbl === later ? [] : ['plus-2026-06-30-revenueQ'])
      .concat(['plus-2026-06-30-grossProfitQ', 'plus-2026-06-30-opIncQ']).sort());
    assert.ok(logged.some(e => e.reason.includes(first)));
  }
});

// Two missing quarters fill together; a quarter skipped in between blocks the fill (positions would jump a quarter).
test('two missing quarters fill together, a hole blocks the fill', () => {
  const drop = structuredClone(raw), ts = drop.timeseries;
  for (const f of quarterly) { ts[f] = ts[f].slice(1); ts[f + 'Ends'] = ts[f + 'Ends'].slice(1); }
  ts.netIncomeQ = ts.netIncomeQ.slice(1);
  for (const f of [...quarterly, 'netIncomeQ']) drop.meta.statementPeriods[f] = drop.meta.statementPeriods[f].slice(1);
  const { snapshot: s, events } = applyFinancialCases(structuredClone(drop));
  for (const f of quarterly) assert.deepEqual(s.timeseries[f + 'Ends'], ['2026-06-30', '2026-03-31', ...ts[f + 'Ends']], f);
  assert.deepEqual(s.timeseries.netIncomeQ.map(value), [null, null, ...ts.netIncomeQ.map(value)]);
  assert.equal(diffCells(drop, s, events).filter(c => c.reasonCode === 'vendor-gap-filled').length, 6);
  const noMarch = tableWith(t => { t.cases = t.cases.filter(c => !(c.ticker === 'PLUS' && c.period === '2026-03-31')); });
  const h = applyFinancialCases(structuredClone(drop), { table: noMarch });
  assert.deepEqual(newestEnds(h.snapshot), Array(3).fill('2025-12-31'));
  assert.deepEqual(gapEvents(h.events).map(e => e.reason.includes('fehlt ein Quartal')), [true, true, true]);
});

test('live files unchanged', () => assert.deepEqual(liveHashes(), beforeHashes));
