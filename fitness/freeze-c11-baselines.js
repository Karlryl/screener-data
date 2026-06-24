#!/usr/bin/env node
/**
 * freeze-c11-baselines.js — SI-6 pre-registration of the 3 C11 (Financials/Utilities/REITs gauntlet)
 * CORE buckets for forward-fitness: financials_banks, equity_reits, capmkt_fee_core.
 *
 * Same contract + shape as fitness/freeze-sector-baselines.js (gateOpen = headlineShortlist && score!=null,
 * calendar-gated ~28d/84d forward holdout, t0 price anchors = last close <= FROZEN_AT). These three are
 * SINGLE-cohort buckets (one court-results key each). The other 4 C11 sub-tracks (insurance, credit_finance,
 * real_estate_operating, utilities) are DOCUMENTED EXCLUSIONS (court PASS / data-honest) — not built, so not frozen.
 *
 * Deterministic (FROZEN_AT hardcoded = the C11 ship day; no new Date() in the payload). Source: outputs/court-results.json.
 * Writes only fitness/baselines/*.json (scoring path never imports fitness/).
 *
 * Usage:  node fitness/freeze-c11-baselines.js          # freeze all 3
 *         node fitness/freeze-c11-baselines.js banks     # substring filter on bucket id
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const FROZEN_AT = '2026-06-24';                               // C11 ship day. Deterministic.
const WINDOW_ENDS = { d28: '~2026-07-22', d84: '~2026-09-16' }; // FROZEN_AT + 28d / + 84d (hardcoded).

const BUCKETS = {
  financials_banks: { keys: ['financials_banks'], file: 'financials_banks-v1.0-2026-06-24.json', etf: 'KBE',
    formula: 'financials_banks CORE — through-cycle quality; absKaliberBanks 4 axes roaThruCycle .50 / capitalAdequacy(eq/assets) .25 (DROP+renorm) / assetGrowthDiscipline .18 (q(-assetGrowthYoY) PENALTY) / earningsDurability .07; FCF/OCF hard-excluded; credit-quality/NIM/efficiency/CET1 BLIND walls. de-ADRd US-primary.' },
  equity_reits:     { keys: ['equity_reits'],     file: 'equity_reits-v1.0-2026-06-24.json',     etf: 'VNQ',
    formula: 'equity_reits CORE — FFO/NOI quality; absKaliberReits 4 axes opMargin(NOI) .30 / ffoAssets((NI+Dep)/assets) .30 (DROP+renorm, top-tier no-Dep) / revG3 .25 / ndGA(net-debt/assets INVERTED LEVEL) .15; {value}-unwrap; FFO gains-on-sale guard; mortgage-REITs hard-separated; same-store-NOI/occupancy/NAV BLIND.' },
  capmkt_fee_core:  { keys: ['capmkt_fee_core'],  file: 'capmkt_fee_core-v1.0-2026-06-24.json',  etf: 'IAI',
    formula: 'capmkt_fee_core CORE — asset-light fee quality; absKaliberCapmkt 4 axes opMargin .30 / opMarginStability(1-CV) .30 / fcfMargin .25 / netIssuance .15; 4-arm economic fee-gate (fund-float / RIC / BDC-loan-book / crypto-miner) so genuine fee compounders lead.' },
};

const results = JSON.parse(fs.readFileSync(path.join(ROOT, 'outputs', 'court-results.json'), 'utf8'));
let hist = {};
try { hist = JSON.parse(fs.readFileSync(path.join(ROOT, 'prices', 'history.json'), 'utf8')); } catch { hist = {}; }
const anchorClose = t => {
  const s = hist[t]; if (!Array.isArray(s) || !s.length) return null;
  let best = null;
  for (const p of s) { if (p && p.date && p.date <= FROZEN_AT && p.close != null) { if (!best || p.date > best.date) best = p; } }
  return best ? { date: best.date, close: best.close } : null;
};

function freezeBucket(bucketId, spec) {
  const b = results[spec.keys[0]];
  if (!b || !Array.isArray(b.members)) { console.error(`SKIP ${bucketId}: ${spec.keys[0]} not in court-results.json`); return null; }
  const members = b.members.filter(m => m.headlineShortlist && m.score != null)
    .sort((a, c) => c.score - a.score || a.ticker.localeCompare(c.ticker));
  const ranking = members.map((m, i) => ({
    order: i + 1, ticker: m.ticker, score: m.score,
    membershipClass: m.membershipClass || null,
    absKaliber: m.absKaliber != null ? m.absKaliber : null,
    belowAbsoluteFloor: !!m.belowAbsoluteFloor,
  }));
  const evaluatedTickers = members.map(m => m.ticker);
  const benchmarks = ['SPY', 'QQQ', 'IWM', spec.etf];
  const priceAnchors = {};
  for (const t of [...evaluatedTickers, ...benchmarks]) priceAnchors[t] = anchorClose(t);
  const missing = evaluatedTickers.filter(t => !priceAnchors[t]);

  const baseline = {
    baselineId: spec.file.replace(/\.json$/, ''),
    bucket: bucketId,
    frozenAt: FROZEN_AT,
    formula: spec.formula,
    source: `outputs/court-results.json :: ${spec.keys[0]}`,
    normTableId: b.normTableId || null,
    classifiedCount: b.classifiedCount,
    scoredCount: b.scoredCount,
    excludedCount: b.excludedCount != null ? b.excludedCount : (b.members.length - b.members.filter(m => m.score != null).length),
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
        + 'intrinsischer Holdout; Eval erst NACH Kalender-Gate. Erzeugende Agenten dürfen NIE auf dem Eval-Slice tunen.',
      honestLimitation: 'N=' + members.length + ' — Rank-IC/Spread haben Richtungs-, nicht starke statistische '
        + 'Aussagekraft. Primärer Wert: Pre-Registration-Disziplin + Beitrag zur gepoolten Cross-Formel-Fitness.',
    },
    anchors: b.anchors || null,
    comparabilityNote: b.comparabilityNote || null,
    priceAnchorStatus: missing.length
      ? `PARTIAL — fehlende t0-Preise: ${missing.join(',')}`
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
  console.log(`Wrote ${spec.file} | classified/scored=${b.classifiedCount}/${b.scoredCount} | headlineShortlist=${members.length}`);
  console.log(`  top: ${ranking.slice(0, 8).map(r => r.order + '.' + r.ticker + '(' + r.score + ')').join(' ')}${ranking.length > 8 ? ' …' : ''}`);
  console.log(`  priceAnchorStatus: ${baseline.priceAnchorStatus.split('—')[0].trim()}${missing.length ? ' (missing ' + missing.length + ')' : ''}`);
  return baseline;
}

const filter = process.argv[2];
let n = 0;
for (const [bucketId, spec] of Object.entries(BUCKETS)) {
  if (filter && !bucketId.includes(filter)) continue;
  if (freezeBucket(bucketId, spec)) n++;
}
console.log(`\n✓ froze ${n} C11 baseline(s) at ${FROZEN_AT}`);
