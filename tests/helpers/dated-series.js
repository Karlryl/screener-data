'use strict';
// Period gate round 2 (30.10.2026): a growth pair without period ends is empty in production. Fixtures written before
// the ends existed test other things, so they get what a gapless reporter stores: one year or one quarter per position.
// A series with at least one stored end stays as it is. A test whose subject is a missing end does not use this helper.

const monthEnd = (year, month) => new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
function endsBack(newest, count, stepMonths) {
  const year = Number(newest.slice(0, 4)), month = Number(newest.slice(5, 7));
  return Array.from({ length: count }, (_, i) => monthEnd(year, month - i * stepMonths));
}
function fill(container, newest, stepMonths) {
  if (!container) return;
  for (const [key, value] of Object.entries(container)) {
    if (!Array.isArray(value) || !value.length || key.endsWith('Ends') || container[key + 'Ends']?.some?.(end => end !== null)) continue;
    container[key + 'Ends'] = endsBack(newest, value.length, stepMonths);
  }
}

/**
 * Adds the missing end lists, in place.
 * @param {object} snapshot Fixture snapshot.
 * @param {string} [newestYear] End of annual position 0.
 * @param {string} [newestQuarter] End of quarterly position 0.
 * @returns {object} The same snapshot.
 */
function withEnds(snapshot, newestYear = '2025-12-31', newestQuarter = '2025-12-31') {
  if (snapshot && typeof snapshot === 'object') {
    fill(snapshot.annual, newestYear, 12);
    fill(snapshot.timeseries, newestQuarter, 3);
  }
  return snapshot;
}

/**
 * The same module, with every function dating a copy of its first argument (one snapshot or a list of them).
 * @param {object} api Module exports.
 * @returns {object} Wrapped exports.
 */
function datedApi(api) {
  return new Proxy(api, {
    get(target, key) {
      const value = target[key];
      if (typeof value !== 'function') return value;
      return (first, ...rest) => value(Array.isArray(first)
        ? first.map(s => withEnds(structuredClone(s)))
        : withEnds(first && typeof first === 'object' ? structuredClone(first) : first), ...rest);
    },
  });
}

module.exports = { withEnds, datedApi };
