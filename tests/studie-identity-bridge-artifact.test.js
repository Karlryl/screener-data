'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const REPO = path.join(__dirname, '..');
const SCRIPT = path.join(REPO, 'scripts', 'studie-identity-bridge-artifact.py');
const PREREG = path.join(REPO, 'protocol', 'early-detection', '2.0.0',
  'r2-a1-identity-bridge-artifact-preregistration.json');
const CORRECTION = path.join(REPO, 'protocol', 'early-detection', '2.0.0',
  'r2-a1-blocker1-identity-protection-correction.json');
const DETERMINISM_CORRECTION = path.join(REPO, 'protocol', 'early-detection', '2.0.0',
  'r2-a1-blocker2-independent-rebuild-correction.json');
const ARTIFACT = path.join(REPO, 'reports', 'studie',
  'R2-A1-identity-bridge-panel-v1.json');
const RESULT = path.join(REPO, 'reports', 'studie',
  'R2-A1-identity-bridge-artifact-2026-08-25.json');
const REPORT = path.join(REPO, 'reports', 'studie',
  'R2-A1-identity-bridge-artifact-2026-08-25.md');
const PROOF = path.join(REPO, 'reports', 'studie',
  'R2-A1-cross-seam-sabotage-2026-08-25.json');
const ID_PROOF = path.join(REPO, 'reports', 'studie',
  'R2-A1-public-identity-inversion-proof-2026-08-25.json');
const ID_SABOTAGE = path.join(REPO, 'reports', 'studie',
  'R2-A1-public-identity-inversion-sabotage-2026-08-25.json');
const INDEPENDENT_PROOF = path.join(REPO, 'reports', 'studie',
  'R2-A1-independent-rebuild-proof-2026-08-25.json');
const INDEPENDENT_SABOTAGE = path.join(REPO, 'reports', 'studie',
  'R2-A1-independent-rebuild-sabotage-2026-08-25.json');

const REQUIRED = [
  'Registration is frozen before R2-A1 fact access',
  'Production fact query excludes every numeric and result column',
  'Exact CIK and normalized-name continuity is eligible',
  'Explicit rename chain is eligible',
  'Ambiguous name evidence is rejected',
  'Same-unit source change creates a semantic seam',
  'Unit change is not bridged',
  'Each identifier maps to exactly one entity',
  'Default derived calculation stops at the seam',
  'Explicit cross-seam calculation carries all markers',
  'Unmarked cross-seam calculation is rejected',
  'Unknown cross-seam calculation is rejected',
  'Canonical hash is independent of input ordering',
  'Raw company identity is absent from the artifact',
  'Date-wall violation is rejected',
  'Canonical payload hash mismatch is rejected',
  'Same-process canonical serialization is stable',
  'HMAC entity IDs change when the unseen key changes',
  'Secure fixture IDs resist the public legacy namespace attack',
  'Legacy reversible fixture IDs are recovered by the public watcher',
  'Independent comparator accepts two distinct complete build records',
  'Independent comparator rejects one mismatched rebuild fingerprint',
];

test('R2-A1: fixture self-test is named, countable, and green', () => {
  const run = spawnSync(process.env.PYTHON || 'python', [SCRIPT, '--self-test'], {
    cwd: REPO,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  const green = new Set(run.stdout.split(/\r?\n/)
    .filter((line) => /^\s{2}ok\s{4}/.test(line))
    .map((line) => line.replace(/^\s{2}ok\s{4}/, '').trim()));
  assert.deepEqual(REQUIRED.filter((name) => !green.has(name)), []);
  assert.equal(green.size, REQUIRED.length);
  assert.match(run.stdout, /SELBSTTEST GREEN - 22 named checks/);
});

test('R2-A1: deliberate unmarked cross-seam calculation fails red', () => {
  const run = spawnSync(process.env.PYTHON || 'python',
    [SCRIPT, '--sabotage-cross-seam'], { cwd: REPO, encoding: 'utf8' });
  assert.notEqual(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(`${run.stdout}\n${run.stderr}`,
    /SABOTAGE RED: Unmarked cross-seam derived calculation/);
});

test('R2-A1: registration freezes statistic, null, threshold, and seam contract', () => {
  const prereg = JSON.parse(fs.readFileSync(PREREG, 'utf8'));
  assert.equal(prereg.status, 'FROZEN_BEFORE_R2_A1_FACT_ACCESS');
  assert.match(prereg.testStatistic.primary, /contract violations/);
  assert.match(prereg.nullModel, /not reproducibly safe/);
  assert.match(prereg.threshold, /Zero contract violations/);
  assert.match(prereg.seamContract.default, /terminates at its first bridge seam/);
  assert.match(prereg.seamContract.requiredSabotage, /exit non-zero/);
  const correction = JSON.parse(fs.readFileSync(CORRECTION, 'utf8'));
  assert.equal(correction.status, 'FROZEN_BEFORE_IDENTITY_REBUILD');
  assert.equal(correction.correctedArtifactVersion, '1.1.0');
  assert.equal(correction.identifierProtection.algorithm, 'HMAC-SHA-256');
  assert.match(correction.rejectedAlternative, /salt.*not enumeration/i);
  assert.match(correction.threshold, /Zero of fifty/);
  const determinismCorrection = JSON.parse(fs.readFileSync(DETERMINISM_CORRECTION, 'utf8'));
  assert.equal(determinismCorrection.status, 'FROZEN_BEFORE_INDEPENDENT_REBUILDS');
  assert.match(determinismCorrection.threshold, /two distinct process identifiers/i);
  assert.match(determinismCorrection.threshold, /four total scan_panel calls/i);
  assert.deepEqual(determinismCorrection.deterministicFingerprintFields, [
    'artifactVersion',
    'logicalPayloadSha256',
    'manifestFileSha256',
    'manifestPayloadSha256',
    'shardSetSha256',
    'orderedShardDescriptorsSha256',
    'countsSha256',
    'inputsSha256',
    'keyFingerprintSha256',
  ]);
});

test('R2-A1 Blocker 1: public watcher attacks fifty published IDs and sabotage is red', () => {
  const publicRun = spawnSync(process.env.PYTHON || 'python', [
    SCRIPT, '--verify-public-ids', '--artifact', ARTIFACT,
  ], { cwd: REPO, encoding: 'utf8' });
  assert.equal(publicRun.status, 0, `${publicRun.stdout}\n${publicRun.stderr}`);
  const observed = JSON.parse(publicRun.stdout.trim());
  assert.equal(observed.sampledPublishedEntityIds, 50);
  assert.equal(observed.candidateCikMaximum, 2100000);
  assert.equal(observed.candidateCiksTried, 2100000);
  assert.equal(observed.invertiblePublishedIds, 0);
  assert.equal(observed.passes, true);

  const sabotage = spawnSync(process.env.PYTHON || 'python', [
    SCRIPT, '--sabotage-reversible-ids',
  ], { cwd: REPO, encoding: 'utf8' });
  assert.notEqual(sabotage.status, 0, `${sabotage.stdout}\n${sabotage.stderr}`);
  assert.match(`${sabotage.stdout}\n${sabotage.stderr}`,
    /IDENTITY SABOTAGE RED: reversible published IDs detected/);
});

function sha256(file) {
  return require('node:crypto').createHash('sha256')
    .update(fs.readFileSync(file)).digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function loadBundle() {
  const manifest = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  const entities = [];
  for (const shard of manifest.shards) {
    const file = path.join(path.dirname(ARTIFACT), ...shard.file.split('/'));
    assert.ok(fs.statSync(file).size < 200 * 1024, shard.file);
    assert.equal(sha256(file), shard.sha256, shard.file);
    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(payload.schema, 'R2-A1-identity-bridge-panel-shard/1');
    assert.equal(payload.part, manifest.shards.indexOf(shard) + 1);
    assert.equal(payload.entities.length, shard.entities);
    entities.push(...payload.entities);
  }
  const logical = {
    schema: 'R2-A1-identity-bridge-panel/1',
    artifactVersion: manifest.artifactVersion,
    preregistration: manifest.preregistration,
    identityProtectionCorrection: manifest.identityProtectionCorrection,
    construction: manifest.construction,
    seamContract: manifest.seamContract,
    inputs: manifest.inputs,
    exclusions: manifest.exclusions,
    counts: manifest.counts,
    entities,
    canonicalPayloadSha256: manifest.logicalPayloadSha256,
  };
  return { manifest, logical };
}

test('R2-A1: panel artifact is canonical, HMAC-protected, and identity-free', () => {
  const { manifest, logical } = loadBundle();
  const result = JSON.parse(fs.readFileSync(RESULT, 'utf8'));
  assert.equal(manifest.schema, 'R2-A1-identity-bridge-panel-manifest/1');
  assert.equal(manifest.artifactVersion, '1.1.0');
  assert.equal(result.panelArtifact.sha256, sha256(ARTIFACT));
  assert.equal(result.panelArtifact.independentRebuildManifestSha256, sha256(ARTIFACT));
  assert.equal(result.panelArtifact.independentRebuildsExecuted, 2);
  assert.equal(result.panelArtifact.independentRebuildFingerprintMismatches, 0);
  assert.equal(result.contract.status, 'HOLD_BLOCKER_3_AND_METHOD_CORRECTIONS');
  assert.equal(result.contract.passes, false);
  assert.equal(result.contract.blocker2IndependentDeterminism.status, 'PASS');
  assert.equal(result.contract.blocker2IndependentDeterminism.processIdsDistinct, true);
  assert.deepEqual(result.contract.blocker2IndependentDeterminism.scanPanelCallsPerProcess,
    [2, 2]);
  assert.equal(result.contract.blocker2IndependentDeterminism.totalScanPanelCalls, 4);
  assert.equal(result.contract.blocker2IndependentDeterminism.fingerprintMismatches, 0);
  assert.equal(result.panelArtifact.shards, manifest.shards.length);
  const expectedManifestHash = manifest.canonicalPayloadSha256;
  delete manifest.canonicalPayloadSha256;
  const observedManifestHash = require('node:crypto').createHash('sha256')
    .update(`${canonical(manifest)}\n`).digest('hex');
  assert.equal(observedManifestHash, expectedManifestHash);
  const expectedLogicalHash = logical.canonicalPayloadSha256;
  delete logical.canonicalPayloadSha256;
  const observedLogicalHash = require('node:crypto').createHash('sha256')
    .update(`${canonical(logical)}\n`).digest('hex');
  assert.equal(observedLogicalHash, expectedLogicalHash);
  assert.equal(result.panelArtifact.logicalPayloadSha256, expectedLogicalHash);
  const raw = JSON.stringify(logical);
  assert.doesNotMatch(raw,
    /"(?:cik|ticker|adsh|company|companyname|company_name)"\s*:/i);
  assert.equal(result.scope.companyIdentifiersWrittenToResult, 0);
  assert.equal(result.scope.numericFactColumnsRead, 0);
  assert.equal(result.scope.endtestFilesOpened, 0);
  assert.equal(result.identityProtection.algorithm, 'HMAC-SHA-256');
  assert.equal(result.identityProtection.keyStoredInRepository, false);
  assert.deepEqual(result.inputs.map((row) => row.file).sort(),
    ['panel-entdeckung.sqlite', 'panel-validierung.sqlite']);
  for (const [relative, expected] of Object.entries(result.boundImplementation)) {
    assert.equal(sha256(path.join(REPO, ...relative.split('/'))), expected, relative);
  }
});

test('R2-A1: every identifier and seam satisfies the semantic contract', () => {
  const artifact = loadBundle().logical;
  const result = JSON.parse(fs.readFileSync(RESULT, 'utf8'));
  const owners = new Map();
  let mappings = 0;
  let seams = 0;
  for (const entity of artifact.entities) {
    const identifiers = new Map(entity.identifiers
      .map((row) => [row.identifierId, row]));
    mappings += entity.identifiers.length;
    seams += entity.seams.length;
    for (const row of entity.identifiers) {
      assert.equal(row.entityId, entity.entityId);
      assert.ok(!owners.has(row.identifierId), row.identifierId);
      owners.set(row.identifierId, entity.entityId);
      assert.ok(row.lastDate <= '20201231');
    }
    for (const seam of entity.seams) {
      const oldIdentifier = identifiers.get(seam.oldIdentifierId);
      const newIdentifier = identifiers.get(seam.newIdentifierId);
      assert.ok(oldIdentifier, seam.oldIdentifierId);
      assert.ok(newIdentifier, seam.newIdentifierId);
      assert.equal(oldIdentifier.unit, newIdentifier.unit);
      assert.equal(seam.unit, oldIdentifier.unit);
      assert.equal(seam.defaultSeriesPolicy, 'terminate-at-seam');
      assert.equal(seam.crossSeamRequiresExplicitMarker, true);
      assert.ok(seam.date <= '20201231');
    }
  }
  assert.equal(artifact.entities.length, result.counts.entitiesWithBridgeSeams);
  assert.equal(mappings, result.counts.identifierMappings);
  assert.equal(seams, result.counts.bridgeSeams);
  assert.equal(result.contract.blocker1IdentityProtection.status, 'PASS');
  assert.equal(result.contract.blocker1IdentityProtection.invertiblePublishedIds, 0);
});

test('R2-A1 Blocker 2: two full process-isolated rebuilds match and sabotage is red', () => {
  const proof = JSON.parse(fs.readFileSync(INDEPENDENT_PROOF, 'utf8'));
  const sabotage = JSON.parse(fs.readFileSync(INDEPENDENT_SABOTAGE, 'utf8'));
  const result = JSON.parse(fs.readFileSync(RESULT, 'utf8'));
  assert.equal(proof.schema, 'R2-A1-independent-rebuild-proof/1');
  assert.equal(proof.passes, true);
  assert.equal(proof.observedStatus, 'GREEN');
  assert.equal(proof.independentProcessesExecuted, 2);
  assert.equal(proof.processIdsDistinct, true);
  assert.equal(proof.pythonRuntimesEqual, true);
  assert.notEqual(proof.builders[0].processId, proof.builders[1].processId);
  assert.deepEqual(proof.scanPanelCallsPerProcess, [2, 2]);
  assert.equal(proof.totalScanPanelCalls, 4);
  assert.equal(proof.matchesBoundManifest, true);
  assert.deepEqual(proof.fingerprintMismatches, []);
  assert.deepEqual(proof.builders[0].fingerprint, proof.builders[1].fingerprint);
  assert.equal(proof.manifestSha256, sha256(ARTIFACT));
  assert.equal(proof.companyIdentifiersWritten, 0);
  assert.equal(proof.fingerprintFieldsCompared.length, 9);
  assert.doesNotMatch(JSON.stringify(proof),
    /"(?:cik|ticker|adsh|company|companyname|company_name)"\s*:/i);

  assert.equal(sabotage.passes, false);
  assert.equal(sabotage.observedStatus, 'RED');
  assert.equal(sabotage.processIdsDistinct, true);
  assert.deepEqual(sabotage.scanPanelCallsPerProcess, [2, 2]);
  assert.deepEqual(sabotage.fingerprintMismatches, ['shardSetSha256']);
  assert.equal(sabotage.builders[1].sabotageApplied, true);
  assert.equal(result.independentRebuildProof.sha256, sha256(INDEPENDENT_PROOF));
  assert.equal(result.independentRebuildProof.sabotage.sha256,
    sha256(INDEPENDENT_SABOTAGE));
  assert.equal(result.independentRebuildProof.sabotage.observedRed, true);
});

test('R2-A1: red sabotage proof and report are bound to machine artifacts', () => {
  const proof = JSON.parse(fs.readFileSync(PROOF, 'utf8'));
  const result = JSON.parse(fs.readFileSync(RESULT, 'utf8'));
  const report = fs.readFileSync(REPORT, 'utf8');
  assert.equal(proof.observedStatus, 'RED');
  assert.equal(proof.failureClass, 'unmarked-cross-seam');
  assert.equal(result.seamSabotageProof.observedRed, true);
  assert.equal(result.seamSabotageProof.sha256, sha256(PROOF));
  const identityProof = JSON.parse(fs.readFileSync(ID_PROOF, 'utf8'));
  const identitySabotage = JSON.parse(fs.readFileSync(ID_SABOTAGE, 'utf8'));
  assert.equal(identityProof.invertiblePublishedIds, 0);
  assert.equal(identityProof.sampledPublishedEntityIds, 50);
  assert.equal(identityProof.candidateCiksTried, 2100000);
  assert.equal(identitySabotage.invertiblePublishedIds, 50);
  assert.equal(identitySabotage.candidateCiksTried, 2100000);
  assert.equal(identitySabotage.observedStatus, 'RED');
  assert.equal(result.identityProtection.publicInversionProof.sha256, sha256(ID_PROOF));
  assert.equal(result.identityProtection.legacySabotageProof.sha256, sha256(ID_SABOTAGE));
  const firstLine = report.split(/\r?\n/)[0];
  assert.match(firstLine, /Blocker 1 und 2.*0 Fingerprint-Abweichungen.*HOLD/);
  const marker = '## Was ausdruecklich nicht gezeigt ist';
  assert.ok(report.includes(marker));
  assert.ok(report.split(marker, 2)[1].trim().length > 0);
  assert.match(report, /Prozess A und Prozess B.*getrenntem Speicher/s);
  assert.match(report, /fruehere In-Prozess-Check.*nicht.*unabhaengiger Determinismusbeleg/s);
  assert.match(report, /Blocker 3 ist offen/);
  assert.match(report, /ddate.*accepted/);
});
