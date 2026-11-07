'use strict';
// Guard for the class sum of firms with two or more listed share classes (P1, Codex review of #91; lib/mcap-class-sum.js,
// configs/mcap-class-sum.json, step "Klassensumme der Boersenwerte (P1)" of the merge job).
// Real data: the class-line snapshots of run 42356903064 (data day 07.11.2026, tests/fixtures/mcap-class-sum-20261107.json)
// and the Yahoo daily charts of every class line and FX pair recorded after the Friday sessions
// (tests/fixtures/mcap-class-sum-charts-20261107.json).
// Wrong before: Yahoo prices every share at one line (ZTE 20.22 instead of 18.80 bn USD, Jiangling 2.13 instead of 1.67), or a
// share-count row froze the price ratio of 30.10. (Shandong Gold shown 18.11 through 600547.SS; class sum 16.46).
// Right after: each class at its own unadjusted close of one common finished day and the FX close of that day, recomputed here
// independently of the module from the recorded chart quotes.
// Break-once on test data only: `node tests/mcap-class-sum.test.js --prove-red` swaps the CNY and HKD FX charts in memory, runs
// the module on ZTE, and the independent recomputation must exit 1. No wall clock; live files are hashed before and after.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const cs = require('../lib/mcap-class-sum.js');
const guard = require('../lib/market-cap-guard.js');
const { safeSnapshotFilename } = require('../lib/snapshot-fs.js');
const pk = require('./fixtures/mcap-class-sum-20261107.json');
const ch = require('./fixtures/mcap-class-sum-charts-20261107.json');

const root = path.resolve(__dirname, '..');
const live = ['configs/mcap-class-sum.json', 'scripts/write-filter-universe.js', 'configs/share-count-hand-table.json', 'lib/mcap-class-sum.js', 'lib/market-cap-guard.js',
  'tests/fixtures/mcap-class-sum-20261107.json', 'tests/fixtures/mcap-class-sum-charts-20261107.json'];
const liveHashes = () => live.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'));
const beforeHashes = liveHashes();
const DAY = pk.dataDay, NOW = ch.fetchedAt;
const entries = cs.loadClassSumEntries();
const byIssuer = name => entries.find(e => e.issuer.startsWith(name));
const stub = (charts = ch.charts) => async s => { if (!charts[s]) throw new Error('no chart ' + s); return structuredClone(charts[s]); };
const market = async (charts, now = NOW) => cs.fetchMarket(entries, { chart: stub(charts), now, pauseMs: 0 });
const currencies = Object.fromEntries(Object.entries(pk.snapshots).map(([t, s]) => [t, s.meta.tradingCurrencyOriginal || s.meta.tradingCurrency]));
// The stored packets still carry the 16 removed share-count rows (source hand-table:shares); without them the pull writes
// Yahoo's value, so the merge job sees that one.
const pulled = t => { const x = structuredClone(pk.snapshots[t]); if (x.marketCap?.source === 'hand-table:shares') {
  x.marketCap.value = x.marketCap.yahooValue; x.marketCap.source = 'yahoo_quote'; delete x.marketCap.yahooValue; delete x.marketCap.vendorImpliedShares; delete x.meta.marketCapReason; } return x; };
const firm = e => Object.fromEntries(e.classes.map(c => [c.ticker, pulled(c.ticker)]));
const day = d => d.slice(0, 10);
// Independent reference: raw close of the bar dated `date` (exchange-local day = UTC day of the bar start plus offset) and the FX bar of that UTC day.
const rawClose = (sym, date) => { const c = ch.charts[sym]; const g = c.meta.gmtoffset || 0;
  return c.quotes.filter(q => new Date(new Date(q.date).getTime() + g * 1000).toISOString().slice(0, 10) === date).map(q => q.close).pop(); };
const reference = (e, date) => e.classes.reduce((s, l) => s + l.shares * rawClose(l.ticker, date) * rawClose(l.currency + 'USD=X', date), 0);
// Shown before (07.11.2026, highest stored value among the lines the hand table does not hold) and the class sum after, bn USD.
const PINS = {
  'ZTE Corporation': [20.22, 18.80], 'Jiangling Motors': [2.13, 1.67], 'Haier Smart Home': [30.14, 27.85],
  'PetroChina': [348.43, 335.42], 'Shanghai Pharmaceuticals': [9.32, 8.32], 'China Railway Signal': [8.14, 7.37],
  'Anhui Expressway': [4.53, 4.12], 'Qingdao Port': [9.49, 8.94], 'Shandong Gold': [18.11, 16.46],
};
const shownBefore = e => Math.max(...e.classes.map(c => pk.snapshots[c.ticker]).filter(s => s && !guard.holds[s.meta.ticker] && s.marketCap?.source !== 'hand-table:market-cap-hold')
  .map(s => s.marketCap?.value ?? 0));

if (process.argv.includes('--prove-red')) {
  (async () => {
    const swapped = { ...ch.charts, 'CNYUSD=X': ch.charts['HKDUSD=X'], 'HKDUSD=X': ch.charts['CNYUSD=X'] };
    const e = byIssuer('ZTE'), snaps = firm(e);
    cs.writeFirm(snaps, e, cs.computeClassSum(e, await market(swapped), currencies, DAY), null);
    const own = reference(e, '2026-11-06');
    assert.ok(Math.abs(snaps['000063.SZ'].marketCap.value / own - 1) < 1e-9, `ZTE shows ${snaps['000063.SZ'].marketCap.value}, the class sum is ${own}`);
    console.log('mcap-class-sum: --prove-red did NOT fire');
    process.exit(0);
  })().catch(e => { console.error(e.message); process.exit(1); });
} else {

test('config: 24 issuers, every class once with its own count, day and source; no class line still has a share-count row', () => {
  assert.equal(entries.length, 24);
  for (const e of entries) for (const c of e.classes) {
    assert.ok(/^https?:\/\//.test(c.source.url) && c.source.quote.length > 10, c.ticker);
    assert.equal(guard.table[c.ticker], undefined, c.ticker + ': a share-count row would correct the line a second time');
  }
  for (const t of ['688428.SS', '688981.SS', '600938.SS', '688185.SS', '601869.SS', '688347.SS', '001289.SZ', '600956.SS', '600685.SS',
    '600871.SS', '600188.SS', '688385.SS', '600688.SS', '1787.HK', '1766.HK', '0019.HK']) assert.equal(guard.table[t], undefined, t);
  // Haier without shares repurchased and not yet cancelled (Codex review of #113): A October buy-backs, H 150,000 of 30.10., D 865,598 and the 79,392,362 of the offer.
  assert.deepEqual(byIssuer('Haier').classes.map(c => [c.ticker, c.shares, c.asOf]),
    [['600690.SS', 6108204936, '2026-10-31'], ['6690.HK', 2848887266, '2026-10-30'], ['690D.DE', 190756013, '2026-10-13']]);
});

test('finished sessions only, unadjusted close: Frankfurt at 09:00 UTC is not a close, an adjusted price is not the close', () => {
  const d = cs.finishedCloses(ch.charts['690D.DE'], '2026-11-06T09:00:00Z');
  assert.equal(d.closes[d.closes.length - 1].date, '2026-11-05', 'a running Xetra session counted as a close');
  assert.equal(cs.finishedCloses(ch.charts['690D.DE'], '2026-11-06T16:31:00Z').closes.pop().date, '2026-11-06');
  const hk = cs.finishedCloses(ch.charts['0763.HK'], '2026-11-06T09:00:00Z');
  assert.equal(hk.closes[hk.closes.length - 1].date, '2026-11-06', 'Hong Kong closed at 08:10 UTC');
  const fx = cs.finishedCloses(ch.charts['HKDUSD=X'], NOW);
  assert.equal(fx.closes[fx.closes.length - 1].date, '2026-11-06', 'the Saturday FX quote is no close of a trading day');
  const adj = structuredClone(ch.charts['0763.HK']); adj.quotes.forEach(q => { q.adjclose = q.close * 0.9; });
  assert.equal(cs.finishedCloses(adj, NOW).closes.pop().close, ch.charts['0763.HK'].quotes.filter(q => q.date.startsWith('2026-11-06')).pop().close);
});

test('daylight saving: an FX bar of London summer time (23:00 UTC) keeps its own day', () => {
  const fx = { meta: { currency: 'USD', gmtoffset: 0, exchangeTimezoneName: 'Europe/London', currentTradingPeriod: { regular: { start: '2026-11-06T00:00:00.000Z', end: '2026-11-06T23:59:00.000Z', gmtoffset: 0 } } },
    quotes: [{ date: '2026-10-20T23:00:00.000Z', close: 0.1 }, { date: '2026-11-05T00:00:00.000Z', close: 0.2 }] };
  assert.deepEqual(cs.finishedCloses(fx, NOW).closes.map(c => c.date), ['2026-10-21', '2026-11-05']);
});

test('one time budget for all chart calls, a pause between the two attempts, a German reason', async () => {
  let t = 0; const slept = [];
  const m = await cs.fetchMarket(entries.slice(0, 1), { chart: async () => { t += 4 * 60e3; throw new Error('HTTP 429'); }, now: NOW, clock: () => t, sleep: async (ms) => { slept.push(ms); } });
  const v = Object.values(m);
  assert.match(v[0].error, /^Fehler beim Anbieter: HTTP 429/); assert.deepEqual(slept.slice(0, 1), [2000]);
  assert.ok(v.slice(1).every(x => x.error === 'Zeitbudget des Schritts aufgebraucht'), JSON.stringify(v.map(x => x.error)));
  // Codex P3: a first attempt that ends past the budget gets no second attempt, so the step overruns by one call at most.
  let t2 = 0, calls = 0;
  const m2 = await cs.fetchMarket(entries.slice(0, 1), { chart: async () => { calls++; t2 += 6 * 60e3; throw new Error('timeout'); }, now: NOW, clock: () => t2, sleep: async () => {} });
  assert.equal(calls, 1);
  assert.match(Object.values(m2)[0].error, /Zeitbudget des Schritts aufgebraucht, kein zweiter Versuch$/);
});

test('every issuer: one common finished day, value = shares x unadjusted close x FX close of that day, recomputed independently', async () => {
  const m = await market();
  for (const e of entries) {
    const r = cs.computeClassSum(e, m, currencies, DAY);
    assert.equal(r.reason, null, e.issuer + ': ' + r.reason);
    assert.equal(r.date, '2026-11-06', e.issuer);
    for (const c of e.classes) assert.equal(c.currency, currencies[c.ticker], c.ticker + ': config currency against the snapshot');
    assert.ok(Math.abs(r.value / reference(e, '2026-11-06') - 1) < 1e-12, e.issuer);
  }
});

test('wrong before, right after: the pinned firms move from the one-line value to the class sum', async () => {
  const m = await market();
  for (const [name, [before, after]] of Object.entries(PINS)) {
    const e = byIssuer(name); assert.ok(e, name);
    assert.ok(Math.abs(shownBefore(e) / 1e9 - before) < 0.01, `${name}: before ${shownBefore(e) / 1e9}`);
    const v = cs.computeClassSum(e, m, currencies, DAY).value / 1e9;
    assert.ok(Math.abs(v - after) < 0.01, `${name}: after ${v}`);
    assert.ok(before / after - 1 > 0.03, name + ': the old value was not more than 3 % off');
  }
});

test('an older common day takes the unadjusted close and the FX close of THAT day', async () => {
  const e = byIssuer('ZTE'), charts = structuredClone(ch.charts);
  charts['0763.HK'].quotes = charts['0763.HK'].quotes.filter(q => !q.date.startsWith('2026-11-06'));
  // The A line carries an adjusted close below its real close on 05.11. (a dividend after that day): the real one must be used.
  for (const q of charts['000063.SZ'].quotes) if (day(q.date) === '2026-11-05' || q.date.startsWith('2026-11-04T16')) q.adjclose = q.close * 0.9;
  const r = cs.computeClassSum(e, await market(charts), currencies, DAY);
  assert.equal(r.date, '2026-11-05');
  for (const l of r.legs) {
    assert.equal(l.close, rawClose(l.ticker, '2026-11-05'), l.ticker);
    assert.equal(l.usdPerUnit, rawClose(l.currency + 'USD=X', '2026-11-05'), l.ticker + ': FX of the common day');
  }
  assert.match(cs.reasonText(e, r), /Schlusskurs vom 05\.11\.2026 und zum Devisenkurs desselben Tages/);
});

test('weekday run at 09:00 UTC: Asian sessions done, FX day and Frankfurt not, so the sum takes the day before for every class', async () => {
  const m = await market(ch.charts, '2026-11-06T09:00:00Z');
  for (const name of ['ZTE', 'Haier']) {
    const e = byIssuer(name), r = cs.computeClassSum(e, m, currencies, '2026-11-06');
    assert.equal(r.date, '2026-11-05', name);
    assert.ok(Math.abs(r.value / reference(e, '2026-11-05') - 1) < 1e-12, name);
  }
});

test('empty with a reason, never a guess: no chart, a chart in another currency, too old a day, no FX close of the day', async () => {
  const e = byIssuer('ZTE');
  const cases = [
    [{ ...ch.charts, '0763.HK': undefined }, /0763\.HK: Tageskurse nicht abrufbar/],
    [{ ...ch.charts, '0763.HK': { ...ch.charts['0763.HK'], meta: { ...ch.charts['0763.HK'].meta, currency: 'USD' } } }, /0763\.HK: Kursreihe in USD statt HKD/],
    [{ ...ch.charts, '0763.HK': { ...ch.charts['0763.HK'], quotes: ch.charts['0763.HK'].quotes.filter(q => q.date < '2026-10-24') } }, /liegt mehr als 10 Tage zurück/],
    [{ ...ch.charts, 'HKDUSD=X': { ...ch.charts['HKDUSD=X'], quotes: [] } }, /kein Devisenkurs zum letzten gemeinsamen Handelstag 06\.11\.2026/],
    [{ ...ch.charts, 'HKDUSD=X': undefined }, /kein Devisenkurs HKD in USD abrufbar/],
  ];
  for (const [charts, why] of cases) {
    const r = cs.computeClassSum(e, await market(charts), currencies, DAY);
    assert.equal(r.value, null, String(why)); assert.match(r.reason, why);
    const snaps = firm(e);
    assert.deepEqual(cs.writeFirm(snaps, e, r, null), { shown: null, written: ['000063.SZ', '0763.HK'] }, 'no line may keep a one-line value');
    for (const s of Object.values(snaps)) { assert.equal(s.marketCap.value, null); assert.match(s.meta.marketCapReason, /^Börsenwert nicht verlässlich: Die Summe der Aktienklassen/); }
  }
});

test('the shown line carries the sum; held lines untouched; side lines emptied with the reason; ratios from the wrong value blanked; twice is the same', async () => {
  const m = await market(), e = byIssuer('Jiangling'), r = cs.computeClassSum(e, m, currencies, DAY), snaps = firm(e);
  snaps['000550.SZ'].metrics.priceSales = { value: 9.9 };
  const bBefore = JSON.stringify(snaps['200550.SZ']);
  assert.deepEqual(cs.writeFirm(snaps, e, r, NOW), { shown: '000550.SZ', written: ['000550.SZ'] });
  assert.equal(JSON.stringify(snaps['200550.SZ']), bBefore, '200550.SZ is held and must stay held');
  const a = snaps['000550.SZ'];
  assert.equal(a.marketCap.value, r.value); assert.equal(a.marketCap.source, 'class-sum');
  assert.equal(a.marketCap.yahooValue, pk.snapshots['000550.SZ'].marketCap.value);
  assert.equal(a.metrics.priceSales, null);
  assert.match(a.meta.marketCapReason, /^Börsenwert als Summe der Aktienklassen, jede zu ihrem eigenen Schlusskurs vom 06\.11\.2026 und zum Devisenkurs desselben Tages: 510,6 Mio\. A-Aktien zu 16,45 CNY plus 344 Mio\. B-Aktien zu 9,52 HKD/);
  assert.doesNotMatch(a.meta.marketCapReason, /[–—]| - |kauf|verkauf/i);
  const again = structuredClone(snaps); cs.writeFirm(again, e, r, NOW);
  assert.deepEqual(again, snaps);
});

test('listing choice unchanged: the sum goes to the line the scoring picks on the pull values (or the pinned shownLine); no other line can outbid it; the firm keeps its earliest debut', async () => {
  const { issuerDedupComparator } = require('../src/scoring/score.js');
  const m = await market();
  for (const e of entries) {
    const snaps = firm(e), r = cs.computeClassSum(e, m, currencies, DAY);
    const before = Object.values(snaps).filter(x => !guard.holds[x.meta.ticker] && x.marketCap?.source !== 'hand-table:market-cap-hold' && x.marketCap?.value > 0)
      .map(x => ({ ticker: x.meta.ticker, snapshot: x })).sort(issuerDedupComparator)[0].ticker;
    const debut = Object.values(snaps).filter(x => !guard.holds[x.meta.ticker] && x.marketCap?.source !== 'hand-table:market-cap-hold')
      .map(x => x.meta.firstTradeDate).filter(Boolean).sort()[0];
    const { shown } = cs.writeFirm(snaps, e, r, null);
    assert.equal(shown, e.shownLine || before, e.issuer);
    for (const x of Object.values(snaps)) if (x.meta.ticker !== shown && !guard.holds[x.meta.ticker] && x.marketCap?.source !== 'hand-table:market-cap-hold') {
      assert.equal(x.marketCap.value, null, x.meta.ticker + ': a side line keeps a one-price value');
      assert.ok(x.meta.marketCapReason.includes('steht an der Zeile ' + shown + '.'), x.meta.ticker);
    }
    if (debut) assert.equal(snaps[shown].meta.firstTradeDate, debut, e.issuer + ': the firm debut of the emptied line is lost');
  }
  // CNOOC: the board showed 0883.HK (its old row made the A line smaller). Without the row the choice would take the A line
  // (Yahoo 222.9 against 142.4 bn USD); shownLine keeps 0883.HK, so no listing changes.
  const e = byIssuer('CNOOC'), snaps = firm(e), r = cs.computeClassSum(e, m, currencies, DAY);
  assert.equal(pk.snapshots['0883.HK'].marketCap.value > pk.snapshots['600938.SS'].marketCap.value, true, 'before: 0883.HK showed');
  assert.ok(snaps['600938.SS'].marketCap.value > snaps['0883.HK'].marketCap.value, 'without the row the A line would win');
  assert.equal(cs.writeFirm(snaps, e, r, null).shown, '0883.HK');
  assert.equal(snaps['0883.HK'].marketCap.value, r.value); assert.equal(snaps['600938.SS'].marketCap.value, null);
  // A pinned or chosen A line takes the firm debut of the emptied H line (2004 instead of 2022).
  const snaps2 = firm(e), e2 = { ...e, shownLine: undefined };
  assert.equal(cs.writeFirm(snaps2, e2, r, null).shown, '600938.SS');
  assert.equal(snaps2['600938.SS'].meta.firstTradeDate, pk.snapshots['0883.HK'].meta.firstTradeDate);
  assert.equal(snaps2['600938.SS'].meta.ipoYear, 2004); assert.equal(snaps2['600938.SS'].meta.ipoYearOwn, 2022);
});

test('a missing class snapshot costs only that line; a snapshot in another currency empties the sum', async () => {
  const m = await market(), e = byIssuer('Haier'), r0 = cs.computeClassSum(e, m, currencies, DAY);
  const noD = { ...currencies }; delete noD['690D.DE'];
  const r = cs.computeClassSum(e, m, noD, DAY);
  assert.equal(r.reason, null); assert.equal(r.value, r0.value);
  const snaps = firm(e); delete snaps['690D.DE'];
  assert.equal(cs.writeFirm(snaps, e, r, null).shown, '600690.SS');
  const bad = cs.computeClassSum(e, m, { ...currencies, '6690.HK': 'USD' }, DAY);
  assert.equal(bad.value, null); assert.match(bad.reason, /6690\.HK: Snapshot nennt USD statt HKD/);
  assert.match(cs.reasonText(e, r0), /Aktienzahlen ohne eigene Aktien laut Firma vom 13\.10\.2026 bis 31\.10\.2026\)/);
});

test('size floor: a class sum below the floor leaves the board like a corrected share-count line', async () => {
  const m = await market(), e = byIssuer('Jiangling'), snaps = firm(e);
  cs.writeFirm(snaps, e, cs.computeClassSum(e, m, currencies, DAY), null);
  const s = snaps['000550.SZ'];
  assert.equal(guard.correctedBelowFloor(s, 800e6), false);
  assert.equal(guard.correctedBelowFloor(s, 2e9), true, '1.67 bn USD is below a 2 bn floor');
  const router = require('../src/scoring/router.js');
  assert.deepEqual(router.route(s, 2e9), { action: 'exclude', reason: 'skipped-mcap' });
});

test('provenance: a calculation with one sourced share count and one dated close per class', async () => {
  const { captureSnapshot, RECORD_FIELDS } = require('../lib/export-provenance.js');
  const e = byIssuer('ZTE'), snaps = firm(e);
  cs.writeFirm(snaps, e, cs.computeClassSum(e, await market(), currencies, DAY), NOW);
  const cap = captureSnapshot(snaps['000063.SZ']);
  assert.equal(cap.marketCap.sourceType, 'calculation'); assert.equal(cap.marketCap.provider, null);
  assert.equal(cap.marketCap.derivation.methodId, 'marketCapClassSum'); assert.equal(cap.marketCap.missingReason, null);
  assert.equal(cap.marketCap.observedAt, '2026-11-06T00:00:00Z');
  assert.deepEqual(cap.marketCapInputs.map(i => i.fieldPath), ['000063.SZ', '0763.HK'].flatMap(t => [`marketCap.classSum.${t}.shares`, `marketCap.classSum.${t}.close`]));
  for (const i of cap.marketCapInputs) for (const k of Object.keys(i)) assert.ok(RECORD_FIELDS.includes(k), k);
  for (const i of cap.marketCapInputs.filter(x => x.fieldPath.endsWith('.shares'))) {
    assert.match(i.documentUrl, /^https:\/\/www1\.hkexnews\.hk\//); assert.ok(i.quote.length > 10); assert.equal(i.observedAt, '2026-09-30T00:00:00Z');
  }
  for (const i of cap.marketCapInputs.filter(x => x.fieldPath.endsWith('.close'))) assert.equal(i.fx.asOf, '2026-11-06T00:00:00Z');
  const side = captureSnapshot(snaps['0763.HK']);
  assert.equal(side.marketCap.missingReason, "The firm's class sum is shown on 000063.SZ; this line carries no market cap.");
  const own = cap.marketCapInputs.reduce((s, x, i, a) => i % 2 ? s : s + x.normalizedValue * a[i + 1].normalizedValue, 0);
  assert.ok(Math.abs(own / cap.marketCap.normalizedValue - 1) < 1e-12);
});

test('a side line emptied by the class sum with a stale-price hold shows no Yahoo price values in the filter (master P3-1 on 65c7366445)', async () => {
  const F = require('../scripts/write-filter-universe.js');
  const e = byIssuer('Shandong Gold'), snaps = firm(e), h = snaps['1787.HK'];
  // Tag 1538 stale-price gate: 1787.HK with its last Yahoo quote of 20.10.2026 and that quote's price values.
  h.marketCap = { value: 10.6e9, source: 'yahoo_quote', asOf: '2026-11-07T09:26:41Z', regularMarketTime: '2026-10-20T08:08:00Z' };
  h.meta.stalePriceHold = { priceDay: '2026-10-20' };
  h.metrics = { ...h.metrics, dividendYield: { value: 1.83 }, fiftyTwoWeekHigh: { value: 6.9 } };
  cs.writeFirm(snaps, e, cs.computeClassSum(e, await market(), currencies, DAY), NOW);
  const rowOf = (builder) => builder.buildUniverse({ snapshots: [guard.prepareMarketCap(h)], generatedAt: '2026-11-07T10:15:00Z' }).rows.find(r => r.t === '1787.HK');
  const row = rowOf(F);
  assert.equal(row.dy ?? null, null); assert.equal(row.d52 ?? null, null);
  assert.ok(row.aus.includes('Dividendenrendite wird nicht gezeigt, die Kursmeldung von Yahoo vom 20.10.2026 ist zu alt.'), JSON.stringify(row.aus));
  assert.ok(row.aus.includes('Abstand zum 52-Wochen-Hoch wird nicht gezeigt, die Kursmeldung von Yahoo vom 20.10.2026 ist zu alt.'));
  // Break-once on the code in memory: without the new condition the stale yield comes back.
  const file = path.join(root, 'scripts/write-filter-universe.js'), anchor = "    const kursAlt = snapshot.marketCap?.source === STALE_PRICE_SOURCE || (snapshot.marketCap?.source === 'class-sum' && !!meta.stalePriceHold && !finite(snapshot.marketCap?.value));";
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  assert.equal(lines.filter(l => l === anchor).length, 1, 'exact whole-line anchor');
  const Module = require('node:module'), m = new Module(file, module);
  m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(lines.map(l => (l === anchor ? '    const kursAlt = snapshot.marketCap?.source === STALE_PRICE_SOURCE;' : l)).join('\n'), file);
  assert.equal(rowOf(m.exports).dy, 1.83, 'the break-once did not bring the stale yield back');
  // Other direction (narrow Opus check B1): a hand-table hold whose old stale-price note is never cleared (its market cap stays
  // empty) keeps its values and gets no stale hint, as before #113. Break-once: without the class-sum condition it loses them.
  const held = structuredClone(pk.snapshots['200550.SZ']);
  assert.equal(held.marketCap.source, 'hand-table:market-cap-hold');
  held.meta.stalePriceHold = { priceDay: '2026-10-14' };
  held.metrics = { ...held.metrics, dividendYield: { value: 2.2 }, fiftyTwoWeekHigh: { value: 1.4 } };
  const heldRow = (builder) => builder.buildUniverse({ snapshots: [guard.prepareMarketCap(held)], generatedAt: '2026-11-07T10:15:00Z' }).rows.find(r => r.t === '200550.SZ');
  assert.equal(heldRow(F).dy, 2.2);
  assert.ok(!heldRow(F).aus.some(a => /Kursmeldung von Yahoo vom 14\.10\.2026 ist zu alt/.test(a)), JSON.stringify(heldRow(F).aus));
  const loose = new Module(file, module);
  loose.filename = file; loose.paths = Module._nodeModulePaths(path.dirname(file));
  loose._compile(lines.map(l => (l === anchor ? '    const kursAlt = snapshot.marketCap?.source === STALE_PRICE_SOURCE || (!!meta.stalePriceHold && !finite(snapshot.marketCap?.value));' : l)).join('\n'), file);
  assert.equal(heldRow(loose.exports).dy ?? null, null, 'the break-once did not hide the held line values');
});

test('read time: the guard keeps the class-sum value and its reason in its copy', async () => {
  const e = byIssuer('Shandong Gold'), snaps = firm(e);
  cs.writeFirm(snaps, e, cs.computeClassSum(e, await market(), currencies, DAY), null);
  const s = snaps['600547.SS'], seen = guard.prepareMarketCap(s);
  assert.equal(seen.marketCap.value, s.marketCap.value);
  assert.equal(seen.meta.marketCapReason, s.meta.marketCapReason);
  const other = structuredClone(pk.snapshots['601857.SS']); other.meta.marketCapReason = 'alt';
  assert.equal(guard.prepareMarketCap(other).meta.marketCapReason, undefined, 'a stale reason of a removed row is still dropped');
});

test('the merge-job writer: a temp generation gets the sum on disk; the step sits before the snapshots artifact', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcap-class-sum-'));
  for (const t of Object.keys(pk.snapshots)) fs.writeFileSync(path.join(dir, safeSnapshotFilename(t)), JSON.stringify(pulled(t)));
  const logged = [];
  const report = await cs.applyClassSums({ snapshotsDir: dir, dataDay: DAY, chart: stub(), now: NOW, log: (l) => logged.push(l) });
  assert.deepEqual(logged, [], "a full sum logs no warning");
  assert.equal(report.length, 24);
  assert.equal(report.filter(r => r.value === null).length, 0);
  const zte = JSON.parse(fs.readFileSync(path.join(dir, '000063.SZ.json'), 'utf8'));
  assert.ok(Math.abs(zte.marketCap.value / reference(byIssuer('ZTE'), '2026-11-06') - 1) < 1e-12);
  assert.equal(zte.marketCap.classSum.fetchedAt, NOW);
  const wf = fs.readFileSync(path.join(root, '.github/workflows/daily-pull.yml'), 'utf8');
  const at = s => wf.indexOf(s);
  assert.ok(at('node scripts/apply-mcap-class-sum.js --snapshots snapshots --date "$RUN_DATE_UTC"') > at('- name: F-12 Karteileichen-Filter'));
  assert.ok(at('name: Upload Snapshots Artifact') > at('scripts/apply-mcap-class-sum.js'));
});

test('daily deadline report names the class-sum review date 30 days ahead and after it', () => {
  assert.deepEqual(cs.reviewLines('2026-11-07'), []);
  const [line] = cs.reviewLines('2027-03-01');
  assert.match(line, /^Frist 31\.03\.2027 \(in 30 Tagen\): Die Aktienzahlen der Klassensumme von 24 Firmen sind neu zu belegen/);
  assert.match(cs.reviewLines('2027-04-02')[0], /seit 2 Tagen überschritten/);
  const wf = fs.readFileSync(path.join(root, 'scripts/tageslauf-erwartungen.js'), 'utf8');
  assert.ok(wf.includes("require('../lib/mcap-class-sum.js').reviewLines(datum)"));
});

test('live files unchanged', () => assert.deepEqual(liveHashes(), beforeHashes));
}
