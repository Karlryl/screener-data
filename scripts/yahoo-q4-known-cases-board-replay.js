#!/usr/bin/env node
'use strict';

// Read-only comparison of current published membership and the same-population re-score.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { applyKnownCases } = require('../lib/yahoo-q4-known-cases.js');
const { isMetadataSnapshot } = require('../lib/snapshot-fs.js');
const { scoreUniverse, produceRankings } = require('../src/scoring/score.js');
const { mergeSecIntoUniverse, filterToAuthorizedUniverse } = require('../src/scoring/run-screener.js');
const { qualityRoute } = require('../src/scoring/quality-route.js');
const formulas = require('../src/scoring/formulas/index.js');
const qualityFormulas = require('../src/scoring/formulas/quality/index.js');
const { belegPunkte } = require('./write-findash-export.js');
const table = require('../configs/yahoo-q4-known-cases.json');

function boardReplay(dir) {
  const tickers = new Set(table.cases.flatMap(c => c.listingAliases));
  const git = args => cp.execFileSync('git', args, { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const ref = git(['rev-parse', 'origin/gh-pages']).trim();
  const files = git(['ls-tree', '-r', '--name-only', ref, 'outputs/findash-export/v1']).trim().split('\n')
    .filter(f => f.endsWith('.json') && !f.includes('/druckenmiller/') && !f.endsWith('/excluded.json'));
  const published = [];
  for (const file of files) {
    const doc = JSON.parse(git(['show', `${ref}:${file}`]));
    const walk = x => {
      if (!x || typeof x !== 'object') return;
      if (tickers.has(x.ticker) && Number.isFinite(x.rank)) published.push({ file, generatedAt: doc.generated_at,
        ticker: x.ticker, rank: x.rank, score: x.score, growth: x.revGrowthYoYPct, qPunkte: x.qPunkte });
      for (const value of Object.values(x)) if (value && typeof value === 'object') walk(value);
    };
    walk(doc);
  }
  let input = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !isMetadataSnapshot(f))
    .map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))).filter(s => s?.meta?.ticker);
  const wl = JSON.parse(fs.readFileSync(path.join(__dirname, '../watchlist.json'), 'utf8'));
  input = filterToAuthorizedUniverse(input, wl.stocks).filtered;
  mergeSecIntoUniverse(input);
  const afterInput = input.map(s => applyKnownCases(s).snapshot);
  const measure = (u, quality) => {
    const results = scoreUniverse(u, quality ? qualityFormulas : formulas,
      quality ? { classify: qualityRoute, growthBoost: false } : {});
    const ranked = produceRankings(results, { topN: 100 });
    const rows = [];
    for (const [branch, b] of Object.entries(ranked.full)) {
      for (const track of ['profitable', 'unprofitable']) for (const row of b[track] || []) {
        if (tickers.has(row.ticker)) rows.push({ board: quality ? 'quality' : 'growth', branch, track,
          ticker: row.ticker, score: row.score, growth: row.revGrowthYoYPct, overview: row.overview });
      }
    }
    return rows;
  };
  return {
    note: 'Same supplied snapshots, current watchlist/local SEC stores; future pull/rank changes are not predicted.',
    ghPagesRef: ref, population: input.length, published,
    before: [...measure(input, false), ...measure(input, true)],
    after: [...measure(afterInput, false), ...measure(afterInput, true)],
    evidenceCounts: afterInput.filter(s => tickers.has(s.meta.ticker)).map(s => ({ ticker: s.meta.ticker,
      ...belegPunkte(s.timeseries) }))
  };
}

if (require.main === module) {
  const dir = process.argv[2] || process.env.SCREENER_SNAPSHOTS_DIR;
  if (!dir) throw new Error('Supply snapshot directory or SCREENER_SNAPSHOTS_DIR');
  const log = console.log;
  let result;
  try { console.log = () => {}; result = boardReplay(dir); } finally { console.log = log; }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
module.exports = { boardReplay };
