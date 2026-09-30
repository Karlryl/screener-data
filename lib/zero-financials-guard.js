'use strict';

// A suspicious zero is not proof of a replacement amount. The broad detector can
// run in shadow mode; individually proven cells belong in the hand table.
const policy = require('../configs/zero-financials-policy.json');
const valueOf = row => typeof row === 'number' ? row : row?.value;
const nonzero = row => Number.isFinite(valueOf(row)) && valueOf(row) !== 0;
const groups = [
  { container: 'timeseries', revenue: 'revenueQ', profit: 'grossProfitQ', cost: 'costOfRevenueQ' },
  { container: 'annual', revenue: 'annualRev', profit: 'annualGP', cost: 'annualCostOfRevenue' },
];

/** Validate the user-authorized shadow threshold and operating mode.
 * @param {object} p Policy.
 * @returns {object} Validated policy, or throws.
 */
function validatePolicy(p) {
  if (p?.schemaVersion !== 1 || !['shadow', 'active'].includes(p.mode) || p.visibleScoreChangeLimit !== 50) {
    throw new Error('Invalid zero-financials policy');
  }
  return p;
}
validatePolicy(policy);

// Never pair two different dated periods just because their array indexes agree.
function samePeriodValue(bundle, field, end) {
  if (!end) return undefined;
  const ends = bundle[field + 'Ends'];
  if (!Array.isArray(ends) || ends.filter(d => d === end).length !== 1) return undefined;
  return bundle[field]?.[ends.indexOf(end)];
}

/** Flag contradicted exact zeros; active mode changes only zero to missing.
 * @param {object} snapshot Canonical JSON snapshot.
 * @param {object} options Mode override and optional event callback.
 * @returns {object} Snapshot, diagnostic events and effective mode.
 */
function applyZeroGuard(snapshot, options = {}) {
  const mode = options.mode ?? policy.mode;
  if (!['shadow', 'active'].includes(mode)) throw new Error('Invalid zero-financials mode');
  const events = [];
  let out = snapshot;
  for (const { container, revenue, profit, cost } of groups) {
    // Canonical snapshots are JSON data. Do not execute an accessor while doing
    // diagnostics; the owning reader/converter retains its normal error path.
    const bundle = snapshot && Object.getOwnPropertyDescriptor(snapshot, container)?.value;
    if (!bundle) continue;
    for (const field of [revenue, profit]) {
      const rows = bundle[field];
      if (!Array.isArray(rows)) continue;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (valueOf(row) !== 0) continue;
        // A primary-source-confirmed reported zero remains a statement (T2).
        if (row?.reportedZeroEvidence?.url && row.reportedZeroEvidence.period === bundle[field + 'Ends']?.[i]) continue;
        const period = bundle[field + 'Ends']?.[i] ?? null;
        const peers = (field === revenue ? [profit, cost] : [revenue, cost])
          .filter(peer => nonzero(samePeriodValue(bundle, peer, period)));
        const neighbors = [i - 1, i + 1].filter(j => j >= 0 && j < rows.length && nonzero(rows[j]));
        if (!peers.length && !neighbors.length) continue;
        const reason = 'Nullwert widerspricht anderen Angaben oder benachbarten Perioden; Betrag fehlt, kein Ersatzwert geschätzt.';
        const event = { ticker: snapshot.meta?.ticker, container, field, index: i, period,
          status: mode === 'shadow' ? 'observed' : 'missing', oldValue: 0, newValue: null,
          evidence: { samePeriodFields: peers, neighborIndexes: neighbors }, reason };
        events.push(event);
        if (options.onEvent) options.onEvent(event);
        if (mode === 'shadow') continue;
        if (out === snapshot) out = { ...snapshot };
        if (out[container] === bundle) out[container] = { ...bundle };
        if (out[container][field] === rows) out[container][field] = rows.slice();
        out[container][field][i] = { ...(row && typeof row === 'object' ? row : {}), value: null,
          financialMissing: { rule: 'zero-financials', period, originalValue: 0, reason, evidence: event.evidence } };
      }
    }
  }
  return { snapshot: out, events, mode };
}

/** Select shadow mode when the measured visible impact exceeds fifty rows.
 * @param {number} visibleScoreChanges Full-population replay count.
 * @returns {string} Eligible operating mode.
 */
function modeForReplay(visibleScoreChanges) {
  if (!Number.isInteger(visibleScoreChanges) || visibleScoreChanges < 0) throw new Error('Invalid replay count');
  return visibleScoreChanges > policy.visibleScoreChangeLimit ? 'shadow' : 'active';
}

module.exports = { applyZeroGuard, validatePolicy, modeForReplay, policy };
