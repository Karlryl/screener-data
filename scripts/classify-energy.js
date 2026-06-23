#!/usr/bin/env node
'use strict';
/**
 * classify-energy.js — deterministic SI-5 classifier for the energy_quality CORE bucket
 * (energy_upstream / energy_midstream / energy_services).
 *
 * Spec: Vault formula-design-energy_quality-v0-2026-06-22.md §0, §1, §5-§6 (Council->Court DESIGN-PASS, v0,
 * NEEDS-REVISION — NORMS RECOMPUTED-LIVE-THEN-FROZEN at CORE on the clean pool). Pure function of meta.sector +
 * meta.industry + the §6 COUNTRY-DOMICILE-GUARD isUSListing test (country set != US -> exclude; FOREIGN_NAME
 * legal-form regex for undefined-country foreigners; the frozen ENERGY_FOREIGN_DROP ADR/tanker set; the
 * name-verified US_PRIMARY_ALLOWLIST for the verified US-primary foreign-NAME flagships) + num(marketCap) + the
 * cohort industry sets. No fuzzy matching, no per-ticker scoring map, no LLM. THROUGH-CYCLE QUALITY ONLY — the
 * cohorts are the deep-cyclical commodity-β tiers; the SCORE (court-score.js) never bets on commodity price.
 *
 * THREE cohorts — deterministic pure function of meta.industry (§1, SI-5; no per-ticker map):
 *   energy_upstream  : {Oil & Gas E&P, Oil & Gas Integrated} — Integrated folded into E&P (clean Integrated
 *       residual n=3 cannot stand alone; XOM/CVX Yahoo-classify as Integrated). Price-takers, highest commodity-β.
 *   energy_midstream : {Oil & Gas Midstream} — fee-based toll-road quality tier (KMI/WMB/OKE/ET/EPD/MPLX/TRGP/LNG).
 *   energy_services  : {Oil & Gas Equipment & Services, Oil & Gas Drilling} — Drilling folded into E&S (n=7,
 *       the leveraged-driller signal the cohort exposes; cannot stand alone). SLB/BKR/HAL/RIG/NBR/VAL.
 * Live CLEAN counts (recomputed 2026-06-23): upstream 32 / midstream 26 / services 27 — all n>=15 -> full ABS+REL
 * blend (β=0.6), NO thin-n regime. (services 27 classified; 2 pre-revenue NEXT/SOC SI-4-excluded in court-score.)
 *
 * EXCLUDED (§1 -> SI-4 score=null + excluded[], never 0, in court-score.js): Oil & Gas Refining & Marketing
 *   (crack-spread = pure commodity-price, no through-cycle quality signal — CRACK_SPREAD_BLIND), Thermal Coal
 *   (secular-decline commodity), Uranium (pre-cashflow commodity option), all non-US, all <$1B. Live pre-size
 *   counts on the US pool: R&M 14, Thermal Coal 4, Uranium 4 — none enters a cohort.
 *
 * THE §0 REVISION-GATE HARDENING (the v0 NEEDS-REVISION trigger, identical to the bug that DENIED industrials v0):
 * isUSListing alone LEAKS ~1/3 foreign primaries into the cohorts via a TWO-PART universe bug. Killed GENERALIZABLY:
 *   (1) meta.country set != "United States" -> EXCLUDE unconditionally (kills the ~19 country-set Vintage-B
 *       foreigners: BP/CNQ/CVE/ENB/EQNR/E/IMO + foreign tankers);
 *   (2) FOREIGN_NAME legal-form regex over meta.name catches the undefined-country (Vintage-A) foreign primaries
 *       whose name carries a foreign legal form;
 *   (3) ENERGY_FOREIGN_DROP = the frozen ADR/tanker drop-set — Vintage-A country-blind foreign primaries with
 *       EMPTY/US-form names that neither (1) nor (2) catches (SHEL/TTE/PBR/SU/OVV/VET/YPF/VIST/PBA/TRP/TS/PDS/
 *       NESR/KOS/MUR/WFRD/SDRL/GLNG + the tanker cluster NAT/TK/TNK/TRMD/TEN/VG), each verified foreign-domiciled.
 *   (4) US_PRIMARY_ALLOWLIST = {SLB} — the verified US-PRIMARY foreign-NAME flagship the design NAMES as a marquee
 *       that MUST classify (SLB = "Schlumberger Limited", NYSE-primary; its name matches FOREIGN_NAME \bLimited\b
 *       and would be wrongly dropped). Mirrors classify-materials US_PRIMARY_ALLOWLIST {CRH,LIN} — the deterministic
 *       resolution of the design's only internal tension (its marquee list vs its own FOREIGN_NAME guard). Admits
 *       ONLY this name-verified US-primary; every other plc/Ltd/S.A./foreign-country name stays excluded.
 *
 * Resolves the court-buckets.json persistence gap (gitignored / externally produced): the energy classification is
 * regenerated reproducibly by THIS committed script. Run modes:
 *   node scripts/classify-energy.js            -> report counts + marquee + foreign-control check (dry-run)
 *   node scripts/classify-energy.js --emit      -> print {classifications:[...]} JSON to stdout
 *   node scripts/classify-energy.js --merge      -> merge energy entries into outputs/court-buckets.json
 *
 * Verified target (recomputed live 2026-06-23): upstream 32 / midstream 26 / services 27; all 15 marquees classify
 * (XOM/CVX/COP/EOG/OXY/DVN upstream; EPD/ET/KMI/WMB/OKE/MPLX midstream; SLB/HAL/BKR services); the foreign primaries
 * (BP/SHEL/TTE/CNQ/ENB/EQNR/SU/PBR/TRP/NAT/TK + …) all DROP.
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

// --- §6 COUNTRY-DOMICILE-GUARD US-listing test ---
const US_EXCH = new Set(['NYSE', 'NasdaqGS', 'NasdaqGM', 'NasdaqCM', 'NYSEArca', 'NYSE American', 'Nasdaq', 'Cboe US', 'US']);
const OTC_EXCH = new Set(['OTC Markets OTCPK', 'OTC Markets OTCQX', 'OTC Markets OTCQB', 'Other OTC', 'Pink Sheets']);
const FOREIGN_SUFFIX = /\.(HK|SW|TO|L|PA|DE|F|MI|AS|ST|HE|CO|OL|VI|SI|TW|KS|KQ|SS|SZ|T|MX|SA|BR|WA|IR|LS|MC|BK|JK)$/i;
// Foreign legal-form suffix in the company NAME — catches undefined-country foreign primaries (TotalEnergies SE,
// Eni S.p.A., …). Anchored on word boundaries so US "Inc."/"Corp."/"Company"/"Co."/"Group"/"Holdings" never match
// (mirrors classify-materials/staples/consdisc). The US-primary marquee SLB ("Schlumberger Limited") that DOES
// match \bLimited\b is admitted via the US_PRIMARY_ALLOWLIST override below.
const FOREIGN_NAME = /\b(P\.?L\.?C\.?|S\.?A\.?B\.?\s+de\s+C\.?V\.?|S\.?A\.?\b|N\.?V\.?|OYJ|ASA|S\.?p\.?A\.?|SE|Bhd|Berhad|PJSC|O[AP]O|Limited|Ltd)\b/i;
// Frozen ADR / foreign-primary / tanker drop-set (§0/§5/§6). Vintage-B country-set foreigners are ALSO caught by
// the country!=US rule below; this set additionally closes the Vintage-A (country-blind) leak whose name carries
// no foreign legal form. Each verified foreign-domiciled. Expand ONLY with a verified foreign-primary name.
const ENERGY_FOREIGN_DROP = new Set([
  // country-set Vintage-B integrateds/E&P (also killed by the country!=US rule; listed for the positive-control)
  'BP', 'CNQ', 'CVE', 'ENB', 'EQNR', 'E', 'IMO',
  // Vintage-A country-blind foreign primaries (ADRs / foreign-domiciled) the name-regex can't catch
  'SHEL', 'TTE', 'PBR', 'PBR-A', 'SU', 'OVV', 'VET', 'YPF', 'VIST', 'PBA', 'TRP', 'TS', 'PDS', 'NESR', 'KOS', 'MUR',
  'WFRD', 'SDRL', 'GLNG',
  // foreign tanker cluster mis-filing into midstream
  'NAT', 'TK', 'TNK', 'TRMD', 'TEN', 'VG',
]);
// Name-verified US-PRIMARY inversion allowlist (§6): foreign-NAME flagships whose PRIMARY listing is US, which the
// design NAMES as marquees that MUST classify (so the guards above must NOT drop them):
//   SLB — Schlumberger Limited, Vintage-A (country undefined), NYSE-PRIMARY services flagship. Its name matches
//         FOREIGN_NAME (\bLimited\b) so the name-guard would wrongly drop it; the allowlist is the deterministic,
//         name-verified override (SI-5: a frozen set, not a per-ticker SCORE map). Mirrors classify-materials
//         US_PRIMARY_ALLOWLIST {CRH,LIN}. Expand ONLY with a verified US-primary name.
const US_PRIMARY_ALLOWLIST = new Set(['SLB']);

function isUSListing(m, ticker, companyName) {
  if (FOREIGN_SUFFIX.test(ticker)) return false;                              // .HK/.SW/.L/.TO/.SZ …
  if (OTC_EXCH.has(m.region) || OTC_EXCH.has(m.exchangeName)) return false;   // pink-sheet ADRs
  if (US_PRIMARY_ALLOWLIST.has(ticker)) return true;                          // explicit US-primary override (before guards)
  if (ENERGY_FOREIGN_DROP.has(ticker)) return false;                          // frozen foreign-primary/ADR/tanker kill
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
const ENERGY_UPSTREAM = new Set(['Oil & Gas E&P', 'Oil & Gas Integrated']);
const ENERGY_MIDSTREAM = new Set(['Oil & Gas Midstream']);
const ENERGY_SERVICES = new Set(['Oil & Gas Equipment & Services', 'Oil & Gas Drilling']);
const ENERGY_DEDUPE_DROP = new Set([]); // keep liquid primary; verified no dual-listing in the US pool
// Marquee watchlist (§6 frozen): the design's named flagships that MUST each classify+score, else the universe
// silently collapsed (the country-vintage-collapse regression guard). 1+ from each cohort.
const ENERGY_MARQUEE = Object.freeze(['XOM', 'CVX', 'COP', 'EOG', 'OXY', 'DVN', 'EPD', 'ET', 'KMI', 'WMB', 'OKE', 'MPLX', 'SLB', 'HAL', 'BKR']);
// Positive-control (§0/§6): the foreign-primary leak the §6 hardening must keep OUT. Catches a regression that
// drops a guard (country-domicile / FOREIGN_NAME / ENERGY_FOREIGN_DROP).
const ENERGY_FOREIGN_CONTROL = Object.freeze(['BP', 'SHEL', 'TTE', 'CNQ', 'CVE', 'ENB', 'EQNR', 'E', 'IMO',
  'SU', 'PBR', 'TRP', 'YPF', 'VET', 'NAT', 'TK', 'TNK']);

function classifyEnergy(rec) {
  const m = rec.meta || {};
  const t = m.ticker;
  const nm = m.name || m.shortName || m.longName || '';
  if (ENERGY_DEDUPE_DROP.has(t)) return null;                    // excluded[]
  if (m.sector !== 'Energy') return null;                        // Yahoo label for GICS Energy
  if (!isUSListing(m, t, nm)) return null;                       // §6 country-domicile guard + FOREIGN hardening
  const mc = num(rec.marketCap);
  if (mc == null || mc < 1e9) return null;                       // §1 $1B size earmark (num(), not naive >=)
  if (ENERGY_UPSTREAM.has(m.industry)) return 'energy_upstream';
  if (ENERGY_MIDSTREAM.has(m.industry)) return 'energy_midstream';
  if (ENERGY_SERVICES.has(m.industry)) return 'energy_services';
  return null;                                                   // R&M/Coal/Uranium/unknown -> SI-4 null+excluded[]
}

function run() {
  if (!fs.existsSync(SNAP_DIR)) { console.error('snapshots/ missing — run a pull first'); process.exit(1); }
  const files = fs.readdirSync(SNAP_DIR).filter(f => f.endsWith('.json') && !/\./.test(f.replace(/\.json$/, '')));
  const classifications = [];
  const byTicker = {};
  let scanned = 0, energySector = 0;
  for (const f of files) {
    let rec;
    try { rec = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); } catch { continue; }
    scanned++;
    if (rec.meta && rec.meta.sector === 'Energy') energySector++;
    const bucket = classifyEnergy(rec);
    if (bucket) {
      const t = rec.meta.ticker;
      classifications.push({ t, bucket, confidence: 1.0 });
      byTicker[t] = bucket;
    }
  }
  return { classifications, byTicker, scanned, energySector };
}

const ENERGY_BUCKETS = new Set(['energy_upstream', 'energy_midstream', 'energy_services']);
const r = run();
const up = r.classifications.filter(c => c.bucket === 'energy_upstream');
const mid = r.classifications.filter(c => c.bucket === 'energy_midstream');
const svc = r.classifications.filter(c => c.bucket === 'energy_services');
const missingMarquee = ENERGY_MARQUEE.filter(t => !ENERGY_BUCKETS.has(r.byTicker[t]));
const leakedControl = ENERGY_FOREIGN_CONTROL.filter(t => ENERGY_BUCKETS.has(r.byTicker[t]));

const arg = process.argv[2];
if (arg === '--emit') {
  process.stdout.write(JSON.stringify({ classifications: r.classifications }, null, 2));
} else if (arg === '--merge') {
  if (missingMarquee.length) { console.error('MARQUEE FAIL, refusing to merge: ' + missingMarquee.join(', ')); process.exit(1); }
  if (leakedControl.length) { console.error('FOREIGN-CONTROL FAIL, refusing to merge: ' + leakedControl.join(', ')); process.exit(1); }
  let buck = { classifications: [] };
  try { buck = JSON.parse(fs.readFileSync(BUCK, 'utf8')); } catch {}
  const arr = Array.isArray(buck.classifications) ? buck.classifications : (Array.isArray(buck) ? buck : []);
  const kept = arr.filter(c => !ENERGY_BUCKETS.has(c.bucket));
  const out = Array.isArray(buck) ? kept.concat(r.classifications) : Object.assign({}, buck, { classifications: kept.concat(r.classifications) });
  fs.writeFileSync(BUCK, JSON.stringify(out, null, 2));
  console.log(`merged ${r.classifications.length} energy entries into court-buckets.json (upstream ${up.length} / midstream ${mid.length} / services ${svc.length})`);
} else {
  console.log(`scanned ${r.scanned} snapshots; ${r.energySector} meta.sector==="Energy"`);
  console.log(`classified: energy_upstream ${up.length} | energy_midstream ${mid.length} | energy_services ${svc.length} | total ${r.classifications.length}`);
  console.log(`marquee coverage (${ENERGY_MARQUEE.length}): ${missingMarquee.length ? 'FAIL missing ' + missingMarquee.join(',') : 'PASS all classified'}`);
  console.log(`foreign-control (BP/SHEL/TTE/CNQ/ENB/.../TNK must NOT classify): ${leakedControl.length ? 'FAIL leaked ' + leakedControl.join(',') : 'PASS all excluded'}`);
  console.log(`upstream sample: ${up.slice(0, 14).map(c => c.t).join(', ')}`);
  console.log(`midstream sample: ${mid.slice(0, 14).map(c => c.t).join(', ')}`);
  console.log(`services sample: ${svc.slice(0, 14).map(c => c.t).join(', ')}`);
}

module.exports = {
  classifyEnergy, isUSListing, num,
  ENERGY_UPSTREAM, ENERGY_MIDSTREAM, ENERGY_SERVICES, ENERGY_DEDUPE_DROP,
  ENERGY_MARQUEE, ENERGY_FOREIGN_CONTROL,
  ENERGY_FOREIGN_DROP, US_PRIMARY_ALLOWLIST,
};
