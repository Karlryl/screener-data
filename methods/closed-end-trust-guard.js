'use strict';
/**
 * Tag 202: Closed-End-Trust DataGuard
 * =====================================
 * Hard-fails listed entities that are NOT operating businesses but
 * closed-end investment trusts, asset managers reporting gain/loss as
 * "revenue", or pass-through infrastructure/property holding vehicles.
 *
 * Why they slip through the existing gates:
 *   These vehicles report fair-value movements and dividends-received
 *   as "Total Revenue" on Yahoo. In a strong portfolio year that line
 *   explodes (SMT.L FY: +£1.4B "revenue" with portfolio gains; a loss
 *   year: -£2.9B). Rule-of-40 then reads growth = 1000%+ and the trust
 *   lands at the top of the R40 tab — pure noise.
 *
 * Audit-trace (Tag 201, Agent 1):
 *   SMT.L (Scottish Mortgage Trust)   growth=1103.6%  R40=1164
 *   HICL.L (UK infrastructure)        growth=141.4%  R40=141
 *   HGT.L  (UK growth trust)
 *   DLN.L  (UK property)
 *   STJ.L  (UK wealth manager)
 *   600816.SS (Chinese investment co.)
 *
 * PATTERN SIGNALS (pass = fewer than 2 signals fire):
 *
 *   S1. Industry contains one of: "Asset Management", "Investment Trust",
 *       "Closed-End Fund", "Holding Company" (case-insensitive substring).
 *       SAFE: BRK-B is "Insurance - Diversified" → does NOT match.
 *
 *   S2. Sector == "Financial Services" AND Rev/TotalAssets < 10%.
 *       Operating businesses (even capital-heavy insurers/banks) sustain
 *       Rev/Assets ≥ 10% on a TTM basis. Pure trusts run 1-9%.
 *       Anchor: BRK-B Rev/Assets = $371B/$1.22T = 30.4% → passes cleanly.
 *               SMT.L = $1.24B/$13.7B = 9.0% → fires.
 *               HICL.L = $105M/$3.0B = 3.5% → fires.
 *
 *   S3. Revenue history contains a negative year, OR max(|rev|)/min(|rev|)
 *       across 4y > 3x AND any year ≤ 0. Negative revenue is impossible
 *       for an operating business — it is the smoking gun of gain/loss
 *       accounting masquerading as revenue.
 *       Anchor: BRK-B 4y rev [371B, 371B, 364B, 302B] — monotone+positive → no fire.
 *               SMT.L 4y rev [1.24B, 1.38B, -2.91B, -2.54B] → fires.
 *               HICL.L 4y rev [105M, 254M, 372M, 0] — zero+collapsing → fires.
 *
 *   S4. (Anti-leverage check) FCF/TotalAssets < 0.5% AND sector ==
 *       "Financial Services". Distinguishes trust (pass-through to holders,
 *       FCF ≈ 0) from operating insurer (BRK-B FCF/Assets = 2.05%).
 *       Optional — only fires if computable.
 *
 * BRK-B ANCHOR SAFETY (the canonical false-positive risk):
 *   industry = "Insurance - Diversified"   → S1 miss
 *   sector   = "Financial Services"
 *   Rev/Assets = 30.4%                     → S2 miss (≥10%)
 *   Rev 4y = [371B, 371B, 364B, 302B]      → S3 miss (no neg, ratio 1.23)
 *   FCF/Assets = 2.05%                     → S4 miss (>0.5%)
 *   Total signals: 0 → PASS (even though sector matches).
 *
 * The 2-of-N combine rule is what makes the gate safe: any single noisy
 * field never causes a fail. SMT.L fires S1+S2+S3 (and S4). HICL.L fires
 * S1+S2+S3 (and S4). BRK-B fires zero.
 *
 * Pattern-based: no hardcoded tickers, no ISIN lists. All inputs are
 * first-class snapshot fields (meta.industry, meta.sector, annualRev,
 * annualBalance.totalAssets, annualFCF).
 *
 * Schema note: snapshots expose annualFCF (free cash flow), not annualOCF.
 * For trust/non-trust separation FCF works as well as OCF — trusts run
 * near-zero on both, and the BRK-B anchor is far above the floor either way.
 */
const H = require('./_helpers.js');

const ID = 'closed-end-trust-guard';
const LABEL = 'Closed-End-Trust-Guard';
const SIGNAL_FAIL_COUNT = 2; // need 2+ signals to hard-fail

// Industry tokens that, by themselves, are strong evidence (but never sufficient alone).
// Tag 206a (Agent B finding): added REIT/real-estate/property/financial-data tokens.
// GPT.AX (REIT - Diversified, fcfMargin 598%) leaked into R40 with 0 signals because
// the original token list didn't include REIT/Real Estate / Property Trust.
const TRUST_INDUSTRY_TOKENS = [
  'asset management',
  'investment trust',
  'closed-end fund',
  'closed end fund',
  'holding company',
  'capital markets',  // some closed-end vehicles end up here
  // Tag 206a: REIT/real-estate/property-trust extensions
  'reit',
  'real estate',
  'property trust',
  // Tag 206a: financial-data exchanges (ASX.AX-class: market operators with
  // gain/loss components in revenue line)
  'financial data',
  'stock exchange',
  'exchanges'
];

// Tag 206a: extended sector match. 'Real Estate' often reports REITs separately
// from 'Financial Services'. Both sectors get the S2/S4 pattern checks.
const FIN_SECTOR_TOKENS = new Set(['financial services', 'real estate']);
const FIN_SECTOR = 'financial services';  // legacy single-value (kept for backwards compat in components)
const REV_ASSETS_FLOOR  = 0.10;   // 10% — BRK-B at 30.4% safely above
const REV_VOL_RATIO_MAX = 3.0;    // 3x peak/trough only counts with a non-positive year
const FCF_ASSETS_FLOOR  = 0.005;  // 0.5% — BRK-B at 2.05% safely above

function _unwrap(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && Number.isFinite(v.value)) return v.value;
  return null;
}

function _arr(stock, key) {
  const a = (stock.annual && stock.annual[key]) || [];
  return Array.isArray(a) ? a.map(_unwrap).filter(x => x != null) : [];
}

function evaluate(stock) {
  if (!stock) {
    return H.buildResult({
      computable: false, pass: false, reason: 'no stock data',
      threshold: SIGNAL_FAIL_COUNT, thresholdOp: 'lt'
    });
  }
  const industry = (stock.meta && stock.meta.industry || '').toLowerCase();
  const sector   = (stock.meta && stock.meta.sector   || '').toLowerCase();
  const revArr   = _arr(stock, 'annualRev').slice(0, 4);
  const fcfArr   = _arr(stock, 'annualFCF').slice(0, 4);
  const balArr   = (stock.annual && stock.annual.annualBalance) || [];
  const totalAssets = (balArr.length > 0 && balArr[0]) ? balArr[0].totalAssets : null;

  // --- Signal S1: trust-flavoured industry token ---
  const s1 = TRUST_INDUSTRY_TOKENS.some(tok => industry.indexOf(tok) >= 0);

  // --- Signal S2: Financial Services OR Real Estate with low Rev/Assets ---
  // Tag 206a: expanded to FIN_SECTOR_TOKENS so REITs (Real Estate sector) qualify.
  let s2 = false;
  let revAssetsRatio = null;
  if (FIN_SECTOR_TOKENS.has(sector) && Number.isFinite(totalAssets) && totalAssets > 0 && revArr.length > 0) {
    revAssetsRatio = revArr[0] / totalAssets;
    s2 = revAssetsRatio < REV_ASSETS_FLOOR;
  }

  // --- Signal S3: gain/loss-accounting smoking gun (neg or zero rev year) ---
  let s3 = false;
  let revVolRatio = null;
  if (revArr.length >= 2) {
    const hasNonPositive = revArr.some(v => v <= 0);
    const absVals = revArr.map(v => Math.abs(v));
    const minPos = absVals.filter(v => v > 0).reduce((a, b) => Math.min(a, b), Infinity);
    const maxAbs = absVals.reduce((a, b) => Math.max(a, b), 0);
    revVolRatio = (minPos > 0 && Number.isFinite(minPos)) ? maxAbs / minPos : null;
    // Fire if any rev year ≤ 0 (impossible for operating business),
    // OR peak/trough > 3x AND we saw a non-positive year (lumpy + negative).
    s3 = hasNonPositive || (revVolRatio != null && revVolRatio > REV_VOL_RATIO_MAX && hasNonPositive);
  }

  // --- Signal S4: Financial-or-Real-Estate sector FCF pass-through (anti-leverage check) ---
  // Tag 206a: same sector expansion as S2.
  let s4 = false;
  let fcfAssetsRatio = null;
  if (FIN_SECTOR_TOKENS.has(sector) && Number.isFinite(totalAssets) && totalAssets > 0 && fcfArr.length > 0) {
    fcfAssetsRatio = fcfArr[0] / totalAssets;
    s4 = fcfAssetsRatio < FCF_ASSETS_FLOOR;
  }

  const signalCount = (s1 ? 1 : 0) + (s2 ? 1 : 0) + (s3 ? 1 : 0) + (s4 ? 1 : 0);
  const pass = signalCount < SIGNAL_FAIL_COUNT;

  // If we have no usable inputs at all, mark non-computable (don't fail).
  const noInputs = !industry && !sector && revArr.length === 0;
  if (noInputs) {
    return H.buildResult({
      computable: false,
      reason: 'no industry/sector/revenue data',
      threshold: SIGNAL_FAIL_COUNT, thresholdOp: 'lt'
    });
  }

  const firedNames = [];
  if (s1) firedNames.push('S1:industry');
  if (s2) firedNames.push('S2:rev/assets=' + (revAssetsRatio != null ? (revAssetsRatio*100).toFixed(1) + '%' : 'n/a'));
  if (s3) firedNames.push('S3:rev-volatility');
  if (s4) firedNames.push('S4:fcf/assets=' + (fcfAssetsRatio != null ? (fcfAssetsRatio*100).toFixed(2) + '%' : 'n/a'));

  return H.buildResult({
    value: signalCount,
    pass,
    computable: true,
    components: {
      industry: stock.meta && stock.meta.industry || null,
      sector:   stock.meta && stock.meta.sector   || null,
      rev0: revArr[0] != null ? revArr[0] : null,
      totalAssets: Number.isFinite(totalAssets) ? totalAssets : null,
      revAssetsRatio,
      revVolRatio,
      fcfAssetsRatio,
      s1, s2, s3, s4,
      signalCount,
      threshold: SIGNAL_FAIL_COUNT
    },
    reason: pass
      ? 'signals=' + signalCount + ' (' + (firedNames.length ? firedNames.join(', ') : 'none') +
        ') < ' + SIGNAL_FAIL_COUNT + ' — operating business'
      : 'signals=' + signalCount + ' [' + firedNames.join(', ') + '] ≥ ' + SIGNAL_FAIL_COUNT +
        ' — closed-end-trust pattern (revenue is gain/loss, not commerce)',
    threshold: SIGNAL_FAIL_COUNT, thresholdOp: 'lt'
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Hard-DataGuard: Closed-end-trust / Asset-Manager Pattern (Industry + Rev/Assets + Rev-Vol + FCF/Assets)',
  threshold: SIGNAL_FAIL_COUNT, thresholdOp: 'lt', unit: 'signals',
  evaluate
};
