#!/usr/bin/env node
'use strict';

// Studie 2.0, F6-Tor — DER VORFALL-VERMERK (F6-K6..K9).
//
// Der eine autorisierte Lauf hat das Prueffenster-Panel GELESEN und ist danach
// an einem Wachposten-Fehlalarm abgebrochen, ohne dass irgendjemand ein
// Ergebnis gesehen hat. Das Gericht hat entschieden: Kontingent EINS ist NICHT
// verbraucht - aufschiebend bedingt auf das Siegel (F6-K1/F6-K2), aufloesend
// bedingt auf F6-K21. Dieser Vermerk beurkundet den Vorfall; er autorisiert
// NICHTS.
//
// Eigenes Einzweck-Werkzeug nach F6-B8 (Muster studie-f6-berichtigung-bein2.js).
// Kein stillgelegtes Werkzeug bekommt einen Schreibweg.
//
//   node scripts/studie-f6-vorfall.js                 # Trockenlauf
//   node scripts/studie-f6-vorfall.js --zeige-eintrag # + Eintrag als JSON
//   node scripts/studie-f6-vorfall.js --schreiben     # anhaengen

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

const RUN_ID = 'f6-vorfall-lauf-abbruch-2026-09-01';
const VORLAUF_MINUTEN = 120;
const ERWARTETE_EVENTS = 29;
const ERWARTETER_LETZTER_RUNID = 'f6-eintrag28-ergaenzung-2026-09-01';
const ERWARTETER_TAIL = '0286419a727d63f271403793f3f29d8c5033f84aa631704888dedae048b12931';

// F6-K2 — das Siegel. Gemessen 2026-09-01T19:20:24.970Z-19:20:25.133Z mit
// scripts/studie-panel-digest.py (SHA 14414d26..., byte-gleich zu seiner
// Bindung in Eintrag 28). SQL-frei, blind, kein Inhalt gelesen.
const SIEGEL = {
  objektKurzform: 'lauf-f6-konfirmatorisch-v2-2026-09-01/zwischenstand.sqlite',
  groesseBytes: 146812928,
  schreibzeit: '2026-09-01T18:17:06.152Z',
  sha256: '8608e12d110b96a056daffdab867e1573dd0fa5e54535ba027b77098ff8e437b',
  versiegeltAm: '2026-09-01T19:20:25.133Z',
};

// Der Abbruchtext BYTE-GENAU, wie er auf stderr stand. Das Urteil fuehrt ihn
// nur gekuerzt (F6-K7(c)); hier steht er ungekuerzt.
const ABBRUCHTEXT = 'F6-LAUF-ABBRUCH: ABSOLUTER PFAD IM BERICHT bei '
  + 'bericht.umschlag.gelesenePfade[10] (R12a). Ein voller Pfad traegt die '
  + 'Benutzerkennung des Rechners in die Akte. Es gilt die Kurzform '
  + 'Elternverzeichnis/Datei (Muster scripts/studie-basisraten.py:251).';

const argument = (argv, n) => {
  const i = argv.indexOf(`--${n}`);
  if (i < 0) return null;
  const v = argv[i + 1];
  if (!v || v.startsWith('--')) throw new VerfassungsBruch(`F6-VF: --${n} ohne Wert.`);
  return v;
};
const sha = (s) => crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');

// F6-K9: der Vermerk ueber einen R12a-Vorfall darf nicht selbst gegen R12a
// verstossen. Geprueft wird der GEPARSTE Baum (JSON verdoppelt Rueckstriche).
function pruefeR12a(obj) {
  const werte = [];
  (function sammle(v) {
    if (typeof v === 'string') werte.push(v);
    else if (Array.isArray(v)) v.forEach(sammle);
    else if (v && typeof v === 'object') {
      for (const [k, w] of Object.entries(v)) { werte.push(k); sammle(w); }
    }
  }(obj));
  const BS = String.fromCharCode(92);
  const S = `[${BS}${BS}/]`;
  const MUSTER = [
    ['Windows-Laufwerkspfad', new RegExp(`\\b[A-Za-z]:${S}{1,2}Users\\b`)],
    ['Windows-Nutzerverzeichnis', new RegExp(`${S}Users${S}[A-Za-z]`)],
    ['Unix-Heimverzeichnis', new RegExp(`(^|[\\s"'(=])/${['ho', 'me'].join('')}/[a-z]`, 'm')],
    ['Umgebungs-Nutzerpfad',
      new RegExp(`%${['USER', 'PROFILE'].join('')}%|\\$${['HO', 'ME'].join('')}\\b`)],
    ['Windows-Laufwerkspfad, beliebiges Ziel',
      new RegExp(`(^|[\\s"'(=[,])[A-Za-z]:${S}{1,2}[A-Za-z0-9_.-]`, 'm')],
  ];
  for (const [name, regex] of MUSTER) {
    for (const wert of werte) {
      if (regex.test(wert)) {
        throw new VerfassungsBruch(
          `F6-VF: der Vermerk traegt ${name}. Ein Vermerk ueber einen `
          + 'R12a-Vorfall darf nicht selbst gegen R12a verstossen (F6-K9).');
      }
    }
  }
}

function baueEintrag(registeredAt, wirksamAb) {
  return {
    runId: RUN_ID,
    typ: ART_C0_REGELFREEZE,
    registeredAt,
    accessedAt: wirksamAb,
    fenster: ['kein Studienfenster - Vermerk ohne Datenzugriff'],
    allowedOutputs: [],
    erlaubt: 'Nichts. Kein Datenzugriff.',
    verboten: 'Jede Berufung auf diesen Vermerk als Autorisierung eines Laufs.',

    begruendung: 'VORFALL-VERMERK nach F6-K6, sperrend und VOR jeder weiteren Handlung. '
      + 'Der unter Eintrag 28 autorisierte EINE konfirmatorische Lauf hat das '
      + 'Prueffenster-Panel gelesen und ist danach an einem Fehlalarm des eigenen '
      + 'R12a-Wachpostens abgebrochen. Niemand hat ein Ergebnis gesehen. Das Gericht hat '
      + 'am selben Tag entschieden, dass Kontingent EINS dadurch NICHT verbraucht ist - '
      + 'als Entscheidung einer REGELLUECKE, in der schwaechsten die Mehrheit stuetzenden '
      + 'Fassung, aufschiebend bedingt auf das Siegel (F6-K1/F6-K2) und aufloesend '
      + 'bedingt auf die fuenf kumulativen Bedingungen aus F6-K21. Ein nach einer '
      + 'Beruehrung unveraendertes Register waere selbst ein Aktenmangel; deshalb dieser '
      + 'Vermerk. Er autorisiert nichts.',

    // (a) — der Lauf, seine Grundlage, seine Zeitkette.
    a_lauf: {
      runId: 'f6-konfirmatorisch-v2-2026-09-01',
      eventHash: '51c235ebd79272f7cce976f3627816bc50c283f47c4f34dd2d630af3eca66938',
      freigabegrundlage: 'Eintrag 28, registeredAt 2026-09-01T09:02:56.527Z; Serverbeweis '
        + 'reports/studie/f6-konfirmatorisch-v2-freigabe.json, serverConfirmedAt '
        + '09:21:02.000Z, accessedAt 11:02:56.527Z, registerZweig main.',
      gestartet: '2026-09-01T18:16:53Z',
      panelGelesen: '2026-09-01T18:17:06Z',
      abgebrochen: '2026-09-01T18:17:13Z',
      exitCode: 1,
    },

    // (b) — die Kerntatsache, ungeschoent.
    b_lesungVollzogen: 'DIE EINE AUTORISIERTE LESUNG DES PRUEFFENSTER-PANELS WURDE '
      + 'VOLLZOGEN. Das Panel wurde geoeffnet und gelesen; die Zaehlung lief durch; der '
      + 'Abbruch liegt DANACH. Das ist die Kerntatsache dieses Vermerks und wird nicht '
      + 'kleingeschrieben. Was nicht geschah: irgendjemand hat ein Ergebnis gesehen.',

    // (c) — der Abbruchtext ungekuerzt und byte-genau.
    c_abbruchtext: {
      woertlich: ABBRUCHTEXT,
      sha256: sha(ABBRUCHTEXT),
      zeichen: ABBRUCHTEXT.length,
      fundstelle: 'scripts/studie-f6-lauf.py:1352-1356 (raise LaufAbbruch samt vollstaendiger '
        + 'Meldung), Rahmen scripts/studie-f6-lauf.py:1672-1674 (except LaufAbbruch -> '
        + 'stderr, return 1).',
      hinweis: 'Das Urteil _COURT-F6-KONTINGENT-2026-09-01.md fuehrt diesen Text mit '
        + 'Auslassung nach dem zweiten Satz. DIE HIER STEHENDE FASSUNG IST DIE '
        + 'VOLLSTAENDIGE; kein Folgedokument darf die gekuerzte als den ganzen Wortlaut '
        + 'fuehren.',
    },

    // (d) — der Defekt: vorbestehend und latent.
    d_defekt: {
      art: 'VORBESTEHEND UND LATENT',
      mechanismus: 'Die Verbotsmenge des Wachpostens fuehrt neben den absoluten Formen auch '
        + 'die ROHEN CLI-Argumente (scripts/studie-f6-lauf.py:1644-1646). Ein RELATIV '
        + 'uebergebenes Argument ist byte-gleich seinem eigenen kurzpfad - der Wachposten '
        + 'feuert damit auf seine eigene legitime Ausgabe.',
      herkunft: 'git log -S und git blame auf :1644-1646 zeigen beide '
        + '347f0e8e0815a016f8f8fdd4fb83b15ac6f81867 (PR #192, "F6-Laeufer + Zaehlwerk: '
        + 'Bauordnung Schritt 1"), dort urspruenglich Zeile 1463. Unveraendert durch '
        + 'PR #195 und PR #215.',
      alter: 'AELTER als Eintrag 28 und aelter als das Lauf-Signal. Der Defekt wurde nicht '
        + 'durch die Reparaturen dieses Tors eingefuehrt.',
      warumKeineFixtureIhnErreichte: 'JEDE Fixture des Laeufers fuehrt ABSOLUTE Temp-Pfade; '
        + 'dort sind rohe und absolute Form verschieden und die Kollision kann nicht '
        + 'entstehen. Der Defektpfad ist ausschliesslich ueber RELATIVE CLI-Aufrufe '
        + 'erreichbar - also genau ueber die Aufrufform, in der ein Mensch das Werkzeug aus '
        + 'der Repo-Wurzel startet.',
      reproduziert: 'IN ISOLATION OHNE JEDES PANEL reproduziert: kurzpfad("scripts/'
        + 'studie-f6-zaehlwerk.py") ist identisch mit dem rohen Argument, und der Wachposten '
        + 'feuert darauf.',
    },

    // (e) — die maschinelle Blindheit, mit Ankern statt Zusicherung.
    e_blindheit: {
      form: 'BEURKUNDUNG MIT ANKERN, keine Zusicherung ueber Verhalten.',
      anker: [
        'scripts/studie-f6-lauf.py:1664-1665 - "Fail-closed bis in die Ausgabe: bei einem '
          + 'Abbruch wird KEIN Bericht geschrieben. Ein halber Bericht wanderte als '
          + 'Ergebnis in die Akte."',
        'Der Wachposten steht bei :1640-1646 (Kommentar ab :1638) und damit STRIKT VOR dem '
          + 'Schreibvorgang.',
        'Berichtschreiben (:1715) UND stdout-Ausgabe des Protokolls (:1717) liegen BEIDE '
          + 'hinter dem return des Abbruchpfades (:1674). Am Objekt nachgezaehlt; das '
          + 'Urteil weist eine +/-1-Divergenz der Stimmen aus, die Substanz ist unstreitig.',
        'Der Abbruchtext ist wertfrei: er nennt einen Schluesselpfad und eine Regel, keine '
          + 'Zahl, keine Richtung, keine Firmenkennung.',
        'KEIN Berichts-Artefakt in reports/studie/ - die Zieldatei existiert nicht.',
        'Arbeitsbaum sauber, Register unveraendert.',
        'Der Exit-Code ist abbruchklassen-invariant (1 fuer jeden LaufAbbruch) und traegt '
          + 'deshalb keine Information ueber den Inhalt.',
      ],
      siebenKanaele: 'Alle sieben denkbaren Kanaele wurden einzeln geschlossen: Bericht, '
        + 'stdout, stderr, Exit-Code, Laufzeit, Dateisystem-Metadaten, Zwischenstand. Der '
        + 'einzige ueberlebende ist der Zwischenstand - und der ist versiegelt (unten).',
    },

    // (f) — die Beschluss-Sperre, maximal.
    f_beschlussSperre: 'NICHTS IN DIESER AKTE ENTHAELT EINE AUSSAGE UEBER RICHTUNG, GROESSE '
      + 'ODER AUSGANG DER VERLORENEN MESSUNG - UND WIRD NIE EINE ENTHALTEN. Die Messung ist '
      + 'niemandem bekannt: sie existierte im Speicher eines abgebrochenen Prozesses und '
      + 'wurde nie geschrieben. Weder der Ausfuehrende noch der Orchestrator noch das '
      + 'Gericht kennt sie.',

    // (g) — das Siegel nach F6-K2.
    g_siegel: {
      objekt: SIEGEL.objektKurzform,
      pfadform: 'NUR KURZFORM (R12a/F6-K9). Der Arbeitspfad liegt im Nutzerverzeichnis '
        + 'ausserhalb des Repos; der volle Pfad steht in diesem Vermerk NICHT.',
      groesseBytes: SIEGEL.groesseBytes,
      schreibzeit: SIEGEL.schreibzeit,
      sha256: SIEGEL.sha256,
      versiegeltAm: SIEGEL.versiegeltAm,
      werkzeug: 'scripts/studie-panel-digest.py, sha256 '
        + '14414d2633f74b94662d503336db61be6825f3c7b89b6ebcf3275a841396f33f - byte-gleich '
        + 'zu seiner Bindung in Eintrag 28, vor dem Gebrauch nachgerechnet.',
      wasDerHashTUT: 'DER HASH SIEGELT BYTES UND LIEST KEINEN INHALT. SQL-frei, blind, kein '
        + 'sqlite3, keine Abfrage, keine Spalte, keine Zeile. Groesse und Zugriffszeit sind '
        + 'vor und nach dem Siegel byte-gleich.',
      nieGeoeffnet: 'DIE DATEI IST NIE GEOEFFNET WORDEN und wird es nicht - von niemandem, '
        + 'zu keinem Zweck, ohne Ablaufdatum (F6-K1). Auch nicht zur Diagnose: der Defekt '
        + 'ist ohne jedes Panel reproduziert, und der gebundene Laeufer schreibt die '
        + 'Diagnoseform selbst vor (Wiederholung mit Fixture-Zaehlwerk).',
      verwahrer: 'Karl Viehrig (Auftraggeber). Vernichtung ist NICHT beschlossen und wird '
        + 'nicht empfohlen; sie ist allein Karls Entscheidung (F6-K3). Ordnet er sie an, '
        + 'ist die Reihenfolge fest: erst Siegel und Vermerk, dann Vernichtung, dann ein '
        + 'eigener Beurkundungs-Vermerk - die Akte ueberlebt das Objekt.',
      schemaDivergenzAufgeloest: 'Das Urteil weist eine Fundstellen-Divergenz aus '
        + '(studie-f6-zaehlwerk.py:786-790 gegen studie-basisraten.py:462-467). AM CODE '
        + 'aufgeloest, OHNE die Datei zu oeffnen: beide Stellen fuehren dieselbe '
        + 'CREATE-TABLE-Kette roh / lauf_stand / zaehler_stand; das Zaehlwerk baut das '
        + 'Gerippe des Hauses nach. KORROBORATION, kein Widerspruch.',
    },

    // (h) — die zwei gemessenen Verluste in Eintrag 28.
    h_verlusteInEintrag28: {
      form: 'MESSUNG OHNE ZAEHLENTSCHEID.',
      verlust1: 'Der Verbrauchssatz aus Eintrag 27 ("Nach diesem Lauf ist das Kontingent '
        + 'verbraucht; eine weitere Prueffenster-Beruehrung braucht einen eigenen, neuen '
        + 'Akt.") ist in Eintrag 28 FALLENGELASSEN.',
      verlust2: 'Das Zweitlauf-Verbot aus Eintrag 27 ("Jeder zweite Lauf unter dieser '
        + 'runId; ...") FEHLT im verboten-Feld von Eintrag 28.',
      keineErlaubnis: 'BEIDES ERZEUGT KEINE ERLAUBNIS. "und nur er" in der begruendung und '
        + '"EIN Fenster, EIN Tor" im scope binden weiter; K2, A10 und die Verfassung binden '
        + 'unabhaengig von der Glosse eines Eintrags.',
      ob1: 'OB-1: Ob dies den fuenften Fall von KZ-25 ausloest, ist OHNE BESCHLUSS. Stimme W '
        + 'hat es dem Gericht verwiesen, die Stimmen K und V schweigen. Dieser Vermerk '
        + 'entscheidet es nicht.',
      klasse: 'Es ist eine weitere gemessene Instanz derselben Verlustklasse, die Eintrag 29 '
        + 'als MESSBAR UNWAHR beurkundet hat: wer nur Hinzugefuegtes prueft, bezeugt nichts '
        + 'ueber Weggefallenes.',
    },

    // (i) — das Verhalten des Ausfuehrenden.
    i_verhaltenDesAusfuehrenden: 'Der Ausfuehrende hat NICHT NEU GEFEUERT, NICHTS '
      + 'NACHJUSTIERT, DAS PANEL NICHT ERNEUT BERUEHRT UND DEN ZWISCHENSTAND NICHT '
      + 'GEOEFFNET. Nach dem Abbruch wurde ausschliesslich diagnostiziert - der Defekt in '
      + 'Isolation ohne Panel reproduziert - und berichtet. Aktenkonform nach dem Muster '
      + '"Anlauf 4 riss -> Forensik OHNE Eingriff" (KZ-4). Kein Byte am Laeufer wurde '
      + 'bewegt: sein sha256 ist unveraendert '
      + 'd04a0eaeeb05a17631122cb2f87ac587946d9e345705e348d265ba4dcd9fb688, byte-gleich zur '
      + 'Bindung in Eintrag 28.',

    blindAttest: 'BLIND-ATTEST (F6-K5): Der Ausfuehrende haelt KEINERLEI Information aus dem '
      + 'abgebrochenen Lauf - keine Zahl, keine Zwischengroesse, keine Richtung. Der '
      + 'Zwischenstand ist ungeoeffnet geblieben; die einzige Beruehrung war der blinde '
      + 'Byte-Digest nach F6-K2, der keinen Inhalt liest.',
    endtestSiegel: 'unberuehrt und UNVERBRAUCHT in jedem Ausgang (F6-K27). Dieser Vermerk '
      + 'oeffnet nichts und zaehlt nichts.',
    actor: 'Karl Viehrig (Auftraggeber, Freigabe-Inhaber) - ausgefuehrt durch den '
      + 'Nacht-Agenten der Session 07 unter dem Review-Tor des Orchestrators.',
    scope: 'Beurkundung eines Vorfalls. KEIN Datenzugriff, KEIN Fenster, KEINE Ausgabe.',
    purpose: 'Den Vorfall aktenfest machen, bevor irgendeine weitere Handlung erfolgt '
      + '(F6-K6, sperrend).',
    laufFreigabe: 'DIESER VERMERK AUTORISIERT KEINEN LAUF. Der zweite und nach F6-K19 '
      + 'LETZTE Anlauf braucht die reparierte Kette, den ueberschreibenden Akt, frische '
      + 'Aequivalenz-Beine unter eigenem Zaehlproben-Akt, das Delta-Review und das '
      + 'ausdrueckliche Signal des Orchestrators.',
  };
}

function haupt(argv) {
  if (argv.includes('--force')) {
    throw new VerfassungsBruch('F6-VF: --force gibt es nicht (F6-B8).');
  }
  const schreiben = argv.includes('--schreiben');
  const registerPfad = argument(argv, 'register') || LEDGER;

  const registeredAt = argument(argv, 'anmeldezeit') || new Date().toISOString();
  if (new Date(registeredAt).getTime() > Date.now() + 60000) {
    throw new VerfassungsBruch('F6-VF: die Anmeldezeit liegt in der Zukunft.');
  }
  const wirksamAb = argument(argv, 'wirksam-ab')
    || new Date(new Date(registeredAt).getTime() + VORLAUF_MINUTEN * 60000).toISOString();
  if (!(new Date(registeredAt) < new Date(wirksamAb))) {
    throw new VerfassungsBruch('F6-VF: wirksam-ab muss NACH der Anmeldung liegen (VB-A11).');
  }

  const register = JSON.parse(fs.readFileSync(registerPfad, 'utf8'));
  const events = register.events || [];
  if (events.length !== ERWARTETE_EVENTS) {
    throw new VerfassungsBruch(
      `F6-VF: das Register fuehrt ${events.length} Eintraege, erwartet ${ERWARTETE_EVENTS}.`);
  }
  const letzter = events[events.length - 1];
  if (letzter.runId !== ERWARTETER_LETZTER_RUNID || letzter.eventHash !== ERWARTETER_TAIL) {
    throw new VerfassungsBruch(
      `F6-VF: das Kettenende ist ${letzter.runId} / ${letzter.eventHash}, erwartet `
      + `${ERWARTETER_LETZTER_RUNID} / ${ERWARTETER_TAIL}.`);
  }
  if (events.some((e) => e.runId === RUN_ID)) {
    throw new VerfassungsBruch(`F6-VF: die runId ${RUN_ID} ist bereits belegt.`);
  }

  const eintrag = baueEintrag(registeredAt, wirksamAb);
  pruefeR12a(eintrag);
  const neu = haengeEintragAn(register, eintrag);
  pruefeZugriffsRegister(neu);
  const fertig = neu.events[neu.events.length - 1];
  const bytes = Buffer.byteLength(`${JSON.stringify(neu, null, 1)}\n`, 'utf8');

  process.stdout.write(
    'Akt           DER VORFALL-VERMERK (F6-K6..K9)\n'
    + `runId         ${RUN_ID}\n`
    + `typ           ${ART_C0_REGELFREEZE}   allowedOutputs []\n`
    + `Siegel        ${SIEGEL.groesseBytes} B, sha256 ${SIEGEL.sha256.slice(0, 16)}...\n`
    + `Abbruchtext   ${ABBRUCHTEXT.length} Zeichen, sha256 ${sha(ABBRUCHTEXT).slice(0, 16)}...\n`
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
  RUN_ID, ERWARTETER_TAIL, SIEGEL, ABBRUCHTEXT, baueEintrag, haupt,
  pruefeR12a, WURZEL, LEDGER,
};
