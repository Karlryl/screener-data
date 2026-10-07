'use strict';
// P129: real frozen 06.10 packets, independent expected cells, and one missing-row mutation per entry.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { applyFinancialCases, financialReasons, validateTable, table } = require('../lib/financial-known-cases.js');
const { revGrowthLeg } = require('../lib/rev-growth-basis.js');
const fixtures = require('./fixtures/financial-known-cases.json').snapshots;
const root = path.resolve(__dirname, '..');
const value = row => typeof row === 'number' ? row : row?.value;
const hash = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const live = ['configs/financial-known-cases.json', 'tests/fixtures/financial-known-cases.json', 'lib/financial-known-cases.js'];
const liveHashes = () => live.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'));
const beforeHashes = liveHashes();
const cells = [
  ['MAD.AX', '2023-06-30', 0, 172844000, null],
  ['AJBU.SI', '2021-03-31', 0, 67570000, null],
  ['1ANE.MI', '2022-09-30', 0, 1133660000, null],
  ['AIAI', '2025-12-31', 0, 271996000, null, 'annualRev'],
  ['AIAI', '2024-12-31', 1, 23616400000, null, 'annualRev'],
  ['6269.T', '2026-06-30', 0, 225152000000, null],
  ['6269.T', '2026-03-31', 1, 172224000000, null],
  ['6269.T', '2025-12-31', 2, 218333000000, null],
  ['6269.T', '2025-09-30', 3, 197686707200, null],
];
const idFor = ([t, period, , , , field = 'revenueQ']) => `${t.toLowerCase()}-${period}-${field}-p129`;
function without(id) {
  const copy = structuredClone(table);
  copy.cases = copy.cases.filter(c => c.caseId !== id);
  copy.coverage = copy.coverage.map(c => ({ ...c, coversThrough: copy.cases
    .filter(r => r.ticker === c.ticker && r.field === c.field).map(r => r.period).sort().at(-1) })).filter(c => c.coversThrough);
  return validateTable(copy);
}
function guard(cell, config) {
  const [ticker, , index, old, replacement, field = 'revenueQ'] = cell;
  const raw = fixtures[ticker], container = field === 'annualRev' ? 'annual' : 'timeseries';
  const out = applyFinancialCases(raw, { table: config }).snapshot;
  const row = out[container][field][index], expected = replacement === null ? null : replacement * raw.meta.fxRateApplied;
  assert.equal(value(row), expected, idFor(cell) + ': corrected cell');
  if (old !== replacement) {
    const c = config.cases.find(c => c.caseId === idFor(cell));
    assert.equal(row.financialCorrection?.caseId, idFor(cell), idFor(cell) + ': own evidence marker');
    assert.equal(row.financialCorrection.reason, c.reason, idFor(cell) + ': own reason');
    assert.ok(financialReasons(out).includes(c.reason));
  }
}

// Explicit CLI proof: P129_RED_CASE selects a memory-only missing-row fault, never a writing test.
if (process.env.P129_RED_CASE) {
  const cell = cells.find(c => idFor(c) === process.env.P129_RED_CASE);
  assert.ok(cell, 'known red-once case');
  try { guard(cell, without(idFor(cell))); } finally { assert.deepEqual(liveHashes(), beforeHashes); }
}

test('P129 manifest pins every cell and preserves all original authority and fixture hashes', () => {
  assert.deepEqual(table.cases.slice(216).map(c => c.caseId), cells.map(idFor));
  for (const [key, count, digest] of [
    ['cases', 216, '495cee60cd67f8ae1813a39f26d66887a38ecf9af5886c2846fb7ce867327707'],
    ['coverage', 34, '5aec87031a1f8531b556329f38852ea6fa01c33370cde601c9267595610cf490'],
    ['quarantines', 11, '04d5d37834c47fb1d95e468102a07c3b4a42b3fcf91a0f892754685443ef5b89'],
    ['periodLabels', 16, '57bb38710653f7db4cfb98a1e1820372f2c628ef22ff4fb5da0637fe44667445'],
  ]) assert.equal(hash(table[key].slice(0, count)), digest, key + ' untouched');
  assert.equal(hash(Object.fromEntries(Object.entries(fixtures).slice(0, 45))),
    '1f6b5fff99c92ceed65ae735e785e65f0bf82f41be04a3dfea20e832c3cdf1e8');
  assert.equal(table.coverage.length, 34, 'no coverage expansion without a fully verified quarterly series');
  assert.equal(table.periodLabels.length, 16, 'GRGD labels stay open; no ineffective live row');
  assert.equal(Object.keys(fixtures).length, 60); // P129: +15
  assert.equal(table.cases.slice(216).filter(c => c.periodType === '12M').every(c => c.ticker === 'AIAI' && c.replacementValue === null), true,
    'no annual replacement from the #431 waiting list');
});

for (const cell of cells) test(idFor(cell) + ': source value, reason, fingerprint and independent red-once proof', () => {
  const [ticker, period, index, old, replacement, field = 'revenueQ'] = cell;
  const c = table.cases.find(c => c.caseId === idFor(cell));
  assert.ok(c);
  assert.deepEqual([c.ticker, c.period, c.index, c.expectedBadValue, c.replacementValue, c.field],
    [ticker, period, index, old, replacement, field]);
  const s = fixtures[ticker], container = field === 'annualRev' ? 'annual' : 'timeseries';
  assert.equal(value(s[container][field][index]), old * s.meta.fxRateApplied, 'exact stored fingerprint');
  if (field === 'revenueQ') assert.equal(s.timeseries.revenueQEnds[index], period);
  assert.equal(c.currency, s.meta.reportingCurrencyOriginal);
  assert.match(c.reason, /(?:bestätigt|korrigiert|zurückgehalten): /);
  assert.ok(!/[–—]/.test(c.reason), 'German full sentences without dash punctuation');
  assert.ok(c.sources.every(s => s.url.startsWith('https://') && s.page && s.quote && s.unit));
  const bytes = JSON.stringify(s);
  guard(cell, table);
  assert.throws(() => guard(cell, without(idFor(cell))), assert.AssertionError, 'deleting this row must fail');
  assert.equal(JSON.stringify(s), bytes, 'real fixture is immutable');
});

test('retained withholds select source-verified annual pairs or an empty growth', () => {
  for (const [ticker, growth, basis] of [
    ['MAD.AX', 14.783043377566196, 'year'],
    ['AJBU.SI', 42.243149084557196, 'year'], ['1ANE.MI', -4.035433070866146, 'year'],
  ]) {
    const after = revGrowthLeg(applyFinancialCases(fixtures[ticker]).snapshot);
    assert.equal(after.basis, basis, ticker);
    assert.ok(Math.abs(after.pct - growth) < 1e-10, ticker + ' actual fallback or P69 target');
  }
  assert.equal(revGrowthLeg(applyFinancialCases(fixtures.AIAI).snapshot).pct, null);
  const modec = applyFinancialCases(fixtures['6269.T']).snapshot;
  assert.ok(modec.timeseries.revenueQ.every(r => value(r) === null));
  assert.deepEqual(modec.annual, fixtures['6269.T'].annual, 'council F5 retains the USD annual series');
  assert.deepEqual(revGrowthLeg(modec), revGrowthLeg(fixtures['6269.T']));
});

test('P129 authorizes only named withholds and cannot reintroduce the rejected quarterly coverage', () => {
  const additions = table.cases.slice(216);
  assert.ok(additions.every(row => row.replacementValue === null));
  assert.deepEqual([...new Set(additions.map(row => row.ticker))].sort(), ['1ANE.MI', '6269.T', 'AIAI', 'AJBU.SI', 'MAD.AX']);
  assert.equal(table.coverage.length, 34);
  for (const [ticker, current, prior, currency] of [
    ['AJBU.SI', 441362000, 310287000, 'SGD'], ['1ANE.MI', 2925000000, 3048000000, 'EUR'],
  ]) {
    // Issuer annual reports FY2025: Keppel DC REIT printed 108; Acciona Energia PDF 12 / printed 5.
    const raw = fixtures[ticker], after = applyFinancialCases(raw).snapshot;
    assert.equal(raw.meta.reportingCurrencyOriginal, currency);
    assert.deepEqual(raw.annual.annualRevEnds.slice(0, 2), ['2025-12-31', '2024-12-31']);
    assert.equal(value(raw.annual.annualRev[0]), current * raw.meta.fxRateApplied);
    assert.equal(value(raw.annual.annualRev[1]), prior * raw.meta.fxRateApplied);
    assert.deepEqual(after.annual, raw.annual, ticker + ' verified annual pair is unchanged');
    assert.deepEqual([revGrowthLeg(after).periodEnd, revGrowthLeg(after).priorPeriodEnd], ['2025-12-31', '2024-12-31']);
    assert.ok(Math.abs(revGrowthLeg(after).pct - (current / prior - 1) * 100) < 1e-10);
  }
});

test('missing MAGN/AJBU periods and FX-blocked GRGD label authority stay explicit rather than fabricated', () => {
  for (const [ticker, periods] of [['MAGN', ['2026-06-27', '2025-06-28']], ['AJBU.SI', ['2026-06-30', '2025-06-30']]]) {
    for (const period of periods) assert.equal(fixtures[ticker].timeseries.revenueQEnds.includes(period), false);
  }
  const raw = fixtures['GRGD.TO'], copy = structuredClone(table);
  for (const [period, reportedPeriodEnd, verifiedValue] of [
    ['2026-07-31', '2026-08-01', 423638000], ['2025-07-31', '2025-08-02', 326425000],
  ]) copy.periodLabels.push({ caseId: `grgd.to-${period}-revenueQ-period-label-probe`, ticker: 'GRGD.TO',
    field: 'revenueQ', periodType: '3M', period, reportedPeriodEnd, currency: 'CAD', verifiedValue,
    reason: `Periodenende laut Originalbericht ${reportedPeriodEnd}; Umsatzwert unverändert.`,
    sources: [{ url: 'https://investisseurs.groupedynamite.com/image/GDI-Q2-2026-Financial-Statements-FR_FINAL.pdf',
      page: 'PDF page 2', quote: reportedPeriodEnd === '2026-08-01' ? '1er août 2026' : '2 août 2025',
      unit: 'CAD thousands', value: verifiedValue, end: reportedPeriodEnd }] });
  assert.equal(raw.meta.fxRateApplied, 0.72103256);
  assert.equal(applyFinancialCases(raw, { table: validateTable(copy) }).snapshot, raw,
    'applyFinancialCases periodLabels requires factor 1; a CAD row cannot annotate this USD-converted packet');
  assert.deepEqual(liveHashes(), beforeHashes, 'all red-once mutations remain in memory');
});
