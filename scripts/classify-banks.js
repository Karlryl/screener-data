#!/usr/bin/env node
'use strict';
/**
 * classify-banks.js — deterministic SI-5 classifier for the financials_banks CORE bucket.
 *
 * Spec: court gauntlet DESIGN for financials_banks (BUILD_WITH_CAVEATS / court REVISE, 2026-06-23). Pure function of
 * meta.sector + meta.industry + the §6-style COUNTRY-DOMICILE-GUARD isUSListing test (country set != US -> exclude;
 * the de-ADR'd FOREIGN_NAME legal-form regex for undefined-country foreign ADRs; the frozen BANK_FOREIGN_DROP
 * megabank-ADR DENY set; a positive US-primary test for country-undefined US banks) + num(marketCap) + the cohort
 * industry set. No fuzzy matching, no per-ticker scoring map, no LLM. THROUGH-CYCLE QUALITY ONLY — the SCORE
 * (court-score.js) never bets on the credit cycle (CREDIT_QUALITY_BLIND etc. always-on walls).
 *
 * ONE cohort — deterministic pure function of meta.industry (SI-5; no per-ticker map):
 *   financials_banks : {Banks - Regional, Banks - Diversified} — the deposit-funded US bank tier. Regional dominates
 *       (n~123); Diversified is the money-center handful (JPM/WFC/USB/PNC/TFC) folded in (n~6, cannot stand alone and
 *       shares the same ROA/capital-adequacy economics). Live CLEAN count (recomputed 2026-06-23): 128 classified.
 *
 * THE KILLSHOT — DE-ADR THE FOREIGN MEGABANKS (the court's required revision #1): country==undefined CANNOT be the
 * classify-in key — 16+ foreign megabank ADRs (RY/TD/SAN/UBS/MUFG/SMFG/MFG/IBN/ITUB/NU/NWG/BSBR/KB/SHG/WF/BMA) share
 * country=undefined with the legitimate undefined-country US banks (JPM/PNC/USB/MTB carry country=undefined). The leak
 * is killed GENERALIZABLY, mirroring classify-energy's §6 hardening:
 *   (1) meta.country SET != "United States" -> EXCLUDE unconditionally (kills the country-set foreigners HSBC/BBVA/
 *       BMO/BNS/ING/Barclays/Santander-Spain + the OTC pink-sheet dual-listings HBCYF/BCDRF/...);
 *   (2) FOREIGN_NAME legal-form regex over meta.name catches undefined-country foreign primaries whose name carries a
 *       foreign legal form (S.A./plc/N.V./AG/Ltd — Santander S.A., NatWest plc, ICICI Bank Limited, UBS Group AG ...);
 *   (3) BANK_FOREIGN_DROP = the explicit frozen foreign-megabank-ADR DENY set the court NAMES — undefined-country
 *       foreign ADRs with US-form or regex-slipping names that neither (1) nor (2) reliably catches. Each verified
 *       foreign-domiciled. This is the court's mandated minimum DENY set.
 *   (4) The POSITIVE US-PRIMARY test (the build pattern's US-primary mechanism): a country-undefined name is admitted
 *       ONLY if it lists on a US exchange (US_EXCH region) with USD reporting and NO foreign legal-form name and is
 *       NOT in the DENY set — admitting JPM/PNC/USB/MTB (country=undefined, NYSE/Nasdaq, USD, US-form names) while
 *       the foreign ADRs are denied. This is why the anti-leak assert must NOT key on country!=US (that would throw
 *       on the legitimate undefined-country US banks).
 *
 * DEDUPE (keep the liquid US-primary common; drop preferred-share / dual-class / legacy-ticker duplicates that pass
 * the country-SET test): KEY-PK (KeyCorp preferred; keep KEY), WFC-PC (Wells Fargo preferred; keep WFC), FCNCB (First
 * Citizens Class-B dual-class; keep FCNCA the liquid Class-A), BK (legacy Bank of New York Mellon ticker; keep BNY,
 * the post-2024-rebrand current primary — identical NI $5.306B confirms same company). FBNC (First Bancorp NC) and
 * FBP (First BanCorp PR) are DISTINCT companies (different NI) — both kept.
 *
 * Run modes (mirror classify-energy):
 *   node scripts/classify-banks.js            -> report count + marquee + foreign-control check (dry-run)
 *   node scripts/classify-banks.js --emit      -> print {classifications:[...]} JSON to stdout
 *   node scripts/classify-banks.js --merge      -> merge financials_banks entries into outputs/court-buckets.json
 *
 * Verified target (recomputed live 2026-06-23): financials_banks 128; all 7 marquees classify (JPM/PNC/USB/MTB/EWBC/
 * CFR/FITB); the foreign megabank ADRs (RY/TD/SAN/UBS/MUFG/SMFG/MFG/IBN/ITUB/NU/NWG/BSBR/KB/SHG/WF/BMA) all DROP.
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

// --- COUNTRY-DOMICILE-GUARD US-listing test (mirrors classify-energy isUSListing) ---
const US_EXCH = new Set(['NYSE', 'NasdaqGS', 'NasdaqGM', 'NasdaqCM', 'NYSEArca', 'NYSE American', 'Nasdaq', 'Cboe US', 'US']);
const OTC_EXCH = new Set(['OTC Markets OTCPK', 'OTC Markets OTCQX', 'OTC Markets OTCQB', 'Other OTC', 'Pink Sheets']);
const FOREIGN_SUFFIX = /\.(HK|SW|TO|L|PA|DE|F|MI|AS|ST|HE|CO|OL|VI|SI|TW|KS|KQ|SS|SZ|T|MX|SA|BR|WA|IR|LS|MC|BK|JK)$/i;
// Foreign legal-form suffix in the company NAME — catches undefined-country foreign bank primaries (Banco Santander
// S.A., NatWest plc, ICICI Bank Limited, UBS Group AG, ...). Anchored on word boundaries so US "Inc."/"Corp."/
// "Company"/"Co."/"Group"/"Holdings"/"Bancorp"/"Bancshares" never match (mirrors classify-energy/materials). NOTE: US
// bank names overwhelmingly end in Corporation/Bancorp/Bancshares/Inc. — none of which the regex matches.
const FOREIGN_NAME = /\b(P\.?L\.?C\.?|S\.?A\.?B\.?\s+de\s+C\.?V\.?|S\.?A\.?\b|N\.?V\.?|OYJ|ASA|S\.?p\.?A\.?|\bSE\b|\bAG\b|Bhd|Berhad|PJSC|O[AP]O|Limited|Ltd)\b/i;
// Frozen foreign-MEGABANK-ADR DENY set (the court's mandated minimum, revision #1). Country-undefined foreign primaries
// whose US-listed ADR shares country=undefined with the legitimate US banks. Several are ALSO caught by FOREIGN_NAME
// (S.A./plc/AG/Limited) — listed here explicitly as the court-named positive-control DENY set so a regex regression
// cannot silently re-admit them. Each verified foreign-domiciled. Expand ONLY with a verified foreign-primary name.
const BANK_FOREIGN_DROP = new Set([
  'IBN', 'ITUB', 'BSBR', 'BMA', 'KB', 'SHG', 'WF', 'MFG', 'MUFG', 'SMFG', 'RY', 'TD', 'SAN', 'UBS', 'NWG', 'NU',
]);
// Name-verified US-PRIMARY inversion allowlist (empty for banks — no US-primary bank carries a foreign legal-form name
// that the FOREIGN_NAME guard would wrongly drop; kept for structural parity with classify-energy/materials so the
// mechanism is present if a future verified US-primary foreign-NAME bank appears). Expand ONLY with a verified name.
const US_PRIMARY_ALLOWLIST = new Set([]);

function isUSListing(m, ticker, companyName) {
  if (FOREIGN_SUFFIX.test(ticker)) return false;                              // .L/.TO/.SZ … foreign-suffix tickers
  if (OTC_EXCH.has(m.region) || OTC_EXCH.has(m.exchangeName)) return false;   // pink-sheet ADR dual-listings (HBCYF…)
  if (US_PRIMARY_ALLOWLIST.has(ticker)) return true;                          // explicit US-primary override (before guards)
  if (BANK_FOREIGN_DROP.has(ticker)) return false;                            // frozen foreign-megabank-ADR DENY (killshot)
  const ccy = m.reportingCurrency;
  if (m.country != null) {                                                    // country SET -> authoritative
    return m.country === 'United States';                                     // SET && != US -> EXCLUDE, no exceptions
  }
  // country undefined -> POSITIVE US-primary test: US exchange + USD + NO foreign legal-form name (admits JPM/PNC/USB/MTB)
  if (FOREIGN_NAME.test(companyName || '')) return false;
  if (US_EXCH.has(m.region) && (ccy === 'USD' || ccy == null)) return true;
  return false;
}

// --- cohort set — deterministic pure function of meta.industry ---
const BANK_INDUSTRY = new Set(['Banks - Regional', 'Banks - Diversified']);
// Dedupe drop-set: preferred-share / dual-class / legacy-ticker duplicates that pass the country-SET=US test but are
// not the liquid primary. KEY-PK (KeyCorp preferred; keep KEY), WFC-PC (Wells Fargo preferred; keep WFC), FCNCB (First
// Citizens Class-B; keep FCNCA), BK (legacy Bank of New York Mellon; keep BNY the rebranded primary). FBNC/FBP are
// distinct companies — NOT deduped.
const BANK_DEDUPE_DROP = new Set(['KEY-PK', 'WFC-PC', 'FCNCB', 'BK']);
// Marquee watchlist (frozen): the design's named flagships that MUST each classify, else the universe silently
// collapsed (the country-vintage-collapse regression guard the court demanded). Diversified (JPM) + Regional.
const BANK_MARQUEE = Object.freeze(['JPM', 'PNC', 'USB', 'MTB', 'EWBC', 'CFR', 'FITB']);
// Positive-control: the foreign-megabank-ADR leak the de-ADR hardening must keep OUT. Catches a regression that drops
// a guard (country-domicile / FOREIGN_NAME / BANK_FOREIGN_DROP). HDB/BBD/NTB/CKHGF are caught by the country-set rule.
const BANK_FOREIGN_CONTROL = Object.freeze(['IBN', 'ITUB', 'BSBR', 'BMA', 'KB', 'SHG', 'WF', 'MFG', 'MUFG', 'SMFG',
  'RY', 'TD', 'SAN', 'UBS', 'NWG', 'NU', 'HSBC', 'BBVA', 'BMO', 'BNS', 'ING', 'BCS', 'LYG', 'HDB', 'BBD', 'NTB']);

function classifyBank(rec) {
  const m = rec.meta || {};
  const t = m.ticker;
  const nm = m.name || m.shortName || m.longName || '';
  if (BANK_DEDUPE_DROP.has(t)) return null;                      // preferred/dual-class dedupe -> not classified
  if (m.sector !== 'Financial Services') return null;            // Yahoo label for GICS Financials
  if (!BANK_INDUSTRY.has(m.industry)) return null;               // only the deposit-funded bank tier
  if (!isUSListing(m, t, nm)) return null;                       // de-ADR country-domicile guard + FOREIGN hardening
  const mc = num(rec.marketCap);
  if (mc == null || mc < 1e9) return null;                       // $1B size earmark (num(), not naive >=)
  return 'financials_banks';
}

function run() {
  if (!fs.existsSync(SNAP_DIR)) { console.error('snapshots/ missing — run a pull first'); process.exit(1); }
  const files = fs.readdirSync(SNAP_DIR).filter(f => f.endsWith('.json') && !/\./.test(f.replace(/\.json$/, '')));
  const classifications = [];
  const byTicker = {};
  let scanned = 0, finSector = 0;
  for (const f of files) {
    let rec;
    try { rec = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); } catch { continue; }
    scanned++;
    if (rec.meta && rec.meta.sector === 'Financial Services') finSector++;
    const bucket = classifyBank(rec);
    if (bucket) {
      const t = rec.meta.ticker;
      classifications.push({ t, bucket, confidence: 1.0 });
      byTicker[t] = bucket;
    }
  }
  return { classifications, byTicker, scanned, finSector };
}

const BANK_BUCKETS = new Set(['financials_banks']);
const r = run();
const banks = r.classifications.filter(c => c.bucket === 'financials_banks');
const missingMarquee = BANK_MARQUEE.filter(t => !BANK_BUCKETS.has(r.byTicker[t]));
const leakedControl = BANK_FOREIGN_CONTROL.filter(t => BANK_BUCKETS.has(r.byTicker[t]));

const arg = process.argv[2];
if (arg === '--emit') {
  process.stdout.write(JSON.stringify({ classifications: r.classifications }, null, 2));
} else if (arg === '--merge') {
  if (missingMarquee.length) { console.error('MARQUEE FAIL, refusing to merge: ' + missingMarquee.join(', ')); process.exit(1); }
  if (leakedControl.length) { console.error('FOREIGN-CONTROL FAIL, refusing to merge: ' + leakedControl.join(', ')); process.exit(1); }
  let buck = { classifications: [] };
  try { buck = JSON.parse(fs.readFileSync(BUCK, 'utf8')); } catch {}
  const arr = Array.isArray(buck.classifications) ? buck.classifications : (Array.isArray(buck) ? buck : []);
  const kept = arr.filter(c => !BANK_BUCKETS.has(c.bucket));
  const out = Array.isArray(buck) ? kept.concat(r.classifications) : Object.assign({}, buck, { classifications: kept.concat(r.classifications) });
  fs.writeFileSync(BUCK, JSON.stringify(out, null, 2));
  console.log(`merged ${r.classifications.length} financials_banks entries into court-buckets.json`);
} else {
  console.log(`scanned ${r.scanned} snapshots; ${r.finSector} meta.sector==="Financial Services"`);
  console.log(`classified: financials_banks ${banks.length}`);
  console.log(`marquee coverage (${BANK_MARQUEE.length}): ${missingMarquee.length ? 'FAIL missing ' + missingMarquee.join(',') : 'PASS all classified'}`);
  console.log(`foreign-control (IBN/MUFG/RY/TD/SAN/.../NTB must NOT classify): ${leakedControl.length ? 'FAIL leaked ' + leakedControl.join(',') : 'PASS all excluded'}`);
  console.log(`banks sample: ${banks.slice(0, 20).map(c => c.t).join(', ')}`);
}

module.exports = {
  classifyBank, isUSListing, num,
  BANK_INDUSTRY, BANK_DEDUPE_DROP, BANK_MARQUEE, BANK_FOREIGN_CONTROL,
  BANK_FOREIGN_DROP, US_PRIMARY_ALLOWLIST,
};
