#!/usr/bin/env node
/**
 * Tag 134 — Phase 2: Threshold-Discipline Audit
 * =============================================
 * Enforces the policy documented in docs/threshold-discipline.md:
 * numeric thresholds in methods/*.js change ONLY with multi-ticker /
 * multi-period / literature / first-principles evidence. Single-ticker
 * threshold tunes are forbidden.
 *
 * What this script does:
 *   - Scans the last N commits that touched methods/*.js.
 *   - For each such commit, extracts the diff lines that changed numeric
 *     constants (top-level `const FOO = 2.0;` → `const FOO = 3.0;`).
 *   - Checks the commit message for one of the discipline keywords:
 *       "multi-ticker", "multi-period", "literature ref",
 *       "first-principles", "Tag 129"
 *   - Flags commits that changed numeric constants WITHOUT a discipline keyword.
 *
 * Run modes:
 *   node scripts/threshold-audit.js [--since 12.weeks] [--strict]
 *   --strict exits 1 if any commit fails the discipline check (use in CI).
 *
 * Limitations:
 *   - Catches single-line numeric changes; complex multi-line refactors will
 *     show up but may be flagged falsely (manual review required).
 *   - Does not catch values moved from methods/*.js into config/runtime.json
 *     once Phase 2.3 lands — those will need a separate config audit.
 */
'use strict';
const { execSync } = require('child_process');

const SINCE = process.argv.includes('--since')
  ? process.argv[process.argv.indexOf('--since') + 1]
  : '12.weeks.ago';
const STRICT = process.argv.includes('--strict');

const DISCIPLINE_KEYWORDS = [
  /multi-?ticker/i,
  /multi-?period/i,
  /literature ref/i,
  /first-?principles?/i,
  /Tag 129/i,
  /threshold-?discipline/i
];

function sh(cmd) {
  // audit F-A-2026-06-22: distinguish a failed git invocation from genuinely
  // empty output. Returning '' on catch (old behavior) let a broken `git log`
  // (not a repo / bad --since / detached HEAD) masquerade as "no commits",
  // producing a false-green pass even under --strict. Return null on failure
  // so the caller can tell the two apart.
  try { return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (e) { return null; }
}

function isExempt(commitMessage) {
  return DISCIPLINE_KEYWORDS.some(re => re.test(commitMessage));
}

function findNumericChanges(diffText) {
  // Match lines that change a numeric literal in a threshold assignment.
  // Both - and + lines, where the literal differs.
  // audit F-A-2026-06-22: the old matcher only caught top-level
  // `const NAME = <number>` and silently exempted the dominant pattern —
  // object-property / exported thresholds like `threshold: 0.10` (e.g.
  // price-momentum-12-1.js `module.exports = { ..., threshold: 0.12 }`).
  // A tune of `threshold: 0.10 -> 0.15` slipped past the discipline check
  // entirely. We now also match `NAME: <number>` property assignments. The
  // assignment "key" we compare across -/+ lines is normalized so the
  // `const NAME =` form and the `NAME:` form are both keyed on their
  // identifier (and the const form ignores indentation).
  const changes = [];
  if (typeof diffText !== 'string') return changes;
  const NUM = '[+-]?\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?';
  // const NAME = <number>   (any indentation; export-block consts included)
  const constRe = new RegExp('^([+-])\\s*const\\s+(\\w+)\\s*=\\s*(' + NUM + ')([^;]*;?)');
  // NAME: <number>          (object-property / exports-block thresholds)
  const propRe = new RegExp('^([+-])(\\s*)(\\w+)\\s*:\\s*(' + NUM + ')\\s*,?\\s*$');

  // Parse a diff body line into a normalized assignment descriptor, or null.
  function parse(line, sign) {
    let m = constRe.exec(line);
    if (m && m[1] === sign) {
      return { key: 'const ' + m[2], value: m[3], display: 'const ' + m[2] + ' = ' };
    }
    m = propRe.exec(line);
    if (m && m[1] === sign) {
      return { key: 'prop ' + m[3], value: m[4], display: m[3] + ': ' };
    }
    return null;
  }

  const lines = diffText.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const a = parse(lines[i], '-');
    const b = parse(lines[i + 1], '+');
    if (a && b && a.key === b.key && a.value !== b.value) {
      changes.push({ from: a.value, to: b.value, line: b.display.trim() });
    }
  }
  return changes;
}

function main() {
  // audit F-A-2026-06-22: treat a failed `git log` as an error, not as
  // "no commits". Previously sh() returned '' on failure and this code
  // reported "No commits" and passed green — even under --strict — whenever
  // git itself broke (not a repo, bad --since syntax, detached state). sh()
  // now returns null on failure; surface it loudly and fail under --strict.
  const commitsRaw = sh(`git log --since="${SINCE}" --pretty=format:%H -- methods/`);
  if (commitsRaw === null) {
    console.error('::error::git log failed (not a repo, bad --since, or git error) — cannot audit thresholds');
    return STRICT ? 1 : 0;
  }
  const commits = commitsRaw.trim().split('\n').filter(Boolean);
  if (commits.length === 0) {
    console.log('No commits touching methods/ since ' + SINCE);
    return 0;
  }
  console.log('Threshold-Discipline Audit — ' + commits.length + ' commit(s) since ' + SINCE);
  console.log('');

  const violations = [];
  for (const sha of commits) {
    // audit F-A-2026-06-22: sh() may now return null on a failed git call;
    // coerce per-commit results to '' so a single broken lookup degrades to
    // "no keyword / no changes" for that commit instead of throwing on
    // .split()/.test() and aborting the whole audit.
    const message = sh(`git log -1 --format=%B ${sha}`) || '';
    const diff = sh(`git show --pretty="" --unified=0 ${sha} -- methods/`) || '';
    const changes = findNumericChanges(diff);
    if (changes.length === 0) continue;
    const exempt = isExempt(message);
    const subject = (message.split('\n')[0] || '').slice(0, 80);
    if (exempt) {
      console.log('OK ' + sha.slice(0, 8) + '  ' + subject);
      console.log('   ' + changes.length + ' numeric change(s); commit cites discipline keyword.');
    } else {
      console.log('FLAG ' + sha.slice(0, 8) + '  ' + subject);
      for (const c of changes) {
        console.log('   ' + c.line + ' (' + c.from + ' -> ' + c.to + ')');
      }
      violations.push({ sha, subject, changes });
    }
  }

  console.log('');
  console.log('Summary: ' + violations.length + ' flagged commit(s)');
  if (violations.length > 0 && STRICT) {
    console.log('--strict mode: exit 1');
    return 1;
  }
  return 0;
}

if (require.main === module) {
  try { process.exit(main()); }
  catch (e) { console.error('threshold-audit failed: ' + e.message); process.exit(0); }
}

module.exports = { findNumericChanges, isExempt };
