#!/usr/bin/env node
'use strict';

// Studie 2.0, F6-Naht — DER ABSCHLUSS-AKT der ersten Registerdatei (LR-4/LR-5).
//
// Die aktive Registerdatei laeuft gegen den R14a-Deckel. Die Notwendigkeits-
// messung nach LR-1 ist gefahren und hat die Naht VERLANGT (die Zahlen stehen
// im ausloeser-Block dieses Akts). Dieser Eintrag schliesst die Datei ab: er
// ist ihr LETZTER Eintrag, erklaert den Abschluss und benennt die
// Fortsetzung. Er autorisiert NICHTS.
//
// Die Arbeitsteilung des Praezedenzfalls 1.2.0 -> 2.0.0 bleibt unveraendert:
// der VORGAENGER erklaert seinen Abschluss, der NACHFOLGER bindet den Hash.
// Der Akt kann den Endhash seiner eigenen Datei nicht tragen (Fixpunkt) -
// deshalb steht hier die Genesis-REGEL und nie der Genesis-WERT.
//
// Eigenes Einzweck-Werkzeug nach F6-B8 (Muster studie-f6-vorfall.js).
// Kein stillgelegtes Werkzeug bekommt einen Schreibweg.
//
//   node scripts/studie-f6-abschluss.js                 # Trockenlauf
//   node scripts/studie-f6-abschluss.js --zeige-eintrag # + Eintrag als JSON
//   node scripts/studie-f6-abschluss.js --schreiben     # anhaengen

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { writeFileAtomic } = require('../lib/atomic-write.js');
const {
  VerfassungsBruch, haengeEintragAn, pruefeZugriffsRegister, ART_C0_REGELFREEZE,
} = require('../lib/studie-verfassung.js');
// R12a-Riegel: die PRUEFUNG wird importiert, nicht zum sechsten Mal abgetippt.
// Sie ist eine reine Aussage ueber einen geparsten Baum - kein Schreibweg, kein
// Registerpfad. LR-15 ist unberuehrt: hier wird kein verbrauchter Anhaenger
// umgehaengt, sondern ein Praedikat wiederverwendet.
const { pruefeR12a } = require('./studie-f6-vorfall.js');

const WURZEL = path.join(__dirname, '..');
const VERZEICHNIS = ['protocol', 'early-detection', '2.0.0'];
const LEDGER_NAME = 'outcome-access-ledger.json';
const FORTSETZUNG_NAME = 'outcome-access-ledger-teil2.json';
const LEDGER = path.join(WURZEL, ...VERZEICHNIS, LEDGER_NAME);
const LEDGER_REL = [...VERZEICHNIS, LEDGER_NAME].join('/');
const FORTSETZUNG_REL = [...VERZEICHNIS, FORTSETZUNG_NAME].join('/');

const RUN_ID = 'f6-register-abschluss-rollover-2026-09-01';
const VORLAUF_MINUTEN = 120;
const DECKEL_BYTES = 200 * 1024;

// Das Kettenende, an das dieser Akt gehoert. Nie eine feste Laenge - die
// Eigenschaft ist der Tail, nicht die Anzahl.
const ERWARTETE_EVENTS = 30;
const ERWARTETER_LETZTER_RUNID = 'f6-vorfall-lauf-abbruch-2026-09-01';
const ERWARTETER_TAIL = '5ed947d05e4f93ff6d7b485e81022b9ad1733238349932a009570b5b9c6dd15a';

// SOLLWERTE der zu schliessenden Datei. Sie werden AM OBJEKT nachgerechnet und
// nicht geglaubt: was in den Akt wandert, ist die Messung; die Konstanten sind
// nur der Riegel dagegen, dass sich der Stand unter dem Werkzeug bewegt hat.
const SOLL_BYTES_VORHER = 187125;
const SOLL_DATEI_SHA256 = '3fc5234cecea76eded6571d004e27c9d25ec0b50164145455955485ea58b0418';

// Das Messgate LR-1, gemessen am komponierten Volltext-Entwurf des F6-K11-Akts
// (aus den drei Quell-Eintraegen unten zusammengesetzt, damit ein Weglassen aus
// einer Quelle kommen muesste, wo es auffaellt). Der Entwurf liegt ausserhalb
// des Repos und traegt kein Register-Byte.
const MESSGATE = {
  restluftVorher: DECKEL_BYTES - SOLL_BYTES_VORHER,
  k11AktKompaktBytes: 52196,
  k11AktZuwachsImRegister: 54899,
  registerNachK11OhneNaht: 242024,
  fehlbetrag: 37224,
};

// Die drei Quellen des K11-Akts, adressiert nach DATEI + eventHash statt nach
// Ordnungszahl (LR-21): nach der Teilung ist "Eintrag 28" keine eindeutige
// Adresse mehr.
const K11_QUELLEN = [
  { runId: 'f6-konfirmatorisch-v2-2026-09-01', eventHash: '51c235ebd79272f7cce976f3627816bc50c283f47c4f34dd2d630af3eca66938' },
  { runId: 'f6-eintrag28-ergaenzung-2026-09-01', eventHash: '0286419a727d63f271403793f3f29d8c5033f84aa631704888dedae048b12931' },
  { runId: 'f6-vorfall-lauf-abbruch-2026-09-01', eventHash: '5ed947d05e4f93ff6d7b485e81022b9ad1733238349932a009570b5b9c6dd15a' },
];

const argument = (argv, n) => {
  const i = argv.indexOf(`--${n}`);
  if (i < 0) return null;
  const v = argv[i + 1];
  if (!v || v.startsWith('--')) throw new VerfassungsBruch(`F6-AB: --${n} ohne Wert.`);
  return v;
};

// LR-20, FAIL-CLOSED IM CODE. Es gibt keine rechtmaessige Reparatur fuer eine
// Datei, die ihren eigenen Abschluss-Akt nicht mehr fasst: kein Eintrag wird je
// entfernt. Deshalb wird die Groesse NACH der Serialisierung gemessen und der
// Schreibweg verweigert, sobald sie den Deckel ERREICHT - nicht erst ueber ihn
// hinaus.
function pruefeDeckel(bytesNachher) {
  if (bytesNachher >= DECKEL_BYTES) {
    throw new VerfassungsBruch(
      `F6-AB: das Register waere nach diesem Akt ${bytesNachher} B und erreichte damit den `
      + `R14a-Deckel von ${DECKEL_BYTES} B. Es wird NICHT geschrieben (LR-20). Eine Datei, die `
      + 'ihren eigenen Abschluss-Akt nicht fasst, ist nicht reparierbar - Eintraege werden nie '
      + 'entfernt.');
  }
}

function baueEintrag(registeredAt, wirksamAb, gemessen) {
  return {
    runId: RUN_ID,
    typ: ART_C0_REGELFREEZE,
    registeredAt,
    accessedAt: wirksamAb,
    fenster: ['kein Studienfenster - Speicher-Rollover ohne Datenzugriff'],
    allowedOutputs: [],
    erlaubt: 'Nichts. Kein Datenzugriff.',
    verboten: 'Jeder weitere Eintrag in DIESER Datei - sie ist mit diesem Akt geschlossen. '
      + 'Jede Berufung auf diesen Eintrag als Autorisierung eines Laufs. '
      + 'Jede Aenderung an einem der bisherigen Eintraege dieser Datei.',

    zeitfensterDeutung: 'accessedAt bezeichnet hier keinen Zugriff, sondern den fruehesten '
      + 'Zeitpunkt, ab dem der ergaenzte Stand gilt; die Art C0_REGELFREEZE verlangt das Feld. '
      + 'Woertlich uebernommen aus dem Eintrag mit eventHash '
      + '0286419a727d63f271403793f3f29d8c5033f84aa631704888dedae048b12931 (LR-4). Ein '
      + 'C0_REGELFREEZE-Akt ist NIE ein Tor fuer einen Lauf.',

    begruendung: 'ABSCHLUSS DIESER REGISTERDATEI nach dem Gerichtsbefehl zum Ledger-Rollover '
      + '(LR-4/LR-5). Die Datei laeuft gegen den R14a-Deckel; die Notwendigkeitsmessung nach '
      + 'LR-1 ist gefahren und hat die Naht verlangt (Zahlen im ausloeser-Block). Der Rollover '
      + 'ist REINE SPEICHERMECHANIK: kein Ereignis wird verschoben, keines umgeschrieben, keines '
      + 'entfernt, keine Regel umformuliert. Dieser Akt fuegt genau EINEN Eintrag hinzu und '
      + 'autorisiert nichts.',

    abschluss: {
      eventCountVorher: gemessen.eventCountVorher,
      tailHashVorDiesemAkt: ERWARTETER_TAIL,
      bytesVorher: gemessen.bytesVorher,
      dateiSha256VorDiesemAkt: gemessen.dateiSha256VorDiesemAkt,
      deckelBytes: DECKEL_BYTES,
      ausloeser: 'R14a',
      ausloeseMessung: {
        regel: 'LR-1: der F6-K11-Akt wird im Volltext entworfen und in Bytes GEMESSEN, bevor '
          + 'dieser Abschluss-Akt geschrieben wird. Passt er in die Restluft, entfaellt die '
          + 'Naht ersatzlos. Er passt nicht.',
        restluftVorher: MESSGATE.restluftVorher,
        k11AktKompaktBytes: MESSGATE.k11AktKompaktBytes,
        k11AktZuwachsImRegister: MESSGATE.k11AktZuwachsImRegister,
        registerNachK11OhneNaht: MESSGATE.registerNachK11OhneNaht,
        fehlbetrag: MESSGATE.fehlbetrag,
        ergebnis: 'DIE NAHT IST GEFORDERT. Der ueberschreibende Akt uebersteigt die Restluft '
          + `um ${MESSGATE.fehlbetrag} B.`,
        messweg: 'Der K11-Akt wurde im Volltext aus seinen drei Quellen komponiert und in Bytes '
          + 'gemessen - nicht geschaetzt. LR-19: die Schaetzungen 42-45 KB und 55-70 KB tragen '
          + 'keine Rechnung. Der Entwurf liegt ausserhalb des Repos und traegt kein '
          + 'Register-Byte.',
        quellenDesK11Akts: K11_QUELLEN,
        k11Ausschreibepflicht: 'LR-2: der K11-Akt wird AUSGESCHRIEBEN, nie verzeigert. Eine '
          + 'Hash-Referenz statt des Abdrucks stellte die Fehlklasse wieder her, an der der '
          + 'Eintrag mit eventHash 5ad8a38a9f0cb6fcebb82878e944d691cdc76df66725cc6e63fb8ac8e75f16c3 '
          + 'gestorben ist: wer nur Hinzugefuegtes prueft, bezeugt nichts ueber Weggefallenes.',
      },
    },

    fortsetzung: {
      dateiname: FORTSETZUNG_REL,
      ortIstErzwungen: 'Gleiches Verzeichnis (sonst stiller Ausfall aus R14a, R12a und R12b), '
        + 'gleicher Namensstamm outcome-access-ledger (Zitierbarkeit der Familie), KEIN neuer '
        + 'Versionsordner - eine neue Protokollnummer behauptete ein neues Protokoll und waere '
        + 'die von F6-K26 verbotene Designaenderung (LR-6/LR-K7).',
      genesisRegel: 'Der Kopf der Fortsetzung traegt als genesisSha256 den TAIL-EVENT-HASH der '
        + 'geschlossenen Datei - also den eventHash GENAU DIESES Akts, weil er ihr letzter '
        + 'Eintrag ist. Der WERT kann hier nicht stehen: er entsteht erst durch das Schreiben '
        + 'dieses Eintrags (Fixpunkt). Deshalb steht hier die REGEL (LR-5).',
      genesisEntscheidung: 'OB-1 war ohne Beschluss und ist durch den Orchestrator-Nachtrag zur '
        + 'Ratifikation entschieden: Tail-Event-Hash, nicht Byte-sha. Grund: genesisSha256 MUSS '
        + 'der Wert sein, den events[0].previousHash annimmt; die vom Pruefer gelaufene Kette '
        + 'ist die EREIGNIS-Kette, und ein Datei-sha ist kein Kettenglied. Der Fliesstext des '
        + 'Urteils (Ruling FORM der Stimme P) sagt noch Datei-sha und ist damit ueberholt.',
      byteSiegelGetrennt: 'Der Byte-sha dieser Datei IM ENDZUSTAND steht getrennt als '
        + 'vorgaengerDateiSha256 im Fortsetzungskopf. Ein Zusammenlegen der beiden Werte ist '
        + 'verboten (LR-8); beide werden mechanisch behauptet, jeder mit eigener Bruchprobe '
        + '(LR-9). Der hier beurkundete dateiSha256VorDiesemAkt ist NICHT dieser Wert - er '
        + 'siegelt den Stand VOR diesem Akt.',
      monotonieUeberDieNaht: 'Der Fortsetzungskopf fuehrt vorgaengerLetzteAnmeldung mit dem '
        + 'letzten registeredAt der geschlossenen Datei - dem dieses Akts. Ein Register mit '
        + 'vorgaengerDatei ohne dieses Feld ist ein VerfassungsBruch; ohne vorgaengerDatei '
        + 'verhaelt sich der Pruefer Bit fuer Bit wie zuvor (LR-10/G12, seit PR-A scharf).',
    },

    gerichtsbefehl: {
      akten: ['_COURT-LEDGER-ROLLOVER-2026-09-01', '_COURT-F6-KONTINGENT-2026-09-01'],
      auflagen: 'LR-1 bis LR-22 nebst Kipp-Bedingungen LR-K1 bis LR-K7; einschlaegig fuer '
        + 'diesen Akt: LR-1, LR-3, LR-4, LR-5, LR-6, LR-15, LR-18, LR-20, LR-21, LR-22.',
      einordnung: 'Die Naht liegt nach dem Vorfall-Vermerk (F6-K6), nach der F6-K13/K14-'
        + 'Reparatur und den F6-K18-Reviews und VOR Schritt 1 der F6-K17-Bauordnung. Damit '
        + 'liegen der neue count_only_probe_authorized-Akt und der ueberschreibende Akt nach '
        + 'F6-K11 in EINER Datei - der Fortsetzung. Eine Naht mitten in einer Bauordnung ist '
        + 'verboten.',
      keinRoutineRollover: 'LR-18: ein Rollover ist nur auf Gerichtsbefehl rechtmaessig, der den '
        + 'Anlass benennt; die Ausloesemessung ist oben beurkundet. Eine DRITTE Registerdatei '
        + 'braucht eine NEUE Gerichtsentscheidung - nichts deckelt die Summe, und eine '
        + 'Teilekette hoehlte R14a aus (LR-K4).',
      k26Woertlich: 'DAS DESIGN WIRD NICHT MEHR GEAENDERT. Ab hier ist jede Aenderung an '
        + 'Fenstergrenzen, Fallzahl-Design, Schwelle, Bandbreite, SE-Vorschrift oder '
        + 'Klumpungseinheit ein retrospektiver Reparaturakt und von K3 (4:0) verboten.',
      k26Anwendung: 'Eine Registerdatei in zwei zu teilen ist KEINES dieser sechs Dinge - genau '
        + 'deshalb ist die Naht ueberhaupt erreichbar. F6-K26 wird hier zitiert, nicht beruehrt.',
    },

    nichtsVerschoben: {
      feststellung: 'KEIN EREIGNIS WIRD VERSCHOBEN, KEINES UMGESCHRIEBEN, KEINES ENTFERNT. Der '
        + 'Rollover fuegt genau EINEN Eintrag hinzu - diesen - und legt EINE leere Datei an. '
        + 'Alles andere ist Waechter-Vollendung (LR-22).',
      gedecktDurch: 'Diese Feststellung ist keine Prosa: dateiSha256VorDiesemAkt siegelt die '
        + `Bytes aller ${gemessen.eventCountVorher} vorherigen Eintraege, tailHashVorDiesemAkt `
        + 'siegelt ihre Kette, und beide sind vor dem Anhaengen am Objekt nachgerechnet worden. '
        + 'Eine Behauptung der Form "changed: false" ist so viel wert wie ihre Messung.',
      byteFrostAbDiesemAkt: 'Ab diesem Akt ist die Datei byte-eingefroren: sie waechst nie '
        + 'wieder. R14a misst sie weiter mit - eine spaetere Manipulation, die sie ueber den '
        + 'Deckel triebe, MUSS rot werden. Es gibt dafuer keine Sonderregel und keine Ausnahme.',
      appendOnlyUngebrochen: 'Einzel-Appender-Regel und Nur-Anhaengen-Semantik gelten ueber die '
        + 'Naht ungebrochen: der Einzel-Appender fuehrt seit PR-A die geordnete MENGE beider '
        + 'Registerdateien und urteilt nach Mitgliedschaft, nicht nach Gleichheit (G7).',
    },

    umhaengeVerbot: 'LR-15, HIER BEURKUNDET, damit ein spaeterer Leser sie nicht "aufraeumt": '
      + 'die Eintrags-N-Fixtures und die verbrauchten Einmal-Anhaenger bleiben auf DIESE, '
      + 'geschlossene Datei gerichtet. Sie sind Geschichtsleser. Umgehaengt liefert ihr '
      + 'findIndex -1, das Abschneiden wird still zur Nulloperation, und harte Zusicherungen '
      + 'gehen aus dem falschen Grund rot; die verbrauchten Anhaenger waeren umgehaengt tote '
      + 'Werkzeuge auf dem aktiven Register. UMHAENGEN IST DIE EROSION, NICHT DIE VOLLENDUNG. '
      + 'Ebenso bleiben alle Zeilennummern-Zitate der Gerichtsakten auf diese Datei bezogen - '
      + 'das Einfrieren macht sie erstmals dauerhaft wahr.',

    blindheit: 'LR-3: dieser Akt traegt KEINE Studiengroesse. Jede Zahl hier ist eine '
      + 'DATEIGROESSE, eine EINTRAGSZAHL oder ein HASH - keine Panelzahl, keine '
      + 'Prueffenster-Menge, keine Entdeckungszahl, keine Firmenkennung, keine Richtung. Der '
      + 'versiegelte Zwischenstand des abgebrochenen Laufs ist nicht beruehrt worden (F6-K1).',

    blindAttest: 'BLIND-ATTEST (F6-K5): der Ausfuehrende haelt KEINERLEI Information aus dem '
      + 'abgebrochenen Lauf - keine Zahl, keine Zwischengroesse, keine Richtung. Der '
      + 'Zwischenstand ist ungeoeffnet geblieben und wird es. Kein Panel, kein Endtest-'
      + 'Artefakt, keine Lueckenliste wurde fuer diesen Akt gelesen.',
    endtestSiegel: 'unberuehrt und UNVERBRAUCHT in jedem Ausgang (F6-K27/F6-A16). Dieser Akt '
      + 'oeffnet nichts und zaehlt nichts.',
    actor: 'Karl Viehrig (Auftraggeber, Freigabe-Inhaber) - ausgefuehrt unter dem Review-Tor '
      + 'des Orchestrators.',
    scope: 'Abschluss einer Registerdatei. KEIN Datenzugriff, KEIN Fenster, KEINE Ausgabe.',
    purpose: 'Die Datei von beiden Seiten lesbar schliessen: der Vorgaenger erklaert seinen '
      + 'Abschluss, der Nachfolger bindet ihn.',
    laufFreigabe: 'DIESER AKT AUTORISIERT KEINEN LAUF. Der zweite und nach F6-K19 LETZTE Anlauf '
      + 'braucht die volle F6-K17-Bauordnung 1-8 in der Fortsetzung: eigenen '
      + 'count_only_probe_authorized-Akt, frische Aequivalenz-Beine, SHA-Freeze, '
      + 'Panel-Byte-Digest, den ueberschreibenden Akt samt KZ-20-Abschnitt, Serverbeweis und '
      + 'gruenes Delta-Review - und das ausdrueckliche Signal des Orchestrators.',
  };
}

function haupt(argv) {
  if (argv.includes('--force')) {
    throw new VerfassungsBruch('F6-AB: --force gibt es nicht (F6-B8).');
  }
  const schreiben = argv.includes('--schreiben');
  const registerPfad = argument(argv, 'register') || LEDGER;

  const registeredAt = argument(argv, 'anmeldezeit') || new Date().toISOString();
  if (new Date(registeredAt).getTime() > Date.now() + 60000) {
    throw new VerfassungsBruch('F6-AB: die Anmeldezeit liegt in der Zukunft.');
  }
  const wirksamAb = argument(argv, 'wirksam-ab')
    || new Date(new Date(registeredAt).getTime() + VORLAUF_MINUTEN * 60000).toISOString();
  if (!(new Date(registeredAt) < new Date(wirksamAb))) {
    throw new VerfassungsBruch('F6-AB: wirksam-ab muss NACH der Anmeldung liegen (VB-A11).');
  }

  // Erst die BYTES, dann der Baum: was in den Akt wandert, ist die Messung an
  // der Datei, die geschlossen wird - nicht eine Konstante aus diesem Kopf.
  const rohBytes = fs.readFileSync(registerPfad);
  const bytesVorher = rohBytes.length;
  const dateiSha256VorDiesemAkt = crypto.createHash('sha256').update(rohBytes).digest('hex');

  const register = JSON.parse(rohBytes.toString('utf8'));
  const events = register.events || [];
  if (events.length !== ERWARTETE_EVENTS) {
    throw new VerfassungsBruch(
      `F6-AB: das Register fuehrt ${events.length} Eintraege, erwartet ${ERWARTETE_EVENTS}.`);
  }
  const letzter = events[events.length - 1];
  if (letzter.runId !== ERWARTETER_LETZTER_RUNID || letzter.eventHash !== ERWARTETER_TAIL) {
    throw new VerfassungsBruch(
      `F6-AB: das Kettenende ist ${letzter.runId} / ${letzter.eventHash}, erwartet `
      + `${ERWARTETER_LETZTER_RUNID} / ${ERWARTETER_TAIL}.`);
  }
  if (events.some((e) => e.runId === RUN_ID)) {
    throw new VerfassungsBruch(`F6-AB: die runId ${RUN_ID} ist bereits belegt.`);
  }

  const eintrag = baueEintrag(registeredAt, wirksamAb, {
    eventCountVorher: events.length, bytesVorher, dateiSha256VorDiesemAkt,
  });
  pruefeR12a(eintrag);
  const neu = haengeEintragAn(register, eintrag);
  pruefeZugriffsRegister(neu);
  const fertig = neu.events[neu.events.length - 1];
  const serialisiert = `${JSON.stringify(neu, null, 1)}\n`;
  const bytesNachher = Buffer.byteLength(serialisiert, 'utf8');

  process.stdout.write(
    'Akt           DER ABSCHLUSS-AKT der ersten Registerdatei (LR-4/LR-5)\n'
    + `runId         ${RUN_ID}\n`
    + `typ           ${ART_C0_REGELFREEZE}   allowedOutputs []\n`
    + `Fortsetzung   ${FORTSETZUNG_REL}\n`
    + `Vorher        ${bytesVorher} B, ${events.length} Ereignisse, sha256 ${dateiSha256VorDiesemAkt}\n`
    + `Kettenende vor diesem Akt: ${ERWARTETER_LETZTER_RUNID} / ${ERWARTETER_TAIL}\n`
    + `PRUEFZEILE: "previousHash": "${fertig.previousHash}"\n`
    + `eventHash dieses Akts: ${fertig.eventHash}\n`
    + `  -> genau dieser Wert wird genesisSha256 der Fortsetzung (OB-1, Nachtrag)\n`
    + `Akt-Groesse   ${Buffer.byteLength(JSON.stringify(fertig), 'utf8')} B kompakt\n`
    + `Register danach: ${neu.events.length} Ereignisse, ${bytesNachher} B von ${DECKEL_BYTES} `
    + `(R14a), Zuwachs ${bytesNachher - bytesVorher} B\n\n`);

  // LR-20 zuerst: der Deckel ist die fail-closed-Schranke, die keine Reparatur
  // kennt. Der SOLLWERT-Riegel darunter ist die Identitaets-Pinnung; beide
  // stehen VOR jedem Schreibweg.
  pruefeDeckel(bytesNachher);
  if (bytesVorher !== SOLL_BYTES_VORHER || dateiSha256VorDiesemAkt !== SOLL_DATEI_SHA256) {
    throw new VerfassungsBruch(
      `F6-AB: die zu schliessende Datei misst ${bytesVorher} B / sha256 `
      + `${dateiSha256VorDiesemAkt}, beurkundungsreif sind ${SOLL_BYTES_VORHER} B / sha256 `
      + `${SOLL_DATEI_SHA256}. Der Stand hat sich unter dem Werkzeug bewegt - der Akt wuerde `
      + 'eine falsche Ausloesemessung beurkunden.');
  }

  if (!schreiben) {
    if (argv.includes('--zeige-eintrag')) {
      process.stdout.write(`EINTRAG:${JSON.stringify(fertig)}\n`);
    }
    process.stdout.write('TROCKENLAUF - es wurde NICHTS geschrieben.\n');
    return 0;
  }
  writeFileAtomic(registerPfad, serialisiert);
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
  RUN_ID, ERWARTETE_EVENTS, ERWARTETER_TAIL, ERWARTETER_LETZTER_RUNID,
  SOLL_BYTES_VORHER, SOLL_DATEI_SHA256, DECKEL_BYTES, MESSGATE, K11_QUELLEN,
  FORTSETZUNG_REL, LEDGER_REL, LEDGER, WURZEL,
  baueEintrag, pruefeDeckel, haupt,
};
