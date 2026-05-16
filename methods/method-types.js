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

  // Tag 206d (Bug-Hunt Agent C HIGH-2): TURNAROUND mode's SCORE_WEIGHTS references
  // these 3 method ids; without explicit REGISTRY entries they fall back to
  // DIAGNOSTIC + defaultActive:false, which breaks any caller passing
  // onlyDefault:true. Surface them with correct CORE typing.
  'altman-z-score':             { type: 'CORE', defaultActive: true,  reason: 'Tag 140: TURNAROUND solvency floor (Altman Z" > 1.1)' },
  'piotroski-f-score':          { type: 'CORE', defaultActive: true,  reason: 'Tag 117: 9-factor fundamental signal (also TURNAROUND prefer)' },
  'estimate-revision-proxy':    { type: 'CORE', defaultActive: true,  reason: 'Tag 141: positive analyst revisions / rev-acceleration proxy' },
  // Tag 206d: insider-buy-cluster (loaded since Tag 137) had no REGISTRY entry.
  'insider-buy-cluster':        { type: 'DIAGNOSTIC', defaultActive: true, reason: 'Tag 137: >=2 unique insider buyers in 90d — cluster-buy signal' },
  'quarterly-revenue-acceleration': { type: 'DIAGNOSTIC', defaultActive: true, reason: 'Tag 206e: latest Q rev / prior Q rev >= 1.10 (10% QoQ sequential growth)' },

  // --- DIAGNOSTIC - Kontext fÃ¼r Deep-Dive --------------------------
  // Tag 206h (Bug-Hunt Agent F HIGH-1): defaultActive flipped to true.
  // rule-of-x carries weight 0.10 in SCORE_WEIGHTS[HYPERGROWTH] but was
  // defaultActive:false → any caller passing onlyDefault:true would skip
  // it, silently zeroing 10% of the HG composite. Computing it is cheap
  // (small calc on existing fields) so we activate by default.
  'rule-of-x':                  { type: 'DIAGNOSTIC', defaultActive: true, reason: 'Alternative hypergrowth metric (Tag 206h: activated to honor SCORE_WEIGHTS HG=0.10)' },
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
  'r40-sanity-cap':             { type: 'DATAGUARD',  defaultActive: true,  reason: 'Tag 205: caps R40-poisoning inputs — revGrowth>150% with OpInc<0 (ONDS/BEAM) | fcfMargin>80% (one-time events) | |OpM-FCFM|>50pp (R&D-capex phantom FCF)' },
  'fcf-stability':              { type: 'DIAGNOSTIC', defaultActive: true,  reason: 'Tag 204: FCF/Rev margin CoV ≤ 0.40 over 4y — Asness/Frazzini/Pedersen QMJ Safety pillar (lumpy-FCF detector)' },
  'operating-cashflow-coverage':{ type: 'DIAGNOSTIC', defaultActive: true,  reason: 'Tag 204: OCF/NI 3y mean ≥ 0.80 — earnings-quality coverage floor (Sloan-sister, cleaner inputs)' },
  'gross-profitability':        { type: 'DIAGNOSTIC', defaultActive: true,  reason: 'Tag 209a: Novy-Marx GP/TA >= 0.20 — durable-quality floor (SSRN 5190788 + SSRN 3877161); catches leverage-inflated ROE with weak underlying gross profitability' },
  'capital-allocation-quality': { type: 'DIAGNOSTIC', defaultActive: true,  reason: 'Tag 209c: Mauboussin composite — buybacks + leverage + capex + SBC scored as one capital-allocation decision (0-100, pass >=75)' },
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
  // Tag 206d (Bug-Hunt Agent C CRITICAL): net-debt-ebitda was tagged DATAGUARD
  // but used as CORE — in QUALITY_COMPOUNDER MUST core[] and in SCORE_WEIGHTS QC
  // with weight 0.10. It is never listed in any mode.dataGuards[]. Re-typed CORE.
  'net-debt-ebitda':            { type: 'CORE', defaultActive: true, reason: 'Tag 117: QC v2 MUST — Net-Debt/EBITDA <= 2.5 (solvency floor scored, not gated)' },
  // Tag 206d: asset-growth-divergence is in QC softGuards[] (penalty applied at score
  // time, not hard-fail). DATAGUARD type was misleading; downgrade to DIAGNOSTIC.
  'asset-growth-divergence':    { type: 'DIAGNOSTIC', defaultActive: true, reason: 'Tag 120b: M&A-Compounder acquired-growth detector — softGuard penalty in QC' },
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
