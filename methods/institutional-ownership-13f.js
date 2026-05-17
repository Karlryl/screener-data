'use strict';
/**
 * Tag 213a: Institutional Ownership (SEC 13F)
 * =============================================
 * RESEARCH BASIS:
 *   SEC EDGAR Form 13F-HR is mandatory quarterly position disclosure for any
 *   institutional investment manager exercising discretion over >$100M of
 *   13(f)-eligible securities (Investment Advisers Act §13(f), Rule 13f-1).
 *   Damodaran ("Investment Philosophies", ch. on institutional behavior) and
 *   the 13F-tracking literature (Wermers 1999, Chen-Jegadeesh-Wermers 2000,
 *   Cohen-Polk-Silli 2010 "Best Ideas") document that concentrated holdings by
 *   tracked smart-money institutions are a moderately persistent alpha signal,
 *   particularly when multiple high-conviction managers overlap on the same name.
 *
 * Data source:
 *   external-data/sec-13f-by-ticker.json (produced by Tag 212e SEC 13F puller).
 *   Structure: { updatedAt, byTicker: { TICKER: { ticker, nameOfIssuer,
 *               holders: [ { institutionCik, institutionName, value, shares, ... } ] }}}
 *   The bootstrap CIK list in Tag 212e is intentionally narrow (~40 tracked
 *   smart-money institutions) so the 13F sample is curated, not exhaustive.
 *
 * Formula:
 *   For the stock's ticker, look up byTicker[TICKER]. If present:
 *     - institutionsHolding = count of distinct institutionCik in holders[]
 *     - totalValueUSD       = sum of holder.value across holders[]
 *     - sampleInstitutions  = first 5 distinct institutionName values (for UI)
 *
 * Pass: institutionsHolding >= 3.
 *   Threshold is deliberately low because the bootstrap CIK list itself is
 *   small (~40 institutions); even a "well-owned" name may only show 3-5 here.
 *   Raising this threshold should follow CIK-list expansion (future tag).
 *
 * Tag 220c (audit F-219c-F6 MEDIUM): Yahoo fallback.
 *   When the curated SEC 13F cache is missing OR the ticker isn't in it,
 *   fall back to Yahoo's majorHoldersBreakdown.institutionsCount (broad-based,
 *   ~all 13F-filing institutions aggregated, not curated). Priority:
 *     1. SEC 13F cache (curated smart-money CIK list) — preferred.
 *     2. Yahoo meta.institutionsCount — fallback, broader denominator.
 *   The fallback is flagged via components.source so downstream consumers
 *   can distinguish the two regimes; threshold is unchanged (>= 3) but
 *   Yahoo's count is broader so passes are easier than from SEC source.
 *
 * Not computable when:
 *   - sec-13f-by-ticker.json missing/unreadable AND meta.institutionsCount absent
 *   - cache file has no byTicker section AND meta.institutionsCount absent
 *   - ticker not present in byTicker AND meta.institutionsCount absent
 *
 * NOT in SCORE_WEIGHTS -> DIAGNOSTIC-only -> fixture-hash safe by construction.
 */
const fs = require('fs');
const path = require('path');
const H = require('./_helpers.js');

const ID = 'institutional-ownership-13f';
const LABEL = 'Institutional Ownership (13F)';
const THRESHOLD = 3;
const THRESHOLD_OP = 'gte';
const CACHE_PATH = path.join(__dirname, '..', 'external-data', 'sec-13f-by-ticker.json');

// Module-level lazy loader, same pattern as sector-relative-roic._loadAutoMedians().
// Sentinel values:
//   null  -> never attempted
//   false -> attempted, file missing/unreadable (cache the negative result so we
//            don't hit fs on every stock evaluation)
//   object -> successfully parsed payload
let _cache = null;

function _load13F() {
  if (_cache !== null) return _cache;
  try {
    if (!fs.existsSync(CACHE_PATH)) {
      _cache = false;
      return _cache;
    }
    const raw = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    if (!raw || typeof raw !== 'object' || !raw.byTicker || typeof raw.byTicker !== 'object') {
      _cache = false;
      return _cache;
    }
    _cache = raw;
  } catch (e) {
    _cache = false;
  }
  return _cache;
}

function _candidateTickers(stock) {
  const out = [];
  const seen = new Set();
  const push = (t) => {
    if (!t || typeof t !== 'string') return;
    const up = t.trim().toUpperCase();
    if (!up || seen.has(up)) return;
    seen.add(up);
    out.push(up);
  };
  if (stock) {
    push(stock.meta && stock.meta.ticker);
    push(stock.meta && stock.meta.yahoo_symbol);
    push(stock.identifier);
  }
  return out;
}

// Tag 220c (audit F-219c-F6 MEDIUM): Yahoo fallback — broad-based
// institutionsCount from majorHoldersBreakdown. Returns the pass/fail/result
// when Yahoo data is present, or null when it isn't (caller continues with
// the original incomputable response).
function _yahooFallback(stock, primaryReason) {
  const ic = stock && stock.meta && stock.meta.institutionsCount;
  if (ic == null || !Number.isFinite(ic) || ic <= 0) return null;
  const pct = stock.meta.institutionsPercentHeld;
  const pass = ic >= THRESHOLD;
  return H.buildResult({
    value: ic,
    pass,
    computable: true,
    components: {
      institutionsCount: ic,
      institutionsPercentHeld: pct != null ? pct : null,
      source: 'yahoo.majorHoldersBreakdown',
      primaryUnavailable: primaryReason
    },
    reason: ic + ' institution(s) hold (Yahoo aggregate fallback; SEC 13F unavailable: ' +
            primaryReason + ')',
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

function evaluate(stock) {
  const data = _load13F();
  if (data === false) {
    // Try Yahoo fallback before declaring incomputable.
    const fb = _yahooFallback(stock, 'sec-13f-by-ticker.json not available');
    if (fb) return fb;
    return H.buildResult({
      computable: false, pass: false,
      reason: 'sec-13f-by-ticker.json not available',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const candidates = _candidateTickers(stock);
  if (candidates.length === 0) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'no ticker identifier on stock',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  let entry = null;
  let matchedTicker = null;
  for (const t of candidates) {
    if (data.byTicker[t]) {
      entry = data.byTicker[t];
      matchedTicker = t;
      break;
    }
  }

  // Tag 215c (audit MEDIUM-3 + LOW-1): distinguish "ticker absent from cache"
  // from "ticker present but zero holders". Both are incomputable but the
  // diagnostic reason differs. Also DROPPED value:0 — the other incomputable
  // branches let buildResult clamp to null; consistency across all branches
  // prevents UI consumers reading r.value without r.computable from seeing
  // a misleading "0 institutions" verdict.
  if (!entry) {
    // Tag 220c: Yahoo fallback when ticker absent from curated 13F cache.
    const fb = _yahooFallback(stock, 'ticker ' + candidates[0] + ' not in 13F cache');
    if (fb) return fb;
    return H.buildResult({
      computable: false, pass: false,
      reason: 'ticker ' + candidates[0] + ' not in 13F cache (' + candidates.length + ' alias(es) tried)',
      components: { ticker: candidates[0], aliasesTried: candidates, presentInCache: false },
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  if (!Array.isArray(entry.holders) || entry.holders.length === 0) {
    // Tag 220c: Yahoo fallback when SEC cache lists ticker but no tracked institutions.
    const fb = _yahooFallback(stock, 'ticker present in 13F cache but zero tracked institutions');
    if (fb) return fb;
    return H.buildResult({
      computable: false, pass: false,
      reason: 'ticker ' + matchedTicker + ' present in 13F cache but zero tracked institutions hold it',
      components: { ticker: matchedTicker, presentInCache: true, holders: 0 },
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const ciks = new Set();
  const namesByOrder = [];
  let totalValueUSD = 0;
  for (const h of entry.holders) {
    if (!h) continue;
    if (h.institutionCik && !ciks.has(h.institutionCik)) {
      ciks.add(h.institutionCik);
      if (h.institutionName) namesByOrder.push(h.institutionName);
    }
    const v = Number(h.value);
    if (Number.isFinite(v) && v > 0) totalValueUSD += v;
  }

  const institutionsHolding = ciks.size;
  const sampleInstitutions = namesByOrder.slice(0, 5);
  const pass = institutionsHolding >= THRESHOLD;

  return H.buildResult({
    value: institutionsHolding,
    pass,
    computable: true,
    components: {
      ticker: matchedTicker,
      institutionsHolding,
      totalValueUSD,
      sampleInstitutions,
      holdingsRecorded: entry.holders.length,
      cacheUpdatedAt: data.updatedAt || null
    },
    reason: institutionsHolding + ' tracked institution(s) hold ' + matchedTicker +
            ' (totalValueUSD=' + totalValueUSD.toLocaleString('en-US') + ', floor >= ' + THRESHOLD + ')',
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: '>= 3 tracked smart-money institutions hold the stock per latest SEC 13F-HR filings (Tag 212e cache)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'count',
  evaluate,
  // Exposed for tests: reset the module-level cache so test fixtures can stub
  // different cache states between tests without process restart.
  _resetCacheForTests: function () { _cache = null; }
};
