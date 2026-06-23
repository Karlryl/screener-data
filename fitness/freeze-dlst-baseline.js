#!/usr/bin/env node
/**
 * freeze-dlst-baseline.js — pre-register the shipped diagnostics_lst v1.2 ranking for forward-fitness (SI-6).
 *
 * v1.2 (Re-Court 2 PASS / 1 DENY → quality-hardened): Fix 1 (tools-GM-floor re-anchored .30->.28, CRO/service-class,
 * not overfit to MEDP), Fix 2 (eff-REL hard clamp -> continuous taper, removes the ~2.5pt cliff), Fix 3 (chronic-acquirer
 * +decelerating: real displayed-score haircut + cap below best non-demoted, not just a sort-key demotion), Fix 4
 * (comparabilityNote GM strings interpolated from live NORMS). Writes diagnostics-lst-v1.2-2026-06-21.json.
 *
 * Friert das diagnostics_lst-Ranking (v1.1, cohort-aware dx|tools) am Re-Court-Remediations-Tag ein, damit
 * „besser" später kalendarisch (forward, ~28d / ~84d) gegen DIESE Referenz gemessen werden kann. Anti-Gaming:
 * Ranking VOR jeder weiteren Änderung eingefroren; das Forward-Fenster ist ein intrinsischer Holdout.
 *
 * v1.1 (Court v1.0 DENIED → remediiert): Fix A (Gate-Floor liest growthOrganic=min(latest,blend), nicht uncapped
 * latest → ADPT raus), Fix B (opMargin/FCF-Slots getrennt, echte Rule-of-X → NTRA raus), Fix C (eff-REL geclampt
 * auf neutral unter dem cohort eff-Floor → Cash-Burner-dx hören auf via REL zu dominieren), Fix D (cross-bucket-
 * Disclosure: absKaliber als einziges cross-bucket-vergleichbares Maß), Fix E (chronic-acquirer+decelerating-VETO:
 * VCYT demoviert, nicht #1), Fix F [TODO-CAL] (tools-GM-Floor 0.38→0.30 admittiert MEDP legitim).
 *
 * SI-6: Eingefroren wird das gateOpen-Ranking (gateOpen=true ⇔ headlineShortlist) mit (ticker, score, order, cohort,
 *       demoted); Demotion-aware (Fix E): ein chronic-acquirer+decelerating-Name sitzt nie auf Order #1.
 *       Forward-Fitness ist KALENDER-GATED (kein Look-ahead; Eval erst nach dem Forward-Fenster).
 *
 * Deterministisch (FROZEN_AT hardcodiert). Quelle: outputs/court-results.json :: diagnostics_lst.
 * Schreibt fitness/baselines/diagnostics-lst-v1.1-2026-06-21.json. KEIN Scoring-Change am SaaS/Fabless/Medtech-Pfad (byte-parity).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const FROZEN_AT = '2026-06-21'; // Re-Court-Remediations-Tag diagnostics_lst v1.2. Deterministisch, kein new Date().
const OUT = path.join(__dirname, 'baselines', 'diagnostics-lst-v1.2-2026-06-21.json');

const results = JSON.parse(fs.readFileSync(path.join(ROOT, 'outputs', 'court-results.json'), 'utf8'));
const D = results.diagnostics_lst;
if (!D || !Array.isArray(D.members)) { console.error('diagnostics_lst bucket missing in court-results.json'); process.exit(1); }

// SI-6: das EINGEFRORENE Ranking = die gateOpen-Namen (headlineShortlist) in der DEMOTION-aware Headline-Reihenfolge
// (Fix E): nicht-demovierte Headline-Namen zuerst (nach Score), demovierte (chronic-acquirer+decelerating) dahinter.
// Wir lesen die bereits demotion-aware sortierte members-Liste und filtern auf headlineShortlist → Order = Headline-Rang.
const headlineMembers = D.members.filter(m => m.headlineShortlist && m.score != null);

const ranking = headlineMembers.map((m, i) => ({
  order: i + 1,
  ticker: m.ticker,
  cohort: m.cohort || null,
  score: m.score,
  demoted: !!m.headlineDemoted,            // Fix E: chronic-acquirer+decelerating-VETO → nicht #1
  membershipClass: m.membershipClass || null,
  absKaliber: m.absKaliber != null ? m.absKaliber : null, // Fix D: cross-bucket-comparable
  scoreScope: m.scoreScope || null,        // Fix D: 'intra-bucket'
  growthOrganic: m.growthOrganic != null ? m.growthOrganic : null, // = min(latestOrganicYoY, blend); Gate-Floor liest DIES (Fix A)
  latestOrganicYoY: m.latestOrganicYoY != null ? m.latestOrganicYoY : null,
  growthBlend: m.growthBlend != null ? m.growthBlend : null,
  gm: m.gm != null ? m.gm : null,
  opMargin: m.opMargin != null ? m.opMargin : null, // Fix B: echter opMargin (Gate-RoX-Arm liest DIES, nicht FCF)
  fcfMargin: m.fcfMargin != null ? m.fcfMargin : null,
  effDlst: m.effDlst != null ? m.effDlst : null,
  effSource: m.effSource || null,
  scorePreHaircut: m.scorePreHaircut != null ? m.scorePreHaircut : null, // v1.2 Fix 3: Roh-Score vor dem chronic+decel-Haircut (Audit)
  decelerating: !!m._decelerating,
  chronicAcquirer: !!m._chronicAcquirer,
  dealYearExcluded: !!m._dealYearExcluded,
  goodwillToRev: m.goodwillToRev != null ? m.goodwillToRev : null,
  cumPaymentsToRev: m.cumPaymentsToRev != null ? m.cumPaymentsToRev : null,
  belowAbsoluteFloor: !!m.belowAbsoluteFloor,
}));
const evaluatedTickers = headlineMembers.map(m => m.ticker);

// t0 price anchors: letzter Close <= FROZEN_AT je Ticker.
let hist = {};
try { hist = JSON.parse(fs.readFileSync(path.join(ROOT, 'prices', 'history.json'), 'utf8')); } catch { hist = {}; }
const anchorClose = t => {
  const s = hist[t]; if (!Array.isArray(s) || !s.length) return null;
  let best = null;
  for (const p of s) { if (p && p.date && p.date <= FROZEN_AT && p.close != null) { if (!best || p.date > best.date) best = p; } }
  return best ? { date: best.date, close: best.close } : null;
};
const priceAnchors = {};
for (const t of [...evaluatedTickers, 'SPY', 'QQQ', 'IWM', 'XLV', 'IHI']) priceAnchors[t] = anchorClose(t);
const missing = evaluatedTickers.filter(t => !priceAnchors[t]);

const baseline = {
  baselineId: 'diagnostics-lst-v1.2-2026-06-21',
  supersedes: 'diagnostics-lst-v1.1-2026-06-21 (Re-Court 2 PASS / 1 DENY — quality hardening: GM-floor overfit, eff-REL clamp cliff, demoted-score display dishonesty, hardcoded disclosure-drift)',
  frozenAt: FROZEN_AT,
  formula: 'diagnostics_lst v1.2 — cohort-aware (dx | tools) absolute-anchor (normTableId dlst-norms-2026-06-20: dx gm .50/.65, '
    + 'tools gm .28/.58 [v1.2 Fix 1 TODO-CAL: tools-floor re-anchored .30->.28 to a defensible CRO/service-class threshold — '
    + 'service-model tools structurally run ~28-33% GM; .30 was overfit to MEDP gm 0.3006 (6bp clearance), .28 gives MEDP ~2.1pp '
    + 'real headroom and admits NO new name]) × REL z/MAD computed PER COHORT (dx vs dx, tools vs tools), blendScore beta=0.6, '
    + 'absWeights {growth .40, gm .20, eff .40}. Growth = deceleration-safe min(latestOrganicYoY, 0.6*CAGR_3y+0.4*median organic '
    + 'YoY); deal-year-exclusion threshold 0.15*rev (per-year revenue denominator), blend-median per-year floor -15% (latest '
    + 'uncapped). Fix A: gateOpen floor (growth>=0.15) AND the Rule-of-X arm read growthOrganic=min(latest,blend) (NOT uncapped '
    + 'latest). Fix B: gate eff-arms read TRUE opMargin (arm1 + RoX arm3) and FCF (arm2) in SEPARATE slots (no slot-poisoning). '
    + 'v1.2 Fix 2: eff-REL axis CONTINUOUS TAPER (replaces v1.1 hard s->0 clamp) — positive eff-REL z linearly scaled 0 at '
    + 'FCF<=floor-band to full at FCF>=floor (band 0.04, [TODO-CAL]); removes the ~2.5pt CDNA(0.093)->0 vs EXAS(0.110)->0.33 '
    + 'discontinuity; below floor-band still forced to 0 so the cohort-pooling cash-burn artifact stays suppressed. Efficiency = '
    + 'FCF-margin primary, opMargin fallback (>15pp distortion or fcf-null). v1.2 Fix 3: chronic-acquirer (gw/rev>1.0 OR '
    + 'cumDeltaGW/rev>0.40) + decelerating => shortlist DEMOTION + REAL SCORE HAIRCUT (CHRONIC_DECEL_HAIRCUT 12% [TODO-CAL], '
    + 'capped below the best non-demoted headline score) so the DISPLAYED score matches the rank (VCYT shown score now < MEDP; '
    + 'scorePreHaircut retained for audit). Fix D: blended score is INTRA-BUCKET only; absKaliber is the only cross-bucket-'
    + 'comparable measure (scoreScope + crossBucketComparableField on every member). v1.2 Fix 4: comparabilityNote GM strings '
    + 'INTERPOLATED from live NORMS (no hardcoded drift). Lamps: chronic-acquirer, cum-payments (>0.15), goodwill-impairment, '
    + 'deal-year-jump, cyclicality (per cohort), recurring-mix advisory, deceleration. R&D + shares DEFERRED -> coverage-null '
    + 'lamps, never penalized. Konstanten [TODO-CAL]. SaaS/Fabless/Medtech byte-identical to _parity-baseline-pre-dlst.',
  source: 'outputs/court-results.json :: bucket diagnostics_lst',
  normTableId: D.normTableId || 'dlst-norms-2026-06-20',
  cohortAware: true,
  cohortCounts: D.cohortCounts || null,
  classifiedCount: D.classifiedCount,
  scoredCount: D.scoredCount,
  universeSize: D.universeSize,
  headlineShortlistSize: headlineMembers.length,
  scoreScope: D.scoreScope || 'intra-bucket',
  crossBucketComparableField: D.crossBucketComparableField || 'absKaliber',
  forwardFitness: {
    calendarGated: true,
    metric: ['rank_ic_spearman', 'top_n_minus_universe_median_fwd_return'],
    horizonsDays: [28, 84],
    windowEnds: { d28: '~2026-07-19', d84: '~2026-09-13' },
    survivorshipKey: 'evaluatedTickers',
    antiGaming: 'gateOpen-Ranking am Remediations-Tag (vor jeder weiteren dlst-Änderung) eingefroren. Forward-Fenster = '
      + 'intrinsischer Holdout; Eval erst NACH Kalender-Gate. Erzeugende Agenten dürfen NIE auf dem Eval-Slice tunen. '
      + 'Eine neue dlst-Version gilt nur als „besser", wenn sie diese Forward-Metrik STRIKT schlägt.',
    honestLimitation: 'N=' + headlineMembers.length + ' gateOpen-Namen ist klein (cohort-split macht n pro Kohorte noch dünner) — '
      + 'Rank-IC/Kohorten-Spread haben Richtungs-, nicht starke statistische Aussagekraft. Primärer Wert: Pre-Registration-Disziplin.',
  },
  anchors: D.anchors,
  anchorsByCohort: D.anchorsByCohort || null,
  comparabilityNote: D.comparabilityNote || null,
  priceAnchorStatus: missing.length
    ? `PARTIAL — fehlende t0-Preise: ${missing.join(',')}`
    : `CAPTURED — t0-Close je Ticker eingefroren. Forward-Return = close[t0+h]/close[t0]-1.`,
  ranking,
  evaluatedTickers,
  priceAnchors,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(baseline, null, 2));
console.log('Wrote', OUT);
console.log('frozenAt', FROZEN_AT, '| universeSize', baseline.universeSize, '| classified/scored', baseline.classifiedCount + '/' + baseline.scoredCount, '| headlineShortlist', baseline.headlineShortlistSize);
console.log('cohortCounts', JSON.stringify(baseline.cohortCounts));
console.log('ranking:', ranking.map(r => r.order + '.' + r.ticker + '(' + r.cohort + ',' + r.score + (r.demoted ? ',DEMOTED' : '') + ')').join(' '));
console.log('priceAnchorStatus:', baseline.priceAnchorStatus.split('—')[0].trim());
if (missing.length) console.log('WARN missing t0 prices:', missing.join(','));
