#!/usr/bin/env node
'use strict';
/**
 * classify-reits.js — deterministic SI-5 classifier for the equity_reits CORE court bucket
 * (ONE equity-REIT through-cycle quality cohort: NOI-margin / FFO-yield / rent-base growth / leverage discipline).
 *
 * Spec: court gauntlet DESIGN for equity_reits (BUILD_WITH_CAVEATS / court REVISE, 2026-06-24). Pure function of
 * meta.sector + meta.industry + the §6-style COUNTRY-DOMICILE-GUARD isUSListing test (country set != US -> exclude;
 * the de-ADR'd FOREIGN_NAME legal-form regex for undefined-country foreign primaries; a positive US-primary test for
 * country-undefined US REITs) + num(marketCap) + the cohort industry set. No fuzzy matching, no per-ticker scoring
 * map, no LLM. THROUGH-CYCLE QUALITY ONLY — the SCORE (court-score.js) never bets on valuation (NAV_PREMIUM_BLIND,
 * SAME_STORE_NOI_BLIND, OCCUPANCY_BLIND, AFFO_MAINT_CAPEX_BLIND, FFO_GAINS_BLIND always-on walls).
 *
 * ONE cohort `equity_reits` — deterministic pure function of meta.industry (SI-5; no per-ticker map):
 *   the EIGHT equity-REIT property-type industries {REIT - Retail, REIT - Office, REIT - Industrial,
 *   REIT - Residential, REIT - Diversified, REIT - Healthcare Facilities, REIT - Specialty,
 *   REIT - Hotel & Motel} AND meta.sector=='Real Estate' AND the country-domicile guard AND num(marketCap)>=$1B,
 *   deduped. Live CLEAN count (recomputed 2026-06-24): 114 classified.
 *
 * THE HARD SEPARATION — MORTGAGE REITS ARE A DIFFERENT ANIMAL (the court's required revision #0): 'REIT - Mortgage'
 * (~14 US >=$1B names: NLY/AGNC/STWD/ABR/RITM/BXMT/...) are NOT equity REITs — they are levered bond portfolios scored
 * on book-value / leverage / dividend-sustainability, NOT FFO/NOI/occupancy. Scoring a mortgage REIT with the
 * NOI-margin / FFO-yield / rent-base-growth axes is economically meaningless. They are classified OUT (NOT in
 * equity_reits) — a DOCUMENTED EXCLUSION with the MORTGAGE_REIT_EXCLUDED note (dry-run report) + the frozen
 * MORTGAGE_INDUSTRY set + the MORTGAGE_CONTROL positive-control list that the merge guard asserts stays OUT.
 *
 * THE DE-ADR HARDENING (the court's required revision #5 — mirrors classify-banks/energy/materials §6): isUSListing
 * alone leaks foreign primaries. Killed GENERALIZABLY:
 *   (1) meta.country set != "United States" -> EXCLUDE unconditionally (kills foreign-domiciled real-estate primaries
 *       + the OTC pink-sheet dual-listings);
 *   (2) FOREIGN_NAME legal-form regex over meta.name catches undefined-country foreign primaries whose name carries a
 *       foreign legal form (S.A./plc/N.V./AG/Ltd ...). US REIT names overwhelmingly end in Trust/Properties/Realty/
 *       Inc./Corporation/Group — none of which the regex matches;
 *   (3) the 5-letter pink-sheet ADR rule /^[A-Z]{4}[FY]$/;
 *   (4) the POSITIVE US-PRIMARY test (the build pattern's US-primary mechanism): a country-undefined name is admitted
 *       ONLY if it lists on a US exchange (US_EXCH region) with USD reporting and NO foreign legal-form name (admits
 *       the country-undefined US REITs O/VICI/PLD/TRNO that carry country=undefined, NYSE, USD). The anti-leak assert
 *       must NOT key on country!=US (that would throw on the legitimate undefined-country US REITs).
 *   US_PRIMARY_ALLOWLIST kept (empty) for structural parity — no US-primary equity REIT carries a foreign legal-form
 *   name that the FOREIGN_NAME guard would wrongly drop; expand ONLY with a verified US-primary foreign-NAME REIT.
 *
 * DEDUPE (keep the liquid US-primary common; drop preferred-share / dual-class / legacy-ticker duplicates that pass
 * the country-SET test). Implemented as a (NI[0]|totalAssets[0]) economic fingerprint dedupe (mirrors the court-score
 * dedupe rationale for the snapshot-sourced CORE buckets): two distinct companies never share the fp; a preferred /
 * dual-class duplicate of the same company does. The frozen REIT_DEDUPE_DROP set is kept (empty live) as the explicit
 * named-dedupe override mechanism, expand ONLY with a verified duplicate ticker.
 *
 * Run modes (mirror classify-banks/itservices):
 *   node scripts/classify-reits.js            -> report count + marquee + mortgage/foreign control (dry-run)
 *   node scripts/classify-reits.js --emit      -> print {classifications:[...]} JSON to stdout
 *   node scripts/classify-reits.js --merge      -> merge equity_reits entries into outputs/court-buckets.json
 *
 * Verified target (recomputed live 2026-06-24): equity_reits 114; all 7 marquees classify (O/PLD/VICI/SPG/EXR/EGP/
 * CTRE); the 14 mortgage REITs (NLY/AGNC/STWD/ABR/RITM/BXMT/CIM/DX/EFC/LADR/ARI/ARR/ORC/TWO) all DROP.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SNAP_DIR = path.join(ROOT, 'snapshots');
const BUCK = path.join(ROOT, 'outputs', 'court-buckets.json');

// --- num() dual-shape extractor ---
function num(x) {
  if (x == null) return null;
  if (typeof x === 'number') return isFinite(x) ? x : null;
  if (typeof x === 'object' && x.value != null && isFinite(x.value)) return x.value;
  return null;
}
// FLOW-field {value}-unwrap (court revision #1): the annual flow fields (annualRev/OpInc/NetIncome/Depreciation) are
// WRAPPED OBJECTS {value:N}; annualBalance.* are raw numbers. Same dual-shape logic as num() — used for the dedupe fp.
const unwrap = x => (x == null ? null : (typeof x === 'number' ? (isFinite(x) ? x : null) : (x.value != null && isFinite(x.value) ? x.value : null)));

// --- COUNTRY-DOMICILE-GUARD US-listing test (mirrors classify-banks/itservices isUSListing) ---
const US_EXCH = new Set(['NYSE', 'NasdaqGS', 'NasdaqGM', 'NasdaqCM', 'NYSEArca', 'NYSE American', 'Nasdaq', 'Cboe US', 'US']);
const OTC_EXCH = new Set(['OTC Markets OTCPK', 'OTC Markets OTCQX', 'OTC Markets OTCQB', 'Other OTC', 'Pink Sheets']);
const FOREIGN_SUFFIX = /\.(HK|SW|TO|L|PA|DE|F|MI|AS|ST|HE|CO|OL|VI|SI|TW|KS|KQ|SS|SZ|T|MX|SA|BR|WA|IR|LS|MC|BK|JK|AX)$/i;
// Foreign legal-form suffix in the company NAME — catches undefined-country foreign REIT primaries. Anchored on word
// boundaries so US "Inc."/"Corp."/"Trust"/"Properties"/"Realty"/"Group"/"Holdings" never match (mirrors classify-banks).
const FOREIGN_NAME = /\b(P\.?L\.?C\.?|S\.?A\.?B\.?\s+de\s+C\.?V\.?|S\.?A\.?\b|N\.?V\.?|A\/S|OYJ|ASA|S\.?p\.?A\.?|\bSE\b|\bAG\b|Bhd|Berhad|PJSC|O[AP]O|Limited|Ltd)\b/i;
// Name-verified US-PRIMARY inversion allowlist (empty for REITs — no US-primary equity REIT carries a foreign
// legal-form name that the FOREIGN_NAME guard would wrongly drop; kept for structural parity with classify-energy/
// materials/itservices so the mechanism is present if a future verified US-primary foreign-NAME REIT appears).
const US_PRIMARY_ALLOWLIST = new Set([]);

function isUSListing(m, ticker, companyName) {
  if (FOREIGN_SUFFIX.test(ticker)) return false;                              // .L/.TO/.SZ … foreign-suffix tickers
  if (/^[A-Z]{4}[FY]$/.test(ticker)) return false;                            // 5-letter pink-sheet ADR
  if (OTC_EXCH.has(m.region) || OTC_EXCH.has(m.exchangeName)) return false;   // pink-sheet ADR dual-listings
  if (US_PRIMARY_ALLOWLIST.has(ticker)) return true;                          // explicit US-primary override (before guards)
  const ccy = m.reportingCurrency;
  if (m.country != null) {                                                    // country SET -> authoritative
    return m.country === 'United States';                                     // SET && != US -> EXCLUDE, no exceptions
  }
  // country undefined -> POSITIVE US-primary test: US exchange + USD + NO foreign legal-form name (admits O/VICI/PLD/TRNO)
  if (FOREIGN_NAME.test(companyName || '')) return false;
  if (US_EXCH.has(m.region) && (ccy === 'USD' || ccy == null)) return true;
  return false;
}

// --- cohort set — deterministic pure function of meta.industry ---
const REIT_SECTOR = 'Real Estate';
// The EIGHT equity-REIT property-type industries (the FFO/NOI animal). 'REIT - Mortgage' is DELIBERATELY ABSENT.
const REIT_INDUSTRY = new Set([
  'REIT - Retail', 'REIT - Office', 'REIT - Industrial', 'REIT - Residential',
  'REIT - Diversified', 'REIT - Healthcare Facilities', 'REIT - Specialty', 'REIT - Hotel & Motel',
]);
// HARD-SEPARATED mortgage-REIT industry (court revision #0): a DIFFERENT animal (book-value/leverage/dividend
// sustainability, not FFO/NOI). Classified OUT of equity_reits — documented exclusion (MORTGAGE_REIT_EXCLUDED).
const MORTGAGE_INDUSTRY = new Set(['REIT - Mortgage']);
// Dedupe drop-set: preferred-share / dual-class / legacy-ticker duplicates that pass the country-SET=US test but are
// not the liquid primary. Empty live (no verified equity-REIT dual-listing in the US pool); kept as the explicit
// named-dedupe override mechanism (mirrors classify-banks BANK_DEDUPE_DROP). The economic-fingerprint dedupe in run()
// is the PRIMARY mechanism; expand this set ONLY with a verified duplicate ticker.
const REIT_DEDUPE_DROP = new Set([]);

// Marquee watchlist (frozen): the design's named flagships that MUST each classify, else the universe silently
// collapsed (the country-vintage-collapse regression guard the court demanded). Quality triple-net/industrial/
// specialty/healthcare REITs spanning the property types.
const REIT_MARQUEE = Object.freeze(['O', 'PLD', 'VICI', 'SPG', 'EXR', 'EGP', 'CTRE']);
// Positive-control: the mortgage REITs the hard-separation must keep OUT of equity_reits (court revision #0) + any
// foreign-primary real-estate name the de-ADR guard must keep out. Catches a regression that re-admits the mortgage
// industry or drops a country guard.
const REIT_MORTGAGE_CONTROL = Object.freeze(['NLY', 'AGNC', 'STWD', 'ABR', 'RITM', 'BXMT', 'CIM', 'DX', 'EFC',
  'LADR', 'ARI', 'ARR', 'ORC', 'TWO']);

function classifyReit(rec) {
  const m = rec.meta || {};
  const t = m.ticker;
  const nm = m.name || m.shortName || m.longName || '';
  if (REIT_DEDUPE_DROP.has(t)) return null;                      // preferred/dual-class dedupe -> not classified
  if (m.sector !== REIT_SECTOR) return null;                     // Yahoo label for GICS Real Estate
  if (MORTGAGE_INDUSTRY.has(m.industry)) return null;            // HARD-SEPARATE mortgage REITs (court revision #0) -> OUT
  if (!REIT_INDUSTRY.has(m.industry)) return null;               // only the eight equity-REIT property types
  if (!isUSListing(m, t, nm)) return null;                       // de-ADR country-domicile guard + FOREIGN hardening
  const mc = num(rec.marketCap);
  if (mc == null || mc < 1e9) return null;                       // $1B size earmark (num(), not naive >=)
  return 'equity_reits';
}

function run() {
  if (!fs.existsSync(SNAP_DIR)) { console.error('snapshots/ missing — run a pull first'); process.exit(1); }
  const files = fs.readdirSync(SNAP_DIR).filter(f => f.endsWith('.json') && !/\./.test(f.replace(/\.json$/, '')));
  const classifications = [];
  const byTicker = {};
  const mortgageExcluded = [];   // dry-run report: 'REIT - Mortgage' US >=$1B names hard-separated OUT
  const seen = new Set();        // economic-fingerprint dedupe (NI[0]|totalAssets[0])
  let scanned = 0, reSector = 0, equityIndustry = 0;
  for (const f of files) {
    let rec;
    try { rec = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); } catch { continue; }
    scanned++;
    const m = rec.meta || {};
    if (m.sector === REIT_SECTOR) reSector++;
    // mortgage-REIT hard-separation report (court revision #0): US >=$1B 'REIT - Mortgage' names excluded from equity_reits.
    if (m.sector === REIT_SECTOR && MORTGAGE_INDUSTRY.has(m.industry) && isUSListing(m, m.ticker, m.name || '')) {
      const mc = num(rec.marketCap);
      if (mc != null && mc >= 1e9) mortgageExcluded.push(m.ticker);
    }
    if (m.sector === REIT_SECTOR && REIT_INDUSTRY.has(m.industry)) equityIndustry++;
    const bucket = classifyReit(rec);
    if (!bucket) continue;
    // economic-fingerprint dedupe: drop preferred/dual-class duplicates of the SAME company (same NI[0]|totalAssets[0]).
    // Two distinct companies never share the fp; the degenerate '0|0' (no annual data) is never deduped (would collapse
    // multiple thin shells). Mirrors the court-score CORE dedupe rationale.
    const a = rec.annual || {};
    const ni0 = (a.annualNetIncome && a.annualNetIncome[0] != null) ? unwrap(a.annualNetIncome[0]) : null;
    const bal0 = (Array.isArray(a.annualBalance) && a.annualBalance[0]) ? a.annualBalance[0] : null;
    const ta0 = (bal0 && bal0.totalAssets != null && isFinite(bal0.totalAssets)) ? bal0.totalAssets : null;
    const fp = `${ni0 == null ? '' : ni0}|${ta0 == null ? '' : ta0}`;
    if (fp !== '|' && seen.has(fp)) continue;
    if (fp !== '|') seen.add(fp);
    const t = m.ticker;
    classifications.push({ t, bucket, confidence: 1.0 });
    byTicker[t] = bucket;
  }
  return { classifications, byTicker, mortgageExcluded, scanned, reSector, equityIndustry };
}

const REIT_BUCKETS = new Set(['equity_reits']);
const r = run();
const reits = r.classifications.filter(c => c.bucket === 'equity_reits');
const missingMarquee = REIT_MARQUEE.filter(t => !REIT_BUCKETS.has(r.byTicker[t]));
const leakedMortgage = REIT_MORTGAGE_CONTROL.filter(t => REIT_BUCKETS.has(r.byTicker[t]));

const arg = process.argv[2];
if (arg === '--emit') {
  process.stdout.write(JSON.stringify({ classifications: r.classifications }, null, 2));
} else if (arg === '--merge') {
  if (missingMarquee.length) { console.error('MARQUEE FAIL, refusing to merge: ' + missingMarquee.join(', ')); process.exit(1); }
  if (leakedMortgage.length) { console.error('MORTGAGE-CONTROL FAIL, refusing to merge: ' + leakedMortgage.join(', ')); process.exit(1); }
  let buck = { classifications: [] };
  try { buck = JSON.parse(fs.readFileSync(BUCK, 'utf8')); } catch {}
  const arr = Array.isArray(buck.classifications) ? buck.classifications : (Array.isArray(buck) ? buck : []);
  const kept = arr.filter(c => !REIT_BUCKETS.has(c.bucket));
  const out = Array.isArray(buck) ? kept.concat(r.classifications) : Object.assign({}, buck, { classifications: kept.concat(r.classifications) });
  fs.writeFileSync(BUCK, JSON.stringify(out, null, 2));
  console.log(`merged ${r.classifications.length} equity_reits entries into court-buckets.json`);
} else {
  console.log(`scanned ${r.scanned} snapshots; ${r.reSector} meta.sector==="Real Estate"; ${r.equityIndustry} in the eight equity-REIT industries (raw)`);
  console.log(`classified: equity_reits ${reits.length}`);
  console.log(`MORTGAGE_REIT_EXCLUDED (hard-separated, US >=$1B 'REIT - Mortgage' NOT scored in equity_reits): ${r.mortgageExcluded.length} -> ${r.mortgageExcluded.join(', ') || '(none)'}`);
  console.log(`marquee coverage (${REIT_MARQUEE.length}): ${missingMarquee.length ? 'FAIL missing ' + missingMarquee.join(',') : 'PASS all classified'}`);
  console.log(`mortgage-control (NLY/AGNC/STWD/... must NOT classify in equity_reits): ${leakedMortgage.length ? 'FAIL leaked ' + leakedMortgage.join(',') : 'PASS all excluded'}`);
  console.log(`equity_reits sample: ${reits.slice(0, 20).map(c => c.t).join(', ')}`);
}

module.exports = {
  classifyReit, isUSListing, num, unwrap,
  REIT_SECTOR, REIT_INDUSTRY, MORTGAGE_INDUSTRY, REIT_DEDUPE_DROP,
  REIT_MARQUEE, REIT_MORTGAGE_CONTROL, US_PRIMARY_ALLOWLIST,
};
