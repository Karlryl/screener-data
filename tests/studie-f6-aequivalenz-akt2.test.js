'use strict';

// Waechter fuer scripts/studie-f6-aequivalenz-akt2.js — den zweiten
// Zaehlproben-Akt (F6-K16 / F6-K17 Schritt 2).
//
// DIE ZWEI DINGE, DIE HIER MEHR ZAEHLEN ALS ALLES ANDERE:
//
// (1) DIE SOLLWERTE SIND KOPIERT, NICHT ABGETIPPT. KZ-4 ist scharf - eine
//     einzige abweichende Zahl reisst den Lauf, es gibt keinen zweiten
//     Kandidaten-Sollwert und kein "nah genug". Ein von Hand uebertragener
//     Sollwert waere genau die Gelegenheit dazu. Der Waechter prueft deshalb
//     die IDENTITAET mit dem Quell-Akt, nicht eine Liste erwarteter Zahlen -
//     und er liest die Zahlen selbst nie.
//
// (2) DIE FIXTURE-KLASSE, die in dieser Kette fuenfmal zugeschlagen hat: das
//     Fixture-Register wird bis zum ERWARTETEN Kettenende abgeschnitten, nie
//     auf eine feste Laenge; das echte Register wird nie ohne --register
//     gefahren; und BEIDE Registerstaende - mit und ohne den eigenen Eintrag -
//     muessen auf denselben Stand zurueckschneiden.
//
// Usage: node --test tests/studie-f6-aequivalenz-akt2.test.js

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const WURZEL = path.join(__dirname, '..');
const K = require(path.join(WURZEL, 'scripts', 'studie-f6-aequivalenz-akt2.js'));
const { REGISTER_RELS, haengeEintragAn } = require(path.join(WURZEL, 'lib', 'studie-verfassung.js'));

const ZIEL = path.join(WURZEL, ...K.ZIEL_REL.split('/'));
const GESCHLOSSEN = path.join(WURZEL, ...REGISTER_RELS[0].split('/'));
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const serialisiere = (reg) => `${JSON.stringify(reg, null, 1)}\n`;

// Der Stand VOR diesem Akt: die Fortsetzung, abgeschnitten bis zu dem
// Kettenende, das DIESES Werkzeug erwartet. Die Fortsetzung ist heute leer,
// also ist das Kettenende ihr GENESIS - nicht ein Eintrag. Deshalb wird auf
// die Eintragszahl 0 zurueckgeschnitten und nicht auf einen eventHash.
function bisZumKettenende(register) {
  const reg = JSON.parse(JSON.stringify(register));
  while (reg.events.length > K.ERWARTETE_EVENTS) reg.events.pop();
  return reg;
}

const quelle = () => K.quellAkt();
const eintrag = () => K.baueEintrag(
  '2026-09-02T08:00:00.000Z', '2026-09-02T10:00:00.000Z', quelle());

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

// ── (1) Die Sollwerte: KOPIERT, nicht abgetippt ────────────────────────────

test('aequivalenzSoll ist mit dem Quell-Akt IDENTISCH, nicht nachgebaut', () => {
  const q = quelle();
  const e = eintrag();
  // deepStrictEqual auf dem ganzen Block: eine einzige abweichende Zahl faellt
  // auf, ohne dass diese Probe je eine Zahl nennen muesste.
  assert.deepStrictEqual(e.aequivalenzSoll, q.aequivalenzSoll,
    'die Sollwerte weichen vom Quell-Akt ab - KZ-4 kennt keinen zweiten Kandidaten-Sollwert');
  // Und die uebrigen woertlich uebernommenen Felder.
  for (const feld of ['fenster', 'allowedOutputs', 'erlaubt', 'verboten', 'endtestSiegel']) {
    assert.deepStrictEqual(e[feld], q[feld], `${feld} wurde nicht woertlich uebernommen`);
  }
});

test('der Quell-Akt wird ueber DATEI + eventHash adressiert und nachgerechnet', () => {
  const e = eintrag();
  assert.strictEqual(e.quellAkt.datei, REGISTER_RELS[0]);
  assert.strictEqual(e.quellAkt.eventHash, K.QUELLE.eventHash);
  assert.match(e.quellAkt.eventHash, /^[0-9a-f]{64}$/);
  // Die Adressform ist der Punkt: eine Ordnungszahl ist nach der Teilung des
  // Registers keine eindeutige Adresse mehr (LR-21).
  assert.match(e.quellAkt.adressform, /nie eine Ordnungszahl/);
  // Der Quell-Akt liegt in der GESCHLOSSENEN Datei und bleibt dort (LR-15).
  const geschlossen = JSON.parse(fs.readFileSync(GESCHLOSSEN, 'utf8'));
  assert.strictEqual(
    geschlossen.events.filter((x) => x.runId === K.QUELLE.runId).length, 1);
});

test('ein verbogener Quell-Hash bricht ab, statt die Sollwerte zu kopieren', () => {
  // Der Riegel gegen genau die Klasse, die KZ-4 fuerchtet: Sollwerte aus einem
  // Akt zu uebernehmen, der nicht der ist, fuer den man ihn haelt.
  const echt = K.QUELLE.eventHash;
  try {
    K.QUELLE.eventHash = `0${echt.slice(1)}`;
    assert.throws(() => K.quellAkt(), /Ein anderer Hash ist ein anderer Akt/);
  } finally {
    K.QUELLE.eventHash = echt;
  }
});

// ── Die Form des Akts ──────────────────────────────────────────────────────

test('der Akt ist eine Zaehlprobe und autorisiert keinen konfirmatorischen Lauf', () => {
  const e = eintrag();
  assert.strictEqual(e.typ, 'count_only_probe_authorized');
  assert.ok(Date.parse(e.registeredAt) < Date.parse(e.accessedAt), 'VB-A11');
  assert.match(e.laufFreigabe, /AUTORISIERT KEINEN KONFIRMATORISCHEN LAUF/);
  assert.match(e.laufFreigabe, /confirmatory_execution_authorized/);
  assert.match(e.blindAttest, /KEINERLEI Information/);
  assert.match(e.fortsetzungsHinweis, /ERSTER Eintrag der Fortsetzungsdatei/);
});

test('die Skript-Drift steht vorher/nachher im Akt und ist am Objekt gemessen', () => {
  const q = quelle();
  const e = eintrag();
  // Dieselbe Pfadmenge wie der Quell-Akt - kein Werkzeug faellt beim
  // Abschreiben heraus.
  assert.deepStrictEqual(
    Object.keys(e.ausfuehrendeSkripte).sort(), Object.keys(q.ausfuehrendeSkripte).sort());
  // Jeder Wert ist der SHA der Datei, wie sie im Baum liegt.
  for (const [rel, wert] of Object.entries(e.ausfuehrendeSkripte)) {
    const p = path.join(WURZEL, ...rel.split('/'));
    assert.strictEqual(wert, sha256(fs.readFileSync(p)), `${rel} ist nicht am Objekt gemessen`);
  }
  // Und die gemeldete Drift ist genau die Menge, die wirklich abweicht.
  const abweichend = Object.keys(q.ausfuehrendeSkripte)
    .filter((rel) => e.ausfuehrendeSkripte[rel] !== q.ausfuehrendeSkripte[rel]);
  assert.deepStrictEqual(e.skriptDrift.geaendertSeitDemQuellAkt.sort(), abweichend.sort());
  assert.ok(abweichend.length > 0,
    'kein gebundenes Skript weicht ab - dann braeuchte es diesen Akt nicht (F6-K16)');
});

test('keine Zahl des Akts stammt aus dem Prueffenster', () => {
  // LR-3 in der Fassung, die hier moeglich ist: der Akt traegt Sollwerte, aber
  // AUSSCHLIESSLICH als Kopie aus dem Quell-Akt. Geprueft wird genau das -
  // ohne eine einzige Zahl zu nennen.
  const q = quelle();
  const e = eintrag();
  assert.strictEqual(JSON.stringify(e.aequivalenzSoll), JSON.stringify(q.aequivalenzSoll));
  // Das Fenster ist das ENTDECKUNGS-Fenster, nie das Prueffenster.
  assert.deepStrictEqual(e.fenster, ['entdeckung']);
  assert.match(e.verboten, /Jeder Blick ins Prueffenster/);
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
  // Die Funktion allein zu pruefen laesst offen, ob sie ueberhaupt gerufen
  // wird - genau das hat die erste Fassung dieser Probe uebersehen. Ein
  // Kopf-Feld beruehrt die Kette nicht: der Stand bleibt gueltig und ist
  // trotzdem zu gross.
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aq2-deckel-'));
  test.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const reg = bisZumKettenende(JSON.parse(fs.readFileSync(ZIEL, 'utf8')));
  reg.fuellung = 'x'.repeat(K.DECKEL_BYTES - 11000);
  const ziel = path.join(d, 'zu-gross.json');
  fs.writeFileSync(ziel, serialisiere(reg));
  assert.ok(fs.statSync(ziel).size < K.DECKEL_BYTES,
    'die Fixture muss VOR dem Akt noch unter dem Deckel liegen, sonst prueft sie das Falsche');
  assert.throws(() => stillLaufen(['--register', ziel]), /LR-20/);
});

test('in eine GESCHLOSSENE Datei schreibt dieser Akt nicht', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aq2-zu-'));
  test.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const ziel = path.join(d, 'geschlossen.json');
  fs.copyFileSync(GESCHLOSSEN, ziel);
  assert.throws(() => stillLaufen(['--register', ziel]),
    /geschlossen - dieser Akt gehoert in die Fortsetzung/);
});

// ── (2) Die Fixture-Klasse ─────────────────────────────────────────────────

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
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aq2-'));
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
    assert.match(aus, /Sollwerte\s+aus dem Quell-Akt KOPIERT/);
  }
});

test('nach dem eigenen Merge ist das Werkzeug inert (Einweg-Anhaenger)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aq2-inert-'));
  test.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const nachMerge = haengeEintragAn(
    bisZumKettenende(JSON.parse(fs.readFileSync(ZIEL, 'utf8'))), eintrag());
  const ziel = path.join(d, 'nach-merge.json');
  fs.writeFileSync(ziel, serialisiere(nachMerge));
  assert.throws(() => stillLaufen(['--register', ziel]),
    /Eintraege, erwartet 0|runId .* ist bereits belegt/);
});
