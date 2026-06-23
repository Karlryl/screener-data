#!/usr/bin/env node
'use strict';
/**
 * classify-materials.js — deterministic SI-5 classifier for the materials_quality CORE bucket
 * (materials_pricingpower / materials_commodity).
 *
 * Spec: Vault formula-design-materials_quality-v0-2026-06-22.md §1, §6 (Court DESIGN-PASS, v0 — NORMS
 * recomputed-live-then-frozen at CORE). Pure function of meta.sector + meta.industry + the v1
 * COUNTRY-DOMICILE-GUARD isUSListing test (country set != US -> exclude; FOREIGN_NAME legal-form regex for
 * undefined-country foreigners; tiny name-verified FOREIGN_PRIMARY_RESIDUAL; US_PRIMARY_ALLOWLIST for the
 * verified US-primary foreign-domiciled compounders) + num(marketCap) + the cohort industry sets. No fuzzy
 * matching, no per-ticker scoring map, no LLM.
 *
 * TWO cohorts — deterministic pure function of meta.industry (§1, SI-5; no per-ticker map):
 *   materials_pricingpower : {Specialty Chemicals, Building Materials} — gases (LIN/APD), aggregates
 *       (VMC/MLM), coatings (SHW/PPG/ECL/RPM), lime (USLM), CRH; compounders earn spot≈normalized.
 *   materials_commodity    : {Gold, Other Industrial Metals & Mining, Chemicals, Steel, Other Precious
 *       Metals & Mining, Agricultural Inputs, Copper, Silver, Aluminum, Lumber & Wood Production,
 *       Coking Coal, Paper & Paper Products} — deep-cyclical price-takers.
 * Both cohorts n>>15 (live: pricingpower 40 / commodity 55) → full ABS+REL blend (β=0.6), NO thin-n regime.
 *
 * THE CRITICAL HARDENING (§6, larger here than any prior bucket): isUSListing alone LEAKS RIO/VALE/SCCO/PKX/
 * KGC/WPM/PAAS/SVM (Vintage-A country=undefined, region=NYSE, USD, US-legal-form NAMES) AND BHP/CX/MT/AEM/JHX
 * (Vintage-B foreign-domiciled USD-on-US-exchange) into materials_commodity. Killed GENERALIZABLY:
 *   (1) meta.country set != "United States" -> EXCLUDE unconditionally (kills the ~40 country-set foreigners);
 *   (2) FOREIGN_NAME legal-form regex over meta.name catches the undefined-country foreign primaries
 *       (RIO is "Rio Tinto Group" — US legal form, so NOT here; but VALE/NTR/SSL/etc. carry S.A./Ltd/Limited);
 *   (3) FOREIGN_PRIMARY_RESIDUAL = {RIO,SCCO,PKX,KGC,WPM,PAAS,SVM} — Vintage-A foreign primaries whose NAME
 *       uses a US legal form (so neither rule (1) nor (2) catches them), each verified foreign-domiciled.
 *   (4) US_PRIMARY_ALLOWLIST = {CRH,LIN} — the verified US-PRIMARY foreign-domiciled compounders the design
 *       NAMES as marquees that MUST classify (CRH plc Ireland-domiciled NYSE-primary; LIN Linde plc Vintage-A
 *       NasdaqGS-primary). Mirrors classify-staples/consdisc's US_PRIMARY_ALLOWLIST hook (there empty); here
 *       it is the deterministic resolution of the v0 design's only internal tension — its own marquee list
 *       (LIN/CRH) collides with its FOREIGN_NAME regex (kills "Linde plc") + country-set guard (kills CRH
 *       Ireland). The allowlist admits ONLY these two name-verified US-primaries; every other plc/Ltd/S.A./
 *       foreign-country name stays excluded. Expand ONLY with a verified US-primary name.
 *
 * Resolves the court-buckets.json persistence gap: court-buckets.json is gitignored / externally produced,
 * so the materials classification is regenerated reproducibly by THIS committed script. Run modes:
 *   node scripts/classify-materials.js            -> report counts + marquee + foreign-control check (dry-run)
 *   node scripts/classify-materials.js --emit      -> print {classifications:[...]} JSON to stdout
 *   node scripts/classify-materials.js --merge      -> merge materials entries into outputs/court-buckets.json
 *
 * Verified target (recomputed live 2026-06-22): pricingpower 40 / commodity 55; all 15 marquees classify
 * (LIN/APD/VMC/MLM/SHW/ECL/PPG/CRH/RPM/ALB pricingpower; NEM/NUE/FCX/DOW/CF commodity); the 13+ foreign
 * primaries (RIO/VALE/SCCO/PKX/KGC/WPM/PAAS/SVM/BHP/CX/MT/AEM/JHX/NTR/SSL) all DROP.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SNAP_DIR = path.join(ROOT, 'snapshots');
const BUCK = path.join(ROOT, 'outputs', 'court-buckets.json');

// --- num() dual-shape extractor (§2.1) ---
function num(x) {
  if (x == null) return null;
  if (typeof x === 'number') return isFinite(x) ? x : null;
  if (typeof x === 'object' && x.value != null && isFinite(x.value)) return x.value;
  return null;
}

// --- v1 COUNTRY-DOMICILE-GUARD US-listing test (§6) ---
const US_EXCH = new Set(['NYSE', 'NasdaqGS', 'NasdaqGM', 'NasdaqCM', 'NYSEArca', 'NYSE American', 'Nasdaq', 'Cboe US', 'US']);
const OTC_EXCH = new Set(['OTC Markets OTCPK', 'OTC Markets OTCQX', 'OTC Markets OTCQB', 'Other OTC', 'Pink Sheets']);
const FOREIGN_SUFFIX = /\.(HK|SW|TO|L|PA|DE|F|MI|AS|ST|HE|CO|OL|VI|SI|TW|KS|KQ|SS|SZ|T|MX|SA|BR|WA|IR|LS|MC|BK|JK)$/i;
// Foreign legal-form suffix in the company NAME — catches undefined-country foreign primaries
// (VALE "S.A.", NTR "Ltd.", SSL "Limited", LYB "N.V."). Anchored on word boundaries so US "Inc."/"Corp."/
// "Company"/"Co."/"Group"/"Holdings" never match (mirrors classify-staples/consdisc; verified ZERO false
// positives across the US pricingpower+commodity pool — the US-primary marquees LIN/CRH that DO match are
// admitted via the US_PRIMARY_ALLOWLIST override below).
const FOREIGN_NAME = /\b(P\.?L\.?C\.?|S\.?A\.?B\.?\s+de\s+C\.?V\.?|S\.?A\.?\b|N\.?V\.?|OYJ|ASA|S\.?p\.?A\.?|Bhd|Berhad|PJSC|O[AP]O|Limited|Ltd)\b/i;
// TINY, name-verified residual: Vintage-A (meta.country undefined) foreign primaries whose NAME uses a US
// legal form (so neither the country rule nor FOREIGN_NAME catches them), trading USD on a US exchange — the
// FAILURE-MODE-2 foreign-ADR leak (mirrors classify-staples RLX / classify-consdisc JD/PDD/...). Each verified:
//   RIO  — Rio Tinto Group, UK/Australia-domiciled mining ADR
//   SCCO — Southern Copper Corporation, Mexico/Peru-ops, Grupo Mexico-controlled (Mexican primary)
//   PKX  — POSCO Holdings Inc., South Korea-domiciled steel ADR
//   KGC  — Kinross Gold Corporation, Canada-domiciled gold miner
//   WPM  — Wheaton Precious Metals Corp., Canada-domiciled streaming
//   PAAS — Pan American Silver Corp., Canada-domiciled silver miner
//   SVM  — Silvercorp Metals Inc., Canada-domiciled (China-ops) silver miner
// Expand ONLY with a verified foreign-primary name.
const FOREIGN_PRIMARY_RESIDUAL = new Set(['RIO', 'SCCO', 'PKX', 'KGC', 'WPM', 'PAAS', 'SVM']);
// Name-verified US-PRIMARY inversion allowlist: foreign-DOMICILED compounders whose PRIMARY listing is US,
// which the design NAMES as marquees that MUST classify (so the guards above must NOT drop them):
//   CRH — CRH plc, Ireland-domiciled BUT NYSE-primary (moved primary listing to NYSE 2023); region="US".
//   LIN — Linde plc, Ireland-domiciled, Vintage-A (country undefined), NasdaqGS-PRIMARY (largest listing).
// Both match FOREIGN_NAME ("plc")/country-guard (CRH=Ireland) and would be wrongly excluded; the allowlist
// is the deterministic, name-verified override (SI-5: a frozen set, not a per-ticker SCORE map). Mirrors
// court-screen.js US_PRIMARY_INVERSION_ALLOWLIST (STVN). Expand ONLY with a verified US-primary name.
const US_PRIMARY_ALLOWLIST = new Set(['CRH', 'LIN']);

function isUSListing(m, ticker, companyName) {
  if (FOREIGN_SUFFIX.test(ticker)) return false;                              // .HK/.SW/.L/.TO/.SZ …
  if (OTC_EXCH.has(m.region) || OTC_EXCH.has(m.exchangeName)) return false;   // pink-sheet ADRs
  if (US_PRIMARY_ALLOWLIST.has(ticker)) return true;                          // explicit US-primary override (before guards)
  if (FOREIGN_PRIMARY_RESIDUAL.has(ticker)) return false;                     // residual foreign-primary kill
  const ccy = m.reportingCurrency;
  if (m.country != null) {                                                    // Vintage B: country authoritative
    return m.country === 'United States';                                     // SET && != US -> EXCLUDE, no exceptions
  }
  // Vintage A: country undefined -> US-exchange + USD + NO foreign legal-form name
  if (FOREIGN_NAME.test(companyName || '')) return false;
  if (US_EXCH.has(m.region) && (ccy === 'USD' || ccy == null)) return true;
  return false;
}

// --- cohort sets (§1) — deterministic pure function of meta.industry ---
const MATERIALS_PRICINGPOWER = new Set(['Specialty Chemicals', 'Building Materials']);
const MATERIALS_COMMODITY = new Set(['Gold', 'Other Industrial Metals & Mining', 'Chemicals', 'Steel',
  'Other Precious Metals & Mining', 'Agricultural Inputs', 'Copper', 'Silver', 'Aluminum',
  'Lumber & Wood Production', 'Coking Coal', 'Paper & Paper Products']);
const MATERIALS_DEDUPE_DROP = new Set([]); // keep liquid primary; verified no dual-listing in the US pool
// Marquee watchlist (§6 frozen): obvious US flagships that MUST each classify+score, else the universe
// silently collapsed (the country-vintage-collapse regression guard). 1+ from each cohort.
const MATERIALS_MARQUEE = Object.freeze(['LIN', 'APD', 'VMC', 'MLM', 'SHW', 'ECL', 'PPG', 'CRH', 'RPM', 'NEM', 'NUE', 'FCX', 'DOW', 'CF', 'ALB']);
// Positive-control (§6/§8-#8): the foreign-primary miner leak the §6 hardening must keep OUT. Catches a
// regression that drops a guard (country-domicile / FOREIGN_NAME / FOREIGN_PRIMARY_RESIDUAL).
const MATERIALS_FOREIGN_CONTROL = Object.freeze(['RIO', 'VALE', 'SCCO', 'PKX', 'KGC', 'WPM', 'PAAS', 'SVM',
  'BHP', 'CX', 'MT', 'AEM', 'JHX', 'NTR', 'SSL']);

function classifyMaterials(rec) {
  const m = rec.meta || {};
  const t = m.ticker;
  const nm = m.name || m.shortName || m.longName || '';
  if (MATERIALS_DEDUPE_DROP.has(t)) return null;                 // excluded[]
  if (m.sector !== 'Basic Materials') return null;               // Yahoo label for GICS Materials
  if (!isUSListing(m, t, nm)) return null;                       // §6 country-domicile guard + FOREIGN hardening
  const mc = num(rec.marketCap);
  if (mc == null || mc < 1e9) return null;                       // §1 $1B size earmark (num(), not naive >=)
  if (MATERIALS_PRICINGPOWER.has(m.industry)) return 'materials_pricingpower';
  if (MATERIALS_COMMODITY.has(m.industry)) return 'materials_commodity';
  return null;                                                   // unknown industry -> SI-4 null+excluded[]
}

function run() {
  if (!fs.existsSync(SNAP_DIR)) { console.error('snapshots/ missing — run a pull first'); process.exit(1); }
  const files = fs.readdirSync(SNAP_DIR).filter(f => f.endsWith('.json') && !/\./.test(f.replace(/\.json$/, '')));
  const classifications = [];
  const byTicker = {};
  let scanned = 0, materialsSector = 0;
  for (const f of files) {
    let rec;
    try { rec = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); } catch { continue; }
    scanned++;
    if (rec.meta && rec.meta.sector === 'Basic Materials') materialsSector++;
    const bucket = classifyMaterials(rec);
    if (bucket) {
      const t = rec.meta.ticker;
      classifications.push({ t, bucket, confidence: 1.0 });
      byTicker[t] = bucket;
    }
  }
  return { classifications, byTicker, scanned, materialsSector };
}

const r = run();
const pp = r.classifications.filter(c => c.bucket === 'materials_pricingpower');
const commod = r.classifications.filter(c => c.bucket === 'materials_commodity');
const missingMarquee = MATERIALS_MARQUEE.filter(t => !(r.byTicker[t] === 'materials_pricingpower' || r.byTicker[t] === 'materials_commodity'));
const leakedControl = MATERIALS_FOREIGN_CONTROL.filter(t => r.byTicker[t] === 'materials_pricingpower' || r.byTicker[t] === 'materials_commodity');

const arg = process.argv[2];
if (arg === '--emit') {
  process.stdout.write(JSON.stringify({ classifications: r.classifications }, null, 2));
} else if (arg === '--merge') {
  if (missingMarquee.length) { console.error('MARQUEE FAIL, refusing to merge: ' + missingMarquee.join(', ')); process.exit(1); }
  if (leakedControl.length) { console.error('FOREIGN-CONTROL FAIL, refusing to merge: ' + leakedControl.join(', ')); process.exit(1); }
  let buck = { classifications: [] };
  try { buck = JSON.parse(fs.readFileSync(BUCK, 'utf8')); } catch {}
  const arr = Array.isArray(buck.classifications) ? buck.classifications : (Array.isArray(buck) ? buck : []);
  const kept = arr.filter(c => c.bucket !== 'materials_pricingpower' && c.bucket !== 'materials_commodity');
  const out = Array.isArray(buck) ? kept.concat(r.classifications) : Object.assign({}, buck, { classifications: kept.concat(r.classifications) });
  fs.writeFileSync(BUCK, JSON.stringify(out, null, 2));
  console.log(`merged ${r.classifications.length} materials entries into court-buckets.json (pricingpower ${pp.length} / commodity ${commod.length})`);
} else {
  console.log(`scanned ${r.scanned} snapshots; ${r.materialsSector} meta.sector==="Basic Materials"`);
  console.log(`classified: materials_pricingpower ${pp.length} | materials_commodity ${commod.length} | total ${r.classifications.length}`);
  console.log(`marquee coverage (${MATERIALS_MARQUEE.length}): ${missingMarquee.length ? 'FAIL missing ' + missingMarquee.join(',') : 'PASS all classified'}`);
  console.log(`foreign-control (RIO/VALE/SCCO/.../JHX must NOT classify): ${leakedControl.length ? 'FAIL leaked ' + leakedControl.join(',') : 'PASS all excluded'}`);
  console.log(`pricingpower sample: ${pp.slice(0, 14).map(c => c.t).join(', ')}`);
  console.log(`commodity sample: ${commod.slice(0, 14).map(c => c.t).join(', ')}`);
}

module.exports = {
  classifyMaterials, isUSListing, num,
  MATERIALS_PRICINGPOWER, MATERIALS_COMMODITY, MATERIALS_DEDUPE_DROP,
  MATERIALS_MARQUEE, MATERIALS_FOREIGN_CONTROL,
  FOREIGN_PRIMARY_RESIDUAL, US_PRIMARY_ALLOWLIST,
};
