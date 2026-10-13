'use strict';
/**
 * F-24: consecutive clean scheduled daily-pull days for Karl's briefing.
 *
 * Clean signal: a committed board-history/<UTC date>/ directory AND a completed,
 * successful daily-pull run with event=schedule whose createdAt falls on that UTC date.
 * Approximation: board-history has no workflow-run ID, so the association is date-based.
 * workflow_dispatch never counts. Sunday and Monday are not planned run days.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { writeFileAtomic, writeJsonAtomic } = require('../lib/atomic-write.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const REPO = 'Karlryl/screener-data';
const TARGET = 14;
const CRON_MINUTES_UTC = 2 * 60 + 17;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function toDate(value) {
  const d = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(d.getTime())) throw new Error('ungueltiger Zeitpunkt: ' + value);
  return d;
}

function isoDay(value) {
  return toDate(value).toISOString().slice(0, 10);
}

function dateFromDay(day) {
  if (!ISO_DAY.test(day)) throw new Error('ungueltiges ISO-Datum: ' + day);
  return toDate(day + 'T00:00:00Z');
}

function isPlannedRunDay(value) {
  const weekday = toDate(value).getUTCDay();
  return weekday >= 2 && weekday <= 6;
}

function previousPlannedDay(day) {
  const d = dateFromDay(day);
  do d.setUTCDate(d.getUTCDate() - 1); while (!isPlannedRunDay(d));
  return isoDay(d);
}

function latestDuePlannedDay(asOf = new Date()) {
  const now = toDate(asOf);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (isPlannedRunDay(d) && minutes < CRON_MINUTES_UTC) d.setUTCDate(d.getUTCDate() - 1);
  while (!isPlannedRunDay(d)) d.setUTCDate(d.getUTCDate() - 1);
  return isoDay(d);
}

function cleanDays(boardDates, runs) {
  const boards = new Set(boardDates.filter((day) => ISO_DAY.test(day)));
  const clean = new Set();
  for (const run of runs) {
    if (run.event !== 'schedule' || run.status !== 'completed' || run.conclusion !== 'success') continue;
    const day = isoDay(run.createdAt);
    if (boards.has(day)) clean.add(day);
  }
  return clean;
}

function calculateStreak({ boardDates, runs, asOf = new Date() }) {
  const clean = cleanDays(boardDates, runs);
  const tage = [];
  let day = latestDuePlannedDay(asOf);
  while (clean.has(day)) {
    tage.push(day);
    day = previousPlannedDay(day);
  }
  tage.reverse();
  return { streak: tage.length, ziel: TARGET, tage };
}

function formatLine(result) {
  // Praezisierung 30.08.2026 vor der Landung: die Zaehlung ist eine NOTWENDIGE, nicht die
  // hinreichende Bedingung. Ueber F-16 liegt bis zur Gerichts-Wiedervorlage Ende Oktober
  // eine stehende Sperre; ein erreichter Zaehlerstand hebt sie NICHT auf. Der alte Satz
  // ("Kette kann fortgesetzt werden") haette Karl genau das Gegenteil gesagt.
  const continuation = result.streak >= result.ziel
    ? ' Zaehl-Bedingung fuer F-16 erfuellt — die Sperre bleibt bis zur Gerichts-Wiedervorlage.'
    : '';
  return `${result.streak} von ${result.ziel} planmäßigen Lauftagen in Folge sauber.${continuation}`;
}

function readBoardDates(ref) {
  if (ref === 'origin/main') {
    execFileSync('git', ['-C', REPO_ROOT, 'fetch', 'origin', 'main', '--quiet']);
  }
  const out = execFileSync('git', [
    '-C', REPO_ROOT, 'ls-tree', '-d', '--name-only', `${ref}:board-history`,
  ], { encoding: 'utf8' });
  return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

function readRuns() {
  const out = execFileSync('gh', [
    'run', 'list', '-R', REPO, '--workflow', 'daily-pull.yml', '--event', 'schedule',
    '--limit', '100', '--json', 'databaseId,event,status,conclusion,createdAt,url',
  ], { encoding: 'utf8' });
  return JSON.parse(out);
}

function parseArgs(argv) {
  const opts = { asOf: new Date(), ref: 'origin/main' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--as-of' && argv[i + 1]) opts.asOf = toDate(argv[++i]);
    else if (argv[i] === '--ref' && argv[i + 1]) opts.ref = argv[++i];
    else throw new Error('usage: node scripts/f24-streak.js [--as-of <ISO>] [--ref <git-ref>]');
  }
  return opts;
}

function writeArtifacts(result, asOf) {
  const reports = path.join(REPO_ROOT, 'reports');
  fs.mkdirSync(reports, { recursive: true });
  const artifact = {
    streak: result.streak,
    ziel: result.ziel,
    tage: result.tage,
    stand_utc: toDate(asOf).toISOString(),
    letzter_plan_tag: latestDuePlannedDay(asOf),
    f16_hinweis: result.streak >= result.ziel
      ? 'Zaehl-Bedingung fuer F-16 erfuellt — die stehende Sperre bleibt bis zur Gerichts-Wiedervorlage bestehen.'
      : null,
    signal: 'committed board-history/<UTC-Datum>/ + daily-pull event=schedule, status=completed, conclusion=success am selben UTC-Datum',
    naeherung: 'Zuordnung mangels Workflow-Run-ID im Board-Artefakt ueber createdAt-UTC-Datum des Laufs',
  };
  writeJsonAtomic(path.join(reports, 'f24-streak.json'), artifact, { indent: 2 });
  writeFileAtomic(path.join(reports, 'f24-streak.md'), formatLine(result) + '\n');
  return artifact;
}

module.exports = {
  calculateStreak,
  cleanDays,
  formatLine,
  isPlannedRunDay,
  latestDuePlannedDay,
  previousPlannedDay,
};

if (require.main === module) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const result = calculateStreak({
      boardDates: readBoardDates(opts.ref),
      runs: readRuns(),
      asOf: opts.asOf,
    });
    writeArtifacts(result, opts.asOf);
    console.log(formatLine(result));
    console.log('Tage: ' + (result.tage.join(', ') || 'keine'));
  } catch (err) {
    console.error('f24-streak: ' + err.message);
    process.exit(1);
  }
}
