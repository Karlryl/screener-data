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

for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} }
console.log(`\natomic-write.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
