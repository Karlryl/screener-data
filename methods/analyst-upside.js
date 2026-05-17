'use strict';
/**
 * Tag 223a — Analyst Upside (Sell-Side Consensus, Soft Signal)
 * =============================================================
 * Stock's potential upside vs. analyst consensus median price target.
 * Sell-side targets are noisy and biased (anchoring, optimism, selection),
 * but a wide upside on a name with broad coverage is still a tradeable
 * soft signal — most useful as a sanity check or as one of many votes in
 * a multi-signal composite. Damodaran (Investment Philosophies, 2nd ed.,
 * chapter on analyst forecasts) treats consensus targets as a low-priority
 * input that nonetheless contains information after de-anchoring against
 * the current price.
 *
 * Formula:
 *   upside = (targetMedianPrice / currentPrice) - 1
 *
 * Pass threshold: upside >= 0.10 (analysts expect >= 10% price appreciation).
 *
 * Data sources (priority order for current price):
 *   1. stock.meta.regularMarketPrice
 *   2. stock.price.regularMarketPrice (price-only-update path)
 *   3. (otherwise: computable=false)
 *
 * Sanity guards (return computable=false):
 *   - targetMedianPrice missing or non-finite (Yahoo didn't return)
 *   - currentPrice missing or <= 0 (snapshot from pre-Tag-219 full pull
 *     and no price-only refresh has landed yet)
 *   - numberOfAnalystOpinions < 3 (sample too thin for consensus to mean
 *     anything; single-analyst coverage is noise)
 *   - upside outside [-1, +5] — implausible (delisted/halted/data error)
 *
 * Activated by Tag 219c (Run #109 backfill of targetMedianPrice +
 * numberOfAnalystOpinions in stock.metrics). Pre-Run-#109 snapshots return
 * computable=false universally — fixture-hash safe, same pattern as Tag
 * 210d analyst-revision-breadth.
 *
 * DIAGNOSTIC (not in SCORE_WEIGHTS) — fixture-hash safe by construction.
 *
 * Reference:
 *   Damodaran, A. (2012). "Investment Philosophies: Successful Strategies
 *   and the Investors Who Made Them Work." 2nd ed., Wiley. Chapter on
 *   analyst forecasts and the information content of price targets.
 */
const H = require('./_helpers.js');

const ID = 'analyst-upside';
const LABEL = 'Analyst Upside';
const THRESHOLD = 0.10;
const THRESHOLD_OP = 'gte';

const MIN_ANALYSTS = 3;
const UPSIDE_MIN_SANE = -1;   // -100% = stock would go to 0
const UPSIDE_MAX_SANE = 5;    // +500% = 6x — anything beyond is data error

function _currentPrice(stock) {
  if (!stock) return null;
  // Primary: meta.regularMarketPrice (if puller persists it)
  const metaPx = stock.meta && stock.meta.regularMarketPrice;
  if (Number.isFinite(metaPx) && metaPx > 0) return metaPx;
  // Fallback: stock.price.regularMarketPrice (price-only-update path)
  const px = stock.price && stock.price.regularMarketPrice;
  if (Number.isFinite(px) && px > 0) return px;
  return null;
}

function evaluate(stock) {
  const tgt = H.metricValue(stock, 'targetMedianPrice');
  const analysts = H.metricValue(stock, 'numberOfAnalystOpinions');
  const cur = _currentPrice(stock);

  if (tgt == null || !Number.isFinite(tgt) || tgt <= 0) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'no analyst target (metrics.targetMedianPrice missing — needs Tag 219c puller)',
      components: { targetMedian: null, current: cur, analystCount: analysts },
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  if (cur == null) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'no current price (meta.regularMarketPrice and price.regularMarketPrice missing)',
      components: { targetMedian: tgt, current: null, analystCount: analysts },
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  if (analysts == null || analysts < MIN_ANALYSTS) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'analyst coverage too thin: numberOfAnalystOpinions=' + analysts + ' (need >= ' + MIN_ANALYSTS + ')',
      components: { targetMedian: tgt, current: cur, analystCount: analysts },
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const upside = (tgt / cur) - 1;

  if (!Number.isFinite(upside) || upside < UPSIDE_MIN_SANE || upside > UPSIDE_MAX_SANE) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'upside outside sanity bounds [' + UPSIDE_MIN_SANE + ',' + UPSIDE_MAX_SANE + ']: ' + upside,
      components: { targetMedian: tgt, current: cur, analystCount: analysts, upside },
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const pass = upside >= THRESHOLD;
  return H.buildResult({
    value: Math.round(upside * 10000) / 10000,
    pass,
    computable: true,
    components: {
      upside: Math.round(upside * 10000) / 10000,
      current: cur,
      targetMedian: tgt,
      analystCount: analysts
    },
    reason: 'upside=' + (upside * 100).toFixed(1) + '% (target $' + tgt.toFixed(2) +
            ' vs current $' + cur.toFixed(2) + ', n=' + analysts + ' analysts, floor ' +
            (THRESHOLD * 100) + '%)',
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Analyst Upside >= 10%: (targetMedianPrice / currentPrice) - 1 with >= 3 analysts (Damodaran consensus soft signal)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
