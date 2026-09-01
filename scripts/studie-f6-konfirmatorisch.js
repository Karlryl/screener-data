#!/usr/bin/env node
'use strict';

// Studie 2.0, F6-Tor — DER KONFIRMATORISCHE EINTRAG (Bauordnung Schritt 7).
//
// Der Akt wird nach ART benannt, nicht nach Ordinalzahl (F6-C22 / F6-C24(4)):
// `confirmatory_execution_authorized`. Er autorisiert den EINEN konfirmatorischen
// F6-Lauf auf dem Prueffenster — und NUR ihn.
//
// DER LAUF FEUERT NICHT MIT DIESEM EINTRAG. Er startet erst nach GRUENEM REVIEW
// des Eintrags-Akts (Bauordnung Schritt 8). Das steht auch im Eintrag selbst.
//
// Trockenlauf ist der STANDARD. Kein --force, keine Reparatur-Betriebsart
// (F6-B8). Eigenes Werkzeug je Register-Akt; die Sollwerte stehen hier
// UNABHAENGIG von den geprueften Dateien und werden zur Laufzeit am Objekt
// nachgerechnet.
//
// Aufruf:
//   node scripts/studie-f6-konfirmatorisch.js              # Trockenlauf
//   node scripts/studie-f6-konfirmatorisch.js --schreiben  # anhaengen

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { writeFileAtomic } = require('../lib/atomic-write.js');
const { canonicalSha256 } = require('../lib/early-detection.js');
const {
  VerfassungsBruch, haengeEintragAn, pruefeZugriffsRegister, ART_ZUGRIFF,
} = require('../lib/studie-verfassung.js');

const WURZEL = path.join(__dirname, '..');
const LEDGER_REL = 'protocol/early-detection/2.0.0/outcome-access-ledger.json';
const LEDGER = path.join(WURZEL, ...LEDGER_REL.split('/'));

const RUN_ID = 'f6-konfirmatorisch-2026-09-01';
const VORLAUF_MINUTEN = 120;
const ERWARTETE_EVENTS = 26;
const ERWARTETER_LETZTER_RUNID = 'f6-bein2-berichtigung-2026-09-01';
const ERWARTETER_TAIL = 'f9fbaac79675c08cf9137b9c51d022c9b32003940de01435b4f260d2b928c2a9';
const ZAEHLPROBE_RUNID = 'f6-aequivalenz-entdeckung-2026-09-01';
const ZAEHLPROBE_EVENTHASH = '847084648a7fa5d7d8535c7eec3285de44ac94c02cce1e94f204528f34358d41';

// ── F6-C24: die Bindungsliste. Datei -> erwarteter SHA. ────────────────────
const SKRIPTE = {
  'scripts/studie-f6-lauf.py': '36664e70128fe02c114e5cdaa81c394091bb8fae809940f109dbc6abe7a168d0',
  'scripts/studie-f6-zaehlwerk.py': 'f47f10d555c701c08e1282aa7e3b41424b836b0851edbdbb80f83839b9f99410',
  'scripts/studie-zaehlprobe.py': 'a3fce5a1672e231fe12d7d7ffc8a3655ad8e3ef9b3bd2a2195e1af5fcbdbf17b',
  'scripts/studie-basisraten.py': '997a80d26871937f848b3eea76a9b4ba1a4e1c76f1cc3c30db98d7888ec2601d',
  'scripts/studie-f6-klumpen-se.py': 'bf10becdfe2dc08a303d22a97dda3eb65988fb72a50f8811c23b2c377c11a1d3',
  'scripts/studie-vb-b4-band.py': 'c5ff07d3e2b5037e20073da0a7abb9b71443430efc63986d4ddbeb1a85ed76d8',
  'scripts/studie-e2-verbreitert.py': '9a24ed94e943e9a6f5b4a1373ba6c6aa2001ddadb2d60a705277bf5eb359984b',
  'scripts/studie-panel-digest.py': '14414d2633f74b94662d503336db61be6825f3c7b89b6ebcf3275a841396f33f',
  'scripts/studie-r1-serverzeit.js': '21fba6882239d24ca70e6e3fd2f6610baa5d7bddfded0d0d030bbe4090ec5257',
  'scripts/studie-f6-aequivalenz-anmeldung.js':
    'e00a055755ddbef6eee6cb9da391cf9b16a9515f9cb62e1c973f6245cf7469fd',
  'scripts/studie-f6-berichtigung-bein2.js':
    '0a1bede8772b6ec30fc03becc79b12d4a1aff3f8af720848396db48ea79c7096',
};
const ARTEFAKTE = {
  'protocol/early-detection/2.0.0/preregistration.json':
    '799f925142860b4db97b5f18894b62c749aeb014872279aa6a7df8ee99ac5a6c',
  'protocol/early-detection/2.0.0/rules.json':
    'dc008723798f58fdae3cc67b36817aebf88b090acd8472cedda141f1e4b021bc',
  'protocol/early-detection/2.1.0/e2-schwellen-satz-2026-08-30.json':
    '80798025d2ad6387b3ed72048227112426369ec8392ae633a92df58f0cf4d1e5',
  'protocol/early-detection/2.1.0/f6-vollzug-zweig-a-2026-08-31.json':
    '8c66818e80140b16a473c278a47327d726601e14de83450d2ed6d353e55e4427',
  'protocol/early-detection/2.1.0/b4-bandregel-2026-08-30.json':
    'd9c5990ad403b6baca2e3a4228218af0b73367e4f51ffd213ac654fc41cdc5da',
  'protocol/early-detection/2.1.0/jahrgang-registrierung-2026-08-30.json':
    'aa4277fa9f39f38b3d1ffa4f9048d76f33e2515aa64afa021165d7895cb6074f',
  'protocol/early-detection/2.1.0/konzeptliste.json':
    'f7a123f9f5fc5109c07e9c18754da4b785d45b2391a9417fe4150fb48798357b',
  'reports/studie/E4d-kadenz-entdeckung-2026-08-19.json':
    '46e191ec68e0480a336fd287dc548c8b6a975b8d50a07c6e0162274c6dbd8fdf',
};
const INHALT_SHA = {
  'protocol/early-detection/2.1.0/e2-schwellen-satz-2026-08-30.json':
    'c4a888906e4cb26a1a4994c54fc34b89c068e40646a800d3d07c7051308b2bee',
  'protocol/early-detection/2.1.0/f6-vollzug-zweig-a-2026-08-31.json':
    '792f4ff58687945167e273d08ca509544f4ad7fd7ecd9eaa60d5dac3118c99f7',
  'protocol/early-detection/2.1.0/b4-bandregel-2026-08-30.json':
    '1fd6a9f3ceb6dab0076c6812f57483889708345d6a87c6103a7515689cf8c46e',
  'protocol/early-detection/2.1.0/jahrgang-registrierung-2026-08-30.json':
    '0363702f5aa6fd486a6901aecaef3108f81828248657bcfb455b6a4ae413c567',
  'protocol/early-detection/2.1.0/konzeptliste.json':
    '88ba14a298837bcc6287c4f52a3ba61296b6ba56d96ba78cba0470335df99247',
};
// Welcher Rechenweg fuer welches Artefakt gilt, wird HIER benannt und nicht
// zur Laufzeit erraten. 'nachgerechnet' = Haus-Kanonisierer ueber den
// genannten Teilbaum; 'selbstdeklariert' = der Wert steht in der Datei und
// wurde Python-seitig gebildet (siehe pruefeAlles).
// GEMESSEN, nicht angenommen: die vier Artefakte, die ein eigenes Feld
// inhaltSha256 fuehren, sind PYTHON-seitig kanonisiert (json.dumps mit
// ensure_ascii=False). Der Haus-Kanonisierer in lib/early-detection.js
// reproduziert das NICHT — Python und JS schreiben Gleitkomma und Escapes
// verschieden. Bei jahrgang-registrierung stimmen beide zufaellig ueberein,
// weil dieser Teilbaum keine divergierende Stelle enthaelt; das ist ein
// Zufall und keine Regel, und darauf wird hier nicht gebaut.
// Fuer diese vier gilt deshalb 'selbstdeklariert': der von der Datei gefuehrte
// Wert wird gegen die Bindung gehalten, und die BYTES traegt der
// dateiSha256-Riegel. Was NICHT behauptet wird: dass er nachgerechnet ist.
// konzeptliste.json fuehrt kein solches Feld; dort deckt sich der
// Haus-Kanonisierer ueber den Teilbaum mit dem gebundenen Wert und wird
// wirklich nachgerechnet.
const INHALT_MODUS = {
  'protocol/early-detection/2.1.0/e2-schwellen-satz-2026-08-30.json': ['selbstdeklariert', null],
  'protocol/early-detection/2.1.0/f6-vollzug-zweig-a-2026-08-31.json': ['selbstdeklariert', null],
  'protocol/early-detection/2.1.0/b4-bandregel-2026-08-30.json': ['selbstdeklariert', null],
  'protocol/early-detection/2.1.0/jahrgang-registrierung-2026-08-30.json':
    ['selbstdeklariert', null],
  'protocol/early-detection/2.1.0/konzeptliste.json': ['nachgerechnet', 'konzeptliste'],
};

const MANIFEST_REL = 'protocol/early-detection/2.0.0/hash-manifest.json';
const MANIFEST_SHA = '3eff89b487914f39c9a7317d56912506a77860cb37c63380310257cdb6091d26';
const BERICHT_REL = 'reports/studie/f6-aequivalenz-entdeckung-2026-09-01.json';

// ── F6-B12 / F6-C15: der registrierte Ausgabesatz ──────────────────────────
const DATEN_SCHLUESSEL = [
  'zaehler_reife', 'nenner_tor', 'anteil',
  'se_binomial', 'se_klumpen_robust', 'se_stern', 'se_entschied', 'klumpen_anzahl',
  'wilson95_unten', 'wilson95_oben', 'abstand_zu_090', 'abstand_zu_329_von_365',
  'bandbreite_absolut', 'bandbreite_in_se', 'schwelle', 'fallzahl_min',
  'messgeraet_vollstaendig',
  'verdikt', 'weiter', 'grund', 'etikett', 'pflichtsatz', 'zweitsatz',
  'n_A', 'n_B_reif', 'n_B_unreif', 'n_verloren', 'feuerfaehig',
  'strukturell_nicht_feuerfaehig', 'rechts_zensiert',
];
const DIFFERENZ_UNTERSCHLUESSEL = ['wert', 'maxDifferenzPunkte', 'erfuellt', 'quelle'];

// F6-C18/KZ-7 — am Objekt gemessen, unmittelbar vor diesem Akt.
const ANKER = {
  datei: 'scripts/studie-vb-b4-band.py',
  funktion: 'auswerten :145-227',
  konvention: 'fuehrende Zeile (def bzw. das entscheidende `if`) plus die vollstaendige return-Anweisung',
  gate_gerissen: ':168-172',
  im_band: ':213-217',
  ausserhalb_band: ':218-227',
  laeuferKommentar: 'scripts/studie-f6-lauf.py :395-426 (ZWEIG_PFLICHT-Zuweisung :432)',
};

const ARBEITSPFAD = ['C', ':', String.fromCharCode(92), 'Users', String.fromCharCode(92),
  'Anwender', String.fromCharCode(92), 'f6-arbeit'].join('');

const argument = (argv, n) => {
  const i = argv.indexOf(`--${n}`);
  if (i < 0) return null;
  const v = argv[i + 1];
  if (!v || v.startsWith('--')) throw new VerfassungsBruch(`F6-K: --${n} ohne Wert.`);
  return v;
};
const lies = (p) => {
  if (!fs.existsSync(p)) throw new VerfassungsBruch(`F6-K: nicht gefunden: ${p}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
};
const dsha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

function pruefeAlles(wurzel) {
  const gemessen = { skripte: {}, artefakte: {} };
  for (const [rel, soll] of Object.entries(SKRIPTE)) {
    const p = path.join(wurzel, ...rel.split('/'));
    if (!fs.existsSync(p)) throw new VerfassungsBruch(`F6-K: gebundenes Skript fehlt: ${rel}`);
    const ist = dsha(p);
    if (ist !== soll) {
      throw new VerfassungsBruch(
        `F6-K: ${rel} weicht ab (ist ${ist}, soll ${soll}). Ein anderer Hash ist ein anderes `
        + 'Skript; der Eintrag benennt die ausfuehrenden Skripte.');
    }
    gemessen.skripte[rel] = ist;
  }
  for (const [rel, soll] of Object.entries(ARTEFAKTE)) {
    const p = path.join(wurzel, ...rel.split('/'));
    if (!fs.existsSync(p)) throw new VerfassungsBruch(`F6-K: gebundenes Artefakt fehlt: ${rel}`);
    const ist = dsha(p);
    if (ist !== soll) {
      throw new VerfassungsBruch(`F6-K: ${rel} weicht ab (ist ${ist}, soll ${soll}).`);
    }
    const e = { dateiSha256: ist };
    if (INHALT_SHA[rel]) {
      const d = lies(p);
      const [modus, zweig] = INHALT_MODUS[rel];
      let ii;
      if (modus === 'nachgerechnet') {
        // Der Teilbaum wird mit dem HAUS-Kanonisierer neu gehasht (kein
        // eigener Nachbau, lib/early-detection.js ist die Quelle).
        if (d[zweig] === undefined) {
          throw new VerfassungsBruch(`F6-K: ${rel} fuehrt keinen Teilbaum ${zweig}.`);
        }
        ii = canonicalSha256(d[zweig]);
      } else {
        // SELBSTDEKLARIERT: dieses Artefakt wurde mit der PYTHON-seitigen
        // Kanonisierung gehasht (json.dumps ensure_ascii=False). Der
        // JS-Kanonisierer reproduziert sie NICHT — Python schreibt Gleitkomma
        // und Escapes anders. Statt eine Nachrechnung vorzutaeuschen, wird der
        // von der Datei SELBST gefuehrte Wert gegen die Bindung gehalten; die
        // Bytes traegt ohnehin der dateiSha256-Riegel eine Zeile weiter oben.
        // Was hier NICHT behauptet wird: dass der Wert nachgerechnet ist.
        ii = d.inhaltSha256;
        if (ii === undefined) {
          throw new VerfassungsBruch(`F6-K: ${rel} fuehrt kein Feld inhaltSha256.`);
        }
      }
      if (ii !== INHALT_SHA[rel]) {
        throw new VerfassungsBruch(
          `F6-K: ${rel} inhaltSha256 ist ${ii}, soll ${INHALT_SHA[rel]} (Modus ${modus}).`);
      }
      e.inhaltSha256 = ii;
      e.inhaltSha256Herkunft = modus;
    }
    gemessen.artefakte[rel] = e;
  }
  const mp = path.join(wurzel, ...MANIFEST_REL.split('/'));
  const mist = dsha(mp);
  if (mist !== MANIFEST_SHA) {
    throw new VerfassungsBruch(`F6-K: ${MANIFEST_REL} weicht ab (ist ${mist}).`);
  }
  gemessen.protocolManifestSha256 = mist;

  // Der Aequivalenz-Bericht: seine SHA kann erst nach seinem Merge gebunden
  // werden, deshalb wird sie hier GEMESSEN — aber sein Inhalt wird geprueft.
  const bp = path.join(wurzel, ...BERICHT_REL.split('/'));
  if (!fs.existsSync(bp)) {
    throw new VerfassungsBruch(
      `F6-K: der Aequivalenz-Bericht fehlt (${BERICHT_REL}). Ohne ihn ist das Tor nicht `
      + 'beurkundet; der konfirmatorische Eintrag setzt seinen Merge voraus.');
  }
  const bericht = lies(bp);
  if (bericht.daten.bestanden !== true) {
    throw new VerfassungsBruch('F6-K: der Aequivalenz-Bericht traegt bestanden != true.');
  }
  if (Object.keys(bericht.daten).length !== 25) {
    throw new VerfassungsBruch(
      `F6-K: der Bericht fuehrt ${Object.keys(bericht.daten).length} Schluessel, erwartet 25.`);
  }
  gemessen.bericht = { datei: BERICHT_REL, dateiSha256: dsha(bp), daten: bericht.daten,
    ersterZugriffAm: bericht.umschlag.ersterZugriffAm, beendetAm: bericht.umschlag.beendetAm };

  // Der Ausgabesatz des Laeufers, gegen das Modul gehalten (kein zweites Soll).
  const lauf = fs.readFileSync(path.join(wurzel, 'scripts', 'studie-f6-lauf.py'), 'utf8');
  for (const k of DATEN_SCHLUESSEL) {
    if (!lauf.includes(`"${k}"`)) {
      throw new VerfassungsBruch(`F6-K: Ausgabeschluessel ${k} steht nicht im Laeufer.`);
    }
  }
  return gemessen;
}

function pruefeKette(register, stand, runId) {
  if ((register.events || []).length !== ERWARTETE_EVENTS) {
    throw new VerfassungsBruch(
      `F6-K: das Register fuehrt ${(register.events || []).length} Eintraege, erwartet `
      + `${ERWARTETE_EVENTS}.`);
  }
  const letzte = register.events[register.events.length - 1];
  if (letzte.runId !== ERWARTETER_LETZTER_RUNID || stand.tailHash !== ERWARTETER_TAIL) {
    throw new VerfassungsBruch(
      `F6-K: Kettenende ${letzte.runId}/${stand.tailHash}, erwartet `
      + `${ERWARTETER_LETZTER_RUNID}/${ERWARTETER_TAIL}.`);
  }
  if ((register.events || []).some((e) => e.runId === runId)) {
    throw new VerfassungsBruch(`F6-K: runId ${runId} steht bereits im Register.`);
  }
  const zp = (register.events || []).find((e) => e.runId === ZAEHLPROBE_RUNID);
  if (!zp || zp.eventHash !== ZAEHLPROBE_EVENTHASH) {
    throw new VerfassungsBruch('F6-K: der Zaehlproben-Akt fehlt oder traegt einen anderen Hash.');
  }
}

function baueEintrag(runId, registeredAt, wirksamAb, m) {
  const d = m.bericht.daten;
  return {
    runId,
    typ: ART_ZUGRIFF,
    registeredAt,
    accessedAt: wirksamAb,
    fenster: ['pruefung'],
    allowedOutputs: [
      ...DATEN_SCHLUESSEL,
      ...DIFFERENZ_UNTERSCHLUESSEL.map((k) => `differenz_punkte.${k}`),
    ],
    erlaubt:
      'GENAU EIN konfirmatorischer Lauf des F6-Auffindbarkeits-Tors auf dem PRUEFFENSTER '
      + '(panel-validierung.sqlite, Signalband 2017-01-01/2019-12-31, Panel-Rand 2020-12-31), je '
      + 'Signalvariante {S-U, S-G} x Arm {signal, kontrollpool}. Ausgegeben werden ausschliesslich '
      + 'die in allowedOutputs gelisteten DATEN-Felder je Variante x Arm plus die vier '
      + 'Unterschluessel des armuebergreifenden Objekts differenz_punkte (F6-C15). Die '
      + 'Umschlag-Felder fuehrt der Laeufer in einer EIGENEN Liste (F6-B10); Vermischen ist '
      + 'unzulaessig. DER LAUF FEUERT NICHT MIT DIESEM EINTRAG: er startet erst nach GRUENEM '
      + 'REVIEW dieses Eintrags-Akts (Bauordnung Schritt 8).',
    verboten:
      'Jeder zweite Lauf unter dieser runId; jede Beruehrung des Endtest-Fensters oder von '
      + 'Schluesselmaterial; jede Ausgabe ausserhalb von allowedOutputs (ein nicht gelisteter '
      + 'Schluessel ist ein ABBRUCH, kein Filter); jede Firmen-Kennung in irgendeiner Ausgabe, '
      + 'auch auf der Fehlerflaeche (F6-B14); jede Verwendung von 329/365 als Entscheidungsgroesse '
      + '(abstand_zu_329_von_365 ist BERICHTSANGABE, nie Verzweigungsgrundlage, F6-B13); jeder '
      + 'Rueckfall auf den kleineren SE, wenn eine der acht Nicht-berechenbar-Bedingungen reisst; '
      + 'jede nachtraegliche Aenderung an Laeufer, Zaehlwerk oder studie-zaehlprobe.py NACH diesem '
      + 'Eintrag (F6-C24(3)); jede Kalibrierzahl als gemessene Groesse; jedes Abfeuern des '
      + 'Endtests, auch bei BESTANDEN.',
    begruendung:
      'DER EINE KONFIRMATORISCHE AKT (Bauordnung Schritt 7). Der Akt wird nach ART benannt, nicht '
      + 'nach Ordinalzahl (F6-C22 / F6-C24(4)). '
      + 'AEQUIVALENZ-TOR BESTANDEN, VOR diesem Eintrag, unter eigenem Zaehlproben-Akt '
      + `${ZAEHLPROBE_RUNID} (eventHash ${ZAEHLPROBE_EVENTHASH}): alle drei Beine bit-identisch. `
      + 'Bein 1 LAUF-HAELFTE ueber das unveraenderte scripts/studie-e2-verbreitert.py '
      + '(durchlauf --modus alt): S-U 512/219, S-G 546/265, S-UG 29/12. Bein 1 ARTEFAKT-HAELFTE: '
      + 'NICHT GEFAHREN, SONDERN GEPRUEFT (Doppel-Hash plus Laufzeit-Konstanten-Abgleich). '
      + 'Bein 2 auf E3-Basis: S-U/signal 543/651/0, S-U/kontrollpool 3761/4514/0, S-G/signal '
      + '557/647/0, S-G/kontrollpool 5000/5768/0. Bein 3: fuenf Wortlaut-Literale ohne Panel-Lauf. '
      + 'BERICHTIGUNGEN, VOM GERICHT ENTSCHIEDEN UND NICHT VOM BAUENDEN STILL MITENTSCHIEDEN '
      + '(Form F6-C16): (I) F6-C7a — die Kalibrier-Groessen von Bein 1 sind KEINE '
      + 'ORIGINAL-Globals-Groessen; Beleg im selben Artefakt: aequivalenzTorSoll S-U firmen_reif '
      + '512 gegen jeFamilie S-U firmenReif 540 (und S-UG 29 gegen 30) — ein Lauf kann nicht '
      + 'beides liefern. (II) F6-C8b — die Zelle S-U/kontrollpool war aus den _kadenz-Spalten '
      + 'transkribiert; sie lautet 3761/4514/0 aus fallzahl/nenner_e3/zensiert_e3. Beleg: '
      + 'auffindbarkeit_e3 = 0.8331856446610545 = 3761/4514 gegen auffindbarkeit_kadenz = '
      + '0.8331486815865278 = 3760/4513. Beide Raten sind ENTDECKUNGSFENSTER-Groessen und stehen '
      + 'hier als Vermerk, nie als Ausgabewert. Berichtigt im eigenen Register-Akt '
      + `${ERWARTETER_LETZTER_RUNID}. `
      + 'EIN-EREIGNIS-MECHANISMUS (F6-C8h(1), ohne verbotene Groesse): genau ein Erst-Ereignis des '
      + 'Arms S-U/kontrollpool ist unter der Kadenzregel zensiert und unter 4 * 80 nicht, und es '
      + 'ist reif; unter der E4e-Quotientenregel verlaesst es Zaehler UND Nenner gemeinsam — daher '
      + '+1/+1/-1. Keine Firmenkennung, kein Datum, keine Prueffenster-Groesse. '
      + 'DIE KADENZ-BASIS (F6-C8h(2)), woertlich aus scripts/studie-e4d-kadenz.py:21-32: sie misst '
      + 'den Melderhythmus statt 4 * 80, mit einer Untergrenze von einem Fiskalquartal (365/4), '
      + 'und zensiert deshalb NIE weniger als E3; Zensierte fliegen dort aus Zaehler UND Nenner. '
      + 'Sie ist eine E4d/E4e-INSTRUMENTVARIANTE UNTER EIGENEM SIEGEL und ausdruecklich NICHT die '
      + 'von F6 vollstreckte 2.0.0-Regel. '
      + 'AKTENKETTE: Haupturteil (3:0) -> ORCHESTRATOR-NACHTRAEGE 1-3 -> ANHANG 1 '
      + '(Kalibrier-Haelfte) -> Anlauf 4 riss -> Forensik OHNE Eingriff (kein Sollwert angefasst, '
      + 'KZ-4 gewahrt) -> ANHANG 2 (Basis + Berichtigung) -> Berichtigungs-Vermerk -> dieser Akt. '
      + 'DREIMAL nacheinander wurde NICHT still weitergedeutet. Die Zahlenzitierung in ANHANG1:144 '
      + 'ERBT die Berichtigung aus ANHANG 2. '
      + 'NICHT BESCHLOSSEN und deshalb nicht vollzogen: A1s Glied c (Umformungs-Nachweis im Lauf) '
      + 'und die Aufnahme des Bericht-SHA 6ecf3ef2... in die Bindungsliste (ANHANG 1). '
      + 'F6-C6 bleibt Wort fuer Wort unangetastet; kalibriere(), im_band() und schwellen() werden '
      + 'nie gerufen. '
      + 'ERWARTUNGS-BLOCK: der Vorab-Erwartungsblock lebt im Vollzugs-Artefakt '
      + '(inhaltSha256 792f4ff5...) und wird REFERENZIERT, nicht neu gerechnet (F6-B26). '
      + 'Erzeugt von scripts/studie-f6-konfirmatorisch.js (eigenes Werkzeug je Register-Akt, '
      + 'F6-B8; Trockenlauf als Standard, kein --force). Alle Hashes am Objekt nachgerechnet — ein '
      + 'Urteil zitiert Hashes als Pruefauftrag, nie als Quelle. Ein-Appender-Regel: main-first '
      + 'per Mini-PR, danach Serverbeweis gegen main.',
    endtestSiegel:
      'unberuehrt und in ALLEN Zweigen ZU. Dieser Eintrag autorisiert EINEN Lauf auf dem '
      + 'Prueffenster und oeffnet weder Endtest-Fenster noch Schluesselmaterial noch Lueckenliste. '
      + 'Das Abfeuern des Endtests bleibt ein eigener Akt und braucht Karls ausdrueckliche '
      + 'Freigabe (F6-A16) — auch bei BESTANDEN gibt es KEINEN Automatismus.',

    // ── F6-B2: 1.2.0-Substanz als eigene Top-Level-Felder ────────────────
    eingabenHashes: { skripte: m.skripte, artefakte: m.artefakte,
      aequivalenzBericht: { datei: m.bericht.datei, dateiSha256: m.bericht.dateiSha256 } },
    gateEvidenz: {
      b4Artefakt: ARTEFAKTE['protocol/early-detection/2.1.0/b4-bandregel-2026-08-30.json'],
      b4InhaltSha256: INHALT_SHA['protocol/early-detection/2.1.0/b4-bandregel-2026-08-30.json'],
      seFreezeEintrag: 'f6-se-klumpen-freeze-2026-08-31 (Eintrag 24)',
      zaehlprobeEintrag: { runId: ZAEHLPROBE_RUNID, eventHash: ZAEHLPROBE_EVENTHASH },
      berichtigungsEintrag: { runId: ERWARTETER_LETZTER_RUNID, eventHash: ERWARTETER_TAIL },
    },
    researchCorpus: 'NICHT ANWENDBAR. Dieser Akt fuehrt keinen Literatur- oder Fremdkorpus; die '
      + 'Grundlage sind ausschliesslich die oben per SHA gebundenen Repo-Artefakte und das '
      + 'Prueffenster-Panel. Ein nicht anwendbares Pflichtfeld wird beantwortet, nie weggelassen '
      + '(F6-B2).',
    protocolManifestSha256: m.protocolManifestSha256,
    analysisCutoffAt: {
      form: 'JAHRGANGS-IDENTITAET, kein Zeitstempel. In keinem registrierten Artefakt existiert '
        + 'ein analysisCutoffAt-WERT; ihn zu setzen waere das von F6-B2 verbotene freie Setzen '
        + '(F6-C21).',
      jahrgang: 'legacy_earliest_archived',
      artefakt: 'protocol/early-detection/2.1.0/jahrgang-registrierung-2026-08-30.json',
      inhaltSha256: INHALT_SHA['protocol/early-detection/2.1.0/jahrgang-registrierung-2026-08-30.json'],
      registerEintrag: 'rr9-a3-jahrgang-registrierung-2026-08-30 (Eintrag 22)',
      panelDatei: 'panel-validierung.sqlite',
      panelBytes: 4447633408,
    },
    actor: 'Karl Viehrig (Auftraggeber, Freigabe-Inhaber) — ausgefuehrt durch den Nacht-Agenten '
      + 'der Session 07 unter dem Review-Tor des Orchestrators.',
    scope: 'GENAU EIN Fenster (pruefung) und GENAU EIN Tor (das F6-Auffindbarkeits-Tor, Schwelle '
      + '0,90, Bandbreite 1,0 SE*, Mindestfallzahl 200, plus das 10-Punkte-Kriterium als vierte '
      + 'konjunktive Bedingung). AUSDRUECKLICH NICHT die acht Tests: keine p-Werte, keine '
      + 'Teststatistiken, keine Bootstrap-Verteilungen, keine Konfidenzintervalle der acht Tests.',
    purpose: 'Der EINE konfirmatorische F6-Lauf unter Kontingent EINS (K2/A10). Nach diesem Lauf '
      + 'ist das Kontingent verbraucht; eine weitere Prueffenster-Beruehrung braucht einen eigenen, '
      + 'neuen Akt.',

    // ── Anhang-1-Feldform ────────────────────────────────────────────────
    aequivalenzTor: {
      bestanden: true,
      laufAm: { ersterZugriffAm: m.bericht.ersterZugriffAm, beendetAm: m.bericht.beendetAm },
      registerEintragDerZaehlprobe: { runId: ZAEHLPROBE_RUNID, eventHash: ZAEHLPROBE_EVENTHASH },
      registerEintragDerBerichtigung: { runId: ERWARTETER_LETZTER_RUNID,
        eventHash: ERWARTETER_TAIL },
      laufHaelfte: {
        soll: { 'S-U': { firmen_reif: 512, firmen_unreif: 219 },
          'S-G': { firmen_reif: 546, firmen_unreif: 265 },
          'S-UG': { firmen_reif: 29, firmen_unreif: 12 } },
        gemessen: {
          'S-U': { firmen_reif: d['aequivalenzTorSoll.S-U.firmen_reif'],
            firmen_unreif: d['aequivalenzTorSoll.S-U.firmen_unreif'] },
          'S-G': { firmen_reif: d['aequivalenzTorSoll.S-G.firmen_reif'],
            firmen_unreif: d['aequivalenzTorSoll.S-G.firmen_unreif'] },
          'S-UG': { firmen_reif: d['aequivalenzTorSoll.S-UG.firmen_reif'],
            firmen_unreif: d['aequivalenzTorSoll.S-UG.firmen_unreif'] },
        },
        bestanden: true,
        werkzeug: 'scripts/studie-e2-verbreitert.py, durchlauf --modus alt, Ausgabe nur nach '
          + '--ergebnis, nie ins Artefakt (F6-C7b)',
      },
      artefaktHaelfte: {
        form: 'NICHT GEFAHREN, SONDERN GEPRUEFT',
        dateiSha256: ARTEFAKTE['protocol/early-detection/2.1.0/e2-schwellen-satz-2026-08-30.json'],
        inhaltSha256: INHALT_SHA['protocol/early-detection/2.1.0/e2-schwellen-satz-2026-08-30.json'],
        konstantenAbgleichBestanden: true,
        kalibrierZahlen: { 'S-U': { kalibrierungsWeg: '1109 (P90) -> 540 (P95)',
          auswertbarImBand: 68079, firmenReif: 540, firmenUnreif: 226 },
        'S-G': { kalibrierungsWeg: '1309 (P90) -> 546 (P95)', auswertbarImBand: 82642,
          firmenReif: 546, firmenUnreif: 265 } },
        hinweis: 'Die Kalibrier-Groessen stammen aus dem Durchlauf verbreitertOhneBank, NICHT aus '
          + 'ORIGINAL-Globals (F6-C7a). Sie sind KEINE gemessene Groesse dieses Akts.',
      },
      bein2: {
        basis: 'E3 nach preregistration.json:80 (Zensur) und :87 (Netto-Nenner). Die '
          + 'KADENZ-/E4e-Basis regiert Bein 2 NICHT (F6-C8a).',
        armAbbildung: 'F6 "signal" -> "signal"; F6 "kontrollpool" -> Artefaktschluessel '
          + '"kontrolle" (ausgeschrieben, nicht erschlossen — F6-C8c)',
        spaltenpfad: 'baender["2009-2015"].varianten[<Variante>].<signal|kontrolle>'
          + '.{fallzahl,nenner_e3,zensiert_e3}',
        zellen: {
          'S-U/signal': { zaehler: 543, nenner: 651, zensiert: 0 },
          'S-U/kontrollpool': { zaehler: 3761, nenner: 4514, zensiert: 0 },
          'S-G/signal': { zaehler: 557, nenner: 647, zensiert: 0 },
          'S-G/kontrollpool': { zaehler: 5000, nenner: 5768, zensiert: 0 },
        },
        basisblind: 'DREI der vier Zellen sind basisblind (e3 == kadenz). Ihr Bestehen traegt '
          + 'KEINE Evidenz zur Basisfrage; nur S-U/kontrollpool trennt die Basen (F6-C8g(4)).',
        referenz: { datei: 'reports/studie/E4d-kadenz-entdeckung-2026-08-19.json',
          dateiSha256: ARTEFAKTE['reports/studie/E4d-kadenz-entdeckung-2026-08-19.json'] },
      },
      bein3: 'Fuenf Wortlaut-Literale aus preregistration.json, ohne Panel-Lauf (F6-C9).',
    },

    // ── Fenster, Rand, Arbeitspfad ───────────────────────────────────────
    fensterVon: '2017-01-01',
    fensterBis: '2019-12-31',
    panelRand: '2020-12-31',
    panelRandHerkunft:
      'ABGELEITET, NICHT GESETZT. preregistration.json:298 "Fuer das Pruefenster heisst das: '
      + 'Signalband 2017-2019, Reife bis 2020-12-31." und :95 "pruefung": "2017-01-01/2019-12-31 '
      + '(Signalfenster) mit Pufferjahr 2020 fuer die Reife"; rules.json (dc008723...) '
      + 'fenster.validierung 2017q1..2019q4 und pufferjahre [2016, 2020]; Reife = vier '
      + 'Folgequartale (preregistration.json:75-77); Schnitt realisiert in '
      + 'scripts/studie-panel-bau.py:99. scripts/studie-zaehlprobe.py:97 ist NUR Korroboration, '
      + 'nie Quelle (F6-C20). SIGNALBAND und PANEL-RAND sind getrennt gefuehrt und gegeneinander '
      + 'verriegelt (F6-C22): ein Erst-Ereignis mit accepted im Pufferjahr 2020 ist ein ABBRUCH, '
      + 'kein Sonderfall. Der Laeufer leitet den Rand zur Laufzeit ab und haelt ihn gegen die '
      + 'gebundene Konstante; Abweichung = fail-closed (F6-C23).',
    panelDigest: {
      datei: 'panel/panel-validierung.sqlite',
      groesseBytes: 4447633408,
      sha256: '0330f8154608791cf3d56069b8219a67f0ea1084d55fcfb57b09fd1016418c4c',
      dauerSekunden: 5.672,
      werkzeug: 'scripts/studie-panel-digest.py',
      werkzeugSha256: SKRIPTE['scripts/studie-panel-digest.py'],
      hinweis: 'Streaming-SHA-256 ueber die BYTES, SQL-frei (F6-B6). Die Groesse ist gegen die '
        + '4.447.633.408 B aus Eintrag 22 verriegelt — die Kante haengt an Bytes, nicht an einem '
        + 'Datum in einer Datei (F6-C23).',
    },
    arbeitspfad: {
      kurzform: 'f6-arbeit',
      lage: 'unmittelbar im Nutzerverzeichnis des Auftraggebers, AUSSERHALB des Repos',
      gebundenAn: 'ARBEITSPFAD_VORGABE in scripts/studie-f6-zaehlwerk.py, dessen SHA dieser '
        + 'Eintrag oben bindet. Dort steht der vollstaendige Pfad — aus Fragmenten gebaut, weil '
        + 'der R12a-Deckel das Literal verbietet.',
      warumNichtAusgeschrieben:
        'R12a untersagt absolute Pfade und Nutzerverzeichnisse in einem 2.0.0-Artefakt. F6-C5 '
        + 'verlangt, dass der Pfad VORHER benannt und nicht zur Laufzeit entdeckt wird — beides '
        + 'ist erfuellt: benannt ist er in der Weisung und in der gehashten Konstante, und der '
        + 'Hash pinnt ihn genauer als ein abgeschriebenes Literal es koennte.',
      geprueft: 'VERBOTEN_RE-frei bis in die Elternverzeichnisse, ausserhalb des Repos; vor der '
        + 'Freigabe geprueft und benannt, nicht zur Laufzeit entdeckt (F6-C5 / KZ-3).' },

    // ── Ausgabesatz, Zweige, Differenz ───────────────────────────────────
    ausgabesatz: {
      datenSchluesselJeVarianteUndArm: DATEN_SCHLUESSEL,
      variantenSchluessel: ['differenz_punkte'],
      differenzUnterschluessel: DIFFERENZ_UNTERSCHLUESSEL,
      umschlagIstEigeneListe: 'Die Umschlag-Felder fuehrt der Laeufer in einer EIGENEN '
        + 'UMSCHLAG_ALLOWLIST (F6-B10). Vermischen ist der Mechanismus, durch den der '
        + 'Zaehlproben-Satz zu breit wurde.',
      zweigPflichtTeilmengen: {
        gate_gerissen: 'DATEN_SCHLUESSEL minus {bandbreite_absolut, abstand_zu_329_von_365, '
          + 'etikett}',
        im_band: 'DATEN_SCHLUESSEL minus {etikett}',
        ausserhalb_band: 'DATEN_SCHLUESSEL minus {pflichtsatz, zweitsatz} — BESTANDEN und NICHT '
          + 'BESTANDEN tragen DIESELBE Schluesselmenge',
        warnung: 'Die Prosa-Kurzform "ohne abstand" ist UNZULAESSIG: abstand_zu_090 IST im Zweig '
          + 'gate_gerissen (als None) und darf nicht fehlen; nicht gefuehrt wird '
          + 'abstand_zu_329_von_365 (F6-C17).',
        nullIstAnwesend: 'Im Zweig gate_gerissen sind se_stern, se_entschied und abstand_zu_090 '
          + 'VORHANDEN, aber NULL; ebenso wilson95_unten/oben bei messbar = false. F6-B15 prueft '
          + 'ANWESENHEIT, nicht Wert. Weglassen statt None ist ein Pflichtschluessel-ABBRUCH '
          + '(F6-C19).',
        differenzEbene: 'differenz_punkte liegt auf VARIANTEN-Ebene und beruehrt die drei '
          + 'Zweig-Teilmengen NICHT (F6-C19). Ein Arm kennt die Differenz allein gar nicht.',
      },
      anker: ANKER,
    },
    differenzRegeltext: {
      quelle: 'protocol/early-detection/2.0.0/preregistration.json:88 — "gate": {"minimum": 0.9, '
        + '"gilt": "Signal-Arm UND Kontrollpool", "maxDifferenzPunkte": 10}',
      zusammensetzung: [
        'Beide Arm-Bandverdikte BESTANDEN UND differenz_punkte <= 10 -> Tor gehalten, WEITER = 1',
        'Ein Arm NICHT UNTERSCHEIDBAR -> NICHT UNTERSCHEIDBAR, WEITER = 0 (das Messgeraet hat '
        + 'nicht getrennt; die Bandfolge dominiert)',
        'Ein Arm NICHT BESTANDEN -> Tor gerissen, WEITER = 0',
        'Beide BESTANDEN, aber differenz_punkte > 10 -> Tor gerissen nach '
        + 'preregistration.json:139 (INCONCLUSIVE_DATA, kein p-Wert), WEITER = 0',
      ],
      gleichheitBesteht: '<= 10: exakt 10,0 Punkte reissen NICHT. Keine Rundung vor dem '
        + 'Vergleich (Hauskonvention studie-vb-b4-band.py:198-199).',
      einheit: 'PUNKTE gegen 10, nie Anteile gegen 0,1 — der Laeufer rechnet '
        + 'abs(a_sig - a_kon) * 100.0. Ein Faktor-100-Fehler kippt hier das Verdikt.',
      keinBandKeinSE: 'Kein Band, kein SE und kein Ermessen auf der Differenz — ein Band um die '
        + 'Differenz waere die von Eintrag 23 verbotene Neuableitung.',
      richtung: 'RICHTUNGS-OFFENLEGUNG (Form F6-B21): die Zusammensetzung kann WEITER nur '
        + 'ERSCHWEREN, nie erzeugen. Aussage ueber die Richtung der REGEL, nicht ueber den '
        + 'Ausgang des Laufs.',
      entschiedenVom: 'Gericht (_COURT-F6-ZAEHLWERK-2026-09-01, Frage (B), 3:0, F6-C13..C16) — '
        + 'nicht vom Bauenden still mitentschieden.',
    },
    richtungsOffenlegungBerichtigung: {
      satz1: 'Diese Berichtigung ENTFERNT an genau einer Zelle einen stehenden STOPP',
      satz2: 'Die Unerfuellbarkeit wurde hier nicht vor, sondern DURCH einen Lauf entdeckt',
      ausgleich: 'Der entfernte STOPP war ein totes Tor (ein Soll, das die gebundene Kette nie '
        + 'erfuellen kann, prueft nichts); die Abbruchgruende aus F6-C8d sind zusaetzlich. '
        + 'Netto-Bilanz der Abbruchgruende: +2. Aussage ueber die Richtung der REGEL, nie ueber '
        + 'den Ausgang des Laufs (F6-C8i).',
    },
    restrisiko: {
      'F6-C7g(c)': 'Die RICHTIGKEIT der eingefrorenen Ableitung selbst ist nicht bewiesen — kein '
        + 'Hash und kein Bein zeigt, dass kalibriere() am 30.08. richtig gerechnet hat. Bewiesen '
        + 'ist die UNVERAENDERTHEIT der eingefrorenen Bytes, nicht die Wahrheit der Zahlen darin.',
      'F6-C7g(d)': 'Das ENTDECKUNGS-Panel traegt KEINEN registrierten Byte-Pin; nur das '
        + 'Validierungs-Panel hat einen (4.447.633.408 B, Eintrag 22).',
      'F6-C7g(e)': 'Dass reports/studie/E2-verbreitert-2026-08-30.json aus einem echten Panel-Lauf '
        + 'stammt, traegt sein eigenes bestandenes Tor plus BEIN 2 — nicht dieses Bein.',
      'F6-C8j(f)': 'Bein 2 beweist die Reproduktion der E3-Basis-Zellen durch die F6-Kette — NICHT '
        + 'die Richtigkeit des E4d-Laufs vom 19.08. selbst.',
      'F6-C8j(g)': 'Bein 2 beweist NICHTS ueber das Kadenz-Instrument; dieses bleibt fuer F6 '
        + 'ausser Betracht.',
      'F6-C8j(h)': 'Das Entdeckungs-Panel traegt weiterhin keinen registrierten Byte-Pin — '
        + 'unveraendert als Restrisiko ausgewiesen, nicht wegargumentiert.',
      'F6-C11(a)': 'Der (m_g, n_g)-Tally selbst ist neue Ausgabe ohne Vorgaenger; gedeckt nur '
        + 'durch die Kreuzproben und W-C.',
      'F6-C11(b)': 'Datenformen, die ausschliesslich im Prueffenster vorkommen, sind durch einen '
        + 'Lauf auf dem Entdeckungs-Panel NICHT substituierbar.',
    },
    vorabDeterminiertheit:
      'F6-B25 (vorab, nicht als Befund): Gilt n_g = 1 fuer alle g — die nach PIN 3 erwartete Lage '
      + '—, dann faellt se_entschied KONSTRUKTIV auf SE_klumpen-robust, und die A16-Pflicht '
      + '"welcher entschied" ist dort formal, nicht materiell erfuellt. Tritt doch ein Klumpen mit '
      + 'n_g > 1 auf, entfaellt diese Feststellung (KV-6) und die Pflichtangabe wird materiell; '
      + 'das ist kein Anhalte-Grund, aber der Bericht fuehrt dann die andere Fassung. '
      + 'Ausserdem F6-B25-Form: n_B_unreif und strukturell_nicht_feuerfaehig tragen in dieser '
      + 'Tally-Form DIESELBE Zahl; fuer den zweiten existiert in keinem registrierten Artefakt '
      + 'eine allgemeine Definition, ein zweiter Rechenweg waere erfunden. Beide Schluessel '
      + 'bleiben im Satz; ein Kreuz-Wachposten macht jede Divergenz zum ABBRUCH.',
    erwartungsblock:
      'REFERENZIERT, NICHT NEU GERECHNET (F6-B26): der Vorab-Erwartungsblock (Spanne 60-85 %, '
      + 'NICHT-BESTANDEN-Ast) lebt im Vollzugs-Artefakt '
      + 'protocol/early-detection/2.1.0/f6-vollzug-zweig-a-2026-08-31.json, inhaltSha256 '
      + `${INHALT_SHA['protocol/early-detection/2.1.0/f6-vollzug-zweig-a-2026-08-31.json']}. `
      + 'Kein Satz dieses Eintrags sagt etwas ueber die Richtung der kuenftigen Messung.',
    laufFreigabe:
      'DER LAUF FEUERT NICHT MIT DIESEM EINTRAG. Er startet erst nach GRUENEM REVIEW dieses '
      + 'Eintrags-Akts (Bauordnung Schritt 8) — Karls "feuert nach gruenem Review", angewandt auf '
      + 'den konfirmatorischen Eintrag. Nach der Anmeldung darf kein Byte mehr an Laeufer, '
      + 'Zaehlwerk oder studie-zaehlprobe.py geaendert werden (F6-C24(3)).',
  };
}

// R12a an der Schreib-Grenze. Positiv geprueft: gesucht wird, was NICHT drin
// sein darf, nicht das Fehlen von etwas Erwartetem. Der Riegel haengt am
// fertigen Objekt, damit kein spaeter ergaenztes Feld an ihm vorbeikommt.
function pruefeKeinNutzerpfad(obj) {
  // Geprueft werden die WERTE im Baum, nicht ihre JSON-Schreibweise: in
  // JSON.stringify wird aus einem Rueckstrich ein Paar, und ein Muster mit
  // genau EINEM Trennzeichen greift dann an `\\Users\\X` vorbei. Genau diese
  // Verdopplung hat in diesem Repo schon einmal ein gruenes Ergebnis
  // vorgetaeuscht — deshalb wird hier der geparste Baum abgelaufen.
  const werte = [];
  (function sammle(v) {
    if (typeof v === 'string') werte.push(v);
    else if (Array.isArray(v)) v.forEach(sammle);
    else if (v && typeof v === 'object') {
      for (const [k, w] of Object.entries(v)) { werte.push(k); sammle(w); }
    }
  }(obj));
  // Die Zeichenklasse wird aus chr(92) gebaut und NICHT als Literal getippt:
  // ein Rueckstrich ueberlebt den Weg durch Heredoc und Patch-Werkzeug nicht
  // zuverlaessig, und ein stillschweigend zu `[\/]` geschrumpftes Muster
  // haette hier genau den Fehler durchgelassen, den es fangen soll.
  const BS = String.fromCharCode(92);
  const S = `[${BS}${BS}/]`;          // Rueckstrich ODER Schraegstrich
  // Die Muster sind die des Deckels (tests/studie-deckel.test.js, PFAD_MUSTER),
  // nicht selbst erfundene. Der erste Entwurf hier war gleichzeitig zu eng
  // (nur Schraegstrich, weil ein Rueckstrich im Patch kollabierte) und zu
  // breit (er schlug bei "https://" an, weil "s:/" ihm genuegte). Der
  // fuehrende Trenner ist deshalb Teil des Musters.
  const MUSTER = [
    ['Windows-Laufwerkspfad', new RegExp(`\\b[A-Za-z]:${S}{1,2}Users\\b`)],
    ['Windows-Nutzerverzeichnis', new RegExp(`${S}Users${S}[A-Za-z]`)],
    ['Unix-Heimverzeichnis', new RegExp(`(^|[\\s"'(=])/${['ho', 'me'].join('')}/[a-z]`, 'm')],
    // Aus Fragmenten, weil der Deckel AUCH diese Datei liest: ein
    // ausgeschriebenes Umgebungs-Muster machte den Riegel zu seinem eigenen
    // Verstoss. Dasselbe galt schon fuer das Heim-Muster eine Zeile hoeher.
    ['Umgebungs-Nutzerpfad',
      new RegExp(`%${['USER', 'PROFILE'].join('')}%|\\$${['HO', 'ME'].join('')}\\b`)],
    ['Windows-Laufwerkspfad, beliebiges Ziel',
      new RegExp(`(^|[\\s"'(=[,])[A-Za-z]:${S}{1,2}[A-Za-z0-9_.-]`, 'm')],
  ];
  for (const [name, regex] of MUSTER) {
    for (const wert of werte) {
      const treffer = regex.exec(wert);
      if (treffer) {
        throw new VerfassungsBruch(
          `F6-K: der Eintrag traegt ${name} (${treffer[0]}). R12a verbietet das in einem `
          + '2.0.0-Artefakt; der Pfad gehoert in eine gehashte Konstante, nicht ins Register.');
      }
    }
  }
}

// Das Schritt-8-Review hat Eintrag 27 aus DREI Spuren ROT gegeben. Er wird
// durch einen vollstaendigen Eintrag 28 ERSETZT, und der ist ein EIGENER Akt
// nach ANHANG 3 mit eigenem Werkzeug (F6-B8). Dieses Werkzeug hier hat seine
// Aufgabe erfuellt und darf keinen zweiten Eintrag mehr bauen: seine
// Bindungsliste beschreibt einen Stand, den PR G bewusst veraendert hat.
// Es wird NICHT geloescht — es ist der Beleg dafuer, wie Eintrag 27 entstand.
const UEBERHOLT = 'F6-K: UEBERHOLT. Eintrag 27 (f6-konfirmatorisch-2026-09-01) '
  + 'ist durch das Schritt-8-Review ueberholt und wird durch Eintrag 28 ersetzt. '
  + 'Dieses Werkzeug baut den ueberholten Eintrag und ist deshalb stillgelegt; '
  + 'seine gebundenen SHAs beschreiben den Stand VOR PR G. Eintrag 28 ist ein '
  + 'eigener Akt nach ANHANG 3 mit eigenem Werkzeug.';

function haupt(argv) {
  if (argv.includes('--force')) throw new VerfassungsBruch('F6-K: --force gibt es nicht (F6-B8).');
  throw new VerfassungsBruch(UEBERHOLT);
  const schreiben = argv.includes('--schreiben');
  const registerPfad = argument(argv, 'register') || LEDGER;
  const dateiWurzel = argument(argv, 'wurzel') || WURZEL;
  const runId = argument(argv, 'runid') || RUN_ID;

  const jetzt = new Date();
  const anmeldeArg = argument(argv, 'anmeldezeit');
  const registeredAt = anmeldeArg ? new Date(anmeldeArg).toISOString() : jetzt.toISOString();
  if (Date.parse(registeredAt) > jetzt.getTime()) {
    throw new VerfassungsBruch(`F6-K: --anmeldezeit ${registeredAt} liegt in der Zukunft.`);
  }
  const wirksamAb = argument(argv, 'wirksam-ab')
    ? new Date(argument(argv, 'wirksam-ab')).toISOString()
    : new Date(Date.parse(registeredAt) + VORLAUF_MINUTEN * 60 * 1000).toISOString();
  if (Date.parse(wirksamAb) <= Date.parse(registeredAt)) {
    throw new VerfassungsBruch(`F6-K: --wirksam-ab muss NACH der Anmeldung liegen.`);
  }

  const register = lies(registerPfad);
  const stand = pruefeZugriffsRegister(register);
  pruefeKette(register, stand, runId);
  const m = pruefeAlles(dateiWurzel);

  const eintrag = baueEintrag(runId, registeredAt, wirksamAb, m);
  pruefeKeinNutzerpfad(eintrag);
  const neu = haengeEintragAn(register, eintrag);
  pruefeZugriffsRegister(neu);
  const fertig = neu.events[neu.events.length - 1];

  process.stdout.write(
    'Akt           DER KONFIRMATORISCHE EINTRAG (Bauordnung Schritt 7)\n'
    + `runId         ${runId}\n`
    + `typ           ${ART_ZUGRIFF}\n`
    + `fenster       ["pruefung"]   allowedOutputs ${eintrag.allowedOutputs.length} Schluessel\n`
    + `Skripte       ${Object.keys(SKRIPTE).length} gebunden, alle am Objekt nachgerechnet\n`
    + `Artefakte     ${Object.keys(ARTEFAKTE).length} gebunden (+${Object.keys(INHALT_SHA).length} inhaltSha256)\n`
    + `Bericht       ${m.bericht.dateiSha256}\n`
    + `Panel-Digest  4.447.633.408 B, 0330f815...\n`
    + `Arbeitspfad   ${ARBEITSPFAD}\n`
    + `Kettenende vor dem Eintrag: ${ERWARTETER_LETZTER_RUNID} / ${ERWARTETER_TAIL}\n`
    + `PRUEFZEILE: "previousHash": "${fertig.previousHash}"\n`
    + `eventHash dieses Eintrags: ${fertig.eventHash}\n`
    + `Eintraege nach dem Anhaengen: ${neu.events.length}\n\n`);

  if (!schreiben) {
    process.stdout.write('TROCKENLAUF - es wurde NICHTS geschrieben.\n');
    return 0;
  }
  writeFileAtomic(registerPfad, `${JSON.stringify(neu, null, 1)}\n`, 'utf8');
  const zurueck = lies(registerPfad);
  pruefeZugriffsRegister(zurueck);
  if (zurueck.events[zurueck.events.length - 1].eventHash !== fertig.eventHash) {
    throw new VerfassungsBruch('F6-K - HALT: das Register auf der Platte weicht ab.');
  }
  process.stdout.write(`GESCHRIEBEN: ${registerPfad}\n`);
  return 0;
}

module.exports = { pruefeKeinNutzerpfad, SKRIPTE, ARTEFAKTE, INHALT_SHA, INHALT_MODUS, DATEN_SCHLUESSEL,
  DIFFERENZ_UNTERSCHLUESSEL, ANKER, ARBEITSPFAD, RUN_ID, ERWARTETER_TAIL,
  ZAEHLPROBE_EVENTHASH, MANIFEST_SHA, BERICHT_REL, haupt };

if (require.main === module) {
  try {
    process.exit(haupt(process.argv.slice(2)));
  } catch (fehler) {
    process.stderr.write(`${fehler.message}\n`);
    process.exit(1);
  }
}
