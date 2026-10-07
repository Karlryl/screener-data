'use strict';

const { norm, annualPeriodEnds, _tagesnummer, jahresVergleichIdx } = require('./snapshot.js');

// P115-M: 16,148 snapshots, CI run 37439518589 (2026-10-06). Of 20,114
// consecutive dated annual pairs, 19,996 are exactly 365/366 days apart (Yahoo
// month ends). None are 337..364 or 367..455. In 300..349: 304 (2 true short
// periods), 335 (1), 336 (2), including ABF.L/ASBFF and 4291.SR 52/53-week
// reporters. Next longer distance is 456 (transition); 77 pairs are >=700.
// 334..397 leaves zero gapless series falsely empty. This tests the DISTANCE
// between year ends, NOT a 357..378-day statement period length.
const ANNUAL_PAIR_MIN_DAYS = 334;
const ANNUAL_PAIR_MAX_DAYS = 397;
const MISSING_YEAR_MIN_DAYS = 700;
let active = { growth: false, acceleration: false };

/**
 * Temporarily enables annual pair checks. Unspecified parts retain their previous state.
 * @param {{growth?:boolean, acceleration?:boolean}} parts Parts to override.
 * @param {Function} fn Synchronous calculation; promises and thenables are rejected.
 * @returns {*} The synchronous result, with the previous state restored even on failure.
 */
function withAnnualPairRule(parts, fn) {
  if (!parts || typeof parts !== 'object' || typeof fn !== 'function'
      || Object.entries(parts).some(([key, value]) => !Object.hasOwn(active, key) || typeof value !== 'boolean')) {
    throw new TypeError('Annual pair rule requires boolean parts and a synchronous function');
  }
  const previous = active;
  let result;
  try {
    active = { ...previous, ...parts };
    result = fn();
  } finally {
    active = previous;
  }
  if (result != null && typeof result.then === 'function') {
    throw new TypeError('Annual pair rule requires a synchronous function, not a thenable');
  }
  return result;
}

/** Reads one rule part; production defaults to false. @param {string} part Part name. @returns {boolean} Whether enabled. */
function annualPairRuleEnabled(part) { return active[part] === true; }

/** Tests a pair verdict without coercing missing data. @param {object} pair Verdict. @returns {boolean} Whether today's pair may pass. */
function annualPairPasses(pair) { return pair.code === 'adjacent' || pair.code === 'undated'; }

function checkEnds(newEnd, oldEnd, priorEnd) {
  const newer = _tagesnummer(newEnd), older = _tagesnummer(oldEnd), prior = _tagesnummer(priorEnd);
  const priorLengthDays = older !== null && prior !== null ? older - prior : null;
  if (newer === null || older === null) return { code: 'undated', distanceDays: null, priorLengthDays };
  const distanceDays = newer - older;
  const code = distanceDays >= MISSING_YEAR_MIN_DAYS ? 'missing-year'
    : distanceDays > ANNUAL_PAIR_MAX_DAYS ? 'long-period'
    : distanceDays < ANNUAL_PAIR_MIN_DAYS ? 'short-period'
    : priorLengthDays !== null && priorLengthDays < ANNUAL_PAIR_MIN_DAYS ? 'short-prior-period'
    : priorLengthDays > ANNUAL_PAIR_MAX_DAYS && priorLengthDays < MISSING_YEAR_MIN_DAYS ? 'long-prior-period'
    : 'adjacent';
  return { code, distanceDays, priorLengthDays };
}

/**
 * Judges only the two selected annual positions, never searches for a replacement.
 * @param {object} snapshot Prepared snapshot.
 * @param {string} field Annual field, e.g. annualRev or annualGP.
 * @param {number} iNew Selected newer position.
 * @param {number} iOld Selected older position.
 * @returns {{code:string, distanceDays:number|null, priorLengthDays:number|null}} Date verdict.
 */
function checkAnnualPair(snapshot, field, iNew, iOld) {
  const ends = annualPeriodEnds(snapshot, field);
  return checkEnds(ends[iNew], ends[iOld], ends[iOld + 1]);
}

/**
 * Judges the existing newer-year record, including its stored prior-year length if dated.
 * @param {object} snapshot Prepared snapshot.
 * @param {object} record Already validated by annualLegNewerYear.
 * @returns {{code:string, distanceDays:number|null, priorLengthDays:number|null}} Date verdict.
 */
function checkNewerAnnualPair(snapshot, record) {
  const ends = annualPeriodEnds(snapshot, 'annualRev');
  const priorDay = _tagesnummer(record.priorEnd);
  const index = priorDay === null ? -1 : ends.findIndex((end) => _tagesnummer(end) === priorDay);
  return checkEnds(record.end, record.priorEnd, index < 0 ? null : ends[index + 1]);
}

const emptyCheck = (code) => ({ code, distanceDays: null, priorLengthDays: null });

/**
 * Checks both pairs of today's annual acceleration fallback, newer pair first.
 * @param {object} snapshot Prepared snapshot.
 * @returns {object} First failure, otherwise first verdict, with selected indices for explanation.
 */
function checkAnnualAcceleration(snapshot) {
  const values = norm(snapshot, 'annualRev');
  const used = values.map((v, i) => v > 0 ? i : null).filter((i) => i !== null).slice(0, 3);
  if (used.length < 3) return emptyCheck('no-annual-pair');
  const pairs = used.slice(0, 2).map((iNew, i) => {
    const iOld = used[i + 1];
    const skipped = values.slice(iNew + 1, iOld);
    const zeroIndex = !skipped.includes(null) ? values.findIndex((v, j) => j > iNew && j < iOld && v !== null && v <= 0) : -1;
    const verdict = checkAnnualPair(snapshot, 'annualRev', iNew, iOld);
    return { ...verdict, code: zeroIndex >= 0 ? 'zero-year' : verdict.code, iNew, iOld, zeroIndex };
  });
  return pairs.find((pair) => !annualPairPasses(pair)) || pairs[0];
}

// Same branch eligibility as revAcceleration; no quarterly partner or formula is changed.
function usesQuarterlyAcceleration(snapshot) {
  const values = norm(snapshot, 'revenueQ');
  let pairs = 0;
  for (let i = 0; i < values.length; i++) {
    const partner = jahresVergleichIdx(snapshot, 'revenueQ', i);
    if (partner && values[i] > 0 && values[partner.idx] > 0 && ++pairs >= 2) return true;
  }
  return false;
}

function reasonFor(axis, pair, ends, values) {
  const prefix = axis === 'acceleration' ? 'Keine Beschleunigung' : axis === 'grossProfit' ? 'Kein Bruttogewinnwachstum' : 'Kein Jahreswachstum';
  const year = (end) => _tagesnummer(end) === null ? null : end.slice(0, 4);
  const newer = year(ends[pair.iNew ?? 0]), older = year(ends[pair.iOld ?? 1]);
  const months = Math.round(pair.distanceDays / 30.44);
  const priorMonths = Math.round(pair.priorLengthDays / 30.44);
  switch (pair.code) {
    case 'no-snapshot': return 'Kein gespeicherter Datenstand vorhanden, die Jahrespaare sind nicht prüfbar.';
    case 'snapshot-unreadable': return 'Der gespeicherte Datenstand ist nicht lesbar, die Jahrespaare sind nicht prüfbar.';
    case 'no-annual-pair': return 'Die heutige Rechnung bildet für diese Achse kein Jahrespaar, daher ist kein Jahresvergleich zu prüfen.';
    case 'undated': return 'Ohne gültige Periodenenden beim Anbieter, die heutige Rechnung bleibt.';
    case 'adjacent': return `Benachbarte volle Geschäftsjahre ${newer} und ${older} (${months} Monate).`;
    case 'missing-year': return `${prefix}: Zwischen den Geschäftsjahren ${newer} und ${older} fehlt mindestens ein Jahresende beim Anbieter, der Vergleich ginge über ${months} Monate.`;
    case 'long-period': return `${prefix}: Der Vergleich der Geschäftsjahre ${newer} und ${older} ginge über ${months} Monate und ist zu lang für einen Jahresvergleich.`;
    case 'short-period': return `${prefix}: Der Vergleich der Geschäftsjahre ${newer} und ${older} umfasst nur ${months} Monate und ist ein Rumpfzeitraum.`;
    case 'short-prior-period': return `${prefix}: Das Vorjahr ${older} beim Vergleich ${newer} gegen ${older} ist ein Rumpfzeitraum von ${priorMonths} Monaten.`;
    case 'long-prior-period': return `${prefix}: Das Vorjahr ${older} beim Vergleich ${newer} gegen ${older} umfasst ${priorMonths} Monate und ist kein voller Jahreszeitraum.`;
    case 'zero-year': {
      const zeroYear = year(ends[pair.zeroIndex]);
      return `${prefix}: Der Umsatz ${zeroYear || 'im undatierten übersprungenen Geschäftsjahr'} war ${values[pair.zeroIndex]} (gemeldeter Wert, keine Datenlücke), ein Vergleich über dieses Jahr ist kein Jahresvergleich.`;
    }
    default: throw new Error('Unknown annual pair code: ' + pair.code);
  }
}

/**
 * Builds the additive annualPairsShadow object; never changes the snapshot or scores.
 * @param {object|null} snapshot Prepared snapshot, or null when unavailable.
 * @param {Array<number>|null} bounds Acceleration winsorBounds.qoq from calibration.
 * @param {string} missingCode no-snapshot or snapshot-unreadable when unavailable.
 * @returns {object} Window and three axis verdicts with raw today/shadow values and German reasons.
 */
function annualPairsShadow(snapshot, bounds = null, missingCode = 'no-snapshot') {
  // Deferred dependencies avoid axes -> annual-pairs -> axes initialization cycles.
  const axes = require('./axes.js');
  const { revGrowthLeg } = require('../../lib/rev-growth-basis.js');
  return withAnnualPairRule({ growth: false, acceleration: false }, () => {
    const ends = annualPeriodEnds(snapshot, 'annualRev');
    const gpEnds = annualPeriodEnds(snapshot, 'annualGP');
    const values = norm(snapshot, 'annualRev');
    const record = axes.revQuartalsYoY(snapshot) === null ? axes.annualLegNewerYear(snapshot) : null;
    const growth = record ? checkNewerAnnualPair(snapshot, record)
      : axes.revAnnualYoY(snapshot) === null ? emptyCheck('no-annual-pair') : checkAnnualPair(snapshot, 'annualRev', 0, 1);
    const gp = norm(snapshot, 'annualGP');
    const grossProfit = Number.isFinite(gp[0]) && gp[1] > 0 ? checkAnnualPair(snapshot, 'annualGP', 0, 1) : emptyCheck('no-annual-pair');
    const acceleration = usesQuarterlyAcceleration(snapshot) ? emptyCheck('no-annual-pair') : checkAnnualAcceleration(snapshot);
    const read = () => ({ growth: revGrowthLeg(snapshot).pct, grossProfit: axes.gpGrowth(snapshot), acceleration: axes.revAcceleration(snapshot, bounds) });
    const today = snapshot ? read() : { growth: null, grossProfit: null, acceleration: null };
    const shadow = snapshot ? withAnnualPairRule({ growth: true, acceleration: true }, read) : today;
    const out = { windowDays: [ANNUAL_PAIR_MIN_DAYS, ANNUAL_PAIR_MAX_DAYS] };
    for (const [axis, verdict, dates] of [
      ['growth', growth, record ? [record.end, record.priorEnd] : ends],
      ['grossProfit', grossProfit, gpEnds], ['acceleration', acceleration, ends],
    ]) {
      const pair = snapshot ? verdict : emptyCheck(missingCode);
      out[axis] = { code: pair.code, reason: reasonFor(axis, pair, dates, values),
        distanceDays: pair.distanceDays, priorLengthDays: pair.priorLengthDays, today: today[axis], shadow: shadow[axis] };
    }
    return out;
  });
}

module.exports = { ANNUAL_PAIR_MIN_DAYS, ANNUAL_PAIR_MAX_DAYS, MISSING_YEAR_MIN_DAYS,
  withAnnualPairRule, annualPairRuleEnabled, annualPairPasses, checkAnnualPair,
  checkNewerAnnualPair, checkAnnualAcceleration, annualPairsShadow };
