'use strict';

// F6-K17 Schritt 9 — DER WAECHTER UEBER DER ERGEBNIS-REGISTRIERUNG.
//
// Der konfirmatorische Lauf ist gefeuert und mit Exit 0 zu Ende gelaufen;
// dieser Eintrag beurkundet SEIN ERGEBNIS und autorisiert nichts.
//
// GEPRUEFT WIRD DAS WERKZEUG im Werkzeug-PR, der nach T172 dem Ledger-PR
// vorausgeht. Alle Fixtures kuerzen auf das ERWARTETE_EVENTS des Werkzeugs
// selbst und halten damit in BEIDEN Zustaenden - vor und nach dem Eintrag.
//
// HARTE GRENZE: kein Test schreibt in eine echte Registerdatei.
//
// Usage: node --test tests/studie-f6-ergebnis.test.js

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const WURZEL = path.join(__dirname, '..');
const K = require(path.join(WURZEL, 'scripts', 'studie-f6-ergebnis.js'));
const V4 = require(path.join(WURZEL, 'scripts', 'studie-f6-konfirmatorisch-v4.js'));
const { REGISTER_RELS, ART_ZUGRIFF, ART_C0_REGELFREEZE } = require(
  path.join(WURZEL, 'lib', 'studie-verfassung.js'));

const ZIEL = path.join(WURZEL, ...K.ZIEL_REL.split('/'));
const GESCHLOSSEN = path.join(WURZEL, ...REGISTER_RELS[0].split('/'));
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const serialisiere = (o) => `${JSON.stringify(o, null, 1)}\n`;

// Auf das Kettenende kuerzen, das DIESES Werkzeug erwartet - nie auf eine feste
// Laenge. Haelt damit vor und nach dem Eintrag (Beide-Zustaende-Disziplin).
function bisZumKettenende(register) {
  const reg = JSON.parse(JSON.stringify(register));
  while (reg.events.length > K.ERWARTETE_EVENTS) reg.events.pop();
  return reg;
}
const zielRegister = () => JSON.parse(fs.readFileSync(ZIEL, 'utf8'));
const bericht = () => JSON.parse(fs.readFileSync(path.join(WURZEL, ...K.BERICHT_REL.split('/')), 'utf8'));
const wandFest = { danach: 1, zuwachs: 1, restluft: 1 };
const eintrag = (wand = wandFest) => K.baueEintrag(
  '2026-09-02T12:00:00.000Z', '2026-09-02T14:00:00.000Z', bericht(), K.berichtBlob(), wand);

function stillLaufen(argv) {
  const echt = process.stdout.write;
  let aus = '';
  process.stdout.write = (s) => { aus += s; return true; };
  try { K.haupt(argv); } finally { process.stdout.write = echt; }
  return aus;
}

// ── Die Art ───────────────────────────────────────────────────────────────

test('--force gibt es nicht (F6-B8)', () => {
  assert.throws(() => K.haupt(['--force']), /--force gibt es nicht/);
});

test('DIE ART: C0_REGELFREEZE, und NIEMALS die Zugriffsart', () => {
  const e = eintrag();
  assert.strictEqual(e.typ, ART_C0_REGELFREEZE);
  assert.notStrictEqual(e.typ, ART_ZUGRIFF,
    'ein Ergebnis-Eintrag mit Zugriffsart wuerde die LIVE-BINDUNG auf sich '
    + 'ziehen und gegen einen Eintrag pruefen, der keine Bindungen fuehrt');
  assert.strictEqual(K.ART_ERGEBNIS, ART_C0_REGELFREEZE,
    'keine neu erfundene Eintragsart - das waere ein Verfassungsakt');
});

test('LIVE-BINDUNG bleibt auf v4: dieser Eintrag ist kein konfirmatorischer Akt', () => {
  // Die Bindungspruefung des Baums nimmt den LETZTEN Eintrag der Zugriffsart.
  // Haengt man diesen hier an, darf sich daran nichts aendern.
  const kette = bisZumKettenende(zielRegister()).events.concat([eintrag()]);
  const konfirmatorische = kette.filter((e) => (e.typ || e.type) === ART_ZUGRIFF);
  const letzter = konfirmatorische[konfirmatorische.length - 1];
  assert.strictEqual(letzter.runId, V4.RUN_ID,
    'der Ergebnis-Eintrag hat die Bindungspruefung an sich gezogen');
});

test('ZUGRIFFSLOSE FORM: nichts erlaubt, nichts ausgegeben, kein Studienfenster', () => {
  const e = eintrag();
  assert.strictEqual(e.erlaubt, 'Nichts. Kein Datenzugriff.');
  assert.deepStrictEqual(e.allowedOutputs, []);
  assert.deepStrictEqual(e.fenster, ['kein Studienfenster - Ergebnis-Beurkundung ohne Datenzugriff']);
  assert.match(e.verboten, /Kontingent nach F6-K19 ist mit dem hier beurkundeten Lauf VOLLZOGEN/);
  assert.match(e.verboten, /Berufung auf diesen Eintrag als Autorisierung/);
  assert.match(e.laufFreigabe, /AUTORISIERT NICHTS/);
});

test('die Art wird OFFEN gedeutet, nicht stillschweigend umetikettiert', () => {
  const d = eintrag().typDeutung;
  assert.match(d, /kein Regelfreeze im woertlichen Sinn/);
  assert.match(d, /Praezedenzlinie ist drei Akte tief/);
  assert.match(d, /Verfassungsakt, den Speichermechanik nicht kaufen darf/);
  assert.match(d, /ENDZUSTAND DER FAMILIE/);
});

// ── Das Zeitfenster ───────────────────────────────────────────────────────

test('DIE HAUSFORM DES VERMERKS: +2h, nicht der 20-Minuten-Startblock', () => {
  assert.strictEqual(K.VORLAUF_MINUTEN, 120);
  const e = eintrag();
  const spanne = (new Date(e.accessedAt) - new Date(e.registeredAt)) / 60000;
  assert.strictEqual(spanne, 120);
  assert.notStrictEqual(spanne, 20,
    'der 20-Minuten-Fussboden gehoert dem lauf-autorisierenden Akt');
  assert.match(e.fensterVermerk, /NIE ein Tor/);
  assert.match(e.fensterVermerk, /frueherer Entwurf mit eng gesetztem Fenster/);
});

test('die Praezedenzakte tragen wirklich 120 min - am Objekt, nicht behauptet', () => {
  const g = JSON.parse(fs.readFileSync(GESCHLOSSEN, 'utf8'));
  const ids = ['f6-se-klumpen-freeze-2026-08-31', 'f6-eintrag28-ergaenzung-2026-09-01',
    'f6-vorfall-lauf-abbruch-2026-09-01'];
  for (const id of ids) {
    const e = g.events.find((x) => x.runId === id);
    assert.ok(e, `Praezedenzakt ${id} fehlt - die Begruendung der Art faellt`);
    assert.strictEqual(e.typ || e.type, ART_C0_REGELFREEZE, `${id} ist kein C0`);
    assert.strictEqual((new Date(e.accessedAt) - new Date(e.registeredAt)) / 60000, 120,
      `${id} traegt nicht die 120-min-Hausform`);
  }
});

// ── Der Inhalt: gemessen, nicht getippt ───────────────────────────────────

test('das Ergebnis steht Zelle fuer Zelle wie im Bericht', () => {
  const e = eintrag();
  const b = bericht();
  for (const v of ['S-U', 'S-G']) {
    for (const arm of ['signal', 'kontrollpool']) {
      assert.strictEqual(e.ergebnis[v][arm].verdikt, b.daten[v][arm].werte.verdikt);
      assert.strictEqual(e.ergebnis[v][arm].zweig, b.daten[v][arm].zweig);
      assert.strictEqual(e.ergebnis[v][arm].weiter, b.daten[v][arm].werte.weiter);
    }
    assert.strictEqual(e.ergebnis[v].tor.weiter, 0, `${v}: WEITER ist nicht 0`);
    assert.strictEqual(e.ergebnis[v].tor.verdikt, b.daten[v].differenz_punkte.tor.verdikt);
  }
  assert.match(e.ergebnis.alleZellenGemessen, /KEINE gate_gerissen-Zelle/);
});

test('DIE ZWEI S-G-PFLICHTSAETZE stehen WOERTLICH, aus dem Bericht gemessen', () => {
  const e = eintrag();
  const w = bericht().daten['S-G'].signal.werte;
  assert.strictEqual(e.sgPflichtsaetze.pflichtsatz, w.pflichtsatz);
  assert.strictEqual(e.sgPflichtsaetze.zweitsatz, w.zweitsatz);
  // Die nie-Effekt-abwesend-Regel muss im Wortlaut ueberleben.
  assert.match(e.sgPflichtsaetze.zweitsatz, /NIE: 'der Effekt ist abwesend'/);
  assert.match(e.sgPflichtsaetze.lesehilfe, /KEIN Negativbefund/);
});

test('DIE FRIEDHOFS-PFLICHT traegt das Etikett des BANDMODULS, nicht eigenes', () => {
  const e = eintrag();
  assert.strictEqual(e.musterFriedhof.etikettDesBandmoduls,
    bericht().daten['S-U'].signal.werte.etikett);
  assert.match(e.musterFriedhof.etikettDesBandmoduls, /Muster-Friedhof/);
  assert.strictEqual(e.musterFriedhof.torVerdikt, 'TOR GERISSEN');
  assert.match(e.musterFriedhof.beideArme, /GEMESSENES Negativ/);
});

test('A16 / PIN 3: der konstruktive SE ist am Objekt belegt', () => {
  const e = eintrag();
  const b = bericht();
  for (const v of ['S-U', 'S-G']) {
    for (const arm of ['signal', 'kontrollpool']) {
      const w = b.daten[v][arm].werte;
      assert.strictEqual(w.klumpen_anzahl, w.nenner_tor,
        `${v}/${arm}: n_g = 1 gilt nicht - die PIN-3-Feststellung faellt`);
    }
  }
  assert.match(e.a16Pin3.folge, /KONSTRUKTIV auf SE_klumpen-robust/);
  assert.match(e.a16Pin3.folge, /FORMAL, nicht materiell/);
});

test('der Stale-Label-Befund ist PROTOKOLLIERT, nicht gefixt', () => {
  const e = eintrag();
  const d = e.dokumentationsbefund;
  assert.match(d.befund, /zu binden in Eintrag 25/);
  assert.match(d.wasFALSCH_ist, /AUSSCHLIESSLICH die Etiketten/);
  assert.match(d.warumNichtGEFIXT, /AKT-GEBUNDEN/);
  // Und der Befund ist echt: die Etiketten stehen wirklich so im Bericht.
  const stale = bericht().umschlag.gebundeneHashes.filter((g) => /zu binden/.test(g.eintrag || ''));
  assert.strictEqual(stale.length, 3, 'die Praemisse des Befunds stimmt nicht mehr');
});

// ── Der Bericht: der kanonische Blob, nicht die Arbeitskopie ──────────────

test('gebunden wird der COMMITTETE LF-Blob, nicht die CRLF-Arbeitskopie', () => {
  const e = eintrag();
  const blob = K.berichtBlob();
  assert.strictEqual(e.bericht.dateiSha256, blob.sha256);
  assert.strictEqual(e.bericht.groesseBytes, blob.bytes);
  // Die Arbeitskopie ist eine ANDERE Groesse - genau deshalb steht die
  // Messebene im Akt.
  const arbeitskopie = fs.readFileSync(path.join(WURZEL, ...K.BERICHT_REL.split('/')));
  if (arbeitskopie.length !== blob.bytes) {
    assert.notStrictEqual(sha256(arbeitskopie), blob.sha256,
      'Arbeitskopie und Blob sind gleich - dann misst diese Probe nichts');
    assert.match(e.bericht.messform || e.bericht.messebene, /COMMITTETER BLOB/);
  }
});

// ── LR-19 ────────────────────────────────────────────────────────────────

test('LR-19 FIXPUNKT: die Zahlen im Eintrag sind die, die er erzeugt', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'f6erg-'));
  test.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const fixture = path.join(d, 'fortsetzung.json');
  fs.writeFileSync(fixture, serialisiere(bisZumKettenende(zielRegister())));

  const aus = stillLaufen(['--register', fixture]);
  const danach = Number(/Fortsetzung danach\s+(\d+) B/.exec(aus)[1]);
  const zuwachs = Number(/Zuwachs\s+(\d+) B/.exec(aus)[1]);
  const restluft = Number(/Restluft\s+(\d+) B/.exec(aus)[1]);

  const e = eintrag({ danach, zuwachs, restluft });
  assert.strictEqual(e.wandLR19.nachherBytes, danach);
  assert.strictEqual(e.wandLR19.zuwachsBytes, zuwachs);
  assert.strictEqual(e.wandLR19.restluftBytes, restluft);
  // Gegen die FIXTURE-Groesse, nie gegen die echte Datei.
  assert.strictEqual(fs.statSync(fixture).size + zuwachs, danach);
  assert.strictEqual(e.wandLR19.deckelBytes - danach, restluft);
  // Die Einordnung des v4-Akts: ein Ergebnis ist eine Groessenordnung kleiner.
  assert.ok(zuwachs < 47767,
    'der Ergebnis-Eintrag passt nicht in die vom v4-Akt beurkundete Restluft');
});

// ── Der Trockenlauf ──────────────────────────────────────────────────────

test('der Trockenlauf schreibt nichts — beide Aufrufformen (F6-K28)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'f6erg-tr-'));
  test.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const fixture = path.join(d, 'fortsetzung.json');
  fs.writeFileSync(fixture, serialisiere(bisZumKettenende(zielRegister())));

  const vorherEcht = sha256(fs.readFileSync(ZIEL));
  const vorherGeschlossen = sha256(fs.readFileSync(GESCHLOSSEN));
  const vorherFixture = sha256(fs.readFileSync(fixture));

  const ausAbs = stillLaufen(['--register', fixture]);
  const cwd = process.cwd();
  let ausRel;
  try {
    process.chdir(d);
    ausRel = stillLaufen(['--register', 'fortsetzung.json']);
  } finally {
    process.chdir(cwd);
  }

  assert.strictEqual(sha256(fs.readFileSync(ZIEL)), vorherEcht, 'die Fortsetzung wurde angefasst');
  assert.strictEqual(sha256(fs.readFileSync(GESCHLOSSEN)), vorherGeschlossen,
    'die geschlossene Datei wurde angefasst');
  assert.strictEqual(sha256(fs.readFileSync(fixture)), vorherFixture,
    'der Trockenlauf hat ins Fixture geschrieben');
  for (const aus of [ausAbs, ausRel]) {
    assert.match(aus, /TROCKENLAUF - es wurde NICHTS geschrieben/);
    assert.match(aus, /C0_REGELFREEZE/);
  }
});

test('falsche Kettenlaenge -> Abbruch; nach dem eigenen Merge inert', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'f6erg-len-'));
  test.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const kurz = bisZumKettenende(zielRegister());
  kurz.events.pop();
  const a = path.join(d, 'kurz.json');
  fs.writeFileSync(a, serialisiere(kurz));
  assert.throws(() => K.haupt(['--register', a]), /fuehrt \d+ Eintraege, erwartet 3/);

  const nachher = bisZumKettenende(zielRegister());
  nachher.events.push({ runId: K.RUN_ID, typ: ART_C0_REGELFREEZE });
  const b = path.join(d, 'nachher.json');
  fs.writeFileSync(b, serialisiere(nachher));
  assert.throws(() => K.haupt(['--register', b]),
    /fuehrt 4 Eintraege, erwartet 3|bereits belegt/);
});

test('ohne den autorisierenden Akt wird nichts beurkundet', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'f6erg-akt-'));
  test.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const ohne = bisZumKettenende(zielRegister());
  const i = ohne.events.findIndex((e) => e.runId === V4.RUN_ID);
  assert.ok(i >= 0, 'der v4-Akt fehlt in der Kette - Praemisse falsch');
  ohne.events[i] = { ...ohne.events[i], runId: 'umbenannt' };
  const p = path.join(d, 'ohne-akt.json');
  fs.writeFileSync(p, serialisiere(ohne));
  assert.throws(() => K.haupt(['--register', p]),
    /steht 0-mal|erwartet genau einmal/);
});

test('der Eintrag traegt keinen Nutzerpfad', () => {
  const roh = JSON.stringify(eintrag());
  assert.ok(!/[A-Za-z]:[\\/]{1,2}Users/.test(roh), 'Windows-Nutzerpfad im Eintrag');
  assert.ok(!/\/home\/[a-z]/.test(roh), 'Unix-Heimverzeichnis im Eintrag');
});
