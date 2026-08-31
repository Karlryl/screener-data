'use strict';

// R1 — Erst festschreiben, dann messen.
//
// Die SACHE: das Zugriffs-Register ist eine KETTE mit Vorab-Anmeldung, kein Logbuch.
// Wer einen Eintrag nachtraeglich aendert, einen Eintrag herausschneidet, einen Eintrag
// einschiebt, einen rueckdatierten Eintrag anhaengt oder erst nach dem Zugriff anmeldet,
// muss auffliegen.
//
// Geprueft wird am ECHTEN, ausgelieferten Register — nicht an synthetischen Beispielen.
// Der Vorgaenger nagelte den E0-Auslieferungszustand "leer" fest und wurde deshalb beim
// ersten bestimmungsgemaessen Gebrauch rot; ein Waechter, der bei richtiger Benutzung
// rot wird, entwertet sich selbst. Geprueft wird jetzt beides: die reale Kette muss
// DURCHGEHEN, und jede der sieben Manipulationen muss rot werden.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  pruefeZugriffsRegister,
  haengeEintragAn,
  VerfassungsBruch,
  ARTEN_MIT_ZUGRIFFSZEIT,
} = require('../lib/studie-verfassung');

const WURZEL = path.join(__dirname, '..');
const LEDGER_REL = 'protocol/early-detection/2.0.0/outcome-access-ledger.json';
const LEDGER = path.join(WURZEL, ...LEDGER_REL.split('/'));
const VORGAENGER = path.join(WURZEL, 'protocol', 'early-detection', '1.2.0', 'outcome-access-ledger.json');

const echtesRegister = () => JSON.parse(fs.readFileSync(LEDGER, 'utf8'));

function vorabEintrag(runId, registeredAt) {
  return { runId, typ: 'R15b_NUR_ZAEHLEN', registeredAt, accessedAt: null };
}

function zugriffsEintrag(runId, versatzMinuten = 5, anmeldung = '2026-12-05T10:00:00.000Z') {
  const angemeldet = new Date(anmeldung);
  return {
    type: 'confirmatory_execution_authorized',
    runId,
    registeredAt: angemeldet.toISOString(),
    accessedAt: new Date(angemeldet.getTime() + versatzMinuten * 60000).toISOString(),
    inputSha256: 'f'.repeat(64),
  };
}

// ── DURCHGEHEN ────────────────────────────────────────────────────────────────

test('R1: das ECHTE Register ist eine gueltige Kette', () => {
  const register = echtesRegister();
  const ergebnis = pruefeZugriffsRegister(register);
  assert.equal(ergebnis.eventCount, register.events.length);
  assert.ok(register.events.length > 0, 'ein Register ohne Eintraege belegt nichts — R1 laeuft seit E1b');
  assert.equal(ergebnis.tailHash, register.events[register.events.length - 1].eventHash);
});

test('R1: der Genesis-Hash ist an seine tatsaechliche Herkunft gebunden', () => {
  // Nicht nur "64 Hex-Zeichen": der Wert MUSS der sha256 der committeten
  // 1.2.0-Vorgaengerdatei sein, sonst haengt die Kette an einer Behauptung.
  const register = echtesRegister();
  const erwartet = crypto.createHash('sha256').update(fs.readFileSync(VORGAENGER)).digest('hex');
  assert.equal(
    register.genesisSha256,
    erwartet,
    'Genesis muss der sha256 von protocol/early-detection/1.2.0/outcome-access-ledger.json sein',
  );
});

test('R1: eine gueltige Kette aus zwei angehaengten Eintraegen geht durch', () => {
  let register = echtesRegister();
  const vorher = register.events.length;
  register = haengeEintragAn(register, vorabEintrag('lauf-1', '2026-12-01T10:00:00.000Z'));
  register = haengeEintragAn(register, zugriffsEintrag('lauf-2'));
  const ergebnis = pruefeZugriffsRegister(register);
  assert.equal(ergebnis.eventCount, vorher + 2);
  assert.equal(register.events[vorher + 1].previousHash, register.events[vorher].eventHash);
});

test('R1: Vorab-Anmeldung ohne Zugriffszeit ist gueltig, nicht unvollstaendig', () => {
  // Die alte Pauschalregel "accessedAt ist Pflicht" war fuer ein Vorab-Register
  // logisch unerfuellbar: nach dem Hashen liesse sich accessedAt nie nachtragen,
  // ohne die Kette zu brechen.
  let register = echtesRegister();
  register = haengeEintragAn(register, vorabEintrag('nur-anmeldung', '2026-12-02T10:00:00.000Z'));
  assert.doesNotThrow(() => pruefeZugriffsRegister(register));
});

// ── AUFFLIEGEN: sieben Proben, jede am ECHTEN Register ────────────────────────

test('Probe 1: geaenderter Eintragswert fliegt auf', () => {
  const register = echtesRegister();
  const treffer = register.events.find((e) => e.registrierterParameter);
  assert.ok(treffer, 'erwartet den Eintrag mit registrierterParameter');
  treffer.registrierterParameter.wert = 1;
  assert.throws(() => pruefeZugriffsRegister(register), /nachtraeglich veraendert/);
});

test('Probe 2: entfernter Eintrag bricht die Kette', () => {
  const register = echtesRegister();
  assert.ok(register.events.length >= 2, 'braucht mindestens zwei Eintraege');
  register.events.splice(0, 1);
  assert.throws(() => pruefeZugriffsRegister(register), VerfassungsBruch);
});

test('Probe 3: zwischen Genesis und Eintrag 1 eingeschobener Eintrag fliegt auf', () => {
  const register = echtesRegister();
  register.events.unshift({
    ...vorabEintrag('eingeschoben', '2026-08-16T17:00:00.000Z'),
    previousHash: register.genesisSha256,
    eventHash: '0'.repeat(64),
  });
  assert.throws(() => pruefeZugriffsRegister(register), VerfassungsBruch);
});

test('Probe 4: ans Ende gehaengter, RUECKDATIERTER Eintrag fliegt auf', () => {
  // Diese Manipulation ueberlebt eine reine Kettenpruefung — nur Monotonie faengt sie.
  let register = echtesRegister();
  register = haengeEintragAn(register, vorabEintrag('rueckdatiert', '2020-01-01T00:00:00.000Z'));
  assert.throws(() => pruefeZugriffsRegister(register), /rueckdatiert/);
});

test('Probe 5: confirmatory mit registeredAt >= accessedAt ist ein Alibi', () => {
  let register = echtesRegister();
  register = haengeEintragAn(register, zugriffsEintrag('alibi', -5));
  assert.throws(() => pruefeZugriffsRegister(register), /nicht VOR dem Zugriff/);
});

test('Probe 6: Vorab-Anmeldung MIT gesetzter Zugriffszeit fliegt auf', () => {
  let register = echtesRegister();
  register = haengeEintragAn(register, {
    runId: 'anmeldung-mit-zugriff',
    typ: 'R15b_NUR_ZAEHLEN',
    registeredAt: '2026-12-03T10:00:00.000Z',
    accessedAt: '2026-12-03T10:05:00.000Z',
  });
  assert.throws(() => pruefeZugriffsRegister(register), /traegt aber schon eine Zugriffszeit/);
});

test('Probe 7: Register ohne Genesis-Hash ist nicht verkettbar', () => {
  const register = echtesRegister();
  delete register.genesisSha256;
  assert.throws(() => pruefeZugriffsRegister(register), VerfassungsBruch);
});

test('Probe 8: unbekannte Eintragsart wird abgewiesen, nicht durchgewunken', () => {
  let register = echtesRegister();
  register = haengeEintragAn(register, {
    runId: 'unbekannt', typ: 'IRGENDWAS_NEUES',
    registeredAt: '2026-12-04T10:00:00.000Z', accessedAt: null,
  });
  assert.throws(() => pruefeZugriffsRegister(register), /unbekannte Art/);
});

// ── EXTERNER ANKER: Git-Praefix ───────────────────────────────────────────────

test('R1: jede committete Revision ist byte-identisches Praefix der aktuellen', () => {
  // Die einzige Manipulation, die eine reine Kettenpruefung uebersteht, ist der
  // komplett neu gehashte Schwanz: Eintrag aendern und ALLE Folgeeintraege neu
  // rechnen. Dagegen hilft nur ein Anker ausserhalb der Datei — die Git-Historie.
  // Ehrliche Grenze: einen History-Rewrite auf dem Server faengt nur der
  // geschuetzte Branch, nicht dieser Test.
  const git = (...args) => execFileSync('git', args, { cwd: WURZEL, encoding: 'utf8' });

  // Unvollstaendige Historie ist ein ROTER Befund, kein stiller Skip: ein flacher
  // Klon koennte genau die Revision verbergen, die den Betrug zeigt.
  assert.equal(
    git('rev-parse', '--is-shallow-repository').trim(),
    'false',
    'flacher Klon — die Historie kann den Praefix-Anker nicht belegen. Mit `git fetch --unshallow` holen.',
  );

  const revisionen = git('log', '--format=%H', '--', LEDGER_REL).trim().split('\n').filter(Boolean);
  assert.ok(revisionen.length > 0, 'das Register muss in der Git-Historie stehen');

  const aktuell = echtesRegister().events;
  const alsText = (e) => JSON.stringify(e);
  for (const rev of revisionen) {
    const alt = JSON.parse(git('show', `${rev}:${LEDGER_REL}`)).events || [];
    assert.ok(
      alt.length <= aktuell.length,
      `Revision ${rev.slice(0, 10)} hat mehr Eintraege als der aktuelle Stand — es wurde geloescht`,
    );
    alt.forEach((event, i) => {
      assert.equal(
        alsText(event),
        alsText(aktuell[i]),
        `Revision ${rev.slice(0, 10)}: Eintrag ${i} weicht vom aktuellen Stand ab — nachtraeglich umgeschrieben`,
      );
    });
  }
});

// Die Menge der Zugriffszeit-Arten ist die Referenz, gegen die
// scripts/studie-r1-serverzeit.js seine BESTAETIGBAR-Liste misst (F6-B17a).
// Ohne den Export koennte der dortige Gleichheits-Anker sie nur abschreiben —
// zwei Kopien derselben Regel driften. Die Dreizahl steht mit im Anker: eine
// vierte Zugriffsart aufzunehmen ist ein eigener, sichtbarer Verfassungsakt und
// muss HIER auffallen, nicht erst im Werkzeug.
test('ARTEN_MIT_ZUGRIFFSZEIT ist exportiert und fuehrt genau drei Arten', () => {
  assert.ok(ARTEN_MIT_ZUGRIFFSZEIT instanceof Set,
    'die Zugriffszeit-Arten muessen als Menge exportiert sein, nicht als Kopie');
  assert.equal(ARTEN_MIT_ZUGRIFFSZEIT.size, 3);
});
