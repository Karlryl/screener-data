'use strict';
// Untangle finding F003 (13.11.2026): the gh-pages force-push retry loop existed four times in daily-pull.yml, and two
// copies force-pushed the job's older clone after a failed `git fetch`, which can roll back a newer gh-pages state.
// Codex review round 1 added: a missing LOCAL ref proves nothing about the remote, so the rule is now: a failed fetch
// never pushes in that attempt, unless `git ls-remote --exit-code` proves the branch absent (exit 2).
// This guard EXECUTES every retry loop of every workflow that force-pushes gh-pages in bash, with git and the file
// commands stubbed, and checks the behaviour in each failure case (not the text order).
// Run: node tests/ghpages-deploy-loops.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DIR = path.resolve(__dirname, '..', '.github', 'workflows');
const PUSH = /git push (--force|-f)\b[^\n]*\bgh-pages\b/;

/** Every `for <var> in ...; do` loop (up to the `done` at the same indentation) that force-pushes gh-pages. */
function forcePushLoops(text, file) {
  const lines = text.split('\n'), loops = [];
  lines.forEach((line, i) => {
    const m = /^(\s*)for (\w+) in [^;]+; do\s*$/.exec(line);
    if (!m) return;
    const end = lines.findIndex((l, j) => j > i && l === m[1] + 'done');
    assert.ok(end > i, `${file}:${i + 1}: loop without a matching done`);
    const block = lines.slice(i, end + 1);
    if (block.some(l => !/^\s*#/.test(l) && PUSH.test(l))) loops.push({ file, line: i + 1, variable: m[2], script: block.map(l => l.slice(m[1].length)).join('\n') });
  });
  return loops;
}

const loops = fs.readdirSync(DIR).filter(f => /\.ya?ml$/.test(f))
  .flatMap(f => forcePushLoops(fs.readFileSync(path.join(DIR, f), 'utf8').replace(/\r\n/g, '\n'), f));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ghpages-loops-'));
/**
 * Runs one loop in bash (-eo pipefail like GitHub Actions) with stubbed git and file commands.
 * scenario: fetch rc per attempt, ls-remote rc, push rc per attempt. Returns the call log grouped by attempt.
 */
function run(loop, scenario) {
  const log = path.join(tmp, `log-${loop.line}-${scenario.name}.txt`);
  const rc = (list, n) => list[Math.min(n, list.length) - 1];
  const stub = `
ATT=0
log() { echo "$ATT $*" >> "${log.replace(/\\/g, '/')}"; }
rcof() { local list=($1); local n=$ATT; [ $n -gt \${#list[@]} ] && n=\${#list[@]}; echo \${list[$((n-1))]}; }
git() {
  case "$1" in
    fetch) log fetch; return $(rcof "${scenario.fetch.join(' ')}") ;;
    ls-remote) log ls-remote; return ${scenario.lsRemote} ;;
    rev-parse) log rev-parse; return ${scenario.localRef ? 0 : 1} ;;
    reset) log reset; return 0 ;;
    diff) log diff; return 1 ;;
    push) log push; return $(rcof "${scenario.push.join(' ')}") ;;
    *) log "git $1"; return 0 ;;
  esac
}
cp() { :; }; mkdir() { :; }; rm() { :; }; cmp() { return 0; }; sleep() { :; }
`;
  // The attempt counter follows the loop variable; GitHub expressions are replaced by a placeholder.
  const body = loop.script.replace(/\$\{\{[^}]*\}\}/g, 'X')
    .replace(new RegExp(`^(for ${loop.variable} in [^;]+; do)$`, 'm'), `$1\nATT=$((ATT+1))`);
  const r = spawnSync('bash', ['-eo', 'pipefail', '-c', stub + '\n' + body + '\nexit 0'], { encoding: 'utf8', cwd: tmp });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
  const byAttempt = {};
  for (const c of calls) { const [a, what] = c.split(' '); (byAttempt[a] = byAttempt[a] || []).push(what); }
  return { code: r.status, byAttempt, stderr: r.stderr };
}

/** Attempts in which a fetch failed and ls-remote did not prove the branch absent, yet a push happened. */
function stalePushes(result, scenario) {
  return Object.entries(result.byAttempt).filter(([a, calls]) => {
    const fetched = calls.includes('fetch');
    const fetchRc = scenario.fetch[Math.min(Number(a), scenario.fetch.length) - 1];
    return fetched && fetchRc !== 0 && scenario.lsRemote !== 2 && calls.includes('push');
  }).map(([a]) => Number(a));
}

const bashOk = spawnSync('bash', ['-c', 'exit 0']).status === 0;

test('the guard finds the gh-pages force-push loops of daily-pull.yml', () => {
  assert.ok(loops.filter(l => l.file === 'daily-pull.yml').length >= 4, 'found: ' + loops.map(l => l.file + ':' + l.line).join(', '));
});

test('every gh-pages force-push loop: a failed fetch never pushes a stale clone; a proven-absent branch may be created', { skip: !bashOk && 'bash not available' }, () => {
  const scenarios = [
    // push 1 fails (or fetch 1 fails), then every later fetch fails while the branch exists remotely
    { name: 'fetch-fails-branch-exists', fetch: [1, 1, 1], lsRemote: 0, localRef: true, push: [1, 0, 0] },
    // same, but the local ref is missing (e.g. a git-init clone): the local ref proves nothing
    { name: 'fetch-fails-no-local-ref', fetch: [1, 1, 1], lsRemote: 0, localRef: false, push: [1, 0, 0] },
    // transport error on ls-remote as well
    { name: 'fetch-and-ls-remote-fail', fetch: [1, 1, 1], lsRemote: 128, localRef: false, push: [1, 0, 0] },
  ];
  const bad = [];
  for (const loop of loops) for (const s of scenarios) {
    const r = run(loop, s);
    const stale = stalePushes(r, s);
    if (stale.length) bad.push(`${loop.file}:${loop.line} ${s.name}: push after a failed fetch in attempt ${stale.join(', ')}`);
  }
  assert.deepEqual(bad, []);
  // Positive controls: a working fetch resets before the push; a proven-absent branch (ls-remote exit 2) is created.
  for (const loop of loops) {
    const ok = run(loop, { name: 'fetch-ok', fetch: [0, 0, 0], lsRemote: 0, localRef: true, push: [1, 0, 0] });
    const second = ok.byAttempt['2'] || [];
    assert.ok(second.includes('push'), `${loop.file}:${loop.line}: attempt 2 pushes after a good fetch: ${JSON.stringify(ok.byAttempt)}`);
    if (second.includes('fetch')) assert.ok(second.indexOf('reset') > second.indexOf('fetch') && second.indexOf('reset') < second.indexOf('push'), `${loop.file}:${loop.line}: reset between fetch and push`);
    const absent = run(loop, { name: 'branch-absent', fetch: [1, 1, 1], lsRemote: 2, localRef: false, push: [0] });
    assert.ok(Object.values(absent.byAttempt).some(c => c.includes('push')), `${loop.file}:${loop.line}: a proven-absent branch is created`);
  }
});

test('break-once on test data: an unreachable continue and the pre-fix shape are both caught by the executed check', { skip: !bashOk && 'bash not available' }, () => {
  const s = { name: 'mutant', fetch: [1, 1, 1], lsRemote: 0, localRef: true, push: [1, 0, 0] };
  const shapes = {
    preFix: [
      'for i in 1 2 3; do',
      '  if [ "$i" -gt 1 ]; then',
      '    if git fetch origin gh-pages 2>/dev/null && git rev-parse --verify -q origin/gh-pages >/dev/null 2>&1; then',
      '      git reset --hard origin/gh-pages',
      '    fi',
      '  fi',
      '  if git push --force origin gh-pages; then exit 0; fi',
      'done'],
    unreachableContinue: [
      'for i in 1 2 3; do',
      '  if git fetch origin gh-pages; then',
      '    git reset --hard origin/gh-pages',
      '  elif false; then',
      '    continue',
      '  fi',
      '  if git push --force origin gh-pages; then exit 0; fi',
      'done'],
    localRefOnly: [
      'for i in 1 2 3; do',
      '  if git fetch origin gh-pages; then',
      '    git reset --hard origin/gh-pages',
      '  elif git rev-parse --verify -q origin/gh-pages >/dev/null 2>&1; then',
      '    continue',
      '  fi',
      '  if git push --force origin gh-pages; then exit 0; fi',
      'done'],
  };
  for (const [name, lines] of Object.entries(shapes)) {
    const loop = { file: 'test', line: name, variable: 'i', script: lines.join('\n') };
    const scenario = name === 'localRefOnly' ? { ...s, localRef: false } : s;
    assert.ok(stalePushes(run(loop, scenario), scenario).length > 0, name + ' must be caught');
  }
});
