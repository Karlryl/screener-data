#!/usr/bin/env node
/**
 * court-screen.js — Schritt 1 von 2 des court-gehärteten Hypergrowth-Screens.
 *
 * Liest alle US-Fundamentals (no-suffix .json) aus fundamentals-cache/, extrahiert
 * die Achsen-Rohwerte der court-Formeln (Fabless v5.1 + SaaS v1.0) und wendet einen
 * WEITEN Membership-Vorfilter an (asset-light + GM-Floor + Scale + Growth), um das
 * Universum von ~3200 auf die plausiblen Hypergrowth-Kandidaten zu reduzieren.
 *
 * WICHTIG: Profitabilität ist NIE ein Gate (Spec §3). Pre-profit-Namen bleiben drin.
 * Ausgabe: outputs/court-candidates.json  (Rohwerte, noch NICHT cross-sectional gescort).
 * Das eigentliche pseudo-z/MAD/tanh-Scoring passiert in Schritt 2 (court-score.js),
 * NACH der Sub-Industry-Klassifikation, weil z/MAD bucket-relativ ist.
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

// Medtech-Bypass: Industry-Set aus Snapshots aufbauen (keine sector-Info in fundamentals-cache)
// Dieser Set wird NUR für den asset-light-Gate-Bypass genutzt; die eigentliche Bucket-Klassifikation
// bleibt in court-buckets.json (deterministisch, SI-5).
const SNAP_DIR = path.join(ROOT, 'snapshots');
const MEDTECH_INDUSTRIES = new Set(['Medical Devices', 'Medical Instruments & Supplies']);
const medtechTickers = new Set();
const snapMarketCap = new Map(); // ticker -> marketCap.value
const snapRnD = new Map(); // ticker -> annualRnD array

// ===========================================================================
// VINTAGE-TOLERANT US-LISTING CLASSIFIER  (audit/fix gauntlet C5)
// ===========================================================================
// audit/fix (gauntlet C5): die snapshots/<T>.json existieren in ZWEI Vintages
//   - Vintage A (älter): meta.country=undefined, meta.region = Exchange-Code
//       ("NYSE"/"NasdaqGS"…) ODER Region-/Ländercode ("US"/"CN"), kein annualShares.
//   - Vintage B (neuer): meta.country="United States", meta.region="US".
// FAILURE MODE 1 (vintage-A exile): ein naiver `meta.country !== "United States"`
//   Filter exiliert die GESAMTE Vintage A still (~halbes Universum inkl. RTX/LMT/
//   UNP/ITW…) — die fallen raus, weil ihr country undefined ist.
// FAILURE MODE 2 (foreign-ADR leak): ein USD/Exchange-only Filter LÄSST foreign-
//   primary ADRs durch (BTI/ABEV/FMX/CNI/CP), die USD an US-Börsen handeln und die
//   Kohorten-NORMS+REL vergiften. Diese tragen meta.region = HEIMATMARKT-Code
//   ("UK"/"EM"/"CA"), NICHT "US" — daran sind sie strukturell erkennbar.
//
// US-Exchange-Whitelist (gilt für region ODER exchangeName in Vintage A/B).
const US_EXCHANGE_WHITELIST = new Set([
  'NYSE', 'NasdaqGS', 'NasdaqGM', 'NasdaqCM', 'NYSEArca', 'BATS',
  'NYSE American', 'AMEX', 'Cboe US', 'Nasdaq', 'US',
]);
// Foreign-Exchange-/Region-Codes, die NIE US sind (OTC/Pink + Heimatmarkt-Regionen
// der foreign-primary ADRs). region∈{UK,EM,CA,EU,CN,TW,…} ⇒ kein US-Primary.
const NON_US_EXCHANGE_BLACKLIST = new Set([
  'OTC Markets OTCPK', 'OTC Markets OTCQX', 'OTC', 'PNK', 'Other OTC',
  'YHD', // Yahoo-Placeholder/delisted-stale — kein verlässliches US-Listing-Signal
]);
// Ticker-Suffixe ausländischer Primärbörsen (ADR/Foreign-Listing-Guard).
const FOREIGN_SUFFIX_RE = /\.(HK|SW|TO|L|PA|DE|AX|SS|SZ|T|V|MI|MC|AS|BR|ST|HE|OL|VI|F|SA|MX|TW|KS|KQ|NS|BO)$/i;
// audit/fix (gauntlet C5): EXPLIZITE, VERIFIZIERTE Allowlist echter US-PRIMARY-
// INVERSIONS — Firmen mit ausländischem Domizil (meta.country != US) aber echter
// US-Primärnotierung. Yahoo flaggt diese mit meta.region="US"; der country-Guard
// würde sie sonst fälschlich exilieren. MINIMAL halten — nur Namen, die als
// US-Primary verifiziert sind und im Universum vorkommen. region="US" deckt die
// 8 aktuell gescorten Inversions (ARM/CLBT/ESTC/CGNT/LSPD/BLCO/INMD/SNN) generativ
// ab; diese Liste ist NUR für echte US-Primary-Namen mit region != "US".
const US_PRIMARY_INVERSION_ALLOWLIST = new Set([
  'STVN', // Stevanato Group — Italy-domiciled, NYSE-primary, USD; region="EU" (kein US-Code), aber US-Primary
  // Kandidaten aus der Spec (nur aufnehmen, falls real im Universum + region != "US"):
  // 'ETN','ALLE','AER','CNH','RTO','CMPR' — derzeit region="US" ⇒ schon generativ erfasst, NICHT nötig.
]);

// isUSListing(meta, ticker, name): vintage-toleranter US-Listing-Klassifizierer.
// TRUE wenn:
//   (a) meta.country === "United States", ODER
//   (b) meta.country UNSET (undefined/null) UND region/exchangeName auf der
//       US-Exchange-Whitelist (Vintage A), ODER
//   (c) US-PRIMARY-INVERSION: country SET != US, ABER Yahoo-region="US" (oder auf
//       der expliziten Allowlist) UND US-Exchange UND USD-Reporting.
// FALSE (Guards) bei: OTC/Pink; ausländischen Ticker-Suffixen; reportingCurrency
//   gesetzt und != "USD"; country SET != US ohne US-Primary-Signal (foreign ADR).
function isUSListing(meta, ticker, name) {
  meta = meta || {};
  const country = meta.country;
  const region = meta.region == null ? null : String(meta.region);
  const exch = meta.exchangeName == null ? null : String(meta.exchangeName);
  const rc = meta.reportingCurrency == null ? null : String(meta.reportingCurrency);

  // Guard 1: ausländisches Ticker-Suffix (.HK/.SW/.TO/.L/.PA/.DE/.AX/.SS/.SZ/.T …) ⇒ foreign primary.
  if (ticker && FOREIGN_SUFFIX_RE.test(String(ticker))) return false;
  // Guard 2: explizit ausländische/OTC Region ODER Exchange ⇒ kein US-Listing.
  if (region && NON_US_EXCHANGE_BLACKLIST.has(region)) return false;
  if (exch && NON_US_EXCHANGE_BLACKLIST.has(exch)) return false;
  // Guard 3: reportingCurrency gesetzt und != USD ⇒ foreign primary.
  if (rc && rc !== 'USD') return false;

  // (a) Domizil USA ⇒ US.
  if (country === 'United States') return true;

  const onUSExchange = (region && US_EXCHANGE_WHITELIST.has(region)) || (exch && US_EXCHANGE_WHITELIST.has(exch));

  // COUNTRY-DOMICILE-GUARD: ein GESETZTES country != "United States" schließt IMMER
  // aus — AUSSER es ist eine verifizierte US-Primary-Inversion (region="US" auf
  // US-Exchange + USD, ODER auf der expliziten Allowlist).
  if (country != null && country !== 'United States') {
    // audit/fix (gauntlet C5, red-team): gate the inversion on region==='US' — the
    // STRUCTURAL US-primary signal Yahoo sets. Keying on onUSExchange alone leaked
    // every foreign ADR trading USD on NYSE/Nasdaq (BTI/ABEV/FMX/CNI/CP carry
    // region=UK/EM/CA, NOT "US"). region="US" keeps genuine inversions (ARM/ESTC/
    // INMD) true; STVN (region="EU") stays covered by the explicit allowlist.
    const isUSPrimaryInversion =
      (region === 'US' && onUSExchange && (rc === 'USD' || rc == null)) ||
      US_PRIMARY_INVERSION_ALLOWLIST.has(String(ticker));
    return !!isUSPrimaryInversion;
  }

  // (b) country UNSET (Vintage A): US-Exchange-Whitelist auf region/exchangeName.
  if (country == null) {
    return !!onUSExchange;
  }
  return false;
}

// usListingByTicker: Side-Map ticker -> {country, region, exchangeName, reportingCurrency, isUS}.
// Wird als outputs/court-listing.json geschrieben (env-Override court-listing) und von
// court-score.js für den GENERATIVEN Anti-Leak-Assert gelesen. Bewusst KEIN Feld auf den
// candidate-Records → court-candidates.json + alle Member-JSON bleiben BYTE-IDENTISCH (Parität).
const usListingByTicker = new Map();
if (fs.existsSync(SNAP_DIR)) {
  for (const f of fs.readdirSync(SNAP_DIR)) {
    if (!f.endsWith('.json') || /\./.test(f.replace(/\.json$/, ''))) continue;
    try {
      const sn = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8'));
      const m = sn.meta || {};
      const t = m.ticker || f.replace(/\.json$/, '');
      if (m.sector === 'Healthcare' && MEDTECH_INDUSTRIES.has(m.industry)) {
        medtechTickers.add(t);
      }
      if (sn.marketCap && sn.marketCap.value != null) snapMarketCap.set(t, sn.marketCap.value);
      if (sn.annual && Array.isArray(sn.annual.annualRnD)) snapRnD.set(t, sn.annual.annualRnD.map(v => (v == null ? null : Number(v))).filter(v => v != null && isFinite(v)));
      usListingByTicker.set(t, {
        country: m.country == null ? null : m.country,
        region: m.region == null ? null : m.region,
        exchangeName: m.exchangeName == null ? null : m.exchangeName,
        reportingCurrency: m.reportingCurrency == null ? null : m.reportingCurrency,
        isUS: isUSListing(m, t, m.longName || m.shortName || ''),
      });
    } catch {}
  }
}

const CACHE = path.join(ROOT, 'fundamentals-cache');
const OUT = process.env.COURT_CAND_OUT || path.join(ROOT, 'outputs', 'court-candidates.json'); // env-Override für isolierten Test/Verify-Lauf (Re-Court-Auflage)

// --- diagnostics_lst (D&LST) Universum-Bypass ---
// ADDITIV (parity-safe): das D&LST-Universum (Diagnostics & Research + Life-Science-Tools, n=29) ist wie
// Medtech NICHT durchgehend asset-light (Tools/Instruments-Namen haben hohe PPE) und enthält Large-Caps
// (TMO/DHR/A) für die cross-sektionalen Perzentil-Anker. Wir nehmen exakt die in court-buckets.json als
// `diagnostics_lst` klassifizierten Ticker vom asset-light/ppe-Gate + den ökonomischen Floors aus (analog
// medtech, Fix A SI-5: keine stillen Drops → classifiedCount===scoredCount in court-score.js). Die Quelle
// ist die DETERMINISTISCHE Klassifikation (court-buckets.json), NICHT eine Industry-Heuristik — so kommt
// genau dieses Set rein und der Nicht-D&LST/Nicht-Medtech-Pfad bleibt BYTE-IDENTISCH (Parität SaaS/Fabless).
const BUCK = path.join(ROOT, 'outputs', 'court-buckets.json');
const dlstTickers = new Set();
// industrials_compounder CORE bucket (Spec formula-design-industrials-compounder-v1-2026-06-21.md).
// ADDITIV/parity-safe: exactly the court-buckets.json `industrials_heavy`/`industrials_light` tickers are
// admitted past the asset-light/growth pre-filter (analog medtech/dlst, Fix A SI-5: no silent drops). The
// 5 RAW axis inputs are extracted from snapshots/<T>.json (the canonical pool the classifier + NORMS use),
// attached as ONE industrials-only field `ind` → SaaS/Fabless/Medtech/D&LST candidate JSON byte-identical.
const indCohortByTicker = new Map(); // ticker -> 'industrials_heavy' | 'industrials_light'
// consumer_staples_compounder CORE bucket (Spec formula-design-consumer-staples-compounder-v1-2026-06-21.md).
// ADDITIV/parity-safe: exactly the court-buckets.json `staples_branded`/`staples_distribution` tickers are
// admitted past the asset-light/growth pre-filter (analog medtech/dlst/industrials, Fix A SI-5: no silent
// drops). The 5 RAW axis inputs are extracted from snapshots/<T>.json, attached as ONE staples-only field
// `stp` → SaaS/Fabless/Medtech/D&LST/Industrials candidate JSON byte-identical.
const stpCohortByTicker = new Map(); // ticker -> 'staples_branded' | 'staples_distribution'
// consdisc_expansion CORE bucket (Spec formula-design-consumer-disc-expansion-v1-2026-06-21.md).
// ADDITIV/parity-safe: exactly the court-buckets.json `consdisc_store`/`consdisc_light` tickers are admitted
// past the asset-light/growth pre-filter (analog medtech/dlst/industrials/staples, Fix A SI-5: no silent
// drops). The 4 RAW axis inputs + shareCAGR are extracted from snapshots/<T>.json, attached as ONE
// consdisc-only field `cd` → SaaS/Fabless/Medtech/D&LST/Industrials/Staples candidate JSON byte-identical.
const cdCohortByTicker = new Map(); // ticker -> 'consdisc_store' | 'consdisc_light'
// materials_quality CORE bucket (Spec formula-design-materials_quality-v0-2026-06-22.md).
// ADDITIV/parity-safe: exactly the court-buckets.json `materials_pricingpower`/`materials_commodity` tickers
// are admitted past the asset-light/growth pre-filter (analog medtech/dlst/industrials/staples/consdisc,
// Fix A SI-5: no silent drops). The 5 RAW axis inputs are extracted from snapshots/<T>.json, attached as ONE
// materials-only field `mt` → all other candidate JSON byte-identical.
const mtCohortByTicker = new Map(); // ticker -> 'materials_pricingpower' | 'materials_commodity'
// energy_quality CORE bucket (Spec formula-design-energy_quality-v0-2026-06-22.md).
// ADDITIV/parity-safe: exactly the court-buckets.json `energy_{upstream,midstream,services}` tickers are admitted
// past the asset-light/growth pre-filter (analog medtech/dlst/industrials/staples/consdisc/materials, Fix A SI-5:
// no silent drops). The 5 RAW axis inputs are extracted from snapshots/<T>.json, attached as ONE energy-only field
// `en` → all other candidate JSON byte-identical.
const enCohortByTicker = new Map(); // ticker -> 'energy_upstream' | 'energy_midstream' | 'energy_services'
const ENERGY_COHORTS = new Set(['energy_upstream', 'energy_midstream', 'energy_services']);
// pharma_commercial CORE bucket (Spec formula-design-pharma_court-v0-2026-06-22.md).
// ADDITIV/parity-safe: exactly the court-buckets.json `pharma_{branded,biopharma,specialty}` tickers are admitted
// past the asset-light/growth pre-filter (analog medtech/dlst/industrials/staples/consdisc/materials/energy,
// Fix A SI-5: no silent drops). The 3 RAW axis inputs {growth, gm, eff} are extracted from snapshots/<T>.json,
// attached as ONE pharma-only field `ph` → all other candidate JSON byte-identical.
const phCohortByTicker = new Map(); // ticker -> 'pharma_branded' | 'pharma_biopharma' | 'pharma_specialty'
const PHARMA_COHORTS = new Set(['pharma_branded', 'pharma_biopharma', 'pharma_specialty']);
// it_services CORE bucket (Spec formula-design-special_tracks-v0-2026-06-22.md PART B).
// ADDITIV/parity-safe: exactly the court-buckets.json `it_services` tickers are admitted past the asset-light/
// growth pre-filter (analog the other CORE buckets, Fix A SI-5: no silent drops). The 5 RAW axis inputs
// {gpa, fcfMargin, opMargin, growth, netIssuance} are extracted from snapshots/<T>.json, attached as ONE
// itservices-only field `it` -> all other candidate JSON byte-identical.
const itCohortByTicker = new Map(); // ticker -> 'it_services'
const ITSERVICES_COHORTS = new Set(['it_services']);
// financials_banks CORE court bucket (court gauntlet DESIGN, BUILD_WITH_CAVEATS / court REVISE 2026-06-23).
// ADDITIV/parity-safe: exactly the court-buckets.json `financials_banks` tickers are admitted past the asset-light/
// growth pre-filter (analog the other CORE buckets, Fix A SI-5: no silent drops). The 4 RAW axis inputs
// {roaThruCycle, capitalAdequacy, assetGrowthYoY, earningsDurability} are extracted from snapshots/<T>.json
// annualNetIncome + annualBalance.{totalAssets,totalEquity}, attached as ONE banks-only field `bk` -> all other
// candidate JSON byte-identical. FCF/OCF are NEVER extracted as axes (economically meaningless for banks).
const bkCohortByTicker = new Map(); // ticker -> 'financials_banks'
const BANKS_COHORTS = new Set(['financials_banks']);
// equity_reits CORE court bucket (court gauntlet DESIGN, BUILD_WITH_CAVEATS / court REVISE 2026-06-24).
// ADDITIV/parity-safe: exactly the court-buckets.json `equity_reits` tickers are admitted past the asset-light/
// growth pre-filter (analog the other CORE buckets, Fix A SI-5: no silent drops). The 4 RAW axis inputs
// {opMargin, ffoAssets, revG3, ndGA} are extracted from snapshots/<T>.json annual.* — the FLOW fields
// (annualRev/OpInc/NetIncome/Depreciation) are {value}-WRAPPED (court revision #1: MUST unwrap before arithmetic),
// annualBalance.{totalAssets,totalDebt,totalCash} are RAW — attached as ONE reits-only field `re` -> all other
// candidate JSON byte-identical. 'REIT - Mortgage' is HARD-SEPARATED OUT in the classifier (never reaches here).
const reCohortByTicker = new Map(); // ticker -> 'equity_reits'
const REITS_COHORTS = new Set(['equity_reits']);
// capmkt_fee_core CORE court bucket (court gauntlet DESIGN, BUILD_WITH_CAVEATS / court REVISE 2026-06-24).
// ADDITIV/parity-safe: exactly the court-buckets.json `capmkt_fee_core` tickers are admitted past the asset-light/
// growth pre-filter (analog the other CORE buckets, Fix A SI-5: no silent drops). The 4 RAW axis inputs
// {opMargin, opMarginStability, fcfMargin, netIssuance} are extracted from snapshots/<T>.json annual.* — the FLOW
// fields (annualRev/OpInc/FCF/NetIncome) MAY be {value}-WRAPPED, annualShares is a raw-number array — attached as ONE
// capmkt-only field `cm` -> all other candidate JSON byte-identical. The fee-gate (fcfMargin>1.0 / niMargin>=0.95) +
// de-ADR country guard already ran in the classifier; out-of-class names never reach here.
const cmCohortByTicker = new Map(); // ticker -> 'capmkt_fee_core'
const CAPMKT_COHORTS = new Set(['capmkt_fee_core']);
// tech_hardware_quality CORE court bucket (council/court triage 2026-06-24 — the ONE remaining quality-compounder gap).
// ADDITIV/parity-safe: exactly the court-buckets.json `tech_hardware_quality` tickers are admitted past the asset-light/
// growth pre-filter (analog the other CORE buckets, Fix A SI-5: no silent drops). The 5 RAW axis inputs
// {gpa, fcfMargin, opMargin, growth, netIssuance} — the SAME axis set as it_services — are extracted from
// snapshots/<T>.json annual.* (flow fields are {value}-WRAPPED → num() dual-shape; annualBalance.*/annualShares are
// raw numbers), attached as ONE techhw-only field `thw` -> all other candidate JSON byte-identical. The de-ADR country
// guard + size + dedupe already ran in the classifier; NO contamination gate (the absolute floor in court-score.js
// sinks the commodity contract-mfg / loss tail off-headline, and the SI-4 SHELL gate excludes the revenue-less shells).
const thwCohortByTicker = new Map(); // ticker -> 'tech_hardware_quality'
const TECHHW_COHORTS = new Set(['tech_hardware_quality']);
// saas/fabless (generic-path growth-scored buckets): the universal revenue-artifact guard runs on the LATEST
// annual YoY (their growth axis = generic gAnnual). To let the guard drop+fall-back, persist the annual YoY
// SERIES on saas/semi members ONLY (additive → no field on any other bucket; parity-safe).
const saasSemiTickers = new Set(); // ticker -> system_app_software | fabless_semi member
const SAASSEMI_COHORTS = new Set(['system_app_software', 'fabless_semi']);
try {
  const bd = JSON.parse(fs.readFileSync(BUCK, 'utf8'));
  const cls = Array.isArray(bd) ? bd : (bd.classifications || []);
  for (const c of cls) {
    if (c && c.bucket === 'diagnostics_lst' && c.t) dlstTickers.add(c.t);
    if (c && SAASSEMI_COHORTS.has(c.bucket) && c.t) saasSemiTickers.add(c.t);
    if (c && (c.bucket === 'industrials_heavy' || c.bucket === 'industrials_light') && c.t) indCohortByTicker.set(c.t, c.bucket);
    if (c && (c.bucket === 'staples_branded' || c.bucket === 'staples_distribution') && c.t) stpCohortByTicker.set(c.t, c.bucket);
    if (c && (c.bucket === 'consdisc_store' || c.bucket === 'consdisc_light') && c.t) cdCohortByTicker.set(c.t, c.bucket);
    if (c && (c.bucket === 'materials_pricingpower' || c.bucket === 'materials_commodity') && c.t) mtCohortByTicker.set(c.t, c.bucket);
    if (c && ENERGY_COHORTS.has(c.bucket) && c.t) enCohortByTicker.set(c.t, c.bucket);
    if (c && PHARMA_COHORTS.has(c.bucket) && c.t) phCohortByTicker.set(c.t, c.bucket);
    if (c && ITSERVICES_COHORTS.has(c.bucket) && c.t) itCohortByTicker.set(c.t, c.bucket);
    if (c && BANKS_COHORTS.has(c.bucket) && c.t) bkCohortByTicker.set(c.t, c.bucket);
    if (c && REITS_COHORTS.has(c.bucket) && c.t) reCohortByTicker.set(c.t, c.bucket);
    if (c && CAPMKT_COHORTS.has(c.bucket) && c.t) cmCohortByTicker.set(c.t, c.bucket);
    if (c && TECHHW_COHORTS.has(c.bucket) && c.t) thwCohortByTicker.set(c.t, c.bucket);
  }
} catch {}

// --- D&LST FISCAL-YEAR ALIGNMENT (Fix A) ---
// Die cache annualRev (continuing-ops) trägt KEINE Perioden-End-Daten. Der dlst-Snapshot
// (data/ma-rpo-snapshot-dlst.json) trägt revenueHistory[{val,end}] (TOTAL-ops) MIT FY-End-Datum.
// Wir derivieren das Fiskaljahr jeder cache-annualRev[i] per WERT-MATCH gegen revenueHistory:
// wo continuing-ops == total-ops (die jüngsten Jahre vor Divestituren) matcht der Wert exakt und
// liefert das FY; wo die Reihen divergieren (Spin/Divestitur-Jahre) gibt es KEINEN Match → FY=null
// (unalignbar). So kann die Deal-Jahr-Exklusion in court-score.js FISKALJAHR-genau statt
// index-positional matchen (Fix A). DLST-only; additiv → Parität SaaS/Fabless/Medtech bleibt.
const dlstRevHistByTicker = new Map(); // ticker -> [{val, year}] newest-first (aus dlst-Snapshot)
try {
  const dlstSnap = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'ma-rpo-snapshot-dlst.json'), 'utf8'));
  for (const [t, rec] of Object.entries(dlstSnap)) {
    if (t === '_header' || !rec || !Array.isArray(rec.revenueHistory)) continue;
    const rh = rec.revenueHistory
      .map(e => (e && e.val != null && e.end) ? { val: Number(e.val), year: Number(String(e.end).slice(0, 4)) } : null)
      .filter(e => e && isFinite(e.val) && isFinite(e.year));
    if (rh.length) dlstRevHistByTicker.set(t, rh);
  }
} catch {}
// fiscalYearsForRev(revA, ticker): pro cache-annualRev-Wert das FY per Wert-Match (exakt) gegen den
// Snapshot. Kein Match → null (Reihe an dem Index unalignbar). Toleranz 0 (Werte sind identische SEC-
// Zahlen wo continuing==total). Bei mehrdeutigem Match (gleicher Wert in zwei Jahren) → erstes (neuestes).
//
// audit/fix (gauntlet E4): EXACT equality is INTENTIONAL and load-bearing — do NOT "fix" it with a
// relative tolerance. Empirically (all 29 dlst names): a ±0.1% tol FALSE-MATCHES adjacent flat years —
// TMO 2023 (42,857M) and 2024 (42,879M) differ by only 0.05%, so a tolerant rh.find() (first-hit wins)
// would mislabel 2023 as 2024 (verified). The inbox's "$1M restatement fragility" (TMO 2025: cache
// 44,557M vs snap 44,556M → FY=null) is BENIGN: that null is absorbed by the dealExclusionUnaligned
// lamp in court-score.js and moves NO score/fixture (the year has no >=15% goodwill jump). Restatement
// nulls are benign; false year-labels are not. Court (E4) verdict: NOT-WARRANTED, keep exact-match.
function fiscalYearsForRev(revVals, ticker) {
  const rh = dlstRevHistByTicker.get(ticker);
  if (!Array.isArray(rh) || !Array.isArray(revVals)) return revVals.map(() => null);
  return revVals.map(v => {
    if (v == null || !isFinite(v)) return null;
    const hit = rh.find(e => e.val === v);
    return hit ? hit.year : null;
  });
}

// ===========================================================================
// UNIVERSAL revenue-artifact guard (re-court defense-in-depth) — SHARED across all growth-scored buckets.
// ===========================================================================
// A single-year revenue MULTIPLE that is physically implausible for a $1B+ company (revenue jumps to >4x in
// ONE year, i.e. revG >= +300%) is — REGARDLESS OF SECTOR — almost certainly a SCALE / UNITS / CURRENCY /
// restatement DATA artifact, not organic or M&A growth. No $1B+ company organically (nor via typical M&A)
// quadruples revenue in a single year. This is the SECTOR-NEUTRAL companion to the staples §4.1b asset-backed
// guard: the asset-backing heuristic does NOT generalize (a non-asset-backed jump is LEGITIMATE in materials/
// energy commodity spikes, asset-light pharma drug launches, it_services/saas asset-light hypergrowth), but an
// IMPLAUSIBLE MULTIPLE is a universal red flag. EMPIRICAL CALIBRATION (2026-06-24, all 585 US >=$1B growth-
// scored names): the highest LEGITIMATE single-year jump is ALAB +242% (3.42x, genuine AI-infra hypergrowth);
// the lowest scale ARTIFACT is ONDS +638% (7.38x, $7M->51M near-zero base). The CLEAN GAP [3.42x .. 7.38x] is
// empty — a 4.0x threshold (revG>=3.00) sits dead-center, catching 4 near-zero-base artifacts (TE 256.7x,
// ASTS 16.1x, ASPI 9.6x, ONDS 7.4x — all already bottom-of-bucket junk) while SPARING every legitimate grower
// (ALAB 3.42x, AMPX 3.02x, NVDA 2.26x, CRDO 2.26x, COKE 3.19x...). COKE's 3.19x scale artifact is BELOW this
// universal threshold BY DESIGN — it is caught by the COMPLEMENTARY staples asset-backed guard (revG>=1.0 AND
// not asset-backed), which catches the lower-multiple non-asset-backed staples case the universal guard misses.
// ADVISORY + GROWTH-AXIS-ONLY: a YoY exceeding the threshold is DROPPED from the growth blend (the remaining
// clean years are used; if none remain -> NOT_READY:growth like a fully-masked name) + a SUSPECT_REVENUE_MULTIPLE
// lamp is raised. The name is NEVER excluded; no other axis is touched.
const SUSPECT_REV_MULT = { revG: 3.00 };                       // universal: single-year revG >= +300% (>4x) = scale/units/currency/restatement artifact
function suspectRevMultiple(revG, threshold) {
  const t = (threshold == null) ? SUSPECT_REV_MULT.revG : threshold;
  return revG != null && isFinite(revG) && revG >= t;
}

// ===========================================================================
// UNIVERSAL currency-mix guard (INFY-class snapshot corruption) — SHARED across all annual-block buckets.
// ===========================================================================
// A snapshot is CURRENCY-CORRUPT when a SUBSET of its annual fields is reported in a foreign (much larger)
// currency while the rest are in the meta.reportingCurrency — i.e. the ratio axes whose numerator and
// denominator land in DIFFERENT currencies become garbage (a USD/INR margin collapses to ~1/FX ≈ 1%, a
// foreign-currency numerator over a USD denominator explodes to ~FX×ratio). The canonical case (court QA,
// it_services): INFY (Infosys ADR) carries meta.reportingCurrency='USD' but annualRev (~1.79 TRILLION) and
// annualNetIncome (~294B) are in INR (~88.6× USD) while annualOpInc/annualGP/annualFCF/annualBalance/marketCap
// are USD. This makes opMargin=annualOpInc/annualRev (USD/INR) and fcfMargin=annualFCF/annualRev (USD/INR)
// physically impossible (~0.2%) and drags the it_services REL cohort medians ~1.3pp on fcfMargin/opMargin.
//
// THE SIGNAL (currency-agnostic, ticker-free, NO reportingCurrency dependence — a wrong meta tag is exactly the
// corruption): a HARD STRUCTURAL-ORDERING VIOLATION between two same-block fields at FX scale in the SCORED
// (latest, index-0) year. Net income can NEVER exceed gross profit (NI = GP − opex − …, opex ≥ 0); operating
// income can NEVER exceed gross profit (OpInc = GP − SG&A − …). So annualNetIncome[0]/annualGP[0] (or
// annualOpInc[0]/annualGP[0]) > a modest bound is structurally impossible — UNLESS the numerator and
// denominator are in different currencies. EMPIRICAL CALIBRATION (2026-06-24, all 1237 classified US names
// with an annual block, scored-year [0] only): the highest LEGITIMATE NI/GP is RYN 3.02 / GFL 2.80 / XP 2.50
// (partial/depreciation-inclusive gross-profit accounting in lessors/REITs/foreign-brokers); INFY sits at
// 48.4 (= FX 88.6 × real net/gross 0.547). The CLEAN GAP [3.02 .. 48.4] is empty — a 10× threshold sits
// dead-center (3.3× slack above the legit max, 4.8× slack below INFY). Checking ONLY the scored year [0] is
// deliberate and load-bearing: the court computes every margin from index [0], the REL anchor pool is built
// from index-[0] margins, and an isolated bad HISTORICAL-year value (e.g. BAM's year-3 annualGP=37M stale
// point, NI/GP=51.8 there but 0.77 at [0]) is NEVER scored and must NOT trip the guard (verified: a whole-
// series scan false-positives BAM; a scored-year scan isolates INFY uniquely).
const CURRENCY_MIX = { niOverGp: 10, opOverGp: 10 };           // structural-impossibility FX-scale thresholds (scored year [0])
// currencyMixSuspect(gp0, op0, ni0): latest-year annual GROSS PROFIT, OPERATING INCOME, NET INCOME (numbers or
// null). Returns { suspect, arm, ratio } — suspect=true iff a same-block ordering violation at FX scale fires.
function currencyMixSuspect(gp0, op0, ni0) {
  if (gp0 == null || !isFinite(gp0) || gp0 <= 0) return { suspect: false };
  if (ni0 != null && isFinite(ni0) && ni0 > 0 && ni0 / gp0 >= CURRENCY_MIX.niOverGp) return { suspect: true, arm: 'NI_GG_GP', ratio: ni0 / gp0 };
  if (op0 != null && isFinite(op0) && op0 > 0 && op0 / gp0 >= CURRENCY_MIX.opOverGp) return { suspect: true, arm: 'OP_GG_GP', ratio: op0 / gp0 };
  return { suspect: false };
}

// ===========================================================================
// industrials_compounder (CORE) — 5-axis RAW extraction from snapshots (Spec §2-§4)
// ===========================================================================
// ADDITIV/parity-safe: only fires for tickers in indCohortByTicker (court-buckets industrials_{heavy,light}).
// Reads snapshots/<T>.json `annual.*` (NEWEST-FIRST) — the canonical pool the deterministic classifier and
// the re-frozen cohort NORMS were calibrated on. Uses the dual-shape num() extractor (object-wrapped {value}
// for annualRev/GP/OpInc/FCF + nested annualBalance[].totalAssets; raw numbers for annualShares).
//
// Frozen constants (Spec §6.5):
const IND_DEAL_MASK = { assetJump: 0.25, revJump: 0.15 };       // §4.1 BOTH required; sign-aware (positive only)
const IND_SPINOFF = { dropYoY: -0.25, baseFrac: 0.85 };        // §4.3 big drop + positive latest + base<85% of peak
const IND_GROWTH_BLEND = { wLatest: 0.60, wFloor: 0.40 };      // §4.2 uncapped latest + multi-year floor
const IND_EFF_MIX = { wOp: 0.60, wFcf: 0.40 };                 // §3 Axis C op-weighted (lumpy FCF)

// §4.3 spin-off / divestiture re-baselining guard (EXACT JS from spec). Operates on annualRev newest-first.
// Fires -> Axis A routed to NOT_READY:growth UPSTREAM (a permanent-level-shift rebound is never scored as organic).
function spinoffRebaselineGuard(revNewestFirst) {
  const r = revNewestFirst.filter(v => v != null && isFinite(v) && v > 0);
  if (r.length < 3) return false;
  const chron = r.slice().reverse();                       // oldest -> newest
  const yoy = [];
  for (let i = 1; i < chron.length; i++) yoy.push((chron[i] - chron[i - 1]) / Math.abs(chron[i - 1]));
  const hasBigDrop = yoy.some(y => y <= IND_SPINOFF.dropYoY);   // (1) large negative level-shift in window
  const latestYoY = (r[0] - r[1]) / Math.abs(r[1]);            // newest YoY
  const latestPositive = latestYoY > 0;                        // (2) a rebound...
  const stillBelowBase = r[0] < IND_SPINOFF.baseFrac * Math.max(...r); // (3) ...off a permanently shrunken base
  return hasBigDrop && latestPositive && stillBelowBase;       // fire -> NOT_READY:growth
}

// snapshot annual cache for industrials tickers only (avoid re-reading + keep the parity path untouched).
const indSnapAnnual = new Map(); // ticker -> snapshot.annual object
if (indCohortByTicker.size && fs.existsSync(SNAP_DIR)) {
  for (const t of indCohortByTicker.keys()) {
    try {
      const sn = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, t + '.json'), 'utf8'));
      if (sn && sn.annual) indSnapAnnual.set(t, sn.annual);
    } catch {}
  }
}

// buildIndustrialsAxes(ticker, cohort) -> the 5 RAW axis inputs + lamps/audit, or null if no snapshot.
// gpa = annualGP[0]/totalAssets[0]; growthInput = 0.60*latest_clean_YoY + 0.40*min(recentYoYs) with the
// §4.1 deal-mask + §4.3 spin-off guard applied UPSTREAM (-> growth=null + NOT_READY:growth when fired);
// assetGrowth = latest TA delta; netShareIssuance = latest annualShares YoY (<2 non-null -> null +
// ISSUANCE_NOT_READY for drop+renorm); eff = 0.60*opMargin + 0.40*fcfMargin (fcf null -> opMargin only).
function buildIndustrialsAxes(ticker, cohort) {
  const a = indSnapAnnual.get(ticker);
  if (!a) return null;
  const revA = (a.annualRev || []).map(num);                  // NEWEST-FIRST, object-wrapped {value}
  const gpA = (a.annualGP || []).map(num);
  const opA = (a.annualOpInc || []).map(num);
  const fcfA = (a.annualFCF || []).map(num);
  const bal = Array.isArray(a.annualBalance) ? a.annualBalance : [];
  const taA = bal.map(b => (b && b.totalAssets != null && isFinite(b.totalAssets)) ? b.totalAssets : null);
  // annualShares: RAW number array, Vintage-B only. <2 non-null -> Axis E DROP + ISSUANCE_NOT_READY.
  const sharesAll = Array.isArray(a.annualShares) ? a.annualShares.map(num) : [];
  const niA = (a.annualNetIncome || []).map(num);
  const lamps = [];

  // --- UNIVERSAL currency-mix guard (INFY-class): scored-year [0] same-block ordering violation at FX scale ---
  const ccMix = currencyMixSuspect(gpA[0], opA[0], niA[0]);
  const currencySuspect = ccMix.suspect;
  if (currencySuspect) lamps.push('CURRENCY_SUSPECT');           // withheld + dropped from REL anchor DOWNSTREAM (court-score.js)

  // --- Axis B: GP/assets ---
  let gpa = null;
  if (gpA[0] != null && taA[0] != null && taA[0] > 0) gpa = gpA[0] / taA[0];
  else lamps.push('NOT_READY:gpa');

  // --- Axis D: asset-growth (real latest delta; never masked) ---
  let assetGrowth = null;
  if (taA[0] != null && taA[1] != null && taA[1] !== 0) assetGrowth = (taA[0] - taA[1]) / taA[1];
  else lamps.push('NOT_READY:assetgrowth');

  // --- Axis E: net-share-issuance (latest YoY; <2 non-null -> DROP + renorm) ---
  let netShareIssuance = null;
  const sharesNN = sharesAll.filter(v => v != null && isFinite(v));
  if (sharesNN.length >= 2) {
    // first 2 non-null, latest-first
    let s0 = null, s1 = null;
    for (const v of sharesAll) { if (v != null && isFinite(v)) { if (s0 == null) s0 = v; else { s1 = v; break; } } }
    if (s0 != null && s1 != null && s1 !== 0) netShareIssuance = (s0 - s1) / s1;
    else { netShareIssuance = null; lamps.push('ISSUANCE_NOT_READY'); }
  } else {
    lamps.push('ISSUANCE_NOT_READY');                         // Vintage-A: no annualShares field
  }

  // --- Axis C: efficiency = 0.60*opMargin + 0.40*fcfMargin (fcf null -> opMargin only; coverage-norm) ---
  let eff = null;
  const rev0 = revA[0];
  if (rev0 != null && rev0 > 0) {
    const opMargin = (opA[0] != null) ? opA[0] / rev0 : null;
    const fcfMargin = (fcfA[0] != null) ? fcfA[0] / rev0 : null;
    if (opMargin != null && fcfMargin != null) eff = IND_EFF_MIX.wOp * opMargin + IND_EFF_MIX.wFcf * fcfMargin;
    else if (opMargin != null) eff = opMargin;
    else if (fcfMargin != null) eff = fcfMargin;
  }
  if (eff == null) lamps.push('NOT_READY:eff');

  // --- Axis A: organic growth (deal-mask §4.1 + spin-off guard §4.3 UPSTREAM, cyclicality blend-floor §4.2) ---
  // YoY series newest-first: revA[i]/revA[i+1]-1; deal-mask a year iff assetGrowth_t>=0.25 AND revGrowth_t>=0.15.
  let growthInput = null;
  let dealMasked = false, spinoffRebase = false, staleGrowth = false, revArtifactMult = false;
  if (spinoffRebaselineGuard(revA)) {
    spinoffRebase = true;
    lamps.push('SPINOFF_REBASE');
    lamps.push('NOT_READY:growth');                          // route Axis A drop+renorm upstream
  } else {
    // clean (non-deal-masked) YoY list newest-first; mask year t (positive jumps only, sign-aware).
    const cleanYoY = [];
    for (let i = 0; i < revA.length - 1; i++) {
      const rNew = revA[i], rOld = revA[i + 1];
      if (rNew == null || rOld == null || rOld <= 0) continue;
      const revG = rNew / rOld - 1;
      // asset jump for the SAME fiscal year t (taA[i] vs taA[i+1]); positive-only conjunction.
      const taNew = taA[i], taOld = taA[i + 1];
      const assetG = (taNew != null && taOld != null && taOld > 0) ? (taNew - taOld) / taOld : null;
      // UNIVERSAL revenue-artifact guard FIRST: an implausible single-year multiple (>4x) is a scale/units/
      // currency artifact even when assets coincidentally grew (a SPAC cash-raise inflates assets the same year),
      // so it is checked BEFORE the deal-mask — no $1B+ company quadruples revenue via M&A in one year either.
      if (suspectRevMultiple(revG)) { revArtifactMult = true; continue; }
      const masked = (assetG != null && assetG >= IND_DEAL_MASK.assetJump && revG >= IND_DEAL_MASK.revJump);
      if (masked) { dealMasked = true; continue; }
      cleanYoY.push(revG);
    }
    if (revArtifactMult) lamps.push('SUSPECT_REVENUE_MULTIPLE');
    if (cleanYoY.length === 0) {
      // no clean YoY -> DROP Axis A + renorm
      lamps.push('NOT_READY:growth');
    } else {
      if (dealMasked && cleanYoY.length >= 1) {
        // latest clean YoY is older than the (masked) freshest year -> STALE:growth
        // (the freshest non-masked YoY is not index 0); flag only if a mask actually displaced the latest.
        // The latest annual YoY (revA[0]/revA[1]-1) being masked is the trigger.
        const rNew0 = revA[0], rOld0 = revA[1];
        const taNew0 = taA[0], taOld0 = taA[1];
        if (rNew0 != null && rOld0 != null && rOld0 > 0 && taNew0 != null && taOld0 != null && taOld0 > 0) {
          const revG0 = rNew0 / rOld0 - 1, assetG0 = (taNew0 - taOld0) / taOld0;
          if (assetG0 >= IND_DEAL_MASK.assetJump && revG0 >= IND_DEAL_MASK.revJump) staleGrowth = true;
        }
      }
      if (cleanYoY.length === 1) {
        // only 1 clean YoY -> fall back to that single YoY (ABS-honest)
        growthInput = cleanYoY[0];
      } else {
        // blend = 0.60*latest clean YoY + 0.40*min(recent clean YoYs)
        growthInput = IND_GROWTH_BLEND.wLatest * cleanYoY[0] + IND_GROWTH_BLEND.wFloor * Math.min(...cleanYoY);
      }
      if (staleGrowth) lamps.push('STALE:growth');
    }
  }
  if (dealMasked) lamps.push('DEAL_MASKED');

  // advisory capital-discipline lamps (Spec §5)
  if (netShareIssuance != null && (-netShareIssuance) >= 0.03) lamps.push('DILUTION_HIGH'); // issuance >= 3%
  if (rev0 != null && rev0 > 0) {
    const opM = (opA[0] != null) ? opA[0] / rev0 : null;
    const fcfM = (fcfA[0] != null) ? fcfA[0] / rev0 : null;
    if (opM != null && opM < 0 && fcfM != null && fcfM < 0) lamps.push('MARGIN_NEGATIVE');
  }

  return {
    cohort,
    gpa: round(gpa), growth: round(growthInput), assetGrowth: round(assetGrowth),
    netShareIssuance: round(netShareIssuance), eff: round(eff),
    dealMasked, spinoffRebase, staleGrowth, revArtifactMult,
    ...(currencySuspect ? { currencySuspect: true, currencySuspectArm: ccMix.arm, currencySuspectRatio: round(ccMix.ratio) } : {}), // additive ONLY when fired -> clean records byte-identical (parity)
    nAnnualRev: revA.filter(v => v != null).length,
    sharesCoverage: sharesNN.length,
    lamps,
  };
}

// ===========================================================================
// consumer_staples_compounder (CORE) — 5-axis RAW extraction from snapshots (Spec §2-§4)
// ===========================================================================
// ADDITIV/parity-safe: only fires for tickers in stpCohortByTicker (court-buckets staples_{branded,distribution}).
// Reads snapshots/<T>.json `annual.*` (NEWEST-FIRST) — the canonical pool the deterministic classifier and the
// re-frozen cohort NORMS were calibrated on. Same dual-shape num() extractor as industrials.
//
// Frozen constants (Spec §6.5):
const STP_DEAL_MASK = { assetJump: 0.25, revJump: 0.15 };       // §4.1 BOTH required; sign-aware (positive only)
// §4.1b revenue-discontinuity DATA-ARTIFACT guard (re-court MAJOR fix): a single-year revenue MULTIPLE that is
// physically implausible for a mature staple (revenue MORE THAN DOUBLES in one year, revG>=1.00) WITHOUT any
// asset backing (assetG below the deal-mask assetJump → not an acquisition/buildout) is a scale/units data
// artifact, NOT organic growth. The §4.1 deal-mask cannot catch it (it requires assetG>=0.25 too), so a corrupt
// revenue series (e.g. COKE annualRev mixing scales → fake +218% YoY while total assets FELL) would otherwise top
// the cohort = "junk tops the bucket". Such a YoY is DROPPED from the clean set (treated like a masked year) +
// SUSPECT_REVENUE lamp. Genuine asset-backed hyper-growers (CELH +101.7% with assetG +0.257) are SPARED because
// they are asset-backed; sub-double organic growers (ELF/BRBR/MNST/PRMB max revG<0.30) never approach the multiple.
const STP_REV_ARTIFACT = { revMult: 1.00 };                    // §4.1b revG>=1.00 (>2x in one year) AND not asset-backed = artifact
const STP_SPINOFF = { dropYoY: -0.25, baseFrac: 0.85 };        // §4.2 big drop + positive latest + base<85% of peak
const STP_GROWTH_BLEND = { wLatest: 0.60, wMedian: 0.40 };     // §3 Axis A: 0.60*latest + 0.40*MEDIAN(recent clean YoYs)
const STP_EFF_MIX = { wOp: 0.60, wFcf: 0.40 };                 // §3 Axis C op-weighted (WC-cycle/impairment distort FCF)
const STP_SBC_HIGH = { branded: 0.08, distribution: 0.04 };    // §3/§5 SBC_HIGH advisory lamp threshold (sbcRatio)

// §4.2 spin-off / divestiture re-baselining guard (EXACT JS from spec). Operates on annualRev newest-first.
// Fires -> Axis A routed to NOT_READY:growth UPSTREAM (a permanent-level-shift rebound is never scored as organic).
function spinoffRebaselineGuardStaples(revNewestFirst) {
  const r = revNewestFirst.filter(v => v != null && isFinite(v) && v > 0);
  if (r.length < 3) return false;
  const chron = r.slice().reverse();                       // oldest -> newest
  const yoy = [];
  for (let i = 1; i < chron.length; i++) yoy.push((chron[i] - chron[i - 1]) / Math.abs(chron[i - 1]));
  const hasBigDrop = yoy.some(y => y <= STP_SPINOFF.dropYoY);   // (1) large negative level-shift in window
  const latestYoY = (r[0] - r[1]) / Math.abs(r[1]);            // newest YoY
  const latestPositive = latestYoY > 0;                        // (2) a rebound...
  const stillBelowBase = r[0] < STP_SPINOFF.baseFrac * Math.max(...r); // (3) ...off a permanently shrunken base
  return hasBigDrop && latestPositive && stillBelowBase;       // fire -> NOT_READY:growth
}

// median over a finite-value list (newest-first irrelevant for median).
function _medFinite(xs) {
  const s = xs.filter(v => v != null && isFinite(v)).slice().sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// snapshot annual cache for staples tickers only (avoid re-reading + keep the parity path untouched).
const stpSnapAnnual = new Map(); // ticker -> snapshot.annual object
if (stpCohortByTicker.size && fs.existsSync(SNAP_DIR)) {
  for (const t of stpCohortByTicker.keys()) {
    try {
      const sn = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, t + '.json'), 'utf8'));
      if (sn && sn.annual) stpSnapAnnual.set(t, sn.annual);
    } catch {}
  }
}

// buildStaplesAxes(ticker, cohort) -> the 5 RAW axis inputs + lamps/audit, or null if no snapshot.
// MIRRORS buildIndustrialsAxes with the staples deltas: growthInput blend uses MEDIAN(recent clean YoYs)
// (not min); netIssuance floor is tighter (Axis E §3); SBC_HIGH advisory lamp via sbcRatio; DILUTION_HIGH
// at >=5% (§5). gpa = annualGP[0]/totalAssets[0]; assetGrowth = latest TA delta; netShareIssuance = latest
// annualShares YoY (<2 non-null -> null + ISSUANCE_NOT_READY for drop+renorm); eff = 0.60*opM + 0.40*fcfM.
function buildStaplesAxes(ticker, cohort) {
  const a = stpSnapAnnual.get(ticker);
  if (!a) return null;
  const revA = (a.annualRev || []).map(num);                  // NEWEST-FIRST, object-wrapped {value}
  const gpA = (a.annualGP || []).map(num);
  const opA = (a.annualOpInc || []).map(num);
  const fcfA = (a.annualFCF || []).map(num);
  const bal = Array.isArray(a.annualBalance) ? a.annualBalance : [];
  const taA = bal.map(b => (b && b.totalAssets != null && isFinite(b.totalAssets)) ? b.totalAssets : null);
  // annualShares: RAW number array, Vintage-B only. <2 non-null -> Axis E DROP + ISSUANCE_NOT_READY.
  const sharesAll = Array.isArray(a.annualShares) ? a.annualShares.map(num) : [];
  const sbcAll = Array.isArray(a.annualSBC) ? a.annualSBC.map(num) : []; // BONUS dilution tell (NOT scored)
  const niA = (a.annualNetIncome || []).map(num);
  const lamps = [];

  // --- UNIVERSAL currency-mix guard (INFY-class): scored-year [0] same-block ordering violation at FX scale ---
  const ccMix = currencyMixSuspect(gpA[0], opA[0], niA[0]);
  const currencySuspect = ccMix.suspect;
  if (currencySuspect) lamps.push('CURRENCY_SUSPECT');           // withheld + dropped from REL anchor DOWNSTREAM (court-score.js)

  // --- Axis B: GP/assets ---
  let gpa = null;
  if (gpA[0] != null && taA[0] != null && taA[0] > 0) gpa = gpA[0] / taA[0];
  else lamps.push('NOT_READY:gpa');

  // --- Axis D: asset-growth (real latest delta; never masked) ---
  let assetGrowth = null;
  if (taA[0] != null && taA[1] != null && taA[1] !== 0) assetGrowth = (taA[0] - taA[1]) / taA[1];
  else lamps.push('NOT_READY:assetgrowth');

  // --- Axis E: net-share-issuance (latest YoY; <2 non-null -> DROP + renorm) ---
  let netShareIssuance = null;
  const sharesNN = sharesAll.filter(v => v != null && isFinite(v));
  if (sharesNN.length >= 2) {
    let s0 = null, s1 = null;
    for (const v of sharesAll) { if (v != null && isFinite(v)) { if (s0 == null) s0 = v; else { s1 = v; break; } } }
    if (s0 != null && s1 != null && s1 !== 0) netShareIssuance = (s0 - s1) / s1;
    else { netShareIssuance = null; lamps.push('ISSUANCE_NOT_READY'); }
  } else {
    lamps.push('ISSUANCE_NOT_READY');                         // Vintage-A: no annualShares field
  }

  // --- Axis C: efficiency = 0.60*opMargin + 0.40*fcfMargin (fcf null -> opMargin only; coverage-norm) ---
  let eff = null;
  const rev0 = revA[0];
  if (rev0 != null && rev0 > 0) {
    const opMargin = (opA[0] != null) ? opA[0] / rev0 : null;
    const fcfMargin = (fcfA[0] != null) ? fcfA[0] / rev0 : null;
    if (opMargin != null && fcfMargin != null) eff = STP_EFF_MIX.wOp * opMargin + STP_EFF_MIX.wFcf * fcfMargin;
    else if (opMargin != null) eff = opMargin;
    else if (fcfMargin != null) eff = fcfMargin;
  }
  if (eff == null) lamps.push('NOT_READY:eff');

  // --- Axis A: organic growth (deal-mask §4.1 + rev-artifact guard §4.1b + spin-off guard §4.2 UPSTREAM, MEDIAN blend §3) ---
  let growthInput = null;
  let dealMasked = false, spinoffRebase = false, staleGrowth = false, revArtifact = false, revArtifactMult = false;
  if (spinoffRebaselineGuardStaples(revA)) {
    spinoffRebase = true;
    lamps.push('SPINOFF_REBASE');
    lamps.push('NOT_READY:growth');                          // route Axis A drop+renorm upstream
  } else {
    const cleanYoY = [];
    for (let i = 0; i < revA.length - 1; i++) {
      const rNew = revA[i], rOld = revA[i + 1];
      if (rNew == null || rOld == null || rOld <= 0) continue;
      const revG = rNew / rOld - 1;
      const taNew = taA[i], taOld = taA[i + 1];
      const assetG = (taNew != null && taOld != null && taOld > 0) ? (taNew - taOld) / taOld : null;
      // UNIVERSAL revenue-artifact guard: an implausible single-year multiple (>4x) is a scale/units/currency
      // artifact regardless of asset-backing — checked BEFORE the deal-mask so even an apparently-asset-backed
      // 4x jump is dropped (no $1B+ company quadruples revenue organically or via typical M&A in one year).
      if (suspectRevMultiple(revG)) { revArtifactMult = true; continue; }
      const masked = (assetG != null && assetG >= STP_DEAL_MASK.assetJump && revG >= STP_DEAL_MASK.revJump);
      if (masked) { dealMasked = true; continue; }
      // §4.1b revenue-discontinuity DATA-ARTIFACT: revenue MORE THAN DOUBLES in one year (revG>=1.00) but the
      // jump is NOT asset-backed (assetG missing or below the deal-mask assetJump) → implausible scale/units
      // artifact, drop the YoY (acquisitions are already caught by `masked` above; this catches the corrupt-data
      // case the deal-mask misses because assets did NOT rise). COMPLEMENTARY to the universal guard above: this
      // catches the LOWER-multiple non-asset-backed staples case (COKE 3.19x, assets fell) the universal misses.
      const artifact = (revG >= STP_REV_ARTIFACT.revMult && !(assetG != null && assetG >= STP_DEAL_MASK.assetJump));
      if (artifact) { revArtifact = true; continue; }
      cleanYoY.push(revG);
    }
    if (revArtifactMult) lamps.push('SUSPECT_REVENUE_MULTIPLE'); // universal: implausible >4x single-year multiple dropped
    if (revArtifact) lamps.push('SUSPECT_REVENUE');          // §4.1b advisory: an implausible non-asset-backed rev jump was dropped
    if (cleanYoY.length === 0) {
      lamps.push('NOT_READY:growth');                        // no clean YoY -> DROP Axis A + renorm
    } else {
      if (dealMasked && cleanYoY.length >= 1) {
        const rNew0 = revA[0], rOld0 = revA[1];
        const taNew0 = taA[0], taOld0 = taA[1];
        if (rNew0 != null && rOld0 != null && rOld0 > 0 && taNew0 != null && taOld0 != null && taOld0 > 0) {
          const revG0 = rNew0 / rOld0 - 1, assetG0 = (taNew0 - taOld0) / taOld0;
          if (assetG0 >= STP_DEAL_MASK.assetJump && revG0 >= STP_DEAL_MASK.revJump) staleGrowth = true;
        }
      }
      if (cleanYoY.length === 1) {
        growthInput = cleanYoY[0];                            // only 1 clean YoY -> single YoY (ABS-honest)
      } else {
        // blend = 0.60*latest clean YoY + 0.40*MEDIAN(recent clean YoYs) (staples §3: median damps spike/trough)
        growthInput = STP_GROWTH_BLEND.wLatest * cleanYoY[0] + STP_GROWTH_BLEND.wMedian * _medFinite(cleanYoY);
      }
      if (staleGrowth) lamps.push('STALE:growth');
    }
  }
  if (dealMasked) lamps.push('DEAL_MASKED');

  // advisory capital-discipline lamps (Spec §5)
  if (netShareIssuance != null && (-netShareIssuance) >= 0.05) lamps.push('DILUTION_HIGH'); // issuance >= 5% (staples mature)
  if (rev0 != null && rev0 > 0) {
    const opM = (opA[0] != null) ? opA[0] / rev0 : null;
    const fcfM = (fcfA[0] != null) ? fcfA[0] / rev0 : null;
    if (opM != null && opM < 0 && fcfM != null && fcfM < 0) lamps.push('MARGIN_NEGATIVE');
    // SBC_HIGH advisory dilution tell (BONUS, NOT scored) where annualSBC is present.
    const sbc0 = sbcAll.find(v => v != null && isFinite(v));
    const sbcThresh = STP_SBC_HIGH[cohort === 'staples_distribution' ? 'distribution' : 'branded'];
    if (sbc0 != null && (sbc0 / rev0) > sbcThresh) lamps.push('SBC_HIGH');
  }
  // IMPAIRMENT_BLIND advisory (§4.3/§5): large negative net-income YoY coincident with revenue/asset decline.
  if (niA[0] != null && niA[1] != null && niA[1] !== 0 && (niA[0] - niA[1]) / Math.abs(niA[1]) <= -0.25) {
    const revDown = (revA[0] != null && revA[1] != null && revA[1] > 0) ? (revA[0] / revA[1] - 1) < 0 : false;
    const taDown = (taA[0] != null && taA[1] != null && taA[1] > 0) ? (taA[0] / taA[1] - 1) < 0 : false;
    if (revDown || taDown) lamps.push('IMPAIRMENT_BLIND');
  }

  return {
    cohort,
    gpa: round(gpa), growth: round(growthInput), assetGrowth: round(assetGrowth),
    netShareIssuance: round(netShareIssuance), eff: round(eff),
    dealMasked, spinoffRebase, staleGrowth, revArtifact, revArtifactMult,
    ...(currencySuspect ? { currencySuspect: true, currencySuspectArm: ccMix.arm, currencySuspectRatio: round(ccMix.ratio) } : {}), // additive ONLY when fired -> clean records byte-identical (parity)
    nAnnualRev: revA.filter(v => v != null).length,
    sharesCoverage: sharesNN.length,
    lamps,
  };
}

// ===========================================================================
// consdisc_expansion (CORE) — 4-axis RAW extraction + shareCAGR from snapshots (Spec §2-§4)
// ===========================================================================
// ADDITIV/parity-safe: only fires for tickers in cdCohortByTicker (court-buckets consdisc_{store,light}).
// Reads snapshots/<T>.json `annual.*` (NEWEST-FIRST) — the canonical pool the deterministic classifier and the
// re-frozen cohort NORMS were calibrated on. Same dual-shape num() extractor as industrials/staples.
//
// DISTINCT from industrials/staples: FOUR scored axes (gpa/growth/assetGrowth/eff) — net-share-issuance is
// NOT a 5th axis; instead share dilution is a SEPARATE shareCAGR (geometric, up to 3 clean years) fed to the
// POST-SUM dilution haircut in absKaliberConsDisc. growth blend = 0.70*latest_clean_YoY + 0.30*revCAGR_2y
// (cyclicality damper, §3-A/§4.2). eff = 0.60*fcfMargin + 0.40*opMargin (FCF-weighted, Mohanram, §3-C).
// deal-mask revJump 0.20 (vs industrials/staples 0.15). NO spin-off guard (the spec has none for consdisc).
//
// Frozen constants (Spec §6.2):
const CD_DEAL_MASK = { assetJump: 0.25, revJump: 0.20 };       // §4.1 BOTH required; sign-aware (positive only)
const CD_GROWTH_BLEND = { wYoY: 0.70, wCagr2y: 0.30 };         // §3-A/§4.2 0.70*latest clean YoY + 0.30*2y CAGR
const CD_EFF_MIX = { wFcf: 0.60, wOp: 0.40 };                  // §3-C Axis C FCF-weighted (Mohanram cash primacy)
const CD_DILUTION = { cap: 0.06, maxHaircut: 0.10, lampAt: 0.03 }; // §3 dilution post-multiplier + DILUTION_HIGH lamp

// snapshot annual cache for consdisc tickers only (avoid re-reading + keep the parity path untouched).
const cdSnapAnnual = new Map(); // ticker -> snapshot.annual object
if (cdCohortByTicker.size && fs.existsSync(SNAP_DIR)) {
  for (const t of cdCohortByTicker.keys()) {
    try {
      const sn = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, t + '.json'), 'utf8'));
      if (sn && sn.annual) cdSnapAnnual.set(t, sn.annual);
    } catch {}
  }
}

// buildConsdiscAxes(ticker, cohort) -> the 4 RAW axis inputs + shareCAGR + lamps/audit, or null if no snapshot.
// gpa = annualGP[0]/totalAssets[0]; growthInput = 0.70*latest_clean_YoY + 0.30*revCAGR_2y with the §4.1
// deal-mask applied UPSTREAM (mask year t iff assetGrowth_t>=0.25 AND revGrowth_t>=0.20; step back to prior
// clean YoY; no clean YoY -> growth=null + NOT_READY:growth); assetGrowth = latest TA delta (never masked);
// eff = 0.60*fcfMargin + 0.40*opMargin (fcf null -> opMargin only, coverage-norm); shareCAGR = geometric
// annualShares CAGR over up to 3 clean years (<2 non-null -> null, no haircut, ISSUANCE_NOT_READY lamp).
function buildConsdiscAxes(ticker, cohort) {
  const a = cdSnapAnnual.get(ticker);
  if (!a) return null;
  const revA = (a.annualRev || []).map(num);                  // NEWEST-FIRST, object-wrapped {value}
  const gpA = (a.annualGP || []).map(num);
  const opA = (a.annualOpInc || []).map(num);
  const fcfA = (a.annualFCF || []).map(num);
  const bal = Array.isArray(a.annualBalance) ? a.annualBalance : [];
  const taA = bal.map(b => (b && b.totalAssets != null && isFinite(b.totalAssets)) ? b.totalAssets : null);
  // annualShares: RAW number array, Vintage-B only. <2 non-null -> no dilution signal + ISSUANCE_NOT_READY.
  const sharesAll = Array.isArray(a.annualShares) ? a.annualShares.map(num) : [];
  const niA = (a.annualNetIncome || []).map(num);
  const lamps = [];

  // --- UNIVERSAL currency-mix guard (INFY-class): scored-year [0] same-block ordering violation at FX scale ---
  const ccMix = currencyMixSuspect(gpA[0], opA[0], niA[0]);
  const currencySuspect = ccMix.suspect;
  if (currencySuspect) lamps.push('CURRENCY_SUSPECT');           // withheld + dropped from REL anchor DOWNSTREAM (court-score.js)

  // --- Axis B: GP/assets ---
  let gpa = null;
  if (gpA[0] != null && taA[0] != null && taA[0] > 0) gpa = gpA[0] / taA[0];
  else lamps.push('NOT_READY:gpa');

  // --- Axis D: asset-growth (real latest delta; never masked) ---
  let assetGrowth = null;
  if (taA[0] != null && taA[1] != null && taA[1] !== 0) assetGrowth = (taA[0] - taA[1]) / taA[1];
  else lamps.push('NOT_READY:assetgrowth');

  // --- Dilution: shareCAGR = (shares[0]/shares[k])^(1/k) - 1 over up to 3 clean years (NOT a scored axis) ---
  let shareCAGR = null;
  const sharesNN = sharesAll.filter(v => v != null && isFinite(v) && v > 0);
  if (sharesNN.length >= 2) {
    const k = Math.min(3, sharesNN.length - 1);               // up to 3y horizon
    const s0 = sharesNN[0], sk = sharesNN[k];
    if (s0 > 0 && sk > 0) shareCAGR = Math.pow(s0 / sk, 1 / k) - 1;
  } else {
    lamps.push('ISSUANCE_NOT_READY');                         // Vintage-A: no annualShares field (no haircut, neutral)
  }

  // --- Axis C: efficiency = 0.60*fcfMargin + 0.40*opMargin (fcf null -> opMargin only; coverage-norm) ---
  let eff = null;
  const rev0 = revA[0];
  if (rev0 != null && rev0 > 0) {
    const opMargin = (opA[0] != null) ? opA[0] / rev0 : null;
    const fcfMargin = (fcfA[0] != null) ? fcfA[0] / rev0 : null;
    if (opMargin != null && fcfMargin != null) eff = CD_EFF_MIX.wFcf * fcfMargin + CD_EFF_MIX.wOp * opMargin;
    else if (fcfMargin != null) eff = fcfMargin;
    else if (opMargin != null) eff = opMargin;
  }
  if (eff == null) lamps.push('NOT_READY:eff');

  // --- Axis A: organic growth (deal-mask §4.1 UPSTREAM, cyclicality blend §3-A/§4.2) ---
  // YoY series newest-first: revA[i]/revA[i+1]-1; deal-mask year t iff assetGrowth_t>=0.25 AND revGrowth_t>=0.20.
  let growthInput = null;
  let dealMasked = false, staleGrowth = false, revArtifactMult = false;
  const cleanYoY = [];
  for (let i = 0; i < revA.length - 1; i++) {
    const rNew = revA[i], rOld = revA[i + 1];
    if (rNew == null || rOld == null || rOld <= 0) continue;
    const revG = rNew / rOld - 1;
    const taNew = taA[i], taOld = taA[i + 1];
    const assetG = (taNew != null && taOld != null && taOld > 0) ? (taNew - taOld) / taOld : null;
    // UNIVERSAL revenue-artifact guard FIRST (before the deal-mask): an implausible single-year multiple (>4x) is
    // a scale/units/currency corruption even when assets coincidentally grew, and not a one-year acquisition.
    if (suspectRevMultiple(revG)) { revArtifactMult = true; continue; }
    const masked = (assetG != null && assetG >= CD_DEAL_MASK.assetJump && revG >= CD_DEAL_MASK.revJump);
    if (masked) { dealMasked = true; continue; }
    cleanYoY.push(revG);
  }
  if (revArtifactMult) lamps.push('SUSPECT_REVENUE_MULTIPLE');
  if (cleanYoY.length === 0) {
    lamps.push('NOT_READY:growth');                           // no clean YoY -> DROP Axis A + renorm
  } else {
    // STALE:growth if the latest annual year (revA[0]) was itself deal-masked (organic read is aged).
    if (dealMasked) {
      const rNew0 = revA[0], rOld0 = revA[1];
      const taNew0 = taA[0], taOld0 = taA[1];
      if (rNew0 != null && rOld0 != null && rOld0 > 0 && taNew0 != null && taOld0 != null && taOld0 > 0) {
        const revG0 = rNew0 / rOld0 - 1, assetG0 = (taNew0 - taOld0) / taOld0;
        if (assetG0 >= CD_DEAL_MASK.assetJump && revG0 >= CD_DEAL_MASK.revJump) staleGrowth = true;
      }
    }
    // revCAGR_2y from the clean revenue series (2y geometric); fall back to single clean YoY if <3 clean revs.
    // When the universal artifact guard fired, the raw rev levels span a corrupt jump → skip CAGR (would re-import
    // the artifact via cleanRev[0]/cleanRev[2]) and use the single latest clean YoY instead.
    const cleanRev = revA.filter(v => v != null && isFinite(v) && v > 0); // newest-first
    let cagr2y = null;
    if (!revArtifactMult && cleanRev.length >= 3 && cleanRev[2] > 0) cagr2y = Math.pow(cleanRev[0] / cleanRev[2], 1 / 2) - 1;
    const latestClean = cleanYoY[0];
    if (cagr2y != null) growthInput = CD_GROWTH_BLEND.wYoY * latestClean + CD_GROWTH_BLEND.wCagr2y * cagr2y;
    else growthInput = latestClean;                           // <3 clean revs OR artifact -> single clean YoY (ABS-honest)
    if (staleGrowth) lamps.push('STALE:growth');
  }
  if (dealMasked) lamps.push('DEAL_MASKED');

  // advisory capital-discipline lamps (Spec §5)
  if (shareCAGR != null && shareCAGR >= CD_DILUTION.lampAt) lamps.push('DILUTION_HIGH'); // net issuance >= 3%
  if (rev0 != null && rev0 > 0) {
    const opM = (opA[0] != null) ? opA[0] / rev0 : null;
    const fcfM = (fcfA[0] != null) ? fcfA[0] / rev0 : null;
    if (opM != null && opM < 0 && fcfM != null && fcfM < 0) lamps.push('MARGIN_NEGATIVE');
  }

  return {
    cohort,
    gpa: round(gpa), growth: round(growthInput), assetGrowth: round(assetGrowth),
    eff: round(eff), shareCAGR: round(shareCAGR),
    dealMasked, staleGrowth, revArtifactMult,
    ...(currencySuspect ? { currencySuspect: true, currencySuspectArm: ccMix.arm, currencySuspectRatio: round(ccMix.ratio) } : {}), // additive ONLY when fired -> clean records byte-identical (parity)
    nAnnualRev: revA.filter(v => v != null).length,
    sharesCoverage: sharesNN.length,
    lamps,
  };
}

// ===========================================================================
// materials_quality (CORE) — 5-axis RAW extraction from snapshots (Spec §2-§4)
// ===========================================================================
// ADDITIV/parity-safe: only fires for tickers in mtCohortByTicker (court-buckets materials_{pricingpower,commodity}).
// Reads snapshots/<T>.json `annual.*` (NEWEST-FIRST) — the canonical pool the deterministic classifier and the
// re-frozen cohort NORMS were calibrated on. Same dual-shape num() extractor as industrials/staples/consdisc.
//
// DISTINCT from industrials/staples: axis C is MARGINSTABILITY (inverse-CV pricing-power proxy, identity-clip
// {0,1}) instead of eff — it measures realized op-margin DISPERSION, the M&A-agnostic third decontamination
// layer (§4-3). NO spot op/net-margin is scored as a pillar (a gold 41% op-margin peak windfall must NOT read
// as quality). growth blend = 0.50*latest_clean_YoY + 0.50*min(recent clean YoYs) (heavy 50/50 floor: a
// Materials revenue spike is price not volume; the min-term damps it — §3-A). deal-mask revJump 0.15.
//
// Frozen constants (Spec §3/§4/§6):
const MT_DEAL_MASK = { assetJump: 0.25, revJump: 0.15 };       // §4.1 BOTH required; sign-aware (positive only)
const MT_SPINOFF = { dropYoY: -0.25, baseFrac: 0.85 };        // §4.2 spin-off + super-cycle re-baselining guard
const MT_GROWTH_BLEND = { wLatest: 0.50, wFloor: 0.50 };       // §3-A 0.50*latest + 0.50*min(recent clean YoYs)
const MT_MS_MEAN_FLOOR = 0.02;                                 // §2-C inverse-CV mean-floor (trough divide-by-near-zero guard)
const MT_MS_MIN_POINTS = 3;                                    // §2-C need >=3 non-null annual opMargin points

// §4.2 spin-off / divestiture / SUPER-CYCLE re-baselining guard (EXACT JS, mirrors industrials/staples).
// Fires -> Axis A routed to NOT_READY:growth UPSTREAM (a price-windfall-then-normalize rebound off a deflated
// base is never scored as organic growth — basic-chem 2021 super-cycle deflators, lithium spikes, gold spikes).
function spinoffRebaselineGuardMaterials(revNewestFirst) {
  const r = revNewestFirst.filter(v => v != null && isFinite(v) && v > 0);
  if (r.length < 3) return false;
  const chron = r.slice().reverse();                       // oldest -> newest
  const yoy = [];
  for (let i = 1; i < chron.length; i++) yoy.push((chron[i] - chron[i - 1]) / Math.abs(chron[i - 1]));
  const hasBigDrop = yoy.some(y => y <= MT_SPINOFF.dropYoY);    // (1) large negative level-shift in window
  const latestYoY = (r[0] - r[1]) / Math.abs(r[1]);            // newest YoY
  const latestPositive = latestYoY > 0;                        // (2) a rebound...
  const stillBelowBase = r[0] < MT_SPINOFF.baseFrac * Math.max(...r); // (3) ...off a permanently shrunken base
  return hasBigDrop && latestPositive && stillBelowBase;       // fire -> NOT_READY:growth
}

// stdev (population) over a finite-value list.
function _stdevFinite(xs) {
  const a = xs.filter(v => v != null && isFinite(v));
  if (a.length < 2) return null;
  const mean = a.reduce((s, v) => s + v, 0) / a.length;
  const va = a.reduce((s, v) => s + (v - mean) * (v - mean), 0) / a.length;
  return Math.sqrt(va);
}

// snapshot annual cache for materials tickers only (avoid re-reading + keep the parity path untouched).
const mtSnapAnnual = new Map(); // ticker -> snapshot.annual object
if (mtCohortByTicker.size && fs.existsSync(SNAP_DIR)) {
  for (const t of mtCohortByTicker.keys()) {
    try {
      const sn = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, t + '.json'), 'utf8'));
      if (sn && sn.annual) mtSnapAnnual.set(t, sn.annual);
    } catch {}
  }
}

// buildMaterialsAxes(ticker, cohort) -> the 5 RAW axis inputs + lamps/audit, or null if no snapshot.
// gpa = annualGP[0]/totalAssets[0]; marginStability = clip01(1 − stdev(opMargin_t)/max(|mean(opMargin_t)|,0.02))
// over >=3 non-null annual opMargin points (<3 -> null + NOT_READY:marginstability); growthInput =
// 0.50*latest_clean_YoY + 0.50*min(recent clean YoYs) with the §4.1 deal-mask + §4.2 spin-off/super-cycle
// guard applied UPSTREAM (-> growth=null + NOT_READY:growth when fired); assetGrowth = latest TA delta (never
// masked); netShareIssuance = latest annualShares YoY (<2 non-null -> null + ISSUANCE_NOT_READY for drop+renorm).
function buildMaterialsAxes(ticker, cohort) {
  const a = mtSnapAnnual.get(ticker);
  if (!a) return null;
  const revA = (a.annualRev || []).map(num);                  // NEWEST-FIRST, object-wrapped {value}
  const gpA = (a.annualGP || []).map(num);
  const opA = (a.annualOpInc || []).map(num);
  const bal = Array.isArray(a.annualBalance) ? a.annualBalance : [];
  const taA = bal.map(b => (b && b.totalAssets != null && isFinite(b.totalAssets)) ? b.totalAssets : null);
  // annualShares: RAW number array, Vintage-B only. <2 non-null -> Axis E DROP + ISSUANCE_NOT_READY.
  const sharesAll = Array.isArray(a.annualShares) ? a.annualShares.map(num) : [];
  const niA = (a.annualNetIncome || []).map(num);
  const lamps = [];

  // --- UNIVERSAL currency-mix guard (INFY-class): scored-year [0] same-block ordering violation at FX scale ---
  const ccMix = currencyMixSuspect(gpA[0], opA[0], niA[0]);
  const currencySuspect = ccMix.suspect;
  if (currencySuspect) lamps.push('CURRENCY_SUSPECT');           // withheld + dropped from REL anchor DOWNSTREAM (court-score.js)

  // --- Axis B: GP/assets ---
  let gpa = null;
  if (gpA[0] != null && taA[0] != null && taA[0] > 0) gpa = gpA[0] / taA[0];
  else lamps.push('NOT_READY:gpa');

  // --- Axis C: margin stability = clip01(1 − stdev(opMargin)/max(|mean(opMargin)|, 0.02)) over >=3 points ---
  // The pricing-power proxy: realized op-margin dispersion (inverse coefficient-of-variation). NEVER imputed;
  // <3 non-null opMargin points -> NOT_READY:marginstability (drop+renorm). The 0.02 mean-floor prevents a
  // trough divide-by-near-zero blow-up. Identity-clip anchor {0,1} (the axis already emits 0–1).
  let marginStability = null;
  const opMargins = [];
  for (let i = 0; i < revA.length; i++) {
    if (revA[i] != null && revA[i] > 0 && opA[i] != null && isFinite(opA[i])) opMargins.push(opA[i] / revA[i]);
  }
  if (opMargins.length >= MT_MS_MIN_POINTS) {
    const sd = _stdevFinite(opMargins);
    const mean = opMargins.reduce((s, v) => s + v, 0) / opMargins.length;
    if (sd != null) {
      const raw = 1 - sd / Math.max(Math.abs(mean), MT_MS_MEAN_FLOOR);
      marginStability = Math.max(0, Math.min(1, raw));
    }
  }
  if (marginStability == null) lamps.push('NOT_READY:marginstability');

  // --- Axis D: asset-growth (real latest delta; never masked) ---
  let assetGrowth = null;
  if (taA[0] != null && taA[1] != null && taA[1] !== 0) assetGrowth = (taA[0] - taA[1]) / taA[1];
  else lamps.push('NOT_READY:assetgrowth');

  // --- Axis E: net-share-issuance (latest YoY; <2 non-null -> DROP + renorm) ---
  let netShareIssuance = null;
  const sharesNN = sharesAll.filter(v => v != null && isFinite(v));
  if (sharesNN.length >= 2) {
    let s0 = null, s1 = null;
    for (const v of sharesAll) { if (v != null && isFinite(v)) { if (s0 == null) s0 = v; else { s1 = v; break; } } }
    if (s0 != null && s1 != null && s1 !== 0) netShareIssuance = (s0 - s1) / s1;
    else { netShareIssuance = null; lamps.push('ISSUANCE_NOT_READY'); }
  } else {
    lamps.push('ISSUANCE_NOT_READY');                         // Vintage-A: no annualShares field
  }

  // --- Axis A: organic growth (deal-mask §4.1 + spin-off/super-cycle guard §4.2 UPSTREAM, 50/50 min-floor §3-A) ---
  let growthInput = null;
  let dealMasked = false, spinoffRebase = false, staleGrowth = false, revArtifactMult = false;
  if (spinoffRebaselineGuardMaterials(revA)) {
    spinoffRebase = true;
    lamps.push('SPINOFF_REBASE');
    lamps.push('NOT_READY:growth');                          // route Axis A drop+renorm upstream
  } else {
    const cleanYoY = [];
    for (let i = 0; i < revA.length - 1; i++) {
      const rNew = revA[i], rOld = revA[i + 1];
      if (rNew == null || rOld == null || rOld <= 0) continue;
      const revG = rNew / rOld - 1;
      const taNew = taA[i], taOld = taA[i + 1];
      const assetG = (taNew != null && taOld != null && taOld > 0) ? (taNew - taOld) / taOld : null;
      // UNIVERSAL revenue-artifact guard FIRST (before the deal-mask): an implausible single-year multiple (>4x)
      // is a scale/units/currency corruption even when assets coincidentally grew — a commodity PRICE spike is
      // legitimate and sub-4x; a >4x jump is not a price move and not a real one-year acquisition.
      if (suspectRevMultiple(revG)) { revArtifactMult = true; continue; }
      const masked = (assetG != null && assetG >= MT_DEAL_MASK.assetJump && revG >= MT_DEAL_MASK.revJump);
      if (masked) { dealMasked = true; continue; }
      cleanYoY.push(revG);
    }
    if (revArtifactMult) lamps.push('SUSPECT_REVENUE_MULTIPLE');
    if (cleanYoY.length === 0) {
      lamps.push('NOT_READY:growth');                        // no clean YoY -> DROP Axis A + renorm
    } else {
      if (dealMasked && cleanYoY.length >= 1) {
        const rNew0 = revA[0], rOld0 = revA[1];
        const taNew0 = taA[0], taOld0 = taA[1];
        if (rNew0 != null && rOld0 != null && rOld0 > 0 && taNew0 != null && taOld0 != null && taOld0 > 0) {
          const revG0 = rNew0 / rOld0 - 1, assetG0 = (taNew0 - taOld0) / taOld0;
          if (assetG0 >= MT_DEAL_MASK.assetJump && revG0 >= MT_DEAL_MASK.revJump) staleGrowth = true;
        }
      }
      if (cleanYoY.length === 1) {
        growthInput = cleanYoY[0];                            // only 1 clean YoY -> single YoY (ABS-honest)
      } else {
        // blend = 0.50*latest clean YoY + 0.50*min(recent clean YoYs) (materials §3-A: price-spike damper)
        growthInput = MT_GROWTH_BLEND.wLatest * cleanYoY[0] + MT_GROWTH_BLEND.wFloor * Math.min(...cleanYoY);
      }
      if (staleGrowth) lamps.push('STALE:growth');
    }
  }
  if (dealMasked) lamps.push('DEAL_MASKED');

  // advisory capital-discipline lamps (Spec §5)
  if (netShareIssuance != null && (-netShareIssuance) >= 0.03) lamps.push('DILUTION_HIGH'); // issuance >= 3%
  const rev0 = revA[0];
  if (rev0 != null && rev0 > 0) {
    const opM = (opA[0] != null) ? opA[0] / rev0 : null;
    if (opM != null && opM < 0) lamps.push('MARGIN_NEGATIVE');
  }

  // audit/fix (re-court materials_quality DENIAL, Spec §1/§5): expose the pre-revenue facts so court-score.js
  // can SI-4-exclude pre-revenue exploration/shell names (OUT_OF_SEGMENT:preexploration) — `revLatest` = latest
  // non-null annual revenue (newest-first), `nAnnualRev` = non-null annual revenue points. A revenue-less shell
  // (EMAT annualRev=[]) or a near-zero micro (LWLG $236k) must NOT be scored (the gpa/marginStability axes are
  // undefined/explosive on near-zero revenue); the gate lives in court-score.js so the name lands in excluded[].
  const revLatest = revA.find(v => v != null && isFinite(v));
  return {
    cohort,
    gpa: round(gpa), marginStability: round(marginStability), growth: round(growthInput),
    assetGrowth: round(assetGrowth), netShareIssuance: round(netShareIssuance),
    dealMasked, spinoffRebase, staleGrowth, revArtifactMult,
    ...(currencySuspect ? { currencySuspect: true, currencySuspectArm: ccMix.arm, currencySuspectRatio: round(ccMix.ratio) } : {}), // additive ONLY when fired -> clean records byte-identical (parity)
    revLatest: (revLatest == null ? null : round(revLatest)),
    nAnnualRev: revA.filter(v => v != null).length,
    nOpMargin: opMargins.length,
    sharesCoverage: sharesNN.length,
    lamps,
  };
}

// ===========================================================================
// energy_quality (CORE) — 5-axis RAW extraction from snapshots (Spec §2-§5)
// ===========================================================================
// ADDITIV/parity-safe: only fires for tickers in enCohortByTicker (court-buckets energy_{upstream,midstream,services}).
// Reads snapshots/<T>.json `annual.*` (NEWEST-FIRST) — the canonical pool the deterministic classifier and the
// re-frozen cohort NORMS were calibrated on. Same dual-shape num() extractor as materials.
//
// DISTINCT from every other CORE bucket: axis B is ROCE (opInc/totalAssets, the through-cycle capital-return
// pillar) and axis C is FCF-MARGIN (annualFCF/annualRev, the discipline arm that survives Vintage A) — neither is
// industrials `eff` nor materials `marginStability`. GROWTH IS NOT A SCORED AXIS (a commodity-cyclical never earns
// a positive growth credit — QUALITY-ONLY). The deal-mask + spin-off guard + the COMMODITY-WINDFALL guard
// (COMMODITY_BETA_SUSPECT: revYoY>+25% AND assetGrowth<+10% => revenue jumped without the asset base growing =
// price not volume) fire as advisory lamps ONLY (never a score-kill) — the score is commodity-β-immune BY
// CONSTRUCTION (asset-scaled profitability + no growth axis), so the windfall guard is a transparency flag.
//
// Frozen constants (Spec §3/§5):
const EN_DEAL_MASK = { assetJump: 0.25, revJump: 0.15 };       // §3.1 deal-mask trigger (growth NOT scored; mask feeds lamps/context)
const EN_SPINOFF = { dropYoY: -0.25, baseFrac: 0.85 };         // §3.4 spin-off/divestiture re-baselining guard
const EN_WINDFALL = { revYoY: 0.25, assetG: 0.10 };            // §3.5 COMMODITY_BETA_SUSPECT: rev jumped without asset base

// §3.4 spin-off / divestiture re-baselining guard (EXACT JS, mirrors materials). Low-stakes here (growth not
// scored) but protects the deal/cyclicality context-read from a post-divestiture rebound misread.
function spinoffRebaselineGuardEnergy(revNewestFirst) {
  const r = revNewestFirst.filter(v => v != null && isFinite(v) && v > 0);
  if (r.length < 3) return false;
  const chron = r.slice().reverse();                       // oldest -> newest
  const yoy = [];
  for (let i = 1; i < chron.length; i++) yoy.push((chron[i] - chron[i - 1]) / Math.abs(chron[i - 1]));
  const hasBigDrop = yoy.some(y => y <= EN_SPINOFF.dropYoY);
  const latestYoY = (r[0] - r[1]) / Math.abs(r[1]);
  const latestPositive = latestYoY > 0;
  const stillBelowBase = r[0] < EN_SPINOFF.baseFrac * Math.max(...r);
  return hasBigDrop && latestPositive && stillBelowBase;
}

// snapshot annual cache for energy tickers only (avoid re-reading + keep the parity path untouched).
const enSnapAnnual = new Map(); // ticker -> snapshot.annual object
if (enCohortByTicker.size && fs.existsSync(SNAP_DIR)) {
  for (const t of enCohortByTicker.keys()) {
    try {
      const sn = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, t + '.json'), 'utf8'));
      if (sn && sn.annual) enSnapAnnual.set(t, sn.annual);
    } catch {}
  }
}

// buildEnergyAxes(ticker, cohort) -> the 5 RAW axis inputs + lamps/audit, or null if no snapshot.
// roce = annualOpInc[0]/totalAssets[0]; fcfMargin = annualFCF[0]/annualRev[0]; gpa = annualGP[0]/totalAssets[0];
// assetGrowth = latest TA delta (NEVER masked — the discipline penalty SHOULD fire on the cycle-top reserve-grab);
// netShareIssuance = latest annualShares YoY (<2 non-null -> null + ISSUANCE_NOT_READY for drop+renorm). GROWTH is
// NOT a scored axis (only the deal-mask trigger + COMMODITY_BETA_SUSPECT windfall lamp read the revenue series).
function buildEnergyAxes(ticker, cohort) {
  const a = enSnapAnnual.get(ticker);
  if (!a) return null;
  const revA = (a.annualRev || []).map(num);                  // NEWEST-FIRST, object-wrapped {value}
  const gpA = (a.annualGP || []).map(num);
  const opA = (a.annualOpInc || []).map(num);
  const fcfA = (a.annualFCF || []).map(num);
  const bal = Array.isArray(a.annualBalance) ? a.annualBalance : [];
  const taA = bal.map(b => (b && b.totalAssets != null && isFinite(b.totalAssets)) ? b.totalAssets : null);
  const sharesAll = Array.isArray(a.annualShares) ? a.annualShares.map(num) : [];
  const niA = (a.annualNetIncome || []).map(num);
  const lamps = [];

  // --- UNIVERSAL currency-mix guard (INFY-class): scored-year [0] same-block ordering violation at FX scale ---
  const ccMix = currencyMixSuspect(gpA[0], opA[0], niA[0]);
  const currencySuspect = ccMix.suspect;
  if (currencySuspect) lamps.push('CURRENCY_SUSPECT');           // withheld + dropped from REL anchor DOWNSTREAM (court-score.js)

  // --- Axis B: ROCE surrogate = opInc/totalAssets (the through-cycle capital-return pillar) ---
  let roce = null;
  if (opA[0] != null && taA[0] != null && taA[0] > 0) roce = opA[0] / taA[0];
  else lamps.push('NOT_READY:roce');

  // --- Axis C: FCF margin = annualFCF/annualRev (capital discipline; FULL-coverage arm) ---
  let fcfMargin = null;
  if (fcfA[0] != null && revA[0] != null && revA[0] > 0) fcfMargin = fcfA[0] / revA[0];
  else lamps.push('NOT_READY:fcfmargin');

  // --- Axis B2: GP/assets (Novy-Marx profitability) ---
  let gpa = null;
  if (gpA[0] != null && taA[0] != null && taA[0] > 0) gpa = gpA[0] / taA[0];
  else lamps.push('NOT_READY:gpa');

  // --- Axis D: asset-growth (real latest delta; NEVER masked — fires on the cycle-top reserve-grab) ---
  let assetGrowth = null;
  if (taA[0] != null && taA[1] != null && taA[1] !== 0) assetGrowth = (taA[0] - taA[1]) / taA[1];
  else lamps.push('NOT_READY:assetgrowth');

  // --- Axis E: net-share-issuance (latest YoY; <2 non-null -> DROP + renorm; equity-funded reserve grabs punished) ---
  let netShareIssuance = null;
  const sharesNN = sharesAll.filter(v => v != null && isFinite(v));
  if (sharesNN.length >= 2) {
    let s0 = null, s1 = null;
    for (const v of sharesAll) { if (v != null && isFinite(v)) { if (s0 == null) s0 = v; else { s1 = v; break; } } }
    if (s0 != null && s1 != null && s1 !== 0) netShareIssuance = (s0 - s1) / s1;
    else { netShareIssuance = null; lamps.push('ISSUANCE_NOT_READY'); }
  } else {
    lamps.push('ISSUANCE_NOT_READY');                         // Vintage-A: no annualShares field (~50% of the pool)
  }

  // --- deal-mask + spin-off guard + COMMODITY_BETA_SUSPECT (advisory only; growth NOT scored) ---
  let dealMasked = false, spinoffRebase = false;
  // latest revenue YoY (for the deal-mask trigger + the windfall lamp — NOT a scored growth credit)
  let latestRevYoY = null;
  if (revA[0] != null && revA[1] != null && revA[1] > 0) latestRevYoY = revA[0] / revA[1] - 1;
  if (spinoffRebaselineGuardEnergy(revA)) { spinoffRebase = true; lamps.push('SPINOFF_REBASE'); }
  if (latestRevYoY != null && assetGrowth != null
    && latestRevYoY >= EN_DEAL_MASK.revJump && assetGrowth >= EN_DEAL_MASK.assetJump) {
    dealMasked = true; lamps.push('DEAL_MASKED');             // §3.1 acquirer ballooning the asset base at the cycle top
  }
  // §3.5 COMMODITY_BETA_SUSPECT: revenue jumped >+25% WITHOUT the asset base growing (<+10%) = price, not volume.
  // Advisory FLAG only (the score is commodity-β-immune by construction) — surfaces the price-windfall year.
  if (latestRevYoY != null && assetGrowth != null
    && latestRevYoY > EN_WINDFALL.revYoY && assetGrowth < EN_WINDFALL.assetG) {
    lamps.push('COMMODITY_BETA_SUSPECT');
  }

  // advisory capital-discipline lamps (Spec §4)
  if (netShareIssuance != null && (-netShareIssuance) >= 0.03) lamps.push('DILUTION_HIGH'); // issuance >= 3%
  const rev0 = revA[0];
  if (rev0 != null && rev0 > 0) {
    const opM = (opA[0] != null) ? opA[0] / rev0 : null;
    const fcfM = (fcfA[0] != null) ? fcfA[0] / rev0 : null;
    if (opM != null && opM < 0 && fcfM != null && fcfM < 0) lamps.push('MARGIN_NEGATIVE'); // op & fcf both <0 = trough burn
  }

  // pre-revenue facts for the court-score.js SI-4 exclusion (the materials lesson — a revenue-less pre-exploration
  // shell must NOT be scored: the roce/fcfMargin/gpa axes are undefined/explosive on near-zero revenue and the
  // coverage-renorm would wrongly concentrate the absK on the surviving discipline axes and let the shell top the
  // cohort). `revLatest` = latest non-null annual revenue; `nAnnualRev` = non-null annual revenue points.
  const revLatest = revA.find(v => v != null && isFinite(v));
  return {
    cohort,
    roce: round(roce), fcfMargin: round(fcfMargin), gpa: round(gpa),
    assetGrowth: round(assetGrowth), netShareIssuance: round(netShareIssuance),
    dealMasked, spinoffRebase, latestRevYoY: round(latestRevYoY),
    ...(currencySuspect ? { currencySuspect: true, currencySuspectArm: ccMix.arm, currencySuspectRatio: round(ccMix.ratio) } : {}), // additive ONLY when fired -> clean records byte-identical (parity)
    revLatest: (revLatest == null ? null : round(revLatest)),
    nAnnualRev: revA.filter(v => v != null).length,
    sharesCoverage: sharesNN.length,
    lamps,
  };
}

// ===========================================================================
// pharma_commercial (CORE) — 3-axis RAW extraction from snapshots (Spec §2-§5)
// ===========================================================================
// ADDITIV/parity-safe: only fires for tickers in phCohortByTicker (court-buckets pharma_{branded,biopharma,
// specialty}). Reads snapshots/<T>.json `annual.*` (NEWEST-FIRST) — the canonical pool the deterministic
// classifier and the re-frozen cohort NORMS were calibrated on. Same dual-shape num() extractor as materials/energy.
//
// 3 SCORED axes {growth, gm, eff} — the SAME axis set as the medtech/dlst absKaliber() path, but with the materials/
// energy coverage-renorm engine (absKaliberPharma) and these pharma-specific reads:
//   growth = deal-masked organic blend min(latest clean YoY, 0.6*latest + 0.4*median(clean)), WINSORIZED at cap 1.0
//            (a near-zero-base launch-spike — ARWR $3.5M->$829M = +13954% — clipped at +100%); fully-masked
//            serial-acquirer (CPRX, every YoY a deal year) -> null -> NOT_READY:growth (axis DROP+renorm).
//   gm     = annualGP[0]/annualRev[0] (pricing-power); a no-GP royalty name (RPRX/ARWR annualGP=[null,null]) ->
//            null -> axis DROP (coverage-renorm, NOT 0-imputed).
//   eff    = annualFCF[0]/annualRev[0] PRIMARY, OpM fallback when FCF null OR >15pp below OpM (R&D fully-expensed
//            distorts OpM; branded structurally FCF-rich).
// M&A: the design re-points M&A onto INTANGIBLES/IPR&D, but the LOCAL snapshot annualBalance carries ONLY
// {totalCash,totalDebt,totalAssets} (NO intangibles/goodwill/IPR&D) and data/ma-rpo-snapshot-pharma.json is ABSENT.
// So pharma decontaminates growth with the SAME LOCAL totalAssets-jump deal-mask as industrials/materials/energy
// (sign-aware). The intangible-amortization-drag/ipr&d lamps (which need the absent external join) are OMITTED and
// disclosed (court-score MA_INTANGIBLE_BLIND wall). Net-share-issuance not scored (Vintage-A lacks annualShares) ->
// DILUTION_HIGH advisory lamp only where computable.
//
// Frozen constants (Spec §3/§4):
const PH_DEAL_MASK = { assetJump: 0.25, revJump: 0.15 };       // §4.1 LOCAL M&A proxy; BOTH required; sign-aware (positive only)
const PH_SPINOFF = { dropYoY: -0.25, baseFrac: 0.85 };         // §4 spin-off/divestiture re-baselining guard
const PH_GROWTH_BLEND = { wLatest: 0.60, wTrend: 0.40 };       // §3-A min(latest, 0.6*latest + 0.4*median clean YoY)
const PH_GROWTH_CAP = 1.0;                                     // §3 winsorize a near-zero-base launch-spike at +100%
const PH_EFF_FALLBACK_GAP = 0.15;                              // FCF-primary -> OpM fallback when FCF >15pp below OpM

// §4 spin-off / divestiture re-baselining guard (EXACT JS, mirrors materials/energy).
function spinoffRebaselineGuardPharma(revNewestFirst) {
  const r = revNewestFirst.filter(v => v != null && isFinite(v) && v > 0);
  if (r.length < 3) return false;
  const chron = r.slice().reverse();                       // oldest -> newest
  const yoy = [];
  for (let i = 1; i < chron.length; i++) yoy.push((chron[i] - chron[i - 1]) / Math.abs(chron[i - 1]));
  const hasBigDrop = yoy.some(y => y <= PH_SPINOFF.dropYoY);
  const latestYoY = (r[0] - r[1]) / Math.abs(r[1]);
  const latestPositive = latestYoY > 0;
  const stillBelowBase = r[0] < PH_SPINOFF.baseFrac * Math.max(...r);
  return hasBigDrop && latestPositive && stillBelowBase;
}

// snapshot annual cache for pharma tickers only (avoid re-reading + keep the parity path untouched).
const phSnapAnnual = new Map(); // ticker -> snapshot.annual object
if (phCohortByTicker.size && fs.existsSync(SNAP_DIR)) {
  for (const t of phCohortByTicker.keys()) {
    try {
      const sn = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, t + '.json'), 'utf8'));
      if (sn && sn.annual) phSnapAnnual.set(t, sn.annual);
    } catch {}
  }
}

// buildPharmaAxes(ticker, cohort) -> the 3 RAW axis inputs + lamps/audit, or null if no snapshot.
function buildPharmaAxes(ticker, cohort) {
  const a = phSnapAnnual.get(ticker);
  if (!a) return null;
  const revA = (a.annualRev || []).map(num);                  // NEWEST-FIRST, object-wrapped {value}
  const gpA = (a.annualGP || []).map(num);
  const opA = (a.annualOpInc || []).map(num);
  const fcfA = (a.annualFCF || []).map(num);
  const bal = Array.isArray(a.annualBalance) ? a.annualBalance : [];
  const taA = bal.map(b => (b && b.totalAssets != null && isFinite(b.totalAssets)) ? b.totalAssets : null);
  const niA = (a.annualNetIncome || []).map(num);
  const lamps = [];

  // --- UNIVERSAL currency-mix guard (INFY-class): scored-year [0] same-block ordering violation at FX scale ---
  const ccMix = currencyMixSuspect(gpA[0], opA[0], niA[0]);
  const currencySuspect = ccMix.suspect;
  if (currencySuspect) lamps.push('CURRENCY_SUSPECT');           // withheld + dropped from REL anchor DOWNSTREAM (court-score.js)

  // --- Axis B: gross margin = annualGP[0]/annualRev[0] (null on a no-GP royalty name -> DROP+renorm) ---
  let gm = null;
  if (gpA[0] != null && revA[0] != null && revA[0] > 0) gm = gpA[0] / revA[0];
  else lamps.push('NOT_READY:gm');

  // --- Axis C: efficiency = FCF-margin PRIMARY, OpM fallback (FCF null OR >15pp below OpM) ---
  let eff = null;
  const fcfM = (fcfA[0] != null && revA[0] != null && revA[0] > 0) ? fcfA[0] / revA[0] : null;
  const opM = (opA[0] != null && revA[0] != null && revA[0] > 0) ? opA[0] / revA[0] : null;
  if (fcfM != null && !(opM != null && fcfM < opM - PH_EFF_FALLBACK_GAP)) eff = fcfM;
  else if (opM != null) eff = opM;
  else if (fcfM != null) eff = fcfM;
  if (eff == null) lamps.push('NOT_READY:eff');

  // --- Axis A: organic growth (deal-mask §4.1 + spin-off guard §4 UPSTREAM, winsorized, cliff-aware blend §3-A) ---
  let growthInput = null;
  let dealMasked = false, spinoffRebase = false, staleGrowth = false, revArtifactMult = false;
  if (spinoffRebaselineGuardPharma(revA)) {
    spinoffRebase = true;
    lamps.push('SPINOFF_REBASE');
    lamps.push('NOT_READY:growth');                          // route Axis A drop+renorm upstream
  } else {
    const cleanYoY = [];
    for (let i = 0; i < revA.length - 1; i++) {
      const rNew = revA[i], rOld = revA[i + 1];
      if (rNew == null || rOld == null || rOld <= 0) continue;
      const revG = rNew / rOld - 1;
      const taNew = taA[i], taOld = taA[i + 1];
      const assetG = (taNew != null && taOld != null && taOld > 0) ? (taNew - taOld) / taOld : null;
      // UNIVERSAL revenue-artifact guard FIRST (before the deal-mask): an implausible single-year multiple (>4x)
      // is a scale/units/currency corruption even when assets coincidentally grew — a legit asset-light drug
      // launch ramps fast but sub-4x; a >4x single-year jump is a data artifact, not a one-year acquisition.
      if (suspectRevMultiple(revG)) { revArtifactMult = true; continue; }
      const masked = (assetG != null && assetG >= PH_DEAL_MASK.assetJump && revG >= PH_DEAL_MASK.revJump);
      if (masked) { dealMasked = true; continue; }
      cleanYoY.push(revG);
    }
    if (revArtifactMult) lamps.push('SUSPECT_REVENUE_MULTIPLE');
    if (cleanYoY.length === 0) {
      lamps.push('NOT_READY:growth');                        // no clean YoY (fully deal-masked) -> DROP Axis A + renorm
    } else {
      // STALE:growth if the latest annual year (revA[0]) was itself deal-masked (organic read is aged).
      if (dealMasked) {
        const rNew0 = revA[0], rOld0 = revA[1];
        const taNew0 = taA[0], taOld0 = taA[1];
        if (rNew0 != null && rOld0 != null && rOld0 > 0 && taNew0 != null && taOld0 != null && taOld0 > 0) {
          const revG0 = rNew0 / rOld0 - 1, assetG0 = (taNew0 - taOld0) / taOld0;
          if (assetG0 >= PH_DEAL_MASK.assetJump && revG0 >= PH_DEAL_MASK.revJump) staleGrowth = true;
        }
      }
      let g;
      if (cleanYoY.length === 1) {
        g = cleanYoY[0];                                     // only 1 clean YoY -> single YoY (ABS-honest)
      } else {
        // cliff-aware blend = min(latest clean YoY, 0.6*latest + 0.4*median(clean YoYs)) — damps a launch-spike,
        // keeps an honest red read on a genuine decline (the patent-cliff signal).
        const sorted = cleanYoY.slice().sort((x, y) => x - y);
        const med = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
        const blend = PH_GROWTH_BLEND.wLatest * cleanYoY[0] + PH_GROWTH_BLEND.wTrend * med;
        g = Math.min(cleanYoY[0], blend);
      }
      // winsorize: a near-zero-base launch-spike (ARWR +13954%) clipped at +100% (mirrors medtech growth cap).
      growthInput = Math.max(-0.95, Math.min(PH_GROWTH_CAP, g));
      if (staleGrowth) lamps.push('STALE:growth');
    }
  }
  if (dealMasked) lamps.push('DEAL_MASKED');

  // advisory lamps (Spec §5)
  if (growthInput != null && growthInput < 0) lamps.push('REVENUE_DECLINE');                 // genuine organic decline (patent-cliff proxy)
  if (opM != null && opM < 0) lamps.push('MARGIN_NEGATIVE');
  lamps.push('PATENT_CLIFF_WALL');                                                            // always-on: LOE-concentration uncomputable from companyfacts
  lamps.push('MA_INTANGIBLE_BLIND');                                                          // always-on: intangible/IPR&D M&A signal needs the absent external join

  // pre-revenue facts for the court-score.js SI-4 floor (the materials lesson — a revenue-less shell must NOT be
  // scored: the gm/eff axes are undefined/explosive on near-zero revenue). The classifier's commercial gate
  // already deferred the clinical-stage names; this is the belt-and-suspenders floor.
  const revLatest = revA.find(v => v != null && isFinite(v));
  return {
    cohort,
    growth: round(growthInput), gm: round(gm), eff: round(eff),
    fcfMargin: round(fcfM), opMargin: round(opM),
    dealMasked, spinoffRebase, staleGrowth, revArtifactMult,
    ...(currencySuspect ? { currencySuspect: true, currencySuspectArm: ccMix.arm, currencySuspectRatio: round(ccMix.ratio) } : {}), // additive ONLY when fired -> clean records byte-identical (parity)
    revLatest: (revLatest == null ? null : round(revLatest)),
    nAnnualRev: revA.filter(v => v != null).length,
    lamps,
  };
}

// ===========================================================================
// it_services (CORE) — 5-axis RAW extraction from snapshots (Spec PART B §B.3-§B.5)
// ===========================================================================
// ADDITIV/parity-safe: only fires for tickers in itCohortByTicker (court-buckets it_services). Reads snapshots/
// <T>.json `annual.*` (NEWEST-FIRST) — the canonical pool the deterministic classifier and the re-frozen cohort
// NORMS were calibrated on. Same dual-shape num() extractor as the other CORE buckets.
//
// 5 SCORED axes {gpa, fcfMargin, opMargin, growth, netIssuance} via the NEW engine absKaliberItServices (coverage-
// renorm). gpa/fcfMargin/opMargin/growth NON-inverted (higher=better); netIssuance inverted q(-NSI). The people-
// leverage thesis is carried by people-leverage-VIA-asset-efficiency (gpa lead) — revenue-per-employee is NOT a
// scored axis (§B.2 RPE INVERTED, weight 0.00; used only as the classifier contamination gate + an advisory flag;
// PEOPLE_LEVERAGE_BLIND disclosed). M&A: the consulting/SI/BPO cohort are SERIAL ACQUIRERS (Accenture ~40 tuck-ins/
// yr) — no goodwill line in the LOCAL schema → totalAssets-jump deal-mask on the GROWTH axis only (sign-aware,
// positive jumps only); gpa/fcfMargin/opMargin/netIssuance are NEVER masked (the discipline penalties SHOULD fire
// hardest in the deal year). Spin-off/divestiture re-baselining guard ports from industrials (DXC has divested
// heavily). netIssuance ~50% coverage (Vintage-A lacks annualShares) → DROP+renorm+ISSUANCE_NOT_READY.
//
// Frozen constants (Spec §B.3/§B.5):
const IT_DEAL_MASK = { assetJump: 0.25, revJump: 0.15 };       // §B.5 serial-acquirer totalAssets-jump proxy; BOTH required; sign-aware (positive only)
const IT_SPINOFF = { dropYoY: -0.25, baseFrac: 0.85 };         // §B.5 spin-off/divestiture re-baselining guard
const IT_GROWTH_BLEND = { wLatest: 0.60, wFloor: 0.40 };       // §B.3 0.60*latest clean YoY + 0.40*min(recent clean YoYs)
const IT_RPE_CAP = 700e3;                                      // §B.2 RPE advisory threshold (NOT scored; capital-intensive distributor flag)

// §B.5 spin-off / divestiture re-baselining guard (EXACT JS, mirrors industrials/energy). Operates on annualRev
// newest-first. Fires -> Axis growth routed to NOT_READY:growth UPSTREAM (a permanent-level-shift rebound off a
// shrunken base is never scored as organic).
function spinoffRebaselineGuardItServices(revNewestFirst) {
  const r = revNewestFirst.filter(v => v != null && isFinite(v) && v > 0);
  if (r.length < 3) return false;
  const chron = r.slice().reverse();                       // oldest -> newest
  const yoy = [];
  for (let i = 1; i < chron.length; i++) yoy.push((chron[i] - chron[i - 1]) / Math.abs(chron[i - 1]));
  const hasBigDrop = yoy.some(y => y <= IT_SPINOFF.dropYoY);
  const latestYoY = (r[0] - r[1]) / Math.abs(r[1]);
  const latestPositive = latestYoY > 0;
  const stillBelowBase = r[0] < IT_SPINOFF.baseFrac * Math.max(...r);
  return hasBigDrop && latestPositive && stillBelowBase;
}

// snapshot annual cache for it_services tickers only (avoid re-reading + keep the parity path untouched). Keep the
// FULL snapshot (not just .annual) because the RPE advisory needs meta.fullTimeEmployees.
const itSnapByTicker = new Map(); // ticker -> { annual, fullTimeEmployees }
if (itCohortByTicker.size && fs.existsSync(SNAP_DIR)) {
  for (const t of itCohortByTicker.keys()) {
    try {
      const sn = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, t + '.json'), 'utf8'));
      if (sn && sn.annual) itSnapByTicker.set(t, { annual: sn.annual, fullTimeEmployees: (sn.meta && sn.meta.fullTimeEmployees != null && isFinite(sn.meta.fullTimeEmployees)) ? sn.meta.fullTimeEmployees : null });
    } catch {}
  }
}

// buildItServicesAxes(ticker, cohort) -> the 5 RAW axis inputs + lamps/audit, or null if no snapshot.
// gpa = annualGP[0]/totalAssets[0]; fcfMargin = annualFCF[0]/annualRev[0]; opMargin = annualOpInc[0]/annualRev[0];
// growth = §B.3 0.60*latest_clean_YoY + 0.40*min(recent clean YoYs) with the §B.5 deal-mask + spin-off guard applied
// UPSTREAM (-> growth=null + NOT_READY:growth when fired); netShareIssuance = latest annualShares YoY (<2 non-null ->
// null + ISSUANCE_NOT_READY for drop+renorm). PEOPLE_LEVERAGE_BLIND + the RPE advisory flag are always-on lamps.
function buildItServicesAxes(ticker, cohort) {
  const snap = itSnapByTicker.get(ticker);
  if (!snap) return null;
  const a = snap.annual;
  const revA = (a.annualRev || []).map(num);                  // NEWEST-FIRST, object-wrapped {value}
  const gpA = (a.annualGP || []).map(num);
  const opA = (a.annualOpInc || []).map(num);
  const fcfA = (a.annualFCF || []).map(num);
  const bal = Array.isArray(a.annualBalance) ? a.annualBalance : [];
  const taA = bal.map(b => (b && b.totalAssets != null && isFinite(b.totalAssets)) ? b.totalAssets : null);
  const sharesAll = Array.isArray(a.annualShares) ? a.annualShares.map(num) : [];
  const niA = (a.annualNetIncome || []).map(num);
  const lamps = [];

  // --- UNIVERSAL currency-mix guard (INFY-class): scored-year [0] same-block ordering violation at FX scale ---
  const ccMix = currencyMixSuspect(gpA[0], opA[0], niA[0]);
  const currencySuspect = ccMix.suspect;
  if (currencySuspect) lamps.push('CURRENCY_SUSPECT');           // withheld + dropped from REL anchor DOWNSTREAM (court-score.js)

  // --- Axis T1: GP/assets (Novy-Marx; the asset-light low-capital-compounding proxy, the lead axis) ---
  let gpa = null;
  if (gpA[0] != null && taA[0] != null && taA[0] > 0) gpa = gpA[0] / taA[0];
  else lamps.push('NOT_READY:gpa');

  // --- Axis T2: FCF margin = annualFCF/annualRev (cash conversion = people-leverage payoff) ---
  let fcfMargin = null;
  if (fcfA[0] != null && revA[0] != null && revA[0] > 0) fcfMargin = fcfA[0] / revA[0];
  else lamps.push('NOT_READY:fcfmargin');

  // --- Axis T3: operating margin = annualOpInc/annualRev (pricing power vs wage inflation) ---
  let opMargin = null;
  if (opA[0] != null && revA[0] != null && revA[0] > 0) opMargin = opA[0] / revA[0];
  else lamps.push('NOT_READY:opmargin');

  // --- Axis T5: net-share-issuance (latest YoY; <2 non-null -> DROP + ISSUANCE_NOT_READY renorm) ---
  let netShareIssuance = null;
  const sharesNN = sharesAll.filter(v => v != null && isFinite(v));
  if (sharesNN.length >= 2) {
    let s0 = null, s1 = null;
    for (const v of sharesAll) { if (v != null && isFinite(v)) { if (s0 == null) s0 = v; else { s1 = v; break; } } }
    if (s0 != null && s1 != null && s1 !== 0) netShareIssuance = (s0 - s1) / s1;
    else { netShareIssuance = null; lamps.push('ISSUANCE_NOT_READY'); }
  } else {
    lamps.push('ISSUANCE_NOT_READY');                         // Vintage-A: no annualShares field (~50% of the pool)
  }

  // --- Axis T4: organic growth (deal-mask §B.5 + spin-off guard §B.5 UPSTREAM, min-floor blend §B.3) ---
  let growthInput = null;
  let dealMasked = false, spinoffRebase = false, staleGrowth = false, revArtifactMult = false;
  if (spinoffRebaselineGuardItServices(revA)) {
    spinoffRebase = true;
    lamps.push('SPINOFF_REBASE');
    lamps.push('NOT_READY:growth');                          // route Axis T4 drop+renorm upstream
  } else {
    const cleanYoY = [];
    for (let i = 0; i < revA.length - 1; i++) {
      const rNew = revA[i], rOld = revA[i + 1];
      if (rNew == null || rOld == null || rOld <= 0) continue;
      const revG = rNew / rOld - 1;
      const taNew = taA[i], taOld = taA[i + 1];
      const assetG = (taNew != null && taOld != null && taOld > 0) ? (taNew - taOld) / taOld : null;
      // UNIVERSAL revenue-artifact guard FIRST (before the deal-mask): an implausible single-year multiple (>4x)
      // is a scale/units/currency corruption even when assets coincidentally grew — asset-light SI/consulting
      // hypergrowth is sub-4x; a >4x single-year jump is a data artifact, not a one-year acquisition.
      if (suspectRevMultiple(revG)) { revArtifactMult = true; continue; }
      const masked = (assetG != null && assetG >= IT_DEAL_MASK.assetJump && revG >= IT_DEAL_MASK.revJump);
      if (masked) { dealMasked = true; continue; }            // §B.5 only POSITIVE jumps masked (sign-aware)
      cleanYoY.push(revG);
    }
    if (revArtifactMult) lamps.push('SUSPECT_REVENUE_MULTIPLE');
    if (cleanYoY.length === 0) {
      lamps.push('NOT_READY:growth');                        // no clean YoY (fully deal-masked) -> DROP Axis T4 + renorm
    } else {
      if (dealMasked) {
        const rNew0 = revA[0], rOld0 = revA[1];
        const taNew0 = taA[0], taOld0 = taA[1];
        if (rNew0 != null && rOld0 != null && rOld0 > 0 && taNew0 != null && taOld0 != null && taOld0 > 0) {
          const revG0 = rNew0 / rOld0 - 1, assetG0 = (taNew0 - taOld0) / taOld0;
          if (assetG0 >= IT_DEAL_MASK.assetJump && revG0 >= IT_DEAL_MASK.revJump) staleGrowth = true;
        }
      }
      if (cleanYoY.length === 1) {
        growthInput = cleanYoY[0];                           // only 1 clean YoY -> single YoY (ABS-honest)
      } else {
        // blend = 0.60*latest clean YoY + 0.40*min(recent clean YoYs) — through-cycle damper (mirrors industrials)
        growthInput = IT_GROWTH_BLEND.wLatest * cleanYoY[0] + IT_GROWTH_BLEND.wFloor * Math.min(...cleanYoY);
      }
      if (staleGrowth) lamps.push('STALE:growth');
    }
  }
  if (dealMasked) lamps.push('DEAL_MASKED');

  // --- §B.2 RPE advisory (NOT scored; INVERTED on the live cohort — flag only) + RPE_DECOUPLING risk lamp ---
  let revPerEmployee = null;
  const emp = snap.fullTimeEmployees;
  if (emp != null && emp > 0 && revA[0] != null) {
    revPerEmployee = revA[0] / emp;
    lamps.push('RPE_ADVISORY');                              // RPE surfaced as info, never scored (§B.2 inverted)
    if (revPerEmployee > IT_RPE_CAP) lamps.push('RPE_HIGH_FLAG'); // would have been gated; advisory if it slipped in
  } else {
    lamps.push('PEOPLE_DATA_PARTIAL');                       // headcount absent for this name (~45% of the cohort)
  }

  // --- always-on disclosure walls (Spec §B.6/§B.7) ---
  lamps.push('PEOPLE_LEVERAGE_BLIND');   // §B.0/§B.2/§B.6: book-to-bill/utilization/attrition absent; RPE inverted+not-scored — NO axis directly measures people-leverage (mirrors medtech MA_INTANGIBLE_BLIND)
  lamps.push('BACKLOG_FUTURE');          // §B.6: book-to-bill / RPO — 0 us-gaap token hits → future BONUS, weight 0
  lamps.push('UTILIZATION_FUTURE');      // §B.6: billable-hours utilization — absent
  lamps.push('ATTRITION_FUTURE');        // §B.6: workforce attrition — absent
  lamps.push('CYCLE_WALL');              // §B.7: ~4y history, no through-cycle normalization

  // advisory discipline lamps (Spec §B.7)
  if (netShareIssuance != null && (-netShareIssuance) <= -0.03) lamps.push('DILUTION_HIGH'); // issuance >= 3%

  // pre-revenue facts for the court-score.js SI-4 floor (the materials/energy lesson — a revenue-less shell must NOT
  // be scored: the gpa/fcfMargin/opMargin axes are undefined/explosive on near-zero revenue).
  const revLatest = revA.find(v => v != null && isFinite(v));
  return {
    cohort,
    gpa: round(gpa), fcfMargin: round(fcfMargin), opMargin: round(opMargin),
    growth: round(growthInput), netShareIssuance: round(netShareIssuance),
    revPerEmployee: (revPerEmployee == null ? null : Math.round(revPerEmployee)),
    dealMasked, spinoffRebase, staleGrowth, revArtifactMult,
    ...(currencySuspect ? { currencySuspect: true, currencySuspectArm: ccMix.arm, currencySuspectRatio: round(ccMix.ratio) } : {}), // additive ONLY when fired -> clean records byte-identical (parity)
    revLatest: (revLatest == null ? null : round(revLatest)),
    nAnnualRev: revA.filter(v => v != null).length,
    sharesCoverage: sharesNN.length,
    lamps,
  };
}

// ===========================================================================
// tech_hardware_quality (CORE) — 5-axis RAW extraction from snapshots (council/court triage 2026-06-24)
// ===========================================================================
// ADDITIV/parity-safe: only fires for tickers in thwCohortByTicker (court-buckets tech_hardware_quality). Reads
// snapshots/<T>.json `annual.*` (NEWEST-FIRST) — the canonical pool the deterministic classifier + the frozen cohort
// NORMS were calibrated on. Same dual-shape num() extractor as it_services (flow fields {value}-wrapped; annualBalance.*
// raw numbers).
//
// 5 SCORED axes {gpa, fcfMargin, opMargin, growth, netIssuance} via the engine absKaliberItServices (REUSED — the
// tech_hardware axis set is byte-identical to it_services; only the cohort NORMS differ). gpa/fcfMargin/opMargin/growth
// NON-inverted (higher=better); netIssuance inverted q(-NSI). NO RPE / people-leverage logic (that is it_services-only;
// hardware quality is carried directly by gpa asset-efficiency + the margin pillar). M&A: the franchises include serial
// acquirers (FTV/AMAT roll-ups) — totalAssets-jump deal-mask on the GROWTH axis only (sign-aware, positive jumps only);
// gpa/fcfMargin/opMargin/netIssuance are NEVER masked. Spin-off/divestiture re-baselining guard ports from it_services
// (FTV spun off VNT). netIssuance ~48% coverage (Vintage-A lacks annualShares) → DROP+renorm+ISSUANCE_NOT_READY.
//
// Frozen constants (mirror it_services/industrials):
const THW_DEAL_MASK = { assetJump: 0.25, revJump: 0.15 };      // serial-acquirer totalAssets-jump proxy; BOTH required; sign-aware (positive only)
const THW_SPINOFF = { dropYoY: -0.25, baseFrac: 0.85 };        // spin-off/divestiture re-baselining guard
const THW_GROWTH_BLEND = { wLatest: 0.60, wFloor: 0.40 };      // 0.60*latest clean YoY + 0.40*min(recent clean YoYs)

// spin-off / divestiture re-baselining guard (EXACT JS, mirrors it_services/industrials/energy). Operates on annualRev
// newest-first. Fires -> Axis growth routed to NOT_READY:growth UPSTREAM (a permanent-level-shift rebound off a
// shrunken base is never scored as organic).
function spinoffRebaselineGuardTechHw(revNewestFirst) {
  const r = revNewestFirst.filter(v => v != null && isFinite(v) && v > 0);
  if (r.length < 3) return false;
  const chron = r.slice().reverse();                       // oldest -> newest
  const yoy = [];
  for (let i = 1; i < chron.length; i++) yoy.push((chron[i] - chron[i - 1]) / Math.abs(chron[i - 1]));
  const hasBigDrop = yoy.some(y => y <= THW_SPINOFF.dropYoY);
  const latestYoY = (r[0] - r[1]) / Math.abs(r[1]);
  const latestPositive = latestYoY > 0;
  const stillBelowBase = r[0] < THW_SPINOFF.baseFrac * Math.max(...r);
  return hasBigDrop && latestPositive && stillBelowBase;
}

// snapshot annual cache for tech_hardware tickers only (avoid re-reading + keep the parity path untouched).
const thwSnapAnnual = new Map(); // ticker -> snapshot.annual object
if (thwCohortByTicker.size && fs.existsSync(SNAP_DIR)) {
  for (const t of thwCohortByTicker.keys()) {
    try {
      const sn = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, t + '.json'), 'utf8'));
      if (sn && sn.annual) thwSnapAnnual.set(t, sn.annual);
    } catch {}
  }
}

// buildTechHwAxes(ticker, cohort) -> the 5 RAW axis inputs + lamps/audit, or null if no snapshot.
// gpa = annualGP[0]/totalAssets[0]; fcfMargin = annualFCF[0]/annualRev[0]; opMargin = annualOpInc[0]/annualRev[0];
// growth = 0.60*latest_clean_YoY + 0.40*min(recent clean YoYs) with the deal-mask + spin-off guard applied UPSTREAM
// (-> growth=null + NOT_READY:growth when fired); netShareIssuance = latest annualShares YoY (<2 non-null -> null +
// ISSUANCE_NOT_READY for drop+renorm). SHELL facts (revLatest, nAnnualRev, totalAssets presence) surfaced for the
// court-score.js SI-4 SHELL gate (no positive rev in any year OR no totalAssets in any year -> EXCLUDE). Always-on
// disclosure walls (CYCLE_WALL / INVENTORY_BLIND / BACKLOG_FUTURE / BOOK_TO_BILL_BLIND).
function buildTechHwAxes(ticker, cohort) {
  const a = thwSnapAnnual.get(ticker);
  if (!a) return null;
  const revA = (a.annualRev || []).map(num);                  // NEWEST-FIRST, {value}-wrapped
  const gpA = (a.annualGP || []).map(num);
  const opA = (a.annualOpInc || []).map(num);
  const fcfA = (a.annualFCF || []).map(num);
  const bal = Array.isArray(a.annualBalance) ? a.annualBalance : [];
  const taA = bal.map(b => (b && b.totalAssets != null && isFinite(b.totalAssets)) ? b.totalAssets : null);
  const sharesAll = Array.isArray(a.annualShares) ? a.annualShares.map(num) : [];
  const niA = (a.annualNetIncome || []).map(num);
  const lamps = [];

  // --- UNIVERSAL currency-mix guard (INFY-class): scored-year [0] same-block ordering violation at FX scale ---
  const ccMix = currencyMixSuspect(gpA[0], opA[0], niA[0]);
  const currencySuspect = ccMix.suspect;
  if (currencySuspect) lamps.push('CURRENCY_SUSPECT');           // withheld + dropped from REL anchor DOWNSTREAM (court-score.js)

  // --- Axis H1: GP/assets (Novy-Marx; the franchise vs commodity-contract-mfg separator, the lead axis) ---
  let gpa = null;
  if (gpA[0] != null && taA[0] != null && taA[0] > 0) gpa = gpA[0] / taA[0];
  else lamps.push('NOT_READY:gpa');

  // --- Axis H2: FCF margin = annualFCF/annualRev (cash conversion = the franchise payoff) ---
  let fcfMargin = null;
  if (fcfA[0] != null && revA[0] != null && revA[0] > 0) fcfMargin = fcfA[0] / revA[0];
  else lamps.push('NOT_READY:fcfmargin');

  // --- Axis H3: operating margin = annualOpInc/annualRev (pricing power vs the semi/comms cycle) ---
  let opMargin = null;
  if (opA[0] != null && revA[0] != null && revA[0] > 0) opMargin = opA[0] / revA[0];
  else lamps.push('NOT_READY:opmargin');

  // --- Axis H5: net-share-issuance (latest YoY; <2 non-null -> DROP + ISSUANCE_NOT_READY renorm) ---
  let netShareIssuance = null;
  const sharesNN = sharesAll.filter(v => v != null && isFinite(v));
  if (sharesNN.length >= 2) {
    let s0 = null, s1 = null;
    for (const v of sharesAll) { if (v != null && isFinite(v)) { if (s0 == null) s0 = v; else { s1 = v; break; } } }
    if (s0 != null && s1 != null && s1 !== 0) netShareIssuance = (s0 - s1) / s1;
    else { netShareIssuance = null; lamps.push('ISSUANCE_NOT_READY'); }
  } else {
    lamps.push('ISSUANCE_NOT_READY');                         // Vintage-A: no annualShares field (~52% of the pool)
  }

  // --- Axis H4: organic growth (deal-mask + spin-off guard UPSTREAM, min-floor blend) ---
  let growthInput = null;
  let dealMasked = false, spinoffRebase = false, staleGrowth = false, revArtifactMult = false;
  if (spinoffRebaselineGuardTechHw(revA)) {
    spinoffRebase = true;
    lamps.push('SPINOFF_REBASE');
    lamps.push('NOT_READY:growth');                          // route Axis H4 drop+renorm upstream
  } else {
    const cleanYoY = [];
    for (let i = 0; i < revA.length - 1; i++) {
      const rNew = revA[i], rOld = revA[i + 1];
      if (rNew == null || rOld == null || rOld <= 0) continue;
      const revG = rNew / rOld - 1;
      const taNew = taA[i], taOld = taA[i + 1];
      const assetG = (taNew != null && taOld != null && taOld > 0) ? (taNew - taOld) / taOld : null;
      // UNIVERSAL revenue-artifact guard FIRST (before the deal-mask): an implausible single-year multiple (>4x)
      // is a scale/units/pre-rev-ramp artifact even when assets coincidentally grew — catches the near-zero-base
      // SPAC-era hardware ramps ASTS 16.1x / ONDS 7.4x whose cash-raise inflated assets the same year (the deal-
      // mask would otherwise eat them as "M&A"), which are not $1B-scale organic growth and not real acquisitions.
      if (suspectRevMultiple(revG)) { revArtifactMult = true; continue; }
      const masked = (assetG != null && assetG >= THW_DEAL_MASK.assetJump && revG >= THW_DEAL_MASK.revJump);
      if (masked) { dealMasked = true; continue; }            // only POSITIVE jumps masked (sign-aware)
      cleanYoY.push(revG);
    }
    if (revArtifactMult) lamps.push('SUSPECT_REVENUE_MULTIPLE');
    if (cleanYoY.length === 0) {
      lamps.push('NOT_READY:growth');                        // no clean YoY (fully deal-masked) -> DROP Axis H4 + renorm
    } else {
      if (dealMasked) {
        const rNew0 = revA[0], rOld0 = revA[1];
        const taNew0 = taA[0], taOld0 = taA[1];
        if (rNew0 != null && rOld0 != null && rOld0 > 0 && taNew0 != null && taOld0 != null && taOld0 > 0) {
          const revG0 = rNew0 / rOld0 - 1, assetG0 = (taNew0 - taOld0) / taOld0;
          if (assetG0 >= THW_DEAL_MASK.assetJump && revG0 >= THW_DEAL_MASK.revJump) staleGrowth = true;
        }
      }
      if (cleanYoY.length === 1) {
        growthInput = cleanYoY[0];                           // only 1 clean YoY -> single YoY (ABS-honest)
      } else {
        growthInput = THW_GROWTH_BLEND.wLatest * cleanYoY[0] + THW_GROWTH_BLEND.wFloor * Math.min(...cleanYoY);
      }
      if (staleGrowth) lamps.push('STALE:growth');
    }
  }
  if (dealMasked) lamps.push('DEAL_MASKED');

  // --- always-on disclosure walls ---
  lamps.push('CYCLE_WALL');             // ~4y history, no through-cycle (semi/comms) normalization
  lamps.push('INVENTORY_BLIND');        // hardware inventory turns / obsolescence — no local axis
  lamps.push('BACKLOG_FUTURE');         // book-to-bill / RPO — future BONUS, weight 0
  lamps.push('BOOK_TO_BILL_BLIND');     // order book-to-bill (the semi/comms forward indicator) — absent

  // advisory discipline lamp
  if (netShareIssuance != null && (-netShareIssuance) <= -0.03) lamps.push('DILUTION_HIGH'); // issuance >= 3%

  // SHELL facts for the court-score.js SI-4 gate (no positive rev in ANY year OR no totalAssets in ANY year -> EXCLUDE).
  const revLatest = revA.find(v => v != null && isFinite(v));
  const anyPosRev = revA.some(v => v != null && isFinite(v) && v > 0);
  const anyTotalAssets = taA.some(v => v != null);
  return {
    cohort,
    gpa: round(gpa), fcfMargin: round(fcfMargin), opMargin: round(opMargin),
    growth: round(growthInput), netShareIssuance: round(netShareIssuance),
    dealMasked, spinoffRebase, staleGrowth, revArtifactMult,
    ...(currencySuspect ? { currencySuspect: true, currencySuspectArm: ccMix.arm, currencySuspectRatio: round(ccMix.ratio) } : {}), // additive ONLY when fired -> clean records byte-identical (parity)
    revLatest: (revLatest == null ? null : round(revLatest)),
    nAnnualRev: revA.filter(v => v != null).length,
    anyPosRev, anyTotalAssets,
    sharesCoverage: sharesNN.length,
    lamps,
  };
}

// ===========================================================================
// financials_banks (CORE) — 4-axis RAW extraction from snapshots (court DESIGN 2026-06-23)
// ===========================================================================
// ADDITIV/parity-safe: only fires for tickers in bkCohortByTicker (court-buckets financials_banks). Reads snapshots/
// <T>.json `annual.*` (NEWEST-FIRST) — the canonical pool the deterministic classifier + the re-frozen cohort NORMS
// were calibrated on. Same dual-shape num() extractor (annualNetIncome is {value}-wrapped; annualBalance[].totalAssets/
// totalEquity are raw numbers).
//
// 4 SCORED axes {roaThruCycle, capitalAdequacy, assetGrowthYoY, earningsDurability} via the NEW engine absKaliberBanks
// (coverage-renorm). roaThruCycle/capitalAdequacy/earningsDurability NON-inverted (higher=better); assetGrowthYoY is
// passed RAW (the engine negates it for the inverted assetGrowthDiscipline penalty axis). FCF/OCF/GP/OpInc are NEVER
// extracted (annualGP structurally 0, annualOpInc empty, annualFCF/OCF economically meaningless for banks — JPM
// annualFCF[0] = -$147.8B). capitalAdequacy DROP+renorm when totalEquity null (~45% of pool incl. JPM/WFC/PNC) ->
// CAPADEQ_DROPPED lamp; NEVER imputed. always-on BLIND walls (court revision #5): the most important bank dimensions
// carry NO local signal.
function snBankAnnual(annual) {
  const a = annual || {};
  const ni = (a.annualNetIncome || []).map(num);             // NEWEST-FIRST, object-wrapped {value}
  const bal = Array.isArray(a.annualBalance) ? a.annualBalance : [];
  const ta = bal.map(b => (b && b.totalAssets != null && isFinite(b.totalAssets)) ? b.totalAssets : null);
  const teq = bal.map(b => (b && b.totalEquity != null && isFinite(b.totalEquity)) ? b.totalEquity : null);
  return { ni, ta, teq };
}

// snapshot annual cache for bank tickers only (avoid re-reading + keep the parity path untouched).
const bkSnapAnnual = new Map(); // ticker -> snapshot.annual object
if (bkCohortByTicker.size && fs.existsSync(SNAP_DIR)) {
  for (const t of bkCohortByTicker.keys()) {
    try {
      const sn = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, t + '.json'), 'utf8'));
      if (sn && sn.annual) bkSnapAnnual.set(t, sn.annual);
    } catch {}
  }
}

// buildBankAxes(ticker, cohort) -> the 4 RAW axis inputs + lamps/audit, or null if no snapshot.
// roaThruCycle = mean of available NI[i]/totalAssets[i] over i=0..3 (through-cycle damper); capitalAdequacy =
// totalEquity[0]/totalAssets[0] (null -> DROP+renorm + CAPADEQ_DROPPED); assetGrowthYoY = totalAssets[0]/totalAssets[1]-1
// (engine negates it -> assetGrowthDiscipline penalty); earningsDurability = min(NI avail)/max(NI avail) when max>0 and
// >=3 yrs (else null + DURABILITY_THIN). Shell facts (revLatest surrogate = NI presence, totalAssets[0]) surfaced for
// the court-score.js SI-4 SHELL gate. FCF/OCF NEVER read.
function buildBankAxes(ticker, cohort) {
  const a = bkSnapAnnual.get(ticker);
  if (!a) return null;
  const { ni, ta, teq } = snBankAnnual(a);
  const lamps = [];

  // --- UNIVERSAL currency-mix guard (INFY-class): scored-year [0] same-block ordering violation at FX scale ---
  const ccMix = currencyMixSuspect(null, null, ni[0]);          // banks: no GP denominator -> suspect:false (parity-safe)
  const currencySuspect = ccMix.suspect;
  if (currencySuspect) lamps.push('CURRENCY_SUSPECT');           // withheld + dropped from REL anchor DOWNSTREAM (court-score.js)

  // --- Axis B1: through-cycle ROA = mean of available NI[i]/totalAssets[i] over i=0..3 (4y-avg damper) ---
  let roaThruCycle = null;
  const roas = [];
  for (let i = 0; i < 4; i++) {
    if (ni[i] != null && ta[i] != null && ta[i] > 0) roas.push(ni[i] / ta[i]);
  }
  if (roas.length) roaThruCycle = roas.reduce((s, x) => s + x, 0) / roas.length;
  else lamps.push('NOT_READY:roa');

  // --- Axis B2: capital adequacy = totalEquity[0]/totalAssets[0] (CET1 surrogate; null -> DROP+renorm, NEVER imputed) ---
  let capitalAdequacy = null;
  if (teq[0] != null && ta[0] != null && ta[0] > 0) capitalAdequacy = teq[0] / ta[0];
  else lamps.push('CAPADEQ_DROPPED');   // totalEquity absent (~45% of pool incl. JPM/WFC/PNC) -> coverage-renorm on the other 3 axes

  // --- Axis B3: asset-growth YoY = totalAssets[0]/totalAssets[1]-1 (RAW; engine negates -> discipline PENALTY) ---
  let assetGrowthYoY = null;
  if (ta[0] != null && ta[1] != null && ta[1] > 0) assetGrowthYoY = ta[0] / ta[1] - 1;
  else lamps.push('NOT_READY:assetgrowth');

  // --- Axis B4: earnings durability = min(NI)/max(NI) over >=3 available years when max>0 (LOW weight, BLIND-walled) ---
  let earningsDurability = null;
  const niAvail = ni.filter(v => v != null && isFinite(v));
  if (niAvail.length >= 3) {
    const mx = Math.max(...niAvail), mn = Math.min(...niAvail);
    if (mx > 0) earningsDurability = mn / mx;
    else lamps.push('DURABILITY_THIN');   // all-non-positive max -> undefined ratio (a loss-year cohort)
  } else {
    lamps.push('DURABILITY_THIN');        // <3 NI years (young listing) -> DROP+renorm
  }

  // --- always-on BLIND disclosure walls (court revision #5) — the most important bank dimensions carry NO local signal ---
  lamps.push('CREDIT_QUALITY_BLIND');     // NPLs / net charge-offs / loan-loss provisions ABSENT (the single most important bank dimension)
  lamps.push('NIM_BLIND');                // net interest margin ABSENT
  lamps.push('EFFICIENCY_RATIO_BLIND');   // cost/income efficiency ratio ABSENT
  lamps.push('CET1_BLIND');               // regulatory CET1 / RWA ABSENT — capitalAdequacy is a raw equity/assets surrogate, not Basel
  lamps.push('DEPOSIT_FRANCHISE_BLIND');  // deposit mix / cost-of-funds / non-interest-bearing share ABSENT

  // pre-revenue / shell facts for the court-score.js SI-4 SHELL gate (a name with no positive NI in any year OR no
  // balance sheet must NOT be scored: the roa/capitalAdequacy/assetGrowth axes are undefined on it).
  const anyPositiveNI = niAvail.some(v => v > 0);
  return {
    cohort,
    roaThruCycle: round(roaThruCycle),
    capitalAdequacy: round(capitalAdequacy),
    assetGrowthYoY: round(assetGrowthYoY),
    earningsDurability: round(earningsDurability),
    nAnnualNI: niAvail.length,
    anyPositiveNI,
    totalAssetsLatest: (ta[0] == null ? null : round(ta[0])),
    equityCoverage: (capitalAdequacy != null),
    ...(currencySuspect ? { currencySuspect: true, currencySuspectArm: ccMix.arm, currencySuspectRatio: round(ccMix.ratio) } : {}), // additive ONLY when fired -> clean records byte-identical (parity)
    lamps,
  };
}

// ===========================================================================
// equity_reits (CORE) — 4-axis RAW extraction from snapshots (court DESIGN 2026-06-24)
// ===========================================================================
// ADDITIV/parity-safe: only fires for tickers in reCohortByTicker (court-buckets equity_reits). Reads snapshots/
// <T>.json `annual.*` (NEWEST-FIRST) — the canonical pool the deterministic classifier + the re-frozen cohort NORMS
// were calibrated on.
//
// COURT REVISION #1 — THE {value} UNWRAP (the single concrete implementation defect): the FLOW fields
// (annualRev/annualOpInc/annualNetIncome/annualDepreciation) are WRAPPED OBJECTS {value:N}, NOT raw numbers, while
// annualBalance.{totalAssets,totalDebt,totalCash} ARE raw. Every axis formula MUST unwrap via reUnwrap() before
// arithmetic, else all axes silently NaN. A build-time assert (reAssertNumeric) verifies every extracted axis value is
// typeof number.
//
// 4 SCORED axes {opMargin, ffoAssets, revG3, ndGA} via the NEW engine absKaliberReits (coverage-renorm). opMargin/
// ffoAssets/revG3 NON-inverted (higher=better); ndGA passed RAW (the engine negates it for the inverted, LEVEL-scored
// leverage-discipline axis q(-ndGA) — lower net-debt/assets is better). ffoAssets DROP+renorm when annualDepreciation
// absent (~52% of pool incl. the top-tier VICI/O/PLD/TRNO) -> FFO_COVERAGE_PARTIAL lamp; NEVER imputed (court rev #3).
// COURT REVISION #2 — FFO GAINS-ON-SALE GUARD: FFO ≈ NI + D&A omits the subtraction of gains-on-property-sales
// (no field exists), inflating sale-active large-caps (SPG ffo/ocf = 1.49). When (NI+dep)/OCF > 1.2 the ffoAssets
// observation is gains-inflated -> cap it via the sanity bound (use min(NI+dep, OCF+dep) in the numerator) +
// FFO_GAINS_INFLATED lamp. always-on BLIND walls (court revision #4): the most important REIT value-drivers carry NO
// local signal (SAME_STORE_NOI/OCCUPANCY/NAV_PREMIUM/AFFO_MAINT_CAPEX/FFO_GAINS).
// FFO gains-on-sale guard threshold (court revision #2; mirrors NORMS.equity_reits.ffoGainsGuard.ratioCap = 1.2 —
// kept as a local frozen constant here, the same pattern as IT_DEAL_MASK/IT_RPE_CAP, so the screen build needs no
// lib/absolute-anchor require). (NI+dep)/OCF > ratioCap -> the FFO is gains-on-sale-inflated -> cap + flag.
const REIT_FFO_GUARD = Object.freeze({ ratioCap: 1.2 });

// {value}-unwrap for the WRAPPED flow fields (court revision #1). Raw numbers pass through; {value} objects unwrap.
function reUnwrap(x) {
  if (x == null) return null;
  if (typeof x === 'number') return isFinite(x) ? x : null;
  if (typeof x === 'object' && x.value != null && isFinite(x.value)) return x.value;
  return null;
}
// build-time assert: an extracted axis value must be typeof number (catches a silent {value}-NaN regression).
function reAssertNumeric(ticker, key, v) {
  if (v == null) return;                                          // null = legitimately dropped axis (coverage-renorm)
  if (typeof v !== 'number' || !isFinite(v)) {
    throw new Error(`equity_reits {value}-unwrap FAIL (court revision #1): ${ticker} axis '${key}' is ${typeof v} (${JSON.stringify(v)}), expected a finite number — the {value}-wrapped flow field was not unwrapped`);
  }
}

// snapshot annual cache for reit tickers only (avoid re-reading + keep the parity path untouched).
const reSnapAnnual = new Map(); // ticker -> snapshot.annual object
if (reCohortByTicker.size && fs.existsSync(SNAP_DIR)) {
  for (const t of reCohortByTicker.keys()) {
    try {
      const sn = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, t + '.json'), 'utf8'));
      if (sn && sn.annual) reSnapAnnual.set(t, sn.annual);
    } catch {}
  }
}

// buildReitAxes(ticker, cohort) -> the 4 RAW axis inputs + lamps/audit, or null if no snapshot.
// opMargin = annualOpInc[0]/annualRev[0] (NOI-margin proxy); ffoAssets = (NI[0]+dep[0])/totalAssets[0] (FFO yield;
// null+FFO_COVERAGE_PARTIAL when dep absent; gains-guard caps when (NI+dep)/OCF>1.2); revG3 = (rev[0]/rev[3])^(1/3)-1
// (rent-base 3y CAGR; null+REVG3_THIN when <4 rev years); ndGA = (totalDebt[0]-totalCash[0])/totalAssets[0] (RAW;
// engine negates -> inverted leverage discipline). Shell facts (positive-revenue-year count + totalAssets[0]) surfaced
// for the court-score.js SI-4 SHELL gate. ALL flow fields {value}-unwrapped + asserted numeric (court revision #1).
function buildReitAxes(ticker, cohort) {
  const a = reSnapAnnual.get(ticker);
  if (!a) return null;
  const rev = (a.annualRev || []).map(reUnwrap);                 // NEWEST-FIRST, {value}-WRAPPED -> unwrap
  const op = (a.annualOpInc || []).map(reUnwrap);                // {value}-WRAPPED
  const ni = (a.annualNetIncome || []).map(reUnwrap);           // {value}-WRAPPED
  const dep = (a.annualDepreciation || []).map(reUnwrap);       // {value}-WRAPPED; ABSENT for top-tier VICI/O/PLD/TRNO
  const ocf = (a.annualOCF || []).map(reUnwrap);                // {value}-WRAPPED; for the FFO-gains guard only
  const bal = Array.isArray(a.annualBalance) ? a.annualBalance : [];
  const ta = bal.map(b => (b && b.totalAssets != null && isFinite(b.totalAssets)) ? b.totalAssets : null);   // RAW
  const td = bal.map(b => (b && b.totalDebt != null && isFinite(b.totalDebt)) ? b.totalDebt : null);         // RAW
  const tc = bal.map(b => (b && b.totalCash != null && isFinite(b.totalCash)) ? b.totalCash : null);         // RAW
  const lamps = [];

  // --- UNIVERSAL currency-mix guard (INFY-class): scored-year [0] same-block ordering violation at FX scale ---
  const ccMix = currencyMixSuspect(null, op[0], ni[0]);         // REITs: no GP denominator -> suspect:false (parity-safe)
  const currencySuspect = ccMix.suspect;
  if (currencySuspect) lamps.push('CURRENCY_SUSPECT');           // withheld + dropped from REL anchor DOWNSTREAM (court-score.js)

  // --- Axis R1: NOI-margin proxy = annualOpInc[0]/annualRev[0] ---
  let opMargin = null;
  if (op[0] != null && rev[0] != null && rev[0] > 0) opMargin = op[0] / rev[0];
  else lamps.push('NOT_READY:opmargin');

  // --- Axis R2: FFO yield on asset base = (NI[0] + dep[0]) / totalAssets[0]; FFO-gains guard (court revision #2) ---
  let ffoAssets = null;
  if (ni[0] != null && dep[0] != null && ta[0] != null && ta[0] > 0) {
    let ffoNum = ni[0] + dep[0];
    // FFO GAINS-ON-SALE GUARD: FFO=NI+D&A omits the gains-on-sale subtraction (no field). When (NI+dep)/OCF > ratioCap
    // (1.2) the FFO is gains-inflated (SPG ffo/ocf=1.49) -> cap the numerator at the OCF+dep sanity bound + flag.
    const cap = (REIT_FFO_GUARD && REIT_FFO_GUARD.ratioCap) ? REIT_FFO_GUARD.ratioCap : 1.2;
    if (ocf[0] != null && ocf[0] > 0 && ffoNum / ocf[0] > cap) {
      ffoNum = Math.min(ffoNum, ocf[0] + dep[0]);                // sanity bound: FFO cannot exceed OCF + D&A
      lamps.push('FFO_GAINS_INFLATED');                          // court revision #2: gains-on-sale-inflated FFO capped
    }
    ffoAssets = ffoNum / ta[0];
  } else {
    lamps.push('FFO_COVERAGE_PARTIAL');                          // dep absent (~52% incl. VICI/O/PLD/TRNO) -> DROP+renorm (court rev #3)
  }

  // --- Axis R3: rent-base 3y CAGR = (rev[0]/rev[3])^(1/3)-1 (<4 rev years -> DROP+renorm + REVG3_THIN) ---
  let revG3 = null;
  if (rev[0] != null && rev[3] != null && rev[3] > 0 && rev[0] > 0) revG3 = Math.pow(rev[0] / rev[3], 1 / 3) - 1;
  else lamps.push('REVG3_THIN');

  // --- Axis R4: net-debt/assets = (totalDebt[0]-totalCash[0])/totalAssets[0] (RAW; engine negates -> discipline) ---
  let ndGA = null;
  if (ta[0] != null && ta[0] > 0 && td[0] != null && tc[0] != null) ndGA = (td[0] - tc[0]) / ta[0];
  else lamps.push('NOT_READY:leverage');

  // --- always-on BLIND disclosure walls (court revision #4) — the most important REIT value-drivers carry NO local signal ---
  lamps.push('SAME_STORE_NOI_BLIND');     // same-store NOI growth (the organic-quality gold standard) ABSENT
  lamps.push('OCCUPANCY_BLIND');          // physical / economic occupancy ABSENT
  lamps.push('NAV_PREMIUM_BLIND');        // NAV premium/discount ABSENT (and it is VALUATION — excluded by design)
  lamps.push('AFFO_MAINT_CAPEX_BLIND');   // maintenance-vs-growth capex split ABSENT -> AFFO approximate (FFO is the proxy)
  lamps.push('FFO_GAINS_BLIND');          // gains-on-property-sales subtraction ABSENT -> FFO over-states for sale-active names

  // build-time {value}-unwrap assert (court revision #1): every extracted axis value must be a finite number (or null).
  reAssertNumeric(ticker, 'opMargin', opMargin);
  reAssertNumeric(ticker, 'ffoAssets', ffoAssets);
  reAssertNumeric(ticker, 'revG3', revG3);
  reAssertNumeric(ticker, 'ndGA', ndGA);

  // pre-revenue / shell facts for the court-score.js SI-4 SHELL gate (court found FRMI/MRP/JAN/BXDC/CMRF must be shell-
  // excluded): a name with <3 positive-revenue-years OR no totalAssets[0] is a shell that CANNOT be scored (axes
  // undefined/explosive). The economic SHELL gate keys on positiveRevYears>=3 + totalAssets[0]>0.
  const positiveRevYears = rev.filter(v => v != null && isFinite(v) && v > 0).length;
  const revLatest = rev.find(v => v != null && isFinite(v));
  return {
    cohort,
    opMargin: round(opMargin),
    ffoAssets: round(ffoAssets),
    revG3: round(revG3),
    ndGA: round(ndGA),
    positiveRevYears,
    ...(currencySuspect ? { currencySuspect: true, currencySuspectArm: ccMix.arm, currencySuspectRatio: round(ccMix.ratio) } : {}), // additive ONLY when fired -> clean records byte-identical (parity)
    revLatest: (revLatest == null ? null : round(revLatest)),
    totalAssetsLatest: (ta[0] == null ? null : round(ta[0])),
    ffoCoverage: (ffoAssets != null),
    lamps,
  };
}

// ===========================================================================
// capmkt_fee_core (CORE) — 4-axis RAW extraction from snapshots (court DESIGN 2026-06-24)
// ===========================================================================
// ADDITIV/parity-safe: only fires for tickers in cmCohortByTicker (court-buckets capmkt_fee_core). Reads snapshots/
// <T>.json `annual.*` (NEWEST-FIRST) — the canonical pool the deterministic classifier + the re-frozen cohort NORMS
// were calibrated on. The FLOW fields (annualRev/OpInc/FCF/NetIncome) MAY be {value}-WRAPPED; annualShares is a
// raw-number array. Same dual-shape cmUnwrap() extractor used for all axes.
//
// 4 SCORED axes {opMargin, opMarginStability, fcfMargin, netIssuance} via the NEW engine absKaliberCapmkt (coverage-
// renorm). opMargin/opMarginStability/fcfMargin NON-inverted (higher=better); netIssuance passed RAW (the engine
// negates it for the inverted q(-NSI) discipline axis). opMarginStability = 1 - CV(opMargin over available years),
// CV=stdev/|mean|, clamp [0,1] (a through-cycle pricing-durability proxy, fed as an already-clipped 0..1 observation).
// netIssuance = -((annualShares[0]-annualShares[1])/annualShares[1]); null (~54% lack annualShares) -> DROP+renorm +
// ISSUANCE_NOT_READY, NEVER imputed. The ECONOMIC FEE-GATE (fcfMargin>1.0 / niMargin>=0.95) already ran at
// classification, so the screen only ever sees genuine operating fee businesses. always-on BLIND walls: the most
// important fee-franchise dimensions (AUM flows / fee-rate / recurring-mix / BDC-spread) carry NO local signal.

// {value}-unwrap for the WRAPPED flow fields. Raw numbers pass through; {value} objects unwrap (mirrors reUnwrap).
function cmUnwrap(x) {
  if (x == null) return null;
  if (typeof x === 'number') return isFinite(x) ? x : null;
  if (typeof x === 'object' && x.value != null && isFinite(x.value)) return x.value;
  return null;
}

// snapshot annual cache for capmkt tickers only (avoid re-reading + keep the parity path untouched).
const cmSnapAnnual = new Map(); // ticker -> snapshot.annual object
if (cmCohortByTicker.size && fs.existsSync(SNAP_DIR)) {
  for (const t of cmCohortByTicker.keys()) {
    try {
      const sn = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, t + '.json'), 'utf8'));
      if (sn && sn.annual) cmSnapAnnual.set(t, sn.annual);
    } catch {}
  }
}

// buildCapmktAxes(ticker, cohort) -> the 4 RAW axis inputs + lamps/audit, or null if no snapshot.
// opMargin = annualOpInc[0]/annualRev[0] (fee-franchise pricing power); opMarginStability = 1-CV(opMargin avail years)
// clamp[0,1] (null+STABILITY_THIN when <2 opMargin years); fcfMargin = annualFCF[0]/annualRev[0]; netIssuance =
// -((annualShares[0]-annualShares[1])/annualShares[1]) (RAW; engine negates -> discipline; null+ISSUANCE_NOT_READY
// when <2 share years). Shell facts (positive-revenue-year count + revLatest) surfaced for the court-score.js SI-4
// SHELL gate. ALL flow fields {value}-unwrapped.
function buildCapmktAxes(ticker, cohort) {
  const a = cmSnapAnnual.get(ticker);
  if (!a) return null;
  const rev = (a.annualRev || []).map(cmUnwrap);                 // NEWEST-FIRST, may be {value}-WRAPPED
  const op = (a.annualOpInc || []).map(cmUnwrap);                // may be {value}-WRAPPED
  const fcf = (a.annualFCF || []).map(cmUnwrap);                 // may be {value}-WRAPPED
  const sh = (a.annualShares || []).map(cmUnwrap);              // raw-number array (~46% coverage)
  const lamps = [];

  // --- UNIVERSAL currency-mix guard (INFY-class): scored-year [0] same-block ordering violation at FX scale ---
  const ccMix = currencyMixSuspect(null, op[0], null);          // capmkt: no GP denominator -> suspect:false (parity-safe)
  const currencySuspect = ccMix.suspect;
  if (currencySuspect) lamps.push('CURRENCY_SUSPECT');           // withheld + dropped from REL anchor DOWNSTREAM (court-score.js)

  // --- Axis C1: operating-margin LEVEL = annualOpInc[0]/annualRev[0] ---
  let opMargin = null;
  if (op[0] != null && rev[0] != null && rev[0] > 0) opMargin = op[0] / rev[0];
  else lamps.push('NOT_READY:opmargin');

  // --- Axis C2: operating-margin STABILITY = 1 - CV(opMargin over available years), CV=stdev/|mean|, clamp [0,1] ---
  let opMarginStability = null;
  const opMs = [];
  for (let i = 0; i < rev.length; i++) {
    if (op[i] != null && rev[i] != null && rev[i] > 0) opMs.push(op[i] / rev[i]);
  }
  if (opMs.length >= 2) {
    const mean = opMs.reduce((s, x) => s + x, 0) / opMs.length;
    if (mean !== 0) {
      const variance = opMs.reduce((s, x) => s + (x - mean) * (x - mean), 0) / opMs.length;
      const cv = Math.sqrt(variance) / Math.abs(mean);
      opMarginStability = Math.max(0, Math.min(1, 1 - cv));   // already-clipped [0,1] observation
    } else {
      lamps.push('STABILITY_THIN');   // zero-mean opMargin -> CV undefined -> DROP+renorm
    }
  } else {
    lamps.push('STABILITY_THIN');     // <2 opMargin years -> DROP+renorm
  }

  // --- Axis C3: FCF margin = annualFCF[0]/annualRev[0] (fund-float >1.0 already gated out at classification) ---
  let fcfMargin = null;
  if (fcf[0] != null && rev[0] != null && rev[0] > 0) fcfMargin = fcf[0] / rev[0];
  else lamps.push('NOT_READY:fcfmargin');

  // --- Axis C4: net-share-issuance = -((shares[0]-shares[1])/shares[1]) (RAW; engine negates -> discipline) ---
  let netIssuance = null;
  if (sh[0] != null && sh[1] != null && sh[1] > 0) netIssuance = -((sh[0] - sh[1]) / sh[1]);
  else lamps.push('ISSUANCE_NOT_READY');   // ~54% lack annualShares -> DROP+renorm, NEVER imputed

  // --- always-on BLIND disclosure walls — the most important fee-franchise dimensions carry NO local signal ---
  lamps.push('AUM_FLOW_BLIND');         // assets-under-management net flows / organic AUM growth (the fee-engine fuel) ABSENT
  lamps.push('FEE_RATE_BLIND');         // fee rate / take-rate compression (the secular margin threat) ABSENT
  lamps.push('RECURRING_MIX_BLIND');    // recurring/subscription vs transactional/performance-fee revenue mix ABSENT
  lamps.push('BDC_SPREAD_BLIND');       // surviving BDCs: spread/interest income vs true fee franchise indistinguishable on local data (court rev #1 residual)

  // pre-revenue / shell facts for the court-score.js SI-4 SHELL gate: a name with <2 positive-revenue-years is a shell
  // that CANNOT be scored (the opMargin/fcfMargin axes are undefined/explosive on near-zero revenue).
  const positiveRevYears = rev.filter(v => v != null && isFinite(v) && v > 0).length;
  const revLatest = rev.find(v => v != null && isFinite(v));
  return {
    cohort,
    opMargin: round(opMargin),
    opMarginStability: round(opMarginStability),
    fcfMargin: round(fcfMargin),
    netIssuance: round(netIssuance),
    positiveRevYears,
    ...(currencySuspect ? { currencySuspect: true, currencySuspectArm: ccMix.arm, currencySuspectRatio: round(ccMix.ratio) } : {}), // additive ONLY when fired -> clean records byte-identical (parity)
    revLatest: (revLatest == null ? null : round(revLatest)),
    nAnnualOpM: opMs.length,
    lamps,
  };
}

// --- robuste Feld-Helfer (Format ist gemischt: ftsAnnual.* = [{value}], Rest = [num]) ---
function num(x) {
  if (x == null) return null;
  if (typeof x === 'number') return isFinite(x) ? x : null;
  if (typeof x === 'object' && 'value' in x) return num(x.value);
  const n = Number(x);
  return isFinite(n) ? n : null;
}
function arr(a) {
  if (!Array.isArray(a)) return [];
  return a.map(num).filter(v => v != null);
}
function median(xs) {
  const s = xs.filter(v => v != null && isFinite(v)).slice().sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function mad(xs) {
  const med = median(xs);
  if (med == null) return null;
  return median(xs.map(v => Math.abs(v - med)));
}
// YoY-Reihe aus einer "neuestes-zuerst"-Jahresreihe: rev[i]/rev[i+1]-1
function yoySeries(series) {
  const out = [];
  for (let i = 0; i < series.length - 1; i++) {
    const a = series[i], b = series[i + 1];
    if (a != null && b != null && b > 0) out.push(a / b - 1);
  }
  return out;
}

// --- WEITER Vorfilter (nur um das Universum zu schneiden; bewusst großzügig) ---
const F = {
  minRevM: 50,        // Scale-Floor $50M (Spec Membership-Anker)
  maxPpeAssets: 0.20, // asset-light (Spec hart ≤0.15; +Puffer, damit Klassifizierer entscheidet)
  minGM: 0.30,        // weit (SaaS AI-native ~25%; die meisten Ziele >45%)
  minGrowth: 0.12,    // Hypergrowth-Vorfilter (weit; finales Gate ist weich in Schritt 2)
};

// audit F-A-2026-06-21: guards truncated/empty cache from producing a silent empty candidate set
if (!fs.existsSync(CACHE)) {
  console.error('fundamentals-cache missing — run the pull first (' + CACHE + ')');
  throw new Error('fundamentals-cache missing — run the pull first');
}
const files = fs.readdirSync(CACHE).filter(f => f.endsWith('.json') && !/\./.test(f.replace(/\.json$/, '')));

const candidates = [];
const stats = { total: files.length, parsed: 0, partial: 0, noBalance: 0, noRev: 0, passed: 0 };

for (const file of files) {
  const ticker = file.replace(/\.json$/, '');
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(CACHE, file), 'utf8')); }
  catch { continue; }
  stats.parsed++;
  // industrials_compounder (CORE): a court-buckets-classified industrials name MUST reach the universe even
  // when its CACHE row is thin (pre-revenue SPAC ACHR/EVEX/NNE/PCT, missing-balance HAWK, revLatest<=0 CVLG)
  // — its SCORED axes come from the SNAPSHOT (buildIndustrialsAxes), not the cache. Else SI-5 (classifiedCount
  // ===scoredCount) would mismatch silently. The cache-based early gates below (noRev/noBalance/revLatest) are
  // bypassed for industrials with a parseable snapshot annual block. Non-industrials path: BYTE-IDENTICAL.
  const indCohortEarly = (indCohortByTicker.get(ticker) && indSnapAnnual.has(ticker)) ? indCohortByTicker.get(ticker) : null;
  // consumer_staples_compounder (CORE): same SI-5 rule — a court-buckets-classified staples name MUST reach
  // the universe even with a thin CACHE row (its 5 SCORED axes come from the SNAPSHOT via buildStaplesAxes,
  // not the cache). Bypasses the cache-based early gates below. Non-staples path: BYTE-IDENTICAL.
  const stpCohortEarly = (stpCohortByTicker.get(ticker) && stpSnapAnnual.has(ticker)) ? stpCohortByTicker.get(ticker) : null;
  // consdisc_expansion (CORE): same SI-5 rule — a court-buckets-classified consdisc name MUST reach the
  // universe even with a thin CACHE row (its 4 SCORED axes come from the SNAPSHOT via buildConsdiscAxes,
  // not the cache). Bypasses the cache-based early gates below. Non-consdisc path: BYTE-IDENTICAL.
  const cdCohortEarly = (cdCohortByTicker.get(ticker) && cdSnapAnnual.has(ticker)) ? cdCohortByTicker.get(ticker) : null;
  // materials_quality (CORE): same SI-5 rule — a court-buckets-classified materials name MUST reach the
  // universe even with a thin CACHE row (its 5 SCORED axes come from the SNAPSHOT via buildMaterialsAxes,
  // not the cache). Bypasses the cache-based early gates below. Non-materials path: BYTE-IDENTICAL.
  const mtCohortEarly = (mtCohortByTicker.get(ticker) && mtSnapAnnual.has(ticker)) ? mtCohortByTicker.get(ticker) : null;
  // energy_quality (CORE): same SI-5 rule — a court-buckets-classified energy name MUST reach the universe even
  // with a thin CACHE row (its 5 SCORED axes come from the SNAPSHOT via buildEnergyAxes, not the cache). Bypasses
  // the cache-based early gates below. Non-energy path: BYTE-IDENTICAL.
  const enCohortEarly = (enCohortByTicker.get(ticker) && enSnapAnnual.has(ticker)) ? enCohortByTicker.get(ticker) : null;
  // pharma_commercial (CORE): same SI-5 rule — a court-buckets-classified pharma name MUST reach the universe even
  // with a thin CACHE row (its 3 SCORED axes come from the SNAPSHOT via buildPharmaAxes, not the cache). Bypasses
  // the cache-based early gates below. Non-pharma path: BYTE-IDENTICAL.
  const phCohortEarly = (phCohortByTicker.get(ticker) && phSnapAnnual.has(ticker)) ? phCohortByTicker.get(ticker) : null;
  // it_services (CORE): same SI-5 rule — a court-buckets-classified it_services name MUST reach the universe even
  // with a thin CACHE row (its 5 SCORED axes come from the SNAPSHOT via buildItServicesAxes, not the cache).
  // Bypasses the cache-based early gates below. Non-it_services path: BYTE-IDENTICAL.
  const itCohortEarly = (itCohortByTicker.get(ticker) && itSnapByTicker.has(ticker)) ? itCohortByTicker.get(ticker) : null;
  // financials_banks (CORE): same SI-5 rule — a court-buckets-classified bank name MUST reach the universe even with
  // a thin/empty CACHE row. Banks have NO annualRev (the cache revLatest is null -> the noRev/noBalance early gates
  // below would otherwise DROP every bank); its 4 SCORED axes come from the SNAPSHOT (buildBankAxes) annualNetIncome +
  // annualBalance, not the cache. Bypasses the cache-based early gates. Non-banks path: BYTE-IDENTICAL.
  const bkCohortEarly = (bkCohortByTicker.get(ticker) && bkSnapAnnual.has(ticker)) ? bkCohortByTicker.get(ticker) : null;
  // equity_reits (CORE): same SI-5 rule — a court-buckets-classified equity-REIT name MUST reach the universe even with
  // a thin CACHE row. Its 4 SCORED axes come from the SNAPSHOT (buildReitAxes) annual.* arrays, not the cache. Bypasses
  // the cache-based early gates. Non-reits path: BYTE-IDENTICAL.
  const reCohortEarly = (reCohortByTicker.get(ticker) && reSnapAnnual.has(ticker)) ? reCohortByTicker.get(ticker) : null;
  // capmkt_fee_core (CORE): same SI-5 rule — a court-buckets-classified fee-business name MUST reach the universe even
  // with a thin CACHE row. Its 4 SCORED axes come from the SNAPSHOT (buildCapmktAxes) annual.* arrays, not the cache.
  // Bypasses the cache-based early gates. Non-capmkt path: BYTE-IDENTICAL.
  const cmCohortEarly = (cmCohortByTicker.get(ticker) && cmSnapAnnual.has(ticker)) ? cmCohortByTicker.get(ticker) : null;
  // tech_hardware_quality (CORE): same SI-5 rule — a court-buckets-classified hardware-franchise name MUST reach the
  // universe even with a thin CACHE row. Its 5 SCORED axes come from the SNAPSHOT (buildTechHwAxes) annual.* arrays, not
  // the cache. Bypasses the cache-based early gates. Non-techhw path: BYTE-IDENTICAL.
  const thwCohortEarly = (thwCohortByTicker.get(ticker) && thwSnapAnnual.has(ticker)) ? thwCohortByTicker.get(ticker) : null;
  const coreEarly = indCohortEarly || stpCohortEarly || cdCohortEarly || mtCohortEarly || enCohortEarly || phCohortEarly || itCohortEarly || bkCohortEarly || reCohortEarly || cmCohortEarly || thwCohortEarly;
  const p = j.payload || {};
  if (!j.payload && !coreEarly) continue;
  if (j._ftsPartial) stats.partial++;

  const revA = arr(p.ftsAnnual && p.ftsAnnual.annualRev);
  const gpA = arr(p.ftsAnnual && p.ftsAnnual.annualGP);
  const fcfA = arr(p.ftsAnnual && p.ftsAnnual.annualFCF);
  const opA = arr(p.ftsAnnual && p.ftsAnnual.annualOpInc);
  const niA = arr(p.ftsAnnual && p.ftsAnnual.annualNetIncome);
  const ocfA = arr(p.ftsAnnual && p.ftsAnnual.annualOCF);
  const revQ = arr(p.ftsQuarterly && p.ftsQuarterly.revenueQ);
  const gpQ = arr(p.ftsQuarterly && p.ftsQuarterly.grossProfitQ);
  const sbc = arr(p.ftsAnnualSBC);
  const capex = arr(p.ftsAnnualCapex);
  const shares = arr(p.ftsAnnualShares);
  const bal = Array.isArray(p.ftsBalance) ? p.ftsBalance : [];
  const bal0 = bal[0] || null;

  if (revA.length < 2 && revQ.length < 5) { stats.noRev++; if (!coreEarly) continue; }
  if (!bal0) { stats.noBalance++; if (!coreEarly) continue; }

  const revLatest = revA[0] != null ? revA[0] : null;
  if (revLatest == null || revLatest <= 0) { stats.noRev++; if (!coreEarly) continue; }

  // Growth: annual bevorzugt (matcht Spec-Anker), sonst quartals-YoY
  // audit F-A-2026-06-21: prevents annual-vs-quarterly growth-definition mixing in cross-sectional z and accel-absence demotion of young names
  const gAnnual = (revA[0] != null && revA[1] != null && revA[1] > 0) ? revA[0] / revA[1] - 1 : null;
  const gQ = (revQ.length >= 5 && revQ[4] > 0) ? revQ[0] / revQ[4] - 1 : null;
  const growth = gAnnual != null ? gAnnual : gQ;
  // Record which growth definition fed `growth`, so Schritt 2 can compute anchors per-source
  // (mirrors durSource) instead of z-scoring an annual/quarterly-mixed universe.
  const growthSource = gAnnual != null ? 'annual' : (gQ != null ? 'quarterly' : null);

  // Gross-Margin
  const gm = (gpA[0] != null && revA[0]) ? gpA[0] / revA[0]
    : (gpQ[0] != null && revQ[0]) ? gpQ[0] / revQ[0] : null;

  // Stage: TTM-FCF-Marge (Proxy via annual)
  const fcfMargin = (fcfA[0] != null && revA[0]) ? fcfA[0] / revA[0] : null;
  const opMargin = (opA[0] != null && revA[0]) ? opA[0] / revA[0] : null;
  const niMargin = (niA[0] != null && revA[0]) ? niA[0] / revA[0] : null;

  // Penalty-Inputs
  const sbcPct = (sbc[0] != null && revA[0]) ? sbc[0] / revA[0] : null;
  const netShareGrowth = (shares[0] != null && shares[1] != null && shares[1] > 0) ? shares[0] / shares[1] - 1 : null;

  // Universum-Struktur
  const ppeAssets = (bal0 && bal0.netPPE != null && bal0.totalAssets) ? bal0.netPPE / bal0.totalAssets : null;
  const scaleRevM = revLatest / 1e6;
  const capexPct = (capex[0] != null && revA[0]) ? capex[0] / revA[0] : null;

  // Annual YoY-Reihe (newest-first) — weiterhin Quelle für die Acceleration-Achse.
  const gSeriesA = yoySeries(revA);

  // --- Durability v3 (Fabless A_dur) — Iteration 10 Retrial: age-neutral quarterly persistence ---
  // Quelle: SEC-Quartals-YoY (payload.ftsQuarterly.revQYoYsec, newest-first) bevorzugt; sonst annual YoY Fallback.
  //   durRaw = (median(gW) − λ·downsideDrawdown(gW)) / (|median(gW)| + floor)
  //   gW = letzte W=12 YoY (Window-Cap = Recency-Hauptkontrolle gegen Alt-Zyklen → NVDA-Fix).
  //   downsideDrawdown: recency-gewichtet rho^i (i=0 = neuestes), Gewichte auf Mittel 1 über die Below-Menge
  //   renormiert (= LÄNGEN-NEUTRAL), normiert durch ÷COUNT-below (NICHT ÷n). scale-normalisiert durch (|median|+floor).
  //   WARUM v3: v2 (median/MAD bzw. median−downsideDev über 3 annual YoY) war Court-DENIED — n=3 degenerierte
  //   zu (median,min), dominierte den Score (ρ0.976), war scale-/längen-gekoppelt (Ledger Eintrag 19).
  //   STRIKT alters-neutral: reine Funktion des YoY-Fensters; KEIN dCred/Längen-Term. Konstanten [TODO-CAL].
  const DUR_W = 12, DUR_RHO = 0.9, DUR_LAMBDA = 1.0, DUR_FLOOR = 0.10;
  const revQYoYsec = arr(p.ftsQuarterly && p.ftsQuarterly.revQYoYsec); // SEC-Quartals-YoY, newest-first
  const gYoYDur = (revQYoYsec.length >= 4 ? revQYoYsec : gSeriesA).slice(0, DUR_W);
  const durMed = median(gYoYDur);
  let durDD = null, durCountBelow = 0;
  if (durMed != null) {
    const below = [];
    for (let i = 0; i < gYoYDur.length; i++) if (gYoYDur[i] != null && isFinite(gYoYDur[i]) && gYoYDur[i] < durMed) below.push(i);
    durCountBelow = below.length;
    if (!below.length) durDD = 0;
    else {
      const rawW = below.map(i => Math.pow(DUR_RHO, i));
      const wmean = rawW.reduce((a, v) => a + v, 0) / rawW.length;
      let ss = 0; below.forEach((i, k) => { const w = rawW[k] / wmean; ss += w * (gYoYDur[i] - durMed) ** 2; });
      durDD = Math.sqrt(ss / below.length);
    }
  }
  const durability = (durMed != null && durDD != null) ? (durMed - DUR_LAMBDA * durDD) / (Math.abs(durMed) + DUR_FLOOR) : null;
  const durWinN = gYoYDur.length;
  const durSource = revQYoYsec.length >= 4 ? 'sec-quarterly' : 'annual-fallback';

  // Acceleration (Fabless A_acc): jüngstes YoY - vorheriges YoY
  // audit F-A-2026-06-21: prevents annual-vs-quarterly growth-definition mixing in cross-sectional z and accel-absence demotion of young names
  // Quarterly-YoY-acceleration fallback mirrors the durability source-selection (revQYoYsec):
  // young names with <2 annual YoY are no longer silently neutralised (accel=null).
  let accel, accelSource;
  if (gSeriesA.length >= 2) {
    accel = gSeriesA[0] - gSeriesA[1];
    accelSource = 'annual';
  } else if (revQYoYsec.length >= 2) {
    accel = revQYoYsec[0] - revQYoYsec[1];
    accelSource = 'sec-quarterly';
  } else {
    accel = null;
    accelSource = null;
  }

  // ROIC-Proxy (SaaS A4): NOPAT/InvestedCapital (WACC fehlt -> in Schritt 2 grob)
  const ic = (bal0 && bal0.totalDebt != null && bal0.totalEquity != null) ? (bal0.totalDebt + bal0.totalEquity) : null;
  const roicProxy = (opA[0] != null && ic && ic > 0) ? (opA[0] * 0.79) / ic : null;

  const flags = [];
  if (j._ftsPartial) flags.push('fts-partial');
  if (revA.length < 4) flags.push('short-annual-history');
  if (durWinN < 4) flags.push('thin-durability'); // Durability aus <4 YoY (annual Fallback) — nur Warnung, kein Score-Eingriff

  // Medtech-spezifische Achsen (für alle Ticker; null für Nicht-Medtech/fehlende Daten)
  // gmTrend: mean(letzte2 GM) - mean(erste2 GM) [aus annualGP/annualRev, newest-first]
  let gmTrend = null;
  if (gpA.length >= 4 && revA.length >= 4) {
    const gm0 = gpA[0] / revA[0], gm1 = gpA[1] / revA[1];
    const gm2 = gpA[2] / revA[2], gm3 = gpA[3] / revA[3];
    gmTrend = (gm0 + gm1) / 2 - (gm2 + gm3) / 2;
  } else if (gpA.length >= 3 && revA.length >= 3) {
    const gm0 = gpA[0] / revA[0], gm1 = gpA[1] / revA[1], gm2 = gpA[2] / revA[2];
    gmTrend = (gm0 + gm1) / 2 - ((gm1 + gm2) / 2);
  } else if (gpA.length >= 2 && revA.length >= 2) {
    gmTrend = (gpA[0] / revA[0]) - (gpA[1] / revA[1]);
  }
  // opLeverage: incremental ΔOpInc/ΔRev (neuestes Paar)
  let opLeverage = null;
  if (opA.length >= 2 && revA.length >= 2 && revA[0] !== revA[1]) {
    const dRev = revA[0] - revA[1];
    const dOp = opA[0] - opA[1];
    if (dRev !== 0) opLeverage = dOp / dRev;
  }
  // rdProductivity (neutral wenn kein R&D)
  const rdA = arr(p.ftsAnnual && p.ftsAnnual.annualRnD);
  const snapRnDArr = snapRnD.get(ticker) || [];
  const bestRnD = rdA.length > 0 ? rdA : snapRnDArr;
  const rdProductivity = (growth != null && bestRnD.length > 0 && revA[0] && bestRnD[0] > 0)
    ? growth / (bestRnD[0] / revA[0]) : null;
  // marketCap (snapshot bevorzugt für TTM-Aktualität)
  const marketCapVal = snapMarketCap.get(ticker) || null;

  // --- Vorfilter (profitabilitäts-frei) ---
  // v1.2 Fix A (SI-5 UNIVERSE FIX): Medtech ist KAPITALINTENSIV von Natur aus. Der asset-light/
  // ppeAssets-Gate UND die Growth/GM/Scale-Floors haben ~38 von 61 klassifizierten Medtech-Namen
  // STILL gedroppt (inkl. Large-Caps MDT/SYK/ABT/EW/BDX/ZBH). FINAL DECISION: Medtech wird KOMPLETT
  // vom asset-light-Gate ausgenommen und ALLE klassifizierten Medtech-Namen werden ins Universum
  // (cross-sektionale Mediane) + Scoring admittiert — nur milde Daten-Sanity bleibt.
  // Large-Caps kommen rein (für Perzentil-Anker), fallen aber am Growth-Floor (gateOpen) → NICHT auf
  // der Shortlist (korrekt). NICHT-Medtech-Pfad bleibt BYTE-IDENTISCH (Parität SaaS/Fabless).
  const isMedtech = medtechTickers.has(ticker);
  const isDlst = dlstTickers.has(ticker);
  const indCohort = indCohortByTicker.get(ticker) || null;
  const stpCohort = stpCohortByTicker.get(ticker) || null;
  const cdCohort = cdCohortByTicker.get(ticker) || null;
  const mtCohort = mtCohortByTicker.get(ticker) || null;
  const enCohort = enCohortByTicker.get(ticker) || null;
  const phCohort = phCohortByTicker.get(ticker) || null;
  const itCohort = itCohortByTicker.get(ticker) || null;
  const bkCohort = bkCohortByTicker.get(ticker) || null;
  const reCohort = reCohortByTicker.get(ticker) || null;
  const cmCohort = cmCohortByTicker.get(ticker) || null;
  const thwCohort = thwCohortByTicker.get(ticker) || null;
  if (indCohort) {
    // industrials_compounder (CORE): admit EVERY court-buckets-classified industrials name into the universe
    // (cross-sectional cohort percentiles + SI-5 classifiedCount===scoredCount). NO asset-light/growth/gm
    // pre-filter — industrials is heavy PP&E by nature, and the SI-1 shortlist-cut lives in court-score.js.
    // The 5 axes come from the snapshot annual arrays (buildIndustrialsAxes), NOT the cache growth/gm gates.
    // Sole sanity: a parseable snapshot annual block must exist (else SI-5 would mismatch silently).
    if (!indSnapAnnual.has(ticker)) continue;
  } else if (stpCohort) {
    // consumer_staples_compounder (CORE): identical admission policy — admit EVERY court-buckets-classified
    // staples name into the universe (cross-sectional cohort percentiles + SI-5). NO asset-light/growth/gm
    // pre-filter (staples carry heavy brand-PPE; SI-1 shortlist-cut lives in court-score.js). 5 axes come
    // from the snapshot annual arrays (buildStaplesAxes). Sole sanity: a parseable snapshot annual block exists.
    if (!stpSnapAnnual.has(ticker)) continue;
  } else if (cdCohort) {
    // consdisc_expansion (CORE): identical admission policy — admit EVERY court-buckets-classified consdisc
    // name into the universe (cross-sectional cohort percentiles + SI-5). NO asset-light/growth/gm pre-filter
    // (store-heavy retail carries large capitalized ASC-842 ROU lease assets; SI-1 shortlist-cut lives in
    // court-score.js). 4 axes + shareCAGR come from the snapshot annual arrays (buildConsdiscAxes). Sole
    // sanity: a parseable snapshot annual block exists.
    if (!cdSnapAnnual.has(ticker)) continue;
  } else if (mtCohort) {
    // materials_quality (CORE): identical admission policy — admit EVERY court-buckets-classified materials
    // name into the universe (cross-sectional cohort percentiles + SI-5). NO asset-light/growth/gm pre-filter
    // (materials is heavy PP&E by nature; the SI-1 shortlist-cut lives in court-score.js). 5 axes come from
    // the snapshot annual arrays (buildMaterialsAxes). Sole sanity: a parseable snapshot annual block exists.
    if (!mtSnapAnnual.has(ticker)) continue;
  } else if (enCohort) {
    // energy_quality (CORE): identical admission policy — admit EVERY court-buckets-classified energy name into
    // the universe (cross-sectional cohort percentiles + SI-5). NO asset-light/growth/gm pre-filter (energy is
    // heavy PP&E by nature; the SI-1 shortlist-cut lives in court-score.js). 5 axes come from the snapshot annual
    // arrays (buildEnergyAxes). Sole sanity: a parseable snapshot annual block exists.
    if (!enSnapAnnual.has(ticker)) continue;
  } else if (phCohort) {
    // pharma_commercial (CORE): identical admission policy — admit EVERY court-buckets-classified pharma name into
    // the universe (cross-sectional cohort percentiles + SI-5). NO asset-light/growth/gm pre-filter (the SI-1
    // shortlist-cut lives in court-score.js; the commercial gate already ran in the classifier). 3 axes come from
    // the snapshot annual arrays (buildPharmaAxes). Sole sanity: a parseable snapshot annual block exists.
    if (!phSnapAnnual.has(ticker)) continue;
  } else if (itCohort) {
    // it_services (CORE): identical admission policy — admit EVERY court-buckets-classified it_services name into
    // the universe (cross-sectional cohort percentiles + SI-5). NO asset-light/growth/gm pre-filter (the SI-1
    // shortlist-cut lives in court-score.js; the contamination gate already ran in the classifier). 5 axes come
    // from the snapshot annual arrays (buildItServicesAxes). Sole sanity: a parseable snapshot annual block exists.
    if (!itSnapByTicker.has(ticker)) continue;
  } else if (bkCohort) {
    // financials_banks (CORE): identical admission policy — admit EVERY court-buckets-classified bank name into the
    // universe (cross-sectional cohort percentiles + SI-5). NO asset-light/growth/gm pre-filter — banks have NO revenue/
    // gross-margin line at all (the final else-branch growth/gm/ppe gates would drop EVERY bank); the de-ADR + size gate
    // already ran in the classifier, and the SI-1 shortlist-cut + SHELL gate live in court-score.js. 4 axes come from
    // the snapshot annualNetIncome + annualBalance arrays (buildBankAxes). Sole sanity: a parseable snapshot annual
    // block exists (else SI-5 classifiedCount===scoredCount+excludedCount would mismatch silently).
    if (!bkSnapAnnual.has(ticker)) continue;
  } else if (reCohort) {
    // equity_reits (CORE): identical admission policy — admit EVERY court-buckets-classified equity-REIT name into the
    // universe (cross-sectional cohort percentiles + SI-5). NO asset-light/growth/gm pre-filter — REITs are heavy real-
    // property by nature (the asset-light/ppe gate would drop EVERY REIT); the de-ADR + size + mortgage-separation gate
    // already ran in the classifier, and the SI-1 shortlist-cut + economic SHELL gate live in court-score.js. 4 axes come
    // from the snapshot annual.* arrays (buildReitAxes). Sole sanity: a parseable snapshot annual block exists (else SI-5
    // classifiedCount===scoredCount+excludedCount would mismatch silently).
    if (!reSnapAnnual.has(ticker)) continue;
  } else if (cmCohort) {
    // capmkt_fee_core (CORE): identical admission policy — admit EVERY court-buckets-classified fee-business name into
    // the universe (cross-sectional cohort percentiles + SI-5). NO asset-light/growth/gm pre-filter — fee businesses
    // span exchanges/data/asset-managers/brokers (the asset-light/ppe gate is moot, the gm line is structurally absent
    // for many); the de-ADR + size + fee-gate already ran in the classifier, and the SI-1 shortlist-cut + economic
    // SHELL gate live in court-score.js. 4 axes come from the snapshot annual.* arrays (buildCapmktAxes). Sole sanity:
    // a parseable snapshot annual block exists (else SI-5 classifiedCount===scoredCount+excludedCount mismatch silently).
    if (!cmSnapAnnual.has(ticker)) continue;
  } else if (thwCohort) {
    // tech_hardware_quality (CORE): identical admission policy — admit EVERY court-buckets-classified hardware-franchise
    // name into the universe (cross-sectional cohort percentiles + SI-5). NO asset-light/growth/gm pre-filter — hardware
    // is capital-intensive by nature (the asset-light/ppe gate would wrongly drop the franchises); the de-ADR + size +
    // dedupe already ran in the classifier, and the SI-1 shortlist-cut + the absolute-floor demotion of the commodity/
    // loss tail + the economic SHELL gate live in court-score.js. 5 axes come from the snapshot annual.* arrays
    // (buildTechHwAxes). Sole sanity: a parseable snapshot annual block exists (else SI-5 mismatch silently).
    if (!thwSnapAnnual.has(ticker)) continue;
  } else if (isMedtech || isDlst) {
    // Milde Daten-Sanity: growth/gm/rev müssen vorhanden + endlich sein (keine ökonomischen Floors).
    // Medtech UND D&LST sind kapitalintensiv/Large-Cap-haltig → asset-light/ppe-Gate + ökonomische Floors
    // ENTFERNT (Fix A SI-5: kein stiller Drop). Der Growth-Floor wirkt über gateOpen in court-score.js.
    if (growth == null || !isFinite(growth)) continue;
    if (gm == null || !isFinite(gm)) continue;
  } else {
    if (growth == null || growth < F.minGrowth) continue;
    if (gm == null || gm < F.minGM) continue;
    if (scaleRevM < F.minRevM) continue;
    if (ppeAssets == null || ppeAssets > F.maxPpeAssets) continue;
  }

  stats.passed++;
  // v1.2 Fix D: Medtech-only annual revenue YoY series (newest-first) für die DEAL-YEAR-EXCLUSION
  // Growth-Metrik in court-score.js. Additiv/medtech-only → KEIN Feld auf Nicht-Medtech-Records (Parität).
  // Index i = YoY[i] (rev[i]/rev[i+1]-1); aligned mit goodwillHistory[i] (beide newest-first annual).
  const medtechExtra = isMedtech ? { revYoYMedtech: gSeriesA.map(round) } : {};
  // v0 D&LST: annual revenue YoY series (newest-first) für die DEAL-YEAR-EXCLUSION Growth-Metrik in
  // court-score.js. Additiv/dlst-only → KEIN Feld auf Nicht-D&LST-Records (Parität SaaS/Fabless/Medtech).
  // Index i = YoY[i] (rev[i]/rev[i+1]-1); aligned mit goodwillHistory[i] (beide newest-first annual).
  // revYoYDlstYears[i] = Fiskaljahr des NEUEREN Endpunkts von YoY[i] (= year of revA[i]), per Wert-Match
  // gegen den dlst-Snapshot (Fix A). null wo unalignbar (divergierendes continuing/total-ops-Jahr).
  // Index-aligned mit revYoYDlst (beide haben gSeriesA.length Einträge; revA[i] ist der neuere Endpunkt).
  const dlstExtra = isDlst
    ? { revYoYDlst: gSeriesA.map(round), revYoYDlstYears: fiscalYearsForRev(revA, ticker).slice(0, gSeriesA.length) }
    : {};
  // saas/fabless: annual revenue YoY series (newest-first) for the UNIVERSAL revenue-artifact guard in
  // court-score.js (their growth axis = generic gAnnual = gSeriesA[0]; the guard drops an implausible-multiple
  // latest YoY and falls back to the next clean year). Additive/saas-semi-only → KEIN Feld auf anderen Buckets
  // (Parität Medtech/D&LST/court-screen-buckets). Index i = YoY[i] (rev[i]/rev[i+1]-1), newest-first.
  const saasSemiExtra = saasSemiTickers.has(ticker) ? { revYoYSaasSemi: gSeriesA.map(round) } : {};
  // industrials_compounder (CORE): the 5 RAW axis inputs from the snapshot annual arrays, attached as ONE
  // industrials-only field `ind` (deal-mask + spin-off guard applied UPSTREAM). Additiv → KEIN Feld auf
  // Nicht-Industrials-Records (Parität SaaS/Fabless/Medtech/D&LST).
  const indExtra = indCohort ? { ind: buildIndustrialsAxes(ticker, indCohort) } : {};
  // consumer_staples_compounder (CORE): the 5 RAW axis inputs from the snapshot annual arrays, attached as ONE
  // staples-only field `stp` (deal-mask + spin-off guard applied UPSTREAM). Additiv → KEIN Feld auf
  // Nicht-Staples-Records (Parität SaaS/Fabless/Medtech/D&LST/Industrials).
  const stpExtra = stpCohort ? { stp: buildStaplesAxes(ticker, stpCohort) } : {};
  // consdisc_expansion (CORE): the 4 RAW axis inputs + shareCAGR from the snapshot annual arrays, attached as
  // ONE consdisc-only field `cd` (deal-mask applied UPSTREAM). Additiv → KEIN Feld auf Nicht-Consdisc-Records
  // (Parität SaaS/Fabless/Medtech/D&LST/Industrials/Staples).
  const cdExtra = cdCohort ? { cd: buildConsdiscAxes(ticker, cdCohort) } : {};
  // materials_quality (CORE): the 5 RAW axis inputs from the snapshot annual arrays, attached as ONE
  // materials-only field `mt` (deal-mask + spin-off/super-cycle guard applied UPSTREAM; marginStability is the
  // inverse-CV pricing-power proxy). Additiv → KEIN Feld auf Nicht-Materials-Records (Parität).
  const mtExtra = mtCohort ? { mt: buildMaterialsAxes(ticker, mtCohort) } : {};
  // energy_quality (CORE): the 5 RAW axis inputs from the snapshot annual arrays, attached as ONE energy-only
  // field `en` (deal-mask + spin-off guard + COMMODITY_BETA_SUSPECT windfall lamp applied UPSTREAM; axis B = ROCE,
  // axis C = FCF-margin; GROWTH NOT scored). Additiv → KEIN Feld auf Nicht-Energy-Records (Parität).
  const enExtra = enCohort ? { en: buildEnergyAxes(ticker, enCohort) } : {};
  // pharma_commercial (CORE): the 3 RAW axis inputs {growth, gm, eff} from the snapshot annual arrays, attached as
  // ONE pharma-only field `ph` (deal-mask + spin-off guard + winsorize applied UPSTREAM; LOCAL totalAssets-jump M&A
  // proxy; intangible/IPR&D lamps OMITTED — MA_INTANGIBLE_BLIND). Additiv → KEIN Feld auf Nicht-Pharma-Records (Parität).
  const phExtra = phCohort ? { ph: buildPharmaAxes(ticker, phCohort) } : {};
  // it_services (CORE): the 5 RAW axis inputs {gpa, fcfMargin, opMargin, growth, netIssuance} from the snapshot
  // annual arrays, attached as ONE itservices-only field `it` (deal-mask + spin-off guard applied UPSTREAM; RPE
  // advisory + PEOPLE_LEVERAGE_BLIND lamps). Additiv → KEIN Feld auf Nicht-IT-Services-Records (Parität).
  const itExtra = itCohort ? { it: buildItServicesAxes(ticker, itCohort) } : {};
  // financials_banks (CORE): the 4 RAW axis inputs {roaThruCycle, capitalAdequacy, assetGrowthYoY, earningsDurability}
  // from the snapshot annualNetIncome + annualBalance arrays, attached as ONE banks-only field `bk` (capitalAdequacy
  // DROP+renorm + always-on CREDIT_QUALITY/NIM/EFFICIENCY/CET1/DEPOSIT_FRANCHISE BLIND walls). FCF/OCF NEVER read.
  // Additiv → KEIN Feld auf Nicht-Banks-Records (Parität alle übrigen Buckets).
  const bkExtra = bkCohort ? { bk: buildBankAxes(ticker, bkCohort) } : {};
  // equity_reits (CORE): the 4 RAW axis inputs {opMargin, ffoAssets, revG3, ndGA} from the snapshot annual.* arrays,
  // attached as ONE reits-only field `re` ({value}-unwrap + typeof-number assert + FFO-gains guard applied UPSTREAM;
  // ffoAssets DROP+renorm when dep absent; always-on SAME_STORE_NOI/OCCUPANCY/NAV_PREMIUM/AFFO/FFO_GAINS BLIND walls).
  // Additiv → KEIN Feld auf Nicht-REIT-Records (Parität alle übrigen Buckets).
  const reExtra = reCohort ? { re: buildReitAxes(ticker, reCohort) } : {};
  // capmkt_fee_core (CORE): the 4 RAW axis inputs {opMargin, opMarginStability, fcfMargin, netIssuance} from the
  // snapshot annual.* arrays, attached as ONE capmkt-only field `cm` ({value}-unwrap; 1-CV opMargin stability;
  // netIssuance DROP+renorm when annualShares absent; always-on AUM_FLOW/FEE_RATE/RECURRING_MIX/BDC_SPREAD BLIND
  // walls). Additiv → KEIN Feld auf Nicht-Capmkt-Records (Parität alle übrigen Buckets).
  const cmExtra = cmCohort ? { cm: buildCapmktAxes(ticker, cmCohort) } : {};
  // tech_hardware_quality (CORE): the 5 RAW axis inputs {gpa, fcfMargin, opMargin, growth, netIssuance} from the
  // snapshot annual.* arrays, attached as ONE techhw-only field `thw` (deal-mask + spin-off guard applied UPSTREAM;
  // same axis set + engine as it_services, only the cohort NORMS differ; always-on CYCLE_WALL/INVENTORY_BLIND/
  // BACKLOG_FUTURE/BOOK_TO_BILL_BLIND walls). Additiv → KEIN Feld auf Nicht-TechHW-Records (Parität alle übrigen Buckets).
  const thwExtra = thwCohort ? { thw: buildTechHwAxes(ticker, thwCohort) } : {};
  candidates.push({
    ticker,
    growth: round(growth), growth_annual: round(gAnnual), growth_q: round(gQ), growthSource,
    gm: round(gm), fcfMargin: round(fcfMargin), opMargin: round(opMargin), niMargin: round(niMargin),
    sbcPct: round(sbcPct), netShareGrowth: round(netShareGrowth),
    scaleRevM: Math.round(scaleRevM), ppeAssets: round(ppeAssets), capexPct: round(capexPct),
    durability: round(durability), durMed: round(durMed), durDD: round(durDD),
    durCountBelow, durWinN, durSource, accel: round(accel), accelSource,
    roicProxy: round(roicProxy),
    nAnnualRev: revA.length, nQRev: revQ.length,
    flags,
    gmTrend: round(gmTrend), opLeverage: round(opLeverage), rdProductivity: round(rdProductivity),
    marketCap: marketCapVal,
    ...medtechExtra,
    ...dlstExtra,
    ...saasSemiExtra,
    ...indExtra,
    ...stpExtra,
    ...cdExtra,
    ...mtExtra,
    ...enExtra,
    ...phExtra,
    ...itExtra,
    ...bkExtra,
    ...reExtra,
    ...cmExtra,
    ...thwExtra,
  });
}

function round(x) { return (x == null || !isFinite(x)) ? null : Math.round(x * 10000) / 10000; }

candidates.sort((a, b) => (b.growth || 0) - (a.growth || 0));

// audit F-A-2026-06-21: guards truncated/empty cache from producing a silent empty candidate set
// A partial/empty cache must fail loudly, not silently emit an empty screen.
if (stats.parsed === 0) {
  console.error(`fundamentals-cache parsed 0 of ${stats.total} files — cache is empty or truncated`);
  throw new Error('fundamentals-cache empty/truncated — no fundamentals parsed');
}
if (stats.passed === 0) {
  console.error(`Vorfilter passed 0 of ${stats.parsed} parsed names — refusing to write an empty candidate set`);
  throw new Error('empty candidate set — 0 names passed the membership pre-filter');
}

// audit F-A-2026-06-21: prevents a non-deterministic wall-clock timestamp from re-breaking the determinism gate
// `new Date && undefined` previously dropped the field silently (undefined is omitted by JSON.stringify).
// Derive a snapshot-stable as-of: explicit COURT_ASOF env wins, else newest cache-file mtime.
let generatedFromCacheAt = process.env.COURT_ASOF || null;
if (!generatedFromCacheAt) {
  let newestMtime = 0;
  for (const file of files) {
    try { const m = fs.statSync(path.join(CACHE, file)).mtimeMs; if (m > newestMtime) newestMtime = m; }
    catch { /* skip unreadable file */ }
  }
  if (newestMtime > 0) generatedFromCacheAt = new Date(newestMtime).toISOString();
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ generatedFromCacheAt, filter: F, stats, count: candidates.length, candidates }, null, 2));

// audit/fix (gauntlet C5): US-Listing-Side-File für den GENERATIVEN Anti-Leak-Assert in
// court-score.js. SEPARATE Datei (NICHT in den candidate-Records) → court-candidates.json + alle
// Member-JSON bleiben byte-identisch zu den Parity-Baselines. env-Override court-listing leitet
// auf die isolierten Test-Outputs (Re-Court-Auflage: keine geteilten Artefakte racen).
const LISTING_OUT = process.env.COURT_LISTING_OUT
  || (OUT.endsWith('.json') ? OUT.replace(/court-candidates([^/\\]*)\.json$/, 'court-listing$1.json') : path.join(ROOT, 'outputs', 'court-listing.json'));
const listingObj = {};
for (const [t, rec] of usListingByTicker) listingObj[t] = rec;
try {
  fs.writeFileSync(LISTING_OUT, JSON.stringify({ generatedAt: undefined, count: usListingByTicker.size, listings: listingObj }, null, 2));
} catch {}

console.log('=== court-screen Schritt 1 ===');
console.log(stats);
console.log(`KANDIDATEN nach Vorfilter: ${candidates.length}`);
console.log(`-> ${OUT}`);
console.log('\nTop 30 nach Growth:');
console.log('TICKER   growth    gm     fcfM    sbc%   scale$M  ppe/A   dur    accel   flags');
for (const c of candidates.slice(0, 30)) {
  console.log(
    `${c.ticker.padEnd(7)} ${fmt(c.growth)}  ${fmt(c.gm)}  ${fmt(c.fcfMargin)}  ${fmt(c.sbcPct)}  ${String(c.scaleRevM).padStart(6)}  ${fmt(c.ppeAssets)}  ${(c.durability==null?'—':c.durability.toFixed(1)).padStart(5)}  ${fmt(c.accel)}  ${c.flags.join(',')}`
  );
}
function fmt(x) { return (x == null ? '—' : (x * 100).toFixed(0) + '%').padStart(6); }

// Export für Unit-Tests / Wiederverwendung (court-score.js liest die Side-File, requirt dieses
// Skript NICHT — der require würde den ganzen Screen-Lauf erneut triggern). Nur Hilfsfunktion + Consts.
module.exports = { isUSListing, US_PRIMARY_INVERSION_ALLOWLIST, US_EXCHANGE_WHITELIST };
