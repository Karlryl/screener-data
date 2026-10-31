#!/usr/bin/env node
// F-NEU-01 (Tag 629): Sammel-Alarm fuer Ticker ohne jede Waehrungsangabe.
// P316 (31.10.2026): Firmen, deren Abschlusszahlen die Berichtswaehrungs-Handtabelle zurueckhaelt, werden hier nur
// gemeldet, immer mit Exit 0: Eine gehaltene Zeile darf die Boards nie stoppen. Bis zur Frist Warnung, danach Alarm an Karl.
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

function reportHeld(m) {
  const n = m == null ? undefined : m.n_reporting_ccy_held;
  if (n === undefined) return;
  if (!Number.isSafeInteger(n) || n < 0) {
    console.error('::warning::Invalid n_reporting_ccy_held in snapshots/_manifest.json - expected a non-negative safe integer');
    return;
  }
  for (const r of Array.isArray(m._reportingCcyHeld) ? m._reportingCcyHeld : []) {
    const line = `${r.ticker}: Berichtswaehrung nicht bestaetigt (${r.type}), Abschlusszahlen zurueckgehalten, zustaendig ${r.owner}, seit ${r.firstSeen}, Pruefung bis ${r.pruefungBis}: ${r.reason}. configs/reporting-currency-hand-table.json neu pruefen`;
    console.error(r.overdue ? `::error::ALARM an Karl, Frist ueberschritten. ${line}` : `::warning::${line}`);
  }
}

function run() {
  let m = null;
  try { m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch (e) { return 0; }
  reportHeld(m);
  const hasCounter = m != null && Object.prototype.hasOwnProperty.call(m, 'n_ccy_missing_completely');
  if (hasCounter && (!Number.isSafeInteger(m.n_ccy_missing_completely) || m.n_ccy_missing_completely < 0)) {
    console.error('::error::Invalid n_ccy_missing_completely in snapshots/_manifest.json - expected a non-negative safe integer');
    return 1;
  }
  const n = hasCounter ? m.n_ccy_missing_completely : 0;
  if (n > 0) {
    console.error(`::error::${n} Ticker ohne jede Waehrungsangabe — Snapshots NICHT ueberschrieben, Altbestand bleibt`);
    return 1;
  }
  return 0;
}

process.exit(run());
