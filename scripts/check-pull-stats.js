#!/usr/bin/env node
/**
 * Tag 133g: Pull-Success Monitoring
 * =================================
 * Sammelt nach jedem Run-Ende die Erfolgs-Kennzahlen aller best-effort Pulls
 * (Yahoo, FX, Earnings, Historical-Prices) und vergleicht mit der trailing
 * 4-Run-Median. Discord-Alert wenn irgendeine Metrik >25% schlechter wird.
 *
 * Statt jedes Pull-Skript zu modifizieren liest dieser Reporter die bereits
 * existierenden Artefakte direkt aus:
 *   - snapshots/_manifest.json
 *   - fx-rates.json (rates count + failed array)
 *   - earnings-calendar.json (stocks-with-date count)
 *   - prices/history.json (tickers count)
 *   - watchlist.json (universe size)
 *
 * Output:
 *   outputs/pull-stats/YYYY-MM-DD.json  — heutiger Snapshot
 *   outputs/pull-stats/history.json     — kumulativ
 *   Discord-Alert bei Drift (außer ALLOW_PULL_DRIFT=1)
 */
'use strict';
const fs = require('fs');
const path = require('path');
// Tag 218: atomic output writes (audit F-218b-03)
const { writeFileAtomic } = require('../lib/atomic-write.js');
// Tag 219a (audit F-218b systemic): shared Discord helper. Previously this
// file carried a private fire-and-forget `https.request(...)` postDiscord
// that exhibited the same defect Tag 181 / F-SC-007 closed in
// pipeline-health-check.js — the process exited before the request resolved
// and the drift alert was silently dropped.
const { postDiscord } = require('../lib/discord.js');
// Tag 220c (audit F-219b-03 LOW): shared schema-aware watchlist loader.
// Without it, a rollback to a bare-array watchlist would silently set
// universeSize=null, disabling the drift detector forever.
const { loadWatchlist } = require('../lib/watchlist-fs.js');

const DRIFT_THRESHOLD = 0.25;
const MIN_HISTORY_RUNS = 4;
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'outputs', 'pull-stats');

function loadJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }
function median(values) {
  const sorted = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

function collectStats() {
  const today = new Date().toISOString().slice(0, 10);
  const stats = { asOf: today };

  // Yahoo pull
  const manifest = loadJson(path.join(ROOT, 'snapshots', '_manifest.json'));
  stats.yahooOk = manifest ? (manifest.n_ok || 0) : null;
  stats.yahooFailed = manifest ? (manifest.n_failed || 0) : null;
  stats.yahooTotal = manifest ? (manifest.n_total || 0) : null;
  stats.yahooSuccessRate = (stats.yahooTotal && stats.yahooOk != null)
    ? Math.round(stats.yahooOk / stats.yahooTotal * 1000) / 1000 : null;

  // FX
  const fx = loadJson(path.join(ROOT, 'fx-rates.json'));
  stats.fxRatesCount = fx && fx.rates ? Object.keys(fx.rates).length : null;
  stats.fxFailed = fx && fx.failed ? fx.failed.length : null;

  // Earnings
  const earnings = loadJson(path.join(ROOT, 'earnings-calendar.json'));
  stats.earningsWithDate = earnings ? Object.keys(earnings).length : null;

  // Historical prices
  const priceHist = loadJson(path.join(ROOT, 'prices', 'history.json'));
  stats.priceTickerCount = priceHist ? Object.keys(priceHist).length : null;

  // Universe
  // Tag 220c (audit F-219b-03): use shared schema-aware loader so all three
  // historical shapes (array / wrapped / bare-object) are recognised.
  const wl = loadWatchlist(path.join(ROOT, 'watchlist.json'));
  stats.universeSize = wl.shape === 'invalid' ? null : wl.size;

  // Snapshots dir count
  const snapDir = path.join(ROOT, 'snapshots');
  if (fs.existsSync(snapDir)) {
    stats.snapshotsCount = fs.readdirSync(snapDir).filter(f => f.endsWith('.json') && f !== '_manifest.json').length;
  } else {
    stats.snapshotsCount = null;
  }

  return stats;
}

function detectStatsDrift(today, history, threshold) {
  threshold = threshold == null ? DRIFT_THRESHOLD : threshold;
  if (!Array.isArray(history) || history.length < MIN_HISTORY_RUNS) return [];
  const alerts = [];
  const recent = history.slice(-MIN_HISTORY_RUNS);
  // Watch these metrics for downward drift only (loss of coverage)
  const watched = ['yahooOk', 'fxRatesCount', 'earningsWithDate', 'priceTickerCount', 'snapshotsCount'];
  for (const metric of watched) {
    const todayVal = today[metric];
    if (todayVal == null) continue;
    const priorVals = recent.map(r => r[metric]).filter(v => v != null && Number.isFinite(v));
    if (priorVals.length < MIN_HISTORY_RUNS) continue;
    const med = median(priorVals);
    if (med == null || med <= 0) continue;
    const drift = (todayVal - med) / med;
    if (drift < -threshold) {
      alerts.push({ metric, today: todayVal, median: med, drift: Math.round(drift * 1000) / 1000 });
    }
  }
  return alerts;
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const today = collectStats();

  const histPath = path.join(OUT_DIR, 'history.json');
  let history = loadJson(histPath) || [];
  if (!Array.isArray(history)) history = [];
  // Avoid duplicate entries for same date
  history = history.filter(h => h && h.asOf !== today.asOf);
  history.push(today);
  // Keep last 26 weeks
  history = history.slice(-26);
  writeFileAtomic(histPath, JSON.stringify(history, null, 2));

  writeFileAtomic(path.join(OUT_DIR, today.asOf + '.json'), JSON.stringify(today, null, 2));

  console.log('Pull-Stats ' + today.asOf + ':');
  for (const [k, v] of Object.entries(today)) {
    if (k !== 'asOf') console.log('  ' + k.padEnd(20) + ' = ' + v);
  }

  const alerts = detectStatsDrift(today, history.slice(0, -1), DRIFT_THRESHOLD);
  if (alerts.length === 0) {
    console.log('  no drift detected.');
    return 0;
  }
  console.log('  DRIFT DETECTED:');
  for (const a of alerts) {
    console.log(`    ${a.metric}: today=${a.today} vs median=${a.median} (${(a.drift*100).toFixed(0)}%)`);
  }
  if (process.env.ALLOW_PULL_DRIFT === '1') {
    console.log('  ALLOW_PULL_DRIFT=1 — not alerting.');
    return 0;
  }
  const msg = '⚠ Pull-Stats Drift (' + today.asOf + '): ' +
    alerts.map(a => `${a.metric} ${(a.drift*100).toFixed(0)}% (today=${a.today}, median=${a.median})`).join(', ');
  await postDiscord(msg);
  return 0; // never fail workflow; alert is enough
}

module.exports = { collectStats, detectStatsDrift, median };

if (require.main === module) {
  main().then(code => process.exit(code || 0)).catch(e => {
    console.error('check-pull-stats failed: ' + e.message);
    process.exit(0);
  });
}
