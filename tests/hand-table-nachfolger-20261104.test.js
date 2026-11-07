'use strict';
// Guard for the listing that takes the board after a hand-table row (Codex review of PR 91, 04.11.2026).
// A hold empties one listing; the scoring then shows the firm's next eligible listing, the one with the highest market cap
// (issuerDedupComparator). A test of the held ticker alone cannot see whether that next listing is right: at Aroundtown the
// stale Milan line 1AT1.MI took over 10.3 % high, at Deutz 1DEZ.MI 16.9 % high. The replay also found home lines with an old
// Yahoo share count (Cipher Digital -8.9 %, Geekplus +4.4 % with its own shares counted) and a wrong checked value in a reason
// (JX Advanced Metals, the tender offer of July missed); rows of 04.11. repair those.
// This test replays the choice for every firm a row of 01.11. or 04.11. touches, on the stored snapshots of 31.10.2026
// (run 41184535364), through the REAL lib/market-cap-guard.js and the REAL issuerDedupComparator, and holds the shown value
// against the checked value of the firm:
// - within 3 %: right;
// - KNOWN: still off for a named reason, the deviation pinned to half a point; on this frozen data day a new firm off by more
//   than 3 %, or a known one that moves, goes red (later days only the expectations of the daily run see);
// - expiry: on the data day 01.01.2027 the rows with reviewBy 31.12.2026 run out and exactly EXPIRY_LOST have no listing left;
// - the deadline report of Tag 1521 (lib/handtabellen-fristen.js) names each of them as falling off the board 30 days ahead.
// Break-once on test data only: `node tests/hand-table-nachfolger-20261104.test.js --prove-red` drops the hold of 1DEZ.MI in
// memory; Deutz then shows the Milan line and the check must exit 1. No wall clock; live files are hashed before and after.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const guard = require('../lib/market-cap-guard.js');
const { issuerDedupComparator } = require('../src/scoring/score.js');
const { fristen } = require('../lib/handtabellen-fristen.js');
const { firms } = require('./fixtures/hand-table-nachfolger-20261104.json');

const root = path.resolve(__dirname, '..');
const live = ['configs/share-count-hand-table.json', 'lib/market-cap-guard.js', 'lib/ads-hand-table.js', 'src/scoring/score.js', 'tests/fixtures/hand-table-nachfolger-20261104.json'];
const liveHashes = () => live.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'));
const beforeHashes = liveHashes();
const TOLERANCE = 0.03;

// Firm -> pinned deviation of the shown line from the checked value on 31.10., and why it is not repaired by a row.
// The eight A and H (or A and B) firms of Codex P1 left this list on 07.11.2026: the class sum brings them within 3 %. Pinfra stays:
// its series L line has no closes in the price store, so it is not a class-sum issuer yet.
const KNOWN = {
  'Promotora y Operadora de Infraestructura, S. A. B. de C. V.': { dev: 0.039, why: 'series * and L priced at the * line; class sum needs both prices (Codex P1)' },
  'Shandong Gold Mining Co., Ltd.': { dev: 0.030, why: 'replay artifact: the fixture has no price store, and 600547.SS carries its quote of 29.10. while the checked value uses the closes of 30.10.; the merge job takes one common close day' },
  'Xtep International Holdings Limited': { dev: -0.033, why: 'Yahoo counts 2,733.1 M shares against 2,825.9 M at 31.10. (cause not proven); 3.3 % is inside twice the 3 % window of a share-count row, which then cannot tell the two counts apart (lib/ads-hand-table.js refuses such a row)' },
};
// Firms with no eligible listing on 31.10. already, before any deadline (every line held or excluded).
// Eutelsat and the Caisse Régionale were not on a board before PR 91 either; 1GLXY.MI is its own group, Galaxy stays through GLXY.
const NO_LINE_NOW = ['Caisse Régionale de Crédit Agricole Mutuel Alpes Provence Société coopérative', 'Eutelsat Communications S.A.', 'Galaxy Digital Inc.'];
// Firms of this fixture that lose their last listing when the rows of 31.12.2026 run out (data day 01.01.2027). Only firms a row of
// 01.11. or 04.11. touches are in the fixture: Tokyo Electron (8035.T, row of Tag 1526) falls too and is not in this list.
// Since 07.11.2026 the A and H firms whose share-count rows ran out on 31.12.2026 carry the class sum, which has no such deadline.
const EXPIRY_LOST = ['Beijing Geekplus Technology Co., Ltd.', 'Cipher Digital Inc.', 'Galaxy Digital', 'Kioxia Holdings Corporation'];

const packet = (t, l, day) => {
  const s = { identifier: { primary: 'ISIN', value: 'TICKER:' + t }, timeseries: {}, annual: {}, meta: structuredClone(l.meta),
    marketCap: structuredClone(l.marketCap), price: structuredClone(l.price), metrics: structuredClone(l.metrics) };
  if (day) { s.marketCap.asOf = day; s.meta.asOf = day; }
  return s;
};
// The guard warns once per row past reviewBy; the expiry replay would print about 120 such lines.
const quiet = fn => { const w = console.warn; console.warn = () => {}; try { return fn(); } finally { console.warn = w; } };
// 07.11.2026 (P1): firms with two listed classes take the class sum of the merge job (lib/mcap-class-sum.js). The fixture has
// no price store, so each class closes at its own stored quote (USD price / applied trading FX) on the replayed day.
const classSum = require('../lib/mcap-class-sum.js');
const classEntries = classSum.loadClassSumEntries();
function withClassSum(lines, day) {
  const entry = classEntries.find(e => e.classes.some(c => lines.some(l => l.ticker === c.ticker)));
  if (!entry) return lines;
  const closes = {}, currencies = {}, fx = {};
  for (const { ticker, snapshot: s } of lines) {
    const cur = s.meta.tradingCurrencyOriginal || s.meta.tradingCurrency, rate = guard.tradingRate(s.meta);
    if (!cur || !(rate > 0) || !(s.price?.regularMarketPrice > 0)) continue;
    currencies[ticker] = cur; fx[cur] ??= rate;
    closes[ticker] = [{ date: (day || '2026-10-30').slice(0, 10), close: s.price.regularMarketPrice / rate }];
  }
  const result = classSum.computeClassSum(entry, closes, currencies, fx, (day || '2026-10-31').slice(0, 10));
  const copies = lines.map(l => ({ ...l, snapshot: structuredClone(l.snapshot) }));
  classSum.writeFirm(Object.fromEntries(copies.map(l => [l.ticker, l.snapshot])), entry, result, null);
  return copies;
}
/** The listing the scoring would show for one firm, after the guard and the class sum, on the stored data day or on `day`. */
function shown(f, day) {
  const lines = withClassSum(Object.entries(f.lines).map(([t, l]) => ({ ticker: t, ok: l.eligibleWithValue, snapshot: quiet(() => guard.prepareMarketCap(packet(t, l, day))) })), day);
  const eligible = lines.filter(e => e.ok && Number.isFinite(e.snapshot.marketCap.value) && e.snapshot.marketCap.value > 0).sort(issuerDedupComparator);
  return eligible[0] ? { ticker: eligible[0].ticker, usd: eligible[0].snapshot.marketCap.value } : null;
}
const deviations = () => Object.entries(firms).map(([name, f]) => { const s = shown(f); return { name, s, dev: s ? s.usd / f.checkedUsd - 1 : null }; });

if (process.argv.includes('--prove-red')) {
  delete guard.holds['1DEZ.MI'];
  const d = deviations().find(x => x.name === 'DEUTZ Aktiengesellschaft');
  assert.ok(Math.abs(d.dev) <= TOLERANCE, `DEUTZ shows ${d.s.ticker} ${(d.dev * 100).toFixed(1)} % off`);
  console.log('hand-table-nachfolger-20261104: --prove-red did NOT fire');
  process.exit(0);
}

test('the fixture covers every firm the market-cap rows of 01.11. touch', () => {
  const { snapshots } = require('./fixtures/hand-table-boersenwerte-20261101.json');
  const inFixture = new Set(Object.values(firms).flatMap(f => Object.keys(f.lines)));
  for (const t of Object.keys(snapshots)) assert.ok(inFixture.has(t), t + ' has no firm in the successor fixture');
  for (const t of ['1AT1.MI', '1DEZ.MI', 'TOWN.VI', 'DEZ.DE', 'CIFR', '2590.HK', '5016.T']) assert.ok(inFixture.has(t), t);
});

test('the shown listing of every firm carries the checked value within 3 %, or a pinned known deviation', () => {
  const off = [];
  for (const { name, s, dev } of deviations()) {
    if (dev === null) { assert.ok(NO_LINE_NOW.includes(name), name + ': no listing left on 31.10.'); continue; }
    const k = KNOWN[name];
    if (k) assert.ok(Math.abs(dev - k.dev) <= 0.005, `${name}: ${s.ticker} now ${(dev * 100).toFixed(1)} %, pinned ${(k.dev * 100).toFixed(1)} %`);
    else if (Math.abs(dev) > TOLERANCE) off.push(`${name}: ${s.ticker} ${(dev * 100).toFixed(1)} %`);
  }
  assert.deepEqual(off, [], 'a listing that takes the board is off by more than 3 %');
});

test('Cipher Digital and Geekplus land on the checked count, JX Advanced Metals keeps the vendor value', () => {
  const near = (name, t) => { const s = shown(firms[name]); assert.equal(s.ticker, t, name); assert.ok(Math.abs(s.usd / firms[name].checkedUsd - 1) <= 0.005, name + ': ' + s.usd); };
  near('Cipher Digital Inc.', 'CIFR'); near('Beijing Geekplus Technology Co., Ltd.', '2590.HK'); near('JX Advanced Metals Corporation', '5016.T');
  assert.equal(guard.table.CIFR.shares, 456365113); assert.equal(guard.table['2590.HK'].shares, 1281656998);
  assert.ok(guard.holds.JXAMY.reason.includes('16,76 Mrd. USD'));
});

test('Aroundtown and Deutz: the stale Milan lines no longer take the board; Fudan shows the class sum, not the H line', () => {
  const at = shown(firms['Aroundtown SA']), dz = shown(firms['DEUTZ Aktiengesellschaft']);
  assert.notEqual(at.ticker, '1AT1.MI'); assert.notEqual(dz.ticker, '1DEZ.MI');
  assert.equal(shown(firms['Shanghai Fudan Microelectronics Group Company Limited']).ticker, '688385.SS');
  for (const t of ['1AT1.MI', '1DEZ.MI', '1385.HK']) {
    const l = Object.values(firms).find(f => f.lines[t]).lines[t];
    const out = guard.prepareMarketCap(packet(t, l));
    assert.equal(out.marketCap.value, null, t); assert.equal(out.marketCap.source, 'hand-table:market-cap-hold', t);
  }
});

test('expiry: on 01.01.2027 exactly the named firms have no listing left', () => {
  const lost = Object.entries(firms).filter(([name]) => !NO_LINE_NOW.includes(name)).filter(([, f]) => !shown(f, '2027-01-01')).map(([n]) => n).sort();
  assert.deepEqual(lost, [...EXPIRY_LOST].sort());
});

test('the daily deadline report names every one of them as falling off the board 30 days ahead', () => {
  const tabelle = JSON.parse(fs.readFileSync(path.join(root, 'configs/share-count-hand-table.json'), 'utf8'));
  const universum = Object.values(firms).flatMap(f => Object.values(f.lines).map(l => l.export).filter(Boolean));
  const { zeilen } = fristen({ tabelle, universum, datum: '2026-12-01' });
  const line = zeilen.find(z => z.startsWith('Frist 31.12.2026'));
  assert.ok(line, 'no report line for 31.12.2026');
  for (const name of EXPIRY_LOST) {
    // A firm reads "Name (tickers; board rank; fällt vom Board[, es sei denn ...])".
    const part = line.match(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\(([^)]*)\\)'));
    assert.ok(part && /fällt vom Board/.test(part[1]) && !/es sei denn/.test(part[1]), name + ': ' + (part ? part[1] : 'not named'));
  }
});

test('live files unchanged', () => assert.deepEqual(liveHashes(), beforeHashes));
