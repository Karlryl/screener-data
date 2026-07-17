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

function checkJump(today, baseline) {
  const problems = [];
  for (const bucket of ['usOver', 'foreignOver']) {
    const prevVal = baseline && Number.isFinite(baseline.last && baseline.last[bucket]) ? baseline.last[bucket] : null;
    if (prevVal === null || prevVal === 0) continue; // no history yet, or nothing to jump from
    const jump = (today[bucket] - prevVal) / prevVal;
    if (Math.abs(jump) > JUMP_THRESHOLD) {
      problems.push(`${bucket}: ${today[bucket]} vs yesterday ${prevVal} (${(jump * 100).toFixed(0)}%)`);
    }
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
    return { ...baseline, updatedAt: new Date().toISOString() }; // same day: pin prev/last
  }
  return {
    prev: baseline && baseline.last ? baseline.last : null,
    last: today,
    date: dateStr,
    updatedAt: new Date().toISOString(),
  };
}

function main() {
  const today = countOverCap(SNAP_DIR);
  console.log(`Over-cap counts — US-primary (>=${CAP_US / 1e6}M): ${today.usOver}, foreign (>=${CAP_FOREIGN / 1e9}B): ${today.foreignOver}`);

  const baseline = loadJson(BASELINE_PATH, null);
  const problems = checkJump(today, baseline);

  const dateStr = new Date().toISOString().slice(0, 10);
  const nextBaseline = updateBaseline(baseline, today, dateStr);
  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
  writeJsonAtomic(BASELINE_PATH, nextBaseline);
  console.log('Baseline updated: ' + BASELINE_PATH);

  if (problems.length > 0) {
    console.error('::error::FX-sanity — day-over-day over-cap count jump: ' + problems.join('; '));
    process.exitCode = 1;
    return;
  }
  console.log('No FX-sanity drift.');
}

if (require.main === module) main();

module.exports = { countOverCap, checkJump, updateBaseline };
