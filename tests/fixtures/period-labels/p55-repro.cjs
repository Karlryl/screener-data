'use strict';
// Offline reproduction using copied real cache rows. No repository writes.
const assert = require('node:assert/strict');
const fixture = require('./period-fixtures.json');
fixture.sourceRoot = require('node:path').resolve(__dirname, fixture.sourceRoot) + '/';
const { revGrowthLeg } = require(fixture.sourceRoot + 'lib/rev-growth-basis.js');
const { extractQuarterlyPoints } = require(fixture.sourceRoot + 'scripts/enrich-q-revenue.js');
const { buildAnnual } = require(fixture.sourceRoot + 'merge-sec-xbrl.js');
const { quarterAgeDays } = require(fixture.sourceRoot + 'lib/stale-quarter-reload.js');
const { maxQuarterAgeDays } = require(fixture.sourceRoot + 'configs/stale-quarter-reload.json');
const day = 86400000;
const span = ends => (Math.max(...ends.map(Date.parse)) - Math.min(...ends.map(Date.parse))) / day;
const results = [];
for (const c of fixture.cases) {
  const extracted = extractQuarterlyPoints(c.reportedFacts);
  for (const row of c.rows.filter(r => r.reportedEnd)) {
    assert(extracted.some(q => q.end === row.reportedEnd && q.val === row.value));
  }
  if (c.ticker === 'CRDO' || c.ticker === 'KLIC') {
    const snapshot = { annual: c.annual, timeseries: {
      revenueQ: c.rows.map(r => ({ value: r.value })), revenueQEnds: c.rows.map(r => r.vendorEnd)
    } };
    const actual = revGrowthLeg(snapshot);
    const corrected = structuredClone(snapshot);
    corrected.timeseries.revenueQEnds = c.rows.map(r => r.reportedEnd);
    const reported = revGrowthLeg(corrected);
    assert.equal(actual.basis, 'quarter');
    assert.equal(actual.pct, reported.pct);
    assert.notEqual(actual.periodEnd, reported.periodEnd);
    const secAnnual = buildAnnual({ [c.concept]: { units: { USD: c.reportedFacts } } });
    assert.equal(secAnnual.annualRevEnds, undefined);
    const boundary = Date.parse(actual.periodEnd) + (maxQuarterAgeDays + 1) * day;
    const vendorAge = quarterAgeDays(actual.periodEnd, boundary);
    const reportedAge = quarterAgeDays(reported.periodEnd, boundary);
    assert(vendorAge > maxQuarterAgeDays && reportedAge <= maxQuarterAgeDays);
    results.push({ ticker: c.ticker, actual, reported,
      spanVendorDays: span(snapshot.timeseries.revenueQEnds),
      spanReportedDays: span(corrected.timeseries.revenueQEnds),
      conditionalFreshnessExample: { asOf: new Date(boundary).toISOString().slice(0, 10),
        maxQuarterAgeDays, vendorAge, reportedAge, vendorStale: true, reportedStale: false } });
    if (process.argv.includes('--require-reported-end')) {
      // Label-only contract: supply verified metadata without changing computational dates.
      const labelSnapshot = structuredClone(snapshot);
      labelSnapshot.timeseries.reportedRevenueQEnds = c.rows.map(r => r.reportedEnd);
      const labeled = revGrowthLeg(labelSnapshot);
      assert.equal(labeled.pct, actual.pct);
      assert.deepEqual(labelSnapshot.timeseries.revenueQ, snapshot.timeseries.revenueQ);
      assert.deepEqual(labelSnapshot.timeseries.revenueQEnds, snapshot.timeseries.revenueQEnds);
      assert.equal(span(labelSnapshot.timeseries.revenueQEnds), span(snapshot.timeseries.revenueQEnds));
      assert.equal(quarterAgeDays(labelSnapshot.timeseries.revenueQEnds[0], boundary), vendorAge);
      // Expected failure until revGrowthLeg reads the supplied label metadata.
      assert.equal(labeled.periodEnd, reported.periodEnd, c.ticker + ' ignores reportedRevenueQEnds');
      assert.equal(labeled.priorPeriodEnd, reported.priorPeriodEnd);
    }
  } else {
    const comparable = c.rows.filter(r => r.reportedEnd);
    assert(comparable.length >= 2);
    assert(comparable.every(r => r.vendorEnd === r.reportedEnd));
    const snapshot = { annual: c.annual, timeseries: {
      revenueQ: c.rows.map(r => ({ value: r.value })), revenueQEnds: c.rows.map(r => r.vendorEnd)
    } };
    const corrected = structuredClone(snapshot);
    corrected.timeseries.revenueQEnds = c.rows.map(r => r.reportedEnd ?? r.vendorEnd);
    assert.deepEqual(revGrowthLeg(snapshot), revGrowthLeg(corrected));
    results.push({ ticker: c.ticker, calendarCounterexamples: comparable.length,
      example: comparable[0] });
  }
}
console.log(JSON.stringify(results, null, 2));
