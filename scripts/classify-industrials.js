#!/usr/bin/env node
'use strict';
/**
 * classify-industrials.js — deterministic SI-5 classifier for the industrials_compounder
 * CORE bucket (industrials_heavy / industrials_light).
 *
 * Spec: Vault formula-design-industrials-compounder-v1-2026-06-21.md §1.2-§1.4, §6.2.
 * Pure function of meta.sector + meta.industry + the vintage-tolerant isUSListing test +
 * num(marketCap) + the frozen dedupe set. No fuzzy matching, no per-ticker map, no LLM.
 *
 * Resolves the court-buckets.json persistence gap: court-buckets.json is gitignored /
 * externally produced, so the industrials classification is regenerated reproducibly by
 * THIS committed script. Run modes:
 *   node scripts/classify-industrials.js            -> report counts + marquee check (dry-run)
 *   node scripts/classify-industrials.js --emit     -> print {classifications:[...]} JSON to stdout
 *   node scripts/classify-industrials.js --merge     -> merge industrials entries into outputs/court-buckets.json
 *
 * Verified target (design, recomputed live 2026-06-21): heavy 165 / light 141; all 16
 * marquees classified; dedupe applied; residual ZTO leak (1/141, MAD-robust) disclosed.
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

// --- vintage-tolerant US-listing test (§1.2 / §6.2) ---
const US_EXCH = new Set(['NYSE', 'NasdaqGS', 'NasdaqGM', 'NasdaqCM', 'NYSEArca', 'NYSE American', 'Nasdaq', 'Cboe US', 'US']);
const OTC_EXCH = new Set(['OTC Markets OTCPK', 'OTC Markets OTCQX', 'OTC Markets OTCQB', 'Other OTC', 'Pink Sheets']);
const FOREIGN_SUFFIX = /\.(HK|SW|TO|L|PA|DE|F|MI|AS|ST|HE|CO|OL|VI|SI|TW|KS|KQ|SS|SZ|T|MX|SA|BR|WA|IR|LS|MC|BK|JK)$/i;

function isUSListing(m, ticker) {
  if (FOREIGN_SUFFIX.test(ticker)) return false;
  if (OTC_EXCH.has(m.region) || OTC_EXCH.has(m.exchangeName)) return false;
  const ccy = m.reportingCurrency;
  if (m.country != null) {
    if (m.country === 'United States') return true;
    if ((US_EXCH.has(m.region) || US_EXCH.has(m.exchangeName)) && ccy === 'USD') return true;
    return false;
  }
  if (US_EXCH.has(m.region) && (ccy === 'USD' || ccy == null)) return true;
  return false;
}

// --- cohort sets (§1.3) + dedupe (§1.4) ---
const IND_HEAVY = new Set(['Specialty Industrial Machinery', 'Aerospace & Defense',
  'Electrical Equipment & Parts', 'Building Products & Equipment',
  'Farm & Heavy Construction Machinery', 'Tools & Accessories', 'Metal Fabrication',
  'Pollution & Treatment Controls', 'Business Equipment & Supplies']);
const IND_LIGHT = new Set(['Engineering & Construction', 'Specialty Business Services',
  'Railroads', 'Integrated Freight & Logistics', 'Trucking', 'Waste Management',
  'Security & Protection Services', 'Consulting Services', 'Industrial Distribution',
  'Rental & Leasing Services', 'Staffing & Employment Services']);
const IND_DEDUPE_DROP = new Set(['GFL.TO', 'HEI-A', 'MOG-B', 'UHAL-B', 'WSO-B', 'FDXF', 'EMBJ']);
const INDUSTRIALS_MARQUEE = Object.freeze(['RTX', 'LMT', 'NOC', 'UNP', 'NSC', 'WM', 'RSG', 'ITW', 'PH', 'ETN', 'GD', 'EMR', 'CAT', 'DE', 'BA', 'GE']);

function classifyIndustrials(rec) {
  const m = rec.meta || {};
  const t = m.ticker;
  if (IND_DEDUPE_DROP.has(t)) return null;
  if (m.sector !== 'Industrials') return null;
  if (!isUSListing(m, t)) return null;
  const mc = num(rec.marketCap);
  if (mc == null || mc < 1e9) return null;
  if (IND_HEAVY.has(m.industry)) return 'industrials_heavy';
  if (IND_LIGHT.has(m.industry)) return 'industrials_light';
  return null; // excluded industry -> SI-4 (handled at scoring)
}

function run() {
  if (!fs.existsSync(SNAP_DIR)) { console.error('snapshots/ missing — run a pull first'); process.exit(1); }
  const files = fs.readdirSync(SNAP_DIR).filter(f => f.endsWith('.json') && !/\./.test(f.replace(/\.json$/, '')));
  const classifications = [];
  const byTicker = {};
  let scanned = 0, industrialsSector = 0;
  for (const f of files) {
    let rec;
    try { rec = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); } catch { continue; }
    scanned++;
    if (rec.meta && rec.meta.sector === 'Industrials') industrialsSector++;
    const bucket = classifyIndustrials(rec);
    if (bucket) {
      const t = rec.meta.ticker;
      classifications.push({ t, bucket, confidence: 1.0 });
      byTicker[t] = bucket;
    }
  }
  return { classifications, byTicker, scanned, industrialsSector };
}

const r = run();
const heavy = r.classifications.filter(c => c.bucket === 'industrials_heavy');
const light = r.classifications.filter(c => c.bucket === 'industrials_light');
const missingMarquee = INDUSTRIALS_MARQUEE.filter(t => !(r.byTicker[t] === 'industrials_heavy' || r.byTicker[t] === 'industrials_light'));

const arg = process.argv[2];
if (arg === '--emit') {
  process.stdout.write(JSON.stringify({ classifications: r.classifications }, null, 2));
} else if (arg === '--merge') {
  if (missingMarquee.length) { console.error('MARQUEE FAIL, refusing to merge: ' + missingMarquee.join(', ')); process.exit(1); }
  let buck = { classifications: [] };
  try { buck = JSON.parse(fs.readFileSync(BUCK, 'utf8')); } catch {}
  const arr = Array.isArray(buck.classifications) ? buck.classifications : [];
  const kept = arr.filter(c => c.bucket !== 'industrials_heavy' && c.bucket !== 'industrials_light');
  buck.classifications = kept.concat(r.classifications);
  fs.writeFileSync(BUCK, JSON.stringify(buck, null, 2));
  console.log(`merged ${r.classifications.length} industrials entries into court-buckets.json (heavy ${heavy.length} / light ${light.length})`);
} else {
  console.log(`scanned ${r.scanned} snapshots; ${r.industrialsSector} meta.sector==="Industrials"`);
  console.log(`classified: industrials_heavy ${heavy.length} | industrials_light ${light.length} | total ${r.classifications.length}`);
  console.log(`marquee coverage (16): ${missingMarquee.length ? 'FAIL missing ' + missingMarquee.join(',') : 'PASS all classified'}`);
  console.log(`heavy sample: ${heavy.slice(0, 8).map(c => c.t).join(', ')}`);
  console.log(`light sample: ${light.slice(0, 8).map(c => c.t).join(', ')}`);
  console.log(`ZTO (disclosed residual leak) bucket: ${r.byTicker['ZTO'] || '(not present)'}`);
}

module.exports = { classifyIndustrials, isUSListing, num, IND_HEAVY, IND_LIGHT, IND_DEDUPE_DROP, INDUSTRIALS_MARQUEE };
