'use strict';
/**
 * QC-Board (3.1) — Membership-Funktion (DIAGNOSTIC, additiv).
 * ==========================================================
 * qualityRoute(s) DELEGIERT zwingend an route() und erbt damit ALLE struct/
 * universe-Excludes (non-us, telecom, Bilanz-Bank, Versicherer, mREIT, non-
 * operating-vehicle, lender-gp0, no-sector, pre-revenue). Erst danach die QC-
 * eigenen Gates:
 *   1) QC_UNSUPPORTED_SECTORS (financials/real-estate) -> exclude 'qc-sector-unsupported'
 *      (dort trennt der generische Achsen-Satz Franchise nicht sinnvoll; kein QC-Terrain).
 *   2) Nur Compounder-Tiers (seit-kurzem/langfristig-profitabel) -> sonst
 *      exclude 'qc-not-compounder'. REIN VORZEICHEN-basiert (profitTierOf); KEINE
 *      ROIC>=/GM>=-Schwelle, KEIN Age>=X. EHRLICH: ein Jahres-Vorzeichen laesst
 *      'seit-kurzem'-Namen rein -> 'Compounder'-Label laeuft der Evidenz voraus
 *      (gehedged via profitTier-Feld + boardStatus=diagnostic).
 * route -> formulaId 'quality-<sector>'. Survival/exclude von route() -> exclude.
 */
const { route } = require('./router.js');
const { profitTierOf } = require('./profit-tier.js');

// Compounder = aktuell profitabel (juengstes Jahr >= 0), Tier aus profit-tier.js.
const COMPOUNDER_TIERS = new Set(['seit-kurzem-profitabel', 'langfristig-profitabel']);
// Sektoren, in denen der generische QC-Achsen-Satz nicht sinnvoll misst.
const QC_UNSUPPORTED_SECTORS = new Set(['financials', 'real-estate']);

function qualityRoute(s) {
  const r = route(s);
  if (r.action !== 'route') return { action: 'exclude', reason: r.reason || r.action };
  if (QC_UNSUPPORTED_SECTORS.has(r.formulaId)) return { action: 'exclude', reason: 'qc-sector-unsupported' };
  if (!COMPOUNDER_TIERS.has(profitTierOf(s))) return { action: 'exclude', reason: 'qc-not-compounder' };
  return { action: 'route', formulaId: 'quality-' + r.formulaId };
}

module.exports = { qualityRoute, COMPOUNDER_TIERS, QC_UNSUPPORTED_SECTORS };
