#!/usr/bin/env node
'use strict';
/**
 * classify-itservices.js — deterministic SI-5 classifier for the it_services CORE bucket
 * (ONE de-contaminated people-leverage / low-capital-compounding quality cohort).
 *
 * Spec: Vault formula-design-special_tracks-v0-2026-06-22.md PART B (Council->Court DESIGN-PASS v0;
 * NORMS RECOMPUTED-LIVE-THEN-FROZEN at CORE on the CLEAN de-contaminated pool 2026-06-23). Pure function
 * of meta.sector + meta.industry + the vintage-tolerant COUNTRY-DOMICILE-GUARD isUSListing test + num(marketCap)
 * + THE CONTAMINATION GATE + the deterministic industry set. No fuzzy matching, no per-ticker scoring map, no LLM.
 *
 * FEASIBILITY DECISION (the headcount gate, decided live 2026-06-23):
 *   meta.fullTimeEmployees IS present locally (2387/4683 snapshots; ~50% within this cohort), so revenue-per-
 *   employee (RPE) IS computable on the covered slice. BUT the design's decisive live finding (PART B §B.2): raw
 *   RPE is INVERTED on the live cohort — sorting RPE-descending puts the capital-intensive contaminants at the
 *   TOP (CIFR crypto-miner $3.39M/head opMargin -151%; INGM/CDW hardware distributors $2.4M/$1.5M; APLD data-
 *   center) and the genuine people-leverage elite at the BOTTOM (ACN $89k, EPAM $87k, GLOB $86k, CTSH $59k). So
 *   RPE is NOT a scored axis (weight 0.00); it is used ONLY as a contamination GATE (RPE>$700k) + an advisory
 *   RPE_ADVISORY flag. The people-leverage thesis is therefore carried by the LOW-CAPITAL-COMPOUNDING axes that
 *   ARE computable locally (gpa asset-light proxy + fcfMargin cash-conversion + opMargin pricing-power + organic
 *   growth + net-issuance discipline). The omission of a DIRECTLY-scored people-leverage signal (bookings/
 *   utilization/attrition carry NO us-gaap tag and are absent; RPE inverted + ~50% coverage) is DISCLOSED via the
 *   always-on PEOPLE_LEVERAGE_BLIND lamp in court-score.js (mirroring medtech's MA_INTANGIBLE_BLIND).
 *
 * ONE cohort `it_services` — deterministic pure function of meta.industry (PART B §B.1; no per-ticker cohort map):
 *   {Information Technology Services} (the exact Yahoo industry string, verified live) AND meta.sector=='Technology'
 *   AND the country-domicile guard AND num(marketCap) >= $1B AND NOT contamination-gated. Live: raw 30 US >=$1B in
 *   Yahoo Information Technology Services; net de-contaminated cohort = 22 after the economic gate removes the 8
 *   contaminants (> REL_MIN_N=15 → full ABS+REL blend, β=0.6). Marquee set: ACN/CTSH/EPAM/CACI/INFY/G/EXLS +
 *   IBM/GLOB/CNXC/DXC/BR/FIS/JKHY/IT/INOD.
 *
 * THE CONTAMINATION GATE (PART B §B.1 GATE 1 — the decisive court finding; a deterministic, SI-5-clean ECONOMIC
 * gate, NOT a per-name map). A classified name is EXCLUDED (→ never enters court-buckets, mirrors classify-energy's
 * R&M/Coal exclusion at the classifier) iff ANY of:
 *   (1) opMargin[0] < 0                          — the crypto-miners/AI-shells (CIFR -151%, SHAZ -945%, APLD -19%,
 *                                                  BBAI -65%, KEEL -42%, CHRN -68%); a people-business is profitable.
 *   (2) revPerEmployee > $700k (where computable) — the capital-intensive hardware distributors top the RPE table
 *                                                  (CDW $1.5M, INGM $2.4M); NOT labor-leverage.
 *   (3) gpa < 0.02 AND fcfMargin < 0             — asset-heavy colo/data-center with destroyed cash conversion.
 * PLUS a frozen NON_PEOPLE_EXCLUDE name-set kept as a DOCUMENTED belt-and-suspenders fallback / regression-asset
 * (PART B §B.1/§B.4: "secondary to the economic gate"). It catches the residual capital-intensive names the economic
 * gate misses on this vintage — chiefly VNET (China colo: opMargin +7.8% so the opM<0 arm misses it, gpa 0.049 so
 * the gpa<0.02 arm misses it, BUT fcfMargin -59.8% = destroyed cash conversion = capital-intensive, not labor-
 * leverage). The economic gate is the PRIMARY mechanism (this defuses the SI-5 per-name-map attack the council's
 * approach [2] exposed itself to); the name-set is the disclosed fallback only.
 *
 * GATE 2 — NEVER a software GM gate (PART B §B.1): a 70% SaaS GM filter mechanically rejects the entire 25-40%-GM
 * people-services universe. Margin LEVEL is NOT a classifier gate; profitability SIGN (opMargin>=0) is the only
 * margin condition (the India-offshore-vs-Western GM inversion means level mis-ranks). No GM floor anywhere here.
 *
 * THE UNIVERSE HARDENING (PART B Universe safety — the same COUNTRY-DOMICILE-GUARD as classify-pharma/energy/
 * materials): isUSListing alone leaks foreign primaries. Killed GENERALIZABLY:
 *   (1) meta.country set != "United States" -> EXCLUDE (kills GIB Canada, GDS China, MGRT Hong Kong, GLOB Luxembourg);
 *   (2) FOREIGN_NAME legal-form regex over meta.name catches undefined-country foreign primaries;
 *   (3) the 5-letter pink-sheet ADR rule /^[A-Z]{4}[FY]$/;
 *   (4) US_PRIMARY_ALLOWLIST = {ACN, G, INFY, GLOB} — the verified US-PRIMARY / design-marquee foreign-domiciled
 *       flagships PART B §B.1/§B.2 NAMES as marquees/elite that MUST classify (ACN = Accenture plc, Ireland-domiciled
 *       BUT NYSE-primary region="US"; G = Genpact Limited, Bermuda-domiciled NYSE-primary; INFY = Infosys Limited,
 *       Vintage-A country-undefined NYSE-listed, name matches FOREIGN_NAME \bLimited\b; GLOB = Globant S.A.,
 *       Luxembourg-domiciled BUT NYSE-PRIMARY since its 2014 IPO — no home-exchange listing, region="US", USD, the
 *       design's §B.2-named elite people-business $86k/head). The
 *       design's own internal tension (its marquee list demands ACN/G/INFY IN, while its anti-leak text says
 *       "country set != US -> exclude") is resolved deterministically EXACTLY as classify-materials {CRH,LIN} /
 *       classify-energy {SLB} / classify-pharma {JAZZ} resolve it: a name-verified US-primary allowlist. Admits ONLY
 *       these three name-verified flagships; every other foreign-country / foreign-NAME stays excluded.
 *
 * Resolves the court-buckets.json persistence gap (gitignored / externally produced): the it_services classification
 * is regenerated reproducibly by THIS committed script. Run modes:
 *   node scripts/classify-itservices.js          -> report counts + marquee + foreign/contamination control (dry-run)
 *   node scripts/classify-itservices.js --emit    -> print {classifications:[...]} JSON to stdout
 *   node scripts/classify-itservices.js --merge    -> merge it_services entries into outputs/court-buckets.json
 *
 * Verified target (recomputed live 2026-06-23): net 22 de-contaminated; all 16 marquees classify; the 8 economic-
 * gate contaminants (CIFR/APLD/BBAI/KEEL/SHAZ/CHRN/CDW/INGM) + the foreign primaries (GIB/GDS/MGRT/GLOB) + the
 * NON_PEOPLE_EXCLUDE residual (VNET) all DROP.
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

// --- vintage-tolerant COUNTRY-DOMICILE-GUARD US-listing test (NO blanket inversion rescue; allowlist for the
//     verified US-primary / design-marquee foreign-domiciled flagships) ---
const US_EXCH = new Set(['NYSE', 'NasdaqGS', 'NasdaqGM', 'NasdaqCM', 'NYSEArca', 'NYSE American', 'Nasdaq', 'Cboe US', 'US']);
const OTC_EXCH = new Set(['OTC Markets OTCPK', 'OTC Markets OTCQX', 'OTC Markets OTCQB', 'Other OTC', 'Pink Sheets']);
const FOREIGN_SUFFIX = /\.(HK|SW|TO|L|PA|DE|F|MI|AS|ST|HE|CO|OL|VI|SI|TW|KS|KQ|SS|SZ|T|MX|SA|BR|WA|IR|LS|MC|BK|JK|AX)$/i;
// Foreign legal-form suffix in the company NAME — catches undefined-country foreign primaries. Anchored on word
// boundaries so US "Inc."/"Corp."/"Company"/"Group"/"Holdings" never match. The marquees ACN ("Accenture plc"),
// G ("Genpact Limited"), INFY ("Infosys Limited") that DO match are admitted via the US_PRIMARY_ALLOWLIST below.
const FOREIGN_NAME = /\b(P\.?L\.?C\.?|S\.?A\.?B\.?\s+de\s+C\.?V\.?|S\.?A\.?\b|N\.?V\.?|A\.?S\.?\b|A\/S|AG|OYJ|ASA|S\.?p\.?A\.?|SE|Bhd|Berhad|PJSC|O[AP]O|Limited|Ltd)\b/i;
// Name-verified US-PRIMARY / design-marquee inversion allowlist (PART B §B.1/SI-5): foreign-domiciled or foreign-NAME
// flagships the design NAMES as marquees that MUST classify, so the guards above must NOT drop them:
//   ACN  — Accenture plc, Ireland-domiciled BUT NYSE-PRIMARY (region="US"); name matches FOREIGN_NAME \bplc\b.
//   G    — Genpact Limited, Bermuda-domiciled NYSE-PRIMARY; country-guard + FOREIGN_NAME \bLimited\b would drop it.
//   INFY — Infosys Limited, Vintage-A (country undefined), NYSE-listed; name matches FOREIGN_NAME \bLimited\b.
//   GLOB — Globant S.A., Luxembourg-domiciled BUT NYSE-PRIMARY since its 2014 IPO (no home-exchange listing,
//          region="US", USD); the design §B.2-named elite people-business. country-guard would drop it.
// Mirrors classify-materials {CRH,LIN} / classify-energy {SLB} / classify-pharma {JAZZ}. Expand ONLY with a
// verified US-primary / design-marquee name.
const US_PRIMARY_ALLOWLIST = new Set(['ACN', 'G', 'INFY', 'GLOB']);

function isUSListing(m, ticker, companyName) {
  if (FOREIGN_SUFFIX.test(ticker)) return false;                              // .HK/.SW/.L/.TO/.SZ …
  if (/^[A-Z]{4}[FY]$/.test(ticker)) return false;                            // 5-letter pink-sheet ADR
  if (OTC_EXCH.has(m.region) || OTC_EXCH.has(m.exchangeName)) return false;   // pink-sheet ADRs
  if (US_PRIMARY_ALLOWLIST.has(ticker)) return true;                          // explicit US-primary override (before guards)
  const ccy = m.reportingCurrency;
  if (m.country != null) {                                                    // Vintage B: country authoritative
    return m.country === 'United States';                                     // SET && != US -> EXCLUDE, no inversion rescue
  }
  // Vintage A: country undefined -> US-exchange + USD + NO foreign legal-form name
  if (FOREIGN_NAME.test(companyName || '')) return false;
  if (US_EXCH.has(m.region) && (ccy === 'USD' || ccy == null)) return true;
  return false;
}

// --- cohort + industry set (§B.1) — deterministic pure function of meta.industry ---
const ITSVC_SECTOR = 'Technology';
const ITSVC_INDUSTRY = new Set(['Information Technology Services']); // the exact Yahoo industry string (verified live)
const ITSVC_DEDUPE_DROP = new Set([]); // keep liquid primary; verified no dual-listing in the US pool

// --- §B.1 CONTAMINATION GATE (economic, deterministic) ---
const ITSVC_RPE_CAP = 700e3;     // revPerEmployee > $700k -> capital-intensive distributor/colo, NOT labor-leverage
// Frozen NON_PEOPLE_EXCLUDE name-set: DOCUMENTED belt-and-suspenders fallback, SECONDARY to the economic gate
// (PART B §B.1/§B.4). Catches the residual capital-intensive names the economic gate misses on this vintage
// (chiefly VNET: opM +7.8% & gpa 0.049 slip the economic arms, but fcfMargin -59.8% = capital-intensive colo).
// The crypto-miners/distributors (CIFR/APLD/BBAI/KEEL/SHAZ/CHRN/CDW/INGM) + colo (GDS/VNET/MGRT) are listed for
// the regression record; most are ALSO caught by the economic gate or the country-domicile guard — this set is
// the disclosed fallback, not the primary mechanism.
const NON_PEOPLE_EXCLUDE = new Set([
  'CIFR', 'APLD', 'BBAI', 'KEEL', 'SHAZ', 'CHRN', 'GDS', 'VNET', 'MGRT', 'CDW', 'INGM',
]);

// contaminationReason(rec): returns the EXCLUSION reason string if the (industry+US+>=$1B) name is contaminated,
// else null. Economic gate is PRIMARY; NON_PEOPLE_EXCLUDE is the documented fallback. opMargin/fcfMargin/gpa/RPE
// all read snapshot annual[0] + meta.fullTimeEmployees (same dual-shape num() pool the NORMS were calibrated on).
function contaminationReason(rec) {
  const m = rec.meta || {};
  const a = rec.annual || {};
  const rev = (a.annualRev || []).map(num);
  const op = (a.annualOpInc || []).map(num);
  const fcf = (a.annualFCF || []).map(num);
  const gp = (a.annualGP || []).map(num);
  const bal = Array.isArray(a.annualBalance) ? a.annualBalance : [];
  const ta = bal[0] && bal[0].totalAssets != null && isFinite(bal[0].totalAssets) ? bal[0].totalAssets : null;
  const emp = (m.fullTimeEmployees != null && isFinite(m.fullTimeEmployees)) ? m.fullTimeEmployees : null;
  const opM = (op[0] != null && rev[0] != null && rev[0] > 0) ? op[0] / rev[0] : null;
  const fcfM = (fcf[0] != null && rev[0] != null && rev[0] > 0) ? fcf[0] / rev[0] : null;
  const gpa = (gp[0] != null && ta != null && ta > 0) ? gp[0] / ta : null;
  const rpe = (emp != null && emp > 0 && rev[0] != null) ? rev[0] / emp : null;
  if (opM != null && opM < 0) return 'opMargin<0';                            // miners/AI-shells
  if (rpe != null && rpe > ITSVC_RPE_CAP) return 'RPE>700k';                  // capital-intensive distributor
  if (gpa != null && fcfM != null && gpa < 0.02 && fcfM < 0) return 'gpa<0.02&fcf<0'; // asset-heavy colo
  if (NON_PEOPLE_EXCLUDE.has(m.ticker)) return 'NON_PEOPLE_EXCLUDE_fallback';  // documented fallback (VNET …)
  return null;
}

// Marquee watchlist (PART B §B.1/SI-5 frozen): the design's named flagships that MUST classify, else the universe
// silently collapsed (the country-vintage-collapse regression guard). Spans the elite people-businesses + the
// US-primary foreign-domiciled flagships (ACN/G/INFY via the allowlist).
const ITSVC_MARQUEE = Object.freeze(['ACN', 'CTSH', 'EPAM', 'CACI', 'INFY', 'G', 'EXLS',
  'IBM', 'GLOB', 'CNXC', 'DXC', 'BR', 'FIS', 'JKHY', 'IT', 'INOD']);
// Positive-control (PART B §B.1 GATE 1 + Universe safety): the contaminants + foreign primaries the gate/guard
// MUST keep OUT. Catches a regression that drops the economic gate, the NON_PEOPLE_EXCLUDE fallback, or a guard.
const ITSVC_CONTAM_CONTROL = Object.freeze(['CIFR', 'APLD', 'BBAI', 'KEEL', 'SHAZ', 'CHRN', 'CDW', 'INGM',
  'VNET', 'GIB', 'GDS', 'MGRT']);

function classifyItServices(rec) {
  const m = rec.meta || {};
  const t = m.ticker;
  const nm = m.name || m.shortName || m.longName || '';
  if (ITSVC_DEDUPE_DROP.has(t)) return null;                     // excluded[]
  if (m.sector !== ITSVC_SECTOR) return null;                    // Yahoo label for the tech sector
  if (!ITSVC_INDUSTRY.has(m.industry)) return null;              // non-IT-services tech industry -> SI-4 null+excluded[]
  if (!isUSListing(m, t, nm)) return null;                       // §B.1 country-domicile guard + FOREIGN hardening
  const mc = num(rec.marketCap);
  if (mc == null || mc < 1e9) return null;                       // §B.1 $1B size earmark (num(), not naive >=)
  if (contaminationReason(rec)) return null;                     // §B.1 contamination gate -> never enters court-buckets
  return 'it_services';
}

function run() {
  if (!fs.existsSync(SNAP_DIR)) { console.error('snapshots/ missing — run a pull first'); process.exit(1); }
  const files = fs.readdirSync(SNAP_DIR).filter(f => f.endsWith('.json') && !/\./.test(f.replace(/\.json$/, '')));
  const classifications = [];
  const byTicker = {};
  const contaminants = []; // for the dry-run report: industry+US+>=$1B names the gate excluded
  let scanned = 0, techSector = 0, itIndustry = 0;
  for (const f of files) {
    let rec;
    try { rec = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); } catch { continue; }
    scanned++;
    const m = rec.meta || {};
    if (m.sector === ITSVC_SECTOR) techSector++;
    if (m.sector === ITSVC_SECTOR && ITSVC_INDUSTRY.has(m.industry)) itIndustry++;
    const bucket = classifyItServices(rec);
    if (bucket) {
      const t = m.ticker;
      classifications.push({ t, bucket, confidence: 1.0 });
      byTicker[t] = bucket;
    } else if (m.sector === ITSVC_SECTOR && ITSVC_INDUSTRY.has(m.industry) && isUSListing(m, m.ticker, m.name || '') && num(rec.marketCap) != null && num(rec.marketCap) >= 1e9) {
      const reason = contaminationReason(rec);
      if (reason) contaminants.push({ t: m.ticker, reason });
    }
  }
  return { classifications, byTicker, contaminants, scanned, techSector, itIndustry };
}

const ITSVC_BUCKETS = new Set(['it_services']);
const r = run();
const itsvc = r.classifications.filter(c => c.bucket === 'it_services');
const missingMarquee = ITSVC_MARQUEE.filter(t => !ITSVC_BUCKETS.has(r.byTicker[t]));
const leakedControl = ITSVC_CONTAM_CONTROL.filter(t => ITSVC_BUCKETS.has(r.byTicker[t]));

const arg = process.argv[2];
if (arg === '--emit') {
  process.stdout.write(JSON.stringify({ classifications: r.classifications }, null, 2));
} else if (arg === '--merge') {
  if (missingMarquee.length) { console.error('MARQUEE FAIL, refusing to merge: ' + missingMarquee.join(', ')); process.exit(1); }
  if (leakedControl.length) { console.error('CONTAM/FOREIGN-CONTROL FAIL, refusing to merge: ' + leakedControl.join(', ')); process.exit(1); }
  let buck = { classifications: [] };
  try { buck = JSON.parse(fs.readFileSync(BUCK, 'utf8')); } catch {}
  const arr = Array.isArray(buck.classifications) ? buck.classifications : (Array.isArray(buck) ? buck : []);
  const kept = arr.filter(c => !ITSVC_BUCKETS.has(c.bucket));
  const out = Array.isArray(buck) ? kept.concat(r.classifications) : Object.assign({}, buck, { classifications: kept.concat(r.classifications) });
  fs.writeFileSync(BUCK, JSON.stringify(out, null, 2));
  console.log(`merged ${r.classifications.length} it_services entries into court-buckets.json`);
} else {
  console.log(`scanned ${r.scanned} snapshots; ${r.techSector} meta.sector==="Technology"; ${r.itIndustry} in "Information Technology Services" (US >=$1B raw)`);
  console.log(`classified: it_services ${itsvc.length} (de-contaminated; REL_MIN_N=15 -> ${itsvc.length >= 15 ? 'full ABS+REL' : 'THIN_REL ABS-only'})`);
  console.log(`contamination-gated (industry+US+>=$1B but excluded): ${r.contaminants.map(c => c.t + ':' + c.reason).join(', ') || '(none)'}`);
  console.log(`marquee coverage (${ITSVC_MARQUEE.length}): ${missingMarquee.length ? 'FAIL missing ' + missingMarquee.join(',') : 'PASS all classified'}`);
  console.log(`contam/foreign-control (must NOT classify): ${leakedControl.length ? 'FAIL leaked ' + leakedControl.join(',') : 'PASS all excluded'}`);
  console.log(`it_services sample: ${itsvc.slice(0, 24).map(c => c.t).join(', ')}`);
}

module.exports = {
  classifyItServices, isUSListing, num, contaminationReason,
  ITSVC_SECTOR, ITSVC_INDUSTRY, ITSVC_DEDUPE_DROP, ITSVC_RPE_CAP, NON_PEOPLE_EXCLUDE,
  ITSVC_MARQUEE, ITSVC_CONTAM_CONTROL, US_PRIMARY_ALLOWLIST,
};
