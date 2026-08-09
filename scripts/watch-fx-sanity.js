#!/usr/bin/env node
/**
 * Task 0.8 watcher #3: FX-corruption sanity check.
 * =================================================
 * s.marketCap.value is ALREADY USD-normalized (meta.fxConverted:true) — read
 * it directly, no re-conversion. Classify each snapshot US-primary vs foreign
 * via isUsPrimaryListing(s.meta) (src/scoring/router.js), count how many sit
 * over the market-cap floor for its bucket ($800M US-primary / $2B foreign —
 * matching MIN_MCAP_USD and the foreign floor used elsewhere in the pipeline),
 * and compare today's two counts against yesterday's (data-health/
 * fx-cap-count-baseline.json, keeps {last, prev}).
 *
 * Rationale: an FX-rate corruption doesn't move one ticker, it shoves an
 * entire country-cohort's USD-normalized mcap over/under the cap at once —
 * so a >25% day-over-day jump in the over-cap COUNT (not any single name) is
 * the signal.
 *
 * ::error:: on >25% day-over-day jump in either bucket's over-cap count.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('../lib/atomic-write.js');
const { isUsPrimaryListing } = require('../src/scoring/router.js');

const ROOT = path.join(__dirname, '..');
const SNAP_DIR = path.join(ROOT, 'snapshots');
const BASELINE_PATH = path.join(ROOT, 'data-health', 'fx-cap-count-baseline.json');
const CAP_US = 800e6;
const CAP_FOREIGN = 2e9;
const JUMP_THRESHOLD = 0.25;
// Die Baseline ist eine ZAEHL-Datei: genau diese zwei Felder liest checkJump, genau diese zwei
// duerfen hinein. Als Allowlist IN updateBaseline (nicht nur beim Aufrufer), sonst haengt die
// Reinheit der Datei daran, dass JEDER kuenftige Aufrufer daran denkt — so kamen Tag 520-522
// gescannt/parseFehler hinein, und mit dem gemeinsamen Scan (Tag 529) staende jetzt auch die
// Waehrungs-Tabelle drin. Waechter: tests/watch-fx-sanity-samedayrerun.test.js.
const BUCKETS = ['usOver', 'foreignOver'];

// Bekannte, bewusst nicht behobene Unschaerfe (Review-Notiz 03.08.2026): der Aufrufer prueft
// das Ergebnis mit `if (!s)`, also zaehlt eine Datei, die gueltiges JSON mit dem Inhalt
// false / 0 / null enthaelt, als Parse-Fehler. Praktisch irrelevant — ein Snapshot ist immer
// ein Objekt, und ein solcher Inhalt waere ohnehin ein Befund. Hier notiert statt gefixt,
// damit der naechste Leser nicht dieselbe Runde dreht.
function loadJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; }
}

function loadBaseline(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new Error(`FX-Baseline nicht lesbar (${e.message}) — Baseline wird NICHT ueberschrieben`);
  }
}

// ── Grenzen-Audit C-3 (03.08.2026): wurde ueberhaupt hartkodiert umgerechnet? ───────────
// Die Luecke, die das schliesst: pull-yahoo.js verwirft fx-rates.json ab FX_STALE_DAYS = 14
// KOMPLETT und rechnet mit der 2024er Hartkodierung weiter (INR bis 14,5 % daneben, still,
// mit fxConverted:true im Snapshot). Die CI wird aber erst ab > 30 Tagen hart rot (ab > 7
// nur Warnung) — 16 Tage stille Falschbewertung aller Nicht-USD-Titel.
//
// WARUM NICHT EINFACH DIE CI-SCHWELLE AUF 14 ZIEHEN: das waere eine zweite Kopie derselben
// Zahl (eine Konstante in JS, eine in YAML-Shell) und wuerde nur EINEN der Wege in die
// Hartkodierung sehen. Die anderen bleiben blind: fx-rates.json fehlt ganz (die CI warnt
// auch da nur), oder eine einzelne Waehrung fehlt im frischen Feed und faellt per
// FX_PROVENANCE auf die 2024er Zahl zurueck, obwohl die Datei tagesfrisch ist.
// meta.fxRateSource === 'hardcoded-fallback' (pull-yahoo.js, im Umrechnungs-Zweig gesetzt)
// steht genau dann im Snapshot, wenn wirklich mit einem hartkodierten Kurs gerechnet wurde
// — der Alarm haengt damit an der WIRKUNG, nicht am Dateialter, und braucht keinen eigenen
// Schwellwert.
//
// KEIN SCORING-WERT, reiner Betriebs-Waechter. Grundlast ausgezaehlt (nicht geschaetzt):
// im lokalen Bestand 0 von 4.768 Snapshots, bei 2.967 tatsaechlich umgerechneten — jedes
// Auftreten ist ein Ereignis. Deshalb Schwelle "mindestens einer", nicht "mehr als x %".
// Review-Nachzug (09.08.2026, Befund C): der Marker stand hier als eigenes Literal und in
// pull-yahoo.js als zweites — ein Dreher in einem der beiden haette diesen Alarm STUMM
// gestellt (exakter Zeichenvergleich, kein Test dagegen). Jetzt EINE Definition, importiert.
const { FX_MARKER_HARDCODED: HARDCODED_MARKER } = require('../pull-yahoo.js');

// Review-Nachzug (09.08.2026, Befund B): ab jetzt tragen Snapshots ZWEI Herkunfts-Felder,
// weil die beiden Beine zu verschiedenen Zeitpunkten neu bewertet werden —
//   fxRateSourceReporting: was der letzte VOLL-PULL gerechnet hat (annual/metrics/Kursziele
//     stehen bis heute so im Snapshot; heilt nur durch einen neuen Voll-Pull),
//   fxRateSourceTrading:   was der letzte PRICE-ONLY-Lauf fuer Preis/marketCap gerechnet hat
//     (wird jeden Lauf frisch gesetzt, heilt also von selbst zurueck auf live).
// ALTBESTAND: Snapshots von vor diesem Umbau tragen nur das alte Einzelfeld fxRateSource.
// Das wird nicht mehr geschrieben, hier aber weiter gelesen — sonst wuerde der Waechter
// beim Umstellungs-Tag schlagartig blind fuer alles, was noch keinen Voll-Pull hatte
// (bis zu 7 Tage). Ein Snapshot zaehlt genau EINMAL, egal wie viele der drei Felder den
// Marker tragen: gezaehlt werden betroffene Titel, nicht Marker-Vorkommen.
const MARKER_FELDER = ['fxRateSourceReporting', 'fxRateSourceTrading', 'fxRateSource'];
function istHartkodiert(meta) {
  return MARKER_FELDER.some((f) => meta[f] === HARDCODED_MARKER);
}

// ── EIN Durchgang, alle Zaehler (03.08.2026, Review-Befund HOCH) ───────────────────────
// Vorher liefen ZWEI getrennte Scans ueber dasselbe Verzeichnis (over-cap und
// hardcoded-Marker), und befunde() las Umfang + Parse-Fehler nur aus dem zweiten. Der
// PRIMAERE Zaehler — der Input des FX-Sprung-Alarms — meldete seinen Umfang nirgends hin.
// Aufgefallen ist das nie, weil beide Scans dasselbe Verzeichnis lasen und der eine den
// anderen zufaellig mit abdeckte; erzwungen war diese Deckungsgleichheit nirgends. Ein
// einziger Durchgang macht sie zur Bauart: der Umfang KANN nicht mehr divergieren, und die
// Haelfte der Datei-I/O faellt weg (4.768 Dateien wurden zweimal gelesen und geparst).
function scanSnapshots(snapDir) {
  const jeWaehrung = {};
  let usOver = 0, foreignOver = 0, n = 0, gescannt = 0, parseFehler = 0;
  if (!fs.existsSync(snapDir)) return { usOver, foreignOver, n, jeWaehrung, gescannt, parseFehler };
  const files = fs.readdirSync(snapDir).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
  for (const f of files) {
    gescannt++;
    const s = loadJson(path.join(snapDir, f), null);
    if (!s) { parseFehler++; continue; }
    const meta = s.meta || {};
    const mcap = s.marketCap && Number.isFinite(s.marketCap.value) ? s.marketCap.value : null;
    if (mcap !== null) {
      if (isUsPrimaryListing(meta)) {
        if (mcap >= CAP_US) usOver++;
      } else {
        if (mcap >= CAP_FOREIGN) foreignOver++;
      }
    }
    if (istHartkodiert(meta)) {
      n++;
      const ccy = meta.reportingCurrencyOriginal || '?';
      jeWaehrung[ccy] = (jeWaehrung[ccy] || 0) + 1;
    }
  }
  return { usOver, foreignOver, n, jeWaehrung, gescannt, parseFehler };
}
// Beide bisherigen Namen bleiben gueltig — sie zeigen jetzt auf denselben Durchgang.
const countOverCap = scanSnapshots;
const countHardcodedFallback = scanSnapshots;

// Alle Befunde eines Laufs an EINER Stelle — main() bleibt Ausgabe und Exit-Code.
// So ist der Weg vom Befund in Karls rotes X testbar, ohne den Waechter zu starten.
// EIN Scan-Objekt, EIN Umfang: `scan` traegt seit 03.08.2026 beide Sichten (over-cap UND
// hardcoded-Marker). Vorher nahm die Funktion zwei getrennte Objekte und pruefte Umfang und
// Parse-Fehler nur am zweiten — der Alarm-Input selbst blieb ungeprueft.
function befunde(scan, baseline) {
  if (!scan || typeof scan !== 'object') {
    return ['Kein Scan-Ergebnis uebergeben — der FX-Waechter kann nichts beurteilt haben. Kaputter Aufrufer, keine Gesundmeldung.'];
  }
  const problems = checkJump(scan, baseline);
  // Der Scan-Umfang ZUERST: ohne ihn ist jede Null-Meldung darunter bedeutungslos.
  if (!Number.isFinite(scan.gescannt)) {
    problems.push('Scan-Umfang unbekannt (kein gescannt-Zaehler uebergeben) — "0 Treffer" ist hier keine Entwarnung, sondern eine unbeantwortete Frage.');
  } else if (scan.gescannt === 0) {
    problems.push(`0 Snapshots gescannt (${SNAP_DIR} fehlt oder ist leer) — der FX-Waechter hat NICHTS geprueft. Seine Null-Zaehler sind kein Gesundheitszeugnis.`);
  }
  if (scan.parseFehler > 0) {
    problems.push(`${scan.parseFehler} Snapshot-Datei(en) nicht lesbar (JSON-Parse-Fehler) — sie fallen still aus jeder Zaehlung heraus. Grundlast im Bestand: 0, jedes Auftreten ist ein Ereignis.`);
  }
  if (scan.n > 0) {
    const nachWaehrung = Object.entries(scan.jeWaehrung || {})
      .sort((a, b) => b[1] - a[1])
      .map(([c, k]) => `${c}:${k}`)
      .join(', ');
    problems.push(`${scan.n} Snapshots wurden mit HARTKODIERTEN 2024er FX-Kursen umgerechnet (${nachWaehrung}) — fx-rates.json ist zu alt (> FX_STALE_DAYS in pull-yahoo.js), fehlt, oder deckt diese Waehrungen nicht ab. Die USD-Werte dieser Titel sind falsch (INR-Groessenordnung: bis 14,5 %).`);
  }
  return problems;
}

// BH-124: shared jump predicate — same condition checkJump alerts on, reused
// by updateBaseline() so an alarming bucket can be kept OUT of tomorrow's
// reference (see there).
function isBucketJump(todayVal, prevVal) {
  if (prevVal === null || prevVal === 0) return false; // no history yet, or nothing to jump from
  return Math.abs((todayVal - prevVal) / prevVal) > JUMP_THRESHOLD;
}

function checkJump(today, baseline) {
  const problems = [];
  for (const bucket of BUCKETS) {
    const prevVal = baseline && Number.isFinite(baseline.last && baseline.last[bucket]) ? baseline.last[bucket] : null;
    if (!isBucketJump(today[bucket], prevVal)) continue;
    const jump = (today[bucket] - prevVal) / prevVal;
    problems.push(`${bucket}: ${today[bucket]} vs yesterday ${prevVal} (${(jump * 100).toFixed(0)}%)`);
  }
  return problems;
}

// T2 sibling: checkJump always compares today against baseline.last, treating it
// as "yesterday's" counts. A same-day rerun (retry, manual re-run) previously
// shifted TODAY's own earlier-today counts into .last — so the next run's
// day-over-day comparison silently became intraday-vs-intraday, which can mask
// a real cross-day jump behind an already-corrupted intraday value (the .prev
// field this evicted into is never read by checkJump — a dead end, not a save).
// `date` (ISO day) tracks which calendar day .last currently holds; backward-
// compatible with existing baseline files lacking it (no match -> not a same-day
// rerun -> first post-fix run advances the pointer exactly like before).
function updateBaseline(baseline, today, dateStr) {
  const nurZaehlstaende = (o) => { const r = {}; for (const b of BUCKETS) r[b] = (o || {})[b]; return r; };
  if (baseline && baseline.date === dateStr) {
    // same-day rerun (Codex-Gegenreview Tag 353): .prev bleibt am WAHREN Vortag verankert,
    // aber .last nimmt den HEUTIGEN latest-Stand — ein Rerun korrigiert normalerweise den
    // ersten Lauf. Konsistent mit watch-exchange-coverage.js (replace-not-append = take latest).
    // Tradeoff: ein rein spurioser (nicht-korrigierender) Rerun kann einen fail-loud-Alarm am
    // Folgetag ausloesen (sicher); das Pinnen des ersten Werts wuerde stattdessen eine echte
    // Korrektur still verwerfen. BH-124's Freeze greift hier bewusst NICHT — ein Rerun IST
    // die Korrektur, kein zweiter unabhaengiger Tageswert.
    return { prev: (baseline.prev != null ? baseline.prev : null), last: nurZaehlstaende(today), date: dateStr, updatedAt: new Date().toISOString() };
  }
  // BH-124: a NEW calendar day's bucket that jumped >25% vs the reference must NOT
  // become tomorrow's reference — otherwise persistent corruption (100->50->50->...)
  // reads as a healthy 0% day-over-day move from the second alarm onward. Freeze
  // that bucket at its last known-good value; only a bucket that did NOT jump
  // advances normally.
  const prevLast = baseline && baseline.last ? baseline.last : {};
  const nextLast = {};
  for (const bucket of BUCKETS) {
    const prevVal = Number.isFinite(prevLast[bucket]) ? prevLast[bucket] : null;
    nextLast[bucket] = isBucketJump(today[bucket], prevVal) ? prevVal : today[bucket];
  }
  return {
    prev: baseline && baseline.last ? baseline.last : null,
    last: nextLast,
    date: dateStr,
    updatedAt: new Date().toISOString(),
  };
}

// Die letzte Zeile von main(), die kein Test je erreicht hat — als Funktion testbar.
// Kein Befund-Array = kaputter Aufrufer, das ist ein Fehler und keine Gesundmeldung.
function exitCodeFor(problems) {
  return (Array.isArray(problems) && problems.length === 0) ? 0 : 1;
}

function main() {
  const scan = scanSnapshots(SNAP_DIR); // EIN Durchgang: over-cap + C-3-Wirkungs-Anker
  console.log(`Gescannt: ${scan.gescannt} Snapshot-Dateien` + (scan.parseFehler ? `, davon ${scan.parseFehler} nicht lesbar` : ''));
  console.log(`Over-cap counts — US-primary (>=${CAP_US / 1e6}M): ${scan.usOver}, foreign (>=${CAP_FOREIGN / 1e9}B): ${scan.foreignOver}`);
  console.log(`Hartkodiert umgerechnet: ${scan.n} Snapshots` + (scan.n ? ` (${Object.entries(scan.jeWaehrung).sort((a, b) => b[1] - a[1]).map(([c, k]) => c + ':' + k).join(', ')})` : ''));

  const baseline = loadBaseline(BASELINE_PATH);
  const problems = befunde(scan, baseline);

  const dateStr = process.env.RUN_DATE_UTC || new Date().toISOString().slice(0, 10); // frozen run-date (prep) mit Wall-Clock-Fallback — Codex-Gegenreview Tag 353
  // NUR die zwei Zaehlstaende in die Baseline — sie ist eine Zaehl-Datei. Der same-day-rerun-
  // Zweig von updateBaseline uebernimmt `today` unveraendert; seit Tag 520 waren dadurch
  // gescannt/parseFehler mit hineingerutscht, mit dem gemeinsamen Scan kaeme jetzt auch noch
  // die Waehrungs-Tabelle mit. Die Projektion haelt die Datei bei dem, was checkJump liest.
  // Ein Lauf ohne beobachtete Snapshots darf den letzten Vergleichsanker nicht
  // durch zwei Null-Zaehler ersetzen.
  if (scan.gescannt > 0) {
    const nextBaseline = updateBaseline(baseline, { usOver: scan.usOver, foreignOver: scan.foreignOver }, dateStr);
    fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
    writeJsonAtomic(BASELINE_PATH, nextBaseline);
    console.log('Baseline updated: ' + BASELINE_PATH);
  } else console.error('::warning::FX-Baseline nicht aktualisiert: Scan hat nichts gesehen.');

  process.exitCode = exitCodeFor(problems);
  if (problems.length > 0) {
    console.error('::error::FX-sanity: ' + problems.join('; '));
    return;
  }
  console.log('No FX-sanity drift.');
}

if (require.main === module) {
  try { main(); }
  catch (e) { console.error('::error::watch-fx-sanity hat NICHT geprueft: ' + e.message); process.exitCode = 1; }
}

module.exports = { scanSnapshots, countOverCap, checkJump, updateBaseline, isBucketJump, countHardcodedFallback, befunde, exitCodeFor, istHartkodiert, HARDCODED_MARKER, MARKER_FELDER, loadBaseline };
