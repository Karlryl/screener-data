#!/usr/bin/env node
/**
 * Tag 134 — Phase 4.3: Elliott-Wave Export CSV
 * ============================================
 * Karl analysiert Picks downstream mit Elliott-Wave-Workflow auf Charts.
 * Diese CSV enthält pro Pick alles was er für die Setup-Vorauswahl braucht,
 * direkt importierbar in Tabelle/Excel/Elliott-Tool:
 *
 *   ticker, name, sector, industry, region, currency_original,
 *   mode, score, tier, mcap_b_usd,
 *   growth_yoy_pct, fcf_margin_ttm_pct, operating_margin_pct,
 *   profitability_state,
 *   distance_above_200d_ma_pct, distance_to_52w_high_pct, drawdown_52w_pct,
 *   high_proximity_52w, volatility_annualized,
 *   weeks_on_list, first_seen_at, dq_grade,
 *   yahoo_url, aktienfinder_url
 *
 * Output: outputs/elliott-export-<MODE>.csv  pro Mode
 */
'use strict';
const fs = require('fs');
const path = require('path');

const Runner = require('../methods/runner.js');

const SNAP_DIR = path.join(__dirname, '..', 'snapshots');
const PICKS_DIR = path.join(__dirname, '..', 'picks-history');
const OUT_DIR = path.join(__dirname, '..', 'outputs');

function loadJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }

function _safeStem(t) { return String(t).replace(/[^A-Z0-9.-]/gi, '_'); }
function _windowsReserved(stem) { return /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(stem.split('.')[0]); }
function loadSnapshot(ticker) {
  const safe = _safeStem(ticker);
  const prefix = _windowsReserved(safe) ? '_' : '';
  const file = path.join(SNAP_DIR, prefix + safe + '.json');
  return loadJson(file);
}

function _methodValue(results, mid) {
  const r = results && results[mid];
  return (r && r.computable && Number.isFinite(r.value)) ? r.value : null;
}

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function aktienfinderUrl(ticker) {
  const base = String(ticker).split(/[.\-]/)[0];
  return 'https://www.google.com/search?q=' + encodeURIComponent('site:aktienfinder.net ' + base + ' aktie');
}

function yahooUrl(ticker) {
  return 'https://finance.yahoo.com/quote/' + encodeURIComponent(ticker);
}

function main() {
  const latest = loadJson(path.join(PICKS_DIR, 'latest.json'));
  if (!latest || !latest.modes) { console.log('No picks-history/latest.json — exiting.'); return; }
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const cols = [
    'ticker', 'name', 'sector', 'industry', 'region', 'currency_original',
    'mode', 'score', 'mcap_b_usd',
    'growth_yoy_pct', 'fcf_margin_ttm_pct', 'operating_margin_pct',
    'profitability_state',
    'distance_above_200d_ma_pct', 'distance_to_52w_high_pct', 'drawdown_52w_pct',
    'volatility_annualized',
    'weeks_on_list', 'first_seen_at', 'dq_grade',
    'yahoo_url', 'aktienfinder_url'
  ];

  for (const [mode, picks] of Object.entries(latest.modes)) {
    if (!Array.isArray(picks) || picks.length === 0) continue;
    const rows = [cols.join(',')];
    for (const p of picks) {
      const snap = loadSnapshot(p.ticker);
      if (!snap) {
        // Still emit a row with the picks-history fields, even if snapshot can't be loaded.
        const row = {
          ticker: p.ticker, name: p.name || '', sector: p.sector || '', industry: p.industry || '',
          region: '', currency_original: '',
          mode: mode, score: p.score, mcap_b_usd: p.marketCap != null ? (p.marketCap / 1e9).toFixed(2) : '',
          growth_yoy_pct: '', fcf_margin_ttm_pct: '', operating_margin_pct: '',
          profitability_state: p.profState || '',
          distance_above_200d_ma_pct: '', distance_to_52w_high_pct: '', drawdown_52w_pct: '',
          volatility_annualized: '',
          weeks_on_list: p.weeksOnList || 0, first_seen_at: p.firstSeenAt || '', dq_grade: '',
          yahoo_url: yahooUrl(p.ticker), aktienfinder_url: aktienfinderUrl(p.ticker)
        };
        rows.push(cols.map(c => csvEscape(row[c])).join(','));
        continue;
      }
      const results = Runner.evaluateStock(snap);
      const above200 = _methodValue(results, 'above-200d-ma');
      const highProx = _methodValue(results, 'high-proximity-52w');
      const drawdown = _methodValue(results, 'drawdown-52w');
      const vol = _methodValue(results, 'volatility-annualized');
      const row = {
        ticker: p.ticker,
        name: (snap.meta && snap.meta.name) || p.name || '',
        sector: (snap.meta && snap.meta.sector) || p.sector || '',
        industry: (snap.meta && snap.meta.industry) || p.industry || '',
        region: (snap.meta && snap.meta.region) || '',
        currency_original: (snap.meta && snap.meta.reportingCurrencyOriginal) || (snap.meta && snap.meta.reportingCurrency) || '',
        mode: mode,
        score: p.score,
        mcap_b_usd: snap.marketCap && snap.marketCap.value != null ? (snap.marketCap.value / 1e9).toFixed(2) : '',
        growth_yoy_pct: snap.metrics && snap.metrics.revenueGrowthYoY && snap.metrics.revenueGrowthYoY.value != null
          ? snap.metrics.revenueGrowthYoY.value.toFixed(1) : '',
        fcf_margin_ttm_pct: snap.metrics && snap.metrics.fcfMarginTTM && snap.metrics.fcfMarginTTM.value != null
          ? snap.metrics.fcfMarginTTM.value.toFixed(1) : '',
        operating_margin_pct: snap.metrics && snap.metrics.operatingMargin && snap.metrics.operatingMargin.value != null
          ? snap.metrics.operatingMargin.value.toFixed(1) : '',
        profitability_state: p.profState || '',
        distance_above_200d_ma_pct: above200 != null ? above200.toFixed(2) : '',
        distance_to_52w_high_pct: highProx != null ? highProx.toFixed(2) : '',
        drawdown_52w_pct: drawdown != null ? drawdown.toFixed(2) : '',
        volatility_annualized: vol != null ? vol.toFixed(2) : '',
        weeks_on_list: p.weeksOnList || 0,
        first_seen_at: p.firstSeenAt || '',
        dq_grade: (snap._quality && snap._quality.grade) || '',
        yahoo_url: yahooUrl(p.ticker),
        aktienfinder_url: aktienfinderUrl(p.ticker)
      };
      rows.push(cols.map(c => csvEscape(row[c])).join(','));
    }
    const outFile = path.join(OUT_DIR, 'elliott-export-' + mode + '.csv');
    fs.writeFileSync(outFile, rows.join('\n') + '\n');
    console.log('Wrote ' + outFile + ' (' + (rows.length - 1) + ' picks)');
  }
}

if (require.main === module) {
  try { main(); } catch (e) { console.error('elliott-export failed: ' + e.message); process.exit(0); }
}

module.exports = { main };
