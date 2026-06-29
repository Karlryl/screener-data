'use strict';
/**
 * Hypergrowth Engine — Schicht 1: Router (feste Pruefreihenfolge)
 * ==============================================================
 * Mappt jede Aktie deterministisch in genau EINE Branchen-Formel ODER excludet
 * sie. Liest ausschliesslich norm()-Serien + meta. Feste Reihenfolge
 * (frueheste Wahr-Bedingung gewinnt):
 *
 *   Schritt 1  Struktur-Hard-Exclude (Telecom, Bilanz-Banken, Versicherer, mREIT)
 *   Schritt 2  annualGP=0-Hard-Exclude — NUR Lending-Industrien (Credit Services/
 *              Mortgage/Consumer Finance/Savings/Thrift, z.B. SOFI). VOR grossMargin-Logik.
 *   Schritt 3  Branchen-Routing; sektorlos (Fonds/ETF/Trust) -> no-sector-Exclude
 *   Schritt 4  Pre-Revenue-Guard (nur sektor-routebare Namen) -> survival-track (NIE Growth-Score)
 *
 * audit/fix (R1/R2/R3, 2026-06-26): (a) Schritt 2 war sektor-unabhaengig und warf jeden GP=0-Namen
 * raus (HUM/MKSI/WOLF/JLL + Broker MS/SCHW/RJF/NTRS) -> jetzt auf Lending-Industrien gegated.
 * (b) Pre-Revenue lief frueher als Schritt 0 VOR no-sector, sodass sektorlose Fonds/ETFs (QQQ/MDY)
 * faelschlich in den Survival-Track kamen -> jetzt NACH no-sector (echte Pre-Rev-Biotechs tragen
 * immer sector=Healthcare). GP-Klassifikation (fuer Financials) wie gehabt.
 *
 * GP-Klassifikation nutzt den MASTER-DISKRIMINATOR r = firstPresent(normGP) /
 * firstPresent(normRev); grossMargin ist NUR Tie-Break, wenn r nicht berechenbar
 * ist (ICE/CME/NDAQ: gm=100 ABER r~0.7 -> ECHTER GP, nicht degeneriert).
 */

const { norm, hasPresent, firstPresent, presentValues, metricVal } = require('./snapshot.js');

const lc = (x) => (typeof x === 'string' ? x.toLowerCase() : '');

// US-Erkennung (Plan: US-Universe). meta.region ist in BEIDE Richtungen
// unzuverlaessig: auslaendische ADRs tragen den Laendercode (TSM region='TW'),
// auslaendisch GELISTETE Namen tragen teils faelschlich region='US' bei
// exchangeName='HKSE'/country='China' (6699.HK). Daher mehrschichtig, country
// zuerst (Domizil schlaegt Listing):
const US_SIGNAL = /nasdaq|nyse|amex|arca|bats|cboe|\botc\b|pink|\bnms\b|\bncm\b|\bngm\b|\bus\b|\busa\b|united states/i;
// audit/fix (Court Fall 8, F1): dublin/dubai/abu dhabi ergaenzt (Irland/VAE-Boersen). Konservativ
// nur volle Wortmarken (kein \bise\b/\badx\b — die wuerden echte Ticker/CEFs treffen).
const FOREIGN_EX = /hkse|hong kong|tokyo|\bjpx\b|\bkrx\b|korea|taiwan|\btwse\b|\bsehk\b|shanghai|shenzhen|london|\blse\b|frankfurt|xetra|euronext|toronto|\btsx\b|\basx\b|\bsix\b|bolsa|borsa|stockholm|oslo|helsinki|copenhagen|johannesburg|\bjse\b|\bb3\b|dublin|dubai|abu dhabi/i;
// audit/fix (Court Fall 8, F1): IR (Euronext Dublin) + AE (Nasdaq Dubai/Abu Dhabi) ergaenzt —
// vorher fielen echte foreign-listed Namen (BIRG.IR/PTSB.IR/EMAAR.AE) faelschlich auf exclude
// non-us statt in den globalen Topf. Allgemeine Geo-Klassifikatoren, kein namens-spezifischer Carve-out.
const FOREIGN_SUFFIX = /\.(HK|KS|KQ|TW|TWO|SS|SZ|SR|T|L|TO|V|NE|F|DE|BE|VI|PA|AS|BR|LS|MC|MI|ST|HE|CO|OL|SW|AX|NZ|SI|JK|KL|BK|BO|NS|QA|TA|AT|WA|SA|SN|MX|JO|IR|AE)$/i;
// A3-Stufe-1 (2026-06-27, Weltweit-Pivot): US-PRIMAERboerse (NYSE/Nasdaq/Cboe/Amex/Arca), NICHT
// OTC/Grey-Market. Oeffnet US-gelistete foreign-domiciled ADRs (USD-quotiert, SEC-Filer:
// ACN/ETN/TSM/BABA/ASML) und haelt die ~316 OTC-Grey-Market-Schattenduplikate primaerer ADRs
// (ASMLF=ASML, SAPGF=SAP) bis A4-Lampen/Dedup zurueck.
const US_PRIMARY_EX = /nasdaq|nyse|amex|arca|bats|cboe/i;
// audit/fix (R1/R2): GP=0-Exclude NUR fuer echte Lending-Geschaeftsmodelle (kein Gross-Profit-
// Konzept), nicht universell — sonst fallen Nicht-Lender mit Yahoo-leerem GP (HUM/MKSI/WOLF/JLL)
// und Broker/Asset-Manager (MS/SCHW/RJF/NTRS, die ins financials-Scoring gehoeren) faelschlich raus.
// SOFI (industry "Credit Services") bleibt korrekt excludiert (Fixture-Constraint).
const LENDING_INDUSTRY = /credit services|consumer finance|mortgage|savings|thrift|\blend/;
// audit/fix (Court Phase A Runde 2, Fall 8/1b): Non-Operating-Vehikel mit KOMPLETT leerem
// annualRev. Signaturen (a)-(c) verlangen alle PRESENT-Umsatzwerte; ein CEF/Shell/Asset-Manager
// mit gaenzlich leerem annualRev faellt durch -> landet faelschlich auf dem survival-Runway-Board
// (das per Court-Intent vom grade-D-Floor ausgenommen ist). ENG industrie-gescoped: NICHT jeder
// leer-annualRev-Name (echte Pre-Rev-Biotechs UND Dev-Stage-Miner/Uran/Lithium haben auch leeren
// annualRev und MUESSEN auf dem Board bleiben), nur die Finanz-Vehikel-Industrien.
const NON_OPERATING_VEHICLE_INDUSTRY = /asset management|closed[- ]end fund|shell companies|\bbdc\b|term trust/;
// A3-Stufe-1: US-Primaerlisting = US-Primaerboerse, KEINE Auslandsboerse, KEIN Auslands-Suffix.
function isUsPrimaryListing(m) {
  const ex = m && m.exchangeName;
  if (!ex || !US_PRIMARY_EX.test(ex) || FOREIGN_EX.test(ex)) return false;
  if (m.ticker && FOREIGN_SUFFIX.test(m.ticker)) return false;
  return true;
}
// A3-Stufe-2 (2026-06-27, Weltweit-Pivot): foreign-LISTED = an einer echten Auslandsboerse
// (FOREIGN_EX) ODER mit Auslands-Suffix (FOREIGN_SUFFIX) gelistet. Diese ~1584 Namen werden in
// den globalen Topf geoeffnet — der A4-data-suspect-Gate (score.js, VOR dem Scoring) schuetzt vor
// erfundenen/geleakten Auslandsdaten, die 8 Achsen sind waehrungs-invariant (Ratios/Wachstum/Slope
// im selben Snapshot, §7-De-Risking an Realdaten bestaetigt). BEWUSST NICHT geoeffnet: die US-OTC-
// Grey-Market-Schattenduplikate (ASMLF=ASML: US-OTC, keine Auslandsboerse/-Suffix) — sie bleiben
// fuer den spaeteren Dedup-Zyklus zurueckgestellt (sonst Doppel-Issuer im Topf/Tab).
function isForeignListed(m) {
  if (!m) return false;
  if (m.exchangeName && FOREIGN_EX.test(m.exchangeName)) return true;
  if (m.ticker && FOREIGN_SUFFIX.test(m.ticker)) return true;
  return false;
}
function isUS(s) {
  const m = (s && s.meta) || {};
  // audit/feat (A3-Stufe-1): US-PRIMAERboersen-gelistete foreign-domiciled ADRs (USD/SEC-Filer)
  // VOR der Domizil-Regel zulassen — country-first (Auslands-Domizil) bzw. region (BABA=CN/TSM=TW)
  // wuerde sie sonst als 'non-us' excludieren. OTC-Grey-Market + foreign-LISTED bleiben bis A4 draussen.
  if (isUsPrimaryListing(m)) return true;
  if (m.country) return /united states|usa/i.test(m.country); // Domizil hat Vorrang
  if (m.exchangeName && FOREIGN_EX.test(m.exchangeName)) return false; // klare Auslands-Boerse
  if (m.ticker && FOREIGN_SUFFIX.test(m.ticker)) return false;        // Auslands-Listing-Suffix
  if (m.region) return US_SIGNAL.test(m.region);
  if (m.exchangeName) return US_SIGNAL.test(m.exchangeName);
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

// --- Schritt 1b: Non-operating-Vehicle-Exclude -----------------------------
// Investment-Trusts/Holdings/BDCs/Closed-End-Funds fuehren Anlagegewinn/-verlust als "Umsatz"
// (keine operative Umsatzbasis) -> gehoeren nicht in einen Umsatz-WACHSTUMS-Topf (ranken sonst auf
// Mark-to-Market-Schwankung #1 financials). Erst durch das Oeffnen der foreign-listed Namen voll
// sichtbar (Audit-Fund A3-Stufe-2). Drei an Realdaten gegen ECHTE Fee-Asset-Manager (BLK/BX/KKR/
// APO/BN/BAM/ARES/OWL — alle GP>0 ODER ni/rev<<1 ODER negQ=false) abgesicherte Signaturen:
//   (a) negativer JAHRESumsatz -> Closed-End-Funds/Bullion-Trusts (SMT.L/ADX); universell sicher.
//   (b) Asset-Management MIT negativem QUARTALSumsatz -> NAV-Holdings/BDCs (Industrivaerden/Investor
//       AB/Kinnevik). NUR auf Asset-Management gescoped: ein einzelnes negatives Quartal ist bei
//       OPERATIVEN Firmen (DD/TFX/BTE: Restatement/Glitch) legitim -> universell = 16 False-Positives.
//   (c) Asset-Management OHNE Kostenstruktur: GP vorhanden-und-null UND |netIncome/revenue|>0.9 ->
//       "Umsatz" IST der Anlagegewinn, kein Fee-Geschaeft (3i Group, dessen Quartal positiv bleibt).
function isNonOperatingVehicle(s) {
  // (a) negativer JAHRESumsatz -> Closed-End-Funds/Bullion-Trusts (SMT.L/ADX): "Umsatz" = Anlage-
  //     gewinn/-verlust, kein operativer Umsatz. Universell sicher (1 harmloser Borderline: NBTX,
  //     ein Biotech mit korruptem -8.4M-Glitch-Jahr -> ohnehin Datenmangel). Eine NI~rev-Verfeinerung
  //     wurde VERWORFEN: sie gab 3 echte Muni-Bond-CEFs (BTT/NZF/PTA, NI/rev 1.8-3.5) faelschlich frei.
  const revAnn = norm(s, 'annualRev');
  if (hasPresent(revAnn) && presentValues(revAnn).some((v) => v < 0)) return true;        // (a)
  const ind = lc(s && s.meta ? s.meta.industry : '');
  // (d) KOMPLETT leerer annualRev + Finanz-Vehikel-Industrie -> CEF/Shell/Asset-Manager/BDC
  //     (BMEZ/RVI/PIN.L = Asset Management, XXI = Shell Companies). Eng gescoped (s.o.): echte
  //     Pre-Rev-Biotechs/Dev-Stage-Miner (leer-annualRev, aber NICHT diese Industrien) bleiben.
  if (!hasPresent(revAnn) && NON_OPERATING_VEHICLE_INDUSTRY.test(ind)) return true;        // (d)
  if (!ind.includes('asset management')) return false;
  const revQ = norm(s, 'revenueQ');
  if (hasPresent(revQ) && presentValues(revQ).some((v) => v < 0)) return true;            // (b)
  const gp = norm(s, 'annualGP');                                                          // (c)
  if (hasPresent(gp) && presentValues(gp).every((v) => v === 0)) {
    const r0 = firstPresent(revAnn), n0 = firstPresent(norm(s, 'annualNetIncome'));
    if (r0 !== null && r0 > 0 && n0 !== null && Math.abs(n0 / r0) > 0.9) return true;
  }
  return false;
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
  // Universum-Filter (Weltweit-Pivot): US (isUS: US-Domizil + US-primaer-gelistete ADRs, A3-Stufe-1)
  // ODER foreign-LISTED (echte Auslandsboerse, A3-Stufe-2 — globaler Topf). Nur die US-OTC-Grey-Market-
  // Schattenduplikate (foreign-domiciled, aber keine Auslandsboerse/-Suffix) bleiben als Duplikate
  // zurueckgestellt -> non-us. Die Achsen sind waehrungs-invariant, also verzerren die foreign-listed
  // (auch nicht-USD-konvertierte) die Kohorten-Perzentile nicht (§7-De-Risking an Realdaten).
  if (!isUS(s) && !isForeignListed((s && s.meta) || {})) return { action: 'exclude', reason: 'non-us' };
  // Schritt 1: Struktur-Hard-Exclude
  const se = structExcludeReason(s);
  if (se) return { action: 'exclude', reason: se };
  // Schritt 1b: Non-operating-Vehicle-Exclude (Weltweit-Pivot) — Investment-Trusts/Holdings/BDCs raus.
  if (isNonOperatingVehicle(s)) return { action: 'exclude', reason: 'non-operating-rev' };
  // Schritt 2: annualGP=0-Exclude — VOR jeder grossMargin-Logik, NUR Lending-Industrien
  // (audit/fix R1/R2: nicht universell, sonst raus mit Nicht-Lendern/Brokern).
  const gp = norm(s, 'annualGP');
  if (hasPresent(gp) && presentValues(gp).every((v) => v === 0)
      && LENDING_INDUSTRY.test(lc(s && s.meta ? s.meta.industry : ''))) {
    return { action: 'exclude', reason: 'lender-gp0' };
  }
  // Schritt 3: Branchen-Routing. Sektorlose/nicht-operative Entitaeten (Bullion-Trusts,
  // Warrants, Fonds/ETFs, stale Ticker ohne meta.sector) sauber excludieren.
  const formulaId = sectorRoute(s);
  if (formulaId === 'unrouted') return { action: 'exclude', reason: 'no-sector' };
  // Schritt 4: Pre-Revenue-Guard NACH no-sector (audit/fix R3: echte Pre-Rev-Biotechs tragen
  // immer sector=Healthcare; sektorlos+umsatzlos = Fonds/ETF -> no-sector, nicht survival).
  // audit/fix (Court Fall 1a): Track sektor-NEUTRAL benannt — der survival-Track ist by-design
  // sektor-blind (nur ~46/77 sind wirklich Healthcare; Rest sind echte cross-sektor Dev-Stage:
  // Uran/Lithium/Gold/Reactor OKLO/NXE/QS …). 'pre-revenue-biotech' war ein Mislabel.
  if (isPreRevenue(s)) return { action: 'survival', track: 'pre-revenue', reason: 'no-revenue' };
  const out = { action: 'route', formulaId };
  if (formulaId === 'financials') out.gpClass = gpClass(s);
  return out;
}

module.exports = { route, gpClass, isPreRevenue, structExcludeReason, sectorRoute, isUS, isForeignListed };
