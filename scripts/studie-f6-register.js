#!/usr/bin/env node
'use strict';

// Studie 2.0, F6-Tor — Register-Eintrag 23: der Freeze-Akt ueber den vier
// Groessen, die das F6-Tor tragen (VB-A11 / ENTSCHIED 133).
//
// DIE SACHE: protocol/early-detection/2.0.0/outcome-access-ledger.json ist
// nur-anhaengend, verkettet und extern bezeugt. Ein falscher Eintrag ist nicht
// korrigierbar, nur ergaenzbar. Deshalb ist der Trockenlauf hier der STANDARD:
// ohne Flagge liest das Werkzeug, prueft die ganze Kette, baut den Eintrag im
// Speicher, rechnet seinen eventHash aus und druckt ihn — und schreibt nichts.
// Erst `--schreiben` haengt an. Es gibt kein --force und keine Reparatur-
// Betriebsart. Zeile fuer Zeile derselbe Weg wie bei Eintrag 21 und 22
// (scripts/studie-f3b-register.js, scripts/studie-rr9-a3-register.js) — ein
// zweiter Register-Akt unter einem zweiten Verfahren waere ein zweites Verfahren.
//
// WARUM DIESER EINTRAG EIN FREEZE IST UND NICHT DER LAUF SELBST. Der Entwurf
// vom 30.08. sprach vom "EINEN F6-Tor-Akt". Die Verfassung laesst das nicht in
// EINEN Eintrag:
//   (1) C0_REGELFREEZE "schaltet keine Ergebnisdaten frei" (lib/studie-verfassung.js)
//       — ein Freeze kann den konfirmatorischen Lauf nicht autorisieren.
//   (2) Die Register-Regel verlangt fuer jeden Lauf, der Ergebnisdaten liest,
//       ausdruecklich die Art `confirmatory_execution_authorized` (R4).
//   (3) VB-A11 verlangt den Freeze server-bestaetigt VOR jedem Zugriff auf
//       Lueckenliste oder Prueffenster. Ein Eintrag, der zugleich einfriert und
//       den Zugriff oeffnet, kann nicht vor sich selbst server-bestaetigt sein.
// Also: Eintrag 23 friert (hier), Serverbeweis, DANN Eintrag 24 autorisiert den
// EINEN Lauf. Das ist keine Wahl zwischen zwei gangbaren Wegen — der
// Ein-Eintrag-Weg waere eine Falschanmeldung unter einer Art, die den Vorgang
// nicht beschreibt. Entscheid des Tages-Orchestrators, 2026-08-31.
//
// ALLE SOLLWERTE UNTEN SIND GEGEN origin/main NACHGERECHNET, nicht aus dem
// Entwurfsdokument uebernommen. Zwei Werte des Entwurfs waren falsch (der
// Werkzeug-Hash und der Datei-Hash des Freeze-Artefakts); sie existieren in
// keinem Commit dieses Repos. Stehender Satz daraus: ein Entwurf zitiert Hashes
// nur als Pruefauftrag, nie als Quelle.
//
// Aufruf:
//   node scripts/studie-f6-register.js                 # Trockenlauf (Standard)
//   node scripts/studie-f6-register.js --schreiben     # anhaengen, dann Mini-PR
// Optionen: --runid, --wirksam-ab <ISO>, --anmeldezeit <ISO>,
//           --register <pfad>, --schwellen <pfad>, --band <pfad>, --anker <pfad>
//           (die Pfade nur fuer Tests)

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

// Sollwerte, hier UNABHAENGIG von den geprueften Dateien notiert. Ein Werkzeug,
// das seine Sollwerte aus der Datei liest, die es pruefen soll, prueft nichts.
const RUN_ID = 'f6-tor-freeze-2026-08-31';
const ERWARTETER_LETZTER_RUNID = 'rr9-a3-jahrgang-registrierung-2026-08-30';
const ERWARTETER_TAIL = 'b2129042a2dd0f480a0b056445c1a651a37573fe67d7d43c940bba38e00df502';
const ERWARTETE_EVENTS = 22;

// Pin 1 — der Schwellen-Satz. inhaltSha256 deckt alle Felder OHNE sich selbst.
const SCHWELLEN_REL = 'protocol/early-detection/2.1.0/e2-schwellen-satz-2026-08-30.json';
const SCHWELLEN_INHALT_SHA256 = 'c4a888906e4cb26a1a4994c54fc34b89c068e40646a800d3d07c7051308b2bee';
const SCHWELLEN_DATEI_SHA256 = '80798025d2ad6387b3ed72048227112426369ec8392ae633a92df58f0cf4d1e5';

// Pin 2 — die E2-Regel IST das versiegelte Modul; das Auslese-Werkzeug geht als
// Werkzeug-Nachweis mit, nicht als zweite Regel.
const MODUL_REL = 'scripts/studie-basisraten.py';
const MODUL_SHA256 = '997a80d26871937f848b3eea76a9b4ba1a4e1c76f1cc3c30db98d7888ec2601d';
const WERKZEUG_REL = 'scripts/studie-e2-verbreitert.py';
const WERKZEUG_SHA256 = '9a24ed94e943e9a6f5b4a1373ba6c6aa2001ddadb2d60a705277bf5eb359984b';

// Pin 3 — die endgueltige Klumpungseinheit. Wortlaut, nicht Sinngemaesses: der
// Eintrag beurkundet die Zeichenkette, die das Band-Artefakt fuehrt.
const BAND_REL = 'protocol/early-detection/2.1.0/b4-bandregel-2026-08-30.json';
const BAND_INHALT_SHA256 = '1fd6a9f3ceb6dab0076c6812f57483889708345d6a87c6103a7515689cf8c46e';
const BAND_DATEI_SHA256 = 'd9c5990ad403b6baca2e3a4228218af0b73367e4f51ffd213ac654fc41cdc5da';
const KLUMPUNGSEINHEIT = 'Klumpung nach Signal-Entitaet (Firma)';

// WARUM PIN 4 AM 31.08. NEU GESETZT WURDE (und nicht "repariert" gehoert):
// Eintrag 23 verankert die VB-A6-Nutzlast. Damit wurde die Selbstpruefung IM
// verankerten Waechter (studie-rr9-nullpunkt.py, frueher: "der Sollwert ist
// heute NICHT register-verankert") falsch - sie behauptete einen ZEITPUNKT
// statt einer Invariante und waere in dem Moment rot geworden, in dem der
// Eintrag planmaessig gelingt. Ein Ringschluss: der Eintrag pinnt die Datei,
// deren Inhalt der Eintrag widerlegt. Der Waechter wurde deshalb VOR dem
// Eintrag auf die Invariante umgestellt (beide Richtungen am Fixture-Register
// geprueft), sein sha256 hat sich dadurch geaendert, und das Anker-Artefakt
// wurde neu erzeugt statt ueberschrieben. Die 30.08.-Fassung bleibt liegen.
// Pin 4 — die VB-A6-Nutzlast. Der Sollwert ist die registrierte Praeregistrierung;
// die Luecke ist, dass die WAECHTER-DATEI in keinem Manifest-Tripel und in keinem
// Register-Eintrag steht. Genau das holt dieser Eintrag nach.
const ANKER_REL = 'reports/studie/VB-A6-registeranker-2026-08-31.json';
const ANKER_DATEI_SHA256 = '66583d81cd347069d6222e715f1e625d7d651e9ac90d909732aa509ee6970df6';
const PRAEREG_SHA256 = '799f925142860b4db97b5f18894b62c749aeb014872279aa6a7df8ee99ac5a6c';
const WAECHTER_REL = 'scripts/studie-rr9-nullpunkt.py';
const WAECHTER_SHA256 = '74892dd01b0a0b019216cedbd9d183475a72d4fe70c4fe3bf87c39c5908c4338';

// Die Vorgabe-Pfade werden AUS den registrierten Kennungen gebaut, nicht daneben
// noch einmal getippt. Vorher standen beide Fassungen unabhaengig im Kopf der
// Datei - und genau das ist am 31.08. auseinandergelaufen: der Pin zeigte auf das
// neue Anker-Artefakt, der Vorgabe-Pfad noch auf das alte, und der Trockenlauf
// meldete einen Hash-Widerspruch, den es gar nicht gab.
const relPfad = (rel) => path.join(WURZEL, ...rel.split('/'));
const SCHWELLEN = relPfad(SCHWELLEN_REL);
const BAND = relPfad(BAND_REL);
const ANKER = relPfad(ANKER_REL);

// Vorlauf zwischen Anmeldung und Wirksamkeit. Dazwischen muessen Mini-PR und
// Serverbeweis passen; zu knapp waere eine Anmeldung, die sich selbst ueberholt.
const VORLAUF_MINUTEN = 120;

// WARUM DIESES WERKZEUG DIE BEIDEN inhaltSha256 NICHT IN JAVASCRIPT NACHRECHNET
// — und warum das keine Nachlaessigkeit ist, sondern die Korrektur einer:
//
// Die Kanonisierung beider Artefakte ist PYTHON-definiert
// (json.dumps(..., sort_keys=True, separators=(',', ':'), ensure_ascii=False)).
// Die erste Fassung dieser Datei baute sie in JS nach — und lag falsch. Python
// schreibt fuer den Wert `2.0` aus `regelParameter.g_deckel` wieder `2.0`,
// JavaScript kennt den Unterschied zwischen 2 und 2.0 nicht und schreibt `2`.
// Ergebnis: eine Abweichung von zwei Bytes, ein voellig anderer Hash und die
// Meldung "die Datei widerspricht sich selbst" ueber einem Artefakt, das
// vollkommen in Ordnung ist. Ein Waechter, der bei intakten Daten rot wird, wird
// abgeschaltet — er ist schaedlicher als keiner.
//
// Zwei Kopien derselben Regel driften; eine nicht. Die Regel bleibt deshalb dort,
// wo das Artefakt entsteht (Python), und dieses Werkzeug bindet stattdessen die
// beiden Groessen, die es OHNE zweite Implementierung pruefen kann:
//   (a) den AUSGEWIESENEN inhaltSha256 gegen die hier registrierte Konstante,
//   (b) den SHA-256 ueber die DATEIBYTES gegen die hier registrierte Konstante.
// Das ist nicht schwaecher: eine Datei, deren Inhalt sich aendert, faellt an (b);
// eine Datei, die nur ihr Hash-Feld verstellt, faellt ebenfalls an (b). Die
// dritte Denkmoeglichkeit — Inhalt und Hash-Feld konsistent geaendert — faellt
// erst recht an (b).
// Die unabhaengige Nachrechnung der Kanonisierung ist am 31.08. mit den
// Eigen-Werkzeugen der Artefakte erfolgt (python-Nachbau fuer den Schwellen-Satz,
// `studie-vb-b4-band.py hash` fuer die Bandregel) und im Tagesbericht belegt.
//
// ZWEI ARTEFAKTE, ZWEI GELTUNGSBEREICHE, weil es beim naechsten Leser sonst
// wieder knallt: der Schwellen-Satz hasht ALLE Felder ausser `inhaltSha256`, das
// Band-Artefakt hasht seinen `inhalt`-TEILBAUM. Wer den einen Geltungsbereich
// auf das andere Artefakt anwendet, bekommt eine saubere Abweichung, die nach
// Manipulation aussieht und keine ist. (Auch dieser Fehlalarm ist beim
// Frisch-Augen-Review am 31.08. einmal entstanden.)

const lies = (pfad) => JSON.parse(fs.readFileSync(pfad, 'utf8'));

function argument(argv, name) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1 || i === argv.length - 1) return null;
  return argv[i + 1];
}

function schreibeRegister(pfad, register) {
  writeFileAtomic(pfad, `${JSON.stringify(register, null, 1)}\n`, 'utf8');
}

// -- Die Tore -----------------------------------------------------------------
// REIHENFOLGE, absichtlich so: die INHALTLICHEN Tore stehen VOR den Hash-Toren.
// Andersherum waeren sie unerreichbar — jede Aenderung am Artefakt bricht zuerst
// den Datei-Hash, und die inhaltlichen Zweige koennten nie feuern (RR9-A4: ein
// Zweig, der aus Versehen nie erreichbar ist, ist kein Zweig).

function pruefeTail(register, stand) {
  const letzter = (register.events || [])[register.events.length - 1];
  if (!letzter || letzter.runId !== ERWARTETER_LETZTER_RUNID || stand.tailHash !== ERWARTETER_TAIL) {
    throw new VerfassungsBruch(
      `F6: der juengste Eintrag ist nicht der erwartete. Erwartet ${ERWARTETER_LETZTER_RUNID} mit `
      + `eventHash ${ERWARTETER_TAIL.slice(0, 16)}..., gefunden `
      + `${letzter ? letzter.runId : 'keiner'} mit ${stand.tailHash.slice(0, 16)}.... Ein Eintrag `
      + 'auf einem veralteten oder fremden Kettenende waere nicht mehr korrigierbar.',
    );
  }
  if (stand.eventCount !== ERWARTETE_EVENTS) {
    throw new VerfassungsBruch(
      `F6: das Register fuehrt ${stand.eventCount} Eintraege, erwartet sind ${ERWARTETE_EVENTS} `
      + 'vor Eintrag 23.',
    );
  }
}

function pruefeRunIdFrei(register, runId) {
  if ((register.events || []).some((e) => e.runId === runId)) {
    throw new VerfassungsBruch(
      `F6: runId ${runId} steht schon im Register. Nur-Anhaengen heisst auch: keine zweite `
      + 'Anmeldung unter demselben Namen — sonst waere hinterher nicht entscheidbar, welcher '
      + 'Vorgang gemeint war.',
    );
  }
}

// EINE Lesung, zwei Hashes. Zwei Lesungen waeren durch nichts an dieselben Bytes
// gebunden, und damit waere die Eigenschaft "der Datei-Hash faengt auch das
// Artefakt mit gleichem Inhalt und umgeschriebenem Begleittext" nicht garantiert.
function liesEinmal(pfad) {
  const rohbytes = fs.readFileSync(pfad);
  return {
    rohbytes,
    datei: JSON.parse(rohbytes.toString('utf8')),
    dateiHash: crypto.createHash('sha256').update(rohbytes).digest('hex'),
  };
}

function pruefeSchwellenSatz(pfad) {
  const { datei, dateiHash } = liesEinmal(pfad);

  if (datei.grundlage && datei.grundlage.fassung !== 'verbreitertOhneBank') {
    throw new VerfassungsBruch(
      `F6 Pin 1: der Schwellen-Satz steht auf Fassung ${JSON.stringify(datei.grundlage.fassung)}, `
      + 'eingefroren wird ausschliesslich verbreitertOhneBank (ENTSCHIED 150). Eine andere Fassung '
      + 'waere eine zweite Ableitung und keine Auslese.',
    );
  }
  const prov = datei.provenienz || {};
  if (prov.versiegeltesModul !== MODUL_REL || prov.modulSha256 !== MODUL_SHA256) {
    throw new VerfassungsBruch(
      `F6 Pin 1/2: der Satz nennt als versiegeltes Modul ${JSON.stringify(prov.versiegeltesModul)} `
      + `mit ${prov.modulSha256}; registriert wird ${MODUL_REL} mit ${MODUL_SHA256}. Die E2-Regel `
      + 'IST dieses Modul — ein anderer Hash ist eine andere Regel.',
    );
  }
  if (prov.aequivalenzTorBestanden !== true) {
    throw new VerfassungsBruch(
      'F6 Pin 1: das Aequivalenz-Tor des Auslese-Laufs ist nicht bestanden. Ohne es ist nicht '
      + 'belegt, dass der Satz AUSGELESEN und nicht neu abgeleitet wurde.',
    );
  }
  // Die Zahlen, die der Eintrag beurkundet. Sie stehen als Konstanten hier, weil
  // ein Eintrag, der beurkundet "was gerade in der Datei steht", nichts beurkundet.
  const soll = { 'S-U': [95, 540], 'S-G': [95, 546], 'S-UG': [null, 30] };
  Object.keys(soll).forEach((familie) => {
    const [pFinal, firmen] = soll[familie];
    const ist = (datei.jeFamilie || {})[familie];
    if (!ist) throw new VerfassungsBruch(`F6 Pin 1: Familie ${familie} fehlt im Schwellen-Satz.`);
    const istP = ist.pFinal === undefined ? null : ist.pFinal;
    if (istP !== pFinal) {
      throw new VerfassungsBruch(
        `F6 Pin 1: ${familie} traegt p_final ${JSON.stringify(istP)}, registriert wird `
        + `${JSON.stringify(pFinal)}.`,
      );
    }
    if (ist.firmenReif !== firmen) {
      throw new VerfassungsBruch(
        `F6 Pin 1: ${familie} traegt ${ist.firmenReif} reife Firmen, registriert werden ${firmen}.`,
      );
    }
  });

  const inhalt = datei.inhaltSha256;
  if (inhalt !== SCHWELLEN_INHALT_SHA256) {
    throw new VerfassungsBruch(
      `F6 Pin 1: das Artefakt weist inhaltSha256 ${inhalt} aus, registriert ist `
      + `${SCHWELLEN_INHALT_SHA256}.`,
    );
  }
  if (dateiHash !== SCHWELLEN_DATEI_SHA256) {
    throw new VerfassungsBruch(
      `F6 Pin 1: ${SCHWELLEN_REL} traegt sha256 ${dateiHash}, registriert ist `
      + `${SCHWELLEN_DATEI_SHA256}. Der Eintrag wuerde ein Artefakt beurkunden, das es so nicht `
      + 'gibt.',
    );
  }
  return { inhalt, dateiHash };
}

function pruefeBand(pfad) {
  const { datei, dateiHash } = liesEinmal(pfad);
  const vier = ((datei.inhalt || {}).vierGroessen || {});
  const einheit = vier['3_klumpungseinheit'] || {};
  if (einheit.gilt !== KLUMPUNGSEINHEIT) {
    throw new VerfassungsBruch(
      `F6 Pin 3: das Band-Artefakt fuehrt als Einheit ${JSON.stringify(einheit.gilt)}, registriert `
      + `wird ${JSON.stringify(KLUMPUNGSEINHEIT)}. Jede groebere Einheit — Entity-Klasse x `
      + 'Signalquartal eingeschlossen — ist eine AENDERUNG und geht an den Rat, nicht in diesen '
      + 'Eintrag.',
    );
  }
  if ((datei.freezeStatus || {}).eingefroren !== false) {
    throw new VerfassungsBruch(
      'F6 Pin 3: das Band-Artefakt meldet sich bereits als eingefroren. Dieser Eintrag IST der '
      + 'Freeze-Akt — ein zweiter waere eine zweite Registrierung derselben Groessen.',
    );
  }
  const inhalt = datei.inhaltSha256;
  if (inhalt !== BAND_INHALT_SHA256) {
    throw new VerfassungsBruch(
      `F6 Pin 3: das Band-Artefakt weist inhaltSha256 ${inhalt} aus, registriert ist `
      + `${BAND_INHALT_SHA256}.`,
    );
  }
  if (dateiHash !== BAND_DATEI_SHA256) {
    throw new VerfassungsBruch(
      `F6 Pin 3: ${BAND_REL} traegt sha256 ${dateiHash}, registriert ist ${BAND_DATEI_SHA256}.`,
    );
  }
  return { inhalt, dateiHash };
}

function pruefeAnker(pfad) {
  const { datei, dateiHash } = liesEinmal(pfad);
  const nutz = datei.nutzlast || {};
  if (nutz.registriertePraeregSha !== PRAEREG_SHA256) {
    throw new VerfassungsBruch(
      `F6 Pin 4: der Anker fuehrt ${nutz.registriertePraeregSha}, registriert wird `
      + `${PRAEREG_SHA256}.`,
    );
  }
  if (nutz.waechterDatei !== WAECHTER_REL || nutz.waechterDateiSha256 !== WAECHTER_SHA256) {
    throw new VerfassungsBruch(
      `F6 Pin 4: der Anker nennt Waechter ${JSON.stringify(nutz.waechterDatei)} mit `
      + `${nutz.waechterDateiSha256}; registriert wird ${WAECHTER_REL} mit ${WAECHTER_SHA256}.`,
    );
  }
  if (datei.registerVerankert !== false) {
    throw new VerfassungsBruch(
      'F6 Pin 4: der Anker meldet sich bereits als register-verankert. Dieser Eintrag ist die '
      + 'Stelle, an der das nachgeholt wird — ein zweites Mal waere eine Doppelbeurkundung.',
    );
  }
  if (dateiHash !== ANKER_DATEI_SHA256) {
    throw new VerfassungsBruch(
      `F6 Pin 4: ${ANKER_REL} traegt sha256 ${dateiHash}, registriert ist ${ANKER_DATEI_SHA256}.`,
    );
  }
  return { dateiHash };
}

// Die drei Python-Dateien werden AM OBJEKT geprueft, nicht ueber die Aussage
// eines Artefakts ueber sie. Ein Modul, dessen Hash nur in einem JSON steht, ist
// nicht versiegelt, sondern zitiert.
function pruefeDateien(wurzel) {
  const basis = wurzel || WURZEL;
  [[MODUL_REL, MODUL_SHA256], [WERKZEUG_REL, WERKZEUG_SHA256], [WAECHTER_REL, WAECHTER_SHA256]]
    .forEach((paar) => {
      const [rel, soll] = paar;
      const ist = crypto.createHash('sha256')
        .update(fs.readFileSync(path.join(basis, rel))).digest('hex');
      if (ist !== soll) {
        throw new VerfassungsBruch(
          `F6: ${rel} traegt sha256 ${ist}, registriert ist ${soll}. Der Eintrag wuerde eine Datei `
          + 'beurkunden, die es so nicht gibt.',
        );
      }
    });
}

// -- Der Eintrag --------------------------------------------------------------

function baueEintrag(runId, registeredAt, wirksamAb) {
  return {
    runId,
    typ: ART_C0_REGELFREEZE,
    registeredAt,
    accessedAt: wirksamAb,
    fenster: ['kein Studienfenster - Freeze-Akt ohne Datenzugriff'],
    allowedOutputs: [],
    erlaubt:
      'Nichts. Dieser Eintrag friert die vier Groessen ein, die das F6-Tor tragen, und autorisiert '
      + 'KEINEN Datenzugriff: keine Lueckenliste, kein Prueffenster, kein Panel, keine '
      + 'Studiendaten, kein data/lockbox. Der EINE konfirmatorische F6-Lauf braucht seinen EIGENEN '
      + 'Eintrag der Art confirmatory_execution_authorized (Eintrag 24) und darf erst starten, '
      + 'wenn DIESER Eintrag auf main steht und server-bestaetigt ist (VB-A11: Freeze vor dem '
      + 'Blick). Das Feld accessedAt bezeichnet hier keinen Zugriff, sondern den fruehesten '
      + 'Zeitpunkt, ab dem der eingefrorene Satz VERWENDET werden darf; die Art C0_REGELFREEZE '
      + 'verlangt das Feld (lib/studie-verfassung.js, ARTEN_MIT_ZUGRIFFSZEIT).',
    verboten:
      'Jede nachtraegliche Aenderung an den vier Groessen oder ihren Hashes nach diesem Eintrag; '
      + 'jede Neuableitung von Schwelle, SE-Vorschrift, Klumpungseinheit oder E2-Regel nach dem '
      + 'Bandergebnis; jede groebere Klumpungseinheit als die hier eingetragene ohne eigenen, VOR '
      + 'dem Blick registrierten Akt; jeder Datenzugriff unter dieser runId; jede Berufung auf '
      + 'diesen Eintrag als Autorisierung eines Laufs; jede Verwendung von 329/365 als '
      + 'Entscheidungsgroesse (VB Paragraph 0.1 - Bezugspunkt ist genau der registrierte Anteil '
      + '0,90); jedes Abfeuern des Endtests, auch bei BESTANDEN.',
    begruendung:
      'VB-A11 / ENTSCHIED 133 - der Freeze-Akt ueber allen vier F6-Groessen im SELBEN Register-Akt, '
      + 'vor dem ersten Blick. '
      + `PIN 1 SCHWELLEN-SATZ: ${SCHWELLEN_REL}, inhaltSha256 ${SCHWELLEN_INHALT_SHA256} `
      + "(Kanonisierung: JSON, Schluessel sortiert, separators ',' und ':', ensure_ascii=False, "
      + `UTF-8, ohne das Hash-Feld selbst), Datei-SHA-256 ${SCHWELLEN_DATEI_SHA256}; auf main seit `
      + 'PR #171. Inhalt: S-U p_final 95 (Rate 1,4219 %, 540 reife Firmen) - S-G p_final 95 '
      + '(1,0564 %, 546) - S-UG kein p_final (0,0789 %, 30, scheitert an K1, Mindest-Fallzahl 300) '
      + 'auf der Fassung verbreitertOhneBank, ausschliesslich (ENTSCHIED 150). Der Satz ist '
      + 'AUSGELESEN, nicht abgeleitet: kalibriere() lief innerhalb des versiegelten Moduls im '
      + 'massgeblichen Durchlauf; es gibt kein Ableitungs-Ermessen, das spaeter bestritten werden '
      + `koennte. PIN 2 E2-REGEL: die Regel IST das versiegelte Modul ${MODUL_REL}, sha256 `
      + `${MODUL_SHA256}. Sie wurde nicht neu formuliert. Das Auslese-Werkzeug ${WERKZEUG_REL}, `
      + `sha256 ${WERKZEUG_SHA256}, geht als WERKZEUG-Nachweis mit - es rechnet nichts, sondern `
      + 'substituiert die Eingabe und liest aus; es ist ausdruecklich KEINE zweite Regel. '
      + `PIN 3 KLUMPUNGSEINHEIT, endgueltig: ${KLUMPUNGSEINHEIT}. Herkunft `
      + 'protocol/early-detection/1.2.0/preregistration.json:384 ("replicates clustered by signal '
      + 'entity"), fortgefuehrt aus 1.1.0/1.0.0 ("entity-clustered confidence intervals") - also '
      + 'ein praeregistrierter Praezedenzfall und keine Neuerfindung; konsistent mit der '
      + 'durchgaengigen Firmen-Granularitaet dieser Phase (Fallback je Firma ENTSCHIED 148, '
      + 'Nenner-Eintritt, W8-Zaehlung); statistisch konservativ, weil mehrere Signale derselben '
      + 'Firma korreliert sind und die Firmen-Klumpung genau das im klumpen-robusten SE absorbiert. '
      + 'NICHT ZU VERWECHSELN mit "Entity-Klasse x Signalquartal": das war Bedingung 2 des '
      + 'K8-Bank-Stratums, das am 30.08. mangels Belegs gefallen ist, und hat mit der Einheit der '
      + `operativen Familie nichts zu tun. Band-Artefakt ${BAND_REL}, inhaltSha256 `
      + `${BAND_INHALT_SHA256} (Geltungsbereich: der inhalt-Teilbaum), Datei-SHA-256 `
      + `${BAND_DATEI_SHA256}. PIN 4 VB-A6-NUTZLAST: registrierte Praeregistrierung `
      + `${PRAEREG_SHA256}; die Luecke war, dass die Waechter-Datei ${WAECHTER_REL} (sha256 `
      + `${WAECHTER_SHA256}) in keinem hash-manifest-Tripel und in keinem Register-Eintrag stand - `
      + "ein Commit, der Allowlist, Manifest UND die Waechter-Konstante zugleich verstellt, machte "
      + `B3-Strich stumm. Mit diesem Eintrag ist sie verankert; das Zitierverbot aus ${ANKER_REL} `
      + `(Datei-SHA-256 ${ANKER_DATEI_SHA256}) faellt damit. `
      + 'FORMBEDINGUNG, dokumentiert statt stillschweigend uebernommen: die Verschiebung des '
      + 'A10-Kontingent-Ankers zur Verfassungs-Eigenquote wird hier als KORREKTUR benannt. '
      + 'Substanzgleich - weiterhin hoechstens EINE weitere Prueffenster-Beruehrung -, aber die '
      + 'Verschiebung steht da und wird nicht unterschlagen. '
      + 'ZULAESSIGKEITS-GATE UND BAND-REGEL, vorab und ausdruecklich, damit nichts davon nach dem '
      + 'Ergebnis verhandelt wird: Nenner unter 200 oder ein Pflicht-SE nicht berechenbar -> NICHT '
      + 'UNTERSCHEIDBAR, WEITER = 0, kein Rueckfall auf einen kleineren SE; ist der SE prospektiv '
      + 'nicht einfrierbar, startet F6 gar nicht. Betrag(Ergebnis - 0,90) kleiner-gleich SE* '
      + '(geschlossen, Gleichheit zaehlt rein) -> NICHT UNTERSCHEIDBAR, WEITER = 0, Pfad endet, '
      + 'Siegel bleibt zu. Auch bei BESTANDEN gibt es KEINEN Automatismus zum Endtest. '
      + 'WARUM DIESER EINTRAG NICHT ZUGLEICH DEN LAUF AUTORISIERT: C0_REGELFREEZE schaltet '
      + 'definitionsgemaess keine Ergebnisdaten frei, die Register-Regel verlangt fuer einen Lauf '
      + 'auf Ergebnisdaten die Art confirmatory_execution_authorized (R4), und VB-A11 verlangt den '
      + 'Freeze SERVER-BESTAETIGT VOR dem Zugriff - ein Eintrag kann nicht vor sich selbst '
      + 'server-bestaetigt sein. Die Aufteilung in Freeze (23) und Zugriff (24) ist deshalb keine '
      + 'Auslegung des Bauenden, sondern die einzige formgerechte Fassung; Entscheid des '
      + 'Tages-Orchestrators vom 2026-08-31. '
      + 'HERKUNFT DER WERTE: alle Hashes gegen origin/main f2ee789a81 nachgerechnet, mit zwei '
      + 'unabhaengigen Werkzeugen, NICHT aus dem Entwurfsdokument uebernommen - zwei seiner Werte '
      + 'waren falsch und existieren in keinem Commit dieses Repos (Korrektur-Block im Entwurf, '
      + 'Fehler-Register F5122). '
      + 'Erzeugt von scripts/studie-f6-register.js; Ein-Appender-Regel: main-first per Mini-PR (nur '
      + 'die Registerdatei), danach Serverbeweis gegen main mit scripts/studie-r1-serverzeit.js.',
    endtestSiegel:
      'unberuehrt und in ALLEN Zweigen ZU. Dieser Eintrag friert Groessen ein und oeffnet nichts: '
      + 'weder Endtest-Fenster noch Prueffenster noch Lueckenliste noch Schluesselmaterial werden '
      + 'geoeffnet, gelesen oder gezaehlt. Das Abfeuern des Endtests bleibt ein eigener Akt und '
      + 'braucht Karls ausdrueckliche Freigabe.',
  };
}

// -- Ablauf -------------------------------------------------------------------

function haupt(argv) {
  const schreiben = argv.includes('--schreiben');
  const registerPfad = argument(argv, 'register') || LEDGER;
  const schwellenPfad = argument(argv, 'schwellen') || SCHWELLEN;
  const bandPfad = argument(argv, 'band') || BAND;
  const ankerPfad = argument(argv, 'anker') || ANKER;
  const dateiWurzel = argument(argv, 'wurzel') || WURZEL;
  const runId = argument(argv, 'runid') || RUN_ID;

  const jetzt = new Date();
  const anmeldeArg = argument(argv, 'anmeldezeit');
  const registeredAt = anmeldeArg ? new Date(anmeldeArg).toISOString() : jetzt.toISOString();
  if (Date.parse(registeredAt) > jetzt.getTime()) {
    throw new VerfassungsBruch(
      `F6: --anmeldezeit ${registeredAt} liegt in der Zukunft. Eine vordatierte Anmeldung ist ein `
      + 'Nachher-Protokoll mit Vorsprung.',
    );
  }
  const wirksamAb = argument(argv, 'wirksam-ab')
    ? new Date(argument(argv, 'wirksam-ab')).toISOString()
    : new Date(Date.parse(registeredAt) + VORLAUF_MINUTEN * 60 * 1000).toISOString();
  if (Date.parse(wirksamAb) <= Date.parse(registeredAt)) {
    throw new VerfassungsBruch(
      `F6: --wirksam-ab (${wirksamAb}) muss NACH der Anmeldung (${registeredAt}) liegen.`,
    );
  }

  const register = lies(registerPfad);
  const stand = pruefeZugriffsRegister(register);
  pruefeRunIdFrei(register, runId);
  pruefeTail(register, stand);
  const schwellen = pruefeSchwellenSatz(schwellenPfad);
  const band = pruefeBand(bandPfad);
  const anker = pruefeAnker(ankerPfad);
  pruefeDateien(dateiWurzel);

  const eintrag = baueEintrag(runId, registeredAt, wirksamAb);
  const neu = haengeEintragAn(register, eintrag);
  pruefeZugriffsRegister(neu);
  const fertig = neu.events[neu.events.length - 1];

  process.stdout.write(`${JSON.stringify(fertig, null, 1)}\n\n`);
  process.stdout.write(
    `Pin 1 Schwellen-Satz inhalt ${schwellen.inhalt}\n`
    + `                     datei  ${schwellen.dateiHash}\n`
    + `Pin 2 Modul (Regel)         ${MODUL_SHA256}\n`
    + `      Werkzeug              ${WERKZEUG_SHA256}\n`
    + `Pin 3 Einheit               ${KLUMPUNGSEINHEIT}\n`
    + `      Band inhalt           ${band.inhalt}\n`
    + `      Band datei            ${band.dateiHash}\n`
    + `Pin 4 Praereg               ${PRAEREG_SHA256}\n`
    + `      Waechter              ${WAECHTER_SHA256}\n`
    + `      Anker datei           ${anker.dateiHash}\n`
    + `Kettenende vor dem Eintrag: ${ERWARTETER_LETZTER_RUNID} / ${ERWARTETER_TAIL}\n`
    + `PRUEFZEILE: "previousHash": "${fertig.previousHash}"\n`
    + `eventHash Eintrag 23: ${fertig.eventHash}\n`,
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
  const zurueck = lies(registerPfad);
  pruefeZugriffsRegister(zurueck);
  const kontrolle = zurueck.events[zurueck.events.length - 1];
  if (kontrolle.eventHash !== fertig.eventHash) {
    throw new VerfassungsBruch(
      'F6 - HALT, NICHT ERNEUT AUSFUEHREN: das Register auf der Platte traegt jetzt einen anderen '
      + `eventHash (${kontrolle.eventHash}) als der geprueft gebaute (${fertig.eventHash}). Die `
      + 'Datei ist bereits geschrieben und weicht vom verifizierten Stand ab. Ein zweiter Lauf '
      + 'wuerde darauf aufsetzen. Zuerst von Hand pruefen und den Stand aus der Git-Historie '
      + `wiederherstellen (${registerPfad}), dann erst weiter.`,
    );
  }
  process.stdout.write(
    `\nGESCHRIEBEN: ${registerPfad}\n`
    + 'JETZT in dieser Reihenfolge, sie IST die Methodik: committen (NUR die Registerdatei) -> '
    + 'Mini-PR gegen main -> auf main landen lassen -> node scripts/studie-r1-serverzeit.js '
    + `bestaetigen --runid ${runId} --ziel <freigabe.json>. ERST DANACH darf Eintrag 24 `
    + '(confirmatory_execution_authorized) gebaut werden, und erst danach laeuft F6.\n',
  );
  return 0;
}

if (require.main === module) {
  try {
    process.exit(haupt(process.argv.slice(2)));
  } catch (fehler) {
    process.stderr.write(
      `${fehler instanceof VerfassungsBruch ? fehler.message : (fehler.stack || String(fehler))}\n`,
    );
    process.exit(1);
  }
}

module.exports = {
  baueEintrag,
  RUN_ID,
  ERWARTETER_TAIL,
  ERWARTETE_EVENTS,
  SCHWELLEN_INHALT_SHA256,
  SCHWELLEN_DATEI_SHA256,
  BAND_INHALT_SHA256,
  BAND_DATEI_SHA256,
  ANKER_DATEI_SHA256,
  MODUL_SHA256,
  WERKZEUG_SHA256,
  WAECHTER_SHA256,
  KLUMPUNGSEINHEIT,
};
