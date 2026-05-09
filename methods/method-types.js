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

  // --- DIAGNOSTIC - Kontext für Deep-Dive --------------------------
  'rule-of-x':                  { type: 'DIAGNOSTIC', defaultActive: false, reason: 'Alternative hypergrowth metric, redundant mit Rule-of-40' },
  'stable-quarterly-growth':    { type: 'DIAGNOSTIC', defaultActive: false, reason: 'Growth-pattern indicator - DataGuard-Job geht an revenue-shock-guard' },
  'margin-decay':               { type: 'DIAGNOSTIC', defaultActive: false, reason: 'Erosion-detection im Detail-Modal' },
  'capex-trend':                { type: 'DIAGNOSTIC', defaultActive: false, reason: 'Reinvestment pattern' },
  'sbc-revenue':                { type: 'DIAGNOSTIC', defaultActive: false, reason: 'SBC-Disziplin als Quality-Indikator' },
  'working-capital-anomaly':    { type: 'DIAGNOSTIC', defaultActive: false, reason: 'Earnings-quality red flag' },
  'insider-ownership':          { type: 'DIAGNOSTIC', defaultActive: false, reason: 'Skin in the game' },
  'quarterly-earnings-stability':{ type: 'DIAGNOSTIC', defaultActive: false, reason: '8Q earnings volatility' },
  'opinc-margin-spike':         { type: 'DIAGNOSTIC', defaultActive: false, reason: 'Operating margin shock detection' },
  'drawdown-52w':               { type: 'DIAGNOSTIC', defaultActive: false, reason: 'Setup-Kontext für Elliot-Analyse' },
  'high-proximity-52w':         { type: 'DIAGNOSTIC', defaultActive: false, reason: 'Setup-Kontext für Elliot-Analyse' },
  'volatility-annualized':      { type: 'DIAGNOSTIC', defaultActive: false, reason: 'Risk context' },
  'above-200d-ma':              { type: 'DIAGNOSTIC', defaultActive: false, reason: 'Trend regime context' },
  'forward-pe':                 { type: 'DIAGNOSTIC', defaultActive: false, reason: 'Forward estimate, not a hard signal' },
  'peg':                        { type: 'DIAGNOSTIC', defaultActive: false, reason: 'Forward estimate, not a hard signal' },
  'ev-ebitda':                  { type: 'DIAGNOSTIC', defaultActive: false, reason: 'Komplementär zu fcf-yield' },

  // --- DATAGUARD - Disqualifiziert auf Fail ------------------------
  'sloan-ratio':                { type: 'DATAGUARD', defaultActive: true, reason: 'Earnings-manipulation detector - fail = skip stock' },
  'net-debt-ebitda':            { type: 'DATAGUARD', defaultActive: true, reason: 'Solvency floor - fail = skip stock' },
  'asset-growth-divergence':    { type: 'DATAGUARD', defaultActive: true, reason: 'Acquired-growth detector' },
  'revenue-shock-guard':        { type: 'DATAGUARD', defaultActive: true, reason: 'Robust outlier detection auf latest Q-revenue (Tag 98b)' },
  'q-spike-dataguard':          { type: 'DATAGUARD', defaultActive: true, reason: 'Tag 113: Hard-Filter Q-Spike (>55% Single-Q-Konzentration ODER OI-Severity >3x bei YoY>100%)' }
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
