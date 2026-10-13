'use strict';

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('./atomic-write.js');
const SIZE_EXITS_FILE = '_manifest-size-exits.json';
const SIZE_EXITS_HISTORY_FILE = 'state/size-exits-history.json';
const SIZE_EXIT_SHARD_PATTERN = /^_manifest-size-exits\.shard-(?:\d+|unsharded)\.run-(.+)\.json$/;
const DAY_MS = 86400000;

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

/**
 * Union all shard reports of this run up to the current attempt. A partial rerun raises
 * GITHUB_RUN_ATTEMPT while the artifacts of shards that already succeeded stay at the earlier
 * attempt; those reports are still true for today's pull and must not be dropped.
 * Rerunning the same shard starts from a cache whose exited snapshot is already deleted;
 * its empty report must not hide the exit recorded by the first attempt.
 * @param {string[]} files Basenames found in the shard download folder.
 * @param {object} env Environment containing the standard GitHub run identifiers.
 * @returns {string[]} Basenames ordered by shard, then numeric attempt; empty without a run ID.
 */
function currentRunReports(files, env) {
  const tag = sizeExitRunTag(env);
  if (!tag) return [];
  const [runId, attempt] = tag.split('-');
  const reports = [];
  for (const f of files) {
    const m = f.match(/^_manifest-size-exits\.shard-(\d+|unsharded)\.run-(\d+)-(\d+)\.json$/);
    if (!m || m[2] !== runId || Number(m[3]) > Number(attempt)) continue;
    reports.push({ file: f, shard: m[1], attempt: Number(m[3]) });
  }
  return reports.sort((a, b) => a.shard < b.shard ? -1 : a.shard > b.shard ? 1 : a.attempt - b.attempt).map(r => r.file);
}

/**
 * Use the workflow day, or one injectable UTC clock reading outside the workflow.
 * @param {object} env Environment with an optional RUN_DATE_UTC.
 * @param {Function} clock Clock returning milliseconds since the epoch.
 * @returns {string} ISO reference day.
 */
function sizeExitRunDay(env = {}, clock = Date.now) {
  return /^\d{4}-\d{2}-\d{2}$/.test(env.RUN_DATE_UTC || '') ? env.RUN_DATE_UTC : new Date(clock()).toISOString().slice(0, 10);
}

function isIsoDay(day) {
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
}

function validateExitRecords(exits) {
  if (!Array.isArray(exits)) throw new TypeError('Size exits must be an array');
  return exits.map(r => {
    if (!r || typeof r !== 'object' || Object.keys(r).length !== 5 || !isIsoDay(r.date)) throw new TypeError('Invalid size exit record');
    return buildSizeExit(r.ticker, r.marketCapUsd, r.floorUsd, r.date, r.source);
  });
}

/**
 * Resolve the optional history argument; the default belongs to this module's repository.
 * @param {string[]} argv Merge command arguments.
 * @returns {string} Absolute history path, independent of cwd for the production default.
 */
function sizeExitsHistoryPath(argv = []) {
  const i = argv.indexOf('--size-exits-history');
  if (i < 0) return path.resolve(__dirname, '..', SIZE_EXITS_HISTORY_FILE);
  if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new TypeError('Missing --size-exits-history path');
  return path.resolve(argv[i + 1]);
}

/**
 * Read validated history without hiding corruption or access errors.
 * @param {string} historyPath History file, defaulting to the module's repository.
 * @param {object} io Injectable filesystem.
 * @returns {object} Validated exits and original bytes as text, or null text on ENOENT.
 */
function readSizeExitHistory(historyPath = sizeExitsHistoryPath(), io = fs) {
  let raw;
  try { raw = io.readFileSync(historyPath, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return { exits: [], raw: null }; throw e; }
  const history = JSON.parse(raw);
  if (!history || history.schema !== 'size-exits-history/v1') throw new TypeError('Invalid size-exits-history/v1 history');
  return { exits: validateExitRecords(history.exits), raw };
}

/**
 * Retain the latest dated exit per ticker, with today's observation winning equal dates.
 * @param {object[]} history Previously recorded exits.
 * @param {object[]} today Current run exits.
 * @param {string} runDate Reference ISO day for the inclusive 90-day cap.
 * @returns {object[]} Validated records ordered by date and then ticker.
 */
function mergeSizeExitHistory(history, today, runDate) {
  if (!isIsoDay(runDate)) throw new TypeError('Invalid size-exit run day');
  const records = new Map();
  for (const r of validateExitRecords([...history, ...today])) {
    const previous = records.get(r.ticker);
    if (!previous || r.date >= previous.date) records.set(r.ticker, r);
  }
  return [...records.values()].filter(r => Date.parse(runDate) - Date.parse(r.date) <= 90 * DAY_MS)
    .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0);
}

/**
 * Merge and atomically persist history only when its deterministic bytes change.
 * @param {object[]} today Current run exits.
 * @param {string} runDate Reference ISO day.
 * @param {object} options Injectable historyPath, fs and writeFileAtomic.
 * @returns {object[]} The retained history for the artifact manifest.
 */
function updateSizeExitHistory(today, runDate, options = {}) {
  const historyPath = options.historyPath || sizeExitsHistoryPath();
  const io = options.fs || fs;
  const previous = readSizeExitHistory(historyPath, io);
  const exits = mergeSizeExitHistory(previous.exits, today, runDate);
  const raw = JSON.stringify({ schema: 'size-exits-history/v1', exits });
  if (raw !== previous.raw) {
    io.mkdirSync(path.dirname(historyPath), { recursive: true });
    (options.writeFileAtomic || writeFileAtomic)(historyPath, raw);
  }
  return exits;
}

/**
 * Validate the artifact contract; legacy arrays cannot masquerade as known reports.
 * @param {object} manifest Parsed artifact manifest.
 * @returns {object} Validated v2 manifest with normalized exit records.
 */
function validateSizeExitManifest(manifest) {
  if (!manifest || Array.isArray(manifest) || manifest.schema !== 'size-exits/v2' ||
      typeof manifest.known !== 'boolean' || !isIsoDay(manifest.runDate) || !Array.isArray(manifest.exits)) {
    throw new TypeError('Invalid size-exits/v2 manifest: expected object with schema, known, runDate and exits array');
  }
  return { schema: manifest.schema, known: manifest.known, runDate: manifest.runDate, exits: validateExitRecords(manifest.exits) };
}

/**
 * Remove only stale shard reports, isolating failures so the pull can continue.
 * @param {string} outputDir Shard cache directory.
 * @param {string} currentReport Report path reserved for the current pull.
 * @param {object} options Injectable fs, clock and warn callback.
 * @returns {string[]} Successfully removed report basenames.
 */
function pruneSizeExitReports(outputDir, currentReport, options = {}) {
  const io = options.fs || fs, warn = options.warn || console.warn;
  const cutoff = (options.clock || Date.now)() - 7 * DAY_MS;
  const removed = [];
  let files;
  try { files = io.readdirSync(outputDir); }
  catch (e) { warn(`[size-exits] ${outputDir}: ${e.message}`); return removed; }
  for (const file of files) {
    const filePath = path.join(outputDir, file);
    if (!SIZE_EXIT_SHARD_PATTERN.test(file) || path.resolve(filePath) === path.resolve(currentReport)) continue;
    try {
      const stat = io.statSync(filePath);
      if (!stat.isFile() || !(stat.mtimeMs < cutoff)) continue;
      io.unlinkSync(filePath);
      removed.push(file);
    } catch (e) { warn(`[size-exits] ${file}: ${e.message}`); }
  }
  return removed;
}

module.exports = { formatSizeFloor, buildSizeExit, mergeSizeExits, sizeExitReasonDe,
  sizeExitRunTag, currentRunReports, sizeExitRunDay, sizeExitsHistoryPath, readSizeExitHistory,
  mergeSizeExitHistory, updateSizeExitHistory, validateSizeExitManifest, pruneSizeExitReports,
  SIZE_EXITS_FILE, SIZE_EXITS_HISTORY_FILE, SIZE_EXIT_SHARD_PATTERN };
