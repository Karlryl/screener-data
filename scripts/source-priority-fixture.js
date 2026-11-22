'use strict';
// Regenerates the key fixture of tests/source-priority.test.js from a folder of real snapshots.
//   node scripts/source-priority-fixture.js <snapshot dir> <run id> <data day YYYY-MM-DD>
// Reads every *.json in <snapshot dir> (never writes there) and writes ONLY
// tests/fixtures/source-priority/snapshot-keys-<data day>.json: the field keys under metrics, timeseries and annual
// with the number of files carrying each key. Keys and counts only, no values, no tickers. Deterministic: sorted
// keys, no clock. Take the snapshots artifact of a daily run (gh run download <id> -n snapshots -D <dir outside the repo>).
const fs = require('node:fs');
const path = require('node:path');

const CONTAINERS = ['metrics', 'timeseries', 'annual'];
const OUT_DIR = path.resolve(__dirname, '..', 'tests', 'fixtures', 'source-priority');

function main([dir, runId, day]) {
  if (!dir || !/^\d+$/.test(runId || '') || !/^\d{4}-\d{2}-\d{2}$/.test(day || '')) {
    throw new Error('usage: node scripts/source-priority-fixture.js <snapshot dir> <run id> <data day YYYY-MM-DD>');
  }
  const src = path.resolve(dir);
  if (src === OUT_DIR || src.startsWith(OUT_DIR + path.sep)) throw new Error('snapshot dir must not be the fixture folder');
  const counts = {};
  let files = 0, withContainers = 0;
  for (const f of fs.readdirSync(src).filter(n => n.endsWith('.json')).sort()) {
    files++;
    const s = JSON.parse(fs.readFileSync(path.join(src, f), 'utf8')); // an unparsable snapshot aborts: counts would lie
    let any = false;
    for (const c of CONTAINERS) {
      const b = s && s[c];
      if (!b || typeof b !== 'object' || Array.isArray(b)) continue;
      any = true;
      for (const k of Object.keys(b)) {
        // A key that is not a plain field name could carry data (a ticker as key): refuse instead of publishing it.
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(k)) throw new Error('unexpected key shape under ' + c + ' in ' + f);
        counts[c + '.' + k] = (counts[c + '.' + k] || 0) + 1;
      }
    }
    if (any) withContainers++;
  }
  if (!files) throw new Error('no snapshot files in ' + src);
  const keys = Object.fromEntries(Object.keys(counts).sort().map(k => [k, counts[k]]));
  const out = path.join(OUT_DIR, 'snapshot-keys-' + day + '.json');
  if (path.dirname(out) !== OUT_DIR) throw new Error('target outside the fixture folder');
  fs.writeFileSync(out, JSON.stringify({
    about: 'Field keys under metrics, timeseries and annual in the snapshots artifact of daily run ' + runId
      + ' (data day ' + day + '), with the number of snapshot files carrying each key. Keys and counts only, no values, no tickers.',
    files, filesWithContainers: withContainers, keys }, null, 2) + '\n');
  console.log('wrote ' + path.relative(process.cwd(), out) + ': ' + files + ' files, ' + Object.keys(keys).length + ' keys');
}

try { main(process.argv.slice(2)); } catch (err) { console.error(err.message); process.exit(1); }
