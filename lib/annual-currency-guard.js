'use strict';
/**
 * annual-currency-guard — non-destructive LAMP for an annual-revenue currency leak.
 *
 * Yahoo can serve a USD-reporter's ANNUAL revenue in its TRADING currency via the
 * deprecated quoteSummary.incomeStatementHistory (e.g. NOK ~10x), while
 * fundamentalsTimeSeries returns USD. For a USD-reporter trading in a minor currency
 * (financialData.financialCurrency=USD but price.currency local, e.g. .OL/.ST/.CO/.HE),
 * the density-based annual-income-bundle merge can pick the trading-currency source, so
 * annual.annualRev ends up ~10x too large — and _convertSnapshotToUSD does NOT rescale it
 * (fxRateApplied=1 because the reporting currency is detected as USD). Confirmed live on
 * AKRBP.OL (ratio ~9.3) and GMAB.CO (~6.0).
 *
 * DESIGN (A2, 2026-06-26): same non-destructive LAMP pattern as newest-qtr-guard —
 * Loop A DETECTS (data-quality), Loop B DISPOSES (down-weight/exclude), per the §6
 * boundary and ledger §4. Values stay FAITHFUL; the caller sets only
 * meta._annualCurrencyLeakSuspect (+reason).
 *
 * TRIGGER (measured on 4168 real snapshots — fires on AKRBP.OL + GMAB.CO only, zero FPs).
 * All must hold:
 *   (1) reportingCurrencyOriginal !== tradingCurrency      (currency-leak precondition)
 *   (2) annualRev[0] / sum(revenueQ[0..3]) > 3             (annual INFLATED ~ FX magnitude)
 *   (3) metrics.revenueTTM / sum(revenueQ[0..3]) in [0.6,1.6]  (quarterly side HEALTHY —
 *       isolates the annual array as the leaked one, vs a broken quarterly TTM)
 * The inflationary direction only (>3): a deflationary annual (ratio<1/3) does NOT inflate
 * revenue and is harmless to a growth screener, so it is deliberately ignored.
 */

function _num(x) {
  if (x == null) return null;
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x === 'object' && Number.isFinite(x.value)) return x.value;
  return null;
}

/**
 * @param {object} snapshot canonical snapshot (meta, annual.annualRev, timeseries.revenueQ,
 *        metrics.revenueTTM). Arrays newest-first, elements {value:number} or null.
 * @returns {{suspect:boolean, reason:(string|null)}}
 */
function detectAnnualCurrencyLeak(snapshot) {
  const NONE = { suspect: false, reason: null };
  if (!snapshot || !snapshot.meta) return NONE;

  const repOrig = snapshot.meta.reportingCurrencyOriginal;
  const trade = snapshot.meta.tradingCurrency;
  // (1) currency-leak precondition: original reporting ccy differs from trading ccy.
  if (!repOrig || !trade || repOrig === trade) return NONE;

  const a0 = _num((snapshot.annual && snapshot.annual.annualRev || [])[0]);
  if (!(a0 > 0)) return NONE;

  const revQ = (snapshot.timeseries && snapshot.timeseries.revenueQ) || [];
  const q = [];
  for (let i = 0; i < 4; i++) {
    const v = _num(revQ[i]);
    if (v != null) q.push(v);
  }
  if (q.length < 4) return NONE; // need a full 4-quarter TTM to compare against
  const qTTM = q[0] + q[1] + q[2] + q[3];
  if (!(qTTM > 0)) return NONE;

  // (2) annual inflated vs the quarterly TTM by a currency-magnitude factor.
  const ratio = a0 / qTTM;
  if (!(ratio > 3)) return NONE;

  // (3) the quarterly side must be HEALTHY: metrics.revenueTTM agrees with the quarterly
  // sum, which isolates the ANNUAL array as the leaked one (a broken quarterly TTM would
  // also push ratio>3 but is a different defect, not a currency leak).
  const revTTM = _num(snapshot.metrics && snapshot.metrics.revenueTTM);
  if (revTTM == null) return NONE;
  const ttmRatio = revTTM / qTTM;
  if (!(ttmRatio >= 0.6 && ttmRatio <= 1.6)) return NONE;

  const reason =
    `annualRev[0] is x${ratio.toFixed(1)} the quarterly TTM while metrics.revenueTTM agrees ` +
    `with the quarters (x${ttmRatio.toFixed(2)}) — annual revenue appears leaked in trading ` +
    `currency ${trade} (reporter ${repOrig}). Annual-based metrics untrustworthy; Loop B ` +
    `should exclude (ledger §4). Values left FAITHFUL.`;
  return { suspect: true, reason };
}

module.exports = { detectAnnualCurrencyLeak };
