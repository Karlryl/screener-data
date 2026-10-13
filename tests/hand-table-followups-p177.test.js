'use strict';
// Frozen 10.10.2026 cell values; break-once changes memory only, never a writing test or live file.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { Module, createRequire } = require('node:module');
const F = require('../lib/financial-known-cases.js');
const P = require('../lib/export-provenance.js');
const { revQuartalsYoY } = require('../src/scoring/axes.js');
const { preserveReloadHistory } = require('../lib/reload-history.js');
const value = row => typeof row === 'number' ? row : row?.value ?? null;
const years = ['2025-12-31', '2024-12-31', '2023-12-31', '2022-12-31'];
const old = {
  annualRev: [1423019000, 929925000, 720227000, 718905000],
  annualGP: [622203000, 198210000, 112949000, 116156000],
  annualOpInc: [514795000, 106276000, -44674000, -12438000],
};
const expected = {
  annualRev: [1103902000, 720246000, 542549000, null],
  annualGP: [509805000, 183184000, 101271000, null],
  annualOpInc: [396409000, 123762000, 12009000, null],
};
function hl(persisted = false, ticker = 'HL') {
  const annual = Object.fromEntries(Object.entries(old).flatMap(([field, cells]) =>
    [[field, cells.map(value => ({ value }))], [field + 'Ends', years.slice()]]));
  annual.annualNetIncome = [321712000, 35802000, -84217000, -37348000].map(value => ({ value }));
  annual.annualNetIncomeEnds = years.slice();
  if (persisted) annual.annualGP = old.annualGP.map((n, i) => i < 3 ? { value: null, financialCorrection: {
    caseId: `hl-${years[i]}-annualGP`, originalVendorRow: { value: n }, originalNativeValue: n,
    replacementNativeValue: null, nativeCurrency: 'USD', revision: '2026-10-02i', reason: 'Alter Rückhalt.' } }
    : { value: null, financialMissing: { caseId: 'hl-2025-12-31-annualGP', period: years[i],
      originalVendorRow: { value: n }, revision: '2026-10-02i', reasonCode: 'annual-older-than-withheld', reason: 'Alter Rückhalt.' } });
  return { meta: { ticker, reportingCurrency: 'USD', reportingCurrencyOriginal: 'USD', fxConverted: true, fxRateApplied: 1 },
    annual, marketCap: { value: 1 }, timeseries: {
      revenueQ: [333851000, 411433000, 448111000, 409542000, 218992000].map(value => ({ value })),
      revenueQEnds: ['2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'] } };
}
function bylot() {
  const fx = 1.1392117;
  return { meta: { ticker: 'BYLOT.AT', reportingCurrency: 'USD', reportingCurrencyOriginal: 'EUR', fxConverted: true, fxRateApplied: fx },
    annual: {}, timeseries: { revenueQ: [276077000, 268084000, 275533000, 74461000, 79586000, null].map(v => v === null ? null : { value: v * fx }),
      revenueQEnds: ['2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30', '2025-03-31'] } };
}
function cig(persisted = true) {
  const fx = 0.19915557, ends = ['2026-06-30', '2025-06-30'];
  return { meta: { ticker: 'CIG-C', reportingCurrency: 'USD', reportingCurrencyOriginal: 'BRL', fxConverted: true, fxRateApplied: fx },
    annual: {}, timeseries: { grossProfitQEnds: ends, grossProfitQ: [1804259000, 2081436000].map((n, i) => persisted
      ? { value: null, financialMissing: { reasonCode: 'vendor-value-changed', reason: 'Quartalswert fehlt.',
        caseId: `cig-c-${ends[i]}-grossProfitQ`, period: ends[i], originalVendorRow: { value: n }, revision: '2026-10-02i' } }
      : { value: n * fx }) } };
}
const live = ['configs/financial-known-cases.json', 'lib/financial-known-cases.js', 'lib/export-provenance.js'];
const hashes = () => live.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '..', f))).digest('hex'));
const initialHashes = hashes();
function annualGuard(apply) {
  const result = apply(hl(true)).snapshot;
  for (const [field, cells] of Object.entries(expected)) assert.deepEqual(result.annual[field].map(value), cells, field);
}
function mutant(anchor, replacement) {
  const filename = path.resolve(__dirname, '../lib/financial-known-cases.js'), source = fs.readFileSync(filename, 'utf8');
  assert.equal(source.split(anchor).length, 2, 'one exact full-line mutation anchor');
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths;
  mod._compile(source.replace(anchor, replacement), filename);
  return mod.exports.applyFinancialCases;
}

test('P177 evidence pins nine annual replacements, five BYLOT periods and two CIG fingerprints', () => {
  const rows = F.table.cases.filter(c => c.revision === '2026-10-11-p177');
  assert.equal(rows.length, 16);
  assert.deepEqual([...new Set(rows.map(c => c.ticker))].sort(), ['BYLOT.AT', 'CIG-C', 'HL']);
  for (const c of rows) {
    assert.ok(c.reason && !/[–—]/.test(c.reason));
    assert.match(c.verifiedAt, /^2026-10-\d\d$/);
    for (const s of c.sources) {
      assert.match(s.url, /^https:\/\//); assert.ok(s.page && s.quote);
      assert.ok(s.filed || s.published || s.verifiedAt, 'documented date, never an invented publication date');
    }
  }
  assert.equal(rows.filter(c => c.ticker === 'HL').length, 9);
  // The gross-profit source must explain why the earlier consolidated values were recast.
  for (const c of rows.filter(c => c.ticker === 'HL' && c.field === 'annualGP')) {
    assert.ok(c.sources[0].quote.includes('as a discontinued operation for all periods presented'));
    assert.ok(c.sources[0].page.includes('74'));
  }
  assert.equal(rows.filter(c => c.ticker === 'HL' && c.field === 'annualNetIncome').length, 0, 'no unsupported net-income values');
});

test('HL fresh and persisted holds, both existing listings: all nine cells, older gaps, no invented net income', () => {
  annualGuard(F.applyFinancialCases);
  for (const ticker of ['HL', 'HL.SW']) for (const held of [false, true]) {
    const raw = hl(held, ticker), saved = structuredClone(raw), out = F.applyFinancialCases(raw).snapshot;
    for (const [field, cells] of Object.entries(expected)) {
      assert.deepEqual(out.annual[field].map(value), cells);
      for (const row of out.annual[field].slice(0, 3)) assert.ok(row.financialCorrection?.sources?.[0]?.quote);
      assert.equal(out.annual[field][3].financialMissing.reasonCode, 'annual-older-than-cases');
    }
    assert.deepEqual(out.annual.annualNetIncome, raw.annual.annualNetIncome);
    assert.deepEqual(out.timeseries, raw.timeseries);
    assert.deepEqual(F.applyFinancialCases(out).snapshot, out);
    assert.deepEqual(raw, saved);
  }
});

test('an old HL hold marker never authorizes overwriting a newly present unmatched value', () => {
  const guard = apply => {
    const raw = hl(true); raw.annual.annualGP[0].value = 123;
    const out = apply(raw).snapshot;
    assert.equal(out.annual.annualGP[0].value, null);
    assert.equal(out.annual.annualGP[0].financialMissing.reasonCode, 'vendor-value-changed');
    assert.ok(out.annual.annualGP.every(row => value(row) === null));
  };
  guard(F.applyFinancialCases);
  const anchor = '    if (annual.has(c.field) && valueOf(row) === null && correction?.caseId === c.caseId && correction.replacementNativeValue === null &&';
  assert.throws(() => guard(mutant(anchor, anchor.replace('valueOf(row) === null && ', ''))), assert.AssertionError);
});

test('BYLOT retains original Q3 with a visible German note and reports 219.20%, missing Q1 stays missing', () => {
  const raw = bylot(), out = F.applyFinancialCases(raw).snapshot, fx = raw.meta.fxRateApplied;
  assert.equal((revQuartalsYoY(out) * 100).toFixed(2), '219.20');
  assert.deepEqual(out.timeseries.revenueQ.map(value), [276077000, 268084000, 254100000, 74461000, 86490000, null].map(v => v === null ? null : v * fx));
  assert.ok(F.financialReasons(out).some(s => s.includes('ursprünglichen Basis „Sale Proceeds“')));
  assert.equal(out.timeseries.revenueQ[5], null);
  assert.deepEqual(F.applyFinancialCases(out).snapshot, out);
  const next = bylot(); next.timeseries.revenueQ.unshift({ value: 10 }); next.timeseries.revenueQEnds.unshift('2026-09-30');
  const held = F.applyFinancialCases(next).snapshot.timeseries.revenueQ[0];
  assert.equal(held.value, null); assert.equal(held.financialMissing.reasonCode, 'period-after-coverage');
});

test('CIG-C updated native audit rows and normalized raw inputs both restore only the two documented cells', () => {
  for (const persisted of [true, false]) {
    const raw = cig(persisted), saved = structuredClone(raw), out = F.applyFinancialCases(raw).snapshot;
    assert.deepEqual(out.timeseries.grossProfitQ.map(value), [1952136000, 2199760000].map(v => v * raw.meta.fxRateApplied));
    assert.deepEqual(F.applyFinancialCases(out).snapshot, out);
    assert.deepEqual(raw, saved);
  }
  for (const edit of [
    s => { s.timeseries.grossProfitQ[0].financialMissing.originalVendorRow.value++; },
    s => { s.timeseries.grossProfitQ[0].financialMissing.revision = 'unverified'; },
    s => { s.timeseries.grossProfitQ[0].financialMissing.period = '2026-03-31'; },
    s => { s.meta.reportingCurrencyOriginal = 'EUR'; },
  ]) {
    const raw = cig(); edit(raw);
    assert.equal(value(F.applyFinancialCases(raw).snapshot.timeseries.grossProfitQ[0]), null);
  }
  const liveNative = cig(false); liveNative.timeseries.grossProfitQ[0].value = 1804259000;
  assert.equal(value(F.applyFinancialCases(liveNative).snapshot.timeseries.grossProfitQ[0]), null, 'native exception never applies to an unannotated USD row');
});

test('stale CIG-C hold markers never overwrite present values, including nested retained rows', () => {
  const guard = apply => {
    for (const nested of [false, true]) {
      const raw = cig(), row = raw.timeseries.grossProfitQ[0];
      row.value = 123;
      if (nested) raw.timeseries.grossProfitQ[0] = { value: null,
        financialMissing: { ...row.financialMissing, originalVendorRow: row } };
      const out = apply(raw).snapshot.timeseries.grossProfitQ[0];
      assert.equal(out.value, null);
      assert.equal(out.financialMissing.reasonCode, 'vendor-value-changed');
      assert.equal(out.financialMissing.originalVendorRow.value, 123);
    }
  };
  guard(F.applyFinancialCases);
  const anchor = "      while (valueOf(row) === null && holdIds.includes(row?.financialMissing?.caseId) && Object.hasOwn(row.financialMissing, 'originalVendorRow')) {";
  assert.throws(() => guard(mutant(anchor, anchor.replace('valueOf(row) === null && ', ''))), assert.AssertionError);
});

for (const field of ['annualOpInc', 'annualNetIncome']) test(field + ' reuses annual validation, FX, gap and reload safeguards', () => {
  const table = { schemaVersion: 1, revision: 'test', cases: [], coverage: [], quarantines: [] };
  for (let i = 0; i < 3; i++) table.cases.push({ caseId: 'synthetic-' + field + i, ticker: 'TEST', field,
    period: years[i], periodType: '12M', index: i, currency: 'EUR', unit: 'currency', expectedBadValue: 30 - i,
    replacementValue: 100 - i, reason: 'Testwert korrigiert: synthetischer Beleg.', sources: [{
      url: 'https://example.invalid/annual', quote: 'Synthetic value', page: 1, value: 100 - i,
      currency: 'EUR', unit: 'currency', start: years[i].slice(0, 4) + '-01-01', end: years[i] }] });
  const raw = { meta: { ticker: 'TEST', reportingCurrency: 'USD', reportingCurrencyOriginal: 'EUR', fxConverted: true, fxRateApplied: 0.5 },
    annual: { [field]: [30, 29, 28].map(n => ({ value: n * 0.5 })), [field + 'Ends']: years.slice(0, 3) } };
  const apply = s => F.applyFinancialCases(s, { table }).snapshot;
  assert.deepEqual(apply(raw).annual[field].map(value), [50, 49.5, 49]);
  const filename = path.resolve(__dirname, '../lib/export-provenance.js'), realRequire = createRequire(filename);
  const provenance = new Module(filename, module); provenance.filename = filename; provenance.paths = module.paths;
  provenance.require = id => id === '../configs/financial-known-cases.json' ? table : realRequire(id);
  provenance._compile(fs.readFileSync(filename, 'utf8'), filename);
  const evidence = provenance.exports.captureSnapshot(apply(raw)).annualCorrections;
  assert.deepEqual(evidence.map(r => r.normalizedValue), [50, 49.5, 49]);
  assert.ok(evidence.every(r => r.sourceType === 'handTable' && r.metricDefinition ===
    (field === 'annualOpInc' ? 'Operating income' : 'Net income')));
  for (const gap of [null, { value: null }]) {
    const s = structuredClone(raw); s.annual[field][1] = gap;
    assert.deepEqual(apply(s).annual[field].map(value), [50, null, null]);
  }
  for (const edit of [
    s => { s.annual[field][0].value++; },
    s => { s.annual[field][0].unit = 'million'; },
    s => { s.annual[field + 'Ends'][1] = years[0]; },
    s => { s.meta.reportingCurrencyOriginal = 'GBP'; },
  ]) {
    const s = structuredClone(raw); edit(s); const out = apply(s);
    assert.ok(out.annual[field].every(row => value(row) === null));
    assert.deepEqual(apply(out), out);
    assert.ok(preserveReloadHistory(out, raw).annual[field].every(row => value(row) === null));
  }
  const badSource = structuredClone(table); badSource.cases[0].sources[0].currency = 'USD';
  assert.throws(() => F.validateTable(badSource), /Invalid annual replacement/);
});

test('all nine corrected annual cells have export evidence, without broadening verification claims', () => {
  const out = F.applyFinancialCases(hl(true)).snapshot, captured = P.captureSnapshot(out);
  assert.equal(captured.annualCorrections.length, 9);
  const row = { ticker: 'HL', marketCap: 1, revGrowthYoYPct: captured.leg.pct, revGrowthBasis: captured.leg.basis,
    revGrowthPeriodEnd: captured.leg.periodEnd, revGrowthPriorPeriodEnd: captured.leg.priorPeriodEnd };
  const files = [{ rows: [row] }];
  const manifest = P.buildProvenance(files, { runId: 'p177', generatedAt: '2026-10-10T18:00:00Z',
    creator: { engine: 'test', model: null, sessionId: 'p177-test' }, snapshotFor: () => captured });
  assert.equal(P.validateProvenance(files, manifest), true);
  const records = manifest.records.filter(r => r.correctionCaseId?.startsWith('hl-'));
  assert.equal(records.length, 9);
  assert.deepEqual([...new Set(records.map(r => r.metricDefinition))].sort(), ['Gross profit', 'Operating income', 'Revenue']);
  for (const r of records) assert.ok(r.quote && r.documentUrl && r.retrievedAt && r.correctionRevision === '2026-10-11-p177');
  assert.deepEqual(Object.keys(row.provenance).sort(), ['marketCap', 'revGrowthYoYPct']);
});

test('unrelated issuers are identical and break-once catches removal of the shared annual extension', () => {
  const other = hl(false, 'UNRELATED'); assert.equal(F.applyFinancialCases(other).snapshot, other);
  const anchor = "const annual = new Set(['annualRev', 'annualGP', 'annualOpInc', 'annualNetIncome']);";
  // The table validator must reject production cases if the annual mechanism is removed.
  assert.throws(() => mutant(anchor, "const annual = new Set(['annualRev', 'annualGP']);"), /Invalid or duplicate financial case/);
  const recovery = "      row = correction.originalVendorRow;";
  assert.throws(() => annualGuard(mutant(recovery, '      row = stored;')), assert.AssertionError);
  assert.deepEqual(hashes(), initialHashes, 'live SHA-256 unchanged before and after memory-only red probes');
});
