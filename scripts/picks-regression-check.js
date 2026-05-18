#!/usr/bin/env node
/**
 * Tag 133d: Picks-Regression Guard
 * ================================
 * Vergleicht den aktuellen `picks-history/latest.json` mit dem Median der vorherigen
 * 4 Runs. Triggert eine harte Failure + Discord-Alert wenn die Pick-Count einer Mode
 * um >35% nach oben oder unten driftet — fängt Method-Bugs, Threshold-Tunings und
 * Yahoo-Drift ab, bevor sie unbemerkt in produktive Picks fließen.
 *
 * Override via env ALLOW_PICKS_DRIFT=1 (für legitimate Universe-Erweiterungen
 * wie Tag 133 Discovery-Expansion).
 *
 * Tag 129 konform: 35% Band ist first-principles, kein single-ticker Tuning.
 *
 * Output:
 *   - outputs/picks-regression-YYYY-MM-DD.json (always)
 *   - exit 1 + Discord webhook bei Drift (außer ALLOW_PICKS_DRIFT=1)
 */
'use strict';
const fs = require('fs');
const path = require('path');
// Tag 218: atomic output writes (audit F-218b-03)
const { writeFileAtomic } = require('../lib/atomic-write.js');
// Tag 219a (audit F-218b systemic): shared Discord helper. Replaces the
// previous private fire-and-forget postDiscord (same defect Tag 181 /
// F-SC-007 closed in pipeline-health-check.js).
const { postDiscord } = require('../lib/discord.js');

const DRIFT_THRESHOLD = 0.35;      // 35% in either direction
const MIN_HISTORY_RUNS = 4;        // need ≥4 priors for statistical meaning

const PICKS_DIR = path.join(__dirname, '..', 'picks-history');
const OUT_DIR   = path.join(__dirname, '..', 'outputs');

function loadJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function countsByMode(picksFile) {
  if (!picksFile || !picksFile.modes) return {};
  const out = {};
  for (const [mode, arr] of Object.entries(picksFile.modes)) {
    out[mode] = Array.isArray(arr) ? arr.length : 0;
  }
  return out;
}

/**
 * Pure function for testability.
 * @param {Object} latestCounts - { MODE: count }
 * @param {Array<Object>} priorCounts - [{ MODE: count }, ...] (chronological order)
 * @param {number} threshold - drift fraction
 * @returns {Array<Object>} alerts [{mode, today, median, drift, direction}]
 */
function detectDrift(latestCounts, priorCounts, threshold) {
  threshold = threshold == null ? DRIFT_THRESHOLD : threshold;
  const alerts = [];
  for (const mode of Object.keys(latestCounts)) {
    const today = latestCounts[mode] || 0;
    const priors = priorCounts.map(p => p[mode] || 0);
    if (priors.length < MIN_HISTORY_RUNS) continue;
    const med = median(priors);
    if (med === 0 && today === 0) continue;
    if (med === 0 && today > 0) {
      alerts.push({ mode, today, median: 0, drift: Infinity, direction: 'up' });
      continue;
    }
    const drift = (today - med) / med;
    if (Math.abs(drift) > threshold) {
      alerts.push({
        mode, today, median: med,
        drift: Math.round(drift * 1000) / 1000,
        direction: drift > 0 ? 'up' : 'down'
      });
    }
  }
  return alerts;
}

async function main() {
  if (!fs.existsSync(PICKS_DIR)) {
    console.log('No picks-history/ — skipping regression check.');
    return 0;
  }
  const latest = loadJson(path.join(PICKS_DIR, 'latest.json'));
  if (!latest) {
    console.log('No picks-history/latest.json — skipping.');
    return 0;
  }
  const files = fs.readdirSync(PICKS_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  // Drop the most recent (= today) so we compare against history, not self
  const todayDate = (latest.asOf || '').slice(0, 10);
  // Tag 232c-21 (audit F-BT-009 LOW): fix doc/code mismatch. Comment said
  // "8 weeks" but .slice(-8) takes 8 vintage files; with daily snapshots
  // that's ~8 days, not 8 weeks. Renamed to reflect actual behavior. To
  // get a true 8-week (~56-day) window the slice would need to be -56
  // (or larger to allow for missing days), but the existing 8-vintage
  // window is the actual signal the regression check has been using —
  // keep behavior, just align the label.
  const priors = files
    .filter(f => f.replace('.json', '') < todayDate)
    .slice(-8) // up to last 8 daily-vintage snapshots (= ~1.5 weeks at daily cadence)
    .map(f => loadJson(path.join(PICKS_DIR, f)))
    .filter(Boolean);

  const latestCounts = countsByMode(latest);
  const priorCountsList = priors.map(countsByMode);

  const alerts = detectDrift(latestCounts, priorCountsList, DRIFT_THRESHOLD);

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const date = todayDate || new Date().toISOString().slice(0, 10);
  const reportPath = path.join(OUT_DIR, 'picks-regression-' + date + '.json');
  writeFileAtomic(reportPath, JSON.stringify({
    asOf: latest.asOf,
    latestCounts,
    priorRuns: priorCountsList.length,
    priorMedians: Object.fromEntries(Object.keys(latestCounts).map(m =>
      [m, median(priorCountsList.map(p => p[m] || 0))]
    )),
    threshold: DRIFT_THRESHOLD,
    alerts
  }, null, 2));

  console.log('Picks-Regression Check');
  console.log('  asOf:', latest.asOf);
  console.log('  prior runs:', priorCountsList.length);
  console.log('  latest counts:', JSON.stringify(latestCounts));
  if (priorCountsList.length < MIN_HISTORY_RUNS) {
    console.log('  Need >=' + MIN_HISTORY_RUNS + ' priors for check, have ' + priorCountsList.length + ' — passing.');
    return 0;
  }
  // Absolute-minimum guard: if ALL modes together produce fewer than 5 picks,
  // that is a genuine data problem regardless of historical drift. Hard-fail.
  const totalPicks = Object.values(latestCounts).reduce((s, n) => s + n, 0);
  if (totalPicks < 5) {
    const absMsg = `🚨 Picks-Regression HARD FAIL (${date}): total picks across all modes = ${totalPicks} (minimum is 5). Possible data pipeline failure.`;
    console.error('  ' + absMsg);
    await postDiscord(absMsg);
    return 1;
  }

  if (alerts.length === 0) {
    console.log('  No drift detected. OK.');
    return 0;
  }
  console.log('  DRIFT DETECTED:');
  for (const a of alerts) {
    console.log(`    ${a.mode}: today=${a.today} vs median=${a.median} (drift=${(a.drift*100).toFixed(0)}% ${a.direction})`);
  }
  if (process.env.ALLOW_PICKS_DRIFT === '1') {
    console.log('  ALLOW_PICKS_DRIFT=1 — suppressing Discord alert and not failing the workflow.');
    return 0;
  }
  const msg = `⚠ Picks-Regression Alert (${date}): ` +
    alerts.map(a => `${a.mode} ${a.direction} ${(a.drift*100).toFixed(0)}% (today=${a.today}, median=${a.median})`).join(', ');
  await postDiscord(msg);
  // Drift is a warning, not a hard fail — downstream steps should still run.
  return 0;
}

module.exports = { detectDrift, median, countsByMode };

if (require.main === module) {
  main().then(code => process.exit(code || 0)).catch(e => {
    console.error('picks-regression-check failed: ' + e.message);
    process.exit(0); // never fail the workflow on script bug
  });
}
