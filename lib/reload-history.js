'use strict';

// Only dated, comparable observations may fill a hole in the current window.
// Undated / out-of-window observations remain audit history, never score inputs.
const INCOME = ['annualRev', 'annualOpInc', 'annualGP', 'annualNetIncome', 'annualCostOfRevenue'];
const INCOME_PEERS = [...INCOME, 'annualSGA', 'annualRnD', 'annualShares'];
const CASH = ['annualFCF', 'annualOCF', 'annualSBC', 'annualCapex', 'annualDepreciation',
  'annualRepurchase', 'annualDividendsPaid', 'annualNetCommonStockIssuance'];
const QUARTER = ['revenueQ', 'opIncQ', 'grossProfitQ', 'netIncomeQ'];
const value = x => typeof x === 'number' ? x : x?.value;
const finite = x => Number.isFinite(value(x));
const day = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)
  && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0, 10) === x;
const copy = x => JSON.parse(JSON.stringify(x));

function ends(block, field) {
  if (Array.isArray(block[field + 'Ends'])) return block[field + 'Ends'];
  // These siblings are built from exactly the same statement rows.
  const anchor = INCOME.includes(field) ? 'annualRev' : QUARTER.includes(field) ? 'revenueQ' : null;
  return anchor && block[field]?.length === block[anchor]?.length ? block[anchor + 'Ends'] || [] : [];
}

/** Fill only comparable holes; keep excluded observations outside scored arrays.
 * @param {object} next Accepted candidate snapshot (mutated).
 * @param {object} previous Last persisted snapshot (read only).
 * @returns {object} The candidate with retention provenance and visible gaps.
 */
function preserveReloadHistory(next, previous) {
  if (!previous?.meta) return next;
  const nm = next.meta, pm = previous.meta;
  const warnings = [], retained = [], archived = copy(pm.reloadHistoryArchive || []);
  const currency = m => m.reportingCurrencyOriginal || m.reportingCurrency;
  const compatible = currency(nm) && currency(nm) === currency(pm)
    && nm.reportingCurrency === pm.reportingCurrency
    && (nm.fxRateApplied || 1) === (pm.fxRateApplied || 1);
  for (const group of ['annual', 'timeseries']) {
    const old = previous[group] || {}, current = next[group] || {};
    for (const [field, values] of Object.entries(old)) {
      if (!Array.isArray(values) || /Ends$/.test(field)) continue;
      const priorEnds = ends(old, field);
      const currentEnds = ends(current, field).length ? ends(current, field)
        : (nm.statementPeriods?.[field] || []).map(p => p?.end || null);
      const peers = INCOME_PEERS.includes(field) ? INCOME_PEERS : CASH.includes(field) ? CASH
        : QUARTER.includes(field) ? QUARTER : [field];
      for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (!finite(v) && !(field === 'annualBalance' && v && Object.values(v).some(Number.isFinite))) continue;
        const end = priorEnds[i], j = day(end) ? currentEnds.indexOf(end) : -1;
        const priorInfo = pm.statementPeriods?.[field]?.[i];
        const nextInfo = nm.statementPeriods?.[field]?.[j];
        const oldStamp = (pm.reloadHistoryRetained || []).find(r => r.field === field && r.end === end)?.fetchedAt
          || priorInfo?.fetchedAt || pm.fundamentalsTimeseriesFetchedAt || pm.fundamentalsAsOf || pm.fetchedAt;
        const descriptorOK = (priorInfo && nextInfo &&
          ['duration', 'currency', 'unit', 'basis'].every(k => priorInfo[k] != null && priorInfo[k] === nextInfo[k]));
        const opBasisOK = !/OpInc|opInc/.test(field) || pm.opIncSource === nm.opIncSource;
        const revised = j >= 0 && (field === 'annualBalance' ? Object.keys(v).some(k =>
          Number.isFinite(v[k]) && Number.isFinite(current[field]?.[j]?.[k]) && v[k] !== current[field][j][k]) : peers.some(k => {
          const oi = ends(old, k).indexOf(end), ni = ends(current, k).indexOf(end);
          return oi >= 0 && ni >= 0 && finite(old[k]?.[oi]) && finite(current[k]?.[ni])
            && value(old[k][oi]) !== value(current[k][ni]);
        }));
        if (j >= 0 && finite(current[field]?.[j])) continue; // New observation always wins, including zero.
        const reason = !day(end) ? 'period-unverified' : j < 0 ? 'outside-new-periods'
          : !compatible || !descriptorOK || !opBasisOK ? 'statement-basis-unverified'
            : revised ? 'period-revised' : !Number.isFinite(Date.parse(oldStamp)) ? 'fetch-time-unverified' : null;
        if (!reason) {
          current[field] = (current[field] || []).slice();
          while (current[field].length < currentEnds.length) current[field].push(null);
          if (field !== 'netIncomeQ' || Array.isArray(current[field + 'Ends'])) current[field + 'Ends'] = currentEnds.slice();
          current[field][j] = field === 'annualBalance' ? { ...copy(v), ...Object.fromEntries(
            Object.entries(current[field][j] || {}).filter(([, n]) => n != null)) } : copy(v);
          retained.push({ field, end, fetchedAt: oldStamp });
          nm.statementPeriods[field][j] = { ...nextInfo, fetchedAt: oldStamp };
        } else {
          // Keep the original observation outside the scoring series. Do not attach
          // an invented period or the new fetch clock to legacy side-series.
          const entry = { field, end: day(end) ? end : null, index: i, value: v,
            fetchedAt: oldStamp || null, reason: reason || 'balance-row-unverified' };
          if (!archived.some(a => JSON.stringify(a) === JSON.stringify(entry))) archived.push(copy(entry));
          warnings.push({ field, end: entry.end, reason: entry.reason });
        }
      }
    }
  }
  for (const [group, fields] of [['annual', [...INCOME_PEERS, ...CASH]], ['timeseries', QUARTER]]) {
    for (const field of fields) {
      for (const [i, end] of ends(next[group] || {}, field).entries()) {
        if (day(end) && !finite(next[group]?.[field]?.[i]) &&
            !warnings.some(w => w.field === field && w.end === end)) {
          warnings.push({ field, end, reason: 'value-missing-in-comparable-statements' });
        }
      }
    }
  }
  if (retained.length) nm.reloadHistoryRetained = retained;
  if (archived.length) nm.reloadHistoryArchive = archived;
  if (warnings.length) nm.reloadHistoryGaps = warnings;
  return next;
}

/** Check the staged raw cache against its last accepted payload.
 * @param {object} next Newly fetched FTS payload.
 * @param {object} old Prior payload, if any.
 * @returns {boolean} Whether any previously present numeric series becomes thinner.
 */
function cacheIsThinner(next, old) {
  if (!old) return false;
  const count = a => (a || []).filter(x => finite(x) || (x && typeof x === 'object' && Object.values(x).some(Number.isFinite))).length;
  for (const [key, values] of Object.entries(old)) {
    if (Array.isArray(values) && !/Ends$/.test(key) && count(next[key]) < count(values)) return true;
    if (['ftsAnnual', 'ftsQuarterly'].includes(key) && values) {
      for (const [field, series] of Object.entries(values)) {
        if (Array.isArray(series) && !/Ends$/.test(field) && count(next[key]?.[field]) < count(series)) return true;
      }
    }
  }
  return false;
}

module.exports = { preserveReloadHistory, cacheIsThinner };
