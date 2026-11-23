'use strict';
// Runs a block on a fixed data day (RUN_DATE_UTC), so tests of a comparison arm (lib/comparison-ends.js) do not depend
// on the wall clock: tests of the old calculation pin a day before the arm's end, tests of the end pin one after it.
function onDay(day, fn) {
  const before = process.env.RUN_DATE_UTC;
  process.env.RUN_DATE_UTC = day;
  try { return fn(); } finally { if (before === undefined) delete process.env.RUN_DATE_UTC; else process.env.RUN_DATE_UTC = before; }
}

// Last data day on which the G31 legacy comparison is still exported (its end is 2026-11-16).
const G31_LEGACY_SHOWN_DAY = '2026-11-13';

module.exports = { onDay, G31_LEGACY_SHOWN_DAY };
