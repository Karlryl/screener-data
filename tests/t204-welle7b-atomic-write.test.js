'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures', 't204-welle7b');
const SENTINEL = Buffer.from('T204 original sentinel\n\x00\xff', 'latin1');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const firstLine = JSON.stringify({ date: '2099-01-01', value: 1, prevHash: 'GENESIS' });
const secondRow = { date: '2099-01-02', value: 2 };
const secondLine = JSON.stringify({ ...secondRow, prevHash: hash(firstLine) });
// Deliberately noncanonical whitespace: preservation means bytes, not reserialization.
const oldMeta = Buffer.from(JSON.stringify({ rows: 1, lastDate: '2099-01-01', lastHash: hash(firstLine) }, null, 3) + '\n\n');

// Keep production imports in the subprocess fixture, like the reference harness.
function inspectLedger(file, retry = false) {
  const child = spawnSync(process.execPath, [path.join(FIXTURES, 'fixture-runner.js'), 'inspect', ROOT, file], {
    encoding: 'utf8', env: { ...process.env, T204_INPUT: JSON.stringify({ retry }) },
  });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}

function run(action, fault, check) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't204-welle7b-'));
  try {
    const ledgerFile = path.join(dir, 'ledger.jsonl');
    const target = action === 'meta' ? ledgerFile + '.meta.json'
      : action === 'raw' ? path.join(dir, 'raw', '2099-01-02.jsonl.gz')
        : path.join(dir, 'export', '_FAILED.json');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const initial = action === 'meta' ? oldMeta : SENTINEL;
    fs.writeFileSync(target, initial);
    if (action === 'meta') fs.writeFileSync(ledgerFile, firstLine + '\n');
    const input = action === 'meta' ? { ledger: ledgerFile, row: secondRow }
      : action === 'raw' ? { date: '2099-01-02', rows: [{ ticker: 'SYNTHETIC' }] }
        : { reason: 'synthetic failure', failedAt: 'fixture' };
    const traceFile = path.join(dir, 'trace.json');
    const child = spawnSync(process.execPath, [
      '--require', path.join(FIXTURES, 'preload.js'),
      path.join(FIXTURES, 'fixture-runner.js'), action, ROOT, target,
    ], {
      encoding: 'utf8',
      env: { ...process.env, T204_TARGET: target, T204_TRACE: traceFile,
        T204_FAULT: fault, T204_INPUT: JSON.stringify(input) },
    });
    assert.equal(child.error, undefined);
    const trace = JSON.parse(fs.readFileSync(traceFile, 'utf8'));
    check({ child, trace, target, initial, ledgerFile });
  } finally {
    const resolved = path.resolve(dir);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

function assertAtomic({ trace, target }, failed) {
  assert.deepEqual(trace.directWrites, []);
  const opens = trace.opens.filter((entry) => entry.flags === 'w');
  assert.equal(opens.length, 1);
  assert.equal(trace.renames.length, 1);
  assert.equal(path.dirname(opens[0].path), path.dirname(target));
  assert.ok(opens[0].path.startsWith(target + '.tmp.'));
  assert.deepEqual(trace.renames[0], { from: opens[0].path, to: target });
  assert.deepEqual(trace.unlinks, failed ? [{ path: opens[0].path }] : []);
  assert.deepEqual(fs.readdirSync(path.dirname(target))
    .filter((name) => name.startsWith(path.basename(target) + '.tmp.')), []);
}

const expectedRaw = '{"ticker":"SYNTHETIC","marketCap":null,"close":null,"sma50":null,"sma200":null,"high252":null,"low252":null,"ret63":null,"m1":null,"m2":null,"sigma63":null}\n';
const expected = {
  meta: Buffer.from(JSON.stringify({ rows: 2, lastDate: '2099-01-02', lastHash: hash(secondLine) }, null, 1) + '\n'),
  raw: zlib.gzipSync(Buffer.from(expectedRaw)),
  failed: Buffer.from(JSON.stringify({ schema: 'findash-druckenmiller/v1',
    generated_at: '2099-01-02T03:04:05.000Z', reason: 'synthetic failure', failedAt: 'fixture' }, null, 1) + '\n'),
};

for (const action of ['meta', 'raw', 'failed']) {
  test(action + ': exact original serialization publishes via sibling rename', () => {
    run(action, '', (result) => {
      assert.equal(result.child.status, 0, result.child.stderr);
      assertAtomic(result, false);
      assert.deepEqual(fs.readFileSync(result.target), expected[action]);
      if (action === 'meta') {
        assert.equal(fs.readFileSync(result.ledgerFile, 'utf8'), firstLine + '\n' + secondLine + '\n');
        assert.equal(inspectLedger(result.ledgerFile).verified.ok, true);
      }
    });
  });

  test(action + ': rename EIO preserves ORIGINAL sentinel bytes and cleans tmp', () => {
    run(action, 'rename-eio', (result) => {
      assert.equal(result.child.status, action === 'failed' ? 0 : 1);
      assert.match(result.child.stderr + result.child.stdout, /T204_RENAME_EIO/);
      if (action === 'failed') assert.match(result.child.stdout, /::error::.*Fehlermarker nicht schreibbar/);
      assert.deepEqual(fs.readFileSync(result.target), result.initial);
      assertAtomic(result, true);
    });
  });
}

test('meta failure retains both ledger rows and old meta; mismatch blocks further appends without loss', () => {
  run('meta', 'rename-eio', (result) => {
    assert.equal(result.child.status, 1);
    assertAtomic(result, true);
    const bytes = fs.readFileSync(result.ledgerFile);
    assert.deepEqual(bytes, Buffer.from(firstLine + '\n' + secondLine + '\n'));
    assert.deepEqual(fs.readFileSync(result.target), oldMeta);
    const { meta, rows, verified, retryError } = inspectLedger(result.ledgerFile, true);
    assert.equal(meta.rows, 1);
    assert.equal(meta.lastDate, rows[0].date);
    assert.equal(meta.lastHash, hash(firstLine));
    assert.equal(rows.length, 2);
    assert.equal(rows[1].prevHash, meta.lastHash);
    assert.notEqual(hash(secondLine), meta.lastHash);
    assert.equal(verified.ok, false);
    assert.match(verified.error, /Sidecar/);
    assert.match(retryError, /Sidecar/);
    assert.deepEqual(fs.readFileSync(result.ledgerFile), bytes);
    assert.deepEqual(fs.readFileSync(result.target), oldMeta);
  });
});

test('daily writer seam remains wired to production and ledger stays an append', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts/druckenmiller-log-internals.js'), 'utf8');
  assert.match(source, /schreibeRoh\(outDir, d, roh\);/);
  const ledgerSource = fs.readFileSync(path.join(ROOT, 'lib/druckenmiller/ledger.js'), 'utf8');
  assert.match(ledgerSource, /fs\.appendFileSync\(ledgerFile, line \+ '\\n'\);/);
});
