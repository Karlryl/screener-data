'use strict';

// C1 — die Zeitleisten je Thema.
//
// Die SACHE, die hier festgenagelt wird, ist nicht ein Dateiformat, sondern die
// Belegkette: ein Datum ohne abrufbare Quelle sieht in einer Tabelle genauso aus wie
// ein belegtes. Wer das durchgehen laesst, verkauft Motor-Erinnerung als Messung.
// Zweitens die Gleichbehandlung: wer bei bekannten Gewinnern gruendlicher sucht,
// erzeugt genau den Unterschied, den er spaeter zu messen glaubt.
//
// Jeder Waechter wird deshalb in BEIDE Richtungen geprueft: der ausgelieferte Stand
// muss DURCHGEHEN, und jede der drei Manipulationen muss ROT werden. Dazu der
// Meta-Test: ohne den C0-Anker-Vergleich darf die dritte Manipulation NICHT mehr
// auffliegen — er belegt, dass der Vergleich die tragende Stelle ist.

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const REPO = path.join(__dirname, '..');
const PROTO = path.join(REPO, 'protocol', 'strang-c');
const SKRIPT = path.join(REPO, 'scripts', 'studie-c1.py');
const REGEL = path.join(PROTO, 'C1-regel.md');
const FREEZE1 = path.join(PROTO, 'C1-freeze1.json');
const FREEZE2 = path.join(PROTO, 'C1-freeze2.json');
const ZEITLEISTEN = path.join(PROTO, 'C1-zeitleisten.json');
const FREIGABE = path.join(REPO, 'reports', 'studie', 'C1-freigabe.json');
const LEDGER = path.join(REPO, 'protocol', 'early-detection', '2.0.0', 'outcome-access-ledger.json');

const lies = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

function python() {
  for (const kandidat of ['python', 'python3', 'py']) {
    if (spawnSync(kandidat, ['-c', 'print(1)'], { encoding: 'utf8' }).status === 0) return kandidat;
  }
  throw new Error('Kein Python gefunden');
}

function pruefe(wurzel) {
  return spawnSync(python(), [path.join(wurzel, 'scripts', 'studie-c1.py'), 'pruefen'], {
    encoding: 'utf8', env: process.env,
  });
}

// Arbeitskopie: Skript und Protokoll-Ordner. Die Rohdaten bleiben, wo sie sind — sie
// kommen ueber EARLY_DETECTION_DATA_ROOT und werden hier nur gelesen.
function arbeitskopie() {
  const ziel = fs.mkdtempSync(path.join(os.tmpdir(), 'c1-'));
  fs.mkdirSync(path.join(ziel, 'scripts'), { recursive: true });
  fs.copyFileSync(SKRIPT, path.join(ziel, 'scripts', 'studie-c1.py'));
  fs.copyFileSync(path.join(REPO, 'scripts', 'studie-c0.py'), path.join(ziel, 'scripts', 'studie-c0.py'));
  fs.cpSync(PROTO, path.join(ziel, 'protocol', 'strang-c'), { recursive: true });
  return ziel;
}

test('C1: der Rechen-Selbsttest des Skripts ist gruen', () => {
  const lauf = spawnSync(python(), [SKRIPT, 'selbsttest'], { encoding: 'utf8', env: process.env });
  assert.equal(lauf.status, 0, `selbsttest rot:\n${lauf.stdout}${lauf.stderr}`);
  assert.match(lauf.stdout, /"selbsttest": "gruen"/);
});

test('C1: die Regeldatei benennt die Sonden, die Ankerregel und die Kurs-Sperre', () => {
  const text = fs.readFileSync(REGEL, 'utf8');
  for (const stueck of ['OpenAlex', 'Crossref', 'Wikipedia', 'EDGAR', 'Federal Register',
    'ankerFachlich', 'ankerOeffentlich', 'NICHT BELEGBAR', 'Kurs-Sperre']) {
    assert.ok(text.includes(stueck), `Die Regel benennt ${stueck} nicht`);
  }
  // Ein Regeltext, der die verworfenen Quellen verschweigt, laesst die Frage offen,
  // ob ueberhaupt gesucht wurde (R17).
  assert.ok(/arXiv/.test(text) && /verworfen/.test(text), 'R17-Vermerk fehlt');
});

test('C1: FREEZE 1 versiegelt das Werkzeug selbst, nicht nur die Prosa', () => {
  // Zeitraum, Fenstergroesse und Signallisten sind Konstanten IM PROGRAMM. Ohne den
  // Skript-Hash koennte man sie nach Sichtung der Ergebnisse verschieben, ohne dass
  // ein Waechter anschlaegt.
  const freeze = lies(FREEZE1);
  assert.ok(freeze.buendel.some((z) => z.startsWith('scripts/studie-c1.py  ')),
    'Das Siegel fuehrt das Skript nicht');
  assert.ok(freeze.buendel.some((z) => z.startsWith('protocol/strang-c/C1-regel.md  ')),
    'Das Siegel fuehrt den Regeltext nicht');
});

test('C1: die Anmeldung liegt vor der Server-Bestaetigung und die vor dem Zugriff', () => {
  const frei = lies(FREIGABE);
  const eintrag = lies(LEDGER).events.find((e) => e.runId === frei.runId);
  assert.ok(eintrag, 'Die Freigabe nennt eine Kennung, die nicht im Register steht');
  assert.equal(eintrag.typ, 'C1_REGELFREEZE');
  assert.ok(Date.parse(eintrag.registeredAt) < Date.parse(frei.serverConfirmedAt),
    'Die Anmeldung liegt nicht vor der Server-Bestaetigung');
  assert.ok(Date.parse(frei.serverConfirmedAt) <= Date.parse(eintrag.accessedAt),
    'Der freigegebene Zugriff liegt vor der Server-Bestaetigung');
});

test('C1: kein Kurs-Merkmal im Ableitungs-Code', () => {
  // C1 liegt VOR der Kursseite. Ein Kursbegriff im Code waere kein Stilfehler,
  // sondern der Bruch der Etappengrenze.
  const code = fs.readFileSync(SKRIPT, 'utf8');
  const zeilen = code.split('\n').filter((z) => !z.trim().startsWith('#'));
  for (const wort of ['adjClose', 'adjusted_close', 'marketCap', 'market_cap',
    'closePrice', 'total_return', 'sharadar', 'yfinance', 'quantconnect']) {
    assert.ok(!zeilen.join('\n').includes(wort), `Kurs-Merkmal ${wort} im C1-Code`);
  }
});

test('W1: der ausgelieferte Stand geht durch den Waechter', () => {
  const lauf = pruefe(REPO);
  assert.equal(lauf.status, 0, `Der ausgelieferte Stand ist rot:\n${lauf.stdout}${lauf.stderr}`);
  assert.match(lauf.stdout, /"rot": 0/);
});

test('W2 (Sabotage A): ein Datum ohne Beleg fliegt auf', () => {
  const ziel = arbeitskopie();
  const kdir = path.join(ziel, 'protocol', 'strang-c', 'c1-kandidaten');
  const datei = path.join(kdir, fs.readdirSync(kdir).sort()[0]);
  const inhalt = lies(datei);
  assert.ok(inhalt.kandidaten.length > 0, 'Testfall taugt nichts: keine Kandidaten');
  delete inhalt.kandidaten[0].sha256;   // genau das, was die Regel verbietet
  fs.writeFileSync(datei, `${JSON.stringify(inhalt, null, 1)}\n`, 'utf8');
  const lauf = pruefe(ziel);
  assert.equal(lauf.status, 1, `Ein Datum ohne Beleg blieb unbemerkt:\n${lauf.stdout}`);
  assert.match(lauf.stdout, /ROT .*W3_jedes_datum_traegt_eine_quellen_pruefsumme/);
});

test('W3 (Sabotage B): ein Thema ohne Zeitleiste fliegt auf', () => {
  const ziel = arbeitskopie();
  const datei = path.join(ziel, 'protocol', 'strang-c', 'C1-zeitleisten.json');
  const inhalt = lies(datei);
  // Absichtlich eine Sprachmode entfernen: genau die waere die bequemste
  // stille Streichung, weil sie "eh kein Thema" ist — und genau dadurch waere die
  // eingebaute Negativ-Kontrolle weg.
  const raus = inhalt.zeitleisten.findIndex((z) => z.thema === 'reimagined');
  assert.ok(raus >= 0, 'Testfall taugt nichts: reimagined fehlt schon');
  inhalt.zeitleisten.splice(raus, 1);
  fs.writeFileSync(datei, `${JSON.stringify(inhalt, null, 1)}\n`, 'utf8');
  const lauf = pruefe(ziel);
  assert.equal(lauf.status, 1, `Ein fehlendes Thema blieb unbemerkt:\n${lauf.stdout}`);
  assert.match(lauf.stdout, /ROT .*W1_alle_26_themen_haben_eine_zeitleiste/);
});

test('W4 (Sabotage C): eine Reihe, die C0 im Aufnahmejahr nicht reproduziert, fliegt auf', () => {
  const ziel = arbeitskopie();
  const datei = path.join(ziel, 'protocol', 'strang-c', 'C1-zeitleisten.json');
  const inhalt = lies(datei);
  const z = inhalt.zeitleisten.find((x) => x.herkunft === 'REGEL');
  const jahr = String(z.c0SpikeJahr);
  z.reihe[jahr] = (z.reihe[jahr] || 0) + 1;
  const p = inhalt.c0Ankerpruefung.find((x) => x.thema === z.thema);
  p.c1D = z.reihe[jahr];
  p.gleich = false;
  inhalt.c0AnkerAlleGleich = false;
  fs.writeFileSync(datei, `${JSON.stringify(inhalt, null, 1)}\n`, 'utf8');
  const lauf = pruefe(ziel);
  assert.equal(lauf.status, 1, `Eine C0-Abweichung blieb unbemerkt:\n${lauf.stdout}`);
  assert.match(lauf.stdout, /ROT .*W2_c0_firmenzahl_im_aufnahmejahr_reproduziert/);
});

test('W5 (Meta): ohne den C0-Anker-Vergleich findet der Waechter die Abweichung NICHT mehr', () => {
  // Der Beweis, dass der Vergleich die tragende Stelle ist und nicht ein Ritual
  // daneben: derselbe Sabotage-Fall, aber mit ausgebautem Vergleich.
  const ziel = arbeitskopie();
  const skript = path.join(ziel, 'scripts', 'studie-c1.py');
  const code = fs.readFileSync(skript, 'utf8');
  const alt = 'schief = [p for p in daten["c0Ankerpruefung"] if not p["gleich"]]';
  assert.ok(code.includes(alt), 'Die geschuetzte Stelle steht nicht mehr im Skript');
  fs.writeFileSync(skript, code.replace(alt, 'schief = []'), 'utf8');

  const datei = path.join(ziel, 'protocol', 'strang-c', 'C1-zeitleisten.json');
  const inhalt = lies(datei);
  const z = inhalt.zeitleisten.find((x) => x.herkunft === 'REGEL');
  const p = inhalt.c0Ankerpruefung.find((x) => x.thema === z.thema);
  p.c1D = (p.c1D || 0) + 1;
  p.gleich = false;
  fs.writeFileSync(datei, `${JSON.stringify(inhalt, null, 1)}\n`, 'utf8');

  const lauf = pruefe(ziel);
  assert.doesNotMatch(lauf.stdout, /ROT .*W2_c0_firmenzahl_im_aufnahmejahr_reproduziert/,
    'Der ausgebaute Vergleich findet die Abweichung immer noch — dann war er nicht die tragende Stelle');
});

test('C1: die beiden Freezes haengen aneinander und beschreiben den Arbeitsbaum', () => {
  const f2 = lies(FREEZE2);
  assert.equal(f2.stufe, 'C1_FREEZE_2');
  for (const zeile of f2.buendel) {
    const [name, hash] = zeile.split('  ');
    const pfad = path.join(REPO, ...name.split('/'));
    assert.ok(fs.existsSync(pfad), `${name} steht im Siegel, aber nicht im Baum`);
    const ist = execFileSync(python(), ['-c',
      'import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())', pfad],
    { encoding: 'utf8' }).trim();
    assert.equal(ist, hash, `${name} weicht vom Siegel ab`);
  }
});

test('C1: jedes Thema hat genau dieselbe Zahl Sonden-Laeufe wie die Regel vorschreibt', () => {
  // Der Gleichbehandlungs-Test in beide Richtungen: nicht nur "keiner mehr", sondern
  // auch "keiner weniger". Ein Thema mit weniger Laeufen waere ein Thema, bei dem der
  // Motor frueher aufgegeben hat.
  const daten = lies(ZEITLEISTEN);
  assert.equal(daten.zeitleisten.length, 26);
  for (const z of daten.zeitleisten) {
    assert.equal(z.sondenLaeufe, z.sondenLaeufeSoll,
      `${z.thema}: ${z.sondenLaeufe} Sonden-Laeufe statt ${z.sondenLaeufeSoll}`);
  }
});

test('C1: die beiden Sprachmoden stehen unveraendert in der Ausgabe', () => {
  // Sie sind die eingebaute Negativ-Kontrolle. Wer sie aussortiert, misst nichts mehr.
  const themen = lies(ZEITLEISTEN).zeitleisten.map((z) => z.thema);
  for (const mode of ['transparency', 'reimagined', 'Metaverse', 'Cannabis']) {
    assert.ok(themen.includes(mode), `${mode} fehlt in der Ausgabe`);
  }
});

test('C1: git kennt die neuen Dateien — der Waechter darf nicht ins Leere laufen', () => {
  const bekannt = execFileSync('git', ['ls-files', 'protocol/strang-c', 'scripts/studie-c1.py'],
    { cwd: REPO, encoding: 'utf8' });
  for (const datei of ['protocol/strang-c/C1-regel.md', 'protocol/strang-c/C1-zeitleisten.json',
    'scripts/studie-c1.py']) {
    assert.ok(bekannt.includes(datei), `${datei} ist nicht versioniert`);
  }
});
