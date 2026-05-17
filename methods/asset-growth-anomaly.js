'use strict';
/**
 * Tag 226c-5: Asset-Growth Anomaly (Cooper, Gulen & Schill 2008)
 * ===============================================================
 * One-year total-asset growth rate as a return predictor — the strongest
 * single-variable cross-sectional anomaly identified in the post-1968 US
 * sample (annualised return spread ≈ 20%/yr between low- and high-growth
 * quintiles per the original paper).
 *
 *   value = annualBalance[0].totalAssets / annualBalance[1].totalAssets - 1
 *   pass  = value <= 0.20         (low-growth tilt; below the 4th-quintile cut)
 *
 * Why this method exists (failure mode it catches):
 *   Firms that aggressively grow their asset base — via capex, acquisitions,
 *   working-capital build-up, or share-issuance-funded balance-sheet expansion
 *   — systematically under-perform low-growth peers over the subsequent
 *   12 months. The pattern survives controls for size, B/M, momentum, ROA,
 *   accruals, and net-share-issuance. It is conceptually distinct from
 *   accruals (which captures working-capital growth specifically) and from
 *   net-share-issuance (which captures the financing leg). Asset growth
 *   integrates BOTH the investing leg (capex/M&A) and the working-capital
 *   leg, and is the broadest "is management over-extending the balance sheet"
 *   signal in the literature.
 *
 *   Existing sibling — `asset-growth-divergence.js` — tests assetCAGR vs
 *   revenueCAGR (catches M&A-rolled-up rev). That is a quality/breakdown
 *   diagnostic. THIS method tests raw 1Y asset growth as a return
 *   predictor in its own right (independent of revenue context).
 *
 * DIAGNOSTIC type — NOT listed in SCORE_WEIGHTS → fixture-hash invariant
 * preserved (per fixture_hash_invariant.md). Surfaces in detail-modal /
 * percentile views; future tag can promote into composite if desired.
 *
 * Threshold rationale:
 *   - Cooper, Gulen & Schill 2008 ("Asset Growth and the Cross-Section of
 *     Stock Returns", Journal of Finance 63:1609-1651). Sort firms into
 *     deciles by 1y total-asset growth; top decile (>40-50% growth depending
 *     on year) under-performs bottom decile (<-5%) by ~20% annualised. The
 *     spread is monotonic across deciles.
 *   - Lipson, Mortal & Schill 2011 ("On the Scope and Drivers of the Asset
 *     Growth Effect", JFQA 46:1651-1682) confirmed the effect survives
 *     post-publication and is not concentrated in any one source of growth.
 *   - Watanabe, Xu, Yao & Yu 2013 ("The Asset Growth Effect: Insights from
 *     International Equity Markets", JFE 108:529-563) replicated across 43
 *     markets — anomaly is global, strongest in developed markets.
 *   - 20% is the conservative pass cut. CGS's 4th-quintile breakpoint on
 *     CRSP-Compustat 1968-2003 averages around the high-teens; we use 20%
 *     as a round-number, slightly-permissive floor so durable compounders
 *     with secular tailwinds (NVDA's 85% data-center build, COST's 10%
 *     steady inventory growth) are correctly classified: NVDA fails (heavy
 *     growth, watch for digestion), COST passes (well below cap), MSFT
 *     borderline at 20.9% (just-failing — flagged for attention).
 *
 * Edge cases / why it might be incomputable:
 *   - <2 annualBalance entries (newly-listed firm or balance-sheet gap).
 *   - Either totalAssets is null / non-finite / <= 0 (data error — bank/REIT
 *     can produce odd shapes; closed-end-trust-guard handles those).
 *   - prior-year totalAssets == 0 (division-by-zero protection).
 *
 * Anchor check (snapshot data, 2026-05-17):
 *   - NVDA: TA 207B / 112B → +85% → FAIL (cap-cycle build, expected)
 *   - MSFT: TA 619B / 512B → +21% → FAIL (just-over, attention flag)
 *   - GOOG: TA 595B / 450B → +32% → FAIL (AI capex cycle)
 *   - META: TA 366B / 276B → +33% → FAIL (AI infra cycle)
 *   - COST: TA  77B /  70B → +10% → PASS (steady-state operator)
 *   - AAPL: TA 359B / 365B →  -2% → PASS (balance-sheet contraction)
 *
 * Pattern-based, no hardcoded tickers. Capital-intensive industries (utility,
 * telco, REIT) will routinely fail by construction — interpret via sector
 * context per the broader sector-guard ecosystem.
 */
const H = require('./_helpers.js');

const ID = 'asset-growth-anomaly';
const LABEL = 'Asset-Growth Anomaly (CGS 2008)';
const THRESHOLD = 0.20;       // 20% YoY total-asset growth ceiling
const THRESHOLD_OP = 'lte';

function evaluate(stock) {
  if (!stock) {
    return H.buildResult({
      computable: false, pass: false, reason: 'no stock data',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const balArr = (stock.annual && stock.annual.annualBalance) || [];
  if (balArr.length < 2) {
    return H.buildResult({
      computable: false,
      reason: 'need >= 2 annualBalance entries (have ' + balArr.length + ')',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const ta0 = (balArr[0] && Number.isFinite(balArr[0].totalAssets)) ? balArr[0].totalAssets : null;
  const ta1 = (balArr[1] && Number.isFinite(balArr[1].totalAssets)) ? balArr[1].totalAssets : null;
  if (ta0 == null || ta1 == null) {
    return H.buildResult({
      computable: false,
      reason: 'totalAssets missing — ta[0]=' + ta0 + ' ta[1]=' + ta1,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  if (ta1 <= 0) {
    // prior-year totalAssets is zero or negative — bank/REIT/special-purpose
    // entity shape. Cannot compute a meaningful growth rate.
    return H.buildResult({
      computable: false,
      reason: 'prior totalAssets <= 0 (' + ta1 + ')',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const growth = (ta0 / ta1) - 1;     // 1y total-asset growth as decimal
  return H.buildResult({
    value: growth,
    pass: growth <= THRESHOLD,
    computable: true,
    components: {
      totalAssetsLatest: ta0,
      totalAssetsPrior: ta1,
      assetGrowth1y: Math.round(growth * 10000) / 10000
    },
    reason: 'TA YoY = ' + (growth * 100).toFixed(1) + '% (ceiling ' + (THRESHOLD * 100).toFixed(0) + '%)',
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'One-year total-asset growth ceiling — Cooper, Gulen & Schill 2008 cross-section anomaly (TA-YoY <= 20%)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
