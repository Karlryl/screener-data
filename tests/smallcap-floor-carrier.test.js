'use strict';
// The rule for a floor-exit carrier (quote time, USD origin, real numbers, configured floor) and the merge that
// refuses a broken input before its first write. Files only under the OS temp folder.
// --break-once compiles each mutant in a child process in memory and never edits a production file.
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const LIB = path.join(__dirname, '..', 'lib', 'size-exits.js');
const PULL = path.join(__dirname, '..', 'pull-yahoo.js');
const MUTANTS = {
  // Whole line of each guard, whatever the line ending.
  'stale-quote': [LIB, /^  if \(age > FLOOR_EXIT_QUOTE_MAX_WEEKDAYS\) return .*;(?=\r?$)/m, '', /an old quote must be refused/],
  'no-quote-time': [LIB, /^  if \(!quoted\) return 'no quote time';(?=\r?$)/m, '  if (!quoted) return null;', /a missing quote time must be refused/],
  'future-quote': [LIB, /^  if \(quoteDay > observedDay\) return .*;(?=\r?$)/m, '', /a quote after the observation must be refused/],
  'no-usd-origin': [LIB, /^  if \(!origin \|\| typeof origin\.currency .*;(?=\r?$)/m, '  if (!origin) return null;', /a missing USD origin must be refused/],
  'unproven-rate': [LIB, /^  if \(isUsd \? origin\.factor .*;(?=\r?$)/m, '', /an unproven rate must be refused/],
  'value-not-following': [LIB, /^  if \(Math\.abs\(origin\.rawValue .*;(?=\r?$)/m, '', /a value that does not follow from its quote must be refused/],
  'string-value': [LIB, /^  const isPositive = x => .*;(?=\r?$)/m, '  const isPositive = x => x > 0;', /a number as a string must be refused/],
  'any-floor': [LIB, /^  if \(cap\.floorUsd !== floorUsd\) return .*;(?=\r?$)/m, '', /a floor other than the configured one must be refused/],
  'partial-merge': [PULL, /^  assertSmallcapObservations\(incomingDir, outputDir\);(?=\r?$)/m, '', /nothing may be written/],
};

if (process.argv.includes('--break-once')) {
  const hash = () => [LIB, PULL].map(f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')).join();
  const before = hash();
  for (const [name, [, , , expected]] of Object.entries(MUTANTS)) {
    const r = cp.spawnSync(process.execPath, [__filename], { encoding: 'utf8', env: { ...process.env, SC_CARRIER_MUTATION: name } });
    assert.equal(r.status, 1, name + ' must fail, not pass or crash in the runner');
    assert.match(r.stderr, expected);
    assert.equal(hash(), before, 'live source hash changed during break-once');
    console.log('BREAK_ONCE ' + name + ' exit=1 detected=true');
  }
  process.exit(0);
}

const compile = Module.prototype._compile;
Module.prototype._compile = function (source, name) {
  const mutant = MUTANTS[process.env.SC_CARRIER_MUTATION];
  if (mutant && name === mutant[0]) {
    assert.equal((source.match(new RegExp(mutant[1].source, 'gm')) || []).length, 1, 'mutation anchor must hit exactly one whole line');
    source = source.replace(mutant[1], mutant[2]);
  }
  return compile.call(this, source, name);
};

const { quoteStamp, floorExitFault, FLOOR_EXIT_QUOTE_MAX_WEEKDAYS } = require('../lib/size-exits.js');
const { mergeSmallcapSnapshots } = require('../pull-yahoo.js');
const FLOOR = require('../configs/market-cap-floors.json').smallcapUsd;

// Saturday morning, the last close was Friday evening.
const cap = (over = {}) => ({ value: 2e8, floorUsd: FLOOR, belowFloor: true, source: 'yahoo_quoteSummary', asOf: '2026-10-31T12:00:00.000Z',
  regularMarketTime: '2026-10-30T20:00:01.000Z', usdOrigin: { currency: 'USD', rawValue: 2e8, factor: 1, rateSource: 'identity' }, ...over });

assert.equal(quoteStamp(new Date('2026-10-30T20:00:01Z')), '2026-10-30T20:00:01.000Z');
assert.equal(quoteStamp(1793390401), '2026-10-30T20:00:01.000Z', 'epoch seconds');
assert.equal(quoteStamp(1793390401000), '2026-10-30T20:00:01.000Z', 'epoch milliseconds');
assert.equal(quoteStamp('2026-10-30T20:00:01Z'), '2026-10-30T20:00:01.000Z');
assert.equal(quoteStamp({ raw: 1793390401 }), '2026-10-30T20:00:01.000Z');
for (const missing of [0, -1, null, undefined, 'x', NaN, 1e20, {}]) assert.equal(quoteStamp(missing), null, 'missing stamp: ' + missing);
console.log('PASS quote stamp reads every form and never turns a missing time into 01.01.1970');

assert.equal(floorExitFault(cap(), FLOOR), null, 'a normal prior-day close is a measurement');
assert.equal(floorExitFault(cap({ asOf: '2026-10-30T22:00:00.000Z', regularMarketTime: '2026-10-30T20:00:01.000Z' }), FLOOR), null, 'same-day close');
assert.equal(floorExitFault(cap({ asOf: '2026-11-02T06:00:00.000Z' }), FLOOR), null, 'Friday close on Monday morning');
// The boundary, in weekdays after the quote day: Friday 30.10. plus 7 weekdays is Tuesday 10.11., plus 8 Wednesday 11.11.
assert.equal(FLOOR_EXIT_QUOTE_MAX_WEEKDAYS, 7);
assert.equal(floorExitFault(cap({ asOf: '2026-11-10T06:00:00.000Z' }), FLOOR), null, 'exactly at the limit');
assert.match(floorExitFault(cap({ asOf: '2026-11-11T06:00:00.000Z' }), FLOOR) ?? '', /older than 7 weekdays/, 'an old quote must be refused');
assert.match(floorExitFault(cap({ regularMarketTime: '2001-01-01T00:00:00.000Z' }), FLOOR) ?? '', /older than/, 'an old quote must be refused');
assert.match(floorExitFault(cap({ regularMarketTime: undefined }), FLOOR) ?? '', /no quote time/, 'a missing quote time must be refused');
assert.match(floorExitFault(cap({ regularMarketTime: '2026-11-01T10:00:00.000Z' }), FLOOR) ?? '', /later than/, 'a quote after the observation must be refused');
console.log('PASS quote age: prior-day close and weekend pass, the limit is exact, old, missing and future quotes are refused');

const stale79 = require('../lib/market-cap-guard.js').STALE_PRICE_WEEKDAYS;
if (stale79 !== undefined) assert.equal(FLOOR_EXIT_QUOTE_MAX_WEEKDAYS, stale79, 'carrier and stale-price gate (#79) must age a quote alike');

assert.match(floorExitFault(cap({ usdOrigin: undefined }), FLOOR) ?? '', /no USD origin/, 'a missing USD origin must be refused');
assert.match(floorExitFault(cap({ usdOrigin: { currency: '', rawValue: 2e8, factor: 1, rateSource: 'identity' } }), FLOOR) ?? '', /no USD origin/, 'a missing USD origin must be refused');
assert.match(floorExitFault(cap({ usdOrigin: { currency: 'USD', rawValue: 2e8, factor: 1, rateSource: 'live' } }), FLOOR) ?? '', /not proven/, 'an unproven rate must be refused');
assert.match(floorExitFault(cap({ usdOrigin: { currency: 'USD', rawValue: 1.6e8, factor: 1.25, rateSource: 'identity' } }), FLOOR) ?? '', /not proven/, 'an unproven rate must be refused');
assert.match(floorExitFault(cap({ usdOrigin: { currency: 'HKD', rawValue: 1.56e9, factor: 2e8 / 1.56e9, rateSource: 'fallback-hardcoded' } }), FLOOR) ?? '', /not proven/, 'an unproven rate must be refused');
assert.equal(floorExitFault(cap({ usdOrigin: { currency: 'HKD', rawValue: 1.56e9, factor: 2e8 / 1.56e9, rateSource: 'live' } }), FLOOR), null, 'a live rate proves a converted value');
assert.match(floorExitFault(cap({ usdOrigin: { currency: 'USD', rawValue: 9e8, factor: 1, rateSource: 'identity' } }), FLOOR) ?? '', /does not follow/, 'a value that does not follow from its quote must be refused');
console.log('PASS USD origin: identity for a USD quote, a live rate otherwise, and the value has to follow from both');

for (const bad of ['200000000', null, undefined, NaN, Infinity, 0, -5, {}, [2e8], true]) {
  assert.match(floorExitFault(cap({ value: bad }), FLOOR) ?? '', /not a positive number/, 'a number as a string must be refused: ' + bad);
}
assert.match(floorExitFault(cap({ floorUsd: 8e8 }), FLOOR) ?? '', /configured/, 'a floor other than the configured one must be refused');
assert.match(floorExitFault(cap({ floorUsd: '300000000' }), FLOOR) ?? '', /configured/, 'a floor other than the configured one must be refused');
assert.match(floorExitFault(cap({ value: FLOOR, usdOrigin: { currency: 'USD', rawValue: FLOOR, factor: 1, rateSource: 'identity' } }), FLOOR) ?? '', /not below/);
assert.match(floorExitFault(cap({ asOf: 'gestern' }), FLOOR) ?? '', /no observation time/);
console.log('PASS numbers: a string, an empty, a non-finite or a non-positive value and any other floor are refused');

// The merge on real files.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-floor-carrier-'));
const incoming = path.join(tmp, 'incoming'), store = path.join(tmp, 'store');
fs.mkdirSync(incoming); fs.mkdirSync(store);
const stored = t => ({ meta: { ticker: t, name: t + ' Inc', fetchedAt: '2026-10-15T11:00:00.000Z' }, annual: { annualRev: [1e9, 8e8] }, marketCap: { value: 3.2e8, source: 'yahoo_quote', asOf: '2026-10-15T11:00:00.000Z' } });
const carrier = (t, over) => ({ meta: { ticker: t, asOf: null, fetchedAt: null, fundamentalsAsOf: null, fundamentalsIncomplete: true }, annual: {}, metrics: {}, timeseries: {}, marketCap: cap(over) });
const put = (dir, t, row) => fs.writeFileSync(path.join(dir, t + '.json'), typeof row === 'string' ? row : JSON.stringify(row));
const storeBytes = () => Object.fromEntries(fs.readdirSync(store).sort().map(f => [f, fs.readFileSync(path.join(store, f), 'utf8')]));
const clear = dir => { for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f)); };
const error = console.error, seen = [];
const refused = () => { console.error = (...a) => seen.push(a.join(' ')); try { return assert.throws(() => mergeSmallcapSnapshots(incoming, store), /nothing written/, 'nothing may be written on a refused merge'); } finally { console.error = error; } };

for (const t of ['AAA', 'ZZZ']) put(store, t, stored(t));
const untouched = storeBytes();
put(incoming, 'AAA', carrier('AAA'));
put(incoming, 'ZZZ', carrier('ZZZ', { value: '200000000' }));
refused();
assert.deepEqual(storeBytes(), untouched, 'nothing may be written while one carrier is invalid');
assert(seen.some(l => l.startsWith('::error::') && l.includes('1 invalid of 2 rows') && l.includes('ZZZ.json')), 'the job status must count and name the invalid row');
put(incoming, 'ZZZ', carrier('ZZZ', { regularMarketTime: '2001-01-01T00:00:00.000Z' }));
refused();
assert.deepEqual(storeBytes(), untouched, 'nothing may be written while one carrier is stale');
put(incoming, 'ZZZ', carrier('ZZZ'));
put(store, 'ZZZ', '{broken');
refused();
assert.equal(JSON.parse(storeBytes()['AAA.json']).marketCap.value, 3.2e8, 'nothing may be written while a stored row is broken');
put(store, 'ZZZ', stored('ZZZ'));
put(incoming, 'MMM', '{broken');
refused();
assert.deepEqual(storeBytes(), untouched, 'nothing may be written while an incoming row is unreadable');
fs.unlinkSync(path.join(incoming, 'MMM.json'));
put(incoming, 'NEW', { ...stored('NEW'), marketCap: { value: 4e8, source: 'yahoo_quote', asOf: '2026-10-31T12:00:00.000Z' } });
put(incoming, 'GONE', carrier('GONE'));
const result = mergeSmallcapSnapshots(incoming, store);
assert.deepEqual(result, { missingMarketCaps: 0, floorExits: 2 });
const after = JSON.parse(storeBytes()['AAA.json']);
assert.equal(after.marketCap.value, 2e8);
assert.equal(after.marketCap.regularMarketTime, '2026-10-30T20:00:01.000Z', 'the store keeps the quote time');
assert.equal(after.marketCap.usdOrigin.currency, 'USD', 'the store keeps the USD origin');
assert.deepEqual(after.annual, stored('AAA').annual); assert.deepEqual(after.meta, stored('AAA').meta);
assert(!fs.existsSync(path.join(store, 'GONE.json')), 'a carrier never creates a row');
assert.equal(JSON.parse(storeBytes()['NEW.json']).marketCap.value, 4e8, 'a full row is written as a full row');
clear(incoming);
console.log('PASS merge: one invalid row refuses all with the count in the job status, valid carriers change only the market cap');
