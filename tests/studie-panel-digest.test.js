'use strict';

// F6-B6 - der Waechter ueber dem Panel-Byte-Digest.
// _COURT-F6-VOLLZUG-2026-08-31, Auflage F6-B6 (3:0; Waechter von V3).
//
// DIE SACHE: scripts/studie-panel-digest.py darf die Bytes des Panels hashen
// und sonst NICHTS. Kein sqlite3, kein Parser, kein Blick in eine Zeile.
// Der Waechter wird rot, "sobald der Bauer `sqlite3` oder einen anderen Parser
// auf dem Panel-Pfad benutzt" (F6-B6 woertlich).
//
// DER ANKER SITZT AM OBJEKT, NICHT AM TEXT: die Importe werden mit `ast` aus
// dem SYNTAXBAUM gelesen, nicht mit einer Regex ueber den Quelltext. Eine Regex
// haette zwei Fehlerarten: sie wird rot bei `# import sqlite3` in einem
// Kommentar (Fehlalarm) und bleibt gruen bei
// `__import__("sql" + "ite3")` (das eigentliche Loch). Probe (d) unten misst
// genau diesen Unterschied - ohne sie waere nicht belegt, dass der Anker am
// Baum haengt und nicht an einer Zeichenkette.
//
// GEPRUEFT WIRD:
//   (a) die Importliste ist GENAU die Allowlist - jeder sechste Import ist rot.
//   (b) sqlite3 und die uebrigen Parser sind namentlich abwesend.
//   (c) der Hash stimmt gegen eine UNABHAENGIGE Implementierung (node:crypto),
//       nicht gegen eine zweite Kopie derselben Python-Schleife.
//   (d) BRUCHPROBE 1: `import sqlite3` in eine Kopie einfuegen -> (a) und (b)
//       rot. BRUCHPROBE 2 (Gegenprobe): dasselbe als KOMMENTAR -> gruen.
//   (e) fail-closed: fehlende Datei / Verzeichnis -> Abbruch ohne stdout.
//
// KEIN TEST FASST EIN ECHTES PANEL AN. Gehasht werden ausschliesslich
// Fixture-Bytes unterhalb von os.tmpdir().
//
// Usage: node tests/studie-panel-digest.test.js

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const python = process.env.PYTHON || 'python';
const REPO = path.join(__dirname, '..');
const SKRIPT = path.join(REPO, 'scripts', 'studie-panel-digest.py');

// Die POSITIVE Allowlist. Sie steht hier ausgeschrieben und nicht im Werkzeug:
// ein Waechter, der seine Sollwerte aus dem Geprueften liest, prueft nichts.
const ERLAUBTE_IMPORTE = ['argparse', 'hashlib', 'os', 'sys', 'time'];

// Was ein Parser waere. sqlite3 nennt F6-B6 ausdruecklich, der Rest ist
// dieselbe Klasse: alles, was aus Bytes Struktur macht.
const PARSER = ['sqlite3', 'json', 'csv', 'pickle', 'xml', 'configparser',
  'pandas', 'pyarrow', 'duckdb', 'polars', 'sqlalchemy', 'shelve', 'marshal'];

function tempdir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const tmp = tempdir('f6-panel-digest-');

// ── Der Import-Leser: ast, nicht Regex ──────────────────────────────────────
// Er laeuft gegen einen PFAD, damit die Bruchprobe unten exakt denselben
// Codepfad trifft wie die Gruenprobe. Ein Waechter, dessen Bruchprobe eine
// andere Mechanik faehrt als der Ernstfall, belegt nichts.
const AST_LESER = [
  'import ast, sys',
  'baum = ast.parse(open(sys.argv[1], encoding="utf-8").read())',
  'namen = set()',
  'for k in ast.walk(baum):',
  '    if isinstance(k, ast.Import):',
  '        for n in k.names: namen.add(n.name.split(".")[0])',
  '    elif isinstance(k, ast.ImportFrom):',
  '        if k.module: namen.add(k.module.split(".")[0])',
  // __import__("sqlite3") ist ein Aufruf, kein Import-Knoten - er wuerde der
  // Knotensuche oben entgehen. Deshalb wird er hier positiv mitgelesen.
  '    elif isinstance(k, ast.Call) and getattr(k.func, "id", None) == "__import__":',
  '        for a in k.args:',
  '            if isinstance(a, ast.Constant) and isinstance(a.value, str):',
  '                namen.add(a.value.split(".")[0])',
  '            else: namen.add("<dynamisch>")',
  // Und die Schlupfloecher EINE Ebene darunter: exec("import sqlite3") ist
  // kein Import-Knoten und auch kein __import__-Aufruf - der Scanner saehe
  // gar nichts. Statt jede Verschleierung einzeln aufzuzaehlen (ein Spiel,
  // das der Scanner verliert), wird dynamische Codeausfuehrung als solche
  // gemeldet: sie hat in einem Werkzeug, dessen Importflaeche gepinnt ist,
  // nichts zu suchen.
  '    elif isinstance(k, ast.Call) and getattr(k.func, "id", None) in ("eval", "exec", "compile"):',
  '        namen.add("<dynamische-ausfuehrung>")',
  '    elif isinstance(k, ast.Attribute) and k.attr == "__import__":',
  '        namen.add("<dynamisch>")',
  'print("\\n".join(sorted(namen)))',
].join('\n');

function importe(datei) {
  const r = spawnSync(python, ['-c', AST_LESER, datei], { encoding: 'utf8' });
  assert.equal(r.status, 0, `Import-Leser gescheitert: ${r.stderr}`);
  return r.stdout.split('\n').map((z) => z.trim()).filter(Boolean);
}

function ruf(args) {
  return spawnSync(python, [SKRIPT, ...args], { encoding: 'utf8' });
}

// Das Werkzeug gibt "Feld : Wert" aus (Hausform, vgl. studie-vb-b4-band.py
// `hash`). Der Leser holt ein Feld heraus.
function feld(stdout, name) {
  const treffer = stdout.split('\n').find((z) => z.startsWith(name));
  assert.ok(treffer, `Ausgabe ohne Feld '${name}': ${stdout}`);
  return treffer.split(':').slice(1).join(':').trim();
}

// ── (a) Die Importliste ist GENAU die Allowlist ─────────────────────────────

test('(a) studie-panel-digest.py importiert genau fuenf Module, keinen sechsten', () => {
  assert.deepEqual(importe(SKRIPT).sort(), [...ERLAUBTE_IMPORTE].sort(),
    'Die Importflaeche ist gepinnt (F6-B6). Ein zusaetzlicher Import - welcher '
    + 'auch immer - ist hier ein Befund, kein Versehen.');
});

// ── (b) sqlite3 und die uebrigen Parser namentlich abwesend ─────────────────

test('(b) kein sqlite3 und kein anderer Parser im Werkzeug', () => {
  const gefunden = importe(SKRIPT).filter((m) => PARSER.includes(m));
  assert.deepEqual(gefunden, [],
    `F6-B6: ein Parser auf dem Panel-Pfad ist der verbotene stille Griff. `
    + `Gefunden: ${gefunden.join(', ')}`);
});

// ── (c) Der Hash stimmt gegen eine UNABHAENGIGE Implementierung ─────────────

test('(c) der Digest stimmt gegen node:crypto, nicht gegen sich selbst', () => {
  // Groesser als ein Block (4 MiB), damit die Streaming-SCHLEIFE gemessen wird
  // und nicht nur ein einzelnes read(). Bei <= 1 Block waere eine kaputte
  // Schleife nicht von einer heilen zu unterscheiden.
  const bytes = crypto.randomBytes(9 * 1024 * 1024 + 12345);
  const datei = path.join(tmp, 'fixture-gross.bin');
  fs.writeFileSync(datei, bytes);

  const soll = crypto.createHash('sha256').update(bytes).digest('hex');
  const r = ruf(['--datei', datei]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(feld(r.stdout, 'SHA-256'), soll,
    'ueber mehrere Bloecke hinweg muss derselbe Hash herauskommen wie bei '
    + 'einem Ein-Schuss-Hash - sonst ist die Blockschleife falsch verkettet');
  assert.equal(feld(r.stdout, 'Groesse'), `${bytes.length} Bytes`);
  assert.equal(feld(r.stdout, 'Pfad'), datei);
  assert.match(feld(r.stdout, 'Dauer'), /^\d+\.\d{3} s$/);
});

test('(c2) die leere Datei ist ein gueltiger Digest, kein Abbruch', () => {
  const leer = path.join(tmp, 'leer.bin');
  fs.writeFileSync(leer, Buffer.alloc(0));
  const r = ruf(['--datei', leer]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(feld(r.stdout, 'SHA-256'),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

// ── (d) BRUCHPROBE, in beide Richtungen ─────────────────────────────────────

test('(d) BRUCHPROBE: ein eingefuegtes `import sqlite3` macht (a) und (b) rot', () => {
  const kopie = path.join(tmp, 'gebrochen.py');
  fs.writeFileSync(kopie,
    `import sqlite3\n${fs.readFileSync(SKRIPT, 'utf8')}`, 'utf8');

  const gelesen = importe(kopie);
  assert.ok(gelesen.includes('sqlite3'),
    'die Bruchprobe hat nicht gegriffen - der Leser sieht den Import nicht');

  // (a) waere rot:
  assert.notDeepEqual(gelesen.sort(), [...ERLAUBTE_IMPORTE].sort());
  // (b) waere rot, und zwar NAMENTLICH:
  assert.deepEqual(gelesen.filter((m) => PARSER.includes(m)), ['sqlite3']);
});

test('(d2) BRUCHPROBE dynamisch: __import__("sqlite3") entgeht dem Anker nicht', () => {
  const kopie = path.join(tmp, 'gebrochen-dynamisch.py');
  fs.writeFileSync(kopie,
    `__import__("sqlite3")\n${fs.readFileSync(SKRIPT, 'utf8')}`, 'utf8');
  assert.ok(importe(kopie).includes('sqlite3'),
    'ein dynamischer Import ist derselbe Griff und muss denselben Alarm ausloesen');
});

test('(d3) GEGENPROBE: `import sqlite3` im KOMMENTAR laesst den Waechter gruen', () => {
  // Ohne diese Probe waere nicht belegt, dass der Anker am Syntaxbaum haengt.
  // Eine Regex ueber den Quelltext wuerde hier rot - und damit bei jedem
  // ehrlichen Kommentar ueber sqlite3 einen Fehlalarm werfen.
  const kopie = path.join(tmp, 'nur-kommentar.py');
  fs.writeFileSync(kopie,
    `# import sqlite3 - genau das tut dieses Werkzeug NICHT\n`
    + `${fs.readFileSync(SKRIPT, 'utf8')}`, 'utf8');
  assert.deepEqual(importe(kopie).sort(), [...ERLAUBTE_IMPORTE].sort(),
    'ein Kommentar ist kein Import - der Anker sitzt am ast, nicht am Text');
});

// ── (e) fail-closed ─────────────────────────────────────────────────────────

function abbruch(args, warum) {
  const r = ruf(args);
  assert.notEqual(r.status, 0, `${warum}: haette abbrechen muessen`);
  assert.equal(r.stdout.trim(), '', `${warum}: ein Abbruch darf KEINEN Digest ausgeben`);
  assert.match(r.stderr, /^F6-PANEL-DIGEST-ABBRUCH:/m,
    `${warum}: der Abbruch traegt keinen benannten Grund: ${r.stderr.slice(0, 200)}`);
}

test('(e) fehlende Datei und Verzeichnis brechen benannt ab, ohne stdout', () => {
  abbruch(['--datei', path.join(tmp, 'gibt-es-nicht.sqlite')], 'fehlende Datei');
  abbruch(['--datei', tmp], 'Verzeichnis statt Datei');
});

test('(e2) ohne --datei laeuft gar nichts - MIT benanntem Grund', () => {
  // Mit argparse-`required=True` braeche argparse selbst ab, mit seiner
  // usage-Meldung und ohne den Prefix. Zwei von drei Vertragseigenschaften
  // (Exit != 0, leeres stdout) haetten dann gehalten, die dritte nicht.
  abbruch([], 'ohne --datei');
});

test('(e3) BRUCHPROBE dynamisch: exec("import sqlite3") entgeht dem Anker nicht', () => {
  const kopie = path.join(tmp, 'gebrochen-exec.py');
  fs.writeFileSync(kopie,
    `exec("import sqlite3")\n${fs.readFileSync(SKRIPT, 'utf8')}`, 'utf8');
  const gelesen = importe(kopie);
  assert.ok(gelesen.includes('<dynamische-ausfuehrung>'),
    'exec() versteckt einen Import vor einer reinen Knotensuche - der Scanner '
    + 'muss dynamische Ausfuehrung als solche melden');
  assert.notDeepEqual(gelesen.sort(), [...ERLAUBTE_IMPORTE].sort());
});

test('(f) die Datei aendert sich WAEHREND des Lesens -> ABBRUCH, kein Hash', () => {
  // Der gefaehrlichste Fall: laengengleiche Aenderung an Ort und Stelle. Eine
  // reine Laengenpruefung laesst sie durch und bezeugt dann einen Zustand,
  // den es als zusammenhaengende Datei nie gab.
  const datei = path.join(tmp, 'wandert.bin');
  fs.writeFileSync(datei, Buffer.alloc(4096, 0x41));
  const vorher = fs.statSync(datei);
  // mtime zurueckdatieren, dann laengengleich ueberschreiben: Groesse
  // identisch, Inhalt anders, mtime anders.
  fs.writeFileSync(datei, Buffer.alloc(4096, 0x42));
  fs.utimesSync(datei, vorher.atime, vorher.mtime);
  // Gegenprobe zuerst: eine RUHENDE Datei geht sauber durch.
  const gut = ruf(['--datei', datei]);
  assert.equal(gut.status, 0, gut.stdout + gut.stderr);

  // Und jetzt die Sache selbst, an der reinen Funktion gemessen: gleiche
  // Groesse, andere mtime -> Abbruch.
  const r = spawnSync(python, ['-c', [
    'import importlib.util, os, sys',
    `spec = importlib.util.spec_from_file_location("pd", r"${SKRIPT}")`,
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'echt = m.sha256_datei',
    'def wandernd(pfad, block=m.BLOCK):',
    '    h, gelesen, vorher, nachher = echt(pfad)',
    '    class Gefaelscht:',
    '        st_size = vorher.st_size',
    '        st_mtime_ns = vorher.st_mtime_ns + 1',
    '    return h, gelesen, vorher, Gefaelscht',
    'm.sha256_datei = wandernd',
    'try:',
    `    m.digest(r"${datei.replace(/\\/g, '\\\\')}")`,
    '    print("KEIN ABBRUCH")',
    'except m.DigestAbbruch as f: print("ABBRUCH:" + str(f))',
  ].join('\n')], { encoding: 'utf8' });
  assert.match(r.stdout, /^ABBRUCH:/m,
    'eine laengengleiche Aenderung waehrend des Lesens muss brechen');
  assert.match(r.stdout, /waehrend des Lesens geschrieben/);
});
