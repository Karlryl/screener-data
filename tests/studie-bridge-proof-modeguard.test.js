'use strict';

// H6: the pinned bridge script accepts the bound-manifest mode a proof claims
// about itself. The pre-flight guard runs before the pinned script is reached.
//
// Rule modeguard/2 (court of 2026-08-30, option C): the MODE no longer decides.
// Manifest equality does - SOLL out of the frozen record, IST re-computed from
// the file, CLAIM out of the proof. These tests hold the guard to both
// directions: the real committed proof and an honest future rebuild proof must
// pass, every forged shape must die - including the one that merely NAMES the
// bound hash while the real manifest is another (the sabotage case that the
// court made the pre-condition of this rule).

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
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

const closure = JSON.parse(fs.readFileSync(V120_CLOSURE, 'utf8'));
const BOUND_MANIFEST = closure.boundManifest.manifestFileSha256;
const REAL_MANIFEST = path.join(REPO, ...closure.canonicalRun.artifacts.manifest.split('/'));

const tmpFile = (name) =>
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'modeguard-')), name);

const run = (proofPath, manifestPath) => spawnSync(process.env.PYTHON || 'python',
  [GUARD, '--proof', proofPath, ...(manifestPath ? ['--manifest', manifestPath] : [])],
  { cwd: REPO, encoding: 'utf8' });

const withProof = (mutate) => {
  const proof = JSON.parse(fs.readFileSync(REAL_PROOF, 'utf8'));
  mutate(proof);
  const file = tmpFile('proof.json');
  fs.writeFileSync(file, JSON.stringify(proof), 'utf8');
  return file;
};

// A copy of the real manifest, mutated so its hash is no longer the bound one.
// The repo file is never touched: the guard re-computes from whatever file it
// is pointed at, which is exactly the property under test.
const changedManifest = () => {
  const manifest = JSON.parse(fs.readFileSync(REAL_MANIFEST, 'utf8'));
  manifest.__sabotage__ = 'modeguard break-proof';
  const file = tmpFile('manifest.json');
  fs.writeFileSync(file, JSON.stringify(manifest), 'utf8');
  return file;
};

const refuses = (proofPath, pattern, manifestPath) => {
  const result = run(proofPath, manifestPath);
  assert.notEqual(result.status, 0, `guard passed: ${result.stdout}${result.stderr}`);
  assert.match(result.stderr, /MODEGUARD REFUSED \[modeguard\/2-manifest-equality\]/);
  assert.match(result.stderr, pattern);
};

const passes = (proofPath, manifestPath) => {
  const result = run(proofPath, manifestPath);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout;
};

test('the real committed proof passes, and names SOLL, IST and the source', () => {
  const stdout = passes(REAL_PROOF);
  assert.match(stdout, /MODEGUARD OK \[modeguard\/2-manifest-equality\]/);
  assert.match(stdout, new RegExp(`SOLL ${BOUND_MANIFEST}`));
  assert.match(stdout, new RegExp(`IST ${BOUND_MANIFEST}`));
  assert.match(stdout, /source protocol\/early-detection\/2\.0\.0\/r2-a1-v120-closure-record\.json/);
  assert.match(stdout, /artifact version 1\.2\.0/);
});

// The court's pre-condition, in the corrected shape from the verdict addendum:
// the proof is set BY HAND to the bound hash (never re-generated, so the
// generating side cannot supply the answer), the real manifest is another one.
// Only a check side that RE-COMPUTES the hash catches this. If it passes, R1 is
// torn and option C has failed.
test('sabotage: a proof naming the bound hash dies when the real manifest is another', () => {
  const handSet = withProof((proof) => { proof.manifestSha256 = BOUND_MANIFEST; });
  refuses(handSet, /manifest does not reproduce the bound manifest: SOLL /, changedManifest());
});

test('sabotage break-proof, other direction: the same proof passes on the real manifest', () => {
  const handSet = withProof((proof) => { proof.manifestSha256 = BOUND_MANIFEST; });
  assert.match(passes(handSet, REAL_MANIFEST), /MODEGUARD OK/);
});

test('the refusal names the re-computed IST, not the claimed value', () => {
  const changed = changedManifest();
  const ist = crypto.createHash('sha256').update(fs.readFileSync(changed)).digest('hex');
  assert.notEqual(ist, BOUND_MANIFEST);
  refuses(REAL_PROOF, new RegExp(`IST ${ist}`), changed);
});

// The finding that brought this to court: under modeguard/1 this exact proof was
// refused as a lying mode, and only a proof downgrading itself to the weaker
// mode passed. Under modeguard/2 the honest rebuild proof is the one that lives.
test('an honest future rebuild proof claiming REPLICATION now passes', () => {
  const rebuilt = withProof((proof) => {
    proof.boundManifestMode = 'REPLICATION_AGAINST_BOUND_MANIFEST';
    proof.matchesBoundManifest = true;
  });
  assert.match(passes(rebuilt), /declared mode REPLICATION_AGAINST_BOUND_MANIFEST/);
});

// Condition 7: a rollback may switch the default checker, but must invalidate
// neither the historic first-build proof nor a proof carried under this rule.
// Both classes are pinned here, so any such rollback turns this file red.
test('both proof classes stay valid: historic first build and rebuilt replication', () => {
  assert.match(passes(REAL_PROOF), /declared mode FIRST_BUILD_OF_VERSION/);
  const rebuilt = withProof((proof) => {
    proof.boundManifestMode = 'REPLICATION_AGAINST_BOUND_MANIFEST';
    proof.matchesBoundManifest = true;
  });
  assert.match(passes(rebuilt), /declared mode REPLICATION_AGAINST_BOUND_MANIFEST/);
});

test('a proof bound to another manifest is refused even on the real manifest', () => {
  refuses(withProof((proof) => {
    proof.manifestSha256 = 'f'.repeat(64);
  }), /proof is bound to another manifest: SOLL /);
});

test('an unknown version fails closed instead of falling to the weaker mode', () => {
  refuses(withProof((proof) => {
    proof.artifactVersion = '9.9.9';
  }), /9\.9\.9' has no frozen record/);
});

test('the forged proof from the sweep is refused', () => {
  // FORGED PROOF ACCEPTED -> mode never re-derived. Under modeguard/2 the mode
  // is descriptive, so the version leg catches this shape - the class stays
  // dead, only the refusal that reports it changed.
  refuses(withProof((proof) => {
    proof.artifactVersion = '1.1.0';
    proof.boundManifestMode = 'FIRST_BUILD_OF_VERSION';
  }), /the current bound version is '1\.2\.0'/);
});

test('a correctly-moded proof for a superseded version is still refused', () => {
  refuses(withProof((proof) => {
    proof.artifactVersion = '1.1.0';
    proof.boundManifestMode = 'REPLICATION_AGAINST_BOUND_MANIFEST';
    proof.matchesBoundManifest = true;
  }), /the current bound version is '1\.2\.0'/);
});

test('a missing mode is refused, not defaulted', () => {
  refuses(withProof((proof) => {
    delete proof.boundManifestMode;
  }), /claims bound-manifest mode None, which names neither/);
});

test('a first build cannot claim a bound-manifest match', () => {
  refuses(withProof((proof) => {
    proof.matchesBoundManifest = true;
  }), /cannot claim a bound-manifest match/);
});

test('replication mode without a match is refused', () => {
  refuses(withProof((proof) => {
    proof.boundManifestMode = 'REPLICATION_AGAINST_BOUND_MANIFEST';
  }), /replication mode requires matchesBoundManifest true/);
});

test('a missing manifest refuses instead of skipping the check', () => {
  refuses(REAL_PROOF, /does not exist; SOLL /,
    path.join(os.tmpdir(), 'modeguard-absent-manifest.json'));
});

test('the pre-field 1.1.0 proof is refused, so it can never stand in for a run', () => {
  refuses(HISTORIC_PROOF, /MODEGUARD REFUSED/);
});

test('it reads the frozen records, not the pinned script', () => {
  const source = fs.readFileSync(GUARD, 'utf8');
  assert.doesNotMatch(source, /import.*studie_identity_bridge_artifact/);
  assert.ok(!source.includes(`exec(open('${BRIDGE_SCRIPT_REL}')`));
  // The guard must stay byte-quiet about the pinned file: it names it only in
  // prose, so a defect in the guarded resolver cannot travel into its own gate.
  assert.ok(closure.currentImplementation[BRIDGE_SCRIPT_REL],
    'the closure record must keep pinning the guarded script');
});

// Condition 1: the SOLL is resolved out of the record, never carried as a
// literal in the check code. Break the record's value and the guard must move
// with it - a hardcoded hash would keep passing.
test('the bound manifest is resolved from the record, not hardcoded', () => {
  const source = fs.readFileSync(GUARD, 'utf8');
  assert.ok(!source.includes(BOUND_MANIFEST),
    'the guard must not carry the bound manifest hash as a literal');
  assert.match(source, /manifestFileSha256/);
});
