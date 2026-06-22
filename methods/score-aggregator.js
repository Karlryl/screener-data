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
    'revenue-growth-3y': 0.15,   // was 0.25 — revenue triple-counted via R40+RoX+rev-3y; redistributed
    'gross-margin-stability': 0.10,
    'profitability-state': 0.20, // was 0.15
    'hypergrowth-quality-class': 0.20  // was 0.15
  },
  QUALITY_COMPOUNDER: {
    'quality-compounder-roic': 0.25,
    'earnings-stability': 0.20,  // was 0.15 — absorbs above-200d-ma weight
    'margin-quality': 0.20,
    'reinvestment-rate': 0.15,
    'net-debt-ebitda': 0.10,
    'premium-compounder-proof': 0.05
    // fcf-yield removed (audit 2026-06-20): FCF/MarketCap is a VALUATION (cheap/expensive) signal —
    // it moves with share price, business unchanged — so it has no place in a quality-only score.
    // Owner mandate: the score measures quality only; valuation is done externally via Elliott waves.
    // computeScore normalizes by computedWeight, so deleting the line redistributes its 0.05
    // PROPORTIONALLY across the remaining 6 methods (no magic numbers, no threshold-discipline issue).
    // Empirical (4.7k snapshots): QC discrimination sd 22.68 -> 23.39, migration mostly upward; the
    // down-movers are exactly the cheap names that were getting a quality bonus for being cheap.
    // Rejected alternative: routing the 0.05 to premium-compounder-proof — it LOWERED discrimination
    // (sd 22.55) and down-tiered 174 names (premium-proof is a punitive 6/6 gate most names fail).
    // fcf-yield stays a DIAGNOSTIC/'prefer' display signal (strategy-modes.js QC core[]), just unscored.
    // above-200d-ma removed: technical price signal has no place in fundamental quality score
  },
  TURNAROUND: {
    'profitability-state': 0.25,
    'profitability-trend': 0.25,
    'altman-z-score': 0.20,
    'piotroski-f-score': 0.15,
    'revenue-growth-3y': 0.10,
    'estimate-revision-proxy': 0.05
  }
  // BUFFETT mode removed (audit 2026-06-20): it was a value+quality mode whose score rode on
  // dcf-intrinsic-value (margin-of-safety / discount-to-intrinsic) — a price-relative VALUATION bet,
  // which violates the quality-only mandate (valuation is external via Elliott waves). Feature
  // fully removed (mode + dashboard tab + buffett-criteria/owner-earnings/dcf-intrinsic-value).
};

// Red-Flag-Trigger: Markierung fuer Red-Flag-Section, plus Tier-Downgrade.
const RED_FLAG_RULES = {
  HIGH_DEBT: {
    id: 'net-debt-ebitda',
    // BUG-08 (audit 2026-06-08): when EBITDA is synthesized as OpInc×1.2 (no real
    // D&A in the snapshot), the ratio is understated by ~17% — a true >4.0 leverage
    // reads as ~3.3 and the red flag silently never fired. Compensate by lowering
    // the trigger to 4.0/1.2 ≈ 3.33 when the method reports approximationFlag.
    condition: function(val, result) {
      var approx = !!(result && result.components && result.components.approximationFlag);
      return val > (approx ? 4.0 / 1.2 : 4.0);
    },
    label: 'Net-Debt/EBITDA >4.0'
  },
  EXTREME_SLOAN: {
    id: 'sloan-ratio',
    // Tag 225a (audit F-224c-02 HIGH fix): sign-aware. Tag 216a used
    // Math.abs() which treated NEGATIVE_OK (cash > earnings = conservative
    // accounting, a Mauboussin good-quality signal) the same as positive
    // accrual manipulation. MELI's Sloan -20.6% triggered EXTREME_SLOAN and
    // downgraded HG raw=100 → NEAR_MISS for months. Mirror the asymmetry
    // Tag 221 added to sloan-ratio.js itself: only POSITIVE accruals above
    // FAIL_THRESHOLD are a red flag; negatives are informational (NEGATIVE_OK).
    condition: function(val) { return val > 0.20; },
    label: 'Sloan-Ratio extrem (>20%, positive Accruals)'
  }
  // Tag 121+: Dilution-Red-Flag wenn Share-Outstanding-Daten verfuegbar
};

// SAT (audit 2026-06-20): graduated-pass for the CONTINUOUS QC quality methods. Without it,
// normalizeMethodScore returns exactly 1.0 for ANY pass, so a method cleared by a wide margin scores
// the same as one barely passing -> the QC score saturates and cannot discriminate "excellent" from
// "ok" (measured: 5 of 7 QC methods returned 1.0 for every quality name). With it, a pass earns a
// floor of 0.80 plus up to 0.20 for the margin above threshold. OPT-IN allowlist: only continuous
// metrics graduate; count/categorical methods (premium-compounder-proof, profitability-state/trend,
// hypergrowth-quality-class, piotroski, earnings-stability) and ALL HG/TURNAROUND methods stay binary
// (return 1.0). Only QC-weighted methods are listed, so HG/TURNAROUND scores are byte-identical.
const GRADUATED_PASS_FLOOR = 0.80;
const GRADUATED_PASS = {
  'quality-compounder-roic': { mode: 'excess', band: 1.0 },   // ROIC at 2x threshold (~40%) -> full credit
  'margin-quality':          { mode: 'excess', band: 1.0 },
  'reinvestment-rate':       { mode: 'excess', band: 2.0 },   // noisier -> wider band before full credit
  'net-debt-ebitda':         { mode: 'headroom' }             // lte: lower leverage earns more credit
};

function gradedPassScore(methodResult, methodMeta, methodId) {
  var cfg = methodId && GRADUATED_PASS[methodId];
  if (!cfg) return 1.0;  // not allowlisted -> binary pass (categorical/count/HG/TURNAROUND)
  var v = methodResult.value;
  var th = methodResult.threshold != null ? methodResult.threshold : (methodMeta && methodMeta.threshold);
  if (v == null || typeof th !== 'number' || th === 0) return 1.0;  // cannot graduate -> full pass
  var frac;
  if (cfg.mode === 'headroom') {
    // lte: net-cash / negative / 999-sentinel -> full credit; else how far below the threshold.
    if (v <= 0 || v >= 900) return 1.0;
    frac = Math.max(0, Math.min(1, (th - v) / th));
  } else {
    // excess (gte): how far above threshold, scaled by the per-method band.
    frac = Math.max(0, Math.min(1, (v / th - 1) / cfg.band));
  }
  return GRADUATED_PASS_FLOOR + (1 - GRADUATED_PASS_FLOOR) * frac;
}

/**
 * Normalisiert ein Method-Result auf 0-1 Score-Punkt.
 * - pass=true                                   -> 1.0
 * - pass=false aber computable, near threshold  -> 0.1-0.7 graduiert
 * - nicht computable                             -> 0
 */
function normalizeMethodScore(methodResult, methodMeta, methodId) {
  if (!methodResult || !methodResult.computable) return 0;
  if (methodResult.pass) return gradedPassScore(methodResult, methodMeta, methodId);

  var val = methodResult.value;
  // Tag 155: prefer per-result threshold (e.g. piotroski scaledThreshold) over module-level meta.
  // piotroski buildResult() passes threshold:scaledThreshold so stocks with fewer computable signals
  // get normalized against the correct denominator, not always 6.
  var threshold = methodResult.threshold != null ? methodResult.threshold : (methodMeta && methodMeta.threshold);
  // Tag 152: guard non-numeric thresholds (e.g. profitability-state exports threshold:'TURNAROUND',
  // profitability-trend exports threshold:'FLAT') — dividing by a string produces NaN which
  // poisons weightedSum and turns any failing stock's score into NaN → silent REJECT mis-tier.
  // Tag 206l (Bug-Hunt Agent F MEDIUM-3): when threshold is non-numeric AND
  // pass is EXPLICITLY false, the method has rendered a definitive negative
  // verdict (e.g. profitability-state = LOSS when min acceptable is TURNAROUND).
  // The previous 0.3 partial-credit fallback was too generous for such verdicts.
  // Return 0.0 in that case. The 0.3 still applies when pass is undefined/null
  // (genuinely ambiguous) or value is missing — preserves graceful degradation.
  if (val == null || threshold == null || typeof threshold !== 'number') {
    return (methodResult.pass === false) ? 0.0 : 0.3;
  }

  var op = (methodMeta && methodMeta.thresholdOp) || 'gte';

  // F-ME-010: guard division by zero
  if (threshold === 0) return val > 0 ? 1.0 : 0.0;

  // Tag 232c-30 (audit F-ME-003 MEDIUM): alias 'lt' to 'lte' and 'gt' to 'gte'.
  // Three DIAGNOSTIC methods export `thresholdOp:'lt'/'gt'` (strict
  // inequalities). Pre-fix score-aggregator fell through to the generic
  // `return 0.3;` branch — silent, latent. The moment any of those methods
  // enters SCORE_WEIGHTS, every stock failing that method would inappropriately
  // score 0.3 (generic) instead of being properly graduated against threshold.
  // For graduated scoring the strict/non-strict distinction doesn't matter
  // (we're already past the pass branch), so aliasing is exact.
  if (op === 'lt') op = 'lte';
  else if (op === 'gt') op = 'gte';

  var ratio;
  if (op === 'gte') {
    ratio = val / threshold;
    // FC-01 (HIGH, audit 2026-06-20): gte mirror of the lte F-ME-201 guard. A multi-criteria
    // method (e.g. margin-quality exports value=gmMedian) can FAIL on a NON-exported dimension
    // (operating-margin floor / GM-decline) while its exported value still clears threshold
    // (ratio >= 1). The exported value is then NOT the binding constraint, so a definitive FAIL
    // must score 0 — not ride the graduation curve up to ~0.99. (pass===true already returned 1.0.)
    if (methodResult.pass === false && ratio >= 1.0) return 0.0;
  } else if (op === 'lte') {
    // Bug #8: val<=0 is always better than any positive threshold (e.g. negative EV, net-cash)
    // F-ME-201 (HIGH): only award the near-full-credit shortcut when the method did
    // NOT render an explicit negative verdict. earnings-stability returns
    // value=maxDecline=0 (val<=0) even when it FAILED its positive-years requirement
    // (pass===false); without this gate a failing 20%-weight QC input scored ~0.99.
    // We're already past the pass===true branch (returns 1.0), so here pass is either
    // false (explicit fail → don't reward) or undefined/null (no verdict → reward as before).
    if (val <= 0 && methodResult.pass !== false) return 0.99;
    if (val <= 0) return 0.0;  // explicit fail with val<=0 → no credit
    ratio = threshold / val;
  } else if (op === 'lte_abs') {
    // F-ME-011: proper handling for lte_abs — graduated scoring on absolute value.
    // Tag 206m (Bug-Hunt Agent F LOW): the prior `if (threshold === 0)` branch
    // was dead code — line 99's early guard `if (threshold === 0) return val > 0
    // ? 1.0 : 0.0;` returns first, making the inner check unreachable. Removed
    // the dead branch. Note: the early guard's `val > 0` semantics are subtly
    // wrong for hypothetical lte_abs methods with threshold===0 (which would
    // want `absVal === 0`), but no current method exports that combination —
    // sloan-ratio uses lte_abs with threshold=0.10, never 0. If a future method
    // does export lte_abs+threshold-0, gate line 99 by op first.
    var absVal = Math.abs(val);
    ratio = threshold / Math.max(absVal, 1e-10);
  } else {
    return 0.3;
  }

  // F-ME-012: smooth graduation curve — use linear interpolation to eliminate discontinuous jumps.
  // ratio >= 1.0 means at/above threshold (already handled by pass=true branch above)
  // ratio 0.0-1.0: linearly interpolate from 0 to 0.99 to approach but not reach 1.0
  // Keep the near-threshold region more granular for better scoring sensitivity.
  if (ratio >= 0.9) return Math.min(0.99, 0.7 + (ratio - 0.9) * 2.9);  // 0.9→0.70, 1.0→0.99
  if (ratio >= 0.7) return 0.3 + (ratio - 0.7) * 2.0;                   // 0.7→0.30, 0.9→0.70
  if (ratio >= 0.5) return 0.1 + (ratio - 0.5) * 1.0;                   // 0.5→0.10, 0.7→0.30
  return Math.max(0, ratio * 0.2);                                        // 0.0→0.00, 0.5→0.10
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
  'working-capital-anomaly': 6,     // Seasonal-Effekt oft normal
  // Tag 229d (audit F-227c-03 MEDIUM fix): net-debt-ebitda is the TURNAROUND
  // soft-guard (strategy-modes.js:143) and was missing here, silently relying
  // on the `|| 5` fallback. Pinned explicitly at 5 — identical effective
  // behavior, but the registry is now self-documenting and fixture-hash safe.
  'net-debt-ebitda': 5
};

// Tag 229d: track soft-guards we have warned about (one warn per process)
const _warnedMissingSoftGuard = Object.create(null);

function computeScore(allResults, modeId, methodRegistry, failedSoftGuards, dataQuality) {
  var weights = SCORE_WEIGHTS[modeId];
  if (!weights) return null;

  var breakdown = {};
  var weightedSum = 0;
  var computedWeight = 0;  // F-ME-023: only accumulate weight for computable methods
  var totalWeight = 0;

  for (var methodId in weights) {
    if (!Object.prototype.hasOwnProperty.call(weights, methodId)) continue;
    var weight = weights[methodId];
    var r = allResults[methodId];
    var meta = methodRegistry && methodRegistry[methodId];
    var s = normalizeMethodScore(r, meta, methodId);
    var isComputable = r && r.computable;
    breakdown[methodId] = {
      score: Math.round(s * 100) / 100,
      weight: weight,
      value: r ? r.value : null,
      computable: isComputable || false,
      pass: r ? r.pass : null
    };
    totalWeight += weight;
    if (isComputable) {
      // F-ME-023: only count weight for computable methods toward the denominator
      computedWeight += weight;
      weightedSum += s * weight;
    }
  }

  // F-ME-023: insufficient coverage check — require at least 40% of total weight to be computable
  if (computedWeight === 0) {
    return null; // no computable methods at all
  }
  // Tag 216a (audit F-216-02 HIGH fix): coverage threshold is mode-aware.
  // HYPERGROWTH legitimately has fewer computable methods for recent-IPO
  // candidates (CRDO/ALAB/PLTR-era): hypergrowth-quality-class needs 5y of
  // data, gross-margin-stability needs 5y rolling — neither computable for
  // a 2y-old company. With 40% threshold these names get silent REJECT even
  // though Rule-of-40 + Rev-Growth-3Y + Profitability-State all fire and
  // tell a coherent story. Anchor-safety rule says: never reject a known
  // true-positive on a guard threshold. Lower HG to 30% (rule-of-40 alone
  // is 0.25 + profitability-state 0.15 = 0.40, well above 0.30 floor;
  // rule-of-40 + rule-of-x = 0.35 also clears).
  // QC stays at 40% because its anchors (MSFT/COST/V) have full history.
  // TURNAROUND stays at 40% — by definition the company has data to turn
  // around FROM, so coverage shouldn't be sparse.
  var minCoverage = (modeId === 'HYPERGROWTH') ? 0.30 : 0.40;
  if (computedWeight / totalWeight < minCoverage) {
    return {
      score: null, tier: 'REJECT', redFlags: [], breakdown: breakdown,
      mode: modeId, computable: false, reason: 'insufficient-coverage',
      softGuardPenalty: 0, baseScore: null,
      dataQualityGrade: null, dataQualityCapped: false
    };
  }

  // F-ME-103 (audit 2026-06-11): TURNAROUND is fundamentally a profitability-
  // recovery thesis — profitability-state + profitability-trend carry half the
  // mode weight (0.50). The coverage gate above (40%) can pass on the remaining
  // 0.50 (altman + piotroski + rev-growth + estimate) alone, letting a stock reach
  // Tier A with ZERO profitability signal — the single thing TURNAROUND exists to
  // measure. Require at least one profitability method computable; else REJECT as
  // essential-signal-missing. Fixtures + anchors carry full data (both computable),
  // so this guard never fires there → fixture hash + anchor outcomes unchanged.
  if (modeId === 'TURNAROUND') {
    var _ps = allResults['profitability-state'];
    var _pt = allResults['profitability-trend'];
    if (!((_ps && _ps.computable) || (_pt && _pt.computable))) {
      return {
        score: null, tier: 'REJECT', redFlags: [], breakdown: breakdown,
        mode: modeId, computable: false, reason: 'turnaround-no-profitability-signal',
        softGuardPenalty: 0, baseScore: null,
        dataQualityGrade: null, dataQualityCapped: false
      };
    }
  }

  // F-ME-023: normalize against computed weight only (not total weight)
  var normScore = (weightedSum / computedWeight) * 100;
  var baseScore = Math.round(normScore);

  // Tag 120b: SoftGuard-Penalty anwenden
  var softGuardPenalty = 0;
  if (Array.isArray(failedSoftGuards)) {
    for (var i = 0; i < failedSoftGuards.length; i++) {
      var sgId = failedSoftGuards[i];
      // Tag 229d (audit F-227c-03 MEDIUM fix): explicit lookup with one-shot
      // warn on missing registration. The previous `|| 5` quietly swallowed
      // typo'd guard IDs AND a hypothetical guard explicitly weighted 0.
      // Now: unmapped guards still get 5 (no behavior change) but emit a
      // diagnostic log so registration drift surfaces in CI logs.
      var p = SOFT_GUARD_PENALTY[sgId];
      if (p == null) {
        if (!_warnedMissingSoftGuard[sgId]) {
          console.warn('[score-aggregator] soft-guard ' + sgId + ' has no penalty mapping; using default 5');
          _warnedMissingSoftGuard[sgId] = true;
        }
        p = 5;
      }
      softGuardPenalty += p;
    }
  }
  var score = Math.max(0, baseScore - softGuardPenalty);

  // Tag 199: Audit-precision score multipliers (opt-in via env
  // AUDIT_SCORE_MULTIPLIERS=1 to keep fixture-hash stable until Karl
  // explicitly opts in). Two multipliers:
  //
  //   1. q_spike_penalty: 0..0.5 proportional to q-spike-dataguard
  //      spikeShare in [0.40, 0.55]. Below 0.40 → no penalty. Above
  //      0.55 the DATAGUARD already hard-fails so we don't reach here.
  //      score *= (1 - q_spike_penalty)
  //
  //   2. fiscal-history-depth multiplier for QC tab only: scales score by
  //      min(clean_fiscal_years / 5, 1.0) — value is the listing-age method's
  //      count of consecutive non-null annual-revenue years (history DEPTH),
  //      NOT calendar/IPO age (gauntlet A4). 5y of clean history gets
  //      full credit; below 5y the score is pro-rated. QC by
  //      definition wants durable track record — a 1-2y old company
  //      can't be a "quality compounder" no matter how strong recent
  //      years look.
  var auditMultiplier = 1.0;
  var auditMultiplierApplied = false;
  // Tag 206l (Bug-Hunt Agent F LOW): accept multiple truthy env values.
  // Previously strict '1' only — 'true', 'yes', 'on', 'TRUE' silently failed
  // open (multipliers not applied), even though the user clearly intended
  // to enable them. Standardize on the conventional env-flag truthy set.
  var _amVal = (process.env.AUDIT_SCORE_MULTIPLIERS || '').toString().toLowerCase();
  var _amEnabled = (_amVal === '1' || _amVal === 'true' || _amVal === 'yes' || _amVal === 'on');
  if (_amEnabled) {
    var qSpikeRes = allResults['q-spike-dataguard'];
    if (qSpikeRes && qSpikeRes.computable && qSpikeRes.components &&
        Number.isFinite(qSpikeRes.components.spikeShare)) {
      var shareRaw = qSpikeRes.components.spikeShare;
      // Tag 227c-2 (audit F-227c-02 HIGH fix): q-spike-dataguard.js line 252/268
      // ALWAYS returns spikeShare as Math.round(spikeShare*100) — integer
      // percent in [0,100]. The previous `shareRaw > 1 ? shareRaw / 100 : shareRaw`
      // hedge was meant to handle a hypothetical fractional input but instead
      // misclassified the edge case `shareRaw === 1` (1% spike) as 1.0 (100%
      // spike) — triggering the max 50% q-spike penalty on stocks with
      // essentially uniform quarterly revenue. Today no stock in the universe
      // hits exactly 1, but the bug is latent: if a future hypergrowth pull
      // returns Q-distribution that rounds to 1%, the dashboard (which runs
      // with AUDIT_SCORE_MULTIPLIERS=1) would halve that stock's score with no
      // diagnostic trail. Always divide by 100 — matches the documented
      // contract and is robust to all integer-percent inputs.
      var share = shareRaw / 100;
      if (share > 0.40) {
        // Linear ramp 0.40 → 0%, 0.55 → 50%.
        var qSpikePenalty = Math.min(0.50, (share - 0.40) * (0.50 / 0.15));
        auditMultiplier *= (1 - qSpikePenalty);
        auditMultiplierApplied = true;
      }
    }
    if (modeId === 'QUALITY_COMPOUNDER') {
      var ageRes = allResults['listing-age'];
      if (ageRes && ageRes.computable && Number.isFinite(ageRes.value)) {
        // Tag 206h (Bug-Hunt Agent F MEDIUM-7 documentation):
        //   listing-age method threshold = 3 (minimum years for QC eligibility)
        //   score-aggregator divisor    = 5 (full QC credit at 5+ years)
        // The divergence is INTENTIONAL: 3y satisfies the must-eligibility gate
        // (else the stock isn't even classified as QC by classifyTabs), but 3y
        // of history is too thin for "premium compounder" — the linear-ramp
        // from 60% at 3y to 100% at 5y reflects that "established compounder"
        // requires more track record than the eligibility floor.
        // 3y → 60% credit | 4y → 80% credit | 5y+ → 100% credit
        var ageMultiplier = Math.min(1.0, ageRes.value / 5);
        auditMultiplier *= ageMultiplier;
        auditMultiplierApplied = true;
      }
    }
    // audit/fix (gauntlet D4): thin-HISTORY haircut for HYPERGROWTH, mirroring the
    // QC multiplier but with a /3 ramp (3y = the documented HG eligibility floor;
    // /5 would re-break recent-IPO true-positives the 0.30 coverage floor admits).
    // computeScore normalizes by computedWeight only, so a thin-history HG name can
    // otherwise score as favorably as a full-history peer.
    if (modeId === 'HYPERGROWTH') {
      var ageResHG = allResults['listing-age'];
      if (ageResHG && ageResHG.computable && Number.isFinite(ageResHG.value)) {
        var ageMultHG = Math.min(1.0, ageResHG.value / 3); // full credit at 3y; 2y->0.67, 1y->0.33
        auditMultiplier *= ageMultHG;
        auditMultiplierApplied = true;
      }
    }
    if (auditMultiplierApplied) {
      score = Math.max(0, Math.round(score * auditMultiplier));
    }
  }

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
    // BUG-08: pass the full method result so rules can inspect components
    // (HIGH_DEBT needs approximationFlag). Single-arg rules ignore the extra param.
    if (fr && fr.computable && fr.value != null && rule.condition(fr.value, fr)) {
      redFlags.push({ id: flagId, label: rule.label, value: fr.value });
    }
  }

  // Red-Flag fuehrt zu Tier-Downgrade (A/B -> NEAR_MISS)
  if (redFlags.length > 0 && (tier === 'A' || tier === 'B')) {
    tier = 'NEAR_MISS';
  }

  // Tag 133c: data-quality tier-cap (opt-in via env DATAQUALITY_ENFORCE=1).
  // Grade C: max NEAR_MISS. Grade D: REJECT. Default off bis Historie reift.
  // Tag 228b-2 (audit F-227c-05 LOW fix): accept multiple truthy env values
  // matching the AUDIT_SCORE_MULTIPLIERS pattern (Tag 206l). Previously the
  // strict `=== '1'` check silently failed open for 'true', 'yes', 'on', 'TRUE'
  // etc. — Karl would flip the flag expecting it to enable and the gate would
  // quietly stay off. No production behavior change while the flag is unset.
  var dataQualityCapped = false;
  var _dqVal = (process.env.DATAQUALITY_ENFORCE || '').toString().toLowerCase();
  var _dqEnabled = (_dqVal === '1' || _dqVal === 'true' || _dqVal === 'yes' || _dqVal === 'on');
  if (_dqEnabled && dataQuality && dataQuality.grade) {
    var cap = tierCapForGrade(dataQuality.grade);
    if (cap === 'REJECT') {
      tier = 'REJECT';
      dataQualityCapped = true;
    } else if (cap === 'NEAR_MISS') {
      // Tag 229d-2 (audit F-227c-04 MEDIUM fix): always flag the cap as
      // applied when grade-C maps to NEAR_MISS, even when tier is ALREADY
      // NEAR_MISS (e.g. red-flag downgrade from line 331). The downgrade
      // is a no-op only because the redundant cap matched the existing
      // tier — semantically the data-quality cap WAS the binding constraint,
      // and downstream UI/audit-trail (modes-report, screener.html data-quality
      // badge) deserves to know that. Previously a red-flag-downgraded
      // grade-C stock looked "only red-flagged" without the dq-cap badge.
      if (tier === 'A' || tier === 'B') tier = 'NEAR_MISS';
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
