'use strict';
// Hand table 24.10.2026, third revenue lane (sd-umsatzreihen-3): INFRAC.SW Infracore annual operating income.
// - The vendor stores an operating loss for FY2025 and FY2024 (-6,040 and -6,818 thousand CHF), which lit the
//   "unprofit" lamp and the "nicht-profitabel" tier. The consolidated income statement of the Annual Report 2025
//   (PDF page 28, in thousands of CHF) shows "EBIT 76'248 59'031" (after depreciation, before financial result and
//   taxes); both years are corrected to that line. The EBIT includes the revaluation result of the investment
//   properties (16,160 and 5,384 thousand CHF); the reason text says so, because whether an operating result of a
//   real-estate company should include revaluation is an open method question.
// - FY2023 has no issuer report on infracore.ch: the existing no-gap rule withholds it (older year without a case).
// - The CMOC 2026-09-30 quarter of the original brief is not in the table: the vendor has not delivered that quarter
//   yet, and the table has no form for a quarter whose vendor value does not exist (method question, Codex).
// Real vendor cells of the run 39918190374 (data day 23.10.2026), embedded below. Every red probe changes an
// in-memory table copy only; live files are hashed before and after.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { applyFinancialCases, financialReasons, validateTable, table } = require('../lib/financial-known-cases.js');
const { profitTierOf } = require('../src/scoring/profit-tier.js');
const { unprofit, opIncYahooAdjusted } = require('../src/scoring/lamps.js');
const root = path.resolve(__dirname, '..');
const live = ['configs/financial-known-cases.json', 'lib/financial-known-cases.js'];
const liveHashes = () => live.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'));
const beforeHashes = liveHashes();
const REV = '2026-10-24-sdumsatz3';
const SNAP = {"meta":{"ticker":"INFRAC.SW","name":"Infracore SA","country":"Switzerland","exchangeName":"Swiss","reportingCurrency":"USD","reportingCurrencyOriginal":"CHF","tradingCurrency":"CHF","tradingCurrencyAssumed":false,"_ccyMissingCompletely":false,"ccyAmbiguous":false,"fxRateApplied":1.2179971,"fxConverted":true,"fetchedAt":"2026-10-22T08:06:34.451Z","opIncSource":"yahoo-adjusted"},"timeseries":{"revenueQ":[{"value":2435.9942},{"value":2435.9942}],"revenueQEnds":["2026-03-31","2025-03-31"],"grossProfitQ":[null,null],"grossProfitQEnds":["2026-03-31","2025-03-31"],"opIncQ":[{"value":-1738081.8617},{"value":-1897639.4818000002}],"opIncQEnds":["2026-03-31","2025-03-31"]},"annual":{"annualRev":[{"value":29231.9304},{"value":9743.9768},{"value":24359.942000000003}],"annualRevEnds":["2025-12-31","2024-12-31","2023-12-31"],"annualOpInc":[{"value":-7356702.484},{"value":-8304304.2278},{"value":-5823244.135100001}],"annualOpIncEnds":["2025-12-31","2024-12-31","2023-12-31"],"annualNetIncome":[{"value":67911864.3047},{"value":41036758.2932},{"value":42369247.1206}],"annualNetIncomeEnds":["2025-12-31","2024-12-31","2023-12-31"]}};
const FX = SNAP.meta.fxRateApplied;
const value = row => typeof row === 'number' ? row : row?.value ?? null;
const apply = cfg => applyFinancialCases(structuredClone(SNAP), cfg && { table: cfg }).snapshot;
const native = rows => rows.map(r => value(r) === null ? null : Math.round(value(r) / FX));
const ids = ['infrac.sw-2025-12-31-annualOpInc-20261024', 'infrac.sw-2024-12-31-annualOpInc-20261024'];
const caseOf = id => table.cases.find(c => c.caseId === id);
/** Table copy without this lane's rows: the state of origin/main before the change. */
function before() {
  const copy = structuredClone(table);
  copy.cases = copy.cases.filter(c => c.revision !== REV);
  return validateTable(copy);
}

test('the two cases of this lane are in the table, appended last, sourced and traced to the quoted EBIT line', () => {
  const own = table.cases.filter(c => c.revision === REV);
  assert.deepEqual(own.map(c => c.caseId), ids);
  // Only the 48 rows of lane sd-triage-handtabelle (24.10.2026) the 70 of lane sec-abgleich and the 35 of lane sec-abgleich-ausland (30.10.2026) follow these two.
  const at = table.cases.findIndex(c => c.caseId === ids[0]);
  assert.deepEqual(table.cases.slice(at, at + 2).map(c => c.caseId), ids, 'appended after every earlier case');
  assert.deepEqual(table.cases.slice(at + 2).map(c => c.revision), [...Array(48).fill('2026-10-24-sdtriage'), ...Array(70).fill('2026-10-30-secabgleich'), ...Array(35).fill('2026-10-30-sdz1'), ...Array(35).fill('2026-10-30-secabgleich-ausland'), ...Array(24).fill('2026-10-30-sdz2'), '2026-10-30-pr49', ...Array(2).fill('2026-10-30-jio-quarter-r4')], 'only the triage, SEC comparison and board-top rows follow');
  assert.equal(table.coverage.some(v => v.ticker === 'INFRAC.SW'), false, 'no quarterly coverage for INFRAC.SW');
  assert.equal(table.cases.some(c => c.ticker === '603993.SS' && c.period === '2026-09-30'), false, 'no CMOC Q3 2026 case');
  // [period, vendor value, EBIT, revaluation result] in CHF; the annual report states thousands of CHF.
  const want = [['2025-12-31', -6040000, 76248000, 16160000], ['2024-12-31', -6818000, 59031000, 5384000]];
  own.forEach((c, k) => {
    const [period, bad, ebit, reval] = want[k];
    assert.deepEqual([c.ticker, c.field, c.period, c.periodType, c.index, c.currency, c.unit], ['INFRAC.SW', 'annualOpInc', period, '12M', k, 'CHF', 'currency']);
    assert.deepEqual([c.expectedBadValue, c.replacementValue], [bad, ebit]);
    assert.equal(c.sources.length, 1);
    const s = c.sources[0];
    assert.match(s.url, /^https:\/\/www\.infracore\.ch\/.+Infracore_Annual_Report_2025\.pdf$/);
    assert.equal(s.quote, 'EBIT 76’248 59’031');
    assert.equal(s.sourceUnit, 'CHF thousands');
    assert.deepEqual(s.quote.match(/\d+’\d{3}/g).map(x => Number(x.replace('’', '')) * 1000), [76248000, 59031000]);
    assert.deepEqual([s.value, s.start, s.end, s.currency, s.unit], [ebit, `${period.slice(0, 4)}-01-01`, period, 'CHF', 'currency']);
    assert.ok(s.page.startsWith('PDF 28') && s.published && s.verifiedAt === '2026-10-24', c.caseId);
    // Rule #27: the reason names its period; the method question (revaluation inside EBIT) stays visible.
    const de = period.split('-').reverse().join('.');
    assert.ok(c.reason.includes(`(Ende ${de})`), c.caseId);
    assert.ok(c.reason.includes('Neubewertung der Liegenschaften von ' + (reval / 1e6).toFixed(1).replace('.', ',') + ' Mio. CHF'), c.caseId);
    assert.ok(c.reason.includes('ohne ihn wären es ' + ((ebit - reval) / 1e6).toFixed(1).replace('.', ',') + ' Mio. CHF'), c.caseId);
    assert.doesNotMatch(c.reason, / [–—-] /, 'no dash as punctuation');
  });
});

test('before (origin/main): the vendor loss is shown, the unprofit and Yahoo lamps burn, the tier is nicht-profitabel', () => {
  const out = apply(before());
  assert.deepEqual(native(out.annual.annualOpInc), [-6040000, -6818000, -4781000]);
  assert.equal(unprofit(out), true);
  assert.equal(opIncYahooAdjusted(out), true);
  assert.equal(profitTierOf(out), 'nicht-profitabel');
});

test('after: FY2025 and FY2024 show the EBIT of the annual report, FY2023 is withheld, lamps and tier follow', () => {
  const r = applyFinancialCases(structuredClone(SNAP)), out = r.snapshot, rows = out.annual.annualOpInc;
  assert.deepEqual(native(rows), [76248000, 59031000, null]);
  assert.deepEqual(rows.slice(0, 2).map(x => x.financialCorrection.caseId), ids);
  assert.deepEqual(rows.slice(0, 2).map(x => value(x.financialCorrection.originalVendorRow)), SNAP.annual.annualOpInc.slice(0, 2).map(value));
  // T2: the withheld year is an empty cell with a marker, never a substitute 0.
  assert.equal(rows[2].value, null);
  assert.equal(rows[2].financialMissing.reasonCode, 'annual-older-than-cases');
  assert.equal(value(rows[2].financialMissing.originalVendorRow), value(SNAP.annual.annualOpInc[2]));
  const reasons = financialReasons(out);
  for (const id of ids) assert.ok(reasons.includes(caseOf(id).reason), id);
  assert.ok(reasons.some(x => x.startsWith('Jahreswert fehlt: älteres Jahr ohne geprüften Fall') && x.endsWith('Das betrifft die Periode mit Ende 31.12.2023.')));
  assert.deepEqual(r.events.filter(e => e.field === 'annualOpInc').map(e => [e.period, e.status]),
    [['2025-12-31', 'corrected'], ['2024-12-31', 'corrected'], ['2023-12-31', 'missing']]);
  assert.equal(unprofit(out), false);
  assert.equal(opIncYahooAdjusted(out), false, 'every shown operating-income year is an issuer value');
  assert.equal(profitTierOf(out), 'seit-kurzem-profitabel', 'two positive years, fewer than four');
  // The other series are exactly as origin/main leaves them (quarters withheld, revenue years corrected).
  const old = apply(before());
  for (const box of ['timeseries', 'meta']) assert.deepEqual(out[box], old[box], box);
  for (const field of ['annualRev', 'annualRevEnds', 'annualOpIncEnds', 'annualNetIncome', 'annualNetIncomeEnds']) assert.deepEqual(out.annual[field], old.annual[field], field);
  assert.equal(JSON.stringify(applyFinancialCases(out).snapshot), JSON.stringify(out), 'idempotent');
  const other = structuredClone(SNAP); other.meta.ticker = 'UNLISTED';
  assert.equal(applyFinancialCases(other).snapshot, other, 'another ticker is untouched');
});

test('break-once on test data: without these rows, or with a mismatching expectedBadValue, no corrected value and no loss is shown', () => {
  const guard = cfg => {
    const out = apply(cfg);
    assert.equal(value(out.annual.annualOpInc[0]), 76248000 * FX);
    assert.equal(unprofit(out), false);
  };
  guard();
  assert.throws(() => guard(before()), assert.AssertionError);
  // A changed vendor year never takes the correction and never shows the vendor value: the series is withheld.
  const wrong = structuredClone(table);
  wrong.cases.find(c => c.caseId === ids[0]).expectedBadValue = -6040001;
  const rows = apply(validateTable(wrong)).annual.annualOpInc;
  assert.deepEqual(rows.map(value), [null, null, null]);
  assert.equal(rows[0].financialMissing.reasonCode, 'vendor-value-changed');
  assert.throws(() => guard(validateTable(wrong)), assert.AssertionError);
  // A quote typo in the replacement value is refused when the table loads.
  const typo = structuredClone(table);
  typo.cases.find(c => c.caseId === ids[1]).replacementValue = 59031001;
  assert.throws(() => validateTable(typo), /Replacement matches no source value|Invalid annual replacement/);
  assert.deepEqual(liveHashes(), beforeHashes, 'live files unchanged');
});
