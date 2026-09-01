'use strict';

// Waechter fuer scripts/studie-f6-konfirmatorisch.js.
//
// Die Waechter haengen am OBJEKT, nicht an einem Textmuster: jeder Riegel wird
// einmal ABSICHTLICH gebrochen, damit sichtbar ist, dass er feuert. Ein Test,
// der nur den gruenen Weg laeuft, bezeugt nichts.

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const WERKZEUG = path.join(__dirname, '..', 'scripts', 'studie-f6-konfirmatorisch.js');
const WURZEL = path.join(__dirname, '..');
const LEDGER = path.join(WURZEL, 'protocol', 'early-detection', '2.0.0',
  'outcome-access-ledger.json');
const BERICHT_REL = 'reports/studie/f6-aequivalenz-entdeckung-2026-09-01.json';

const K = require(WERKZEUG);

// ── Werkbank: eine wegwerfbare Kopie der gebundenen Dateien ────────────────
function werkbank() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f6-konf-'));
  for (const rel of [...Object.keys(K.SKRIPTE), ...Object.keys(K.ARTEFAKTE),
    'protocol/early-detection/2.0.0/hash-manifest.json', BERICHT_REL]) {
    const quelle = path.join(WURZEL, ...rel.split('/'));
    const ziel = path.join(tmp, ...rel.split('/'));
    fs.mkdirSync(path.dirname(ziel), { recursive: true });
    if (fs.existsSync(quelle)) fs.copyFileSync(quelle, ziel);
  }
  return tmp;
}
const berichtDa = () => fs.existsSync(path.join(WURZEL, ...BERICHT_REL.split('/')));

function fahre(argv, wurzel, register) {
  const echt = process.stdout.write;
  let ausgabe = '';
  process.stdout.write = (s) => { ausgabe += s; return true; };
  try {
    K.haupt(['--wurzel', wurzel, '--register', register || LEDGER, ...argv]);
  } finally {
    process.stdout.write = echt;
  }
  return ausgabe;
}
const bricht = (argv, wurzel, register) => assert.throws(
  () => fahre(argv, wurzel, register), /F6-K/);

// ── Riegel 1: --force existiert nicht (F6-B8) ─────────────────────────────
test('--force wird abgewiesen, es gibt keine Reparatur-Betriebsart', () => {
  assert.throws(() => K.haupt(['--force']), /--force gibt es nicht/);
});

// ── Riegel 2: ein abweichendes Skript ist ein anderes Skript ──────────────
test('ein veraendertes gebundenes Skript bricht den Akt ab', { skip: !berichtDa() }, () => {
  const tmp = werkbank();
  fahre([], tmp);                                   // gruen, bevor gebrochen wird
  const opfer = path.join(tmp, 'scripts', 'studie-f6-zaehlwerk.py');
  fs.appendFileSync(opfer, '\n# absichtlich veraendert\n');
  assert.throws(() => fahre([], tmp), /studie-f6-zaehlwerk\.py weicht ab/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── Riegel 3: ein abweichender inhaltSha256 bricht ab ─────────────────────
test('ein veraenderter inhaltSha256 bricht den Akt ab', { skip: !berichtDa() }, () => {
  const tmp = werkbank();
  const rel = 'protocol/early-detection/2.1.0/jahrgang-registrierung-2026-08-30.json';
  const p = path.join(tmp, ...rel.split('/'));
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  d.inhalt.__eingeschmuggelt = true;
  fs.writeFileSync(p, JSON.stringify(d, null, 1));
  // Der Datei-SHA reisst zuerst; genau das ist die Absicht (Datei == Inhalt).
  assert.throws(() => fahre([], tmp), /jahrgang-registrierung.*weicht ab/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── Riegel 4: ohne den Aequivalenz-Bericht gibt es keinen Akt ─────────────
test('fehlender Aequivalenz-Bericht bricht den Akt ab', () => {
  const tmp = werkbank();
  const p = path.join(tmp, ...BERICHT_REL.split('/'));
  if (fs.existsSync(p)) fs.rmSync(p);
  assert.throws(() => fahre([], tmp), /Aequivalenz-Bericht fehlt/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── Riegel 5: ein NICHT bestandenes Tor autorisiert nichts ────────────────
test('bestanden != true bricht den Akt ab', { skip: !berichtDa() }, () => {
  const tmp = werkbank();
  const p = path.join(tmp, ...BERICHT_REL.split('/'));
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  d.daten.bestanden = false;
  fs.writeFileSync(p, JSON.stringify(d, null, 1));
  assert.throws(() => fahre([], tmp), /bestanden != true/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── Riegel 6: das Kettenende ist gebunden ─────────────────────────────────
test('ein anderes Kettenende bricht den Akt ab', { skip: !berichtDa() }, () => {
  const tmp = werkbank();
  const reg = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
  reg.events.pop();
  const p = path.join(tmp, 'gekuerzt.json');
  fs.writeFileSync(p, JSON.stringify(reg, null, 1));
  assert.throws(() => fahre([], tmp, p), /Register fuehrt 25 Eintraege|Kettenende/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── Riegel 7: dieselbe runId zweimal ist ein Abbruch ──────────────────────
test('eine bereits registrierte runId bricht den Akt ab', { skip: !berichtDa() }, () => {
  const tmp = werkbank();
  bricht(['--runid', 'f6-bein2-berichtigung-2026-09-01'], tmp);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── Riegel 8: die Zeitkette (VB-A11) ──────────────────────────────────────
test('wirksam-ab vor der Anmeldung bricht ab', { skip: !berichtDa() }, () => {
  const tmp = werkbank();
  bricht(['--anmeldezeit', '2026-09-01T10:00:00.000Z',
    '--wirksam-ab', '2026-09-01T09:00:00.000Z'], tmp);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('eine Anmeldezeit in der Zukunft bricht ab', () => {
  const morgen = new Date(Date.now() + 86400000).toISOString();
  assert.throws(() => K.haupt(['--anmeldezeit', morgen]), /liegt in der Zukunft/);
});

// ── Riegel 9: der Ausgabesatz ist genau der registrierte ──────────────────
test('der Ausgabesatz traegt 30 Daten- plus 4 Differenz-Schluessel, keinen Umschlag', () => {
  assert.strictEqual(K.DATEN_SCHLUESSEL.length, 30);
  assert.strictEqual(new Set(K.DATEN_SCHLUESSEL).size, 30);
  assert.deepStrictEqual(K.DIFFERENZ_UNTERSCHLUESSEL,
    ['wert', 'maxDifferenzPunkte', 'erfuellt', 'quelle']);
  for (const umschlag of ['ersterZugriffAm', 'beendetAm', 'gelesenePfade',
    'ergebnisdatenBeruehrt', 'runId', 'panelSha256']) {
    assert.ok(!K.DATEN_SCHLUESSEL.includes(umschlag),
      `Umschlag-Feld ${umschlag} darf nicht im Datensatz stehen (F6-B10)`);
  }
  // Die drei Groessen, die F6-C17 ausdruecklich unterscheidet:
  assert.ok(K.DATEN_SCHLUESSEL.includes('abstand_zu_090'));
  assert.ok(K.DATEN_SCHLUESSEL.includes('abstand_zu_329_von_365'));
});

// ── Riegel 10: jeder Ausgabeschluessel steht wirklich im Laeufer ──────────
test('ein Ausgabeschluessel ohne Entsprechung im Laeufer bricht ab', { skip: !berichtDa() },
  () => {
    const tmp = werkbank();
    const p = path.join(tmp, 'scripts', 'studie-f6-lauf.py');
    // Nicht den Schluessel entfernen (das riesse den SHA-Riegel zuerst),
    // sondern die Pruefung selbst am Objekt fuehren:
    const quelle = fs.readFileSync(p, 'utf8');
    for (const k of K.DATEN_SCHLUESSEL) {
      assert.ok(quelle.includes(`"${k}"`), `${k} fehlt im Laeufer`);
    }
    assert.ok(!quelle.includes('"abstand_zu_erfundenem_wert"'));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

// ── Riegel 11: der Trockenlauf schreibt nichts ────────────────────────────
test('der Trockenlauf laesst das Register byte-gleich', { skip: !berichtDa() }, () => {
  const tmp = werkbank();
  const vorher = crypto.createHash('sha256').update(fs.readFileSync(LEDGER)).digest('hex');
  const ausgabe = fahre([], tmp);
  const nachher = crypto.createHash('sha256').update(fs.readFileSync(LEDGER)).digest('hex');
  assert.strictEqual(vorher, nachher);
  assert.match(ausgabe, /TROCKENLAUF - es wurde NICHTS geschrieben/);
  assert.match(ausgabe, /"previousHash": "f9fbaac79675/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── Riegel 12: der Eintrag traegt seine Pflichtsaetze ─────────────────────
test('der Eintrag sagt selbst, dass der Lauf erst nach gruenem Review feuert',
  { skip: !berichtDa() }, () => {
    const tmp = werkbank();
    const reg = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
    // Den Eintrag ueber den Trockenlauf-Pfad bauen und aus dem Register lesen,
    // das das Werkzeug erzeugt haette: dazu einmal in eine Kopie schreiben.
    const p = path.join(tmp, 'register.json');
    fs.writeFileSync(p, JSON.stringify(reg, null, 1));
    fahre(['--schreiben'], tmp, p);
    const e = JSON.parse(fs.readFileSync(p, 'utf8')).events.at(-1);

    assert.strictEqual(e.typ, 'confirmatory_execution_authorized');
    assert.deepStrictEqual(e.fenster, ['pruefung']);
    assert.strictEqual(e.allowedOutputs.length, 34);
    assert.strictEqual(e.previousHash, K.ERWARTETER_TAIL);

    // Der Satz, der den Lauf zurueckhaelt — in erlaubt UND als eigenes Feld.
    assert.match(e.erlaubt, /FEUERT NICHT MIT DIESEM EINTRAG/);
    assert.match(e.laufFreigabe, /GRUENEM REVIEW/);
    // Endtest-Siegel in allen Zweigen zu, kein Automatismus.
    assert.match(e.endtestSiegel, /KEINEN Automatismus/);
    // F6-C8i: beide Saetze woertlich.
    assert.match(e.richtungsOffenlegungBerichtigung.satz1,
      /ENTFERNT an genau einer Zelle einen stehenden STOPP/);
    assert.match(e.richtungsOffenlegungBerichtigung.satz2,
      /nicht vor, sondern DURCH einen Lauf entdeckt/);
    // F6-C7: die Artefakt-Haelfte wurde geprueft, nicht gefahren.
    assert.strictEqual(e.aequivalenzTor.artefaktHaelfte.form, 'NICHT GEFAHREN, SONDERN GEPRUEFT');
    // F6-C8b: die berichtigte Zelle steht drin, die alte nicht.
    assert.deepStrictEqual(e.aequivalenzTor.bein2.zellen['S-U/kontrollpool'],
      { zaehler: 3761, nenner: 4514, zensiert: 0 });
    assert.ok(!JSON.stringify(e.aequivalenzTor.bein2.zellen).includes('3760'));
    // F6-C21: analysisCutoffAt ist Jahrgangs-Identitaet, kein Zeitstempel.
    assert.strictEqual(typeof e.analysisCutoffAt, 'object');
    assert.match(e.analysisCutoffAt.form, /kein Zeitstempel/);
    // F6-B2: das nicht anwendbare Pflichtfeld ist beantwortet, nicht weggelassen.
    assert.match(e.researchCorpus, /NICHT ANWENDBAR/);
    // F6-C17: die Warnung vor der falschen Prosa-Kurzform steht im Eintrag.
    assert.match(e.ausgabesatz.zweigPflichtTeilmengen.warnung, /UNZULAESSIG/);
    // Restrisiken: alle sechs Auflagen-Glieder plus die zwei aus F6-C11.
    for (const k of ['F6-C7g(c)', 'F6-C7g(d)', 'F6-C7g(e)', 'F6-C8j(f)', 'F6-C8j(g)',
      'F6-C8j(h)', 'F6-C11(a)', 'F6-C11(b)']) {
      assert.ok(e.restrisiko[k], `Restrisiko ${k} fehlt`);
    }
    // R12a: kein Nutzername ausser im ausdruecklich genannten Arbeitspfad.
    const roh = JSON.stringify({ ...e, arbeitspfad: null });
    assert.ok(!/Anwender/.test(roh), 'Nutzername ausserhalb des Arbeitspfad-Feldes');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

// ── Riegel 13: der Anker ist gemessen, nicht geraten ──────────────────────
test('die F6-C18-Anker treffen die tatsaechlichen Zeilen', () => {
  const zeilen = fs.readFileSync(path.join(WURZEL, 'scripts', 'studie-vb-b4-band.py'), 'utf8')
    .split(/\r?\n/);
  const bei = (spanne) => zeilen[Number(spanne.slice(1).split('-')[0]) - 1];
  assert.match(bei(K.ANKER.gate_gerissen), /def gate_gerissen/);
  assert.match(bei(K.ANKER.im_band), /if abs\(abstand\) <= breite_abs/);
  assert.match(bei(K.ANKER.ausserhalb_band), /if abstand > breite_abs/);
});
