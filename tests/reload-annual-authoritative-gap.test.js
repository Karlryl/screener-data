'use strict';

// Memory-only red probes. Never target a writing test or change a live file.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { Module } = require('node:module');
const { applyFinancialCases } = require('../lib/financial-known-cases.js');
const { historyIsThinner, preserveReloadHistory } = require('../lib/reload-history.js');
const { fixture } = require('./annual-financial-replacements.test.js');
const file = path.resolve(__dirname, '../lib/reload-history.js');
const digest = () => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const before = digest(), source = fs.readFileSync(file, 'utf8');
const anchor = '        periods(next, group, field), periods(prior, group, field), true);';
const oldLine = "        periods(next, group, field), periods(prior, group, field), group === 'timeseries');";
const lines = source.split(/\r?\n/);
assert.equal(lines.filter(line => line === anchor).length, 1, 'exact whole-line mutation anchor');
const oldModule = new Module(file, module); oldModule.filename = file; oldModule.paths = module.paths;
oldModule._compile(lines.map(line => line === anchor ? oldLine : line).join('\n'), file);
const oldThinner = oldModule.exports.historyIsThinner;
const value = row => typeof row === 'number' ? row : row?.value;

// Same embedded frozen values as tests/p106-nonadjacent-annual-withhold.test.js (run 37439518589).
const p106 = [
  ['OBM.AX', 'AUD', 0.69439626, ['2026-06-30', '2024-06-30', '2023-06-30', '2022-06-30'],
    [560724285.55374, 148764677.15736, 94360118.97888, 107118261.46386]],
  ['CMM.AX', 'AUD', 0.69439626, ['2026-06-30', '2024-06-30', '2023-06-30', '2022-06-30'],
    [493966417.90986, 249793083.42102, 222725517.20622, 199255618.01448]],
  ['3391.T', 'JPY', 0.0063445335, ['2026-02-28', '2024-05-31', '2023-05-31', '2022-05-31'],
    [9203285127.0975, 6518767078.977, 6154698713.1465, 5809689325.95]],
].map(([ticker, currency, fx, ends, stored]) => ({
  meta:{ ticker, reportingCurrency:'USD', reportingCurrencyOriginal:currency, fxRateApplied:fx, fxConverted:true },
  annual:{ annualRev:stored.map(value => ({ value })), annualRevEnds:ends },
  timeseries:{ revenueQ:[], revenueQEnds:[] },
}));
let passed = 0, red = 0;
for (const prior of [...p106, fixture(), fixture('INDOMIM.NS')]) {
  // Supply comparable provenance, so preservation would refill an ordinary hole.
  prior.meta.fetchedAt = '2026-10-06T00:00:00Z';
  prior.meta.statementPeriods = Object.fromEntries(Object.entries(prior.annual)
    .filter(([field, rows]) => Array.isArray(rows) && !/Ends$/.test(field))
    .map(([field]) => [field, (prior.annual[field + 'Ends'] || []).map(end => ({ end, duration:'12M',
      currency:prior.meta.reportingCurrencyOriginal, unit:'currency', basis:'reported', fetchedAt:prior.meta.fetchedAt }))]));
  const saved = structuredClone(prior), next = applyFinancialCases(prior).snapshot;
  assert.deepEqual(prior, saved, 'overlay does not mutate raw input');
  assert.equal(historyIsThinner(next, prior), false, prior.meta.ticker + ': hand-table annual gaps accepted');
  assert.equal(oldThinner(next, prior), true, prior.meta.ticker + ': old line demonstrably refuses the same gaps'); red++;
  const kept = preserveReloadHistory(structuredClone(next), prior);
  assert.deepEqual(kept.annual, next.annual, 'every withheld currency and balance cell stays withheld');
  assert.deepEqual(prior, saved, 'preservation does not mutate prior input');
  const plain = structuredClone(prior); plain.annual.annualRev[1] = null;
  assert.equal(historyIsThinner(plain, prior), true, 'L10: plain dated null remains a loss');
  assert.equal(value(preserveReloadHistory(structuredClone(plain), prior).annual.annualRev[1]),
    value(prior.annual.annualRev[1]), 'negative control: comparable unmarked hole can be refilled');
  console.log(`${prior.meta.ticker}: old=true, current=false; plain-null=true; withheld cells preserved`);
  passed++;
}
assert.equal(digest(), before, 'live reload module unchanged by memory-only probes');
console.log(`reload-annual-authoritative-gap: ${passed} passed; ${red} old-line red probes; live hash unchanged`);
