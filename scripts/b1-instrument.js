'use strict';
/**
 * scripts/b1-instrument.js — B1 Discovery-Instrumentierung (Protokoll §6, Tag 389,
 * SHA-256 7b20e750261ca5a6ede207064275d3934f11408565865477baced74ee0cf0f79).
 *
 * ERLAUBTER SCOPE (präregistriert): NUR Fiskalperioden mit Ende ≤ 2018-12-31
 * (Discovery). Reine Daten-Hygiene + Struktur-Deskription — KEINE Preise, KEINE
 * Outcomes, KEINE Validation-Quartale. Seit Tag 391 läuft die Erkennung über die
 * GETEILTE lib/b1-detect.js (byte-gleich zum konfirmatorischen b1-validate.js).
 *
 * Usage: node scripts/b1-instrument.js [--limit N]
 * Output: reports/b1-instrument-discovery-2026-07-19.json + .md
 */
const fs = require('fs');
const path = require('path');
const secPit = require('../lib/sec-pit.js');
const detect = require('../lib/b1-detect.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_BASE = path.join(REPO_ROOT, 'reports', 'b1-instrument-discovery-2026-07-19');
const DISCOVERY_END = '2018-12-31';   // Protokoll §6

function main() {
  const args = process.argv.slice(2);
  const limIdx = args.indexOf('--limit');
  const limit = limIdx >= 0 ? parseInt(args[limIdx + 1], 10) : 0;

  const store = secPit.openStore();
  let tickerMap = null;
  try { tickerMap = secPit.loadTickerMap(); } catch (_) { /* Quote dann n/a */ }
  const cikHasTicker = new Set();
  if (tickerMap) for (const cik of tickerMap.values()) cikHasTicker.add(cik);

  let ciks = detect.listAllCiks();
  if (limit > 0) ciks = ciks.slice(0, limit);

  const t0ms = Date.now();
  const { records, counters } = detect.collectRecords(store, { eraStart: '1900-01-01', eraEnd: DISCOVERY_END, ciks });
  store.close();
  for (const r of records) r.hasTicker = cikHasTicker.has(r.cik);
  const cohorts = detect.flagEvents(records);

  let events = 0, eventsTickered = 0; const eventsByQ = {};
  for (const r of records) {
    if (!r.isEvent) continue;
    events++;
    if (r.hasTicker) eventsTickered++;
    eventsByQ[r.calQ] = (eventsByQ[r.calQ] || 0) + 1;
  }
  const runtimeSec = Math.round((Date.now() - t0ms) / 1000);

  const report = {
    generatedAt: new Date().toISOString(), protocol: 'protocol/b1-registered-20260719.md',
    protocolSha256: '7b20e750261ca5a6ede207064275d3934f11408565865477baced74ee0cf0f79',
    scope: 'Discovery <= ' + DISCOVERY_END + ' (Protokoll §6 — nur Instrumentierung)',
    detectionImpl: 'lib/b1-detect.js (geteilt mit b1-validate.js, Tag 391)',
    limit: limit || null, runtimeSec,
    counters: Object.assign({ ciksTooShort: null }, counters),
    cohorts,
    events: { total: events, withTodayTicker: eventsTickered, tickerMappableRate: events ? +(eventsTickered / events).toFixed(3) : null, byCalQuarter: eventsByQ },
  };
  fs.mkdirSync(path.dirname(OUT_BASE), { recursive: true });
  fs.writeFileSync(OUT_BASE + '.json', JSON.stringify(report, null, 2));
  const clusterQs = Object.keys(eventsByQ).length;
  const md = [
    '# B1 Discovery-Instrumentierung (' + new Date().toISOString().slice(0, 10) + ')',
    '', 'Protokoll: Tag 389, SHA-256 `7b20e750…cf0f79`. Scope: NUR ≤ ' + DISCOVERY_END + ' (§6). Keine Preise, keine Outcomes, Validation unberührt. Erkennung: geteilte lib/b1-detect.js.',
    '', '## Zählwerk', '',
    '| Größe | Wert |', '| --- | --- |',
    '| CIKs im Archiv ' + (limit ? '(LIMIT ' + limit + ')' : '') + ' | ' + counters.ciksTotal + ' |',
    '| davon geparst / ohne Umsatzserie | ' + counters.ciksParsed + ' / ' + counters.ciksNoRevenue + ' |',
    '| Firmen-Quartale evaluiert (≤2018) | ' + counters.firmQuartersEvaluated + ' |',
    '| davon auswertbar (ΔYoY(t) UND ΔYoY(t−1) definiert) | ' + counters.evaluable + ' |',
    '| YoY-/ΔYoY-Ausfälle | ' + counters.yoyUndefined + ' / ' + counters.dyoyUndefined + ' |',
    '| OpMargin undefiniert | ' + counters.opMarginUndefined + ' |',
    '| Punkte mit abgeleitetem Q4 beteiligt | ' + counters.derivedQ4Used + ' |',
    '| **Event-Kandidaten gesamt (§1-Kriterien)** | **' + events + '** |',
    '| davon heute ticker-mappbar (Preis-Chance) | ' + eventsTickered + ' (' + (events ? Math.round(100 * eventsTickered / events) : 0) + ' %) |',
    '| Kalenderquartale mit ≥1 Event (Cluster-Grundlage) | ' + clusterQs + ' |',
    '', '## Events je Kalenderquartal', '', '```json', JSON.stringify(eventsByQ, null, 1), '```',
    '', 'Kohorten-Detail (n, winsorisierte P90-Schwelle, belowMinN): siehe JSON.',
    '', 'Laufzeit: ' + runtimeSec + ' s.',
  ].join('\n');
  fs.writeFileSync(OUT_BASE + '.md', md);
  console.log('[b1-instrument] evaluable=' + counters.evaluable + ' events=' + events
    + ' tickerMappable=' + (events ? Math.round(100 * eventsTickered / events) : 0) + '%'
    + ' clusterQs=' + clusterQs + ' runtime=' + runtimeSec + 's');
  console.log('[b1-instrument] Report -> ' + OUT_BASE + '.{json,md}');
}

main();
