#!/usr/bin/env node
/**
 * Tag 229b: Walk-Forward Smoke Test for the Three New Methods
 * ============================================================
 * Methods under test:
 *   - asset-growth-anomaly (Cooper-Gulen-Schill 2008)
 *   - magic-formula (Greenblatt / Gray-Carlisle 2012)
 *   - penman-nissim-decomposition (Penman-Nissim 2003 RAS)
 *
 * All three were added on 2026-05-17, so NONE of the 7 existing methods-history
 * vintages (2026-05-08 … 2026-05-15) contains their pass/fail results.
 * Strategy: re-evaluate the three methods against TODAY's snapshots (these
 * fundamental ratios change slowly), but use the vintage date as the
 * forward-return anchor. This is a directional smoke test, not a rigorous
 * walk-forward — see audit report for caveats.
 *
 * Output:
 *   audit-reports/2026-05-17-tag229b-new-method-backtest.md (written by hand
 *   based on this script's stdout)
 *   outputs/tag229b-new-method-backtest.json (raw numbers)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SNAPSHOTS_DIR = path.join(ROOT, 'snapshots');
const HISTORY_DIR   = path.join(ROOT, 'methods-history');
const PRICES_PATH   = path.join(ROOT, 'prices', 'history.json');
const OUT_PATH      = path.join(ROOT, 'outputs', 'tag229b-new-method-backtest.json');

const FORWARD_DAYS = 5;          // 5-trading-day forward return (max horizon
                                  // given 7 vintages spanning 2026-05-08 to
                                  // 2026-05-15 and prices only available
                                  // through 2026-05-15).
const PRICE_MAX_STALE_DAYS = 7;

const METHODS = [
  { id: 'asset-growth-anomaly',         mod: require('../methods/asset-growth-anomaly.js') },
  { id: 'magic-formula',                mod: require('../methods/magic-formula.js') },
  { id: 'penman-nissim-decomposition',  mod: require('../methods/penman-nissim-decomposition.js') }
];

function loadJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}
function median(values) {
  const sorted = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}
function addDaysIso(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function buildPriceIndex(history) {
  const index = {};
  for (const [ticker, entries] of Object.entries(history)) {
    if (!Array.isArray(entries)) continue;
    index[ticker] = new Map(entries.map(e => [e.date, e.close]));
  }
  return index;
}
function nearestTradingDay(targetDate, priceMap) {
  if (!priceMap) return null;
  if (priceMap.has(targetDate)) return targetDate;
  for (let offset = 1; offset <= PRICE_MAX_STALE_DAYS; offset++) {
    const dFwd = new Date(targetDate + 'T00:00:00Z');
    dFwd.setUTCDate(dFwd.getUTCDate() + offset);
    const keyFwd = dFwd.toISOString().slice(0, 10);
    if (priceMap.has(keyFwd)) return keyFwd;
    const dBwd = new Date(targetDate + 'T00:00:00Z');
    dBwd.setUTCDate(dBwd.getUTCDate() - offset);
    const keyBwd = dBwd.toISOString().slice(0, 10);
    if (priceMap.has(keyBwd)) return keyBwd;
  }
  return null;
}
function returnPct(p0, p1) {
  if (!Number.isFinite(p0) || !Number.isFinite(p1) || p0 <= 0) return null;
  return (p1 - p0) / p0 * 100;
}
function forwardReturn(priceIndex, ticker, asOf, days) {
  const map = priceIndex[ticker];
  if (!map) return null;
  const entry = nearestTradingDay(asOf, map);
  const futureDateTarget = addDaysIso(asOf, days);
  const exit = nearestTradingDay(futureDateTarget, map);
  if (!entry || !exit) return null;
  return returnPct(map.get(entry), map.get(exit));
}

function listVintages() {
  return fs.readdirSync(HISTORY_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
}

function loadSnapshotsForTickers(tickers) {
  // Load each ticker's current snapshot once.  Returns map ticker -> stock.
  const out = {};
  let loaded = 0, missing = 0;
  for (const t of tickers) {
    const p = path.join(SNAPSHOTS_DIR, t + '.json');
    if (!fs.existsSync(p)) { missing++; continue; }
    try {
      out[t] = JSON.parse(fs.readFileSync(p, 'utf8'));
      loaded++;
    } catch (e) { missing++; }
  }
  return { snapshots: out, loaded, missing };
}

function main() {
  console.log('Tag 229b: walk-forward smoke test for 3 new methods');
  console.log('Forward horizon: ' + FORWARD_DAYS + ' calendar days (5d)');
  console.log('');

  const history = loadJson(PRICES_PATH);
  if (!history) { console.error('FATAL: no prices/history.json'); process.exit(0); }
  const priceIndex = buildPriceIndex(history);
  console.log('Price index built: ' + Object.keys(priceIndex).length + ' tickers');

  const vintages = listVintages();
  console.log('Vintages found: ' + vintages.length + ' (' + vintages[0] + ' .. ' + vintages[vintages.length-1] + ')');

  // Collect ALL tickers across vintages (will load each snapshot once).
  const allTickers = new Set();
  const vintageTickers = {};
  for (const fname of vintages) {
    const v = loadJson(path.join(HISTORY_DIR, fname));
    if (!v || !v.stocks) continue;
    const ts = Object.keys(v.stocks);
    vintageTickers[fname] = ts;
    for (const t of ts) allTickers.add(t);
  }
  console.log('Unique tickers across all vintages: ' + allTickers.size);

  // Load current snapshots for all tickers (once).
  console.log('Loading snapshots...');
  const { snapshots, loaded, missing } = loadSnapshotsForTickers(Array.from(allTickers));
  console.log('  loaded: ' + loaded + '  missing-snapshot: ' + missing);

  // Pre-evaluate each ticker × method ONCE (today's fundamentals, applied
  // to every vintage date because fundamentals are slow-moving).
  const evals = {}; // ticker -> { methodId -> { computable, pass } }
  for (const [t, stock] of Object.entries(snapshots)) {
    evals[t] = {};
    for (const m of METHODS) {
      try {
        const r = m.mod.evaluate(stock);
        evals[t][m.id] = { computable: !!r.computable, pass: !!r.pass };
      } catch (e) {
        evals[t][m.id] = { computable: false, pass: false };
      }
    }
  }

  // For each method × vintage, partition vintage tickers into PASS / FAIL
  // (using today's pass flag) and compute median 5d-forward-return from
  // vintage date.  Aggregate across vintages.
  const results = {};
  for (const m of METHODS) {
    results[m.id] = { perVintage: [], totals: { passReturns: [], failReturns: [] } };
  }

  for (const fname of vintages) {
    const asOf = fname.replace(/\.json$/, '');
    const futureDate = addDaysIso(asOf, FORWARD_DAYS);
    const today = new Date().toISOString().slice(0, 10);
    // Skip if future date exceeds available price data.  We'll still try the
    // lookup — nearestTradingDay returns null if no price within ±7 days.
    const tickers = vintageTickers[fname] || [];

    for (const m of METHODS) {
      const passRets = [], failRets = [];
      let nComp = 0, nPass = 0, nFail = 0;
      for (const t of tickers) {
        const e = evals[t] && evals[t][m.id];
        if (!e || !e.computable) continue;
        nComp++;
        const ret = forwardReturn(priceIndex, t, asOf, FORWARD_DAYS);
        if (ret == null) continue;
        if (e.pass) { passRets.push(ret); nPass++; }
        else        { failRets.push(ret); nFail++; }
      }
      const medP = median(passRets);
      const medF = median(failRets);
      const spread = (medP != null && medF != null) ? (medP - medF) : null;
      results[m.id].perVintage.push({
        asOf, futureDate,
        nComputable: nComp,
        nPassEvaluated: nPass,
        nFailEvaluated: nFail,
        medianPassRet: medP,
        medianFailRet: medF,
        spreadPp: spread
      });
      // Aggregate
      results[m.id].totals.passReturns.push(...passRets);
      results[m.id].totals.failReturns.push(...failRets);
    }
  }

  // Compute aggregate (pooled) medians.
  for (const m of METHODS) {
    const passR = results[m.id].totals.passReturns;
    const failR = results[m.id].totals.failReturns;
    const medP = median(passR), medF = median(failR);
    results[m.id].pooled = {
      nPassObservations: passR.length,
      nFailObservations: failR.length,
      medianPassRet: medP,
      medianFailRet: medF,
      spreadPp: (medP != null && medF != null) ? (medP - medF) : null
    };
    // Drop raw arrays from output (keep JSON small)
    delete results[m.id].totals;
  }

  // Print human-readable table per method
  for (const m of METHODS) {
    console.log('');
    console.log('### ' + m.id);
    console.log('| vintage | n_computable | n_pass | n_fail | med_pass_5d | med_fail_5d | spread_pp |');
    console.log('|---|---|---|---|---|---|---|');
    for (const r of results[m.id].perVintage) {
      const fmt = v => v != null ? (v >= 0 ? '+' : '') + v.toFixed(2) : '—';
      console.log(`| ${r.asOf} | ${r.nComputable} | ${r.nPassEvaluated} | ${r.nFailEvaluated} | ${fmt(r.medianPassRet)} | ${fmt(r.medianFailRet)} | ${fmt(r.spreadPp)} |`);
    }
    const p = results[m.id].pooled;
    const fmt = v => v != null ? (v >= 0 ? '+' : '') + v.toFixed(2) : '—';
    console.log(`| **POOLED** | — | ${p.nPassObservations} | ${p.nFailObservations} | ${fmt(p.medianPassRet)} | ${fmt(p.medianFailRet)} | ${fmt(p.spreadPp)} |`);
    // Directional? For asset-growth-anomaly and magic-formula and penman-nissim,
    // the academic claim is "PASS = good = higher forward return". So spread > 0
    // is directionally-correct.
    const dir = p.spreadPp == null ? 'inconclusive' : (p.spreadPp > 0 ? 'YES (PASS beats FAIL)' : 'NO (PASS underperforms)');
    console.log('Directional (PASS > FAIL forward return)? ' + dir);
  }

  if (!fs.existsSync(path.dirname(OUT_PATH))) fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify({
    asOf: new Date().toISOString().slice(0, 10),
    forwardDays: FORWARD_DAYS,
    nVintages: vintages.length,
    methods: results
  }, null, 2));
  console.log('');
  console.log('Wrote ' + OUT_PATH);
}

if (require.main === module) main();
