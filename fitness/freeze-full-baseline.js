#!/usr/bin/env node
/**
 * fitness/freeze-full-baseline.js — wire the rank-IC fitness eval over the FULL
 * screened universe, per mode, READ-ONLY. (Project-1 of the screener-improvement
 * program: make the correct eval runnable; method-effectiveness.js's median-diff
 * is descriptive only — rank-IC over the survivorship-keyed universe is the honest
 * signal.)
 *
 * Emits THREE per-mode baselines (HYPERGROWTH / QUALITY_COMPOUNDER / TURNAROUND)
 * instead of one pooled ranking: each mode's `score` is rank-normalized to ~[.,100]
 * WITHIN that mode, so pooling modes by score is degenerate (a TURNAROUND-100 is not
 * comparable to a HYPERGROWTH-100, and TURNAROUND carries fewer picks, currently 52).
 * Each baseline ranks one mode's picks and shares the vintage's full evaluatedTickers
 * as the survivorship universe (the lever measure.js uses for naive-vs-conservative).
 *
 * t0 = the OLDEST picks-history vintage carrying modes+score+evaluatedTickers, so the
 * 28d/84d horizons realize as early as the price history allows. Deterministic (no
 * new Date(); the oldest file is fixed). KEIN Scoring-Change -> kein Court / Mess-Artefakt.
 * measure.js is NOT modified and writes only fitness/outputs/.
 *
 * Usage (from screener-data/):
 *   node fitness/freeze-full-baseline.js [YYYY-MM-DD]      # default: oldest good vintage
 *   node fitness/measure.js fitness/baselines/full-<mode>-<frozenAt>.json   # read-only
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PH_DIR = path.join(ROOT, 'picks-history');
const OUT_DIR = path.join(__dirname, 'baselines');

const MODES = ['HYPERGROWTH', 'QUALITY_COMPOUNDER', 'TURNAROUND'];

function modePicks(vintage, mode) {
  const m = vintage.modes && vintage.modes[mode];
  return Array.isArray(m) ? m : (m && Array.isArray(m.picks) ? m.picks : null);
}

function isGood(vintage) {
  if (!vintage || !vintage.modes || !Array.isArray(vintage.evaluatedTickers)) return false;
  // Need at least one mode whose picks carry a numeric score (older vintages lacked it).
  return MODES.some(md => { const p = modePicks(vintage, md); return p && p[0] && p[0].score != null; });
}

// Pick t0: explicit CLI arg wins; else the OLDEST good vintage (deterministic readdir sort).
const argDate = process.argv[2];
const files = fs.readdirSync(PH_DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
let frozenAt = null, vintage = null;
if (argDate) {
  const p = path.join(PH_DIR, argDate + '.json');
  if (!fs.existsSync(p)) { console.error('[freeze-full] no picks-history vintage ' + argDate); process.exit(1); }
  vintage = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!isGood(vintage)) { console.error('[freeze-full] vintage ' + argDate + ' lacks modes+score+evaluatedTickers'); process.exit(1); }
  frozenAt = argDate;
} else {
  for (const f of files) {
    const v = JSON.parse(fs.readFileSync(path.join(PH_DIR, f), 'utf8'));
    if (isGood(v)) { frozenAt = f.replace('.json', ''); vintage = v; break; }
  }
  if (!vintage) { console.error('[freeze-full] no picks-history vintage has modes+score+evaluatedTickers'); process.exit(1); }
}

const evaluatedTickers = vintage.evaluatedTickers;
const universeSize = vintage.universeSize || evaluatedTickers.length;

fs.mkdirSync(OUT_DIR, { recursive: true });
const written = [];
for (const mode of MODES) {
  const picks = modePicks(vintage, mode);
  if (!picks || !picks.length) { console.warn('[freeze-full] mode ' + mode + ' has no picks at ' + frozenAt + ' — skipping'); continue; }
  // Rank WITHIN the mode (score desc, deterministic localeCompare tie-break, same
  // convention as freeze-fabless-baseline.js). Cross-mode pooling is intentionally avoided.
  const ranked = picks.slice()
    .filter(p => p && p.ticker && p.score != null)
    .sort((a, b) => b.score - a.score || a.ticker.localeCompare(b.ticker));
  const ranking = ranked.map((p, i) => ({ rank: i + 1, ticker: p.ticker, score: p.score }));
  const baselineId = 'full-' + mode.toLowerCase() + '-' + frozenAt;
  const baseline = {
    baselineId,
    frozenAt,
    mode,
    source: 'picks-history/' + frozenAt + '.json :: modes.' + mode,
    degraded: false,
    universeSize,
    note: 'Per-mode full-universe fitness baseline. score is rank-normalized WITHIN '
      + mode + ' (not cross-mode comparable) — pooling modes would be degenerate, hence '
      + 'one baseline per mode. Read-only measurement artifact; no scoring change.',
    preRegistration: {
      metric: ['rank_ic_spearman', 'top_n_minus_universe_median_fwd_return'],
      horizonsDays: [28, 84],
      survivorshipKey: 'evaluatedTickers',
      honestLimitation: 'n<=100 per mode -> rank-IC has DIRECTIONAL power only (SE(IC) ~0.1 at '
        + 'n=100). Primary value: (1) survivorship-bias quantification via measure.js naive-vs-'
        + 'conservative, (2) production rank-IC once horizons mature. 84d matured for 0 vintages '
        + 'until ~Q4 2026; 28d realizes within days of frozenAt+28.',
    },
    ranking,
    evaluatedTickers,
  };
  const out = path.join(OUT_DIR, baselineId + '.json');
  fs.writeFileSync(out, JSON.stringify(baseline, null, 2));
  written.push(out);
  console.log('Wrote', out, '| mode', mode, '| ranked', ranking.length, '| universe', universeSize);
}
console.log('frozenAt', frozenAt, '| baselines', written.length);
console.log('Next (READ-ONLY): node fitness/measure.js <baselinePath> for each baseline above.');
