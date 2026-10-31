#!/usr/bin/env node
'use strict';
/**
 * Measurement for lib/annual-gap-fill.js (P288): how many rows have an empty newest annual revenue next to a present
 * prior year, what the fill rule says about each, and what a cell fill WOULD move. Changes nothing; writes only --out.
 *
 *   node scripts/annual-gap-fill-report.js --snapshots <dir> --out <file> [--watcher <plausibilitaet.json>]
 *
 * Reads one snapshot at a time (under 1 GB). It compares the per-row readers of src/scoring before and after the
 * fill. A full re-score (ranks, percentiles of the other rows) is NOT part of this: that is a before/after of the
 * scoring run with the fill wired in.
 */
const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('../lib/atomic-write.js');
const { prepareSnapshot } = require('../lib/yahoo-q4-known-cases.js');
const { loadStores } = require('../lib/exchange-quarter-check.js');
const { annualGapFill, applyAnnualGapFill } = require('../lib/annual-gap-fill.js');
const { revGrowthLeg } = require('../lib/rev-growth-basis.js');
const { fcfMarginStmtFY } = require('../lib/fcf-stmt-shadow.js');
const { growth3 } = require('./write-filter-universe.js');
const { norm } = require('../src/scoring/snapshot.js');
const score = require('../src/scoring/score.js');

const READER_MODULES = { axes: require('../src/scoring/axes.js'), lamps: require('../src/scoring/lamps.js'),
  router: require('../src/scoring/router.js'), overview: require('../src/scoring/overview.js') };
const EXTRA_READERS = { revGrowthLeg, fcfMarginStmtFY, growth3, robustG: score.robustG };

function readers(s) {
  const out = {};
  const read = (name, fn) => {
    try {
      const v = fn(s);
      if (typeof v !== 'function') out[name] = JSON.stringify(v);
    } catch (e) { out[name] = 'throws: ' + e.message; }
  };
  for (const [mod, fns] of Object.entries(READER_MODULES)) {
    for (const [k, fn] of Object.entries(fns)) if (typeof fn === 'function') read(mod + '.' + k, fn);
  }
  for (const [k, fn] of Object.entries(EXTRA_READERS)) read(k, fn);
  return out;
}

/** Paths whose value differs between two JSON values. */
function changedPaths(a, b, at = '', out = []) {
  if (a === b) return out;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) changedPaths(a[k], b[k], at ? at + '.' + k : k, out);
  } else out.push(at);
  return out;
}

const countBy = (rows, key) => {
  const groups = new Map();
  for (const r of rows) {
    const k = key(r);
    if (!groups.has(k)) groups.set(k, { key: k, tickers: 0, firms: new Set() });
    const g = groups.get(k);
    g.tickers++; g.firms.add(r.firm);
  }
  return [...groups.values()].map(g => ({ key: g.key, tickers: g.tickers, firms: g.firms.size })).sort((x, y) => y.tickers - x.tickers);
};

function main(argv) {
  const arg = n => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : null; };
  const dir = arg('snapshots'), out = arg('out'), watcherFile = arg('watcher');
  if (!dir || !out) throw new Error('usage: --snapshots <dir> --out <file> [--watcher <file>]');
  const stores = loadStores();
  if (!stores.cn) throw new Error('China store unreadable: ' + stores.warnings.join('; '));
  const ctx = { stores };
  const gaps = [], changed = [], unexpected = [];
  let population = 0, unreadable = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json') || f.startsWith('_manifest') || f === '_last_good_disk.json') continue;
    let s;
    try { s = prepareSnapshot(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); } catch (_) { unreadable++; continue; }
    if (!s?.meta?.ticker) { unreadable++; continue; }
    population++;
    const revenue = norm(s, 'annualRev');
    if (revenue[0] !== null || !(revenue[1] > 0)) continue;
    const verdict = annualGapFill(s, ctx);
    const row = { ticker: s.meta.ticker, firm: score.issuerKeyLoose(s) || s.meta.ticker, name: s.meta.name || null,
      suffix: (s.meta.ticker.match(/\.([A-Z]+)$/) || [null, 'US'])[1], period: s.annual.annualRevEnds?.[0] || null,
      gapReason: s.meta.annualIncomeGapReason || null, leg: revGrowthLeg(s), ...verdict };
    gaps.push(row);
    if (!verdict.fill) continue;
    const after = applyAnnualGapFill(s, verdict.fill);
    const paths = changedPaths(JSON.parse(JSON.stringify(s)), JSON.parse(JSON.stringify(after)));
    if (!paths.every(p => p.startsWith('annual.annualRev.0'))) unexpected.push({ ticker: row.ticker, paths });
    const a = readers(s), b = readers(after);
    const moved = Object.keys(b).filter(k => a[k] !== b[k]).map(k => ({ reader: k, before: a[k], after: b[k] }));
    changed.push({ ticker: row.ticker, paths, moved });
  }
  const fills = gaps.filter(g => g.fill);
  const report = {
    schema: 'annual-gap-fill-report/v1', population, unreadable,
    gaps: { tickers: gaps.length, firms: new Set(gaps.map(g => g.firm)).size,
      perExchange: countBy(gaps, r => r.suffix), perPeriod: countBy(gaps, r => r.period), perVerdict: countBy(gaps, r => r.refuse || 'fill') },
    rows: gaps, beforeAfter: { rowsChanged: changed.length, unexpected, changed },
  };
  if (watcherFile) {
    const w = JSON.parse(fs.readFileSync(watcherFile, 'utf8'));
    const lines = (w.faelle || []).filter(x => x.code === 'umsatz-null-mit-boersenwert');
    const ids = new Set(fills.map(g => g.ticker));
    const gone = lines.filter(x => x.werte?.feld === 'annualRev' && ids.has(x.ticker));
    report.watcher = { published: w.zusammenfassung?.['umsatz-null-mit-boersenwert'] ?? null, lines: lines.length,
      linesAWiredFillWouldRemove: gone.length, tickers: gone.map(x => x.ticker).sort() };
  }
  writeJsonAtomic(out, report, { indent: 1 });
  console.log(JSON.stringify({ population, unreadable, gaps: report.gaps, rowsChanged: changed.length, unexpected: unexpected.length, watcher: report.watcher || null }));
}

if (require.main === module) main(process.argv.slice(2));
