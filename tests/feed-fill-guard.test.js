'use strict';
// Runs the real guard as a process on temporary feeds; the break-once inputs are test data, never a live file.
// The stale-price writer fixture below needs a fixed run day; the guard itself never reads it.
process.env.RUN_DATE_UTC = '2026-10-30';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DEFAULT_FLOORS } = require('../scripts/feed-fill-guard.js');
const { ROW_KEYS } = require('../scripts/write-filter-universe.js');
const { JOB_REIHENFOLGE } = require('../scripts/pipeline-status.js');

const root = path.resolve(__dirname, '..');
const JOB = 'feed-fill-waechter';
const { floors, erklaertMax } = JSON.parse(fs.readFileSync(DEFAULT_FLOORS, 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-fill-guard-'));
let floorsFiles = 0;
const floorsFile = (rotstellen, extra = {}) => {
  const file = path.join(tmp, `floors-${floorsFiles++}.json`);
  fs.writeFileSync(file, JSON.stringify({ floors, rotstellen, erklaertMax, ...extra }));
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
const expired = guard(dropD52, ...floorsFile({ d52: spot({ seit: day(-14), bis: day(-1) }) }));
assert.equal(expired.status, 1);
assert.match(expired.stdout, /::error::Die Rotstelle für das Feld d52 ist am .* abgelaufen/);
assert.equal(guard(feedWith(), ...floorsFile({ d52: spot({ seit: day(-14), bis: day(-1) }) })).status, 1, 'an expired entry is red even when the field recovered');
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

// Explained values (Daylauf 16): a value the REAL filter writer withholds on a stale Yahoo quote carries a reason the
// guard knows. Fixture of tests/stale-price-filter-and-sibling.test.js: quote of 02.10., run day 30.10.
const G = require('../lib/market-cap-guard.js');
const W = require('../scripts/write-filter-universe.js');
const { explained } = require('../scripts/feed-fill-guard.js');
const OLD = '2026-10-02T15:35:06.000Z', FRESH = '2026-10-30T08:00:00.000Z';
const priced = (stamp, ticker) => ({
  meta: { ticker, name: 'Company ' + ticker, sector: 'Technology', industry: 'Software', tradingCurrency: 'USD', reportingCurrency: 'USD',
    tradingCurrencyOriginal: 'USD', reportingCurrencyOriginal: 'USD', fxConverted: true, tradingFxRateApplied: 1, fxRateApplied: 1, asOf: FRESH },
  marketCap: { value: 1e12, asOf: FRESH, regularMarketTime: stamp },
  metrics: { pe: { value: 20 }, forwardPE: { value: 12 }, dividendYield: { value: 2 }, fiftyTwoWeekHigh: { value: 200 },
    priceSales: { value: 5 }, enterpriseToRevenue: { value: 6 }, revenueTTM: { value: 2e11 } },
  price: { regularMarketPrice: 100, currencyUnit: 'USD' }, annual: {}, timeseries: {},
});
const writerRows = W.buildUniverse({ snapshots: [G.prepareMarketCap(priced(OLD, 'OLD')), G.prepareMarketCap(priced(FRESH, 'NEW'))],
  excluded: new Map([['OLD', ['market-cap-missing']], ['NEW', ['market-cap-missing']]]),
  athEntries: { OLD: { ath: 200, athDate: '2025-01-02', lastClose: 100, lastDate: '2026-10-20' }, NEW: { ath: 200, athDate: '2025-01-02', lastClose: 100, lastDate: '2026-10-29' } },
  generatedAt: FRESH }).rows;
const heldRow = writerRows.find(r => r.t === 'OLD'), freshRow = writerRows.find(r => r.t === 'NEW');
for (const field of ['mc', 'ps', 'evs', 'pe', 'fpe', 'dy', 'd52', 'ath']) {
  assert.notEqual(freshRow[field], undefined, 'the fresh row shows ' + field);
  assert.equal(heldRow[field], undefined, 'the stale row withholds ' + field);
  assert.equal(explained(heldRow, field), true, 'the writer reason explains ' + field + ': ' + heldRow.aus.join(' | '));
  assert.equal(explained(freshRow, field), false, field);
}
// r40: a withheld market cap makes the row data-suspect (B5), and the writer takes r40 only from rows that are not.
assert.equal(require('../scripts/write-rule40-export.js').datenSuspekt(G.prepareMarketCap(priced(OLD, 'OLD'))), true, 'stale row is data-suspect');
// It counts only beside the two r40 inputs, so a stale row that could never have had r40 stays a gap.
assert.equal(heldRow.g ?? heldRow.fcf, undefined, 'the fixture row has no r40 inputs');
assert.equal(explained(heldRow, 'r40'), false, 'without g and fcf');
assert.equal(explained({ ...heldRow, g: 12, fcf: 5 }, 'r40'), true);
assert.equal(explained({ ...heldRow, g: 12 }, 'r40'), false, 'without fcf');
// No other field is explained by these reasons, and a reason without the stale quote explains nothing.
for (const field of ['g', 'roe', 'gm', 'fcf', 'po', 'sc', 'b']) assert.equal(explained(heldRow, field), false, field);
assert.equal(explained({ aus: ['market-cap-missing', 'data-suspect'] }, 'mc'), false);
assert.equal(explained({ aus: ['P/E wird nicht gezeigt, die Kursmeldung von Yahoo vom 02.10.2026 ist zu alt.'] }, 'fpe'), false, 'P/E hint is not the forward P/E hint');
assert.equal(explained({}, 'mc'), false, 'a row without aus');

// The guard on such rows: 1000 rows, the first n stale (mc and d52 withheld with the writer's reasons).
const staleAus = heldRow.aus;
const staleFeed = (n, withReason = true) => feedWith((row, i) => { if (i < n) { delete row.mc; delete row.d52; if (withReason) row.aus = staleAus; } });
assert.ok(erklaertMax >= 10, 'the cases below hide 10 % of the rows; a lower cap needs new cases');
const explainedRun = guard(staleFeed(100));
assert.equal(explainedRun.status, 0, explainedRun.stdout);
assert.match(explainedRun.stdout, /^mc .*100,0 %.*explained 10,0 % of all rows/m, 'share among the rows that can show the field');
const unexplained = guard(staleFeed(100, false));
assert.equal(unexplained.status, 1, 'the same loss without a reason is red');
assert.match(unexplained.stdout, /::error::Das Feld mc ist nur auf 90,0 % der 1000 Zeilen gefüllt/);
// The cap: exactly erklaertMax percent is green, one row more is red, and so is a mass loss with reasons.
const atCap = Math.floor(erklaertMax * 10); // rows of 1000 at or under the cap
assert.equal(guard(staleFeed(atCap)).status, 0, 'exactly at the cap');
const overCap = guard(staleFeed(atCap + 1));
assert.equal(overCap.status, 1, overCap.stdout);
assert.match(overCap.stdout, /::error::Das Feld mc ist auf .* wegen eines zu alten Kurses ausgeblendet, erlaubt sind höchstens/);
const allStale = guard(staleFeed(1000));
assert.equal(allStale.status, 1, 'every row stale is never green');
assert.ok(!allStale.stdout.includes('der 0 Zeilen'), 'no floor sentence on a field no row can show: ' + allStale.stdout);
// A real loss on the other rows stays red beside the explained ones (100 explained, 60 more without reason: 840/900 = 93.3 %).
assert.equal(guard(feedWith((row, i) => { if (i < 160) { delete row.mc; if (i < 100) row.aus = staleAus; } })).status, 1);
// A reason beside a shown value explains nothing and moves nothing.
const shownBeside = checkFill(feedWith((row, i) => { if (i < 100) row.aus = staleAus; }), floors, { explainedMax: erklaertMax, maxAgeHours: Infinity });
assert.equal(shownBeside.explainedShares.mc, 0); assert.equal(shownBeside.shares.mc, 100);
// Fail-closed default: a caller without explainedMax allows none.
assert.ok(checkFill(staleFeed(1), floors, { maxAgeHours: Infinity }).problems.some(p => p.includes('erlaubt sind höchstens 0,0 %')));
for (const bad of [{ erklaertMax: undefined }, { erklaertMax: -1 }, { erklaertMax: 101 }, { erklaertMax: '12' }]) {
  assert.equal(guard(feedWith(), ...floorsFile({}, bad)).status, 2, JSON.stringify(bad));
}

// Break once on the guard source, compiled in memory (nothing written; the live file is hashed before and after).
const GUARD_FILE = path.join(root, 'scripts', 'feed-fill-guard.js');
const sha = () => crypto.createHash('sha256').update(fs.readFileSync(GUARD_FILE)).digest('hex');
const before = sha();
const broken = (anchor, replacement) => {
  const lines = fs.readFileSync(GUARD_FILE, 'utf8').split(/\r?\n/);
  assert.equal(lines.filter(l => l === anchor).length, 1, 'exact whole-line anchor: ' + anchor);
  const m = new Module(GUARD_FILE, module);
  m.filename = GUARD_FILE;
  m.paths = Module._nodeModulePaths(path.dirname(GUARD_FILE));
  m._compile(lines.map(l => (l === anchor ? replacement : l)).join('\n'), GUARD_FILE);
  return m.exports;
};
const reasonless = broken('  return STALE_FIELDS.has(field) && aus.some(a => a.endsWith(STALE_PRICE_RETURN));', '  return STALE_FIELDS.has(field);');
assert.deepEqual(reasonless.checkFill(feedWith((row, i) => { if (i < 100) delete row.mc; }), floors, { explainedMax: erklaertMax, maxAgeHours: Infinity }).problems, [], 'broken: a reasonless loss turns green');
const uncapped = broken('    if (explainedShares[field] > explainedMax) problems.push(`Das Feld ${field} ist auf ${percent(explainedShares[field])} der ${rows.length} Zeilen wegen eines zu alten Kurses ausgeblendet, erlaubt sind höchstens ${percent(explainedMax)}. So viele alte Kurse deuten auf eine Störung beim Kursabruf, nicht auf einzelne Zeilen.`);', '');
assert.ok(guard(staleFeed(500)).stdout.includes('erlaubt sind höchstens'), 'half the rows stale is red by the cap alone');
assert.deepEqual(uncapped.checkFill(staleFeed(500), floors, { explainedMax: erklaertMax, maxAgeHours: Infinity }).problems, [], 'broken: a mass loss turns green');
assert.equal(sha(), before, 'the live guard file is unchanged');

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
