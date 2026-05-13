'use strict';

// Tag 133c: optional data-quality tier-cap (env-gated to keep current behavior stable).
const { tierCapForGrade } = require('./data-quality.js');

/**
 * Tag 120: Score-Aggregator
 * =========================
 * Berechnet pro Stock pro Modus einen Score 0-100 basierend auf gewichteten
 * CORE-Methoden. Ergaenzt die binaere PASS/FAIL-Logik durch graduierte Bewertung.
 *
 * Architektur-Trennung (Tag 120 Konsens nach Triple-AI Battle R2):
 * - DATAGUARDs/Sector/Mcap-Excludes bleiben Hard-Fail (Hygiene-Schicht)
 * - CORE-Methoden werden Score-Inputs (Investment-Schicht, ehemalige MUSTs)
 * - Output: { score, tier, redFlags, breakdown }
 *
 * Tier-Klassifikation:
 * - A-Tier: Score >= 80
 * - B-Tier: Score 65-79
 * - NEAR_MISS: Score 50-64 oder >=65 mit Red-Flag (downgrade)
 * - REJECT: Score < 50
 */

const TIER_THRESHOLDS = {
  A: 80,
  B: 65,
  NEAR_MISS: 50
};

// Modus-spezifische Gewichte fuer CORE-Methoden (Summe ~1.0 pro Modus).
// Quelle: Tag 117 v2 Konsens + Triple-AI Battle R1/R2 Empfehlungen.
const SCORE_WEIGHTS = {
  HYPERGROWTH: {
    'rule-of-40': 0.25,
    'rule-of-x': 0.10,
    'revenue-growth-3y': 0.25,
    'gross-margin-stability': 0.10,
    'profitability-state': 0.15,
    'hypergrowth-quality-class': 0.15
  },
  QUALITY_COMPOUNDER: {
    'quality-compounder-roic': 0.25,
    'earnings-stability': 0.15,
    'margin-quality': 0.20,
    'reinvestment-rate': 0.15,
    'net-debt-ebitda': 0.10,
    'premium-compounder-proof': 0.05,
    'fcf-yield': 0.05,
    'above-200d-ma': 0.05
  },
  TURNAROUND: {
    'profitability-state': 0.25,
    'profitability-trend': 0.25,
    'altman-z-score': 0.20,
    'piotroski-f-score': 0.15,
    'revenue-growth-3y': 0.10,
    'estimate-revision-proxy': 0.05
  }
};

// Red-Flag-Trigger: Markierung fuer Red-Flag-Section, plus Tier-Downgrade.
const RED_FLAG_RULES = {
  HIGH_DEBT: {
    id: 'net-debt-ebitda',
    condition: function(val) { return val > 4.0; },
    label: 'Net-Debt/EBITDA >4.0'
  },
  EXTREME_SLOAN: {
    id: 'sloan-ratio',
    condition: function(val) { return Math.abs(val) > 0.30; },
    label: 'Sloan-Ratio extrem (|>30%|)'
  }
  // Tag 121+: Dilution-Red-Flag wenn Share-Outstanding-Daten verfuegbar
};

/**
 * Normalisiert ein Method-Result auf 0-1 Score-Punkt.
 * - pass=true                                   -> 1.0
 * - pass=false aber computable, near threshold  -> 0.1-0.7 graduiert
 * - nicht computable                             -> 0
 */
function normalizeMethodScore(methodResult, methodMeta) {
  if (!methodResult || !methodResult.computable) return 0;
  if (methodResult.pass) return 1.0;

  var val = methodResult.value;
  var threshold = methodMeta && methodMeta.threshold;
  // Tag 152: guard non-numeric thresholds (e.g. profitability-state exports threshold:'TURNAROUND',
  // profitability-trend exports threshold:'FLAT') — dividing by a string produces NaN which
  // poisons weightedSum and turns any failing stock's score into NaN → silent REJECT mis-tier.
  if (val == null || threshold == null || typeof threshold !== 'number') return 0.3;

  var op = (methodMeta && methodMeta.thresholdOp) || 'gte';
  var ratio;
  if (op === 'gte') {
    ratio = val / threshold;
  } else if (op === 'lte') {
    if (val <= 0) return 0.3;
    ratio = threshold / val;
  } else {
    return 0.3;
  }

  // Graduierte Naehe-Punkte:
  // ratio 0.9-1.0 -> 0.7-1.0
  // ratio 0.7-0.9 -> 0.3-0.7
  // ratio 0.5-0.7 -> 0.1-0.3
  // ratio <0.5    -> 0-0.1
  if (ratio >= 0.9) return Math.min(1.0, 0.7 + (ratio - 0.9) * 3);
  if (ratio >= 0.7) return 0.3 + (ratio - 0.7) * 2;
  if (ratio >= 0.5) return 0.1 + (ratio - 0.5) * 1;
  return Math.max(0, ratio * 0.2);
}

/**
 * Berechnet Score 0-100 fuer einen Stock in einem Modus.
 * VORAUSSETZUNG: Hygiene-Layer (DataGuards/Sector/Mcap) wurde bereits gepruft.
 * @param {Object} allResults - alle Method-Results aus runner.evaluateStock()
 * @param {string} modeId - HYPERGROWTH | QUALITY_COMPOUNDER | TURNAROUND
 * @param {Object} methodRegistry - optional: Method-Meta-Lookup fuer threshold/op
 * @returns {Object|null} { score, tier, redFlags, breakdown } oder null bei unbekanntem Modus
 */
// Tag 120b: SoftGuard-Penalty-Schwellen (Punkte Abzug pro failed SoftGuard)
const SOFT_GUARD_PENALTY = {
  // High-Severity SoftGuards (echte Investment-Sorgen)
  'q-spike-dataguard': 8,           // Q-Spike kann True-Hypergrowth-Discontinuity sein, aber auch fake
  'deceleration-guard': 10,         // Verlangsamung ist echtes Warnzeichen, aber S-Curve-Normal
  // Medium-Severity
  'revenue-shock-guard': 7, // Tag 120d: Single-Q-Revenue-Sprung sieht oft wie Shock aus bei True-Hypergrowth (NVDA)
  'quarter-concentration-guard': 6, // Single-Q-Dominanz oft normal bei Discontinuity
  'asset-growth-divergence': 8,     // M&A-Compounder triggern das fälschlich
  'working-capital-anomaly': 6      // Seasonal-Effekt oft normal
};

function computeScore(allResults, modeId, methodRegistry, failedSoftGuards, dataQuality) {
  var weights = SCORE_WEIGHTS[modeId];
  if (!weights) return null;

  var breakdown = {};
  var weightedSum = 0;
  var totalWeight = 0;

  for (var methodId in weights) {
    if (!Object.prototype.hasOwnProperty.call(weights, methodId)) continue;
    var weight = weights[methodId];
    var r = allResults[methodId];
    var meta = methodRegistry && methodRegistry[methodId];
    var s = normalizeMethodScore(r, meta);
    breakdown[methodId] = {
      score: Math.round(s * 100) / 100,
      weight: weight,
      value: r ? r.value : null,
      computable: r ? r.computable : false,
      pass: r ? r.pass : null
    };
    weightedSum += s * weight;
    totalWeight += weight;
  }

  var normScore = totalWeight > 0 ? (weightedSum / totalWeight) * 100 : 0;
  var baseScore = Math.round(normScore);

  // Tag 120b: SoftGuard-Penalty anwenden
  var softGuardPenalty = 0;
  if (Array.isArray(failedSoftGuards)) {
    for (var i = 0; i < failedSoftGuards.length; i++) {
      var sgId = failedSoftGuards[i];
      softGuardPenalty += SOFT_GUARD_PENALTY[sgId] || 5;
    }
  }
  var score = Math.max(0, baseScore - softGuardPenalty);

  // Tier-Klassifikation
  var tier;
  if (score >= TIER_THRESHOLDS.A) tier = 'A';
  else if (score >= TIER_THRESHOLDS.B) tier = 'B';
  else if (score >= TIER_THRESHOLDS.NEAR_MISS) tier = 'NEAR_MISS';
  else tier = 'REJECT';

  // Red-Flag-Detektion
  var redFlags = [];
  for (var flagId in RED_FLAG_RULES) {
    if (!Object.prototype.hasOwnProperty.call(RED_FLAG_RULES, flagId)) continue;
    var rule = RED_FLAG_RULES[flagId];
    var fr = allResults[rule.id];
    if (fr && fr.computable && fr.value != null && rule.condition(fr.value)) {
      redFlags.push({ id: flagId, label: rule.label, value: fr.value });
    }
  }

  // Red-Flag fuehrt zu Tier-Downgrade (A/B -> NEAR_MISS)
  if (redFlags.length > 0 && (tier === 'A' || tier === 'B')) {
    tier = 'NEAR_MISS';
  }

  // Tag 133c: data-quality tier-cap (opt-in via env DATAQUALITY_ENFORCE=1).
  // Grade C: max NEAR_MISS. Grade D: REJECT. Default off bis Historie reift.
  var dataQualityCapped = false;
  if (process.env.DATAQUALITY_ENFORCE === '1' && dataQuality && dataQuality.grade) {
    var cap = tierCapForGrade(dataQuality.grade);
    if (cap === 'REJECT') {
      tier = 'REJECT';
      dataQualityCapped = true;
    } else if (cap === 'NEAR_MISS' && (tier === 'A' || tier === 'B')) {
      tier = 'NEAR_MISS';
      dataQualityCapped = true;
    }
  }

  return {
    score: score,
    baseScore: baseScore,  // Tag 120b: Score ohne SoftGuard-Penalty
    tier: tier,
    redFlags: redFlags,
    softGuardPenalty: softGuardPenalty,  // Tag 120b: applied penalty
    breakdown: breakdown,
    mode: modeId,
    dataQualityGrade: dataQuality && dataQuality.grade || null,  // Tag 133c
    dataQualityCapped: dataQualityCapped                          // Tag 133c
  };
}

module.exports = {
  computeScore: computeScore,
  normalizeMethodScore: normalizeMethodScore,
  TIER_THRESHOLDS: TIER_THRESHOLDS,
  SCORE_WEIGHTS: SCORE_WEIGHTS,
  RED_FLAG_RULES: RED_FLAG_RULES,
  SOFT_GUARD_PENALTY: SOFT_GUARD_PENALTY  // Tag 120b
};
