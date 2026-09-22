'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures', 't204-welle7c');
const PRELOAD = path.join(__dirname, 'fixtures', 't204-remainder', 'preload.js');
const SENTINEL = Buffer.from('ORIGINAL sentinel\r\n\u0000\u00ff: preserve every byte');

// expected-*.json were produced by the unmodified writer with this runner.
// They are frozen byte oracles, not rebuilt from the implementation under test.
for (const [action, filename] of [['quarter', '2099-03-31.json'], ['coverage', '_coverage.json']]) {
  for (const fault of ['', 'rename-eio']) {
    test(`${action}: ${fault || 'original writer byte identity and atomic publication'}`, () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't204-welle7c-'));
      const target = path.join(dir, filename);
      const tracePath = path.join(dir, 'trace.json');
      fs.writeFileSync(target, SENTINEL);
      try {
        const child = spawnSync(process.execPath, ['--require', PRELOAD,
          path.join(FIXTURES, 'fixture-runner.js'), action, ROOT, target], {
          encoding: 'utf8', timeout: 10000,
          env: { ...process.env, T204_TARGET: target, T204_TRACE: tracePath, T204_FAULT: fault },
        });
        assert.ifError(child.error);
        const trace = JSON.parse(fs.readFileSync(tracePath, 'utf8'));
        assert.deepEqual(trace.directWrites, [], 'writer bypassed the atomic helper');
        assert.equal(trace.renames.length, 1, 'writer must reach exactly one rename');
        const rename = trace.renames[0];
        assert.equal(rename.to, target);
        assert.equal(path.dirname(rename.from), dir);
        assert.ok(rename.from.startsWith(`${target}.tmp.`));
        assert.deepEqual(trace.opens.filter((open) => open.flags === 'w'),
          [{ path: rename.from, flags: 'w' }]);
        if (fault) {
          assert.equal(child.status, 1, child.stderr || child.stdout);
          assert.match(child.stderr + child.stdout, /T204_RENAME_EIO/);
          assert.deepEqual(fs.readFileSync(target), SENTINEL, 'prior bytes changed');
          assert.deepEqual(trace.unlinks, [{ path: rename.from }]);
        } else {
          assert.equal(child.status, 0, child.stderr || child.stdout);
          assert.deepEqual(fs.readFileSync(target),
            fs.readFileSync(path.join(FIXTURES, `expected-${action}.json`)), 'old/new byte drift');
          assert.deepEqual(trace.unlinks, []);
        }
        assert.deepEqual(fs.readdirSync(dir).filter((name) => name.startsWith(`${filename}.tmp.`)), []);
      } finally {
        assert.ok(path.resolve(dir).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`));
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }
}
