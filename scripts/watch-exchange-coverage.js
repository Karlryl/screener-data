#!/usr/bin/env node
/**
 * Task 0.8 watcher #1: per-exchange snapshot coverage.
 * ====================================================
 * Counts snapshots/*.json per meta.exchangeName, compares each exchange's
 * today-count against a rolling 14-entry median baseline stored in
 * data-health/exchange-coverage-baseline.json. ::error:: when:
 *   - an exchange's count drops >40% vs its own median, OR
 *   - an exchange that had >0 snapshots in-window drops to 0 today.
 *
 * Snapshots without meta.exchangeName (older vintages, ~13% of the corpus —
 * verified 2026-07-06) are grouped under '(unknown)' so they still count
 * towards catching a total pull collapse, without polluting real exchange
 * buckets. ponytail: no adapter/source field exists on watchlist stocks, so
 * per-exchange is the only grouping the real data supports.
 *
 * Baseline is written BEFORE the alarm/exit branch so an ongoing alarm still
 * refreshes the rolling window (per task spec).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { isMetadataSnapshot } = require('../lib/snapshot-fs.js');
const { writeJsonAtomic } = require('../lib/atomic-write.js');

const ROOT = path.join(__dirname, '..');
const SNAP_DIR = path.join(ROOT, 'snapshots');
const BASELINE_PATH = path.join(ROOT, 'data-health', 'exchange-coverage-baseline.json');
const WINDOW = 14;
const DROP_THRESHOLD = 0.40;
const BASELINE_SHAPE_ERROR = 'ERR_EXCHANGE_COVERAGE_BASELINE_SHAPE';

function loadJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; }
}

function baselineShapeError(detail) {
  const error = new Error(`Exchange-Coverage-Baseline ungueltig (${detail}) — Baseline wird NICHT ueberschrieben`);
  error.code = BASELINE_SHAPE_ERROR;
  return error;
}

function isPlainObject(value) {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function isCanonicalDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function validateBaseline(value) {
  if (!isPlainObject(value)) {
    throw baselineShapeError('Wurzel muss ein einfaches Objekt sein');
  }
  if (Object.prototype.hasOwnProperty.call(value, '_lastUpdated') && !isCanonicalDate(value._lastUpdated)) {
    throw baselineShapeError('_lastUpdated muss ein gueltiges Datum im Format YYYY-MM-DD sein');
  }
  for (const [exchange, history] of Object.entries(value)) {
    if (exchange.startsWith('_')) continue;
    if (!Array.isArray(history)) {
      throw baselineShapeError(`${exchange}: Historie muss ein Array sein`);
    }
    if (history.length > WINDOW) {
      throw baselineShapeError(`${exchange}: Historie enthaelt mehr als ${WINDOW} Werte`);
    }
    if (!history.every((count) => Number.isSafeInteger(count) && count >= 0)) {
      throw baselineShapeError(`${exchange}: Historie enthaelt ungueltige Zaehler`);
    }
  }
  return value;
}

function loadBaseline(p, readFileSync = fs.readFileSync) {
  let parsed;
  try { parsed = JSON.parse(readFileSync(p, 'utf8')); }
  catch (e) {
    if (e.code === 'ENOENT') return {};
    throw new Error(`Exchange-Coverage-Baseline nicht lesbar (${e.message}) — Baseline wird NICHT ueberschrieben`);
  }
  return validateBaseline(parsed);
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

function activeMedian(history) {
  const lastPositive = history.findLastIndex((v) => Number.isFinite(v) && v > 0);
  if (lastPositive < 0) return null;
  let firstPositive = lastPositive;
  while (firstPositive > 0 && Number.isFinite(history[firstPositive - 1]) && history[firstPositive - 1] > 0) firstPositive--;
  return median(history.slice(firstPositive, lastPositive + 1));
}

function countByExchange(snapDir) {
  const counts = {};
  if (!fs.existsSync(snapDir)) return counts;
  const files = fs.readdirSync(snapDir).filter((f) => f.endsWith('.json') && !isMetadataSnapshot(f));
  for (const f of files) {
    const s = loadJson(path.join(snapDir, f), null);
    const ex = (s && s.meta && s.meta.exchangeName) ? s.meta.exchangeName : '(unknown)';
    counts[ex] = (counts[ex] || 0) + 1;
  }
  return counts;
}

// BH-123: shared alarm predicate — same condition checkDrift alerts on, reused
// by updateBaseline() so an alarming count can be kept OUT of the rolling
// window (see there).
function isExchangeAlarming(todayCount, history) {
  if (history.length < WINDOW) return false; // still seeding — not enough history to judge
  // Nullwerte vor dem juengsten Lebenszeichen sind Seed-/Totzeiten, keine gesunde
  // Referenz. Nur die juengste zusammenhaengende positive Phase ist vergleichbar;
  // durchgehend tote Reihen bleiben damit bewusst still.
  const med = activeMedian(history);
  if (med === null || med <= 0) return false;
  if (todayCount === 0) return true;
  return (med - todayCount) / med > DROP_THRESHOLD;
}

function checkDrift(today, baseline) {
  const alerts = [];
  // '_'-prefixed keys (e.g. _lastUpdated) are metadata, not exchanges — same
  // leading-underscore convention as _manifest.json / _excluded.json elsewhere.
  const exchanges = new Set([...Object.keys(today), ...Object.keys(baseline)].filter((k) => !k.startsWith('_')));
  for (const ex of exchanges) {
    const todayCount = today[ex] || 0;
    const history = (baseline[ex] || []).filter(Number.isFinite);
    if (!isExchangeAlarming(todayCount, history)) continue;
    const med = activeMedian(history);
    if (todayCount === 0) {
      alerts.push(`${ex}: dropped to 0 (median ${med})`);
    } else {
      const drop = (med - todayCount) / med;
      alerts.push(`${ex}: ${todayCount} vs median ${med} (-${(drop * 100).toFixed(0)}%)`);
    }
  }
  return alerts;
}

// T2: a same-day rerun (retry, manual re-run) must not push a second entry for
// today into the rolling window — that double-counts today's count AND evicts
// one real prior day via slice(-WINDOW). `_lastUpdated` is a reserved top-level
// marker (ISO date of the last write) added to the baseline; old baseline files
// without it (current on-disk format: plain {"Shenzhen":[68,68,...], ...}) are
// backward-compatible — their first post-fix run has no marker to match, so it
// appends exactly like before and simply starts carrying the marker from then on.
// BH-123: an alarming count (median drop / drop-to-zero, same threshold as
// checkDrift) must NOT enter the rolling window — pushing it lets the median
// self-heal toward the corruption within ~WINDOW/2 runs (production: Shenzhen/
// Shanghai/Taiwan/... went silent after ~7 daily zeros). Freeze that exchange's
// history on alarm days so the healthy reference stays anchored until a human
// fixes the root cause and the count recovers.
// ponytail: freezing skips the same-day-rerun "replace last slot" logic for an
// exchange that alarmed on run 1 and recovers on a same-day rerun — the rerun
// then appends instead of replacing (one extra window slot for that day).
// Narrow edge case (alarm+recovery inside one run); the WINDOW slice still
// self-corrects within 14 days, not worth a per-exchange date ledger.
function updateBaseline(baseline, today, dateStr) {
  const sameDayRerun = baseline._lastUpdated != null && baseline._lastUpdated === dateStr;
  const next = { ...baseline };
  const exchanges = new Set([...Object.keys(baseline), ...Object.keys(today)].filter((k) => !k.startsWith('_')));
  for (const ex of exchanges) {
    const history = Array.isArray(baseline[ex]) ? baseline[ex].slice() : [];
    const todayCount = today[ex] || 0;
    if (isExchangeAlarming(todayCount, history.filter(Number.isFinite))) {
      next[ex] = history.slice(-WINDOW); // frozen — today's alarming count is not pushed
      continue;
    }
    if (sameDayRerun && history.length > 0) {
      history[history.length - 1] = todayCount; // replace today's already-recorded entry, not append
    } else {
      history.push(todayCount);
    }
    next[ex] = history.slice(-WINDOW);
  }
  next._lastUpdated = dateStr;
  return next;
}

function main(options = {}) {
  const baselinePath = options.baselinePath || BASELINE_PATH;
  const snapDir = options.snapDir || SNAP_DIR;
  const readFileSync = options.readFileSync || fs.readFileSync;
  const countByExchangeFn = options.countByExchange || countByExchange;
  const mkdirSync = options.mkdirSync || fs.mkdirSync;
  const writeBaseline = options.writeJsonAtomic || writeJsonAtomic;
  const log = options.log || console.log;
  const error = options.error || console.error;
  const setExitCode = options.setExitCode || ((code) => { process.exitCode = code; });

  // Validate persisted state before scanning snapshots or performing any write.
  // A malformed history must not silently look like an empty/healthy baseline.
  const baseline = loadBaseline(baselinePath, readFileSync);
  const today = countByExchangeFn(snapDir);

  log('Exchange coverage today: ' + JSON.stringify(today));

  const alerts = checkDrift(today, baseline);
  const dateStr = options.dateStr || process.env.RUN_DATE_UTC || new Date().toISOString().slice(0, 10); // frozen run-date (prep) mit Wall-Clock-Fallback — Codex-Gegenreview Tag 353
  const updated = validateBaseline(updateBaseline(baseline, today, dateStr));

  mkdirSync(path.dirname(baselinePath), { recursive: true });
  writeBaseline(baselinePath, updated);
  log('Baseline updated: ' + baselinePath);

  if (alerts.length > 0) {
    error('::error::Exchange coverage drop detected — ' + alerts.join('; '));
    setExitCode(1);
    return;
  }
  log('No exchange coverage drift.');
}

if (require.main === module) {
  try { main(); }
  catch (e) { console.error('::error::watch-exchange-coverage hat NICHT geprueft: ' + e.message); process.exitCode = 1; }
}

module.exports = {
  countByExchange,
  checkDrift,
  updateBaseline,
  median,
  activeMedian,
  isExchangeAlarming,
  loadBaseline,
  validateBaseline,
  main
};
