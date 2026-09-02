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
  // (v) MEHRDEUTIG ist ein Abbruch, kein Ersttreffer. Ein Beweis gegen die
  //     zufaellig erste Datei waere ein sauberes Verdikt aus dem falschen
  //     Grund - die Fehlklasse, gegen die diese ganze Kette gebaut ist.
  const doppelt = () => ({ events: [{ runId: 'zweimal-da' }] });
  assert.throws(() => registerPfadDerRunId('zweimal-da', doppelt),
    /steht in MEHREREN Registerdateien/);
});

test('LR-14: eine kaputte MESSUNG faellt durch, sie wird nie zu "nicht gefunden"', () => {
  // Der stille Fehlschlag, den es hier zu verhindern gilt: eine unlesbare
  // Registerdatei als "die runId steht eben nicht drin" zu verbuchen. Dann
  // liefe der Aufloeser auf die andere Datei und der Beweis ginge gegen die
  // falsche - gruen aus dem falschen Grund.
  const kaputt = () => { const f = new Error('EACCES'); f.code = 'EACCES'; throw f; };
  assert.throws(() => registerPfadDerRunId('egal', kaputt), /EACCES/);
});

// ── LR-14 am WERKZEUG, nicht nur an der Bibliothek ──────────────────────────
//
// Die beiden Fehlklassen, die hier toedlich waeren und die keine Probe der
// Bibliothek erreicht, weil sie im Werkzeug selbst leben.

test('LR-14: bestaetigen loest auf die Datei auf, die den Eintrag fuehrt', () => {
  const W = require('../scripts/studie-r1-serverzeit.js');
  const echt = fs.readFileSync;
  const RUN_ID = 'nur-in-der-fortsetzung-probe';
  const fortsetzung = JSON.stringify({ events: [{ runId: RUN_ID }] });
  try {
    fs.readFileSync = (p, ...rest) => {
      if (typeof p === 'string' && p.endsWith('outcome-access-ledger-teil2.json')) {
        return fortsetzung;
      }
      return echt(p, ...rest);
    };
    // Ein Eintrag der Fortsetzung wird IN der Fortsetzung aufgeloest - ein
    // Rueckfall auf den festen alten Pfad faende ihn nicht und der Beweis
    // liefe gegen die falsche Datei.
    assert.strictEqual(W.registerDerRunId(RUN_ID).rel, AKTIVES_REGISTER_REL);
    // Und ein Eintrag der geschlossenen Datei bleibt bei ihr.
    assert.strictEqual(W.registerDerRunId(ABSCHLUSS_RUN_ID).rel, GESCHLOSSEN_REL);
    // Was nirgends steht, bekommt keinen Beweis - nie ein leeres Verdikt.
    assert.throws(() => W.registerDerRunId('gibt-es-nirgends'),
      /steht in keiner der Registerdateien/);
  } finally {
    fs.readFileSync = echt;
  }
  // Die VERDRAHTUNG wird nicht mehr hier gepinnt: Textmuster bezeugen, dass
  // eine Zeile dasteht, nicht dass sie laeuft - der Review zu #238 hat an
  // genau diesen vier Mustern vorbei echte Regressionen durchgelassen. Die
  // Verdrahtung ist jetzt VERHALTENSGEPRUEFT in
  // tests/studie-naht-beweisebene.test.js: welche URL abgesetzt, welche Datei
  // gelesen, was in die Freigabe geschrieben wurde.
});

test('LR-14: eine unlesbare Registerdatei ist ein ABBRUCH, kein leeres Glied', () => {
  // Der klassische stille Fehlschlag: jeden Lesefehler als "steht eben nicht
  // drin" zu verbuchen. Der Aufloeser liefe dann auf die andere Datei und der
  // Beweis ginge gegen den falschen Eintrag gruen durch. NUR ein fehlender
  // Pfad ist ein leeres Glied - alles andere ist eine kaputte Messung.
  const W = require('../scripts/studie-r1-serverzeit.js');
  const echt = fs.readFileSync;
  try {
    fs.readFileSync = (p, ...rest) => {
      if (typeof p === 'string' && p.endsWith('outcome-access-ledger-teil2.json')) {
        const fehler = new Error('EACCES: permission denied');
        fehler.code = 'EACCES';
        throw fehler;
      }
      return echt(p, ...rest);
    };
    assert.throws(() => W.liesWennDa(AKTIVES_REGISTER_REL), /EACCES/);
    assert.throws(() => W.registerDerRunId(ABSCHLUSS_RUN_ID), /EACCES/,
      'ein Lesefehler darf nicht zu einem Treffer in der anderen Datei fuehren');
  } finally {
    fs.readFileSync = echt;
  }
  // Gegenrichtung: ein FEHLENDER Pfad ist wirklich ein leeres Glied.
  const echt2 = fs.readFileSync;
  try {
    fs.readFileSync = (p, ...rest) => {
      if (typeof p === 'string' && p.endsWith('outcome-access-ledger-teil2.json')) {
        const fehler = new Error('ENOENT: no such file');
        fehler.code = 'ENOENT';
        throw fehler;
      }
      return echt2(p, ...rest);
    };
    assert.strictEqual(W.liesWennDa(AKTIVES_REGISTER_REL), null);
    assert.strictEqual(W.registerDerRunId(ABSCHLUSS_RUN_ID).rel, GESCHLOSSEN_REL);
  } finally {
    fs.readFileSync = echt2;
  }
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

test('OFFEN: die Zaehlprobe kann die Fortsetzung NICHT erreichen — gemessen, nicht behauptet', () => {
  // Diese Probe beurkundet eine LUECKE, damit sie nicht in Vergessenheit
  // geraet. scripts/studie-zaehlprobe.py verdrahtet die geschlossene
  // Registerdatei und kennt keinen Schalter dagegen. Der autorisierende
  // count-only-Akt liegt ab jetzt in der Fortsetzung - die Zaehlprobe faende
  // ihn also nicht und braeche ab (vor der Paneloeffnung, also fail-closed,
  // aber unter dem EIN-MAL-Deckel trotzdem das Ende).
  //
  // Warum die Luecke hier steht statt geschlossen zu sein: die Datei ist in
  // protocol/early-detection/2.0.0/hash-manifest.json GESIEGELT. Jede
  // Byte-Aenderung macht ihren eigenen Selbsttest rot, und das Nachsiegeln ist
  // ein Siegel-Akt, den dieser Bau nicht selbst setzt.
  const quelle = fs.readFileSync(path.join(WURZEL, 'scripts', 'studie-zaehlprobe.py'), 'utf8');
  assert.doesNotMatch(quelle, /p\.add_argument\("--register"/,
    'die Zaehlprobe hat jetzt einen --register-Schalter - dann ist diese Luecke '
    + 'geschlossen und DIESE Probe gehoert ersatzlos entfernt, nicht umgedreht');
  const manifest = JSON.parse(fs.readFileSync(
    path.join(WURZEL, 'protocol', 'early-detection', '2.0.0', 'hash-manifest.json'), 'utf8'));
  const dateien = manifest.files || manifest;
  assert.ok(Object.keys(dateien).includes('scripts/studie-zaehlprobe.py'),
    'die Zaehlprobe steht nicht mehr im Siegel - dann ist die Begruendung dieser '
    + 'Luecke hinfaellig und der Schalter waere ohne Siegel-Akt nachrüstbar');
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
