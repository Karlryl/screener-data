'use strict';

// Break-once probes use only memory objects, never a writing test or a live data file.
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { Module } = require('node:module');
const { applyFinancialCases, validateTable, table: liveTable } = require('../lib/financial-known-cases.js');
const value = x => typeof x === 'number' ? x : x?.value;
const clone = structuredClone;
const files = ['lib/financial-known-cases.js', 'configs/financial-known-cases.json'];
const hashes = () => files.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', f))).digest('hex'));
const beforeHashes = hashes();
// Entirely synthetic authority, never added to the live hand table.
const expected = [48000000, 36000000, 24000000, 18000000];
const fx = 0.5;
/** Build test-only annual authority in an independent hand-table clone.
 * @param {object} base Live hand table to clone without changing any real case.
 * @returns {object} Hand table with synthetic annual replacement cases.
 */
function fixtureTable(base = liveTable) {
  const config = clone(base);
  config.cases.push(...expected.map((replacementValue, index) => {
    const year = 2026 - index, period = year + '-12-31';
    return { caseId: 'anntest-' + period + '-annualRev', revision: 'synthetic-p50',
      ticker: 'ANNTEST.X', listingAliases: ['ANNTEST.Y'], field: 'annualRev', period, periodType: '12M', index,
      currency: 'EUR', unit: 'currency', expectedBadValue: replacementValue / 4, replacementValue,
      reason: 'Jahresumsatz korrigiert: künstlicher Testwert mit Testquelle.',
      sources: [{ url: 'https://example.invalid/annual-test/' + year, page: index + 1,
        quote: 'Synthetic annual revenue ' + replacementValue, value: replacementValue,
        start: year + '-01-01', end: period, currency: 'EUR', unit: 'currency' }] };
  }));
  return config;
}
const table = fixtureTable();
const cases = table.cases.filter(c => c.ticker === 'ANNTEST.X');
/** Build an entirely synthetic annual snapshot.
 * @param {string} ticker Primary test ticker or its test-only alias.
 * @param {number} factor One for native EUR, otherwise the test USD conversion factor.
 * @returns {object} Independent test snapshot.
 */
function fixture(ticker = 'ANNTEST.X', factor = fx) {
  return { meta: { ticker, source: 'yahoo', reportingCurrency: factor === 1 ? 'EUR' : 'USD',
    reportingCurrencyOriginal: 'EUR', fxConverted: factor !== 1, fxRateApplied: factor },
    annual: { annualRev: expected.map(n => ({ value: n / 4 * factor })),
      annualRevEnds: ['2026-12-31', '2025-12-31', '2024-12-31', '2023-12-31'],
      annualGP: [{ value: 7500000 }], annualShares: [101, 100, 99, 98], annualSharesBasic: [100, 99, 98, 97] }, timeseries: {} };
}
let passed = 0, breaks = 0;
function test(name, fn) { fn(); passed++; console.log('ok ' + name); }
function guard(snapshot, factor = fx) {
  assert.deepEqual(snapshot.annual.annualRev.map(value), expected.map(n => n * factor), 'vendor values must never return');
}
if (require.main === module) {
test('four exact, sourced annual cases with both listings and no annual coverage', () => {
  assert.equal(cases.length, 4);
  assert.deepEqual(cases.map(c => c.replacementValue), expected);
  assert.deepEqual(cases.map(c => c.expectedBadValue), expected.map(n => n / 4));
  for (const [i,c] of cases.entries()) {
    assert.equal(c.period, fixture().annual.annualRevEnds[i]);
    assert.equal(c.unit, 'currency'); assert.equal(c.currency, 'EUR');
    assert.equal(c.sources[0].page, i + 1);
    assert.equal(c.sources[0].url, 'https://example.invalid/annual-test/' + (2026 - i));
    assert.equal(c.sources[0].quote, 'Synthetic annual revenue ' + expected[i]);
    assert.equal(c.sources[0].value, expected[i]); assert.equal(c.sources[0].end, c.period);
    assert.deepEqual(c.listingAliases, ['ANNTEST.Y']);
  }
  assert.ok(!table.coverage.some(c => c.ticker === 'ANNTEST.X'));
});
test('native and USD-converted inputs, both listings, unchanged input and second pass', () => {
  for (const ticker of ['ANNTEST.X','ANNTEST.Y']) for (const factor of [1,fx]) {
    const raw = fixture(ticker,factor), before = clone(raw);
    const result = applyFinancialCases(raw, { table }); guard(result.snapshot,factor);
    assert.deepEqual(raw,before); assert.deepEqual(result.snapshot.annual.annualGP,raw.annual.annualGP);
    for (const field of ['annualShares', 'annualSharesBasic', ...Object.keys(raw.annual).filter(f => /Ends$/.test(f))]) {
      assert.deepEqual(result.snapshot.annual[field], raw.annual[field], field + ' unchanged');
    }
    assert.deepEqual(result.snapshot.meta, raw.meta);
    assert.deepEqual(result.snapshot.timeseries, raw.timeseries);
    assert.equal(result.events.filter(e => e.status === 'corrected').length,4);
    for (const [i,row] of result.snapshot.annual.annualRev.entries()) {
      assert.equal(row.financialCorrection.caseId,cases[i].caseId);
      assert.equal(row.financialCorrection.replacementNativeValue,expected[i]);
      assert.equal(row.financialCorrection.nativeCurrency,'EUR');
      assert.deepEqual(row.financialCorrection.sources,cases[i].sources);
    }
    assert.deepEqual(applyFinancialCases(result.snapshot, { table }).snapshot,result.snapshot);
    assert.deepEqual(applyFinancialCases(result.snapshot, { table }).events, [], 'no events on a second pass');
  }
});
test('already correct vendor values pass unchanged, unrelated ticker and older correct year stay unchanged', () => {
  const raw = fixture(); raw.meta.ticker = 'OTHER'; assert.equal(applyFinancialCases(raw, { table }).snapshot,raw);
  const correct = fixture(); correct.annual.annualRev = expected.map(n => ({value:n*fx}));
  assert.equal(applyFinancialCases(correct, { table }).snapshot,correct);
  // Review P50 round 2: an uncovered older year is not shown in an unverified scale next to replaced years.
  const extra = fixture(); extra.annual.annualRev.push({value:123}); extra.annual.annualRevEnds.push('2022-12-31');
  const older = applyFinancialCases(extra, { table }).snapshot.annual.annualRev;
  assert.deepEqual(older.map(value),[...expected.map(n=>n*fx),null]);
  assert.equal(older[4].financialMissing.reasonCode,'annual-older-than-cases');
  assert.deepEqual(applyFinancialCases(applyFinancialCases(extra, { table }).snapshot, { table }).snapshot,applyFinancialCases(extra, { table }).snapshot);
});
test('review P50 round 2: a new vendor year in front or inserted withholds the whole series with a reason', () => {
  for (const [label, edit] of [
    ['new year in front', s=>{ s.annual.annualRev.unshift({value:s.annual.annualRev[0].value*1.2}); s.annual.annualRevEnds.unshift('2027-12-31'); }],
    ['inserted year', s=>{ s.annual.annualRev.splice(1,0,{value:999}); s.annual.annualRevEnds.splice(1,0,'2025-09-30'); }],
  ]) {
    const raw=fixture(); edit(raw); const r=applyFinancialCases(raw, { table }), rows=r.snapshot.annual.annualRev;
    assert.deepEqual(rows.map(value),rows.map(()=>null),label+': series empty');
    assert.ok(rows.every(x=>x.financialMissing.reasonCode==='annual-value-changed'),label+': reason');
    assert.ok(r.events.some(e=>e.reasonCode==='annual-value-changed' && e.period===raw.annual.annualRevEnds[label==='inserted year'?1:0]),label+': event for the new year');
    assert.deepEqual(applyFinancialCases(r.snapshot, { table }).snapshot,r.snapshot,label+': idempotent');
  }
});
test('currency, unit, source, duplicate date, missing date and vendor drift fail closed per cell', () => {
  for (const change of [
    s=>{s.meta.reportingCurrencyOriginal='GBP';},
    s=>{s.annual.annualRev[0].currency='EUR';},
    s=>{s.annual.annualRev[0].unit='million';},
    s=>{s.annual.annualRev[0].multiplier=1000000;},
    s=>{s.annual.annualRev[0].source='SEC';},
    s=>{s.annual.annualRev[0].periodType='3M';},
    s=>{s.annual.annualRevEnds[1]='2026-12-31';},
    s=>{delete s.annual.annualRevEnds;},
    s=>{s.annual.annualRev[0].value+=1;}
  ]) {
    const raw=fixture(); change(raw); const saved=clone(raw); const r=applyFinancialCases(raw, { table });
    assert.equal(value(r.snapshot.annual.annualRev[0]),null);
    assert.ok(r.events.some(e=>e.status==='stale' && e.container==='annual'));
    assert.deepEqual(raw,saved);
    assert.deepEqual(applyFinancialCases(r.snapshot, { table }).snapshot,r.snapshot);
  }
  // P99 merge condition: a withheld newest year withholds every older year too (no comparison across the hole).
  const drift=fixture(); drift.annual.annualRev[0].value++;
  assert.deepEqual(applyFinancialCases(drift, { table }).snapshot.annual.annualRev.map(value),[null,null,null,null]);
});
test('P99 lock 1: a withheld middle year withholds every older year; newer corrected year stays; idempotent', () => {
  const { revAcceleration } = require('../src/scoring/axes.js');
  const raw=fixture(); raw.annual.annualRev[1].value+=1; // FY2025 vendor value drifted -> held
  const r=applyFinancialCases(raw, { table }), rows=r.snapshot.annual.annualRev;
  assert.deepEqual(rows.map(value),[expected[0]*fx,null,null,null]);
  assert.equal(rows[1].financialMissing.reasonCode,'vendor-value-changed');
  assert.deepEqual(rows.slice(2).map(x=>x.financialMissing.reasonCode),['annual-older-than-withheld','annual-older-than-withheld']);
  assert.deepEqual(rows.slice(2).map(x=>x.financialMissing.caseId),[cases[2].caseId,cases[3].caseId]);
  assert.deepEqual(applyFinancialCases(r.snapshot, { table }).snapshot,r.snapshot,'second pass is idempotent');
  // The annual fallback of revAcceleration() needs three present years; it must not pair FY2026 with FY2024.
  assert.equal(revAcceleration({ ...r.snapshot, timeseries:{} }, null),null);
  // Break once: without the lock the older years stay present and the fallback compares across the hole.
  const unlocked=clone(rows); unlocked[2]={value:expected[2]*fx}; unlocked[3]={value:expected[3]*fx};
  assert.notEqual(revAcceleration({ ...r.snapshot, annual:{ ...r.snapshot.annual, annualRev:unlocked }, timeseries:{} }, null),null); breaks++;
});
test('vendor already delivers the correct value for one year', () => {
  const { revAcceleration } = require('../src/scoring/axes.js');
  const check = apply => {
    for (const correctIndex of [0, 1, 2, 3]) for (const factor of [1, fx]) {
      const raw = fixture('ANNTEST.X', factor);
      raw.annual.annualRev[correctIndex].value = expected[correctIndex] * factor;
      const saved = clone(raw), good = apply(raw, { table }).snapshot;
      guard(good, factor);
      assert.ok(good.annual.annualRev.every(row => !row.financialMissing), 'no gaps or missing markers');
      assert.equal(JSON.stringify(apply(good, { table }).snapshot), JSON.stringify(good), 'correct packet is byte-identical on reread');
      assert.deepEqual(raw, saved, 'correct packet is not mutated');

      const driftIndex = correctIndex === 1 ? 2 : 1;
      raw.annual.annualRev[driftIndex].value += 1;
      const before = clone(raw), held = apply(raw, { table }).snapshot, rows = held.annual.annualRev;
      assert.deepEqual(rows.map(value), expected.map((n, i) => i < driftIndex ? n * factor : null));
      assert.equal(rows[driftIndex].financialMissing.reasonCode, 'vendor-value-changed');
      for (const row of rows.slice(driftIndex + 1)) assert.equal(row.financialMissing.reasonCode, 'annual-older-than-withheld');
      assert.ok(rows.slice(0, driftIndex).every(row => !row.financialMissing), 'newer years stay present');
      assert.equal(revAcceleration(held, null), null, 'no comparison across the withheld year');
      assert.equal(JSON.stringify(apply(held, { table }).snapshot), JSON.stringify(held), 'withheld packet is byte-identical on reread');
      assert.deepEqual(raw, before, 'drift packet is not mutated');
    }
  };
  check(applyFinancialCases);
  const file = path.resolve(__dirname, '../lib/financial-known-cases.js');
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const anchor = line => {
    assert.equal(lines.filter(x => x === line).length, 1, 'exact whole-line mutation anchor');
    return lines.indexOf(line);
  };
  const start = anchor('  // This numeric annual no-gap lock must stay last: no annual cell may change before return.');
  const end = anchor('  return { snapshot: out, events };');
  const beforeCases = anchor('  for (const c of config.cases.filter(c => (allowed.has(c.field) || annual.has(c.field) && c.replacementValue !== null) && listed(c, ticker))) {');
  assert.ok(beforeCases < start && start < end, 'lock follows the case loop and ends immediately before return');
  const lock = lines.splice(start, end - start);
  lines.splice(beforeCases, 0, ...lock);
  const moved = new Module(file, module); moved.filename = file; moved.paths = module.paths;
  moved._compile(lines.join('\n'), file);
  assert.throws(() => check(moved.exports.applyFinancialCases), assert.AssertionError, 'moving the lock before cases makes this test red'); breaks++;
  check(applyFinancialCases);
});
test('numeric cases never refill a prior null-annual hold, including whole-series drift', () => {
  const { revAcceleration } = require('../src/scoring/axes.js');
  const mixed = clone(table), hold = mixed.cases.find(c => c.caseId === cases[1].caseId);
  hold.replacementValue = null;
  const check = apply => {
    for (const drift of [false, true]) {
      const raw = fixture(); if (drift) raw.annual.annualRev[1].value += 1;
      const saved = clone(raw), out = apply(raw, { table: mixed }).snapshot;
      assert.deepEqual(out.annual.annualRev.map(value), [drift ? null : expected[0] * fx, null, null, null]);
      if (drift) assert.ok(out.annual.annualRev.every(row => row.financialMissing.reasonCode === 'annual-value-changed'));
      else {
        assert.equal(out.annual.annualRev[1].financialCorrection.caseId, hold.caseId);
        for (const row of out.annual.annualRev.slice(2)) assert.equal(row.financialMissing.reasonCode, 'annual-older-than-withheld');
      }
      assert.equal(revAcceleration(out, null), null);
      assert.equal(JSON.stringify(apply(out, { table: mixed }).snapshot), JSON.stringify(out), 'mixed authority is idempotent');
      const revised = clone(mixed); revised.revision = 'synthetic-next-revision';
      assert.equal(JSON.stringify(apply(out, { table: revised }).snapshot), JSON.stringify(out), 'revision changes cannot release another annual hold');
      assert.deepEqual(raw, saved);
    }
  };
  check(applyFinancialCases);
  const file = path.resolve(__dirname, '../lib/financial-known-cases.js'), lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const anchor = "    if (container === 'annual' && current?.financialMissing && (current !== stored || !holdIds.includes(current.financialMissing.caseId))) continue;";
  assert.equal(lines.filter(line => line === anchor).length, 1, 'exact whole-line mutation anchor');
  const unguarded = new Module(file, module); unguarded.filename = file; unguarded.paths = module.paths;
  unguarded._compile(lines.map(line => line === anchor ? '' : line).join('\n'), file);
  assert.throws(() => check(unguarded.exports.applyFinancialCases), assert.AssertionError); breaks++;
  check(applyFinancialCases);
});
test('review D15 H1: a stored state stays withheld after a table revision change (both drift variants)', () => {
  const { revAcceleration } = require('../src/scoring/axes.js');
  const next = clone(table); next.revision = '2026-10-07a';
  for (const [i, want] of [[1,[expected[0]*fx,null,null,null]], [0,[null,null,null,null]]]) {
    const raw=fixture(); raw.annual.annualRev[i].value+=1;
    const stored=applyFinancialCases(raw, { table }).snapshot;                 // persisted with the old revision
    const again=applyFinancialCases(stored,{table:next}).snapshot;  // read later with a new revision
    assert.deepEqual(again.annual.annualRev.map(value),want,'drift at '+i+': withheld years stay withheld');
    assert.equal(revAcceleration({ ...again, timeseries:{} }, null),null);
  }
});
test('P99 lock 2: reload never refills a withheld annual hand-table hole, not even with an earlier corrected value', () => {
  const { preserveReloadHistory } = require('../lib/reload-history.js');
  const period = (end, fetchedAt) => ({ end, duration:'12M', currency:'EUR', unit:'currency', basis:'reported', fetchedAt });
  const ends=fixture().annual.annualRevEnds;
  const previous=applyFinancialCases(fixture(), { table }).snapshot; // stored, fully corrected
  previous.meta={ ...previous.meta, fetchedAt:'2026-10-01T00:00:00Z', statementPeriods:{ annualRev: ends.map(e=>period(e,'2026-10-01T00:00:00Z')) } };
  const raw=fixture(); raw.annual.annualRev[1].value+=1;
  const next=applyFinancialCases(raw, { table }).snapshot; // FY2025 and older withheld
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
    c=>{c.sources[0].value+=1;}, c=>{c.sources[0].end='2025-12-31';},
    c=>{c.sources[0].start='2024-01-01';}, c=>{delete c.sources[0].end;}, c=>{c.sources[0].start='2027-01-01';}
    ,c=>{c.sources[0].start='2026-10-01';},c=>{c.sources[0].start='2026-12-31';}
  ]) {
    const config=clone(table); change(config.cases.find(c=>c.caseId===cases[0].caseId));
    assert.throws(()=>validateTable(config), /Invalid annual replacement|Replacement matches no source/);
  }
});
test('undated annual values fail closed even with invalid FX or a changed vendor value', () => {
  for (const change of [s=>{s.meta.fxConversionFailed=true;},s=>{s.annual.annualRev[0].value++;}]) {
    const raw=fixture(); delete raw.annual.annualRevEnds; change(raw);
    const result=applyFinancialCases(raw, { table });
    assert.deepEqual(result.snapshot.annual.annualRev.map(value),[null,null,null,null]);
    assert.ok(result.events.every(e=>e.status==='stale' && e.reasonCode==='period-undated'));
    assert.deepEqual(applyFinancialCases(result.snapshot, { table }).snapshot,result.snapshot);
  }
});
test('break once: every old 4x-small vendor value makes the output guard red', () => {
  const good=applyFinancialCases(fixture(), { table }).snapshot; guard(good);
  for(let i=0;i<4;i++) {
    const bad=clone(good); bad.annual.annualRev[i].value=expected[i]/4*fx;
    assert.throws(()=>guard(bad),assert.AssertionError); breaks++;
    const config=clone(table); config.cases=config.cases.filter(c=>c.caseId!==cases[i].caseId);
    assert.throws(()=>guard(applyFinancialCases(fixture(),{table:config}).snapshot),assert.AssertionError); breaks++;
  }
  guard(applyFinancialCases(fixture(), { table }).snapshot);
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
}
module.exports = { fixture, fixtureTable };
