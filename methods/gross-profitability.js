'use strict';
/**
 * Tag 209a: Gross-Profitability (Novy-Marx GP / Total Assets)
 * ===========================================================
 * The most parsimonious quality signal in the post-2024 factor literature.
 *
 *   value = annual.annualGP[0] / annual.annualBalance[0].totalAssets
 *   pass  = value >= 0.20         (Novy-Marx durable-quality floor)
 *
 * Why this method exists (failure mode it catches):
 *   Traditional "quality" composites (ROE, ROIC, margin stacks) can be
 *   inflated by leverage and accounting flexibility. A firm with high ROE
 *   driven by aggressive buybacks and thin equity may carry low underlying
 *   gross profitability — the "fake quality" Novy-Marx critiqued. GP/TA is
 *   measured at the top of the income statement and against the broadest
 *   capital base, so it is robust to capital-structure manipulation and
 *   accrual choices below the gross line. Pairs with ROIC: ROIC asks "is
 *   capital being deployed productively?", GP/TA asks "is the underlying
 *   business actually profitable before the games begin?".
 *
 * DIAGNOSTIC type — NOT listed in SCORE_WEIGHTS → fixture-hash invariant
 * preserved (per fixture_hash_invariant.md). Surfaces in detail-modal /
 * percentile views; future tag can promote into composite if desired.
 *
 * Threshold rationale:
 *   - Novy-Marx 2013 ("The Other Side of Value") established that top-decile
 *     GP/TA names earn material premia.
 *   - Novy-Marx & Medhat 2025 ("Profitability Retrospective: What Have We
 *     Learned?", NBER w33601 / SSRN 5190788) reaffirms GP/TA subsumes most
 *     quality composites and discusses the durable-quality floor of ~0.20
 *     as the cross-sector cut that survives sector mix shifts.
 *   - Lepetit, Cherief, Ly & Sekine 2024 ("Revisiting Quality Investing",
 *     SSRN 3877161) lists profitability as the first of four quality pillars;
 *     GP/TA is the canonical implementation of that pillar.
 *
 * Edge cases / why it might be incomputable:
 *   - Missing annualGP[0] (Yahoo did not return gross-profit field).
 *   - Missing annualBalance[0] or totalAssets (balance sheet absent).
 *   - totalAssets <= 0 (data error — bank/REIT can produce odd shapes).
 *
 * Anchor check (snapshot data, 2026-05-16):
 *   - NVDA: GP=153.5B / TA=206.8B = 0.742 → PASS
 *   - MSFT: GP=193.9B / TA=619.0B = 0.313 → PASS
 *   - COST: GP= 35.3B / TA= 77.1B = 0.458 → PASS
 *   Three anchors cleanly above the 0.20 floor.
 *
 * Pattern-based, no hardcoded tickers. For banks/REIT/insurance where
 * gross-margin is not meaningful, callers should rely on the broader
 * sector-guard ecosystem (closed-end-trust-guard etc.) — this method will
 * still compute a value but should be interpreted via sector context.
 */
const H = require('./_helpers.js');

const ID = 'gross-profitability';
const LABEL = 'Gross-Profitability (GP/TA, Novy-Marx)';
const THRESHOLD = 0.20;
const THRESHOLD_OP = 'gte';

function _unwrap(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && Number.isFinite(v.value)) return v.value;
  return null;
}

function evaluate(stock) {
  if (!stock) {
    return H.buildResult({
      computable: false, pass: false, reason: 'no stock data',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const gpArr  = (stock.annual && stock.annual.annualGP) || [];
  const balArr = (stock.annual && stock.annual.annualBalance) || [];
  if (gpArr.length === 0 || balArr.length === 0) {
    return H.buildResult({
      computable: false,
      reason: 'missing annualGP[0] or annualBalance[0]',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const gp = _unwrap(gpArr[0]);
  const bal = balArr[0];
  // annualBalance entries are plain objects {totalCash, totalDebt, totalAssets}.
  const ta = (bal && Number.isFinite(bal.totalAssets)) ? bal.totalAssets : null;
  if (gp == null || ta == null) {
    return H.buildResult({
      computable: false,
      reason: 'gp=' + gp + ' totalAssets=' + ta,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  if (ta <= 0) {
    return H.buildResult({
      computable: false,
      reason: 'totalAssets <= 0 (' + ta + ')',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const ratio = gp / ta;
  return H.buildResult({
    value: ratio,
    pass: ratio >= THRESHOLD,
    computable: true,
    components: {
      gp,
      totalAssets: ta,
      gpAssetRatio: Math.round(ratio * 10000) / 10000
    },
    reason: 'GP/TA = ' + (ratio * 100).toFixed(1) + '% (floor ' + (THRESHOLD * 100).toFixed(0) + '%)',
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Gross-Profit / Total Assets — Novy-Marx Quality-Pillar (GP/TA >= 20%)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
