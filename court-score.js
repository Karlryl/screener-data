#!/usr/bin/env node
/**
 * court-score.js — Schritt 2 von 2: das court-gehärtete Skelett, cross-sectional je Bucket.
 *
 * Liest:
 *   outputs/court-candidates.json   (Achsen-Rohwerte aller Kandidaten, aus court-screen.js)
 *   outputs/court-buckets.json      ({classifications:[{t,bucket,confidence}]} aus dem Klassifikations-Workflow)
 * Rechnet je Formel-Bucket:
 *   Membership-Gate (logistisch) · Stage-Buckets (FCF-Marge) · pseudo-z=(x−Median)/MAD ·
 *   tanh-Sättigung · additive Gewichte · gedeckelte Penalties · Floor-0 · Kollaps-Detektor (Spearman).
 * Schreibt outputs/court-results.json und druckt Top-X je Stage.
 *
 * WICHTIG: Konstanten sind [TODO-CAL] (ungekalibriert) -> verified-DESIGN, nicht verified-Instance.
 * SaaS v1.1 (2026-06-16, Court PASS): A2-Forward-Book-Demand-Achse AKTIV (degraded=false), 5-Achs-Vektor
 *       {A1 .429, A2 .35, A3gm .0715, A3opm .0715, A4 .078}. A2 = additiver RPO-Growth+Level-Blend mit
 *       continuous Base-Credibility-Gates. Details: a2Note (FORMULAS) + Spec v1.1. (v1.0 lief degradiert.)
 */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const { absKaliber, blendScore, gateOpen, normTableId: getNormTableId, NORMS } = require('./lib/absolute-anchor');
// Medtech M&A snapshot (advisory lamps; object keyed by ticker)
const maMedtechRaw = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'ma-rpo-snapshot-medtech.json'), 'utf8')); } catch { return {}; } })();
// Remove _header key
const maMedtechByTicker = new Map(Object.entries(maMedtechRaw).filter(([k]) => k !== '_header'));
// D&LST M&A snapshot (advisory lamps; chronic-acquirer / impairment / cum-payments). Schema differs from
// medtech: per-year revenue denominator (revenueHistory), cumDeltaGoodwillPctRev, cumPaymentsToRev,
// impairmentFlag (negative ΔGoodwill clamped). Object keyed by ticker; _header removed.
const maDlstRaw = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'ma-rpo-snapshot-dlst.json'), 'utf8')); } catch { return {}; } })();
const maDlstByTicker = new Map(Object.entries(maDlstRaw).filter(([k]) => k !== '_header'));
const CAND = process.env.COURT_CAND_OUT || path.join(ROOT, 'outputs', 'court-candidates.json');
const BUCK = path.join(ROOT, 'outputs', 'court-buckets.json');
const OUT = process.env.COURT_OUT || path.join(ROOT, 'outputs', 'court-results.json'); // env-Override → Test/Verify-Harness schreibt isoliert (Re-Court-Auflage: keine geteilten Outputs racen)

const median = xs => { const s = xs.filter(v => v != null && isFinite(v)).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mad = xs => { const md = median(xs); if (md == null) return null; const d = median(xs.map(v => Math.abs(v - md))); return d; };
const clip = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const logistic = (x, c, s) => 1 / (1 + Math.exp(-(x - c) / s));
const log10 = x => Math.log(x) / Math.LN10;

// pseudo-z mit robustem Median/MAD; mad==0 -> z=0
function sAxis(raw, med, m, k) {
  if (raw == null || med == null || m == null || m === 0) return 0; // neutral
  const z = (raw - med) / m;
  return Math.tanh(z / k); // [-1,1]
}

// Spearman-Rangkorrelation (für Kollaps-Detektor) — TIE-AVERAGED Ränge (order-stabil; Re-Court-Auflage:
// ohne Mittel-Rang war rhoDom reihenfolge-abhängig 0.68–0.86 bei durS-Ties MXL=AMBA=-1).
function spearman(a, b) {
  const n = a.length; if (n < 3) return null;
  const rank = arr => {
    const idx = arr.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
    const r = Array(arr.length);
    let i = 0;
    while (i < idx.length) {
      let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1; // Mittel der Ränge (i+1 … j+1) für gleiche Werte
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(a), rb = rank(b);
  const ma = ra.reduce((s, v) => s + v, 0) / n, mb = rb.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = ra[i] - ma, y = rb[i] - mb; num += x * y; da += x * x; db += y * y; }
  return (da && db) ? num / Math.sqrt(da * db) : null;
}

// --- Formel-Konfigurationen (alle Konstanten [TODO-CAL]) ---
const FORMULAS = {
  fabless_semi: {
    label: 'Fabless-AI-Connectivity-Semis v5.1',
    membership: { g: { c: 0.25, s: 0.05 }, gm: { c: 0.50, s: 0.05 }, scaleLog: { c: log10(50), s: 0.40 } },
    axes: [
      { key: 'growth', name: 'Growth', k: 2.5, w: 0.35 },
      { key: 'gm', name: 'GM', k: 1.0, w: 0.25 },
      { key: 'durability', name: 'Durability', k: 1.0, w: 0.25 },
      { key: 'accel', name: 'Accel', k: 2.0, w: 0.15 },
    ],
    dilCap: 8, dilStart: 0.05, dilRange: 0.20,
    stages: [
      { name: 'Profitabel', test: f => f > 0.05 },
      { name: 'Inflection', test: f => f >= -0.05 && f <= 0.05 },
      { name: 'Pre-profit', test: () => true },
    ],
    dominantBlock: ['gm', 'durability'],
    degraded: false,
  },
  system_app_software: {
    label: 'System-&-Application-SaaS v1.1 (A2 forward-book-demand axis live)',
    membership: { g: { c: 0.28, s: 0.07 }, gm: { c: 0.55, s: 0.10 }, scaleLog: { c: 2.0, s: 0.45 } },
    // v1.1 5-axis (A2 forward-book activated). Weights = degraded {A1 .66, A3gm .11, A3opm .11, A4 .12} * (1-0.35), A2=0.35. Sum=1. All [TODO-CAL].
    axes: [
      { key: 'growth', name: 'A1-Growth', k: 2.6, w: 0.4290 },
      { key: 'a2Forward', name: 'A2-Forward', k: 2.5, w: 0.3500 },
      { key: 'gm', name: 'A3-GM', k: 1.6, w: 0.0715 },
      { key: 'opMargin', name: 'A3-OpMargin', k: 1.6, w: 0.0715 },
      { key: 'roicMinusWacc', name: 'A4-ROIC-WACC', k: 1.8, w: 0.0780 },
    ],
    dilCap: 12, dilStart: 0.05, dilRange: 0.10,
    stages: [
      { name: 'S3-Cash-Compounder', test: f => f >= 0.20 },
      { name: 'S2-FCF-positiv', test: f => f >= 0.08 },
      { name: 'S1-Approaching', test: f => f >= -0.05 },
      { name: 'S0-Land-Grab', test: f => f >= -0.25 },
      { name: 'below-line', test: () => true },
    ],
    dominantBlock: ['gm', 'opMargin'],
    degraded: false,
    a2Note: 'A2 = additive forward-book-DEMAND axis (0.65*credibility(rpoPrior)*s(rpoGrowthYoY) + 0.35*credibility(rpoLatest)*s(rpoToRev)). It rewards a building forward book and refuses to reward a flat one; it BREAKS the flat-book anchor-inversion (GEN: 21% M&A flow + 1.3% RPO growth -> #2 -> #7). It is NOT a standalone organic-vs-inorganic detector: a roll-up whose acquired deferred-revenue book inflates reported RPO (e.g. BRZE) reads as forward demand here; the M&A-flow control remains the SEPARATE inorganicFlag lamp. Continuous base-credibility gates (B0=$50M,B1=$300M) neutralise small-base artefacts (WAY/SDGR) and never punish a small/absent book. CAVEATS [TODO-CAL + disclosed]: GEN ranks below FIG/DUOL/HNGE robustly across wA2 in [0.33,0.50] & GW>=0.57; GEN ranks below DDOG (the weakest cohort member) for wA2>=~0.34 & GW>=~0.61, and is co-ranked with DDOG (within ~0.1-1.2pt) at the wA2<=0.34 / low-GW (0.57-0.64) corner — the ship point GW=0.65,wA2=0.35 sits safely inside the holding region (grid-verified 204/216 cells in wA2[0.33,0.50]xGW[0.57,0.68]; 12 edge-corner co-ranks: 8 at wA2=0.33, 4 at wA2=0.34). below-median RPO-growth yields negative sA2 (cross-sectional relative read, not absolute); names with null rpoPrior (CWAN) escape the growth test (neutral, lamp-only); RPO-concept-heterogeneity — 8/44 substitute DeferredRevenue/ContractWithCustomerLiability for true RemainingPerformanceObligation (understate forward book vs true-RPO reporters; the level-anchor mixes concepts; empirically contained at ship — proxy names land near-neutral — but the load-bearing assumption most likely to break under recalibration/universe-expansion). verified-DESIGN not -instance; forward-fitness calendar-gated ~2026-07-14.',
  },
  medtech_devices: {
    label: 'Medtech-Devices v1.3 (absolute-anchor, deceleration-aware organic growth min(latest,blend), deal-year-exclusion, full-universe SI-5)',
    membership: { g: { c: 0.10, s: 0.05 }, gm: { c: 0.45, s: 0.08 }, scaleLog: { c: log10(300), s: 0.5 } },
    axes: [
      { key: 'growth',         name: 'Growth',     k: 2.0, w: 0.45 },
      { key: 'gm',             name: 'GM-Level',   k: 1.5, w: 0.20 },
      { key: 'opLeverage',     name: 'OpLeverage', k: 1.0, w: 0.15 },
      { key: 'opMargin',       name: 'OpMargin',   k: 1.5, w: 0.12 },
      { key: 'gmTrend',        name: 'GM-Trend',   k: 1.0, w: 0.04 },
      { key: 'rdProductivity', name: 'RD-Prod',    k: 1.5, w: 0.04 },
    ],
    dilCap: 8, dilStart: 0.05, dilRange: 0.20,
    stages: [
      { name: 'S3-High-Margin', test: f => f >= 0.20 },
      { name: 'S2-FCF-positiv', test: f => f >= 0.08 },
      { name: 'S1-Approaching', test: f => f >= -0.05 },
      { name: 'S0-Land-Grab',   test: () => true },
    ],
    dominantBlock: ['gm', 'opMargin'],
    degraded: false,
    normTableId: 'medtech-norms-2026-06-20',
    // v1.1: M&A-jump-in-window lamp + growthAdj discount + ALMR growth cap [TODO-CAL]
    // v1.2: deal-year-exclusion replaces magnitude-discount; full-universe SI-5; Out-class score=null
    // v1.3: DECELERATION-AWARE growth — growthOrganic = min(latestOrganicYoY, 0.6*CAGR+0.4*median blend);
    //       the blend is a BACKWARD durability view only; gateOpen floor evaluated on latestOrganicYoY.
    a2Note: 'v1.3 (Court-DENIED-4:1 remediation): the v1.2 medtech GROWTH AXIS INPUT was DECELERATION-BLIND — growthOrganic was the pure backward blend 0.6*CAGR_3y + 0.4*median(trailing organic YoY) on the HEAVIEST axis (growth w=0.45). It INFLATED decelerating names above their current organic rate and SILENTLY BYPASSED the gateOpen floor (growth>=0.15): INSP latest organic YoY 13.6% (<15% floor) read as 30% blend → cleared gate → shortlist #3 with no deal; TMDX latest 37% read as 85% → #2. v1.3 FIX: the medtech growth axis uses growthOrganic = min(latest-organic-YoY, multi-year blend), so a decelerating name can NEVER read above its current organic rate; the multi-year blend (0.6*CAGR+0.4*median over deal-year-excluded organic years) is retained ONLY as a SECONDARY backward DURABILITY signal (persisted growthBlend), never the primary axis input. (II) the hard gateOpen floor (growth>=0.15) is evaluated EXPLICITLY on latestOrganicYoY (the current organic rate), not the blend — so INSP (13.6%) now DROPS off the headlineShortlist. (III) deceleration LAMP when latestOrganicYoY < median(prior organic years); trailing-window-growth advisory lamp when blend diverges from latestOrganicYoY by >~50%. (VI) deal-year-excluded names left with <2 organic years (GMED) get a current-year-only LAMP (the 0.6/0.4 blend did NOT run) and use the single current-year organic YoY explicitly. (VII) FY-reconciliation HARD ASSERT: when a deal-year drop occurs, cache revLatest and SEC annualRevenue must reconcile within 15% or scoring FAILS LOUD (the unlabeled revYoY series and goodwillHistory[].end could otherwise be on different fiscal calendars). Inherited v1.2 fixes: (A SI-5) full-universe (classifiedCount===scoredCount); (B) winsorized organic growth (cap 1.0) → no ALMR 195% leak; (C SI-4) Out-class score=null + excluded[]; (D) deal-year-exclusion (drop YoY of any year whose goodwill jumped >=25% of rev + 1 catch-up year); (F) M&A-coverage-null lamp; (G SI-3) comparabilityNote; (H) baseline frozen. Constants [TODO-CAL]: DEAL_JUMP_THRESH 0.25, W_CAGR 0.6, W_MEDIAN 0.4, CATCH_UP_YEARS 1 [TODO-CAL: widening goodwill/rev history window could retain >=2 organic years for GMED], FY_RECON_TOL 0.15. Additive/parity-safe: SaaS/Fabless byte-identical to _parity-baseline-pre-v13.',
  },
  diagnostics_lst: {
    label: 'Diagnostics-&-Life-Science-Tools v0 (cohort-aware dx|tools, absolute-anchor, deceleration-aware organic growth, FCF-efficiency, chronic-acquirer lamps)',
    membership: { g: { c: 0.10, s: 0.05 }, gm: { c: 0.40, s: 0.10 }, scaleLog: { c: log10(300), s: 0.5 } },
    // REL-Achsen (core / cross-sektional z/MAD): growth (deceleration-aware organic), GM-Level, eff (FCF-Marge
    // mit OpM-Fallback), capex (niedriger = besser → invertiert beim Stats-Lesen). Gewichte spiegeln die
    // absKaliber-Betonung {growth .40, gm .20, eff .40}; capex als kleines Quality-Tiebreak.
    axes: [
      { key: 'growth',    name: 'Growth',  k: 2.0, w: 0.40 },
      { key: 'gm',        name: 'GM-Level', k: 1.5, w: 0.18 },
      { key: 'effDlst',   name: 'Eff-FCF', k: 1.5, w: 0.38 },
      { key: 'capexNeg',  name: 'Capex',   k: 1.5, w: 0.04 },
    ],
    dilCap: 8, dilStart: 0.05, dilRange: 0.20,
    stages: [
      { name: 'S3-Cash-Compounder', test: f => f >= 0.20 },
      { name: 'S2-FCF-positiv',     test: f => f >= 0.08 },
      { name: 'S1-Approaching',     test: f => f >= -0.05 },
      { name: 'S0-Land-Grab',       test: () => true },
    ],
    dominantBlock: ['gm', 'effDlst'],
    degraded: false,
    normTableId: 'dlst-norms-2026-06-20',
    cohortAware: true, // schaltet die per-Kohorte-Stats + per-Kohorte-GM-NORM + Zyklik-Lampe an
    absWeights: { growth: 0.40, gm: 0.20, eff: 0.40 },
    a2Note: 'D&LST v0 (PRE-GAUNTLET — Council/Court am Monats-Spend-Limit 2026-06-20 BLOCKIERT; verified-DESIGN, NICHT -instance). ONE bucket `diagnostics_lst` with a `cohort` tag (dx | tools), cohort-aware at THREE places (Spec §1): (1) GM-NORMS PER COHORT (dx floor .50/elite .65, tools .38/.58) — a pooled GM pillar would let TMO ~41% corrupt IDXX ~58%; (2) REL cross-sectional stats PER COHORT (dx z-scored vs dx, tools vs tools) — a cyclical tools trough must not drag the dx medians; (3) cyclicality lamp per cohort (tools=watch-wave-turn advisory, dx-red=genuine concern). GROWTH (reused medtech v1.3 deceleration-safe metric): growthOrganic = min(latestOrganicYoY, 0.6*CAGR_3y+0.4*median organic YoY); deal-year-exclusion threshold 0.15*rev (Adjustment 1 — serial-acquirers DHR/TMO with deals under the 0.25 trip); blend-median per-year floor -15% (Adjustment 2 — a -42% instrument quarter / -23% deal-year must not zero the multi-year memory), latest UNcapped; the hard gateOpen floor (growth>=0.15) reads latestOrganicYoY. EFFICIENCY = FCF-margin PRIMARY (razor-blade → genuinely cash-generative after instrument placement), FALLBACK to operatingMargin when fcfMarginTTM is null OR >15pp below opMargin (M&A cash distortion, e.g. TMO integration year); norm eff floor .10/elite .25. absKaliber weights {growth .40, gm .20, eff .40}, beta 0.6, score=100*(0.6*ABS+0.4*REL). LAMPS (additive to the structure): chronic-acquirer (goodwillToRev>1.0 OR cumDeltaGoodwillPctRev>0.40 — the single-year detector UNDERfires on DHR-style bolt-on serial acquirers), cumPaymentsToRev (>0.15, 65.5% coverage → usable, separates AZTA/DHR/RGEN/TMO from organic TXG/BIO/AVTR/RVTY), goodwill-impairment (impairmentFlag — negative ΔGoodwill is a write-down NOT a jump, e.g. NEOG/ILMN-GRAIL dropped from maxJump/cumDelta in the snapshot), deal-year-jump (maxGoodwillJumpPctRev>=0.15 advisory), cyclicality (per cohort), recurring-mix (advisory, cohort-level note). R&D + shares DEFERRED (Spec §2 data walls not yet hydrated) → coverage-null lamps (rd-missing, shares-missing), degrade gracefully, NEVER penalize missing. SI-4 (Out-class score=null + excluded[]); SI-5 (classifiedCount===scoredCount, fail-loud); SI-3 (comparabilityNote + cohort + normTableId); SI-6 (frozen fitness baselines/diagnostics-lst-v1.0-2026-06-20.json). KNOWN-TODO (Spec §4): the dlst snapshot header claims a per-year revenue denominator fix for deltaGoodwill/rev; if maxGoodwillJumpPctRev were ever recomputed with a revLatest denominator it would fabricate 100%+ jumps on divestitures (RVTY/ILMN) — verified the shipped snapshot already uses revenueHistory (per-year), so this is recorded as a TODO-watch, not an active bug. Additive/parity-safe: SaaS/Fabless/Medtech byte-identical to _parity-baseline-pre-dlst. Constants [TODO-CAL]: DEAL_JUMP_THRESH_DLST 0.15, BLEND_YOY_FLOOR -0.15, FCF_FALLBACK_GAP 0.15, CHRONIC_GWREV 1.0, CHRONIC_CUMDELTA 0.40, CUMPAY 0.15.',
  },
};

const WACC = 0.09; // [TODO-CAL] grober Proxy für A4

// --- Skeptiker-Welle-2-Befunde, deterministisch eingebaut ---
const KILL = new Set(['PS', 'RDVT', 'ADEA', 'OMDA', 'TEM', 'KMTS']); // verifiziert: Ticker-Mismatch / falscher Sektor / Daten-Fehler
const INORGANIC_FALLBACK = new Set(['GEN', 'AVGO']);                 // hardcoded fallback: AVGO in fabless_semi has no snapshot row; GEN covered by data-driven rule but kept here for safety
const MEGACAP_REVM = 15000;                                          // > $15B Umsatz = Mega-Cap (Fabless: vom Small-Cap-Kern trennen)

// --- D&LST recurring-/consumables-mix ADVISORY (Spec §5) — kleine gefrorene Per-Ticker-Tabelle ---
// NICHT gescort (n zu dünn), nur Lampe/Tiebreaker. Razor-blade/Consumables-heavy vs Instrument-heavy.
// Quelle: Spec §5 (IDXX/EXAS hoch recurring; PACB/TXG/ILMN instrument-heavy; TMO/DHR mixed → keine Lampe).
const DLST_RECURRING_HIGH = new Set(['IDXX', 'EXAS', 'NTRA', 'GH', 'VCYT', 'NEO', 'CDNA', 'RGEN', 'AVTR', 'IQV']);
const DLST_INSTRUMENT_HEAVY = new Set(['ILMN', 'TWST', 'BRKR', 'MTD', 'WAT', 'A', 'BIO']);

// --- A2 forward-book-demand axis (v1.1) — additive, composite; constants [TODO-CAL] ---
const A2_B0 = 50e6, A2_B1 = 300e6, A2_GW = 0.65; // base-credibility floor/ceiling (USD); growth-vs-level tilt
// continuous base-credibility: <=B0 -> 0 (no credit), >=B1 -> 1, smooth log10 ramp between. No cliff, no per-name boundary.
const cred = b => (b == null || b <= A2_B0) ? 0 : (b >= A2_B1 ? 1 : log10(b / A2_B0) / log10(A2_B1 / A2_B0));
// blended sA2 in [-1,1]: un-normalised neutral-shrink — an uncredible/absent book pulls toward 0 (neutral), NEVER a penalty. Cannot zero a name (enters core as w*(s+1)/2 >= 0).
function computeA2Forward(rec, sA2stats) {
  if (!rec) return 0;                                               // no snapshot coverage -> neutral
  const sGrowth = rec.rpoGrowthYoY == null ? null : sAxis(rec.rpoGrowthYoY, sA2stats.gMed, sA2stats.gMad, 2.5);
  const sLevel  = rec.rpoToRev     == null ? null : sAxis(rec.rpoToRev,     sA2stats.lMed, sA2stats.lMad, 2.5);
  const g = (sGrowth != null) ? cred(rec.rpoPrior)  * A2_GW       * sGrowth : 0; // rpoPrior credibility kills small-base growth artefacts (WAY/SDGR)
  const l = (sLevel  != null) ? cred(rec.rpoLatest) * (1 - A2_GW) * sLevel  : 0; // rpoLatest credibility avoids punishing tiny/absent books (ZETA/TTAN)
  return g + l;
}

// --- Laden ---
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
const candDoc = readJson(CAND);
const byTicker = new Map(candDoc.candidates.map(c => [c.ticker, c]));
const buckDoc = readJson(BUCK);
const cls = Array.isArray(buckDoc) ? buckDoc : (buckDoc.classifications || []);
const bucketOf = new Map(cls.map(c => [c.t, c.bucket]));
const confOf = new Map(cls.map(c => [c.t, c.confidence]));
// D&LST cohort tag (dx | tools) aus court-buckets.json — deterministisch, treibt die kohorten-bewusste
// GM-NORM + die PER-KOHORTE cross-sektionalen REL-Stats (Spec §1: dx z-scored gegen dx, tools gegen tools).
const cohortOf = new Map(cls.filter(c => c.cohort).map(c => [c.t, c.cohort]));
// M&A/RPO snapshot (data-driven inorganic detection; 44 SaaS names; 400-day-freshness->NULL baked in)
const maRpoByTicker = new Map(readJson(path.join(ROOT, 'data', 'ma-rpo-snapshot.json')).map(r => [r.ticker, r]));

// audit/fix (gauntlet C5): US-Listing-Side-File (von court-screen.js geschrieben) für den
// GENERATIVEN Anti-Leak-Assert. Map ticker -> {country, region, exchangeName, reportingCurrency, isUS}.
// Bewusst SEPARAT von den candidate/member-Records → Member-JSON bleibt byte-identisch (Parität).
// TOLERANT: fehlt die Datei (z.B. isolierter Unit-Test ohne frischen Screen-Lauf), bleibt die Map
// leer und die Asserts no-op'en (sie können dann strukturell nichts prüfen, brechen aber NICHTS).
const LISTING_PATH = process.env.COURT_LISTING_OUT
  || (CAND.endsWith('.json') ? CAND.replace(/court-candidates([^/\\]*)\.json$/, 'court-listing$1.json') : path.join(ROOT, 'outputs', 'court-listing.json'));
const listingByTicker = new Map();
try {
  const ld = readJson(LISTING_PATH);
  const obj = ld && ld.listings ? ld.listings : (ld || {});
  for (const [t, rec] of Object.entries(obj)) listingByTicker.set(t, rec);
} catch { /* Side-File fehlt → Asserts no-op (siehe oben) */ }

// Data-driven inorganic-growth flag (replaces the hardcoded INORGANIC set). Deterministic (no Date/random).
// 'inorganic' = recent M&A FLOW >=15% of rev AND forward book flat (rpoGrowthYoY < 15%) -> growth is bought, not built.
// 'ambiguous' = high flow but RPO unknown. 'clean' = organic (low flow, or high flow WITH a building book). null = no snapshot coverage -> hardcoded fallback.
// Signal verified Iter 5: GEN pay 20.6% + rpoGrowth 1.3% (inorganic) vs DDOG pay 3.4% + rpoGrowth 43.6% (organic). Recent FLOW (not goodwill-stock) avoids the Iter-3 decade-old-goodwill false positives.
function inorganicFlag(t) {
  const r = maRpoByTicker.get(t);
  if (!r) return null;
  const pay = r.paymentsToRev, dgw = r.deltaGoodwillPctRev;
  const flowHi = (pay != null && pay >= 0.15) || (dgw != null && dgw >= 0.15); // 15% floor clears CDNS/CRWD ~8% tuck-ins
  if (!flowHi) return 'clean';
  if (r.rpoGrowthYoY == null) return 'ambiguous';
  return (r.rpoGrowthYoY < 0.15) ? 'inorganic' : 'clean';
}

function stageOf(formula, fcf) {
  if (fcf == null) return 'unknown';
  for (const s of formula.stages) if (s.test(fcf)) return s.name;
  return 'unknown';
}

// --- v1.3 (Court-DENIED-4:1 remediation): DECELERATION-AWARE organic growth metric (medtech-only) ---
// v1.2 war Court-DENIED 4:1 wegen eines DECELERATION-BLINDEN Growth-Inputs: growthOrganic war der reine
// rückwärtsgewandte Blend 0.6*CAGR_3y + 0.4*median(trailing organic YoY). Auf der SCHWERSTEN Achse
// (Growth w=0.45) hat der Blend dezelerierende Namen ÜBER ihre aktuelle organische Rate INFLATIERT und das
// gateOpen-Floor (growth>=0.15) STILL UMGANGEN: INSP latest organic YoY 0.136 (<0.15) → Blend 0.2986 → Gate
// auf → Shortlist; TMDX latest 37% → Blend 85% → #2.
//
// v1.3 FATALER FIX (Bedingung I): growthOrganic = min(latestOrganicYoY, blend).
//   - latestOrganicYoY = die JÜNGSTE deal-bereinigte YoY (kleinster Index, der NICHT vom Deal-Year-Exclusion
//     gedroppt wurde und endlich ist) = die AKTUELLE organische Rate.
//   - blend = 0.6*CAGR(verbleibende organische YoY) + 0.4*median(verbleibende organische YoY)
//     bleibt als SEKUNDÄRES 'durability'-Signal erhalten (result.blend), ist aber NICHT mehr der primäre
//     Achsen-Input. Durch das min() kann ein dezelerierender Name NIE über seiner aktuellen organischen Rate
//     gelesen werden → das gateOpen-Floor (Bedingung II) wird auf latestOrganicYoY scharf, weil
//     growthOrganic=min(latest,blend)<=latest gilt.
//
// Deal-Year-Exclusion (aus v1.2 übernommen): wenn das Goodwill in einem Jahr Y um >= 0.25*Revenue gesprungen
// ist (transformationaler Deal), wird die YoY DIESES Jahres UND des Folgejahres (Catch-up) GEDROPPT.
// FY-Reconciliation (Bedingung VII): index-basiertes Droppen ist nur sicher, wenn yoySeries (fundamentals-
// cache, KEINE Periodenlabels) und goodwillHistory (SEC, mit .end) auf derselben Fiskal-Achse liegen. Wir
// reconcilen über die Revenue-Skala (cache revLatest vs SEC snapAnnualRevenue): divergieren sie um mehr als
// FY_RECON_TOL, FAILT die Funktion LAUT (kein stilles Droppen des falschen Jahres für einen künftigen Ticker).
// Alle Konstanten [TODO-CAL]: DEAL_JUMP_THRESH (0.25), w_CAGR (0.6), w_median (0.4), CATCH_UP_YEARS (1).
const DEAL_JUMP_THRESH = 0.25;   // [TODO-CAL] goodwill-Sprung >= 25% von Revenue = transformationaler Deal-Jahr
const W_CAGR = 0.6, W_MEDIAN = 0.4; // [TODO-CAL] Blend CAGR_3y vs median(trailing YoY) — jetzt SEKUNDÄR (durability), nicht primär
const CATCH_UP_YEARS = 1;        // [TODO-CAL] zusätzlich gedroppte Folge-YoY (erstes volles inorganisches Jahr)
const FY_RECON_TOL = 0.15;       // [TODO-CAL] max |cacheRev/snapRev - 1| bevor index-aligned Drop als unsicher LAUT failt (VII)
function computeMedtechOrganicGrowth(yoySeries, goodwillHistory, revLatest, fallbackGrowth, opts) {
  // yoySeries: newest-first YoY-Reihe (rev[i]/rev[i+1]-1). goodwillHistory: [{val,end}] newest-first.
  // Beide newest-first annual → Index i in yoySeries entspricht goodwill-Sprung goodwillHistory[i] vs [i+1].
  // opts: { ticker, snapAnnualRev } für die FY-Reconciliation (VII).
  // Returns { growth (=min(latest,blend)), latestOrganicYoY, blend, organicYears, droppedIdx, dealYearExcluded,
  //           shortHistory, currentYearOnly, decelerating }.
  const result = {
    growth: fallbackGrowth, latestOrganicYoY: null, blend: null, organicYears: 0, droppedIdx: [],
    dealYearExcluded: false, shortHistory: false, currentYearOnly: false, decelerating: false,
  };
  if (!Array.isArray(yoySeries) || yoySeries.length === 0) return result;
  // Deal-Jahr-Indizes via goodwill-Sprung (nur wenn coverage vorhanden)
  const dropIdx = new Set();
  if (Array.isArray(goodwillHistory) && goodwillHistory.length >= 2 && revLatest != null && revLatest > 0) {
    for (let i = 0; i < goodwillHistory.length - 1; i++) {
      const newer = goodwillHistory[i] ? goodwillHistory[i].val : null;
      const older = goodwillHistory[i + 1] ? goodwillHistory[i + 1].val : null;
      if (newer == null || older == null) continue;
      const jump = (newer - older) / revLatest;
      if (jump >= DEAL_JUMP_THRESH) {
        // goodwill-Sprung [i]->[i+1] (Jahr i) → YoY-Index i ist das Deal-Jahr; +CATCH_UP_YEARS Folge-Jahre (kleinere Indizes = neuer)
        for (let k = 0; k <= CATCH_UP_YEARS; k++) { const idx = i - k; if (idx >= 0) dropIdx.add(idx); }
        result.dealYearExcluded = true;
      }
    }
  }
  // (VII) FY-RECONCILIATION HARD ASSERT: NUR wenn ein Index tatsächlich gedroppt wird (sonst ist eine
  // FY-Fehlausrichtung harmlos). yoySeries trägt keine Periodenlabels → wir reconcilen über die Revenue-Skala.
  // Wenn cache-revLatest und SEC-snapAnnualRev um mehr als FY_RECON_TOL divergieren, ist die Index-Ausrichtung
  // (goodwillHistory[i] vs yoySeries[i]) NICHT verlässlich → LAUT failen statt das falsche Jahr zu droppen.
  if (dropIdx.size > 0 && opts && opts.snapAnnualRev != null && revLatest != null && opts.snapAnnualRev > 0 && revLatest > 0) {
    const ratio = revLatest / opts.snapAnnualRev;
    if (Math.abs(ratio - 1) > FY_RECON_TOL) {
      throw new Error(
        `FY-Reconciliation FAILED for ${opts.ticker || '?'}: deal-year exclusion would drop index ` +
        `${[...dropIdx].join(',')} but cache revLatest (${Math.round(revLatest)}) and SEC annualRevenue ` +
        `(${Math.round(opts.snapAnnualRev)}) diverge by ${((ratio - 1) * 100).toFixed(1)}% (> ${FY_RECON_TOL * 100}% tol). ` +
        `goodwillHistory[].end and the (unlabeled) revYoY series are likely on different fiscal calendars — ` +
        `index-aligned dropping is unsafe. Fix the snapshot/cache alignment before scoring this ticker.`
      );
    }
  }
  // latestOrganicYoY = jüngste (kleinster Index) NICHT gedroppte endliche YoY = aktuelle organische Rate.
  let latest = null;
  for (let i = 0; i < yoySeries.length; i++) {
    const v = yoySeries[i];
    if (!dropIdx.has(i) && v != null && isFinite(v)) { latest = v; break; }
  }
  result.latestOrganicYoY = latest;
  const organic = yoySeries.filter((v, i) => !dropIdx.has(i) && v != null && isFinite(v));
  result.droppedIdx = [...dropIdx];
  result.organicYears = organic.length;
  if (organic.length === 0) { result.shortHistory = true; return result; } // keine organischen Jahre → fallback growth
  const med = median(organic);
  // blend = 0.6*CAGR(organic) + 0.4*median(organic) — SEKUNDÄRES durability-Signal (nicht mehr primär).
  let blend;
  if (organic.length < 2) {
    // <2 organische Jahre (z.B. GMED nach NuVasive-Exclusion): current-year-only — der Blend lief NICHT
    // (kein 0.6/0.4-Mittel über >=2 Jahre). blend == latest == der eine organische Wert.
    result.shortHistory = true;
    result.currentYearOnly = true;
    blend = med; // == latest (einziger organischer Wert)
  } else {
    // CAGR über die verbleibenden organischen YoY: (Π(1+yoy))^(1/n) - 1 (geometrisches Mittel)
    const prod = organic.reduce((p, v) => p * (1 + v), 1);
    const cagr = Math.pow(prod, 1 / organic.length) - 1;
    blend = W_CAGR * cagr + W_MEDIAN * med;
  }
  result.blend = blend;
  // (I) FATALER FIX: primärer Achsen-Input = min(latestOrganicYoY, blend). Ein dezelerierender Name liest
  // NIE über seiner aktuellen organischen Rate. (latest kann null sein, wenn alle nicht-gedroppten YoY non-finite
  // wären — hier nicht möglich, da organic.length>0 ⇒ latest gesetzt. Defensive: dann blend.)
  result.growth = (latest != null) ? Math.min(latest, blend) : blend;
  // (III) Deceleration-Flag: aktuelle Rate < median der ÄLTEREN organischen Jahre (prior = organic ohne das jüngste).
  if (latest != null && organic.length >= 2) {
    const priorMed = median(organic.slice(1)); // organic ist newest-first über die retained Indizes
    if (priorMed != null && latest < priorMed) result.decelerating = true;
  }
  return result;
}

// --- D&LST (v0): DECELERATION-AWARE organische Growth-Metrik (Spec §3, 2 Anpassungen ggü. Medtech) ---
// Wiederverwendung des deceleration-safen Medtech-Musters (growthOrganic = min(latest, blend)), mit ZWEI
// D&LST-spezifischen Anpassungen aus der Spec:
//   Anpassung 1: Deal-Jahr-Exklusions-Schwelle 0.25 → 0.15·rev (Serial-Acquirer DHR/TMO mit Deals unter
//                dem 0.25-Trip werden erfasst).
//   Anpassung 2 (Zyklik-Schutz): die in den BLEND-Median eingehenden Jahres-YoY werden bei −15% GEFLOORT
//                (eine −42%-Instrument-Quartal/−23%-Deal-Jahr darf die Mehrjahres-Memory nicht auf 0 ziehen);
//                latestOrganicYoY bleibt UNcapped (die aktuelle rote Lampe ehrlich).
// Goodwill-Sprung-Denominator: pro-Jahr-Revenue (revenueHistory aus dem dlst-Snapshot), NICHT revLatest
// (Spec §4 Bug-Fix 1). Negative ΔGoodwill = Impairment → NIE als Deal-Sprung gelesen (Bug-Fix 2).
const DEAL_JUMP_THRESH_DLST = 0.15; // [TODO-CAL] Anpassung 1
const BLEND_YOY_FLOOR = -0.15;      // [TODO-CAL] Anpassung 2: per-year YoY-Floor NUR für den Blend-Median
function computeDlstOrganicGrowth(yoySeries, gwHist, revHist, revLatest, fallbackGrowth, yoyYears) {
  // yoySeries: newest-first YoY (rev[i]/rev[i+1]-1). gwHist/revHist: [{val,end}] newest-first (dlst-Snapshot).
  // yoyYears: newest-first Fiskaljahr (period-end year) JEDES YoY-Eintrags (neuerer Endpunkt), per Wert-Match
  //   in court-screen.js gegen den Snapshot derived; null wo unalignbar (continuing≠total ops Divestitur-Jahr).
  // FIX A (cross-source FY-alignment): die Deal-Jahr-Exklusion matcht das Goodwill-Sprung-Jahr (gwHist[i].end-
  //   year, TOTAL-ops Quelle) per FISKALJAHR an den passenden YoY-Eintrag (cache continuing-ops Quelle), NICHT
  //   index-positional. Wo die Reihen an älteren Indizes divergieren (Divestitur/Spin), entfernte der alte
  //   positionale Drop das FALSCHE cache-YoY-Jahr (RGEN/AZTA/DHR/ILMN/RVTY). Findet ein Sprung-Jahr KEINEN
  //   passenden YoY-Eintrag (Deal außerhalb des YoY-Fensters ODER Reihe an dem Jahr unalignbar/null) → KEIN
  //   Drop, stattdessen dealExclusionUnaligned-Lampe + volle Reihe.
  // FIX B (dealYearExcluded-Ehrlichkeit): dealYearExcluded=true NUR wenn TATSÄCHLICH ein YoY-Jahr gedroppt
  //   wurde (ein gematchtes Fiskaljahr entfernt). Ein Sprung außerhalb des Fensters setzt es NICHT mehr true.
  const result = {
    growth: fallbackGrowth, latestOrganicYoY: null, blend: null, organicYears: 0, droppedIdx: [],
    dealYearExcluded: false, dealExclusionUnaligned: false, shortHistory: false, currentYearOnly: false, decelerating: false,
  };
  if (!Array.isArray(yoySeries) || yoySeries.length === 0) return result;
  const years = Array.isArray(yoyYears) ? yoyYears : [];
  // yearToIdx: Fiskaljahr -> YoY-Index (nur eindeutige, nicht-null Jahre; neuestes gewinnt bei Duplikat).
  const yearToIdx = new Map();
  for (let i = 0; i < yoySeries.length; i++) {
    const y = years[i];
    if (y != null && isFinite(y) && !yearToIdx.has(y)) yearToIdx.set(y, i);
  }
  const dropIdx = new Set();
  if (Array.isArray(gwHist) && gwHist.length >= 2) {
    for (let i = 0; i < gwHist.length - 1; i++) {
      const newer = gwHist[i] ? gwHist[i].val : null;
      const older = gwHist[i + 1] ? gwHist[i + 1].val : null;
      if (newer == null || older == null) continue;
      const delta = newer - older;
      if (delta <= 0) continue; // (Bug-Fix 2) negativ = Impairment → KEIN Deal-Sprung
      // (Bug-Fix 1) per-Jahr-Revenue-Denominator: revenueHistory[i] (das neuere Jahr des Sprungs).
      const yrRev = (Array.isArray(revHist) && revHist[i] && revHist[i].val) ? revHist[i].val
                  : (revLatest != null && revLatest > 0 ? revLatest : null);
      if (yrRev == null || yrRev <= 0) continue;
      const jump = delta / yrRev;
      if (jump < DEAL_JUMP_THRESH_DLST) continue;
      // (Fix A) Fiskaljahr des Sprungs = period-end-year von gwHist[i] (das neuere Jahr des delta-Paars).
      const dealYearRaw = gwHist[i] && gwHist[i].end ? Number(String(gwHist[i].end).slice(0, 4)) : null;
      if (dealYearRaw == null || !isFinite(dealYearRaw)) { result.dealExclusionUnaligned = true; continue; }
      // (Fix A) Das DEAL-JAHR SELBST muss im YoY-Fenster alignbar sein. Ist es das NICHT (Deal außerhalb des
      // YoY-Fensters ODER continuing≠total-ops Divestitur-Jahr → year=null), dann wird NICHTS gedroppt — auch
      // KEIN Catch-up-Jahr (sonst würde, wie bei RGEN's 2023-Deal, fälschlich das 2024-YoY als „erstes volles
      // inorganisches Jahr" gekappt, obwohl der Deal gar nicht bestätigt im Fenster liegt). Stattdessen Lampe.
      if (!yearToIdx.has(dealYearRaw)) { result.dealExclusionUnaligned = true; continue; }
      // Deal-Jahr (alignbar) + CATCH_UP_YEARS Folge-Jahre (neuere Jahre = höheres FY) per FISKALJAHR droppen.
      for (let k = 0; k <= CATCH_UP_YEARS; k++) {
        const fy = dealYearRaw + k;
        if (yearToIdx.has(fy)) dropIdx.add(yearToIdx.get(fy));
      }
    }
  }
  // (Fix B) Ehrlichkeit: dealYearExcluded=true GENAU DANN, wenn mindestens ein YoY-Jahr entfernt wurde.
  result.dealYearExcluded = dropIdx.size > 0;
  let latest = null;
  for (let i = 0; i < yoySeries.length; i++) {
    const v = yoySeries[i];
    if (!dropIdx.has(i) && v != null && isFinite(v)) { latest = v; break; }
  }
  result.latestOrganicYoY = latest;
  const organic = yoySeries.filter((v, i) => !dropIdx.has(i) && v != null && isFinite(v));
  result.droppedIdx = [...dropIdx];
  result.organicYears = organic.length;
  if (organic.length === 0) { result.shortHistory = true; return result; }
  // (Anpassung 2) Blend nutzt die bei −15% geflooreten YoY (Zyklik-Schutz); latest bleibt unverändert.
  const organicFloored = organic.map(v => Math.max(v, BLEND_YOY_FLOOR));
  const medFloored = median(organicFloored);
  let blend;
  if (organic.length < 2) {
    result.shortHistory = true;
    result.currentYearOnly = true;
    blend = median(organic); // == latest (einziger organischer Wert), UNGEFLOORT (single-year = aktuelle Rate)
  } else {
    const prod = organicFloored.reduce((p, v) => p * (1 + v), 1);
    const cagr = Math.pow(prod, 1 / organicFloored.length) - 1;
    blend = W_CAGR * cagr + W_MEDIAN * medFloored;
  }
  result.blend = blend;
  result.growth = (latest != null) ? Math.min(latest, blend) : blend;
  if (latest != null && organic.length >= 2) {
    const priorMed = median(organic.slice(1));
    if (priorMed != null && latest < priorMed) result.decelerating = true;
  }
  return result;
}

const results = {};
for (const [bucket, F] of Object.entries(FORMULAS)) {
  // Mitglieder + abgeleitete Felder; Winsorize krasse Datenfehler (für robuste Stats)
  const seen = new Set();
  const members = [];
  for (const [t, b] of bucketOf) {
    if (b !== bucket) continue;
    if (KILL.has(t)) continue;                       // skeptiker-verifizierte Entfernung
    const c = byTicker.get(t);
    if (!c) continue;
    if (c.gm != null && c.gm > 1.0) continue;        // GM>100% = unmöglich (Daten-Fehler) -> hard reject
    // dedupe identische Foreign-OTC-Doppellistings (gleiche gm+rev)
    const fp = `${c.gm}|${c.scaleRevM}`;
    if (seen.has(fp)) continue; seen.add(fp);
    const m = { ...c, conf: confOf.get(t) };
    m.roicMinusWacc = (c.roicProxy != null) ? c.roicProxy - WACC : null;
    m.opMargin = c.opMargin;
    // Winsorize für Statistik (nicht für Anzeige): kaputte accel/growth begrenzen
    m._growth = c.growth == null ? null : clip(c.growth, -0.9, 5);
    m._accel = c.accel == null ? null : clip(c.accel, -5, 5);
    // v1.2 Fix E (PARITY FIELD-LEAK FIX): _growthMedtech / _growthMedtechAdj sind MEDTECH-ONLY-
    // Intermediates und werden NUR im medtech-Zweig (unten) als Member-Felder gesetzt. Sie werden NIE
    // mehr auf SaaS/Fabless-Member geschrieben → deren persistierte JSON-Bytes bleiben identisch zu den
    // court-PASSED-Formeln (_parity-baseline-pre-medtech == _parity-baseline-pre-v12 für SaaS/Fabless).
    members.push(m);
  }
  // --- v1.3 (Fix D-evolved + Fix E): Medtech DECELERATION-AWARE organic-growth PRE-PASS ---
  // Wird VOR den Stats gerechnet, weil die cross-sektionalen Anker (Median/MAD) auf der organischen,
  // winsorisierten Growth-Metrik beruhen müssen. Alle Intermediates sind MEDTECH-LOKAL (Fix E): sie werden
  // NUR auf medtech-Membern gesetzt → SaaS/Fabless-Member-JSON bleibt byte-identisch.
  // v1.3: growthOrganic = min(latestOrganicYoY, blend) (deceleration-aware, Bedingung I) statt nur Blend.
  if (bucket === 'medtech_devices') {
    for (const m of members) {
      const maRecMt = maMedtechByTicker.get(m.ticker);
      const gwHist = maRecMt ? maRecMt.goodwillHistory : null;
      const revLatest = m.scaleRevM != null ? m.scaleRevM * 1e6 : null;
      const snapAnnualRev = maRecMt && maRecMt.annualRevenue != null ? maRecMt.annualRevenue : null; // SEC FY-Rev für VII-Recon
      const org = computeMedtechOrganicGrowth(m.revYoYMedtech, gwHist, revLatest, m._growth, { ticker: m.ticker, snapAnnualRev });
      // _growthMedtech = deceleration-aware organische Growth-Metrik = min(latest,blend), DANN winsorisiert auf 1.0
      // (small-base-Artefakt-Schutz, ALMR). Dies ist der PRIMÄRE Achsen-Input (Stats + Scoring + Gate).
      const organicWins = org.growth == null ? null : Math.min(org.growth, 1.0);
      m._growthMedtech = organicWins;
      m._growthMedtechAdj = organicWins; // Fix D ersetzt den v1.1-Magnitude-Discount → kein separater Adj-Pfad mehr
      // (II) latestOrganicYoY = aktuelle organische Rate; das gateOpen-Floor (growth>=0.15) wird HIERAUF scharf.
      m._latestOrganicYoY = org.latestOrganicYoY;
      m._growthBlend = org.blend; // SEKUNDÄRES durability-Signal (rückwärts), NICHT der Achsen-Input
      m._organicYears = org.organicYears;
      m._dealYearExcluded = org.dealYearExcluded;
      m._shortOrganicHistory = org.shortHistory;
      m._currentYearOnly = org.currentYearOnly; // (VI) <2 organische Jahre → kein 0.6/0.4-Blend gelaufen
      m._decelerating = org.decelerating;       // (III) aktuelle Rate < median(prior organic years)
      m.growthOrganic = org.growth == null ? null : Math.round(org.growth * 10000) / 10000; // persisted für Audit/Anzeige
      m.latestOrganicYoY = org.latestOrganicYoY == null ? null : Math.round(org.latestOrganicYoY * 10000) / 10000; // persisted
      m.growthBlend = org.blend == null ? null : Math.round(org.blend * 10000) / 10000; // persisted (durability view)
    }
  }
  // --- D&LST (v0) PRE-PASS: deceleration-aware organic growth + FCF-efficiency + cohort + capexNeg ---
  // Alle Intermediates sind DLST-LOKAL → SaaS/Fabless/Medtech-Member-JSON bleibt byte-identisch (Parität).
  if (bucket === 'diagnostics_lst') {
    for (const m of members) {
      m._cohort = cohortOf.get(m.ticker) || 'dx'; // Default dx (Spec: alle 29 sind getaggt)
      const maRec = maDlstByTicker.get(m.ticker);
      const gwHist = maRec ? maRec.goodwillHistory : null;
      const revHist = maRec ? maRec.revenueHistory : null;
      const revLatest = m.scaleRevM != null ? m.scaleRevM * 1e6 : null;
      const org = computeDlstOrganicGrowth(m.revYoYDlst, gwHist, revHist, revLatest, m._growth, m.revYoYDlstYears);
      const organicWins = org.growth == null ? null : Math.min(org.growth, 1.0); // small-base-Artefakt-Schutz
      m._growthDlst = organicWins;
      m._latestOrganicYoY = org.latestOrganicYoY;
      m._growthBlend = org.blend;
      m._organicYears = org.organicYears;
      m._dealYearExcluded = org.dealYearExcluded;
      m._dealExclusionUnaligned = org.dealExclusionUnaligned; // (Fix A) Sprung-Jahr nicht per FY alignbar
      m._shortOrganicHistory = org.shortHistory;
      m._currentYearOnly = org.currentYearOnly;
      m._decelerating = org.decelerating;
      m.growthOrganic = org.growth == null ? null : Math.round(org.growth * 10000) / 10000;
      m.latestOrganicYoY = org.latestOrganicYoY == null ? null : Math.round(org.latestOrganicYoY * 10000) / 10000;
      m.growthBlend = org.blend == null ? null : Math.round(org.blend * 10000) / 10000;
      // EFFICIENCY (Spec §3): FCF-Marge PRIMÄR; FALLBACK auf OpM wenn fcfMargin null ODER >15pp unter OpM.
      const fcf = m.fcfMargin, opm = m.opMargin;
      let eff, effSrc;
      if (fcf == null) { eff = (opm != null ? opm : null); effSrc = 'opMargin(fcf-null)'; }
      else if (opm != null && (opm - fcf) > 0.15) { eff = opm; effSrc = 'opMargin(fcf-distorted)'; }
      else { eff = fcf; effSrc = 'fcfMargin'; }
      m._effDlst = eff;
      m.effDlst = eff == null ? null : Math.round(eff * 10000) / 10000;
      m.effSource = effSrc;
      // capexNeg: niedrigere Capex-Intensität = besser → negiert, damit höher=besser für die z/MAD-Achse.
      m._capexNeg = (m.capexPct == null || !isFinite(m.capexPct)) ? null : -Math.abs(m.capexPct);
    }
  }

  // Roh-Achswerte für Stats (cross-sectional Median/MAD): nutze winsorisierte Werte
  // For medtech growth: use _growthMedtech (Fix D organic + winsorize at 1.0) for Stats AND scoring (Fix D
  // ersetzt den separaten _growthMedtechAdj-Discount-Pfad; beide sind nun identisch = organic-winsorized).
  const rawOfStats = (m, key) => {
    if (key === 'growth') return bucket === 'medtech_devices' ? m._growthMedtech : (bucket === 'diagnostics_lst' ? m._growthDlst : m._growth);
    if (key === 'effDlst') return m._effDlst;
    if (key === 'capexNeg') return m._capexNeg;
    if (key === 'accel') return m._accel;
    return m[key];
  };
  const rawOf = (m, key) => {
    if (key === 'growth') return bucket === 'medtech_devices' ? m._growthMedtechAdj : (bucket === 'diagnostics_lst' ? m._growthDlst : m._growth);
    if (key === 'effDlst') return m._effDlst;
    if (key === 'capexNeg') return m._capexNeg;
    if (key === 'accel') return m._accel;
    return m[key];
  };

  // Cross-sectional Anker (Median) + MAD je Achse über das Bucket-Universum
  const stats = {};
  for (const ax of F.axes) {
    if (ax.key === 'a2Forward') continue; // composite axis -> anchors computed separately (statsA2)
    const vals = members.map(m => rawOfStats(m, ax.key)).filter(v => v != null && isFinite(v));
    stats[ax.key] = { median: median(vals), mad: mad(vals), n: vals.length };
  }
  // D&LST (Spec §1.2): REL cross-sektionale Stats PRO KOHORTE (dx z-scored gegen dx, tools gegen tools) —
  // verhindert, dass ein zyklisches Tools-Tal die Dx-Mediane verzerrt. Pro-Member liest die Achse die Stats
  // SEINER Kohorte. Die gepoolten `stats` bleiben als Fallback/Audit erhalten. DLST-only → keine Parität-Wirkung.
  const statsByCohort = {};
  if (F.cohortAware) {
    for (const coh of ['dx', 'tools']) {
      const cohMembers = members.filter(m => m._cohort === coh);
      const s = {};
      for (const ax of F.axes) {
        if (ax.key === 'a2Forward') continue;
        const vals = cohMembers.map(m => rawOfStats(m, ax.key)).filter(v => v != null && isFinite(v));
        s[ax.key] = { median: median(vals), mad: mad(vals), n: vals.length };
      }
      statsByCohort[coh] = s;
    }
  }
  // A2 forward-book cross-sectional anchors (only when the bucket has the a2Forward axis)
  const statsA2 = F.axes.some(a => a.key === 'a2Forward') ? (() => {
    const gv = members.map(m => { const r = maRpoByTicker.get(m.ticker); return r ? r.rpoGrowthYoY : null; }).filter(v => v != null && isFinite(v));
    const lv = members.map(m => { const r = maRpoByTicker.get(m.ticker); return r ? r.rpoToRev : null; }).filter(v => v != null && isFinite(v));
    return { gMed: median(gv), gMad: mad(gv), lMed: median(lv), lMad: mad(lv), gn: gv.length, ln: lv.length };
  })() : null;

  // Score je Mitglied
  for (const m of members) {
    // Membership-Gate
    // v1.2 Fix B (ALMR LEAK FIX): Für MEDTECH nutzt das Membership-Growth-Gate die WINSORISIERTE/organische
    // Growth (_growthMedtech, cap 1.0) statt RAW growth — sonst leakt ALMR mit RAW 195% trotz $74M-Mini-Scale
    // einen hohen Gate-Wert. Nicht-Medtech: unverändert RAW m.growth (Parität SaaS/Fabless).
    const mGate = (bucket === 'medtech_devices' && m._growthMedtech != null) ? m._growthMedtech
                : (bucket === 'diagnostics_lst' && m._growthDlst != null) ? m._growthDlst
                : m.growth;
    const mg = logistic(mGate, F.membership.g.c, F.membership.g.s);
    const mGM = logistic(m.gm, F.membership.gm.c, F.membership.gm.s);
    const mSc = logistic(log10(Math.max(m.scaleRevM, 1)), F.membership.scaleLog.c, F.membership.scaleLog.s);
    const M = mg * mGM * mSc;
    m.membership = Math.round(M * 100) / 100;
    m.membershipClass = M >= 0.66 ? 'In' : M >= 0.20 ? 'Borderline' : 'Out';

    // Achsen
    m._a2 = statsA2 ? computeA2Forward(maRpoByTicker.get(m.ticker), statsA2) : null;
    // D&LST: die z/MAD-Anker kommen aus der Kohorte des Members (dx vs dx, tools vs tools), nicht gepoolt.
    const axStats = (F.cohortAware && statsByCohort[m._cohort]) ? statsByCohort[m._cohort] : stats;
    let core = 0; m.axisS = {};
    for (const ax of F.axes) {
      let s = ax.key === 'a2Forward'
        ? (m._a2 == null ? 0 : m._a2)                                  // composite forward-book axis (already a blended s in [-1,1])
        : sAxis(rawOf(m, ax.key), axStats[ax.key].median, axStats[ax.key].mad, ax.k);
      // --- D&LST v1.1 Fix C (COHORT-POOLING-ARTEFAKT): die dx-Kohorte ist von Cash-Burnern dominiert
      // (eff-Median ~0) → ein dx-Name mit kleinem POSITIVEM FCF bekommt einen großen positiven eff-REL-z,
      // rein aus der schwachen-Kohorten-Mitgliedschaft (über-belohnt). Das positive eff-REL-Signal eines
      // Namens UNTER dem absoluten eff-Floor seiner Kohorte muss unterdrückt werden.
      // --- v1.2 Fix 2 (CLAMP-CLIFF → CONTINUOUS TAPER): v1.1 nutzte einen HARTEN Clamp (s->0 bei
      // FCF < floor=0.10). Das erzeugte eine ~2.5pt-Diskontinuität an haarscharfen FCF-Unterschieden
      // (CDNA FCF 0.093 -> eff-REL 0 vs EXAS FCF 0.110 -> eff-REL 0.33: 1.7bp FCF-Differenz = +2.5pt Score-
      // Sprung). FIX: STETIGER, EINSEITIGER Taper über das Band [floor-band, floor] (band 0.04): der POSITIVE
      // eff-REL-z wird linear skaliert — 0 bei FCF <= floor-band, voll bei FCF >= floor, dazwischen linear.
      // So schwingt eine FCF-Haaresbreite die Achse nicht mehr ~2.5 Punkte. Einseitig (nur positiver z wird
      // getapert; negativer z bleibt unangetastet) — das Pooling-Artefakt (Cash-Burn-dx über-scort) bleibt
      // unterdrückt, weil unter floor-band weiterhin 0 erzwungen wird. DLST-only.
      // (Fix D) Der Taper unterdrückt ein FCF-SPEZIFISCHES Pooling-Artefakt (Cash-Burn-dx über-scort, weil
      // der eff-Floor ein FCF-Floor ist). Ist die eff-Quelle ein opMargin-FALLBACK (effSource !== 'fcfMargin',
      // d.h. fcf null ODER >15pp unter OpM), dann ist m._effDlst KEINE FCF-Marge → der Taper darf NICHT gegen
      // den FCF-Floor gaten. SKIP. (Aktuell nutzen alle 29 Namen fcfMargin → no-op; defensiv.)
      if (bucket === 'diagnostics_lst' && ax.key === 'effDlst' && s > 0 && m.effSource === 'fcfMargin') {
        const effFloor = (NORMS[(m._cohort === 'tools' ? 'diagnostics_lst_tools' : 'diagnostics_lst_dx')].eff || {}).floor;
        const EFF_TAPER_BAND = 0.04; // [TODO-CAL] Breite des stetigen Übergangsbands unter dem eff-Floor
        if (effFloor != null) {
          const fcf = m._effDlst;
          if (fcf == null || fcf <= effFloor - EFF_TAPER_BAND) {
            s = 0; // unter dem Band: kein positiver eff-REL-Kredit (Artefakt unterdrückt)
          } else if (fcf < effFloor) {
            // im Band [floor-band, floor): linearer Faktor 0..1, kein Sprung an den Rändern
            const t = (fcf - (effFloor - EFF_TAPER_BAND)) / EFF_TAPER_BAND;
            s = s * Math.max(0, Math.min(1, t));
          }
          // fcf >= effFloor: voller positiver eff-REL-z (echte Effizienz relativ belohnt, unverändert)
        }
      }
      m.axisS[ax.name] = Math.round(s * 100) / 100;
      core += ax.w * (s + 1) / 2;
    }
    // Penalties
    const pDil = clip(((m.sbcPct == null ? 0 : m.sbcPct) - F.dilStart) / F.dilRange, 0, 1) * F.dilCap;
    const pAuth = 0; // keine M&A-Daten lokal
    m.pDil = Math.round(pDil * 10) / 10;
    if (bucket === 'medtech_devices') {
      // Fix B: absKaliber nutzt die WINSORISIERTE/deceleration-aware organische Growth (_growthMedtech = min(latest,blend),
      // cap 1.0), NICHT die RAW growth — sonst öffnet ALMR mit RAW 195% das Gate trotz Mini-Scale.
      const gAbs = m._growthMedtech != null ? m._growthMedtech : (m.growth || 0); // Score-Achse: deceleration-aware min()
      // (II) gateOpen-FLOOR scharf auf der AKTUELLEN organischen Rate (latestOrganicYoY), NICHT auf dem
      // rückwärtsgewandten Blend. Da growthOrganic=min(latest,blend)<=latest gilt, ist das Gate auf _growthMedtech
      // bereits floor-safe — wir machen es hier aber EXPLIZIT: das harte Floor (growth>=0.15) liest die aktuelle Rate.
      // Fallback auf _growthMedtech, falls latestOrganicYoY null (keine organische YoY vorhanden).
      const gGateFloor = m._latestOrganicYoY != null ? m._latestOrganicYoY : gAbs;
      const absK = absKaliber({ growth: gAbs, gm: m.gm, opMargin: m.opMargin }, 'medtech_devices', { growth: 0.45, gm: 0.30, eff: 0.25 });
      m.absKaliber = Math.round(absK * 1000) / 1000;
      const rawScore = Math.round(Math.max(0, blendScore(absK, core, 0.6) - pDil) * 10) / 10;
      m.belowAbsoluteFloor = !gateOpen({ growth: gGateFloor, gm: m.gm || 0, opMargin: m.opMargin || 0, fcfMargin: m.fcfMargin || 0 }, 'medtech_devices');
      // Fix C (SI-4): Out-Class-Namen bekommen score=null (kein irreführender Rang im Headline).
      //   gateOpen=true UND membership!='Out' → headlineShortlist (Fix B: Out-Class kann NIE Shortlist sein).
      //   belowAbsoluteFloor (gate zu, membership ok) bleibt gelistet, geflaggt, NICHT auf der Shortlist.
      m.score = m.membershipClass === 'Out' ? null : rawScore;
      m.headlineShortlist = (m.membershipClass !== 'Out') && !m.belowAbsoluteFloor;
    } else if (bucket === 'diagnostics_lst') {
      // absKaliber mit der KOHORTEN-spezifischen NORM (dx vs tools GM) + dlst-Gewichten {growth .40, gm .20,
      // eff .40}. Der eff-Arm von absKaliber liest `opMargin` aus dem norm.eff-Anker → wir übergeben die
      // dlst-Efficiency (_effDlst = FCF primär / OpM-Fallback) AN dieser Stelle, damit FCF die Quality-Säule ist.
      const cohortNorm = m._cohort === 'tools' ? 'diagnostics_lst_tools' : 'diagnostics_lst_dx';
      const gAbs = m._growthDlst != null ? m._growthDlst : (m.growth || 0); // deceleration-aware min()
      // v1.1 Fix A (FATAL — gate-floor las uncapped latest): das gateOpen-Growth-Floor (UND der Rule-of-X-Arm)
      // MÜSSEN dieselbe deceleration-sichere growthOrganic = min(latest,blend) lesen wie die Score-Achse —
      // NICHT die rohe latestOrganicYoY. Sonst leakt ADPT (latest 54.8% organisch, growthOrganic 10.6% < 0.15)
      // über das Floor auf die Headline. gGateFloor == gAbs == growthOrganic (medtech-v1.3-Gate-Fix für dlst).
      const gGateFloor = gAbs;
      const effForAbs = m._effDlst != null ? m._effDlst : 0;
      const absK = absKaliber({ growth: gAbs, gm: m.gm, opMargin: effForAbs }, cohortNorm, F.absWeights);
      m.absKaliber = Math.round(absK * 1000) / 1000;
      const rawScore = Math.round(Math.max(0, blendScore(absK, core, 0.6) - pDil) * 10) / 10;
      // v1.1 Fix B (FATAL — opMargin/FCF-Slot-Vergiftung): effGatePass Arm 3 ist die ECHTE Rule-of-X
      // ((growth+opMargin)>=0.30) und MUSS den ECHTEN opMargin lesen; Arm 2 ist das FCF-Signal (fcf>=0.05).
      // Vorher wurde der FCF-primäre Proxy (effForAbs) in den opMargin-Slot UND den fcfMargin-Slot gegeben →
      // RoX lief auf FCF statt opMargin → NTRA (echte RoX 22.5% < 30%, FCF 3.3% < 5%) flippte auf die Headline.
      // FIX: echten opMargin in den opMargin-Slot, FCF-Signal in den fcfMargin-Slot. growth = growthOrganic (A).
      m.belowAbsoluteFloor = !gateOpen(
        { growth: gGateFloor, gm: m.gm || 0,
          opMargin: (m.opMargin != null ? m.opMargin : 0),
          fcfMargin: (m.fcfMargin != null ? m.fcfMargin : effForAbs) },
        cohortNorm);
      m.score = m.membershipClass === 'Out' ? null : rawScore;
      m.headlineShortlist = (m.membershipClass !== 'Out') && !m.belowAbsoluteFloor;
    } else {
      // audit/fix (gauntlet E3): SI-4 für saas/fabless — Out-Class-Member bekommen score=null (kein
      // irreführender Headline-Rang), exakt wie medtech/dlst (m.score = membershipClass==='Out' ? null : rawScore).
      // Davor scorte der generische Zweig JEDES Mitglied (nie null). saas hat 25 Out-Class-Large-Caps
      // (CDNS/ADSK/FICO/FTNT/...), fabless 0 → das Nullen ist eine BEWUSSTE Governance-Anhebung, kein Drift.
      const rawScore = Math.round(Math.max(0, 100 * core - pDil - pAuth) * 10) / 10;
      m.score = m.membershipClass === 'Out' ? null : rawScore;
    }
    m.stage = stageOf(F, m.fcfMargin);

    // Lampen
    const L = [];
    if (m.sbcPct != null && m.sbcPct > 0.50) L.push('IPO-SBC-distortion');
    else if (m.sbcPct != null && m.sbcPct > 0.15) L.push('SBC>15%');
    if (m.scaleRevM > MEGACAP_REVM) L.push('mega-cap');
    const _ioFlag = inorganicFlag(m.ticker);
    const _ioRec = maRpoByTicker.get(m.ticker);
    if (_ioFlag === 'inorganic') L.push(`M&A-inorganic-flow(pay${pct(_ioRec.paymentsToRev).trim()},dGW${pct(_ioRec.deltaGoodwillPctRev).trim()},rpoG${pct(_ioRec.rpoGrowthYoY).trim()})`);
    else if (_ioFlag === 'ambiguous') L.push('M&A-flow-high(book-NULL,ambiguous)');
    else if (_ioFlag === null && INORGANIC_FALLBACK.has(m.ticker)) L.push('M&A-growth(P_auth-blind,hardcoded-fallback)');
    if (m.flags && m.flags.includes('thin-durability')) L.push('thin-durability');           // Durability aus <4 YoY (annual Fallback) — ersetzt irreführende 8q-approx-Lampe (v3 nutzt SEC-Quartals-YoY)
    if (m.durSource === 'sec-quarterly' && m.durWinN != null && m.durWinN < 12) L.push('short-durability-window'); // 4<=winN<12: NICHT 12Q-vergleichbar (ALAB 7Q, ARM 8Q) — Re-Court-Disclosure
    if (m.durability != null && Math.abs(m.durability) > 2) L.push('near-zero-median-amplified'); // |med|+floor bläht durRaw auf wenn median≈0 (z.B. MXL -3.65); tanh sättigt -> Rang ok, Rohwert-Artefakt offengelegt
    if (m.flags && m.flags.includes('short-annual-history')) L.push('short-hist');
    L.push('P_auth=no-data');
    if (F.degraded) L.push('A2-missing-degraded');
    if (m.conf === 'low') L.push('class-low-conf');
    // Medtech M&A lamps (advisory, STOCK+FLOW+JUMP+COVERAGE)
    if (bucket === 'medtech_devices') {
      const maRec = maMedtechByTicker.get(m.ticker);
      if (maRec) {
        const rev = m.scaleRevM * 1e6;
        const goodwillToRev = (maRec.goodwillLatest != null && rev > 0) ? maRec.goodwillLatest / rev : null;
        m.goodwillToRev = goodwillToRev != null ? Math.round(goodwillToRev * 1000) / 1000 : null;
        // Fix F (COVERAGE-NULL LAMP): goodwill=null darf NICHT still als „kein M&A" durchgehen — explizit flaggen.
        if (maRec.goodwillLatest == null) L.push('M&A-coverage-null');
        if (maRec.deltaGoodwillPctRev != null && maRec.deltaGoodwillPctRev >= 0.05) L.push('M&A-inorganic-flow');
        if (goodwillToRev != null && goodwillToRev >= 0.80) L.push('M&A-built-stock');
        // M&A-jump-in-window LAMP (advisory) bleibt: 3-Jahr-Goodwill-Sprung >=25% von Rev.
        // Fix D: KEIN Magnitude-Discount mehr — stattdessen deal-year-exclusion (siehe growthOrganic/dealYearExcluded).
        const maxJump = maRec.maxGoodwillJumpPctRev;
        if (maxJump != null && maxJump >= 0.25) {
          L.push(`M&A-jump-in-window(maxJump${pct(maxJump).trim()},deal-yr-excluded${m._dealYearExcluded ? '=yes' : '=no'})`);
          m.maxGoodwillJumpPctRev = Math.round(maxJump * 1000) / 1000;
        }
      } else {
        // Kein Snapshot-Row für diesen Ticker → ebenfalls coverage-null (Daten fehlen sichtbar, nicht still 'no M&A').
        L.push('M&A-coverage-null');
      }
      // (VI) <2 organische Jahre nach Deal-Year-Exclusion: 'current-year-only' (NICHT 'short-organic-history',
      // das implizierte fälschlich, der 0.6/0.4-Blend sei über >=2 Jahre gelaufen). Der single current-year
      // organic YoY wird explizit als growthOrganic genutzt (growthOrganic == latestOrganicYoY == growthBlend).
      if (m._currentYearOnly) {
        L.push(`current-year-only(single-organic-yr,growthOrganic=${pct(m.growthOrganic).trim()})`);
      } else if (m._shortOrganicHistory) {
        // shortHistory ohne currentYearOnly = 0 organische Jahre (alle gedroppt) → fallback-growth.
        L.push('short-organic-history(deal-year-excluded,no-organic-yr)');
      }
      // (III) Deceleration-LAMP: aktuelle organische Rate < median der älteren organischen Jahre.
      if (m._decelerating) {
        L.push(`decelerating(latest${pct(m.latestOrganicYoY).trim()}<prior-median)`);
      }
      // (V) trailing-window-growth ADVISORY: Blend (rückwärts durability) divergiert > ~50% von der aktuellen Rate.
      // |blend/latest - 1| > 0.5 (oder absolut > 0.5, falls latest ~0). Offenlegung, dass headline X% != blend Y%.
      if (m._latestOrganicYoY != null && m._growthBlend != null) {
        const lat = m._latestOrganicYoY, bl = m._growthBlend;
        const diverges = (Math.abs(lat) > 1e-9)
          ? Math.abs(bl / lat - 1) > 0.5
          : Math.abs(bl - lat) > 0.5;
        if (diverges) L.push(`trailing-window-growth(headline${pct(lat).trim()} vs blend${pct(bl).trim()})`);
      }
      if (m.nAnnualRev != null && m.nAnnualRev < 3) L.push('short-history');
      if (m.rdProductivity == null) L.push('rd-missing');
      if (m.belowAbsoluteFloor) L.push('below-abs-floor');
      if (m.membershipClass === 'Out') L.push('membership-Out(excluded-from-headline)'); // Fix C disclosure
      m.normTableId = getNormTableId('medtech_devices');
    }
    // D&LST M&A / capital-discipline lamps (Spec §4/§5) — chronic-acquirer, cum-payments, impairment,
    // deal-year-jump, cyclicality (per cohort), recurring-mix advisory, deceleration, coverage-null, R&D/shares defer.
    if (bucket === 'diagnostics_lst') {
      const cohortNorm = m._cohort === 'tools' ? 'diagnostics_lst_tools' : 'diagnostics_lst_dx';
      const maRec = maDlstByTicker.get(m.ticker);
      m.cohort = m._cohort;
      if (maRec) {
        const rev = m.scaleRevM * 1e6;
        const gwToRev = (maRec.goodwillToRev != null) ? maRec.goodwillToRev
                       : (maRec.goodwillLatest != null && rev > 0 ? maRec.goodwillLatest / rev : null);
        m.goodwillToRev = gwToRev != null ? Math.round(gwToRev * 1000) / 1000 : null;
        const cumDelta = maRec.cumDeltaGoodwillPctRev;
        const cumPay = maRec.cumPaymentsToRev;
        m.cumDeltaGoodwillPctRev = cumDelta != null ? Math.round(cumDelta * 1000) / 1000 : null;
        m.cumPaymentsToRev = cumPay != null ? Math.round(cumPay * 1000) / 1000 : null;
        // Coverage-null lamps (Fix F-analog): goodwill/payments fehlen sichtbar, nicht still 'no M&A'.
        if (maRec.goodwillLatest == null && gwToRev == null) L.push('M&A-coverage-null');
        if (!maRec.coverageFlags || maRec.coverageFlags.payments === false || cumPay == null) L.push('cum-payments-coverage-null');
        // Chronic-Acquirer-Lampe (Spec §4): goodwill/rev > 1.0 ODER cumΔGoodwill/rev > 0.40 (Serial-Acquirer
        // wie DHR, deren Single-Year-Detektor UNTERfeuert — viele kleine Bolt-ons).
        if ((gwToRev != null && gwToRev > 1.0) || (cumDelta != null && cumDelta > 0.40)) {
          L.push(`chronic-acquirer(gw/rev${gwToRev!=null?pct(gwToRev).trim():'—'},cumDgw${cumDelta!=null?pct(cumDelta).trim():'—'})`);
          m._chronicAcquirer = true; // v1.1 Fix E: für den decelerating-Serial-Acquirer-Veto
        }
        // cumPaymentsToRev-Lampe (Spec §4): > 0.15 (65.5% Coverage → nutzbar; trennt Acquirer von Organikern).
        if (cumPay != null && cumPay > 0.15) L.push(`cum-payments(${pct(cumPay).trim()})`);
        // Goodwill-Impairment-Lampe (Spec §4 Bug-Fix 2): impairmentFlag aus dem Snapshot (negativer ΔGoodwill).
        if (maRec.impairmentFlag === true) L.push('goodwill-impairment(neg-deltaGW-clamped)');
        // Single-Year-Deal-Jahr-Sprung (advisory, mit Fixes): maxGoodwillJumpPctRev >= 0.15 (dlst-Schwelle).
        const maxJump = maRec.maxGoodwillJumpPctRev;
        if (maxJump != null && maxJump >= 0.15) {
          L.push(`deal-year-jump(maxJump${pct(maxJump).trim()},deal-yr-excluded${m._dealYearExcluded ? '=yes' : '=no'})`);
          m.maxGoodwillJumpPctRev = Math.round(maxJump * 1000) / 1000;
        }
        // (Fix A) deal-exclusion-unaligned: ein detektierter Goodwill-Sprung konnte NICHT per Fiskaljahr an die
        // cache-YoY-Reihe gematcht werden (Deal außerhalb des YoY-Fensters ODER continuing≠total-ops Divestitur-
        // Jahr) → KEIN YoY-Jahr gedroppt, volle Reihe genutzt (statt index-positional das falsche Jahr zu kappen).
        if (m._dealExclusionUnaligned) L.push('deal-exclusion-unaligned(jump-fy-not-in-yoy-window,full-series-used)');
      } else {
        L.push('M&A-coverage-null');
        L.push('cum-payments-coverage-null');
      }
      // Deceleration / current-year-only / short-history Lampen (analog Medtech).
      if (m._currentYearOnly) {
        L.push(`current-year-only(single-organic-yr,growthOrganic=${pct(m.growthOrganic).trim()})`);
      } else if (m._shortOrganicHistory) {
        L.push('short-organic-history(deal-year-excluded,no-organic-yr)');
      }
      if (m._decelerating) L.push(`decelerating(latest${pct(m.latestOrganicYoY).trim()}<prior-median)`);
      if (m._latestOrganicYoY != null && m._growthBlend != null) {
        const lat = m._latestOrganicYoY, bl = m._growthBlend;
        const diverges = (Math.abs(lat) > 1e-9) ? Math.abs(bl / lat - 1) > 0.5 : Math.abs(bl - lat) > 0.5;
        if (diverges) L.push(`trailing-window-growth(headline${pct(lat).trim()} vs blend${pct(bl).trim()})`);
      }
      // Zyklik-Lampe PER KOHORTE (Spec §1.3/§5): tools = advisory (watch wave turn), dx-rot = genuin besorgniserregend.
      // Kontextualisiert eine rote Growth-Lampe (latestOrganicYoY < 0).
      if (m._latestOrganicYoY != null && m._latestOrganicYoY < 0) {
        L.push(m._cohort === 'tools'
          ? `cyclicality(tools,latest${pct(m.latestOrganicYoY).trim()},watch-wave-turn)`
          : `cyclicality(dx,latest${pct(m.latestOrganicYoY).trim()},genuine-concern)`);
      } else if (m._cohort === 'tools' && m._decelerating) {
        L.push('cyclicality(tools,decelerating,watch-wave-turn)');
      }
      // Recurring-/Consumables-Mix ADVISORY (Spec §5): kleine gefrorene Per-Ticker-Tabelle (NICHT gescort, n zu dünn).
      if (DLST_RECURRING_HIGH.has(m.ticker)) L.push('recurring-mix(high-consumables,advisory)');
      else if (DLST_INSTRUMENT_HEAVY.has(m.ticker)) L.push('recurring-mix(instrument-heavy,advisory)');
      // Efficiency-Source-Disclosure (FCF primär / OpM-Fallback).
      if (m.effSource && m.effSource !== 'fcfMargin') L.push(`eff-fallback(${m.effSource})`);
      // R&D + Shares DEFERRED (Spec §2 Daten-Wände) → coverage-null Lampen, KEINE Strafe.
      if (m.rdProductivity == null) L.push('rd-missing(deferred,no-penalty)');
      L.push('shares-missing(deferred,no-penalty)');
      if (m.nAnnualRev != null && m.nAnnualRev < 3) L.push('short-history');
      if (m.belowAbsoluteFloor) L.push('below-abs-floor');
      if (m.membershipClass === 'Out') L.push('membership-Out(excluded-from-headline)');
      // v1.1 Fix E / v1.2 Fix 3 (CHRONIC-ACQUIRER+DECELERATING-HAIRCUT): ein Name, der GLEICHZEITIG
      // chronic-acquirer UND decelerating ist (z.B. VCYT: gw/rev 148% + latest 16% < prior-median), darf
      // NICHT als #1-Conviction-Pick der Headline sitzen. v1.1 demovierte NUR per Sort-Key — der ANGEZEIGTE
      // Score blieb über dem besten nicht-demovierten Namen (VCYT 65.3 > MEDP 63.8 auf Rang #2 = irreführend).
      // v1.2 FIX: ein ECHTER, prinzipieller Score-Haircut. Magnitude [TODO-CAL] CHRONIC_DECEL_HAIRCUT = 0.12
      // (12% des Roh-Scores) als ökonomische Strafe für die Kombination aus Kapital-Indisziplin (Serial-
      // Acquirer) + nachlassendem organischem Momentum; zusätzlich wird der Score im Sort-Block hart unter
      // den besten nicht-demovierten Headline-Namen gedeckelt, sodass der ANGEZEIGTE Score die Rang-Position
      // ehrlich widerspiegelt (ladder reads monotonically). Disclosed via Lampe + demotionNote.
      if (m._chronicAcquirer && m._decelerating && m.headlineShortlist) {
        m.headlineDemoted = true;
        L.push('chronic-acquirer+decelerating-HAIRCUT(demoted+score-cut,disclosed)');
        // Roh-Score für Audit erhalten; der eigentliche Haircut/Cap wird im Sort-Block angewandt (dort ist
        // der höchste nicht-demovierte Headline-Score bekannt).
        m.scorePreHaircut = m.score;
        m.demotionNote = `Shortlist-DEMOTION + SCORE-HAIRCUT (v1.2 Fix 3, war Fix E): chronic-acquirer (gw/rev ${m.goodwillToRev != null ? pct(m.goodwillToRev).trim() : '—'}, cumDgw ${m.cumDeltaGoodwillPctRev != null ? pct(m.cumDeltaGoodwillPctRev).trim() : '—'}) UND decelerating (latest ${pct(m.latestOrganicYoY).trim()} < prior-median). Ein decelerierender Serial-Acquirer darf nicht der #1-Conviction-Pick sein. Der ANGEZEIGTE Score erhält einen echten Haircut [TODO-CAL: CHRONIC_DECEL_HAIRCUT 12%] und wird unter den besten nicht-demovierten Headline-Namen gedeckelt, damit der gezeigte Score die Rang-Position ehrlich abbildet (kein Display über dem #1-Pick). Roh-Score erhalten als scorePreHaircut.`;
      } else {
        m.headlineDemoted = false;
      }
      m.normTableId = getNormTableId(cohortNorm);
    }
    m.lamps = L;
    if (_ioFlag === 'inorganic') {
      m.degradedRankBias = `upward — A1 headline growth is M&A-flow-heavy (recent acquisition cash ${pct(_ioRec.paymentsToRev).trim()} of rev, goodwill +${pct(_ioRec.deltaGoodwillPctRev).trim()}) while forward book is flat (rpoGrowth ${pct(_ioRec.rpoGrowthYoY).trim()}); degraded-mode rank over-states growth quality pending an A2/organic-growth axis.`;
    }
  }

  // Kollaps-Detektor + Durability-Dominanz-Guard (Spec §5 L88: harte Re-Gewichtung bei Kollaps, nicht nur Lampe).
  // Veröffentlicht BEIDE Maße jeden Lauf (Re-Court-Auflage „decompose WHICH block collapses"):
  //   collapseSpearman = Spearman(Score, GM+Durability-Block);  rhoDomAxisDurability = Spearman(Score, Durability allein).
  // spearman() ist tie-averaged → order-stabil. Backstop feuert rhoDom > T=0.90 → deterministischer ≤50%-Haircut.
  const ranked = members.filter(m => m.score != null);
  let collapse = null, rhoDomAxis = null, collapseReweight = null;
  if (ranked.length >= 3) {
    const total = ranked.map(m => m.score);
    const block = ranked.map(m => F.dominantBlock.reduce((s, key) => {
      const ax = F.axes.find(a => a.key === key); return s + (ax ? (m.axisS[ax.name] || 0) : 0);
    }, 0));
    collapse = spearman(total, block);
    const durAx = F.axes.find(a => a.key === 'durability');
    if (durAx) {
      rhoDomAxis = spearman(total, ranked.map(m => m.axisS[durAx.name] || 0));
      const T = 0.90;
      if (rhoDomAxis != null && rhoDomAxis > T) {
        const hf = clip((rhoDomAxis - T) / (1 - T), 0, 1) * 0.5; // ≤50% Haircut
        const wDur = durAx.w * (1 - hf), freed = durAx.w - wDur;
        const otherWsum = F.axes.filter(a => a.key !== 'durability').reduce((s, a) => s + a.w, 0);
        for (const m of ranked) {
          let core = 0;
          for (const a of F.axes) {
            const w = a.key === 'durability' ? wDur : a.w + freed * (a.w / otherWsum);
            core += w * ((m.axisS[a.name] || 0) + 1) / 2;
          }
          m.score = Math.round(Math.max(0, 100 * core - (m.pDil || 0)) * 10) / 10; // pAuth=0
          m.lamps.push('collapse-reweight-applied');
        }
        collapseReweight = { axis: 'durability', rhoDomAxis: Math.round(rhoDomAxis * 100) / 100, threshold: T, haircutFrac: Math.round(hf * 1000) / 1000, wDurBefore: durAx.w, wDurAfter: Math.round(wDur * 1000) / 1000, note: 'pro-rata redistribution slightly re-couples score to growth/gm/accel when active' };
      }
    }
  }

  // Null-sicherer Sort (Fix C): Out-Class-Member (medtech) haben score=null → ans Ende sortiert.
  // PARITÄT: Für SaaS/Fabless ist score NIE null → der Vergleich verhält sich identisch zum alten
  // `b.score - a.score`; der Ticker-Tiebreak greift nur bei exakten Score-Gleichständen, die im
  // court-PASSED-Baseline-Run nicht auftreten (verifiziert per byte-parity test). Medtech-only Verhalten.
  if (bucket === 'diagnostics_lst') {
    // v1.2 Fix 3: demotion-aware Sort MIT echtem Score-Haircut. Ein decelerierender Serial-Acquirer (VCYT)
    // darf weder #1 sein NOCH einen angezeigten Score über dem besten nicht-demovierten Headline-Namen tragen.
    // Vorgehen (principled + disclosed): (1) prozentualer Haircut CHRONIC_DECEL_HAIRCUT auf den Roh-Score;
    // (2) HARTE Deckelung knapp unter den höchsten nicht-demovierten Headline-Score, falls der gehaircutete
    // Score immer noch >= diesem liegt → der ANGEZEIGTE Score (m.score) liegt garantiert unter dem #1-Pick und
    // die Leiter liest sich monoton. Der Roh-Score bleibt als m.scorePreHaircut für Audit erhalten.
    const CHRONIC_DECEL_HAIRCUT = 0.12; // [TODO-CAL] 12% Score-Strafe für chronic-acquirer + decelerating
    const nonDemotedHeadlineScores = members
      .filter(m => m.headlineShortlist && !m.headlineDemoted && m.score != null)
      .map(m => m.score);
    const maxNonDemoted = nonDemotedHeadlineScores.length ? Math.max(...nonDemotedHeadlineScores) : null;
    for (const m of members) {
      if (m.headlineShortlist && m.headlineDemoted && m.score != null) {
        let s = Math.round(m.score * (1 - CHRONIC_DECEL_HAIRCUT) * 10) / 10;
        if (maxNonDemoted != null && s >= maxNonDemoted) {
          s = Math.round((maxNonDemoted - 0.1) * 10) / 10; // hart unter den besten nicht-demovierten Headline-Namen
        }
        m.score = s; // ECHTER angezeigter Score-Haircut (nicht nur Sort-Key)
      }
    }
    const scoreKey = m => (m.score == null ? -Infinity : m.score);
    members.sort((a, b) => scoreKey(b) - scoreKey(a) || a.ticker.localeCompare(b.ticker));
  } else if (bucket === 'medtech_devices') {
    const scoreKey = m => (m.score == null ? -Infinity : m.score);
    members.sort((a, b) => scoreKey(b) - scoreKey(a) || a.ticker.localeCompare(b.ticker));
  } else {
    // audit/fix (gauntlet E3): SI-4 null-sicherer Sort für saas/fabless (Out-Class hat jetzt score=null).
    // Spiegelt medtech/dlst (scoreKey: null → -Infinity ans Ende, Ticker-Tiebreak). Für In/Borderline
    // (score!=null) verhält sich der Vergleich identisch zum alten `b.score - a.score` → die gerankten
    // Headline-Namen behalten ihre exakte Reihenfolge; nur die genullten Out-Class-Namen wandern ans Ende.
    const scoreKey = m => (m.score == null ? -Infinity : m.score);
    members.sort((a, b) => scoreKey(b) - scoreKey(a) || a.ticker.localeCompare(b.ticker));
  }

  // Basis-Result (byte-identisch zur court-PASSED-Form für SaaS/Fabless).
  const R = {
    label: F.label, degraded: F.degraded, degradedNote: F.degradedNote || null, a2Note: F.a2Note || null,
    normTableId: F.normTableId || null,
    universeSize: members.length,
    anchors: stats, anchorsA2: statsA2,
    collapseSpearman: collapse == null ? null : Math.round(collapse * 100) / 100,
    rhoDomAxisDurability: rhoDomAxis == null ? null : Math.round(rhoDomAxis * 100) / 100,
    collapseReweight,
    members,
  };
  // Medtech-only Zusatzfelder (Fix A/C/G) — NUR auf dem medtech-Bucket, damit SaaS/Fabless-JSON byte-identisch bleibt.
  if (bucket === 'medtech_devices') {
    // Fix A (SI-5): classifiedCount vs scoredCount → stille Drops werden laut (Test failt bei Mismatch).
    R.classifiedCount = cls.filter(c => c.bucket === bucket).length;
    R.scoredCount = members.length;
    // Fix G (SI-3 NOTE): absKaliber cross-bucket-comparable; REL ist bucket-relativ.
    R.comparabilityNote = `absKaliber in [0,1] = cross-bucket-comparable absolute scale (normTableId '${getNormTableId('medtech_devices')}'); the REL/core component is bucket-relative (cross-sectional z/MAD) and NOT cross-bucket comparable. blendScore mixes both (beta=0.6).`;
    // Fix C (SI-4): excluded[] = Out-Class-Namen, getrennt von den ranked headline members.
    R.excluded = members.filter(m => m.membershipClass === 'Out');
  }
  // D&LST-only Zusatzfelder (SI-3/4/5/6) — NUR auf dem dlst-Bucket → SaaS/Fabless/Medtech-JSON byte-identisch.
  if (bucket === 'diagnostics_lst') {
    // SI-5: classifiedCount === scoredCount (fail-loud Assert im Test).
    R.classifiedCount = cls.filter(c => c.bucket === bucket).length;
    R.scoredCount = members.length;
    // SI-3: comparabilityNote + Kohorten-Offenlegung + normTableId.
    R.normTableId = getNormTableId('diagnostics_lst');
    R.cohortAware = true;
    R.cohortCounts = { dx: members.filter(m => m._cohort === 'dx').length, tools: members.filter(m => m._cohort === 'tools').length };
    R.anchorsByCohort = statsByCohort; // per-Kohorte z/MAD-Anker (dx vs tools), für Audit
    // v1.2 Fix 4 (DISCLOSURE-DRIFT-GUARD): die GM-Norm-Strings werden aus den LIVE NORMS interpoliert
    // (NORMS.diagnostics_lst_{dx,tools}.gm.floor/.elite) statt hardcoded — so kann der Disclosure-Text NIE
    // von der tatsächlichen Norm-Tabelle abdriften (v1.1 hatte hardcoded 'tools gm .38/.58' während der live
    // Floor schon 0.30 war). fmtGm formatiert 0.28 -> '.28'.
    const fmtGm = x => (x == null ? '—' : x.toFixed(2).replace(/^0\./, '.'));
    const _dxGm = NORMS.diagnostics_lst_dx.gm, _toolsGm = NORMS.diagnostics_lst_tools.gm;
    R.comparabilityNote = `cohort-aware bucket (dx | tools). absKaliber in [0,1] = cross-bucket-comparable absolute scale (cohort-specific GM norm under normTableId '${getNormTableId('diagnostics_lst')}': dx gm ${fmtGm(_dxGm.floor)}/${fmtGm(_dxGm.elite)}, tools gm ${fmtGm(_toolsGm.floor)}/${fmtGm(_toolsGm.elite)}); the REL/core component is cross-sectional z/MAD computed PER COHORT (dx vs dx, tools vs tools) and is NOT cross-bucket comparable. blendScore mixes both (beta=0.6, absWeights {growth .40, gm .20, eff .40}). Efficiency = FCF-margin primary, opMargin fallback (>15pp distortion or fcf-null). R&D + shares DEFERRED → coverage-null lamps, never penalized. v1.1 Fix D (CROSS-BUCKET DISCLOSURE): the blended 0-100 'score' is INTRA-BUCKET ONLY — it mixes a 40% per-cohort REL component and is NOT comparable across buckets. Comparing a dlst name against a medtech name on the blended ladder is a FALSE comparison. The ONLY cross-bucket-comparable measure is 'absKaliber' (each member carries scoreScope='intra-bucket' + crossBucketComparableField='absKaliber').`;
    // v1.1 Fix D: expliziter per-bucket Marker + per-member-Felder, die den Vergleichsumfang offenlegen.
    R.scoreScope = 'intra-bucket';
    R.crossBucketComparableField = 'absKaliber';
    R.crossBucketComparableNote = 'Use members[].absKaliber (absolute [0,1] caliber) for cross-bucket comparison; members[].score (blended 0-100) is intra-bucket ONLY (mixes per-cohort REL, beta=0.6).';
    for (const m of members) {
      m.scoreScope = 'intra-bucket';
      m.crossBucketComparableField = 'absKaliber';
    }
    // SI-4: excluded[] = Out-Class-Namen.
    R.excluded = members.filter(m => m.membershipClass === 'Out');
  }
  // audit/fix (gauntlet E3): saas/fabless SI-4/SI-5-Retrofit — spiegelt medtech/dlst exakt.
  // NUR auf den beiden Buckets gesetzt; medtech/dlst haben ihre eigenen Blöcke oben. Diese Felder
  // wurden in die saas/fabless-Parity-Baselines re-gefroren (BEWUSSTER Governance-Bless, kein Drift):
  //   SI-5: classifiedCount === scoredCount → stille (UNbeabsichtigte) Drops werden laut (Test failt).
  //   SI-4: excluded[] = Out-Class-Namen (score=null oben), getrennt von den ranked headline members.
  if (bucket === 'system_app_software' || bucket === 'fabless_semi') {
    // SI-5 KILL-AWARE: anders als medtech/dlst (deren classified-Set KEINE KILL-Member enthält) tragen
    // saas/fabless skeptiker-verifizierte KILL-Removals (PS/RDVT/ADEA/OMDA/TEM/KMTS — Ticker-Mismatch/
    // falscher Sektor/Datenfehler, siehe KILL-Set + fabless-Anti-Kontaminations-Guard-Test). Diese sind
    // BEABSICHTIGT „accounted for", also aus classifiedCount ausgeschlossen — sonst meldete der Assert
    // 5/1 FALSCH-POSITIVE „stille Drops". classifiedCount zählt damit jeden NICHT-gekillten klassifizierten
    // Record; bleibt ein nicht-gekillter Record je still ungescored (dedup-Kollision/fehlende candidate-Row/
    // gm>1.0), gilt classifiedCount>scoredCount und der SI-5-Assert feuert wie vorgesehen.
    R.classifiedCount = cls.filter(c => c.bucket === bucket && !KILL.has(c.t)).length;
    R.scoredCount = members.length;
    R.excluded = members.filter(m => m.membershipClass === 'Out');
  }
  results[bucket] = R;
}

function pct(x) { return (x == null ? '—' : (x * 100).toFixed(0) + '%').padStart(5); }

// audit/fix (gauntlet C5): MARQUEE US-Namen, die NIEMALS aus dem Universum exiliert werden dürfen
// (Schutz gegen FAILURE MODE 1 — vintage-A exile: ein naiver country-Filter würde Vintage-A-Namen mit
// meta.country=undefined still droppen). Pro implementiertem Bucket offensichtliche US-Flaggschiffe, die
// (a) in court-buckets.json in DIESEN Bucket klassifiziert UND (b) bestätigt US-Listing sind. WICHTIG: nur
// Namen, die das Hypergrowth-Vorfilter (growth>=12%, court-screen.js) tatsächlich passieren — Mega-Caps wie
// MSFT/CRM/QCOM wachsen darunter und sind LEGITIM nicht im Bucket (kein Exil-Bug). Mehrere hier (NVDA/AVGO/
// MDT/SYK/TMO/IDXX/ISRG) sind Vintage A (country=undefined) → genau die, die ein naiver Filter exilieren würde.
// Der Assert prüft PRÄSENZ im gescorten Universum (members[]), NICHT Abwesenheit aus excluded[] — denn
// excluded[]==membership-Out (Large-Caps am Growth-Floor) ist DESIGN-konform, kein Exil (ABT/BSX/DHR/A liegen
// korrekt in excluded[] und MÜSSEN dennoch im Universum=members[] sein).
const MARQUEE_US = {
  system_app_software: ['DDOG', 'CRWD'],
  fabless_semi: ['NVDA', 'AVGO', 'AMD'],
  medtech_devices: ['MDT', 'SYK', 'ABT', 'BSX', 'ISRG'],
  diagnostics_lst: ['TMO', 'DHR', 'IDXX', 'A'],
};

// assertNoForeignLeak(results, listing): GENERATIVER Anti-Leak-Property-Assert (KEINE N-Namen-Whitelist).
// Spiegelt den SI-5-fail-loud-Stil (classifiedCount===scoredCount). Wirft, sobald IRGENDEIN klassifizierter
// (bucket-zugewiesener, gescorter) Record laut Side-File meta.country GESETZT UND != "United States" hat
// UND NICHT als US-Primary-Listing erkannt ist (listing.isUS === false). So fängt der Assert STRUKTURELL
// jeden foreign-primary-ADR-Leak (FAILURE MODE 2 — z.B. BTI/ABEV/FMX/CNI/CP mit region UK/EM/CA), ohne
// die verifizierten US-Primary-Inversions (ARM/ESTC/INMD…: country!=US, aber isUS===true via region="US")
// fälschlich zu treffen. TOLERANT: fehlt das Side-File (leere Map), no-op (kann nichts prüfen).
// audit/fix (gauntlet C5): failure modes = vintage-A exile (marquee-Assert) + foreign-ADR leak (dieser Assert).
function assertNoForeignLeak(resultsObj, listing) {
  if (!listing || listing.size === 0) return; // Side-File fehlt → strukturell nicht prüfbar, nichts brechen
  // (1) GENERATIVER Anti-Leak-Assert: kein gescorter Record mit country SET != US, der kein US-Listing ist.
  const leaks = [];
  for (const [bucket, R] of Object.entries(resultsObj)) {
    if (!R || !Array.isArray(R.members)) continue;
    for (const m of R.members) {
      const L = listing.get(m.ticker);
      if (!L) continue; // kein Snapshot-Meta → kann nichts behaupten (Vintage-A ohne Eintrag: tolerant)
      const c = L.country;
      if (c != null && c !== 'United States' && L.isUS === false) {
        leaks.push(`${m.ticker}[${c}/${L.region}] in ${bucket}`);
      }
    }
  }
  if (leaks.length) {
    throw new Error(`ANTI-LEAK ASSERT (gauntlet C5): foreign-country record(s) leaked into a scored bucket — `
      + `meta.country gesetzt UND != "United States" UND kein US-Listing: ${leaks.join(', ')}. `
      + `Klassifizierer in court-screen.js (isUSListing) muss diese ausschließen — NICHT suppressen.`);
  }
  // (2) MARQUEE fail-loud Assert: jedes klassifizierte+US Flaggschiff MUSS im gescorten Universum
  //     (members[]) auftauchen — andernfalls wurde es STILL aus dem Universum exiliert (FAILURE MODE 1,
  //     vintage-A exile). Präsenz in In- ODER Out-Klasse (excluded[]) ist beides ok; FEHLEN ist der Bug.
  //     Tolerant: ist ein Marquee-Name gar nicht im Snapshot-Listing oder als !US markiert, überspringen
  //     (dann ist er legitim nicht klassifiziert/kein US-Listing, kein Exil).
  const marqueeViolations = [];
  for (const [bucket, names] of Object.entries(MARQUEE_US)) {
    const R = resultsObj[bucket];
    if (!R || !Array.isArray(R.members)) continue;
    const memberSet = new Set(R.members.map(m => m.ticker));
    for (const t of names) {
      const L = listing.get(t);
      if (!L || L.isUS !== true) continue; // kein bestätigtes US-Listing → keine Exil-Behauptung
      if (!memberSet.has(t)) marqueeViolations.push(`${t} (marquee ${bucket}) fehlt im gescorten Universum`);
    }
  }
  if (marqueeViolations.length) {
    throw new Error(`MARQUEE ASSERT (gauntlet C5): US-Flaggschiff(e) aus dem Universum exiliert (vintage-A exile): `
      + `${marqueeViolations.join(', ')}.`);
  }
}

// --- Export: computeMedtechOrganicGrowth + computeDlstOrganicGrowth für Unit-Tests ---
// (computeDlstOrganicGrowth: Fix A FY-Alignment + Fix B dealYearExcluded-Ehrlichkeit, 2026-06-21)
// + assertNoForeignLeak (gauntlet C5) für direkten Property-Test.
module.exports = { computeMedtechOrganicGrowth, computeDlstOrganicGrowth, assertNoForeignLeak };

// --- require.main-Guard (Härtung 2): Write + Ausgabe NUR wenn direkt als Skript ausgeführt ---
// `require('./court-score.js')` gibt nur den Export zurück und schreibt NICHT outputs/court-results.json.
// `node court-score.js` schreibt und gibt aus (unverändert).
if (require.main === module) {
  // audit/fix (gauntlet C5): fail-loud VOR dem Write — ein foreign-country-Leak (FAILURE MODE 2) oder ein
  // exiliertes US-Marquee (FAILURE MODE 1) wirft hier, bevor outputs geschrieben/Picks promotet werden.
  assertNoForeignLeak(results, listingByTicker);
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));

  // --- Ausgabe ---
  for (const [bucket, R] of Object.entries(results)) {
    console.log('\n' + '='.repeat(90));
    console.log(`### ${R.label}`);
    console.log(`Universum: ${R.universeSize} Namen | Kollaps-Detektor Spearman(Score, Quality-Block) = ${R.collapseSpearman}`);
    if (R.degraded) console.log(`⚠ DEGRADIERT: ${R.degradedNote}`);
    const F = FORMULAS[bucket];
    // MEMBERSHIP-GATE greift jetzt: nur In + Borderline sind rankbare Picks; Out separat gelistet.
    const ranked = R.members.filter(m => m.membershipClass !== 'Out');
    const outClass = R.members.filter(m => m.membershipClass === 'Out').sort((a, b) => (b.score == null ? -Infinity : b.score) - (a.score == null ? -Infinity : a.score));
    for (const st of F.stages) {
      const inStage = ranked.filter(m => m.stage === st.name);
      if (!inStage.length) continue;
      console.log(`\n  --- Stage: ${st.name} (${inStage.length}, membership-gated) ---`);
      console.log('  TICKER  Score  Memb(cls)   g     gm    fcf   SBC%  Pdil  ' + F.axes.map(a => a.name).join(' ') + '  Lampen');
      for (const m of inStage.slice(0, 10)) {
        const axes = F.axes.map(a => String(m.axisS[a.name]).padStart(5)).join(' ');
        console.log(`  ${m.ticker.padEnd(7)} ${String(m.score).padStart(5)}  ${String(m.membership).padStart(4)}(${m.membershipClass[0]})  ${pct(m.growth)} ${pct(m.gm)} ${pct(m.fcfMargin)} ${pct(m.sbcPct)} ${String(m.pDil).padStart(4)}  ${axes}  ${m.lamps.join(',')}`);
      }
    }
    if (outClass.length) {
      console.log(`\n  --- Out-Klasse (Membership-Gate ausgeschlossen, ${outClass.length}) ---`);
      console.log('  ' + outClass.map(m => `${m.ticker}(${m.membership}, score ${m.score})`).join(' · '));
    }
    console.log(`  [removed pre-score (skeptiker-kill): ${[...KILL].join(', ')}]`);
  }
  console.log(`\n-> ${OUT}`);
}
