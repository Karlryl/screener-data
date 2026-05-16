'use strict';
/**
 * Tag 201: Insider-Net-Buying (last 6 months window)
 * ===================================================
 * Diagnostic signal: net positive insider activity (open-market buys
 * minus open-market sells) over the last ~6 months is a high-quality
 * inside-information proxy. Distinct from the existing
 * insider-buy-cluster.js (which counts UNIQUE BUY FILERS in 90d) —
 * this method nets the buy/sell ledger over a longer 180d horizon.
 *
 * Pass: net (= buys - sells) > 0.
 *
 * FAILURE MODE THIS DETECTS:
 *   insider-buy-cluster.js fires when >=2 unique filers buy in 90d, but
 *   it ignores SELL activity entirely. A stock with 2 small buys and
 *   15 large insider sells in the same window passes the cluster gate
 *   while screaming "insiders are exiting". Net-buying surfaces this
 *   imbalance. It also lengthens the window to 180d so a slow steady
 *   accumulation pattern (one buy every two months) becomes visible
 *   instead of being missed by the 90d cluster threshold.
 *
 * Data sources (pattern-based, no hardcoded tickers):
 *   1. stock.insider.netInsiderBuying        (future field — preferred)
 *   2. stock.insider.net6mShares             (alt naming convention)
 *   3. stock.insiderActivity (Tag 137):
 *        - 180d aggregate isn't pre-computed; we fall back to the 90d
 *          aggregate (buyCount90d - sellCount90d) as a coarse proxy,
 *          flagged so the consumer knows the window is truncated.
 *
 * Edge cases:
 *   - No insider data at all → computable:false (gracefully).
 *   - Insider data present but counts are zero in window → computable:true,
 *     value=0, pass=false ("no signal" rather than "missing").
 *   - sellCount and buyCount both null → computable:false.
 */
const H = require('./_helpers.js');

const ID = 'insider-net-buying';
const LABEL = 'Insider-Net-Buying (180d)';
const THRESHOLD = 0;
const THRESHOLD_OP = 'gt';

function _num(v) {
  return (typeof v === 'number' && Number.isFinite(v)) ? v : null;
}

function _extract(stock) {
  // Source 1: a dedicated 6m insider field, if pull-yahoo (or a future
  // extension) populates it. Try both common naming conventions.
  const ins = stock && stock.insider;
  if (ins) {
    const direct = _num(ins.netInsiderBuying) ?? _num(ins.net6mShares) ??
                   _num(ins.netShares180d);
    if (direct != null) {
      return { net: direct, period: '180d', source: 'insider' };
    }
  }
  // Source 2: Tag 137 insiderActivity is 90d-windowed. We fall back to
  // (buys - sells) on that shorter window as a proxy; flag the period
  // so the caller can see we truncated.
  const act = stock && stock.insiderActivity;
  if (act) {
    const buys = _num(act.buyCount90d);
    const sells = _num(act.sellCount90d);
    if (buys == null && sells == null) return null;
    const b = buys || 0;
    const s = sells || 0;
    return { net: b - s, period: '90d-fallback', source: 'insiderActivity',
             buys: b, sells: s, netShares90d: _num(act.netShares90d) };
  }
  return null;
}

function evaluate(stock) {
  if (!stock) {
    return H.buildResult({
      computable: false, pass: false, reason: 'no stock data',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const extracted = _extract(stock);
  if (!extracted) {
    return H.buildResult({
      computable: false,
      reason: 'no insider data (need stock.insider.netInsiderBuying or stock.insiderActivity)',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const { net, period, source } = extracted;
  const components = { netBuys: net, period, source };
  if (extracted.buys != null) components.buys = extracted.buys;
  if (extracted.sells != null) components.sells = extracted.sells;
  if (extracted.netShares90d != null) components.netShares90d = extracted.netShares90d;

  return H.buildResult({
    value: net,
    pass: net > THRESHOLD,
    computable: true,
    components,
    reason: 'net insider activity (' + period + ') = ' +
            (net >= 0 ? '+' : '') + net + ' (source: ' + source + ')' +
            (period === '90d-fallback' ? ' [180d data unavailable, using 90d]' : ''),
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Net insider buys minus sells über letzte 6 Monate — Inside-Information-Proxy',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'count',
  evaluate
};
