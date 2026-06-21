'use strict';
/**
 * Workstream A2: Insider-Conviction-Score
 * =======================================
 * RESEARCH BASIS:
 *   SEC Form 4 (Statement of Changes in Beneficial Ownership) is the mandatory
 *   2-business-day disclosure for any officer, director, or >10% owner who
 *   transacts in their company's securities (Securities Exchange Act §16(a)).
 *   The insider-purchase literature (Lakonishok & Lee 2001 RFS; Cohen, Malloy &
 *   Pomorski 2012 JF "Decoding Inside Information") establishes that OPEN-MARKET
 *   PURCHASES by senior insiders — particularly OPPORTUNISTIC (non-routine)
 *   purchases clustered across multiple insiders — are a robust predictive
 *   signal, while routine/programmatic trades and option exercises carry little
 *   information. This method scores the conviction embedded in recent open-market
 *   buying and gates the INSIDER_BUYING tab.
 *
 * DATA SOURCE:
 *   external-data/sec-form4-cache.json — shape:
 *     { byTicker: { TICKER: { transactions: [ {
 *         transactionDate, transactionCode ('P'/'S'/'A'/'M'), acquiredDisposed,
 *         transactionShares, transactionPricePerShare, reportingPersonName,
 *         reportingPersonRelationship: { isDirector, isOfficer, isTenPercentOwner,
 *                                        officerTitle },
 *         sharesOwnedFollowingTransaction, filingDate, isTenB5One } ] } } }
 *   Optional history cache (routine detection):
 *     external-data/sec-form4-history.json — shape:
 *       { byTicker: { TICKER: { byPerson: { NAME: { months: [ 'YYYY-MM', ... ] } } } } }
 *   Both caches loaded at module load (cached in module vars). If the cache file
 *   or ticker entry is absent → computable:false (graceful), mirroring
 *   institutional-ownership-13f.js.
 *
 * SIGNAL CONSTRUCTION (P-buys only; A/M excluded entirely):
 *   90-day window = transactionDate within 90 days of nowMs.
 *   HARD GATE (all four required; pass:true iff all pass):
 *     (1) >= 1 P-buy in 90d
 *     (2) aggregate P buy value (Σ shares*price) >= $25,000
 *     (3) net positive: Σ P-buy $ > Σ S-sell $ (10b5-1-flagged sells EXCLUDED)
 *     (4) filing lag <= 90d for the most recent qualifying buy
 *   SCORE 0–100 (capped) over the 90d P-buys:
 *     · Role of largest buyer (by $)        0–25
 *     · Cluster breadth (distinct names)    0–25
 *     · Conviction / price location         0–20
 *     · % of existing holdings              0–20
 *     · Opportunistic vs routine            0–10
 *   TIME-DECAY on the summed score by most-recent-qualifying-buy age:
 *     <=30d → ×1.0; 31–90d → ×0.7; 91–180d → ×0.4.
 *
 *   value = decayed score (rounded). pass = HARD-GATE result (NOT score>threshold).
 *
 * DIAGNOSTIC ONLY — NOT in any SCORE_WEIGHTS → fixture-hash safe by construction.
 */
const fs = require('fs');
const path = require('path');
const H = require('./_helpers.js');

const ID = 'insider-conviction-score';
const LABEL = 'Insider-Conviction-Score';
const THRESHOLD = 0;
const THRESHOLD_OP = 'gt';
const UNIT = 'score';

const CACHE_PATH = path.join(__dirname, '..', 'external-data', 'sec-form4-cache.json');
const HISTORY_PATH = path.join(__dirname, '..', 'external-data', 'sec-form4-history.json');

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 90;
const MIN_BUY_VALUE = 25000;
const MAX_FILING_LAG_DAYS = 90;

// Module-level lazy cache. Sentinels:
//   null  -> never attempted
//   false -> attempted, missing/unreadable (cache the negative)
//   object -> parsed payload
let _cache = null;
let _history = null;

function _loadCache() {
  if (_cache !== null) return _cache;
  try {
    if (!fs.existsSync(CACHE_PATH)) { _cache = false; return _cache; }
    const raw = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    if (!raw || typeof raw !== 'object' || !raw.byTicker || typeof raw.byTicker !== 'object') {
      _cache = false; return _cache;
    }
    _cache = raw;
  } catch (e) {
    _cache = false;
  }
  return _cache;
}

function _loadHistory() {
  if (_history !== null) return _history;
  try {
    if (!fs.existsSync(HISTORY_PATH)) { _history = false; return _history; }
    const raw = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
    if (!raw || typeof raw !== 'object' || !raw.byTicker || typeof raw.byTicker !== 'object') {
      _history = false; return _history;
    }
    _history = raw;
  } catch (e) {
    _history = false;
  }
  return _history;
}

function _num(v) {
  return (typeof v === 'number' && Number.isFinite(v)) ? v : null;
}

function _parseDate(d) {
  if (d == null) return null;
  const t = (typeof d === 'number') ? d : Date.parse(d);
  return Number.isFinite(t) ? t : null;
}

// --- Sub-score helpers --------------------------------------------------

// Role of the largest buyer (by $ value) — 0..25.
function _roleScore(rel) {
  rel = rel || {};
  const title = (rel.officerTitle || '').toString();
  if (/chief executive|ceo|chair/i.test(title)) return { points: 25, role: 'CEO/Chair' };
  if (/chief financial|cfo/i.test(title)) return { points: 22, role: 'CFO' };
  if (rel.isOfficer && rel.isDirector) return { points: 18, role: 'Officer+Director' };
  if (rel.isDirector) return { points: 10, role: 'Director' };
  if (rel.isTenPercentOwner) return { points: 4, role: '10%-Owner' };
  if (rel.isOfficer) return { points: 18, role: 'Officer' };
  return { points: 0, role: 'Unknown' };
}

// Cluster breadth (distinct reportingPersonName among 90d P-buys) — 0..25.
function _clusterScore(distinctCount) {
  if (distinctCount >= 4) return 25;
  if (distinctCount === 3) return 20;
  if (distinctCount === 2) return 14;
  if (distinctCount === 1) return 5;
  return 0;
}

// Conviction / price location — 0..20. Largest buy's price vs 52w range.
// Within 15% of 52w-low → 20; near 52w-high → 0..6; linear middle → ~10.
// Distance-to-52w-high is the strongest single feature. Missing data → 10.
function _convictionScore(price, low52, high52) {
  if (price == null || low52 == null || high52 == null
      || !(high52 > low52) || price <= 0) {
    return { points: 10, basis: 'unavailable' };
  }
  // Clamp price into the [low, high] range for a stable 0..1 position.
  const p = Math.max(low52, Math.min(high52, price));
  const pos = (p - low52) / (high52 - low52); // 0 = at low, 1 = at high
  if (pos <= 0.15) return { points: 20, basis: 'within-15pct-of-52w-low' };
  // Linear ramp from 20 (at pos=0.15) down to ~3 (at pos=1.0 = at 52w-high).
  // pos in (0.15, 1]: points = 3 + (1 - (pos-0.15)/0.85) * 17
  const frac = (pos - 0.15) / 0.85; // 0..1 as pos goes 0.15..1
  const pts = 3 + (1 - frac) * 17;
  return { points: Math.round(pts), basis: 'linear:' + pos.toFixed(2) };
}

// % of existing holdings for the largest buyer — 0..20.
// priorHoldings = sharesOwnedFollowingTransaction - sharesBought.
// First buy (prior ≈ 0) OR increase >20% → 20; 10–20% → 12; <10% → 4. Missing → 4.
function _holdingsScore(sharesBought, sharesAfter) {
  const after = _num(sharesAfter);
  const bought = _num(sharesBought);
  if (after == null || bought == null || bought <= 0) {
    return { points: 4, basis: 'missing' };
  }
  const prior = after - bought;
  if (prior <= 0) return { points: 20, basis: 'first-buy' };
  const pct = bought / prior;
  if (pct > 0.20) return { points: 20, basis: 'increase>20pct' };
  if (pct >= 0.10) return { points: 12, basis: 'increase10-20pct' };
  return { points: 4, basis: 'increase<10pct' };
}

// Opportunistic vs routine — 0..10.
// Routine (Cohen-Malloy-Pomorski): insider traded in the SAME calendar month
// in each of the prior 3 years. Needs >=3y history per reporting owner.
// Without history → opportunistic but only PARTIAL 5 points.
// With history & routine → 0; with history & opportunistic → 10.
function _opportunisticScore(history, ticker, personName, buyMs) {
  if (history === false || !history || !personName) {
    return { points: 5, basis: 'no-history(partial)' };
  }
  const entry = history.byTicker && history.byTicker[ticker];
  const person = entry && entry.byPerson && entry.byPerson[personName];
  const months = person && Array.isArray(person.months) ? person.months : null;
  if (!months || months.length === 0) {
    return { points: 5, basis: 'no-person-history(partial)' };
  }
  const d = new Date(buyMs);
  const buyYear = d.getUTCFullYear();
  const buyMonth = d.getUTCMonth() + 1; // 1..12
  const mm = String(buyMonth).padStart(2, '0');
  // Routine iff the same calendar month appears in EACH of the prior 3 years.
  let routine = true;
  for (let k = 1; k <= 3; k++) {
    const key = (buyYear - k) + '-' + mm;
    if (!months.includes(key)) { routine = false; break; }
  }
  if (routine) return { points: 0, basis: 'routine' };
  return { points: 10, basis: 'opportunistic' };
}

function _decayMultiplier(ageDays) {
  if (ageDays <= 30) return 1.0;
  if (ageDays <= 90) return 0.7;
  if (ageDays <= 180) return 0.4;
  return 0.4; // older than 180d shouldn't appear in a 90d window, but be safe
}

/**
 * Core scoring entry point — injectable for deterministic tests.
 * @param {object} stock     canonical stock (for ticker + metrics price/52w)
 * @param {Array}  txns      Form-4 transaction array for this ticker
 * @param {number} nowMs     epoch ms reference point for the 90d window
 * @param {object} historyOpt optional override for the history cache (tests)
 */
function _evaluateWithTxns(stock, txns, nowMs, historyOpt) {
  if (!Array.isArray(txns)) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'no Form-4 transactions for ticker',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const history = (historyOpt !== undefined) ? historyOpt : _loadHistory();
  const ticker = (stock && stock.meta && stock.meta.ticker)
    ? String(stock.meta.ticker).toUpperCase() : null;

  const windowStart = nowMs - WINDOW_DAYS * DAY_MS;

  // Partition 90d transactions into P-buys and S-sells.
  const buys = [];   // P
  const sells = [];  // S
  for (const t of txns) {
    if (!t) continue;
    const code = t.transactionCode;
    if (code !== 'P' && code !== 'S') continue; // exclude A, M entirely
    const tMs = _parseDate(t.transactionDate);
    if (tMs == null) continue;
    if (tMs < windowStart || tMs > nowMs) continue; // outside 90d window
    if (code === 'P') buys.push({ t, tMs });
    else sells.push({ t, tMs });
  }

  // Aggregate buy value (Σ shares*price).
  let aggBuyValue = 0;
  const distinctNames = new Set();
  let topBuy = null;     // { t, tMs, value }
  let topBuyValue = -1;
  let lastBuyMs = null;  // most-recent qualifying buy
  for (const b of buys) {
    const shares = _num(b.t.transactionShares) || 0;
    const price = _num(b.t.transactionPricePerShare) || 0;
    const value = shares * price;
    aggBuyValue += value;
    if (b.t.reportingPersonName) distinctNames.add(b.t.reportingPersonName);
    if (value > topBuyValue) { topBuyValue = value; topBuy = { ...b, value }; }
    if (lastBuyMs == null || b.tMs > lastBuyMs) lastBuyMs = b.tMs;
  }

  // Aggregate sell value, EXCLUDING 10b5-1-flagged sells from the net gate.
  let aggSellValue = 0;
  for (const s of sells) {
    if (s.t.isTenB5One === true) continue; // 10b5-1 programmatic — excluded
    const shares = _num(s.t.transactionShares) || 0;
    const price = _num(s.t.transactionPricePerShare) || 0;
    aggSellValue += shares * price;
  }

  const netValue = aggBuyValue - aggSellValue;

  // --- HARD GATE ---
  const gate1 = buys.length >= 1;
  const gate2 = aggBuyValue >= MIN_BUY_VALUE;
  const gate3 = netValue > 0;
  // Gate 4: filing lag <= 90d for the most-recent qualifying buy.
  let gate4 = false;
  let mostRecentBuy = null;
  if (lastBuyMs != null) {
    for (const b of buys) { if (b.tMs === lastBuyMs) { mostRecentBuy = b; break; } }
  }
  if (mostRecentBuy) {
    const filingMs = _parseDate(mostRecentBuy.t.filingDate);
    if (filingMs != null) {
      const lagDays = (filingMs - mostRecentBuy.tMs) / DAY_MS;
      // audit F-A-2026-06-21: prevents filing-before-transaction (negative lag)
      // data errors from clearing the timeliness gate. SEC Form 4 must be filed
      // AFTER the transaction (§16(a) 2-business-day rule), so a filingDate
      // earlier than the transactionDate is a corrupt/mis-parsed record; the
      // upper-bound-only check (lagDays <= 90) silently passed such records.
      // Valid data always has lagDays >= 0, so healthy filings are unaffected.
      gate4 = lagDays >= 0 && lagDays <= MAX_FILING_LAG_DAYS;
    }
  }
  const gatePassed = gate1 && gate2 && gate3 && gate4;

  // --- SCORE (computed over the 90d P-buys; meaningful only when buys exist) ---
  let role = { points: 0, role: 'none' };
  let clusterPts = 0;
  let conviction = { points: 10, basis: 'no-buys' };
  let holdings = { points: 4, basis: 'no-buys' };
  let opportunistic = { points: 0, basis: 'no-buys' };
  let topBuyerName = null;

  if (topBuy) {
    topBuyerName = topBuy.t.reportingPersonName || null;
    role = _roleScore(topBuy.t.reportingPersonRelationship);
    clusterPts = _clusterScore(distinctNames.size);

    const price = H.metricValue(stock, 'currentPrice');
    const low52 = H.metricValue(stock, 'fiftyTwoWeekLow');
    const high52 = H.metricValue(stock, 'fiftyTwoWeekHigh');
    conviction = _convictionScore(
      _num(topBuy.t.transactionPricePerShare) != null ? topBuy.t.transactionPricePerShare : price,
      low52, high52
    );

    holdings = _holdingsScore(topBuy.t.transactionShares, topBuy.t.sharesOwnedFollowingTransaction);
    opportunistic = _opportunisticScore(history, ticker, topBuyerName, topBuy.tMs);
  }

  const rawScore = role.points + clusterPts + conviction.points
    + holdings.points + opportunistic.points;
  const score = Math.min(100, rawScore);

  // --- TIME-DECAY on the final summed score ---
  let decayMultiplier = 1.0;
  let lastBuyAgeDays = null;
  if (lastBuyMs != null) {
    lastBuyAgeDays = (nowMs - lastBuyMs) / DAY_MS;
    decayMultiplier = _decayMultiplier(lastBuyAgeDays);
  }
  const decayedScore = Math.round(score * decayMultiplier);

  const lastBuyDate = lastBuyMs != null
    ? new Date(lastBuyMs).toISOString().slice(0, 10) : null;

  const breakdown = {
    role: role.points,
    cluster: clusterPts,
    conviction: conviction.points,
    holdings: holdings.points,
    routine: opportunistic.points
  };

  // recentBuys: the 90d P-buy transactions used, for the modal table.
  // Each { date, name, role, shares, price, value, code }, sorted by date desc, capped ~12.
  const recentBuys = buys
    .map(b => {
      const shares = _num(b.t.transactionShares) || 0;
      const price = _num(b.t.transactionPricePerShare) || 0;
      const rel = b.t.reportingPersonRelationship || {};
      return {
        date: _parseDate(b.t.transactionDate) != null
          ? new Date(b.tMs).toISOString().slice(0, 10) : null,
        name: b.t.reportingPersonName || null,
        role: _roleScore(rel).role,
        shares,
        price,
        value: shares * price,
        code: b.t.transactionCode || 'P'
      };
    })
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, 12);

  const components = {
    gatePassed,
    score,                 // pre-decay (capped)
    decayedScore,
    decayMultiplier,
    clusterCount: distinctNames.size,
    topBuyerRole: role.role,
    topBuyerName,
    aggBuyValue90d: aggBuyValue,
    aggSellValue90d: aggSellValue,
    netValue90d: netValue,
    lastBuyDate,
    lastBuyAgeDays: lastBuyAgeDays != null ? Math.round(lastBuyAgeDays) : null,
    buyCount90d: buys.length,
    sellCount90d: sells.length,
    breakdown,
    recentBuys,
    gateDetail: {
      hasBuy: gate1,
      buyValueFloor: gate2,
      netPositive: gate3,
      filingLagOk: gate4
    },
    convictionBasis: conviction.basis,
    holdingsBasis: holdings.basis,
    routineBasis: opportunistic.basis
  };

  // Reason explains the gate outcome (the load-bearing pass/fail driver).
  let reason;
  if (gatePassed) {
    reason = 'INSIDER_BUYING qualified: ' + buys.length + ' P-buy(s) / ' +
      distinctNames.size + ' insider(s), aggBuy=$' +
      Math.round(aggBuyValue).toLocaleString('en-US') + ', net=$' +
      Math.round(netValue).toLocaleString('en-US') + ', score=' + decayedScore +
      ' (raw ' + score + ' ×' + decayMultiplier + ')';
  } else {
    const fails = [];
    if (!gate1) fails.push('no P-buy in 90d');
    if (!gate2) fails.push('aggBuy $' + Math.round(aggBuyValue).toLocaleString('en-US') + ' < $25k');
    if (!gate3) fails.push('net $' + Math.round(netValue).toLocaleString('en-US') + ' <= 0');
    if (!gate4) fails.push('filing lag > 90d (or missing)');
    reason = 'gate failed: ' + fails.join('; ') + ' (score=' + decayedScore + ')';
  }

  return H.buildResult({
    value: decayedScore,
    pass: gatePassed,
    computable: true,
    components,
    reason,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

function evaluate(stock) {
  const ticker = (stock && stock.meta && stock.meta.ticker)
    ? String(stock.meta.ticker).toUpperCase() : null;
  if (!ticker) {
    return H.buildResult({
      computable: false, pass: false, reason: 'no ticker identifier on stock',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const cache = _loadCache();
  if (cache === false) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'sec-form4-cache.json not available',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const entry = cache.byTicker[ticker];
  if (!entry || !Array.isArray(entry.transactions)) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'ticker ' + ticker + ' not in sec-form4-cache.json',
      components: { ticker, presentInCache: false },
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  return _evaluateWithTxns(stock, entry.transactions, Date.now());
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Insider open-market-buy conviction score (SEC Form 4): P-only, $25k floor, ' +
    'net-of-non-10b5-1-sells, role/cluster/price-location/holdings/opportunistic, time-decayed. ' +
    'pass = INSIDER_BUYING-tab hard-gate.',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: UNIT,
  evaluate,
  // Exposed for deterministic tests (fixed nowMs + hand-built txn arrays).
  _evaluateWithTxns,
  // Reset module-level caches so tests can stub different states.
  _resetCacheForTests: function () { _cache = null; _history = null; }
};
