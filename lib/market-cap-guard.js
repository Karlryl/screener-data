'use strict';
const fs = require('node:fs');
const { loadShareCountTable, applyShareCountTable, DERIVED_FIELDS, SHARES_TABLE_PATH: TABLE_PATH } = require('./ads-hand-table.js');
const floors = require('../configs/market-cap-floors.json');
const shares = loadShareCountTable();
const table = Object.assign(Object.create(null), Object.fromEntries(Object.entries(shares).filter(([, row]) => row.withholdUnverified === true)));
const holds = JSON.parse(fs.readFileSync(TABLE_PATH, 'utf8'))._holds;
const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
// Stale-price gate (formula draft, Daylauf 7, 24.10.2026): a market cap whose own quote time
// (marketCap.regularMarketTime, stamped by pull-yahoo.js) lies more than STALE_PRICE_WEEKDAYS weekdays before
// the run day is withheld like a hand-table hold. The run day is the frozen workflow day (RUN_DATE_UTC) or the
// UTC clock day, never the snapshot's own asOf, so a snapshot whose pull keeps failing still ages.
// Weekdays are Mon-Fri without an exchange calendar, so a holiday counts and the limit has to clear the longest
// regular closures. Measured in the price store over 2025-05..2026-10 at the runs (Tue-Sat): Taiwan Lunar New
// Year 2026 reaches 7, Golden Week 2026 6. At 5 one run would have emptied about 2,900 Shanghai and Shenzhen
// rows (2026-10-08); 10 catches the same dead lines three weekdays later.
// ponytail: weekday count without holidays; an exchange calendar only if a closure longer than 7 shows up.
const { sizeExitRunDay } = require('./size-exits.js');
const STALE_PRICE_WEEKDAYS = 7;
const STALE_PRICE_SOURCE = 'stale-price:market-cap-hold';
const DAY_MS = 86400000;
const germanDate = iso => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
// A real calendar day, not only its shape: Date.parse rolls 2026-02-30 over, so the round trip decides.
const realDay = value => {
  const d = day(value), t = d ? Date.parse(d) : NaN;
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d ? d : null;
};
// meta has to stay a plain object: a field on an array vanishes in JSON.stringify, on a string it throws.
const metaOf = snapshot => {
  const meta = snapshot.meta;
  return meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : (snapshot.meta = {});
};
// Rule without expiry: only a current Yahoo stamp proves a current price, so only that releases a held value.
// A firm Yahoo never stamps again stays empty for good, and the reason says what would bring it back.
const STALE_PRICE_RETURN = 'Der Börsenwert wird nicht gezeigt und kommt von selbst zurück, sobald Yahoo einen aktuellen Kurs liefert. Ein veralteter Kurs allein belegt kein Handelsende.';
let frozenRunDay = null; // one reference day per process, also across midnight
const runDay = () => (frozenRunDay ??= sizeExitRunDay(process.env));
/** Use the reporting rate only when full pulls prove both original currencies equal.
 * @param {object} meta Canonical currency stamps.
 * @returns {number|null} Proven native quote to USD factor, or no proof.
 */
const tradingRate = meta => meta.tradingFxRateApplied ??
  ((meta.tradingCurrencyOriginal || meta.tradingCurrency) === (meta.reportingCurrencyOriginal || meta.reportingCurrency)
    ? meta.fxRateApplied : null);
if (!holds || typeof holds !== 'object' || Array.isArray(holds)) throw new Error('Invalid market-cap holds');
Object.setPrototypeOf(holds, null);
for (const [ticker, row] of Object.entries({ ...table, ...holds })) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.reviewBy || '') || !day(row.validFrom) || !row.reason || !row.source?.url?.startsWith('https://') || !row.source?.quote ||
      (shares[ticker] && holds[ticker])) throw new Error('Invalid market-cap case: ' + ticker);
}

/** Apply only source-backed market-cap cases after USD normalization, in place.
 * @param {object} snapshot Canonical snapshot; retained raw files are never written here.
 * @param {number|null} [quotePriceUsd] Fresh pull price after the caller's USD conversion; null forbids a cached-price fallback.
 * @returns {object} Existing hand-table status, or withheld/no-row.
 */
function applyMarketCapGuard(snapshot, quotePriceUsd) {
  const ticker = snapshot?.meta?.ticker;
  const row = table[ticker] || holds[ticker];
  if (!row) { if (snapshot?.meta) delete snapshot.meta.marketCapReason; return { status: 'no-row' }; }
  const observed = day(snapshot.marketCap?.asOf || snapshot.meta.asOf);
  if (observed && observed < row.validFrom) { delete snapshot.meta.marketCapReason; return { status: 'no-row' }; }
  if (observed && observed > row.reviewBy) console.warn(`::warning::${ticker}: reviewBy ${row.reviewBy} überschritten; Börsenwert bleibt bis zur erneuten Belegprüfung leer.`);
  if (snapshot.marketCap?.source === 'hand-table:market-cap-hold') return { status: 'withheld' };
  let result = { status: 'stale' };
  const currency = snapshot.meta.tradingCurrencyOriginal || snapshot.meta.tradingCurrency;
  const priceCurrency = quotePriceUsd === undefined ? snapshot.price?.currencyUnit || snapshot.meta.priceCurrency : 'USD';
  const price = quotePriceUsd === undefined ? snapshot.price?.regularMarketPrice : quotePriceUsd;
  const usd = priceCurrency === 'USD' && (currency === 'USD' ||
    (snapshot.meta.fxConverted === true && Number.isFinite(tradingRate(snapshot.meta)) && tradingRate(snapshot.meta) > 0));
  if (table[ticker] && observed && observed <= row.reviewBy && usd) {
    result = applyShareCountTable(snapshot, ticker, price, table);
    if (['confirmed', 'corrected', 'already-corrected'].includes(result.status)) {
      // Full pulls lack snapshot.price; retain the fresh USD input for subsequent reads and provenance.
      if (['corrected', 'confirmed'].includes(result.status) && quotePriceUsd !== undefined) {
        snapshot.price = { ...snapshot.price, regularMarketPrice: price, currencyUnit: 'USD', asOf: snapshot.marketCap.asOf };
      }
      if (result.status !== 'confirmed') snapshot.meta.marketCapReason = row.reason;
      else delete snapshot.meta.marketCapReason;
      return result;
    }
  }
  // reasonComplete: the row's reason already says why no value can exist (e.g. a delisted line), so the
  // standard "not yet proven" sentence would be untrue there.
  return withhold(snapshot, 'hand-table:market-cap-hold', `Börsenwert nicht verlässlich: ${row.reason}` +
    (row.reasonComplete === true ? '' : ' Ein aktueller vergleichbarer Wert ist noch nicht belegt.'));
}

// The one hold path: empty value with presence marker (T2), vendor value kept as yahooValue, German reason,
// price-derived Yahoo ratios blanked. Every reader leaves the row out of the boards on exactly this shape.
function withhold(snapshot, source, reason) {
  const previous = snapshot.marketCap || {};
  snapshot.marketCap = { ...previous, value: null, missing: true, source,
    yahooValue: previous.yahooValue ?? previous.value ?? null };
  metaOf(snapshot).marketCapReason = reason;
  if (snapshot.metrics) for (const field of DERIVED_FIELDS) if (snapshot.metrics[field] != null) snapshot.metrics[field] = null;
  return { status: 'withheld', reason };
}

/** Age of the quote behind a shown market cap, counted in weekdays (Mon-Fri) after the quote day up to the run day.
 * @param {object} snapshot Canonical snapshot.
 * @param {number} [limit] Count stops at limit + 1 (enough to decide the gate).
 * @param {string} [today] Reference day YYYY-MM-DD; default the frozen run day of this process.
 * @returns {{priceDay: string, age: number}|null} Quote day and capped age, or null without a value or a quote time.
 */
function priceAge(snapshot, limit = STALE_PRICE_WEEKDAYS, today = runDay()) {
  const cap = snapshot?.marketCap;
  if (!Number.isFinite(cap?.value)) return null;
  const priceDay = realDay(cap.regularMarketTime);
  if (!priceDay || priceDay <= '1970-01-01') return null; // epoch 0 or earlier is a missing stamp, not a date
  let age = 0;
  for (let t = Date.parse(priceDay) + DAY_MS, end = Date.parse(today); t <= end && age <= limit; t += DAY_MS) {
    const weekday = new Date(t).getUTCDay();
    if (weekday !== 0 && weekday !== 6) age++;
  }
  return { priceDay, age };
}

// The day of a stored hold, only when it is a real day up to the run day.
const heldDay = (hold, today) => { const d = realDay(hold?.priceDay); return d && d <= today ? d : null; };

/** Carry known Yahoo quote staleness across replacements without relabelling the new value's timestamp.
 * @param {object} snapshot New canonical observation, mutated only in its separate metadata.
 * @param {object|null} previous Previous canonical observation, read only (may be the same object).
 * @param {string} [today] Frozen run day YYYY-MM-DD.
 * @returns {object|null} Known stale quote day, or null after a proven current quote or with no prior evidence.
 */
function retainStalePriceHold(snapshot, previous, today = runDay()) {
  // A missing-cap response can erase the value but must not erase its last known quote evidence.
  const ageOf = s => priceAge({ marketCap: { ...s?.marketCap, value: 1 } }, STALE_PRICE_WEEKDAYS, today);
  const current = ageOf(snapshot), prior = ageOf(previous);
  const provenCurrent = Number.isFinite(snapshot?.marketCap?.value) && current && current.priceDay <= today && current.age <= STALE_PRICE_WEEKDAYS;
  // A damaged hold still counts as known staleness, but only a readable past day may be carried as its date.
  const known = [snapshot?.meta?.stalePriceHold, previous?.meta?.stalePriceHold].filter(Boolean);
  const knownDay = known.map(h => heldDay(h, today)).find(Boolean) ?? (prior?.age > STALE_PRICE_WEEKDAYS ? prior.priceDay : null);
  const hold = provenCurrent ? null : current?.age > STALE_PRICE_WEEKDAYS ? { priceDay: current.priceDay }
    : knownDay || known.length ? { priceDay: knownDay } : null;
  if (hold) metaOf(snapshot).stalePriceHold = { ...hold };
  else if (snapshot.meta) delete snapshot.meta.stalePriceHold;
  return hold;
}

/** Withhold a shown market cap whose quote is older than the limit; hand-table holds never reach this.
 * @param {object} snapshot Canonical snapshot, mutated in place when stale.
 * @param {number} [limit] Weekdays a quote may age before the value is withheld.
 * @param {string} [today] Reference day YYYY-MM-DD; default the frozen run day of this process.
 * @returns {object} {status: 'withheld', reason} | {status: 'fresh'} | {status: 'no-quote-time'} | {status: 'no-value'}.
 */
function applyStalePriceGate(snapshot, limit = STALE_PRICE_WEEKDAYS, today = runDay()) {
  if (!Number.isFinite(snapshot?.marketCap?.value)) return { status: 'no-value' };
  const age = priceAge(snapshot, limit, today);
  const known = snapshot?.meta?.stalePriceHold;
  if (known && (!age || age.priceDay > today)) {
    const held = heldDay(known, today);
    return withhold(snapshot, STALE_PRICE_SOURCE, (held ? `Zuletzt als veraltet belegter Yahoo-Kurs vom ${germanDate(held)}`
      : 'Ein früherer Vermerk über einen veralteten Yahoo-Kurs ist nicht lesbar') +
      `; ein aktueller Yahoo-Kurszeitpunkt fehlt. ${STALE_PRICE_RETURN}`);
  }
  if (!age) return { status: Number.isFinite(snapshot?.marketCap?.value) ? 'no-quote-time' : 'no-value' };
  if (age.age <= limit) return { status: 'fresh' };
  metaOf(snapshot).stalePriceHold = { priceDay: age.priceDay };
  return withhold(snapshot, STALE_PRICE_SOURCE,
    `Letzter von Yahoo gelieferter Kurs vom ${germanDate(age.priceDay)}, älter als ${limit} Wochentage (Montag bis Freitag). ${STALE_PRICE_RETURN}`);
}

/** Prepare a read-only copy for known cases; unrelated rows retain identity and bytes.
 * Precedence: a hand-table hold keeps its own reason; the stale-price gate then empties any value still
 * shown, including a hand-table correction computed from the same old quote (one reason, never two).
 * @param {object} snapshot Canonical snapshot.
 * @returns {object} Prepared snapshot or original when no correction applies.
 */
function prepareMarketCap(snapshot) {
  if (snapshot?.marketCap?.source === STALE_PRICE_SOURCE) return snapshot; // already prepared: keep its reason
  const age = priceAge(snapshot);
  if (Number.isFinite(snapshot?.marketCap?.value)) { count('checked'); if (!age) count('noQuoteTime'); }
  if (!table[snapshot?.meta?.ticker] && !holds[snapshot?.meta?.ticker] && !snapshot?.meta?.marketCapReason &&
      !snapshot?.meta?.stalePriceHold && !((age?.age ?? 0) > STALE_PRICE_WEEKDAYS)) return snapshot;
  const copy = structuredClone(snapshot);
  applyMarketCapGuard(copy);
  if (applyStalePriceGate(copy).status === 'withheld') count('withheld');
  return copy;
}

// One stderr line per process at exit (pattern of [yahoo-q4-hand-table-summary]). A pull that stops stamping the
// quote time would otherwise switch the gate off without a sign, so more than half unstamped values warn
// (only from 100 checked values on: a daily reader checks about 16,000, unit fixtures a handful).
const staleTally = { checked: 0, noQuoteTime: 0, withheld: 0 };
let tallyRegistered = false;
function count(key) {
  if (!tallyRegistered) {
    tallyRegistered = true;
    process.once('exit', () => {
      const off = staleTally.checked >= 100 && staleTally.noQuoteTime * 2 > staleTally.checked;
      console.error(`${off ? '::warning::' : ''}[stale-price-gate] ${JSON.stringify(staleTally)}`);
    });
  }
  staleTally[key]++;
}

/** Match the pull's existing configurable size floor, without importing its I/O.
 * @param {object} env Environment carrying MIN_MCAP_USD.
 * @returns {number} Existing production USD floor, default 800 million.
 */
function marketCapFloor(env = process.env) {
  const value = parseFloat(env.MIN_MCAP_USD || '');
  return Number.isFinite(value) && value >= 0 ? value : floors.mainUsd;
}

/** Reapply the size filter only to known corrected listings, including cached inputs.
 * @param {object} snapshot Prepared canonical input.
 * @param {number} floor Effective main or smallcap floor.
 * @returns {boolean} Whether this hand-table case is now below the existing floor.
 */
function correctedBelowFloor(snapshot, floor = marketCapFloor()) {
  return !!table[snapshot?.meta?.ticker] && Number.isFinite(snapshot.marketCap?.value) && snapshot.marketCap.value < floor;
}

module.exports = { applyMarketCapGuard, prepareMarketCap, marketCapFloor, correctedBelowFloor, tradingRate, table, holds,
  priceAge, applyStalePriceGate, retainStalePriceHold, STALE_PRICE_WEEKDAYS, STALE_PRICE_SOURCE, staleTally };
