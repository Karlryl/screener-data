#!/usr/bin/env node
'use strict';
/**
 * classify-staples.js — deterministic SI-5 classifier for the consumer_staples_compounder
 * CORE bucket (staples_branded / staples_distribution).
 *
 * Spec: Vault formula-design-consumer-staples-compounder-v1-2026-06-21.md §1.2-§1.5, §6.2.
 * Pure function of meta.sector + meta.industry + the v1 COUNTRY-DOMICILE-GUARD isUSListing test
 * (country set != US -> exclude; FOREIGN_NAME legal-form regex for undefined-country foreigners;
 * tiny name-verified residual) + num(marketCap) + the frozen dedupe/foreign-exclude/education sets.
 * No fuzzy matching, no per-ticker scoring map, no LLM.
 *
 * v1 closed the v0 FOREIGN-PRIMARY LEAK (BTI/ABEV/FMX/KOF/CCEP/MICC/AGRO/FDP/RLX) GENERALIZABLY:
 *   (1) meta.country set != "United States" -> EXCLUDE unconditionally (kills the 7 country-set foreigners);
 *   (2) FOREIGN_NAME legal-form regex over meta.name catches the undefined-country foreigners (KOF/DOLE/HLF/NOMD);
 *   (3) FOREIGN_PRIMARY_RESIDUAL = {RLX} — the sole foreign primary with a US legal-form name.
 *
 * Resolves the court-buckets.json persistence gap: court-buckets.json is gitignored / externally
 * produced, so the staples classification is regenerated reproducibly by THIS committed script. Run modes:
 *   node scripts/classify-staples.js            -> report counts + marquee + foreign-control check (dry-run)
 *   node scripts/classify-staples.js --emit      -> print {classifications:[...]} JSON to stdout
 *   node scripts/classify-staples.js --merge      -> merge staples entries into outputs/court-buckets.json
 *
 * Verified target (design, recomputed live 2026-06-21): branded 52 / distribution 23; all 9 marquees
 * classified (PG/KO/PEP/MO/PM/MDLZ/CL branded; COST/WMT distribution); 13 education hard-excluded;
 * all 9 leakers + the 5 foreign-control names (KOF/RLX/DOLE/HLF/NOMD) DROP; dedupe applied.
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

// --- v1 COUNTRY-DOMICILE-GUARD US-listing test (§1.2 / §6.2) ---
const US_EXCH = new Set(['NYSE', 'NasdaqGS', 'NasdaqGM', 'NasdaqCM', 'NYSEArca', 'NYSE American', 'Nasdaq', 'Cboe US', 'US']);
const OTC_EXCH = new Set(['OTC Markets OTCPK', 'OTC Markets OTCQX', 'OTC Markets OTCQB', 'Other OTC', 'Pink Sheets']);
const FOREIGN_SUFFIX = /\.(HK|SW|TO|L|PA|DE|F|MI|AS|ST|HE|CO|OL|VI|SI|TW|KS|KQ|SS|SZ|T|MX|SA|BR|WA|IR|LS|MC|BK|JK)$/i;
// Foreign legal-form suffix in the company NAME — catches undefined-country foreign primaries
// (KOF "S.A.B. de C.V.", DOLE "plc", HLF "Ltd.", NOMD "Limited", UL "PLC"). Anchored on word
// boundaries so US "Inc."/"Corp."/"Company"/"Co."/"Holdings" never match (verified ZERO false
// positives across all 52 branded + 23 distribution US names this session, §1.2/§7-#4).
const FOREIGN_NAME = /\b(P\.?L\.?C\.?|S\.?A\.?B\.?\s+de\s+C\.?V\.?|S\.?A\.?\b|N\.?V\.?|OYJ|ASA|S\.?p\.?A\.?|Bhd|Berhad|PJSC|O[AP]O|Limited|Ltd)\b/i;
// TINY, name-verified residual: foreign primaries whose NAME uses a US legal form (so neither the
// country rule nor FOREIGN_NAME catches them). Expand ONLY with a verified name.
const FOREIGN_PRIMARY_RESIDUAL = new Set(['RLX']); // RLX Technology Inc. — China vaping op-co, Cayman holdco
// Name-verified US-primary inversion allowlist (genuine US-domiciled names a guard would wrongly drop).
// VERIFIED EMPTY for staples (no US-domiciled staple is mis-tagged foreign); kept as the documented hook.
const US_PRIMARY_ALLOWLIST = new Set([]);

function isUSListing(m, ticker, companyName) {
  if (FOREIGN_SUFFIX.test(ticker)) return false;                              // .HK/.SW/.L/.PA/.SZ …
  if (OTC_EXCH.has(m.region) || OTC_EXCH.has(m.exchangeName)) return false;   // pink-sheet ADRs
  if (US_PRIMARY_ALLOWLIST.has(ticker)) return true;                          // explicit US-primary override
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

// --- cohort sets (§1.4) + dedupe / foreign-exclude / education (§1.1/§1.5/§6.2) ---
const STAPLES_BRANDED = new Set(['Packaged Foods', 'Household & Personal Products',
  'Beverages - Non-Alcoholic', 'Beverages - Brewers', 'Tobacco', 'Confectioners',
  'Beverages - Wineries & Distilleries']);
const STAPLES_DISTRIBUTION = new Set(['Discount Stores', 'Food Distribution', 'Grocery Stores', 'Farm Products']);
const STAPLES_EXCLUDE_IND = new Set(['Education & Training Services']);
const STAPLES_FOREIGN_EXCLUDE = new Set(['BUD', 'DEO', 'UL', 'UN']);          // belt-and-suspenders; §1.2 now also catches these
const STAPLES_DEDUPE_DROP = new Set(['BF-A', 'CENTA', 'MKC-V', 'TAP-A', 'BUD', 'DEO', 'UL', 'UN']); // keep liquid primary
const STAPLES_MARQUEE = Object.freeze(['PG', 'KO', 'PEP', 'COST', 'WMT', 'MDLZ', 'CL', 'MO', 'PM']);
const STAPLES_FOREIGN_CONTROL = Object.freeze(['KOF', 'RLX', 'DOLE', 'HLF', 'NOMD']); // positive-control: MUST NOT classify

function classifyStaples(rec) {
  const m = rec.meta || {};
  const t = m.ticker;
  const nm = m.name || m.shortName || m.longName || '';
  if (STAPLES_DEDUPE_DROP.has(t) || STAPLES_FOREIGN_EXCLUDE.has(t)) return null; // excluded[]
  if (m.sector !== 'Consumer Defensive') return null;
  if (!isUSListing(m, t, nm)) return null;                  // v1 country-domicile guard
  const mc = num(rec.marketCap);
  if (mc == null || mc < 1e9) return null;
  if (STAPLES_EXCLUDE_IND.has(m.industry)) return null;     // education etc. -> excluded[]
  if (STAPLES_BRANDED.has(m.industry)) return 'staples_branded';
  if (STAPLES_DISTRIBUTION.has(m.industry)) return 'staples_distribution';
  return null;                                              // unknown industry -> SI-4 null+excluded[]
}

function run() {
  if (!fs.existsSync(SNAP_DIR)) { console.error('snapshots/ missing — run a pull first'); process.exit(1); }
  const files = fs.readdirSync(SNAP_DIR).filter(f => f.endsWith('.json') && !/\./.test(f.replace(/\.json$/, '')));
  const classifications = [];
  const byTicker = {};
  let scanned = 0, staplesSector = 0;
  for (const f of files) {
    let rec;
    try { rec = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); } catch { continue; }
    scanned++;
    if (rec.meta && rec.meta.sector === 'Consumer Defensive') staplesSector++;
    const bucket = classifyStaples(rec);
    if (bucket) {
      const t = rec.meta.ticker;
      classifications.push({ t, bucket, confidence: 1.0 });
      byTicker[t] = bucket;
    }
  }
  return { classifications, byTicker, scanned, staplesSector };
}

const r = run();
const branded = r.classifications.filter(c => c.bucket === 'staples_branded');
const distribution = r.classifications.filter(c => c.bucket === 'staples_distribution');
const missingMarquee = STAPLES_MARQUEE.filter(t => !(r.byTicker[t] === 'staples_branded' || r.byTicker[t] === 'staples_distribution'));
const leakedControl = STAPLES_FOREIGN_CONTROL.filter(t => r.byTicker[t] === 'staples_branded' || r.byTicker[t] === 'staples_distribution');

const arg = process.argv[2];
if (arg === '--emit') {
  process.stdout.write(JSON.stringify({ classifications: r.classifications }, null, 2));
} else if (arg === '--merge') {
  if (missingMarquee.length) { console.error('MARQUEE FAIL, refusing to merge: ' + missingMarquee.join(', ')); process.exit(1); }
  if (leakedControl.length) { console.error('FOREIGN-CONTROL FAIL, refusing to merge: ' + leakedControl.join(', ')); process.exit(1); }
  let buck = { classifications: [] };
  try { buck = JSON.parse(fs.readFileSync(BUCK, 'utf8')); } catch {}
  const arr = Array.isArray(buck.classifications) ? buck.classifications : (Array.isArray(buck) ? buck : []);
  const kept = arr.filter(c => c.bucket !== 'staples_branded' && c.bucket !== 'staples_distribution');
  const out = Array.isArray(buck) ? kept.concat(r.classifications) : Object.assign({}, buck, { classifications: kept.concat(r.classifications) });
  fs.writeFileSync(BUCK, JSON.stringify(out, null, 2));
  console.log(`merged ${r.classifications.length} staples entries into court-buckets.json (branded ${branded.length} / distribution ${distribution.length})`);
} else {
  console.log(`scanned ${r.scanned} snapshots; ${r.staplesSector} meta.sector==="Consumer Defensive"`);
  console.log(`classified: staples_branded ${branded.length} | staples_distribution ${distribution.length} | total ${r.classifications.length}`);
  console.log(`marquee coverage (9): ${missingMarquee.length ? 'FAIL missing ' + missingMarquee.join(',') : 'PASS all classified'}`);
  console.log(`foreign-control (KOF/RLX/DOLE/HLF/NOMD must NOT classify): ${leakedControl.length ? 'FAIL leaked ' + leakedControl.join(',') : 'PASS all excluded'}`);
  console.log(`branded sample: ${branded.slice(0, 10).map(c => c.t).join(', ')}`);
  console.log(`distribution sample: ${distribution.slice(0, 10).map(c => c.t).join(', ')}`);
}

module.exports = {
  classifyStaples, isUSListing, num,
  STAPLES_BRANDED, STAPLES_DISTRIBUTION, STAPLES_EXCLUDE_IND, STAPLES_FOREIGN_EXCLUDE,
  STAPLES_DEDUPE_DROP, STAPLES_MARQUEE, STAPLES_FOREIGN_CONTROL,
};
