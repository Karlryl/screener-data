#!/usr/bin/env node
/**
 * Tag 133j: Method-Drift Time-Series Aggregator
 * =============================================
 * Liest alle methods-history/YYYY-MM-DD.json und baut pro Methode eine
 * Zeitreihe von Pass-Counts auf. Frühwarn-Instrument für Yahoo-Data-Drift
 * und Method-Behavior-Anomalien:
 *   - Wenn pass-count einer Methode sprunghaft steigt → wahrscheinlich Bug
 *     oder Universe-Verschiebung. Wenn fällt → Threshold zu aggressiv.
 *
 * Output:
 *   outputs/method-drift.json — { methodId: [{date, passCount, computableCount, totalStocks}] }
 *   (Dashboard kann daraus inline-SVG-Sparklines rendern.)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const HIST_DIR = path.join(__dirname, '..', 'methods-history');
const OUT_PATH = path.join(__dirname, '..', 'outputs', 'method-drift.json');

function loadJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }

function main() {
  if (!fs.existsSync(HIST_DIR)) { console.log('No methods-history/ — exiting.'); return; }
  const files = fs.readdirSync(HIST_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  if (files.length === 0) { console.log('No methods-history files.'); return; }

  const perMethod = {};
  for (const fname of files) {
    const date = fname.replace('.json', '');
    const file = loadJson(path.join(HIST_DIR, fname));
    if (!file || !file.stocks) continue;
    const totalStocks = Object.keys(file.stocks).length;
    const counters = {};
    for (const [ticker, stockData] of Object.entries(file.stocks)) {
      if (!stockData || !stockData.results) continue;
      for (const [methodId, r] of Object.entries(stockData.results)) {
        if (!r) continue;
        counters[methodId] = counters[methodId] || { passCount: 0, computableCount: 0 };
        if (r.pass != null) counters[methodId].computableCount++;
        if (r.pass === true) counters[methodId].passCount++;
      }
    }
    for (const [methodId, c] of Object.entries(counters)) {
      perMethod[methodId] = perMethod[methodId] || [];
      perMethod[methodId].push({
        date,
        passCount: c.passCount,
        computableCount: c.computableCount,
        totalStocks
      });
    }
  }

  const outDir = path.dirname(OUT_PATH);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // Sort each method's series by date ascending
  for (const methodId of Object.keys(perMethod)) {
    perMethod[methodId].sort((a, b) => a.date.localeCompare(b.date));
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify({
    asOf: new Date().toISOString().slice(0, 10),
    vintageCount: files.length,
    methods: perMethod
  }, null, 2));

  // Companion HTML: one sparkline per method
  const htmlPath = path.join(outDir, 'method-drift.html');
  const today = new Date().toISOString().slice(0, 10);
  const sparkW = 120, sparkH = 28;
  const rows = Object.entries(perMethod)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([methodId, series]) => {
      if (!series.length) return '';
      const passVals = series.map(s => s.passCount);
      const minP = Math.min(...passVals), maxP = Math.max(...passVals);
      const range = maxP - minP || 1;
      const pts = passVals.map((v, i) => {
        const x = (i / Math.max(1, passVals.length - 1)) * sparkW;
        const y = sparkH - ((v - minP) / range) * sparkH;
        return x.toFixed(1) + ',' + y.toFixed(1);
      }).join(' ');
      const last = series[series.length - 1];
      const first = series[0];
      const direction = last.passCount > first.passCount ? '↑' : last.passCount < first.passCount ? '↓' : '·';
      const computablePct = last.computableCount && last.totalStocks
        ? Math.round(last.computableCount / last.totalStocks * 100) : 0;
      return `<tr>
  <td class="m">${methodId}</td>
  <td><svg width="${sparkW}" height="${sparkH}" viewBox="0 0 ${sparkW} ${sparkH}">
    <polyline points="${pts}" fill="none" stroke="#d4b878" stroke-width="1.5" stroke-linejoin="round"/>
  </svg></td>
  <td class="n">${last.passCount}</td>
  <td class="n">${first.passCount}</td>
  <td class="d">${direction} ${Math.abs(last.passCount - first.passCount)}</td>
  <td class="n">${computablePct}%</td>
</tr>`;
    }).join('\n');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Method Drift — ${today}</title>
<style>
body { background:#0f172a; color:#e2e8f0; font-family:ui-sans-serif,system-ui,sans-serif; padding:24px; max-width:1100px; margin:0 auto; }
h1 { font-size:22px; color:#f1f5f9; margin:0 0 6px; }
.sub { color:#94a3b8; font-size:13px; margin-bottom:24px; }
table { width:100%; border-collapse:collapse; font-size:13px; }
th { text-align:left; padding:8px; color:#94a3b8; font-weight:500; border-bottom:1px solid #334155; }
td { padding:8px; border-bottom:1px solid rgba(51,65,85,0.4); }
td.m { font-family: 'JetBrains Mono', monospace; color:#cbd5e1; }
td.n { font-family: 'JetBrains Mono', monospace; text-align:right; color:#e2e8f0; font-variant-numeric:tabular-nums; }
td.d { font-family: 'JetBrains Mono', monospace; color:#94a3b8; }
</style></head><body>
<h1>Method Drift — ${today}</h1>
<div class="sub">Pass-Count pro Methode über ${files.length} Vintage(s). Steile Bewegungen = Universe-Drift oder Method-Bug-Verdacht.</div>
<table>
  <thead><tr><th>Method</th><th>Trend</th><th>Last</th><th>First</th><th>Δ</th><th>Computable</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
</body></html>`;
  fs.writeFileSync(htmlPath, html);

  console.log('Method-drift written:');
  console.log('  ' + OUT_PATH);
  console.log('  ' + htmlPath);
  console.log('  methods: ' + Object.keys(perMethod).length + ' across ' + files.length + ' vintages');
}

if (require.main === module) {
  try { main(); } catch (e) { console.error('compute-method-drift failed: ' + e.message); process.exit(0); }
}

module.exports = { main };
