/**
 * lib/sub-profile.js — sub-profile classifier (SaaS / Hardware / Marketplace / …).
 *
 * Extracted verbatim from the retired engine-v7.3.js (ADR-001 Phase 3) so the LIVE
 * path no longer depends on the deprecated Track-A/B scoring engine. The only
 * production consumers of the old engine were classifySubProfile (via
 * methods/_helpers.js and methods/sector-medians-compute.js); everything else
 * (scoreTrackA/B, orchestrator) was dead and is deleted with the engine.
 *
 * Pure, deterministic, no I/O. Classification precedence (ChatGPT-Iter-2-Fix-7):
 *   1) manual override (stock.manualSubProfile)
 *   2) ticker override (TICKER_SUBPROFILE_MAP)
 *   3) explicit sector/industry mapping
 *   4) business-model keyword heuristic
 *   5) fallback OTHER
 */
'use strict';

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

// audit F-A-2026-06-21: removed classifySubProfileDetailed (and its export) — dead code with
// zero live consumers. Its keyword ladder had drifted out of sync with classifySubProfile
// (missing BANK / credit-services / consumer-staples / energy / REIT branches), so keeping it
// risked a future caller silently getting a different, stale classification. Prevents
// dead-code-divergence: a misclassification surfacing if the unused export were ever wired up.

module.exports = { SUB_PROFILES, TICKER_SUBPROFILE_MAP, classifySubProfile };
