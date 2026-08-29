'use strict';

// T172 -- the access ledger has exactly one appender: main.
//
// The object is the contract. These checks pin the required route in both
// directions: the main-first sequence must be present, while branch escape
// hatches and retroactive closure of the motivating deviation must be absent.
//
// H9 REBUILD (ENTSCHIED 67). The enforcement half of this file used to be
// assert.match against the SOURCE TEXT of two other files. That proved a document
// quotes a rule; it executed nothing, and a regex over a guard's source cannot tell
// whether the guard actually catches anything. Worse, the anchor it quoted -- the R1
// git-prefix invariant -- is structurally blind to the very violation this record
// forbids: a branch-side append keeps every committed revision a byte-identical
// prefix, so the prefix check passes, and a well-formed entry passes the chain check
// too. Both blindnesses are now DEMONSTRATED, not assumed.
//
// The enforcement is therefore probed by EXECUTION: a throwaway git repository is
// built in a temp directory, a real commit appends a real, chain-valid entry to a copy
// of the real ledger on a study branch, and lib/ledger-single-appender.js must go red
// on it -- while the clean branch and the prescribed ledger-only mini-PR stay green.
// The live ledger on main is only ever READ; nothing here writes to it or pushes.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  checkSingleAppender,
  resolveBaseRef,
  SingleAppenderViolation,
} = require('../lib/ledger-single-appender');
const { pruefeZugriffsRegister, haengeEintragAn } = require('../lib/studie-verfassung');

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

const LEDGER_REL = 'protocol/early-detection/2.0.0/outcome-access-ledger.json';

// ── Sabotage fixture: a THROWAWAY repository, never the live checkout ──────────
//
// Hermetic by construction: `git init` in a temp directory, no network, no reuse of
// the real .git, nothing pushed. The only thing borrowed from the live repository is
// the ledger's BYTES, read once, so the probe runs against the real shape rather than
// a toy object. The live ledger is never written.

const gitIn = (dir, ...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });

const writeInto = (dir, relative, text) => {
  const abs = path.join(dir, ...relative.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
};

const commitAll = (dir, message) => {
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '--quiet', '-m', message);
};

// The sabotage appends through the SAME lib the study code uses, so the planted entry
// is genuinely chain-valid. A malformed entry would prove nothing: the point is that a
// perfectly legal entry on the wrong branch must still be caught.
const ledgerTextMitAnhang = () => {
  const register = haengeEintragAn(readJson(LEDGER_REL), {
    runId: 't172-sabotage-probe',
    typ: 'R15b_NUR_ZAEHLEN',
    registeredAt: '2026-12-20T10:00:00.000Z',
    accessedAt: null,
  });
  return JSON.stringify(register, null, 2);
};

function withFixture(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't172-appender-probe-'));
  try {
    execFileSync('git', ['-c', 'init.defaultBranch=main', 'init', '--quiet', dir]);
    gitIn(dir, 'config', 'user.email', 'probe@example.invalid');
    gitIn(dir, 'config', 'user.name', 'T172 probe');
    gitIn(dir, 'config', 'commit.gpgsign', 'false');
    gitIn(dir, 'config', 'core.autocrlf', 'false');

    writeInto(dir, LEDGER_REL, readText(LEDGER_REL));
    writeInto(dir, 'scripts/studie.js', '// main tail\n');
    commitAll(dir, 'main tail: ledger as delivered');

    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

// Sabotage branch, in the shape the rule forbids: study work and a ledger append in
// the same branch. `commits: 2` splits the append into its own commit -- the obvious
// evasion of a per-commit check.
function sabotiereZweig(dir, { commits = 1 } = {}) {
  gitIn(dir, 'checkout', '--quiet', '-b', 'studie/sabotage');
  if (commits === 2) {
    writeInto(dir, 'scripts/studie.js', '// study work\n');
    commitAll(dir, 'study work');
    writeInto(dir, LEDGER_REL, ledgerTextMitAnhang());
    commitAll(dir, 'register the access entry');
  } else {
    writeInto(dir, 'scripts/studie.js', '// study work\n');
    writeInto(dir, LEDGER_REL, ledgerTextMitAnhang());
    commitAll(dir, 'study work + access-ledger entry');
  }
}

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

  // Existence, not source-text regexes. A regex over another file's internals rots on
  // the first rename and never showed that anything fires; what the enforcement DOES
  // is settled by the executed probes below.
  assert.ok(fs.existsSync(path.join(ROOT, ...PREFIX_GUARD_REL.split('/'))), `${PREFIX_GUARD_REL} fehlt`);
  assert.ok(fs.existsSync(path.join(ROOT, ...SERVER_PROOF_REL.split('/'))), `${SERVER_PROOF_REL} fehlt`);
});

// ── EXECUTED PROBES ───────────────────────────────────────────────────────────

test('T172 probe: an executed branch-side ledger append is CAUGHT', () => {
  withFixture((dir) => {
    sabotiereZweig(dir);

    let bruch = null;
    try {
      checkSingleAppender({ repoDir: dir, baseRef: 'main', headRef: 'studie/sabotage' });
    } catch (fehler) {
      bruch = fehler;
    }
    assert.ok(bruch instanceof SingleAppenderViolation, 'the branch-side append went through');
    // The message must name the evidence, not just say no.
    assert.match(bruch.message, /outcome-access-ledger\.json/);
    assert.match(bruch.message, /scripts\/studie\.js/);
  });
});

test('T172 probe: splitting the append into its own commit does not buy an escape', () => {
  // Why the check looks at the whole range instead of each commit: a study branch that
  // puts the append in a separate commit is still a study branch carrying an append.
  withFixture((dir) => {
    sabotiereZweig(dir, { commits: 2 });
    assert.throws(
      () => checkSingleAppender({ repoDir: dir, baseRef: 'main', headRef: 'studie/sabotage' }),
      SingleAppenderViolation,
    );
  });
});

test('T172 probe: chain check and git-prefix anchor are BLIND to that same append', () => {
  // The load-bearing claim of this rebuild, executed rather than asserted: the two
  // incumbent guards wave the sabotage through, so the record's enforcement section
  // named nothing that could have stopped it.
  withFixture((dir) => {
    sabotiereZweig(dir);
    const sabotiert = JSON.parse(fs.readFileSync(path.join(dir, ...LEDGER_REL.split('/')), 'utf8'));

    // R1 chain check: green — the planted entry is genuinely well formed.
    assert.doesNotThrow(() => pruefeZugriffsRegister(sabotiert));

    // R1 git-prefix anchor: green — appending is exactly what a prefix invariant allows.
    const revisionen = gitIn(dir, 'log', '--format=%H', '--', LEDGER_REL).trim().split('\n').filter(Boolean);
    assert.equal(revisionen.length, 2, 'expects the main tail and the branch-side append');
    for (const rev of revisionen) {
      const alt = JSON.parse(gitIn(dir, 'show', `${rev}:${LEDGER_REL}`)).events;
      assert.ok(alt.length <= sabotiert.events.length);
      alt.forEach((event, i) => {
        assert.equal(JSON.stringify(event), JSON.stringify(sabotiert.events[i]));
      });
    }

    // Only the single-appender guard goes red.
    assert.throws(
      () => checkSingleAppender({ repoDir: dir, baseRef: 'main', headRef: 'studie/sabotage' }),
      SingleAppenderViolation,
    );
  });
});

test('T172 probe: the clean branch and the prescribed mini-PR stay GREEN', () => {
  // A guard that only ever says no is untested in the direction that matters daily.
  withFixture((dir) => {
    gitIn(dir, 'checkout', '--quiet', '-b', 'studie/sauber');
    writeInto(dir, 'scripts/studie.js', '// study work only\n');
    commitAll(dir, 'study work without any ledger touch');
    assert.equal(
      checkSingleAppender({ repoDir: dir, baseRef: 'main', headRef: 'studie/sauber' }).verdict,
      'NO_LEDGER_APPEND',
    );

    gitIn(dir, 'checkout', '--quiet', 'main');
    gitIn(dir, 'checkout', '--quiet', '-b', 'anmeldung/mini-pr');
    writeInto(dir, LEDGER_REL, ledgerTextMitAnhang());
    commitAll(dir, 'register the access entry (ledger only)');
    assert.equal(
      checkSingleAppender({ repoDir: dir, baseRef: 'main', headRef: 'anmeldung/mini-pr' }).verdict,
      'LEDGER_ONLY_MINI_PR',
    );
  });
});

test('T172: the live checkout carries no branch-side ledger append', () => {
  // Read-only against the real repository, so the guard is an anchor in CI and not a
  // fixture-only ornament. On main the range is empty and the verdict trivially clean;
  // on a branch it is the actual verdict for that branch.
  const base = resolveBaseRef(ROOT, ['origin/main', 'main']);
  assert.ok(
    base,
    'neither origin/main nor main resolves — the base of comparison is missing. '
    + 'Loud, not skipped: a guard that cannot name its base proves nothing.',
  );
  const { verdict } = checkSingleAppender({ repoDir: ROOT, baseRef: base });
  assert.ok(['NO_LEDGER_APPEND', 'LEDGER_ONLY_MINI_PR'].includes(verdict), verdict);
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
