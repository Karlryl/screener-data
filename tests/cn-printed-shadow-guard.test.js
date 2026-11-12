'use strict';
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
const H = require('./cn-printed.helpers');
const before = H.liveHashes();
const allowed = new Set(['scripts/fetch-cn-printed.js', 'scripts/cn-printed-shadow-report.js', 'scripts/cn-printed-parser.js']);
function files(root) {
  const out = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f); else if (/\.(?:js|cjs|mjs|ts|json)$/.test(e.name)) out.push(f);
    }
  }
  for (const dir of ['src', 'lib', 'scripts', 'configs']) walk(path.join(root, dir));
  for (const f of fs.readdirSync(root)) if (/\.(?:js|cjs|mjs|json)$/.test(f) && fs.statSync(path.join(root, f)).isFile()) out.push(path.join(root, f));
  return out;
}
function violations(root) {
  const result = [];
  for (const file of files(root)) {
    const rel = path.relative(root, file).replace(/\\/g, '/');
    if (allowed.has(rel)) continue;
    // Also catch direct concatenation of the filename and imports of the shadow reader.
    const source = fs.readFileSync(file, 'utf8').replace(/['"]\s*\+\s*['"]/g, '');
    if (/cn-printed|cnPrinted/.test(source)) result.push(rel);
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
assert.deepEqual(violations(dir), []);
const original = fs.readFileSync(probe, 'utf8');
assert.equal(original.split('\n').filter(l => l === anchor).length, 1);
fs.writeFileSync(probe, original.replace(/^const input = 'ordinary\.json';$/m, "const input = require('fs').readFileSync('external-data/exchange-quarters/cn-printed.json');"));
assert.throws(() => assert.deepEqual(violations(dir), []), /probe/);
assert.deepEqual(violations(dir), ['src/scoring/probe.js']);
assert.deepEqual(H.liveHashes(), before);
console.log('Shadow guard green; intentional read leak detected in test tree; production store hashes unchanged.');
