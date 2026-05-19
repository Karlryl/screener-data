'use strict';
const fs = require('fs');
const path = require('path');
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
  const tmp = HISTORY_PATH + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2));
  fs.renameSync(tmp, HISTORY_PATH);
}

async function main() {
  const wl = JSON.parse(fs.readFileSync('./watchlist.json', 'utf8'));
  let out = {};
  if (fs.existsSync(HISTORY_PATH)) {
    try { out = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8')); }
    catch (e) {
      // F-SM-015 (Tag 233b): back up corrupt file before losing all history.
      console.error('history.json unparseable on load — backing up:', e.message);
      _backupCorrupt('load');
    }
  }
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
      const quotes = (r.quotes || []).filter(q => q.close != null).map(q => ({
        date: (q.date instanceof Date ? q.date.toISOString().slice(0,10) : String(q.date).slice(0,10)),
        close: q.close
      }));
      if (quotes.length > 5) {
        out[s.ticker] = quotes;
        _safeMergeAndWrite({ [s.ticker]: quotes });
        console.log(`${quotes.length} days [saved]`);
      } else { console.log('no data'); }
    } catch (e) { console.log(`fail: ${e.message.slice(0,40)}`); }
    await sleep(500);
  }
  console.log(`Done range ${startIdx}-${endIdx}`);
}
main();
