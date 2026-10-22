'use strict';
// Hand table 18.10.2026: four board numbers of the 17.10. export that the issuers' own reports contradict.
// Real frozen packets from tests/fixtures/financial-known-cases.json: BLSH, CDR.WA, OTGLF and 000552.SZ from
// the 17.10. run; VCTR from the 30.09. run (same gross-profit values, undated year ends) plus its 17.10. form
// with dated year ends. Every red probe changes an in-memory table copy only; live files are hashed before and after.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { applyFinancialCases, financialReasons, validateTable, table } = require('../lib/financial-known-cases.js');
const { revQuartalsYoY, revGrowthLevel, gpGrowth, revAcceleration, marginTrajectory } = require('../src/scoring/axes.js');
const { overviewMetric } = require('../src/scoring/overview.js');
const { withG31Variant } = require('../lib/g31-recency.js');
const { handTableDerivation } = require('../lib/export-provenance.js');
const shared = require('./fixtures/financial-known-cases.json').snapshots;
const fixtures = { BLSH: shared.BLSH, VCTR: shared.VCTR, 'CDR.WA': shared['CDR.WA'], OTGLF: shared.OTGLF, '000552.SZ': shared['000552.SZ'] };
// 17.10. VCTR packet (run 39036704898): identical gross-profit values, but dated year ends.
const vctrDated = structuredClone(shared.VCTR);
vctrDated.annual.annualGPEnds = ['2025-12-31', '2024-12-31', '2023-12-31', '2022-12-31'];
const root = path.resolve(__dirname, '..');
const value = row => typeof row === 'number' ? row : row?.value ?? null;
const live = ['configs/financial-known-cases.json', 'lib/financial-known-cases.js', 'tests/fixtures/financial-known-cases.json'];
const liveHashes = () => live.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'));
const beforeHashes = liveHashes();
const REV = '2026-10-18-sdhand';
const DASHES = new RegExp('[' + String.fromCharCode(0x2010) + '-' + String.fromCharCode(0x2015) + String.fromCharCode(0x2212) + ']');

// [ticker, field, period, stored native vendor value, shown native value (null = withheld)], in table order.
const cells = [
  ['BLSH', 'annualGP', '2025-12-31', 74084000, null],
  ['VCTR', 'annualGP', '2025-12-31', 711149000, null],
  ['CDR.WA', 'revenueQ', '2026-06-30', 244201000, 244201000],
  ['CDR.WA', 'revenueQ', '2026-03-31', 191107000, 191107000],
  // Q4 2025 exists only as full year without GOG minus nine months with GOG: no reported number, withheld.
  ['CDR.WA', 'revenueQ', '2025-12-31', 74877000, null],
  ['CDR.WA', 'revenueQ', '2025-09-30', 349072000, 349072000],
  ['CDR.WA', 'revenueQ', '2025-06-30', 216734000, 174930000],
  ['000552.SZ', 'revenueQ', '2026-06-30', 2202292523, 2202292523],
  ['000552.SZ', 'revenueQ', '2026-03-31', 2495330187.99, 2495330187.99],
  ['000552.SZ', 'revenueQ', '2025-12-31', 1719171214.57, 1719171214.57],
  ['000552.SZ', 'revenueQ', '2025-06-30', 1802130524.26, 1817142765.65],
  ['000552.SZ', 'revenueQ', '2025-03-31', 1950615225.65, 1950615225.65],
  // Unadjusted Q2 2025 profit next to the adjusted Q2 2025 revenue: withheld, never mixed.
  ['000552.SZ', 'opIncQ', '2025-06-30', -212470245.56, null],
  ['000552.SZ', 'grossProfitQ', '2025-06-30', 205078196.16, null],
  // 2023 and older still contain GOG; 2024/2025 do not. Withholding 2023 also withholds 2022 (no-gap rule).
  ['CDR.WA', 'annualRev', '2023-12-31', 1230199000, null],
  ['CDR.WA', 'annualGP', '2023-12-31', 852241000, null],
  // Profit series on the same basis as the revenue series: Q2 2025 restated, Q4 2025 withheld, Q3 2025 as reported.
  ['CDR.WA', 'opIncQ', '2026-06-30', 148272000, 148272000],
  ['CDR.WA', 'opIncQ', '2026-03-31', 97067000, 97067000],
  ['CDR.WA', 'opIncQ', '2025-12-31', 107973000, null],
  ['CDR.WA', 'opIncQ', '2025-09-30', 194630000, 194630000],
  ['CDR.WA', 'opIncQ', '2025-06-30', 72468000, 72195000],
  ['CDR.WA', 'grossProfitQ', '2026-06-30', 228665000, 228665000],
  ['CDR.WA', 'grossProfitQ', '2026-03-31', 177253000, 177253000],
  ['CDR.WA', 'grossProfitQ', '2025-12-31', 149771000, null],
  ['CDR.WA', 'grossProfitQ', '2025-09-30', 294463000, 294463000],
  ['CDR.WA', 'grossProfitQ', '2025-06-30', 163939000, 150923000],
];
const idFor = ([ticker, field, period]) => `${ticker.toLowerCase()}-${period}-${field}-20261018`;
const container = field => field.startsWith('annual') ? 'annual' : 'timeseries';
const indexOf = (raw, box, field, period) => {
  const ends = raw[box][field + 'Ends'];
  return ends.some(Boolean) ? ends.indexOf(period) : 0; // undated vendor years: the case's index 0
};

/** Table copy without the given cases; coverage follows the remaining verified periods (as the validator demands). */
function without(drop) {
  const copy = structuredClone(table);
  copy.cases = copy.cases.filter(c => !drop(c));
  copy.coverage = copy.coverage.map(v => ({ ...v, coversThrough: copy.cases
    .filter(c => c.ticker === v.ticker && c.field === v.field).map(c => c.period).sort().at(-1) })).filter(v => v.coversThrough);
  return validateTable(copy);
}
const before = without(c => c.revision === REV); // the table as it was on origin/main before this change
// Guard: the cell is shown exactly as the issuer's report allows (or withheld), on every listing of the issuer.
function guard(cell, config, ticker = cell[0], raw = fixtures[ticker]) {
  const [, field, period, , shown] = cell, box = container(field), i = indexOf(raw, box, field, period);
  assert.ok(i >= 0, 'period present in the frozen packet');
  const result = applyFinancialCases(raw, config ? { table: config } : undefined).snapshot[box][field][i];
  assert.equal(value(result), shown === null ? null : shown * raw.meta.fxRateApplied, idFor(cell) + ' on ' + ticker);
  // A withheld cell inside a covered series would stay empty by the coverage rule alone; pin its own reason too.
  if (shown === null) assert.equal(result?.financialCorrection?.caseId, idFor(cell), idFor(cell) + ': own reason marker');
}

// Real nonzero CLI proof: SDHAND_RED_CASE=<caseId> node tests/hand-table-20261018.test.js exits 1.
if (process.env.SDHAND_RED_CASE) {
  const cell = cells.find(c => idFor(c) === process.env.SDHAND_RED_CASE);
  assert.ok(cell, 'known red-once target');
  try { guard(cell, without(c => c.caseId === idFor(cell))); } finally { assert.deepEqual(liveHashes(), beforeHashes); }
}

test('26 sourced cells, four coverage rows, only the four issuers, documented dates and no invented values', () => {
  const own = table.cases.filter(c => c.revision === REV);
  assert.deepEqual(own.map(c => c.caseId), cells.map(idFor));
  // Appended after every earlier case; only later revisions (G31 switch: BLSH/VCTR quarterly GP holds) may follow.
  const first = table.cases.findIndex(c => c.revision === REV);
  assert.deepEqual(table.cases.slice(first, first + cells.length).map(c => c.caseId), cells.map(idFor), 'appended after every earlier case');
  assert.ok(table.cases.slice(first + cells.length).every(c => c.revision !== REV && c.verifiedAt >= '2026-10-18'), 'only later rows follow');
  for (const c of own) {
    assert.equal(c.verifiedAt, '2026-10-18');
    assert.ok(!DASHES.test(c.reason), 'no dashes in the visible text');
    const kind = c.replacementValue === null
      ? (c.period === '2025-12-31' && c.ticker === 'CDR.WA' ? /^Viertes Quartal 2025 fehlt: / : c.ticker === 'CDR.WA' ? /^Jahreswerte fehlen: /
        : c.ticker === '000552.SZ' ? /^Quartalsgewinn fehlt: / : /^Bruttogewinn fehlt: /)
      : c.ticker === 'CDR.WA' ? (c.replacementValue === c.expectedBadValue ? /^Quartalszahlen bestätigt: / : /^Quartalszahlen korrigiert: /)
        : c.replacementValue === c.expectedBadValue ? /^Umsatz bestätigt: / : /^Umsatz korrigiert: /;
    assert.match(c.reason, kind, c.caseId);
    assert.match(c.reason, /Geprüft am 18\.10\.2026\.$/);
    for (const s of c.sources) {
      assert.match(s.url, /^https:\/\//); assert.ok(s.page && s.quote && s.form);
      assert.ok(s.filed || s.published || s.verifiedAt, 'documented date, never an invented publication date');
    }
  }
  // Gross profit: withheld only (null), never a substitute 0.
  assert.ok(own.filter(c => /^(BLSH|VCTR)$/.test(c.ticker)).every(c => c.replacementValue === null && c.field === 'annualGP' && c.index === 0));
  // Every non-null quarterly value traces to sources on ONE basis: the issuer's own comparison column or one report.
  const basis = s => /including GOG/.test(s.note || '') ? 'with GOG' : 'without GOG';
  for (const c of own.filter(c => c.periodType === '3M' && c.replacementValue !== null)) {
    const d = handTableDerivation(c);
    if (d) assert.equal(d.inputs[0].value - d.inputs[1].value, c.replacementValue, c.caseId);
    else assert.equal(c.sources[0].value, c.replacementValue, c.caseId);
    if (c.ticker === 'CDR.WA') assert.equal(new Set(c.sources.map(basis)).size, 1, c.caseId + ': operands on one basis');
  }
  // The three CDR Q4 2025 cells would need operands on two bases; none of them is shown.
  for (const field of ['revenueQ', 'opIncQ', 'grossProfitQ']) {
    const q4 = own.find(c => c.ticker === 'CDR.WA' && c.field === field && c.period === '2025-12-31');
    assert.equal(q4.replacementValue, null, field);
    assert.deepEqual(q4.sources.map(basis).sort(), ['with GOG', 'without GOG'], field + ': mixed operands are documented, never confirmed');
  }
  assert.deepEqual(table.coverage.slice(37, 41), [ // fixed positions: P148 appends the MODEC row after these four
    { ticker: 'CDR.WA', listingAliases: ['OTGLF'], field: 'revenueQ', coversThrough: '2026-06-30' },
    { ticker: '000552.SZ', field: 'revenueQ', coversThrough: '2026-06-30' },
    { ticker: 'CDR.WA', listingAliases: ['OTGLF'], field: 'opIncQ', coversThrough: '2026-06-30' },
    { ticker: 'CDR.WA', listingAliases: ['OTGLF'], field: 'grossProfitQ', coversThrough: '2026-06-30' }]);
});

for (const cell of cells) test(idFor(cell) + ': exact fingerprint, guard green with the row, red without it', () => {
  const [ticker, field, period, old, shown] = cell, box = container(field);
  const c = table.cases.find(c => c.caseId === idFor(cell));
  assert.deepEqual([c.ticker, c.field, c.period, c.currency, c.expectedBadValue, c.replacementValue],
    [ticker, field, period, fixtures[ticker].meta.reportingCurrencyOriginal, old, shown]);
  for (const raw of ticker === 'VCTR' ? [fixtures.VCTR, vctrDated] : [fixtures[ticker]]) {
    const i = indexOf(raw, box, field, period);
    assert.equal(old * raw.meta.fxRateApplied, value(raw[box][field][i]), 'exact stored USD fingerprint');
    const bytes = JSON.stringify(raw);
    guard(cell, null, ticker, raw);
    assert.throws(() => guard(cell, without(x => x.caseId === idFor(cell)), ticker, raw), assert.AssertionError, 'deleting this row must fail');
    assert.equal(JSON.stringify(raw), bytes, 'input never mutated');
  }
});

test('board effect: CD Projekt on one basis, 000552.SZ on the adjusted pair, gross-profit growths empty with a reason', () => {
  const run = (t, cfg) => applyFinancialCases(fixtures[t], cfg ? { table: cfg } : undefined).snapshot;
  for (const t of ['CDR.WA', 'OTGLF']) {
    const raw = fixtures[t], old = run(t, before), out = run(t), fx = raw.meta.fxRateApplied;
    // Before: the vendor June pair (12.67 %) through the mixed Q4 cell; after: no quarterly pair across the gap,
    // the existing annual leg compares 2025 with 2024, both without GOG (8.59 %).
    assert.equal(revQuartalsYoY(old).toFixed(9), '0.126731385', t + ' vendor pair before');
    assert.equal(revQuartalsYoY(out), null, t + ': no quarterly pair through the withheld Q4 2025 (pre-G31 gap rule)');
    // G31 switch (18.10.2026, B1): the withheld Q4 sits between the dated endpoints, so the newest pair on one
    // basis, Q2 2026 against the restated Q2 2025 (both without GOG), carries the growth; legacy kept the year.
    assert.equal(revGrowthLevel(out).toFixed(6), ((244201 / 174930 - 1) * 100).toFixed(6), t + ': Q2 2026 against restated Q2 2025 without GOG');
    assert.equal(withG31Variant('legacy', () => revGrowthLevel(out)).toFixed(6), ((866989 / 798372 - 1) * 100).toFixed(6), t + ': legacy annual growth 2025/2024 without GOG');
    guard(cells.find(c => idFor(c) === 'cdr.wa-2025-06-30-revenueQ-20261018'), null, t);
    const native = field => out.annual[field].map(value).map(v => v === null ? null : Math.round(v / fx));
    assert.deepEqual(native('annualRev'), [866989000, 798372000, null, null], t + ' annualRev');
    assert.deepEqual(native('annualGP'), [788016000, 680560000, null, null], t + ' annualGP');
    assert.notEqual(revAcceleration(old), null, t + ' mixed-basis acceleration before');
    assert.equal(revAcceleration(out), null, t + ': no acceleration across the GOG basis change');
    // Margin axis: newest against oldest quarter, both without GOG (Q2 2026 and restated Q2 2025).
    assert.ok(Math.abs(marginTrajectory(out) - (148272 / 244201 - 72195 / 174930)) < 1e-12, t + ' margin trajectory on one basis');
    assert.ok(Math.abs(marginTrajectory(old) - (148272 / 244201 - 72468 / 216734)) < 1e-12, t + ' vendor margin trajectory before');
    const reasons = financialReasons(out);
    for (const p of ['Quartalszahlen korrigiert: ', 'Viertes Quartal 2025 fehlt: ', 'Jahreswerte fehlen: ']) assert.ok(reasons.some(s => s.startsWith(p)), t + ' ' + p);
    assert.equal(reasons.length, 3, t + ': three distinct visible hints');
  }
  assert.equal(revQuartalsYoY(run('000552.SZ', before)).toFixed(9), '0.222049398', '22.20 % before');
  const gs = run('000552.SZ');
  assert.equal(revQuartalsYoY(gs).toFixed(9), (2202292523 / 1817142765.65 - 1).toFixed(9), '21.20 % after');
  const q2 = gs.timeseries.revenueQEnds.indexOf('2025-06-30');
  for (const field of ['opIncQ', 'grossProfitQ']) assert.equal(value(gs.timeseries[field][q2]), null, '000552.SZ ' + field + ' Q2 2025 withheld');
  for (const [t, raw] of [['BLSH', fixtures.BLSH], ['VCTR', fixtures.VCTR], ['VCTR', vctrDated]]) {
    const old = applyFinancialCases(raw, { table: before }).snapshot, out = applyFinancialCases(raw).snapshot;
    assert.ok(gpGrowth(old) !== null || t === 'VCTR' && raw === fixtures.VCTR, t + ' vendor GP growth axis before');
    assert.notEqual(overviewMetric(old, { gpClass: 'real' }).value, null, t + ' vendor GP growth shown before');
    assert.equal(gpGrowth(out), null);
    assert.equal(overviewMetric(out, { gpClass: 'real' }).value, null);
    assert.ok(out.annual.annualGP.every(r => r === null || value(r) === null), t + ': every vendor GP year withheld (no gaps)');
    assert.ok(financialReasons(out).some(s => s.startsWith('Bruttogewinn fehlt: ') && s.includes('keine berichtete Kennzahl')));
    assert.deepEqual(applyFinancialCases(out).snapshot, out, t + ' idempotent');
  }
  // Nothing else changes: every field outside the targeted series equals the output of the earlier table.
  for (const t of Object.keys(fixtures)) {
    const raw = fixtures[t], out = applyFinancialCases(raw).snapshot, old = applyFinancialCases(raw, { table: before }).snapshot;
    assert.deepEqual(applyFinancialCases(out).snapshot, out, t + ' idempotent');
    assert.equal(applyFinancialCases(out).events.filter(e => e.status === 'stale').length, 0, t + ': nothing stale');
    for (const box of ['timeseries', 'annual']) for (const field of Object.keys(raw[box])) {
      const targeted = cells.some(c => (c[0] === t || (c[0] === 'CDR.WA' && t === 'OTGLF')) && c[1] === field);
      if (!targeted) assert.deepEqual(out[box][field], old[box][field], `${t} ${field} untouched`);
    }
    assert.deepEqual(out.meta, old.meta, t + ' meta untouched');
  }
});

test('later vendor quarters stay withheld until checked; an unrelated issuer is untouched', () => {
  for (const [t, fields] of [['CDR.WA', ['revenueQ', 'opIncQ', 'grossProfitQ']], ['000552.SZ', ['revenueQ']]]) for (const field of fields) {
    const next = structuredClone(fixtures[t]);
    next.timeseries[field].unshift({ value: 1 }); next.timeseries[field + 'Ends'].unshift('2026-09-30');
    const held = applyFinancialCases(next).snapshot.timeseries[field][0];
    assert.equal(held.value, null, t + ' ' + field); assert.equal(held.financialMissing.reasonCode, 'period-after-coverage');
  }
  // A changed vendor value is never overwritten with the checked one; it is withheld.
  const moved = structuredClone(fixtures['CDR.WA']); moved.timeseries.revenueQ[4] = { value: 1 };
  assert.equal(applyFinancialCases(moved).snapshot.timeseries.revenueQ[4].financialMissing.reasonCode, 'vendor-value-changed');
  const other = structuredClone(fixtures['CDR.WA']); other.meta = { ...other.meta, ticker: 'UNRELATED' };
  assert.equal(applyFinancialCases(other).snapshot, other);
  assert.deepEqual(liveHashes(), beforeHashes, 'live SHA-256 unchanged before and after the memory-only red probes');
});
