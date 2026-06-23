#!/usr/bin/env node
'use strict';
/**
 * classify-pharma.js — deterministic SI-5 classifier for the pharma_commercial CORE bucket
 * (pharma_branded / pharma_biopharma / pharma_specialty).
 *
 * Spec: Vault formula-design-pharma_court-v0-2026-06-22.md §1 (+ formula-design-pharma-v0-2026-06-21.md),
 * Council->Court DESIGN-PASS v0 NEEDS-REVISION — NORMS RECOMPUTED-LIVE-THEN-FROZEN at CORE on the CLEAN
 * commercial pool 2026-06-23. Pure function of meta.sector + meta.industry + the vintage-tolerant
 * COUNTRY-DOMICILE-GUARD isUSListing test (country set != US -> exclude; FOREIGN_NAME legal-form regex for
 * undefined-country foreigners; the frozen PHARMA_FOREIGN_DROP ADR set; the name-verified US_PRIMARY_ALLOWLIST
 * for the verified US-primary foreign-NAME flagship JAZZ) + num(marketCap) + THE COMMERCIAL GATE + the cohort
 * industry sets. No fuzzy matching, no per-ticker scoring map, no LLM. COMMERCIAL-STAGE QUALITY ONLY — the
 * pre-revenue/clinical-stage biotech the design MANDATES excluding never enters court-buckets.
 *
 * THREE cohorts — deterministic pure function of meta.industry (§1.3, SI-5; no per-ticker cohort map):
 *   pharma_branded    : {Drug Manufacturers - General} — mature mega-cap, 66-79% GM, FCF-generative, serial-
 *       acquirer, patent-cliff-exposed (ABBV AMGN BIIB BMY GILD JNJ LLY MRK OGN PFE). n=10<15 -> THIN_REL
 *       (ABS-only, beta=1.0) in court-score; ABS anchors are absolute-anchored so still fully scorable.
 *   pharma_biopharma  : {Biotechnology} AND commercial gate — single/dual-franchise biologics, 64-96% GM,
 *       higher growth, more organic (VRTX REGN EXEL INCY ALNY HALO HRMY CPRX BMRN JAZZ +…). n=22, full REL.
 *   pharma_specialty  : {Drug Manufacturers - Specialty & Generic} AND commercial gate — heterogeneous
 *       generic<->specialty-branded, GM 35-95% (VTRS 35% generic <-> NBIX/UTHR/ZTS specialty). n=14, full REL.
 *
 * THE COMMERCIAL GATE (§1.4 — PROFITABILITY-based, NOT GM-based; refutes the v0/approach-[1] GM>=0.40 gate).
 * A name enters a cohort iff: annualRev[0] >= $500M AND (>=3 revenue-bearing annual years) AND
 * (opMargin[0] >= 0 OR fcfMargin[0] >= 0). This DEFERS the cash-burning clinical names that *have* product
 * revenue (MRNA/BBIO/INSM/RARE/SRPT/IONS/AXSM/MDGL/LEGN…) to the future pre-revenue/clinical special-track —
 * they NEVER enter court-buckets (mirrors classify-energy's R&M/Coal/Uranium exclusion at the classifier),
 * keeping the cohort NORMS/REL pool CLEAN of the -100%..-18600% clinical-burn opMargin tail that would
 * otherwise destroy the biopharma percentiles. Commercial generics (VTRS $14.3B OpM +2%, PRGO/AMRX/PAHC) are
 * KEPT — their low GM is a generic COGS structure, not clinical burn. The court-score.js pre-revenue SI-4 gate
 * (>=2 annual rev AND revLatest>=$1M) is the belt-and-suspenders floor for any zero-rev shell that slips in.
 *
 * THE UNIVERSE HARDENING (§1.2 — the v1 killshot the industrials inversion-rescue clause would re-open):
 * isUSListing alone LEAKS genuine foreign primaries (AZN UK, ARGX NL, ALKS Ireland, BNTX Germany, NVO/NVS/SNY/
 * TAK/RHHBY Vintage-A). Killed GENERALIZABLY (NO inversion-rescue — a SET country != US is ALWAYS excluded):
 *   (1) meta.country set != "United States" -> EXCLUDE unconditionally (kills AZN/GSK/BHC/BNTX/ARGX/GMAB/ALKS);
 *   (2) FOREIGN_NAME legal-form regex over meta.name catches undefined-country foreign primaries (Novartis AG,
 *       Novo Nordisk A/S, Takeda …Limited);
 *   (3) the 5-letter pink-sheet ADR rule /^[A-Z]{4}[FY]$/ (RHHBY/NONOF/CSLLY/BEIGF);
 *   (4) PHARMA_FOREIGN_DROP = the frozen ADR drop-set — Vintage-A country-blind foreign primaries whose name
 *       has no foreign legal form the regex catches (SNY "Sanofi", + NVO/NVS/TAK belt-and-suspenders), each
 *       verified foreign-domiciled;
 *   (5) US_PRIMARY_ALLOWLIST = {JAZZ} — the verified US-PRIMARY foreign-NAME flagship the design NAMES as a
 *       marquee (JAZZ = "Jazz Pharmaceuticals plc", Ireland-domiciled BUT NasdaqGS-PRIMARY; its name matches
 *       FOREIGN_NAME \bplc\b and would be wrongly dropped). Mirrors classify-materials {CRH,LIN} / classify-
 *       energy {SLB}. Admits ONLY this name-verified US-primary; every other plc/Ltd/AG/A.S/foreign-country
 *       name stays excluded.
 * Currency-bug hard-assert (§1.2): no real US-listed commercial pharma exceeds ~$100B annual rev; >$150B is a
 * currency-bug fingerprint (un-converted non-USD Vintage-A giant) — throw fail-loud rather than classify it.
 *
 * Resolves the court-buckets.json persistence gap (gitignored / externally produced): the pharma classification
 * is regenerated reproducibly by THIS committed script. Run modes:
 *   node scripts/classify-pharma.js            -> report counts + marquee + foreign-control check (dry-run)
 *   node scripts/classify-pharma.js --emit      -> print {classifications:[...]} JSON to stdout
 *   node scripts/classify-pharma.js --merge      -> merge pharma entries into outputs/court-buckets.json
 *
 * Verified target (recomputed live 2026-06-23): branded 10 / biopharma 22 / specialty 14; all 16 marquees
 * classify (LLY/MRK/PFE/ABBV/BMY/AMGN/GILD/JNJ branded; VRTX/REGN/BIIB(branded)/INCY/JAZZ/EXEL biopharma;
 * NBIX/VTRS specialty); the foreign primaries (AZN/NVS/NVO/SNY/TAK/BNTX/ARGX/GMAB/ALKS/GSK/RHHBY/BHC) all DROP.
 *
 * M&A DECONTAMINATION — LOCAL-DATA PATH (the feasibility decision; disclosed coverage limitation): the design
 * re-points M&A onto INTANGIBLES/IPR&D, but the LOCAL snapshots/<T>.json annualBalance carries ONLY
 * {totalCash,totalDebt,totalAssets} — NO intangibles/goodwill/IPR&D/annualShares — and data/ma-rpo-snapshot-
 * pharma.json is ABSENT. Pulling the network EDGAR companyfacts join is forbidden. So pharma uses the SAME
 * LOCAL totalAssets-jump deal-mask as industrials/staples/consdisc/materials/energy (sign-aware, positive
 * jumps only) to decontaminate the organic-growth axis (court-screen buildPharmaAxes). The intangible-
 * amortization-drag + ipr&d-acquirer lamps (which REQUIRE the absent external join) are SHIPPED OMITTED and
 * disclosed as a coverage limitation (court-score a2Note MA_INTANGIBLE_BLIND wall). Net-share-issuance is not a
 * scored axis (Vintage-A lacks annualShares) — DILUTION_HIGH advisory lamp only where computable.
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

// --- §1.2 vintage-tolerant COUNTRY-DOMICILE-GUARD US-listing test (pharma-hardened, NO inversion rescue) ---
const US_EXCH = new Set(['NYSE', 'NasdaqGS', 'NasdaqGM', 'NasdaqCM', 'NYSEArca', 'NYSE American', 'Nasdaq', 'Cboe US', 'US']);
const OTC_EXCH = new Set(['OTC Markets OTCPK', 'OTC Markets OTCQX', 'OTC Markets OTCQB', 'Other OTC', 'Pink Sheets']);
const FOREIGN_SUFFIX = /\.(HK|SW|TO|L|PA|DE|F|MI|AS|ST|HE|CO|OL|VI|SI|TW|KS|KQ|SS|SZ|T|MX|SA|BR|WA|IR|LS|MC|BK|JK|AX)$/i;
// Foreign legal-form suffix in the company NAME — catches undefined-country foreign primaries (Novartis AG,
// Novo Nordisk A/S, Takeda …Limited, AstraZeneca PLC). Anchored on word boundaries so US "Inc."/"Corp."/
// "Company"/"Co."/"Group"/"Holdings"/"Companies" never match. The US-primary marquee JAZZ ("Jazz Pharmaceuticals
// plc") that DOES match \bplc\b is admitted via the US_PRIMARY_ALLOWLIST override below.
const FOREIGN_NAME = /\b(P\.?L\.?C\.?|S\.?A\.?B\.?\s+de\s+C\.?V\.?|S\.?A\.?\b|N\.?V\.?|A\.?S\.?\b|A\/S|AG|OYJ|ASA|S\.?p\.?A\.?|SE|Bhd|Berhad|PJSC|O[AP]O|Limited|Ltd)\b/i;
// Frozen ADR / foreign-primary drop-set (§1.2). Vintage-B country-set foreigners are ALSO caught by the
// country!=US rule below; this set additionally closes the Vintage-A (country-blind) leak whose name carries no
// foreign legal form the regex catches (SNY "Sanofi"), plus NVO/NVS/TAK belt-and-suspenders. Each verified
// foreign-domiciled. Expand ONLY with a verified foreign-primary name.
const PHARMA_FOREIGN_DROP = new Set([
  'NVO', 'NVS', 'SNY', 'TAK', 'RHHBY', 'AZN', 'GSK', 'BHC',
  'BNTX', 'ARGX', 'GMAB', 'ALKS', 'NONOF', 'CSLLY', 'BEIGF',
]);
// Name-verified US-PRIMARY inversion allowlist (§1.2): foreign-NAME flagship whose PRIMARY listing is US, which
// the design NAMES as a marquee that MUST classify (so the guards above must NOT drop it):
//   JAZZ — Jazz Pharmaceuticals plc, Ireland-domiciled, Vintage-A (country undefined), NasdaqGS-PRIMARY biopharma.
//          Its name matches FOREIGN_NAME (\bplc\b) so the name-guard would wrongly drop it; the allowlist is the
//          deterministic, name-verified override (SI-5: a frozen set, not a per-ticker SCORE map). Mirrors
//          classify-materials {CRH,LIN} / classify-energy {SLB}. Expand ONLY with a verified US-primary name.
const US_PRIMARY_ALLOWLIST = new Set(['JAZZ']);

function isUSListing(m, ticker, companyName) {
  if (FOREIGN_SUFFIX.test(ticker)) return false;                              // .HK/.SW/.L/.TO/.SZ …
  if (/^[A-Z]{4}[FY]$/.test(ticker)) return false;                            // 5-letter pink-sheet ADR (RHHBY/NONOF/CSLLY/BEIGF)
  if (OTC_EXCH.has(m.region) || OTC_EXCH.has(m.exchangeName)) return false;   // pink-sheet ADRs
  if (US_PRIMARY_ALLOWLIST.has(ticker)) return true;                          // explicit US-primary override (before guards)
  if (PHARMA_FOREIGN_DROP.has(ticker)) return false;                          // frozen foreign-primary/ADR kill
  const ccy = m.reportingCurrency;
  if (m.country != null) {                                                    // Vintage B: country authoritative
    return m.country === 'United States';                                     // SET && != US -> EXCLUDE, no inversion rescue
  }
  // Vintage A: country undefined -> US-exchange + USD + NO foreign legal-form name
  if (FOREIGN_NAME.test(companyName || '')) return false;
  if (US_EXCH.has(m.region) && (ccy === 'USD' || ccy == null)) return true;
  return false;
}

// --- cohort sets (§1.3) — deterministic pure function of meta.industry ---
const PHARMA_BRANDED = new Set(['Drug Manufacturers - General']);
const PHARMA_BIOPHARMA = new Set(['Biotechnology']);
const PHARMA_SPECIALTY = new Set(['Drug Manufacturers - Specialty & Generic']);
const PHARMA_DEDUPE_DROP = new Set([]); // keep liquid primary; verified no dual-listing in the US pool

// --- §1.4 COMMERCIAL GATE (profitability-based) ---
const PHARMA_COMMERCIAL_REV = 500e6;   // annualRev[0] >= $500M
const PHARMA_COMMERCIAL_MINYEARS = 3;  // >= 3 revenue-bearing annual years
// commercialGate(rec): the design's cash-generation separator — defers the cash-burning clinical names that
// HAVE product revenue (sign-separated OUT-OF-CLASS, not a quality penalty) while keeping commercial generics.
function commercialGate(rec) {
  const a = rec.annual || {};
  const revA = (a.annualRev || []).map(num);
  const revNN = revA.filter(v => v != null && isFinite(v));
  const rev0 = revNN[0];
  if (rev0 == null || rev0 < PHARMA_COMMERCIAL_REV) return false;
  if (revNN.length < PHARMA_COMMERCIAL_MINYEARS) return false;
  const opA = (a.annualOpInc || []).map(num);
  const fcfA = (a.annualFCF || []).map(num);
  const opM = (opA[0] != null && revA[0] != null && revA[0] > 0) ? opA[0] / revA[0] : null;
  const fcfM = (fcfA[0] != null && revA[0] != null && revA[0] > 0) ? fcfA[0] / revA[0] : null;
  return (opM != null && opM >= 0) || (fcfM != null && fcfM >= 0);
}

// Marquee watchlist (§6 frozen): the design's named flagships that MUST each classify+score, else the universe
// silently collapsed (the country-vintage-collapse regression guard). 1+ from each cohort. (BIIB classifies as
// branded per Yahoo's "Drug Manufacturers - General" industry string — verified live.)
const PHARMA_MARQUEE = Object.freeze(['LLY', 'MRK', 'PFE', 'ABBV', 'BMY', 'AMGN', 'GILD', 'JNJ',
  'VRTX', 'REGN', 'BIIB', 'INCY', 'JAZZ', 'EXEL', 'NBIX', 'VTRS']);
// Positive-control (§1.2/§9): the foreign-primary leak the §1.2 hardening must keep OUT. Catches a regression
// that drops a guard (country-domicile / FOREIGN_NAME / 5-letter-ADR / PHARMA_FOREIGN_DROP).
const PHARMA_FOREIGN_CONTROL = Object.freeze(['AZN', 'NVS', 'NVO', 'SNY', 'TAK', 'BNTX', 'ARGX', 'GMAB',
  'ALKS', 'GSK', 'RHHBY', 'BHC']);

function classifyPharma(rec) {
  const m = rec.meta || {};
  const t = m.ticker;
  const nm = m.name || m.shortName || m.longName || '';
  if (PHARMA_DEDUPE_DROP.has(t)) return null;                    // excluded[]
  if (m.sector !== 'Healthcare') return null;                    // Yahoo label for the pharma sector
  let coh = null;
  if (PHARMA_BRANDED.has(m.industry)) coh = 'pharma_branded';
  else if (PHARMA_BIOPHARMA.has(m.industry)) coh = 'pharma_biopharma';
  else if (PHARMA_SPECIALTY.has(m.industry)) coh = 'pharma_specialty';
  else return null;                                              // non-pharma HC industry -> SI-4 null+excluded[]
  if (!isUSListing(m, t, nm)) return null;                       // §1.2 country-domicile guard + FOREIGN hardening
  const mc = num(rec.marketCap);
  if (mc == null || mc < 1e9) return null;                       // §1.1 $1B size earmark (num(), not naive >=)
  // §1.2 currency-bug hard-assert: a >$150B annual-rev "US" name is an un-converted non-USD Vintage-A giant.
  const annualRev0 = num(((rec.annual || {}).annualRev || [])[0]);
  if (annualRev0 != null && annualRev0 > 150e9) {
    throw new Error(`CURRENCY-BUG: ${t} annualRev[0]=${(annualRev0 / 1e9).toFixed(0)}B — un-converted non-USD foreign primary survived isUSListing`);
  }
  // §1.4 COMMERCIAL GATE: defer cash-burning clinical-stage (sign-separated OUT-OF-CLASS, future special-track).
  if (!commercialGate(rec)) return null;                         // pre-commercial/clinical -> not in court-buckets
  return coh;
}

function run() {
  if (!fs.existsSync(SNAP_DIR)) { console.error('snapshots/ missing — run a pull first'); process.exit(1); }
  const files = fs.readdirSync(SNAP_DIR).filter(f => f.endsWith('.json') && !/\./.test(f.replace(/\.json$/, '')));
  const classifications = [];
  const byTicker = {};
  let scanned = 0, healthcareSector = 0;
  for (const f of files) {
    let rec;
    try { rec = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); } catch { continue; }
    scanned++;
    if (rec.meta && rec.meta.sector === 'Healthcare') healthcareSector++;
    const bucket = classifyPharma(rec);
    if (bucket) {
      const t = rec.meta.ticker;
      classifications.push({ t, bucket, confidence: 1.0 });
      byTicker[t] = bucket;
    }
  }
  return { classifications, byTicker, scanned, healthcareSector };
}

const PHARMA_BUCKETS = new Set(['pharma_branded', 'pharma_biopharma', 'pharma_specialty']);
const r = run();
const branded = r.classifications.filter(c => c.bucket === 'pharma_branded');
const biopharma = r.classifications.filter(c => c.bucket === 'pharma_biopharma');
const specialty = r.classifications.filter(c => c.bucket === 'pharma_specialty');
const missingMarquee = PHARMA_MARQUEE.filter(t => !PHARMA_BUCKETS.has(r.byTicker[t]));
const leakedControl = PHARMA_FOREIGN_CONTROL.filter(t => PHARMA_BUCKETS.has(r.byTicker[t]));

const arg = process.argv[2];
if (arg === '--emit') {
  process.stdout.write(JSON.stringify({ classifications: r.classifications }, null, 2));
} else if (arg === '--merge') {
  if (missingMarquee.length) { console.error('MARQUEE FAIL, refusing to merge: ' + missingMarquee.join(', ')); process.exit(1); }
  if (leakedControl.length) { console.error('FOREIGN-CONTROL FAIL, refusing to merge: ' + leakedControl.join(', ')); process.exit(1); }
  let buck = { classifications: [] };
  try { buck = JSON.parse(fs.readFileSync(BUCK, 'utf8')); } catch {}
  const arr = Array.isArray(buck.classifications) ? buck.classifications : (Array.isArray(buck) ? buck : []);
  const kept = arr.filter(c => !PHARMA_BUCKETS.has(c.bucket));
  const out = Array.isArray(buck) ? kept.concat(r.classifications) : Object.assign({}, buck, { classifications: kept.concat(r.classifications) });
  fs.writeFileSync(BUCK, JSON.stringify(out, null, 2));
  console.log(`merged ${r.classifications.length} pharma entries into court-buckets.json (branded ${branded.length} / biopharma ${biopharma.length} / specialty ${specialty.length})`);
} else {
  console.log(`scanned ${r.scanned} snapshots; ${r.healthcareSector} meta.sector==="Healthcare"`);
  console.log(`classified: pharma_branded ${branded.length} | pharma_biopharma ${biopharma.length} | pharma_specialty ${specialty.length} | total ${r.classifications.length}`);
  console.log(`marquee coverage (${PHARMA_MARQUEE.length}): ${missingMarquee.length ? 'FAIL missing ' + missingMarquee.join(',') : 'PASS all classified'}`);
  console.log(`foreign-control (AZN/NVS/NVO/SNY/TAK/BNTX/ARGX/GMAB/ALKS/GSK/RHHBY/BHC must NOT classify): ${leakedControl.length ? 'FAIL leaked ' + leakedControl.join(',') : 'PASS all excluded'}`);
  console.log(`branded sample: ${branded.slice(0, 14).map(c => c.t).join(', ')}`);
  console.log(`biopharma sample: ${biopharma.slice(0, 14).map(c => c.t).join(', ')}`);
  console.log(`specialty sample: ${specialty.slice(0, 14).map(c => c.t).join(', ')}`);
}

module.exports = {
  classifyPharma, isUSListing, num, commercialGate,
  PHARMA_BRANDED, PHARMA_BIOPHARMA, PHARMA_SPECIALTY, PHARMA_DEDUPE_DROP,
  PHARMA_MARQUEE, PHARMA_FOREIGN_CONTROL,
  PHARMA_FOREIGN_DROP, US_PRIMARY_ALLOWLIST,
  PHARMA_COMMERCIAL_REV, PHARMA_COMMERCIAL_MINYEARS,
};
