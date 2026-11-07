'use strict';
// Named reasons in smallcap/index.json, the --check that binds them, and the export guard for floor exits.
// --break-once compiles each mutant in a child process in memory and never edits a production file.
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const WRITER = path.join(__dirname, '..', 'scripts', 'write-findash-export.js');
const MUTANTS = {
  // Whole line of each guard, whatever the line ending.
  'export-guard': [/^ *: snap\?\.marketCap\?\.belowFloor === true \? `Gemessener Börsenwert .*`  ?: null,(?=\r?$)/m, '      : null,', /floor exit must not reach a board/],
  'check-guard': [/^ *if \(mk\.namedReasons != null\) \{(?=\r?$)/m, '  if (false) {', /--check must catch a wrong reason list/],
  'reference-guard': [/^ *if \(mk\.reference != null && .*\{(?=\r?$)/m, '  if (false) {', /--check must catch a floor that left the fixed reference/],
  'not-monitored-guard': [/^ *if \(notMonitored != null && .*;(?=\r?$)/m, '', /--check must catch a group named without its reason/],
  'sign-basis-guard': [/^ *const badSignBasis = .*;(?=\r?$)/m, '  const badSignBasis = () => false;', /--check must catch a sign basis without axis, a valid sign or its values/],
  // The state before this fix: raw store rows decide.
  'held-row-listed': [/^ *const listable = new Set\(.*;(?=\r?$)/m, '  const listable = new Set(readJSON(watchlist).stocks.map(s => s.ticker));', /a row a guard holds must not be listed/],
  'any-empty-value-held': [/^ *const held = new Set\(.*;(?=\r?$)/m, '  const held = new Set(rows.filter(row => { const seen = marketCapGuard.prepareMarketCap(row); return !Number.isFinite(seen.marketCap?.value); }).map(row => row.meta?.ticker));', /an empty value without a guard stays listed/],
  'table-instead-of-reader': [/^ *const held = new Set\(.*;(?=\r?$)/m, '  const held = new Set(rows.filter(row => marketCapGuard.holds[row.meta?.ticker] || marketCapGuard.table[row.meta?.ticker]).map(row => row.meta?.ticker));', /a hold not yet valid stays listed/],
  'held-rows-lose-their-clock': [/^ *const status = smallcapCapStatus\(rows, listable, .*;(?=\r?$)/m, "  const status = smallcapCapStatus(rows.filter(row => !held.has(row.meta?.ticker)), listable, require('../src/scoring/smallcap-route.js').MAX_MCAP);", /the clock of a held row still counts for the newest day/],
};

if (process.argv.includes('--break-once')) {
  const hash = () => crypto.createHash('sha256').update(fs.readFileSync(WRITER)).digest('hex');
  const before = hash();
  for (const [name, [, , expected]] of Object.entries(MUTANTS)) {
    const r = cp.spawnSync(process.execPath, [__filename], { encoding: 'utf8', env: { ...process.env, SC_GUARD_MUTATION: name } });
    assert.equal(r.status, 1, name + ' must fail, not pass or crash in the runner');
    assert.match(r.stderr, expected);
    assert.equal(hash(), before, 'live writer hash changed during break-once');
    console.log('BREAK_ONCE ' + name + ' exit=1 detected=true');
  }
  process.exit(0);
}

const compile = Module.prototype._compile;
Module.prototype._compile = function (source, name) {
  const mutant = MUTANTS[process.env.SC_GUARD_MUTATION];
  if (mutant && name === WRITER) {
    assert.equal((source.match(new RegExp(mutant[0].source, 'gm')) || []).length, 1, 'mutation anchor must hit exactly one whole line');
    source = source.replace(mutant[0], mutant[1]);
  }
  return compile.call(this, source, name);
};

const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sc-cap-status-')), 'store');
const outputs = path.dirname(dir);
process.env.FINDASH_SMALLCAP_SNAPSHOTS_DIR = dir;
const { smallcapCapStatus } = require('../lib/size-exits.js');
const writer = require('../scripts/write-findash-export.js');
const { boardZeile } = require('./rule40-fixture.js');

const row = (ticker, marketCap) => ({ meta: { ticker, name: ticker + ' Inc' }, marketCap });
const fresh = '2026-10-29T12:00:00.000Z', old = '2026-10-15T11:00:00.000Z';
const store = [
  row('FRESH', { value: 4e8, asOf: fresh }),
  row('EXIT', { value: 2.3e8, asOf: fresh, belowFloor: true, floorUsd: 3e8 }),
  row('HIGH', { value: 9e8, asOf: fresh }),
  row('STALE', { value: 3.1e8, asOf: old }),
  row('NOCAP', { value: null, missing: true, asOf: fresh }),
  row('ORPHAN', { value: 9e8, asOf: old }),
  row('BACKUP', { value: 4e8, asOf: fresh, belowFloor: true, floorUsd: 3e8 }),
  row('STAMPED', { value: 2.4e8, asOf: fresh, belowFloor: true, floorUsd: 3e8, regularMarketTime: '2026-10-28T20:00:01.000Z' }),
];
const status = smallcapCapStatus(store, new Set(['FRESH', 'EXIT', 'HIGH', 'STALE', 'NOCAP', 'BACKUP', 'STAMPED']), 8e8);
assert.deepEqual(status.counts, { belowFloor: 2, aboveBand: 1, noFreshValue: 2 });
assert.deepEqual(status.belowFloor[0], { ticker: 'EXIT', name: 'EXIT Inc', marketCapUsd: 2.3e8, floorUsd: 3e8, date: '2026-10-29',
  reasonDe: 'unter der Größengrenze von 0,3 Mrd. USD am 29.10.2026' });
assert.deepEqual(status.belowFloor[1], { ticker: 'STAMPED', name: 'STAMPED Inc', marketCapUsd: 2.4e8, floorUsd: 3e8, date: '2026-10-28',
  reasonDe: 'unter der Größengrenze von 0,3 Mrd. USD am 28.10.2026' }, 'the reason names the day of the quote, not the pull clock');
assert.equal(status.aboveBand[0].reasonDe, 'über der Obergrenze von 0,8 Mrd. USD am 29.10.2026');
assert.deepEqual(status.noFreshValue.map(r => [r.ticker, r.marketCapUsd, r.date]), [['NOCAP', null, '2026-10-29'], ['STALE', 3.1e8, '2026-10-15']]);
assert.match(status.noFreshValue[1].reasonDe, /Kein frischer Wert seit dem 15\.10\.2026, der letzte bekannte Börsenwert bleibt stehen/);
assert.match(status.noFreshValue[0].reasonDe, /lieferte keinen Börsenwert/);
console.log('PASS each way of losing a current size is listed apart with a reason; orphans and fresh rows stay out');

// A row the real scorer routes and scores, on a ticker of the real watchlist.
const wl = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'watchlist-smallcap.json'), 'utf8')).stocks;
const scored = (ticker, value) => ({
  meta: { ticker, name: ticker + ' Inc', country: 'United States', sector: 'Technology', industry: 'Semiconductors', reportingCurrency: 'USD', reportingCurrencyOriginal: 'USD', fxRateApplied: 1, asOf: fresh, fetchedAt: fresh, fundamentalsAsOf: fresh },
  marketCap: { value, source: 'yahoo_quote', confidence: 0.9, asOf: fresh },
  annual: { annualRev: [1e9, 8e8, 6e8, 4e8], annualOpInc: [2e8, 1.4e8, 1e8, 6e7], annualNetIncome: [1.5e8, 1e8, 7e7, 4e7], annualGP: [5e8, 3.6e8, 2.4e8, 1.6e8], annualFCF: [1.6e8, 1.1e8, 8e7, 5e7], annualOCF: [1.8e8, 1.2e8, 9e7, 6e7], annualSGA: [1e8, 8e7, 6e7, 4e7], annualShares: [1e8, 1e8, 1e8, 1e8], annualBalance: [{ currentAssets: 1e9, currentLiabilities: 2e8, totalLiabilities: 3e8 }] },
  timeseries: { revenueQ: [3e8, 2.6e8, 2.4e8, 2e8, 1.8e8, 1.6e8, 1.5e8, 1.1e8].map(v => ({ value: v })) }, metrics: {},
});
const index = (coverageFloor, excluded = {}) => {
  fs.writeFileSync(path.join(outputs, 'index.json'), JSON.stringify({ generatedFromSnapshots: 1, boards: [], boardStatus: {}, counts: {}, excluded, coverageFloor }));
  return writer.buildSmallcapIndex(null, outputs);
};
const log = console.log, warn = console.warn, original = console.error, errors = [];
console.log = console.warn = () => {}; console.error = (...a) => errors.push(a.join(' '));
const noStore = index(1.01).namedReasons;
fs.mkdirSync(dir);
const emptyStore = index(1.01).namedReasons;
const [a, b] = wl.slice(0, 2).map(s => s.ticker);
fs.writeFileSync(path.join(dir, a + '.json'), JSON.stringify(scored(a, 4e8)));
fs.writeFileSync(path.join(dir, b + '.json'), JSON.stringify({ ...scored(b, 2.3e8), marketCap: { value: 2.3e8, asOf: fresh, belowFloor: true, floorUsd: 3e8 } }));
const filled = index(1.01).namedReasons;

// The export guard on the real mapper, same two directions.
const mapped = t => writer.mapBoardRow(boardZeile({ ticker: t, name: t, score: 50, marketCap: 4e8, ipoRecency: 'mature', profitStreak: null, coverageAxes: '7/7', track: 'profitable', revGrowthYoYPct: null }), 0, 'smallcap', 3e8);
const dropped = mapped(b), control = mapped(a);
// A row a guard holds shows no value, so no list may say anything about its size or its last value. Read raw, a pull
// clock behind the store's newest day would say "the last value stays". The control row has no guard and the same clock.
const { holds } = require('../lib/market-cap-guard.js');
const onList = wl.map(s => s.ticker);
const [heldBehind, heldEmpty, notYetValid, heldNewest] = onList.filter(t => holds[t] && holds[t].validFrom <= old.slice(0, 10));
const [plainBehind, plainEmpty] = onList.filter(t => t !== a && t !== b && !holds[t]);
const putRow = (t, marketCap) => fs.writeFileSync(path.join(dir, t + '.json'), JSON.stringify({ ...scored(t, marketCap.value), marketCap }));
putRow(heldBehind, { value: 4e8, source: 'yahoo_quote', asOf: old });
putRow(heldEmpty, { value: null, missing: true, asOf: fresh });
putRow(plainBehind, { value: 4e8, source: 'yahoo_quote', asOf: old });
// No guard, empty value: the pull really delivered none, so the row stays. A hold before its validFrom holds nothing yet.
putRow(plainEmpty, { value: null, missing: true, asOf: fresh });
putRow(notYetValid, { value: 4e8, source: 'yahoo_quote', asOf: new Date(Date.parse(holds[notYetValid].validFrom) - 86400000).toISOString() });
const guarded = index(1.01).namedReasons;
// A held row alone carries the newest day: its pull happened that day, so the firms behind it have no fresh value.
putRow(heldNewest, { value: null, missing: true, asOf: '2026-10-30T12:00:00.000Z' });
const clockKept = index(1.01).namedReasons;
console.log = log; console.warn = warn; console.error = original;
assert(heldBehind && heldEmpty && notYetValid && heldNewest && plainBehind && plainEmpty, 'test data: four hand holds and two plain rows on the real watchlist');
const listed = ['belowFloor', 'aboveBand', 'noFreshValue', 'thinCoverage'].flatMap(k => guarded[k]).map(r => r.ticker);
assert(!listed.includes(heldBehind), 'a row a guard holds must not be listed: pull clock behind the newest day');
assert(!listed.includes(heldEmpty), 'a row a guard holds must not be listed: no value in the store');
const stale = names => names.noFreshValue.map(r => r.ticker);
assert(stale(guarded).includes(plainEmpty), 'an empty value without a guard stays listed');
assert(stale(guarded).includes(notYetValid), 'a hold not yet valid stays listed');
assert.deepEqual(stale(guarded), [plainBehind, plainEmpty, notYetValid].sort(), 'a row no guard holds stays listed');
assert(!stale(guarded).includes(a), 'test data: this row is not behind the newest day yet');
assert(stale(clockKept).includes(a), 'the clock of a held row still counts for the newest day');
assert(!stale(clockKept).includes(heldNewest), 'a row a guard holds must not be listed: it carries the newest day');
console.log('PASS a row a guard holds stands in no list and its clock still counts; an empty value without a guard, a hold not yet valid and a row with the same clock stay');
assert.equal(noStore, null, 'no store means no statement'); assert.equal(emptyStore, null, 'an empty store means no statement');
assert.deepEqual(filled.belowFloor.map(r => r.ticker), [b]);
assert.deepEqual(filled.thinCoverage.map(r => r.ticker), [a], 'the scored firm under the coverage floor must be named');
assert.equal(filled.counts.thinCoverage, 1); assert.match(filled.thinCoverage[0].reasonDe, /^Zu wenig belegte Kennzahlen: Abdeckung [\d,]+ unter der festen Grenze 1,010\.$/);
console.log('PASS named reasons on a real small store: none without a store, floor exit and thin coverage named');
assert.equal(dropped, null, 'floor exit must not reach a board');
assert.equal(control.ticker, a);
assert(errors.some(e => e.includes(b) && e.includes('unter der Mindestgröße')), 'the discarded row must be reported');
console.log('PASS export guard discards a measured floor exit with an error line and keeps a normal row');

// --check: what it says about the reason lists, in both directions.
const check = (namedReasons, excluded = { 'smallcap-thin-coverage': 1 }) => {
  const errs = [];
  writer.validateSmallcapIndex({ excluded, namedReasons }, errs);
  return errs.filter(e => e.includes('namedReasons'));
};
assert.deepEqual(check(filled), [], 'a clean list must pass');
assert.deepEqual(check(null), [], 'no store stays legal');
const broke = (name, change, excluded) => {
  const copy = structuredClone(filled); change(copy);
  assert.equal(check(copy, excluded).length > 0, true, '--check must catch a wrong reason list: ' + name);
};
broke('count off by one', c => { c.counts.belowFloor++; });
broke('row without a reason', c => { delete c.belowFloor[0].reasonDe; });
broke('missing list', c => { delete c.aboveBand; });
broke('thin coverage against the sealed count', () => {}, { 'smallcap-thin-coverage': 2 });
console.log('PASS --check catches a wrong count, a row without a reason, a missing list and a drift against the sealed count');

// --check: the floor in force is the floor of the fixed reference.
const checkReference = (coverageFloor, reference) => {
  const errs = [];
  writer.validateSmallcapIndex({ excluded: {}, coverageFloor, reference }, errs);
  return errs.filter(e => e.includes('reference'));
};
assert.deepEqual(checkReference(0.58, { version: 'x', coverageFloor: 0.58 }), [], 'matching reference must pass');
assert.deepEqual(checkReference(0.58, null), [], 'an older export without a reference stays legal');
assert.equal(checkReference(0.6, { version: 'x', coverageFloor: 0.58 }).length, 1, '--check must catch a floor that left the fixed reference');
assert.equal(checkReference(0.58, { coverageFloor: 0.58 }).length, 1, '--check must catch a floor that left the fixed reference: no version');
const withGroups = notMonitored => checkReference(0.58, { version: 'x', coverageFloor: 0.58, notMonitored });
assert.deepEqual(withGroups([{ group: 'smallcap-materials', firms: 12, reasonDe: 'Nur 12 Firmen.' }]), [], 'a named group must pass');
assert.deepEqual(withGroups([]), [], 'nothing unwatched must pass');
for (const bad of [[{ group: 'smallcap-materials', firms: 12 }], [{ firms: 12, reasonDe: 'x' }], [{ group: 'x', reasonDe: 'x' }], 'smallcap-materials']) {
  assert.equal(withGroups(bad).length, 1, '--check must catch a group named without its reason: ' + JSON.stringify(bad));
}
// A named sign basis also carries its axis, a known sign and its usable values (R30: each of these was let through).
const signBasis = { group: 'smallcap-real-estate', axis: 'capitalEfficiency', sign: 'unprofitable', firms: 5, values: 4, reasonDe: 'Nur 4 Werte.' };
assert.deepEqual(withGroups([signBasis, { ...signBasis, sign: 'unknown', firms: 1, values: 0 }, { ...signBasis, values: 5 }]), [], 'a named sign basis must pass');
const without = k => { const g = { ...signBasis }; delete g[k]; return g; };
for (const bad of [without('axis'), without('sign'), without('values'), { ...signBasis, sign: 'nonsense', values: -7 }, { ...signBasis, sign: 'nonsense' },
  { ...signBasis, values: -1 }, { ...signBasis, values: 1.5 }, { ...signBasis, values: 6 }, { ...signBasis, values: '4' }, { ...signBasis, axis: '' }, { ...signBasis, firms: -1, values: 0 }, null]) {
  assert.equal(withGroups([bad]).length, 1, '--check must catch a sign basis without axis, a valid sign or its values: ' + JSON.stringify(bad));
}
console.log('PASS --check binds the floor in force to the fixed reference and every unwatched group to its reason');
