'use strict';
/**
 * Guard: two runs of the monthly SEC workflow on main must not overlap on a stale base, and a queued run
 * must never cut off a running one.
 *
 * Finding (2026-11-01): run 41317263548 (schedule, created 14:39Z) failed at "Commit manifest" because a hand
 * start (run 41316536068, 14:30Z) had pushed external-data/sec-xbrl/_manifest.json at 14:47Z; the scheduled
 * run had checked out the commit current at its creation, rebuilt the manifest on that base, and its rebase
 * conflicted on the regenerated file on all three attempts. Two things are needed and both are pinned here:
 *   1. the job `pull` carries its own concurrency group, so the second run waits for the first;
 *   2. its Checkout names `ref: ${{ github.ref }}`; without `ref`, actions/checkout pins github.sha (the
 *      commit current when the run was CREATED), so the waiting run would still build on the old base.
 *
 * The guard reads the workflow file because the fault shows only there. Usage: node tests/monthly-sec-concurrency.test.js (exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').split('\r\n').join('\n');

const GROUP = "group: ${{ github.ref == 'refs/heads/main' && 'monthly-sec-xbrl-main' || format('monthly-sec-xbrl-{0}', github.run_id) }}";

/** @param {string} wf Workflow text. @returns {string} The lines of the `pull` job up to its first step block end. */
function jobHead(wf) {
  const start = wf.indexOf('\n  pull:\n');
  assert.ok(start >= 0, 'job pull not found');
  const end = wf.indexOf('\n    steps:\n', start);
  assert.ok(end > start, 'steps of job pull not found');
  return wf.slice(start, end);
}

/** @param {string} wf Workflow text. @returns {string} The text of the Checkout step. */
function checkoutStep(wf) {
  const start = wf.indexOf('\n      - name: Checkout\n');
  assert.ok(start >= 0, 'step Checkout not found');
  const end = wf.indexOf('\n      - name:', start + 10);
  assert.ok(end > start, 'end of step Checkout not found');
  return wf.slice(start, end);
}

/** @param {string} head Job head. @returns {string[]} The lines of the job-level concurrency block, comments ignored. */
function concurrencyBlock(head) {
  const lines = head.split('\n').filter(l => !/^\s*#/.test(l));
  const i = lines.findIndex(l => l === '    concurrency:');
  return i < 0 ? [] : lines.slice(i + 1, i + 3).map(l => l.replace(/^ {6}/, ''));
}

/** Throws unless the workflow holds both parts of the guard. */
function assertGuard(wf) {
  const block = concurrencyBlock(jobHead(wf));
  assert.deepEqual(block, [GROUP, 'cancel-in-progress: false'],
    'job pull needs exactly: main runs share one group, other refs get a group per run, a queued run never cancels a running publisher');
  const step = checkoutStep(wf).split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
  assert.match(step, /\n {10}ref: \$\{\{ github\.ref \}\}( {2}#.*)?\n/, 'Checkout must name ref: ${{ github.ref }}, else the waiting run builds on the commit current at its creation');
}

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

const WF = read('.github/workflows/monthly-sec-xbrl.yml');

check('the committed workflow carries the job-level group and the Checkout ref', () => assertGuard(WF));

check('the workflow-level group is untouched (hand starts stay outside main-push)', () => {
  assert.match(WF, /\nconcurrency:\n {2}group: \$\{\{ github\.event_name == 'workflow_dispatch' && format\('manual-\{0\}', github\.run_id\) \|\| 'main-push' \}\}\n {2}cancel-in-progress: false\n/);
});

check('the guard itself: each breakage is caught', () => {
  const broken = {
    'block removed': WF.replace(/\n {4}concurrency:\n {6}group:.*\n {6}cancel-in-progress: false/, ''),
    'cancel-in-progress true': WF.replace('      cancel-in-progress: false\n    timeout-minutes', '      cancel-in-progress: true\n    timeout-minutes'),
    'one group for every ref': WF.replace(/ {6}group: \$\{\{ github\.ref == .*monthly-sec-xbrl-\{0\}.*\}\}/, "      group: monthly-sec-xbrl-main"),
    'ref test dropped': WF.replace("github.ref == 'refs/heads/main' &&", 'true &&'),
    'branches swapped': WF.replace("&& 'monthly-sec-xbrl-main' || format('monthly-sec-xbrl-{0}', github.run_id)", "&& format('monthly-sec-xbrl-{0}', github.run_id) || 'monthly-sec-xbrl-main'"),
    'condition negated': WF.replace("${{ github.ref == 'refs/heads/main' &&", "${{ github.ref != 'refs/heads/main' &&"),
    'block only in a comment': WF.replace('\n    concurrency:\n', '\n    # concurrency:\n'),
    'checkout ref removed': WF.replace(/ {10}ref: \$\{\{ github\.ref \}\}.*\n/, ''),
    'checkout ref only in a comment': WF.replace(/ {10}ref: \$\{\{ github\.ref \}\}/, '          # ref: ${{ github.ref }}'),
    'checkout ref points at the creation commit': WF.replace('ref: ${{ github.ref }}  #', 'ref: ${{ github.sha }}  #'),
  };
  for (const [name, text] of Object.entries(broken)) {
    assert.notEqual(text, WF, 'the breakage did not change the text: ' + name);
    assert.throws(() => assertGuard(text), undefined, 'not caught: ' + name);
  }
});

console.log(`monthly-sec-concurrency: ${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
