'use strict';
/**
 * Gate fuer die Sichtbarkeits-Zaehler in lib/atomic-write.js (Tag 651, F-CGPT-015).
 *
 * Der Befund: das Modul schluckt Fehler (Verzeichnis-fsync) bzw. drosselt still
 * (Windows-Rename-Retry). Der eigentliche Fix (Fehler an den Aufrufer durchreichen)
 * ist wegen des Blast-Radius zurueckgestellt — dieser Gate sichert nur den ADDITIVEN
 * Zwischenschritt: das Geschluckte ist messbar, das Verhalten unveraendert.
 *
 * Standalone-Runner, kein Netz. Run: node lib/atomic-write.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeFileAtomic, writeJsonAtomic, atomicWriteStats } = require('./atomic-write.js');

const IS_WINDOWS = process.platform === 'win32';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.stack); }
}

const tmpDirs = [];
function tmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-write-'));
  tmpDirs.push(d);
  return d;
}
function snapshot() { return Object.assign({}, atomicWriteStats); }

// --- (a) Normalfall: Aufrufer sehen exakt das alte Verhalten, kein Zaehler bewegt sich.
test('Normalfall schreibt unveraendert und laesst alle Zaehler stehen', () => {
  const vorher = snapshot();
  const dir = tmp();
  const p = path.join(dir, 'state.json');
  writeFileAtomic(p, '{"k":"v"}');
  assert.equal(fs.readFileSync(p, 'utf8'), '{"k":"v"}');
  writeJsonAtomic(path.join(dir, 'zwei.json'), { a: 1 });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'zwei.json'), 'utf8')), { a: 1 });
  // keine .tmp-Leichen
  assert.deepEqual(fs.readdirSync(dir).filter(f => f.includes('.tmp.')), []);
  // dirFsyncFailures wird hier bewusst NICHT gepinnt: ob ein Verzeichnis-fsync
  // durchgeht, ist eine Eigenschaft des Dateisystems (Windows kennt ihn gar nicht,
  // exotische Mounts koennen ihn verweigern) — nicht des Normalfalls. Dass er zaehlt,
  // beweist der Drossel-Test unten per Delta.
  assert.equal(atomicWriteStats.renameRetries, vorher.renameRetries);
  assert.equal(atomicWriteStats.tmpCleanupFailures, vorher.tmpCleanupFailures);
});

// Wer den Export entfernt, faellt hier auf die Nase (Ausbau-Probe).
test('Zaehler sind exportiert und numerisch', () => {
  assert.equal(typeof atomicWriteStats, 'object');
  for (const k of ['dirFsyncFailures', 'renameRetries', 'tmpCleanupFailures']) {
    assert.equal(typeof atomicWriteStats[k], 'number', k + ' fehlt im Export');
  }
});

// --- (b) Drossel-/Schluck-Fall: zaehlt sichtbar hoch, wirft weiterhin NICHT.
// Der geschluckte Pfad ist plattformabhaengig: POSIX = Verzeichnis-fsync,
// Windows = Rename-Drossel (dort ist der Verzeichnis-fsync gar nicht erst aktiv).
if (IS_WINDOWS) {
  test('Windows-Rename-Drossel zaehlt jeden Wiederholversuch', () => {
    const vorher = snapshot();
    const p = path.join(tmp(), 'gedrosselt.json');
    const echt = fs.renameSync;
    let versuche = 0;
    fs.renameSync = function (a, b) {
      if (++versuche <= 3) { const e = new Error('locked'); e.code = 'EPERM'; throw e; }
      return echt.call(fs, a, b);
    };
    try { writeFileAtomic(p, 'inhalt'); } finally { fs.renameSync = echt; }
    assert.equal(fs.readFileSync(p, 'utf8'), 'inhalt', 'Schreiben gelingt trotz Drossel');
    assert.equal(atomicWriteStats.renameRetries - vorher.renameRetries, 3,
      'drei geschluckte Wiederholversuche muessen sichtbar sein');
  });
} else {
  test('geschluckter Verzeichnis-fsync zaehlt hoch statt still zu bleiben', () => {
    const vorher = snapshot();
    const dir = tmp();
    const p = path.join(dir, 'gefsynct.json');
    const echt = fs.openSync;
    fs.openSync = function (ziel, flags) {
      if (path.resolve(String(ziel)) === path.resolve(dir)) {
        const e = new Error('kein Verzeichnis-Handle'); e.code = 'EACCES'; throw e;
      }
      return echt.call(fs, ziel, flags);
    };
    try { writeFileAtomic(p, 'inhalt'); } finally { fs.openSync = echt; }
    assert.equal(fs.readFileSync(p, 'utf8'), 'inhalt', 'Aufrufer sieht weiterhin Erfolg');
    assert.equal(atomicWriteStats.dirFsyncFailures - vorher.dirFsyncFailures, 1);
    assert.match(String(atomicWriteStats.lastDirFsyncError), /kein Verzeichnis-Handle/);
  });
}

// --- S54: remaining contracts after tests/cov-io-naehte.test.js (S12).
// S12 already covers Uint8Array, a replacer producing NaN, and Windows retry
// recovery/exhaustion. Keep those assertions there rather than duplicating them.
test('nested non-finite values identify their key without creating any file', () => {
  for (const value of [NaN, -Infinity]) {
    const dir = tmp();
    const p = path.join(dir, 'invalid.json');
    const vorher = snapshot();
    assert.throws(() => writeJsonAtomic(p, { metrics: { ratio: value } }), (error) => {
      assert.match(error.message, /non-finite/);
      assert.match(error.message, /at key "ratio"/);
      return true;
    });
    assert.equal(fs.existsSync(p), false);
    assert.deepEqual(fs.readdirSync(dir), [], 'validation must precede temporary-file creation');
    assert.deepEqual(snapshot(), vorher);
  }
});

test('a caller replacer can deliberately map NaN to JSON null', () => {
  const dir = tmp();
  const p = path.join(dir, 'null.json');
  let replacements = 0;
  writeJsonAtomic(p, { metrics: { ratio: NaN }, stable: 7 }, {
    replacer: (key, value) => {
      if (Number.isNaN(value)) { replacements++; return null; }
      return value;
    },
  });
  assert.equal(replacements, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(p, 'utf8')), { metrics: { ratio: null }, stable: 7 });
  assert.deepEqual(fs.readdirSync(dir), ['null.json']);
});

test('assertFinite false still applies the caller replacer before JSON conversion', () => {
  const p = path.join(tmp(), 'opt-out.json');
  const visited = [];
  writeJsonAtomic(p, { ratio: 1, stable: 7 }, {
    assertFinite: false,
    replacer: (key, value) => {
      visited.push(key);
      return key === 'ratio' ? NaN : value;
    },
  });
  assert.deepEqual(visited, ['', 'ratio', 'stable']);
  assert.deepEqual(JSON.parse(fs.readFileSync(p, 'utf8')), { ratio: null, stable: 7 });
});

test('JSON indentation preserves explicit zero, four spaces and the two-space default', () => {
  const dir = tmp();
  const p = path.join(dir, 'indent.json');
  const cases = [
    [{ indent: 0 }, '{"a":{"b":1}}'],
    [{ indent: 4 }, '{\n    "a": {\n        "b": 1\n    }\n}'],
    [undefined, '{\n  "a": {\n    "b": 1\n  }\n}'],
  ];
  for (const [options, expected] of cases) {
    writeJsonAtomic(p, { a: { b: 1 } }, options);
    assert.equal(fs.readFileSync(p, 'utf8'), expected);
  }
  assert.deepEqual(fs.readdirSync(dir), ['indent.json']);
});

test('Buffer writes preserve zero, high-bit and non-UTF8 bytes', () => {
  const dir = tmp();
  const p = path.join(dir, 'bytes.bin');
  const bytes = Buffer.from([0x00, 0x7f, 0xff]);
  writeFileAtomic(p, bytes);
  assert.deepEqual(fs.readFileSync(p), bytes);
  assert.equal(fs.statSync(p).size, 3);
  assert.deepEqual(fs.readdirSync(dir), ['bytes.bin']);
});

test('a string encoding option writes latin1 without UTF8 expansion', () => {
  const p = path.join(tmp(), 'string-encoding.bin');
  writeFileAtomic(p, '\u00e4', 'latin1');
  assert.deepEqual(fs.readFileSync(p), Buffer.from([0xe4]));
});

test('an object encoding option writes latin1 without UTF8 expansion', () => {
  const p = path.join(tmp(), 'object-encoding.bin');
  writeFileAtomic(p, '\u00e4', { encoding: 'latin1' });
  assert.deepEqual(fs.readFileSync(p), Buffer.from([0xe4]));
});

test('EXDEV is terminal, preserves old bytes and rethrows the original error', () => {
  const dir = tmp();
  const p = path.join(dir, 'state.txt');
  fs.writeFileSync(p, 'ALT');
  const vorher = snapshot();
  const failure = Object.assign(new Error('cross-device rename'), { code: 'EXDEV' });
  const echt = fs.renameSync;
  let calls = 0;
  fs.renameSync = (source, target) => {
    calls++;
    assert.equal(target, p);
    assert.equal(path.dirname(source), dir);
    throw failure;
  };
  try { assert.throws(() => writeFileAtomic(p, 'NEU'), error => error === failure); }
  finally { fs.renameSync = echt; }
  assert.equal(calls, 1);
  assert.equal(fs.readFileSync(p, 'utf8'), 'ALT');
  assert.deepEqual(fs.readdirSync(dir), ['state.txt']);
  assert.deepEqual(snapshot(), vorher, 'a terminal rename error neither retries nor fails cleanup');
});

test('file fsync failure preserves the old target and its error identity', () => {
  const dir = tmp();
  const p = path.join(dir, 'state.txt');
  fs.writeFileSync(p, 'ALT');
  const vorher = snapshot();
  const failure = Object.assign(new Error('file fsync failed'), { code: 'EIO' });
  const echt = fs.fsyncSync;
  let calls = 0;
  fs.fsyncSync = () => { calls++; throw failure; };
  try { assert.throws(() => writeFileAtomic(p, 'NEU'), error => error === failure); }
  finally { fs.fsyncSync = echt; }
  assert.equal(calls, 1, 'failure happens on the file before directory fsync');
  assert.equal(fs.readFileSync(p, 'utf8'), 'ALT');
  assert.deepEqual(fs.readdirSync(dir), ['state.txt']);
  assert.deepEqual(snapshot(), vorher);
});

test('failed cleanup increments its counter while preserving the rename error', () => {
  const dir = tmp();
  const p = path.join(dir, 'state.txt');
  fs.writeFileSync(p, 'ALT');
  const vorher = snapshot();
  const failure = Object.assign(new Error('original rename error'), { code: 'EXDEV' });
  const cleanupFailure = Object.assign(new Error('cleanup access denied'), { code: 'EACCES' });
  const echtRename = fs.renameSync, echtUnlink = fs.unlinkSync;
  let temporary;
  fs.renameSync = (source) => { temporary = source; throw failure; };
  fs.unlinkSync = (file) => { assert.equal(file, temporary); throw cleanupFailure; };
  try { assert.throws(() => writeFileAtomic(p, 'NEU'), error => error === failure); }
  finally { fs.renameSync = echtRename; fs.unlinkSync = echtUnlink; }
  assert.equal(atomicWriteStats.tmpCleanupFailures - vorher.tmpCleanupFailures, 1);
  assert.equal(atomicWriteStats.renameRetries, vorher.renameRetries);
  assert.equal(fs.readFileSync(p, 'utf8'), 'ALT');
  assert.equal(fs.readFileSync(temporary, 'utf8'), 'NEU', 'the failed cleanup really left the owned temporary file');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['state.txt', path.basename(temporary)].sort());
  // The normal tmpDirs cleanup below removes this deliberately retained fixture.
});

test('ENOENT during cleanup means already absent and does not count as failure', () => {
  const dir = tmp();
  const p = path.join(dir, 'state.txt');
  fs.writeFileSync(p, 'ALT');
  const vorher = snapshot();
  const failure = Object.assign(new Error('original rename error'), { code: 'EXDEV' });
  const echtRename = fs.renameSync, echtUnlink = fs.unlinkSync;
  let cleanupCalls = 0;
  fs.renameSync = () => { throw failure; };
  fs.unlinkSync = (file) => {
    cleanupCalls++;
    echtUnlink.call(fs, file); // Model a concurrent removal before the ENOENT result.
    throw Object.assign(new Error('already gone'), { code: 'ENOENT' });
  };
  try { assert.throws(() => writeFileAtomic(p, 'NEU'), error => error === failure); }
  finally { fs.renameSync = echtRename; fs.unlinkSync = echtUnlink; }
  assert.equal(cleanupCalls, 1);
  assert.equal(fs.readFileSync(p, 'utf8'), 'ALT');
  assert.deepEqual(fs.readdirSync(dir), ['state.txt']);
  assert.deepEqual(snapshot(), vorher);
});

test('partial writes advance until all 100 distinct bytes reach disk', () => {
  const dir = tmp();
  const p = path.join(dir, 'partial.bin');
  const bytes = Buffer.from(Array.from({ length: 100 }, (_, index) => index));
  const echt = fs.writeSync;
  const writes = [];
  fs.writeSync = (fd, buffer, offset, length, position) => {
    const written = echt.call(fs, fd, buffer, offset, Math.min(length, 3), position);
    writes.push(written);
    return written;
  };
  try { writeFileAtomic(p, bytes); }
  finally { fs.writeSync = echt; }
  assert.deepEqual(writes, [...Array(33).fill(3), 1]);
  assert.deepEqual(fs.readFileSync(p), bytes);
  assert.deepEqual(fs.readdirSync(dir), ['partial.bin']);
});

test('a zero-length write fails loudly and preserves the old target', () => {
  const dir = tmp();
  const p = path.join(dir, 'state.txt');
  fs.writeFileSync(p, 'ALT');
  const vorher = snapshot();
  const echt = fs.writeSync;
  let calls = 0;
  fs.writeSync = () => { calls++; return 0; };
  try { assert.throws(() => writeFileAtomic(p, 'NEU'), /writeSync returned 0 before EOF/); }
  finally { fs.writeSync = echt; }
  assert.equal(calls, 1);
  assert.equal(fs.readFileSync(p, 'utf8'), 'ALT');
  assert.deepEqual(fs.readdirSync(dir), ['state.txt']);
  assert.deepEqual(snapshot(), vorher);
});

test('a missing parent directory propagates ENOENT without cleanup failures', () => {
  const dir = tmp();
  const p = path.join(dir, 'missing', 'state.txt');
  const vorher = snapshot();
  assert.throws(() => writeFileAtomic(p, 'NEU'), error => error.code === 'ENOENT');
  assert.equal(fs.existsSync(p), false);
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.deepEqual(snapshot(), vorher);
});

test('successive replacements use distinct sibling temporary paths', () => {
  const dir = tmp();
  const p = path.join(dir, 'state.txt');
  const echt = fs.renameSync;
  const sources = [];
  fs.renameSync = (source, target) => {
    sources.push(source);
    assert.equal(target, p);
    return echt.call(fs, source, target);
  };
  try {
    writeFileAtomic(p, 'FIRST');
    assert.equal(fs.readFileSync(p, 'utf8'), 'FIRST');
    writeFileAtomic(p, 'SECOND');
  } finally { fs.renameSync = echt; }
  assert.equal(sources.length, 2);
  assert.notEqual(sources[0], sources[1]);
  for (const source of sources) {
    assert.equal(path.dirname(source), dir);
    assert.match(source, /\.tmp\.\d+\.\d+$/);
    assert.equal(fs.existsSync(source), false);
  }
  assert.equal(fs.readFileSync(p, 'utf8'), 'SECOND');
  assert.deepEqual(fs.readdirSync(dir), ['state.txt']);
});

if (!IS_WINDOWS) {
  test('POSIX EPERM propagates immediately without Windows retry policy', () => {
    const dir = tmp();
    const p = path.join(dir, 'state.txt');
    fs.writeFileSync(p, 'ALT');
    const vorher = snapshot();
    const failure = Object.assign(new Error('POSIX rename denied'), { code: 'EPERM' });
    const echt = fs.renameSync;
    let calls = 0;
    fs.renameSync = () => { calls++; throw failure; };
    try { assert.throws(() => writeFileAtomic(p, 'NEU'), error => error === failure); }
    finally { fs.renameSync = echt; }
    assert.equal(calls, 1);
    assert.equal(atomicWriteStats.renameRetries, vorher.renameRetries);
    assert.equal(fs.readFileSync(p, 'utf8'), 'ALT');
    assert.deepEqual(fs.readdirSync(dir), ['state.txt']);
    assert.deepEqual(snapshot(), vorher);
  });
}


for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} }
console.log(`\natomic-write.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
