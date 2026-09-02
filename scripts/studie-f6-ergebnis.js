#!/usr/bin/env node
'use strict';

// Studie 2.0, F6-K17 Schritt 9 — DIE ERGEBNIS-REGISTRIERUNG.
//
// Der konfirmatorische Lauf ist unter dem Akt f6-konfirmatorisch-v4-2026-09-02
// gefeuert und mit Exit 0 zu Ende gelaufen. Dieser Eintrag beurkundet SEIN
// ERGEBNIS. Er autorisiert NICHTS.
//
// EIGENE ART, und das ist tragend: `confirmatory_result_recorded`. Ein
// Ergebnis-Eintrag darf NIEMALS `confirmatory_execution_authorized` tragen -
// sonst greift `letzterKonfirmatorischer` in der LIVE-BINDUNG auf IHN statt auf
// den v4-Akt zu, und die Bindungspruefung des Baums zeigte auf einen Eintrag,
// der gar keine Bindung fuehrt. Die Waechter der Familie sind kettenschwanz-
// robust (jeder kuerzt auf sein eigenes ERWARTETE_EVENTS), aber gegen eine
// falsche ART ist keiner robust.
//
// Eigenes Einzweck-Werkzeug nach F6-B8; die geprueften Helfer kommen aus dem
// v3-Werkzeug, statt sie ein zweites Mal zu tippen (LR-14).
//
//   node scripts/studie-f6-ergebnis.js                 # Trockenlauf
//   node scripts/studie-f6-ergebnis.js --zeige-eintrag # + Eintrag als JSON
//   node scripts/studie-f6-ergebnis.js --schreiben     # anhaengen

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { writeFileAtomic } = require('../lib/atomic-write.js');
const {
  VerfassungsBruch, haengeEintragAn, pruefeZugriffsRegister,
  AKTIVES_REGISTER_REL, istGeschlossen, ART_C0_REGELFREEZE,
} = require('../lib/studie-verfassung.js');
const { pruefeR12a } = require('./studie-f6-vorfall.js');
const V3 = require('./studie-f6-konfirmatorisch-v3.js');
const V4 = require('./studie-f6-konfirmatorisch-v4.js');

const WURZEL = path.join(__dirname, '..');
const absolut = (rel) => path.join(WURZEL, ...rel.split('/'));
const ZIEL_REL = AKTIVES_REGISTER_REL;

const RUN_ID = 'f6-ergebnis-v4-2026-09-02';
// KEINE NEUE ART. Der Rollover-Rat hat den Grundsatz fuer den Parallelfall
// entschieden: eine neue Eintragsart waere eine Aenderung an der Artenmenge der
// Verfassung - ein Verfassungsakt, den Speichermechanik nicht kaufen darf.
// C0_REGELFREEZE ist die Hausart fuer ZUGRIFFSLOSE BEURKUNDUNGEN; die
// Praezedenzlinie ist drei Akte tief (SE-Freeze, Ergaenzungs-Vermerk,
// VORFALL-Vermerk - letzterer ein Vorfallsbericht, kein Regelfreeze).
const ART_ERGEBNIS = ART_C0_REGELFREEZE;

// DIE HAUSFORM DES VERMERKS IST +2h, NICHT +20 min. Der Fussboden von 20 min
// gilt fuer einen Akt, der einen LAUF autorisiert - dort ist accessedAt ein
// echter Startblock. Ein C0-Vermerk autorisiert keinen Zugriff; sein accessedAt
// bezeichnet nur, ab wann der beurkundete Stand gilt. Alle drei Praezedenzakte
// tragen 120 min, am Objekt nachgemessen. Eintrag 29 haelt ausserdem fest, dass
// ein FRUEHERER Entwurf mit engem Fenster ablief, bevor der Serverbeweis
// gefuehrt werden konnte, und verworfen werden musste.
const VORLAUF_MINUTEN = 120;
const DECKEL_BYTES = V3.DECKEL_BYTES;
const ERWARTETE_EVENTS = 3;

const FORTSETZUNG_VORHER = fs.statSync(absolut(ZIEL_REL)).size;

// Der autorisierende Akt, nach DATEI + eventHash adressiert (LR-21).
const AKT = {
  datei: ZIEL_REL,
  runId: V4.RUN_ID,
  eventHash: '3375d736ffa742a65e045565b4a12a336472feab48e4a95a63caccccf9b3c18c',
};

const BERICHT_REL = 'reports/studie/f6-konfirmatorisch-v4-2026-09-02.json';

const argument = (argv, n) => {
  const i = argv.indexOf(`--${n}`);
  if (i < 0) return null;
  const v = argv[i + 1];
  if (!v || v.startsWith('--')) throw new VerfassungsBruch(`F6-K11: --${n} ohne Wert.`);
  return v;
};

// Der Bericht wird ueber den COMMITTETEN BLOB gebunden, nicht ueber die
// Arbeitskopie. `.gitattributes` pinnt /reports/studie/** auf eol=lf; der
// Laeufer schreibt unter Windows CRLF, und git normalisiert beim Commit. Die
// Arbeitskopie ist damit eine fluechtige Groesse, die auf keiner anderen
// Maschine wieder entsteht - sie zu binden hiesse, eine Zeilenende-Konvention
// zu beurkunden. Gemessen wird, was auf origin liegt.
function berichtBlob() {
  const roh = execFileSync('git', ['show', `HEAD:${BERICHT_REL}`],
    { cwd: WURZEL, maxBuffer: 64 * 1024 * 1024 });
  return { sha256: crypto.createHash('sha256').update(roh).digest('hex'), bytes: roh.length };
}

function baueEintrag(registeredAt, zugriffAb, bericht, blob, wand) {
  const zelle = (v, arm) => {
    const z = bericht.daten[v][arm];
    return {
      zweig: z.zweig,
      verdikt: z.werte.verdikt,
      weiter: z.werte.weiter,
      messgeraetVollstaendig: z.werte.messgeraet_vollstaendig,
    };
  };
  const variante = (v) => ({
    signal: zelle(v, 'signal'),
    kontrollpool: zelle(v, 'kontrollpool'),
    tor: {
      verdikt: bericht.daten[v].differenz_punkte.tor.verdikt,
      weiter: bericht.daten[v].differenz_punkte.tor.weiter,
    },
    differenzbedingungErfuellt: bericht.daten[v].differenz_punkte.erfuellt,
  });

  const sg = bericht.daten['S-G'].signal.werte;
  const su = bericht.daten['S-U'].signal.werte;

  const eintrag = {
    runId: RUN_ID,
    typ: ART_ERGEBNIS,
    registeredAt,
    accessedAt: zugriffAb,
    fenster: ['kein Studienfenster - Ergebnis-Beurkundung ohne Datenzugriff'],
    allowedOutputs: [],
    erlaubt: 'Nichts. Kein Datenzugriff.',
    verboten: 'Jeder weitere konfirmatorische Akt dieser Studienfamilie - das '
      + 'Kontingent nach F6-K19 ist mit dem hier beurkundeten Lauf VOLLZOGEN. '
      + 'Jede Berufung auf diesen Eintrag als Autorisierung eines Laufs. Jede '
      + 'Aenderung an den bisherigen Eintraegen dieser Kette.',

    beurkundet: 'DAS ERGEBNIS des konfirmatorischen F6-Laufs. Dieser Eintrag '
      + 'AUTORISIERT NICHTS - er stellt fest, was gemessen wurde.',
    typDeutung: 'ZUR ART, offen statt stillschweigend: dieser Eintrag traegt '
      + 'C0_REGELFREEZE, obwohl er kein Regelfreeze im woertlichen Sinn ist. '
      + 'Das ist KEINE Umetikettierung, sondern die Hausform fuer ZUGRIFFSLOSE '
      + 'BEURKUNDUNGEN, und die Praezedenzlinie ist drei Akte tief: der '
      + 'SE-Freeze (Eintrag 24), der Ergaenzungs-Vermerk (29) und der '
      + 'VORFALL-Vermerk (30) - letzterer ein Vorfallsbericht, ebenfalls kein '
      + 'Regelfreeze, in der vom Kontingent-Rat selbst angeordneten Form. Der '
      + 'Rollover-Rat hat den Grundsatz entschieden: eine NEUE Eintragsart '
      + 'waere eine Aenderung an der Artenmenge der Verfassung - ein '
      + 'Verfassungsakt, den Speichermechanik nicht kaufen darf. WAS DIESER '
      + 'AKT EINFRIERT, ist der ENDZUSTAND DER FAMILIE als Aktenlage. Er '
      + 'AUTORISIERT NICHTS. Und er traegt bewusst NICHT '
      + 'confirmatory_execution_authorized: sonst griffe die LIVE-BINDUNG des '
      + 'Baums auf IHN statt auf den autorisierenden Akt und pruefte gegen '
      + 'einen Eintrag, der gar keine Bindungen fuehrt.',
    fensterVermerk: 'ZUM ZEITFENSTER DIESES VERMERKS, damit kein spaeterer '
      + 'Leser ueber die Form raetselt: accessedAt ist hier ein gewoehnliches '
      + '+2h-Fenster ab der Anmeldung - die Hausform der Vermerke, an allen '
      + 'drei Praezedenzakten nachgemessen. Ein C0_REGELFREEZE-Vermerk '
      + 'autorisiert keinen Zugriff, und sein accessedAt ist deshalb NIE ein '
      + 'Tor fuer einen Lauf; es bezeichnet nur, ab wann der beurkundete Stand '
      + 'gilt. Der 20-Minuten-Fussboden gehoert dem Akt, der einen LAUF '
      + 'autorisiert - dort ist derselbe Wert ein echter Startblock. Eintrag '
      + '29 haelt fest, dass ein frueherer Entwurf mit eng gesetztem Fenster '
      + 'ablief, bevor der Serverbeweis gefuehrt werden konnte; diese Lehre '
      + 'ist hier angewandt.',

    autorisierenderAkt: AKT,
    lauf: {
      exitCode: 0,
      ersterZugriffAm: bericht.umschlag.ersterZugriffAm,
      beendetAm: bericht.umschlag.beendetAm,
      fenster: bericht.umschlag.fenster,
      panelRand: bericht.umschlag.panelRand,
      geschriebenePfade: bericht.umschlag.geschriebenePfade,
      gelesenePfadeAnzahl: bericht.umschlag.gelesenePfade.length,
      siegelWache: bericht.umschlag.siegelWache,
    },

    // ── DAS ERGEBNIS ────────────────────────────────────────────────────
    ergebnis: {
      gesamt: 'BEIDE VARIANTEN WEITER = 0. Das Tor ist in keiner Variante '
        + 'gehalten worden.',
      'S-U': variante('S-U'),
      'S-G': variante('S-G'),
      alleZellenGemessen: 'ALLE VIER ZELLEN sind NORMAL gemessen - '
        + 'messgeraetVollstaendig ueberall true, KEINE gate_gerissen-Zelle. Der '
        + 'Q1-Fang war gebaut und blieb ungenutzt; fuer ihn ist das der beste '
        + 'der moeglichen Ausgaenge. Die Ersatz-Zelle nach OB-1 ist NICHT '
        + 'eingetreten und hat folglich kein Verdikt erzeugt.',
    },

    // ── S-G: DIE ZWEI PFLICHTSAETZE, WOERTLICH ──────────────────────────
    sgPflichtsaetze: {
      auflage: 'Die Bandregel schreibt fuer den Zweig im_band ZWEI Saetze vor, '
        + 'und sie werden WOERTLICH gefuehrt - nicht paraphrasiert. Der '
        + 'zweite ist die nie-Effekt-abwesend-Regel; ihn umzuformulieren waere '
        + 'genau die Fehldeutung, gegen die er gebaut ist.',
      betrifft: 'S-G / signal (im_band, NICHT UNTERSCHEIDBAR)',
      pflichtsatz: sg.pflichtsatz,
      zweitsatz: sg.zweitsatz,
      lesehilfe: 'NICHT UNTERSCHEIDBAR ist KEIN Negativbefund. Die Fallzahl hat '
        + 'nicht getrennt; ueber die Hypothese ist damit nichts gesagt. Wer '
        + 'diesen Ausgang als "kein Effekt" liest, liest ihn falsch.',
    },

    // ── S-U: DIE FRIEDHOFS-PFLICHT ──────────────────────────────────────
    musterFriedhof: {
      auflage: 'Ein sauberes Negativergebnis wird EINGETRAGEN, nicht '
        + 'weggelegt. Der Friedhof ist der Ort, an dem Negatives seinen Wert '
        + 'behaelt.',
      betrifft: 'S-U, beide Arme',
      torVerdikt: bericht.daten['S-U'].differenz_punkte.tor.verdikt,
      etikettDesBandmoduls: su.etikett,
      etikettHerkunft: 'WOERTLICH aus scripts/studie-vb-b4-band.py uebernommen '
        + '- das eingefrorene Modul etikettiert seinen eigenen Ausgang. Der '
        + 'Laeufer und dieser Eintrag erfinden dafuer keinen Text.',
      beideArme: 'Beide Arme tragen ausserhalb_band / NICHT BESTANDEN. Das ist '
        + 'ein GEMESSENES Negativ mit vollstaendigem Messgeraet - nicht ein '
        + 'Nicht-Unterscheiden-Koennen. Der Unterschied zu S-G ist der ganze '
        + 'Punkt und wird hier festgehalten, damit ihn niemand einebnet.',
    },

    // ── A16 / PIN 3: der konstruktive SE ────────────────────────────────
    a16Pin3: {
      befund: 'In ALLEN VIER Zellen gilt klumpen_anzahl == nenner_tor, also '
        + 'n_g = 1 fuer jeden Klumpen - die nach PIN 3 ERWARTETE Lage.',
      folge: 'Damit faellt se_entschied KONSTRUKTIV auf SE_klumpen-robust, und '
        + 'die A16-Pflichtangabe "welcher SE entschied" ist FORMAL, nicht '
        + 'materiell erfuellt. Das ist kein Mangel: die Feststellung stand '
        + 'VORAB im Bericht (F6-B25-Form), nicht nachtraeglich als Befund.',
      wennEsAndersKaeme: 'Traete im Tor-Nenner je ein Klumpen mit n_g > 1 auf, '
        + 'entfiele diese Feststellung (KV-6) und die Pflichtangabe wuerde '
        + 'materiell. Das ist hier NICHT eingetreten.',
      identitaetA16: bericht.stempel.identitaetA16,
    },

    // ── LFA2-artiger Befund: veraltete Etiketten, protokolliert ─────────
    dokumentationsbefund: {
      auflage: 'PROTOKOLLIERT, NIE STILL GEFIXT - dieselbe Behandlung wie die '
        + 'Doku-Drift LFA2-12.',
      befund: 'Drei Eintraege in umschlag.gebundeneHashes des Berichts tragen '
        + 'VORLAEUFIGE Etiketten aus der Zeit vor dem v4-Akt: '
        + '"zu binden in Eintrag 25 (F6-B7)" fuer scripts/studie-f6-lauf.py, '
        + '"zu binden im konfirmatorischen Eintrag (F6-B7)" fuer '
        + 'scripts/studie-f6-zaehlwerk.py und "zu binden im konfirmatorischen '
        + 'Eintrag (F6-C24)" fuer scripts/studie-zaehlprobe.py.',
      wasFALSCH_ist: 'AUSSCHLIESSLICH die Etiketten. Die BINDUNGEN selbst sind '
        + 'richtig und im v4-Akt gefuehrt; die SHA im Bericht stimmen mit den '
        + 'gebundenen ueberein. Es ist ein Beschriftungs-, kein Bindungsfehler.',
      warumNichtGEFIXT: 'Der Laeufer ist AKT-GEBUNDEN: sein SHA steht im '
        + 'v4-Akt. Eine Etiketten-Korrektur waere ein Byte am gebundenen '
        + 'Laeufer und braeche F6-C24(3) - fuer eine Beschriftung. Der Befund '
        + 'gehoert damit in die NAECHSTE Familie, nicht in diesen Zug.',
    },

    // ── Der Bericht, ueber den kanonischen Blob gebunden ─────────────────
    bericht: {
      pfad: BERICHT_REL,
      dateiSha256: blob.sha256,
      groesseBytes: blob.bytes,
      messebene: 'COMMITTETER BLOB (LF), nicht die Arbeitskopie. '
        + '.gitattributes pinnt /reports/studie/** auf eol=lf; der Laeufer '
        + 'schreibt unter Windows CRLF, und git normalisiert beim Commit. Die '
        + 'Arbeitskopie mass 20984 B / cbb00408..., der kanonische Blob misst '
        + `${blob.bytes} B / ${blob.sha256.slice(0, 16)}... - eine Differenz `
        + 'von 461 Zeilenenden. Gebunden wird, was auf origin liegt und auf '
        + 'jeder anderen Maschine wieder entsteht.',
      korrektur: 'Die Commit-Nachricht des Bericht-PR fuehrt den CRLF-Wert. Sie '
        + 'ist unveraenderlich; berichtigt wird auf der richtigen Schicht - '
        + 'hier. Dasselbe Muster wie die C24A-Korrektur im v4-Akt. Es ist die '
        + 'ZWEITE Windows-Kodierungsfalle dieser Familie nach der '
        + 'PowerShell-UTF-16-Umleitung.',
    },

    // ── LR-19 ───────────────────────────────────────────────────────────
    wandLR19: {
      deckelBytes: DECKEL_BYTES,
      vorherBytes: FORTSETZUNG_VORHER,
      nachherBytes: wand.danach,
      zuwachsBytes: wand.zuwachs,
      restluftBytes: wand.restluft,
      messform: 'FIXPUNKT-MESSUNG wie im v4-Akt: iterativ gebaut, bis die '
        + 'eingesetzten Zahlen mit den erzeugten zusammenfallen. Ohne '
        + 'Konvergenz wird nicht geschrieben.',
      einordnung: 'Der v4-Akt hat beurkundet, dass die Restluft fuer KEINEN '
        + 'weiteren vollen Ueberschreibungs-Akt mehr reicht - wohl aber fuer '
        + 'Ergebnis-Eintraege, die eine Groessenordnung kleiner sind. Dieser '
        + 'Eintrag ist der Beleg dafuer, dass diese Einordnung getragen hat.',
    },

    laufFreigabe: 'DIESER EINTRAG AUTORISIERT NICHTS. Er beurkundet ein '
      + 'Ergebnis. Das Kontingent nach F6-K19 ist mit dem Lauf, den er '
      + 'beurkundet, VERBRAUCHT; ein weiterer Lauf braucht einen neuen Akt und '
      + 'eine neue Gerichtsentscheidung.',
    endtestSiegel: 'Das Endtest-Siegel bleibt ZU und UNVERBRAUCHT - in diesem '
      + 'wie in jedem anderen Ausgang. Nur Karls ausdrueckliche Freigabe '
      + 'oeffnet es (F6-A16/K27). Dieser Eintrag beruehrt es nicht.',
    blindAttest: 'BLIND-ATTEST (F6-K5): der Ausfuehrende dieser Beurkundung '
      + 'haelt keinerlei Information aus dem ABGEBROCHENEN Lauf; der '
      + 'versiegelte zwischenstand.sqlite ist ungeoeffnet geblieben (F6-K1). '
      + 'Die hier beurkundeten Zahlen stammen ausschliesslich aus dem Bericht '
      + 'des autorisierten Laufs.',
    fortsetzungsHinweis: 'VIERTER Eintrag der Fortsetzungsdatei: '
      + 'count-only-Akt (1), v3 (2), v4 (3), dieses Ergebnis (4).',
  };
  return eintrag;
}

function haupt(argv) {
  if (argv.includes('--force')) {
    throw new VerfassungsBruch('F6-K11: --force gibt es nicht (F6-B8).');
  }
  const schreiben = argv.includes('--schreiben');
  const registerPfad = argument(argv, 'register') || absolut(ZIEL_REL);
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
    throw new VerfassungsBruch(`F6-K11: ${registerPfad} ist geschlossen.`);
  }
  const events = register.events || [];
  if (events.length !== ERWARTETE_EVENTS) {
    throw new VerfassungsBruch(
      `F6-K11: die Fortsetzung fuehrt ${events.length} Eintraege, erwartet `
      + `${ERWARTETE_EVENTS}. Dieser Eintrag ist ihr VIERTER.`);
  }
  if (events.some((e) => e.runId === RUN_ID)) {
    throw new VerfassungsBruch(`F6-K11: die runId ${RUN_ID} ist bereits belegt.`);
  }
  // Der autorisierende Akt muss da sein und der richtige - sonst beurkundet
  // dieser Eintrag ein Ergebnis zu einem Lauf, den niemand freigegeben hat.
  V3.quellAkt(AKT, register);

  const bericht = JSON.parse(fs.readFileSync(absolut(BERICHT_REL), 'utf8'));
  if (bericht.umschlag.runId !== V4.RUN_ID) {
    throw new VerfassungsBruch(
      `F6-K11: der Bericht traegt runId ${bericht.umschlag.runId}, erwartet ${V4.RUN_ID}.`);
  }
  const blob = berichtBlob();

  let wand = { danach: 0, zuwachs: 0, restluft: 0 };
  let eintrag; let neu; let serialisiert; let bytesNachher;
  for (let i = 0; i < 6; i += 1) {
    eintrag = baueEintrag(registeredAt, zugriffAb, bericht, blob, wand);
    neu = haengeEintragAn(register, eintrag);
    serialisiert = `${JSON.stringify(neu, null, 1)}\n`;
    bytesNachher = Buffer.byteLength(serialisiert, 'utf8');
    const gemessen = {
      danach: bytesNachher,
      zuwachs: bytesNachher - rohBytes.length,
      restluft: DECKEL_BYTES - bytesNachher,
    };
    if (gemessen.danach === wand.danach) break;
    wand = gemessen;
  }
  if (bytesNachher !== wand.danach) {
    throw new VerfassungsBruch('F6-K11: die LR-19-Zahlen konvergieren nicht.');
  }
  pruefeR12a(eintrag);
  pruefeZugriffsRegister(neu);
  const fertig = neu.events[neu.events.length - 1];

  if (bytesNachher >= DECKEL_BYTES) {
    throw new VerfassungsBruch(
      `F6-K11: die Fortsetzung waere ${bytesNachher} B und erreichte den `
      + `R14a-Deckel von ${DECKEL_BYTES} B. Es wird NICHT geschrieben (LR-20).`);
  }

  process.stdout.write(
    'Akt            DIE ERGEBNIS-REGISTRIERUNG (F6-K17 Schritt 9)\n'
    + `runId          ${RUN_ID}\n`
    + `typ            ${ART_ERGEBNIS}  (EIGENE Art, nie ART_ZUGRIFF)\n`
    + `Ziel           ${ZIEL_REL} (Eintrag ${events.length + 1})\n`
    + `Autorisiert von ${AKT.runId} / ${AKT.eventHash.slice(0, 16)}...\n`
    + `registeredAt   ${registeredAt}\n`
    + `Felder         ${Object.keys(fertig).length}\n`
    + `Bericht        ${blob.sha256}\n`
    + `               ${blob.bytes} B (committeter LF-Blob)\n`
    + `Ergebnis       S-U ${eintrag.ergebnis['S-U'].tor.verdikt} / weiter `
    + `${eintrag.ergebnis['S-U'].tor.weiter}   ·   S-G `
    + `${eintrag.ergebnis['S-G'].tor.verdikt} / weiter `
    + `${eintrag.ergebnis['S-G'].tor.weiter}\n`
    + `PRUEFZEILE: "previousHash": "${fertig.previousHash}"\n`
    + `eventHash dieses Eintrags: ${fertig.eventHash}\n`
    + '\n=== LR-19 WAND-ARITHMETIK, am fertigen Entwurf gemessen ===\n'
    + `Eintrag-Groesse     ${Buffer.byteLength(JSON.stringify(fertig), 'utf8')} B kompakt\n`
    + `Fortsetzung vorher  ${rohBytes.length} B, ${events.length} Ereignisse\n`
    + `Fortsetzung danach  ${bytesNachher} B von ${DECKEL_BYTES} B (R14a)\n`
    + `Zuwachs             ${wand.zuwachs} B\n`
    + `Restluft            ${wand.restluft} B\n\n`);

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
  RUN_ID, ART_ERGEBNIS, AKT, ZIEL_REL, DECKEL_BYTES, ERWARTETE_EVENTS, VORLAUF_MINUTEN,
  BERICHT_REL, berichtBlob, baueEintrag, haupt, WURZEL,
};
