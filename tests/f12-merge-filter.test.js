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
const MERGE_SCRIPT = path.join(__dirname, '..', 'scripts', 'merge-shard-manifests.js');

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
  if (opts.eingangsManifest) fs.writeFileSync(path.join(eingang, '_manifest.json'), JSON.stringify(opts.eingangsManifest));
  const wlPfad = path.join(root, 'watchlist.json');
  fs.writeFileSync(wlPfad, opts.kaputteWatchlist
    ? '{ das ist kein JSON'
    : JSON.stringify({ stocks: opts.watchlistEintraege || tickerInWatchlist.map((t) => ({ ticker: t })) }));
  // Hermetik: ohne --nav-register laese das Skript das PRODUKTIVE data-health/nav-holdings.json,
  // und jede Aufnahme dort koennte diese Faelle still verschieben. Der NAV-Ausschluss wird in
  // tests/nav-holdings-register.test.js geprueft — hier ist er ausdruecklich leer.
  const navPfad = path.join(root, 'nav-register-leer.json');
  fs.writeFileSync(navPfad, '[]');
  const r = spawnSync(process.execPath, [SCRIPT, '--eingang', eingang, '--ziel', ziel, '--watchlist', wlPfad, '--nav-register', navPfad],
    { encoding: 'utf8', env: { ...process.env, ...(opts.env || {}) } });
  const manifestPfad = path.join(ziel, '_manifest.json');
  return {
    root, eingang, ziel, code: r.status,
    ausgabe: (r.stdout || '') + (r.stderr || ''),
    // Metadateien raus: seit F-12-R1 legt der Filter zusaetzlich _manifest.json im Ziel ab
    // (Eingangs-Zahl fuer den Coverage-Floor). Hier interessieren die SNAPSHOTS — _CON.json
    // bleibt drin, das ist ein echter Ticker-Stand (safeSnapshotFilename).
    imZiel: fs.existsSync(ziel) ? fs.readdirSync(ziel).filter((f) => !f.startsWith('_manifest')).sort() : [],
    imEingang: fs.readdirSync(eingang).sort(),
    zielManifest: fs.existsSync(manifestPfad) ? JSON.parse(fs.readFileSync(manifestPfad, 'utf8')) : null,
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

// ── F-12-R1 (Review Tag 563, H1): die EINGANGS-Zahl ist die Floor-Referenz ────────
// Seit dem Filter enthaelt snapshots/ nur noch autorisierte Staende. Der Coverage-Floor in
// run-screener.js zaehlte dieses Verzeichnis — und maass damit wieder das Watchlist-Pruning
// statt der Korruption, die er fangen soll (prune-watchlist darf bis 50 %/Tag kuerzen,
// COVERAGE_FLOOR_RATIO=0.95 -> jeder Schrumpf >5 % riss den Folgelauf). Der Filter kennt als
// Einziger beide Zahlen und schreibt die ungefilterte Eingangs-Menge ins Manifest.
test('F-12-R1: der Filter schreibt die GESCANNTE Eingangs-Zahl ins Ziel-Manifest', () => {
  const r = lauf(['AAPL'], [['AAPL.json', 'AAPL'], ['TOTX.json', 'TOTX'], ['ZZZQ.json', 'ZZZQ']]);
  assert.equal(r.code, 0, r.ausgabe);
  assert.ok(r.zielManifest, 'ohne Manifest-Feld faellt der Coverage-Floor auf die gefilterte Verzeichnis-Zaehlung zurueck');
  assert.equal(r.zielManifest.n_eingang_snapshots, 3,
    'die Zahl muss die UNGEFILTERTE Eingangs-Menge sein (3), nicht die uebernommene (1): ' + JSON.stringify(r.zielManifest));
  assert.deepEqual(r.imZiel, ['AAPL.json'], 'Gegenprobe: gefiltert wird trotzdem');
});

test('F-12-R1: ein vorhandenes Eingangs-Manifest behaelt seine Felder (kompatibel ergaenzt)', () => {
  const r = lauf(['AAPL'], [['AAPL.json', 'AAPL'], ['TOTX.json', 'TOTX']], {
    eingangsManifest: { pulled_at: '2026-08-04T00:00:00.000Z', n_ok: 7, partial: false },
  });
  assert.equal(r.zielManifest.n_ok, 7, 'das Feld darf das Manifest nicht ersetzen, nur ergaenzen');
  assert.equal(r.zielManifest.partial, false);
  assert.equal(r.zielManifest.n_eingang_snapshots, 2);
});

test('F-12-R1: merge-shard-manifests traegt n_eingang_snapshots ins gemergte Manifest weiter', () => {
  // Dieser Schritt ueberschreibt snapshots/_manifest.json vollstaendig — ohne bewusste
  // Uebernahme verschwindet das Feld genau zwischen Filter und Scoring-Job.
  const root = tmpdir();
  const snapDir = path.join(root, 'snapshots');
  const manifestDir = path.join(root, 'shard-manifests');
  fs.mkdirSync(snapDir, { recursive: true });
  fs.mkdirSync(manifestDir, { recursive: true });
  snapshot(snapDir, 'AAPL.json', 'AAPL');
  fs.writeFileSync(path.join(snapDir, '_manifest.json'), JSON.stringify({ n_eingang_snapshots: 4242 }));
  fs.writeFileSync(path.join(manifestDir, 'shard-0.json'), JSON.stringify({
    n_ok: 1, n_full: 1, n_priceonly: 0, n_skipped_mcap: 0, n_failed: 0, partial: false,
  }));
  const wlPfad = path.join(root, 'watchlist.json');
  fs.writeFileSync(wlPfad, JSON.stringify({ stocks: [{ ticker: 'AAPL' }] }));
  const r = spawnSync(process.execPath, [MERGE_SCRIPT,
    '--shard-manifests', manifestDir, '--snapshots', snapDir, '--watchlist', wlPfad, '--expected-shards', '1',
  ], { encoding: 'utf8' });
  assert.equal(r.status, 0, (r.stdout || '') + (r.stderr || ''));
  const m = JSON.parse(fs.readFileSync(path.join(snapDir, '_manifest.json'), 'utf8'));
  assert.equal(m.n_eingang_snapshots, 4242, 'das gemergte Manifest hat die Eingangs-Zahl verloren: ' + JSON.stringify(m));
  assert.equal(m.n_total, 1, 'Gegenprobe: der Umzaehler hat trotzdem normal gemergt');
});

test('F-12-R1: fehlt die Eingangs-Zahl beim Mergen, wird das laut gemeldet (kein stiller Verlust)', () => {
  const root = tmpdir();
  const snapDir = path.join(root, 'snapshots');
  const manifestDir = path.join(root, 'shard-manifests');
  fs.mkdirSync(snapDir, { recursive: true });
  fs.mkdirSync(manifestDir, { recursive: true });
  snapshot(snapDir, 'AAPL.json', 'AAPL');
  fs.writeFileSync(path.join(manifestDir, 'shard-0.json'), JSON.stringify({ n_ok: 1, n_failed: 0, partial: false }));
  const wlPfad = path.join(root, 'watchlist.json');
  fs.writeFileSync(wlPfad, JSON.stringify({ stocks: [{ ticker: 'AAPL' }] }));
  const r = spawnSync(process.execPath, [MERGE_SCRIPT,
    '--shard-manifests', manifestDir, '--snapshots', snapDir, '--watchlist', wlPfad, '--expected-shards', '1',
  ], { encoding: 'utf8' });
  assert.match((r.stdout || '') + (r.stderr || ''), /::warning::[^\n]*n_eingang_snapshots/,
    'ein verschwundenes Feld muss laut sein — es schaltet den Coverage-Floor auf die falsche Population zurueck');
});

// T565-M2 (Review Tag 565): die Uebernahme prueft jetzt `> 0` statt nur Number.isFinite.
// Eine 0 ist keine Eingangs-Menge, sondern ein kaputter/leerer Vorlauf — sie wurde bis Tag 569
// als gueltige Referenz weitergereicht, und der Coverage-Floor verwarf sie dann WORTLOS.
test('T565-M2: n_eingang_snapshots=0 wird nicht uebernommen, sondern gemeldet', () => {
  const root = tmpdir();
  const snapDir = path.join(root, 'snapshots');
  const manifestDir = path.join(root, 'shard-manifests');
  fs.mkdirSync(snapDir, { recursive: true });
  fs.mkdirSync(manifestDir, { recursive: true });
  snapshot(snapDir, 'AAPL.json', 'AAPL');
  fs.writeFileSync(path.join(snapDir, '_manifest.json'), JSON.stringify({ n_eingang_snapshots: 0 }));
  fs.writeFileSync(path.join(manifestDir, 'shard-0.json'), JSON.stringify({ n_ok: 1, n_failed: 0, partial: false }));
  const wlPfad = path.join(root, 'watchlist.json');
  fs.writeFileSync(wlPfad, JSON.stringify({ stocks: [{ ticker: 'AAPL' }] }));
  const r = spawnSync(process.execPath, [MERGE_SCRIPT,
    '--shard-manifests', manifestDir, '--snapshots', snapDir, '--watchlist', wlPfad, '--expected-shards', '1',
  ], { encoding: 'utf8' });
  const aus = (r.stdout || '') + (r.stderr || '');
  assert.match(aus, /::warning::[^\n]*n_eingang_snapshots/, 'die 0 muss in den Warn-Zweig fallen. Ausgabe:\n' + aus);
  const m = JSON.parse(fs.readFileSync(path.join(snapDir, '_manifest.json'), 'utf8'));
  assert.ok(!(m.n_eingang_snapshots === 0), 'eine 0 darf nicht als gueltige Floor-Referenz weiterwandern: ' + JSON.stringify(m));
});

// ── F-12-R2 (H2): Verhaeltnis-Wache ───────────────────────────────────────────────
// Der bisherige Stop griff erst bei 100 % uebersprungen. Ein Namensschema-Bruch, der "nur"
// die Haelfte erwischt (Suffix-Regel, Grossschreibung, halbe Watchlist), lief still durch.
const VIELE = Array.from({ length: 200 }, (_, i) => [`T${i}.json`, `T${i}`]);
const tickerBis = (n) => VIELE.slice(0, n).map(([, t]) => t);

test('F-12-R2: uebersprungener Anteil ueber der Schwelle -> harter Stop', () => {
  const r = lauf(tickerBis(100), VIELE); // 100 von 200 = 50 % uebersprungen
  assert.notEqual(r.code, 0, 'ein 50-%-Ausfall darf nicht still ins Artefakt wandern. Ausgabe:\n' + r.ausgabe);
  assert.match(r.ausgabe, /::error::[^\n]*ueber der Schwelle/);
});

test('F-12-R2: normaler Karteileichen-Anteil (unter der Schwelle) geht DURCH', () => {
  // Gegenprobe zur Wache: der reale Bestand liegt bei 14–16 % — die gueltige Form muss
  // durchgehen, sonst haette der Wachhund den taeglichen Lauf erschossen.
  const r = lauf(tickerBis(170), VIELE); // 30 von 200 = 15 %, der reale Stand
  assert.equal(r.code, 0, 'ein normaler Karteileichen-Anteil ist kein Fehler. Ausgabe:\n' + r.ausgabe);
  assert.match(r.ausgabe, /30 von 200 Snapshots uebersprungen/);
});

// T565-M1: der Anteil ratcht monoton (Karteileichen werden nie ausgetragen) — ohne Ventil
// wuerde die Wache eines Tages jeden Tageslauf toeten, ohne dass etwas kaputt waere.
test('T565-M1: Ventil laesst den legitimen Karteileichen-Berg durch, Befund bleibt sichtbar', () => {
  const r = lauf(tickerBis(100), VIELE, { env: { ALLOW_UEBERSPRUNGEN_DRIFT: '1' } }); // 50 %
  assert.equal(r.code, 0, 'mit Ventil darf der Lauf nicht sterben. Ausgabe:\n' + r.ausgabe);
  assert.match(r.ausgabe, /::warning::[^\n]*ueber der Schwelle/, 'der Befund muss trotzdem gemeldet werden');
  assert.ok(!/::error::/.test(r.ausgabe), 'mit Ventil kein ::error:: (sonst faerbt es den Job weiter rot)');
  assert.ok(r.imZiel.length > 0, 'und die autorisierten Snapshots muessen ankommen');
});

test('T565-M1: ohne Ventil (Default 0) bleibt es beim harten Stop', () => {
  const r = lauf(tickerBis(100), VIELE, { env: { ALLOW_UEBERSPRUNGEN_DRIFT: '0' } });
  assert.notEqual(r.code, 0, 'das Ventil darf nicht versehentlich per Default offen stehen');
});

// ── T569-F8 (Review Tag 569): das Ventil war ein Schalter, kein Deckel ─────────────
// BEFUND: `=== '1'` machte aus dem Ventil einen Dauer-AN-Schalter. Genau die Zahl, die laut
// T565-M1 monoton nach oben ratcht, waere danach nie wieder aufgefallen — 15 %, 40 %, 80 %
// uebersprungene Snapshots haetten alle dieselbe ::warning::-Zeile erzeugt. Jetzt ist der Wert
// die OBERGRENZE (Anteil 0..1), bis zu der das Ventil gilt; weiteres Anwachsen fliegt wieder auf.
test('T569-F8: ueber der gesetzten Obergrenze stoppt der Lauf wieder hart', () => {
  const r = lauf(tickerBis(100), VIELE, { env: { ALLOW_UEBERSPRUNGEN_DRIFT: '0.35' } }); // 50 % > 35 %
  assert.notEqual(r.code, 0, 'BEFUND: als Schalter haette hier nichts mehr angeschlagen. Ausgabe:\n' + r.ausgabe);
  assert.match(r.ausgabe, /::error::[^\n]*ueber der Schwelle/);
});

test('T569-F8: bis zur gesetzten Obergrenze faehrt der Lauf weiter, Befund sichtbar', () => {
  const r = lauf(tickerBis(100), VIELE, { env: { ALLOW_UEBERSPRUNGEN_DRIFT: '0.6' } }); // 50 % <= 60 %
  assert.equal(r.code, 0, 'unter der Obergrenze muss das Ventil greifen. Ausgabe:\n' + r.ausgabe);
  assert.match(r.ausgabe, /::warning::[^\n]*ueber der Schwelle/);
  assert.ok(!/::error::/.test(r.ausgabe), 'mit Ventil kein ::error::');
});

test('T569-F8: ventilObergrenze — reine Auswertung des Rohwerts', () => {
  const { ventilObergrenze } = require(SCRIPT);
  assert.equal(ventilObergrenze('1'), 1, '"1" bleibt rueckwaerts-kompatibel = kein Deckel');
  assert.equal(ventilObergrenze('0.35'), 0.35);
  assert.equal(ventilObergrenze('0'), null, 'der Workflow-Default darf nichts oeffnen');
  for (const v of [undefined, '', 'ja', 'true', '-1', 'NaN', '2', '1.0001'])
    assert.equal(ventilObergrenze(v), null, `"${String(v)}" darf das Ventil nicht oeffnen`);
});

test('T569-F8: unbrauchbare Ventil-Werte oeffnen nichts (fail-closed)', () => {
  for (const wert of ['ja', 'true', '', '-1', 'NaN', '2']) {
    const r = lauf(tickerBis(100), VIELE, { env: { ALLOW_UEBERSPRUNGEN_DRIFT: wert } });
    assert.notEqual(r.code, 0, `ALLOW_UEBERSPRUNGEN_DRIFT="${wert}" darf das Ventil nicht oeffnen. Ausgabe:\n` + r.ausgabe);
  }
});

test('F-12-R2: unter der Mindest-Fallzahl quotelt die Wache nicht (2 von 3 sind kein Befund)', () => {
  const r = lauf(['AAPL'], [['AAPL.json', 'AAPL'], ['TOTX.json', 'TOTX'], ['ZZZQ.json', 'ZZZQ']]);
  assert.equal(r.code, 0, 'ein Anteil aus 3 Dateien ist kein Signal — der Kaltstart darf nicht daran sterben');
});

// ── F-12-R6 (L6): der verschluckte Grund ──────────────────────────────────────────
test('F-12-R6: der erste Namens-Fehler der Watchlist wird mitgeloggt, nicht nur gezaehlt', () => {
  const r = lauf(['AAPL'], [['AAPL.json', 'AAPL']], {
    watchlistEintraege: [{ ticker: 'AAPL' }, { ticker: null }],
  });
  assert.match(r.ausgabe, /::warning::[^\n]*ohne brauchbaren Ticker/, 'die Zaehlung fehlt. Ausgabe:\n' + r.ausgabe);
  assert.match(r.ausgabe, /null\/undefined|empty after sanitisation/,
    'die erste Fehlermeldung muss mit — sonst ist "1 Eintrag unbrauchbar" nicht diagnostizierbar. Ausgabe:\n' + r.ausgabe);
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

// T564-L1 (Review Tag 564): dieselbe Reihenfolge-Frage wie beim Prune-Pin darueber, nur in
// die andere Richtung. merge-shard-manifests.js liest n_eingang_snapshots aus dem Manifest,
// das GENAU DIESER Filter schreibt (F-12-R1), und zaehlt zusaetzlich die on-disk-Dateien in
// snapshots/. Liefe der Merge zuerst, faende er das Feld nicht (nur ::warning::) und der
// Coverage-Floor im scoring-Job fiele still auf die falsche Population zurueck.
test('Verdrahtung: der Filter laeuft VOR dem Manifest-Merge (sonst fehlt die Eingangs-Zahl)', () => {
  const filter = YML.indexOf('scripts/filter-snapshot-merge.js');
  const merge = YML.indexOf('- name: Merge shard manifests');
  assert.ok(filter > -1 && merge > -1, 'beide Schritte muessen existieren');
  assert.ok(filter < merge, 'der Merge ueberschreibt _manifest.json vollstaendig und uebernimmt n_eingang_snapshots aus dem vorhandenen Stand — laeuft er zuerst, gibt es nichts zu uebernehmen');
});

test('Verdrahtung: der Eingangsordner ist git-ignoriert (der Commit-Schritt faehrt git add -A)', () => {
  const gi = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
  assert.match(gi, /^snapshots-eingang\/$/m,
    'ohne diesen Eintrag wuerde "git add -A" im merge-Job taeglich ~12.500 Snapshot-JSONs (30 MB) ins Repo committen');
});

// F-12-R4 (Review Tag 563, M4): der Namespace-Scan lief ueber den YAML-VOLLTEXT inklusive
// Kommentaren. Jede Begruendungs-Zeile, die einen frueheren Namespace nennt ("vorher
// last-good-disk-scoring-"), haette den Waechter falsch-rot gemacht, obwohl Restore und Save
// sauber denselben Namespace tragen — der Repro steht unten als Positiv-Fixture. Jetzt wird
// am OBJEKT gesucht: nur die beiden benannten Schritte, darin nur die Nicht-Kommentar-Zeilen.
function namespacesAusSchluesselzeilen(text) {
  return new Set(text.split('\n')
    .filter((z) => !/^\s*#/.test(z))
    .flatMap((z) => z.match(/last-good-disk-scoring-[a-z0-9-]*/g) || [])
    .map((s) => s.replace(/-$/, '')));
}

test('Verdrahtung: Restore- und Save-Key der Coverage-Floor-Baseline teilen EINEN Namespace', () => {
  const ns = namespacesAusSchluesselzeilen(
    schrittBlock('Restore Coverage-Floor Baseline (_last_good_disk.json)') +
    schrittBlock('Save Coverage-Floor Baseline (_last_good_disk.json)'));
  assert.equal(ns.size, 1, 'Restore und Save duerfen nicht in verschiedene Cache-Namespaces zeigen (der F-12-Reset waere sonst nach einem Lauf wieder aufgehoben): ' + JSON.stringify([...ns]));
});

test('F-12-R4: eine Namespace-Erwaehnung im Kommentar macht den Waechter NICHT mehr falsch-rot', () => {
  const gueltig = [
    '      - name: Restore Coverage-Floor Baseline',
    '        # F-12: Namespace einmalig von last-good-disk-scoring- auf -f12- gehoben.',
    '        with:',
    '          key: last-good-disk-scoring-f12-${{ github.run_id }}',
    '          restore-keys: |',
    '            last-good-disk-scoring-f12-',
  ].join('\n');
  assert.equal(namespacesAusSchluesselzeilen(gueltig).size, 1, 'gueltige Form muss DURCHGEHEN (das war der Falsch-Rot-Repro)');
});

test('F-12-R4: ein echter Namespace-Bruch fliegt weiterhin auf (Negativ-Fixture)', () => {
  const kaputt = [
    '          key: last-good-disk-scoring-f12-${{ github.run_id }}',
    '          restore-keys: |',
    '            last-good-disk-scoring-alt-',
  ].join('\n');
  assert.equal(namespacesAusSchluesselzeilen(kaputt).size, 2, 'abweichende Namespaces muessen auffliegen');
});

console.log(`\nf12-merge-filter.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
