'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const W = require('../scripts/write-rule40-export.js');
const { applyFinancialCases } = require('../lib/financial-known-cases.js');
const { revGrowthLeg } = require('../lib/rev-growth-basis.js');
const { fixtureSnapshot } = require('../scripts/period-labels-check.js');
const { baueExport, boardZeile, laeufer } = require('./rule40-fixture.js');
const baseline = require('./fixtures/mcap-classes-shadow/rule40-before.json');
const crdo = require('./fixtures/period-labels/period-fixtures.json').cases.find(c => c.ticker === 'CRDO');
const { test, bilanz } = laeufer();
const sourceKeys = ['revGrowthSourcePeriodEnd', 'revGrowthSourcePriorPeriodEnd'];

test('P134: Rule40 CRDO row carries source ends beside unchanged display ends', () => {
  const candidate = structuredClone(baseline.candidates[1]);
  candidate.ticker = 'CRDO';
  candidate.wachstumBein = revGrowthLeg(applyFinancialCases(fixtureSnapshot(crdo)).snapshot);
  candidate.wachstumRoh = candidate.wachstumBein.pct;
  const [row] = W.baueZeilen([candidate]).rows;
  assert.equal(row.revGrowthSourcePeriodEnd, '2026-04-30');
  assert.equal(row.revGrowthSourcePriorPeriodEnd, '2025-04-30');
  assert.equal(row.revGrowthBasis, 'quarter');
  assert.equal(row.revGrowthPeriodEnd, '2026-05-02');
  assert.equal(row.revGrowthPriorPeriodEnd, '2025-05-03');
  const keys = Object.keys(row), labelIndex = keys.indexOf('revGrowthPriorPeriodEnd');
  assert.deepEqual(keys.slice(labelIndex + 1, labelIndex + 3), sourceKeys);
});

test('P134: Rule40 row without a growth leg carries both source keys as null', () => {
  const [row] = W.baueZeilen([structuredClone(baseline.candidates[1])]).rows;
  assert.equal(row.revGrowthSourcePeriodEnd, null);
  assert.equal(row.revGrowthSourcePriorPeriodEnd, null);
});

test('P134: Rule40 check rejects either one-sided source pair, accepts both or neither', () => {
  const f = baueExport([{ row: boardZeile() }]);
  W.build(f);
  assert.deepEqual(W.check(f).errors, []);
  const original = path.join(f.outDir, 'overview.json'), bytes = fs.readFileSync(original);
  const hash = () => createHash('sha256').update(fs.readFileSync(original)).digest('hex');
  const before = hash(), outDir = path.resolve(f.dir, 'pair-check', 'rule40');
  assert(outDir.startsWith(path.resolve(f.dir) + path.sep));
  assert(!outDir.startsWith(path.resolve(__dirname, '..') + path.sep));
  assert.notEqual(outDir, path.resolve(f.outDir));
  fs.cpSync(f.outDir, outDir, { recursive: true });
  const complete = JSON.parse(bytes), row = complete.rows[0];
  row.revGrowthSourcePeriodEnd = row.revGrowthPeriodEnd;
  row.revGrowthSourcePriorPeriodEnd = row.revGrowthPriorPeriodEnd;
  const check = data => {
    fs.writeFileSync(path.join(outDir, 'overview.json'), JSON.stringify(data));
    return W.check({ v1Dir: f.v1Dir, outDir }).errors;
  };
  assert.deepEqual(check(complete), []);
  for (const key of sourceKeys) {
    const broken = structuredClone(complete);
    delete broken.rows[0][key];
    assert(check(broken).some(e => /revGrowthSourcePeriodEnd\/SourcePriorPeriodEnd nur teilweise vorhanden/.test(e)), key);
  }
  const legacy = structuredClone(complete);
  sourceKeys.forEach(key => { delete legacy.rows[0][key]; });
  assert.deepEqual(check(legacy), []);
  assert.equal(hash(), before, 'the deliberate red probe leaves the original export unchanged');
});

bilanz('tests/rule40-source-ends.test.js');
