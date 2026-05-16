'use strict';
/**
 * Tag 199: Listing-Age
 * =====================
 * DIAGNOSTIC: returns the count of clean fiscal years of data available
 * for a stock. Used by score-aggregator to scale Quality-Compounder
 * scoring (a company can't be a "durable compounder" with only 1-2
 * years of public history, regardless of how strong those years look).
 *
 *   value = number of consecutive non-null annualRev entries
 *
 *   pass = value >= 3   (3 fiscal years is the QC eligibility floor)
 *
 * Why this method instead of meta.ipoYear alone:
 *   - Yahoo reports a single ipoYear, but many companies have fragmented
 *     pre-IPO history (SPAC acquisitions, restated financials, spin-offs).
 *   - The actual decision factor for "is there enough clean data to
 *     evaluate consistency" is the data length, not the calendar age.
 *   - Cross-check: if value < 3 AND meta.ipoYear suggests the company
 *     is older than 5y, that's a data-quality issue (flagged in
 *     components.ipoMismatch).
 *
 * Score-aggregator integration (Tag 199):
 *   QC score is multiplied by min(value / 5, 1.0). 5y fiscal history
 *   gets full credit; below 5y the score is pro-rated. 2y → 40%, 1y → 20%,
 *   0y → 0%. HG / Pre-Breakout scoring is NOT affected — those are
 *   leading-indicator categories where 3y of accelerating growth IS
 *   the signal.
 */
const H = require('./_helpers.js');

const ID = 'listing-age';
const LABEL = 'Listing-Age (years)';
const THRESHOLD = 3;
const THRESHOLD_OP = 'gte';
const NOW_YEAR = new Date().getUTCFullYear();

function _unwrap(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && Number.isFinite(v.value)) return v.value;
  return null;
}

function evaluate(stock) {
  if (!stock) {
    return H.buildResult({
      computable: false, pass: false, reason: 'no stock data',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const revArr = (stock.annual && stock.annual.annualRev) || [];

  // Count consecutive non-null fiscal years starting from latest. Stop on
  // first null/NaN to avoid counting padded positions as real history.
  let cleanYears = 0;
  for (const entry of revArr) {
    const v = _unwrap(entry);
    if (v == null) break;
    cleanYears++;
  }

  // Cross-check meta.ipoYear: if Yahoo says we have 2 clean fiscal years
  // but ipoYear was 5+ years ago, surface the mismatch (data-quality issue).
  const ipoYear = stock.meta && stock.meta.ipoYear;
  let ipoAgeYears = null;
  let ipoMismatch = false;
  if (Number.isFinite(ipoYear)) {
    ipoAgeYears = NOW_YEAR - ipoYear;
    if (ipoAgeYears >= 5 && cleanYears < 3) ipoMismatch = true;
  }

  return H.buildResult({
    value: cleanYears,
    pass: cleanYears >= THRESHOLD,
    computable: true,
    components: {
      cleanYears,
      ipoYear: Number.isFinite(ipoYear) ? ipoYear : null,
      ipoAgeYears,
      ipoMismatch
    },
    reason: cleanYears + 'y clean annualRev' +
            (ipoAgeYears != null ? ' (IPO ' + ipoYear + ', ' + ipoAgeYears + 'y ago)' : '') +
            (ipoMismatch ? ' — IPO/data mismatch flagged' : ''),
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Anzahl sauberer Geschäftsjahre — Floor 3y für Quality-Compounder-Bewertung',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'years',
  evaluate
};
