#!/usr/bin/env node
/**
 * freeze-medtech-baseline.js — pre-register the shipped medtech_devices v1.3 ranking for forward-fitness.
 *
 * Friert das medtech_devices-Ranking (v1.3, Court-DENIED-4:1 deceleration remediation) am Ship-Tag ein,
 * damit „besser" später kalendarisch (forward, ~28d / ~84d) gegen DIESE Referenz gemessen werden kann.
 * Anti-Gaming: Ranking VOR jeder weiteren Änderung eingefroren; das Forward-Fenster ist ein intrinsischer Holdout.
 * Analog fitness/freeze-fabless-baseline.js (Eintrag 7/Fabless) + saas-v1.0-degraded-2026-06-16.json.
 *
 * SI-6: Eingefroren wird das gateOpen-Ranking (gateOpen=true ⇔ headlineShortlist) mit (ticker, score, order);
 *       Forward-Fitness ist KALENDER-GATED (kein Look-ahead; Eval erst nach dem Forward-Fenster).
 *
 * Deterministisch (FROZEN_AT hardcodiert). Quelle: outputs/court-results.json :: medtech_devices.
 * Schreibt fitness/baselines/medtech-v1.3-2026-06-20.json. KEIN Scoring-Change am SaaS/Fabless-Pfad (byte-parity).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const FROZEN_AT = '2026-06-20'; // Ship-Tag medtech v1.3. Deterministisch, kein new Date().
const OUT = path.join(__dirname, 'baselines', 'medtech-v1.3-2026-06-20.json');

const results = JSON.parse(fs.readFileSync(path.join(ROOT, 'outputs', 'court-results.json'), 'utf8'));
const MED = results.medtech_devices;
if (!MED || !Array.isArray(MED.members)) { console.error('medtech_devices bucket missing in court-results.json'); process.exit(1); }

// SI-6: das EINGEFRORENE Ranking = die gateOpen-Namen (headlineShortlist) in Score-Reihenfolge.
// gateOpen=true ⇔ headlineShortlist (membership != Out AND NOT belowAbsoluteFloor). Out-class (score=null) NICHT im Ranking.
const gateOpenMembers = MED.members
  .filter(m => m.headlineShortlist && m.score != null)
  .sort((a, b) => b.score - a.score || a.ticker.localeCompare(b.ticker));

const ranking = gateOpenMembers.map((m, i) => ({
  order: i + 1,
  ticker: m.ticker,
  score: m.score,
  membershipClass: m.membershipClass || null,
  absKaliber: m.absKaliber != null ? m.absKaliber : null,
  growthOrganic: m.growthOrganic != null ? m.growthOrganic : null, // v1.3: = min(latestOrganicYoY, blend)
  latestOrganicYoY: m.latestOrganicYoY != null ? m.latestOrganicYoY : null, // v1.3: aktuelle organische Rate (Gate-Floor)
  growthBlend: m.growthBlend != null ? m.growthBlend : null,        // v1.3: backward durability view (sekundär)
  decelerating: !!m._decelerating,                                  // v1.3
  currentYearOnly: !!m._currentYearOnly,                            // v1.3 (VI)
  dealYearExcluded: !!m._dealYearExcluded,
  belowAbsoluteFloor: !!m.belowAbsoluteFloor,
}));
const evaluatedTickers = gateOpenMembers.map(m => m.ticker);

// t0 price anchors: letzter Close <= FROZEN_AT je Ticker (robust gegen spätere history.json-Änderungen).
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
  baselineId: 'medtech-v1.3-2026-06-20',
  frozenAt: FROZEN_AT,
  formula: 'medtech_devices v1.3 — absolute-anchor (normTableId medtech-norms-2026-06-20) × REL z/MAD, blendScore beta=0.6. '
    + 'Court-DENIED-4:1 DECELERATION remediation: the v1.2 growth axis input was deceleration-blind (pure backward blend '
    + '0.6*CAGR+0.4*median inflated decelerating names above their current organic rate and bypassed the gateOpen floor). '
    + 'v1.3 FIX: (I) growthOrganic = min(latestOrganicYoY, blend) — primary axis input can never read above the current '
    + 'organic rate; blend retained only as a secondary backward DURABILITY signal (growthBlend). (II) gateOpen floor '
    + '(growth>=0.15) evaluated on latestOrganicYoY → INSP (13.6%) drops off the shortlist. (III) deceleration + '
    + 'trailing-window-growth advisory lamps + regression gates. (VI) current-year-only lamp for <2 organic years (GMED). '
    + '(VII) FY-reconciliation hard-assert. Inherited v1.2: (A SI-5) full-universe, (B) winsorized-growth gate, '
    + '(C SI-4) Out-class score=null + excluded[], (D) deal-year-exclusion, (F) coverage-null lamp, (G SI-3) comparabilityNote. '
    + 'Konstanten [TODO-CAL]. SaaS/Fabless byte-identical to _parity-baseline-pre-v13.',
  source: 'outputs/court-results.json :: bucket medtech_devices',
  normTableId: MED.normTableId || 'medtech-norms-2026-06-20',
  classifiedCount: MED.classifiedCount,
  scoredCount: MED.scoredCount,
  universeSize: MED.universeSize,
  headlineShortlistSize: gateOpenMembers.length,
  normsRecheckNote: 'Fix-A re-check vs FULL 61-name universe (organic-winsorized growth / gm / opMargin percentiles): '
    + 'growth floor 0.15 ≈ p72 (target p70-80 ✓), elite 0.29 > p90(0.216) = genuine outlier tier; '
    + 'gm floor 0.55 ≈ p42, elite 0.70 ≈ p82; eff floor 0.08 ≈ p37, elite 0.25 > p90(0.207). '
    + 'Norms remain economically grounded (growth = binding axis, floor in target band) → NOT adjusted; '
    + 'frozen absolute-anchor table kept intact (changing it would needlessly perturb the court-PASSED SI-2 path).',
  forwardFitness: {
    calendarGated: true,
    metric: ['rank_ic_spearman', 'top_n_minus_universe_median_fwd_return'],
    horizonsDays: [28, 84],
    windowEnds: { d28: '~2026-07-18', d84: '~2026-09-12' },
    survivorshipKey: 'evaluatedTickers',
    antiGaming: 'gateOpen-Ranking am Ship-Tag (vor jeder weiteren medtech-Änderung) eingefroren. Forward-Fenster = '
      + 'intrinsischer Holdout; Eval erst NACH Kalender-Gate. Erzeugende Agenten dürfen NIE auf dem Eval-Slice tunen. '
      + 'Eine neue medtech-Version gilt nur als „besser", wenn sie diese Forward-Metrik STRIKT schlägt.',
    honestLimitation: 'N=' + gateOpenMembers.length + ' gateOpen-Namen ist klein — Rank-IC/Kohorten-Spread haben Richtungs-, '
      + 'nicht starke statistische Aussagekraft. Primärer Wert: Pre-Registration-Disziplin + Beitrag zur gepoolten Cross-Formel-Fitness.',
  },
  anchors: MED.anchors,
  comparabilityNote: MED.comparabilityNote || null,
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
console.log('ranking:', ranking.map(r => r.order + '.' + r.ticker + '(' + r.score + ')').join(' '));
console.log('priceAnchorStatus:', baseline.priceAnchorStatus.split('—')[0].trim());
if (missing.length) console.log('WARN missing t0 prices:', missing.join(','));
