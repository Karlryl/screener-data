'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('SEC concept coverage audit passes its complete fixture', () => {
  const script = path.join(__dirname, '..', 'scripts', 'early-detection-concept-audit.py');
  const run = spawnSync(process.env.PYTHON || 'python', [script, 'self-test'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout);
  assert.equal(result.status, 'PASS');
  assert.equal(result.roles, 9);
  assert.match(result.reportSha256, /^[0-9a-f]{64}$/);
  const mapPath = path.join(__dirname, '..', 'research', 'early-detection-v4', 'sec-concept-map-1.0.0.json');
  const seal = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'research', 'early-detection-v4', 'sec-concept-map-1.0.0-seal.json'), 'utf8'));
  const checkoutBytes = fs.readFileSync(mapPath);
  const checkoutText = checkoutBytes.toString('utf8');
  assert.equal(/\r(?!\n)/.test(checkoutText), false,
    'sealed JSON may use LF or checkout-transformed CRLF, never lone CR bytes');
  const normalizedBytes = Buffer.from(checkoutText.replace(/\r\n/g, '\n'), 'utf8');
  const hash = crypto.createHash('sha256').update(normalizedBytes).digest('hex');
  assert.equal(hash, seal.artifact.sha256);
  assert.equal(seal.version, 'FEM-SEC-CONCEPT-MAP@1.0.0');
});
