'use strict';
// B5: retained missing-cap snapshots must not enter equal-weight breadth.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = path.resolve(__dirname, '../..');
if (process.argv.includes('--break-once')) {
  const r = require('node:child_process').spawnSync(process.execPath, [__filename], {
    cwd: root, env: { ...process.env, B5_DM_MUTATION: '1' }, encoding: 'utf8',
  });
  assert.equal(r.status, 1); assert.match(r.stderr, /missing-cap observation entered breadth/);
  console.log('BREAK_ONCE breadth-leak exit=1 detected=true');
  process.exit(0);
}
const compile = Module.prototype._compile;
Module.prototype._compile = function (source, name) {
  if (process.env.B5_DM_MUTATION === '1' && name === path.join(root, 'lib/druckenmiller/universe.js')) {
    const anchor = 'snap.marketCap.missing === true && marketCapValue(snap.marketCap) === null';
    assert(source.includes(anchor)); source = source.replace(anchor, 'false');
  }
  return compile.call(this, source, name);
};
const dir = path.join(root, '_scratch', 'b5d-dm-virtual'), file = path.join(dir, 'B5DM.json');
const read = fs.readFileSync.bind(fs), list = fs.readdirSync.bind(fs);
let snapshot = { meta: { ticker: 'B5DM', country: 'United States', sector: 'Technology' } };
fs.readFileSync = (p, ...args) => path.resolve(p) === file ? JSON.stringify(snapshot) : read(p, ...args);
fs.readdirSync = (p, ...args) => path.resolve(p) === dir ? ['B5DM.json'] : list(p, ...args);
const { loadCandidates } = require('../../lib/druckenmiller/universe.js');
for (const value of [null, undefined, NaN, Infinity, -Infinity]) {
  snapshot.marketCap = { value, missing: true };
  const candidates = loadCandidates(dir);
  assert(!candidates.has('B5DM'), 'missing-cap observation entered breadth');
  assert.equal(candidates.missingMcap, 1);
}
for (const marketCap of [5e8, { value: 5e8 }, { value: 5e8, missing: true }]) {
  snapshot.marketCap = marketCap;
  const candidates = loadCandidates(dir);
  assert.equal(candidates.get('B5DM').marketCap, 5e8); assert.equal(candidates.missingMcap, 0);
}
snapshot.meta._newestQtrSuspect = true;
assert.equal(loadCandidates(dir).size, 0, 'existing data-suspect exclusion must remain');
console.log('PASS breadth guard: 5 missing, 3 finite controls, existing suspect exclusion; diskWrites=0');
