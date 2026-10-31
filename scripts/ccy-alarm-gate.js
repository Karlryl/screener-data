#!/usr/bin/env node
// F-NEU-01 (Tag 629): Sammel-Alarm fuer Ticker ohne jede Waehrungsangabe.
// P316 (31.10.2026): derselbe Alarm fuer Firmen, deren Abschlusszahlen die Berichtswaehrungs-Handtabelle
// zurueckhaelt (Widerspruch des Anbieters oder Periode nach dem belegten Stand): Die Zeile braucht eine neue Pruefung.
//
// WARUM ein eigenes Skript und NICHT der frueh laufende coverage-gate.js:
// "Verify Pull Coverage" laeuft im merge-Job VOR Pull Historical Prices, den vier
// Daten-Waechtern, ATH-State und "Commit Snapshots" — ein exit 1 dort wuergt den
// Tageslauf ab, bevor irgendetwas geschrieben/committet ist, und der scoring-Job
// (needs merge) liefe gar nicht mehr. Das Workflow-eigene Muster steht in
// daily-pull.yml ueber dem Schritt "Daten-Waechter einsammeln (rotes X)":
// erst alles schreiben und committen, DANN einsammeln und rot faerben.
// Dieses Skript ist genau dieser Einsammel-Aufruf.
//
// Schwelle: > 0 (Karl-Entscheid, keine Toleranz, kein Ventil).
// Fehlendes Feld / fehlende oder syntaktisch kaputte Manifest-Datei -> Exit 0:
// das ist Sache der bestehenden Gates (coverage-gate.js), nicht dieses Kanals.
// Ein vorhandener, aber schemawidriger eigener Zaehler gehoert dagegen genau zu
// diesem Alarmkanal und darf nicht still als null behandelt werden.
const fs = require('fs');
const path = require('path');

const MANIFEST = path.join('./snapshots', '_manifest.json');
const COUNTERS = [
  ['n_ccy_missing_completely', n => `${n} Ticker ohne jede Waehrungsangabe — Snapshots NICHT ueberschrieben, Altbestand bleibt`],
  ['n_reporting_ccy_held', n => `${n} Firmen mit zurueckgehaltenen Abschlusszahlen: Berichtswaehrung der Handtabelle nicht bestaetigt (_reportingCcyHeld im Manifest), configs/reporting-currency-hand-table.json neu pruefen`],
];

function run() {
  let m = null;
  try { m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch (e) { return 0; }
  let exit = 0;
  for (const [field, message] of COUNTERS) {
    const hasCounter = m != null && Object.prototype.hasOwnProperty.call(m, field);
    if (hasCounter && (!Number.isSafeInteger(m[field]) || m[field] < 0)) {
      console.error(`::error::Invalid ${field} in snapshots/_manifest.json - expected a non-negative safe integer`);
      exit = 1;
    } else if (hasCounter && m[field] > 0) {
      console.error(`::error::${message(m[field])}`);
      exit = 1;
    }
  }
  return exit;
}

process.exit(run());
