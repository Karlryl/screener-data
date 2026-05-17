'use strict';
/**
 * Tag 210d: Analyst Revision Breadth (4w / 12w net positive revisions)
 * =====================================================================
 * True breadth metric for estimate revisions: counts the net number of
 * analysts revising estimates UP minus DOWN over rolling 4-week and
 * 12-week windows. Mill Street Research and Baird document breadth as
 * the most persistent revision-momentum factor; it cleanly captures
 * the leading-indicator signal that estimate-revision-proxy.js (Tag 141)
 * only approximates via forward-PE-discount + revenue-acceleration.
 *
 * Data sources (priority order):
 *   1. stock.external.estimateRevisions[period] — Yahoo's earningsTrend
 *      breakdown when present; expected shape:
 *      {
 *        upLast7Days: N, downLast7Days: N,
 *        upLast30Days: N, downLast30Days: N,
 *        upLast60Days: N, downLast60Days: N,
 *        upLast90Days: N, downLast90Days: N
 *      }
 *      We map 30d→"4w" and 90d→"12w" (close enough; 30d ≈ 4.3 weeks).
 *   2. stock.metrics.estimateRevisions{ up4w, down4w, up12w, down12w }
 *      — alternative direct shape if a future puller normalizes upstream.
 *   3. Fallback: NONE. Tag 141's estimate-revision-proxy.js already covers
 *      the proxy path — duplicating that fallback here would muddy the
 *      signal. When breadth data is absent we return computable=false and
 *      list the expected fields, per "don't fake" project rule.
 *
 * Pass threshold:  net_4w >= 3   (at least 3 more analysts revised UP than
 *                                  DOWN over the past 4 weeks).
 *                  AND, if available, net_12w must not be strongly negative
 *                  (>= -2) — guards against a 1-week jolt overwhelming a
 *                  3-month negative trend.
 *
 * DIAGNOSTIC (per spec): not in SCORE_WEIGHTS, fixture-hash safe. Becomes
 * usable the moment a future tag extends pull-yahoo (or a new puller) to
 * persist estimateRevisions per the schema above.
 *
 * Anchor safety:
 *   - NVDA / MSFT / heavily-covered names: typically +3 to +5 net in 4w.
 *   - PLTR / CRDO: choppy but trending; computable when coverage exists.
 *   - ALAB / new IPOs: typically computable=false (sparse coverage). Clean
 *     exit, not a failure.
 *   - Current snapshots carry NO estimateRevisions field → returns
 *     computable=false universally. Same fixture-hash-safe pattern as
 *     beneish-m-score and ohlson-o-score.
 *
 * Promotion path (future tag):
 *   a. Extend pull-yahoo (or a dedicated estimate-revisions puller) to
 *      surface Yahoo's quoteSummary.earningsTrend per-period
 *      epsRevisions{upLast7/30/60/90Days,downLast7/30/60/90Days}.
 *   b. Backfill anchors; verify net_4w and net_12w distributions.
 *   c. Decide whether to retire or de-emphasize estimate-revision-proxy
 *      (Tag 141) once true breadth is live.
 *   d. If signal stable, consider promoting to CORE with weight in the
 *      HG/QC SCORE_WEIGHTS (would change fixture hash — separate tag).
 *
 * References:
 *   - Mill Street Research, "Do Analyst Estimate Revisions Still Help?"
 *     https://www.millstreetresearch.com/do-analyst-estimate-revisions-still-help-forecast-relative-stock-returns/
 *   - Zacks Rank (zRank): https://www.zacks.com/upload_education/zrank.pdf
 *   - Refinitiv/LSEG StarMine — monitor analyst revisions during earnings.
 *   - See also: audit-reports/2026-05-16-tag208-competitive-research.md (Method B).
 */
const H = require('./_helpers.js');

const ID = 'analyst-revision-breadth';
const LABEL = 'Analyst Revision Breadth';
const THRESHOLD = 3;
const THRESHOLD_OP = 'gte';

// Hard-negative floor for the 12w window when available (signal-quality guard).
const NET_12W_FLOOR = -2;

/**
 * Try to extract breadth counts from a snapshot. Returns
 *   { up4w, down4w, up12w, down12w, source }
 * with each field finite or null. `source` describes which shape matched.
 * Returns null if no recognized shape is present.
 */
function _extractBreadth(stock) {
  if (!stock) return null;

  // --- Shape 1: stock.external.estimateRevisions[period] ---
  // Period preference: 0q (current quarter) > +1q > 0y (FY). We pick the
  // first period that carries non-null upLast30Days/downLast30Days.
  //
  // Tag 211j (audit HIGH fix): null-preserving coercion. Number(null)===0
  // would silently treat a missing window as zero up-revisions, leading
  // to false "net4w=0" verdicts when the underlying data is missing.
  // Yahoo regularly returns null for older windows (e.g. NVDA's
  // downLast90Days came back as null in May 2026 live test) — we must
  // distinguish "0 revisions" (a real signal) from "no data".
  const _num = (v) => {
    if (v == null) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    // Allow string-numbers via Number() but only when the result is finite.
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const extER = stock.external && stock.external.estimateRevisions;
  if (extER && typeof extER === 'object') {
    // Tag 215a (audit HIGH-1 fix): period preference reordered to favor
    // annual ('0y', '+1y') over quarterly ('0q', '+1q'). Yahoo's quarterly
    // estimate-revision counts include only the smaller subset of analysts
    // who explicitly publish per-quarter; the annual numbers reflect the
    // broader consensus. Live example: MSFT 0q=-9 (fail), 0y=+19 (pass) —
    // these aren't contradictory, they're sampling different cohorts.
    // Annual is the more durable / larger-N signal so we prefer it.
    const periodKeys = ['0y', '+1y', '0q', '+1q'];
    for (const pk of periodKeys) {
      const row = extER[pk];
      if (!row || typeof row !== 'object') continue;
      const u4 = _num(row.upLast30Days);
      const d4 = _num(row.downLast30Days);
      const u12 = _num(row.upLast90Days);
      const d12 = _num(row.downLast90Days);
      // Require at least the 4w window (30d) to be present (both up and down
      // non-null). null+null=null is "no data"; 0+0=0 is a real "no
      // revisions" signal and is allowed through.
      if (u4 != null && d4 != null) {
        return {
          up4w: u4, down4w: d4,
          up12w: u12,
          down12w: d12,
          source: 'external.estimateRevisions.' + pk
        };
      }
    }
  }

  // --- Shape 2: stock.metrics.estimateRevisions{up4w,down4w,up12w,down12w} ---
  const m = stock.metrics && stock.metrics.estimateRevisions;
  // metrics-style entries may be wrapped in { value: ... } envelopes; unwrap.
  function _unwrap(v) {
    if (v == null) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'object' && Number.isFinite(v.value)) return v.value;
    return null;
  }
  if (m && typeof m === 'object') {
    const obj = (typeof m === 'object' && m.value && typeof m.value === 'object') ? m.value : m;
    const u4 = _unwrap(obj.up4w);
    const d4 = _unwrap(obj.down4w);
    const u12 = _unwrap(obj.up12w);
    const d12 = _unwrap(obj.down12w);
    if (Number.isFinite(u4) && Number.isFinite(d4)) {
      return { up4w: u4, down4w: d4, up12w: u12, down12w: d12,
               source: 'metrics.estimateRevisions' };
    }
  }

  return null;
}

function evaluate(stock) {
  const ex = _extractBreadth(stock);
  if (!ex) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'analyst-revision-breadth requires estimateRevisions data not in current snapshots',
      components: {
        missingFields: ['estimateRevisions'],
        expectedShape: {
          'external.estimateRevisions[period]': '{upLast7/30/60/90Days, downLast7/30/60/90Days}',
          'metrics.estimateRevisions':         '{up4w, down4w, up12w, down12w}'
        }
      },
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const net4w  = ex.up4w  - ex.down4w;
  const net12w = (ex.up12w != null && ex.down12w != null)
                 ? ex.up12w - ex.down12w
                 : null;

  // Primary gate: net 4w >= 3
  let pass = net4w >= THRESHOLD;
  // Quality guard: if 12w is available and strongly negative, override pass=false.
  let twelveWeekVeto = false;
  if (pass && net12w != null && net12w < NET_12W_FLOOR) {
    pass = false;
    twelveWeekVeto = true;
  }

  let reason = 'net4w=' + (net4w >= 0 ? '+' : '') + net4w
             + (net12w != null ? ', net12w=' + (net12w >= 0 ? '+' : '') + net12w : ', net12w=n/a')
             + ' (floor net4w>=' + THRESHOLD + ')';
  if (twelveWeekVeto) {
    reason += ' VETOED by 12w<' + NET_12W_FLOOR;
  }

  return H.buildResult({
    value: net4w,
    pass,
    computable: true,
    components: {
      up4w: ex.up4w, down4w: ex.down4w, net4w,
      up12w: ex.up12w, down12w: ex.down12w, net12w,
      source: ex.source,
      twelveWeekVeto,
      thresholds: { net4w: THRESHOLD, net12wFloor: NET_12W_FLOOR }
    },
    reason,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Analyst Revision Breadth: net 4w analyst up-revisions minus down-revisions >= 3 (Mill Street/Zacks-style breadth)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'count',
  evaluate
};
