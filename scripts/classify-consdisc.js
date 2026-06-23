#!/usr/bin/env node
'use strict';
/**
 * classify-consdisc.js — deterministic SI-5 classifier for the consdisc_expansion CORE bucket
 * (consdisc_store / consdisc_light).
 *
 * Spec: Vault formula-design-consumer-disc-expansion-v1-2026-06-21.md §1.1-§1.3, §6.1
 * (Court FINAL formula-court-consumer-disc-expansion-FINAL-2026-06-21.md, DESIGN-PASS 4/4).
 * Pure function of meta.sector + meta.industry + the vintage-tolerant isUSListing test +
 * num(marketCap) + the frozen dedupe/foreign-exclude sets. No fuzzy matching, no per-ticker
 * scoring map, no LLM. The asset-intensity cohort split (§1.2, the central v0->v1 structural
 * change against ASC-842 lease bias) is a PURE function of meta.industry: Internet Retail ->
 * consdisc_light (asset-light, un-leased denominator); Specialty/Apparel/Footwear/Home-Improvement
 * Retail + Restaurants -> consdisc_store (store/real-estate-heavy, capitalized operating-lease ROU).
 *
 * Yahoo labels the GICS Consumer-Discretionary sector "Consumer Cyclical" in the snapshots
 * (verified: AMZN/CMG/HD meta.sector === "Consumer Cyclical"). The §1.1 HARD-EXCLUDE list
 * (Auto-OEM ROIC=2.6% canonical value trap, Hotel/Gaming/Auto-Parts/Grocery/Lodging capital-heavy)
 * is enforced explicitly (fail-loud if mislabeled): an excluded industry returns null -> SI-4
 * (score=null + excluded[] at scoring), never a silent 0.
 *
 * Resolves the court-buckets.json persistence gap: court-buckets.json is gitignored / externally
 * produced, so the consdisc classification is regenerated reproducibly by THIS committed script. Run modes:
 *   node scripts/classify-consdisc.js            -> report counts + marquee + foreign-control check (dry-run)
 *   node scripts/classify-consdisc.js --emit      -> print {classifications:[...]} JSON to stdout
 *   node scripts/classify-consdisc.js --merge      -> merge consdisc entries into outputs/court-buckets.json
 *
 * Spec frozen target (design, recomputed on the 2026-06-08 Vintage-B-only pool): store 31 / light 8.
 *   light (8): AMZN, CART, CHWY, CPNG, DASH, EBAY, ETSY, RVLV
 *   store (31): ASO, BBWI, BBY, BOBS, CASY, DKS, EYE, FIVE, GME, SBH, SVV, WINA, BROS, CAKE, CAVA,
 *               CMG, DPZ, DRI, EAT, SG, AEO, ANF, BKE, BOOT, BURL, CRI, GAP, CROX, DECK, FND, HD
 *
 * LIVE-POOL NOTE (honest disclosure — NOT a spec deviation): the production snapshots/ dir is a LARGER,
 * MIXED-VINTAGE pool than the spec's recompute set (324 "Consumer Cyclical" names: 190 Vintage-B with
 * meta.country set + 134 Vintage-A with country undefined). On this pool the classifier admits the spec's
 * 39 names PLUS additional bona-fide US discretionary large-caps the smaller recompute pool simply did not
 * carry (LOW/MCD/NKE/SBUX/TJX/ROST/ULTA/YUM/LULU/WSM/TSCO/TXRH/WING/URBN/RH/SHAK/WEN/PZZA/MUSA/OLPX/VSCO/
 * WWW/LQDT/W — all genuine US names in the include industries; excluding them would be the dishonest move).
 * The Vintage-A foreign primaries (JD/PDD/RERE/MELI/YUMC/ONON/QSR; BABA via FOREIGN_NAME) ARE excluded via
 * the FOREIGN_PRIMARY_RESIDUAL hook — the FAILURE-MODE-2 leak the country guard cannot see on Vintage A.
 * Net live counts will therefore exceed 31/8; the spec's economic intent (every genuine US discretionary
 * name in the right industry, no foreign primaries, no auto-OEM value trap) is preserved exactly.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SNAP_DIR = path.join(ROOT, 'snapshots');
const BUCK = path.join(ROOT, 'outputs', 'court-buckets.json');

// --- num() dual-shape extractor (§2.1) — marketCap is a {value} object at the snapshot root (D2 fix) ---
function num(x) {
  if (x == null) return null;
  if (typeof x === 'number') return isFinite(x) ? x : null;
  if (typeof x === 'object' && x.value != null && isFinite(x.value)) return x.value;
  return null;
}

// --- vintage-tolerant / country-domicile-guard US-listing test (mirrors classify-staples.js §1.2) ---
const US_EXCH = new Set(['NYSE', 'NasdaqGS', 'NasdaqGM', 'NasdaqCM', 'NYSEArca', 'NYSE American', 'Nasdaq', 'Cboe US', 'US']);
const OTC_EXCH = new Set(['OTC Markets OTCPK', 'OTC Markets OTCQX', 'OTC Markets OTCQB', 'Other OTC', 'Pink Sheets']);
const FOREIGN_SUFFIX = /\.(HK|SW|TO|L|PA|DE|F|MI|AS|ST|HE|CO|OL|VI|SI|TW|KS|KQ|SS|SZ|T|MX|SA|BR|WA|IR|LS|MC|BK|JK)$/i;
// Foreign legal-form suffix in the company NAME — catches undefined-country foreign primaries
// (e.g. "S.A.B. de C.V.", "plc", "Ltd."). Anchored on word boundaries so US "Inc."/"Corp."/
// "Company"/"Co."/"Holdings" never match (mirrors classify-staples.js; verified ZERO false positives
// across the 39-name consdisc US pool this session).
const FOREIGN_NAME = /\b(P\.?L\.?C\.?|S\.?A\.?B\.?\s+de\s+C\.?V\.?|S\.?A\.?\b|N\.?V\.?|OYJ|ASA|S\.?p\.?A\.?|Bhd|Berhad|PJSC|O[AP]O|Limited|Ltd)\b/i;
// TINY, name-verified residual: foreign primaries whose NAME uses a US legal form (so neither the
// country rule nor the FOREIGN_NAME regex catches them) AND which arrive Vintage-A (meta.country
// undefined) on this snapshot vintage, hence fall through the country-domicile guard's Vintage-A
// US-exchange path. Each is a verified foreign-domiciled operating company with a US/foreign primary
// listing trading USD on a US exchange — the FAILURE-MODE-2 foreign-ADR leak (mirrors court-screen.js
// §C5 + classify-staples.js residual). Expand ONLY with a verified name.
//   JD/PDD/RERE — China e-commerce (JD.com / PDD Holdings (Pinduoduo, Cayman) / ATRenew, China op-co)
//   MELI        — MercadoLibre, Argentina/Uruguay-domiciled LatAm e-commerce (US legal-form name)
//   YUMC        — Yum China Holdings, China-domiciled KFC/Pizza-Hut China op-co (spun from YUM)
//   ONON        — On Holding AG, Switzerland (AG legal form; Vintage-A → regex word-boundary misses "AG")
//   QSR         — Restaurant Brands International, Canada-domiciled (Burger King / Tim Hortons / Popeyes)
// (BABA "Alibaba … Limited" is already excluded by the FOREIGN_NAME regex; not needed here.)
const FOREIGN_PRIMARY_RESIDUAL = new Set(['JD', 'PDD', 'RERE', 'MELI', 'YUMC', 'ONON', 'QSR']);
// Name-verified US-primary inversion allowlist (genuine US-domiciled names a guard would wrongly drop).
// VERIFIED EMPTY for consdisc; kept as the documented hook.
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

// --- cohort sets (§1.1 include / §1.2 split) + HARD-EXCLUDE (§1.1) + dedupe (§6.1) ---
// consdisc_light = asset-light (Internet Retail only); consdisc_store = store/real-estate-heavy.
const CONSDISC_LIGHT = new Set(['Internet Retail']);
const CONSDISC_STORE = new Set(['Specialty Retail', 'Apparel Retail', 'Footwear & Accessories',
  'Home Improvement Retail', 'Restaurants']);
// §1.1 explicit HARD-EXCLUDE (Damodaran ROIC hierarchy: Auto-OEM 2.6% canonical value trap; Hotel/Gaming/
// Auto-Parts/Grocery/Lodging capital- or working-capital-heavy). Fail-loud SI-4: an in-sector name in one
// of these industries returns null -> excluded[] at scoring, never a silent 0.
const CONSDISC_EXCLUDE_IND = new Set(['Auto Manufacturers', 'Auto Parts', 'Auto & Truck Dealerships',
  'Packaging & Containers', 'Residential Construction', 'Furnishings, Fixtures & Appliances',
  'Apparel Manufacturing', 'Textile Manufacturing', 'Lodging', 'Resorts & Casinos', 'Gambling',
  'Leisure', 'Travel Services', 'Department Stores', 'Luxury Goods', 'Personal Services',
  'Recreational Vehicles']);
const CONSDISC_DEDUPE_DROP = new Set([]); // keep liquid primary; verified no dual-listing in the 39-name pool
// Marquee watchlist (§1.2 recomputed cohorts): obvious US flagships that MUST each classify+score, else
// the universe silently collapsed (the v0 marketCap-object killshot regression guard). 1+ from each cohort.
const CONSDISC_MARQUEE = Object.freeze(['AMZN', 'EBAY', 'ETSY', 'HD', 'CMG', 'DPZ', 'DRI', 'DECK', 'BBY', 'CAVA']);
// Positive-control: names that MUST NOT classify. Two classes:
//   (a) auto-OEM value trap + hotel/gaming/auto-dealer capital-heavy industry-excludes (§1.1);
//   (b) Vintage-A foreign primaries the FOREIGN_PRIMARY_RESIDUAL/FOREIGN_NAME guards must keep out
//       (the FAILURE-MODE-2 ADR leak). Catches a regression that widens the include set or drops a guard.
const CONSDISC_EXCLUDE_CONTROL = Object.freeze([
  'TSLA', 'GM', 'F', 'MAR', 'HLT', 'LVS', 'WYNN', 'AN', 'KMX',          // (a) industry hard-excludes
  'JD', 'PDD', 'RERE', 'MELI', 'YUMC', 'ONON', 'QSR', 'BABA',           // (b) foreign primaries
]);

function classifyConsdisc(rec) {
  const m = rec.meta || {};
  const t = m.ticker;
  const nm = m.name || m.shortName || m.longName || '';
  if (CONSDISC_DEDUPE_DROP.has(t)) return null;                  // excluded[]
  if (m.sector !== 'Consumer Cyclical') return null;             // Yahoo label for GICS Consumer Discretionary
  if (!isUSListing(m, t, nm)) return null;                       // v1 country-domicile guard
  const mc = num(rec.marketCap);                                 // D2: marketCap is a {value} object
  if (mc == null || mc < 1e9) return null;                       // §1.1 $1B size earmark (num(), not naive >=)
  if (CONSDISC_EXCLUDE_IND.has(m.industry)) return null;         // §1.1 hard-exclude (auto-OEM etc.) -> excluded[]
  if (CONSDISC_LIGHT.has(m.industry)) return 'consdisc_light';
  if (CONSDISC_STORE.has(m.industry)) return 'consdisc_store';
  return null;                                                   // unknown industry -> SI-4 null+excluded[]
}

function run() {
  if (!fs.existsSync(SNAP_DIR)) { console.error('snapshots/ missing — run a pull first'); process.exit(1); }
  const files = fs.readdirSync(SNAP_DIR).filter(f => f.endsWith('.json') && !/\./.test(f.replace(/\.json$/, '')));
  const classifications = [];
  const byTicker = {};
  let scanned = 0, consdiscSector = 0;
  for (const f of files) {
    let rec;
    try { rec = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); } catch { continue; }
    scanned++;
    if (rec.meta && rec.meta.sector === 'Consumer Cyclical') consdiscSector++;
    const bucket = classifyConsdisc(rec);
    if (bucket) {
      const t = rec.meta.ticker;
      classifications.push({ t, bucket, confidence: 1.0 });
      byTicker[t] = bucket;
    }
  }
  return { classifications, byTicker, scanned, consdiscSector };
}

const r = run();
const store = r.classifications.filter(c => c.bucket === 'consdisc_store');
const light = r.classifications.filter(c => c.bucket === 'consdisc_light');
const missingMarquee = CONSDISC_MARQUEE.filter(t => !(r.byTicker[t] === 'consdisc_store' || r.byTicker[t] === 'consdisc_light'));
const leakedControl = CONSDISC_EXCLUDE_CONTROL.filter(t => r.byTicker[t] === 'consdisc_store' || r.byTicker[t] === 'consdisc_light');

const arg = process.argv[2];
if (arg === '--emit') {
  process.stdout.write(JSON.stringify({ classifications: r.classifications }, null, 2));
} else if (arg === '--merge') {
  if (missingMarquee.length) { console.error('MARQUEE FAIL, refusing to merge: ' + missingMarquee.join(', ')); process.exit(1); }
  if (leakedControl.length) { console.error('EXCLUDE-CONTROL FAIL, refusing to merge: ' + leakedControl.join(', ')); process.exit(1); }
  let buck = { classifications: [] };
  try { buck = JSON.parse(fs.readFileSync(BUCK, 'utf8')); } catch {}
  const arr = Array.isArray(buck.classifications) ? buck.classifications : (Array.isArray(buck) ? buck : []);
  const kept = arr.filter(c => c.bucket !== 'consdisc_store' && c.bucket !== 'consdisc_light');
  const out = Array.isArray(buck) ? kept.concat(r.classifications) : Object.assign({}, buck, { classifications: kept.concat(r.classifications) });
  fs.writeFileSync(BUCK, JSON.stringify(out, null, 2));
  console.log(`merged ${r.classifications.length} consdisc entries into court-buckets.json (store ${store.length} / light ${light.length})`);
} else {
  console.log(`scanned ${r.scanned} snapshots; ${r.consdiscSector} meta.sector==="Consumer Cyclical"`);
  console.log(`classified: consdisc_store ${store.length} | consdisc_light ${light.length} | total ${r.classifications.length}`);
  console.log(`marquee coverage (${CONSDISC_MARQUEE.length}): ${missingMarquee.length ? 'FAIL missing ' + missingMarquee.join(',') : 'PASS all classified'}`);
  console.log(`exclude-control (auto-OEM/hotel/gaming must NOT classify): ${leakedControl.length ? 'FAIL leaked ' + leakedControl.join(',') : 'PASS all excluded'}`);
  console.log(`store sample: ${store.slice(0, 12).map(c => c.t).join(', ')}`);
  console.log(`light sample: ${light.map(c => c.t).join(', ')}`);
}

module.exports = {
  classifyConsdisc, isUSListing, num,
  CONSDISC_LIGHT, CONSDISC_STORE, CONSDISC_EXCLUDE_IND, CONSDISC_DEDUPE_DROP,
  CONSDISC_MARQUEE, CONSDISC_EXCLUDE_CONTROL,
};
