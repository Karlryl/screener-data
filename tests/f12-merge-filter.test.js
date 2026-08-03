'use strict';
/**
 * F-12 (Karl-Entscheid 04.08.2026): Karteileichen-Snapshots beim Zusammenfuehren filtern.
 *
 * BEFUND: 1.806 der 12.540 Snapshot-Dateien (14,4 %) gehoeren zu Tickern, die seit der
 * Watchlist-Kuerzung am 17.07. nicht mehr in watchlist.json stehen. Sie werden nie wieder
 * gezogen, wandern aber ueber die per-Shard-Caches taeglich in die Shard-Artefakte, von dort
 * in den gemergten snapshots/-Ordner des merge-Jobs und damit in JEDE nachgelagerte Messung
 * (Frische-Gate, Coverage-Gate, Watcher, ATH-Fortschreibung) sowie in das 30-MB-Artefakt,
 * das der scoring-Job und der Monatslauf laden.
 *
 * KARL-ENTSCHEID: beim Zusammenfuehren filtern, KEINE Datei-Loeschung. Ein Snapshot ohne
 * Watchlist-Eintrag wandert nicht mehr ins Artefakt; jede Datei bleibt liegen.
 *
 * DIESER WAECHTER prueft das VERHALTEN von scripts/filter-snapshot-merge.js am echten
 * Prozess (spawnSync), nicht die Schreibweise im Quelltext:
 *   - ein Snapshot MIT Watchlist-Eintrag erscheint im Ergebnis (gueltige Form geht DURCH),
 *   - ein Snapshot OHNE Watchlist-Eintrag erscheint NICHT (kaputte Form fliegt auf),
 *   - die Quelldatei bleibt liegen (keine Loeschung),
 *   - der Zaehl-Log-Pfad meldet "X von Y Snapshots uebersprungen (kein Watchlist-Eintrag)",
 *   - 0 gescannte Snapshots sind ein eigener Befund (::warning::),
 *   - alles weggefiltert bei vorhandenen Snapshots ist ein harter Stop (sonst verschwaende
 *     ein Namensschema-Bruch das komplette Universum still),
 *   - eine unlesbare Watchlist ist ein harter Stop (NICHT stiller Voll-Durchlauf).
 *
 * Standalone-Runner, keine Frameworks, kein Netz.
 * Run: node tests/f12-merge-filter.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.stack); }
}

const SCRIPT = path.join(__dirname, '..', 'scripts', 'filter-snapshot-merge.js');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'f12-'));
}
function snapshot(dir, file, ticker, asOf) {
  fs.writeFileSync(path.join(dir, file), JSON.stringify({
    meta: { ticker, asOf: asOf || new Date().toISOString() },
    metrics: {},
  }));
}
// Baut Eingang + Watchlist und laesst den Filter laufen. tickerInWatchlist = Array der
// Ticker, die watchlist.json fuehrt; dateien = [[dateiname, ticker], ...] im Eingang.
function lauf(tickerInWatchlist, dateien, opts = {}) {
  const root = tmpdir();
  const eingang = path.join(root, 'eingang');
  const ziel = path.join(root, 'ziel');
  fs.mkdirSync(eingang, { recursive: true });
  for (const [datei, ticker] of dateien) snapshot(eingang, datei, ticker);
  const wlPfad = path.join(root, 'watchlist.json');
  fs.writeFileSync(wlPfad, opts.kaputteWatchlist
    ? '{ das ist kein JSON'
    : JSON.stringify({ stocks: tickerInWatchlist.map((t) => ({ ticker: t })) }));
  const r = spawnSync(process.execPath, [SCRIPT, '--eingang', eingang, '--ziel', ziel, '--watchlist', wlPfad], { encoding: 'utf8' });
  return {
    root, eingang, ziel, code: r.status,
    ausgabe: (r.stdout || '') + (r.stderr || ''),
    imZiel: fs.existsSync(ziel) ? fs.readdirSync(ziel).sort() : [],
    imEingang: fs.readdirSync(eingang).sort(),
  };
}

// ── Kern: die SACHE, um die es geht ────────────────────────────────────────────────
test('Snapshot MIT Watchlist-Eintrag wandert ins Ergebnis, Karteileiche NICHT', () => {
  const r = lauf(['AAPL'], [['AAPL.json', 'AAPL'], ['TOTX.json', 'TOTX']]);
  assert.equal(r.code, 0, 'gueltige Form muss durchgehen (exit 0), Ausgabe:\n' + r.ausgabe);
  assert.ok(r.imZiel.includes('AAPL.json'), 'autorisierter Snapshot fehlt im Ergebnis: ' + JSON.stringify(r.imZiel));
  assert.ok(!r.imZiel.includes('TOTX.json'), 'Karteileiche ist im Ergebnis gelandet: ' + JSON.stringify(r.imZiel));
});

test('KEINE Loeschung: die Karteileiche liegt nach dem Lauf unveraendert im Eingang', () => {
  const r = lauf(['AAPL'], [['AAPL.json', 'AAPL'], ['TOTX.json', 'TOTX']]);
  assert.deepEqual(r.imEingang, ['AAPL.json', 'TOTX.json'], 'im Eingang muss jede Datei liegen bleiben (Karl-Entscheid)');
});

test('Zaehl-Log meldet uebersprungene und gescannte Anzahl', () => {
  const r = lauf(['AAPL'], [['AAPL.json', 'AAPL'], ['TOTX.json', 'TOTX'], ['ZZZQ.json', 'ZZZQ']]);
  assert.match(r.ausgabe, /2 von 3 Snapshots uebersprungen \(kein Watchlist-Eintrag\)/,
    'der Zaehl-Log fehlt oder zaehlt falsch. Ausgabe:\n' + r.ausgabe);
});

test('kein einziger Uebersprungener: Lauf gruen, alle Snapshots im Ergebnis', () => {
  const r = lauf(['AAPL', 'MSFT'], [['AAPL.json', 'AAPL'], ['MSFT.json', 'MSFT']]);
  assert.equal(r.code, 0);
  assert.deepEqual(r.imZiel, ['AAPL.json', 'MSFT.json']);
  assert.match(r.ausgabe, /0 von 2 Snapshots uebersprungen/);
});

// ── Namensschema: Windows-Reserved-Ticker sind ECHTE Snapshots, keine Metadatei ────
test('Windows-Reserved-Ticker (_CON.json) ueberlebt den Filter', () => {
  const r = lauf(['CON'], [['_CON.json', 'CON']]);
  assert.equal(r.code, 0, r.ausgabe);
  assert.ok(r.imZiel.includes('_CON.json'), '_CON.json ist ein echter Snapshot (safeSnapshotFilename), keine Metadatei');
});

test('Punkt-Ticker (BRK.B) wird ueber dieselbe Namensfunktion zugeordnet', () => {
  const r = lauf(['BRK.B'], [['BRK.B.json', 'BRK.B'], ['BRK.C.json', 'BRK.C']]);
  assert.ok(r.imZiel.includes('BRK.B.json'));
  assert.ok(!r.imZiel.includes('BRK.C.json'));
});

// ── Fail-loud-Pfade ───────────────────────────────────────────────────────────────
test('0 gescannte Snapshots sind ein eigener Befund (::warning::)', () => {
  const r = lauf(['AAPL'], []);
  assert.match(r.ausgabe, /::warning::/, 'ein leerer Eingang muss laut gemeldet werden. Ausgabe:\n' + r.ausgabe);
  assert.equal(r.code, 0, 'ein leerer Eingang ist ein Kaltstart-Zustand, kein harter Fehler');
});

test('Snapshots vorhanden, aber ALLES weggefiltert -> harter Stop', () => {
  const r = lauf(['AAPL'], [['TOTX.json', 'TOTX'], ['ZZZQ.json', 'ZZZQ']]);
  assert.notEqual(r.code, 0, 'ein Namensschema-Bruch wuerde sonst das komplette Universum still loeschen');
  assert.match(r.ausgabe, /::error::/);
});

test('unlesbare Watchlist -> harter Stop, KEIN stiller Voll-Durchlauf', () => {
  const r = lauf(['AAPL'], [['AAPL.json', 'AAPL'], ['TOTX.json', 'TOTX']], { kaputteWatchlist: true });
  assert.notEqual(r.code, 0, 'ein Ladefehler darf nicht als "leere Watchlist" durchgehen');
  assert.ok(!r.imZiel.includes('TOTX.json'), 'bei Ladefehler darf nichts Ungefiltertes ins Ergebnis');
});

// ── Verdrahtung: ein Filter, den niemand aufruft, filtert nichts ──────────────────
// Am OBJEKT gesucht (Block ab dem benannten Schritt bis zum naechsten `- name:`), nicht
// per Volltext-Suche ueber die ganze Datei — sonst haelt ein beliebiges zweites Vorkommen
// den Test gruen, waehrend sich genau die geschuetzte Stelle aendert.
const YML = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'daily-pull.yml'), 'utf8');
function schrittBlock(name) {
  const start = YML.indexOf('- name: ' + name);
  assert.notEqual(start, -1, 'Schritt "' + name + '" existiert nicht mehr in daily-pull.yml');
  const rest = YML.slice(start + 1);
  const ende = rest.indexOf('- name: ');
  return ende === -1 ? rest : rest.slice(0, ende);
}

test('Verdrahtung: der Shard-Download landet im Eingangsordner, nicht direkt in snapshots/', () => {
  const b = schrittBlock('Download all shard snapshots');
  assert.match(b, /path:\s*snapshots-eingang\b/, 'der Download muss in den Eingangsordner gehen, sonst umgeht er den Filter');
  assert.doesNotMatch(b, /path:\s*snapshots\s*$/m, 'ein Download direkt nach snapshots/ haette den Filter wirkungslos gemacht');
});

test('Verdrahtung: der Filter laeuft im merge-Job und schreibt nach snapshots/', () => {
  assert.match(YML, /node scripts\/filter-snapshot-merge\.js[^\n]*--eingang snapshots-eingang[^\n]*--ziel snapshots\b/,
    'der Filter-Aufruf fehlt oder zeigt auf andere Ordner');
});

test('Verdrahtung: der Filter laeuft VOR dem Watchlist-Prune (sonst falscher Kollisions-Alarm)', () => {
  const filter = YML.indexOf('scripts/filter-snapshot-merge.js');
  const prune = YML.indexOf('- name: Prune Watchlist');
  assert.ok(filter > -1 && prune > -1, 'beide Schritte muessen existieren');
  assert.ok(filter < prune, 'gegen die geprunte Watchlist gefiltert faellt die on-disk-Zahl unter die summierte n_ok der Shards -> merge-shard-manifests wuerde eine Ticker-Kollision melden, die es nicht gibt');
});

test('Verdrahtung: der Eingangsordner ist git-ignoriert (der Commit-Schritt faehrt git add -A)', () => {
  const gi = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
  assert.match(gi, /^snapshots-eingang\/$/m,
    'ohne diesen Eintrag wuerde "git add -A" im merge-Job taeglich ~12.500 Snapshot-JSONs (30 MB) ins Repo committen');
});

test('Verdrahtung: Restore- und Save-Key der Coverage-Floor-Baseline teilen EINEN Namespace', () => {
  const ns = new Set((YML.match(/last-good-disk-scoring-[a-z0-9-]*/g) || [])
    .map((s) => s.replace(/-$/, '')));
  assert.equal(ns.size, 1, 'Restore und Save duerfen nicht in verschiedene Cache-Namespaces zeigen (der F-12-Reset waere sonst nach einem Lauf wieder aufgehoben): ' + JSON.stringify([...ns]));
});

console.log(`\nf12-merge-filter.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
