#!/usr/bin/env node
'use strict';

// Studie 2.0, F6-Tor — EINTRAG 29: ERGAENZUNGS- UND BERICHTIGUNGS-VERMERK ZU
// EINTRAG 28.
//
// Muster: der Bein-2-Berichtigungs-Vermerk (Eintrag 26). DIE AUTORISIERUNG
// VON EINTRAG 28 BLEIBT UNBERUEHRT - berichtigt wird ausschliesslich seine
// DOKUMENTATIONS-BEHAUPTUNG. Deshalb typ C0_REGELFREEZE und allowedOutputs [].
//
// Eigenes Werkzeug nach F6-B8. Kein stillgelegtes Werkzeug bekommt einen
// Schreibweg zurueck.
//
//   node scripts/studie-f6-eintrag29.js                 # Trockenlauf
//   node scripts/studie-f6-eintrag29.js --zeige-eintrag # + Eintrag als JSON
//   node scripts/studie-f6-eintrag29.js --schreiben     # anhaengen

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { writeFileAtomic } = require('../lib/atomic-write.js');
const {
  VerfassungsBruch, haengeEintragAn, pruefeZugriffsRegister, ART_C0_REGELFREEZE,
} = require('../lib/studie-verfassung.js');

const WURZEL = path.join(__dirname, '..');
const LEDGER = path.join(WURZEL, 'protocol', 'early-detection', '2.0.0',
  'outcome-access-ledger.json');

const RUN_ID = 'f6-eintrag28-ergaenzung-2026-09-01';
const VORLAUF_MINUTEN = 120;
const ERWARTETE_EVENTS = 28;
const ERWARTETER_LETZTER_RUNID = 'f6-konfirmatorisch-v2-2026-09-01';
const ERWARTETER_TAIL = '51c235ebd79272f7cce976f3627816bc50c283f47c4f34dd2d630af3eca66938';

// Byte-genau aus der Konstante gelesen, nicht abgeschrieben (Blocker B).
const LAEUFER_REL = 'scripts/studie-f6-lauf.py';
const TOR_REGELTEXT_SHA = '8cf3fdafda9acfdd7d99c254c188b46fc4e0ffe95985ca04022aba3863fab423';
const KADENZ_REL = 'scripts/studie-e4d-kadenz.py';

const argument = (argv, n) => {
  const i = argv.indexOf(`--${n}`);
  if (i < 0) return null;
  const v = argv[i + 1];
  if (!v || v.startsWith('--')) throw new VerfassungsBruch(`F6-E29: --${n} ohne Wert.`);
  return v;
};
const sha = (s) => crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');

// TOR_REGELTEXT wird aus dem QUELLTEXT der Konstante rekonstruiert und gegen
// den gemessenen sha256 gehalten. Abschreiben war der Fehler; hier wird
// gelesen und geprueft.
function torRegeltext(wurzel) {
  const quelle = fs.readFileSync(path.join(wurzel, ...LAEUFER_REL.split('/')), 'utf8');
  const start = quelle.indexOf('TOR_REGELTEXT = (');
  if (start < 0) throw new VerfassungsBruch('F6-E29: TOR_REGELTEXT nicht gefunden.');
  const ende = quelle.indexOf('\n\n', start);
  const block = quelle.slice(start, ende);
  // Die aneinandergereihten String-Literale zusammensetzen.
  const text = (block.match(/"([^"]*)"/g) || []).map((s) => s.slice(1, -1)).join('');
  if (sha(text) !== TOR_REGELTEXT_SHA) {
    throw new VerfassungsBruch(
      `F6-E29: TOR_REGELTEXT ergibt sha256 ${sha(text)}, gemessen wurde ${TOR_REGELTEXT_SHA}. `
      + 'Ein "woertlich" befohlener Text, der nicht byte-gleich ist, ist genau der Befund '
      + 'von Blocker B - hier wird angehalten statt gekuerzt.');
  }
  return text;
}

// Die Kadenz-Basis, woertlich aus den Zeilen 21-32.
function kadenzBasis(wurzel) {
  const zeilen = fs.readFileSync(path.join(wurzel, ...KADENZ_REL.split('/')), 'utf8')
    .split(/\r?\n/);
  const text = zeilen.slice(20, 32).join('\n');
  if (!text.includes('Melderhythmus') || !text.includes('Zaehler UND Nenner')) {
    throw new VerfassungsBruch(
      'F6-E29: der Block :21-32 traegt nicht die erwartete Kadenz-Basis (Melderhythmus / '
      + 'Zaehler UND Nenner). Die Zeilen haben sich verschoben - nicht raten, messen.');
  }
  return text;
}

function baueEintrag(registeredAt, wirksamAb, wurzel) {
  const regeltext = torRegeltext(wurzel);
  return {
    runId: RUN_ID,
    typ: ART_C0_REGELFREEZE,
    registeredAt,
    accessedAt: wirksamAb,
    fenster: ['kein Studienfenster - Ergaenzungs-Vermerk ohne Datenzugriff'],
    allowedOutputs: [],

    erlaubt: 'Nichts. Dieser Vermerk ergaenzt und berichtigt die DOKUMENTATION von '
      + 'Eintrag 28 und autorisiert KEINEN Datenzugriff. Die AUTORISIERUNG von Eintrag 28 '
      + 'bleibt unberuehrt. accessedAt bezeichnet hier keinen Zugriff, sondern den '
      + 'fruehesten Zeitpunkt, ab dem der ergaenzte Stand gilt; die Art C0_REGELFREEZE '
      + 'verlangt das Feld.',
    verboten: 'Jede Berufung auf diesen Vermerk als Autorisierung eines Laufs; jede '
      + 'nachtraegliche Aenderung an Eintrag 28 selbst (append-only).',

    begruendung: 'BERICHTIGUNG EINER DOKUMENTATIONS-BEHAUPTUNG (F6-C18 / KZ-7, Muster '
      + 'Eintrag 26). Eintrag 28 behauptet, er trage "alles, was Eintrag 27 trug". DAS IST '
      + 'MESSBAR UNWAHR: die F6-C8h/F6-C8i-Schicht fiel beim Bau weg - eine wahr klingende '
      + 'Aussage ueber einer falschen Menge, genau die Klasse, die derselbe Eintrag ruegt '
      + 'und an der Eintrag 27 gestorben ist. Der Satz ist hiermit als UNRICHTIG '
      + 'ausgewiesen; die Schicht steht unten. Unbemerkt blieb es, weil der Waechter nur '
      + 'die sieben benannten Luecken prueft: wer nur Hinzugefuegtes prueft, bezeugt nichts '
      + 'ueber Weggefallenes.',

    // ── Die vollstaendige F6-C8h-Schicht, wiederhergestellt.
    f6c8hSchicht: {
      '1_einEreignisMechanismus': 'genau ein Erst-Ereignis des Arms S-U/kontrollpool ist '
        + 'unter der Kadenzregel zensiert und unter 4 * 80 nicht, und es ist reif; unter der '
        + 'E4e-Quotientenregel verlaesst es Zaehler UND Nenner gemeinsam - daher +1/+1/-1. '
        + 'Keine Firmenkennung, kein Datum, keine Prueffenster-Groesse.',
      '2_kadenzBasisWoertlich': {
        quelle: `${KADENZ_REL}:21-32`,
        siegel: 'E4d/E4e-INSTRUMENTVARIANTE UNTER EIGENEM SIEGEL - ausdruecklich NICHT die '
          + 'von F6 vollstreckte 2.0.0-Regel.',
        text: kadenzBasis(wurzel),
        vermerk: 'Nach der Ueberschreibung stand diese Pflicht in KEINEM Eintrag mehr '
          + '(25, 26, 28 geprueft) - ersatzlos untergegangen, hier wiederhergestellt.',
      },
      '3_gerichtNichtBauender': 'Die Bein-2-Basis hat DAS GERICHT berichtigt, nicht der '
        + 'Bauende. Aktenkette: Haupturteil (3:0) -> NACHTRAEGE 1-3 -> ANHANG 1 -> Anlauf 4 '
        + 'riss -> Forensik OHNE Eingriff (KZ-4 gewahrt) -> ANHANG 2 -> Eintrag 26 -> '
        + 'Eintrag 28 -> ANHANG 3 -> dieser Vermerk. Dreimal wurde nicht still '
        + 'weitergedeutet; den vierten Fall - diesen Verlust - fand das Delta-Review, nicht '
        + 'der Bau.',
      '4_spaltentabelle': 'Spaltenherkunft je Soll-Zahl: Eintrag 28, '
        + 'aequivalenzTor.bein2.spaltenpfad. Die von Eintrag 28 ebenfalls verlorene BASIS: '
        + '"E3 nach preregistration.json:80 (Zensur) und :87 (Netto-Nenner). Die '
        + 'KADENZ-/E4e-Basis regiert Bein 2 NICHT (F6-C8a)." Referenz-Artefakt '
        + '46e191ec68e0480a336fd287dc548c8b6a975b8d50a07c6e0162274c6dbd8fdf.',
      '5_anhang1_144': 'Die Zahlenzitierung in ANHANG1:144 ERBT die Berichtigung aus '
        + 'ANHANG 2.',
    },

    // ── F6-C8i, beide Saetze woertlich.
    richtungsOffenlegungBerichtigung: {
      satz1: 'Diese Berichtigung ENTFERNT an genau einer Zelle einen stehenden STOPP',
      satz2: 'Die Unerfuellbarkeit wurde hier nicht vor, sondern DURCH einen Lauf entdeckt',
      vermerk: 'Beide standen in Eintrag 27 und fehlten in 28. Sie gelten unveraendert; '
        + 'der Ausgleich (totes Tor, Netto-Bilanz +2) steht in Eintrag 26.',
    },

    // ── Blocker B: der Regeltext byte-genau.
    torRegeltextWoertlich: {
      quelle: `${LAEUFER_REL}, Konstante TOR_REGELTEXT`,
      text: regeltext,
      zeichen: regeltext.length,
      sha256: sha(regeltext),
      gleichheit: 'Der hier stehende Text ist BYTE-GLEICH mit der Code-Konstante: das '
        + 'Werkzeug liest sie zur Laufzeit aus dem Quelltext und bricht ab, wenn der sha256 '
        + 'abweicht. Er wurde NICHT abgeschrieben.',
      berichtigt: 'In Eintrag 28 fehlte die Klammer "(das Messgeraet hat nicht getrennt; '
        + 'die Bandfolge dominiert)" - nicht schmueckend, sondern die DOMINANZREGEL fuer '
        + 'den Fall "ein Arm NICHT UNTERSCHEIDBAR bei haltender Differenz", auf den F6-B25 '
        + 'verweist. Weisung: Byte-Identitaet mit der CODE-KONSTANTE, strengere Fassung '
        + 'gewinnt, kein Code geaendert.',
    },

    // ── ANHANG-3 Doku-Pflicht 7: beide konservierten Dissense.
    konservierteDissense: {
      ob2_umbenennung: 'Beide Stimmen fuehren diese Form als konservierten Dissens - C1 '
        + 'als Zweit-Weg, den es fuer schlechter haelt; C2 als Selbstkritik, deren besseren '
        + 'Grund es einraeumt. Einzige zulaessige Alternative: Umbenennung des Containers '
        + 'auf tor, Preis eine Namens-Berichtigung in F6-B11 und F6-C15. Niemals zulaessig: '
        + 'das Verdikt verschweigen oder die Zwei-Schluessel-Form ohne vollen Rat (KZ-21).',
      ob1_korrekturform: 'Korrekturform von Befund (a) offen (KZ-22); die Haertung ist in '
        + 'beiden Lesarten dieselbe und vollzogen, der Bauende gewinnt keine Entlastung.',
    },

    // ── Zitattreue (F6-C9e) und die drei kleinen Vermerke des Delta-Reviews.
    zitattreueC9e: {
      befund: 'Der von Eintrag 28 als berichtigt zitierte Satz steht so NIRGENDS - er ist '
        + 'eine Verschmelzung der beiden Saetze, die Eintrag 27 wirklich trug.',
      original1: 'Bein 3: fuenf Wortlaut-Literale ohne Panel-Lauf.',
      original1Ort: 'Eintrag 27, begruendung',
      original2: 'Fuenf Wortlaut-Literale aus preregistration.json, ohne Panel-Lauf (F6-C9).',
      original2Ort: 'Eintrag 27, aequivalenzTor.bein3',
      gilt: 'BEIDE Saetze sind berichtigt: Bein 3 fuehrt sechs quellengebundene Literale, '
        + 'davon fuenf F6-C9-Ziffern (vier Praereg + eines aus dem Wortlaut von Eintrag 24) '
        + 'und ein bauseitiges Zusatz-Literal, das nie als Ziffer zaehlt.',
    },

    weitereVermerke: {
      torRichtungAblage: 'F6-C13c schickt den Richtungssatz "in die Umschlag-Liste"; '
        + 'gemessen liegt TOR_RICHTUNG in bericht.stempel.kriteriumDifferenz.richtung, und '
        + 'der Umschlag fuehrt "richtung" nicht. KEIN LECK - eingefrorene Konstante, '
        + 'Datenflaeche nachweislich frei davon (Bruchprobe gruen). Ablage-Frage, benannt '
        + 'statt still anders vollzogen.',
      mergedAtSekunde: 'PR #186: Eintrag 28 fuehrt mergedAt 21:50:32Z, die Commit-Zeit ist '
        + '21:50:31Z - API-mergedAt gegen committer date, ohne Folge fuer die Zeitkette.',
      geviertstrich: 'panelBauAbweichung.woertlich transliteriert zwei Geviertstriche zu '
        + 'Bindestrichen (ASCII-Hausform des Registers). Bei einem "woertlich" befohlenen '
        + 'Zitat gehoert das benannt; der Satzbestand ist unveraendert.',
    },

    endtestSiegel: 'unberuehrt. Dieser Vermerk oeffnet nichts, zaehlt nichts und beruehrt '
      + 'das Endtest-Fenster in keiner Weise.',
    actor: 'Karl Viehrig (Auftraggeber, Freigabe-Inhaber) - ausgefuehrt durch den '
      + 'Nacht-Agenten der Session 07 unter dem Review-Tor des Orchestrators.',
    scope: 'Dokumentation von Eintrag 28. KEIN Datenzugriff, KEIN Fenster, KEINE Ausgabe.',
    purpose: 'Die vom Delta-Review bewiesenen Blocker A und B heilen, ohne die '
      + 'Autorisierung von Eintrag 28 anzutasten.',
    laufFreigabe: 'DER LAUF FEUERT NICHT MIT DIESEM VERMERK. Die Autorisierung steht in '
      + 'Eintrag 28 und bleibt unveraendert; sie wird erst wirksam, wenn ein fokussiertes '
      + 'Re-Review dieses Vermerks gruen ist und der accessedAt-Fussboden von Eintrag 28 '
      + '(2026-09-01T11:02:56.527Z) ueberschritten ist.',
  };
}

function haupt(argv) {
  if (argv.includes('--force')) {
    throw new VerfassungsBruch('F6-E29: --force gibt es nicht (F6-B8).');
  }
  const schreiben = argv.includes('--schreiben');
  const wurzel = argument(argv, 'wurzel') || WURZEL;
  const registerPfad = argument(argv, 'register') || LEDGER;

  const registeredAt = argument(argv, 'anmeldezeit') || new Date().toISOString();
  if (new Date(registeredAt).getTime() > Date.now() + 60000) {
    throw new VerfassungsBruch('F6-E29: die Anmeldezeit liegt in der Zukunft.');
  }
  const wirksamAb = argument(argv, 'wirksam-ab')
    || new Date(new Date(registeredAt).getTime() + VORLAUF_MINUTEN * 60000).toISOString();
  if (!(new Date(registeredAt) < new Date(wirksamAb))) {
    throw new VerfassungsBruch('F6-E29: wirksam-ab muss NACH der Anmeldung liegen (VB-A11).');
  }

  const register = JSON.parse(fs.readFileSync(registerPfad, 'utf8'));
  const events = register.events || [];
  if (events.length !== ERWARTETE_EVENTS) {
    throw new VerfassungsBruch(
      `F6-E29: das Register fuehrt ${events.length} Eintraege, erwartet ${ERWARTETE_EVENTS}.`);
  }
  const letzter = events[events.length - 1];
  if (letzter.runId !== ERWARTETER_LETZTER_RUNID || letzter.eventHash !== ERWARTETER_TAIL) {
    throw new VerfassungsBruch(
      `F6-E29: das Kettenende ist ${letzter.runId} / ${letzter.eventHash}, erwartet `
      + `${ERWARTETER_LETZTER_RUNID} / ${ERWARTETER_TAIL}.`);
  }
  if (events.some((e) => e.runId === RUN_ID)) {
    throw new VerfassungsBruch(`F6-E29: die runId ${RUN_ID} ist bereits belegt.`);
  }

  const eintrag = baueEintrag(registeredAt, wirksamAb, wurzel);
  const neu = haengeEintragAn(register, eintrag);
  pruefeZugriffsRegister(neu);
  const fertig = neu.events[neu.events.length - 1];
  const bytes = Buffer.byteLength(`${JSON.stringify(neu, null, 1)}\n`, 'utf8');

  process.stdout.write(
    'Akt           EINTRAG 29 - ERGAENZUNGS- UND BERICHTIGUNGS-VERMERK ZU EINTRAG 28\n'
    + `runId         ${RUN_ID}\n`
    + `typ           ${ART_C0_REGELFREEZE}   allowedOutputs []\n`
    + `TOR_REGELTEXT ${eintrag.torRegeltextWoertlich.zeichen} Zeichen, sha256 `
    + `${eintrag.torRegeltextWoertlich.sha256.slice(0, 16)}... (aus der Konstante gelesen)\n`
    + `Kettenende vor dem Vermerk: ${ERWARTETER_LETZTER_RUNID} / ${ERWARTETER_TAIL}\n`
    + `PRUEFZEILE: "previousHash": "${fertig.previousHash}"\n`
    + `eventHash dieses Vermerks: ${fertig.eventHash}\n`
    + `Vermerk-Groesse: ${Buffer.byteLength(JSON.stringify(fertig), 'utf8')} B\n`
    + `Register danach: ${neu.events.length} Ereignisse, ${bytes} B von 204800 (R14a)\n\n`);

  if (!schreiben) {
    if (argv.includes('--zeige-eintrag')) {
      process.stdout.write(`EINTRAG:${JSON.stringify(fertig)}\n`);
    }
    process.stdout.write('TROCKENLAUF - es wurde NICHTS geschrieben.\n');
    return 0;
  }
  writeFileAtomic(registerPfad, `${JSON.stringify(neu, null, 1)}\n`);
  process.stdout.write(`GESCHRIEBEN: ${registerPfad}\n`);
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

module.exports = {
  RUN_ID, ERWARTETER_TAIL, TOR_REGELTEXT_SHA, torRegeltext, kadenzBasis, baueEintrag,
  haupt, WURZEL, LEDGER,
};
