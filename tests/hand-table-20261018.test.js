'use strict';
// Hand table 18.10.2026: four board numbers of the 17.10. export that the issuers' own reports contradict.
// Real frozen packets from tests/fixtures/financial-known-cases.json: BLSH, CDR.WA, OTGLF and 000552.SZ from
// the 17.10. run; VCTR from the 30.09. run (same gross-profit values, undated year ends) plus its 17.10. form
// with dated year ends. Every red probe changes an in-memory table copy only; live files are hashed before and after.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { applyFinancialCases, financialReasons, validateTable, table } = require('../lib/financial-known-cases.js');
const { revQuartalsYoY, gpGrowth } = require('../src/scoring/axes.js');
const { overviewMetric } = require('../src/scoring/overview.js');
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

// [ticker, field, period, stored native vendor value, shown native value (null = withheld)]
const cells = [
  ['BLSH', 'annualGP', '2025-12-31', 74084000, null],
  ['VCTR', 'annualGP', '2025-12-31', 711149000, null],
  ['CDR.WA', 'revenueQ', '2026-06-30', 244201000, 244201000],
  ['CDR.WA', 'revenueQ', '2026-03-31', 191107000, 191107000],
  ['CDR.WA', 'revenueQ', '2025-12-31', 74877000, 74877000],
  ['CDR.WA', 'revenueQ', '2025-09-30', 349072000, 349072000],
  ['CDR.WA', 'revenueQ', '2025-06-30', 216734000, 174930000],
  ['000552.SZ', 'revenueQ', '2026-06-30', 2202292523, 2202292523],
  ['000552.SZ', 'revenueQ', '2026-03-31', 2495330187.99, 2495330187.99],
  ['000552.SZ', 'revenueQ', '2025-12-31', 1719171214.57, 1719171214.57],
  ['000552.SZ', 'revenueQ', '2025-06-30', 1802130524.26, 1817142765.65],
  ['000552.SZ', 'revenueQ', '2025-03-31', 1950615225.65, 1950615225.65],
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
}

// Real nonzero CLI proof: SDHAND_RED_CASE=<caseId> node tests/hand-table-20261018.test.js exits 1.
if (process.env.SDHAND_RED_CASE) {
  const cell = cells.find(c => idFor(c) === process.env.SDHAND_RED_CASE);
  assert.ok(cell, 'known red-once target');
  try { guard(cell, without(c => c.caseId === idFor(cell))); } finally { assert.deepEqual(liveHashes(), beforeHashes); }
}

test('12 sourced cells, two coverage rows, only the four issuers, documented dates and no invented values', () => {
  const own = table.cases.filter(c => c.revision === REV);
  assert.deepEqual(own.map(c => c.caseId), cells.map(idFor));
  assert.deepEqual(table.cases.slice(-12).map(c => c.caseId), cells.map(idFor), 'appended after every earlier case');
  for (const c of own) {
    assert.equal(c.verifiedAt, '2026-10-18');
    assert.ok(!DASHES.test(c.reason), 'no dashes in the visible text');
    assert.match(c.reason, c.replacementValue === null ? /^Bruttogewinn fehlt: / : c.replacementValue === c.expectedBadValue ? /^Umsatz bestätigt: / : /^Umsatz korrigiert: /);
    assert.match(c.reason, /Geprüft am 18\.10\.2026\.$/);
    for (const s of c.sources) {
      assert.match(s.url, /^https:\/\//); assert.ok(s.page && s.quote && s.form);
      assert.ok(s.filed || s.published || s.verifiedAt, 'documented date, never an invented publication date');
    }
  }
  // Gross profit: withheld only (null), never a substitute 0; revenue: every replacement traces to its own sources.
  assert.ok(own.filter(c => /^(BLSH|VCTR)$/.test(c.ticker)).every(c => c.replacementValue === null && c.field === 'annualGP' && c.index === 0));
  for (const c of own.filter(c => c.field === 'revenueQ')) {
    const d = handTableDerivation(c);
    if (d) assert.equal(d.inputs[0].value - d.inputs[1].value, c.replacementValue, c.caseId);
    else assert.equal(c.sources[0].value, c.replacementValue, c.caseId);
  }
  assert.deepEqual(table.coverage.slice(-2), [
    { ticker: 'CDR.WA', listingAliases: ['OTGLF'], field: 'revenueQ', coversThrough: '2026-06-30' },
    { ticker: '000552.SZ', field: 'revenueQ', coversThrough: '2026-06-30' }]);
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

test('board effect: both revenue pairs on the issuer basis, both gross-profit growths empty with a visible reason', () => {
  const growth = (t, cfg) => revQuartalsYoY(applyFinancialCases(fixtures[t], cfg ? { table: cfg } : undefined).snapshot);
  for (const t of ['CDR.WA', 'OTGLF']) {
    assert.equal(growth(t, before).toFixed(9), '0.126731385', t + ' vendor pair before (12.67 %)');
    assert.equal(growth(t).toFixed(9), (244201 / 174930 - 1).toFixed(9), t + ': 39.60 % after');
    guard(cells.find(c => idFor(c) === 'cdr.wa-2025-06-30-revenueQ-20261018'), null, t);
  }
  assert.equal(growth('000552.SZ', before).toFixed(9), '0.222049398', '22.20 % before');
  assert.equal(growth('000552.SZ').toFixed(9), (2202292523 / 1817142765.65 - 1).toFixed(9), '21.20 % after');
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
  for (const t of ['CDR.WA', '000552.SZ']) {
    const next = structuredClone(fixtures[t]);
    next.timeseries.revenueQ.unshift({ value: 1 }); next.timeseries.revenueQEnds.unshift('2026-09-30');
    const held = applyFinancialCases(next).snapshot.timeseries.revenueQ[0];
    assert.equal(held.value, null); assert.equal(held.financialMissing.reasonCode, 'period-after-coverage');
  }
  // A changed vendor value is never overwritten with the checked one; it is withheld.
  const moved = structuredClone(fixtures['CDR.WA']); moved.timeseries.revenueQ[4] = { value: 1 };
  assert.equal(applyFinancialCases(moved).snapshot.timeseries.revenueQ[4].financialMissing.reasonCode, 'vendor-value-changed');
  const other = structuredClone(fixtures['CDR.WA']); other.meta = { ...other.meta, ticker: 'UNRELATED' };
  assert.equal(applyFinancialCases(other).snapshot, other);
  assert.deepEqual(liveHashes(), beforeHashes, 'live SHA-256 unchanged before and after the memory-only red probes');
});
