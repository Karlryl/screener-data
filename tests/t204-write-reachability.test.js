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
  'README.md': '73efa286e1c6b97e083e1f8670d53bcfb06aa440406a8473653f5eb5b0f79fce',
  'fixture-runner.js': 'cac5def23eaeca11816d25467c94b0c33dff3cec8b4fec4bf6c805dd4415ffbc',
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

const WRITER_TARGETS = [
  { key: 'b1-dry', scenario: 'b1', helper: 'writeValidationReport', path: 'artifacts/b1-dryrun.json', payload: ['b1', 'dryRunReport'], format: 'pretty', hash: 'b1DryRun' },
  { key: 'b1-full', scenario: 'b1', helper: 'writeValidationReport', path: 'artifacts/b1-full.json', payload: ['b1', 'fullReport'], format: 'pretty', hash: 'b1Full' },
  { key: 'd2-probe', scenario: 'd2', helper: 'writeProbeArtifact', path: 'store/d2-0-probe.json', payload: ['d2', 'probe'], format: 'pretty', hash: 'd2Probe' },
  { key: 'd2-stamp', scenario: 'd2', helper: 'writeEntryStamp', path: 'store/entry-stamp.json', payload: ['d2', 'entryStamp'], format: 'pretty', hash: 'd2EntryStamp' },
  { key: 'd2-report-json', scenario: 'd2', helper: 'writeReportJson', path: 'redirected-vault/agent-reports/d2-report.json', payload: ['d2', 'reportJson'], format: 'pretty', hash: 'd2ReportJson' },
  { key: 'd2-report-md', scenario: 'd2', helper: 'writeReportMarkdown', path: 'redirected-vault/agent-reports/d2-report.md', payload: ['d2', 'reportMarkdown'], format: 'raw', hash: 'd2ReportMarkdown' },
  { key: 'd2-scan', scenario: 'd2', helper: 'writeScanStats', path: 'store/d2-2-scan.json', payload: ['d2', 'scanStats'], format: 'pretty', hash: 'd2ScanStats' },
  { key: 'gqs-shadow', scenario: 'gqs', helper: 'writeShadowReport', path: 'artifacts/gqs-shadow.json', payload: ['gqs', 'shadowReport'], format: 'compact-line', hash: 'gqsShadow' },
];

const SENTINEL_PREFIX = 'T204_SENTINEL_MUST_SURVIVE:';

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

function payloadFor(payloads, spec) {
  return spec.payload.reduce((value, key) => value[key], payloads);
}

function expectedText(payloads, spec) {
  const payload = payloadFor(payloads, spec);
  if (spec.format === 'pretty') return prettyJson(payload);
  if (spec.format === 'compact-line') return compactJsonLine(payload);
  return payload;
}

function makeFixtureTree(scenario) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't204-' + scenario + '-'));
  for (const relative of [
    'scripts', 'lib', 'fixture', 'artifacts', 'store',
    path.join('redirected-vault', 'agent-reports'),
  ]) fs.mkdirSync(path.join(root, relative), { recursive: true });

  const sourceScript = path.join(REPO, 'scripts', SCRIPT_BY_SCENARIO[scenario]);
  const sourceAtomic = path.join(REPO, 'lib', 'atomic-write.js');
  const copiedScript = path.join(root, 'scripts', SCRIPT_BY_SCENARIO[scenario]);
  const copiedAtomic = path.join(root, 'lib', 'atomic-write.js');
  const copiedRunner = path.join(root, 'fixture', 'fixture-runner.js');
  const copiedPayloads = path.join(root, 'fixture', 'payloads.json');
  fs.copyFileSync(sourceScript, copiedScript);
  fs.copyFileSync(sourceAtomic, copiedAtomic);
  fs.copyFileSync(RUNNER_FILE, copiedRunner);
  fs.copyFileSync(PAYLOAD_FILE, copiedPayloads);

  assert.deepEqual(fs.readFileSync(copiedScript), fs.readFileSync(sourceScript),
    scenario + ': copied script must remain byte-identical');
  assert.deepEqual(fs.readFileSync(copiedAtomic), fs.readFileSync(sourceAtomic),
    scenario + ': copied atomic writer must remain byte-identical');
  assert.equal(sha256File(copiedRunner), FIXTURE_SHA256['fixture-runner.js']);
  assert.equal(sha256File(copiedPayloads), FIXTURE_SHA256['payloads.json']);
  return { root, copiedScript, copiedAtomic, copiedRunner, copiedPayloads };
}

function runScenario(scenario, options) {
  const settings = options || {};
  const tree = makeFixtureTree(scenario);
  const mode = settings.mode || 'normal';
  const targetKey = settings.targetKey || '';
  let sentinel = null;
  if (mode === 'break') {
    const spec = WRITER_TARGETS.find((row) => row.key === targetKey);
    assert.ok(spec && spec.scenario === scenario, 'invalid break target ' + scenario + '/' + targetKey);
    sentinel = SENTINEL_PREFIX + targetKey + '\n';
    fs.writeFileSync(path.join(tree.root, ...spec.path.split('/')), sentinel, 'utf8');
  }
  const run = spawnSync(process.execPath, [
    tree.copiedRunner, scenario, tree.copiedScript, tree.copiedPayloads, tree.root,
    mode, targetKey,
  ], {
    cwd: tree.root,
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, T204_SYNTHETIC_ONLY: '1' },
  });
  const trace = readJson(path.join(tree.root, 'trace.json'));
  assert.deepEqual(trace.networkAttempts, [], scenario + ': network must remain unreachable');
  assert.deepEqual(trace.childProcessAttempts, [], scenario + ': child processes/scoring must remain unreachable');
  if (mode !== 'break') {
    assert.equal(run.status, 0,
      scenario + ': writer-only child must pass\nstdout:\n' + run.stdout + '\nstderr:\n' + run.stderr);
  }
  return { ...tree, trace, status: run.status, stdout: run.stdout, stderr: run.stderr, sentinel };
}

function assertExactFile(file, expectedText, expectedHash) {
  const actual = fs.readFileSync(file, 'utf8');
  assert.equal(actual, expectedText, file + ': exact bytes changed');
  assert.equal(sha256Bytes(Buffer.from(actual, 'utf8')), expectedHash,
    file + ': pinned output hash changed');
}

function tmpResidue(root, targetPath) {
  const target = path.join(root, ...targetPath.split('/'));
  const directory = path.dirname(target);
  const prefix = path.basename(target) + '.tmp.';
  return fs.readdirSync(directory).filter((name) => name.startsWith(prefix));
}

function assertAtomicRuntimePath(run, spec) {
  const target = spec.path;
  const directWrites = run.trace.writeFileCalls.filter((row) => row.path === target);
  assert.deepEqual(directWrites, [], spec.key + ': target was passed directly to writeFileSync');

  const directOpens = run.trace.opens.filter((row) => row.write && row.path === target);
  assert.deepEqual(directOpens, [], spec.key + ': target was opened directly for writing');

  const tmpPrefix = target + '.tmp.';
  const tmpOpens = run.trace.opens.filter((row) => row.write && row.path.startsWith(tmpPrefix));
  assert.equal(tmpOpens.length, 1, spec.key + ': expected exactly one sibling tmp open');
  const tmpPath = tmpOpens[0].path;
  assert.equal(path.posix.dirname(tmpPath), path.posix.dirname(target),
    spec.key + ': tmp must be a sibling on the same filesystem');

  const tmpWrites = run.trace.writeSyncCalls.filter((row) => row.path === tmpPath);
  assert.ok(tmpWrites.length >= 1, spec.key + ': sibling tmp was opened but never written');

  const renames = run.trace.renames.filter((row) => row.target === target);
  assert.equal(renames.length, 1, spec.key + ': target must be exactly one rename destination');
  assert.equal(renames[0].source, tmpPath, spec.key + ': rename source must be the observed sibling tmp');
  assert.deepEqual(tmpResidue(run.root, target), [], spec.key + ': sibling tmp residue remains');
  return tmpPath;
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

test('B1 byte-copy reaches both report writers through observed sibling tmp renames', () => {
  const payloads = readJson(PAYLOAD_FILE);
  const run = runScenario('b1');
  assert.deepEqual(run.trace.invoked, ['writeValidationReport', 'writeValidationReport']);
  assert.equal(run.trace.fixedVaultRedirects, 0);
  for (const spec of WRITER_TARGETS.filter((row) => row.scenario === 'b1')) {
    assertAtomicRuntimePath(run, spec);
    assertExactFile(path.join(run.root, ...spec.path.split('/')),
      expectedText(payloads, spec), EXPECTED_BYTE_SHA256[spec.hash]);
  }
  assert.deepEqual(readJson(path.join(run.root, 'artifacts', 'b1-dryrun.json')), payloads.b1.dryRunReport);
  assert.deepEqual(readJson(path.join(run.root, 'artifacts', 'b1-full.json')), payloads.b1.fullReport);
});

test('D2 byte-copy reaches all five writers through observed sibling tmp renames', () => {
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
  for (const spec of WRITER_TARGETS.filter((row) => row.scenario === 'd2')) {
    assertAtomicRuntimePath(run, spec);
    assertExactFile(path.join(run.root, ...spec.path.split('/')),
      expectedText(payloads, spec), EXPECTED_BYTE_SHA256[spec.hash]);
  }
});

test('GQS byte-copy reaches the shadow writer through an observed sibling tmp rename', () => {
  const payloads = readJson(PAYLOAD_FILE);
  const run = runScenario('gqs');
  assert.deepEqual(run.trace.invoked, ['writeShadowReport']);
  assert.equal(run.trace.fixedVaultRedirects, 0);
  const spec = WRITER_TARGETS.find((row) => row.scenario === 'gqs');
  assertAtomicRuntimePath(run, spec);
  const file = path.join(run.root, ...spec.path.split('/'));
  assertExactFile(file, expectedText(payloads, spec), EXPECTED_BYTE_SHA256[spec.hash]);
  assert.deepEqual(readJson(file), payloads.gqs.shadowReport);
});

for (const scenario of Object.keys(SCRIPT_BY_SCENARIO)) {
  test(scenario + ': runtime guard rejects an executed direct-write twin', () => {
    const run = runScenario(scenario, { mode: 'direct' });
    assert.equal(run.status, 0,
      scenario + ': the direct-write twin must execute successfully before the guard rejects its path');
    assert.equal(run.trace.error, null, scenario + ': the direct twin itself must execute before rejection');
    for (const spec of WRITER_TARGETS.filter((row) => row.scenario === scenario)) {
      assert.deepEqual(run.trace.writeFileCalls.filter((row) => row.path === spec.path).map((row) => row.path),
        [spec.path], spec.key + ': direct-control writer did not touch the exact target');
      assert.throws(() => assertAtomicRuntimePath(run, spec), /passed directly to writeFileSync/,
        spec.key + ': runtime guard stayed green against direct fs.writeFileSync');
    }
  });
}

for (const spec of WRITER_TARGETS) {
  test(spec.key + ': EIO rename failure surfaces and preserves the sentinel target', () => {
    const run = runScenario(spec.scenario, { mode: 'break', targetKey: spec.key });
    assert.notEqual(run.status, 0, spec.key + ': failed rename must make the child fail');
    assert.match(run.stderr, /T204_EIO_RENAME/, spec.key + ': EIO must surface in stderr');
    assert.deepEqual(run.trace.invoked, [spec.helper]);
    assert.deepEqual(run.trace.invokedTargets, [{ key: spec.key, path: spec.path }]);
    assert.ok(run.trace.breakFailure, spec.key + ': trace did not name the failed rename');
    assert.equal(run.trace.breakFailure.target, spec.path);
    assert.equal(run.trace.breakFailure.code, 'EIO');
    assert.equal(run.trace.error && run.trace.error.code, 'EIO',
      spec.key + ': non-retryable EIO was swallowed or replaced');

    const tmpPath = assertAtomicRuntimePath(run, spec);
    assert.deepEqual(run.trace.unlinks.filter((row) => row.path === tmpPath), [{ path: tmpPath }],
      spec.key + ': failed sibling tmp must be cleaned exactly once');
    const target = path.join(run.root, ...spec.path.split('/'));
    assert.equal(fs.readFileSync(target, 'utf8'), run.sentinel,
      spec.key + ': failed rename changed the prior sentinel target');
  });
}
