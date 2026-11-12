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
let floorsFiles = 0;
const floorsFile = rotstellen => {
  const file = path.join(tmp, `floors-${floorsFiles++}.json`);
  fs.writeFileSync(file, JSON.stringify({ floors, rotstellen }));
  return ['--floors', file];
};

// Without --floors the guard runs on the live floors WITHOUT the live red spots, so the floor checks below do not
// depend on the calendar; the red spots have their own cases further down.
function guard(feed, ...args) {
  const file = path.join(tmp, 'universum.json');
  fs.writeFileSync(file, typeof feed === 'string' ? feed : JSON.stringify(feed));
  const floorArgs = args.includes('--floors') ? [] : floorsFile({});
  return spawnSync(process.execPath, [path.join(root, 'scripts', 'feed-fill-guard.js'), '--feed', file, ...floorArgs, ...args], { encoding: 'utf8' });
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

// Red spots (Daylauf 16): a temporary floor with owner and expiry, relative to today's clock so no date ages into a red.
const { rotstelleFault, checkFill } = require('../scripts/feed-fill-guard.js');
const day = offset => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
const spot = (extra = {}) => ({ floor: floors.d52 - 10, seit: day(-1), bis: day(12), zustaendig: 'Test', grund: 'Testgrund.', ...extra });
// About 90 % filled: under the normal floor, over the temporary one.
const dropD52 = feedWith((row, i) => { if (i < 100) delete row.d52; });
assert.equal(guard(dropD52).status, 1, 'without a red spot the loss is red');
const active = guard(dropD52, ...floorsFile({ d52: spot() }));
assert.equal(active.status, 0, active.stdout);
assert.match(active.stdout, /::warning::Rotstelle bis .*zuständig Test: das Feld d52/);
assert.equal(guard(feedWith((row, i) => { if (i < 300) delete row.d52; }), ...floorsFile({ d52: spot() })).status, 1, 'below the temporary floor stays red');
const expired = guard(dropD52, ...floorsFile({ d52: spot({ seit: day(-15), bis: day(-1) }) }));
assert.equal(expired.status, 1);
assert.match(expired.stdout, /::error::Die Rotstelle für das Feld d52 ist am .* abgelaufen/);
assert.equal(guard(feedWith(), ...floorsFile({ d52: spot({ seit: day(-15), bis: day(-1) }) })).status, 1, 'an expired entry is red even when the field recovered');
for (const bad of [{ bis: day(13) }, { bis: day(20) }, { bis: day(-2) }, { floor: floors.d52 }, { seit: '2026-02-30' }, { zustaendig: ' ' }, { grund: undefined }]) {
  const result = guard(dropD52, ...floorsFile({ d52: spot(bad) }));
  assert.equal(result.status, 1, JSON.stringify(bad));
  assert.match(result.stdout, /Rotstelle für das Feld d52 ist ungültig/, JSON.stringify(bad));
}
assert.equal(guard(dropD52, ...floorsFile({ unbekannt: spot() })).status, 1, 'a red spot on a field without floor');
assert.equal(guard(dropD52, ...floorsFile([])).status, 2, 'rotstellen must be an object');
// The live red spots, each on its own first day (clock pinned, so their fixed bis never ages this test into a red).
const liveSpots = JSON.parse(fs.readFileSync(DEFAULT_FLOORS, 'utf8')).rotstellen || {};
for (const [field, entry] of Object.entries(liveSpots)) {
  const result = checkFill(feedWith(), floors, { now: Date.parse(entry.seit + 'T12:00:00Z'), maxAgeHours: Infinity, rotstellen: liveSpots });
  assert.deepEqual(result.problems, [], field);
  assert.equal(result.floors[field], entry.floor, field);
  assert.ok(result.notices.some(n => n.includes(`das Feld ${field} wird gegen`)), field);
  assert.ok(result.notices.some(n => n.includes(`Das Feld ${field} steht mit`)), 'a recovered field says its red spot can go: ' + field);
}
assert.ok(active.stdout.includes('(Rotstelle)'), 'the table marks a temporary floor');
// The live red spots are valid entries of at most 14 days on fields with a floor.
for (const [field, entry] of Object.entries(JSON.parse(fs.readFileSync(DEFAULT_FLOORS, 'utf8')).rotstellen || {})) {
  assert.equal(rotstelleFault(field, entry, floors), null, field);
}

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
