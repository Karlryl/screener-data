'use strict';

// DIE BEWEISEBENE UEBER DER NAHT — verhaltensgeprueft, nicht textgeprueft.
//
// DER BEFUND, DER DIESE DATEI ERZWUNGEN HAT (Review zu #238, F2/F3):
// `bestaetigen` suchte den eventHash mit `includes()` in den ROHEN Bytes der
// Serverantwort. Die Naht STELLT DIESE KOLLISION SELBST HER: der eventHash des
// Abschluss-Akts steht dreimal im KOPF der Fortsetzung (genesisSha256,
// vorgaengerTailHash, vorgaengerCheckpointEventHash). Eine Fortsetzung mit NULL
// Eintraegen lieferte damit einen vollstaendig gruenen Beweis - ein sauberes
// Verdikt aus dem falschen Grund, an der einen Stelle, an der es toedlich ist.
//
// Und die Pins dagegen waren Textmuster im Quelltext. Ein Textmuster bezeugt,
// dass eine Zeile dasteht, nicht dass sie laeuft. Hier wird deshalb die
// Ausfuehrung gemessen: WELCHE URL abgesetzt wurde, WELCHE Datei gelesen wurde,
// und WAS in der Freigabe steht.
//
// Usage: node --test tests/studie-naht-beweisebene.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const WURZEL = path.join(__dirname, '..');
const { REGISTER_RELS } = require('../lib/studie-verfassung');
const GESCHLOSSEN_REL = REGISTER_RELS[0];
const FORTSETZUNG_REL = REGISTER_RELS[REGISTER_RELS.length - 1];

const geschlossen = JSON.parse(
  fs.readFileSync(path.join(WURZEL, ...GESCHLOSSEN_REL.split('/')), 'utf8'));
const fortsetzungKopf = JSON.parse(
  fs.readFileSync(path.join(WURZEL, ...FORTSETZUNG_REL.split('/')), 'utf8'));

// Ein echter, bestaetigbarer Eintrag aus der geschlossenen Datei.
const ALT_EINTRAG = geschlossen.events.find((e) => e.typ === 'count_only_probe_authorized');

// Ein Fortsetzungs-Eintrag, wie ihn der count-only-Akt anlegen wird. Er wird
// kettenecht angehaengt, damit pruefeZugriffsRegister ihn nicht aus einem
// anderen Grund ablehnt als dem, der hier geprueft wird.
const { haengeEintragAn } = require('../lib/studie-verfassung');
const NEU_RUN_ID = 'naht-beweisprobe-fortsetzung';
const fortsetzungMitEintrag = haengeEintragAn(fortsetzungKopf, {
  runId: NEU_RUN_ID,
  typ: 'count_only_probe_authorized',
  registeredAt: '2026-09-02T08:00:00.000Z',
  accessedAt: '2026-09-02T12:00:00.000Z',
  fenster: ['entdeckung'],
  allowedOutputs: ['n'],
});
const NEU_EINTRAG = fortsetzungMitEintrag.events[fortsetzungMitEintrag.events.length - 1];

// ── Die Attrappen. Sie stehen VOR dem require, weil das Skript execFileSync
//    beim Laden destrukturiert.
const cp = require('node:child_process');
const echtExec = cp.execFileSync;
const abgesetzt = [];
// Was die Attrappe je Pfad zurueckgibt. `null` = die Datei gibt es dort nicht.
let serverStand = {};
let serverPfadUeberschreibung = null;
let angefragteRunId = null;
cp.execFileSync = (datei, args, ...rest) => {
  if (datei === 'gh' && args[0] === 'repo') return 'Karlryl/screener-data\n';
  if (datei === 'gh' && args[0] === 'api') {
    abgesetzt.push(args[2]);
    const rel = String(args[2]).replace(/^repos\/[^/]+\/[^/]+\/contents\//, '').split('?')[0];
    const stand = serverStand[rel];
    assert.ok(stand !== undefined, `die Attrappe kennt ${rel} nicht - Probe falsch aufgesetzt`);
    const e = (stand.events || []).find((x) => x.runId === angefragteRunId)
      || (stand.events || []).find((x) => x.accessedAt) || ALT_EINTRAG;
    const server = new Date(
      (Date.parse(e.registeredAt) + Date.parse(e.accessedAt)) / 2).toUTCString();
    const rumpf = JSON.stringify({
      path: serverPfadUeberschreibung || rel,
      encoding: 'base64',
      content: Buffer.from(JSON.stringify(stand), 'utf8').toString('base64'),
    });
    return `date: ${server}\r\ncontent-type: application/json\r\n\r\n${rumpf}`;
  }
  return echtExec(datei, args, ...rest);
};

const echtRead = fs.readFileSync;
let lokalerStand = {};
const FEHLT = Symbol('datei fehlt');
const gelesenePfade = [];
fs.readFileSync = (p, ...rest) => {
  if (typeof p === 'string') {
    for (const rel of REGISTER_RELS) {
      if (p.endsWith(rel.split('/').pop())) {
        gelesenePfade.push(rel);
        const stand = lokalerStand[rel];
        if (stand === undefined) return echtRead(p, ...rest);
        if (stand === FEHLT) { const f = new Error('ENOENT'); f.code = 'ENOENT'; throw f; }
        return JSON.stringify(stand, null, 1);
      }
    }
  }
  return echtRead(p, ...rest);
};

const W = require('../scripts/studie-r1-serverzeit.js');

function fahre(runId) {
  abgesetzt.length = 0;
  gelesenePfade.length = 0;
  angefragteRunId = runId;
  const ziel = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'naht-bw-')), 'freigabe.json');
  W.bestaetigen(['bestaetigen', '--runid', runId, '--ziel', ziel]);
  return JSON.parse(echtRead(ziel, 'utf8'));
}

test.after(() => { cp.execFileSync = echtExec; fs.readFileSync = echtRead; });

// ── F2: der Befund selbst, als Probe ────────────────────────────────────────

test('F2: eine Fortsetzung mit NULL Eintraegen liefert KEINEN gruenen Beweis', () => {
  // Genau der reproduzierte Fall: der eventHash steht im Kopf, kein Eintrag
  // traegt ihn. Die alte Textsuche wurde hier gruen.
  lokalerStand = { [GESCHLOSSEN_REL]: geschlossen, [FORTSETZUNG_REL]: fortsetzungMitEintrag };
  serverStand = { [FORTSETZUNG_REL]: fortsetzungKopf };   // Server: events []
  assert.throws(() => fahre(NEU_RUN_ID), /steht 0-mal/);
  // Und der Kopf traegt den Hash wirklich - sonst pruefte diese Probe nichts.
  const roh = JSON.stringify(fortsetzungKopf);
  assert.ok(roh.includes(fortsetzungKopf.genesisSha256),
    'der Kopf traegt den Genesis nicht - dann gaebe es die Kollision gar nicht');
});

test('F2 REPRO: der Kopf-Hash der Naht darf keinen Beweis tragen', () => {
  // DIE FAITHFUL REPRODUKTION. Die erste Fassung dieser Probe fiel nicht rot,
  // weil ihr erfundener Eintrag einen frischen eventHash trug - und der stand
  // natuerlich nicht im Kopf. Die Kollision entsteht nur bei dem EINEN Hash,
  // den die Naht dreimal in den Kopf schreibt: dem des Abschluss-Akts.
  //
  // Lage: lokal fuehrt die Fortsetzung einen Eintrag mit genau diesem
  // eventHash; auf dem Server ist die Fortsetzung LEER. Die alte Textsuche
  // fand den Hash im KOPF und gab einen vollstaendig gruenen Beweis aus.
  // Der Server-Stand ist eine LEERE, kettengueltige Fortsetzung, deren KOPF
  // den gesuchten eventHash traegt - genau die Form, die die Naht erzeugt
  // (genesisSha256, vorgaengerTailHash, vorgaengerCheckpointEventHash tragen
  // alle drei denselben Wert). Kettenpruefung: gruen, weil events leer ist.
  // Textsuche in den Rohbytes: findet den Hash IM KOPF und gibt gruen.
  const kopfMitHash = {
    ...fortsetzungKopf,
    genesisSha256: NEU_EINTRAG.eventHash,
    vorgaengerTailHash: NEU_EINTRAG.eventHash,
    vorgaengerCheckpointEventHash: NEU_EINTRAG.eventHash,
    events: [],
  };
  assert.ok(JSON.stringify(kopfMitHash).includes(NEU_EINTRAG.eventHash),
    'der Kopf traegt den Hash nicht - dann gaebe es die Kollision nicht');
  lokalerStand = { [GESCHLOSSEN_REL]: geschlossen, [FORTSETZUNG_REL]: fortsetzungMitEintrag };
  serverStand = { [FORTSETZUNG_REL]: kopfMitHash };
  assert.throws(() => fahre(NEU_RUN_ID), /steht 0-mal/,
    'ein Beweis, der den Hash im KOPF findet statt in einem EINTRAG, beweist nichts');
});

test('F2: ein abweichender eventHash auf dem Server faellt auf', () => {
  const verbogen = JSON.parse(JSON.stringify(fortsetzungMitEintrag));
  verbogen.events[0].eventHash = `0${verbogen.events[0].eventHash.slice(1)}`;
  lokalerStand = { [GESCHLOSSEN_REL]: geschlossen, [FORTSETZUNG_REL]: fortsetzungMitEintrag };
  serverStand = { [FORTSETZUNG_REL]: verbogen };
  assert.throws(() => fahre(NEU_RUN_ID), /R1: Eintrag \d+ wurde nachtraeglich veraendert|traegt auf origin/);
});

test('F2: die Antwort muss den ANGEFRAGTEN Pfad tragen', () => {
  lokalerStand = { [GESCHLOSSEN_REL]: geschlossen, [FORTSETZUNG_REL]: fortsetzungMitEintrag };
  // Eine Antwort, die eine andere Datei ausliefert, als angefragt wurde. Die
  // Ueberschreibung sitzt IN der Attrappe: das Skript hat execFileSync beim
  // Laden destrukturiert, ein spaeteres Umhaengen von cp.execFileSync wirkt
  // nicht mehr - die erste Fassung dieser Probe ist genau daran gescheitert.
  serverStand = { [FORTSETZUNG_REL]: fortsetzungMitEintrag };
  serverPfadUeberschreibung = GESCHLOSSEN_REL;
  try {
    assert.throws(() => fahre(NEU_RUN_ID), /die API-Antwort traegt den Pfad/);
  } finally {
    serverPfadUeberschreibung = null;
  }
  // Gegenrichtung: mit dem richtigen Pfad geht derselbe Fall durch.
  assert.equal(fahre(NEU_RUN_ID).registerDatei, FORTSETZUNG_REL);
});

// ── F3: die drei Verwendungen des aufgeloesten Pfades, VERHALTENSGEPRUEFT ────

test('F3: der Beweis eines Fortsetzungs-Eintrags laeuft gegen die FORTSETZUNG', () => {
  lokalerStand = { [GESCHLOSSEN_REL]: geschlossen, [FORTSETZUNG_REL]: fortsetzungMitEintrag };
  serverStand = { [FORTSETZUNG_REL]: fortsetzungMitEintrag };
  const freigabe = fahre(NEU_RUN_ID);
  // (1) die abgesetzte URL
  assert.equal(abgesetzt.length, 1, 'genau eine API-Abfrage');
  assert.ok(abgesetzt[0].includes(`contents/${FORTSETZUNG_REL}?ref=main`),
    `die Abfrage lief gegen ${abgesetzt[0]}`);
  // (2) die LOKAL gelesene Datei - der Pfad, der bis F3 ungepinnt war
  assert.ok(gelesenePfade.includes(FORTSETZUNG_REL), 'die Fortsetzung wurde lokal nicht gelesen');
  // (3) was in der Freigabe steht
  assert.equal(freigabe.registerDatei, FORTSETZUNG_REL);
  assert.ok(freigabe.quelle.includes(FORTSETZUNG_REL), `quelle nennt ${freigabe.quelle}`);
  assert.equal(freigabe.registerEventHash, NEU_EINTRAG.eventHash);
});

test('F3: der Beweis eines alten Eintrags laeuft gegen die GESCHLOSSENE Datei', () => {
  lokalerStand = { [GESCHLOSSEN_REL]: geschlossen, [FORTSETZUNG_REL]: fortsetzungKopf };
  serverStand = { [GESCHLOSSEN_REL]: geschlossen };
  const freigabe = fahre(ALT_EINTRAG.runId);
  assert.ok(abgesetzt[0].includes(`contents/${GESCHLOSSEN_REL}?ref=main`),
    `die Abfrage lief gegen ${abgesetzt[0]}`);
  assert.equal(freigabe.registerDatei, GESCHLOSSEN_REL);
  assert.ok(freigabe.quelle.includes(GESCHLOSSEN_REL));
  assert.equal(freigabe.registerEventHash, ALT_EINTRAG.eventHash);
});

// ── F6: eine vorhandene, aber unbrauchbare Registerdatei ────────────────────

test('F6: eine leere oder verbogene Registerdatei ist ein ABBRUCH, kein leeres Glied', () => {
  for (const kaputt of [null, '', [], {}]) {
    lokalerStand = { [GESCHLOSSEN_REL]: geschlossen, [FORTSETZUNG_REL]: kaputt };
    assert.throws(() => W.registerDerRunId(ALT_EINTRAG.runId),
      /ist keine Registerdatei/,
      `${JSON.stringify(kaputt)} wurde als leeres Glied durchgewunken - damit liesse sich die `
      + 'Mehrdeutigkeits-Sperre aushebeln');
  }
  // Gegenrichtung: eine FEHLENDE Datei bleibt ein leeres Glied.
  lokalerStand = { [GESCHLOSSEN_REL]: geschlossen, [FORTSETZUNG_REL]: FEHLT };
  assert.equal(W.registerDerRunId(ALT_EINTRAG.runId).rel, GESCHLOSSEN_REL);
});

// ── F7: EINE Lesung je Datei ────────────────────────────────────────────────

test('F7: der Aufloeser liest jede Registerdatei genau einmal und gibt sie heraus', () => {
  lokalerStand = { [GESCHLOSSEN_REL]: geschlossen, [FORTSETZUNG_REL]: fortsetzungMitEintrag };
  gelesenePfade.length = 0;
  const { rel, register } = W.registerDerRunId(NEU_RUN_ID);
  assert.equal(rel, FORTSETZUNG_REL);
  assert.ok(register && Array.isArray(register.events),
    'der Aufloeser gibt den gelesenen Stand nicht heraus - der Aufrufer muesste erneut lesen');
  assert.equal(register.events.at(-1).runId, NEU_RUN_ID);
  for (const r of REGISTER_RELS) {
    assert.ok(gelesenePfade.filter((x) => x === r).length <= 1,
      `${r} wurde mehrfach gelesen - drei Lesungen sind drei Zeitpunkte (TOCTOU)`);
  }
});
