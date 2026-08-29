'use strict';

// E3 — Praeregistrierung 2.0.0: W1 (Freeze-Siegel), W5 (Endpunkt-Sperre),
// W6 (Minima-Ampel und R3-Zaehlung) plus der Regelwerk-Nachzug.
//
// ARBEITSTEILUNG MIT tests/studie-zaehlprobe.test.js: die Fixture-Laeufe der Probe
// (199/200-Firmen-Fall, Doppel-Ereignis-Firma, 0.777-Marker, Siegel-Wache) laufen im
// Selbsttest des Python-Skripts und werden dort EINMAL ausgewertet. Hier stehen die
// Pruefungen, die ohne diesen Lauf auskommen — sonst kostete jede Testrunde den
// teuren Fixture-Bau zweimal.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  VerfassungsBruch,
  pruefeEndpunktKlasse,
  endpunktSperren,
  starteLauf,
  ladeRegelwerk,
  ART_ZAEHLPROBE,
} = require('../lib/studie-verfassung');

const REPO = path.join(__dirname, '..');
const P = (...teile) => path.join(REPO, ...teile);
const PRAEREG_REL = 'protocol/early-detection/2.0.0/preregistration.json';
const MANIFEST_REL = 'protocol/early-detection/2.0.0/hash-manifest.json';

const lies = (rel) => JSON.parse(fs.readFileSync(P(...rel.split('/')), 'utf8'));
const praereg = lies(PRAEREG_REL);
const manifest = lies(MANIFEST_REL);
const regelwerk = ladeRegelwerk();
const friedhof = lies('protocol/early-detection/2.0.0/friedhof.json');

function sha256Datei(rel) {
  return crypto.createHash('sha256').update(fs.readFileSync(P(...rel.split('/')))).digest('hex');
}

// Ruft eine Funktion der Zaehlprobe direkt auf. Der Umweg ueber python -c ist Absicht:
// geprueft wird der Code, der wirklich laeuft, nicht ein JS-Nachbau davon.
function python(code) {
  const datei = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'e3-')), 'probe.py');
  fs.writeFileSync(datei, `import importlib.util,sys,json\nspec=importlib.util.spec_from_file_location("z", r"${P('scripts', 'studie-zaehlprobe.py')}")\nz=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(z)\n${code}\n`, 'utf8');
  return spawnSync(process.env.PYTHON || 'python', [datei], { encoding: 'utf8', cwd: REPO });
}

// ── W1: Freeze-Siegel ────────────────────────────────────────────────────────

test('W1: das Manifest bindet genau die drei Dateien, an denen die Frage haengt', () => {
  assert.deepEqual(Object.keys(manifest.files).sort(), [
    PRAEREG_REL,
    'scripts/studie-basisraten.py',
    'scripts/studie-zaehlprobe.py',
  ]);
});

test('W1: jede gebundene Datei traegt heute noch ihre gesiegelten Bytes', () => {
  for (const [rel, soll] of Object.entries(manifest.files)) {
    assert.equal(sha256Datei(rel), soll, `${rel} weicht vom Siegel ab`);
  }
});

test('W1: ein einziges veraendertes Byte macht die Pruefung rot', () => {
  const roh = fs.readFileSync(P(...PRAEREG_REL.split('/')));
  const gekippt = Buffer.from(roh);
  gekippt[gekippt.length - 2] ^= 0x01;
  const neu = crypto.createHash('sha256').update(gekippt).digest('hex');
  assert.notEqual(neu, manifest.files[PRAEREG_REL], 'ein gekipptes Byte muss den Hash aendern');
});

test('W1: der Pruefer im Skript faellt bei falschem Hash wirklich um', () => {
  const verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-w1-'));
  const kaputt = path.join(verzeichnis, 'hash-manifest.json');
  const kopie = JSON.parse(JSON.stringify(manifest));
  kopie.files[PRAEREG_REL] = 'f'.repeat(64);
  fs.writeFileSync(kaputt, JSON.stringify(kopie), 'utf8');
  const lauf = python(`
try:
    z.pruefe_manifest(r"${kaputt.replace(/\\/g, '\\\\')}")
    print("DURCHGELASSEN")
except z.ProbeFehler as f:
    print("ABBRUCH", f)
`);
  assert.match(lauf.stdout, /^ABBRUCH W1-ABBRUCH/m, `Ausgabe: ${lauf.stdout}${lauf.stderr}`);
  // Gegenrichtung: das echte Manifest MUSS durchgehen, sonst waere der Waechter
  // bei bestimmungsgemaesser Benutzung rot und damit wertlos.
  const gut = python('z.pruefe_manifest()\nprint("DURCH")');
  assert.match(gut.stdout, /DURCH/, `Ausgabe: ${gut.stdout}${gut.stderr}`);
});

// ── W5: Endpunkt-Sperre, BEIDE Richtungen ────────────────────────────────────

test('W5: der verbrauchte Kurs-Endpunkt fliegt — auch fuer einen angemeldeten Lauf', () => {
  const register = lies('protocol/early-detection/2.0.0/outcome-access-ledger.json');
  const angemeldet = {
    ...register,
    events: [...register.events, {
      runId: 'w5-test', typ: 'confirmatory_execution_authorized',
      registeredAt: '2026-12-01T10:00:00.000Z', accessedAt: '2026-12-01T10:05:00.000Z',
    }],
  };
  const lauf = starteLauf({ laufId: 'w5-test', modus: 'entdeckung', register: angemeldet });
  for (const endpunkt of ['kursrendite_12m', 'preis_ausbruch', 'total_return', 'breakout_252', 'price_close']) {
    assert.throws(() => lauf.leseErgebnisdaten(endpunkt), (fehler) => (
      fehler instanceof VerfassungsBruch && /gesperrte Klasse/.test(fehler.message)
    ), `${endpunkt} haette fliegen muessen`);
  }
});

test('W5: der ERLAUBTE Endpunkt geht unter angemeldeter runId durch', () => {
  const register = lies('protocol/early-detection/2.0.0/outcome-access-ledger.json');
  const angemeldet = {
    ...register,
    events: [...register.events, {
      runId: 'w5-ok', typ: 'confirmatory_execution_authorized',
      registeredAt: '2026-12-01T10:00:00.000Z', accessedAt: '2026-12-01T10:05:00.000Z',
    }],
  };
  const lauf = starteLauf({ laufId: 'w5-ok', modus: 'entdeckung', register: angemeldet });
  assert.equal(lauf.leseErgebnisdaten('folgequartal_umsatz_wachstum'), true);
  assert.equal(lauf.protokoll().ergebnisdatenBeruehrt, true);
  assert.deepEqual(lauf.protokoll().geleseneEndpunkte, ['folgequartal_umsatz_wachstum']);
});

test('W5: eine GELEERTE Sperrliste laesst den Kurs-Endpunkt nicht durch, sondern bricht ab', () => {
  const klon = JSON.parse(JSON.stringify(regelwerk));
  klon.regeln.find((r) => r.id === 'R4').endpunktSperren = [];
  assert.throws(() => pruefeEndpunktKlasse('kursrendite_12m', klon), (fehler) => (
    fehler instanceof VerfassungsBruch && /keine endpunktSperren/.test(fehler.message)
  ));
});

test('W5: die Registry fuehrt die Sperre dauerhaft — sie ueberlebt die Praeregistrierung', () => {
  const sperren = endpunktSperren(regelwerk);
  assert.equal(sperren.length, 1);
  assert.deepEqual(sperren[0].verboteneKlassen, praereg.endpunktSperre.verboteneKlassen);
  assert.equal(sperren[0].endpunktKlasse, praereg.endpunktSperre.endpunktKlasse);
  assert.equal(sperren[0].verbrauchtAm, praereg.endpunktSperre.verbrauchtAm);
});

// ── W6: Minima-Ampel und R3-Zaehlung ─────────────────────────────────────────

test('W6: die Schwelle liegt zwischen 199 und 200 — im Code, nicht nur im Text', () => {
  const lauf = python(`
print(z.FALLZAHL_MIN)
print(z.ampel_fuer(199, 1.0, 1.0))
print(z.ampel_fuer(200, 1.0, 1.0))
print(z.ampel_fuer(200, 0.89, 1.0))
print(z.ampel_fuer(200, 1.0, 0.89))
print(z.ampel_fuer(200, 1.0, 0.88))
print(z.ampel_fuer(200, None, 1.0))
`);
  assert.equal(lauf.status, 0, `${lauf.stdout}${lauf.stderr}`);
  const zeilen = lauf.stdout.trim().split(/\r?\n/);
  assert.deepEqual(zeilen, [
    '200',
    'INCONCLUSIVE_DATA', // 199 Firmen
    'GRUEN', //            200 Firmen
    'INCONCLUSIVE_DATA', // Auffindbarkeit Signal-Arm unter 90 %
    'INCONCLUSIVE_DATA', // Auffindbarkeit Kontrollpool unter 90 %
    'INCONCLUSIVE_DATA', // Differenz ueber 10 Punkte
    'INCONCLUSIVE_DATA', // NICHT BERECHENBAR ist nie gruen (R5)
  ]);
});

test('W6: die Schwelle im Code ist dieselbe wie in der Praeregistrierung', () => {
  assert.equal(praereg.primarySuccessCriteria.minimumReifeErstEreignisFirmenJeVarianteJeFenster, 200);
  assert.equal(praereg.outcomes.auffindbarkeit.gate.minimum, 0.9);
  assert.equal(praereg.outcomes.auffindbarkeit.gate.maxDifferenzPunkte, 10);
  const lauf = python('print(z.PERZENTIL, z.AUFFINDBARKEIT_MIN, z.AUFFINDBARKEIT_MAX_DIFFERENZ)');
  assert.equal(lauf.stdout.trim(), `${praereg.signalFamily.gemeinsameMechanik.perzentil} 0.9 0.1`,
    `${lauf.stdout}${lauf.stderr}`);
});

test('W6: der R3-Waechter feuert, wenn eine Firma zweimal gezaehlt wird', () => {
  // Die SACHE: `fallzahl` ist eine FIRMEN-Zahl. Hier wird `erst_ereignisse` durch eine
  // Fassung ersetzt, die nicht dedupliziert — genau die Sabotage aus dem Entscheid.
  const lauf = python(`
class E2:
    @staticmethod
    def erst_ereignisse(eintraege, gewaehlt):
        return list(eintraege), []
    @staticmethod
    def ordinal(t):
        return 700000
e = [{"cik": "1", "accepted": "2018-01-01 12:00:00.0", "ddate": "20171231", "basis": ("Revenues", "USD")},
     {"cik": "1", "accepted": "2018-06-01 12:00:00.0", "ddate": "20180331", "basis": ("Revenues", "USD")}]
try:
    z.arm_zaehlen(e, {}, E2, 999999)
    print("DURCHGELASSEN")
except z.ProbeFehler as f:
    print("ABBRUCH", str(f)[:40])
`);
  assert.match(lauf.stdout, /^ABBRUCH R3-ABBRUCH/m, `${lauf.stdout}${lauf.stderr}`);
});

// ── Regelwerk-Nachzug ────────────────────────────────────────────────────────

test('R1: das offene Serverzeit-Feld ist geschlossen, nicht weggelassen', () => {
  const r1 = regelwerk.regeln.find((r) => r.id === 'R1');
  assert.equal(r1.waechter.offen, undefined, 'R1 fuehrt noch ein offenes Feld');
  assert.ok(String(r1.waechter.serverzeitVergleich).length > 100);
  assert.ok(r1.waechter.funktionen.includes('pruefeServerzeit'));
  assert.ok(fs.existsSync(P('scripts', 'studie-r1-serverzeit.js')));
});

test('R9 und R15 sind keine blossen Vorlagen mehr, und ihr Artefakt existiert', () => {
  for (const id of ['R9', 'R15']) {
    const regel = regelwerk.regeln.find((r) => r.id === id);
    assert.equal(regel.waechter.art, 'skript', `${id} ist noch Vorlage`);
    assert.match(String(regel.waechter.artefakt), /studie-zaehlprobe\.py/, `${id} ohne Artefakt-Verweis`);
    assert.ok(regel.waechter.test, `${id} ohne Test`);
  }
  assert.ok(fs.existsSync(P('scripts', 'studie-zaehlprobe.py')));
});

test('Die eingefrorene Frage traegt die Form des Elternprotokolls', () => {
  for (const feld of ['identity', 'researchQuestion', 'outcomes', 'splits', 'primarySuccessCriteria']) {
    assert.ok(praereg[feld], `Pflichtabschnitt ${feld} fehlt`);
  }
  assert.equal(praereg.identity.parentProtocol, 'FEM-SEC-US@1.2.0');
  assert.ok(praereg.abweichungenVomElternprotokoll.length >= 4);
  for (const a of praereg.abweichungenVomElternprotokoll) {
    assert.ok(a.grund && a.grund.length > 20, `Abweichung ohne Grund: ${a.feld}`);
  }
});

test('Acht Tests, zwei Varianten, vier Baselines — die Zahl ist keine Behauptung', () => {
  const konfirmatorisch = praereg.signalFamily.varianten.filter((v) => v.status === 'konfirmatorisch');
  assert.equal(konfirmatorisch.length, 2);
  assert.equal(praereg.tests.baselines.length, 4);
  assert.equal(praereg.tests.anzahlGeplanterTests, konfirmatorisch.length * praereg.tests.baselines.length);
  assert.deepEqual(praereg.tests.baselines.map((b) => b.id), ['a', 'b', 'c', 'd']);
});

test('Jede Abweichung Code gegen Entscheid-Dokument sagt, wer recht hatte', () => {
  assert.ok(praereg.abweichungenCodeGegenDokument.length >= 4);
  for (const a of praereg.abweichungenCodeGegenDokument) {
    for (const feld of ['stelle', 'entscheidDokument', 'code', 'gilt', 'wirkung']) {
      assert.ok(a[feld], `Abweichung '${a.stelle}' ohne Feld ${feld}`);
    }
  }
});

test('Der Friedhof fuehrt S-UG mit Grund und Zahlen, nicht nur mit Etikett', () => {
  const sug = friedhof.eintraege.find((e) => e.id === 'S-UG');
  assert.ok(sug, 'S-UG fehlt im Friedhof');
  assert.equal(sug.zahlen.fallzahl, 29);
  assert.equal(sug.zahlen.fallzahlGefordert, 300);
  assert.match(sug.stand, /GESCHEITERT/);
  assert.ok(sug.beschreibenderBefundBleibt.length > 50);
  for (const eintrag of friedhof.eintraege) {
    assert.ok(eintrag.grund && eintrag.grund.length > 20, `${eintrag.id}: Friedhof-Eintrag ohne Grund`);
    assert.match(String(eintrag.entschiedenAm), /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('Die Ausgabe-Allowlist der Zaehlprobe ist genau die elf Zaehlfelder', () => {
  assert.deepEqual(praereg.zaehlprobe.ausgabeAllowlist, [
    'feuerungen', 'auswertbare_firmen_quartale', 'feuerrate', 'firmen_mit_erst_ereignis',
    'zensierte_erst_ereignisse', 'fallzahl', 'auffindbarkeit', 'fallzahl_mit_aktienzahl_nenner',
    'kontrollpool_firmen', 'kontrollpool_auffindbarkeit', 'ampel',
  ]);
  assert.deepEqual(praereg.zaehlprobe.ampelWerte, ['GRUEN', 'INCONCLUSIVE_DATA']);
});

test('Die Sperrzone des Endtest-Fensters steht in der Praeregistrierung, nicht nur im Chat', () => {
  const sperre = praereg.zaehlprobe.sperrzoneEndtest;
  assert.match(sperre.wortlaut, /nicht oeffnen, keinen Oeffner bauen/);
  assert.match(sperre.folge, /keinen Entschluesselungs-Aufruf/);
  const quelle = fs.readFileSync(P('scripts', 'studie-zaehlprobe.py'), 'utf8').toLowerCase();
  for (const wort of ['de' + 'crypt', 'ci' + 'pher', 'un' + 'seal']) {
    assert.ok(!quelle.includes(wort), `Die Zaehlprobe enthaelt '${wort}' — das waere ein Oeffner`);
  }
});

test('Die Zaehlproben-Eintragsart schaltet KEINE Ergebnisdaten frei', () => {
  const register = lies('protocol/early-detection/2.0.0/outcome-access-ledger.json');
  const mitZaehlprobe = {
    ...register,
    events: [...register.events, {
      runId: 'zaehlprobe-test', typ: ART_ZAEHLPROBE,
      registeredAt: '2026-12-01T10:00:00.000Z', accessedAt: '2026-12-01T10:05:00.000Z',
    }],
  };
  const lauf = starteLauf({ laufId: 'zaehlprobe-test', modus: 'validierung', register: mitZaehlprobe });
  assert.throws(() => lauf.leseErgebnisdaten('folgequartal_umsatz_wachstum'), (fehler) => (
    fehler instanceof VerfassungsBruch && /ohne im Zugriffs-Register angemeldet/.test(fehler.message)
  ), 'Eine Zaehlproben-Anmeldung darf keine Ergebnisdaten freischalten');
});
