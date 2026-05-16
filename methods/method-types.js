'use strict';
/**
 * Tag 97b + 98: Method-Type-Registry
 * ===================================
 * Tag 97b: Klassifikation in CORE / DIAGNOSTIC / DATAGUARD.
 * Tag 98: profitability-state + profitability-trend ersetzen die alten 3 Tiers.
 *         revenue-shock-guard ersetzt stable-quarterly-growth-Pflaster als DATAGUARD.
 */

const METHOD_TYPES = { CORE: 'CORE', DIAGNOSTIC: 'DIAGNOSTIC', DATAGUARD: 'DATAGUARD' };

const REGISTRY = {
  // --- CORE - Discovery-Trigger ------------------------------------
  'rule-of-40':                 { type: 'CORE', defaultActive: true,  reason: 'Primary hypergrowth signal (growth + FCF margin)' },
  'revenue-growth-3y':          { type: 'CORE', defaultActive: true,  reason: 'Growth durability over 3 years' },
  'roic':                       { type: 'CORE', defaultActive: true,  reason: 'Capital efficiency, moat proxy' },
  'gross-margin-stability':     { type: 'CORE', defaultActive: true,  reason: 'Pricing power, moat proxy' },
  'fcf-yield':                  { type: 'CORE', defaultActive: true,  reason: 'Valuation + cash quality combined' },
  'profitability-state':        { type: 'CORE', defaultActive: true,  reason: 'LOSS / EMERGING / STABLE classification (Tag 98)' },
  'profitability-trend':        { type: 'CORE', defaultActive: true,  reason: 'DETERIORATING / FLAT / IMPROVING direction (Tag 98)' },
  'hypergrowth-quality-class':{ type: 'CORE', defaultActive: true, reason: 'Tag 112: Real-Hypergrowth vs Q-Spike-Fake Klassifikator (Quarter-Breadth + OI-Direction + Spike-Concentration)' },

  'earnings-stability':         { type: 'CORE', defaultActive: true,  reason: 'Tag 117: QC v2 MUST 1 - OpInc+FCF positive 4/5 + Recovery' },
  'quality-compounder-roic':    { type: 'CORE', defaultActive: true,  reason: 'Tag 117: QC v2 MUST 2 - PreTax-ROIC + AssetTurnover-Override' },
  'margin-quality':             { type: 'CORE', defaultActive: true,  reason: 'Tag 117: QC v2 MUST 3 - GM-Floor + OpMargin-Floor + GM-Decline asymmetrisch' },
  'reinvestment-rate':          { type: 'CORE', defaultActive: true,  reason: 'Tag 117: QC v2 MUST 4 - Direct (Capex+RnD)/OCF >= 20%' },
  'premium-compounder-proof':   { type: 'CORE', defaultActive: true,  reason: 'Tag 117: QC v2 - 6er-Proof fuer Conditional FCF-Yield 1.5-3%' },

  // --- DIAGNOSTIC - Kontext fÃ¼r Deep-Dive --------------------------
  'rule-of-x':                  { type: 'DIAGNOSTIC', defaultActive: false, reason: 'Alternative hypergrowth metric, redundant mit Rule-of-40' },
  'stable-quarterly-growth':    { type: 'DIAGNOSTIC', defaultActive: false, reason: 'Growth-pattern indicator - DataGuard-Job geht an revenue-shock-guard' },
  'margin-decay':               { type: 'DIAGNOSTIC', defaultActive: false, reason: 'Erosion-detection im Detail-Modal' },
  'capex-trend':                { type: 'DIAGNOSTIC', defaultActive: false, reason: 'Reinvestment pattern' },
  'sbc-revenue':                { type: 'DIAGNOSTIC', defaultActive: false, reason: 'SBC-Disziplin als Quality-Indikator' },
  // Bug #20: defaultActive:false means this method is not evaluated, but score-aggregator
  // applies a SOFT_GUARD_PENALTY for it. Enable so the penalty is actually computable.
  'working-capital-anomaly':    { type: 'DIAGNOSTIC', defaultActive: true,  reason: 'Earnings-quality red flag' },
  'insider-ownership':          { type: 'DIAGNOSTIC', defaultActive: false, reason: 'Skin in the game' },
  'quarterly-earnings-stability':{ type: 'DIAGNOSTIC', defaultActive: false, reason: '8Q earnings volatility' },
  'gross-margin-acceleration':  { type: 'DIAGNOSTIC', defaultActive: true,  reason: 'Tag 195: Pre-Breakout signal — GM improvement across 3 consecutive periods (Q preferred)' },
  'operating-leverage':         { type: 'DIAGNOSTIC', defaultActive: true,  reason: 'Tag 196: 3Y incremental margin ΔOI/ΔRev — quality-compounder signal' },
  'revenue-quality':            { type: 'DIAGNOSTIC', defaultActive: true,  reason: 'Tag 197: CoV of YoY growth rates over 4y — consistency-of-growth signal' },
  'loss-magnitude-guard':       { type: 'DATAGUARD',  defaultActive: true,  reason: 'Tag 199: hard-fails if op-loss > 50% of revenue (SOUN/IONQ pattern)' },
  'single-quarter-dependency':  { type: 'DIAGNOSTIC', defaultActive: true,  reason: 'Tag 199: TTM growth collapses >50% without top quarter — single-Q dependency signal' },
  'listing-age':                { type: 'DIAGNOSTIC', defaultActive: true,  reason: 'Tag 199: clean fiscal years available — used to scale QC scoring (3y floor)' },
  'metric-divergence-guard':    { type: 'DATAGUARD',  defaultActive: true,  reason: 'Tag 199f: Yahoo TTM vs annual op-margin > 1000pp divergence = data anomaly (MSTR pattern)' },
  'operating-margin-acceleration': { type: 'DIAGNOSTIC', defaultActive: true, reason: 'Tag 199g: OpM accelerating across 3y — operating-leverage breakthrough (Damodaran)' },
  'revenue-acceleration-yoy':   { type: 'DIAGNOSTIC', defaultActive: true,  reason: 'Tag 199i: this-year YoY > last-year YoY — Pre-Breakout re-acceleration signal' },
  'sbc-growth-ratio':           { type: 'DIAGNOSTIC', defaultActive: true,  reason: 'Tag 199j: SBC growth ≤ 1.5× Rev growth — dilution-discipline signal' },
  'roic-trend':                 { type: 'DIAGNOSTIC', defaultActive: true,  reason: 'Tag 200: ROIC YoY delta — Quality-Compounder trajectory signal' },
  'buyback-yield':              { type: 'DIAGNOSTIC', defaultActive: true,  reason: 'Tag 201: Shares-Outstanding YoY decline — capital-return / anti-dilution signal' },
  'sbc-trend':                  { type: 'DIAGNOSTIC', defaultActive: true,  reason: 'Tag 201: SBC/Revenue ratio direction over 3y — slow-burn dilution-drift detector' },
  'insider-net-buying':         { type: 'DIAGNOSTIC', defaultActive: true,  reason: 'Tag 201: Net insider buys minus sells (180d) — complements cluster signal with sell-side balance' },
  'net-income-volatility-guard':{ type: 'DATAGUARD',  defaultActive: true,  reason: 'Tag 200b: NI single-year swing > 100% of revenue — catches non-operating noise (MSTR-style)' },
  'pre-commerciality-megacap-guard':{ type: 'DATAGUARD', defaultActive: true, reason: 'Tag 201b: mcap > 1B but rev < 100M — narrative-only mega-cap (QS/JOBY pattern bypassing existing gates)' },
  'closed-end-trust-guard':     { type: 'DATAGUARD',  defaultActive: true,  reason: 'Tag 202: industry + Rev/Assets + neg-rev + FCF/Assets pattern — catches Scottish-Mortgage/HICL trust noise in R40' },
  'opinc-margin-spike':         { type: 'DIAGNOSTIC', defaultActive: false, reason: 'Operating margin shock detection' },
  'drawdown-52w':               { type: 'DIAGNOSTIC', defaultActive: false, reason: 'Setup-Kontext fÃ¼r Elliot-Analyse' },
  'high-proximity-52w':         { type: 'DIAGNOSTIC', defaultActive: false, reason: 'Setup-Kontext fÃ¼r Elliot-Analyse' },
  'volatility-annualized':      { type: 'DIAGNOSTIC', defaultActive: false, reason: 'Risk context' },
  // Bug #21: defaultActive:false means above-200d-ma is never evaluated, but score-aggregator
  // includes it with weight 0.05 in QUALITY_COMPOUNDER. Enable so the weight contributes.
  'above-200d-ma':              { type: 'DIAGNOSTIC', defaultActive: true,  reason: 'Trend regime context' },
  'forward-pe':                 { type: 'DIAGNOSTIC', defaultActive: false, reason: 'Forward estimate, not a hard signal' },
  'peg':                        { type: 'DIAGNOSTIC', defaultActive: false, reason: 'Forward estimate, not a hard signal' },
  'ev-ebitda':                  { type: 'DIAGNOSTIC', defaultActive: false, reason: 'KomplementÃ¤r zu fcf-yield' },

  // --- DATAGUARD - Disqualifiziert auf Fail ------------------------
  'sloan-ratio':                { type: 'DATAGUARD', defaultActive: true, reason: 'Earnings-manipulation detector - fail = skip stock' },
  'net-debt-ebitda':            { type: 'DATAGUARD', defaultActive: true, reason: 'Solvency floor - fail = skip stock' },
  'asset-growth-divergence':    { type: 'DATAGUARD', defaultActive: true, reason: 'Acquired-growth detector' },
  'revenue-shock-guard':        { type: 'DATAGUARD', defaultActive: true, reason: 'Robust outlier detection auf latest Q-revenue (Tag 98b)' },
  'q-spike-dataguard':          { type: 'DATAGUARD', defaultActive: true, reason: 'Tag 113: Hard-Filter Q-Spike (>55% Single-Q-Konzentration ODER OI-Severity >3x bei YoY>100%)' },
  'forecast-contamination-guard':{ type: 'DATAGUARD', defaultActive: true, reason: 'Tag 118: Yahoo annualRev[0] Forecast-Contamination Cross-Check' },
  'quarter-concentration-guard': { type: 'DATAGUARD', defaultActive: true, reason: 'Tag 118: Single-Q-Konzentration <=50% (Hypergrowth-spezifisch)' },
  'deceleration-guard':         { type: 'DATAGUARD', defaultActive: true, reason: 'Tag 118: Q-YoY << TTM-Growth Deceleration (Hypergrowth)' },
  'revenue-volatility-guard':   { type: 'DATAGUARD', defaultActive: true, reason: 'Tag 121e: Faengt SPHR-Pattern - lumpy Annual-Revenue mit -25%+ Single-Year-Decline' },
};

// Disabled (Tag 97a + Tag 98)
const DISABLED = {
  'aktienfinder-quality':   { reason: 'Manueller CSV-Import skaliert nicht. Karl nutzt Aktienfinder extern.', since: '2026-05-08' },
  'multi-year-stability':   { reason: 'Tag 98: ersetzt durch profitability-state (STABLE-Tier).', since: '2026-05-08' },
  'recent-profitability':   { reason: 'Tag 98: ersetzt durch profitability-state (EMERGING/STABLE).', since: '2026-05-08' },
  'emerging-profitable':    { reason: 'Tag 98: ersetzt durch profitability-state (EMERGING) + profitability-trend (IMPROVING).', since: '2026-05-08' }
};

function getType(methodId) {
  if (REGISTRY[methodId]) return REGISTRY[methodId].type;
  return METHOD_TYPES.DIAGNOSTIC;
}
function isCore(methodId)      { return getType(methodId) === METHOD_TYPES.CORE; }
function isDiagnostic(methodId) { return getType(methodId) === METHOD_TYPES.DIAGNOSTIC; }
function isDataGuard(methodId)  { return getType(methodId) === METHOD_TYPES.DATAGUARD; }
function isDefaultActive(methodId) {
  const entry = REGISTRY[methodId];
  return entry ? entry.defaultActive === true : false;
}
function isDisabled(methodId) {
  return Object.prototype.hasOwnProperty.call(DISABLED, methodId);
}
function isDisqualifiedByDataGuards(resultsMap) {
  for (const [methodId, result] of Object.entries(resultsMap)) {
    if (!isDataGuard(methodId)) continue;
    if (result.computable === true && result.pass === false) return { disqualified: true, methodId };
  }
  return { disqualified: false };
}

module.exports = {
  METHOD_TYPES, REGISTRY, DISABLED,
  getType, isCore, isDiagnostic, isDataGuard, isDefaultActive, isDisabled,
  isDisqualifiedByDataGuards
};
