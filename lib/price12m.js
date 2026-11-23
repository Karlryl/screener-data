'use strict';
/**
 * lib/price12m.js — change of the close over the last 12 months for the board rows (23.11.2026,
 * card data contract). Display only, never a score input (the score measures quality, not price).
 *
 * Series = the 400-day price store (lib/price-history-store.js), the closes the ATH distance reads
 * (scripts/update-ath-state.js): Yahoo adjclose where Yahoo sends it (splits and dividends
 * back-adjusted), the raw close only for a series without any adjclose (pull-historical-prices.js).
 * The store does not record which of the two a series is, so `source` names the store, not adjclose.
 * End = newest close; start = the last close on or before the same calendar day one year earlier,
 * at most START_GAP_DAYS before it; closes rounded to 6 significant digits, the change computed from the
 * rounded closes. Anything else: null with a reason CODE (the wording lives in
 * findash; repeated German sentences would cost hundreds of KB per full board).
 * Pure function, no clock (the caller passes the data day).
 */
const { isCalendarDay } = require('./fcf-ttm.js');

const DAY = 86400000;
// Weekends, holidays and exchange closures (Golden Week, Lunar New Year: up to ~10 calendar days).
// ponytail: fixed tolerance, use the exchange calendar if it misfires.
const START_GAP_DAYS = 12;
// A newest close older than this before the data day is no current 12-month change.
const MAX_END_AGE_DAYS = 10;
// A day-to-day ratio beyond this factor inside the window looks like an unadjusted split.
const JUMP_FACTOR = 3;
const SOURCE = 'yahoo-price-store';

/** Reason codes of price12mReason; the ones with a day carry it after a colon ("short-series:2026-03-02"). */
const PRICE12M_REASON_CODES = Object.freeze(['no-series', 'short-series', 'gap', 'jump', 'stale-series', 'store-unreadable']);

const sig6 = (x) => Number(x.toPrecision(6));

/**
 * The 12-month change of one ticker, or null with the reason code.
 * @param {Array<{date:string, close:number}>|undefined} series closes in any order.
 * @param {string|null} [dataDay] data day of the run (YYYY-MM-DD); without it the age check is skipped.
 * @returns {{price12m: ({fromDate:string, fromClose:number, toDate:string, toClose:number, changePct:number, source:string}|null), price12mReason: (string|null)}}
 */
function price12mFor(series, dataDay = null) {
  const leer = (reason) => ({ price12m: null, price12mReason: reason });
  const bars = (Array.isArray(series) ? series : [])
    .filter((b) => b && isCalendarDay(b.date) && Number.isFinite(b.close) && b.close > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (bars.length < 2) return leer('no-series');
  const to = bars[bars.length - 1];
  if (isCalendarDay(dataDay) && Date.parse(dataDay + 'T00:00:00Z') - Date.parse(to.date + 'T00:00:00Z') > MAX_END_AGE_DAYS * DAY) {
    return leer('stale-series:' + to.date);
  }
  const target = new Date(to.date + 'T00:00:00Z');
  target.setUTCFullYear(target.getUTCFullYear() - 1);
  const targetDay = target.toISOString().slice(0, 10);
  let i0 = -1;
  for (let i = bars.length - 1; i >= 0; i--) if (bars[i].date <= targetDay) { i0 = i; break; }
  if (i0 < 0) return leer('short-series:' + bars[0].date);
  const from = bars[i0];
  if (target.getTime() - Date.parse(from.date + 'T00:00:00Z') > START_GAP_DAYS * DAY) return leer('gap:' + targetDay);
  for (let i = i0 + 1; i < bars.length; i++) {
    const r = bars[i].close / bars[i - 1].close;
    if (r > JUMP_FACTOR || r < 1 / JUMP_FACTOR) return leer('jump');
  }
  // The change follows from the closes as shown, so a reader (and the export check) can recompute it.
  const fromClose = sig6(from.close), toClose = sig6(to.close);
  return {
    price12m: { fromDate: from.date, fromClose, toDate: to.date, toClose,
      changePct: Math.round((toClose / fromClose - 1) * 1000) / 10, source: SOURCE },
    price12mReason: null,
  };
}

module.exports = { price12mFor, PRICE12M_REASON_CODES, START_GAP_DAYS, MAX_END_AGE_DAYS, JUMP_FACTOR, SOURCE };
