# Fixes for pull-yahoo.js

These fixes were identified by audit but cannot be applied directly to pull-yahoo.js
(handled by a separate agent). This file documents the required changes.

---

## F-DP-004: incomeStatementHistory schema drift / FTS override comparison flawed

In the override logic that compares FTS data vs incomeStatementHistory, prefer FTS when it is
non-empty regardless of array length comparison. Also handle the case where FTS returns data
for different fiscal years than incomeStatementHistory (compare by year tag, not by index).

Specifically:
- The current guard `if (ftsData.length >= ishData.length)` is wrong: if FTS has 3 years and
  ISH has 4 years, ISH wins even though FTS may be more accurate for those 3 years.
- Fix: prefer FTS whenever `ftsData.length > 0`. Do not fall back to ISH unless FTS is completely
  empty or all-null.
- For year-alignment: when merging FTS and ISH, match entries by fiscal year (e.g., `endDate`
  year) rather than by array index. This avoids misaligning revenue/opInc from different
  reporting periods when Yahoo returns ISH with one fewer entry.

---

## F-DP-013: yahoo-finance2 queue concurrency stacked with worker pool

The yahoo-finance2 library has its own internal queue with concurrency limit. If pull-yahoo.js
also uses p-limit(20), the actual effective concurrency is min(library_limit, 20). Check the
yahoo-finance2 configuration for queue size and document the effective throughput. Set library
queue concurrency to at least 20 to not be the bottleneck.

Recommended fix:
```js
const yf = require('yahoo-finance2').default;
yf.setGlobalConfig({ queue: { concurrency: 20, timeout: 30000 } });
```
Verify that `yahoo-finance2` exposes `setGlobalConfig` or equivalent in the installed version.
Document the resulting effective throughput (requests/sec) in a comment near the p-limit call.

---

## F-DP-014: rateLimitMs sleep is per-worker, not globally rate-limited

Each worker sleeps rateLimitMs after each request. With 20 workers, this means up to 20
requests can fire simultaneously when their sleep timers all expire. The effective rate is
20/(rateLimitMs/1000) = 20 req/s rather than the intended 1000ms between requests.

Consider implementing a global token bucket rate limiter instead of per-worker sleep.

Example token bucket implementation:
```js
class TokenBucket {
  constructor(ratePerSec) {
    this.tokens = ratePerSec;
    this.maxTokens = ratePerSec;
    this.refillRate = ratePerSec;
    this.lastRefill = Date.now();
  }
  async acquire() {
    while (true) {
      const now = Date.now();
      const elapsed = (now - this.lastRefill) / 1000;
      this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
      this.lastRefill = now;
      if (this.tokens >= 1) { this.tokens -= 1; return; }
      await new Promise(r => setTimeout(r, 100));
    }
  }
}
const bucket = new TokenBucket(parseInt(process.env.RATE_LIMIT_RPS || '5', 10));
// In each worker: await bucket.acquire(); before the Yahoo API call.
```

---

## F-DQ-010: Mcap-filter deletes snapshots silently (no graveyard)

When a ticker is filtered out by MIN_MCAP or delisted, the snapshot is deleted but not
archived. This creates survivor bias in method-effectiveness: any ticker that grew above $1B
is in the history, tickers that shrunk below and were deleted are not.

Fix: before deleting a snapshot for mcap or delisted reasons, move it to a graveyard directory
(e.g., `snapshots/_graveyard/TICKER.json`) with a `deletedAt` and `deleteReason` field.
This enables proper survivor-bias correction in backtest.

Example:
```js
function archiveToGraveyard(snapshotPath, ticker, reason) {
  const graveyardDir = path.join(SNAPSHOTS_DIR, '_graveyard');
  fs.mkdirSync(graveyardDir, { recursive: true });
  const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  snap._graveyard = { deletedAt: new Date().toISOString(), deleteReason: reason };
  fs.writeFileSync(path.join(graveyardDir, path.basename(snapshotPath)), JSON.stringify(snap, null, 2));
  fs.unlinkSync(snapshotPath);
}
// Call before any fs.unlinkSync on a snapshot: archiveToGraveyard(fp, ticker, 'below-min-mcap')
```

---

## F-DQ-012: No input digest for snapshots

Snapshots have no input fingerprint/digest. Can't distinguish a stale unchanged snapshot from
one that was freshly fetched.

Fix: when writing a snapshot, compute a SHA256 hash of the raw Yahoo API response and store it
as `meta.inputDigest`. Compare on next pull: if digest matches, mark `meta.fromCache = true`.
This enables detecting truly stale fundamentals vs unchanged data.

Example:
```js
const crypto = require('crypto');

function computeDigest(rawApiResponse) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(rawApiResponse))
    .digest('hex');
}

// When writing snapshot:
const digest = computeDigest(rawYahooData);
const prevSnap = loadExistingSnapshot(ticker);
const fromCache = prevSnap && prevSnap.meta && prevSnap.meta.inputDigest === digest;
snapshot.meta.inputDigest = digest;
snapshot.meta.fromCache = fromCache;
snapshot.meta.fetchedAt = new Date().toISOString();
```

---

## F-PF-010 — sortByStaleness does 12k+ syscalls (O(N log N) file reads during sort)

**Function:** `sortByStaleness` (around line 539)

**Problem:** The comparator calls `getAge(ticker)` for every comparison during `Array.sort`.
With N=12k stocks, sort makes ~160k+ comparisons, each opening/reading/closing a file. The fix
caches all ages in a Map with a single linear pre-pass so each file is read exactly once.

**Current code:**
```js
function sortByStaleness(stocks, outputDir) {
  return stocks.slice().sort((a, b) => {
    const getAge = (ticker) => {
      try {
        const fp = path.join(outputDir, safeSnapshotFilename(ticker));
        if (!fs.existsSync(fp)) return 0;
        const buf = Buffer.alloc(300);
        const fd = fs.openSync(fp, 'r');
        fs.readSync(fd, buf, 0, 300, 0);
        fs.closeSync(fd);
        const m = buf.toString('utf8').match(/"asOf"\s*:\s*"([^"]+)"/);
        return m ? new Date(m[1]).getTime() : 0;
      } catch { return 0; }
    };
    return getAge(a.ticker) - getAge(b.ticker);
  });
}
```

**Fixed code:**
```js
function sortByStaleness(stocks, outputDir) {
  // F-PF-010: cache ages before sorting so each file is read exactly once (O(N)),
  // not O(N log N) times as in the original comparator.
  const ageCache = new Map();
  const getAge = (ticker) => {
    if (ageCache.has(ticker)) return ageCache.get(ticker);
    let age = 0;
    try {
      const fp = path.join(outputDir, safeSnapshotFilename(ticker));
      if (fs.existsSync(fp)) {
        const buf = Buffer.alloc(300);
        const fd = fs.openSync(fp, 'r');
        fs.readSync(fd, buf, 0, 300, 0);
        fs.closeSync(fd);
        const m = buf.toString('utf8').match(/"asOf"\s*:\s*"([^"]+)"/);
        age = m ? new Date(m[1]).getTime() : 0;
      }
    } catch { age = 0; }
    ageCache.set(ticker, age);
    return age;
  };
  // Single linear pre-pass to populate the cache before sort begins
  for (const s of stocks) getAge(s.ticker);
  return stocks.slice().sort((a, b) => getAge(a.ticker) - getAge(b.ticker));
}
```

---

## F-PF-012 — fetchFundamentalsTS has 4 sequential awaits

**Function:** `fetchFundamentalsTS` (around line 408)

**Problem:** The four `yf.fundamentalsTimeSeries` calls are sequential (each `await` blocks the
next). They are independent HTTP requests and can all fire in parallel with `Promise.all`,
reducing wall-clock time by ~3/4 for this function.

**Current code:**
```js
async function fetchFundamentalsTS(symbol) {
  const period1 = new Date(Date.now() - 5 * 365 * 86400 * 1000);
  const period2 = new Date();
  const out = { annualFin: [], quarterlyFin: [], annualCash: [], annualBs: [] };
  try {
    out.annualFin = await yf.fundamentalsTimeSeries(symbol, { period1, period2, type: 'annual', module: 'financials' });
  } catch (e) { _log('WARN', `  fundamentalsTimeSeries annual financials failed for ${symbol}: ${e.message}`); }
  try {
    out.quarterlyFin = await yf.fundamentalsTimeSeries(symbol, { period1, period2, type: 'quarterly', module: 'financials' });
  } catch (e) { _log('WARN', `  fundamentalsTimeSeries quarterly financials failed for ${symbol}: ${e.message}`); }
  try {
    out.annualCash = await yf.fundamentalsTimeSeries(symbol, { period1, period2, type: 'annual', module: 'cash-flow' });
  } catch (e) { _log('WARN', `  fundamentalsTimeSeries annual cash-flow failed for ${symbol}: ${e.message}`); }
  try {
    out.annualBs = await yf.fundamentalsTimeSeries(symbol, { period1, period2, type: 'annual', module: 'balance-sheet' });
  } catch (e) { _log('WARN', `  fundamentalsTimeSeries annual balance-sheet failed for ${symbol}: ${e.message}`); }
  return out;
}
```

**Fixed code:**
```js
async function fetchFundamentalsTS(symbol) {
  // F-PF-012: all four requests are independent — fire in parallel with Promise.all.
  // Reduces wall-clock time by ~3/4 vs sequential awaits.
  const period1 = new Date(Date.now() - 5 * 365 * 86400 * 1000);
  const period2 = new Date();

  // safe() preserves the original per-call try/catch semantics: one failure doesn't
  // abort the others — they still complete and return their fallback value.
  const safe = (promise, label, fallback = []) =>
    promise.catch(e => {
      _log('WARN', `  fundamentalsTimeSeries ${label} failed for ${symbol}: ${e.message}`);
      return fallback;
    });

  const [annualFin, quarterlyFin, annualCash, annualBs] = await Promise.all([
    safe(yf.fundamentalsTimeSeries(symbol, { period1, period2, type: 'annual',    module: 'financials'    }), 'annual financials'),
    safe(yf.fundamentalsTimeSeries(symbol, { period1, period2, type: 'quarterly', module: 'financials'    }), 'quarterly financials'),
    safe(yf.fundamentalsTimeSeries(symbol, { period1, period2, type: 'annual',    module: 'cash-flow'     }), 'annual cash-flow'),
    safe(yf.fundamentalsTimeSeries(symbol, { period1, period2, type: 'annual',    module: 'balance-sheet' }), 'annual balance-sheet'),
  ]);

  return { annualFin, quarterlyFin, annualCash, annualBs };
}
```

---

## F-PF-014 — loadFx IIFE runs at require-time

**Location:** around line 98 (the `(function loadFx() { ... })();` IIFE)

**Problem:** The IIFE that loads `fx-rates.json` runs synchronously at module load time. If
pull-yahoo.js is ever `require()`-d from another script that doesn't need FX conversion, it
pays the I/O cost unconditionally.

**Fix (apply only if pull-yahoo.js is required as a module by other scripts):**

Convert the module-scope IIFE to a lazy getter:
```js
// REPLACE the IIFE and FX_TO_USD/FX_SOURCE module-level vars with:
let _fxRates = null;
let _fxSource = null;

function getFxRates() {
  if (_fxRates) return _fxRates;
  try {
    const fxPath = path.join(__dirname, 'fx-rates.json');
    if (!fs.existsSync(fxPath)) { _fxRates = FX_FALLBACK; _fxSource = 'fallback-hardcoded'; return _fxRates; }
    const raw = JSON.parse(fs.readFileSync(fxPath, 'utf8'));
    if (!raw || !raw.rates || typeof raw.rates !== 'object') { _fxRates = FX_FALLBACK; _fxSource = 'fallback-invalid'; return _fxRates; }
    const ageDays = raw.fetchedAt ? (Date.now() - new Date(raw.fetchedAt).getTime()) / 86400000 : Infinity;
    if (ageDays > FX_STALE_DAYS) {
      console.log('[FX] fx-rates.json is ' + ageDays.toFixed(1) + 'd old — using fallback');
      _fxRates = FX_FALLBACK; _fxSource = 'fallback-stale'; return _fxRates;
    }
    _fxRates = Object.assign({}, FX_FALLBACK, raw.rates);
    _fxSource = 'fx-rates.json @ ' + (raw.fetchedAt || 'unknown');
    console.log('[FX] Loaded ' + Object.keys(raw.rates).length + ' rates from fx-rates.json');
    return _fxRates;
  } catch (e) {
    console.log('[FX] fx-rates.json load failed: ' + e.message + ' — using fallback');
    _fxRates = FX_FALLBACK; _fxSource = 'fallback-error'; return _fxRates;
  }
}

// Replace all uses of FX_TO_USD with getFxRates()
// Replace all uses of FX_SOURCE with _fxSource (set after getFxRates() is called)
```

**Note:** If pull-yahoo.js is only ever run directly (never `require()`-d), this change has no
practical impact and can be skipped.
