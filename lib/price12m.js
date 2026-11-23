'use strict';
/**
 * lib/price12m.js — change of the close over the last 12 months for the board rows (23.11.2026,
 * card data contract). Display only, never a score input (the score measures quality, not price).
 *
 * Series = the 400-day price store (lib/price-history-store.js), the same closes the ATH distance
 * reads (scripts/update-ath-state.js). Those closes are Yahoo adjusted closes: back-adjusted for
 * splits AND dividends, so the change includes dividends. Currency-free (a ratio in the trading
 * currency). End = newest close; start = the last close on or before the same calendar day one
 * year earlier, at most START_GAP_DAYS before it. Anything else: null with a German reason.
 * Pure function, no clock.
 */

const DAY = 86400000;
// Weekends, holidays and short trading halts. ponytail: fixed tolerance, use the exchange calendar if it misfires.
const START_GAP_DAYS = 7;
const SOURCE = 'yahoo-adjclose';

const isRealDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
  && Number.isFinite(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;

/**
 * The 12-month change of one ticker, or null with the reason.
 * @param {Array<{date:string, close:number}>|undefined} series closes in any order.
 * @returns {{price12m: ({fromDate:string, fromClose:number, toDate:string, toClose:number, changePct:number, source:string}|null), price12mReason: (string|null)}}
 */
function price12mFor(series) {
  const leer = (reason) => ({ price12m: null, price12mReason: reason });
  const bars = (Array.isArray(series) ? series : [])
    .filter((b) => b && isRealDay(b.date) && Number.isFinite(b.close) && b.close > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (bars.length < 2) return leer('Keine Kursreihe für diese Aktie im Kursspeicher.');
  const to = bars[bars.length - 1];
  const target = new Date(to.date + 'T00:00:00Z');
  target.setUTCFullYear(target.getUTCFullYear() - 1);
  const targetDay = target.toISOString().slice(0, 10);
  let from = null;
  for (let i = bars.length - 1; i >= 0; i--) if (bars[i].date <= targetDay) { from = bars[i]; break; }
  if (!from) return leer(`Kursreihe beginnt erst am ${bars[0].date}, kürzer als 12 Monate.`);
  if (target.getTime() - Date.parse(from.date + 'T00:00:00Z') > START_GAP_DAYS * DAY) {
    return leer(`Der Kursreihe fehlen die Tage um den ${targetDay}.`);
  }
  return {
    price12m: { fromDate: from.date, fromClose: from.close, toDate: to.date, toClose: to.close,
      changePct: Math.round((to.close / from.close - 1) * 1000) / 10, source: SOURCE },
    price12mReason: null,
  };
}

module.exports = { price12mFor, START_GAP_DAYS, SOURCE };
