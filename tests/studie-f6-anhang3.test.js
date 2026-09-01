'use strict';

// ANHANG 3 — die sieben Bruchproben (F6-C9f: vier · F6-C13f: drei).
//
// Abnahmebedingung: ohne Protokoll gelten Bein 3 und die Variantenpruefung als
// NICHT ABGENOMMEN. Jede Probe bricht ihren Riegel WIRKLICH — verstuemmelt
// wird immer eine KOPIE in einem Temp-Ort, die Dateien im Repo bleiben
// byte-unberuehrt.
//
// KEIN TEST FASST EIN PANEL AN.
//
// Usage: node tests/studie-f6-anhang3.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const python = process.env.PYTHON || 'python';
const REPO = path.join(__dirname, '..');
const ZAEHLWERK = path.join(REPO, 'scripts', 'studie-f6-zaehlwerk.py');
const LAEUFER = path.join(REPO, 'scripts', 'studie-f6-lauf.py');
const KLUMPEN_SE = path.join(REPO, 'scripts', 'studie-f6-klumpen-se.py');
const QUELLE_LF = fs.readFileSync(LAEUFER, 'utf8');

function tempdir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const r = (p) => p.replace(/\\/g, '\\\\');

// Faehrt eine ABSICHTLICH VERSTUEMMELTE Kopie. Das Original bleibt unberuehrt.
function gebrochen(quelle, ersetzungen, zeilen) {
  const tmp = tempdir('f6a3-bruch-');
  let text = fs.readFileSync(quelle, 'utf8');
  for (const [alt, neu] of ersetzungen) {
    assert.ok(text.includes(alt), `Bruch-Anker fehlt: ${alt.slice(0, 70)}`);
    text = text.replace(alt, neu);
  }
  const ziel = path.join(tmp, path.basename(quelle));
  fs.writeFileSync(ziel, text, 'utf8');
  const lauf = spawnSync(python, ['-c', [
    'import importlib.util',
    `spec = importlib.util.spec_from_file_location("g", r"${r(ziel)}")`,
    'g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)',
    // Die Kopie liegt im Temp-Ort; WURZEL_REPO kaeme sonst aus IHREM Pfad und
    // die Protokoll-Artefakte waeren nicht auffindbar. Gebrochen wird der
    // RIEGEL, nicht die Umgebung.
    `g.WURZEL_REPO = r"${r(REPO)}"`,
  ].concat(zeilen).join('\n')], { encoding: 'utf8' });
  assert.equal(lauf.status, 0, 'Python ist rot: ' + (lauf.stderr || ''));
  return lauf.stdout;
}

// Faehrt den unveraenderten Laeufer.
function py(zeilen) {
  const lauf = spawnSync(python, ['-c', [
    'import importlib.util',
    `spec = importlib.util.spec_from_file_location("m", r"${r(LAEUFER)}")`,
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
  ].concat(zeilen).join('\n')], { encoding: 'utf8' });
  assert.equal(lauf.status, 0, 'Python ist rot: ' + (lauf.stderr || ''));
  return lauf.stdout;
}

const NICHTS = [['# ', '# ']];   // "gebrochen" ohne Bruch: der intakte Lauf

const ARM_FIXTURE = [
  'je_arm = {"signal": {}, "kontrollpool": {}, "differenz_punkte": {',
  '    "wert": 0.0, "maxDifferenzPunkte": 10, "erfuellt": True, "quelle": "q",',
  '    "tor": {"verdikt": "TOR GEHALTEN", "weiter": 1, "grund": "g"}}}',
];

// ── F6-C9f/1 — ein Zeichen im Eintrag-24-Literal ───────────────────────────
test('F6-C9f/1 ein verstelltes Zeichen im Eintrag-24-Literal bricht Bein 3 ab', () => {
  const aus = gebrochen(ZAEHLWERK, [[
    'stillschweigend fallengelassen")',
    'stillschweigend fallengelassenX")']], [
    'try:',
    '    g.aequivalenz_bein3()',
    '    print("KEIN ABBRUCH")',
    'except g.ZaehlwerkAbbruch as f:',
    '    print("ABBRUCH:" + str(f)[:400].replace("\\n", " "))',
  ]);
  assert.match(aus, /^ABBRUCH:BEIN 3 gerissen in Gruppe eintrag24_wortlaut/m);
  assert.match(aus, /nie_stillschweigend/);
});

// ── F6-C9f/2 — ein Schluessel FAELLT AUS der Pruefmenge ────────────────────
// Der Waechter, der den urspruenglichen stillen Ausschluss gefangen haette:
// frueher blieb die Zahl "fuenf" wahr ueber einer falschen Menge.
test('F6-C9f/2 ein aus der Pruefmenge entfernter Schluessel wird NAMENTLICH gemeldet', () => {
  const aus = gebrochen(ZAEHLWERK, [[
    '"literale": ("nie_stillschweigend",),',
    '"literale": (),']], [
    'try:',
    '    g.aequivalenz_bein3()',
    '    print("KEIN ABBRUCH - die Menge waere still geschrumpft")',
    'except g.ZaehlwerkAbbruch as f: print("ABBRUCH:" + str(f)[:90])',
  ]);
  assert.match(aus, /^ABBRUCH:BEIN 3 MENGENGLEICHHEIT GERISSEN/m);
  assert.match(aus, /nie_stillschweigend/,
    'der herausgefallene Schluessel muss namentlich gemeldet werden');
});

// ── F6-C9f/3 — der Guard gegen die Einheit ohne Kennung ────────────────────
test('F6-C9f/3 ohne den Guard wird eine Einheit ohne Kennung stillschweigend uebersprungen', () => {
  const treiber = [
    'class ZP:',
    '    @staticmethod',
    '    def ist_zensiert(e, e2, rr): return False',
    'class E2: pass',
    'try:',
    '    g._tally([{"cik": None}], [], E2(), ZP(), 0, "probe")',
    '    print("KEIN ABBRUCH")',
    'except g.ZaehlwerkAbbruch as f: print("ABBRUCH:" + str(f)[:60])',
    'except Exception as f: print("ANDERS:" + type(f).__name__)',
  ];
  const intakt = gebrochen(ZAEHLWERK, NICHTS, treiber);
  assert.match(intakt, /^ABBRUCH:Eine Nennereinheit ohne Klumpen-Kennung/m,
    'intakt MUSS der Guard feuern');
  const ohne = gebrochen(ZAEHLWERK, [[
    'raise ZaehlwerkAbbruch(\n'
    + '                "Eine Nennereinheit ohne Klumpen-Kennung in " + wo\n'
    + '                + ". Sie wird nie stillschweigend fallengelassen - das ist ein "\n'
    + '                "ABBRUCH, kein Filter.")',
    'pass']], treiber);
  assert.doesNotMatch(ohne, /^ABBRUCH:Eine Nennereinheit/m,
    'ohne den Guard kommt KEIN Abbruch mehr - genau das ist der Schaden');
});

// ── F6-C9f/4 — die Kreuzprobe Summe_g n_g == N ─────────────────────────────
test('F6-C9f/4 ohne die Kreuzprobe faellt ein falsches N nicht mehr auf', () => {
  const treiber = [
    'try:',
    '    g.klumpen_se([(3, 3), (4, 4)], 99, 7)',
    '    print("KEIN ABBRUCH")',
    'except Exception as f: print("ABBRUCH:" + str(f)[:70])',
  ];
  const intakt = gebrochen(KLUMPEN_SE, NICHTS, treiber);
  assert.match(intakt, /^ABBRUCH:F6-SE-KLUMPEN-ABBRUCH: Summe_g n_g = 7/m,
    'intakt MUSS die Kreuzprobe feuern');
  const ohne = gebrochen(KLUMPEN_SE, [[
    '"F6-SE-KLUMPEN-ABBRUCH: Summe_g n_g = " + str(n_summe)',
    '"HARMLOS " + str(n_summe)']], treiber);
  assert.doesNotMatch(ohne, /F6-SE-KLUMPEN-ABBRUCH: Summe_g n_g/,
    'ohne die Kreuzprobe bleibt das falsche N unbemerkt');
});

// ── F6-C13f/1 — unregistrierter Unterschluessel ────────────────────────────
test('F6-C13f/1 ein unregistrierter Unterschluessel bricht ab', () => {
  const aus = py(ARM_FIXTURE.concat([
    'm.pruefe_variantensatz(je_arm, "daten.S-U")',
    'print("SAUBER:ok")',
    'je_arm["differenz_punkte"]["tor"]["erfunden"] = 1',
    'try:',
    '    m.pruefe_variantensatz(je_arm, "daten.S-U")',
    '    print("KEIN ABBRUCH")',
    'except m.LaufAbbruch as f: print("ABBRUCH:" + str(f)[:80])',
  ]));
  assert.match(aus, /^SAUBER:ok$/m, 'die ratifizierte Form muss durchgehen');
  assert.match(aus,
    /^ABBRUCH:UNGELISTETER SCHLUESSEL erfunden in daten\.S-U\.differenz_punkte\.tor/m);
});

// ── F6-C13f/2 — entfernter Pflicht-Unterschluessel ─────────────────────────
test('F6-C13f/2 ein entfernter Pflicht-Unterschluessel bricht ab', () => {
  const aus = py(ARM_FIXTURE.concat([
    'del je_arm["differenz_punkte"]["tor"]["weiter"]',
    'try:',
    '    m.pruefe_variantensatz(je_arm, "daten.S-U")',
    '    print("KEIN ABBRUCH")',
    'except m.LaufAbbruch as f: print("A:" + str(f)[:70])',
    'je_arm2 = {"signal": {}, "kontrollpool": {}}',
    'try:',
    '    m.pruefe_variantensatz(je_arm2, "daten.S-U")',
    '    print("KEIN ABBRUCH 2")',
    'except m.LaufAbbruch as f: print("B:" + str(f)[:70])',
  ]));
  assert.match(aus,
    /^A:PFLICHTSCHLUESSEL FEHLT: weiter in daten\.S-U\.differenz_punkte\.tor/m);
  assert.match(aus, /^B:PFLICHTSCHLUESSEL FEHLT: differenz_punkte in daten\.S-U/m,
    'die Zweiseitigkeit muss auch ein VERSCHWUNDENES differenz_punkte fangen');
});

// ── F6-C13f/3 — Strukturprobe: keine Ausnahme nach Namen mehr ──────────────
test('F6-C13f/3 auf dem Variantenpfad existiert KEINE Ausnahme nach Namen', () => {
  const fn = QUELLE_LF.slice(QUELLE_LF.indexOf('def pruefe_variantensatz'),
    QUELLE_LF.indexOf('def pruefe_ausgabesatz'));
  assert.ok(fn.length > 200, 'die Funktion wurde nicht gefunden');
  assert.doesNotMatch(fn, /- \{"/, 'keine Mengen-Ausnahme per Literal');
  assert.doesNotMatch(fn, /!= "tor"/, 'keine Ausnahme nach Namen');
  assert.doesNotMatch(QUELLE_LF, /- \{"tor"\}/,
    'die alte Literal-Ausnahme ist ersatzlos gefallen');
  // Positiv: beide Richtungen sind wirklich da.
  assert.match(fn, /set\(ist\) - soll/);
  assert.match(fn, /soll - set\(ist\)/);
  // Und die Emissionsstelle ruft beide Wachposten wirklich.
  assert.match(QUELLE_LF, /pruefe_variantensatz\(je_arm, "daten\." \+ variante\)/);
  assert.match(QUELLE_LF, /pruefe_verbotene\(je_arm\["differenz_punkte"\]/);
});

// ── F6-C13c — eingefrorener Text verlaesst die Datenflaeche ────────────────
test('F6-C13c TOR_REGELTEXT und TOR_RICHTUNG stehen in keinem tor-Objekt mehr', () => {
  const ganz = QUELLE_LF.slice(QUELLE_LF.indexOf('def tor_verdikt'),
    QUELLE_LF.indexOf('def pruefe_keine_absolutpfade'));
  // Der Docstring NENNT die beiden Konstanten absichtlich (er erklaert, warum
  // sie fort sind). Geprueft wird deshalb der Rumpf hinter dem Docstring.
  const dq = String.fromCharCode(34).repeat(3);   // Python-Docstring-Marke
  const fn = ganz.slice(ganz.indexOf(dq, ganz.indexOf(dq) + 3) + 3);
  assert.doesNotMatch(fn, /TOR_REGELTEXT|TOR_RICHTUNG/,
    'keine zweite, driftfaehige Kopie eingefrorenen Textes auf der Datenflaeche');
  const aus = py([
    'd = {"wert": 0.0, "maxDifferenzPunkte": 10, "erfuellt": True}',
    'tor = m.tor_verdikt("BESTANDEN", "BESTANDEN", d)',
    'print("KEYS:" + ",".join(sorted(tor)))',
  ]);
  assert.match(aus, /^KEYS:grund,verdikt,weiter$/m);
});
