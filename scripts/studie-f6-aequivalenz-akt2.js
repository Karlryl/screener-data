#!/usr/bin/env node
'use strict';

// Studie 2.0, F6-K17 Schritt 2 — DER ZWEITE ZAEHLPROBEN-AKT.
//
// Eintrag 25 autorisierte "GENAU EINE Zaehlung" auf dem Entdeckungs-Panel, und
// die ist verbraucht. Die Aequivalenz-Beine muessen trotzdem vollstaendig neu
// gefahren werden - sie sind Laufbedingung in JEDEM Lauf, und der Laeufer-SHA
// hat sich seit der F6-K13-Reparatur geaendert. F6-K16 verlangt dafuer einen
// EIGENEN neuen Akt. Das ist er.
//
// ER LIEGT IN DER FORTSETZUNG. Die erste Registerdatei ist mit ihrem
// Abschluss-Akt geschlossen; dieser Akt ist Eintrag 1 von
// outcome-access-ledger-teil2.json (F6-K17 Schritt 2 vor Schritt 6 - der
// ueberschreibende Akt folgt als Eintrag 2).
//
// DIE SOLLWERTE WERDEN NICHT ABGETIPPT, SONDERN KOPIERT. KZ-4 ist scharf: eine
// einzige abweichende Zahl reisst den Lauf, und es gibt keinen zweiten
// Kandidaten-Sollwert. Ein von Hand uebertragener Sollwert waere genau die
// Gelegenheit dafuer. Der Akt holt `aequivalenzSoll` deshalb aus dem
// Vorgaenger-Akt - adressiert ueber DATEI + eventHash (LR-21) - und rechnet
// dessen Hash vorher nach.
//
// Eigenes Einzweck-Werkzeug nach F6-B8 (Muster studie-f6-abschluss.js).
//
//   node scripts/studie-f6-aequivalenz-akt2.js                 # Trockenlauf
//   node scripts/studie-f6-aequivalenz-akt2.js --zeige-eintrag # + Eintrag als JSON
//   node scripts/studie-f6-aequivalenz-akt2.js --schreiben     # anhaengen

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { writeFileAtomic } = require('../lib/atomic-write.js');
const {
  VerfassungsBruch, haengeEintragAn, pruefeZugriffsRegister, ART_ZAEHLPROBE,
  REGISTER_RELS, AKTIVES_REGISTER_REL, istGeschlossen,
} = require('../lib/studie-verfassung.js');
const { pruefeR12a } = require('./studie-f6-vorfall.js');

const WURZEL = path.join(__dirname, '..');
const absolut = (rel) => path.join(WURZEL, ...rel.split('/'));
const GESCHLOSSEN_REL = REGISTER_RELS[0];
const ZIEL_REL = AKTIVES_REGISTER_REL;

const RUN_ID = 'f6-aequivalenz-entdeckung-v2-2026-09-02';
const VORLAUF_MINUTEN = 120;
const DECKEL_BYTES = 200 * 1024;

// Der Vorgaenger-Akt, adressiert nach DATEI + eventHash statt nach Ordnungszahl
// (LR-21): nach der Teilung ist "Eintrag 25" keine eindeutige Adresse mehr.
const QUELLE = {
  datei: GESCHLOSSEN_REL,
  runId: 'f6-aequivalenz-entdeckung-2026-09-01',
  eventHash: '847084648a7fa5d7d8535c7eec3285de44ac94c02cce1e94f204528f34358d41',
};

// Die Fortsetzung ist am Tag dieses Akts leer; ihr Kopf traegt den Genesis.
const ERWARTETE_EVENTS = 0;

// Die ausfuehrenden Skripte werden AM OBJEKT gemessen. Die Liste der Pfade
// stammt aus dem Vorgaenger-Akt - dieselbe Menge, neue Werte -, damit kein
// Werkzeug beim Abschreiben verlorengeht.
const dsha = (rel) => crypto.createHash('sha256').update(fs.readFileSync(absolut(rel))).digest('hex');

const argument = (argv, n) => {
  const i = argv.indexOf(`--${n}`);
  if (i < 0) return null;
  const v = argv[i + 1];
  if (!v || v.startsWith('--')) throw new VerfassungsBruch(`F6-AQ2: --${n} ohne Wert.`);
  return v;
};

function pruefeDeckel(bytesNachher) {
  if (bytesNachher >= DECKEL_BYTES) {
    throw new VerfassungsBruch(
      `F6-AQ2: die Fortsetzung waere nach diesem Akt ${bytesNachher} B und erreichte damit den `
      + `R14a-Deckel von ${DECKEL_BYTES} B. Es wird NICHT geschrieben (LR-20).`);
  }
}

// Holt den Vorgaenger-Akt und rechnet seinen Hash nach. Ohne diese Pruefung
// waere das Kopieren der Sollwerte ein Vertrauensakt statt einer Messung.
function quellAkt() {
  const register = JSON.parse(fs.readFileSync(absolut(QUELLE.datei), 'utf8'));
  const treffer = (register.events || []).filter((e) => e.runId === QUELLE.runId);
  if (treffer.length !== 1) {
    throw new VerfassungsBruch(
      `F6-AQ2: ${QUELLE.runId} steht ${treffer.length}-mal in ${QUELLE.datei}, erwartet genau einmal.`);
  }
  if (treffer[0].eventHash !== QUELLE.eventHash) {
    throw new VerfassungsBruch(
      `F6-AQ2: der Quell-Akt traegt eventHash ${treffer[0].eventHash}, erwartet ${QUELLE.eventHash}. `
      + 'Ein anderer Hash ist ein anderer Akt - die Sollwerte werden nicht kopiert.');
  }
  if (!treffer[0].aequivalenzSoll || !treffer[0].ausfuehrendeSkripte) {
    throw new VerfassungsBruch('F6-AQ2: der Quell-Akt fuehrt kein aequivalenzSoll/ausfuehrendeSkripte.');
  }
  return treffer[0];
}

function baueEintrag(registeredAt, zugriffAb, quelle) {
  // Dieselbe Pfadmenge wie der Vorgaenger, die Werte frisch am Objekt gemessen.
  const skripte = {};
  for (const rel of Object.keys(quelle.ausfuehrendeSkripte)) skripte[rel] = dsha(rel);
  const geaendert = Object.keys(skripte)
    .filter((rel) => skripte[rel] !== quelle.ausfuehrendeSkripte[rel]);

  return {
    runId: RUN_ID,
    typ: ART_ZAEHLPROBE,
    registeredAt,
    accessedAt: zugriffAb,
    fenster: quelle.fenster,
    allowedOutputs: quelle.allowedOutputs,
    erlaubt: quelle.erlaubt,
    verboten: quelle.verboten,

    begruendung: 'F6-K17 Schritt 2 / F6-K16: die Aequivalenz-Beine sind KEINE '
      + 'Prueffenster-Beruehrung und verbrauchen KEIN Kontingent (F6-A8) - sie muessen aber '
      + 'vollstaendig NEU gefahren werden, weil sie Laufbedingung in jedem Lauf sind und der '
      + 'Laeufer-SHA sich seit der F6-K13-Reparatur geaendert hat. Der Vorgaenger-Akt '
      + 'autorisierte "GENAU EINE Zaehlung"; die ist verbraucht. Deshalb dieser EIGENE Akt in '
      + 'der strengeren DZ-5-Fassung.',

    quellAkt: {
      hinweis: 'Erlaubnistext, Verbotstext, Fenster, allowedOutputs und die SOLLWERTE sind aus '
        + 'diesem Akt KOPIERT, nicht abgetippt. KZ-4 ist scharf: eine einzige abweichende Zahl '
        + 'reisst den Lauf, es gibt keinen zweiten Kandidaten-Sollwert und kein "nah genug". Ein '
        + 'von Hand uebertragener Sollwert waere genau die Gelegenheit dazu.',
      datei: QUELLE.datei,
      runId: QUELLE.runId,
      eventHash: QUELLE.eventHash,
      adressform: 'DATEI + eventHash, nie eine Ordnungszahl - nach der Teilung des Registers ist '
        + 'eine Ordnungszahl keine eindeutige Adresse mehr (LR-21).',
    },

    // WOERTLICH aus dem Quell-Akt, programmatisch kopiert.
    aequivalenzSoll: quelle.aequivalenzSoll,

    ausfuehrendeSkripte: skripte,
    skriptDrift: {
      form: 'VORHER/NACHHER je Pfad, am Objekt gemessen.',
      geaendertSeitDemQuellAkt: geaendert,
      vorher: Object.fromEntries(geaendert.map((rel) => [rel, quelle.ausfuehrendeSkripte[rel]])),
      nachher: Object.fromEntries(geaendert.map((rel) => [rel, skripte[rel]])),
      bedeutung: 'Genau diese Drift ist der Grund, warum der Vorgaenger-Akt den neuen Lauf nicht '
        + 'mehr deckt. Der ueberschreibende konfirmatorische Akt (F6-K11, Eintrag 2 dieser Datei) '
        + 'bindet dieselben Werte erneut samt PR-Nummer.',
    },

    fortsetzungsHinweis: 'ERSTER Eintrag der Fortsetzungsdatei. Die erste Registerdatei ist mit '
      + 'ihrem Abschluss-Akt geschlossen (R14a-Rollover); ihr letzter Eintrag verbietet jeden '
      + 'weiteren. Die Kette laeuft ueber genesisSha256 = Tail-Event-Hash der geschlossenen '
      + 'Datei ungebrochen weiter.',

    laufFreigabe: 'DIESER AKT AUTORISIERT KEINEN KONFIRMATORISCHEN LAUF. Er deckt ausschliesslich '
      + 'die Aequivalenz-Beine auf dem ENTDECKUNGS-Panel. Der konfirmatorische Lauf braucht seinen '
      + 'eigenen Eintrag der Art confirmatory_execution_authorized (F6-K11) und danach das gruene '
      + 'Delta-Review (F6-K17 Schritt 8).',
    blindAttest: 'BLIND-ATTEST (F6-K5): der Ausfuehrende haelt KEINERLEI Information aus dem '
      + 'abgebrochenen Lauf. Der versiegelte Zwischenstand ist ungeoeffnet geblieben (F6-K1). Die '
      + 'Sollwerte dieses Akts sind aus dem Vorgaenger-Akt kopiert und wurden nicht gelesen.',
    endtestSiegel: quelle.endtestSiegel,
    actor: 'Karl Viehrig (Auftraggeber, Freigabe-Inhaber) - ausgefuehrt unter dem Review-Tor des '
      + 'Orchestrators.',
  };
}

function haupt(argv) {
  if (argv.includes('--force')) {
    throw new VerfassungsBruch('F6-AQ2: --force gibt es nicht (F6-B8).');
  }
  const schreiben = argv.includes('--schreiben');
  const registerPfad = argument(argv, 'register') || absolut(ZIEL_REL);

  const registeredAt = argument(argv, 'anmeldezeit') || new Date().toISOString();
  if (new Date(registeredAt).getTime() > Date.now() + 60000) {
    throw new VerfassungsBruch('F6-AQ2: die Anmeldezeit liegt in der Zukunft.');
  }
  const zugriffAb = argument(argv, 'zugriff-ab')
    || new Date(new Date(registeredAt).getTime() + VORLAUF_MINUTEN * 60000).toISOString();
  if (!(new Date(registeredAt) < new Date(zugriffAb))) {
    throw new VerfassungsBruch('F6-AQ2: zugriff-ab muss NACH der Anmeldung liegen (VB-A11).');
  }

  const rohBytes = fs.readFileSync(registerPfad);
  const register = JSON.parse(rohBytes.toString('utf8'));
  if (istGeschlossen(register)) {
    throw new VerfassungsBruch(
      `F6-AQ2: ${registerPfad} ist mit ihrem Abschluss-Akt geschlossen - dieser Akt gehoert in die `
      + 'Fortsetzung.');
  }
  const events = register.events || [];
  if (events.length !== ERWARTETE_EVENTS) {
    throw new VerfassungsBruch(
      `F6-AQ2: die Fortsetzung fuehrt ${events.length} Eintraege, erwartet ${ERWARTETE_EVENTS}. `
      + 'Dieser Akt ist ihr ERSTER.');
  }
  if (events.some((e) => e.runId === RUN_ID)) {
    throw new VerfassungsBruch(`F6-AQ2: die runId ${RUN_ID} ist bereits belegt.`);
  }

  const quelle = quellAkt();
  const eintrag = baueEintrag(registeredAt, zugriffAb, quelle);
  pruefeR12a(eintrag);
  const neu = haengeEintragAn(register, eintrag);
  pruefeZugriffsRegister(neu);
  const fertig = neu.events[neu.events.length - 1];
  const serialisiert = `${JSON.stringify(neu, null, 1)}\n`;
  const bytesNachher = Buffer.byteLength(serialisiert, 'utf8');

  process.stdout.write(
    'Akt            DER ZWEITE ZAEHLPROBEN-AKT (F6-K16 / F6-K17 Schritt 2)\n'
    + `runId          ${RUN_ID}\n`
    + `typ            ${ART_ZAEHLPROBE}\n`
    + `Ziel           ${ZIEL_REL}\n`
    + `Quell-Akt      ${QUELLE.runId} / ${QUELLE.eventHash}\n`
    + `Sollwerte      aus dem Quell-Akt KOPIERT (${Object.keys(quelle.aequivalenzSoll).length} Bloecke)\n`
    + `Skript-Drift   ${eintrag.skriptDrift.geaendertSeitDemQuellAkt.length} von `
    + `${Object.keys(eintrag.ausfuehrendeSkripte).length} Pfaden geaendert\n`
    + `${eintrag.skriptDrift.geaendertSeitDemQuellAkt.map((r) => `   - ${r}`).join('\n')}\n`
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
  RUN_ID, QUELLE, ZIEL_REL, DECKEL_BYTES, ERWARTETE_EVENTS,
  baueEintrag, quellAkt, pruefeDeckel, haupt, WURZEL,
};
