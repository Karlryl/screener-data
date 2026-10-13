'use strict';

const table = require('../configs/overview-known-cases.json');
const { norm } = require('../src/scoring/snapshot.js');
const { annualPeriodEnds } = require('./annual-pairs.js');
const { overviewMetric } = require('../src/scoring/overview.js');

// This table controls display only; never blank annualGP cells used by scoring.
const cases = new Map();
if (table.schemaVersion !== 1 || !table.revision || !Array.isArray(table.cases)) throw new Error('Invalid overview hand table');
for (const c of table.cases) {
  if (!c.caseId || !c.ticker || cases.has(c.ticker) || c.field !== 'overview.gpGrowth'
      || c.replacementValue !== null || !Number.isFinite(c.expectedBadValue)
      || c.releaseWhen !== 'dated-annual-gp-pair-matches-export' || !c.reason
      || !Array.isArray(c.sources) || !c.sources.length || c.sources.some(s => !s.ref || !s.page || !s.quote)) {
    throw new Error('Invalid overview case: ' + c.caseId);
  }
  cases.set(c.ticker, c);
}

/** Read display-only hold authority and the existing P158 verdict for a dated replacement.
 * @param {string} ticker Exact exported listing; no inferred issuer aliases.
 * @param {object|null} snapshot Prepared snapshot from the same store as the export.
 * @returns {object|null} German reason and optional expected rounded value; null for an unlisted ticker.
 */
function overviewGrowthHold(ticker, snapshot) {
  const c = cases.get(ticker);
  if (!c) return null;
  const values = norm(snapshot, 'annualGP'), ends = annualPeriodEnds(snapshot, 'annualGP');
  const newer = values.findIndex(Number.isFinite);
  const older = values.findIndex((v, i) => i > newer && Number.isFinite(v));
  if (newer < 0 || older < 0 || !ends[newer] || !ends[older]) return { reason: c.reason };
  const metric = overviewMetric(snapshot);
  return { reason: metric.reason || c.reason,
    expectedValue: Number.isFinite(metric.value) ? Math.round(metric.value * 1000) / 1000 : null };
}

module.exports = { overviewGrowthHold };
