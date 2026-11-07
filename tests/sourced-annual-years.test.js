'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');
const { validateTable, resolveSourcedAnnualYear: resolve, prepareSourcedAnnualYear: prepare } = require('../lib/sourced-annual-years.js');
const table = require('../configs/sourced-annual-years.json');
const fixtures = require('./fixtures/sourced-annual-years.json');
const axes = require('../src/scoring/axes.js');
const previousDay = process.env.RUN_DATE_UTC;
process.env.RUN_DATE_UTC = '2026-10-31';
let count = 0;
const test = (name, fn) => { fn(); count++; console.log('PASS ' + name); };
const fixture = () => structuredClone(fixtures['9992.HK']);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sourceFile = path.resolve(__dirname, '../src/scoring/axes.js'), source = fs.readFileSync(sourceFile, 'utf8');
const beforeHash = hash(sourceFile);
function compile(text) {
  const m = new Module(sourceFile, module); m.filename = sourceFile; m.paths = Module._nodeModulePaths(path.dirname(sourceFile));
  m._compile(text, sourceFile); return m.exports;
}
try {
  test('two readings agree, exact source coverage and distinct listing authority', () => {
    validateTable(table);
    const broken = structuredClone(table); broken.records[0].readings[1].values.revenue++;
    assert.throws(() => validateTable(broken), /disagree/);
    const noQuote = structuredClone(table); delete noQuote.records[0].readings[0].sources[0].quote;
    assert.throws(() => validateTable(noQuote), /source/);
    const duplicate = structuredClone(table); duplicate.records[0].listingAliases.push(duplicate.records[1].ticker);
    assert.throws(() => validateTable(duplicate), /Duplicate/);
  });
  test('all six real 31 October packets match both native priors and own FX rate', () => {
    assert.equal(Object.keys(fixtures).length, 6);
    for (const s of Object.values(fixtures)) assert.equal(resolve(s).status, 'available', s.meta.ticker);
  });
  test('Pop Mart: exact new GP growth and rolled three-year margin tilt', () => {
    const s = fixture(), r = table.records.find(x => x.ticker === '9992.HK');
    close(axes.gpGrowth(s), r.grossProfit / r.priorGrossProfit - 1 + r.grossProfit / r.revenue - 2654543 / 4617324);
    close(axes.revAcceleration(s), r.revenue / r.priorRevenue - 13037749 / 6301002);
    assert.equal(prepare(s).annual, s.annual);
    assert.equal(prepare(s).timeseries, s.timeseries);
    assert.equal(prepare(s).meta.annualRevNewerYear, s.meta.annualRevNewerYear);
    assert.equal(s.meta.sourcedAnnualYear, undefined);
    assert.equal(prepare(s).meta.sourcedAnnualYear.status, 'available');
  });
  test('no currency mixing: convert with the snapshot rate or reject ambiguity/unit changes', () => {
    for (const change of [s => { s.meta.reportingCurrencyOriginal = 'HKD'; }, s => { s.meta.fxRateApplied = 0; },
      s => { s.meta.ccyAmbiguous = true; }, s => { s.annual.annualGP[0].currency = 'CNY'; },
      s => { s.meta.statementPeriods.annualRev[0].duration = '3M'; }]) {
      const s = fixture(); change(s); assert.notEqual(resolve(s).status, 'available');
    }
    const s = fixture(), f = s.meta.fxRateApplied;
    for (const key of ['annualRev', 'annualGP']) for (const row of s.annual[key]) row.value /= f;
    s.meta.fxConverted = false; s.meta.reportingCurrency = 'CNY';
    assert.equal(resolve(s).status, 'available'); close(axes.gpGrowth(s), axes.gpGrowth(fixture()));
    const converted = fixture();
    for (const key of ['annualRev', 'annualGP']) for (const row of converted.annual[key]) row.value *= 1.1;
    converted.meta.fxRateApplied *= 1.1;
    assert.equal(resolve(converted).status, 'available'); close(axes.revAcceleration(converted), axes.revAcceleration(fixture()));
  });
  test('both fingerprint priors required; zeros and holes are not skipped', () => {
    for (const key of ['annualRev', 'annualGP']) for (const value of [0, null, 12345]) {
      const s = fixture(); s.annual[key][0] = value;
      assert.equal(resolve(s).status, 'prior-mismatch');
    }
    const s = fixture(); s.annual.annualRev[1] = null;
    assert.equal(axes.revAcceleration(s), null);
    s.annual.annualRev[1] = { value: 1 }; s.annual.annualRevEnds[1] = '2022-12-31';
    assert.equal(axes.revAcceleration(s), null);
  });
  test('newer year anchor, publication date, review expiry and own period gate', () => {
    const s = fixture(); s.annual.annualGPEnds[0] = '2024-09-30';
    assert.equal(resolve(s).status, 'period-mismatch');
    process.env.RUN_DATE_UTC = '2026-03-24'; assert.equal(resolve(fixture()).status, 'not-public');
    process.env.RUN_DATE_UTC = '2026-12-05'; assert.equal(resolve(fixture()).status, 'review-expired');
    const custom = structuredClone(table); custom.records[0].reviewBy = '2028-01-01';
    process.env.RUN_DATE_UTC = '2027-07-04'; assert.equal(resolve(fixture(), custom).status, 'available'); // 550 days
    process.env.RUN_DATE_UTC = '2027-07-05'; assert.equal(resolve(fixture(), custom).status, 'stale');
    process.env.RUN_DATE_UTC = '2026-10-31';
  });
  test('vendor catch-up retires even partial updates, with no double count', () => {
    for (const key of ['annualRev', 'annualGP']) {
      const s = fixture(); s.annual[key + 'Ends'][0] = '2025-12-31';
      assert.equal(resolve(s).status, 'vendor-caught-up');
    }
    const s = fixture(), r = table.records[0], f = s.meta.fxRateApplied;
    for (const [key, v] of [['annualRev', r.revenue], ['annualGP', r.grossProfit]]) {
      s.annual[key].unshift({ value: v * f }); s.annual[key + 'Ends'].unshift(r.end);
      s.annual[key].pop(); s.annual[key + 'Ends'].pop(); // Vendor keeps the same rolling window length.
    }
    assert.equal(resolve(s).status, 'vendor-caught-up');
    close(axes.gpGrowth(s), axes.gpGrowth(fixture())); close(axes.revAcceleration(s), axes.revAcceleration(fixture()));
  });
  test('fresh quarterly acceleration takes precedence; stale pairs use sourced annual fallback', () => {
    const s = fixture();
    s.timeseries = { revenueQ: [150, 120, 80, 80], revenueQEnds: ['2026-06-30', '2026-03-31', '2025-06-30', '2025-03-31'] };
    close(axes.revAcceleration(s), 150 / 80 - 120 / 80);
    s.timeseries.revenueQEnds = ['2024-06-30', '2024-03-31', '2023-06-30', '2023-03-31'];
    close(axes.revAcceleration(s), axes.revAcceleration(fixture()));
  });
  test('in-memory break-once: both real axes lose the sourced year, other axes stay identical', () => {
    assert.equal((source.match(/if \(sourced.status === 'available'\) \{/g) || []).length, 2);
    const broken = compile(source.replaceAll("if (sourced.status === 'available') {", "if (false) {"));
    assert.throws(() => close(broken.gpGrowth(fixture()), axes.gpGrowth(fixture())));
    assert.throws(() => close(broken.revAcceleration(fixture()), axes.revAcceleration(fixture())));
    assert.equal(broken.gpGrowth(fixture()), null); assert.equal(broken.revAcceleration(fixture()), null);
    for (const s of Object.values(fixtures)) for (const key of ['capitalEfficiency','revGrowthLevel','ruleOfX','marginTrajectory',
      'revisionsMomentum','dilution','marginLevel','roicStability']) assert.deepEqual(axes[key](s), broken[key](s), key);
    assert.equal(hash(sourceFile), beforeHash, 'Live source was not modified');
  });
  test('unconfigured issuer and sealed fixture retain the ordinary path', () => {
    const s = fixture(); s.meta.ticker = 'UNCONFIGURED'; assert.equal(prepare(s), s); assert.equal(axes.gpGrowth(s), null);
    const golden = require('../protocol/gqs-00/1.1.0/golden-fixtures.json').cases;
    for (const c of golden) assert.equal(resolve(c.rawSnapshot).status, 'not-configured');
  });
  test('export explanation names the sourced year and the actual acceleration branch', () => {
    const { annualPairsShadow } = require('../lib/annual-pairs.js');
    const s = fixture(), shadow = annualPairsShadow(s);
    assert.match(shadow.grossProfit.reason, /Abschluss 2025 gegen 2024/);
    assert.match(shadow.acceleration.reason, /Abschluss 2025 gegen 2024/);
    close(shadow.grossProfit.today, axes.gpGrowth(s));
    s.timeseries = { revenueQ: [150, 120, 80, 80], revenueQEnds: ['2026-06-30', '2026-03-31', '2025-06-30', '2025-03-31'] };
    assert.doesNotMatch(annualPairsShadow(s).acceleration.reason, /Abschluss 2025/);
    s.timeseries.revenueQEnds = ['2024-06-30', '2024-03-31', '2023-06-30', '2023-03-31'];
    assert.match(annualPairsShadow(s).acceleration.reason, /Abschluss 2025 gegen 2024/);
  });
  console.log(`${count} checks passed`);
} finally {
  if (previousDay === undefined) delete process.env.RUN_DATE_UTC; else process.env.RUN_DATE_UTC = previousDay;
}
