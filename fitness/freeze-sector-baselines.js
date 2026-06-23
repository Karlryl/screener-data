#!/usr/bin/env node
/**
 * freeze-sector-baselines.js — SI-6 pre-registration of the 7 sector-expansion CORE buckets
 * (industrials / staples / consdisc / materials / energy / pharma / it_services) for forward-fitness.
 *
 * WHY: the 7 sector buckets shipped CORE + independent-Re-Court-PASS (loop/formel-haertung), but —
 * unlike the older buckets (saas/fabless/medtech/dlst) — never got a frozen forward-fitness baseline.
 * That is the only remaining SI-6 hygiene gap for them (court-score-tests are green; nothing is blocked).
 * This freezes each bucket's gateOpen (headlineShortlist) ranking at FROZEN_AT so "better later" can be
 * measured KALENDER-gated (~28d / ~84d forward) against THIS reference. Anti-gaming: ranking frozen BEFORE
 * any further change → the forward window is an intrinsic holdout. Mirrors freeze-medtech-baseline.js /
 * freeze-dlst-baseline.js exactly (gateOpen = headlineShortlist; t0 price anchors = last close <= FROZEN_AT).
 *
 * SHAPE DIFFERENCE vs the older single-key buckets: each sector bucket is split across COHORT keys in
 * court-results.json (e.g. industrials_heavy + industrials_light). One baseline file per bucket aggregates
 * its cohort keys; every ranking row carries its `cohort` so cohort-level analysis stays possible. Per-cohort
 * normTableId / classifiedCount / scoredCount / anchors are preserved under `cohorts`.
 *
 * Deterministic (FROZEN_AT hardcoded, no new Date() in the frozen payload). Source: outputs/court-results.json.
 * KEIN Scoring-Change — only writes fitness/baselines/*.json (the scoring path never imports fitness/).
 *
 * Usage:  node fitness/freeze-sector-baselines.js            # freeze all 7 buckets
 *         node fitness/freeze-sector-baselines.js industrials # freeze one (substring match on bucket id)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const FROZEN_AT = '2026-06-23';          // ship-day of the integrated loop/formel-haertung sector buckets. Deterministic.
const WINDOW_ENDS = { d28: '~2026-07-21', d84: '~2026-09-15' }; // FROZEN_AT + 28d / + 84d (hardcoded, no Date math).

// bucket id -> { cohort keys in court-results.json, output filename, broad-market + sector benchmark tickers }
const BUCKETS = {
  industrials_compounder:      { keys: ['industrials_heavy', 'industrials_light'],            file: 'industrials-v1.0-2026-06-23.json',  etf: 'XLI' },
  consumer_staples_compounder: { keys: ['staples_branded', 'staples_distribution'],           file: 'staples-v1.0-2026-06-23.json',      etf: 'XLP' },
  consdisc_expansion:          { keys: ['consdisc_store', 'consdisc_light'],                  file: 'consdisc-v1.0-2026-06-23.json',     etf: 'XLY' },
  materials_quality:           { keys: ['materials_pricingpower', 'materials_commodity'],      file: 'materials-v1.0-2026-06-23.json',    etf: 'XLB' },
  energy_quality:              { keys: ['energy_upstream', 'energy_midstream', 'energy_services'], file: 'energy-v1.0-2026-06-23.json',  etf: 'XLE' },
  pharma_commercial:           { keys: ['pharma_branded', 'pharma_biopharma', 'pharma_specialty'], file: 'pharma-v1.0-2026-06-23.json',  etf: 'XLV' },
  it_services:                 { keys: ['it_services'],                                        file: 'it_services-v1.0-2026-06-23.json',  etf: 'XLK' },
};

const results = JSON.parse(fs.readFileSync(path.join(ROOT, 'outputs', 'court-results.json'), 'utf8'));

// t0 price anchors: last close <= FROZEN_AT per ticker (robust against later history.json changes).
let hist = {};
try { hist = JSON.parse(fs.readFileSync(path.join(ROOT, 'prices', 'history.json'), 'utf8')); } catch { hist = {}; }
const anchorClose = t => {
  const s = hist[t]; if (!Array.isArray(s) || !s.length) return null;
  let best = null;
  for (const p of s) { if (p && p.date && p.date <= FROZEN_AT && p.close != null) { if (!best || p.date > best.date) best = p; } }
  return best ? { date: best.date, close: best.close } : null;
};

function freezeBucket(bucketId, spec) {
  const cohortsPresent = spec.keys.filter(k => results[k] && Array.isArray(results[k].members));
  if (!cohortsPresent.length) {
    console.error(`SKIP ${bucketId}: none of [${spec.keys.join(', ')}] present in court-results.json`);
    return null;
  }

  // gather all headlineShortlist members across the bucket's cohort keys, score-desc (ticker tiebreak).
  const members = [];
  const cohortMeta = {};
  for (const k of cohortsPresent) {
    const b = results[k];
    cohortMeta[k] = {
      normTableId: b.normTableId || null,
      classifiedCount: b.classifiedCount != null ? b.classifiedCount : null,
      scoredCount: b.scoredCount != null ? b.scoredCount : null,
      universeSize: b.universeSize != null ? b.universeSize : null,
      anchors: b.anchors || null,
      comparabilityNote: b.comparabilityNote || null,
    };
    for (const m of b.members) {
      if (m && m.headlineShortlist && m.score != null) members.push({ ...m, _cohortKey: k });
    }
  }
  members.sort((a, b) => b.score - a.score || a.ticker.localeCompare(b.ticker));

  const ranking = members.map((m, i) => ({
    order: i + 1,
    ticker: m.ticker,
    cohort: m.cohort || m._cohortKey || null,
    score: m.score,
    membershipClass: m.membershipClass || null,
    absKaliber: m.absKaliber != null ? m.absKaliber : null,
    belowAbsoluteFloor: !!m.belowAbsoluteFloor,
  }));
  const evaluatedTickers = members.map(m => m.ticker);

  const benchmarks = ['SPY', 'QQQ', 'IWM', spec.etf];
  const priceAnchors = {};
  for (const t of [...evaluatedTickers, ...benchmarks]) priceAnchors[t] = anchorClose(t);
  const missing = evaluatedTickers.filter(t => !priceAnchors[t]);

  const totalClassified = cohortsPresent.reduce((s, k) => s + (cohortMeta[k].classifiedCount || 0), 0);
  const totalScored = cohortsPresent.reduce((s, k) => s + (cohortMeta[k].scoredCount || 0), 0);

  const baseline = {
    baselineId: spec.file.replace(/\.json$/, ''),
    bucket: bucketId,
    frozenAt: FROZEN_AT,
    formula: `${bucketId} CORE — absolute-anchor (per-cohort frozen NORMS, see cohorts.*.normTableId) × per-cohort REL `
      + `z/MAD (n>=15 else THIN_REL ABS-only beta=1), blendScore beta=0.6, linear weighted-q with sum-preserving `
      + `coverage-renorm (missing axis DROPPED+renormed, never 0-imputed). SI-4 out-of-class → score=null+excluded[]; `
      + `SI-5 fail-loud (classifiedCount===scoredCount+excludedCount); marquee + generative anti-leak asserts; `
      + `PRE-REVENUE/SHELL SI-4 gate. Shipped CORE + independent Re-Court PASS on loop/formel-haertung. Konstanten [TODO-CAL].`,
    source: `outputs/court-results.json :: ${cohortsPresent.join(' + ')}`,
    cohortsFrozen: cohortsPresent,
    cohorts: cohortMeta,
    classifiedCount: totalClassified,
    scoredCount: totalScored,
    headlineShortlistSize: members.length,
    scoreScope: 'intra-bucket',
    crossBucketComparableField: 'absKaliber',
    forwardFitness: {
      calendarGated: true,
      metric: ['rank_ic_spearman', 'top_n_minus_universe_median_fwd_return'],
      horizonsDays: [28, 84],
      windowEnds: WINDOW_ENDS,
      survivorshipKey: 'evaluatedTickers',
      antiGaming: 'gateOpen-Ranking am Ship-Tag (vor jeder weiteren Bucket-Änderung) eingefroren. Forward-Fenster = '
        + 'intrinsischer Holdout; Eval erst NACH Kalender-Gate. Erzeugende Agenten dürfen NIE auf dem Eval-Slice tunen. '
        + 'Eine neue Bucket-Version gilt nur als „besser", wenn sie diese Forward-Metrik STRIKT schlägt.',
      honestLimitation: 'N=' + members.length + ' gateOpen-Namen (cohort-split macht n pro Kohorte noch dünner) — '
        + 'Rank-IC/Kohorten-Spread haben Richtungs-, nicht starke statistische Aussagekraft. Primärer Wert: '
        + 'Pre-Registration-Disziplin + Beitrag zur gepoolten Cross-Formel-Fitness.',
    },
    priceAnchorStatus: missing.length
      ? `PARTIAL — fehlende t0-Preise (Einzelnamen): ${missing.join(',')}`
      : `CAPTURED — t0-Close je Ticker eingefroren. Forward-Return = close[t0+h]/close[t0]-1.`,
    benchmarkAnchorNote: 'Broad-market SPY/QQQ/IWM in prices/history.json; Sektor-ETF (' + spec.etf + ') i.d.R. NICHT '
      + 'im Screener-Universe-History → null bis ein künftiger Pull ihn aufnimmt (kein Holdout-Defekt).',
    ranking,
    evaluatedTickers,
    priceAnchors,
  };

  const out = path.join(__dirname, 'baselines', spec.file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(baseline, null, 2));
  const top = ranking.slice(0, 8).map(r => r.order + '.' + r.ticker + '(' + r.cohort + ',' + r.score + ')').join(' ');
  console.log(`Wrote ${spec.file} | cohorts=${cohortsPresent.join('+')} | classified/scored=${totalClassified}/${totalScored} | headlineShortlist=${members.length}`);
  console.log(`  top: ${top}${ranking.length > 8 ? ' …' : ''}`);
  console.log(`  priceAnchorStatus: ${baseline.priceAnchorStatus.split('—')[0].trim()}${missing.length ? ' (missing ' + missing.length + ')' : ''}`);
  return baseline;
}

const filter = process.argv[2];
let n = 0;
for (const [bucketId, spec] of Object.entries(BUCKETS)) {
  if (filter && !bucketId.includes(filter)) continue;
  if (freezeBucket(bucketId, spec)) n++;
}
console.log(`\n✓ froze ${n} sector baseline(s) at ${FROZEN_AT}`);
