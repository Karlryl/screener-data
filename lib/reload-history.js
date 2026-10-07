'use strict';

// Only dated, comparable observations may fill a hole in the current window.
// Only explicitly dated observations may enter the bounded audit archive.
const DEFAULT_ARCHIVE_LIMIT = 200;
const INCOME = ['annualRev', 'annualOpInc', 'annualGP', 'annualNetIncome', 'annualCostOfRevenue'];
const INCOME_PEERS = [...INCOME, 'annualSGA', 'annualRnD', 'annualShares'];
const CASH = ['annualFCF', 'annualOCF', 'annualSBC', 'annualCapex', 'annualDepreciation',
  'annualRepurchase', 'annualDividendsPaid', 'annualNetCommonStockIssuance'];
const QUARTER = ['revenueQ', 'opIncQ', 'grossProfitQ', 'netIncomeQ'];
const value = x => typeof x === 'number' ? x : x?.value;
const finite = x => Number.isFinite(value(x));
const count = series => (Array.isArray(series) ? series : []).filter(finite).length;
// A hand-table hole (verified Q4 gap, verified false value, or a withheld unverified cell)
// is an authoritative observation: reload must never refill it from an older snapshot.
const authoritativeGap = x => value(x) === null && (x?.yahooQ4Correction?.replacementNativeValue === null
  || x?.financialCorrection?.replacementNativeValue === null || x?.financialMissing != null);
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
 * @param {object} [options] Optional archiveLimit; otherwise RELOAD_HISTORY_ARCHIVE_MAX/default 200.
 * @returns {object} The candidate with retention provenance and visible gaps.
 */
function preserveReloadHistory(next, previous, options = {}) {
  if (!previous?.meta) return next;
  const nm = next.meta, pm = previous.meta;
  const configuredLimit = Number(options.archiveLimit ?? process.env.RELOAD_HISTORY_ARCHIVE_MAX ?? DEFAULT_ARCHIVE_LIMIT);
  const archiveLimit = Number.isSafeInteger(configuredLimit) && configuredLimit >= 0 ? configuredLimit : DEFAULT_ARCHIVE_LIMIT;
  const warnings = [], retained = [], archived = copy(pm.reloadHistoryArchive || []);
  const currency = m => m.reportingCurrencyOriginal || m.reportingCurrency;
  // Deliberately require the identical FX rate: stored values are already USD.
  // Copying a value converted at another rate would mix valuation bases within a row.
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
        // A hand-table gap is an authoritative new observation, even when the
        // prior annual fingerprint is unavailable and its overlay cannot run.
        // Annual cells too (P99): a numeric annual hand-table case may withhold a year, and a refilled
        // older value (even an earlier corrected one) would then read as "already corrected".
        if (j >= 0 && (finite(current[field]?.[j]) || authoritativeGap(current[field]?.[j]))) continue;
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
          // No archive noise for undated legacy fields or unchanged index values.
          if (!Array.isArray(old[field + 'Ends']) || !day(end) ||
              (finite(v) && finite(current[field]?.[i]) && value(v) === value(current[field][i])) ||
              JSON.stringify(v) === JSON.stringify(current[field]?.[i])) continue;
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
  if (archived.length && archiveLimit) nm.reloadHistoryArchive = archived.slice(-archiveLimit);
  else delete nm.reloadHistoryArchive;
  if (warnings.length) nm.reloadHistoryGaps = warnings;
  return next;
}

// Compare values at shared periods; snapshot window loss is checked separately.
function sharedSeriesLoss(next, prior, nextEnds, priorEnds, allowQ4Gaps = false) {
  return (priorEnds || []).some((end, i) => {
    if (!day(end)) return false;
    const j = (nextEnds || []).indexOf(end);
    if (j < 0) return false; // Window slides and new fiscal years are not missing values.
    if (allowQ4Gaps && authoritativeGap(next?.[j])) return false;
    if (finite(prior?.[i])) return !finite(next?.[j]);
    return prior?.[i] && typeof prior[i] === 'object' && Object.keys(prior[i]).some(k =>
      Number.isFinite(prior[i][k]) && !Number.isFinite(next?.[j]?.[k]));
  });
}

/** Detect lost shared values and windows that drop more periods than they add.
 * @param {object} next Candidate snapshot.
 * @param {object} prior Stored snapshot.
 * @returns {boolean} Whether the reload would discard stored history.
 */
function historyIsThinner(next, prior) {
  const periods = (snapshot, group, field) => {
    const dates = ends(snapshot[group] || {}, field);
    return dates.length ? dates : (snapshot.meta?.statementPeriods?.[field] || []).map(p => p?.end);
  };
  return [['annual', ['annualRev', 'annualOpInc', 'annualNetIncome', 'annualFCF']], ['timeseries', QUARTER]].some(([group, fields]) => {
    const dated = (snapshot, series) => [...new Set(series.flatMap(field => periods(snapshot, group, field)).filter(day))];
    return fields.some(field => {
      const oldEnds = dated(prior, [field]), newEnds = dated(next, [field]);
      // Tag 1407 (Codex after-the-fact review of #401, P1): stored values without a period end
      // have no date to compare, so count them; an answer with fewer values (an empty one
      // included) would overwrite raw data (G24). The stored snapshot stays.
      const stored = count(prior[group]?.[field]);
      if (oldEnds.length < stored && count(next[group]?.[field]) < stored) return true;
      // Annual income and cash can advance separately. Count each new fiscal
      // period once across both families, including a new year's empty field.
      const family = group === 'annual' ? fields : [field];
      const oldWindow = dated(prior, family).sort(), newest = oldWindow.at(-1);
      const added = newest ? dated(next, family).filter(end => end > newest).length : 0;
      const dropped = oldEnds.filter(end => !newEnds.includes(end)).length;
      return dropped > added || sharedSeriesLoss(next[group]?.[field], prior[group]?.[field],
        periods(next, group, field), periods(prior, group, field), true);
    });
  });
}

/** Compare cache observations only at shared, verified period ends.
 * @param {object} next Newly fetched FTS payload.
 * @param {object} old Prior accepted payload.
 * @returns {boolean} Whether a shared-period observation is now missing.
 */
function cacheIsThinner(next, old) {
  if (!old) return false;
  const periods = (payload, group, field) => {
    const dates = ends(payload[group] || {}, field);
    const family = group === 'ftsQuarterly' ? 'quarter' : CASH.includes(field) ? 'cash' : field === 'annualBalance' ? 'balance' : 'income';
    return dates.length ? dates : (payload.ftsPeriods?.[family] || []).map(p => p?.end);
  };
  for (const group of ['ftsAnnual', 'ftsQuarterly']) {
    for (const [field, series] of Object.entries(old[group] || {})) {
      if (Array.isArray(series) && !/Ends$/.test(field) && sharedSeriesLoss(next[group]?.[field], series,
        periods(next, group, field), periods(old, group, field))) return true;
    }
  }
  const cacheEnds = (payload, key) => {
    const field = key === 'ftsBalance' ? 'annualBalance' : key === 'ftsQuarterlyNI' ? 'netIncomeQ' : key.replace(/^ftsAnnual/, 'annual');
    const block = key === 'ftsQuarterlyNI' ? payload.ftsQuarterly : payload.ftsAnnual;
    // Quarterly NI is trimmed together with the revenue bundle; raw row metadata
    // can still include the dropped empty leading quarter.
    const direct = key === 'ftsQuarterlyNI' ? block?.revenueQEnds || [] : ends(block || {}, field);
    const family = key === 'ftsBalance' ? 'balance' : key === 'ftsQuarterlyNI' ? 'quarter'
      : key === 'ftsAnnualShares' || key === 'ftsAnnualSharesBasic' ? 'shares'
        : ['ftsAnnualSGA', 'ftsAnnualRnD'].includes(key) ? 'income' : 'cash';
    const dates = direct.length ? direct : (payload.ftsPeriods?.[family] || []).map(p => p?.end);
    return !payload[key]?.length || dates.length === payload[key].length ? dates : [];
  };
  return Object.entries(old).some(([key, series]) => Array.isArray(series) && !/Ends$/.test(key) &&
    sharedSeriesLoss(next[key], series, cacheEnds(next, key), cacheEnds(old, key)));
}

module.exports = { preserveReloadHistory, cacheIsThinner, historyIsThinner, DEFAULT_ARCHIVE_LIMIT };
