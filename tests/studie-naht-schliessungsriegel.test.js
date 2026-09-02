'use strict';

// LRA-1 UND LRA-2 — die Ampel und der Riegel.
//
// LRA-2, DIE SACHE: eine Registerdatei, deren letzter Akt jeden weiteren
// Eintrag verbietet, ist GESCHLOSSEN. Bis zu diesem Akt stand dieses Verbot
// nur als Satz IM Register - kein Code las ihn. `anmelden` zeigte weiter auf
// die geschlossene Datei und schrieb dort erfolgreich hinein: rc=0,
// Erfolgs-JSON, "JETZT: committen und pushen". Der Riegel macht das
// PERSISTIEREN unmoeglich; im Speicher anhaengen bleibt erlaubt, weil die
// Werkbaenke der verbrauchten Anhaenger genau das brauchen.
//
// DER ORT IST TRAGEND. Das Praedikat wird am SCHREIB-Rand gerufen
// (schreibeRegister, vor dem writeFileAtomic) - NICHT in pruefeZugriffsRegister
// und NICHT in haengeEintragAn. Beide liefen ueber JEDES gelesene Register,
// auch ueber die historischen Staende der Werkbaenke, und faerbten dort rot,
// ohne dass irgendetwas geschrieben wuerde. Das waere ein Griff in die
// Geschichtsleser-Klasse (LR-15).
//
// Usage: node --test tests/studie-naht-schliessungsriegel.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const WURZEL = path.join(__dirname, '..');
const { istGeschlossen, REGISTER_RELS, haengeEintragAn } = require('../lib/studie-verfassung');

const lies = (rel) => JSON.parse(fs.readFileSync(path.join(WURZEL, ...rel.split('/')), 'utf8'));
const GESCHLOSSEN = lies(REGISTER_RELS[0]);
const FORTSETZUNG = lies(REGISTER_RELS[REGISTER_RELS.length - 1]);

// ── LRA-2: das Praedikat ────────────────────────────────────────────────────

test('LRA-2: das Praedikat erkennt die geschlossene Datei und nur sie', () => {
  assert.equal(istGeschlossen(GESCHLOSSEN), true,
    'die geschlossene Datei traegt den Abschluss-Akt als letzten Eintrag');
  assert.equal(istGeschlossen(FORTSETZUNG), false,
    'die Fortsetzung ist offen - sonst koennte nie ein Akt in sie hinein');
});

test('LRA-2: das Praedikat prueft die EIGENSCHAFT, nicht die Kennung', () => {
  // Ein spaeterer Abschluss-Akt mit anderem Namen traegt denselben Satz und
  // muss denselben Riegel ausloesen. Umgekehrt darf ein beliebiger Eintrag mit
  // irgendeinem verboten-Text ihn NICHT ausloesen.
  const fremd = {
    events: [{ runId: 'irgendein-anderer-name', verboten: 'Jeder weitere Eintrag in DIESER Datei.' }],
  };
  assert.equal(istGeschlossen(fremd), true, 'die Eigenschaft zaehlt, nicht der Name');
  const offen = {
    events: [{ runId: 'x', verboten: 'Jede Berufung auf diesen Eintrag als Autorisierung eines Laufs.' }],
  };
  assert.equal(istGeschlossen(offen), false, 'ein anderes Verbot schliesst die Datei nicht');
});

test('LRA-2: leere und kaputte Staende sind NICHT geschlossen', () => {
  // Fail-open waere hier richtig: eine Datei ohne Eintraege hat keinen
  // Abschluss-Akt. Fail-closed waere es, jede unbekannte Form zu sperren - das
  // machte die Fortsetzung am Tag ihrer Entstehung unbeschreibbar.
  for (const leer of [null, undefined, {}, { events: [] }, { events: [{ runId: 'x' }] }]) {
    assert.equal(istGeschlossen(leer), false, `${JSON.stringify(leer)} ist nicht geschlossen`);
  }
});

test('LRA-2: IM SPEICHER anhaengen bleibt erlaubt', () => {
  // Die Werkbaenke der verbrauchten Anhaenger haengen im Speicher an
  // historische Staende an. Wuerde der Riegel dort greifen, waeren neun
  // Geschichtsleser still abgeschaltet.
  const imSpeicher = haengeEintragAn(GESCHLOSSEN, {
    runId: 'nur-im-speicher', typ: 'C0_REGELFREEZE',
    registeredAt: '2026-09-02T08:00:00.000Z', accessedAt: '2026-09-02T10:00:00.000Z',
    fenster: ['x'], allowedOutputs: [],
  });
  assert.equal(imSpeicher.events.length, GESCHLOSSEN.events.length + 1,
    'das Anhaengen im Speicher muss durchgehen - nur das Persistieren ist gesperrt');
});

// ── LRA-2: der Riegel sitzt am SCHREIB-Rand ─────────────────────────────────

test('LRA-2: der Riegel steht in schreibeRegister, nicht in der Verfassung', () => {
  // Der Ort ist tragend und wird deshalb gemessen, nicht zugesagt.
  const verfassung = fs.readFileSync(path.join(WURZEL, 'lib', 'studie-verfassung.js'), 'utf8');
  const nachRegister = verfassung.slice(verfassung.indexOf('function pruefeZugriffsRegister'));
  assert.ok(!/istGeschlossen\s*\(/.test(nachRegister.slice(0, nachRegister.indexOf('module.exports'))),
    'istGeschlossen wird aus pruefeZugriffsRegister oder haengeEintragAn gerufen - beide '
    + 'laufen ueber JEDES gelesene Register und faerbten die Geschichtsleser rot (LR-15)');

  const werkzeug = fs.readFileSync(path.join(WURZEL, 'scripts', 'studie-r1-serverzeit.js'), 'utf8');
  const schreiber = werkzeug.slice(werkzeug.indexOf('function schreibeRegister'));
  const riegel = schreiber.indexOf('istGeschlossen(');
  const schreibvorgang = schreiber.indexOf('writeFileAtomic(');
  assert.ok(riegel >= 0, 'der Riegel fehlt am Schreib-Rand');
  assert.ok(riegel < schreibvorgang,
    'der Riegel steht HINTER dem Schreibvorgang - dann hat er schon geschrieben');
});

test('LRA-2: anmelden persistiert NICHT in die geschlossene Datei', () => {
  // Die scharfe Probe: der echte Schreibweg, mit abgefangenem writeFileAtomic,
  // damit auch ein Fehlschlag des Riegels nichts anfassen kann.
  // DER SCHREIBER WIRD ABGEFANGEN UND NICHT DURCHGEREICHT. Die erste Fassung
  // rief den echten Schreiber weiter - und als eine Bruchprobe den Riegel
  // versuchsweise entfernte, schrieb genau diese Probe einen Eintrag 32 in die
  // geschlossene Datei (198.510 B), den ich aus main zurueckholen musste. Eine
  // Probe ueber einem Schreibverbot darf selbst nichts schreiben koennen.
  const atomic = require('../lib/atomic-write.js');
  const echt = atomic.writeFileAtomic;
  const versuche = [];
  atomic.writeFileAtomic = (ziel) => { versuche.push(path.resolve(ziel)); };
  const W = require('../scripts/studie-r1-serverzeit.js');
  try {
    assert.throws(
      () => W.anmelden(['anmelden', '--runid', 'riegel-probe-2026-09-02',
        '--fenster', 'riegel-probe', '--zugriff-ab', new Date(Date.now() + 3600e3).toISOString()]),
      /GESCHLOSSEN/,
      'anmelden schreibt weiterhin in die geschlossene Datei - rc=0 und Erfolgs-JSON inklusive');
    const ziel = path.resolve(path.join(WURZEL, ...REGISTER_RELS[0].split('/')));
    assert.ok(!versuche.includes(ziel),
      'der Schreibvorgang auf die geschlossene Datei wurde ueberhaupt versucht');
  } finally {
    atomic.writeFileAtomic = echt;
  }
});

// ── LRA-1: die Ampel ────────────────────────────────────────────────────────

test('LRA-1: die gh-Attrappe des KV-4-Waechters liefert den angefragten Pfad', () => {
  // Die echte GitHub-Antwort traegt `path` immer. Ohne ihn fuhr der
  // KV-4-Waechter rot aus einem Grund, der mit seinem Gegenstand nichts zu tun
  // hat - und ein Urteil ueber einen Waechter mit fremd-roter Ampel misst
  // nichts.
  const quelle = fs.readFileSync(
    path.join(WURZEL, 'tests', 'studie-r1-bestaetigbar-zugriff.test.js'), 'utf8');
  assert.match(quelle, /path: angefragt,/,
    'die Attrappe liefert den angefragten Pfad nicht mit');
  assert.match(quelle, /const angefragt = String\(args\[2\]\)/,
    'der ausgelieferte Pfad wird nicht aus der Anfrage abgeleitet, sondern geraten');
});
