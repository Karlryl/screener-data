'use strict';
/**
 * scripts/b1-instrument.js — B1 Discovery-Instrumentierung (Protokoll §6, Tag 389,
 * SHA-256 7b20e750261ca5a6ede207064275d3934f11408565865477baced74ee0cf0f79).
 *
 * ERLAUBTER SCOPE (präregistriert): NUR Fiskalperioden mit Ende ≤ 2018-12-31
 * (Discovery). Reine Daten-Hygiene + Struktur-Deskription: Coverage, Ausfall-
 * Gründe, FY-Transition-Verluste, Kohorten-Größen je Kalenderquartal, winsorisierte
 * P90-Schwellen, Event-Kandidaten-Zählung + Kalenderquartal-Cluster-Histogramm,
 * Ticker-Mappbarkeits-Quote (Missingness-Schätzung für die Power-Analyse).
 * KEINE Preise, KEINE Outcomes, KEINE Validation-Quartale (>2018 wird übersprungen,
 * bevor irgendetwas gerechnet wird). Ändert NICHTS an Hypothese/Familie.
 *
 * PIT-treu: Für jedes Quartal t wird der Zustand asOf = filed(t) rekonstruiert
 * (pitSeries + abgeleitetes Q4), exakt wie der spätere konfirmatorische Lauf.
 *
 * Usage: node scripts/b1-instrument.js [--limit N]  (N CIKs, Smoke-Test)
 * Output: reports/b1-instrument-discovery-<datum>.json + .md
 */
const fs = require('fs');
const path = require('path');
const secPit = require('../lib/sec-pit.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_BASE = path.join(REPO_ROOT, 'reports', 'b1-instrument-discovery-2026-07-19');
const DISCOVERY_END = '2018-12-31';   // Protokoll §6
const WINSOR_LO = 0.01, WINSOR_HI = 0.99, EVENT_PCTL = 0.90; // Protokoll §1
const MIN_COHORT_N = 200;             // Protokoll §1

function calQuarter(endIso) { return endIso.slice(0, 4) + 'Q' + (Math.floor((+endIso.slice(5, 7) - 1) / 3) + 1); }
function quantileSorted(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

function main() {
  const args = process.argv.slice(2);
  const limIdx = args.indexOf('--limit');
  const limit = limIdx >= 0 ? parseInt(args[limIdx + 1], 10) : 0;

  const store = secPit.openStore();
  let tickerMap = null;
  try { tickerMap = secPit.loadTickerMap(); } catch (_) { /* Quote dann n/a */ }
  const cikHasTicker = new Set();
  if (tickerMap) for (const cik of tickerMap.values()) cikHasTicker.add(cik);

  // Zip-Einträge direkt über den Store-Index iterieren geht nicht (Kapselung) —
  // CIK-Liste aus dem Ticker-Index + Brute-Enumeration wäre lückenhaft für tote
  // CIKs. Daher: privates Verzeichnis über openStore-Erweiterung vermeiden und
  // stattdessen die Eintragsnamen scannen. ponytail: der Store kapselt das Central
  // Directory; hier einmalig neu geöffnet, um ALLE CIKs (inkl. tote) zu bekommen.
  const zlib = require('zlib');
  const zp = store.zipPath;
  const fd = fs.openSync(zp, 'r');
  const size = fs.fstatSync(fd).size;
  // EOCD/CD-Parser aus lib (nicht exportiert) — minimal nachgebaut via Modul-Reuse:
  // wir nutzen store.hasCik/factsForCik und enumerieren CIKs über das Manifest des
  // Zips: Eintragsnamen CIK##########.json. Dafür lesen wir das Central Directory
  // einmal selbst (gleiches Verfahren wie lib/sec-pit.js, dort dokumentiert).
  fs.closeSync(fd);
  // Einfachster verlässlicher Weg ohne Doppel-Parser: das companyfacts.zip trägt
  // die CIK-Liste in seinen Eintragsnamen; lib exportiert sie nicht, aber der
  // Store kann jeden CIK lesen. Wir enumerieren 1..2100000 NICHT (zu teuer),
  // sondern lesen die Namen über einen zweiten openStore-Blick: dessen entryCount
  // kennt die Zahl; die Namen holen wir über einen kleinen Inline-CD-Scan.
  const { names } = (() => {
    const fd2 = fs.openSync(zp, 'r');
    const sz = fs.fstatSync(fd2).size;
    const scan = Math.min(65557, sz);
    const tail = Buffer.alloc(scan);
    fs.readSync(fd2, tail, 0, scan, sz - scan);
    let cdOffset = null, cdSize = null;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
        cdOffset = tail.readUInt32LE(i + 16); cdSize = tail.readUInt32LE(i + 12);
        if (cdOffset === 0xFFFFFFFF || cdSize === 0xFFFFFFFF) {
          const locBuf = Buffer.alloc(20);
          fs.readSync(fd2, locBuf, 0, 20, (sz - scan) + i - 20);
          const eocd64Offset = Number(locBuf.readBigUInt64LE(8));
          const e64 = Buffer.alloc(56);
          fs.readSync(fd2, e64, 0, 56, eocd64Offset);
          cdSize = Number(e64.readBigUInt64LE(40)); cdOffset = Number(e64.readBigUInt64LE(48));
        }
        break;
      }
    }
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd2, cd, 0, cdSize, cdOffset);
    fs.closeSync(fd2);
    const out = [];
    let pos = 0;
    while (pos < cd.length - 4) {
      if (cd.readUInt32LE(pos) !== 0x02014b50) break;
      const fnLen = cd.readUInt16LE(pos + 28), extraLen = cd.readUInt16LE(pos + 30), commentLen = cd.readUInt16LE(pos + 32);
      out.push(cd.subarray(pos + 46, pos + 46 + fnLen).toString('utf8'));
      pos += 46 + fnLen + extraLen + commentLen;
    }
    return { names: out };
  })();
  let ciks = names.filter((n) => /^CIK\d{10}\.json$/.test(n)).map((n) => parseInt(n.slice(3, 13), 10));
  if (limit > 0) ciks = ciks.slice(0, limit);

  const counters = {
    ciksTotal: ciks.length, ciksParsed: 0, ciksNoRevenue: 0, ciksTooShort: 0,
    firmQuartersEvaluated: 0, yoyUndefined: 0, dyoyUndefined: 0, opMarginUndefined: 0,
    transitionDropped: 0, derivedQ4Used: 0, evaluable: 0,
  };
  const records = []; // {cik, end, calQ, filed, dYoY, dYoYprev, dOpMargin, derivedInvolved, hasTicker}
  const t0ms = Date.now();

  for (const cik of ciks) {
    let facts;
    try { facts = store.factsForCik(cik); } catch (_) { continue; }
    if (!facts) continue;
    counters.ciksParsed++;
    // Volle Serie (asOf=∞) NUR zur Enumeration der Discovery-Quartale.
    const fullRev = secPit.pitQuarterlyWithDerivedQ4(facts, secPit.REV_CONCEPTS, {});
    if (!fullRev.series.length) { counters.ciksNoRevenue++; continue; }
    const discoveryQs = fullRev.series.filter((p) => p.end <= DISCOVERY_END && p.filed);
    if (discoveryQs.length < 6) { counters.ciksTooShort++; continue; }
    const hasTicker = cikHasTicker.has(cik);
    for (const t of discoveryQs) {
      counters.firmQuartersEvaluated++;
      // PIT-Snapshot zum Erkennungs-Stichtag (filed von t)
      const rev = secPit.pitQuarterlyWithDerivedQ4(facts, secPit.REV_CONCEPTS, { asOf: t.filed });
      const S = rev.series;
      const tt = S.find((p) => p.end === t.end);
      if (!tt) continue;
      const idx = S.indexOf(tt);
      const tPrev = S[idx + 1];                    // Serie ist end-absteigend
      const tPrev2 = S[idx + 2];
      const p4 = secPit.yoyPartner(S, tt);
      const p4Prev = tPrev ? secPit.yoyPartner(S, tPrev) : null;
      const p4Prev2 = tPrev2 ? secPit.yoyPartner(S, tPrev2) : null;
      if (!p4 || !tPrev || !p4Prev || p4.val <= 0 || p4Prev.val <= 0) { counters.yoyUndefined++; continue; }
      const yoyT = tt.val / p4.val - 1;
      const yoyT1 = tPrev.val / p4Prev.val - 1;
      const dYoY = yoyT - yoyT1;
      let dYoYprev = null;
      if (tPrev2 && p4Prev2 && p4Prev2.val > 0) dYoYprev = yoyT1 - (tPrev2.val / p4Prev2.val - 1);
      if (dYoYprev === null) { counters.dyoyUndefined++; continue; }
      // Operating-Marge (gleicher Snapshot, exakte End-Matches)
      const op = secPit.pitQuarterlyWithDerivedQ4(facts, secPit.OP_INCOME_CONCEPTS, { asOf: t.filed });
      const opT = op.series.find((p) => p.end === tt.end);
      const opP4 = op.series.find((p) => p.end === p4.end);
      let dOpMargin = null;
      if (opT && opP4 && tt.val > 0 && p4.val > 0) dOpMargin = opT.val / tt.val - opP4.val / p4.val;
      if (dOpMargin === null) counters.opMarginUndefined++;
      const derivedInvolved = !!(tt.derived || (tPrev && tPrev.derived) || p4.derived || (p4Prev && p4Prev.derived));
      if (derivedInvolved) counters.derivedQ4Used++;
      counters.evaluable++;
      records.push({ cik, end: tt.end, calQ: calQuarter(tt.end), filed: t.filed, dYoY, dYoYprev, dOpMargin, derivedInvolved, hasTicker });
    }
  }
  store.close();

  // Pass B: je Kalenderquartal winsorisierte P90-Schwelle + Event-Kandidaten (Protokoll §1)
  const byQ = new Map();
  for (const r of records) { let a = byQ.get(r.calQ); if (!a) byQ.set(r.calQ, a = []); a.push(r); }
  const cohorts = {}; let events = 0; const eventsByQ = {}; let eventsTickered = 0;
  for (const [q, arr] of Array.from(byQ.entries()).sort()) {
    const vals = arr.map((r) => r.dYoY).sort((a, b) => a - b);
    const lo = quantileSorted(vals, WINSOR_LO), hi = quantileSorted(vals, WINSOR_HI);
    const wins = vals.map((v) => Math.min(hi, Math.max(lo, v))).sort((a, b) => a - b);
    const p90 = quantileSorted(wins, EVENT_PCTL);
    const n = arr.length;
    let ev = 0;
    if (n >= MIN_COHORT_N) {
      for (const r of arr) {
        const w = Math.min(hi, Math.max(lo, r.dYoY));
        if (w >= p90 && r.dYoY > 0 && r.dYoYprev > 0 && r.dOpMargin != null && r.dOpMargin > 0) {
          ev++; events++; if (r.hasTicker) eventsTickered++;
        }
      }
    }
    cohorts[q] = { n, p90: p90 != null ? +p90.toFixed(4) : null, belowMinN: n < MIN_COHORT_N, events: ev };
    if (ev) eventsByQ[q] = ev;
  }

  const runtimeSec = Math.round((Date.now() - t0ms) / 1000);
  const report = {
    generatedAt: new Date().toISOString(), protocol: 'protocol/b1-registered-20260719.md',
    protocolSha256: '7b20e750261ca5a6ede207064275d3934f11408565865477baced74ee0cf0f79',
    scope: 'Discovery <= ' + DISCOVERY_END + ' (Protokoll §6 — nur Instrumentierung)',
    limit: limit || null, runtimeSec, counters, cohorts,
    events: { total: events, withTodayTicker: eventsTickered, tickerMappableRate: events ? +(eventsTickered / events).toFixed(3) : null, byCalQuarter: eventsByQ },
  };
  fs.mkdirSync(path.dirname(OUT_BASE), { recursive: true });
  fs.writeFileSync(OUT_BASE + '.json', JSON.stringify(report, null, 2));
  const clusterQs = Object.keys(eventsByQ).length;
  const md = [
    '# B1 Discovery-Instrumentierung (' + new Date().toISOString().slice(0, 10) + ')',
    '', 'Protokoll: Tag 389, SHA-256 `7b20e750…cf0f79`. Scope: NUR ≤ ' + DISCOVERY_END + ' (§6). Keine Preise, keine Outcomes, Validation unberührt.',
    '', '## Zählwerk', '',
    '| Größe | Wert |', '| --- | --- |',
    '| CIKs im Archiv ' + (limit ? '(LIMIT ' + limit + ')' : '') + ' | ' + counters.ciksTotal + ' |',
    '| davon geparst / ohne Umsatzserie / zu kurz (<6 Discovery-Q) | ' + counters.ciksParsed + ' / ' + counters.ciksNoRevenue + ' / ' + counters.ciksTooShort + ' |',
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
