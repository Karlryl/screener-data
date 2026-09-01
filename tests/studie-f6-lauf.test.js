'use strict';

// F6-LAUF - der Waechter ueber dem konfirmatorischen Laeufer des F6-Tors.
// _COURT-F6-VOLLZUG-2026-08-31, Auflagen F6-B7, F6-B10..B15, F6-B19.
//
// DIE SACHE: scripts/studie-f6-lauf.py hat sechs Phasen, jede fail-closed,
// keine ueberspringbar. Geprueft wird AM OBJEKT - an Exit-Codes, an
// Dateiinhalten und an den Schluesselmengen, die wirklich herauskommen, nicht
// an Formulierungen im Kopf des Skripts.
//
//   (0) FREIGABE  - POSITIV auf ART_ZUGRIFF, Zeitkette VB-A11.
//   (1) REHASH    - ERSTE Handlung nach der Freigabe, zweiseitig.
//   (2) ZAEHLUNG  - injizierbare Grenze, ohne Bindung fail-closed.
//   (3) SE        - das eingefrorene Modul, Kreuzproben.
//   (4) BAND      - das unangetastete Band-Modul.
//   (5) AUSGABE   - zwei getrennte Listen, zweiseitig UND zweig-bewusst.
//
// DIE UNTAETIGKEIT IST DER HAUPTBEFUND (Probe 0.9): es gibt heute keinen
// Register-Eintrag 25. Der Laeufer muss die ECHTE Freigabe des Eintrags 24
// gegen das ECHTE Register abweisen und dabei nachweislich nichts schreiben.
//
// JEDE ROTE PROBE HAT IHRE GRUENE GEGENPROBE auf der unversehrten Kopie. Eine
// rote Probe ohne sie beweist nur, dass irgendetwas bricht.
//
// HARTE GRENZE: kein Test fasst das echte Register, ein echtes Panel oder
// irgendeine Datei unter protocol/ schreibend an. Geschrieben wird
// ausschliesslich in Kopien unterhalb von os.tmpdir().
//
// Usage: node tests/studie-f6-lauf.test.js

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const python = process.env.PYTHON || 'python';
const REPO = path.join(__dirname, '..');
const SKRIPT = path.join(REPO, 'scripts', 'studie-f6-lauf.py');
const ECHTES_REGISTER = path.join(
  REPO, 'protocol', 'early-detection', '2.0.0', 'outcome-access-ledger.json');
const ECHTE_FREIGABE_24 = path.join(
  REPO, 'reports', 'studie', 'f6-eintrag24-freigabe.json');

// Die Dateien, die der Laeufer rehasht, plus das Band-Modul (nicht gebunden,
// aber geladen). Sie werden in die Fixture-Wurzel kopiert.
const GEBUNDEN = [
  'protocol/early-detection/2.1.0/e2-schwellen-satz-2026-08-30.json',
  'protocol/early-detection/2.1.0/b4-bandregel-2026-08-30.json',
  'protocol/early-detection/2.1.0/f6-vollzug-zweig-a-2026-08-31.json',
  'protocol/early-detection/2.1.0/f6-se-klumpen-v1-wortlaut.json',
  'protocol/early-detection/2.0.0/rules.json',
  'scripts/studie-basisraten.py',
  'scripts/studie-e2-verbreitert.py',
  'scripts/studie-f6-klumpen-se.py',
];
// studie-zaehlprobe.py ist nicht in den Eintraegen 23/24 gebunden (steht also
// nicht in GEBUNDEN), wird aber durch F6-C24 als ausfuehrender Regelcode im
// konfirmatorischen Eintrag gebunden - der Laeufer misst seinen SHA und weist
// ihn aus. Deshalb muss die Fixture-Wurzel ihn tragen.
const MITKOPIERT = GEBUNDEN.concat(['scripts/studie-vb-b4-band.py',
  'scripts/studie-zaehlprobe.py']);

// Der Ledger-Hash beim Start. Die "nicht geschrieben"-Proben messen dagegen,
// nicht gegen eine Ereigniszahl: eine Zaehlung ginge an dem Tag rot, an dem
// der Eintrag 25 legitim entsteht.
const dateihash = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const REGISTER_BEIM_START = dateihash(ECHTES_REGISTER);

function tempdir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// ── Die Fixture-Welt ────────────────────────────────────────────────────────

const RUN_ID = 'f6-konfirmatorisch-fixture';
const FENSTER = 'pruefung';
const EVENT_HASH = 'f'.repeat(64);

// Zeiten so gesetzt, dass die Kette registeredAt < serverConfirmedAt <=
// accessedAt <= jetzt fuer jeden Lauf gilt: alle drei liegen in der
// Vergangenheit.
const T_REG = '2026-01-01T00:00:00.000Z';
const T_SRV = '2026-01-01T00:30:00.000Z';
const T_ACC = '2026-01-01T01:00:00.000Z';

function welt(prefix, opt = {}) {
  const dir = tempdir(prefix);
  const wurzel = path.join(dir, 'repo');
  for (const rel of MITKOPIERT) {
    const ziel = path.join(wurzel, ...rel.split('/'));
    fs.mkdirSync(path.dirname(ziel), { recursive: true });
    fs.copyFileSync(path.join(REPO, ...rel.split('/')), ziel);
  }

  // Register = echte Kopie (Eintraege 23/24 bleiben intakt, sonst schluege die
  // Gegenrichtung des Rehash an) + ein synthetischer konfirmatorischer Eintrag.
  const register = JSON.parse(fs.readFileSync(ECHTES_REGISTER, 'utf8'));
  register.events.push({
    runId: RUN_ID,
    typ: opt.art || 'confirmatory_execution_authorized',
    registeredAt: T_REG,
    accessedAt: opt.accessedAt || T_ACC,
    fenster: [FENSTER],
    allowedOutputs: [],
    erlaubt: 'Fixture. Kein echter Akt.',
    verboten: 'Fixture.',
    begruendung: 'Fixture-Eintrag ausschliesslich fuer tests/studie-f6-lauf.test.js.',
    endtestSiegel: 'Fixture - unberuehrt.',
    previousHash: '0'.repeat(64),
    eventHash: EVENT_HASH,
  });
  const registerPfad = path.join(dir, 'register.json');
  fs.writeFileSync(registerPfad, `${JSON.stringify(register, null, 1)}\n`, 'utf8');

  const freigabePfad = path.join(dir, 'freigabe.json');
  fs.writeFileSync(freigabePfad, `${JSON.stringify({
    schema: 'early-detection-zaehlprobe-freigabe/v1',
    protokoll: 'FEM-SEC-US@2.0.0',
    runId: RUN_ID,
    fenster: FENSTER,
    registerEventHash: opt.eventHash || EVENT_HASH,
    registerZweig: opt.zweig || 'main',
    registeredAt: opt.registeredAt || T_REG,
    accessedAt: opt.accessedAt || T_ACC,
    serverConfirmedAt: opt.serverConfirmedAt || T_SRV,
  }, null, 1)}\n`, 'utf8');

  // Ein Fixture-"Panel". Der Laeufer prueft nur, dass es existiert; geoeffnet
  // wird es ausschliesslich vom Zaehlwerk, und das Fixture-Zaehlwerk fasst es
  // nicht an. KEIN echtes Panel wird je angefasst.
  const panel = path.join(dir, 'panel-validierung.sqlite');
  fs.writeFileSync(panel, 'FIXTURE - kein Panel', 'utf8');

  return { dir, wurzel, registerPfad, freigabePfad, panel,
    bericht: path.join(dir, 'bericht.json') };
}

// Singleton-Klumpen (n_g = 1), die nach PIN 3 erwartete Lage.
function tally(reif, unreif) {
  const klumpen = [];
  for (let i = 0; i < reif; i += 1) klumpen.push([1, 1]);
  for (let i = 0; i < unreif; i += 1) klumpen.push([0, 1]);
  return {
    klumpen,
    n: reif + unreif,
    zaehler: reif,
    zerlegung: {
      n_A: reif + unreif, n_B_reif: reif, n_B_unreif: unreif, n_verloren: 0,
      feuerfaehig: reif, strukturell_nicht_feuerfaehig: unreif, rechts_zensiert: 0,
    },
  };
}

// Das Zaehlwerk als eigene Datei - genau die injizierbare Grenze aus Phase 2.
function zaehlwerk(dir, daten, name = 'zaehlwerk.py') {
  const p = path.join(dir, name);
  fs.writeFileSync(p, [
    'import json',
    `DATEN = json.loads(r"""${JSON.stringify(daten)}""")`,
    'def zaehle(panel_pfad, variante, arm):',
    '    return DATEN[variante][arm]',
    '',
  ].join('\n'), 'utf8');
  return p;
}

// Ein Satz, der in ALLEN vier Zellen dasselbe Bild zeigt.
function gleichmaessig(reif, unreif) {
  const eins = tally(reif, unreif);
  return { 'S-U': { signal: eins, kontrollpool: eins },
    'S-G': { signal: eins, kontrollpool: eins } };
}

function ruf(w, extra = []) {
  return spawnSync(python, [SKRIPT,
    '--freigabe', w.freigabePfad, '--panel', w.panel, '--bericht', w.bericht,
    '--wurzel', w.wurzel, '--register', w.registerPfad, ...extra],
  { encoding: 'utf8' });
}

// Ein Abbruch ist erst dann einer, wenn er als FEHLSCHLAG ankommt: Exit != 0,
// KEIN Bericht geschrieben, und ein BENANNTER Grund. Ohne die letzte Zeile
// zaehlte auch ein nackter Traceback als sauberer Abbruch.
function abbruch(w, extra, warum, muster = /^F6-LAUF-ABBRUCH:/m) {
  const r = ruf(w, extra);
  assert.notEqual(r.status, 0, `${warum}: haette abbrechen muessen`);
  assert.equal(fs.existsSync(w.bericht), false,
    `${warum}: bei einem Abbruch darf KEIN Bericht entstehen`);
  assert.match(r.stderr, muster,
    `${warum}: kein benannter Grund, sondern: ${r.stderr.slice(0, 400)}`);
  return r.stderr;
}

// Direkte Proben an den reinen Funktionen - fuer die Faelle, die ueber die CLI
// nicht erreichbar sind, weil der Laeufer sie gar nicht erst erzeugen kann.
function pyProbe(code) {
  return spawnSync(python, ['-c', [
    'import importlib.util, json, sys',
    `spec = importlib.util.spec_from_file_location("f6lauf", r"${SKRIPT}")`,
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    code,
  ].join('\n')], { encoding: 'utf8' });
}

// ============================================================================
// PHASE 0 - Freigabe
// ============================================================================

test('0.1 GRUEN: eine gueltige konfirmatorische Freigabe laesst den Lauf durch', () => {
  const w = welt('f6lauf-gruen-');
  const r = ruf(w, ['--zaehlwerk', zaehlwerk(w.dir, gleichmaessig(230, 20))]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(fs.existsSync(w.bericht), 'der gruene Pfad schreibt einen Bericht');
  assert.match(r.stdout, /Phase 0 FREIGABE/);
  assert.match(r.stdout, /Phase 1 REHASH/);
});

test('0.2 fehlende Freigabe-Datei -> ABBRUCH', () => {
  const w = welt('f6lauf-keine-freigabe-');
  w.freigabePfad = path.join(w.dir, 'gibt-es-nicht.json');
  abbruch(w, ['--zaehlwerk', zaehlwerk(w.dir, gleichmaessig(230, 20))],
    'fehlende Freigabe');
});

test('0.3 falsche Art C0_REGELFREEZE -> ABBRUCH, die Art im Text', () => {
  const w = welt('f6lauf-c0-', { art: 'C0_REGELFREEZE' });
  const text = abbruch(w, ['--zaehlwerk', zaehlwerk(w.dir, gleichmaessig(230, 20))],
    'C0_REGELFREEZE');
  assert.match(text, /C0_REGELFREEZE/);
  assert.match(text, /confirmatory_execution_authorized/);
  assert.match(text, /autorisiert KEINEN\s+Lauf|autorisiert KEINEN Lauf/);
});

test('0.4 falsche Art count_only_probe_authorized -> ABBRUCH', () => {
  const w = welt('f6lauf-zaehlprobe-', { art: 'count_only_probe_authorized' });
  const text = abbruch(w, ['--zaehlwerk', zaehlwerk(w.dir, gleichmaessig(230, 20))],
    'Zaehlproben-Art');
  assert.match(text, /count_only_probe_authorized/);
});

test('0.5 Eintrags-Hash der Freigabe passt nicht -> ABBRUCH', () => {
  const w = welt('f6lauf-hash-', { eventHash: 'a'.repeat(64) });
  abbruch(w, ['--zaehlwerk', zaehlwerk(w.dir, gleichmaessig(230, 20))],
    'falscher registerEventHash');
});

test('0.6 Freigabe gegen einen Seitenzweig -> ABBRUCH', () => {
  const w = welt('f6lauf-zweig-', { zweig: 'feature/x' });
  const text = abbruch(w, ['--zaehlwerk', zaehlwerk(w.dir, gleichmaessig(230, 20))],
    'Zweig != main');
  assert.match(text, /nicht gegen 'main'/);
});

test('0.7 Zeitkette: accessedAt in der Zukunft -> Erstzugriff liegt davor -> ABBRUCH', () => {
  // accessedAt ist eine UNTERGRENZE. Ein Lauf vor ihr ist zu frueh.
  const zukunft = new Date(Date.now() + 86400e3).toISOString().replace(/\.\d+Z$/, '.000Z');
  const w = welt('f6lauf-zufrueh-', { accessedAt: zukunft });
  const text = abbruch(w, ['--zaehlwerk', zaehlwerk(w.dir, gleichmaessig(230, 20))],
    'Erstzugriff vor accessedAt');
  assert.match(text, /liegt VOR der angemeldeten/);
});

test('0.8 Zeitkette: serverConfirmedAt vor registeredAt -> ABBRUCH', () => {
  const w = welt('f6lauf-serverfrueh-', { serverConfirmedAt: '2025-01-01T00:00:00.000Z' });
  const text = abbruch(w, ['--zaehlwerk', zaehlwerk(w.dir, gleichmaessig(230, 20))],
    'serverConfirmedAt vor registeredAt');
  assert.match(text, /nicht vor sich selbst server-bestaetigt/);
});

test('0.7b Zeitkette: serverConfirmedAt NACH accessedAt -> ABBRUCH', () => {
  // Das mittlere Glied. Ohne diese Pruefung geht
  // registriert < accessedAt < serverConfirmedAt < zugriff glatt durch alle
  // uebrigen Schranken (zugriff >= accessedAt folgt aus der Transitivitaet) -
  // und genau das heisst: zum angemeldeten Zugriffszeitpunkt war die
  // Anmeldung noch nicht auf origin.
  const w = welt('f6lauf-serverspaet-', { serverConfirmedAt: '2026-01-01T02:00:00.000Z' });
  const text = abbruch(w, ['--zaehlwerk', zaehlwerk(w.dir, gleichmaessig(230, 20))],
    'serverConfirmedAt nach accessedAt');
  assert.match(text, /liegt NACH der angemeldeten Zugriffszeit/);
});

test('0.6b ein Eintrag mit ZWEI Fenstern autorisiert diesen Lauf nicht', () => {
  // Kein konstruierter Fall: e1b-abnahme-2026-08-16 fuehrt im echten Register
  // ["pruefung 2017-2019", "endtest 2021-2023"] - das zweite ist das
  // Endtest-Fenster. Ein Vergleich nur gegen fenster[0] liesse genau das durch.
  const reg = JSON.parse(fs.readFileSync(ECHTES_REGISTER, 'utf8'));
  assert.ok(reg.events.some((e) => (e.fenster || []).length > 1),
    'die Praemisse dieser Probe steht nicht mehr im Register');

  const w = welt('f6lauf-zweifenster-');
  const r = JSON.parse(fs.readFileSync(w.registerPfad, 'utf8'));
  r.events.find((e) => e.runId === RUN_ID).fenster = [FENSTER, 'endtest 2021-2023'];
  fs.writeFileSync(w.registerPfad, `${JSON.stringify(r, null, 1)}\n`, 'utf8');
  const text = abbruch(w, ['--zaehlwerk', zaehlwerk(w.dir, gleichmaessig(230, 20))],
    'zwei Fenster im Eintrag');
  assert.match(text, /zweites Fenster/);
});

test('2.6 ein abstuerzendes Zaehlwerk: benannter Abbruch, und der Ausnahmetext '
  + 'wird UNTERDRUECKT (F6-B14 gilt auch auf der Fehlerflaeche)', () => {
  // Das Zaehlwerk ist fremder Code und das einzige Glied, das Zeilen je Firma
  // sieht. Ein durchgereichter Traceback druckte seinen Text ungeprueft.
  const w = welt('f6lauf-absturz-');
  const p = path.join(w.dir, 'kracht.py');
  fs.writeFileSync(p,
    'def zaehle(panel_pfad, variante, arm):\n'
    + '    raise KeyError("cik=320193 APPLE INC")\n', 'utf8');
  const text = abbruch(w, ['--zaehlwerk', p], 'abstuerzendes Zaehlwerk');
  assert.match(text, /interner Fehler der Art KeyError/);
  assert.doesNotMatch(text, /APPLE/, 'der Ausnahmetext ist nach stderr geleckt');
  assert.doesNotMatch(text, /320193/, 'die CIK ist nach stderr geleckt');
  assert.doesNotMatch(text, /Traceback/, 'ein nackter Traceback ist kein benannter Abbruch');
});

test('0.9 UNTAETIGKEIT: die ECHTE Eintrag-24-Freigabe gegen das ECHTE Register '
  + 'wird abgewiesen, und nichts wird geschrieben', () => {
  // Der Hauptbefund. Es gibt keinen Eintrag 25; Eintrag 24 ist ein
  // C0_REGELFREEZE und autorisiert keinen Lauf.
  const dir = tempdir('f6lauf-inert-');
  const bericht = path.join(dir, 'bericht.json');
  const r = spawnSync(python, [SKRIPT,
    '--freigabe', ECHTE_FREIGABE_24, '--panel', ECHTES_REGISTER,
    '--bericht', bericht, '--zaehlwerk', zaehlwerk(dir, gleichmaessig(230, 20))],
  { encoding: 'utf8' });

  assert.notEqual(r.status, 0, 'der Laeufer ist heute untaetig');
  assert.match(r.stderr, /^F6-LAUF-ABBRUCH:/m);
  assert.match(r.stderr, /C0_REGELFREEZE/);
  assert.equal(fs.existsSync(bericht), false, 'kein Bericht');
  assert.equal(dateihash(ECHTES_REGISTER), REGISTER_BEIM_START,
    'das echte Register wurde nicht angefasst');
});

// ============================================================================
// PHASE 1 - Rehash (F6-B7)
// ============================================================================

test('1.1 eine veraenderte gebundene Datei -> ABBRUCH, die Datei im Text', () => {
  for (const rel of GEBUNDEN) {
    const w = welt('f6lauf-drift-');
    const ziel = path.join(w.wurzel, ...rel.split('/'));
    fs.appendFileSync(ziel, '\n# Drift\n');
    const text = abbruch(w, ['--zaehlwerk', zaehlwerk(w.dir, gleichmaessig(230, 20))],
      `Drift an ${rel}`);
    assert.match(text, /HASH-ABWEICHUNG/);
    assert.ok(text.includes(rel), `der Abbruch nennt die Datei nicht: ${rel}`);
  }
});

test('1.2 eine fehlende gebundene Datei -> ABBRUCH', () => {
  const w = welt('f6lauf-fehlt-');
  fs.rmSync(path.join(w.wurzel, 'protocol', 'early-detection', '2.0.0', 'rules.json'));
  const text = abbruch(w, ['--zaehlwerk', zaehlwerk(w.dir, gleichmaessig(230, 20))],
    'fehlende Bindung');
  assert.match(text, /GEBUNDENE DATEI FEHLT/);
});

test('1.3 REGISTER-DRIFT: der Sollwert steht nicht mehr im Register -> ABBRUCH', () => {
  // Die Gegenrichtung. Datei und Werkzeug stimmen ueberein, aber der Eintrag,
  // der die Bindung traegt, fuehrt den Wert nicht mehr.
  const w = welt('f6lauf-regdrift-');
  const reg = JSON.parse(fs.readFileSync(w.registerPfad, 'utf8'));
  const i = reg.events.findIndex((e) => e.runId === 'f6-se-klumpen-freeze-2026-08-31');
  // ALLE Vorkommen. Der Hash der rules.json steht in Eintrag 24 zweimal - in
  // der begruendung UND unter bindungen.regelwerk.sha256 -, und der Waechter
  // durchsucht den GANZEN serialisierten Eintrag. Nur eines zu entfernen
  // liesse ihn zu Recht gruen; genau daran ist diese Probe zuerst gescheitert.
  reg.events[i] = JSON.parse(JSON.stringify(reg.events[i]).replaceAll(
    'dc008723798f58fdae3cc67b36817aebf88b090acd8472cedda141f1e4b021bc', 'ENTFERNT'));
  fs.writeFileSync(w.registerPfad, `${JSON.stringify(reg, null, 1)}\n`, 'utf8');
  const text = abbruch(w, ['--zaehlwerk', zaehlwerk(w.dir, gleichmaessig(230, 20))],
    'Register-Drift');
  assert.match(text, /REGISTER-DRIFT/);
});

test('1.4 REIHENFOLGE: die Freigabe steht VOR dem Rehash', () => {
  // Beides kaputt. Kommt der Rehash-Fehler zuerst, ist die Phasenordnung
  // verdreht - dann haette der Laeufer gehasht, bevor er autorisiert war.
  const w = welt('f6lauf-ordnung-', { art: 'C0_REGELFREEZE' });
  fs.appendFileSync(path.join(w.wurzel, 'protocol', 'early-detection', '2.0.0',
    'rules.json'), '\n# Drift\n');
  const text = abbruch(w, ['--zaehlwerk', zaehlwerk(w.dir, gleichmaessig(230, 20))],
    'beides kaputt');
  assert.match(text, /C0_REGELFREEZE/,
    'die Freigabe muss zuerst brechen - Phase 0 steht vor Phase 1');
  assert.doesNotMatch(text, /HASH-ABWEICHUNG/);
});

// ============================================================================
// PHASE 2 - Die Zaehlung
// ============================================================================

test('2.1 OHNE gebundenes Zaehlwerk laeuft nichts - und es ist eine ENTSCHEIDUNG', () => {
  const w = welt('f6lauf-ohne-zw-');
  const text = abbruch(w, [], 'kein Zaehlwerk', /^F6-LAUF-ENTSCHEIDUNG-NOETIG:/m);
  assert.match(text, /panel-validierung\.sqlite/);
  assert.match(text, /PIN 2|F6-B22/);
  const r = ruf(w, []);
  assert.equal(r.status, 2, 'ENTSCHEIDUNG NOETIG traegt einen eigenen Exit-Code');
});

test('2.2 ein Zaehlwerk ohne zaehle() -> ABBRUCH', () => {
  const w = welt('f6lauf-zw-leer-');
  const p = path.join(w.dir, 'leer.py');
  fs.writeFileSync(p, '# nichts\n', 'utf8');
  abbruch(w, ['--zaehlwerk', p], 'Zaehlwerk ohne zaehle()');
});

test('2.3 eine Firmen-Kennung im Klumpen-Tally -> ABBRUCH, und der Text leckt sie NICHT', () => {
  const w = welt('f6lauf-kennung-');
  const daten = gleichmaessig(230, 20);
  const kaputt = JSON.parse(JSON.stringify(daten['S-U'].signal));
  kaputt.klumpen[0] = { cik: 320193, name: 'APPLE INC', m: 1, n: 1 };
  daten['S-U'].signal = kaputt;
  const text = abbruch(w, ['--zaehlwerk', zaehlwerk(w.dir, daten)], 'Kennung im Tally');
  assert.match(text, /ABBRUCH, kein Filter/);
  // Der Abbruchtext ist auch eine Ausgabeflaeche - F6-B14 gilt dort ebenso.
  assert.doesNotMatch(text, /APPLE/);
  assert.doesNotMatch(text, /320193/);
});

test('2.4 unvollstaendige A16-Zerlegung -> ABBRUCH', () => {
  const w = welt('f6lauf-zerlegung-');
  const daten = gleichmaessig(230, 20);
  const kaputt = JSON.parse(JSON.stringify(daten['S-U'].signal));
  delete kaputt.zerlegung.rechts_zensiert;
  daten['S-U'].signal = kaputt;
  const text = abbruch(w, ['--zaehlwerk', zaehlwerk(w.dir, daten)], 'Zerlegung unvollstaendig');
  assert.match(text, /rechts_zensiert/);
});

test('2.5 ein ZUSAETZLICHER Zerlegungs-Schluessel ist ein ABBRUCH, KEIN Filter', () => {
  const w = welt('f6lauf-zerlegung-plus-');
  const daten = gleichmaessig(230, 20);
  const kaputt = JSON.parse(JSON.stringify(daten['S-U'].signal));
  kaputt.zerlegung.feuerrate = 0.9;
  daten['S-U'].signal = kaputt;
  const text = abbruch(w, ['--zaehlwerk', zaehlwerk(w.dir, daten)], 'Zerlegung zu breit');
  assert.match(text, /ABBRUCH, kein Filter/);
  assert.match(text, /feuerrate/);
});

// ============================================================================
// PHASE 3 - Klumpen -> SE
// ============================================================================

test('3.1 gerissene Kreuzprobe -> ABBRUCH mit NICHT UNTERSCHEIDBAR, kein Rueckfall', () => {
  const w = welt('f6lauf-kreuz-');
  const daten = gleichmaessig(230, 20);
  const kaputt = JSON.parse(JSON.stringify(daten['S-U'].signal));
  kaputt.n = 999; // Summe n_g weicht ab
  daten['S-U'].signal = kaputt;
  const text = abbruch(w, ['--zaehlwerk', zaehlwerk(w.dir, daten)], 'Kreuzprobe');
  assert.match(text, /NICHT UNTERSCHEIDBAR/);
  assert.match(text, /KEIN Rueckfall auf den kleineren SE/);
});

test('3.2 G = 1 -> ABBRUCH, nie eine stille Null', () => {
  const w = welt('f6lauf-g1-');
  const daten = gleichmaessig(230, 20);
  daten['S-U'].signal = {
    klumpen: [[230, 250]], n: 250, zaehler: 230,
    zerlegung: daten['S-U'].signal.zerlegung,
  };
  abbruch(w, ['--zaehlwerk', zaehlwerk(w.dir, daten)], 'G = 1');
});

// ============================================================================
// PHASE 4/5 - Band und Ausgabepruefung
// ============================================================================

function bericht(w, daten) {
  const r = ruf(w, ['--zaehlwerk', zaehlwerk(w.dir, daten)]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return JSON.parse(fs.readFileSync(w.bericht, 'utf8'));
}

test('5.1 ZWEIG ausserhalb des Bands: BESTANDEN traegt etikett, aber keinen pflichtsatz', () => {
  // 230/250 = 0,92; Abstand 0,02 > SE* ~ 0,0172 -> BESTANDEN.
  const b = bericht(welt('f6lauf-bestanden-'), gleichmaessig(230, 20));
  const z = b.daten['S-U'].signal;
  assert.equal(z.zweig, 'ausserhalb_band');
  assert.equal(z.werte.verdikt, 'BESTANDEN');
  assert.ok('etikett' in z.werte);
  assert.equal('pflichtsatz' in z.werte, false);
  assert.equal('zweitsatz' in z.werte, false);
  assert.ok('abstand_zu_329_von_365' in z.werte);
});

test('5.2 ZWEIG im Band: NICHT UNTERSCHEIDBAR traegt pflichtsatz, aber kein etikett', () => {
  // 226/250 = 0,904; Abstand 0,004 < SE* -> im Band.
  const b = bericht(welt('f6lauf-imband-'), gleichmaessig(226, 24));
  const z = b.daten['S-U'].signal;
  assert.equal(z.zweig, 'im_band');
  assert.equal(z.werte.verdikt, 'NICHT UNTERSCHEIDBAR');
  assert.ok('pflichtsatz' in z.werte && 'zweitsatz' in z.werte);
  assert.equal('etikett' in z.werte, false);
});

test('5.3 ZWEIG gerissenes Gate: n < 200 -> ohne bandbreite_absolut und ohne 329/365', () => {
  const b = bericht(welt('f6lauf-gate-'), gleichmaessig(140, 10));
  const z = b.daten['S-U'].signal;
  assert.equal(z.zweig, 'gate_gerissen');
  assert.equal(z.werte.messgeraet_vollstaendig, false);
  assert.equal(z.werte.weiter, 0);
  assert.equal('bandbreite_absolut' in z.werte, false);
  assert.equal('abstand_zu_329_von_365' in z.werte, false,
    'die eingefrorene Maschine emittiert ihn in diesem Zweig nicht - '
    + 'strikte Gleichheit waere hier der Fehlalarm');
});

test('5.4 die emittierte Menge ist in JEDEM Zweig genau die zweig-pflichtige', () => {
  for (const [name, satz] of [['ausserhalb_band', gleichmaessig(230, 20)],
    ['im_band', gleichmaessig(226, 24)], ['gate_gerissen', gleichmaessig(140, 10)]]) {
    const b = bericht(welt(`f6lauf-menge-${name}-`), satz);
    const z = b.daten['S-U'].signal;
    assert.equal(z.zweig, name);
    assert.deepEqual(Object.keys(z.werte).sort(),
      b.stempel.zweigPflichtTeilmengen[name].slice().sort(),
      `Zweig ${name}: emittierte Menge != zweig-pflichtige Menge`);
  }
});

test('5.5 Umschlag und Daten sind zwei getrennte Listen (F6-B10)', () => {
  const b = bericht(welt('f6lauf-listen-'), gleichmaessig(230, 20));
  const daten = new Set(b.stempel.zweigPflichtTeilmengen.im_band);
  const umschlag = new Set(Object.keys(b.umschlag));
  const schnitt = [...umschlag].filter((k) => daten.has(k));
  assert.deepEqual(schnitt, [], 'Vermischen ist der Mechanismus aus F6-B10');
  assert.equal(b.umschlag.ergebnisdatenBeruehrt, true);
  assert.ok(Array.isArray(b.umschlag.gelesenePfade));
  assert.ok(Array.isArray(b.umschlag.geschriebenePfade));
  assert.ok(Array.isArray(b.umschlag.manifestGeprueft));
});

test('5.5b R12a: kein voller Pfad und keine Benutzerkennung im Bericht', () => {
  // Der Bericht wandert in die Akte. Ein voller Windows-Pfad traegt den
  // Kontonamen des Rechners mit hinein - genau das, wogegen
  // scripts/studie-basisraten.py::kurzpfad seit jeher schuetzt.
  const w = welt('f6lauf-r12a-');
  const b = bericht(w, gleichmaessig(230, 20));

  // AM GEPARSTEN BAUM, NICHT AM JSON-TEXT.
  // Die erste Fassung dieser Probe mass `rohtext.includes(w.dir)` und war
  // damit auf Windows STILL GRUEN: JSON verdoppelt jeden Backslash, der
  // gesuchte Pfad steht im Rohtext also in maskierter Form und die
  // Teilstring-Suche findet ihn nie. Auf Linux, wo Trennzeichen nicht
  // maskiert werden, wurde dieselbe Probe zu Recht rot (CI-Lauf 33450494912).
  // Das Leck war auf BEIDEN Plattformen da; sehen konnte es die Probe nur auf
  // einer. Ueber den geparsten Werten existiert die Maskierung nicht.
  const strings = [];
  (function sammle(k) {
    if (typeof k === 'string') strings.push(k);
    else if (Array.isArray(k)) k.forEach(sammle);
    else if (k && typeof k === 'object') Object.values(k).forEach(sammle);
  }(b));
  assert.ok(strings.length > 20, 'die Sammlung hat den Baum nicht erfasst');

  for (const s of strings) {
    assert.equal(s.includes(w.dir), false,
      `der volle Temp-Pfad steht im Bericht - mit ihm die Benutzerkennung: ${s}`);
    assert.equal(s.includes(os.homedir()), false, `Heimatverzeichnis im Bericht: ${s}`);
    // Plattformunabhaengig: beide Wurzelformen, die eine Kennung tragen.
    assert.equal(/(^|[^A-Za-z0-9])[A-Za-z]:[\\/]/.test(s), false,
      `absoluter Windows-Pfad im Bericht: ${s}`);
    assert.equal(s.includes('/home/') || s.includes('/Users/'), false,
      `absoluter POSIX-Nutzerpfad im Bericht: ${s}`);
  }

  for (const p of b.umschlag.gelesenePfade.concat(b.umschlag.geschriebenePfade)) {
    assert.equal(p.split('/').length, 2,
      `kein Kurzpfad (Elternverzeichnis/Datei): ${p}`);
    assert.equal(p.includes('\\'), false, `roher Windows-Pfad: ${p}`);
  }
});

test('5.5c R12a: der Waechter steht am SCHREIB-RAND und faengt jeden Weg', () => {
  // Der Wachposten haengt nicht an einer einzelnen Aufrufstelle, sondern dort,
  // wo alle Wege zusammenlaufen. Ein kuenftig vergessener kurzpfad()-Aufruf
  // faellt damit trotzdem auf.
  // DIE PROBEPFADE WERDEN AUS TEILEN GEBAUT, NICHT AUSGESCHRIEBEN - und das
  // ist Absicht, kein Umweg: `tests/studie-deckel.test.js` (R14a/R12a) scannt
  // jede tests/studie-*test.js auf genau solche Literale und wird zu Recht rot,
  // wenn eines drinsteht. Ein Test ueber Pfad-Lecks darf selbst keines
  // ausliefern. Zusammengesetzt ist die Zeichenkette zur Laufzeit identisch.
  const bs = String.fromCharCode(92); // Backslash
  const winPfad = `C:${bs}${bs}Users${bs}${bs}wer${bs}${bs}a.json`;
  const posixPfad = `${'/'}home${'/'}runner/w/a.json`;
  const r = pyProbe([
    'try:',
    `    m.pruefe_keine_absolutpfade({"tief": {"x": ${JSON.stringify(winPfad)}}}, set())`,
    '    print("KEIN ABBRUCH")',
    'except m.LaufAbbruch as f: print("ABBRUCH:" + str(f))',
  ].join('\n'));
  assert.match(r.stdout, /^ABBRUCH:/m, 'ein absoluter Windows-Pfad muss brechen');
  const p = pyProbe([
    'try:',
    `    m.pruefe_keine_absolutpfade({"t": {"x": ${JSON.stringify(posixPfad)}}}, set())`,
    '    print("KEIN ABBRUCH")',
    'except m.LaufAbbruch as f: print("ABBRUCH:" + str(f))',
  ].join('\n'));
  assert.match(p.stdout, /^ABBRUCH:/m, 'ein absoluter POSIX-Pfad muss brechen');
  // GEGENPROBE: Kurzpfade und Prosa gehen durch.
  const g = pyProbe([
    'm.pruefe_keine_absolutpfade({"a": ["scripts/x.py", "Prosa mit / Schraegstrich"]}, set())',
    'print("DURCH")',
  ].join('\n'));
  assert.match(g.stdout, /^DURCH$/m,
    'ohne diese Gegenprobe belegte die Probe nur, dass immer etwas bricht');
});

test('5.6 differenz_punkte: je Variante GENAU EINER, jetzt als Objekt (F6-B11/F6-C15)', () => {
  const w = welt('f6lauf-differenz-');
  const daten = gleichmaessig(230, 20);
  daten['S-U'].kontrollpool = tally(220, 30); // 0,88 gegen 0,92 -> 4 Punkte
  const b = bericht(w, daten);
  const d = b.daten['S-U'].differenz_punkte;
  assert.ok(Math.abs(d.wert - 4) < 1e-9);
  assert.equal(d.maxDifferenzPunkte, 10);
  assert.equal(d.erfuellt, true);
  assert.ok(typeof d.quelle === 'string' && d.quelle.includes('preregistration.json:88'));
  // F6-C15: die Objektform haelt F6-B11 buchstaeblich intakt - EIN
  // armuebergreifender Schluessel, nicht zwei. Seit F6-C13b haengt das
  // Tor-Verdikt als Unterobjekt darunter; die vier registrierten Unterfelder
  // bleiben unveraendert daneben stehen.
  assert.deepEqual(Object.keys(d).sort(),
    ['erfuellt', 'maxDifferenzPunkte', 'quelle', 'tor', 'wert']);
  assert.equal(b.daten['S-G'].differenz_punkte.wert, 0);
});

test('5.6b VARIANTEN_SCHLUESSEL bleibt EINELEMENTIG (F6-C15)', () => {
  const r = pyProbe([
    'print("ANZAHL:" + str(len(m.VARIANTEN_SCHLUESSEL)))',
    'print("INHALT:" + repr(sorted(m.VARIANTEN_SCHLUESSEL)))',
  ].join('\n'));
  assert.match(r.stdout, /^ANZAHL:1$/m,
    'eine Erweiterung von EINEM auf ZWEI armuebergreifende Schluessel waere '
    + 'eine Schwaechung von F6-B11');
  assert.match(r.stdout, /^INHALT:\['differenz_punkte'\]$/m);
});

// ============================================================================
// W-D - das 10-Punkte-Kriterium (F6-C13 / F6-C14)
// ============================================================================

// Die Fixtures rechnen das Tor-Verdikt direkt, damit die Kante exakt
// getroffen wird: ueber Klumpen-Tallies waere 10,0000001 nicht darstellbar.
function torProbe(vSig, vKon, differenzWert) {
  const r = pyProbe([
    `d = m.differenz_objekt(0.0, ${differenzWert} / 100.0)`,
    `t = m.tor_verdikt(${JSON.stringify(vSig)}, ${JSON.stringify(vKon)}, d)`,
    'import json; print("ERG:" + json.dumps({"erfuellt": d["erfuellt"],'
    + ' "wert": d["wert"], "verdikt": t["verdikt"], "weiter": t["weiter"]}))',
  ].join('\n'));
  assert.equal(r.status, 0, r.stderr);
  const zeile = r.stdout.split('\n').find((z) => z.startsWith('ERG:'));
  assert.ok(zeile, r.stdout + r.stderr);
  return JSON.parse(zeile.slice(4));
}

test('W-D (a) GLEICHHEIT BESTEHT: exakt 10,0 Punkte reissen NICHT', () => {
  const e = torProbe('BESTANDEN', 'BESTANDEN', 10.0);
  assert.equal(e.erfuellt, true, 'Gleichheit zaehlt INS Kriterium, wie im Band');
  assert.equal(e.verdikt, 'TOR GEHALTEN');
  assert.equal(e.weiter, 1);
});

test('W-D (a) 10,0000001 Punkte reissen - keine Rundung vor dem Vergleich', () => {
  const e = torProbe('BESTANDEN', 'BESTANDEN', 10.0000001);
  assert.equal(e.erfuellt, false,
    'wer vor dem Vergleich rundet, macht aus 10,0000001 eine 10,0');
  assert.equal(e.verdikt, 'TOR GERISSEN');
  assert.equal(e.weiter, 0);
});

test('W-D (b) EINHEIT: verglichen wird in PUNKTEN gegen 10, nie in Anteilen gegen 0,1', () => {
  // Ein Faktor-100-Fehler kippt hier das Verdikt: 0,04 Anteil = 4 Punkte.
  const r = pyProbe([
    'd = m.differenz_objekt(0.92, 0.88)',
    'print("WERT:" + repr(d["wert"]))',
    'print("MAX:" + repr(d["maxDifferenzPunkte"]))',
  ].join('\n'));
  assert.match(r.stdout, /^WERT:4\.0/m,
    '0,92 gegen 0,88 sind VIER PUNKTE, nicht 0,04');
  assert.match(r.stdout, /^MAX:10$/m, 'die Schranke ist 10, nicht 0,1');
  // Und die Kante liegt bei 10 Punkten, nicht bei 10 Prozentpunkten Anteil:
  assert.equal(torProbe('BESTANDEN', 'BESTANDEN', 9.9).erfuellt, true);
  assert.equal(torProbe('BESTANDEN', 'BESTANDEN', 10.1).erfuellt, false);
});

test('F6-C13 die Bandfolge DOMINIERT die Differenz-Bedingung', () => {
  // Ein Arm NICHT UNTERSCHEIDBAR -> Gesamt NICHT UNTERSCHEIDBAR, auch wenn
  // die Differenz haelt. Die Reihenfolge der Bedingungen ist nicht beliebig.
  const a = torProbe('NICHT UNTERSCHEIDBAR', 'BESTANDEN', 0.0);
  assert.equal(a.verdikt, 'NICHT UNTERSCHEIDBAR');
  assert.equal(a.weiter, 0);
  // ... und auch dann, wenn die Differenz zusaetzlich reisst.
  const b = torProbe('NICHT UNTERSCHEIDBAR', 'BESTANDEN', 50.0);
  assert.equal(b.verdikt, 'NICHT UNTERSCHEIDBAR');

  const c = torProbe('NICHT BESTANDEN', 'BESTANDEN', 0.0);
  assert.equal(c.verdikt, 'TOR GERISSEN');
  assert.equal(c.weiter, 0);
});

test('F6-C13 WEITER = 1 gibt es NUR bei beiden BESTANDEN und gehaltener Differenz', () => {
  const lagen = [
    ['BESTANDEN', 'BESTANDEN', 0.0, 1],
    ['BESTANDEN', 'BESTANDEN', 10.0, 1],
    ['BESTANDEN', 'BESTANDEN', 10.0000001, 0],
    ['BESTANDEN', 'NICHT UNTERSCHEIDBAR', 0.0, 0],
    ['NICHT UNTERSCHEIDBAR', 'NICHT UNTERSCHEIDBAR', 0.0, 0],
    ['BESTANDEN', 'NICHT BESTANDEN', 0.0, 0],
    ['NICHT BESTANDEN', 'NICHT BESTANDEN', 0.0, 0],
  ];
  for (const [s, k, d, weiter] of lagen) {
    assert.equal(torProbe(s, k, d).weiter, weiter, `Lage ${s}/${k}/${d}`);
  }
  // Richtungs-Offenlegung, am Objekt: die Bedingung kann WEITER nur
  // ENTFERNEN, nie erzeugen. Ohne beide BESTANDEN gibt es kein weiter=1.
  const r = pyProbe([
    'd0 = m.differenz_objekt(0.0, 0.0)',
    'aus = set()',
    'for s in ("BESTANDEN", "NICHT UNTERSCHEIDBAR", "NICHT BESTANDEN"):',
    '    for k in ("BESTANDEN", "NICHT UNTERSCHEIDBAR", "NICHT BESTANDEN"):',
    '        if s != "BESTANDEN" or k != "BESTANDEN":',
    '            aus.add(m.tor_verdikt(s, k, d0)["weiter"])',
    'print("WEITER-OHNE-BEIDE-BESTANDEN:" + repr(sorted(aus)))',
  ].join('\n'));
  assert.match(r.stdout, /^WEITER-OHNE-BEIDE-BESTANDEN:\[0\]$/m);
});

test('F6-C13 ein unbekanntes Arm-Verdikt ist ein ABBRUCH', () => {
  const r = pyProbe([
    'd = m.differenz_objekt(0.0, 0.0)',
    'try:',
    '    m.tor_verdikt("VIELLEICHT", "BESTANDEN", d)',
    '    print("KEIN ABBRUCH")',
    'except m.LaufAbbruch as f: print("ABBRUCH:" + str(f))',
  ].join('\n'));
  assert.match(r.stdout, /^ABBRUCH:/m);
  assert.match(r.stdout, /VIELLEICHT/);
});

test('F6-C16 der Stempel ist ersetzt: AUSGEWERTET statt OFFEN', () => {
  const b = bericht(welt('f6lauf-c16-'), gleichmaessig(230, 20));
  const k = b.stempel.kriteriumDifferenz;
  assert.match(k.auswertung, /^AUSGEWERTET/);
  assert.doesNotMatch(k.auswertung, /NICHT AUSGEWERTET/);
  assert.doesNotMatch(k.auswertung, /OFFEN/);
  assert.match(k.auswertung, /_COURT-F6-ZAEHLWERK-2026-09-01/);
  assert.ok(k.belege.some((z) => z.includes('preregistration.json:139')));
  assert.ok(k.regeltext.includes('differenz_punkte <= 10'));
  assert.ok(k.richtung.includes('ERSCHWEREN'));
  assert.deepEqual(k.unterschluessel.slice().sort(),
    ['erfuellt', 'maxDifferenzPunkte', 'quelle', 'wert']);
  // SEIT ANHANG 3 (F6-C13b): `tor` ist registriert - aber als UNTEROBJEKT des
  // EINEN armuebergreifenden Schluessels. Auf der Variantenebene bleibt es
  // damit bei GENAU EINEM Schluessel, und F6-B11 wie F6-C15 bleiben
  // buchstaeblich wahr. Zwischenstand von PR G (gar keine Emission) ist
  // ueberholt; die Abwesenheit war die geschlossene Stellung bis zur
  // Registrierung, nicht das Ziel.
  for (const v of ['S-U', 'S-G']) {
    assert.deepEqual(
      Object.keys(b.daten[v]).filter((k) => k !== 'signal' && k !== 'kontrollpool'),
      ['differenz_punkte'],
      'je Variante GENAU EIN armuebergreifender Schluessel (F6-B11)');
    const d = b.daten[v].differenz_punkte;
    assert.deepEqual(Object.keys(d).slice().sort(),
      ['erfuellt', 'maxDifferenzPunkte', 'quelle', 'tor', 'wert'],
      'die vier registrierten Unterfelder plus das tor-Unterobjekt');
    assert.deepEqual(Object.keys(d.tor).slice().sort(),
      ['grund', 'verdikt', 'weiter'],
      'F6-C13b: genau verdikt/weiter/grund');
    // F6-C13c: eingefrorener Text verlaesst die Datenflaeche.
    assert.ok(!('regeltext' in d.tor) && !('richtung' in d.tor),
      'TOR_REGELTEXT/TOR_RICHTUNG duerfen nicht zweitkopiert werden');
  }
});

// ============================================================================
// F6-C18 / F6-C23 - Anker und Panel-Rand
// ============================================================================

test('F6-C18 die Anker im Bericht sind die am OBJEKT gemessenen', () => {
  const b = bericht(welt('f6lauf-anker-'), gleichmaessig(230, 20));
  const a = b.stempel.zweigAnker;
  assert.equal(a.gate_gerissen, ':168-172');
  assert.equal(a.im_band, ':213-217');
  assert.equal(a.ausserhalb_band, ':218-227');

  // Und sie stimmen mit der Datei ueberein - sonst beurkundet der Bericht
  // einen Zustand, den die Datei nicht hat (KZ-7).
  const band = fs.readFileSync(
    path.join(REPO, 'scripts', 'studie-vb-b4-band.py'), 'utf8').split('\n');
  assert.match(band[167], /def gate_gerissen\(grund\):/); // :168
  assert.match(band[212], /if abs\(abstand\) <= breite_abs:/); // :213
  assert.match(band[217], /if abstand > breite_abs:/); // :218
  assert.match(band[226], /Muster-Friedhof/); // :227 - die letzte Zeile
  // Der alte, falsche Anker :129-134 ist se_stern, nicht gate_gerissen.
  assert.match(band[128], /def se_stern\(/); // :129
});

test('F6-C23 panelRand wird ABGELEITET und steht im Umschlag', () => {
  const b = bericht(welt('f6lauf-rand-'), gleichmaessig(230, 20));
  assert.equal(b.umschlag.panelRand, '2020-12-31');
  assert.equal(b.umschlag.fensterVon, '2017-01-01');
  assert.equal(b.umschlag.fensterBis, '2019-12-31');
  assert.match(b.stempel.panelRandHerkunft, /ABGELEITET, NICHT GESETZT/);
  assert.match(b.stempel.panelRandHerkunft, /nur Korroboration, nie Quelle|NUR Korroboration/);
});

test('F6-C23 ein verstelltes rules.json bricht den Lauf fail-closed ab', () => {
  const w = welt('f6lauf-randbruch-');
  const p = path.join(w.wurzel, 'protocol', 'early-detection', '2.0.0', 'rules.json');
  const r = JSON.parse(fs.readFileSync(p, 'utf8'));
  r.pufferjahre = [2016]; // 2020 entfernt -> der Rand ist nicht mehr abgeleitet
  fs.writeFileSync(p, JSON.stringify(r, null, 1), 'utf8');
  // Der Rehash schlaegt hier zuerst zu - das ist richtig und beweist die
  // Reihenfolge. Geprueft wird deshalb die Ableitung direkt am Objekt.
  const probe = pyProbe([
    'import json, os, tempfile',
    'd = tempfile.mkdtemp()',
    'os.makedirs(os.path.join(d, "protocol", "early-detection", "2.0.0"))',
    'regeln = {"fenster": {"validierung": {"von": "2017q1", "bis": "2019q4"}},',
    '          "pufferjahre": [2016]}',
    'p = os.path.join(d, "protocol", "early-detection", "2.0.0", "rules.json")',
    'open(p, "w", encoding="utf-8").write(json.dumps(regeln))',
    'try:',
    '    m.leite_panelrand_ab(d, "pruefung")',
    '    print("KEIN ABBRUCH")',
    'except m.LaufAbbruch as f: print("ABBRUCH:" + str(f))',
  ].join('\n'));
  assert.match(probe.stdout, /^ABBRUCH:/m);
  assert.match(probe.stdout, /Pufferjahr 2020/);
  assert.ok(fs.existsSync(p), 'die Fixture-Datei blieb erhalten');
});

test('F6-C19 NULL-Werte sind VORHANDENE Schluessel, kein Weglassen', () => {
  // Im Zweig gate_gerissen sind se_stern, se_entschied und abstand_zu_090
  // vorhanden, aber None - F6-B15 prueft ANWESENHEIT, nicht Wert.
  const b = bericht(welt('f6lauf-c19-'), gleichmaessig(140, 10));
  const z = b.daten['S-U'].signal;
  assert.equal(z.zweig, 'gate_gerissen');
  for (const k of ['se_stern', 'se_entschied', 'abstand_zu_090']) {
    assert.ok(k in z.werte, `${k} fehlt - im Zweig gate_gerissen muss er DA sein`);
    assert.equal(z.werte[k], null, `${k} muss None sein, nicht ein Wert`);
  }
  // Und die Gegenrichtung, als eigener Testfall festgenagelt (F6-C19/Z1):
  // Weglassen statt None ist ein Pflichtschluessel-ABBRUCH.
  const r = pyProbe([
    'werte = {k: None for k in m.ZWEIG_PFLICHT[m.ZWEIG_GATE_GERISSEN]}',
    'del werte["abstand_zu_090"]',
    'try:',
    '    m.pruefe_ausgabesatz(werte, m.ZWEIG_GATE_GERISSEN, "probe")',
    '    print("KEIN ABBRUCH")',
    'except m.LaufAbbruch as f: print("ABBRUCH:" + str(f))',
  ].join('\n'));
  assert.match(r.stdout, /^ABBRUCH:/m);
  assert.match(r.stdout, /PFLICHTSCHLUESSEL FEHLT/);
  assert.match(r.stdout, /abstand_zu_090/);
  // GEGENPROBE: mit None statt Weglassen geht derselbe Satz durch.
  const g = pyProbe([
    'werte = {k: None for k in m.ZWEIG_PFLICHT[m.ZWEIG_GATE_GERISSEN]}',
    'm.pruefe_ausgabesatz(werte, m.ZWEIG_GATE_GERISSEN, "probe")',
    'print("DURCH")',
  ].join('\n'));
  assert.match(g.stdout, /^DURCH$/m,
    'None-Werte muessen als anwesende Schluessel durchgehen');
});

test('5.7 der 329/365-Stempel steht da, woertlich, als BERICHTSANGABE (F6-B13)', () => {
  const b = bericht(welt('f6lauf-stempel-'), gleichmaessig(230, 20));
  const s = b.stempel.abstandZu329Von365;
  assert.equal(s.stempel, 'BERICHTSANGABE');
  assert.equal(s.verbotWoertlichAusEintrag23,
    'jede Verwendung von 329/365 als Entscheidungsgroesse');
  // Und das Verbot steht so auch wirklich im echten Eintrag 23.
  const reg = JSON.parse(fs.readFileSync(ECHTES_REGISTER, 'utf8'));
  const e23 = reg.events.find((e) => e.runId === 'f6-tor-freeze-2026-08-31');
  assert.ok(e23.verboten.includes(s.verbotWoertlichAusEintrag23),
    'der Stempel zitiert Eintrag 23 nicht woertlich');
});

test('5.8 F6-B25 steht VORAB im Bericht, nicht als Befund', () => {
  const b = bericht(welt('f6lauf-b25-'), gleichmaessig(230, 20));
  assert.match(b.stempel.vorabDeterminiertheit, /F6-B25 \(vorab, nicht als Befund\)/);
  assert.match(b.stempel.vorabDeterminiertheit, /KV-6/);
  assert.equal(b.daten['S-U'].signal.werte.se_entschied, 'SE_klumpen-robust');
});

// ── Die Ausgabepruefung direkt am Objekt ────────────────────────────────────
// Diese Faelle kann der Laeufer ueber die CLI nicht herstellen - er wuerde die
// kaputte Menge gar nicht erst bauen. Geprueft wird deshalb die Funktion.

test('5.9 ein UNGELISTETER Schluessel ist ein ABBRUCH, NIE ein Filter', () => {
  const r = pyProbe([
    'werte = {k: 0 for k in m.ZWEIG_PFLICHT[m.ZWEIG_IM_BAND]}',
    'werte["feuerrate"] = 0.9',
    'try:',
    '    m.pruefe_ausgabesatz(werte, m.ZWEIG_IM_BAND, "probe")',
    '    print("KEIN ABBRUCH - der Schluessel wurde geduldet")',
    'except m.LaufAbbruch as f:',
    '    print("ABBRUCH:" + str(f))',
    '    print("NOCH-DA:" + str("feuerrate" in werte))',
  ].join('\n'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^ABBRUCH:/m, 'ein ungelisteter Schluessel muss brechen');
  assert.match(r.stdout, /UNGELISTETER SCHLUESSEL/);
  assert.match(r.stdout, /ABBRUCH, kein Filter/);
  // Der Punkt der Auflage, woertlich gemessen: die Funktion ENTFERNT den
  // Schluessel nicht. Ein Filter waere genau der verbotene Weg.
  assert.match(r.stdout, /^NOCH-DA:True$/m,
    'der Schluessel wurde herausgefiltert statt den Lauf zu beenden');
});

test('5.10 ein FEHLENDER Pflichtschluessel ist ein ABBRUCH', () => {
  const r = pyProbe([
    'werte = {k: 0 for k in m.ZWEIG_PFLICHT[m.ZWEIG_IM_BAND]}',
    'del werte["se_stern"]',
    'try:',
    '    m.pruefe_ausgabesatz(werte, m.ZWEIG_IM_BAND, "probe")',
    '    print("KEIN ABBRUCH")',
    'except m.LaufAbbruch as f: print("ABBRUCH:" + str(f))',
  ].join('\n'));
  assert.match(r.stdout, /^ABBRUCH:/m);
  assert.match(r.stdout, /PFLICHTSCHLUESSEL FEHLT/);
  assert.match(r.stdout, /se_stern/);
});

test('5.11 jeder verbotene Schluessel (F6-B14) bricht, auch tief im Baum', () => {
  const r = pyProbe([
    'roh = sorted(m.VERBOTENE_SCHLUESSEL)',
    'schlecht = []',
    'for k in roh:',
    '    try:',
    '        m.pruefe_verbotene({"tief": {"tiefer": {k: 1}}}, "probe")',
    '        schlecht.append(k)',
    '    except m.LaufAbbruch: pass',
    'print("ANZAHL:" + str(len(roh)))',
    'print("DURCHGERUTSCHT:" + repr(schlecht))',
  ].join('\n'));
  assert.match(r.stdout, /^DURCHGERUTSCHT:\[\]$/m,
    'ein verbotener Schluessel ist irgendwo im Baum durchgerutscht');
  assert.match(r.stdout, /^ANZAHL:(2[5-9]|[3-9]\d)$/m,
    'die Verbotsliste ist unplausibel kurz geworden');
});

test('5.12 GEGENPROBE: ein sauberer Baum geht durch die Verbotspruefung', () => {
  const r = pyProbe([
    'm.pruefe_verbotene({"anteil": 0.9, "tief": {"verdikt": "BESTANDEN"}}, "probe")',
    'print("DURCH")',
  ].join('\n'));
  assert.match(r.stdout, /^DURCH$/m,
    'ohne diese Gegenprobe belegte 5.11 nur, dass immer etwas bricht');
});

test('5.13 die drei zweig-pflichtigen Teilmengen sind verschieden und '
  + 'Teilmengen des registrierten Satzes', () => {
  const r = pyProbe([
    'mengen = {z: frozenset(s) for z, s in m.ZWEIG_PFLICHT.items()}',
    'print("ANZAHL:" + str(len(set(mengen.values()))))',
    'print("TEILMENGEN:" + str(all(s <= m.DATEN_SCHLUESSEL for s in mengen.values())))',
    'print("DATEN:" + str(len(m.DATEN_SCHLUESSEL)))',
    'print("UEBERSCHNEIDUNG:" + repr(sorted(m.DATEN_SCHLUESSEL & m.UMSCHLAG_ALLOWLIST)))',
  ].join('\n'));
  assert.match(r.stdout, /^ANZAHL:3$/m, 'es sind DREI verschiedene Teilmengen (F6-B15)');
  assert.match(r.stdout, /^TEILMENGEN:True$/m);
  assert.match(r.stdout, /^DATEN:30$/m, 'der registrierte Satz zaehlt 30 Datenfelder');
  assert.match(r.stdout, /^UEBERSCHNEIDUNG:\[\]$/m, 'F6-B10: zwei getrennte Listen');
});

// ============================================================================
// F6-K14 — DIE RELATIV-ARGUMENT-FIXTURE
// ============================================================================
//
// Genau dieser Fixture-Typ fehlte, und deshalb ueberlebte der Defekt: JEDE
// Fixture dieses Laeufers fuhr ABSOLUTE Temp-Pfade, und nur bei relativen
// Argumenten ist ein Pfad byte-gleich seinem eigenen `kurzpfad`. Der eine
// autorisierte Lauf starb daran - NACH dem Panel-Zugriff.

const rel = (von, p) => path.relative(von, p).split(path.sep).join('/');

function rufRelativ(w, extra = []) {
  return spawnSync(python, [SKRIPT,
    '--freigabe', rel(w.dir, w.freigabePfad), '--panel', rel(w.dir, w.panel),
    '--bericht', rel(w.dir, w.bericht), '--wurzel', rel(w.dir, w.wurzel),
    '--register', rel(w.dir, w.registerPfad), ...extra],
  { encoding: 'utf8', cwd: w.dir });
}

test('F6-K14 (i) ein Lauf mit RELATIVEN Argumenten schreibt den Bericht', () => {
  const w = welt('f6lauf-k14-relativ-');
  const zw = zaehlwerk(w.dir, gleichmaessig(230, 20));
  const r = rufRelativ(w, ['--zaehlwerk', rel(w.dir, zw)]);
  assert.equal(r.status, 0,
    `der relative Lauf ist rot: ${r.stderr.slice(0, 500)}`);
  assert.ok(fs.existsSync(w.bericht),
    'DER BERICHT MUSS GESCHRIEBEN WERDEN - genau das war der Schaden');
  const b = JSON.parse(fs.readFileSync(w.bericht, 'utf8'));
  // Und die Ausgabe ist trotzdem R12a-rein: nur Kurzformen.
  for (const p of b.umschlag.gelesenePfade) {
    assert.doesNotMatch(p, /^[A-Za-z]:/, `absolute Form in gelesenePfade: ${p}`);
    // Die Laenge allein genuegt nicht: kurzpfad("datei.json") liefert
    // "/datei.json" - zwei Segmente, aber das erste ist LEER. Genau die
    // Denkform des Ursprungsdefekts (ein Praedikat, das die entartete Form
    // durchlaesst), deshalb hier positiv auf beide Segmente geprueft.
    const teile = p.split('/');
    assert.equal(teile.length, 2, `keine Kurzform: ${p}`);
    // BEKANNTE GRENZE, hier benannt statt weggeprueft: fuer ein nacktes
    // Dateiargument liefert kurzpfad die entartete Form "/datei.json" - zwei
    // Segmente, erstes leer. Sie traegt keine Kennung und ist deshalb kein
    // Leck; `kurzpfad` ist SHA-gebunden und wird hier nicht angefasst.
    // Geprueft wird deshalb die EIGENSCHAFT, nicht die Form: kein
    // Laufwerk, keine Wurzelform, keine Kontokennung. Ein Formpraedikat
    // allein war schon einmal der Fehler.
    assert.ok(teile[1].length > 0, `Kurzform ohne Dateinamen: ${p}`);
    assert.doesNotMatch(p, /^[A-Za-z]:/);
    assert.doesNotMatch(p, /(^|\/)(Users|home)\//);
    assert.ok(!p.includes(require('node:os').userInfo().username),
      `Kontokennung in der Kurzform: ${p}`);
  }
});

test('F6-K14 (ii) ein absoluter Pfad im Berichtsbaum bricht WEITERHIN ab', () => {
  const BS = String.fromCharCode(92);
  const r = pyProbe([
    `voll = "C:" + "${BS}${BS}" + "Users" + "${BS}${BS}" + "Jemand" + "${BS}${BS}" + "x.json"`,
    'try:',
    '    m.pruefe_keine_absolutpfade({"a": voll}, {voll})',
    '    print("KEIN ABBRUCH")',
    'except m.LaufAbbruch as f: print("ABBRUCH:" + str(f)[:40])',
  ].join('\n'));
  assert.match(r.stdout, /^ABBRUCH:ABSOLUTER PFAD IM BERICHT/m);
});

test('F6-K14 (iii) eine Kontokennung als Pfadsegment bricht WEITERHIN ab', () => {
  const r = pyProbe([
    'import os',
    'konto = os.path.basename(os.path.expanduser("~"))',
    'try:',
    '    m.pruefe_keine_absolutpfade({"a": konto + "/f6-arbeit"}, set())',
    '    print("KEIN ABBRUCH")',
    'except m.LaufAbbruch as f: print("ABBRUCH:" + str(f)[:40])',
  ].join('\n'));
  assert.match(r.stdout, /^ABBRUCH:KONTOKENNUNG ALS PFADSEGMENT/m);
});

test('F6-K14 BRUCHPROBE: mit restaurierter Rohmenge wird die Fixture ROT', () => {
  // Der Riegel wird absichtlich auf den Stand VOR der Reparatur gesetzt - an
  // einer KOPIE. Die Datei im Repo bleibt unberuehrt.
  const w = welt('f6lauf-k14-bruch-');
  const zw = zaehlwerk(w.dir, gleichmaessig(230, 20));
  const kaputt = path.join(w.dir, 'laeufer-vor-der-reparatur.py');
  const quelle = fs.readFileSync(SKRIPT, 'utf8');
  const alt = '| {str(p) for p in genutzt if os.path.isabs(str(p))})';
  assert.ok(quelle.includes(alt), 'der reparierte Ausdruck wurde nicht gefunden');
  fs.writeFileSync(kaputt,
    quelle.replace(alt, '| {str(p) for p in genutzt})'), 'utf8');

  const r = spawnSync(python, [kaputt,
    '--freigabe', rel(w.dir, w.freigabePfad), '--panel', rel(w.dir, w.panel),
    '--bericht', rel(w.dir, w.bericht), '--wurzel', rel(w.dir, w.wurzel),
    '--register', rel(w.dir, w.registerPfad), '--zaehlwerk', rel(w.dir, zw)],
  { encoding: 'utf8', cwd: w.dir });

  // F6-K14 verlangt die Ausgabe im PR-Text. Damit sie nicht abgeschrieben
  // werden muss, gibt die Probe sie auf Wunsch woertlich heraus.
  if (process.env.F6_BRUCH_ZEIGEN) process.stderr.write(`\nBRUCHPROBE:\n${r.stderr}\n`);
  assert.notEqual(r.status, 0,
    'mit der Rohmenge MUSS der relative Lauf abbrechen - sonst misst die Probe nichts');
  assert.match(r.stderr, /ABSOLUTER PFAD IM BERICHT/,
    `erwartet wurde genau der R12a-Fehlalarm, bekam: ${r.stderr.slice(0, 300)}`);
  assert.equal(fs.existsSync(w.bericht), false,
    'und wieder waere kein Bericht entstanden');
  // F6-K15: der Fehlalarm faellt jetzt in der VORPRUEFUNG - also VOR dem
  // ersten Panel-Byte, nicht mehr am Schreib-Rand nach der Messung. Genau
  // diese Verschiebung ist der Unterschied zwischen einem verlorenen
  // Kontingent und einem folgenlosen Abbruch.
  assert.match(r.stderr, /bei vorpruefung/,
    'der Abbruch muss aus der Vorpruefung kommen, nicht vom Schreib-Rand');
});

// ============================================================================
// K18-Befunde: der Panel-Byte-Diskriminator und die Verhaltensproben
// ============================================================================

// Ein Fixture-Zaehlwerk, das beim EINTRITT eine Marke schreibt. Damit ist
// "hat das Panel geoeffnet?" eine Tatsache im Dateisystem statt einer
// Textvermutung ueber Fehlermeldungen.
function zaehlwerkMitMarke(dir, daten, marke, extra = '') {
  const p = path.join(dir, 'zaehlwerk-marke.py');
  fs.writeFileSync(p, [
    'import json',
    `DATEN = json.loads(r"""${JSON.stringify(daten)}""")`,
    extra,
    'def zaehle(panel_pfad, variante, arm):',
    // Vorwaertsschraegstriche: Python oeffnet sie unter Windows genauso, und
    // die Escaping-Falle im Testtext faellt damit ganz weg.
    `    open(r"${marke.split(String.fromCharCode(92)).join('/')}", "a").write("X")`,
    '    return DATEN[variante][arm]',
    '',
  ].join('\n'), 'utf8');
  return p;
}

test('F6-K15 DISKRIMINATOR: Vorpruefungs-Abbruch -> das Panel bleibt ZU', () => {
  const w = welt('f6lauf-marke-vor-');
  const marke = path.join(w.dir, 'panel-geoeffnet.marke');
  const zw = zaehlwerkMitMarke(w.dir, gleichmaessig(230, 20), marke);
  // Ein Bericht direkt im Benutzerverzeichnis - der Fall, der vorher erst am
  // Schreib-Rand starb, nachdem das Panel viermal offen war.
  const konto = require('node:os').userInfo().username;
  const r = ruf(w, ['--zaehlwerk', zw,
    '--bericht', path.join(path.dirname(os.homedir()), konto, 'k18-probe.json')]);
  assert.notEqual(r.status, 0, 'der Lauf muss abbrechen');
  assert.match(r.stderr, /^F6-LAUF-ABBRUCH:/m);
  assert.match(r.stderr, /bei vorpruefung\[/,
    'der Abbruch muss aus der Vorpruefung kommen');
  assert.equal(fs.existsSync(marke), false,
    'DAS PANEL WURDE GEOEFFNET - genau das darf die Vorpruefung verhindern');
});

test('F6-K15 DISKRIMINATOR: Schreib-Rand-Abbruch -> das Panel WAR offen', () => {
  const w = welt('f6lauf-marke-nach-');
  const marke = path.join(w.dir, 'panel-geoeffnet.marke');
  const BS = String.fromCharCode(92);
  // IDENTITAET_A16 landet im stempel und ist KEIN pfad-abgeleiteter String -
  // die Vorpruefung kann ihn nicht sehen, der Schreib-Rand sehr wohl. Damit
  // ist bewiesen, dass der zweite Riegel weiter gebraucht wird.
  const zw = zaehlwerkMitMarke(w.dir, gleichmaessig(230, 20), marke,
    `IDENTITAET_A16 = "C:${BS}${BS}Users${BS}${BS}Jemand${BS}${BS}spur.txt"`);
  const r = ruf(w, ['--zaehlwerk', zw]);
  assert.notEqual(r.status, 0, 'der Lauf muss abbrechen');
  assert.match(r.stderr, /^F6-LAUF-ABBRUCH:/m);
  assert.doesNotMatch(r.stderr, /bei vorpruefung\[/,
    'dieser Abbruch gehoert an den Schreib-Rand, nicht in die Vorpruefung');
  assert.equal(fs.existsSync(marke), true,
    'hier MUSS das Panel offen gewesen sein - sonst misst die Probe nichts');
  assert.equal(fs.existsSync(w.bericht), false, 'und kein Bericht entsteht');
});

test('F6-K13 VERHALTENSPROBE: die Verbotsmenge traegt BEIDE Trennerformen', () => {
  // Die Rechtfertigung der Abweichung wird am OBJEKT gepinnt, nicht an einem
  // Satz im Docstring: fuer ein absolut uebergebenes Argument mit
  // Schraegstrichen muessen BEIDE Schreibweisen in der Menge stehen.
  const r = pyProbe([
    // Der Beispielpfad wird aus Fragmenten gebaut - ausgeschrieben machte
    // diese Datei sich selbst zum R12a-Verstoss (der Deckel liest tests/).
    'pfad = "C" + ":/" + "Jemand/panel.sqlite"',
    'formen = m.verbotene_formen(pfad)',
    'print("ANZAHL:" + str(len(formen)))',
    'print("SCHRAEG:" + str(any("/" in f and ":" in f for f in formen)))',
    'import os',
    'print("NORMAL:" + str(os.path.abspath(pfad) in formen))',
    '# und ein RELATIVES Argument darf NICHT als Rohform drin sein',
    'rel = m.verbotene_formen("scripts/studie-f6-zaehlwerk.py")',
    'print("RELROH:" + str("scripts/studie-f6-zaehlwerk.py" in rel))',
  ].join('\n'));
  assert.match(r.stdout, /^SCHRAEG:True$/m,
    'die Rohform mit Schraegstrichen fehlt - genau sie geht bei abspath verloren');
  assert.match(r.stdout, /^NORMAL:True$/m);
  assert.match(r.stdout, /^RELROH:False$/m,
    'ein relatives Argument darf nicht in der Verbotsmenge stehen');
});

test('F6-K28 POSITIVPROBE: 2a feuert auch bei ABSOLUTEN Argumenten', () => {
  // Der Gegenbeweis zur Fixture-Luecke, die den Defekt hat ueberleben lassen:
  // die Vorpruefung ist nicht nur fuer relative Aufrufe da.
  const w = welt('f6lauf-2a-absolut-');
  const marke = path.join(w.dir, 'panel-geoeffnet.marke');
  const zw = zaehlwerkMitMarke(w.dir, gleichmaessig(230, 20), marke);
  const konto = require('node:os').userInfo().username;
  const r = ruf(w, ['--zaehlwerk', zw,
    '--bericht', path.join(path.dirname(os.homedir()), konto, 'k18-abs.json')]);
  assert.match(r.stderr, /bei vorpruefung\[/);
  assert.equal(fs.existsSync(marke), false);
});
