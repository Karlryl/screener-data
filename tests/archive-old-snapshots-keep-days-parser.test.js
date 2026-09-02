'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs } = require('../scripts/archive-old-snapshots.js');

function asArgv(args) {
  return ['node', 'archive-old-snapshots.js', ...args];
}

function expectInvalid(args, flag) {
  const originalExit = process.exit;
  const originalError = console.error;
  const sentinel = {};
  const exitCodes = [];
  const diagnostics = [];
  let caught;

  process.exit = (code) => {
    exitCodes.push(code);
    throw sentinel;
  };
  console.error = (...parts) => {
    diagnostics.push(parts.join(' '));
  };

  try {
    parseArgs(asArgv(args));
  } catch (error) {
    caught = error;
  } finally {
    process.exit = originalExit;
    console.error = originalError;
  }

  assert.equal(caught, sentinel, 'invalid value must take the non-returning exit path');
  assert.deepEqual(exitCodes, [1]);
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0], /::error::archive-old-snapshots/);
  assert.equal(diagnostics[0].includes(flag), true, diagnostics[0]);
}

for (const [name, flag, args] of [
  ['suffix after zero', '--keep-days', ['--keep-days', '0junk']],
  ['exponent notation', '--methods-keep-days', ['--methods-keep-days', '1e3']],
  ['fractional token', '--picks-keep-days', ['--picks-keep-days', '3.5']],
  ['missing value', '--keep-days', ['--keep-days']],
  ['empty value', '--methods-keep-days', ['--methods-keep-days', '']],
  ['unsafe integer', '--picks-keep-days', ['--picks-keep-days', '9007199254740992']],
  ['negative value remains invalid', '--keep-days', ['--keep-days', '-1']],
  ['nonnumeric value remains invalid', '--methods-keep-days', ['--methods-keep-days', 'nope']],
]) {
  test('parseArgs rejects ' + name, () => {
    expectInvalid(args, flag);
  });
}

test('parseArgs preserves omitted defaults', () => {
  assert.deepEqual(parseArgs(asArgv([])), {
    keepDays: 14,
    methodsKeepDays: null,
    picksKeepDays: null,
    dryRun: false,
  });
});

test('parseArgs preserves exact integer flags, zero and dry-run', () => {
  assert.deepEqual(parseArgs(asArgv([
    '--keep-days', '0',
    '--methods-keep-days', '14',
    '--picks-keep-days', '100000',
    '--dry-run',
  ])), {
    keepDays: 0,
    methodsKeepDays: 14,
    picksKeepDays: 100000,
    dryRun: true,
  });
});
