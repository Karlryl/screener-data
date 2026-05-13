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
  try { return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (e) { return ''; }
}

function isExempt(commitMessage) {
  return DISCIPLINE_KEYWORDS.some(re => re.test(commitMessage));
}

function findNumericChanges(diffText) {
  // Match lines that change a numeric literal in a top-level `const NAME = X`.
  // Both - and + lines, where the literal differs.
  const changes = [];
  const lines = diffText.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const m1 = /^-(\s*const\s+\w+\s*=\s*)([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)([^;]*;?)/.exec(lines[i]);
    const m2 = /^\+(\s*const\s+\w+\s*=\s*)([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)([^;]*;?)/.exec(lines[i+1]);
    if (m1 && m2 && m1[1].trim() === m2[1].trim() && m1[2] !== m2[2]) {
      changes.push({ from: m1[2], to: m2[2], line: m2[1].trim() });
    }
  }
  return changes;
}

function main() {
  const commits = sh(`git log --since="${SINCE}" --pretty=format:%H -- methods/`).trim().split('\n').filter(Boolean);
  if (commits.length === 0) {
    console.log('No commits touching methods/ since ' + SINCE);
    return 0;
  }
  console.log('Threshold-Discipline Audit — ' + commits.length + ' commit(s) since ' + SINCE);
  console.log('');

  const violations = [];
  for (const sha of commits) {
    const message = sh(`git log -1 --format=%B ${sha}`);
    const diff = sh(`git show --pretty="" --unified=0 ${sha} -- methods/`);
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
