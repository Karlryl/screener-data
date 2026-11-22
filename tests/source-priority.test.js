'use strict';

// Run standalone: node tests/source-priority.test.js (exit 0 green, 1 red).
// Guard of the "SEC first" field registry (lib/source-priority.js): every field a snapshot carries under
// metrics, timeseries and annual needs an entry, and every entry has the agreed shape. Nothing here reads a number.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const { REGISTRY, CONTAINERS, fieldsOf, missingEntries } = require('../lib/source-priority.js');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('ok   ' + name); } catch (err) { failed++; console.log('FAIL ' + name + '\n     ' + err.message); }
};

// (a) Synthetic snapshot from the writers' real code: the pull mapper, the OpInc migration on top (adds
// annual.annualOpIncYahoo), and every container key pull-yahoo.js assigns after the mapper (FTS merges).
function syntheticSnapshot() {
  const log = console.log;
  console.log = () => {}; // pull-yahoo.js prints its FX table on load
  let snap;
  try {
    const { mapYahooToCanonical } = require('../pull-yahoo.js');
    const { migrateSnapshot } = require('../scripts/opinc-source-migrate.js');
    snap = mapYahooToCanonical({ summaryDetail: { marketCap: 1 }, incomeStatementHistory: { incomeStatementHistory: [
      { endDate: '2025-12-31', totalRevenue: 100, operatingIncome: 10 },
      { endDate: '2024-12-31', totalRevenue: 90, operatingIncome: 8 }] } }, { ticker: 'SYNTH' }, '2026-11-21T00:00:00Z');
    const r = migrateSnapshot(snap, { annualRev: [{ value: 100 }, { value: 90 }], annualOpInc: [{ value: 11 }, { value: 9 }] });
    assert.equal(r.reason, 'sec-preferred', 'synthetic SEC layer must take the migration path that adds annualOpIncYahoo');
  } finally { console.log = log; }
  const src = fs.readFileSync(path.join(ROOT, 'pull-yahoo.js'), 'utf8');
  for (const m of src.matchAll(/\b(?:canonical|snap)\.(metrics|timeseries|annual)\.([A-Za-z0-9_]+)\s*=(?!=)/g)) {
    if (!Object.hasOwn(snap[m[1]], m[2])) snap[m[1]][m[2]] = [];
  }
  return snap;
}

// (b) Real key lists of the 21.11. snapshots (keys and counts only).
const FIXTURE = path.join(__dirname, 'fixtures', 'source-priority', 'snapshot-keys-2026-11-21.json');
const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const KEY = /^(metrics|timeseries|annual)\.[A-Za-z0-9_]+$/;

check('fixture holds key names and counts only', () => {
  const keys = Object.keys(fixture.keys);
  assert.ok(keys.length > 50, 'fixture has ' + keys.length + ' keys');
  for (const k of keys) {
    assert.match(k, KEY);
    assert.ok(Number.isInteger(fixture.keys[k]) && fixture.keys[k] > 0 && fixture.keys[k] <= fixture.files, k);
  }
});

check('every key of the 21.11. snapshots has an entry', () => {
  const snap = {};
  for (const k of Object.keys(fixture.keys)) {
    const [c, f] = k.split('.');
    (snap[c] = snap[c] || {})[f] = null;
  }
  assert.deepEqual(missingEntries(snap), []);
});

const synth = syntheticSnapshot();
check('synthetic writer snapshot carries the post-mapper fields', () => {
  for (const k of ['annual.annualOpIncYahoo', 'annual.annualSBC', 'annual.annualCapex', 'timeseries.revenueQ', 'metrics.fcfMarginTTM']) {
    assert.ok(fieldsOf(synth).includes(k), k);
  }
});
check('every field of the synthetic writer snapshot has an entry', () => assert.deepEqual(missingEntries(synth), []));

check('break once: an unknown field turns the guard red', () => {
  const broken = { ...synth, metrics: { ...synth.metrics, zzUnregisteredField: null } };
  assert.deepEqual(missingEntries(broken), ['metrics.zzUnregisteredField']);
  assert.deepEqual(missingEntries(synth), [], 'the original stays green');
});

check('fieldsOf ignores absent and non-object containers', () => {
  assert.deepEqual(fieldsOf(null), []);
  assert.deepEqual(fieldsOf({ metrics: null, timeseries: [], annual: { b: 1, a: 2 }, external: { x: 1 } }), ['annual.a', 'annual.b']);
});

const PERIODS = new Set(['quarter', 'ttm', 'year', 'point']);
const STATUS = new Set(['live', 'planned', 'unknown']);
const nonEmpty = v => typeof v === 'string' && v.trim().length > 0;
function shapeErrors(k, v) {
  const errs = [];
  if (!KEY.test(k) || !CONTAINERS.includes(k.split('.')[0])) errs.push('key');
  const fields = v && typeof v === 'object' ? Object.keys(v).sort().join() : '';
  if (fields !== 'fallback,note,period,status,target,today') errs.push('fields ' + fields);
  if (!PERIODS.has(v?.period)) errs.push('period');
  if (!STATUS.has(v?.status)) errs.push('status');
  for (const f of ['today', 'fallback', 'note']) if (!nonEmpty(v?.[f])) errs.push(f);
  if (!Array.isArray(v?.target) || !v.target.length || !v.target.every(nonEmpty)) errs.push('target');
  else if (v.target.some(t => t.startsWith('sec:')) && v.target.includes('market')) errs.push('target mixes sec and market');
  return errs;
}
check('every entry is well-formed and frozen', () => {
  assert.ok(Object.isFrozen(REGISTRY));
  for (const [k, v] of Object.entries(REGISTRY)) {
    assert.deepEqual(shapeErrors(k, v), [], k);
    assert.ok(Object.isFrozen(v) && Object.isFrozen(v.target), k + ' frozen');
  }
});
check('break once: the shape check rejects a malformed entry', () => {
  const good = REGISTRY['metrics.revenueTTM'];
  assert.deepEqual(shapeErrors('metrics.x', { ...good, period: 'month' }), ['period']);
  assert.deepEqual(shapeErrors('metrics.x', { ...good, target: [] }), ['target']);
  assert.deepEqual(shapeErrors('price.x', { ...good, status: 'done', note: '' }), ['key', 'status', 'note']);
});

console.log(Object.keys(REGISTRY).length + ' registered keys; '
  + Object.values(REGISTRY).filter(v => v.status === 'planned').length + ' planned');
if (failed) { console.log(failed + ' check(s) failed'); process.exit(1); }
