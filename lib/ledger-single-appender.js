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

// G7 - DIE GEORDNETE MENGE. Das Register ist nach dem Rollover ZWEI Dateien:
// die geschlossene und ihre Fortsetzung. Ein Waechter, der auf GLEICHHEIT mit
// EINEM Pfad prueft, ist danach in beide Richtungen falsch - falsch-gruen,
// wenn ein Zweig die Fortsetzung neben fremdem Code anhaengt (er sieht den
// alten Pfad nicht und meldet NO_LEDGER_APPEND), und falsch-rot bei einem
// reinen Fortsetzungs-Mini-PR (die Fortsetzung gilt ihm als Fremdpfad).
// Geprueft wird deshalb MITGLIEDSCHAFT in der Menge.
//
// G10/LR-14: die Menge wird IMPORTIERT, nicht getippt. Sie stand hier und ein
// zweites Mal im Serverzeit-Werkzeug; zwei Kopien derselben Regel driften, und
// die eine, die zurueckbleibt, faellt ihr Urteil dann ueber die falsche Datei.
// Die Reihenfolge ist bedeutungstragend: [0] ist die zuerst beschriebene Datei.
// Der Naht-PR, der BEIDE anfasst, bleibt gruen - beide sind Mitglieder.
const { REGISTER_RELS: LEDGER_RELS } = require('./studie-verfassung.js');
// Rueckwaertskompatibel: Aufrufer, die EINEN Pfad uebergeben, bleiben gueltig.
const LEDGER_REL = LEDGER_RELS[0];

class SingleAppenderViolation extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SingleAppenderViolation';
    // The evidence travels with the verdict: a caller that wants to list the offending
    // paths must not have to re-parse the message string.
    Object.assign(this, details);
  }
}

const git = (repoDir, args) => execFileSync('git', args, { cwd: repoDir, encoding: 'utf8' });

/**
 * @returns {{verdict: 'NO_LEDGER_APPEND'|'LEDGER_ONLY_MINI_PR', changed: string[], foreignPaths: string[]}}
 * @throws {SingleAppenderViolation} when the range appends the ledger alongside other work.
 */
function checkSingleAppender({
  repoDir, baseRef, headRef = 'HEAD', ledgerRel, ledgerRels,
}) {
  if (!repoDir) throw new TypeError('checkSingleAppender: repoDir is required');
  if (!baseRef) throw new TypeError('checkSingleAppender: baseRef is required');
  // Ein einzeln uebergebener Pfad bleibt zulaessig und wird zur einelementigen
  // Menge - sonst braeche jeder bestehende Aufrufer an der Vollendung.
  const rels = ledgerRel ? [ledgerRel] : (ledgerRels || LEDGER_RELS);
  // git reports paths with forward slashes on every platform. A backslash-joined
  // ledgerRel would match nothing and hand back a clean verdict for the wrong reason —
  // the one silent failure this file exists to prevent. Refuse it loudly instead.
  for (const rel of rels) {
    if (rel.includes('\\')) {
      throw new TypeError(`checkSingleAppender: ledgerRel must use forward slashes, got ${rel}`);
    }
  }

  // Three dots, not two: a base branch that moved on independently must not colour the
  // verdict. Only what THIS head added since the fork point is on trial.
  const changed = git(repoDir, ['diff', '--name-only', `${baseRef}...${headRef}`])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  // MITGLIEDSCHAFT, nicht Gleichheit: beruehrt der Zweig KEINE der
  // Registerdateien, ist nichts angehaengt worden.
  const beruehrteRegister = changed.filter((p) => rels.includes(p));
  if (beruehrteRegister.length === 0) {
    return { verdict: 'NO_LEDGER_APPEND', changed, foreignPaths: [] };
  }

  const foreignPaths = changed.filter((p) => !rels.includes(p));
  if (foreignPaths.length > 0) {
    const shown = foreignPaths.slice(0, 5).join(', ');
    throw new SingleAppenderViolation(
      `branch-side ledger append: ${baseRef}...${headRef} touches `
      + `${beruehrteRegister.join(', ')} together with `
      + `${foreignPaths.length} other path(s) [${shown}${foreignPaths.length > 5 ? ', …' : ''}]. `
      + 'The ledger has exactly one appender (main); an entry reaches main through its own '
      + 'ledger-only mini-PR and is consumed only after it landed there (ENTSCHIED 7).',
      { changed, foreignPaths },
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
    } catch (fehler) {
      // A ref that simply does not exist is the expected miss: git ran and said no, so
      // `status` is a number. Anything else — git not installed, unusable cwd, broken
      // .git — is a BROKEN MEASUREMENT, not a miss, and must not be laundered into
      // "no base found". A guard that cannot run must say so, not shrug.
      if (typeof fehler.status !== 'number') throw fehler;
    }
  }
  return null;
}

module.exports = { checkSingleAppender, resolveBaseRef, SingleAppenderViolation, LEDGER_REL };
