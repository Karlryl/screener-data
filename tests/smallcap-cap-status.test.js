'use strict';
// Named reasons behind smallcap/index.json and the export guard for measured floor exits.
// --break-once compiles the mutant in a child process in memory and never edits a production file.
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const WRITER = path.join(__dirname, '..', 'scripts', 'write-findash-export.js');
const GUARD = "snap?.marketCap?.belowFloor === true ?";

if (process.argv.includes('--break-once')) {
  const hash = () => crypto.createHash('sha256').update(fs.readFileSync(WRITER)).digest('hex');
  const before = hash();
  const r = cp.spawnSync(process.execPath, [__filename], { encoding: 'utf8', env: { ...process.env, SC_GUARD_MUTATION: '1' } });
  assert.equal(r.status, 1, 'mutant must fail, not pass or crash in the runner');
  assert.match(r.stderr, /floor exit must not reach a board/);
  assert.equal(hash(), before, 'live writer hash changed during break-once');
  console.log('BREAK_ONCE export-guard exit=1 detected=true');
  process.exit(0);
}

const compile = Module.prototype._compile;
Module.prototype._compile = function (source, name) {
  if (process.env.SC_GUARD_MUTATION === '1' && name === WRITER) {
    assert(source.includes(GUARD), 'mutation anchor missing');
    source = source.replace(GUARD, 'false ?');
  }
  return compile.call(this, source, name);
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-cap-status-'));
process.env.FINDASH_SMALLCAP_SNAPSHOTS_DIR = dir;
const { smallcapCapStatus } = require('../lib/size-exits.js');
const writer = require('../scripts/write-findash-export.js');
const { boardZeile } = require('./rule40-fixture.js');

const row = (ticker, marketCap) => ({ meta: { ticker, name: ticker + ' Inc' }, marketCap });
const fresh = '2026-10-29T12:00:00.000Z', old = '2026-10-15T11:00:00.000Z';
const store = [
  row('FRESH', { value: 4e8, asOf: fresh }),
  row('EXIT', { value: 2.3e8, asOf: fresh, belowFloor: true, floorUsd: 3e8 }),
  row('STALE', { value: 3.1e8, asOf: old }),
  row('NOCAP', { value: null, missing: true, asOf: fresh }),
  row('ORPHAN', { value: 9e8, asOf: old }),
  row('BACKUP', { value: 4e8, asOf: fresh, belowFloor: true, floorUsd: 3e8 }),
];
const status = smallcapCapStatus(store, new Set(['FRESH', 'EXIT', 'STALE', 'NOCAP', 'BACKUP']));
assert.deepEqual(status.counts, { belowFloor: 1, noFreshValue: 2 });
assert.deepEqual(status.belowFloor, [{ ticker: 'EXIT', name: 'EXIT Inc', marketCapUsd: 2.3e8, floorUsd: 3e8, date: '2026-10-29',
  reasonDe: 'unter der Größengrenze von 0,3 Mrd. USD am 29.10.2026' }]);
assert.deepEqual(status.noFreshValue.map(r => [r.ticker, r.marketCapUsd, r.date]), [['NOCAP', null, '2026-10-29'], ['STALE', 3.1e8, '2026-10-15']]);
assert.match(status.noFreshValue[1].reasonDe, /Kein frischer Abruf seit dem 15\.10\.2026, der letzte bekannte Börsenwert bleibt stehen/);
assert.match(status.noFreshValue[0].reasonDe, /lieferte keinen Börsenwert/);
console.log('PASS floor exit and missing fresh value are listed apart, each with a reason; orphans and fresh rows stay out');

// The export guard, same two directions on the real mapper.
const exit = { ...row('EXIT', { value: 2.3e8, asOf: fresh, belowFloor: true, floorUsd: 3e8 }), annual: {}, metrics: {}, timeseries: {} };
const kept = { ...row('KEPT', { value: 4e8, asOf: fresh }), annual: {}, metrics: {}, timeseries: {} };
for (const s of [exit, kept]) fs.writeFileSync(path.join(dir, s.meta.ticker + '.json'), JSON.stringify(s));
const original = console.error; const errors = []; console.error = (...a) => errors.push(a.join(' '));
const mapped = t => writer.mapBoardRow(boardZeile({ ticker: t, name: t, score: 50, marketCap: 4e8, ipoRecency: 'mature', profitStreak: null, coverageAxes: '7/7', track: 'profitable', revGrowthYoYPct: null }), 0, 'smallcap', 3e8);
const dropped = mapped('EXIT'), control = mapped('KEPT');
console.error = original;
assert.equal(dropped, null, 'floor exit must not reach a board');
assert.equal(control.ticker, 'KEPT');
assert(errors.some(e => e.includes('EXIT') && e.includes('unter der Mindestgröße')), 'the discarded row must be reported');
console.log('PASS export guard discards a measured floor exit with an error line and keeps a normal row');
