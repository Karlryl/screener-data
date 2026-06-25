'use strict';
/**
 * Hypergrowth Engine — Schicht 1: Router (feste Pruefreihenfolge)
 * ==============================================================
 * Mappt jede Aktie deterministisch in genau EINE Branchen-Formel ODER excludet
 * sie. Liest ausschliesslich norm()-Serien + meta. Court-festgeschriebene
 * Reihenfolge (frueheste Wahr-Bedingung gewinnt):
 *
 *   Schritt 0  Pre-Revenue-Guard  -> survival-track (NIE Growth-Score)
 *   Schritt 1  Struktur-Hard-Exclude (Telecom, Bilanz-Banken, Versicherer, mREIT)
 *   Schritt 2  annualGP=0-Hard-Exclude  (Lender/Credit-Services, z.B. SOFI)
 *              LAEUFT ZWINGEND VOR JEDER grossMargin-Logik.
 *   Schritt 3  Branchen-Routing + (fuer Financials) GP-Klassifikation
 *
 * GP-Klassifikation nutzt den MASTER-DISKRIMINATOR r = firstPresent(normGP) /
 * firstPresent(normRev); grossMargin ist NUR Tie-Break, wenn r nicht berechenbar
 * ist (ICE/CME/NDAQ: gm=100 ABER r~0.7 -> ECHTER GP, nicht degeneriert).
 */

const { norm, hasPresent, firstPresent, presentValues, metricVal } = require('./snapshot.js');

const lc = (x) => (typeof x === 'string' ? x.toLowerCase() : '');

// US-Erkennung (Plan: US-Universe). meta.region ist das massgebliche Feld:
// US-Firmen tragen 'US' ODER (inkonsistent) einen US-Boersennamen (SOFI/ICE/MU
// region='NasdaqGS'/'NYSE'). Auslaendische ADRs tragen den LAENDERCODE (TSM
// region='TW', KXIAY='JP') — obwohl ihre exchangeName US ist (NYSE/OTC). Daher
// NUR region pruefen, NICHT exchangeName (sonst schluepfen ADRs durch).
const US_SIGNAL = /nasdaq|nyse|amex|arca|bats|cboe|\botc\b|pink|\bnms\b|\bncm\b|\bngm\b|\bus\b|\busa\b|united states/i;
function isUS(s) {
  const m = (s && s.meta) || {};
  if (m.region) return US_SIGNAL.test(m.region);
  if (m.exchangeName) return US_SIGNAL.test(m.exchangeName); // nur Fallback wenn region fehlt
  return true; // gar kein Signal -> konservativ behalten
}

// --- GP-Klassifikation (Master-Diskriminator) -------------------------------
// 'real'       0 < r < 0.99  -> normale GP-Wachstums-Spalte
// 'degenerate' r >= 0.99 (GP==Rev) -> Nicht-GP-Revenue-Badge
// 'none'       kein GP und kein grossMargin -> keine GP-Spalte
function gpClass(s) {
  const gp = norm(s, 'annualGP');
  const rev = norm(s, 'annualRev');
  if (hasPresent(gp)) {
    const g0 = firstPresent(gp);
    const r0 = firstPresent(rev);
    if (r0 !== null && r0 > 0) {
      const r = g0 / r0;
      if (r >= 0.99) return 'degenerate';
      if (r > 0) return 'real';
    }
  }
  // Tie-Break: r nicht berechenbar -> grossMargin (NIE Primaerquelle)
  const gm = metricVal(s, 'grossMargin');
  if (gm === null) return 'none';
  return gm >= 99 ? 'degenerate' : 'real';
}

// --- Schritt 0: Pre-Revenue -------------------------------------------------
function isPreRevenue(s) {
  const rev = norm(s, 'annualRev');
  if (!hasPresent(rev)) return true;
  return presentValues(rev).every((v) => v === 0);
}

// --- Schritt 1: Struktur-Hard-Exclude ---------------------------------------
function structExcludeReason(s) {
  const ind = lc(s && s.meta ? s.meta.industry : '');
  const sec = lc(s && s.meta ? s.meta.sector : '');
  if (ind.includes('telecom')) return 'telecom';
  // Bilanz-Banken excludieren, aber NICHT Broker/Investment-Banking (Income-Statement-Financials, bleiben drin).
  if (/\bbank/.test(ind) && !ind.includes('brokerage')) return 'balance-sheet-bank';
  // Versicherer excludieren, aber NICHT Versicherungs-Makler (Broker = Income-Statement, bleiben drin).
  if (ind.includes('insurance') && !ind.includes('broker')) return 'insurer';
  if (ind.includes('mortgage') && (ind.includes('reit') || sec.includes('real estate'))) return 'mortgage-reit';
  return null;
}

// --- Schritt 3: Branchen-Routing (provisorische GICS-Karte) -----------------
// Industry-Overrides zuerst, dann Sektor-Fallback. Wird mit den Formel-Dateien
// (jede exportiert ihr eigenes routingPredicate) verfeinert.
function sectorRoute(s) {
  const ind = lc(s && s.meta ? s.meta.industry : '');
  const sec = lc(s && s.meta ? s.meta.sector : '');
  // Industry-Overrides
  if (ind.includes('semiconductor')) return 'semiconductors';
  // Wortgrenze: "\bit services" matcht "it services", NICHT "cred[it services]" (Substring-Kollision).
  if (ind.includes('information technology services') || /\bit services\b/.test(ind)) return 'it-services';
  // Sektor-Fallback (Yahoo-Sektornamen)
  if (sec.includes('technology')) return 'software-comm-services';
  if (sec.includes('communication')) return 'software-comm-services';
  if (sec.includes('healthcare') || sec.includes('health care')) return 'health-care';
  if (sec.includes('consumer cyclical') || sec.includes('consumer discretionary')) return 'consumer-discretionary';
  if (sec.includes('consumer defensive') || sec.includes('consumer staples')) return 'consumer-staples';
  if (sec.includes('industrials')) return 'industrials';
  if (sec.includes('financial')) return 'financials';
  if (sec.includes('energy')) return 'energy';
  if (sec.includes('utilities')) return 'utilities';
  if (sec.includes('basic materials') || sec.includes('materials')) return 'materials';
  if (sec.includes('real estate')) return 'real-estate';
  return 'unrouted';
}

/**
 * route(snapshot) -> Ergebnis-Objekt mit deterministischem action.
 *   {action:'survival', track, reason}     Pre-Revenue
 *   {action:'exclude', reason}             Struktur- oder annualGP=0-Exclude
 *   {action:'route', formulaId[, gpClass]} Branchen-Formel
 */
function route(s) {
  // Universum-Filter: nur US (Plan: US-Universe inkl. Small-Caps). Auslaendisch
  // gelistete Namen duerfen die US-Kohorten-Perzentile nicht verzerren.
  if (!isUS(s)) return { action: 'exclude', reason: 'non-us' };
  // Schritt 0
  if (isPreRevenue(s)) return { action: 'survival', track: 'pre-revenue-biotech', reason: 'no-revenue' };
  // Schritt 1
  const se = structExcludeReason(s);
  if (se) return { action: 'exclude', reason: se };
  // Schritt 2 — VOR jeder grossMargin-Logik
  const gp = norm(s, 'annualGP');
  if (hasPresent(gp) && presentValues(gp).every((v) => v === 0)) {
    return { action: 'exclude', reason: 'lender-gp0' };
  }
  // Schritt 3
  const formulaId = sectorRoute(s);
  const out = { action: 'route', formulaId };
  if (formulaId === 'financials') out.gpClass = gpClass(s);
  return out;
}

module.exports = { route, gpClass, isPreRevenue, structExcludeReason, sectorRoute, isUS };
