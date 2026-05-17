'use strict';
/**
 * Tag 224c: Integration Anchor Test
 * ==================================
 * Catches regressions on the 10 canonical anchor tickers that MUST keep
 * qualifying in their expected modes at >= the expected tier floor.
 *
 * The screener is a multi-factor scoring system; small changes in scoring,
 * thresholds, weights or guards can silently drop an anchor below its tier
 * floor. This test loads each anchor's snapshot, runs the full Runner +
 * strategy-modes pipeline, and asserts that AT LEAST ONE expected mode
 * passes at AT LEAST the expected tier.
 *
 * Tier ordering: REJECT < NEAR_MISS < INFLECTION < B < A
 *
 * NOTE: INFLECTION is a CRDO-specific tier used when listing-age is sub-3y
 * but other signals are very strong. The tier-rank table includes it.
 *
 * Usage:
 *   node tests/integration-anchor-test.js
 *
 * Exit code:
 *   0 — all anchors qualified
 *   1 — one or more anchors regressed
 */

const fs = require('fs');
const path = require('path');
const Runner = require('../methods/runner.js');
const SM = require('../methods/strategy-modes.js');

const SNAP_DIR = path.join(__dirname, '..', 'snapshots');

// Each anchor must qualify in AT LEAST ONE of the listed modes at AT LEAST
// the listed tier. Tier-min uses the same ordering as TIER_THRESHOLDS plus
// INFLECTION which lives between NEAR_MISS and B.
const ANCHORS = {
  NVDA: { modes: ['HYPERGROWTH'],                          tierMin: 'B' },
  MSFT: { modes: ['QUALITY_COMPOUNDER'],                   tierMin: 'B' },
  PLTR: { modes: ['HYPERGROWTH', 'TURNAROUND'],            tierMin: 'B' },
  META: { modes: ['HYPERGROWTH', 'QUALITY_COMPOUNDER'],    tierMin: 'B' },
  COST: { modes: ['QUALITY_COMPOUNDER'],                   tierMin: 'B' },
  GOOG: { modes: ['HYPERGROWTH', 'QUALITY_COMPOUNDER'],    tierMin: 'B' },
  AVGO: { modes: ['HYPERGROWTH', 'QUALITY_COMPOUNDER'],    tierMin: 'B' },
  V:    { modes: ['QUALITY_COMPOUNDER'],                   tierMin: 'B' },
  CRDO: { modes: ['HYPERGROWTH'],                          tierMin: 'INFLECTION' },
  MELI: { modes: ['HYPERGROWTH'],                          tierMin: 'B' }
};

const TIER_RANK = {
  'A':          4,
  'B':          3,
  'INFLECTION': 2,
  'NEAR_MISS':  1,
  'REJECT':     0
};

function tierAtLeast(actual, min) {
  const a = (TIER_RANK[actual] != null) ? TIER_RANK[actual] : -1;
  const b = TIER_RANK[min];
  if (b == null) throw new Error('Unknown tierMin: ' + min);
  return a >= b;
}

function evaluateAnchor(ticker, exp) {
  const fp = path.join(SNAP_DIR, ticker + '.json');
  if (!fs.existsSync(fp)) {
    return { ticker, status: 'SKIP', reason: 'snapshot-missing', modes: [] };
  }
  const stock = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const allResults = Runner.evaluateStock(stock);
  const ext = Runner.evaluateStockExtended(stock);

  const modeReports = [];
  let qualified = false;
  for (const modeId of exp.modes) {
    let me;
    try { me = SM.evaluateMode(stock, modeId, allResults); }
    catch (e) { me = { error: e.message }; }
    const passed = !!(me && me.passed === true);
    const tier   = me ? me.tier : null;
    const score  = (me && me.score != null) ? me.score : null;
    const tierOk = tierAtLeast(tier, exp.tierMin);
    const ok = passed && tierOk;
    if (ok) qualified = true;
    modeReports.push({ modeId, passed, tier, score, tierOk, ok, err: me && me.error });
  }
  return {
    ticker,
    status: qualified ? 'PASS' : 'FAIL',
    expectedMinTier: exp.tierMin,
    disqualified: ext.disqualified ? ext.disqualifiedBy : null,
    modes: modeReports
  };
}

function main() {
  const reports = [];
  let pass = 0, fail = 0, skip = 0;
  for (const ticker of Object.keys(ANCHORS)) {
    const r = evaluateAnchor(ticker, ANCHORS[ticker]);
    reports.push(r);
    if (r.status === 'PASS') pass++;
    else if (r.status === 'FAIL') fail++;
    else skip++;
  }

  console.log('Integration Anchor Test (Tag 224c)');
  console.log('===================================');
  for (const r of reports) {
    const fmt = r.modes.map(m =>
      `${m.modeId}=pass:${m.passed}/tier:${m.tier}/score:${m.score != null ? m.score.toFixed(1) : 'n/a'}${m.ok ? ' OK' : ''}`
    ).join(' | ');
    const dq = r.disqualified ? ` [dq=${r.disqualified}]` : '';
    console.log(`${r.status}  ${r.ticker.padEnd(5)} min=${r.expectedMinTier.padEnd(10)} ${fmt}${dq}`);
  }
  console.log('-----------------------------------');
  console.log(`pass=${pass}  fail=${fail}  skip=${skip}  total=${reports.length}`);
  if (fail > 0) {
    console.error('\nRegression: ' + fail + ' anchor(s) failed to qualify.');
    process.exit(1);
  }
  console.log('All anchors qualified.');
}

if (require.main === module) main();

module.exports = { ANCHORS, TIER_RANK, tierAtLeast, evaluateAnchor };
