'use strict';

// Read-time authority for two annual axes only. Never splice a positional series.
const table = require('../configs/sourced-annual-years.json');
const { envelope } = require('./financial-known-cases.js');
const { norm } = require('../src/scoring/snapshot.js');
const { annualPeriodEnds, periodGateReason, staleReason, dataDay } = require('./annual-pairs.js');
const FIELDS = ['revenue', 'priorRevenue', 'grossProfit', 'priorGrossProfit'];
const day = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)
  && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0, 10) === x;
const listings = r => [r.ticker, ...r.listingAliases];
// Native-unit tolerance: floating point/rounding only, not a restatement allowance.
const agrees = (a, b, factor) => Number.isFinite(a) && Number.isFinite(b)
  && Math.abs(a - b) <= Math.max(factor, Math.abs(b) * 1e-8);

/** Validate sourced records and two independently transcribed readings.
 * @param {object} config Source table.
 * @returns {object} The validated table; malformed authority throws.
 */
function validateTable(config) {
  if (config?.schemaVersion !== 1 || !Array.isArray(config.records)) throw new Error('Invalid sourced annual table');
  const used = new Set();
  for (const r of config.records) {
    if (!r.id || !r.ticker || !Array.isArray(r.listingAliases) || !day(r.end) || !day(r.priorEnd)
        || periodGateReason('year', r.end, r.priorEnd) || r.periodType !== '12M'
        || !/^[A-Z]{3}$/.test(r.currency) || r.unit !== 'currency'
        || !day(r.verifiedAt) || !day(r.reviewBy) || r.reviewBy < r.verifiedAt
        || !FIELDS.every(f => Number.isFinite(r[f])) || r.revenue <= 0 || r.priorRevenue <= 0
        || !Array.isArray(r.readings) || r.readings.length !== 2) throw new Error('Invalid sourced annual record: ' + r.id);
    for (const ticker of listings(r)) {
      if (typeof ticker !== 'string' || !ticker || used.has(ticker)) throw new Error('Duplicate sourced annual listing: ' + ticker);
      used.add(ticker);
    }
    for (const [index, reading] of r.readings.entries()) {
      if (reading.pass !== index + 1 || !reading.discoveryQuery || !Array.isArray(reading.sources) || !reading.sources.length
          || !FIELDS.every(f => reading.values?.[f] === r[f])) throw new Error('Annual readings disagree: ' + r.id);
      for (const f of FIELDS) {
        const source = reading.sources.find(s => s.fields?.includes(f));
        if (!source || !/^https:\/\//.test(source.url) || !Number.isInteger(source.page) || source.page < 1
            || !source.quote || !day(source.published) || source.published <= r.end
            || source.published > r.verifiedAt) throw new Error('Missing annual source: ' + r.id + '/' + f);
        const o = source.operands, multiplier = source.multiplier ?? 1;
        const amount = o && (f === 'grossProfit' && !Number.isFinite(o.grossProfit) ? o.revenue - o.costOfRevenue
          : f === 'priorGrossProfit' && !Number.isFinite(o.priorGrossProfit) ? o.priorRevenue - o.priorCostOfRevenue : o[f]);
        if (![1, 1000].includes(multiplier) || !Number.isFinite(amount)
            || Math.abs(amount * multiplier - r[f]) > 1e-6) throw new Error('Untraceable annual value: ' + r.id + '/' + f);
      }
    }
  }
  return config;
}
validateTable(table);

/** Resolve one filed year against the CURRENT prepared snapshot, including both prior cells.
 * @param {object} snapshot Prepared or raw snapshot.
 * @param {object} [config] Validated source table (explicit fixtures in tests).
 * @returns {object} Status, German reason and, only when usable, a native-currency record.
 */
function resolveSourcedAnnualYear(snapshot, config = table) {
  const r = config.records.find(x => listings(x).includes(snapshot?.meta?.ticker));
  if (!r) return { status: 'not-configured', reason: null };
  const reject = (status, reason) => ({ id: r.id, status, reason });
  const revEnds = annualPeriodEnds(snapshot, 'annualRev'), gpEnds = annualPeriodEnds(snapshot, 'annualGP');
  // Either series catching up retires the whole record; partial vendor updates never double count.
  if ([...revEnds, ...gpEnds].some(e => e && e >= r.end)) {
    return reject('vendor-caught-up', 'Der Anbieter liefert das neuere Jahr; der ergänzte Jahresstand entfällt.');
  }
  const at = dataDay() || snapshot?.meta?.asOf?.slice(0, 10) || snapshot?.meta?.fetchedAt?.slice(0, 10);
  const published = r.readings.flatMap(x => x.sources.map(s => s.published)).sort().at(-1);
  if (!day(at) || at < published) return reject('not-public', 'Der neuere Abschluss war am Datenstand noch nicht belegt veröffentlicht.');
  if (at > r.reviewBy) return reject('review-expired', 'Der ergänzte Jahresstand muss erneut gegen den Anbieter geprüft werden.');
  const age = staleReason('axis', r.end);
  if (age) return reject('stale', age);
  if (revEnds[0] !== r.priorEnd || gpEnds[0] !== r.priorEnd
      || periodGateReason('year', r.end, revEnds[0])) {
    return reject('period-mismatch', 'Der Vorjahreszeitraum des Abschlusses passt nicht zu beiden Anbieterreihen.');
  }
  const env = envelope(snapshot);
  if (!env || env.currency !== r.currency || snapshot?.meta?.ccyAmbiguous) {
    return reject('currency-mismatch', 'Die Berichtswährung oder ihre Umrechnung ist nicht eindeutig belegt.');
  }
  const { validUnit } = require('./yahoo-q4-known-cases.js');
  for (const field of ['annualRev', 'annualGP']) {
    const provenance = snapshot.meta?.statementPeriods?.[field]?.[0];
    if (!validUnit(snapshot.annual?.[field]?.[0], env.stored, '12M')
        || (provenance && (provenance.currency !== r.currency || provenance.end !== r.priorEnd
          || provenance.duration !== '12M' || provenance.unit !== 'currency'))) {
      return reject('unit-mismatch', 'Einheit, Währung oder Zeitraum der gespeicherten Vorjahreszelle weichen ab.');
    }
  }
  if (!agrees(norm(snapshot, 'annualRev')[0], r.priorRevenue * env.factor, env.factor)
      || !agrees(norm(snapshot, 'annualGP')[0], r.priorGrossProfit * env.factor, env.factor)) {
    return reject('prior-mismatch', 'Mindestens ein Vorjahreswert weicht vom geprüften Abschluss ab.');
  }
  return { id: r.id, status: 'available', reason: null, record: r, factor: env.factor };
}

/** Attach read-time provenance without changing any stored series or vendor newer-year record.
 * @param {object} snapshot Prepared snapshot.
 * @returns {object} Same snapshot without a configured case, otherwise a shallow metadata copy.
 */
function prepareSourcedAnnualYear(snapshot) {
  const result = resolveSourcedAnnualYear(snapshot);
  return result.status === 'not-configured' ? snapshot : { ...snapshot, meta: { ...snapshot.meta, sourcedAnnualYear: result } };
}

module.exports = { validateTable, resolveSourcedAnnualYear, prepareSourcedAnnualYear };
