'use strict';
const fs = require('fs');
let yf;
const YF = require('yahoo-finance2').default;
yf = (typeof YF === 'function') ? new YF() : YF;
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function main() {
  const wl = JSON.parse(fs.readFileSync('./watchlist.json', 'utf8'));
  let out = {};
  if (fs.existsSync('./prices/history.json')) {
    out = JSON.parse(fs.readFileSync('./prices/history.json', 'utf8'));
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
        // Write after each successful pull
        fs.writeFileSync('./prices/history.json', JSON.stringify(out, null, 2));
        console.log(`${quotes.length} days [saved]`);
      } else { console.log('no data'); }
    } catch (e) { console.log(`fail: ${e.message.slice(0,40)}`); }
    await sleep(500);
  }
  console.log(`Done range ${startIdx}-${endIdx}`);
}
main();
