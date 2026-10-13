'use strict';
// Read the current published boards once in prep; every shard receives the same ranks.
const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('../lib/atomic-write.js');
async function prepareRanks(fetchJson, warn = console.warn) {
  try { return await readRanks(fetchJson, warn); }
  catch (e) {
    warn('::warning::stale-quarter ranks unavailable: ' + e.message + '; using empty ranks');
    return { generated_at: null, sources: [], ranks: {} };
  }
}
async function readRanks(fetchJson, warn) {
  const index = await fetchJson('index.json');
  if (!Array.isArray(index.branches) || !index.generated_at) throw new Error('Invalid board index for stale-quarter ordering');
  const ranks = {}, sources = [{ family: 'hypergrowth', generated_at: index.generated_at }];
  const files = [...index.branches.map(board => ({ board, file: 'full/' + board + '.json', date: index.generated_at })),
    { board: 'survival', file: 'survival.json', date: index.generated_at }];
  // These published families can be absent on an older installation. Calendar
  // and board availability affect ordering only; eligibility still covers the universe.
  for (const family of ['quality', 'smallcap']) {
    const ix = await fetchJson(family + '/index.json');
    if (ix === null) continue;
    if (!Array.isArray(ix.boards) || !ix.generated_at) throw new Error('Invalid board index: ' + family);
    sources.push({ family, generated_at: ix.generated_at });
    for (const name of ix.boards) {
      if (typeof name !== 'string' || !name.startsWith(family + '-')) throw new Error('Invalid board family name');
      const board = name.slice(family.length + 1);
      files.push({ board, file: family + '/' + board + '.json', date: ix.generated_at });
    }
  }
  for (const { board, file, date } of files) {
    if (!/^[a-z-]+$/.test(board)) throw new Error('Invalid board name');
    // Full cohorts include ranks beyond the displayed top 100; gated rank:null rows do not count.
    const data = await fetchJson(file);
    if (!data) throw new Error('Missing board: ' + board);
    if (String(data.generated_at).slice(0, 10) !== date.slice(0, 10)) warn('::warning::Mixed board dates: ' + board + '; retaining ordering hints');
    const tracks = Array.isArray(data) ? [data] : [data.profitable || [], data.unprofitable || [], data.rows || []];
    for (const rows of tracks) for (const row of rows) {
      if (typeof row.ticker === 'string' && Number.isSafeInteger(row.rank) && row.rank > 0) ranks[row.ticker] = Math.min(ranks[row.ticker] || Infinity, row.rank);
    }
  }
  if (!Object.keys(ranks).length) throw new Error('No board ranks loaded');
  return { generated_at: index.generated_at, sources, ranks };
}
if (require.main === module) {
  const base = 'https://raw.githubusercontent.com/Karlryl/screener-data/gh-pages/outputs/findash-export/v1/';
  prepareRanks(async file => {
    const response = await fetch(base + file, { signal: AbortSignal.timeout(20000) });
    if (response.status === 404 && /^(quality|smallcap)\/index.json$/.test(file)) return null;
    if (!response.ok) throw new Error('Board rank fetch HTTP ' + response.status + ': ' + file);
    return response.json();
  }).then(result => {
    const file = path.join(__dirname, '..', 'outputs', 'stale-quarter-ranks.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeFileAtomic(file, JSON.stringify(result));
    console.log('Stale-quarter ranks: ' + Object.keys(result.ranks).length + ' tickers, boards ' + result.generated_at);
  }).catch(e => { console.warn('::warning::stale-quarter ranks not written: ' + e.message + '; continuing without ranks'); });
}
module.exports = { prepareRanks };
