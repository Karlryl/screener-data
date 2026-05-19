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
  // Tag 209a: Novy-Marx gross-profitability (DIAGNOSTIC, fixture-hash safe)
  { file: './gross-profitability.js' },
  // Tag 204: earnings/cash quality diagnostics (DIAGNOSTIC, fixture-hash safe)
  { file: './fcf-stability.js' },
  { file: './operating-cashflow-coverage.js' },
  { file: './net-income-volatility-guard.js' },
  { file: './pre-commerciality-megacap-guard.js' },
  { file: './closed-end-trust-guard.js' },
  { file: './r40-sanity-cap.js' },
  { file: './volatility-annualized.js' },
  { file: './drawdown-52w.js' },
  { file: './high-proximity-52w.js' },
  { file: './insider-ownership.js' },
  { file: './forward-pe.js' },
  { file: './peg.js' },
  { file: './ev-ebitda.js' },

  // Tag 137: Insider-buy-cluster signal
  { file: './insider-buy-cluster.js' },

  // Tag 209c: Mauboussin capital-allocation composite — depends on
  // buyback-yield + net-debt-ebitda + capex-trend + sbc-revenue.
  // DIAGNOSTIC, not in SCORE_WEIGHTS, fixture-hash safe by construction.
  { file: './capital-allocation-quality.js' },

  // Tag 209b: sector-relative ROIC percentile (DIAGNOSTIC, fixture-hash safe).
  // Owned canonically by the Tag 209b commit; left optional here in case load
  // fails — runner enforces presence on its own.
  { file: './sector-relative-roic.js', optional: true },

  // Tag 209d: Beneish M-Score earnings-manipulation detector. DIAGNOSTIC until
  // pull-yahoo extends balance-sheet/IS coverage (AR/PPE/CL/LTD/SGA/Dep/OCF);
  // fixture-hash safe by construction (not in SCORE_WEIGHTS).
  { file: './beneish-m-score.js' },

  // Tag 210a: Ohlson O-Score logit bankruptcy probability. Sibling to Altman-Z
  // (discriminant) — catches a different failure profile (services, low-leverage).
  // DIAGNOSTIC until pull-yahoo extends CA/CL/totalLiab/OCF coverage; fixture-hash
  // safe by construction (not in SCORE_WEIGHTS).
  { file: './ohlson-o-score.js' },

  // Tag 210b: Mauboussin intangible-adjusted ROIC. Capitalizes R&D (5y) +
  // SG&A (3y) into invested capital; narrows software-vs-industrial gap.
  // DIAGNOSTIC, fixture-hash safe (not in SCORE_WEIGHTS).
  { file: './intangible-adjusted-roic.js' },

  // Tag 210c: R&D-cut guard — real-earnings-management red flag (R&D drop
  // >20% YoY AND op-margin expand >2pp YoY). DIAGNOSTIC, fixture-hash safe.
  { file: './rd-cut-guard.js' },

  // Tag 210d: Analyst-revision breadth (net 4w up-minus-down). Returns
  // computable=false until pull-yahoo persists estimateRevisions; promotion
  // path documented in method header. DIAGNOSTIC, fixture-hash safe.
  { file: './analyst-revision-breadth.js' },

  // Tag 211d: Earnings-power stability — operating-margin CoV over 5y, with
  // mean-margin floor to avoid passing "stably bad" firms. Lepetit et al.
  // 2024 Safety pillar (SSRN 3877161). DIAGNOSTIC, fixture-hash safe.
  { file: './earnings-power-stability.js' },

  // Tag 211e: FCF-conversion stability — 5y geometric mean of FCF/NetIncome.
  // Multi-year persistence view of cash conversion (Damodaran / Mauboussin);
  // complements single-year sloan-ratio. DIAGNOSTIC, fixture-hash safe.
  { file: './fcf-conversion-stability.js' },

  // Tag 212a: Operating-Leverage (Margin-Acceleration variant) — averaged
  // pp margin / unit revenue growth across positive-growth pairs (Mauboussin
  // 2014, Damodaran). Distinct from Tag 196 operating-leverage (single
  // 3y incremental margin). DIAGNOSTIC, fixture-hash safe.
  { file: './operating-leverage-margin-accel.js' },

  // Tag 212b: Revenue-Quality (Quarterly QoQ CoV, 8Q) — recurring-revenue
  // smoothness signal (Asness/Frazzini/Pedersen 2019 QMJ Revenue Quality).
  // Sibling of Tag 113 q-spike-dataguard with statistical CoV over the whole
  // 8Q window vs. single-Q concentration check. DIAGNOSTIC, fixture-hash safe.
  { file: './revenue-quality-cov.js' },

  // Tag 213a: Institutional Ownership (SEC 13F) — count of distinct tracked
  // smart-money institutions holding the name per Tag 212e's quarterly 13F-HR
  // cache (external-data/sec-13f-by-ticker.json). DIAGNOSTIC, fixture-hash safe.
  // Cache is optional at load time — method returns clean computable=false when
  // the cache file is missing, so it is safe to register unconditionally.
  { file: './institutional-ownership-13f.js' },

  // Tag 213b: Price Momentum (12-1) — Jegadeesh-Titman 1993 / Asness-Moskowitz-
  // Pedersen 2013 academic 12-month return skipping the most recent month
  // (avoids 1-month reversal). Degrades to within-window position when fewer
  // than 252 trading days are available. DIAGNOSTIC, fixture-hash safe.
  { file: './price-momentum-12-1.js' },

  // Tag 214a: SG&A/Revenue Trend (3y slope) — cost-discipline detector.
  // Activated by Tag 211l surfacing annualSGA. Lev & Thiagarajan (1993, JAR)
  // fundamental signal. DIAGNOSTIC, fixture-hash safe.
  { file: './sga-revenue-trend.js' },

  // Tag 214b: Capex / SBC (3y avg) — real reinvestment-to-dilution ratio.
  // Mauboussin (Counterpoint 2024) flags SBC > Capex as the optical-FCF
  // pattern (true FCF systematically overstated). DIAGNOSTIC, fixture-hash safe.
  { file: './capex-vs-sbc-quality.js' },

  // Tag 215d: Working-Capital / Revenue trend (3y slope) — cash-cycle
  // efficiency. Activated by Tag 211l currentAssets/currentLiabilities.
  // Lev & Thiagarajan (1993, JAR) fundamental signal #4 (Receivables vs Sales).
  // DIAGNOSTIC, fixture-hash safe.
  { file: './working-capital-trend.js' },

  // Tag 223a: Analyst Upside — (targetMedianPrice / currentPrice) - 1 >= 10%,
  // requires >= 3 analysts. Damodaran consensus soft-signal. Activated by
  // Tag 219c targetMedianPrice + numberOfAnalystOpinions persistence.
  // DIAGNOSTIC, fixture-hash safe (not in SCORE_WEIGHTS).
  { file: './analyst-upside.js' },

  // Tag 223a: Earnings Surprise Momentum — >=3 of last 4 quarterly EPS
  // surprises positive AND mean >= 3% (PEAD: Foster 1984, Bernard-Thomas
  // 1989, Liu-Strong 2024). Activated by Tag 220c earningsHistory persistence.
  // DIAGNOSTIC, fixture-hash safe.
  { file: './earnings-surprise-momentum.js' },

  // Tag 223a: Institutional Density — meta.institutionsPercentHeld >= 50%,
  // broad-based ~7k-institution floor. Complements Tag 213a smart-money 13F
  // count signal. Activated by Tag 220c majorHoldersBreakdown persistence.
  // DIAGNOSTIC, fixture-hash safe.
  { file: './institutional-density.js' },

  // Tag 226c-5: Asset-Growth Anomaly — 1y total-asset YoY <= 20% (Cooper,
  // Gulen & Schill 2008 JF 63:1609-1651). Strongest single-variable
  // cross-section anomaly in the post-1968 US sample (~20%/yr spread
  // between low- and high-growth quintiles). DIAGNOSTIC, fixture-hash safe.
  { file: './asset-growth-anomaly.js' },

  // Tag 227b-1: Magic Formula (Greenblatt 2005 / Gray-Carlisle 2012) —
  // composite saturation of EBIT/EV (Earnings Yield) + EBIT/(NWC+NFA)
  // (Return on Capital). Pass at composite >= 0.75 = top-quartile saturated
  // rank. Mega-cap structural fail-rate is expected (1/10 anchors pass);
  // factor targets cheap-with-decent-ROC mid-caps. DIAGNOSTIC, fixture-hash
  // safe (not in SCORE_WEIGHTS).
  { file: './magic-formula.js' },

  // Tag 227b-2: Penman-Nissim PB-ROE Decomposition — RNOA (op income after
  // tax / NOA) >= 12% AND Debt/Equity < 1.5. Penman & Nissim 2003 RAS 8:531
  // ("Financial Statement Analysis of Leverage and How It Informs About
  // Profitability and Price-to-Book Ratios"). Separates durable operating
  // ROE from fragile leverage-driven ROE. 8/9 mega-cap anchors pass; CRDO
  // correctly flagged (operations still scaling). DIAGNOSTIC, fixture-hash
  // safe (not in SCORE_WEIGHTS).
  { file: './penman-nissim-decomposition.js' },

  // Tag 230b: Betting Against Beta — Frazzini & Pedersen 2014 JFE 111(1):1-25.
  // Low-beta cross-section anomaly: beta <= 1.0 PASS (defensive tilt),
  // (1.0, 1.5] BORDERLINE, > 1.5 FAIL (high-beta leverage-aversion penalty).
  // metrics.beta sourced from Yahoo defaultKeyStatistics.beta (Tag 219).
  // DIAGNOSTIC, fixture-hash safe (not in SCORE_WEIGHTS).
  { file: './betting-against-beta.js' },

  // Owner Earnings (Buffett 1986 BRK Annual Letter) — NI + D&A + SBC − MaintCapex − ΔWC.
  // OE/Revenue >= 5%, ≥5y data, positive+growing all years.
  // Maintenance capex proxy configurable via OWNER_EARNINGS_MAINT_CAPEX_METHOD env var
  // (capex-5y-median | dna | capex-min-dna; Damodaran Investment Valuation ch. 11).
  // DIAGNOSTIC: not in SCORE_WEIGHTS; used by buffett-criteria composite. Fixture-hash safe.
  { file: './owner-earnings.js' },

  // DCF Intrinsic Value — 3-stage owner-earnings DCF with Margin-of-Safety and
  // hurdle-rate test per Buffett 1996 Owner's Manual + 1992 Coca-Cola valuation.
  // Depends on owner-earnings.js (registered above). Computable only when
  // owner-earnings is computable and market-cap / price data are available.
  // DIAGNOSTIC: not in SCORE_WEIGHTS; fixture-hash safe by construction.
  { file: './dcf-intrinsic-value.js' },

  // Buffett 14-Punkt Komposit — composite of 10 quantitative + 3 qualitative + 1
  // industry-exclusion test (Berkshire Annual Letters 1977-2024, Hagstrom, Buffettology,
  // Damodaran). Pass requires x1_industryExclusion + DCF Margin-of-Safety (HARD) + ≥85%
  // test pass-rate. DIAGNOSTIC in HG/QC/TURN; MUST in BUFFETT strategy mode.
  // Fixture-hash safe (not in HG/QC/TURN SCORE_WEIGHTS).
  { file: './buffett-criteria.js' }
];
