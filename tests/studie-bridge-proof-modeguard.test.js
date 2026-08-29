'use strict';

// H6: the pinned bridge script accepts the bound-manifest mode a proof claims
// about itself. The pre-flight guard re-derives it from the frozen records
// before the pinned script is reached. These tests hold the guard to both
// directions: the real committed proof must pass, every forged shape must die.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const REPO = path.join(__dirname, '..');
const GUARD = path.join(REPO, 'scripts', 'studie-bridge-proof-modeguard.py');
const REAL_PROOF = path.join(REPO, 'reports', 'studie',
  'R2-A1-independent-rebuild-proof-2026-08-29.json');
const HISTORIC_PROOF = path.join(REPO, 'reports', 'studie',
  'R2-A1-independent-rebuild-proof-2026-08-25.json');
const V120_CLOSURE = path.join(REPO, 'protocol', 'early-detection', '2.0.0',
  'r2-a1-v120-closure-record.json');
const BRIDGE_SCRIPT_REL = 'scripts/studie-identity-bridge-artifact.py';

const run = (proofPath) => spawnSync(process.env.PYTHON || 'python',
  [GUARD, '--proof', proofPath], { cwd: REPO, encoding: 'utf8' });

const withProof = (mutate) => {
  const proof = JSON.parse(fs.readFileSync(REAL_PROOF, 'utf8'));
  mutate(proof);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'modeguard-')), 'proof.json');
  fs.writeFileSync(file, JSON.stringify(proof), 'utf8');
  return file;
};

const refuses = (proofPath, pattern) => {
  const result = run(proofPath);
  assert.notEqual(result.status, 0, `guard passed: ${result.stdout}${result.stderr}`);
  assert.match(result.stderr, /MODEGUARD REFUSED/);
  assert.match(result.stderr, pattern);
};

test('H6 guard: the real committed proof passes', () => {
  const result = run(REAL_PROOF);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /MODEGUARD OK - FIRST_BUILD_OF_VERSION/);
  assert.match(result.stdout, /artifact version 1\.2\.0/);
});

test('H6 guard: the forged proof from the sweep is refused', () => {
  // FORGED PROOF ACCEPTED -> mode never re-derived: 1.1.0 is the
  // replication-bound version, so FIRST_BUILD_OF_VERSION is a lie.
  refuses(withProof((proof) => {
    proof.artifactVersion = '1.1.0';
    proof.boundManifestMode = 'FIRST_BUILD_OF_VERSION';
  }), /re-derived mode for 1\.1\.0 is 'REPLICATION_AGAINST_BOUND_MANIFEST'/);
});

test('H6 guard: an unknown version fails closed instead of falling to the weaker mode', () => {
  refuses(withProof((proof) => {
    proof.artifactVersion = '9.9.9';
  }), /9\.9\.9' has no frozen record/);
});

test('H6 guard: the current version cannot claim the stronger mode either', () => {
  refuses(withProof((proof) => {
    proof.boundManifestMode = 'REPLICATION_AGAINST_BOUND_MANIFEST';
    proof.matchesBoundManifest = true;
  }), /re-derived mode for 1\.2\.0 is 'FIRST_BUILD_OF_VERSION'/);
});

test('H6 guard: a missing mode is refused, not defaulted', () => {
  refuses(withProof((proof) => {
    delete proof.boundManifestMode;
  }), /claims bound-manifest mode None/);
});

test('H6 guard: a first build cannot claim a bound-manifest match', () => {
  refuses(withProof((proof) => {
    proof.matchesBoundManifest = true;
  }), /cannot claim a bound-manifest match/);
});

test('H6 guard: a correctly-moded proof for a superseded version is still refused', () => {
  // Mode honest, version wrong: the third hole has its own reachable refusal.
  refuses(withProof((proof) => {
    proof.artifactVersion = '1.1.0';
    proof.boundManifestMode = 'REPLICATION_AGAINST_BOUND_MANIFEST';
    proof.matchesBoundManifest = true;
  }), /the current bound version is '1\.2\.0'/);
});

test('H6 guard: the pre-field 1.1.0 proof is refused, so it can never stand in for a run', () => {
  refuses(HISTORIC_PROOF, /MODEGUARD REFUSED/);
});

test('H6 guard: it reads the frozen records, not the pinned script', () => {
  const source = fs.readFileSync(GUARD, 'utf8');
  assert.doesNotMatch(source, /import.*studie_identity_bridge_artifact/);
  assert.ok(!source.includes(`exec(open('${BRIDGE_SCRIPT_REL}')`));
  // The guard must stay byte-quiet about the pinned file: it names it only in
  // prose, so a defect in the guarded resolver cannot travel into its own gate.
  const closure = JSON.parse(fs.readFileSync(V120_CLOSURE, 'utf8'));
  assert.ok(closure.currentImplementation[BRIDGE_SCRIPT_REL],
    'the closure record must keep pinning the guarded script');
});
