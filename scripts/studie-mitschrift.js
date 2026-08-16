#!/usr/bin/env node
'use strict';

// Vorwaerts-Mitschrift der Early-Detection-Studie (Verfassung 2.0.0, E0).
//
// Warum es sie gibt: jeder Tag ohne Mitschrift ist verlorene Evidenz. Alles andere in
// der Studie ist pseudo-prospektiv — ich weiss, wer 2017-2024 gewonnen hat. Der einzige
// wirklich blinde Test ist der, der ab HEUTE laeuft. Deshalb startet die Mitschrift an
// Tag 1 und nicht erst, wenn die Signalfamilie steht: festgehalten wird, WAS an einem
// Tag oeffentlich beobachtbar war (welcher SEC-Kanal welchen Stand hatte), nicht was
// ein noch nicht eingefrorenes Signal daraus gemacht haette.
//
// Ereignisgetrieben, nicht taeglich-je-Firma: Quartalszahlen kommen mit ~45 Tagen
// Verzug, eine Tages-Mitschrift je Firma waere Theater. Angebunden ist die Mitschrift
// an den bestehenden Tageslauf; sie fasst nur an, was der Lauf ohnehin schon geholt hat.
//
// Sie schreibt ihre eigenen Luecken mit — in zwei Formen:
//   1. Kalender-Luecke: zwischen dem letzten Eintrag und heute fehlen Lauftage.
//   2. Kanal-Luecke: ein Kanal hat sich seit dem letzten Eintrag nicht veraendert.
// Beides steht als Feld im Eintrag, nicht in einem Log, das niemand liest.
//
// Kein Eingriff in src/scoring, kein Lesen von Ergebnisdaten (R4), nur additives
// Beobachten. node-Standardbibliothek, keine absoluten Pfade.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..');
const LOG_DIR = path.join(REPO, 'research', 'studie', 'vorwaerts-mitschrift');

// Ueberschreibbar, damit der Wachtest gegen ein Wegwerf-Verzeichnis laufen kann statt
// gegen die echte Mitschrift — ein Test, der die Evidenz veraendert, ist keiner.
function logVerzeichnis() {
  return process.env.STUDIE_MITSCHRIFT_DIR || LOG_DIR;
}
const SCHEMA = 'early-detection-forward-log/v1';

// Die SEC-Kanaele, die der bestehende Lauf ohnehin fortschreibt. Fehlt einer, ist das
// ein Befund und kein Grund zum Schweigen.
const KANAELE = [
  { id: 'sec-form4-daily', pfad: 'external-data/sec-form4-cache.json', takt: 'taeglich' },
  { id: 'sec-annual-bulk', pfad: 'external-data/sec-annual-bulk.jsonl', takt: 'monatlich' },
  { id: 'sec-secannual', pfad: 'external-data/sec-secannual.json', takt: 'monatlich' },
];

function heuteUtc() {
  return new Date().toISOString().slice(0, 10);
}

function sha256Datei(abs) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(abs));
  return hash.digest('hex');
}

function kanalStand(kanal) {
  const abs = path.join(REPO, kanal.pfad);
  if (!fs.existsSync(abs)) {
    return { id: kanal.id, takt: kanal.takt, vorhanden: false, grund: 'Datei fehlt im Checkout' };
  }
  const stat = fs.statSync(abs);
  return {
    id: kanal.id,
    takt: kanal.takt,
    vorhanden: true,
    bytes: stat.size,
    sha256: sha256Datei(abs),
    zuletztGeaendert: stat.mtime.toISOString(),
  };
}

function logDatei(datum) {
  return path.join(logVerzeichnis(), `${datum.slice(0, 7)}.jsonl`);
}

function alleEintraege() {
  const dir = logVerzeichnis();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .sort()
    .flatMap((name) =>
      fs
        .readFileSync(path.join(logVerzeichnis(), name), 'utf8')
        .split('\n')
        .filter((zeile) => zeile.trim().length > 0)
        .map((zeile) => JSON.parse(zeile)),
    );
}

function tageZwischen(vonDatum, bisDatum) {
  const von = Date.parse(`${vonDatum}T00:00:00Z`);
  const bis = Date.parse(`${bisDatum}T00:00:00Z`);
  return Math.round((bis - von) / 86400000);
}

function anhaengen(eintrag) {
  fs.mkdirSync(logVerzeichnis(), { recursive: true });
  fs.appendFileSync(logDatei(eintrag.laufDatum), `${JSON.stringify(eintrag)}\n`, 'utf8');
}

function baueEintrag(datum) {
  const vorherige = alleEintraege();
  const letzter = vorherige.length > 0 ? vorherige[vorherige.length - 1] : null;
  const kanaele = KANAELE.map(kanalStand);

  const luecken = [];
  if (letzter) {
    const abstand = tageZwischen(letzter.laufDatum, datum);
    if (abstand > 1) {
      luecken.push({
        art: 'kalender',
        von: letzter.laufDatum,
        bis: datum,
        fehlendeTage: abstand - 1,
        hinweis: 'Zwischen diesen Tagen wurde kein Lauf protokolliert — die Mitschrift hat hier kein Wissen.',
      });
    }
    const vorherKanaele = new Map((letzter.kanaele || []).map((kanal) => [kanal.id, kanal]));
    for (const kanal of kanaele) {
      const vorher = vorherKanaele.get(kanal.id);
      if (!kanal.vorhanden) {
        luecken.push({ art: 'kanal-fehlt', kanal: kanal.id, hinweis: kanal.grund });
      } else if (vorher && vorher.sha256 === kanal.sha256) {
        luecken.push({
          art: 'kanal-unveraendert',
          kanal: kanal.id,
          seit: letzter.laufDatum,
          hinweis: `Kanal ${kanal.id} ist byte-gleich zum letzten Eintrag — kein neues Beobachtungswissen an diesem Tag.`,
        });
      }
    }
  }

  return {
    schema: SCHEMA,
    protocol: 'FEM-SEC-US@2.0.0',
    laufDatum: datum,
    erfasstAm: new Date().toISOString(),
    vorgaengerDatum: letzter ? letzter.laufDatum : null,
    kanaele,
    luecken,
    status: luecken.length === 0 ? 'VOLLSTAENDIG' : 'MIT_LUECKEN',
    hinweis:
      'Beobachtungs-Mitschrift, keine Signalauswertung. Die Signalfamilie wird erst in E2/E3 eingefroren; '
      + 'ausgewertet wird spaeter auf genau diesen protokollierten Staenden, nie auf spaeter nachgeladenen.',
  };
}

function monatsbericht(monat) {
  const eintraege = alleEintraege().filter((eintrag) => eintrag.laufDatum.startsWith(monat));
  if (eintraege.length === 0) return `Mitschrift ${monat}: kein einziger Eintrag — die Anbindung an den Tageslauf greift nicht.`;
  const luecken = eintraege.reduce((summe, eintrag) => summe + (eintrag.luecken || []).length, 0);
  const fehlendeTage = eintraege
    .flatMap((eintrag) => eintrag.luecken || [])
    .filter((luecke) => luecke.art === 'kalender')
    .reduce((summe, luecke) => summe + luecke.fehlendeTage, 0);
  return (
    `Mitschrift ${monat}: ${eintraege.length} Eintraege, ${luecken} Luecken-Vermerke, `
    + `${fehlendeTage} Kalendertage ohne Lauf. Erster ${eintraege[0].laufDatum}, letzter ${eintraege[eintraege.length - 1].laufDatum}.`
  );
}

function main(argv) {
  const befehl = argv[2] || 'erfassen';
  if (befehl === 'monatsbericht') {
    console.log(monatsbericht(argv[3] || heuteUtc().slice(0, 7)));
    return 0;
  }
  if (befehl !== 'erfassen') {
    console.error(`[studie-mitschrift] Unbekannter Befehl: ${befehl} (erfassen | monatsbericht [YYYY-MM])`);
    return 1;
  }

  const datum = argv[3] || heuteUtc();
  const schonDa = alleEintraege().some((eintrag) => eintrag.laufDatum === datum);
  if (schonDa) {
    console.log(`[studie-mitschrift] ${datum} ist bereits protokolliert — kein zweiter Eintrag.`);
    return 0;
  }

  let eintrag;
  try {
    eintrag = baueEintrag(datum);
  } catch (fehler) {
    // Ein Absturz darf keine stille Luecke hinterlassen: der Fehler wird selbst zum
    // Eintrag, damit spaeter niemand einen sauberen Tag sieht, wo keiner war.
    eintrag = {
      schema: SCHEMA,
      protocol: 'FEM-SEC-US@2.0.0',
      laufDatum: datum,
      erfasstAm: new Date().toISOString(),
      kanaele: [],
      luecken: [{ art: 'erfassung-gescheitert', hinweis: `${fehler.name}: ${fehler.message}` }],
      status: 'FEHLER',
    };
    anhaengen(eintrag);
    console.error(`::error::Vorwaerts-Mitschrift ${datum} gescheitert: ${fehler.message}`);
    return 1;
  }

  anhaengen(eintrag);
  console.log(`[studie-mitschrift] ${datum}: ${eintrag.status}, ${eintrag.luecken.length} Luecken-Vermerk(e).`);
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv);
}

module.exports = { baueEintrag, monatsbericht, alleEintraege, anhaengen, tageZwischen, logVerzeichnis, SCHEMA };
