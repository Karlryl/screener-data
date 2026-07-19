#!/usr/bin/env node
/**
 * Task 0.8 watcher #2: unrouted-share + new-taxonomy-label canary.
 * =================================================================
 * Runs route() from src/scoring/router.js over every snapshots/*.json and:
 *   1. computes the 'no-sector' (unrouted) share over the ROUTABLE denominator
 *      only — action==='exclude' && reason==='non-us' is EXCLUDED from both
 *      numerator and denominator (foreign names are excluded by design, not
 *      a defect; mixing them in would make the % swing on universe mix, not
 *      on genuine taxonomy drift).
 *   2. collects every meta.industry / meta.sector label seen today and flags
 *      any NOT in the baseline label set — the actual canary for a Yahoo
 *      taxonomy rename (a rename would immediately no-sector everything under
 *      the old label AND introduce an unseen new label; the label diff catches
 *      it even before the % crosses the threshold).
 *
 * ::error:: when no-sector share > 10% of routable, OR any new label appears.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('../lib/atomic-write.js');
const { route } = require('../src/scoring/router.js');

const ROOT = path.join(__dirname, '..');
const SNAP_DIR = path.join(ROOT, 'snapshots');
const BASELINE_PATH = path.join(ROOT, 'data-health', 'unrouted-labels-baseline.json');
const NO_SECTOR_THRESHOLD = 0.10;

function loadJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; }
}

function scanSnapshots(snapDir) {
  const labels = new Set();
  let routable = 0;
  let noSector = 0;
  if (!fs.existsSync(snapDir)) return { routable, noSector, labels };
  const files = fs.readdirSync(snapDir).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
  for (const f of files) {
    const s = loadJson(path.join(snapDir, f), null);
    if (!s) continue;
    let result;
    try { result = route(s); } catch (e) { continue; } // ponytail: malformed snapshot, skip — coverage-gate already guards overall corpus health
    if (result.action === 'exclude' && result.reason === 'non-us') continue; // by design, not routable
    routable++;
    if (result.action === 'exclude' && result.reason === 'no-sector') noSector++;
    const m = s.meta || {};
    if (m.industry) labels.add('industry:' + m.industry);
    if (m.sector) labels.add('sector:' + m.sector);
  }
  return { routable, noSector, labels };
}

// Grow-only union so a single day's missing label (e.g. a sector absent from
// today's partial pull) never gets treated as "new" tomorrow.
// BH-125: a genuinely NEW (not-yet-baselined) label must NOT enter the union in
// the SAME run that flags it — merging it immediately clears the alarm (next
// run's baselineSet already contains it -> newLabels=[] -> a real Yahoo taxonomy
// rename goes silent after one warning). Only merge labels already known, or
// everything on a true first-ever run (baseline null — nothing to alarm on yet).
function mergeLabels(baselineLabels, todayLabels, baselineExists) {
  const baselineSet = new Set(baselineLabels);
  const labelsToMerge = baselineExists ? todayLabels.filter((l) => baselineSet.has(l)) : todayLabels;
  return Array.from(new Set([...baselineLabels, ...labelsToMerge])).sort();
}

function main() {
  const { routable, noSector, labels } = scanSnapshots(SNAP_DIR);
  const share = routable > 0 ? noSector / routable : 0;
  console.log(`Routable: ${routable}, no-sector: ${noSector} (${(share * 100).toFixed(1)}%)`);

  const baseline = loadJson(BASELINE_PATH, null);
  const baselineLabels = baseline && Array.isArray(baseline.labels) ? baseline.labels : [];
  const baselineSet = new Set(baselineLabels);
  const todayLabels = Array.from(labels).sort();
  const newLabels = todayLabels.filter((l) => !baselineSet.has(l));

  const mergedLabels = mergeLabels(baselineLabels, todayLabels, !!baseline);
  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
  writeJsonAtomic(BASELINE_PATH, { labels: mergedLabels, updatedAt: new Date().toISOString() });
  console.log('Baseline updated: ' + BASELINE_PATH + ' (' + mergedLabels.length + ' known labels)');

  const problems = [];
  if (routable > 0 && share > NO_SECTOR_THRESHOLD) {
    problems.push(`no-sector share ${(share * 100).toFixed(1)}% > ${(NO_SECTOR_THRESHOLD * 100).toFixed(0)}% of routable`);
  }
  if (baseline && newLabels.length > 0) {
    // Only flag as new once a baseline actually exists (first run is seeding).
    problems.push(`new industry/sector label(s) not in baseline: ${newLabels.join(', ')}`);
  }

  if (problems.length > 0) {
    console.error('::error::Unrouted-quote canary — ' + problems.join('; '));
    process.exitCode = 1;
    return;
  }
  console.log('No unrouted/taxonomy drift.');
}

if (require.main === module) main();

module.exports = { scanSnapshots, mergeLabels };
