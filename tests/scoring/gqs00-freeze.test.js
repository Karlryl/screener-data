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
  // Period gate round 2 (30.10.2026) moves 17 golden cases; without the registrations the first of them fails, in fixture order.
  assert.throws(() => load(({ goldenTraces, ...rest }) => rest).verify(), /not deterministic: ALNY/);
  assert.throws(() => load((d) => ({ ...d, goldenTraces: { ...d.goldenTraces, 'GQS00-999': 'x' } })).verify(), /unbekannten Golden-Fall/);
  assert.equal(sha(), before);
});

// P267: a registered second trace passes only as strict JSON. JSON folds NaN, Infinity and -Infinity into null, so
// the canonical hash alone would accept them in place of a registered null; a finite change stays red as before.
test('golden-trace transition: non-finite numbers cannot hide behind the canonical hash', () => {
  const { acceptsPendingTrace, sha256Canonical } = require('../../scripts/gqs00-freeze.js');
  const trace = { caseId: 'GQS00-023', dilution: { rawValue: null, percentile: null }, final: 27.853410053450364 };
  const hash = sha256Canonical(trace);
  assert.equal(acceptsPendingTrace(trace, hash), true);
  for (const bad of [NaN, Infinity, -Infinity]) {
    const mutated = structuredClone(trace); mutated.dilution.rawValue = bad;
    assert.equal(sha256Canonical(mutated), hash, 'the hash alone is blind to ' + bad);
    assert.equal(acceptsPendingTrace(mutated, hash), false, String(bad));
  }
  const finite = structuredClone(trace); finite.dilution.rawValue = 0;
  assert.equal(acceptsPendingTrace(finite, hash), false);
  assert.equal(acceptsPendingTrace(trace, undefined), false);
});

// P267: lib/g31-recency.js is productive since the G31 switch but lies outside src/scoring. While the transition is
// open it must be registered (dependencyFiles) and match; a changed library condition that no golden case hits
// (here: the later fiscal year no longer wins) turns the seal red. Transition and library are swapped in memory only.
test('productive dependency: unregistered or changed lib/g31-recency.js turns verify() red', () => {
  const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
  const { Module, createRequire } = require('node:module');
  const file = path.resolve(__dirname, '../../scripts/gqs00-freeze.js'), source = fs.readFileSync(file, 'utf8');
  const tfile = path.resolve(__dirname, '../../protocol/gqs-00/1.2.0-pending/transition.json');
  const lfile = path.resolve(__dirname, '../../lib/g31-recency.js');
  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'), before = [sha(tfile), sha(lfile)];
  const load = (edit, libEdit = (s) => s) => {
    const m = new Module(file, module), real = createRequire(file); m.filename = file; m.paths = module.paths;
    const swapped = { ...fs, readFileSync: (p, o) => {
      const target = path.resolve(String(p));
      if (target === tfile) return JSON.stringify(edit(JSON.parse(fs.readFileSync(p, 'utf8'))));
      if (target === lfile) { const s = libEdit(fs.readFileSync(p, 'utf8')); return o ? s : Buffer.from(s); }
      return fs.readFileSync(p, o);
    } };
    m.require = (id) => (id === 'node:fs' ? swapped : real(id)); m._compile(source, file); return m.exports;
  };
  assert.equal(load((d) => d).verify().canonicalId, 'GQS-00@1.1.0');
  assert.throws(() => load(({ dependencyFiles, ...rest }) => rest).verify(), /registriert die produktive Abhaengigkeit nicht: lib\/g31-recency\.js/);
  const anchor = '    && annual.sourcePeriodEnd > quarter.sourcePeriodEnd;';
  assert.equal(fs.readFileSync(lfile, 'utf8').split(anchor).length, 2, 'exact unique anchor');
  assert.throws(() => load((d) => d, (s) => s.replace(anchor, '    && false;')).verify(), /lib\/g31-recency\.js differs from its registered dependency hash/);
  assert.deepEqual([sha(tfile), sha(lfile)], before);
});

// P267 round 2: lib/annual-pairs.js supplies the dated fiscal-year ends the G31 selection reads; changing them
// (here: every end returned as null, which flips a 150/100 fiscal year against a 120/100 quarter from 50 % to 20 %)
// must turn verify() red although no golden case moves. Library bytes are swapped in memory only.
test('productive dependency: a changed lib/annual-pairs.js turns verify() red', () => {
  const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
  const { Module, createRequire } = require('node:module');
  const file = path.resolve(__dirname, '../../scripts/gqs00-freeze.js'), source = fs.readFileSync(file, 'utf8');
  const afile = path.resolve(__dirname, '../../lib/annual-pairs.js');
  const sha = () => crypto.createHash('sha256').update(fs.readFileSync(afile)).digest('hex'), before = sha();
  const load = (libEdit) => {
    const m = new Module(file, module), real = createRequire(file); m.filename = file; m.paths = module.paths;
    const swapped = { ...fs, readFileSync: (p, o) => {
      if (path.resolve(String(p)) === afile) { const s = libEdit(fs.readFileSync(p, 'utf8')); return o ? s : Buffer.from(s); }
      return fs.readFileSync(p, o);
    } };
    m.require = (id) => (id === 'node:fs' ? swapped : real(id)); m._compile(source, file); return m.exports;
  };
  assert.equal(load((s) => s).verify().canonicalId, 'GQS-00@1.1.0');
  const anchor = 'function annualPeriodEnds(';
  assert.equal(fs.readFileSync(afile, 'utf8').split(anchor).length, 2, 'exact unique anchor');
  assert.throws(() => load((s) => s.replace(anchor, 'function annualPeriodEndsOriginal(') + '\nfunction annualPeriodEnds(s, f) { return annualPeriodEndsOriginal(s, f).map(() => null); }\n').verify(),
    /lib\/annual-pairs\.js differs from its registered dependency hash/);
  assert.equal(sha(), before);
});
