'use strict';
// B6: a data-age retry, independent of board gate thresholds and scores.
const fs = require('fs');
const path = require('path');
const { safeSnapshotFilename } = require('./snapshot-fs.js');
const DAY = 86400000;
const REASON = 'stale-quarter-reload';
const COUNTERS = ['eligible', 'selected', 'pulled', 'newer', 'still_old_yahoo',
  'skipped_cap', 'fetch_failed', 'reload_failed', 'legacy_clock', 'unknown_clock', 'no_quarter'].map(k => 'n_stale_quarter_' + k);

/** Validate positive integer age, retry and cap settings. @param {object} config Reload policy. */
function validateConfig(config) {
  for (const key of ['maxQuarterAgeDays', 'retryDays', 'maxPerRun']) {
    if (!config || !Number.isSafeInteger(config[key]) || config[key] <= 0) throw new Error('Invalid stale-quarter config: ' + key);
  }
  return config;
}
/** Bound standalone shard runs when no global plan is supplied.
 * @param {number} cap Run-wide limit. @param {?object} shard Zero-based index and count. */
function shardBudget(cap, shard) {
  if (!Number.isSafeInteger(cap) || cap <= 0) throw new Error('Invalid stale-quarter cap');
  if (!shard) return cap;
  if (!Number.isSafeInteger(shard.count) || shard.count <= 0 || !Number.isSafeInteger(shard.index)
    || shard.index < 0 || shard.index >= shard.count) throw new Error('Invalid stale-quarter shard');
  // Shards only own their snapshot cache. Fixed quotas cannot multiply the run cap.
  return Math.floor(cap / shard.count) + (shard.index < cap % shard.count ? 1 : 0);
}
function timestamp(value, now) {
  if (typeof value !== 'string') return null;
  const t = Date.parse(value);
  return Number.isFinite(t) && t <= now ? t : null;
}
/** Find the newest period with an actual reported quarterly value.
 * @param {object} snapshot Canonical snapshot. @param {number} now UTC epoch milliseconds. */
function latestReportedQuarter(snapshot, now = Date.now()) {
  const ts = snapshot && snapshot.timeseries || {};
  let latest = null;
  for (const [values, ends] of [['revenueQ', 'revenueQEnds'], ['grossProfitQ', 'grossProfitQEnds'],
    ['opIncQ', 'opIncQEnds'], ['netIncomeQ', 'revenueQEnds']]) {
    if (!Array.isArray(ts[values]) || !Array.isArray(ts[ends])) continue;
    ts[ends].forEach((end, i) => {
      if (typeof end !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return;
      const t = timestamp(end, now), raw = ts[values][i], v = raw && typeof raw === 'object' ? raw.value : raw;
      if (t != null && new Date(t).toISOString().slice(0, 10) === end && Number.isFinite(v)) latest = Math.max(latest ?? -Infinity, t);
    });
  }
  return latest == null ? null : new Date(latest).toISOString().slice(0, 10);
}
/** Prefer measured FTS success; label the conservative legacy full-pull proxy explicitly.
 * @param {object} snapshot Canonical snapshot. @param {?object} cache FTS cache envelope.
 * @param {number} now UTC epoch milliseconds; future timestamps are rejected. */
function fetchClock(snapshot, cache, now) {
  const meta = snapshot && snapshot.meta || {};
  const payload = cache && cache.payload || {};
  const known = [[meta.fundamentalsTimeseriesFetchedAt, meta.fundamentalsTimeseriesClockSource || 'fts'],
    [payload.quarterlyFetchedAt, payload.quarterlyClockSource || 'fts'],
    [cache && cache._cacheVersion === 2 && cache._ftsPartial === false ? cache.cachedAt : null, 'fts']]
    .map(([at, source]) => ({ at: timestamp(at, now), source })).filter(x => x.at != null).sort((a, b) => b.at - a.at);
  if (known.length) return { at: new Date(known[0].at).toISOString(), source: known[0].source };
  if (meta.fundamentalsTimeseriesClockSource === 'unknown') return { at: null, source: 'unknown' };
  // Migration only: old snapshots did not distinguish full pulls from FTS cache hits.
  // This conservative proxy can defer a legacy row, never reuse the daily price clock.
  for (const field of ['fundamentalsAsOf', 'fetchedAt']) {
    const t = timestamp(meta[field], now);
    if (t != null) return { at: new Date(t).toISOString(), source: 'legacy-full-proxy' };
  }
  return { at: null, source: 'unknown' };
}
/** Measure calendar-day age, independent of the run's time of day.
 * @param {string} end YYYY-MM-DD quarter end. @param {number} now UTC epoch milliseconds. */
function quarterAgeDays(end, now) {
  return (Date.parse(new Date(now).toISOString().slice(0, 10)) - Date.parse(end)) / DAY;
}
/** Order by best board rank, calendar evidence, oldest fetch, period and ticker.
 * @param {object} a Candidate. @param {object} b Candidate; serialized null rank means unranked. */
function compareCandidates(a, b) {
  return (a.rank ?? Infinity) - (b.rank ?? Infinity) || Number(b.reported) - Number(a.reported)
    || Date.parse(a.clock.at) - Date.parse(b.clock.at) || a.end.localeCompare(b.end) || a.ticker.localeCompare(b.ticker);
}
/** Reject stale, oversized, duplicate or foreign-shard-count global plans.
 * @param {object} selection Global plan. @param {object} config Reload policy.
 * @param {?object} shard Shard coordinates. @param {number} now UTC epoch milliseconds.
 * @param {string} runDate Frozen workflow date, including pulls that start after midnight. */
function validateSelection(selection, config, shard, now, runDate = new Date(now).toISOString().slice(0, 10)) {
  if (!Array.isArray(selection.selected) || selection.selected.some(t => typeof t !== 'string' || !t)
    || new Set(selection.selected).size !== selection.selected.length
    || selection.selected.length > config.maxPerRun || selection.maxPerRun !== config.maxPerRun
    || selection.shardCount !== (shard ? shard.count : 1)
    || selection.date !== runDate) throw new Error('Invalid stale-quarter global selection');
  return new Map(selection.selected.map((t, i) => [t, i]));
}
/** Read eligibility without modifying snapshots; recheck global choices against local data.
 * @param {object[]} stocks Watchlist rows. @param {object} options Paths, ranks, clock, policy, optional global plan and filesystem. */
function planReload(stocks, { snapshotDir, cacheDir, ranks = {}, calendar = {}, now = Date.now(), runDate, config, shard, selection, io = fs }) {
  validateConfig(config);
  let cap = shardBudget(config.maxPerRun, shard);
  const candidates = [], observations = new Map();
  const globalOrder = selection ? validateSelection(selection, config, shard, now, runDate) : null;
  const read = file => { if (!io.existsSync(file)) return null; return JSON.parse(io.readFileSync(file, 'utf8')); };
  let readErrors = 0, unknownClock = 0, noQuarter = 0;
  for (const ticker of new Set(stocks.map(s => s && s.ticker).filter(Boolean))) {
    let snapshot, cache;
    try { snapshot = read(path.join(snapshotDir, safeSnapshotFilename(ticker))); } catch (_) { readErrors++; continue; }
    try { cache = cacheDir ? read(path.join(cacheDir, safeSnapshotFilename(ticker))) : null; } catch (_) { readErrors++; }
    const end = latestReportedQuarter(snapshot, now), clock = fetchClock(snapshot, cache, now);
    observations.set(ticker, { end, clock });
    if (!end) { if (snapshot) noQuarter++; continue; }
    if (quarterAgeDays(end, now) <= config.maxQuarterAgeDays) continue;
    if (!clock.at) { unknownClock++; continue; }
    if (now - Date.parse(clock.at) < config.retryDays * DAY) continue;
    const rank = Number.isInteger(ranks[ticker]) && ranks[ticker] > 0 ? ranks[ticker] : Infinity;
    const event = timestamp(calendar[ticker] && calendar[ticker].date, now);
    candidates.push({ ticker, end, clock, rank, reported: event != null && event > Date.parse(clock.at) });
  }
  candidates.sort(compareCandidates);
  const selected = globalOrder ? candidates.filter(r => globalOrder.has(r.ticker))
    .sort((a, b) => globalOrder.get(a.ticker) - globalOrder.get(b.ticker)) : candidates.slice(0, cap);
  if (globalOrder) cap = stocks.filter(s => globalOrder.has(s.ticker)).length;
  return { cap, candidates, selected, observations, readErrors, unknownClock, noQuarter };
}
module.exports = { REASON, COUNTERS, validateConfig, shardBudget, latestReportedQuarter, fetchClock, quarterAgeDays,
  compareCandidates, validateSelection, planReload };
