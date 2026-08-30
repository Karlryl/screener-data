'use strict';

// E4g — Die Restursachen-Diagnose der S-G-Verluste.
//
// DIE SACHE: E4g soll die Weiche der Studien-Fortsetzung mit Zahlen belegen. Eine
// Diagnose, die ihre Population still verfehlen kann, belegt nichts — sie liefert
// nur eine Zahl, die zufaellig plausibel aussieht. Der Schutz ist der BIT-ANKER aus
// ENTSCHIED 17: exakt 39 Signal- und 448 Kontrollpool-Verluste, jede Abweichung ein
// Sofort-Stopp. Dieser Test prueft nicht "Exit-Code 0", sondern: DIESE Pruefung
// stand da und war gruen — insbesondere die vier Anker-Sabotagen.
//
// Die zweite Haelfte ist die Ergebnis-Sperre. Der Register-Eintrag
// e4g-restursachen-pruefung-v2-2026-08-29 meldet exakt 20 Ausgabefelder an; ein Feld
// mehr ist ein Leck, ein Feld weniger eine stille Entschaerfung. Beide Richtungen
// werden hier festgenagelt, damit die Allowlist nicht spaeter lautlos wandert.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const REPO = path.join(__dirname, '..');
const SKRIPT = path.join(REPO, 'scripts', 'studie-e4g-restursachen.py');
const LEDGER = path.join(REPO, 'protocol', 'early-detection', '2.0.0', 'outcome-access-ledger.json');
const RUN_ID = 'e4g-restursachen-pruefung-v2-2026-08-29';

function e4g(args, optionen = {}) {
  return spawnSync(process.env.PYTHON || 'python', [SKRIPT, ...args],
    { encoding: 'utf8', cwd: REPO, ...optionen });
}

let selbsttest = null;
function selbsttestLauf() {
  if (selbsttest === null) selbsttest = e4g(['--selbsttest']);
  return selbsttest;
}

// Namentlich erwartet. Faellt eine dieser Zeilen weg, ist der Test rot — auch wenn
// der Selbsttest weiter Exit-Code 0 meldet.
const PFLICHT_PRUEFUNGEN = [
  'Kantenprobe: der Melderhythmus wird auf der ACCEPTED-Achse gemessen',
  'Kantenprobe: das Kantenfenster ist vier Melde-Abstaende breit',
  'Kantenprobe: die Restlaufzeit zaehlt bis zum Panelrand',
  'Kantenprobe: 4 Abstaende > Restlaufzeit -> kantenunmoeglich',
  'Kantenprobe: dieselbe Kadenz frueh im Fenster -> NICHT unmoeglich',
  'Kantenprobe: die Restlaufzeit wandert mit dem Signal',
  'Kantenprobe: die Untergrenze 365/4 greift gegen Nachtrags-Buendel',
  'Kantenprobe: Quartale NACH dem Signal aendern die Kadenz nicht (R11)',
  'Kantenprobe: eine Firma ohne gewaehlte Reihe bricht ab',
  'Kantenprobe: ein einziger Melde-Zeitpunkt bricht ab',
  'Formularregime: nur Jahresformen nach dem Signal -> Jahreskadenz',
  'Formularregime: ein einziges 10-Q danach kippt die Jahreskadenz',
  'Formularregime: gar keine Zeile mehr -> echter Abgang',
  'Formularregime: nur noch 8-K ist WEDER Abgang NOCH Jahreskadenz',
  'Formularregime: eine Firma ohne jede Zeile ist ein Abgang, kein Fehler',
  "afs: 1-LAF ist 'larger' - dieselbe Zuordnung wie D2",
  "afs: 5-SML ist 'smaller' - dieselbe Zuordnung wie D2",
  'afs: ein leeres afs bekommt eine EIGENE Klasse, keine stille Gruppe',
  'Bit-Anker: 39/326 im Signalarm gehen durch',
  'Bit-Anker: 448/4285 im Kontrollpool gehen durch',
  'Bit-Anker: 38 statt 39 ist ein SOFORT-STOPP',
  'Bit-Anker: 40 statt 39 ist ebenso ein SOFORT-STOPP',
  'Bit-Anker: richtige Verlustzahl bei FALSCHER Fallzahl faellt auf',
  'Bit-Anker: 447 statt 448 im Kontrollpool ist ein SOFORT-STOPP',
  'die gueltige Ausgabe geht DURCH',
  'eine geleckte Firmen-Kennung fliegt am Etikett-Vorrat auf',
  'eine Kennung in der letzten Form fliegt auf',
  'T185: ein Ticker in der letzten Form fliegt auf',
  'T185: ein Firmenname in der letzten Form fliegt auf',
  'T185: ein Konzeptname in der letzten Form fliegt auf',
  'T185: der Vorrat traegt PERIODISCHE_FORMEN wortgleich',
  'ein durchgereichter Messwert fliegt am Typ auf',
  'ein zusaetzliches Feld im Arm fliegt auf',
  'ein FEHLENDES Pflichtfeld fliegt genauso auf wie ein zusaetzliches',
  'ein zusaetzlicher Schluessel im Umschlag fliegt auf',
  'eine Zeile mit null Firmen dahinter fliegt auf',
  'ein erfundenes Klassen-Etikett fliegt auf',
  'ein fehlender Arm fliegt auf',
  'die gueltige Zerlegung geht auf',
  'kante_unmoeglich ja+nein muss den Nenner treffen',
  'jahreskadenz ja+nein muss den Nenner treffen',
  'eine Verteilung, die nicht aufgeht, bricht ab',
  'Zeilen, die sich nicht auf den Nenner summieren, brechen ab',
  "'keine Zeile mehr' UND 'Jahreskadenz' zugleich bricht ab",
  'W9: die 20 Felder decken sich mit dem Register-Eintrag',
  'W9: die Ausgabe-Allowlist zaehlt genau 20 Felder',
];

test('Der Selbsttest der E4g-Diagnose laeuft gruen durch', () => {
  const lauf = selbsttestLauf();
  assert.equal(lauf.status, 0, `Exit ${lauf.status}\n${lauf.stdout}\n${lauf.stderr}`);
  assert.ok(!/^\s*ROT\s/m.test(lauf.stdout), lauf.stdout);
});

test('Jede Pflichtpruefung stand wirklich da — und war gruen', () => {
  const lauf = selbsttestLauf();
  const gruen = new Set(
    lauf.stdout.split(/\r?\n/)
      .filter((zeile) => /^\s{2}ok\s{4}/.test(zeile))
      .map((zeile) => zeile.replace(/^\s{2}ok\s{4}/, '').trim()),
  );
  const fehlend = PFLICHT_PRUEFUNGEN.filter((name) => !gruen.has(name));
  assert.deepEqual(fehlend, [], `Diese Pruefungen fehlen im Selbsttest: ${fehlend.join(' | ')}`);
  assert.ok(gruen.size >= PFLICHT_PRUEFUNGEN.length,
    `Nur ${gruen.size} gruene Pruefungen — der Selbsttest ist geschrumpft`);
});

// ── Die Sperrzone ────────────────────────────────────────────────────────────

test('Die Diagnose kennt nur das Prueffenster — kein Fenster-Schalter', () => {
  const lauf = e4g(['--fenster', 'endtest']);
  assert.notEqual(lauf.status, 0, 'Ein Fenster-Schalter haette abgewiesen werden muessen');
  assert.match(`${lauf.stdout}${lauf.stderr}`, /unrecognized arguments|invalid choice|SPERRZONE/i);
});

test('Die Diagnose fasst weder Schluessel noch verschluesselte Datei an', () => {
  const quelle = fs.readFileSync(SKRIPT, 'utf8').toLowerCase();
  // Suchbegriffe zusammengesetzt, sonst stuende dieser Test in seinem eigenen
  // Suchraum (dieselbe Falle wie im Selbsttest der Zaehlprobe).
  for (const wort of [`de${'crypt'}`, `ci${'pher'}`, `un${'seal'}`, `open${'ssl'}`]) {
    assert.ok(!quelle.includes(wort), `Die Diagnose enthaelt '${wort}'`);
  }
});

// ── W9: was ausgegeben wird, muss angemeldet sein ────────────────────────────

const REGISTER = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
const EINTRAG = REGISTER.events.find((e) => e.runId === RUN_ID);

test('Der Register-Eintrag traegt den gehashten 39/448-Selbst-Check', () => {
  assert.ok(EINTRAG, `Register-Eintrag ${RUN_ID} fehlt`);
  assert.equal(EINTRAG.typ, 'count_only_probe_authorized');
  assert.deepEqual(EINTRAG.fenster, ['pruefung']);
  assert.match(EINTRAG.begruendung,
    /exakt 39 S-G-Signal-Verluste und 448 S-G-Kontrollpool-Verluste/);
  assert.match(EINTRAG.begruendung, /SOFORT-STOPP/);
});

test('W9: Skript-Allowlist und Register-Anmeldung sind IDENTISCH', () => {
  const lauf = e4g(['--allowlist-ausgeben']);
  assert.equal(lauf.status, 0, lauf.stderr);
  const felder = JSON.parse(lauf.stdout);
  assert.equal(felder.length, 20, 'Der Vertrag nennt exakt 20 Aggregatfelder');
  assert.deepEqual(felder, [...EINTRAG.allowedOutputs].sort(),
    'Die Ausgabe-Allowlist des Skripts weicht vom Register-Eintrag ab');
});

test('W9: eine Freigabe eines FREMDEN Laufs deckt diese Diagnose nicht', () => {
  // Der E4a-Eintrag ist eine gueltige Zaehlproben-Anmeldung — aber er meldet die
  // E4a-Diagnosefelder an, nicht die E4g-Felder. Wer mit ihm E4g faehrt, gibt
  // Groessen aus, die niemand angemeldet hat.
  const fremd = REGISTER.events.find(
    (e) => e.typ === 'count_only_probe_authorized' && e.runId !== RUN_ID
      && Array.isArray(e.allowedOutputs) && e.allowedOutputs.length > 0);
  assert.ok(fremd, 'Kein fremder Zaehlproben-Eintrag im Register gefunden');
  const verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), 'e4g-w9-'));
  try {
    const freigabe = path.join(verzeichnis, 'freigabe.json');
    fs.writeFileSync(freigabe, JSON.stringify({
      runId: fremd.runId,
      fenster: (fremd.fenster || [])[0],
      registerEventHash: fremd.eventHash,
      accessedAt: fremd.accessedAt,
      serverConfirmedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    }), 'utf8');
    const lauf = e4g(['--freigabe', freigabe, '--data-root', verzeichnis]);
    assert.notEqual(lauf.status, 0, 'Eine fremde Freigabe haette abgewiesen werden muessen');
    assert.match(`${lauf.stdout}${lauf.stderr}`, /W9-ABBRUCH|W2-ABBRUCH/);
  } finally {
    fs.rmSync(verzeichnis, { recursive: true, force: true });
  }
});

// ── Der committete Lauf ──────────────────────────────────────────────────────
//
// Der eigentliche Lauf braucht das Panel und laeuft im CI nicht. Was im CI laufen
// KANN und muss: dass das ausgelieferte Artefakt die Anker traegt und die
// Ergebnis-Sperre einhaelt. Ein spaeter editiertes Artefakt faellt hier auf.

const ARTEFAKT = path.join(REPO, 'reports', 'studie',
  'E4g-restursachen-diagnose-2026-08-29.json');

test('Das committete Ergebnis traegt den bestandenen Bit-Anker', () => {
  const d = JSON.parse(fs.readFileSync(ARTEFAKT, 'utf8'));
  assert.equal(d.runId, RUN_ID);
  assert.equal(d.fenster, 'pruefung');
  assert.equal(d.variante, 'S-G');
  assert.equal(d.signal_verluste, 39);
  assert.equal(d.kontrollpool_verluste, 448);
  assert.equal(d.selbstCheck.istSignalVerluste, d.selbstCheck.sollSignalVerluste);
  assert.equal(d.selbstCheck.istKontrollpoolVerluste, d.selbstCheck.sollKontrollpoolVerluste);
  assert.equal(d.selbstCheck.istFallzahlSignal, 326);
  assert.equal(d.selbstCheck.istFallzahlKontrolle, 4285);
  assert.equal(d.ergebnisdatenBeruehrt, false);
  assert.deepEqual(d.gelesenePfade, ['panel/panel-validierung.sqlite'],
    'Der Lauf darf ausschliesslich die Panel-Datei des angemeldeten Fensters lesen');
});

test('Das committete Ergebnis haelt die 20-Felder-Sperre ein', () => {
  const d = JSON.parse(fs.readFileSync(ARTEFAKT, 'utf8'));
  const erlaubt = new Set([...EINTRAG.allowedOutputs, 'zeilen']);
  for (const [name, arm] of Object.entries(d.arme)) {
    for (const feld of Object.keys(arm)) {
      assert.ok(erlaubt.has(feld), `${name}/${feld} ist nicht angemeldet`);
    }
    const n = arm.nenner_restursachen;
    assert.equal(arm.kante_unmoeglich_ja + arm.kante_unmoeglich_nein, n);
    assert.equal(arm.jahreskadenz_ja + arm.jahreskadenz_nein, n);
    assert.equal(arm.zeilen.reduce((s, z) => s + z.nenner_restursachen, 0), n);
    for (const zeile of arm.zeilen) {
      assert.deepEqual(Object.keys(zeile).sort(),
        ['afs', 'jahreskadenz', 'kante_unmoeglich', 'klasse',
          'letzte_form_nach_signal', 'nenner_restursachen']);
    }
  }
});

test('T185: der geschlossene Formstamm-Vorrat deckt das committete Ergebnis', () => {
  // Die Gegenrichtung zur Haertung: ein Vorrat, der zu eng ist, bricht den
  // naechsten Lauf an einem voellig legitimen SEC-Formular. Belegt wird das am
  // ECHTEN Artefakt, nicht an der Fixtur des Selbsttests.
  const lauf = e4g(['--form-vorrat-ausgeben']);
  assert.equal(lauf.status, 0, lauf.stderr);
  const vorrat = new Set(JSON.parse(lauf.stdout));
  const d = JSON.parse(fs.readFileSync(ARTEFAKT, 'utf8'));
  const gemessen = new Set(Object.values(d.arme)
    .flatMap((arm) => Object.keys(arm.letzte_form_nach_signal)));
  assert.ok(gemessen.size >= 4, `Nur ${gemessen.size} Formstaemme im Artefakt gefunden`);
  for (const stamm of gemessen) {
    assert.ok(vorrat.has(stamm), `Formstamm '${stamm}' fehlt im geschlossenen Vorrat`);
  }
  // Und in die andere Richtung: der Vorrat ist nicht heimlich zum Freibrief
  // geworden. Ein Ticker gehoert nicht hinein.
  for (const kein of ['AAPL', 'PLTR', 'NVDA', 'OperatingIncomeLoss', 'Apple Inc.']) {
    assert.ok(!vorrat.has(kein), `'${kein}' steht im Formstamm-Vorrat`);
  }
});

test('Im Ergebnis steckt keine Firmen-Kennung', () => {
  // Gesucht wird im ERGEBNIS-KERN, nicht im Umschlag: dort stehen legitime lange
  // Zahlen (Siegel-Dateigroesse, SHA-256). Der Kern ist die Stelle, an der eine
  // Firmen-Identitaet ueberhaupt lecken koennte.
  //
  // Positive Gegenprobe zuerst: die Suche findet eine eingeschmuggelte CIK. Ohne
  // sie waere ein leeres Ergebnis nicht von einer kaputten Suche zu unterscheiden.
  const d = JSON.parse(fs.readFileSync(ARTEFAKT, 'utf8'));
  const kern = JSON.stringify(d.arme);
  const kennung = /"(?:cik|ticker|name)"|\d{5,}/;
  assert.ok(kennung.test('{"cik": "0000320193"}'), 'Die Kennungs-Suche selbst ist kaputt');
  assert.ok(kennung.test(JSON.stringify({ afs: '0000320193' })),
    'Eine Kennung als Etikett wuerde nicht gefunden');
  assert.ok(!kennung.test(kern), 'Im Ergebnis steht etwas, das nach einer Kennung aussieht');
});
