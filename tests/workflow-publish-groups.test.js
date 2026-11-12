'use strict';
/**
 * Guard: the three short workflows that push to main (weekly-guard, monthly-plan-check, exchange-quarters)
 * must not overlap with a hand start on a stale base, and a queued run must never cut off a running one.
 *
 * Finding (2026-11-01, monthly SEC run, fixed in monthly-sec-xbrl.yml and pinned by monthly-sec-concurrency.test.js):
 * a hand start that overlaps the schedule writes the same files from the same base; the second push's rebase
 * conflicts. These three workflows write the same file in every run (state/cadence-heartbeat.json field, the plan-check
 * report, the exchange-quarters store). Measured from run creation to end (gh run list, 2026-10-14 to 2026-11-04): weekly-guard
 * 1 to 2 minutes (3 runs), monthly-plan-check 1 minute (1 run), exchange-quarters median 6.7, mean 8.9, max 19.9 minutes (22 runs);
 * no hand start overlapped a run of the same workflow in those 26 runs (47 with daily-pull and monthly-sec-xbrl, 63 with
 * smallcap-pull), the one overlap on record is the SEC pair of 2026-11-01. The exposure is a window of
 * minutes; the fix costs four lines each. Two parts are pinned per workflow:
 *   1. the job carries its own concurrency group (main runs share one, other refs get one per run, never cancel);
 *   2. its Checkout names `ref: ${{ github.ref }}`, else actions/checkout pins github.sha (the commit current when
 *      the run was CREATED) and the waiting run would still build on the old base.
 * The workflow-level group is pinned unchanged: a hand start stays outside main-push on purpose (it must not cancel
 * another workflow's pending scheduled run).
 *
 * daily-pull.yml is deliberately NOT given such a group. Its "Commit Snapshots" step makes a conflict between two daily
 * runs loud on purpose ("Bei Konflikt bewusst ROT: die Daten des ersten Schreibers gewinnen"); a queued run that checks
 * out the new tip and then `git add -A`s its own snapshots would overwrite the first run's data silently (this holds for
 * runs that overlap; a hand start after a finished run overwrites the same-day snapshots today, which is no new case).
 * The gh-pages force pushes of the board deploys follow Commit Snapshots with `if: success()` and scoring needs merge, so
 * the loser of two overlapping runs fails at the rebase and publishes no boards; the fourth force push, the status marker of
 * job `laufstatus` (`if: always()`), is a known residual gap (a red marker over right boards), not touched here. That decision
 * is pinned below so a later copy of this pattern onto daily-pull.yml fails here first.
 *
 * Usage: node tests/workflow-publish-groups.test.js (exit 0/1). Reads the workflow files only.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').split('\r\n').join('\n');

const WORKFLOWS = [
  { file: 'weekly-guard', job: 'weekly-guard', prefix: 'weekly-guard',
    top: "  group: ${{ github.event_name == 'workflow_dispatch' && format('manual-{0}', github.run_id) || 'main-push' }}" },
  { file: 'monthly-plan-check', job: 'monthly-plan-check', prefix: 'monthly-plan-check',
    top: "  group: ${{ github.event_name == 'workflow_dispatch' && format('manual-{0}', github.run_id) || 'main-push' }}" },
  { file: 'exchange-quarters', job: 'fetch', prefix: 'exchange-quarters',
    top: "  group: ${{ github.event_name == 'schedule' && 'main-push' || format('manual-{0}', github.run_id) }}" },
  { file: 'hk-interims', job: 'fetch', prefix: 'hk-interims',
    top: "  group: ${{ github.event_name == 'schedule' && 'main-push' || format('manual-{0}', github.run_id) }}" },
];

/** @param {string} wf Workflow text. @param {string} job Job id. @returns {string} The lines of the job up to its `steps:`. */
function jobHead(wf, job) {
  const start = wf.indexOf(`\n  ${job}:\n`);
  assert.ok(start >= 0, `job ${job} not found`);
  const end = wf.indexOf('\n    steps:\n', start);
  assert.ok(end > start, `steps of job ${job} not found`);
  return wf.slice(start, end);
}

/** @param {string} wf Workflow text. @returns {string} The first checkout step with its `with:` lines, comments dropped. */
function checkoutStep(wf) {
  const start = wf.indexOf('\n      - uses: actions/checkout@');
  assert.ok(start >= 0, 'checkout step not found');
  const end = wf.indexOf('\n      - ', start + 10);
  assert.ok(end > start, 'end of checkout step not found');
  return wf.slice(start, end).split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
}

/** @param {string} head Job head. @returns {string[]} The two lines of the job-level concurrency block, comments ignored. */
function concurrencyBlock(head) {
  const lines = head.split('\n').filter(l => !/^\s*#/.test(l));
  const i = lines.findIndex(l => l === '    concurrency:');
  return i < 0 ? [] : lines.slice(i + 1, i + 3).map(l => l.replace(/^ {6}/, ''));
}

/** Throws unless the workflow holds both parts of the guard and the unchanged workflow-level group. */
function assertGuard(w, wf) {
  const group = `group: \${{ github.ref == 'refs/heads/main' && '${w.prefix}-main' || format('${w.prefix}-{0}', github.run_id) }}`;
  assert.deepEqual(concurrencyBlock(jobHead(wf, w.job)), [group, 'cancel-in-progress: false'],
    `${w.file}: the job needs exactly: main runs share one group, other refs get a group per run, a queued run never cancels a running one`);
  assert.match(checkoutStep(wf), /\n {10}ref: \$\{\{ github\.ref \}\}( {2}#.*)?(\n|$)/,
    `${w.file}: Checkout must name ref: \${{ github.ref }}, else the waiting run builds on the commit current at its creation`);
  assert.ok(wf.includes(`\nconcurrency:\n${w.top}\n  cancel-in-progress: false\n`), `${w.file}: the workflow-level group changed`);
}

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

for (const w of WORKFLOWS) {
  const wf = read(`.github/workflows/${w.file}.yml`);
  check(`${w.file}: job-level group and Checkout ref hold`, () => assertGuard(w, wf));
  check(`${w.file}: the guard itself catches each breakage`, () => {
    const g = `'${w.prefix}-main'`, o = `format('${w.prefix}-{0}', github.run_id)`;
    const broken = {
      'block removed': wf.replace(/\n {4}concurrency:\n {6}group:.*\n {6}cancel-in-progress: false/, ''),
      'cancel-in-progress true': wf.replace(/( {6}group: \$\{\{ github\.ref ==.*\n {6}cancel-in-progress: )false/, '$1true'),
      'one group for every ref': wf.replace(/ {6}group: \$\{\{ github\.ref == .*\}\}/, `      group: ${w.prefix}-main`),
      'ref test dropped': wf.replace("github.ref == 'refs/heads/main' &&", 'true &&'),
      'branches swapped': wf.replace(`&& ${g} || ${o}`, `&& ${o} || ${g}`),
      'condition negated': wf.replace("${{ github.ref == 'refs/heads/main' &&", "${{ github.ref != 'refs/heads/main' &&"),
      'block only in a comment': wf.replace('\n    concurrency:\n', '\n    # concurrency:\n'),
      'checkout ref removed': wf.replace(/ {8}with:\n {10}ref: \$\{\{ github\.ref \}\}.*\n/, ''),
      'checkout ref points at the creation commit': wf.replace('ref: ${{ github.ref }}  #', 'ref: ${{ github.sha }}  #'),
      'workflow-level group touched': wf.replace('\nconcurrency:\n  group: ', '\nconcurrency:\n  group: x-'),
    };
    for (const [name, text] of Object.entries(broken)) {
      assert.notEqual(text, wf, `the breakage did not change the text: ${name}`);
      assert.throws(() => assertGuard(w, text), undefined, `not caught: ${name}`);
    }
  });
}

check('daily-pull.yml keeps its loud conflict on purpose: no job group on the pushing jobs, the "bewusst ROT" rule stands', () => {
  const wf = read('.github/workflows/daily-pull.yml');
  for (const job of ['prep', 'merge', 'scoring']) {
    assert.deepEqual(concurrencyBlock(jobHead(wf, job)), [], `daily-pull job ${job} got a job-level group: a queued second run would overwrite the first run's snapshots silently`);
  }
  assert.ok(wf.includes('Bei Konflikt bewusst ROT: die Daten des ersten Schreibers gewinnen'), 'the rule that a conflict between two daily runs stays loud is gone');
  const code = wf.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
  assert.ok(!/(--strategy-option[ =]theirs|-X ?theirs)\b/.test(code), 'a rebase strategy that accepts the other side would make the conflict silent');
  // the guard on that guard: the pattern sees the forms a rebase line can take (mid-line, short option) and ignores comments
  const silent = /(--strategy-option[ =]theirs|-X ?theirs)\b/;
  for (const form of ['git rebase --autostash --strategy-option theirs origin/main', 'git rebase -X theirs --autostash origin/main', 'git rebase -Xtheirs origin/main', 'git rebase --strategy-option=theirs origin/main']) {
    assert.ok(silent.test(form), 'not recognised: ' + form);
  }
  assert.ok(!silent.test('git rebase --autostash origin/main'), 'the plain rebase must pass');
});

console.log(`workflow-publish-groups: ${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
