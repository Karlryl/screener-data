'use strict';
/**
 * P0-Haertung 1 (2026-08-09) — EINE Bugklasse, vier Fundstellen:
 * "korrupte/fehlende Pflichtdatei -> wird als Erstanlage behandelt -> Teilstand
 *  ueberschreibt gueltigen Altbestand -> Exit 0" (stille Datenkorruption).
 *
 *   F-CGPT-005  pull-yahoo.js          fehlgeschlagenes Loeschen des alten _manifest.json
 *                                      war nur WARN -> Lauf laeuft weiter, bricht ab,
 *                                      Altmanifest gilt nachgelagert als frisch
 *   F-CGPT-007  lib/e1-compression.js  kaputte Zustandsdatei -> Neuanlage -> Historie weg
 *   F-CGPT-008  lib/price-history-store.js  kaputte _meta.json -> Shard-Vollstaendigkeits-
 *                                      kontrolle abgeschaltet -> Teil-Store gilt als geladen
 *   F-CGPT-019  scripts/fetch-secbulk.js  rename trotz "unlesbar: n" -> Teilstand ersetzt
 *                                      den SEC-Bulk-Altbestand
 *
 * Jeder Test prueft das VERHALTEN (Schaden nachgestellt), nicht die Schreibweise, und in
 * jedem Fall zusaetzlich die Gegenrichtung: "Datei fehlt" muss weiterhin als legitime
 * Erstanlage durchgehen. Standalone-Runner, kein Netz.
 * Run: node tests/p0-failloud-erstanlage.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.stack); }
}
const tmpDirs = [];
function tmp(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

// ── F-CGPT-008 ───────────────────────────────────────────────────────────────
const store = require(path.join(ROOT, 'lib', 'price-history-store.js'));

function bauePreisStore(dir, tickers) {
  const n = store.shardOf(tickers[0]);
  fs.mkdirSync(path.dirname(store.shardPath(dir, n)), { recursive: true });
  const obj = {};
  for (const t of tickers) obj[t] = [{ date: '2026-08-01', close: 1 }];
  fs.writeFileSync(store.shardPath(dir, n), JSON.stringify(obj));
  return n;
}

test('F-CGPT-008: korrupte _meta.json schaltet die Shard-Vollstaendigkeitskontrolle NICHT ab', () => {
  const dir = tmp('p0-phs-');
  bauePreisStore(dir, ['A']);              // 1 von 32 Shards vorhanden
  fs.writeFileSync(store.metaPath(dir), '{"schema":"price-history');   // abgeschnitten
  assert.throws(() => store.loadAll(dir), /unlesbar|refusing to load/,
    'ein Teil-Store mit kaputtem Stempel muss laut scheitern, nicht als vollstaendig gelten');
});

test('F-CGPT-008 Gegenrichtung: FEHLENDE _meta.json bleibt legitimer Bootstrap', () => {
  const dir = tmp('p0-phs-');
  bauePreisStore(dir, ['A']);
  assert.equal(store.loadMeta(dir), null, 'fehlender Stempel -> null, kein Wurf');
  assert.deepEqual(Object.keys(store.loadAll(dir)), ['A'], 'ohne Stempel laedt der Store wie bisher');
});

// ── F-CGPT-007 ───────────────────────────────────────────────────────────────
const { runE1 } = require(path.join(ROOT, 'lib', 'e1-compression.js'));

test('F-CGPT-007: kaputte E1-Zustandsdatei wird nicht als Neuanlage ueberschrieben', () => {
  const base = tmp('p0-e1-');
  const statePath = path.join(base, 'state', 'e1-alert-state.json');
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const kaputt = '{"eigenHistorieStartDate":"2026-07-17","tickers":{"AAA":{"lastAlertDa';
  fs.writeFileSync(statePath, kaputt);
  assert.throws(
    () => runE1({ baseDir: base, date: '2026-08-09', statePath, outPath: path.join(base, 'outputs', 'e1.json') }),
    /unlesbar|refusing to overwrite/,
  );
  assert.equal(fs.readFileSync(statePath, 'utf8'), kaputt,
    'der Altbestand muss byte-identisch stehen bleiben (sonst ist die Historie weg)');
});

test('F-CGPT-007 Gegenrichtung: FEHLENDE Zustandsdatei ist eine echte Erstanlage', () => {
  const base = tmp('p0-e1-');
  const statePath = path.join(base, 'state', 'e1-alert-state.json');
  const res = runE1({ baseDir: base, date: '2026-08-09', statePath, outPath: path.join(base, 'outputs', 'e1.json') });
  assert.equal(res.alerts.length, 0);
  assert.ok(fs.existsSync(statePath), 'Erstanlage schreibt den frischen Zustand');
});

// ── F-CGPT-019 ───────────────────────────────────────────────────────────────
const { veroeffentliche } = require(path.join(ROOT, 'scripts', 'fetch-secbulk.js'));

test('F-CGPT-019: unvollstaendiger SEC-Bulk ersetzt den Altbestand nicht', () => {
  const dir = tmp('p0-sec-');
  const out = path.join(dir, 'sec-annual-bulk.jsonl');
  const alt = '{"ticker":"OLD"}\n{"ticker":"OLD2"}\n';
  fs.writeFileSync(out, alt);
  fs.writeFileSync(out + '.tmp', '{"ticker":"B"}\n');
  assert.throws(() => veroeffentliche(out + '.tmp', out, 1, 1), /unvollstaendig/);
  assert.equal(fs.readFileSync(out, 'utf8'), alt, 'Altbestand unveraendert');
  assert.equal(fs.existsSync(out + '.tmp'), false, 'der Teilstand ist weg, nicht als Ruine liegengeblieben');
});

test('F-CGPT-019: auch ein LEERER Lauf (0 Zeilen, 0 unlesbar) ueberschreibt nicht', () => {
  const dir = tmp('p0-sec-');
  const out = path.join(dir, 'sec-annual-bulk.jsonl');
  fs.writeFileSync(out, '{"ticker":"OLD"}\n');
  fs.writeFileSync(out + '.tmp', '');
  assert.throws(() => veroeffentliche(out + '.tmp', out, 0, 0), /unvollstaendig/);
  assert.equal(fs.readFileSync(out, 'utf8'), '{"ticker":"OLD"}\n');
});

test('F-CGPT-019 Gegenrichtung: der vollstaendige Lauf veroeffentlicht wie bisher', () => {
  const dir = tmp('p0-sec-');
  const out = path.join(dir, 'sec-annual-bulk.jsonl');
  fs.writeFileSync(out, '{"ticker":"OLD"}\n');
  fs.writeFileSync(out + '.tmp', '{"ticker":"NEU"}\n');
  veroeffentliche(out + '.tmp', out, 1, 0);
  assert.equal(fs.readFileSync(out, 'utf8'), '{"ticker":"NEU"}\n');
  assert.equal(fs.existsSync(out + '.tmp'), false);
});

// ── F-CGPT-005 ───────────────────────────────────────────────────────────────
// Echter Kindprozess-Lauf von pull-yahoo.js. Das _manifest.json im Ausgabeordner ist ein
// VERZEICHNIS -> unlinkSync scheitert (EPERM/EISDIR, beide Plattformen). Der Beweis ist
// nicht die Fehlermeldung, sondern dass der Pull danach GAR NICHT ERST ANLAEUFT: vorher
// stand hier nur ein WARN und der Lauf zog weiter, mit dem alten Erfolgsmanifest auf Platte.
test('F-CGPT-005: nicht loeschbares Alt-Manifest stoppt den Lauf VOR dem Pull', () => {
  const dir = tmp('p0-py-');
  fs.mkdirSync(path.join(dir, 'out', '_manifest.json'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'wl.json'), '{"stocks":[]}');
  const p = spawnSync(process.execPath, [path.join(ROOT, 'pull-yahoo.js'),
    '--watchlist', 'wl.json', '--output', 'out'], { cwd: dir, encoding: 'utf8', timeout: 180000 });
  const log = (p.stdout || '') + (p.stderr || '');
  assert.notEqual(p.status, 0, 'der Lauf muss rot sein');
  assert.doesNotMatch(log, /Parallel pulls/,
    'der Pull darf nach dem fehlgeschlagenen Manifest-Loeschen nicht mehr starten');
  assert.match(log, /Stale _manifest\.json konnte nicht geloescht werden/);
});

for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} }
console.log(`\np0-failloud-erstanlage.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
