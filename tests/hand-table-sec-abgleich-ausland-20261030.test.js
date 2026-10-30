'use strict';
// Hand table 30.10.2026, lane sec-abgleich-ausland: three foreign SEC filers whose vendor figures disagree with the
// printed filing. AAUC: the vendor income statement has FY2025 and FY2024 swapped (cash flow and balance sheet do not).
// SGML: annual revenue and net income are Canadian dollars labelled USD; the issuer changed to USD with the FY2025
// report, so 2023 and older exist in CAD only and are withheld. NMR: revenue fits net revenue in two of four years,
// the quarters are net of brokerage commissions, operating income is vendor margin times vendor revenue.
// Real vendor packets of run 41027769596 sit in the fixture. Every red probe changes an in-memory table copy only.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { applyFinancialCases, financialReasons, validateTable, table } = require('../lib/financial-known-cases.js');
const { g31Shadow } = require('../lib/g31-recency.js');
const fixture = require('./fixtures/financial-known-cases.json').snapshots;
const control = require('./fixtures/hand-table-sec-abgleich-20261030.json').AAPL;

const root = path.resolve(__dirname, '..');
const live = ['configs/financial-known-cases.json', 'lib/financial-known-cases.js'];
const liveHashes = () => live.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'));
const beforeHashes = liveHashes();
const REV = '2026-10-30-secabgleich-ausland';
const FIRMS = ['AAUC', 'SGML', 'NMR'];
const FX = 0.0063340846; // fxRateApplied of the NMR packet
const value = row => (row && typeof row === 'object' ? row.value ?? null : row ?? null);
const series = (s, c, f) => (s[c][f] || []).map(value);
const apply = (t, cfg) => applyFinancialCases(structuredClone(fixture[t]), cfg && { table: cfg }).snapshot;
const without = () => { const c = structuredClone(table); c.cases = c.cases.filter(x => x.revision !== REV); c.coverage = c.coverage.filter(v => v.ticker !== 'NMR'); return validateTable(c); };
const growth = s => g31Shadow(s).v1;
const yen = v => v.map(x => (x === null ? null : Math.round(x / FX / 1e6)));

test('35 rows of this lane, appended last, one coverage row, every source complete, table valid', () => {
  const own = table.cases.filter(c => c.revision === REV);
  assert.equal(own.length, 35);
  const at = table.cases.findIndex(c => c.revision === REV);
  assert.deepEqual(table.cases.slice(at).map(c => c.revision), [...Array(35).fill(REV), '2026-10-30-pr49', ...Array(2).fill('2026-10-30-jio-quarter-r4')], 'only the rows of PR #49 follow');
  assert.deepEqual([...new Set(own.map(c => c.ticker))].sort(), [...FIRMS].sort());
  assert.deepEqual(table.coverage.filter(v => FIRMS.includes(v.ticker)), [{ ticker: 'NMR', field: 'revenueQ', coversThrough: '2026-09-30' }]);
  for (const c of own) {
    for (const s of c.sources) {
      assert.match(s.url, /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/\d+\//, c.caseId);
      for (const k of ['accession', 'filed', 'page', 'quote', 'start', 'end', 'currency', 'unit']) assert.ok(s[k], `${c.caseId} ${k}`);
      assert.ok(Number.isFinite(s.value), c.caseId);
      assert.ok(s.filed <= '2026-10-30', c.caseId);
    }
    if (c.replacementValue === c.expectedBadValue) assert.match(c.reason, /^bestätigt:/, c.caseId);
    else assert.doesNotMatch(c.reason, /bestätigt:/, c.caseId);
    assert.doesNotMatch(c.reason, /\s[–—-]\s/, 'no dash as punctuation: ' + c.caseId);
    // Each vendor cell the row names is the cell of the real packet, with the exact product of native value and factor.
    const box = c.periodType === '12M' ? 'annual' : 'timeseries';
    const cell = fixture[c.ticker][box][c.field][fixture[c.ticker][box][c.field + 'Ends'].indexOf(c.period)];
    assert.equal(value(cell), c.expectedBadValue * (c.ticker === 'NMR' ? FX : 1), c.caseId);
  }
  assert.equal(validateTable(structuredClone(table)).cases.length, table.cases.length);
});

test('the quotes print the replacement values', () => {
  const k = (id, n) => { const c = table.cases.find(x => x.caseId === id); assert.ok(c, id); assert.ok(c.sources.some(s => s.quote.includes(n)), id + ' ' + JSON.stringify(c.sources.map(s => s.quote))); };
  k('aauc-2025-12-31-annualRev-20261030', '1,331,824');
  k('aauc-2024-12-31-annualRev-20261030', '730,382');
  k('aauc-2025-12-31-annualGP-20261030', '506,542');
  k('aauc-2025-12-31-annualNetIncome-20261030', '(51,847)');
  k('sgml-2025-12-31-annualRev-20261030', '110,012');
  k('sgml-2024-12-31-annualRev-20261030', '151,352');
  k('sgml-2025-12-31-annualNetIncome-20261030', '(50,185 )');
  k('nmr-2025-03-31-annualRev-20261030', '1,892,485');
  k('nmr-2024-03-31-annualRev-20261030', '1,562,000');
  k('nmr-2025-03-31-annualNetIncome-20261030', '340,736');
  k('nmr-2026-09-30-revenueQ-20261030', '607,476');
});

test('Allied Gold: all four income lines in filed order, the error is back without these rows', () => {
  const s = apply('AAUC');
  assert.deepEqual(series(s, 'annual', 'annualRev'), [1331824000, 730382000, 655691000, 669551000]);
  assert.deepEqual(series(s, 'annual', 'annualGP'), [506542000, 220234000, 106790000, 129403000]);
  assert.deepEqual(series(s, 'annual', 'annualNetIncome'), [-51847000, -115632000, -208482000, -7421000]);
  assert.deepEqual(series(s, 'annual', 'annualOpInc'), [null, null, null, null], 'no operating income line in the report');
  assert.deepEqual(series(s, 'timeseries', 'revenueQ'), series(fixture.AAUC, 'timeseries', 'revenueQ'), 'quarters confirmed against the MD&A, unchanged');
  assert.deepEqual(series(s, 'annual', 'annualOCF'), series(fixture.AAUC, 'annual', 'annualOCF'), 'the cash flow lines were never swapped');
  const old = apply('AAUC', without());
  assert.deepEqual(series(old, 'annual', 'annualRev').slice(0, 2), [730382000, 1331824000]);
  assert.ok(Math.abs(growth(old).bonusComponents[0] - (730382 / 1331824 - 1)) < 1e-12);
  assert.ok(Math.abs(growth(s).bonusComponents[0] - (1331824 / 730382 - 1)) < 1e-12);
  assert.ok(Math.abs(growth(s).pct - 45.37) < 0.01, 'the shown quarter stays');
});

test('Sigma Lithium: USD for 2025 and 2024, the Canadian dollar years withheld, quarters untouched', () => {
  const s = apply('SGML');
  assert.deepEqual(series(s, 'annual', 'annualRev'), [110012000, 151352000, null, null]);
  assert.deepEqual(series(s, 'annual', 'annualNetIncome'), [-50185000, -51396000, null, null]);
  for (const f of ['revenueQ', 'grossProfitQ', 'opIncQ']) assert.deepEqual(series(s, 'timeseries', f), series(fixture.SGML, 'timeseries', f), f);
  assert.ok(financialReasons(s).some(r => /kanadischen Dollar/.test(r)));
  const old = apply('SGML', without());
  assert.deepEqual(series(old, 'annual', 'annualRev'), [152611950, 208747000, 181231000, 0]);
  // The vendor year 2025 is the filed figure times one factor on both lines (1.387; the filing prints CAD 1.40 average, 1.37 year end).
  assert.ok(Math.abs(152611950 / 110012000 - 69618140 / 50185000) < 1e-5);
});

test('Nomura: yen values through the fx factor, net revenue in every year and quarter, synthetic operating income withheld', () => {
  const s = apply('NMR');
  assert.deepEqual(yen(series(s, 'annual', 'annualRev')), [2167713, 1892485, 1562000, 1335577]);
  assert.deepEqual(yen(series(s, 'annual', 'annualNetIncome')), [362129, 340736, 165863, 92786]);
  assert.deepEqual(series(s, 'annual', 'annualOpInc'), [null, null, null, null]);
  assert.deepEqual(yen(series(s, 'timeseries', 'revenueQ')), [607476, 686714, 577181, 551755, 515462]);
  assert.ok(s.annual.annualRev[0].financialCorrection === undefined, 'a confirmed cell carries no correction marker');
  assert.equal(s.annual.annualRev[1].financialCorrection.nativeCurrency, 'JPY');
  assert.equal(s.annual.annualRev[1].financialCorrection.replacementNativeValue, 1892485e6);
  assert.equal(value(s.annual.annualRev[1]), 1892485e6 * FX, 'native value times factor, exact');
  const old = apply('NMR', without());
  const was = growth(old), now = growth(s);
  assert.ok(Math.abs(was.bonusComponents[0] - 2.2566) < 0.001, 'the annual growth of 225.7 % sits in the bonus without these rows');
  assert.ok(Math.abs(now.bonusComponents[0] - 0.1454) < 0.001);
  assert.ok(Math.abs(was.pct - 14.71) < 0.01 && Math.abs(now.pct - 17.85) < 0.01, `${was.pct} ${now.pct}`);
  assert.equal(now.basis, 'quarter');
  // The filing says "increasing 18 percent year on year" for the same quarter.
  assert.equal(Math.round(now.pct), 18);
});

test('another fx rate on a later run keeps the yen cells valid; a new vendor quarter or year is withheld', () => {
  // A later pull multiplies the same native values with another rate: the comparison follows the packet's own factor.
  const rate = 0.0071;
  const s = structuredClone(fixture.NMR);
  s.meta.fxRateApplied = rate;
  for (const [box, f] of [['annual', 'annualRev'], ['annual', 'annualNetIncome'], ['timeseries', 'revenueQ']]) {
    s[box][f] = s[box][f].map(r => (value(r) === null ? r : { ...r, value: Math.round(value(r) / FX / 1e6) * 1e6 * rate }));
  }
  const after = applyFinancialCases(s).snapshot;
  assert.equal(value(after.annual.annualRev[1]), 1892485e6 * rate);
  assert.equal(value(after.timeseries.revenueQ[0]), 607476e6 * rate);
  // The next quarter is not verified: withheld with the coverage code, growth falls back to the newest pair with both quarters from the filing (PR #49).
  const next = structuredClone(fixture.NMR), ts = next.timeseries;
  ts.revenueQ = [{ value: 3e9 }, ...ts.revenueQ]; ts.revenueQEnds = ['2026-12-31', ...ts.revenueQEnds];
  const held = applyFinancialCases(next).snapshot;
  assert.equal(value(held.timeseries.revenueQ[0]), null);
  assert.equal(held.timeseries.revenueQ[0].financialMissing.reasonCode, 'period-after-coverage');
  const leg = growth(held);
  assert.equal(leg.basis, 'quarter');
  assert.equal(leg.sourcePeriodEnd, '2026-09-30');
  assert.ok(Math.abs(leg.pct - 17.85) < 0.01, String(leg.pct));
  // A new vendor year in front of a replaced series: the whole series goes empty until it is checked (no mixed scale).
  const fresh = structuredClone(fixture.AAUC);
  fresh.annual.annualRev = [{ value: 2e9 }, ...fresh.annual.annualRev]; fresh.annual.annualRevEnds = ['2026-12-31', ...fresh.annual.annualRevEnds];
  assert.deepEqual(series(applyFinancialCases(fresh).snapshot, 'annual', 'annualRev'), [null, null, null, null, null]);
});

test('absence: another listing and untouched firms stay as they are', () => {
  const other = structuredClone(fixture.AAUC); other.meta.ticker = 'UNLISTED';
  assert.equal(applyFinancialCases(other).snapshot, other);
  const c = structuredClone(control);
  assert.equal(JSON.stringify(applyFinancialCases(c).snapshot.annual), JSON.stringify(control.annual));
  assert.equal(JSON.stringify(applyFinancialCases(c).snapshot.timeseries), JSON.stringify(control.timeseries));
});

test('a second pass over an already prepared packet changes nothing', () => {
  for (const t of FIRMS) {
    const once = apply(t), twice = applyFinancialCases(structuredClone(once)).snapshot;
    for (const box of ['annual', 'timeseries']) for (const f of ['annualRev', 'annualGP', 'annualOpInc', 'annualNetIncome', 'revenueQ']) {
      if (once[box][f]) assert.deepEqual(series(twice, box, f), series(once, box, f), `${t} ${f}`);
    }
  }
});

test('break once on the table copy: a dropped or drifted row turns the checks red', () => {
  const drop = structuredClone(table);
  drop.cases = drop.cases.filter(c => !(c.ticker === 'AAUC' && c.field === 'annualRev'));
  assert.deepEqual(series(apply('AAUC', drop), 'annual', 'annualRev').slice(0, 2), [730382000, 1331824000], 'without the rows the swap is back');
  const drift = structuredClone(table);
  drift.cases.find(c => c.caseId === 'sgml-2025-12-31-annualRev-20261030').expectedBadValue += 1;
  assert.equal(value(apply('SGML', drift).annual.annualRev[0]), null, 'a changed vendor value is withheld, never overwritten blindly');
  // An inexact yen product counts as a changed cell: the cell is withheld, it never shows the replacement.
  const off = structuredClone(table);
  off.cases.find(c => c.caseId === 'nmr-2026-09-30-revenueQ-20261030').expectedBadValue += 1e6;
  assert.equal(value(apply('NMR', off).timeseries.revenueQ[0]), null);
  const held = structuredClone(table);
  held.cases.find(c => c.caseId === 'nmr-2026-03-31-annualOpInc-20261030').expectedBadValue += 1;
  assert.deepEqual(series(apply('NMR', held), 'annual', 'annualOpInc'), [null, null, null, null], 'a drifted hold withholds the whole series');
  const bad = structuredClone(table);
  bad.cases.find(c => c.caseId === 'nmr-2025-03-31-annualRev-20261030').replacementValue = 1892485000001;
  assert.throws(() => validateTable(bad), /Replacement matches no source value/);
  const wrongCurrency = structuredClone(table);
  wrongCurrency.cases.find(c => c.caseId === 'sgml-2024-12-31-annualRev-20261030').sources[0].currency = 'CAD';
  assert.throws(() => validateTable(wrongCurrency), /Invalid annual replacement source/);
});

test('live files unchanged by this test file', () => {
  assert.deepEqual(liveHashes(), beforeHashes);
});
