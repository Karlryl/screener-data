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
const { absKaliber, absKaliberIndustrials, absKaliberStaples, absKaliberConsDisc, absKaliberMaterials, absKaliberEnergy, absKaliberPharma, absKaliberItServices, absKaliberBanks, absKaliberReits, absKaliberCapmkt, blendScore, gateOpen, normTableId: getNormTableId, NORMS } = require('./lib/absolute-anchor');
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
  // ===========================================================================
  // industrials_compounder (CORE) — TWO cohorts by asset-intensity (Spec v1 2026-06-21).
  // ===========================================================================
  // 5 SCORED axes (gpa/growth/assetGrowthPenalty/netIssuance/eff), §3 weights {0.34,0.22,0.18,0.12,0.14}.
  // absKaliberIndustrials = weighted-q over the 5 axes reading the cohort NORMS with COVERAGE-RENORM (drop
  // any NOT_READY/null axis incl. ISSUANCE_NOT_READY/SPINOFF_REBASE, renormalize survivors to Σ=1.0). REL z/MAD
  // per-cohort (each is its own bucket, n≫15). blend score=100*(0.6*ABS+0.4*REL), β=0.6. RAW inputs come from
  // m.ind.* (court-screen snapshot extraction; deal-mask + spin-off guard applied UPSTREAM). The inverted axes
  // (assetGrowthPenalty/netIssuance) negate the raw for BOTH the q-input AND the cross-sectional REL z (higher
  // q = better → REL must agree in sign). industrials = NEW code keyed by the new cohort strings; existing
  // buckets (medtech/dlst/saas/fabless) are BYTE-IDENTICAL (their paths untouched).
  industrials_heavy: {
    label: 'Industrials-Compounder v1 (heavy: capital-goods/A&D/electrical; absolute-anchor, GP/assets pillar, cyclicality-floored deal-masked growth, spin-off guard, asset-growth+net-issuance discipline, coverage-renorm)',
    membership: { g: { c: 0.00, s: 0.06 }, gm: { c: 0.10, s: 0.08 }, scaleLog: { c: log10(1000), s: 0.6 } },
    axes: [
      { key: 'gpa',                name: 'GP/Assets',  k: 1.5, w: 0.34 },
      { key: 'growth',             name: 'Growth',     k: 2.0, w: 0.22 },
      { key: 'assetGrowthPenalty', name: 'AssetGrowth', k: 1.5, w: 0.18 },
      { key: 'netIssuance',        name: 'NetIssuance', k: 1.5, w: 0.12 },
      { key: 'eff',                name: 'Eff-OpFcf',  k: 1.5, w: 0.14 },
    ],
    dilCap: 0, dilStart: 0.05, dilRange: 0.20, // net-issuance is a SCORED axis (E); no separate SBC penalty.
    stages: [
      { name: 'S3-Cash-Compounder', test: f => f >= 0.20 },
      { name: 'S2-FCF-positiv',     test: f => f >= 0.08 },
      { name: 'S1-Approaching',     test: f => f >= -0.05 },
      { name: 'S0-Cyclical-Trough', test: () => true },
    ],
    dominantBlock: ['gpa', 'eff'],
    degraded: false,
    normTableId: 'industrials_heavy-norms-2026-06-21',
    industrials: true, cohortKey: 'industrials_heavy',
    a2Note: 'industrials_compounder v1 (Spec formula-design-industrials-compounder-v1-2026-06-21.md, Court-PASSED). CORE quality-compounder + cyclical overlay. 5 SCORED axes via absKaliberIndustrials: GP/assets (Novy-Marx, w .34, cohort-specific norm), organic growth (w .22, deal-masked §4.1 + cyclicality blend-floor §4.2 + spin-off re-baselining guard §4.3 applied UPSTREAM → NOT_READY:growth), asset-growth penalty (Cooper-Gulen-Schill, w .18, q(-assetGrowth)), net-share-issuance penalty (Pontiff-Woodgate, w .12, q(-NSI); ~57% coverage — Vintage-A snapshots carry no annualShares → DROP+renorm+ISSUANCE_NOT_READY, the load-bearing coverage-renorm path), op-weighted efficiency (0.60*opMargin+0.40*fcfMargin, w .14, cohort-specific norm). COVERAGE-RENORM: any NOT_READY/null axis is dropped and surviving weights renormalize to Σ=1.0 (no fake-neutral impute). score=100*(0.6*absKaliber+0.4*REL), β=0.6, REL per-cohort (n=165≫15). WALLS (always-on lamps): CYCLE_WALL (~4y history, no normalized-10y-ROIC), INVENTORY_BLIND (no inventory line), UNBILLED_BLIND (no contract-asset line), BACKLOG_FUTURE (no book-to-bill/RPO → Axis F future BONUS, weight 0). SI-4 out-of-class (excluded industry / non-US / <$1B) → score=null + excluded[]; SI-5 classifiedCount===scoredCount+excludedCount fail-loud; marquee assert (RTX/LMT/NOC/UNP/NSC/WM/RSG/ITW/PH/ETN/GD/EMR/CAT/DE/BA/GE) fail-loud. Disclosed: Axis E ~57% coverage (data-vintage gap, not a formula flaw); ZTO operational-ADR leak (1/141 light, MAD-robust). Additive/parity-safe: saas/fabless/medtech/dlst byte-identical. Constants frozen §6.5.',
  },
  industrials_light: {
    label: 'Industrials-Compounder v1 (light: services/rail/freight/waste/distribution; absolute-anchor, GP/assets pillar, cyclicality-floored deal-masked growth, spin-off guard, asset-growth+net-issuance discipline, coverage-renorm)',
    membership: { g: { c: 0.00, s: 0.06 }, gm: { c: 0.18, s: 0.10 }, scaleLog: { c: log10(1000), s: 0.6 } },
    axes: [
      { key: 'gpa',                name: 'GP/Assets',  k: 1.5, w: 0.34 },
      { key: 'growth',             name: 'Growth',     k: 2.0, w: 0.22 },
      { key: 'assetGrowthPenalty', name: 'AssetGrowth', k: 1.5, w: 0.18 },
      { key: 'netIssuance',        name: 'NetIssuance', k: 1.5, w: 0.12 },
      { key: 'eff',                name: 'Eff-OpFcf',  k: 1.5, w: 0.14 },
    ],
    dilCap: 0, dilStart: 0.05, dilRange: 0.20,
    stages: [
      { name: 'S3-Cash-Compounder', test: f => f >= 0.20 },
      { name: 'S2-FCF-positiv',     test: f => f >= 0.08 },
      { name: 'S1-Approaching',     test: f => f >= -0.05 },
      { name: 'S0-Cyclical-Trough', test: () => true },
    ],
    dominantBlock: ['gpa', 'eff'],
    degraded: false,
    normTableId: 'industrials_light-norms-2026-06-21',
    industrials: true, cohortKey: 'industrials_light',
    a2Note: 'industrials_compounder v1 light cohort (asset-light services / recurring-revenue / EPC / distribution; rail = asset-heavy residual §7-#7). Same 5-axis absKaliberIndustrials engine + coverage-renorm as industrials_heavy; cohort-specific gpa (.09/.48) + eff (.02/.20) norms; growth/assetGrowthPenalty/netIssuance anchors shared. n=141≫15 → full ABS+REL blend. ZTO (Chinese Integrated-Freight ADR) is the disclosed single-name residual leak (1/141, linear q floors it, MAD-robust). See industrials_heavy.a2Note for the full mechanism. Additive/parity-safe; constants frozen §6.5.',
  },
  // ===========================================================================
  // consumer_staples_compounder (CORE) — TWO cohorts by ECONOMIC MODEL (margin-driven branded vs
  // turns-driven distribution). Spec formula-design-consumer-staples-compounder-v1-2026-06-21.md (Court
  // DESIGN-PASS 4/4). MIRRORS the industrials path: 5 SCORED axes (gpa/growth/assetGrowthPenalty/netIssuance/
  // eff) via absKaliberStaples (the same weighted-q + coverage-renorm engine), but staples weights
  // {gpa .36, growth .18, assetGrowthPenalty .18, netIssuance .12, eff .16} (STRONG profitability+discipline
  // pillar 0.66 ≫ growth 0.18). REL z/MAD per-cohort (each its own bucket, n≫15). blend score=100*(0.6*ABS+
  // 0.4*REL), β=0.6. RAW inputs from m.stp.* (court-screen snapshot extraction; deal-mask + spin-off guard
  // applied UPSTREAM). The inverted axes (assetGrowthPenalty/netIssuance) negate the raw for BOTH the q-input
  // AND the cross-sectional REL z. staples = NEW code keyed by the new cohort strings; existing buckets
  // (medtech/dlst/saas/fabless/industrials) are BYTE-IDENTICAL.
  staples_branded: {
    label: 'Consumer-Staples-Compounder v1 (branded: packaged-food/household/beverages/tobacco/confectioners; absolute-anchor, GP/assets pillar, deal-masked spin-off-guarded growth, asset-growth+net-issuance discipline, op-weighted efficiency, coverage-renorm, VOLUME_PRICE_BLIND)',
    membership: { g: { c: 0.00, s: 0.05 }, gm: { c: 0.15, s: 0.08 }, scaleLog: { c: log10(1000), s: 0.6 } },
    axes: [
      { key: 'gpa',                name: 'GP/Assets',  k: 1.5, w: 0.36 },
      { key: 'growth',             name: 'Growth',     k: 2.0, w: 0.18 },
      { key: 'assetGrowthPenalty', name: 'AssetGrowth', k: 1.5, w: 0.18 },
      { key: 'netIssuance',        name: 'NetIssuance', k: 1.5, w: 0.12 },
      { key: 'eff',                name: 'Eff-OpFcf',  k: 1.5, w: 0.16 },
    ],
    dilCap: 0, dilStart: 0.05, dilRange: 0.20, // net-issuance is a SCORED axis (E); no separate SBC penalty.
    stages: [
      { name: 'S3-Cash-Compounder', test: f => f >= 0.20 },
      { name: 'S2-FCF-positiv',     test: f => f >= 0.08 },
      { name: 'S1-Approaching',     test: f => f >= -0.05 },
      { name: 'S0-Defensive',       test: () => true },
    ],
    dominantBlock: ['gpa', 'eff'],
    degraded: false,
    normTableId: 'staples_branded-norms-2026-06-21',
    staples: true, cohortKey: 'staples_branded',
    a2Note: 'consumer_staples_compounder v1 branded cohort (Spec formula-design-consumer-staples-compounder-v1-2026-06-21.md, Court DESIGN-PASS 4/4). Margin-driven brand-moat businesses (packaged food, household & personal, non-alcoholic + brewers, tobacco, confectioners, wineries & distilleries). 5 SCORED axes via absKaliberStaples: GP/assets (Novy-Marx, w .36, the load-bearing pillar, cohort-specific norm .15/.60), organic growth (w .18, deal-masked §4.1 + spin-off re-baselining guard §4.2 applied UPSTREAM → NOT_READY:growth; STAPLES-LOW elite 0.18; blend 0.60*latest + 0.40*MEDIAN(recent clean YoYs)), asset-growth penalty (Cooper-Gulen-Schill, w .18, q(-assetGrowth)), net-share-issuance penalty (Pontiff-Woodgate, w .12, q(-NSI); ~42% coverage — Vintage-A snapshots carry no annualShares → DROP+renorm+ISSUANCE_NOT_READY, the load-bearing coverage-renorm path on the MAJORITY of names), op-weighted efficiency (0.60*opMargin+0.40*fcfMargin, w .16, cohort-specific norm .05/.27). COVERAGE-RENORM: any NOT_READY/null axis dropped, survivors renormalize to Σ=1.0 (no fake-neutral impute). score=100*(0.6*absKaliber+0.4*REL), β=0.6, REL per-cohort (n=52≫15). WALLS (always-on lamps): VOLUME_PRICE_BLIND (the decisive volume-vs-price/mix split has NO us-gaap tag — uncomputable, MANUAL field, NEVER faked), MA_PROXY_ONLY (no goodwill line ⇒ totalAssets-jump proxy), INVENTORY_BLIND (no inventory line), CYCLE_WALL (~4y history, no normalized-10y-ROIC). SI-4 out-of-class (excluded industry Education / non-US per the v1 country-domicile guard / foreign-primary / <$1B) → score=null + excluded[]; SI-5 classifiedCount===scoredCount+excludedCount fail-loud; marquee assert (PG/KO/PEP/COST/WMT/MDLZ/CL/MO/PM) fail-loud + GENERATIVE anti-leak (no classified rec with meta.country set != US) + FOREIGN_CONTROL positive-control (KOF/RLX/DOLE/HLF/NOMD must NOT classify). Disclosed: Axis E ~42% coverage (data-vintage gap); the classifier leans on the company NAME (FOREIGN_NAME legal-form regex + 1-name residual RLX) for the undefined-country foreign-primary sub-class. Additive/parity-safe. Constants frozen §6.5.',
  },
  staples_distribution: {
    label: 'Consumer-Staples-Compounder v1 (distribution: discount stores/food distribution/grocery/farm products; absolute-anchor, GP/assets pillar [turns-driven INVERSION], deal-masked spin-off-guarded growth, asset-growth+net-issuance discipline, op-weighted efficiency, coverage-renorm, VOLUME_PRICE_BLIND)',
    membership: { g: { c: 0.00, s: 0.05 }, gm: { c: 0.10, s: 0.08 }, scaleLog: { c: log10(1000), s: 0.6 } },
    axes: [
      { key: 'gpa',                name: 'GP/Assets',  k: 1.5, w: 0.36 },
      { key: 'growth',             name: 'Growth',     k: 2.0, w: 0.18 },
      { key: 'assetGrowthPenalty', name: 'AssetGrowth', k: 1.5, w: 0.18 },
      { key: 'netIssuance',        name: 'NetIssuance', k: 1.5, w: 0.12 },
      { key: 'eff',                name: 'Eff-OpFcf',  k: 1.5, w: 0.16 },
    ],
    dilCap: 0, dilStart: 0.05, dilRange: 0.20,
    stages: [
      { name: 'S3-Cash-Compounder', test: f => f >= 0.20 },
      { name: 'S2-FCF-positiv',     test: f => f >= 0.08 },
      { name: 'S1-Approaching',     test: f => f >= -0.05 },
      { name: 'S0-Defensive',       test: () => true },
    ],
    dominantBlock: ['gpa', 'eff'],
    degraded: false,
    normTableId: 'staples_distribution-norms-2026-06-21',
    staples: true, cohortKey: 'staples_distribution',
    a2Note: 'consumer_staples_compounder v1 distribution cohort (turns-driven razor-thin-margin retailers/grocers/distributors/processors: discount stores, food distribution, grocery stores, farm products). Same 5-axis absKaliberStaples engine + coverage-renorm as staples_branded; cohort-specific gpa (.10/.66 — the GP/assets INVERSION: distrib p50 49.5% > branded p50 28.4% because clubs/grocers turn assets 4-8× at razor-thin gross MARGIN) + eff (.01/.09 — op-margin p50 3.8%, ~3.8× below branded) norms; growth/assetGrowthPenalty/netIssuance anchors shared. n=23≫15 → full ABS+REL blend. Farm Products / agribusiness (TSN/ADM/BG/ANDE) cluster at the GP/assets floor (~7-16%, CYCLE_WALL) — the linear q floors them honestly without a sub-cohort (which would fall below n≥15). CALM egg-price op-margin spike is the disclosed outlier the MAD-robust REL absorbs. See staples_branded.a2Note for the full mechanism + walls + asserts. Additive/parity-safe; constants frozen §6.5.',
  },
  // ===========================================================================
  // consdisc_expansion (CORE) — TWO cohorts by ASSET-INTENSITY (asset-light Internet-Retail vs store/
  // real-estate-heavy retail+restaurants). Spec formula-design-consumer-disc-expansion-v1-2026-06-21.md
  // (Court FINAL DESIGN-PASS 4/4). DISTINCT from industrials/staples: FOUR scored axes (gpa/growth/
  // assetGrowthPenalty/eff) via absKaliberConsDisc, weights {gpa .40, growth .25, assetGrowthPenalty .20,
  // eff .15} (STRONG pillar gpa+assetGrowth = 0.60 ≫ growth 0.25). Share dilution is NOT a 5th axis — it is
  // a POST-SUM bounded haircut on absKaliber (shareCAGR, §3). REL z/MAD per-cohort. PER-COHORT β: store
  // (n≫15) blends score=100*(0.6*ABS+0.4*REL), β=0.6; LIGHT (n<15, thin-REL) runs ABS-ONLY score=100*ABS,
  // β=1, THIN_REL always on (§1.3 — an honest ABS-only score beats a fake-clean REL across the lease-
  // distorted pool). RAW inputs from m.cd.* (court-screen snapshot extraction; deal-mask applied UPSTREAM).
  // The inverted axis (assetGrowthPenalty) negates the raw for BOTH the q-input AND the cross-sectional REL z.
  // consdisc = NEW code keyed by the new cohort strings; existing buckets (medtech/dlst/saas/fabless/
  // industrials/staples) are BYTE-IDENTICAL.
  consdisc_store: {
    label: 'Consumer-Disc-Expansion v1 (store: specialty/apparel/footwear/home-improvement retail + restaurants; absolute-anchor, GP/assets pillar, deal-masked cyc-floored annual growth, Cooper-Gulen-Schill asset-growth penalty, Mohanram fcf-weighted efficiency, post-sum dilution haircut, coverage-renorm, LEASE_DISTORTED)',
    membership: { g: { c: 0.04, s: 0.06 }, gm: { c: 0.21, s: 0.10 }, scaleLog: { c: log10(1000), s: 0.6 } },
    axes: [
      { key: 'gpa',                name: 'GP/Assets',  k: 1.5, w: 0.40 },
      { key: 'growth',             name: 'Growth',     k: 2.0, w: 0.25 },
      { key: 'assetGrowthPenalty', name: 'AssetGrowth', k: 1.5, w: 0.20 },
      { key: 'eff',                name: 'Eff-FcfOp',  k: 1.5, w: 0.15 },
    ],
    dilCap: 0, dilStart: 0.05, dilRange: 0.20, // share dilution is a POST-SUM absKaliber haircut (§3), no separate SBC penalty.
    stages: [
      { name: 'S3-Cash-Compounder', test: f => f >= 0.20 },
      { name: 'S2-FCF-positiv',     test: f => f >= 0.08 },
      { name: 'S1-Approaching',     test: f => f >= -0.05 },
      { name: 'S0-Expansion',       test: () => true },
    ],
    dominantBlock: ['gpa', 'assetGrowthPenalty'],
    degraded: false,
    normTableId: 'consdisc_store-norms-2026-06-21',
    consdisc: true, cohortKey: 'consdisc_store', beta: 0.6,
    a2Note: 'consdisc_expansion v1 store cohort (Spec formula-design-consumer-disc-expansion-v1-2026-06-21.md, Court FINAL DESIGN-PASS 4/4). Asset-light Internet-Retail split OFF into consdisc_light; this cohort = store/real-estate-heavy specialty/apparel/footwear/home-improvement retail + restaurants (large capitalized ASC-842 ROU lease assets in the GP/assets denominator — common-mode WITHIN the cohort, the F1 lease-bias fix). 4 SCORED axes via absKaliberConsDisc: GP/assets (Novy-Marx, w .40, the load-bearing pillar, cohort-specific norm .21/.85), organic growth (w .25, deal-masked §4.1 [assetJump>=0.25 AND revJump>=0.20] + cyclicality blend 0.70*latest clean YoY + 0.30*2y CAGR §4.2, annual-sourced D1, elite 0.22), asset-growth penalty (Cooper-Gulen-Schill, w .20, q(-assetGrowth) {-0.30/0.00}; the heart of the edge — scored, never masked), Mohanram fcf-weighted efficiency (0.60*fcfMargin+0.40*opMargin, w .15, cohort-shared norm .02/.18). STRONG pillar gpa+assetGrowth=0.60 ≫ growth 0.25 (F2). DILUTION HAIRCUT (§3, NOT a 5th axis): absK*(1-clip(shareCAGR,0,0.06)/0.06*0.10) — net issuance >=6%/yr -> 10% absolute-score haircut, buybacks no bonus. COVERAGE-RENORM: any NOT_READY/null axis dropped, survivors renormalize to Σ=1.0 (no fake-neutral impute). score=100*(0.6*absKaliber+0.4*REL), β=0.6, REL per-cohort (n>=31>=15). WALLS (always-on lamps): LEASE_DISTORTED (GP/assets denominator carries capitalized ASC-842 ROU — common-mode within cohort, not lease-adjustable from data, the only honest fix is the split), INVENTORY_BLIND (no inventory line ⇒ DIO/markdown uncomputable, the single biggest data wall). SI-4 out-of-class (excluded industry [auto-OEM ROIC=2.6% value trap, hotel/gaming/grocery] / non-US per country-domicile guard / foreign-primary / <$1B) → score=null + excluded[]; SI-5 classifiedCount===scoredCount+excludedCount fail-loud; marquee assert (AMZN/EBAY/ETSY/HD/CMG/DPZ/DRI/DECK/BBY/CAVA) fail-loud + foreign-exclude positive-control (JD/PDD/RERE/MELI/YUMC/ONON/QSR/BABA must NOT classify). Additive/parity-safe. Constants frozen §6.2.',
  },
  consdisc_light: {
    label: 'Consumer-Disc-Expansion v1 (light: Internet Retail; asset-light un-leased denominator; absolute-anchor, GP/assets pillar, deal-masked cyc-floored annual growth, Cooper-Gulen-Schill asset-growth penalty, Mohanram fcf-weighted efficiency, post-sum dilution haircut, coverage-renorm, THIN_REL ABS-only)',
    membership: { g: { c: 0.04, s: 0.06 }, gm: { c: 0.42, s: 0.10 }, scaleLog: { c: log10(1000), s: 0.6 } },
    axes: [
      { key: 'gpa',                name: 'GP/Assets',  k: 1.5, w: 0.40 },
      { key: 'growth',             name: 'Growth',     k: 2.0, w: 0.25 },
      { key: 'assetGrowthPenalty', name: 'AssetGrowth', k: 1.5, w: 0.20 },
      { key: 'eff',                name: 'Eff-FcfOp',  k: 1.5, w: 0.15 },
    ],
    dilCap: 0, dilStart: 0.05, dilRange: 0.20,
    stages: [
      { name: 'S3-Cash-Compounder', test: f => f >= 0.20 },
      { name: 'S2-FCF-positiv',     test: f => f >= 0.08 },
      { name: 'S1-Approaching',     test: f => f >= -0.05 },
      { name: 'S0-Expansion',       test: () => true },
    ],
    dominantBlock: ['gpa', 'assetGrowthPenalty'],
    degraded: false,
    normTableId: 'consdisc_light-norms-2026-06-21',
    consdisc: true, cohortKey: 'consdisc_light', beta: 1.0, absOnly: true,
    a2Note: 'consdisc_expansion v1 light cohort (asset-light Internet Retail only; un-leased fulfillment/3P-logistics denominator → cohort-specific GP/assets norm .42/.95, higher floor/elite than store). Same 4-axis absKaliberConsDisc engine + coverage-renorm + post-sum dilution haircut as consdisc_store; growth/eff/assetGrowthPenalty anchors SHARED (statistically indistinguishable across cohorts). THIN-N (§1.3): n<15 → ABS-ONLY (β=1, REL suppressed, THIN_REL always on) — we do NOT pool light into the store REL to manufacture n>=15 (that would re-introduce the lease-distorted cross-cohort comparison the Court killed in F1). An honest ABS-only score for the light names beats a fake-clean REL across a known-distorted pool; the ABS NORMS are recalibrated on the light-cohort distribution so ABS-only stays a faithful within-segment read. WALLS (always-on lamps): INVENTORY_BLIND (no inventory line). NOT lease-distorted (the whole point of the split — no LEASE_DISTORTED lamp). See consdisc_store.a2Note for the full axis/dilution/SI mechanism. Additive/parity-safe; constants frozen §6.2.',
  },
  // ===========================================================================
  // materials_quality (CORE) — TWO cohorts by PRICING-POWER vs COMMODITY (deterministic GICS-industry split).
  // Spec formula-design-materials_quality-v0-2026-06-22.md (Court DESIGN-PASS v0; NORMS recomputed-live-then-
  // frozen 2026-06-22 — the CORE gate). MIRRORS the industrials/staples path: 5 SCORED axes via the PARALLEL
  // engine absKaliberMaterials, BUT axis C is MARGINSTABILITY (an inverse-CV pricing-power proxy, identity-clip
  // {0,1}) instead of eff — so NOT a delegate to absKaliberIndustrials (whose 5th axis key is `eff`). Weights
  // {gpa .30, marginStability .20, growth .18, assetGrowthPenalty .18, netIssuance .14}: the anti-commodity
  // pillar gpa+marginStability+assetGrowthPenalty = 0.68 structurally dominates; growth capped at .18 BELOW the
  // pillar (the guarantee that a price-windfall revenue/margin spike cannot manufacture a top score —
  // QUALITY-ONLY, no commodity-price bets). REL z/MAD per-cohort (each its own bucket, n≫15: pricingpower 40,
  // commodity 55). blend score=100*(0.6*ABS+0.4*REL), β=0.6. RAW inputs from m.mt.* (court-screen snapshot
  // extraction; deal-mask + spin-off/super-cycle guard applied UPSTREAM). The inverted axes (assetGrowthPenalty/
  // netIssuance) negate the raw for BOTH the q-input AND the cross-sectional REL z. gpa floor/elite is the ONLY
  // cohort-specific anchor (asset-intensity + peak-windfall GP differ); marginStability/growth/assetGrowthPenalty/
  // netIssuance SHARED. materials = NEW code keyed by the new cohort strings; existing buckets (medtech/dlst/
  // saas/fabless/industrials/staples/consdisc) are BYTE-IDENTICAL.
  materials_pricingpower: {
    label: 'Materials-Quality v0 (pricingpower: specialty chemicals/gases + building materials/aggregates; absolute-anchor, GP/assets pillar, margin-stability pricing-power proxy, price-windfall-capped deal-masked spin-off-guarded growth, asset-growth+net-issuance discipline, coverage-renorm, COSTCURVE_BLIND)',
    membership: { g: { c: 0.00, s: 0.06 }, gm: { c: 0.09, s: 0.08 }, scaleLog: { c: log10(1000), s: 0.6 } },
    axes: [
      { key: 'gpa',                name: 'GP/Assets',  k: 1.5, w: 0.30 },
      { key: 'marginStability',    name: 'MarginStab', k: 1.5, w: 0.20 },
      { key: 'growth',             name: 'Growth',     k: 2.0, w: 0.18 },
      { key: 'assetGrowthPenalty', name: 'AssetGrowth', k: 1.5, w: 0.18 },
      { key: 'netIssuance',        name: 'NetIssuance', k: 1.5, w: 0.14 },
    ],
    dilCap: 0, dilStart: 0.05, dilRange: 0.20, // net-issuance is a SCORED axis (E); no separate SBC penalty.
    stages: [
      { name: 'S3-Cash-Compounder', test: f => f >= 0.20 },
      { name: 'S2-FCF-positiv',     test: f => f >= 0.08 },
      { name: 'S1-Approaching',     test: f => f >= -0.05 },
      { name: 'S0-Cyclical-Trough', test: () => true },
    ],
    dominantBlock: ['gpa', 'marginStability'],
    degraded: false,
    normTableId: 'materials_pricingpower-norms-2026-06-22',
    materials: true, cohortKey: 'materials_pricingpower',
    a2Note: 'materials_quality v0 pricingpower cohort (Spec formula-design-materials_quality-v0-2026-06-22.md, Court DESIGN-PASS v0; NORMS RECOMPUTED LIVE on the corrected vintage-tolerant US pool 2026-06-22 THEN frozen — the CORE gate). Specialty Chemicals (gases LIN/APD, coatings SHW/PPG/ECL/RPM) + Building Materials (aggregates VMC/MLM, lime USLM, CRH); compounders earn spot≈normalized. SCORE = BUSINESS QUALITY ONLY, never valuation, never a commodity-price bet. 5 SCORED axes via absKaliberMaterials: GP/assets (Novy-Marx through-cycle-ROIC surrogate, the LEAST price-sensitive profitability signal — does NOT spike at a commodity peak the way op/net-margin does; w .30, cohort-specific norm .09/.34), margin stability (inverse-CV pricing-power proxy clip01(1−stdev(opM)/max(|mean(opM)|,.02)) over >=3 annual opMargin points, w .20, identity-clip {0,1}, CONTINUOUS not a gate — the Court killed the hard band<=10pp eligibility gate that false-negated USLM/false-positived LYB), organic growth (w .18 capped BELOW the discipline pillar; deal-masked §4.1 + spin-off/super-cycle re-baselining guard §4.2 UPSTREAM → NOT_READY:growth; 50/50 latest/min-floor blend §3-A — a Materials revenue spike is price not volume; elite .18 reachable only by genuine secular volume growth), asset-growth penalty (Cooper-Gulen-Schill, w .18, q(-assetGrowth) {-.40/0} — kills the serial peak-acquirer levering up to buy reserves at the top), net-share-issuance penalty (Pontiff-Woodgate, w .14, q(-NSI); ~57% coverage — Vintage-A snapshots carry no annualShares → DROP+renorm+ISSUANCE_NOT_READY, the load-bearing coverage-renorm path). ANTI-COMMODITY PILLAR gpa+marginStability+assetGrowthPenalty = 0.68 ≫ growth 0.18 (the QUALITY-ONLY guarantee: a price-windfall revenue/margin spike cannot top-score). COVERAGE-RENORM: any NOT_READY/null axis dropped, survivors renormalize to Σ=1.0 (no fake-neutral impute). score=100*(0.6*absKaliber+0.4*REL), β=0.6, REL per-cohort (n=40≫15). WALLS (always-on lamps): CYCLE_WALL (~4y history, no normalized-10y-ROIC — GP/assets is the through-cycle PROXY), COSTCURVE_BLIND (AISC/C1 cash-cost survival metric untagged in Yahoo → Axis F future BONUS weight 0, NEVER faked), INVENTORY_BLIND (no inventory line), BYPRODUCT_BLIND (by-product credits make C1 a price artifact), BACKLOG_FUTURE (gases take-or-pay backlog absent from snapshots → 0-weight bonus). SI-4 out-of-class (excluded industry / non-US per the §6 country-domicile guard + FOREIGN_NAME + FOREIGN_PRIMARY_RESIDUAL / <$1B) → score=null + excluded[]; SI-5 classifiedCount===scoredCount+excludedCount fail-loud; marquee assert (LIN/APD/VMC/MLM/SHW/ECL/PPG/CRH/RPM/NEM/NUE/FCX/DOW/CF/ALB) fail-loud + GENERATIVE anti-leak + FOREIGN_CONTROL positive-control (RIO/VALE/SCCO/PKX/KGC/WPM/PAAS/SVM/BHP/CX/MT/AEM/JHX/NTR/SSL must NOT classify). Disclosed (Spec §8): the "Specialty Chemicals" GICS string is the contamination vector (LYB/ALB/SQM commodity-ish sit there with SHW/PPG) — handled by the CONTINUOUS marginStability + capped growth (ALB self-floors marginStability ~0.0, LYB ~0.61), NOT a per-name remap (which would break SI-5); the US-primary marquees LIN(Linde plc)/CRH(plc Ireland) are admitted via the name-verified US_PRIMARY_ALLOWLIST (the deterministic resolution of the v0 design\'s only internal tension — its marquee list vs its FOREIGN_NAME/country-set guards). Additive/parity-safe. Constants frozen §6.',
  },
  materials_commodity: {
    label: 'Materials-Quality v0 (commodity: gold/metals & mining/steel/basic chemicals/agri-inputs/aluminum/etc.; deep-cyclical price-takers; absolute-anchor, GP/assets pillar [peak-windfall-floored], margin-stability proxy, price-windfall-capped growth, asset-growth+net-issuance discipline, coverage-renorm, COSTCURVE_BLIND)',
    membership: { g: { c: 0.00, s: 0.06 }, gm: { c: 0.01, s: 0.08 }, scaleLog: { c: log10(1000), s: 0.6 } },
    axes: [
      { key: 'gpa',                name: 'GP/Assets',  k: 1.5, w: 0.30 },
      { key: 'marginStability',    name: 'MarginStab', k: 1.5, w: 0.20 },
      { key: 'growth',             name: 'Growth',     k: 2.0, w: 0.18 },
      { key: 'assetGrowthPenalty', name: 'AssetGrowth', k: 1.5, w: 0.18 },
      { key: 'netIssuance',        name: 'NetIssuance', k: 1.5, w: 0.14 },
    ],
    dilCap: 0, dilStart: 0.05, dilRange: 0.20,
    stages: [
      { name: 'S3-Cash-Compounder', test: f => f >= 0.20 },
      { name: 'S2-FCF-positiv',     test: f => f >= 0.08 },
      { name: 'S1-Approaching',     test: f => f >= -0.05 },
      { name: 'S0-Cyclical-Trough', test: () => true },
    ],
    dominantBlock: ['gpa', 'marginStability'],
    degraded: false,
    normTableId: 'materials_commodity-norms-2026-06-22',
    materials: true, cohortKey: 'materials_commodity',
    a2Note: 'materials_quality v0 commodity cohort (deep-cyclical price-takers: Gold, Other Industrial Metals & Mining, basic Chemicals, Steel, Other Precious Metals & Mining, Agricultural Inputs, Copper, Silver, Aluminum, Lumber & Wood Production, Coking Coal, Paper & Paper Products). Same 5-axis absKaliberMaterials engine + coverage-renorm as materials_pricingpower; cohort-specific gpa (.01/.31 — the PEAK-WINDFALL floor: commodity p90 31.2% nearly EQUALS pricingpower p90 33.6% because gold/mining peak GP/assets bleeds through, so a SHARED anchor would reward a peak miner\'s GP as "quality"; cohort-specific is MANDATORY, the empirical refutation of a single shared anchor); marginStability/growth/assetGrowthPenalty/netIssuance anchors SHARED. n=55≫15 → full ABS+REL blend. The split is NOT a free pass: a peak gold miner scores LOW on its own merits (low marginStability, mediocre cohort-gpa once the heavy PP&E denominator is in, growth = damped price spike). Disclosed (Spec §8-#3): marginStability cannot stand alone (FCX copper-plateau ~0.92) — industry-string cohorting is the PRIMARY guard; FCX is sunk by cohort placement + cohort-gpa + capped growth, not by stability. See materials_pricingpower.a2Note for the full mechanism + walls + asserts. Additive/parity-safe; constants frozen §6.',
  },
  // ===========================================================================
  // energy_quality (CORE) — THREE cohorts by THROUGH-CYCLE QUALITY tier (deterministic GICS-industry split:
  // upstream/midstream/services). Spec formula-design-energy_quality-v0-2026-06-22.md (Council->Court DESIGN-PASS
  // v0, NEEDS-REVISION — NORMS recomputed-live-then-frozen 2026-06-23 on the CLEAN pool; the CORE gate). MIRRORS
  // the materials path: 5 SCORED axes via the PARALLEL engine absKaliberEnergy, BUT the axis SET is DISTINCT —
  // axis B is ROCE (opInc/totalAssets, the through-cycle capital-return PILLAR) and axis C is FCF-MARGIN
  // (annualFCF/annualRev, the discipline arm that survives Vintage A) — neither is the industrials `eff` nor the
  // materials `marginStability`. Weights {roce .30, fcfMargin .22, assetGrowthPenalty .18, gpa .16, netIssuance
  // .14}: the capital-discipline+resilience pillar roce+fcfMargin+assetGrowthPenalty = 0.70 STRUCTURALLY
  // dominates. GROWTH IS NOT A SCORED AXIS — rewarding revenue growth in a commodity-cyclical rewards commodity-β,
  // the exact failure mode the brief forbids; the score is commodity-β-immune BY CONSTRUCTION (asset-scaled
  // profitability + no growth axis), so a price-windfall year CANNOT manufacture a top score (QUALITY-ONLY, no
  // commodity-price bets). REL z/MAD per-cohort (each its own bucket: upstream 32, midstream 26, services 25
  // scored — all n>=15). blend score=100*(0.6*ABS+0.4*REL), β=0.6. RAW inputs from m.en.* (court-screen snapshot
  // extraction; deal-mask + spin-off guard + COMMODITY_BETA_SUSPECT windfall lamp applied UPSTREAM). The inverted
  // axes (assetGrowthPenalty/netIssuance) negate the raw for BOTH the q-input AND the cross-sectional REL z.
  // roce/fcfMargin/gpa floor/elite are cohort-specific (the deep-cyclical tiers differ); assetGrowthPenalty/
  // netIssuance SHARED. energy = NEW code keyed by the new cohort strings; existing buckets (medtech/dlst/saas/
  // fabless/industrials/staples/consdisc/materials) are BYTE-IDENTICAL.
  energy_upstream: {
    label: 'Energy-Quality v0 (upstream: oil & gas E&P + integrated; deep-cyclical price-takers; absolute-anchor, ROCE pillar [opInc/assets, through-cycle], FCF-margin discipline, GP/assets profitability, asset-growth+net-issuance discipline, NO growth axis, coverage-renorm, CYCLE_WALL/RESERVE_BLIND)',
    membership: { g: { c: 0.00, s: 0.06 }, gm: { c: 0.02, s: 0.08 }, scaleLog: { c: log10(1000), s: 0.6 } },
    axes: [
      { key: 'roce',               name: 'ROCE',        k: 1.5, w: 0.30 },
      { key: 'fcfMargin',          name: 'FCF-Margin',  k: 1.5, w: 0.22 },
      { key: 'assetGrowthPenalty', name: 'AssetGrowth', k: 1.5, w: 0.18 },
      { key: 'gpa',                name: 'GP/Assets',   k: 1.5, w: 0.16 },
      { key: 'netIssuance',        name: 'NetIssuance', k: 1.5, w: 0.14 },
    ],
    dilCap: 0, dilStart: 0.05, dilRange: 0.20, // net-issuance is a SCORED axis (E); no separate SBC penalty.
    stages: [
      { name: 'S3-Cash-Compounder', test: f => f >= 0.20 },
      { name: 'S2-FCF-positiv',     test: f => f >= 0.08 },
      { name: 'S1-Approaching',     test: f => f >= -0.05 },
      { name: 'S0-Cyclical-Trough', test: () => true },
    ],
    dominantBlock: ['roce', 'fcfMargin'],
    degraded: false,
    normTableId: 'energy_upstream-norms-2026-06-23',
    energy: true, cohortKey: 'energy_upstream',
    a2Note: 'energy_quality v0 upstream cohort (Spec formula-design-energy_quality-v0-2026-06-22.md, Council->Court DESIGN-PASS v0 NEEDS-REVISION; NORMS RECOMPUTED LIVE on the corrected vintage-tolerant CLEAN pool 2026-06-23 THEN frozen — the design §0 explicitly forbids freezing on the council\'s contaminated 156-name pool). Oil & Gas E&P + Integrated (XOM/CVX/COP/EOG/OXY/DVN/FANG/CTRA/EQT/AR); Integrated folded into E&P (clean Integrated residual n=3 cannot stand alone; XOM/CVX Yahoo-classify as Integrated). SCORE = THROUGH-CYCLE BUSINESS QUALITY ONLY, never valuation, never a commodity-price bet. 5 SCORED axes via absKaliberEnergy: ROCE surrogate opInc/totalAssets (the through-cycle capital-return PILLAR — the LEAST price-sensitive return-on-capital read; w .30, cohort-specific norm .02/.16 = live p10 4.4% / p90 15.5%), FCF-margin annualFCF/annualRev (capital discipline; the FULL-coverage arm that survives Vintage A; w .22, cohort-specific .-03/.30), GP/assets (Novy-Marx profitability; w .16, cohort-specific .06/.25), asset-growth penalty (Cooper-Gulen-Schill THE commodity-β suppressor, w .18, q(-assetGrowth) {-.40/0} — NEVER masked, fires HARDEST on the cycle-top reserve-grab acquirer ballooning the asset base at the peak = the low-quality case), net-share-issuance penalty (Pontiff-Woodgate, w .14, q(-NSI); ~50% coverage — Vintage-A snapshots carry no annualShares → DROP+renorm+ISSUANCE_NOT_READY, the load-bearing coverage-renorm path). CAPITAL-DISCIPLINE PILLAR roce+fcfMargin+assetGrowthPenalty = 0.70 ≫ any single term. GROWTH IS NOT A SCORED AXIS (the QUALITY-ONLY guarantee: rewarding revenue growth in a commodity-cyclical rewards commodity-β, the exact failure mode the brief names; growth surfaces only as the deal-mask trigger + the COMMODITY_BETA_SUSPECT advisory lamp). COVERAGE-RENORM: any NOT_READY/null axis dropped, survivors renormalize to Σ=1.0 (no fake-neutral impute). score=100*(0.6*absKaliber+0.4*REL), β=0.6, REL per-cohort (n=32≫15). WALLS (always-on lamps): CYCLE_WALL/THROUGH_CYCLE_WALL (~4y history, no normalized-10y-ROIC — opInc/assets + GP/assets are the through-cycle PROXY), COMMODITY_BETA (score deliberately excludes price exposure), RESERVE_BLIND (no reserves/RRR/F&D/PV-10/breakeven line in the schema). SI-4 out-of-class (R&M/Coal/Uranium / non-US per the §6 country-domicile guard + FOREIGN_NAME + ENERGY_FOREIGN_DROP / <$1B → never enter court-buckets; pre-revenue exploration/shell with <2 annual-rev OR revLatest<$1M → score=null + excluded[] OUT_OF_SEGMENT:preexploration, the materials lesson) → score=null + excluded[]; SI-5 classifiedCount===scoredCount+excludedCount fail-loud; marquee assert (XOM/CVX/COP/EOG/OXY/DVN/EPD/ET/KMI/WMB/OKE/MPLX/SLB/HAL/BKR) fail-loud + GENERATIVE anti-leak + FOREIGN_CONTROL positive-control (BP/SHEL/TTE/CNQ/CVE/ENB/EQNR/E/IMO/SU/PBR/TRP/YPF/VET/NAT/TK/TNK must NOT classify). Disclosed (Spec §7): single-year ROCE in a deep-cyclical can flatter a top-of-cycle print — mitigated by asset-growth+issuance discipline (a name earning high ROCE only by levering up at the top is hit on D+E) and GP/assets (less cycle-sensitive); the SLB US-primary marquee (Schlumberger Limited, foreign-NAME but NYSE-primary) is admitted via the name-verified US_PRIMARY_ALLOWLIST (the deterministic resolution of the v0 design\'s marquee list vs its own FOREIGN_NAME guard). Additive/parity-safe. Constants frozen §6.',
  },
  energy_midstream: {
    label: 'Energy-Quality v0 (midstream: oil & gas midstream; fee-based toll-road tier; absolute-anchor, ROCE pillar, FCF-margin discipline [wide capital-cycle dispersion], GP/assets profitability, asset-growth+net-issuance discipline, NO growth axis, coverage-renorm, CYCLE_WALL/DCF_COVERAGE_BLIND)',
    membership: { g: { c: 0.00, s: 0.06 }, gm: { c: 0.02, s: 0.08 }, scaleLog: { c: log10(1000), s: 0.6 } },
    axes: [
      { key: 'roce',               name: 'ROCE',        k: 1.5, w: 0.30 },
      { key: 'fcfMargin',          name: 'FCF-Margin',  k: 1.5, w: 0.22 },
      { key: 'assetGrowthPenalty', name: 'AssetGrowth', k: 1.5, w: 0.18 },
      { key: 'gpa',                name: 'GP/Assets',   k: 1.5, w: 0.16 },
      { key: 'netIssuance',        name: 'NetIssuance', k: 1.5, w: 0.14 },
    ],
    dilCap: 0, dilStart: 0.05, dilRange: 0.20,
    stages: [
      { name: 'S3-Cash-Compounder', test: f => f >= 0.20 },
      { name: 'S2-FCF-positiv',     test: f => f >= 0.08 },
      { name: 'S1-Approaching',     test: f => f >= -0.05 },
      { name: 'S0-Cyclical-Trough', test: () => true },
    ],
    dominantBlock: ['roce', 'fcfMargin'],
    degraded: false,
    normTableId: 'energy_midstream-norms-2026-06-23',
    energy: true, cohortKey: 'energy_midstream',
    a2Note: 'energy_quality v0 midstream cohort (fee-based toll-road quality tier: Oil & Gas Midstream — KMI/WMB/OKE/ET/EPD/MPLX/TRGP/LNG/PAA/WES). Same 5-axis absKaliberEnergy engine + coverage-renorm as energy_upstream; cohort-specific roce (.02/.22 — live p10 4.5% / p90 22.1%, higher elite than upstream: the fee-based tier earns higher return-on-assets), fcfMargin (.00/.38 — live p10 2.7% / p90 37.9%, WIDE: capital-cycle dispersion), gpa (.06/.24); assetGrowthPenalty/netIssuance SHARED. n=26 = THIN-but-sufficient REL headroom (β=0.6 holds, MAD-robust, documented Spec §0/§7-4 — NOT pooled with the other cohorts). WALL DCF_COVERAGE_BLIND (distribution-coverage uncomputable from the schema) replaces upstream RESERVE_BLIND. The SBR/PBT royalty-trust ROCE 954%/761% tail outliers (near-zero asset base pass-throughs) do NOT move the p90-anchored elite — percentile NORMS are MAD-robust by construction. See energy_upstream.a2Note for the full axis/SI/wall mechanism + the QUALITY-ONLY (no growth axis) guarantee + marquee/foreign-control asserts. Additive/parity-safe; constants frozen §6.',
  },
  energy_services: {
    label: 'Energy-Quality v0 (services: oil & gas equipment & services + drilling; leveraged-driller tier; absolute-anchor, ROCE pillar, FCF-margin discipline, GP/assets profitability, asset-growth+net-issuance discipline, NO growth axis, coverage-renorm, CYCLE_WALL)',
    membership: { g: { c: 0.00, s: 0.06 }, gm: { c: 0.02, s: 0.08 }, scaleLog: { c: log10(1000), s: 0.6 } },
    axes: [
      { key: 'roce',               name: 'ROCE',        k: 1.5, w: 0.30 },
      { key: 'fcfMargin',          name: 'FCF-Margin',  k: 1.5, w: 0.22 },
      { key: 'assetGrowthPenalty', name: 'AssetGrowth', k: 1.5, w: 0.18 },
      { key: 'gpa',                name: 'GP/Assets',   k: 1.5, w: 0.16 },
      { key: 'netIssuance',        name: 'NetIssuance', k: 1.5, w: 0.14 },
    ],
    dilCap: 0, dilStart: 0.05, dilRange: 0.20,
    stages: [
      { name: 'S3-Cash-Compounder', test: f => f >= 0.20 },
      { name: 'S2-FCF-positiv',     test: f => f >= 0.08 },
      { name: 'S1-Approaching',     test: f => f >= -0.05 },
      { name: 'S0-Cyclical-Trough', test: () => true },
    ],
    dominantBlock: ['roce', 'fcfMargin'],
    degraded: false,
    normTableId: 'energy_services-norms-2026-06-23',
    energy: true, cohortKey: 'energy_services',
    a2Note: 'energy_quality v0 services cohort (Oil & Gas Equipment & Services + Drilling — SLB/BKR/HAL/RIG/NBR/VAL/NOV/HP; Drilling folded into E&S, n=7, the leveraged-driller signal the cohort exposes, cannot stand alone). Same 5-axis absKaliberEnergy engine + coverage-renorm as energy_upstream; cohort-specific roce (.00/.13 — live p10 0.1% / p90 12.3%, the LOWEST-ROCE tier: capital-intensive leveraged drillers), fcfMargin (-.02/.24), gpa (.06/.21); assetGrowthPenalty/netIssuance SHARED. n=27 classified / 25 scored (NEXT/SOC pre-revenue SI-4-excluded). The SLB US-primary marquee (Schlumberger Limited — foreign-NAME \\bLimited\\b but NYSE-primary) is admitted via the name-verified US_PRIMARY_ALLOWLIST. See energy_upstream.a2Note for the full mechanism + the QUALITY-ONLY (no growth axis) guarantee + the pre-revenue SI-4 exclusion (the materials lesson) + marquee/foreign-control asserts. Additive/parity-safe; constants frozen §6.',
  },
  // ===========================================================================
  // pharma_commercial (CORE) — THREE cohorts by COMMERCIAL-STAGE QUALITY tier (deterministic GICS-industry split:
  // branded/biopharma/specialty). Spec formula-design-pharma_court-v0-2026-06-22.md (Council->Court DESIGN-PASS v0,
  // NEEDS-REVISION — NORMS recomputed-live-then-frozen 2026-06-23 on the CLEAN commercial pool; the CORE gate).
  // 3 SCORED axes {growth, gm, eff} via the NEW engine absKaliberPharma (coverage-renorm; the medtech/dlst 3-axis
  // absKaliber() path is BYTE-UNTOUCHED). Weights {growth .45, gm .20, eff .35}: growth LEADS (the cliff-aware
  // organic read separates LLY/NBIX/HALO from the patent-cliff field PFE/BMY/VTRS), gm low (.20) so the
  // categorically-different cohort GM structures don't dominate, eff (.35) FCF-primary (R&D fully-expensed distorts
  // OpM; branded structurally FCF-rich). branded n=10<15 -> THIN_REL (ABS-only, beta=1.0); biopharma 22 / specialty
  // 14 full ABS+REL blend. RAW inputs from m.ph.* (court-screen buildPharmaAxes; deal-mask + winsorize + spin-off
  // guard applied UPSTREAM). growth/gm/eff floor/elite cohort-specific. M&A: LOCAL totalAssets-jump deal-mask only
  // (the design's intangible/IPR&D re-pointing needs the ABSENT external companyfacts join → intangible-amortization-
  // drag/ipr&d lamps OMITTED, disclosed MA_INTANGIBLE_BLIND). pharma = NEW code keyed by the new cohort strings;
  // existing buckets (medtech/dlst/saas/fabless/industrials/staples/consdisc/materials/energy) are BYTE-IDENTICAL.
  pharma_branded: {
    label: 'Pharma-Commercial v0 (branded: drug manufacturers - general; mature mega-cap, cliff-exposed; absolute-anchor, cliff-aware organic growth, gross-margin pricing-power, FCF-efficiency, THIN_REL ABS-only, PATENT_CLIFF_WALL/MA_INTANGIBLE_BLIND)',
    membership: { g: { c: 0.00, s: 0.06 }, gm: { c: 0.50, s: 0.10 }, scaleLog: { c: log10(1000), s: 0.6 } },
    axes: [
      { key: 'growth', name: 'Growth',   k: 2.0, w: 0.45 },
      { key: 'gm',     name: 'GM-Level', k: 1.5, w: 0.20 },
      { key: 'eff',    name: 'Eff-FCF',  k: 1.5, w: 0.35 },
    ],
    dilCap: 0, dilStart: 0.05, dilRange: 0.20, // net-issuance not a scored axis (Vintage-A lacks annualShares); no SBC penalty
    stages: [
      { name: 'S3-Cash-Compounder', test: f => f >= 0.20 },
      { name: 'S2-FCF-positiv',     test: f => f >= 0.08 },
      { name: 'S1-Approaching',     test: f => f >= -0.05 },
      { name: 'S0-Cliff-Exposed',   test: () => true },
    ],
    dominantBlock: ['growth', 'eff'],
    degraded: false,
    normTableId: 'pharma_branded-norms-2026-06-23',
    pharma: true, cohortKey: 'pharma_branded',
    a2Note: 'pharma_commercial v0 branded cohort (Spec formula-design-pharma_court-v0-2026-06-22.md, Council->Court DESIGN-PASS v0 NEEDS-REVISION; NORMS RECOMPUTED LIVE on the CLEAN post-commercial-gate vintage-tolerant US pool 2026-06-23 THEN frozen — the CORE gate). Drug Manufacturers - General (ABBV/AMGN/BIIB/BMY/GILD/JNJ/LLY/MRK/OGN/PFE); mature mega-cap, 66-79% GM, FCF-generative, serial-acquirer, patent-cliff-exposed. SCORE = COMMERCIAL-STAGE BUSINESS QUALITY ONLY, never valuation. 3 SCORED axes via absKaliberPharma: organic growth (cliff-aware blend min(latest clean YoY, .6*latest+.4*median), deal-masked §4.1 + spin-off guard + winsorize cap 1.0 UPSTREAM → NOT_READY:growth on a fully-masked acquirer; w .45, cohort-specific norm .00/.12, FLOOR 0.00 not 0.15 — a 0.15 gate would wrongly reject AMGN 10%/GILD 2%/MRK 1% legit compounders, branded is mature + cliff-exposed; latest UNCAPPED-below so a genuine decline scores low = correct cliff read), gross margin annualGP/annualRev (pricing-power; w .20 LOW so the margin split doesn\'t dominate; cohort-specific .66/.79), efficiency FCF-margin primary OpM-fallback (R&D fully-expensed distorts OpM, branded structurally FCF-rich; w .35, cohort-specific .10/.33). COVERAGE-RENORM: any NOT_READY/null axis (fully-deal-masked growth, no-GP royalty gm) dropped, survivors renormalize to Σ=1.0 (no fake-neutral impute). THIN_REL: n=10<15 → ABS-only (beta=1.0), REL suppressed (re-pooling branded+biopharma REJECTED — merges incompatible 73% vs 84% median-GM structures; ABS-only on a clean 10 is honest + SI-correct). score=100*(1.0*absKaliber) for branded (ABS-only). WALLS (always-on lamps): PATENT_CLIFF_WALL (LOE-concentration — which % rev loses exclusivity in 3-5y, MRK/Keytruda 2028, ABBV/Humira — NOT derivable from companyfacts; honest organic scoring + REVENUE_DECLINE lamp as forward proxy), MA_INTANGIBLE_BLIND (the design re-points M&A onto intangibles/IPR&D, but the LOCAL snapshot annualBalance carries only {totalCash,totalDebt,totalAssets} and data/ma-rpo-snapshot-pharma.json is ABSENT — pulling the network EDGAR join is forbidden — so M&A decontamination uses the LOCAL totalAssets-jump deal-mask only; the intangible-amortization-drag/ipr&d-acquirer lamps are SHIPPED OMITTED, disclosed coverage limitation), THIN_REL. SI-4 out-of-class (non-pharma HC industry / non-US per the §1.2 country-domicile guard + FOREIGN_NAME + PHARMA_FOREIGN_DROP / <$1B / pre-commercial-clinical per the §1.4 commercial gate → never enter court-buckets; pre-revenue shell with <2 annual-rev OR revLatest<$1M → score=null + excluded[] OUT_OF_SEGMENT:preexploration, the materials lesson) → score=null + excluded[]; SI-5 classifiedCount===scoredCount+excludedCount fail-loud; marquee assert (LLY/MRK/PFE/ABBV/BMY/AMGN/GILD/JNJ/VRTX/REGN/BIIB/INCY/JAZZ/EXEL/NBIX/VTRS) fail-loud + GENERATIVE anti-leak + FOREIGN_CONTROL positive-control (AZN/NVS/NVO/SNY/TAK/BNTX/ARGX/GMAB/ALKS/GSK/RHHBY/BHC must NOT classify). Disclosed (Spec §8): pre-revenue/clinical-stage biotech (MRNA/BBIO/INSM/RARE/SRPT/IONS) EXCLUDED by the §1.4 profitability commercial gate (sign-separated, future special-track); foreign primaries (AZN/NVS/NVO/SNY/TAK/BNTX/ARGX/GMAB) EXCLUDED; net-share-issuance NOT a scored axis (Vintage-A lacks annualShares → DILUTION_HIGH advisory only); the JAZZ US-primary marquee (Jazz Pharmaceuticals plc, foreign-NAME but NasdaqGS-primary) admitted via the name-verified US_PRIMARY_ALLOWLIST. Additive/parity-safe. Constants frozen.',
  },
  pharma_biopharma: {
    label: 'Pharma-Commercial v0 (biopharma: biotechnology + commercial gate; single/dual-franchise biologics, higher growth, organic; absolute-anchor, cliff-aware organic growth, gross-margin, FCF-efficiency, PATENT_CLIFF_WALL/MA_INTANGIBLE_BLIND)',
    membership: { g: { c: 0.05, s: 0.06 }, gm: { c: 0.64, s: 0.10 }, scaleLog: { c: log10(1000), s: 0.6 } },
    axes: [
      { key: 'growth', name: 'Growth',   k: 2.0, w: 0.45 },
      { key: 'gm',     name: 'GM-Level', k: 1.5, w: 0.20 },
      { key: 'eff',    name: 'Eff-FCF',  k: 1.5, w: 0.35 },
    ],
    dilCap: 0, dilStart: 0.05, dilRange: 0.20,
    stages: [
      { name: 'S3-Cash-Compounder', test: f => f >= 0.20 },
      { name: 'S2-FCF-positiv',     test: f => f >= 0.08 },
      { name: 'S1-Approaching',     test: f => f >= -0.05 },
      { name: 'S0-Pre-FCF',         test: () => true },
    ],
    dominantBlock: ['growth', 'eff'],
    degraded: false,
    normTableId: 'pharma_biopharma-norms-2026-06-23',
    pharma: true, cohortKey: 'pharma_biopharma',
    a2Note: 'pharma_commercial v0 biopharma cohort (Biotechnology ∧ §1.4 commercial gate: VRTX/REGN/INCY/EXEL/ALNY/HALO/HRMY/CPRX/BMRN/JAZZ/RPRX/PTCT/TGTX +…). Single/dual-franchise biologics, 64-96% GM, higher growth, more organic. Same 3-axis absKaliberPharma engine + coverage-renorm as pharma_branded; cohort-specific growth (.05/.30 — floor 0.05; live p90 68.9% launch-spike-inflated → elite capped .30), gm (.64/.96 — wide, commercial-biotech tiers; REL discriminates), eff (.05/.42). n=22 → full ABS+REL blend (β=0.6), NO thin-n regime. The no-GP royalty names (RPRX/ARWR annualGP=[null,null]) DROP the gm axis via coverage-renorm (score on growth+eff). See pharma_branded.a2Note for the full axis/SI/wall mechanism (PATENT_CLIFF_WALL/MA_INTANGIBLE_BLIND, the LOCAL-data M&A deal-mask + omitted intangible lamps, the §1.4 commercial gate deferring cash-burning clinical names, the pre-revenue SI-4 floor) + marquee/foreign-control asserts. Additive/parity-safe; constants frozen.',
  },
  pharma_specialty: {
    label: 'Pharma-Commercial v0 (specialty: drug manufacturers - specialty & generic + commercial gate; generic<->specialty-branded, wide GM band; absolute-anchor, cliff-aware organic growth, gross-margin, FCF-efficiency, PATENT_CLIFF_WALL/MA_INTANGIBLE_BLIND)',
    membership: { g: { c: 0.00, s: 0.06 }, gm: { c: 0.36, s: 0.12 }, scaleLog: { c: log10(1000), s: 0.6 } },
    axes: [
      { key: 'growth', name: 'Growth',   k: 2.0, w: 0.45 },
      { key: 'gm',     name: 'GM-Level', k: 1.5, w: 0.20 },
      { key: 'eff',    name: 'Eff-FCF',  k: 1.5, w: 0.35 },
    ],
    dilCap: 0, dilStart: 0.05, dilRange: 0.20,
    stages: [
      { name: 'S3-Cash-Compounder', test: f => f >= 0.20 },
      { name: 'S2-FCF-positiv',     test: f => f >= 0.08 },
      { name: 'S1-Approaching',     test: f => f >= -0.05 },
      { name: 'S0-Generic-Margin',  test: () => true },
    ],
    dominantBlock: ['growth', 'eff'],
    degraded: false,
    normTableId: 'pharma_specialty-norms-2026-06-23',
    pharma: true, cohortKey: 'pharma_specialty',
    a2Note: 'pharma_commercial v0 specialty cohort (Drug Manufacturers - Specialty & Generic ∧ §1.4 commercial gate: NBIX/UTHR/ZTS/ELAN/SUPN/VTRS/AMRX/PAHC/PBH/ANIP/INDV/LNTH/BCRX/HIMS). Heterogeneous generic<->specialty-branded, GM 35-95% (VTRS 35% generic <-> NBIX/UTHR 88-98% specialty — the WIDE GM band is REAL, so gm must be per-cohort REL, never a hard gate; elite .92). Same 3-axis absKaliberPharma engine + coverage-renorm as pharma_branded; cohort-specific growth (.00/.12 — floor 0.00 mature generics, p90 inflated → elite capped .12), gm (.36/.92 — the WIDE band INTENTIONAL), eff (.05/.34). n=14 → thin-but-sufficient, full ABS+REL blend (mirrors energy_midstream n=26 documented headroom; 14 is bordering, β=0.6 holds MAD-robust). See pharma_branded.a2Note for the full mechanism + the QUALITY-ONLY guarantee + marquee/foreign-control asserts. Additive/parity-safe; constants frozen.',
  },
  // ===========================================================================
  // it_services (CORE) — ONE de-contaminated people-leverage / low-capital-compounding quality cohort (Special-Track
  // B). Spec formula-design-special_tracks-v0-2026-06-22.md PART B (Council->Court DESIGN-PASS v0; NORMS recomputed-
  // live-then-frozen 2026-06-23 on the CLEAN de-contaminated pool; the CORE gate). 5 SCORED axes {gpa, fcfMargin,
  // opMargin, growth, netIssuance} via the NEW engine absKaliberItServices (coverage-renorm; the 12 existing CORE
  // buckets are BYTE-UNTOUCHED). Weights {gpa .34, fcfMargin .24, opMargin .18, growth .14, netIssuance .10}: the
  // capital-discipline+profitability pillar gpa+fcfMargin+netIssuance = .68 ≫ growth .14 (a low-capital compounder,
  // not a growth chase). RAW inputs from m.it.* (court-screen buildItServicesAxes; deal-mask + spin-off guard applied
  // UPSTREAM). n=22 de-contaminated → full ABS+REL blend (β=0.6). it_services = NEW code keyed by the new cohort
  // string; existing buckets (medtech/dlst/saas/fabless/industrials/staples/consdisc/materials/energy/pharma) are
  // BYTE-IDENTICAL.
  it_services: {
    label: 'IT-Services v0 (people-leverage / low-capital-compounding: Information Technology Services; asset-light consulting/SI/BPO compounders; absolute-anchor, GP/assets asset-light proxy, FCF cash-conversion, op-margin pricing-power, organic growth, net-issuance discipline; PEOPLE_LEVERAGE_BLIND/CYCLE_WALL/BACKLOG_FUTURE)',
    membership: { g: { c: 0.00, s: 0.06 }, gm: { c: 0.05, s: 0.10 }, scaleLog: { c: log10(1000), s: 0.6 } },
    axes: [
      { key: 'gpa',         name: 'GP/Assets',   k: 1.5, w: 0.34 },
      { key: 'fcfMargin',   name: 'FCF-Margin',  k: 1.5, w: 0.24 },
      { key: 'opMargin',    name: 'OpMargin',    k: 1.5, w: 0.18 },
      { key: 'growth',      name: 'Growth',      k: 2.0, w: 0.14 },
      { key: 'netIssuance', name: 'NetIssuance', k: 1.5, w: 0.10 },
    ],
    dilCap: 0, dilStart: 0.05, dilRange: 0.20, // net-issuance is a SCORED axis (T5); no separate SBC penalty.
    stages: [
      { name: 'S3-Cash-Compounder', test: f => f >= 0.20 },
      { name: 'S2-FCF-positiv',     test: f => f >= 0.08 },
      { name: 'S1-Approaching',     test: f => f >= -0.05 },
      { name: 'S0-Low-Margin',      test: () => true },
    ],
    dominantBlock: ['gpa', 'fcfMargin'],
    degraded: false,
    normTableId: 'it-services-norms-2026-06-23',
    itservices: true, cohortKey: 'it_services',
    a2Note: 'it_services v0 (Spec formula-design-special_tracks-v0-2026-06-22.md PART B, Council->Court DESIGN-PASS v0; NORMS RECOMPUTED LIVE on the CLEAN de-contaminated vintage-tolerant US pool 2026-06-23 THEN frozen — the CORE gate). ONE de-contaminated people-leverage / low-capital-compounding cohort: Information Technology Services (the exact Yahoo industry string) ∧ Technology ∧ US (country-domicile guard + US_PRIMARY_ALLOWLIST {ACN,G,INFY,GLOB}) ∧ >=$1B ∧ NOT contamination-gated. Live: raw 38 US >=$1B; net 22 after the §B.1 contamination gate excludes the 8 economic-gate contaminants (CIFR/APLD/BBAI/KEEL/SHAZ/CHRN crypto-miners/AI-shells opMargin<0; CDW/INGM hardware distributors RPE>$700k) + the colo fallback (VNET) + the foreign primaries (GIB/GDS/MGRT). SCORE = LOW-CAPITAL-COMPOUNDING BUSINESS QUALITY. 5 SCORED axes via absKaliberItServices: GP/assets (Novy-Marx STRONG — THE asset-light low-capital-compounding proxy, the LEAD axis, w .34, norm .05/.45 = live p10 16.2% / p90 46.1%; floor .05 honors the goodwill-heavy roll-up CACI gpa 8.8% — floored honestly via the linear q, no special case), FCF-margin annualFCF/annualRev (cash conversion = the people-leverage payoff, Mohanram; w .24, .00/.18), operating margin annualOpInc/annualRev (pricing power vs wage inflation; w .18, .02/.18 — level NOT a hard gate, the India-offshore-vs-Western GM inversion means level mis-ranks), organic growth (deal-masked §B.5 + spin-off guarded UPSTREAM, 0.60*latest+0.40*min blend; w .14, .00/.15 — IT-services mid-single-digit through-cycle, capped BELOW the discipline pillar so a roll-up growth spike cannot top-score), net-share-issuance penalty (Pontiff-Woodgate STRONG, w .10, q(-NSI) {-.10/.03}, buyback=elite = the compounder signature; ~50% coverage — Vintage-A lacks annualShares → DROP+renorm+ISSUANCE_NOT_READY). CAPITAL-DISCIPLINE+PROFITABILITY PILLAR gpa+fcfMargin+netIssuance = .68 ≫ growth .14. COVERAGE-RENORM: any NOT_READY/null axis dropped, survivors renormalize to Σ=1.0 (no fake-neutral impute). score=100*(0.6*absKaliber+0.4*REL), β=0.6, REL per-cohort (n=22≫15). THE KEY DESIGN MOVE (§B.2): revenue-per-employee is NOT a scored axis (weight 0.00) — raw RPE is INVERTED on the live cohort (sorting RPE-descending puts the capital-intensive contaminants CIFR/INGM/CDW at the TOP and the genuine elite ACN/EPAM/GLOB/CTSH at the BOTTOM), so RPE is used ONLY as the classifier contamination gate (RPE>$700k) + an advisory RPE_ADVISORY flag. WALLS (always-on lamps): PEOPLE_LEVERAGE_BLIND (the FEASIBILITY DISCLOSURE — mirrors medtech MA_INTANGIBLE_BLIND: the 3 best direct people-leverage signals book-to-bill/utilization/attrition carry NO us-gaap tag and are ABSENT; headcount IS present locally but only ~55% coverage and raw RPE is INVERTED + therefore NOT scored — so NO axis directly measures people-leverage; the score leans on people-leverage-VIA-asset-efficiency gpa), BACKLOG_FUTURE/UTILIZATION_FUTURE/ATTRITION_FUTURE (0-weight future BONUS, verified absent), CYCLE_WALL (~4y history), INVENTORY_BLIND, PEOPLE_DATA_PARTIAL (headcount ~55% coverage). SI-4 out-of-class (non-IT-services tech industry / non-US per the country-domicile guard + FOREIGN hardening / <$1B / contamination-gated → never enter court-buckets; pre-revenue shell with <2 annual-rev OR revLatest<$1M → score=null + excluded[] OUT_OF_SEGMENT:preexploration, the materials lesson) → score=null + excluded[]; SI-5 classifiedCount===scoredCount+excludedCount fail-loud; marquee assert (ACN/CTSH/EPAM/CACI/INFY/G/EXLS/IBM/GLOB/CNXC/DXC/BR/FIS/JKHY/IT/INOD) fail-loud + GENERATIVE anti-leak + CONTAM/FOREIGN positive-control (CIFR/APLD/BBAI/KEEL/SHAZ/CHRN/CDW/INGM/VNET/GIB/GDS/MGRT must NOT classify). FEASIBILITY VERDICT: headcount IS present locally → the design itself (§B.2 RPE INVERTED) prescribes the low-capital-compounding axes as the scored signal with RPE as gate+flag only; the people-leverage omission is disclosed via the always-on PEOPLE_LEVERAGE_BLIND lamp. The ACN/G/GLOB US-primary foreign-domiciled marquees (Accenture plc Ireland / Genpact Ltd Bermuda / Globant S.A. Luxembourg, all NYSE-primary) + INFY (Infosys Ltd Vintage-A) are admitted via the name-verified US_PRIMARY_ALLOWLIST. Additive/parity-safe. Constants frozen §B.4.',
  },
  // tech_hardware_quality (CORE court bucket) — ONE durable hardware-FRANCHISE quality cohort (the ONE remaining
  // quality-compounder gap, council/court triage 2026-06-24; NORMS RECOMPUTED LIVE on the FINAL de-ADR'd + deduped +
  // de-shelled US pool 2026-06-24, n=71 scored, THEN frozen — the CORE gate). 5 SCORED axes {gpa, fcfMargin, opMargin,
  // growth, netIssuance} — the SAME axis set + the SAME engine as it_services → REUSES absKaliberItServices (the 22
  // existing CORE/court buckets are BYTE-UNTOUCHED). Weights {gpa .34, fcfMargin .24, opMargin .18, growth .14,
  // netIssuance .10}: the profitability+discipline pillar gpa+fcfMargin+netIssuance = .68 ≫ growth .14 (a durable
  // franchise, not a cyclical growth chase). RAW inputs from m.thw.* (court-screen buildTechHwAxes; deal-mask + spin-off
  // guard applied UPSTREAM). n=71 → full ABS+REL blend (β=0.6). tech_hardware_quality = NEW code keyed by the new cohort
  // string; all existing buckets BYTE-IDENTICAL. NO contamination gate — the absolute floor sinks the commodity
  // contract-mfg (FLEX/JBL/BHE/SANM/PLXS) off-headline and the SI-4 SHELL gate excludes the revenue-less shells.
  tech_hardware_quality: {
    label: 'Tech-Hardware-Quality v0 (durable hardware franchises: Semi Equipment & Materials / Electronic Components / Communication Equipment / Scientific & Technical Instruments; the bimodal HARDWARE peer group re-ranked by an absolute-anchor so margin-stable franchises beat commodity contract-mfg + loss-making cyclicals; GP/assets asset-efficiency, FCF cash-conversion, op-margin pricing-power, organic growth, net-issuance discipline; CYCLE_WALL/INVENTORY_BLIND/BACKLOG_FUTURE/BOOK_TO_BILL_BLIND)',
    membership: { g: { c: 0.00, s: 0.06 }, gm: { c: 0.10, s: 0.10 }, scaleLog: { c: log10(1000), s: 0.6 } },
    axes: [
      { key: 'gpa',         name: 'GP/Assets',   k: 1.5, w: 0.34 },
      { key: 'fcfMargin',   name: 'FCF-Margin',  k: 1.5, w: 0.24 },
      { key: 'opMargin',    name: 'OpMargin',    k: 1.5, w: 0.18 },
      { key: 'growth',      name: 'Growth',      k: 2.0, w: 0.14 },
      { key: 'netIssuance', name: 'NetIssuance', k: 1.5, w: 0.10 },
    ],
    dilCap: 0, dilStart: 0.05, dilRange: 0.20, // net-issuance is a SCORED axis (H5); no separate SBC penalty.
    stages: [
      { name: 'S3-Cash-Compounder', test: f => f >= 0.20 },
      { name: 'S2-FCF-positiv',     test: f => f >= 0.08 },
      { name: 'S1-Approaching',     test: f => f >= -0.05 },
      { name: 'S0-Low-Margin',      test: () => true },
    ],
    dominantBlock: ['gpa', 'fcfMargin'],
    degraded: false,
    normTableId: 'tech-hardware-norms-2026-06-24',
    techhw: true, cohortKey: 'tech_hardware_quality',
    a2Note: 'tech_hardware_quality v0 (council/court triage 2026-06-24 — the ONE genuine remaining quality-compounder gap; NORMS RECOMPUTED LIVE on the FINAL de-ADRd + deduped + de-shelled vintage-tolerant US pool 2026-06-24 THEN frozen — the CORE gate). ONE durable hardware-FRANCHISE cohort: meta.sector=="Technology" AND meta.industry in {Semiconductor Equipment & Materials, Electronic Components, Communication Equipment, Scientific & Technical Instruments} AND US (country-domicile guard + US_PRIMARY_ALLOWLIST {GRMN}) AND >=$1B (deduped). DELIBERATELY OUT: Computer Hardware / Consumer Electronics / Electronics & Computer Distribution / Solar (OEM-commodity / deep-loss / policy-cyclical; ANET is Computer-Hardware-classified and NOT forced in). Live: raw 96 sector+industry; net 72 classified after the de-ADR country guard removes the foreign primaries (ASML/CLS/ERIC/NOK/FN/CAMT/ITRN/GILT/DQ + ST/TEL/ICHR/NVMI plc/Ltd undefined-country) + the economic-fp dedupe drops BELFA/BELFB; 71 scored after the SI-4 SHELL gate. THE THESIS: the generic HARDWARE peer group is BIMODAL — durable margin-stable franchises (APH/KEYS/GRMN/MSI/TDY/CGNX/FTV/BMI/AMAT, gpa .24-.46, opMargin 16-41%) are lumped with commodity contract-manufacturers (FLEX/JBL/BHE/SANM/PLXS, opMargin 4-9%, gpa .12-.14) AND loss-making cyclicals/quantum (ASTS/ONDS/OUST/AAOI). The absolute-anchor on {gpa, fcfMargin, opMargin, growth, netIssuance} cleanly RE-RANKS franchises above the commodity/loss tail with NO per-name contamination gate — the commodity contract-mfg clip the gpa/fcfMargin/opMargin q-axes near 0 and sink BELOW the absolute floor -> off the headlineShortlist (verified live: FLEX rank 54/71 absK .18, BHE 55, JBL 61, SANM 63, PLXS 65, all .10-.18; the franchises rank top-17), exactly like materials/energy. SCORE = DURABLE FRANCHISE BUSINESS QUALITY (never bets on the semi/comms cycle). 5 SCORED axes via absKaliberItServices (REUSED — the tech_hardware axis set is byte-identical to it_services): GP/assets (Novy-Marx STRONG — THE franchise vs commodity-contract-mfg separator, the LEAD axis, w .34, norm .10/.40 = live p10 10.9% / p90 38.0%), FCF-margin annualFCF/annualRev (cash conversion = the franchise payoff, Mohanram; w .24, .00/.24 — loss tail floored honestly at 0), operating margin annualOpInc/annualRev (pricing power vs the cycle; w .18, .02/.25 — level NOT a hard gate), organic growth (deal-masked + spin-off guarded UPSTREAM, 0.60*latest+0.40*min blend; w .14, .00/.15 — hardware mid-cycle flat-to-low, capped BELOW the discipline pillar so a semi up-cycle spike cannot top-score a cyclical), net-share-issuance penalty (Pontiff-Woodgate STRONG, w .10, q(-NSI) {-.10/.03}, buyback=elite = the compounder signature; ~48% coverage — Vintage-A lacks annualShares -> DROP+renorm+ISSUANCE_NOT_READY). PROFITABILITY+DISCIPLINE PILLAR gpa+fcfMargin+netIssuance = .68 >> growth .14; the opMargin+fcfMargin margin pillar .42 is the bimodality separator. WEIGHT JUSTIFICATION: gpa LEADS because GP/assets most cleanly separates a margin-stable franchise from a capital-heavy contract-manufacturer turning a thin spread on a big asset base; the margin pillar is the bimodality cut; growth is SECONDARY (capped .14) so a semiconductor up-cycle revenue spike must NOT top-score a cyclical over a steady franchise. COVERAGE-RENORM: any NOT_READY/null axis dropped, survivors renormalize to Sum=1.0 (no fake-neutral impute). score=100*(0.6*absKaliber+0.4*REL), beta=0.6, REL per-cohort (n=71>>15). WALLS (always-on lamps): CYCLE_WALL, INVENTORY_BLIND, BACKLOG_FUTURE (0-weight future BONUS), BOOK_TO_BILL_BLIND. SI-4 SHELL gate (no positive revenue in ANY year OR no totalAssets in ANY year -> score=null + excluded[] OUT_OF_SEGMENT:shell, the materials/energy lesson); the absolute-floor demotes the commodity/loss tail off the headlineShortlist (NOT a score-kill). SI-5 classifiedCount===scoredCount+excludedCount fail-loud; marquee assert (APH/KEYS/GRMN/MSI/TDY/CGNX/AMAT/BMI/FTV must each classify+survive to a sane rank) fail-loud + GENERATIVE anti-leak + FOREIGN positive-control (ASML/CLS/ERIC/FN/CAMT/ITRN/GILT/DQ/ST/TEL/ICHR/NVMI must NOT classify) + country-undef-US retention (MSI/KEYS/TDY must classify). The GRMN (Garmin Ltd Switzerland NYSE-primary) marquee is admitted via the name-verified US_PRIMARY_ALLOWLIST; the anti-leak assert exempts it. Additive/parity-safe.',
  },
  // financials_banks (CORE court bucket) — ONE deposit-funded US-bank cohort by THROUGH-CYCLE QUALITY. Court gauntlet
  // DESIGN (BUILD_WITH_CAVEATS / court REVISE, 2026-06-23; NORMS RECOMPUTED LIVE on the FINAL de-ADR'd + deduped US
  // pool 2026-06-23, n=128, THEN frozen — the CORE gate). 4 SCORED axes {roaThruCycle, capitalAdequacy,
  // assetGrowthDiscipline, earningsDurability} via the NEW engine absKaliberBanks (coverage-renorm; the 20 existing
  // CORE/court buckets are BYTE-UNTOUCHED). Weights {roaThruCycle .50, capitalAdequacy .25, assetGrowthDiscipline .18,
  // earningsDurability .07}: roaThruCycle .50 dominates; the blind-walled young earningsDurability .07 is a small
  // tiebreaker. RAW inputs from m.bk.* (court-screen buildBankAxes; FCF/OCF/GP/OpInc NEVER read for banks). financials_
  // banks = NEW code keyed by the new cohort string; all existing buckets BYTE-IDENTICAL.
  financials_banks: {
    label: 'Financials-Banks v0 (deposit-funded US banks; through-cycle quality: 4y-avg ROA, capital adequacy, asset-growth DISCIPLINE penalty, earnings durability; absolute-anchor; CREDIT_QUALITY_BLIND/NIM_BLIND/CET1_BLIND/EFFICIENCY_RATIO_BLIND/DEPOSIT_FRANCHISE_BLIND)',
    // REL cross-sectional z/MAD axes mirror the ABS axes (sign-aligned: assetGrowthDisc reads the NEGATED assetGrowthYoY
    // upstream so higher=better, same as the ABS penalty). Weights mirror the absKaliberBanks weights.
    // membership = roaThruCycle(quality) × scale (QUALITY-ONLY, mirrors materials/energy): gm.c = roaThruCycle.floor
    // (0.007, the quality center), gm.s = 0.006 (a ~floor-to-elite-spread scale so a floor-ROA bank reads ~0.5 and an
    // elite ~1.64% reads In); g is UNUSED (no growth/FCF membership gate for banks); scaleLog center = log10($1B).
    membership: { g: { c: 0.00, s: 0.06 }, gm: { c: 0.0070, s: 0.0060 }, scaleLog: { c: log10(1000), s: 0.6 } },
    axes: [
      { key: 'roaThruCycle',          name: 'ROA-ThruCycle',     k: 1.5, w: 0.50 },
      { key: 'capitalAdequacy',       name: 'CapitalAdequacy',   k: 1.5, w: 0.25 },
      { key: 'assetGrowthDisc',       name: 'AssetGrowthDisc',   k: 1.5, w: 0.18 },
      { key: 'earningsDurability',    name: 'EarningsDurability', k: 1.5, w: 0.07 },
    ],
    dilCap: 0, dilStart: 0.05, dilRange: 0.20, // no separate share-issuance penalty axis for banks (not a scored dimension here).
    stages: [
      { name: 'S3-Elite-ROA',   test: f => f >= 0.0150 },
      { name: 'S2-Strong-ROA',  test: f => f >= 0.0110 },
      { name: 'S1-Adequate',    test: f => f >= 0.0070 },
      { name: 'S0-Sub-Floor',   test: () => true },
    ],
    dominantBlock: ['roaThruCycle', 'capitalAdequacy'],
    degraded: false,
    normTableId: 'banks-norms-2026-06-23',
    banks: true, cohortKey: 'financials_banks',
    a2Note: 'financials_banks v0 (court gauntlet DESIGN, BUILD_WITH_CAVEATS / court REVISE 2026-06-23; NORMS RECOMPUTED LIVE on the FINAL de-ADRd + deduped US pool 2026-06-23 THEN frozen — the CORE gate). ONE deposit-funded US-bank cohort: Financial Services ∧ industry in {Banks - Regional, Banks - Diversified} ∧ US-listing (DE-ADRd country-domicile guard + FOREIGN_NAME + BANK_FOREIGN_DROP DENY set + positive US-primary test) ∧ >=$1B, deduped. Live: 128 classified (after de-ADRing the 16 foreign megabank ADRs RY/TD/SAN/UBS/MUFG/SMFG/MFG/IBN/ITUB/NU/NWG/BSBR/KB/SHG/WF/BMA + dropping 4 preferred/dual-class/legacy dupes KEY-PK/WFC-PC/FCNCB/BK); 127 scored, 1 SI-4-excluded (MCHB shell — no balance sheet). SCORE = THROUGH-CYCLE BUSINESS QUALITY ONLY, never a credit-cycle bet (the CREDIT_QUALITY_BLIND wall). 4 SCORED axes via absKaliberBanks: roaThruCycle = mean of available annualNetIncome[i]/totalAssets[i] over i=0..3 (the 4y-avg through-cycle damper, w .50, norm .0070/.0164 = live p10 0.70% / p90 1.64%; the LEAD pillar), capitalAdequacy = totalEquity[0]/totalAssets[0] (CET1 surrogate, w .25, norm .084/.137 = live p10 8.9% / p90 13.9%; ~45% of the pool incl. JPM/WFC/PNC/USB carry NULL totalEquity → DROP+renorm + CAPADEQ_DROPPED, NEVER imputed — the court revision #4 case), assetGrowthDiscipline = q(-assetGrowthYoY) (a PENALTY, w .18, norm -.40/.00; assetGrowthYoY = totalAssets[0]/totalAssets[1]-1; balance-sheet ballooning at the cycle peak = credit-quality DESTROYER, so ZERO asset growth is elite and rapid growth is penalized — the CORRECT sign for banks, the OPPOSITE of utilities/REITs; live -ag p10 -0.258 / p90 -0.001 confirms the sign), earningsDurability = min(NI avail)/max(NI avail) over >=3 years when max>0 (w .07, norm .185/.863; LOW weight + BLIND-walled — only ~4 post-2020 years, no real credit cycle). FCF/OCF are HARD-EXCLUDED from all axes (economically meaningless for banks — JPM annualFCF[0] = -$147.8B); annualGP is structurally 0 and annualOpInc is empty for banks (DROPPED). COVERAGE-RENORM: any NOT_READY/null axis dropped, survivors renormalize to Σ=1.0 (no fake-neutral impute) — the load-bearing capitalAdequacy DROP path on the marquees. score=100*(0.6*absKaliber+0.4*REL), β=0.6, REL per-cohort (n=128≫15). WALLS (always-on lamps, court revision #5): CREDIT_QUALITY_BLIND (NPLs/net charge-offs/loan-loss provisions ABSENT — the single most important bank dimension; the score cannot see asset quality), NIM_BLIND (net interest margin absent), EFFICIENCY_RATIO_BLIND (cost/income ratio absent), CET1_BLIND (regulatory CET1/RWA absent — capitalAdequacy is a raw equity/assets surrogate, not Basel), DEPOSIT_FRANCHISE_BLIND (deposit mix/cost-of-funds absent). SI-4 out-of-class (non-bank industry / non-US per the de-ADRd guard / foreign-megabank ADR / <$1B → never enter court-buckets; SHELL with no positive annualNetIncome in any year OR totalAssets[0] null/<=0 → score=null + excluded[] OUT_OF_SEGMENT:shell, the materials/energy lesson adapted to the revenue-less bank schema) → score=null + excluded[]; SI-5 classifiedCount===scoredCount+excludedCount fail-loud; marquee assert (JPM/PNC/USB/MTB/EWBC/CFR/FITB classify AND survive to a sane rank) fail-loud + foreign-DENY anti-leak (a classified record in the known-foreign DENY set throws — NOT keyed on country!=US, which would wrongly throw on the legitimate country=undefined US banks JPM/PNC/USB/MTB). DISCLOSURE (court revision #4): capitalAdequacy is INVISIBLE on JPM/WFC/PNC/USB (totalEquity absent) — they score on the other 3 axes via coverage-renorm, surfaced as the CAPADEQ_DROPPED lamp. Additive/parity-safe. Constants frozen 2026-06-23.',
  },
  // equity_reits (CORE court bucket) — ONE equity-REIT through-cycle quality cohort. Court gauntlet DESIGN
  // (BUILD_WITH_CAVEATS / court REVISE, 2026-06-24; NORMS RECOMPUTED LIVE on the FINAL de-ADR'd + deduped US pool
  // 2026-06-24, n=114 — the 14 'REIT - Mortgage' names HARD-SEPARATED OUT — THEN frozen — the CORE gate). 4 SCORED axes
  // {opMargin, ffoAssets, revG3, ndGA} via the NEW engine absKaliberReits (coverage-renorm; the 21 existing CORE/court
  // buckets are BYTE-UNTOUCHED). Weights {opMargin .30, ffoAssets .30, revG3 .25, ndGA .15}: opMargin+ffoAssets the
  // profitability pillar (.60); ndGA .15 the GENEROUS leverage-discipline tiebreaker. RAW inputs from m.re.* (court-
  // screen buildReitAxes; {value}-unwrap + typeof-number assert + FFO-gains guard applied UPSTREAM). equity_reits = NEW
  // code keyed by the new cohort string; all existing buckets BYTE-IDENTICAL.
  equity_reits: {
    label: 'Equity-REITs v0 (equity REITs; through-cycle quality: NOI-margin, FFO-yield on assets, rent-base 3y CAGR, leverage discipline (net-debt/assets INVERTED); absolute-anchor; SAME_STORE_NOI_BLIND/OCCUPANCY_BLIND/NAV_PREMIUM_BLIND/AFFO_MAINT_CAPEX_BLIND/FFO_GAINS_BLIND)',
    // REL cross-sectional z/MAD axes mirror the ABS axes (sign-aligned: ndGA reads the NEGATED net-debt/assets upstream
    // so higher=better, same as the ABS inverted q-input). Weights mirror the absKaliberReits weights.
    // membership = opMargin(quality) × scale (QUALITY-ONLY, mirrors materials/energy/banks): gm.c = opMargin.floor
    // (0.08, the quality center), gm.s = 0.20 (a floor-to-elite-spread scale); g is UNUSED (no growth/FCF membership
    // gate for REITs — revG3 is an axis, not a gate, and a low-growth triple-net is still high quality); scaleLog
    // center = log10($1B).
    membership: { g: { c: 0.00, s: 0.06 }, gm: { c: 0.08, s: 0.20 }, scaleLog: { c: log10(1000), s: 0.6 } },
    axes: [
      { key: 'opMargin',  name: 'NOI-Margin',     k: 1.5, w: 0.30 },
      { key: 'ffoAssets', name: 'FFO-Yield',      k: 1.5, w: 0.30 },
      { key: 'revG3',     name: 'RentBase-3yCAGR', k: 1.5, w: 0.25 },
      { key: 'ndGAdisc',  name: 'LeverageDisc',   k: 1.5, w: 0.15 },
    ],
    dilCap: 0, dilStart: 0.05, dilRange: 0.20, // no separate share-issuance penalty axis for REITs (not a scored dimension here).
    stages: [
      { name: 'S3-Elite-NOI',   test: f => f >= 0.45 },
      { name: 'S2-Strong-NOI',  test: f => f >= 0.27 },
      { name: 'S1-Adequate',    test: f => f >= 0.08 },
      { name: 'S0-Sub-Floor',   test: () => true },
    ],
    dominantBlock: ['opMargin', 'ffoAssets'],
    degraded: false,
    normTableId: 'reits-norms-2026-06-24',
    reits: true, cohortKey: 'equity_reits',
    a2Note: 'equity_reits v0 (court gauntlet DESIGN, BUILD_WITH_CAVEATS / court REVISE 2026-06-24; NORMS RECOMPUTED LIVE on the FINAL de-ADRd + deduped US pool 2026-06-24 THEN frozen — the CORE gate). ONE equity-REIT cohort: Real Estate ∧ industry in {REIT - Retail, Office, Industrial, Residential, Diversified, Healthcare Facilities, Specialty, Hotel & Motel} ∧ US-listing (DE-ADRd country-domicile guard + FOREIGN_NAME + positive US-primary test) ∧ >=$1B, deduped. THE HARD SEPARATION (court revision #0): REIT - Mortgage is a DIFFERENT ANIMAL (book-value/leverage/dividend-sustainability, not FFO/NOI) — the 14 US >=$1B mortgage REITs (NLY/AGNC/STWD/ABR/RITM/BXMT/CIM/DX/EFC/LADR/ARI/ARR/ORC/TWO) are CLASSIFIED OUT (never enter equity_reits), a documented exclusion (MORTGAGE_REIT_EXCLUDED). Live: 114 classified; 109 scored, 5 excluded (4 economic SHELLs BXDC/FRMI/MRP/JAN — <3 positive-revenue-years or no balance sheet — PLUS CBL, a below-absolute-floor membership-Out distressed-retail name whose newest annualRev=0 leaves only ndGA computable, NOT a shell; CMRF excluded a-fortiori at classification as an OTC pink-sheet non-traded REIT). SCORE = THROUGH-CYCLE BUSINESS QUALITY ONLY, never valuation (the NAV_PREMIUM_BLIND wall). 4 SCORED axes via absKaliberReits: opMargin = annualOpInc[0]/annualRev[0] (NOI-margin proxy, w .30, norm .08/.54 = live p10 8% / p90 54%), ffoAssets = (annualNetIncome[0]+annualDepreciation[0])/totalAssets[0] (FFO yield on asset base, w .30, norm .023/.094 = live p10 2.3% / p90 9.4%; ~52% of the pool lack annualDepreciation incl. the top-tier VICI/O/PLD/TRNO → DROP+renorm + FFO_COVERAGE_PARTIAL, NEVER imputed — court revision #3), revG3 = (annualRev[0]/annualRev[3])^(1/3)-1 (rent-base 3y CAGR, w .25, norm .00/.17; floor 0 = no credit for contraction), ndGA leverage discipline = q(-((totalDebt[0]-totalCash[0])/totalAssets[0])) (INVERTED + LEVEL-scored, w .15, norm -.60/-.29 = a name at ~29% net-debt/assets scores elite, ~60% floor; GENEROUS so only the OVER-levered lose points — this is LEVEL discipline, NOT the industrials asset-GROWTH penalty). COURT REVISION #1 (the single concrete implementation defect): the FLOW fields (annualRev/OpInc/NetIncome/Depreciation) are {value}-WRAPPED objects, NOT raw numbers (annualBalance.* ARE raw) — every axis unwraps via reUnwrap() before arithmetic + a build-time typeof-number assert, else all axes silently NaN. COURT REVISION #2 (FFO gains-on-sale guard): FFO ≈ NI+D&A omits the gains-on-property-sales subtraction (no field), inflating sale-active large-caps (SPG ffo/ocf = 1.49); when (NI+dep)/OCF > 1.2 the ffoAssets observation is capped at the OCF+D&A sanity bound + FFO_GAINS_INFLATED lamp; residual disclosed FFO_GAINS_BLIND. COVERAGE-RENORM: any NOT_READY/null axis dropped, survivors renormalize to Σ=1.0 (no fake-neutral impute) — the load-bearing ffoAssets DROP path on the top-tier names. score=100*(0.6*absKaliber+0.4*REL), β=0.6, REL per-cohort (n=114≫15). WALLS (always-on lamps, court revision #4): SAME_STORE_NOI_BLIND (same-store NOI growth — the organic-quality gold standard — ABSENT), OCCUPANCY_BLIND (physical/economic occupancy absent), NAV_PREMIUM_BLIND (NAV premium/discount absent; and it is VALUATION — excluded by design), AFFO_MAINT_CAPEX_BLIND (maintenance-vs-growth capex split absent → AFFO approximate, FFO is the headline proxy), FFO_GAINS_BLIND (gains-on-sale subtraction absent → FFO over-states for sale-active names). TOP-TIER-NO-FFO DISCLOSURE (court revision #3): the headline FFO metric is absent for several top names (VICI/O/PLD/TRNO lack annualDepreciation) — they are scored on opMargin+revG3+ndGA renormed, surfaced as the FFO_COVERAGE_PARTIAL lamp; NOT silently hidden. SI-4 out-of-class (non-equity-REIT industry incl. REIT - Mortgage / non-US per the de-ADRd guard / <$1B → never enter court-buckets; economic SHELL with <3 positive-revenue-years OR totalAssets[0] null/<=0 → score=null + excluded[] OUT_OF_SEGMENT:shell, the materials/energy lesson adapted to the REIT schema) → score=null + excluded[]; SI-5 classifiedCount===scoredCount+excludedCount fail-loud; marquee assert (O/PLD/VICI/SPG/EXR/EGP/CTRE classify AND survive to a sane rank) fail-loud + mortgage-REIT anti-leak (a classified record in the known mortgage-REIT set throws). Additive/parity-safe. Constants frozen 2026-06-24.',
  },
  // capmkt_fee_core (CORE court bucket) — ONE asset-light FEE-business cohort by THROUGH-CYCLE FEE-FRANCHISE QUALITY.
  // Court gauntlet DESIGN (BUILD_WITH_CAVEATS / court REVISE, 2026-06-24; NORMS RECOMPUTED LIVE on the FINAL de-ADR'd +
  // fee-gated + deduped US pool 2026-06-24, n=100, THEN frozen — the CORE gate). 4 SCORED axes {opMargin,
  // opMarginStability, fcfMargin, netIssuance} via the NEW engine absKaliberCapmkt (coverage-renorm; the 22 existing
  // CORE/court buckets are BYTE-UNTOUCHED). Weights {opMargin .30, opMarginStability .30, fcfMargin .25, netIssuance
  // .15}: the margin-quality pillar opMargin+opMarginStability = .60 dominates; the partial-coverage netIssuance .15 is
  // the smallest weight. RAW inputs from m.cm.* (court-screen buildCapmktAxes; {value}-unwrap + 1-CV stability + the
  // ECONOMIC FEE-GATE applied UPSTREAM at classification). capmkt_fee_core = NEW code keyed by the new cohort string;
  // all existing buckets BYTE-IDENTICAL.
  capmkt_fee_core: {
    label: 'CapMkt-Fee-Core v0 (asset-light fee businesses — exchanges/rating/index-data/asset-managers/brokers; through-cycle fee-franchise quality: operating-margin LEVEL, operating-margin STABILITY (1-CV), FCF-margin, net-issuance discipline; absolute-anchor; AUM_FLOW_BLIND/FEE_RATE_BLIND/RECURRING_MIX_BLIND/BDC_SPREAD_BLIND)',
    // REL cross-sectional z/MAD axes mirror the ABS axes (sign-aligned: netIssuance reads the NEGATED net-share-issuance
    // upstream so higher=better, same as the ABS inverted q-input). Weights mirror the absKaliberCapmkt weights.
    // membership = opMargin(quality) × scale (QUALITY-ONLY, mirrors banks/reits): gm.c = opMargin.floor (RE-FROZEN to
    // -0.01 on the de-BDC'd + de-mined clean pool, the quality center), gm.s = 0.40 (a floor-to-elite-spread scale); g
    // is UNUSED (no growth/FCF membership gate — a low-growth exchange is still high quality); scaleLog = log10($1B).
    membership: { g: { c: 0.00, s: 0.06 }, gm: { c: -0.01, s: 0.40 }, scaleLog: { c: log10(1000), s: 0.6 } },
    axes: [
      { key: 'opMargin',          name: 'OpMargin-Level',  k: 1.5, w: 0.30 },
      { key: 'opMarginStability', name: 'OpMargin-Stab',   k: 1.5, w: 0.30 },
      { key: 'fcfMargin',         name: 'FCF-Margin',      k: 1.5, w: 0.25 },
      { key: 'netIssuanceDisc',   name: 'NetIssuanceDisc', k: 1.5, w: 0.15 },
    ],
    dilCap: 0, dilStart: 0.05, dilRange: 0.20, // net-issuance IS a scored axis here (not a separate post-sum penalty).
    stages: [
      { name: 'S3-Elite-OpMargin',  test: f => f >= 0.50 },
      { name: 'S2-Strong-OpMargin', test: f => f >= 0.30 },
      { name: 'S1-Adequate',        test: f => f >= 0.00 },
      { name: 'S0-Sub-Floor',       test: () => true },
    ],
    dominantBlock: ['opMargin', 'opMarginStability'],
    degraded: false,
    normTableId: 'capmkt-norms-2026-06-24',
    capmkt: true, cohortKey: 'capmkt_fee_core',
    a2Note: 'capmkt_fee_core v0 (court gauntlet DESIGN, BUILD_WITH_CAVEATS / court REVISE 2026-06-24 + RE-COURT 2026-06-24 DENIED-for-BDC-contamination -> 2 new fee-gate arms; NORMS RE-FROZEN LIVE on the FINAL de-ADRd + fee-gated + DE-BDCd + DE-MINED + deduped US pool 2026-06-24 THEN frozen — the CORE gate). ONE asset-light FEE-business cohort: Financial Services ∧ industry in {Asset Management, Capital Markets, Financial Data & Stock Exchanges, Insurance Brokers} ∧ US-listing (DE-ADRd country-domicile guard + FOREIGN_NAME + positive US-primary test) ∧ >=$1B, deduped, MINUS the economic fee-gate. Live: 84 classified; SCORE = THROUGH-CYCLE FEE-FRANCHISE QUALITY ONLY, never AUM direction / market levels. THE ECONOMIC FEE-GATE (court revision #1 + RE-COURT, applied at classification — classify-capmkt.js): a FOUR-arm ECONOMIC gate (NOT a name list) excludes 71 names — (1) FUND_FLOAT_PASSTHROUGH fcfMargin=annualFCF[0]/annualRev[0]>1.0 (a real fee business cannot FCF more than its revenue — KYN 8.80 / APO 1.62 / IBKR 2.56 / PDO 9.19; 16 names), (2) RIC_PASSTHROUGH niMargin=annualNetIncome[0]/annualRev[0]>=0.95 (a 40-Act closed-end fund drops ~all investment income to NI — NMZ/NUV/TY/ADX/GAB niMargin .97-1.00; live genuine-fee max niMargin is APO .76 so .95 has ZERO false positives; 39 names), (3) BDC_SPREAD_LOAN_BOOK (RE-COURT — the DENIAL cause: the original top-5 were 4 leveraged-spread-lender BDCs while CME/MSCI/ICE sat at ranks 6-14) revToAssets=annualRev[0]/annualBalance[0].totalAssets ∈[.05,.16] ∧ totalDebt===null ∧ totalLiabilities/totalEquity ∈[.7,2.0] (the regulated ~2:1 BDC asset-coverage signature; catches all 11 BDCs OBDC/GSBD/TSLX/MSDL/FSK/GBDC/OTF/ARCC/BXSL/CSWC/HTGC with ZERO genuine-fee false positives — the leverage CEILING 2.0 spares the alt-manager holdco Carlyle/CG at TL/TE 3.83; 11 names), (4) CRYPTO_MINER_NON_FEE (RE-COURT) opMargin<0 in EVERY available year ∧ mean NI margin AND mean FCF margin both <-.20 (5 commodity bitcoin-miners CLSK/HIVE/MARA/RIOT/WULF mislabeled into Capital Markets that polluted the REL anchors; opMargin strips volatile crypto mark-to-market; SPARES COIN +.13 FCF / HOOD positive recent opMargin / CG +.15 mean NI / BWIN near-break-even; 5 names). EXCLUDE-not-cap is the cleaner economic treatment (a fund/float vehicle, BDC loan-book, or commodity miner is a DIFFERENT ANIMAL, like a mortgage REIT vs equity REIT — score-capping would still pollute the cohort REL anchors). Verified: KYN/TIGR/APO/IBKR + 39 CEFs + 11 BDCs + 5 miners OUT; the genuine fee compounders CME/MSCI/ICE now LEAD the cohort. 4 SCORED axes via absKaliberCapmkt: opMargin = annualOpInc[0]/annualRev[0] (fee-franchise pricing power, w .30, norm -.01/.50 = clean-pool p10 -1.3% / p90 50.2%), opMarginStability = 1-CV(opMargin over available years) where CV=stdev/|mean|, clamp [0,1] (a through-cycle pricing-durability proxy, w .30, identity-clip norm 0/1; cov ~65/84), fcfMargin = annualFCF[0]/annualRev[0] (cash conversion, w .25, norm -.23/.52 = clean-pool p10 -22.7% / p90 51.9%), netIssuance = q(-((annualShares[0]-annualShares[1])/annualShares[1])) (Pontiff-Woodgate discipline, INVERTED, buyback=elite, w .15, norm -.08/.12; ~43% coverage → DROP+renorm + ISSUANCE_NOT_READY, NEVER imputed). COUNTRY NORMALIZE (court revision #2): snapshots carry country===undefined (NOT null) for the Vintage-A US names; the classify-in test treats undefined === US-primary (US exchange + USD + no foreign legal-form name), so MSCI/MCO/ICE/NDAQ/KKR are RETAINED; the anti-leak assert keys on the foreign-DENY SIGNAL, NOT country!=US. COVERAGE-RENORM: any NOT_READY/null axis dropped, survivors renormalize to Σ=1.0 (no fake-neutral impute) — the load-bearing netIssuance DROP path on ~57% of the pool. score=100*(0.6*absKaliber+0.4*REL), β=0.6, REL per-cohort (n=84≫15). WALLS (always-on lamps): AUM_FLOW_BLIND (AUM net flows / organic AUM growth — the fee-engine fuel — ABSENT), FEE_RATE_BLIND (fee rate / take-rate compression absent), RECURRING_MIX_BLIND (recurring vs transactional/performance-fee mix absent), BDC_SPREAD_BLIND (now largely MOOT — the 11 BDCs are hard-gated OUT by arm 3, not scored — kept always-on as a structural disclosure for any future borderline lender the economic gate misses). SI-4 out-of-class (non-fee industry / non-US per the de-ADRd guard / <$1B / fee-gated → never enter court-buckets; economic SHELL with <2 positive-revenue-years OR no revenue → score=null + excluded[] OUT_OF_SEGMENT:shell) → score=null + excluded[]; SI-5 classifiedCount===scoredCount+excludedCount fail-loud; marquee assert (SPGI/MCO/MSCI/ICE/NDAQ/CBOE/BLK/AJG/BRO classify AND survive to a sane rank) fail-loud + fee-gate/foreign anti-leak (a classified record in the fund-float/BDC/miner DENY set or a country-SET foreigner throws). Additive/parity-safe. Constants frozen 2026-06-24.',
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

// audit/fix (re-court materials_quality DENIAL — Spec §1/§5 pre-revenue SI-4 exclusion):
// a materials name with NO real revenue is a pre-revenue exploration/shell name (EMAT annualRev=[] $4.3B revenue-
// less shell; LWLG $236k micro) and MUST be SI-4 EXCLUDED (score=null + excluded[], reason OUT_OF_SEGMENT:
// preexploration), NEVER scored — the gpa/marginStability axes are undefined/explosive on near-zero revenue, so
// coverage-renorm wrongly concentrates the absK on the surviving discipline axes (EMAT's assetGrowthPenalty=1.0
// from an asset COLLAPSE) and the shell tops the cohort. To be SCORED a materials name needs >=2 non-null annual
// revenue points AND a latest revenue >= MT_MIN_REVENUE ($1M). $1M against the $1B+ marketCap classifier gate is
// unambiguously pre-revenue; the lowest legitimately-scored materials name (ALM ~$23.5M) clears it with huge
// headroom, so no real name is touched. Mirrors how the other buckets route out-of-class names to excluded[].
const MT_MIN_REVENUE = 1e6; // $1M latest-annual-revenue floor for a materials name to be SCORED (else preexploration)

// energy_quality (CORE) pre-revenue SI-4 exclusion (the materials lesson — DO NOT SKIP): an energy name with NO
// real revenue is a pre-revenue exploration/shell name (e.g. a pre-production E&P shell or a SPAC-stage services
// name) and MUST be SI-4 EXCLUDED (score=null + excluded[], reason OUT_OF_SEGMENT:preexploration), NEVER scored —
// the roce/fcfMargin/gpa axes are undefined/explosive on near-zero revenue, so coverage-renorm wrongly
// concentrates the absK on the surviving discipline axes (a divesting/collapsing shell's assetGrowthPenalty=1.0)
// and the shell tops the cohort. To be SCORED an energy name needs >=2 non-null annual revenue points AND a latest
// revenue >= EN_MIN_REVENUE ($1M). $1M against the $1B+ marketCap classifier gate is unambiguously pre-revenue.
const EN_MIN_REVENUE = 1e6; // $1M latest-annual-revenue floor for an energy name to be SCORED (else preexploration)

// pharma_commercial (CORE) pre-revenue SI-4 floor (the materials lesson — DO NOT SKIP): the §1.4 commercial gate in
// classify-pharma.js already DEFERS the cash-burning clinical-stage names (rev<$500M OR negative cash) so they never
// enter court-buckets; this is the belt-and-suspenders floor catching any revenue-less shell that slipped in. To be
// SCORED a pharma name needs >=2 non-null annual revenue points AND a latest revenue >= PH_MIN_REVENUE ($1M) — the
// gm/eff axes are undefined/explosive on near-zero revenue. SI-4 score=null + excluded[] OUT_OF_SEGMENT:preexploration.
const PH_MIN_REVENUE = 1e6; // $1M latest-annual-revenue floor for a pharma name to be SCORED (else preexploration)

// it_services (CORE) PRE-REVENUE SI-4 floor (the materials/energy lesson). classify-itservices.js already excludes
// the negative-opMargin AI-shells via the contamination gate; this is the belt-and-suspenders floor catching any
// revenue-less shell that slipped in. To be SCORED an it_services name needs >=2 non-null annual revenue points AND
// a latest revenue >= IT_MIN_REVENUE ($1M) — the gpa/fcfMargin/opMargin axes are undefined/explosive on near-zero
// revenue. SI-4 score=null + excluded[] OUT_OF_SEGMENT:preexploration.
const IT_MIN_REVENUE = 1e6; // $1M latest-annual-revenue floor for an it_services name to be SCORED (else preexploration)

// tech_hardware_quality (CORE) SI-4 SHELL gate (the materials/energy pre-revenue lesson). The classifier admits the
// WHOLE cohort (NO contamination gate — the absolute floor sinks the commodity/loss tail off-headline); this SI-4 gate
// is the belt-and-suspenders economic SHELL exclusion. A tech_hardware name with NO positive revenue in ANY available
// year OR no totalAssets in ANY available year (a true revenue-less / no-balance-sheet shell, e.g. a freshly-listed
// quantum/space SPAC) CANNOT be scored: the gpa/fcfMargin/opMargin axes are undefined/explosive on it. SI-4 EXCLUDE ->
// score=null + excluded[] OUT_OF_SEGMENT:shell, NEVER scored 0. The extractor (court-screen buildTechHwAxes) surfaces
// anyPosRev + anyTotalAssets for this test. (A name with revenue + a balance sheet but a missing bal[0].totalAssets —
// e.g. AMKR — is NOT a shell: its gpa axis just drops via coverage-renorm and it scores on the other 4 axes.)
//
// THE COMPOSITE absKaliber FLOOR for the headlineShortlist (the bimodality demotion mechanism — the thesis). The
// per-axis SI-1 floors (gpa>=.10, fcfMargin>=0, opMargin>=.02) are individually too permissive: a commodity contract-
// manufacturer clears each one (FLEX gpa .12 / fcfMargin .01-.03 / opMargin .04-.05) yet is NOT a franchise. The
// COMPOSITE absKaliber cleanly separates the two modes — live there is a NATURAL GAP between the lowest genuine
// franchise (FORM .31 / COHR .29) and the commodity/low-quality tail (TTMI .21 / HPE .19 / FLEX .18 / SANM .12 /
// PLXS .11). THW_ABSK_FLOOR=.25 sits in that gap → a name with absKaliber < .25 is belowAbsoluteFloor (off the
// headlineShortlist), demoting the commodity contract-mfg + the loss tail exactly as materials/energy demote their
// commodity tail under the absolute anchor. NOT a score-kill (the name still gets a score/rank, just off the headline).
const THW_ABSK_FLOOR = 0.25;

// financials_banks (CORE) SHELL gate (the materials/energy pre-revenue lesson ADAPTED to the revenue-less bank schema):
// banks have NO revenue line, so the SI-4 shell test keys on EARNINGS PRESENCE + a BALANCE SHEET, not a revenue floor.
// A bank with no positive annualNetIncome in ANY available year (a perennial-loss shell) OR no totalAssets[0] (no
// balance sheet — e.g. MCHB, a freshly-listed name with annualBalance=[]) is a shell that CANNOT be scored: the
// roaThruCycle/capitalAdequacy/assetGrowthDiscipline axes are all undefined on it, so coverage-renorm would degenerate.
// SI-4 EXCLUDE → score=null + excluded[] OUT_OF_SEGMENT:shell, NEVER scored 0. The bank-axis extractor surfaces
// m.bk.anyPositiveNI + m.bk.totalAssetsLatest for exactly this gate.

// financials_banks (CORE) FOREIGN-DENY anti-leak set (court revision #2): the known foreign-megabank ADRs whose
// US-listed ADR shares country=undefined with the legitimate US banks (mirrors the classifier's BANK_FOREIGN_DROP).
// The SI-5 block asserts NO classified member is in this set — keyed on the foreign-DENY SIGNAL, NOT on country!=US
// (which would wrongly throw on the legitimate country=undefined US banks JPM/PNC/USB/MTB that carry undefined country).
const BANK_FOREIGN_DENY = new Set(['IBN', 'ITUB', 'BSBR', 'BMA', 'KB', 'SHG', 'WF', 'MFG', 'MUFG', 'SMFG', 'RY', 'TD', 'SAN', 'UBS', 'NWG', 'NU']);

// equity_reits (CORE) economic SHELL gate (the materials/energy/banks pre-revenue lesson ADAPTED to the REIT schema):
// a REIT with <3 positive-revenue-years OR no totalAssets[0] (no balance sheet) is a pre-operating shell that CANNOT
// be scored — the opMargin/ffoAssets/revG3 axes are undefined/explosive on near-zero revenue, so coverage-renorm
// would degenerate (the court found FRMI/MRP/JAN/BXDC must be shell-excluded; CBL is a thin-axis survivor at exactly 3
// positive-revenue-years). SI-4 EXCLUDE → score=null + excluded[] OUT_OF_SEGMENT:shell, NEVER scored 0. The reit-axis
// extractor surfaces m.re.positiveRevYears + m.re.totalAssetsLatest for exactly this gate.
const REIT_MIN_POSITIVE_REV_YEARS = 3; // >=3 positive-revenue-years required for a REIT to be SCORED (else shell)

// equity_reits (CORE) MORTGAGE-REIT anti-leak set (court revision #0): the known mortgage REITs the hard-separation
// must keep OUT of equity_reits (mirrors the classifier's REIT_MORTGAGE_CONTROL). The SI-5 block asserts NO classified
// member is in this set — mortgage REITs are a different animal (book-value/leverage, not FFO/NOI) and scoring one with
// the equity-REIT axes is economically meaningless.
const REIT_MORTGAGE_DENY = new Set(['NLY', 'AGNC', 'STWD', 'ABR', 'RITM', 'BXMT', 'CIM', 'DX', 'EFC', 'LADR', 'ARI', 'ARR', 'ORC', 'TWO']);

// capmkt_fee_core (CORE) economic SHELL gate (the materials/energy/reits pre-revenue lesson ADAPTED to the fee-business
// schema): a fee name with <2 positive-revenue-years OR no latest revenue is a pre-operating shell that CANNOT be
// scored — the opMargin/fcfMargin axes are undefined/explosive on near-zero revenue, so coverage-renorm would
// degenerate. SI-4 EXCLUDE → score=null + excluded[] OUT_OF_SEGMENT:shell, NEVER scored 0. The capmkt-axis extractor
// surfaces m.cm.positiveRevYears + m.cm.revLatest for exactly this gate.
const CAPMKT_MIN_POSITIVE_REV_YEARS = 2; // >=2 positive-revenue-years required for a fee name to be SCORED (else shell)

// capmkt_fee_core (CORE) FEE-GATE DENY positive-control (court revision #1 + RE-COURT 2026-06-24): the known fee-gated
// artifacts the economic fee-gate must keep OUT (mirrors the classifier's CAPMKT_FEEGATE_CONTROL/BDC/MINER controls).
// The SI-5 block asserts NO classified member is in this set — a leak means a fee-gate arm regressed. KYN/PDO closed-
// end funds; APO/IBKR fcfMargin>1 float; the named NAV-pass-through CEFs; the 11 BDC spread-lenders (RE-COURT arm 3,
// BDC_SPREAD_LOAN_BOOK — the DENIAL cause); the 5 crypto miners (RE-COURT arm 4, CRYPTO_MINER_NON_FEE). CG/COIN/HOOD/
// BWIN are NOT here — they are genuine fee businesses the gate SPARES (verified retained).
const CAPMKT_FEEGATE_DENY = new Set([
  'KYN', 'PDO', 'APO', 'IBKR', 'NMZ', 'NUV', 'TY', 'ADX', 'GAB', 'GDV', 'BDJ', 'NAD', 'TIGR',
  'OBDC', 'GSBD', 'TSLX', 'MSDL', 'FSK', 'GBDC', 'OTF', 'ARCC', 'BXSL', 'CSWC', 'HTGC',   // RE-COURT arm 3: BDC_SPREAD_LOAN_BOOK
  'CLSK', 'HIVE', 'MARA', 'RIOT', 'WULF',                                                 // RE-COURT arm 4: CRYPTO_MINER_NON_FEE
]);

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
// audit COURT-5: guarded read mirroring the medtech/dlst sibling snapshots (lines ~23/~29). A missing or
// corrupt ma-rpo-snapshot.json must NOT abort the court run or any require('./court-score.js') — it degrades
// to an empty Map (all consumers null-guard maRpoByTicker.get(...): inorganicFlag, computeA2Forward, statsA2).
const maRpoByTicker = (() => { try { return new Map(readJson(path.join(ROOT, 'data', 'ma-rpo-snapshot.json')).map(r => [r.ticker, r])); } catch { return new Map(); } })();

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
// UNIVERSAL revenue-artifact guard (re-court defense-in-depth, mirrors court-screen.js SUSPECT_REV_MULT):
// a single-year revG >= +300% (revenue >4x in one year) is — regardless of sector — a scale/units/currency/
// restatement DATA artifact (no $1B+ company quadruples revenue in one year). EMPIRICAL clean gap [3.42x ALAB
// (top legit) .. 7.38x ONDS (lowest artifact)]; 4.0x threshold (revG>=3.00) sits dead-center. The offending YoY
// is DROPPED from the organic blend (like a deal-year) + a SUSPECT_REVENUE_MULTIPLE lamp is raised; ADVISORY +
// growth-axis only. Applies to medtech_devices + diagnostics_lst (which compute organic growth here, not in
// court-screen) and to the saas/fabless generic-growth pre-pass below.
const SUSPECT_REV_MULT_THR = 3.00; // revG >= +300% (>4x single-year) = scale/units/currency/restatement artifact
const W_CAGR = 0.6, W_MEDIAN = 0.4; // [TODO-CAL] Blend CAGR_3y vs median(trailing YoY) — jetzt SEKUNDÄR (durability), nicht primär
const CATCH_UP_YEARS = 1;        // [TODO-CAL] zusätzlich gedroppte Folge-YoY (erstes volles inorganisches Jahr)
const FY_RECON_TOL = 0.15;       // [TODO-CAL] max |cacheRev/snapRev - 1| bevor index-aligned Drop als unsicher LAUT failt (VII)
const MT_IMPAIRMENT_THRESH = 0.05; // audit/fix (gauntlet C6): negativer ΔGoodwill >= 5% von dem-Jahr-Rev = Impairment-Lampe (mirror dlst Fix 2)
function computeMedtechOrganicGrowth(yoySeries, goodwillHistory, revHist, revLatest, fallbackGrowth, opts) {
  // yoySeries: newest-first YoY-Reihe (rev[i]/rev[i+1]-1). goodwillHistory: [{val,end}] newest-first.
  // revHist: [{val,end}] newest-first per-Jahr-Revenue (aus dem medtech-Snapshot, LOKAL aus annualRev rekonstruiert).
  // Beide (goodwillHistory + revHist) sind SAME-SOURCE index-aligned mit yoySeries: revYoYMedtech[i]=rev[i]/rev[i+1]-1
  // wird in court-screen.js aus demselben annualRev gebaut, das revHist[i].val trägt → revHist[i] ist exakt die
  // Revenue des neueren Jahres des Sprungs goodwillHistory[i] vs [i+1].
  // opts: { ticker, snapAnnualRev } für die FY-Reconciliation (VII).
  // Returns { growth (=min(latest,blend)), latestOrganicYoY, blend, organicYears, droppedIdx, dealYearExcluded,
  //           impairmentFlag, shortHistory, currentYearOnly, decelerating }.
  //
  // audit/fix (gauntlet C6): SIGN-SEPARATED DECONTAMINATION (Ledger 26 — bringt medtech auf die dlst-Behandlung).
  //   VORHER (v1.3): EIN-SEITIG — jump = (newer-older)/revLatest, gemasked NUR wenn jump >= 0.25 über EINEM
  //   einzigen revLatest-Skalar. Ein NEGATIVER Goodwill-Move (Impairment/Divestitur) fiel still durch (jump<0.25)
  //   und wurde WEDER geflaggt NOCH ehrlich offengelegt; und ein älteres Deal-Jahr wurde gegen die FALSCHE (neueste)
  //   Revenue-Skala gemessen (small-base-Verzerrung bei stark gewachsenen Namen wie GMED/TMDX).
  //   JETZT (v1.4): wie dlst — (a) PER-JAHR-Revenue-Denominator revHist[i] (Fallback revLatest); (b) SIGN-SEPARIERT:
  //   delta <= 0 ist KEIN Deal-Sprung, sondern wird als Impairment GEFLAGGT (>=5% von dem-Jahr-Rev → impairmentFlag),
  //   NICHT still gedroppt; nur POSITIVE Akquisitions-Sprünge >= 0.25 werden deal-masked.
  const result = {
    growth: fallbackGrowth, latestOrganicYoY: null, blend: null, organicYears: 0, droppedIdx: [],
    dealYearExcluded: false, impairmentFlag: false, shortHistory: false, currentYearOnly: false, decelerating: false,
    revArtifactMult: false,
  };
  if (!Array.isArray(yoySeries) || yoySeries.length === 0) return result;
  // Deal-Jahr-Indizes via goodwill-Sprung (nur wenn coverage vorhanden)
  const dropIdx = new Set();
  // UNIVERSAL revenue-artifact guard: any YoY >= +300% (>4x in one year) is a scale/units/currency artifact —
  // dropped like a deal-year (independent of goodwill coverage) + flag for the SUSPECT_REVENUE_MULTIPLE lamp.
  for (let i = 0; i < yoySeries.length; i++) {
    const v = yoySeries[i];
    if (v != null && isFinite(v) && v >= SUSPECT_REV_MULT_THR) { dropIdx.add(i); result.revArtifactMult = true; }
  }
  if (Array.isArray(goodwillHistory) && goodwillHistory.length >= 2) {
    for (let i = 0; i < goodwillHistory.length - 1; i++) {
      const newer = goodwillHistory[i] ? goodwillHistory[i].val : null;
      const older = goodwillHistory[i + 1] ? goodwillHistory[i + 1].val : null;
      if (newer == null || older == null) continue;
      const delta = newer - older;
      // audit/fix (gauntlet C6): PER-JAHR-Revenue-Denominator — revHist[i] (das neuere Jahr des Sprungs),
      // Fallback revLatest (mirror dlst Bug-Fix 1). NICHT der eine revLatest-Skalar für alle Jahre.
      const yrRev = (Array.isArray(revHist) && revHist[i] && revHist[i].val != null && revHist[i].val > 0)
        ? revHist[i].val
        : (revLatest != null && revLatest > 0 ? revLatest : null);
      if (yrRev == null) continue;
      if (delta <= 0) {
        // audit/fix (gauntlet C6): NEGATIVER Move = Impairment/Divestitur → KEIN Deal-Sprung (mirror dlst Bug-Fix 2).
        // FLAGGEN statt still droppen: >= 5% von dem-Jahr-Rev setzt impairmentFlag (offengelegt via Lampe).
        if (Math.abs(delta) / yrRev >= MT_IMPAIRMENT_THRESH) result.impairmentFlag = true;
        continue;
      }
      const jump = delta / yrRev;
      if (jump >= DEAL_JUMP_THRESH) {
        // POSITIVER Sprung >= 0.25: goodwill-Sprung [i]->[i+1] (Jahr i) → YoY-Index i ist das Deal-Jahr;
        // +CATCH_UP_YEARS Folge-Jahre (kleinere Indizes = neuer).
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
    revArtifactMult: false,
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
  // UNIVERSAL revenue-artifact guard: any YoY >= +300% (>4x) is a scale/units/currency artifact — dropped
  // (independent of goodwill coverage) + flagged. NOT counted as a deal-year (dealYearExcluded below counts
  // only goodwill-driven drops) — a scale artifact is a data corruption, not an acquisition.
  const suspectIdx = new Set();
  for (let i = 0; i < yoySeries.length; i++) {
    const v = yoySeries[i];
    if (v != null && isFinite(v) && v >= SUSPECT_REV_MULT_THR) { dropIdx.add(i); suspectIdx.add(i); result.revArtifactMult = true; }
  }
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
  // (Fix B) Ehrlichkeit: dealYearExcluded=true GENAU DANN, wenn mindestens ein YoY-Jahr per GOODWILL-Sprung
  // entfernt wurde (suspect-multiple-Drops zählen NICHT als Deal-Jahr — sie sind Daten-Artefakte, kein M&A).
  result.dealYearExcluded = [...dropIdx].some(i => !suspectIdx.has(i));
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
    // industrials_compounder (CORE): the deterministic classifier already deduped (IND_DEDUPE_DROP, §1.4) and
    // court-buckets carries ONE entry per ticker; the gm>1.0 reject + the gm|scaleRevM fingerprint dedup are
    // NOT applicable (gm is not an industrials axis, and pre-revenue names share the degenerate fp 'null|0',
    // which would falsely drop NNE/EVEX/etc. and break SI-5). Skip both for industrials; all other buckets
    // BYTE-IDENTICAL.
    // consdisc_expansion (CORE): same rationale as industrials — the deterministic classifier already deduped
    // and court-buckets carries ONE entry per ticker; gm is not a consdisc axis (gpa is the quality pillar) and
    // pre-revenue/thin names can share the degenerate fp 'null|0', which would falsely drop names and break SI-5.
    // Skip the gm-reject + fp-dedupe for consdisc too. All other buckets (incl. staples) BYTE-IDENTICAL.
    // materials_quality (CORE): same rationale — classifier already deduped, gm is not a materials axis (gpa is
    // the quality pillar), and snapshot-sourced names carry a null cache gm sharing the degenerate fp 'null|0'
    // (would falsely drop names + break SI-5). Skip the gm-reject + fp-dedupe for materials too.
    // energy_quality (CORE): same rationale — classifier already deduped, gm is not an energy axis (roce/fcfMargin
    // are the pillars), and snapshot-sourced energy names carry a null cache gm sharing the degenerate fp 'null|0'
    // (would falsely drop names + break SI-5). Skip the gm-reject + fp-dedupe for energy too.
    // financials_banks (CORE): same rationale as industrials/energy — the deterministic classifier already deduped
    // (BANK_DEDUPE_DROP: KEY-PK/WFC-PC/FCNCB/BK), gm is not a bank axis (roaThruCycle/capitalAdequacy are the pillars),
    // and EVERY bank carries a NULL cache gm + null/0 cache scaleRevM (banks have no revenue line) → ALL banks share
    // the degenerate fp 'null|null', which would wrongly drop all-but-one and break SI-5. Skip the gm-reject + fp-dedupe
    // for banks too; all other buckets BYTE-IDENTICAL.
    // equity_reits (CORE): same rationale as banks/energy — the classifier already deduped, gm is not a REIT axis
    // (opMargin/ffoAssets are the pillars), and snapshot-sourced REIT names carry a null cache gm + null/0 cache
    // scaleRevM sharing the degenerate fp 'null|0/null' (would falsely drop names + break SI-5). Skip the gm-reject +
    // fp-dedupe for reits too; all other buckets BYTE-IDENTICAL.
    // capmkt_fee_core (CORE): same rationale as banks/reits — the classifier already deduped (economic-fingerprint +
    // CAPMKT_DEDUPE_DROP), gm is not a fee axis (opMargin/opMarginStability are the pillars), and fee businesses carry
    // a null cache gm sharing the degenerate fp 'null|<scaleRevM>' (two fee names with no cache gm + same scaleRevM
    // would wrongly collide → falsely drop names + break SI-5). Skip the gm-reject + fp-dedupe for capmkt too; all
    // other buckets BYTE-IDENTICAL.
    if (!F.industrials && !F.consdisc && !F.materials && !F.energy && !F.banks && !F.reits && !F.capmkt) {
      if (c.gm != null && c.gm > 1.0) continue;        // GM>100% = unmöglich (Daten-Fehler) -> hard reject
      // dedupe identische Foreign-OTC-Doppellistings (gleiche gm+rev)
      const fp = `${c.gm}|${c.scaleRevM}`;
      if (seen.has(fp)) continue; seen.add(fp);
    }
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
      // audit/fix (gauntlet C6): per-Jahr-Revenue-Denominator (revenueHistory aus dem medtech-Snapshot, LOKAL
      // aus annualRev rekonstruiert) — index-aligned mit gwHist + revYoYMedtech (alle same-source newest-first).
      const revHist = maRecMt ? maRecMt.revenueHistory : null;
      const revLatest = m.scaleRevM != null ? m.scaleRevM * 1e6 : null;
      const snapAnnualRev = maRecMt && maRecMt.annualRevenue != null ? maRecMt.annualRevenue : null; // SEC FY-Rev für VII-Recon
      const org = computeMedtechOrganicGrowth(m.revYoYMedtech, gwHist, revHist, revLatest, m._growth, { ticker: m.ticker, snapAnnualRev });
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
      m._impairmentFlag = org.impairmentFlag; // audit/fix (gauntlet C6): negativer ΔGoodwill geflaggt (nicht still gedroppt)
      m._shortOrganicHistory = org.shortHistory;
      m._currentYearOnly = org.currentYearOnly; // (VI) <2 organische Jahre → kein 0.6/0.4-Blend gelaufen
      m._decelerating = org.decelerating;       // (III) aktuelle Rate < median(prior organic years)
      // UNIVERSAL guard: implausible >4x YoY dropped → SUSPECT_REVENUE_MULTIPLE lamp. PARITY: only set the field
      // when it actually fires (zero current medtech names) so the persisted JSON stays byte-identical to baseline.
      if (org.revArtifactMult) m._revArtifactMult = true;
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
      // UNIVERSAL guard: implausible >4x YoY dropped → SUSPECT_REVENUE_MULTIPLE lamp. PARITY: only set on fire
      // (zero current dlst names) so the persisted JSON stays byte-identical to the pre-dlst/frozen baseline.
      if (org.revArtifactMult) m._revArtifactMult = true;
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
  // --- saas/fabless UNIVERSAL revenue-artifact PRE-PASS (re-court defense-in-depth) ---
  // saas/semi score the growth axis directly off m._growth (= generic gAnnual = latest annual YoY). If that
  // latest YoY is an implausible >4x multiple (scale/units/currency artifact), DROP it and fall back to the next
  // clean annual YoY from the persisted revYoYSaasSemi series (newest-first); no clean year → null (the growth
  // axis is dropped + coverage-renormed downstream, like a NOT_READY name). ADVISORY + growth-axis only. All
  // intermediates are saas/semi-LOCAL → medtech/dlst/court-screen-bucket member JSON byte-identical (parity).
  if (bucket === 'system_app_software' || bucket === 'fabless_semi') {
    for (const m of members) {
      m._revArtifactMult = false;
      if (m._growth != null && isFinite(m._growth) && m._growth >= SUSPECT_REV_MULT_THR) {
        m._revArtifactMult = true;
        // fall back to the next clean (<threshold) finite annual YoY from the series; else null.
        let repl = null;
        const series = Array.isArray(m.revYoYSaasSemi) ? m.revYoYSaasSemi : [];
        for (const v of series) {
          if (v != null && isFinite(v) && v < SUSPECT_REV_MULT_THR) { repl = v; break; }
        }
        m._growth = repl;                         // dropped artifact → next clean year (or null → axis DROP)
        m.growthOrganic = repl == null ? null : Math.round(repl * 10000) / 10000; // persisted audit view (only when guard fired)
      }
      // PARITY: revYoYSaasSemi is a TRANSIENT guard input (court-screen → here). Drop it from the member so the
      // persisted saas/fabless JSON stays byte-identical to the frozen pre-v12/pre-dlst baselines when the guard
      // does NOT fire (it fires on zero current names). _revArtifactMult (false on all current names) is a plain
      // boolean that the older baselines' member objects also tolerate — but to be byte-safe, only keep it on fire.
      delete m.revYoYSaasSemi;
      if (m._revArtifactMult === false) delete m._revArtifactMult;
    }
  }
  // --- industrials_compounder (CORE) PRE-PASS: lift the 5 RAW axis inputs from m.ind onto the member ---
  // All intermediates are INDUSTRIALS-LOCAL → saas/fabless/medtech/dlst member JSON byte-identical (parity).
  // The inverted axes (assetGrowthPenalty/netIssuance) store the NEGATED raw as the axis value, so the
  // cross-sectional REL z (higher = better) agrees in sign with the ABS q-input. null raw → axis DROP (the
  // coverage-renorm in absKaliberIndustrials handles it; REL sAxis returns 0=neutral for null).
  if (F.industrials) {
    for (const m of members) {
      const i = m.ind || {};
      m._indGpa = (i.gpa != null && isFinite(i.gpa)) ? i.gpa : null;
      m._indGrowth = (i.growth != null && isFinite(i.growth)) ? i.growth : null;          // deal-masked + spinoff-guarded UPSTREAM
      m._indAssetGrowthPenalty = (i.assetGrowth != null && isFinite(i.assetGrowth)) ? -i.assetGrowth : null; // q(-AG) direction
      m._indNetIssuance = (i.netShareIssuance != null && isFinite(i.netShareIssuance)) ? -i.netShareIssuance : null; // q(-NSI) direction
      m._indEff = (i.eff != null && isFinite(i.eff)) ? i.eff : null;
      // persisted audit fields (rounded)
      m.gpa = m._indGpa == null ? null : Math.round(m._indGpa * 10000) / 10000;
      m.assetGrowth = (i.assetGrowth != null && isFinite(i.assetGrowth)) ? Math.round(i.assetGrowth * 10000) / 10000 : null;
      m.netShareIssuance = (i.netShareIssuance != null && isFinite(i.netShareIssuance)) ? Math.round(i.netShareIssuance * 10000) / 10000 : null;
      m.effInd = m._indEff == null ? null : Math.round(m._indEff * 10000) / 10000;
      m.growthInput = m._indGrowth == null ? null : Math.round(m._indGrowth * 10000) / 10000;
      m.cohort = i.cohort || F.cohortKey;
    }
  }
  // --- consumer_staples_compounder (CORE) PRE-PASS: lift the 5 RAW axis inputs from m.stp onto the member ---
  // All intermediates are STAPLES-LOCAL → saas/fabless/medtech/dlst/industrials member JSON byte-identical
  // (parity). The inverted axes (assetGrowthPenalty/netIssuance) store the NEGATED raw, so the REL z (higher
  // = better) agrees in sign with the ABS q-input. null raw → axis DROP (coverage-renorm in absKaliberStaples;
  // REL sAxis returns 0=neutral for null). Mirrors the industrials pre-pass exactly.
  if (F.staples) {
    for (const m of members) {
      const i = m.stp || {};
      m._stpGpa = (i.gpa != null && isFinite(i.gpa)) ? i.gpa : null;
      m._stpGrowth = (i.growth != null && isFinite(i.growth)) ? i.growth : null;          // deal-masked + spinoff-guarded UPSTREAM
      m._stpAssetGrowthPenalty = (i.assetGrowth != null && isFinite(i.assetGrowth)) ? -i.assetGrowth : null; // q(-AG) direction
      m._stpNetIssuance = (i.netShareIssuance != null && isFinite(i.netShareIssuance)) ? -i.netShareIssuance : null; // q(-NSI) direction
      m._stpEff = (i.eff != null && isFinite(i.eff)) ? i.eff : null;
      // persisted audit fields (rounded)
      m.gpa = m._stpGpa == null ? null : Math.round(m._stpGpa * 10000) / 10000;
      m.assetGrowth = (i.assetGrowth != null && isFinite(i.assetGrowth)) ? Math.round(i.assetGrowth * 10000) / 10000 : null;
      m.netShareIssuance = (i.netShareIssuance != null && isFinite(i.netShareIssuance)) ? Math.round(i.netShareIssuance * 10000) / 10000 : null;
      m.effStp = m._stpEff == null ? null : Math.round(m._stpEff * 10000) / 10000;
      m.growthInput = m._stpGrowth == null ? null : Math.round(m._stpGrowth * 10000) / 10000;
      m.cohort = i.cohort || F.cohortKey;
    }
  }
  // --- consdisc_expansion (CORE) PRE-PASS: lift the 4 RAW axis inputs + shareCAGR from m.cd onto the member ---
  // All intermediates are CONSDISC-LOCAL → saas/fabless/medtech/dlst/industrials/staples member JSON
  // byte-identical (parity). The inverted axis (assetGrowthPenalty) stores the NEGATED raw, so the REL z
  // (higher = better) agrees in sign with the ABS q-input. null raw → axis DROP (coverage-renorm in
  // absKaliberConsDisc; REL sAxis returns 0=neutral for null). FOUR axes (no netIssuance axis); shareCAGR
  // feeds the POST-SUM dilution haircut, NOT a scored axis.
  if (F.consdisc) {
    for (const m of members) {
      const i = m.cd || {};
      m._cdGpa = (i.gpa != null && isFinite(i.gpa)) ? i.gpa : null;
      m._cdGrowth = (i.growth != null && isFinite(i.growth)) ? i.growth : null;            // deal-masked + cyc-floored UPSTREAM
      m._cdAssetGrowthPenalty = (i.assetGrowth != null && isFinite(i.assetGrowth)) ? -i.assetGrowth : null; // q(-AG) direction
      m._cdEff = (i.eff != null && isFinite(i.eff)) ? i.eff : null;
      m._cdShareCAGR = (i.shareCAGR != null && isFinite(i.shareCAGR)) ? i.shareCAGR : null; // dilution haircut input (NOT scored)
      // persisted audit fields (rounded)
      m.gpa = m._cdGpa == null ? null : Math.round(m._cdGpa * 10000) / 10000;
      m.assetGrowth = (i.assetGrowth != null && isFinite(i.assetGrowth)) ? Math.round(i.assetGrowth * 10000) / 10000 : null;
      m.shareCAGR = m._cdShareCAGR == null ? null : Math.round(m._cdShareCAGR * 10000) / 10000;
      m.effCd = m._cdEff == null ? null : Math.round(m._cdEff * 10000) / 10000;
      m.growthInput = m._cdGrowth == null ? null : Math.round(m._cdGrowth * 10000) / 10000;
      m.cohort = i.cohort || F.cohortKey;
    }
  }
  // --- materials_quality (CORE) PRE-PASS: lift the 5 RAW axis inputs from m.mt onto the member ---
  // All intermediates are MATERIALS-LOCAL → all other buckets' member JSON byte-identical (parity). The
  // inverted axes (assetGrowthPenalty/netIssuance) store the NEGATED raw, so the REL z (higher = better) agrees
  // in sign with the ABS q-input. marginStability is NOT inverted (higher=better directly). null raw → axis
  // DROP (coverage-renorm in absKaliberMaterials; REL sAxis returns 0=neutral for null). Mirrors the
  // industrials/staples pre-pass with the marginStability axis replacing eff.
  if (F.materials) {
    for (const m of members) {
      const i = m.mt || {};
      m._mtGpa = (i.gpa != null && isFinite(i.gpa)) ? i.gpa : null;
      m._mtMarginStability = (i.marginStability != null && isFinite(i.marginStability)) ? i.marginStability : null; // NOT inverted
      m._mtGrowth = (i.growth != null && isFinite(i.growth)) ? i.growth : null;          // deal-masked + spinoff-guarded UPSTREAM
      m._mtAssetGrowthPenalty = (i.assetGrowth != null && isFinite(i.assetGrowth)) ? -i.assetGrowth : null; // q(-AG) direction
      m._mtNetIssuance = (i.netShareIssuance != null && isFinite(i.netShareIssuance)) ? -i.netShareIssuance : null; // q(-NSI) direction
      // persisted audit fields (rounded)
      m.gpa = m._mtGpa == null ? null : Math.round(m._mtGpa * 10000) / 10000;
      m.marginStability = m._mtMarginStability == null ? null : Math.round(m._mtMarginStability * 10000) / 10000;
      m.assetGrowth = (i.assetGrowth != null && isFinite(i.assetGrowth)) ? Math.round(i.assetGrowth * 10000) / 10000 : null;
      m.netShareIssuance = (i.netShareIssuance != null && isFinite(i.netShareIssuance)) ? Math.round(i.netShareIssuance * 10000) / 10000 : null;
      m.growthInput = m._mtGrowth == null ? null : Math.round(m._mtGrowth * 10000) / 10000;
      m.cohort = i.cohort || F.cohortKey;
    }
  }
  // --- energy_quality (CORE) PRE-PASS: lift the 5 RAW axis inputs from m.en onto the member ---
  // All intermediates are ENERGY-LOCAL → all other buckets' member JSON byte-identical (parity). The inverted axes
  // (assetGrowthPenalty/netIssuance) store the NEGATED raw, so the REL z (higher = better) agrees in sign with the
  // ABS q-input. roce/fcfMargin/gpa are NOT inverted (higher=better directly). NO growth axis (QUALITY-ONLY). null
  // raw → axis DROP (coverage-renorm in absKaliberEnergy; REL sAxis returns 0=neutral for null). Mirrors the
  // materials pre-pass with roce/fcfMargin replacing gpa/marginStability as the lead axes.
  if (F.energy) {
    for (const m of members) {
      const i = m.en || {};
      m._enRoce = (i.roce != null && isFinite(i.roce)) ? i.roce : null;
      m._enFcfMargin = (i.fcfMargin != null && isFinite(i.fcfMargin)) ? i.fcfMargin : null;
      m._enGpa = (i.gpa != null && isFinite(i.gpa)) ? i.gpa : null;
      m._enAssetGrowthPenalty = (i.assetGrowth != null && isFinite(i.assetGrowth)) ? -i.assetGrowth : null; // q(-AG) direction
      m._enNetIssuance = (i.netShareIssuance != null && isFinite(i.netShareIssuance)) ? -i.netShareIssuance : null; // q(-NSI) direction
      // persisted audit fields (rounded)
      m.roce = m._enRoce == null ? null : Math.round(m._enRoce * 10000) / 10000;
      m.fcfMarginEn = m._enFcfMargin == null ? null : Math.round(m._enFcfMargin * 10000) / 10000;
      m.gpa = m._enGpa == null ? null : Math.round(m._enGpa * 10000) / 10000;
      m.assetGrowth = (i.assetGrowth != null && isFinite(i.assetGrowth)) ? Math.round(i.assetGrowth * 10000) / 10000 : null;
      m.netShareIssuance = (i.netShareIssuance != null && isFinite(i.netShareIssuance)) ? Math.round(i.netShareIssuance * 10000) / 10000 : null;
      m.cohort = i.cohort || F.cohortKey;
    }
  }
  // --- pharma_commercial (CORE) PRE-PASS: lift the 3 RAW axis inputs from m.ph onto the member ---
  // All intermediates are PHARMA-LOCAL → all other buckets' member JSON byte-identical (parity). NONE inverted
  // (growth/gm/eff are higher=better directly; no assetGrowth/netIssuance discipline axes — Vintage-A lacks
  // annualShares and the M&A signal is the upstream deal-mask on growth). null raw → axis DROP (coverage-renorm in
  // absKaliberPharma; REL sAxis returns 0=neutral for null). Mirrors the materials/energy pre-pass with {growth,
  // gm, eff} as the axes.
  if (F.pharma) {
    for (const m of members) {
      const i = m.ph || {};
      m._phGrowth = (i.growth != null && isFinite(i.growth)) ? i.growth : null;  // deal-masked + winsorized + spinoff-guarded UPSTREAM
      m._phGm = (i.gm != null && isFinite(i.gm)) ? i.gm : null;                  // null on a no-GP royalty name -> DROP
      m._phEff = (i.eff != null && isFinite(i.eff)) ? i.eff : null;             // FCF-margin primary, OpM fallback (precomputed upstream)
      // persisted audit fields (rounded)
      m.growthInput = m._phGrowth == null ? null : Math.round(m._phGrowth * 10000) / 10000;
      m.gmPharma = m._phGm == null ? null : Math.round(m._phGm * 10000) / 10000;
      m.effPharma = m._phEff == null ? null : Math.round(m._phEff * 10000) / 10000;
      m.cohort = i.cohort || F.cohortKey;
    }
  }
  // --- it_services (CORE) PRE-PASS: lift the 5 RAW axis inputs from m.it onto the member ---
  // All intermediates are IT-SERVICES-LOCAL → all other buckets' member JSON byte-identical (parity). gpa/fcfMargin/
  // opMargin/growth are NOT inverted (higher=better directly); netIssuance stores the NEGATED raw so the REL z
  // (higher=better) agrees in sign with the ABS q-input. null raw → axis DROP (coverage-renorm in absKaliberItServices;
  // REL sAxis returns 0=neutral for null). REVENUE-PER-EMPLOYEE is NOT lifted as a scored axis (§B.2 RPE inverted,
  // weight 0.00 — gate + advisory flag only). Mirrors the energy pre-pass with the it_services axis set.
  if (F.itservices) {
    for (const m of members) {
      const i = m.it || {};
      m._itGpa = (i.gpa != null && isFinite(i.gpa)) ? i.gpa : null;
      m._itFcfMargin = (i.fcfMargin != null && isFinite(i.fcfMargin)) ? i.fcfMargin : null;
      m._itOpMargin = (i.opMargin != null && isFinite(i.opMargin)) ? i.opMargin : null;
      m._itGrowth = (i.growth != null && isFinite(i.growth)) ? i.growth : null; // deal-masked + spinoff-guarded UPSTREAM
      m._itNetIssuance = (i.netShareIssuance != null && isFinite(i.netShareIssuance)) ? -i.netShareIssuance : null; // q(-NSI) direction
      // persisted audit fields (rounded)
      m.gpa = m._itGpa == null ? null : Math.round(m._itGpa * 10000) / 10000;
      m.fcfMarginIt = m._itFcfMargin == null ? null : Math.round(m._itFcfMargin * 10000) / 10000;
      m.opMarginIt = m._itOpMargin == null ? null : Math.round(m._itOpMargin * 10000) / 10000;
      m.growthInput = m._itGrowth == null ? null : Math.round(m._itGrowth * 10000) / 10000;
      m.netShareIssuance = (i.netShareIssuance != null && isFinite(i.netShareIssuance)) ? Math.round(i.netShareIssuance * 10000) / 10000 : null;
      m.revPerEmployee = (i.revPerEmployee != null && isFinite(i.revPerEmployee)) ? i.revPerEmployee : null; // §B.2 advisory only (NOT scored)
      m.cohort = i.cohort || F.cohortKey;
    }
  }
  // --- tech_hardware_quality (CORE) PRE-PASS: lift the 5 RAW axis inputs from m.thw onto the member ---
  // All intermediates are TECHHW-LOCAL → all other buckets' member JSON byte-identical (parity). gpa/fcfMargin/opMargin/
  // growth are NOT inverted (higher=better directly); netIssuance stores the NEGATED raw so the REL z (higher=better)
  // agrees in sign with the ABS q-input. null raw → axis DROP (coverage-renorm in absKaliberItServices; REL sAxis returns
  // 0=neutral for null). The SAME axis set as it_services (only the cohort NORMS differ). Mirrors the it_services pre-pass.
  if (F.techhw) {
    for (const m of members) {
      const i = m.thw || {};
      m._thwGpa = (i.gpa != null && isFinite(i.gpa)) ? i.gpa : null;
      m._thwFcfMargin = (i.fcfMargin != null && isFinite(i.fcfMargin)) ? i.fcfMargin : null;
      m._thwOpMargin = (i.opMargin != null && isFinite(i.opMargin)) ? i.opMargin : null;
      m._thwGrowth = (i.growth != null && isFinite(i.growth)) ? i.growth : null; // deal-masked + spinoff-guarded UPSTREAM
      m._thwNetIssuance = (i.netShareIssuance != null && isFinite(i.netShareIssuance)) ? -i.netShareIssuance : null; // q(-NSI) direction
      // persisted audit fields (rounded)
      m.gpa = m._thwGpa == null ? null : Math.round(m._thwGpa * 10000) / 10000;
      m.fcfMarginThw = m._thwFcfMargin == null ? null : Math.round(m._thwFcfMargin * 10000) / 10000;
      m.opMarginThw = m._thwOpMargin == null ? null : Math.round(m._thwOpMargin * 10000) / 10000;
      m.growthInput = m._thwGrowth == null ? null : Math.round(m._thwGrowth * 10000) / 10000;
      m.netShareIssuance = (i.netShareIssuance != null && isFinite(i.netShareIssuance)) ? Math.round(i.netShareIssuance * 10000) / 10000 : null;
      m.cohort = i.cohort || F.cohortKey;
    }
  }
  // --- financials_banks (CORE) PRE-PASS: lift the 4 RAW axis inputs from m.bk onto the member ---
  // All intermediates are BANKS-LOCAL → all other buckets' member JSON byte-identical (parity). roaThruCycle/
  // capitalAdequacy/earningsDurability are NOT inverted (higher=better directly); assetGrowthDiscipline stores the
  // NEGATED raw assetGrowthYoY so the REL z (higher=better) AGREES IN SIGN with the ABS penalty q-input (zero/negative
  // asset growth = best). null raw → axis DROP (coverage-renorm in absKaliberBanks; REL sAxis returns 0=neutral for
  // null). The capitalAdequacy NULL case (~45% of the pool incl. JPM/WFC/PNC) is the load-bearing DROP path. FCF/OCF
  // are NEVER lifted (not bank axes). Mirrors the energy pre-pass with the banks axis set.
  if (F.banks) {
    for (const m of members) {
      const i = m.bk || {};
      m._bkRoa = (i.roaThruCycle != null && isFinite(i.roaThruCycle)) ? i.roaThruCycle : null;
      m._bkCapAdequacy = (i.capitalAdequacy != null && isFinite(i.capitalAdequacy)) ? i.capitalAdequacy : null;       // null -> DROP+renorm (CAPADEQ_DROPPED)
      m._bkAssetGrowthDisc = (i.assetGrowthYoY != null && isFinite(i.assetGrowthYoY)) ? -i.assetGrowthYoY : null;     // q(-AG) direction (penalty)
      m._bkEarningsDurability = (i.earningsDurability != null && isFinite(i.earningsDurability)) ? i.earningsDurability : null;
      // persisted audit fields (rounded)
      m.roaThruCycle = m._bkRoa == null ? null : Math.round(m._bkRoa * 10000) / 10000;
      m.capitalAdequacy = m._bkCapAdequacy == null ? null : Math.round(m._bkCapAdequacy * 10000) / 10000;
      m.assetGrowthYoY = (i.assetGrowthYoY != null && isFinite(i.assetGrowthYoY)) ? Math.round(i.assetGrowthYoY * 10000) / 10000 : null;
      m.earningsDurability = m._bkEarningsDurability == null ? null : Math.round(m._bkEarningsDurability * 10000) / 10000;
      m.cohort = i.cohort || F.cohortKey;
    }
  }
  // --- equity_reits (CORE) PRE-PASS: lift the 4 RAW axis inputs from m.re onto the member ---
  // All intermediates are REITS-LOCAL → all other buckets' member JSON byte-identical (parity). opMargin/ffoAssets/
  // revG3 are NOT inverted (higher=better directly); ndGAdisc stores the NEGATED raw net-debt/assets so the REL z
  // (higher=better) AGREES IN SIGN with the ABS inverted q-input (lower net-debt/assets = best). null raw → axis DROP
  // (coverage-renorm in absKaliberReits; REL sAxis returns 0=neutral for null). The ffoAssets NULL case (~52% of the
  // pool incl. the top-tier VICI/O/PLD/TRNO lacking annualDepreciation) is the load-bearing DROP path. The FFO-gains
  // guard already capped the ffoAssets observation UPSTREAM (court revision #2). Mirrors the banks pre-pass.
  if (F.reits) {
    for (const m of members) {
      const i = m.re || {};
      m._reOpMargin = (i.opMargin != null && isFinite(i.opMargin)) ? i.opMargin : null;
      m._reFfoAssets = (i.ffoAssets != null && isFinite(i.ffoAssets)) ? i.ffoAssets : null;       // null -> DROP+renorm (FFO_COVERAGE_PARTIAL)
      m._reRevG3 = (i.revG3 != null && isFinite(i.revG3)) ? i.revG3 : null;
      m._reNdGADisc = (i.ndGA != null && isFinite(i.ndGA)) ? -i.ndGA : null;                       // q(-ndGA) direction (inverted leverage discipline)
      // persisted audit fields (rounded)
      m.opMarginReit = m._reOpMargin == null ? null : Math.round(m._reOpMargin * 10000) / 10000;
      m.ffoAssets = m._reFfoAssets == null ? null : Math.round(m._reFfoAssets * 10000) / 10000;
      m.revG3 = m._reRevG3 == null ? null : Math.round(m._reRevG3 * 10000) / 10000;
      m.netDebtToAssets = (i.ndGA != null && isFinite(i.ndGA)) ? Math.round(i.ndGA * 10000) / 10000 : null;
      m.cohort = i.cohort || F.cohortKey;
    }
  }
  // --- capmkt_fee_core (CORE) PRE-PASS: lift the 4 RAW axis inputs from m.cm onto the member ---
  // All intermediates are CAPMKT-LOCAL → all other buckets' member JSON byte-identical (parity). opMargin/
  // opMarginStability/fcfMargin are NOT inverted (higher=better directly); netIssuanceDisc stores the NEGATED raw
  // net-share-issuance so the REL z (higher=better) AGREES IN SIGN with the ABS inverted q-input (buyback = best).
  // null raw → axis DROP (coverage-renorm in absKaliberCapmkt; REL sAxis returns 0=neutral for null). The netIssuance
  // NULL case (~54% of the pool lacking annualShares) is the load-bearing DROP path. Mirrors the it_services pre-pass.
  if (F.capmkt) {
    for (const m of members) {
      const i = m.cm || {};
      m._cmOpMargin = (i.opMargin != null && isFinite(i.opMargin)) ? i.opMargin : null;
      m._cmOpMarginStability = (i.opMarginStability != null && isFinite(i.opMarginStability)) ? i.opMarginStability : null;
      m._cmFcfMargin = (i.fcfMargin != null && isFinite(i.fcfMargin)) ? i.fcfMargin : null;
      m._cmNetIssuanceDisc = (i.netIssuance != null && isFinite(i.netIssuance)) ? -i.netIssuance : null;   // q(-NSI) direction
      // persisted audit fields (rounded)
      m.opMarginCapmkt = m._cmOpMargin == null ? null : Math.round(m._cmOpMargin * 10000) / 10000;
      m.opMarginStability = m._cmOpMarginStability == null ? null : Math.round(m._cmOpMarginStability * 10000) / 10000;
      m.fcfMarginCapmkt = m._cmFcfMargin == null ? null : Math.round(m._cmFcfMargin * 10000) / 10000;
      m.netShareIssuance = (i.netIssuance != null && isFinite(i.netIssuance)) ? Math.round(i.netIssuance * 10000) / 10000 : null;
      m.cohort = i.cohort || F.cohortKey;
    }
  }

  // Roh-Achswerte für Stats (cross-sectional Median/MAD): nutze winsorisierte Werte
  // For medtech growth: use _growthMedtech (Fix D organic + winsorize at 1.0) for Stats AND scoring (Fix D
  // ersetzt den separaten _growthMedtechAdj-Discount-Pfad; beide sind nun identisch = organic-winsorized).
  // industrials axis-key -> member field (REL z/MAD reads the SAME signed values as the ABS q-input).
  const indRaw = (m, key) => {
    switch (key) {
      case 'gpa': return m._indGpa;
      case 'growth': return m._indGrowth;
      case 'assetGrowthPenalty': return m._indAssetGrowthPenalty;
      case 'netIssuance': return m._indNetIssuance;
      case 'eff': return m._indEff;
      default: return m[key];
    }
  };
  // consumer_staples_compounder (CORE): same 5 axis-keys as industrials → mirror indRaw on the m._stp* fields.
  const stpRaw = (m, key) => {
    switch (key) {
      case 'gpa': return m._stpGpa;
      case 'growth': return m._stpGrowth;
      case 'assetGrowthPenalty': return m._stpAssetGrowthPenalty;
      case 'netIssuance': return m._stpNetIssuance;
      case 'eff': return m._stpEff;
      default: return m[key];
    }
  };
  // consdisc_expansion (CORE): FOUR axis-keys (no netIssuance) → mirror indRaw/stpRaw on the m._cd* fields.
  const cdRaw = (m, key) => {
    switch (key) {
      case 'gpa': return m._cdGpa;
      case 'growth': return m._cdGrowth;
      case 'assetGrowthPenalty': return m._cdAssetGrowthPenalty;
      case 'eff': return m._cdEff;
      default: return m[key];
    }
  };
  // materials_quality (CORE): 5 axis-keys, axis C = marginStability (NOT eff) → mirror indRaw on the m._mt* fields.
  const mtRaw = (m, key) => {
    switch (key) {
      case 'gpa': return m._mtGpa;
      case 'marginStability': return m._mtMarginStability;
      case 'growth': return m._mtGrowth;
      case 'assetGrowthPenalty': return m._mtAssetGrowthPenalty;
      case 'netIssuance': return m._mtNetIssuance;
      default: return m[key];
    }
  };
  // energy_quality (CORE): 5 axis-keys, axis B = roce, axis C = fcfMargin (NOT eff/marginStability), NO growth axis
  // → mirror indRaw on the m._en* fields. The REL z/MAD reads the SAME signed values as the ABS q-input.
  const enRaw = (m, key) => {
    switch (key) {
      case 'roce': return m._enRoce;
      case 'fcfMargin': return m._enFcfMargin;
      case 'gpa': return m._enGpa;
      case 'assetGrowthPenalty': return m._enAssetGrowthPenalty;
      case 'netIssuance': return m._enNetIssuance;
      default: return m[key];
    }
  };
  // pharma_commercial (CORE): 3 axis-keys {growth, gm, eff} (NONE inverted) → mirror indRaw on the m._ph* fields.
  // The REL z/MAD reads the SAME signed values as the ABS q-input (higher=better directly).
  const phRaw = (m, key) => {
    switch (key) {
      case 'growth': return m._phGrowth;
      case 'gm': return m._phGm;
      case 'eff': return m._phEff;
      default: return m[key];
    }
  };
  // it_services (CORE): 5 axis-keys {gpa, fcfMargin, opMargin, growth, netIssuance}; gpa/fcfMargin/opMargin/growth
  // NON-inverted, netIssuance inverted (stored negated in m._itNetIssuance) → mirror enRaw on the m._it* fields. The
  // REL z/MAD reads the SAME signed values as the ABS q-input.
  const itRaw = (m, key) => {
    switch (key) {
      case 'gpa': return m._itGpa;
      case 'fcfMargin': return m._itFcfMargin;
      case 'opMargin': return m._itOpMargin;
      case 'growth': return m._itGrowth;
      case 'netIssuance': return m._itNetIssuance;
      default: return m[key];
    }
  };
  // tech_hardware_quality (CORE): 5 axis-keys {gpa, fcfMargin, opMargin, growth, netIssuance}; gpa/fcfMargin/opMargin/
  // growth NON-inverted, netIssuance inverted (stored negated in m._thwNetIssuance) → mirror itRaw on the m._thw* fields.
  // The REL z/MAD reads the SAME signed values as the ABS q-input.
  const thwRaw = (m, key) => {
    switch (key) {
      case 'gpa': return m._thwGpa;
      case 'fcfMargin': return m._thwFcfMargin;
      case 'opMargin': return m._thwOpMargin;
      case 'growth': return m._thwGrowth;
      case 'netIssuance': return m._thwNetIssuance;
      default: return m[key];
    }
  };
  // financials_banks (CORE): 4 axis-keys {roaThruCycle, capitalAdequacy, assetGrowthDisc, earningsDurability};
  // roaThruCycle/capitalAdequacy/earningsDurability NON-inverted, assetGrowthDisc inverted (stored negated in
  // m._bkAssetGrowthDisc) → mirror enRaw/itRaw on the m._bk* fields. The REL z/MAD reads the SAME signed values as
  // the ABS q-input.
  const bkRaw = (m, key) => {
    switch (key) {
      case 'roaThruCycle': return m._bkRoa;
      case 'capitalAdequacy': return m._bkCapAdequacy;
      case 'assetGrowthDisc': return m._bkAssetGrowthDisc;
      case 'earningsDurability': return m._bkEarningsDurability;
      default: return m[key];
    }
  };
  // equity_reits (CORE): 4 axis-keys {opMargin, ffoAssets, revG3, ndGAdisc}; opMargin/ffoAssets/revG3 NON-inverted,
  // ndGAdisc inverted (stored negated in m._reNdGADisc) → mirror bkRaw on the m._re* fields. The REL z/MAD reads the
  // SAME signed values as the ABS q-input.
  const reRaw = (m, key) => {
    switch (key) {
      case 'opMargin': return m._reOpMargin;
      case 'ffoAssets': return m._reFfoAssets;
      case 'revG3': return m._reRevG3;
      case 'ndGAdisc': return m._reNdGADisc;
      default: return m[key];
    }
  };
  // capmkt_fee_core (CORE): 4 axis-keys {opMargin, opMarginStability, fcfMargin, netIssuanceDisc}; opMargin/
  // opMarginStability/fcfMargin NON-inverted, netIssuanceDisc inverted (stored negated in m._cmNetIssuanceDisc) →
  // mirror reRaw on the m._cm* fields. The REL z/MAD reads the SAME signed values as the ABS q-input.
  const cmRaw = (m, key) => {
    switch (key) {
      case 'opMargin': return m._cmOpMargin;
      case 'opMarginStability': return m._cmOpMarginStability;
      case 'fcfMargin': return m._cmFcfMargin;
      case 'netIssuanceDisc': return m._cmNetIssuanceDisc;
      default: return m[key];
    }
  };
  const rawOfStats = (m, key) => {
    if (F.industrials) return indRaw(m, key);
    if (F.staples) return stpRaw(m, key);
    if (F.consdisc) return cdRaw(m, key);
    if (F.materials) return mtRaw(m, key);
    if (F.energy) return enRaw(m, key);
    if (F.pharma) return phRaw(m, key);
    if (F.itservices) return itRaw(m, key);
    if (F.techhw) return thwRaw(m, key);
    if (F.banks) return bkRaw(m, key);
    if (F.reits) return reRaw(m, key);
    if (F.capmkt) return cmRaw(m, key);
    if (key === 'growth') return bucket === 'medtech_devices' ? m._growthMedtech : (bucket === 'diagnostics_lst' ? m._growthDlst : m._growth);
    if (key === 'effDlst') return m._effDlst;
    if (key === 'capexNeg') return m._capexNeg;
    if (key === 'accel') return m._accel;
    return m[key];
  };
  const rawOf = (m, key) => {
    if (F.industrials) return indRaw(m, key);
    if (F.staples) return stpRaw(m, key);
    if (F.consdisc) return cdRaw(m, key);
    if (F.materials) return mtRaw(m, key);
    if (F.energy) return enRaw(m, key);
    if (F.pharma) return phRaw(m, key);
    if (F.itservices) return itRaw(m, key);
    if (F.techhw) return thwRaw(m, key);
    if (F.banks) return bkRaw(m, key);
    if (F.reits) return reRaw(m, key);
    if (F.capmkt) return cmRaw(m, key);
    if (key === 'growth') return bucket === 'medtech_devices' ? m._growthMedtechAdj : (bucket === 'diagnostics_lst' ? m._growthDlst : m._growth);
    if (key === 'effDlst') return m._effDlst;
    if (key === 'capexNeg') return m._capexNeg;
    if (key === 'accel') return m._accel;
    return m[key];
  };

  // audit COURT-1 (disclosed limitation): these cross-sectional anchors (median/MAD below, and the per-axis
  // sAxis z-scoring at the scoring loop) are computed on ONE source-MIXED pooled value per axis — the growth/
  // accel inputs (rawOfStats/rawOf) pool annual + quarterly growth and acceleration into a single number; this
  // code never reads growthSource/accelSource to partition the anchors. The court-screen.js:294-296 comment
  // promises Schritt-2 computes anchors PER growthSource/accelSource — that per-source partitioning is
  // ASPIRATIONAL / NOT YET IMPLEMENTED here (it would require a court re-run). Anchors are pooled, not per-source.
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

  // audit COURT-4: bucket-local map ticker -> {axisName: full-precision s}. Kept OFF the member objects so it
  // is never serialized into court-results.json (member JSON stays byte-identical to the parity baselines);
  // only the collapse-reweight backstop consumes it, to recompute core from full-precision (not 2-dp) axis values.
  const axisSrawByTicker = new Map();
  // Score je Mitglied
  for (const m of members) {
    // Membership-Gate
    // v1.2 Fix B (ALMR LEAK FIX): Für MEDTECH nutzt das Membership-Growth-Gate die WINSORISIERTE/organische
    // Growth (_growthMedtech, cap 1.0) statt RAW growth — sonst leakt ALMR mit RAW 195% trotz $74M-Mini-Scale
    // einen hohen Gate-Wert. Nicht-Medtech: unverändert RAW m.growth (Parität SaaS/Fabless).
    // industrials membership (CORE): the asset-intensity cohort split + the $1B classifier gate already define
    // the universe; membership here is the gpa(quality)×growth×scale logistic, with gpa standing in for the gm
    // pillar (industrials has no gm axis). Pre-revenue names (gpa/growth null) land Borderline/Out honestly.
    let M;
    if (F.industrials) {
      const gGate = m._indGrowth != null ? m._indGrowth : -1;           // null growth (spinoff/NOT_READY) → low
      const gpaGate = m._indGpa != null ? m._indGpa : -1;               // null gpa (pre-revenue) → low
      const scaleM = (m.marketCap != null && isFinite(m.marketCap)) ? m.marketCap / 1e6 : (m.scaleRevM || 1); // $1B+ marketCap
      const mg = logistic(gGate, F.membership.g.c, F.membership.g.s);
      const mGpa = logistic(gpaGate, F.membership.gm.c, F.membership.gm.s);
      const mSc = logistic(log10(Math.max(scaleM, 1)), F.membership.scaleLog.c, F.membership.scaleLog.s);
      M = mg * mGpa * mSc;
    } else if (F.staples) {
      // staples membership: same gpa(quality)×growth×scale logistic as industrials (gpa stands in for the gm
      // pillar — staples has no gm axis). Spin-off-guarded/NOT_READY growth or pre-revenue gpa land low.
      const gGate = m._stpGrowth != null ? m._stpGrowth : -1;           // null growth (spinoff/NOT_READY) → low
      const gpaGate = m._stpGpa != null ? m._stpGpa : -1;               // null gpa → low
      const scaleM = (m.marketCap != null && isFinite(m.marketCap)) ? m.marketCap / 1e6 : (m.scaleRevM || 1); // $1B+ marketCap
      const mg = logistic(gGate, F.membership.g.c, F.membership.g.s);
      const mGpa = logistic(gpaGate, F.membership.gm.c, F.membership.gm.s);
      const mSc = logistic(log10(Math.max(scaleM, 1)), F.membership.scaleLog.c, F.membership.scaleLog.s);
      M = mg * mGpa * mSc;
    } else if (F.consdisc) {
      // consdisc membership: same gpa(quality)×growth×scale logistic as industrials/staples (gpa stands in for
      // the gm pillar — consdisc has no gm axis; gm membership center is the cohort gpa.floor). Deal-masked/
      // NOT_READY growth or pre-revenue gpa land low. $1B+ marketCap is the classifier gate.
      const gGate = m._cdGrowth != null ? m._cdGrowth : -1;             // null growth (NOT_READY) → low
      const gpaGate = m._cdGpa != null ? m._cdGpa : -1;                 // null gpa → low
      const scaleM = (m.marketCap != null && isFinite(m.marketCap)) ? m.marketCap / 1e6 : (m.scaleRevM || 1); // $1B+ marketCap
      const mg = logistic(gGate, F.membership.g.c, F.membership.g.s);
      const mGpa = logistic(gpaGate, F.membership.gm.c, F.membership.gm.s);
      const mSc = logistic(log10(Math.max(scaleM, 1)), F.membership.scaleLog.c, F.membership.scaleLog.s);
      M = mg * mGpa * mSc;
    } else if (F.materials) {
      // materials membership: GP/assets(quality) × scale logistic. GROWTH IS NOT A MEMBERSHIP INPUT
      // (QUALITY-ONLY — mirrors the energy_quality remediation: a commodity-cyclical's revenue growth is
      // commodity-β, never a quality signal; gating the headline on growth is PRO-CYCLICAL and inverts the
      // bucket's own quality-only absKaliber, dropping high-absKaliber through-cycle compounders off the
      // headline while admitting peak-cycle names). The gpa pillar (gm membership center = cohort gpa.floor)
      // stands in as the quality gate. $1B+ marketCap is the classifier gate. marginStability is NOT a
      // membership input (a scored axis only).
      // audit/fix (re-court materials headline-inversion 2026-06-23): removed the growth factor (mg) from M —
      // membership is now QUALITY-ONLY (gpa×scale), exactly as energy_quality was already remediated.
      const gpaGate = m._mtGpa != null ? m._mtGpa : -1;                 // null gpa → low
      const scaleM = (m.marketCap != null && isFinite(m.marketCap)) ? m.marketCap / 1e6 : (m.scaleRevM || 1); // $1B+ marketCap
      const mGpa = logistic(gpaGate, F.membership.gm.c, F.membership.gm.s);
      const mSc = logistic(log10(Math.max(scaleM, 1)), F.membership.scaleLog.c, F.membership.scaleLog.s);
      M = mGpa * mSc;
    } else if (F.energy) {
      // energy membership: ROCE(quality) × FCF-positivity × scale logistic. GROWTH IS NOT A MEMBERSHIP INPUT
      // (QUALITY-ONLY — a commodity-cyclical's revenue growth is commodity-β, never a quality signal). The
      // through-cycle ROCE pillar stands in for the gm pillar (gm membership center is the cohort roce.floor);
      // a positive-FCF gate replaces the growth gate (the discipline read). Pre-revenue/NOT_READY roce lands low.
      // $1B+ marketCap is the classifier gate. gpa/assetGrowth are NOT membership inputs (scored axes only).
      const roceGate = m._enRoce != null ? m._enRoce : -1;             // null roce (NOT_READY/pre-rev) → low
      const fcfGate = m._enFcfMargin != null ? m._enFcfMargin : -1;    // null fcf → low (the discipline gate, replaces growth)
      const scaleM = (m.marketCap != null && isFinite(m.marketCap)) ? m.marketCap / 1e6 : (m.scaleRevM || 1); // $1B+ marketCap
      const mRoce = logistic(roceGate, F.membership.gm.c, F.membership.gm.s);   // quality pillar (roce.floor center)
      const mFcf = logistic(fcfGate, F.membership.g.c, F.membership.g.s);       // FCF-positivity (>=0 center)
      const mSc = logistic(log10(Math.max(scaleM, 1)), F.membership.scaleLog.c, F.membership.scaleLog.s);
      M = mRoce * mFcf * mSc;
    } else if (F.pharma) {
      // pharma membership: gm(quality) × growth × scale logistic (pharma HAS a gm axis, unlike industrials/energy).
      // The gm pillar is the cohort gm.floor center; the growth gate uses the deal-masked/winsorized _phGrowth
      // (a cliff-collapsing name reads its genuine negative organic rate → lands low/Borderline = correct). A
      // NOT_READY:growth name (fully-deal-masked acquirer like CPRX) reads -1 → low membership BUT still scored on
      // gm+eff (coverage-renorm) — membership-Out only suppresses the headline rank, never the absKaliber. $1B+
      // marketCap is the classifier gate. The §1.4 commercial gate already ran in the classifier.
      const gGate = m._phGrowth != null ? m._phGrowth : -1;            // null growth (NOT_READY) → low
      const gmGate = m._phGm != null ? m._phGm : -1;                   // null gm (no-GP royalty) → low
      const scaleM = (m.marketCap != null && isFinite(m.marketCap)) ? m.marketCap / 1e6 : (m.scaleRevM || 1); // $1B+ marketCap
      const mg = logistic(gGate, F.membership.g.c, F.membership.g.s);
      const mGM = logistic(gmGate, F.membership.gm.c, F.membership.gm.s);
      const mSc = logistic(log10(Math.max(scaleM, 1)), F.membership.scaleLog.c, F.membership.scaleLog.s);
      M = mg * mGM * mSc;
    } else if (F.itservices) {
      // it_services membership: gpa(quality) × growth × scale logistic (gpa is the asset-light low-capital-
      // compounding quality pillar — it stands in for the gm pillar; gm membership center is the gpa.floor). The
      // growth gate uses the deal-masked _itGrowth (a NOT_READY:growth fully-deal-masked acquirer reads -1 → low
      // membership BUT still scored on gpa/fcfMargin/opMargin/netIssuance via coverage-renorm — membership-Out only
      // suppresses the headline rank, never the absKaliber). $1B+ marketCap is the classifier gate; the contamination
      // gate already ran in the classifier. opMargin/fcfMargin/netIssuance are NOT membership inputs (scored axes only).
      const gGate = m._itGrowth != null ? m._itGrowth : -1;            // null growth (NOT_READY/spinoff) → low
      const gpaGate = m._itGpa != null ? m._itGpa : -1;                // null gpa → low
      const scaleM = (m.marketCap != null && isFinite(m.marketCap)) ? m.marketCap / 1e6 : (m.scaleRevM || 1); // $1B+ marketCap
      const mg = logistic(gGate, F.membership.g.c, F.membership.g.s);
      const mGpa = logistic(gpaGate, F.membership.gm.c, F.membership.gm.s);
      const mSc = logistic(log10(Math.max(scaleM, 1)), F.membership.scaleLog.c, F.membership.scaleLog.s);
      M = mg * mGpa * mSc;
    } else if (F.techhw) {
      // tech_hardware_quality membership: gpa(quality) × scale logistic. GROWTH IS NOT A MEMBERSHIP INPUT
      // (QUALITY-ONLY — mirrors the materials/energy remediation: a hardware-franchise's recent revenue growth is
      // a cyclical/deal-driven signal, never a durable-quality signal; gating membership/exclusion on growth is
      // PRO-CYCLICAL and inverts the bucket's own quality-only absKaliber, dropping high-absKaliber franchises to
      // score=null/excluded[] for a negative RECENT print). The gpa pillar is the franchise-quality gate (gm
      // membership center is the gpa.floor .10). $1B+ marketCap is the classifier gate. opMargin/fcfMargin/
      // netIssuance/growth are NOT membership inputs (scored axes only).
      // audit/fix (re-court tech_hardware headline-inversion 2026-06-23): removed the growth factor (mg) from M —
      // membership is now QUALITY-ONLY (gpa×scale), exactly as materials/energy were already remediated. A down-year
      // cyclical franchise (ONTO/ACLS) or a SPINOFF franchise (FTV: Ralliant spinoff gave a -33% latest-year print)
      // is now SCORED (growth axis q naturally contributes low → lower score), with score=null/excluded[] RESERVED
      // for OUT-OF-CLASS / shell only. The absKaliber floor (THW_ABSK_FLOOR) then decides headline status on merit.
      const gpaGate = m._thwGpa != null ? m._thwGpa : -1;              // null gpa → low
      const scaleM = (m.marketCap != null && isFinite(m.marketCap)) ? m.marketCap / 1e6 : (m.scaleRevM || 1); // $1B+ marketCap
      const mGpa = logistic(gpaGate, F.membership.gm.c, F.membership.gm.s);
      const mSc = logistic(log10(Math.max(scaleM, 1)), F.membership.scaleLog.c, F.membership.scaleLog.s);
      M = mGpa * mSc;
    } else if (F.banks) {
      // financials_banks membership: roaThruCycle(quality) × scale logistic. QUALITY-ONLY (mirrors materials/energy):
      // banks have NO revenue/gm line, so there is no growth or gm membership input — the through-cycle ROA pillar
      // stands in for the quality gate (gm membership center is the roaThruCycle.floor, .007), and capitalAdequacy is
      // NOT a membership input (it is NULL on the marquees JPM/WFC/PNC/USB — gating on it would wrongly knock them
      // Out). $1B+ marketCap is the classifier gate. A NOT_READY:roa shell (MCHB) reads -1 → low membership, but the
      // SHELL SI-4 gate is what actually excludes it (membership-Out only suppresses the headline rank, never absKaliber).
      const roaGate = m._bkRoa != null ? m._bkRoa : -1;                 // null roa (shell) → low
      const scaleM = (m.marketCap != null && isFinite(m.marketCap)) ? m.marketCap / 1e6 : (m.scaleRevM || 1); // $1B+ marketCap
      const mRoa = logistic(roaGate, F.membership.gm.c, F.membership.gm.s);   // quality pillar (roaThruCycle.floor center)
      const mSc = logistic(log10(Math.max(scaleM, 1)), F.membership.scaleLog.c, F.membership.scaleLog.s);
      M = mRoa * mSc;
    } else if (F.reits) {
      // equity_reits membership: opMargin(quality) × scale logistic. QUALITY-ONLY (mirrors banks/materials/energy):
      // REITs have NO revenue-growth membership gate (revG3 is a scored axis, not a gate — a low-growth triple-net is
      // still high quality), so the NOI-margin pillar stands in for the quality gate (gm membership center is the
      // opMargin.floor, .08). ffoAssets is NOT a membership input (it is NULL on the top-tier VICI/O/PLD/TRNO — gating
      // on it would wrongly knock them Out). $1B+ marketCap is the classifier gate. A shell (opMargin null) reads -1 →
      // low membership, but the economic SHELL SI-4 gate is what actually excludes it (membership-Out only suppresses
      // the headline rank, never absKaliber).
      const opGate = m._reOpMargin != null ? m._reOpMargin : -1;        // null opMargin (shell) → low
      const scaleM = (m.marketCap != null && isFinite(m.marketCap)) ? m.marketCap / 1e6 : (m.scaleRevM || 1); // $1B+ marketCap
      const mOp = logistic(opGate, F.membership.gm.c, F.membership.gm.s);     // quality pillar (opMargin.floor center)
      const mSc = logistic(log10(Math.max(scaleM, 1)), F.membership.scaleLog.c, F.membership.scaleLog.s);
      M = mOp * mSc;
    } else if (F.capmkt) {
      // capmkt_fee_core membership: opMargin(quality) × scale logistic. QUALITY-ONLY (mirrors banks/reits): fee
      // businesses have no growth membership gate — the operating-margin pillar stands in for the quality gate (gm
      // membership center is the opMargin.floor, -.22). opMarginStability/fcfMargin are NOT membership inputs (a name
      // can be null on either via coverage-renorm). $1B+ marketCap is the classifier gate. A shell (opMargin null AND
      // fcfMargin null) reads -1 → low membership, but the economic SHELL SI-4 gate is what actually excludes it
      // (membership-Out only suppresses the headline rank, never absKaliber). A BDC with opMargin null but fcfMargin
      // present (OCSL) reads -1 here → membership-Out (off the headline shortlist) but still SCORED on its other axes.
      const opGate = m._cmOpMargin != null ? m._cmOpMargin : -1;        // null opMargin → low
      const scaleM = (m.marketCap != null && isFinite(m.marketCap)) ? m.marketCap / 1e6 : (m.scaleRevM || 1); // $1B+ marketCap
      const mOp = logistic(opGate, F.membership.gm.c, F.membership.gm.s);     // quality pillar (opMargin.floor center)
      const mSc = logistic(log10(Math.max(scaleM, 1)), F.membership.scaleLog.c, F.membership.scaleLog.s);
      M = mOp * mSc;
    } else {
      const mGate = (bucket === 'medtech_devices' && m._growthMedtech != null) ? m._growthMedtech
                  : (bucket === 'diagnostics_lst' && m._growthDlst != null) ? m._growthDlst
                  : m.growth;
      const mg = logistic(mGate, F.membership.g.c, F.membership.g.s);
      const mGM = logistic(m.gm, F.membership.gm.c, F.membership.gm.s);
      const mSc = logistic(log10(Math.max(m.scaleRevM, 1)), F.membership.scaleLog.c, F.membership.scaleLog.s);
      M = mg * mGM * mSc;
    }
    m.membership = Math.round(M * 100) / 100;
    m.membershipClass = M >= 0.66 ? 'In' : M >= 0.20 ? 'Borderline' : 'Out';

    // Achsen
    m._a2 = statsA2 ? computeA2Forward(maRpoByTicker.get(m.ticker), statsA2) : null;
    // D&LST: die z/MAD-Anker kommen aus der Kohorte des Members (dx vs dx, tools vs tools), nicht gepoolt.
    const axStats = (F.cohortAware && statsByCohort[m._cohort]) ? statsByCohort[m._cohort] : stats;
    let core = 0; m.axisS = {};
    // audit COURT-4: full-precision s cached in a parallel map NOT attached to m (so it is never serialized
    // into court-results.json → member JSON stays byte-identical to the parity baselines). The collapse-
    // reweight backstop (below) reads axisSraw instead of the 2-dp display axisS to avoid leaking rounding error.
    const axisSraw = {}; axisSrawByTicker.set(m.ticker, axisSraw);
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
      axisSraw[ax.name] = s; // audit COURT-4: full-precision s for the collapse-reweight backstop (axisS below is 2-dp DISPLAY only, NOT serialized)
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
    } else if (F.industrials) {
      // industrials_compounder (CORE): absKaliberIndustrials = 5-axis weighted-q with COVERAGE-RENORM reading
      // the cohort NORMS (the load-bearing renorm fires on ~57% of names lacking annualShares + GE-type spinoffs).
      const cohortNorm = F.cohortKey; // 'industrials_heavy' | 'industrials_light'
      const indRec = {
        gpa: m._indGpa, growth: m._indGrowth,
        assetGrowth: (m.ind && m.ind.assetGrowth != null && isFinite(m.ind.assetGrowth)) ? m.ind.assetGrowth : null,
        netShareIssuance: (m.ind && m.ind.netShareIssuance != null && isFinite(m.ind.netShareIssuance)) ? m.ind.netShareIssuance : null,
        eff: m._indEff,
      };
      const ak = absKaliberIndustrials(indRec, cohortNorm);
      m.absKaliber = Math.round(ak.absK * 1000) / 1000;
      m.absUsedAxes = ak.usedAxes;          // audit: which axes survived coverage-renorm
      m.absDroppedAxes = ak.droppedAxes;    // audit: NOT_READY/ISSUANCE/SPINOFF drops
      const rawScore = Math.round(Math.max(0, blendScore(ak.absK, core, 0.6)) * 10) / 10; // pDil=0 (issuance is a SCORED axis)
      // SI-1 shortlist-cut (Spec §6.1): growthInput >= growth.floor (0.00) AND gpa >= gpa.floor (cohort) AND
      // efficiency floor met. A spin-off-guarded/NOT_READY growth or missing gpa fails the floor (not the gate
      // crashing) → belowAbsoluteFloor, listed but off the shortlist. NOT a score-kill (REL/score path runs).
      const norm = NORMS[cohortNorm];
      const gateGrowthOk = (m._indGrowth != null) && (m._indGrowth >= norm.growth.floor);
      const gateGpaOk = (m._indGpa != null) && (m._indGpa >= norm.gpa.floor);
      const gateEffOk = (m._indEff != null) && (m._indEff >= norm.eff.floor);
      m.belowAbsoluteFloor = !(gateGrowthOk && gateGpaOk && gateEffOk);
      m.score = m.membershipClass === 'Out' ? null : rawScore;
      m.headlineShortlist = (m.membershipClass !== 'Out') && !m.belowAbsoluteFloor;
      m.stage = stageOf(F, m.fcfMargin);
    } else if (F.staples) {
      // consumer_staples_compounder (CORE): absKaliberStaples = 5-axis weighted-q with COVERAGE-RENORM reading
      // the cohort NORMS (the load-bearing renorm fires on the ~58% of names lacking annualShares + KVUE-type spinoffs).
      const cohortNorm = F.cohortKey; // 'staples_branded' | 'staples_distribution'
      const stpRec = {
        gpa: m._stpGpa, growth: m._stpGrowth,
        assetGrowth: (m.stp && m.stp.assetGrowth != null && isFinite(m.stp.assetGrowth)) ? m.stp.assetGrowth : null,
        netShareIssuance: (m.stp && m.stp.netShareIssuance != null && isFinite(m.stp.netShareIssuance)) ? m.stp.netShareIssuance : null,
        eff: m._stpEff,
      };
      const ak = absKaliberStaples(stpRec, cohortNorm);
      m.absKaliber = Math.round(ak.absK * 1000) / 1000;
      m.absUsedAxes = ak.usedAxes;          // audit: which axes survived coverage-renorm
      m.absDroppedAxes = ak.droppedAxes;    // audit: NOT_READY/ISSUANCE/SPINOFF drops
      const rawScore = Math.round(Math.max(0, blendScore(ak.absK, core, 0.6)) * 10) / 10; // pDil=0 (issuance is a SCORED axis)
      // SI-1 shortlist-cut (Spec §6.1): growthInput >= growth.floor (0.00) AND gpa >= gpa.floor (cohort) AND
      // efficiency floor met. A spin-off-guarded/NOT_READY growth or missing gpa fails the floor (not the gate
      // crashing) → belowAbsoluteFloor, listed but off the shortlist. NOT a score-kill (REL/score path runs).
      const norm = NORMS[cohortNorm];
      const gateGrowthOk = (m._stpGrowth != null) && (m._stpGrowth >= norm.growth.floor);
      const gateGpaOk = (m._stpGpa != null) && (m._stpGpa >= norm.gpa.floor);
      const gateEffOk = (m._stpEff != null) && (m._stpEff >= norm.eff.floor);
      m.belowAbsoluteFloor = !(gateGrowthOk && gateGpaOk && gateEffOk);
      m.score = m.membershipClass === 'Out' ? null : rawScore;
      m.headlineShortlist = (m.membershipClass !== 'Out') && !m.belowAbsoluteFloor;
      m.stage = stageOf(F, m.fcfMargin);
    } else if (F.consdisc) {
      // consdisc_expansion (CORE): absKaliberConsDisc = 4-axis weighted-q with COVERAGE-RENORM + a POST-SUM
      // dilution haircut (shareCAGR), reading the cohort NORMS. PER-COHORT β: store β=0.6 (full ABS+REL blend,
      // n>=31>=15); light β=1.0 ABS-ONLY (n<15, REL suppressed, THIN_REL — §1.3 honest thin-n). With β=1 the
      // blendScore ignores `core` (REL) → score=100*absK, the faithful within-segment caliber read.
      const cohortNorm = F.cohortKey; // 'consdisc_store' | 'consdisc_light'
      const cdRec = {
        gpa: m._cdGpa, growth: m._cdGrowth,
        assetGrowth: (m.cd && m.cd.assetGrowth != null && isFinite(m.cd.assetGrowth)) ? m.cd.assetGrowth : null,
        eff: m._cdEff,
        shareCAGR: m._cdShareCAGR,
      };
      const ak = absKaliberConsDisc(cdRec, cohortNorm);
      m.absKaliber = Math.round(ak.absK * 1000) / 1000;
      m.absKaliberPreDilution = Math.round(ak.absKPreDilution * 1000) / 1000; // audit: caliber before share-dilution haircut
      m.dilutionHaircut = Math.round(ak.dilutionHaircut * 1000) / 1000;       // audit: applied haircut fraction [0,maxHaircut]
      m.absUsedAxes = ak.usedAxes;          // audit: which axes survived coverage-renorm
      m.absDroppedAxes = ak.droppedAxes;    // audit: NOT_READY/null drops
      const beta = (F.beta != null) ? F.beta : 0.6; // light=1.0 (ABS-only), store=0.6
      const rawScore = Math.round(Math.max(0, blendScore(ak.absK, core, beta)) * 10) / 10; // share dilution already in absK
      // SI-1 shortlist-cut (Spec §6.1): growthInput >= growth.floor (0.04) AND gpa >= gpa.floor (cohort) AND
      // efficiency floor met. A NOT_READY growth or missing gpa fails the floor (not the gate crashing) →
      // belowAbsoluteFloor, listed but off the shortlist. NOT a score-kill (REL/score path runs).
      const norm = NORMS[cohortNorm];
      const gateGrowthOk = (m._cdGrowth != null) && (m._cdGrowth >= norm.growth.floor);
      const gateGpaOk = (m._cdGpa != null) && (m._cdGpa >= norm.gpa.floor);
      const gateEffOk = (m._cdEff != null) && (m._cdEff >= norm.eff.floor);
      m.belowAbsoluteFloor = !(gateGrowthOk && gateGpaOk && gateEffOk);
      m.score = m.membershipClass === 'Out' ? null : rawScore;
      m.headlineShortlist = (m.membershipClass !== 'Out') && !m.belowAbsoluteFloor;
      m.stage = stageOf(F, m.fcfMargin);
    } else if (F.materials) {
      // materials_quality (CORE): absKaliberMaterials = 5-axis weighted-q with COVERAGE-RENORM reading the
      // cohort NORMS (axis C = marginStability, the inverse-CV pricing-power proxy; identity-clip {0,1}). The
      // load-bearing renorm fires on ~57% of names lacking annualShares + spin-off/super-cycle rebases.
      const cohortNorm = F.cohortKey; // 'materials_pricingpower' | 'materials_commodity'
      const mtRec = {
        gpa: m._mtGpa, marginStability: m._mtMarginStability, growth: m._mtGrowth,
        assetGrowth: (m.mt && m.mt.assetGrowth != null && isFinite(m.mt.assetGrowth)) ? m.mt.assetGrowth : null,
        netShareIssuance: (m.mt && m.mt.netShareIssuance != null && isFinite(m.mt.netShareIssuance)) ? m.mt.netShareIssuance : null,
      };
      const ak = absKaliberMaterials(mtRec, cohortNorm);
      m.absKaliber = Math.round(ak.absK * 1000) / 1000;
      m.absUsedAxes = ak.usedAxes;          // audit: which axes survived coverage-renorm
      m.absDroppedAxes = ak.droppedAxes;    // audit: NOT_READY/ISSUANCE/SPINOFF drops
      const rawScore = Math.round(Math.max(0, blendScore(ak.absK, core, 0.6)) * 10) / 10; // pDil=0 (issuance is a SCORED axis)
      // SI-1 shortlist-cut: gpa >= gpa.floor (cohort) AND marginStability >= marginStability.floor (0.0, always
      // passes when present — the pricing-power signal is CONTINUOUS, never a hard eligibility gate, per the
      // Court ruling §0). A missing gpa/marginStability fails the floor (not the gate crashing) →
      // belowAbsoluteFloor, listed but off the shortlist. NOT a score-kill (REL/score path runs).
      // audit/fix (re-court materials headline-inversion 2026-06-23): removed the growthOk term from the
      // absolute-floor headline gate — QUALITY-ONLY (gpa×marginStability), exactly as energy_quality's floor is
      // roce/fcfMargin/gpa with NO growth term. The growth term was the SAME pro-cyclical inversion as the
      // membership growth factor: it knocked high-absKaliber through-cycle compounders (CF NOT_READY:growth,
      // BCC/UFPI/SMG growth-below-floor) off the headline while admitting lower-absKaliber peak-cycle names whose
      // recent growth happened to clear the floor. Growth remains a SCORED axis (w .18); it just no longer gates
      // the headline.
      const norm = NORMS[cohortNorm];
      const gateGpaOk = (m._mtGpa != null) && (m._mtGpa >= norm.gpa.floor);
      const gateMsOk = (m._mtMarginStability != null) && (m._mtMarginStability >= norm.marginStability.floor);
      m.belowAbsoluteFloor = !(gateGpaOk && gateMsOk);
      // audit/fix (re-court materials_quality DENIAL — Spec §1/§5 pre-revenue SI-4 hard-exclude): a materials
      // name with NO real revenue (EMAT annualRev=[], a $4.3B revenue-less shell; LWLG $236k; the revLatest=0
      // shells CNL/NG/PPTA/UAN/NEU) is a pre-revenue exploration/shell name → score=null + excluded[] with reason
      // OUT_OF_SEGMENT:preexploration, NOT scored. This is DETERMINISTIC and independent of the membership gate
      // (which only caught EMAT incidentally via Out-class; absKaliber=0.899 would have ranked it #1 if membership
      // had passed). SCORED requires >=2 non-null annual rev points AND revLatest >= MT_MIN_REVENUE ($1M).
      const mtRev = m.mt || {};
      const preRevenue = !(mtRev.nAnnualRev != null && mtRev.nAnnualRev >= 2
        && mtRev.revLatest != null && isFinite(mtRev.revLatest) && mtRev.revLatest >= MT_MIN_REVENUE);
      if (preRevenue) {
        m.exclusionReason = 'OUT_OF_SEGMENT:preexploration';
        m.score = null;                                 // SI-4: lands in excluded[] (members.filter score==null)
        m.headlineShortlist = false;
      } else {
        m.score = m.membershipClass === 'Out' ? null : rawScore;
        m.headlineShortlist = (m.membershipClass !== 'Out') && !m.belowAbsoluteFloor;
      }
      m.stage = stageOf(F, m.fcfMargin);
    } else if (F.energy) {
      // energy_quality (CORE): absKaliberEnergy = 5-axis weighted-q with COVERAGE-RENORM reading the cohort NORMS
      // (axis B = roce opInc/TA, axis C = fcfMargin FCF/rev; NO growth axis — QUALITY-ONLY). The load-bearing
      // renorm fires on ~50% of names lacking annualShares (Vintage-A) + any NOT_READY axis.
      const cohortNorm = F.cohortKey; // 'energy_upstream' | 'energy_midstream' | 'energy_services'
      const enRec = {
        roce: m._enRoce, fcfMargin: m._enFcfMargin, gpa: m._enGpa,
        assetGrowth: (m.en && m.en.assetGrowth != null && isFinite(m.en.assetGrowth)) ? m.en.assetGrowth : null,
        netShareIssuance: (m.en && m.en.netShareIssuance != null && isFinite(m.en.netShareIssuance)) ? m.en.netShareIssuance : null,
      };
      const ak = absKaliberEnergy(enRec, cohortNorm);
      m.absKaliber = Math.round(ak.absK * 1000) / 1000;
      m.absUsedAxes = ak.usedAxes;          // audit: which axes survived coverage-renorm
      m.absDroppedAxes = ak.droppedAxes;    // audit: NOT_READY/ISSUANCE drops
      const rawScore = Math.round(Math.max(0, blendScore(ak.absK, core, 0.6)) * 10) / 10; // pDil=0 (issuance is a SCORED axis)
      // SI-1 shortlist-cut (Spec §5): roce >= roce.floor (cohort) AND fcfMargin >= fcfMargin.floor (cohort) AND
      // gpa >= gpa.floor (cohort). A NOT_READY/missing axis fails the floor (not the gate crashing) →
      // belowAbsoluteFloor, listed but off the shortlist. NOT a score-kill (REL/score path runs independently).
      const norm = NORMS[cohortNorm];
      const gateRoceOk = (m._enRoce != null) && (m._enRoce >= norm.roce.floor);
      const gateFcfOk = (m._enFcfMargin != null) && (m._enFcfMargin >= norm.fcfMargin.floor);
      const gateGpaOk = (m._enGpa != null) && (m._enGpa >= norm.gpa.floor);
      m.belowAbsoluteFloor = !(gateRoceOk && gateFcfOk && gateGpaOk);
      // PRE-REVENUE SI-4 hard-exclude (the materials lesson — DO NOT SKIP): an energy name with NO real revenue
      // is a pre-revenue exploration/shell → score=null + excluded[] OUT_OF_SEGMENT:preexploration, NOT scored.
      // DETERMINISTIC and independent of the membership gate. SCORED requires >=2 non-null annual rev points AND
      // revLatest >= EN_MIN_REVENUE ($1M) — verifies NO revenue-less shell can top a cohort (the roce/fcfMargin/
      // gpa axes are undefined/explosive on near-zero revenue; coverage-renorm would otherwise let the shell win).
      const enRev = m.en || {};
      const preRevenue = !(enRev.nAnnualRev != null && enRev.nAnnualRev >= 2
        && enRev.revLatest != null && isFinite(enRev.revLatest) && enRev.revLatest >= EN_MIN_REVENUE);
      if (preRevenue) {
        m.exclusionReason = 'OUT_OF_SEGMENT:preexploration';
        m.score = null;                                 // SI-4: lands in excluded[]
        m.headlineShortlist = false;
      } else {
        m.score = m.membershipClass === 'Out' ? null : rawScore;
        m.headlineShortlist = (m.membershipClass !== 'Out') && !m.belowAbsoluteFloor;
      }
      m.stage = stageOf(F, m._enFcfMargin);
    } else if (F.pharma) {
      // pharma_commercial (CORE): absKaliberPharma = 3-axis weighted-q {growth, gm, eff} with COVERAGE-RENORM
      // reading the cohort NORMS. The renorm fires on a fully-deal-masked acquirer (NOT_READY:growth) and a no-GP
      // royalty name (RPRX/ARWR gm null). NONE inverted (growth/gm/eff higher=better directly).
      const cohortNorm = F.cohortKey; // 'pharma_branded' | 'pharma_biopharma' | 'pharma_specialty'
      const phRec = { growth: m._phGrowth, gm: m._phGm, eff: m._phEff };
      const ak = absKaliberPharma(phRec, cohortNorm);
      m.absKaliber = Math.round(ak.absK * 1000) / 1000;
      m.absUsedAxes = ak.usedAxes;          // audit: which axes survived coverage-renorm
      m.absDroppedAxes = ak.droppedAxes;    // audit: NOT_READY drops
      const norm = NORMS[cohortNorm];
      // THIN_REL: branded n=10<15 → ABS-only (beta=1.0, norm.rel.suppressed); biopharma/specialty β=0.6 blend.
      const beta = (norm.rel && norm.rel.suppressed) ? 1.0 : 0.6;
      const rawScore = Math.round(Math.max(0, blendScore(ak.absK, core, beta)) * 10) / 10; // pDil=0 (net-issuance not a scored axis)
      // SI-1 shortlist-cut (Spec §6): growth >= growth.floor (cohort, 0.00 for branded/specialty) AND gm >= gm.floor
      // (cohort) AND eff >= eff.floor (cohort). A NOT_READY/missing axis fails the floor (not the gate crashing) →
      // belowAbsoluteFloor, listed but off the shortlist. NOT a score-kill (REL/score path runs independently).
      const gateGrowthOk = (m._phGrowth != null) && (m._phGrowth >= norm.growth.floor);
      const gateGmOk = (m._phGm != null) && (m._phGm >= norm.gm.floor);
      const gateEffOk = (m._phEff != null) && (m._phEff >= norm.eff.floor);
      m.belowAbsoluteFloor = !(gateGrowthOk && gateGmOk && gateEffOk);
      // PRE-REVENUE SI-4 hard-exclude (the materials lesson — the §1.4 commercial gate already deferred the
      // clinical-stage names in the classifier; this is the belt-and-suspenders floor). SCORED requires >=2 non-null
      // annual rev points AND revLatest >= PH_MIN_REVENUE ($1M) — verifies NO revenue-less shell can top a cohort.
      const phRev = m.ph || {};
      const preRevenue = !(phRev.nAnnualRev != null && phRev.nAnnualRev >= 2
        && phRev.revLatest != null && isFinite(phRev.revLatest) && phRev.revLatest >= PH_MIN_REVENUE);
      if (preRevenue) {
        m.exclusionReason = 'OUT_OF_SEGMENT:preexploration';
        m.score = null;                                 // SI-4: lands in excluded[]
        m.headlineShortlist = false;
      } else {
        m.score = m.membershipClass === 'Out' ? null : rawScore;
        m.headlineShortlist = (m.membershipClass !== 'Out') && !m.belowAbsoluteFloor;
      }
      m.stage = stageOf(F, m._phEff);
    } else if (F.itservices) {
      // it_services (CORE): absKaliberItServices = 5-axis weighted-q {gpa, fcfMargin, opMargin, growth, netIssuance}
      // with COVERAGE-RENORM reading the cohort NORMS. gpa/fcfMargin/opMargin/growth NON-inverted; netIssuance
      // inverted (the negated raw is in m._itNetIssuance — but absKaliberItServices re-negates the RAW netShareIssuance
      // itself, so pass the RAW signed value, mirroring energy/industrials). The renorm fires on ~50% of names lacking
      // annualShares (ISSUANCE_NOT_READY) + any NOT_READY axis. RPE is NOT an axis (§B.2 inverted, gate+flag only).
      const cohortNorm = F.cohortKey; // 'it_services'
      const itRec = {
        gpa: m._itGpa, fcfMargin: m._itFcfMargin, opMargin: m._itOpMargin, growth: m._itGrowth,
        netShareIssuance: (m.it && m.it.netShareIssuance != null && isFinite(m.it.netShareIssuance)) ? m.it.netShareIssuance : null,
      };
      const ak = absKaliberItServices(itRec, cohortNorm);
      m.absKaliber = Math.round(ak.absK * 1000) / 1000;
      m.absUsedAxes = ak.usedAxes;          // audit: which axes survived coverage-renorm
      m.absDroppedAxes = ak.droppedAxes;    // audit: NOT_READY/ISSUANCE drops
      const rawScore = Math.round(Math.max(0, blendScore(ak.absK, core, 0.6)) * 10) / 10; // pDil=0 (issuance is a SCORED axis)
      // SI-1 shortlist-cut (§B.3): gpa >= gpa.floor (the lead asset-light quality pillar) AND fcfMargin >= fcfMargin.
      // floor AND opMargin >= opMargin.floor. A NOT_READY/missing axis fails the floor (not the gate crashing) →
      // belowAbsoluteFloor, listed but off the shortlist. NOT a score-kill (REL/score path runs independently).
      const norm = NORMS[cohortNorm];
      const gateGpaOk = (m._itGpa != null) && (m._itGpa >= norm.gpa.floor);
      const gateFcfOk = (m._itFcfMargin != null) && (m._itFcfMargin >= norm.fcfMargin.floor);
      const gateOpOk = (m._itOpMargin != null) && (m._itOpMargin >= norm.opMargin.floor);
      m.belowAbsoluteFloor = !(gateGpaOk && gateFcfOk && gateOpOk);
      // PRE-REVENUE SI-4 hard-exclude (the materials/energy lesson — the contamination gate already removed the
      // negative-opMargin AI-shells in the classifier; this is the belt-and-suspenders floor). SCORED requires >=2
      // non-null annual rev points AND revLatest >= IT_MIN_REVENUE ($1M) — verifies NO revenue-less shell can top.
      const itRev = m.it || {};
      const preRevenue = !(itRev.nAnnualRev != null && itRev.nAnnualRev >= 2
        && itRev.revLatest != null && isFinite(itRev.revLatest) && itRev.revLatest >= IT_MIN_REVENUE);
      if (preRevenue) {
        m.exclusionReason = 'OUT_OF_SEGMENT:preexploration';
        m.score = null;                                 // SI-4: lands in excluded[]
        m.headlineShortlist = false;
      } else {
        m.score = m.membershipClass === 'Out' ? null : rawScore;
        m.headlineShortlist = (m.membershipClass !== 'Out') && !m.belowAbsoluteFloor;
      }
      m.stage = stageOf(F, m._itFcfMargin);
    } else if (F.techhw) {
      // tech_hardware_quality (CORE): absKaliberItServices = 5-axis weighted-q {gpa, fcfMargin, opMargin, growth,
      // netIssuance} with COVERAGE-RENORM reading the cohort NORMS (REUSED engine — the tech_hardware axis set is
      // byte-identical to it_services, only the cohort NORMS differ). gpa/fcfMargin/opMargin/growth NON-inverted;
      // netIssuance inverted (the engine re-negates the RAW netShareIssuance itself, so pass the RAW signed value).
      // The renorm fires on ~48% of names lacking annualShares (ISSUANCE_NOT_READY) + any NOT_READY axis.
      const cohortNorm = F.cohortKey; // 'tech_hardware_quality'
      const thwRec = {
        gpa: m._thwGpa, fcfMargin: m._thwFcfMargin, opMargin: m._thwOpMargin, growth: m._thwGrowth,
        netShareIssuance: (m.thw && m.thw.netShareIssuance != null && isFinite(m.thw.netShareIssuance)) ? m.thw.netShareIssuance : null,
      };
      const ak = absKaliberItServices(thwRec, cohortNorm);
      m.absKaliber = Math.round(ak.absK * 1000) / 1000;
      m.absUsedAxes = ak.usedAxes;          // audit: which axes survived coverage-renorm
      m.absDroppedAxes = ak.droppedAxes;    // audit: NOT_READY/ISSUANCE drops
      const rawScore = Math.round(Math.max(0, blendScore(ak.absK, core, 0.6)) * 10) / 10; // pDil=0 (issuance is a SCORED axis)
      // SI-1 shortlist-cut: gpa >= gpa.floor (the lead franchise-quality pillar) AND fcfMargin >= fcfMargin.floor AND
      // opMargin >= opMargin.floor. THIS is the demotion mechanism for the commodity contract-mfg / loss tail (FLEX/JBL/
      // BHE/SANM/PLXS clip below the floor → belowAbsoluteFloor, listed but off the headlineShortlist). A NOT_READY/
      // missing axis fails the floor. NOT a score-kill (REL/score path runs independently — they still get a rank).
      const norm = NORMS[cohortNorm];
      const gateGpaOk = (m._thwGpa != null) && (m._thwGpa >= norm.gpa.floor);
      const gateFcfOk = (m._thwFcfMargin != null) && (m._thwFcfMargin >= norm.fcfMargin.floor);
      const gateOpOk = (m._thwOpMargin != null) && (m._thwOpMargin >= norm.opMargin.floor);
      // COMPOSITE absKaliber floor — THE bimodality demotion mechanism (the thesis: the absolute-anchor sinks the
      // commodity contract-mfg / loss tail off-headline). The per-axis floors alone are too permissive: a commodity
      // contract-manufacturer (FLEX gpa .12/opMargin .05, SANM/PLXS similar) clears each individual floor but its
      // COMPOSITE absKaliber (.11-.18) sits far below the genuine franchises (the lowest genuine franchise FORM/COHR
      // .29-.31; then a CLIFF to TTMI .21 / HPE .19 / FLEX .18 / SANM .12 / PLXS .11). THW_ABSK_FLOOR=.25 sits in that
      // natural gap → it demotes the entire commodity/low-quality tail (FLEX/SANM/PLXS/JBL/BHE/HPE/TTMI) off the
      // headlineShortlist while keeping every genuine franchise. NOT a score-kill (the name still gets a score/rank).
      const gateAbsKOk = (ak.absK != null && isFinite(ak.absK)) && (ak.absK >= THW_ABSK_FLOOR);
      m.belowAbsoluteFloor = !(gateGpaOk && gateFcfOk && gateOpOk && gateAbsKOk);
      // SI-4 SHELL hard-exclude (the materials/energy lesson — NO contamination gate in the classifier; this is the
      // belt-and-suspenders economic shell gate). SCORED requires positive revenue in ANY year AND totalAssets in ANY
      // year (surfaced as m.thw.anyPosRev / m.thw.anyTotalAssets) — a revenue-less / no-balance-sheet shell cannot be scored.
      const thwRaw0 = m.thw || {};
      const isShell = !(thwRaw0.anyPosRev === true && thwRaw0.anyTotalAssets === true);
      if (isShell) {
        m.exclusionReason = 'OUT_OF_SEGMENT:shell';
        m.score = null;                                 // SI-4: lands in excluded[]
        m.headlineShortlist = false;
      } else {
        m.score = m.membershipClass === 'Out' ? null : rawScore;
        m.headlineShortlist = (m.membershipClass !== 'Out') && !m.belowAbsoluteFloor;
      }
      m.stage = stageOf(F, m._thwFcfMargin);
    } else if (F.banks) {
      // financials_banks (CORE): absKaliberBanks = 4-axis weighted-q {roaThruCycle, capitalAdequacy,
      // assetGrowthDiscipline, earningsDurability} with COVERAGE-RENORM reading the cohort NORMS. roaThruCycle/
      // capitalAdequacy/earningsDurability NON-inverted; assetGrowthDiscipline inverted (the engine negates the RAW
      // assetGrowthYoY itself, so pass the RAW signed value, mirroring energy/industrials assetGrowth). The
      // load-bearing renorm fires on ~45% of names lacking totalEquity (CAPADEQ_DROPPED — incl. JPM/WFC/PNC/USB) +
      // any NOT_READY axis. FCF/OCF are NEVER passed (not bank axes).
      const cohortNorm = F.cohortKey; // 'financials_banks'
      const bkRec = {
        roaThruCycle: m._bkRoa, capitalAdequacy: m._bkCapAdequacy, earningsDurability: m._bkEarningsDurability,
        assetGrowthYoY: (m.bk && m.bk.assetGrowthYoY != null && isFinite(m.bk.assetGrowthYoY)) ? m.bk.assetGrowthYoY : null,
      };
      const ak = absKaliberBanks(bkRec, cohortNorm);
      m.absKaliber = Math.round(ak.absK * 1000) / 1000;
      m.absUsedAxes = ak.usedAxes;          // audit: which axes survived coverage-renorm (e.g. capitalAdequacy-dropped on JPM/WFC/PNC)
      m.absDroppedAxes = ak.droppedAxes;    // audit: CAPADEQ_DROPPED / NOT_READY / DURABILITY_THIN drops
      // n=128 ≫ minN 15 → full ABS+REL blend (β=0.6). THIN_REL guard kept for structural parity (if a future re-court
      // narrows the cohort below 15 → ABS-only β=1.0); never fires at the live count (members.length=128).
      const norm = NORMS[cohortNorm];
      const bkThin = !!(norm.rel && norm.rel.minN != null && members.length < norm.rel.minN);
      const beta = bkThin ? 1.0 : 0.6;
      if (bkThin) m._thinRel = true;
      const rawScore = Math.round(Math.max(0, blendScore(ak.absK, core, beta)) * 10) / 10; // pDil=0 (net-issuance not a bank axis)
      // SI-1 shortlist-cut: roaThruCycle >= roaThruCycle.floor (the lead through-cycle quality pillar). A
      // NOT_READY/missing roa fails the floor (not the gate crashing) → belowAbsoluteFloor, listed but off the
      // shortlist. NOT a score-kill (REL/score path runs independently). capitalAdequacy is NOT a hard headline gate
      // (it is null on the marquees JPM/WFC/PNC — gating on it would wrongly knock them off the headline).
      const gateRoaOk = (m._bkRoa != null) && (m._bkRoa >= norm.roaThruCycle.floor);
      m.belowAbsoluteFloor = !gateRoaOk;
      // SHELL SI-4 hard-exclude (the materials/energy lesson ADAPTED to the revenue-less bank schema): a bank with NO
      // positive annualNetIncome in any year OR no totalAssets[0] (no balance sheet — e.g. MCHB) is a shell that
      // CANNOT be scored (all axes undefined). score=null + excluded[] OUT_OF_SEGMENT:shell, NEVER scored 0.
      // DETERMINISTIC and independent of the membership gate.
      const bk = m.bk || {};
      const isShell = !(bk.anyPositiveNI === true && bk.totalAssetsLatest != null && isFinite(bk.totalAssetsLatest) && bk.totalAssetsLatest > 0);
      if (isShell) {
        m.exclusionReason = 'OUT_OF_SEGMENT:shell';
        m.score = null;                                 // SI-4: lands in excluded[]
        m.headlineShortlist = false;
      } else {
        m.score = m.membershipClass === 'Out' ? null : rawScore;
        m.headlineShortlist = (m.membershipClass !== 'Out') && !m.belowAbsoluteFloor;
      }
      m.stage = stageOf(F, m._bkRoa);
    } else if (F.reits) {
      // equity_reits (CORE): absKaliberReits = 4-axis weighted-q {opMargin, ffoAssets, revG3, ndGA} with COVERAGE-RENORM
      // reading the cohort NORMS. opMargin/ffoAssets/revG3 NON-inverted; ndGA inverted (the engine negates the RAW
      // net-debt/assets itself, so pass the RAW signed value, mirroring banks assetGrowthYoY). The load-bearing renorm
      // fires on ~52% of names lacking annualDepreciation (FFO_COVERAGE_PARTIAL — incl. the top-tier VICI/O/PLD/TRNO) +
      // any NOT_READY axis. The FFO-gains guard already capped the ffoAssets observation UPSTREAM (court revision #2).
      const cohortNorm = F.cohortKey; // 'equity_reits'
      const reRec = {
        opMargin: m._reOpMargin, ffoAssets: m._reFfoAssets, revG3: m._reRevG3,
        ndGA: (m.re && m.re.ndGA != null && isFinite(m.re.ndGA)) ? m.re.ndGA : null,
      };
      const ak = absKaliberReits(reRec, cohortNorm);
      m.absKaliber = Math.round(ak.absK * 1000) / 1000;
      m.absUsedAxes = ak.usedAxes;          // audit: which axes survived coverage-renorm (e.g. ffoAssets-dropped on VICI/O/PLD/TRNO)
      m.absDroppedAxes = ak.droppedAxes;    // audit: FFO_COVERAGE_PARTIAL / REVG3_THIN / NOT_READY drops
      // n=114 ≫ minN 15 → full ABS+REL blend (β=0.6). THIN_REL guard kept for structural parity (if a future re-court
      // narrows the cohort below 15 → ABS-only β=1.0); never fires at the live count (members.length=114).
      const norm = NORMS[cohortNorm];
      const reThin = !!(norm.rel && norm.rel.minN != null && members.length < norm.rel.minN);
      const beta = reThin ? 1.0 : 0.6;
      if (reThin) m._thinRel = true;
      const rawScore = Math.round(Math.max(0, blendScore(ak.absK, core, beta)) * 10) / 10; // pDil=0 (net-issuance not a REIT axis)
      // SI-1 shortlist-cut: opMargin >= opMargin.floor (the NOI-margin quality pillar). A NOT_READY/missing opMargin
      // fails the floor → belowAbsoluteFloor, listed but off the shortlist. NOT a score-kill (REL/score path runs
      // independently). ffoAssets is NOT a hard headline gate (it is null on the top-tier VICI/O/PLD/TRNO — gating on it
      // would wrongly knock them off the headline).
      const gateOpOk = (m._reOpMargin != null) && (m._reOpMargin >= norm.opMargin.floor);
      m.belowAbsoluteFloor = !gateOpOk;
      // economic SHELL SI-4 hard-exclude (the materials/energy/banks lesson adapted to the REIT schema): a REIT with
      // <3 positive-revenue-years OR no totalAssets[0] (e.g. BXDC/FRMI/MRP/JAN) is a shell that CANNOT be scored (axes
      // undefined). score=null + excluded[] OUT_OF_SEGMENT:shell, NEVER scored 0. DETERMINISTIC, independent of membership.
      const re = m.re || {};
      const isShell = !(re.positiveRevYears != null && re.positiveRevYears >= REIT_MIN_POSITIVE_REV_YEARS
        && re.totalAssetsLatest != null && isFinite(re.totalAssetsLatest) && re.totalAssetsLatest > 0);
      if (isShell) {
        m.exclusionReason = 'OUT_OF_SEGMENT:shell';
        m.score = null;                                 // SI-4: lands in excluded[]
        m.headlineShortlist = false;
      } else {
        m.score = m.membershipClass === 'Out' ? null : rawScore;
        m.headlineShortlist = (m.membershipClass !== 'Out') && !m.belowAbsoluteFloor;
      }
      m.stage = stageOf(F, m._reOpMargin);
    } else if (F.capmkt) {
      // capmkt_fee_core (CORE): absKaliberCapmkt = 4-axis weighted-q {opMargin, opMarginStability, fcfMargin,
      // netIssuance} with COVERAGE-RENORM reading the cohort NORMS. opMargin/opMarginStability/fcfMargin NON-inverted;
      // netIssuance inverted (the engine negates the RAW net-share-issuance itself, so pass the RAW signed value,
      // mirroring banks assetGrowthYoY / reits ndGA). The load-bearing renorm fires on ~54% of names lacking
      // annualShares (ISSUANCE_NOT_READY) + any NOT_READY axis. The ECONOMIC FEE-GATE already removed the fund-float
      // artifacts UPSTREAM at classification (court revision #1).
      const cohortNorm = F.cohortKey; // 'capmkt_fee_core'
      const cmRec = {
        opMargin: m._cmOpMargin, opMarginStability: m._cmOpMarginStability, fcfMargin: m._cmFcfMargin,
        netShareIssuance: (m.cm && m.cm.netIssuance != null && isFinite(m.cm.netIssuance)) ? m.cm.netIssuance : null,
      };
      const ak = absKaliberCapmkt(cmRec, cohortNorm);
      m.absKaliber = Math.round(ak.absK * 1000) / 1000;
      m.absUsedAxes = ak.usedAxes;          // audit: which axes survived coverage-renorm (e.g. netIssuance-dropped on ~54% lacking annualShares)
      m.absDroppedAxes = ak.droppedAxes;    // audit: ISSUANCE_NOT_READY / STABILITY_THIN / NOT_READY drops
      // n=100 ≫ minN 15 → full ABS+REL blend (β=0.6). THIN_REL guard kept for structural parity (if a future re-court
      // narrows the cohort below 15 → ABS-only β=1.0); never fires at the live count (members.length=100).
      const norm = NORMS[cohortNorm];
      const cmThin = !!(norm.rel && norm.rel.minN != null && members.length < norm.rel.minN);
      const beta = cmThin ? 1.0 : 0.6;
      if (cmThin) m._thinRel = true;
      const rawScore = Math.round(Math.max(0, blendScore(ak.absK, core, beta)) * 10) / 10; // pDil=0 (net-issuance IS an axis)
      // SI-1 shortlist-cut: opMargin >= opMargin.floor (the operating-margin quality pillar). A NOT_READY/missing
      // opMargin fails the floor → belowAbsoluteFloor, listed but off the shortlist. NOT a score-kill (REL/score path
      // runs independently). fcfMargin/netIssuance are NOT hard headline gates (null on coverage-renorm names).
      const gateOpOk = (m._cmOpMargin != null) && (m._cmOpMargin >= norm.opMargin.floor);
      m.belowAbsoluteFloor = !gateOpOk;
      // economic SHELL SI-4 hard-exclude (the materials/energy/reits lesson adapted to the fee schema): a fee name with
      // <2 positive-revenue-years OR no latest revenue is a shell that CANNOT be scored (axes undefined/explosive).
      // score=null + excluded[] OUT_OF_SEGMENT:shell, NEVER scored 0. DETERMINISTIC, independent of membership.
      const cm = m.cm || {};
      const isShell = !(cm.positiveRevYears != null && cm.positiveRevYears >= CAPMKT_MIN_POSITIVE_REV_YEARS
        && cm.revLatest != null && isFinite(cm.revLatest) && cm.revLatest > 0);
      if (isShell) {
        m.exclusionReason = 'OUT_OF_SEGMENT:shell';
        m.score = null;                                 // SI-4: lands in excluded[]
        m.headlineShortlist = false;
      } else {
        m.score = m.membershipClass === 'Out' ? null : rawScore;
        m.headlineShortlist = (m.membershipClass !== 'Out') && !m.belowAbsoluteFloor;
      }
      m.stage = stageOf(F, m._cmOpMargin);
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
    // UNIVERSAL revenue-artifact guard (re-court defense-in-depth): medtech/dlst/saas/semi compute growth HERE
    // (not in court-screen), so the SUSPECT_REVENUE_MULTIPLE lamp is raised here when an implausible >4x single-
    // year YoY was dropped from the growth axis. (court-screen buckets carry the same lamp via m.<bk>.lamps below.)
    if (m._revArtifactMult === true) L.push('SUSPECT_REVENUE_MULTIPLE');
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
        // audit/fix (gauntlet C6): Goodwill-Impairment-Lampe (mirror dlst Bug-Fix 2). Ein NEGATIVER ΔGoodwill
        // (Impairment/Divestitur) >= 5% von dem-Jahr-Rev wird jetzt GEFLAGGT statt still aus dem organischen
        // Wachstum gedroppt. Sign-separiert: nur positive Akquisitions-Sprünge werden deal-masked.
        if (m._impairmentFlag === true) L.push('goodwill-impairment(neg-deltaGW-clamped)');
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
    // industrials_compounder (CORE) lamps (Spec §5): advisory, never silent score-kills. The per-name
    // upstream lamps (NOT_READY:gpa/growth/eff/assetgrowth, ISSUANCE_NOT_READY, SPINOFF_REBASE, DEAL_MASKED,
    // STALE:growth, DILUTION_HIGH, MARGIN_NEGATIVE) were collected in court-screen (m.ind.lamps); the four
    // WALLS are always-on per the frozen NORMS.lamps. THIN_REL never fires (both cohorts n≫15).
    if (F.industrials) {
      const il = (m.ind && Array.isArray(m.ind.lamps)) ? m.ind.lamps : [];
      for (const lamp of il) if (!L.includes(lamp)) L.push(lamp);
      // always-on WALLS (Spec §2.3/§5)
      L.push('CYCLE_WALL');           // only ~4y history; no normalized-10y-ROIC
      L.push('INVENTORY_BLIND');      // no inventory line ⇒ channel-overbuild/DIO uncomputable
      L.push('UNBILLED_BLIND');       // no contract-asset line ⇒ unbilled-AR cash-quality uncomputable
      L.push('BACKLOG_FUTURE');       // no book-to-bill/RPO → Axis F future BONUS (weight 0), not scored
      if (m.belowAbsoluteFloor) L.push('below-abs-floor');
      if (m.membershipClass === 'Out') L.push('membership-Out(excluded-from-headline)');
      if (Array.isArray(m.absDroppedAxes) && m.absDroppedAxes.length) L.push(`coverage-renorm(dropped:${m.absDroppedAxes.join('+')})`);
      m.cohort = F.cohortKey;
      m.normTableId = getNormTableId(F.cohortKey);
      m.scoreScope = 'intra-bucket';
      m.crossBucketComparableField = 'absKaliber';
    }
    // consumer_staples_compounder (CORE) lamps (Spec §5): advisory, never silent score-kills. Per-name upstream
    // lamps (NOT_READY:gpa/growth/eff/assetgrowth, ISSUANCE_NOT_READY, SPINOFF_REBASE, DEAL_MASKED, SUSPECT_REVENUE,
    // STALE:growth, DILUTION_HIGH, MARGIN_NEGATIVE, SBC_HIGH, IMPAIRMENT_BLIND) collected in court-screen (m.stp.lamps); the
    // four WALLS are always-on per the frozen NORMS.lamps. THIN_REL never fires (branded n=52, distrib n=23).
    if (F.staples) {
      const sl = (m.stp && Array.isArray(m.stp.lamps)) ? m.stp.lamps : [];
      for (const lamp of sl) if (!L.includes(lamp)) L.push(lamp);
      // always-on WALLS (Spec §2.3/§5)
      L.push('VOLUME_PRICE_BLIND');   // the decisive volume-vs-price/mix split has no us-gaap tag — MANUAL field, NEVER faked
      L.push('MA_PROXY_ONLY');        // no goodwill line ⇒ M&A via totalAssets-jump proxy only
      L.push('INVENTORY_BLIND');      // no inventory line ⇒ DIO / WC-cycle uncomputable
      L.push('CYCLE_WALL');           // only ~4y history; inflation-pricing + agri commodity cycles not normalizable
      if (m.belowAbsoluteFloor) L.push('below-abs-floor');
      if (m.membershipClass === 'Out') L.push('membership-Out(excluded-from-headline)');
      if (Array.isArray(m.absDroppedAxes) && m.absDroppedAxes.length) L.push(`coverage-renorm(dropped:${m.absDroppedAxes.join('+')})`);
      m.cohort = F.cohortKey;
      m.normTableId = getNormTableId(F.cohortKey);
      m.scoreScope = 'intra-bucket';
      m.crossBucketComparableField = 'absKaliber';
    }
    // consdisc_expansion (CORE) lamps (Spec §5): advisory, never silent score-kills. Per-name upstream lamps
    // (NOT_READY:gpa/growth/eff/assetgrowth, ISSUANCE_NOT_READY, DEAL_MASKED, STALE:growth, DILUTION_HIGH,
    // MARGIN_NEGATIVE) collected in court-screen (m.cd.lamps); the always-on WALLS come from the frozen
    // NORMS.lamps (LEASE_DISTORTED store-only, INVENTORY_BLIND both). THIN_REL fires for the light cohort
    // (n<15 → ABS-only, β=1) per the §1.3 honest thin-n policy.
    if (F.consdisc) {
      const cl = (m.cd && Array.isArray(m.cd.lamps)) ? m.cd.lamps : [];
      for (const lamp of cl) if (!L.includes(lamp)) L.push(lamp);
      const wallCfg = NORMS[F.cohortKey].lamps || {};
      if (wallCfg.leaseDistorted) L.push('LEASE_DISTORTED');   // GP/assets denom carries ASC-842 ROU (store-only, common-mode)
      if (wallCfg.inventoryBlind) L.push('INVENTORY_BLIND');   // no inventory line ⇒ DIO/markdown uncomputable
      if (F.absOnly) L.push('THIN_REL');                        // light n<15 → ABS-only (β=1), REL suppressed (§1.3)
      if (m.belowAbsoluteFloor) L.push('below-abs-floor');
      if (m.membershipClass === 'Out') L.push('membership-Out(excluded-from-headline)');
      if (Array.isArray(m.absDroppedAxes) && m.absDroppedAxes.length) L.push(`coverage-renorm(dropped:${m.absDroppedAxes.join('+')})`);
      m.cohort = F.cohortKey;
      m.normTableId = getNormTableId(F.cohortKey);
      m.scoreScope = 'intra-bucket';
      m.crossBucketComparableField = 'absKaliber';
    }
    // materials_quality (CORE) lamps (Spec §5): advisory, never silent score-kills. Per-name upstream lamps
    // (NOT_READY:gpa/marginstability/growth/assetgrowth, ISSUANCE_NOT_READY, SPINOFF_REBASE, DEAL_MASKED,
    // STALE:growth, DILUTION_HIGH, MARGIN_NEGATIVE) collected in court-screen (m.mt.lamps); the five WALLS are
    // always-on per the frozen NORMS.lamps. THIN_REL never fires (pricingpower n=40, commodity n=55, both >>15).
    if (F.materials) {
      const ml = (m.mt && Array.isArray(m.mt.lamps)) ? m.mt.lamps : [];
      for (const lamp of ml) if (!L.includes(lamp)) L.push(lamp);
      // audit/fix (re-court): surface the pre-revenue SI-4 exclusion as an explicit lamp (Spec §1/§5).
      if (m.exclusionReason === 'OUT_OF_SEGMENT:preexploration' && !L.includes('OUT_OF_SEGMENT:preexploration')) L.push('OUT_OF_SEGMENT:preexploration');
      // always-on WALLS (Spec §5) — QUALITY-ONLY, no commodity-price bet is ever scored
      L.push('CYCLE_WALL');           // only ~4y history; no normalized-10y-ROIC (GP/assets is the through-cycle PROXY)
      L.push('COSTCURVE_BLIND');      // AISC/C1 cash-cost survival metric untagged in Yahoo → Axis F future BONUS (weight 0), NEVER faked
      L.push('INVENTORY_BLIND');      // no inventory line ⇒ channel/stockpile uncomputable
      L.push('BYPRODUCT_BLIND');      // by-product credits make C1 a price artifact
      L.push('BACKLOG_FUTURE');       // gases take-or-pay backlog absent from snapshots → 0-weight bonus
      if (m.belowAbsoluteFloor) L.push('below-abs-floor');
      if (m.membershipClass === 'Out') L.push('membership-Out(excluded-from-headline)');
      if (Array.isArray(m.absDroppedAxes) && m.absDroppedAxes.length) L.push(`coverage-renorm(dropped:${m.absDroppedAxes.join('+')})`);
      m.cohort = F.cohortKey;
      m.normTableId = getNormTableId(F.cohortKey);
      m.scoreScope = 'intra-bucket';
      m.crossBucketComparableField = 'absKaliber';
    }
    // tech_hardware_quality (CORE) lamps: advisory, never silent score-kills. Per-name upstream lamps (NOT_READY:gpa/
    // fcfmargin/opmargin/growth, ISSUANCE_NOT_READY, SPINOFF_REBASE, DEAL_MASKED, STALE:growth, DILUTION_HIGH) + the
    // always-on WALLS (CYCLE_WALL / INVENTORY_BLIND / BACKLOG_FUTURE / BOOK_TO_BILL_BLIND) are collected in court-screen
    // (m.thw.lamps); the WALLS are re-asserted here so every member carries them even if the upstream record was thin.
    if (F.techhw) {
      const tl = (m.thw && Array.isArray(m.thw.lamps)) ? m.thw.lamps : [];
      for (const lamp of tl) if (!L.includes(lamp)) L.push(lamp);
      // SI-4 SHELL exclusion as an explicit lamp (the materials/energy lesson).
      if (m.exclusionReason === 'OUT_OF_SEGMENT:shell' && !L.includes('OUT_OF_SEGMENT:shell')) L.push('OUT_OF_SEGMENT:shell');
      // always-on WALLS — re-asserted (idempotent: court-screen already pushed them; dedup via includes).
      for (const wall of ['CYCLE_WALL', 'INVENTORY_BLIND', 'BACKLOG_FUTURE', 'BOOK_TO_BILL_BLIND']) {
        if (!L.includes(wall)) L.push(wall);
      }
      if (m.belowAbsoluteFloor) L.push('below-abs-floor');
      if (m.membershipClass === 'Out') L.push('membership-Out(excluded-from-headline)');
      if (Array.isArray(m.absDroppedAxes) && m.absDroppedAxes.length) L.push(`coverage-renorm(dropped:${m.absDroppedAxes.join('+')})`);
      m.cohort = F.cohortKey;
      m.normTableId = getNormTableId(F.cohortKey);
      m.scoreScope = 'intra-bucket';
      m.crossBucketComparableField = 'absKaliber';
    }
    // energy_quality (CORE) lamps (Spec §4): advisory, never silent score-kills. Per-name upstream lamps
    // (NOT_READY:roce/fcfmargin/gpa/assetgrowth, ISSUANCE_NOT_READY, SPINOFF_REBASE, DEAL_MASKED,
    // COMMODITY_BETA_SUSPECT, DILUTION_HIGH, MARGIN_NEGATIVE) collected in court-screen (m.en.lamps); the WALLS
    // are always-on per the design §4. THIN_REL never fires (all cohorts n>=15, though midstream n=26 is documented
    // thin-but-sufficient). GROWTH is NOT scored → no growth lamp, but COMMODITY_BETA_SUSPECT surfaces the
    // price-windfall year as a transparency flag (the score is commodity-β-immune by construction).
    if (F.energy) {
      const el = (m.en && Array.isArray(m.en.lamps)) ? m.en.lamps : [];
      for (const lamp of el) if (!L.includes(lamp)) L.push(lamp);
      // pre-revenue SI-4 exclusion as an explicit lamp (the materials lesson).
      if (m.exclusionReason === 'OUT_OF_SEGMENT:preexploration' && !L.includes('OUT_OF_SEGMENT:preexploration')) L.push('OUT_OF_SEGMENT:preexploration');
      // always-on WALLS (Spec §4) — QUALITY-ONLY, no commodity-price bet is ever scored
      L.push('CYCLE_WALL');            // only ~4y history; no normalized-10y through-cycle ROCE (opInc/TA is the PROXY)
      L.push('THROUGH_CYCLE_WALL');    // 10y through-cycle ROCE-normalization IMPOSSIBLE with ~4y history
      L.push('COMMODITY_BETA');        // score deliberately EXCLUDES commodity-price exposure (no growth axis)
      // cohort-specific blind WALL (Spec §4): upstream RESERVE_BLIND, midstream DCF_COVERAGE_BLIND
      if (F.cohortKey === 'energy_upstream') L.push('RESERVE_BLIND');         // no reserves/RRR/F&D/PV-10/breakeven line
      else if (F.cohortKey === 'energy_midstream') L.push('DCF_COVERAGE_BLIND'); // distribution-coverage uncomputable
      if (m.belowAbsoluteFloor) L.push('below-abs-floor');
      if (m.membershipClass === 'Out') L.push('membership-Out(excluded-from-headline)');
      if (Array.isArray(m.absDroppedAxes) && m.absDroppedAxes.length) L.push(`coverage-renorm(dropped:${m.absDroppedAxes.join('+')})`);
      m.cohort = F.cohortKey;
      m.normTableId = getNormTableId(F.cohortKey);
      m.scoreScope = 'intra-bucket';
      m.crossBucketComparableField = 'absKaliber';
    }
    // pharma_commercial (CORE) lamps (Spec §5): advisory, never silent score-kills. Per-name upstream lamps
    // (NOT_READY:growth/gm/eff, SPINOFF_REBASE, DEAL_MASKED, STALE:growth, REVENUE_DECLINE, MARGIN_NEGATIVE) +
    // the always-on WALLS (PATENT_CLIFF_WALL + MA_INTANGIBLE_BLIND) are collected in court-screen (m.ph.lamps); the
    // WALLS are re-asserted here per the design §5 so every member carries them even if the upstream record was thin.
    if (F.pharma) {
      const pl = (m.ph && Array.isArray(m.ph.lamps)) ? m.ph.lamps : [];
      for (const lamp of pl) if (!L.includes(lamp)) L.push(lamp);
      // pre-revenue SI-4 exclusion as an explicit lamp (the materials lesson).
      if (m.exclusionReason === 'OUT_OF_SEGMENT:preexploration' && !L.includes('OUT_OF_SEGMENT:preexploration')) L.push('OUT_OF_SEGMENT:preexploration');
      // always-on WALLS (Spec §5) — re-asserted (idempotent: court-screen already pushed them; dedup via includes)
      if (!L.includes('PATENT_CLIFF_WALL')) L.push('PATENT_CLIFF_WALL'); // LOE-concentration uncomputable from companyfacts
      if (!L.includes('MA_INTANGIBLE_BLIND')) L.push('MA_INTANGIBLE_BLIND'); // intangible/IPR&D M&A signal needs the ABSENT external join
      // THIN_REL on the branded cohort (n=10<15 → ABS-only, beta=1.0)
      const norm = NORMS[F.cohortKey];
      if (norm.rel && norm.rel.suppressed && !L.includes('THIN_REL')) L.push('THIN_REL');
      if (m.belowAbsoluteFloor) L.push('below-abs-floor');
      if (m.membershipClass === 'Out') L.push('membership-Out(excluded-from-headline)');
      if (Array.isArray(m.absDroppedAxes) && m.absDroppedAxes.length) L.push(`coverage-renorm(dropped:${m.absDroppedAxes.join('+')})`);
      m.cohort = F.cohortKey;
      m.normTableId = getNormTableId(F.cohortKey);
      m.scoreScope = 'intra-bucket';
      m.crossBucketComparableField = 'absKaliber';
    }
    // it_services (CORE) lamps (Spec PART B §B.7): advisory, never silent score-kills. Per-name upstream lamps
    // (NOT_READY:gpa/fcfmargin/opmargin/growth, ISSUANCE_NOT_READY, SPINOFF_REBASE, DEAL_MASKED, STALE:growth,
    // RPE_ADVISORY/RPE_HIGH_FLAG, DILUTION_HIGH, PEOPLE_DATA_PARTIAL) + the always-on WALLS (PEOPLE_LEVERAGE_BLIND +
    // BACKLOG_FUTURE/UTILIZATION_FUTURE/ATTRITION_FUTURE + CYCLE_WALL) are collected in court-screen (m.it.lamps); the
    // WALLS are re-asserted here per §B.7 so every member carries them even if the upstream record was thin.
    if (F.itservices) {
      const itl = (m.it && Array.isArray(m.it.lamps)) ? m.it.lamps : [];
      for (const lamp of itl) if (!L.includes(lamp)) L.push(lamp);
      // pre-revenue SI-4 exclusion as an explicit lamp (the materials lesson).
      if (m.exclusionReason === 'OUT_OF_SEGMENT:preexploration' && !L.includes('OUT_OF_SEGMENT:preexploration')) L.push('OUT_OF_SEGMENT:preexploration');
      // always-on WALLS (§B.6/§B.7) — re-asserted (idempotent: court-screen already pushed them; dedup via includes).
      // PEOPLE_LEVERAGE_BLIND is THE feasibility disclosure (mirrors medtech MA_INTANGIBLE_BLIND): RPE inverted+not-
      // scored + book-to-bill/utilization/attrition absent → NO axis directly measures people-leverage.
      for (const wall of ['PEOPLE_LEVERAGE_BLIND', 'BACKLOG_FUTURE', 'UTILIZATION_FUTURE', 'ATTRITION_FUTURE', 'CYCLE_WALL', 'INVENTORY_BLIND']) {
        if (!L.includes(wall)) L.push(wall);
      }
      if (m.belowAbsoluteFloor) L.push('below-abs-floor');
      if (m.membershipClass === 'Out') L.push('membership-Out(excluded-from-headline)');
      if (Array.isArray(m.absDroppedAxes) && m.absDroppedAxes.length) L.push(`coverage-renorm(dropped:${m.absDroppedAxes.join('+')})`);
      m.cohort = F.cohortKey;
      m.normTableId = getNormTableId(F.cohortKey);
      m.scoreScope = 'intra-bucket';
      m.crossBucketComparableField = 'absKaliber';
    }
    // financials_banks (CORE) lamps (court DESIGN §5): advisory, never silent score-kills. Per-name upstream lamps
    // (NOT_READY:roa/assetgrowth, CAPADEQ_DROPPED, DURABILITY_THIN) + the always-on BLIND WALLS (CREDIT_QUALITY_BLIND /
    // NIM_BLIND / EFFICIENCY_RATIO_BLIND / CET1_BLIND / DEPOSIT_FRANCHISE_BLIND) are collected in court-screen
    // (m.bk.lamps); the WALLS are re-asserted here so every member carries them even if the upstream record was thin.
    // CREDIT_QUALITY_BLIND is THE feasibility disclosure — the most important bank dimension (NPLs/charge-offs/
    // provisions) is absent, so the score cannot see asset quality (the court's BUILD_WITH_CAVEATS condition).
    if (F.banks) {
      const bl = (m.bk && Array.isArray(m.bk.lamps)) ? m.bk.lamps : [];
      for (const lamp of bl) if (!L.includes(lamp)) L.push(lamp);
      // SHELL SI-4 exclusion as an explicit lamp (the materials/energy lesson adapted to the revenue-less bank schema).
      if (m.exclusionReason === 'OUT_OF_SEGMENT:shell' && !L.includes('OUT_OF_SEGMENT:shell')) L.push('OUT_OF_SEGMENT:shell');
      // always-on BLIND WALLS (court revision #5) — re-asserted (idempotent: court-screen already pushed them; dedup).
      for (const wall of ['CREDIT_QUALITY_BLIND', 'NIM_BLIND', 'EFFICIENCY_RATIO_BLIND', 'CET1_BLIND', 'DEPOSIT_FRANCHISE_BLIND']) {
        if (!L.includes(wall)) L.push(wall);
      }
      if (m.belowAbsoluteFloor) L.push('below-abs-floor');
      if (m.membershipClass === 'Out') L.push('membership-Out(excluded-from-headline)');
      if (Array.isArray(m.absDroppedAxes) && m.absDroppedAxes.length) L.push(`coverage-renorm(dropped:${m.absDroppedAxes.join('+')})`);
      m.cohort = F.cohortKey;
      m.normTableId = getNormTableId(F.cohortKey);
      m.scoreScope = 'intra-bucket';
      m.crossBucketComparableField = 'absKaliber';
    }
    // equity_reits (CORE) lamps (court DESIGN): advisory, never silent score-kills. Per-name upstream lamps
    // (FFO_COVERAGE_PARTIAL, FFO_GAINS_INFLATED, REVG3_THIN, NOT_READY:opmargin/leverage) + the always-on BLIND WALLS
    // (SAME_STORE_NOI/OCCUPANCY/NAV_PREMIUM/AFFO_MAINT_CAPEX/FFO_GAINS) are collected in court-screen (m.re.lamps); the
    // WALLS are re-asserted here so every member carries them even if the upstream record was thin. FFO_COVERAGE_PARTIAL
    // is the court-revision-#3 top-tier-no-FFO disclosure (VICI/O/PLD/TRNO scored on opMargin+revG3+ndGA renormed).
    if (F.reits) {
      const rl = (m.re && Array.isArray(m.re.lamps)) ? m.re.lamps : [];
      for (const lamp of rl) if (!L.includes(lamp)) L.push(lamp);
      // economic SHELL SI-4 exclusion as an explicit lamp (the materials/energy/banks lesson adapted to the REIT schema).
      if (m.exclusionReason === 'OUT_OF_SEGMENT:shell' && !L.includes('OUT_OF_SEGMENT:shell')) L.push('OUT_OF_SEGMENT:shell');
      // always-on BLIND WALLS (court revision #4) — re-asserted (idempotent: court-screen already pushed them; dedup).
      for (const wall of ['SAME_STORE_NOI_BLIND', 'OCCUPANCY_BLIND', 'NAV_PREMIUM_BLIND', 'AFFO_MAINT_CAPEX_BLIND', 'FFO_GAINS_BLIND']) {
        if (!L.includes(wall)) L.push(wall);
      }
      if (m.belowAbsoluteFloor) L.push('below-abs-floor');
      if (m.membershipClass === 'Out') L.push('membership-Out(excluded-from-headline)');
      if (Array.isArray(m.absDroppedAxes) && m.absDroppedAxes.length) L.push(`coverage-renorm(dropped:${m.absDroppedAxes.join('+')})`);
      m.cohort = F.cohortKey;
      m.normTableId = getNormTableId(F.cohortKey);
      m.scoreScope = 'intra-bucket';
      m.crossBucketComparableField = 'absKaliber';
    }
    // capmkt_fee_core (CORE) lamps (court DESIGN): advisory, never silent score-kills. Per-name upstream lamps
    // (NOT_READY:opmargin/fcfmargin, STABILITY_THIN, ISSUANCE_NOT_READY) + the always-on BLIND WALLS (AUM_FLOW/
    // FEE_RATE/RECURRING_MIX/BDC_SPREAD) are collected in court-screen (m.cm.lamps); the WALLS are re-asserted here so
    // every member carries them even if the upstream record was thin. BDC_SPREAD_BLIND is the court-revision-#1
    // disclosed residual (the surviving externally-managed BDCs earn spread income indistinguishable from a true fee
    // franchise on local data — real operating lenders, scored honestly but flagged).
    if (F.capmkt) {
      const cl = (m.cm && Array.isArray(m.cm.lamps)) ? m.cm.lamps : [];
      for (const lamp of cl) if (!L.includes(lamp)) L.push(lamp);
      // economic SHELL SI-4 exclusion as an explicit lamp (the materials/energy/reits lesson adapted to the fee schema).
      if (m.exclusionReason === 'OUT_OF_SEGMENT:shell' && !L.includes('OUT_OF_SEGMENT:shell')) L.push('OUT_OF_SEGMENT:shell');
      // always-on BLIND WALLS — re-asserted (idempotent: court-screen already pushed them; dedup).
      for (const wall of ['AUM_FLOW_BLIND', 'FEE_RATE_BLIND', 'RECURRING_MIX_BLIND', 'BDC_SPREAD_BLIND']) {
        if (!L.includes(wall)) L.push(wall);
      }
      if (m.belowAbsoluteFloor) L.push('below-abs-floor');
      if (m.membershipClass === 'Out') L.push('membership-Out(excluded-from-headline)');
      if (Array.isArray(m.absDroppedAxes) && m.absDroppedAxes.length) L.push(`coverage-renorm(dropped:${m.absDroppedAxes.join('+')})`);
      m.cohort = F.cohortKey;
      m.normTableId = getNormTableId(F.cohortKey);
      m.scoreScope = 'intra-bucket';
      m.crossBucketComparableField = 'absKaliber';
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
          const raw = axisSrawByTicker.get(m.ticker); // audit COURT-4: full-precision axis values for this member
          for (const a of F.axes) {
            const w = a.key === 'durability' ? wDur : a.w + freed * (a.w / otherWsum);
            // audit COURT-4: recompute from FULL-PRECISION axisSraw (fallback to 2-dp axisS) so the backstop,
            // when it fires, does not leak the display-rounding error into the overwritten score.
            const sRaw = (raw && raw[a.name] != null) ? raw[a.name] : (m.axisS[a.name] || 0);
            core += w * (sRaw + 1) / 2;
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
  } else if (F.industrials) {
    // industrials null-safe sort: Out-class (score=null) → end, ticker tiebreak (deterministic).
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
  // industrials_compounder (CORE)-only Zusatzfelder (SI-3/4/5/6) — NUR auf den industrials-Buckets gesetzt
  // → saas/fabless/medtech/dlst-JSON byte-identisch (Parität).
  if (F.industrials) {
    // SI-5 (Spec §6.2): classifiedCount === scoredCount + excludedCount (fail-loud). The court-buckets
    // classifier assigns ONLY industrials_{heavy,light} (excluded industries / non-US / <$1B return null →
    // never enter court-buckets), so every classified name reaches members[]. excludedCount = the SI-4
    // out-of-class names that DID enter members but score=null (membership-Out). classifiedCount counts the
    // court-buckets entries for this cohort; scoredCount = ranked (score!=null); excludedCount = score=null.
    R.classifiedCount = cls.filter(c => c.bucket === bucket).length;
    R.excluded = members.filter(m => m.score == null);
    R.excludedCount = R.excluded.length;
    R.scoredCount = members.filter(m => m.score != null).length;
    // SI-5 fail-loud ONLY when run as a script (require.main) — a bare require('./court-score.js') (unit-test
    // import, no fresh screen) reads whatever outputs/court-candidates.json exists and must not crash the
    // require. The hard identity is asserted by court-score-tests.js on the freshly-regenerated isolated run.
    // (Mirrors saas/fabless/medtech/dlst: those set the counts here, the throwing assert lives in the test.)
    if (require.main === module && R.classifiedCount !== R.scoredCount + R.excludedCount) {
      throw new Error(`SI-5 mismatch ${bucket}: classifiedCount ${R.classifiedCount} !== scoredCount ${R.scoredCount} + excludedCount ${R.excludedCount}`);
    }
    R.normTableId = getNormTableId(F.cohortKey);
    R.cohort = F.cohortKey;
    R.scoreScope = 'intra-bucket';
    R.crossBucketComparableField = 'absKaliber';
    const n = NORMS[F.cohortKey];
    const fmt = x => (x == null ? '—' : x.toFixed(2).replace(/^0\./, '.').replace(/^-0\./, '-.'));
    R.comparabilityNote = `industrials_compounder ${F.cohortKey} (asset-intensity cohort). absKaliber in [0,1] = cross-bucket-comparable absolute scale (5-axis weighted-q over the cohort NORMS '${getNormTableId(F.cohortKey)}': gpa ${fmt(n.gpa.floor)}/${fmt(n.gpa.elite)}, growth ${fmt(n.growth.floor)}/${fmt(n.growth.elite)}, assetGrowthPenalty ${fmt(n.assetGrowthPenalty.floor)}/${fmt(n.assetGrowthPenalty.elite)}, netIssuance ${fmt(n.netIssuance.floor)}/${fmt(n.netIssuance.elite)}, eff ${fmt(n.eff.floor)}/${fmt(n.eff.elite)}; weights {gpa .34, growth .22, assetGrowthPenalty .18, netIssuance .12, eff .14}); COVERAGE-RENORM drops any NOT_READY/null axis (incl. ISSUANCE_NOT_READY on the ~57% of names lacking annualShares, and SPINOFF_REBASE) and renormalizes survivors to Σ=1.0 — no fake-neutral impute. The REL/core component is cross-sectional z/MAD PER COHORT (this bucket only) and is NOT cross-bucket comparable. blendScore mixes both (beta=0.6). WALLS always-on: CYCLE_WALL/INVENTORY_BLIND/UNBILLED_BLIND/BACKLOG_FUTURE. The blended 0-100 'score' is INTRA-BUCKET ONLY; use absKaliber for cross-bucket comparison.`;
    R.crossBucketComparableNote = 'Use members[].absKaliber (absolute [0,1] caliber) for cross-bucket comparison; members[].score (blended 0-100) is intra-bucket ONLY (mixes per-cohort REL, beta=0.6).';
    R.walls = ['CYCLE_WALL', 'INVENTORY_BLIND', 'UNBILLED_BLIND', 'BACKLOG_FUTURE'];
    // Axis-E coverage disclosure (Spec §7-#13): how many names took the ISSUANCE_NOT_READY drop+renorm path.
    R.issuanceCoverage = {
      scored: members.filter(m => m.netShareIssuance != null).length,
      dropped: members.filter(m => m.netShareIssuance == null).length,
    };
  }
  // consumer_staples_compounder (CORE)-only Zusatzfelder (SI-3/4/5/6) — NUR auf den staples-Buckets gesetzt
  // → saas/fabless/medtech/dlst/industrials-JSON byte-identisch (Parität). Mirrors the industrials block.
  if (F.staples) {
    // SI-5 (Spec §6.2): classifiedCount === scoredCount + excludedCount (fail-loud). The classifier assigns
    // ONLY staples_{branded,distribution} (excluded industries / non-US / foreign-primary / <$1B return null →
    // never enter court-buckets), so every classified name reaches members[]. excludedCount = SI-4 out-of-class
    // names that entered members but score=null (membership-Out). classifiedCount = court-buckets entries.
    R.classifiedCount = cls.filter(c => c.bucket === bucket).length;
    R.excluded = members.filter(m => m.score == null);
    R.excludedCount = R.excluded.length;
    R.scoredCount = members.filter(m => m.score != null).length;
    if (require.main === module && R.classifiedCount !== R.scoredCount + R.excludedCount) {
      throw new Error(`SI-5 mismatch ${bucket}: classifiedCount ${R.classifiedCount} !== scoredCount ${R.scoredCount} + excludedCount ${R.excludedCount}`);
    }
    R.normTableId = getNormTableId(F.cohortKey);
    R.cohort = F.cohortKey;
    R.scoreScope = 'intra-bucket';
    R.crossBucketComparableField = 'absKaliber';
    const n = NORMS[F.cohortKey];
    const fmt = x => (x == null ? '—' : x.toFixed(2).replace(/^0\./, '.').replace(/^-0\./, '-.'));
    R.comparabilityNote = `consumer_staples_compounder ${F.cohortKey} (economic-model cohort: margin-driven branded vs turns-driven distribution). absKaliber in [0,1] = cross-bucket-comparable absolute scale (5-axis weighted-q over the cohort NORMS '${getNormTableId(F.cohortKey)}': gpa ${fmt(n.gpa.floor)}/${fmt(n.gpa.elite)}, growth ${fmt(n.growth.floor)}/${fmt(n.growth.elite)}, assetGrowthPenalty ${fmt(n.assetGrowthPenalty.floor)}/${fmt(n.assetGrowthPenalty.elite)}, netIssuance ${fmt(n.netIssuance.floor)}/${fmt(n.netIssuance.elite)}, eff ${fmt(n.eff.floor)}/${fmt(n.eff.elite)}; weights {gpa .36, growth .18, assetGrowthPenalty .18, netIssuance .12, eff .16}); COVERAGE-RENORM drops any NOT_READY/null axis (incl. ISSUANCE_NOT_READY on the ~58% of names lacking annualShares, and SPINOFF_REBASE) and renormalizes survivors to Σ=1.0 — no fake-neutral impute. The REL/core component is cross-sectional z/MAD PER COHORT (this bucket only) and is NOT cross-bucket comparable. blendScore mixes both (beta=0.6). WALLS always-on: VOLUME_PRICE_BLIND/MA_PROXY_ONLY/INVENTORY_BLIND/CYCLE_WALL. The blended 0-100 'score' is INTRA-BUCKET ONLY; use absKaliber for cross-bucket comparison.`;
    R.crossBucketComparableNote = 'Use members[].absKaliber (absolute [0,1] caliber) for cross-bucket comparison; members[].score (blended 0-100) is intra-bucket ONLY (mixes per-cohort REL, beta=0.6).';
    R.walls = ['VOLUME_PRICE_BLIND', 'MA_PROXY_ONLY', 'INVENTORY_BLIND', 'CYCLE_WALL'];
    // Axis-E coverage disclosure (Spec §2.2/§7-#3): how many names took the ISSUANCE_NOT_READY drop+renorm path.
    R.issuanceCoverage = {
      scored: members.filter(m => m.netShareIssuance != null).length,
      dropped: members.filter(m => m.netShareIssuance == null).length,
    };
  }
  // consdisc_expansion (CORE)-only Zusatzfelder (SI-3/4/5/6) — NUR auf den consdisc-Buckets gesetzt
  // → saas/fabless/medtech/dlst/industrials/staples-JSON byte-identisch (Parität). Mirrors the industrials/
  // staples blocks, with the consdisc deltas: 4 axes (no netIssuance), per-cohort β, dilution-coverage disclosure.
  if (F.consdisc) {
    R.classifiedCount = cls.filter(c => c.bucket === bucket).length;
    R.excluded = members.filter(m => m.score == null);
    R.excludedCount = R.excluded.length;
    R.scoredCount = members.filter(m => m.score != null).length;
    if (require.main === module && R.classifiedCount !== R.scoredCount + R.excludedCount) {
      throw new Error(`SI-5 mismatch ${bucket}: classifiedCount ${R.classifiedCount} !== scoredCount ${R.scoredCount} + excludedCount ${R.excludedCount}`);
    }
    R.normTableId = getNormTableId(F.cohortKey);
    R.cohort = F.cohortKey;
    R.scoreScope = 'intra-bucket';
    R.crossBucketComparableField = 'absKaliber';
    R.betaMode = (F.beta != null ? F.beta : 0.6);        // store 0.6 (ABS+REL blend) / light 1.0 (ABS-only, thin-REL)
    R.absOnly = !!F.absOnly;
    const n = NORMS[F.cohortKey];
    const fmt = x => (x == null ? '—' : x.toFixed(2).replace(/^0\./, '.').replace(/^-0\./, '-.'));
    const blendDesc = F.absOnly
      ? `ABS-ONLY (β=1, REL suppressed — thin-n n<15, §1.3 honest thin-n; an honest within-segment caliber beats a fake-clean REL across the lease-distorted pool)`
      : `blendScore mixes ABS+REL (β=${R.betaMode}); the REL/core component is cross-sectional z/MAD PER COHORT (this bucket only) and is NOT cross-bucket comparable`;
    R.comparabilityNote = `consdisc_expansion ${F.cohortKey} (asset-intensity cohort: asset-light Internet-Retail vs store/real-estate-heavy retail+restaurants). absKaliber in [0,1] = cross-bucket-comparable absolute scale (4-axis weighted-q over the cohort NORMS '${getNormTableId(F.cohortKey)}': gpa ${fmt(n.gpa.floor)}/${fmt(n.gpa.elite)}, growth ${fmt(n.growth.floor)}/${fmt(n.growth.elite)}, assetGrowthPenalty ${fmt(n.assetGrowthPenalty.floor)}/${fmt(n.assetGrowthPenalty.elite)}, eff ${fmt(n.eff.floor)}/${fmt(n.eff.elite)}; weights {gpa .40, growth .25, assetGrowthPenalty .20, eff .15}) THEN a POST-SUM share-dilution haircut (absK*(1-clip(shareCAGR,0,.06)/.06*.10) — issuance >=6%/yr → 10% haircut, buybacks no bonus). COVERAGE-RENORM drops any NOT_READY/null axis and renormalizes survivors to Σ=1.0 — no fake-neutral impute. ${blendDesc}. WALLS always-on: ${F.cohortKey === 'consdisc_store' ? 'LEASE_DISTORTED/INVENTORY_BLIND' : 'INVENTORY_BLIND (NOT lease-distorted — the point of the split)'}. The 0-100 'score' is INTRA-BUCKET ONLY; use absKaliber for cross-bucket comparison.`;
    R.crossBucketComparableNote = 'Use members[].absKaliber (absolute [0,1] caliber, post-dilution) for cross-bucket comparison; members[].score (0-100) is intra-bucket ONLY' + (F.absOnly ? ' (ABS-only, β=1)' : ' (mixes per-cohort REL, β=0.6)') + '.';
    R.walls = F.cohortKey === 'consdisc_store' ? ['LEASE_DISTORTED', 'INVENTORY_BLIND'] : ['INVENTORY_BLIND'];
    // Dilution-haircut coverage disclosure (Spec §2.2/§3): how many names have a shareCAGR (Vintage-B annualShares).
    R.dilutionCoverage = {
      withSignal: members.filter(m => m.shareCAGR != null).length,
      noSignal: members.filter(m => m.shareCAGR == null).length,    // Vintage-A: no haircut (neutral, not punitive)
    };
  }
  // materials_quality (CORE)-only Zusatzfelder (SI-3/4/5/6) — NUR auf den materials-Buckets gesetzt → alle
  // anderen Buckets byte-identisch (Parität). Mirrors the industrials/staples blocks; axis C = marginStability.
  if (F.materials) {
    // SI-5 (Spec §6): classifiedCount === scoredCount + excludedCount (fail-loud). The classifier assigns ONLY
    // materials_{pricingpower,commodity} (excluded industries / non-US per the country-domicile guard + FOREIGN_
    // hardening / <$1B return null → never enter court-buckets), so every classified name reaches members[].
    // excludedCount = SI-4 out-of-class names that entered members but score=null. classifiedCount = court-buckets entries.
    R.classifiedCount = cls.filter(c => c.bucket === bucket).length;
    R.excluded = members.filter(m => m.score == null);
    R.excludedCount = R.excluded.length;
    R.scoredCount = members.filter(m => m.score != null).length;
    if (require.main === module && R.classifiedCount !== R.scoredCount + R.excludedCount) {
      throw new Error(`SI-5 mismatch ${bucket}: classifiedCount ${R.classifiedCount} !== scoredCount ${R.scoredCount} + excludedCount ${R.excludedCount}`);
    }
    R.normTableId = getNormTableId(F.cohortKey);
    R.cohort = F.cohortKey;
    R.scoreScope = 'intra-bucket';
    R.crossBucketComparableField = 'absKaliber';
    const n = NORMS[F.cohortKey];
    const fmt = x => (x == null ? '—' : x.toFixed(2).replace(/^0\./, '.').replace(/^-0\./, '-.'));
    R.comparabilityNote = `materials_quality ${F.cohortKey} (pricing-power-vs-commodity cohort). absKaliber in [0,1] = cross-bucket-comparable absolute scale (5-axis weighted-q over the cohort NORMS '${getNormTableId(F.cohortKey)}': gpa ${fmt(n.gpa.floor)}/${fmt(n.gpa.elite)}, marginStability ${fmt(n.marginStability.floor)}/${fmt(n.marginStability.elite)} (identity-clip inverse-CV pricing-power proxy), growth ${fmt(n.growth.floor)}/${fmt(n.growth.elite)}, assetGrowthPenalty ${fmt(n.assetGrowthPenalty.floor)}/${fmt(n.assetGrowthPenalty.elite)}, netIssuance ${fmt(n.netIssuance.floor)}/${fmt(n.netIssuance.elite)}; weights {gpa .30, marginStability .20, growth .18, assetGrowthPenalty .18, netIssuance .14}; anti-commodity pillar gpa+marginStability+assetGrowthPenalty=.68 ≫ growth .18 — QUALITY-ONLY, a price-windfall spike cannot top-score). COVERAGE-RENORM drops any NOT_READY/null axis (incl. ISSUANCE_NOT_READY on the ~57% of names lacking annualShares, NOT_READY:marginstability on <3 opMargin points, and SPINOFF_REBASE) and renormalizes survivors to Σ=1.0 — no fake-neutral impute. The REL/core component is cross-sectional z/MAD PER COHORT (this bucket only) and is NOT cross-bucket comparable. blendScore mixes both (beta=0.6). WALLS always-on: CYCLE_WALL/COSTCURVE_BLIND/INVENTORY_BLIND/BYPRODUCT_BLIND/BACKLOG_FUTURE. The blended 0-100 'score' is INTRA-BUCKET ONLY; use absKaliber for cross-bucket comparison.`;
    R.crossBucketComparableNote = 'Use members[].absKaliber (absolute [0,1] caliber) for cross-bucket comparison; members[].score (blended 0-100) is intra-bucket ONLY (mixes per-cohort REL, beta=0.6).';
    R.walls = ['CYCLE_WALL', 'COSTCURVE_BLIND', 'INVENTORY_BLIND', 'BYPRODUCT_BLIND', 'BACKLOG_FUTURE'];
    // Axis-E coverage disclosure (Spec §2.2/§5): how many names took the ISSUANCE_NOT_READY drop+renorm path.
    R.issuanceCoverage = {
      scored: members.filter(m => m.netShareIssuance != null).length,
      dropped: members.filter(m => m.netShareIssuance == null).length,
    };
    // Axis-C coverage disclosure: how many names have a computable marginStability (>=3 opMargin points).
    R.marginStabilityCoverage = {
      scored: members.filter(m => m.marginStability != null).length,
      dropped: members.filter(m => m.marginStability == null).length,
    };
  }
  // energy_quality (CORE)-only Zusatzfelder (SI-3/4/5/6) — NUR auf den energy-Buckets gesetzt → alle anderen
  // Buckets byte-identisch (Parität). Mirrors the materials block; axis B = roce, axis C = fcfMargin, NO growth axis.
  if (F.energy) {
    // SI-5 (Spec §5): classifiedCount === scoredCount + excludedCount (fail-loud). The classifier assigns ONLY
    // energy_{upstream,midstream,services} (excluded industries / non-US per the country-domicile guard + FOREIGN_
    // hardening / <$1B return null → never enter court-buckets), so every classified name reaches members[].
    // excludedCount = SI-4 out-of-class / pre-revenue names that entered members but score=null.
    R.classifiedCount = cls.filter(c => c.bucket === bucket).length;
    R.excluded = members.filter(m => m.score == null);
    R.excludedCount = R.excluded.length;
    R.scoredCount = members.filter(m => m.score != null).length;
    if (require.main === module && R.classifiedCount !== R.scoredCount + R.excludedCount) {
      throw new Error(`SI-5 mismatch ${bucket}: classifiedCount ${R.classifiedCount} !== scoredCount ${R.scoredCount} + excludedCount ${R.excludedCount}`);
    }
    R.normTableId = getNormTableId(F.cohortKey);
    R.cohort = F.cohortKey;
    R.scoreScope = 'intra-bucket';
    R.crossBucketComparableField = 'absKaliber';
    const n = NORMS[F.cohortKey];
    const fmt = x => (x == null ? '—' : x.toFixed(2).replace(/^0\./, '.').replace(/^-0\./, '-.'));
    R.comparabilityNote = `energy_quality ${F.cohortKey} (through-cycle quality tier upstream/midstream/services). absKaliber in [0,1] = cross-bucket-comparable absolute scale (5-axis weighted-q over the cohort NORMS '${getNormTableId(F.cohortKey)}': roce ${fmt(n.roce.floor)}/${fmt(n.roce.elite)} (opInc/assets, the through-cycle capital-return PILLAR), fcfMargin ${fmt(n.fcfMargin.floor)}/${fmt(n.fcfMargin.elite)} (FCF/rev, capital discipline), gpa ${fmt(n.gpa.floor)}/${fmt(n.gpa.elite)}, assetGrowthPenalty ${fmt(n.assetGrowthPenalty.floor)}/${fmt(n.assetGrowthPenalty.elite)}, netIssuance ${fmt(n.netIssuance.floor)}/${fmt(n.netIssuance.elite)}; weights {roce .30, fcfMargin .22, assetGrowthPenalty .18, gpa .16, netIssuance .14}; capital-discipline pillar roce+fcfMargin+assetGrowthPenalty=.70 — GROWTH IS NOT A SCORED AXIS, so a commodity-price windfall cannot top-score; QUALITY-ONLY, no commodity-price bets). COVERAGE-RENORM drops any NOT_READY/null axis (incl. ISSUANCE_NOT_READY on the ~50% of names lacking annualShares) and renormalizes survivors to Σ=1.0 — no fake-neutral impute. The REL/core component is cross-sectional z/MAD PER COHORT (this bucket only) and is NOT cross-bucket comparable. blendScore mixes both (beta=0.6). WALLS always-on: CYCLE_WALL/THROUGH_CYCLE_WALL/COMMODITY_BETA${F.cohortKey === 'energy_upstream' ? '/RESERVE_BLIND' : F.cohortKey === 'energy_midstream' ? '/DCF_COVERAGE_BLIND' : ''}. The blended 0-100 'score' is INTRA-BUCKET ONLY; use absKaliber for cross-bucket comparison.`;
    R.crossBucketComparableNote = 'Use members[].absKaliber (absolute [0,1] caliber) for cross-bucket comparison; members[].score (blended 0-100) is intra-bucket ONLY (mixes per-cohort REL, beta=0.6).';
    R.walls = ['CYCLE_WALL', 'THROUGH_CYCLE_WALL', 'COMMODITY_BETA'].concat(
      F.cohortKey === 'energy_upstream' ? ['RESERVE_BLIND'] : F.cohortKey === 'energy_midstream' ? ['DCF_COVERAGE_BLIND'] : []);
    // Axis-E coverage disclosure (Spec §2/§4): how many names took the ISSUANCE_NOT_READY drop+renorm path.
    R.issuanceCoverage = {
      scored: members.filter(m => m.netShareIssuance != null).length,
      dropped: members.filter(m => m.netShareIssuance == null).length,
    };
  }
  // pharma_commercial (CORE)-only Zusatzfelder (SI-3/4/5/6) — NUR auf den pharma-Buckets gesetzt → alle anderen
  // Buckets byte-identisch (Parität). Mirrors the energy block; 3 axes {growth, gm, eff}, NO inverted discipline axes.
  if (F.pharma) {
    // SI-5 (Spec §6): classifiedCount === scoredCount + excludedCount (fail-loud). The classifier assigns ONLY the
    // §1.4-commercial pharma_{branded,biopharma,specialty} (non-pharma HC industries / non-US per the country-domicile
    // guard + FOREIGN hardening / <$1B / pre-commercial-clinical return null → never enter court-buckets), so every
    // classified name reaches members[]. excludedCount = SI-4 pre-revenue names that entered members but score=null.
    R.classifiedCount = cls.filter(c => c.bucket === bucket).length;
    R.excluded = members.filter(m => m.score == null);
    R.excludedCount = R.excluded.length;
    R.scoredCount = members.filter(m => m.score != null).length;
    if (require.main === module && R.classifiedCount !== R.scoredCount + R.excludedCount) {
      throw new Error(`SI-5 mismatch ${bucket}: classifiedCount ${R.classifiedCount} !== scoredCount ${R.scoredCount} + excludedCount ${R.excludedCount}`);
    }
    R.normTableId = getNormTableId(F.cohortKey);
    R.cohort = F.cohortKey;
    R.scoreScope = 'intra-bucket';
    R.crossBucketComparableField = 'absKaliber';
    const n = NORMS[F.cohortKey];
    const fmt = x => (x == null ? '—' : x.toFixed(2).replace(/^0\./, '.').replace(/^-0\./, '-.'));
    const thinRel = !!(n.rel && n.rel.suppressed);
    R.comparabilityNote = `pharma_commercial ${F.cohortKey} (commercial-stage quality tier branded/biopharma/specialty). absKaliber in [0,1] = cross-bucket-comparable absolute scale (3-axis weighted-q over the cohort NORMS '${getNormTableId(F.cohortKey)}': growth ${fmt(n.growth.floor)}/${fmt(n.growth.elite)} (cliff-aware organic, deal-masked + winsorized UPSTREAM), gm ${fmt(n.gm.floor)}/${fmt(n.gm.elite)} (annualGP/annualRev pricing-power), eff ${fmt(n.eff.floor)}/${fmt(n.eff.elite)} (FCF-margin primary, OpM fallback); weights {growth .45, gm .20, eff .35}; growth LEADS — the cliff-aware organic read separates compounders from the patent-cliff field). COVERAGE-RENORM drops any NOT_READY/null axis (fully-deal-masked growth, no-GP royalty gm) and renormalizes survivors to Σ=1.0 — no fake-neutral impute. ${thinRel ? 'THIN_REL: n<15 → ABS-only (beta=1.0), REL suppressed; score=100*absKaliber.' : 'The REL/core component is cross-sectional z/MAD PER COHORT (this bucket only) and is NOT cross-bucket comparable; blendScore mixes both (beta=0.6).'} WALLS always-on: PATENT_CLIFF_WALL (LOE-concentration uncomputable from companyfacts), MA_INTANGIBLE_BLIND (the design's intangible/IPR&D M&A signal needs the ABSENT external companyfacts join — pulling the network is forbidden — so M&A decontamination uses the LOCAL totalAssets-jump deal-mask only; the intangible-amortization-drag/ipr&d-acquirer lamps are SHIPPED OMITTED, disclosed coverage limitation)${thinRel ? '/THIN_REL' : ''}. The blended 0-100 'score' is INTRA-BUCKET ONLY; use absKaliber for cross-bucket comparison.`;
    R.crossBucketComparableNote = 'Use members[].absKaliber (absolute [0,1] caliber) for cross-bucket comparison; members[].score (blended 0-100) is intra-bucket ONLY (branded ABS-only beta=1.0; biopharma/specialty mix per-cohort REL beta=0.6).';
    R.walls = ['PATENT_CLIFF_WALL', 'MA_INTANGIBLE_BLIND'].concat(thinRel ? ['THIN_REL'] : []);
    // Axis coverage disclosure: how many names dropped the gm axis (no-GP royalty) or the growth axis (fully deal-masked).
    R.axisCoverage = {
      gmScored: members.filter(m => m._phGm != null).length,
      gmDropped: members.filter(m => m._phGm == null).length,
      growthScored: members.filter(m => m._phGrowth != null).length,
      growthDropped: members.filter(m => m._phGrowth == null).length,
    };
  }
  // it_services (CORE)-only Zusatzfelder (SI-3/4/5/6) — NUR auf dem it_services-Bucket gesetzt → alle anderen Buckets
  // byte-identisch (Parität). Mirrors the energy block; 5 axes {gpa, fcfMargin, opMargin, growth, netIssuance}.
  if (F.itservices) {
    // SI-5 (Spec §B.1): classifiedCount === scoredCount + excludedCount (fail-loud). The classifier assigns ONLY
    // it_services (non-IT-services tech industries / non-US per the country-domicile guard + FOREIGN hardening / <$1B /
    // contamination-gated return null → never enter court-buckets), so every classified name reaches members[].
    // excludedCount = SI-4 pre-revenue names that entered members but score=null.
    R.classifiedCount = cls.filter(c => c.bucket === bucket).length;
    R.excluded = members.filter(m => m.score == null);
    R.excludedCount = R.excluded.length;
    R.scoredCount = members.filter(m => m.score != null).length;
    if (require.main === module && R.classifiedCount !== R.scoredCount + R.excludedCount) {
      throw new Error(`SI-5 mismatch ${bucket}: classifiedCount ${R.classifiedCount} !== scoredCount ${R.scoredCount} + excludedCount ${R.excludedCount}`);
    }
    R.normTableId = getNormTableId(F.cohortKey);
    R.cohort = F.cohortKey;
    R.scoreScope = 'intra-bucket';
    R.crossBucketComparableField = 'absKaliber';
    const n = NORMS[F.cohortKey];
    const fmt = x => (x == null ? '—' : x.toFixed(2).replace(/^0\./, '.').replace(/^-0\./, '-.'));
    R.comparabilityNote = `it_services ${F.cohortKey} (people-leverage / low-capital-compounding cohort: Information Technology Services consulting/SI/BPO). absKaliber in [0,1] = cross-bucket-comparable absolute scale (5-axis weighted-q over the cohort NORMS '${getNormTableId(F.cohortKey)}': gpa ${fmt(n.gpa.floor)}/${fmt(n.gpa.elite)} (GP/assets, the asset-light low-capital-compounding proxy, the LEAD axis), fcfMargin ${fmt(n.fcfMargin.floor)}/${fmt(n.fcfMargin.elite)} (cash conversion), opMargin ${fmt(n.opMargin.floor)}/${fmt(n.opMargin.elite)} (pricing power), growth ${fmt(n.growth.floor)}/${fmt(n.growth.elite)} (organic, deal-masked UPSTREAM), netIssuance ${fmt(n.netIssuance.floor)}/${fmt(n.netIssuance.elite)} (q(-NSI), buyback=elite); weights {gpa .34, fcfMargin .24, opMargin .18, growth .14, netIssuance .10}; capital-discipline+profitability pillar gpa+fcfMargin+netIssuance=.68 ≫ growth .14. REVENUE-PER-EMPLOYEE IS NOT A SCORED AXIS (§B.2 — INVERTED on the live cohort, used only as the classifier contamination gate + an advisory flag, weight 0.00). COVERAGE-RENORM drops any NOT_READY/null axis (incl. ISSUANCE_NOT_READY on the ~50% of names lacking annualShares, SPINOFF_REBASE) and renormalizes survivors to Σ=1.0 — no fake-neutral impute. The REL/core component is cross-sectional z/MAD PER COHORT (this bucket only) and is NOT cross-bucket comparable. blendScore mixes both (beta=0.6). WALLS always-on: PEOPLE_LEVERAGE_BLIND (the FEASIBILITY DISCLOSURE — book-to-bill/utilization/attrition absent + RPE inverted+not-scored → NO axis directly measures people-leverage; the score leans on people-leverage-VIA-asset-efficiency gpa; mirrors medtech MA_INTANGIBLE_BLIND), BACKLOG_FUTURE/UTILIZATION_FUTURE/ATTRITION_FUTURE, CYCLE_WALL, INVENTORY_BLIND, PEOPLE_DATA_PARTIAL (headcount ~55% coverage). The blended 0-100 'score' is INTRA-BUCKET ONLY; use absKaliber for cross-bucket comparison.`;
    R.crossBucketComparableNote = 'Use members[].absKaliber (absolute [0,1] caliber) for cross-bucket comparison; members[].score (blended 0-100) is intra-bucket ONLY (mixes per-cohort REL, beta=0.6).';
    R.walls = ['PEOPLE_LEVERAGE_BLIND', 'BACKLOG_FUTURE', 'UTILIZATION_FUTURE', 'ATTRITION_FUTURE', 'CYCLE_WALL', 'INVENTORY_BLIND', 'PEOPLE_DATA_PARTIAL'];
    // Axis-T5 coverage disclosure (§B.3): how many names took the ISSUANCE_NOT_READY drop+renorm path.
    R.issuanceCoverage = {
      scored: members.filter(m => m.netShareIssuance != null).length,
      dropped: members.filter(m => m.netShareIssuance == null).length,
    };
    // §B.2/§B.6 people-data coverage disclosure: how many names carry headcount (RPE advisory computable).
    R.peopleDataCoverage = {
      withHeadcount: members.filter(m => m.revPerEmployee != null).length,
      withoutHeadcount: members.filter(m => m.revPerEmployee == null).length,
    };
  }
  // tech_hardware_quality (CORE court bucket)-only Zusatzfelder (SI-3/4/5/6) — NUR auf dem tech_hardware_quality-Bucket
  // gesetzt → alle anderen Buckets byte-identisch (Parität). Mirrors the it_services block; 5 axes {gpa, fcfMargin,
  // opMargin, growth, netIssuance}.
  if (F.techhw) {
    // SI-5: classifiedCount === scoredCount + excludedCount (fail-loud). The classifier assigns ONLY tech_hardware_quality
    // (non-hardware industry / non-US per the de-ADR country-domicile guard + FOREIGN_NAME + TECHHW_FOREIGN_DROP / <$1B /
    // dual-class-dupe return null → never enter court-buckets), so every classified name reaches members[]. excludedCount
    // = SI-4 SHELL names (no positive rev / no totalAssets in any year) that entered members but score=null.
    R.classifiedCount = cls.filter(c => c.bucket === bucket).length;
    R.excluded = members.filter(m => m.score == null);
    R.excludedCount = R.excluded.length;
    R.scoredCount = members.filter(m => m.score != null).length;
    if (require.main === module && R.classifiedCount !== R.scoredCount + R.excludedCount) {
      throw new Error(`SI-5 mismatch ${bucket}: classifiedCount ${R.classifiedCount} !== scoredCount ${R.scoredCount} + excludedCount ${R.excludedCount}`);
    }
    R.normTableId = getNormTableId(F.cohortKey);
    R.cohort = F.cohortKey;
    R.scoreScope = 'intra-bucket';
    R.crossBucketComparableField = 'absKaliber';
    const n = NORMS[F.cohortKey];
    const fmt = x => (x == null ? '—' : x.toFixed(2).replace(/^0\./, '.').replace(/^-0\./, '-.'));
    R.comparabilityNote = `tech_hardware_quality ${F.cohortKey} (durable hardware-FRANCHISE cohort: the bimodal HARDWARE peer group re-ranked by an absolute-anchor so margin-stable franchises beat commodity contract-mfg + loss-making cyclicals). absKaliber in [0,1] = cross-bucket-comparable absolute scale (5-axis weighted-q over the cohort NORMS '${getNormTableId(F.cohortKey)}' via the REUSED absKaliberItServices engine: gpa ${fmt(n.gpa.floor)}/${fmt(n.gpa.elite)} (GP/assets, THE franchise vs commodity-contract-mfg separator, the LEAD axis), fcfMargin ${fmt(n.fcfMargin.floor)}/${fmt(n.fcfMargin.elite)} (cash conversion), opMargin ${fmt(n.opMargin.floor)}/${fmt(n.opMargin.elite)} (pricing power vs the cycle), growth ${fmt(n.growth.floor)}/${fmt(n.growth.elite)} (organic, deal-masked UPSTREAM, SECONDARY), netIssuance ${fmt(n.netIssuance.floor)}/${fmt(n.netIssuance.elite)} (q(-NSI), buyback=elite); weights {gpa .34, fcfMargin .24, opMargin .18, growth .14, netIssuance .10}; profitability+discipline pillar gpa+fcfMargin+netIssuance=.68 ≫ growth .14, the opMargin+fcfMargin margin pillar .42 is the bimodality separator. NO contamination gate — the absolute floor sinks the commodity contract-mfg (FLEX/JBL/BHE/SANM/PLXS) below the floor → off the headlineShortlist. COVERAGE-RENORM drops any NOT_READY/null axis (incl. ISSUANCE_NOT_READY on the ~52% of names lacking annualShares, SPINOFF_REBASE) and renormalizes survivors to Σ=1.0 — no fake-neutral impute. The REL/core component is cross-sectional z/MAD PER COHORT (this bucket only) and is NOT cross-bucket comparable. blendScore mixes both (beta=0.6). WALLS always-on: CYCLE_WALL (~4y history, no through-cycle semi/comms normalization), INVENTORY_BLIND, BACKLOG_FUTURE, BOOK_TO_BILL_BLIND. The blended 0-100 'score' is INTRA-BUCKET ONLY; use absKaliber for cross-bucket comparison.`;
    R.crossBucketComparableNote = 'Use members[].absKaliber (absolute [0,1] caliber) for cross-bucket comparison; members[].score (blended 0-100) is intra-bucket ONLY (mixes per-cohort REL, beta=0.6).';
    R.walls = ['CYCLE_WALL', 'INVENTORY_BLIND', 'BACKLOG_FUTURE', 'BOOK_TO_BILL_BLIND'];
    // Axis-H5 coverage disclosure: how many names took the ISSUANCE_NOT_READY drop+renorm path.
    R.issuanceCoverage = {
      scored: members.filter(m => m.netShareIssuance != null).length,
      dropped: members.filter(m => m.netShareIssuance == null).length,
    };
  }
  // financials_banks (CORE court bucket)-only Zusatzfelder (SI-3/4/5/6) — NUR auf dem financials_banks-Bucket gesetzt
  // → alle anderen Buckets byte-identisch (Parität). Mirrors the it_services block; 4 axes {roaThruCycle,
  // capitalAdequacy, assetGrowthDiscipline, earningsDurability}.
  if (F.banks) {
    // SI-5: classifiedCount === scoredCount + excludedCount (fail-loud). The classifier assigns ONLY financials_banks
    // (non-bank industry / non-US per the de-ADRd country-domicile guard + FOREIGN_NAME + BANK_FOREIGN_DROP / <$1B /
    // preferred-dual-class-dupe return null → never enter court-buckets), so every classified name reaches members[].
    // excludedCount = SI-4 SHELL names (no positive NI / no balance sheet, e.g. MCHB) that entered members but score=null.
    R.classifiedCount = cls.filter(c => c.bucket === bucket).length;
    R.excluded = members.filter(m => m.score == null);
    R.excludedCount = R.excluded.length;
    R.scoredCount = members.filter(m => m.score != null).length;
    if (require.main === module && R.classifiedCount !== R.scoredCount + R.excludedCount) {
      throw new Error(`SI-5 mismatch ${bucket}: classifiedCount ${R.classifiedCount} !== scoredCount ${R.scoredCount} + excludedCount ${R.excludedCount}`);
    }
    // FOREIGN-DENY anti-leak assert (court revision #2): assert on the foreign-DENY SIGNAL, NEVER on country!=US (that
    // would throw on the legitimate country=undefined US banks JPM/PNC/USB/MTB). A classified member whose ticker is in
    // the known foreign-megabank DENY set is a de-ADR regression → fail-loud.
    if (require.main === module) {
      const leaked = members.filter(m => BANK_FOREIGN_DENY.has(m.ticker));
      if (leaked.length) {
        throw new Error('FOREIGN-DENY ANTI-LEAK FAIL (court revision #2) — foreign megabank ADR(s) reached financials_banks: '
          + leaked.map(m => m.ticker).join(', '));
      }
    }
    R.normTableId = getNormTableId(F.cohortKey);
    R.cohort = F.cohortKey;
    R.scoreScope = 'intra-bucket';
    R.crossBucketComparableField = 'absKaliber';
    const n = NORMS[F.cohortKey];
    const fmt = x => (x == null ? '—' : x.toFixed(4).replace(/^0\./, '.').replace(/^-0\./, '-.'));
    R.comparabilityNote = `financials_banks ${F.cohortKey} (deposit-funded US-bank through-cycle quality cohort: Banks - Regional + Diversified). absKaliber in [0,1] = cross-bucket-comparable absolute scale (4-axis weighted-q over the cohort NORMS '${getNormTableId(F.cohortKey)}': roaThruCycle ${fmt(n.roaThruCycle.floor)}/${fmt(n.roaThruCycle.elite)} (4y-avg NI/totalAssets, the through-cycle LEAD pillar), capitalAdequacy ${fmt(n.capitalAdequacy.floor)}/${fmt(n.capitalAdequacy.elite)} (totalEquity/totalAssets CET1 surrogate; ~45% NULL incl. JPM/WFC/PNC → DROP+renorm, NEVER imputed), assetGrowthDiscipline ${fmt(n.assetGrowthDiscipline.floor)}/${fmt(n.assetGrowthDiscipline.elite)} (q(-assetGrowthYoY) PENALTY — zero balance-sheet growth is elite, ballooning penalized; the CORRECT sign for banks, opposite of utils/REITs), earningsDurability ${fmt(n.earningsDurability.floor)}/${fmt(n.earningsDurability.elite)} (min/max NI over >=3y, LOW weight, BLIND-walled); weights {roaThruCycle .50, capitalAdequacy .25, assetGrowthDiscipline .18, earningsDurability .07}. FCF/OCF are HARD-EXCLUDED (economically meaningless for banks — JPM annualFCF[0]=-$147.8B). COVERAGE-RENORM drops any NOT_READY/null axis (the load-bearing capitalAdequacy DROP on ~45% of the pool) and renormalizes survivors to Σ=1.0 — no fake-neutral impute. The REL/core component is cross-sectional z/MAD PER COHORT (this bucket only) and is NOT cross-bucket comparable. blendScore mixes both (beta=0.6, n=128≫15). WALLS always-on: CREDIT_QUALITY_BLIND (NPLs/charge-offs/provisions absent — the single most important bank dimension), NIM_BLIND, EFFICIENCY_RATIO_BLIND, CET1_BLIND (regulatory RWA absent — capitalAdequacy is a raw equity/assets surrogate), DEPOSIT_FRANCHISE_BLIND. The blended 0-100 'score' is INTRA-BUCKET ONLY; use absKaliber for cross-bucket comparison.`;
    R.crossBucketComparableNote = 'Use members[].absKaliber (absolute [0,1] caliber) for cross-bucket comparison; members[].score (blended 0-100) is intra-bucket ONLY (mixes per-cohort REL, beta=0.6).';
    R.walls = ['CREDIT_QUALITY_BLIND', 'NIM_BLIND', 'EFFICIENCY_RATIO_BLIND', 'CET1_BLIND', 'DEPOSIT_FRANCHISE_BLIND'];
    // capitalAdequacy DROP+renorm coverage disclosure (court revision #4): how many names took the CAPADEQ_DROPPED path.
    R.capitalAdequacyCoverage = {
      scored: members.filter(m => m.capitalAdequacy != null).length,
      dropped: members.filter(m => m.capitalAdequacy == null).length,   // ~45% incl. JPM/WFC/PNC/USB (totalEquity absent)
    };
  }
  // equity_reits (CORE court bucket)-only Zusatzfelder (SI-3/4/5/6) — NUR auf dem equity_reits-Bucket gesetzt → alle
  // anderen Buckets byte-identisch (Parität). Mirrors the banks block; 4 axes {opMargin, ffoAssets, revG3, ndGA}.
  if (F.reits) {
    // SI-5: classifiedCount === scoredCount + excludedCount (fail-loud). The classifier assigns ONLY equity_reits
    // (non-equity-REIT industry incl. REIT - Mortgage / non-US per the de-ADRd guard / <$1B / OTC pink-sheet return null
    // → never enter court-buckets), so every classified name reaches members[]. excludedCount = SI-4 SHELL names
    // (<3 positive-revenue-years / no balance sheet, e.g. BXDC/FRMI/MRP/JAN) that entered members but score=null.
    R.classifiedCount = cls.filter(c => c.bucket === bucket).length;
    R.excluded = members.filter(m => m.score == null);
    R.excludedCount = R.excluded.length;
    R.scoredCount = members.filter(m => m.score != null).length;
    if (require.main === module && R.classifiedCount !== R.scoredCount + R.excludedCount) {
      throw new Error(`SI-5 mismatch ${bucket}: classifiedCount ${R.classifiedCount} !== scoredCount ${R.scoredCount} + excludedCount ${R.excludedCount}`);
    }
    // MORTGAGE-REIT anti-leak assert (court revision #0): a classified member whose ticker is in the known mortgage-REIT
    // DENY set is a hard-separation regression (mortgage REITs are a different animal — book-value/leverage, not FFO/NOI)
    // → fail-loud.
    if (require.main === module) {
      const leaked = members.filter(m => REIT_MORTGAGE_DENY.has(m.ticker));
      if (leaked.length) {
        throw new Error('MORTGAGE-REIT ANTI-LEAK FAIL (court revision #0) — mortgage REIT(s) reached equity_reits: '
          + leaked.map(m => m.ticker).join(', '));
      }
    }
    R.normTableId = getNormTableId(F.cohortKey);
    R.cohort = F.cohortKey;
    R.scoreScope = 'intra-bucket';
    R.crossBucketComparableField = 'absKaliber';
    const n = NORMS[F.cohortKey];
    const fmt = x => (x == null ? '—' : x.toFixed(4).replace(/^0\./, '.').replace(/^-0\./, '-.'));
    R.comparabilityNote = `equity_reits ${F.cohortKey} (equity-REIT through-cycle quality cohort: the eight property types Retail/Office/Industrial/Residential/Diversified/Healthcare/Specialty/Hotel; REIT - Mortgage HARD-SEPARATED OUT — a different animal). absKaliber in [0,1] = cross-bucket-comparable absolute scale (4-axis weighted-q over the cohort NORMS '${getNormTableId(F.cohortKey)}': opMargin ${fmt(n.opMargin.floor)}/${fmt(n.opMargin.elite)} (annualOpInc/annualRev NOI-margin proxy), ffoAssets ${fmt(n.ffoAssets.floor)}/${fmt(n.ffoAssets.elite)} ((NI+D&A)/totalAssets FFO yield; ~52% lack annualDepreciation incl. the top-tier VICI/O/PLD/TRNO → DROP+renorm, NEVER imputed — the headline FFO metric is absent for several top names; they are scored on opMargin+revG3+ndGA renormed, FFO_COVERAGE_PARTIAL), revG3 ${fmt(n.revG3.floor)}/${fmt(n.revG3.elite)} ((rev[0]/rev[3])^(1/3)-1 rent-base 3y CAGR), ndGA leverage discipline ${fmt(n.ndGA.floor)}/${fmt(n.ndGA.elite)} (q(-net-debt/assets) INVERTED + LEVEL-scored — lower net-debt/assets is better, ~29% scores elite / ~60% floor, GENEROUS so only the OVER-levered lose points; NOT the industrials asset-GROWTH penalty); weights {opMargin .30, ffoAssets .30, revG3 .25, ndGA .15}. FFO ≈ NI+D&A omits the gains-on-property-sales subtraction (no field) → the FFO-GAINS GUARD caps the ffoAssets observation when (NI+dep)/OCF > 1.2 (gains-inflated, e.g. SPG ffo/ocf 1.49), FFO_GAINS_INFLATED + residual FFO_GAINS_BLIND. COVERAGE-RENORM drops any NOT_READY/null axis (the load-bearing ffoAssets DROP on ~52% of the pool) and renormalizes survivors to Σ=1.0 — no fake-neutral impute. The REL/core component is cross-sectional z/MAD PER COHORT (this bucket only) and is NOT cross-bucket comparable. blendScore mixes both (beta=0.6, n=114≫15). WALLS always-on: SAME_STORE_NOI_BLIND (same-store NOI growth absent — the organic-quality gold standard), OCCUPANCY_BLIND, NAV_PREMIUM_BLIND (and it is VALUATION — excluded by design), AFFO_MAINT_CAPEX_BLIND (maintenance-capex split absent → AFFO approximate), FFO_GAINS_BLIND. The blended 0-100 'score' is INTRA-BUCKET ONLY; use absKaliber for cross-bucket comparison.`;
    R.crossBucketComparableNote = 'Use members[].absKaliber (absolute [0,1] caliber) for cross-bucket comparison; members[].score (blended 0-100) is intra-bucket ONLY (mixes per-cohort REL, beta=0.6).';
    R.walls = ['SAME_STORE_NOI_BLIND', 'OCCUPANCY_BLIND', 'NAV_PREMIUM_BLIND', 'AFFO_MAINT_CAPEX_BLIND', 'FFO_GAINS_BLIND'];
    // ffoAssets DROP+renorm coverage disclosure (court revision #3): how many names took the FFO_COVERAGE_PARTIAL path
    // (annualDepreciation absent → ffoAssets dropped, scored on opMargin+revG3+ndGA renormed).
    R.ffoCoverage = {
      scored: members.filter(m => m.ffoAssets != null).length,
      dropped: members.filter(m => m.ffoAssets == null).length,         // ~52% incl. VICI/O/PLD/TRNO (annualDepreciation absent)
    };
  }
  // capmkt_fee_core (CORE court bucket)-only Zusatzfelder (SI-3/4/5/6) — NUR auf dem capmkt_fee_core-Bucket gesetzt →
  // alle anderen Buckets byte-identisch (Parität). Mirrors the reits block; 4 axes {opMargin, opMarginStability,
  // fcfMargin, netIssuance}.
  if (F.capmkt) {
    // SI-5: classifiedCount === scoredCount + excludedCount (fail-loud). The classifier assigns ONLY capmkt_fee_core
    // (non-fee industry / non-US per the de-ADRd guard / <$1B / fee-gated (fcfMargin>1.0 or niMargin>=0.95) return null
    // → never enter court-buckets), so every classified name reaches members[]. excludedCount = SI-4 SHELL names
    // (<2 positive-revenue-years / no revenue) that entered members but score=null.
    R.classifiedCount = cls.filter(c => c.bucket === bucket).length;
    R.excluded = members.filter(m => m.score == null);
    R.excludedCount = R.excluded.length;
    R.scoredCount = members.filter(m => m.score != null).length;
    if (require.main === module && R.classifiedCount !== R.scoredCount + R.excludedCount) {
      throw new Error(`SI-5 mismatch ${bucket}: classifiedCount ${R.classifiedCount} !== scoredCount ${R.scoredCount} + excludedCount ${R.excludedCount}`);
    }
    // FEE-GATE / FOREIGN anti-leak assert (court revision #1/#2): a classified member whose ticker is in the known
    // fund-float / closed-end-fund DENY set is a fee-gate regression → fail-loud. (The country-SET foreign anti-leak is
    // the generative assertCapmktNoForeignLeak below; here we assert on the fee-gate DENY SIGNAL.)
    if (require.main === module) {
      const leaked = members.filter(m => CAPMKT_FEEGATE_DENY.has(m.ticker));
      if (leaked.length) {
        throw new Error('FEE-GATE ANTI-LEAK FAIL (court revision #1) — fund-float / closed-end-fund pass-through artifact(s) reached capmkt_fee_core: '
          + leaked.map(m => m.ticker).join(', '));
      }
    }
    R.normTableId = getNormTableId(F.cohortKey);
    R.cohort = F.cohortKey;
    R.scoreScope = 'intra-bucket';
    R.crossBucketComparableField = 'absKaliber';
    const n = NORMS[F.cohortKey];
    const fmt = x => (x == null ? '—' : x.toFixed(4).replace(/^0\./, '.').replace(/^-0\./, '-.'));
    R.comparabilityNote = `capmkt_fee_core ${F.cohortKey} (asset-light fee-business through-cycle quality cohort: exchanges/rating/index-data/asset-managers/brokers). absKaliber in [0,1] = cross-bucket-comparable absolute scale (4-axis weighted-q over the cohort NORMS '${getNormTableId(F.cohortKey)}': opMargin ${fmt(n.opMargin.floor)}/${fmt(n.opMargin.elite)} (annualOpInc/annualRev level, the fee-franchise pricing power), opMarginStability ${fmt(n.opMarginStability.floor)}/${fmt(n.opMarginStability.elite)} (1-CV(opMargin) identity-clip, a through-cycle pricing-durability proxy; ~18% null → DROP+renorm), fcfMargin ${fmt(n.fcfMargin.floor)}/${fmt(n.fcfMargin.elite)} (annualFCF/annualRev cash conversion), netIssuance ${fmt(n.netIssuance.floor)}/${fmt(n.netIssuance.elite)} (q(-net-share-issuance) INVERTED, buyback=elite; ~54% lack annualShares → DROP+renorm, NEVER imputed); weights {opMargin .30, opMarginStability .30, fcfMargin .25, netIssuance .15}. THE ECONOMIC FEE-GATE (court revision #1 + RE-COURT 2026-06-24, FOUR arms) removed 71 artifacts at classification: fcfMargin>1.0 FUND_FLOAT (KYN/APO/IBKR; 16) + niMargin>=0.95 RIC_PASSTHROUGH (40-Act closed-end funds NMZ/NUV/TY/ADX/GAB; 39) + BDC_SPREAD_LOAN_BOOK (RE-COURT — the DENIAL cause: 11 leveraged-spread-lender BDCs OBDC/GSBD/TSLX/MSDL/FSK/GBDC/OTF/ARCC/BXSL/CSWC/HTGC that had topped the contaminated cohort; revToAssets∈[.05,.16] ∧ totalDebt=null ∧ liabilities/equity∈[.7,2.0] regulated-BDC signature; spares Carlyle/CG at TL/TE 3.83) + CRYPTO_MINER_NON_FEE (RE-COURT — 5 commodity miners CLSK/HIVE/MARA/RIOT/WULF; opMargin<0 all years ∧ mean NI/FCF margins <-.20; spares COIN/HOOD/CG/BWIN) — EXCLUDE-not-cap because each is a different animal. COUNTRY NORMALIZE (court revision #2): the country=undefined US names MSCI/MCO/ICE/NDAQ/KKR are RETAINED via the positive US-primary test (US exchange + USD + no foreign legal-form name). COVERAGE-RENORM drops any NOT_READY/null axis (the load-bearing netIssuance DROP on ~57% of the pool) and renormalizes survivors to Σ=1.0 — no fake-neutral impute. The REL/core component is cross-sectional z/MAD PER COHORT (this bucket only) and is NOT cross-bucket comparable. blendScore mixes both (beta=0.6, n=84≫15). WALLS always-on: AUM_FLOW_BLIND (AUM net flows / organic AUM growth — the fee-engine fuel — absent), FEE_RATE_BLIND (fee-rate/take-rate compression absent), RECURRING_MIX_BLIND (recurring vs transactional/performance-fee mix absent), BDC_SPREAD_BLIND (now largely MOOT — the 11 BDCs are hard-gated OUT by arm 3, not scored — kept as a structural disclosure for future borderline lenders). The blended 0-100 'score' is INTRA-BUCKET ONLY; use absKaliber for cross-bucket comparison.`;
    R.crossBucketComparableNote = 'Use members[].absKaliber (absolute [0,1] caliber) for cross-bucket comparison; members[].score (blended 0-100) is intra-bucket ONLY (mixes per-cohort REL, beta=0.6).';
    R.walls = ['AUM_FLOW_BLIND', 'FEE_RATE_BLIND', 'RECURRING_MIX_BLIND', 'BDC_SPREAD_BLIND'];
    // netIssuance DROP+renorm coverage disclosure: how many names took the ISSUANCE_NOT_READY path (annualShares absent).
    R.netIssuanceCoverage = {
      scored: members.filter(m => m.netShareIssuance != null).length,
      dropped: members.filter(m => m.netShareIssuance == null).length,   // ~54% (annualShares absent on Vintage-A)
    };
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
    // industrials_compounder (CORE) EXEMPTION: industrials membership is governed by the FROZEN spec classifier
    // (scripts/classify-industrials.js, §6.2 vintage-tolerant isUSListing) which DELIBERATELY admits USD/NYSE
    // foreign-domiciled industrials whose primary listing is US (the §1.2 inversion clause: ETN/ALLE/AER + the
    // USD/NYSE Canadian/EU rails CNI/CP/CDLR/ATS/CAE/MDA/STN/FER), governed instead by the §6.2b marquee
    // assert + SI-5. The C5 listing.isUS flag uses court-screen's STRICTER test (region==='US' only) for the
    // saas/fabless/medtech/dlst buckets and would false-positive on the spec's intended industrials pool.
    // The §1.2/§7-#12 leak policy (ZTO disclosed) is the industrials governance — not this cross-bucket guard.
    if (bucket === 'industrials_heavy' || bucket === 'industrials_light') continue;
    // consumer_staples_compounder (CORE) EXEMPTION: staples membership is governed by the FROZEN spec v1
    // classifier (scripts/classify-staples.js, §1.2 COUNTRY-DOMICILE-GUARD isUSListing — STRICTER than
    // court-screen's: country set != US -> exclude unconditionally; FOREIGN_NAME legal-form regex; 1-name
    // residual RLX). It is governed instead by the §6.2b assertStaplesMarquee + the staples-native generative
    // country assert + the FOREIGN_CONTROL positive-control (assertStaplesForeignControl) below — all of which
    // read the snapshot meta directly, NOT the C5 court-listing.isUS flag (which uses court-screen's looser
    // region==='US' test and could disagree with the spec classifier on the staples pool).
    if (bucket === 'staples_branded' || bucket === 'staples_distribution') continue;
    // consdisc_expansion (CORE) EXEMPTION: consdisc membership is governed by the FROZEN spec v1 classifier
    // (scripts/classify-consdisc.js, §1.2 COUNTRY-DOMICILE-GUARD isUSListing — STRICTER than court-screen's:
    // country set != US -> exclude unconditionally; FOREIGN_NAME legal-form regex; the verified Vintage-A
    // foreign-primary residual JD/PDD/RERE/MELI/YUMC/ONON/QSR). It is governed instead by the §6.2b
    // assertConsdiscMarquee (marquee + foreign-exclude positive-control) below, which reads the snapshot meta
    // directly via the classifier, NOT the C5 court-listing.isUS flag (which uses court-screen's looser
    // region==='US' test and could disagree with the spec classifier on the consdisc pool). Disclosed: on the
    // mixed-vintage live pool the consdisc cohort is LARGER than the spec's 2026-06-08 recompute (genuine US
    // discretionary large-caps the smaller pool omitted) — that is honest pool growth, not a leak.
    if (bucket === 'consdisc_store' || bucket === 'consdisc_light') continue;
    // materials_quality (CORE) EXEMPTION: materials membership is governed by the FROZEN spec v0 classifier
    // (scripts/classify-materials.js, §6 country-domicile guard — STRICTER than court-screen's: country set
    // != US -> exclude unconditionally; FOREIGN_NAME legal-form regex; FOREIGN_PRIMARY_RESIDUAL = RIO/SCCO/PKX/
    // KGC/WPM/PAAS/SVM; and a name-verified US_PRIMARY_ALLOWLIST = {CRH,LIN} for the verified US-PRIMARY
    // foreign-domiciled compounders the design NAMES as marquees). It is governed instead by the §6 marquee
    // assert + the materials-native generative country assert (assertMaterialsNoForeignLeak) + the FOREIGN_
    // CONTROL positive-control (assertMaterialsMarquee) below — all reading the snapshot meta via the spec
    // classifier, NOT the C5 court-listing.isUS flag (which uses court-screen's looser region==='US' test and
    // would false-flag the allowlisted CRH/LIN US-primaries the spec deliberately admits).
    if (bucket === 'materials_pricingpower' || bucket === 'materials_commodity') continue;
    // energy_quality (CORE) EXEMPTION: energy membership is governed by the FROZEN spec v0 classifier
    // (scripts/classify-energy.js, §6 country-domicile guard — STRICTER than court-screen's: country set != US ->
    // exclude unconditionally; FOREIGN_NAME legal-form regex; the frozen ENERGY_FOREIGN_DROP ADR/tanker set; and a
    // name-verified US_PRIMARY_ALLOWLIST = {SLB} for the verified US-PRIMARY foreign-NAME flagship the design NAMES
    // as a marquee). It is governed instead by the §6 marquee assert + the energy-native generative country assert
    // (assertEnergyNoForeignLeak) + the FOREIGN_CONTROL positive-control (assertEnergyMarquee) below — all reading
    // the snapshot meta via the spec classifier, NOT the C5 court-listing.isUS flag (which uses court-screen's
    // looser region==='US' test and would false-flag the allowlisted SLB US-primary the spec deliberately admits).
    if (bucket === 'energy_upstream' || bucket === 'energy_midstream' || bucket === 'energy_services') continue;
    // pharma_commercial (CORE) EXEMPTION: pharma membership is governed by the FROZEN spec v0 classifier
    // (scripts/classify-pharma.js, §1.2 country-domicile guard — STRICTER than court-screen's: country set != US ->
    // exclude unconditionally; FOREIGN_NAME legal-form regex; the 5-letter pink-sheet ADR rule; the frozen
    // PHARMA_FOREIGN_DROP set; and a name-verified US_PRIMARY_ALLOWLIST = {JAZZ} for the verified US-PRIMARY
    // foreign-NAME flagship the design NAMES as a marquee). It is governed instead by the §6 marquee assert + the
    // pharma-native generative country assert (assertPharmaNoForeignLeak) + the FOREIGN_CONTROL positive-control
    // (assertPharmaMarquee) below — all reading the snapshot meta via the spec classifier, NOT the C5 court-listing.
    // isUS flag (which uses court-screen's looser region==='US' test and would false-flag the allowlisted JAZZ).
    if (bucket === 'pharma_branded' || bucket === 'pharma_biopharma' || bucket === 'pharma_specialty') continue;
    // it_services (CORE) EXEMPTION: it_services membership is governed by the FROZEN spec classifier (scripts/
    // classify-itservices.js, PART B §B.1 country-domicile guard — STRICTER than court-screen's: country set != US ->
    // exclude unconditionally; FOREIGN_NAME legal-form regex; the 5-letter pink-sheet ADR rule; and a name-verified
    // US_PRIMARY_ALLOWLIST = {ACN,G,INFY,GLOB} for the verified US-PRIMARY / design-marquee foreign-domiciled flagships
    // — Accenture plc Ireland / Genpact Ltd Bermuda / Globant S.A. Luxembourg, all NYSE-primary, + Infosys Ltd
    // Vintage-A). It is governed instead by the §B.1 marquee assert + the it_services-native generative country assert
    // (assertItServicesNoForeignLeak) + the CONTAM/FOREIGN positive-control (assertItServicesMarquee) below — all
    // reading the snapshot meta via the spec classifier, NOT the C5 court-listing.isUS flag (which uses court-screen's
    // looser region==='US' test; note ACN/G/GLOB carry isUS===true via region==='US' so even C5 would not flag them,
    // but the exemption keeps the governance consistent with the other 6 CORE buckets and the allowlist explicit).
    if (bucket === 'it_services') continue;
    // tech_hardware_quality (CORE) EXEMPTION: governed by the FROZEN spec classifier (scripts/classify-techhw.js
    // country-domicile guard — STRICTER than court-screen's: country set != US -> exclude unconditionally; FOREIGN_NAME
    // legal-form regex; the 5-letter pink-sheet ADR rule; and a name-verified US_PRIMARY_ALLOWLIST = {GRMN} for the
    // verified US-PRIMARY / design-marquee foreign-domiciled flagship Garmin Ltd Switzerland NYSE-primary). It is
    // governed instead by the marquee assert + the techhw-native generative country assert (assertTechHwNoForeignLeak)
    // + the FOREIGN positive-control (assertTechHwMarquee) below — all reading the snapshot meta via the spec classifier,
    // NOT the C5 court-listing.isUS flag (which uses court-screen's looser region==='US' test and would false-flag GRMN,
    // which carries country=Switzerland but is a genuine US primary the design admits).
    if (bucket === 'tech_hardware_quality') continue;
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

// --- industrials_compounder (CORE) MARQUEE-COVERAGE assert (Spec §6.2b, fail-loud) ---
// SI-5 identity alone does NOT catch the v0 killshot (a silently-dropped name is consistently absent from
// BOTH classified and scored counts, so the identity still balances). The frozen marquee watchlist must each
// be classified into one of the two industrials cohorts AND reach the scored universe (members[]) — else the
// run DIES LOUD. This is the regression guard that would have caught the v0 country bug.
const INDUSTRIALS_MARQUEE = Object.freeze(['RTX', 'LMT', 'NOC', 'UNP', 'NSC', 'WM', 'RSG', 'ITW', 'PH', 'ETN', 'GD', 'EMR', 'CAT', 'DE', 'BA', 'GE']);
function assertIndustrialsMarquee(resultsObj) {
  const H = resultsObj.industrials_heavy, Lt = resultsObj.industrials_light;
  if (!H && !Lt) return; // industrials not in this run (e.g. isolated unit test) → tolerant no-op
  const scored = new Set();
  for (const R of [H, Lt]) if (R && Array.isArray(R.members)) for (const m of R.members) scored.add(m.ticker);
  const missing = INDUSTRIALS_MARQUEE.filter(t => !scored.has(t));
  if (missing.length) {
    throw new Error('MARQUEE COVERAGE FAIL (Spec §6.2b) — industrials universe collapsed, these bona-fide '
      + 'US large-caps were not classified/scored: ' + missing.join(', '));
  }
}

// --- consumer_staples_compounder (CORE) MARQUEE-COVERAGE assert (Spec §6.2b, fail-loud) ---
// The frozen marquee watchlist must each be classified into one of the two staples cohorts AND reach the
// scored universe (members[]) — else the run DIES LOUD (the regression guard that would have caught the v0
// foreign-primary leak collapsing the universe).
const STAPLES_MARQUEE = Object.freeze(['PG', 'KO', 'PEP', 'COST', 'WMT', 'MDLZ', 'CL', 'MO', 'PM']);
// GENERATIVE anti-leak property test (§6.2b): NO classified staples record may carry meta.country set != US.
// FOREIGN_CONTROL positive-control (§6.2b): the undefined-country foreign primaries the classifier's
// FOREIGN_NAME regex + residual set must keep OUT (the property test cannot see them — they have no country).
const STAPLES_FOREIGN_CONTROL = Object.freeze(['KOF', 'RLX', 'DOLE', 'HLF', 'NOMD']);
function assertStaplesMarquee(resultsObj) {
  const B = resultsObj.staples_branded, D = resultsObj.staples_distribution;
  if (!B && !D) return; // staples not in this run (e.g. isolated unit test) → tolerant no-op
  const scored = new Set();
  for (const R of [B, D]) if (R && Array.isArray(R.members)) for (const m of R.members) scored.add(m.ticker);
  const missing = STAPLES_MARQUEE.filter(t => !scored.has(t));
  if (missing.length) {
    throw new Error('MARQUEE COVERAGE FAIL (Spec §6.2b) — staples universe collapsed, these bona-fide '
      + 'US staples were not classified/scored: ' + missing.join(', '));
  }
  // (1) FOREIGN_CONTROL: KOF/RLX/DOLE/HLF/NOMD must NOT have reached a staples cohort.
  const leakedControl = STAPLES_FOREIGN_CONTROL.filter(t => scored.has(t));
  if (leakedControl.length) {
    throw new Error('FOREIGN-CONTROL FAIL (Spec §6.2b) — undefined-country foreign primary leaked into a '
      + 'staples cohort: ' + leakedControl.join(', '));
  }
}
// assertStaplesNoForeignLeak(results, listing): GENERATIVE property test reading the snapshot meta.country
// (via the court-listing side-file) DIRECTLY — independent of the C5 isUS flag. Throws if ANY scored staples
// record carries meta.country set AND != "United States" (the BTI/ABEV/FMX/CCEP/MICC/AGRO/FDP country-set
// class). Tolerant: missing side-file → no-op (structurally unprovable, breaks nothing).
function assertStaplesNoForeignLeak(resultsObj, listing) {
  if (!listing || listing.size === 0) return;
  const leaks = [];
  for (const bucket of ['staples_branded', 'staples_distribution']) {
    const R = resultsObj[bucket];
    if (!R || !Array.isArray(R.members)) continue;
    for (const m of R.members) {
      const L = listing.get(m.ticker);
      if (!L) continue; // no snapshot meta → can't assert (Vintage-A without entry: tolerant)
      if (L.country != null && L.country !== 'United States') {
        leaks.push(`${m.ticker}[${L.country}/${L.region}] in ${bucket}`);
      }
    }
  }
  if (leaks.length) {
    throw new Error('STAPLES ANTI-LEAK ASSERT (Spec §6.2b GENERATIVE property test): foreign-country record(s) '
      + 'leaked into a scored staples cohort — meta.country set AND != "United States": ' + leaks.join(', ')
      + '. The v1 country-domicile guard (classify-staples.js isUSListing) must exclude these — NOT suppress.');
  }
}

// --- consdisc_expansion (CORE) MARQUEE-COVERAGE assert (Spec §6.1/FINAL, fail-loud) ---
// The frozen marquee watchlist must each be classified into one of the two consdisc cohorts AND reach the
// scored universe (members[]) — else the run DIES LOUD (the regression guard against the v0 marketCap-object
// killshot that collapsed the universe to empty). 1+ name from each cohort (AMZN/EBAY/ETSY light; the rest store).
const CONSDISC_MARQUEE = Object.freeze(['AMZN', 'EBAY', 'ETSY', 'HD', 'CMG', 'DPZ', 'DRI', 'DECK', 'BBY', 'CAVA']);
// FOREIGN/EXCLUDE positive-control (§1.1/§1.2): auto-OEM value trap + hotel/gaming industry-excludes AND the
// Vintage-A foreign primaries the FOREIGN_PRIMARY_RESIDUAL/FOREIGN_NAME guards must keep OUT (the FAILURE-MODE-2
// ADR leak the country guard cannot see on Vintage-A undefined-country snapshots).
const CONSDISC_EXCLUDE_CONTROL = Object.freeze(['TSLA', 'GM', 'F', 'MAR', 'HLT', 'LVS', 'WYNN', 'AN', 'KMX',
  'JD', 'PDD', 'RERE', 'MELI', 'YUMC', 'ONON', 'QSR', 'BABA']);
function assertConsdiscMarquee(resultsObj) {
  const S = resultsObj.consdisc_store, Lt = resultsObj.consdisc_light;
  if (!S && !Lt) return; // consdisc not in this run (e.g. isolated unit test) → tolerant no-op
  const scored = new Set();
  for (const R of [S, Lt]) if (R && Array.isArray(R.members)) for (const m of R.members) scored.add(m.ticker);
  const missing = CONSDISC_MARQUEE.filter(t => !scored.has(t));
  if (missing.length) {
    throw new Error('MARQUEE COVERAGE FAIL (Spec §6.1) — consdisc universe collapsed, these bona-fide '
      + 'US consumer-discretionary names were not classified/scored: ' + missing.join(', '));
  }
  // EXCLUDE-CONTROL: auto-OEM/hotel/gaming + foreign primaries must NOT have reached a consdisc cohort.
  const leakedControl = CONSDISC_EXCLUDE_CONTROL.filter(t => scored.has(t));
  if (leakedControl.length) {
    throw new Error('EXCLUDE-CONTROL FAIL (Spec §1.1/§1.2) — a hard-excluded industry name or foreign primary '
      + 'leaked into a consdisc cohort: ' + leakedControl.join(', '));
  }
}
// assertConsdiscNoForeignLeak(results, listing): GENERATIVE property test reading the snapshot meta.country
// (via the court-listing side-file) DIRECTLY — independent of the C5 isUS flag. Throws if ANY scored consdisc
// record carries meta.country set AND != "United States" (the country-set foreign class). Tolerant: missing
// side-file → no-op. (The Vintage-A foreign primaries with country=undefined are caught by the EXCLUDE-CONTROL
// positive-control above, since the generative country test cannot see them — they have no country.)
function assertConsdiscNoForeignLeak(resultsObj, listing) {
  if (!listing || listing.size === 0) return;
  const leaks = [];
  for (const bucket of ['consdisc_store', 'consdisc_light']) {
    const R = resultsObj[bucket];
    if (!R || !Array.isArray(R.members)) continue;
    for (const m of R.members) {
      const L = listing.get(m.ticker);
      if (!L) continue; // no snapshot meta → can't assert (Vintage-A without entry: tolerant)
      if (L.country != null && L.country !== 'United States') {
        leaks.push(`${m.ticker}[${L.country}/${L.region}] in ${bucket}`);
      }
    }
  }
  if (leaks.length) {
    throw new Error('CONSDISC ANTI-LEAK ASSERT (Spec §6.1 GENERATIVE property test): foreign-country record(s) '
      + 'leaked into a scored consdisc cohort — meta.country set AND != "United States": ' + leaks.join(', ')
      + '. The v1 country-domicile guard (classify-consdisc.js isUSListing) must exclude these — NOT suppress.');
  }
}

// --- materials_quality (CORE) MARQUEE-COVERAGE assert (Spec §6, fail-loud) ---
// SI-5 identity alone does NOT catch a silent universe collapse (a dropped name is consistently absent from
// BOTH classified and scored counts, so the identity still balances). The frozen marquee watchlist must each
// be classified into one of the two materials cohorts AND reach the scored universe (members[]) — else the run
// DIES LOUD (the regression guard against the country-vintage collapse). 1+ name from each cohort
// (LIN/APD/VMC/MLM/SHW/ECL/PPG/CRH/RPM/ALB pricingpower; NEM/NUE/FCX/DOW/CF commodity).
const MATERIALS_MARQUEE = Object.freeze(['LIN', 'APD', 'VMC', 'MLM', 'SHW', 'ECL', 'PPG', 'CRH', 'RPM', 'NEM', 'NUE', 'FCX', 'DOW', 'CF', 'ALB']);
// FOREIGN_CONTROL positive-control (§6/§8-#8): the foreign-primary miner leak the §6 hardening (country-domicile
// guard + FOREIGN_NAME regex + FOREIGN_PRIMARY_RESIDUAL) must keep OUT — the single largest classification risk
// in this bucket. Catches a regression that drops a guard.
const MATERIALS_FOREIGN_CONTROL = Object.freeze(['RIO', 'VALE', 'SCCO', 'PKX', 'KGC', 'WPM', 'PAAS', 'SVM',
  'BHP', 'CX', 'MT', 'AEM', 'JHX', 'NTR', 'SSL']);
// The name-verified US-PRIMARY foreign-domiciled compounders the spec classifier DELIBERATELY admits (CRH plc
// Ireland-domiciled NYSE-primary; LIN Linde plc Vintage-A NasdaqGS-primary). These carry a foreign country/name
// but ARE genuine US primaries → the generative country anti-leak assert must EXEMPT them (mirrors the
// classifier's US_PRIMARY_ALLOWLIST and court-screen's US_PRIMARY_INVERSION_ALLOWLIST/STVN pattern).
const MATERIALS_US_PRIMARY_ALLOWLIST = Object.freeze(['CRH', 'LIN']);
function assertMaterialsMarquee(resultsObj) {
  const P = resultsObj.materials_pricingpower, C = resultsObj.materials_commodity;
  if (!P && !C) return; // materials not in this run (e.g. isolated unit test) → tolerant no-op
  const scored = new Set();
  for (const R of [P, C]) if (R && Array.isArray(R.members)) for (const m of R.members) scored.add(m.ticker);
  const missing = MATERIALS_MARQUEE.filter(t => !scored.has(t));
  if (missing.length) {
    throw new Error('MARQUEE COVERAGE FAIL (Spec §6) — materials universe collapsed, these bona-fide '
      + 'US materials large-caps were not classified/scored: ' + missing.join(', '));
  }
  // FOREIGN_CONTROL: the foreign-primary miners must NOT have reached a materials cohort.
  const leakedControl = MATERIALS_FOREIGN_CONTROL.filter(t => scored.has(t));
  if (leakedControl.length) {
    throw new Error('FOREIGN-CONTROL FAIL (Spec §6/§8-#8) — a foreign-primary miner leaked into a '
      + 'materials cohort: ' + leakedControl.join(', '));
  }
}
// assertMaterialsNoForeignLeak(results, listing): GENERATIVE property test reading the snapshot meta.country
// (via the court-listing side-file) DIRECTLY — independent of the C5 isUS flag. Throws if ANY scored materials
// record carries meta.country set AND != "United States" EXCEPT the name-verified US_PRIMARY_ALLOWLIST (CRH/LIN
// — foreign-domiciled but genuine US primaries the spec admits by design). Tolerant: missing side-file → no-op.
function assertMaterialsNoForeignLeak(resultsObj, listing) {
  if (!listing || listing.size === 0) return;
  const allow = new Set(MATERIALS_US_PRIMARY_ALLOWLIST);
  const leaks = [];
  for (const bucket of ['materials_pricingpower', 'materials_commodity']) {
    const R = resultsObj[bucket];
    if (!R || !Array.isArray(R.members)) continue;
    for (const m of R.members) {
      if (allow.has(m.ticker)) continue; // verified US-primary inversion (CRH/LIN) — admitted by design
      const L = listing.get(m.ticker);
      if (!L) continue; // no snapshot meta → can't assert (Vintage-A without entry: tolerant)
      if (L.country != null && L.country !== 'United States') {
        leaks.push(`${m.ticker}[${L.country}/${L.region}] in ${bucket}`);
      }
    }
  }
  if (leaks.length) {
    throw new Error('MATERIALS ANTI-LEAK ASSERT (Spec §6 GENERATIVE property test): foreign-country record(s) '
      + 'leaked into a scored materials cohort — meta.country set AND != "United States" (and not on the verified '
      + 'US_PRIMARY_ALLOWLIST): ' + leaks.join(', ')
      + '. The v0 country-domicile guard (classify-materials.js isUSListing) must exclude these — NOT suppress.');
  }
}

// --- energy_quality (CORE) MARQUEE-COVERAGE assert (Spec §6, fail-loud) ---
// SI-5 identity alone does NOT catch a silent universe collapse (a dropped name is consistently absent from BOTH
// classified and scored counts, so the identity still balances). The frozen marquee watchlist must each be
// classified into one of the three energy cohorts AND reach the scored universe (members[]) — else the run DIES
// LOUD (the regression guard against the §0 country-vintage collapse that DENIED industrials v0). 1+ name from each
// cohort (XOM/CVX/COP/EOG/OXY/DVN upstream; EPD/ET/KMI/WMB/OKE/MPLX midstream; SLB/HAL/BKR services).
const ENERGY_MARQUEE = Object.freeze(['XOM', 'CVX', 'COP', 'EOG', 'OXY', 'DVN', 'EPD', 'ET', 'KMI', 'WMB', 'OKE', 'MPLX', 'SLB', 'HAL', 'BKR']);
// FOREIGN_CONTROL positive-control (§0/§6): the foreign-primary leak the §6 hardening (country-domicile guard +
// FOREIGN_NAME regex + ENERGY_FOREIGN_DROP) must keep OUT — the §0 NEEDS-REVISION trigger, the single largest
// classification risk in this bucket. Catches a regression that drops a guard.
const ENERGY_FOREIGN_CONTROL = Object.freeze(['BP', 'SHEL', 'TTE', 'CNQ', 'CVE', 'ENB', 'EQNR', 'E', 'IMO',
  'SU', 'PBR', 'TRP', 'YPF', 'VET', 'NAT', 'TK', 'TNK']);
// The name-verified US-PRIMARY foreign-NAME flagship the spec classifier DELIBERATELY admits (SLB = Schlumberger
// Limited, Vintage-A NYSE-primary). It carries a foreign NAME (\bLimited\b) but IS a genuine US primary → the
// generative country anti-leak assert must EXEMPT it (mirrors the classifier's US_PRIMARY_ALLOWLIST and materials'
// MATERIALS_US_PRIMARY_ALLOWLIST {CRH,LIN}).
const ENERGY_US_PRIMARY_ALLOWLIST = Object.freeze(['SLB']);
function assertEnergyMarquee(resultsObj) {
  const U = resultsObj.energy_upstream, M = resultsObj.energy_midstream, S = resultsObj.energy_services;
  if (!U && !M && !S) return; // energy not in this run (e.g. isolated unit test) → tolerant no-op
  const scored = new Set();
  for (const R of [U, M, S]) if (R && Array.isArray(R.members)) for (const m of R.members) scored.add(m.ticker);
  const missing = ENERGY_MARQUEE.filter(t => !scored.has(t));
  if (missing.length) {
    throw new Error('MARQUEE COVERAGE FAIL (Spec §6) — energy universe collapsed, these bona-fide '
      + 'US energy large-caps were not classified/scored: ' + missing.join(', '));
  }
  // FOREIGN_CONTROL: the foreign primaries must NOT have reached an energy cohort.
  const leakedControl = ENERGY_FOREIGN_CONTROL.filter(t => scored.has(t));
  if (leakedControl.length) {
    throw new Error('FOREIGN-CONTROL FAIL (Spec §0/§6) — a foreign-primary energy name leaked into a '
      + 'cohort: ' + leakedControl.join(', '));
  }
}
// assertEnergyNoForeignLeak(results, listing): GENERATIVE property test reading the snapshot meta.country (via the
// court-listing side-file) DIRECTLY — independent of the C5 isUS flag. Throws if ANY scored energy record carries
// meta.country set AND != "United States" EXCEPT the name-verified US_PRIMARY_ALLOWLIST (SLB — foreign-NAME but a
// genuine US primary the spec admits by design). Tolerant: missing side-file → no-op.
function assertEnergyNoForeignLeak(resultsObj, listing) {
  if (!listing || listing.size === 0) return;
  const allow = new Set(ENERGY_US_PRIMARY_ALLOWLIST);
  const leaks = [];
  for (const bucket of ['energy_upstream', 'energy_midstream', 'energy_services']) {
    const R = resultsObj[bucket];
    if (!R || !Array.isArray(R.members)) continue;
    for (const m of R.members) {
      if (allow.has(m.ticker)) continue; // verified US-primary inversion (SLB) — admitted by design
      const L = listing.get(m.ticker);
      if (!L) continue; // no snapshot meta → can't assert (Vintage-A without entry: tolerant)
      if (L.country != null && L.country !== 'United States') {
        leaks.push(`${m.ticker}[${L.country}/${L.region}] in ${bucket}`);
      }
    }
  }
  if (leaks.length) {
    throw new Error('ENERGY ANTI-LEAK ASSERT (Spec §0/§6 GENERATIVE property test): foreign-country record(s) '
      + 'leaked into a scored energy cohort — meta.country set AND != "United States" (and not on the verified '
      + 'US_PRIMARY_ALLOWLIST): ' + leaks.join(', ')
      + '. The v0 country-domicile guard (classify-energy.js isUSListing) must exclude these — NOT suppress.');
  }
}

// --- pharma_commercial (CORE) MARQUEE-COVERAGE assert (Spec §6, fail-loud) ---
// SI-5 identity alone does NOT catch a silent universe collapse (a dropped name is consistently absent from BOTH
// classified and scored counts). The frozen marquee watchlist must each be classified into one of the three pharma
// cohorts AND reach the scored universe (members[]) — else the run DIES LOUD (the regression guard against the
// vintage/country/commercial-gate collapse). 1+ name from each cohort (LLY/MRK/PFE/ABBV/BMY/AMGN/GILD/JNJ +BIIB
// branded; VRTX/REGN/INCY/JAZZ/EXEL biopharma; NBIX/VTRS specialty).
const PHARMA_MARQUEE = Object.freeze(['LLY', 'MRK', 'PFE', 'ABBV', 'BMY', 'AMGN', 'GILD', 'JNJ',
  'VRTX', 'REGN', 'BIIB', 'INCY', 'JAZZ', 'EXEL', 'NBIX', 'VTRS']);
// FOREIGN_CONTROL positive-control (§1.2/§9): the foreign-primary leak the §1.2 hardening (country-domicile guard +
// FOREIGN_NAME regex + 5-letter-ADR rule + PHARMA_FOREIGN_DROP) must keep OUT — the single largest classification
// risk in this bucket. Catches a regression that drops a guard.
const PHARMA_FOREIGN_CONTROL = Object.freeze(['AZN', 'NVS', 'NVO', 'SNY', 'TAK', 'BNTX', 'ARGX', 'GMAB',
  'ALKS', 'GSK', 'RHHBY', 'BHC']);
// The name-verified US-PRIMARY foreign-NAME flagship the spec classifier DELIBERATELY admits (JAZZ = Jazz
// Pharmaceuticals plc, Ireland-domiciled Vintage-A NasdaqGS-primary). It carries a foreign NAME (\bplc\b) but IS a
// genuine US primary → the generative country anti-leak assert must EXEMPT it (mirrors classify-pharma's
// US_PRIMARY_ALLOWLIST and materials/energy MATERIALS_US_PRIMARY_ALLOWLIST {CRH,LIN} / ENERGY {SLB}).
const PHARMA_US_PRIMARY_ALLOWLIST = Object.freeze(['JAZZ']);
function assertPharmaMarquee(resultsObj) {
  const B = resultsObj.pharma_branded, BP = resultsObj.pharma_biopharma, S = resultsObj.pharma_specialty;
  if (!B && !BP && !S) return; // pharma not in this run (e.g. isolated unit test) → tolerant no-op
  const scored = new Set();
  for (const R of [B, BP, S]) if (R && Array.isArray(R.members)) for (const m of R.members) scored.add(m.ticker);
  const missing = PHARMA_MARQUEE.filter(t => !scored.has(t));
  if (missing.length) {
    throw new Error('MARQUEE COVERAGE FAIL (Spec §6) — pharma universe collapsed, these bona-fide '
      + 'US commercial pharma large-caps were not classified/scored: ' + missing.join(', '));
  }
  // FOREIGN_CONTROL: the foreign primaries must NOT have reached a pharma cohort.
  const leakedControl = PHARMA_FOREIGN_CONTROL.filter(t => scored.has(t));
  if (leakedControl.length) {
    throw new Error('FOREIGN-CONTROL FAIL (Spec §1.2/§9) — a foreign-primary pharma name leaked into a '
      + 'cohort: ' + leakedControl.join(', '));
  }
}
// assertPharmaNoForeignLeak(results, listing): GENERATIVE property test reading the snapshot meta.country (via the
// court-listing side-file) DIRECTLY — independent of the C5 isUS flag. Throws if ANY scored pharma record carries
// meta.country set AND != "United States" EXCEPT the name-verified US_PRIMARY_ALLOWLIST (JAZZ — foreign-NAME but a
// genuine US primary the spec admits by design). Tolerant: missing side-file → no-op.
function assertPharmaNoForeignLeak(resultsObj, listing) {
  if (!listing || listing.size === 0) return;
  const allow = new Set(PHARMA_US_PRIMARY_ALLOWLIST);
  const leaks = [];
  for (const bucket of ['pharma_branded', 'pharma_biopharma', 'pharma_specialty']) {
    const R = resultsObj[bucket];
    if (!R || !Array.isArray(R.members)) continue;
    for (const m of R.members) {
      if (allow.has(m.ticker)) continue; // verified US-primary inversion (JAZZ) — admitted by design
      const L = listing.get(m.ticker);
      if (!L) continue; // no snapshot meta → can't assert (Vintage-A without entry: tolerant)
      if (L.country != null && L.country !== 'United States') {
        leaks.push(`${m.ticker}[${L.country}/${L.region}] in ${bucket}`);
      }
    }
  }
  if (leaks.length) {
    throw new Error('PHARMA ANTI-LEAK ASSERT (Spec §1.2 GENERATIVE property test): foreign-country record(s) '
      + 'leaked into a scored pharma cohort — meta.country set AND != "United States" (and not on the verified '
      + 'US_PRIMARY_ALLOWLIST): ' + leaks.join(', ')
      + '. The v0 country-domicile guard (classify-pharma.js isUSListing) must exclude these — NOT suppress.');
  }
}

// --- it_services (CORE) MARQUEE-COVERAGE + CONTAM/FOREIGN positive-control assert (Spec PART B §B.1, fail-loud) ---
// SI-5 identity alone does NOT catch a silent universe collapse (a dropped name is consistently absent from BOTH
// classified and scored counts). The frozen marquee watchlist must each be classified into it_services AND reach the
// scored universe (members[]) — else the run DIES LOUD (the regression guard against the country-vintage-collapse +
// an over-aggressive contamination gate). Spans the elite people-businesses + the US-primary foreign-domiciled
// flagships (ACN/G/GLOB via the allowlist; INFY Vintage-A).
const ITSERVICES_MARQUEE = Object.freeze(['ACN', 'CTSH', 'EPAM', 'CACI', 'INFY', 'G', 'EXLS',
  'IBM', 'GLOB', 'CNXC', 'DXC', 'BR', 'FIS', 'JKHY', 'IT', 'INOD']);
// CONTAM/FOREIGN positive-control (PART B §B.1 GATE 1 + Universe safety): the contaminants the economic gate / the
// NON_PEOPLE_EXCLUDE fallback / the country-domicile guard must keep OUT — the single largest classification risk in
// this bucket. Catches a regression that drops the gate, the fallback, or a guard.
const ITSERVICES_CONTAM_CONTROL = Object.freeze(['CIFR', 'APLD', 'BBAI', 'KEEL', 'SHAZ', 'CHRN', 'CDW', 'INGM',
  'VNET', 'GIB', 'GDS', 'MGRT']);
// The name-verified US-PRIMARY / design-marquee foreign-domiciled flagships the spec classifier DELIBERATELY admits
// (ACN Accenture plc Ireland-NYSE-primary; G Genpact Ltd Bermuda-NYSE-primary; GLOB Globant S.A. Luxembourg-NYSE-
// primary; INFY Infosys Ltd Vintage-A NYSE). They carry a foreign country/NAME but ARE genuine US primaries → the
// generative country anti-leak assert must EXEMPT them (mirrors classify-itservices's US_PRIMARY_ALLOWLIST and
// materials/energy/pharma {CRH,LIN}/{SLB}/{JAZZ}).
const ITSERVICES_US_PRIMARY_ALLOWLIST = Object.freeze(['ACN', 'G', 'GLOB', 'INFY']);
function assertItServicesMarquee(resultsObj) {
  const R = resultsObj.it_services;
  if (!R) return; // it_services not in this run (e.g. isolated unit test) → tolerant no-op
  const scored = new Set();
  if (Array.isArray(R.members)) for (const m of R.members) scored.add(m.ticker);
  const missing = ITSERVICES_MARQUEE.filter(t => !scored.has(t));
  if (missing.length) {
    throw new Error('MARQUEE COVERAGE FAIL (Spec PART B §B.1) — it_services universe collapsed, these bona-fide '
      + 'US people-leverage / low-capital-compounding large-caps were not classified/scored: ' + missing.join(', '));
  }
  // CONTAM/FOREIGN-CONTROL: the contaminants + foreign primaries must NOT have reached the it_services cohort.
  const leakedControl = ITSERVICES_CONTAM_CONTROL.filter(t => scored.has(t));
  if (leakedControl.length) {
    throw new Error('CONTAM/FOREIGN-CONTROL FAIL (Spec PART B §B.1) — a contaminant / foreign-primary name leaked '
      + 'into the it_services cohort: ' + leakedControl.join(', '));
  }
}
// assertItServicesNoForeignLeak(results, listing): GENERATIVE property test reading the snapshot meta.country (via
// the court-listing side-file) DIRECTLY — independent of the C5 isUS flag. Throws if ANY scored it_services record
// carries meta.country set AND != "United States" EXCEPT the name-verified US_PRIMARY_ALLOWLIST (ACN/G/GLOB/INFY —
// foreign-domiciled/NAME but genuine US primaries the spec admits by design). Tolerant: missing side-file → no-op.
function assertItServicesNoForeignLeak(resultsObj, listing) {
  if (!listing || listing.size === 0) return;
  const allow = new Set(ITSERVICES_US_PRIMARY_ALLOWLIST);
  const R = resultsObj.it_services;
  if (!R || !Array.isArray(R.members)) return;
  const leaks = [];
  for (const m of R.members) {
    if (allow.has(m.ticker)) continue; // verified US-primary inversion (ACN/G/GLOB/INFY) — admitted by design
    const L = listing.get(m.ticker);
    if (!L) continue; // no snapshot meta → can't assert (Vintage-A without entry: tolerant)
    if (L.country != null && L.country !== 'United States') {
      leaks.push(`${m.ticker}[${L.country}/${L.region}] in it_services`);
    }
  }
  if (leaks.length) {
    throw new Error('IT_SERVICES ANTI-LEAK ASSERT (Spec PART B §B.1 GENERATIVE property test): foreign-country '
      + 'record(s) leaked into the scored it_services cohort — meta.country set AND != "United States" (and not on '
      + 'the verified US_PRIMARY_ALLOWLIST): ' + leaks.join(', ')
      + '. The country-domicile guard (classify-itservices.js isUSListing) must exclude these — NOT suppress.');
  }
}

// --- tech_hardware_quality (CORE court bucket) MARQUEE-COVERAGE + FOREIGN positive-control assert (fail-loud) ---
// SI-5 identity alone does NOT catch a silent universe collapse (a dropped name is consistently absent from BOTH
// classified and scored counts). The 9-name marquee must each be classified AND survive to a SANE rank (not exiled to
// the bottom of the cohort) — else the run DIES LOUD (the regression guard against the country-vintage-collapse + the
// de-ADR guard). "Sane rank" = the marquee franchises must rank in the TOP HALF of the scored cohort (they ARE the
// franchises the absolute-anchor is designed to lift above the commodity/loss tail; if a franchise sinks below the
// median the engine inverted). The foreign positive-control must NOT have reached the cohort.
const TECHHW_MARQUEE = Object.freeze(['APH', 'KEYS', 'GRMN', 'MSI', 'TDY', 'CGNX', 'AMAT', 'BMI', 'FTV']);
// FOREIGN positive-control: the foreign primaries the de-ADR country-domicile guard / FOREIGN_NAME regex must keep OUT
// — the single largest classification risk in this bucket. A leak means the country guard broke. Spans country-SET
// foreign (ASML/CLS/ERIC/FN/CAMT/ITRN/GILT/DQ) + undefined-country foreign-NAME (ST/TEL/ICHR/NVMI plc/Ltd).
const TECHHW_FOREIGN_CONTROL = Object.freeze(['ASML', 'CLS', 'ERIC', 'FN', 'CAMT', 'ITRN', 'GILT', 'DQ', 'ST', 'TEL', 'ICHR', 'NVMI']);
// country-undefined US names that MUST be RETAINED (the de-ADR retention guard). Catches a regression that re-keys the
// classify-in on country!=US (which would wrongly drop these NYSE/Nasdaq USD names).
const TECHHW_UNDEF_US_CONTROL = Object.freeze(['MSI', 'KEYS', 'TDY']);
// The name-verified US-PRIMARY / design-marquee foreign-domiciled flagship the spec classifier DELIBERATELY admits
// (GRMN Garmin Ltd Switzerland-NYSE-primary). Carries a foreign country but IS a genuine US primary → the generative
// country anti-leak assert must EXEMPT it (mirrors classify-techhw's US_PRIMARY_ALLOWLIST).
const TECHHW_US_PRIMARY_ALLOWLIST = Object.freeze(['GRMN']);
function assertTechHwMarquee(resultsObj) {
  const R = resultsObj.tech_hardware_quality;
  if (!R) return; // tech_hardware_quality not in this run (e.g. isolated unit test) → tolerant no-op
  const scored = new Set();
  if (Array.isArray(R.members)) for (const m of R.members) scored.add(m.ticker);
  const missing = TECHHW_MARQUEE.filter(t => !scored.has(t));
  if (missing.length) {
    throw new Error('MARQUEE COVERAGE FAIL (tech_hardware_quality) — universe collapsed, these bona-fide US '
      + 'durable-hardware-franchise large-caps were not classified/scored: ' + missing.join(', '));
  }
  // SCORED-MARQUEE (re-court tech_hardware headline-inversion fix 2026-06-23): every marquee must be SCORED
  // (score != null), i.e. NOT dropped into excluded[] / membershipClass=Out. THIS is the guard that should have
  // caught the membership-growth-gate defect: the old SANE-RANK below filters m.score != null BEFORE ranking, so it
  // was BLIND to a franchise that the pro-cyclical growth gate sank to score=null (it could not detect a marquee
  // dropped into the reject pile — only one mis-RANKED among the scored). A high-absKaliber IN-CLASS franchise (e.g.
  // FTV on its Ralliant-spinoff -33% print) must be SCORED on its honest absKaliber, never exiled to excluded[] for
  // negative recent growth. score=null/excluded[] is reserved for OUT-OF-CLASS / shell only.
  const byTickerThw = new Map();
  if (Array.isArray(R.members)) for (const m of R.members) byTickerThw.set(m.ticker, m);
  const unscored = TECHHW_MARQUEE.filter(t => { const m = byTickerThw.get(t); return !m || m.score == null; });
  if (unscored.length) {
    throw new Error('MARQUEE SCORED FAIL (tech_hardware_quality) — these franchise marquees were dropped to '
      + 'score=null / excluded[] (membership-Out or floor-excluded), NOT scored on their absKaliber; the '
      + 'membership/exclusion gate is pro-cyclical (dropping high-absKaliber franchises for negative recent growth): '
      + unscored.map(t => { const m = byTickerThw.get(t); return `${t}[${m ? (m.exclusionReason || ('Out/' + m.membershipClass)) : 'absent'}]`; }).join(', '));
  }
  // SANE-RANK: the marquee franchises must survive to a SANE rank — NOT exiled to the BOTTOM THIRD of the scored cohort
  // (the failure mode the guard protects against is an inverted engine that sinks a franchise to the tail with the
  // commodity contract-mfg / loss names). A goodwill-heavy serial-acquirer franchise (e.g. TDY: gpa 0.17 from heavy
  // acquisition goodwill but solid opMargin/fcfMargin → rank ~25/48 = mid-pack) legitimately sits mid-pack, so the cut
  // is the bottom THIRD (not the top half) — strict enough to catch a true inversion, loose enough not to false-fire on
  // a legitimately mid-pack roll-up. Ranked by the blended score (the headline ranking).
  const ranked = Array.isArray(R.members)
    ? R.members.filter(m => m.score != null).sort((a, b) => (b.score || 0) - (a.score || 0))
    : [];
  const nScored = ranked.length;
  if (nScored > 0) {
    const rankByTicker = new Map();
    ranked.forEach((m, i) => rankByTicker.set(m.ticker, i + 1));
    const bottomThirdCut = Math.ceil(nScored * 2 / 3); // a marquee ranked WORSE than this is in the bottom third → inverted
    const sunk = TECHHW_MARQUEE.filter(t => rankByTicker.has(t) && rankByTicker.get(t) > bottomThirdCut);
    if (sunk.length) {
      throw new Error('MARQUEE SANE-RANK FAIL (tech_hardware_quality) — these franchise marquees sank into the cohort '
        + `bottom third (rank > ${bottomThirdCut}/${nScored}); the absolute-anchor inverted: `
        + sunk.map(t => `${t}#${rankByTicker.get(t)}`).join(', '));
    }
  }
  // FOREIGN-CONTROL: the foreign primaries must NOT have reached the cohort.
  const leakedControl = TECHHW_FOREIGN_CONTROL.filter(t => scored.has(t));
  if (leakedControl.length) {
    throw new Error('FOREIGN-CONTROL FAIL (tech_hardware_quality) — a foreign-primary name leaked into the cohort: '
      + leakedControl.join(', '));
  }
  // country-undef US retention: MSI/KEYS/TDY must be present.
  const droppedUndefUS = TECHHW_UNDEF_US_CONTROL.filter(t => !scored.has(t));
  if (droppedUndefUS.length) {
    throw new Error('COUNTRY-UNDEF-US FAIL (tech_hardware_quality) — undefined-country US name(s) wrongly dropped: '
      + droppedUndefUS.join(', '));
  }
}
// assertTechHwNoForeignLeak(results, listing): GENERATIVE property test reading the snapshot meta.country (via the
// court-listing side-file) DIRECTLY — independent of the C5 isUS flag. Throws if ANY scored tech_hardware record
// carries meta.country set AND != "United States" EXCEPT the name-verified US_PRIMARY_ALLOWLIST (GRMN — Garmin Ltd
// Switzerland but a genuine US primary the spec admits by design). Tolerant: missing side-file → no-op.
function assertTechHwNoForeignLeak(resultsObj, listing) {
  if (!listing || listing.size === 0) return;
  const allow = new Set(TECHHW_US_PRIMARY_ALLOWLIST);
  const R = resultsObj.tech_hardware_quality;
  if (!R || !Array.isArray(R.members)) return;
  const leaks = [];
  for (const m of R.members) {
    if (allow.has(m.ticker)) continue; // verified US-primary inversion (GRMN) — admitted by design
    const L = listing.get(m.ticker);
    if (!L) continue; // no snapshot meta → can't assert (Vintage-A without entry: tolerant)
    if (L.country != null && L.country !== 'United States') {
      leaks.push(`${m.ticker}[${L.country}/${L.region}] in tech_hardware_quality`);
    }
  }
  if (leaks.length) {
    throw new Error('TECH_HARDWARE ANTI-LEAK ASSERT (GENERATIVE property test): foreign-country record(s) leaked into '
      + 'the scored tech_hardware_quality cohort — meta.country set AND != "United States" (and not on the verified '
      + 'US_PRIMARY_ALLOWLIST): ' + leaks.join(', ')
      + '. The country-domicile guard (classify-techhw.js isUSListing) must exclude these — NOT suppress.');
  }
}

// --- financials_banks (CORE court bucket) MARQUEE-COVERAGE + foreign-DENY anti-leak assert (court DESIGN, fail-loud) ---
// The 7-name marquee must each be classified AND survive to a SANE rank (not exiled to the bottom). The court named
// JPM/PNC/USB/MTB (the money-center / super-regional core, all country=undefined US banks) + EWBC/CFR/FITB.
const BANKS_MARQUEE = Object.freeze(['JPM', 'PNC', 'USB', 'MTB', 'EWBC', 'CFR', 'FITB']);
// foreign-megabank-ADR DENY positive-control (court revision #1/#2): the foreign primaries the de-ADR hardening must
// keep OUT. Catches a regression that drops a guard (country-domicile / FOREIGN_NAME / BANK_FOREIGN_DROP). Mirrors the
// classifier's BANK_FOREIGN_CONTROL. HSBC/BBVA/BMO/BNS/ING/Barclays are caught by the country-set rule.
const BANKS_FOREIGN_CONTROL = Object.freeze(['IBN', 'ITUB', 'BSBR', 'BMA', 'KB', 'SHG', 'WF', 'MFG', 'MUFG', 'SMFG',
  'RY', 'TD', 'SAN', 'UBS', 'NWG', 'NU', 'HSBC', 'BBVA', 'BMO', 'BNS', 'ING', 'BCS', 'LYG', 'HDB', 'BBD', 'NTB']);
function assertBanksMarquee(resultsObj) {
  const R = resultsObj.financials_banks;
  if (!R) return; // financials_banks not in this run (e.g. isolated unit test) → tolerant no-op
  // marquee must reach the SCORED universe (classified + survived to a sane rank, NOT shell/membership-excluded).
  const scored = new Set();
  if (Array.isArray(R.members)) for (const m of R.members) if (m.score != null) scored.add(m.ticker);
  const missing = BANKS_MARQUEE.filter(t => !scored.has(t));
  if (missing.length) {
    throw new Error('MARQUEE COVERAGE FAIL (financials_banks DESIGN) — bank universe collapsed, these bona-fide '
      + 'US deposit-funded large-cap banks were not classified/scored: ' + missing.join(', '));
  }
  // foreign-DENY positive-control: the foreign-megabank ADRs must NOT have reached the cohort (classified OR scored).
  const allTk = new Set();
  if (Array.isArray(R.members)) for (const m of R.members) allTk.add(m.ticker);
  const leakedControl = BANKS_FOREIGN_CONTROL.filter(t => allTk.has(t));
  if (leakedControl.length) {
    throw new Error('FOREIGN-CONTROL FAIL (financials_banks de-ADR DESIGN) — a foreign-megabank ADR leaked into the '
      + 'financials_banks cohort: ' + leakedControl.join(', '));
  }
}
// assertBanksNoForeignLeak(results, listing): GENERATIVE property test reading the snapshot meta.country (via the
// court-listing side-file) DIRECTLY. Per court revision #2 it must NOT assert "country != US" (that throws on the
// legitimate country=undefined US banks JPM/PNC/USB/MTB). It asserts on the foreign-DENY SIGNAL instead: a scored
// record whose ticker is in the foreign-DENY set, OR a record with a country SET to a non-US country. country=undefined
// is TOLERATED (the positive US-primary test in the classifier already admitted only US-primary undefined-country names).
function assertBanksNoForeignLeak(resultsObj, listing) {
  const R = resultsObj.financials_banks;
  if (!R || !Array.isArray(R.members)) return;
  const deny = new Set(BANK_FOREIGN_DENY);
  const leaks = [];
  for (const m of R.members) {
    if (deny.has(m.ticker)) { leaks.push(`${m.ticker}[foreign-DENY-set]`); continue; }   // the foreign-DENY signal (NOT country!=US)
    if (!listing || listing.size === 0) continue;
    const L = listing.get(m.ticker);
    if (!L) continue; // no snapshot meta → can't assert (country=undefined US banks: TOLERATED, never throws)
    if (L.country != null && L.country !== 'United States') {
      leaks.push(`${m.ticker}[${L.country}/${L.region}]`);   // a country-SET non-US foreigner (de-ADR guard regression)
    }
  }
  if (leaks.length) {
    throw new Error('FINANCIALS_BANKS ANTI-LEAK ASSERT (court revision #2 — keyed on the foreign-DENY SIGNAL, NOT '
      + 'country!=US): foreign record(s) leaked into the financials_banks cohort: ' + leaks.join(', ')
      + '. The de-ADRd country-domicile guard (classify-banks.js isUSListing) must exclude these. NOTE: country=undefined '
      + 'US banks (JPM/PNC/USB/MTB) are TOLERATED by design — they are admitted via the positive US-primary test.');
  }
}

// --- equity_reits (CORE court bucket) MARQUEE-COVERAGE + mortgage-REIT anti-leak assert (court DESIGN, fail-loud) ---
// The 7-name marquee must each be classified AND survive to a SANE rank (not exiled to the bottom). The court named
// O/PLD/VICI/SPG/EXR/EGP/CTRE (quality triple-net/industrial/specialty/healthcare REITs spanning the property types).
const REITS_MARQUEE = Object.freeze(['O', 'PLD', 'VICI', 'SPG', 'EXR', 'EGP', 'CTRE']);
// mortgage-REIT positive-control (court revision #0): the mortgage REITs the hard-separation must keep OUT. Catches a
// regression that re-admits the REIT - Mortgage industry. Mirrors the classifier's REIT_MORTGAGE_CONTROL.
const REITS_MORTGAGE_CONTROL = Object.freeze(['NLY', 'AGNC', 'STWD', 'ABR', 'RITM', 'BXMT', 'CIM', 'DX', 'EFC',
  'LADR', 'ARI', 'ARR', 'ORC', 'TWO']);
function assertReitsMarquee(resultsObj) {
  const R = resultsObj.equity_reits;
  if (!R) return; // equity_reits not in this run (e.g. isolated unit test) → tolerant no-op
  // marquee must reach the SCORED universe (classified + survived to a sane rank, NOT shell/membership-excluded).
  const scored = new Set();
  if (Array.isArray(R.members)) for (const m of R.members) if (m.score != null) scored.add(m.ticker);
  const missing = REITS_MARQUEE.filter(t => !scored.has(t));
  if (missing.length) {
    throw new Error('MARQUEE COVERAGE FAIL (equity_reits DESIGN) — REIT universe collapsed, these bona-fide '
      + 'US equity-REIT large-caps were not classified/scored: ' + missing.join(', '));
  }
  // mortgage-REIT positive-control: the mortgage REITs must NOT have reached the cohort (classified OR scored).
  const allTk = new Set();
  if (Array.isArray(R.members)) for (const m of R.members) allTk.add(m.ticker);
  const leakedControl = REITS_MORTGAGE_CONTROL.filter(t => allTk.has(t));
  if (leakedControl.length) {
    throw new Error('MORTGAGE-CONTROL FAIL (equity_reits hard-separation DESIGN) — a mortgage REIT leaked into the '
      + 'equity_reits cohort: ' + leakedControl.join(', '));
  }
}
// assertReitsNoMortgageLeak(results, listing): GENERATIVE property test. A scored record whose ticker is in the
// mortgage-REIT DENY set, OR a record with a country SET to a non-US country, is a leak (the de-ADRd guard +
// hard-separation must exclude them). country=undefined US REITs (O/VICI/PLD/TRNO) are TOLERATED (the positive
// US-primary test admitted only US-primary undefined-country names).
function assertReitsNoMortgageLeak(resultsObj, listing) {
  const R = resultsObj.equity_reits;
  if (!R || !Array.isArray(R.members)) return;
  const deny = new Set(REIT_MORTGAGE_DENY);
  const leaks = [];
  for (const m of R.members) {
    if (deny.has(m.ticker)) { leaks.push(`${m.ticker}[mortgage-REIT-DENY-set]`); continue; }   // the mortgage-DENY signal
    if (!listing || listing.size === 0) continue;
    const L = listing.get(m.ticker);
    if (!L) continue; // no snapshot meta → can't assert (country=undefined US REITs: TOLERATED, never throws)
    if (L.country != null && L.country !== 'United States') {
      leaks.push(`${m.ticker}[${L.country}/${L.region}]`);   // a country-SET non-US foreigner (de-ADR guard regression)
    }
  }
  if (leaks.length) {
    throw new Error('EQUITY_REITS ANTI-LEAK ASSERT (court revision #0/#5 — mortgage hard-separation + de-ADRd guard): '
      + 'leaked record(s) in the equity_reits cohort: ' + leaks.join(', ')
      + '. The classifier (classify-reits.js) must exclude mortgage REITs + non-US-primary names. NOTE: country=undefined '
      + 'US REITs (O/VICI/PLD/TRNO) are TOLERATED by design — admitted via the positive US-primary test.');
  }
}

// --- capmkt_fee_core (CORE court bucket) MARQUEE-COVERAGE + fee-gate/foreign anti-leak assert (court DESIGN, fail-loud) ---
// The 9-name marquee must each be classified AND survive to a SANE rank (not exiled to the bottom). The court named
// SPGI/MCO/MSCI/ICE/NDAQ/CBOE (exchanges + rating/data) + BLK (asset manager) + AJG/BRO (insurance brokers).
const CAPMKT_MARQUEE = Object.freeze(['SPGI', 'MCO', 'MSCI', 'ICE', 'NDAQ', 'CBOE', 'BLK', 'AJG', 'BRO']);
// fee-gate positive-control (court revision #1 + RE-COURT 2026-06-24): the fund-float / closed-end-fund / BDC /
// crypto-miner artifacts the economic fee-gate must keep OUT. Catches a regression that drops a fee-gate arm.
const CAPMKT_FEEGATE_CONTROL = Object.freeze([
  'KYN', 'TIGR', 'PDO', 'APO', 'IBKR', 'NMZ', 'NUV', 'TY', 'ADX', 'GAB', 'GDV', 'BDJ', 'NAD',
  'OBDC', 'GSBD', 'TSLX', 'MSDL', 'FSK', 'GBDC', 'OTF', 'ARCC', 'BXSL', 'CSWC', 'HTGC',   // RE-COURT arm 3: BDC_SPREAD_LOAN_BOOK
  'CLSK', 'HIVE', 'MARA', 'RIOT', 'WULF',                                                 // RE-COURT arm 4: CRYPTO_MINER_NON_FEE
]);
// country-undefined-US positive-control (court revision #2): the country=undefined US names that MUST be RETAINED.
// Catches a regression that re-keys the classify-in on country!=US (which would wrongly drop these).
const CAPMKT_UNDEF_US_CONTROL = Object.freeze(['MSCI', 'MCO', 'ICE', 'NDAQ', 'KKR']);
function assertCapmktMarquee(resultsObj) {
  const R = resultsObj.capmkt_fee_core;
  if (!R) return; // capmkt_fee_core not in this run (e.g. isolated unit test) → tolerant no-op
  // marquee must reach the SCORED universe (classified + survived to a sane rank, NOT shell/membership-excluded).
  const scored = new Set();
  if (Array.isArray(R.members)) for (const m of R.members) if (m.score != null) scored.add(m.ticker);
  const missing = CAPMKT_MARQUEE.filter(t => !scored.has(t));
  if (missing.length) {
    throw new Error('MARQUEE COVERAGE FAIL (capmkt_fee_core DESIGN) — fee-business universe collapsed, these bona-fide '
      + 'US asset-light fee large-caps were not classified/scored: ' + missing.join(', '));
  }
  // fee-gate positive-control: the fund-float artifacts must NOT have reached the cohort (classified OR scored).
  const allTk = new Set();
  if (Array.isArray(R.members)) for (const m of R.members) allTk.add(m.ticker);
  const leakedControl = CAPMKT_FEEGATE_CONTROL.filter(t => allTk.has(t));
  if (leakedControl.length) {
    throw new Error('FEE-GATE CONTROL FAIL (capmkt_fee_core court revision #1) — a fund-float / closed-end-fund '
      + 'pass-through artifact leaked into the capmkt_fee_core cohort: ' + leakedControl.join(', '));
  }
  // country-undefined-US positive-control: MSCI/MCO/ICE/NDAQ/KKR must be RETAINED (classified + scored).
  const droppedUndefUS = CAPMKT_UNDEF_US_CONTROL.filter(t => !scored.has(t));
  if (droppedUndefUS.length) {
    throw new Error('COUNTRY-UNDEF-US FAIL (capmkt_fee_core court revision #2) — country=undefined US name(s) wrongly '
      + 'dropped from the capmkt_fee_core cohort: ' + droppedUndefUS.join(', ')
      + '. The classify-in must treat country===undefined === US-primary (US exchange + USD + no foreign legal-form name).');
  }
}
// assertCapmktNoForeignLeak(results, listing): GENERATIVE property test. A scored record whose ticker is in the
// fee-gate DENY set, OR a record with a country SET to a non-US country, is a leak (the de-ADRd guard + fee-gate must
// exclude them). country=undefined US names (MSCI/MCO/ICE/NDAQ/KKR) are TOLERATED (admitted via the positive
// US-primary test — keyed on the foreign-DENY SIGNAL, NOT country!=US, per court revision #2).
function assertCapmktNoForeignLeak(resultsObj, listing) {
  const R = resultsObj.capmkt_fee_core;
  if (!R || !Array.isArray(R.members)) return;
  const deny = new Set(CAPMKT_FEEGATE_DENY);
  const leaks = [];
  for (const m of R.members) {
    if (deny.has(m.ticker)) { leaks.push(`${m.ticker}[fee-gate-DENY-set]`); continue; }   // the fee-gate DENY signal
    if (!listing || listing.size === 0) continue;
    const L = listing.get(m.ticker);
    if (!L) continue; // no snapshot meta → can't assert (country=undefined US names: TOLERATED, never throws)
    if (L.country != null && L.country !== 'United States') {
      leaks.push(`${m.ticker}[${L.country}/${L.region}]`);   // a country-SET non-US foreigner (de-ADR guard regression)
    }
  }
  if (leaks.length) {
    throw new Error('CAPMKT_FEE_CORE ANTI-LEAK ASSERT (court revision #1/#2 — fee-gate + de-ADRd guard, keyed on the '
      + 'fee-gate DENY SIGNAL + country-SET, NOT country!=US): leaked record(s) in the capmkt_fee_core cohort: '
      + leaks.join(', ') + '. The classifier (classify-capmkt.js) must exclude fund-float artifacts + non-US-primary '
      + 'names. NOTE: country=undefined US names (MSCI/MCO/ICE/NDAQ/KKR) are TOLERATED by design — the positive '
      + 'US-primary test.');
  }
}

// --- Export: computeMedtechOrganicGrowth + computeDlstOrganicGrowth für Unit-Tests ---
// (computeDlstOrganicGrowth: Fix A FY-Alignment + Fix B dealYearExcluded-Ehrlichkeit, 2026-06-21)
// + assertNoForeignLeak (gauntlet C5) + assertIndustrialsMarquee + assertStaplesMarquee +
//   assertStaplesNoForeignLeak (Spec §6.2b) für direkten Property-Test.
module.exports = { computeMedtechOrganicGrowth, computeDlstOrganicGrowth, assertNoForeignLeak, assertIndustrialsMarquee, INDUSTRIALS_MARQUEE, assertStaplesMarquee, assertStaplesNoForeignLeak, STAPLES_MARQUEE, STAPLES_FOREIGN_CONTROL, assertConsdiscMarquee, assertConsdiscNoForeignLeak, CONSDISC_MARQUEE, CONSDISC_EXCLUDE_CONTROL, assertMaterialsMarquee, assertMaterialsNoForeignLeak, MATERIALS_MARQUEE, MATERIALS_FOREIGN_CONTROL, MATERIALS_US_PRIMARY_ALLOWLIST, assertEnergyMarquee, assertEnergyNoForeignLeak, ENERGY_MARQUEE, ENERGY_FOREIGN_CONTROL, ENERGY_US_PRIMARY_ALLOWLIST, assertPharmaMarquee, assertPharmaNoForeignLeak, PHARMA_MARQUEE, PHARMA_FOREIGN_CONTROL, PHARMA_US_PRIMARY_ALLOWLIST, assertItServicesMarquee, assertItServicesNoForeignLeak, ITSERVICES_MARQUEE, ITSERVICES_CONTAM_CONTROL, ITSERVICES_US_PRIMARY_ALLOWLIST, assertBanksMarquee, assertBanksNoForeignLeak, BANKS_MARQUEE, BANKS_FOREIGN_CONTROL, BANK_FOREIGN_DENY, assertReitsMarquee, assertReitsNoMortgageLeak, REITS_MARQUEE, REITS_MORTGAGE_CONTROL, REIT_MORTGAGE_DENY, assertCapmktMarquee, assertCapmktNoForeignLeak, CAPMKT_MARQUEE, CAPMKT_FEEGATE_CONTROL, CAPMKT_UNDEF_US_CONTROL, CAPMKT_FEEGATE_DENY, assertTechHwMarquee, assertTechHwNoForeignLeak, TECHHW_MARQUEE, TECHHW_FOREIGN_CONTROL, TECHHW_UNDEF_US_CONTROL, TECHHW_US_PRIMARY_ALLOWLIST };

// --- require.main-Guard (Härtung 2): Write + Ausgabe NUR wenn direkt als Skript ausgeführt ---
// `require('./court-score.js')` gibt nur den Export zurück und schreibt NICHT outputs/court-results.json.
// `node court-score.js` schreibt und gibt aus (unverändert).
if (require.main === module) {
  // audit/fix (gauntlet C5): fail-loud VOR dem Write — ein foreign-country-Leak (FAILURE MODE 2) oder ein
  // exiliertes US-Marquee (FAILURE MODE 1) wirft hier, bevor outputs geschrieben/Picks promotet werden.
  assertNoForeignLeak(results, listingByTicker);
  // industrials_compounder (CORE) §6.2b: the 16-name marquee watchlist must each be classified+scored, else
  // the industrials universe silently collapsed (the v0 country-filter killshot regression guard).
  assertIndustrialsMarquee(results);
  // consumer_staples_compounder (CORE) §6.2b: the 9-name marquee + FOREIGN_CONTROL positive-control + the
  // GENERATIVE country anti-leak property test must all hold, else the staples universe collapsed/leaked.
  assertStaplesMarquee(results);
  assertStaplesNoForeignLeak(results, listingByTicker);
  // consdisc_expansion (CORE) §6.1: the marquee watchlist must each be classified+scored + the auto-OEM/
  // foreign-primary EXCLUDE-CONTROL must stay out + the GENERATIVE country anti-leak property test must hold,
  // else the consdisc universe collapsed/leaked.
  assertConsdiscMarquee(results);
  assertConsdiscNoForeignLeak(results, listingByTicker);
  // materials_quality (CORE) §6: the 15-name marquee must each be classified+scored + the foreign-primary
  // miner FOREIGN_CONTROL must stay out + the GENERATIVE country anti-leak property test must hold (with the
  // CRH/LIN US-primary allowlist exempted), else the materials universe collapsed/leaked.
  assertMaterialsMarquee(results);
  assertMaterialsNoForeignLeak(results, listingByTicker);
  // energy_quality (CORE) §6: the 15-name marquee must each be classified+scored + the foreign-primary FOREIGN_
  // CONTROL must stay out + the GENERATIVE country anti-leak property test must hold (with the SLB US-primary
  // allowlist exempted), else the energy universe collapsed/leaked (the §0 NEEDS-REVISION regression guard).
  assertEnergyMarquee(results);
  assertEnergyNoForeignLeak(results, listingByTicker);
  // pharma_commercial (CORE) §6: the 16-name marquee must each be classified+scored + the foreign-primary FOREIGN_
  // CONTROL must stay out + the GENERATIVE country anti-leak property test must hold (with the JAZZ US-primary
  // allowlist exempted), else the pharma universe collapsed/leaked.
  assertPharmaMarquee(results);
  assertPharmaNoForeignLeak(results, listingByTicker);
  // it_services (CORE) §B.1: the 16-name marquee must each be classified+scored + the contaminant/foreign-primary
  // CONTAM/FOREIGN-CONTROL must stay out + the GENERATIVE country anti-leak property test must hold (with the
  // ACN/G/GLOB/INFY US-primary allowlist exempted), else the it_services universe collapsed/leaked.
  assertItServicesMarquee(results);
  assertItServicesNoForeignLeak(results, listingByTicker);
  // tech_hardware_quality (CORE court bucket) DESIGN: the 9-name marquee must each be classified+scored (survive to a
  // sane TOP-HALF rank — they ARE the franchises the absolute-anchor lifts above the commodity/loss tail) + the foreign-
  // primary FOREIGN_CONTROL must stay out + the country-undef US names MSI/KEYS/TDY must be retained + the GENERATIVE
  // anti-leak property test must hold (with the GRMN US-primary allowlist exempted), else the universe collapsed/leaked.
  assertTechHwMarquee(results);
  assertTechHwNoForeignLeak(results, listingByTicker);
  // financials_banks (CORE court bucket) DESIGN: the 7-name marquee must each be classified+scored (survive to a sane
  // rank) + the foreign-megabank-ADR DENY positive-control must stay out + the foreign-DENY anti-leak property test
  // must hold (keyed on the foreign-DENY SIGNAL, NOT country!=US — country=undefined US banks JPM/PNC/USB/MTB are
  // admitted by the positive US-primary test), else the bank universe collapsed/leaked (the de-ADR killshot guard).
  assertBanksMarquee(results);
  assertBanksNoForeignLeak(results, listingByTicker);
  // equity_reits (CORE court bucket) DESIGN: the 7-name marquee must each be classified+scored (survive to a sane rank)
  // + the mortgage-REIT positive-control must stay out (court revision #0 hard-separation) + the GENERATIVE anti-leak
  // property test must hold (mortgage-DENY signal + country-set; country=undefined US REITs O/VICI/PLD/TRNO tolerated),
  // else the REIT universe collapsed/leaked.
  assertReitsMarquee(results);
  assertReitsNoMortgageLeak(results, listingByTicker);
  // capmkt_fee_core (CORE court bucket) DESIGN: the 9-name marquee must each be classified+scored (survive to a sane
  // rank) + the fund-float fee-gate positive-control must stay out (court revision #1) + the country-undefined US
  // names MSCI/MCO/ICE/NDAQ/KKR must be retained (court revision #2) + the GENERATIVE anti-leak property test must
  // hold (fee-gate DENY signal + country-set; country=undefined US names tolerated), else the universe collapsed/leaked.
  assertCapmktMarquee(results);
  assertCapmktNoForeignLeak(results, listingByTicker);
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
