'use strict';
/** Shadow-only NSE quarterly store. No vendor series or board is written.
 * Usage: node scripts/fetch-nse-quarters.js [--offline=tests/fixtures/nse-quarters]
 *        [--out=...] [--watchlist=...] [--as-of=YYYY-MM-DD] [--cap=200] [--symbols=20]
 * Live mode uses one integrated list per symbol and one download per new filing.
 * The call cap includes the two warm-up pages; there are no hidden retries.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const N = require('../lib/nse-quarters');
const S = require('../lib/exchange-quarter-store');
const A = require('./build-inannual');
const { fetchBuffer } = require('../lib/fetch-retry');
const { writeFileAtomic } = require('../lib/atomic-write');
const { loadWatchlist } = require('../lib/watchlist-fs');
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUT = path.join(ROOT, 'external-data/exchange-quarters/in.json');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const BROWSER = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: '*/*', 'Accept-Language': 'en-US,en;q=0.9', Referer: N.BASIS + '/',
  'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'same-origin',
};

function loadStore(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  const store = JSON.parse(text);
  N.assertStore(null, store);
  return store;
}

function positiveInt(value, max, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(name + ' ausserhalb 1..' + max);
  return n;
}

// Even a poisoned manifest cannot escape its fixture directory. No network fallback.
function offlinePackage(dir) {
  const base = fs.realpathSync(dir), manifest = JSON.parse(fs.readFileSync(path.join(base, 'manifest.json'), 'utf8'));
  function read(relative) {
    if (typeof relative !== 'string') throw new Error('Datei nicht im Offline-Paket');
    const target = fs.realpathSync(path.resolve(base, relative));
    if (!target.startsWith(base + path.sep)) throw new Error('Offline-Pfad verlaesst das Paket');
    return fs.readFileSync(target, 'utf8');
  }
  return { manifest, read };
}

async function main(opts = {}) {
  const out = opts.out || DEFAULT_OUT;
  const now = opts.now || new Date().toISOString(), asOf = opts.asOf || now.slice(0, 10);
  if (!N.validDate(asOf) || !Number.isFinite(Date.parse(now))) throw new Error('Stichtag ungueltig');
  const cap = positiveInt(opts.cap ?? 200, 500, 'Abruflimit');
  const maxSymbols = positiveInt(opts.symbols ?? 20, 200, 'Symbollimit');
  const wl = loadWatchlist(opts.watchlist || path.join(ROOT, 'watchlist.json'));
  if (wl.error || wl.shape === 'invalid') throw new Error('Beobachtungsliste unlesbar');
  const mapping = N.listingMap(wl.stocks), before = loadStore(out);
  const store = before ? structuredClone(before) : N.emptyStore(mapping);
  N.extendAliases(store, mapping);
  const offline = opts.offline ? offlinePackage(opts.offline) : null;
  const run = { fetchedAt: now, asOf, mode: offline ? 'offline-fixture' : 'live', calls: 0,
    checked: [], attempted: [], read: [], lists: [], issues: [], pending: [], unresolvedAliases: mapping.unresolved };
  const id = now + '-' + crypto.randomUUID();
  const cache = new Map();
  const jar = A.neuerJar();
  const request = async (url, config = {}) => {
    if (cache.has(url)) return cache.get(url);
    const u = new URL(url);
    if (u.origin !== N.BASIS && u.hostname !== N.ARCHIVE) throw new Error('Host nicht erlaubt');
    if (run.calls >= cap) { const e = new Error('Abruflimit erreicht'); e.code = 'NSE_CAP'; throw e; }
    run.calls++;
    const promise = (opts.fetchBuffer || fetchBuffer)(url, { ...config, pauseMs: 1500, versuche: 1 });
    cache.set(url, promise);
    return promise;
  };
  // A bad company must not occupy a capped queue forever. Rotate completed
  // attempts (including parse failures); cap-interrupted work keeps its place.
  const lastAttempt = ticker => Math.max(0, ...Object.values(store.sources)
    .filter(s => (s.attempted || s.checked || []).includes(ticker)).map(s => Date.parse(s.fetchedAt) || 0));
  const queue = Object.keys(mapping.aliases).filter(t => t.endsWith('.NS'))
    .filter(t => !offline || Object.hasOwn(offline.manifest.lists, t.slice(0, -3)))
    .sort((a, b) => lastAttempt(a) - lastAttempt(b) || a.localeCompare(b)).slice(0, maxSymbols);
  let sourceFailures = 0;
  try {
    if (!offline && queue.length) await A.aufwaermen(jar, request);
    for (const ticker of queue) {
      const symbol = ticker.slice(0, -3);
      const url = `${N.BASIS}/api/integrated-filing-results?index=equities&symbol=${encodeURIComponent(symbol)}&size=200`;
      let complete = true;
      try {
        // Once per URL, including bootstrap. Stop before an aged session instead of
        // refreshing the same pages or retrying a server that already said no.
        if (!offline && jar.alterMs() > A.JAR_MAX_ALTER_MS) { run.pending.push(ticker + ': Cookie-Sitzung abgelaufen'); break; }
        const raw = offline ? offline.read(offline.manifest.lists[symbol])
          : (await request(url, { headers: { ...BROWSER, Cookie: jar.kopf() } })).body.toString('utf8');
        const payload = JSON.parse(raw), filings = N.selectFilings(payload, symbol, asOf).slice(0, 8);
        run.lists.push({ ticker, url, sha256: hash(raw), entries: (payload.data || payload).length });
        for (const filing of filings) {
          if (offline && !offline.manifest.filings[filing.filingId]) {
            run.pending.push(`${ticker} ${filing.periodEnd}: nicht im Offline-Paket`); complete = false; continue;
          }
          const old = store.companies[ticker]?.quarterly?.[filing.periodEnd]?.at(-1);
          const liveObserved = old?.confirmedBy?.some(c => store.sources[c.src]?.mode === 'live');
          if (old && (offline || liveObserved) && old.filingId === filing.filingId && old.url === filing.url
              && old.creationDate === filing.creationDate && old.revisedDate === filing.revisedDate
              && old.broadcastDate === filing.broadcastDate) {
            run.read.push(ticker + ' ' + filing.periodEnd); continue;
          }
          try {
            const xml = offline ? offline.read(offline.manifest.filings[filing.filingId])
              : (await request(filing.url, { headers: BROWSER })).body.toString('utf8');
            const observation = N.parseQuarter(xml, filing);
            N.appendQuarter(store, ticker, observation, { src: id, fetchedAt: now, updateDate: filing.availableAfter });
            run.read.push(ticker + ' ' + filing.periodEnd);
            sourceFailures = 0;
          } catch (e) {
            complete = false;
            if (e.code === 'NSE_CAP') throw e;
            run.issues.push(`${ticker} ${filing.periodEnd}: ${e.message}`);
            if (A.istQuellenausfall(e.message)) sourceFailures++;
            if (sourceFailures >= 3) throw new Error('NSE antwortet dreimal in Folge nicht');
          }
        }
        if (complete) run.checked.push(ticker);
        run.attempted.push(ticker);
      } catch (e) {
        if (e.code === 'NSE_CAP') { run.pending.push(ticker + ': Abruflimit erreicht'); break; }
        run.attempted.push(ticker);
        run.issues.push(ticker + ': ' + e.message);
        if (A.istQuellenausfall(e.message)) sourceFailures++;
        if (sourceFailures >= 3) break;
      }
    }
  } catch (e) { run.issues.push(e.message); }
  store.sources[id] = run;
  N.assertStore(before, store);
  // Compare-and-swap guards accidental concurrent runs outside the workflow.
  if (JSON.stringify(loadStore(out)) !== JSON.stringify(before)) throw new Error('NSE-Speicher wurde waehrend des Laufs geaendert');
  if (!opts.dryRun) writeFileAtomic(out, S.serialiseStore(store));
  const log = opts.log || console.log;
  log(`NSE Schatten: ${run.read.length} Quartale, ${run.calls} Abrufe, ${run.issues.length} Fehler, ${run.pending.length} offen.`);
  return { store, run, ok: run.issues.length === 0 };
}

function cli(argv) {
  const opts = {}, allowed = new Set(['offline', 'out', 'watchlist', 'as-of', 'cap', 'symbols']);
  for (const arg of argv) {
    if (arg === '--dry-run') { opts.dryRun = true; continue; }
    const m = /^--([^=]+)=(.+)$/.exec(arg);
    if (!m || !allowed.has(m[1])) throw new Error('Unbekanntes Argument: ' + arg);
    opts[m[1] === 'as-of' ? 'asOf' : m[1]] = m[2];
  }
  return opts;
}

if (require.main === module) Promise.resolve().then(() => main(cli(process.argv.slice(2))))
  .then(result => { if (!result.ok) process.exitCode = 1; })
  .catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { main, cli, loadStore, offlinePackage, DEFAULT_OUT };
