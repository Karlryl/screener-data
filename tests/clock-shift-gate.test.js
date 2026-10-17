'use strict';
// P250: tests for scripts/clock-shift-gate.js and its preload. Every guard claim is shown red once
// on a fixture (tests/fixtures/clock-shift/, not discovered by test-gate) and green on its opposite.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'clock-shift-gate.js');
const PRELOAD = path.join(ROOT, 'tests', 'helpers', 'clock-shift-preload.cjs');
const FIX = 'tests/fixtures/clock-shift/';
const gate = require(SCRIPT);

/** Environment without any clock shift or inherited preload, so the tests are the same inside and outside the guard. */
const cleanEnv = (extra = {}) => {
  const env = { ...process.env, ...extra };
  for (const key of Object.keys(env)) if (['NODE_OPTIONS', 'CLOCK_SHIFT_MS', 'BASE_REF'].includes(key.toUpperCase()) && !(key in extra)) delete env[key];
  return env;
};

/** Runs `fn` and returns what it wrote to stdout. */
function capture(fn) {
  const realWrite = process.stdout.write;
  let out = '';
  process.stdout.write = (chunk) => { out += String(chunk); return true; };
  let result;
  try { result = fn(); } finally { process.stdout.write = realWrite; }
  return { result, out };
}

// --- the preload ---------------------------------------------------------------------------

/** Runs `script` in a child with the preload; the script prints one JSON line. */
function inShiftedChild(shiftMs, script) {
  const r = spawnSync(process.execPath, ['--require', PRELOAD, '-e', script], { encoding: 'utf8', env: cleanEnv(shiftMs === undefined ? {} : { CLOCK_SHIFT_MS: String(shiftMs) }) });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}
const PROBE = `
  const real = performance.timeOrigin + performance.now(), day = 864e5;
  class Sub extends Date {}
  console.log(JSON.stringify({
    newDateDays: (new Date().getTime() - real) / day,
    nowDays: (Date.now() - real) / day,
    callDays: (Date.parse(Date()) - real) / day,
    explicit: new Date('2026-01-02T03:04:05Z').toISOString(),
    utc: Date.UTC(2026, 0, 1),
    parse: Date.parse('2026-01-01T00:00:00Z'),
    ctor: new Date(2026, 0, 2).getFullYear(),
    subclass: new Sub() instanceof Sub && new Sub() instanceof Date && new Date() instanceof Date,
    tag: Object.prototype.toString.call(new Date()),
  }));`;

test('preload: argument-less new Date(), Date.now() and Date() follow now + shift', () => {
  const r = inShiftedChild(3 * 864e5, PROBE);
  for (const key of ['newDateDays', 'nowDays', 'callDays']) assert.ok(Math.abs(r[key] - 3) < 0.01, `${key} = ${r[key]}`);
});

test('preload: new Date(x), Date.UTC and Date.parse stay exact, subclasses and type tag survive', () => {
  const r = inShiftedChild(40 * 864e5, PROBE);
  assert.equal(r.explicit, '2026-01-02T03:04:05.000Z');
  assert.equal(r.utc, 1767225600000);
  assert.equal(r.parse, 1767225600000);
  assert.equal(r.ctor, 2026);
  assert.equal(r.subclass, true);
  assert.equal(r.tag, '[object Date]');
});

test('preload: without or with zero shift the clock is untouched', () => {
  for (const shift of [undefined, 0, '']) {
    const r = inShiftedChild(shift, PROBE);
    assert.ok(Math.abs(r.newDateDays) < 0.01 && Math.abs(r.nowDays) < 0.01, `shift ${shift}: ${r.newDateDays}`);
  }
});

// --- the guard on fixtures (break-once) ------------------------------------------------------

test('constants: one short shift (a day-granular stamp) and one beyond a 30-day gate', () => {
  assert.ok(gate.SHIFT_DAYS.some(d => d >= 1 && d < 7), 'no short shift');
  assert.ok(gate.SHIFT_DAYS.some(d => d > 31), 'no shift beyond the 30-day age gate');
});

test('fixture: new Date() stamp compared with real-clock data goes red at +3 days', () => {
  const r = gate.checkFile(FIX + 'stamp-new-date.test.js');
  assert.equal(r.status, 'uhrabhaengig');
  assert.equal(r.shift, 3);
  // 3 days, or 4 when the mtime and the stamp straddle midnight UTC.
  assert.match(r.failure, /store stamp is the day of the stored data.*[34] days away/);
});

test('fixture: absolute date against a 30-day age gate is green at +3 and red at +40 days', () => {
  const r = gate.checkFile(FIX + 'absolute-date-age-gate.test.js');
  assert.equal(r.status, 'uhrabhaengig');
  assert.equal(r.shift, 40);
  assert.match(r.failure, /45\.\d days old, gate is 30/);
  assert.equal(gate.checkFile(FIX + 'absolute-date-age-gate.test.js', { shifts: [3] }).status, 'ok');
});

test('fixture: a child process of the test inherits the shift', () => {
  const r = gate.checkFile(FIX + 'child-process-stamp.test.js');
  assert.equal(r.status, 'uhrabhaengig');
  assert.match(r.failure, /child clock is 3\.0 days/);
});

test('fixture: a clock-independent test stays green at every shift', () => {
  assert.equal(gate.checkFile(FIX + 'clock-independent.test.js').status, 'ok');
});

test('fixture: a test that is already red at the real clock is skipped, not called clock-dependent', () => {
  assert.equal(gate.checkFile(FIX + 'red-at-real-clock.test.js').status, 'rot-bei-echter-uhr');
});

test('fixture: a test whose checks are all skipped is not reported as green', () => {
  assert.equal(gate.checkFile(FIX + 'skips-everything.test.js').status, 'nichts-geprueft');
  const r = run([`--files=${FIX}skips-everything.test.js`]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /skips-everything.test.js hat bei verschobener Uhr keine Pruefung ausgefuehrt .* zaehlt NICHT als gruen/);
});

test('the shift leaves the environment of the guard process as it was', () => {
  const before = [process.env.NODE_OPTIONS, process.env.CLOCK_SHIFT_MS];
  gate.checkFile(FIX + 'stamp-new-date.test.js');
  assert.deepEqual([process.env.NODE_OPTIONS, process.env.CLOCK_SHIFT_MS], before);
});

// --- command line, messages, exemptions ----------------------------------------------------

const run = (args, env = cleanEnv()) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8', env });

test('cli: a clock-dependent file fails with one German ::error:: line naming file, shift, assertion and the hint', () => {
  const r = run([`--files=${FIX}stamp-new-date.test.js,${FIX}clock-independent.test.js`]);
  assert.equal(r.status, 1);
  const errors = r.stdout.split('\n').filter(l => l.startsWith('::error::Uhr-Verschiebung'));
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes(FIX + 'stamp-new-date.test.js'));
  assert.match(errors[0], /bei \+3 Tagen rot/);
  assert.match(errors[0], /Erste fehlgeschlagene Pruefung: "store stamp is the day of the stored data"/);
  assert.match(errors[0], /festnageln \(Vorbild: PR #7/);
  assert.match(r.stdout, /clock-independent\.test\.js gruen bei \+3 und \+40 Tagen/);
  assert.ok(!errors[0].includes('\n'));
});

test('cli: the output of the fixture runs adds no annotation of its own', () => {
  const r = run([`--files=${FIX}stamp-new-date.test.js`]);
  const annotations = r.stdout.split('\n').filter(l => /^\s*::(error|warning)/.test(l));
  assert.equal(annotations.length, 1, annotations.join('\n'));
});

test('cli: clean files and a red-at-real-clock file give exit 0 and the skip line', () => {
  const r = run([`--files=${FIX}clock-independent.test.js,${FIX}red-at-real-clock.test.js`]);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /red-at-real-clock\.test\.js ist schon bei echter Uhr rot - das meldet das Test-Gate, hier uebersprungen/);
  assert.ok(!r.stdout.includes('::error::'));
});

test('cli: a file that does not exist is an error, not a silent skip', () => {
  const r = run([`--files=${FIX}gibt-es-nicht.test.js`]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /::error::Uhr-Verschiebung: Testdatei\(en\) nicht gefunden/);
});

test('cli: without a base (push to main) it does nothing and says so', () => {
  const r = run([]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /kein Pull Request \(Push ohne PR\)/);
});

test('exemptions: the committed list loads; an exempt file is skipped with its reason; a list without reason is refused', () => {
  assert.ok(gate.loadExemptions() instanceof Map);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-ex-'));
  try {
    const good = path.join(dir, 'good.json');
    fs.writeFileSync(good, JSON.stringify([{ file: FIX + 'stamp-new-date.test.js', grund: 'Testgrund: Stempel ist Teil des Tests' }]));
    const r = run([`--files=${FIX}stamp-new-date.test.js`, `--exempt=${good}`]);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /ausgenommen \(Grund: Testgrund: Stempel ist Teil des Tests\)/);

    for (const [name, content] of [['no-reason', [{ file: 'tests/a.test.js' }]], ['blank-reason', [{ file: 'tests/a.test.js', grund: '  ' }]], ['not-a-list', { file: 'x' }]]) {
      const bad = path.join(dir, name + '.json');
      fs.writeFileSync(bad, JSON.stringify(content));
      const b = run([`--files=${FIX}clock-independent.test.js`, `--exempt=${bad}`]);
      assert.equal(b.status, 1, name);
      assert.match(b.stdout, /::error::Uhr-Verschiebung: Wachposten selbst gescheitert/, name);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('which paths are guarded', () => {
  for (const f of ['tests/a.test.js', 'tests/scoring/x.test.js', 'tests/13f-test.js']) assert.equal(gate.isGuardedTestFile(f), true, f);
  for (const f of ['tests/fixtures/clock-shift/a.test.js', 'tests/discovery/x.test.js', 'tests/helpers/a.js', 'scripts/a.test.js', 'tests/a.test.json']) assert.equal(gate.isGuardedTestFile(f), false, f);
});

// --- diff against the PR base ----------------------------------------------------------------

const GREEN = "const test = require('node:test');\ntest('green', () => {});\n";
const CLOCK_DEPENDENT = "const test = require('node:test');\nconst assert = require('node:assert/strict');\n"
  + "test('follows the real clock', () => assert.ok(Math.abs(Date.now() - (performance.timeOrigin + performance.now())) < 864e5));\n";

/** Origin with main (A, then C) and a PR branch (B) merged into main as M, like GitHub's merge ref; main moves on once more (D). */
function makeOrigin(dir) {
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const put = (rel, text) => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  git(dir, 'init', '-q');
  put('tests/mod.test.js', GREEN); put('tests/gone.test.js', GREEN); put('README.md', 'a\n');
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'A');
  git(dir, 'checkout', '-qb', 'pr');
  put('tests/mod.test.js', GREEN + '// changed\n'); put('tests/new.test.js', CLOCK_DEPENDENT);
  put('tests/fixtures/x/f.test.js', GREEN); put('scripts/x.js', '1\n'); fs.rmSync(path.join(dir, 'tests/gone.test.js'));
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'B');
  git(dir, 'checkout', '-q', 'main');
  put('tests/basecommit.test.js', GREEN); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'C');
  git(dir, 'checkout', '-qb', 'merge'); git(dir, 'merge', '-q', '--no-ff', '-m', 'M', 'pr');
  git(dir, 'checkout', '-q', 'main');
  put('tests/later.test.js', GREEN); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'D');
  return git;
}

test('diff: only the files the PR adds or modifies, merge-base style, in a full and in a shallow checkout', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-git-'));
  try {
    const origin = path.join(dir, 'origin'); fs.mkdirSync(origin);
    const git = makeOrigin(origin);
    const url = pathToFileURL(origin).href;
    const expected = ['tests/mod.test.js', 'tests/new.test.js'];

    git(dir, 'clone', '-q', '--branch', 'merge', url, 'full');
    assert.deepEqual(gate.changedTestFiles('main', path.join(dir, 'full')), expected);

    git(dir, 'clone', '-q', '--depth', '1', '--branch', 'merge', url, 'shallow');
    assert.equal(git(path.join(dir, 'shallow'), 'rev-parse', '--is-shallow-repository').trim(), 'true');
    const logged = [];
    assert.deepEqual(gate.changedTestFiles('main', path.join(dir, 'shallow'), l => logged.push(l)), expected);
    assert.ok(logged.some(l => l.includes('lade nach')), 'the shallow checkout must have fetched the base');

    // end to end in the shallow clone: base from the PR event env, the new test follows the real clock
    const { result: code, out } = capture(() => gate.main([], { BASE_REF: 'main' }, path.join(dir, 'shallow')));
    assert.equal(code, 1);
    assert.match(out, /2 Testdatei\(en\)/);
    assert.match(out, /::error::Uhr-Verschiebung: tests\/new\.test\.js ist mit der echten Uhr gruen, aber bei \+3 Tagen rot/);
    assert.match(out, /tests\/mod\.test\.js gruen bei \+3 und \+40 Tagen/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('diff: an unknown base fails loud instead of checking nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-git-'));
  try {
    const origin = path.join(dir, 'origin'); fs.mkdirSync(origin);
    const git = makeOrigin(origin);
    git(dir, 'clone', '-q', '--branch', 'merge', pathToFileURL(origin).href, 'full');
    const { result: code, out } = capture(() => gate.main(['--base=no-such-branch'], {}, path.join(dir, 'full')));
    assert.equal(code, 1);
    assert.match(out, /::error::Uhr-Verschiebung: Wachposten selbst gescheitert/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

// --- wiring in the PR check ------------------------------------------------------------------

test('wiring: pr-check.yml runs the guard after the test-gate step and hands over github.base_ref', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pr-check.yml'), 'utf8');
  const gateAt = wf.indexOf('run: node scripts/test-gate.js --mode=all');
  const guardAt = wf.indexOf('run: node scripts/clock-shift-gate.js');
  assert.ok(gateAt > 0, 'test-gate step missing');
  assert.ok(guardAt > gateAt, 'guard step must come after the test-gate step');
  const step = wf.slice(wf.lastIndexOf('- name:', guardAt), guardAt);
  assert.match(step, /BASE_REF: \$\{\{ github\.base_ref \}\}/);
});
