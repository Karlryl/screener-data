'use strict';
/**
 * P280 (22.10.2026): archive before prune for external-data/sec-form4-cache.json.
 *
 * Evidence (P279 analysis, 21.10.2026): the 180-day window dropped expired Form-4 rows
 * WITHOUT any archive (G24: backtest raw data are never deleted) and only for tickers
 * that got a new filing that day (849 quiet tickers kept old rows forever, 3.0 MB).
 *
 * Contract, in this order:
 *   1. Every row that leaves the cache (expired by the window OR dropped by the writers,
 *      e.g. a 4/A purge or a full per-ticker re-pull) is appended to the monthly archive
 *      external-data/archive/sec-form4/<YYYY-MM>.json.gz (UTC month of the run).
 *   2. The archive is read back and every archived row is checked for equal JSON
 *      content (key order ignored, see canon). Only then are expired rows removed from the cache.
 *      Any failure throws: the cache is not written, nothing is lost, the run goes red.
 *   3. The 180-day cap applies to EVERY ticker, not only the ones touched that day.
 *
 * Archive format: concatenated gzip members (one per append), each member holds
 * newline-delimited JSON lines {archivedAt, reason, ticker, row}. `row` is the full,
 * uncompacted row. Append-only: the new file must start with the exact bytes of the
 * old file, written atomically (tmp + rename) so a crash cannot leave a torn member.
 *
 * Compact cache rows (package item 3): `owners` is dropped when it is exactly the
 * single owner [{name: reportingPersonName, relationship: reportingPersonRelationship}],
 * `issuerTradingSymbol` when it equals the byTicker key. Field `_c` lists what was
 * dropped ('o' owners, 's' symbol) so a row that never had the field stays without it.
 * expandRow() restores the exact row; compaction verifies the round trip per row.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { isDeepStrictEqual } = require('util');
const { writeFileAtomic } = require('./atomic-write.js');

const DAY_MS = 86400000;

/**
 * Same window rule as the writers: a row is kept while transactionDate (else
 * filingDate) is at most lookbackDays old; a row without a parsable date expires.
 * @param {object} row
 * @param {number} lookbackDays
 * @param {number} now epoch ms
 * @returns {boolean}
 */
function withinWindow(row, lookbackDays, now) {
  const s = row && (row.transactionDate || row.filingDate);
  if (!s) return false;
  const t = Date.parse(s);
  return Number.isFinite(t) && (now - t) <= lookbackDays * DAY_MS;
}

/**
 * Per-ticker copy of the row references currently held (what the last write persisted).
 * @param {object} byTicker
 * @returns {Map<string, object[]>}
 */
function snapshotRows(byTicker) {
  const m = new Map();
  for (const [ticker, e] of Object.entries(byTicker || {})) {
    if (e && Array.isArray(e.transactions)) m.set(ticker, e.transactions.slice());
  }
  return m;
}

/**
 * Archive file for the UTC month of `now`.
 * @param {string} archiveDir
 * @param {number} now epoch ms
 * @returns {string}
 */
function archiveFileFor(archiveDir, now) {
  return path.join(archiveDir, new Date(now).toISOString().slice(0, 7) + '.json.gz');
}

/**
 * Reads every line of one archive file (all gzip members). Missing file = [].
 * @param {string} file
 * @returns {object[]}
 */
function readArchive(file) {
  if (!fs.existsSync(file)) return [];
  const text = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8');
  return text.split('\n').filter(Boolean).map(l => JSON.parse(l));
}

/**
 * Key-order independent JSON (object keys sorted, recursively). A row loaded from disk
 * (expandRow appends owners and issuerTradingSymbol at the end) must equal the same row
 * freshly parsed (fields in the middle); plain JSON.stringify would archive unchanged
 * rows as 'dropped'.
 * @param {*} v
 * @returns {string}
 */
function canon(v) {
  return JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x))
    ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x);
}
const identity = (ticker, row) => ticker + '\u0000' + canon(row);

// Rows of the last persisted state that are no longer in the cache. Reference check
// first (cheap, untouched tickers), content check only where references vanished
// (a full per-ticker re-pull replaces rows with equal new objects).
function droppedRows(baseline, byTicker) {
  const out = [];
  for (const [ticker, before] of baseline) {
    const e = byTicker[ticker];
    const now = (e && Array.isArray(e.transactions)) ? e.transactions : [];
    const refs = new Set(now);
    const gone = before.filter(r => !refs.has(r));
    if (!gone.length) continue;
    const content = new Set(now.map(canon));
    for (const r of gone) if (!content.has(canon(r))) out.push({ ticker, row: r });
  }
  return out;
}

/**
 * Archive first, verify the restore, only then cap. Mutates byTicker (expired rows
 * removed) and returns the new baseline plus counts. Throws if the archive cannot be
 * written or read back complete; byTicker is then unchanged.
 * @param {{byTicker: object, baseline: Map<string, object[]>, archiveDir: string,
 *   lookbackDays: number, now: number}} opts
 * @returns {{baseline: Map<string, object[]>, expired: number, dropped: number,
 *   appended: number, file: string|null}}
 */
function archiveThenCap({ byTicker, baseline, archiveDir, lookbackDays, now }) {
  if (!archiveDir) throw new Error('form4 archive: archiveDir missing');
  if (!Number.isFinite(now)) throw new Error('form4 archive: now missing');
  const pending = droppedRows(baseline || new Map(), byTicker)
    .map(x => Object.assign(x, { reason: 'dropped' }));
  const keep = {};
  for (const [ticker, e] of Object.entries(byTicker)) {
    if (!e || !Array.isArray(e.transactions)) continue;
    keep[ticker] = [];
    for (const r of e.transactions) {
      if (withinWindow(r, lookbackDays, now)) keep[ticker].push(r);
      else pending.push({ ticker, row: r, reason: 'expired' });
    }
  }
  let file = null, appended = 0;
  if (pending.length) {
    file = archiveFileFor(archiveDir, now);
    const oldBytes = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0);
    const seen = new Set(readArchive(file).map(l => identity(l.ticker, l.row)));
    const at = new Date(now).toISOString();
    const lines = [];
    for (const p of pending) {
      const id = identity(p.ticker, p.row);
      if (seen.has(id)) continue;   // ponytail: dedupe within this month's file only
      seen.add(id);
      lines.push(JSON.stringify({ archivedAt: at, reason: p.reason, ticker: p.ticker, row: p.row }));
    }
    if (lines.length) {
      fs.mkdirSync(archiveDir, { recursive: true });
      const member = zlib.gzipSync(Buffer.from(lines.join('\n') + '\n', 'utf8'), { level: 9 });
      writeFileAtomic(file, Buffer.concat([oldBytes, member]));
      appended = lines.length;
    }
    // Restore check: append-only prefix and every pending row present with equal content.
    const back = fs.readFileSync(file);
    if (back.length < oldBytes.length || !back.subarray(0, oldBytes.length).equals(oldBytes)) {
      throw new Error('form4 archive: ' + file + ' is not an append of its previous bytes');
    }
    const restored = new Set(readArchive(file).map(l => identity(l.ticker, l.row)));
    const missing = pending.filter(p => !restored.has(identity(p.ticker, p.row)));
    if (missing.length) {
      throw new Error('form4 archive: ' + missing.length + ' row(s) not restorable from ' + file +
        ' - cache NOT pruned');
    }
  }
  for (const [ticker, rows] of Object.entries(keep)) byTicker[ticker].transactions = rows;
  const expired = pending.filter(p => p.reason === 'expired').length;
  return { baseline: snapshotRows(byTicker), expired, dropped: pending.length - expired, appended, file };
}

/**
 * Compact one row for the cache file (see header). Inverse: expandRow.
 * @param {object} row
 * @param {string} ticker byTicker key
 * @returns {object}
 */
function compactRow(row, ticker) {
  if (!row || typeof row !== 'object' || '_c' in row) return row;
  const c = Object.assign({}, row);
  let flags = '';
  if (Array.isArray(row.owners) && row.owners.length === 1 && isDeepStrictEqual(row.owners[0],
    { name: row.reportingPersonName, relationship: row.reportingPersonRelationship })) {
    delete c.owners; flags += 'o';
  }
  if (row.issuerTradingSymbol === ticker) { delete c.issuerTradingSymbol; flags += 's'; }
  if (!flags) return row;
  c._c = flags;
  return c;
}

// The relationship is a flat object of primitives in every real row; a spread copy is
// ~10x cheaper than structuredClone (which made each per-ticker checkpoint cost ~1 s
// on the 94k-row cache). Anything nested still goes through structuredClone.
const cloneFlat = (x) => (x && typeof x === 'object' && !Array.isArray(x) &&
  Object.values(x).every(v => v === null || typeof v !== 'object')) ? { ...x } : structuredClone(x);

/**
 * Restore a compacted row exactly.
 * @param {object} row
 * @param {string} ticker byTicker key
 * @returns {object}
 */
function expandRow(row, ticker) {
  if (!row || typeof row !== 'object' || typeof row._c !== 'string') return row;
  const r = Object.assign({}, row);
  delete r._c;
  if (row._c.includes('o')) {
    r.owners = [{ name: r.reportingPersonName, relationship: cloneFlat(r.reportingPersonRelationship) }];
  }
  if (row._c.includes('s')) r.issuerTradingSymbol = ticker;
  return r;
}

/**
 * Cache object -> compact JSON string. Every row must survive compact -> expand
 * unchanged; otherwise this throws and nothing is written.
 * @param {object} cache {updatedAt, ..., byTicker}
 * @returns {string}
 */
function serializeCache(cache) {
  const byTicker = {};
  for (const [ticker, e] of Object.entries(cache.byTicker || {})) {
    if (!e || !Array.isArray(e.transactions)) { byTicker[ticker] = e; continue; }
    byTicker[ticker] = Object.assign({}, e, {
      transactions: e.transactions.map(r => {
        const c = compactRow(r, ticker);
        if (!isDeepStrictEqual(expandRow(c, ticker), r)) {
          throw new Error('form4 cache: compact round trip differs for ' + ticker + ' ' +
            (r && r.accessionNumber));
        }
        return c;
      })
    });
  }
  return JSON.stringify(Object.assign({}, cache, { byTicker }));
}

/**
 * Expand all rows of a loaded cache in place and return it.
 * @param {object} cache
 * @returns {object}
 */
function expandCache(cache) {
  for (const [ticker, e] of Object.entries((cache && cache.byTicker) || {})) {
    if (e && Array.isArray(e.transactions)) e.transactions = e.transactions.map(r => expandRow(r, ticker));
  }
  return cache;
}

module.exports = {
  withinWindow, snapshotRows, archiveFileFor, readArchive, archiveThenCap,
  compactRow, expandRow, serializeCache, expandCache, canon
};
