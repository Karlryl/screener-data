'use strict';
// Untangle finding F003 (13.11.2026): the gh-pages force-push retry loop existed four times in daily-pull.yml, and two
// copies force-pushed the job's older clone after a failed `git fetch`, which can roll back a newer gh-pages state.
// Codex review round 1 added: a missing LOCAL ref proves nothing about the remote, so the rule is now: a failed fetch
// never pushes in that attempt, unless `git ls-remote --exit-code` proves the branch absent (exit 2).
// This guard EXECUTES every retry loop of every workflow that force-pushes gh-pages in bash, with git and the file
// commands stubbed, and checks the behaviour in each case (round 2: the fetch must really run before every retry push,
// and a failing loop must use up its attempts instead of leaving early).
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

// GitHub runners have bash on PATH; on Windows Git Bash often is not, so its install folder is tried too. A missing bash
// fails the test instead of skipping it: an unexecuted guard is no all-clear (Codex review round 2).
const BASH_CANDIDATES = [process.env.BASH, 'bash', path.join('C:', 'Program Files', 'Git', 'bin', 'bash.exe'), path.join('C:', 'Program Files', 'Git', 'usr', 'bin', 'bash.exe')];
const BASH = BASH_CANDIDATES.filter(Boolean).find(b => spawnSync(b, ['-c', 'exit 0']).status === 0);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ghpages-loops-'));
/**
 * Runs one loop in bash (-eo pipefail like GitHub Actions) with stubbed git and file commands.
 * scenario: fetch rc per attempt, ls-remote rc, push rc per attempt. Exit 7 after the loop marks "all attempts used up";
 * a successful push leaves the loop through the body's own exit 0. Returns the exit code and the call log per attempt.
 */
function run(loop, scenario) {
  const log = path.join(tmp, `log-${loop.line}-${scenario.name}.txt`).split(path.sep).join('/');
  const stub = [
    'ATT=0',
    `log() { echo "$ATT $*" >> "${log}"; }`,
    'rcof() { local list=($1); local n=$ATT; [ $n -gt ${#list[@]} ] && n=${#list[@]}; echo ${list[$((n-1))]}; }',
    'git() {',
    '  case "$1" in',
    `    fetch) log fetch; return $(rcof "${scenario.fetch.join(' ')}") ;;`,
    `    ls-remote) log ls-remote; return ${scenario.lsRemote} ;;`,
    `    rev-parse) log rev-parse; return ${scenario.localRef ? 0 : 1} ;;`,
    '    reset) log reset; return 0 ;;',
    '    diff) log diff; return 1 ;;',
    `    push) log push; return $(rcof "${scenario.push.join(' ')}") ;;`,
    '    *) log "git $1"; return 0 ;;',
    '  esac',
    '}',
    'cp() { :; }; mkdir() { :; }; rm() { :; }; cmp() { return 0; }; sleep() { :; }',
  ].join('\n');
  // The attempt counter follows the loop variable; GitHub expressions are replaced by a placeholder.
  const body = loop.script.replace(/\$\{\{[^}]*\}\}/g, 'X')
    .replace(new RegExp(`^(for ${loop.variable} in [^;]+; do)$`, 'm'), '$1\nATT=$((ATT+1))');
  const r = spawnSync(BASH, ['-eo', 'pipefail', '-c', stub + '\n' + body + '\nexit 7'], { encoding: 'utf8', cwd: tmp });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
  const byAttempt = {};
  for (const c of calls) { const [a, what] = c.split(' '); (byAttempt[a] = byAttempt[a] || []).push(what); }
  return { code: r.status, byAttempt, stderr: r.stderr };
}

/**
 * Behaviour violations of one executed loop: a retry (attempt 2+) that pushes without a fetch before the push, a push in an
 * attempt whose fetch failed while ls-remote did not prove the branch absent, and (when every fetch fails on a present
 * branch and the first push fails) a loop that leaves early instead of using up its attempts.
 */
function violations(result, scenario) {
  const out = [];
  for (const [a, calls] of Object.entries(result.byAttempt)) {
    const n = Number(a), iPush = calls.indexOf('push'), iFetch = calls.indexOf('fetch');
    const fetchRc = scenario.fetch[Math.min(n, scenario.fetch.length) - 1];
    if (n >= 2 && iPush >= 0 && (iFetch < 0 || iFetch > iPush)) out.push(`attempt ${n}: push without a fetch before it`);
    if (iFetch >= 0 && fetchRc !== 0 && scenario.lsRemote !== 2 && iPush >= 0) out.push(`attempt ${n}: push after a failed fetch`);
  }
  const allFail = scenario.fetch.every(x => x !== 0) && scenario.lsRemote !== 2 && scenario.push[0] !== 0;
  if (allFail && result.code !== 7) out.push(`loop left early with exit ${result.code} instead of using up its attempts`);
  return out;
}

test('bash is available, so the executed checks below really run', () => {
  assert.ok(BASH, 'no bash found (BASH, PATH, Git for Windows); the executed gh-pages loop checks cannot run');
});

test('the guard finds the gh-pages force-push loops of daily-pull.yml', () => {
  assert.ok(loops.filter(l => l.file === 'daily-pull.yml').length >= 4, 'found: ' + loops.map(l => l.file + ':' + l.line).join(', '));
});

test('every gh-pages force-push loop: a failed fetch never pushes a stale clone; a proven-absent branch may be created', () => {
  assert.ok(BASH, 'bash required');
  const scenarios = [
    // push 1 fails (or fetch 1 fails), then every later fetch fails while the branch exists remotely
    { name: 'fetch-fails-branch-exists', fetch: [1, 1, 1], lsRemote: 0, localRef: true, push: [1, 0, 0] },
    // same, but the local ref is missing (e.g. a git-init clone): the local ref proves nothing
    { name: 'fetch-fails-no-local-ref', fetch: [1, 1, 1], lsRemote: 0, localRef: false, push: [1, 0, 0] },
    // transport error on ls-remote as well
    { name: 'fetch-and-ls-remote-fail', fetch: [1, 1, 1], lsRemote: 128, localRef: false, push: [1, 0, 0] },
  ];
  const bad = [];
  for (const loop of loops) for (const s of scenarios) for (const v of violations(run(loop, s), s)) bad.push(`${loop.file}:${loop.line} ${s.name}: ${v}`);
  assert.deepEqual(bad, []);
  // Positive controls: a working fetch resets before the retry push and ends green; a proven-absent branch is created.
  for (const loop of loops) {
    const okScenario = { name: 'fetch-ok', fetch: [0, 0, 0], lsRemote: 0, localRef: true, push: [1, 0, 0] };
    const ok = run(loop, okScenario);
    const second = ok.byAttempt['2'] || [];
    assert.ok(second.indexOf('fetch') >= 0 && second.indexOf('fetch') < second.indexOf('reset') && second.indexOf('reset') < second.indexOf('push'),
      `${loop.file}:${loop.line}: attempt 2 fetches, resets, then pushes: ${JSON.stringify(ok.byAttempt)}`);
    assert.equal(ok.code, 0, `${loop.file}:${loop.line}: a successful push ends the loop green`);
    assert.deepEqual(violations(ok, okScenario), []);
    const absent = run(loop, { name: 'branch-absent', fetch: [1, 1, 1], lsRemote: 2, localRef: false, push: [0] });
    assert.ok(Object.values(absent.byAttempt).some(c => c.includes('push')) && absent.code === 0, `${loop.file}:${loop.line}: a proven-absent branch is created`);
  }
});

test('break-once on test data: inert fetch, early exit, unreachable continue, local-ref-only and the pre-fix shape are caught', () => {
  assert.ok(BASH, 'bash required');
  const s = { name: 'mutant', fetch: [1, 1, 1], lsRemote: 0, localRef: true, push: [1, 0, 0] };
  const lsRemote = '  elif ls_rc=0; git ls-remote --exit-code --heads origin gh-pages >/dev/null 2>&1 || ls_rc=$?; [ "$ls_rc" -ne 2 ]; then';
  const push = '  if git push --force origin gh-pages; then exit 0; fi';
  const shapes = {
    preFix: ['for i in 1 2 3; do', '  if [ "$i" -gt 1 ]; then',
      '    if git fetch origin gh-pages 2>/dev/null && git rev-parse --verify -q origin/gh-pages >/dev/null 2>&1; then',
      '      git reset --hard origin/gh-pages', '    fi', '  fi', push, 'done'],
    unreachableContinue: ['for i in 1 2 3; do', '  if git fetch origin gh-pages; then', '    git reset --hard origin/gh-pages',
      '  elif false; then', '    continue', '  fi', push, 'done'],
    localRefOnly: ['for i in 1 2 3; do', '  if git fetch origin gh-pages; then', '    git reset --hard origin/gh-pages',
      '  elif git rev-parse --verify -q origin/gh-pages >/dev/null 2>&1; then', '    continue', '  fi', push, 'done'],
    inertFetch: ['for i in 1 2 3; do', '  if : git fetch origin gh-pages; then', '    git reset --hard origin/gh-pages',
      lsRemote, '    continue', '  fi', push, 'done'],
    earlyExit: ['for i in 1 2 3; do', '  if git fetch origin gh-pages; then', '    git reset --hard origin/gh-pages',
      lsRemote, '    exit 0', '  fi', push, 'done'],
  };
  for (const [name, lines] of Object.entries(shapes)) {
    const loop = { file: 'test', line: name, variable: 'i', script: lines.join('\n') };
    const scenario = name === 'localRefOnly' ? { ...s, localRef: false } : s;
    assert.ok(violations(run(loop, scenario), scenario).length > 0, name + ' must be caught');
  }
  const fixed = { file: 'test', line: 'fixed', variable: 'i', script: ['for i in 1 2 3; do', '  if git fetch origin gh-pages; then',
    '    git reset --hard origin/gh-pages', lsRemote, '    continue', '  fi', push, 'done'].join('\n') };
  assert.deepEqual(violations(run(fixed, s), s), [], 'the fixed shape passes');
});
