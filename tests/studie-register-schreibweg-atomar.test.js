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
  const env = Object.assign({}, process.env, o.umgebung || {}, { SPION_AUSGABE: spurDatei });
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
  // G11: der Spiegel fuehrt BEIDE Registerdateien der Kette. Das Werkzeug loest
  // seit G10 ueber die Kette auf; ein Spiegel, der nur eine Datei anlegt, laesst
  // den Aufloeser auf eine Datei zeigen, die die Fixture nie anlegt - und ein
  // Spion, der den falschen Pfad bewacht, ist genau der Fehler, gegen den er
  // geschrieben wurde. Der Anhaenger schreibt hier weiter in die erste Datei;
  // die zweite steht bereit, damit der Spiegel die Kette nicht halbiert.
  fs.copyFileSync(
    path.join(REPO, 'protocol', 'early-detection', '2.0.0', 'outcome-access-ledger-teil2.json'),
    path.join(protoZiel, 'outcome-access-ledger-teil2.json'),
  );
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
    // LRA-3: beobachtet wird die AKTIVE Registerdatei - dorthin schreibt
    // `anmelden` seit der Umhaengung. Die geschlossene liegt im Spiegel
    // daneben und bleibt unberuehrt; genau das prueft die Byte-Gleichheit.
    register: path.join(protoZiel, 'outcome-access-ledger-teil2.json'),
    cwd: baum,
  };
}

// R1 `bestaetigen` schreibt die ZWEITE Datei dieses Werkzeugs: das
// Freigabe-Protokoll, das scripts/studie-zaehlprobe.py als Tor vor dem
// Datenzugriff liest. Eine halbe Datei ist dort kein Halt, sondern ein
// Parse-Fehler an der Stelle, an der ein Halt gemeint war - also gehoert sie
// unter dieselben drei Proben. Der Weg dorthin fuehrt durch zwei `gh`-Aufrufe;
// gestellt wird deshalb ein `gh`, das genau die zwei Antworten gibt, die das
// Werkzeug auswertet. Gefaelscht wird die AUSKUNFT DES SERVERS, nie die Pruefung:
// das Werkzeug rechnet den Vergleich unveraendert selbst.
function stelleGhBereit(baum, register) {
  const bin = path.join(baum, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const js = path.join(bin, 'gh.js');
  fs.writeFileSync(js, [
    "'use strict';",
    "const fs = require('node:fs');",
    'const argv = process.argv.slice(2);',
    "if (argv[0] === 'repo') { process.stdout.write('Karlryl/screener-data\\n'); process.exit(0); }",
    "if (argv[0] === 'api') {",
    // Die Serveruhr eine Sekunde nach der Anmeldung: das Werkzeug verlangt
    // registeredAt < serverConfirmedAt STRIKT, und beide entstehen hier im
    // selben Lauf. Ohne den Abstand scheiterte der Test an der Uhr, nicht an
    // der Sache.
    '  const jetzt = new Date(Date.now() + 1000).toUTCString();',
    "  const roh = fs.readFileSync(process.env.SPION_REGISTER, 'utf8');",
    // `path` gehoert in die Antwort, weil die echte API ihn liefert und der
    // Beweis ihn seit F2 gegen den ANGEFRAGTEN Pfad haelt. Abgeleitet aus der
    // Anfrage, nicht getippt - eine Attrappe, die ihn erfindet, pruefte den
    // Vergleich nicht, sondern umginge ihn.
    "  const rel = String(argv[argv.length - 1]).replace(/^repos\\/[^/]+\\/[^/]+\\/contents\\//, '').split('?')[0];",
    "  const rumpf = JSON.stringify({ path: rel, content: Buffer.from(roh, 'utf8').toString('base64'), encoding: 'base64' });",
    // fs.writeSync statt process.stdout.write: auf eine PIPE schreibt Node
    // asynchron, und ein direkt folgendes process.exit() schneidet den Rest ab.
    // Der Rumpf ist base64 und waechst mit dem Register; ueberschreitet er den
    // Pipe-Puffer, kam beim Werkzeug ein halber JSON-Text an und der Test war
    // rot mit "Unterminated string in JSON" — an einer Stelle, an der das
    // WERKZEUG nichts falsch gemacht hatte. fs.writeSync auf fd 1 blockiert,
    // bis alles draussen ist.
    "  const kopf = 'HTTP/2 200\\r\\ndate: ' + jetzt + '\\r\\n\\r\\n';",
    '  const aus = Buffer.from(kopf + rumpf, \'utf8\');',
    '  for (let ab = 0; ab < aus.length;) ab += fs.writeSync(1, aus, ab, aus.length - ab);',
    '  process.exit(0);',
    '}',
    'process.exit(9);',
  ].join('\n'), 'utf8');
  // NUR die Huelle der jeweiligen Plattform anlegen. Liegt unter Windows
  // zusaetzlich eine endungslose Datei `gh` im selben Verzeichnis, findet die
  // Prozess-Suche sie zuerst, kann sie nicht ausfuehren - und faellt auf das
  // ECHTE gh weiter hinten im Suchpfad durch. Dann misst der Test die Werkbank.
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(bin, 'gh.cmd'), '@node "%~dp0gh.js" %*\n', 'utf8');
  } else {
    const sh = path.join(bin, 'gh');
    fs.writeFileSync(sh, '#!/bin/sh\nexec node "$(dirname "$0")/gh.js" "$@"\n', 'utf8');
    fs.chmodSync(sh, 0o755);
  }
  return { bin, register };
}

function fallR1Bestaetigen(dir, marke) {
  const anmeldung = fallR1(dir, marke + '-best');
  const runId = anmeldung.args[anmeldung.args.indexOf('--runid') + 1];
  // Erst wirklich anmelden - der Eintrag muss im Register stehen, sonst prueft
  // `bestaetigen` etwas, das es nicht gibt.
  const vor = spawnSync(process.execPath, [anmeldung.skript].concat(anmeldung.args), {
    encoding: 'utf8', cwd: anmeldung.cwd,
  });
  assert.equal(vor.status, 0, 'die Vor-Anmeldung fuer bestaetigen ist rot: ' + (vor.stderr || ''));

  const { bin } = stelleGhBereit(anmeldung.cwd, anmeldung.register);
  return {
    skript: anmeldung.skript,
    args: ['bestaetigen', '--runid', runId, '--ziel', path.join(anmeldung.cwd, 'freigabe.json')],
    register: path.join(anmeldung.cwd, 'freigabe.json'),
    cwd: anmeldung.cwd,
    // Die Freigabe entsteht neu; es gibt kein "vorher" zum Vergleichen.
    entstehtNeu: true,
    // GENAU EIN Suchpfad-Schluessel. Windows fuehrt ihn als `Path`, POSIX als
    // `PATH`; setzt man beide, enthaelt der Umgebungsblock zwei Suchpfade und
    // es ist nicht bestimmt, welchen der Kindprozess nimmt - dann laeuft das
    // ECHTE gh und der Test misst die Werkbank statt das Werkzeug.
    umgebung: (() => {
      const schluessel = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') || 'PATH';
      const u = { SPION_REGISTER: anmeldung.register };
      u[schluessel] = bin + path.delimiter + process.env[schluessel];
      return u;
    })(),
  };
}

// `bestaetigen` ruft `gh` als eigenes Programm. Ein vorgeschobenes Stub-`gh`
// findet der Aufruf nur dort, wo eine ausfuehrbare Datei OHNE Endung reicht -
// unter Windows sucht die Prozess-Erzeugung ohne Shell keine `.cmd` und meldet
// ENOENT, faellt also auf das ECHTE gh im Suchpfad durch. Diese Probe liefe dort
// gegen die Werkbank statt gegen das Werkzeug und waere schlimmer als keine.
// Der Gate-Lauf ist ubuntu-latest (.github/workflows/pr-check.yml), dort laeuft
// sie scharf; auf dem Windows-Rechner wird sie mit Grund uebersprungen.
const NUR_POSIX = process.platform === 'win32'
  ? 'nur auf POSIX: unter Windows findet execFileSync kein Stub-gh ohne Shell (ENOENT)'
  : false;

const WERKZEUGE = [
  { name: 'F3b', bau: fallF3b, ueberspringen: false },
  { name: 'RR9-A3', bau: fallRr9, ueberspringen: false },
  { name: 'R1-anmelden', bau: fallR1, ueberspringen: false },
  { name: 'R1-bestaetigen', bau: fallR1Bestaetigen, ueberspringen: NUR_POSIX },
];

// -- (1) Das Register wird nie direkt schreibend geoeffnet --------------------

for (const w of WERKZEUGE) {
  test(w.name + ': das Register entsteht als rename-Ziel, nie als direkt beschriebene Datei',
    { skip: w.ueberspringen }, () => {
    const dir = tempdir(w.name.toLowerCase());
    const fall = w.bau(dir, 'a');
    const vorher = fall.entstehtNeu ? null : dateihash(fall.register);

    const lauf = laufeMitSpion(fall.skript, fall.args,
      { cwd: fall.cwd, spurIn: dir, umgebung: fall.umgebung });
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

    // Und das Ergebnis stimmt: geschrieben wurde wirklich.
    if (fall.entstehtNeu) {
      assert.ok(fs.existsSync(fall.register), w.name + ' hat die Datei nicht angelegt');
    } else {
      assert.notEqual(dateihash(fall.register), vorher,
        w.name + ' hat gar nichts geschrieben - dann misst diese Probe nichts');
      pruefeZugriffsRegister(lies(fall.register)); // nur das Register traegt eine Kette
    }

    // (3) Byte-Format: exakt die Auslieferungs-Formatierung, kein Zeichen anders.
    assert.equal(
      fs.readFileSync(fall.register, 'utf8'),
      alsRegisterBytes(lies(fall.register)),
      w.name + ' hat umformatiert - beim Register braeche das die Verkettung bestehender Eintraege',
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
  test(w.name + ': ein Abbruch mitten im Schreiben laesst das Register byte-identisch',
    { skip: w.ueberspringen }, () => {
    const dir = tempdir(w.name.toLowerCase() + '-abbruch');
    const fall = w.bau(dir, 'b');
    const vorher = fall.entstehtNeu ? null : dateihash(fall.register);
    const bytesVorher = fall.entstehtNeu ? null : fs.readFileSync(fall.register, 'utf8');

    const lauf = laufeMitSpion(fall.skript, fall.args,
      { abbruch: true, cwd: fall.cwd, spurIn: dir, umgebung: fall.umgebung });
    assert.notEqual(lauf.status, 0,
      w.name + ' meldet Erfolg, obwohl der Schreibvorgang abgebrochen wurde');
    assert.ok(lauf.spur && lauf.spur.abbruchAusgeloest,
      'Der Abbruch wurde nie ausgeloest - die Probe misst nichts');

    // Der Abbruch muss DAS REGISTER getroffen haben, nicht irgendeine Datei.
    // Ohne diese Zeile geht die Probe gruen durch, sobald ein Werkzeug vor dem
    // Register-Schreibvorgang irgendetwas anderes schreibt (Debug-Log,
    // Sperrdatei, Telemetrie): der Abbruch faengt dann die fremde Datei, das
    // Register bleibt unberuehrt, und alle uebrigen Zusicherungen halten -
    // auch bei vollstaendig zurueckgebautem, nicht-atomarem Schreibweg.
    // Ausgefuehrt reproduziert im ecc-Review 30.08.
    // Zugelassen ist genau zweierlei: das Register selbst (der nicht-atomare
    // Fall, den wir ausschliessen wollen) oder SEINE Zwischendatei nach dem
    // Muster aus lib/atomic-write.js (`<ziel>.tmp.<pid>.<n>`). Ein blosses
    // "faengt mit dem Zielpfad an" reicht NICHT: eine Nachbardatei wie
    // `<ziel>.debug.log` erfuellt das auch und liesse die Probe wieder gruen
    // durchgehen. Genau daran ist die erste Fassung dieser Zeile gescheitert.
    const zielPfad = path.resolve(fall.register);
    const getroffen = String(lauf.spur.abbruchPfad);
    assert.ok(
      getroffen === zielPfad || /^\.tmp\.\d+\.\d+$/.test(getroffen.slice(zielPfad.length)),
      w.name + ': der Abbruch traf ' + getroffen + ' statt das Register (' + zielPfad
        + ') oder dessen Zwischendatei - diese Probe misst dann nichts',
    );

    if (fall.entstehtNeu) {
      // Eine abgebrochene NEUANLAGE darf keinen Torso hinterlassen: das
      // Freigabe-Protokoll ist ein Tor, und ein halbes Tor ist ein Parse-Fehler
      // an genau der Stelle, an der ein Halt gemeint war.
      assert.equal(fs.existsSync(fall.register), false,
        w.name + ': der Abbruch hat einen Torso hinterlassen');
    } else {
      assert.equal(dateihash(fall.register), vorher,
        w.name + ': das Register ist nach dem Abbruch veraendert');
      assert.equal(fs.readFileSync(fall.register, 'utf8'), bytesVorher);
      pruefeZugriffsRegister(lies(fall.register)); // wirft, wenn die Kette gebrochen waere
    }
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

// -- (5) Die Werkbank selbst: das Stub-gh darf seinen Rumpf nicht abschneiden --

// Der Spion-gh schreibt eine base64-Huelle des Registers auf stdout. Auf eine
// PIPE schreibt Node asynchron; ein direkt folgendes process.exit() schnitt den
// Rest ab, sobald der Rumpf den Pipe-Puffer ueberstieg. Das Werkzeug bekam dann
// halbes JSON und die Probe war rot, ohne dass am Werkzeug etwas falsch war.
// Diese Probe faehrt den Stub mit einem bewusst grossen Register.
test('Werkbank: das Stub-gh liefert auch einen grossen Rumpf vollstaendig', () => {
  const dir = tempdir('stub-gross');
  const register = path.join(dir, 'gross.json');
  // Deutlich ueber jedem ueblichen Pipe-Puffer (64 KiB), damit die Probe die
  // Abschneide-Stelle wirklich erreicht und nicht zufaellig darunter bleibt.
  const fuellung = 'x'.repeat(400 * 1024);
  fs.writeFileSync(register, JSON.stringify({ events: [], fuellung }), 'utf8');

  const { bin } = stelleGhBereit(dir, register);
  const lauf = spawnSync(process.execPath, [path.join(bin, 'gh.js'), 'api', 'egal'], {
    encoding: 'utf8', env: { ...process.env, SPION_REGISTER: register }, maxBuffer: 64 * 1024 * 1024,
  });

  assert.equal(lauf.status, 0, 'das Stub-gh ist rot: ' + (lauf.stderr || ''));
  const trenner = lauf.stdout.indexOf('\r\n\r\n');
  assert.ok(trenner > 0, 'der Stub hat keinen Kopf/Rumpf-Trenner geschrieben');
  const rumpf = lauf.stdout.slice(trenner + 4);
  const geparst = JSON.parse(rumpf);   // genau hier riss es vorher
  const zurueck = Buffer.from(geparst.content, geparst.encoding).toString('utf8');
  assert.equal(zurueck, fs.readFileSync(register, 'utf8'),
    'der zurueckgelesene Inhalt ist nicht der des Registers - der Rumpf war unvollstaendig');
});
