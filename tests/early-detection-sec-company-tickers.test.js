'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('SEC company ticker adapter parses both official schemas and exact quarters', () => {
  const script = path.join(__dirname, '..', 'scripts', 'early-detection-sec-company-tickers.py');
  const run = spawnSync(process.env.PYTHON || 'python', [script, 'self-test'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout);
  assert.equal(result.status, 'PASS');
  assert.equal(result.companyTickersRows, 1);
  assert.equal(result.companyTickersExchangeRows, 1);
  assert.equal(result.gzipTransportVerified, true);
  assert.equal(result.selectedCaptures, 2);
  assert.equal(result.signedReportVerified, true);
  assert.equal(result.hexDigestVerified, true);
  assert.equal(result.exactDuplicateRowsVerified, true);
});
