'use strict';
// Run: node tests/test-coverage-report.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const TOOL = path.join(ROOT, 'scripts/test-coverage-report.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-coverage-contract-'));
let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('ok ' + name); } catch (e) { fail++; console.error('FAIL ' + name + '\n' + e.stack); } }
function run(args) { return spawnSync(process.execPath, [TOOL, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 12000 }); }
function output(name) { return path.join(tmp, name + '.json'); }
function read(name) { return JSON.parse(fs.readFileSync(output(name), 'utf8')); }
try {
  const mini = path.join(tmp, 'mini');
  fs.mkdirSync(path.join(mini, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(mini, 'scripts'));
  fs.writeFileSync(path.join(mini, 'lib/mini.js'), "'use strict';\r\n// comment\r\nfunction a() {\r\n  return 1;\r\n}\r\nfunction b() {\r\n  return 2;\r\n}\r\nmodule.exports = { a, b };\r\n");
  fs.writeFileSync(path.join(mini, 'scripts/s.js'), 'module.exports = 7;\r\n');
  fs.writeFileSync(path.join(mini, 'lib/mini.test.js'), "require('./mini.js').a(); require('../scripts/s.js');\n");
  test('fixture covers called function, misses b, counts CRLF and excludes tests', () => {
    const result = run(['--root', mini, '--tests', 'lib/*test.js', '--json', output('fixture')]);
    assert.equal(result.status, 0, result.stderr);
    const rows = read('fixture');
    const mod = rows.find(r => r.file === 'lib/mini.js');
    assert.equal(mod.fnsUncovered, 1);
    assert.equal(mod.uncoveredFns[0].name, 'b');
    assert.ok(mod.pct >= 30 && mod.pct <= 90);
    assert.equal(rows.find(r => r.file === 'scripts/s.js').pct, 100);
    assert.ok(!rows.some(r => r.file.endsWith('test.js')));
  });
  test('real library contracts reproduce baseline and leave repository directory untouched', () => {
    const before = fs.readdirSync(ROOT).sort();
    const result = run(['--tests', 'lib/metrics.test.js,lib/artifact-path.test.js', '--json', output('real')]);
    assert.equal(result.status, 0, result.stderr);
    const rows = read('real');
    for (const file of ['lib/metrics.js', 'lib/spearman.js', 'lib/artifact-path.js']) {
      const row = rows.find(r => r.file === file);
      assert.ok(row, file);
      assert.ok(row.pct >= 0 && row.pct <= 100 && row.covered <= row.total);
    }
    assert.equal(rows.find(r => r.file === 'lib/spearman.js').pct, 100);
    assert.equal(rows.find(r => r.file === 'lib/artifact-path.js').pct, 100);
    assert.ok(rows.find(r => r.file === 'lib/metrics.js').uncoveredFns.some(fn => fn.name === 'hitRate'));
    assert.match(result.stdout, /^# tests: 2 gelaufen/);
    assert.ok(result.stdout.split('\n').filter(line => /^\d+(?:\.\d+)?%/.test(line)).length >= 3);
    assert.deepEqual(fs.readdirSync(ROOT).sort(), before);
  });
  test('missing tests and malformed options exit 2', () => {
    for (const args of [['--tests', 'gibtsnicht/*test.js'], ['--parallel', '0'], ['--unknown'], ['--json']]) {
      const result = run(args);
      assert.equal(result.status, 2, result.stderr);
      assert.ok(result.stderr.trim());
    }
  });
  test('child-process coverage is merged by maximum and functions called in either process stay covered', () => {
    fs.writeFileSync(path.join(mini, 'lib/child.test.js'), "require('node:child_process').spawnSync(process.execPath, ['-e', \"require('./lib/mini.js').b()\"], {stdio:'ignore'});\n");
    const result = run(['--root', mini, '--tests', 'lib/*test.js', '--parallel', '2', '--json', output('child'), '--fns', '--top', '1']);
    assert.equal(result.status, 0, result.stderr);
    const row = read('child').find(r => r.file === 'lib/mini.js');
    assert.equal(row.fnsUncovered, 0);
    assert.equal(row.pct, 100);
    assert.match(result.stdout, /never-called fns:/);
  });
  test('timeouts remain diagnostic and explicitly disclose missing killed-process coverage', () => {
    fs.writeFileSync(path.join(mini, 'lib/hang.test.js'), 'setInterval(() => {}, 1000);\n');
    const result = run(['--root', mini, '--tests', 'lib/hang.test.js', '--timeout-ms', '200']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /1 timeout.*TIMEOUT: killed-process coverage is lost/);
  });
} finally {
  const owned = path.resolve(tmp);
  assert.equal(path.dirname(owned), path.resolve(os.tmpdir()));
  assert.ok(path.basename(owned).startsWith('test-coverage-contract-'));
  fs.rmSync(owned, { recursive: true, force: true });
}
console.log(`test-coverage-report: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
