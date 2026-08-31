#!/usr/bin/env node
'use strict';

// Studie 2.0, F6-Tor — Register-Eintrag 24: der C0-Freeze der Rechenvorschrift
// F6-SE-KLUMPEN/v1 (_COURT-F6-VOLLZUG-2026-08-31, Frage (d) 3:0, Auflagen
// F6-B3 / F6-B4 / F6-B5 / F6-B20 / F6-B24; ratifiziert Session 07,
// 2026-08-31 22:19 lokal, berichtigt durch ORCHESTRATOR-NACHTRAG 2).
//
// DIE SACHE: protocol/early-detection/2.0.0/outcome-access-ledger.json ist
// nur-anhaengend, verkettet und extern bezeugt. Ein falscher Eintrag ist nicht
// korrigierbar, nur ergaenzbar. Deshalb ist der Trockenlauf hier der STANDARD:
// ohne Flagge liest das Werkzeug, prueft die ganze Kette, baut den Eintrag im
// Speicher, rechnet seinen eventHash aus und druckt ihn — und schreibt nichts.
// Erst `--schreiben` haengt an. Es gibt kein --force und keine Reparatur-
// Betriebsart. Derselbe Weg wie bei den Eintraegen 21, 22 und 23
// (studie-rr9-a3-register.js, studie-f3b-register.js, studie-f6-register.js) —
// ein zweiter Register-Akt unter einem zweiten Verfahren waere ein zweites
// Verfahren. Ein EIGENES Werkzeug je Akt ist F6-B8; das Werkzeug fuer Eintrag
// 23 ist verbraucht.
//
// WAS DIESER EINTRAG IST — UND WAS NICHT. Er friert die Rechenrealisierung des
// bereits eingefrorenen Terms `SE_klumpen-robust` ein und autorisiert NICHTS:
// keinen Datenzugriff, keinen Lauf, kein Siegel. Die Regel
// `SE* = max(SE_binomial, SE_klumpen-robust)` bleibt Wort fuer Wort unveraendert
// (§1 des Wortlauts). Der Akt ist eine PROSPEKTIVE VERVOLLSTAENDIGUNG vor jedem
// Blick, nicht eine nachtraegliche Aenderung (§11). Der konfirmatorische Lauf
// braucht seinen EIGENEN Eintrag 25 der Art confirmatory_execution_authorized
// (F6-B3) — ein Eintrag kann nicht vor sich selbst server-bestaetigt sein.
// EINTRAG 23 WIRD NICHT NACHTRAEGLICH ERGAENZT; das braeche die Kette.
//
// WARUM DIE ERWEITERUNG VON BESTAETIGBAR HIER NICHT GEBRAUCHT WIRD (F6-B19):
// C0_REGELFREEZE steht seit jeher in BESTAETIGBAR. Der Serverbeweis dieses Akts
// haengt also nicht am (c)-Schritt.
//
// ALLE SOLLWERTE UNTEN SIND GEGEN origin/main e32199fb54 NACHGERECHNET, nicht
// aus dem Urteilsdokument uebernommen: ein Urteil zitiert Hashes als
// Pruefauftrag, nie als Quelle (stehender Satz aus dem Eintrag-23-Werkzeug).
//
// Aufruf:
//   node scripts/studie-f6-freeze-eintrag24.js              # Trockenlauf (Standard)
//   node scripts/studie-f6-freeze-eintrag24.js --schreiben  # anhaengen, dann Mini-PR
// Optionen: --runid, --wirksam-ab <ISO>, --anmeldezeit <ISO>,
//           --register <pfad>, --nutzlast <pfad>, --wurzel <pfad> (nur fuer Tests)

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { writeFileAtomic } = require('../lib/atomic-write.js');
const {
  VerfassungsBruch,
  haengeEintragAn,
  pruefeZugriffsRegister,
  ART_C0_REGELFREEZE,
} = require('../lib/studie-verfassung.js');

const WURZEL = path.join(__dirname, '..');
const relPfad = (rel) => path.join(WURZEL, ...rel.split('/'));
const LEDGER_REL = 'protocol/early-detection/2.0.0/outcome-access-ledger.json';
const LEDGER = relPfad(LEDGER_REL);

// Sollwerte, hier UNABHAENGIG von den geprueften Dateien notiert. Ein Werkzeug,
// das seine Sollwerte aus der Datei liest, die es pruefen soll, prueft nichts.
const RUN_ID = 'f6-se-klumpen-freeze-2026-08-31';
const ERWARTETER_LETZTER_RUNID = 'f6-tor-freeze-2026-08-31';
const ERWARTETER_TAIL = '5def37b9ff21529761dfcd4f084cd9a61060603529d814167fd937b980cb0675';
const ERWARTETE_EVENTS = 23;

// FUENFTER PIN (§11) — dieselbe Bindungsform wie PIN 2 in Eintrag 23: die
// Vorschrift IST dieses Modul. Ein anderer Hash ist eine andere Vorschrift.
const SE_MODUL_REL = 'scripts/studie-f6-klumpen-se.py';
const SE_MODUL_SHA256 = 'bf10becdfe2dc08a303d22a97dda3eb65988fb72a50f8811c23b2c377c11a1d3';

// F6-B5 — das bisher nirgends gebundene Vollzugs-Artefakt.
const VOLLZUG_REL = 'protocol/early-detection/2.1.0/f6-vollzug-zweig-a-2026-08-31.json';
const VOLLZUG_DATEI_SHA256 = '8c66818e80140b16a473c278a47327d726601e14de83450d2ed6d353e55e4427';
const VOLLZUG_INHALT_SHA256 = '792f4ff58687945167e273d08ca509544f4ad7fd7ecd9eaa60d5dac3118c99f7';

// F6-B4 — rules.json traegt ueber REGELWERK_PFAD die Fenstergrenzen, ist aber
// von keinem Manifest gedeckt. Ohne diese Bindung koennte ein Commit die
// Fenster verstellen, ohne ein Siegel rot zu machen.
const RULES_REL = 'protocol/early-detection/2.0.0/rules.json';
const RULES_SHA256 = 'dc008723798f58fdae3cc67b36817aebf88b090acd8472cedda141f1e4b021bc';

// Die Nutzlast: der einzufrierende Wortlaut und der berichtigte
// Offenlegungstext, byte-gleich aus dem Urteil uebernommen.
const NUTZLAST_REL = 'protocol/early-detection/2.1.0/f6-se-klumpen-v1-wortlaut.json';
const NUTZLAST_DATEI_SHA256 = '10e812fa345bba545077f333de7d81edf18bb371e9e48ee7b697558c1bc944e8';
const WORTLAUT_SHA256 = 'd4f8d4d79927c2b58e351074bb9b026b3e79915652d7cd5b1b9b51eccdbafda1';
const OFFENLEGUNG_SHA256 = 'fc8d68648f82fb78893ee9796868d78e3ee5dd7c1ad81c329783e7426fb830af';
const WORTLAUT_ZIFFERN = 11;

// Der Waechter (F6-B24: Testname + Bruchprobe). Der Hash ist die Fassung ZUM
// ZEITPUNKT des Freeze — gemessen, damit der Eintrag keine Behauptung ueber
// eine Datei aufstellt, die er nicht gesehen hat. Er ist ausdruecklich KEINE
// eingefrorene Groesse: ein Waechter darf wachsen. Eingefroren ist der fuenfte
// Pin, also das Modul.
const WAECHTER_REL = 'tests/studie-f6-klumpen-se.test.js';
const WAECHTER_SHA256_AM_FREEZE = 'e4af54a421fcf7600570225e3610a6ee27a42b1dafab8714025e4ebbe3dc93d8';

// Vorlauf zwischen Anmeldung und Wirksamkeit. Dazwischen muessen Mini-PR und
// Serverbeweis passen; zu knapp waere eine Anmeldung, die sich selbst ueberholt.
const VORLAUF_MINUTEN = 120;

const lies = (pfad) => JSON.parse(fs.readFileSync(pfad, 'utf8'));
const sha256Datei = (pfad) => crypto.createHash('sha256').update(fs.readFileSync(pfad)).digest('hex');
const sha256Text = (text) => crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');

function argument(argv, name) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1 || i === argv.length - 1) return null;
  return argv[i + 1];
}

// -- Die Tore -----------------------------------------------------------------
// Reihenfolge wie beim Eintrag-23-Werkzeug: die INHALTLICHEN Tore stehen vor den
// Hash-Toren, sonst waeren sie unerreichbar.

function pruefeTail(register, stand) {
  const letzter = (register.events || [])[register.events.length - 1];
  if (!letzter || letzter.runId !== ERWARTETER_LETZTER_RUNID || stand.tailHash !== ERWARTETER_TAIL) {
    throw new VerfassungsBruch(
      `F6-24: der juengste Eintrag ist nicht der erwartete. Erwartet ${ERWARTETER_LETZTER_RUNID} mit `
      + `eventHash ${ERWARTETER_TAIL.slice(0, 16)}..., gefunden `
      + `${letzter ? letzter.runId : 'keiner'} mit ${stand.tailHash.slice(0, 16)}.... Ein Eintrag auf `
      + 'einem veralteten oder fremden Kettenende waere nicht mehr korrigierbar.',
    );
  }
  if (stand.eventCount !== ERWARTETE_EVENTS) {
    throw new VerfassungsBruch(
      `F6-24: das Register fuehrt ${stand.eventCount} Eintraege, erwartet sind ${ERWARTETE_EVENTS} `
      + 'vor Eintrag 24.',
    );
  }
}

function pruefeRunIdFrei(register, runId) {
  if ((register.events || []).some((e) => e.runId === runId)) {
    throw new VerfassungsBruch(
      `F6-24: runId ${runId} steht schon im Register. Nur-Anhaengen heisst auch: keine zweite `
      + 'Anmeldung unter demselben Namen.',
    );
  }
}

// Die Nutzlast wird VOR dem Bau am Objekt nachgerechnet: Dateibytes UND die
// beiden Texte einzeln. Ein Freeze-Akt, der einen Text beurkundet, den er nicht
// nachgerechnet hat, beurkundet eine Absicht statt eines Textes.
function pruefeNutzlast(pfad) {
  const dateiHash = sha256Datei(pfad);
  if (dateiHash !== NUTZLAST_DATEI_SHA256) {
    throw new VerfassungsBruch(
      `F6-24: ${NUTZLAST_REL} traegt sha256 ${dateiHash}, registriert ist ${NUTZLAST_DATEI_SHA256}.`,
    );
  }
  const datei = lies(pfad);
  const wortlaut = datei.wortlaut;
  const offenlegung = datei.offenlegungF6B21;
  if (typeof wortlaut !== 'string' || typeof offenlegung !== 'string') {
    throw new VerfassungsBruch('F6-24: die Nutzlast fuehrt keinen Wortlaut und/oder keinen Offenlegungstext.');
  }
  const wHash = sha256Text(wortlaut);
  if (wHash !== WORTLAUT_SHA256) {
    throw new VerfassungsBruch(
      `F6-24: der Wortlaut traegt sha256 ${wHash}, registriert ist ${WORTLAUT_SHA256}. Der Eintrag `
      + 'wuerde einen Text einfrieren, der nicht der beschlossene ist.',
    );
  }
  const oHash = sha256Text(offenlegung);
  if (oHash !== OFFENLEGUNG_SHA256) {
    throw new VerfassungsBruch(
      `F6-24: der Offenlegungstext traegt sha256 ${oHash}, registriert ist ${OFFENLEGUNG_SHA256}.`,
    );
  }
  // Vollzaehligkeit der Ziffern: ein Wortlaut, dem eine Ziffer fehlt, haette
  // einen anderen Hash — aber der Zaehler benennt den Schaden, statt nur "Hash
  // weicht ab" zu sagen. §7 traegt sein Antezedens; wer den Text auszugsweise
  // zitiert, muss es mitnehmen (Kipp-Bedingung aus NACHTRAG 2).
  const ziffern = (wortlaut.match(/^\*\*\d+\. /gm) || []).length;
  if (ziffern !== WORTLAUT_ZIFFERN) {
    throw new VerfassungsBruch(
      `F6-24: der Wortlaut fuehrt ${ziffern} Ziffern, erwartet sind ${WORTLAUT_ZIFFERN} (Paragraph 1 bis 11).`,
    );
  }
  if (!wortlaut.includes('Gilt n_g = 1 für alle g')) {
    throw new VerfassungsBruch(
      'F6-24: Paragraph 7 ohne sein Antezedens ("Gilt n_g = 1 fuer alle g"). Der +0,25-%-Satz gilt NUR '
      + 'unter dieser Bedingung; ohne sie waere die eingefrorene Aussage falsch (NACHTRAG 2).',
    );
  }
  return { dateiHash, wortlaut, offenlegung };
}

// Das Vollzugs-Artefakt (F6-B5). Wie beim Eintrag-23-Werkzeug wird der
// inhaltSha256 NICHT in JavaScript nachgebaut: seine Kanonisierung ist
// python-definiert (json.dumps sort_keys, separators ',' ':', ensure_ascii=False),
// und ein JS-Nachbau lag dort schon einmal falsch (2.0 gegen 2). Gebunden werden
// die beiden Groessen, die ohne zweite Implementierung pruefbar sind: der
// AUSGEWIESENE inhaltSha256 und der SHA-256 ueber die Dateibytes. Das ist nicht
// schwaecher — jede Aenderung am Inhalt faellt am Dateihash auf.
function pruefeVollzugsArtefakt(pfad) {
  const dateiHash = sha256Datei(pfad);
  if (dateiHash !== VOLLZUG_DATEI_SHA256) {
    throw new VerfassungsBruch(
      `F6-24: ${VOLLZUG_REL} traegt sha256 ${dateiHash}, registriert ist ${VOLLZUG_DATEI_SHA256}.`,
    );
  }
  const datei = lies(pfad);
  if (datei.inhaltSha256 !== VOLLZUG_INHALT_SHA256) {
    throw new VerfassungsBruch(
      `F6-24: das Vollzugs-Artefakt weist inhaltSha256 ${datei.inhaltSha256} aus, registriert ist `
      + `${VOLLZUG_INHALT_SHA256}.`,
    );
  }
  if ((datei.vollzugsStatus || {}).registriert !== false) {
    throw new VerfassungsBruch(
      'F6-24: das Vollzugs-Artefakt meldet sich bereits als registriert. Dieser Eintrag ist die Stelle, '
      + 'an der das nachgeholt wird — ein zweites Mal waere eine Doppelbeurkundung.',
    );
  }
  return { dateiHash };
}

// Die uebrigen Dateien am OBJEKT, nicht ueber die Aussage eines Artefakts ueber
// sie. Ein Modul, dessen Hash nur in einem JSON steht, ist nicht versiegelt,
// sondern zitiert.
function pruefeDateien(wurzel) {
  const basis = wurzel || WURZEL;
  [[SE_MODUL_REL, SE_MODUL_SHA256], [RULES_REL, RULES_SHA256],
    [WAECHTER_REL, WAECHTER_SHA256_AM_FREEZE]].forEach(([rel, soll]) => {
    const ist = sha256Datei(path.join(basis, ...rel.split('/')));
    if (ist !== soll) {
      throw new VerfassungsBruch(
        `F6-24: ${rel} traegt sha256 ${ist}, registriert ist ${soll}. Der Eintrag wuerde eine Datei `
        + 'beurkunden, die es so nicht gibt.',
      );
    }
  });
}

// -- Der Eintrag --------------------------------------------------------------

function baueEintrag(runId, registeredAt, wirksamAb, nutzlast) {
  return {
    runId,
    typ: ART_C0_REGELFREEZE,
    registeredAt,
    accessedAt: wirksamAb,
    fenster: ['kein Studienfenster - Freeze-Akt ohne Datenzugriff'],
    allowedOutputs: [],
    erlaubt: 'Nichts. Kein Datenzugriff.',
    verboten:
      'Jede nachtraegliche Aenderung an der hier eingefrorenen Rechenvorschrift oder an ihrem Modul-Hash '
      + 'nach diesem Eintrag; jede Neuableitung von Schwelle, SE-Vorschrift, Klumpungseinheit oder '
      + 'E2-Regel nach dem Bandergebnis; jeder Rueckfall auf den kleineren SE, wenn eine der acht '
      + 'Nicht-berechenbar-Bedingungen reisst (dann gilt ohne Ermessen: BandNichtAuswertbar -> NICHT '
      + 'UNTERSCHEIDBAR, WEITER = 0); jeder Datenzugriff unter dieser runId; jede Berufung auf diesen '
      + 'Eintrag als Autorisierung eines Laufs; jede Verwendung von 329/365 als Entscheidungsgroesse; '
      + 'jedes Abfeuern des Endtests, auch bei BESTANDEN. Wer Paragraph 7 auszugsweise zitiert, nimmt '
      + 'sein Antezedens ("Gilt n_g = 1 fuer alle g") woertlich mit - ohne es ist die +0,25-%-Aussage '
      + 'falsch.',
    begruendung:
      'F6-B20/B24 - der C0-Freeze der Rechenvorschrift F6-SE-KLUMPEN/v1, vor dem ersten Blick. '
      + 'CHARAKTER DES AKTS (Paragraph 11): PROSPEKTIVE VERVOLLSTAENDIGUNG der bereits eingefrorenen '
      + 'SE-Vorschrift, NICHT deren Aenderung. Die Regel SE* = max(SE_binomial(p-Dach), '
      + 'SE_klumpen-robust) bleibt Wort fuer Wort unveraendert; eingefroren wird die Rechenrealisierung '
      + 'des bereits benannten Terms. Die Klumpungseinheit bleibt PIN 3 aus Eintrag 23. EINTRAG 23 WIRD '
      + 'NICHT NACHTRAEGLICH ERGAENZT - das braeche die Kette. '
      + `FUENFTER PIN: ${SE_MODUL_REL}, sha256 ${SE_MODUL_SHA256}. Dieselbe Bindungsform wie PIN 2 in `
      + 'Eintrag 23: die Vorschrift IST dieses Modul, ein anderer Hash ist eine andere Vorschrift. Das '
      + 'Modul ist blind by construction - es nimmt eine ungeordnete Liste von (m_g, n_g)-Paaren '
      + 'entgegen, keine Firmen-Kennung, und greift auf keine Daten zu. '
      + `WORTLAUT: die Ziffern 1 bis 11 stehen woertlich im Feld vorschriftWortlaut.text (sha256 `
      + `${WORTLAUT_SHA256}), byte-gleich aus dem Urteil uebernommen. `
      + `OFFENLEGUNG DER RICHTUNG (F6-B21 in der durch ORCHESTRATOR-NACHTRAG 2 berichtigten Fassung, `
      + `sha256 ${OFFENLEGUNG_SHA256}): die allgemeine Schranke des Aufschlags ist Wurzel(G/(G-1)) und `
      + 'damit hoechstens Wurzel(2); die Klammer "hoechstens Wurzel(N/(N-1)), <= +0,25 %" der '
      + 'urspruenglichen Fassung galt nur fuer den Singleton-Fall G = N und ist ersetzt. Die '
      + 'Richtungswahl ist damit offengelegt und nicht verborgen getroffen; V1s Gegenposition CR0 steht '
      + 'als Dissens DV-2 im Urteil. '
      + `WEITERE BINDUNGEN: das bisher nirgends gebundene Vollzugs-Artefakt ${VOLLZUG_REL} `
      + `(Datei-SHA-256 ${VOLLZUG_DATEI_SHA256}, inhaltSha256 ${VOLLZUG_INHALT_SHA256}, Geltungsbereich `
      + 'der inhalt-Teilbaum, Kanonisierung python-definiert) - F6-B5; und '
      + `${RULES_REL} (sha256 ${RULES_SHA256}) - F6-B4: die Datei traegt ueber REGELWERK_PFAD die `
      + 'Fenstergrenzen, war aber von keinem Manifest gedeckt, sodass ein Commit die Fenster verstellen '
      + 'koennte, ohne ein Siegel rot zu machen. '
      + `WAECHTER (F6-B24): ${WAECHTER_REL}, Proben T1 bis T6, Selbsttest des Moduls 26 ok / 0 FAIL. `
      + 'BRUCHPROBE, protokolliert im Text von PR #185: den Faktor G/(G-1) einmal entfernt - T1 UND T4 '
      + 'wurden beide rot (Selbsttest 19 ok / 7 FAIL), und der Schadensfall am Eintrittspunkt lieferte '
      + 'still se_klumpen_robust = 0.0 bei EXIT = 0, also genau den verbotenen Rueckfall auf den '
      + 'kleineren SE; Faktor restauriert, danach wieder 26 ok / 0 FAIL. Ohne protokollierte Bruchprobe '
      + 'gilt der Waechter als nicht abgenommen (F6-B23, Kipp-Bedingung KV-3). '
      + 'WARUM DIESER EINTRAG NICHT ZUGLEICH DEN LAUF AUTORISIERT: C0_REGELFREEZE schaltet '
      + 'definitionsgemaess keine Ergebnisdaten frei; die Register-Regel verlangt fuer einen Lauf auf '
      + 'Ergebnisdaten die Art confirmatory_execution_authorized (R4); und ein Eintrag kann nicht vor '
      + 'sich selbst server-bestaetigt sein. Der konfirmatorische Akt ist Eintrag 25 (F6-B3). Fuer '
      + 'DIESEN Eintrag ist die BESTAETIGBAR-Erweiterung aus PR #186 nicht noetig - C0_REGELFREEZE war '
      + 'immer schon bestaetigbar (F6-B19). '
      + `HERKUNFT DER WERTE: alle Hashes gegen origin/main e32199fb54 nachgerechnet, nicht aus dem `
      + 'Urteilsdokument uebernommen - ein Urteil zitiert Hashes als Pruefauftrag, nie als Quelle. '
      + 'Erzeugt von scripts/studie-f6-freeze-eintrag24.js (eigenes Werkzeug je Register-Akt, F6-B8; '
      + 'Trockenlauf als Standard, kein --force, keine Reparatur-Betriebsart). Ein-Appender-Regel: '
      + 'main-first per Mini-PR (nur die Registerdatei), danach Serverbeweis gegen main mit '
      + 'scripts/studie-r1-serverzeit.js bestaetigen.',
    endtestSiegel:
      'unberuehrt und in ALLEN Zweigen ZU. Dieser Eintrag friert eine Rechenvorschrift ein und oeffnet '
      + 'nichts: weder Endtest-Fenster noch Prueffenster noch Lueckenliste noch Schluesselmaterial '
      + 'werden geoeffnet, gelesen oder gezaehlt. Das Abfeuern des Endtests bleibt ein eigener Akt und '
      + 'braucht Karls ausdrueckliche Freigabe (F6-A16).',
    // Eigene Top-Level-Felder statt einer Prosa-Halde: pruefeZugriffsRegister
    // fuehrt keine Feld-Whitelist, Zusatzfelder werden mitgehasht und sind damit
    // ebenso gebunden wie die Hausform-Felder - aber sie sind maschinell
    // adressierbar und damit pruefbar (die Mehrheitsfassung zu DV-3).
    vorschriftWortlaut: {
      name: 'F6-SE-KLUMPEN/v1',
      ziffern: '1 bis 11, vollstaendig',
      text: nutzlast.wortlaut,
      sha256: WORTLAUT_SHA256,
      quelle: NUTZLAST_REL,
      quelleDateiSha256: NUTZLAST_DATEI_SHA256,
      uebernahme:
        'byte-gleich aus dem Urteil; die Markdown-Auszeichnung reist mit, weil sie Teil des '
        + 'eingefrorenen Textes ist. Paragraph 7 steht vollstaendig samt seinem Antezedens.',
    },
    offenlegungFaktor: {
      auflage: 'F6-B21 in der durch ORCHESTRATOR-NACHTRAG 2 berichtigten Fassung',
      text: nutzlast.offenlegung,
      sha256: OFFENLEGUNG_SHA256,
      uebernahme:
        'byte-gleich; entfernt sind allein die Blockquote-Marker "> " am Zeilenanfang - sie sind der '
        + 'Zitat-Behaelter des Urteilsdokuments, nicht Teil des zitierten Satzes.',
      dissens: 'V1s CR0-Gegenposition bleibt als DV-2 konserviert.',
    },
    bindungen: {
      fuenfterPin: { datei: SE_MODUL_REL, sha256: SE_MODUL_SHA256, auflage: 'F6-B24, Paragraph 11' },
      vollzugsArtefakt: {
        datei: VOLLZUG_REL,
        dateiSha256: VOLLZUG_DATEI_SHA256,
        inhaltSha256: VOLLZUG_INHALT_SHA256,
        auflage: 'F6-B5',
      },
      regelwerk: { datei: RULES_REL, sha256: RULES_SHA256, auflage: 'F6-B4' },
      waechter: {
        datei: WAECHTER_REL,
        sha256AmFreeze: WAECHTER_SHA256_AM_FREEZE,
        proben: 'T1 Gleichheits-Anker, T2 Handfixture gegen das ausgeschriebene Literal 0,25, '
          + 'T3 Klumpen-Anker, T4 G = 1 und Einheit ohne Klumpen-Kennung, T5 Kreuzproben, '
          + 'T6 entartete Eingaben und Reihenfolge-Invarianz',
        bruchprobe: 'protokolliert im Text von PR #185 (Faktor entfernt -> T1 und T4 rot, '
          + 'Schadensfall se_klumpen_robust = 0.0 bei EXIT = 0; restauriert -> 26 ok / 0 FAIL)',
        hinweis: 'sha256AmFreeze ist die gemessene Fassung ZUM ZEITPUNKT des Freeze und ausdruecklich '
          + 'KEINE eingefrorene Groesse - ein Waechter darf wachsen. Eingefroren ist der fuenfte Pin.',
      },
    },
  };
}

// -- Ablauf -------------------------------------------------------------------

function haupt(argv) {
  const schreiben = argv.includes('--schreiben');
  const registerPfad = argument(argv, 'register') || LEDGER;
  const dateiWurzel = argument(argv, 'wurzel') || WURZEL;
  const nutzlastPfad = argument(argv, 'nutzlast') || path.join(dateiWurzel, ...NUTZLAST_REL.split('/'));
  const vollzugPfad = path.join(dateiWurzel, ...VOLLZUG_REL.split('/'));
  const runId = argument(argv, 'runid') || RUN_ID;

  const jetzt = new Date();
  const anmeldeArg = argument(argv, 'anmeldezeit');
  const registeredAt = anmeldeArg ? new Date(anmeldeArg).toISOString() : jetzt.toISOString();
  if (Date.parse(registeredAt) > jetzt.getTime()) {
    throw new VerfassungsBruch(
      `F6-24: --anmeldezeit ${registeredAt} liegt in der Zukunft. Eine vordatierte Anmeldung ist ein `
      + 'Nachher-Protokoll mit Vorsprung.',
    );
  }
  const wirksamAb = argument(argv, 'wirksam-ab')
    ? new Date(argument(argv, 'wirksam-ab')).toISOString()
    : new Date(Date.parse(registeredAt) + VORLAUF_MINUTEN * 60 * 1000).toISOString();
  if (Date.parse(wirksamAb) <= Date.parse(registeredAt)) {
    throw new VerfassungsBruch(
      `F6-24: --wirksam-ab (${wirksamAb}) muss NACH der Anmeldung (${registeredAt}) liegen.`,
    );
  }

  const register = lies(registerPfad);
  const stand = pruefeZugriffsRegister(register);
  pruefeRunIdFrei(register, runId);
  pruefeTail(register, stand);
  const nutzlast = pruefeNutzlast(nutzlastPfad);
  const vollzug = pruefeVollzugsArtefakt(vollzugPfad);
  pruefeDateien(dateiWurzel);

  const eintrag = baueEintrag(runId, registeredAt, wirksamAb, nutzlast);
  const neu = haengeEintragAn(register, eintrag);
  pruefeZugriffsRegister(neu);
  const fertig = neu.events[neu.events.length - 1];

  process.stdout.write(
    `Fuenfter Pin  ${SE_MODUL_REL}\n`
    + `              ${SE_MODUL_SHA256}\n`
    + `Wortlaut      Ziffern 1-11, sha256 ${WORTLAUT_SHA256}\n`
    + `Offenlegung   F6-B21 (NACHTRAG 2), sha256 ${OFFENLEGUNG_SHA256}\n`
    + `Nutzlast      ${NUTZLAST_REL}\n`
    + `              ${nutzlast.dateiHash}\n`
    + `Vollzug       datei ${vollzug.dateiHash}\n`
    + `              inhalt ${VOLLZUG_INHALT_SHA256}\n`
    + `Regelwerk     ${RULES_SHA256}\n`
    + `Waechter      ${WAECHTER_REL} (${WAECHTER_SHA256_AM_FREEZE.slice(0, 16)}..., am Freeze gemessen)\n`
    + `Kettenende vor dem Eintrag: ${ERWARTETER_LETZTER_RUNID} / ${ERWARTETER_TAIL}\n`
    + `PRUEFZEILE: "previousHash": "${fertig.previousHash}"\n`
    + `eventHash Eintrag 24: ${fertig.eventHash}\n`
    + `Eintraege nach dem Anhaengen: ${neu.events.length}\n\n`,
  );

  if (!schreiben) {
    process.stdout.write(
      'TROCKENLAUF - es wurde NICHTS geschrieben. Der eventHash gilt fuer genau diese '
      + 'registeredAt/accessedAt; ein Lauf mit --schreiben und ohne --anmeldezeit setzt eine neue '
      + 'Anmeldezeit und damit einen anderen Hash. Zum Reproduzieren dieselbe --anmeldezeit und '
      + '--wirksam-ab uebergeben.\n',
    );
    return 0;
  }

  writeFileAtomic(registerPfad, `${JSON.stringify(neu, null, 1)}\n`, 'utf8');
  const zurueck = lies(registerPfad);
  pruefeZugriffsRegister(zurueck);
  const kontrolle = zurueck.events[zurueck.events.length - 1];
  if (kontrolle.eventHash !== fertig.eventHash) {
    throw new VerfassungsBruch(
      'F6-24 - HALT, NICHT ERNEUT AUSFUEHREN: das Register auf der Platte traegt jetzt einen anderen '
      + `eventHash (${kontrolle.eventHash}) als der geprueft gebaute (${fertig.eventHash}). Die Datei `
      + 'ist bereits geschrieben und weicht vom verifizierten Stand ab. Ein zweiter Lauf wuerde darauf '
      + `aufsetzen. Zuerst von Hand pruefen und den Stand aus der Git-Historie wiederherstellen `
      + `(${registerPfad}), dann erst weiter.`,
    );
  }
  process.stdout.write(
    `GESCHRIEBEN: ${registerPfad}\n`
    + 'JETZT in dieser Reihenfolge, sie IST die Methodik: committen (NUR die Registerdatei) -> Mini-PR '
    + 'gegen main -> auf main landen lassen -> node scripts/studie-r1-serverzeit.js bestaetigen '
    + `--runid ${runId} --ziel <freigabe.json>. ERST DANACH darf Eintrag 25 `
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
  haupt,
  baueEintrag,
  pruefeNutzlast,
  RUN_ID,
  ERWARTETER_LETZTER_RUNID,
  ERWARTETER_TAIL,
  ERWARTETE_EVENTS,
  SE_MODUL_REL,
  SE_MODUL_SHA256,
  VOLLZUG_DATEI_SHA256,
  VOLLZUG_INHALT_SHA256,
  RULES_SHA256,
  NUTZLAST_REL,
  NUTZLAST_DATEI_SHA256,
  WORTLAUT_SHA256,
  OFFENLEGUNG_SHA256,
  WAECHTER_REL,
};
