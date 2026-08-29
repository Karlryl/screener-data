'use strict';

// T172 single-appender guard (ENTSCHIED 7) — an EXECUTED check, not a claim about one.
//
// THE OBJECT: the outcome access ledger has exactly one appender, main. Study and
// implementation branches never carry a ledger append; an entry reaches main through
// its own ledger-only mini-PR and is consumed only after it landed there.
//
// WHY THIS FILE EXISTS. The governance record names the R1 prefix anchor
// (tests/studie-r1-register.test.js) as its enforcement, but that anchor is
// STRUCTURALLY BLIND to a branch-side append: appending is exactly the operation the
// prefix invariant permits. A branch that adds one chain-valid entry keeps every
// committed revision a byte-identical prefix of its own tip, and the chain check
// (pruefeZugriffsRegister) passes too, because the entry is genuinely well formed.
// Prefix and chain catch rewrites, deletions and insertions. Nothing caught the append.
// tests/studie-register-single-appender-rule.test.js proves both blindnesses by
// executing them on a sabotage fixture.
//
// THE RULE IN GIT TERMS: look at what the head added since it forked off base. If the
// ledger is not among those paths, there is nothing to judge. If it is, the range must
// contain the ledger and NOTHING ELSE — that is the ledger-only mini-PR the rule
// prescribes. The check is deliberately range-wide and not per-commit: splitting the
// append into its own commit inside a study branch is the obvious evasion, and a
// per-commit check would wave it through.
//
// HONEST LIMIT: this guard reads git topology, not intent. A ledger-only branch that is
// never merged before the access happens looks exactly like a legitimate mini-PR here.
// That hole is closed by the independent server-time proof (scripts/studie-r1-serverzeit.js),
// which requires the entry to be observable on main before the first access.

const { execFileSync } = require('node:child_process');

const LEDGER_REL = 'protocol/early-detection/2.0.0/outcome-access-ledger.json';

class SingleAppenderViolation extends Error {}

const git = (repoDir, args) => execFileSync('git', args, { cwd: repoDir, encoding: 'utf8' });

/**
 * @returns {{verdict: 'NO_LEDGER_APPEND'|'LEDGER_ONLY_MINI_PR', changed: string[], foreignPaths: string[]}}
 * @throws {SingleAppenderViolation} when the range appends the ledger alongside other work.
 */
function checkSingleAppender({ repoDir, baseRef, headRef = 'HEAD', ledgerRel = LEDGER_REL }) {
  if (!repoDir) throw new TypeError('checkSingleAppender: repoDir is required');
  if (!baseRef) throw new TypeError('checkSingleAppender: baseRef is required');

  // Three dots, not two: a base branch that moved on independently must not colour the
  // verdict. Only what THIS head added since the fork point is on trial.
  const changed = git(repoDir, ['diff', '--name-only', `${baseRef}...${headRef}`])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (!changed.includes(ledgerRel)) {
    return { verdict: 'NO_LEDGER_APPEND', changed, foreignPaths: [] };
  }

  const foreignPaths = changed.filter((p) => p !== ledgerRel);
  if (foreignPaths.length > 0) {
    const shown = foreignPaths.slice(0, 5).join(', ');
    throw new SingleAppenderViolation(
      `branch-side ledger append: ${baseRef}...${headRef} touches ${ledgerRel} together with `
      + `${foreignPaths.length} other path(s) [${shown}${foreignPaths.length > 5 ? ', …' : ''}]. `
      + 'The ledger has exactly one appender (main); an entry reaches main through its own '
      + 'ledger-only mini-PR and is consumed only after it landed there (ENTSCHIED 7).',
    );
  }

  return { verdict: 'LEDGER_ONLY_MINI_PR', changed, foreignPaths: [] };
}

/** First of `candidates` that resolves to a commit in `repoDir`, else null. */
function resolveBaseRef(repoDir, candidates) {
  for (const ref of candidates) {
    try {
      execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
        cwd: repoDir,
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      return ref;
    } catch {
      // next candidate
    }
  }
  return null;
}

module.exports = { checkSingleAppender, resolveBaseRef, SingleAppenderViolation, LEDGER_REL };
