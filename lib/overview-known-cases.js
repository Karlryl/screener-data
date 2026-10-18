'use strict';

const table = require('../configs/overview-known-cases.json');
const { overviewMetric } = require('../src/scoring/overview.js');

// This table controls display only; never blank annualGP cells used by scoring.
const cases = new Map();
if (table.schemaVersion !== 1 || !table.revision || !Array.isArray(table.cases)) throw new Error('Invalid overview hand table');
for (const c of table.cases) {
  if (!c.caseId || !c.ticker || cases.has(c.ticker) || c.field !== 'overview.gpGrowth'
      || c.replacementValue !== null || !Number.isFinite(c.expectedBadValue)
      || c.releaseWhen !== 'selected-gp-candidate-matches-export' || !c.reason
      || !Array.isArray(c.sources) || !c.sources.length || c.sources.some(s => !s.ref || !s.page || !s.quote)) {
    throw new Error('Invalid overview case: ' + c.caseId);
  }
  cases.set(c.ticker, c);
}

/** Read display-only hold authority and the release check for the selected GP candidate (P267).
 * Since the G31 switch the overview shows the selected GP candidate (newest dated quarter, TTM or fiscal-year pair).
 * The hold releases only when that candidate is dated at both ends and its rounded value is the exported one;
 * an undated candidate, a non-adjacent year pair (value withheld) or a mismatch keeps the hold.
 * @param {string} ticker Exact exported listing; no inferred issuer aliases.
 * @param {object|null} snapshot Prepared snapshot from the same store as the export.
 * @returns {object|null} German reason and optional expected rounded value; null for an unlisted ticker.
 */
function overviewGrowthHold(ticker, snapshot) {
  const c = cases.get(ticker);
  if (!c) return null;
  const metric = overviewMetric(snapshot);
  const p = metric.period;
  if (!p || p.basis === 'none' || !p.periodEnd || !p.priorPeriodEnd) return { reason: c.reason };
  return { reason: metric.reason || c.reason,
    expectedValue: Number.isFinite(metric.value) ? Math.round(metric.value * 1000) / 1000 : null };
}

module.exports = { overviewGrowthHold };
