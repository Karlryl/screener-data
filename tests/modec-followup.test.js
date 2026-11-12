'use strict';
// P148 part 2 (22.10.2026): MODEC (6269.T) vendor quarters are JPY conversions, not the issuer's USD figures, so the revenue
// series carries an explicit all-null coverage row. Without it the next vendor quarter (30.09.2026, first issuer report
// 10.11.2026) would show again as an unverified quarterly revenue. This test only reads files; fault injection targets
// in-memory tables. Red without the coverage row in configs/financial-known-cases.json, green with it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = process.env.MODEC_TEST_ROOT || path.resolve(__dirname, '..');
const {applyFinancialCases, validateTable, financialReasons, table, MISSING_REASONS} = require(path.join(root,'lib/financial-known-cases.js'));
const {prepareSnapshot} = require(path.join(root,'lib/yahoo-q4-known-cases.js'));
const {revGrowthLeg} = require(path.join(root,'lib/rev-growth-basis.js'));
const raw = require(path.join(root,'tests/fixtures/financial-known-cases.json')).snapshots['6269.T'];
const value = row => typeof row === 'number' ? row : row?.value;
const coverage = {ticker:'6269.T', field:'revenueQ', coversThrough:'2026-06-30'};
const files = ['configs/financial-known-cases.json','lib/financial-known-cases.js','tests/fixtures/financial-known-cases.json'];
const hashes = () => files.map(f=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex'));
const before = hashes();
const addQuarter = (period, amount = 240000000000 * raw.meta.fxRateApplied) => {
  const s = structuredClone(raw);
  s.timeseries.revenueQ.unshift({value:amount});
  s.timeseries.revenueQEnds.unshift(period);
  return s;
};

test('MODEC alone adds explicit all-null series authority', () => {
  assert.deepEqual(table.coverage.filter(c=>c.ticker==='6269.T'),[coverage]);
  const own = table.cases.filter(c=>c.ticker==='6269.T');
  assert.equal(own.length,4);
  assert.ok(own.every(c=>c.field==='revenueQ'&&c.replacementValue===null));
  assert.doesNotThrow(()=>validateTable(structuredClone(table)));
  const absent = structuredClone(table);
  absent.coverage = absent.coverage.filter(c=>c.ticker!=='6269.T');
  assert.doesNotThrow(()=>validateTable(absent),'all-null cases MAY carry coverage; they do not require it');
  const invalid = structuredClone(table);
  invalid.coverage.find(c=>c.ticker==='6269.T').coversThrough = '2026-09-30';
  assert.throws(()=>validateTable(invalid),/Invalid financial coverage/);
});

test('next and later vendor quarters stay empty through the real loader', () => {
  for(const period of ['2026-09-30','2026-12-31','2027-03-31','2028-09-30']) {
    const s = require(path.join(root,'tests/helpers/dated-series.js')).withEnds(addQuarter(period)), original = JSON.stringify(s);
    const out = prepareSnapshot(s,{atPull:true});
    assert.equal(value(out.timeseries.revenueQ[0]),null,period);
    assert.equal(out.timeseries.revenueQ[0].financialMissing.reasonCode,'period-after-coverage');
    assert.equal(out.timeseries.revenueQ[0].financialMissing.originalVendorRow.value,1524632400);
    assert.ok(out.timeseries.revenueQ.every(r=>value(r)===null));
    assert.ok(financialReasons(out).some(t=>t.startsWith(MISSING_REASONS['period-after-coverage'])));
    assert.deepEqual(out.annual,s.annual);
    assert.equal(revGrowthLeg(out).basis,'year');
    assert.ok(Math.abs(revGrowthLeg(out).pct - (4581232 / 4186461 - 1)*100)<1e-10);
    assert.equal(JSON.stringify(s),original);
    assert.deepEqual(prepareSnapshot(out,{atPull:true}),out,'idempotent on held rows');
  }
});

test('a rolling window with no old cases remaining is still covered', () => {
  const s=addQuarter('2027-09-30');
  s.timeseries.revenueQ=[{value:1},{value:2}];
  s.timeseries.revenueQEnds=['2027-09-30','2027-06-30'];
  assert.deepEqual(applyFinancialCases(s).snapshot.timeseries.revenueQ.map(value),[null,null]);
});

test('older unverified quarters are explicitly withheld, while four named holds and annuals stay intact', () => {
  const s=structuredClone(raw);
  s.timeseries.revenueQ.push({value:111},{value:222});
  s.timeseries.revenueQEnds.push('2025-06-30','2024-12-31');
  const out=applyFinancialCases(s).snapshot;
  assert.ok(out.timeseries.revenueQ.every(r=>value(r)===null));
  assert.ok(out.timeseries.revenueQ.slice(4).every(r=>r.financialMissing.reasonCode==='period-not-verified'));
  assert.ok(out.timeseries.revenueQ.slice(0,4).every(r=>r.financialCorrection?.caseId));
  assert.deepEqual(out.annual,s.annual);
  assert.deepEqual(out.timeseries.grossProfitQ,s.timeseries.grossProfitQ);
});

test('unlisted series and genuine reported zeros remain statements', () => {
  const s=addQuarter('2026-09-30',0);
  s.meta.ticker='P148_TEST_UNLISTED';
  assert.deepEqual(applyFinancialCases(s),{snapshot:s,events:[]});
  assert.equal(value(applyFinancialCases(s).snapshot.timeseries.revenueQ[0]),0);
  // A source-verified zero is eligible even in this covered series. No value is coerced to zero.
  const approved=structuredClone(table);
  const zero=addQuarter('2026-09-30',0);
  approved.cases.push({caseId:'p148-test-confirmed-zero',ticker:'6269.T',field:'revenueQ',period:'2026-09-30',
    periodType:'3M',currency:'JPY',expectedBadValue:0,replacementValue:0,
    reason:'Quartalsumsatz bestätigt: Die künstliche Testquelle meldet null Yen.',
    sources:[{url:'https://example.org/p148-test-fixture',page:'synthetic test only',quote:'Revenue 0',value:0,end:'2026-09-30'}]});
  approved.coverage=approved.coverage.filter(c=>c.ticker!=='6269.T');
  approved.coverage.push({...coverage,coversThrough:'2026-09-30'});
  assert.equal(value(applyFinancialCases(zero,{table:approved}).snapshot.timeseries.revenueQ[0]),0);
});

test('removing MODEC coverage reproduces the bug without altering files', () => {
  const noCoverage=structuredClone(table);
  noCoverage.coverage=noCoverage.coverage.filter(c=>c.ticker!=='6269.T');
  const s=addQuarter('2026-09-30');
  const guard=cfg=>assert.equal(value(applyFinancialCases(s,{table:cfg}).snapshot.timeseries.revenueQ[0]),null);
  assert.throws(()=>guard(noCoverage),assert.AssertionError);
  guard(table);
  assert.deepEqual(hashes(),before);
});

test('changed currency or missing dates do not release unverified MODEC values', () => {
  const usd=addQuarter('2026-09-30');
  usd.meta.reportingCurrencyOriginal='USD'; usd.meta.fxRateApplied=1;
  assert.equal(value(applyFinancialCases(usd).snapshot.timeseries.revenueQ[0]),null);
  const undated=addQuarter('2026-09-30');
  undated.timeseries.revenueQEnds[0]=null;
  assert.equal(value(applyFinancialCases(undated).snapshot.timeseries.revenueQ[0]),null);
  assert.deepEqual(hashes(),before);
});
