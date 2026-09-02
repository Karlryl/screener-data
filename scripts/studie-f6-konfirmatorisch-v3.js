#!/usr/bin/env node
'use strict';

// Studie 2.0, F6-K17 Schritt 6 — DER UEBERSCHREIBENDE KONFIRMATORISCHE AKT.
//
// Eintrag 28 deckt den reparierten Laeufer NICHT (ledger:1798, F6-C24(3)): nach
// der Anmeldung kein Byte mehr an Laeufer, Zaehlwerk oder Zaehlprobe. Die
// F6-K13-Reparatur hat genau das getan. Ein Akt, der andere Bytes autorisiert
// als die, die laufen werden, autorisiert nichts. Der Hausmechanismus dagegen
// ist nicht die Auslegung, sondern die UEBERSCHREIBUNG (F6-K11).
//
// ER LIEGT IN DER FORTSETZUNG, als Eintrag 2: der count-only-Akt (F6-K17
// Schritt 2) ist ihr Eintrag 1. Die erste Registerdatei ist geschlossen.
//
// LR-2: DER AKT WIRD AUSGESCHRIEBEN, NIE VERZEIGERT. Eine Hash-Referenz statt
// des Abdrucks stellte genau die Fehlklasse wieder her, an der Eintrag 27
// gestorben ist und wegen der Eintrag 29 ueberhaupt existiert. Deshalb
// KOMPONIERT dieses Werkzeug den Akt aus seinen drei Quellen - Eintrag 28
// (Rumpf), Eintrag 29 (wiederhergestellte Schicht), Eintrag 30 (Vorfall) -,
// jede adressiert nach DATEI + eventHash (LR-21) und jede vor der Uebernahme
// am Hash nachgerechnet. Nichts wird abgetippt.
//
// LRA-12: JEDER gebundene SHA wird im Moment des Akts gegen einen sauberen Baum
// gemessen. Kein Wert wird aus Eintrag 28 abgeschrieben - dort steht u. a. ein
// veralteter Wert fuer scripts/studie-r1-serverzeit.js.
//
// Eigenes Einzweck-Werkzeug nach F6-B8 (Muster studie-f6-aequivalenz-akt2.js).
//
//   node scripts/studie-f6-konfirmatorisch-v3.js                 # Trockenlauf
//   node scripts/studie-f6-konfirmatorisch-v3.js --zeige-eintrag # + Eintrag als JSON
//   node scripts/studie-f6-konfirmatorisch-v3.js --schreiben     # anhaengen

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { writeFileAtomic } = require('../lib/atomic-write.js');
const {
  VerfassungsBruch, haengeEintragAn, pruefeZugriffsRegister, ART_ZUGRIFF,
  REGISTER_RELS, AKTIVES_REGISTER_REL, istGeschlossen,
} = require('../lib/studie-verfassung.js');
const { pruefeR12a } = require('./studie-f6-vorfall.js');

const WURZEL = path.join(__dirname, '..');
const absolut = (rel) => path.join(WURZEL, ...rel.split('/'));
const GESCHLOSSEN_REL = REGISTER_RELS[0];
const ZIEL_REL = AKTIVES_REGISTER_REL;

const RUN_ID = 'f6-konfirmatorisch-v3-2026-09-02';
const DECKEL_BYTES = 200 * 1024;

// VORLAUF: 20 Minuten, NICHT 120. Die Hausform der VERMERKE setzt +2h, weil
// accessedAt dort nur "ab wann der Stand gilt" bedeutet. Fuer einen Akt, der
// einen LAUF autorisiert, ist derselbe Wert ein echter STARTBLOCK - der zweite
// Anlauf hat das schon einmal eine Stunde gekostet. Der Fussboden hat keine
// Obergrenze: zu frueh kostet nichts, zu spaet kostet den Lauf.
const VORLAUF_MINUTEN = 20;

// Die drei Quellen, je nach DATEI + eventHash adressiert (LR-21).
const RUMPF = {
  datei: GESCHLOSSEN_REL,
  runId: 'f6-konfirmatorisch-v2-2026-09-01',
  eventHash: '51c235ebd79272f7cce976f3627816bc50c283f47c4f34dd2d630af3eca66938',
};
const SCHICHT = {
  datei: GESCHLOSSEN_REL,
  runId: 'f6-eintrag28-ergaenzung-2026-09-01',
  eventHash: '0286419a727d63f271403793f3f29d8c5033f84aa631704888dedae048b12931',
};
const VORFALL = {
  datei: GESCHLOSSEN_REL,
  runId: 'f6-vorfall-lauf-abbruch-2026-09-01',
  eventHash: '5ed947d05e4f93ff6d7b485e81022b9ad1733238349932a009570b5b9c6dd15a',
};

// Die Fortsetzung fuehrt am Tag dieses Akts GENAU EINEN Eintrag: den
// count-only-Akt. Dieser hier ist ihr zweiter.
const ERWARTETE_EVENTS = 1;

const AEQUI_BERICHT_REL = 'reports/studie/f6-aequivalenz-entdeckung-v2-2026-09-02.json';
const AUFRUFER_REL = 'scripts/studie-f6-zaehlprobe-fortsetzung.py';
const LAEUFER_REL = 'scripts/studie-f6-lauf.py';
const SERVERZEIT_REL = 'scripts/studie-r1-serverzeit.js';

// Der Laeufer-SHA VOR der F6-K13-Reparatur. Die Vorfall-Anker loesen gegen
// diesen Wert auf; er ist die Gegenprobe dafuer, dass die Reparatur wirklich
// zwischen Eintrag 28 und diesem Akt liegt.
const LAEUFER_VORHER = 'd04a0eaeeb05a17631122cb2f87ac587946d9e345705e348d265ba4dcd9fb688';

// Umschlag-/Kettenfelder, die neu gesetzt und deshalb nicht kopiert werden.
const AUSGENOMMEN = new Set(['runId', 'typ', 'registeredAt', 'accessedAt',
  'previousHash', 'eventHash']);

// Die Schicht, die Eintrag 29 wiederhergestellt hat. Sie wird VOLL kopiert.
const E29_SCHICHT = ['f6c8hSchicht', 'richtungsOffenlegungBerichtigung',
  'torRegeltextWoertlich', 'konservierteDissense', 'zitattreueC9e',
  'weitereVermerke'];

const dsha = (rel) => crypto.createHash('sha256')
  .update(fs.readFileSync(absolut(rel))).digest('hex');

const argument = (argv, n) => {
  const i = argv.indexOf(`--${n}`);
  if (i < 0) return null;
  const v = argv[i + 1];
  if (!v || v.startsWith('--')) throw new VerfassungsBruch(`F6-K11: --${n} ohne Wert.`);
  return v;
};

// Die Weggefallenes-Pruefung als eigene, pruefbare Funktion. Inline waere sie
// nur brechbar, indem man den Komponisten umbaut - und eine Zusicherung, die
// sich nicht brechen laesst, belegt nicht, dass sie feuert.
function pruefeWeggefallenes(sollFelder, eintrag) {
  const verloren = sollFelder.filter((k) => !(k in eintrag));
  if (verloren.length) {
    throw new VerfassungsBruch(
      `F6-K11: die Weggefallenes-Pruefung findet ${verloren.length} verlorene Felder: `
      + `${verloren.join(', ')}. Ein Akt, der "traegt alles" behauptet und es nicht tut, ist `
      + 'genau die Fehlklasse, an der Eintrag 27 gestorben ist.');
  }
  return verloren;
}

function pruefeDeckel(bytesNachher) {
  if (bytesNachher >= DECKEL_BYTES) {
    throw new VerfassungsBruch(
      `F6-K11: die Fortsetzung waere nach diesem Akt ${bytesNachher} B und erreichte damit den `
      + `R14a-Deckel von ${DECKEL_BYTES} B. Es wird NICHT geschrieben (LR-20).`);
  }
}

// Holt einen Quell-Akt und rechnet seinen Hash nach. Ohne diese Pruefung waere
// das Kopieren ein Vertrauensakt statt einer Messung.
function quellAkt(quelle, registerCache) {
  const register = registerCache
    || JSON.parse(fs.readFileSync(absolut(quelle.datei), 'utf8'));
  const treffer = (register.events || []).filter((e) => e.runId === quelle.runId);
  if (treffer.length !== 1) {
    throw new VerfassungsBruch(
      `F6-K11: ${quelle.runId} steht ${treffer.length}-mal in ${quelle.datei}, erwartet genau einmal.`);
  }
  if (treffer[0].eventHash !== quelle.eventHash) {
    throw new VerfassungsBruch(
      `F6-K11: ${quelle.runId} traegt eventHash ${treffer[0].eventHash}, erwartet `
      + `${quelle.eventHash}. Ein anderer Hash ist ein anderer Akt - es wird nicht kopiert.`);
  }
  return treffer[0];
}

function baueEintrag(registeredAt, zugriffAb, e28, e29, e30) {
  const eintrag = {
    runId: RUN_ID,
    typ: ART_ZUGRIFF,
    registeredAt,
    accessedAt: zugriffAb,
  };
  // LR-2: ALLES aus Eintrag 28, ausgeschrieben.
  for (const [k, v] of Object.entries(e28)) {
    if (!AUSGENOMMEN.has(k)) eintrag[k] = JSON.parse(JSON.stringify(v));
  }
  // Die von Eintrag 29 wiederhergestellte Schicht, ausgeschrieben.
  for (const k of E29_SCHICHT) {
    if (!(k in e29)) {
      throw new VerfassungsBruch(`F6-K11: Eintrag 29 fuehrt ${k} nicht - die Schicht ist unvollstaendig.`);
    }
    eintrag[k] = JSON.parse(JSON.stringify(e29[k]));
  }
  eintrag.herkunftDerSchicht = 'Die Schicht F6-C8h/F6-C8i, der byte-genaue TOR_REGELTEXT, die '
    + 'beiden konservierten Dissense, die Zitattreue-Berichtigung und die drei Delta-Vermerke '
    + 'sind VOLLSTAENDIG aus dem Ergaenzungs-Vermerk uebernommen - kopiert, nicht referenziert '
    + '(LR-2). Eintrag 28 hatte diese Schicht verloren und im selben Atemzug behauptet, sie zu '
    + 'tragen; dieser Akt macht die Behauptung pruefbar, indem er sie fuehrt.';

  // ── LRA-12: ALLE Bindungen frisch am Objekt gemessen ────────────────────
  const drift = [];
  const messe = (karte) => {
    for (const [rel, wert] of Object.entries(karte)) {
      const ist = dsha(rel);
      if (wert.dateiSha256 !== ist) drift.push({ rel, vorher: wert.dateiSha256, nachher: ist });
      wert.dateiSha256 = ist;
    }
  };
  messe(eintrag.eingabenHashes.skripte);
  messe(eintrag.eingabenHashes.artefakte);

  // Der Option-A-Aufrufer postdatiert Eintrag 28 und wird hier erstmals gebunden.
  eintrag.eingabenHashes.skripte[AUFRUFER_REL] = {
    dateiSha256: dsha(AUFRUFER_REL),
    art: 'ausfuehrend',
    rolle: 'Option-A-Aufrufer: lenkt zur Laufzeit GENAU EINE Funktion der gesiegelten '
      + 'scripts/studie-zaehlprobe.py auf die Register-Fortsetzung um, nachdem er nachgerechnet '
      + 'hat, dass das Modul das gesiegelte ist. Null Bytes an der gesiegelten Datei (PR #246).',
  };

  // ── Die Aequivalenz-Evidenz: der v2-Bericht samt seinem Treiber ─────────
  const bericht = JSON.parse(fs.readFileSync(absolut(AEQUI_BERICHT_REL), 'utf8'));
  if (bericht.daten.bestanden !== true) {
    throw new VerfassungsBruch('F6-K11: der Aequivalenz-Bericht traegt kein bestandenes Tor.');
  }
  eintrag.eingabenHashes.aequivalenzBericht = {
    pfad: AEQUI_BERICHT_REL,
    dateiSha256: dsha(AEQUI_BERICHT_REL),
    verdikt: bericht.daten.bestanden,
    registerDatei: bericht.umschlag.registerDatei,
    registerEventHash: bericht.umschlag.registerEventHash,
    treiberSha256: bericht.umschlag.treiberSha256,
    treiberHinweis: 'Der Treiber ist GLUE ausserhalb des Repos; er rechnet nichts. Das '
      + 'KZ-4-Verdikt faellt in scripts/studie-f6-zaehlwerk.py::aequivalenz_tor bit-genau gegen '
      + 'BEIN2_SOLL. Sein SHA steht hier, damit die AUSFUEHRUNG zurechenbar ist - nicht, weil er '
      + 'etwas entschieden haette.',
    ersetzt: 'Der v1-Bericht reports/studie/f6-aequivalenz-entdeckung-2026-09-01.json gehoert zum '
      + 'verbrauchten Akt von Eintrag 25 und traegt diesen Lauf nicht.',
  };

  // ── F6-C24a: vorher/nachher mit Grund und PR-Nummer ─────────────────────
  const vn = eintrag.eingabenHashes.vorherNachher;
  vn[LAEUFER_REL] = {
    vorher: LAEUFER_VORHER,
    nachher: eintrag.eingabenHashes.skripte[LAEUFER_REL].dateiSha256,
    durch: 'Die F6-K13-Wurzelreparatur des R12a-Wachpostens samt F6-K15-Vorpruefung (PR #229), '
      + 'nach den K18-Reviews gemergt.',
  };
  vn[SERVERZEIT_REL] = {
    vorher: e28.eingabenHashes.skripte[SERVERZEIT_REL].dateiSha256,
    nachher: eintrag.eingabenHashes.skripte[SERVERZEIT_REL].dateiSha256,
    durch: 'Die Naht-Arbeiten: Ketten-Aufloeser fuer bestaetigen (LR-14 Teil 2, PR #238), '
      + 'Schliessungsriegel am Schreib-Rand und Umhaengung des Anmeldeziels auf die Fortsetzung '
      + '(LRA-2/LRA-3, PR #239). LRA-12 ist damit erfuellt: der Wert ist FRISCH gemessen, nicht '
      + 'aus Eintrag 28 abgeschrieben.',
  };
  vn[AUFRUFER_REL] = {
    vorher: null,
    nachher: eintrag.eingabenHashes.skripte[AUFRUFER_REL].dateiSha256,
    durch: 'Neu angelegt als Option A (PR #246). Es gibt kein Vorher: die Datei existierte zum '
      + 'Zeitpunkt von Eintrag 28 nicht.',
  };
  vn.hinweis = 'F6-C24b: alle Code-Aenderungen an Laeufer, Zaehlwerk und Serverzeit-Werkzeug '
    + 'liegen VOR diesem Eintrag; er bindet ihre neuen SHA neu. LRA-12: JEDER Wert dieser Karte '
    + 'ist im Moment des Akts gegen einen sauberen Baum gemessen; kein Wert ist aus Eintrag 28 '
    + 'uebernommen worden.';

  // ── F6-K11/K12 + LR-21 ─────────────────────────────────────────────────
  eintrag.supersedierungVon28 = {
    ueberholterEintrag: { datei: RUMPF.datei, runId: RUMPF.runId, eventHash: RUMPF.eventHash },
    adressierungshinweis: 'LR-21: das ueberholte Ziel wird nach DATEI und eventHash adressiert. '
      + 'Seit dem R14a-Rollover ist eine Ordnungszahl KEINE eindeutige Adresse mehr. Wo dieser '
      + 'Akt Ordnungszahlen nennt, sind sie Lesehilfe und nie Adresse.',
    ehrlichkeitspflicht: 'DIESER AKT IST KEINE WIEDERHOLUNG DES 27->28-MUSTERS. Der ERSTE '
      + 'tragende Grund jenes Musters lautete: "UNTER EINTRAG 27 IST KEIN LAUF GEFEUERT." Dieser '
      + 'Grund steht hier NICHT ZUR VERFUEGUNG. Unter Eintrag 28 IST GEFEUERT WORDEN: das '
      + 'Prueffenster-Panel wurde gelesen. Wer diesen Akt als eingespieltes Muster liest, liest '
      + 'ihn falsch (F6-K12).',
    eigeneBegruendung: 'Der ueberschreibende Grund ist ein anderer und schwaecherer: die unter '
      + 'Eintrag 28 gebundenen Skripte sind durch die F6-K13-Reparatur nicht mehr die '
      + 'gebundenen. Ein Akt, der andere Bytes autorisiert als die, die laufen werden, '
      + 'autorisiert nichts. Deshalb - und nur deshalb - wird Eintrag 28 ueberschrieben.',
    wasEintrag28Bleibt: 'Eintrag 28 bleibt gueltige Akte ueber den Lauf, der unter ihm gefeuert '
      + 'hat. Er wird nicht editiert und nicht entwertet; er wird ersetzt, soweit er kuenftiges '
      + 'Handeln autorisiert.',
    vorfall: {
      datei: VORFALL.datei,
      runId: VORFALL.runId,
      eventHash: VORFALL.eventHash,
      inhalt: 'Der Vorfall-Vermerk nach F6-K6..K9 traegt die neun Pflichtinhalte, darunter den '
        + 'ungekuerzten Abbruchtext und das Siegel.',
      ankerkontext: 'Die Anker jenes Vermerks loesen gegen den Laeufer-SHA '
        + `${LAEUFER_VORHER} auf - den Stand VOR der F6-K13-Reparatur. Wer die dort genannten `
        + 'Zeilennummern nachschlaegt, muss diesen Stand lesen, nicht den hier gebundenen.',
    },
    kontingent: 'Das Gericht hat entschieden: Kontingent EINS ist durch die Beruehrung ohne '
      + 'Beobachtung NICHT VERBRAUCHT - als Entscheidung einer Regelluecke, in der schwaechsten '
      + 'die Mehrheit stuetzenden Fassung, aufschiebend bedingt auf das vollzogene Siegel und '
      + 'aufloesend bedingt auf F6-K21. Der zweite Anlauf ist nach F6-K19 DER LETZTE: ein '
      + 'weiterer Abbruch welcher Art auch immer beendet die Studienfamilie.',
    siegel: {
      objekt: e30.g_siegel.objekt,
      sha256: e30.g_siegel.sha256,
      groesseBytes: e30.g_siegel.groesseBytes,
      status: 'NIE GEOEFFNET. Der Zwischenstand des abgebrochenen Laufs bleibt versiegelt; kein '
        + 'Byte dieses Akts stammt aus ihm.',
    },
  };

  // ── Dokumentationspflicht 4: WEGGEFALLENES, mechanisch geprueft ─────────
  const sollFelder = [
    ...Object.keys(e28).filter((k) => !AUSGENOMMEN.has(k)),
    ...E29_SCHICHT,
  ];
  const verloren = sollFelder.filter((k) => !(k in eintrag));
  eintrag.weggefallenes = {
    auflage: 'Dokumentationspflicht 4 des KONTINGENT-Urteils: die zwei gemessenen Verluste aus '
      + 'Eintrag 28 UND das Ergebnis der Weggefallenes-Pruefung, mit TREFFERN UND NICHT-TREFFERN. '
      + 'Lehre aus Eintrag 29: "wer nur Hinzugefuegtes prueft, bezeugt nichts ueber Weggefallenes."',
    verlusteInEintrag28: [
      {
        was: 'Der Verbrauchssatz',
        inEintrag27: 'ledger:1050 - "... Nach diesem Lauf ist das Kontingent verbraucht; eine '
          + 'weitere Prueffenster-Beruehrung braucht einen eigenen, neuen Akt."',
        inEintrag28: 'ledger:1797 fuehrt nur noch "Der EINE konfirmatorische F6-Lauf unter '
          + 'Kontingent EINS (K2/A10)." - der Satz FEHLT.',
      },
      {
        was: 'Das Zweitlauf-Verbot',
        inEintrag27: 'ledger:966, Feld verboten - "Jeder zweite Lauf unter dieser runId; ..."',
        inEintrag28: 'FEHLT im verboten-Feld.',
      },
    ],
    rechtsfolge: 'BEIDES ERZEUGT KEINE ERLAUBNIS. "und nur er" in der begruendung und "EIN '
      + 'Fenster, EIN Tor" im scope binden unveraendert weiter; K2, A10 und die Verfassung binden '
      + 'unabhaengig von der Glosse eines Eintrags. Die Messung wird hier beurkundet, nicht bewertet.',
    eigenePruefung: {
      verfahren: 'Mechanisch: jedes Feld von Eintrag 28 (ohne Umschlag-/Kettenfelder) und jedes '
        + 'Feld der Eintrag-29-Schicht wird gegen die Feldmenge dieses Akts gehalten. Kein Auge, '
        + 'ein Vergleich.',
      gepruefteFelder: sollFelder.length,
      treffer: verloren,
      nichtTreffer: `${sollFelder.length - verloren.length} von ${sollFelder.length} Feldern `
        + 'nachweislich getragen.',
    },
  };
  pruefeWeggefallenes(sollFelder, eintrag);

  // ── Dokumentationspflicht 3: OB-1 und OB-2 ─────────────────────────────
  eintrag.punkteOhneBeschluss = {
    kuerzelWarnung: 'ACHTUNG, der Korpus belegt dieselben Buchstaben mehrfach: die hier '
      + 'gefuehrten OB-1/OB-2 sind die des KONTINGENT-Urteils. Sie sind NICHT das "OB-1, KZ-22" '
      + 'aus bein3Berichtigung.formfrageOffen (ANHANG-3-Serie) und nicht das OB-1 des '
      + 'LEDGER-ROLLOVER-Urteils (Belegung von genesisSha256, durch dessen Nachtrag entschieden).',
    'OB-1': {
      frage: 'Loesen die zwei in weggefallenes.verlusteInEintrag28 gemessenen Verluste den '
        + 'FUENFTEN KZ-25-Fall aus?',
      stand: 'OHNE BESCHLUSS. Stimme W hat die Verluste gemessen und die Zaehlfrage ausdruecklich '
        + 'dem Gericht verwiesen; die Stimmen K und V schweigen. Die Rechtsfolge von KZ-25 waere '
        + 'nicht Berichtigung, sondern den betroffenen Akt zurueckzuziehen und den Bauweg selbst '
        + 'zu pruefen - dafuer traegt EINE Stimme nicht.',
      folge: 'Die Eskalationstreppe bleibt bei VIER, bis eine vollere Instanz entscheidet. '
        + 'Substanziell haengt daran nichts (s. weggefallenes.rechtsfolge). Kipp-bewehrt durch KK-4.',
    },
    'OB-2': {
      frage: 'Welche Ordnungszahl traegt der von keinem eingefrorenen Text benannte Terminalzustand?',
      stand: 'OHNE BESCHLUSS. Substanz 3:0 identisch; die Zaehlbasen unterscheiden sich (W und V '
        + 'zaehlen ihn als VIERTEN auf Basis der drei Verdikte, K als FUENFTEN auf Basis der vier '
        + 'b4-Zweige).',
      folge: 'Dieser Akt fuehrt ihn OHNE Ordnungszahl als "von keinem eingefrorenen Text '
        + 'benannter Terminalzustand" und weist beide Zaehlbasen aus. Keine der beiden Zahlen '
        + 'wird als beschlossen gefuehrt.',
    },
  };

  // ── F6-K15: Klassenjagd, benannter Abschnitt ───────────────────────────
  eintrag.klassenjagd = {
    auflage: 'F6-K15: jede Abbruchstelle downstream der Paneloeffnung wird entweder VOR den '
      + 'Panelzugriff gezogen oder per Fixture als unerreichbar nachgewiesen - Ergebnis mit '
      + 'TREFFERN UND NICHT-TREFFERN.',
    zaehlgrenze: 'Die erste Paneloeffnung ist der erste zaehlung()-Aufruf; das Panel wird erst '
      + 'darin geoeffnet.',
    treffer: [
      'DIE R12a-PFAD-RIEGEL. Sie haengen ausschliesslich an Pfaden, und alle Pfade sind bekannt, '
        + 'bevor ein Panel-Byte gelesen wird - sie liefen aber nur am Schreib-Rand, also NACH der '
        + 'Messung. Sie laufen jetzt zusaetzlich als Phase-2a-Vorpruefung vor der Zaehlschleife; '
        + 'der Riegel am Schreib-Rand bleibt stehen. Belegt durch die Bruchprobe, die nun bei '
        + '"vorpruefung" stirbt statt am Schreib-Rand. Das ist die Klasse, an der der eine Lauf '
        + 'gestorben ist.',
    ],
    nichtTreffer: [
      'Zaehlwerk-Rueckgabe (Form, Pflichtfelder, Ganzzahligkeit, zerlegung).',
      'A16-Zerlegung (Vollstaendigkeit, Summenkreuz, ungelistete Schluessel).',
      'Klumpen-Tally (Listen- und Paarform).',
      'SE-Subprozess (fehlende Ausgabe, Schluesselmenge, eingefrorene Flaeche, N-/Anteils-Bereich).',
      'Band-Zweig (unbekanntes Verdikt).',
      'Ausgabesatz (verbotene Schluessel, Varianten- und Arm-Mengen zweiseitig, Umschlag).',
      'Arm-Anteil und Tor-Verdikt (Wertebereich, unbekanntes Verdikt).',
    ],
    nichtTrefferBegruendung: 'Alle sieben haengen an GEMESSENEN Werten. Sie lassen sich nicht '
      + 'vorziehen, ohne die Messung vorzuziehen; sie zu verschieben waere kein Schutz, sondern '
      + 'eine Attrappe.',
    bereitsVorDemPanel: 'Freigabe, Rehash aller Bindungen, Panel-Rand-Ableitung, '
      + 'Arbeitspfad-Ruestung und Fenster-Setzung, Panel-Existenz und der Panel-Byte-Pin '
      + '(os.fstat gegen 4447633408 B) - alle bereits vor der Oeffnung. Auch das Band-Modul wird '
      + 'vor der Zaehlschleife geladen.',
    bilanz: '1 Treffer, 7 unverschiebbare Klassen, 5 bereits saubere Stellen.',
  };

  eintrag.laufFreigabe = 'DER LAUF FEUERT NICHT MIT DIESEM EINTRAG. Er startet erst nach dem '
    + 'gruenen Delta-Review nach F6-K17/K18 und auf das ausdrueckliche Signal des Orchestrators. '
    + 'Nach F6-K19 ist dieser Anlauf DER LETZTE: ein weiterer Abbruch welcher Art auch immer '
    + 'beendet die Studienfamilie. Nach diesem Eintrag ist F6-C24(3) unveraendert scharf: jede '
    + 'Aenderung an Laeufer, Zaehlwerk, Zaehlprobe oder Aufrufer nach diesem Eintrag bricht die '
    + 'Bindung.';
  eintrag.blindAttest = 'BLIND-ATTEST (F6-K5): der Ausfuehrende haelt KEINERLEI Information aus '
    + 'dem abgebrochenen Lauf. Der versiegelte Zwischenstand ist ungeoeffnet geblieben (F6-K1).';
  eintrag.fortsetzungsHinweis = 'ZWEITER Eintrag der Fortsetzungsdatei; ihr erster ist der '
    + 'count-only-Akt (F6-K17 Schritt 2). Die erste Registerdatei ist mit ihrem Abschluss-Akt '
    + 'geschlossen; die Kette laeuft ueber genesisSha256 = Tail-Event-Hash jener Datei '
    + 'ungebrochen weiter.';

  return { eintrag, drift };
}

function haupt(argv) {
  if (argv.includes('--force')) {
    throw new VerfassungsBruch('F6-K11: --force gibt es nicht (F6-B8).');
  }
  const schreiben = argv.includes('--schreiben');
  const registerPfad = argument(argv, 'register') || absolut(ZIEL_REL);
  const quellPfad = argument(argv, 'quellregister');

  const registeredAt = argument(argv, 'anmeldezeit') || new Date().toISOString();
  if (new Date(registeredAt).getTime() > Date.now() + 60000) {
    throw new VerfassungsBruch('F6-K11: die Anmeldezeit liegt in der Zukunft.');
  }
  const zugriffAb = argument(argv, 'zugriff-ab')
    || new Date(new Date(registeredAt).getTime() + VORLAUF_MINUTEN * 60000).toISOString();
  if (!(new Date(registeredAt) < new Date(zugriffAb))) {
    throw new VerfassungsBruch('F6-K11: zugriff-ab muss NACH der Anmeldung liegen (VB-A11).');
  }

  const rohBytes = fs.readFileSync(registerPfad);
  const register = JSON.parse(rohBytes.toString('utf8'));
  if (istGeschlossen(register)) {
    throw new VerfassungsBruch(
      `F6-K11: ${registerPfad} ist mit ihrem Abschluss-Akt geschlossen - dieser Akt gehoert in `
      + 'die Fortsetzung.');
  }
  const events = register.events || [];
  if (events.length !== ERWARTETE_EVENTS) {
    throw new VerfassungsBruch(
      `F6-K11: die Fortsetzung fuehrt ${events.length} Eintraege, erwartet ${ERWARTETE_EVENTS}. `
      + 'Dieser Akt ist ihr ZWEITER.');
  }
  if (events.some((e) => e.runId === RUN_ID)) {
    throw new VerfassungsBruch(`F6-K11: die runId ${RUN_ID} ist bereits belegt.`);
  }

  const quellRegister = quellPfad
    ? JSON.parse(fs.readFileSync(quellPfad, 'utf8'))
    : JSON.parse(fs.readFileSync(absolut(GESCHLOSSEN_REL), 'utf8'));
  const e28 = quellAkt(RUMPF, quellRegister);
  const e29 = quellAkt(SCHICHT, quellRegister);
  const e30 = quellAkt(VORFALL, quellRegister);

  const { eintrag, drift } = baueEintrag(registeredAt, zugriffAb, e28, e29, e30);
  pruefeR12a(eintrag);
  const neu = haengeEintragAn(register, eintrag);
  pruefeZugriffsRegister(neu);
  const fertig = neu.events[neu.events.length - 1];
  const serialisiert = `${JSON.stringify(neu, null, 1)}\n`;
  const bytesNachher = Buffer.byteLength(serialisiert, 'utf8');

  process.stdout.write(
    'Akt            DER UEBERSCHREIBENDE KONFIRMATORISCHE AKT (F6-K11 / F6-K17 Schritt 6)\n'
    + `runId          ${RUN_ID}\n`
    + `typ            ${ART_ZUGRIFF}\n`
    + `Ziel           ${ZIEL_REL} (Eintrag ${events.length + 1})\n`
    + `Rumpf          ${RUMPF.runId} / ${RUMPF.eventHash.slice(0, 16)}...\n`
    + `Schicht        ${SCHICHT.runId} / ${SCHICHT.eventHash.slice(0, 16)}...\n`
    + `Vorfall        ${VORFALL.runId} / ${VORFALL.eventHash.slice(0, 16)}...\n`
    + `registeredAt   ${registeredAt}\n`
    + `accessedAt     ${zugriffAb}  (+${VORLAUF_MINUTEN} min, Fussboden fuer den Lauf)\n`
    + `Felder         ${Object.keys(fertig).length}\n`
    + `SHA-Drift      ${drift.length} gegen die Bindung von Eintrag 28\n`
    + `${drift.map((d) => `   - ${d.rel}\n     vorher  ${d.vorher}\n     nachher ${d.nachher}`).join('\n')}\n`
    + `Neu gebunden   ${AUFRUFER_REL}\n`
    + `Weggefallenes  ${eintrag.weggefallenes.eigenePruefung.gepruefteFelder} Felder geprueft, `
    + `${eintrag.weggefallenes.eigenePruefung.treffer.length} Treffer\n`
    + `PRUEFZEILE: "previousHash": "${fertig.previousHash}"\n`
    + `eventHash dieses Akts: ${fertig.eventHash}\n`
    + `Akt-Groesse    ${Buffer.byteLength(JSON.stringify(fertig), 'utf8')} B kompakt\n`
    + `Fortsetzung vorher: ${rohBytes.length} B, ${events.length} Ereignisse\n`
    + `Fortsetzung danach: ${bytesNachher} B von ${DECKEL_BYTES} (R14a), `
    + `Zuwachs ${bytesNachher - rohBytes.length} B, Restluft ${DECKEL_BYTES - bytesNachher} B\n\n`);

  pruefeDeckel(bytesNachher);

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
  RUN_ID, RUMPF, SCHICHT, VORFALL, ZIEL_REL, DECKEL_BYTES, ERWARTETE_EVENTS,
  VORLAUF_MINUTEN, baueEintrag, quellAkt, pruefeDeckel, pruefeWeggefallenes, haupt, WURZEL,
};
