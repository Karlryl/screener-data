'use strict';
/**
 * Tag 223a — Earnings Surprise Momentum (PEAD / Liu-Strong 2024)
 * ===============================================================
 * Counts how many of the last 4 reported quarters showed positive EPS
 * surprise (epsActual > epsEstimate), and uses the mean surprise magnitude
 * as a secondary gate. Post-Earnings-Announcement-Drift (PEAD, "the most
 * persistent anomaly in finance") implies that recent earnings beats
 * predict positive forward returns over the subsequent 60-90 trading days,
 * primarily because under-reaction to the surprise causes prices to drift
 * in the direction of the beat for weeks after announcement.
 *
 * Pass criteria (both required):
 *   1. At least 3 of the last 4 quarters had positive surprise (>0%)
 *   2. Mean surprise across the last 4 quarters >= 3%
 *
 * Threshold semantics:
 *   threshold=3, op=gte refers to the positive-quarter count (consistent
 *   beat pattern). The 3% mean is a secondary magnitude floor, encoded
 *   in the components, intentionally NOT raised to the headline threshold
 *   so the UI shows "3 of 4 beats" as the primary readable signal.
 *
 * Data source: stock.external.earningsHistory[] — 4 most-recent quarters
 *   with epsActual, epsEstimate, epsDifference, surprisePercent, quarter.
 *   Persisted by Tag 220c (pull-yahoo earningsHistory module). Note Yahoo's
 *   surprisePercent is ALREADY in percent units (e.g. 5.0 = +5%), not a
 *   ratio (0.05) — this method consumes it as percent throughout.
 *
 * Not computable:
 *   - external.earningsHistory missing or empty (pre-Tag-220c snapshots —
 *     fixture-hash safe, same pattern as Tag 210d analyst-revision-breadth)
 *   - fewer than 3 entries with a non-null finite surprisePercent
 *
 * Surprise % handling:
 *   - Yahoo reports surprisePercent as percent (5.0 = +5%); we keep that
 *     scale in components.lastFourSurprises and components.mean.
 *   - "Positive" = surprisePercent > 0. We do NOT require >0.5% — even
 *     a small beat counts as positive (the PEAD literature uses the sign,
 *     not a magnitude bar, for the breadth count).
 *
 * DIAGNOSTIC (not in SCORE_WEIGHTS) — fixture-hash safe.
 *
 * References:
 *   Foster, G., Olsen, C., & Shevlin, T. (1984). "Earnings Releases,
 *     Anomalies, and the Behavior of Security Returns." The Accounting
 *     Review 59(4):574-603.
 *   Bernard, V. L., & Thomas, J. K. (1989). "Post-Earnings-Announcement
 *     Drift: Delayed Price Response or Risk Premium?" Journal of
 *     Accounting Research 27 (Supplement): 1-36.
 *   Liu, S., & Strong, N. (2024). "Earnings Surprises and the Anomalous
 *     Trading Behavior of Retail Investors." SSRN working paper —
 *     confirms PEAD persistence into the modern (post-2010) sample.
 */
const H = require('./_helpers.js');

const ID = 'earnings-surprise-momentum';
const LABEL = 'Earnings Surprise Momentum';
const THRESHOLD = 3;
const THRESHOLD_OP = 'gte';

const MIN_QUARTERS = 3;       // need at least 3 valid surprise readings
const WINDOW = 4;             // evaluate last 4 quarters
const MEAN_FLOOR_PCT = 3;     // mean surprise must be >= 3%
const POSITIVE_COUNT_FLOOR = 3; // need >= 3 of last 4 positive

function _validSurprise(row) {
  if (!row || typeof row !== 'object') return null;
  const v = row.surprisePercent;
  return Number.isFinite(v) ? v : null;
}

// audit F-A-2026-06-21: surprisePercent units mismatch — pull-yahoo.js persists
// Yahoo quoteSummary surprisePercent.raw VERBATIM, and Yahoo delivers that field
// as a RATIO (0.0408 for a +4.08% beat), not as a percent. The doc/fixtures use
// the percent convention (4.0 = +4%) and the magnitude floor MEAN_FLOOR_PCT=3 is
// percent-scaled, so on real pulled data mean (~0.04) can never clear 3 and the
// magnitude gate is dead — the PEAD diagnostic silently never passes regardless
// of how strongly a name beats. Failure mode prevented: a ratio-scaled surprise
// (0.04) being compared against a percent-scaled floor (3) and always failing.
//
// We normalize to the percent scale the floors expect by detecting which scale a
// window is in from its own magnitude, rather than rewriting the floors to ratio
// (which would mis-scale the percent-convention fixtures/doc and any percent-fed
// caller). Real EPS surprises are almost always within +/-100%, so a ratio window
// has max |v| well below the SCALE_BOUNDARY while a meaningful percent window sits
// above it. Sign-based breadth (v>0) is scale-invariant and unaffected either way.
const SCALE_BOUNDARY = 1; // |surprise| at/under 1 in the window => treat as ratio (<=100% beat); scale x100 to percent

function _toPercentScale(surprises) {
  if (surprises.length === 0) return surprises;
  // Largest absolute beat in the window decides the scale for the whole window
  // (mixing scales within one Yahoo earningsHistory block does not occur — the
  // puller writes every row through the same _v unwrap).
  let maxAbs = 0;
  for (const v of surprises) { const a = Math.abs(v); if (a > maxAbs) maxAbs = a; }
  // maxAbs <= 1 => ratio scale (e.g. 0.04 = 4%). maxAbs == 0 (all-flat) stays as-is.
  const isRatio = maxAbs > 0 && maxAbs <= SCALE_BOUNDARY;
  return isRatio ? surprises.map(v => v * 100) : surprises;
}

function evaluate(stock) {
  const hist = stock && stock.external && stock.external.earningsHistory;
  if (!Array.isArray(hist) || hist.length === 0) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'no earningsHistory in snapshot (needs Tag 220c puller)',
      components: { lastFourSurprises: [], positiveCount: 0, mean: null },
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  // Yahoo orders earningsHistory chronologically (oldest first). Take the
  // LAST WINDOW (most recent) and filter to valid surprise readings.
  const lastN = hist.slice(-WINDOW);
  const rawSurprises = lastN
    .map(_validSurprise)
    .filter(v => v != null);
  // audit F-A-2026-06-21: normalize Yahoo's ratio-scaled surprisePercent (0.04)
  // up to the percent scale (4) the magnitude floor/large-beat bar assume, so the
  // gate is not silently dead on real data. Percent-scaled inputs pass through
  // unchanged (max |v| > 1), keeping the documented convention and fixtures intact.
  const surprises = _toPercentScale(rawSurprises);

  if (surprises.length < MIN_QUARTERS) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'only ' + surprises.length + ' valid surprisePercent entries in last ' +
              WINDOW + ' quarters (need >= ' + MIN_QUARTERS + ')',
      components: { lastFourSurprises: surprises, positiveCount: 0, mean: null },
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const positiveCount = surprises.filter(v => v > 0).length;
  const largePositiveCount = surprises.filter(v => v > 5).length;
  const sum = surprises.reduce((a, b) => a + b, 0);
  const mean = sum / surprises.length;
  const max = Math.max.apply(null, surprises);
  const min = Math.min.apply(null, surprises);

  const breadthPass = positiveCount >= POSITIVE_COUNT_FLOOR;
  const magnitudePass = mean >= MEAN_FLOOR_PCT;
  const pass = breadthPass && magnitudePass;

  return H.buildResult({
    value: positiveCount,
    pass,
    computable: true,
    components: {
      lastFourSurprises: surprises.map(v => Math.round(v * 100) / 100),
      positiveCount,
      largePositiveCount,
      mean: Math.round(mean * 100) / 100,
      max: Math.round(max * 100) / 100,
      min: Math.round(min * 100) / 100,
      quartersEvaluated: surprises.length,
      thresholds: {
        positiveCountFloor: POSITIVE_COUNT_FLOOR,
        meanFloorPct: MEAN_FLOOR_PCT
      }
    },
    reason: positiveCount + '/' + WINDOW + ' beats, mean=' +
            mean.toFixed(1) + '% (need >=' + POSITIVE_COUNT_FLOOR + '/4 AND mean>=' +
            MEAN_FLOOR_PCT + '%)' +
            (breadthPass && !magnitudePass ? ' — breadth OK but magnitude weak' :
             !breadthPass && magnitudePass ? ' — magnitude OK but breadth weak' : ''),
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Earnings Surprise Momentum: >=3 of last 4 quarterly EPS surprises positive AND mean >=3% (PEAD: Foster 1984, Bernard-Thomas 1989, Liu-Strong 2024)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'count',
  evaluate
};
