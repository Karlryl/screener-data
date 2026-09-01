#!/usr/bin/env node
'use strict';

// Studie 2.0, F6-Tor — BERICHTIGUNGS-VERMERK zur Zensur-Basis von Bein 2.
// (_COURT-F6-ZAEHLWERK-ANHANG2-2026-09-01, Auflagen F6-C8a..j, ratifiziert;
// Doku-Pflichten F6-C8g (1)-(6) landen in DIESEM Akt.)
//
// WARUM EIN EIGENER AKT UND KEINE KORREKTUR: das Zugriffs-Register ist
// NUR-ANHAENGEND. Ein bestehender Eintrag wird nie editiert — Berichtigungen
// sind eigene Akte. Der zuletzt angehaengte Zaehlproben-Akt nennt woertlich ein
// Soll-Tripel, das ANHANG 2 als spaltenverwechselt festgestellt hat; ueber eine
// solche Kette darf nicht unberichtigt gelaufen werden. Zugleich verlangt
// F6-C8f die Reihenfolge ABLEITUNG -> EINTRAG -> LAUF: die Ableitung muss VOR
// dem Wiederholungslauf in einem Eintrag stehen.
//
// WAS DIESER AKT NICHT TUT: er autorisiert NICHTS. `C0_REGELFREEZE`,
// `allowedOutputs: []`, kein Datenzugriff, kein Fenster. Die AUTORISIERUNG des
// Zaehlproben-Akts (Fenster, Schluesselliste, Zeitkette) bleibt vollstaendig
// gueltig — berichtigt wird ausschliesslich, auf WELCHE SPALTE das Soll zeigt.
//
// Trockenlauf ist der STANDARD. Es gibt kein --force und keine
// Reparatur-Betriebsart (F6-B8). Eigenes Werkzeug je Register-Akt.
//
// Aufruf:
//   node scripts/studie-f6-berichtigung-bein2.js              # Trockenlauf
//   node scripts/studie-f6-berichtigung-bein2.js --schreiben  # anhaengen

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

// ── Sollwerte, unabhaengig von den geprueften Dateien notiert ──────────────
const RUN_ID = 'f6-bein2-berichtigung-2026-09-01';
const ERWARTETER_LETZTER_RUNID = 'f6-aequivalenz-entdeckung-2026-09-01';
const ERWARTETER_TAIL = '847084648a7fa5d7d8535c7eec3285de44ac94c02cce1e94f204528f34358d41';
const ERWARTETE_EVENTS = 25;
const VORLAUF_MINUTEN = 120;

// Das Referenzartefakt, aus dem das Soll stammt — und NUR aus ihm.
const QUELLE_REL = 'reports/studie/E4d-kadenz-entdeckung-2026-08-19.json';
const QUELLE_SHA = '46e191ec68e0480a336fd287dc548c8b6a975b8d50a07c6e0162274c6dbd8fdf';

// ANHANG 2 im Stand VOR seiner Ratifikation (Byte-Beweis seines Nachtrags).
const ANHANG2_SHA = '6888a3f8e264340eb96e6c3a1cf79bf98e6334ebe8ed236dc8c91bec271f8d2c';
const ANHANG2_BYTES = 56453;

// F6-C8c: die Arm-Abbildung AUSGESCHRIEBEN — zweite latente Transkriptionsfalle.
const ARM_ARTEFAKT = { signal: 'signal', kontrollpool: 'kontrolle' };
const SPALTEN = { zaehler: 'fallzahl', nenner: 'nenner_e3', zensiert: 'zensiert_e3' };
const BAND = '2009-2015';

// Die vier Soll-Tripel auf der E3-Basis (S-U/kontrollpool berichtigt).
const SOLL = {
  'S-U/signal': { zaehler: 543, nenner: 651, zensiert: 0 },
  'S-U/kontrollpool': { zaehler: 3761, nenner: 4514, zensiert: 0 },
  'S-G/signal': { zaehler: 557, nenner: 647, zensiert: 0 },
  'S-G/kontrollpool': { zaehler: 5000, nenner: 5768, zensiert: 0 },
};
// Die ueberholte Fassung, nur zur Benennung dessen, was ersetzt wird.
const UEBERHOLT = { zelle: 'S-U/kontrollpool', zaehler: 3760, nenner: 4513, zensiert: 1 };

const spaltenpfad = (zelle) => {
  const [v, arm] = zelle.split('/');
  return `baender["${BAND}"].varianten["${v}"].${ARM_ARTEFAKT[arm]}`;
};

// ── Werkzeug ────────────────────────────────────────────────────────────────

function argument(argv, name) {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return null;
  const wert = argv[i + 1];
  if (!wert || wert.startsWith('--')) {
    throw new VerfassungsBruch(`F6-BER: --${name} ohne Wert.`);
  }
  return wert;
}

const lies = (p) => {
  if (!fs.existsSync(p)) throw new VerfassungsBruch(`F6-BER: nicht gefunden: ${p}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
};
const dateiHash = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

function pruefeKette(register, stand, runId) {
  if ((register.events || []).length !== ERWARTETE_EVENTS) {
    throw new VerfassungsBruch(
      `F6-BER: das Register fuehrt ${(register.events || []).length} Eintraege, erwartet `
      + `${ERWARTETE_EVENTS}.`);
  }
  const letzte = register.events[register.events.length - 1];
  if (letzte.runId !== ERWARTETER_LETZTER_RUNID) {
    throw new VerfassungsBruch(
      `F6-BER: das Kettenende ist ${letzte.runId}, erwartet ${ERWARTETER_LETZTER_RUNID}.`);
  }
  if (stand.tailHash !== ERWARTETER_TAIL) {
    throw new VerfassungsBruch(
      `F6-BER: Ketten-Endhash ${stand.tailHash}, erwartet ${ERWARTETER_TAIL}.`);
  }
  // Geprueft wird die TATSAECHLICH verwendete runId, nicht die Konstante -
  // sonst liesse ein --runid am Wachtposten vorbei einen Doppel-Eintrag zu.
  if ((register.events || []).some((e) => e.runId === runId)) {
    throw new VerfassungsBruch(`F6-BER: runId ${runId} steht bereits im Register.`);
  }
  return letzte;
}

// Das Soll wird AM ARTEFAKT nachgerechnet — nie aus einer Laufausgabe (F6-C8c).
function pruefeSollAmArtefakt(wurzel) {
  const p = path.join(wurzel, ...QUELLE_REL.split('/'));
  const ist = dateiHash(p);
  if (ist !== QUELLE_SHA) {
    throw new VerfassungsBruch(
      `F6-BER: ${QUELLE_REL} weicht ab (ist ${ist}, soll ${QUELLE_SHA}).`);
  }
  const d = lies(p);
  const varianten = ((d.baender || {})[BAND] || {}).varianten || {};
  const identitaeten = {};
  for (const [zelle, soll] of Object.entries(SOLL)) {
    const [v, arm] = zelle.split('/');
    const z = (varianten[v] || {})[ARM_ARTEFAKT[arm]];
    if (!z) throw new VerfassungsBruch(`F6-BER: ${spaltenpfad(zelle)} fehlt im Artefakt.`);
    for (const [feld, spalte] of Object.entries(SPALTEN)) {
      if (!(spalte in z)) {
        throw new VerfassungsBruch(`F6-BER: ${spaltenpfad(zelle)}.${spalte} fehlt.`);
      }
      if (z[spalte] !== soll[feld]) {
        throw new VerfassungsBruch(
          `F6-BER: ${spaltenpfad(zelle)}.${spalte} ist ${z[spalte]}, das Werkzeug fuehrt `
          + `${soll[feld]}.`);
      }
    }
    // Die artefakteigene Identitaet, exakte Float-Gleichheit.
    if (soll.zaehler / soll.nenner !== z.auffindbarkeit_e3) {
      throw new VerfassungsBruch(
        `F6-BER: ${zelle}: ${soll.zaehler}/${soll.nenner} != auffindbarkeit_e3 `
        + `(${z.auffindbarkeit_e3}).`);
    }
    identitaeten[zelle] = z.auffindbarkeit_e3;
  }
  // Und die ueberholte Fassung steht nachweislich in den _kadenz-Spalten.
  const k = varianten['S-U'].kontrolle;
  if (k.zaehler_kadenz !== UEBERHOLT.zaehler || k.nenner_kadenz !== UEBERHOLT.nenner
      || k.zensiert_kadenz !== UEBERHOLT.zensiert) {
    throw new VerfassungsBruch(
      'F6-BER: die ueberholte Fassung steht nicht wie erwartet in den _kadenz-Spalten.');
  }
  return { identitaeten, kadenzRate: k.auffindbarkeit_kadenz, dateiHash: ist };
}

function baueEintrag(runId, registeredAt, wirksamAb, mess) {
  const tabelle = Object.fromEntries(Object.entries(SOLL).map(([zelle, s]) => [zelle, {
    zaehler: s.zaehler, nenner: s.nenner, zensiert: s.zensiert,
    spaltenpfad: `${spaltenpfad(zelle)}.{fallzahl,nenner_e3,zensiert_e3}`,
  }]));
  return {
    runId,
    typ: ART_C0_REGELFREEZE,
    registeredAt,
    accessedAt: wirksamAb,
    fenster: ['kein Studienfenster - Berichtigungs-Vermerk ohne Datenzugriff'],
    allowedOutputs: [],
    erlaubt: 'Nichts. Kein Datenzugriff.',
    verboten:
      'Jede Berufung auf diesen Eintrag als Autorisierung eines Laufs; jeder Datenzugriff unter '
      + 'dieser runId; jede Verwendung der hier genannten Identitaetsraten als Ausgabewert eines '
      + 'Prueffenster-Laufs (sie sind Entdeckungsfenster-Groessen und stehen hier ausschliesslich '
      + 'als Berichtigungs-Vermerk); jede Ableitung eines Bein-2-Solls aus einer Laufausgabe statt '
      + 'aus dem committeten Artefakt; jedes Abfeuern des Endtests.',
    begruendung:
      'BERICHTIGUNGS-VERMERK zur Zensur-Basis von Bein 2, angeordnet durch '
      + `_COURT-F6-ZAEHLWERK-ANHANG2-2026-09-01 (Urteilsstand VOR der Ratifikation, sha256 `
      + `${ANHANG2_SHA}, ${ANHANG2_BYTES} B, am Objekt nachgerechnet), Auflagen F6-C8a..j; `
      + 'Doku-Pflichten F6-C8g (1)-(6) landen in DIESEM Akt, die des F6-C8h zusaetzlich im '
      + 'konfirmatorischen Eintrag. '
      + '(1) DIE BERICHTIGUNG: die in F6-C8 gelistete Zelle S-U/kontrollpool 3760/4513/1 wurde aus '
      + 'den Spalten zaehler_kadenz/nenner_kadenz/zensiert_kadenz transkribiert. Unter der '
      + 'registrierten Bedingung (F6-FORM je Arm, Kette nach F6-C2/C3) ist sie NICHT ERFUELLBAR, '
      + 'nicht nur teuer. Sie lautet ab jetzt 3761/4514/0. ARITHMETISCHER GEGENBEWEIS, als '
      + 'Vermerk und ausdruecklich NICHT als Ausgabewert: im selben Artefakt steht '
      + 'auffindbarkeit_e3 = 0.8331856446610545 = 3761/4514 neben '
      + `auffindbarkeit_kadenz = ${mess.kadenzRate} = 3760/4513 - eine Kette kann nicht beides `
      + 'liefern. Beide Raten sind ENTDECKUNGSFENSTER-Groessen aus einem committeten Artefakt; sie '
      + 'gehoeren in diesen Vermerk und duerfen nie in eine Prueffenster-Ausgabemenge wandern. '
      + '(2) DIE VIER SOLL-TRIPEL MIT SPALTENPFADEN stehen im Feld sollTabelle; die Arm-Abbildung '
      + 'F6 "kontrollpool" -> Artefaktschluessel "kontrolle" ist AUSGESCHRIEBEN, nicht erschlossen '
      + '(zweite latente Transkriptionsfalle, F6-C8c). '
      + `(3) REFERENZBINDUNG: ${QUELLE_REL}, sha256 ${QUELLE_SHA}. `
      + '(4) DREI DER VIER ZELLEN SIND BASISBLIND: bei S-U/signal, S-G/signal und S-G/kontrollpool '
      + 'gilt e3 == kadenz (651/0, 647/0, 5768/0). Ihr Bestehen traegt deshalb KEINE Evidenz zur '
      + 'Basisfrage; nur S-U/kontrollpool trennt die beiden Basen. Wer spaeter "3 von 4 bestanden" '
      + 'als Bestaetigung der Kadenz-Basis liest, liest falsch. '
      + '(5) DAS SOLL STAMMT AUS DEM ARTEFAKT, NICHT AUS EINEM LAUF (F6-C8f). Drei '
      + 'laufunabhaengige Zeugen, alle a priori ohne Panel ableitbar: (a) die Spaltensemantik des '
      + 'Artefakts allein - es fuehrt BEIDE Basen nebeneinander und benennt sie; (b) '
      + 'scripts/studie-e4d-kadenz.py:522, wo die Spalte zensiert_e3 von der F6-eigenen Funktion '
      + 'zp.ist_zensiert erzeugt wird; (c) die artefakteigene Identitaet auffindbarkeit_e3 = '
      + '3761/4514 auf die 16. Stelle. Die Reihenfolge ABLEITUNG -> EINTRAG -> LAUF ist damit '
      + 'beurkundet; der gerissene vierte Anlauf ist Anlass und Bestaetigung, NIE Quelle. '
      + '(6) BRUCHPROBEN (F6-C8e, protokolliert im Text von PR #203): Probe 1 - ein '
      + 'Soll-Spaltenpfad von .nenner_e3 auf .nenner_kadenz gestellt -> BASIS-ABBRUCH ("traegt ein '
      + 'kadenz-Segment"); Probe 2 - ein Soll-Literal 3761 -> 3762 -> KONSTANTEN-ABGLEICH GERISSEN; '
      + 'Probe 3 - das alte Kadenz-Tripel als Soll -> BASIS-ABBRUCH, der beide Tripel benennt. '
      + 'Gegenprobe unveraendert gruen. '
      + 'VERHAELTNIS ZUM VORANGEGANGENEN EINTRAG: der Zaehlproben-Akt '
      + `${ERWARTETER_LETZTER_RUNID} (eventHash ${ERWARTETER_TAIL}) fuehrt in seinem Feld `
      + 'aequivalenzSoll.bein2.zellen die Zelle S-U/kontrollpool mit 3760/4513/1. Diese WERTE sind '
      + 'durch den Gerichtsakt ANHANG 2 UEBERHOLT und werden hiermit berichtigt. Seine '
      + 'AUTORISIERUNG bleibt VOLLSTAENDIG GUELTIG: Fenster ["entdeckung"], die abschliessende '
      + 'allowedOutputs-Liste nach F6-C7i und die Zeitkette sind unberuehrt. Berichtigt wird '
      + 'ausschliesslich, auf WELCHE SPALTE das Soll zeigt. Das Register ist nur-anhaengend; '
      + 'dieser Vermerk ersetzt keinen Eintrag, er tritt neben ihn. '
      + 'RICHTUNGS-OFFENLEGUNG (F6-C8i, beide Saetze woertlich): "Diese Berichtigung ENTFERNT an '
      + 'genau einer Zelle einen stehenden STOPP" - anders als F6-C7a, die nur Abbruchgruende '
      + 'hinzufuegte. "Die Unerfuellbarkeit wurde hier nicht vor, sondern DURCH einen Lauf '
      + 'entdeckt" - ein Verfahrensmakel, benannt und nicht weggeredet; deshalb als Gerichtsakt '
      + 'ratifiziert und nie vom bauenden Agenten absorbiert. Ausgleichend: der entfernte STOPP war '
      + 'ein totes Tor (ein Soll, das die gebundene Kette nie erfuellen kann, prueft nichts), und '
      + 'die Abbruchgruende aus F6-C8d sind zusaetzlich - Netto-Bilanz der Abbruchgruende: +2. '
      + 'Aussage ueber die Richtung der REGEL, nie ueber den Ausgang des Laufs. '
      + 'AKTENKETTE: Haupturteil (3:0) -> ORCHESTRATOR-NACHTRAEGE 1-3 -> ANHANG 1 '
      + '(Kalibrier-Haelfte) -> Anlauf 4 riss -> Forensik OHNE Eingriff (kein Sollwert angefasst, '
      + 'KZ-4 gewahrt) -> ANHANG 2 (Basis + Berichtigung) -> Ratifikation -> dieser Akt. Der Beleg '
      + 'der Nicht-Erosion liegt darin, dass DREIMAL nacheinander NICHT still weitergedeutet wurde. '
      + 'GEERBTE FUNDSTELLE: die Zahlenzitierung in ANHANG1:144 erbt diese Berichtigung. '
      + 'Erzeugt von scripts/studie-f6-berichtigung-bein2.js (eigenes Werkzeug je Register-Akt, '
      + 'F6-B8; Trockenlauf als Standard, kein --force). Ein-Appender-Regel: main-first per '
      + 'Mini-PR (nur die Registerdatei), danach Serverbeweis gegen main.',
    endtestSiegel:
      'unberuehrt und in ALLEN Zweigen ZU. Dieser Eintrag beurkundet eine Berichtigung und oeffnet '
      + 'nichts: weder Endtest-Fenster noch Prueffenster noch Entdeckungsfenster noch Lueckenliste '
      + 'noch Schluesselmaterial werden geoeffnet, gelesen oder gezaehlt.',
    berichtigung: {
      gegenstand: 'Zensur- und Quotientenbasis von Aequivalenz-Tor Bein 2',
      basis: 'E3 nach preregistration.json:80 (Zensur) und :87 (Netto-Nenner), implementiert '
        + 'durch studie-zaehlprobe.py::ist_zensiert / arm_zaehlen. Die KADENZ-/E4e-Basis des '
        + 'Instruments studie-e4d-kadenz.py regiert Bein 2 NICHT (F6-C8a).',
      ueberholt: { zelle: UEBERHOLT.zelle, zaehler: UEBERHOLT.zaehler, nenner: UEBERHOLT.nenner,
        zensiert: UEBERHOLT.zensiert, spalten: 'zaehler_kadenz/nenner_kadenz/zensiert_kadenz' },
      berichtigt: { zelle: UEBERHOLT.zelle, zaehler: 3761, nenner: 4514, zensiert: 0,
        spalten: 'fallzahl/nenner_e3/zensiert_e3' },
      armAbbildung: 'F6 "signal" -> "signal"; F6 "kontrollpool" -> "kontrolle" (ausgeschrieben, '
        + 'nicht erschlossen)',
      sollTabelle: tabelle,
      referenz: { datei: QUELLE_REL, dateiSha256: QUELLE_SHA },
      basisblind: ['S-U/signal', 'S-G/signal', 'S-G/kontrollpool'],
      gerichtsakt: { datei: '_COURT-F6-ZAEHLWERK-ANHANG2-2026-09-01.md',
        sha256VorRatifikation: ANHANG2_SHA, bytes: ANHANG2_BYTES },
      vorgaengerAkt: { runId: ERWARTETER_LETZTER_RUNID, eventHash: ERWARTETER_TAIL,
        wasUeberholtIst: 'aequivalenzSoll.bein2.zellen["S-U/kontrollpool"]',
        wasGueltigBleibt: 'die Autorisierung: fenster ["entdeckung"], allowedOutputs nach '
          + 'F6-C7i, die Zeitkette' },
    },
  };
}

function haupt(argv) {
  if (argv.includes('--force')) {
    throw new VerfassungsBruch('F6-BER: --force gibt es nicht (F6-B8).');
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
      `F6-BER: --anmeldezeit ${registeredAt} liegt in der Zukunft.`);
  }
  const wirksamAb = argument(argv, 'wirksam-ab')
    ? new Date(argument(argv, 'wirksam-ab')).toISOString()
    : new Date(Date.parse(registeredAt) + VORLAUF_MINUTEN * 60 * 1000).toISOString();
  if (Date.parse(wirksamAb) <= Date.parse(registeredAt)) {
    throw new VerfassungsBruch(
      `F6-BER: --wirksam-ab (${wirksamAb}) muss NACH der Anmeldung (${registeredAt}) liegen.`);
  }

  const register = lies(registerPfad);
  const stand = pruefeZugriffsRegister(register);
  pruefeKette(register, stand, runId);
  const mess = pruefeSollAmArtefakt(dateiWurzel);

  const eintrag = baueEintrag(runId, registeredAt, wirksamAb, mess);
  const neu = haengeEintragAn(register, eintrag);
  pruefeZugriffsRegister(neu);
  const fertig = neu.events[neu.events.length - 1];

  process.stdout.write(
    'Akt           BERICHTIGUNGS-VERMERK Bein-2-Zensurbasis (F6-C8g)\n'
    + `runId         ${runId}\n`
    + `typ           ${ART_C0_REGELFREEZE}   allowedOutputs []\n`
    + `Referenz      ${QUELLE_REL}\n              ${mess.dateiHash}\n`
    + `Gerichtsakt   ANHANG 2, sha256 ${ANHANG2_SHA} (${ANHANG2_BYTES} B)\n`
    + `Berichtigt    ${UEBERHOLT.zelle}: ${UEBERHOLT.zaehler}/${UEBERHOLT.nenner}/`
    + `${UEBERHOLT.zensiert} (kadenz)  ->  3761/4514/0 (e3)\n`
    + `Identitaet    3761/4514 = ${mess.identitaeten['S-U/kontrollpool']}\n`
    + `Kettenende vor dem Eintrag: ${ERWARTETER_LETZTER_RUNID} / ${ERWARTETER_TAIL}\n`
    + `PRUEFZEILE: "previousHash": "${fertig.previousHash}"\n`
    + `eventHash dieses Eintrags: ${fertig.eventHash}\n`
    + `Eintraege nach dem Anhaengen: ${neu.events.length}\n\n`);

  if (!schreiben) {
    process.stdout.write(
      'TROCKENLAUF - es wurde NICHTS geschrieben. Der eventHash gilt fuer genau diese '
      + 'registeredAt/accessedAt.\n');
    return 0;
  }

  writeFileAtomic(registerPfad, `${JSON.stringify(neu, null, 1)}\n`, 'utf8');
  const zurueck = lies(registerPfad);
  pruefeZugriffsRegister(zurueck);
  if (zurueck.events[zurueck.events.length - 1].eventHash !== fertig.eventHash) {
    throw new VerfassungsBruch(
      'F6-BER - HALT, NICHT ERNEUT AUSFUEHREN: das Register auf der Platte weicht vom geprueft '
      + 'gebauten Stand ab. Erst von Hand pruefen.');
  }
  process.stdout.write(`GESCHRIEBEN: ${registerPfad}\n`);
  return 0;
}

module.exports = { SOLL, UEBERHOLT, ARM_ARTEFAKT, SPALTEN, RUN_ID, QUELLE_SHA,
  ANHANG2_SHA, ANHANG2_BYTES, ERWARTETER_TAIL, spaltenpfad, haupt };

if (require.main === module) {
  try {
    process.exit(haupt(process.argv.slice(2)));
  } catch (fehler) {
    process.stderr.write(`${fehler.message}\n`);
    process.exit(1);
  }
}
