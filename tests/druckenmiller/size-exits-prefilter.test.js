'use strict';
/** tests/druckenmiller/size-exits-prefilter.test.js — Standalone-Runner.
 *
 * The size-exit reports of the daily pull (_manifest-size-exits*.json) sit beside the ticker
 * snapshots. The Druckenmiller candidate scan reads that folder, so its filename prefilter
 * must never treat a report as a ticker. Lives here because only tests/druckenmiller may
 * import lib/druckenmiller (import-graph.test.js G3).
 */
const assert = require('node:assert/strict');
const { filenameMayBeCandidate } = require('../../lib/druckenmiller/universe.js');
const { SIZE_EXITS_FILE } = require('../../lib/size-exits.js');

for (const name of [SIZE_EXITS_FILE, '_manifest-size-exits.shard-0.run-123456-2.json', '_manifest-size-exits.shard-unsharded.run-1-1.json']) {
  assert.equal(filenameMayBeCandidate(name), false, name + ' must not be a candidate file');
}
assert.equal(filenameMayBeCandidate('AAPL.json'), true, 'a real ticker file stays a candidate');
console.log('size-exits-prefilter.test.js: all passed');
