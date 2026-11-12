'use strict';
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const H = require('./cn-printed.helpers');
const before = H.liveHashes();
const sourceHashes = () => Object.fromEntries(['scripts/cn-printed-parser.js', 'scripts/fetch-cn-printed.js',
  'scripts/cn-printed-shadow-report.js', 'tests/cn-printed-shadow-guard.test.js'].map(file =>
  [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(H.ROOT, file))).digest('hex')]));
const sourceBefore = sourceHashes();
const allowed = new Set(['scripts/fetch-cn-printed.js', 'scripts/cn-printed-shadow-report.js', 'scripts/cn-printed-parser.js']);
function trackedFiles(root) {
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', windowsHide: true,
    maxBuffer: 32 * 1024 * 1024 }).split('\0').filter(Boolean);
}
function violations(root, tracked = trackedFiles(root)) {
  const result = [];
  for (const rel of tracked) {
    if (/^(?:tests|external-data|docs)\//.test(rel) || /(?:^|\/)REPORT-[^/]+\.md$/.test(rel) || allowed.has(rel)) continue;
    if (!/\.(?:js|cjs|mjs|ts|py|yml|yaml|sh|ps1)$/.test(rel)) continue;
    const file = path.join(root, rel);
    // A sparse checkout may omit tracked content; inspect its tracked blob instead.
    const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') :
      execFileSync('git', ['show', ':' + rel], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    // Also catch direct concatenation of the filename and imports of the shadow reader.
    const source = content.replace(/['"]\s*\+\s*['"]/g, '');
    if (/cn-printed|cnPrinted|-printed\.json/.test(source)) result.push(rel);
  }
  return result;
}
assert.deepEqual(violations(H.ROOT), []);
const parser = fs.readFileSync(path.join(H.ROOT, 'scripts/cn-printed-parser.js'), 'utf8');
assert.doesNotMatch(parser, /require\(['"](?:node:)?(?:fs|https?|child_process)['"]\)|readFile|writeFile|fetch\(/);
// Break the guard once, ONLY in a disposable miniature source tree. Match the WHOLE
// anchor line, validate the destination before writing, and compare real-store hashes.
const dir = H.sandbox(), probe = path.join(dir, 'src/scoring/probe.js');
assert.ok(path.resolve(probe).startsWith(path.resolve(dir) + path.sep));
assert.ok(!path.resolve(probe).startsWith(path.join(H.ROOT, 'src') + path.sep));
fs.mkdirSync(path.dirname(probe), { recursive: true });
const anchor = "const input = 'ordinary.json';";
fs.writeFileSync(probe, anchor + '\n');
assert.deepEqual(violations(dir, ['src/scoring/probe.js']), []);
const original = fs.readFileSync(probe, 'utf8');
assert.equal(original.split('\n').filter(l => l === anchor).length, 1);
fs.writeFileSync(probe, original.replace(/^const input = 'ordinary\.json';$/m, "const input = require('fs').readFileSync('external-data/exchange-quarters/cn-printed.json');"));
assert.throws(() => assert.deepEqual(violations(dir, ['src/scoring/probe.js']), []), /probe/);
assert.deepEqual(violations(dir, ['src/scoring/probe.js']), ['src/scoring/probe.js']);
assert.deepEqual(sourceHashes(), sourceBefore); assert.deepEqual(H.liveHashes(), before);
// The same scanner receives a miniature tracked-file manifest. Git remains read-only;
// each probe has its own tree and cannot change the real index or production files.
for (const [rel, source] of [
  ['discovery/probe.js', "const input = 'external-data/exchange-quarters/cn-printed.json';"],
  ['scripts/probe.py', "data = open('external-data/exchange-quarters/cn-printed.json').read()"],
  ['scripts/probe.mjs', 'const input = `${k}-printed.json`;'],
  ['.github/workflows/daily-pull.yml', 'steps:\n  - run: node scripts/fetch-cn-printed.js'],
  ['discovery/module.ts', "const parser = require('../scripts/cn-printed-parser');"]
]) {
  const tree = H.sandbox(), destination = path.resolve(tree, rel);
  assert.ok(destination.startsWith(path.resolve(tree) + path.sep));
  assert.ok(!destination.startsWith(path.join(H.ROOT, '.github') + path.sep));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, 'ordinary input\n');
  assert.deepEqual(violations(tree, [rel]), []);
  fs.writeFileSync(destination, source + '\n');
  assert.throws(() => assert.deepEqual(violations(tree, [rel]), []));
  assert.deepEqual(violations(tree, [rel]), [rel]);
  assert.deepEqual(sourceHashes(), sourceBefore); assert.deepEqual(H.liveHashes(), before);
}
assert.deepEqual(H.liveHashes(), before);
console.log('Shadow guard green across tracked files including workflows; 6 intentional leaks detected; production store hashes unchanged.');
