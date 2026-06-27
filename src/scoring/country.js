'use strict';
/**
 * A1 (Weltweit-Pivot) — Laender-Normalisierung fuer den Output-/Dashboard-Layer.
 * =============================================================================
 * Liefert je Snapshot-`meta` einen sauberen Laendernamen (fuer den Laenderfilter)
 * + einen groben Kontinent-Bucket. Domizil-Vorrang wie router.isUS (country-first);
 * OHNE Domizil schlaegt ein verlaessliches Auslands-Signal ein unzuverlaessiges
 * US-Signal (ADR-robust, s. normalizeCountry):
 *
 *   1. meta.country         — Domizil (Yahoo assetProfile.country); 61% der Snapshots.
 *   2. Auslands-Signal      — foreign exchangeName / region-Code / Ticker-Suffix (verlaesslich;
 *                             Tokyo/HKSE/LSE/XETRA, CN/JP, .PA/.L/.HK). Bei den 39% ohne country
 *                             traegt meist region den Boersennamen ODER einen 2-Letter-Code.
 *   3. US-Signal            — NYSE/Nasdaq/region='US' NUR als Fallback (ADR-unzuverlaessig).
 *   4. null                 — kein verwertbares Signal -> ehrliches "Unknown"
 *                             (NICHT raten; stale Snapshots wie region='YHD' routen
 *                              ohnehin zu no-sector-Exclude, kriegen also keine Zeile).
 *
 * Reine Funktion. Alle Maps sind gegen die REALEN distinct-Werte aus snapshots/
 * (4681 Stueck, 2026-06-27) gebaut, nicht aus dem Kopf — die beobachteten
 * Boersen/Codes/Laender sind vollstaendig abgedeckt.
 *
 * Hinweis (Reuse): lib/region-mapping.js::getRegion bleibt unberuehrt — es mappt
 * Exchange-CODES (NMS/NYQ) auf Kalibrier-Buckets (US/EU/APAC/EM) und liefert KEINEN
 * Laendernamen; auf diesem Snapshot-Shape (kein meta.exchange-Code, keine price.currency)
 * gaebe es fuer die Auslandsnamen nur 'OTHER'. Hier wird der Laendername neu aufgeloest
 * und die Region konsistent daraus abgeleitet.
 */

const lc = (x) => (typeof x === 'string' ? x.toLowerCase().trim() : '');

// Land -> grober Kontinent-Bucket. Deckt alle in snapshots/ beobachteten
// meta.country-Werte (+ haeufige Nachbarn) ab. Tax-Haven-Domizile geografisch:
// Bermuda/Cayman -> North America (Karibik), Ireland/Luxembourg/Guernsey -> Europe.
const COUNTRY_TO_REGION = {
  'United States': 'North America', 'Canada': 'North America', 'Mexico': 'North America',
  'Bermuda': 'North America', 'Cayman Islands': 'North America', 'Panama': 'North America',
  'Brazil': 'South America', 'Argentina': 'South America', 'Chile': 'South America',
  'Peru': 'South America', 'Uruguay': 'South America', 'Colombia': 'South America',
  'United Kingdom': 'Europe', 'Germany': 'Europe', 'France': 'Europe', 'Switzerland': 'Europe',
  'Netherlands': 'Europe', 'Italy': 'Europe', 'Spain': 'Europe', 'Sweden': 'Europe',
  'Ireland': 'Europe', 'Luxembourg': 'Europe', 'Belgium': 'Europe', 'Denmark': 'Europe',
  'Norway': 'Europe', 'Finland': 'Europe', 'Greece': 'Europe', 'Austria': 'Europe',
  'Poland': 'Europe', 'Portugal': 'Europe', 'Monaco': 'Europe', 'Guernsey': 'Europe',
  'Jersey': 'Europe', 'Cyprus': 'Europe', 'Isle of Man': 'Europe',
  'China': 'Asia', 'Japan': 'Asia', 'Taiwan': 'Asia', 'Hong Kong': 'Asia',
  'South Korea': 'Asia', 'Singapore': 'Asia', 'Indonesia': 'Asia', 'Malaysia': 'Asia',
  'Thailand': 'Asia', 'India': 'Asia', 'Philippines': 'Asia', 'Vietnam': 'Asia',
  'Israel': 'Middle East', 'Saudi Arabia': 'Middle East', 'United Arab Emirates': 'Middle East',
  'Jordan': 'Middle East', 'Qatar': 'Middle East', 'Kuwait': 'Middle East', 'Turkey': 'Middle East',
  'South Africa': 'Africa', 'Nigeria': 'Africa', 'Egypt': 'Africa', 'Morocco': 'Africa',
  'Australia': 'Oceania', 'New Zealand': 'Oceania',
};

// Alias-Normalisierung fuer meta.country (Daten sind sauber, defensiv dennoch).
const COUNTRY_ALIAS = {
  'usa': 'United States', 'us': 'United States', 'u.s.': 'United States',
  'u.s.a.': 'United States', 'united states of america': 'United States',
  'uk': 'United Kingdom', 'u.k.': 'United Kingdom', 'great britain': 'United Kingdom',
  'korea': 'South Korea', 'republic of korea': 'South Korea', 'south korea': 'South Korea',
  'uae': 'United Arab Emirates', 'russia': 'Russia',
};

function canonCountry(raw) {
  const s = (typeof raw === 'string') ? raw.trim() : '';
  if (!s) return null;
  const alias = COUNTRY_ALIAS[s.toLowerCase()];
  return alias || s; // verbatim, wenn schon ein sauberer Name (Region ggf. null)
}

// Exakte Boersen-/Code-Tokens (lowercased, whole-string) -> Land. Deckt alle in
// snapshots/ beobachteten meta.region/meta.exchangeName-Werte ab. Kollisionsfrei,
// weil whole-string statt Substring.
const EX_EXACT = {
  // US-Venues
  'nyse': 'United States', 'nasdaqgs': 'United States', 'nasdaqgm': 'United States',
  'nasdaqcm': 'United States', 'nasdaq': 'United States', 'nyse american': 'United States',
  'nysearca': 'United States', 'cboe us': 'United States', 'amex': 'United States',
  'otc markets otcpk': 'United States', 'otc markets otcqx': 'United States',
  'otc markets otcqb': 'United States', 'otc markets otcid': 'United States',
  // 2-Letter / Region-Codes (NICHT eu/em/other/yhd -> kein Land bestimmbar)
  'us': 'United States', 'usa': 'United States',
  'cn': 'China', 'jp': 'Japan', 'tw': 'Taiwan', 'hk': 'Hong Kong', 'kr': 'South Korea',
  'ca': 'Canada', 'au': 'Australia', 'de': 'Germany', 'fr': 'France', 'ch': 'Switzerland',
  'nl': 'Netherlands', 'it': 'Italy', 'es': 'Spain', 'se': 'Sweden', 'dk': 'Denmark',
  'no': 'Norway', 'fi': 'Finland', 'be': 'Belgium', 'pt': 'Portugal', 'at': 'Austria',
  'pl': 'Poland', 'gr': 'Greece', 'ie': 'Ireland', 'sg': 'Singapore', 'id': 'Indonesia',
  'my': 'Malaysia', 'th': 'Thailand', 'mx': 'Mexico', 'uk': 'United Kingdom',
  'in': 'India', 'il': 'Israel', 'ae': 'United Arab Emirates', 'za': 'South Africa',
  // Boersen-Anzeigenamen (whole-string)
  'tokyo': 'Japan', 'hkse': 'Hong Kong', 'shanghai': 'China', 'shenzhen': 'China',
  'taiwan': 'Taiwan', 'toronto': 'Canada', 'kse': 'South Korea', 'kosdaq': 'South Korea',
  'asx': 'Australia', 'xetra': 'Germany', 'frankfurt': 'Germany', 'paris': 'France',
  'lse': 'United Kingdom', 'stockholm': 'Sweden', 'milan': 'Italy', 'swiss': 'Switzerland',
  'mce': 'Spain', 'amsterdam': 'Netherlands', 'brussels': 'Belgium', 'kuala lumpur': 'Malaysia',
  'saudi': 'Saudi Arabia', 'copenhagen': 'Denmark', 'thailand': 'Thailand', 'jakarta': 'Indonesia',
  'oslo': 'Norway', 'mexico': 'Mexico', 'ses': 'Singapore', 'helsinki': 'Finland',
  'athens': 'Greece', 'são paulo': 'Brazil', 'sao paulo': 'Brazil', 'irish': 'Ireland',
  'dubai': 'United Arab Emirates', 'lisbon': 'Portugal', 'vienna': 'Austria', 'warsaw': 'Poland',
};

// Substring-Fallback (distinktive lange Namen, kollisionssicher) — Zukunftssicher
// fuer leicht abweichende Yahoo-Schreibweisen (z.B. "Hong Kong Stock Exchange").
const EX_SUBSTR = [
  ['nasdaq', 'United States'], ['nyse', 'United States'], ['otc markets', 'United States'],
  ['hong kong', 'Hong Kong'], ['tokyo', 'Japan'], ['shanghai', 'China'], ['shenzhen', 'China'],
  ['taiwan', 'Taiwan'], ['toronto', 'Canada'], ['london', 'United Kingdom'], ['xetra', 'Germany'],
  ['frankfurt', 'Germany'], ['paris', 'France'], ['stockholm', 'Sweden'], ['milan', 'Italy'],
  ['madrid', 'Spain'], ['amsterdam', 'Netherlands'], ['brussels', 'Belgium'], ['copenhagen', 'Denmark'],
  ['oslo', 'Norway'], ['helsinki', 'Finland'], ['athens', 'Greece'], ['vienna', 'Austria'],
  ['warsaw', 'Poland'], ['lisbon', 'Portugal'], ['jakarta', 'Indonesia'], ['kuala lumpur', 'Malaysia'],
  ['bangkok', 'Thailand'], ['mumbai', 'India'], ['johannesburg', 'South Africa'], ['singapore', 'Singapore'],
  ['saudi', 'Saudi Arabia'], ['dubai', 'United Arab Emirates'], ['são paulo', 'Brazil'], ['sao paulo', 'Brazil'],
];

function fromExchange(raw) {
  const s = lc(raw);
  if (!s) return null;
  if (EX_EXACT[s]) return EX_EXACT[s];
  for (const [needle, country] of EX_SUBSTR) { if (s.includes(needle)) return country; }
  return null;
}

// Yahoo-Ticker-Listing-Suffix -> Land (spiegelt router FOREIGN_SUFFIX). Achtung:
// .BR = Bruessel (Belgien), .SA = Sao Paulo (Brasilien) — NICHT verwechseln.
const SUFFIX_COUNTRY = {
  HK: 'Hong Kong', KS: 'South Korea', KQ: 'South Korea', TW: 'Taiwan', TWO: 'Taiwan',
  SS: 'China', SZ: 'China', T: 'Japan', L: 'United Kingdom', TO: 'Canada', V: 'Canada',
  NE: 'Canada', F: 'Germany', DE: 'Germany', BE: 'Germany', VI: 'Austria', PA: 'France',
  AS: 'Netherlands', BR: 'Belgium', LS: 'Portugal', MC: 'Spain', MI: 'Italy', ST: 'Sweden',
  HE: 'Finland', CO: 'Denmark', OL: 'Norway', SW: 'Switzerland', AX: 'Australia', NZ: 'New Zealand',
  SI: 'Singapore', JK: 'Indonesia', KL: 'Malaysia', BK: 'Thailand', BO: 'India', NS: 'India',
  QA: 'Qatar', TA: 'Israel', AT: 'Greece', WA: 'Poland', SA: 'Brazil', SN: 'Chile', MX: 'Mexico',
  JO: 'South Africa', SR: 'Saudi Arabia',
};

function fromTicker(ticker) {
  if (typeof ticker !== 'string') return null;
  const m = ticker.match(/\.([A-Za-z]{1,3})$/); // nur Punkt-Suffix; Dash-Class-Shares (BRK-A) zaehlen NICHT
  if (!m) return null;
  return SUFFIX_COUNTRY[m[1].toUpperCase()] || null;
}

// Erstes verlaessliches AUSLANDS-Signal (nicht-US) aus mehreren Kandidaten.
const firstForeign = (...c) => c.find((x) => x && x !== 'United States') || null;

/**
 * normalizeCountry(meta) -> { country: string|null, region: string|null }
 * meta = snapshot.meta (oder null/undefined). region = grober Kontinent-Bucket
 * (North America/South America/Europe/Asia/Middle East/Africa/Oceania), null wenn
 * Land unbekannt oder kein Region-Mapping vorhanden.
 */
function normalizeCountry(meta) {
  const m = meta || {};
  let country = canonCountry(m.country); // 1. Domizil (Vorrang, wie router.isUS country-first)
  if (!country) {
    // 2. Ohne Domizil: ein AUSLANDS-Signal (foreign Boerse / region-Code / Ticker-Suffix) ist
    //    verlaesslich; eine US-Boerse (NYSE/Nasdaq) ODER region='US' ist es NICHT — ADRs listen
    //    in den USA (region=CN/TW > NYSE: BABA/TSM), foreign-gelistete Namen tragen teils faelschlich
    //    region='US' (HKSE > region=US). Daher erst das erste Nicht-US-Signal, sonst US-Fallback.
    //    Spiegelt router.isUS, das FOREIGN_EX/FOREIGN_SUFFIX VOR dem region-US_SIGNAL prueft.
    const fromEx = fromExchange(m.exchangeName);
    const fromReg = fromExchange(m.region);
    const fromTik = fromTicker(m.ticker); // per Konstruktion immer foreign
    country = firstForeign(fromEx, fromReg, fromTik) || fromEx || fromReg || fromTik || null;
  }
  const region = country ? (COUNTRY_TO_REGION[country] || null) : null;
  return { country, region };
}

module.exports = { normalizeCountry, COUNTRY_TO_REGION };
