#!/usr/bin/env node
/**
 * Tag 39 — Historical-Price-Pull
 * Pullt für alle watchlist-Stocks die letzten 365 Tage Closing-Prices.
 * Output: prices/YYYY-MM-DD.json mit { ticker: { close, asOf } } (latest only)
 * Plus: prices-history.json (kumulativ) — ticker → array of {date, close}
 *
 * audit F-A-2026-06-21: conflicting price semantics (raw close vs adjusted close
 * under the same `close` key). CANONICAL CONTRACT for prices/history.json and the
 * per-day prices/<date>.json: the `close` field stores the ADJUSTED close
 * (split/dividend-adjusted, `adjclose ?? close`), standardized in Tag 148 and
 * consumed by walk-forward-perf.js (which reads `e.close` blindly). This is the
 * single source of truth — any OTHER writer of these files (the manual
 * scripts/backfill-prices.js) MUST write the same adjusted-close semantic, NOT
 * the raw close, or the series would silently mix raw and adjusted prices and
 * corrupt returns.
 * audit/fix: pull-prices-bulk.js — a third, orphaned writer that stored RAW
 * close — was retired in the hypergrowth cleanup, removing that mixed-basis hazard.
 *
 * Run: node pull-historical-prices.js [--watchlist watchlist.json] [--out prices/]
 */
'use strict';
const fs = require('fs');
const path = require('path');
// Tag 217g (audit F-217a-02 HIGH fix): atomic writes for prices history.
// pull-historical-prices.js writes prices/history.json which is the single
// source of truth for backtest scripts and the dashboard's price-momentum
// computation. A SIGTERM mid-write corrupts it; the existing recovery branch
// (lines 60-75) refuses to run without RESET_HISTORY=1, which destroys
// months of accumulated price history when triggered.
const { writeFileAtomic } = require('./lib/atomic-write.js');
// Tag 294 (P0 CI-Blocker fix): prices/history.json grew past GitHub's 100 MB
// push limit (run 29141088525 → "File prices/history.json is 132.74 MB") → merge
// push rejected → scoring skipped → boards froze. The history is now SHARDED into
// prices/history/history-NN.json via lib/price-history-store.js (single owner of
// the layout). We never write the old monolith again (Löschung braucht Karl-OK →
// it stays frozen on disk as the legacy-fallback source until shards exist).
const priceStore = require('./lib/price-history-store.js');
let yf;
try {
  const YF = require('yahoo-finance2').default;
  // Tag-39: yahoo-finance2 v3+ requires new instance
  // Tag 211m: silence schema-validation log spam (Tag 211c sibling fix).
  yf = (typeof YF === 'function')
    ? new YF({ validation: { logErrors: false, logOptionsErrors: false } })
    : YF;
}
catch (e) { console.error('yahoo-finance2 not installed'); process.exit(1); }

function _ts() { return new Date().toISOString(); }
function _log(level, msg) { console.log(`[${_ts()}] [${level}] ${msg}`); }

function parseArgs(argv) {
  const args = { watchlist: './watchlist.json', out: './prices', rateLimit: 1500, shard: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--watchlist' && argv[i+1]) args.watchlist = argv[++i];
    else if (argv[i] === '--out' && argv[i+1]) args.out = argv[++i];
    else if (argv[i] === '--rate-limit' && argv[i+1]) args.rateLimit = parseInt(argv[++i], 10);
    // 18.08.: --shard i/N teilt das Universum auf mehrere parallele CI-Laeufe auf.
    // OHNE dieses Flag verhaelt sich das Skript wie vorher — die Backfill-/Migrate-
    // Aufrufer bleiben unberuehrt.
    //
    // WARUM: der Schritt lief mit EINEM Runner ueber ~20.900 Ticker bei Nebenlaeufigkeit 8
    // und 1500 ms Stapelpause. Das sind allein an SCHLAFZEIT ~65 min gegen ein 25-min-
    // Timeout — selbst bei Netzzeit null waeren nur ~38 % der Ticker geschafft. Das
    // Timeout schlug JEDEN Tag zu und wurde von continue-on-error:true still geschluckt.
    // Beleg: der Tages-Snapshot prices/<datum>.json wird erst NACH der Schleife
    // geschrieben und ist deshalb nie in git angekommen (git ls-files prices/ zeigt nur
    // history/), und das failRatio-Gate am Skriptende hat nie gelaufen.
    //
    // WARUM NICHT einfach die Nebenlaeufigkeit hoch: Yahoos Cloudflare-Kante drosselt PRO
    // IP ab ~20 gleichzeitigen Anfragen — deshalb wurde die Nebenlaeufigkeit an Tag 215f
    // von 20 auf 8 gesenkt. Und selbst bei 20 blieben 1.044 Stapel x 1,5 s = 26,1 min
    // > 25 min: es loeste das Problem nicht einmal, wenn Yahoo mitspielte. Mehrere Runner
    // heissen mehrere IPs, jede unter der Drossel.
    else if (argv[i] === '--shard' && argv[i+1]) {
      const wert = argv[++i];
      const m = /^(\d+)\/(\d+)$/.exec(wert);
      // Fail-loud statt still ignorieren: ein vertipptes --shard wuerde sonst das GANZE
      // Universum auf JEDEM Runner ziehen — vierfache Yahoo-Last, und niemand merkt es,
      // weil das Ergebnis "vollstaendig" aussieht.
      if (!m) throw new Error(`--shard erwartet die Form i/N (z.B. 0/4), bekam: ${wert}`);
      const idx = parseInt(m[1], 10);
      const anzahl = parseInt(m[2], 10);
      if (!(anzahl >= 1) || !(idx >= 0) || idx >= anzahl) {
        throw new Error(`--shard ${wert} ist unmoeglich: erwartet 0 <= i < N und N >= 1`);
      }
      args.shard = { idx, anzahl };
    }
  }
  return args;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// BH-002 fix (audit): every date derivation in this file used a naive
// toISOString().slice(0,10) UTC slice on Yahoo's quote timestamp. For an
// exchange materially ahead of UTC (e.g. .AX at UTC+10/11) the bar's
// local-midnight instant falls on the PREVIOUS UTC calendar day, so the naive
// slice silently rolled the whole trading day back by one — Store-Beleg:
// JBH.AX stored Sunday-Thursday weeks instead of Monday-Friday. Shift the
// instant by the exchange's own meta.gmtoffset (seconds, Yahoo-supplied)
// before slicing so the stored date matches the exchange's own calendar day.
function exchangeLocalDate(d, gmtoffsetSeconds) {
  const dt = d instanceof Date ? d : new Date(d);
  const offsetMs = (typeof gmtoffsetSeconds === 'number' && isFinite(gmtoffsetSeconds)) ? gmtoffsetSeconds * 1000 : 0;
  return new Date(dt.getTime() + offsetMs).toISOString().slice(0, 10);
}

// BH-050 fix: reject non-session bars before they ever reach the merge (Yahoo
// occasionally returns a Sat/Sun row — holiday-adjacent glitch or the pre-fix
// weekend phantom-date, Tag 231a-3). Day-of-week convention (0=Sun,6=Sat)
// mirrors scripts/walk-forward-perf.js.
// ponytail: blanket Sat/Sun reject, not a full exchange trading calendar —
// safe today because no Sun-Thu market (e.g. .TA) is in the watchlist
// (verified against watchlist.json suffixes); add a real calendar if one ever is.
function isWeekendDate(dateStr) {
  const dow = new Date(dateStr + 'T00:00:00Z').getUTCDay();
  return dow === 0 || dow === 6;
}

// BH-052 fix: yf.chart() had no timeout — a hung request could stall a batch
// until the CI step's own ~25-min timeout. AbortSignal.timeout is native
// (Node >=17.3; package.json engines requires >=22) — no new dependency.
const FETCH_TIMEOUT_MS = 30000;

// BH-054 fix: PRICE_CONCURRENCY='0' is truthy as a string, so the old
// `parseInt(env || '10')` never fell back to the default — CONCURRENCY became
// 0 and the batch loop (`batchStart += CONCURRENCY`) never advanced, spinning
// on empty batches until the step timeout. Guard for a positive integer.
function parseConcurrency(envVal) {
  const n = parseInt(envVal, 10);
  return (Number.isFinite(n) && n > 0) ? n : 10;
}

// Shared fetch+merge core for both processOne() (per-ticker) and the dedicated
// benchmark back-fill below, and reused by scripts/backfill-prices.js — all
// three need the identical basis/session/positivity/window-merge contract, so
// one implementation means a fix here can't silently diverge between call
// sites (BH-001/002/049/050/051 all reproduced through this exact path, for
// tickers, benchmarks, and manual backfills alike).
// `chartFn` is injectable for hermetic tests (default: the real yf.chart call).
async function fetchAndMergeSeries(symbol, existingArr, chartFn) {
  const fetchChart = chartFn || ((...a) => yf.chart(...a));
  const period1 = new Date(Date.now() - 400 * 86400 * 1000);
  const period2 = new Date();
  const result = await fetchChart(symbol, { period1, period2, interval: '1d' },
    { fetchOptions: { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) } }); // BH-052
  const gmtoffset = result.meta && result.meta.gmtoffset;
  const rawQuotes = result.quotes || [];

  // BH-049 fix: enforce ONE price basis per series instead of the old per-bar
  // `adjclose ?? close` fallback (Tag 148 introduced adjusted-close as the
  // canonical basis; this closes the gap it left open). Store-Beleg: KLAC had
  // an event-day bar with NO adjclose sitting mid-series at ~10x its
  // split-adjusted neighbours — the per-bar fallback silently mixed a raw
  // close into an otherwise adjusted series. If adjclose exists anywhere in
  // the series, a bar missing it is REJECTED (not downgraded to raw close);
  // only a series with NO adjclose at all uses raw close throughout.
  const seriesHasAdjclose = rawQuotes.some(q => q.adjclose != null);
  const quotes = [];
  for (const q of rawQuotes) {
    if (seriesHasAdjclose && q.adjclose == null) continue; // mixed-basis bar — reject, don't fall back
    const v = seriesHasAdjclose ? q.adjclose : q.close;
    // Bug 11 (pre-existing): reject non-finite/<=0 closes (Yahoo adjclose-0
    // glitch; JSON.stringify would otherwise null a NaN and poison the store).
    if (v == null || !isFinite(v) || v <= 0) continue;
    const d = exchangeLocalDate(q.date, gmtoffset); // BH-002
    if (isWeekendDate(d)) continue; // BH-050
    quotes.push({ date: d, close: v });
  }
  if (!quotes.length) return null;

  // BH-001 fix: rebuild the fetch-covered window authoritatively from THIS
  // fetch. Previously the merge seeded the map with ALL stored dates
  // unconditionally (audit/fix A2 council+court 2026-06-26: "fetched-wins")
  // and only overwrote dates Yahoo re-sent — a bad row already in the store
  // (e.g. a pre-fix weekend phantom) survived forever because it was never
  // re-delivered. Now: a stored date inside the window this fetch covers
  // (>= the earliest date Yahoo just returned) is dropped unless Yahoo
  // re-confirms it; only the tail strictly BEFORE that window — outside this
  // fetch's coverage — is carried over (still re-validated, see BH-051 below).
  // quotes is date-ascending (Yahoo's own order, Tag 223c-documented
  // invariant), so quotes[0] is the earliest fetched date.
  const minFetched = quotes[0].date;
  const merged = new Map();
  for (const e of (existingArr || [])) {
    // BH-051 fix: validate the carried-over tail exactly like fresh bars — a
    // stored negative/zero close (Yahoo adjclose-0 glitch pre-dating the
    // Bug-11 guard) no longer survives just because it's outside this fetch's window.
    if (e.date < minFetched && isFinite(e.close) && e.close > 0) merged.set(e.date, e.close);
  }
  for (const q of quotes) merged.set(q.date, q.close); // fetched authoritatively rebuilds the covered window

  const arr = Array.from(merged, ([date, close]) => ({ date, close }));
  arr.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  if (arr.length > 400) arr.splice(0, arr.length - 400); // Tag 223c: in-place trim

  const latest = quotes[quotes.length - 1];
  return { arr, latestClose: latest.close, latestDate: latest.date, currency: result.meta && result.meta.currency };
}

// A7-fix (2026-07-10): Comparator fuer die stale-first-Pull-Reihenfolge. Benchmarks
// (added_via:'benchmark') immer zuerst (kritisch fuer alpha-vs-SPY), dann aeltester/
// fehlender history-Verlauf zuerst — so schiebt jeder timeout-begrenzte Lauf die stale
// Front vor, statt immer den Kopf neu zu pullen. Exportiert fuer den Unit-Test.
function staleFirstComparator(history) {
  const lastDateOf = (t) => { const a = history && history[t]; return (a && a.length) ? a[a.length - 1].date : ''; };
  return (x, y) => {
    const bx = x.added_via === 'benchmark' ? 0 : 1, by = y.added_via === 'benchmark' ? 0 : 1;
    if (bx !== by) return bx - by;                                    // Benchmarks immer zuerst
    return lastDateOf(x.ticker).localeCompare(lastDateOf(y.ticker));  // dann aeltester/fehlender Verlauf zuerst
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.out)) fs.mkdirSync(args.out, { recursive: true });
  const wl = JSON.parse(fs.readFileSync(args.watchlist, 'utf8'));
  // Tag 134 — Phase 3.3: ensure benchmark ETFs are always pulled so walk-forward-perf
  // can compute alpha vs SPY. Prepended to the watchlist (idempotent: skip if already present).
  const BENCHMARKS = [
    { ticker: 'SPY', yahoo_symbol: 'SPY', name: 'SPDR S&P 500 ETF', added_via: 'benchmark' },
    { ticker: 'QQQ', yahoo_symbol: 'QQQ', name: 'Invesco QQQ (Nasdaq-100)', added_via: 'benchmark' },
    { ticker: 'IWM', yahoo_symbol: 'IWM', name: 'iShares Russell 2000', added_via: 'benchmark' }
  ];
  // audit F-A-2026-06-21: duplicate benchmark row — dedupe case-insensitively so a
  // watchlist entry like 'spy' (lowercase) or a benchmark whose ticker differs only in
  // case can't slip past the exact-match guard and get processed twice under a divergent
  // ticker key. b.ticker is already upper-case in BENCHMARKS above.
  for (const b of BENCHMARKS) {
    if (!wl.stocks.some(s => (s.ticker || '').toUpperCase() === b.ticker)) wl.stocks.unshift(b);
  }
  // 18.08.: Shard-Filter. Geteilt wird entlang der STORE-Shards (shardOf, djb2%32), NICHT
  // entlang der Listenposition — damit besitzt jeder CI-Shard eine disjunkte Menge von
  // Store-Dateien (bei N=4 genau 8 der 32) und zwei Runner koennen dieselbe history-NN.json
  // nie gegenseitig ueberschreiben. Die Benchmarks laufen durch denselben Filter: SPY/QQQ/IWM
  // landen so bei genau einem Runner statt bei allen vieren.
  if (args.shard) {
    const { idx, anzahl } = args.shard;
    const vorherN = wl.stocks.length;
    wl.stocks = wl.stocks.filter(s => priceStore.shardOf(s.ticker) % anzahl === idx);
    _log('INFO', `Shard ${idx}/${anzahl}: ${wl.stocks.length} von ${vorherN} Tickern`);
    // Ein leerer Shard ist kein legitimer Zustand: bei ~20.900 Tickern und N <= 32 muesste
    // jeder Shard hunderte tragen. Leer heisst Filter oder Watchlist kaputt — laut abbrechen,
    // statt einen "erfolgreichen" Lauf ohne einen einzigen Kurs zu melden.
    if (wl.stocks.length === 0) throw new Error(`Shard ${idx}/${anzahl} ist leer — Filter oder Watchlist defekt`);
  }
  // audit/fix: honor the workflow's frozen RUN_DATE_UTC for the per-day snapshot
  // filename + pulledOn provenance, instead of a self-computed wall-clock UTC date.
  // The daily-pull workflow freezes RUN_DATE_UTC at job start so all date-stamped
  // artifacts agree even across a UTC-midnight crossing; this mirrors what
  // archive-old-snapshots.js already does. (History-array entry dates are NOT touched
  // here — those correctly use the real exchange latestQuoteDate.)
  const today = process.env.RUN_DATE_UTC || new Date().toISOString().slice(0, 10);

  // Load existing kumulative history wenn vorhanden.
  // F-SC-028 (Tag 180): a JSON.parse failure previously silently reset to {} and the
  // run then overwrote the (possibly recoverable) corrupt file with one day of
  // prices — destroying months of accumulated history. Now: back up the corrupt
  // file, log loudly, and refuse to continue unless RESET_HISTORY=1 is explicit.
  // Tag 294: load the merged history from shards (Legacy-Fallback: the very first
  // run — no shards yet — reads the frozen monolith prices/history.json read-only;
  // the migration/first pull then writes shards, and the monolith is ignored ever
  // after). Corrupt-Backup-Logik je Shard: loadAll throws with err.shardPath set
  // for the offending shard (or the legacy file), same fail-loud + RESET_HISTORY
  // guard as before, now scoped to the one bad file instead of the whole store.
  const histPath = path.join(args.out, 'history.json'); // legacy label (frozen)
  let history = {};
  try {
    history = priceStore.loadAll(args.out);
  } catch (e) {
    const bad = e.shardPath || histPath;
    // Review-Nachzug 2026-08-09: der leere catch hat behauptet, ein Backup liege vor,
    // auch wenn copyFileSync scheiterte (bad ist ein Verzeichnis, EACCES, volle Platte).
    // Genau dann ist die Meldung entscheidend — RESET_HISTORY=1 kippt danach den Altstand.
    let backup = bad + '.corrupt.' + Date.now();
    try {
      fs.copyFileSync(bad, backup);
    } catch (eBackup) {
      _log('ERROR', 'Backup von ' + bad + ' nach ' + backup + ' FEHLGESCHLAGEN: ' + eBackup.message);
      backup = null;
    }
    _log('ERROR', 'price history load failed for ' + bad + ' (' + e.message + '). '
      + (backup ? 'Backup saved to ' + backup : 'KEIN Backup vorhanden — Datei nur im Originalzustand.'));
    if (process.env.RESET_HISTORY !== '1') {
      _log('ERROR', 'Refusing to overwrite — set RESET_HISTORY=1 to start fresh.');
      process.exit(1);
    }
    _log('WARN', 'RESET_HISTORY=1 set — proceeding with empty history.');
    history = {};
  }
  // Tag 294: track which tickers changed this run so checkpoints only rewrite the
  // shards that actually moved (saveDirty) — write-amplification stays low.
  const dirty = new Set();

  const todaysSnapshot = {};
  let ok = 0, failed = 0;

  // A7-fix (2026-07-10): oldest-history-first ordering + timeout-checkpoint.
  // ROOT CAUSE (CI-verifiziert, run 28998189660): der Voll-Universum-Pull (~19k Ticker)
  // ueberschreitet den 25-min Step-Timeout (braucht ~59 min) -> der Prozess wird MITTEN
  // in der Batch-Schleife gekillt, BEVOR der einzige history.json-Schreibvorgang am
  // Schleifen-ENDE (writeFileAtomic(histPath) unten) je laeuft -> history.json wird NIE
  // geschrieben -> seit dem 16.06-Backfill eingefroren; continue-on-error maskierte es gruen.
  // FIX (Muster wie Tag-280 Fundamentals-Sharding: oldest/uncached-first + save-always):
  //  (a) stale Ticker zuerst pullen, damit jeder timeout-begrenzte Lauf die stale Front
  //      vorschiebt (sonst restartet die Schleife immer bei Index 0 und refresht nur den Kopf);
  //      Benchmarks (SPY/QQQ/IWM) bleiben ganz vorn (kritisch fuer alpha), dann aeltester Verlauf.
  //  (b) periodischer Checkpoint-Write unten, damit ein Timeout-Kill den Fortschritt persistiert.
  wl.stocks.sort(staleFirstComparator(history));
  const CHECKPOINT_EVERY_BATCHES = parseInt(process.env.PRICE_CHECKPOINT_BATCHES || '100', 10);

  // Tag-84: parallel pulls
  const CONCURRENCY = parseConcurrency(process.env.PRICE_CONCURRENCY); // BH-054
  _log('INFO', `Parallel price pulls: ${CONCURRENCY} concurrent`);
  async function processOne(stock) {
    try {
      _log('INFO', `Pulling ${stock.ticker}...`);
      if (!history[stock.ticker]) history[stock.ticker] = [];
      // fetchAndMergeSeries (see above) owns the fetch/basis/session/positivity/
      // window-merge contract — BH-001/002/049/050/051/052 all live there now.
      const merged = await fetchAndMergeSeries(stock.yahoo_symbol, history[stock.ticker]);
      if (!merged) { failed++; return; }
      // audit F-A-2026-06-21: per-day snapshot stamps the real exchange trading
      // date (merged.latestDate), never the calendar run date `today` — avoids
      // the Sat→Fri phantom-date mapping (Tag 231a-3). `pulledOn` keeps `today`
      // explicitly for provenance.
      todaysSnapshot[stock.ticker] = { close: merged.latestClose, asOf: merged.latestDate, pulledOn: today, currency: merged.currency };
      history[stock.ticker] = merged.arr;
      dirty.add(stock.ticker); // Tag 294: this ticker's shard needs rewriting
      ok++;
    } catch (e) {
      _log('WARN', `  ${stock.ticker} failed: ${e.message}`);
      failed++;
    }
  }
  for (let batchStart = 0; batchStart < wl.stocks.length; batchStart += CONCURRENCY) {
    const batch = wl.stocks.slice(batchStart, batchStart + CONCURRENCY);
    // BH-052: allSettled — processOne already catches internally and never
    // rejects, but Promise.all would still return early on an unexpected throw,
    // leaving that batch's other in-flight requests unawaited (silent concurrency
    // creep into the next batch). allSettled always waits for the whole batch.
    await Promise.allSettled(batch.map(s => processOne(s)));
    // A7-fix: Checkpoint history.json periodisch, damit ein 25-min-Timeout-Kill den bis
    // hierher gepullten Fortschritt PERSISTIERT (der End-Write unten wird unter Timeout nie
    // erreicht). Atomar (writeFileAtomic) -> ein Kill mitten im Write kann die gute Datei nie
    // korrumpieren; Teil-Universum-history ist valides JSON und genau das gewuenschte Substrat.
    const batchIdx = batchStart / CONCURRENCY;
    if (batchIdx > 0 && batchIdx % CHECKPOINT_EVERY_BATCHES === 0) {
      // Tag 294: checkpoint writes only the shards touched since the last one
      // (saveDirty), then clears `dirty` — a timeout-kill still persists progress
      // (each touched shard was written whole at some checkpoint) without
      // rewriting all 32 shards every 100 batches.
      const wrote = priceStore.saveDirty(args.out, history, dirty);
      dirty.clear();
      _log('INFO', `Checkpoint: ${wrote.length} shards persistiert nach ${batchStart + CONCURRENCY} Tickern (${ok} ok)`);
    }
    if (batchStart + CONCURRENCY < wl.stocks.length) {
      await sleep(args.rateLimit);
      if (batchStart % 100 === 0) _log('INFO', `Price pull progress: ${batchStart + CONCURRENCY}/${wl.stocks.length}`);
    }
  }


  // Tag 134 — Phase 3.3 (guarantee): always ensure each benchmark is in history,
  // even if the benchmark-injection above was a no-op (e.g. history.json pre-dates
  // that fix). Only pull a benchmark if it is missing from history OR missing from
  // today's snapshot.
  // audit F-A-2026-06-21: single-point benchmark → invalid alpha. The dedicated
  // back-fill was hardcoded to SPY only; QQQ and IWM (both listed in BENCHMARKS and
  // unshifted into the watchlist) flowed solely through processOne and — before the
  // per-ticker back-fill fix above — accumulated a 1-point series. alpha-vs-QQQ/IWM in
  // walk-forward was therefore computed against a single-day benchmark. Generalize the
  // guarantee loop over the whole BENCHMARKS array so every benchmark gets a full series.
  // 18.08.: im Shard-Modus nur die Benchmarks nachziehen, die diesem Runner gehoeren —
  // sonst zoegen alle Runner SPY/QQQ/IWM und schrieben in fremde Store-Shards.
  const eigeneBenchmarks = args.shard
    ? BENCHMARKS.filter(b => priceStore.shardOf(b.ticker) % args.shard.anzahl === args.shard.idx)
    : BENCHMARKS;
  for (const bench of eigeneBenchmarks) {
    const sym = bench.yahoo_symbol;
    const key = bench.ticker;
    if (history[key] && todaysSnapshot[key]) continue;
    try {
      _log('INFO', `${key} not in history — pulling dedicated ${key} benchmark...`);
      // Same fetchAndMergeSeries core as processOne (BH-001/002/049/050/051/052) —
      // a wrong-basis or phantom-date benchmark bar corrupts EVERY alpha
      // computation in walk-forward, so this path must never diverge from it.
      const merged = await fetchAndMergeSeries(sym, history[key]);
      if (merged) {
        todaysSnapshot[key] = { close: merged.latestClose, asOf: merged.latestDate, pulledOn: today, currency: merged.currency };
        history[key] = merged.arr;
        dirty.add(key); // Tag 294: benchmark shard needs rewriting
        ok++;
        _log('INFO', `${key} dedicated pull: ${history[key].length} history entries`);
      } else {
        _log('WARN', `${key} dedicated pull returned no quotes`);
      }
    } catch (e) {
      _log('WARN', `${key} dedicated pull failed: ${e.message}`);
    }
  }

  // 18.08.: im Shard-Modus schreibt jeder Runner seinen EIGENEN Tages-Ausschnitt;
  // scripts/merge-price-shards.js fuegt sie im merge-Job zu prices/<datum>.json zusammen.
  // Ohne --shard unveraendert.
  const snapshotDatei = args.shard ? `${today}.shard-${args.shard.idx}.json` : `${today}.json`;
  writeFileAtomic(path.join(args.out, snapshotDatei), JSON.stringify(todaysSnapshot, null, 2));
  // Tag 294: final write = saveAll (all 32 shards). Guarantees completeness even
  // for the migration/first run (every shard exists afterwards, so loadAll never
  // falls back to legacy again) — replaces the single writeFileAtomic(histPath)
  // that produced the >100 MB monolith. saveAll partitions in memory and writes
  // each shard atomically + compact; per-shard JSON.stringify stays far under the
  // V8 512 MB single-string limit that the old monolith flirted with.
  // 18.08.: im Shard-Modus NUR die eigenen Store-Dateien schreiben (saveDirty). saveAll
  // wuerde alle 32 schreiben — inklusive der 24, die diesem Runner nicht gehoeren und die
  // er nur im Ladezustand vom letzten Commit kennt. Beim Artefakt-Merge wuerde der letzte
  // Schreiber die frischen Daten der anderen Runner mit seinem Altstand ueberschreiben.
  // Genau deshalb darf hier NICHT einfach saveAll stehenbleiben.
  if (args.shard) {
    const geschrieben = priceStore.saveDirty(args.out, history, dirty);
    _log('INFO', `Shard ${args.shard.idx}: ${geschrieben.length} eigene Store-Dateien geschrieben`);
  } else {
    priceStore.saveAll(args.out, history);
  }
  _log('INFO', `Done: ${ok}/${wl.stocks.length} ok, ${failed} failed`);

  // 18.08.: Nachweis-Datei je Shard. Sie ist der WAECHTER-ANKER — fehlt sie im merge-Job,
  // ist dieser Runner in sein Timeout gelaufen oder abgestuerzt. Genau der Fall, der bisher
  // still blieb. Der Wert steht bewusst NICHT nur im Log: ein Log liest niemand, und
  // continue-on-error haette ihn ohnehin verschluckt.
  if (args.shard) {
    writeFileAtomic(
      path.join(args.out, `prices-shard-report-${args.shard.idx}.json`),
      JSON.stringify({ shard: args.shard.idx, anzahl: args.shard.anzahl, attempted: wl.stocks.length, ok, failed, datum: today }, null, 2),
    );
  }

  // BH-053 fix: previously only ok===0 failed the run — 1 success among
  // thousands of failures still exited 0, and saveAll's freshly-stamped
  // _meta.updatedAt (lib/price-history-store.js) then made a coverage
  // collapse look like a healthy, just-updated store to any consumer that
  // only checks store age. Gate on a fail-ratio instead of a bare zero-check,
  // mirroring pull-yahoo.js's already-blessed 75%-failure threshold (Tag 147)
  // rather than inventing a new one.
  const attempted = Math.max(1, wl.stocks.length);
  const failRatio = failed / attempted;
  if (failRatio > 0.75) {
    _log('ERROR', `Coverage collapse: ${(failRatio * 100).toFixed(1)}% failed (${failed}/${attempted}) — exceeds 75% threshold.`);
    process.exit(1);
  }
}

module.exports = { staleFirstComparator, exchangeLocalDate, isWeekendDate, fetchAndMergeSeries, parseConcurrency };

// A7-fix: nur als CLI ausfuehren; require (Unit-Test) darf main() NICHT starten.
if (require.main === module) {
  main().catch(e => { _log('FATAL', e.stack || e.message); process.exit(1); });
}
