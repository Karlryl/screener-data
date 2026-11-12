'use strict';
/** Shadow-only NSE quarterly store. No vendor series or board is written.
 * Usage: node scripts/fetch-nse-quarters.js [--offline=tests/fixtures/nse-quarters]
 *        [--out=...] [--watchlist=...] [--as-of=YYYY-MM-DD] [--cap=200] [--symbols=12] [--pause=2000]
 * Live mode uses one integrated list per symbol and one download per new filing.
 * The cap includes bootstrap and one recovery: two warm-up pages and one retry.
 * All other URLs are fetched once; pause is milliseconds between companies.
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
  const maxSymbols = positiveInt(opts.symbols ?? 12, 200, 'Symbollimit');
  const pause = Number(opts.pause ?? 2000);
  if (!Number.isInteger(pause) || pause < 0 || pause > 60000) throw new Error('Firmenpause ausserhalb 0..60000 ms');
  const wl = loadWatchlist(opts.watchlist || path.join(ROOT, 'watchlist.json'));
  if (wl.error || wl.shape === 'invalid') throw new Error('Beobachtungsliste unlesbar');
  const mapping = N.listingMap(wl.stocks), before = loadStore(out);
  const store = before ? structuredClone(before) : N.emptyStore(mapping);
  N.extendAliases(store, mapping);
  const offline = opts.offline ? offlinePackage(opts.offline) : null;
  const run = { fetchedAt: now, asOf, mode: offline ? 'offline-fixture' : 'live', calls: 0, attemptPolicy: 'source-pending-v1', recoveries: [],
    checked: [], attempted: [], read: [], lists: [], issues: [], pending: [], unresolvedAliases: mapping.unresolved };
  const id = now + '-' + crypto.randomUUID();
  const cache = new Map();
  const jar = A.neuerJar();
  const request = async (url, config = {}, recovery = false) => {
    if (!recovery && cache.has(url)) return cache.get(url);
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.port || u.username || u.password || (u.origin !== N.BASIS && u.hostname !== N.ARCHIVE)) throw new Error('Host nicht erlaubt');
    if (run.calls >= cap) { const e = new Error('Abruflimit erreicht'); e.code = 'NSE_CAP'; throw e; }
    run.calls++;
    const promise = Promise.resolve().then(() => (opts.fetchBuffer || fetchBuffer)(url, { ...config, pauseMs: 1500, versuche: 1 }))
      .then(response => { if (u.origin === N.BASIS) jar.schlucke(response.headers); return response; });
    cache.set(url, promise);
    return promise;
  };
  const isSourceFailure = e => A.istQuellenausfall(e.code) || A.istQuellenausfall(e.message);
  // Completed attempts rotate; interrupted work precedes even never-tried firms.
  // Interpret legacy failures without rewriting their immutable run evidence.
  const queueState = ticker => {
    let attempted = 0, pending = 0;
    const belongs = text => text.startsWith(ticker + ':') || text.startsWith(ticker + ' ');
    for (const s of Object.values(store.sources)) {
      const time = Date.parse(s.fetchedAt) || 0;
      const legacyFailure = !s.attemptPolicy && (s.issues || []).some(text => belongs(text)
        && (A.istQuellenausfall(text) || text.endsWith('Unbekannte Meldungsfassung')));
      const completed = (s.attempted || s.checked || []).includes(ticker) && !legacyFailure;
      if (completed) attempted = Math.max(attempted, time);
      if (legacyFailure || (!completed && (s.pending || []).some(belongs))) pending = Math.max(pending, time);
    }
    return { attempted, pending: pending > attempted };
  };
  const states = new Map(Object.keys(mapping.aliases).map(t => [t, queueState(t)]));
  const queue = Object.keys(mapping.aliases).filter(t => t.endsWith('.NS'))
    .filter(t => !offline || Object.hasOwn(offline.manifest.lists, t.slice(0, -3)))
    .sort((a, b) => Number(states.get(b).pending) - Number(states.get(a).pending)
      || states.get(a).attempted - states.get(b).attempted || a.localeCompare(b)).slice(0, maxSymbols);
  let sourceFailures = 0;
  let rewarmed = false;
  const dataRequest = async url => {
    const attempt = async recovery => {
      if (jar.alterMs() > A.JAR_MAX_ALTER_MS) { const e = new Error('Cookie-Sitzung abgelaufen'); e.code = 'NSE_COOKIE'; throw e; }
      try {
        const headers = { ...BROWSER, ...(new URL(url).origin === N.BASIS ? { Cookie: jar.kopf() } : {}) };
        const response = await request(url, { headers }, recovery);
        sourceFailures = 0; // Successful lists count as well as successful files.
        return response;
      } catch (e) {
        if (isSourceFailure(e)) { sourceFailures++; e.code = 'NSE_SOURCE'; }
        throw e;
      }
    };
    try { return await attempt(false); }
    catch (e) {
      if (e.code !== 'NSE_SOURCE' || rewarmed || sourceFailures >= 3) throw e;
      rewarmed = true;
      run.recoveries.push({ url, reason: e.message });
      // Only the first source failure permits fresh bootstrap pages and one retry.
      try { await A.aufwaermen(jar, (u, config) => request(u, config, true)); }
      catch (warmError) {
        if (isSourceFailure(warmError)) { sourceFailures++; warmError.code = 'NSE_SOURCE'; }
        throw warmError;
      }
      return attempt(true);
    }
  };
  try {
    if (!offline && queue.length) await A.aufwaermen(jar, request);
    for (const ticker of queue) {
      if (!offline && ticker !== queue[0]) await (opts.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms))))(pause);
      const symbol = ticker.slice(0, -3);
      const url = `${N.BASIS}/api/integrated-filing-results?index=equities&symbol=${encodeURIComponent(symbol)}&size=200`;
      let complete = true;
      try {
        const raw = offline ? offline.read(offline.manifest.lists[symbol])
          : (await dataRequest(url)).body.toString('utf8');
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
              : (await dataRequest(filing.url)).body.toString('utf8');
            const observation = N.parseQuarter(xml, filing);
            N.appendQuarter(store, ticker, observation, { src: id, fetchedAt: now, updateDate: filing.availableAfter });
            run.read.push(ticker + ' ' + filing.periodEnd);
          } catch (e) {
            complete = false;
            if (['NSE_CAP', 'NSE_COOKIE', 'NSE_SOURCE'].includes(e.code) || isSourceFailure(e)) throw e;
            run.issues.push(`${ticker} ${filing.periodEnd}: ${e.message}`);
          }
        }
        if (complete) run.checked.push(ticker);
        run.attempted.push(ticker);
      } catch (e) {
        if (['NSE_CAP', 'NSE_COOKIE'].includes(e.code)) { run.pending.push(ticker + ': ' + e.message); break; }
        if (e.code === 'NSE_SOURCE' || isSourceFailure(e)) {
          run.pending.push(ticker + ': ' + e.message);
          run.issues.push(ticker + ': ' + e.message);
          if (sourceFailures >= 3) { run.issues.push('NSE antwortet dreimal in Folge nicht'); break; }
          continue;
        }
        run.attempted.push(ticker);
        run.issues.push(ticker + ': ' + e.message);
      }
    }
  } catch (e) {
    run.issues.push(e.message);
    if (queue.length) run.pending.push(queue[0] + ': ' + e.message);
  }
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
  const opts = {}, allowed = new Set(['offline', 'out', 'watchlist', 'as-of', 'cap', 'symbols', 'pause']);
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
