'use strict';

const SIZE_EXITS_FILE = '_manifest-size-exits.json';
const SIZE_EXIT_SHARD_PATTERN = /^_manifest-size-exits\.shard-(?:\d+|unsharded)\.run-(.+)\.json$/;

/**
 * Format a USD floor in billions without rounding away a fractional billion.
 * @param {number} floorUsd Nonnegative USD floor.
 * @param {boolean} german Whether to use the German decimal separator.
 * @returns {string} Billions without trailing zeroes.
 */
function formatSizeFloor(floorUsd, german = false) {
  if (!Number.isFinite(floorUsd) || floorUsd < 0) throw new TypeError('Invalid size floor');
  const text = String(floorUsd / 1e9);
  return german ? text.replace('.', ',') : text;
}

/**
 * Build one measured floor exit using the caller's existing pull timestamp.
 * @param {string} ticker Snapshot ticker.
 * @param {number} marketCapUsd Measured market capitalization in USD.
 * @param {number} floorUsd Applied USD floor.
 * @param {string} asOf Pull timestamp or ISO day, never a new clock reading.
 * @param {string} source Either price-only or full-pull.
 * @returns {object} Validated exit record with an ISO day.
 */
function buildSizeExit(ticker, marketCapUsd, floorUsd, asOf, source) {
  formatSizeFloor(floorUsd);
  const date = typeof asOf === 'string' ? asOf.slice(0, 10) : '';
  if (typeof ticker !== 'string' || !ticker.trim() || !Number.isFinite(marketCapUsd) ||
      marketCapUsd < 0 || marketCapUsd >= floorUsd ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date ||
      !['price-only', 'full-pull'].includes(source)) throw new TypeError('Invalid size exit');
  return { ticker, marketCapUsd, floorUsd, date, source };
}

/**
 * Merge shard lists by ticker; the last observation wins, with locale-free sorting.
 * @param {Array<Array<object>>} lists Shard record lists in deterministic file order.
 * @returns {Array<object>} Validated, deduplicated records sorted by ticker.
 */
function mergeSizeExits(lists) {
  const records = new Map();
  for (const list of lists) {
    if (!Array.isArray(list)) throw new TypeError('Size exits must be an array');
    for (const r of list) {
      if (!r || typeof r !== 'object') throw new TypeError('Invalid size exit');
      records.set(r.ticker, buildSizeExit(r.ticker, r.marketCapUsd, r.floorUsd, r.date, r.source));
    }
  }
  return [...records.values()].sort((a, b) => a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0);
}

/**
 * Describe the measured floor exit for the German export.
 * @param {object} record Validated size-exit record.
 * @returns {string} German reason with the applied floor and pull date.
 */
function sizeExitReasonDe(record) {
  const [year, month, day] = record.date.split('-');
  return `unter der Gr\u00f6\u00dfengrenze von ${formatSizeFloor(record.floorUsd, true)} Mrd. USD am ${day}.${month}.${year}`;
}

/**
 * Identify a workflow generation, including retries that share the same run ID.
 * @param {object} env Environment containing the standard GitHub run identifiers.
 * @returns {string|null} Shared generation tag, or null outside a workflow run.
 */
function sizeExitRunTag(env) {
  if (!env.GITHUB_RUN_ID) return null;
  const tag = `${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT || '1'}`;
  if (!/^\d+-\d+$/.test(tag)) throw new TypeError('Invalid size-exit run identity');
  return tag;
}

module.exports = { formatSizeFloor, buildSizeExit, mergeSizeExits, sizeExitReasonDe,
  sizeExitRunTag, SIZE_EXITS_FILE, SIZE_EXIT_SHARD_PATTERN };
