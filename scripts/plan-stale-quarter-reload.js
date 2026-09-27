'use strict';
// Read-only candidate phase, then one global selection before any Yahoo shard starts.
const fs = require('fs');
const path = require('path');
const R = require('../lib/stale-quarter-reload.js');
const { writeFileAtomic } = require('../lib/atomic-write.js');
function mergeCandidates(plans, config, shardCount, date) {
  R.validateConfig(config);
  if (plans.length !== shardCount || new Set(plans.map(p => p.shard.index)).size !== shardCount
    || plans.some(p => p.date !== date || p.shard.count !== shardCount || p.shard.index < 0
      || !Number.isSafeInteger(p.shard.index) || p.shard.index >= shardCount
      || JSON.stringify(p.config) !== JSON.stringify(config))) throw new Error('Incomplete/inconsistent stale-quarter candidate plans');
  const candidates = plans.flatMap(p => p.candidates);
  if (new Set(candidates.map(r => r.ticker)).size !== candidates.length) throw new Error('Duplicate stale-quarter candidate ticker');
  candidates.sort(R.compareCandidates);
  return { reason: R.REASON, date, shardCount, maxPerRun: config.maxPerRun, eligible: candidates.length,
    selected: candidates.slice(0, config.maxPerRun).map(r => r.ticker), skippedCap: Math.max(0, candidates.length - config.maxPerRun) };
}
function run(argv) {
  const root = path.resolve(__dirname, '..');
  const read = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
  const config = R.validateConfig(read('configs/stale-quarter-reload.json'));
  const date = process.env.RUN_DATE_UTC || new Date().toISOString().slice(0, 10);
  let result, target;
  if (argv[0] === '--candidates') {
    const { shardStocks, parseArgs } = require('../pull-yahoo.js');
    const args = parseArgs(['node', 'pull-yahoo.js', '--shard', argv[1]]);
    if (args.argError || !args.shard) throw new Error('Invalid candidate shard');
    const stocks = shardStocks(read('watchlist.json').stocks, args.shard);
    let ranks = {};
    try { ranks = read('outputs/stale-quarter-ranks.json').ranks || {}; }
    catch (e) { console.warn('::warning::stale-quarter ranks unavailable: ' + e.message + '; using empty ranks'); }
    let calendar = {};
    try { calendar = read('earnings-calendar.json') || {}; }
    catch (e) { console.warn('::warning::stale-quarter calendar unavailable: ' + e.message + '; using empty calendar'); }
    const p = R.planReload(stocks, { snapshotDir: path.join(root, 'snapshots'), cacheDir: path.join(root, 'fundamentals-cache'),
      ranks, calendar, config, shard: args.shard });
    if (p.readErrors) console.warn('::warning::Unreadable stale-quarter candidate inputs: ' + p.readErrors + '; continuing with readable snapshots');
    result = { date, shard: args.shard, config, candidates: p.candidates, readErrors: p.readErrors, noQuarter: p.noQuarter };
    target = 'outputs/stale-quarter-candidates/shard-' + args.shard.index + '.json';
  } else if (argv[0] === '--merge') {
    const count = Number(argv[1]);
    if (!Number.isSafeInteger(count) || count <= 0) throw new Error('Invalid candidate shard count');
    const plans = Array.from({ length: count }, (_, i) => read('outputs/stale-quarter-candidates/shard-' + i + '.json'));
    result = mergeCandidates(plans, config, count, date);
    target = 'outputs/stale-quarter-selection.json';
    console.log(R.REASON + ': selected=' + result.selected.length + ', eligible=' + result.eligible + ', skipped-cap=' + result.skippedCap);
  } else throw new Error('Expected --candidates i/N or --merge N');
  const file = path.join(root, target);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFileAtomic(file, JSON.stringify(result));
  return result;
}
if (require.main === module) { try { run(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; } }
module.exports = { mergeCandidates, run };
