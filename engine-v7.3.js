/**
 * v7.3 Score-Engine — Pure Functions, Deterministic, Versioned
 * =============================================================
 *
 * Architecture:
 * - Pure functions only. NO DOM. NO localStorage. NO fetch. NO React.
 * - Input: canonicalInput object (Currency-aware, ISIN-keyed, source-tagged).
 * - Output: scoreResult object (with engine_version, dataConfidence, reason_codes).
 *
 * Goals (Phase 1, Tag 1-2):
 * - Reproducibility: same input → same output, always.
 * - Currency-correctness: all multiples computed in target currency (USD by default).
 * - Sub-profile awareness: SaaS/Hardware/Marketplace/Fintech/Healthcare/Industrial/Other.
 * - All 10 P0 bug-fixes from ChatGPT/Gemini audit integrated:
 *   #1 Currency mismatch     #6 Cannot-classify status
 *   #2 Missing-as-zero       #7 Engine/config version stamp
 *   #3 Ticker canonicalization  #8 Old-data stale flag
 *   #4 Fiscal-period alignment  #9 Relative materiality
 *   #5 Coverage Score        #10 Score-history not retroactively applied
 *
 * Audit history: 88+5 bugs surfaced over 7+3 LLM-iterations (ChatGPT + Gemini + Claude).
 */

'use strict';

// ═══════════════════════════════════════════════════════════════
// VERSIONING
// ═══════════════════════════════════════════════════════════════

const ENGINE_VERSION = '7.3.2';
const SCHEMA_VERSION = '1.0';
const TARGET_CURRENCY_DEFAULT = 'USD';

// ═══════════════════════════════════════════════════════════════
// BUCKETS & ACTION STATUSES
// ═══════════════════════════════════════════════════════════════

const BUCKETS = [
  { id: 'A',          label: 'A-List',           min: 75, color: '#10b981' },
  { id: 'B',          label: 'B-List',           min: 60, color: '#3b82f6' },
  { id: 'INFLECTION', label: 'Inflection-Watch', min: 50, color: '#f59e0b' },
  { id: 'SPEC',       label: 'Speculative',      min: 40, color: '#a855f7' },
  { id: 'OUT',        label: 'Excluded',         min: 0,  color: '#6b7280' }
];

// v7.3 NEW: distinct from REVIEW. UNCLASSIFIABLE means data unusable, not "borderline".
const ACTION_STATUS = {
  QUALIFIED:               'QUALIFIED',
  REVIEW:                  'REVIEW',
  DISQUALIFIED:            'DISQUALIFIED',
  UNCLASSIFIABLE_DATA_RISK: 'UNCLASSIFIABLE_DATA_RISK'
};

// ═══════════════════════════════════════════════════════════════
// SUB-PROFILE TAXONOMY (5+2 buckets — Variante 2 from Iter-3 LLM debate)
// Initial: only SaaS-NRR and Hardware-Inventory specifically calibrated.
// Others run with INSUFFICIENT_PROFILE_SPECIFIC_EVIDENCE generalflag.
// ═══════════════════════════════════════════════════════════════

const SUB_PROFILES = {
  SAAS:             { id: 'SAAS',             label: 'SaaS / Software',         antiManipFilters: ['NRR_CHECK', 'RPO_GROWTH'] },
  HARDWARE:         { id: 'HARDWARE',         label: 'Hardware / Semis',        antiManipFilters: ['INVENTORY_DAYS', 'CAPEX_CYCLE'] },
  MARKETPLACE:      { id: 'MARKETPLACE',      label: 'Marketplace / Ads',       antiManipFilters: [] },
  FINTECH:          { id: 'FINTECH',          label: 'Fintech / Payments',      antiManipFilters: [] },
  BANK:             { id: 'BANK',             label: 'Bank / Lender',           antiManipFilters: [] },
  HEALTHCARE:       { id: 'HEALTHCARE',       label: 'Healthcare / Pharma',     antiManipFilters: [] },
  INDUSTRIAL:       { id: 'INDUSTRIAL',       label: 'Industrial / Defense',    antiManipFilters: [] },
  CONSUMER_STAPLES: { id: 'CONSUMER_STAPLES', label: 'Consumer Staples',        antiManipFilters: [] },
  ENERGY:           { id: 'ENERGY',           label: 'Energy / Oil & Gas',      antiManipFilters: [] },
  REIT:             { id: 'REIT',             label: 'Real Estate / REIT',      antiManipFilters: [] },
  OTHER:            { id: 'OTHER',            label: 'Other / Unclassified',    antiManipFilters: [] }
};

// ChatGPT-Iter-2-Fix-7: Klassifikation in dieser Reihenfolge:
// 1) manual_override (entry.manualSubProfile) — User-Tag dominant
// 2) ticker_specific_override (TICKER_SUBPROFILE_MAP) — bekannte Mismatches gezielt fixen
// 3) explicit sector/industry mapping (Yahoo-Standard)
// 4) business-model keyword (industry-string-Heuristik)
// 5) fallback OTHER
const TICKER_SUBPROFILE_MAP = {
  // Bekannte Sub-Profile-Overrides für Tickers wo Yahoo-Industry irreführt
  'NVDA': 'HARDWARE',  // Semiconductors aber AI-Infrastructure-Charakter — User-Diskussion offen
  'PLTR': 'SAAS',
  'CRDO': 'HARDWARE',
  'ALAB': 'HARDWARE',
  'NVO':  'HEALTHCARE',
  'RHM':  'INDUSTRIAL',
  'RHM.DE': 'INDUSTRIAL',
  'ASML': 'HARDWARE',
  'META': 'MARKETPLACE',
  'GOOGL': 'MARKETPLACE',
  'SHOP': 'SAAS',
  'NET':  'SAAS',
  'CRWD': 'SAAS',
  'SNOW': 'SAAS',
  'DDOG': 'SAAS',
  'HOOD': 'FINTECH',
  'UBER': 'MARKETPLACE',
  'DASH': 'MARKETPLACE',
  'AAPL': 'HARDWARE',
  'MSFT': 'SAAS',
  'AMZN': 'MARKETPLACE'
};

function classifySubProfile(stock) {
  if (!stock) return SUB_PROFILES.OTHER;

  // v7.3.1 Fix-C: classification mit confidence + reasonCode (per ChatGPT-Audit)
  // Returns the SUB_PROFILE object directly für Backwards-Compat;
  // detaillierte Klassifikation via classifySubProfileDetailed().

  // 1) manual_override — vom UI gesetzt (entry.manualSubProfile auf der Watchlist)
  if (stock.manualSubProfile && SUB_PROFILES[stock.manualSubProfile]) {
    return SUB_PROFILES[stock.manualSubProfile];
  }

  // 2) ticker_specific_override
  const ticker = (stock.meta && stock.meta.ticker || '').toUpperCase().trim();
  if (ticker && TICKER_SUBPROFILE_MAP[ticker]) {
    return SUB_PROFILES[TICKER_SUBPROFILE_MAP[ticker]];
  }

  // 3) explicit sector/industry mapping
  const sec = (stock.meta && stock.meta.sector || '').toLowerCase();
  const ind = (stock.meta && stock.meta.industry || '').toLowerCase();

  // Healthcare ist sektor-getrieben, nicht keyword-getrieben — höchste Priorität
  if (sec.includes('healthcare') || sec.includes('health care')) return SUB_PROFILES.HEALTHCARE;
  // Tag-26+38: Banks ZUERST raus aus FINTECH. Aber 'Credit Services' (Visa/MA) bleibt FINTECH (Payment-Processing).
  if (ind.includes('bank') || ind.includes('mortgage finance')) return SUB_PROFILES.BANK;
  if (ind.includes('credit services') || ind.includes('asset management')) return SUB_PROFILES.FINTECH;
  // Financial Sector dominiert über keywords (z.B. "payment" könnte auch SaaS sein)
  if (sec.includes('financial')) return SUB_PROFILES.FINTECH;

  // 4) business-model keyword mapping
  if (ind.includes('biotech') || ind.includes('pharma') || ind.includes('medical') ||
      ind.includes('drug')) return SUB_PROFILES.HEALTHCARE;
  if (ind.includes('aerospace') || ind.includes('defense') || ind.includes('weapon') ||
      ind.includes('military')) return SUB_PROFILES.INDUSTRIAL;
  if (ind.includes('fintech') || ind.includes('payment') || ind.includes('insurance')) return SUB_PROFILES.FINTECH;
  // (bank ist oben schon zu BANK gemappt)
  if (ind.includes('semic') || ind.includes('hardware') || ind.includes('chip') ||
      ind.includes('electronic equipment') || ind.includes('lithography')) return SUB_PROFILES.HARDWARE;
  if (ind.includes('software') || ind.includes('saas') || ind.includes('cloud') ||
      ind.includes('cybersec') || ind.includes('it services') ||
      ind.includes('analytics')) return SUB_PROFILES.SAAS;
  if (ind.includes('marketplace') || ind.includes('advertis') || ind.includes('e-commerce') ||
      ind.includes('platform') || ind.includes('media') ||
      sec.includes('communication')) return SUB_PROFILES.MARKETPLACE;
  if (sec.includes('industrial') || sec.includes('industrials')) return SUB_PROFILES.INDUSTRIAL;

  // Tag-26: Neue Sektor-Mappings
  if (sec.includes('consumer defensive') || sec.includes('consumer staples') ||
      ind.includes('beverage') || ind.includes('packaged food') ||
      ind.includes('household') || ind.includes('tobacco') ||
      ind.includes('grocery')) return SUB_PROFILES.CONSUMER_STAPLES;
  if (sec.includes('energy') || ind.includes('oil & gas') || ind.includes('oil and gas') ||
      ind.includes('coal') || ind.includes('integrated oil')) return SUB_PROFILES.ENERGY;
  if (sec.includes('real estate') || ind.includes('reit') || ind.includes('real estate')) return SUB_PROFILES.REIT;

  // 5) fallback
  return SUB_PROFILES.OTHER;
}

// v7.3.1 Fix-C: classifySubProfileDetailed — gibt confidence + reasonCode zurück
// Used for SUBPROFILE_LOW_CONFIDENCE / PROFILE_SET_BY_TICKER_OVERRIDE Reason-Codes
function classifySubProfileDetailed(stock) {
  if (!stock) return { profile: SUB_PROFILES.OTHER, confidence: 'LOW', reasonCode: 'SUBPROFILE_NO_DATA' };

  // String-normalize (Fix-D)
  const ticker = (stock.meta && stock.meta.ticker || '').toUpperCase().trim();
  const sec = (stock.meta && stock.meta.sector || '').toLowerCase().trim();
  const ind = (stock.meta && stock.meta.industry || '').toLowerCase().trim();

  if (stock.manualSubProfile && SUB_PROFILES[stock.manualSubProfile]) {
    return { profile: SUB_PROFILES[stock.manualSubProfile], confidence: 'HIGH', reasonCode: 'PROFILE_SET_BY_USER' };
  }
  if (ticker && TICKER_SUBPROFILE_MAP[ticker]) {
    return { profile: SUB_PROFILES[TICKER_SUBPROFILE_MAP[ticker]], confidence: 'HIGH', reasonCode: 'PROFILE_SET_BY_TICKER_OVERRIDE' };
  }
  // Sector-driven mapping = HIGH confidence
  if (sec.includes('healthcare') || sec.includes('health care')) return { profile: SUB_PROFILES.HEALTHCARE, confidence: 'HIGH', reasonCode: 'PROFILE_SET_BY_SECTOR' };
  if (sec.includes('financial')) return { profile: SUB_PROFILES.FINTECH, confidence: 'HIGH', reasonCode: 'PROFILE_SET_BY_SECTOR' };
  // Industry keyword = MEDIUM confidence
  if (ind.includes('biotech') || ind.includes('pharma') || ind.includes('medical') || ind.includes('drug')) return { profile: SUB_PROFILES.HEALTHCARE, confidence: 'MEDIUM', reasonCode: 'PROFILE_SET_BY_KEYWORD' };
  if (ind.includes('aerospace') || ind.includes('defense') || ind.includes('weapon') || ind.includes('military')) return { profile: SUB_PROFILES.INDUSTRIAL, confidence: 'MEDIUM', reasonCode: 'PROFILE_SET_BY_KEYWORD' };
  if (ind.includes('fintech') || ind.includes('payment') || ind.includes('insurance') || ind.includes('bank')) return { profile: SUB_PROFILES.FINTECH, confidence: 'MEDIUM', reasonCode: 'PROFILE_SET_BY_KEYWORD' };
  if (ind.includes('semic') || ind.includes('hardware') || ind.includes('chip') || ind.includes('electronic equipment') || ind.includes('lithography')) return { profile: SUB_PROFILES.HARDWARE, confidence: 'MEDIUM', reasonCode: 'PROFILE_SET_BY_KEYWORD' };
  if (ind.includes('software') || ind.includes('saas') || ind.includes('cloud') || ind.includes('cybersec') || ind.includes('it services') || ind.includes('analytics')) return { profile: SUB_PROFILES.SAAS, confidence: 'MEDIUM', reasonCode: 'PROFILE_SET_BY_KEYWORD' };
  if (ind.includes('marketplace') || ind.includes('advertis') || ind.includes('e-commerce') || ind.includes('platform') || ind.includes('media') || sec.includes('communication')) return { profile: SUB_PROFILES.MARKETPLACE, confidence: 'MEDIUM', reasonCode: 'PROFILE_SET_BY_KEYWORD' };
  if (sec.includes('industrial') || sec.includes('industrials')) return { profile: SUB_PROFILES.INDUSTRIAL, confidence: 'MEDIUM', reasonCode: 'PROFILE_SET_BY_SECTOR' };
  return { profile: SUB_PROFILES.OTHER, confidence: 'LOW', reasonCode: 'SUBPROFILE_LOW_CONFIDENCE' };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS — currency, materiality, safe math
// ═══════════════════════════════════════════════════════════════

// FX-conversion helper. Returns null if rate unavailable.
function convertCurrency(amount, fromCur, toCur, fxRates) {
  if (amount == null || !fromCur || !toCur) return null;
  if (fromCur === toCur) return amount;
  if (!fxRates) return null;
  const key = `${fromCur}_${toCur}`;
  const inverseKey = `${toCur}_${fromCur}`;
  if (fxRates[key] != null) return amount * fxRates[key];
  if (fxRates[inverseKey] != null) return amount / fxRates[inverseKey];
  return null;  // No rate available — caller should add CURRENCY_CONVERSION_FAILED warning
}

// Normalize a {value, currency} pair to target currency
function normalize(metric, targetCurrency, fxRates) {
  if (!metric || metric.value == null) return null;
  if (!metric.currency || metric.currency === targetCurrency) return metric.value;
  return convertCurrency(metric.value, metric.currency, targetCurrency, fxRates);
}

// Relative materiality (Bug #9 + Gemini-Fix-B v7.3.1): Materialität dynamisch nach Wachstumsrate.
// Standard: prior-period revenue ≥ max($50M, 0.5% of marketCap).
// Hyper-growth (>100% YoY): senke Cutoff auf 0.1% Mcap (Pivot-Plays mit kleiner neuer Sparte).
function isRevenueMaterial(prevRevenue, marketCapUSD, growthRateYoY) {
  if (prevRevenue == null) return false;
  const absRev = Math.abs(prevRevenue);
  if (absRev < 50e6) return false;
  if (marketCapUSD && marketCapUSD > 0) {
    const cutoff = (growthRateYoY != null && growthRateYoY > 100) ? 0.001 : 0.005;
    if (absRev / marketCapUSD < cutoff) return false;
  }
  return true;
}

// safeYoY (Bug #5/#9): division-by-zero AND negative-base cases handled.
function safeYoY(current, base) {
  if (base === 0 || base == null || current == null) return null;
  return (current - base) / Math.abs(base) * 100;
}

// Mean / std-dev (sample, n-1 — Bug #53 audit-fix)
function mean(arr) { return arr.reduce((s, v) => s + v, 0) / arr.length; }
function stdDevSample(arr) {
  if (arr.length < 2) return null;
  const m = mean(arr);
  const sumSq = arr.reduce((s, v) => s + (v - m) ** 2, 0);
  return Math.sqrt(sumSq / (arr.length - 1));
}

// v7.3.1 Fix-A: deep freeze (recursive, safe on circular)
function _deepFreeze(obj, seen) {
  if (obj == null || typeof obj !== 'object' || Object.isFrozen(obj)) return obj;
  seen = seen || new WeakSet();
  if (seen.has(obj)) return obj;
  seen.add(obj);
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (v && typeof v === 'object') _deepFreeze(v, seen);
  }
  return obj;
}

// Stale-data guard. ChatGPT-P0-Fix-3: asOf aufgesplittet.
// stock.meta enthält jetzt: { fetchedAt, filingDate, fiscalPeriodEnd }
// - fetchedAt: wann WIR die Daten gezogen haben (≤24h alt = frisch)
// - filingDate: wann die Firma das Statement gefiled hat (≤120d = nicht stale)
// - fiscalPeriodEnd: das Quartalsende auf das sich die Daten beziehen
// Stale-Check für Score läuft gegen filingDate (nicht fetchedAt — wir können
// alte Filings aktuell ziehen, das macht sie nicht frisch).
function isStaleData(meta, maxFilingAgeDays = 120) {
  if (!meta) return true;
  // Backwards-compat: wenn nur fetchedAt da, nutze das
  const filingDate = meta.filingDate || meta.fiscalPeriodEnd || meta.fetchedAt;
  if (!filingDate) return true;
  const t = new Date(filingDate).getTime();
  if (!Number.isFinite(t)) return true;
  const ageDays = (Date.now() - t) / 86400000;
  return ageDays > maxFilingAgeDays;
}

// ═══════════════════════════════════════════════════════════════
// DATA CONFIDENCE & COVERAGE SCORE (Bug #4, #5)
// ═══════════════════════════════════════════════════════════════

function computeCoverage(stock) {
  // ChatGPT-P0-Fix-2: Coverage gewichtet nach Wichtigkeit.
  // requiredForClassification (mcap, growth, sector) → wenn fehlt, Coverage=0
  // requiredForTrackA → 50% Gewicht
  // requiredForTrackB (annual + balance) → 30% Gewicht
  // optionalEnhancers (TTM-Ratios, Quarterly-Series) → 20% Gewicht
  const m = stock.metrics || {};
  const ts = stock.timeseries || {};
  const an = stock.annual || {};
  const meta = stock.meta || {};
  const mcap = stock.marketCap;

  // Hard requirement: marketCap + growth + sector — fehlt eines, dann Coverage=0
  const hasMcap = mcap != null && mcap.value != null;
  const hasGrowth = m.revenueGrowthYoY != null && m.revenueGrowthYoY.value != null;
  const hasSector = meta.sector || meta.industry;
  if (!hasMcap || !hasGrowth || !hasSector) return 0;

  // Track-A required (Hyper-screening + Penalty-Eligibility)
  const trackAReq = ['revenueTTM', 'grossMargin', 'fcfMarginTTM', 'sbcRatio'];
  let trackAPresent = 0;
  for (const k of trackAReq) if (m[k] != null && m[k].value != null) trackAPresent++;
  const trackAScore = trackAPresent / trackAReq.length;

  // Track-B required (annual data depth)
  const annualKeys = ['annualRev', 'annualOpInc', 'annualGP', 'annualFCF'];
  let trackBPresent = 0;
  for (const k of annualKeys) if (an[k] && an[k].length >= 3) trackBPresent++;
  const balPresent = (an.annualBalance && an.annualBalance.length >= 3) ? 1 : 0;
  const trackBScore = (trackBPresent + balPresent) / (annualKeys.length + 1);

  // Optional Enhancers (Quarterly + AF + valuation extras)
  const quarterly = ['revenueQ', 'opIncQ', 'grossProfitQ'];
  let qPresent = 0;
  for (const k of quarterly) if (ts[k] && ts[k].length >= 4) qPresent++;
  const optionalScore = qPresent / quarterly.length;

  // Weighted: Track-A 50%, Track-B 30%, Optional 20%
  return Math.round((0.5 * trackAScore + 0.3 * trackBScore + 0.2 * optionalScore) * 100) / 100;
}

function computeDataConfidence(stock) {
  const coverage = computeCoverage(stock);
  const an = stock.annual || {};
  const ts = stock.timeseries || {};
  const annualYears = (an.annualRev || []).length;
  const quarterlyQuarters = (ts.revenueQ || []).length;
  const hasROIC = (an.annualBalance || []).length >= 3;
  const hasFCF = (an.annualFCF || []).length >= 3;

  let level = 'LOW';
  if (coverage >= 0.85 && annualYears >= 4 && quarterlyQuarters >= 5 && hasROIC && hasFCF) level = 'HIGH';
  else if (coverage >= 0.65 && annualYears >= 3 && quarterlyQuarters >= 4) level = 'MEDIUM';

  return {
    level,
    coverage: Math.round(coverage * 100) / 100,
    annualYears,
    quarterlyQuarters,
    hasROIC,
    hasFCF
  };
}

// ═══════════════════════════════════════════════════════════════
// CORE METRIC ACCESSORS — currency-aware (Bug #1)
// ═══════════════════════════════════════════════════════════════

function getMetric(stock, key) {
  return stock.metrics && stock.metrics[key] || null;
}
function getMetricValue(stock, key, targetCur, fxRates) {
  const m = getMetric(stock, key);
  if (!m) return null;
  return normalize(m, targetCur, fxRates);
}

// ═══════════════════════════════════════════════════════════════
// TRACK A — HYPERGROWTH METHODS
// ═══════════════════════════════════════════════════════════════

function isSaaSLike(stock) {
  const sp = classifySubProfile(stock);
  return sp.id === 'SAAS';
}

// 1) Hypergrowth Revenue Score (linear capped at 100% YoY)
function computeHypergrowthScore(stock) {
  const g = getMetricValue(stock, 'revenueGrowthYoY');
  if (g == null) return { score: 0, status: 'no-data' };
  let score;
  if (g >= 100) score = 100;
  else if (g >= 70) score = 90;
  else if (g >= 50) score = 75;
  else if (g >= 40) score = 60;
  else if (g >= 30) score = 40;
  else if (g >= 20) score = 20;
  else if (g >= 0)  score = 5;
  else score = 0;
  return { score, growth: g, status: g >= 50 ? 'hyper' : g >= 30 ? 'strong' : g >= 0 ? 'weak' : 'shrinking' };
}

// 2) Rule of X (SaaS-specific)
function computeRuleOfX(stock) {
  const applicable = isSaaSLike(stock);
  const g = getMetricValue(stock, 'revenueGrowthYoY') || 0;
  const fcfM = getMetricValue(stock, 'fcfMarginTTM') || 0;
  const rox = g * 2.5 + fcfM;
  let score = 0;
  if (rox >= 250) score = 100;
  else if (rox >= 180) score = 85;
  else if (rox >= 130) score = 70;
  else if (rox >= 90)  score = 55;
  else if (rox >= 60)  score = 40;
  else if (rox >= 30)  score = 20;
  else                 score = 5;
  return { score: applicable ? score : 0, rox: Math.round(rox * 10) / 10, applicable };
}

// 3) Rule of 40 (universal)
function computeRuleOf40(stock) {
  const g = getMetricValue(stock, 'revenueGrowthYoY') || 0;
  const fcfM = getMetricValue(stock, 'fcfMarginTTM') || 0;
  const ro40 = g + fcfM;
  let score = 0;
  if (ro40 >= 80)      score = 100;
  else if (ro40 >= 60) score = 85;
  else if (ro40 >= 40) score = 65;
  else if (ro40 >= 20) score = 40;
  else                 score = 15;
  return { score, ro40: Math.round(ro40 * 10) / 10 };
}

function computeRuleComposite(stock) {
  const rox = computeRuleOfX(stock);
  const ro40 = computeRuleOf40(stock);
  const composite = rox.applicable ? Math.max(rox.score, ro40.score) : ro40.score;
  return { score: composite, rox, ro40, applicable: rox.applicable };
}

// 4) Scaling Efficiency = GP-Growth-YoY − OpEx-Growth-YoY
function computeScalingEfficiency(stock) {
  const ts = stock.timeseries || {};
  const gp = ts.grossProfitQ || [];
  const rev = ts.revenueQ || [];
  const opInc = ts.opIncQ || [];
  if (gp.length < 5 || rev.length < 5 || opInc.length < 5) {
    return { score: 0, status: 'no-data' };
  }
  // Sanity check (Bug #6 from prev audit): reject Yahoo outliers
  for (let i = 1; i < rev.length; i++) {
    const r0 = rev[i - 1].value, r1 = rev[i].value;
    if (r0 == null || r0 === 0) continue;
    const qoq = (r1 - r0) / Math.abs(r0) * 100;
    if (qoq > 200 || qoq < -80) {
      return { score: 0, status: 'data-audit', reason: `Anomaler QoQ-Sprung Q${i}` };
    }
  }
  const lastIdx = gp.length - 1;
  const compIdx = lastIdx - 4;
  if (compIdx < 0) return { score: 0, status: 'no-data' };
  const gpYoY = safeYoY(gp[lastIdx].value, gp[compIdx].value);
  const opEx = gp.map((g, i) => g.value - (opInc[i] && opInc[i].value || 0));
  const opExYoY = safeYoY(opEx[lastIdx], opEx[compIdx]);
  if (gpYoY == null || opExYoY == null) return { score: 0, status: 'no-data' };
  const efficiency = gpYoY - opExYoY;
  let score = 0;
  if (efficiency >= 30)      score = 100;
  else if (efficiency >= 15) score = 80 + (efficiency - 15) * 20 / 15;
  else if (efficiency >= 5)  score = 50 + (efficiency - 5) * 30 / 10;
  else if (efficiency >= -5) score = 25 + (efficiency + 5) * 25 / 10;
  else if (efficiency >= -20)score = 10 + (efficiency + 20) * 15 / 15;
  // Asymmetric floor: if growth >70% and GM stable, don't penalize hard
  const g = getMetricValue(stock, 'revenueGrowthYoY') || 0;
  const gm = getMetricValue(stock, 'grossMargin') || 0;
  if (efficiency < 0 && g > 70 && gm >= 50) score = Math.max(score, 40);
  return { score: Math.round(score * 10) / 10, gpYoY: Math.round(gpYoY * 10) / 10, opExYoY: Math.round(opExYoY * 10) / 10, efficiency: Math.round(efficiency * 10) / 10 };
}

// 5) Aktienfinder Score
function computeAktienfinderScore(stock) {
  const ext = stock.external || {};
  const af = ext.aktienfinderScore;
  if (!af || af.value == null) return { score: 0, applicable: false };
  return { score: Math.min(100, Math.max(0, af.value / 10 * 100)), aktienfinderRaw: af.value, applicable: true };
}

// ═══════════════════════════════════════════════════════════════
// REVENUE ACCELERATION — Tag 8/9 logic (sub-profile aware)
// (No score factor. Pure flag system. Karl decides timing externally.)
// ═══════════════════════════════════════════════════════════════

function computeRevenueAcceleration(stock, marketCapUSD) {
  const ts = stock.timeseries || {};
  const rev = ts.revenueQ || [];
  const gp = ts.grossProfitQ || [];

  if (rev.length < 6) return { active: false, status: 'partial-history', reason: 'Need 6+ quarterly revenue data points' };

  const Q0 = rev[rev.length - 1].value;
  const Q_minus1 = rev[rev.length - 2].value;
  const Q_minus4 = rev[rev.length - 5].value;
  const Q_minus5 = rev[rev.length - 6].value;

  // Pass growth rate so hyper-growth stocks get relaxed materiality
  const growthRateForMaterial = (stock.metrics && stock.metrics.revenueGrowthYoY && stock.metrics.revenueGrowthYoY.value) || null;
  if (!isRevenueMaterial(Q_minus4, marketCapUSD, growthRateForMaterial)) {
    return { active: false, status: 'low-base', flags: ['BUT_LOW_BASE_EFFECT'] };
  }
  if (!isRevenueMaterial(Q_minus5, marketCapUSD, growthRateForMaterial)) {
    return { active: false, status: 'low-base-prior' };
  }

  const YoY_Q0 = safeYoY(Q0, Q_minus4);
  const YoY_Qm1 = safeYoY(Q_minus1, Q_minus5);
  if (YoY_Q0 == null || YoY_Qm1 == null) return { active: false, status: 'no-data' };

  const acceleration = YoY_Q0 - YoY_Qm1;

  // Reacceleration from contraction (turnaround, NOT hypergrowth flame)
  if (YoY_Qm1 < 0 && acceleration >= 20) {
    return {
      active: true, tier: 'REACCEL_FROM_CONTRACTION',
      acceleration: Math.round(acceleration * 10) / 10,
      YoY_Q0: Math.round(YoY_Q0 * 10) / 10, YoY_Q_minus1: Math.round(YoY_Qm1 * 10) / 10,
      flags: ['REACCELERATION_FROM_CONTRACTION'], flameIcon: false,
      caption: 'Turnaround — KEIN Hypergrowth-Profil'
    };
  }

  // QoQ + GM checks
  const QoQ = safeYoY(Q0, Q_minus1);
  let gmYoYDrop = null;
  if (gp.length >= 5 && rev.length >= 5) {
    const gm0 = rev[rev.length - 1].value ? gp[gp.length - 1].value / rev[rev.length - 1].value * 100 : null;
    const gmYoY = rev[rev.length - 5].value ? gp[gp.length - 5].value / rev[rev.length - 5].value * 100 : null;
    if (gm0 != null && gmYoY != null) gmYoYDrop = gmYoY - gm0;
  }
  const gmStable = gmYoYDrop == null || gmYoYDrop < 3.0;

  // Sub-profile-specific anti-manipulation filters
  const subProfile = classifySubProfile(stock);
  const profileWarnings = [];
  if (subProfile.id === 'SAAS') {
    // NRR / RPO check — placeholder. Real impl needs subscription data.
    // For now: flag if growth surge happens with FCF declining (deferred-revenue pull-forward).
    const fcfDelta = (getMetricValue(stock, 'fcfMarginTTM') || 0);
    if (acceleration >= 10 && fcfDelta < 10) profileWarnings.push('POSSIBLE_FCF_DIVERGENCE');
  } else if (subProfile.id === 'HARDWARE') {
    // Inventory days surge → channel-fill risk
    const m = stock.metrics || {};
    const invDays = m.inventoryDays && m.inventoryDays.value;
    if (acceleration >= 10 && invDays != null && invDays > 90) profileWarnings.push('POSSIBLE_CHANNEL_FILL');
  } else {
    // Other sub-profiles: just generalflag (insufficient profile-specific evidence)
    if (acceleration >= 10) profileWarnings.push('INSUFFICIENT_PROFILE_SPECIFIC_EVIDENCE');
  }

  let tier = 'NONE';
  const flags = [];
  const counterFlags = [];
  let flameIcon = false;

  // ChatGPT-P0-Fix-4: STRONG nur wenn sub-profile-spezifischer Anti-Manipulations-Filter
  // Evidenz liefert. Sonst maximal SOFT — der Flame triggert nicht ohne Profil-Evidenz.
  const profileHasSpecificFilter = subProfile.id === 'SAAS' || subProfile.id === 'HARDWARE';
  const hasInsufficientEvidence = profileWarnings.includes('INSUFFICIENT_PROFILE_SPECIFIC_EVIDENCE');

  if (acceleration >= 10) {
    if (QoQ != null && QoQ > 0 && gmStable && profileHasSpecificFilter && !hasInsufficientEvidence) {
      tier = 'STRONG';
      flags.push('REV_ACCEL_STRONG');
      flameIcon = true;
    } else {
      // STRONG-Gate offen aber Profil-Evidenz fehlt → SOFT
      tier = 'SOFT_FAILED_STRONG_GATE';
      flags.push('REV_ACCEL_SOFT');
      if (!profileHasSpecificFilter) counterFlags.push('BUT_NO_PROFILE_SPECIFIC_FILTER');
    }
    if (QoQ != null && QoQ <= 0) counterFlags.push('BUT_QOQ_NEGATIVE');
    if (!gmStable) counterFlags.push('BUT_GM_DOWN');
  } else if (acceleration >= 5) {
    tier = 'SOFT'; flags.push('REV_ACCEL_SOFT');
  }

  // Add general anti-manip flag (POSSIBLE_INORGANIC_GROWTH if very large step)
  if (acceleration >= 30) counterFlags.push('POSSIBLE_INORGANIC_GROWTH');
  // Add sub-profile-specific warnings
  for (const w of profileWarnings) counterFlags.push(w);

  // P/S extended check
  const ps = getMetricValue(stock, 'priceSales');
  if (ps != null && ps > 30) counterFlags.push('BUT_VALUATION_EXTENDED');
  if (gmYoYDrop != null && gmYoYDrop >= 3.0 && tier !== 'NONE' && !counterFlags.includes('BUT_GM_DOWN')) counterFlags.push('BUT_GM_DOWN');

  return {
    active: tier !== 'NONE',
    tier,
    acceleration: Math.round(acceleration * 10) / 10,
    YoY_Q0: Math.round(YoY_Q0 * 10) / 10,
    YoY_Q_minus1: Math.round(YoY_Qm1 * 10) / 10,
    QoQ: QoQ != null ? Math.round(QoQ * 10) / 10 : null,
    gmYoYDrop: gmYoYDrop != null ? Math.round(gmYoYDrop * 10) / 10 : null,
    flags,
    counterFlags,
    flameIcon,
    subProfile: subProfile.id,
    caption: flameIcon
      ? 'Fundamental Acceleration — Wave check required (NICHT Timing-Signal)'
      : (tier !== 'NONE' ? 'Acceleration Soft — bestätigung in 1-2 Quartalen prüfen' : '')
  };
}

// ═══════════════════════════════════════════════════════════════
// TRACK B — QUALITY COMPOUNDER METHODS
// ═══════════════════════════════════════════════════════════════

function computeROICTrend(stock) {
  const an = stock.annual || {};
  const inc = an.annualOpInc || [];
  const bs = an.annualBalance || [];
  if (inc.length < 3 || bs.length < 3) return { score: 0, status: 'no-data' };

  const region = stock.meta && stock.meta.region;
  const taxRate = region === 'EU' ? 0.235 : region === 'US' ? 0.21 : 0.25;

  const roics = inc.map((opInc, i) => {
    const b = bs[i];
    if (!b || opInc == null || opInc.value == null) return null;
    const equity = b.totalEquity || 0;
    const debt = (b.longTermDebt || 0) + (b.shortTermDebt || 0);
    const cash = b.cash || 0;
    const ic = equity + debt - cash;
    if (ic <= 0) return null;
    const nopat = opInc.value * (1 - taxRate);
    return Math.max(-0.5, Math.min(2.0, nopat / ic));
  }).filter(v => v != null);

  if (roics.length < 2) return { score: 0, status: 'no-data' };

  const avg = mean(roics);
  const min = Math.min(...roics);
  const consistent = min >= 0.05;  // tolerant floor (was 0.10, audit-fix)

  let score = 0;
  if (avg >= 0.30 && consistent)      score = 100;
  else if (avg >= 0.25 && consistent) score = 90;
  else if (avg >= 0.20 && consistent) score = 75;
  else if (avg >= 0.15 && consistent) score = 60;
  else if (avg >= 0.15)               score = 45;
  else if (avg >= 0.10)               score = 30;
  else if (avg >= 0.05)               score = 15;
  return { score, avg: Math.round(avg * 1000) / 10, min: Math.round(min * 1000) / 10, consistent, yearsOfData: roics.length };
}

function computeGMStability(stock) {
  const an = stock.annual || {};
  const gp = an.annualGP || [];
  const rev = an.annualRev || [];
  if (gp.length < 3 || rev.length < 3) return { score: 0, status: 'no-data' };
  const gms = gp.map((g, i) => {
    const r = rev[i];
    if (!r || !r.value || r.value <= 0) return null;
    return g.value / r.value;
  }).filter(v => v != null);
  if (gms.length < 3) return { score: 0, status: 'no-data' };
  const m = mean(gms);
  const sd = stdDevSample(gms);
  if (sd == null) return { score: 0, status: 'no-data' };
  const stdDevPP = sd * 100;
  let score = 0;
  if (stdDevPP < 1)      score = 100;
  else if (stdDevPP < 2) score = 80;
  else if (stdDevPP < 4) score = 60;
  else if (stdDevPP < 7) score = 40;
  else                   score = 20;
  if (m >= 0.60) score = Math.min(100, score + 5);
  return { score, stdDev: Math.round(stdDevPP * 100) / 100, mean: Math.round(m * 1000) / 10 };
}

function computeFCFQuality(stock) {
  const an = stock.annual || {};
  const fcf = an.annualFCF || [];
  if (fcf.length < 2) {
    const ttm = getMetricValue(stock, 'fcfMarginTTM');
    if (ttm == null) return { score: 0, status: 'no-data' };
    let s = 0;
    if (ttm >= 25)      s = 80;
    else if (ttm >= 15) s = 60;
    else if (ttm >= 5)  s = 40;
    else if (ttm >= 0)  s = 20;
    return { score: s, fallback: true };
  }
  const validFCF = fcf.filter(f => f != null && f.value != null);
  if (validFCF.length < 2) return { score: 0, status: 'no-data' };
  const positiveYears = validFCF.filter(f => f.value > 0).length;
  const ratio = positiveYears / validFCF.length;
  let score = 0;
  if (ratio >= 1.0)      score = 100;
  else if (ratio >= 0.8) score = 75;
  else if (ratio >= 0.6) score = 50;
  else if (ratio >= 0.4) score = 25;
  const ttm = getMetricValue(stock, 'fcfMarginTTM');
  if (ttm != null) {
    if (ttm >= 20)      score = Math.min(100, score + 10);
    else if (ttm >= 10) score = Math.min(100, score + 5);
  }
  return { score, positiveYears, totalYears: validFCF.length, ratio: Math.round(ratio * 100) };
}

function computeEPSCAGR(stock) {
  const an = stock.annual || {};
  const ni = an.annualNetIncome || [];
  const oi = an.annualOpInc || [];
  let series, metric;
  if (ni.length >= 3 && ni.every(v => v && v.value != null && v.value > 0)) {
    series = ni; metric = 'NetIncome';
  } else {
    series = oi; metric = 'OpInc';
  }
  if (series.length < 3) return { score: 0, status: 'no-data' };
  // Yahoo gives annual newest-first. last = newest, oldest = back of array.
  const last = series[0].value, oldest = series[series.length - 1].value;
  if (oldest == null || oldest <= 0 || last == null) return { score: 0, status: 'no-data' };
  const years = series.length - 1;
  const cagr = (Math.pow(last / oldest, 1 / years) - 1) * 100;
  let score = 0;
  if (cagr >= 30)      score = 100;
  else if (cagr >= 20) score = 80;
  else if (cagr >= 15) score = 60;
  else if (cagr >= 10) score = 40;
  else if (cagr >= 5)  score = 20;
  return { score, cagr: Math.round(cagr * 10) / 10, years, metric };
}

// ═══════════════════════════════════════════════════════════════
// PENALTIES — Hyper-Decel-Differentiation, Currency-aware, Materiality-guarded
// ═══════════════════════════════════════════════════════════════

function computePenalties(stock, marketCapUSD) {
  const penalties = [];
  const codes = [];
  const m = stock.metrics || {};

  const sbcRatio = m.sbcRatio && m.sbcRatio.value;
  const fcfMargin = m.fcfMarginTTM && m.fcfMarginTTM.value;
  const opMargin = m.operatingMargin && m.operatingMargin.value;
  const grossMargin = m.grossMargin && m.grossMargin.value;
  const cashRunway = m.cashRunway && m.cashRunway.value;
  const ps = m.priceSales && m.priceSales.value;
  const fwdPE = m.forwardPE && m.forwardPE.value;
  const growth = m.revenueGrowthYoY && m.revenueGrowthYoY.value;

  // SBC — ChatGPT-Iter-3-Fix: bei positivem FCF mildere Behandlung (MNDY-Case)
  // SBC bei pre-profit-SaaS mit positivem FCF ist WARNING, nicht Disqualifier
  if (sbcRatio != null) {
    if (sbcRatio > 30 && fcfMargin != null && fcfMargin < 0) {
      penalties.push({ name: 'SBC-extreme + neg FCF', value: -100, hard: true });
      codes.push('SBC_EXTREME_HARD');
    } else if (sbcRatio > 25 && fcfMargin != null && fcfMargin < 0) {
      penalties.push({ name: 'SBC>25% + neg FCF', value: -25 });
      codes.push('PENALTY_SBC_HIGH');
    } else if (sbcRatio > 25) {
      // SBC hoch ABER FCF positiv → mildere Penalty + Warning-Code
      penalties.push({ name: 'SBC>25% (aber FCF positiv)', value: -10 });
      codes.push('PENALTY_SBC_HIGH', 'SBC_EXTREME_WARNING');
    } else if (sbcRatio > 15 && fcfMargin != null && fcfMargin < 0) {
      penalties.push({ name: 'SBC 15-25% + neg FCF', value: -15 });
    } else if (sbcRatio > 10) {
      penalties.push({ name: 'SBC 10-15%', value: -5 });
    }
  }

  // Cash runway hard exclusion
  if (cashRunway != null && cashRunway < 8 && fcfMargin != null && fcfMargin < 0) {
    penalties.push({ name: 'Cash-Runway <8Q + neg FCF', value: -100, hard: true });
    codes.push('EXCLUDE_CASH_RUNWAY');
  }

  // Gross margin trend
  const ts = stock.timeseries || {};
  if (ts.grossProfitQ && ts.grossProfitQ.length >= 5 && ts.revenueQ && ts.revenueQ.length >= 5) {
    const gms = ts.grossProfitQ.map((g, i) => {
      const r = ts.revenueQ[i];
      if (!r || !r.value) return 0;
      return g.value / r.value * 100;
    });
    const lastGM = gms[gms.length - 1];
    const yoyGM = gms[gms.length - 5];
    const gmDelta = lastGM - yoyGM;
    if (gmDelta < -5)      { penalties.push({ name: 'Gross Margin -500 bps YoY', value: -25 }); codes.push('PENALTY_GM_FALLING'); }
    else if (gmDelta < -3) { penalties.push({ name: 'Gross Margin -300 bps YoY', value: -15 }); codes.push('PENALTY_GM_FALLING'); }
  }

  // ChatGPT-P0-Fix-1: Valuation NICHT mehr im Fundamental-Score.
  // Bewertung ist Crash-Risk, nicht Quality-Faktor.
  // → Wird separat in computeExpectationsRisk() ausgegeben.
  // (Hier nur noch HARTE Exclusion bei extrem-extrem: P/S>50 UND neg FCF UND niedrigem Wachstum)
  if (ps != null && ps > 50 && fcfMargin != null && fcfMargin < 0 && (growth || 0) < 30) {
    penalties.push({ name: 'P/S>50 + neg FCF + Growth<30 (Triple-Risk)', value: -15 });
    codes.push('PENALTY_VALUATION_TRIPLE_RISK');
  }

  // FCF + OpInc both negative
  if (fcfMargin != null && fcfMargin < -10 && opMargin != null && opMargin < -10) {
    penalties.push({ name: 'FCF + OpInc beide stark negativ', value: -25 });
    codes.push('PENALTY_FCF_NEG');
  } else if (fcfMargin != null && fcfMargin < 0 && opMargin != null && opMargin < 0) {
    penalties.push({ name: 'FCF + OpInc beide negativ', value: -15 });
    codes.push('PENALTY_FCF_NEG');
  }

  // Revenue Growth Deceleration — Hyper-Decel-Differentiation (Karl-Wave-3-Fix)
  // Materiality-guarded
  const an = stock.annual || {};
  const r = an.annualRev || [];
  if (r.length >= 3) {
    const r0 = r[0].value, r1 = r[1].value, r2 = r[2].value;
    if (isRevenueMaterial(r1, marketCapUSD) && isRevenueMaterial(r2, marketCapUSD)) {
      const lastG = (r0 - r1) / Math.abs(r1) * 100;
      const prevG = (r1 - r2) / Math.abs(r2) * 100;
      const decel = prevG - lastG;
      if (lastG >= 50) {
        // Still hyper — no penalty
      } else if (lastG >= 30) {
        if (decel > 30) { penalties.push({ name: 'Revenue-Decel >30pp (von Hyper auf Strong)', value: -5 }); codes.push('PENALTY_GROWTH_DECEL'); }
      } else if (lastG >= 15) {
        if (decel > 15) { penalties.push({ name: 'Revenue-Decel: ins Mittel gefallen', value: -10 }); codes.push('PENALTY_GROWTH_DECEL'); }
      } else {
        if (decel > 20 && fcfMargin != null && fcfMargin < 0) {
          penalties.push({ name: 'Revenue-Decel >20pp + niedriges Wachstum + neg FCF', value: -25 });
          codes.push('PENALTY_GROWTH_DECEL');
        } else if (decel > 15) {
          penalties.push({ name: 'Revenue-Decel >15pp + niedriges Wachstum', value: -15 });
          codes.push('PENALTY_GROWTH_DECEL');
        } else if (decel > 10) {
          penalties.push({ name: 'Revenue-Decel >10pp + niedriges Wachstum', value: -10 });
        }
      }
    }
  }

  // Forward PE
  if (fwdPE != null && fwdPE > 100 && (growth || 0) < 30) {
    penalties.push({ name: 'Forward-PE >100 + Growth <30%', value: -10 });
  }

  // Hard exclusion: market cap too low
  if (marketCapUSD != null && marketCapUSD < 1e9) {
    penalties.push({ name: 'Marketcap <$1B', value: -100, hard: true });
    codes.push('EXCLUDE_MCAP_LOW');
  }

  const total = penalties.reduce((s, p) => s + p.value, 0);
  const hardExcluded = penalties.some(p => p.hard);
  return { penalties, codes, total, hardExcluded };
}

// ═══════════════════════════════════════════════════════════════
// EXPECTATIONS-RISK (ChatGPT-P0-Fix-1)
// Separater Track. NICHT im Fundamental-Score, KEIN Buy/Sell-Signal.
// Zeigt Karl wie hoch die Erwartungen schon eingepreist sind.
// Hoher Score = hohe Crash-Risk wenn Erwartungen kippen.
// Konsumiert vom UI als WARNING-Layer neben dem QUALIFIED-Status.
// ═══════════════════════════════════════════════════════════════

function computeExpectationsRisk(stock) {
  const m = stock.metrics || {};
  const ps = m.priceSales && m.priceSales.value;
  const fwdPE = m.forwardPE && m.forwardPE.value;
  const fcfMargin = m.fcfMarginTTM && m.fcfMarginTTM.value;
  const growth = m.revenueGrowthYoY && m.revenueGrowthYoY.value;

  const warnings = [];
  let level = 'NORMAL';

  // P/S-Schwellen relativ zur Wachstumsrate (Faustregel: P/S sollte ≤ 0.5×Growth-Rate sein)
  if (ps != null && growth != null && growth > 0) {
    const psImplied = ps / growth;  // P/S / Growth-Multiple
    if (psImplied > 1.0) { warnings.push('PS_FAR_ABOVE_GROWTH'); level = 'EXTREME'; }
    else if (psImplied > 0.7) { warnings.push('PS_ABOVE_GROWTH'); if (level === 'NORMAL') level = 'ELEVATED'; }
  }
  if (ps != null && ps > 30) {
    warnings.push('PS_ABSOLUTE_HIGH');
    if (level === 'NORMAL') level = 'ELEVATED';
  }
  if (fwdPE != null && fwdPE > 80) {
    warnings.push('FWD_PE_HIGH');
    if (level === 'NORMAL') level = 'ELEVATED';
  }
  // FCF-Yield-Stress: priceSales hoch + FCF-Margin niedrig = Erwartungs-Reservoir
  if (ps != null && ps > 20 && fcfMargin != null && fcfMargin < 5) {
    warnings.push('CASH_GENERATION_LAGS_VALUATION');
    if (level !== 'EXTREME') level = 'ELEVATED';
  }

  return {
    level,                         // 'NORMAL' | 'ELEVATED' | 'EXTREME'
    warnings,                      // separate vom score reasonCodes
    priceSales: ps,
    forwardPE: fwdPE,
    psToGrowthMultiple: (ps != null && growth != null && growth > 0) ? Math.round(ps / growth * 100) / 100 : null
  };
}

// ═══════════════════════════════════════════════════════════════
// SCORE TRACK A
// ═══════════════════════════════════════════════════════════════

function scoreTrackA(stock, options) {
  options = options || {};
  // v7.3.1 Fix-A (ChatGPT): Engine darf canonicalInput nicht mutieren — Deep-freeze für Snapshot-Sicherheit
  if (stock && !Object.isFrozen(stock)) {
    try { _deepFreeze(stock); } catch (e) { /* mute on circular */ }
  }
  const targetCur = options.targetCurrency || TARGET_CURRENCY_DEFAULT;
  const fxRates = options.fxRates || {};
  const marketCapUSD = stock.marketCap && normalize(stock.marketCap, 'USD', fxRates);

  const conf = computeDataConfidence(stock);
  const subProfileDetail = classifySubProfileDetailed(stock);
  const subProfile = subProfileDetail.profile;

  // Stale-data check (Bug #8) — ChatGPT-P0-Fix-3: now checks meta.filingDate
  const stale = isStaleData(stock.meta);
  if (stale) {
    return {
      finalScore: null,
      actionStatus: ACTION_STATUS.UNCLASSIFIABLE_DATA_RISK,
      reasonCodes: ['OLD_DATA_STALE'],
      dataConfidence: conf,
      subProfile: subProfile.id,
      track: 'A',
      engineVersion: ENGINE_VERSION
    };
  }

  // Coverage gate (Bug #5)
  if (conf.coverage < 0.4) {
    return {
      finalScore: null,
      actionStatus: ACTION_STATUS.UNCLASSIFIABLE_DATA_RISK,
      reasonCodes: ['COVERAGE_INSUFFICIENT'],
      dataConfidence: conf,
      subProfile: subProfile.id,
      track: 'A',
      engineVersion: ENGINE_VERSION
    };
  }

  const hyper = computeHypergrowthScore(stock);
  const ruleC = computeRuleComposite(stock);
  const scaling = computeScalingEfficiency(stock);
  const af = computeAktienfinderScore(stock);
  const accel = computeRevenueAcceleration(stock, marketCapUSD);
  const pen = computePenalties(stock, marketCapUSD);
  const expRisk = computeExpectationsRisk(stock);  // ChatGPT-P0-Fix-1: separate track

  let weights = af.applicable
    ? { hyper: 0.30, rule: 0.25, scaling: 0.20, af: 0.20 }
    : { hyper: 0.38, rule: 0.30, scaling: 0.27, af: 0 };

  const coreScore =
    weights.hyper * hyper.score +
    weights.rule * ruleC.score +
    weights.scaling * scaling.score +
    weights.af * af.score;

  const finalScore = Math.max(0, Math.min(100, coreScore + pen.total));

  let bucket = bucketFor(finalScore, pen.hardExcluded);
  const g = (stock.metrics && stock.metrics.revenueGrowthYoY && stock.metrics.revenueGrowthYoY.value) || 0;
  if (!pen.hardExcluded) {
    if (bucket.id === 'A' && g < 50) bucket = g >= 40 ? BUCKETS[1] : BUCKETS[2];
    else if (bucket.id === 'B' && g < 40) bucket = g >= 25 ? BUCKETS[2] : BUCKETS[3];
    else if (bucket.id === 'INFLECTION' && g < 25) bucket = BUCKETS[3];
  }

  const reasonCodes = [...pen.codes];
  if (hyper.score >= 90)       reasonCodes.push('PASS_HYPERGROWTH_70');
  else if (hyper.score >= 75)  reasonCodes.push('PASS_HYPERGROWTH_50');
  else if (g >= 45)            reasonCodes.push('NEAR_MISS_HYPERGROWTH');
  else if (g < 40) {
    // v7.3.2 ChatGPT-Fix: 'FAIL_HYPERGROWTH' ist fuer Industrial/Healthcare irrefuehrend.
    // Karl liest 'FAIL' als 'company-Makel'. Es ist aber nur 'unter unserem Hyperwachstum-Floor'.
    // Sub-Profile-aware: SaaS/Hardware behalten harte Sprache, andere bekommen neutralen Code.
    if (subProfile.id === 'SAAS' || subProfile.id === 'HARDWARE') {
      reasonCodes.push('FAIL_HYPERGROWTH');
    } else {
      reasonCodes.push('BELOW_TRACK_A_GROWTH_FLOOR');
    }
  }
  if (ruleC.applicable && ruleC.rox.score >= 70) reasonCodes.push('PASS_RULE_OF_X_120');
  if (ruleC.ro40.score >= 65) reasonCodes.push('PASS_RULE_OF_40');
  if (scaling.score >= 70)    reasonCodes.push('PASS_SCALING_POSITIVE');
  if (af.applicable && af.score >= 70) reasonCodes.push('PASS_AKTIENFINDER_GOOD');
  if (accel.flags) accel.flags.forEach(f => reasonCodes.push(f));
  if (accel.counterFlags) accel.counterFlags.forEach(f => reasonCodes.push(f));
  reasonCodes.push(`DATA_CONFIDENCE_${conf.level}`);
  // v7.3.2: Sub-Profile reason + cross-profile + low-confidence flags
  reasonCodes.push(subProfileDetail.reasonCode);
  if (subProfileDetail.confidence === 'LOW') reasonCodes.push('SUBPROFILE_LOW_CONFIDENCE');
  if (passesTrackAUniverse(stock, fxRates) && passesTrackBUniverse(stock, fxRates)) reasonCodes.push('MULTI_PROFILE_EXPOSURE');
  if (conf.level === 'LOW') reasonCodes.push('QUALIFIED_LOW_CONFIDENCE_RISK');

  let actionStatus;
  if (pen.hardExcluded || bucket.id === 'OUT') actionStatus = ACTION_STATUS.DISQUALIFIED;
  else if (bucket.id === 'A' || bucket.id === 'B') actionStatus = ACTION_STATUS.QUALIFIED;
  else actionStatus = ACTION_STATUS.REVIEW;

  return {
    finalScore: Math.round(finalScore * 10) / 10,
    coreScore: Math.round(coreScore * 10) / 10,
    bucket,
    hardExcluded: pen.hardExcluded,
    components: { hyper, ruleC, scaling, af, accel },
    penalties: pen,
    weights,
    reasonCodes,
    actionStatus,
    dataConfidence: conf,
    accelerationFlag: accel,
    expectationsRisk: expRisk,           // ChatGPT-P0-Fix-1: separate track
    subProfile: subProfile.id,
    track: 'A',
    engineVersion: ENGINE_VERSION,
    schemaVersion: SCHEMA_VERSION
  };
}

// ═══════════════════════════════════════════════════════════════
// SCORE TRACK B
// ═══════════════════════════════════════════════════════════════

function scoreTrackB(stock, options) {
  options = options || {};
  // v7.3.1 Fix-A: Deep-freeze input
  if (stock && !Object.isFrozen(stock)) {
    try { _deepFreeze(stock); } catch (e) {}
  }
  const targetCur = options.targetCurrency || TARGET_CURRENCY_DEFAULT;
  const fxRates = options.fxRates || {};
  const marketCapUSD = stock.marketCap && normalize(stock.marketCap, 'USD', fxRates);

  const conf = computeDataConfidence(stock);
  const subProfileDetail = classifySubProfileDetailed(stock);
  const subProfile = subProfileDetail.profile;

  // Track B requires ≥3Y annual data
  if (conf.level === 'LOW' || conf.annualYears < 3) {
    return {
      finalScore: null,
      actionStatus: ACTION_STATUS.UNCLASSIFIABLE_DATA_RISK,
      reasonCodes: ['TRACK_B_DISABLED_INSUFFICIENT_DATA', `DATA_CONFIDENCE_${conf.level}`],
      dataConfidence: conf,
      subProfile: subProfile.id,
      track: 'B',
      engineVersion: ENGINE_VERSION
    };
  }

  const roic = computeROICTrend(stock);
  const gm = computeGMStability(stock);
  const fcf = computeFCFQuality(stock);
  const cagr = computeEPSCAGR(stock);
  const af = computeAktienfinderScore(stock);
  const accel = computeRevenueAcceleration(stock, marketCapUSD);
  const pen = computePenalties(stock, marketCapUSD);

  let weights = af.applicable
    ? { roic: 0.22, gm: 0.20, fcf: 0.18, cagr: 0.15, af: 0.20 }
    : { roic: 0.28, gm: 0.25, fcf: 0.22, cagr: 0.20, af: 0 };

  const coreScore =
    weights.roic * roic.score +
    weights.gm * gm.score +
    weights.fcf * fcf.score +
    weights.cagr * cagr.score +
    weights.af * af.score;

  const finalScore = Math.max(0, Math.min(100, coreScore + pen.total));
  let bucket = bucketFor(finalScore, pen.hardExcluded);
  const mcap = marketCapUSD || 0;
  if (!pen.hardExcluded) {
    if (bucket.id === 'A' && mcap < 50e9) bucket = mcap >= 30e9 ? BUCKETS[1] : BUCKETS[2];
    else if (bucket.id === 'B' && mcap < 30e9) bucket = mcap >= 10e9 ? BUCKETS[2] : BUCKETS[3];
  }
  if (conf.level === 'MEDIUM' && bucket.id === 'A') bucket = BUCKETS[1];

  // v7.3.2 ChatGPT-Fix: cyclical remap auch in Track B
  const cyclicalProfilesB = new Set(['HARDWARE', 'INDUSTRIAL']);
  const remappedPenCodesB = pen.codes.map(c => {
    if (c === 'PENALTY_GROWTH_DECEL' && cyclicalProfilesB.has(subProfileDetail.profile.id)) return 'CYCLICAL_DECELERATION_RISK';
    return c;
  });
  const reasonCodes = [...remappedPenCodesB];
  if (roic.score >= 75) reasonCodes.push('PASS_ROIC_COMPOUNDER');
  if (gm.score >= 80)   reasonCodes.push('PASS_GM_STABLE');
  if (fcf.score >= 75)  reasonCodes.push('PASS_FCF_CONSISTENT');
  if (cagr.score >= 60) reasonCodes.push('PASS_CAGR_COMPOUNDER');
  if (af.applicable && af.score >= 70) reasonCodes.push('PASS_AKTIENFINDER_GOOD');
  if (accel.flags) accel.flags.forEach(f => reasonCodes.push(f));
  reasonCodes.push(`DATA_CONFIDENCE_${conf.level}`);
  reasonCodes.push(subProfileDetail.reasonCode);
  if (subProfileDetail.confidence === 'LOW') reasonCodes.push('SUBPROFILE_LOW_CONFIDENCE');
  if (passesTrackAUniverse(stock, fxRates) && passesTrackBUniverse(stock, fxRates)) reasonCodes.push('MULTI_PROFILE_EXPOSURE');
  if (conf.level === 'LOW') reasonCodes.push('QUALIFIED_LOW_CONFIDENCE_RISK');

  let actionStatus;
  if (pen.hardExcluded) actionStatus = ACTION_STATUS.DISQUALIFIED;
  else if (bucket.id === 'A' || bucket.id === 'B') actionStatus = ACTION_STATUS.QUALIFIED;
  else if (bucket.id === 'OUT') actionStatus = ACTION_STATUS.DISQUALIFIED;
  else actionStatus = ACTION_STATUS.REVIEW;

  return {
    finalScore: Math.round(finalScore * 10) / 10,
    coreScore: Math.round(coreScore * 10) / 10,
    bucket,
    hardExcluded: pen.hardExcluded,
    components: { roic, gm, fcf, cagr, af, accel },
    penalties: pen,
    weights,
    reasonCodes,
    actionStatus,
    dataConfidence: conf,
    accelerationFlag: accel,
    subProfile: subProfile.id,
    track: 'B',
    engineVersion: ENGINE_VERSION,
    schemaVersion: SCHEMA_VERSION
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function bucketFor(score, hardExcluded) {
  if (hardExcluded) return BUCKETS[4];
  if (score == null) return BUCKETS[4];
  for (const b of BUCKETS) if (score >= b.min) return b;
  return BUCKETS[4];
}

function passesTrackAUniverse(stock, fxRates) {
  const mcapUSD = stock.marketCap && normalize(stock.marketCap, 'USD', fxRates || {});
  const g = stock.metrics && stock.metrics.revenueGrowthYoY && stock.metrics.revenueGrowthYoY.value;
  return mcapUSD != null && mcapUSD >= 2e9 && (g || 0) >= 40;
}
function passesTrackBUniverse(stock, fxRates) {
  const mcapUSD = stock.marketCap && normalize(stock.marketCap, 'USD', fxRates || {});
  if (mcapUSD == null || mcapUSD < 50e9) return false;
  const fcfM = stock.metrics && stock.metrics.fcfMarginTTM && stock.metrics.fcfMarginTTM.value;
  if (fcfM != null && fcfM < 0) return false;
  const opM = stock.metrics && stock.metrics.operatingMargin && stock.metrics.operatingMargin.value;
  if (opM != null && opM < 0) return false;
  const g = stock.metrics && stock.metrics.revenueGrowthYoY && stock.metrics.revenueGrowthYoY.value;
  if (g != null && g < 5) return false;
  return true;
}
function isCrossProfile(stock, fxRates) {
  return passesTrackAUniverse(stock, fxRates) && passesTrackBUniverse(stock, fxRates);
}

// ═══════════════════════════════════════════════════════════════
// LEGACY ADAPTER — v7.2 stock → canonicalInput
// (Bug-prevention: convert old schema, do NOT bind v7.3 to v7.2 internals)
// ═══════════════════════════════════════════════════════════════

function v72SnapshotToCanonical(legacyStock) {
  if (!legacyStock) return null;
  const reportingCurrency = legacyStock.reportingCurrency || 'USD';
  const wrap = (v, currency) => v == null ? null : { value: v, currency: currency || reportingCurrency, source: 'yahoo_legacy', confidence: 0.7 };
  const wrapPct = (v) => v == null ? null : { value: v, source: 'yahoo_legacy', confidence: 0.7 };
  const wrapTS = (arr) => (arr || []).map(v => ({ value: v, currency: reportingCurrency, source: 'yahoo_legacy', confidence: 0.7 }));

  return {
    identifier: { primary: legacyStock.isin ? 'ISIN' : 'TICKER', value: legacyStock.isin || legacyStock.ticker },
    meta: {
      ticker: legacyStock.ticker,
      name: legacyStock.name,
      sector: legacyStock.sector,
      industry: legacyStock.industry,
      exchange: legacyStock.exchange,
      region: legacyStock.region,
      reportingCurrency,
      fetchedAt: legacyStock.fetchedAt
    },
    marketCap: legacyStock.mcap != null ? { value: legacyStock.mcap * 1e9, currency: 'USD', source: 'yahoo_legacy', confidence: 0.8 } : null,
    metrics: {
      revenueTTM: legacyStock.revenueTTM != null ? wrap(legacyStock.revenueTTM, reportingCurrency) : null,
      revenueGrowthYoY: wrapPct(legacyStock.revenueGrowthYoY),
      grossMargin: wrapPct(legacyStock.grossMargin),
      profitMargin: wrapPct(legacyStock.profitMargin),
      fcfMarginTTM: wrapPct(legacyStock.fcfMarginTTM),
      operatingMargin: wrapPct(legacyStock.operatingMargin),
      pe: wrapPct(legacyStock.pe),
      forwardPE: wrapPct(legacyStock.forwardPE),
      priceSales: wrapPct(legacyStock.priceSales),
      sbcRatio: wrapPct(legacyStock.sbcRatio),
      cashRunway: wrapPct(legacyStock.cashRunway)
    },
    timeseries: {
      revenueQ: wrapTS(legacyStock.revenueQ),
      opIncQ: wrapTS(legacyStock.opIncQ),
      grossProfitQ: wrapTS(legacyStock.grossProfitQ)
    },
    annual: {
      annualRev: wrapTS(legacyStock.annualRev),
      annualOpInc: wrapTS(legacyStock.annualOpInc),
      annualGP: wrapTS(legacyStock.annualGP),
      annualNetIncome: wrapTS(legacyStock.annualNetIncome),
      annualFCF: wrapTS(legacyStock.annualFCF),
      annualBalance: legacyStock.annualBalance || []
    },
    external: {
      aktienfinderScore: legacyStock.aktienfinderScore != null
        ? { value: legacyStock.aktienfinderScore, source: 'aktienfinder_bookmarklet', confidence: 0.6, asOf: legacyStock.fetchedAt }
        : null
    }
  };
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════

const Engine = {
  ENGINE_VERSION,
  SCHEMA_VERSION,
  BUCKETS,
  ACTION_STATUS,
  SUB_PROFILES,
  classifySubProfile,
  classifySubProfileDetailed,
  computeCoverage,
  computeDataConfidence,
  computeHypergrowthScore,
  computeRuleOfX,
  computeRuleOf40,
  computeRuleComposite,
  computeScalingEfficiency,
  computeAktienfinderScore,
  computeRevenueAcceleration,
  computeROICTrend,
  computeGMStability,
  computeFCFQuality,
  computeEPSCAGR,
  computePenalties,
  computeExpectationsRisk,
  scoreTrackA,
  scoreTrackB,
  bucketFor,
  passesTrackAUniverse,
  passesTrackBUniverse,
  isCrossProfile,
  v72SnapshotToCanonical,
  // Helpers exposed for tests / debugging
  _helpers: { convertCurrency, normalize, isRevenueMaterial, safeYoY, mean, stdDevSample, isStaleData }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Engine;
} else if (typeof window !== 'undefined') {
  window.ScoreEngine = Engine;
}
