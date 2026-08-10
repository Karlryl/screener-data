'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.join(__dirname, '..');
const reports = path.join(root, 'reports', 'early-detection');
const scripts = path.join(root, 'scripts');

function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function fileSha256(file) {
  return sha256Bytes(fs.readFileSync(file));
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(reports, name), 'utf8'));
}

function verifySigned(name) {
  const value = load(name);
  const { reportSha256, ...unsigned } = value;
  assert.equal(sha256Bytes(Buffer.from(canonical(unsigned), 'utf8')), reportSha256, name);
  return value;
}

const decisions = [
  ['entityListingLedger', 'entity-listing-ledger-gate-decision-2026-08-10-v7-partial.json', 'entity-listing-ledger-gate-decision-2026-08-10-v7-partial-verification.json'],
  ['historicalUniverse', 'historical-universe-gate-decision-2026-08-10-v7-partial.json', 'historical-universe-gate-decision-2026-08-10-v7-partial-verification.json'],
  ['corporateActionsDelistings', 'corporate-actions-delistings-gate-decision-2026-08-10-v7.json', 'corporate-actions-delistings-gate-decision-2026-08-10-v7-verification.json'],
];

test('portable identity-transition tools expose their fail-closed CLIs', () => {
  for (const name of [
    'early-detection-identity-transition-dossiers.py',
    'early-detection-identity-transition-dossiers-verify.py',
    'early-detection-identity-transition-gates.py',
    'early-detection-identity-transition-gates-verify.py',
  ]) {
    const run = spawnSync(process.env.PYTHON || 'python', [path.join(scripts, name), '--help'], { encoding: 'utf8' });
    assert.equal(run.status, 0, `${name}: ${run.stderr || run.stdout}`);
    assert.match(run.stdout, /usage:/i, name);
  }
});

test('92,855 identity-transition rows are independently bound without resolving identity', () => {
  const dossierName = 'identity-transition-dossiers-2009-2024-v2.json';
  const verificationName = 'identity-transition-dossiers-2009-2024-v2-verification.json';
  const dossier = verifySigned(dossierName);
  const verification = verifySigned(verificationName);

  assert.equal(dossier.status, 'PASS_OUTCOME_BLIND_IDENTITY_TRANSITIONS_QUANTIFIED_GATES_REMAIN_RED');
  assert.equal(dossier.identityResolvedRows, 0);
  assert.equal(dossier.resultComputationAllowed, false);
  assert.equal(dossier.outcomesAccessed, false);
  assert.deepEqual(dossier.counts, {
    archiveSnapshots: 103,
    nonTestPositiveObservationRows: 432800,
    snapshotPairs: 101,
    observedAppearances: 18093,
    observedDisappearances: 15314,
    observedNameChanges: 8912,
    symbolProfiles: 25403,
    cikProfiles: 8954,
    commonEquityCorporateEvents: 16078,
  });
  assert.deepEqual(dossier.symbolProfileStatusCounts, {
    MULTIPLE_PIT_DIRECT_CIKS_CONFLICT_NOT_RESOLVED: 393,
    NO_PIT_DIRECT_CIK_CANDIDATE: 13065,
    ONE_PIT_DIRECT_CIK_CANDIDATE_NOT_IDENTITY: 11945,
  });
  assert.equal(dossier.cikProfileStatusCounts.MULTIPLE_SYMBOLS_FOR_CIK_CANDIDATE_NOT_TICKER_CHANGE, 1906);
  assert.equal(dossier.corporateEventLinkStatusCounts.NO_PIT_DIRECT_DIRECTORY_CANDIDATE, 10215);
  assert.equal(dossier.corporateEventLinkStatusCounts.BOTH_SIDES_SYMBOL_SET_CHANGED_CANDIDATE_NOT_SUCCESSOR_PROOF, 96);

  assert.equal(verification.status, 'PASS');
  assert.equal(verification.checks.rowsIndependentlyRecomputed, 92855);
  assert.equal(verification.checks.fiveOutputTablesIndependentlyRecomputed, true);
  assert.equal(verification.checks.forbiddenOutcomeColumnsAbsent, true);
  assert.equal(verification.checks.mutationRejected, true);
  assert.equal(verification.sourceReportFileSha256, fileSha256(path.join(reports, dossierName)));
  assert.equal(dossier.producerScriptSha256, fileSha256(path.join(scripts, 'early-detection-identity-transition-dossiers.py')));
  assert.equal(verification.verifierScriptSha256, fileSha256(path.join(scripts, 'early-detection-identity-transition-dossiers-verify.py')));
});

test('all three data gates preserve red boundaries and exact dossier bindings', () => {
  const dossier = load('identity-transition-dossiers-2009-2024-v2.json');
  const dossierFileSha256 = fileSha256(path.join(reports, 'identity-transition-dossiers-2009-2024-v2.json'));
  for (const [gate, decisionName, verificationName] of decisions) {
    const decision = verifySigned(decisionName);
    const verification = verifySigned(verificationName);
    assert.equal(decision.gate, gate);
    assert.match(decision.status, /^RED_/);
    assert.equal(decision.identityResolvedRows, 0);
    assert.equal(decision.confirmatoryEligible, false);
    assert.equal(decision.resultComputationAllowed, false);
    assert.equal(decision.outcomesAccessed, false);
    assert.deepEqual(decision.selectedDossierEvidence.counts, dossier.counts);
    assert.deepEqual(decision.selectedDossierEvidence.symbolProfileStatusCounts, dossier.symbolProfileStatusCounts);
    assert.equal(decision.inputs.identityTransitionDossiers.fileSha256, dossierFileSha256);
    assert.equal(decision.inputs.identityTransitionDossiers.reportSha256, dossier.reportSha256);
    assert.equal(decision.decisionBuilderSha256, fileSha256(path.join(scripts, 'early-detection-identity-transition-gates.py')));
    assert.equal(verification.status, 'PASS');
    assert.equal(verification.gate, gate);
    assert.equal(verification.checks.selectedDossierEvidenceReproduced, true);
    assert.equal(verification.checks.identityResolvedRows, 0);
    assert.equal(verification.sourceDecisionFileSha256, fileSha256(path.join(reports, decisionName)));
  }
});

test('V48 corpus and V31 readiness seal the dossier evidence while outcomes remain forbidden', () => {
  const corpus = verifySigned('research-corpus-manifest-2026-08-10-v48.json');
  const corpusVerification = verifySigned('research-corpus-manifest-verification-2026-08-10-v48.json');
  const corpusGate = verifySigned('research-corpus-gate-decision-2026-08-10-v40.json');
  const readiness = verifySigned('readiness-gap-resolution-matrix-2026-08-10-v31.json');
  const readinessVerification = verifySigned('readiness-gap-resolution-matrix-2026-08-10-v31-verification.json');

  assert.equal(corpus.counts.coveredRegistrySources, 237);
  assert.equal(corpus.counts.unresolvedRegistrySources, 0);
  assert.equal(corpus.counts.selectedEvidenceItems, 296);
  assert.equal(corpus.controlFiles.length, 188);
  assert.equal(corpusVerification.status, 'PASS');
  assert.deepEqual(corpusVerification.failures, []);
  assert.equal(corpusVerification.checks.controlFilesRehashed, 188);
  assert.equal(corpusVerification.checks.reportTamperDetected, true);
  assert.equal(corpusVerification.checks.payloadTamperDetected, true);
  assert.equal(corpusGate.coverage.controlFiles, 188);
  assert.equal(corpusGate.resultComputationAllowed, false);

  const copiedControls = new Map([
    ['build_identity_transition_dossiers_v1.py', 'early-detection-identity-transition-dossiers.py'],
    ['verify_identity_transition_dossiers_v1.py', 'early-detection-identity-transition-dossiers-verify.py'],
    ['build_identity_transition_gate_decisions_v7.py', 'early-detection-identity-transition-gates.py'],
    ['verify_identity_transition_gate_decisions_v7.py', 'early-detection-identity-transition-gates-verify.py'],
  ]);
  for (const [original, published] of copiedControls) {
    const entry = corpus.controlFiles.find((item) => path.basename(item.path) === original);
    assert.ok(entry, original);
    assert.equal(entry.fileSha256, fileSha256(path.join(scripts, published)), published);
  }

  assert.equal(readiness.officialGreenGates, 2);
  assert.equal(readiness.officialRedGates, 11);
  assert.equal(readiness.resultComputationAllowed, false);
  assert.equal(readiness.outcomesAccessed, false);
  for (const [gate, decisionName] of decisions) {
    const item = readiness.gates.find((candidate) => candidate.gate === gate);
    assert.ok(item, gate);
    assert.equal(path.basename(item.evidence.path), decisionName);
    assert.equal(item.evidence.fileSha256, fileSha256(path.join(reports, decisionName)));
  }
  const corpusItem = readiness.gates.find((item) => item.gate === 'researchCorpusSealed');
  assert.equal(path.basename(corpusItem.evidence.path), 'research-corpus-gate-decision-2026-08-10-v40.json');
  assert.equal(readinessVerification.status, 'PASS');
  assert.equal(readinessVerification.checks.officialGreenGates, 2);
  assert.equal(readinessVerification.checks.officialRedGates, 11);
  assert.equal(readinessVerification.checks.researchCorpusV48Bound, true);
  assert.equal(readinessVerification.checks.independentlyRecomputedDossierRows, 92855);
  assert.equal(readinessVerification.checks.identityResolvedRows, 0);
});
