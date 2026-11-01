'use strict';
// Offline lifecycle guards. No writes: break-once tests may mutate only in-memory module copies.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { aufnahmeTor } = require('../discovery/aufnahme-tor.js');
const state = require('../discovery/listing-state.js');
const { wendeAufnahmeTorAn, wendeListingRegisterAn, applyDeadRegistryAndCap, capNewTickerAdmission } = require('../refresh-universe.js');
const registry = require('../data-health/dead-tickers.json');
const NOW = Date.parse('2026-10-30T10:00:00Z');
const live = symbol => ({ symbol, quoteType: 'EQUITY', regularMarketTime: new Date(NOW), regularMarketPrice: 5, marketCap: 1e9 });
const save = (_file, value) => JSON.parse(JSON.stringify(value));

test('vendor gaps have a date, evidence, provisional state and an independent retry candidate', async () => {
  const candidates = ['NO-CAP', 'OLD', 'MISSING'].map(ticker => ({ ticker, source: 'test', exchange: 'NYSE' }));
  const r = await aufnahmeTor(candidates, row => [row.ticker], { nowMs: NOW,
    quote: async () => [{ ...live('NO-CAP'), marketCap: undefined },
      { ...live('OLD'), regularMarketTime: new Date(NOW - 31 * 86400000) }] });
  assert.deepEqual(r.rejected.map(row => row.grund), ['ohne-marktwert', 'kurs-zu-alt', 'keine-quote']);
  for (const row of r.rejected) {
    assert.equal(row.status, 'vorlaeufig');
    assert.equal(row.datum, '2026-10-30');
    assert.match(row.quelle, /^https:\/\//);
    assert.match(row.wiederaufnahme, /automatische Wiederaufnahme/);
    assert.equal(row.kandidat.ticker, row.ticker);
  }
});

test('the next run recovers without any rediscovery and retains cap-delayed retries', async () => {
  const log = {};
  const candidate = { ticker: 'LIVE', source: 'test', exchange: 'NYSE' };
  const first = await wendeAufnahmeTorAn([candidate], log, 'memory', { nowMs: NOW, quote: async () => [], writeProtocol: save });
  assert.deepEqual(first, []);
  const persisted = JSON.parse(JSON.stringify(log));
  const retry = state.retryCandidates({ tickers: {} }, persisted, []);
  assert.equal(retry.length, 1);
  const second = await wendeAufnahmeTorAn(retry, persisted, 'memory', { nowMs: NOW + 86400000,
    quote: async batch => batch.map(live), writeProtocol: save });
  assert.deepEqual(second.map(row => row.ticker), ['LIVE']);
  assert.equal(persisted.tor3_aufnahmeQuote.abgelehnt.length, 0);
  assert.equal(state.retryCandidates({ tickers: {} }, persisted, []).length, 1, 'a capacity-delayed admission stays retryable');
  assert.deepEqual(state.retryCandidates({ tickers: {} }, persisted, second), [], 'an admitted row is no longer retried');
});

test('unwritable or unavailable intake evidence cancels every new rejection and warns', async () => {
  const input = [{ ticker: 'GOOD' }, { ticker: 'MISSING' }];
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = message => warnings.push(message);
  try {
    for (const log of [null, { marker: 'unchanged' }]) {
      const before = JSON.stringify(log);
      const kept = await wendeAufnahmeTorAn(input, log, 'memory', { nowMs: NOW,
        quote: async () => [live('GOOD')], writeProtocol: () => { throw new Error('write failed'); } });
      assert.equal(kept, input);
      assert.equal(JSON.stringify(log), before, 'failed writes must not publish an in-memory protocol either');
    }
    assert.equal(warnings.filter(message => /Ablehnungen.*nicht angewendet/.test(message)).length, 2);
  } finally { console.warn = originalWarn; }
});

test('registry and mapping exits persist with all evidence and vanish from export on re-entry', () => {
  const reg = { tickers: { OLD: 'abgeloest' }, w7_2026_10_30: {
    confirmed: { OLD: { datum: '2026-10-01', grund: 'Das alte Kuerzel ist abgeloest.', quelle: 'https://example.com/issuer', nachfolger: 'NEW' } },
    mappings: { WRONG: { datum: '2026-10-30', grund: 'Die Zuordnung war falsch.', quelle: 'https://example.com/exchange', nachfolger: 'RIGHT' } },
  } };
  const stocks = [{ ticker: 'OLD' }, { ticker: 'NEW' }, { ticker: 'WRONG' }, { ticker: 'RIGHT', name: 'Correct' }, { ticker: 'KEEP' }];
  const log = {};
  const result = wendeListingRegisterAn(stocks, reg, log, 'memory', { nowMs: NOW, writeProtocol: save });
  assert.deepEqual(result.stocks.map(row => row.ticker), ['NEW', 'RIGHT', 'KEEP']);
  assert.equal(result.stocks[1].name, 'Correct');
  const delivered = state.deliveredListingExits(JSON.parse(JSON.stringify(log)), result.stocks);
  assert.deepEqual(delivered.map(row => row.ticker), ['OLD', 'WRONG']);
  for (const row of delivered) {
    assert.equal(row.date, '2026-10-30');
    assert.ok(row.reason && row.source && row.successor);
  }
  assert.equal(state.deliveredListingExits(log, stocks).length, 0);
  assert.equal(state.deliveredListingExits(log, []).length, 2, 'absence of snapshots cannot lose an exit');
  const unchanged = wendeListingRegisterAn(stocks, reg, {}, 'memory', { nowMs: NOW,
    writeProtocol: () => { throw new Error('write failed'); } });
  assert.equal(unchanged.stocks, stocks);
  assert.deepEqual(unchanged.exits, []);
  assert.throws(() => state.deliveredListingExits({ listingExits: [{ ticker: 'LOST' }] }, []), /Unvollstaendiger/);
});

test('mapping without an existing successor repairs the symbol without changing other rows', () => {
  const reg = { w7_2026_10_30: { mappings: { WRONG: { nachfolger: 'RIGHT', datum: '2026-10-30', grund: 'Falsches Kuerzel.', quelle: 'https://example.com' } } } };
  const duplicates = [{ ticker: 'KEEP' }, { ticker: 'KEEP' }];
  const r = state.planListingExits([{ ticker: 'WRONG', yahoo_symbol: 'WRONG' }, ...duplicates], reg, '2026-10-30');
  assert.deepEqual(r.stocks.map(row => row.ticker), ['RIGHT', 'KEEP', 'KEEP']);
  assert.equal(r.stocks[0].yahoo_symbol, 'RIGHT');
  assert.deepEqual(state.mapListingCandidates([{ ticker: 'WRONG' }, { ticker: 'RIGHT', name: 'Correct' }], reg), [{ ticker: 'RIGHT', name: 'Correct' }]);
});

test('W7 registry retains only sourced final cases and keeps vendor gaps retryable', () => {
  const w7 = registry.w7_2026_10_30;
  assert.ok(w7, 'W7 lifecycle evidence must exist');
  assert.equal(Object.keys(w7.confirmed).length, 14);
  assert.equal(Object.keys(w7.provisional).length, 74);
  assert.equal(Object.keys(w7.mappings).length, 2);
  for (const [ticker, row] of Object.entries(w7.confirmed)) {
    assert.ok(registry.tickers[ticker]);
    assert.match(row.quelle, /^https:\/\//);
    assert.ok(row.datum && row.grund);
  }
  for (const [ticker, row] of Object.entries(w7.provisional)) {
    assert.equal(registry.tickers[ticker], undefined);
    assert.equal(row.status, 'vorlaeufig');
    assert.ok(row.datum && row.grund && row.quelle && row.wiederaufnahme);
  }
  for (const [wrong, right] of [['QGEN.DE', 'QIA.DE'], ['RTL.DE', 'RRTL.DE']]) {
    assert.equal(registry.tickers[wrong], undefined);
    assert.equal(w7.mappings[wrong].nachfolger, right);
    assert.match(w7.mappings[wrong].quelle, /^https:\/\//);
  }
  assert.equal(registry.tickers['1WAF.MI'], undefined);
  const retry = state.retryCandidates(registry, {}, []);
  assert.ok(retry.some(row => row.ticker === '1WAF.MI'));
  assert.ok(!retry.some(row => ['ARX.TO', 'PSKY', 'QGEN.DE', 'RTL.DE'].includes(row.ticker)));
  const watchlist = require('../watchlist.json').stocks;
  for (const ticker of ['FIRY', 'BSIN', 'YARW', 'QIA.DE', 'RRTL.DE']) {
    assert.equal(watchlist.filter(row => row.ticker === ticker).length, 1, ticker + ' must remain once');
  }
});

test('refresh consumes retained retries before the cap and export emits listing exits', () => {
  const refresh = fs.readFileSync(path.join(__dirname, '..', 'refresh-universe.js'), 'utf8');
  const retry = refresh.search(/^  const retryRows = retryCandidates\(listingRegistry,/m);
  const cap = refresh.indexOf('  applyDeadRegistryAndCap(allTickers, deadRegistry, MAX_UNIVERSE);');
  assert.ok(retry > -1 && cap > retry);
  assert.ok(refresh.search(/^  newTickers = intakeCandidates\(newTickers, retryRows, existing\);$/m) > cap);
  assert.match(refresh, /^    vorherigesProtokoll = readIntakeLog\(ausschlussPfad\);$/m);
  assert.match(refresh, /^  const listingPlan = wendeListingRegisterAn\(wlRaw.stocks, listingRegistry,/m);
  const writer = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'write-excluded-list.js'), 'utf8');
  assert.match(writer, /^    listingExits,$/m);
  assert.match(writer, /^    listingExitCount: listingExits.length,$/m);
  assert.match(writer, /^  try \{ listingExits = readListingExitManifest\(listingManifest, fs.readFileSync\); \}$/m);
  const merge = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'filter-snapshot-merge.js'), 'utf8');
  assert.match(merge, /^  writeListingExitManifest\(path.join\(path.dirname\(path.resolve\(watchlistPfad\)\),/m);
});

test('saved vendor gaps are queried even under the real raw candidate cap', async () => {
  const source = new Map(['A', 'B', 'C'].map((ticker, i) => [ticker, { ticker, marketCap: (3 - i) * 1e9 }]));
  source.set('OTHER', { ticker: 'OTHER', marketCap: null });
  source.set('RECOVER', { ticker: 'RECOVER', marketCap: null });
  applyDeadRegistryAndCap(source, {}, 3);
  assert.equal(source.has('RECOVER'), false, 'fixture must exercise the starvation case');
  const candidates = state.intakeCandidates([...source.values()], [{ ticker: 'RECOVER' }], new Set());
  const asked = new Set();
  const result = await wendeAufnahmeTorAn(candidates, {}, 'memory', { nowMs: NOW, writeProtocol: save,
    quote: async batch => { batch.forEach(t => asked.add(t)); return batch.filter(t => t === 'RECOVER').map(live); } });
  assert.ok(asked.has('RECOVER'));
  assert.deepEqual(capNewTickerAdmission(result, 2, 3).map(row => row.ticker), ['RECOVER']);
  assert.deepEqual(capNewTickerAdmission(result, 3, 3), [], 'the final persistence cap is unchanged');
  const fresh = { ticker: 'RECOVER', marketCap: 10e9, name: 'Fresh', source: 'nasdaq-trader' };
  const combined = state.intakeCandidates([fresh, { ticker: 'OTHER', marketCap: 1e9 }],
    [{ ticker: 'RECOVER', marketCap: null, name: 'Old', source: 'test' }], new Set());
  assert.deepEqual(combined.find(row => row.ticker === 'RECOVER'), fresh);
  assert.deepEqual(capNewTickerAdmission(combined, 2, 3).map(row => row.ticker), ['RECOVER']);
});

test('snapshot handoff keeps same-day exits despite the stale scoring checkout', () => {
  const log = { listingExits: [{ ticker: 'ARX.TO', datum: '2026-10-30', grund: 'Die Uebernahme ist abgeschlossen.',
    quelle: 'https://example.com/issuer', nachfolger: null }] };
  let written;
  state.writeListingExitManifest('prep-log', [{ ticker: 'OTHER' }], 'snapshots', '2026-10-30',
    (file, data) => { assert.equal(path.basename(file), state.LISTING_EXITS_FILE); written = data; }, () => log);
  assert.equal(require('../lib/snapshot-fs.js').isMetadataSnapshot(state.LISTING_EXITS_FILE), true);
  const rows = state.readListingExitManifest('snapshot-artifact', () => written);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ticker, 'ARX.TO');
  assert.equal(rows[0].source, log.listingExits[0].quelle);
  assert.equal(state.deliveredListingExits(log, [{ ticker: 'ARX.TO' }]).length, 0, 'a pre-run watchlist would wrongly hide the exit');
  assert.throws(() => state.readListingExitManifest('corrupt', () => '{}'), /Ungueltiger/);
  state.writeListingExitManifest('prep-log', [{ ticker: 'ARX.TO' }], 'snapshots', '2026-10-31',
    (_file, data) => { written = data; }, () => log);
  assert.deepEqual(state.readListingExitManifest('snapshot-artifact', () => written), [], 'real re-entry clears the delivered exit');
});

test('both registry formats deliver every confirmed source, event date and successor', () => {
  const w7 = registry.w7_2026_10_30.confirmed;
  const merged = registry.belege_2026_10_30;
  assert.equal(Object.keys(merged).length, 43);
  assert.equal(Object.values(merged).filter(row => row.nachfolger).length, 6);
  const before = JSON.stringify(registry);
  const tickers = [...Object.keys(w7), ...Object.keys(merged)];
  assert.equal(new Set(tickers).size, 57);
  const plan = state.planListingExits(tickers.map(ticker => ({ ticker })), registry, '2026-11-03');
  const delivered = state.deliveredListingExits({ listingExits: plan.exits }, plan.stocks);
  assert.equal(delivered.length, 57);
  for (const row of delivered) {
    const evidence = w7[row.ticker] || merged[row.ticker];
    assert.equal(row.source, evidence.quelle, row.ticker);
    assert.equal(row.belegDatum, evidence.datum || evidence.ende, row.ticker);
    assert.equal(row.successor, evidence.nachfolger || null, row.ticker);
    assert.equal(row.reason, evidence.grund || registry.tickers[row.ticker], row.ticker);
    assert.equal(row.date, '2026-11-03', 'exit date is distinct from event date');
    assert.equal(row.status, 'bestaetigt', row.ticker);
  }
  assert.equal(JSON.stringify(registry), before, 'source registry must not be rewritten');
  assert.deepEqual(state.deliveredListingExits({ listingExits: plan.exits }, [{ ticker: 'SCZ.V' }])
    .filter(row => row.ticker === 'SCZ.V'), [], 're-entry still suppresses an old exit');
});

test('only superseded PSKY field expectations expire before the new absence check', () => {
  const expectations = require('../data-health/erwartungen.json');
  for (const id of ['pr33-PSKY-rang', 'pr33-PSKY-ranggrund']) {
    const row = expectations.find(entry => entry.id === id);
    assert.equal(row.gueltigBis, '2026-11-02', id);
    assert.match(row.grund, /03\.11\.2026/);
    assert.match(row.grund, /SKYD/);
  }
  for (const row of expectations.filter(entry => entry.ticker === '1WAF.MI')) {
    assert.equal(row.gueltigBis, undefined, row.id + ' must stay active');
  }
  assert.equal(expectations.find(row => row.id === 'w7-PSKY-board').gueltigAb, '2026-11-03');
});
