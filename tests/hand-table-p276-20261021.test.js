'use strict';
// P276 (21.10.2026): hand-table follow-ups of the annual-spikes watcher (P275).
// - TWE.AX / TSRYF annualOpInc: the vendor values 57.5 / 518.1 / 42.6 / 182.7 Mio AUD appear in no report. The issuer's
//   operating line is "Profit before tax and finance costs" (after all operating expenses, before finance items and
//   tax); its values -1,279.6 / 736.6 / 266.6 / 409.7 Mio AUD replace them.
// - KINV-A.ST / KINV-B.ST / KNEVF revenue: Kinnevik reports no revenue line. The vendor fills the years with dividends
//   received or a 0 (2022 a false 0) and the quarters with profit after financial net (partly negative). Every annual
//   and quarterly cell is withheld, never 0. KNEVF carries the identical quarters but a different annual series (the
//   fair-value change), so it is an alias of the quarterly holds only; its annual series is left as it is.
// Real frozen packets of the daily run 39563364953 (tests/fixtures/hand-table-p276.json). Every red probe changes an
// in-memory table copy only; live files are hashed before and after.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { applyFinancialCases, financialReasons, validateTable, table } = require('../lib/financial-known-cases.js');
const { revQuartalsYoY, revGrowthLevel } = require('../src/scoring/axes.js');
const fixtures = require('./fixtures/hand-table-p276.json').snapshots;
const root = path.resolve(__dirname, '..');
const value = row => typeof row === 'number' ? row : row?.value ?? null;
const live = ['configs/financial-known-cases.json', 'lib/financial-known-cases.js', 'tests/fixtures/hand-table-p276.json'];
const liveHashes = () => live.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'));
const beforeHashes = liveHashes();
const REV = '2026-10-21-p276';

// [field, period, stored native vendor value, shown native value (null = withheld)], in table order.
const twe = [
  ['annualOpInc', '2026-06-30', 57500000, -1279600000],
  ['annualOpInc', '2025-06-30', 518100000, 736600000],
  ['annualOpInc', '2024-06-30', 42600000, 266600000],
  ['annualOpInc', '2023-06-30', 182700000, 409700000],
];
const kinv = [
  ['annualRev', '2025-12-31', 0, null],
  ['annualRev', '2024-12-31', 23000000, null],
  ['annualRev', '2023-12-31', 936000000, null],
  ['annualRev', '2022-12-31', 0, null],
  ['revenueQ', '2026-06-30', 1717000000, null],
  ['revenueQ', '2026-03-31', -7969000000, null],
  ['revenueQ', '2025-12-31', -2567000000, null],
  ['revenueQ', '2025-06-30', 626000000, null],
  ['revenueQ', '2025-03-31', -3037000000, null],
];
const cells = [...twe.map(c => ['TWE.AX', ...c]), ...kinv.map(c => ['KINV-A.ST', ...c])];
const listings = { 'TWE.AX': ['TWE.AX', 'TSRYF'], 'KINV-A.ST': ['KINV-A.ST', 'KINV-B.ST'] };
// Listings that carry the exact vendor values of a series (KNEVF: identical quarters, other annual values).
const listingsFor = (ticker, field) => field === 'revenueQ' ? [...listings[ticker], 'KNEVF'] : listings[ticker];
const kinvAll = [...listings['KINV-A.ST'], 'KNEVF'];
const idFor = ([ticker, field, period]) => `${ticker.toLowerCase()}-${period}-${field}-20261021`;
const box = field => field.startsWith('annual') ? 'annual' : 'timeseries';

/** Table copy without the given cases; coverage follows the remaining verified periods (as the validator demands). */
function without(drop) {
  const copy = structuredClone(table);
  copy.cases = copy.cases.filter(c => !drop(c));
  copy.coverage = copy.coverage.map(v => ({ ...v, coversThrough: copy.cases
    .filter(c => c.ticker === v.ticker && c.field === v.field).map(c => c.period).sort().at(-1) })).filter(v => v.coversThrough);
  return validateTable(copy);
}
const before = without(c => c.revision === REV); // the table as on origin/main before this change

// Guard: the cell shows the issuer value (or is withheld with its own reason), never the vendor value.
function guard(cell, config, raw) {
  const [, field, period, , shown] = cell, b = box(field), i = raw[b][field + 'Ends'].indexOf(period);
  assert.ok(i >= 0, 'period present in the frozen packet');
  const row = applyFinancialCases(raw, config ? { table: config } : undefined).snapshot[b][field][i];
  assert.equal(value(row), shown === null ? null : shown * raw.meta.fxRateApplied, idFor(cell) + ' on ' + raw.meta.ticker);
  assert.equal(row?.financialCorrection?.caseId, idFor(cell), idFor(cell) + ': own reason marker');
}

// Real nonzero CLI proof: P276_RED_CASE=<caseId> [P276_RED_LISTING=<listing>] node tests/hand-table-p276-20261021.test.js
// exits 1. Without P276_RED_LISTING the primary listing is probed.
if (process.env.P276_RED_CASE) {
  const cell = cells.find(c => idFor(c) === process.env.P276_RED_CASE);
  const listing = process.env.P276_RED_LISTING || cell?.[0];
  assert.ok(cell && listingsFor(cell[0], cell[1]).includes(listing), 'known red-once target');
  try { guard(cell, without(c => c.caseId === idFor(cell)), fixtures[listing]); } finally { assert.deepEqual(liveHashes(), beforeHashes); }
}

test('13 sourced cells, appended, only TWE and Kinnevik, no substitute 0', () => {
  const own = table.cases.filter(c => c.revision === REV);
  assert.deepEqual(own.map(c => c.caseId), cells.map(idFor));
  const first = table.cases.findIndex(c => c.revision === REV);
  // 23.10.2026 appends the five CIG-C operating-income cells after the P276 rows, 24.10.2026 the 15 cells of lane
  // sd-umsatzreihen, the 14 of lane sd-umsatzreihen-2 and the two INFRAC.SW operating-income years of lane
  // sd-umsatzreihen-3, then the 48 cells of lane sd-triage-handtabelle the 70 of lane sec-abgleich and the 35 of lane sec-abgleich-ausland (30.10.2026); nothing else follows them.
  const later = table.cases.slice(first + own.length);
  assert.deepEqual(later.map(c => c.revision), [...Array(5).fill('2026-10-23-sdcigc'), ...Array(15).fill('2026-10-24-sdumsatz'), ...Array(14).fill('2026-10-24-sdumsatz2'), ...Array(2).fill('2026-10-24-sdumsatz3'), ...Array(48).fill('2026-10-24-sdtriage'), ...Array(70).fill('2026-10-30-secabgleich'), ...Array(35).fill('2026-10-30-sdz1'), ...Array(35).fill('2026-10-30-secabgleich-ausland'), ...Array(3).fill('2026-10-30-sdb12')], 'appended after every earlier case');
  for (const c of own) {
    assert.equal(c.verifiedAt, '2026-10-21');
    assert.deepEqual(c.listingAliases, listingsFor(c.ticker, c.field).slice(1));
    assert.match(c.reason, /Geprüft am 21\.10\.2026\.$/);
    assert.notEqual(c.replacementValue, 0, 'never a substitute 0');
    for (const s of c.sources) { assert.match(s.url, /^https:\/\//); assert.ok(s.page && s.quote && s.form && s.published); }
    if (c.ticker === 'TWE.AX') {
      assert.match(c.reason, /^Betriebsergebnis korrigiert: /);
      assert.equal(c.metricDefinition, 'Profit before tax and finance costs');
      assert.ok(c.sources.every(s => s.value === c.replacementValue && s.end === c.period && /finance costs/.test(s.quote)));
    } else {
      assert.equal(c.replacementValue, null);
      assert.match(c.reason, /^(Jahresumsatz|Quartalsumsatz) fehlt: Kinnevik ist eine Beteiligungsgesellschaft/);
    }
  }
  // Withheld false values need no coverage (coverage marks a verified series); none is added.
  assert.ok(!table.coverage.some(v => v.ticker === 'KINV-A.ST' || v.ticker === 'TWE.AX'));
});

for (const cell of cells) test(idFor(cell) + ': exact fingerprint on every listing, guard green with the row, red without it', () => {
  const [ticker, field, period, old, shown] = cell, b = box(field);
  const c = table.cases.find(c => c.caseId === idFor(cell));
  assert.deepEqual([c.ticker, c.field, c.period, c.expectedBadValue, c.replacementValue], [ticker, field, period, old, shown]);
  for (const t of listingsFor(ticker, field)) {
    const raw = fixtures[t], i = raw[b][field + 'Ends'].indexOf(period);
    assert.equal(c.currency, raw.meta.reportingCurrencyOriginal);
    assert.equal(old * raw.meta.fxRateApplied, value(raw[b][field][i]), t + ': exact stored USD fingerprint');
    const bytes = JSON.stringify(raw);
    guard(cell, null, raw);
    assert.throws(() => guard(cell, without(x => x.caseId === idFor(cell)), raw), assert.AssertionError, 'deleting this row must fail');
    assert.equal(JSON.stringify(raw), bytes, 'input never mutated');
  }
});

test('the wrong values never come back: TWE operating series is the issuer series, Kinnevik revenue is empty', () => {
  for (const t of listings['TWE.AX']) {
    const raw = fixtures[t], fx = raw.meta.fxRateApplied;
    const native = s => s.annual.annualOpInc.map(value).map(v => v === null ? null : Math.round(v / fx));
    assert.deepEqual(native(applyFinancialCases(raw, { table: before }).snapshot), [57500000, 518100000, 42600000, 182700000], t + ' vendor before');
    const out = applyFinancialCases(raw).snapshot;
    assert.deepEqual(native(out), [-1279600000, 736600000, 266600000, 409700000], t + ' issuer after');
    assert.ok(financialReasons(out).some(s => s.startsWith('Betriebsergebnis korrigiert: Treasury Wine Estates')));
  }
  for (const t of kinvAll) {
    const raw = fixtures[t], old = applyFinancialCases(raw, { table: before }).snapshot, out = applyFinancialCases(raw).snapshot;
    // Before: the filter universe showed 174.28 % "revenue growth" (Q2 2026 against Q2 2025 profit after financial net).
    assert.equal((revQuartalsYoY(old) * 100).toFixed(2), '174.28', t + ' vendor quarterly growth before');
    assert.equal(revQuartalsYoY(out), null, t + ': no quarterly revenue growth');
    assert.equal(revGrowthLevel(out), null, t + ': no revenue growth at all');
    if (t === 'KNEVF') assert.deepEqual(out.annual.annualRev, raw.annual.annualRev, 'KNEVF annual series is another vendor series, untouched');
    else assert.ok(out.annual.annualRev.every(r => value(r) === null), t + ': every annual revenue withheld, no 0');
    assert.ok(out.timeseries.revenueQ.every(r => value(r) === null), t + ': every quarterly revenue withheld, no 0');
    assert.ok(financialReasons(out).some(s => s.includes('Kinnevik ist eine Beteiligungsgesellschaft')));
  }
});

test('nothing else changes; idempotent; a later Kinnevik quarter finds no year-ago pair; another issuer is untouched', () => {
  for (const [t, raw] of Object.entries(fixtures)) {
    const out = applyFinancialCases(raw).snapshot, old = applyFinancialCases(raw, { table: before }).snapshot;
    assert.deepEqual(applyFinancialCases(out).snapshot, out, t + ' idempotent');
    const targeted = new Set(cells.filter(c => listingsFor(c[0], c[1]).includes(t)).map(c => c[1]));
    for (const b of ['timeseries', 'annual']) for (const field of Object.keys(raw[b])) {
      if (!targeted.has(field)) assert.deepEqual(out[b][field], old[b][field], `${t} ${field} untouched`);
    }
    assert.deepEqual(out.meta, old.meta, t + ' meta untouched');
    const other = structuredClone(raw); other.meta.ticker = 'UNLISTED';
    assert.deepEqual(applyFinancialCases(other).snapshot, other, t + ': the same packet under another ticker is untouched');
  }
  // ponytail: no coverage for a withheld-only series (table design); a new vendor quarter shows but has no
  // year-ago partner until Q3 2027 (Q3 2025 is absent, Q4 2025 to Q2 2026 are withheld). Ceiling: from Q3 2027 a
  // vendor pair could return; the non-operating class route (configs/non-operating-classes.json) is the upgrade.
  for (const t of kinvAll) {
    const next = structuredClone(fixtures[t]);
    next.timeseries.revenueQ.unshift({ value: 1 }); next.timeseries.revenueQEnds.unshift('2026-09-30');
    const out = applyFinancialCases(next).snapshot;
    assert.equal(revQuartalsYoY(out), null, t + ': no quarterly pair'); assert.equal(revGrowthLevel(out), null, t);
  }
  // A different TWE vendor value (restatement, new pull) is never overwritten with the issuer number: withheld instead.
  const drift = structuredClone(fixtures['TWE.AX']); drift.annual.annualOpInc[1] = { value: 1 };
  assert.equal(value(applyFinancialCases(drift).snapshot.annual.annualOpInc[1]), null);
  assert.deepEqual(liveHashes(), beforeHashes, 'live files unchanged');
});
