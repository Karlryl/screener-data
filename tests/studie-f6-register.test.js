'use strict';

// Studie 2.0, F6-Tor — der Waechter ueber dem Register-Werkzeug fuer Eintrag 23
// (Freeze-Akt ueber den vier F6-Groessen, VB-A11 / ENTSCHIED 133).
//
// DIE SACHE: scripts/studie-f6-register.js darf im Standardfall NICHTS schreiben
// und im Schreibfall NUR schreiben, wenn alle Tore offen sind. Geprueft wird AM
// OBJEKT — an Dateiinhalten und Exit-Codes, nicht an Formulierungen im Kopf des
// Skripts:
//
//   (a) der Trockenlauf laesst das ECHTE Register byte-identisch.
//   (b) ein verschobenes Kettenende bricht.
//   (c) jede inhaltliche Achse der drei Artefakt-Tore ist ERREICHBAR und rot —
//       erreichbar, weil die inhaltlichen Tore VOR den Hash-Toren stehen. Waere
//       es andersherum, koennte kein einziger inhaltlicher Zweig je feuern, weil
//       jede Aenderung zuerst den Datei-Hash bricht (RR9-A4).
//   (d) eine schon vergebene runId wird abgewiesen.
//   (e) der gebaute Eintrag autorisiert nachweislich nichts.
//   (f) die drei Python-Dateien werden AM OBJEKT gehasht, nicht ueber die
//       Aussage eines Artefakts ueber sie.
//
// JEDE ROTE PROBE HAT IHRE GRUENE GEGENPROBE auf der unversehrten Kopie. Eine
// rote Probe ohne sie beweist nur, dass irgendetwas bricht.
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
const SKRIPT = path.join(REPO, 'scripts', 'studie-f6-register.js');
const LEDGER = path.join(REPO, 'protocol', 'early-detection', '2.0.0', 'outcome-access-ledger.json');
const SCHWELLEN = path.join(
  REPO, 'protocol', 'early-detection', '2.1.0', 'e2-schwellen-satz-2026-08-30.json',
);
const BAND = path.join(REPO, 'protocol', 'early-detection', '2.1.0', 'b4-bandregel-2026-08-30.json');
const ANKER = path.join(REPO, 'reports', 'studie', 'VB-A6-registeranker-2026-08-30.json');

const {
  RUN_ID,
  ERWARTETE_EVENTS,
  SCHWELLEN_INHALT_SHA256,
  SCHWELLEN_DATEI_SHA256,
  BAND_INHALT_SHA256,
  BAND_DATEI_SHA256,
  ANKER_DATEI_SHA256,
  MODUL_SHA256,
  WERKZEUG_SHA256,
  WAECHTER_SHA256,
  KLUMPUNGSEINHEIT,
} = require('../scripts/studie-f6-register');

const dateihash = (pfad) => crypto.createHash('sha256').update(fs.readFileSync(pfad)).digest('hex');
const lies = (pfad) => JSON.parse(fs.readFileSync(pfad, 'utf8'));
// Beide Artefakte liegen mit einem Leerzeichen Einrueckung auf der Platte. Die
// Kopien werden mit derselben Formatierung geschrieben — nur so ist der
// Datei-Hash der unversehrten Kopie identisch mit dem des Originals, und nur
// dann beweist die gruene Gegenprobe etwas.
const schreib = (pfad, obj) => fs.writeFileSync(pfad, `${JSON.stringify(obj, null, 1)}\n`, 'utf8');

function tempdir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f6reg-'));
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Arbeitskopien. Die Originale werden gelesen, nie geschrieben.
function kopien(dir) {
  const ziel = {
    register: path.join(dir, 'ledger.json'),
    schwellen: path.join(dir, 'schwellen.json'),
    band: path.join(dir, 'band.json'),
    anker: path.join(dir, 'anker.json'),
  };
  fs.copyFileSync(LEDGER, ziel.register);
  fs.copyFileSync(SCHWELLEN, ziel.schwellen);
  fs.copyFileSync(BAND, ziel.band);
  fs.copyFileSync(ANKER, ziel.anker);
  return ziel;
}

const laufe = (z, extra = []) => spawnSync(
  process.execPath,
  [SKRIPT, '--register', z.register, '--schwellen', z.schwellen, '--band', z.band,
    '--anker', z.anker, ...extra],
  { encoding: 'utf8' },
);

// ── (f) Die Anker-Probe: was auf main liegt, ist was registriert wird ─────────
// Diese Probe ist der Grund, warum eine spaetere Aenderung an einem der
// Artefakte nicht unbemerkt durchgeht. Sie faellt, sobald jemand eine der
// Dateien anfasst — und das ist erwuenscht, denn dann stimmt der Eintrag nicht
// mehr.
test('F6 (f): die vier Artefakte und drei Dateien auf main tragen genau die registrierten Hashes', () => {
  assert.equal(lies(SCHWELLEN).inhaltSha256, SCHWELLEN_INHALT_SHA256);
  assert.equal(dateihash(SCHWELLEN), SCHWELLEN_DATEI_SHA256);
  assert.equal(lies(BAND).inhaltSha256, BAND_INHALT_SHA256);
  assert.equal(dateihash(BAND), BAND_DATEI_SHA256);
  assert.equal(dateihash(ANKER), ANKER_DATEI_SHA256);
  assert.equal(dateihash(path.join(REPO, 'scripts', 'studie-basisraten.py')), MODUL_SHA256);
  assert.equal(dateihash(path.join(REPO, 'scripts', 'studie-e2-verbreitert.py')), WERKZEUG_SHA256);
  assert.equal(dateihash(path.join(REPO, 'scripts', 'studie-rr9-nullpunkt.py')), WAECHTER_SHA256);
  // Und die Einheit im Wortlaut, nicht sinngemaess.
  assert.equal(
    lies(BAND).inhalt.vierGroessen['3_klumpungseinheit'].gilt,
    KLUMPUNGSEINHEIT,
  );
  // Das Register steht noch auf dem Stand, auf den der Eintrag gebaut ist.
  assert.equal(lies(LEDGER).events.length, ERWARTETE_EVENTS);
});

// ── (a) Trockenlauf schreibt nichts ──────────────────────────────────────────
test('F6 (a): der Trockenlauf laesst Register und Artefakte byte-identisch', () => {
  const dir = tempdir();
  const z = kopien(dir);
  const vorher = [z.register, z.schwellen, z.band, z.anker].map(dateihash);

  const r = laufe(z);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /TROCKENLAUF/);
  assert.match(r.stdout, /eventHash Eintrag 23: [0-9a-f]{64}/);

  const nachher = [z.register, z.schwellen, z.band, z.anker].map(dateihash);
  assert.deepEqual(nachher, vorher);
  // Und das ECHTE Register erst recht nicht.
  assert.equal(lies(LEDGER).events.length, ERWARTETE_EVENTS);
});

// ── (b) verschobenes Kettenende ──────────────────────────────────────────────
test('F6 (b): ein verschobenes Kettenende bricht, ein unversehrtes nicht', () => {
  const dir = tempdir();
  const z = kopien(dir);
  assert.equal(laufe(z).status, 0, 'Gegenprobe: unversehrt muss gruen sein');

  const reg = lies(z.register);
  reg.events.pop(); // ein Eintrag weniger = anderes Kettenende und andere Zahl
  schreib(z.register, reg);
  const r = laufe(z);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /juengste Eintrag ist nicht der erwartete|fuehrt 21 Eintraege/);
});

// ── (c) jede inhaltliche Achse ist erreichbar und rot ────────────────────────
// Die Liste ist der Kern dieses Waechters: jede Zeile ist ein Zweig im Werkzeug,
// und jede Zeile wird EINZELN ausgeloest. Ein Zweig, der nie feuert, ist keiner.
const ACHSEN = [
  ['Schwellen: fremde Fassung', 'schwellen', (d) => { d.grundlage.fassung = 'verbreitertMitBank'; }, /verbreitertOhneBank/],
  ['Schwellen: fremdes Modul', 'schwellen', (d) => { d.provenienz.modulSha256 = 'a'.repeat(64); }, /versiegeltes Modul/],
  ['Schwellen: Aequivalenz-Tor gefallen', 'schwellen', (d) => { d.provenienz.aequivalenzTorBestanden = false; }, /Aequivalenz-Tor/],
  ['Schwellen: anderes p_final', 'schwellen', (d) => { d.jeFamilie['S-U'].pFinal = 90; }, /S-U traegt p_final 90/],
  ['Schwellen: S-UG bekommt ein p_final', 'schwellen', (d) => { d.jeFamilie['S-UG'].pFinal = 95; }, /S-UG traegt p_final 95/],
  ['Schwellen: andere Firmenzahl', 'schwellen', (d) => { d.jeFamilie['S-G'].firmenReif = 547; }, /S-G traegt 547 reife Firmen/],
  ['Schwellen: verstelltes Hash-Feld', 'schwellen', (d) => { d.inhaltSha256 = 'b'.repeat(64); }, /weist inhaltSha256/],
  ['Band: groebere Klumpungseinheit', 'band', (d) => { d.inhalt.vierGroessen['3_klumpungseinheit'].gilt = 'Entity-Klasse x Signalquartal'; }, /als Einheit/],
  ['Band: schon eingefroren', 'band', (d) => { d.freezeStatus.eingefroren = true; }, /bereits als eingefroren/],
  ['Band: verstelltes Hash-Feld', 'band', (d) => { d.inhaltSha256 = 'c'.repeat(64); }, /Band-Artefakt weist inhaltSha256/],
  ['Anker: andere Praeregistrierung', 'anker', (d) => { d.nutzlast.registriertePraeregSha = 'd'.repeat(64); }, /der Anker fuehrt/],
  ['Anker: andere Waechter-Datei', 'anker', (d) => { d.nutzlast.waechterDatei = 'scripts/anderes.py'; }, /nennt Waechter/],
  ['Anker: schon verankert', 'anker', (d) => { d.registerVerankert = true; }, /bereits als register-verankert/],
];

ACHSEN.forEach(([name, welche, verstelle, muster]) => {
  test(`F6 (c): ${name} wird abgewiesen`, () => {
    const dir = tempdir();
    const z = kopien(dir);
    assert.equal(laufe(z).status, 0, 'Gegenprobe: unversehrt muss gruen sein');

    const d = lies(z[welche]);
    verstelle(d);
    schreib(z[welche], d);
    const r = laufe(z);
    assert.equal(r.status, 1, `${name}: haette brechen muessen`);
    assert.match(r.stderr, muster);
    // Und nichts geschrieben, auch nicht im Schreibmodus.
    const vorher = dateihash(z.register);
    laufe(z, ['--schreiben']);
    assert.equal(dateihash(z.register), vorher);
  });
});

// Der Datei-Hash ist das letzte, schaerfste Tor: er faengt auch das Artefakt,
// dessen Inhalt stimmt und dessen Begleittext umgeschrieben wurde.
test('F6 (c): ein umgeschriebener Begleittext faellt am Datei-Hash', () => {
  const dir = tempdir();
  const z = kopien(dir);
  const d = lies(z.schwellen);
  d.stufe = `${d.stufe} (harmlos umformuliert)`;
  // Damit die inhaltlichen Tore NICHT feuern: alle gepruefte Substanz bleibt.
  schreib(z.schwellen, d);
  const r = laufe(z);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /traegt sha256 .*, registriert ist/);
});

// ── (d) dieselbe runId zweimal ───────────────────────────────────────────────
test('F6 (d): eine schon vergebene runId wird abgewiesen', () => {
  const dir = tempdir();
  const z = kopien(dir);
  const r = laufe(z, ['--runid', 'rr9-a3-jahrgang-registrierung-2026-08-30']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /steht schon im Register/);
});

// ── (e) der Eintrag schaltet nachweislich nichts frei ────────────────────────
test('F6 (e): der gebaute Eintrag autorisiert nichts und laesst das Siegel zu', () => {
  const dir = tempdir();
  const z = kopien(dir);
  const r = laufe(z, ['--schreiben']);
  assert.equal(r.status, 0, r.stderr);

  const eintrag = lies(z.register).events[ERWARTETE_EVENTS];
  assert.equal(eintrag.runId, RUN_ID);
  assert.equal(eintrag.typ, 'C0_REGELFREEZE');
  assert.deepEqual(eintrag.allowedOutputs, []);
  assert.match(eintrag.erlaubt, /^Nichts\./);
  assert.match(eintrag.erlaubt, /confirmatory_execution_authorized \(Eintrag 24\)/);
  assert.match(eintrag.endtestSiegel, /in ALLEN Zweigen ZU/);
  // registeredAt < accessedAt, sonst haelt die Verfassungspruefung nicht.
  assert.ok(Date.parse(eintrag.registeredAt) < Date.parse(eintrag.accessedAt));
  // Die vier Pins stehen mit ihren Werten im Eintrag, nicht nur als Behauptung.
  [SCHWELLEN_INHALT_SHA256, SCHWELLEN_DATEI_SHA256, MODUL_SHA256, WERKZEUG_SHA256,
    BAND_INHALT_SHA256, BAND_DATEI_SHA256, WAECHTER_SHA256, KLUMPUNGSEINHEIT]
    .forEach((wert) => assert.ok(
      eintrag.begruendung.includes(wert),
      `der Eintrag fuehrt ${wert.slice(0, 20)}... nicht`,
    ));
  // Und das ECHTE Register ist unberuehrt.
  assert.equal(lies(LEDGER).events.length, ERWARTETE_EVENTS);
});

// ── (f) die Python-Dateien werden am Objekt gehasht ──────────────────────────
test('F6 (f): eine verstellte Python-Datei bricht, auch bei intakten Artefakten', () => {
  const dir = tempdir();
  const z = kopien(dir);
  // Eine vollstaendige Repo-Attrappe waere teuer; es genuegt, dem Werkzeug eine
  // andere Wurzel zu geben, unter der die drei Dateien verstellt liegen.
  const wurzel = path.join(dir, 'repo');
  fs.mkdirSync(path.join(wurzel, 'scripts'), { recursive: true });
  ['studie-basisraten.py', 'studie-e2-verbreitert.py', 'studie-rr9-nullpunkt.py']
    .forEach((n) => fs.copyFileSync(path.join(REPO, 'scripts', n), path.join(wurzel, 'scripts', n)));
  assert.equal(laufe(z, ['--wurzel', wurzel]).status, 0, 'Gegenprobe: Kopien muessen gruen sein');

  fs.appendFileSync(path.join(wurzel, 'scripts', 'studie-basisraten.py'), '\n# ein Zeichen mehr\n');
  const r = laufe(z, ['--wurzel', wurzel]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /studie-basisraten\.py traegt sha256/);
});
