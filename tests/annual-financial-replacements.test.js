'use strict';

// Break-once probes use only memory objects, never a writing test or a live data file.
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { applyFinancialCases, validateTable, table } = require('../lib/financial-known-cases.js');
const value = x => typeof x === 'number' ? x : x?.value;
const clone = structuredClone;
const files = ['lib/financial-known-cases.js', 'configs/financial-known-cases.json'];
const hashes = () => files.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', f))).digest('hex'));
const beforeHashes = hashes();
const cases = table.cases.filter(c => c.ticker === 'INDOMIM.BO');
const expected = [41410560000, 32784690000, 28404910000, 26653210000];
const fx = 0.010384216;
function fixture(ticker = 'INDOMIM.BO', factor = fx) {
  return { meta: { ticker, source: 'yahoo', reportingCurrency: factor === 1 ? 'INR' : 'USD',
    reportingCurrencyOriginal: 'INR', fxConverted: factor !== 1, fxRateApplied: factor },
    annual: { annualRev: expected.map(n => ({ value: n / 10 * factor })),
      annualRevEnds: ['2026-03-31', '2025-03-31', '2024-03-31', '2023-03-31'],
      annualGP: [{ value: 25008670.84036 }] }, timeseries: {} };
}
let passed = 0, breaks = 0;
function test(name, fn) { fn(); passed++; console.log('ok ' + name); }
function guard(snapshot, factor = fx) {
  assert.deepEqual(snapshot.annual.annualRev.map(value), expected.map(n => n * factor), 'vendor values must never return');
}
test('four exact, sourced annual cases with both listings and no annual coverage', () => {
  assert.equal(cases.length, 4);
  assert.deepEqual(cases.map(c => c.replacementValue), expected);
  assert.deepEqual(cases.map(c => c.expectedBadValue), expected.map(n => n / 10));
  for (const [i,c] of cases.entries()) {
    assert.equal(c.period, fixture().annual.annualRevEnds[i]);
    assert.equal(c.unit, 'currency'); assert.equal(c.currency, 'INR');
    assert.equal(c.sources[0].page, i < 2 ? 253 : 284);
    assert.equal(c.sources[0].value, expected[i]); assert.equal(c.sources[0].end, c.period);
    assert.deepEqual(c.listingAliases, ['INDOMIM.NS']);
  }
  assert.ok(!table.coverage.some(c => c.ticker === 'INDOMIM.BO'));
});
test('native and USD-converted inputs, both listings, unchanged input and second pass', () => {
  for (const ticker of ['INDOMIM.BO','INDOMIM.NS']) for (const factor of [1,fx]) {
    const raw = fixture(ticker,factor), before = clone(raw);
    const result = applyFinancialCases(raw); guard(result.snapshot,factor);
    assert.deepEqual(raw,before); assert.deepEqual(result.snapshot.annual.annualGP,raw.annual.annualGP);
    assert.equal(result.events.filter(e => e.status === 'corrected').length,4);
    for (const [i,row] of result.snapshot.annual.annualRev.entries()) {
      assert.equal(row.financialCorrection.caseId,cases[i].caseId);
      assert.equal(row.financialCorrection.replacementNativeValue,expected[i]);
      assert.equal(row.financialCorrection.nativeCurrency,'INR');
      assert.deepEqual(row.financialCorrection.sources,cases[i].sources);
    }
    assert.deepEqual(applyFinancialCases(result.snapshot).snapshot,result.snapshot);
  }
});
test('already correct vendor values pass unchanged, unrelated ticker and older correct year stay unchanged', () => {
  const raw = fixture(); raw.meta.ticker = 'OTHER'; assert.equal(applyFinancialCases(raw).snapshot,raw);
  const correct = fixture(); correct.annual.annualRev = expected.map(n => ({value:n*fx}));
  assert.equal(applyFinancialCases(correct).snapshot,correct);
  const extra = fixture(); extra.annual.annualRev.push({value:123}); extra.annual.annualRevEnds.push('2022-03-31');
  assert.deepEqual(applyFinancialCases(extra).snapshot.annual.annualRev[4],{value:123});
  const newer = fixture(); newer.annual.annualRev.unshift({value:777}); newer.annual.annualRevEnds.unshift('2027-03-31');
  const shifted = applyFinancialCases(newer).snapshot;
  assert.equal(shifted.annual.annualRev[0].value,777);
  assert.deepEqual(shifted.annual.annualRev.slice(1).map(value),expected.map(n=>n*fx));
});
test('currency, unit, source, duplicate date, missing date and vendor drift fail closed per cell', () => {
  for (const change of [
    s=>{s.meta.reportingCurrencyOriginal='EUR';},
    s=>{s.annual.annualRev[0].currency='INR';},
    s=>{s.annual.annualRev[0].unit='million';},
    s=>{s.annual.annualRev[0].multiplier=1000000;},
    s=>{s.annual.annualRev[0].source='SEC';},
    s=>{s.annual.annualRev[0].periodType='3M';},
    s=>{s.annual.annualRevEnds[1]='2026-03-31';},
    s=>{delete s.annual.annualRevEnds;},
    s=>{s.annual.annualRev[0].value+=1;}
  ]) {
    const raw=fixture(); change(raw); const saved=clone(raw); const r=applyFinancialCases(raw);
    assert.equal(value(r.snapshot.annual.annualRev[0]),null);
    assert.ok(r.events.some(e=>e.status==='stale' && e.container==='annual'));
    assert.deepEqual(raw,saved);
    assert.deepEqual(applyFinancialCases(r.snapshot).snapshot,r.snapshot);
  }
  // P99 merge condition: a withheld newest year withholds every older year too (no comparison across the hole).
  const drift=fixture(); drift.annual.annualRev[0].value++;
  assert.deepEqual(applyFinancialCases(drift).snapshot.annual.annualRev.map(value),[null,null,null,null]);
});
test('P99 lock 1: a withheld middle year withholds every older year; newer corrected year stays; idempotent', () => {
  const { revAcceleration } = require('../src/scoring/axes.js');
  const raw=fixture(); raw.annual.annualRev[1].value+=1; // FY2025 vendor value drifted -> held
  const r=applyFinancialCases(raw), rows=r.snapshot.annual.annualRev;
  assert.deepEqual(rows.map(value),[expected[0]*fx,null,null,null]);
  assert.equal(rows[1].financialMissing.reasonCode,'vendor-value-changed');
  assert.deepEqual(rows.slice(2).map(x=>x.financialMissing.reasonCode),['annual-older-than-withheld','annual-older-than-withheld']);
  assert.deepEqual(rows.slice(2).map(x=>x.financialMissing.caseId),[cases[2].caseId,cases[3].caseId]);
  assert.deepEqual(applyFinancialCases(r.snapshot).snapshot,r.snapshot,'second pass is idempotent');
  // The annual fallback of revAcceleration() needs three present years; it must not pair FY2026 with FY2024.
  assert.equal(revAcceleration({ ...r.snapshot, timeseries:{} }, null),null);
  // Break once: without the lock the older years stay present and the fallback compares across the hole.
  const unlocked=clone(rows); unlocked[2]={value:expected[2]*fx}; unlocked[3]={value:expected[3]*fx};
  assert.notEqual(revAcceleration({ ...r.snapshot, annual:{ ...r.snapshot.annual, annualRev:unlocked }, timeseries:{} }, null),null); breaks++;
});
test('P99 lock 2: reload never refills a withheld annual hand-table hole, not even with an earlier corrected value', () => {
  const { preserveReloadHistory } = require('../lib/reload-history.js');
  const period = (end, fetchedAt) => ({ end, duration:'12M', currency:'INR', unit:'currency', basis:'reported', fetchedAt });
  const ends=fixture().annual.annualRevEnds;
  const previous=applyFinancialCases(fixture()).snapshot; // stored, fully corrected
  previous.meta={ ...previous.meta, fetchedAt:'2026-10-01T00:00:00Z', statementPeriods:{ annualRev: ends.map(e=>period(e,'2026-10-01T00:00:00Z')) } };
  const raw=fixture(); raw.annual.annualRev[1].value+=1;
  const next=applyFinancialCases(raw).snapshot; // FY2025 and older withheld
  next.meta={ ...next.meta, fetchedAt:'2026-10-06T00:00:00Z', statementPeriods:{ annualRev: ends.map(e=>period(e,'2026-10-06T00:00:00Z')) } };
  const kept=preserveReloadHistory(clone(next), previous);
  assert.deepEqual(kept.annual.annualRev.map(value),[expected[0]*fx,null,null,null],'withheld years stay withheld');
  // Break once: an unmarked hole IS refilled, so the protection comes from the hand-table marker.
  const plain=clone(next); for (const i of [1,2,3]) plain.annual.annualRev[i]=null;
  assert.notEqual(value(preserveReloadHistory(plain, previous).annual.annualRev[1]),null); breaks++;
});
test('source period, amount, currency, unit and zero replacement are rejected at load time', () => {
  for(const change of [
    c=>{c.replacementValue=0;}, c=>{c.unit='million';}, c=>{c.sources[0].currency='USD';},
    c=>{c.sources[0].unit='million';}, c=>{delete c.sources[0].value;},
    c=>{c.sources[0].value+=1;}, c=>{c.sources[0].end='2025-03-31';},
    c=>{c.sources[0].start='2024-04-01';}, c=>{delete c.sources[0].end;}, c=>{c.sources[0].start='2026-04-01';}
    ,c=>{c.sources[0].start='2026-01-01';},c=>{c.sources[0].start='2026-03-31';}
  ]) {
    const config=clone(table); change(config.cases.find(c=>c.caseId===cases[0].caseId));
    assert.throws(()=>validateTable(config), /Invalid annual replacement|Replacement matches no source/);
  }
});
test('undated annual values fail closed even with invalid FX or a changed vendor value', () => {
  for (const change of [s=>{s.meta.fxConversionFailed=true;},s=>{s.annual.annualRev[0].value++;}]) {
    const raw=fixture(); delete raw.annual.annualRevEnds; change(raw);
    const result=applyFinancialCases(raw);
    assert.deepEqual(result.snapshot.annual.annualRev.map(value),[null,null,null,null]);
    assert.ok(result.events.every(e=>e.status==='stale' && e.reasonCode==='period-undated'));
    assert.deepEqual(applyFinancialCases(result.snapshot).snapshot,result.snapshot);
  }
});
test('break once: every old 10x-small vendor value makes the output guard red', () => {
  const good=applyFinancialCases(fixture()).snapshot; guard(good);
  for(let i=0;i<4;i++) {
    const bad=clone(good); bad.annual.annualRev[i].value=expected[i]/10*fx;
    assert.throws(()=>guard(bad),assert.AssertionError); breaks++;
    const config=clone(table); config.cases=config.cases.filter(c=>c.caseId!==cases[i].caseId);
    assert.throws(()=>guard(applyFinancialCases(fixture(),{table:config}).snapshot),assert.AssertionError); breaks++;
  }
  guard(applyFinancialCases(fixture()).snapshot);
});
test('break once: currency and zero invalid tables fail; clean table still loads', () => {
  for (const change of [c=>{c.sources[0].currency='USD';},c=>{c.replacementValue=0;}]) {
    const bad=clone(table); change(bad.cases.find(c=>c.caseId===cases[0].caseId));
    assert.throws(()=>validateTable(bad),/Invalid annual replacement/); breaks++;
  }
  assert.equal(validateTable(table),table);
});
assert.deepEqual(hashes(),beforeHashes,'live library and table hashes unchanged by memory-only break probes');
console.log(`annual-financial-replacements: ${passed} passed; ${breaks} red probes caught; live hashes unchanged`);
