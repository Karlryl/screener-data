#!/usr/bin/env node
'use strict';
/**
 * build-r40-latest.js — build r40-latest.json from a screener.html artifact.
 *
 * Reads window.SCREENER_DATA.rowsByTicker from an existing screener.html (the
 * exact data the dashboard renders) and emits the flat r40-latest.json export
 * that findash consumes. This lets us produce a FRESH r40-latest.json from any
 * screener.html — e.g. the CI-built one committed to origin/main each day —
 * WITHOUT a local snapshot re-pull.
 *
 * The selection/shaping logic mirrors the in-generate export in
 * generate-screener.js exactly: skip rows without a computable Rule-of-40, skip
 * the screener's hard-gated data artifacts, take r40Pass/rxPass from the
 * canonical method results, expose fcfMargin under both names, sort by r40 desc.
 *
 * Usage: node build-r40-latest.js <screener.html> [outPath]
 *   outPath defaults to <repo-root>/r40-latest.json (one level up from scripts/).
 */
const fs = require('fs');
const path = require('path');

const htmlPath = process.argv[2];
if (!htmlPath) {
  console.error('usage: node build-r40-latest.js <screener.html> [outPath]');
  process.exit(1);
}
const outPath = process.argv[3] || path.join(__dirname, '..', 'r40-latest.json');

const html = fs.readFileSync(htmlPath, 'utf8');
const MARK = 'window.SCREENER_DATA = ';
const i = html.indexOf(MARK);
if (i < 0) { console.error('SCREENER_DATA marker not found in ' + htmlPath); process.exit(1); }
const start = i + MARK.length;
const end = html.indexOf(';</script>', start);
if (end < 0) { console.error('SCREENER_DATA terminator not found in ' + htmlPath); process.exit(1); }

const DATA = JSON.parse(html.slice(start, end));
const rows = DATA.rowsByTicker || {};
const asOf = (DATA.generatedAt || '').slice(0, 10);
// F-04: refuse to write entries with an empty/short asOf. generate-screener.js's
// merge prunes any entry whose asOf < (today - 60d); an empty '' sorts below every
// real date, so a bad asOf here would make the NEXT daily run silently delete every
// ticker this script wrote. Fail loud instead of corrupting the export.
if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
  console.error('generatedAt missing/malformed in SCREENER_DATA (asOf="' + asOf + '") — refusing to write. Source: ' + htmlPath);
  process.exit(1);
}

const round2 = (v) => (v == null || !Number.isFinite(v)) ? null : Math.round(v * 100) / 100;
const out = [];
for (const t of Object.keys(rows)) {
  const r = rows[t];
  if (!r || r.r40 == null) continue;  // only rows with a computed Rule-of-40 result
  // Same hard-gates as classifyTabs: reject R40-poisoning data artifacts.
  // F-R40-001 (audit 2026-06-11): dqGrade C added here too — this sister builder
  // (used when reconstructing r40-latest.json from a committed screener.html) must
  // match generate-screener.js's export gate, or a rebuild would silently re-admit
  // the grade-C rows the live path now excludes.
  const hardGated = r.qSpikeFail || r.lossMagFail || r.metricDivFail || r.niVolFail
    || r.preCommFail || r.cetFail || r.r40SanityFail || r.revShockFail
    || r.dqGrade === 'D' || r.dqGrade === 'C' || r.hgClass === 'Q_SPIKE_FAKE';
  if (hardGated) continue;
  const r40Res = r.results && r.results['rule-of-40'];
  const rxRes  = r.results && r.results['rule-of-x'];
  out.push({
    ticker: r.ticker,
    name: r.name,
    growth: round2(r.growth),
    fcfMargin: round2(r.fcfMargin),   // canonical FCF-margin value …
    marginPct: round2(r.fcfMargin),   // … same value, exposed as marginPct too
    marginType: 'FCF',
    r40: round2(r.r40),
    rx: round2(r.rx),
    r40Pass: !!(r40Res && r40Res.computable && r40Res.pass),
    rxPass:  !!(rxRes  && rxRes.computable  && rxRes.pass),
    asOf
  });
}
// F-01: null-safe sort (mirror generate-screener.js) — avoid NaN ordering.
out.sort((a, b) => {
  const ar = Number.isFinite(a.r40) ? a.r40 : -Infinity;
  const br = Number.isFinite(b.r40) ? b.r40 : -Infinity;
  return (br - ar) || (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0);
});
fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
console.log('wrote ' + outPath + ' (' + out.length + ' R40 results, asOf ' + asOf +
            ', source ' + path.basename(htmlPath) + ')');
