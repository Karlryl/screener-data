#!/usr/bin/env node
/**
 * Tag 134 — Phase 4.2/4.4: Pick-Diff Generator + Jaccard Stability
 * ==================================================================
 * Vergleicht die zwei jüngsten picks-history Vintages und produziert:
 *   - outputs/pick-diff-YYYY-MM-DD.json — added / removed / same per Mode
 *   - outputs/pick-diff.html             — lesefreundliche Tabelle
 *   - Jaccard-Stability-Metrik je Mode (rolling-4w-Average)
 *
 * Beantwortet: "Welche Picks sind neu? Welche sind raus und WARUM?"
 * Für removed Picks wird die methods-history befragt: welche MUST hat geflippt?
 *
 * Output ist additiv — geht nicht in den Hauptpfad, sondern als Audit-Doc.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const PICKS_DIR = path.join(__dirname, '..', 'picks-history');
const METHODS_HIST_DIR = path.join(__dirname, '..', 'methods-history');
const OUT_DIR = path.join(__dirname, '..', 'outputs');

function loadJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }

function listVintages() {
  if (!fs.existsSync(PICKS_DIR)) return [];
  return fs.readdirSync(PICKS_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
}

function listMethodsVintages() {
  if (!fs.existsSync(METHODS_HIST_DIR)) return [];
  return fs.readdirSync(METHODS_HIST_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
}

// Jaccard distance = |A ∩ B| / |A ∪ B|. 1.0 = identical, 0.0 = no overlap.
function jaccard(setA, setB) {
  const a = new Set(setA), b = new Set(setB);
  if (a.size === 0 && b.size === 0) return 1.0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : Math.round((inter / union) * 1000) / 1000;
}

function picksToTickers(picksFile, mode) {
  return ((picksFile && picksFile.modes && picksFile.modes[mode]) || []).map(p => p.ticker);
}

// For each removed ticker, look up its method results in the prior vintage's
// methods-history AND in today's methods-history. Compute the set of methods
// whose pass state flipped pass→fail. That's the "why dropped" diagnostic.
function whyDropped(ticker, priorMethodsFile, todayMethodsFile) {
  const prior = (priorMethodsFile && priorMethodsFile.stocks && priorMethodsFile.stocks[ticker] && priorMethodsFile.stocks[ticker].results) || {};
  const today = (todayMethodsFile && todayMethodsFile.stocks && todayMethodsFile.stocks[ticker] && todayMethodsFile.stocks[ticker].results) || {};
  const flips = [];
  for (const mid of Object.keys(prior)) {
    const pr = prior[mid], tr = today[mid];
    if (!pr || !tr) continue;
    if (pr.pass === true && tr.pass === false) flips.push(mid + ' (was pass, now fail)');
    else if (pr.pass === true && tr.pass == null) flips.push(mid + ' (was pass, now incomputable)');
  }
  return flips;
}

function main() {
  const picksVintages = listVintages();
  if (picksVintages.length < 2) {
    console.log('Need >= 2 picks-history vintages, have ' + picksVintages.length);
    return;
  }
  const latestFile = picksVintages[picksVintages.length - 1];
  const priorFile = picksVintages[picksVintages.length - 2];
  const latest = loadJson(path.join(PICKS_DIR, latestFile));
  const prior = loadJson(path.join(PICKS_DIR, priorFile));
  if (!latest || !prior) { console.log('Failed to read latest/prior picks vintage'); return; }

  // Method-history files matching the prior and latest dates (best-effort).
  const mhVintages = listMethodsVintages();
  function findMethodFile(date) {
    if (mhVintages.includes(date + '.json')) return loadJson(path.join(METHODS_HIST_DIR, date + '.json'));
    // Fallback: closest mh file on/before date
    const cands = mhVintages.filter(f => f.replace('.json', '') <= date);
    if (!cands.length) return null;
    return loadJson(path.join(METHODS_HIST_DIR, cands[cands.length - 1]));
  }
  const todayDate = latestFile.replace('.json', '');
  const priorDate = priorFile.replace('.json', '');
  const todayMethods = findMethodFile(todayDate);
  const priorMethods = findMethodFile(priorDate);

  const diff = {
    asOf: todayDate,
    comparedTo: priorDate,
    modes: {}
  };

  for (const mode of ['HYPERGROWTH', 'QUALITY_COMPOUNDER']) {
    const latestTickers = picksToTickers(latest, mode);
    const priorTickers = picksToTickers(prior, mode);
    const latestSet = new Set(latestTickers);
    const priorSet = new Set(priorTickers);
    const added = latestTickers.filter(t => !priorSet.has(t));
    const removed = priorTickers.filter(t => !latestSet.has(t));
    const same = latestTickers.filter(t => priorSet.has(t));
    const jac = jaccard(latestTickers, priorTickers);
    const removedWithReason = removed.map(t => ({
      ticker: t,
      flippedMethods: whyDropped(t, priorMethods, todayMethods)
    }));
    diff.modes[mode] = {
      jaccard: jac,
      latestN: latestTickers.length,
      priorN: priorTickers.length,
      added,
      removed: removedWithReason,
      sameCount: same.length
    };
  }

  // Rolling 4-week Jaccard average
  const recentVintages = picksVintages.slice(-5); // latest + 4 priors
  diff.rollingJaccard = {};
  for (const mode of ['HYPERGROWTH', 'QUALITY_COMPOUNDER']) {
    const tickerSets = [];
    for (const f of recentVintages) {
      const v = loadJson(path.join(PICKS_DIR, f));
      if (v) tickerSets.push(picksToTickers(v, mode));
    }
    const pairwise = [];
    for (let i = 1; i < tickerSets.length; i++) pairwise.push(jaccard(tickerSets[i-1], tickerSets[i]));
    diff.rollingJaccard[mode] = {
      windowVintages: tickerSets.length,
      pairwiseJaccards: pairwise,
      meanJaccard: pairwise.length ? Math.round(pairwise.reduce((s, j) => s + j, 0) / pairwise.length * 1000) / 1000 : null
    };
  }

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'pick-diff-' + todayDate + '.json'), JSON.stringify(diff, null, 2));

  // Also overwrite the latest pointer
  fs.writeFileSync(path.join(OUT_DIR, 'pick-diff.json'), JSON.stringify(diff, null, 2));

  // HTML
  let html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Pick Diff — ' + todayDate + '</title>';
  html += '<style>body{background:#0f172a;color:#e2e8f0;font-family:ui-sans-serif,system-ui,sans-serif;padding:24px;max-width:1100px;margin:0 auto}';
  html += 'h1{font-size:22px;color:#f1f5f9;margin:0 0 6px}h2{color:#cbd5e1;font-size:16px;margin-top:24px}';
  html += '.sub{color:#94a3b8;font-size:13px;margin-bottom:24px}';
  html += 'table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:18px}';
  html += 'th{text-align:left;padding:8px;color:#94a3b8;font-weight:500;border-bottom:1px solid #334155}';
  html += 'td{padding:8px;border-bottom:1px solid rgba(51,65,85,0.4);vertical-align:top}';
  html += '.added{color:#4ade80}.removed{color:#f87171}.same{color:#94a3b8}';
  html += '.jac-good{color:#4ade80}.jac-warn{color:#fbbf24}.jac-bad{color:#f87171}';
  html += '.mono{font-family:"JetBrains Mono",monospace;font-size:12px}';
  html += '.reason{color:#fbbf24;font-size:11px;display:block;margin-top:4px}';
  html += '</style></head><body>';
  html += '<h1>Pick Diff — ' + todayDate + '</h1>';
  html += '<div class="sub">Compared against ' + priorDate + '. Jaccard ≥ 0.7 = healthy stability. Lower = more whip-saw.</div>';

  for (const mode of ['HYPERGROWTH', 'QUALITY_COMPOUNDER']) {
    const m = diff.modes[mode];
    const r = diff.rollingJaccard[mode];
    const jacClass = m.jaccard >= 0.7 ? 'jac-good' : m.jaccard >= 0.5 ? 'jac-warn' : 'jac-bad';
    html += '<h2>' + mode + '</h2>';
    html += '<div class="sub">' +
      'Jaccard week-over-week: <span class="' + jacClass + '">' + m.jaccard + '</span> &middot; ' +
      'Rolling 4w mean Jaccard: <span>' + (r.meanJaccard != null ? r.meanJaccard : '—') + '</span> &middot; ' +
      'today=' + m.latestN + ' &middot; ' + priorDate + '=' + m.priorN + ' &middot; ' +
      'added=<span class="added">' + m.added.length + '</span> &middot; ' +
      'removed=<span class="removed">' + m.removed.length + '</span> &middot; ' +
      'same=<span class="same">' + m.sameCount + '</span>' +
      '</div>';

    if (m.added.length > 0) {
      html += '<h3 class="added">+ Added (' + m.added.length + ')</h3>';
      html += '<div class="mono">' + m.added.map(t => '<span class="added">' + t + '</span>').join(' ') + '</div>';
    }
    if (m.removed.length > 0) {
      html += '<h3 class="removed">− Removed (' + m.removed.length + ')</h3>';
      html += '<table><thead><tr><th>Ticker</th><th>Why dropped (method-flips)</th></tr></thead><tbody>';
      for (const r of m.removed) {
        const why = r.flippedMethods.length > 0 ? r.flippedMethods.join('; ') : '<i style="color:#94a3b8">no method-flip detected — likely universe-pruning or score-cap</i>';
        html += '<tr><td class="mono removed">' + r.ticker + '</td><td><span class="reason">' + why + '</span></td></tr>';
      }
      html += '</tbody></table>';
    }
  }
  html += '</body></html>';
  fs.writeFileSync(path.join(OUT_DIR, 'pick-diff.html'), html);

  console.log('Pick-diff written:');
  console.log('  ' + path.join(OUT_DIR, 'pick-diff-' + todayDate + '.json'));
  console.log('  ' + path.join(OUT_DIR, 'pick-diff.html'));
  for (const mode of ['HYPERGROWTH', 'QUALITY_COMPOUNDER']) {
    const m = diff.modes[mode];
    console.log('  ' + mode + ': jaccard=' + m.jaccard + ', +' + m.added.length + ' -' + m.removed.length + ', =' + m.sameCount);
  }
}

module.exports = { jaccard, whyDropped };

if (require.main === module) {
  try { main(); } catch (e) { console.error('pick-diff failed: ' + e.message); process.exit(0); }
}
