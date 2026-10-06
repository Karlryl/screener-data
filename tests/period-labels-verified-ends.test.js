'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { applyFinancialCases, table } = require('../lib/financial-known-cases.js');
const { revGrowthLeg } = require('../lib/rev-growth-basis.js');
const { quarterAgeDays } = require('../lib/stale-quarter-reload.js');
const { fixtureSnapshot, assertLabelAuthority } = require('../scripts/period-labels-check.js');
const fixtures = require('./fixtures/period-labels/period-fixtures.json');
const comparisons = require('../reports/period-labels-2026-10-06/filing-comparisons.json');

for (const c of fixtures.cases) test(c.ticker + ': real fixture keeps values, dates, partner and vendor staleness', () => {
  const s = fixtureSnapshot(c), bytes = JSON.stringify(s), before = revGrowthLeg(s);
  const out = applyFinancialCases(s), after = revGrowthLeg(out.snapshot);
  assert.equal(JSON.stringify(s), bytes, 'input never mutated');
  assert.deepEqual(out.events, [], 'labels are not value corrections');
  assert.equal(after.pct, before.pct);
  assert.deepEqual(out.snapshot.timeseries.revenueQ, s.timeseries.revenueQ);
  assert.deepEqual(out.snapshot.timeseries.revenueQEnds, s.timeseries.revenueQEnds);
  assert.equal(after.sourcePeriodEnd, before.periodEnd);
  assert.equal(after.sourcePriorPeriodEnd, before.priorPeriodEnd);
  const boundary = Date.parse(before.periodEnd) + 121 * 864e5;
  assert.equal(quarterAgeDays(out.snapshot.timeseries.revenueQEnds[0], boundary), 121);
  assert.equal(quarterAgeDays(s.timeseries.revenueQEnds[0], boundary), 121);
  if (['CRDO', 'KLIC'].includes(c.ticker)) {
    assert.deepEqual(out.snapshot.timeseries.reportedRevenueQEnds, c.rows.map(r => r.reportedEnd));
    assert.equal(after.periodEnd, c.rows[0].reportedEnd);
    assert.equal(after.priorPeriodEnd, c.rows.at(-1).reportedEnd);
  } else assert.deepEqual(after, before);
  assertLabelAuthority(out.snapshot, after);
});

test('current filing pairs: all four corrections, META/MSFT controls, no manufactured intervening quarters', () => {
  for (const c of comparisons) {
    const s = { meta: { ticker: c.ticker, reportingCurrency: 'USD' }, timeseries: {
      revenueQ: [c.original.currentRevenueUSD, c.original.priorRevenueUSD],
      revenueQEnds: [c.export.currentEnd, c.export.priorEnd],
    } };
    const out = applyFinancialCases(s).snapshot;
    assert.deepEqual(out.timeseries.revenueQ, s.timeseries.revenueQ);
    assert.deepEqual(out.timeseries.revenueQEnds, s.timeseries.revenueQEnds);
    if (['META', 'MSFT'].includes(c.ticker)) assert.equal(out, s);
    else assert.deepEqual(out.timeseries.reportedRevenueQEnds, [c.original.currentEnd, c.original.priorEnd]);
    assert.equal((out.timeseries.revenueQ[0] / out.timeseries.revenueQ[1] - 1) * 100, c.export.growth);
  }
});

test('every metadata source and exact value is traceable to the supplied evidence', () => {
  const evidence = fs.readFileSync(path.join(__dirname, '../reports/period-labels-2026-10-06/filing-evidence.md'), 'utf8');
  assert.equal(table.periodLabels.length, 16);
  assert.deepEqual([...new Set(table.periodLabels.map(c => c.ticker))].sort(), ['ADI', 'CRDO', 'KLIC', 'SKYT']);
  for (const c of table.periodLabels) {
    assert.equal(c.reason, `Periodenende laut Originalbericht ${c.reportedPeriodEnd}; Umsatzwert unverändert.`);
    for (const source of c.sources) {
      assert.ok(evidence.includes(source.url), c.caseId + ' source URL');
      assert.ok(evidence.includes(source.quote), c.caseId + ' verbatim evidence excerpt');
    }
  }
  for (const [ticker, periods] of [['ADI', ['2026-07-31', '2025-07-31']], ['SKYT', ['2026-03-31', '2025-03-31']]]) {
    assert.deepEqual(table.periodLabels.filter(c => c.ticker === ticker).map(c => c.period), periods);
  }
});

test('authority guard rejects an unbacked label on a mutated in-memory copy; source files stay intact', () => {
  const files = ['lib/rev-growth-basis.js', 'lib/financial-known-cases.js', 'configs/financial-known-cases.json'];
  const hashes = () => files.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '..', f))).digest('hex'));
  const before = hashes(), s = fixtureSnapshot(fixtures.cases.find(c => c.ticker === 'PLTR'));
  const leg = revGrowthLeg(s);
  assertLabelAuthority(s, leg);
  const broken = { ...leg, periodEnd: '2026-04-01' };
  assert.throws(() => assertLabelAuthority(s, broken), /PLTR: periodEnd changed without matching hand-table entry/);
  assert.deepEqual(hashes(), before);
});
