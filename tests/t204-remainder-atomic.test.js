'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const FIXTURE_DIR = path.join(__dirname, 'fixtures', 't204-remainder');
const PRELOAD = path.join(FIXTURE_DIR, 'preload.js');
const RUNNER = path.join(FIXTURE_DIR, 'fixture-runner.js');
const SENTINEL = Buffer.from('T204 sentinel: keep on rename failure\n', 'utf8');

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function temporaryDirectory(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `t204-remainder-${label}-`));
}

function cleanup(dir) {
  const resolved = path.resolve(dir);
  const tempRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
  assert.ok(resolved.startsWith(tempRoot), `refusing cleanup outside OS temp: ${resolved}`);
  fs.rmSync(resolved, { recursive: true, force: true });
}

function execute(command, args, { target, trace, fault = '', input = null, env = {} }) {
  return spawnSync(process.execPath, ['--require', PRELOAD, command, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
      T204_TARGET: target,
      T204_TRACE: trace,
      T204_FAULT: fault,
      T204_INPUT: JSON.stringify(input),
    },
  });
}

function runFixture(action, dir, { initial = SENTINEL, fault = '', input }) {
  const target = action === 'studie'
    ? path.join(dir, `${input.laufDatum.slice(0, 7)}.jsonl`)
    : path.join(dir, `${action}.artifact`);
  const trace = path.join(dir, `${action}.${fault || 'normal'}.trace.json`);
  fs.writeFileSync(target, initial);
  const child = execute(RUNNER, [action, ROOT, target], { target, trace, fault, input });
  return { child, target, trace: JSON.parse(fs.readFileSync(trace, 'utf8')) };
}

function tempNames(target) {
  const basename = `${path.basename(target)}.tmp.`;
  return fs.readdirSync(path.dirname(target)).filter((name) => name.startsWith(basename));
}

function assertSiblingTemp(target, tempPath) {
  assert.equal(path.dirname(tempPath), path.dirname(target), 'temporary file must be a sibling');
  assert.ok(tempPath.startsWith(`${target}.tmp.`), `unexpected temporary path: ${tempPath}`);
}

function assertNormalAtomic(result, expected) {
  assert.equal(result.child.status, 0, result.child.stderr || result.child.stdout);
  assert.deepEqual(fs.readFileSync(result.target), expected, 'published bytes drifted from old writer semantics');
  assert.deepEqual(result.trace.directWrites, [], 'target was written directly instead of through sibling rename');
  const writeOpens = result.trace.opens.filter((open) => open.flags === 'w');
  assert.equal(writeOpens.length, 1, 'normal write must open exactly one target-related path for writing');
  assertSiblingTemp(result.target, writeOpens[0].path);
  assert.equal(result.trace.renames.length, 1, 'normal write must publish with one rename');
  assertSiblingTemp(result.target, result.trace.renames[0].from);
  assert.equal(result.trace.renames[0].to, result.target);
  assert.deepEqual(result.trace.unlinks, [], 'normal write must not need cleanup');
  assert.deepEqual(tempNames(result.target), [], 'normal write left sibling temp residue');
}

function assertRenameFailure(result, sentinel = SENTINEL) {
  assert.notEqual(result.child.status, 0, 'injected rename EIO must surface as a failing process');
  assert.match(`${result.child.stderr}\n${result.child.stdout}`, /T204_RENAME_EIO|EIO/);
  assert.deepEqual(fs.readFileSync(result.target), sentinel, 'failed rename changed the prior target bytes');
  assert.deepEqual(result.trace.directWrites, [], 'failure path bypassed the atomic helper');
  const writeOpens = result.trace.opens.filter((open) => open.flags === 'w');
  assert.ok(writeOpens.length >= 1, 'failure path did not create a sibling temporary file');
  assert.ok(result.trace.renames.length >= 1, 'failure path never reached rename');
  for (const open of writeOpens) assertSiblingTemp(result.target, open.path);
  for (const rename of result.trace.renames) assertSiblingTemp(result.target, rename.from);
  assert.equal(result.trace.unlinks.length, result.trace.renames.length, 'each failed rename temp must be unlinked');
  assert.deepEqual(tempNames(result.target), [], 'rename failure left sibling temp residue');
}

const writerCases = [
  {
    action: 'ab',
    input: '# Computed-margin fixture\n\nA/B = unchanged\n',
    expected(input) { return Buffer.from(input, 'utf8'); },
  },
  {
    action: 'f4',
    input: '# Quartalsvergleich fixture\n\nNo trailing newline here.',
    expected(input) { return Buffer.from(`${input}\n`, 'utf8'); },
  },
  {
    action: 'qc',
    input: { generated_at: '2000-01-01T00:00:00.000Z', pooled: { n: 3, rho: 0.125 }, perSector: {} },
    expected(input) { return Buffer.from(JSON.stringify(input, null, 2), 'utf8'); },
  },
  {
    action: 't168',
    input: '# T168 synthetic layer diff\n\nNo measurements were run.\n',
    expected(input) { return Buffer.from(input, 'utf8'); },
  },
];

for (const fixture of writerCases) {
  test(`${fixture.action}: exact bytes publish through one sibling rename`, () => {
    const dir = temporaryDirectory(`${fixture.action}-normal`);
    try {
      const result = runFixture(fixture.action, dir, { input: fixture.input });
      assertNormalAtomic(result, fixture.expected(fixture.input));
    } finally {
      cleanup(dir);
    }
  });

  test(`${fixture.action}: rename EIO surfaces and preserves the target`, () => {
    const dir = temporaryDirectory(`${fixture.action}-eio`);
    try {
      const result = runFixture(fixture.action, dir, { input: fixture.input, fault: 'rename-eio' });
      assertRenameFailure(result);
    } finally {
      cleanup(dir);
    }
  });
}

test('studie-mitschrift: RMW keeps arbitrary prior bytes and heals a truncated tail', () => {
  const dir = temporaryDirectory('studie-normal');
  const initial = Buffer.from([0x7b, 0x22, 0x74, 0x72, 0x75, 0x6e, 0x63, 0xff]);
  const entry = { schema: 'synthetic/t204', laufDatum: '2099-02-03', status: 'MIT_LUECKEN' };
  try {
    const result = runFixture('studie', dir, { initial, input: entry });
    const expected = Buffer.concat([initial, Buffer.from(`\n${JSON.stringify(entry)}\n`, 'utf8')]);
    assertNormalAtomic(result, expected);
    assert.equal(sha256(fs.readFileSync(result.target)), sha256(expected));
  } finally {
    cleanup(dir);
  }
});

test('studie-mitschrift: an existing empty file still receives its historical leading LF', () => {
  const dir = temporaryDirectory('studie-empty');
  const entry = { schema: 'synthetic/t204', laufDatum: '2099-03-04', status: 'VOLLSTAENDIG' };
  try {
    const result = runFixture('studie', dir, { initial: Buffer.alloc(0), input: entry });
    assertNormalAtomic(result, Buffer.from(`\n${JSON.stringify(entry)}\n`, 'utf8'));
  } finally {
    cleanup(dir);
  }
});

function copyExact(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  assert.equal(sha256(fs.readFileSync(to)), sha256(fs.readFileSync(from)), `fixture copy drifted: ${from}`);
}

function syntheticScriptRoot(label, scriptName) {
  const root = temporaryDirectory(label);
  copyExact(path.join(ROOT, 'scripts', scriptName), path.join(root, 'scripts', scriptName));
  copyExact(path.join(ROOT, 'lib', 'atomic-write.js'), path.join(root, 'lib', 'atomic-write.js'));
  return root;
}

function prepareCoverageRoot(label) {
  const root = syntheticScriptRoot(label, 'count-basic-coverage.js');
  for (const name of ['fundamentals-cache', 'snapshots-smallcap', 'reports']) {
    fs.mkdirSync(path.join(root, name), { recursive: true });
  }
  fs.writeFileSync(path.join(root, 'fundamentals-cache', 'ALPHA.json'), JSON.stringify({
    payload: {
      ftsAnnual: { revenue: [300, 200, 100], basicAverageShares: [30, 20, 10] },
      ftsAnnualShares: [30, null, 10],
    },
  }));
  fs.writeFileSync(path.join(root, 'fundamentals-cache', 'BROKEN.json'), '{not-json');
  fs.writeFileSync(path.join(root, 'snapshots-smallcap', 'ALPHA.json'), '{}');
  fs.writeFileSync(path.join(root, 'snapshots-smallcap', 'MISSING.json'), '{}');
  return root;
}

const COVERAGE_REPORT_SHA256 = 'b554450f058ac01e979f730d125e0c87eb575d635f2f18c9d92d61f3a13149bb';

test('count-basic-coverage: exact copied top-level script publishes pinned fixture bytes atomically', () => {
  const root = prepareCoverageRoot('count-normal');
  const target = path.join(root, 'reports', '52-basic-coverage-2026-08-05.md');
  const trace = path.join(root, 'count.normal.trace.json');
  fs.writeFileSync(target, SENTINEL);
  try {
    const child = execute(path.join(root, 'scripts', 'count-basic-coverage.js'), [], { target, trace });
    const result = { child, target, trace: JSON.parse(fs.readFileSync(trace, 'utf8')) };
    assert.equal(child.status, 0, child.stderr || child.stdout);
    assert.equal(
      sha256(fs.readFileSync(target)),
      COVERAGE_REPORT_SHA256,
      `coverage fixture payload hash drifted: ${sha256(fs.readFileSync(target))}`,
    );
    assertNormalAtomic(result, fs.readFileSync(target));
  } finally {
    cleanup(root);
  }
});

test('count-basic-coverage: copied script surfaces rename EIO and preserves prior bytes', () => {
  const root = prepareCoverageRoot('count-eio');
  const target = path.join(root, 'reports', '52-basic-coverage-2026-08-05.md');
  const trace = path.join(root, 'count.eio.trace.json');
  fs.writeFileSync(target, SENTINEL);
  try {
    const child = execute(path.join(root, 'scripts', 'count-basic-coverage.js'), [], {
      target, trace, fault: 'rename-eio',
    });
    assertRenameFailure({ child, target, trace: JSON.parse(fs.readFileSync(trace, 'utf8')) });
  } finally {
    cleanup(root);
  }
});

test('studie-mitschrift: copied CLI fails loud when every rename fails, using synthetic channels only', () => {
  const root = syntheticScriptRoot('studie-cli-eio', 'studie-mitschrift.js');
  const external = path.join(root, 'external-data');
  const logDir = path.join(root, 'synthetic-log');
  fs.mkdirSync(external, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(path.join(external, 'sec-form4-cache.json'), '{"synthetic":true}\n');
  fs.writeFileSync(path.join(external, 'sec-annual-bulk.jsonl'), '{"synthetic":true}\n');
  fs.writeFileSync(path.join(external, 'sec-secannual.json'), '{"synthetic":true}\n');
  const target = path.join(logDir, '2099-04.jsonl');
  const trace = path.join(root, 'studie.cli.eio.trace.json');
  const initial = Buffer.from('{"laufDatum":"2099-04-01","kanaele":[],"luecken":[],"status":"VOLLSTAENDIG"}\n');
  fs.writeFileSync(target, initial);
  try {
    const child = execute(path.join(root, 'scripts', 'studie-mitschrift.js'), ['erfassen', '2099-04-02'], {
      target,
      trace,
      fault: 'rename-eio',
      env: { STUDIE_MITSCHRIFT_DIR: logDir },
    });
    const result = { child, target, trace: JSON.parse(fs.readFileSync(trace, 'utf8')) };
    assertRenameFailure(result, initial);
    assert.equal(child.status, 1);
    assert.match(child.stderr, /GAR KEINE Zeile/);
    assert.equal(result.trace.renames.length, 2, 'main write and FEHLER fallback must both reach rename');
  } finally {
    cleanup(root);
  }
});

test('runtime guard rejects a direct target write (mutation-sensitivity self-test)', () => {
  const dir = temporaryDirectory('direct-guard');
  const target = path.join(dir, 'direct.artifact');
  const tracePath = path.join(dir, 'direct.trace.json');
  fs.writeFileSync(target, SENTINEL);
  try {
    const child = execute(RUNNER, ['direct', ROOT, target], {
      target, trace: tracePath, input: 'bypass',
    });
    const trace = JSON.parse(fs.readFileSync(tracePath, 'utf8'));
    assert.notEqual(child.status, 0, 'guard accepted a direct write');
    assert.match(child.stderr, /T204_DIRECT_WRITE_GUARD/);
    assert.deepEqual(fs.readFileSync(target), SENTINEL);
    assert.deepEqual(trace.directWrites, [{ kind: 'writeFileSync', path: target }]);
    assert.deepEqual(trace.renames, []);
  } finally {
    cleanup(dir);
  }
});

test('production callers remain wired to the tested seams and the six bare writes stay absent', () => {
  const contracts = [
    {
      file: 'scripts/studie-mitschrift.js',
      required: /writeFileAtomic\(datei, Buffer\.concat\(\[vorher, neueZeile\]\), 'utf8'\);/,
      forbidden: /fs\.appendFileSync\(datei,/,
    },
    {
      file: 'scripts/ab-computed-margin.js',
      required: /writeReportArtifact\(outPfad, txt\);/,
      forbidden: /fs\.writeFileSync\(outPfad,/,
    },
    {
      file: 'scripts/count-basic-coverage.js',
      required: /writeFileAtomic\(reportPath, report, 'utf8'\);/,
      forbidden: /fs\.writeFileSync\(reportPath,/,
    },
    {
      file: 'scripts/f4-quartalsvergleich.js',
      required: /writeReportArtifact\(argv\[outIdx \+ 1\], md\);/,
      forbidden: /fs\.writeFileSync\(argv\[outIdx \+ 1\],/,
    },
    {
      file: 'scripts/qc-overlap.js',
      required: /writeOverlapArtifact\(OUT, out\);/,
      forbidden: /fs\.writeFileSync\(OUT,/,
    },
    {
      file: 'scripts/t168-layer-diff.js',
      required: /writeLayerDiffReport\(r\.outFile, txt\);/,
      forbidden: /fs\.writeFileSync\(r\.outFile,/,
    },
  ];
  for (const contract of contracts) {
    const source = fs.readFileSync(path.join(ROOT, contract.file), 'utf8');
    assert.match(source, contract.required, `${contract.file}: tested writer seam is no longer the production caller`);
    assert.doesNotMatch(source, contract.forbidden, `${contract.file}: bare target write returned`);
  }
});
