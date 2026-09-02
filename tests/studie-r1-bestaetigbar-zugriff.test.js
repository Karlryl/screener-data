'use strict';

/**
 * F6-B16..F6-B19 - `BESTAETIGBAR` fuehrt die konfirmatorische Zugriffsart.
 * _COURT-F6-VOLLZUG-2026-08-31, Frage (c), 3:0 (ratifiziert Session 07,
 * 2026-08-31 22:19 lokal).
 *
 * DIE SACHE: `lib/studie-verfassung.js` fuehrt
 * `confirmatory_execution_authorized` als ART_ZUGRIFF und legt sie in
 * ARTEN_MIT_ZUGRIFFSZEIT. `scripts/studie-r1-serverzeit.js` fuehrte davon eine
 * echte Teilmenge - und verweigerte damit ausgerechnet der Art die
 * Server-Bestaetigung, fuer die die VB-A11-Zeitkette geschrieben wurde. Ohne
 * die Erweiterung ist die Zeitkette fuer den konfirmatorischen Eintrag mit dem
 * sanktionierten Werkzeug ueberhaupt nicht fahrbar.
 *
 * WAS HIER GESCHUETZT WIRD, ist die UNBEKANNTE Art, nicht die Zweizahl. Der
 * Waechter nagelt die Menge deshalb auf GLEICHHEIT mit der Verfassung fest
 * (F6-B17a) - das ist die maschinelle Fassung von Kipp-Bedingung KV-4: wird
 * BESTAETIGBAR je um eine Art erweitert, die die Verfassung nicht als
 * Zugriffsart fuehrt, wird dieser Test rot.
 *
 * OBJEKT-ANKER STATT ABSCHRIFT, zwei Lagen:
 *   1. Die WOERTLICHE Gleichheit gegen die Verfassungs-Menge selbst, ueber
 *      `artenMitZugriffszeit()` aus `lib/studie-verfassung.js` (PR #187).
 *      Sie deckt beide Driftrichtungen ab - auch die, in der die VERFASSUNG
 *      waechst und das Werkzeug still nachhinkt.
 *   2. Zusaetzlich die Rueckfrage bei der Verfassung je Art (`haengeEintragAn`
 *      + `pruefeZugriffsRegister` klassifizieren eine Art als 'zugriff',
 *      'vorab' oder unbekannt). Sie faengt auch eine Art, die die Verfassung
 *      ueberhaupt nicht kennt.
 * Beide Mengen kommen als KOPIE herein; keiner der beiden Getter gibt einen
 * Handgriff heraus, an dem sich die Schranke im Prozess aufziehen liesse.
 *
 * KEIN SCHREIBZUGRIFF AUF DAS REGISTER. Das Zugriffs-Register wird ausschliesslich
 * GELESEN; der atomare Schreiber ist abgefangen, und der Test beweist am
 * SHA-256 der Datei, dass sie danach byte-gleich ist.
 *
 * BRUCHPROBE (F6-B18, beide Richtungen, im PR-Text protokolliert):
 * ART_ZUGRIFF wieder entfernen -> Positivtest rot; eine vierte Art einfuegen ->
 * Gleichheits-/Kardinalitaets-Anker rot.
 *
 * Usage: node --test tests/studie-r1-bestaetigbar-zugriff.test.js
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const LEDGER_REL = 'protocol/early-detection/2.0.0/outcome-access-ledger.json';
const LEDGER = path.join(ROOT, ...LEDGER_REL.split('/'));

const {
  VerfassungsBruch,
  haengeEintragAn,
  pruefeZugriffsRegister,
  ART_ZUGRIFF,
  ART_ZAEHLPROBE,
  ART_C0_REGELFREEZE,
  artenMitZugriffszeit,
} = require(path.join(ROOT, 'lib', 'studie-verfassung.js'));

const echtRead = fs.readFileSync;
const ledgerSha = () => crypto.createHash('sha256').update(echtRead(LEDGER)).digest('hex');
const SHA_VORHER = ledgerSha();

// ── Fixtures ────────────────────────────────────────────────────────────────
// Ein Eintrag der konfirmatorischen Art, an die ECHTE Kette gehaengt: der Test
// prueft damit dieselbe Lage, die Eintrag 25 spaeter herstellt, ohne sie
// herzustellen. Er wird NIE geschrieben - er lebt nur im Speicher.
const echtesRegister = JSON.parse(echtRead(LEDGER, 'utf8'));
const jetzt = Date.now();

function eintragRoh(runId, typ, versatzMinuten = 0) {
  return {
    runId,
    typ,
    registeredAt: new Date(jetzt + versatzMinuten * 60000).toISOString(),
    accessedAt: new Date(jetzt + (versatzMinuten + 120) * 60000).toISOString(),
    fenster: ['f6-b17-fixture'],
    allowedOutputs: [],
    erlaubt: 'Fixture. Nichts.',
    verboten: 'Alles.',
    begruendung: 'Fixture fuer tests/studie-r1-bestaetigbar-zugriff.test.js (F6-B17).',
    endtestSiegel: 'unberuehrt - dieser Eintrag existiert nur im Speicher eines Tests.',
  };
}

const KONFIRMATORISCH = eintragRoh('f6-b17-positivtest', ART_ZUGRIFF);
const registerMitZugriff = haengeEintragAn(echtesRegister, KONFIRMATORISCH);

// Welche Registerfassung das Skript zu sehen bekommt und welcher Eintrag
// gerade bestaetigt wird - beides steuert der Test.
let sicht = null;
let imBlick = null;

fs.readFileSync = (pfad, ...rest) => {
  if (sicht && typeof pfad === 'string' && path.resolve(pfad) === LEDGER) {
    return JSON.stringify(sicht, null, 1);
  }
  return echtRead(pfad, ...rest);
};

// `gh` wird ueber execFileSync aufgerufen und beim Laden des Skripts
// destrukturiert - der Ersatz muss deshalb VOR dem require stehen. Serverzeit
// strikt zwischen registeredAt und accessedAt, damit die echten Zeitpruefungen
// greifen statt vorher abzubrechen.
const cp = require('node:child_process');
const echtExec = cp.execFileSync;
cp.execFileSync = (datei, args, optionen) => {
  if (datei === 'gh' && args[0] === 'repo') return 'Karlryl/screener-data\n';
  if (datei === 'gh' && args[0] === 'api') {
    const server = new Date(
      (Date.parse(imBlick.registeredAt) + Date.parse(imBlick.accessedAt)) / 2,
    ).toUTCString();
    // LRA-1: DIE AMPEL REPARIEREN, BEVOR SIE GELESEN WIRD. Die echte
    // GitHub-Antwort traegt `path` immer; diese Attrappe liess ihn weg. Seit der
    // F2-Haertung vergleicht der Serverbeweis den ausgelieferten Pfad mit dem
    // angefragten - und dieser Waechter fuhr dadurch rot aus einem Grund, der
    // mit seinem eigenen Gegenstand (dem KV-4-Gleichheitsanker) nichts zu tun
    // hat. Ein Urteil ueber einen Waechter, dessen Ampel aus fremdem Grund rot
    // ist, misst nichts.
    const angefragt = String(args[2]).replace(/^repos\/[^/]+\/[^/]+\/contents\//, '').split('?')[0];
    const rumpf = JSON.stringify({
      path: angefragt,
      encoding: 'base64',
      content: Buffer.from(JSON.stringify(sicht), 'utf8').toString('base64'),
    });
    return `date: ${server}\r\ncontent-type: application/json\r\n\r\n${rumpf}`;
  }
  return echtExec(datei, args, optionen);
};

// Der atomare Schreiber, abgefangen: auf das echte Register geht NICHTS. Das
// Freigabe-Protokoll darf in sein Temp-Ziel.
const atomic = require(path.join(ROOT, 'lib', 'atomic-write.js'));
const echtWrite = atomic.writeFileAtomic;
const geschrieben = [];
atomic.writeFileAtomic = (ziel, inhalt, kodierung) => {
  geschrieben.push({ ziel: path.resolve(ziel), inhalt });
  if (path.resolve(ziel) === LEDGER) return undefined;
  return echtWrite(ziel, inhalt, kodierung);
};

const {
  bestaetigbareArten, bestaetigen, anmelden,
} = require(path.join(ROOT, 'scripts', 'studie-r1-serverzeit.js'));
const BESTAETIGBAR = bestaetigbareArten();

const LEER = {
  schema: 'early-detection-outcome-access-ledger/v2',
  genesisSha256: 'f'.repeat(64),
  events: [],
};

// Die Verfassung selbst befragen: traegt sie diese Art als ZUGRIFFSART?
// 'vorab'-Arten fliegen an derselben Pruefung auf (sie duerfen kein accessedAt
// tragen), unbekannte Arten ebenfalls.
function verfassungTraegtAlsZugriff(art) {
  try {
    pruefeZugriffsRegister(haengeEintragAn(LEER, eintragRoh(`anker-${art}`, art)));
    return true;
  } catch (fehler) {
    if (fehler instanceof VerfassungsBruch) return false;
    throw fehler;
  }
}

function freigabeZiel() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'f6-b17-')), 'freigabe.json');
}

// ── (a) Gleichheits- und Kardinalitaets-Anker (F6-B17a, KV-4) ───────────────
test('F6-B17(a): BESTAETIGBAR ist genau die Zugriffszeit-Menge der Verfassung', () => {
  // Der woertliche Anker: Gleichheit gegen die IMPORTIERTE Verfassungs-Menge,
  // nicht gegen eine Abschrift ihrer Elemente. Er steht bewusst zuerst, weil er
  // die schaerfste Aussage traegt - und er deckt die Richtung ab, die eine
  // Abschrift nicht deckt: waechst ARTEN_MIT_ZUGRIFFSZEIT eines Tages um eine
  // Art, wird HIER rot, statt dass das Werkzeug still nachhinkt. Genau dieses
  // Nachhinken ist der Defekt, den dieser Akt beseitigt.
  assert.deepEqual(
    new Set([...BESTAETIGBAR]),
    new Set([...artenMitZugriffszeit()]),
    'BESTAETIGBAR muss der Verfassungs-Menge ARTEN_MIT_ZUGRIFFSZEIT gleichen',
  );
  // Und keiner der beiden Getter gibt einen lebenden Handgriff heraus: wer die
  // Kopie erweitert, erweitert die Schranke nicht.
  bestaetigbareArten().add('eingeschmuggelte_art');
  assert.equal(bestaetigbareArten().size, 3,
    'BESTAETIGBAR darf sich von aussen nicht erweitern lassen');
  assert.equal(BESTAETIGBAR.size, 3,
    'die Kardinalitaet ist gepinnt: eine vierte Art faellt hier auf');
  // Und die drei Arten sind die importierten Konstanten, nie abgetippte
  // Zeichenketten.
  for (const art of [ART_ZUGRIFF, ART_ZAEHLPROBE, ART_C0_REGELFREEZE]) {
    assert.ok(BESTAETIGBAR.has(art), `${art} fehlt in BESTAETIGBAR`);
  }

  // Objekt-Anker: jede bestaetigbare Art muss von der VERFASSUNG als
  // Zugriffsart getragen werden. Das ist die Bedingung, deren Bruch (c) kippt.
  for (const art of BESTAETIGBAR) {
    assert.ok(verfassungTraegtAlsZugriff(art),
      `${art} steht in BESTAETIGBAR, aber die Verfassung fuehrt sie nicht als Zugriffsart`);
  }

  // Gegenprobe an der SACHE: die Schleife prueft wirklich etwas. Eine
  // Phantasie-Art und eine Vorab-Art werden von derselben Pruefung abgewiesen.
  assert.equal(verfassungTraegtAlsZugriff('phantasie_art_2026'), false);
  assert.equal(verfassungTraegtAlsZugriff('R15b_NUR_ZAEHLEN'), false);
});

// ── (b) Positivtest: die konfirmatorische Art wird bestaetigt ───────────────
test('F6-B17(b): ein confirmatory_execution_authorized-Eintrag wird bestaetigt', () => {
  sicht = registerMitZugriff;
  imBlick = registerMitZugriff.events[registerMitZugriff.events.length - 1];
  const ziel = freigabeZiel();

  assert.equal(bestaetigen(['bestaetigen', '--runid', KONFIRMATORISCH.runId, '--ziel', ziel]), 0);

  const freigabe = JSON.parse(echtRead(ziel, 'utf8'));
  assert.equal(freigabe.runId, KONFIRMATORISCH.runId);
  assert.equal(freigabe.registerEventHash, imBlick.eventHash);
  assert.equal(freigabe.registerZweig, 'main', 'der Beweis laeuft gegen main');
  assert.ok(Date.parse(freigabe.registeredAt) < Date.parse(freigabe.serverConfirmedAt)
    && Date.parse(freigabe.serverConfirmedAt) < Date.parse(freigabe.accessedAt),
  'die Serverzeit liegt zwischen Anmeldung und angemeldetem Zugriff');
  sicht = null;
});

// ── (c) Negativtests: die Schranke bleibt geschlossen ───────────────────────
test('F6-B17(c): eine Phantasie-Art wirft weiterhin VerfassungsBruch, mit der Art im Text', () => {
  const phantasie = eintragRoh('f6-b17-phantasie', 'sofort_alles_lesen_bitte');
  sicht = haengeEintragAn(echtesRegister, phantasie);
  imBlick = sicht.events[sicht.events.length - 1];
  assert.throws(
    () => bestaetigen(['bestaetigen', '--runid', phantasie.runId, '--ziel', freigabeZiel()]),
    (fehler) => fehler instanceof VerfassungsBruch
      && fehler.message.includes('sofort_alles_lesen_bitte'),
    'die unbekannte Art muss namentlich im Abbruch stehen',
  );
  sicht = null;
});

test('F6-B17(c): eine BEKANNTE, aber nicht bestaetigbare Art faellt an BESTAETIGBAR auf', () => {
  // 'R15b_NUR_ZAEHLEN' kennt die Verfassung als VORAB-Anmeldung; sie traegt
  // keine Zugriffszeit und ist deshalb nicht server-bestaetigbar. Hier faellt
  // sie an der Liste dieses Skripts auf, nicht an der Kettenpruefung - genau
  // das ist die Schranke, die (c) offen haelt.
  const vorab = eintragRoh('f6-b17-vorab', 'R15b_NUR_ZAEHLEN');
  delete vorab.accessedAt;
  sicht = haengeEintragAn(echtesRegister, vorab);
  imBlick = sicht.events[sicht.events.length - 1];
  assert.throws(
    () => bestaetigen(['bestaetigen', '--runid', vorab.runId, '--ziel', freigabeZiel()]),
    (fehler) => fehler instanceof VerfassungsBruch
      && fehler.message.includes('R15b_NUR_ZAEHLEN')
      && fehler.message.includes('bestaetigbar sind nur'),
    'die nicht bestaetigbare Art muss namentlich im Abbruch stehen',
  );
  sicht = null;
});

// ── (d) anmelden() bleibt unberuehrt ────────────────────────────────────────
test('F6-B17(d): anmelden() meldet weiterhin als ZAEHLPROBE an, nie konfirmatorisch', () => {
  // Wuerde anmelden() die Erweiterung mitnehmen, entstuende ein
  // konfirmatorischer Eintrag unter dem Zaehlproben-Erlaubnistext - eine
  // Falschanmeldung (V3). Der Erlaubnistext verbietet Firmen-Kennungen; genau
  // die sind das Ergebnis eines konfirmatorischen Laufs.
  // LRA-2: die Sicht ist eine OFFENE Registerdatei. Das echte Original ist mit
  // seinem Abschluss-Akt geschlossen; der Schliessungsriegel verweigert dorthin
  // jeden Schreibvorgang. Diese Probe misst nicht, OB angemeldet werden darf,
  // sondern UNTER WELCHER ART - ihre Eigenschaft (ZAEHLPROBE, nie
  // konfirmatorisch, Erlaubnistext der Zaehlprobe) bleibt Wort fuer Wort
  // dieselbe. Nur ihr Gegenstand ist jetzt eine Datei, in die ueberhaupt
  // geschrieben werden darf.
  sicht = { ...echtesRegister, events: echtesRegister.events.slice(0, -1) };
  geschrieben.length = 0;
  const zugriffAb = new Date(jetzt + 24 * 3600000).toISOString();
  assert.equal(anmelden(['anmelden', '--runid', 'f6-b17-anmeldeprobe',
    '--fenster', 'f6-b17-fixture', '--zugriff-ab', zugriffAb]), 0);

  const aufsRegister = geschrieben.filter((g) => g.ziel === LEDGER);
  assert.equal(aufsRegister.length, 1, 'anmelden() schreibt genau einmal ans Register');
  const neu = JSON.parse(aufsRegister[0].inhalt);
  const letzter = neu.events[neu.events.length - 1];
  assert.equal(letzter.runId, 'f6-b17-anmeldeprobe');
  assert.equal(letzter.typ, ART_ZAEHLPROBE,
    'anmelden() verdrahtet ART_ZAEHLPROBE und darf das auch bleiben');
  assert.notEqual(letzter.typ, ART_ZUGRIFF);
  assert.match(letzter.erlaubt, /Keine Firmen-Kennungen/,
    'und der Erlaubnistext bleibt der der Zaehlprobe');
  sicht = null;
});

// ── (e) Blast-Radius: die Zaehlprobe oeffnet sich NICHT ─────────────────────
test('F6-B17(e): eine konfirmatorische Freigabe bricht die Zaehlprobe mit W2-ABBRUCH ab', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f6-b17-blast-'));
  const registerPfad = path.join(dir, 'register.json');
  const freigabePfad = path.join(dir, 'freigabe.json');
  echtWrite(registerPfad, `${JSON.stringify(registerMitZugriff, null, 1)}\n`, 'utf8');
  const eintrag = registerMitZugriff.events[registerMitZugriff.events.length - 1];
  echtWrite(freigabePfad, `${JSON.stringify({
    runId: eintrag.runId,
    fenster: (eintrag.fenster || [])[0],
    registerEventHash: eintrag.eventHash,
    accessedAt: eintrag.accessedAt,
    serverConfirmedAt: new Date(jetzt + 60 * 60000).toISOString(),
  }, null, 1)}\n`, 'utf8');

  const treiber = [
    'import importlib.util, sys',
    `spec = importlib.util.spec_from_file_location('zp', r'${path.join(ROOT, 'scripts', 'studie-zaehlprobe.py')}')`,
    'zp = importlib.util.module_from_spec(spec); spec.loader.exec_module(zp)',
    'import json',
    `freigabe = json.load(open(r'${freigabePfad}', encoding='utf-8'))`,
    'try:',
    `    zp.pruefe_freigabe_gegen_register(freigabe, register_pfad=r'${registerPfad}')`,
    '    print("DURCHGELASSEN")',
    'except zp.ProbeFehler as f:',
    '    print(str(f))',
  ].join('\n');
  const lauf = spawnSync(process.env.PYTHON || 'python', ['-c', treiber],
    { encoding: 'utf8', cwd: ROOT });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /W2-ABBRUCH/,
    'die Zaehlprobe muss eine konfirmatorische Freigabe abweisen');
  assert.match(lauf.stdout, /keine Zaehlproben-Anmeldung/);
  assert.doesNotMatch(lauf.stdout, /DURCHGELASSEN/,
    'der Blast-Radius der Erweiterung ist EINS: die Zaehlprobe oeffnet sich nicht');
});

// ── Und das Register auf der Platte ist byte-gleich geblieben ───────────────
test('F6-B16: dieser Test hat das Zugriffs-Register nicht angefasst', () => {
  assert.equal(ledgerSha(), SHA_VORHER,
    'das Register muss nach dem Lauf byte-gleich sein - kein Ledger-Schreibzugriff');
});
