#!/usr/bin/env node
'use strict';

// Studie 2.0, RR9-A3 Ziffer 2 — Register-Eintrag 22 fuer die Jahrgangs-Registrierung.
//
// DIE SACHE: protocol/early-detection/2.0.0/outcome-access-ledger.json ist
// nur-anhaengend, verkettet und extern bezeugt. Ein falscher Eintrag ist nicht
// korrigierbar, nur ergaenzbar. Deshalb ist der Trockenlauf hier der STANDARD:
// ohne Flagge liest das Werkzeug, prueft die ganze Kette, baut den Eintrag im
// Speicher, rechnet seinen eventHash aus und druckt ihn — und schreibt nichts.
// Erst `--schreiben` haengt an. Es gibt kein --force und keine Reparatur-
// Betriebsart: eine Kette, die nicht durchgeht, ist ein Halt, kein Sonderfall.
// Das ist Zeile fuer Zeile derselbe Weg wie bei Eintrag 21
// (scripts/studie-f3b-register.js) — bewusst, nicht aus Bequemlichkeit: ein
// zweiter Register-Akt unter einem zweiten Verfahren waere ein zweites Verfahren.
//
// WARUM EIN EIGENER EINTRAG 22 UND KEINE ERGAENZUNG VON EINTRAG 21:
// RR9-A3 Ziffer 2 verlangt die Eintragung "im F3b-Eintrag". Der F3b-Eintrag ist
// Eintrag 21 und war zum Zeitpunkt des Urteils bereits geschlossen (PR #142,
// Serverbeweis PR #143); das Urteil fuehrte F3b noch als offen. Ein geschlossener
// Eintrag laesst sich nicht nachtraeglich ergaenzen, ohne die Append-only-
// Disziplin zu brechen — die Kette wuerde bei Eintrag 21 brechen und jeden
// folgenden Eintrag entwerten. Ein eigener Eintrag 22 ist der einzige gangbare
// Weg. Diese Wahl ist NICHT die des Bauenden: sie ist vom Orchestrator getroffen
// (ENTSCHIED 130) und hier nur vollzogen.
//
// WARUM DIE ART `C0_REGELFREEZE`: Das Regelwerk kennt fuenf Eintragsarten
// (lib/studie-verfassung.js). C0_REGELFREEZE ist laut eigener Definition "die
// Anmeldung einer eingefrorenen AUSWAHLREGEL. Sie schaltet keine Ergebnisdaten
// frei ... sie bindet den Hash der Regel an die Serveruhr". Die Jahrgangswahl ist
// genau das: eine Auswahlregel (welcher der zwei lokal vorliegenden Jahrgaenge
// traegt den Bau), eingefroren, ohne einen einzigen Datenzugriff.
// `count_only_probe_authorized` traegt dagegen einen Erlaubnistext ueber
// Zaehlfelder eines Panel-Fensters — dieser Eintrag zaehlt nichts und oeffnet
// kein Fenster. Ein Lauf unter einem Erlaubnistext anzumelden, der ihn nicht
// beschreibt, waere eine Falschanmeldung.
//
// WARUM `accessedAt` GESETZT IST, OBWOHL NICHTS ZUGEGRIFFEN WIRD: Die Art
// C0_REGELFREEZE steht in ARTEN_MIT_ZUGRIFFSZEIT, das Feld ist Pflicht und muss
// nach registeredAt liegen. Es bezeichnet hier — wie bei Eintrag 21 und
// c0-freeze2-2026-08-19 — den fruehesten Zeitpunkt, ab dem der eingefrorene
// Jahrgang VERWENDET werden darf, nicht einen Datenzugriff. Der Eintrag sagt das
// ausdruecklich in `erlaubt`. Es folgt KEIN Zugriffs-Akt auf diesen Eintrag.
//
// EIN-APPENDER-REGEL: protocol/early-detection/2.0.0/register-single-appender-rule.json
// verlangt, dass der Append in einem Commit landet, der direkt auf main geht
// (Mini-PR, NUR die Registerdatei), und dass danach der Serverbeweis gegen main
// laeuft. Dieses Werkzeug erzwingt das nicht per Zweig-Pruefung — es wuerde sonst
// genau den vorgesehenen Mini-PR-Weg blockieren — sondern druckt die Reihenfolge
// als Pflicht-Hinweis. Erzwungen wird sie von lib/ledger-single-appender.js und
// tests/studie-register-single-appender-rule.test.js.
//
// Aufruf:
//   node scripts/studie-rr9-a3-register.js                 # Trockenlauf (Standard)
//   node scripts/studie-rr9-a3-register.js --schreiben     # anhaengen, dann Mini-PR
// Optionen: --runid, --wirksam-ab <ISO>, --anmeldezeit <ISO>,
//           --register <pfad>, --jahrgang <pfad>   (die beiden Pfade nur fuer Tests)

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { writeFileAtomic } = require('../lib/atomic-write.js');
const {
  VerfassungsBruch,
  haengeEintragAn,
  pruefeZugriffsRegister,
  ART_C0_REGELFREEZE,
} = require('../lib/studie-verfassung');

const WURZEL = path.join(__dirname, '..');
const LEDGER = path.join(WURZEL, 'protocol', 'early-detection', '2.0.0', 'outcome-access-ledger.json');
const JAHRGANG = path.join(
  WURZEL, 'protocol', 'early-detection', '2.1.0', 'jahrgang-registrierung-2026-08-30.json',
);

// Sollwerte, hier UNABHAENGIG von den geprueften Dateien notiert. Ein Werkzeug,
// das seine Sollwerte aus der Datei liest, die es pruefen soll, prueft nichts.
const RUN_ID = 'rr9-a3-jahrgang-registrierung-2026-08-30';
const ERWARTETER_LETZTER_RUNID = 'f3-konzeptliste-freeze-2026-08-30';
const ERWARTETER_TAIL = '9f32e5928acf36d147b4179357a59665d5e05163c90199d2387232f795aa6ad2';
const ERWARTETE_EVENTS = 21;
// Der Hash ueber den INHALTS-Block (die Groesse, die das Artefakt selbst fuehrt
// und die der Bericht des Bremsen-Baus zitiert) …
const INHALT_SHA256 = '0363702f5aa6fd486a6901aecaef3108f81828248657bcfb455b6a4ae413c567';
// … und der Hash ueber die DATEIBYTES. Beide, weil sie verschiedene Dinge
// binden: der erste die Aussage, der zweite das Artefakt am Pfad. Ein Artefakt
// mit gleichem `inhalt` und umgeschriebenem `registerHinweis` faellt nur am
// zweiten auf.
const DATEI_SHA256 = 'aa4277fa9f39f38b3d1ffa4f9048d76f33e2515aa64afa021165d7895cb6074f';
const JAHRGANG_REL = 'protocol/early-detection/2.1.0/jahrgang-registrierung-2026-08-30.json';
// Der eine Jahrgang. Steht hier als Konstante, damit der Eintrag nicht das
// beurkundet, was gerade in der Datei steht.
const JAHRGANG_WERT = 'legacy_earliest_archived';

// Vorlauf zwischen Anmeldung und Wirksamkeit. Dazwischen muessen Mini-PR und
// Serverbeweis passen; zu knapp waere eine Anmeldung, die sich selbst ueberholt.
const VORLAUF_MINUTEN = 120;

// Die Kanonisierung des `inhalt`-Blocks ist die PYTHON-Form OHNE Leerzeichen
// (json.dumps(..., sort_keys=True, separators=(',', ':'), ensure_ascii=False)),
// weil scripts/studie-rr9-nullpunkt.py::jahrgangs_registrierung sie so rechnet.
// Sie mit der Kettenform aus lib/studie-verfassung.js zu verwechseln ergibt zwei
// plausible, verschiedene Hashes — deshalb steht sie hier eigenstaendig.
// JSON.stringify escapt Nicht-ASCII nicht; das entspricht ensure_ascii=False.
// Der Block ist ohnehin reines ASCII, der Test pinnt das.
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
//
// UND ATOMAR, ueber lib/atomic-write.js: ein direktes writeFileSync auf ein
// nur-anhaengendes, verkettetes Register laesst bei einem Abbruch mitten im
// Schreiben (Platte voll, Kill, Stromausfall, OneDrive-/AV-Sperre) eine halbe,
// ungueltige Datei zurueck - und dafuer gibt es keinen Reparaturweg im Werkzeug,
// nur `git checkout`. Der naechste Lauf saehe einen rohen SyntaxError aus
// JSON.parse.
//
// KORREKTUR ZUM CODE-REVIEW 30.08.: die erste Fassung dieser Stelle baute
// tmp+rename HIER nach. Das war ein zweiter Eigenbau neben lib/atomic-write.js,
// das seit Tag 189 im Repo liegt und von ~20 Aufrufern benutzt wird - und der
// Eigenbau konnte weniger: kein fsync der tmp-Datei vor dem Umbenennen (ein
// Stromausfall zwischen Schreiben und rename liefert eine leere Datei), keine
// Wiederholung des rename unter Windows-EPERM/EBUSY (OneDrive und AV halten
// Handles auf genau solche Dateien), kein fsync des Verzeichnisses, keine
// Schleife ueber Teilschreibvorgaenge. Zwei Kopien derselben Regel driften;
// eine nicht. Deshalb steht die Regel jetzt nur noch an EINER Stelle.
function schreibeRegister(pfad, register) {
  writeFileAtomic(pfad, `${JSON.stringify(register, null, 1)}\n`, 'utf8');
}

// ── Die vier fail-closed Tore ─────────────────────────────────────────────────

// Getrennt von der Kettenpruefung, und NACH der runId-Pruefung aufgerufen: ein
// zweiter Lauf unter derselben Kennung soll "steht schon im Register" hoeren und
// nicht die unspezifische Meldung ueber das verschobene Kettenende.
function pruefeTail(register, stand) {
  const letzter = (register.events || [])[register.events.length - 1];
  if (!letzter || letzter.runId !== ERWARTETER_LETZTER_RUNID || stand.tailHash !== ERWARTETER_TAIL) {
    throw new VerfassungsBruch(
      `RR9-A3: der juengste Eintrag ist nicht der erwartete. Erwartet ${ERWARTETER_LETZTER_RUNID} `
      + `mit eventHash ${ERWARTETER_TAIL.slice(0, 16)}..., gefunden `
      + `${letzter ? letzter.runId : 'keiner'} mit ${stand.tailHash.slice(0, 16)}.... Ein Eintrag auf `
      + 'einem veralteten oder fremden Kettenende waere nicht mehr korrigierbar.',
    );
  }
  if (stand.eventCount !== ERWARTETE_EVENTS) {
    throw new VerfassungsBruch(
      `RR9-A3: das Register fuehrt ${stand.eventCount} Eintraege, erwartet sind ${ERWARTETE_EVENTS} `
      + 'vor Eintrag 22.',
    );
  }
}

// Das inhaltliche Tor. Es prueft NICHT nur Hashes, sondern auch, dass der
// Registrierungs-Gegenstand der ist, den RR9-A3 beschreibt: EIN Jahrgang,
// gewaehlt = gemessen, keine Eskalation. Waere eines davon anders, waere dieser
// Eintrag der falsche Vorgang — RR9-A3 Ziffer 6 schickt den Fall dann an den
// vollen Rat, nicht ins Register.
// REIHENFOLGE DER TORE, absichtlich so und nicht andersherum: die INHALTLICHEN
// Tore stehen VOR den beiden Hash-Toren. Andersherum waeren sie unerreichbar —
// jede Aenderung am Artefakt bricht zuerst den Datei-Hash, und die inhaltlichen
// Zweige koennten nie feuern. Genau die Fehlklasse, die RR9-A4 benennt (ein
// Zweig, der aus Versehen nie erreichbar ist, ist kein Zweig). Der Datei-Hash
// bleibt trotzdem das letzte, schaerfste Tor: er faengt auch das Artefakt, dessen
// `inhalt` stimmt und dessen Begleittext umgeschrieben wurde.
function pruefeJahrgang(pfad) {
  // EINE Lesung, zwei Hashes. Vorher las diese Funktion die Datei zweimal —
  // einmal geparst fuer die Inhalts-Pruefungen, einmal roh fuer den Datei-Hash.
  // Nichts band die beiden Lesungen an dieselben Bytes, und damit war die
  // Eigenschaft, die der Kommentar oben verspricht ("faellt nur am zweiten
  // auf"), nicht garantiert. Code-Review 30.08.
  const rohbytes = fs.readFileSync(pfad);
  const datei = JSON.parse(rohbytes.toString('utf8'));
  const { gewaehlterJahrgang: gewaehlt, gemessenerJahrgangDerBasis: gemessen } = datei.inhalt || {};
  if (gewaehlt !== JAHRGANG_WERT || gemessen !== JAHRGANG_WERT) {
    throw new VerfassungsBruch(
      `RR9-A3: gewaehlt ${JSON.stringify(gewaehlt)} / gemessen ${JSON.stringify(gemessen)}, `
      + `registriert wird ${JSON.stringify(JAHRGANG_WERT)}.`,
    );
  }
  if (datei.inhalt.weichenBeideVoneinanderAb !== false) {
    throw new VerfassungsBruch(
      'RR9-A3: gewaehlter und gemessener Jahrgang weichen voneinander ab. Dann greift A2 Satz 3 '
      + '(Zitierverbot der 89,32 %) und der Eintrag braucht diese Zeile - er wird hier NICHT '
      + 'blind geschrieben.',
    );
  }
  if (!String(datei.eskalationNachZiffer6 || '').startsWith('NICHT EINGETRETEN')) {
    throw new VerfassungsBruch(
      'RR9-A3 Ziffer 6: die Eskalation ist eingetreten - die Jahrgangsfrage ist dann eine Weiche '
      + 'und geht an den vollen Rat, nicht in einen Register-Eintrag.',
    );
  }
  // Zwei Rechenwege auf dasselbe Ergebnis; nur so faellt eine gepflegte
  // Behauptung auf, die nur das Hash-Feld verstellt.
  const inhalt = sha256(kanonischOhneLeerzeichen(datei.inhalt));
  if (datei.inhaltSha256 !== inhalt) {
    throw new VerfassungsBruch(
      `RR9-A3: das Artefakt fuehrt inhaltSha256 ${datei.inhaltSha256}, nachgerechnet ist `
      + `${inhalt}. Die Datei widerspricht sich selbst.`,
    );
  }
  if (inhalt !== INHALT_SHA256) {
    throw new VerfassungsBruch(
      `RR9-A3: der Inhalts-Block hasht auf ${inhalt}, erwartet ist ${INHALT_SHA256}.`,
    );
  }
  const dateiHash = crypto.createHash('sha256').update(rohbytes).digest('hex');
  if (dateiHash !== DATEI_SHA256) {
    throw new VerfassungsBruch(
      `RR9-A3: ${JAHRGANG_REL} traegt sha256 ${dateiHash}, registriert ist ${DATEI_SHA256}. `
      + 'Der Eintrag wuerde ein Artefakt beurkunden, das es so nicht gibt.',
    );
  }
  return { dateiHash, inhalt, jahrgang: gewaehlt };
}

function pruefeRunIdFrei(register, runId) {
  if ((register.events || []).some((e) => e.runId === runId)) {
    throw new VerfassungsBruch(
      `RR9-A3: runId ${runId} steht schon im Register. Nur-Anhaengen heisst auch: keine zweite `
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
    fenster: ['kein Studienfenster - Jahrgangs-Freeze ohne Datenzugriff'],
    allowedOutputs: [],
    erlaubt:
      'Nichts. Dieser Eintrag friert die Jahrgangswahl der Studie 2.0 ein und autorisiert KEINEN '
      + 'Datenzugriff: kein Panel, keine Lueckenliste, keine E4g-/E4h-Zahlen, keine Studiendaten, '
      + 'kein data/lockbox. Die Zaehlprobe der Verbreiterung (F4) ist unveraendert ein EIGENER '
      + 'Vorgang und braeuchte einen eigenen Eintrag (jetzt 23). Das Feld accessedAt bezeichnet '
      + 'hier keinen Zugriff, sondern den fruehesten Zeitpunkt, ab dem der eingefrorene Jahrgang '
      + 'verwendet werden darf; die Art C0_REGELFREEZE verlangt das Feld (lib/studie-verfassung.js, '
      + 'ARTEN_MIT_ZUGRIFFSZEIT). Auf diesen Eintrag folgt KEIN Zugriffs-Akt.',
    verboten:
      'Jede zweite Jahrgangswahl (RR9-A3 Ziffer 5: genau EINE; ein Bau unter dem anderen Jahrgang '
      + 'ist ausschliesslich als praeregistrierte R6-Sensitivitaet zulaessig, nie als zweiter '
      + 'Torlauf); jede nachtraegliche Aenderung am Artefakt oder an seinen Hashes nach diesem '
      + 'Eintrag; jeder Datenzugriff unter dieser runId; jede Berufung auf diesen Eintrag als '
      + 'Autorisierung eines Laufs; jede Verwendung dieses Eintrags als F4-Freigabe.',
    begruendung:
      'RR9-A3 Ziffer 2 und 3 - Register-Eintrag 22 zur Jahrgangs-Registrierung der Studie 2.0. '
      + `Gewaehlter Jahrgang ${hashes.jahrgang} (Herkunft scripts/studie-panel-bau.py::VARIANTE); `
      + `gemessener Jahrgang der 89,32-%-Basis ${hashes.jahrgang} (Herkunft `
      + 'reports/studie/E1-panel-bau-2026-08-19.json::variante, 64/64 Payloads, Protokoll '
      + 'FEM-SEC-US@2.0.0, panel-validierung.sqlite 4.447.633.408 B byte-gleich zur Platte). '
      + `Artefakt ${JAHRGANG_REL}, inhaltSha256 ${hashes.inhalt} (Kanonisierung: JSON, Schluessel `
      + "sortiert, separators ',' und ':', ensure_ascii=False, UTF-8), Datei-SHA-256 "
      + `${hashes.dateiHash}; auf main seit PR #155. `
      + 'A2 Satz 3 (Zitierverbot der 89,32 %) NICHT AUSGELOEST: gewaehlter und gemessener Jahrgang '
      + 'sind identisch; das Verbot bleibt woertlich in Kraft, es feuert hier nur nicht. '
      + 'RR9-A3 Ziffer 6 (Eskalation an den vollen Rat) NICHT EINGETRETEN: die Provenienz ist '
      + 'eindeutig und zeigt nicht post_2024_reprocessed_or_current; S1s Dissens D6 lebt nicht auf. '
      + 'RR9-A3 Ziffer 4 (Tripwire "kein Payload ohne Jahrgangs-Kennzeichen") steht scharf in '
      + 'scripts/studie-panel-bau.py::payload_liste und war einmal absichtlich rot; gemessen ueber '
      + 'alle 358 Beobachtungs-Records: 0 Payloads ohne Kennzeichen (die im Urteil genannten 50 '
      + 'sind die dritte, benannte Variante archived_digest_revision). '
      + 'WARUM EIGENER EINTRAG 22 STATT ERGAENZUNG VON EINTRAG 21: RR9-A3 Ziffer 2 verlangt die '
      + 'Eintragung im F3b-Eintrag; der ist Eintrag 21 und war zum Urteilszeitpunkt bereits '
      + 'geschlossen (PR #142, Serverbeweis PR #143), waehrend das Urteil F3b noch als offen '
      + 'fuehrte. Eine nachtraegliche Ergaenzung wuerde die Kette bei Eintrag 21 brechen. Die Wahl '
      + 'des eigenen Eintrags ist vom Orchestrator getroffen (ENTSCHIED 130, 2026-08-30), nicht vom '
      + 'Bauenden ausgelegt. '
      + 'NACHTRAG ZU RR9-A2 ZIFFER 2, VORAB und an der vom Urteil verlangten Stelle: die '
      + 'Nullpunkt-Reproduktion (Ziel 292/438, S-U, umsatzQuellenAllowlist - so entschieden in '
      + 'ENTSCHIED 130) verbraucht KEINE Einheit des K2-Kontingents, weil kein neuer Wert entsteht, '
      + 'sondern ein registrierter und bereits veroeffentlichter reproduziert wird '
      + '(reports/studie/E3-zaehlprobe-pruefung-2026-08-19.json). Sie oeffnet ausserdem KEIN '
      + 'Panel-Fenster: gerechnet wird auf dem gespeicherten Zwischenstand des bereits '
      + 'angemeldeten E3-Laufs, nicht auf panel-validierung.sqlite. Dieser Eintrag autorisiert sie '
      + 'nicht - er haelt fest, dass sie keine Autorisierung braucht. '
      + 'DIESER EINTRAG AUTORISIERT KEINEN DATENZUGRIFF. F4, F5, F5b und F6 bleiben gesperrt. '
      + 'Zur Art: C0_REGELFREEZE ist die einzige im Regelwerk vorhandene Art fuer die Anmeldung '
      + 'einer eingefrorenen Auswahlregel ohne Datenfreischaltung; der Namensteil C0 ist historisch '
      + '(erste Nutzung in Strang C) und bezeichnet hier keine Zugehoerigkeit zu Strang C. '
      + 'Erzeugt von scripts/studie-rr9-a3-register.js; Ein-Appender-Regel: main-first per '
      + 'Mini-PR (nur die Registerdatei), danach Serverbeweis gegen main mit '
      + 'scripts/studie-r1-serverzeit.js bestaetigen.',
    endtestSiegel:
      'unberuehrt - die Jahrgangswahl ist eine BLINDE Entscheidung ueber die Herkunft der '
      + 'Rohdaten. Weder das Endtest-Fenster noch das Prueffenster noch Schluesselmaterial werden '
      + 'geoeffnet, gelesen oder gezaehlt.',
  };
}

// ── Ablauf ────────────────────────────────────────────────────────────────────

function haupt(argv) {
  const schreiben = argv.includes('--schreiben');
  const registerPfad = argument(argv, 'register') || LEDGER;
  const jahrgangPfad = argument(argv, 'jahrgang') || JAHRGANG;
  const runId = argument(argv, 'runid') || RUN_ID;

  const jetzt = new Date();
  const anmeldeArg = argument(argv, 'anmeldezeit');
  const registeredAt = anmeldeArg ? new Date(anmeldeArg).toISOString() : jetzt.toISOString();
  if (Date.parse(registeredAt) > jetzt.getTime()) {
    throw new VerfassungsBruch(
      `RR9-A3: --anmeldezeit ${registeredAt} liegt in der Zukunft. Eine vordatierte Anmeldung ist `
      + 'ein Nachher-Protokoll mit Vorsprung.',
    );
  }
  const wirksamAb = argument(argv, 'wirksam-ab')
    ? new Date(argument(argv, 'wirksam-ab')).toISOString()
    : new Date(Date.parse(registeredAt) + VORLAUF_MINUTEN * 60 * 1000).toISOString();
  if (Date.parse(wirksamAb) <= Date.parse(registeredAt)) {
    throw new VerfassungsBruch(
      `RR9-A3: --wirksam-ab (${wirksamAb}) muss NACH der Anmeldung (${registeredAt}) liegen.`,
    );
  }

  const register = lies(registerPfad);
  const stand = pruefeZugriffsRegister(register);
  pruefeRunIdFrei(register, runId);
  pruefeTail(register, stand);
  const hashes = pruefeJahrgang(jahrgangPfad);

  const eintrag = baueEintrag(runId, registeredAt, wirksamAb, hashes);
  const neu = haengeEintragAn(register, eintrag);
  pruefeZugriffsRegister(neu);
  const fertig = neu.events[neu.events.length - 1];

  process.stdout.write(`${JSON.stringify(fertig, null, 1)}\n\n`);
  process.stdout.write(
    `Jahrgang nachgerechnet: ${hashes.jahrgang}\n`
    + `Inhalts-SHA-256 nachgerechnet: ${hashes.inhalt}\n`
    + `Datei-SHA-256 nachgerechnet:   ${hashes.dateiHash}\n`
    + `Kettenende vor dem Eintrag: ${ERWARTETER_LETZTER_RUNID} / ${ERWARTETER_TAIL}\n`
    + `PRUEFZEILE: "previousHash": "${fertig.previousHash}"\n`
    + `eventHash Eintrag 22: ${fertig.eventHash}\n`,
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
    // Wenn das je feuert, ist das Register auf der Platte BEREITS veraendert —
    // mit einem Stand, den dieses Werkzeug gerade fuer nicht vertrauenswuerdig
    // erklaert hat. Die generische Meldung liess das wie einen normalen Abbruch
    // aussehen. Sie muss sagen, was zu tun ist, nicht nur, was falsch ist.
    throw new VerfassungsBruch(
      'RR9-A3 — HALT, NICHT ERNEUT AUSFUEHREN: das Register auf der Platte traegt jetzt einen '
      + `anderen eventHash (${kontrolle.eventHash}) als der geprueft gebaute (${fertig.eventHash}). `
      + 'Die Datei ist bereits geschrieben und weicht vom verifizierten Stand ab. Ein zweiter Lauf '
      + 'wuerde darauf aufsetzen. Zuerst von Hand pruefen und den Stand aus der Git-Historie '
      + `wiederherstellen (${registerPfad}), dann erst weiter.`,
    );
  }
  process.stdout.write(
    `\nGESCHRIEBEN: ${registerPfad}\n`
    + 'JETZT in dieser Reihenfolge, sie IST die Methodik: committen (NUR die Registerdatei) -> '
    + 'Mini-PR gegen main -> auf main landen lassen -> node scripts/studie-r1-serverzeit.js '
    + `bestaetigen --runid ${runId} --ziel <freigabe.json>. Es folgt KEIN Zugriffs-Akt: dieser `
    + 'Eintrag friert eine Regel ein, er schaltet nichts frei.\n',
  );
  return 0;
}

if (require.main === module) {
  try {
    process.exit(haupt(process.argv.slice(2)));
  } catch (fehler) {
    // Ein VerfassungsBruch IST seine Meldung. Alles andere ist ein Fehler im
    // Werkzeug selbst — und dann ist der Stack das Einzige, was jemandem sagt,
    // WO es brach. Ihn wegzuwerfen macht aus einem lauten Fehler einen stummen.
    process.stderr.write(
      `${fehler instanceof VerfassungsBruch ? fehler.message : (fehler.stack || String(fehler))}\n`,
    );
    process.exit(1);
  }
}

module.exports = {
  baueEintrag, kanonischOhneLeerzeichen, RUN_ID, ERWARTETER_TAIL, INHALT_SHA256, DATEI_SHA256,
};
