'use strict';
/**
 * NRE-SK-001 (Hard Review 2026-07-31) / F-CGPT-060 (Sweep 8433206, 2026-08-05):
 * snapshots/_manifest.json ist die Datei, aus der coverage-gate.js Karls einzigen
 * Coverage-Alarm zieht. Ein abgebrochener Schritt (Timeout, OOM, Runner-Eviction) darf
 * dort NIE eine halbgeschriebene Datei hinterlassen — coverage-gate.js liest die dann als
 * "unlesbar" und faellt auf eine strikt schwaechere Datei-Zaehl-Klassifikation zurueck.
 *
 * WARUM DIESE DATEI NEU GESCHRIEBEN WURDE (P0-Haertung 2026-08-09):
 * die alte Fassung pruefte per Regex, ob der String `writeFileAtomic(...)` im Quelltext
 * steht. F-CGPT-060 hat sie widerlegt, indem der Writer auf `fs.writeFileSync` umgebaut und
 * der tote `writeFileAtomic`-Aufruf in einem `if(false)` stehen gelassen wurde: der Test
 * blieb gruen, waehrend ein Abbruch das gueltige Alt-Manifest zerstoerte. Ein Waechter
 * muss die SACHE festnageln, nicht das Schreibmuster — also wird hier der echte Prozess
 * mitten im Manifest-Write abgebrochen und geprueft, was auf Platte steht.
 *
 * Standalone-Runner, kein Netz. Run: node tests/merge-shard-manifests-atomic.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SKRIPT = path.join(__dirname, '..', 'scripts', 'merge-shard-manifests.js');
let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.stack); }
}

const ALT = { n_ok: 4711, n_total: 4711, partial: false, n_eingang_snapshots: 4711, _quelle: 'gueltiger Altstand' };

// Fixture: 2 Snapshots on disk, 1 Shard-Manifest, gueltiges Alt-Manifest.
function baueFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-atomic-'));
  fs.mkdirSync(path.join(dir, 'snapshots'));
  fs.mkdirSync(path.join(dir, 'shard-manifests'));
  for (const t of ['A', 'B']) fs.writeFileSync(path.join(dir, 'snapshots', t + '.json'), '{"meta":{"ticker":"' + t + '"}}');
  fs.writeFileSync(path.join(dir, 'snapshots', '_manifest.json'), JSON.stringify(ALT));
  fs.writeFileSync(path.join(dir, 'shard-manifests', 'shard-0.json'), JSON.stringify({
    n_ok: 2, n_full: 2, n_priceonly: 0, n_failed: 0, n_skipped_mcap: 0, n_skipped_owned: 0, partial: false,
  }));
  fs.writeFileSync(path.join(dir, 'watchlist.json'), JSON.stringify({ stocks: [{ ticker: 'A' }, { ticker: 'B' }] }));
  return dir;
}

function merge(dir, vorlade) {
  const args = [];
  if (vorlade) args.push('--require', vorlade);
  args.push(SKRIPT, '--shard-manifests', 'shard-manifests', '--snapshots', 'snapshots',
    '--watchlist', 'watchlist.json', '--expected-shards', '1');
  return spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf8', timeout: 60000 });
}

// Abbruch-Simulation: jeder Write, der auf _manifest.json zielt (per fd ODER per Pfad),
// schreibt nur ein Bruchstueck und wirft dann. Ein atomarer Writer trifft damit nur seine
// Temp-Datei; ein plain writeFileSync wuerde das Ziel selbst zerstoeren.
const PATCH = `
const fs = require('fs');
const zielFds = new Set();
const echtOpen = fs.openSync, echtWrite = fs.writeSync, echtWriteFile = fs.writeFileSync;
fs.openSync = function (p, ...r) {
  const fd = echtOpen.call(fs, p, ...r);
  if (String(p).includes('_manifest.json')) zielFds.add(fd);
  return fd;
};
fs.writeSync = function (fd, buf, off, len, pos) {
  if (!zielFds.has(fd)) return echtWrite.call(fs, fd, buf, off, len, pos);
  echtWrite.call(fs, fd, buf, off || 0, Math.min(8, len == null ? 8 : len), pos);
  throw new Error('simulierter Abbruch mitten im Manifest-Write');
};
fs.writeFileSync = function (p, data, o) {
  if (!String(p).includes('_manifest.json')) return echtWriteFile.call(fs, p, data, o);
  echtWriteFile.call(fs, p, String(data).slice(0, 8), o);
  throw new Error('simulierter Abbruch mitten im Manifest-Write');
};
`;

test('normaler Lauf schreibt das gemergte Manifest', () => {
  const dir = baueFixture();
  const p = merge(dir);
  assert.equal(p.status, 0, 'Lauf muss gruen sein\n' + p.stdout + p.stderr);
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'snapshots', '_manifest.json'), 'utf8'));
  assert.equal(m.n_ok, 2);
  assert.equal(m.n_total, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Abbruch mitten im Write laesst das gueltige Alt-Manifest UNVERSEHRT (kein Teilstand auf Platte)', () => {
  const dir = baueFixture();
  const patchPfad = path.join(dir, 'abbruch.js');
  fs.writeFileSync(patchPfad, PATCH);
  const p = merge(dir, patchPfad);
  assert.notEqual(p.status, 0, 'ein gescheiterter Manifest-Write muss den Schritt ROT machen');
  const roh = fs.readFileSync(path.join(dir, 'snapshots', '_manifest.json'), 'utf8');
  assert.deepEqual(JSON.parse(roh), ALT, 'auf Platte muss der vollstaendige Altstand stehen, nie ein Bruchstueck');
  const reste = fs.readdirSync(path.join(dir, 'snapshots')).filter((f) => f.includes('_manifest.json.tmp'));
  assert.deepEqual(reste, [], 'die Temp-Datei des abgebrochenen Writes muss aufgeraeumt sein');
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log(`\nmerge-shard-manifests-atomic.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
