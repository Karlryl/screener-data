'use strict';
// Untangle finding F003 (13.11.2026): the gh-pages force-push retry loop existed four times in daily-pull.yml, and only
// two copies carried the T568-F5 fix. In the other two (merge deploy, scoring deploy) a failed `git fetch` silently
// skipped the reset and the next attempt force-pushed the job's minutes-old clone, which can roll back a newer
// gh-pages state. Class guard: EVERY retry loop in any workflow that force-pushes gh-pages fetches first, resets on
// success, and on a failed fetch with an existing ref goes to the next attempt instead of pushing.
// Run: node tests/ghpages-deploy-loops.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.resolve(__dirname, '..', '.github', 'workflows');

/** Every `for i in ...; do` loop (up to the `done` at the same indentation) that force-pushes gh-pages. */
function forcePushLoops(text, file) {
  const lines = text.split('\n'), loops = [];
  lines.forEach((line, i) => {
    const m = /^(\s*)for i in [\d ]+; do\s*$/.exec(line);
    if (!m) return;
    const end = lines.findIndex((l, j) => j > i && l === m[1] + 'done');
    assert.ok(end > i, `${file}:${i + 1}: loop without a matching done`);
    const body = lines.slice(i + 1, end).filter(l => !/^\s*#/.test(l));
    if (body.some(l => /git push --force origin gh-pages\b/.test(l))) loops.push({ file, line: i + 1, body });
  });
  return loops;
}

/** Problems of one loop body against the T568-F5 shape; empty when hardened. */
function problems(body) {
  const out = [], code = body.map(l => l.trim()).filter(Boolean);
  // The merge and scoring deploys clone gh-pages seconds before the loop, so attempt 1 may skip the fetch
  // (tests/scoring/h-ghpages-deploy-retry-test.js); the fetch then is the first command of the attempt>1 block.
  const first = /^if \[ "\$i" -gt 1 \]; then$/.test(code[0] || '') ? code[1] : code[0];
  if (!/^if git fetch origin gh-pages; then$/.test(first || '')) out.push('first command is not `if git fetch origin gh-pages; then` (error visible, outcome decides)');
  const iReset = code.findIndex(l => l === 'git reset --hard origin/gh-pages');
  const iElif = code.findIndex(l => /^elif git rev-parse --verify -q origin\/gh-pages\b/.test(l));
  const iContinue = code.findIndex((l, j) => j > iElif && l === 'continue');
  const iPush = code.findIndex(l => /git push --force origin gh-pages\b/.test(l));
  if (iReset < 0 || iReset > iElif) out.push('no reset to origin/gh-pages in the fetch-success branch');
  if (iElif < 0 || iContinue < 0 || iContinue > iPush) out.push('a failed fetch with an existing origin/gh-pages does not skip to the next attempt before the push');
  if (code.some(l => /git fetch origin gh-pages\s+2>\/dev\/null/.test(l))) out.push('fetch error is hidden with 2>/dev/null');
  return out;
}

const loops = fs.readdirSync(DIR).filter(f => /\.ya?ml$/.test(f)).flatMap(f => forcePushLoops(fs.readFileSync(path.join(DIR, f), 'utf8').replace(/\r\n/g, '\n'), f));

test('the guard finds the gh-pages force-push loops of daily-pull.yml', () => {
  assert.ok(loops.filter(l => l.file === 'daily-pull.yml').length >= 4, 'found: ' + loops.map(l => l.file + ':' + l.line).join(', '));
});

test('every gh-pages force-push loop fetches first and never force-pushes a stale clone', () => {
  const bad = loops.map(l => ({ at: l.file + ':' + l.line, p: problems(l.body) })).filter(x => x.p.length);
  assert.deepEqual(bad, []);
});

test('break-once on test data: the pre-fix shape of the merge deploy is caught', () => {
  const stale = [
    'if [ "$i" -gt 1 ]; then',
    '  if git fetch origin gh-pages 2>/dev/null && git rev-parse --verify -q origin/gh-pages >/dev/null 2>&1; then',
    '    git reset --hard origin/gh-pages',
    '  fi',
    'fi',
    'git add -A',
    'git commit -m "deploy"',
    'if git push --force origin gh-pages; then exit 0; fi',
  ];
  const p = problems(stale);
  assert.ok(p.length >= 3, p.join('; '));
  const guardedFixed = [
    'if [ "$i" -gt 1 ]; then',
    '  if git fetch origin gh-pages; then',
    '    if git rev-parse --verify -q origin/gh-pages >/dev/null 2>&1; then',
    '      git reset --hard origin/gh-pages',
    '    fi',
    '  elif git rev-parse --verify -q origin/gh-pages >/dev/null 2>&1; then',
    '    sleep $((5 * i))',
    '    continue',
    '  fi',
    'fi',
    'if git push --force origin gh-pages; then exit 0; fi',
  ];
  assert.deepEqual(problems(guardedFixed), []);
  const hardened = [
    'if git fetch origin gh-pages; then',
    '  if git rev-parse --verify -q origin/gh-pages >/dev/null 2>&1; then',
    '    git reset --hard origin/gh-pages',
    '  fi',
    'elif git rev-parse --verify -q origin/gh-pages >/dev/null 2>&1; then',
    '  echo "::warning::fetch failed"',
    '  sleep $((5 * i))',
    '  continue',
    'fi',
    'git add -A',
    'if git push --force origin gh-pages; then exit 0; fi',
  ];
  assert.deepEqual(problems(hardened), []);
});
