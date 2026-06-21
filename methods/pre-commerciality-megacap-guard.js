'use strict';
/**
 * Tag 201b: Pre-Commerciality MegaCap DataGuard
 * ==============================================
 * Hard-fails companies whose market cap is detached from any meaningful
 * commercial reality.
 *
 *   pass = NOT (mcap > 1e9 USD AND annualRev[0] < 1e8 USD or null)
 *
 * Tag 201 audit (Agent 5) discovered that loss-magnitude-guard,
 * metric-divergence-guard, and ni-volatility-guard ALL exit
 * `computable:false` (and therefore do NOT fail) when annualRev[0] is 0
 * or null. QS — pre-revenue battery startup — slips every existing gate
 * with mcap=$5.18B and annualRev=[0,0,0,0]. JOBY/ACHR (eVTOL pre-revenue)
 * and similar narrative-only mega-caps follow the same pattern.
 *
 * This guard adds the missing floor: a $1B+ valuation requires SOME
 * commercial traction. $100M annual revenue is generous — even seed-stage
 * scale-ups have crossed it before reaching $1B mcap in any non-bubble
 * regime.
 *
 * FAILURE MODE THIS DETECTS:
 *   "Narrative > fundamentals" mega-cap quarantine candidates that
 *   pre-existing DATAGUARDs miss because their core inputs (annualOpInc,
 *   annualRev[0]) are empty/zero — the bypass route Agent 5 named the
 *   "smoking gun".
 *
 * Anchor safety:
 *   - NVDA rev $130B, MSFT $250B, AAPL $400B, GOOG $330B, META $160B
 *     — all 1000× above the $100M floor.
 *   - Smaller anchors: PLTR $2.8B, ALAB $396M, CRDO $430M — all > 3× floor.
 *   - Established compounders (V/MA/COST/ASML) — all > 100× floor.
 *   - Pre-revenue micro-caps with mcap < $1B are PROTECTED by the mcap
 *     precondition; only $1B+ pre-rev names fail.
 *
 * Pattern-based: no hardcoded tickers. Only requires marketCap +
 * annualRev fields, both first-class in the snapshot schema.
 */
const H = require('./_helpers.js');

const ID = 'pre-commerciality-megacap-guard';
const LABEL = 'Pre-Commerciality-MegaCap-Guard';
const MCAP_FLOOR = 1e9;
const REV_FLOOR  = 1e8;

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
      threshold: REV_FLOOR, thresholdOp: 'gte'
    });
  }
  const mcap = _unwrap(stock.marketCap);
  const revArr = (stock.annual && stock.annual.annualRev) || [];
  const rev0 = _unwrap(revArr[0]);
  // BUG-fix (audit 2026-06-21): a NULL latest-year revenue is a Yahoo data gap, NOT proof of
  // pre-commerciality. Use the best available revenue basis — annualRev[0], else the first finite
  // later annual year, else metrics.revenueTTM — before judging. Genuine pre-revenue names report
  // 0 (finite), which still fails the floor below; only a TOTAL absence of any revenue figure is
  // treated as "cannot judge" (guard inactive) rather than a hard fail. Prevents DG-03 wiring from
  // ejecting a fully-commercial QC name on a single missing-latest-year-revenue snapshot.
  let revBasis = rev0;
  let revSource = 'annualRev[0]';
  if (revBasis == null) {
    for (let i = 1; i < revArr.length; i++) {
      const v = _unwrap(revArr[i]);
      if (v != null) { revBasis = v; revSource = 'annualRev[' + i + ']'; break; }
    }
  }
  if (revBasis == null) {
    const ttmRev = _unwrap(stock.metrics && stock.metrics.revenueTTM);
    if (ttmRev != null) { revBasis = ttmRev; revSource = 'revenueTTM'; }
  }

  // mcap is the precondition — without it, no judgement.
  if (mcap == null || mcap <= 0) {
    return H.buildResult({
      computable: false,
      reason: 'no mcap data — guard inactive',
      threshold: REV_FLOOR, thresholdOp: 'gte'
    });
  }

  // Below mcap floor → guard does not apply. Mark as computable+pass so
  // the result is informative (not silently undefined) but does not
  // contribute to the hard-gate count.
  if (mcap < MCAP_FLOOR) {
    return H.buildResult({
      value: rev0,
      pass: true,
      computable: true,
      components: { mcap, rev0, mcapFloor: MCAP_FLOOR, revFloor: REV_FLOOR, applied: false },
      reason: 'mcap ' + (mcap/1e9).toFixed(2) + 'B < ' + (MCAP_FLOOR/1e9).toFixed(0) + 'B → guard not applicable',
      threshold: REV_FLOOR, thresholdOp: 'gte'
    });
  }

  // Above mcap floor: a revenue figure must exist AND clear the floor. No revenue figure anywhere
  // (all annual years null + no TTM) -> cannot judge -> guard inactive (computable:false), NOT a fail.
  if (revBasis == null) {
    return H.buildResult({
      computable: false,
      reason: 'mcap ' + (mcap/1e9).toFixed(2) + 'B but no revenue figure (annualRev all null, no revenueTTM) — guard inactive',
      threshold: REV_FLOOR, thresholdOp: 'gte'
    });
  }
  const pass = revBasis >= REV_FLOOR;

  return H.buildResult({
    value: revBasis,
    pass,
    computable: true,
    components: {
      mcap, rev0, revBasis, revSource,
      mcapFloor: MCAP_FLOOR,
      revFloor: REV_FLOOR,
      applied: true,
      failureReason: pass ? null : 'rev-below-floor'
    },
    reason: pass
      ? 'mcap ' + (mcap/1e9).toFixed(2) + 'B + rev ' + (revBasis/1e6).toFixed(0) + 'M (' + revSource + ') >= floor — pass'
      : 'mcap ' + (mcap/1e9).toFixed(2) + 'B + rev ' + (revBasis/1e6).toFixed(0) + 'M (' + revSource + ')' +
        ' < ' + (REV_FLOOR/1e6).toFixed(0) + 'M floor — narrative-only mega-cap pattern',
    threshold: REV_FLOOR, thresholdOp: 'gte'
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Hard-DataGuard: mcap > 1B verlangt Revenue >= 100M (sonst Pre-Commerciality-MegaCap)',
  threshold: REV_FLOOR, thresholdOp: 'gte', unit: 'USD',
  evaluate
};
