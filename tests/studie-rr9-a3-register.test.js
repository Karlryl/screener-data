'use strict';

// Studie 2.0, RR9-A3 Ziffer 2 — der Waechter ueber dem Register-Werkzeug fuer
// Eintrag 22 (Jahrgangs-Registrierung, ENTSCHIED 130).
//
// DIE SACHE: scripts/studie-rr9-a3-register.js darf im Standardfall NICHTS
// schreiben und im Schreibfall NUR schreiben, wenn die Tore offen sind. Alle
// werden AM OBJEKT geprueft — an Dateiinhalten und Exit-Codes, nicht an
// Formulierungen im Kopf des Skripts:
//
//   (a) der Trockenlauf laesst das ECHTE Register byte-identisch.
//   (b) ein manipulierter previousHash / ein verschobenes Kettenende bricht.
//   (c) ein verstelltes Jahrgangs-Artefakt wird abgewiesen — auf JEDER der vier
//       Achsen (Jahrgangswert, Abweichungs-Flag, Eskalation, Hashes), und jede
//       Achse ist erreichbar, weil die inhaltlichen Tore VOR den Hash-Toren
//       stehen.
//   (d) eine schon vergebene runId wird abgewiesen.
//   (e) der gebaute Eintrag autorisiert nachweislich nichts.
//
// JEDE WACHE WIRD AUCH IN IHRER ABWESENHEIT GEPRUEFT: neben der roten Probe
// laeuft dieselbe Pruefung auf der UNVERSEHRTEN Kopie (muss gruen sein), und wo
// die Wache im Skript sitzt, laeuft zusaetzlich eine Probe gegen ein Skript, dem
// genau diese Wache herausoperiert wurde.
//
// HARTE GRENZE: kein Test fasst protocol/early-detection/2.0.0/outcome-access-ledger.json
// schreibend an. Geschrieben wird ausschliesslich in Kopien unterhalb von os.tmpdir().

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const REPO = path.join(__dirname, '..');
const SKRIPT = path.join(REPO, 'scripts', 'studie-rr9-a3-register.js');
const LEDGER = path.join(REPO, 'protocol', 'early-detection', '2.0.0', 'outcome-access-ledger.json');
const ARTEFAKT = path.join(
  REPO, 'protocol', 'early-detection', '2.1.0', 'jahrgang-registrierung-2026-08-30.json',
);
const LIB = path.join(REPO, 'lib', 'studie-verfassung.js');
const { RUN_ID, INHALT_SHA256, DATEI_SHA256 } = require('../scripts/studie-rr9-a3-register');

const dateihash = (pfad) => crypto.createHash('sha256').update(fs.readFileSync(pfad)).digest('hex');
const lies = (pfad) => JSON.parse(fs.readFileSync(pfad, 'utf8'));
const schreib = (pfad, obj) => fs.writeFileSync(pfad, `${JSON.stringify(obj, null, 1)}\n`, 'utf8');

function tempdir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rr9a3-'));
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Arbeitskopien. Das Original wird gelesen, nie geschrieben.
//
// Die Kopie wird auf die ERSTEN 21 Eintraege geschnitten, statt den Live-Stand zu
// spiegeln. Grund wie bei tests/studie-f3b-register.test.js: sobald Eintrag 22
// auf main liegt, waere eine 1:1-Kopie ein Register, das dieses Werkzeug zu Recht
// abweist — die Waechter wuerden nach dem echten Schreibvorgang dauerhaft rot.
// Das Schneiden ist zulaessig, weil das Register nur-anhaengend ist: der
// 21er-Praefix IST der Stand vor Eintrag 22, und genau diese Praefix-Eigenschaft
// ist in tests/studie-r1-register.test.js eigenstaendig verankert.
const VOR_EINTRAG_22 = 21;

function kopien(dir, marke = String(Math.random()).slice(2, 8)) {
  const register = path.join(dir, `ledger-${marke}.json`);
  const jahrgang = path.join(dir, `jahrgang-${marke}.json`);
  const live = lies(LEDGER);
  assert.ok(live.events.length >= VOR_EINTRAG_22, 'Das Register hat weniger als 21 Eintraege');
  schreib(register, { ...live, events: live.events.slice(0, VOR_EINTRAG_22) });
  fs.copyFileSync(ARTEFAKT, jahrgang);
  return { register, jahrgang };
}

function laufeMit(skript, args) {
  const ergebnis = spawnSync(process.execPath, [skript, ...args], { encoding: 'utf8', cwd: REPO });
  return { status: ergebnis.status, aus: ergebnis.stdout || '', fehler: ergebnis.stderr || '' };
}

const laufe = (args) => laufeMit(SKRIPT, args);

// Ein Skript-Zwilling mit herausoperierter Wache. Der Bibliothekspfad wird
// absolut gesetzt, weil der Zwilling ausserhalb von scripts/ liegt.
function saboteur(dir, name, suchen, ersetzen) {
  const quelle = fs.readFileSync(SKRIPT, 'utf8');
  assert.ok(quelle.includes(suchen), `Sabotage-Anker nicht gefunden: ${suchen}`);
  const ziel = path.join(dir, name);
  fs.writeFileSync(
    ziel,
    quelle.replace(suchen, ersetzen).replace("require('../lib/studie-verfassung')", `require(${JSON.stringify(LIB)})`),
    'utf8',
  );
  return ziel;
}

// Kopie des Artefakts mit EINER gezielten Aenderung. Weil der Datei-Hash sonst
// sofort bricht, wird bei Bedarf der Inhalts-Hash mitgezogen — dann prueft die
// Probe wirklich das inhaltliche Tor und nicht nur "Bytes anders".
function verstellt(dir, marke, aenderung, { hashNachziehen = false } = {}) {
  const ziel = path.join(dir, `jahrgang-${marke}.json`);
  const datei = lies(ARTEFAKT);
  aenderung(datei);
  if (hashNachziehen) {
    // Dieselbe Kanonisierung wie im Werkzeug: Python-Form ohne Leerzeichen.
    const { kanonischOhneLeerzeichen } = require('../scripts/studie-rr9-a3-register');
    datei.inhaltSha256 = crypto.createHash('sha256')
      .update(kanonischOhneLeerzeichen(datei.inhalt), 'utf8').digest('hex');
  }
  fs.writeFileSync(ziel, `${JSON.stringify(datei, null, 1)}\n`, 'utf8');
  return ziel;
}

// ── Das Artefakt selbst ───────────────────────────────────────────────────────

test('RR9-A3: das Artefakt auf main traegt genau die beiden registrierten Hashes', () => {
  const datei = lies(ARTEFAKT);
  assert.equal(dateihash(ARTEFAKT), DATEI_SHA256);
  assert.equal(datei.inhaltSha256, INHALT_SHA256);
  assert.equal(datei.inhalt.gewaehlterJahrgang, 'legacy_earliest_archived');
  assert.equal(datei.inhalt.gemessenerJahrgangDerBasis, 'legacy_earliest_archived');
  assert.equal(datei.inhalt.weichenBeideVoneinanderAb, false);
  // Die Kanonisierung ist ASCII-treu nur, solange der Block ASCII ist. Faellt das,
  // muessen JSON.stringify und Pythons ensure_ascii=False neu verglichen werden.
  assert.ok(
    // eslint-disable-next-line no-control-regex
    /^[\x00-\x7F]*$/.test(JSON.stringify(datei.inhalt)),
    'Der Inhalts-Block ist nicht mehr reines ASCII — die JS/Python-Kanonisierung muss neu geprueft werden',
  );
});

// ── (a) Der Trockenlauf schreibt nachweislich nicht ───────────────────────────

test('RR9-A3 (a): der Trockenlauf laesst das echte Register byte-identisch', () => {
  const vorher = dateihash(LEDGER);
  const anzahlVorher = lies(LEDGER).events.length;
  const lauf = laufe([]);
  // Der Exit-Code darf sich mit dem Leben des Registers aendern: vor Eintrag 22
  // gruen, danach die Abweisung der schon vergebenen runId. NICHT aendern darf
  // sich die Datei — das ist die Wache.
  assert.equal(dateihash(LEDGER), vorher, 'Der Trockenlauf hat das echte Register veraendert');
  assert.equal(lies(LEDGER).events.length, anzahlVorher, 'Der Trockenlauf hat die Eintragszahl veraendert');
  if (lauf.status === 0) {
    assert.match(lauf.aus, /eventHash Eintrag 22: [0-9a-f]{64}/, 'Der Trockenlauf druckt keinen eventHash');
    assert.match(lauf.aus, /TROCKENLAUF - es wurde NICHTS geschrieben/);
  } else {
    assert.match(
      lauf.fehler, /steht schon im Register|juengste Eintrag ist nicht der erwartete/,
      `Trockenlauf rot aus unerwartetem Grund: ${lauf.fehler}`,
    );
  }

  // Abwesenheits-Probe: ein Zwilling, dem die Trockenlauf-Weiche fehlt, schreibt
  // — sonst wuerde der Datei-Hash-Vergleich oben nur beweisen, dass dieses
  // Skript ueberhaupt nie schreibt.
  const dir = tempdir();
  const { register, jahrgang } = kopien(dir);
  const immerSchreibend = saboteur(dir, 'ohne-weiche.js', '  if (!schreiben) {', '  if (false) {');
  const kopieVorher = dateihash(register);
  const probe = laufeMit(immerSchreibend, ['--register', register, '--jahrgang', jahrgang]);
  assert.equal(probe.status, 0, `Zwilling rot: ${probe.fehler}`);
  assert.notEqual(
    dateihash(register), kopieVorher,
    'Der ausgebaute Trockenlauf schreibt nicht — dann misst der Hash-Vergleich nichts',
  );
});

// ── (b) Die Kettenpruefung ────────────────────────────────────────────────────

test('RR9-A3 (b): manipulierter previousHash und verschobenes Kettenende brechen', () => {
  const dir = tempdir();
  const { register, jahrgang } = kopien(dir);

  const sauber = laufe(['--register', register, '--jahrgang', jahrgang]);
  assert.equal(sauber.status, 0, `Die unversehrte Kopie ist rot: ${sauber.fehler}`);
  assert.match(sauber.aus, /"previousHash": "9f32e5928acf36d1/, 'Der Eintrag haengt nicht an Eintrag 21');

  const kaputt = lies(register);
  kaputt.events[10].previousHash = 'f'.repeat(64);
  schreib(register, kaputt);
  const lauf = laufe(['--register', register, '--jahrgang', jahrgang]);
  assert.equal(lauf.status, 1, 'Der Lauf ueberlebt einen manipulierten previousHash');
  assert.match(lauf.fehler, /Kette bricht bei Eintrag 10/);

  // Zweite Bruchstelle derselben Wache: ein verschobenes Kettenende. Die Kette
  // ist dann in sich gueltig — nur nicht mehr die, auf die dieser Eintrag gehoert.
  const { register: zweiter } = kopien(dir);
  const gekuerzt = lies(zweiter);
  gekuerzt.events.pop();
  schreib(zweiter, gekuerzt);
  const lauf2 = laufe(['--register', zweiter, '--jahrgang', jahrgang]);
  assert.equal(lauf2.status, 1, 'Der Lauf haengt sich an ein fremdes Kettenende');
  assert.match(lauf2.fehler, /juengste Eintrag ist nicht der erwartete|fuehrt 20 Eintraege/);

  // Abwesenheits-Probe: ohne den Vorab-Aufruf bleibt der Lauf rot, weil
  // haengeEintragAn die Kette selbst nachrechnet. Die Wache ist doppelt
  // gesichert; ihr Zweck ist die Diagnose VOR dem Bau des Eintrags.
  const ohneKette = saboteur(
    dir, 'ohne-kette.js',
    '  const stand = pruefeZugriffsRegister(register);',
    '  const stand = { eventCount: 21, tailHash: null };',
  );
  const probe = laufeMit(ohneKette, ['--register', register, '--jahrgang', jahrgang]);
  assert.equal(probe.status, 1, 'Ohne die Kettenpruefung liefe ein Eintrag auf eine kaputte Kette');
});

// ── (c) Das Jahrgangs-Tor, auf allen vier Achsen ──────────────────────────────

test('RR9-A3 (c): jede der vier Achsen des Jahrgangs-Tors ist erreichbar und rot', () => {
  const dir = tempdir();
  const { register, jahrgang } = kopien(dir);
  assert.equal(
    laufe(['--register', register, '--jahrgang', jahrgang]).status, 0,
    'Die unversehrte Kopie ist rot',
  );

  // 1. Ein anderer Jahrgang.
  const andererJahrgang = verstellt(dir, 'v1', (d) => {
    d.inhalt.gewaehlterJahrgang = 'post_2024_reprocessed_or_current';
  }, { hashNachziehen: true });
  const l1 = laufe(['--register', register, '--jahrgang', andererJahrgang]);
  assert.equal(l1.status, 1);
  assert.match(l1.fehler, /registriert wird "legacy_earliest_archived"/);

  // 2. Das Abweichungs-Flag. Es traegt A2 Satz 3 — ein Eintrag, der es
  //    uebergeht, beurkundet ein nicht ausgeloestes Zitierverbot als ausgeloest.
  const abweichend = verstellt(dir, 'v2', (d) => {
    d.inhalt.weichenBeideVoneinanderAb = true;
  }, { hashNachziehen: true });
  const l2 = laufe(['--register', register, '--jahrgang', abweichend]);
  assert.equal(l2.status, 1);
  assert.match(l2.fehler, /weichen voneinander ab/);

  // 3. Die Eskalation nach Ziffer 6 gehoert an den vollen Rat, nicht ins Register.
  const eskaliert = verstellt(dir, 'v3', (d) => {
    d.eskalationNachZiffer6 = 'EINGETRETEN: die Jahrgangsfrage geht an den vollen Rat.';
  });
  const l3 = laufe(['--register', register, '--jahrgang', eskaliert]);
  assert.equal(l3.status, 1);
  assert.match(l3.fehler, /Eskalation ist eingetreten/);

  // 4a. Ein verstelltes Hash-FELD bei unveraendertem Inhalt: die Datei
  //     widerspricht sich selbst.
  const selbstwiderspruch = verstellt(dir, 'v4', (d) => {
    d.inhaltSha256 = '0'.repeat(64);
  });
  const l4 = laufe(['--register', register, '--jahrgang', selbstwiderspruch]);
  assert.equal(l4.status, 1);
  assert.match(l4.fehler, /widerspricht sich selbst/);

  // 4b. Ein konsistent nachgezogener Inhalt, der die drei inhaltlichen Tore
  //     passiert: faellt am registrierten Inhalts-Hash.
  const stillGeaendert = verstellt(dir, 'v5', (d) => {
    d.inhalt.kette.e1PayloadsGebaut = 63;
  }, { hashNachziehen: true });
  const l5 = laufe(['--register', register, '--jahrgang', stillGeaendert]);
  assert.equal(l5.status, 1);
  assert.match(l5.fehler, /Inhalts-Block hasht auf/);

  // 4c. Unveraenderter `inhalt`, umgeschriebener Begleittext: nur der Datei-Hash
  //     faengt das. Genau deswegen gibt es ihn zusaetzlich.
  const umgeschrieben = verstellt(dir, 'v6', (d) => {
    d.registerHinweis = 'Alles war immer in Ordnung.';
  });
  const l6 = laufe(['--register', register, '--jahrgang', umgeschrieben]);
  assert.equal(l6.status, 1);
  assert.match(l6.fehler, /registriert ist aa4277fa/);

  // Abwesenheits-Probe: ohne das Tor laeuft das verstellte Artefakt durch.
  const ohneTor = saboteur(
    dir, 'ohne-tor.js',
    '  const hashes = pruefeJahrgang(jahrgangPfad);',
    '  const hashes = { dateiHash: "x", inhalt: "x", jahrgang: "x" };',
  );
  const probe = laufeMit(ohneTor, ['--register', register, '--jahrgang', andererJahrgang]);
  assert.equal(probe.status, 0, 'Auch ohne das Jahrgangs-Tor rot — dann misst der Test etwas anderes');
});

// ── (d) Eine doppelte runId wird abgewiesen ───────────────────────────────────

test('RR9-A3 (d): dieselbe runId ein zweites Mal wird abgewiesen', () => {
  const dir = tempdir();
  const { register, jahrgang } = kopien(dir);

  const erster = laufe(['--register', register, '--jahrgang', jahrgang, '--schreiben']);
  assert.equal(erster.status, 0, `Der Schreiblauf auf der Kopie ist rot: ${erster.fehler}`);
  const geschrieben = lies(register);
  assert.equal(geschrieben.events.length, 22, 'Der Schreiblauf hat nicht angehaengt');
  assert.equal(geschrieben.events[21].runId, RUN_ID);
  assert.equal(geschrieben.events[21].typ, 'C0_REGELFREEZE');
  assert.equal(
    geschrieben.events[21].previousHash, geschrieben.events[20].eventHash,
    'Der neue Eintrag haengt nicht am bisherigen Kettenende',
  );

  const zweiter = laufe(['--register', register, '--jahrgang', jahrgang, '--schreiben']);
  assert.equal(zweiter.status, 1, 'Derselbe Eintrag laesst sich zweimal schreiben');
  assert.match(zweiter.fehler, /steht schon im Register/);
  assert.equal(lies(register).events.length, 22, 'Der abgewiesene Lauf hat trotzdem angehaengt');

  // Abwesenheits-Probe: ohne die runId-Wache verschwindet genau diese Diagnose.
  const ohneRunId = saboteur(dir, 'ohne-runid.js', '  pruefeRunIdFrei(register, runId);', '');
  const probe = laufeMit(ohneRunId, ['--register', register, '--jahrgang', jahrgang, '--schreiben']);
  assert.doesNotMatch(
    probe.fehler, /steht schon im Register/,
    'Die Meldung kommt auch ohne die Wache — dann prueft der Test nicht die Wache',
  );
});

// ── (f) Der Schreibvorgang ist atomar ─────────────────────────────────────────

test('RR9-A3 (f): bricht der Schreibvorgang ab, bleibt das Register unversehrt', () => {
  // Das Register ist nur-anhaengend und verkettet: eine halb geschriebene Datei
  // hat keinen Reparaturweg im Werkzeug. Geprueft wird am OBJEKT — der Bytes der
  // Kopie —, nicht an der Formulierung des Kommentars.
  const dir = tempdir();
  const { register, jahrgang } = kopien(dir);
  const vorher = dateihash(register);

  const abbruchBeimUmbenennen = saboteur(
    dir, 'rename-bricht.js',
    "    fs.renameSync(daneben, pfad);",
    "    throw new Error('Platte voll (Probe)');",
  );
  const lauf = laufeMit(abbruchBeimUmbenennen, [
    '--register', register, '--jahrgang', jahrgang, '--schreiben',
  ]);
  assert.notEqual(lauf.status, 0, 'der abgebrochene Schreibvorgang meldet Erfolg');
  assert.equal(dateihash(register), vorher, 'das Register ist trotz Abbruch veraendert');
  assert.deepEqual(
    fs.readdirSync(dir).filter((n) => n.includes('.neu-')), [],
    'ein halber Zwischenstand ist liegengeblieben',
  );

  // Abwesenheits-Probe: derselbe Abbruch an einem Zwilling, der DIREKT auf das
  // Register schreibt, laesst es veraendert zurueck. Ohne sie beweist der
  // Hash-Vergleich oben nur, dass irgendetwas fehlschlug.
  const direkt = saboteur(
    dir, 'ohne-atomar.js',
    "  const daneben = `${pfad}.neu-${process.pid}`;\n  try {\n    fs.writeFileSync(daneben, `${JSON.stringify(register, null, 1)}\\n`, 'utf8');\n    fs.renameSync(daneben, pfad);",
    "  const daneben = `${pfad}.neu-${process.pid}`;\n  try {\n    fs.writeFileSync(pfad, `${JSON.stringify(register, null, 1)}\\n`, 'utf8');\n    throw new Error('Platte voll (Probe)');",
  );
  const { register: zweiter, jahrgang: j2 } = kopien(dir);
  const vorher2 = dateihash(zweiter);
  laufeMit(direkt, ['--register', zweiter, '--jahrgang', j2, '--schreiben']);
  assert.notEqual(
    dateihash(zweiter), vorher2,
    'auch der direkte Schreibweg laesst das Register unveraendert — dann misst der Test nichts',
  );
});

// ── (e) Der Eintrag autorisiert nichts ────────────────────────────────────────

test('RR9-A3 (e): der gebaute Eintrag schaltet nachweislich nichts frei', () => {
  const { baueEintrag } = require('../scripts/studie-rr9-a3-register');
  const eintrag = baueEintrag(
    RUN_ID, '2026-08-30T18:00:00.000Z', '2026-08-30T20:00:00.000Z',
    { jahrgang: 'legacy_earliest_archived', inhalt: INHALT_SHA256, dateiHash: DATEI_SHA256 },
  );
  // Am OBJEKT, nicht am Text: eine leere Ausgabe-Allowlist ist das, was
  // "autorisiert keinen Datenzugriff" maschinell bedeutet.
  assert.deepEqual(eintrag.allowedOutputs, []);
  assert.equal(eintrag.typ, 'C0_REGELFREEZE');
  assert.match(eintrag.fenster[0], /kein Studienfenster/);
  assert.ok(Date.parse(eintrag.registeredAt) < Date.parse(eintrag.accessedAt));
  // F4 bleibt gesperrt, und der Eintrag sagt es selbst — sonst koennte sich ein
  // spaeterer Lauf auf ihn berufen.
  assert.match(eintrag.erlaubt, /Auf diesen Eintrag folgt KEIN Zugriffs-Akt/);
  assert.match(eintrag.begruendung, /F4, F5, F5b und F6 bleiben gesperrt/);
  assert.match(eintrag.verboten, /jede Verwendung dieses Eintrags als F4-Freigabe/);
});
