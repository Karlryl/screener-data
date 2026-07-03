'use strict';
/**
 * newest-qtr-guard — non-destructive LAMP for Yahoo's intermittent newest-quarter
 * source corruption.
 *
 * Yahoo Finance occasionally serves a corrupted NEWEST quarter in
 * fundamentalsTimeSeries (and a co-corrupted financialData TTM). Confirmed on
 * 005930.KS (Samsung): newest quarter operating margin 42.8% / gross margin 61.2%
 * vs a real ~10% / ~40% — which inflates revenueTTM and produces a bogus
 * revenueGrowthYoY (~69%). The pipeline reproduces the source faithfully, so without
 * a guard a hypergrowth screener could rank such a name #1 on fabricated growth.
 *
 * DESIGN (A2 council + court + anchor-fixture, 2026-06-26):
 *  - DETECTION is a data-quality concern → Loop A (this function). DISPOSITION
 *    (down-weight / exclude in ranking) → Loop B, per the §6 boundary and ledger §4.
 *  - NON-DESTRUCTIVE: the caller sets only meta._newestQtrSuspect (+reason). No value
 *    is deleted, clipped, recomputed, or confidence-degraded. This mirrors the
 *    _debtPartial / _quality.grade precedents (NOT fcfMarginTTMSuppressed, which nulls).
 *  - WITHIN-QUARTER ONLY: the trigger compares the newest quarter against the
 *    company's OWN trailing quarters — it uses NO annual data, so it is immune to the
 *    separate annual-scaling / TTM-fallback bugs (e.g. AKRBP.OL).
 *
 * TRIGGER ("D1", tuned on 2715 real snapshots). All four legs must hold:
 *   (1) op-margin discontinuity: q0opm - median(trailing op-margins) > 0.20
 *   (2) physical gross-margin bound: q0 gross margin > 0.55
 *   (3) revenue jump: revenueQ[0] > 1.35 * median(trailing revenues)
 *   (4) spike-not-ramp: q1opm > 0 AND q0opm >= 1.9 * q1opm
 * Anchors: flags 005930.KS + SNDK (true corruption); does NOT flag MU/FRO/INSW/DHT/
 * AG/NGD (legitimate cyclical ramps) or NVDA (flat margins). Leg (4) is what separates
 * Samsung's discontinuous spike (q0/q1 ~2.0x) from a monotonic upcycle (MU ~1.5x).
 *
 * KNOWN LIMIT (documented in ledger §4): this is a KNOWN-SHAPE detector. A different
 * corruption shape — e.g. revenue-only inflation with otherwise-plausible margins —
 * is a deliberate residual false-negative. The lamp is precision-first by design.
 */

function _num(x) {
  if (x == null) return null;
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x === 'object' && Number.isFinite(x.value)) return x.value;
  return null;
}

function _median(arr) {
  const s = arr.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * @param {{revenueQ?:Array, opIncQ?:Array, grossProfitQ?:Array}} timeseries
 *        Quarterly arrays, NEWEST-FIRST, elements {value:number} or null.
 * @returns {{suspect:boolean, reason:(string|null)}}
 */
function detectNewestQtrSuspect(timeseries) {
  const NONE = { suspect: false, reason: null };
  if (!timeseries) return NONE;

  const rev = (timeseries.revenueQ || []).map(_num);
  const oi = (timeseries.opIncQ || []).map(_num);
  const gp = (timeseries.grossProfitQ || []).map(_num);

  // Need the newest quarter + at least 4 trailing quarters (>=5 points).
  if (rev.length < 5) return NONE;

  const r0 = rev[0], oi0 = oi[0], gp0 = gp[0], r1 = rev[1], oi1 = oi[1];
  if (!(r0 > 0) || !Number.isFinite(oi0) || !Number.isFinite(gp0)) return NONE;

  const q0opm = oi0 / r0;
  const q0gm = gp0 / r0;

  // Trailing quarters 1..4 → medians (skip any quarter with a non-positive/absent value).
  const trailOpm = [];
  const trailRev = [];
  for (let i = 1; i <= 4 && i < rev.length; i++) {
    const ri = rev[i], oii = oi[i];
    if (ri > 0) trailRev.push(ri);
    if (ri > 0 && Number.isFinite(oii)) trailOpm.push(oii / ri);
  }
  // Require enough trailing history for stable medians.
  if (trailOpm.length < 3 || trailRev.length < 3) return NONE;

  const trailOpmMed = _median(trailOpm);
  const trailRevMed = _median(trailRev);
  if (trailOpmMed == null || trailRevMed == null || !(trailRevMed > 0)) return NONE;

  const q1opm = (r1 > 0 && Number.isFinite(oi1)) ? oi1 / r1 : null;

  const leg1 = (q0opm - trailOpmMed) > 0.20;          // op-margin discontinuity
  const leg2 = q0gm > 0.55;                           // physical gross-margin bound
  const leg3 = r0 > 1.35 * trailRevMed;               // revenue jump
  // leg4: spike vs the immediately-prior quarter. The prior quarter must carry a
  // MEANINGFUL op-margin (>2%) — a near-breakeven prior makes the ratio meaningless
  // (any ordinary q0 margin trivially clears 1.9x a ~0% base), so floor it. This only
  // REMOVES borderline breakeven-recovery flags; it never adds any (anchors q1opm>>0.02).
  const leg4 = q1opm != null && q1opm > 0.02 && q0opm >= 1.9 * q1opm; // spike, not ramp

  if (leg1 && leg2 && leg3 && leg4) {
    const reason =
      `newest-qtr corruption signature: opMargin ${(q0opm * 100).toFixed(1)}% ` +
      `(trailing-median ${(trailOpmMed * 100).toFixed(1)}%, prior-qtr ${(q1opm * 100).toFixed(1)}%, ` +
      `spike x${(q0opm / q1opm).toFixed(2)}); grossMargin ${(q0gm * 100).toFixed(1)}%; ` +
      `revenue x${(r0 / trailRevMed).toFixed(2)} vs trailing median. ` +
      `Values left FAITHFUL — Loop B should down-weight/exclude (ledger §4).`;
    return { suspect: true, reason };
  }
  return NONE;
}

module.exports = { detectNewestQtrSuspect };
