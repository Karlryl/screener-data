'use strict';
const fs = require('node:fs');
const path = require('node:path');

const REGISTRY = path.join(__dirname, '..', 'configs', 'mcap-classes-registry.json');
const PATTERNS = new Set(['A+H', 'A+B', 'A+B+H', 'A+H+D', 'CN+HK_Ordinary', 'same_market_classes']);
const positive = (n) => Number.isFinite(n) && n > 0;
const text = (s) => typeof s === 'string' && s.trim().length > 0;
const timestamp = (s) => text(s) && Number.isFinite(Date.parse(s)) ? s : null;

/**
 * Loads explicit listed-class identities; invalid entries fail with their registry name.
 * @param {string} [file] Registry JSON path.
 * @returns {Object<string, object>} Validated issuer entries, excluding documentation.
 */
function loadRegistry(file = REGISTRY) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${file}: registry must be an object`);
  const entries = {};
  const tickers = new Set();
  for (const [name, entry] of Object.entries(raw)) {
    if (name === '_doku') continue;
    const bad = (why) => { throw new Error(`${file}: entry ${name}: ${why}`); };
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) bad('expected an issuer object');
    if (!text(entry.issuer) || !text(entry.source)) bad('issuer/source missing');
    if (!PATTERNS.has(entry.pattern)) bad('unsupported class pattern');
    if (typeof entry.unlistedClasses !== 'boolean') bad('unlistedClasses must be boolean');
    if (entry.listedClassesComplete !== undefined && typeof entry.listedClassesComplete !== 'boolean') bad('listedClassesComplete must be boolean');
    if (!Array.isArray(entry.classes) || entry.classes.length < 2) bad('at least two explicit listed classes required');
    for (const leg of entry.classes) {
      if (!leg || !text(leg.ticker) || !/^[A-Z0-9][A-Z0-9.-]*$/.test(leg.ticker) || !text(leg.class)) bad('invalid class ticker/label');
      if (tickers.has(leg.ticker)) bad(`duplicate class ticker ${leg.ticker}`);
      tickers.add(leg.ticker);
    }
    Object.defineProperty(entries, name, { value: entry, enumerable: true });
  }
  if (!Object.keys(entries).length) throw new Error(`${file}: registry has no issuer entries`);
  return entries;
}

/**
 * Values only evidenced listed classes using their own shares and pipeline-normalized quotes.
 * Observation timestamps are not filing dates or exchange close timestamps.
 * @param {object} entry Validated registry issuer.
 * @param {Object<string, object>|Map<string, object>} snapshotsByTicker Same-generation snapshots.
 * @returns {object} USD shadow, status, missing-evidence reason and every class input.
 */
function computeClassesShadow(entry, snapshotsByTicker) {
  const reasons = [];
  if (entry.listedClassesComplete === false) reasons.push(`${entry.issuer}: Vollstaendigkeit der gelisteten Klassen nicht belegt`);
  const classes = entry.classes.map((leg) => {
    const snap = snapshotsByTicker instanceof Map ? snapshotsByTicker.get(leg.ticker) : snapshotsByTicker[leg.ticker];
    const meta = snap?.meta || {};
    const quote = snap?.price || {};
    const missing = [];
    const shares = positive(meta.sharesOutstanding) ? meta.sharesOutstanding : null;
    const sharesAsOf = timestamp(meta.fetchedAt);
    const priceAsOf = timestamp(meta.asOf);
    const currency = text(meta.tradingCurrencyOriginal) ? meta.tradingCurrencyOriginal
      : text(meta.tradingCurrency) ? meta.tradingCurrency : null;
    const usdPerUnit = positive(meta.tradingFxRateApplied) ? meta.tradingFxRateApplied : null;
    const fxSource = text(meta.fxRateSourceTrading) ? meta.fxRateSourceTrading : null;
    const units = [quote.currencyUnit, meta.priceCurrency].filter((unit) => unit != null);
    const usdProven = units.length > 0 && units.every((unit) => unit === 'USD');
    const currentPrice = snap?._pullMode !== 'price-only'
      || (priceAsOf !== null && timestamp(snap._pullModeAt) !== null && priceAsOf === snap._pullModeAt);
    // tradingFxRateApplied includes quote-unit scaling (e.g. pence). Undo it once.
    const price = positive(quote.regularMarketPrice) && usdProven && usdPerUnit !== null && currentPrice
      ? quote.regularMarketPrice / usdPerUnit : null;
    if (!snap) missing.push('Snapshot fehlt');
    else {
      if (shares === null) missing.push('Klassenaktienzahl meta.sharesOutstanding fehlt');
      if (sharesAsOf === null) missing.push('Beobachtungszeit der Aktienzahl fehlt');
      if (!positive(price)) missing.push('Kurs oder belegte USD-Rueckumrechnung fehlt');
      if (!currentPrice) missing.push('Kurs und angewandter FX-Stempel stammen nicht aus demselben Preisabruf');
      if (priceAsOf === null) missing.push('Beobachtungszeit des Kurses fehlt');
      if (currency === null || meta.tradingCurrencyAssumed === true) missing.push('Handelswaehrung nicht belegt');
      if (usdPerUnit === null || fxSource === null) missing.push('angewandter Handels-FX oder seine Quelle fehlt');
    }
    const valueUsd = missing.length ? null : shares * price * usdPerUnit;
    if (!missing.length && !positive(valueUsd)) missing.push('Klassenwert nicht endlich oder nicht positiv');
    if (missing.length) reasons.push(`${leg.ticker}: ${missing.join(', ')}`);
    return { ticker: leg.ticker, class: leg.class, shares, sharesField: 'meta.sharesOutstanding',
      sharesAsOf, price: positive(price) ? price : null, currency, priceAsOf, usdPerUnit, fxSource,
      valueUsd: missing.length ? null : valueUsd };
  });
  const total = classes.reduce((sum, leg) => sum + (leg.valueUsd ?? 0), 0);
  if (!reasons.length && !positive(total)) reasons.push(`${entry.issuer}: Klassensumme nicht endlich oder nicht positiv`);
  return {
    value: reasons.length ? null : total,
    status: reasons.length ? 'incomplete' : entry.unlistedClasses ? 'listed-classes-only' : 'ok',
    reason: reasons.length ? reasons.join('; ') : entry.unlistedClasses ? 'Nicht boersennotierte Klassen sind nicht bewertet.' : null,
    classes,
  };
}

/**
 * Measures shown-value excess relative to the class shadow; unavailable inputs stay null.
 * @param {number|null} shown Existing displayed USD value.
 * @param {number|null} shadow Listed-class USD value.
 * @returns {number|null} 100 * (shown / shadow - 1).
 */
function deviationPct(shown, shadow) {
  if (!Number.isFinite(shown) || shown < 0 || !positive(shadow)) return null;
  const result = 100 * (shown / shadow - 1);
  return Number.isFinite(result) ? result : null;
}

module.exports = { loadRegistry, computeClassesShadow, deviationPct };
