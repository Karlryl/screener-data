#!/usr/bin/env node
/**
 * Tag 133e: Walk-Forward Performance Scorer
 * =========================================
 * Iteriert über alle `picks-history/YYYY-MM-DD.json` Vintages und berechnet
 * die mediane Forward-Return jeder Vintage gegen die Mediane des gesamten
 * Universums im gleichen Fenster — das "interne Alpha" der Modi.
 *
 * Benchmark-Wahl: median-of-universe (statt SPY). Begründung:
 *   - keine Abhängigkeit von SPY-Verfügbarkeit in prices/history.json
 *   - global-konsistent (universe ist nicht US-only)
 *   - per Tag 102 OOS-Mentalität: das Universum ist der Benchmark.
 *
 * Output:
 *   outputs/walk-forward.json  — Daten für Dashboard
 *   outputs/walk-forward.md    — Lesefreundliche Tabelle
 */
'use strict';
const fs = require('fs');
const path = require('path');

const PICKS_DIR = path.join(__dirname, '..', 'picks-history');
const PRICES_PATH = path.join(__dirname, '..', 'prices', 'history.json');
const OUT_DIR = path.join(__dirname, '..', 'outputs');

const HORIZONS_DAYS = [7, 28, 84]; // 1w / 4w / 12w

function loadJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

function median(values) {
  const sorted = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

function priceAt(history, ticker, targetDate) {
  const series = history[ticker];
  if (!Array.isArray(series) || series.length === 0) return null;
  // series sorted by date ascending; find last entry on/before targetDate
  let chosen = null;
  for (const entry of series) {
    if (!entry || !entry.date) continue;
    if (entry.date > targetDate) break;
    chosen = entry;
  }
  return chosen ? chosen.close : null;
}

function returnPct(p0, p1) {
  if (!Number.isFinite(p0) || !Number.isFinite(p1) || p0 <= 0) return null;
  return (p1 - p0) / p0 * 100;
}

function addDaysIso(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function listVintages() {
  if (!fs.existsSync(PICKS_DIR)) return [];
  return fs.readdirSync(PICKS_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
}

function computeUniverseMedianReturn(history, asOfDate, horizonDays) {
  const futureDate = addDaysIso(asOfDate, horizonDays);
  const returns = [];
  for (const ticker of Object.keys(history)) {
    const p0 = priceAt(history, ticker, asOfDate);
    const p1 = priceAt(history, ticker, futureDate);
    const r = returnPct(p0, p1);
    if (r != null) returns.push(r);
  }
  return median(returns);
}

function evaluateVintage(picksFile, history) {
  const asOf = (picksFile.asOf || '').slice(0, 10);
  if (!asOf) return null;
  const today = new Date().toISOString().slice(0, 10);
  const out = { asOf, modes: {} };

  for (const [mode, picks] of Object.entries(picksFile.modes || {})) {
    if (!Array.isArray(picks)) continue;
    const horizonResults = {};
    for (const days of HORIZONS_DAYS) {
      const futureDate = addDaysIso(asOf, days);
      if (futureDate > today) {
        horizonResults[days + 'd'] = { status: 'too-early', n: 0 };
        continue;
      }
      const pickReturns = [];
      for (const p of picks) {
        const t = p.ticker;
        const p0 = priceAt(history, t, asOf);
        const p1 = priceAt(history, t, futureDate);
        const r = returnPct(p0, p1);
        if (r != null) pickReturns.push(r);
      }
      const universeMed = computeUniverseMedianReturn(history, asOf, days);
      const pickMed = median(pickReturns);
      horizonResults[days + 'd'] = {
        status: 'ok',
        n: pickReturns.length,
        coverage: picks.length > 0 ? Math.round(pickReturns.length / picks.length * 100) / 100 : 0,
        pickMedianReturn: pickMed,
        universeMedianReturn: universeMed,
        alpha: (pickMed != null && universeMed != null) ? pickMed - universeMed : null
      };
    }
    out.modes[mode] = { n: picks.length, horizons: horizonResults };
  }
  return out;
}

function main() {
  const history = loadJson(PRICES_PATH);
  if (!history || typeof history !== 'object') {
    console.log('No prices/history.json — cannot compute walk-forward.');
    return;
  }
  const vintages = listVintages();
  if (vintages.length === 0) {
    console.log('No picks-history vintages.');
    return;
  }
  const evaluations = [];
  for (const fname of vintages) {
    const picks = loadJson(path.join(PICKS_DIR, fname));
    if (!picks) continue;
    const ev = evaluateVintage(picks, history);
    if (ev) evaluations.push(ev);
  }

  // Aggregate per-mode across vintages
  const modes = {};
  for (const ev of evaluations) {
    for (const [mode, modeData] of Object.entries(ev.modes)) {
      modes[mode] = modes[mode] || { vintages: [], summary: {} };
      modes[mode].vintages.push({
        asOf: ev.asOf,
        n: modeData.n,
        horizons: modeData.horizons
      });
    }
  }
  // Summary: median alpha per horizon across vintages
  for (const [mode, data] of Object.entries(modes)) {
    for (const days of HORIZONS_DAYS) {
      const key = days + 'd';
      const alphas = data.vintages
        .map(v => v.horizons[key] && v.horizons[key].alpha)
        .filter(a => a != null && Number.isFinite(a));
      const ns = data.vintages.map(v => v.horizons[key] && v.horizons[key].n).filter(n => n != null);
      data.summary[key] = {
        vintageCount: alphas.length,
        medianAlpha: median(alphas),
        totalPicks: ns.reduce((s, n) => s + n, 0)
      };
    }
  }

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const outJson = {
    asOf: today,
    vintageCount: evaluations.length,
    horizonsDays: HORIZONS_DAYS,
    benchmark: 'universe-median',
    caveat: 'Yahoo universe is survivor-biased; alpha measured vs internal universe-median, not external index',
    modes
  };
  fs.writeFileSync(path.join(OUT_DIR, 'walk-forward.json'), JSON.stringify(outJson, null, 2));

  // Markdown report
  let md = '# Walk-Forward Performance — ' + today + '\n\n';
  md += '**Benchmark:** Universe-Median (intern). **Vintages:** ' + evaluations.length + '.\n\n';
  md += '_Survivor-bias caveat: Yahoo universe is survivor-only; alpha is vs internal median, not vs SPY._\n\n';
  for (const [mode, data] of Object.entries(modes)) {
    md += '## ' + mode + '\n\n';
    md += '| Horizon | Vintages | Median Alpha | Total Picks |\n|---|---|---|---|\n';
    for (const days of HORIZONS_DAYS) {
      const s = data.summary[days + 'd'];
      const alphaStr = s.medianAlpha != null ? (s.medianAlpha >= 0 ? '+' : '') + s.medianAlpha.toFixed(2) + 'pp' : '—';
      md += '| ' + days + 'd | ' + s.vintageCount + ' | ' + alphaStr + ' | ' + s.totalPicks + ' |\n';
    }
    md += '\n### Per-Vintage\n\n';
    md += '| asOf | n picks | 1w α | 4w α | 12w α |\n|---|---|---|---|---|\n';
    for (const v of data.vintages) {
      const cells = HORIZONS_DAYS.map(d => {
        const h = v.horizons[d + 'd'];
        if (!h || h.status !== 'ok' || h.alpha == null) return '—';
        return (h.alpha >= 0 ? '+' : '') + h.alpha.toFixed(2) + 'pp';
      });
      md += '| ' + v.asOf + ' | ' + v.n + ' | ' + cells[0] + ' | ' + cells[1] + ' | ' + cells[2] + ' |\n';
    }
    md += '\n';
  }
  fs.writeFileSync(path.join(OUT_DIR, 'walk-forward.md'), md);

  console.log('Walk-forward report written:');
  console.log('  ' + path.join(OUT_DIR, 'walk-forward.json'));
  console.log('  ' + path.join(OUT_DIR, 'walk-forward.md'));
  console.log('  vintages: ' + evaluations.length);
  for (const [mode, data] of Object.entries(modes)) {
    const s28 = data.summary['28d'];
    if (s28 && s28.medianAlpha != null) {
      console.log('  ' + mode + ' 4w median α = ' + (s28.medianAlpha >= 0 ? '+' : '') + s28.medianAlpha.toFixed(2) + 'pp (n=' + s28.vintageCount + ')');
    }
  }
}

module.exports = { evaluateVintage, computeUniverseMedianReturn, priceAt, returnPct, median, addDaysIso };

if (require.main === module) {
  try { main(); } catch (e) { console.error('walk-forward-perf failed: ' + e.message); process.exit(0); }
}
