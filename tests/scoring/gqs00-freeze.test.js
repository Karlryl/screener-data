'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { verify } = require('../../scripts/gqs00-freeze.js');

test('GQS-00@1.1.0 registry, hashes, fixtures, traces and equality proof stay sealed', () => {
  const result = verify();
  assert.equal(result.canonicalId, 'GQS-00@1.1.0');
  assert.equal(result.branchesCovered, 13);
  assert.equal(result.scoreMismatches, 0);
  assert.equal(result.rankMismatches, 0);
  assert.equal(result.negativeMutationGate, 'PASS');
});

// G31 switch (18.10.2026): a golden case moved by the open transition passes only with exactly the
// rebuilt trace registered in transition.json goldenTraces; a tampered hash, a missing registration or
// an unknown case stays red. The transition file is swapped in memory only (live bytes unchanged).
test('golden-trace transition: only the registered rebuilt trace passes', () => {
  const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
  const { Module, createRequire } = require('node:module');
  const file = path.resolve(__dirname, '../../scripts/gqs00-freeze.js'), source = fs.readFileSync(file, 'utf8');
  const tfile = path.resolve(__dirname, '../../protocol/gqs-00/1.2.0-pending/transition.json');
  const sha = () => crypto.createHash('sha256').update(fs.readFileSync(tfile)).digest('hex'), before = sha();
  const load = (edit) => {
    const m = new Module(file, module), real = createRequire(file); m.filename = file; m.paths = module.paths;
    const swapped = { ...fs, readFileSync: (p, o) => (path.resolve(String(p)) === tfile
      ? JSON.stringify(edit(JSON.parse(fs.readFileSync(p, 'utf8')))) : fs.readFileSync(p, o)) };
    m.require = (id) => (id === 'node:fs' ? swapped : real(id)); m._compile(source, file); return m.exports;
  };
  assert.equal(load((d) => d).verify().canonicalId, 'GQS-00@1.1.0');
  assert.throws(() => load((d) => ({ ...d, goldenTraces: { ...d.goldenTraces, 'GQS00-023': '0'.repeat(64) } })).verify(),
    /not deterministic: 000002\.SZ differs from its sealed AND from its approved pending-transition trace/);
  assert.throws(() => load(({ goldenTraces, ...rest }) => rest).verify(), /not deterministic: 000002\.SZ/);
  assert.throws(() => load((d) => ({ ...d, goldenTraces: { ...d.goldenTraces, 'GQS00-999': 'x' } })).verify(), /unbekannten Golden-Fall/);
  assert.equal(sha(), before);
});
