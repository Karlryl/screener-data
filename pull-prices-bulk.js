'use strict';
const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('./lib/atomic-write.js');
let yf;
const YF = require('yahoo-finance2').default;
yf = (typeof YF === 'function') ? new YF() : YF;
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const HISTORY_PATH = './prices/history.json';

// F-GC-003 (Tag 179): two concurrent CLI invocations would each load the file,
// modify their slice, and write — overwriting each other. Now we re-read the
// current file under a tmp+rename merge each save so concurrent writers only
// add, never destroy each other's progress. Last-writer-wins on per-ticker
// duplicates is acceptable since each CLI is a disjoint ticker range.
function _backupCorrupt(label) {
  const bakPath = HISTORY_PATH + '.bak.' + new Date().toISOString().slice(0, 10);
  try { fs.renameSync(HISTORY_PATH, bakPath); console.error('  Corrupt file renamed to', bakPath); }
  catch (be) { console.error('  Could not rename corrupt file:', be.message); }
}

function _safeMergeAndWrite(myUpdates) {
  let onDisk = {};
  if (fs.existsSync(HISTORY_PATH)) {
    try { onDisk = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8')); }
    catch (e) {
      // F-SM-015 (Tag 233b): back up corrupt file so historical price data isn't silently lost.
      // Previous behaviour just logged a warning and continued with {} — each subsequent write
      // overwrote the merge base, permanently discarding all existing price history.
      console.error('history.json corrupt in merge — backing up before starting fresh:', e.message);
      _backupCorrupt('merge');
      onDisk = {};
    }
  }
  const merged = Object.assign({}, onDisk, myUpdates);
  writeFileAtomic(HISTORY_PATH, JSON.stringify(merged, null, 2));
}

async function main() {
  const wl = JSON.parse(fs.readFileSync('./watchlist.json', 'utf8'));
  // audit F-A-2026-06-21: removed the dead in-memory `out` accumulator and its
  // load block — `out` was assigned but never persisted (only _safeMergeAndWrite
  // writes to disk), so loading the full history here just wasted I/O and risked
  // a misleading impression that `out` was the source of truth.
  const startIdx = parseInt(process.argv[2] || '0', 10);
  const endIdx = Math.min(startIdx + 25, wl.stocks.length);
  console.log(`Processing stocks ${startIdx}..${endIdx} of ${wl.stocks.length}`);
  for (let i = startIdx; i < endIdx; i++) {
    const s = wl.stocks[i];
    process.stdout.write(`[${i+1}] ${s.ticker}... `);
    try {
      const period1 = new Date(Date.now() - 100 * 86400 * 1000);
      const period2 = new Date();
      const r = await yf.chart(s.yahoo_symbol, { period1, period2, interval: '1d' });
      // audit F-A-2026-06-21: prevents silent data-integrity corruption from two
      // pullers writing CONFLICTING price semantics under the same `close` key into
      // the same prices/history.json. This bulk puller previously stored the RAW
      // close (q.close), while the workflow entrypoint pull-historical-prices.js
      // (Tag 148) and the downstream consumer walk-forward-perf.js both treat the
      // `close` field as the dividend/split-ADJUSTED close (q.adjclose ?? q.close).
      // Mixing raw and adjusted closes for the same ticker silently distorts return
      // calculations. Align with the entrypoint: store adjusted close, kept under
      // the `close` key for backward compat with existing history.json + consumers.
      const quotes = (r.quotes || []).filter(q => (q.adjclose ?? q.close) != null).map(q => ({
        date: (q.date instanceof Date ? q.date.toISOString().slice(0,10) : String(q.date).slice(0,10)),
        // bug-fix (audit 2026-06-21): store the split/dividend-ADJUSTED close to match
        // pull-historical-prices.js — both write the shared prices/history.json, so raw close here
        // injected a phantom jump across splits for bulk-touched tickers.
        close: (q.adjclose ?? q.close)
      }));
      if (quotes.length > 5) {
        // audit F-A-2026-06-21: dropped the dead `out[s.ticker] = quotes;` write —
        // it fed an accumulator that was never flushed to disk. Persistence is solely
        // via _safeMergeAndWrite, which re-reads + merges on disk to stay concurrency-safe.
        _safeMergeAndWrite({ [s.ticker]: quotes });
        console.log(`${quotes.length} days [saved]`);
      } else { console.log('no data'); }
    } catch (e) { console.log(`fail: ${e.message.slice(0,40)}`); }
    await sleep(500);
  }
  console.log(`Done range ${startIdx}-${endIdx}`);
}

// audit F-A-2026-06-21: guard against (1) silent failure — main() previously had no
// .catch(), so a rejected promise died with exit code 0 and CI/cron treated a failed
// pull as success; now it logs and exits non-zero. And (2) auto-run-on-require — without
// the require.main check this module kicked off a live Yahoo pull whenever it was merely
// require()'d (e.g. by a test or another script).
if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { main, _safeMergeAndWrite };
