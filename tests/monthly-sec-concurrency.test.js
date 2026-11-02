'use strict';
/**
 * Guard: two runs of the monthly SEC workflow on main must not overlap, and a queued run must never
 * cut off a running one.
 *
 * Finding (2026-11-01): run 41317263548 (schedule, 14:39Z) failed at "Commit manifest" because a hand start
 * (run 41316536068, 14:30Z) had pushed external-data/sec-xbrl/_manifest.json first; the rebase conflicted on
 * that regenerated file on all three attempts. The workflow-level group cannot serialize them (a hand start
 * stays in its own group by design), so the job `pull` carries its own group.
 *
 * The guard reads the workflow file because the fault shows only there. Usage: node tests/monthly-sec-concurrency.test.js (exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').split('\r\n').join('\n');

/** @param {string} wf Workflow text. @returns {string} The lines of the `pull` job up to its `steps:`. */
function jobHead(wf) {
  const start = wf.indexOf('\n  pull:\n');
  assert.ok(start >= 0, 'job pull not found');
  const end = wf.indexOf('\n    steps:\n', start);
  assert.ok(end > start, 'steps of job pull not found');
  return wf.slice(start, end);
}

/** @param {string} head Job head. @returns {{group: string, cancel: string}|null} The job-level concurrency block, comments ignored. */
function jobConcurrency(head) {
  const lines = head.split('\n').filter(l => !/^\s*#/.test(l));
  const i = lines.findIndex(l => l === '    concurrency:');
  if (i < 0) return null;
  const group = lines.slice(i + 1).find(l => /^ {6}group:/.test(l));
  const cancel = lines.slice(i + 1).find(l => /^ {6}cancel-in-progress:/.test(l));
  return { group: group ? group.trim() : '', cancel: cancel ? cancel.trim() : '' };
}

/** Throws unless the head holds the guard. */
function assertGuard(head) {
  const c = jobConcurrency(head);
  assert.ok(c, 'job pull has no concurrency block: a hand start and the schedule can overlap again');
  assert.match(c.group, /github\.ref == 'refs\/heads\/main'/, 'the group must key off the main ref');
  assert.match(c.group, /'monthly-sec-xbrl-main'/, 'main runs must share one fixed group');
  assert.match(c.group, /format\('monthly-sec-xbrl-\{0\}', github\.run_id\)/, 'runs on other refs must get a group of their own (dry runs never wait)');
  assert.equal(c.cancel, 'cancel-in-progress: false', 'a queued run must never cancel a running publisher');
}

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

const WF = read('.github/workflows/monthly-sec-xbrl.yml');

check('the committed workflow carries the job-level group', () => assertGuard(jobHead(WF)));

check('the workflow-level group is untouched (hand starts stay outside main-push)', () => {
  assert.match(WF, /\nconcurrency:\n {2}group: \$\{\{ github\.event_name == 'workflow_dispatch' && format\('manual-\{0\}', github\.run_id\) \|\| 'main-push' \}\}\n {2}cancel-in-progress: false\n/);
});

check('the guard itself: each breakage of the head is caught', () => {
  const head = jobHead(WF);
  const broken = {
    'block removed': head.replace(/\n {4}concurrency:\n {6}group:.*\n {6}cancel-in-progress: false/, ''),
    'cancel-in-progress true': head.replace('cancel-in-progress: false', 'cancel-in-progress: true'),
    'one group for every ref': head.replace(/group: .*monthly-sec-xbrl-\{0\}.*\}\}/, 'group: monthly-sec-xbrl-main'),
    'ref test dropped': head.replace("github.ref == 'refs/heads/main'", 'true'),
    'block only in a comment': head.replace('\n    concurrency:\n', '\n    # concurrency:\n'),
  };
  for (const [name, text] of Object.entries(broken)) {
    assert.notEqual(text, head, 'the breakage did not change the text: ' + name);
    assert.throws(() => assertGuard(text), undefined, 'not caught: ' + name);
  }
});

console.log(`monthly-sec-concurrency: ${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
