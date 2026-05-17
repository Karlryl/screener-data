'use strict';
/**
 * Tag 213b: Price Momentum (12-month minus 1-month)
 * ==================================================
 * RESEARCH BASIS:
 *   Jegadeesh, N. & Titman, S. (1993). "Returns to Buying Winners and Selling
 *   Losers." Journal of Finance 48:65-91. Original momentum factor.
 *   Asness, C., Moskowitz, T. & Pedersen, L. (2013). "Value and Momentum
 *   Everywhere." Journal of Finance 68:929-985. Refined the standard
 *   formulation: 12-month return SKIPPING the most recent month (the "12-1"
 *   convention) to avoid the well-documented short-term reversal at the
 *   1-month horizon, which is a separate (and opposite-signed) effect.
 *
 * Why skip 1 month:
 *   The 12-month signal captures multi-month trend persistence; the 1-month
 *   signal is dominated by liquidity-driven reversal (Jegadeesh 1990,
 *   Lehmann 1990). Mixing them blunts the trend signal. The cross-sectional
 *   academic consensus is unanimous: momentum is computed on t-12 to t-1,
 *   not t-12 to t-0.
 *
 * Data source priority:
 *   1. stock.timeseries.pricesHistory (per-stock daily-close series)
 *   2. stock.external.priceHistory12m (per-stock annotated 12m series)
 *   3. Module-level load of ../prices/history.json (project-wide cache;
 *      same loader pattern as above-200d-ma / volatility-annualized)
 *   4. Degraded fallback: positioning within window's [min,max] range
 *      when we have only short history (>= ~4 months).
 *
 * Formula:
 *   PROPER PATH (>= 252 trading days available):
 *     priceNow         = series[len-1].close
 *     priceLastMonth   = series[len-21].close   (skip ~21 trading days)
 *     priceOneYearAgo  = series[len-252].close
 *     ret12_1          = priceLastMonth / priceOneYearAgo - 1
 *   DEGRADED PATH (have at least 4 months of history but < 252 days):
 *     window = the full available series (or the last N entries up to 252)
 *     We compute a positional score:
 *       pos = (priceNow - lowWindow) / (highWindow - lowWindow)
 *     pos >= 0.6 -> stock is in the upper 40% of its recent range -> pass.
 *   The degraded path is a coarse momentum proxy when classic 12-1 cannot be
 *   computed; components.pricesUsed = 'degraded52w' flags it explicitly so
 *   consumers can detect the reduced signal quality.
 *
 * Pass:
 *   Proper path:  ret12_1 >= 0.10  (≥10% 12-1 return; conservative threshold)
 *   Degraded path: positional score >= 0.6 (upper 40% of recent range)
 *
 * Not computable when:
 *   - No price data available from any source
 *   - Fewer than ~4 months of history (84 trading days or 17 weekly bars)
 *
 * Notes on weekly vs daily detection:
 *   We use the same frequency-detection heuristic as above-200d-ma.js
 *   (avg gap between last two timestamps >= 4 days -> weekly), and scale all
 *   lookbacks accordingly. Weekly: 252d -> 52w, 21d -> 4w, 84d -> 17w.
 *
 * NOT in SCORE_WEIGHTS -> DIAGNOSTIC-only -> fixture-hash safe by construction.
 */
const fs = require('fs');
const path = require('path');
const H = require('./_helpers.js');

const ID = 'price-momentum-12-1';
const LABEL = 'Price Momentum (12-1)';
const THRESHOLD = 0.10;
const THRESHOLD_OP = 'gte';
const PRICES_HISTORY = path.join(__dirname, '..', 'prices', 'history.json');

// Frequency-aware lookback constants. Daily defaults; weekly halved/scaled.
const LOOKBACK_FULL_DAILY = 252;   // ~12 trading months
const SKIP_RECENT_DAILY   = 21;    // ~1 trading month
const MIN_HISTORY_DAILY   = 84;    // ~4 trading months (degraded-path floor)
const LOOKBACK_FULL_WEEKLY = 52;
const SKIP_RECENT_WEEKLY   = 4;
const MIN_HISTORY_WEEKLY   = 17;
const DEGRADED_RANGE_PASS  = 0.6;

let _historyCache = null;
function _loadHistory() {
  if (_historyCache !== null) return _historyCache;
  try {
    if (!fs.existsSync(PRICES_HISTORY)) { _historyCache = false; return _historyCache; }
    _historyCache = JSON.parse(fs.readFileSync(PRICES_HISTORY, 'utf8'));
    if (!_historyCache || typeof _historyCache !== 'object') _historyCache = false;
  } catch (e) {
    _historyCache = false;
  }
  return _historyCache;
}

function _candidateTickers(stock) {
  const out = [];
  const seen = new Set();
  const push = (t) => {
    if (!t || typeof t !== 'string') return;
    const up = t.trim();
    if (!up || seen.has(up)) return;
    seen.add(up);
    out.push(up);
  };
  if (stock) {
    push(stock.meta && stock.meta.ticker);
    push(stock.meta && stock.meta.yahoo_symbol);
    push(stock.identifier);
  }
  return out;
}

function _normalizeSeries(rawSeries) {
  // Accept either [{date, close}] or [number] or [{value}]; produce [{date?, close}].
  if (!Array.isArray(rawSeries)) return [];
  const out = [];
  for (const e of rawSeries) {
    if (e == null) continue;
    if (typeof e === 'number') {
      if (Number.isFinite(e) && e > 0) out.push({ close: e });
      continue;
    }
    if (typeof e === 'object') {
      const c = Number.isFinite(e.close) ? e.close
              : Number.isFinite(e.value) ? e.value
              : Number.isFinite(e.price) ? e.price : null;
      if (c != null && c > 0) {
        const entry = { close: c };
        if (e.date) entry.date = e.date;
        out.push(entry);
      }
    }
  }
  return out;
}

function _getSeries(stock) {
  // Priority 1: per-stock timeseries.pricesHistory
  if (stock && stock.timeseries && Array.isArray(stock.timeseries.pricesHistory)) {
    const s = _normalizeSeries(stock.timeseries.pricesHistory);
    if (s.length > 0) return { series: s, source: 'timeseries.pricesHistory' };
  }
  // Priority 2: per-stock external.priceHistory12m
  if (stock && stock.external && Array.isArray(stock.external.priceHistory12m)) {
    const s = _normalizeSeries(stock.external.priceHistory12m);
    if (s.length > 0) return { series: s, source: 'external.priceHistory12m' };
  }
  // Priority 3: project-wide cache by ticker
  const cache = _loadHistory();
  if (cache && typeof cache === 'object') {
    for (const t of _candidateTickers(stock)) {
      if (Array.isArray(cache[t])) {
        const s = _normalizeSeries(cache[t]);
        if (s.length > 0) return { series: s, source: 'prices/history.json[' + t + ']' };
      }
    }
  }
  return { series: [], source: null };
}

function _detectWeekly(series) {
  if (series.length < 2) return false;
  // Use last two timestamped entries if any; else assume daily.
  let lastDated = -1, prevDated = -1;
  for (let i = series.length - 1; i >= 0 && (lastDated < 0 || prevDated < 0); i--) {
    if (series[i].date) {
      if (lastDated < 0) lastDated = i;
      else if (prevDated < 0) prevDated = i;
    }
  }
  if (lastDated < 0 || prevDated < 0) return false;
  const d0 = Date.parse(series[prevDated].date);
  const d1 = Date.parse(series[lastDated].date);
  if (!Number.isFinite(d0) || !Number.isFinite(d1)) return false;
  return ((d1 - d0) / (1000 * 60 * 60 * 24)) >= 4;
}

function evaluate(stock) {
  const got = _getSeries(stock);
  const series = got.series;
  if (!series || series.length === 0) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'no price history (timeseries.pricesHistory / external.priceHistory12m / prices/history.json all empty)',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const weekly = _detectWeekly(series);
  const LOOKBACK_FULL = weekly ? LOOKBACK_FULL_WEEKLY : LOOKBACK_FULL_DAILY;
  const SKIP_RECENT  = weekly ? SKIP_RECENT_WEEKLY   : SKIP_RECENT_DAILY;
  const MIN_HISTORY  = weekly ? MIN_HISTORY_WEEKLY   : MIN_HISTORY_DAILY;

  if (series.length < MIN_HISTORY) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'only ' + series.length + (weekly ? ' weekly' : ' daily') +
              ' bars available (need >= ' + MIN_HISTORY + ' = ~4 months)',
      components: { barsAvailable: series.length, source: got.source, weekly },
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const len = series.length;
  const priceNow = series[len - 1].close;
  const dateNow  = series[len - 1].date || null;

  // PROPER PATH: classic 12-1 momentum.
  if (len >= LOOKBACK_FULL) {
    const priceLastMonth = series[len - 1 - SKIP_RECENT].close;
    const priceOneYearAgo = series[len - LOOKBACK_FULL].close;
    if (priceOneYearAgo > 0 && Number.isFinite(priceLastMonth) && Number.isFinite(priceOneYearAgo)) {
      const ret = (priceLastMonth / priceOneYearAgo) - 1;
      if (Number.isFinite(ret)) {
        const pass = ret >= THRESHOLD;
        return H.buildResult({
          value: ret,
          pass,
          computable: true,
          components: {
            ret12_1: Math.round(ret * 10000) / 10000,
            pricesUsed: weekly ? 'weekly' : 'monthly',
            sampleStart: series[len - LOOKBACK_FULL].date || null,
            sampleEnd:   series[len - 1 - SKIP_RECENT].date || null,
            priceOneYearAgo,
            priceLastMonth,
            priceNow,
            barsUsed: LOOKBACK_FULL,
            source: got.source
          },
          reason: '12-1 return = ' + (ret * 100).toFixed(1) + '% (' +
                  (weekly ? LOOKBACK_FULL + 'w lookback, ' + SKIP_RECENT + 'w skip'
                          : LOOKBACK_FULL + 'd lookback, ' + SKIP_RECENT + 'd skip') +
                  ', floor >= ' + (THRESHOLD * 100).toFixed(0) + '%)',
          threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
        });
      }
    }
  }

  // DEGRADED PATH: positional score within available window's [min, max].
  // Use the full series (already capped at LOOKBACK_FULL when longer).
  const window = len > LOOKBACK_FULL ? series.slice(len - LOOKBACK_FULL) : series;
  let lo = Infinity, hi = -Infinity;
  for (const e of window) {
    if (e.close < lo) lo = e.close;
    if (e.close > hi) hi = e.close;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'degraded path: window has degenerate range (lo=' + lo + ', hi=' + hi + ')',
      components: { source: got.source, barsAvailable: len, weekly },
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const pos = (priceNow - lo) / (hi - lo);
  const pass = pos >= DEGRADED_RANGE_PASS;

  return H.buildResult({
    value: pos,
    pass,
    computable: true,
    components: {
      ret12_1: null,
      pricesUsed: 'degraded52w',
      positionInRange: Math.round(pos * 10000) / 10000,
      windowLow: lo,
      windowHigh: hi,
      priceNow,
      sampleStart: window[0].date || null,
      sampleEnd: dateNow,
      barsUsed: window.length,
      source: got.source,
      thresholdsDegraded: { rangePass: DEGRADED_RANGE_PASS }
    },
    reason: 'degraded52w path: price ' + priceNow.toFixed(2) + ' sits at ' +
            (pos * 100).toFixed(1) + '% of [' + lo.toFixed(2) + ', ' + hi.toFixed(2) +
            '] window (' + window.length + (weekly ? 'w' : 'd') + ' available, floor >= ' +
            (DEGRADED_RANGE_PASS * 100).toFixed(0) + '%)',
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: '12-month price return skipping last month >= 10% (Jegadeesh-Titman 1993, Asness/Moskowitz/Pedersen 2013); degrades to within-window position when <252d history',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate,
  _resetCacheForTests: function () { _historyCache = null; }
};
