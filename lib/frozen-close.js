'use strict';
/**
 * lib/frozen-close.js — S11 Stufe 4 (22.11.2026): a frozen OTC close behind shown price values.
 *
 * WHY: the quality sample of 22.11. found the market cap of TOKSF (Tokyo Steel on the OTC) 14.7 % too low. Yahoo stamps
 * the OTC quote with a current time (regularMarketTime 19.11.2026), so the stale-quote gate of lib/market-cap-guard.js
 * never fires, but the price is the last OTC trade of 05.05.2026 (USD 9.106) carried forward day after day. The price
 * store (prices/history) shows it: the same close on every trading day.
 *
 * RULE: an OTC line (meta.exchangeName names OTC) whose newest FROZEN_CLOSE_DAYS stored daily closes are identical and
 * equal the snapshot's own quote price has no current market price. scripts/write-filter-universe.js then withholds every
 * shown value that rests on that price (market cap, P/S, EV/Sales, P/E, Forward P/E, dividend yield, distance to the
 * 52-week high) with one German reason that names them, with or without a market cap. Measured on the replay of
 * 21.11.2026: 495 of 15,769 rows, 457 of them with a market cap (of 14,393 shown) and 38 without one that still showed
 * d52, dividend yield or P/E. Where a home listing of the same name exists, 77 % of the market caps were more than 5 % off
 * its market cap (control: 18 % of traded OTC lines). Primary listings with an unmoving price (trading halts) are not covered.
 * ponytail: equal closes stand in for "no trade" because the store keeps no volume; a line that really trades at one
 * price for 20 days is withheld too (no such case known). Volume in the store would make it exact.
 */
const fs = require('node:fs');
const store = require('./price-history-store.js');

/** Identical newest stored closes needed before the price counts as frozen (four weeks of trading days). */
const FROZEN_CLOSE_DAYS = 20;
// The same quote message within float32 rounding: the store keeps 9.105999946594238 where the quote says 9.106.
const SAME_PRICE_REL = 1e-6;
/** End of every frozen-close reason (singular and plural alike); scripts/feed-fill-guard.js recognises the reason by it. */
const FROZEN_CLOSE_RETURN = 'von selbst zurück, sobald sich der Kurs wieder ändert.';
/** Feed fields that rest on the quote price, with the label the reason names them by (order = reading order). */
const FROZEN_LABELS = Object.freeze({ mc: 'Börsenwert', ps: 'P/S', evs: 'EV/Sales', pe: 'P/E', fpe: 'Forward P/E',
  dy: 'Dividendenrendite', d52: 'Abstand zum 52-Wochen-Hoch' });

/**
 * Whether a snapshot's listing trades on an OTC market (OTC Markets OTCPK, OTCQB, OTCQX, OTCID).
 * @param {object} meta Snapshot meta.
 * @returns {boolean} True for an OTC line.
 */
const isOtc = meta =>/\bOTC\b/.test(meta?.exchangeName || '');
const germanDate = iso => iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4);

/**
 * Trailing run of identical closes of one stored series, when it reaches the limit and the quote price is that close.
 * @param {Array<{date: string, close: number}>} series Stored daily closes, oldest first.
 * @param {number} price The snapshot's quote price (price.regularMarketPrice), same currency as the store.
 * @param {number} [limit] Identical closes needed.
 * @returns {{since: string, days: number}|null} First day of the run and its length, or null when not frozen.
 */
function frozenRun(series, price, limit = FROZEN_CLOSE_DAYS) {
  if (!Array.isArray(series) || series.length < limit || !(price > 0)) return null;
  const last = series[series.length - 1]?.close;
  if (!(last > 0) || Math.abs(price / last - 1) > SAME_PRICE_REL) return null;
  let i = series.length - 1;
  while (i > 0 && series[i - 1]?.close === last) i--;
  const days = series.length - i;
  return days >= limit && typeof series[i].date === 'string' ? { since: series[i].date.slice(0, 10), days } : null;
}

/**
 * Frozen OTC closes of the given snapshots, read shard by shard (one shard in memory at a time, not the whole store).
 * @param {string} pricesDir Price store root (the folder that holds history/).
 * @param {object[]} snapshots Prepared snapshots.
 * @returns {Map<string, {since: string, days: number}>} Ticker to its frozen run.
 * @throws {Error} The store has no metadata stamp (no store at all), a wanted shard is missing (partial store), or a shard is corrupt.
 */
function loadFrozenRuns(pricesDir, snapshots) {
  // Fail-closed: without the store nothing could be judged, and an unchecked frozen price would be shown.
  if (!store.loadMeta(pricesDir)) throw new Error('Price store missing: ' + pricesDir);
  // No market-cap condition: a row without a market cap can still show P/E, dividend yield or d52 on the frozen price.
  const wanted = new Map();
  for (const s of snapshots) {
    const ticker = s?.meta?.ticker;
    if (!ticker || !isOtc(s.meta)) continue;
    const shard = store.shardOf(ticker);
    if (!wanted.has(shard)) wanted.set(shard, []);
    wanted.get(shard).push(s);
  }
  const runs = new Map();
  for (const [shard, list] of wanted) {
    // store.loadShard returns {} for a missing file; with the metadata stamped that is a partial store (as in store.loadAll).
    if (!fs.existsSync(store.shardPath(pricesDir, shard))) {
      throw new Error('Price store partial: ' + store.shardFilename(shard) + ' missing beside _meta.json in ' + pricesDir);
    }
    const series = store.loadShard(pricesDir, shard);
    for (const s of list) {
      const run = frozenRun(series[s.meta.ticker], s.price?.regularMarketPrice);
      if (run) runs.set(s.meta.ticker, run);
    }
  }
  return runs;
}

/**
 * The one German reason for the withheld fields of a row.
 * @param {string[]} fields Feed keys that were withheld (keys of FROZEN_LABELS).
 * @param {{since: string, days: number}} run Frozen run.
 * @returns {string} Reason ending with FROZEN_CLOSE_RETURN.
 */
function frozenReason(fields, run) {
  const labels = fields.map(f => FROZEN_LABELS[f]);
  const list = labels.length > 1 ? labels.slice(0, -1).join(', ') + ' und ' + labels[labels.length - 1] : labels[0];
  const many = labels.length > 1;
  // "mindestens seit": a gap in the store can hide the real last trade, so the run's first day is a lower bound.
  return `${list} ${many ? 'werden' : 'wird'} nicht gezeigt, weil der Schlusskurs dieser OTC-Notierung mindestens seit dem ` +
    `${germanDate(run.since)} unverändert ist (${run.days} Handelstage). Ein so lange unveränderter Kurs ist kein aktueller ` +
    `Marktpreis. ${many ? 'Die Werte kommen' : 'Der Wert kommt'} ${FROZEN_CLOSE_RETURN}`;
}

/**
 * Feed keys a frozen-close reason names; [] for any other text.
 * @param {string} reason One aus entry.
 * @returns {string[]} Keys of FROZEN_LABELS.
 */
function frozenFields(reason) {
  if (typeof reason !== 'string' || !reason.endsWith(FROZEN_CLOSE_RETURN)) return [];
  const end = reason.search(/ (?:wird|werden) nicht gezeigt, weil der Schlusskurs dieser OTC-Notierung /);
  if (end < 1) return [];
  const named = reason.slice(0, end).split(/, | und /);
  return Object.keys(FROZEN_LABELS).filter(key => named.includes(FROZEN_LABELS[key]));
}

module.exports = { FROZEN_CLOSE_DAYS, FROZEN_CLOSE_RETURN, FROZEN_LABELS, isOtc, frozenRun, loadFrozenRuns, frozenReason, frozenFields };
