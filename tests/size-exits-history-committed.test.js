'use strict';
// P155 c: read the committed state/size-exits-history.json exactly as the merge job does.
// A corrupt or missing file aborts or silently resets the daily merge, so the test run fails first.
// Read only: break-once feeds corrupted copies through an injected reader, never the live file.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { readSizeExitHistory, sizeExitsHistoryPath } = require('../lib/size-exits.js');

const live = sizeExitsHistoryPath();
const hash = () => crypto.createHash('sha256').update(fs.readFileSync(live)).digest('hex');
const before = hash();
const { exits, raw } = readSizeExitHistory(live);
assert.notEqual(raw, null, 'state/size-exits-history.json must stay committed; without it the merge starts an empty history');
if (process.argv.includes('--break-once')) {
  for (const [name, bad] of [['truncated', raw.slice(0, -2)],
    ['schema', raw.replace('"size-exits-history/v1"', '"size-exits-history/v0"')],
    ['record', raw.replace('"exits":[', '"exits":[{"ticker":"BAD"},')]]) {
    assert.notEqual(bad, raw, 'mutation ' + name + ' must change the bytes');
    assert.throws(() => readSizeExitHistory(live, { readFileSync: () => bad }), /./, name);
    console.log('BREAK_ONCE committed-history ' + name + ' detected=true');
  }
}
assert.equal(hash(), before, 'the live history is read only');
console.log(`PASS committed size-exit history: ${exits.length} exits valid under readSizeExitHistory`);
