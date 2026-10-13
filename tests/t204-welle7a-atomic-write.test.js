'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const ROOT = path.join(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures', 't204-welle7a');
const SENTINEL = Buffer.from('ORIGINAL sentinel: keep these bytes\r\n\u0000');
const OLD_MARKER = '{ "reason": "original cause", "unicode": "\u00e4" }\r\n';
const REPLACEMENT = '{ "reason": "replacement sentinel" }\n';
const META = { universe: { withBars250: 1 }, paramsHash: 'fixture-hash', duquesne13fCoverage: null };
const REGIME = { asOf: '2099-01-02', series: [{ value: 0.125, missing: null, text: '\u00e4' }] };
const THIRTEEN = { quarters: [{ period: '2098-12-31' }], coverage: 0.75 };
const CANDIDATES = { rows: [{ ticker: 'SYNTH', m1: 1.23456789 }] };
const jsonBytes = (value) => Buffer.from(JSON.stringify(value) + '\n');
const cases = [
  { site: 'regime', file: 'regime.json', expected: jsonBytes(REGIME) },
  { site: 'meta-first', file: 'meta.json', expected: jsonBytes(META) },
  { site: 'duquesne13f', file: 'duquesne13f.json', expected: jsonBytes(THIRTEEN) },
  // The first meta write publishes these exact sentinel bytes before the second attempt.
  { site: 'meta-second', file: 'meta.json', occurrence: 2, initial: jsonBytes(META),
    expected: jsonBytes({ ...META, duquesne13fCoverage: 0.75 }) },
  { site: 'candidates', file: 'candidates.json', expected: jsonBytes(CANDIDATES) },
  { site: 'marker', file: '_FAILED.json', initial: Buffer.from(OLD_MARKER),
    prior: Buffer.from(REPLACEMENT), expected: Buffer.from(OLD_MARKER) },
];

for (const fixture of cases) {
  for (const fault of ['', 'rename-eio']) {
    test(`${fixture.site}: ${fault || 'exact bytes through sibling rename'}`, () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't204-welle7a-'));
      const target = path.join(dir, fixture.file);
      const tracePath = path.join(dir, 'trace.json');
      const initial = fixture.initial || SENTINEL;
      fs.writeFileSync(target, initial);
      fs.writeFileSync(path.join(dir, 'candidates-ledger.jsonl'), 'synthetic fixture\n');
      try {
        const child = spawnSync(process.execPath, [
          '--require', path.join(FIXTURES, 'preload.js'),
          path.join(FIXTURES, 'fixture-runner.js'), fixture.site, ROOT, dir,
        ], {
          encoding: 'utf8', timeout: 15000,
          env: { ...process.env, T204_TARGET: target, T204_TRACE: tracePath,
            T204_FAULT: fault, T204_OCCURRENCE: String(fixture.occurrence || 1),
            T204_INPUT: JSON.stringify({ regime: REGIME, meta: META, thirteen: THIRTEEN,
              candidates: CANDIDATES, replacement: REPLACEMENT, with13f: fixture.site !== 'meta-first' }) },
        });
        assert.ifError(child.error);
        const trace = JSON.parse(fs.readFileSync(tracePath, 'utf8'));
        assert.deepEqual(fs.readFileSync(target), fault ? fixture.prior || initial : fixture.expected,
          'target must retain ORIGINAL pre-site bytes on failure; normal bytes must not drift');
        assert.equal(child.status, fault || fixture.site === 'marker' ? 1 : 0, child.stderr + child.stdout);
        if (fault) assert.match(child.stderr + child.stdout, /T204_RENAME_EIO/);
        assert.deepEqual(trace.directWrites, [], 'production bypassed the atomic helper');
        assert.equal(trace.renames.length, fixture.occurrence || 1);
        for (const rename of trace.renames) {
          assert.equal(rename.to, target);
          assert.equal(path.dirname(rename.from), dir);
          assert.ok(rename.from.startsWith(target + '.tmp.'));
        }
        assert.deepEqual(trace.unlinks, fault ? [trace.renames.at(-1).from] : []);
        assert.deepEqual(fs.readdirSync(dir).filter((name) => name.startsWith(fixture.file + '.tmp.')), []);
      } finally {
        const resolved = path.resolve(dir);
        assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
        fs.rmSync(resolved, { recursive: true, force: true });
      }
    });
  }
}
