'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { simulateList, readGeneration, anchorProblems, buildShadowReport, reportPaths, verifyGeneration, main } = require('../scripts/non-operating-shadow-report.js');
const OUTPUTS = path.join(__dirname, 'fixtures/non-operating-shadow/export-generation');
const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// All intentional breaks are in memory; no writing test or real export is ever a break target.
test('small frozen generation includes prior gates, all five families, and cross-track overview ranking', () => {
  const generation = readGeneration(OUTPUTS);
  const before = JSON.stringify(generation);
  const hashes = generation.inputs.map((input) => digest(path.join(OUTPUTS, input.file)));
  const report = buildShadowReport(generation);
  assert.deepEqual(report.affected.map((row) => [row.ticker, row.rankBefore, row.rankAfter]),
    [['SBR', 1, null], ['NXP', null, null], ['BURE.ST', 1, null], ['FMONC.PA', 3, null], ['SBR', 1, null], ['SBR', 1, null], ['SBR', 1, null], ['SBR', 1, null]]);
  assert.deepEqual(report.moved.map((row) => [row.ticker, row.rankBefore, row.rankAfter]),
    [['FRU.TO', 2, 1], ['BSM', 3, 2], ['OPERATING', 2, 1], ['WPM', 4, 2], ['FRU.TO', 2, 1], ['FRU.TO', 2, 1], ['FRU.TO', 2, 1], ['FRU.TO', 2, 1]]);
  for (const family of ['full', 'quality', 'smallcap', 'rule40']) {
    assert.ok(report.affected.some((row) => row.list.includes('/' + family + '/')), family);
  }
  assert.ok(report.affected.every((row) => !row.list.endsWith('/survival.json')));
  assert.ok(report.moved.every((row) => row.ticker !== 'GAP'));
  assert.equal(JSON.stringify(generation), before);
  assert.deepEqual(generation.inputs.map((input) => digest(path.join(OUTPUTS, input.file))), hashes);
  assert.match(report.markdown, /STOPP/);
  assert.equal(report.problems.length, 5, 'small fixture must not pretend to satisfy the production anchors');
  assert.ok(report.markdown.includes(require('../configs/non-operating-classes.json').boundary));
  for (const input of generation.inputs) assert.ok(report.markdown.includes(input.sha256));
  assert.equal(report.csv.trimEnd().split('\n').length, report.affected.length + report.moved.length + 1);
  assert.equal(buildShadowReport(generation).markdown, report.markdown, 'deterministic rerun');
  const wrongDay = structuredClone(generation);
  wrongDay.generatedAt = '2026-10-04T09:31:17.258Z';
  assert.ok(buildShadowReport(wrongDay).problems.some((problem) => problem.includes('Generation vom 03.10.2026')));
});

function readerWithMemoryBreak(mutate, omitIndex = false, hideFamily = null) {
  const filename = path.resolve(__dirname, '../scripts/non-operating-shadow-report.js');
  const requireFromReport = createRequire(filename);
  const target = path.join(OUTPUTS, 'findash-export/v1/energy.json');
  const fakeFs = {
    ...fs,
    readFileSync(file, encoding) {
      const bytes = fs.readFileSync(file);
      if (path.resolve(file) !== path.resolve(target)) return encoding ? bytes.toString(encoding) : bytes;
      const data = JSON.parse(bytes.toString('utf8'));
      mutate(data);
      const changed = Buffer.from(JSON.stringify(data));
      return encoding ? changed.toString(encoding) : changed;
    },
    readdirSync(dir, options) {
      return fs.readdirSync(dir, options).filter((entry) => !omitIndex || entry.name !== 'index.json');
    },
    existsSync(p) {
      return hideFamily && path.basename(p) === hideFamily ? false : fs.existsSync(p);
    },
  };
  const module = { exports: {} };
  vm.runInNewContext('(function(require,module,exports,__dirname,__filename){'
    + fs.readFileSync(filename, 'utf8').replace(/^#![^\n]*\n/, '') + '\n})', { console, process, Buffer })
  ((id) => id === 'node:fs' ? fakeFs : requireFromReport(id), module, module.exports, path.dirname(filename), filename);
  return module.exports.readGeneration;
}

test('input schema, timestamp, list shape, index and mixed-day guards each break only in memory', () => {
  const generation = readGeneration(OUTPUTS);
  for (const [mutate, error] of [
    [(data) => { data.schema = 'wrong'; }, /Exportstempel/],
    [(data) => { delete data.generated_at; }, /Exportstempel/],
    [(data) => { data.generated_at = 'invalid'; }, /Exportstempel/],
    [(data) => { data.profitable = {}; }, /kein Array/],
    [(data) => { delete data.profitable; delete data.unprofitable; }, /keine bekannte/],
    [(data) => { data.generated_at = '2026-10-04T09:31:17.258Z'; }, /Gemischte Exporttage/],
  ]) {
    assert.throws(() => readerWithMemoryBreak(mutate)(OUTPUTS), error);
    assert.doesNotThrow(() => verifyGeneration(generation));
  }
  assert.throws(() => readerWithMemoryBreak(() => {}, true)(OUTPUTS), /ohne Index/);
  for (const family of ['full', 'quality', 'smallcap', 'rule40']) {
    assert.throws(() => readerWithMemoryBreak(() => {}, false, family)(OUTPUTS), /Exportfamilie fehlt/, family);
  }
  assert.doesNotThrow(() => readGeneration(OUTPUTS));
});

test('input byte guard detects one altered digest and restores without writing any file', () => {
  const generation = readGeneration(OUTPUTS);
  assert.doesNotThrow(() => verifyGeneration(generation));
  const broken = structuredClone(generation);
  broken.inputs[0].sha256 = '0'.repeat(64);
  assert.throws(() => verifyGeneration(broken), /Eingabe während des Berichts verändert/);
  assert.doesNotThrow(() => verifyGeneration(generation));
});

test('renumbering guard detects a gap, a missing rank, and an inconsistent old gate then restores', () => {
  const rows = [
    { ticker: 'SBR', rank: 1, rankGrund: null },
    { ticker: 'NXP', rank: null, rankGrund: 'zuWenigBelegteAchsen' },
    { ticker: 'FRU.TO', rank: 2, rankGrund: null },
  ];
  const valid = JSON.stringify(rows);
  for (const mutate of [
    (r) => { r[2].rank = 3; },
    (r) => { delete r[0].rank; },
    (r) => { r[1].rank = 2; },
    (r) => { delete r[0].ticker; },
  ]) {
    const broken = structuredClone(rows);
    mutate(broken);
    assert.throws(() => simulateList(broken, 'fixture.json', 'profitable'));
    assert.equal(simulateList(rows, 'fixture.json', 'profitable').moved[0].rankAfter, 1);
  }
  assert.equal(JSON.stringify(rows), valid);
  const escaped = simulateList([{ ticker: 'SBR', name: 'A | B, "C"', rank: 1 }], 'fixture.json', 'rows');
  assert.equal(escaped.affected[0].name, 'A | B, "C"');
});

test('each mandatory production anchor is broken once in memory and restored', () => {
  const event = (ticker, file, track, rankBefore, rankAfter) => ({ ticker, list: 'findash-export/v1/' + file, track, rankBefore, rankAfter });
  const baseline = {
    affected: [event('BURE.ST', 'financials.json', 'unprofitable', 1, null), event('FMONC.PA', 'financials.json', 'unprofitable', 17, null), event('SBR', 'energy.json', 'profitable', 80, null)],
    moved: [event('FRU.TO', 'energy.json', 'profitable', 87, 86), event('BSM', 'energy.json', 'profitable', 100, 99)],
  };
  assert.deepEqual(anchorProblems(baseline), []);
  for (const key of ['affected', 'moved']) for (let index = 0; index < baseline[key].length; index++) {
    const broken = structuredClone(baseline);
    broken[key][index].rankAfter = 999;
    assert.equal(anchorProblems(broken).length, 1);
    assert.deepEqual(anchorProblems(baseline), []);
  }
});

test('destination guard rejects writes into the input before any write and accepts report destinations', () => {
  const live = path.join(OUTPUTS, 'findash-export/v1/energy.json');
  const before = digest(live);
  assert.throws(() => reportPaths(OUTPUTS, path.join(OUTPUTS, 'report.md')), /schreibgeschützten Eingabe/);
  assert.throws(() => reportPaths(OUTPUTS, path.join(OUTPUTS, 'findash-export/v1/report.md')), /schreibgeschützten Eingabe/);
  assert.throws(() => reportPaths(OUTPUTS, live), /\.md-Datei/);
  assert.ok(reportPaths(OUTPUTS, path.resolve(__dirname, '../docs/non-operating-shadow-vorher-nachher-2026-10-03.md')).csv.endsWith('.csv'));
  assert.throws(() => main([]), /Aufruf/);
  assert.throws(() => main(['--unknown', 'x']), /Argumente/);
  assert.equal(digest(live), before);
});
