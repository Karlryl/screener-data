'use strict';
/**
 * annual-currency-guard — non-destructive LAMP for an annual-revenue currency leak.
 *
 * Yahoo can serve a USD-reporter's ANNUAL revenue in a different currency while
 * fundamentalsTimeSeries returns USD. This is observed both when the trading currency
 * exposes the leak (AKRBP.OL ~9.3x, GMAB.CO ~6.0x) and when reporting + trading currency
 * both say USD but the annual value is still home-currency-sized (INFY ~88.6x quarters).
 * _convertSnapshotToUSD cannot repair the latter because the envelope claims USD.
 *
 * DESIGN (A2, 2026-06-26): same non-destructive LAMP pattern as newest-qtr-guard —
 * Loop A DETECTS (data-quality), Loop B DISPOSES (down-weight/exclude), per the §6
 * boundary and ledger §4. Values stay FAITHFUL; the caller sets only suspect flags
 * (+reason), including meta._currencyInconsistencySuspect for T027 visibility.
 *
 * TRIGGER. All must hold:
 *   (1) cross-currency envelope, OR a USD/USD envelope with stronger magnitude evidence
 *   (2) annualRev[0] / sum(revenueQ[0..3]) exceeds the branch's conservative threshold
 *   (3) metrics.revenueTTM / sum(revenueQ[0..3]) is near 1 (quarterly side HEALTHY —
 *       isolates the annual array as the leaked one, vs a broken quarterly TTM)
 *   (4) USD/USD additionally requires annualRev / marketCap > 10; this catches INFY's
 *       INR-sized annual value but leaves same-currency discontinuities unclassified.
 * The inflationary direction only (>3): a deflationary annual (ratio<1/3) does NOT inflate
 * revenue and is harmless to a growth screener, so it is deliberately ignored.
 */

const QUARTERS_IN_TTM = 4;
const CROSS_CURRENCY_ANNUAL_TO_QTTM_MIN = 3;
// Same-currency evidence is weaker, so require an unmistakable home-currency magnitude.
const SAME_USD_ANNUAL_TO_QTTM_MIN = 20;
const SAME_USD_ANNUAL_TO_MARKET_CAP_MIN = 10;
const HEALTHY_TTM_TO_QUARTERS_MIN = 0.6;
const HEALTHY_TTM_TO_QUARTERS_MAX = 1.6;

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
  if (!repOrig || !trade) return NONE;
  const repKey = String(repOrig).toUpperCase();
  const tradeKey = String(trade).toUpperCase();
  const currenciesDiffer = repKey !== tradeKey;
  const sameUsdEnvelope = repKey === 'USD' && tradeKey === 'USD';
  if (!currenciesDiffer && !sameUsdEnvelope) return NONE;

  const a0 = _num((snapshot.annual && snapshot.annual.annualRev || [])[0]);
  if (!(a0 > 0)) return NONE;

  const revQ = (snapshot.timeseries && snapshot.timeseries.revenueQ) || [];
  const q = [];
  for (let i = 0; i < QUARTERS_IN_TTM; i++) {
    const v = _num(revQ[i]);
    if (v != null) q.push(v);
  }
  if (q.length < QUARTERS_IN_TTM) return NONE;
  const qTTM = q[0] + q[1] + q[2] + q[3];
  if (!(qTTM > 0)) return NONE;

  // Annual inflated vs the quarterly TTM by a currency-magnitude factor.
  const ratio = a0 / qTTM;
  const ratioMin = currenciesDiffer
    ? CROSS_CURRENCY_ANNUAL_TO_QTTM_MIN
    : SAME_USD_ANNUAL_TO_QTTM_MIN;
  if (!(ratio > ratioMin)) return NONE;

  // (3) the quarterly side must be HEALTHY: metrics.revenueTTM agrees with the quarterly
  // sum, which isolates the ANNUAL array as the leaked one (a broken quarterly TTM would
  // also push ratio>3 but is a different defect, not a currency leak).
  const revTTM = _num(snapshot.metrics && snapshot.metrics.revenueTTM);
  if (revTTM == null) return NONE;
  const ttmRatio = revTTM / qTTM;
  if (!(ttmRatio >= HEALTHY_TTM_TO_QUARTERS_MIN
      && ttmRatio <= HEALTHY_TTM_TO_QUARTERS_MAX)) return NONE;

  let annualToMarketCap = null;
  if (sameUsdEnvelope) {
    const marketCap = _num(snapshot.marketCap);
    if (!(marketCap > 0)) return NONE;
    annualToMarketCap = a0 / marketCap;
    if (!(annualToMarketCap > SAME_USD_ANNUAL_TO_MARKET_CAP_MIN)) return NONE;
  }

  const envelopeEvidence = currenciesDiffer
    ? `appears leaked in trading currency ${trade} (reporter ${repOrig})`
    : `is also x${annualToMarketCap.toFixed(1)} market cap despite a USD/USD envelope`;
  const reason =
    `annualRev[0] is x${ratio.toFixed(1)} the quarterly TTM while metrics.revenueTTM agrees ` +
    `with the quarters (x${ttmRatio.toFixed(2)}) — annual revenue ${envelopeEvidence}. ` +
    `Annual-based metrics untrustworthy; Loop B owns disposition (ledger §4). Values left FAITHFUL.`;
  return { suspect: true, reason };
}

module.exports = { detectAnnualCurrencyLeak };
