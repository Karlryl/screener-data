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
try {
  const bd = JSON.parse(fs.readFileSync(BUCK, 'utf8'));
  const cls = Array.isArray(bd) ? bd : (bd.classifications || []);
  for (const c of cls) if (c && c.bucket === 'diagnostics_lst' && c.t) dlstTickers.add(c.t);
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
  const p = j.payload;
  if (!p) continue;
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

  if (revA.length < 2 && revQ.length < 5) { stats.noRev++; continue; }
  if (!bal0) { stats.noBalance++; continue; }

  const revLatest = revA[0] != null ? revA[0] : null;
  if (revLatest == null || revLatest <= 0) { stats.noRev++; continue; }

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
  const ppeAssets = (bal0.netPPE != null && bal0.totalAssets) ? bal0.netPPE / bal0.totalAssets : null;
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
  const ic = (bal0.totalDebt != null && bal0.totalEquity != null) ? (bal0.totalDebt + bal0.totalEquity) : null;
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
  if (isMedtech || isDlst) {
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
