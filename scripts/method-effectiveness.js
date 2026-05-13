#!/usr/bin/env node
/**
 * Tag 133f: Method-Effectiveness Audit
 * ====================================
 * Beantwortet: Welche Methoden korrelieren tatsächlich mit Forward-Return?
 *
 * Für jede (date, method, ticker) Kombination aus methods-history/:
 *   - Schaue Forward-Return in prices/history.json bei +28d und +84d nach.
 *   - Trenne Stocks die pass=true vs pass=false zur Methode an dem Datum.
 *   - Berechne mediane Forward-Returns beider Gruppen.
 *   - Alpha = median(pass) - median(fail). Positiv = Methode war prediktiv.
 *
 * Output:
 *   outputs/method-effectiveness.json — { methodId: { passedN, failedN, alpha28d, alpha84d, sampleSize } }
 *   outputs/method-effectiveness.md  — Markdown-Ranking
 */
'use strict';
const fs = require('fs');
const path = require('path');
const WF = require('./walk-forward-perf.js');

const METHODS_HIST_DIR = path.join(__dirname, '..', 'methods-history');
const PRICES_PATH = path.join(__dirname, '..', 'prices', 'history.json');
const OUT_DIR = path.join(__dirname, '..', 'outputs');

const HORIZONS_DAYS = [28, 84]; // 4w / 12w forward look-up

function loadJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }

function listHistoryFiles() {
  if (!fs.existsSync(METHODS_HIST_DIR)) return [];
  return fs.readdirSync(METHODS_HIST_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
}

function median(values) {
  const sorted = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

function main() {
  const prices = loadJson(PRICES_PATH);
  if (!prices) { console.log('No prices/history.json — exiting.'); return; }
  const files = listHistoryFiles();
  if (files.length === 0) { console.log('No methods-history files — exiting.'); return; }

  const today = new Date().toISOString().slice(0, 10);
  // perMethod[methodId][horizonKey] = { passReturns: [], failReturns: [], n: 0 }
  const perMethod = {};

  for (const fname of files) {
    const file = loadJson(path.join(METHODS_HIST_DIR, fname));
    if (!file || !file.stocks) continue;
    const asOf = (file.date || fname.replace('.json', ''));

    for (const days of HORIZONS_DAYS) {
      const futureDate = WF.addDaysIso(asOf, days);
      if (futureDate > today) continue;
      const key = days + 'd';
      for (const [ticker, stockData] of Object.entries(file.stocks)) {
        if (!stockData || !stockData.results) continue;
        const p0 = WF.priceAt(prices, ticker, asOf);
        const p1 = WF.priceAt(prices, ticker, futureDate);
        const ret = WF.returnPct(p0, p1);
        if (ret == null) continue;
        for (const [methodId, r] of Object.entries(stockData.results)) {
          if (!r || r.pass == null) continue;
          perMethod[methodId] = perMethod[methodId] || {};
          perMethod[methodId][key] = perMethod[methodId][key] || { passReturns: [], failReturns: [] };
          if (r.pass) perMethod[methodId][key].passReturns.push(ret);
          else perMethod[methodId][key].failReturns.push(ret);
        }
      }
    }
  }

  // Build summary
  const out = {};
  for (const [methodId, horizons] of Object.entries(perMethod)) {
    out[methodId] = {};
    for (const days of HORIZONS_DAYS) {
      const key = days + 'd';
      const data = horizons[key];
      if (!data) { out[methodId][key] = null; continue; }
      const passMed = median(data.passReturns);
      const failMed = median(data.failReturns);
      const alpha = (passMed != null && failMed != null) ? passMed - failMed : null;
      out[methodId][key] = {
        passedN: data.passReturns.length,
        failedN: data.failReturns.length,
        medianReturnPass: passMed,
        medianReturnFail: failMed,
        alpha
      };
    }
  }

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const report = {
    asOf: today,
    horizonsDays: HORIZONS_DAYS,
    note: 'alpha = median(passing-stocks forward-return) - median(failing-stocks forward-return). Survivor-biased universe.',
    methods: out
  };
  fs.writeFileSync(path.join(OUT_DIR, 'method-effectiveness.json'), JSON.stringify(report, null, 2));

  // Ranked markdown
  let md = '# Method Effectiveness — ' + today + '\n\n';
  md += '_alpha = median forward-return of passing stocks minus failing stocks. Yahoo universe survivor-biased._\n\n';
  for (const days of HORIZONS_DAYS) {
    const key = days + 'd';
    md += '## ' + days + 'd forward (≥' + key + ' lookback)\n\n';
    md += '| Method | passN | failN | pass median ret | fail median ret | alpha |\n|---|---|---|---|---|---|\n';
    const rows = Object.entries(out)
      .map(([m, h]) => ({ method: m, h: h[key] }))
      .filter(r => r.h && r.h.alpha != null)
      .sort((a, b) => b.h.alpha - a.h.alpha);
    for (const r of rows) {
      const h = r.h;
      md += '| ' + r.method + ' | ' + h.passedN + ' | ' + h.failedN + ' | ' +
        (h.medianReturnPass != null ? h.medianReturnPass.toFixed(1) + '%' : '—') + ' | ' +
        (h.medianReturnFail != null ? h.medianReturnFail.toFixed(1) + '%' : '—') + ' | ' +
        (h.alpha >= 0 ? '+' : '') + h.alpha.toFixed(2) + 'pp |\n';
    }
    md += '\n';
  }
  fs.writeFileSync(path.join(OUT_DIR, 'method-effectiveness.md'), md);

  console.log('Method effectiveness:');
  console.log('  ' + path.join(OUT_DIR, 'method-effectiveness.json'));
  console.log('  ' + path.join(OUT_DIR, 'method-effectiveness.md'));
  console.log('  methods analyzed: ' + Object.keys(out).length);
}

module.exports = { median };

if (require.main === module) {
  try { main(); } catch (e) { console.error('method-effectiveness failed: ' + e.message); process.exit(0); }
}
