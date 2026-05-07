/**
 * v7.3 Manipulation-Filters — Tag 8
 * ====================================
 *
 * Sub-Profile-spezifische Heuristiken für AUFFÄLLIGE Patterns, die mit
 * Earnings/Revenue-Manipulation korrelieren. WICHTIG (Tag-8-Audit-Klarstellung):
 *
 *   Diese Filter sind QUALITY-HEURISTICS, keine Forensic-Manipulation-Detectors.
 *   Sie produzieren Risk-Flags zur Aufmerksamkeit, nicht Beweise.
 *   Zyklische GM-Volatilität in Halbleitern, GAAP-konforme Pension-Gains in Industrials,
 *   und strategische Margin-Investments in Marketplaces können Filter triggern,
 *   ohne dass irgendetwas manipuliert ist. Die Flags sind Anlass zum Hinschauen,
 *   nicht zum Verurteilen.
 *
 * Designprinzipien:
 *   - Stand-alone: Engine bleibt unverändert. Filter werden separat aufgerufen,
 *     reasonCodes werden an Engine-Output angehängt.
 *   - Sub-Profile-gated: Filter laufen nur bei matching Sub-Profile.
 *   - Heute nur Visibility (reasonCodes mit severity INFO), KEINE Score-Penalties.
 *     Penalties erst nach 4-Wochen-Bewährung (Tag 9+ optional).
 *   - Conservative thresholds: lieber falsch-negativ (Filter feuert nicht) als
 *     falsch-positiv (legit Stocks fälschlich geflaggt).
 *
 * Public API:
 *   const result = ManipulationFilters.evaluate(canonicalStock, scoreResult);
 *   // result = { codes: [...], details: [...] }
 *   // codes werden an scoreResult.reasonCodes angehängt vom Caller.
 */

'use strict';

const FILTER_VERSION = '1.0.0';

// ─── Helpers ────────────────────────────────────────────────

function _stdDev(arr) {
  if (!Array.isArray(arr) || arr.length < 2) return 0;
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function _toNumber(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && v.value != null) {
    return typeof v.value === 'number' && Number.isFinite(v.value) ? v.value : null;
  }
  return null;
}

function _arrayValues(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(x => _toNumber(x)).filter(v => v != null);
}

// ─── Filter 1: SAAS — OpInc-vs-FCF-Divergence ────────────────────
// Wenn OpInc-Margin > 5% UND FCF-Margin < (OpInc-Margin - 10pp), dann verdächtig:
// Working-Capital-Aufbau oder Capex-Capitalisierung versteckt Cash-Burn.
function _filter_saas_opinc_fcf_divergence(stock) {
  const opM = _toNumber(stock.metrics?.operatingMargin);
  const fcfM = _toNumber(stock.metrics?.fcfMarginTTM);
  if (opM == null || fcfM == null) return null;
  if (opM <= 5) return null;  // unprofitable companies sind eigener Fall, nicht hier
  const gap = opM - fcfM;
  if (gap >= 10) {
    return {
      code: 'OPINC_FCF_DIVERGENCE_SAAS',
      severity: 'INFO',
      detail: `OpInc-FCF-Lücke ${gap.toFixed(1)}pp (OpInc ${opM.toFixed(1)}%, FCF ${fcfM.toFixed(1)}%) — Working-Capital-Aufbau oder Capex-Capitalisierung möglich.`,
      magnitude: gap
    };
  }
  return null;
}

// ─── Filter 2: HARDWARE — GM-Volatilität ─────────────────────────
// Quartal-GP-Margin StdDev > 500bps über mindestens 5 Quartale → Inventory/Pricing-Volatilität.
function _filter_hardware_gm_volatility(stock) {
  const ts = stock.timeseries || {};
  const gp = _arrayValues(ts.grossProfitQ);
  const rev = _arrayValues(ts.revenueQ);
  if (gp.length < 5 || rev.length < 5) return null;

  const len = Math.min(gp.length, rev.length);
  const margins = [];
  for (let i = 0; i < len; i++) {
    if (rev[i] && rev[i] !== 0) margins.push(gp[i] / rev[i] * 100);
  }
  if (margins.length < 5) return null;

  const sd = _stdDev(margins);
  if (sd >= 5) {  // 5 percentage points = 500bps
    return {
      code: 'GM_HIGH_VOLATILITY_HARDWARE',
      severity: 'INFO',
      detail: `Quartal-GM-StdDev ${sd.toFixed(2)}pp über ${margins.length} Quartale (>500bps Schwelle) — Inventory/Pricing-Volatilität.`,
      magnitude: sd
    };
  }
  return null;
}

// ─── Filter 3: INDUSTRIAL — Net-Income vs OpInc Earnings-Quality ──
// Wenn NetIncome > OpInc × 1.5 in mind. 2 von 3 Jahren → non-operating-Inflation
// (Pension-Gains, Asset-Sales, einmalige Gewinne).
function _filter_industrial_earnings_quality(stock) {
  const an = stock.annual || {};
  const oi = _arrayValues(an.annualOpInc).slice(0, 3);
  const ni = _arrayValues(an.annualNetIncome).slice(0, 3);
  if (oi.length < 3 || ni.length < 3) return null;

  let inflatedYears = 0;
  const evidence = [];
  for (let i = 0; i < 3; i++) {
    // Tag-8-Audit-Fix (Reviewer 1): negative-OpInc-Pfad. Wenn operativ Verlust
    // aber NetIncome positiv ist, sind one-time gains > -OpInc — also mehr als
    // den ganzen operativen Verlust kompensiert. Das ist ULTRA-suspicious und
    // wurde vom alten oi[i]>0-Gate übersehen.
    if (oi[i] > 0 && ni[i] > oi[i] * 1.5) {
      inflatedYears++;
      evidence.push(`Y-${i}: NetInc ${ni[i].toFixed(0)} vs OpInc ${oi[i].toFixed(0)} (×${(ni[i] / oi[i]).toFixed(2)})`);
    } else if (oi[i] <= 0 && ni[i] > Math.abs(oi[i]) * 0.5 && ni[i] > 0) {
      inflatedYears++;
      evidence.push(`Y-${i}: NetInc +${ni[i].toFixed(0)} trotz OpInc ${oi[i].toFixed(0)} (one-time gains überkompensieren operativen Verlust)`);
    }
  }
  if (inflatedYears >= 2) {
    return {
      code: 'EARNINGS_QUALITY_LOW_INDUSTRIAL',
      severity: 'INFO',
      detail: `Net-Income > OpInc×1.5 in ${inflatedYears}/3 Jahren — non-operating-Inflation. ${evidence.join('; ')}`,
      magnitude: inflatedYears
    };
  }
  return null;
}

// ─── Filter 4: MARKETPLACE — Revenue-vs-OpInc-Growth-Divergence ──
// Wenn Revenue-Growth ≥30% UND OpInc-Growth < (Rev-Growth - 10pp), dann
// User-Acquisition-driven Revenue ohne Profit-Skalierung.
function _filter_marketplace_opinc_lag(stock) {
  const an = stock.annual || {};
  const rev = _arrayValues(an.annualRev).slice(0, 2);
  const oi = _arrayValues(an.annualOpInc).slice(0, 2);
  if (rev.length < 2 || oi.length < 2) return null;
  if (rev[1] <= 0) return null;  // Pre-revenue companies: nicht anwendbar

  const revGrowth = (rev[0] - rev[1]) / Math.abs(rev[1]) * 100;
  if (revGrowth < 30) return null;  // Filter nur bei Hyper-Growth-Phase

  // OpInc kann negativ sein. Pragmatisch: pp-Differenz auf Margin-Basis statt Growth-Rate.
  // Hyper-Revenue-Growth ohne entsprechende OpInc-Verbesserung = User-Acquisition-Modus.
  const oiMargin0 = oi[0] / rev[0] * 100;
  const oiMargin1 = oi[1] / rev[1] * 100;
  const marginDelta = oiMargin0 - oiMargin1;

  // Wenn Revenue +30% wächst aber OpInc-Margin sinkt um >5pp, ist das Profit-Skalierung-Failure.
  if (marginDelta < -5) {
    return {
      code: 'OPINC_LAGS_REVENUE_MARKETPLACE',
      severity: 'INFO',
      detail: `Revenue +${revGrowth.toFixed(1)}% aber OpInc-Margin ${marginDelta.toFixed(1)}pp (von ${oiMargin1.toFixed(1)}% → ${oiMargin0.toFixed(1)}%) — User-Acquisition-Modus ohne Profit-Skalierung.`,
      magnitude: -marginDelta
    };
  }
  return null;
}

// ─── Filter-Registry ────────────────────────────────────────────
const FILTERS_BY_PROFILE = {
  SAAS: [_filter_saas_opinc_fcf_divergence],
  HARDWARE: [_filter_hardware_gm_volatility],
  INDUSTRIAL: [_filter_industrial_earnings_quality],
  MARKETPLACE: [_filter_marketplace_opinc_lag],
  // FINTECH, HEALTHCARE, OTHER: noch keine Filter — Tag-9+ Material
  FINTECH: [],
  HEALTHCARE: [],
  OTHER: []
};

// ─── Public API ─────────────────────────────────────────────────
function evaluate(stock, scoreResult) {
  if (!stock || !scoreResult) {
    return { codes: [], details: [] };
  }
  const subProfile = scoreResult.subProfile;
  if (!subProfile || !FILTERS_BY_PROFILE[subProfile]) {
    return { codes: [], details: [], skipped: 'no_profile_match' };
  }
  const filters = FILTERS_BY_PROFILE[subProfile];
  const codes = [];
  const details = [];
  for (const fn of filters) {
    try {
      const result = fn(stock);
      if (result) {
        codes.push(result.code);
        details.push(result);
      }
    } catch (e) {
      // Defensive: ein Filter-Crash darf den Pipeline-Pfad nicht killen.
      details.push({ code: 'MANIPULATION_FILTER_ERROR', error: e.message });
    }
  }
  return { codes, details, profile: subProfile };
}

const ManipulationFilters = {
  FILTER_VERSION,
  FILTERS_BY_PROFILE,
  evaluate,
  // Helpers exposed for tests
  _helpers: { _stdDev, _toNumber, _arrayValues }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ManipulationFilters;
} else if (typeof window !== 'undefined') {
  window.ManipulationFilters = ManipulationFilters;
}
