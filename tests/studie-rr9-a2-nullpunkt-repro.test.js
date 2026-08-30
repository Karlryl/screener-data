'use strict';

// RR9-A2 Schritt 2 - die Reproduktion des V0-Nullpunkts (_COURT-RR9-2026-08-30,
// Anker umgehaengt durch ENTSCHIED 130: 292/438 statt 326/365).
//
// Drei Dinge werden hier gepinnt, alle am OBJEKT:
//  1. Der Selbsttest laeuft und jede seiner Rot-Proben ist NAMENTLICH da. Eine
//     Probe, die still verschwindet, ist sonst nicht von einer bestandenen zu
//     unterscheiden.
//  2. Der Blindheitszaun dieses Moduls, strukturell: es darf `ampel_fuer` nicht
//     erreichen (aus zwei Zaehlungen eine Bewertung machen IST das Tor) und die
//     verbreiterte Konzeptliste nicht laden (ihre Zaehlung IST F4).
//  3. Das Berichts-Artefakt traegt den Anker 292/438 und keine Bewertung.
//
// Warum dieses Modul ueberhaupt getrennt von studie-rr9-nullpunkt.py lebt: dort
// pinnt tests/studie-rr9-nullpunkt.test.js die UNERREICHBARKEIT von
// `arm_zaehlen`, `signale` und `erst_ereignisse`. Diese Reproduktion braucht
// genau die - im selben Modul haette sie den Waechter des B2-Trockenlaufs
// entwertet.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const python = process.env.PYTHON || 'python';
const skript = path.join(__dirname, '..', 'scripts', 'studie-rr9-a2-nullpunkt-repro.py');

const selbst = spawnSync(python, [skript, 'selbsttest'], { encoding: 'utf8' });
// `error` gehoert in die Meldung: findet die Shell `python` nicht, sind stdout
// und stderr LEER und die Zusicherung schwiege ueber den einzigen Grund.
assert.equal(selbst.status, 0, `${selbst.error || ''}${selbst.stdout}${selbst.stderr}`);
assert.match(selbst.stdout, /selbsttest: \d+ ok, 0 FAIL/);

// Die Proben, die OHNE den lokalen Zwischenstand laufen - also auch im CI.
for (const probe of [
  'Anker: E3-Bericht bestaetigt die Konstante 292/438/0',
  'Anker: das Ziel ist S-U, nicht S-G',
  'ROT-PROBE Anker: verstellter E3-Bericht -> Abbruch',
  'ROT-PROBE Zaun: panel-validierung.sqlite -> Abbruch',
  'ROT-PROBE Zaun: panel-endtest.sqlite.enc -> Abbruch',
  'ROT-PROBE Zaun: endtest.key -> Abbruch',
  'Gegenprobe Zaun: der Zwischenstand selbst geht durch',
  'ROT-PROBE Bericht: ein eingeschmuggeltes Quoten-Feld faellt auf',
  'Gegenprobe Bericht: reine Zaehlungen sind erlaubt',
  'Nullpunkt: der registrierte Wert geht durch (Anwesenheit)',
  'ROT-PROBE Nullpunkt: 291 statt 292 -> Stopp',
]) {
  assert.ok(selbst.stdout.includes(`ok   ${probe}`), `Probe fehlt oder rot: ${probe}`);
}

// Die teuren Proben laufen nur, wo der Zwischenstand liegt (lokal, nicht im CI).
// Entweder sind sie ALLE gruen - oder der Lauf hat sie ausdruecklich als
// uebersprungen gemeldet. Ein stilles Fehlen ist beides nicht.
const teuer = [
  'REPRODUKTION: 292/438 bit-gleich auf dem Zwischenstand',
  'REPRODUKTION: der Zwischenstand ist byte-identisch geblieben',
  'ROT-PROBE Zaehlparameter: Perzentil 94 -> Stopp',
  'ROT-PROBE Allowlist: verkuerzte Liste -> Stopp',
];
if (selbst.stdout.includes('REPRODUKTION uebersprungen')) {
  // Und uebersprungen werden darf sie NUR, weil niemand einen Speicherort
  // genannt hat. Jede andere Begruendung waere die stille Luege.
  assert.match(selbst.stdout, /REPRODUKTION uebersprungen: Speicherort unbekannt/);
  for (const probe of teuer) {
    assert.ok(!selbst.stdout.includes(probe), `uebersprungen gemeldet, aber ${probe} lief doch`);
  }
} else {
  for (const probe of teuer) {
    assert.ok(selbst.stdout.includes(`ok   ${probe}`), `Probe fehlt oder rot: ${probe}`);
  }
}

// ROT-PROBE zur Ueberspring-Regel: ein GESETZTER, aber leerer Speicherort darf
// nicht als "nicht im CI" durchgehen. Vorher meldete genau dieser Fall
// "0 FAIL", ohne je etwas reproduziert zu haben - ein gruener Selbsttest, der
// die eine Sache nicht getan hatte, fuer die es ihn gibt.
{
  const leer = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'rr9-leer-'));
  try {
    const lauf = spawnSync(python, [skript, 'selbsttest'], {
      encoding: 'utf8', env: { ...process.env, EARLY_DETECTION_DATA_ROOT: leer },
    });
    assert.notEqual(lauf.status, 0, 'leerer Speicherort kommt still durch');
    assert.match(
      `${lauf.stdout}${lauf.stderr}`, /der Speicherort ist benannt, aber unter/,
      'der Abbruch nennt nicht den Grund',
    );
    assert.ok(!lauf.stdout.includes('REPRODUKTION uebersprungen'),
      'ein leerer Speicherort wird immer noch als CI-Fall ausgegeben');
  } finally {
    fs.rmSync(leer, { recursive: true, force: true });
  }
}

// -- Der Blindheitszaun, strukturell ------------------------------------------
// Geprueft wird der AST, nicht der Text: Kommentare und Berichtstexte DUERFEN
// die verbotenen Namen nennen - sie erklaeren ja gerade, warum sie fehlen.
const gelesen = spawnSync(python, ['-c', [
  'import ast, io, json, sys',
  'src = io.open(sys.argv[1], encoding="utf-8").read()',
  'baum = ast.parse(src)',
  'n, s = set(), set()',
  'for k in ast.walk(baum):',
  '    if isinstance(k, ast.Name): n.add(k.id)',
  '    elif isinstance(k, ast.Attribute): n.add(k.attr)',
  '    elif isinstance(k, (ast.Import, ast.ImportFrom)):',
  '        n.update(a.name for a in k.names)',
  '    elif isinstance(k, ast.Constant) and isinstance(k.value, str): s.add(k.value)',
  'print(json.dumps({"namen": sorted(n), "texte": sorted(s)}))',
].join('\n'), skript], { encoding: 'utf8' });
assert.equal(gelesen.status, 0, gelesen.stderr);
const { namen, texte } = JSON.parse(gelesen.stdout);

const erreichbar = new Set(namen);
for (const verboten of ['ampel_fuer', 'b2_trockenlauf', 'quellen_aus_konzeptliste',
  'KONZEPTLISTE_2_1_0']) {
  assert.ok(!erreichbar.has(verboten),
    `Die Reproduktion erreicht ${verboten} - damit waere sie keine reine Zaehlung mehr`);
}
// Und der Zaehlpfad, den sie BRAUCHT, muss auch wirklich da sein. Ein Modul, das
// arm_zaehlen gar nicht mehr aufruft, erfuellt die Auflage nicht - es taeuscht sie.
for (const noetig of ['arm_zaehlen', 'firmenreihen', 'signale', 'pit_reduktion']) {
  assert.ok(erreichbar.has(noetig), `Die Reproduktion ruft ${noetig} nicht - dann ist es keine`);
}
// Kein String-Literal zeigt auf die verbreiterte Konzeptliste. Wer sie spaeter
// hereinholt, faellt hier auf, bevor der Lauf F4 beginnt.
for (const text of texte) {
  assert.ok(!text.toLowerCase().includes('konzeptliste.json'),
    `Die Reproduktion nennt die verbreiterte Konzeptliste als Pfad: ${text}`);
}

// DIE LUECKE DES NAMENS-ZAUNS, geschlossen: `getattr(zp, "ampel_fuer")` steht
// nirgends als Name im Syntaxbaum - es ist eine Zeichenkette. Der Zaun oben
// haette so einen Aufruf durchgelassen (nachgestellt und gesehen, bevor das
// hier stand). Statt jede verbotene Kennung zusaetzlich als String zu suchen -
// der Docstring nennt sie ja absichtlich - wird die AUFLOESUNGSART verboten:
// dieses Modul loest nichts dynamisch auf, und das ist eine kleine, eindeutige
// Flaeche.
const DYNAMISCH = ['getattr', 'globals', 'locals', 'vars', 'eval', 'exec', '__import__'];
for (const verboten of DYNAMISCH) {
  assert.ok(!erreichbar.has(verboten),
    `Die Reproduktion loest mit ${verboten} dynamisch auf - damit ist der Namens-Zaun blind`);
}

// Und der geschlossene Zaun muss auch wirklich zubeissen. Bruchprobe an einer
// Kopie: derselbe verbotene Aufruf, per String-Dispatch eingeschmuggelt.
{
  const quelle = fs.readFileSync(skript, 'utf8');
  const anker = '    return {\n        "fallzahl": arm["fallzahl"],';
  assert.ok(quelle.includes(anker), 'Sabotage-Anker nicht gefunden');
  const sabotiert = quelle.replace(
    anker, `    getattr(zp, "ampel_fuer")(arm["fallzahl"], 0.9, 0.9)\n${anker}`,
  );
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'rr9-ast-'));
  try {
    const ziel = path.join(dir, 'sabotiert.py');
    fs.writeFileSync(ziel, sabotiert, 'utf8');
    const gelesen2 = spawnSync(python, ['-c', [
      'import ast, io, json, sys',
      'n = set()',
      'for k in ast.walk(ast.parse(io.open(sys.argv[1], encoding="utf-8").read())):',
      '    if isinstance(k, ast.Name): n.add(k.id)',
      '    elif isinstance(k, ast.Attribute): n.add(k.attr)',
      'print(json.dumps(sorted(n)))',
    ].join('\n'), ziel], { encoding: 'utf8' });
    assert.equal(gelesen2.status, 0, gelesen2.stderr);
    const sabotierteNamen = new Set(JSON.parse(gelesen2.stdout));
    // Der alte Zaun bleibt gruen - das ist der BEFUND, hier festgenagelt.
    assert.ok(!sabotierteNamen.has('ampel_fuer'),
      'der String-Dispatch taucht doch als Name auf - dann misst diese Probe etwas anderes');
    // Der neue Zaun wird rot.
    assert.ok(DYNAMISCH.some((d) => sabotierteNamen.has(d)),
      'der Aufloesungsart-Zaun sieht den eingeschmuggelten Aufruf nicht');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// -- Das Artefakt --------------------------------------------------------------
const bericht = path.join(__dirname, '..', 'reports', 'studie',
  'RR9-A2-nullpunkt-reproduktion-2026-08-30.json');
if (fs.existsSync(bericht)) {
  const b = JSON.parse(fs.readFileSync(bericht, 'utf8'));
  assert.equal(b.bitGleich, true);
  assert.deepEqual(b.gemessen, {
    fallzahl: 292, firmen_mit_erst_ereignis: 438, zensierte_erst_ereignisse: 0,
  });
  assert.deepEqual(b.registrierterNullpunkt, b.gemessen);
  assert.equal(b.allowlistAlsParameter, true);
  assert.equal(b.eintretendeKohorteGemessen, false);
  // Der Anker gehoert dem Entscheid, nicht dem Bauenden - und die Kipp-Bedingung
  // reist mit. Wer sie spaeter herausnimmt, faellt hier auf.
  assert.match(b.anker, /292\/438 \(S-U, umsatzQuellenAllowlist\), NICHT 326\/365/);
  assert.match(b.kipp, /wird umverankert; die B3'-Tests machen die Umverankerung billig/);
  assert.match(b.grenze, /Panel -> Zwischenstand \(lade_berichte \+ lies_rohwerte\) ist NICHT nachgefahren/);
  const flach = JSON.stringify(b);
  for (const verboten of ['"auffindbarkeit"', '"ampel"', '"reifequote"', '"verhaeltnis"']) {
    assert.ok(!flach.includes(verboten), `Reproduktions-Bericht traegt ${verboten}`);
  }
}

console.log('studie-rr9-a2-nullpunkt-repro.test.js: PASS');
