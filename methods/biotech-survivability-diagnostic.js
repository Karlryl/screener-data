'use strict';
/**
 * biotech-survivability-diagnostic — Pre-Revenue-Biotech SURVIVABILITY DIAGNOSTIC
 * ==============================================================================
 * Spec: Vault formula-design-special_tracks-v0-2026-06-22.md PART A (Council->Court
 *       DESIGN-PASS). This is the implemented HOME for the SI-4 pre-revenue destination.
 *
 * WHAT THIS IS — and is NOT (design §A.0):
 *   A DIAGNOSTIC that reads SURVIVABILITY (can a clinical-stage biotech reach its next
 *   catalyst without a dilutive death-spiral?) and flags OPTIONALITY cost (dilution). It
 *   is NOT a business-quality / compounder score. Return distribution of pre-rev biotech
 *   is bimodal (+400%/-90% on a single 8-K), NOT log-normal — a smooth percentile rank
 *   cannot represent a binary clinical event and would contaminate the cross-section. So:
 *   NO blendScore against compounders, NO absKaliber, NO 0..100 score, β irrelevant
 *   (ABSOLUTE survivability bands, not peer-relative). It emits {tier, lamps[], runwayQ,
 *   dilutionTier}. court-score's pre-revenue names are SI-4 score=null in every quality
 *   bucket; this diagnostic is their home, NOT a quality competitor. It is registered as a
 *   methods/ DIAGNOSTIC (type DIAGNOSTIC, NOT in any SCORE_WEIGHTS) -> fixture-hash safe.
 *
 * WHY a methods/ DIAGNOSTIC and not a court bucket (the honest shape, design §A.0 + §SI-2):
 *   the court-score buckets are QUALITY-compounder buckets (absKaliber + blendScore + REL).
 *   A survivability read has thresholds, not floor/elite quality calibration, and MUST stay
 *   out of the cross-sector quality rank by construction. court-score's `survivabilityDiagnostic`
 *   was specced to reuse q() for monotone sub-signals but explicitly NOT call absKaliber/
 *   blendScore. The methods/ DIAGNOSTIC contract (tier-via-absolute-bands, lamps, computable
 *   flag, NO SCORE_WEIGHTS membership — exactly altman-z / ohlson-o / beneish) is the faithful
 *   home for that shape; it is structurally impossible to blend it as quality.
 *
 * COHORT (the caller filters; this method is robust if called on any name):
 *   design §A.1 cohort = Healthcare ∧ Biotechnology ∧ US ∧ marketCap>=$200M ∧ latestRev<$50M.
 *   classification/universe-guarding live in the caller (court classifier path); this pure
 *   method computes the survivability read from local balance + cash-flow data and emits a
 *   PRE_REVENUE vs SELF_FUNDING stage label so a self-funding (OCF>=0) name routes OUT.
 *
 * AXES (design §A.2 — sub-signals -> survivability/dilution TIER via ABSOLUTE bands; NOT
 * weighted-summed into a quality score):
 *   Axis 1 CASH RUNWAY (quarters) — load-bearing.
 *     liquidResources = currentAssets - currentLiabilities  (NOT totalCash alone — biotechs
 *       park raises in short-term marketable securities held OUTSIDE totalCash; shortTermInvestments
 *       is null in the snapshots so CA-CL is the proxy). Fallback to totalCash where CA null
 *       (+LIQUIDITY_PARTIAL lamp).
 *     runwayQ = liquidResources / |annualOCF[0]/4|   (OCF, not FCF: operating-burn truth, nets
 *       non-cash SBC; capex trivial clinical-stage).
 *     BANDS (anchored to ASC 205-40's ~12-month / ~4Q going-concern lookahead, NOT invented):
 *       <4Q CRITICAL (going-concern danger), 4-8Q WATCH, 8-16Q FUNDED, >16Q WELL_FUNDED.
 *   Axis 2 DILUTION TIER.
 *     nsi = (annualShares[0]-annualShares[1])/annualShares[1]; WINSORIZE at +1.00 + SHARE_RESET
 *       lamp (a one-time IPO/follow-on/reverse-merger reset must NOT read as a death-spiral).
 *       >=+25% SERIAL_DILUTER, +5..25% DILUTING, <+5% STABLE.
 *   Axis 3 R&D-share-of-burn — routing-confirmation lamp only (annualRnD[0]/|OCF[0]| >= 0.50),
 *     NOT a tier (live median ~0.97, not discriminating).
 *   Axis 4 LIQUIDITY cross-check — currentRatio = CA/CL; currentRatio<1 AND runway<4Q escalates
 *     to INSOLVENCY_WATCH.
 *
 * pass semantics (DIAGNOSTIC, threshold = the going-concern band): pass = runway >= 4Q
 *   (NOT in the ASC-205-40 going-concern danger zone) AND not escalated to INSOLVENCY_WATCH.
 *   This is a survivability read, NOT a quality verdict — a "pass" says "funded to the next
 *   catalyst on current burn", nothing about whether the drug works (that is 🔴 uncomputable).
 *
 * UNCOMPUTABLE value-drivers (design §A.3) are surfaced as ALWAYS-ON text walls, NEVER faked:
 *   PIPELINE_BLIND, CATALYST_BLIND, GOINGCONCERN_TEXT, REVERSE_SPLIT_BLIND, MODALITY_BLIND,
 *   BINARY_EVENT_WALL, STI_BLIND, BURN_LUMPY.
 *
 * DIAGNOSTIC, NOT in any SCORE_WEIGHTS -> tag28 fixture-hash invariant safe by construction.
 */
const H = require('./_helpers.js');

const ID = 'biotech-survivability-diagnostic';
// pass = runway not in the ASC-205-40 going-concern danger zone (>=4 quarters of operating runway)
const THRESHOLD = 4;
const THRESHOLD_OP = 'gte';

// Frozen DIAGNOSTIC bands (design §A.5 — a diagnostic has thresholds, not floor/elite).
// Object.freeze: the survivability bands are baseline-frozen (SI-6 frozen id).
const DIAG = Object.freeze({
  id: 'biotech-prerev-diag-2026-06-22',
  runwayBands: Object.freeze({ critical: 4, watch: 8, funded: 16 }), // quarters; ASC 205-40 ~4Q
  dilutionBands: Object.freeze({ stable: 0.05, diluting: 0.25 }),     // NSI latest YoY
  nsiWinsor: 1.00,                                                    // SHARE_RESET cap
  rndBurnConfirm: 0.50,
  liquidityWatch: 1.0,
  smallCapTier: 1e9,                                                  // <$1B -> CAPITAL_ACCESS_BLIND
  burnCutDeep: -0.40,                                                 // burn slashed >40% YoY -> BURN_CUT_DEEP
});

// Always-on TEXT walls (design §A.3/§A.6) — uncomputable value-drivers surfaced as walls,
// never numbers, never faked/imputed. Present on EVERY computable read.
const ALWAYS_ON_WALLS = Object.freeze([
  'STI_BLIND',            // no shortTermInvestments field -> CA-CL is the liquid-resources proxy
  'BURN_LUMPY',           // annual OCF/4 is not a clean quarter (conservative-by-construction)
  'PIPELINE_BLIND',       // phase/breadth (single-asset vs platform) uncomputable
  'CATALYST_BLIND',       // PDUFA/AdComm/topline dates — the binary events — uncomputable
  'GOINGCONCERN_TEXT',    // ASC 205-40 narrative uncomputable
  'REVERSE_SPLIT_BLIND',  // Nasdaq sub-$1 cure distress tell uncomputable
  'MODALITY_BLIND',       // LOA prior (CAR-T/oncology/hematology) advisory-only, uncomputable
  'BINARY_EVENT_WALL',    // binary readouts gap through TA stops — structural flag
]);

// dual-shape annual extractor at an arbitrary index (mirrors altman _annualVal; _helpers
// latestAnnual/latestBalance only read index 0, and the dilution axis needs index 0 AND 1).
function annualAt(arr, idx) {
  if (!Array.isArray(arr) || arr.length <= idx) return null;
  const v = arr[idx];
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && 'value' in v) return Number.isFinite(v.value) ? v.value : null;
  return null;
}
function balanceAt(stock, idx, field) {
  const arr = H.val(stock, 'annual.annualBalance');
  if (!Array.isArray(arr) || arr.length <= idx || arr[idx] == null) return null;
  const v = arr[idx][field];
  return Number.isFinite(v) ? v : null;
}

function evaluate(stock) {
  // --- §A.1 COHORT GATE (activation 2026-06-23) ---
  // This DIAGNOSTIC is meaningful ONLY for the pre-revenue clinical-biotech cohort. The generic
  // prod runner (runner.evaluateStock onlyDefault) has no cohort concept, so — now that this method
  // is defaultActive — it self-scopes here to stop a profitable NON-biotech from being labeled
  // SELF_FUNDING (the OCF>=0 SELF_FUNDING escape below is intended ONLY for a biotech that turned
  // self-funding, not for AAPL). Mirrors closed-end-trust-guard self-scoping via meta.industry.
  // Outside the cohort -> computable:false OUT_OF_COHORT (never a faked tier). Cohort (spec
  // formula-design-special_tracks-v0 §A.1): Healthcare ∧ Biotechnology ∧ US-listed ∧
  // marketCap>=$200M ∧ latestAnnualRev<$50M. The court-score classifier remains the cohort authority
  // for the buckets; this self-gate only governs the standalone methods/ DIAGNOSTIC.
  {
    const meta = (stock && stock.meta) || {};
    const country = meta.country;
    const mcRaw = H.val(stock, 'marketCap');
    const mcGate = (mcRaw != null && typeof mcRaw === 'object' && 'value' in mcRaw)
      ? (Number.isFinite(mcRaw.value) ? mcRaw.value : null)
      : (Number.isFinite(mcRaw) ? mcRaw : null);
    let latestRev = null;
    const revArr = stock && stock.annual && stock.annual.annualRev;
    if (Array.isArray(revArr)) {
      for (let i = 0; i < revArr.length; i++) { const v = annualAt(revArr, i); if (v != null) { latestRev = v; break; } }
    }
    const revForGate = latestRev == null ? 0 : latestRev; // truly pre-revenue (no rev data) => 0 => in cohort
    const inCohort =
      meta.sector === 'Healthcare' &&
      meta.industry === 'Biotechnology' &&
      (country == null || country === 'United States') &&   // US-listing-lite (vintage-A US names carry null country)
      mcGate != null && mcGate >= 200e6 &&
      revForGate < 50e6;
    if (!inCohort) {
      return H.buildResult({
        value: null,
        pass: false,
        computable: false,           // OUT_OF_COHORT: withheld, never faked
        threshold: THRESHOLD, thresholdOp: THRESHOLD_OP,
        reason: 'OUT_OF_COHORT: biotech-survivability applies only to Healthcare∧Biotechnology∧US∧marketCap>=$200M∧latestRev<$50M (spec §A.1) — not computed for this name',
        components: { diagnosticId: DIAG.id, stage: 'OUT_OF_COHORT', tier: null, runwayQ: null, dilutionTier: null, lamps: [] },
      });
    }
  }

  const a = (stock && stock.annual) || {};
  const ocf0 = annualAt(a.annualOCF, 0);
  const mc = H.val(stock, 'marketCap');
  const marketCap = (mc != null && typeof mc === 'object' && 'value' in mc)
    ? (Number.isFinite(mc.value) ? mc.value : null)
    : (Number.isFinite(mc) ? mc : null);

  // --- Stage label / self-funding escape (design §A.1): OCF[0] >= 0 -> runway=∞, route OUT. ---
  if (ocf0 != null && ocf0 >= 0) {
    return H.buildResult({
      value: 'SELF_FUNDING',
      pass: true,                  // a self-funding name is trivially survivable on operations
      computable: true,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP,
      reason: 'SELF_FUNDING: annualOCF[0] >= 0 — operating-self-funding, routes OUT of the pre-revenue diagnostic toward a normal quality track',
      components: {
        diagnosticId: DIAG.id, stage: 'SELF_FUNDING', tier: 'SELF_FUNDING',
        runwayQ: Infinity, dilutionTier: null,
        lamps: ['SELF_FUNDING'].concat(ALWAYS_ON_WALLS),
      },
    });
  }

  // --- Axis 1: cash runway (quarters) ---
  const ca = balanceAt(stock, 0, 'currentAssets');
  const cl = balanceAt(stock, 0, 'currentLiabilities');
  const totalCash = balanceAt(stock, 0, 'totalCash');
  const lamps = ALWAYS_ON_WALLS.slice();

  let liquidResources = null, liquidityPartial = false;
  if (ca != null && cl != null) {
    liquidResources = ca - cl;                 // design numerator: CA-CL captures STI held outside totalCash
  } else if (totalCash != null) {
    liquidResources = totalCash;               // fallback where currentAssets null
    liquidityPartial = true;
    lamps.push('LIQUIDITY_PARTIAL');
  }

  // Coverage gate: liquidResources + OCF[0] must both be present, OCF must be a burn (<0).
  if (liquidResources == null || ocf0 == null || ocf0 >= 0) {
    lamps.push('RUNWAY_NOT_READY');
    return H.buildResult({
      value: null,
      pass: false,
      computable: false,           // tier WITHHELD, never faked (design §A.2 honesty wall)
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP,
      reason: 'RUNWAY_NOT_READY: liquidResources (CA-CL or totalCash) and/or operating burn (annualOCF[0]<0) unavailable — survivability tier withheld, never faked',
      components: { diagnosticId: DIAG.id, stage: 'PRE_REVENUE', tier: null, runwayQ: null, dilutionTier: null, lamps },
    });
  }

  const quarterlyBurn = Math.abs(ocf0 / 4);
  // quarterlyBurn==0 is impossible here (ocf0<0 guaranteed), but guard against /0 defensively.
  const runwayQ = quarterlyBurn > 0 ? liquidResources / quarterlyBurn : Infinity;

  // Runway tier via ABSOLUTE bands (NOT a percentile rank).
  let runwayTier;
  if (runwayQ < DIAG.runwayBands.critical) runwayTier = 'CRITICAL';
  else if (runwayQ < DIAG.runwayBands.watch) runwayTier = 'WATCH';
  else if (runwayQ < DIAG.runwayBands.funded) runwayTier = 'FUNDED';
  else runwayTier = 'WELL_FUNDED';

  // --- Axis 4: liquidity cross-check / insolvency escalation ---
  const currentRatio = (ca != null && cl != null && cl > 0) ? ca / cl : null;
  let insolvencyWatch = false;
  if (currentRatio != null && currentRatio < DIAG.liquidityWatch && runwayQ < DIAG.runwayBands.critical) {
    insolvencyWatch = true;
    lamps.push('INSOLVENCY_WATCH');
  }

  // --- Axis 2: dilution tier (NSI latest YoY, winsorized at +1.00) ---
  const sh0 = annualAt(a.annualShares, 0);
  const sh1 = annualAt(a.annualShares, 1);
  let dilutionTier = null, nsi = null;
  if (sh0 != null && sh1 != null && sh1 > 0) {
    nsi = (sh0 - sh1) / sh1;
    if (nsi > DIAG.nsiWinsor) { nsi = DIAG.nsiWinsor; lamps.push('SHARE_RESET'); } // one-time reset, not a death-spiral
    if (nsi >= DIAG.dilutionBands.diluting) dilutionTier = 'SERIAL_DILUTER';
    else if (nsi >= DIAG.dilutionBands.stable) dilutionTier = 'DILUTING';
    else dilutionTier = 'STABLE';
  } else {
    lamps.push('DILUTION_NOT_READY'); // ~coverage gap; never imputed
  }

  // --- Axis 3: R&D-share-of-burn routing-confirmation lamp (NOT a tier) ---
  const rnd0 = annualAt(a.annualRnD, 0);
  if (rnd0 != null && ocf0 !== 0) {
    const rndShare = rnd0 / Math.abs(ocf0);
    if (rndShare >= DIAG.rndBurnConfirm) lamps.push('RND_BURN_CONFIRM'); // capital buys pipeline not overhead
  }

  // --- BURN_CUT_DEEP (design §A.6): burn slashed >40% YoY — disciplined runway-extension vs
  //     pipeline-abandonment; cannot fully resolve from data -> disclosed lamp. ---
  const ocf1 = annualAt(a.annualOCF, 1);
  if (ocf1 != null && ocf1 < 0) {
    const burnChange = (Math.abs(ocf0) - Math.abs(ocf1)) / Math.abs(ocf1); // <0 = burn cut
    if (burnChange <= DIAG.burnCutDeep) lamps.push('BURN_CUT_DEEP');
  }

  // --- <$1B capital-access blindness (design §A.1 small-cap slice) ---
  if (marketCap != null && marketCap < DIAG.smallCapTier) lamps.push('CAPITAL_ACCESS_BLIND');

  // composite survivability tier: INSOLVENCY_WATCH dominates, else the runway band.
  const tier = insolvencyWatch ? 'INSOLVENCY_WATCH' : runwayTier;
  // pass = funded past the ASC-205-40 going-concern danger zone AND not insolvency-escalated.
  const pass = runwayQ >= DIAG.runwayBands.critical && !insolvencyWatch;

  return H.buildResult({
    value: Math.round(runwayQ * 100) / 100, // runway in QUARTERS (the load-bearing number)
    pass,
    computable: true,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP,
    reason: `runway=${runwayQ.toFixed(1)}Q (${tier})${dilutionTier ? ', dilution=' + dilutionTier : ''}` +
            `${liquidityPartial ? ' [LIQUIDITY_PARTIAL]' : ''} — SURVIVABILITY diagnostic, NOT a quality score`,
    components: {
      diagnosticId: DIAG.id,
      stage: 'PRE_REVENUE',
      tier,
      runwayQ: Math.round(runwayQ * 100) / 100,
      runwayTier,
      dilutionTier,
      nsi: nsi != null ? Math.round(nsi * 10000) / 10000 : null,
      liquidResources,
      quarterlyBurn,
      currentRatio: currentRatio != null ? Math.round(currentRatio * 100) / 100 : null,
      insolvencyWatch,
      lamps,
    },
  });
}

module.exports = {
  id: ID,
  label: 'Biotech Pre-Revenue Survivability',
  description: 'Pre-revenue biotech SURVIVABILITY diagnostic (cash-runway quarters = (CA-CL)/|OCF/4|, ASC-205-40 going-concern bands, dilution tier, self-funding escape). A diagnostic, NOT a quality score — explicitly excluded from cross-sector quality blending.',
  threshold: THRESHOLD,
  thresholdOp: THRESHOLD_OP,
  unit: 'quarters',
  evaluate,
  // exported for the unit test / any caller that wants the frozen bands
  DIAG,
  ALWAYS_ON_WALLS,
};
