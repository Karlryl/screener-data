'use strict';

const assert = require('node:assert/strict');
const shared = require('../lib/sec-rate-limit.js');

const clients = [
  require('../pull-sec-xbrl.js'),
  require('../scripts/pull-insider-form4.js'),
  require('../scripts/pull-insider-form4-daily.js'),
  require('../scripts/pull-13f-institutional.js'),
];

assert.deepEqual(shared, { RATE_DELAY_MS: 125, RATE_LIMIT_BACKOFF_MS: 30000 });
for (const client of clients) {
  assert.strictEqual(client._secRateLimit, shared,
    'jeder SEC-Puller muss dasselbe Konfigurationsobjekt verwenden');
}

console.log('sec-rate-limit: 5 ok, 0 fail');
