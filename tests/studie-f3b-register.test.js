'use strict';

// Studie 2.0, Phase F3b — der Waechter ueber dem Register-Werkzeug.
//
// DIE SACHE: scripts/studie-f3b-register.js darf im Standardfall NICHTS
// schreiben und im Schreibfall NUR schreiben, wenn vier Tore offen sind. Alle
// vier werden hier AM OBJEKT geprueft — an Dateiinhalten und Exit-Codes, nicht
// an Formulierungen im Kopf des Skripts:
//
//   (a) der Trockenlauf laesst das ECHTE Register byte-identisch. Gemessen wird
//       der SHA-256 der Datei vor und nach dem Lauf.
//   (b) ein manipulierter previousHash in einer KOPIE wird gefunden.
//   (c) eine Konzeptliste mit anderem Hash wird abgewiesen.
//   (d) eine schon vergebene runId wird abgewiesen.
//
// JEDE WACHE WIRD AUCH IN IHRER ABWESENHEIT GEPRUEFT: neben der roten Probe
// laeuft dieselbe Pruefung auf der UNVERSEHRTEN Kopie (muss gruen sein), und wo
// die Wache im Skript sitzt, laeuft zusaetzlich eine Probe gegen ein Skript, dem
// genau diese Wache herausoperiert wurde. Ein Waechter, der nur die Anwesenheit
// sieht, ist nach der ersten Glaettung gruen und wertlos.
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
const SKRIPT = path.join(REPO, 'scripts', 'studie-f3b-register.js');
const LEDGER = path.join(REPO, 'protocol', 'early-detection', '2.0.0', 'outcome-access-ledger.json');
const KONZEPTLISTE = path.join(REPO, 'protocol', 'early-detection', '2.1.0', 'konzeptliste.json');
const LIB = path.join(REPO, 'lib', 'studie-verfassung.js');

const dateihash = (pfad) => crypto.createHash('sha256').update(fs.readFileSync(pfad)).digest('hex');
const lies = (pfad) => JSON.parse(fs.readFileSync(pfad, 'utf8'));
const schreib = (pfad, obj) => fs.writeFileSync(pfad, `${JSON.stringify(obj, null, 1)}\n`, 'utf8');

function tempdir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f3b-'));
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Arbeitskopien. Das Original wird gelesen, nie geschrieben.
//
// Die Kopie wird auf die ERSTEN 20 Eintraege geschnitten, statt den Live-Stand zu
// spiegeln. Grund: sobald Eintrag 21 auf main liegt, waere eine 1:1-Kopie ein
// Register, das dieses Werkzeug zu Recht abweist — die vier Waechter wuerden nach
// dem echten Schreibvorgang dauerhaft rot und blockierten Karls Tageslauf. Das
// Schneiden ist zulaessig, weil das Register nur-anhaengend ist: der 20er-Praefix
// IST der Stand vor Eintrag 21, und genau diese Praefix-Eigenschaft ist in
// tests/studie-r1-register.test.js eigenstaendig verankert.
const VOR_EINTRAG_21 = 20;

function kopien(dir, marke = String(Math.random()).slice(2, 8)) {
  const register = path.join(dir, `ledger-${marke}.json`);
  const konzept = path.join(dir, `konzeptliste-${marke}.json`);
  const live = lies(LEDGER);
  assert.ok(live.events.length >= VOR_EINTRAG_21, 'Das Register hat weniger als 20 Eintraege');
  schreib(register, { ...live, events: live.events.slice(0, VOR_EINTRAG_21) });
  fs.copyFileSync(KONZEPTLISTE, konzept);
  return { register, konzept };
}

function laufe(args) {
  const ergebnis = spawnSync(process.execPath, [SKRIPT, ...args], { encoding: 'utf8', cwd: REPO });
  return { status: ergebnis.status, aus: ergebnis.stdout || '', fehler: ergebnis.stderr || '' };
}

// Ein Skript-Zwilling mit herausoperierter Wache. Der Bibliothekspfad wird
// absolut gesetzt, weil der Zwilling ausserhalb von scripts/ liegt.
function saboteur(dir, name, suchen, ersetzen) {
  const quelle = fs.readFileSync(SKRIPT, 'utf8');
  assert.ok(quelle.includes(suchen), `Sabotage-Anker nicht gefunden: ${suchen}`);
  const ziel = path.join(dir, name);
  fs.writeFileSync(
    ziel,
    quelle.replace(suchen, ersetzen).replace(
      // ALLE ../lib/-Requires absolut setzen, nicht nur studie-verfassung: der
      // Zwilling liegt ausserhalb von scripts/. Fehlt einer, stirbt er an
      // MODULE_NOT_FOUND - und ein Test, der nur 'rot' prueft, liest das als
      // gegriffene Wache. Gefunden 30.08. beim Umbau auf lib/atomic-write.js.
      /require\('\.\.\/lib\/([^']+)'\)/g,
      (_treffer, datei) => `require(${JSON.stringify(path.join(REPO, 'lib', datei))})`,
    ),
    'utf8',
  );
  return ziel;
}

function laufeMit(skript, args) {
  const ergebnis = spawnSync(process.execPath, [skript, ...args], { encoding: 'utf8', cwd: REPO });
  return { status: ergebnis.status, aus: ergebnis.stdout || '', fehler: ergebnis.stderr || '' };
}

// ── (a) Der Trockenlauf schreibt nachweislich nicht ───────────────────────────

test('F3b (a): der Trockenlauf laesst das echte Register byte-identisch', () => {
  const vorher = dateihash(LEDGER);
  const anzahlVorher = lies(LEDGER).events.length;
  const lauf = laufe([]);
  // Der Exit-Code darf sich mit dem Leben des Registers aendern: vor Eintrag 21
  // gruen, danach die Abweisung der schon vergebenen runId. NICHT aendern darf
  // sich die Datei — das ist die Wache.
  assert.equal(dateihash(LEDGER), vorher, 'Der Trockenlauf hat das echte Register veraendert');
  assert.equal(lies(LEDGER).events.length, anzahlVorher, 'Der Trockenlauf hat die Eintragszahl veraendert');
  if (lauf.status === 0) {
    assert.match(lauf.aus, /eventHash Eintrag 21: [0-9a-f]{64}/, 'Der Trockenlauf druckt keinen eventHash');
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
  const { register, konzept } = kopien(dir);
  const immerSchreibend = saboteur(dir, 'ohne-weiche.js', '  if (!schreiben) {', '  if (false) {');
  const kopieVorher = dateihash(register);
  const probe = laufeMit(immerSchreibend, ['--register', register, '--konzeptliste', konzept]);
  assert.equal(probe.status, 0, `Zwilling rot: ${probe.fehler}`);
  assert.notEqual(dateihash(register), kopieVorher, 'Der ausgebaute Trockenlauf schreibt nicht — dann misst der Hash-Vergleich nichts');
});

// ── (b) Die Kettenpruefung findet einen manipulierten previousHash ────────────

test('F3b (b): ein manipulierter previousHash in der Kopie bricht den Lauf', () => {
  const dir = tempdir();
  const { register, konzept } = kopien(dir);

  const sauber = laufe(['--register', register, '--konzeptliste', konzept]);
  assert.equal(sauber.status, 0, `Die unversehrte Kopie ist rot: ${sauber.fehler}`);

  const kaputt = lies(register);
  kaputt.events[10].previousHash = 'f'.repeat(64);
  schreib(register, kaputt);
  const lauf = laufe(['--register', register, '--konzeptliste', konzept]);
  assert.equal(lauf.status, 1, 'Der Lauf ueberlebt einen manipulierten previousHash');
  assert.match(lauf.fehler, /Kette bricht bei Eintrag 10/);

  // Zweite Bruchstelle derselben Wache: ein verschobenes Kettenende. Die Kette
  // ist dann in sich gueltig — nur nicht mehr die, auf die dieser Eintrag gehoert.
  const { register: zweiter } = kopien(dir);
  const gekuerzt = lies(zweiter);
  gekuerzt.events.pop();
  schreib(zweiter, gekuerzt);
  const lauf2 = laufe(['--register', zweiter, '--konzeptliste', konzept]);
  assert.equal(lauf2.status, 1, 'Der Lauf haengt sich an ein fremdes Kettenende');
  assert.match(lauf2.fehler, /juengste Eintrag ist nicht der erwartete|fuehrt 19 Eintraege/);

  // Abwesenheits-Probe: ohne den Vorab-Aufruf bleibt der Lauf rot, weil
  // haengeEintragAn die Kette selbst nachrechnet. Die Wache ist also doppelt
  // gesichert; ihr Zweck ist die Diagnose VOR dem Bau des Eintrags.
  const ohneKette = saboteur(dir, 'ohne-kette.js', '  const stand = pruefeKette(register);', '  const stand = { eventCount: 20, tailHash: null };');
  const probe = laufeMit(ohneKette, ['--register', register, '--konzeptliste', konzept]);
  assert.equal(probe.status, 1, 'Ohne die Kettenpruefung liefe ein Eintrag auf eine kaputte Kette');
});

// ── (c) Eine andere Konzeptliste wird abgewiesen ──────────────────────────────

test('F3b (c): eine Konzeptliste mit anderem Hash wird abgewiesen', () => {
  const dir = tempdir();
  const { register, konzept } = kopien(dir);

  const liste = lies(konzept);
  liste.konzeptliste.push({
    taxonomy: 'us-gaap',
    concept: 'HeimlichNachgeschoben',
    entityKlassen: ['operativ'],
    eintrittsModus: 'reiner_fallback',
    brutto: true,
    eigenesStratum: false,
  });
  schreib(konzept, liste);
  const lauf = laufe(['--register', register, '--konzeptliste', konzept]);
  assert.equal(lauf.status, 1, 'Eine fuenfte Kennung kommt durch');
  assert.match(lauf.fehler, /Konzeptliste traegt den Hash/);

  // Dieselbe Wache ueber der Kontaminations-Vorgeschichte: sie ist Pflichtinhalt
  // des Eintrags und faellt in einem geglaetteten Protokoll als Erstes weg.
  const { konzept: zweiter } = kopien(dir);
  const glatt = lies(zweiter);
  glatt.kontaminationsVorgeschichte = 'Alles war immer in Ordnung.';
  schreib(zweiter, glatt);
  const lauf2 = laufe(['--register', register, '--konzeptliste', zweiter]);
  assert.equal(lauf2.status, 1, 'Eine geglaettete Vorgeschichte kommt durch');
  assert.match(lauf2.fehler, /Kontaminations-Vorgeschichte traegt den Hash/);

  // Abwesenheits-Probe: ohne die Hash-Wache laeuft die manipulierte Liste durch.
  const ohneHash = saboteur(dir, 'ohne-hash.js', '  const hashes = pruefeKonzeptliste(konzeptPfad);', '  const hashes = { liste: "x", kontamination: "x", version: "x", status: "x" };');
  const probe = laufeMit(ohneHash, ['--register', register, '--konzeptliste', konzept]);
  assert.equal(probe.status, 0, 'Auch ohne die Hash-Wache rot — dann misst der Test etwas anderes');
});

// ── (d) Eine doppelte runId wird abgewiesen ───────────────────────────────────

test('F3b (d): dieselbe runId ein zweites Mal wird abgewiesen', () => {
  const dir = tempdir();
  const { register, konzept } = kopien(dir);

  const erster = laufe(['--register', register, '--konzeptliste', konzept, '--schreiben']);
  assert.equal(erster.status, 0, `Der Schreiblauf auf der Kopie ist rot: ${erster.fehler}`);
  const geschrieben = lies(register);
  assert.equal(geschrieben.events.length, 21, 'Der Schreiblauf hat nicht angehaengt');
  assert.equal(geschrieben.events[20].runId, 'f3-konzeptliste-freeze-2026-08-30');
  assert.equal(geschrieben.events[20].typ, 'C0_REGELFREEZE');
  assert.equal(
    geschrieben.events[20].previousHash, geschrieben.events[19].eventHash,
    'Der neue Eintrag haengt nicht am bisherigen Kettenende',
  );

  const zweiter = laufe(['--register', register, '--konzeptliste', konzept, '--schreiben']);
  assert.equal(zweiter.status, 1, 'Derselbe Eintrag laesst sich zweimal schreiben');
  assert.match(zweiter.fehler, /steht schon im Register/);
  assert.equal(lies(register).events.length, 21, 'Der abgewiesene Lauf hat trotzdem angehaengt');

  // Abwesenheits-Probe: ohne die runId-Wache verschwindet genau diese Diagnose.
  const ohneRunId = saboteur(dir, 'ohne-runid.js', '  pruefeRunIdFrei(register, runId);', '');
  const probe = laufeMit(ohneRunId, ['--register', register, '--konzeptliste', konzept, '--schreiben']);
  assert.doesNotMatch(
    probe.fehler, /steht schon im Register/,
    'Die Meldung kommt auch ohne die Wache — dann prueft der Test nicht die Wache',
  );
});
