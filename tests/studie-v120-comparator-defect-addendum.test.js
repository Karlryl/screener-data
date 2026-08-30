'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const pinChain = require('./helpers/bridge-pin-chain');

const ROOT = path.join(__dirname, '..');
const ADDENDUM_REL = 'protocol/early-detection/2.0.0/r2-a1-v120-comparator-defect-addendum.json';
const METHOD_REL = 'protocol/early-detection/2.0.0/r2-a1-v120-method-corrections-record.json';
const SCRIPT_REL = 'scripts/studie-identity-bridge-artifact.py';
const CLOSURE_REL = 'protocol/early-detection/2.0.0/r2-a1-v120-closure-record.json';
const PROOF_REL = 'reports/studie/R2-A1-independent-rebuild-proof-2026-08-29.json';

const ADDENDUM_PATH = path.join(ROOT, ...ADDENDUM_REL.split('/'));
const METHOD_PATH = path.join(ROOT, ...METHOD_REL.split('/'));
const SCRIPT_PATH = path.join(ROOT, ...SCRIPT_REL.split('/'));

const EXPECTED_ADDENDUM_SHA256 = '6cc114424344023f7873703b7444572cf465625f270c6b42ae5d4a94d08fd10e';
const EXPECTED_METHOD_SHA256 = '1239a61cc37d8ae3d49f3f3d05397534bf06d1f8054ea7885334cb0edc15a2f3';
const EXPECTED_OLD_SCRIPT_PIN = 'd2234902d0ad507d39f0fdee19f66a0d573a27af7e95afc1f93269c912e35c95';
const EXPECTED_NEW_SCRIPT_PIN = '40669a86564939e31bbee8c3d58bcb79de790137122a7a5fc0dd36a65015d897';

const EXPECTED_TOP_LEVEL_KEYS = [
  'amends',
  'authority',
  'authorizedRerun',
  'correction',
  'currentImplementation',
  'defect',
  'explicitNonClaims',
  'frozenAt',
  'frozenNotice',
  'mode',
  'schema',
  'status',
  'whyThisAddendumExists',
];

const EXPECTED_SELF_CHECKS = [
  'Bound-manifest replication mode enforces the pinned manifest',
  'A new artifact version defers the prior-manifest binding and names the mode',
  'Replication mode still rejects a manifest that does not match its pin',
];

const EXPECTED_CONSUMER_REFUSALS = [
  'Modus-Feld fehlt -> abgewiesen',
  'Modus-Feld mit unbekanntem Wert -> abgewiesen',
  'First-Build-Beleg behauptet Manifest-Treffer -> abgewiesen',
  'Replikations-Beleg mit abweichendem Manifest -> abgewiesen',
];

const EXPECTED_NON_CLAIMS = [
  'Das Addendum aendert keine Methodik-Semantik der Korrekturen A, B oder C.',
  'Es bewertet die neue Nahtmenge nicht und nimmt der Abnahme nichts vorweg.',
  'Es beruehrt weder das versiegelte konfirmatorische Verdikt noch das Endtest-Fenster.',
  'Es schliesst Blocker 3 nicht und macht Auftrag 1 nicht vollstaendig.',
  'Die Artefakte der Version 1.1.0 bleiben unveraendert und gegen ihren eigenen Record pruefbar.',
];

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function validateAddendum(addendum) {
  assert.deepEqual(Object.keys(addendum).sort(), EXPECTED_TOP_LEVEL_KEYS);
  assert.equal(addendum.schema, 'R2-A1-method-corrections-addendum/1');
  assert.equal(addendum.status, 'FROZEN_COMPARATOR_DEFECT_ADDENDUM');
  assert.equal(addendum.mode, 'SUPERSEDE_NO_DELETE');
  assert.equal(addendum.frozenAt, '2026-08-29');

  assert.deepEqual(Object.keys(addendum.amends).sort(), [
    'edited',
    'record',
    'rule',
    'sha256',
    'status',
  ]);
  assert.equal(addendum.amends.record, METHOD_REL);
  assert.equal(addendum.amends.sha256, EXPECTED_METHOD_SHA256);
  assert.equal(addendum.amends.status, 'FROZEN_BEFORE_METHOD_CORRECTION_REBUILD');
  assert.equal(addendum.amends.edited, false);
  assert.match(addendum.amends.rule, /NICHT editiert und NICHT neu versiegelt/);

  assert.equal(addendum.defect.name, 'boundManifestBindingWasVersionBlind');
  assert.equal(addendum.defect.empiricalIsolation.proof, PROOF_REL);
  assert.deepEqual(addendum.defect.empiricalIsolation.sixAndedConditions, {
    noFingerprintMismatches: true,
    processIdsDistinct: true,
    scanPanelCallsPerProcessIsTwoTwo: true,
    panelsMatchRegistration: true,
    pythonRuntimesEqual: true,
    matchesBoundManifest: false,
  });
  assert.match(
    addendum.defect.empiricalIsolation.noNumbersSeen,
    /kein Artefakt, kein Shard, kein Ergebnisartefakt und kein Bericht/,
  );

  const modes = addendum.correction.modes;
  assert.equal(modes.length, 2, 'exactly two comparator modes must remain registered');
  assert.deepEqual(modes.map(({ name }) => name), [
    'REPLICATION_AGAINST_BOUND_MANIFEST',
    'FIRST_BUILD_OF_VERSION',
  ]);
  assert.equal(Object.hasOwn(modes[0], 'deferredTo'), false);
  assert.equal(modes[1].deferredTo, CLOSURE_REL);
  assert.match(addendum.correction.loudness, /true, false oder null/);

  const guard = addendum.correction.guardProvenBothDirections;
  assert.deepEqual(guard.selfTestChecks, EXPECTED_SELF_CHECKS);
  assert.deepEqual(guard.consumerRefusalsProven, EXPECTED_CONSUMER_REFUSALS);
  assert.match(
    addendum.correction.sabotageReanchoring.after,
    /fingerprintMismatches == \['shardSetSha256'\]/,
  );

  assert.equal(
    addendum.authorizedRerun.count,
    1,
    'authorized rerun count must remain exactly one',
  );
  assert.deepEqual(addendum.explicitNonClaims, EXPECTED_NON_CLAIMS);
  assert.ok(addendum.authorizedRerun.unchangedObligations.includes(
    'Kein PR, kein Merge, kein Siegelbruch, kein Ledger-Append, kein Force-Push, keine Loeschung',
  ));
}

test('v1.2 comparator addendum: frozen bytes and constitutional contract remain exact', () => {
  assert.equal(sha256File(ADDENDUM_PATH), EXPECTED_ADDENDUM_SHA256);
  validateAddendum(loadJson(ADDENDUM_PATH));
});

test('v1.2 comparator addendum: old and new implementation pins form one source chain', () => {
  const addendum = loadJson(ADDENDUM_PATH);
  const methodRecord = loadJson(METHOD_PATH);

  assert.equal(sha256File(METHOD_PATH), EXPECTED_METHOD_SHA256);
  assert.equal(addendum.amends.sha256, sha256File(METHOD_PATH));
  assert.equal(methodRecord.status, addendum.amends.status);
  assert.equal(
    methodRecord.pinsAvailableInAdvance.currentImplementation[SCRIPT_REL],
    EXPECTED_OLD_SCRIPT_PIN,
  );
  assert.equal(addendum.currentImplementation.supersedesPin, EXPECTED_OLD_SCRIPT_PIN);
  assert.equal(addendum.currentImplementation[SCRIPT_REL], EXPECTED_NEW_SCRIPT_PIN);
  // This record's pin is a HISTORICAL claim and stays asserted above
  // (SUPERSEDE_NO_DELETE). What the LIVE file must match is the youngest link
  // of the chain — the bound-manifest resolution addendum superseded this one.
  // Asserting the live file against a literal here was the same self-standing
  // pin N13 named in the other enforcer: it cannot know it has been superseded.
  assert.equal(sha256File(SCRIPT_PATH), pinChain.resolvePin(SCRIPT_REL));
  assert.notEqual(pinChain.resolvePin(SCRIPT_REL), EXPECTED_NEW_SCRIPT_PIN,
    'the chain must resolve past this record once a younger link supersedes it');
});

test('v1.2 comparator addendum: a shape-stable second-rerun mutation is rejected', () => {
  const mutated = structuredClone(loadJson(ADDENDUM_PATH));
  mutated.authorizedRerun.count = 2;

  assert.throws(
    () => validateAddendum(mutated),
    /authorized rerun count must remain exactly one/,
  );
});
