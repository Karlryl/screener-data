'use strict';
/**
 * T204 Welle 4 — Waechter fuer die beiden in dieser Welle atomar gemachten Schreibstellen.
 *
 * WARUM NICHT PER QUELLTEXT-REGEX: F-CGPT-060 hat genau das schon einmal widerlegt (siehe
 * tests/merge-shard-manifests-atomic.test.js) — ein toter writeFileAtomic-Aufruf in einem
 * if(false) haelt jede Textpruefung gruen, waehrend der echte Writer wieder zerreisst.
 * Deshalb wird hier der ECHTE Prozess mitten im Ziel-Write abgebrochen und geprueft, was
 * danach auf Platte liegt. Der Waechter nagelt die SACHE fest, nicht das Schreibmuster.
 *
 * Gepinnt werden drei Dinge:
 *   1. scripts/coverage-gate.js   — ein gescheiterter Marker-Write darf den GUELTIGEN
 *      Altmarker nicht zerstoeren. coverage-status.json ist Karls einziger Alarmkanal;
 *      der Write-Fehler wird dort BEWUSST geschluckt (::warning::, kein Abbruch), also ist
 *      ein zerrissener Marker doppelt gefaehrlich: er liest sich plausibel und ist falsch.
 *      Zusaetzlich gepinnt: der geworfene Write taucht weiterhin als ::warning:: auf.
 *   2. scripts/write-newcomer-log.js — ein Abbruch darf keine .tmp-Leiche hinterlassen.
 *   3. scripts/write-newcomer-log.js — der tmp-Name muss je Lauf EINDEUTIG sein. Vorher
 *      war er fest (<datei>.tmp); zwei parallele Laeufe teilten sich dieselbe tmp-Datei,
 *      ueberschrieben sie gegenseitig mitten im Schreiben und benannten beide dasselbe
 *      Bruchstueck ins Ziel um.
 *
 * Standalone-Runner, kein Netz. Run: node tests/t204-wave4-atomic-write.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.join(__dirname, '..');
const COVERAGE_GATE = path.join(REPO, 'scripts', 'coverage-gate.js');
const NEWCOMER_LOG = path.join(REPO, 'scripts', 'write-newcomer-log.js');

let pass = 0, fail = 0;
const tmpDirs = [];
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.stack); }
}
function scratch(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

// Abbruch-Simulation: jeder Write, der auf den Zielnamen zeigt (per fd ODER per Pfad),
// schreibt ein Bruchstueck und wirft dann. Ein atomarer Writer trifft damit nur seine
// Temp-Datei; ein nacktes writeFileSync zerstoert das Ziel selbst.
function abbruchPatch(treffer) {
  return `
const fs = require('fs');
const zielFds = new Set();
const trifft = (p) => String(p).includes(${JSON.stringify(treffer)});
const echtOpen = fs.openSync, echtWrite = fs.writeSync, echtWriteFile = fs.writeFileSync;
fs.openSync = function (p, ...r) {
  const fd = echtOpen.call(fs, p, ...r);
  if (trifft(p)) zielFds.add(fd);
  return fd;
};
fs.writeSync = function (fd, buf, off, len, pos) {
  if (!zielFds.has(fd)) return echtWrite.call(fs, fd, buf, off, len, pos);
  echtWrite.call(fs, fd, buf, off || 0, Math.min(8, len == null ? 8 : len), pos);
  throw new Error('simulierter Abbruch mitten im Write');
};
fs.writeFileSync = function (p, data, o) {
  if (!trifft(p)) return echtWriteFile.call(fs, p, data, o);
  echtWriteFile.call(fs, p, String(data).slice(0, 8), o);
  throw new Error('simulierter Abbruch mitten im Write');
};
`;
}

// Aufzeichner: haelt jeden beruehrten tmp-Pfad fest, ohne den Lauf zu stoeren.
const AUFZEICHNER = `
const fs = require('fs');
const REC = process.env.T204_TMP_REC;
const echtOpen = fs.openSync, echtWriteFile = fs.writeFileSync;
const merke = (p) => { if (String(p).includes('.jsonl.tmp')) fs.appendFileSync(REC, String(p) + '\\n'); };
fs.openSync = function (p, ...r) { merke(p); return echtOpen.call(fs, p, ...r); };
fs.writeFileSync = function (p, d, o) { merke(p); return echtWriteFile.call(fs, p, d, o); };
`;

function lauf(skript, args, opts) {
  const o = opts || {};
  const argv = [];
  if (o.vorlade) argv.push('--require', o.vorlade);
  argv.push(skript, ...args);
  return spawnSync(process.execPath, argv, {
    cwd: o.cwd || REPO, encoding: 'utf8', timeout: 120000,
    env: Object.assign({}, process.env, o.env || {}),
  });
}

// ---------------------------------------------------------------- coverage-gate.js

const ALTMARKER = {
  schema: 'coverage-status/v1', status: 'ok', degraded: false, blocked: false,
  n_ok: 4711, n_total: 4711, coverage_pct: 100, reasons: [], _quelle: 'gueltiger Altstand',
};

// Leeres cwd: ohne ./snapshots klassifiziert der Gate als 'katastrophal' und endet mit
// exit 1 — in BEIDEN Zweigen. Der Exit-Code ist hier also kein Signal; gemessen wird,
// was der Marker-Write auf Platte hinterlaesst.
function coverageFixture() {
  const dir = scratch('t204w4-coverage-');
  fs.mkdirSync(path.join(dir, 'outputs'));
  fs.writeFileSync(path.join(dir, 'outputs', 'coverage-status.json'), JSON.stringify(ALTMARKER));
  return dir;
}

test('coverage-gate: normaler Lauf schreibt einen gueltigen Marker', () => {
  const dir = coverageFixture();
  lauf(COVERAGE_GATE, [], { cwd: dir });
  const mk = JSON.parse(fs.readFileSync(path.join(dir, 'outputs', 'coverage-status.json'), 'utf8'));
  assert.equal(mk.schema, 'coverage-status/v1');
  assert.equal(mk._quelle, undefined, 'der Altmarker muss ersetzt worden sein');
  assert.equal(typeof mk.degraded, 'boolean');
});

test('coverage-gate: Abbruch im Marker-Write laesst den gueltigen Altmarker UNVERSEHRT', () => {
  const dir = coverageFixture();
  const patch = path.join(dir, 'abbruch.js');
  fs.writeFileSync(patch, abbruchPatch('coverage-status.json'));
  const p = lauf(COVERAGE_GATE, [], { cwd: dir, vorlade: patch });

  const roh = fs.readFileSync(path.join(dir, 'outputs', 'coverage-status.json'), 'utf8');
  assert.deepEqual(JSON.parse(roh), ALTMARKER,
    'auf Platte muss der vollstaendige Altstand stehen, nie ein Bruchstueck');
  const reste = fs.readdirSync(path.join(dir, 'outputs')).filter((f) => f.includes('coverage-status.json.tmp'));
  assert.deepEqual(reste, [], 'die Temp-Datei des abgebrochenen Writes muss aufgeraeumt sein');
  // Schluck-Semantik BEWUSST unveraendert: der Fehler bleibt ein ::warning::, kein Abbruch.
  assert.match(p.stderr, /::warning::could not write \.\/outputs\/coverage-status\.json/,
    'der geworfene Write muss weiterhin als ::warning:: sichtbar werden');
});

// ---------------------------------------------------------- write-newcomer-log.js

const ALTZEILE = {
  date: '2026-09-01', board: 'hypergrowth-overview', prior: null, n: 2,
  erstaufnahme: true, newcomers: [], departures: [], members: ['A', 'B'],
};

function newcomerFixture() {
  const dir = scratch('t204w4-newcomer-');
  const logDir = path.join(dir, 'newcomer-log');
  fs.mkdirSync(logDir);
  fs.writeFileSync(path.join(logDir, '2026-09.jsonl'), JSON.stringify(ALTZEILE) + '\n', 'utf8');
  const overview = path.join(dir, 'overview.json');
  fs.writeFileSync(overview, JSON.stringify({ rows: [{ ticker: 'B' }, { ticker: 'C' }] }), 'utf8');
  return { dir, logDir, overview, monat: path.join(logDir, '2026-09.jsonl') };
}
const NEWCOMER_ARGS = (f, datum) => ['--overview', f.overview, '--log-dir', f.logDir, '--date', datum];

test('newcomer-log: normaler Lauf haengt die Tageszeile an', () => {
  const f = newcomerFixture();
  const p = lauf(NEWCOMER_LOG, NEWCOMER_ARGS(f, '2026-09-02'));
  assert.equal(p.status, 0, 'Lauf muss gruen sein\n' + p.stdout + p.stderr);
  const zeilen = fs.readFileSync(f.monat, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(zeilen.length, 2, 'Altzeile plus die neue Tageszeile');
  assert.deepEqual(zeilen[1].members, ['B', 'C']);
  assert.deepEqual(zeilen[1].newcomers, ['C']);
  assert.deepEqual(zeilen[1].departures, ['A']);
});

test('newcomer-log: Abbruch laesst die Altdatei intakt UND keine .tmp-Leiche zurueck', () => {
  const f = newcomerFixture();
  const patch = path.join(f.dir, 'abbruch.js');
  fs.writeFileSync(patch, abbruchPatch('.jsonl'));
  const p = lauf(NEWCOMER_LOG, NEWCOMER_ARGS(f, '2026-09-02'), { vorlade: patch });

  assert.notEqual(p.status, 0, 'ein gescheiterter Log-Write muss den Schritt ROT machen');
  const zeilen = fs.readFileSync(f.monat, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(zeilen, [ALTZEILE], 'die Altzeile muss vollstaendig auf Platte bleiben');
  // Der handgebaute tmp+rename raeumte NICHT auf: <datei>.tmp blieb als Bruchstueck liegen
  // und wurde von bisherigeZeilen() zwar ignoriert, sammelte sich aber im Log-Verzeichnis.
  const reste = fs.readdirSync(f.logDir).filter((n) => n.includes('.jsonl.tmp'));
  assert.deepEqual(reste, [], 'die Temp-Datei des abgebrochenen Writes muss aufgeraeumt sein');
});

test('newcomer-log: der tmp-Name ist je Lauf eindeutig (Parallellauf-Falle geschlossen)', () => {
  const beobachtet = [];
  for (const datum of ['2026-09-02', '2026-09-03']) {
    const f = newcomerFixture();
    const patch = path.join(f.dir, 'aufzeichner.js');
    fs.writeFileSync(patch, AUFZEICHNER);
    const rec = path.join(f.dir, 'tmp-pfade.txt');
    fs.writeFileSync(rec, '');
    const p = lauf(NEWCOMER_LOG, NEWCOMER_ARGS(f, datum), { vorlade: patch, env: { T204_TMP_REC: rec } });
    assert.equal(p.status, 0, 'Lauf muss gruen sein\n' + p.stdout + p.stderr);
    const pfade = fs.readFileSync(rec, 'utf8').trim().split(/\r?\n/).filter(Boolean);
    assert.ok(pfade.length > 0, 'es muss ueberhaupt ueber eine tmp-Datei geschrieben werden');
    const tmp = path.basename(pfade[0]);
    assert.notEqual(tmp, '2026-09.jsonl.tmp',
      'ein FESTER tmp-Name waere die Parallellauf-Falle, die diese Welle schliesst');
    assert.match(tmp, /^2026-09\.jsonl\.tmp\.\d+\.\d+$/, 'tmp-Name traegt pid und Zaehler');
    beobachtet.push(tmp);
  }
  assert.notEqual(beobachtet[0], beobachtet[1],
    'zwei getrennte Laeufe duerfen sich NIE dieselbe tmp-Datei teilen');
});

for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} }
console.log(`\nt204-wave4-atomic-write.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
