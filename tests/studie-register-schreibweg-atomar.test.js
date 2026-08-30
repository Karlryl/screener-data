'use strict';

// Waechter ueber dem SCHREIBWEG des Zugriffs-Registers.
//
// DIE SACHE: protocol/early-detection/2.0.0/outcome-access-ledger.json ist
// nur-anhaengend, verkettet und extern bezeugt. Ein halb geschriebenes Register
// ist nicht reparierbar - das Werkzeug kennt kein --force und keine
// Reparatur-Betriebsart, es bliebe nur `git checkout`, und der naechste Lauf
// saehe einen rohen SyntaxError aus JSON.parse. Drei Werkzeuge duerfen an das
// Register: scripts/studie-f3b-register.js, scripts/studie-rr9-a3-register.js
// und scripts/studie-r1-serverzeit.js.
//
// WAS HIER GEPINNT WIRD, IST DIE EIGENSCHAFT DES LAUFS, NICHT SEIN QUELLTEXT:
//
//   (1) Die Registerdatei wird waehrend eines Schreiblaufs NIE direkt schreibend
//       geoeffnet. Sie entsteht ausschliesslich als ZIEL eines rename, und die
//       Datei, die wirklich beschrieben wird, liegt daneben im selben
//       Verzeichnis (gleiches Dateisystem, also ist rename atomar).
//   (2) Bricht der Schreibvorgang mittendrin ab, ist die Registerdatei
//       BYTE-IDENTISCH zu vorher und die Kette weiter gueltig.
//   (3) Der atomare Weg liefert exakt die ausgelieferte Formatierung
//       (ein Leerzeichen Einrueckung, Schluss-Zeilenumbruch). Das ist kein
//       Schoenheitspunkt: jede Byte-Aenderung an bestehenden Eintraegen bricht
//       die Verkettung und entwertet den externen Serverbeweis.
//
// Beobachtet wird das mit tests/hilfen/schreibspion.js - einem Preload-Modul,
// das mitschreibt, welche Pfade schreibend geoeffnet und welche Ziele umbenannt
// werden. Kein Suchmuster im Quelltext: ein Waechter, der nur nach dem Wort
// `writeFileAtomic` sucht, ist nach der ersten Umbenennung gruen und wertlos.
//
// JEDE PROBE LAEUFT AUCH IN DER ABWESENHEIT: gegen einen Zwilling, dem der
// atomare Weg herausoperiert wurde (zurueck auf fs.writeFileSync), muessen
// (1) und (2) ROT werden. Sonst messen sie nichts.
//
// HARTE GRENZE: kein Test dieser Datei fasst das echte Register schreibend an.
// Geschrieben wird ausschliesslich in Kopien unterhalb von os.tmpdir().

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const REPO = path.join(__dirname, '..');
const SPION = path.join(REPO, 'tests', 'hilfen', 'schreibspion.js');
const LEDGER = path.join(REPO, 'protocol', 'early-detection', '2.0.0', 'outcome-access-ledger.json');
const LIB = path.join(REPO, 'lib', 'studie-verfassung.js');
const { pruefeZugriffsRegister } = require(LIB);

const dateihash = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const lies = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
// Die Auslieferungs-Formatierung des Registers, an genau einer Stelle.
const alsRegisterBytes = (obj) => JSON.stringify(obj, null, 1) + '\n';
const schreib = (p, obj) => fs.writeFileSync(p, alsRegisterBytes(obj), 'utf8');

function tempdir(marke) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schreibweg-' + marke + '-'));
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Ein Register-Praefix ist selbst ein gueltiges Register - das ist die
// Eigenschaft, die "nur-anhaengend" ueberhaupt bedeutet. Geschnitten wird, weil
// jedes Werkzeug auf GENAU das Kettenende gepinnt ist, das es vorfinden soll.
function registerPraefix(ziel, anzahl) {
  const live = lies(LEDGER);
  assert.ok(live.events.length >= anzahl, 'Das Register hat weniger als ' + anzahl + ' Eintraege');
  schreib(ziel, Object.assign({}, live, { events: live.events.slice(0, anzahl) }));
  return ziel;
}

function laufeMitSpion(skript, args, opt) {
  const o = opt || {};
  const spurDatei = path.join(o.spurIn, 'spur-' + String(Math.random()).slice(2, 8) + '.json');
  const env = Object.assign({}, process.env, { SPION_AUSGABE: spurDatei });
  if (o.abbruch) env.SPION_ABBRUCH = '1';
  const e = spawnSync(process.execPath, ['--require', SPION].concat([skript], args), {
    encoding: 'utf8', cwd: o.cwd || REPO, env,
  });
  const spur = fs.existsSync(spurDatei) ? lies(spurDatei) : null;
  return { status: e.status, aus: e.stdout || '', fehler: e.stderr || '', spur };
}

// -- Die drei Faelle. Jeder liefert ein echtes Skript, echte Argumente und die
//    Registerdatei, die dabei beschrieben wird. --------------------------------

function fallF3b(dir, marke) {
  const register = registerPraefix(path.join(dir, 'ledger-f3b-' + marke + '.json'), 20);
  const konzept = path.join(dir, 'konzeptliste-' + marke + '.json');
  fs.copyFileSync(path.join(REPO, 'protocol', 'early-detection', '2.1.0', 'konzeptliste.json'), konzept);
  return {
    skript: path.join(REPO, 'scripts', 'studie-f3b-register.js'),
    args: ['--register', register, '--konzeptliste', konzept, '--schreiben'],
    register,
  };
}

function fallRr9(dir, marke) {
  const register = registerPraefix(path.join(dir, 'ledger-rr9-' + marke + '.json'), 21);
  const jahrgang = path.join(dir, 'jahrgang-' + marke + '.json');
  fs.copyFileSync(
    path.join(REPO, 'protocol', 'early-detection', '2.1.0', 'jahrgang-registrierung-2026-08-30.json'),
    jahrgang,
  );
  return {
    skript: path.join(REPO, 'scripts', 'studie-rr9-a3-register.js'),
    args: ['--register', register, '--jahrgang', jahrgang, '--schreiben'],
    register,
  };
}

// R1 kennt keinen --register-Schalter: sein Ledger-Pfad haengt an __dirname.
// Deshalb bekommt es einen gespiegelten Baum. Gespiegelt wird das ECHTE Skript
// und die ECHTE Bibliothek - nur die Daten sind Kopien.
function fallR1(dir, marke) {
  const baum = path.join(dir, 'baum-' + marke);
  fs.mkdirSync(path.join(baum, 'scripts'), { recursive: true });
  fs.cpSync(path.join(REPO, 'lib'), path.join(baum, 'lib'), { recursive: true });
  fs.copyFileSync(
    path.join(REPO, 'scripts', 'studie-r1-serverzeit.js'),
    path.join(baum, 'scripts', 'studie-r1-serverzeit.js'),
  );
  const protoZiel = path.join(baum, 'protocol', 'early-detection', '2.0.0');
  fs.mkdirSync(protoZiel, { recursive: true });
  const register = path.join(protoZiel, 'outcome-access-ledger.json');
  fs.copyFileSync(LEDGER, register);
  fs.copyFileSync(
    path.join(REPO, 'protocol', 'early-detection', '2.0.0', 'preregistration.json'),
    path.join(protoZiel, 'preregistration.json'),
  );
  return {
    skript: path.join(baum, 'scripts', 'studie-r1-serverzeit.js'),
    args: [
      'anmelden',
      '--runid', 'schreibweg-probe-' + marke,
      '--fenster', 'schreibweg-probe',
      '--zugriff-ab', new Date(Date.now() + 3600 * 1000).toISOString(),
    ],
    register,
    cwd: baum,
  };
}

const WERKZEUGE = [
  { name: 'F3b', bau: fallF3b },
  { name: 'RR9-A3', bau: fallRr9 },
  { name: 'R1-anmelden', bau: fallR1 },
];

// -- (1) Das Register wird nie direkt schreibend geoeffnet --------------------

for (const w of WERKZEUGE) {
  test(w.name + ': das Register entsteht als rename-Ziel, nie als direkt beschriebene Datei', () => {
    const dir = tempdir(w.name.toLowerCase());
    const fall = w.bau(dir, 'a');
    const vorher = dateihash(fall.register);

    const lauf = laufeMitSpion(fall.skript, fall.args, { cwd: fall.cwd, spurIn: dir });
    assert.equal(lauf.status, 0, w.name + ' ist rot: ' + lauf.fehler);
    assert.ok(lauf.spur, 'Der Spion hat keine Spur hinterlassen');

    const ziel = path.resolve(fall.register);
    assert.ok(
      !lauf.spur.schreibZiele.includes(ziel),
      w.name + ' hat das Register DIREKT schreibend geoeffnet - ein Abbruch mittendrin waere eine halbe Datei.',
    );
    assert.ok(
      lauf.spur.renameZiele.includes(ziel),
      w.name + ' hat das Register nicht per rename an seinen Platz gebracht (Spur: '
        + JSON.stringify(lauf.spur.renameZiele) + ')',
    );
    // Die wirklich beschriebene Datei muss DANEBEN liegen: ueber
    // Verzeichnisgrenzen hinweg ist rename keine atomare Operation.
    const daneben = lauf.spur.schreibZiele.filter(
      (p) => path.dirname(p) === path.dirname(ziel) && p !== ziel,
    );
    assert.ok(daneben.length > 0, 'Die Zwischendatei lag nicht im selben Verzeichnis wie das Register');

    // Und das Ergebnis stimmt: geschrieben wurde wirklich, die Kette haelt.
    assert.notEqual(dateihash(fall.register), vorher,
      w.name + ' hat gar nichts geschrieben - dann misst diese Probe nichts');
    pruefeZugriffsRegister(lies(fall.register));

    // (3) Byte-Format: exakt die Auslieferungs-Formatierung, kein Zeichen anders.
    assert.equal(
      fs.readFileSync(fall.register, 'utf8'),
      alsRegisterBytes(lies(fall.register)),
      w.name + ' hat das Register umformatiert - das bricht die Verkettung bestehender Eintraege',
    );

    // Kein Zwischenstand bleibt liegen.
    const reste = fs.readdirSync(path.dirname(ziel)).filter(
      (n) => n.indexOf('.tmp.') !== -1 || n.indexOf('.neu-') !== -1,
    );
    assert.deepEqual(reste, [], 'Zwischendateien liegen geblieben: ' + reste.join(', '));
  });
}

// -- (2) Ein Abbruch mitten im Schreiben laesst das Register unversehrt -------

for (const w of WERKZEUGE) {
  test(w.name + ': ein Abbruch mitten im Schreiben laesst das Register byte-identisch', () => {
    const dir = tempdir(w.name.toLowerCase() + '-abbruch');
    const fall = w.bau(dir, 'b');
    const vorher = dateihash(fall.register);
    const bytesVorher = fs.readFileSync(fall.register, 'utf8');

    const lauf = laufeMitSpion(fall.skript, fall.args, { abbruch: true, cwd: fall.cwd, spurIn: dir });
    assert.notEqual(lauf.status, 0,
      w.name + ' meldet Erfolg, obwohl der Schreibvorgang abgebrochen wurde');
    assert.ok(lauf.spur && lauf.spur.abbruchAusgeloest,
      'Der Abbruch wurde nie ausgeloest - die Probe misst nichts');

    assert.equal(dateihash(fall.register), vorher,
      w.name + ': das Register ist nach dem Abbruch veraendert');
    assert.equal(fs.readFileSync(fall.register, 'utf8'), bytesVorher);
    pruefeZugriffsRegister(lies(fall.register)); // wirft, wenn die Kette gebrochen waere
  });
}

// -- Abwesenheits-Probe: ohne den atomaren Weg muessen (1) und (2) ROT werden -

test('Abwesenheit: der Zwilling mit direktem writeFileSync faellt durch BEIDE Waechter', () => {
  const dir = tempdir('zwilling');

  // Der Zwilling ist das echte F3b-Skript mit genau einer rueckgebauten Zeile:
  // writeFileAtomic -> fs.writeFileSync. Alles andere bleibt.
  const quelle = fs.readFileSync(path.join(REPO, 'scripts', 'studie-f3b-register.js'), 'utf8');
  const ankerAtomar = '  writeFileAtomic(pfad, `${JSON.stringify(register, null, 1)}\\n`, \'utf8\');';
  const rueckbau = '  fs.writeFileSync(pfad, `${JSON.stringify(register, null, 1)}\\n`, \'utf8\');';
  assert.ok(quelle.includes(ankerAtomar),
    'Sabotage-Anker nicht gefunden - der Zwilling wuerde nichts beweisen');
  const zwilling = path.join(dir, 'f3b-ohne-atomar.js');
  fs.writeFileSync(
    zwilling,
    quelle
      .replace(ankerAtomar, rueckbau)
      .replace("require('../lib/studie-verfassung')", 'require(' + JSON.stringify(LIB) + ')')
      .replace("require('../lib/atomic-write.js')",
        'require(' + JSON.stringify(path.join(REPO, 'lib', 'atomic-write.js')) + ')'),
    'utf8',
  );

  // Probe (1) muss rot werden: das Register wird direkt beschrieben.
  const fall1 = fallF3b(dir, 'z1');
  const lauf1 = laufeMitSpion(zwilling, fall1.args, { spurIn: dir });
  assert.equal(lauf1.status, 0, 'Zwilling rot aus dem falschen Grund: ' + lauf1.fehler);
  assert.ok(
    lauf1.spur.schreibZiele.includes(path.resolve(fall1.register)),
    'Der Zwilling schreibt NICHT direkt - dann prueft Waechter (1) nichts',
  );

  // Probe (2) muss rot werden: der Abbruch hinterlaesst eine halbe Datei.
  const fall2 = fallF3b(dir, 'z2');
  const bytesVorher = fs.readFileSync(fall2.register, 'utf8');
  const lauf2 = laufeMitSpion(zwilling, fall2.args, { abbruch: true, spurIn: dir });
  assert.notEqual(lauf2.status, 0);
  assert.notEqual(
    fs.readFileSync(fall2.register, 'utf8'), bytesVorher,
    'Der Abbruch hat das Register des Zwillings NICHT beschaedigt - dann prueft Waechter (2) nichts',
  );
  assert.throws(
    () => JSON.parse(fs.readFileSync(fall2.register, 'utf8')),
    'Die halbe Datei des Zwillings laesst sich noch parsen - der Schaden ist nicht der behauptete',
  );
});
