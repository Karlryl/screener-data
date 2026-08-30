#!/usr/bin/env node
'use strict';

// Studie 2.0, Phase F3b — Register-Eintrag 21 fuer die eingefrorene Konzeptliste 2.1.0.
//
// DIE SACHE: protocol/early-detection/2.0.0/outcome-access-ledger.json ist
// nur-anhaengend, verkettet und extern bezeugt. Ein falscher Eintrag ist nicht
// korrigierbar, nur ergaenzbar. Deshalb ist der Trockenlauf hier der STANDARD:
// ohne Flagge liest das Werkzeug, prueft die ganze Kette, baut den Eintrag im
// Speicher, rechnet seinen eventHash aus und druckt ihn — und schreibt nichts.
// Erst `--schreiben` haengt an. Es gibt kein --force und keine Reparatur-
// Betriebsart: eine Kette, die nicht durchgeht, ist ein Halt, kein Sonderfall.
//
// WARUM DIE ART `C0_REGELFREEZE` UND NICHT `count_only_probe_authorized`:
// Das Regelwerk kennt genau fuenf Eintragsarten (lib/studie-verfassung.js). Eine
// sechste zu erfinden ist nicht moeglich, ohne die Verfassungs-Bibliothek zu
// aendern — pruefeZugriffsRegister weist eine unbekannte Art fail-closed ab und
// wuerde damit das GANZE Register unpruefbar machen. Von den fuenf bekannten
// Arten beschreibt genau eine diesen Vorgang: C0_REGELFREEZE ist laut ihrer
// eigenen Definition "die Anmeldung einer eingefrorenen AUSWAHLREGEL. Sie
// schaltet keine Ergebnisdaten frei ... sie bindet den Hash der Regel an die
// Serveruhr". Das ist F3b woertlich. `count_only_probe_authorized` traegt
// dagegen einen Erlaubnistext ueber Zaehlfelder eines Panel-Fensters — F3b
// zaehlt nichts und oeffnet kein Fenster. Ein Lauf unter einem Erlaubnistext
// anzumelden, der ihn nicht beschreibt, waere eine Falschanmeldung; genau davor
// warnt der Kommentar an ART_C0_REGELFREEZE selbst.
// Der Namensteil "C0" ist historisch (erste Nutzung in Strang C) und bezeichnet
// hier KEINE Zugehoerigkeit zu Strang C. Das steht auch im Eintrag selbst, damit
// ein spaeterer Leser es nicht rekonstruieren muss.
// Nebenwirkung, gewollt: scripts/studie-r1-serverzeit.js `bestaetigen` fuehrt
// diese Art in BESTAETIGBAR — der Serverbeweis, den F3b als zweiten Halbschritt
// braucht, laeuft ohne jede weitere Aenderung.
//
// WARUM `accessedAt` GESETZT IST, OBWOHL NICHTS ZUGEGRIFFEN WIRD: Die Art
// C0_REGELFREEZE steht in ARTEN_MIT_ZUGRIFFSZEIT, das Feld ist also Pflicht und
// muss nach registeredAt liegen. Es bezeichnet hier — wie schon bei
// c0-freeze2-2026-08-19, wo ebenfalls keine Studiendaten angefasst wurden — den
// fruehesten Zeitpunkt, ab dem der eingefrorene Stand VERWENDET werden darf,
// nicht einen Datenzugriff. Der Eintrag sagt das ausdruecklich in `erlaubt`.
//
// EIN-APPENDER-REGEL: protocol/early-detection/2.0.0/register-single-appender-rule.json
// verlangt, dass der Append in einem Commit landet, der direkt auf main geht
// (Mini-PR), und dass danach der Serverbeweis gegen main laeuft. Dieses Werkzeug
// erzwingt das nicht per Zweig-Pruefung — es wuerde sonst genau den vorgesehenen
// Mini-PR-Weg blockieren — sondern druckt die Reihenfolge als Pflicht-Hinweis.
//
// Aufruf:
//   node scripts/studie-f3b-register.js                 # Trockenlauf (Standard)
//   node scripts/studie-f3b-register.js --schreiben     # anhaengen, dann Mini-PR
// Optionen: --runid, --wirksam-ab <ISO>, --anmeldezeit <ISO>,
//           --register <pfad>, --konzeptliste <pfad>   (die beiden Pfade nur fuer Tests)

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  VerfassungsBruch,
  haengeEintragAn,
  pruefeZugriffsRegister,
  ART_C0_REGELFREEZE,
} = require('../lib/studie-verfassung');

const WURZEL = path.join(__dirname, '..');
const LEDGER = path.join(WURZEL, 'protocol', 'early-detection', '2.0.0', 'outcome-access-ledger.json');
const KONZEPTLISTE = path.join(WURZEL, 'protocol', 'early-detection', '2.1.0', 'konzeptliste.json');

// Sollwerte, hier UNABHAENGIG von den geprueften Dateien notiert. Ein Werkzeug,
// das seine Sollwerte aus der Datei liest, die es pruefen soll, prueft nichts.
const RUN_ID = 'f3-konzeptliste-freeze-2026-08-30';
const ERWARTETER_LETZTER_RUNID = 'a5-form25-abgleich-2026-08-30';
const ERWARTETER_TAIL = 'af9fa8d99aa9b3bc57466167ce39ea5a8a2a1e41cbf75789c97ef62cfd88fbee';
const ERWARTETE_EVENTS = 20;
const KONZEPTLISTE_SHA256 = '88ba14a298837bcc6287c4f52a3ba61296b6ba56d96ba78cba0470335df99247';
const KONTAMINATION_SHA256 = 'c1f91af7f9e484f86ecb9cc8d93f020e6cfe615a27cb891dcf5a7771625ee723';
const HERKUNFT_F2_SHA256 = 'dd099f30ff2b29158d541f1817958b3ffd6bd47c391e024f1d343c9c3e1c6448';

// Vorlauf zwischen Anmeldung und Wirksamkeit. Dazwischen muessen Mini-PR und
// Serverbeweis passen; zu knapp waere eine Anmeldung, die sich selbst ueberholt.
const VORLAUF_MINUTEN = 120;

// ACHTUNG, zwei verschiedene Kanonisierungen im selben Vorgang:
//   - die KETTE haengt an lib/studie-verfassung.js::kanonisch (Python-Form MIT
//     Leerzeichen, ", " und ": ").
//   - der KONZEPTLISTEN-Hash haengt an der F1-Form OHNE Leerzeichen
//     (separators ',' und ':'), so steht es in hashRechenweg.python der Datei
//     und so rechnet tests/studie-f3-konzeptliste.test.js nach.
// Die beiden zu verwechseln ergibt zwei plausible, verschiedene Hashes. Deshalb
// steht die F1-Form hier eigenstaendig und wird nicht aus der Bibliothek geholt.
function kanonischOhneLeerzeichen(wert) {
  if (Array.isArray(wert)) return `[${wert.map(kanonischOhneLeerzeichen).join(',')}]`;
  if (wert && typeof wert === 'object') {
    return `{${Object.keys(wert).sort()
      .map((k) => `${JSON.stringify(k)}:${kanonischOhneLeerzeichen(wert[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(wert);
}

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const lies = (pfad) => JSON.parse(fs.readFileSync(pfad, 'utf8'));

function argument(argv, name) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1 || i === argv.length - 1) return null;
  return argv[i + 1];
}

// Das Register wird mit der Formatierung zurueckgeschrieben, mit der es
// ausgeliefert wurde (ein Leerzeichen Einrueckung). Umformatiert waere es im
// Diff ein Neuschrieb und im Review nicht mehr lesbar.
function schreibeRegister(pfad, register) {
  fs.writeFileSync(pfad, `${JSON.stringify(register, null, 1)}\n`, 'utf8');
}

// ── Die vier fail-closed Tore ─────────────────────────────────────────────────

function pruefeKette(register) {
  return pruefeZugriffsRegister(register);
}

// Getrennt von der Kettenpruefung, und NACH der runId-Pruefung aufgerufen: ein
// zweiter Lauf unter derselben Kennung soll "steht schon im Register" hoeren und
// nicht die unspezifische Meldung ueber das verschobene Kettenende.
function pruefeTail(register, stand) {
  const letzter = (register.events || [])[register.events.length - 1];
  if (!letzter || letzter.runId !== ERWARTETER_LETZTER_RUNID || stand.tailHash !== ERWARTETER_TAIL) {
    throw new VerfassungsBruch(
      `F3b: der juengste Eintrag ist nicht der erwartete. Erwartet ${ERWARTETER_LETZTER_RUNID} `
      + `mit eventHash ${ERWARTETER_TAIL.slice(0, 16)}..., gefunden `
      + `${letzter ? letzter.runId : 'keiner'} mit ${stand.tailHash.slice(0, 16)}.... Ein Eintrag auf `
      + 'einem veralteten oder fremden Kettenende waere nicht mehr korrigierbar.',
    );
  }
  if (stand.eventCount !== ERWARTETE_EVENTS) {
    throw new VerfassungsBruch(
      `F3b: das Register fuehrt ${stand.eventCount} Eintraege, erwartet sind ${ERWARTETE_EVENTS} vor `
      + 'Eintrag 21.',
    );
  }
}

function pruefeKonzeptliste(pfad) {
  const datei = lies(pfad);
  const liste = sha256(kanonischOhneLeerzeichen(datei.konzeptliste));
  if (liste !== KONZEPTLISTE_SHA256) {
    throw new VerfassungsBruch(
      `F3b: die Konzeptliste traegt den Hash ${liste}, erwartet ist ${KONZEPTLISTE_SHA256}. `
      + 'Ein Eintrag wuerde eine Liste beurkunden, die es so nicht gibt.',
    );
  }
  const kontamination = sha256(String(datei.kontaminationsVorgeschichte));
  if (kontamination !== KONTAMINATION_SHA256) {
    throw new VerfassungsBruch(
      `F3b: die Kontaminations-Vorgeschichte traegt den Hash ${kontamination}, erwartet ist `
      + `${KONTAMINATION_SHA256}. Der Eintrag beurkundet Liste UND Vorgeschichte; eine geglaettete `
      + 'Vorgeschichte ist der erste Verlust einer Praeregistrierung.',
    );
  }
  return { liste, kontamination, version: datei.version, status: datei.status };
}

function pruefeRunIdFrei(register, runId) {
  if ((register.events || []).some((e) => e.runId === runId)) {
    throw new VerfassungsBruch(
      `F3b: runId ${runId} steht schon im Register. Nur-Anhaengen heisst auch: keine zweite `
      + 'Anmeldung unter demselben Namen — sonst waere hinterher nicht entscheidbar, welcher '
      + 'Vorgang gemeint war.',
    );
  }
}

// ── Der Eintrag ───────────────────────────────────────────────────────────────

function baueEintrag(runId, registeredAt, wirksamAb, hashes) {
  return {
    runId,
    typ: ART_C0_REGELFREEZE,
    registeredAt,
    accessedAt: wirksamAb,
    fenster: ['kein Studienfenster - Artefakt-Freeze ohne Datenzugriff'],
    allowedOutputs: [],
    erlaubt:
      'Nichts. Dieser Eintrag beurkundet ausschliesslich den eingefrorenen Stand der Konzeptliste '
      + '2.1.0 und autorisiert KEINEN Datenzugriff: kein Panel, keine Lueckenliste, keine E4g-/E4h-'
      + 'Zahlen, keine Studiendaten, kein data/lockbox. Die Zaehlprobe der Verbreiterung (F4) ist ein '
      + 'EIGENER Vorgang und braeuchte Eintrag 22. Das Feld accessedAt bezeichnet hier keinen Zugriff, '
      + 'sondern den fruehesten Zeitpunkt, ab dem der eingefrorene Stand verwendet werden darf; die '
      + 'Art C0_REGELFREEZE verlangt das Feld (lib/studie-verfassung.js, ARTEN_MIT_ZUGRIFFSZEIT).',
    verboten:
      'Jede nachtraegliche Aenderung an der Konzeptliste 2.1.0, an ihrer Kontaminations-Vorgeschichte '
      + 'oder an der Rangordnung nach diesem Hash; jeder Datenzugriff unter dieser runId; jede '
      + 'Berufung auf diesen Eintrag als Autorisierung eines Laufs.',
    begruendung:
      'F3b - Register-Eintrag 21 zur eingefrorenen Konzeptliste der Studie 2.0. '
      + `Konzeptlisten-SHA-256 ${hashes.liste} (Kanonisierung: JSON, Schluessel sortiert, separators `
      + "',' und ':', ensure_ascii=False, UTF-8; identisch mit dem in F1 VOR dem Blick von F2 "
      + 'eingefrorenen Wert). '
      + `Kontaminations-Vorgeschichte-SHA-256 ${hashes.kontamination} - die Liste entsteht in Kenntnis `
      + 'eines gerissenen Tors bei 89,32 % (326/365); der Deckel 330/365 darf nach A18 nicht mehr als '
      + 'Argument gefuehrt werden. '
      + `Herkunft: F2-Rats-Beschluss _RAT-F2-KONZEPTWAHL-2026-08-30.md, SHA-256 ${HERKUNFT_F2_SHA256}; `
      + 'Artefakt protocol/early-detection/2.1.0/konzeptliste.json (F3a, PR #140). '
      + 'DIESER EINTRAG AUTORISIERT KEINEN DATENZUGRIFF - er friert ein Artefakt ein; die '
      + 'F4-Zaehlprobe waere Eintrag 22 mit eigener Anmeldung. '
      + 'Zur Art: C0_REGELFREEZE ist die einzige im Regelwerk vorhandene Art fuer die Anmeldung einer '
      + 'eingefrorenen Auswahlregel ohne Datenfreischaltung. Der Namensteil C0 ist historisch (erste '
      + 'Nutzung in Strang C) und bezeichnet hier keine Zugehoerigkeit zu Strang C. '
      + 'Erzeugt von scripts/studie-f3b-register.js; Ein-Appender-Regel: main-first per Mini-PR, '
      + 'danach Serverbeweis gegen main mit scripts/studie-r1-serverzeit.js bestaetigen.',
    endtestSiegel:
      'unberuehrt - F3 ist eine BLINDE Stufe. Weder das Endtest-Fenster noch das Prueffenster noch '
      + 'Schluesselmaterial werden geoeffnet, gelesen oder gezaehlt.',
  };
}

// ── Ablauf ────────────────────────────────────────────────────────────────────

function haupt(argv) {
  const schreiben = argv.includes('--schreiben');
  const registerPfad = argument(argv, 'register') || LEDGER;
  const konzeptPfad = argument(argv, 'konzeptliste') || KONZEPTLISTE;
  const runId = argument(argv, 'runid') || RUN_ID;

  const jetzt = new Date();
  const anmeldeArg = argument(argv, 'anmeldezeit');
  const registeredAt = anmeldeArg ? new Date(anmeldeArg).toISOString() : jetzt.toISOString();
  if (Date.parse(registeredAt) > jetzt.getTime()) {
    throw new VerfassungsBruch(
      `F3b: --anmeldezeit ${registeredAt} liegt in der Zukunft. Eine vordatierte Anmeldung ist ein `
      + 'Nachher-Protokoll mit Vorsprung.',
    );
  }
  const wirksamAb = argument(argv, 'wirksam-ab')
    ? new Date(argument(argv, 'wirksam-ab')).toISOString()
    : new Date(Date.parse(registeredAt) + VORLAUF_MINUTEN * 60 * 1000).toISOString();
  if (Date.parse(wirksamAb) <= Date.parse(registeredAt)) {
    throw new VerfassungsBruch(
      `F3b: --wirksam-ab (${wirksamAb}) muss NACH der Anmeldung (${registeredAt}) liegen.`,
    );
  }

  const register = lies(registerPfad);
  const stand = pruefeKette(register);
  pruefeRunIdFrei(register, runId);
  pruefeTail(register, stand);
  const hashes = pruefeKonzeptliste(konzeptPfad);

  const eintrag = baueEintrag(runId, registeredAt, wirksamAb, hashes);
  const neu = haengeEintragAn(register, eintrag);
  pruefeZugriffsRegister(neu);
  const fertig = neu.events[neu.events.length - 1];

  process.stdout.write(`${JSON.stringify(fertig, null, 1)}\n\n`);
  process.stdout.write(
    `Konzeptliste ${hashes.version} (${hashes.status}) nachgerechnet: ${hashes.liste}\n`
    + `Kontaminations-Vorgeschichte nachgerechnet: ${hashes.kontamination}\n`
    + `Kettenende vor dem Eintrag: ${ERWARTETER_LETZTER_RUNID} / ${ERWARTETER_TAIL}\n`
    + `PRUEFZEILE: "previousHash": "${fertig.previousHash}"\n`
    + `eventHash Eintrag 21: ${fertig.eventHash}\n`,
  );

  if (!schreiben) {
    process.stdout.write(
      '\nTROCKENLAUF - es wurde NICHTS geschrieben. Der eventHash gilt fuer genau diese '
      + 'registeredAt/accessedAt; ein Lauf mit --schreiben und ohne --anmeldezeit setzt eine neue '
      + 'Anmeldezeit und damit einen anderen Hash. Zum Reproduzieren dieselbe --anmeldezeit und '
      + '--wirksam-ab uebergeben.\n',
    );
    return 0;
  }

  schreibeRegister(registerPfad, neu);
  // Gegenprobe an der Datei, nicht am Speicher: was auf der Platte liegt, muss
  // dieselbe gueltige Kette sein. Ein Formatier- oder Schreibfehler faellt hier.
  const zurueck = lies(registerPfad);
  pruefeZugriffsRegister(zurueck);
  const kontrolle = zurueck.events[zurueck.events.length - 1];
  if (kontrolle.eventHash !== fertig.eventHash) {
    throw new VerfassungsBruch('F3b: der geschriebene Eintrag traegt einen anderen eventHash als der gepruefte');
  }
  process.stdout.write(
    `\nGESCHRIEBEN: ${registerPfad}\n`
    + 'JETZT in dieser Reihenfolge, sie IST die Methodik: committen -> Mini-PR gegen main -> '
    + 'auf main landen lassen -> node scripts/studie-r1-serverzeit.js bestaetigen --runid '
    + `${runId} --ziel <freigabe.json>. Erst danach darf sich irgendein Schritt auf diesen `
    + 'Eintrag berufen.\n',
  );
  return 0;
}

if (require.main === module) {
  try {
    process.exit(haupt(process.argv.slice(2)));
  } catch (fehler) {
    process.stderr.write(`${fehler.message}\n`);
    process.exit(1);
  }
}

module.exports = { baueEintrag, kanonischOhneLeerzeichen, RUN_ID, ERWARTETER_TAIL };
