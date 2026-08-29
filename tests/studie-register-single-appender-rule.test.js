'use strict';

// T172 -- the access ledger has exactly one appender: main.
//
// The object is the contract. These checks pin the required route in both
// directions: the main-first sequence must be present, while branch escape
// hatches and retroactive closure of the motivating deviation must be absent.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const RECORD_REL = 'protocol/early-detection/2.0.0/register-single-appender-rule.json';
const PRECEDENT_REL = 'protocol/early-detection/2.0.0/e4d-ledger-fork-deviation-record.json';
const PRECEDENT_SHA256 = 'c3d7fe47ae92c8e764ad007f56a10835c713e8edebd26dac86190fe5f11d0517';
const PREFIX_GUARD_REL = 'tests/studie-r1-register.test.js';
const SERVER_PROOF_REL = 'scripts/studie-r1-serverzeit.js';

const readText = (relative) => fs.readFileSync(path.join(ROOT, ...relative.split('/')), 'utf8');
const readJson = (relative) => JSON.parse(readText(relative));
const sha256 = (relative) => crypto
  .createHash('sha256')
  .update(fs.readFileSync(path.join(ROOT, ...relative.split('/'))))
  .digest('hex');

test('T172: the governance record is present and object-anchored', () => {
  const record = readJson(RECORD_REL);

  assert.deepEqual(Object.keys(record).sort(), [
    'authority',
    'enforcement',
    'mode',
    'precedent',
    'preservation',
    'protocol',
    'recordId',
    'recordedAt',
    'revisionCondition',
    'rule',
    'schema',
    'status',
  ]);

  assert.deepEqual(
    {
      schema: record.schema,
      recordId: record.recordId,
      protocol: record.protocol,
      mode: record.mode,
      recordedAt: record.recordedAt,
      status: record.status,
      authority: record.authority,
    },
    {
      schema: 'early-detection-governance-rule/v1',
      recordId: 'register-single-appender-2026-08-29',
      protocol: 'FEM-SEC-US@2.0.0',
      mode: 'APPEND_ONLY_RULE_NO_RETROACTIVE_REWRITE',
      recordedAt: '2026-08-29',
      status: 'BINDING',
      authority: {
        source: 'Orchestrator-Ruling 2026-08-29',
        decision: 'ENTSCHIED 7',
        decidedAt: '2026-08-29T17:16:00+02:00',
        scope: 'Single-appender governance for protocol/early-detection/2.0.0/outcome-access-ledger.json',
      },
    },
  );
});

test('T172: main-first sequence is exact and branches have no append path', () => {
  const { rule } = readJson(RECORD_REL);

  assert.deepEqual(rule, {
    singleAppender: 'main',
    ledgerAppendsAllowedOnlyInCommitsLandingDirectlyOn: 'main',
    branchLedgerAppendsAllowed: false,
    accessBeforeMainRegistrationAllowed: false,
    branchWorkSequence: [
      'prepare the exact access-ledger entry against the current main tail',
      'submit the access-ledger entry first through a mini-PR targeting main',
      'land the access-ledger entry on main',
      'confirm the main-hosted entry and its independent server time',
      'only then perform the registered data access',
    ],
    timeInvariant: 'registeredAt < serverConfirmedAt < accessedAt <= firstAccessAt',
    branchRule: 'Study and implementation branches never carry outcome-access-ledger appends. They consume an entry that already landed on main.',
  });

  assert.equal(Object.hasOwn(rule, 'branchExceptions'), false);
  assert.equal(Object.hasOwn(rule, 'retroactiveRegistration'), false);
  assert.equal(Object.hasOwn(rule, 'alternateAppender'), false);
});

test('T172: enforcement points to the live prefix and server-time guards', () => {
  const { enforcement } = readJson(RECORD_REL);

  assert.deepEqual(enforcement, {
    gitPrefixAnchor: {
      path: PREFIX_GUARD_REL,
      test: 'R1: jede committete Revision ist byte-identisches Praefix der aktuellen',
      purpose: 'Every committed ledger revision must remain a byte-identical prefix of the current main ledger.',
    },
    governanceRecord: RECORD_REL,
    serverProofTool: SERVER_PROOF_REL,
    failureMode: 'A branch-local append, an entry based on a stale tail, or access before the main-hosted server proof is non-compliant and must not run.',
  });

  const prefixGuard = readText(PREFIX_GUARD_REL);
  assert.match(prefixGuard, /git\('log', '--format=%H', '--', LEDGER_REL\)/);
  assert.match(prefixGuard, /git\('show', `\$\{rev\}:\$\{LEDGER_REL\}`\)/);

  const serverProof = readText(SERVER_PROOF_REL);
  assert.match(serverProof, /const roh = gh\(\['api', '-i', pfad\]\);/);
  assert.match(serverProof, /const datum = \/\^date:\\s\*\(\.\+\)\$\/im\.exec\(kopf\);/);
  assert.match(
    serverProof,
    /Date\.parse\(eintrag\.registeredAt\) >= Date\.parse\(serverConfirmedAt\)/,
  );
  assert.match(
    serverProof,
    /pruefeServerzeit\(\{ serverConfirmedAt, ersterZugriffAm: eintrag\.accessedAt \}\);/,
  );
});

test('T172: motivating precedent is pinned without closing or rewriting it', () => {
  const record = readJson(RECORD_REL);
  const precedent = readJson(PRECEDENT_REL);

  assert.deepEqual(record.precedent, {
    path: PRECEDENT_REL,
    recordId: 'e4d-ledger-fork-2026-08-29',
    sha256: PRECEDENT_SHA256,
    lesson: 'Append-only plus monotone registration time has no safe merge semantics when parallel branches append to the same tail.',
    referenceOnly: true,
    expectedResidualDebtClosedBy: null,
  });
  assert.equal(sha256(PRECEDENT_REL), PRECEDENT_SHA256);
  assert.equal(precedent.recordId, record.precedent.recordId);
  assert.equal(precedent.residualDebt.closedBy, null);

  assert.deepEqual(record.preservation, {
    deviationRecordEdited: false,
    deviationRecordResidualDebtClosed: false,
    constitutionChanged: false,
    ledgerChangedByThisRecord: false,
    sealChanged: false,
    confirmatoryVerdictsChanged: 0,
    endtestOpened: false,
  });
});

test('T172: revision requires the named operational condition and no local bypass', () => {
  const { revisionCondition } = readJson(RECORD_REL);

  assert.deepEqual(revisionCondition, {
    condition: 'The mini-PR step demonstrably throttles the cadence of legitimate registered probes in real operation.',
    action: 'Return the rule to the Orchestrator for an explicit revision; never create a branch exception locally.',
  });
});
