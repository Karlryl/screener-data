'use strict';
/**
 * aufnahme-tor.js: intake gate for NEW watchlist rows (W7, 30.10.2026).
 * The foreign prefilter keeps a symbol Yahoo stays silent on, and the US sources run without any
 * quote check. Measured on 30.10.: 1,613 of 2,012 failed fetches were rows the 30-day prune removed
 * that same day; discovery would re-add them on the next run. This gate asks Yahoo once per new
 * candidate and refuses rows that cannot produce a snapshot or only carry a dead price.
 *
 * It only decides about candidates that are NOT yet on the watchlist, so no board row can vanish
 * through it, and it applies no size limit. A refused candidate is asked again on the next run.
 * A failed batch admits its rows (fail-open, same policy as prefilterByMcap, Bug 16).
 *
 * Measured on all 24,660 rows of 30.10.: quote() stayed silent on 330 rows that are no failed fetch,
 * none with a trade in the last 7 days once the pull's two symbol repairs are applied. Hence "silent"
 * is a usable refusal, but only after a second, smaller ask (41 of 2,357 misses were transient) and
 * under every symbol the pull would try (candidatesOf).
 */
const YahooFinance = require('yahoo-finance2').default;

const BATCH = 200;
const RETRY_BATCH = 50;
const MAX_QUOTE_AGE_DAYS = 30;
const DAY_MS = 86400000;

function tradeTime(q) {
  const t = q && q.regularMarketTime;
  const ms = t instanceof Date ? t.getTime() : Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}

// Pure verdict on one quote. Returns a refusal reason, or null to admit.
function urteilZurQuote(q, nowMs, maxAgeDays = MAX_QUOTE_AGE_DAYS) {
  if (!q) return 'keine-quote';
  if (q.quoteType && q.quoteType !== 'EQUITY') return 'kein-aktien-typ';
  const time = tradeTime(q);
  if (time !== null && nowMs - time > maxAgeDays * DAY_MS) return 'kurs-zu-alt';
  // No trade time at all: a price still proves a live line, no price does not.
  if (time === null && !Number.isFinite(q.regularMarketPrice)) return 'kein-kurs';
  // The pull scores nothing without a market cap and the foreign prefilter already drops such rows.
  // Measured on 30.10.: 860 live rows lack one (Xetra second lines, Hong Kong rights), none has a snapshot.
  if (!(q.marketCap > 0)) return 'ohne-marktwert';
  return null;
}

/**
 * @param {Array<{ticker: string}>} candidates new rows, not yet on the watchlist.
 * @param {(info: object) => string[]} candidatesOf Yahoo symbols of a candidate, main symbol first.
 *   Only the main symbol is asked in the first pass; the others join the retry of the misses.
 * @param {{quote?: Function, nowMs?: number}} [opts] quote is the test seam for yf.quote(batch).
 * @returns {Promise<{admitted: object[], rejected: Array<{ticker, quelle, grund, letzterKurs}>,
 *   befragt: number, batchFehler: number, ungeprueft: number}>}
 */
async function aufnahmeTor(candidates, candidatesOf, opts = {}) {
  const nowMs = opts.nowMs ?? Date.now();
  let yf = null;
  // validateResult off: one odd row otherwise fails its whole batch (1 of 124 batches on 30.10.);
  // only the four fields above are read and each is type-checked.
  const quoteFn = opts.quote || ((batch) => (yf || (yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] })))
    .quote(batch, {}, { validateResult: false }));
  const answers = new Map();
  const failedSymbols = new Set();
  let batchFehler = 0;
  const ask = async (symbols, size) => {
    for (let i = 0; i < symbols.length; i += size) {
      const batch = symbols.slice(i, i + size);
      try {
        const quotes = await quoteFn(batch);
        for (const s of batch) failedSymbols.delete(s);
        for (const q of (Array.isArray(quotes) ? quotes : [quotes])) if (q && q.symbol) answers.set(q.symbol, q);
      } catch (_) {
        batchFehler++;
        for (const s of batch) failedSymbols.add(s);
      }
    }
  };
  const symbolsOf = new Map(candidates.map((info) => [info, candidatesOf(info)]));
  await ask([...new Set(candidates.map((info) => symbolsOf.get(info)[0]))], BATCH);
  const misses = candidates.filter((info) => !answers.has(symbolsOf.get(info)[0]));
  await ask([...new Set(misses.flatMap((info) => symbolsOf.get(info)))], RETRY_BATCH);

  const admitted = [], rejected = [];
  let ungeprueft = 0;
  for (const info of candidates) {
    const symbols = symbolsOf.get(info);
    const found = symbols.map((s) => answers.get(s)).filter(Boolean);
    const verdicts = found.map((q) => urteilZurQuote(q, nowMs));
    if (verdicts.includes(null)) { admitted.push(info); continue; }
    // No live answer, and at least one symbol was never asked successfully: unknown, not refused.
    if (symbols.some((s) => failedSymbols.has(s) && !answers.has(s))) { ungeprueft++; admitted.push(info); continue; }
    const times = found.map(tradeTime).filter((t) => t !== null);
    rejected.push({ ticker: info.ticker, quelle: info.source || null, grund: verdicts[0] || 'keine-quote',
      letzterKurs: times.length ? new Date(Math.max(...times)).toISOString().slice(0, 10) : null });
  }
  return { admitted, rejected, befragt: candidates.length, batchFehler, ungeprueft };
}

// Protocol section for data-health/entdeckungs-ausschluss.json: every refused row by name.
function torProtokoll(result) {
  const jeGrund = {};
  for (const r of result.rejected) jeGrund[r.grund] = (jeGrund[r.grund] || 0) + 1;
  return {
    _doc: 'Tor 3: neue Kandidaten ohne lebende Yahoo-Quote kommen nicht auf die Watchlist. ' +
      'Keine Groessengrenze, kein Eingriff in den Bestand; abgelehnte Zeilen werden beim naechsten Lauf neu gefragt.',
    befragt: result.befragt,
    aufgenommen: result.admitted.length,
    ungeprueftWegenBatchFehler: result.ungeprueft,
    jeGrund,
    abgelehnt: result.rejected,
  };
}

module.exports = { aufnahmeTor, urteilZurQuote, torProtokoll, MAX_QUOTE_AGE_DAYS };
