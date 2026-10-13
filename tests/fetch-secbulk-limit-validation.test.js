'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'fetch-secbulk.js');
const { parseLimit } = require(SCRIPT);

test('exports the SEC-bulk limit parser as a pure seam', () => {
  assert.equal(typeof parseLimit, 'function');
});

test('run validates the limit before reading the snapshot universe', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  const parseCall = source.indexOf('const limit = parseLimit(argv);');
  const firstIo = source.indexOf('const ticker = usTicker();');
  assert.ok(parseCall >= 0 && firstIo > parseCall,
    'parseLimit must run before usTicker or any SEC/network work');
});

const accepted = [
  { name: 'an omitted limit retains the intentional full-run mode', argv: [], expected: Infinity },
  { name: 'an unrelated output option does not imply a limit', argv: ['--out', 'x.jsonl'], expected: Infinity },
  { name: 'a decimal integer is accepted', argv: ['--limit', '1'], expected: 1 },
  { name: 'leading zeros retain the prior Number semantics', argv: ['--limit', '0005'], expected: 5 },
  { name: 'a plus sign retains the prior Number semantics', argv: ['--limit', '+5'], expected: 5 },
  { name: 'integer exponent notation retains the prior Number semantics', argv: ['--limit', '1e3'], expected: 1000 },
];

for (const row of accepted) {
  test(row.name, () => {
    assert.equal(parseLimit(row.argv), row.expected);
  });
}

const rejected = [
  { name: 'missing value', argv: ['--limit'] },
  { name: 'next option consumed as value', argv: ['--limit', '--out', 'x.jsonl'] },
  { name: 'empty value', argv: ['--limit', ''] },
  { name: 'whitespace-only value', argv: ['--limit', '   '] },
  { name: 'nonnumeric value', argv: ['--limit', 'garbage'] },
  { name: 'zero', argv: ['--limit', '0'] },
  { name: 'negative integer', argv: ['--limit', '-1'] },
  { name: 'fraction', argv: ['--limit', '1.5'] },
  { name: 'unsafe integer', argv: ['--limit', '9007199254740992'] },
  { name: 'Infinity', argv: ['--limit', 'Infinity'] },
];

for (const row of rejected) {
  test('rejects an explicit ' + row.name, () => {
    assert.throws(() => parseLimit(row.argv), /--limit.*positive safe integer/i);
  });
}
