'use strict';
// Pinned FX table for tests that convert snapshots through pull-yahoo.js (P251).
//
// WHY: pull-yahoo.js builds its live FX table from the repository's fx-rates.json at module load and
// falls back to the hard-coded table when that file is older than FX_STALE_DAYS (14 days), missing or
// unreadable; the hard-coded table has no ARS and no NZD. The daily pull is the only writer of the file
// and it runs AFTER the blocking test gate, so a test that reads the live table turns red once the pull
// has been red for about two weeks (or the clock simply runs on) and then blocks the very pull that
// would refresh the file again.
//
// WHAT: pinFx() overwrites the exported LIVE tables (_FX_TO_USD, _FX_PROVENANCE) with the fixed rates of
// pinned-rates.json, whatever the module found at load, and proves through the production lookup
// (_fxFactorFor) that the pin is the table the converter reads. pull-yahoo.js itself is untouched.
// Call it once, right after requiring pull-yahoo.js and before the first conversion.
const assert = require('assert/strict');
const pull = require('../../../pull-yahoo.js');
const { rates } = require('./pinned-rates.json');

function pinFx() {
  const table = pull._FX_TO_USD;
  const provenance = pull._FX_PROVENANCE;
  for (const k of Object.keys(table)) delete table[k];
  for (const k of Object.keys(provenance)) delete provenance[k];
  for (const [k, rate] of Object.entries(rates)) { table[k] = rate; provenance[k] = 'live'; }
  // If the export ever becomes a copy of the converter's table, the tests would silently be back on the
  // live file (and still green while live and pinned rates agree). Ask the converter's own lookup for a
  // currency no real table has: only the table it really reads can answer.
  table.XPIN = 0.5; provenance.XPIN = 'live';
  const probe = pull._fxFactorFor('XPIN');
  delete table.XPIN; delete provenance.XPIN;
  assert.ok(probe && probe.factorMajorUnit === 0.5, 'FX pin is not in force: _FX_TO_USD is not the table the converter reads');
}

module.exports = { pinFx, PINNED_RATES: rates };
