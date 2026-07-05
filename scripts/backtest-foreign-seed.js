#!/usr/bin/env node
/**
 * End-to-end backtest (Team-A Mustfix C): prove the newly-wired foreign adapters'
 * young seed tickers SURVIVE the MAX_UNIVERSE slot-cap into the written watchlist.
 *
 * The network is unavailable in this sandbox, so we can't hit the live JP/TW/KR/CN/HK
 * endpoints. Instead we run the REAL, UNMODIFIED refresh-universe.js main() end to end
 * against a COPY of watchlist.json, and stub ONLY the network boundary:
 *   - yahoo-finance2         -> screener() returns [] (no Yahoo pull needed for this test)
 *   - all 12 discovery/*.js  -> return controlled Maps
 * The 6 foreign fetchers return their builders' real sample seed tickers (marketCap:null,
 * source = the exact string each adapter emits, e.g. 'szse-cn') PLUS the US sources return
 * a large synthetic null-mcap OTC mass so allTickers.size exceeds MAX_UNIVERSE and the
 * slot-cap actually FIRES. If the wiring's source-canonicalization + the infra slot
 * reservation both work, the seeds land in the written copy; otherwise the OTC mass
 * starves them and the assert fails.
 *
 * Real run, no reimplementation of the cap: main() executes verbatim.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const Module = require('module');

const REPO = path.resolve(__dirname, '..');
const WL_SRC = path.join(REPO, 'watchlist.json');

// --- seed tickers we require to survive (from the adapter builders' real samples) ---
const SEEDS = {
  'edinet-jp':  [{ t: '285A.T',   name: 'Kioxia Holdings' }],      // 2024 alphanumeric IPO
  'finmind-tw': [{ t: '6669.TW',  name: 'Wiwynn (young TW)' }],
  'opendart':   [{ t: '247540.KS', name: 'Ecopro BM (young KR)' }],
  'sse-cn':     [{ t: '688797.SS', name: 'STAR Market young' }],
  'szse-cn':    [{ t: '301666.SZ', name: 'ChiNext 341% growth' },
                 { t: '301669.SZ', name: 'ChiNext young' }],
  'hkex':       [{ t: '2533.HK',  name: 'HK young' }],
};
// The specific tickers the task demands must survive:
const REQUIRED = ['301666.SZ', '301669.SZ', '285A.T', '6669.TW', '247540.KS'];

function foreignMap(source, exchange, country) {
  const m = new Map();
  for (const { t, name } of SEEDS[source]) {
    m.set(t, { ticker: t, name, exchange, source, country });
  }
  return m;
}

// Large synthetic US-OTC null-mcap mass to force allTickers.size past MAX_UNIVERSE.
function otcMass(n) {
  const m = new Map();
  for (let i = 0; i < n; i++) {
    const sym = 'OTCX' + i.toString(36).toUpperCase().padStart(5, '0');
    m.set(sym, { ticker: sym, name: 'OTC junk ' + i, exchange: 'OTC', source: 'otc-markets' });
  }
  return m;
}

// --- stub module resolution: intercept the 12 discovery modules + yahoo-finance2 ---
const STUBS = {};
function stubDiscovery(rel, fnName, mapFactory) {
  STUBS[path.join(REPO, rel)] = { [fnName]: async () => mapFactory() };
}
// US sources: nasdaq-all carries the OTC mass; the rest return small/empty so the
// discovery fail-loud floor (>=2 non-empty sources, >=1000 candidates) is satisfied.
stubDiscovery('discovery/nasdaq-all.js',        'fetchNasdaqAll',       () => otcMass(30000));
stubDiscovery('discovery/sec-tickers.js',       'fetchSecTickers',      () => new Map());
stubDiscovery('discovery/finnhub.js',           'fetchFinnhubUniverse', () => new Map());
stubDiscovery('discovery/wikipedia-indices.js', 'fetchWikipediaIndices',() => new Map());
stubDiscovery('discovery/otc-markets.js',       'fetchOTCMarkets',      () => new Map());
stubDiscovery('discovery/nasdaq-api.js',        'fetchNasdaqApiList',   () => new Map());
// Foreign sources: their EXACT emitted source string (pre-canonicalization).
stubDiscovery('discovery/edinet-jp.js', 'fetchEdinetJapan',    () => foreignMap('edinet-jp', 'TSE', 'Japan'));
stubDiscovery('discovery/finmind-tw.js','fetchTaiwanUniverse', () => foreignMap('finmind-tw', 'TWSE', 'Taiwan'));
stubDiscovery('discovery/opendart-kr.js','fetchOpenDartKr',    () => foreignMap('opendart', 'KRX', 'South Korea'));
stubDiscovery('discovery/sse-cn.js',    'fetchSseUniverse',    () => foreignMap('sse-cn', 'SSE', 'China'));
stubDiscovery('discovery/szse-cn.js',   'fetchSzseUniverse',   () => foreignMap('szse-cn', 'SZSE', 'China'));
stubDiscovery('discovery/hkex-hk.js',   'fetchHkexUniverse',   () => foreignMap('hkex', 'HKEX', 'Hong Kong'));

// yahoo-finance2: screener/quote return empty so no live pull happens.
const yfStub = {
  default: class { async screener() { return { quotes: [] }; } async quote() { return null; } }
};

const realResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === 'yahoo-finance2') return 'yahoo-finance2::stub';
  return realResolve.call(this, request, parent, isMain, options);
};
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'yahoo-finance2') return yfStub;
  return realLoad.call(this, request, parent, isMain);
};
// Pre-seed require.cache for the discovery modules so refresh-universe gets our stubs.
for (const [abs, exportsObj] of Object.entries(STUBS)) {
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exportsObj };
}

// --- run the REAL main() against a copy of watchlist.json ---
// main() is not exported, so drive the file as the real entrypoint in THIS process:
// build a Module for refresh-universe.js and set require.main === it, so the
// `if (require.main === module) main()` guard at the file's foot fires.
(async () => {
  const tmp = path.join(os.tmpdir(), 'wl-backtest-' + Date.now() + '.json');
  fs.copyFileSync(WL_SRC, tmp);
  const before = JSON.parse(fs.readFileSync(tmp, 'utf8')).stocks.length;
  process.env.MAX_UNIVERSE = process.env.MAX_UNIVERSE || '25000';
  process.argv = ['node', path.join(REPO, 'refresh-universe.js'), '--watchlist', tmp, '--out', tmp];

  const ruPath = path.join(REPO, 'refresh-universe.js');
  // Load the file's source and expose main() by evaluating it with a tail that
  // returns main, so we can await it deterministically (no polling races).
  let src = fs.readFileSync(ruPath, 'utf8');
  // Neutralize the self-invoking entrypoint guard and export main instead.
  src = src.replace(
    'if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });',
    'module.exports.__main = main;'
  );
  const m = new Module(ruPath, null);
  m.filename = ruPath;
  m.paths = Module._nodeModulePaths(path.dirname(ruPath));
  m._compile(src, ruPath);
  await m.exports.__main();          // run the REAL main() to completion, awaited
  const wl = JSON.parse(fs.readFileSync(tmp, 'utf8'));
  const after = wl.stocks.length;

  const tickers = new Set(wl.stocks.map(s => String(s.ticker).toUpperCase()));
  const results = REQUIRED.map(t => ({ t, present: tickers.has(t.toUpperCase()) }));
  const foreignRows = wl.stocks.filter(s =>
    /\.(SZ|SS|T|TW|TWO|KS|HK)$/.test(String(s.ticker)) &&
    /edinet|finmind|opendart|sse|szse|hkex/.test(String(s.added_via || '')));

  console.log('\n=== BACKTEST RESULT ===');
  console.log('watchlist copy:', tmp);
  console.log('before:', before, ' after:', after, ' (cap MAX_UNIVERSE=' + process.env.MAX_UNIVERSE + ')');
  let allPass = true;
  for (const { t, present } of results) {
    console.log((present ? 'PASS' : 'FAIL') + ' seed survives cap: ' + t);
    if (!present) allPass = false;
  }
  console.log('foreign rows in written watchlist:', foreignRows.length);
  console.log(allPass ? '\nALL REQUIRED SEEDS SURVIVED' : '\nSEED(S) DROPPED BY CAP');
  fs.unlinkSync(tmp);
  process.exit(allPass ? 0 : 1);
})().catch(e => { console.error('BACKTEST ERROR:', e); process.exit(2); });
