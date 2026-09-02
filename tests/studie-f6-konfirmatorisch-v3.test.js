'use strict';

// Waechter fuer scripts/studie-f6-konfirmatorisch-v3.js — den ueberschreibenden
// konfirmatorischen Akt (F6-K11 / F6-K17 Schritt 6).
//
// DIE DREI DINGE, DIE HIER MEHR ZAEHLEN ALS ALLES ANDERE:
//
// (1) DER AKT TRAEGT ALLES, WAS EINTRAG 28 TRUG (F6-K11, LR-2). Diese Behauptung
//     hat Eintrag 28 selbst aufgestellt und nicht gehalten - daran ist er
//     gestorben. Der Waechter prueft sie deshalb MECHANISCH: jedes Feld des
//     Rumpfs und jedes Feld der Eintrag-29-Schicht muss im Akt stehen, und die
//     Pruefung wird einmal ABSICHTLICH GEBROCHEN, damit belegt ist, dass sie
//     feuert.
//
// (2) LRA-12: KEIN SHA WIRD ABGESCHRIEBEN. Eintrag 28 fuehrt fuer
//     scripts/studie-r1-serverzeit.js einen veralteten Wert. Wer den Rumpf
//     kopiert, kopiert ihn mit. Der Waechter haelt JEDEN gebundenen Wert gegen
//     die Datei im Baum.
//
// (3) DIE FIXTURE-KLASSE, die in dieser Kette fuenfmal zugeschlagen hat: das
//     Fixture-Register wird bis zum ERWARTETEN Kettenende abgeschnitten, nie auf
//     eine feste Laenge - fuer die Fortsetzung ist dieses Kettenende JETZT der
//     count-only-Akt, also EIN Eintrag und nicht null. Das echte Register wird
//     nie ohne --register gefahren, und BEIDE Registerstaende muessen auf
//     denselben Stand zurueckschneiden.
//
// Usage: node --test tests/studie-f6-konfirmatorisch-v3.test.js

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const WURZEL = path.join(__dirname, '..');
const K = require(path.join(WURZEL, 'scripts', 'studie-f6-konfirmatorisch-v3.js'));
const { REGISTER_RELS, haengeEintragAn, ART_ZUGRIFF } = require(path.join(WURZEL, 'lib', 'studie-verfassung.js'));

const ZIEL = path.join(WURZEL, ...K.ZIEL_REL.split('/'));
const GESCHLOSSEN = path.join(WURZEL, ...REGISTER_RELS[0].split('/'));
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const serialisiere = (reg) => `${JSON.stringify(reg, null, 1)}\n`;
const abs = (rel) => path.join(WURZEL, ...rel.split('/'));

// Der Stand VOR diesem Akt: die Fortsetzung, abgeschnitten bis zu dem
// Kettenende, das DIESES Werkzeug erwartet. Nicht auf eine feste Laenge - der
// Wert kommt aus dem Werkzeug selbst und wandert mit ihm.
function bisZumKettenende(register) {
  const reg = JSON.parse(JSON.stringify(register));
  while (reg.events.length > K.ERWARTETE_EVENTS) reg.events.pop();
  return reg;
}

const geschlossenesRegister = () => JSON.parse(fs.readFileSync(GESCHLOSSEN, 'utf8'));
const quellen = () => {
  const reg = geschlossenesRegister();
  return [K.quellAkt(K.RUMPF, reg), K.quellAkt(K.SCHICHT, reg), K.quellAkt(K.VORFALL, reg)];
};
const bauen = () => {
  const [e28, e29, e30] = quellen();
  return K.baueEintrag('2026-09-02T08:00:00.000Z', '2026-09-02T08:20:00.000Z', e28, e29, e30);
};
const eintrag = () => bauen().eintrag;

function stillLaufen(argv) {
  const echt = process.stdout.write;
  let aus = '';
  process.stdout.write = (s) => { aus += s; return true; };
  try { K.haupt(argv); } finally { process.stdout.write = echt; }
  return aus;
}

test('--force gibt es nicht (F6-B8)', () => {
  assert.throws(() => K.haupt(['--force']), /--force gibt es nicht/);
});

// ── (1) Der Akt traegt ALLES ───────────────────────────────────────────────

test('jedes Feld des Rumpfs und der Schicht steht im Akt (F6-K11, LR-2)', () => {
  const [e28, e29] = quellen();
  const e = eintrag();
  const umschlag = new Set(['runId', 'typ', 'registeredAt', 'accessedAt',
    'previousHash', 'eventHash']);
  for (const feld of Object.keys(e28)) {
    if (umschlag.has(feld)) continue;
    assert.ok(feld in e, `Feld ${feld} aus dem Rumpf fehlt im Akt`);
  }
  for (const feld of ['f6c8hSchicht', 'richtungsOffenlegungBerichtigung',
    'torRegeltextWoertlich', 'konservierteDissense', 'zitattreueC9e', 'weitereVermerke']) {
    assert.deepStrictEqual(e[feld], e29[feld], `${feld} ist nicht woertlich aus der Schicht`);
  }
  // Der KZ-20-Abschnitt ist Bedingung: "ohne diesen Abschnitt kein Eintrag".
  assert.ok(e.kz20Ruecklauf, 'der KZ-20-Abschnitt fehlt');
  assert.ok(Array.isArray(e.kz20Ruecklauf.treffer) && Array.isArray(e.kz20Ruecklauf.nichtTreffer),
    'der KZ-20-Abschnitt fuehrt nicht Treffer UND Nicht-Treffer');
});

test('die Weggefallenes-Pruefung FEUERT — einmal absichtlich gebrochen', () => {
  const [e28] = quellen();
  const umschlag = new Set(['runId', 'typ', 'registeredAt', 'accessedAt',
    'previousHash', 'eventHash']);
  const sollFelder = [
    ...Object.keys(e28).filter((k) => !umschlag.has(k)),
    'f6c8hSchicht', 'richtungsOffenlegungBerichtigung', 'torRegeltextWoertlich',
    'konservierteDissense', 'zitattreueC9e', 'weitereVermerke',
  ];
  const e = eintrag();

  // Ungebrochen: null Treffer - und die Zahl ist nicht fest verdrahtet.
  assert.deepStrictEqual(K.pruefeWeggefallenes(sollFelder, e), []);
  assert.ok(sollFelder.length > 0, 'eine Pruefung ueber null Feldern ist stumm gruen');
  assert.strictEqual(e.weggefallenes.eigenePruefung.gepruefteFelder, sollFelder.length);

  // GEBROCHEN: genau ein getragenes Feld entfernt. Die Pruefung MUSS feuern -
  // sonst bezeugt sie nichts, und der Akt koennte "traegt alles" behaupten,
  // ohne es zu tun. Gebrochen wird eine Kopie; der Akt selbst bleibt heil.
  const verstuemmelt = { ...e };
  delete verstuemmelt[sollFelder[0]];
  assert.throws(() => K.pruefeWeggefallenes(sollFelder, verstuemmelt),
    /findet 1 verlorene Felder/,
    'die Weggefallenes-Pruefung faengt ein verlorenes Feld NICHT');
});

test('die zwei gemessenen Verluste aus Eintrag 28 stehen im Akt (Dok. 4)', () => {
  const e = eintrag();
  const roh = JSON.stringify(e.weggefallenes);
  assert.match(roh, /ledger:1050/);
  assert.match(roh, /ledger:966/);
  assert.match(e.weggefallenes.rechtsfolge, /ERZEUGT KEINE ERLAUBNIS/);
});

test('OB-1 und OB-2 stehen im Akt, mit Kuerzel-Warnung (Dok. 3)', () => {
  const e = eintrag();
  assert.ok(e.punkteOhneBeschluss['OB-1'] && e.punkteOhneBeschluss['OB-2']);
  assert.match(e.punkteOhneBeschluss['OB-1'].folge, /bleibt bei VIER/);
  // Der Korpus belegt dieselben Kuerzel mehrfach - ohne diesen Satz liest ein
  // spaeterer Leser das OB-1 der ANHANG-3-Serie.
  assert.match(e.punkteOhneBeschluss.kuerzelWarnung, /ANHANG-3-Serie/);
});

// ── (2) LRA-12: kein SHA wird abgeschrieben ────────────────────────────────

test('JEDER gebundene SHA ist am Objekt gemessen, keiner abgeschrieben', () => {
  const e = eintrag();
  for (const karte of ['skripte', 'artefakte']) {
    for (const [rel, wert] of Object.entries(e.eingabenHashes[karte])) {
      assert.strictEqual(wert.dateiSha256, sha256(fs.readFileSync(abs(rel))),
        `${rel} ist nicht am Objekt gemessen (LRA-12)`);
    }
  }
});

test('der veraltete Serverzeit-SHA aus Eintrag 28 wird NICHT fortgeschrieben', () => {
  const [e28] = quellen();
  const rel = 'scripts/studie-r1-serverzeit.js';
  const e = eintrag();
  const alt = e28.eingabenHashes.skripte[rel].dateiSha256;
  const neu = e.eingabenHashes.skripte[rel].dateiSha256;
  assert.notStrictEqual(neu, alt,
    'der Akt traegt den veralteten Wert aus Eintrag 28 weiter - genau der LRA-12-Fall');
  assert.strictEqual(neu, sha256(fs.readFileSync(abs(rel))));
  // Und die Drift ist ausgewiesen, nicht stillschweigend korrigiert (F6-C24a).
  assert.strictEqual(e.eingabenHashes.vorherNachher[rel].vorher, alt);
  assert.strictEqual(e.eingabenHashes.vorherNachher[rel].nachher, neu);
  assert.match(e.eingabenHashes.vorherNachher[rel].durch, /LRA-12/);
});

test('der Option-A-Aufrufer wird erstmals gebunden, mit art und rolle', () => {
  const rel = 'scripts/studie-f6-zaehlprobe-fortsetzung.py';
  const [e28] = quellen();
  assert.ok(!(rel in e28.eingabenHashes.skripte), 'der Aufrufer war schon in Eintrag 28 gebunden');
  const e = eintrag();
  assert.strictEqual(e.eingabenHashes.skripte[rel].dateiSha256, sha256(fs.readFileSync(abs(rel))));
  assert.strictEqual(e.eingabenHashes.skripte[rel].art, 'ausfuehrend');
  assert.ok(e.eingabenHashes.skripte[rel].rolle, 'die Bindung fuehrt keine rolle (F6-C24a)');
  assert.strictEqual(e.eingabenHashes.vorherNachher[rel].vorher, null);
});

test('die Aequivalenz-Evidenz ist der v2-Bericht samt Treiber', () => {
  const e = eintrag();
  const ab = e.eingabenHashes.aequivalenzBericht;
  assert.match(ab.pfad, /f6-aequivalenz-entdeckung-v2-2026-09-02\.json$/);
  assert.strictEqual(ab.dateiSha256, sha256(fs.readFileSync(abs(ab.pfad))));
  assert.strictEqual(ab.verdikt, true);
  assert.match(ab.treiberSha256, /^[0-9a-f]{64}$/);
  // Der Treiber hat nichts entschieden - das muss dastehen, sonst liest ein
  // spaeterer Pruefer ihn als Instrument statt als Glue.
  assert.match(ab.treiberHinweis, /rechnet nichts/);
  assert.strictEqual(ab.registerDatei, K.ZIEL_REL);
});

// ── Form, Adressierung, Zeit ───────────────────────────────────────────────

test('der Akt ist konfirmatorisch und feuert nicht selbst', () => {
  const e = eintrag();
  assert.strictEqual(e.typ, 'confirmatory_execution_authorized');
  assert.ok(Date.parse(e.registeredAt) < Date.parse(e.accessedAt), 'VB-A11');
  assert.match(e.laufFreigabe, /FEUERT NICHT MIT DIESEM EINTRAG/);
  assert.match(e.laufFreigabe, /DER LETZTE/);
  assert.match(e.blindAttest, /KEINERLEI Information/);
  assert.match(e.fortsetzungsHinweis, /ZWEITER Eintrag der Fortsetzungsdatei/);
});

test('der Zugriffs-Fussboden ist ein Startblock, kein Vermerks-Vorlauf', () => {
  // Der Konstruktionsfehler des ersten Anlaufs: +120 min aus der Vermerks-Form
  // in einen Akt, der einen LAUF autorisiert. Zu frueh kostet nichts, zu spaet
  // kostet den Lauf.
  assert.ok(K.VORLAUF_MINUTEN <= 30,
    `Vorlauf ${K.VORLAUF_MINUTEN} min - ein Lauf-Akt bekommt keinen Vermerks-Vorlauf`);
});

test('Rumpf, Schicht und Vorfall werden nach DATEI + eventHash adressiert (LR-21)', () => {
  const e = eintrag();
  const s = e.supersedierungVon28;
  for (const ziel of [s.ueberholterEintrag, s.vorfall]) {
    assert.strictEqual(ziel.datei, REGISTER_RELS[0]);
    assert.match(ziel.eventHash, /^[0-9a-f]{64}$/);
    assert.ok(!('ordinal' in ziel), 'eine Ordnungszahl adressiert nach der Teilung nicht mehr');
  }
  assert.match(s.adressierungshinweis, /KEINE eindeutige Adresse/);
  // F6-K12: der Unterschied zum 27->28-Muster wird getragen, nicht verschwiegen.
  assert.match(s.ehrlichkeitspflicht, /NICHT ZUR VERFUEGUNG/);
  assert.match(s.eigeneBegruendung, /schwaecherer/);
  // Der Anker-Kontext: die Vorfall-Fundstellen loesen gegen den ALTEN Laeufer auf.
  assert.match(s.vorfall.ankerkontext, /VOR der F6-K13-Reparatur/);
});

test('ein verbogener Quell-Hash bricht ab, statt zu kopieren', () => {
  const echt = K.RUMPF.eventHash;
  try {
    K.RUMPF.eventHash = `0${echt.slice(1)}`;
    assert.throws(() => K.quellAkt(K.RUMPF, geschlossenesRegister()),
      /Ein anderer Hash ist ein anderer Akt/);
  } finally {
    K.RUMPF.eventHash = echt;
  }
});

test('der Akt traegt keinen Nutzerpfad', () => {
  const { pruefeR12a } = require(path.join(WURZEL, 'scripts', 'studie-f6-vorfall.js'));
  assert.doesNotThrow(() => pruefeR12a(eintrag()));
  const BS = String.fromCharCode(92);
  assert.throws(() => pruefeR12a({ a: `C:${BS}Users${BS}Jemand` }), /Windows-Laufwerkspfad/);
});

// ── LR-20 und der Schliessungsriegel ───────────────────────────────────────

test('LR-20 verweigert bei ERREICHTEM Deckel, nicht erst darueber', () => {
  assert.throws(() => K.pruefeDeckel(K.DECKEL_BYTES), /LR-20/);
  assert.doesNotThrow(() => K.pruefeDeckel(K.DECKEL_BYTES - 1));
});

test('LR-20 greift DURCH das Werkzeug, nicht nur als Funktion', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'k11-deckel-'));
  test.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const reg = bisZumKettenende(JSON.parse(fs.readFileSync(ZIEL, 'utf8')));
  // Gross genug, dass der Akt den Deckel ERREICHT, klein genug, dass die
  // Fixture VOR dem Akt noch darunter liegt - sonst prueft sie das Falsche.
  reg.fuellung = 'x'.repeat(K.DECKEL_BYTES - 70000);
  const ziel = path.join(d, 'zu-gross.json');
  fs.writeFileSync(ziel, serialisiere(reg));
  assert.ok(fs.statSync(ziel).size < K.DECKEL_BYTES,
    'die Fixture muss VOR dem Akt noch unter dem Deckel liegen, sonst prueft sie das Falsche');
  assert.throws(() => stillLaufen(['--register', ziel]), /LR-20/);
});

test('in eine GESCHLOSSENE Datei schreibt dieser Akt nicht', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'k11-zu-'));
  test.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const ziel = path.join(d, 'geschlossen.json');
  fs.copyFileSync(GESCHLOSSEN, ziel);
  assert.throws(() => stillLaufen(['--register', ziel]),
    /geschlossen - dieser Akt gehoert in die Fortsetzung/);
});

// ── (3) Die Fixture-Klasse ─────────────────────────────────────────────────

test('das erwartete Kettenende ist der count-only-Akt, nicht der Genesis', () => {
  // Haette diese Probe die 0 der Vorgaenger-Fixture geerbt, ginge sie beim
  // ersten echten Eintrag rot, ohne dass an ihrem Gegenstand etwas falsch waere.
  assert.strictEqual(K.ERWARTETE_EVENTS, 1);
  const lebend = JSON.parse(fs.readFileSync(ZIEL, 'utf8'));
  assert.ok(lebend.events.length >= K.ERWARTETE_EVENTS);
});

test('beide Registerstaende schneiden auf denselben Stand zurueck', () => {
  const lebend = JSON.parse(fs.readFileSync(ZIEL, 'utf8'));
  const ohne = bisZumKettenende(lebend);
  assert.strictEqual(ohne.events.length, K.ERWARTETE_EVENTS);

  const mit = haengeEintragAn(ohne, eintrag());
  assert.strictEqual(mit.events.length, ohne.events.length + 1);

  const a = serialisiere(ohne);
  const b = serialisiere(bisZumKettenende(mit));
  assert.strictEqual(sha256(Buffer.from(b, 'utf8')), sha256(Buffer.from(a, 'utf8')),
    'die beiden Registerstaende schneiden NICHT auf denselben Stand zurueck');
});

test('der Trockenlauf schreibt nichts — beide Aufrufformen (F6-K28)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'k11-'));
  test.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const fixture = path.join(d, 'fortsetzung.json');
  fs.writeFileSync(fixture,
    serialisiere(bisZumKettenende(JSON.parse(fs.readFileSync(ZIEL, 'utf8')))));

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
    assert.match(aus, /Weggefallenes\s+\d+ Felder geprueft, 0 Treffer/);
  }
});

test('nach dem eigenen Merge ist das Werkzeug inert (Einweg-Anhaenger)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'k11-inert-'));
  test.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const nachMerge = haengeEintragAn(
    bisZumKettenende(JSON.parse(fs.readFileSync(ZIEL, 'utf8'))), eintrag());
  const ziel = path.join(d, 'nach-merge.json');
  fs.writeFileSync(ziel, serialisiere(nachMerge));
  assert.throws(() => stillLaufen(['--register', ziel]),
    /Eintraege, erwartet 1|runId .* ist bereits belegt/);
});

// ── Der Drift-Melder fuer den LEBENDEN Baum ────────────────────────────────
//
// Er loest den UEBERGANGS-PIN aus tests/studie-f6-eintrag28.test.js ab. Jener
// Pin trug eine HANDKOPIE eines einzelnen SHA und war ausdruecklich temporaer:
// "zu entfernen, sobald der ueberschreibende Akt den neuen SHA bindet - ab dann
// traegt der Eintrag die Bindung". Der Eintrag traegt sie jetzt. Damit "traegt"
// aber auch bewacht heisst, braucht es diese Probe: die Werkbank in
// studie-f6-eintrag28.test.js misst den HISTORISCHEN Stand gegen Eintrag 28,
// nicht den lebenden Baum.
//
// Diese Probe pinnt die SACHE statt einer Zahl: sie haelt JEDEN Pfad, den der
// REGISTRIERTE Akt bindet, gegen die Datei im Baum - zwoelf statt einem, und
// ohne eine einzige abgeschriebene Konstante. Faellt sie, ist entweder eine
// gebundene Datei nach dem Akt veraendert worden (F6-C24(3) gebrochen) oder der
// Akt ist nicht mehr der, unter dem gelaufen wird.

// KETTEN-AKTUELL, nicht konstant. Die runId stand hier fest verdrahtet - und
// eine fest verdrahtete runId ist genau das, was das LIVE-BINDUNGS-Prinzip
// verbietet ("aus dem Register, nie aus Konstanten"). Ein Pin auf einen
// benannten Akt geht mit jeder Ueberschreibung dauerhaft rot und laedt zum
// Aufraeumen ein - dieselbe Klasse wie der abgeloeste UEBERGANGS-PIN.
// Gebunden wird deshalb der LETZTE confirmatory_execution_authorized-Akt der
// KETTE. Erlauben kann das nichts: kein Akt -> rot; Akt mit Drift -> rot; eine
// Ueberschreibung wird automatisch mitgenommen.
function letzterKonfirmatorischer(alleEreignisse) {
  const akte = alleEreignisse.filter((e) => (e.typ || e.type) === ART_ZUGRIFF);
  return akte.length ? akte[akte.length - 1] : null;
}

const ketteEreignisse = () => {
  const alle = [];
  for (const rel of REGISTER_RELS) {
    const reg = JSON.parse(fs.readFileSync(abs(rel), 'utf8'));
    alle.push(...(reg.events || []));
  }
  return alle;
};

const aktAusDemRegister = () => {
  const akt = letzterKonfirmatorischer(ketteEreignisse());
  assert.ok(akt, 'die Kette fuehrt keinen konfirmatorischen Akt - dann bindet nichts den Baum');
  return akt;
};

// ── UEBERGANGS-BRUECKE — DATIERT, ZUM ENTFERNEN BESTIMMT ──────────────────
//
// Die F6-K13-Folgereparaturen aendern den Laeufer. Der aktuell registrierte
// Akt bindet den Stand DAVOR; bis der v4-Akt den neuen bindet, waere jede
// Zwischen-PR rot - und "Waechter weich machen" waere die Erosion, gegen die
// die ganze Registerordnung gebaut ist.
//
// Die Bruecke ist die ratifizierte Hausform dafuer: fuer GENAU DIE DATEIEN,
// die die Reparatur anfasst, gilt der registrierte ODER der hier ERKLAERTE
// Zwischenstand. Fuer jede andere Datei bleibt allein der registrierte Wert.
// Ein DRITTER Wert ist auch fuer eine erklaerte Datei rot.
//
// SIE HEBT SICH SELBST AUF: sobald der registrierte Akt den Zwischenstand
// bindet, verlangt eine Probe ihre Entfernung. Ohne diese Probe bliebe sie als
// stille Zweitwahrheit stehen.
const UEBERGANGS_BRUECKE = {
  gesetztAm: '2026-09-02',
  entfernenWenn: 'v4 act registered',
  grund: 'F6-K13-Folgereparaturen (Phase-2a-Schreibprobe HIGH-2, R12a-Schrubbe '
    + 'des ZaehlwerkAbbruch-Texts MEDIUM-1) PLUS die Reparatur-Familie aus '
    + '_COURT-F6-LAUFFAEHIGKEIT-2026-09-02: Q1 (SE-Fang an den drei '
    + 'Sterbestellen) und Q2 (Ketten-Aufloesung in beiden Phasen).',
  dateien: {
    // BEWEGLICHES ZIEL, bei Familien-Schluss NEU GEMESSEN. Jede weitere Zeile
    // am Laeufer aendert diesen Wert; ein stehengebliebener alter Wert zeigt
    // auf einen toten Stand und faerbt LIVE-BINDUNG rot. Gemessen am
    // 2026-09-02 nach der letzten Runner-Zeile der Familie.
    'scripts/studie-f6-lauf.py':
      '143065394fc8216695d634535e14160d8cc27b1e88228049250429fa87c51dd5',
  },
};

// Die Entscheidung als reine Funktion - nur so ist sie zweiseitig pruefbar,
// ohne den Baum zu veraendern.
function bindungTraegt(rel, istSha, registriertSha) {
  if (istSha === registriertSha) return true;
  const brueckenWert = UEBERGANGS_BRUECKE.dateien[rel];
  return Boolean(brueckenWert) && istSha === brueckenWert;
}

test('LIVE-BINDUNG: der Baum traegt genau die Bytes, die der registrierte Akt bindet', () => {
  const akt = aktAusDemRegister();
  // BEIDE Karten. Die erste Fassung sah nur `skripte` und liess damit die
  // Artefakt-Bindungen ungedeckt - darunter reports/studie/E4d-kadenz-*.json,
  // die Bein-2-Basis, die auf dem Laufweg von NICHTS geprueft wird. Eine
  // halbe Bindungspruefung ist eine Zusicherung ueber die falsche Menge.
  const gebunden = [
    ...Object.entries(akt.eingabenHashes.skripte),
    ...Object.entries(akt.eingabenHashes.artefakte),
  ];
  assert.ok(gebunden.length > Object.keys(akt.eingabenHashes.skripte).length,
    'die Artefakt-Karte wird nicht mitgeprueft - genau die halbe Menge');
  for (const [rel, wert] of gebunden) {
    const ist = sha256(fs.readFileSync(abs(rel)));
    assert.ok(bindungTraegt(rel, ist, wert.dateiSha256),
      `${rel} weicht von der Bindung des REGISTRIERTEN Akts ab und ist auch nicht als `
      + 'Uebergang erklaert. Entweder wurde die Datei nach dem Akt veraendert - dann ist '
      + 'F6-C24(3) gebrochen und der Lauf darf nicht starten -, oder der Akt ist nicht '
      + 'mehr der, unter dem gelaufen wird.');
  }
});

test('KETTEN-BINDUNG: kein Akt -> nichts gebunden, mehrere -> der letzte', () => {
  // (i) Ohne konfirmatorischen Akt darf NICHTS als gebunden gelten - fail-closed.
  assert.equal(letzterKonfirmatorischer([]), null,
    'ohne Akt gilt etwas als gebunden - dann erlaubt die Bindung mehr als vorher');
  assert.equal(letzterKonfirmatorischer([{ typ: 'C0_REGELFREEZE' }]), null,
    'ein Vermerk wird als konfirmatorischer Akt gelesen');
  // (ii) Der LETZTE gewinnt, Vermerke dazwischen stoeren nicht.
  const alt = { typ: ART_ZUGRIFF, runId: 'alt' };
  const neu = { typ: ART_ZUGRIFF, runId: 'neu' };
  assert.equal(
    letzterKonfirmatorischer([alt, { typ: 'C0_REGELFREEZE' }, neu]).runId, 'neu');
  // (iii) Eine Ueberschreibung wird AUTOMATISCH mitgenommen - genau der Punkt
  // dieser Umstellung: kein Waechter muss beim naechsten Akt nachgezogen werden.
  assert.equal(letzterKonfirmatorischer([alt, neu, { typ: ART_ZUGRIFF, runId: 'v4' }]).runId,
    'v4');
  // (iv) Am echten Objekt, OHNE eine runId zu nennen: nach dem gewaehlten Akt
  // steht kein weiterer konfirmatorischer in der Kette.
  // BEIDE aus DERSELBEN Lesung - zwei Lesungen liefern zwei Objektidentitaeten,
  // indexOf faende dann -1 und die Probe waere stumm gruen bzw. falsch rot.
  const alle = ketteEreignisse();
  const echt = letzterKonfirmatorischer(alle);
  const nach = alle.slice(alle.indexOf(echt) + 1);
  assert.equal(nach.some((e) => (e.typ || e.type) === ART_ZUGRIFF), false,
    'ein spaeterer konfirmatorischer Akt wurde uebergangen');
});

test('BRUECKE: erklaerte Datei ja, dritter Wert nein, fremde Datei nie', () => {
  const registriert = 'a'.repeat(64);
  const erklaert = UEBERGANGS_BRUECKE.dateien['scripts/studie-f6-lauf.py'];
  const dritter = 'c'.repeat(64);
  // (i) der registrierte Wert traegt immer.
  assert.equal(bindungTraegt('scripts/studie-f6-lauf.py', registriert, registriert), true);
  // (ii) der ERKLAERTE Zwischenstand traegt - genau dafuer gibt es die Bruecke.
  assert.equal(bindungTraegt('scripts/studie-f6-lauf.py', erklaert, registriert), true);
  // (iii) ein DRITTER Wert ist auch fuer eine erklaerte Datei rot.
  assert.equal(bindungTraegt('scripts/studie-f6-lauf.py', dritter, registriert), false,
    'die Bruecke laesst einen beliebigen Wert durch - dann ist sie keine Bruecke, sondern ein Loch');
  // (iv) eine NICHT erklaerte Datei bekommt keine Nachsicht.
  assert.equal(bindungTraegt('scripts/studie-basisraten.py', erklaert, registriert), false,
    'undeklarierte Drift wird durchgelassen');
});

test('BRUECKE hebt sich selbst auf: bindet der Akt den Zwischenstand, muss sie weg', () => {
  const akt = aktAusDemRegister();
  for (const [rel, brueckenWert] of Object.entries(UEBERGANGS_BRUECKE.dateien)) {
    const registriert = (akt.eingabenHashes.skripte[rel]
      || akt.eingabenHashes.artefakte[rel] || {}).dateiSha256;
    assert.notEqual(brueckenWert, registriert,
      `${rel}: der registrierte Akt bindet bereits den erklaerten Zwischenstand. Die Bruecke `
      + `ist damit gegenstandslos und GEHOERT ENTFERNT (entfernenWenn: `
      + `"${UEBERGANGS_BRUECKE.entfernenWenn}") - eine stehengebliebene Bruecke ist eine `
      + 'stille Zweitwahrheit.');
  }
});

test('LIVE-BINDUNG BRUCHPROBE: ein veraendertes Byte faellt auf', () => {
  const akt = aktAusDemRegister();
  const rel = 'scripts/studie-f6-lauf.py';
  assert.ok(akt.eingabenHashes.skripte[rel], 'der Laeufer ist nicht gebunden');
  const verstellt = Buffer.concat([
    fs.readFileSync(abs(rel)), Buffer.from('\n# verstellt\n', 'utf8'),
  ]);
  assert.notStrictEqual(sha256(verstellt), akt.eingabenHashes.skripte[rel].dateiSha256,
    'die Live-Bindung muesste hier anschlagen - sonst bewacht sie nichts');
});
