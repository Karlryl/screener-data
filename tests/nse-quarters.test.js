'use strict';
// Broken inputs stay in memory. Writing tests are never mutation targets.
// Integration writes go only to a fresh temp directory, never the live store.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const N = require('../lib/nse-quarters');
const S = require('../lib/exchange-quarter-store');
const F = require('../scripts/fetch-nse-quarters');
const R = require('../scripts/nse-shadow-report');
const DIR = path.join(__dirname, 'fixtures/nse-quarters');
const manifest = require('./fixtures/nse-quarters/manifest.json');
const yahoo = require('./fixtures/nse-quarters/yahoo-2026-11-11.json');
const read = name => fs.readFileSync(path.join(DIR, name), 'utf8');
const list = symbol => JSON.parse(read(manifest.lists[symbol]));
const selected = symbol => N.selectFilings(list(symbol), symbol, '2026-11-12')[0];
const xml = symbol => read(manifest.filings[selected(symbol).filingId]);
const observation = symbol => N.parseQuarter(xml(symbol), selected(symbol));
const stocks = [{ ticker: 'LUPIN.NS', name: 'Lupin Limited' }, { ticker: 'LUPIN.BO', name: 'Lupin Limited' },
  { ticker: 'CHENNPETRO.NS', name: 'Chennai Petroleum Corporation Limited' }];
const clone = structuredClone;
function store() {
  const s = N.emptyStore(N.listingMap(stocks));
  s.sources.original = { mode: 'offline-fixture', fetchedAt: '2026-11-12T12:00:00Z' };
  for (const symbol of ['LUPIN', 'CHENNPETRO']) N.appendQuarter(s, symbol + '.NS', observation(symbol),
    { src: 'original', fetchedAt: '2026-11-12T12:00:00Z', updateDate: observation(symbol).availableAfter });
  return s;
}
function changeLine(text, needle, transform) {
  const lines = text.split('\n'), hits = lines.map((l, i) => l.includes(needle) ? i : -1).filter(i => i >= 0);
  assert.equal(hits.length, 1, 'Mutation must target one complete line: ' + needle);
  lines[hits[0]] = transform(lines[hits[0]]);
  return lines.join('\n');
}
const digest = file => fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;
const liveFiles = [F.DEFAULT_OUT, path.join(__dirname, '../lib/g31-recency.js'), path.join(__dirname, '../lib/exchange-quarter-check.js')];
let beforeHashes;
beforeEach(() => { beforeHashes = liveFiles.map(digest); });
afterEach(() => { assert.deepEqual(liveFiles.map(digest), beforeHashes, 'Live files changed during test'); });

test('real packages select Financials only and retain exact current-quarter revenue', () => {
  for (const [symbol, expected, rounding] of [['LUPIN', 78272600000, 'Millions'], ['CHENNPETRO', 220554500000, 'Crores']]) {
    const f = selected(symbol), o = observation(symbol);
    assert.equal(f.periodEnd, '2026-09-30'); assert.equal(o.revenue, expected);
    assert.equal(o.rounding, rounding); assert.equal(o.multiplier, 1);
    assert.equal(o.periodStart, '2026-07-01'); assert.deepEqual(o.contexts, ['OneD']);
    assert.equal(o.element, 'RevenueFromOperations');
  }
  assert.equal(observation('CHENNPETRO').revenue / 1e7, 22055.45);
  assert.equal(N.timestamp('04-Nov-2026 01:32:11').ms, Date.parse('2026-11-03T20:02:11Z'));
});

test('both consolidated locks reject the genuine standalone pair and Governance', () => {
  for (const symbol of ['LUPIN', 'CHENNPETRO']) {
    const rows = list(symbol).data.filter(r => r.qe_Date === '30-SEP-2026');
    const standalone = rows.find(r => r.consolidated === 'Standalone');
    const governance = rows.find(r => r.type.endsWith('Governance'));
    assert.throws(() => N.parseQuarter(xml(symbol), { ...selected(symbol), consolidated: 'Standalone' }), /Listen-Riegel/);
    assert.throws(() => N.parseQuarter(read(manifest.filings[standalone.seq_Id]), selected(symbol)), /Datei-Riegel/);
    assert.throws(() => N.parseQuarter(read(manifest.filings[governance.seq_Id]), selected(symbol)));
    assert.deepEqual(N.selectFilings([standalone, { ...governance, consolidated: 'Consolidated' }], symbol, '2026-11-12'), []);
  }
});

test('latest revision uses creation/revision time when broadcast is null; never backdates availability', () => {
  const original = list('LUPIN').data.find(r => r.seq_Id === '209216');
  const revised = { ...original, seq_Id: '209300', type_Sub: 'Revised', broadcast_Date: null,
    creation_Date: '05-Nov-2026 10:00:00' };
  const f = N.selectFilings([revised, original], 'LUPIN', '2026-11-12')[0];
  assert.equal(f.filingId, '209300'); assert.equal(f.filed, '2026-11-05');
  assert.equal(f.filedDateSource, 'latest-creation-or-revision');
  assert.equal(N.selectFilings([revised, original], 'LUPIN', '2026-11-04')[0].filingId, '209216');
  assert.equal(N.selectFilings([{ ...revised, broadcast_Date: original.broadcast_Date }], 'LUPIN', '2026-11-12')[0].availableAfter, '2026-11-05');
  assert.equal(N.selectFilings([original, { ...original, seq_Id: '209217' }], 'LUPIN', '2026-11-12')[0].filingId, '209217');
  assert.throws(() => N.selectFilings([original, { ...original, xbrl: original.xbrl.replace('WEB.xml', 'OTHER.xml') }], 'LUPIN', '2026-11-12'), /Meldungsdubletten/);
});

for (const [name, mutate, pattern] of [
  ['foreign symbol', r => { r.symbol = 'WRONG'; }, /Symbol/],
  ['invalid quarter date', r => { r.qe_Date = '31-SEP-2026'; }, /Quartalsstichtag/],
  ['non-quarter end', r => { r.qe_Date = '29-SEP-2026'; }, /Quartalsstichtag/],
  ['unknown revision', r => { r.type_Sub = 'Unknown'; }, /Meldungsfassung/],
  ['missing filing id', r => { r.seq_Id = null; }, /kennung/],
  ['invalid timestamp', r => { r.broadcast_Date = '31-Nov-2026 10:00:00'; }, /Meldungszeit/],
  ['invalid clock', r => { r.broadcast_Date = '04-Nov-2026 25:00:00'; }, /Meldungszeit/],
  ['no timestamps', r => { r.broadcast_Date = r.creation_Date = r.revised_Date = null; }, /Meldungszeit/],
  ['filing before quarter', r => { r.broadcast_Date = r.creation_Date = '01-Sep-2026 10:00:00'; }, /vor Quartalsende/],
  ['foreign host', r => { r.xbrl = 'https://example.com/filing.xml'; }, /Archiv/],
  ['credentials', r => { r.xbrl = r.xbrl.replace('https://', 'https://user@'); }, /Archiv/],
  ['query', r => { r.xbrl += '?download=1'; }, /Archiv/],
]) test('list guard: ' + name, () => {
  const row = clone(list('LUPIN').data.find(r => r.seq_Id === '209216')); mutate(row);
  assert.throws(() => N.selectFilings([row], 'LUPIN', '2026-11-12'), pattern);
});

test('response shape, pagination, symbol syntax and dates fail closed', () => {
  assert.throws(() => N.selectFilings({ error: 'throttled' }, 'LUPIN', '2026-11-12'), /data-Liste/);
  assert.throws(() => N.selectFilings({ data: [], totalCount: 201 }, 'LUPIN', '2026-11-12'), /abgeschnitten/);
  assert.throws(() => N.selectFilings([], '../X', '2026-11-12'), /Symbol/);
  assert.throws(() => N.selectFilings([], 'LUPIN', '2026-02-30'), /Stichtag/);
  assert.throws(() => N.archiveUrl('not-a-url'), /Adresse/);
});

const mutations = [
  ['currency', 'DescriptionOfPresentationCurrency ', l => l.replace('>INR<', '>USD<'), /Waehrung/],
  ['symbol', ':Symbol ', l => l.replace('>LUPIN<', '>OTHER<'), /Symbol/],
  ['rounding', ':LevelOfRounding ', l => l.replace('>Millions<', '>NewScale<'), /Rundungsstufe/],
  ['missing currency', 'DescriptionOfPresentationCurrency ', () => '', /Waehrung/],
  ['no revenue substitute', ':RevenueFromOperations contextRef="OneD"', () => '', /Dreimonatsumsatz/],
  ['nil revenue', ':RevenueFromOperations contextRef="OneD"', l => l.replace('decimals=', 'xsi:nil="true" decimals='), /Nil/],
  ['scale', ':RevenueFromOperations contextRef="OneD"', l => l.replace('decimals=', 'scale="7" decimals='), /Skalierung/],
  ['negative', ':RevenueFromOperations contextRef="OneD"', l => l.replace('>78272600000<', '>-1<'), /ungueltig/],
  ['invalid number', ':RevenueFromOperations contextRef="OneD"', l => l.replace('>78272600000<', '>NaN<'), /ungueltig/],
  ['missing unit', ':RevenueFromOperations contextRef="OneD"', l => l.replace('unitRef="INR"', 'unitRef="MISSING"'), /einheit/],
  ['wrong unit measure', '<xbrli:unit id="INR">', l => l.replace('iso4217:INR', 'iso4217:USD'), /einheit/],
  ['conflicting value', ':RevenueFromOperations contextRef="OneD"', l => l + '\n' + l.replace('>78272600000<', '>999<'), /verschiedene Werte/],
  ['wrong facts start', 'DateOfStartOfReportingPeriod contextRef="OneD"', l => l.replace('2026-07-01', '2026-04-01'), /Dreimonatsumsatz/],
  ['wrong facts end', 'DateOfEndOfReportingPeriod contextRef="OneD"', l => l.replace('2026-09-30', '2025-09-30'), /Dreimonatsumsatz/],
  ['missing file lock', 'NatureOfReportStandaloneConsolidated contextRef="OneD"', () => '', /Datei-Riegel/],
  ['missing context', '<xbrli:context id="OneD"', () => '', /Dreimonatsumsatz/],
  ['context date contradiction', '<xbrli:context id="OneD"', l => l.replace('2026-07-01', '2026-04-01'), /widersprechen/],
  ['explicit dimension', '<xbrli:context id="OneD"', l => l.replace('</xbrli:entity>', '<xbrldi:explicitMember dimension="x">y</xbrldi:explicitMember></xbrli:entity>'), /Dreimonatsumsatz/],
  ['typed dimension', '<xbrli:context id="OneD"', l => l.replace('</xbrli:entity>', '<xbrldi:typedMember dimension="x">y</xbrldi:typedMember></xbrli:entity>'), /Dreimonatsumsatz/],
  ['duplicate context', '<xbrli:context id="OneD"', l => l + '\n' + l, /Doppelte Kontextkennung/],
];
for (const [name, needle, change, pattern] of mutations) test('XBRL guard: ' + name, () => {
  assert.throws(() => N.parseQuarter(changeLine(xml('LUPIN'), needle, change), selected('LUPIN')), pattern);
});

test('context names, YTD, total income and rounding cannot change the selected quarter', () => {
  const text = xml('LUPIN').replaceAll('OneD', 'ArbitraryCurrentContext');
  assert.equal(N.parseQuarter(text, selected('LUPIN')).revenue, 78272600000);
  const ytd = changeLine(text, ':RevenueFromOperations contextRef="FourD"', l => l.replace('161041500000', '999999999999999'));
  assert.equal(N.parseQuarter(ytd, selected('LUPIN')).revenue, 78272600000);
  assert.equal(N.parseQuarter(changeLine(text, ':LevelOfRounding ', l => l.replace('Millions', 'Crores')), selected('LUPIN')).revenue, 78272600000);
  assert.equal(N.parseQuarter(changeLine(text, ':RevenueFromOperations contextRef="ArbitraryCurrentContext"', l => l.replace('78272600000', '0')), selected('LUPIN')).revenue, 0);
  assert.throws(() => N.parseQuarter('<!DOCTYPE x>' + text, selected('LUPIN')), /Entitaet/);
  assert.throws(() => N.parseQuarter(text.replaceAll('in-capmkt', 'unknown'), selected('LUPIN')), /Taxonomie/);
});

test('comparative columns never fill a missing quarter; two current contexts must agree', () => {
  const text = xml('LUPIN');
  const currentLines = text.split('\n').filter(l => l.includes('contextRef="OneD"') || l.includes('<xbrli:context id="OneD"'));
  const comparative = currentLines.join('\n').replaceAll('OneD', 'PriorYear')
    .replaceAll('2026-07-01', '2025-07-01').replaceAll('2026-09-30', '2025-09-30')
    .replace('>78272600000<', '>987654321<');
  const withPrior = text.replace('</xbrli:xbrl>', comparative + '\n</xbrli:xbrl>');
  assert.equal(N.parseQuarter(withPrior, selected('LUPIN')).revenue, 78272600000);
  assert.throws(() => N.parseQuarter(changeLine(withPrior, ':RevenueFromOperations contextRef="OneD"', () => ''), selected('LUPIN')), /Dreimonatsumsatz/);
  const second = currentLines.join('\n').replaceAll('OneD', 'SecondCurrent').replace('>78272600000<', '>987654321<');
  assert.throws(() => N.parseQuarter(text.replace('</xbrli:xbrl>', second + '\n</xbrli:xbrl>'), selected('LUPIN')), /Quartalsumsaetze/);
});

test('identical full names share one entry; ambiguous names or absent names do not', () => {
  const m = N.listingMap(stocks);
  assert.equal(m.aliases['LUPIN.BO'], 'LUPIN.NS');
  assert.equal(N.listingMap([...stocks, { ticker: 'SECOND.NS', name: 'Lupin Limited' }]).aliases['LUPIN.BO'], undefined);
  assert.equal(N.listingMap([{ ticker: 'X.NS' }, { ticker: 'X.BO' }]).aliases['X.BO'], undefined);
  assert.equal(N.listingMap([{ ticker: 'TI.NS', name: 'Tilaknagar Industries Ltd.' }, { ticker: 'TIINDIA.BO', name: 'Tilaknagar Industries Ltd.' }]).aliases['TIINDIA.BO'], 'TI.NS');
  assert.throws(() => N.extendAliases(store(), { aliases: { 'LUPIN.BO': 'WRONG.NS' }, evidence: {} }), /Zuordnung/);
});

test('append-only store retains changed observations and refuses every destructive change', () => {
  const old = store(), next = clone(old), o = observation('LUPIN');
  N.appendQuarter(next, 'LUPIN.NS', o, { src: 'second', fetchedAt: '2026-11-13T00:00:00Z', updateDate: o.availableAfter });
  assert.equal(next.companies['LUPIN.NS'].quarterly[o.periodEnd].length, 1);
  N.appendQuarter(next, 'LUPIN.NS', { ...o, revenue: 10, filingId: '209300' }, { src: 'third', fetchedAt: '2026-11-14T00:00:00Z', updateDate: '2026-11-13' });
  assert.equal(next.companies['LUPIN.NS'].quarterly[o.periodEnd].length, 2);
  N.assertStore(old, next);
  assert.deepEqual(JSON.parse(S.serialiseStore(next)), next);
  for (const change of [
    x => { delete x.companies['LUPIN.NS']; },
    x => { x.companies['LUPIN.NS'].quarterly[o.periodEnd][0].revenue = 5; },
    x => { x.companies['LUPIN.NS'].quarterly[o.periodEnd].pop(); },
    x => { x.companies['LUPIN.NS'].quarterly[o.periodEnd][0].confirmedBy.pop(); },
    x => { delete x.sources.original; }, x => { x.aliases['LUPIN.BO'] = 'WRONG.NS'; },
    x => { x.aliasEvidence['LUPIN.BO'].name = 'Other'; }, x => { x.market = 'XX'; },
  ]) { const broken = clone(old); change(broken); assert.throws(() => N.assertStore(old, broken)); }
});

const ends = ['2026-09-30', '2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'];
test('real Yahoo comparison is period aligned and uses its applied FX: one agrees, one disagrees', () => {
  const s = store(), lupus = R.compareTicker('LUPIN.NS', yahoo['LUPIN.NS'], s, '2026-11-11', ends);
  const chennai = R.compareTicker('CHENNPETRO.NS', yahoo['CHENNPETRO.NS'], s, '2026-11-11', ends);
  assert.equal(lupus[0].category, 'agree'); assert.equal(chennai[0].category, 'disagree');
  assert.ok(lupus[0].relativeDifference > 0.005 && lupus[0].relativeDifference < 0.006);
  assert.ok(chennai[0].relativeDifference > 0.07);
  assert.equal(lupus[1].category, 'yahoo-only'); assert.equal(lupus[4].category, 'unchecked');
  const report = R.buildReport({ store: s, stocks, snapshotFor: t => yahoo[t], cohort: { tickers: ['LUPIN.NS'], dataDate: '2026-11-11' }, asOf: '2026-11-11' });
  assert.equal(report.companySummary.comparable, 2); assert.equal(report.companySummary.agreeShare, 0.5);
  assert.equal(report.watchlistSummary.comparable, 3); assert.equal(report.wouldFill, 0); assert.equal(report.step3Enabled, false);
  assert.match(R.render(report), /50,00 %/);
});

test('all five categories, 1% boundary, zero and null are distinct', () => {
  const s = store(), snap = clone(yahoo['LUPIN.NS']);
  const compare = () => R.compareTicker('LUPIN.NS', snap, s, '2026-11-11', ['2026-09-30'])[0];
  snap.timeseries.revenueQ[0].value = observation('LUPIN').revenue * snap.meta.fxRateApplied / 1.01;
  assert.equal(compare().category, 'agree');
  snap.timeseries.revenueQ[0].value /= 1.0001; assert.equal(compare().category, 'disagree');
  snap.timeseries.revenueQ[0].value = null; assert.equal(compare().category, 'nse-only');
  snap.timeseries.revenueQ[0].value = 0; assert.equal(compare().category, 'disagree');
  s.companies['LUPIN.NS'].quarterly['2026-09-30'][0].revenue = 0;
  assert.equal(compare().category, 'agree');
});

for (const [name, change] of [
  ['FX absent', s => { delete s.meta.fxRateApplied; }], ['FX zero', s => { s.meta.fxRateApplied = 0; }],
  ['wrong ticker', s => { s.meta.ticker = 'OTHER'; }], ['wrong original currency', s => { s.meta.reportingCurrencyOriginal = 'USD'; }],
  ['wrong output currency', s => { s.meta.reportingCurrency = 'INR'; }],
  ['wrong period mark', s => { s.meta.statementPeriods.revenueQ[0].end = '2026-06-30'; }],
  ['wrong duration', s => { s.meta.statementPeriods.revenueQ[0].duration = '6M'; }],
  ['duplicate ends', s => { s.timeseries.revenueQEnds[1] = s.timeseries.revenueQEnds[0]; }],
  ['length mismatch', s => { s.timeseries.revenueQEnds.pop(); }], ['negative', s => { s.timeseries.revenueQ[0].value = -1; }],
]) test('shadow guard: ' + name, () => {
  const snap = clone(yahoo['LUPIN.NS']); change(snap);
  const row = R.compareTicker('LUPIN.NS', snap, store(), '2026-11-11', ['2026-09-30'])[0];
  assert.equal(row.category, 'unchecked'); assert.ok(row.reason);
});

test('same-day filing is excluded; a later revision cannot erase the earlier available version', () => {
  const s = store();
  assert.equal(R.compareTicker('LUPIN.NS', yahoo['LUPIN.NS'], s, '2026-11-04', ['2026-09-30'])[0].category, 'unchecked');
  const obs = s.companies['LUPIN.NS'].quarterly['2026-09-30'];
  obs.push({ ...obs[0], availableAfter: '2026-11-12', filingId: '209300', revenue: 123 });
  assert.equal(R.latestAvailable(obs, '2026-11-11').filingId, '209216');
  assert.equal(R.latestAvailable(obs, '2026-11-13').filingId, '209300');
  const sameDay = [{ ...obs[0], filingId: '209215', creationDate: '04-Nov-2026 12:00:00' }, obs[0]];
  assert.equal(R.latestAvailable(sameDay, '2026-11-11').filingId, '209215');
});

test('company controls and global 95% gate cannot pass by vacuous truth', () => {
  const row = (periodEnd, category) => ({ periodEnd, category, yahooUSD: category === 'nse-only' ? null : 100, nseINR: 100 });
  const rows = [row('2026-09-30', 'agree'), row('2025-09-30', 'nse-only'), row('2026-06-30', 'agree')];
  assert.equal(R.pairStatus(rows, '2026-09-30', '2025-09-30').wouldFillBeforeGlobalGate, true);
  for (const category of ['yahoo-only', 'disagree', 'unchecked', 'nse-only']) {
    assert.equal(R.pairStatus([...rows.slice(0, 2), row('2026-06-30', category)], '2026-09-30', '2025-09-30').wouldFillBeforeGlobalGate, false);
  }
  assert.equal(R.summarize([]).thresholdPassed, false);
  assert.equal(R.summarize([...Array(19).fill({ category: 'agree' }), { category: 'disagree' }]).thresholdPassed, true);
  assert.equal(R.summarize([...Array(18).fill({ category: 'agree' }), { category: 'disagree' }]).thresholdPassed, false);
});

function tempCase() {
  const base = process.env.NSE_TEST_TMP || os.tmpdir();
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, 'nse-test-'));
  const out = path.join(dir, 'in.json');
  assert.notEqual(path.resolve(out), path.resolve(F.DEFAULT_OUT));
  const watchlist = path.join(dir, 'watchlist.json');
  fs.writeFileSync(watchlist, JSON.stringify({ stocks }));
  return { out, watchlist };
}

test('offline ingestion is resumable, keeps aliases shared and never touches a network seam', async () => {
  const opts = { ...tempCase(), offline: DIR, asOf: '2026-11-12', now: '2026-11-12T12:00:00Z', log() {},
    fetchBuffer() { throw new Error('NETWORK FORBIDDEN'); } };
  const first = await F.main(opts), second = await F.main({ ...opts, now: '2026-11-12T13:00:00Z' });
  assert.equal(first.ok, true); assert.equal(first.run.calls, 0); assert.equal(first.run.read.length, 2);
  assert.equal(first.run.pending.length, 12); N.assertStore(first.store, second.store);
  assert.equal(Object.keys(second.store.companies).length, 2);
  assert.equal(second.store.aliases['LUPIN.BO'], 'LUPIN.NS');
  assert.equal(second.store.companies['LUPIN.NS'].quarterly['2026-09-30'].length, 1);
});

function fakeNetwork({ bad = false } = {}) {
  const calls = [];
  const fetchBuffer = async (url, opts) => {
    assert.equal(opts.pauseMs, 1500); assert.equal(opts.versuche, 1);
    assert.ok(opts.headers['User-Agent'].startsWith('Mozilla/'));
    assert.ok(!calls.includes(url), 'one request per URL'); calls.push(url);
    if (!url.includes('/api/') && !url.includes('/corporate/xbrl/')) return { body: Buffer.from('html'), headers: { 'set-cookie': ['bm_sz=test; Path=/'] } };
    if (url.includes('/api/')) {
      assert.match(opts.headers.Cookie, /bm_sz=test/);
      if (bad) return { body: Buffer.from('{"error":"blocked"}'), headers: {} };
      const symbol = new URL(url).searchParams.get('symbol');
      const data = list(symbol).data.filter(r => r.qe_Date === '30-SEP-2026');
      return { body: Buffer.from(JSON.stringify({ data, totalCount: data.length })), headers: {} };
    }
    for (const symbol of ['LUPIN', 'CHENNPETRO']) if (url === selected(symbol).url) return { body: Buffer.from(xml(symbol)), headers: {} };
    throw new Error('unexpected URL');
  };
  return { fetchBuffer, calls };
}

test('live orchestration respects bootstrap, cookie, host delay, exact list, call cap and no hidden retries', async () => {
  const net = fakeNetwork();
  const first = await F.main({ ...tempCase(), ...net, asOf: '2026-11-12', now: '2026-11-12T12:00:00Z', cap: 4, log() {} });
  assert.equal(first.run.calls, 4); assert.equal(net.calls.length, 4); assert.equal(first.run.pending.length, 1);
  assert.equal(first.run.read.length, 1);
  assert.ok(net.calls.some(u => u.endsWith('/api/integrated-filing-results?index=equities&symbol=CHENNPETRO&size=200')));
  const net2 = fakeNetwork({ bad: true });
  const bad = await F.main({ ...tempCase(), ...net2, asOf: '2026-11-12', now: '2026-11-12T12:00:00Z', log() {} });
  assert.equal(bad.ok, false); assert.equal(Object.keys(bad.store.companies).length, 0);
});

test('a first live pass verifies fixture-seeded filings and appends its provenance', async () => {
  const opts = { ...tempCase(), asOf: '2026-11-12', now: '2026-11-12T12:00:00Z', log() {} };
  const offline = await F.main({ ...opts, offline: DIR });
  const net = fakeNetwork();
  const live = await F.main({ ...opts, ...net, now: '2026-11-12T13:00:00Z' });
  assert.equal(live.run.calls, 6);
  assert.equal(net.calls.filter(u => u.includes('/corporate/xbrl/')).length, 2);
  N.assertStore(offline.store, live.store);
});

test('bootstrap without cookie fails loudly, while dry-run preserves the exact file', async () => {
  const opts = { ...tempCase(), asOf: '2026-11-12', now: '2026-11-12T12:00:00Z', log() {} };
  const failed = await F.main({ ...opts, fetchBuffer: async () => ({ body: Buffer.from('html'), headers: {} }) });
  assert.equal(failed.ok, false); assert.match(failed.run.issues[0], /ohne Cookie/);
  const before = fs.readFileSync(opts.out, 'utf8');
  await F.main({ ...opts, offline: DIR, dryRun: true });
  assert.equal(fs.readFileSync(opts.out, 'utf8'), before);
});

test('a malformed company does not starve the rest of a capped queue on the next run', async () => {
  const opts = { ...tempCase(), asOf: '2026-11-12', now: '2026-11-12T12:00:00Z', symbols: 1, log() {} };
  const first = await F.main({ ...opts, ...fakeNetwork({ bad: true }) });
  assert.equal(first.ok, false); assert.deepEqual(first.run.attempted, ['CHENNPETRO.NS']);
  const net = fakeNetwork();
  const next = await F.main({ ...opts, ...net, now: '2026-11-12T13:00:00Z' });
  assert.equal(next.ok, true); assert.deepEqual(next.run.checked, ['LUPIN.NS']);
  assert.ok(net.calls.some(u => u.includes('symbol=LUPIN&')));
});

test('corrupt stores, invalid caps, path traversal and unknown CLI args fail before fetching', async () => {
  const t = tempCase(); fs.writeFileSync(t.out, '{bad');
  await assert.rejects(F.main({ ...t, offline: DIR }), SyntaxError);
  await assert.rejects(F.main({ ...tempCase(), cap: 0, offline: DIR }), /Abruflimit/);
  await assert.rejects(F.main({ ...tempCase(), symbols: 0, offline: DIR }), /Symbollimit/);
  assert.throws(() => F.cli(['--unknown=1']), /Argument/);
  assert.throws(() => F.offlinePackage(DIR).read('../bewertung/snapshot-full.json'), /verlaesst/);
});

test('cohort is the 84 unique rows of the original measurement; workflow publishes no board or commit', () => {
  const cohort = require('./fixtures/nse-quarters/cohort-2026-11-11.json');
  assert.equal(cohort.tickers.length, 84); assert.equal(new Set(cohort.tickers).size, 84);
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/nse-quarters.yml'), 'utf8');
  assert.match(workflow, /contents: read/); assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /name: NSE Quarters Shadow Smoke Test/);
  assert.match(workflow, /# Smoke test only:/); assert.match(workflow, /--cap=200 --symbols=12\b/);
  assert.match(workflow, /node --test tests\/nse-quarters\.test\.js tests\/nse-quarters-recovery\.test\.js/);
  assert.doesNotMatch(workflow, /git (?:push|commit)|schedule:|secrets\./);
});

test('live value type_Sub "Revision" (measured 12.11.2026: AADHARHFC, AARTIIND, 360ONE) is accepted, an invented value still aborts', () => {
  const original = list('LUPIN').data.find(r => r.seq_Id === '209216');
  const revision = { ...original, seq_Id: '209301', type_Sub: 'Revision', broadcast_Date: null,
    revised_Date: '05-NOV-2026 10:00:00', creation_Date: '05-Nov-2026 10:01:00', revision_Remark: 'along with Declaration' };
  const f = N.selectFilings([original, revision], 'LUPIN', '2026-11-12')[0];
  assert.equal(f.filingId, '209301'); assert.equal(f.revision, 'Revision'); assert.equal(f.availableAfter, '2026-11-05');
  assert.throws(() => N.selectFilings([{ ...original, type_Sub: 'Whatever' }], 'LUPIN', '2026-11-12'), /Meldungsfassung/);
});
