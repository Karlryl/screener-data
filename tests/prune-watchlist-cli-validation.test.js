#!/usr/bin/env node
'use strict';

// H16: prune-watchlist is destructive, so malformed CLI input must fail before
// any filesystem access. All fixtures live under the OS temp directory; this
// test never reads repository watchlists, snapshots, or generated data.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const REPO_ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'prune-watchlist.js');

const ARGUMENT_ERROR = /(?:unknown argument|requires a value|canonical non-negative integer|exceeds the safe integer range|must not be repeated)/i;
const FILESYSTEM_OR_RUNTIME_ERROR = /(?:watchlist parse failed|ENOENT|no such file|cannot find|nicht finden|ERR_INVALID_ARG_TYPE|TypeError|node:fs|\n\s+at\s)/i;

// Poison argv before require so a future loss of the require.main guard fails in
// argument parsing, before it can touch the repository's default watchlist.
const originalArgv = process.argv;
process.argv = [process.execPath, SCRIPT, '--watchlist', '--dry-run'];
let parseArgs;
let main;
let runCli;
try {
  ({ parseArgs, main, runCli } = require(SCRIPT));
} finally {
  process.argv = originalArgv;
}

function output(result) {
  return String(result.stdout || '') + String(result.stderr || '');
}

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  });
}

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-cli-validation-'));
  const snapshots = path.join(dir, 'snapshots');
  const watchlist = path.join(dir, 'watchlist.json');
  fs.mkdirSync(snapshots);
  fs.writeFileSync(path.join(snapshots, 'DELISTED.json'), JSON.stringify({
    meta: { ticker: 'DELISTED', delisted: true },
  }));
  const original = JSON.stringify({
    stocks: [{ ticker: 'DELISTED', added_at: '2020-01-01T00:00:00.000Z' }],
  }, null, 2) + '\n';
  fs.writeFileSync(watchlist, original);
  return { snapshots, watchlist, original };
}

function assertArgumentFailure(result, label) {
  const text = String(result.stderr || '');
  assert.equal(result.status, 1, `${label}: malformed CLI input did not exit exactly 1:\n${text}`);
  assert.equal(result.signal, null, `${label}: process ended by signal ${result.signal}:\n${text}`);
  assert.equal(result.stdout, '', `${label}: argument diagnostics leaked to stdout:\n${result.stdout}`);
  assert.match(text, /^::error::prune-watchlist CLI:/m,
    `${label}: missing exact CLI error prefix:\n${text}`);
  assert.match(text, ARGUMENT_ERROR, `${label}: no clear argument error:\n${text}`);
  assert.doesNotMatch(text, FILESYSTEM_OR_RUNTIME_ERROR,
    `${label}: parser reached filesystem/runtime code before rejecting the arguments:\n${text}`);
}

test('module import is side-effect free and exposes the pure parser plus main seam', () => {
  const code = [
    `process.argv = [process.execPath, ${JSON.stringify(SCRIPT)}, '--watchlist', '--dry-run'];`,
    `const mod = require(${JSON.stringify(SCRIPT)});`,
    "process.stdout.write('__EXPORTS__' + typeof mod.parseArgs + ':' + typeof mod.main + ':' + typeof mod.runCli);",
  ].join('\n');
  const result = spawnSync(process.execPath, ['-e', code], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 10_000,
  });
  const text = output(result);
  assert.equal(result.status, 0, text);
  assert.equal(result.stdout, '__EXPORTS__function:function:function');
  assert.equal(result.stderr, '');
});

test('CLI entry point rethrows unexpected runtime failures', () => {
  const unexpected = Object.assign(new Error('__UNEXPECTED_RUNTIME__'), { evidence: 'preserved' });
  assert.throws(
    () => runCli(['node', 'script'], () => { throw unexpected; }),
    (actual) => actual === unexpected,
  );
});

test('pure parser pins defaults, values, and every boolean flag', () => {
  assert.deepEqual(parseArgs(['node', 'script']), {
    watchlist: path.join(REPO_ROOT, 'watchlist.json'),
    snapshots: path.join(REPO_ROOT, 'snapshots'),
    maxAgeDays: 60,
    pruneNoDataDays: 30,
    pruneOrphans: false,
    force: false,
    dryRun: false,
  });
  assert.deepEqual(parseArgs([
    'node', 'script',
    '--watchlist', 'custom-watchlist.json',
    '--snapshots', 'custom-snapshots',
    '--max-age-days', '0',
    '--prune-no-data-days', String(Number.MAX_SAFE_INTEGER),
    '--prune-orphans', '--force', '--dry-run',
  ]), {
    watchlist: 'custom-watchlist.json',
    snapshots: 'custom-snapshots',
    maxAgeDays: 0,
    pruneNoDataDays: Number.MAX_SAFE_INTEGER,
    pruneOrphans: true,
    force: true,
    dryRun: true,
  });
});

function runMainWithFsTripwire(args) {
  const code = [
    `process.argv = [process.execPath, ${JSON.stringify(SCRIPT)}, '--watchlist', '--dry-run'];`,
    `const fs = require('node:fs');`,
    `const { main } = require(${JSON.stringify(SCRIPT)});`,
    'const calls = [];',
    "for (const name of ['accessSync', 'existsSync', 'openSync', 'readFileSync', 'readdirSync', 'statSync', 'lstatSync', 'writeFileSync', 'appendFileSync', 'mkdirSync', 'copyFileSync', 'renameSync', 'unlinkSync', 'rmSync']) {",
    "  fs[name] = () => { calls.push(name); throw new Error('__FS_TRIPWIRE__:' + name); };",
    '}',
    "process.exit = (code) => { throw new Error('__EXIT_' + code + '__'); };",
    'let caught = null;',
    `try { main(${JSON.stringify(args)}); } catch (e) { caught = e.message; }`,
    "process.stdout.write('\\n__PROBE__' + JSON.stringify({ calls, caught }));",
  ].join('\n');
  const result = spawnSync(process.execPath, ['-e', code], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 10_000,
  });
  const marker = String(result.stdout || '').match(/__PROBE__(\{[^\r\n]+\})/);
  assert.ok(marker, `tripwire child did not report: ${output(result)}`);
  return JSON.parse(marker[1]);
}

test('invalid CLI is rejected before FS and a valid control reaches the FS tripwire', () => {
  const invalid = runMainWithFsTripwire(['node', 'script', '--mystery-option']);
  assert.deepEqual(invalid.calls, []);
  assert.match(invalid.caught, /unknown argument/);

  const valid = runMainWithFsTripwire([
    'node', 'script', '--watchlist', 'tripwire-watchlist.json', '--snapshots', 'tripwire-snapshots',
  ]);
  assert.deepEqual(valid.calls, ['readFileSync'], 'must-fire control did not reach the first FS read');
  assert.equal(valid.caught, '__EXIT_1__');
});

test('missing --prune-no-data-days value cannot swallow --dry-run or mutate the watchlist', () => {
  const f = fixture();
  const result = run([
    '--watchlist', f.watchlist,
    '--snapshots', f.snapshots,
    '--prune-no-data-days', '--dry-run',
    '--force',
  ]);

  assertArgumentFailure(result, 'missing --prune-no-data-days value');
  assert.equal(fs.readFileSync(f.watchlist, 'utf8'), f.original,
    'malformed numeric option swallowed --dry-run and changed the watchlist');
});

test('misspelled --dry-run is rejected and cannot mutate the watchlist', () => {
  const f = fixture();
  const result = run([
    '--watchlist', f.watchlist,
    '--snapshots', f.snapshots,
    '--dry-rnu',
    '--force',
  ]);

  assertArgumentFailure(result, 'unknown --dry-rnu option');
  assert.equal(fs.readFileSync(f.watchlist, 'utf8'), f.original,
    'unknown dry-run spelling was ignored and the watchlist changed');
});

const INVALID_CASES = [
  ['max-age junk', ['--max-age-days', 'junk']],
  ['max-age suffix', ['--max-age-days', '60days']],
  ['max-age fraction', ['--max-age-days', '1.5']],
  ['max-age exponent', ['--max-age-days', '6e1']],
  ['max-age leading zero', ['--max-age-days', '060']],
  ['max-age explicit plus', ['--max-age-days', '+60']],
  ['max-age surrounding whitespace', ['--max-age-days', ' 60 ']],
  ['max-age NaN', ['--max-age-days', 'NaN']],
  ['max-age Infinity', ['--max-age-days', 'Infinity']],
  ['max-age negative', ['--max-age-days', '-1']],
  ['max-age unsafe integer', ['--max-age-days', '9007199254740992']],
  ['no-data junk', ['--prune-no-data-days', 'junk']],
  ['no-data suffix', ['--prune-no-data-days', '30days']],
  ['no-data fraction', ['--prune-no-data-days', '1.5']],
  ['no-data exponent', ['--prune-no-data-days', '3e1']],
  ['no-data leading zero', ['--prune-no-data-days', '030']],
  ['no-data explicit plus', ['--prune-no-data-days', '+30']],
  ['no-data surrounding whitespace', ['--prune-no-data-days', ' 30 ']],
  ['no-data NaN', ['--prune-no-data-days', 'NaN']],
  ['no-data Infinity', ['--prune-no-data-days', 'Infinity']],
  ['no-data negative', ['--prune-no-data-days', '-1']],
  ['no-data unsafe integer', ['--prune-no-data-days', '9007199254740992']],
  ['unknown option', ['--mystery-option']],
  ['unknown positional token', ['mystery-positional-token']],
  ['value option in --flag=value form', ['--max-age-days=60']],
  ['boolean option in --flag=value form', ['--dry-run=true']],
  ['duplicate max-age option', ['--max-age-days', '60', '--max-age-days', '30']],
  ['duplicate no-data option', ['--prune-no-data-days', '30', '--prune-no-data-days', '60']],
  ['duplicate watchlist option', ['--watchlist', 'second-watchlist.json']],
  ['duplicate snapshots option', ['--snapshots', 'second-snapshots']],
  ['duplicate dry-run option', ['--dry-run', '--dry-run']],
  ['duplicate force option', ['--force', '--force']],
  ['duplicate prune-orphans option', ['--prune-orphans', '--prune-orphans']],
  ['missing max-age value', ['--max-age-days']],
  ['max-age followed by flag', ['--max-age-days', '--dry-run']],
  ['missing no-data value', ['--prune-no-data-days']],
  ['no-data followed by flag', ['--prune-no-data-days', '--dry-run']],
  ['missing watchlist value', ['--watchlist'], 'snapshots-only'],
  ['empty watchlist value', ['--watchlist', ''], 'snapshots-only'],
  ['blank watchlist value', ['--watchlist', '   '], 'snapshots-only'],
  ['watchlist followed by flag', ['--watchlist', '--dry-run'], 'snapshots-only'],
  ['missing snapshots value', ['--snapshots'], 'watchlist-only'],
  ['empty snapshots value', ['--snapshots', ''], 'watchlist-only'],
  ['blank snapshots value', ['--snapshots', '   '], 'watchlist-only'],
  ['snapshots followed by flag', ['--snapshots', '--dry-run'], 'watchlist-only'],
];

for (const [label, invalidArgs, baseKind = 'both'] of INVALID_CASES) {
  test(`invalid CLI is rejected before filesystem access: ${label}`, () => {
    const absent = path.join(os.tmpdir(), `prune-cli-absent-${randomUUID()}`);
    const baseArgs = baseKind === 'snapshots-only'
      ? ['--snapshots', path.join(absent, 'snapshots')]
      : baseKind === 'watchlist-only'
        ? ['--watchlist', path.join(absent, 'watchlist.json')]
        : [
            '--watchlist', path.join(absent, 'watchlist.json'),
            '--snapshots', path.join(absent, 'snapshots'),
          ];
    const result = run([...baseArgs, ...invalidArgs]);
    assertArgumentFailure(result, label);
  });
}

const VALID_CASES = [
  {
    label: 'defaults',
    args: ['--dry-run'],
    expected: [/max-age-days:\s+60\b/, /prune-no-data-days:\s+30\b/],
  },
  {
    label: 'canonical zero',
    args: ['--max-age-days', '0', '--prune-no-data-days', '0', '--dry-run'],
    expected: [/max-age-days:\s+0\b/, /prune-no-data-days:\s+0\b/],
  },
  {
    label: 'canonical 60',
    args: ['--max-age-days', '60', '--prune-no-data-days', '60', '--dry-run'],
    expected: [/max-age-days:\s+60\b/, /prune-no-data-days:\s+60\b/],
  },
  {
    label: 'canonical maximum safe integer',
    args: [
      '--max-age-days', String(Number.MAX_SAFE_INTEGER),
      '--prune-no-data-days', String(Number.MAX_SAFE_INTEGER),
      '--dry-run',
    ],
    expected: [
      new RegExp(`max-age-days:\\s+${Number.MAX_SAFE_INTEGER}\\b`),
      new RegExp(`prune-no-data-days:\\s+${Number.MAX_SAFE_INTEGER}\\b`),
    ],
  },
  {
    label: '--dry-run plus --force',
    args: ['--dry-run', '--force'],
    expected: [/dry-run:\s+true\b/],
  },
];

for (const control of VALID_CASES) {
  test(`valid --dry-run preserves behavior: ${control.label}`, () => {
    const f = fixture();
    const result = run([
      '--watchlist', f.watchlist,
      '--snapshots', f.snapshots,
      ...control.args,
    ]);
    const text = output(result);

    assert.equal(result.status, 0, `${control.label}: valid CLI failed:\n${text}`);
    assert.match(text, /\[dry-run\]\s+No changes written\./i,
      `${control.label}: --dry-run was not honored:\n${text}`);
    for (const pattern of control.expected) assert.match(text, pattern);
    assert.equal(fs.readFileSync(f.watchlist, 'utf8'), f.original,
      `${control.label}: dry-run changed the watchlist`);
  });
}
