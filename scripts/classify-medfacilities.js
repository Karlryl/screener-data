#!/usr/bin/env node
'use strict';
/**
 * classify-medfacilities.js — deterministic SI-5 classifier for the medical_care_facilities CORE court bucket
 * (ONE capital-intensive HEALTHCARE-FACILITIES operating-quality cohort: hospital / SNF / dialysis / rehab / hospice /
 * surgery / home-health operators — HCA/THC/UHS/EHC/ENSG/SEM/DVA/ACHC/CHE...).
 *
 * Spec: court gauntlet DESIGN for medical_care_facilities (BUILD as a DISCLOSED partial-quality read — the banks
 * precedent: real OPERATING quality is locally computable, but the core value driver (Medicare/Medicaid/commercial
 * reimbursement-rate trajectory / payer mix / census-occupancy / regulatory) is BLIND in the snapshot and is HONESTLY
 * disclosed via always-on BLIND walls, never faked). Pure function of meta.sector + meta.industry + the §6-style
 * COUNTRY-DOMICILE-GUARD isUSListing test (country set != US -> exclude; the de-ADR'd FOREIGN_NAME legal-form regex for
 * undefined-country foreign primaries; a positive US-primary test for country-undefined US operators) + num(marketCap)
 * + the cohort industry set. No fuzzy matching, no per-ticker scoring map, no LLM. THROUGH-CYCLE OPERATING QUALITY ONLY
 * — the SCORE (court-score.js) never bets on the reimbursement cycle (REIMBURSEMENT_RATE_BLIND, PAYER_MIX_BLIND,
 * CENSUS_OCCUPANCY_BLIND, REGULATORY_BLIND always-on walls).
 *
 * SCOPE NOTE (what is DELIBERATELY OUT): this is the Yahoo industry 'Medical Care Facilities' ONLY — the genuine
 * capital-intensive facilities operators. The thin-margin regulated FLOW-THROUGH cousins are NOT in this cohort:
 * Healthcare Plans (managed-care, 2-4% thin-margin regulated flow-through — the insurance-exclusion cousin) and
 * Medical Distribution (~1% distribution margin) are SEPARATE industries and never classify here.
 *
 * ONE cohort `medical_care_facilities` — deterministic pure function of meta.industry (SI-5; no per-ticker map):
 *   meta.sector=='Healthcare' AND meta.industry=='Medical Care Facilities' AND the country-domicile guard AND
 *   num(marketCap)>=$1B, deduped. Live CLEAN count (recomputed 2026-06-24): 27 classified (28 raw US >=$1B minus the
 *   CON data-plumbing exclusion — Windows-reserved-name snapshot `_CON.json` is unreachable by the shared loader; see MEDFAC_DEDUPE_DROP).
 *
 * THE DE-ADR HARDENING (mirrors classify-banks/reits/energy/materials §6): isUSListing alone leaks foreign primaries.
 * Killed GENERALIZABLY:
 *   (1) meta.country set != "United States" -> EXCLUDE unconditionally (kills foreign-domiciled facilities primaries +
 *       the OTC pink-sheet dual-listings — Fresenius FMS/FME.DE/FRE.DE/FSNUF/FSNUY, the .AX/.DE/.SZ foreign-suffix names);
 *   (2) FOREIGN_NAME legal-form regex over meta.name catches undefined-country foreign primaries whose name carries a
 *       foreign legal form (S.A./plc/N.V./AG/Ltd ...). US operator names overwhelmingly end in Inc./Corporation/Group/
 *       Holdings/Healthcare/Health Services — none of which the regex matches;
 *   (3) the 5-letter pink-sheet ADR rule /^[A-Z]{4}[FY]$/ (FMCQF/FSNUF/FSNUY/LWSCF...);
 *   (4) the POSITIVE US-PRIMARY test: a country-undefined name is admitted ONLY if it lists on a US exchange (US_EXCH
 *       region) with USD reporting and NO foreign legal-form name (admits the country-undefined US operators THC/SGRY/
 *       MD/UHS/SEM/OPCH/PACS/PNTG/NHC/LFST that carry country=undefined, NYSE/Nasdaq, USD). The anti-leak assert must
 *       NOT key on country!=US (that would throw on the legitimate undefined-country US operators).
 *   US_PRIMARY_ALLOWLIST kept (empty) for structural parity — no US-primary facilities operator carries a foreign
 *   legal-form name that the FOREIGN_NAME guard would wrongly drop; expand ONLY with a verified US-primary foreign-NAME name.
 *
 * DEDUPE (keep the liquid US-primary common; drop preferred-share / dual-class / legacy-ticker duplicates that pass the
 * country-SET test). Implemented as a (NI[0]|totalAssets[0]) economic fingerprint dedupe (mirrors classify-reits): two
 * distinct companies never share the fp; a preferred / dual-class duplicate of the same company does. The frozen
 * MEDFAC_DEDUPE_DROP set is kept (empty live) as the explicit named-dedupe override mechanism; expand ONLY with a
 * verified duplicate ticker.
 *
 * Run modes (mirror classify-banks/reits):
 *   node scripts/classify-medfacilities.js            -> report count + marquee + foreign control (dry-run)
 *   node scripts/classify-medfacilities.js --emit      -> print {classifications:[...]} JSON to stdout
 *   node scripts/classify-medfacilities.js --merge      -> merge medical_care_facilities entries into outputs/court-buckets.json
 *
 * Verified target (recomputed live 2026-06-24): medical_care_facilities 27; all 6 marquees classify (HCA/THC/UHS/EHC/
 * ENSG/DVA); the foreign Fresenius/diagnostics ADRs (FMS/FMCQF/FME.DE/FRE.DE/FSNUF/FSNUY/LWSCF + the .AX/.SZ names) all DROP.
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
// FLOW-field {value}-unwrap: the annual flow fields (annualNetIncome ...) are WRAPPED OBJECTS {value:N}; annualBalance.*
// are raw numbers. Same dual-shape logic as num() — used for the economic-fingerprint dedupe.
const unwrap = x => (x == null ? null : (typeof x === 'number' ? (isFinite(x) ? x : null) : (x.value != null && isFinite(x.value) ? x.value : null)));

// --- COUNTRY-DOMICILE-GUARD US-listing test (mirrors classify-banks/reits isUSListing) ---
const US_EXCH = new Set(['NYSE', 'NasdaqGS', 'NasdaqGM', 'NasdaqCM', 'NYSEArca', 'NYSE American', 'Nasdaq', 'Cboe US', 'US']);
const OTC_EXCH = new Set(['OTC Markets OTCPK', 'OTC Markets OTCQX', 'OTC Markets OTCQB', 'Other OTC', 'Pink Sheets']);
const FOREIGN_SUFFIX = /\.(HK|SW|TO|L|PA|DE|F|MI|AS|ST|HE|CO|OL|VI|SI|TW|KS|KQ|SS|SZ|T|MX|SA|BR|WA|IR|LS|MC|BK|JK|AX)$/i;
// Foreign legal-form suffix in the company NAME — catches undefined-country foreign facilities primaries. Anchored on
// word boundaries so US "Inc."/"Corp."/"Group"/"Holdings"/"Healthcare"/"Health" never match (mirrors classify-banks/reits).
const FOREIGN_NAME = /\b(P\.?L\.?C\.?|S\.?A\.?B\.?\s+de\s+C\.?V\.?|S\.?A\.?\b|N\.?V\.?|A\/S|OYJ|ASA|S\.?p\.?A\.?|\bSE\b|\bAG\b|Bhd|Berhad|PJSC|O[AP]O|Limited|Ltd)\b/i;
// Name-verified US-PRIMARY inversion allowlist (empty for medfac — no US-primary facilities operator carries a foreign
// legal-form name that the FOREIGN_NAME guard would wrongly drop; kept for structural parity with classify-reits/energy/
// materials so the mechanism is present if a future verified US-primary foreign-NAME operator appears).
const US_PRIMARY_ALLOWLIST = new Set([]);

function isUSListing(m, ticker, companyName) {
  if (FOREIGN_SUFFIX.test(ticker)) return false;                              // .DE/.AX/.SZ … foreign-suffix tickers
  if (/^[A-Z]{4}[FY]$/.test(ticker)) return false;                            // 5-letter pink-sheet ADR (FMCQF/FSNUF/FSNUY/LWSCF)
  if (OTC_EXCH.has(m.region) || OTC_EXCH.has(m.exchangeName)) return false;   // pink-sheet ADR dual-listings
  if (US_PRIMARY_ALLOWLIST.has(ticker)) return true;                          // explicit US-primary override (before guards)
  const ccy = m.reportingCurrency;
  if (m.country != null) {                                                    // country SET -> authoritative
    return m.country === 'United States';                                     // SET && != US -> EXCLUDE, no exceptions
  }
  // country undefined -> POSITIVE US-primary test: US exchange + USD + NO foreign legal-form name (admits THC/SGRY/MD/UHS/SEM)
  if (FOREIGN_NAME.test(companyName || '')) return false;
  if (US_EXCH.has(m.region) && (ccy === 'USD' || ccy == null)) return true;
  return false;
}

// --- cohort set — deterministic pure function of meta.industry ---
const MEDFAC_SECTOR = 'Healthcare';
// The SINGLE Yahoo industry that is the capital-intensive facilities-operator animal. Healthcare Plans (managed-care
// thin-margin flow-through) + Medical Distribution (~1% margin) are DELIBERATELY ABSENT (different economics).
const MEDFAC_INDUSTRY = new Set(['Medical Care Facilities']);
// Drop-set: preferred-share / dual-class / legacy-ticker duplicates that pass the country-SET=US test but are not the
// liquid primary, PLUS one DATA-PLUMBING exclusion. Mirrors classify-reits REIT_DEDUPE_DROP. The economic-fingerprint
// dedupe in run() is the PRIMARY dedupe mechanism; expand the dedupe portion ONLY with a verified duplicate ticker.
//   CON (Concentra Group Holdings) — DOCUMENTED EXCLUSION (a data-plumbing limitation, NOT a quality judgement): "CON"
//     is a Windows RESERVED DEVICE NAME, so its snapshot is stored as `_CON.json` (the leading-underscore escape) and is
//     UNREACHABLE by the standard `snapshots/<ticker>.json` loader path that court-screen.js + every CORE bucket use to
//     read the annual axis arrays. Admitting it would either (a) silently break SI-5 conservation (classified-but-not-
//     scored), or (b) require special-casing the underscore in the shared loader, risking the byte-parity of all 24
//     existing buckets. It is a thin 2024 spin-off from Select Medical (SEM, which IS in the cohort), not a marquee.
//     Excluded here as the cleaner treatment; revisit if the snapshot-filename escape is normalized upstream.
const MEDFAC_DEDUPE_DROP = new Set(['CON']);

// Marquee watchlist (frozen): the design's named flagships that MUST each classify, else the universe silently collapsed
// (the country-vintage-collapse regression guard). HCA the flagship + the hospital/dialysis/rehab/SNF quality operators.
const MEDFAC_MARQUEE = Object.freeze(['HCA', 'THC', 'UHS', 'EHC', 'ENSG', 'DVA']);
// Positive-control: the foreign facilities/diagnostics ADRs the de-ADR guard must keep OUT. Catches a regression that
// drops a country guard. Fresenius Medical Care (FMS = NYSE ADR of a German primary; FMCQF/FME.DE pink/foreign-suffix),
// Fresenius SE (FRE.DE/FSNUF/FSNUY), Laboratorios (LWSCF), the .AX/.SZ foreign-suffix names.
const MEDFAC_FOREIGN_CONTROL = Object.freeze(['FMS', 'FMCQF', 'FME.DE', 'FRE.DE', 'FSNUF', 'FSNUY', 'LWSCF', 'RHC.AX', '300015.SZ']);

function classifyMedFac(rec) {
  const m = rec.meta || {};
  const t = m.ticker;
  const nm = m.name || m.shortName || m.longName || '';
  if (MEDFAC_DEDUPE_DROP.has(t)) return null;                    // preferred/dual-class dedupe -> not classified
  if (m.sector !== MEDFAC_SECTOR) return null;                   // Yahoo label for GICS Health Care
  if (!MEDFAC_INDUSTRY.has(m.industry)) return null;             // only the capital-intensive facilities-operator industry
  if (!isUSListing(m, t, nm)) return null;                       // de-ADR country-domicile guard + FOREIGN hardening
  const mc = num(rec.marketCap);
  if (mc == null || mc < 1e9) return null;                       // $1B size earmark (num(), not naive >=)
  return 'medical_care_facilities';
}

function run() {
  if (!fs.existsSync(SNAP_DIR)) { console.error('snapshots/ missing — run a pull first'); process.exit(1); }
  const files = fs.readdirSync(SNAP_DIR).filter(f => f.endsWith('.json') && !/\./.test(f.replace(/\.json$/, '')));
  const classifications = [];
  const byTicker = {};
  const seen = new Set();        // economic-fingerprint dedupe (NI[0]|totalAssets[0])
  let scanned = 0, hcSector = 0, medfacIndustry = 0;
  for (const f of files) {
    let rec;
    try { rec = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); } catch { continue; }
    scanned++;
    const m = rec.meta || {};
    if (m.sector === MEDFAC_SECTOR) hcSector++;
    if (m.sector === MEDFAC_SECTOR && MEDFAC_INDUSTRY.has(m.industry)) medfacIndustry++;
    const bucket = classifyMedFac(rec);
    if (!bucket) continue;
    // economic-fingerprint dedupe: drop preferred/dual-class duplicates of the SAME company (same NI[0]|totalAssets[0]).
    // Two distinct companies never share the fp; the degenerate '|' (no annual data) is never deduped (would collapse
    // multiple thin shells). Mirrors classify-reits.
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
  return { classifications, byTicker, scanned, hcSector, medfacIndustry };
}

const MEDFAC_BUCKETS = new Set(['medical_care_facilities']);
const r = run();
const medfac = r.classifications.filter(c => c.bucket === 'medical_care_facilities');
const missingMarquee = MEDFAC_MARQUEE.filter(t => !MEDFAC_BUCKETS.has(r.byTicker[t]));
const leakedForeign = MEDFAC_FOREIGN_CONTROL.filter(t => MEDFAC_BUCKETS.has(r.byTicker[t]));

const arg = process.argv[2];
if (arg === '--emit') {
  process.stdout.write(JSON.stringify({ classifications: r.classifications }, null, 2));
} else if (arg === '--merge') {
  if (missingMarquee.length) { console.error('MARQUEE FAIL, refusing to merge: ' + missingMarquee.join(', ')); process.exit(1); }
  if (leakedForeign.length) { console.error('FOREIGN-CONTROL FAIL, refusing to merge: ' + leakedForeign.join(', ')); process.exit(1); }
  let buck = { classifications: [] };
  try { buck = JSON.parse(fs.readFileSync(BUCK, 'utf8')); } catch {}
  const arr = Array.isArray(buck.classifications) ? buck.classifications : (Array.isArray(buck) ? buck : []);
  const kept = arr.filter(c => !MEDFAC_BUCKETS.has(c.bucket));
  const out = Array.isArray(buck) ? kept.concat(r.classifications) : Object.assign({}, buck, { classifications: kept.concat(r.classifications) });
  fs.writeFileSync(BUCK, JSON.stringify(out, null, 2));
  console.log(`merged ${r.classifications.length} medical_care_facilities entries into court-buckets.json`);
} else {
  console.log(`scanned ${r.scanned} snapshots; ${r.hcSector} meta.sector==="Healthcare"; ${r.medfacIndustry} in "Medical Care Facilities" (raw)`);
  console.log(`classified: medical_care_facilities ${medfac.length}`);
  console.log(`marquee coverage (${MEDFAC_MARQUEE.length}): ${missingMarquee.length ? 'FAIL missing ' + missingMarquee.join(',') : 'PASS all classified'}`);
  console.log(`foreign-control (FMS/FME.DE/FRE.DE/FSNUF/... must NOT classify): ${leakedForeign.length ? 'FAIL leaked ' + leakedForeign.join(',') : 'PASS all excluded'}`);
  console.log(`medical_care_facilities sample: ${medfac.slice(0, 28).map(c => c.t).join(', ')}`);
}

module.exports = {
  classifyMedFac, isUSListing, num, unwrap,
  MEDFAC_SECTOR, MEDFAC_INDUSTRY, MEDFAC_DEDUPE_DROP,
  MEDFAC_MARQUEE, MEDFAC_FOREIGN_CONTROL, US_PRIMARY_ALLOWLIST,
};
