// tests/value-open-items-wiring.test.js — standalone runner (exit 0/1).
//
// Tag 1398: the open-items step is wired into the daily run the way docs/value-open-items.md says:
// job scoring, after the screener, BEFORE "Build findash-export v1" (a later export step reads the
// list in the same run) and before the vintage write; continue-on-error (never blocks storage,
// deploy or the vintage); the commit step adds exactly the list file. Reads the workflow as text,
// like tests/rule40-ci-wiring.test.js; presence AND absence.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const yml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'daily-pull.yml'), 'utf8');
let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message || e)); }
}

const NAME = 'Value open-items (factor 3, sticky)';
const jobStart = yml.indexOf('\n  scoring:\n');
const jobEnd = yml.indexOf('\n  druckenmiller-guard:\n');
const scoring = yml.slice(jobStart, jobEnd);
// Step blocks of job scoring, keyed by name (text up to the next step).
const steps = scoring.split('\n      - name: ').slice(1).map((b) => ({ name: b.split('\n')[0].trim(), body: b }));
const pos = (n) => steps.findIndex((s) => s.name === n);
const block = (n) => (steps.find((s) => s.name === n) || {}).body || '';

check('W1 the step exists exactly once, in job scoring', () => {
  assert.ok(jobStart > 0 && jobEnd > jobStart, 'job scoring found');
  assert.strictEqual(yml.split('- name: ' + NAME + '\n').length - 1, 1, 'exactly one step with this name in the workflow');
  assert.strictEqual(steps.filter((s) => s.name === NAME).length, 1, 'and it is in job scoring');
});

check('W2 order: after the screener and the baseline save, before the export and before the vintage write', () => {
  const me = pos(NAME);
  assert.ok(me > pos('Run Hypergrowth Screener'), 'after "Run Hypergrowth Screener"');
  assert.ok(me > pos('Save Coverage-Floor Baseline (_last_good_disk.json)'), 'after the baseline save');
  assert.strictEqual(steps[me + 1].name, 'Build findash-export v1', 'directly before "Build findash-export v1"');
  assert.ok(me < pos('Write board-history vintage (2.3)'), 'before the vintage write');
});

check('W3 continue-on-error true, plain node call, no swallowed exit code, no condition', () => {
  const b = block(NAME);
  assert.match(b, /\n {8}continue-on-error: true\n/);
  assert.match(b, /\n {8}run: node scripts\/value-open-items\.js\n/);
  assert.ok(!/\|\| true/.test(b), 'no || true: a failure stays visible as a red step');
  assert.ok(!/\n {8}if:/.test(b), 'no if: (runs whenever the screener succeeded)');
  assert.ok(!/--replay|--dry-run/.test(b), 'the daily step is neither a replay nor a dry run');
});

check('W4 the commit step adds data-health/value-open-items.json on the publishing path, and nothing else of data-health/ new', () => {
  const b = block('Commit board-history vintage to main');
  const add = 'if [ -f data-health/value-open-items.json ]; then git add data-health/value-open-items.json; fi';
  assert.ok(b.includes(add), 'targeted add with existence check');
  assert.ok(b.indexOf(add) > b.indexOf('git add board-history/'), 'on the publishing path, after the branch guard');
  assert.ok(b.indexOf(add) < b.indexOf('git diff --staged --quiet'), 'before the commit decision');
  assert.ok(!/git add data-health\/value-acceptances\.json/.test(b), 'acceptances are never committed by the workflow');
  assert.ok(!/git add data-health\/ /.test(b) && !/git add data-health\/\n/.test(b), 'never the whole data-health/');
});

console.log(fail ? 'FAIL: ' + fail + ' Test(s)' : 'Alle value-open-items-wiring-Tests gruen');
process.exit(fail ? 1 : 0);
