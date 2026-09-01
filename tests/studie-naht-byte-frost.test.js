'use strict';

// DER BYTE-FROST DER GESCHLOSSENEN REGISTERDATEI — und der Nachweis, dass die
// Registerpfad-Aufloesung VOR jedem Panelzugriff steht (LR-13/G14, LR-22).
//
// WARUM ES DIESE DATEI GIBT, an einem echten Vorfall gelernt:
//
// Die geschlossene Registerdatei traegt als letzten Eintrag ihren Abschluss-Akt,
// und dessen `verboten` schliesst JEDEN weiteren Eintrag in dieser Datei aus.
// Das ist bisher ein Satz IM Register - kein Waechter misst ihn. Ein Anhang
// bliebe kettengueltig (Nur-Anhaengen ist ja die erlaubte Operation) und ginge
// an jeder Kettenpruefung vorbei. LR-22 verlangt aber ausdruecklich, dass die
// Behauptung "byte-eingefroren" durch eine HASH-ZUSICHERUNG gedeckt ist und
// nicht durch Prosa - "jede Behauptung der Form changed: false ist so viel wert
// wie ihre Messung".
//
// Der Anlass ist nicht theoretisch: waehrend des Baus dieser Naht hat ein
// gewoehnlicher Waechterlauf die Fortsetzungsdatei ueberschrieben, weil das
// Anmelde-Werkzeug kurzzeitig auf das aktive Kettenende zeigte und die Attrappe
// jenes Waechters nur den ALTEN Pfad abschirmt. Der Schaden lag im Arbeitsbaum
// und wurde aus main zurueckgeholt - aber genau dieser Weg fuehrt sonst
// unbemerkt in eine Registerdatei. Ein Byte-Pin faengt ihn beim naechsten Mal
// in der CI statt im Nachhinein.
//
// Usage: node --test tests/studie-naht-byte-frost.test.js

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  REGISTER_RELS, AKTIVES_REGISTER_REL, registerPfadDerRunId,
} = require('../lib/studie-verfassung');

const WURZEL = path.join(__dirname, '..');
const GESCHLOSSEN_REL = REGISTER_RELS[0];
const GESCHLOSSEN = path.join(WURZEL, ...GESCHLOSSEN_REL.split('/'));

// Der Stand, in dem die Datei durch ihren eigenen Abschluss-Akt geschlossen
// wurde. Beide Werte sind am Objekt gemessen, nicht abgeschrieben; sie stehen
// hier als ZWEITE, aeussere Meinung neben dem, was der Akt selbst beurkundet.
const ABSCHLUSS_RUN_ID = 'f6-register-abschluss-rollover-2026-09-01';
const EINGEFROREN_BYTES = 197111;
const EINGEFROREN_SHA256 = 'ccdf9b3cc7824f563859bc93d40e1fffa11344bdcd83ac92b36b0d857a5907d5';
const EINGEFROREN_EVENTS = 31;

test('LR-22: die geschlossene Registerdatei ist byte-eingefroren', () => {
  const bytes = fs.readFileSync(GESCHLOSSEN);
  assert.equal(bytes.length, EINGEFROREN_BYTES,
    `${GESCHLOSSEN_REL} hat sich in der GROESSE bewegt. Diese Datei ist mit ihrem `
    + 'Abschluss-Akt geschlossen: kein weiterer Eintrag, keine Aenderung an einem '
    + 'bisherigen. Waechst sie, hat ein Werkzeug in die falsche Datei geschrieben.');
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), EINGEFROREN_SHA256,
    `${GESCHLOSSEN_REL} hat sich in den BYTES bewegt, ohne zu wachsen — das ist ein `
    + 'Umschreiben, nicht ein Anhang.');
});

test('LR-22: der letzte Eintrag IST der Abschluss-Akt und bleibt der letzte', () => {
  const register = JSON.parse(fs.readFileSync(GESCHLOSSEN, 'utf8'));
  assert.equal(register.events.length, EINGEFROREN_EVENTS);
  const letzter = register.events[register.events.length - 1];
  assert.equal(letzter.runId, ABSCHLUSS_RUN_ID);
  // Die Eigenschaft, nicht die Kennung: der Akt verbietet jeden weiteren
  // Eintrag in DIESER Datei, und dieser Waechter ist die Messung dazu.
  assert.match(letzter.verboten, /Jeder weitere Eintrag in DIESER Datei/);
  assert.equal(letzter.abschluss.eventCountVorher, EINGEFROREN_EVENTS - 1);
});

// ── LR-14: DER EINE AUFLOESER ───────────────────────────────────────────────
//
// Die geordnete Menge lebt an EINER Stelle und wird importiert. Der
// Ketten-Aufloeser dazu ist hier gepinnt, BEVOR sein erster Nutzer ihn
// bekommt: scripts/studie-r1-serverzeit.js ist per SHA in einem
// Register-Eintrag gebunden und darf erst mit dem ueberschreibenden Akt
// (F6-K11) neu gebunden werden. Ein Aufloeser ohne Probe waere bis dahin eine
// Behauptung - und der Eintrag, der ihn dann bindet, bindet etwas Ungeprueftes.

test('LR-14: die Menge ist geordnet, die aktive Datei ist ihr letztes Glied', () => {
  assert.equal(REGISTER_RELS.length, 2);
  assert.equal(REGISTER_RELS[0], GESCHLOSSEN_REL);
  assert.equal(AKTIVES_REGISTER_REL, REGISTER_RELS[REGISTER_RELS.length - 1]);
  assert.notEqual(AKTIVES_REGISTER_REL, GESCHLOSSEN_REL,
    'die aktive Datei darf nach der Naht nicht mehr die geschlossene sein');
  assert.ok(Object.isFrozen(REGISTER_RELS), 'die Menge muss unveraenderlich sein');
});

test('LR-14: der Ketten-Aufloeser findet die runId in DER Datei, die sie fuehrt', () => {
  const geschlossen = JSON.parse(fs.readFileSync(GESCHLOSSEN, 'utf8'));
  const fortsetzung = { events: [{ runId: 'nur-in-der-fortsetzung' }] };
  const lies = (rel) => (rel === GESCHLOSSEN_REL ? geschlossen : fortsetzung);

  // (i) Ein Eintrag aus der Zeit vor der Naht liegt fuer immer in der
  //     geschlossenen Datei - und dort muss er gefunden werden.
  assert.equal(registerPfadDerRunId(ABSCHLUSS_RUN_ID, lies), GESCHLOSSEN_REL);
  // (ii) Ein Eintrag der Fortsetzung wird in der Fortsetzung gefunden.
  assert.equal(registerPfadDerRunId('nur-in-der-fortsetzung', lies), AKTIVES_REGISTER_REL);
  // (iii) Was in keiner steht, ist NICHT gefunden - nie ein leeres Verdikt.
  assert.equal(registerPfadDerRunId('gibt-es-nirgends', lies), null);
  // (iv) Eine fehlende Datei ist ein leeres Glied, kein Absturz: vor der Naht
  //      gab es die Fortsetzung nicht, und ein alter Checkout kennt sie nicht.
  const nurAlte = (rel) => (rel === GESCHLOSSEN_REL ? geschlossen : null);
  assert.equal(registerPfadDerRunId(ABSCHLUSS_RUN_ID, nurAlte), GESCHLOSSEN_REL);
  assert.equal(registerPfadDerRunId('nur-in-der-fortsetzung', nurAlte), null);
});

// ── LR-13 / G14: die Registerpfad-Aufloesung steht VOR dem Panelzugriff ──────
//
// Der Befund des Gerichts: liegt der autorisierende Akt in der Fortsetzung und
// liest der Laeufer die geschlossene Datei, bricht er ab. Das ist fail-closed
// und formal richtig - toedlich waere nur ein Abbruch NACH der Paneloeffnung,
// die zweite Instanz genau der Klasse, an der der erste Anlauf gestorben ist.
//
// Gemessen statt geaendert: beide Einstiegspunkte loesen den Registerpfad in
// ihrer Freigabe-Phase auf, und die liegt in der Quelle STRIKT VOR dem ersten
// Panel-Handle. Deshalb wird hier kein Byte am Laeufer bewegt (der bindet einen
// SHA im Register) - es wird nachgewiesen, dass die gefaehrliche Reihenfolge
// gar nicht erst existiert. Geprueft wird die REIHENFOLGE IM QUELLTEXT, weil
// ein Lauf zum Beweis ein echtes Panel oeffnen muesste, und genau das ist
// verboten.

const REIHENFOLGE = [
  {
    datei: 'scripts/studie-f6-lauf.py',
    // Phase 0 liest Freigabe UND Register, bevor irgendetwas anderes passiert.
    aufloesung: /register_pfad = register_pfad or os\.path\.join\(wurzel, REGISTER_REL\)/,
    registerLesung: /lies_freigabe_konfirmatorisch\(\s*\n?\s*freigabe_pfad, register_pfad/,
    panelZugriff: /os\.path\.isfile\(panel_pfad\)/,
  },
  {
    datei: 'scripts/studie-zaehlprobe.py',
    aufloesung: /^REGISTER = os\.path\.join\(PROTOKOLL_DIR, "outcome-access-ledger\.json"\)$/m,
    registerLesung: /freigabe = lies_freigabe\(freigabe_pfad, fenster_name\)/,
    panelZugriff: /panel = oeffne_nur_lesend\(panel_pfad, fenster_name\)/,
  },
];

test('LR-13/G14: Registerpfad und Register-Lesung liegen VOR jedem Panelzugriff', () => {
  for (const fall of REIHENFOLGE) {
    const quelle = fs.readFileSync(path.join(WURZEL, ...fall.datei.split('/')), 'utf8');
    const aufloesung = quelle.search(fall.aufloesung);
    const lesung = quelle.search(fall.registerLesung);
    const panel = quelle.search(fall.panelZugriff);
    assert.ok(aufloesung >= 0, `${fall.datei}: die Registerpfad-Aufloesung wurde nicht gefunden`);
    assert.ok(lesung >= 0, `${fall.datei}: die Register-Lesung wurde nicht gefunden`);
    assert.ok(panel >= 0, `${fall.datei}: der Panelzugriff wurde nicht gefunden`);
    assert.ok(lesung < panel,
      `${fall.datei}: die Register-Lesung liegt HINTER dem Panelzugriff. Ein Abbruch wegen `
      + 'der falschen Registerdatei faende dann nach der Paneloeffnung statt - die zweite '
      + 'Instanz der Klasse, an der der erste Anlauf gestorben ist (LR-13/F6-K15).');
  }
});

test('LR-13/G14: der Laeufer nimmt BEIDE Aufrufformen fuer den Registerpfad', () => {
  // F6-K28: jede Waechter-Fixture des konfirmatorischen Pfades traegt beide
  // Aufrufformen. Hier ist die Eigenschaft, dass der Laeufer den Registerpfad
  // ueberhaupt von aussen annimmt - ohne diesen Schalter koennte der zweite
  // Anlauf die Fortsetzung gar nicht erreichen und muesste abbrechen.
  const quelle = fs.readFileSync(path.join(WURZEL, 'scripts', 'studie-f6-lauf.py'), 'utf8');
  assert.match(quelle, /p\.add_argument\("--register"/,
    'ohne --register kann der Laeufer nicht auf die Fortsetzung gerichtet werden');
  assert.match(quelle, /def lauf\(freigabe_pfad, panel_pfad, bericht_pfad[^)]*register_pfad=None/,
    'und die Aufrufform aus dem Prozess heraus nimmt ihn ebenfalls');
});

test('LR-15: der Zaehlwerk-Registerpfad ist ein GESCHICHTSLESER und bleibt es', () => {
  // scripts/studie-f6-zaehlwerk.py liest das Register, um EINEN historischen
  // Eintrag zu finden (den eingefrorenen Wortlaut). Dieser Eintrag liegt fuer
  // immer in der geschlossenen Datei. Ihn auf die Fortsetzung umzuhaengen waere
  // die Erosion, nicht die Vollendung - der Waechter faende dort nichts und
  // ginge aus dem falschen Grund rot.
  const quelle = fs.readFileSync(path.join(WURZEL, 'scripts', 'studie-f6-zaehlwerk.py'), 'utf8');
  const gebunden = /LEDGER_REL = "protocol\/early-detection\/2\.0\.0\/outcome-access-ledger\.json"/;
  assert.match(quelle, gebunden,
    'der Zaehlwerk-Registerpfad zeigt nicht mehr auf die geschlossene Datei');
  const runId = /EINTRAG24_RUNID = "([^"]+)"/.exec(quelle);
  assert.ok(runId, 'die gesuchte runId steht nicht mehr im Zaehlwerk');
  const geschlossen = JSON.parse(fs.readFileSync(GESCHLOSSEN, 'utf8'));
  assert.equal(
    geschlossen.events.filter((e) => e.runId === runId[1]).length, 1,
    'der historische Eintrag liegt nicht (mehr) genau einmal in der geschlossenen Datei — '
    + 'dann waere der Zaehlwerk-Pfad tatsaechlich falsch und nicht nur alt',
  );
});
