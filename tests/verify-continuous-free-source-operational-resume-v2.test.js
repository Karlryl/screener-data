#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'verify-continuous-free-source-operational-resume-v2.py');
const contract = path.join(root, 'research', 'early-detection-v4', 'continuous-free-source-operational-resume-contract-v2.json');
const test = __filename;
const EXPECTED_RAW = '084bbfc27e10bbb444c369bb488ddf60d6ed4c1547a2a5c807f700862a70eb5d';
const EXPECTED_SELF = '9a24cea57cbc5340e88836399fee297ad186de5fd00c058a3ea206626d8eaa1b';
const EXPECTED_SCRIPT_NORMALIZED = '1afcdb9ab3f9dd0809108e55abbba80298722ff340aa1c383d3854b40b69fea9';
const EXPECTED_TEST_NORMALIZED = 'c31fa49c1a3139a0302ab9696bc856c4a2bbdbb67e2bb164015def46bf8e464a';

function sha(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalized(file) {
  let raw = fs.readFileSync(file, 'utf8');
  for (const token of [EXPECTED_SCRIPT_NORMALIZED, EXPECTED_TEST_NORMALIZED]) {
    raw = raw.split(token).join('0'.repeat(64));
  }
  return sha(Buffer.from(raw, 'utf8'));
}

const raw = fs.readFileSync(contract);
assert.equal(sha(raw), EXPECTED_RAW);
const value = JSON.parse(raw);
const claim = value.resumeSha256;
delete value.resumeSha256;
assert.equal(claim, EXPECTED_SELF);
assert.equal(sha(Buffer.from(canonical(value), 'utf8')), EXPECTED_SELF);
assert.equal(normalized(script), EXPECTED_SCRIPT_NORMALIZED);
assert.equal(normalized(test), EXPECTED_TEST_NORMALIZED);

const expectedKills = [
  'falseCapabilityCompletion',
  'form345IntervalOverclaim',
  'milestoneHashDrift',
  'milestoneRemoval',
  'originalV4GateCredit',
  'outcomeAccess',
  'quantConnectReactivation',
  'queueOrder',
  'remoteBinding',
  'terminalWealthOverclaim',
  'userActionBypass',
  'v1MilestoneDrift',
];

for (const optimized of [false, true]) {
  const prefix = optimized ? ['-O', '-B', script] : ['-B', script];
  for (const command of ['verify', 'self-test']) {
    const run = spawnSync(process.env.PYTHON || 'python', [...prefix, command, '--remote'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const result = JSON.parse(run.stdout.trim());
    assert.equal(result.status, 'PASS');
    assert.equal(result.phase, 'PRE_INTRODUCTION');
    assert.equal(result.outcomesAccessed, false);
    if (command === 'verify') {
      assert.equal(result.milestones, 9);
      assert.equal(result.inheritedV1Milestones, 6);
      assert.equal(result.newMilestones, 3);
      assert.equal(result.autonomousNextActions, 4);
      assert.equal(result.blockedByRights, 1);
      assert.equal(result.userActionRequired, 3);
      assert.equal(result.originalV4GreenOfficialGates, 2);
      assert.equal(result.originalV4OfficialGateCount, 13);
    } else {
      assert.deepEqual(Object.keys(result.kills).sort(), expectedKills);
      assert.deepEqual(new Set(Object.values(result.kills)), new Set([true]));
    }
  }
}

console.log('verify-continuous-free-source-operational-resume-v2.test.js: PASS');
