#!/usr/bin/env node
'use strict';
/**
 * classify-techhw.js — deterministic SI-5 classifier for the tech_hardware_quality CORE court bucket
 * (ONE durable hardware-FRANCHISE quality cohort: the bimodal generic-HARDWARE peer group re-ranked by an
 * absolute-anchor so margin-stable franchises beat commodity contract-manufacturers + loss-making cyclicals).
 *
 * Spec: court/council triage 2026-06-24 — the ONE genuine remaining quality-compounder gap. THESIS: the generic
 * HARDWARE peer group is BIMODAL — durable margin-stable franchises (APH/KEYS/GRMN/MSI/TDY/CGNX/FTV/BMI/AMAT) are
 * lumped with commodity contract-manufacturers (FLEX/JBL/CLS/BHE/SANM/PLXS, opMargin 4-9%, gpa 0.12-0.14) AND
 * loss-making cyclicals/quantum names (ASTS/ONDS/OUST/AAOI…) — so an absolute-anchor on {gpa, fcfMargin, opMargin,
 * growth, netIssuance} cleanly RE-RANKS the franchises above the commodity/loss tail with NO per-name contamination
 * gate (the commodity/loss tail naturally sinks below the absolute floor → off the headlineShortlist, like materials/
 * energy). Pure function of meta.sector + meta.industry + the §6-style COUNTRY-DOMICILE-GUARD isUSListing test +
 * num(marketCap) + the cohort industry set + an economic-fingerprint dedupe. No fuzzy matching, no per-ticker scoring
 * map, no LLM. DURABLE FRANCHISE QUALITY ONLY — the SCORE (court-score.js) never bets on the semi/comms cycle.
 *
 * ONE cohort `tech_hardware_quality` — deterministic pure function of meta.industry (SI-5; no per-ticker cohort map):
 *   meta.sector=='Technology' AND meta.industry in {Semiconductor Equipment & Materials, Electronic Components,
 *   Communication Equipment, Scientific & Technical Instruments} AND the country-domicile guard AND num(marketCap)>=$1B,
 *   deduped. DELIBERATELY OUT: Computer Hardware / Consumer Electronics / Electronics & Computer Distribution / Solar —
 *   those are OEM-commodity / deep-loss / policy-cyclical, structurally different animals. Live CLEAN count
 *   (recomputed 2026-06-24): 71 classified (raw 96 sector+industry; the de-ADR country-domicile guard removes the
 *   foreign primaries — ASML/CLS/ERIC/NOK/FN/CAMT/ITRN/GILT/DQ/… — and the economic-fingerprint dedupe drops the
 *   BELFA/BELFB dual-class duplicate). The commodity contract-mfg (FLEX/JBL/BHE/SANM/PLXS) STAY in-cohort and are
 *   demoted off-headline by the absolute floor in court-score.js; the deep-loss shells (no rev / no totalAssets in
 *   any year) are SI-4 excluded there.
 *
 * NO HARD CONTAMINATION GATE (the key design difference vs classify-itservices/capmkt): the absolute-anchor itself
 * does the work. A low-gpa / low-margin commodity contract-manufacturer (FLEX opMargin ~4%, gpa ~0.12) clips the
 * gpa/fcfMargin/opMargin q-axes near 0 and sinks below the absolute floor → off the headlineShortlist (verified live:
 * FLEX rank 54/71, BHE 55, JBL 61, SANM 63, PLXS 65, all absKaliber 0.10-0.18 — the franchises APH/KEYS/GRMN/MSI/TDY/
 * CGNX/AMAT/BMI/FTV all rank top-17). This mirrors materials/energy where the commodity tail naturally sinks under
 * the absolute anchor with no per-name gate. The ONLY economic exclusion at the classifier level: none — the SI-4
 * economic SHELL gate (no positive revenue in ANY year OR no totalAssets in ANY year → score=null + excluded) lives
 * in court-score.js (belt-and-suspenders, the materials/energy lesson), and the absolute-floor demotes the rest.
 *
 * THE DE-ADR HARDENING (the COUNTRY-DOMICILE-GUARD; mirrors classify-banks/reits/capmkt §6): snapshots carry
 * country===undefined (NOT null) for the Vintage-A US names. The classify-in test treats undefined === null ===
 * US-primary (admit via US exchange + USD + no foreign legal-form name) so the country-undefined US names
 * MSI/KEYS/TDY (Motorola Solutions / Keysight / Teledyne, all NYSE, USD) are RETAINED. Killed GENERALIZABLY:
 *   (1) meta.country SET != "United States" -> EXCLUDE unconditionally (kills ASML Netherlands, CLS Celestica Canada,
 *       ERIC Sweden, NOKBF Finland, FN Fabrinet Cayman, CAMT/GILT/ITRN Israel, DQ China, the .HK/.SW/… suffixes);
 *   (2) FOREIGN_NAME legal-form regex over meta.name catches undefined-country foreign primaries whose name carries a
 *       foreign legal form (ST "Sensata … plc", TEL "TE Connectivity plc", NOK "Nokia Oyj", ICHR "Ichor Holdings,
 *       Ltd.", NVMI "Nova Ltd." all DROP) — US hardware names overwhelmingly end in Inc./Corporation/Incorporated/
 *       Technologies/Corp./Company, none of which the regex matches;
 *   (3) the 5-letter pink-sheet ADR rule /^[A-Z]{4}[FY]$/ + the foreign-suffix ticker rule;
 *   (4) the POSITIVE US-PRIMARY test: a country-undefined name is admitted ONLY if it lists on a US exchange (US_EXCH
 *       region) with USD reporting and NO foreign legal-form name (admits MSI/KEYS/TDY);
 *   (5) a name-verified US_PRIMARY_ALLOWLIST = {GRMN} for the verified US-PRIMARY / design-marquee foreign-domiciled
 *       flagship the guards above would wrongly drop: GRMN = Garmin Ltd., Switzerland-domiciled BUT NYSE-PRIMARY
 *       (region="US", USD) — the marquee Scientific & Technical Instruments franchise. Mirrors classify-itservices
 *       {ACN,G,INFY,GLOB} / materials {CRH,LIN} / energy {SLB} / pharma {JAZZ}. Expand ONLY with a verified US-primary
 *       / design-marquee name. The anti-leak assert in court-score.js EXEMPTS GRMN (it carries country=Switzerland but
 *       is a genuine US primary the design admits).
 *   TECHHW_FOREIGN_DROP = the explicit frozen DENY set for any undefined-country foreign primary a future vintage
 *   surfaces that neither (1) nor (2) catches (empty live — verified no such leaker; kept as the court-named minimum
 *   DENY mechanism, mirrors classify-banks BANK_FOREIGN_DROP). Expand ONLY with a verified foreign name.
 *
 * DEDUPE: economic-fingerprint (NI[0]|totalAssets[0]) dedupe (mirrors classify-reits/capmkt) drops dual-class /
 * legacy-ticker duplicates of the SAME company (live: BELFA/BELFB, Bel Fuse class A/B — same NI[0]|totalAssets[0]).
 * Two distinct companies never share the fp; the degenerate '|' (no annual data) is never deduped. The frozen
 * TECHHW_DEDUPE_DROP set is the explicit named-override mechanism (empty live — the economic-fp dedupe handles BELFA/B).
 *
 * Run modes (mirror classify-itservices/banks/reits/capmkt):
 *   node scripts/classify-techhw.js            -> report count + marquee + foreign control (dry-run)
 *   node scripts/classify-techhw.js --emit      -> print {classifications:[...]} JSON to stdout
 *   node scripts/classify-techhw.js --merge      -> merge tech_hardware_quality entries into outputs/court-buckets.json
 *
 * Verified target (recomputed live 2026-06-24): tech_hardware_quality 71; all 9 marquees classify (APH/KEYS/GRMN/MSI/
 * TDY/CGNX/AMAT/BMI/FTV); the country-undefined US names MSI/KEYS/TDY are RETAINED; GRMN (Garmin Ltd Switzerland) is
 * admitted via the allowlist; the foreign primaries (ASML/CLS/ERIC/NOK/FN/CAMT/ITRN/GILT/DQ) + the foreign-NAME
 * undefined names (ST/TEL/NOK/ICHR/NVMI) DROP; the commodity contract-mfg (FLEX/JBL/BHE/SANM/PLXS) STAY in-cohort
 * (demoted off-headline by the absolute floor downstream); BELFA/BELFB deduped to one.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SNAP_DIR = path.join(ROOT, 'snapshots');
const BUCK = path.join(ROOT, 'outputs', 'court-buckets.json');

// --- num() dual-shape extractor (annual flow fields are {value}-wrapped; annualBalance.* are raw numbers) ---
function num(x) {
  if (x == null) return null;
  if (typeof x === 'number') return isFinite(x) ? x : null;
  if (typeof x === 'object' && x.value != null && isFinite(x.value)) return x.value;
  return null;
}

// --- COUNTRY-DOMICILE-GUARD US-listing test (mirrors classify-banks/reits/capmkt isUSListing) ---
const US_EXCH = new Set(['NYSE', 'NasdaqGS', 'NasdaqGM', 'NasdaqCM', 'NYSEArca', 'NYSE American', 'Nasdaq', 'Cboe US', 'US']);
const OTC_EXCH = new Set(['OTC Markets OTCPK', 'OTC Markets OTCQX', 'OTC Markets OTCQB', 'Other OTC', 'Pink Sheets']);
const FOREIGN_SUFFIX = /\.(HK|SW|TO|L|PA|DE|F|MI|AS|ST|HE|CO|OL|VI|SI|TW|KS|KQ|SS|SZ|T|MX|SA|BR|WA|IR|LS|MC|BK|JK|AX)$/i;
// Foreign legal-form suffix in the company NAME — catches undefined-country foreign primaries (ST "Sensata … plc",
// TEL "TE Connectivity plc", NOK "Nokia Oyj", ICHR "Ichor Holdings, Ltd.", NVMI "Nova Ltd."). Anchored on word
// boundaries so US "Inc."/"Corp."/"Corporation"/"Incorporated"/"Company"/"Technologies"/"Group"/"Holdings" never
// match (US hardware names overwhelmingly end in those). The marquee GRMN ("Garmin Ltd.") that DOES match \bLtd\b is
// admitted via the US_PRIMARY_ALLOWLIST below.
const FOREIGN_NAME = /\b(P\.?L\.?C\.?|S\.?A\.?B\.?\s+de\s+C\.?V\.?|S\.?A\.?\b|N\.?V\.?|A\/S|OYJ|ASA|S\.?p\.?A\.?|\bSE\b|\bAG\b|Bhd|Berhad|PJSC|O[AP]O|Limited|Ltd)\b/i;
// Frozen foreign-primary DENY set (the court-named minimum). Country-undefined foreign primaries whose US-form /
// regex-slipping name neither the country-SET test nor FOREIGN_NAME reliably catches. EMPTY live — verified no such
// leaker exists in the four-industry US >=$1B pool; kept as the minimum DENY mechanism (mirrors classify-banks
// BANK_FOREIGN_DROP / capmkt CAPMKT_FOREIGN_DROP). Expand ONLY with a verified foreign name.
const TECHHW_FOREIGN_DROP = new Set([]);
// Name-verified US-PRIMARY / design-marquee inversion allowlist: foreign-domiciled or foreign-NAME flagships the
// design NAMES as marquees that MUST classify, so the guards above must NOT drop them:
//   GRMN — Garmin Ltd., Switzerland-domiciled BUT NYSE-PRIMARY (region="US", USD); the marquee Scientific & Technical
//          Instruments franchise. country-guard (country SET != US) would drop it; the allowlist admits it.
// Mirrors classify-itservices {ACN,G,INFY,GLOB} / materials {CRH,LIN} / energy {SLB} / pharma {JAZZ}. Expand ONLY
// with a verified US-primary / design-marquee name.
const US_PRIMARY_ALLOWLIST = new Set(['GRMN']);

function isUSListing(m, ticker, companyName) {
  if (FOREIGN_SUFFIX.test(ticker)) return false;                              // .HK/.SW/.L/.TO/.SZ … foreign-suffix tickers
  if (/^[A-Z]{4}[FY]$/.test(ticker)) return false;                            // 5-letter pink-sheet ADR
  if (OTC_EXCH.has(m.region) || OTC_EXCH.has(m.exchangeName)) return false;   // pink-sheet ADR dual-listings
  if (US_PRIMARY_ALLOWLIST.has(ticker)) return true;                          // explicit US-primary override (before guards)
  if (TECHHW_FOREIGN_DROP.has(ticker)) return false;                          // frozen foreign-primary DENY (killshot)
  const ccy = m.reportingCurrency;
  if (m.country != null) {                                                    // country SET -> authoritative
    return m.country === 'United States';                                     // SET && != US -> EXCLUDE, no exceptions
  }
  // country undefined -> POSITIVE US-primary test: US exchange + USD + NO foreign legal-form name (admits MSI/KEYS/TDY)
  if (FOREIGN_NAME.test(companyName || '')) return false;
  if (US_EXCH.has(m.region) && (ccy === 'USD' || ccy == null)) return true;
  return false;
}

// --- cohort set — deterministic pure function of meta.industry ---
const TECHHW_SECTOR = 'Technology';
// The FOUR durable-hardware-franchise industries. DELIBERATELY EXCLUDES Computer Hardware / Consumer Electronics /
// Electronics & Computer Distribution / Solar (OEM-commodity / deep-loss / policy-cyclical — different animals).
const TECHHW_INDUSTRY = new Set([
  'Semiconductor Equipment & Materials', 'Electronic Components', 'Communication Equipment', 'Scientific & Technical Instruments',
]);
// Dedupe / data-conflict drop-set: the explicit named-override for dual-class / legacy-ticker duplicates the
// economic-fingerprint dedupe does not catch, PLUS the CROSS-COHORT collision drops (a name already claimed by a
// pre-existing CORE bucket must NOT also enter tech_hardware_quality, else court-screen's cohort loader would route it
// through the techhw branch and silently drop it from its native bucket — breaking that bucket's SI-5 / parity).
//   AMBA — Ambarella, a FABLESS AI-vision SoC designer in the hand-curated fabless_semi CORE bucket. Yahoo MIS-LABELS
//          its meta.industry as "Semiconductor Equipment & Materials" (one of the four tech_hardware industries), so the
//          industry filter wrongly catches it. It is NOT a hardware-equipment franchise; it is a fabless chip designer
//          that belongs to fabless_semi (where it is curated with reason "fabless AI vision SoC designer"). Dropped here
//          as a documented cross-cohort collision (NOT a quality judgement) so fabless_semi keeps AMBA + its SI-5/parity.
//          The other fabless_semi names (CRDO/ALAB/NVDA/AMD/MXL/AVGO/ARM) carry industry "Semiconductors" (NOT in the
//          four tech_hardware industries) and KMTS "Medical Instruments & Supplies" — none collide; AMBA is the sole
//          Yahoo-mislabel. Expand ONLY with a verified duplicate / cross-cohort-collision ticker.
const TECHHW_DEDUPE_DROP = new Set(['AMBA']);

// Marquee watchlist (frozen): the design's named flagships that MUST each classify, else the universe silently
// collapsed (the country-vintage-collapse regression guard). All 9 verified to classify into the 4 industries:
//   APH  Amphenol (Electronic Components), KEYS Keysight (Sci & Tech Instruments, country=undef),
//   GRMN Garmin Ltd (Sci & Tech Instruments, Switzerland -> allowlist), MSI Motorola Solutions (Comm Equipment,
//   country=undef), TDY Teledyne (Sci & Tech Instruments, country=undef), CGNX Cognex (Sci & Tech Instruments),
//   AMAT Applied Materials (Semi Equip & Materials), BMI Badger Meter (Sci & Tech Instruments), FTV Fortive
//   (Sci & Tech Instruments). ANET is Computer-Hardware-classified -> NOT in this cohort (NOT forced).
const TECHHW_MARQUEE = Object.freeze(['APH', 'KEYS', 'GRMN', 'MSI', 'TDY', 'CGNX', 'AMAT', 'BMI', 'FTV']);
// Positive-control: foreign primaries the de-ADR country-domicile guard MUST keep OUT (the single largest
// classification risk in this bucket). A leak means the country guard / FOREIGN_NAME regex broke. Spans country-SET
// foreign (ASML/CLS/ERIC/NOK Netherlands/Canada/Sweden — note NOKBF the OTC dual; FN/CAMT/ITRN/GILT/DQ) + the
// undefined-country foreign-NAME names (ST/TEL/ICHR/NVMI plc/Ltd).
const TECHHW_FOREIGN_CONTROL = Object.freeze(['ASML', 'CLS', 'ERIC', 'FN', 'CAMT', 'ITRN', 'GILT', 'DQ', 'ST', 'TEL', 'ICHR', 'NVMI']);
// Positive-control: the country-undefined US names that MUST be RETAINED (the de-ADR retention guard). Catches a
// regression that re-keys the classify-in on country!=US (which would wrongly drop these NYSE/Nasdaq USD names).
const TECHHW_UNDEF_US_CONTROL = Object.freeze(['MSI', 'KEYS', 'TDY']);

function classifyTechHw(rec) {
  const m = rec.meta || {};
  const t = m.ticker;
  const nm = m.name || m.shortName || m.longName || '';
  if (TECHHW_DEDUPE_DROP.has(t)) return null;                    // explicit dual-class dedupe -> not classified
  if (m.sector !== TECHHW_SECTOR) return null;                   // Yahoo label for the tech sector
  if (!TECHHW_INDUSTRY.has(m.industry)) return null;             // only the four durable-hardware-franchise industries
  if (!isUSListing(m, t, nm)) return null;                       // de-ADR country-domicile guard + FOREIGN hardening
  const mc = num(rec.marketCap);
  if (mc == null || mc < 1e9) return null;                       // $1B size earmark (num(), not naive >=)
  // NO contamination gate: the absolute-anchor (court-score.js) sinks the commodity contract-mfg / loss tail below
  // the absolute floor (off headline) and SI-4-excludes the revenue-less shells; classifier admits the whole cohort.
  return 'tech_hardware_quality';
}

function run() {
  if (!fs.existsSync(SNAP_DIR)) { console.error('snapshots/ missing — run a pull first'); process.exit(1); }
  const files = fs.readdirSync(SNAP_DIR).filter(f => f.endsWith('.json') && !/\./.test(f.replace(/\.json$/, '')));
  const classifications = [];
  const byTicker = {};
  const seen = new Set();  // economic-fingerprint dedupe (NI[0]|totalAssets[0])
  let scanned = 0, techSector = 0, hwIndustry = 0;
  for (const f of files) {
    let rec;
    try { rec = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); } catch { continue; }
    scanned++;
    const m = rec.meta || {};
    if (m.sector === TECHHW_SECTOR) techSector++;
    if (m.sector === TECHHW_SECTOR && TECHHW_INDUSTRY.has(m.industry)) hwIndustry++;
    const bucket = classifyTechHw(rec);
    if (!bucket) continue;
    // economic-fingerprint dedupe: drop dual-class duplicates of the SAME company (same NI[0]|totalAssets[0]).
    // Two distinct companies never share the fp; the degenerate '|' (no annual data) is never deduped. Mirrors classify-reits/capmkt.
    const a = rec.annual || {};
    const ni0 = (a.annualNetIncome && a.annualNetIncome[0] != null) ? num(a.annualNetIncome[0]) : null;
    const bal0 = (Array.isArray(a.annualBalance) && a.annualBalance[0]) ? a.annualBalance[0] : null;
    const ta0 = (bal0 && bal0.totalAssets != null && isFinite(bal0.totalAssets)) ? bal0.totalAssets : null;
    const fp = `${ni0 == null ? '' : ni0}|${ta0 == null ? '' : ta0}`;
    if (fp !== '|' && seen.has(fp)) continue;
    if (fp !== '|') seen.add(fp);
    const t = m.ticker;
    classifications.push({ t, bucket, confidence: 1.0 });
    byTicker[t] = bucket;
  }
  return { classifications, byTicker, scanned, techSector, hwIndustry };
}

const TECHHW_BUCKETS = new Set(['tech_hardware_quality']);
const r = run();
const techhw = r.classifications.filter(c => c.bucket === 'tech_hardware_quality');
const missingMarquee = TECHHW_MARQUEE.filter(t => !TECHHW_BUCKETS.has(r.byTicker[t]));
const leakedForeign = TECHHW_FOREIGN_CONTROL.filter(t => TECHHW_BUCKETS.has(r.byTicker[t]));
const droppedUndefUS = TECHHW_UNDEF_US_CONTROL.filter(t => !TECHHW_BUCKETS.has(r.byTicker[t]));

const arg = process.argv[2];
if (arg === '--emit') {
  process.stdout.write(JSON.stringify({ classifications: r.classifications }, null, 2));
} else if (arg === '--merge') {
  if (missingMarquee.length) { console.error('MARQUEE FAIL, refusing to merge: ' + missingMarquee.join(', ')); process.exit(1); }
  if (leakedForeign.length) { console.error('FOREIGN-CONTROL FAIL, refusing to merge (foreign primary leaked): ' + leakedForeign.join(', ')); process.exit(1); }
  if (droppedUndefUS.length) { console.error('COUNTRY-UNDEF-US FAIL, refusing to merge (undefined-country US name dropped): ' + droppedUndefUS.join(', ')); process.exit(1); }
  let buck = { classifications: [] };
  try { buck = JSON.parse(fs.readFileSync(BUCK, 'utf8')); } catch {}
  const arr = Array.isArray(buck.classifications) ? buck.classifications : (Array.isArray(buck) ? buck : []);
  const kept = arr.filter(c => !TECHHW_BUCKETS.has(c.bucket));
  const out = Array.isArray(buck) ? kept.concat(r.classifications) : Object.assign({}, buck, { classifications: kept.concat(r.classifications) });
  fs.writeFileSync(BUCK, JSON.stringify(out, null, 2));
  console.log(`merged ${r.classifications.length} tech_hardware_quality entries into court-buckets.json`);
} else {
  console.log(`scanned ${r.scanned} snapshots; ${r.techSector} meta.sector==="Technology"; ${r.hwIndustry} in the four hardware industries (raw, any listing)`);
  console.log(`classified: tech_hardware_quality ${techhw.length} (de-ADR'd + deduped; REL_MIN_N=15 -> ${techhw.length >= 15 ? 'full ABS+REL' : 'THIN_REL ABS-only'})`);
  console.log(`marquee coverage (${TECHHW_MARQUEE.length}): ${missingMarquee.length ? 'FAIL missing ' + missingMarquee.join(',') : 'PASS all classified'}`);
  console.log(`foreign control (ASML/CLS/ERIC/FN/CAMT/ITRN/GILT/DQ/ST/TEL/ICHR/NVMI must NOT classify): ${leakedForeign.length ? 'FAIL leaked ' + leakedForeign.join(',') : 'PASS all excluded'}`);
  console.log(`country-undef US control (MSI/KEYS/TDY must classify): ${droppedUndefUS.length ? 'FAIL dropped ' + droppedUndefUS.join(',') : 'PASS all retained'}`);
  console.log(`tech_hardware_quality sample: ${techhw.slice(0, 30).map(c => c.t).join(', ')}`);
}

module.exports = {
  classifyTechHw, isUSListing, num,
  TECHHW_SECTOR, TECHHW_INDUSTRY, TECHHW_DEDUPE_DROP, TECHHW_FOREIGN_DROP, US_PRIMARY_ALLOWLIST,
  TECHHW_MARQUEE, TECHHW_FOREIGN_CONTROL, TECHHW_UNDEF_US_CONTROL,
};
