'use strict';
/**
 * Tag 134 — Phase 2: Explicit Methods Registry
 * =============================================
 * Replaces the prior `fs.readdirSync(__dirname)` scan in runner.js with an
 * explicit allow-list. Benefits:
 *   - Adding a method requires a deliberate registry edit (no silent registration).
 *   - A typo'd `module.exports.id` fails LOUDLY (not silently de-registers).
 *   - Module load failures (circular require, syntax error) surface in CI.
 *   - The single file is the audit trail for "what methods are live right now".
 *
 * Each entry is `{ file, optional }`. `optional: true` means the registry tolerates
 * a missing or unparseable module (logs WARN), useful during in-progress refactors.
 * Default is `optional: false`: any load failure aborts the whole runner.
 */

// Order does not affect scoring, but a stable order helps reading the report.
// Grouped by purpose:
//   1. Core scoring methods (consumed by score-aggregator weights)
//   2. Data guards / dataguards
//   3. Profitability state machine
//   4. Aux / context methods
module.exports = [
  // Core scoring (HYPERGROWTH / QC / TURNAROUND aggregator inputs)
  { file: './rule-of-40.js' },
  { file: './rule-of-x.js' },
  { file: './revenue-growth-3y.js' },
  { file: './gross-margin-stability.js' },
  { file: './profitability-state.js' },
  { file: './profitability-trend.js' },
  { file: './hypergrowth-quality-class.js' },
  { file: './quality-compounder-roic.js' },
  { file: './earnings-stability.js' },
  { file: './margin-quality.js' },
  { file: './reinvestment-rate.js' },
  { file: './net-debt-ebitda.js' },
  { file: './premium-compounder-proof.js' },
  { file: './fcf-yield.js' },
  { file: './above-200d-ma.js' },

  // Data guards (hard-fail hygiene)
  { file: './asset-growth-divergence.js' },
  { file: './q-spike-dataguard.js' },
  { file: './revenue-shock-guard.js' },
  { file: './revenue-volatility-guard.js' },
  { file: './deceleration-guard.js' },
  { file: './forecast-contamination-guard.js' },
  { file: './quarter-concentration-guard.js' },
  { file: './working-capital-anomaly.js' },

  // Tag 140: Turnaround analysis
  { file: './piotroski-f-score.js' },
  { file: './altman-z-score.js' },

  // Tag 141: Estimate revision proxy
  { file: './estimate-revision-proxy.js' },

  // Aux / context (red-flag rules, sub-scores)
  { file: './roic.js' },
  { file: './sloan-ratio.js' },
  { file: './capex-trend.js' },
  { file: './sbc-revenue.js' },
  { file: './margin-decay.js' },
  { file: './opinc-margin-spike.js' },
  { file: './stable-quarterly-growth.js' },
  { file: './quarterly-earnings-stability.js' },
  { file: './quarterly-revenue-acceleration.js' },
  { file: './gross-margin-acceleration.js' },
  { file: './operating-leverage.js' },
  { file: './revenue-quality.js' },
  { file: './loss-magnitude-guard.js' },
  { file: './single-quarter-dependency.js' },
  { file: './listing-age.js' },
  { file: './metric-divergence-guard.js' },
  { file: './operating-margin-acceleration.js' },
  { file: './revenue-acceleration-yoy.js' },
  { file: './sbc-growth-ratio.js' },
  { file: './roic-trend.js' },
  { file: './buyback-yield.js' },
  { file: './sbc-trend.js' },
  { file: './insider-net-buying.js' },
  { file: './net-income-volatility-guard.js' },
  { file: './pre-commerciality-megacap-guard.js' },
  { file: './volatility-annualized.js' },
  { file: './drawdown-52w.js' },
  { file: './high-proximity-52w.js' },
  { file: './insider-ownership.js' },
  { file: './forward-pe.js' },
  { file: './peg.js' },
  { file: './ev-ebitda.js' },

  // Tag 137: Insider-buy-cluster signal
  { file: './insider-buy-cluster.js' }
];
