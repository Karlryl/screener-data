'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.join(__dirname, '..');
const reports = path.join(root, 'reports', 'early-detection');

const evidenceFiles = {
  'nasdaq-symbol-directory-wayback-snapshots-2009-2024-v2.json': 'c653dd26a12e2c5adb149f2035c22c293b595b576d7a02bd04a6f31aa2a080fd',
  'nasdaq-symbol-directory-wayback-snapshots-2009-2024-v2-verification.json': '3890d61b2321af3fe57b0dbe03882b231bb60c45a4fe796234d2abe15e7ed241',
  'nasdaq-symbol-directory-evidence-addendum-2026-08-10-v1.json': '51cb9f5781de244dae161b0234bd1320599cc6d1d9f67e75102a46692cd6fbfe',
  'nasdaq-symbol-directory-evidence-addendum-2026-08-10-v1-verification.json': 'a6d4be5bc40db1509e4017f82687107abcf82c765bc2ff91f1472e9ed08fc73d',
  'nasdaq-archive-sec-entity-candidate-crosswalk-2009-2024-v1.json': '36e10bfbca8d573bc559f5563acd15d8005e19af57d7bdd78c0796243460aee8',
  'nasdaq-archive-sec-entity-candidate-crosswalk-2009-2024-v1-verification.json': '47a13faf4c639780da8d2f306fb2100adfe6d19231f3cea060f755a52c7a2c45',
  'entity-listing-ledger-gate-decision-2026-08-10-v6-partial.json': 'a325202d86eddc182802dd84482bf82fe93ab55a0c84646493df50d1a9fcb2f1',
  'entity-listing-ledger-gate-decision-2026-08-10-v6-partial-verification.json': 'f7c7b276e5a14926aaf32bee6d8d44c197dbbcecf52516da95f02132a3dee3e0',
  'historical-universe-gate-decision-2026-08-10-v6-partial.json': '22f9135db94682773725189e5687b39653feb93ff8f9941b76425990e426b138',
  'historical-universe-gate-decision-2026-08-10-v6-partial-verification.json': 'f8ef4f69d3e09d9e0234e683b304d390f423dfbad99c6942dde9d0582a262761',
  'corporate-actions-delistings-gate-decision-2026-08-10-v5.json': 'a3a35d2889aa30940595a2f4493bcd8bbcad5c54120ebd253caa22c9f19b9aa9',
  'corporate-actions-delistings-gate-decision-2026-08-10-v5-independent-verification.json': 'fcb6aa72ebface34b05cf900c6b621a89b28bfa29ebff907df6919949e007cbc',
  'research-corpus-manifest-2026-08-10-v47.json': '244d1e71dff42982bdddb68fd93e8e78c2b588147096ff22855dcf5c0da9a358',
  'research-corpus-manifest-verification-2026-08-10-v47.json': '973f4fa0cf1d18ea56a779d3bb9e65fdb9f7f91bca47bf613cfbcb3fa8b758d2',
  'research-corpus-gate-decision-2026-08-10-v39.json': '3a1f943ec14fc439f4c01c02d698585408ae7f53b18d72589e7cff473f7dea70',
  'readiness-gap-resolution-matrix-2026-08-10-v28.json': '35c3a282a627b6a82016a4db16dacf45dcd2fd8956217851c37068bc28800a53',
  'readiness-gap-resolution-matrix-2026-08-10-v28-verification.json': '26799ae71b045c9a00bebf437750c4a26013b751f4696ef66f552e8043cedcce',
};

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(reports, name), 'utf8'));
}

test('archived Nasdaq directory parsers accept plain and gzip source variants', () => {
  for (const script of [
    'early-detection-nasdaq-directory-archive.py',
    'early-detection-nasdaq-directory-archive-verify.py',
  ]) {
    const run = spawnSync(
      process.env.PYTHON || 'python',
      [path.join(root, 'scripts', script), 'self-test'],
      { encoding: 'utf8' },
    );
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const result = JSON.parse(run.stdout);
    assert.equal(result.status, 'PASS');
    assert.equal(result.gzipVariant, 'PASS');
  }
});

test('published archive evidence is byte-bound and keeps all affected gates fail-closed', () => {
  for (const [name, expected] of Object.entries(evidenceFiles)) {
    const bytes = Buffer.from(
      fs.readFileSync(path.join(reports, name), 'utf8').replace(/\r\n/g, '\n'),
    );
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), expected, name);
  }

  const archive = load('nasdaq-symbol-directory-wayback-snapshots-2009-2024-v2.json');
  assert.equal(archive.snapshots, 103);
  assert.equal(archive.observations, 434214);
  assert.equal(archive.resultComputationAllowed, false);

  const archiveVerification = load('nasdaq-symbol-directory-wayback-snapshots-2009-2024-v2-verification.json');
  assert.equal(archiveVerification.status, 'PASS');
  assert.equal(archiveVerification.checks.snapshotsRehashedAndReparsed, 103);
  assert.equal(archiveVerification.checks.observationsReparsed, 434214);

  const crosswalk = load('nasdaq-archive-sec-entity-candidate-crosswalk-2009-2024-v1.json');
  assert.equal(crosswalk.pitDirectUniqueCandidateRows, 186044);
  assert.equal(crosswalk.identityResolvedRows, 0);
  assert.equal(crosswalk.futureSnapshotsUsed, false);

  for (const name of [
    'entity-listing-ledger-gate-decision-2026-08-10-v6-partial.json',
    'historical-universe-gate-decision-2026-08-10-v6-partial.json',
    'corporate-actions-delistings-gate-decision-2026-08-10-v5.json',
  ]) {
    const decision = load(name);
    assert.match(decision.status, /^RED_/);
    assert.equal(decision.confirmatoryEligible, false);
    assert.equal(decision.resultComputationAllowed, false);
    assert.equal(decision.outcomesAccessed, false);
  }

  const corpus = load('research-corpus-manifest-2026-08-10-v47.json');
  assert.equal(corpus.counts.selectedEvidenceItems, 296);
  assert.equal(corpus.controlFiles.length, 169);
  const readiness = load('readiness-gap-resolution-matrix-2026-08-10-v28-verification.json');
  assert.equal(readiness.status, 'PASS');
  assert.equal(readiness.checks.officialGreenGates, 2);
  assert.equal(readiness.checks.officialRedGates, 11);
});
