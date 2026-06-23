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
try {
  const bd = JSON.parse(fs.readFileSync(BUCK, 'utf8'));
  const cls = Array.isArray(bd) ? bd : (bd.classifications || []);
  for (const c of cls) {
    if (c && c.bucket === 'diagnostics_lst' && c.t) dlstTickers.add(c.t);
    if (c && (c.bucket === 'industrials_heavy' || c.bucket === 'industrials_light') && c.t) indCohortByTicker.set(c.t, c.bucket);
    if (c && (c.bucket === 'staples_branded' || c.bucket === 'staples_distribution') && c.t) stpCohortByTicker.set(c.t, c.bucket);
    if (c && (c.bucket === 'consdisc_store' || c.bucket === 'consdisc_light') && c.t) cdCohortByTicker.set(c.t, c.bucket);
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
  const lamps = [];

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
  let dealMasked = false, spinoffRebase = false, staleGrowth = false;
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
      const masked = (assetG != null && assetG >= IND_DEAL_MASK.assetJump && revG >= IND_DEAL_MASK.revJump);
      if (masked) { dealMasked = true; continue; }
      cleanYoY.push(revG);
    }
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
    dealMasked, spinoffRebase, staleGrowth,
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
  const lamps = [];

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

  // --- Axis A: organic growth (deal-mask §4.1 + spin-off guard §4.2 UPSTREAM, MEDIAN blend §3) ---
  let growthInput = null;
  let dealMasked = false, spinoffRebase = false, staleGrowth = false;
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
      const masked = (assetG != null && assetG >= STP_DEAL_MASK.assetJump && revG >= STP_DEAL_MASK.revJump);
      if (masked) { dealMasked = true; continue; }
      cleanYoY.push(revG);
    }
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
  const niA = (a.annualNetIncome || []).map(num);
  if (niA[0] != null && niA[1] != null && niA[1] !== 0 && (niA[0] - niA[1]) / Math.abs(niA[1]) <= -0.25) {
    const revDown = (revA[0] != null && revA[1] != null && revA[1] > 0) ? (revA[0] / revA[1] - 1) < 0 : false;
    const taDown = (taA[0] != null && taA[1] != null && taA[1] > 0) ? (taA[0] / taA[1] - 1) < 0 : false;
    if (revDown || taDown) lamps.push('IMPAIRMENT_BLIND');
  }

  return {
    cohort,
    gpa: round(gpa), growth: round(growthInput), assetGrowth: round(assetGrowth),
    netShareIssuance: round(netShareIssuance), eff: round(eff),
    dealMasked, spinoffRebase, staleGrowth,
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
  const lamps = [];

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
  let dealMasked = false, staleGrowth = false;
  const cleanYoY = [];
  for (let i = 0; i < revA.length - 1; i++) {
    const rNew = revA[i], rOld = revA[i + 1];
    if (rNew == null || rOld == null || rOld <= 0) continue;
    const revG = rNew / rOld - 1;
    const taNew = taA[i], taOld = taA[i + 1];
    const assetG = (taNew != null && taOld != null && taOld > 0) ? (taNew - taOld) / taOld : null;
    const masked = (assetG != null && assetG >= CD_DEAL_MASK.assetJump && revG >= CD_DEAL_MASK.revJump);
    if (masked) { dealMasked = true; continue; }
    cleanYoY.push(revG);
  }
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
    const cleanRev = revA.filter(v => v != null && isFinite(v) && v > 0); // newest-first
    let cagr2y = null;
    if (cleanRev.length >= 3 && cleanRev[2] > 0) cagr2y = Math.pow(cleanRev[0] / cleanRev[2], 1 / 2) - 1;
    const latestClean = cleanYoY[0];
    if (cagr2y != null) growthInput = CD_GROWTH_BLEND.wYoY * latestClean + CD_GROWTH_BLEND.wCagr2y * cagr2y;
    else growthInput = latestClean;                           // <3 clean revs -> single clean YoY (ABS-honest)
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
    dealMasked, staleGrowth,
    nAnnualRev: revA.filter(v => v != null).length,
    sharesCoverage: sharesNN.length,
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
  const coreEarly = indCohortEarly || stpCohortEarly || cdCohortEarly;
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
    ...indExtra,
    ...stpExtra,
    ...cdExtra,
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
