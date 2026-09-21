'use strict';
/** tests/druckenmiller/import-graph.test.js — Standalone-Runner.
 *
 * DIE ZUSICHERUNG (Mandats-Grenze, screener-data/CLAUDE.md:17-21): kein Weg fuehrt vom
 * Qualitaets-Score in dieses Modul und keiner zurueck. Der Score misst ausschliesslich
 * fundamentale Qualitaet; jedes preisnormierte Signal darin ist ein Mandats-Verstoss.
 * lib/druckenmiller/** rechnet ausschliesslich mit Preisen — es DARF den Boards nie
 * begegnen ausser als Anzeige-Beilage in einer spaeteren Chunk-Stufe.
 *
 * GEPRUEFT WIRD DER ECHTE REQUIRE-GRAPH, nicht eine Namensliste: von jeder Datei unter
 * src/scoring/** und von den beiden Board-Schreibern aus wird der Graph aufgespannt und
 * gegen lib/druckenmiller/ gehalten.
 *
 * scripts/write-findash-export.js STEHT MIT AUF DER SPERRLISTE, obwohl weder BUILD-SPEC
 * noch arch-spec ihn nennen: Anklage A1 (Gericht 2026-09-14, Punkt 3) hat gezeigt, dass
 * genau DIESE Datei die Board-Zeilen schreibt — eine Sperrliste ohne sie haette den
 * kuerzesten Weg offen gelassen.
 *
 * DAZU ZWEI GEGENSTUECKE:
 *   - ROW_FIELDS (write-findash-export.js:135) bekommt kein Momentum-Feld; und weil
 *     `factors`/`axisBreakdown` freie Behaelter sind (A1.3), darf im ganzen Scoring-Baum
 *     ueberhaupt kein "druckenmiller" oder Momentum-Bezeichner auftauchen.
 *   - der Waechter wird auf einem Sabotage-Baum einmal absichtlich ausgeloest.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..', '..');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.message)); }
}

function jsDateien(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...jsDateien(p));
    else if (e.isFile() && e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/**
 * Erreichbare Dateien ab <starts> ueber require('<relativ>'). Nur relative Pfade werden
 * verfolgt — ein Paket aus node_modules kann lib/druckenmiller nicht erreichen.
 */
function erreichbar(starts) {
  const gesehen = new Set();
  const stapel = starts.slice();
  while (stapel.length) {
    const datei = stapel.pop();
    if (gesehen.has(datei) || !fs.existsSync(datei)) continue;
    gesehen.add(datei);
    const quelle = fs.readFileSync(datei, 'utf8');
    for (const m of quelle.matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      let ziel = path.resolve(path.dirname(datei), m[1]);
      if (!fs.existsSync(ziel)) ziel = ziel + '.js';
      if (fs.existsSync(ziel) && fs.statSync(ziel).isDirectory()) ziel = path.join(ziel, 'index.js');
      stapel.push(ziel);
    }
  }
  return gesehen;
}

const SPERRQUELLEN = [
  ...jsDateien(path.join(REPO, 'src', 'scoring')),
  path.join(REPO, 'scripts', 'write-board-history.js'),
  path.join(REPO, 'scripts', 'write-findash-export.js'),
];

test('G1 kein Weg vom Scoring/Board-Schreiber nach lib/druckenmiller', () => {
  const erreicht = [...erreichbar(SPERRQUELLEN)]
    .filter((f) => f.includes(path.join('lib', 'druckenmiller')));
  assert.deepEqual(erreicht, [], 'der Qualitaets-Score erreicht das Preis-Modul — Mandats-Verstoss');
});

test('G2 BRUCHPROBE: derselbe Waechter feuert auf einem Sabotage-Baum', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-graph-'));
  fs.mkdirSync(path.join(dir, 'lib', 'druckenmiller'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'scoring'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'lib', 'druckenmiller', 'internals.js'), 'module.exports = {};\n');
  fs.writeFileSync(path.join(dir, 'lib', 'zwischen.js'),
    "const x = require('./druckenmiller/internals.js');\nmodule.exports = x;\n");
  fs.writeFileSync(path.join(dir, 'src', 'scoring', 'engine.js'),
    "const z = require('../../lib/zwischen.js');\nmodule.exports = z;\n");
  const erreicht = [...erreichbar([path.join(dir, 'src', 'scoring', 'engine.js')])]
    .filter((f) => f.includes(path.join('lib', 'druckenmiller')));
  assert.equal(erreicht.length, 1,
    'der Graph-Waechter sieht einen ZWEISTUFIGEN Weg nicht — dann ist er gegen den realen Fall blind');
});

// G3-Erlaubnisliste als Funktion, damit Meldung und Urteil dieselbe Regel lesen.
function g3Erlaubt(f) {
  return f.includes(path.join('tests', 'druckenmiller'))
    || f.endsWith(path.join('scripts', 'druckenmiller-log-internals.js'))
    || f.endsWith(path.join('scripts', 'write-druckenmiller-export.js'))
    // Chunk 3: der MANUELLE 13F-Quartals-Lauf. Er steht bewusst mit auf dieser Liste und
    // nicht in einem Glob — ein neues Skript soll hier nachgezogen werden, nicht still
    // dazukommen (dieselbe Regel wie bei BLOCKING_GLOBS).
    || f.endsWith(path.join('scripts', 'druckenmiller-13f.js'));
}
const g3Verletzer = (importeure) => importeure.filter((f) => !g3Erlaubt(f));

test('G3 nur der Logger und die eigenen Tests importieren lib/druckenmiller', () => {
  const alle = [
    ...jsDateien(path.join(REPO, 'lib')),
    ...jsDateien(path.join(REPO, 'scripts')),
    ...jsDateien(path.join(REPO, 'src')),
    ...jsDateien(path.join(REPO, 'tests')),
  ];
  const importeure = alle.filter((f) => !f.includes(path.join('lib', 'druckenmiller'))
    && /require\(\s*['"][^'"]*druckenmiller[^'"]*['"]\s*\)/.test(fs.readFileSync(f, 'utf8')));
  // Lane A 20.09. (Nebenbefund): die Meldung listete ALLE Importeure als "unerwartet", auch die
  // erlaubten — im roten Fall musste man den Verletzer selbst heraussuchen. Jetzt nennt sie nur
  // die echten Verletzer; die Erlaubnisliste steht unveraendert in g3Erlaubt().
  const verletzer = g3Verletzer(importeure);
  assert.deepEqual(verletzer, [], 'unerwarteter Importeur: ' + verletzer.join(', '));
  assert.ok(importeure.length >= 3, 'der Waechter findet gar keine Importeure — dann prueft er nichts');
  assert.ok(importeure.some((f) => f.endsWith('druckenmiller-13f.js')),
    'der 13F-Lauf ist kein Importeur mehr — dann ist diese Zeile toter Buchstabe');
});

test('G3b die G3-Meldung nennt nur Verletzer, keine erlaubten Importeure (beide Richtungen)', () => {
  const erlaubt1 = path.join(REPO, 'scripts', 'druckenmiller-log-internals.js');
  const erlaubt2 = path.join(REPO, 'tests', 'druckenmiller', 'x.test.js');
  const fremd = path.join(REPO, 'scripts', 'fremd-importeur.js');
  assert.deepEqual(g3Verletzer([erlaubt1, erlaubt2]), [], 'erlaubte Importeure duerfen nicht als Verletzer gelten');
  assert.deepEqual(g3Verletzer([erlaubt1, fremd, erlaubt2]), [fremd], 'genau der fremde Importeur, nicht die erlaubten');
});

test('G4 ROW_FIELDS bekommt kein Preis-/Momentum-Feld', () => {
  const quelle = fs.readFileSync(path.join(REPO, 'scripts', 'write-findash-export.js'), 'utf8');
  const zeile = quelle.split('\n').find((l) => l.includes('const ROW_FIELDS'));
  assert.ok(zeile, 'ROW_FIELDS nicht gefunden — der Anker hat sich verschoben, der Waechter ist blind');
  const felder = (zeile.match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1));
  const verboten = felder.filter((f) => /druckenmiller|momentum|m1|m2|confirm|chart|rs63|breadth/i.test(f));
  assert.deepEqual(verboten, [], 'ein preisnormiertes Feld ist in die Board-Zeilen gewandert');
  assert.ok(felder.includes('sector'), 'die Feldliste wurde nicht wirklich gelesen');
});

test('G5 A1.3: auch die freien Behaelter bleiben sauber — kein "druckenmiller" im Scoring-Baum', () => {
  // `factors` und `axisBreakdown` sind freie Objekte (score.js:1394-1402); ein Momentum-Wert
  // koennte DARIN in die Board-Zeilen kommen, ohne ROW_FIELDS anzufassen. Deshalb prueft
  // dieser Waechter nicht die Feldliste, sondern den Quelltext der Erzeuger.
  const treffer = SPERRQUELLEN.filter((f) => /druckenmiller/i.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(treffer, [], 'der Scoring-/Board-Baum nennt das Modul beim Namen');
});

test('G6 ROW_FIELDS ist byte-identisch mit dem eingefrorenen Stand', () => {
  // Ein Schnappschuss statt einer Musterpruefung: G4 faengt nur Felder, die nach Preis
  // KLINGEN. Ein neutral benanntes Feld ("signal", "tempo") kaeme durch. Der Vergleich
  // gegen die eingefrorene Liste faengt JEDE Aenderung — und wer sie legitim braucht,
  // aendert die Fixture bewusst mit und begruendet es im Commit.
  const quelle = fs.readFileSync(path.join(REPO, 'scripts', 'write-findash-export.js'), 'utf8');
  const zeile = quelle.split('\n').find((l) => l.includes('const ROW_FIELDS'));
  const felder = (zeile.match(/'([^']+)'/g) || []).map((x) => x.slice(1, -1));
  const eingefroren = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'fixtures', 'row-fields.snapshot.json'), 'utf8'));
  assert.deepEqual(felder, eingefroren,
    'ROW_FIELDS hat sich geaendert. Das ist der Vertrag der Board-Zeilen — jede Aenderung '
    + 'gehoert bewusst in tests/druckenmiller/fixtures/row-fields.snapshot.json nachgezogen.');
});

test('G7 A1.3 WEISSE LISTE: kein Schluessel in den ausgelieferten Zeilen, der nicht eingefroren ist', () => {
  // Eine SPERRLISTE ("nichts, was nach Momentum klingt") faengt nur, was man vorher
  // benennen konnte — ein neutral getaufter Preis-Wert ("tempo", "signal") kaeme in den
  // freien Behaeltern `factors`/`axisBreakdown` durch. Deshalb andersherum: die
  // Schluesselmenge der ganzen Auslieferung wird gegen einen eingefrorenen Stand
  // gehalten, und JEDER neue Schluessel ist rot, bis ihn jemand bewusst eintraegt.
  const eingefroren = new Set(JSON.parse(fs.readFileSync(
    path.join(__dirname, 'fixtures', 'v1-row-keys.snapshot.json'), 'utf8')));
  const fremd = new Set();
  const lauf = (v) => {
    if (Array.isArray(v)) return v.forEach(lauf);
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) { if (!eingefroren.has(k)) fremd.add(k); lauf(x); }
  };
  // Der Waechter selbst wird IMMER geprueft (Sabotage-Objekt) — auch dort, wo es die
  // Auslieferung gar nicht gibt (PR-Check ohne outputs/).
  lauf({ rows: [{ factors: { tempo: 0.4 } }] });
  assert.deepEqual([...fremd], ['tempo'],
    'der Tiefen-Lauf sieht einen neu erfundenen Schluessel IM freien Behaelter nicht — dann ist '
    + 'er blind fuer genau den Weg, den Anklage A1.3 beschreibt');
  fremd.clear();
  const wurzel = path.join(REPO, 'outputs', 'findash-export', 'v1');
  if (!fs.existsSync(wurzel)) {
    console.log('       (keine Auslieferung auf der Platte — nur der Waechter selbst geprueft)');
    return;
  }
  // AUSGENOMMEN: v1/druckenmiller/ (Chunk 1). Der Unterordner traegt eine EIGENE
  // Schema-Id (findash-druckenmiller/v1), einen eigenen --check und eine eigene weisse
  // Liste (scripts/write-druckenmiller-export.js, tests/druckenmiller/write-export.test.js);
  // BUILD-SPEC §1 verlangt genau diese Trennung ("shared fixture untouched"). Seine ~35
  // Schluessel in DIESE Fixture zu ziehen waere die Umkehrung des Waechters: `l1`, `asOf`
  // oder `freshShare` waeren danach auch in einer BOARD-Zeile erlaubt. Der Ausschluss ist
  // eng — er nennt genau ein Verzeichnis, und der Gegen-Test unten prueft das.
  const AUSGENOMMEN = 'druckenmiller';
  const dateien = [];
  const uebersprungen = [];
  const sammle = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === AUSGENOMMEN) { uebersprungen.push(f); continue; }
        sammle(f);
      } else if (e.name.endsWith('.json')) dateien.push(f);
    }
  };
  sammle(wurzel);
  // Gegen-Test zum Ausschluss: er darf NUR diesen einen Ordner treffen. Liegt er da,
  // muss er auch wirklich uebersprungen worden sein — und nichts sonst.
  assert.ok(uebersprungen.length <= 1, 'der Ausschluss trifft mehr als einen Ordner: ' + uebersprungen);
  if (fs.existsSync(path.join(wurzel, AUSGENOMMEN))) {
    assert.equal(uebersprungen.length, 1, 'der Druckenmiller-Ordner liegt da, wurde aber mitgezaehlt');
    assert.ok(dateien.every((f) => !f.includes(path.sep + AUSGENOMMEN + path.sep)));
    assert.ok(dateien.some((f) => f.includes('overview.json') || f.includes('index.json')),
      'nach dem Ausschluss sieht der Waechter die Board-Auslieferung nicht mehr — dann prueft er nichts');
  }
  for (const f of dateien) {
    let j; try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
    lauf(j);
  }
  assert.deepEqual([...fremd].sort(), [],
    'neue Schluessel in der Auslieferung. Legitim? Dann bewusst nach '
    + 'tests/druckenmiller/fixtures/v1-row-keys.snapshot.json nachziehen und im Commit begruenden.');
  assert.ok(dateien.length > 5, 'der Tiefen-Lauf hat kaum Dateien gesehen: ' + dateien.length);
});

test('G8 der TAGESLAUF erreicht die Rechenwege der Lesung nicht ([REV10-5], Chunk 2)', () => {
  // Warum das ein Waechter ist und keine Stilfrage: eine MDE, die taeglich berechnet werden
  // KANN, wird irgendwann taeglich angesehen — und eine Vorregistrierung, die man taeglich
  // ansieht, ist keine. Deshalb darf kein Weg von den beiden Tages-Skripten nach
  // scoreboard-read.js fuehren; nur der Lese-Job darf das Modul laden.
  const TAGESPFAD = [
    path.join(REPO, 'scripts', 'druckenmiller-log-internals.js'),
    path.join(REPO, 'scripts', 'write-druckenmiller-export.js'),
  ];
  const leseModul = path.join(REPO, 'lib', 'druckenmiller', 'scoreboard-read.js');
  assert.ok(fs.existsSync(leseModul), 'das Lese-Modul fehlt — dann prueft dieser Waechter nichts');
  const erreicht = [...erreichbar(TAGESPFAD)].filter((f) => f === leseModul);
  assert.deepEqual(erreicht, [], 'ein Tages-Skript erreicht scoreboard-read.js');
  // Gegenprobe, dass der Waechter ueberhaupt etwas sieht: der Tagespfad MUSS die anderen
  // Modul-Dateien erreichen, sonst laeuft der Graph ins Leere.
  const andere = [...erreichbar(TAGESPFAD)].filter((f) => f.includes(path.join('lib', 'druckenmiller')));
  assert.ok(andere.length >= 3, 'der Graph sieht den Tagespfad nicht: ' + andere.length);
});

test('G9 BRUCHPROBE: derselbe Waechter feuert, wenn der Tageslauf das Lese-Modul zieht', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-callpath-'));
  fs.mkdirSync(path.join(dir, 'lib', 'druckenmiller'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'lib', 'druckenmiller', 'scoreboard-read.js'), 'module.exports = {};\n');
  fs.writeFileSync(path.join(dir, 'lib', 'druckenmiller', 'tafel.js'),
    "module.exports = require('./scoreboard-read.js');\n");
  fs.writeFileSync(path.join(dir, 'scripts', 'write-druckenmiller-export.js'),
    "module.exports = require('../lib/druckenmiller/tafel.js');\n");
  const erreicht = [...erreichbar([path.join(dir, 'scripts', 'write-druckenmiller-export.js')])]
    .filter((f) => f.endsWith('scoreboard-read.js'));
  assert.equal(erreicht.length, 1, 'der Call-Path-Waechter sieht einen zweistufigen Weg nicht');
});

console.log('\nimport-graph.test.js: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
