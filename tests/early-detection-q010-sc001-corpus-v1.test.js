const assert = require('assert');
const { spawnSync } = require('child_process');

const controller = 'scripts/early-detection-q010-sc001-corpus-v1.py';

function run(args, optimized = false, expectedSuccess = true) {
  const pythonArgs = optimized ? ['-O', '-B', controller, ...args] : ['-B', controller, ...args];
  const result = spawnSync('python', pythonArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 90000,
  });
  assert.equal(result.error, undefined, `process error: ${result.error && result.error.message}`);
  assert.notEqual(result.status, null, 'process timed out');
  if (expectedSuccess) {
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return JSON.parse(result.stdout);
  }
  assert.notEqual(result.status, 0, 'expected fail-closed nonzero exit');
  return JSON.parse(result.stderr);
}

for (const optimized of [false, true]) {
  const self = run(['self-test'], optimized, true);
  assert.equal(self.status, 'PASS');
  assert.equal(self.killCount, 33);

  const noRemote = run(['verify'], optimized, false);
  assert.equal(noRemote.status, 'FAIL');
  assert.match(noRemote.error, /--remote is mandatory/);

  const verified = run(['verify', '--remote'], optimized, true);
  assert.ok(['PRE_INTRODUCTION_DIAGNOSTIC', 'PASS'].includes(verified.status));
  if (verified.phase === 'PRE_INTRODUCTION') {
    assert.equal(verified.status, 'PRE_INTRODUCTION_DIAGNOSTIC');
  } else {
    assert.equal(verified.phase, 'POST_INTRODUCTION');
    assert.equal(verified.status, 'PASS');
  }
  assert.equal(verified.chunkStatus, 'TYPED_HOLD_COMPLETED');
  assert.equal(verified.sourceCount, 12);
  assert.equal(verified.treatmentPopulationCount, 7);
  assert.equal(verified.resolvedListedTreatmentEntities, 1);
  assert.equal(verified.typedIdentityHolds, 6);
  assert.equal(verified.controlPopulationStatus, 'REJECTED_HOLD');
  assert.deepEqual(verified.provisionalTEL, { T: 2, E: 2, L: 1 });
  assert.equal(verified.candidateState, null);
  assert.equal(verified.candidateStateComputationAllowed, false);
  assert.equal(verified.blindingIncidentRecorded, true);
  assert.equal(verified.privatePayloadsPublished, false);
  assert.equal(verified.privatePayloadsVerified, false);
  assert.equal(verified.outcomeFilesOpened, false);
  assert.equal(verified.returnsAccessed, false);
  assert.equal(verified.gqsAccessed, false);
  assert.equal(verified.scientificCredit, 'NONE');
  assert.equal(verified.nextQ010SubchunkAuthorized, false);
  assert.equal(verified.q003SchedulerEligible, false);
  assert.equal(verified.controllerChildExecutions, 0);

  const status = run(['status', '--remote'], optimized, true);
  assert.deepEqual(status, verified);
}

console.log(JSON.stringify({ status: 'PASS', gate: 'Q010_SC001_CORPUS_V1_NODE', modes: ['normal', 'optimized'] }));
