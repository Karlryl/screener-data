'use strict';
/**
 * Tag 121e: Revenue-Volatility-Guard (Hard-Filter fuer HG)
 * =========================================================
 * Faengt SPHR-artige False Positives: Stocks mit lumpy/volatile Annual-Revenue-Historie,
 * die durch einen einzelnen Q-Aufschwung als "Hypergrowth" erscheinen, aber strukturell
 * keine konsistente Wachstumsgeschichte haben.
 *
 * Konkrete Failure-Mode (SPHR 2024): annualRev = [1220, 574, 1725, 180]
 *  - 2022 -> 2023: -67% YoY-Decline trotz YoY-TTM-Growth +38%
 *  - 2021 -> 2022: +858% (Buchungs-/Split-Artefakt)
 *  - "Echte" Hypergrowth-Stocks haben monoton wachsende oder mindestens
 *    stabile Annual-Revenue-Reihen — kein -25%+ Decline-Jahr im 4-Jahres-Fenster.
 *
 * Logik:
 *   - Wenn annualRev hat mind. 3 Jahre und IRGEND ein YoY-Decline < -25%, FAIL
 *   - Wenn ein YoY-Anstieg > 500% mit folgendem -50%+ Decline (Split-Pattern), FAIL
 *   - Sonst PASS (auch bei unauffaelligen Bewegungen)
 *
 * Material-Threshold: TTM-Rev >= $100M (kleinere Stocks toleranter behandeln)
 */
const H = require('./_helpers.js');

const ID = 'revenue-volatility-guard';
const LABEL = 'Revenue-Volatility-Guard';

const SINGLE_YEAR_DECLINE_THRESHOLD = -0.25;   // -25% single-year YoY = FAIL
const SPLIT_PATTERN_SPIKE = 5.0;                // 500%+ jump
const SPLIT_PATTERN_DROP = -0.50;               // followed by -50%+ drop = FAIL
const MATERIAL_REV_FLOOR_USD = 100e6;           // Tag 124: explicit USD

// Tag 124: rough FX-table (USD per 1 local currency).
// Aim is "is this material" filter, not accounting accuracy.
// Static fallback - daily-pull workflow could refresh this from Yahoo FX endpoint.
const FX_TO_USD = {
  USD: 1.0,
  EUR: 1.08,
  GBP: 1.27,
  JPY: 0.0067,   // 1 JPY ~ $0.0067
  HKD: 0.128,
  CNY: 0.138,
  AUD: 0.66,
  CAD: 0.73,
  CHF: 1.12,
  KRW: 0.00073,
  SGD: 0.74,
  TWD: 0.031
};

function toUsdRough(value, currency) {
  if (value == null || !Number.isFinite(value)) return null;
  const c = (currency || 'USD').toUpperCase();
  const rate = FX_TO_USD[c];
  // Unknown currency: conservatively treat as USD (do not silently disable floor).
  if (rate == null) return value;
  return value * rate;
}

function _arr(stock, path) {
  const a = H.val(stock, path);
  if (!Array.isArray(a)) return [];
  return a.map(v => v == null ? null : (typeof v === 'number' ? v : v.value)).filter(v => Number.isFinite(v));
}

function evaluate(stock) {
  if (!stock) return H.buildResult({ computable: false, pass: false, reason: 'no stock data' });

  const revY = _arr(stock, 'annual.annualRev');
  const ttmRev = H.metricValue(stock, 'revenueTTM') || revY[0] || 0;

  // Tag 124: Material-Schwelle in USD (currency-aware).
  // Vorher silent disable fuer non-USD Reporter (JPY/EUR/etc.) weil 100M lokal-Currency
  // viel zu niedrig war. Jetzt wird ttmRev nach USD konvertiert vor Comparison.
  const reportingCurrency = (stock.meta && stock.meta.reportingCurrency) || 'USD';
  const ttmRevUsd = toUsdRough(ttmRev, reportingCurrency);
  if (ttmRevUsd != null && ttmRevUsd < MATERIAL_REV_FLOOR_USD) {
    return H.buildResult({
      computable: true, pass: true, value: 'IMMATERIAL',
      reason: 'TTM-Rev <$100M (USD-aequiv, currency=' + reportingCurrency + ')'
    });
  }

  if (revY.length < 3) {
    return H.buildResult({
      computable: false, pass: true,
      reason: 'need >=3 annual revenue rows, got ' + revY.length
    });
  }

  // Berechne YoY-Wachstumsraten (latest first → rev[i] / rev[i+1] - 1)
  // revY[0] = newest, revY[1] = 1y ago, etc.
  // YoY[i] = (revY[i] - revY[i+1]) / revY[i+1]
  const yoyRates = [];
  for (let i = 0; i < revY.length - 1; i++) {
    if (revY[i+1] <= 0) continue;  // skip if denominator non-positive
    yoyRates.push({ index: i, rate: (revY[i] - revY[i+1]) / revY[i+1] });
  }

  if (yoyRates.length === 0) {
    return H.buildResult({
      computable: false, pass: true, reason: 'no valid YoY rates computable'
    });
  }

  // Check 1: Single-Year-Decline < -25%
  let worstDecline = null;
  for (const y of yoyRates) {
    if (worstDecline == null || y.rate < worstDecline.rate) worstDecline = y;
  }
  if (worstDecline && worstDecline.rate < SINGLE_YEAR_DECLINE_THRESHOLD) {
    return H.buildResult({
      computable: true, pass: false, value: 'VOLATILE',
      reason: 'Annual-Revenue-Drop ' + Math.round(worstDecline.rate*100) + '% (Year ' + worstDecline.index + '), Hypergrowth implausibel',
      threshold: SINGLE_YEAR_DECLINE_THRESHOLD, thresholdOp: 'gte'
    });
  }

  // Check 2: Split-Pattern (Spike >500% followed by Drop >50%)
  for (let i = 0; i < yoyRates.length - 1; i++) {
    if (yoyRates[i].rate > SPLIT_PATTERN_SPIKE && yoyRates[i+1].rate < SPLIT_PATTERN_DROP) {
      return H.buildResult({
        computable: true, pass: false, value: 'SPLIT_ARTIFACT',
        reason: 'Spike +' + Math.round(yoyRates[i].rate*100) + '% gefolgt von Drop ' + Math.round(yoyRates[i+1].rate*100) + '% (Buchhaltungs-/Split-Artefakt)',
        threshold: SINGLE_YEAR_DECLINE_THRESHOLD, thresholdOp: 'gte'
      });
    }
  }

  // PASS — keine extremen Schwankungen
  return H.buildResult({
    computable: true, pass: true, value: 'CONSISTENT',
    reason: 'Annual-Revenue stabil/wachsend (worst YoY = ' + (worstDecline ? Math.round(worstDecline.rate*100) + '%' : 'n/a') + ')',
    components: { yoyRates: yoyRates, worstDecline: worstDecline ? worstDecline.rate : null }
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Faengt SPHR-artige volatile Annual-Revenue-Historie',
  threshold: SINGLE_YEAR_DECLINE_THRESHOLD, thresholdOp: 'gte', unit: 'ratio',
  evaluate
};
