'use strict';
// Hand table of 07.11.2026 (lane sd-hand-5): since the rows of 04.11.2026 put Shriram Finance on its filed revenue, the vendor
// years before the oldest filed one (2024 and 2023) are withheld as unverified. With only two fiscal years left, the revenue
// acceleration axis had no third year, the row fell from 4 to 3 of 7 axes and lost its rank on the financials board
// ("zuWenigBelegteAchsen", export of 07.11.2026). One row reads the fiscal year to 31.03.2024 from the comparison column of the
// report for 2025 (34,964.41 crore, the same presentation as the filed 2025 and 2026 years, without the housing subsidiary sold in
// December 2024); the original report of 2024 printed 36,379.52 crore with it and is kept as a second, not used source.
// Real packet: tests/fixtures/hand-table-shriram-20261107.json (daily run 42356903064). Every probe changes an in-memory copy and
// the live files are hashed before and after. Break-once on test data: `node tests/hand-table-shriram-20261107.test.js --prove-red`
// runs the same assertions on the table without this row and must exit 1.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const H = require('../lib/financial-known-cases.js');
const { revAcceleration } = require('../src/scoring/axes.js');
const F = require('./fixtures/hand-table-shriram-20261107.json').snapshots;

const root = path.resolve(__dirname, '..');
const live = ['configs/financial-known-cases.json', 'data-health/erwartungen.json', 'tests/fixtures/hand-table-shriram-20261107.json'];
const liveHashes = () => live.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'));
const beforeHashes = liveHashes();
const REV = '2026-11-07-sdhand5', T = 'SHRIRAMFIN.NS';
const value = r => (r && typeof r === 'object' ? r.value ?? null : r ?? null);
const pre = structuredClone(H.table);
pre.cases = pre.cases.filter(c => c.revision !== REV);
H.validateTable(pre);
const active = process.argv.includes('--prove-red') ? pre : H.table;
const apply = s => H.applyFinancialCases(s, { table: active });
const leg = () => structuredClone(F[T]);
const fx = F[T].annual.annualRev[0].value / 266575700000; // the stored years are USD; the table reads INR
const filed = 349644100000;

test('precondition: the vendor carries four years, the table without this row withholds 2024 and 2023 and the axis is empty', () => {
  assert.deepEqual(F[T].annual.annualRevEnds, ['2026-03-31', '2025-03-31', '2024-03-31', '2023-03-31']);
  assert.ok(Math.abs(F[T].annual.annualRev[2].value / fx - 201582900000) < 1, 'the vendor value of 2024 in INR');
  const out = H.applyFinancialCases(leg(), { table: pre }).snapshot;
  assert.deepEqual(out.annual.annualRev.map(value).slice(2), [null, null]);
  assert.equal(revAcceleration(out), null);
});

test('with the row: three filed years on one definition, 2023 stays withheld, the acceleration axis is back', () => {
  const r = apply(leg()), a = r.snapshot.annual;
  const want = [481329500000, 418344200000, filed].map(v => v * fx);
  a.annualRev.slice(0, 3).forEach((x, i) => assert.ok(Math.abs(value(x) - want[i]) < 1e-3, a.annualRevEnds[i]));
  assert.equal(value(a.annualRev[3]), null);
  assert.equal(a.annualRev[3].financialMissing.reasonCode, 'annual-older-than-cases');
  assert.equal(a.annualRev[2].financialCorrection.caseId, 'shriramfin.ns-2024-03-31-annualRev-20261107');
  const acc = revAcceleration(r.snapshot), g26 = 481329500000 / 418344200000 - 1, g25 = 418344200000 / filed - 1;
  assert.ok(Number.isFinite(acc), 'axis present');
  assert.ok(Math.abs(acc - (g26 - g25)) < 1e-9, 'the filed growth of 2026 (+15.1 %) minus that of 2025 (+19.6 %): ' + acc);
  assert.deepEqual(apply(structuredClone(r.snapshot)).snapshot, r.snapshot, 'idempotent');
  assert.deepEqual(leg(), F[T], 'input unchanged');
});

test('a changed vendor year never reaches the board: the year is withheld, not shown', () => {
  const s = leg();
  s.annual.annualRev[2] = { value: 210000000000 * fx };
  const a = apply(s).snapshot.annual;
  assert.equal(value(a.annualRev[2]), null);
  assert.equal(a.annualRev[2].financialMissing.reasonCode, 'vendor-value-changed');
  assert.notEqual(revAcceleration(apply(s).snapshot), revAcceleration(apply(leg()).snapshot));
});

test('row: one, appended last, exact sources, the restatement named, plain German', () => {
  const own = H.table.cases.filter(c => c.revision === REV);
  assert.equal(own.length, 1);
  // Only the 28 rows of lane sd-hand-4 (07.11.2026, tests/hand-table-sdhand4-20261107.test.js) and the 18 Kioxia rows (tests/hand-table-kioxia-20261107.test.js) follow this row.
  assert.deepEqual(H.table.cases.slice(H.table.cases.indexOf(own[0]) + 1).map(c => c.revision), [...Array(28).fill('2026-11-07-sdhand4'), ...Array(18).fill('2026-11-07-sdhand5b'), ...Array(3).fill('2026-11-07-sdhand5c'), ...Array(4).fill('2026-11-07-sdhand7'), ...Array(4).fill('2026-11-07-sdhand5d'), ...Array(3).fill('2026-11-07-sdhand7b')], 'appended after every earlier case');
  const c = own[0];
  assert.deepEqual([c.ticker, c.field, c.period, c.index, c.currency, c.expectedBadValue, c.replacementValue],
    [T, 'annualRev', '2024-03-31', 2, 'INR', 201582900000, filed]);
  assert.equal(c.sources[0].value, filed);
  assert.match(c.sources[0].quote, /41,834\.42 34,964\.41$/);
  assert.equal(c.sources[1].value, 363795200000);
  assert.match(c.reason, /31\.03\.2024/);
  assert.match(c.reason, /363\.795,20 Mio\. INR/);
  assert.match(c.reason, /Geprüft am 07\.11\.2026\.$/);
  assert.doesNotMatch(c.reason, /[–—]| - /);
});

test('the live files are unchanged by this test', () => {
  assert.deepEqual(liveHashes(), beforeHashes);
});
