'use strict';
// Guard: one run day for every job of the daily run and of the small-cap pull (Codex R17 on d89bc011d4, midnight probe).
//
// The stale-price gate ages a quote against the run day. Pull, preparation, export and --check run in different jobs and
// processes; read from each process's own clock they can straddle 00:00 UTC and disagree, and --check then refuses an
// unchanged list. The day is frozen once in job `prep` and every other job reads it from there.
// This test reads the workflow files themselves (block pattern of tests/zweig-wache.test.js):
//   presence - each job except prep sets RUN_DATE_UTC at job level from prep's output: directly (it needs prep), or relayed by
//              a job it needs whose own output run_date is prep's (scoring relays it to the two jobs pinned to `needs: scoring`);
//              prep freezes it from the UTC clock exactly once
//   absence  - no other place assigns RUN_DATE_UTC (no step env, no shell assignment, no $GITHUB_ENV write)
// Break-once on every start, on the file text in memory: a job without the env line, a job without prep in needs and a
// step that sets its own day must each be caught. Nothing is written.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const FILES = ['daily-pull.yml', 'smallcap-pull.yml'];
const ENV_LINE = '      RUN_DATE_UTC: ${{ needs.prep.outputs.run_date }}';

/** Splits the jobs section into {name, lines} blocks by their two-space key. */
function jobs(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.indexOf('jobs:');
  assert.ok(start >= 0, 'jobs section');
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^  ([A-Za-z0-9_-]+):\s*$/.exec(lines[i]);
    if (m) out.push({ name: m[1], lines: [] });
    else if (out.length) out[out.length - 1].lines.push(lines[i]);
  }
  return out;
}

function faults(text) {
  const errs = [];
  const all = jobs(text);
  const relays = new Set(all.filter(j => j.lines.includes('      run_date: ${{ needs.prep.outputs.run_date }}') && j.lines.includes('    outputs:')).map(j => j.name));
  for (const job of all) {
    const needs = job.lines.find(l => /^    needs: /.test(l));
    const list = needs ? needs.replace(/^    needs: /, '').replace(/[[\]\s]/g, '').split(',') : [];
    const envAt = job.lines.indexOf('    env:');
    const jobEnv = [];
    for (let i = envAt + 1; envAt >= 0 && i < job.lines.length && /^      \S/.test(job.lines[i]); i++) jobEnv.push(job.lines[i]);
    if (job.name === 'prep') {
      if (job.lines.filter(l => /RUN_DATE_UTC=\$\(date -u \+%Y-%m-%d\)|run_date=\$\(date -u \+%Y-%m-%d\)/.test(l)).length !== 1) errs.push('prep: run day not frozen exactly once from the UTC clock');
      continue;
    }
    const relay = list.find(n => relays.has(n) && jobEnv.includes('      RUN_DATE_UTC: ${{ needs.' + n + '.outputs.run_date }}'));
    if (!relay && !list.includes('prep')) errs.push(`${job.name}: does not need prep`);
    if (!relay && !jobEnv.includes(ENV_LINE)) errs.push(`${job.name}: no job-level RUN_DATE_UTC from prep`);
    // Any other assignment inside the job: a step env key, a shell assignment or an export into $GITHUB_ENV.
    for (const l of job.lines) {
      if (l === ENV_LINE || (relay && l === '      RUN_DATE_UTC: ${{ needs.' + relay + '.outputs.run_date }}')) continue;
      if (/^\s*#/.test(l)) continue;
      if (/\bRUN_DATE_UTC\s*:/.test(l) || /\b(export\s+)?RUN_DATE_UTC=/.test(l) || /RUN_DATE_UTC=.*GITHUB_ENV|GITHUB_ENV.*RUN_DATE_UTC/.test(l)) errs.push(`${job.name}: sets its own run day: ${l.trim().slice(0, 80)}`);
    }
  }
  return errs;
}

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message); }
}
const text = Object.fromEntries(FILES.map(f => [f, fs.readFileSync(path.join(ROOT, '.github/workflows', f), 'utf8')]));

for (const f of FILES) check(`${f}: every job reads the one run day of prep, nobody sets another`, () => assert.deepEqual(faults(text[f]), []));
check('daily-pull.yml: the run day reaches the scoring job, which runs preparation, export and --check', () => {
  const scoring = jobs(text['daily-pull.yml']).find(j => j.name === 'scoring');
  assert.ok(scoring.lines.some(l => l.includes('node scripts/write-findash-export.js --check')), 'scoring runs --check');
  assert.ok(scoring.lines.includes(ENV_LINE));
});
check('break-once: a job without the env line, without prep in needs, or with a step of its own day is caught', () => {
  const d = text['daily-pull.yml'];
  const lines = d.split('\n');
  const scoringAt = lines.indexOf('  scoring:');
  const envAt = lines.findIndex((l, i) => i > scoringAt && l === ENV_LINE);
  assert.ok(scoringAt > 0 && envAt > scoringAt, 'scoring env line');
  const noEnv = lines.filter((_, i) => i !== envAt).join('\n');
  assert.ok(faults(noEnv).some(e => e.startsWith('scoring: no job-level RUN_DATE_UTC')), 'missing env not caught');
  const needsAt = lines.findIndex((l, i) => i > scoringAt && /^    needs: /.test(l));
  const noPrep = lines.map((l, i) => (i === needsAt ? l.replace('prep, ', '') : l)).join('\n');
  assert.ok(faults(noPrep).some(e => e === 'scoring: does not need prep'), 'missing prep not caught');
  const stepAt = lines.findIndex((l, i) => i > scoringAt && /^      - name: /.test(l));
  const own = lines.slice(0, stepAt + 1).concat(['        env:', '          RUN_DATE_UTC: 2026-11-04'], lines.slice(stepAt + 1)).join('\n');
  assert.ok(faults(own).some(e => e.startsWith('scoring: sets its own run day')), 'step day not caught');
  // The relay line exists once, in the scoring job's outputs; without it the jobs behind scoring have no frozen day.
  assert.equal(lines.filter(l => l === '      run_date: ${{ needs.prep.outputs.run_date }}').length, 1, 'one relay line');
  const noRelay = lines.filter(l => l !== '      run_date: ${{ needs.prep.outputs.run_date }}').join('\n');
  assert.ok(faults(noRelay).some(e => e === 'druckenmiller-guard: no job-level RUN_DATE_UTC from prep'), 'missing relay not caught');
});

console.log(`run-date-wiring: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
