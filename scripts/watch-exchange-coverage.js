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
const { writeJsonAtomic } = require('../lib/atomic-write.js');

const ROOT = path.join(__dirname, '..');
const SNAP_DIR = path.join(ROOT, 'snapshots');
const BASELINE_PATH = path.join(ROOT, 'data-health', 'exchange-coverage-baseline.json');
const WINDOW = 14;
const DROP_THRESHOLD = 0.40;

function loadJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; }
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

function countByExchange(snapDir) {
  const counts = {};
  if (!fs.existsSync(snapDir)) return counts;
  const files = fs.readdirSync(snapDir).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
  for (const f of files) {
    const s = loadJson(path.join(snapDir, f), null);
    const ex = (s && s.meta && s.meta.exchangeName) ? s.meta.exchangeName : '(unknown)';
    counts[ex] = (counts[ex] || 0) + 1;
  }
  return counts;
}

function checkDrift(today, baseline) {
  const alerts = [];
  // '_'-prefixed keys (e.g. _lastUpdated) are metadata, not exchanges — same
  // leading-underscore convention as _manifest.json / _excluded.json elsewhere.
  const exchanges = new Set([...Object.keys(today), ...Object.keys(baseline)].filter((k) => !k.startsWith('_')));
  for (const ex of exchanges) {
    const todayCount = today[ex] || 0;
    const history = (baseline[ex] || []).filter(Number.isFinite);
    if (history.length < WINDOW) continue; // still seeding — not enough history to judge
    const med = median(history);
    if (med === null) continue;
    if (med > 0 && todayCount === 0) {
      alerts.push(`${ex}: dropped to 0 (median ${med})`);
      continue;
    }
    if (med > 0) {
      const drop = (med - todayCount) / med;
      if (drop > DROP_THRESHOLD) {
        alerts.push(`${ex}: ${todayCount} vs median ${med} (-${(drop * 100).toFixed(0)}%)`);
      }
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
function updateBaseline(baseline, today, dateStr) {
  const sameDayRerun = baseline._lastUpdated != null && baseline._lastUpdated === dateStr;
  const next = { ...baseline };
  const exchanges = new Set([...Object.keys(baseline), ...Object.keys(today)].filter((k) => !k.startsWith('_')));
  for (const ex of exchanges) {
    const history = Array.isArray(baseline[ex]) ? baseline[ex].slice() : [];
    if (sameDayRerun && history.length > 0) {
      history[history.length - 1] = today[ex] || 0; // replace today's already-recorded entry, not append
    } else {
      history.push(today[ex] || 0);
    }
    next[ex] = history.slice(-WINDOW);
  }
  next._lastUpdated = dateStr;
  return next;
}

function main() {
  const today = countByExchange(SNAP_DIR);
  const baseline = loadJson(BASELINE_PATH, {});

  console.log('Exchange coverage today: ' + JSON.stringify(today));

  const alerts = checkDrift(today, baseline);
  const dateStr = process.env.RUN_DATE_UTC || new Date().toISOString().slice(0, 10); // frozen run-date (prep) mit Wall-Clock-Fallback — Codex-Gegenreview Tag 353
  const updated = updateBaseline(baseline, today, dateStr);

  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
  writeJsonAtomic(BASELINE_PATH, updated);
  console.log('Baseline updated: ' + BASELINE_PATH);

  if (alerts.length > 0) {
    console.error('::error::Exchange coverage drop detected — ' + alerts.join('; '));
    process.exitCode = 1;
    return;
  }
  console.log('No exchange coverage drift.');
}

if (require.main === module) main();

module.exports = { countByExchange, checkDrift, updateBaseline, median };
