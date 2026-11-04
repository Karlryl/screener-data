'use strict';
// Guard: a small-cap row the market-cap guard withholds must not vanish silently.
//
// FINDING (blind review of PR #79, B1): a stale quote stamp emptied the value of a small-cap row, the row left the boards,
// and only the counter smallcap-mcap-missing in smallcap/index.json moved; neither its name nor its reason stood anywhere.
// The main store names such rows in excluded.json. smallcap/index.json now carries them next to its counters.
// This test runs the REAL guard, the REAL scoring loader and the REAL export functions on a small store in a temp folder:
//   presence  - stale stamp, known hold without a stamp and a hand hold are named with ticker, name and German reason
//   absence   - a current stamp, no stamp, a row without a value, a shown value with its own reason and a stale row off the watchlist are not named
//   no store  - null, because the pass then ran on the main store and excluded.json names its rows
//   wiring    - buildSmallcapIndex writes the field next to excluded
//   check     - a row dropped from the list, an added row, the list removed or null, a reason that is not the store's, a blank reason,
//               a missing name key and a name that is neither text nor null turn --check red
//   empty     - a known hold stays named after an empty Yahoo answer, through the real pullAll, preparation, export and --check
// Break-once runs on every start: the export source is compiled in memory with one whole line replaced (nothing is written,
// the live file is hashed before and after) and the presence or the check above has to fail for its own reason.
process.env.RUN_DATE_UTC = '2026-10-31';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const EXPORT_FILE = path.join(ROOT, 'scripts/write-findash-export.js');
const sha = () => crypto.createHash('sha256').update(fs.readFileSync(EXPORT_FILE)).digest('hex');
const before = sha();
const guard = require('../lib/market-cap-guard.js');
const realWatchlist = JSON.parse(fs.readFileSync(path.join(ROOT, 'watchlist-smallcap.json'), 'utf8'));
const onWatchlist = realWatchlist.stocks[0].ticker;
const HAND_HOLD = 'ARX.TO';

const AS_OF = '2026-10-31T08:40:00.000Z', STALE = '2026-09-15T20:00:00.000Z', FRESH = '2026-10-30T20:00:00.000Z';
const row = (ticker, stamp, extra = {}) => ({
  meta: { ticker, name: `${ticker} Inc.`, tradingCurrency: 'USD', tradingCurrencyOriginal: 'USD', reportingCurrency: 'USD', reportingCurrencyOriginal: 'USD',
    fxConverted: true, tradingFxRateApplied: 1, fxRateApplied: 1, priceCurrency: 'USD', asOf: AS_OF, ...extra.meta },
  marketCap: { value: 5e8, source: 'yahoo_quoteSummary', confidence: 0.9, asOf: AS_OF, ...(stamp ? { regularMarketTime: stamp } : {}), ...extra.marketCap },
  price: { regularMarketPrice: 10, currencyUnit: 'USD', currency: 'USD', ...extra.price }, metrics: {}, annual: {}, timeseries: {},
});
function store(rows, authorized = rows.map(r => r.meta.ticker)) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-withheld-'));
  const snapDir = path.join(dir, 'snapshots-smallcap'), watchlistPath = path.join(dir, 'watchlist-smallcap.json');
  fs.mkdirSync(snapDir);
  for (const r of rows) fs.writeFileSync(path.join(snapDir, `${r.meta.ticker}.json`), JSON.stringify(r));
  fs.writeFileSync(path.join(snapDir, '_manifest.json'), JSON.stringify({ not: 'a row' }));
  fs.writeFileSync(watchlistPath, JSON.stringify({ stocks: authorized.map(ticker => ({ ticker })) }));
  return { dir, snapDir, watchlistPath };
}
const W = require('../scripts/write-findash-export.js');
function compiled(anchor, replacement) {
  const lines = fs.readFileSync(EXPORT_FILE, 'utf8').split(/\r?\n/);
  assert.equal(lines.filter(l => l === anchor).length, 1, 'exact whole-line anchor');
  const m = new Module(EXPORT_FILE, module);
  m.filename = EXPORT_FILE;
  m.paths = Module._nodeModulePaths(path.dirname(EXPORT_FILE));
  m._compile(lines.map(l => (l === anchor ? replacement : l)).join('\n'), EXPORT_FILE);
  return m.exports;
}

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message); }
}

// A hand correction: the value is shown and carries its own reason, so a reason alone must not put a row on the list.
const SHOWN_WITH_REASON = () => row('8035.T', FRESH, { meta: { tradingCurrency: 'JPY', tradingCurrencyOriginal: 'JPY', reportingCurrencyOriginal: 'JPY', tradingFxRateApplied: 0.00636748, fxRateApplied: 0.00636748 },
  marketCap: { value: 27339565394.16052 }, price: { regularMarketPrice: 60.22362584, currency: 'JPY' } });
const FIXTURE = () => store([
  row('AAA', STALE), row('BBB', null, { meta: { stalePriceHold: { priceDay: '2026-09-15' } } }), row(HAND_HOLD, FRESH),
  row('DDD', FRESH), row('EEE', null), row('FFF', null, { marketCap: { value: null, missing: true } }), row('OFFLIST', STALE), SHOWN_WITH_REASON(),
], ['AAA', 'BBB', HAND_HOLD, 'DDD', 'EEE', 'FFF', '8035.T']);

function presence(writer = W) {
  const { snapDir, watchlistPath } = FIXTURE();
  const rows = writer.smallcapWithheldMarketCaps(snapDir, watchlistPath);
  const shown = guard.prepareMarketCap(SHOWN_WITH_REASON());
  assert.ok(shown.meta.marketCapReason && Number.isFinite(shown.marketCap.value), 'fixture: a shown value with its own reason');
  assert.deepEqual(rows.map(r => r.ticker), ['AAA', HAND_HOLD, 'BBB'], 'names');
  const by = Object.fromEntries(rows.map(r => [r.ticker, r]));
  assert.equal(by.AAA.name, 'AAA Inc.');
  assert.match(by.AAA.reasonDe, /^Letzte Kursmeldung von Yahoo vom 15\.09\.2026, /);
  assert.match(by.BBB.reasonDe, /^Zuletzt als veraltet belegte Kursmeldung von Yahoo vom 15\.09\.2026; /);
  assert.ok(by[HAND_HOLD].reasonDe.startsWith('Börsenwert nicht verlässlich: ' + guard.holds[HAND_HOLD].reason), 'hand hold keeps its own reason');
}
check('presence and absence: exactly the withheld rows on the watchlist are named, each with name and German reason', () => presence());

check('no store: null, never an empty list that would read as nothing withheld', () => {
  const missing = path.join(os.tmpdir(), 'sc-withheld-does-not-exist-' + process.pid);
  assert.equal(W.smallcapWithheldMarketCaps(missing, path.join(ROOT, 'watchlist-smallcap.json')), null);
});

check('wiring: buildSmallcapIndex carries the list next to the counters, and the contract check accepts it', () => {
  const { dir, snapDir } = store([row(onWatchlist, STALE)]);
  const prior = process.env.FINDASH_SMALLCAP_SNAPSHOTS_DIR;
  process.env.FINDASH_SMALLCAP_SNAPSHOTS_DIR = snapDir;
  try {
    // The store folder is read once at load: a fresh compile of the unchanged source picks up the test store.
    const writer = compiled('function buildSmallcapIndex(coverage, smallcapDir) {', 'function buildSmallcapIndex(coverage, smallcapDir) {');
    // The counters of this store, not of the fixture's run: the contract binds named rows to their counter.
    const source = { ...JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/export-w8/smallcap-index.json'), 'utf8')), excluded: { 'smallcap-mcap-missing': 1 } };
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(source));
    const out = writer.buildSmallcapIndex(source.coverage, dir);
    assert.deepEqual(out.withheldMarketCaps.map(r => r.ticker), [onWatchlist]);
    const keys = Object.keys(out);
    assert.equal(keys[keys.indexOf('excluded') + 1], 'withheldMarketCaps', 'next to its counters');
    assert.deepEqual(out.excluded, source.excluded, 'counters unchanged');
    const errs = [];
    writer.validateSmallcapIndex(out, errs);
    assert.deepEqual(errs, []);
  } finally {
    if (prior === undefined) delete process.env.FINDASH_SMALLCAP_SNAPSHOTS_DIR; else process.env.FINDASH_SMALLCAP_SNAPSHOTS_DIR = prior;
  }
});

// The contract gate on a real file: a list that differs from what the store withholds is a breach.
function gateErrors(names, writer = W, overrides = {}, fixture = FIXTURE) {
  const { dir, snapDir, watchlistPath } = fixture();
  // By default each listed row carries what the store says of it; overrides make one field wrong on purpose.
  const truth = new Map((W.smallcapWithheldMarketCaps(snapDir, watchlistPath) || []).map(r => [r.ticker, r]));
  const list = names == null ? names : names.map(t => ({ ticker: t, name: truth.get(t)?.name ?? t + ' Inc.', reasonDe: truth.get(t)?.reasonDe ?? 'Grund.', ...overrides }));
  const source = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/export-w8/smallcap-index.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ ...source, schema: W.SCHEMA, ...(list === undefined ? {} : { withheldMarketCaps: list }) }));
  return writer.validateSmallcapExport(dir, snapDir, watchlistPath).filter(e => e.includes('withheldMarketCaps'));
}
const RIGHT = ['AAA', HAND_HOLD, 'BBB'];

check('check green: the list equals what the store withholds', () => {
  assert.deepEqual(gateErrors(RIGHT), []);
});
check('counter-proof: a withheld row dropped from the list, or a row added to it, turns the check red', () => {
  assert.match(gateErrors(['AAA', HAND_HOLD]).join(), /the store withholds \[AAA ARX\.TO BBB\]/);
  assert.match(gateErrors([...RIGHT, 'DDD']).join(), /names \[AAA ARX\.TO BBB DDD\]/);
});
check('counter-proof: the list removed or null turns the check red while the store withholds rows; legal with nothing withheld or without a store', () => {
  assert.match(gateErrors(undefined).join(), /the store withholds \[AAA ARX\.TO BBB\]/);
  assert.match(gateErrors(null).join(), /the store withholds \[AAA ARX\.TO BBB\]/);
  const clean = () => store([row('DDD', FRESH)]);
  assert.deepEqual(gateErrors(undefined, W, {}, clean), [], 'an older export, nothing withheld');
  assert.deepEqual(gateErrors(null, W, {}, clean), []);
  const noStore = () => ({ ...clean(), snapDir: path.join(os.tmpdir(), 'sc-withheld-does-not-exist-' + process.pid) });
  assert.deepEqual(gateErrors(undefined, W, {}, noStore), [], 'no store to compare with');
});
check('counter-proof: a blank reason, a missing ticker or a missing name key turn the check red; null and absence are no shape fault', () => {
  const run = list => { const errs = []; W.validateSmallcapIndex({ ...JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/export-w8/smallcap-index.json'), 'utf8')), schema: W.SCHEMA, withheldMarketCaps: list }, errs); return errs.filter(e => e.includes('withheldMarketCaps')); };
  for (const bad of [[{ ticker: 'A', name: 'A', reasonDe: ' ' }], [{ name: 'A', reasonDe: 'Grund.' }], [{ ticker: 'A', reasonDe: 'Grund.' }], [{ ticker: 'A', name: 'A' }], [null], 'x'])
    assert.equal(run(bad).length, 1, JSON.stringify(bad));
  for (const name of [42, {}, false]) assert.equal(run([{ ticker: 'A', name, reasonDe: 'Grund.' }]).length, 1, 'name ' + JSON.stringify(name));
  assert.deepEqual(run([{ ticker: 'A', name: null, reasonDe: 'Grund.' }]), [], 'a null name is legal');
  assert.deepEqual(run(null), []);
  assert.deepEqual(run([]), []);
});

check('counter-proof: a non-empty reason that is not the one the store carries turns the check red', () => {
  assert.match(gateErrors(RIGHT, W, { reasonDe: 'Ein anderer Grund.' }).join(), /reason of AAA differs from the store/);
});
check('break-once: without the reason comparison a wrong reason passes, so that line is what catches it', () => {
  const lines = fs.readFileSync(EXPORT_FILE, 'utf8').split(/\r?\n/);
  const anchor = lines.find(l => l.startsWith('  for (const r of withheld || []) if (named.has(r.ticker)'));
  assert.ok(anchor, 'reason line');
  assert.deepEqual(gateErrors(RIGHT, compiled(anchor, ''), { reasonDe: 'Ein anderer Grund.' }), []);
});
check('break-once: without the filter line the presence check fails for its names', () => {
  const broken = compiled('  return universe.filter(s => s.meta.marketCapReason && !Number.isFinite(s.marketCap?.value))', '  return universe.filter(() => false)');
  assert.throws(() => presence(broken), /names/);
});
check('break-once: without the comparison a dropped row stays unnoticed, so the check is what catches it', () => {
  const lines = fs.readFileSync(EXPORT_FILE, 'utf8').split(/\r?\n/);
  const anchor = lines.find(l => l.startsWith('  if (withheld && nameList(withheld) !== nameList(idx.withheldMarketCaps))'));
  assert.ok(anchor, 'comparison line');
  assert.deepEqual(gateErrors(['AAA', HAND_HOLD], compiled(anchor, '')), []);
});

// Codex R17, finding 1: the state sequence of a known hold followed by an empty full pull, through the real pullAll.
const { fixture: pullFixture, snapshot: pullSnapshot } = require('./stale-quarter-reload.test.js');
async function emptyAfterHold() {
  const held = pullSnapshot('OLD', '2026-09-30');
  Object.assign(held.meta, { name: 'Old Company', asOf: '2026-10-30T08:00:00.000Z', fetchedAt: '2026-10-30T08:00:00.000Z', fundamentalsAsOf: '2026-10-30T08:00:00.000Z', stalePriceHold: { priceDay: '2026-10-02' } });
  held.marketCap.regularMarketTime = '2026-10-02T15:35:06.000Z';
  const f = pullFixture({ snapshots: [held], now: Date.parse('2026-10-30T10:00:00Z'), env: { RUN_DATE_UTC: '2026-10-30', STALE_QUARTER_RELOAD: '' }, manual: ['OLD'], emptySummary: true, quoteMarketCap: null });
  await f.run();
  const stored = f.stored('OLD');
  assert.equal(stored.marketCap.value, null, 'the empty answer leaves no value');
  assert.deepEqual(stored.meta.stalePriceHold, { priceDay: '2026-10-02' });
  const { dir, snapDir, watchlistPath } = store([stored, row('NOHOLD', null, { marketCap: { value: null, missing: true } })]);
  const rows = W.smallcapWithheldMarketCaps(snapDir, watchlistPath);
  assert.deepEqual(rows.map(r => r.ticker), ['OLD'], 'a known hold lost its name after an empty answer, or a row without any hold was named');
  assert.equal(rows[0].name, 'Old Company');
  assert.match(rows[0].reasonDe, /^Zuletzt als veraltet belegte Kursmeldung von Yahoo vom 02\.10\.2026; der letzte Abruf lieferte keinen Börsenwert\. /);
  const source = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/export-w8/smallcap-index.json'), 'utf8'));
  const gate = list => { fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ ...source, schema: W.SCHEMA, withheldMarketCaps: list })); return W.validateSmallcapExport(dir, snapDir, watchlistPath).filter(e => e.includes('withheldMarketCaps')); };
  assert.match(gate([]).join(), /the store withholds \[OLD\]/, 'an empty list passed the check');
  assert.deepEqual(gate(rows), []);
}
(async () => {
  try { await emptyAfterHold(); passed++; console.log('PASS empty: a known hold stays named after an empty Yahoo answer; a row without a hold is not named'); }
  catch (e) { failed++; console.error('FAIL empty: ' + e.message); }
  assert.equal(sha(), before, 'live export source changed');
  console.log(`smallcap-withheld-market-caps: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
