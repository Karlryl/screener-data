#!/usr/bin/env node
'use strict';

// Studie 2.0, F6-Tor — Bauordnung Schritt 2: der Zaehlproben-Akt fuer den
// AEQUIVALENZ-LAUF auf dem Entdeckungs-Panel.
// (_COURT-F6-ZAEHLWERK-2026-09-01, Bauordnung Schritt 2, Auflagen F6-C7/C8/C9;
// ratifiziert Session 07, 2026-09-01 02:22 lokal, ORCHESTRATOR-NACHTRAG 1.)
//
// DIE SACHE: protocol/early-detection/2.0.0/outcome-access-ledger.json ist
// nur-anhaengend, verkettet und extern bezeugt. Ein falscher Eintrag ist nicht
// korrigierbar, nur ergaenzbar. Deshalb ist der Trockenlauf hier der STANDARD:
// ohne Flagge liest das Werkzeug, prueft die ganze Kette, baut den Eintrag im
// Speicher, rechnet seinen eventHash aus und druckt ihn — und schreibt nichts.
// Erst `--schreiben` haengt an. Es gibt KEIN --force und keine Reparatur-
// Betriebsart (F6-B8). Ein EIGENES Werkzeug je Register-Akt; das Werkzeug fuer
// Eintrag 24 ist verbraucht.
//
// WAS DIESER EINTRAG IST — UND WAS NICHT. Er autorisiert GENAU EINE Zaehlung
// auf dem ENTDECKUNGS-Fenster: den dreibeinigen Aequivalenz-Lauf, der VOR
// jedem Prueffenster-Byte beweisen muss, dass das neue Instrument die
// publizierten Zahlen bit-identisch reproduziert. Er autorisiert KEINEN Blick
// ins Prueffenster, keinen konfirmatorischen Lauf und kein Siegel.
//
// WARUM F6-A1..A3 HIER NICHT BINDEN: sie zielen auf das Prueffenster. Das
// Entdeckungsfenster steht offen in `rules.json` (`fenster.entdeckung`,
// 2009q1..2015q4, `versiegelt: false`). Und F6-A8: dieser Akt verbraucht
// KEIN Kontingent — das K2-Kontingent EINS gilt der Prueffenster-Beruehrung,
// die hier nicht stattfindet.
//
// ALLE SOLLWERTE UNTEN SIND GEGEN origin/main 347f0e8e08 NACHGERECHNET (der
// Stand NACH dem Merge von PR #192), nicht aus dem Urteilsdokument uebernommen:
// ein Urteil zitiert Hashes als Pruefauftrag, nie als Quelle.
//
// Aufruf:
//   node scripts/studie-f6-aequivalenz-anmeldung.js              # Trockenlauf (Standard)
//   node scripts/studie-f6-aequivalenz-anmeldung.js --schreiben  # anhaengen, dann Mini-PR
// Optionen: --runid, --wirksam-ab <ISO>, --anmeldezeit <ISO>,
//           --register <pfad>, --wurzel <pfad> (nur fuer Tests)

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { writeFileAtomic } = require('../lib/atomic-write.js');
const {
  VerfassungsBruch,
  haengeEintragAn,
  pruefeZugriffsRegister,
  ART_ZAEHLPROBE,
} = require('../lib/studie-verfassung.js');

const WURZEL = path.join(__dirname, '..');
const relPfad = (rel) => path.join(WURZEL, ...rel.split('/'));
const LEDGER_REL = 'protocol/early-detection/2.0.0/outcome-access-ledger.json';
const LEDGER = relPfad(LEDGER_REL);

// ── Sollwerte, UNABHAENGIG von den geprueften Dateien notiert ───────────────
// Ein Werkzeug, das seine Sollwerte aus der Datei liest, die es pruefen soll,
// prueft nichts.

const RUN_ID = 'f6-aequivalenz-entdeckung-2026-09-01';
const ERWARTETER_LETZTER_RUNID = 'f6-se-klumpen-freeze-2026-08-31';
const ERWARTETER_TAIL = 'e9e0eeb3edcf5ac2af64bdd054ba6f2c28be9e82e30ec5eaff9e8c718e64ed8d';
const ERWARTETE_EVENTS = 24;
const VORLAUF_MINUTEN = 120;

// Die ausfuehrenden Skripte, gemessen auf main NACH dem #192-Merge.
const SKRIPTE = [
  ['scripts/studie-f6-zaehlwerk.py',
    '826306e6cf72e02d0b1807db4e1d8aaa15436dbdccfc0e15d779c485cfd2a721'],
  ['scripts/studie-f6-lauf.py',
    '36664e70128fe02c114e5cdaa81c394091bb8fae809940f109dbc6abe7a168d0'],
  ['scripts/studie-zaehlprobe.py',
    'a3fce5a1672e231fe12d7d7ffc8a3655ad8e3ef9b3bd2a2195e1af5fcbdbf17b'],
  ['scripts/studie-basisraten.py',
    '997a80d26871937f848b3eea76a9b4ba1a4e1c76f1cc3c30db98d7888ec2601d'],
];

// Die beiden Vergleichs-Artefakte der Beine 1 und 2.
const BEIN1_QUELLE_REL = 'protocol/early-detection/2.1.0/e2-schwellen-satz-2026-08-30.json';
const BEIN1_QUELLE_SHA = '80798025d2ad6387b3ed72048227112426369ec8392ae633a92df58f0cf4d1e5';
const BEIN2_QUELLE_REL = 'reports/studie/E4d-kadenz-entdeckung-2026-08-19.json';
const BEIN2_QUELLE_SHA = '46e191ec68e0480a336fd287dc548c8b6a975b8d50a07c6e0162274c6dbd8fdf';

// Das Urteil, im Stand VOR seiner Ratifikation — genau der Byte-Beweis, den
// ORCHESTRATOR-NACHTRAG 1 nennt (92.276 B, hier nachgerechnet).
const URTEIL_SHA = '013c401c958bb502cc2149bc10d9081e5a1f3efc2d34a9100f178e25be116e4d';

// ANHANG 1, im Stand VOR seiner Ratifikation - der Byte-Beweis aus seinem
// ORCHESTRATOR-NACHTRAG 1. Er berichtigt F6-C7 (als F6-C7a..i) und ist die
// Autoritaet fuer die Zweiteilung von Bein 1.
const ANHANG_SHA = '78a3c758c1e21afcd62a5c5c7881cffbeadebc9ca1b6d361c1341326a958f591';
const ANHANG_BYTES = 55840;

// Der ERZEUGER des Schwellen-Satzes. Er ist AUSFUEHREND nur fuer die
// torSoll-Haelfte (F6-C7b); fuer die Kalibrier-Haelfte wird er NICHT gerufen
// (F6-C7e) und gilt dort ausschliesslich als Erzeuger-Bindung des Artefakts.
const VERBREITERT_REL = 'scripts/studie-e2-verbreitert.py';
const VERBREITERT_SHA = '9a24ed94e943e9a6f5b4a1373ba6c6aa2001ddadb2d60a705277bf5eb359984b';

// ── Die Allowlist (Bauordnung Schritt 2), EXAKT und abschliessend ───────────
// Die Aequivalenz-Zahlen der Beine 1 und 2, `bestanden` und die drei
// Skript-Hashes. NICHTS SONST. Ein nicht gelisteter Schluessel ist ein
// ABBRUCH, kein Filter (preregistration.json:232).
//
// Bein 3 emittiert keine ZAHL — es prueft Wortlaut-Literale und geht in
// `bestanden` ein; deshalb steht es hier zu Recht nicht mit eigenen Feldern.
const BEIN1_ZELLEN = ['S-U', 'S-G', 'S-UG'];
const BEIN2_ZELLEN = ['S-U/signal', 'S-U/kontrollpool', 'S-G/signal', 'S-G/kontrollpool'];

const ALLOWED_OUTPUTS = [
  // 1. Bein-1-LAUF-Haelfte: die sechs torSoll-Zahlen. NUR diese - die
  //    Kalibrierzahlen sind KEINE gemessene Groesse dieses Akts (F6-C7i).
  ...BEIN1_ZELLEN.flatMap((v) => [
    `aequivalenzTorSoll.${v}.firmen_reif`, `aequivalenzTorSoll.${v}.firmen_unreif`]),
  // 2. Bein 2: die vier (zaehler, nenner, zensiert)-Tripel aus F6-C8.
  ...BEIN2_ZELLEN.flatMap((z) => [
    `bein2.${z}.zaehler`, `bein2.${z}.nenner`, `bein2.${z}.zensiert`]),
  // 3./4.
  'bestanden',
  'modulSha256',
  'zaehlwerkSha256',
  'zaehlprobeSha256',
  // 5. STATT der Kalibrierzahlen: die zwei Hashes der Artefakt-Haelfte plus
  //    das Feld, das ausspricht, dass dort NICHTS gefahren wurde.
  'schwellenDateiSha256',
  'schwellenInhaltSha256',
  'kalibrierHaelfteGeprueft',
];

// F6-C7i, woertlich: der Wert, den das Feld tragen MUSS.
const KALIBRIER_HAELFTE_GEPRUEFT = 'ARTEFAKT-HASH + KONSTANTEN-ABGLEICH, KEIN LAUF';

// Die Sollzahlen selbst gehen als eigenes Feld mit — sie sind der Gegenstand
// des Laufs und muessen VOR ihm im Register stehen, sonst waere "bit-identisch"
// nachtraeglich behauptet statt vorher festgelegt.
const BEIN1_SOLL = {
  'S-U': { firmen_reif: 512, firmen_unreif: 219 },
  'S-G': { firmen_reif: 546, firmen_unreif: 265 },
  'S-UG': { firmen_reif: 29, firmen_unreif: 12 },
};
const BEIN2_SOLL = {
  'S-U/signal': { zaehler: 543, nenner: 651, zensiert: 0 },
  'S-U/kontrollpool': { zaehler: 3760, nenner: 4513, zensiert: 1 },
  'S-G/signal': { zaehler: 557, nenner: 647, zensiert: 0 },
  'S-G/kontrollpool': { zaehler: 5000, nenner: 5768, zensiert: 0 },
};

// ── Werkzeug ────────────────────────────────────────────────────────────────

function argument(argv, name) {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return null;
  const wert = argv[i + 1];
  if (!wert || wert.startsWith('--')) {
    throw new VerfassungsBruch(`F6-AEQ: --${name} ohne Wert.`);
  }
  return wert;
}

function lies(pfad) {
  if (!fs.existsSync(pfad)) {
    throw new VerfassungsBruch(`F6-AEQ: Register nicht gefunden: ${pfad}`);
  }
  return JSON.parse(fs.readFileSync(pfad, 'utf8'));
}

const dateiHash = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

function pruefeTail(register, stand) {
  if ((register.events || []).length !== ERWARTETE_EVENTS) {
    throw new VerfassungsBruch(
      `F6-AEQ: das Register fuehrt ${(register.events || []).length} Eintraege, erwartet sind `
      + `${ERWARTETE_EVENTS}. Ein anderer Stand heisst, dass zwischenzeitlich jemand angehaengt hat — `
      + 'dann ist dieser Akt neu zu pruefen, nicht blind aufzusetzen.',
    );
  }
  const letzte = register.events[register.events.length - 1];
  if (letzte.runId !== ERWARTETER_LETZTER_RUNID) {
    throw new VerfassungsBruch(
      `F6-AEQ: das Kettenende ist ${letzte.runId}, erwartet ${ERWARTETER_LETZTER_RUNID}.`,
    );
  }
  if (stand.tailHash !== ERWARTETER_TAIL) {
    throw new VerfassungsBruch(
      `F6-AEQ: der Ketten-Endhash ist ${stand.tailHash}, erwartet ${ERWARTETER_TAIL}. `
      + 'previousHash MUSS der eventHash des Vorgaengers sein.',
    );
  }
}

function pruefeRunIdFrei(register, runId) {
  if ((register.events || []).some((e) => e.runId === runId)) {
    throw new VerfassungsBruch(
      `F6-AEQ: runId ${runId} steht bereits im Register. Ein zweiter Eintrag unter derselben runId `
      + 'waere ein zweiter Akt unter einem fremden Namen.',
    );
  }
}

function pruefeDateien(wurzel) {
  const gemessen = {};
  for (const [rel, soll] of SKRIPTE.concat([
    [BEIN1_QUELLE_REL, BEIN1_QUELLE_SHA], [BEIN2_QUELLE_REL, BEIN2_QUELLE_SHA]])) {
    const pfad = path.join(wurzel, ...rel.split('/'));
    if (!fs.existsSync(pfad)) {
      throw new VerfassungsBruch(`F6-AEQ: gebundene Datei fehlt: ${rel}`);
    }
    const ist = dateiHash(pfad);
    if (ist !== soll) {
      throw new VerfassungsBruch(
        `F6-AEQ: ${rel} weicht ab (ist ${ist}, soll ${soll}). Der Eintrag benennt die ausfuehrenden `
        + 'Skripte; ein anderer Hash ist ein anderes Skript, und der Akt waere eine Falschangabe.',
      );
    }
    gemessen[rel] = ist;
  }
  return gemessen;
}

// Die Sollzahlen der Beine gegen IHRE Artefakte — der Eintrag darf keine Zahl
// behaupten, die im Beleg nicht steht.
function pruefeBeinzahlen(wurzel) {
  const b1 = JSON.parse(fs.readFileSync(
    path.join(wurzel, ...BEIN1_QUELLE_REL.split('/')), 'utf8'));
  const soll1 = (b1.provenienz || {}).aequivalenzTorSoll || {};
  for (const v of BEIN1_ZELLEN) {
    for (const feld of ['firmen_reif', 'firmen_unreif']) {
      const ist = (soll1[v] || {})[feld];
      if (ist !== BEIN1_SOLL[v][feld]) {
        throw new VerfassungsBruch(
          `F6-AEQ: Bein 1 ${v}.${feld} ist im Artefakt ${ist}, im Werkzeug ${BEIN1_SOLL[v][feld]}.`);
      }
    }
  }
  const b2 = JSON.parse(fs.readFileSync(
    path.join(wurzel, ...BEIN2_QUELLE_REL.split('/')), 'utf8'));
  const baender = ((b2.baender || {})['2009-2015'] || {}).varianten || {};
  const armname = { signal: 'signal', kontrollpool: 'kontrolle' };
  for (const zelle of BEIN2_ZELLEN) {
    const [v, arm] = zelle.split('/');
    const q = (baender[v] || {})[armname[arm]] || {};
    const paare = [['zaehler', q.zaehler_kadenz], ['nenner', q.nenner_kadenz],
      ['zensiert', q.zensiert_kadenz]];
    for (const [feld, ist] of paare) {
      if (ist !== BEIN2_SOLL[zelle][feld]) {
        throw new VerfassungsBruch(
          `F6-AEQ: Bein 2 ${zelle}.${feld} ist im Artefakt ${ist}, im Werkzeug `
          + `${BEIN2_SOLL[zelle][feld]}.`);
      }
    }
  }
  if (b2.panelRand !== '2016-12-31' || b2.perzentil !== 95) {
    throw new VerfassungsBruch(
      `F6-AEQ: der Rahmen von Bein 2 weicht ab (panelRand ${b2.panelRand}, perzentil ${b2.perzentil}).`);
  }
}

function baueEintrag(runId, registeredAt, wirksamAb, gemessen) {
  return {
    runId,
    typ: ART_ZAEHLPROBE,
    registeredAt,
    accessedAt: wirksamAb,
    fenster: ['entdeckung'],
    allowedOutputs: ALLOWED_OUTPUTS,
    erlaubt:
      'GENAU EINE Zaehlung auf dem ENTDECKUNGS-Fenster (rules.json fenster.entdeckung, 2009q1..2015q4, '
      + 'versiegelt: false): der dreibeinige Aequivalenz-Lauf nach F6-C7/C8/C9. Ausgegeben werden '
      + 'ausschliesslich die in allowedOutputs gelisteten Schluessel — die Aequivalenz-Zahlen der Beine '
      + '1 und 2, das Verdikt bestanden und die drei Skript-Hashes. Bein 3 prueft Wortlaut-Literale '
      + 'ohne Panel-Lauf und geht in bestanden ein. Kein Ergebniswert, kein Anteil, kein SE, kein Band, '
      + 'kein p-Wert.',
    verboten:
      'Jeder Blick ins Prueffenster oder in den Endtest unter dieser runId; jede Beruehrung von '
      + 'panel-validierung.sqlite oder panel-endtest.sqlite.enc oder Schluesselmaterial; jede Ausgabe '
      + 'ausserhalb von allowedOutputs (ein nicht gelisteter Schluessel ist ein ABBRUCH, kein Filter); '
      + 'jede Firmen-Kennung in irgendeiner Ausgabe (F6-B14); jede Berufung auf diesen Eintrag als '
      + 'Autorisierung des konfirmatorischen Laufs — der braucht seinen EIGENEN Eintrag der Art '
      + 'confirmatory_execution_authorized; jedes Abfeuern des Endtests; jede Nachjustierung eines '
      + 'Sollwerts nach dem Lauf. Weicht EINE Zahl ab, ist der Lauf gerissen (KZ-4): kein zweiter '
      + 'Kandidaten-Sollwert, kein "nah genug".',
    begruendung:
      'Bauordnung Schritt 2 aus _COURT-F6-ZAEHLWERK-2026-09-01 (Urteilsstand VOR der Ratifikation, '
      + `sha256 ${URTEIL_SHA}, 92276 B, hier am Objekt nachgerechnet; ratifiziert durch `
      + 'ORCHESTRATOR-NACHTRAG 1, Session 07, 2026-09-01 02:22 lokal). '
      + 'ZWECK: das Aequivalenz-Tor ist LAUFBEDINGUNG, kein Bau-Test (Form studie-e2-verbreitert.py:26-30 '
      + '- "Durchlauf 1 faehrt mit den ORIGINAL-Globals und MUSS die publizierten V0-Zahlen liefern ... '
      + 'dann STOPP, und zwar vor jeder verbreiterten Zahl"). Es laeuft auf dem Entdeckungs-Panel und '
      + 'muss bit-identisch reproduzieren, bevor irgendein Prueffenster-Byte gelesen wird. '
      + 'DZ-5 IN DER STRENGEREN FASSUNG: dieser Lauf bekommt einen EIGENEN '
      + 'count_only_probe_authorized-Akt und wird nicht unter dem konfirmatorischen Eintrag '
      + 'mitgefuehrt - Z3s Fassung, vom Gericht nach der Strenge-Regel uebernommen. '
      + 'WARUM F6-A1..A3 HIER NICHT BINDEN: sie zielen auf das Prueffenster; das Entdeckungsfenster '
      + 'steht offen in rules.json. F6-A8: dieser Akt verbraucht KEIN Kontingent - das K2-Kontingent '
      + 'EINS gilt der Prueffenster-Beruehrung, die hier nicht stattfindet. '
      + 'AUSFUEHRENDE SKRIPTE, auf main nach dem Merge von PR #192 (347f0e8e08) gemessen: '
      + SKRIPTE.map(([rel, sha]) => `${rel} ${sha}`).join('; ') + '. '
      + 'STAND ZUM ZEITPUNKT DER ANMELDUNG, KEINE ZUSAGE FUER DEN LAUF: die Rulings zu den offenen '
      + 'DECISION-NEEDED-Punkten (A16-Doppelgroesse mit Kreuz-Wachposten; die benannte Vorgabe fuer '
      + 'den Arbeitspfad ausserhalb des Repos, VERBOTEN_RE-frei bis in die Elternverzeichnisse - der '
      + 'Pfad selbst gehoert in den konfirmatorischen Eintrag, nicht hierher) sind ENTSCHIEDEN, aber '
      + 'noch NICHT im Code. '
      + 'Der Lauf verwendet die dann gueltigen Skripte und weist ihre Hashes ueber die allowedOutputs '
      + 'zaehlwerkSha256 / zaehlprobeSha256 / modulSha256 selbst aus; die hier genannten Werte sind der '
      + 'Registrierungs-Stand und binden den Lauf nicht rueckwirkend. '
      + 'ANHANG 1 (BERICHTIGUNG VON F6-C7, Auflagen F6-C7a..i), Urteilsstand VOR seiner '
      + `Ratifikation, sha256 ${ANHANG_SHA}, ${ANHANG_BYTES} B, am Objekt nachgerechnet. `
      + 'AKTENKETTE: ORCHESTRATOR-NACHTRAG 2 (Auslegung) -> NACHTRAG 3 (Kipp-Bedingung '
      + 'gefeuert, Kalibrier-Haelfte der Auslegung zurueckgezogen, Weiche an einen Rat) -> '
      + 'ANHANG 1 (Berichtigung). Der Beleg der Nicht-Erosion liegt darin, dass ZWEIMAL '
      + 'nacheinander NICHT still weitergedeutet wurde. '
      + `ERZEUGER-BINDUNG: ${VERBREITERT_REL}, sha256 ${VERBREITERT_SHA}. Es ist AUSFUEHRENDES `
      + 'Skript ausschliesslich fuer die torSoll-Haelfte (F6-C7b, durchlauf --modus alt, '
      + 'Ausgabe nur nach --ergebnis, nie ins Artefakt); fuer die KALIBRIER-Haelfte wird es '
      + 'NICHT gerufen (F6-C7e) und ist dort allein die Erzeuger-Bindung des Artefakts. Es '
      + 'bleibt Byte fuer Byte unangetastet - sein SHA ist zugleich PIN aus Register-Eintrag 23 '
      + 'und Laufzeit-Bindung des Laeufers (F6-C7f: Option (i) ist gesperrt, nicht nur teuer). '
      + 'KEINE KALIBRIERZAHL IST EINE GEMESSENE GROESSE DIESES AKTS (F6-C7i) - sie so zu '
      + 'fuehren beurkundete einen Zustand, den der Akt nicht hat. '
      + 'SOLLZAHLEN VORAB: Bein 1 gegen ' + BEIN1_QUELLE_REL + ' (' + BEIN1_QUELLE_SHA + '), Bein 2 '
      + 'gegen ' + BEIN2_QUELLE_REL + ' (' + BEIN2_QUELLE_SHA + '), beide vom Werkzeug am Objekt '
      + 'nachgerechnet. Sie stehen VOR dem Lauf im Register, damit "bit-identisch" eine Vorfestlegung '
      + 'ist und keine nachtraegliche Behauptung. '
      + 'WAS DAS TOR NICHT BEWEIST (F6-C11, benannt statt weggeredet): (a) den (m_g, n_g)-Tally selbst '
      + '- er ist neue Ausgabe ohne Vorgaenger und nur durch die Kreuzproben und W-C gedeckt; (b) '
      + 'Datenformen, die ausschliesslich im Prueffenster vorkommen - nicht substituierbar, '
      + 'Restrisiko. '
      + 'Erzeugt von scripts/studie-f6-aequivalenz-anmeldung.js (eigenes Werkzeug je Register-Akt, '
      + 'F6-B8; Trockenlauf als Standard, kein --force, keine Reparatur-Betriebsart). Alle Hashes '
      + 'gegen origin/main 347f0e8e08 nachgerechnet, nicht aus dem Urteilsdokument uebernommen - ein '
      + 'Urteil zitiert Hashes als Pruefauftrag, nie als Quelle. Ein-Appender-Regel: main-first per '
      + 'Mini-PR (nur die Registerdatei), danach Serverbeweis gegen main mit '
      + 'scripts/studie-r1-serverzeit.js.',
    endtestSiegel:
      'unberuehrt und in ALLEN Zweigen ZU. Dieser Eintrag autorisiert eine Zaehlung im '
      + 'ENTDECKUNGS-Fenster und oeffnet nichts sonst: weder Endtest-Fenster noch Prueffenster noch '
      + 'Lueckenliste noch Schluesselmaterial werden geoeffnet, gelesen oder gezaehlt. Das Abfeuern '
      + 'des Endtests bleibt ein eigener Akt und braucht Karls ausdrueckliche Freigabe (F6-A16).',
    // Eigene Top-Level-Felder: pruefeZugriffsRegister fuehrt keine
    // Feld-Whitelist, Zusatzfelder werden mitgehasht und sind damit ebenso
    // gebunden - aber maschinell adressierbar und damit pruefbar.
    aequivalenzSoll: {
      bein1: { quelle: BEIN1_QUELLE_REL, dateiSha256: BEIN1_QUELLE_SHA, zellen: BEIN1_SOLL },
      bein2: {
        quelle: BEIN2_QUELLE_REL,
        dateiSha256: BEIN2_QUELLE_SHA,
        rahmen: { panelRand: '2016-12-31', signalband: '2009-01-01/2015-12-31', perzentil: 95 },
        zellen: BEIN2_SOLL,
      },
      kalibrierHaelfte: {
        form: KALIBRIER_HAELFTE_GEPRUEFT,
        berichtigung:
          'F6-C7a: die Kalibrier-Groessen (kalibrierungsWeg 1109->540 / 1309->546, '
          + 'auswertbarImBand 68079 / 82642, firmenReif 540 / 546, firmenUnreif 226 / 265) sind '
          + 'KEINE ORIGINAL-Globals-Groessen. Sie stammen aus dem Durchlauf verbreitertOhneBank. '
          + 'Der arithmetische Gegenbeweis steht im SELBEN Artefakt: '
          + 'provenienz.aequivalenzTorSoll["S-U"].firmen_reif = 512 gegen '
          + 'jeFamilie["S-U"].firmenReif = 540, und S-UG 29 gegen 30 - ein Lauf kann nicht '
          + 'beides liefern. Bein 1 zerfaellt deshalb nach BEWEISART in eine Lauf-Haelfte '
          + '(F6-C7b) und eine Artefakt-Haelfte (F6-C7c/d).',
        nachweis:
          'Doppel-Hash (Datei-SHA ' + BEIN1_QUELLE_SHA + ' UND inhaltSha256, beide Richtungen '
          + 'zu) plus Laufzeit-Konstanten-Abgleich feldweise gegen das hash-geprueft geladene '
          + 'Artefakt. NICHT GEFAHREN, SONDERN GEPRUEFT.',
        restrisiko:
          'F6-C7g: bewiesen wird die UNVERAENDERTHEIT der eingefrorenen Bytes, NICHT die '
          + 'Wahrheit der Zahlen darin (c); das Entdeckungs-Panel traegt keinen registrierten '
          + 'Byte-Pin (d); und dass das E2-Artefakt aus einem echten Panel-Lauf stammt, traegt '
          + 'sein eigenes bestandenes Tor plus BEIN 2, nicht dieses Bein (e). Ausgewiesen, '
          + 'nicht wegargumentiert.',
      },
      bein3: {
        form: 'Wortlaut-Literale aus protocol/early-detection/2.0.0/preregistration.json, '
          + 'ohne Panel-Lauf (F6-C9). Geht in bestanden ein, emittiert keine eigene Zahl.',
      },
      kippbedingung: 'KZ-4 - eine einzige abweichende Zahl ist ein STOPP vor jedem Prueffenster-Byte.',
    },
    ausfuehrendeSkripte: gemessen,
  };
}

function haupt(argv) {
  if (argv.includes('--force')) {
    throw new VerfassungsBruch(
      'F6-AEQ: --force gibt es nicht (F6-B8). Ein Register-Akt, der eine Schranke ueberreden kann, '
      + 'ist keine Schranke.',
    );
  }
  const schreiben = argv.includes('--schreiben');
  const registerPfad = argument(argv, 'register') || LEDGER;
  const dateiWurzel = argument(argv, 'wurzel') || WURZEL;
  const runId = argument(argv, 'runid') || RUN_ID;

  const jetzt = new Date();
  const anmeldeArg = argument(argv, 'anmeldezeit');
  const registeredAt = anmeldeArg ? new Date(anmeldeArg).toISOString() : jetzt.toISOString();
  if (Date.parse(registeredAt) > jetzt.getTime()) {
    throw new VerfassungsBruch(
      `F6-AEQ: --anmeldezeit ${registeredAt} liegt in der Zukunft. Eine vordatierte Anmeldung ist ein `
      + 'Nachher-Protokoll mit Vorsprung.',
    );
  }
  const wirksamAb = argument(argv, 'wirksam-ab')
    ? new Date(argument(argv, 'wirksam-ab')).toISOString()
    : new Date(Date.parse(registeredAt) + VORLAUF_MINUTEN * 60 * 1000).toISOString();
  if (Date.parse(wirksamAb) <= Date.parse(registeredAt)) {
    throw new VerfassungsBruch(
      `F6-AEQ: --wirksam-ab (${wirksamAb}) muss NACH der Anmeldung (${registeredAt}) liegen.`,
    );
  }

  const register = lies(registerPfad);
  const stand = pruefeZugriffsRegister(register);
  pruefeRunIdFrei(register, runId);
  pruefeTail(register, stand);
  const gemessen = pruefeDateien(dateiWurzel);
  pruefeBeinzahlen(dateiWurzel);

  const eintrag = baueEintrag(runId, registeredAt, wirksamAb, gemessen);
  const neu = haengeEintragAn(register, eintrag);
  pruefeZugriffsRegister(neu);
  const fertig = neu.events[neu.events.length - 1];

  process.stdout.write(
    `Akt           Bauordnung Schritt 2 - Zaehlproben-Anmeldung Aequivalenz-Lauf\n`
    + `runId         ${runId}\n`
    + `typ           ${ART_ZAEHLPROBE}\n`
    + `fenster       entdeckung (rules.json 2009q1..2015q4, versiegelt: false)\n`
    + `allowedOutputs ${ALLOWED_OUTPUTS.length} Schluessel, abschliessend\n`
    + `Urteil        ${URTEIL_SHA} (Stand VOR der Ratifikation, 92276 B)\n`
    + SKRIPTE.map(([rel, sha]) => `Skript        ${rel}\n              ${sha}\n`).join('')
    + `Bein 1 Quelle ${BEIN1_QUELLE_REL}\n              ${BEIN1_QUELLE_SHA}\n`
    + `Bein 2 Quelle ${BEIN2_QUELLE_REL}\n              ${BEIN2_QUELLE_SHA}\n`
    + `Kettenende vor dem Eintrag: ${ERWARTETER_LETZTER_RUNID} / ${ERWARTETER_TAIL}\n`
    + `PRUEFZEILE: "previousHash": "${fertig.previousHash}"\n`
    + `eventHash dieses Eintrags: ${fertig.eventHash}\n`
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
      'F6-AEQ - HALT, NICHT ERNEUT AUSFUEHREN: das Register auf der Platte traegt jetzt einen anderen '
      + `eventHash (${kontrolle.eventHash}) als der geprueft gebaute (${fertig.eventHash}). Die Datei `
      + 'ist bereits geschrieben und weicht vom verifizierten Stand ab. Ein zweiter Lauf wuerde darauf '
      + 'aufsetzen. Zuerst von Hand pruefen und den Stand aus der Git-Historie wiederherstellen, dann '
      + 'erst weiter.',
    );
  }
  process.stdout.write(
    `GESCHRIEBEN: ${registerPfad}\n`
    + 'Naechste Schritte: Mini-PR mit NUR der Registerdatei nach main, danach Serverbeweis gegen main '
    + 'mit scripts/studie-r1-serverzeit.js. Der Aequivalenz-Lauf startet erst NACH dem Serverbeweis '
    + 'und innerhalb der Zeitkette dieses Eintrags.\n',
  );
  return 0;
}

module.exports = { ALLOWED_OUTPUTS, BEIN1_SOLL, BEIN2_SOLL, SKRIPTE, RUN_ID, haupt };

if (require.main === module) {
  try {
    process.exit(haupt(process.argv.slice(2)));
  } catch (fehler) {
    process.stderr.write(`${fehler.message}\n`);
    process.exit(1);
  }
}
