'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const script = path.resolve(__dirname, '../scripts/t331-fundamentaluhr-wellen.js');
const api = require(script);

async function probe(moduleFile, log) {
  const r = await require(moduleFile).scanLog(log);
  assert.equal(r.force, 2, 'wave count must include only real pull runtime lines');
  assert.equal(r.fall, 1);
  assert.equal(r.broad, 3);
  assert.equal(r.fullOK, 1);
  assert.equal(r.forceDays.get('2026-08-26'), 1);
  assert.equal(r.forceDays.get('2026-08-27'), 1);
}

async function test() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't331-'));
  const log = path.join(dir, '1.log');
  const force = '[INFO]   ABC [fundamentals-stale]: forcing full pull (fundamentalsAsOf > 30d)';
  const line = (text, job = 'pull (0)', time = '2026-08-26T23:59:59Z') => `${job}\tUNKNOWN STEP\t${time} [${time}] ${text}\n`;
  fs.writeFileSync(log, line(force) + line(force, 'prep') + line('[INFO] diagnostic example: ' + force)
    + line(force, 'pull (1)', '2026-08-27T00:00:01Z')
    + line('[INFO]   DEF [schema-stale]: forcing full pull to backfill Tag 211l fields')
    + line('[WARN]   price-only failed for XYZ, falling through to full pull: failure')
    + line('[INFO]   \u2713 ABC: revenue=$1.0B, growth=2%, sector=Test')
    + line('[INFO] Selector-Diagnose: fixture')
    + line('[INFO] Fundamentals-refresh budget: 1/3000 time-based full pulls used; none deferred.')
    + 'padding\n'.repeat(290000));
  await probe(script, log);
  const r = await api.scanLog(log);
  assert.equal(r.small, false);
  assert.equal(r.selectors.length, 1); assert.equal(r.budgets.length, 1);
  assert.equal(r.members.get('ABC').shard, '0');
  console.log('PASS log counting: wave, fallback, success, non-pull exclusion, UTC midnight');
  const smallFile = path.join(dir, '2.log'); fs.writeFileSync(smallFile, 'cancelled before pull\n');
  const small = await api.scanLog(smallFile); assert.equal(small.small, true);
  const pop = { snapshots: [{ ms: Date.parse('2026-08-26T01:00:00Z') }] };
  const daily = api.dailyComparison(pop, [{ ...r, day: '2026-08-26' }, { ...small, day: '2026-08-28' }]);
  assert.equal(daily.find(d => d.day === '2026-08-26').f, 1);
  assert.equal(daily.find(d => d.day === '2026-08-27').f, 1);
  assert.equal(daily.find(d => d.day === '2026-08-28').f, null);
  assert.equal(daily.find(d => d.day === '2026-08-28').status, 'nur abgebrochen vor dem Pull');
  assert.equal(daily.find(d => d.day === '2026-08-24').status, 'ohne Lauf-Log');
  console.log('PASS small logs marked abgebrochen vor dem Pull, never zero measurements');
  const cli = args => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  const absent = cli(['--logs', dir]); assert.equal(absent.status, 1); assert.match(absent.stderr, /--population/);
  const empty = path.join(dir, 'empty'); fs.mkdirSync(empty);
  const emptyRun = cli(['--population', empty, '--logs', dir]);
  assert.equal(emptyRun.status, 1); assert.match(emptyRun.stderr, /leere Population/);
  const fixturePop = path.join(dir, 'population'); fs.mkdirSync(fixturePop);
  const bytes = '{"meta":{"ticker":"ABC","fundamentalsAsOf":"2026-08-26T03:00:00Z"}}';
  fs.writeFileSync(path.join(fixturePop, 'ABC.json'), bytes);
  const crypto = require('node:crypto'), sha = x => crypto.createHash('sha256').update(x).digest('hex');
  assert.equal(api.readPopulation(fixturePop).digest, sha('ABC.json\0' + sha(bytes) + '\n'));
  const wrong = cli(['--population', fixturePop, '--logs', dir]);
  assert.equal(wrong.status, 1); assert.match(wrong.stderr, /SHA256 mismatch/);
  console.log('PASS missing/empty population fail closed; T326 hash framing and mismatch guard');
  const parsed = api.parseRuns('1 2026-08-26T23:00:00Z schedule failure\n'); assert.equal(parsed[0].day, '2026-08-26');
  const prediction = api.forecast(Array.from({ length: 3001 }, (_, i) => ({ ticker: String(i), ms: Date.parse('2026-08-26T03:00:00Z') })),
    new Map(Array.from({ length: 3001 }, (_, i) => [String(i), { shard: String(i % 2) }])));
  assert.equal(prediction.rows.find(d => d.day === '2026-09-25').crossing, 3001);
  assert.equal(prediction.rows.find(d => d.day === '2026-09-25').demand, 0);
  const next = prediction.rows.find(d => d.day === '2026-09-26');
  assert.equal(next.demand, 3001); assert.equal(next.globalBacklog, 1);
  assert.equal(next.maxShard, 1501); assert.equal(next.shardBacklog, 0);
  assert.equal(prediction.rows.find(d => d.day === '2026-09-27').run, false);
  assert.equal(prediction.rows.find(d => d.day === '2026-09-28').run, false);
  assert.equal(prediction.rows.find(d => d.day === '2026-09-29').globalBacklog, 0);
  console.log('PASS forecast: strict threshold, next run, weekend carry, per-shard vs global cap');
  const mutation = path.join(dir, 'mutated.js');
  const source = fs.readFileSync(script, 'utf8');
  const mutated = source.replace('forcing full pull \\(fundamentalsAsOf', 'BROKEN full pull \\(fundamentalsAsOf');
  assert.notEqual(mutated, source, 'Mutation must change the production count pattern');
  fs.writeFileSync(mutation, mutated);
  const red = spawnSync(process.execPath, [__filename, '--probe', mutation, log], { encoding: 'utf8' });
  assert.equal(red.status, 1); assert.match(red.stderr, /wave count/);
  await probe(script, log);
  console.log('PASS Bruchprobe: altered count pattern -> child test RED (exit 1); original GREEN');
  console.log('PASS all T331 checks (fixtures retained in os.tmpdir; no files deleted)');
}
(process.argv[2] === '--probe' ? probe(process.argv[3], process.argv[4]) : test()).catch(e => {
  console.error(e); process.exitCode = 1;
});
