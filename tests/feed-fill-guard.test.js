'use strict';
// Runs the real guard as a process on temporary feeds; the break-once inputs are test data, never a live file.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DEFAULT_FLOORS } = require('../scripts/feed-fill-guard.js');
const { ROW_KEYS } = require('../scripts/write-filter-universe.js');
const { JOB_REIHENFOLGE } = require('../scripts/pipeline-status.js');

const root = path.resolve(__dirname, '..');
const JOB = 'feed-fill-waechter';
const floors = JSON.parse(fs.readFileSync(DEFAULT_FLOORS, 'utf8')).floors;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-fill-guard-'));

function guard(feed, ...args) {
  const file = path.join(tmp, 'universum.json');
  fs.writeFileSync(file, typeof feed === 'string' ? feed : JSON.stringify(feed));
  return spawnSync(process.execPath, [path.join(root, 'scripts', 'feed-fill-guard.js'), '--feed', file, ...args], { encoding: 'utf8' });
}
const fullRow = i => Object.fromEntries(ROW_KEYS.map(key => [key, key === 't' ? 'T' + i : key === 'aus' ? [] : 1]));
const feedWith = (mutate = () => {}, generated_at = new Date().toISOString()) => {
  const rows = Array.from({ length: 1000 }, (_, i) => { const row = fullRow(i); mutate(row, i); return row; });
  return { generated_at, rows };
};

// Green on a full feed, also when every aus list is empty (an empty exclusion list is no gap).
const green = guard(feedWith());
assert.equal(green.status, 0, green.stdout + green.stderr);

// Break once: the state of 29.10.2026, d52 gone from a quarter of the rows.
const quarterGone = guard(feedWith((row, i) => { if (i < 260) delete row.d52; }));
assert.equal(quarterGone.status, 1, quarterGone.stdout);
assert.match(quarterGone.stdout, /::error::Das Feld d52 ist nur auf 74,0 %/);
assert.equal(quarterGone.stdout.split('\n').filter(line => line.startsWith('::error::')).length, 1, 'only the emptied field is named');

// Exactly at the floor is still green, one row below it is red: the comparison, not just the direction.
const justAtFloor = guard(feedWith((row, i) => { if (i < 53) delete row.d52; }));
assert.equal(justAtFloor.status, 0, justAtFloor.stdout);
const justBelow = guard(feedWith((row, i) => { if (i < 54) delete row.d52; }));
assert.equal(justBelow.status, 1, justBelow.stdout);

// A field the floors do not know, a feed without rows, an old feed and unreadable input are never green.
const unpinned = guard(feedWith(row => { row.neu = 1; }));
assert.equal(unpinned.status, 1);
assert.match(unpinned.stdout, /Das Feld neu steht im Filter-Feed/);
assert.equal(guard({ generated_at: new Date().toISOString(), rows: [] }).status, 1);
const stale = guard(feedWith(() => {}, new Date(Date.now() - 25 * 36e5).toISOString()));
assert.equal(stale.status, 1);
assert.match(stale.stdout, /älter als 24 Stunden/);
assert.equal(guard(feedWith(() => {}, 'kein Datum')).status, 1, 'an unparsable stamp is no proof of freshness');
assert.equal(guard('{ not json').status, 2);

// Every field the writer can emit has a floor, so a new field is noticed in its pull request and not on its first day.
assert.deepEqual(ROW_KEYS.filter(key => !(key in floors)), []);

// Wiring: visible in the status marker and blocking nothing.
const yml = fs.readFileSync(path.join(root, '.github', 'workflows', 'daily-pull.yml'), 'utf8').replace(/\r\n/g, '\n');
assert.ok(yml.includes(`\n  ${JOB}:\n    needs: scoring\n`), 'own job behind scoring');
assert.ok(new RegExp(`\\n {2}laufstatus:\\n {4}needs: \\[[^\\]]*\\b${JOB}\\b`).test(yml), 'in laufstatus.needs');
assert.ok(JOB_REIHENFOLGE.includes(JOB), 'in JOB_REIHENFOLGE');
assert.ok(JOB_REIHENFOLGE.indexOf('scoring') < JOB_REIHENFOLGE.indexOf(JOB), 'a data step is named before this guard');
const others = yml.split('\n').filter(line => /^ {4}needs:/.test(line) && line.includes(JOB));
assert.equal(others.length, 1, 'only laufstatus waits for this job: ' + others.join(' | '));

// The job reads the published file, and a run that publishes nothing never measures an older feed.
const job = yml.slice(yml.indexOf(`\n  ${JOB}:\n`), yml.indexOf('\n  laufstatus:\n'));
const publishCheck = job.indexOf('if [ "$VEROEFFENTLICHEN" != "true" ]; then');
const fetchFeed = job.indexOf('/contents/outputs/findash-export/v1/filter/universum.json?ref=gh-pages"');
const runGuard = job.indexOf('node scripts/feed-fill-guard.js --feed "$RUNNER_TEMP/universum.json"');
assert.ok(publishCheck >= 0 && fetchFeed > publishCheck && runGuard > fetchFeed, 'publish check, then fetch, then guard');

console.log('ok feed-fill-guard');
