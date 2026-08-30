'use strict';

// VB-A1..VB-A8 (_COURT-VIERBANK-OFFEN23-2026-08-30, ratifiziert als ENTSCHIED 136).
//
// Der Waechter pinnt das OBJEKT, nicht den Meldungstext: geprueft wird, welche
// Sanktion jede der sieben B3'-Pruefungen WIRKLICH auswirft, und welchen
// Ausgang der Prozess dabei nimmt. Wer die Spaltung spaeter glattzieht - beide
// Zweige auf eine Konstante, den Zaehler entfernt, die Sperrklausel entschaerft
// - faellt hier auf, egal wie der Text danach lautet.
//
// DIE DREI SAETZE, DIE HIER NICHT VERHANDELBAR SIND:
//  1. ANKER  -> BEERDIGEN, automatisch, ohne jede Ausnahme (Ausgang 5).
//  2. DRIFT  -> STOPP beim ERSTEN Feuern (Ausgang 6); das ZWEITE Feuern -
//     gleiche oder andere Ursache - ist BEERDIGEN, automatisch.
//  3. VB-A8: keine Lage mit weniger als ZWEI automatischen Beerdigungsregeln
//     jenseits F3 ist erreichbar, ohne dass diese Pruefung rot wird.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const python = process.env.PYTHON || 'python';
const wurzel = path.join(__dirname, '..');
const skript = path.join(wurzel, 'scripts', 'studie-rr9-nullpunkt.py');

const EXIT_BEERDIGEN = 5;
const EXIT_STOPP = 6;

// Ein Aufruf des Waechters mit einer zur Laufzeit "geladenen" Liste. Das ist
// der echte Eintrittspunkt (Unterbefehl `tripwire`), nicht eine nachgebaute
// Kopie davon: die Messebene gehoert zur Pruefung.
function tripwire(liste, umgebung) {
  const datei = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vb-b3-')), 'liste.json');
  fs.writeFileSync(datei, JSON.stringify(liste));
  return spawnSync(python, [skript, 'tripwire', '--liste', datei],
    { encoding: 'utf8', env: { ...process.env, ...(umgebung || {}) } });
}

const registriert = JSON.parse(spawnSync(python, ['-c', [
  'import importlib.util, json, sys',
  's = importlib.util.spec_from_file_location("np", sys.argv[1])',
  'm = importlib.util.module_from_spec(s); s.loader.exec_module(m)',
  'print(json.dumps(list(m.registrierte_allowlist())))',
].join('\n'), skript], { encoding: 'utf8' }).stdout);
assert.ok(registriert.length > 0, 'die registrierte Allowlist ist leer');

// -- 1. ANWESENHEIT: die registrierte Liste geht durch, Ausgang 0 -----------
{
  const r = tripwire(registriert);
  assert.equal(r.status, 0, r.stdout + r.stderr);
}

// -- 2. DRIFT, erstes Feuern: STOPP und Ausgang 6, NICHT Beerdigung ---------
for (const [name, liste] of [
  ['ein geaenderter Eintrag', [registriert[0] + 'X', ...registriert.slice(1)]],
  ['umsortierte Liste', [...registriert].reverse()],
]) {
  const r = tripwire(liste);
  assert.equal(r.status, EXIT_STOPP,
    `DRIFT (${name}) muss mit ${EXIT_STOPP} enden, kam mit ${r.status}: ${r.stderr}`);
  assert.match(r.stderr, /B3'-DRIFT-ABBRUCH \(STOPP\)/);
  assert.ok(!r.stderr.includes("B3'-ANKER-ABBRUCH"),
    'ein DRIFT-Bruch darf nie als ANKER-Bruch gemeldet werden');
  // VB-A4: der Vollzug hat keinen Ermessensraum und steht in der Meldung.
  for (const pflicht of [
    'sofortiger Halt VOR jedem geschuetzten Zugriff',
    'Vorfall veroeffentlichen',
    'AUSSCHLIESSLICH die registrierte Bit-Identitaet wiederherstellen',
    'SERVER-BESTAETIGT',
    'gilt automatisch BEERDIGEN',
    'KONTINGENT EINS',
    // VB-A5: Nichtentscheidung ist ein benannter Akt.
    'beerdigt durch Nichtentscheidung des Orchestrators am',
  ]) {
    assert.ok(r.stderr.includes(pflicht), `STOPP-Vollzug ohne "${pflicht}"`);
  }
}

// -- 3. ANKER: BEERDIGEN und Ausgang 5, auch wenn die Liste stimmt ----------
{
  // Der Eingriff sitzt am Objekt: eine Wegwerf-Kopie des Waechters, die auf
  // ein verstelltes Manifest zeigt. Am Produktivobjekt wird nichts angefasst.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-b3-anker-'));
  const manifest = path.join(tmp, 'hash-manifest.json');
  fs.writeFileSync(manifest, JSON.stringify({
    files: { 'protocol/early-detection/2.0.0/preregistration.json': '0'.repeat(64) },
  }));
  const r = spawnSync(python, ['-c', [
    'import importlib.util, sys',
    's = importlib.util.spec_from_file_location("np", sys.argv[1])',
    'm = importlib.util.module_from_spec(s); s.loader.exec_module(m)',
    'try:',
    '    m.registrierte_allowlist(manifest=sys.argv[2])',
    'except m.NullpunktBruch as e:',
    '    print(e.sanktion); sys.exit(m.EXIT_B3_STOPP if e.sanktion == m.SANKTION_DRIFT else m.EXIT_B3)',
    'sys.exit(0)',
  ].join('\n'), skript, manifest], { encoding: 'utf8' });
  assert.equal(r.status, EXIT_BEERDIGEN, r.stdout + r.stderr);
  assert.equal(r.stdout.trim(), 'BEERDIGEN');
}

// -- 4. Der gefahrene Nachweis: VB-A2-Rotproben-Artefakt ---------------------
// Nicht das committete Artefakt wird geglaubt, sondern der Lauf JETZT
// wiederholt und sein frisches JSON geprueft; das committete Artefakt wird
// danach gegen das frische gehalten. Ein Test, der nur die eingefrorene Datei
// liest, prueft eine Zahl von gestern und bleibt gruen, waehrend der Waechter
// darunter kaputtgeht - das war der Zustand vor dem Review vom 30.08.
const frisch = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-a2-frisch-'));
const frischesZiel = path.join(frisch, 'rotproben.json');
const rot = spawnSync(python, [skript, 'zweig-rotproben', '--ziel', frischesZiel],
  { encoding: 'utf8' });
assert.equal(rot.status, 0, rot.stdout + rot.stderr);
assert.ok(fs.existsSync(frischesZiel), 'der Lauf hat kein Artefakt geschrieben');
const a = JSON.parse(fs.readFileSync(frischesZiel, 'utf8'));

const artefakt = path.join(wurzel, 'reports', 'studie',
  'VB-A2-zweig-rotproben-2026-08-30.json');
assert.ok(fs.existsSync(artefakt), `VB-A2-Artefakt fehlt: ${artefakt}`);
const kern = (x) => JSON.stringify({
  proben: x.proben.map((p) => [p.zweig, p.eingriff, p.erwarteteSanktion,
    p.beobachteteSanktion, p.traegt]),
  beideZweigeGetrenntRot: x.beideZweigeGetrenntRot,
  alleProbenTragen: x.alleProbenTragen,
  vba8: x.vba8.regeln.map((r) => [r.regel, r.beobachteteSanktion,
    r.automatischeBeerdigung]),
  kettenprobe326: x.kettenprobe326,
});
assert.equal(kern(JSON.parse(fs.readFileSync(artefakt, 'utf8'))), kern(a),
  'das committete VB-A2-Artefakt weicht vom frischen Lauf ab: '
  + '`python scripts/studie-rr9-nullpunkt.py zweig-rotproben --ziel '
  + 'reports/studie/VB-A2-zweig-rotproben-2026-08-30.json`');
assert.equal(a.beideZweigeGetrenntRot, true);
assert.equal(a.alleProbenTragen, true);

const je = (zweig) => a.proben.filter((p) => p.zweig === zweig);
assert.ok(je('ANKER').length >= 1 && je('DRIFT').length >= 1,
  'VB-A2 verlangt je Zweig eine EIGENE Rot-Probe');
for (const p of je('ANKER')) {
  assert.equal(p.beobachteteSanktion, 'BEERDIGEN',
    `ANKER-Probe "${p.eingriff}" loeste ${p.beobachteteSanktion} aus`);
}
// Das erste Feuern des DRIFT-Zweigs ist STOPP - und mindestens eine Probe
// zeigt, dass das ZWEITE Feuern beerdigt. Ohne diesen Zaehler faellt die
// Spaltung nach dem Urteil ersatzlos (Kipp-Bedingung 1).
assert.ok(je('DRIFT').some((p) => p.beobachteteSanktion === 'STOPP'));
assert.ok(je('DRIFT').some((p) => p.eingriff.startsWith('zweites Feuern')
  && p.beobachteteSanktion === 'BEERDIGEN'),
'VB-A3: das zweite Feuern des DRIFT-Zweigs muss automatisch beerdigen');
assert.ok(je('DRIFT').some((p) => p.eingriff.startsWith('Register nicht lesbar')
  && p.beobachteteSanktion === 'BEERDIGEN'),
'VB-A3 fail-closed: ein unlesbares Register gilt als "mindestens ein Vorlauf"');
// Gegenprobe: ein Waechter, der immer rot ist, misst nichts.
assert.ok(a.proben.some((p) => p.eingriff.startsWith('GEGENPROBE')
  && p.beobachteteSanktion === 'KEIN BRUCH'));

// Der Stand des Kontingents am PRODUKTIVREGISTER ist Berichtsangabe, keine
// Bedingung: die Rot-Proben oben fahren gegen eingereichte Register-Lagen,
// damit ein spaeterer, voellig regelkonformer Reparatur-Eintrag sie nicht
// falsch rot faerbt. Geprueft wird nur, dass die Zahl ueberhaupt gemessen ist.
assert.ok(Number.isInteger(a.produktivVorlauf.reparaturAkteImRegister)
  && a.produktivVorlauf.reparaturAkteImRegister >= 0,
'der Stand des Kontingents ist im Bericht nicht gemessen');

// -- 5. VB-A8, die Sperrklausel als Pruefung --------------------------------
assert.equal(a.vba8.anzahlAutomatischerBeerdigungen, 2);
assert.equal(a.vba8.sollAnzahl, 2);
assert.equal(a.vba8.rot, false);
assert.equal(a.vba8.ankerZweigLebt, true);
for (const regel of a.vba8.regeln) {
  assert.equal(regel.automatischeBeerdigung, true,
    `${regel.regel} loest keine automatische Beerdigung mehr aus: `
    + `${regel.beobachteteSanktion}`);
}

// Und der Beweis, dass diese Zahl ueberhaupt fallen KANN: nimmt man einer der
// beiden Regeln die Automatik, wird die Lage maschinell rot. Der Eingriff
// laeuft an einer Wegwerf-Kopie, nie am Produktivobjekt.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-a8-'));
  const b1 = path.join(wurzel, 'scripts', 'studie-rr9-b1-manifest.py');
  const stumm = path.join(tmp, 'b1-stumm.py');
  fs.writeFileSync(stumm, fs.readFileSync(b1, 'utf8')
    .replace('SANKTION_BEERDIGEN = "BEERDIGEN"', 'SANKTION_BEERDIGEN = "STOPP"'));
  const r = spawnSync(python, ['-c', [
    'import importlib.util, json, sys',
    's = importlib.util.spec_from_file_location("np", sys.argv[1])',
    'm = importlib.util.module_from_spec(s); s.loader.exec_module(m)',
    'print(json.dumps(m.beerdigungs_wache(b1_modul=sys.argv[2])))',
  ].join('\n'), skript, stumm], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const w = JSON.parse(r.stdout);
  assert.equal(w.rot, true, 'VB-A8 bleibt gruen, obwohl eine Automatik fehlt');
  assert.equal(w.anzahlAutomatischerBeerdigungen, 1);
}

// Und die FOLGE der Sperrklausel, nicht nur ihre Zaehlung: faellt der
// ANKER-Zweig weg, MUSS der DRIFT-Zweig ohne weitere Sitzung auf BEERDIGEN
// beim ERSTEN Ausloeser zurueckspringen. Geprueft an einer Wegwerf-Kopie des
// ganzen Waechters, deren ANKER-Zweig keine automatische Beerdigung mehr
// ausloest - das ist die Lage, gegen die VB-A8 geschrieben ist.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-a8-folge-'));
  const kopie = path.join(tmp, 'nullpunkt-ohne-anker.py');
  const quelle = fs.readFileSync(skript, 'utf8');
  const alt = 'return NullpunktBruch(\n        SANKTION_ANKER,';
  assert.ok(quelle.includes(alt), 'der ANKER-Zweig sitzt nicht mehr in _anker()');
  fs.writeFileSync(kopie, quelle.replace(alt,
    'return NullpunktBruch(\n        SANKTION_DRIFT,'));
  const leer = path.join(tmp, 'ledger-ohne-vorlauf.json');
  fs.writeFileSync(leer, JSON.stringify({ events: [] }));
  // Die Kopie liegt ausserhalb des Repos - ihre Pfad-Konstanten zeigen daher
  // ins Leere. Die echten Objekte werden hereingereicht, damit die Probe den
  // ANKER-Zweig misst und nicht eine fehlende Datei.
  const echt = {
    praereg: path.join(wurzel, 'protocol', 'early-detection', '2.0.0', 'preregistration.json'),
    manifest: path.join(wurzel, 'protocol', 'early-detection', '2.0.0', 'hash-manifest.json'),
    b1: path.join(wurzel, 'scripts', 'studie-rr9-b1-manifest.py'),
  };
  const r = spawnSync(python, ['-c', [
    'import importlib.util, sys',
    'kopie, leer, praereg, manifest, b1 = sys.argv[1:6]',
    's = importlib.util.spec_from_file_location("np", kopie)',
    'm = importlib.util.module_from_spec(s); s.loader.exec_module(m)',
    'liste = list(m.registrierte_allowlist(praereg=praereg, manifest=manifest))',
    'liste[0] = liste[0] + "X"',
    'try:',
    '    m.pruefe_nullpunkt(liste, praereg=praereg, manifest=manifest,',
    '                      ledger=leer, b1_modul=b1)',
    '    print("KEIN BRUCH")',
    'except m.NullpunktBruch as e:',
    '    print(e.sanktion)',
  ].join('\n'), kopie, leer, echt.praereg, echt.manifest, echt.b1],
  { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'BEERDIGEN',
    'VB-A8-Sperrklausel: ohne lebenden ANKER-Zweig muss schon das ERSTE '
    + `Feuern des DRIFT-Zweigs beerdigen, kam mit "${r.stdout.trim()}"`);
}

// -- 6. VB-A6: die Register-Luecke steht offen und mit ihrem Mechanismus -----
// Auch hier gilt: der Lauf wird gefahren, nicht die Datei geglaubt. Vor dem
// Review vom 30.08. wurde `register-anker` in diesem Test ueberhaupt nicht
// aufgerufen - eine Logik, die still auf "verankert" umgekippt waere, haette
// hier nie jemand gesehen.
const ankerZiel = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vb-a6-')),
  'anker.json');
const ankerLauf = spawnSync(python, [skript, 'register-anker', '--ziel', ankerZiel],
  { encoding: 'utf8' });
assert.equal(ankerLauf.status, 0, ankerLauf.stdout + ankerLauf.stderr);
const anker = JSON.parse(fs.readFileSync(ankerZiel, 'utf8'));

const ankerArtefakt = path.join(wurzel, 'reports', 'studie',
  'VB-A6-registeranker-2026-08-30.json');
assert.ok(fs.existsSync(ankerArtefakt), `VB-A6-Artefakt fehlt: ${ankerArtefakt}`);
assert.deepEqual(JSON.parse(fs.readFileSync(ankerArtefakt, 'utf8')), anker,
  'das committete VB-A6-Artefakt weicht vom frischen Lauf ab: '
  + '`python scripts/studie-rr9-nullpunkt.py register-anker --ziel '
  + 'reports/studie/VB-A6-registeranker-2026-08-30.json`');
assert.equal(anker.registerVerankert, false,
  'Steht der Sollwert im Register, ist VB-A6 vollzogen - dann gehoert dieser '
  + 'Test auf true umgestellt und das Zitierverbot faellt.');
assert.equal(anker.zitierverbot, 'OFFEN');
assert.equal(anker.nutzlast.registriertePraeregSha,
  '799f925142860b4db97b5f18894b62c749aeb014872279aa6a7df8ee99ac5a6c');
// Die mitzufuehrende Nutzlast muss den HEUTIGEN Waechter beschreiben. Wer das
// Skript aendert, ohne die Nutzlast neu zu bauen, meldet dem Register einen
// Sollwert, den es nie gab.
assert.equal(anker.nutzlast.waechterDateiSha256,
  crypto.createHash('sha256').update(fs.readFileSync(skript)).digest('hex'),
  'VB-A6-Nutzlast ist veraltet: `python scripts/studie-rr9-nullpunkt.py '
  + 'register-anker --ziel reports/studie/VB-A6-registeranker-2026-08-30.json`');

// -- 7. VB-A7: 326/365 traegt KEINE Sanktion --------------------------------
// Geprueft wird die Abwesenheit an den Ausloesern selbst, nicht an einem Text.
for (const p of a.proben) {
  assert.ok(!/\b326\b/.test(p.beobachtetesVerhalten),
    `Ein B3'-Ausloeser haengt an 326/365: ${p.eingriff}`);
}
assert.match(a.kettenprobe326, /KEINE Sanktion/);
assert.match(a.kettenprobe326, /ab pit_reduktion/i);

console.log('studie-vb-b3-spaltung.test.js: PASS');
