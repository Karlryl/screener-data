'use strict';
/**
 * Tag 210b: Intangible-Adjusted ROIC (Mauboussin 2024)
 * =====================================================
 * Conventional ROIC understates capital for software / pharma / IP-heavy firms
 * because R&D and brand-building SG&A are expensed (not capitalized). Mauboussin
 * & Callahan, "ROIC and Intangible Assets" (Morgan Stanley Counterpoint Global,
 * 2024) recommend capitalizing those flows and amortizing them. This narrows
 * the cross-sector ROIC range (lifting industrial measurement to comparable
 * footing with software) without lowering the durable-quality bar.
 *
 * Formula:
 *   capitalizedRD  = sum over last 5y of (R&D_i * weight_i),
 *                    where weight_i = (5 - i) / 5 for i in {0..4}
 *                    (straight-line 5y amortization — newest year gets 5/5=1.0,
 *                    4y-ago gets 1/5=0.2, anything older = 0)
 *   capitalizedSGA = sum over last 3y of (SGA_i * weight_i),
 *                    where weight_i = (3 - i) / 3 for i in {0..2}
 *   adjIC          = totalAssets + capitalizedRD + capitalizedSGA
 *                    - cash - currentLiabilitiesNonInterest
 *   adjROIC        = NI / adjIC
 *
 * Pass threshold: adjROIC >= 0.15 (Mauboussin's "durable quality" cutoff for
 * global mega-caps; lower than nominal ROIC's 15% because IC is larger).
 *
 * Graceful degradation — what we ship vs. what's missing in snapshots:
 *   - annualRnD: Tag 202 backfilled this into snapshots; coverage is partial.
 *     If annualRnD has at least 1 year of data → use it (5y window if available).
 *   - annualSGA: NOT in current snapshots. When absent we proceed RD-only and
 *     mark sgaUsed=false in components. This is a documented simplification;
 *     for asset-light software firms the SGA term is a smaller second-order
 *     adjustment compared to R&D capitalization.
 *   - currentLiabilities-non-interest: NOT in snapshot. We use 0 as the
 *     "non-interest CL" subtraction — this slightly inflates adjIC (because
 *     true IC = TA - cash - non-interest CL), making the test marginally
 *     stricter (lower adjROIC). That is intentional: we prefer false-negatives
 *     over false-positives for a quality gate.
 *
 * DIAGNOSTIC type (not DATAGUARD):
 *   - Asset-light fallback in reinvestment-rate.js documents that R&D may be
 *     entirely missing (FTS cache misses); without R&D backfill this method
 *     returns adjROIC = nominal ROIC (no adjustment). Until R&D coverage is
 *     verified for all anchors, DIAGNOSTIC.
 *   - Not in SCORE_WEIGHTS → fixture-hash safe by construction.
 *
 * Promotion path (future tag):
 *   a. Verify Tag 202 annualRnD backfill is non-empty for the anchor set
 *      (NVDA/MSFT/COST/CRDO/PLTR). Add annualSGA extraction to pull-yahoo's
 *      quoteSummary mapping if Yahoo exposes a sellingGeneralAndAdministrative
 *      line per fiscal year.
 *   b. Confirm anchors achieve adjROIC >= 0.15 with margin (Mauboussin's 2024
 *      sample shows NVDA/MSFT/COST all > 0.20 adjusted).
 *   c. Consider raising threshold to 0.18 for top-quintile pure-quality (or
 *      add as second pass-gate after the standard 0.15 floor).
 *
 * Reference:
 *   Mauboussin, M., & Callahan, D. (2024). "ROIC and Intangible Assets."
 *   Morgan Stanley Counterpoint Global Insights.
 *   See also: audit-reports/2026-05-16-tag208-academic-research.md (Method C).
 */
const H = require('./_helpers.js');

const ID = 'intangible-adjusted-roic';
const LABEL = 'Intangible-Adjusted ROIC';
const THRESHOLD = 0.15;
const THRESHOLD_OP = 'gte';

const RD_AMORT_YEARS = 5;
const SGA_AMORT_YEARS = 3;

function _unwrap(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && Number.isFinite(v.value)) return v.value;
  return null;
}
function _annualVal(arr, idx) {
  if (!Array.isArray(arr) || arr.length <= idx) return null;
  return _unwrap(arr[idx]);
}
function _balField(stock, idx, field) {
  const arr = stock && stock.annual && stock.annual.annualBalance;
  if (!Array.isArray(arr) || arr.length <= idx) return null;
  const row = arr[idx];
  if (!row) return null;
  const v = row[field];
  return Number.isFinite(v) ? v : null;
}

/**
 * Capitalize a stream of expenses with straight-line amortization.
 * weight_i = (windowYears - i) / windowYears for i in {0..windowYears-1}.
 * Newest year gets full weight; oldest gets 1/N. Years beyond the window
 * are ignored. Missing/null years are treated as 0 (no expense that year).
 * Returns { sum, yearsUsed } — yearsUsed is the count of finite contributions.
 */
function _capitalize(arr, windowYears) {
  let sum = 0;
  let yearsUsed = 0;
  if (!Array.isArray(arr)) return { sum, yearsUsed };
  const horizon = Math.min(arr.length, windowYears);
  for (let i = 0; i < horizon; i++) {
    const v = _unwrap(arr[i]);
    if (!Number.isFinite(v) || v <= 0) continue;
    const w = (windowYears - i) / windowYears;
    sum += v * w;
    yearsUsed++;
  }
  return { sum, yearsUsed };
}

function evaluate(stock) {
  if (!stock || !stock.annual) {
    return H.buildResult({
      computable: false, pass: false, reason: 'no stock/annual data',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const A = stock.annual;

  // --- Core required inputs ----------------------------------------
  const ni_t = _annualVal(A.annualNetIncome, 0);
  const ta_t = _balField(stock, 0, 'totalAssets');
  const cash_t = _balField(stock, 0, 'totalCash');

  if (!Number.isFinite(ni_t)) {
    return H.buildResult({
      computable: false, pass: false, reason: 'no current-year annualNetIncome',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  if (!Number.isFinite(ta_t) || ta_t <= 0) {
    return H.buildResult({
      computable: false, pass: false, reason: 'no positive totalAssets',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  // --- Capitalized R&D (5y straight-line) --------------------------
  const rndCap = _capitalize(A.annualRnD, RD_AMORT_YEARS);
  // --- Capitalized SG&A (3y straight-line) — graceful degrade ------
  const sgaCap = _capitalize(A.annualSGA, SGA_AMORT_YEARS);

  // --- Non-interest current liabilities -----------------------------
  // Snapshot does not carry this; we use 0 as documented simplification.
  // True formula: adjIC = TA + capRD + capSGA - cash - nonIntCL.
  // Using 0 slightly inflates adjIC → stricter pass-gate (intentional).
  const nonIntCL = 0;

  const cashUsed = Number.isFinite(cash_t) ? cash_t : 0;
  const capRD = rndCap.sum;
  const capSGA = sgaCap.sum;

  const adjIC = ta_t + capRD + capSGA - cashUsed - nonIntCL;

  if (adjIC <= 0) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'adjusted invested capital <= 0 (TA=' + ta_t + ', cash=' + cashUsed + ', capRD=' + Math.round(capRD) + ', capSGA=' + Math.round(capSGA) + ')',
      components: {
        adjIC, totalAssets: ta_t, cash: cashUsed,
        capitalizedRD: capRD, capitalizedSGA: capSGA,
        rdYearsUsed: rndCap.yearsUsed, sgaYearsUsed: sgaCap.yearsUsed
      },
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const adjROIC = ni_t / adjIC;

  if (!Number.isFinite(adjROIC)) {
    return H.buildResult({
      computable: false, pass: false, reason: 'adjROIC not finite',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  // Compute nominal ROIC alongside for comparison (TA - cash basis).
  const nominalIC = ta_t - cashUsed;
  const nominalROIC = nominalIC > 0 ? ni_t / nominalIC : null;

  const pass = adjROIC >= THRESHOLD;
  const rdUsed = rndCap.yearsUsed > 0;
  const sgaUsed = sgaCap.yearsUsed > 0;

  const reasonBits = [];
  reasonBits.push('adjROIC=' + (adjROIC * 100).toFixed(1) + '%');
  if (nominalROIC != null) reasonBits.push('vs nominal=' + (nominalROIC * 100).toFixed(1) + '%');
  if (rdUsed) reasonBits.push('R&D ' + rndCap.yearsUsed + 'y capitalized');
  if (sgaUsed) reasonBits.push('SG&A ' + sgaCap.yearsUsed + 'y capitalized');
  if (!rdUsed && !sgaUsed) reasonBits.push('NO intangibles capitalized (R&D+SG&A both missing) — = nominal ROIC');

  return H.buildResult({
    value: Math.round(adjROIC * 10000) / 10000,
    pass,
    computable: true,
    components: {
      adjROIC: Math.round(adjROIC * 10000) / 10000,
      nominalROIC: nominalROIC != null ? Math.round(nominalROIC * 10000) / 10000 : null,
      adjIC, nominalIC,
      totalAssets: ta_t,
      cash: cashUsed,
      capitalizedRD: Math.round(capRD),
      capitalizedSGA: Math.round(capSGA),
      rdYearsUsed: rndCap.yearsUsed,
      sgaYearsUsed: sgaCap.yearsUsed,
      rdUsed,
      sgaUsed,
      netIncome: ni_t
    },
    reason: reasonBits.join(', ') + ' (floor ' + (THRESHOLD * 100) + '%)',
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Intangible-Adjusted ROIC >= 15%: R&D (5y) + SG&A (3y) capitalized into invested capital (Mauboussin 2024)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
