'use strict';

// T204 measurement plane for the writers that cannot safely be reached through
// their production mains. Every target script is copied byte-for-byte into a
// fresh OS temp tree and required (never executed as main). A child harness then
// calls only the exported writer seams with pinned, explicitly synthetic data.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures', 't204-write-reachability');
const PAYLOAD_FILE = path.join(FIXTURES, 'payloads.json');
const RUNNER_FILE = path.join(FIXTURES, 'fixture-runner.js');

// Filled with literal SHA-256 values after the additive fixtures are written.
// These pins make any payload/harness drift an explicit review event.
const FIXTURE_SHA256 = {
  'README.md': '0f4a5ddfe14e8345f43c48e8eabdf856f8b35612d17fd3789589b345fa8afec4',
  'fixture-runner.js': '1110763e4321a01a22253a8dfa912f9d5ace26ab39d77ac7f84d5dea2ff63762',
  'payloads.json': '5bc6657a94dc8d71e40f4ca8139732cad9a1b398a4db31049f62991450f6f294',
};

const EXPECTED_BYTE_SHA256 = {
  b1DryRun: '3d8136385a7c94424e31da5df01010c95cfffee4a553b8cd2bad0a4e6b162aa0',
  b1Full: '882b85ff9ea01e2b3677b6e1094ffa2c39d601a9added0903bf096454da8f428',
  d2Probe: '2b9102f5e066bd7f1b9b7e0bd988344ab8fdb1439a217f41bf17ef5096f4c320',
  d2EntryStamp: '457277ed665919530b4cae9184bc58e7cefc1f6b8680ec29b3e0da0e8b641938',
  d2ReportJson: '666164aa929a0781803dab904b72ec2ce266acd9fc272d9712b2e3c6f704f330',
  d2ReportMarkdown: 'eef67c08926c356ba3cbd6352e16c69a8203d1d78a2cbddd7088da505b38b96c',
  d2ScanStats: '9102412369ea09b29b6282cea030923f72e689908b4264325afb65efb32b2e7e',
  gqsShadow: '42306bbe4245fab2cf1b745312dc60db3dde443a750c7730b83020f17cee4c66',
};

const SCRIPT_BY_SCENARIO = {
  b1: 'b1-validate.js',
  d2: 'd2-submissions-bulk.js',
  gqs: 'early-detection-gqs-shadow.js',
};

function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function sha256File(file) {
  return sha256Bytes(fs.readFileSync(file));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function compactJsonLine(value) {
  return JSON.stringify(value) + '\n';
}

function makeFixtureTree(scenario) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't204-' + scenario + '-'));
  for (const relative of [
    'scripts', 'fixture', 'artifacts', 'store',
    path.join('redirected-vault', 'agent-reports'),
  ]) fs.mkdirSync(path.join(root, relative), { recursive: true });

  const sourceScript = path.join(REPO, 'scripts', SCRIPT_BY_SCENARIO[scenario]);
  const copiedScript = path.join(root, 'scripts', SCRIPT_BY_SCENARIO[scenario]);
  const copiedRunner = path.join(root, 'fixture', 'fixture-runner.js');
  const copiedPayloads = path.join(root, 'fixture', 'payloads.json');
  fs.copyFileSync(sourceScript, copiedScript);
  fs.copyFileSync(RUNNER_FILE, copiedRunner);
  fs.copyFileSync(PAYLOAD_FILE, copiedPayloads);

  assert.deepEqual(fs.readFileSync(copiedScript), fs.readFileSync(sourceScript),
    scenario + ': copied script must remain byte-identical');
  assert.equal(sha256File(copiedRunner), FIXTURE_SHA256['fixture-runner.js']);
  assert.equal(sha256File(copiedPayloads), FIXTURE_SHA256['payloads.json']);
  return { root, copiedScript, copiedRunner, copiedPayloads };
}

function runScenario(scenario) {
  const tree = makeFixtureTree(scenario);
  const run = spawnSync(process.execPath, [
    tree.copiedRunner, scenario, tree.copiedScript, tree.copiedPayloads, tree.root,
  ], {
    cwd: tree.root,
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, T204_SYNTHETIC_ONLY: '1' },
  });
  assert.equal(run.status, 0,
    scenario + ': writer-only child must pass\nstdout:\n' + run.stdout + '\nstderr:\n' + run.stderr);
  const trace = readJson(path.join(tree.root, 'trace.json'));
  assert.deepEqual(trace.networkAttempts, [], scenario + ': network must remain unreachable');
  assert.deepEqual(trace.childProcessAttempts, [], scenario + ': child processes/scoring must remain unreachable');
  return { ...tree, trace, stdout: run.stdout };
}

function assertExactFile(file, expectedText, expectedHash) {
  const actual = fs.readFileSync(file, 'utf8');
  assert.equal(actual, expectedText, file + ': exact bytes changed');
  assert.equal(sha256Bytes(Buffer.from(actual, 'utf8')), expectedHash,
    file + ': pinned output hash changed');
}

test('T204 synthetic fixture files are complete and hash-pinned', () => {
  assert.deepEqual(fs.readdirSync(FIXTURES).sort(), Object.keys(FIXTURE_SHA256).sort());
  for (const [name, expected] of Object.entries(FIXTURE_SHA256)) {
    assert.equal(sha256File(path.join(FIXTURES, name)), expected, name + ': fixture drift');
  }
  const payloads = readJson(PAYLOAD_FILE);
  assert.equal(payloads.synthetic, true);
  assert.equal(payloads.containsStudyInputs, false);
  assert.equal(payloads.containsOutcomes, false);
  assert.equal(payloads.containsSecData, false);
  assert.deepEqual(payloads.scope.coveredWriterCalls, {
    b1ValidationReports: 2,
    d2Artifacts: 5,
    gqsShadowReports: 1,
  });
  assert.equal(payloads.scope.deferred.length, 1,
    'B1 submissions-cache site stays explicit instead of being reached through the forbidden fetch path');
});

test('B1 byte-copy reaches both exported report writers with exact pretty-JSON bytes', () => {
  const payloads = readJson(PAYLOAD_FILE);
  const run = runScenario('b1');
  assert.deepEqual(run.trace.invoked, ['writeValidationReport', 'writeValidationReport']);
  assert.equal(run.trace.fixedVaultRedirects, 0);
  assert.deepEqual(run.trace.writes.map((row) => row.path), [
    'artifacts/b1-dryrun.json',
    'artifacts/b1-full.json',
  ]);
  assertExactFile(path.join(run.root, 'artifacts', 'b1-dryrun.json'),
    prettyJson(payloads.b1.dryRunReport), EXPECTED_BYTE_SHA256.b1DryRun);
  assertExactFile(path.join(run.root, 'artifacts', 'b1-full.json'),
    prettyJson(payloads.b1.fullReport), EXPECTED_BYTE_SHA256.b1Full);
  assert.deepEqual(readJson(path.join(run.root, 'artifacts', 'b1-dryrun.json')), payloads.b1.dryRunReport);
  assert.deepEqual(readJson(path.join(run.root, 'artifacts', 'b1-full.json')), payloads.b1.fullReport);
});

test('D2 byte-copy reaches all five exported artifact writers and redirects the fixed Vault constant', () => {
  const payloads = readJson(PAYLOAD_FILE);
  const run = runScenario('d2');
  assert.deepEqual(run.trace.invoked, [
    'writeProbeArtifact',
    'writeEntryStamp',
    'writeReportJson',
    'writeReportMarkdown',
    'writeScanStats',
  ]);
  assert.equal(run.trace.fixedVaultRedirects, 1,
    'D2 fixed Vault constant must be redirected during module load');
  assert.deepEqual(run.trace.writes.map((row) => row.path), [
    'store/d2-0-probe.json',
    'store/entry-stamp.json',
    'redirected-vault/agent-reports/d2-report.json',
    'redirected-vault/agent-reports/d2-report.md',
    'store/d2-2-scan.json',
  ]);

  const cases = [
    ['store/d2-0-probe.json', prettyJson(payloads.d2.probe), EXPECTED_BYTE_SHA256.d2Probe],
    ['store/entry-stamp.json', prettyJson(payloads.d2.entryStamp), EXPECTED_BYTE_SHA256.d2EntryStamp],
    ['redirected-vault/agent-reports/d2-report.json', prettyJson(payloads.d2.reportJson), EXPECTED_BYTE_SHA256.d2ReportJson],
    ['redirected-vault/agent-reports/d2-report.md', payloads.d2.reportMarkdown, EXPECTED_BYTE_SHA256.d2ReportMarkdown],
    ['store/d2-2-scan.json', prettyJson(payloads.d2.scanStats), EXPECTED_BYTE_SHA256.d2ScanStats],
  ];
  for (const [relative, expectedText, expectedHash] of cases) {
    assertExactFile(path.join(run.root, ...relative.split('/')), expectedText, expectedHash);
  }
});

test('GQS byte-copy reaches the exported shadow writer with exact compact JSON plus LF', () => {
  const payloads = readJson(PAYLOAD_FILE);
  const run = runScenario('gqs');
  assert.deepEqual(run.trace.invoked, ['writeShadowReport']);
  assert.equal(run.trace.fixedVaultRedirects, 0);
  assert.deepEqual(run.trace.writes.map((row) => row.path), ['artifacts/gqs-shadow.json']);
  const file = path.join(run.root, 'artifacts', 'gqs-shadow.json');
  assertExactFile(file, compactJsonLine(payloads.gqs.shadowReport), EXPECTED_BYTE_SHA256.gqsShadow);
  assert.deepEqual(readJson(file), payloads.gqs.shadowReport);
});
