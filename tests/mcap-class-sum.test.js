'use strict';
// Guard for the class sum of firms with two or more listed share classes (P1, Codex review of #91; lib/mcap-class-sum.js,
// configs/mcap-class-sum.json, step "Klassensumme der Boersenwerte (P1)" of the merge job).
// Real packets of run 42356903064 (data day 07.11.2026) in tests/fixtures/mcap-class-sum-20261107.json: every class line,
// the last 15 closes of each from the price store, the FX file of the run.
// Wrong before: Yahoo prices every share at one line (ZTE 20.22 instead of 18.84 bn USD, Jiangling 2.13 instead of 1.68), or a
// share-count row froze the price ratio of 30.10. (Shandong Gold shown 18.11 through 600547.SS, the row line 16.73; class sum 16.49).
// Right after: each class at its own close of one common day, recomputed here independently of the module.
// Break-once on test data only: `node tests/mcap-class-sum.test.js --prove-red` swaps the run's CNY and HKD rates in memory, runs
// the module on ZTE, and the independent recomputation must exit 1. No wall clock; live files are hashed before and after.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const cs = require('../lib/mcap-class-sum.js');
const guard = require('../lib/market-cap-guard.js');
const store = require('../lib/price-history-store.js');
const { safeSnapshotFilename } = require('../lib/snapshot-fs.js');
const fx = require('./fixtures/mcap-class-sum-20261107.json');

const root = path.resolve(__dirname, '..');
const live = ['configs/mcap-class-sum.json', 'configs/share-count-hand-table.json', 'lib/mcap-class-sum.js', 'lib/market-cap-guard.js', 'tests/fixtures/mcap-class-sum-20261107.json'];
const liveHashes = () => live.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'));
const beforeHashes = liveHashes();
const DAY = fx.dataDay;
let entries = cs.loadClassSumEntries();
const currencies = Object.fromEntries(Object.entries(fx.snapshots).map(([t, s]) => [t, s.meta.tradingCurrencyOriginal || s.meta.tradingCurrency]));
const sum = (e, closes = fx.closes) => cs.computeClassSum(e, closes, currencies, fx.fx.rates, DAY);
const byIssuer = name => entries.find(e => e.issuer.startsWith(name));
// Shown before (07.11.2026, highest stored value among the lines the hand table does not hold) and the class sum after, bn USD.
const PINS = {
  'ZTE Corporation': [20.22, 18.84], 'Jiangling Motors': [2.13, 1.68], 'Haier Smart Home': [30.14, 28.07],
  'PetroChina': [348.43, 336.20], 'Shanghai Pharmaceuticals': [9.32, 8.34], 'China Railway Signal': [8.14, 7.38],
  'Anhui Expressway': [4.53, 4.13], 'Qingdao Port': [9.49, 8.96], 'Shandong Gold': [18.11, 16.49],
};
// The stored packets still carry the 16 removed share-count rows (source hand-table:shares); without them the pull writes
// Yahoo's value, so the merge job sees that one.
const pulled = t => { const x = structuredClone(fx.snapshots[t]); if (x.marketCap?.source === 'hand-table:shares') {
  x.marketCap.value = x.marketCap.yahooValue; x.marketCap.source = 'yahoo_quote'; delete x.marketCap.yahooValue; delete x.marketCap.vendorImpliedShares; delete x.meta.marketCapReason; } return x; };
const firm = e => Object.fromEntries(e.classes.map(c => [c.ticker, pulled(c.ticker)]));
const shownBefore = e => Math.max(...e.classes.map(c => fx.snapshots[c.ticker]).filter(s => s && !guard.holds[s.meta.ticker] && s.marketCap?.source !== 'hand-table:market-cap-hold')
  .map(s => s.marketCap?.value ?? 0));

if (process.argv.includes('--prove-red')) {
  // Test data only: the run's CNY and HKD rates swapped in memory. The module then writes a wrong sum; the independent
  // recomputation below must notice it.
  const e = byIssuer('ZTE'), rates = { ...fx.fx.rates, CNY: fx.fx.rates.HKD, HKD: fx.fx.rates.CNY };
  const snaps = firm(e);
  cs.writeFirm(snaps, e, cs.computeClassSum(e, fx.closes, currencies, rates, DAY), null);
  let own = 0;
  for (const c of e.classes) own += c.shares * fx.closes[c.ticker].find(p => p.date === '2026-11-06').close * fx.fx.rates[c.currency];
  assert.ok(Math.abs(snaps['000063.SZ'].marketCap.value / own - 1) < 1e-9, `ZTE shows ${snaps['000063.SZ'].marketCap.value}, the class sum is ${own}`);
  console.log('mcap-class-sum: --prove-red did NOT fire');
  process.exit(0);
}

test('config: 24 issuers, every class once, sourced; no class line still has a share-count row', () => {
  assert.equal(entries.length, 24);
  for (const e of entries) {
    assert.ok(e.sources.every(s => /^https?:\/\//.test(s.url) && s.quote.length > 10), e.issuer);
    for (const c of e.classes) assert.equal(guard.table[c.ticker], undefined, c.ticker + ': a share-count row would correct the line a second time');
  }
  for (const t of ['688428.SS', '688981.SS', '600938.SS', '688185.SS', '601869.SS', '688347.SS', '001289.SZ', '600956.SS', '600685.SS',
    '600871.SS', '600188.SS', '688385.SS', '600688.SS', '1787.HK', '1766.HK', '0019.HK']) assert.equal(guard.table[t], undefined, t);
});

test('every issuer: one common close day for all classes, value = shares x own close x FX, recomputed independently', () => {
  for (const e of entries) {
    const r = sum(e);
    assert.equal(r.reason, null, e.issuer + ': ' + r.reason);
    assert.equal(r.date, '2026-11-06', e.issuer + ': the Friday close of every class');
    let own = 0;
    for (const c of e.classes) {
      const p = fx.closes[c.ticker].find(x => x.date === r.date);
      assert.equal(c.currency, currencies[c.ticker], c.ticker + ': config currency against the snapshot');
      own += c.shares * p.close * fx.fx.rates[c.currency];
    }
    assert.ok(Math.abs(r.value / own - 1) < 1e-12, e.issuer);
  }
});

test('wrong before, right after: the pinned firms move from the one-line value to the class sum', () => {
  for (const [name, [before, after]] of Object.entries(PINS)) {
    const e = byIssuer(name); assert.ok(e, name);
    assert.ok(Math.abs(shownBefore(e) / 1e9 - before) < 0.01, `${name}: before ${shownBefore(e) / 1e9}`);
    assert.ok(Math.abs(sum(e).value / 1e9 - after) < 0.01, `${name}: after ${sum(e).value / 1e9}`);
    assert.ok(before / after - 1 > 0.03, name + ': the old value was not more than 3 % off');
  }
});

test('the line the board shows today carries the sum; held lines and their hold untouched; ratios from the wrong value blanked', () => {
  const e = byIssuer('Jiangling'), r = sum(e), snaps = firm(e);
  snaps['000550.SZ'].metrics.priceSales = { value: 9.9 };
  const bBefore = JSON.stringify(snaps['200550.SZ']);
  assert.deepEqual(cs.writeFirm(snaps, e, r, fx.fx.fetchedAt), { shown: '000550.SZ', written: ['000550.SZ'] });
  assert.equal(JSON.stringify(snaps['200550.SZ']), bBefore, '200550.SZ is held and must stay held');
  const a = snaps['000550.SZ'];
  assert.equal(a.marketCap.value, r.value); assert.equal(a.marketCap.source, 'class-sum');
  assert.equal(a.marketCap.yahooValue, fx.snapshots['000550.SZ'].marketCap.value);
  assert.equal(a.metrics.priceSales, null);
  assert.match(a.meta.marketCapReason, /^Börsenwert als Summe der Aktienklassen, jede zu ihrem eigenen Schlusskurs vom 06\.11\.2026: 510,6 Mio\. A-Aktien zu 16,45 CNY plus 344 Mio\. B-Aktien zu 9,52 HKD/);
  assert.doesNotMatch(a.meta.marketCapReason, /[–—]| - |kauf|verkauf/i);
  // Twice is the same: the second pass chooses on the vendor values kept by the first.
  const again = structuredClone(snaps); cs.writeFirm(again, e, r, fx.fx.fetchedAt);
  assert.deepEqual(again, snaps);
});

test('the listing choice does not move: the sum goes to the line the scoring picks on the pull values, no other line can outbid it', () => {
  const { issuerDedupComparator } = require('../src/scoring/score.js');
  // CNOOC: with its share-count row the H line 0883.HK showed (A corrected to 135.8 < H 142.4 bn USD); without the row the pull
  // gives the A line Yahoo's 222.9 bn, so the A line 600938.SS is chosen and carries the sum (energy board, rank about 204 to 208).
  const expectShown = { 'CNOOC Limited': '600938.SS', 'CRRC Corporation Limited': '1766.HK', 'Shandong Gold Mining Co., Ltd.': '600547.SS' };
  for (const e of entries) {
    const snaps = firm(e), r = sum(e);
    const before = Object.values(snaps).filter(x => !guard.holds[x.meta.ticker] && x.marketCap?.source !== 'hand-table:market-cap-hold' && x.marketCap?.value > 0)
      .map(x => ({ ticker: x.meta.ticker, snapshot: x })).sort(issuerDedupComparator)[0].ticker;
    const { shown } = cs.writeFirm(snaps, e, r, null);
    assert.equal(shown, before, e.issuer);
    if (expectShown[e.issuer]) assert.equal(shown, expectShown[e.issuer], e.issuer);
    const after = Object.values(snaps).filter(x => !guard.holds[x.meta.ticker] && x.marketCap?.value > 0).map(x => ({ ticker: x.meta.ticker, snapshot: x })).sort(issuerDedupComparator)[0];
    assert.equal(after.ticker, shown, e.issuer + ': another line outbids the sum');
    assert.equal(after.snapshot.marketCap.value, r.value, e.issuer);
    for (const x of Object.values(snaps)) if (x.meta.ticker !== shown && !guard.holds[x.meta.ticker] && x.marketCap?.source !== 'hand-table:market-cap-hold') {
      assert.equal(x.marketCap.value, null, x.meta.ticker + ': a side line keeps a one-price value');
      assert.ok(x.meta.marketCapReason.includes('steht an der Zeile ' + shown + '.'), x.meta.ticker);
    }
  }
  // A second line whose vendor value is at least the sum is emptied with the reason, never left to take the board.
  const e = byIssuer('ZTE'), snaps = firm(e), r = sum(e);
  snaps['0763.HK'].marketCap.value = 2 * r.value;
  snaps['000063.SZ'].marketCap.value = 3 * r.value;
  assert.deepEqual(cs.writeFirm(snaps, e, r, null).written.sort(), ['000063.SZ', '0763.HK']);
  assert.equal(snaps['0763.HK'].marketCap.value, null);
  assert.match(snaps['0763.HK'].meta.marketCapReason, /^Börsenwert nicht verlässlich: Der Börsenwert der Firma steht an der Zeile 000063\.SZ\./);
});

test('same day only: a class without the newest close moves every class to the previous common day', () => {
  const e = byIssuer('ZTE'), closes = structuredClone(fx.closes);
  closes['0763.HK'] = closes['0763.HK'].filter(p => p.date !== '2026-11-06');
  const r = sum(e, closes);
  assert.equal(r.date, '2026-11-05');
  for (const l of r.legs) assert.equal(l.close, fx.closes[l.ticker].find(p => p.date === '2026-11-05').close, l.ticker);
});

test('empty with a reason, never a guess: no closes, too old a common day, or no FX rate', () => {
  const e = byIssuer('ZTE');
  const none = structuredClone(fx.closes); none['0763.HK'] = [];
  const old = structuredClone(fx.closes); old['0763.HK'] = [{ date: '2026-10-20', close: 20 }];
  for (const [closes, why] of [[none, /0763\.HK: keine Schlusskurse/], [old, /20\.10\.2026 liegt mehr als 10 Tage zurück/]]) {
    const r = sum(e, closes);
    assert.equal(r.value, null); assert.match(r.reason, why);
    const snaps = firm(e);
    assert.deepEqual(cs.writeFirm(snaps, e, r, null), { shown: null, written: ['000063.SZ', '0763.HK'] }, 'no line may keep a one-line value');
    for (const s of Object.values(snaps)) {
      assert.equal(s.marketCap.value, null); assert.equal(s.marketCap.missing, true);
      assert.match(s.meta.marketCapReason, /^Börsenwert nicht verlässlich: Die Summe der Aktienklassen/);
    }
  }
  const noHkd = { ...fx.fx.rates }; delete noHkd.HKD;
  const r = cs.computeClassSum(e, fx.closes, currencies, noHkd, DAY);
  assert.equal(r.value, null); assert.match(r.reason, /kein Devisenkurs für HKD/);
});

test('a missing class snapshot costs only that line: Haier without its held D line keeps the sum; a snapshot in another currency empties it', () => {
  const e = byIssuer('Haier'), r0 = sum(e);
  const noD = { ...currencies }; delete noD['690D.DE'];
  const r = cs.computeClassSum(e, fx.closes, noD, fx.fx.rates, DAY);
  assert.equal(r.reason, null); assert.equal(r.value, r0.value);
  const snaps = firm(e); delete snaps['690D.DE'];
  assert.equal(cs.writeFirm(snaps, e, r, null).shown, '600690.SS');
  const bad = cs.computeClassSum(e, fx.closes, { ...currencies, '6690.HK': 'USD' }, fx.fx.rates, DAY);
  assert.equal(bad.value, null); assert.match(bad.reason, /6690\.HK: Snapshot nennt USD statt HKD/);
  assert.match(cs.reasonText(e, r0), /Aktienzahlen laut Firma vom 30\.09\.2026 bis 30\.10\.2026\)/);
});

test('provenance: the class sum is a calculation with one share and one close input per class, not a vendor value', () => {
  const { captureSnapshot, RECORD_FIELDS } = require('../lib/export-provenance.js');
  const e = byIssuer('ZTE'), snaps = firm(e);
  cs.writeFirm(snaps, e, sum(e), fx.fx.fetchedAt);
  const cap = captureSnapshot(snaps['000063.SZ']);
  assert.equal(cap.marketCap.sourceType, 'calculation'); assert.equal(cap.marketCap.provider, null);
  assert.equal(cap.marketCap.derivation.methodId, 'marketCapClassSum');
  assert.equal(cap.marketCap.missingReason, null);
  assert.deepEqual(cap.marketCapInputs.map(i => i.fieldPath), ['000063.SZ', '0763.HK'].flatMap(t => [`marketCap.classSum.${t}.shares`, `marketCap.classSum.${t}.close`]));
  for (const i of cap.marketCapInputs) for (const k of Object.keys(i)) assert.ok(RECORD_FIELDS.includes(k), k);
  const own = cap.marketCapInputs.reduce((s, x, i, a) => i % 2 ? s : s + x.normalizedValue * a[i + 1].normalizedValue, 0);
  assert.ok(Math.abs(own / cap.marketCap.normalizedValue - 1) < 1e-12);
});

test('read time: the guard keeps the class-sum value and its reason in its copy', () => {
  const e = byIssuer('Shandong Gold'), snaps = firm(e);
  cs.writeFirm(snaps, e, sum(e), null);
  const s = snaps['600547.SS'];
  const seen = guard.prepareMarketCap(s);
  assert.equal(seen.marketCap.value, s.marketCap.value);
  assert.equal(seen.meta.marketCapReason, s.meta.marketCapReason);
  // A stale reason of a removed row is still dropped.
  const other = structuredClone(fx.snapshots['601857.SS']); other.meta.marketCapReason = 'alt';
  assert.equal(guard.prepareMarketCap(other).meta.marketCapReason, undefined);
});

test('the merge-job writer: a temp generation gets the sum on disk, the step sits after the price merge and before the artifact', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcap-class-sum-'));
  const snaps = path.join(dir, 'snapshots'), prices = path.join(dir, 'prices');
  fs.mkdirSync(snaps); fs.mkdirSync(prices);
  for (const [t, s] of Object.entries(fx.snapshots)) fs.writeFileSync(path.join(snaps, safeSnapshotFilename(t)), JSON.stringify(s));
  store.saveAll(prices, structuredClone(fx.closes));
  fs.writeFileSync(path.join(dir, 'fx.json'), JSON.stringify(fx.fx));
  const report = cs.applyClassSums({ snapshotsDir: snaps, pricesDir: prices, fxFile: path.join(dir, 'fx.json'), dataDay: DAY, log: () => {} });
  assert.equal(report.length, 24);
  assert.equal(report.filter(r => r.value === null).length, 0);
  const zte = JSON.parse(fs.readFileSync(path.join(snaps, '000063.SZ.json'), 'utf8'));
  assert.ok(Math.abs(zte.marketCap.value / 18.84e9 - 1) < 0.001);
  assert.equal(zte.marketCap.classSum.fxFetchedAt, fx.fx.fetchedAt);
  const wf = fs.readFileSync(path.join(root, '.github/workflows/daily-pull.yml'), 'utf8');
  const at = s => wf.indexOf(s);
  assert.ok(at('scripts/merge-price-shards.js --prices prices') > 0);
  assert.ok(at('scripts/apply-mcap-class-sum.js --snapshots snapshots --prices prices --fx fx-rates.json --date "$RUN_DATE_UTC"') > at('scripts/merge-price-shards.js --prices prices'));
  assert.ok(at('name: Upload Snapshots Artifact') > at('scripts/apply-mcap-class-sum.js'));
});

test('live files unchanged', () => assert.deepEqual(liveHashes(), beforeHashes));
