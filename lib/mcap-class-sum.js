'use strict';
// P1 (Codex, 04.11.2026): a firm with two or more listed share classes (A and H, A and B) was shown with
// Yahoo's value of one line, which prices every share of every class at that line's price (3.9 to 25.1 %
// too high on 31.10.), or with a hand-table row that froze the price ratio of 30.10. into "H equivalents".
// The class sum values each class with its own issuer-verified share count and its own unadjusted close of ONE
// common, finished trading day, converted with the FX close of that same day, and writes that one firm value into
// the line the scoring's listing choice shows. It runs in the merge job on the merged snapshot generation, before
// the snapshots artifact goes to scoring and exports. Closes come from Yahoo's daily chart fetched here: the price
// store keeps adjusted closes for return history (pull-historical-prices.js) and is not a market-cap price.
const fs = require('node:fs');
const path = require('node:path');
const { DERIVED_FIELDS } = require('./ads-hand-table.js');
const { holds } = require('./market-cap-guard.js');
const { safeSnapshotFilename } = require('./snapshot-fs.js');
const { writeJsonAtomic } = require('./atomic-write.js');

const SOURCE = 'class-sum';
const HOLD = 'hand-table:market-cap-hold';
// ponytail: fixed lag; a common close older than this (long suspension of one class) empties the value instead.
const MAX_CLOSE_AGE_DAYS = 10;
const CHART_DAYS = 25;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const positive = (n) => Number.isFinite(n) && n > 0;
const ageDays = (from, to) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 864e5);
const de = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
const mio = (n) => (n / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 1 });
const localDate = (t, gmtoffset) => new Date(new Date(t).getTime() + (Number.isFinite(gmtoffset) ? gmtoffset * 1000 : 0)).toISOString().slice(0, 10);
// Exchange-local day in the exchange's own time zone: the chart's gmtoffset is today's offset, so bars from before a daylight
// saving change (FX bars stamped 23:00 UTC in London summer time) would land on the previous day with it.
const zoneDate = (t, zone, gmtoffset) => {
  if (zone) { try { return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t)); } catch { /* unknown zone: offset below */ } }
  return localDate(t, gmtoffset);
};
/** Yahoo symbol of the FX pair that prices one unit of a currency in USD (as scripts/refresh-fx.js).
 * @param {string} currency Three-letter code.
 * @returns {string} Symbol such as HKDUSD=X.
 */
const fxSymbol = (currency) => currency + 'USD=X';

const CONFIG = path.join(__dirname, '..', 'configs', 'mcap-class-sum.json');

/**
 * Loads the issuers whose market cap is the class sum; a malformed entry throws with its name.
 * @param {string} [file] Config path (default configs/mcap-class-sum.json).
 * @returns {object[]} Entries {name, issuer, classes:[{ticker, class, shares, currency, asOf, source}], verifiedAt, reviewBy}.
 */
function loadClassSumEntries(file = CONFIG) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = [], seen = new Set();
  for (const [name, e] of Object.entries(raw)) {
    if (name.startsWith('_')) continue;
    const bad = (why) => { throw new Error(`${file}: ${name}: ${why}`); };
    if (!e || typeof e !== 'object' || !e.issuer) bad('issuer missing');
    for (const k of ['verifiedAt', 'reviewBy']) if (!DAY.test(e[k] || '')) bad(`${k} must be YYYY-MM-DD`);
    if (!Array.isArray(e.classes) || e.classes.length < 2) bad('at least two listed classes');
    for (const l of e.classes) {
      if (!l || !/^[A-Z0-9][A-Z0-9./-]*$/.test(l.ticker || '') || !l.class || !Number.isSafeInteger(l.shares) || l.shares <= 0) bad('class needs ticker, class and a positive integer share count');
      if (!/^[A-Z]{3}$/.test(l.currency || '')) bad(`${l.ticker}: currency must be a three-letter code`);
      if (!DAY.test(l.asOf || '') || l.asOf > e.verifiedAt) bad(`${l.ticker}: asOf must be a day not after verifiedAt`);
      if (!/^https?:\/\//.test(l.source?.url || '') || !l.source.quote) bad(`${l.ticker}: source needs url and quote`);
      if (seen.has(l.ticker)) bad(`ticker ${l.ticker} twice`);
      seen.add(l.ticker);
    }
    if (e.shownLine !== undefined && (!e.classes.some((l) => l.ticker === e.shownLine) || !e.shownLineReason)) bad('shownLine must be one of the classes and carry shownLineReason');
    out.push({ name, ...e });
  }
  if (!out.length) throw new Error(`${file}: no issuer`);
  return out;
}

/**
 * Unadjusted closes of finished sessions from one Yahoo daily chart. A bar counts only when its exchange-local day lies
 * before the session Yahoo reports as current, or is that session and the fetch came after its end.
 * @param {object} result yahoo-finance2 chart() result.
 * @param {Date|string|number} now Fetch time.
 * @returns {{currency: string|null, closes: Array<{date: string, close: number}>}} Finished closes, ascending.
 */
function finishedCloses(result, now) {
  const meta = result?.meta || {}, regular = meta.currentTradingPeriod?.regular;
  const gmt = Number.isFinite(meta.gmtoffset) ? meta.gmtoffset : 0;
  const nowMs = new Date(now).getTime();
  const zone = typeof meta.exchangeTimezoneName === 'string' ? meta.exchangeTimezoneName : null;
  const session = regular?.start ? zoneDate(regular.start, zone, regular.gmtoffset ?? gmt) : zoneDate(nowMs, zone, gmt);
  const sessionDone = regular?.end ? nowMs >= new Date(regular.end).getTime() : false;
  const closes = [];
  for (const q of result?.quotes || []) {
    const d = zoneDate(q.date, zone, gmt), wd = new Date(d + 'T00:00:00Z').getUTCDay();
    if (!positive(q.close) || wd === 0 || wd === 6 || d > session || (d === session && !sessionDone)) continue;
    if (closes.length && closes[closes.length - 1].date === d) closes.pop();
    closes.push({ date: d, close: q.close });
  }
  return { currency: typeof meta.currency === 'string' ? meta.currency : null, closes };
}

/**
 * Fetches the finished daily closes of every class line and of the FX pair of every class currency.
 * @param {object[]} entries Class-sum entries.
 * @param {{chart: Function, now: Date|string|number, attempts?: number, pauseMs?: number, budgetMs?: number, clock?: Function, sleep?: Function}} opts chart(symbol, query) like yahoo-finance2; two attempts with a pause, one time budget for all calls.
 * @returns {Promise<Object<string, {currency: string|null, closes: object[], error: string|null}>>} Market data by symbol.
 */
async function fetchMarket(entries, { chart, now, attempts = 2, pauseMs = 2000, budgetMs = 5 * 60e3, clock = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const symbols = [...new Set(entries.flatMap((e) => e.classes.flatMap((l) => (l.currency === 'USD' ? [l.ticker] : [l.ticker, fxSymbol(l.currency)]))))];
  const nowMs = new Date(now).getTime(), market = {}, start = clock();
  for (const symbol of symbols) {
    let error = null;
    // ponytail: one budget for the whole step (about 50 calls), so a slow vendor cannot eat the merge job's time limit.
    if (clock() - start > budgetMs) { market[symbol] = { currency: null, closes: [], error: 'Zeitbudget des Schritts aufgebraucht' }; continue; }
    for (let i = 0; i < attempts; i++) {
      if (i > 0 && clock() - start > budgetMs) { error += '; Zeitbudget des Schritts aufgebraucht, kein zweiter Versuch'; break; } // Codex P3: no retry past the budget
      if (i > 0) await sleep(pauseMs);
      try {
        const r = await chart(symbol, { period1: new Date(nowMs - CHART_DAYS * 864e5), period2: new Date(nowMs), interval: '1d' });
        market[symbol] = { ...finishedCloses(r, nowMs), error: null };
        error = null;
        break;
      } catch (e) { error = 'Fehler beim Anbieter: ' + String(e?.message || e).slice(0, 120); }
    }
    if (error) market[symbol] = { currency: null, closes: [], error };
  }
  return market;
}

/**
 * Class sum of one issuer on the newest finished trading day on which every class has a close, with the FX close of that day.
 * @param {object} entry Class-sum config entry.
 * @param {Object<string, object>} market fetchMarket result.
 * @param {Object<string, string|null>} snapshotCurrencies Trading currency per class from its snapshot, a cross-check only (missing is fine).
 * @param {string} dataDay Run date YYYY-MM-DD; closes after it are ignored.
 * @returns {{value: number|null, date: string|null, legs: object[], reason: string|null}} Firm value in USD or the reason it is empty.
 */
function computeClassSum(entry, market, snapshotCurrencies, dataDay) {
  const problems = [];
  const series = entry.classes.map(({ ticker, currency }) => {
    const m = market[ticker];
    if (!m || m.error) { problems.push(`${ticker}: Tageskurse nicht abrufbar${m?.error ? ' (' + m.error + ')' : ''}`); return new Map(); }
    if (m.currency !== currency) problems.push(`${ticker}: Kursreihe in ${m.currency || 'unbekannter Währung'} statt ${currency}`);
    if (snapshotCurrencies[ticker] && snapshotCurrencies[ticker] !== currency) problems.push(`${ticker}: Snapshot nennt ${snapshotCurrencies[ticker]} statt ${currency}`);
    const s = new Map(m.closes.filter((p) => DAY.test(p.date) && p.date <= dataDay && positive(p.close)).map((p) => [p.date, p.close]));
    if (!s.size) problems.push(`${ticker}: kein abgeschlossener Handelstag mit Schlusskurs`);
    return s;
  });
  // FX of the same day: a day counts only when every class currency also has a finished FX close on it (on a weekday run
  // the Asian sessions of today are done, the FX day is not, so the sum takes the day before).
  const fxSeries = Object.fromEntries([...new Set(entry.classes.map((l) => l.currency))].filter((c) => c !== 'USD').map((c) => {
    const f = market[fxSymbol(c)];
    if (!f || f.error || f.currency !== 'USD') { problems.push(`kein Devisenkurs ${c} in USD abrufbar${f?.error ? ' (' + f.error + ')' : ''}`); return [c, new Map()]; }
    return [c, new Map(f.closes.filter((p) => positive(p.close)).map((p) => [p.date, p.close]))];
  }));
  const classDays = problems.length ? [] : [...series[0].keys()].filter((d) => series.every((x) => x.has(d))).sort();
  const common = classDays.filter((d) => Object.values(fxSeries).every((x) => x.has(d)));
  const date = common.length ? common[common.length - 1] : null;
  if (!problems.length && !classDays.length) problems.push('kein gemeinsamer abgeschlossener Handelstag aller Klassen');
  else if (!problems.length && !date) problems.push(`kein Devisenkurs zum letzten gemeinsamen Handelstag ${de(classDays[classDays.length - 1])}`);
  if (date && ageDays(date, dataDay) > MAX_CLOSE_AGE_DAYS) problems.push(`letzter gemeinsamer Handelstag ${de(date)} liegt mehr als ${MAX_CLOSE_AGE_DAYS} Tage zurück`);
  const legs = entry.classes.map((l, i) => {
    const usdPerUnit = l.currency === 'USD' ? 1 : date ? fxSeries[l.currency]?.get(date) ?? null : null;
    const close = date ? series[i].get(date) ?? null : null;
    return { ticker: l.ticker, class: l.class, shares: l.shares, sharesAsOf: l.asOf, sharesSource: l.source, close, currency: l.currency,
      usdPerUnit, fxSymbol: l.currency === 'USD' ? null : fxSymbol(l.currency),
      valueUsd: positive(close) && usdPerUnit !== null ? l.shares * close * usdPerUnit : null };
  });
  const uniqueProblems = [...new Set(problems)];
  const value = legs.reduce((sum, l) => sum + (l.valueUsd ?? 0), 0);
  if (!uniqueProblems.length && !positive(value)) uniqueProblems.push('Klassensumme nicht positiv');
  return { value: uniqueProblems.length ? null : value, date, legs, reason: uniqueProblems.length ? uniqueProblems.join('; ') : null };
}

/** Earliest and latest share-count day of an entry. @param {object} entry Class-sum entry. @returns {string[]} [first, last]. */
const asOfRange = (entry) => { const d = entry.classes.map((l) => l.asOf).sort(); return [d[0], d[d.length - 1]]; };

/** German hint for the board: what the value is and from which day and counts.
 * @param {object} entry Class-sum config entry.
 * @param {object} result computeClassSum result.
 * @returns {string} Sentence for meta.marketCapReason.
 */
function reasonText(entry, result) {
  if (result.value === null) return `Börsenwert nicht verlässlich: Die Summe der Aktienklassen (${entry.classes.map((l) => l.class).join(', ')}) ist heute nicht berechenbar (${result.reason}).`;
  const parts = result.legs.map((l) => `${mio(l.shares)} Mio. ${l.class}-Aktien zu ${l.close.toLocaleString('de-DE', { maximumFractionDigits: 3 })} ${l.currency}`);
  const [first, last] = asOfRange(entry);
  return `Börsenwert als Summe der Aktienklassen, jede zu ihrem eigenen Schlusskurs vom ${de(result.date)} und zum Devisenkurs desselben Tages: ` +
    `${parts.join(' plus ')} (Aktienzahlen ohne eigene Aktien laut Firma vom ${de(first)}${last > first ? ' bis ' + de(last) : ''}).`;
}

const priorValue = (s) => s.marketCap?.source === SOURCE ? s.marketCap.yahooValue ?? null : s.marketCap?.value ?? null;
function stamp(snap, value, reason, result, fetchedAt, shownAt = null) {
  const prev = snap.marketCap || {};
  snap.marketCap = { ...prev, value, source: SOURCE, yahooValue: priorValue(snap),
    classSum: { date: result.date, fetchedAt, legs: result.legs, reason: result.reason, ...(shownAt ? { shownAt } : {}) } };
  if (value === null) snap.marketCap.missing = true; else delete snap.marketCap.missing;
  delete snap.marketCap.vendorImpliedShares;
  snap.meta.marketCapReason = reason;
  delete snap.meta._shareCountHandTableStale;
  if (snap.metrics) for (const f of DERIVED_FIELDS) if (snap.metrics[f] != null) snap.metrics[f] = null;
}

/**
 * Puts one firm's class sum into its class snapshots, in place, without changing which line the board shows.
 * The sum goes into the line the scoring's own listing choice (issuerDedupComparator) picks on the pull's values, or the
 * entry's shownLine where the config names one (the line shown before the class sum, CNOOC); every
 * other unheld line is emptied with a reason naming that line, so no line with a one-price value can take the board on a
 * day the scoring excludes the line with the sum. Without a sum every unheld line is emptied with the reason. The shown
 * line takes the earliest first trading day of the emptied lines (the firm's debut, which the scoring otherwise reads from
 * the group of lines). Held lines and missing snapshots are left alone.
 * @param {Object<string, object|null>} snaps Class snapshots by ticker.
 * @param {object} entry Class-sum config entry.
 * @param {object} result computeClassSum result.
 * @param {string|null} fetchedAt Fetch time of the closes.
 * @returns {{shown: string|null, written: string[]}} The line that carries the sum and every changed ticker.
 */
function writeFirm(snaps, entry, result, fetchedAt) {
  const { issuerDedupComparator } = require('../src/scoring/score.js');
  const open = Object.values(snaps).filter((s) => s?.meta?.ticker && !holds[s.meta.ticker] && s.marketCap?.source !== HOLD);
  const priced = open.filter((s) => positive(priorValue(s)))
    .map((s) => ({ ticker: s.meta.ticker, s, snapshot: { ...s, marketCap: { ...s.marketCap, value: priorValue(s) } } }))
    .sort(issuerDedupComparator);
  // shownLine: the line the board showed before the class sum, kept where the removed share-count row had decided it (CNOOC).
  // ponytail: no line with a pull value at all -> every unheld line carries the sum and the ticker order decides.
  const pinned = entry.shownLine && open.find((s) => s.meta.ticker === entry.shownLine);
  const targets = pinned ? [pinned] : priced.length ? [priced[0].s] : open;
  const text = reasonText(entry, result), written = [];
  for (const s of open) {
    if (targets.includes(s) || result.value === null) stamp(s, result.value, text, result, fetchedAt);
    else stamp(s, null, `Börsenwert nicht verlässlich: Der Börsenwert der Firma steht an der Zeile ${targets[0].meta.ticker}. ${text}`, result, fetchedAt, targets[0].meta.ticker);
    written.push(s.meta.ticker);
  }
  if (targets.length === 1) {
    const shown = targets[0].meta, debut = open.map((s) => s.meta.firstTradeDate).filter((d) => typeof d === 'string' && d.length >= 10).sort()[0];
    if (debut && (!shown.firstTradeDate || debut < shown.firstTradeDate)) {
      shown.firstTradeDateOwn ??= shown.firstTradeDate ?? null;
      shown.firstTradeDate = debut;
      if (Number.isFinite(shown.ipoYear) && Number(debut.slice(0, 4)) < shown.ipoYear) { shown.ipoYearOwn ??= shown.ipoYear; shown.ipoYear = Number(debut.slice(0, 4)); }
    }
  }
  return { shown: result.value === null ? null : targets.length === 1 ? targets[0].meta.ticker : null, written };
}

/**
 * Writes the class sum into the snapshots of one merged generation, in place on disk.
 * Held lines keep their hold; a missing class snapshot only means that line gets no value (the sum needs only the closes).
 * @param {{snapshotsDir: string, dataDay: string, chart: Function, now?: Date|string|number, configFile?: string, log?: Function}} opts Paths, run date, chart fetcher.
 * @returns {Promise<object[]>} One line per issuer: name, value or reason, shown and written tickers.
 */
async function applyClassSums({ snapshotsDir, dataDay, chart, now = Date.now(), configFile, log = console.log }) {
  if (!DAY.test(dataDay || '')) throw new Error('applyClassSums: dataDay must be YYYY-MM-DD');
  if (typeof chart !== 'function') throw new Error('applyClassSums: chart fetcher missing');
  const entries = loadClassSumEntries(configFile);
  const market = await fetchMarket(entries, { chart, now });
  const fetchedAt = new Date(now).toISOString();
  const file = (t) => path.join(snapshotsDir, safeSnapshotFilename(t));
  const report = [];
  for (const entry of entries) {
    const snaps = Object.fromEntries(entry.classes.map(({ ticker }) => {
      try { return [ticker, JSON.parse(fs.readFileSync(file(ticker), 'utf8'))]; } catch (e) { if (e.code === 'ENOENT') return [ticker, null]; throw e; }
    }));
    const currencies = Object.fromEntries(Object.entries(snaps).map(([t, s]) => [t, s?.meta?.tradingCurrencyOriginal || s?.meta?.tradingCurrency || null]));
    const result = computeClassSum(entry, market, currencies, dataDay);
    if (dataDay > entry.reviewBy) log(`::warning::${entry.issuer}: Aktienzahlen der Klassensumme bis ${asOfRange(entry)[1]}, reviewBy ${entry.reviewBy} überschritten; Wert wird weiter gerechnet, Zahlen neu belegen.`);
    if (result.value === null) log(`::warning::${entry.issuer}: Klassensumme leer: ${result.reason}`);
    const { shown, written } = writeFirm(snaps, entry, result, fetchedAt);
    for (const ticker of written) writeJsonAtomic(file(ticker), snaps[ticker], { indent: 0 });
    report.push({ issuer: entry.issuer, value: result.value, date: result.date, reason: result.reason, shown, written });
  }
  const empty = report.filter((r) => r.value === null).length;
  if (empty) log(`::error::Klassensumme: ${empty} von ${report.length} Firmen ohne Börsenwert; sie fehlen heute auf den Boards (Gründe oben).`);
  return report;
}

/**
 * Daily deadline line for the class-sum share counts (report only, scripts/tageslauf-erwartungen.js): which issuers reach
 * their reviewBy within the window. After reviewBy the sum is still computed; only the merge log warns.
 * @param {string} datum Data day YYYY-MM-DD.
 * @param {number} [tage] Window in days.
 * @param {object[]} [entries] Class-sum entries (default: the config).
 * @returns {string[]} German lines, empty when nothing is due.
 */
function reviewLines(datum, tage = 30, entries = loadClassSumEntries()) {
  if (!DAY.test(datum || '')) throw new Error('reviewLines: datum must be YYYY-MM-DD');
  const due = new Map();
  for (const e of entries) if (ageDays(datum, e.reviewBy) <= tage) due.set(e.reviewBy, [...(due.get(e.reviewBy) || []), e.issuer]);
  return [...due].sort(([a], [b]) => (a < b ? -1 : 1)).map(([d, firms]) => {
    const rest = ageDays(datum, d);
    return `Frist ${de(d)} (${rest >= 0 ? 'in ' + rest + ' Tagen' : 'seit ' + -rest + ' Tagen überschritten'}): Die Aktienzahlen der Klassensumme von ${firms.length} ${firms.length === 1 ? 'Firma' : 'Firmen'} ` +
      `sind neu zu belegen; bis dahin rechnet der Lauf den Börsenwert mit den bisherigen Zahlen weiter. Betroffen: ${firms.join('; ')}.`;
  });
}

module.exports = { loadClassSumEntries, finishedCloses, fetchMarket, computeClassSum, reasonText, writeFirm, applyClassSums, reviewLines, fxSymbol, SOURCE, MAX_CLOSE_AGE_DAYS };
