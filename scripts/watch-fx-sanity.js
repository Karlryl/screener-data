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

function loadJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; }
}

function countOverCap(snapDir) {
  let usOver = 0, foreignOver = 0;
  if (!fs.existsSync(snapDir)) return { usOver, foreignOver };
  const files = fs.readdirSync(snapDir).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
  for (const f of files) {
    const s = loadJson(path.join(snapDir, f), null);
    if (!s) continue;
    const mcap = s.marketCap && Number.isFinite(s.marketCap.value) ? s.marketCap.value : null;
    if (mcap === null) continue;
    const meta = s.meta || {};
    if (isUsPrimaryListing(meta)) {
      if (mcap >= CAP_US) usOver++;
    } else {
      if (mcap >= CAP_FOREIGN) foreignOver++;
    }
  }
  return { usOver, foreignOver };
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
const HARDCODED_MARKER = 'hardcoded-fallback';
function countHardcodedFallback(snapDir) {
  const jeWaehrung = {};
  let n = 0;
  if (!fs.existsSync(snapDir)) return { n, jeWaehrung };
  for (const f of fs.readdirSync(snapDir).filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
    const s = loadJson(path.join(snapDir, f), null);
    if (!s || !s.meta || s.meta.fxRateSource !== HARDCODED_MARKER) continue;
    n++;
    const ccy = s.meta.reportingCurrencyOriginal || '?';
    jeWaehrung[ccy] = (jeWaehrung[ccy] || 0) + 1;
  }
  return { n, jeWaehrung };
}

// Alle Befunde eines Laufs an EINER Stelle — main() bleibt Ausgabe und Exit-Code.
// So ist der Weg vom Befund in Karls rotes X testbar, ohne den Waechter zu starten.
function befunde(today, baseline, hardcoded) {
  const problems = checkJump(today, baseline);
  if (hardcoded && hardcoded.n > 0) {
    const nachWaehrung = Object.entries(hardcoded.jeWaehrung)
      .sort((a, b) => b[1] - a[1])
      .map(([c, k]) => `${c}:${k}`)
      .join(', ');
    problems.push(`${hardcoded.n} Snapshots wurden mit HARTKODIERTEN 2024er FX-Kursen umgerechnet (${nachWaehrung}) — fx-rates.json ist zu alt (> FX_STALE_DAYS in pull-yahoo.js), fehlt, oder deckt diese Waehrungen nicht ab. Die USD-Werte dieser Titel sind falsch (INR-Groessenordnung: bis 14,5 %).`);
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
  for (const bucket of ['usOver', 'foreignOver']) {
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
  if (baseline && baseline.date === dateStr) {
    // same-day rerun (Codex-Gegenreview Tag 353): .prev bleibt am WAHREN Vortag verankert,
    // aber .last nimmt den HEUTIGEN latest-Stand — ein Rerun korrigiert normalerweise den
    // ersten Lauf. Konsistent mit watch-exchange-coverage.js (replace-not-append = take latest).
    // Tradeoff: ein rein spurioser (nicht-korrigierender) Rerun kann einen fail-loud-Alarm am
    // Folgetag ausloesen (sicher); das Pinnen des ersten Werts wuerde stattdessen eine echte
    // Korrektur still verwerfen. BH-124's Freeze greift hier bewusst NICHT — ein Rerun IST
    // die Korrektur, kein zweiter unabhaengiger Tageswert.
    return { prev: (baseline.prev != null ? baseline.prev : null), last: today, date: dateStr, updatedAt: new Date().toISOString() };
  }
  // BH-124: a NEW calendar day's bucket that jumped >25% vs the reference must NOT
  // become tomorrow's reference — otherwise persistent corruption (100->50->50->...)
  // reads as a healthy 0% day-over-day move from the second alarm onward. Freeze
  // that bucket at its last known-good value; only a bucket that did NOT jump
  // advances normally.
  const prevLast = baseline && baseline.last ? baseline.last : {};
  const nextLast = {};
  for (const bucket of ['usOver', 'foreignOver']) {
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

function main() {
  const today = countOverCap(SNAP_DIR);
  console.log(`Over-cap counts — US-primary (>=${CAP_US / 1e6}M): ${today.usOver}, foreign (>=${CAP_FOREIGN / 1e9}B): ${today.foreignOver}`);

  const hardcoded = countHardcodedFallback(SNAP_DIR); // C-3: Wirkungs-Anker, kein Alters-Schwellwert
  console.log(`Hartkodiert umgerechnet: ${hardcoded.n} Snapshots` + (hardcoded.n ? ` (${Object.entries(hardcoded.jeWaehrung).sort((a, b) => b[1] - a[1]).map(([c, k]) => c + ':' + k).join(', ')})` : ''));

  const baseline = loadJson(BASELINE_PATH, null);
  const problems = befunde(today, baseline, hardcoded);

  const dateStr = process.env.RUN_DATE_UTC || new Date().toISOString().slice(0, 10); // frozen run-date (prep) mit Wall-Clock-Fallback — Codex-Gegenreview Tag 353
  const nextBaseline = updateBaseline(baseline, today, dateStr);
  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
  writeJsonAtomic(BASELINE_PATH, nextBaseline);
  console.log('Baseline updated: ' + BASELINE_PATH);

  if (problems.length > 0) {
    console.error('::error::FX-sanity: ' + problems.join('; '));
    process.exitCode = 1;
    return;
  }
  console.log('No FX-sanity drift.');
}

if (require.main === module) main();

module.exports = { countOverCap, checkJump, updateBaseline, isBucketJump, countHardcodedFallback, befunde };
