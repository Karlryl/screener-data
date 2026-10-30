'use strict';

const { norm, jahresVergleichIdx, JAHR_TAGE, JAHRESVERGLEICH_TOLERANZ_TAGE } = require('../src/scoring/snapshot.js');

// Keep the identical snapshot.js round-trip check here: that source file is sealed.
const MS_PRO_TAG = 86400000;
/** Converts a round-trip validated ISO day to UTC days. @param {*} iso Stored end. @returns {number|null} Day number or null. */
function _tagesnummer(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const t = Date.parse(iso.slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(t)) return null;
  return (new Date(t).toISOString().slice(0, 10) === iso.slice(0, 10)) ? t / MS_PRO_TAG : null;
}

/**
 * Reads aligned annual ends using the same date validation as F-4.
 * @param {object} snapshot Prepared snapshot.
 * @param {string} field Annual value field registered in norm().
 * @returns {Array<string|null>} Valid ISO days, or null at undated positions.
 */
function annualPeriodEnds(snapshot, field) {
  const values = norm(snapshot, field);
  const ends = snapshot && snapshot.annual && snapshot.annual[field + 'Ends'];
  if (!Array.isArray(ends) || ends.length !== values.length) return values.map(() => null);
  return ends.map((end) => _tagesnummer(end) === null ? null : end.slice(0, 10));
}

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
// Period gate (Daylauf 7, 24.10.2026, formula draft for the Codex review): a growth pair counts only when its
// two period ends are one year apart. Annual pairs use the P115 window above (334..397 days: 52/53-week years
// and month-end jitter pass, a 91-day REIT "year" or a two-year jump does not). Quarter, half-year and
// four-quarter pairs use the F-4 window of snapshot.js (365 +- 15 = 350..380 days), the window jahresVergleichIdx
// already picks the partner in; the gate states it once more at the pair itself.
// Round 2 (30.10.2026, after Codex's NOT RELEASED on #40): a missing end empties the pair too, and an annual pair also
// fails when the prior year's own length is not a year (checkEnds). Distance alone is not enough and the stored labels
// cannot decide it: all 63,478 annual statementPeriods of 30.10. say 12M, also NESTLEIND.BO's 15 months to 31.03.2024.
const YOY_PAIR_MIN_DAYS = JAHR_TAGE - JAHRESVERGLEICH_TOLERANZ_TAGE;
const YOY_PAIR_MAX_DAYS = JAHR_TAGE + JAHRESVERGLEICH_TOLERANZ_TAGE;
const PERIOD_GATE_WINDOWS = Object.freeze({
  year: [ANNUAL_PAIR_MIN_DAYS, ANNUAL_PAIR_MAX_DAYS], yearNewerRecord: [ANNUAL_PAIR_MIN_DAYS, ANNUAL_PAIR_MAX_DAYS],
  quarter: [YOY_PAIR_MIN_DAYS, YOY_PAIR_MAX_DAYS], halfYear: [YOY_PAIR_MIN_DAYS, YOY_PAIR_MAX_DAYS], ttm: [YOY_PAIR_MIN_DAYS, YOY_PAIR_MAX_DAYS],
});
const dayDe = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/**
 * Period gate: German reason when a growth pair is not two dated periods one year apart.
 * @param {string} basis year or yearNewerRecord (annual window); quarter, halfYear or ttm (year-over-year window).
 * @param {*} end Newer period end of the pair.
 * @param {*} priorEnd Older period end of the pair.
 * @param {*} [olderEnd] Annual pairs: the stored end before the prior year, which gives the prior year's length.
 * @returns {string|null} Reason naming the periods, or null when the pair may be shown.
 */
function periodGateReason(basis, end, priorEnd, olderEnd = null) {
  if (!Object.hasOwn(PERIOD_GATE_WINDOWS, basis)) throw new TypeError('Period gate: unknown basis ' + basis);
  const window = PERIOD_GATE_WINDOWS[basis];
  const newer = _tagesnummer(end), older = _tagesnummer(priorEnd);
  if (newer === null && older === null) return 'Periodenenden fehlen, der Zeitraum ist nicht belegt; Wachstum nicht gezeigt.';
  if (newer === null) return `Periodenende des neueren Werts fehlt (Vorjahr bis ${dayDe(priorEnd)}); Wachstum nicht gezeigt.`;
  if (older === null) return `Periodenende des Vorjahres fehlt (Zeitraum bis ${dayDe(end)}); Wachstum nicht gezeigt.`;
  const days = newer - older;
  if (days < window[0] || days > window[1]) {
    return `Perioden ${dayDe(end)} und ${dayDe(priorEnd)} liegen ${Math.abs(days)} Tage auseinander, kein Jahrespaar; Wachstum nicht gezeigt.`;
  }
  if (window[0] !== ANNUAL_PAIR_MIN_DAYS) return null;
  const { code, priorLengthDays } = checkEnds(end, priorEnd, olderEnd);
  if (code === 'adjacent') return null;
  return `Das Vorjahr bis ${dayDe(priorEnd)} endet ${priorLengthDays} Tage nach dem Abschluss ${dayDe(olderEnd)}, ein volles Jahr ist nicht belegt; Wachstum nicht gezeigt.`;
}

/**
 * Period gate of one stored annual pair: the one guard for every reader of annualRev, annualGP and the like.
 * @param {object} snapshot Prepared snapshot.
 * @param {string} field Annual field registered in norm().
 * @param {number} iNew Selected newer position.
 * @param {number} iOld Selected older position.
 * @returns {string|null} German reason, or null when the pair may be shown.
 */
function annualPairGateReason(snapshot, field, iNew, iOld) {
  const ends = annualPeriodEnds(snapshot, field);
  return periodGateReason('year', ends[iNew], ends[iOld], ends[nextDistinctAnnualIndex(norm(snapshot, field), ends, iOld)]);
}
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
 * Finds the next stored position after duplicates of one fixed annual entry.
 * @param {Array<number|null>} values Annual values normalized by norm().
 * @param {Array<string|null>} ends Aligned annual period ends.
 * @param {number} index Selected older position, retained as the duplicate anchor.
 * @returns {number} First nonduplicate position, or values.length if none remains.
 */
function nextDistinctAnnualIndex(values, ends, index) {
  const older = _tagesnummer(ends[index]);
  let next = index + 1;
  while (Number.isFinite(values[index]) && values[next] === values[index] && older !== null) {
    const prior = _tagesnummer(ends[next]);
    if (prior === null || Math.abs(older - prior) >= ANNUAL_PAIR_MIN_DAYS) break;
    next++;
  }
  return next;
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
  return checkEnds(ends[iNew], ends[iOld], ends[nextDistinctAnnualIndex(norm(snapshot, field), ends, iOld)]);
}

/**
 * Judges the existing newer-year record, including its stored prior-year length if dated.
 * @param {object} snapshot Prepared snapshot.
 * @param {object} record Already validated by annualLegNewerYear.
 * @returns {{code:string, distanceDays:number|null, priorLengthDays:number|null}} Date verdict.
 */
function checkNewerAnnualPair(snapshot, record) {
  return checkEnds(record.end, record.priorEnd, newerRecordOlderEnd(snapshot, record));
}

/**
 * Stored end before the prior year of a newer-year record, null when the prior year is not in the stored series.
 * @param {object} snapshot Prepared snapshot.
 * @param {object} record Already validated by annualLegNewerYear.
 * @returns {string|null} ISO end or null.
 */
function newerRecordOlderEnd(snapshot, record) {
  const ends = annualPeriodEnds(snapshot, 'annualRev');
  const priorDay = _tagesnummer(record.priorEnd);
  const index = priorDay === null ? -1 : ends.findIndex((end) => _tagesnummer(end) === priorDay);
  return index < 0 ? null : ends[nextDistinctAnnualIndex(norm(snapshot, 'annualRev'), ends, index)] ?? null;
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
  // An undated pair passes, but must stay visible for the [period-gate-undated] watcher of the export.
  return pairs.find((pair) => !annualPairPasses(pair)) || pairs.find((pair) => pair.code === 'undated') || pairs[0];
}

// Same branch eligibility as revAcceleration; no quarterly partner or formula is changed. Returns the source of the
// branch: 'position' when a counted pair has no dated partner, 'datum' otherwise, null when the annual fallback carries.
// ponytail: the shadow ignores revAcceleration's 6M against 3M test; no such quarter exists on 30.10. (70,546 cells all 3M).
function quarterlyAccelerationSource(snapshot) {
  const values = norm(snapshot, 'revenueQ');
  let pairs = 0, source = 'datum';
  for (let i = 0; i < values.length; i++) {
    const partner = jahresVergleichIdx(snapshot, 'revenueQ', i);
    if (partner && values[i] > 0 && values[partner.idx] > 0) {
      pairs++;
      if (partner.quelle === 'position') source = 'position';
    }
  }
  return pairs >= 2 ? source : null;
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
    case 'undated': return axis === 'growth' ? 'Ohne gültige Periodenenden beim Anbieter ist der Zeitraum nicht belegt; kein Wert.'
      : 'Ohne gültige Periodenenden beim Anbieter, die heutige Rechnung bleibt.';
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
  const axes = require('../src/scoring/axes.js');
  const { revGrowthLeg } = require('./rev-growth-basis.js');
  return withAnnualPairRule({ growth: false, acceleration: false }, () => {
    const ends = annualPeriodEnds(snapshot, 'annualRev');
    const gpEnds = annualPeriodEnds(snapshot, 'annualGP');
    const values = norm(snapshot, 'annualRev');
    const record = axes.revQuartalsYoY(snapshot) === null ? axes.annualLegNewerYear(snapshot) : null;
    const growth = record ? checkNewerAnnualPair(snapshot, record)
      : axes.revAnnualYoY(snapshot) === null ? emptyCheck('no-annual-pair') : checkAnnualPair(snapshot, 'annualRev', 0, 1);
    const gp = norm(snapshot, 'annualGP');
    const grossProfit = Number.isFinite(gp[0]) && gp[1] > 0 ? checkAnnualPair(snapshot, 'annualGP', 0, 1) : emptyCheck('no-annual-pair');
    const quarterly = quarterlyAccelerationSource(snapshot);
    const acceleration = quarterly === 'position' ? emptyCheck('undated') : quarterly ? emptyCheck('no-annual-pair') : checkAnnualAcceleration(snapshot);
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

module.exports = { ANNUAL_PAIR_MIN_DAYS, ANNUAL_PAIR_MAX_DAYS, MISSING_YEAR_MIN_DAYS, YOY_PAIR_MIN_DAYS, YOY_PAIR_MAX_DAYS, periodGateReason,
  annualPairGateReason, newerRecordOlderEnd,
  _tagesnummer, annualPeriodEnds, withAnnualPairRule, annualPairRuleEnabled, annualPairPasses, nextDistinctAnnualIndex, checkAnnualPair,
  checkNewerAnnualPair, checkAnnualAcceleration, annualPairsShadow };
