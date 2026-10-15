'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { stepFor, buildFeed, validate, build, ROW_KEYS, SKIP_REASONS, MAX_BYTES } = require('../scripts/write-preisschritt-export.js');
const store = require('../lib/price-history-store.js');
const mini = require('./fixtures/preisschritt/store-mini.json');
const generatedAt = '2026-10-15T08:43:25.693Z';
const stamp = '2026-10-15T08:37:04.076Z';
const make = (tickers = mini.universe, bars = mini.history) => buildFeed({ tickers, bars, generatedAt, priceStoreUpdatedAt: stamp });
const bytesOf = feed => Buffer.byteLength(JSON.stringify(feed));
const row = (feed, ticker) => feed.rows.find(r => r.t === ticker);
const script = path.resolve(__dirname, '../scripts/write-preisschritt-export.js');
const workflowFile = path.resolve(__dirname, '../.github/workflows/daily-pull.yml');
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('hand fixture is exact: adjusted closes 100 then 102 give a step of 1.02, and only the last two bars count', () => {
  const before = JSON.stringify(mini), feed = make();
  assert.equal(JSON.stringify(mini), before);
  // HAND has three stored bars (90, 100, 102): the older one is ignored.
  assert.deepEqual(row(feed, 'HAND'), { t: 'HAND', d0: '2026-10-13', c0: 100, d1: '2026-10-14', c1: 102 });
  assert.equal(row(feed, 'HAND').c1 / row(feed, 'HAND').c0, 1.02);
  assert.deepEqual(row(feed, 'SPLT'), { t: 'SPLT', d0: '2026-10-13', c0: 50.5, d1: '2026-10-14', c1: 51 });
  // Non-consecutive bars (Friday 09.10. then Wednesday 14.10.) are kept as stored: the dates state the gap, findash judges it.
  assert.deepEqual(row(feed, 'GAPPY'), { t: 'GAPPY', d0: '2026-10-09', c0: 20, d1: '2026-10-14', c1: 21 });
  assert.deepEqual(feed.rows.map(r => r.t), ['GAPPY', 'HAND', 'SPLT']);
  // A ticker stored but outside the universe never appears.
  assert.equal(row(feed, 'OUTSIDE'), undefined);
  assert.deepEqual(validate(feed, bytesOf(feed)), []);
  for (const r of feed.rows) assert.deepEqual(Object.keys(r), ROW_KEYS);
  assert.deepEqual(Object.keys(feed), ['schema', 'generated_at', 'priceStoreUpdatedAt', 'universeCount', 'skipped', 'rows']);
});

test('rows without two usable bars are left out and counted by reason, never filled', () => {
  const feed = make();
  assert.deepEqual(feed.skipped, {
    'not-in-store': 1,           // NOSTORE: listed in the universe, no series
    'fewer-than-two-bars': 2,    // SOLO (one bar), EMPTY (none)
    'invalid-date': 1,           // BADD: 2026-02-30
    'invalid-close': 2,          // ZERO (0), NEGC (negative)
    'dates-not-increasing': 2,   // SAME (equal), BACK (reversed)
  });
  assert.deepEqual(Object.keys(feed.skipped), SKIP_REASONS);
  assert.equal(feed.universeCount, mini.universe.length);
  assert.equal(feed.rows.length + Object.values(feed.skipped).reduce((a, b) => a + b, 0), feed.universeCount);
  for (const t of ['SOLO', 'EMPTY', 'ZERO', 'NEGC', 'SAME', 'BACK', 'BADD', 'NOSTORE']) assert.equal(row(feed, t), undefined, t);
  // The older valid bar is never promoted when the newest one is bad (no filling).
  assert.deepEqual(stepFor('X', [{ date: '2026-10-12', close: 3 }, { date: '2026-10-13', close: 4 }, { date: '2026-10-14', close: 0 }]), { skip: 'invalid-close' });
  // Non-number closes are glitches, not prices.
  for (const close of ['5', null, NaN, Infinity, undefined, -1, 0]) {
    assert.deepEqual(stepFor('X', [{ date: '2026-10-13', close: 5 }, { date: '2026-10-14', close }]), { skip: 'invalid-close' }, String(close));
    assert.deepEqual(stepFor('X', [{ date: '2026-10-13', close }, { date: '2026-10-14', close: 5 }]), { skip: 'invalid-close' }, String(close));
  }
  // A full timestamp is not a day.
  assert.deepEqual(stepFor('X', [{ date: '2026-10-13T00:00:00Z', close: 5 }, { date: '2026-10-14', close: 5 }]), { skip: 'invalid-date' });
  assert.deepEqual(stepFor('X', [null, { date: '2026-10-14', close: 5 }]), { skip: 'invalid-date' });
  assert.deepEqual(stepFor('X', undefined), { skip: 'not-in-store' });
  assert.deepEqual(stepFor('X', 'not an array'), { skip: 'not-in-store' });
});

test('buildFeed refuses a broken generation or store stamp', () => {
  for (const bad of [undefined, '', 'yesterday']) {
    assert.throws(() => buildFeed({ tickers: ['HAND'], bars: mini.history, generatedAt: bad, priceStoreUpdatedAt: stamp }), /Invalid generation/);
    assert.throws(() => buildFeed({ tickers: ['HAND'], bars: mini.history, generatedAt, priceStoreUpdatedAt: bad }), /Invalid price store stamp/);
  }
});

test('no rank, percentile, score or judgement wording can appear in keys or file name', () => {
  assert.deepEqual(ROW_KEYS, ['t', 'd0', 'c0', 'd1', 'c1']);
  const feed = make(), keys = new Set([...feed.rows.flatMap(r => Object.keys(r)), ...Object.keys(feed), ...Object.keys(feed.skipped)]);
  for (const key of [...keys, path.basename(script), 'preisschritt.json']) assert.doesNotMatch(key, /rank|rk|perc|pct|score|sc$|signal|sig|fond|fund|contrarian|antizykl|kandidat|urteil|verdict/i);
});

test('validator goes red on every tamper variant and stays green on the control', () => {
  const control = make();
  assert.deepEqual(validate(control, bytesOf(control)), []);
  const tampers = {
    'unknown key (rank)': f => { row(f, 'HAND').rank = 1; },
    'missing key': f => { delete row(f, 'HAND').c0; },
    'null value': f => { row(f, 'HAND').c1 = null; },
    'key order changed': f => { f.rows[0] = { t: 'GAPPY', c0: 20, d0: '2026-10-09', d1: '2026-10-14', c1: 21 }; },
    'close as string': f => { row(f, 'HAND').c0 = '100'; },
    'close NaN': f => { row(f, 'HAND').c1 = NaN; },
    'close zero': f => { row(f, 'HAND').c0 = 0; },
    'close negative': f => { row(f, 'HAND').c1 = -102; },
    'equal dates': f => { row(f, 'HAND').d1 = row(f, 'HAND').d0; },
    'reversed dates': f => { const r = row(f, 'HAND'); [r.d0, r.d1] = [r.d1, r.d0]; },
    'date with time': f => { row(f, 'HAND').d1 = '2026-10-14T00:00:00Z'; },
    'impossible day': f => { row(f, 'HAND').d0 = '2026-02-30'; },
    'missing ticker': f => { delete row(f, 'HAND').t; },
    'duplicate ticker': f => { f.rows.push(structuredClone(row(f, 'HAND'))); f.universeCount++; },
    'row count off (row removed)': f => { f.rows.pop(); },
    'universeCount off': f => { f.universeCount += 1; },
    'skipped count off': f => { f.skipped['invalid-close']++; },
    'skipped reason unknown': f => { f.skipped.misc = 1; },
    'skipped reason missing': f => { delete f.skipped['invalid-date']; },
    'skipped negative': f => { f.skipped['invalid-close'] = -2; f.skipped['not-in-store'] += 4; },
    'skipped missing': f => { delete f.skipped; },
    'priceStoreUpdatedAt missing': f => { delete f.priceStoreUpdatedAt; },
    'priceStoreUpdatedAt unparsable': f => { f.priceStoreUpdatedAt = 'recently'; },
    'wrong schema': f => { f.schema = 'findash-export/v2'; },
    'generated_at unparsable': f => { f.generated_at = 'yesterday'; },
    'rows missing': f => { delete f.rows; },
  };
  for (const [name, mutate] of Object.entries(tampers)) {
    const feed = make(); mutate(feed);
    assert.ok(validate(feed, 1000).length > 0, name);
  }
  // The generation of the board index next to the file must match exactly.
  assert.deepEqual(validate(control, bytesOf(control), generatedAt), []);
  assert.ok(validate(control, bytesOf(control), '2026-09-01T12:00:00Z').some(e => e.includes('Generation mismatch')));
  // Against universum.json: same count and only universe members.
  assert.deepEqual(validate(control, bytesOf(control), generatedAt, mini.universe), []);
  assert.ok(validate(control, bytesOf(control), generatedAt, mini.universe.concat('MORE')).some(e => e.includes('Universe count differs')));
  assert.ok(validate(control, bytesOf(control), generatedAt, mini.universe.map(t => (t === 'HAND' ? 'OTHER' : t))).some(e => e.includes('not in universum.json')));
});

test('the size cap is enforced exactly', () => {
  const feed = make();
  assert.ok(validate(feed, MAX_BYTES + 1).some(e => e.includes('Size')));
  assert.ok(validate(feed, 0).some(e => e.includes('Size')));
  assert.deepEqual(validate(feed, MAX_BYTES), []);
  assert.equal(MAX_BYTES, 4_000_000);
});

// A temporary export tree (index.json + filter/universum.json) and a real sharded price store written with the store module.
function fixtureTree({ generated = generatedAt, universeGenerated = generated, universe = mini.universe } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preisschritt-'));
  const v1Dir = path.join(dir, 'v1'), pricesDir = path.join(dir, 'prices');
  fs.mkdirSync(path.join(v1Dir, 'filter'), { recursive: true });
  const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
  write(path.join(v1Dir, 'index.json'), { schema: 'findash-export/v1', generated_at: generated, generatedFromSnapshots: universe.length, branches: ['x'] });
  write(path.join(v1Dir, 'filter', 'universum.json'), { schema: 'findash-export/v1', generated_at: universeGenerated, snapshotCount: universe.length, rows: universe.map(t => ({ t, n: 'Name ' + t })) });
  store.saveAll(pricesDir, structuredClone(mini.history));
  return { dir, v1Dir, pricesDir, target: path.join(v1Dir, 'filter', 'preisschritt.json') };
}

test('build reads the sharded store, is idempotent (byte-equal second run), leaves universum.json untouched and rejects a foreign generation', () => {
  const t = fixtureTree();
  const universe = path.join(t.v1Dir, 'filter', 'universum.json');
  const universeHash = sha(universe), indexHash = sha(path.join(t.v1Dir, 'index.json'));
  const first = build({ pricesDir: t.pricesDir, v1Dir: t.v1Dir }), hash = sha(t.target);
  const second = build({ pricesDir: t.pricesDir, v1Dir: t.v1Dir });
  assert.equal(sha(t.target), hash);
  assert.equal(first.bytes, second.bytes);
  assert.equal(first.bytes, fs.statSync(t.target).size);
  assert.equal(sha(universe), universeHash);
  assert.equal(sha(path.join(t.v1Dir, 'index.json')), indexHash);
  assert.deepEqual(fs.readdirSync(path.join(t.v1Dir, 'filter')).sort(), ['preisschritt.json', 'universum.json']);
  assert.deepEqual(JSON.parse(fs.readFileSync(t.target, 'utf8')), first.feed);
  assert.deepEqual(row(first.feed, 'HAND'), { t: 'HAND', d0: '2026-10-13', c0: 100, d1: '2026-10-14', c1: 102 });
  assert.equal(first.feed.rows.length, 3);
  assert.equal(first.feed.universeCount, mini.universe.length);
  // The stamp comes from the store's _meta.json.
  assert.equal(first.feed.priceStoreUpdatedAt, store.loadMeta(t.pricesDir).updatedAt);
  // A universe file of another generation than the board index is refused; nothing is written.
  const foreign = fixtureTree({ universeGenerated: '2026-09-01T12:00:00Z' });
  assert.throws(() => build({ pricesDir: foreign.pricesDir, v1Dir: foreign.v1Dir }), /foreign filter universe/);
  assert.equal(fs.existsSync(foreign.target), false);
});

test('generated_at is copied character for character from index.json', () => {
  // Spellings that a Date round trip or an own timestamp would change: milliseconds, an offset, zero milliseconds, none.
  for (const generated of ['2026-10-15T08:43:25.693Z', '2026-10-15T10:43:25+02:00', '2026-10-15T08:43:25.000Z', '2026-10-15T08:43:25Z']) {
    const t = fixtureTree({ generated });
    const index = JSON.parse(fs.readFileSync(path.join(t.v1Dir, 'index.json'), 'utf8'));
    const { feed } = build({ pricesDir: t.pricesDir, v1Dir: t.v1Dir });
    assert.strictEqual(feed.generated_at, index.generated_at);
    const raw = fs.readFileSync(t.target, 'utf8');
    assert.ok(raw.includes('"generated_at":' + JSON.stringify(index.generated_at) + ','), 'bytes on disk carry the index string');
    assert.equal(spawnSync(process.execPath, [script, '--check', '--v1-dir', t.v1Dir], { encoding: 'utf8' }).status, 0, generated);
    const other = generated.endsWith('Z') ? generated.replace('Z', '+00:00') : generated.replace('+02:00', 'Z');
    assert.ok(validate(feed, bytesOf(feed), other).some(e => e.includes('Generation mismatch')), other);
  }
});

test('without the filter folder, with a partial store or without a store stamp nothing is written', () => {
  const t = fixtureTree();
  fs.rmSync(path.join(t.v1Dir, 'filter'), { recursive: true });
  assert.throws(() => build({ pricesDir: t.pricesDir, v1Dir: t.v1Dir }), /filter\/ folder missing/);
  assert.equal(fs.existsSync(path.join(t.v1Dir, 'filter')), false);
  const partial = fixtureTree();
  fs.rmSync(store.shardPath(partial.pricesDir, 7));
  assert.throws(() => build({ pricesDir: partial.pricesDir, v1Dir: partial.v1Dir }), /partial/);
  assert.equal(fs.existsSync(partial.target), false);
  const unstamped = fixtureTree();
  fs.rmSync(store.metaPath(unstamped.pricesDir));
  assert.throws(() => build({ pricesDir: unstamped.pricesDir, v1Dir: unstamped.v1Dir }), /no _meta\.json/);
  assert.equal(fs.existsSync(unstamped.target), false);
  const empty = fixtureTree({ universe: [] });
  assert.throws(() => build({ pricesDir: empty.pricesDir, v1Dir: empty.v1Dir }), /foreign filter universe/);
  const twice = fixtureTree({ universe: ['HAND', 'HAND'] });
  assert.throws(() => build({ pricesDir: twice.pricesDir, v1Dir: twice.v1Dir }), /duplicate ticker/);
});

test('CLI checks a real file, rejects a corrupted copy, a foreign generation, a foreign universe and an oversized one, and self-tests', () => {
  const t = fixtureTree(), run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  build({ pricesDir: t.pricesDir, v1Dir: t.v1Dir });
  const hash = sha(t.target);
  const ok = run('--check', '--v1-dir', t.v1Dir);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /check OK/);
  // Only generated fixture copies are break targets; the good file is never mutated.
  const bad = fixtureTree(), corrupt = make(); row(corrupt, 'HAND').rank = 1;
  fs.writeFileSync(bad.target, JSON.stringify(corrupt));
  const rejected = run('--check', '--v1-dir', bad.v1Dir);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /row shape/);
  const old = fixtureTree(), stale = make(); stale.generated_at = '2026-09-01T12:00:00Z';
  fs.writeFileSync(old.target, JSON.stringify(stale));
  const foreign = run('--check', '--v1-dir', old.v1Dir);
  assert.equal(foreign.status, 1);
  assert.match(foreign.stderr, /Generation mismatch/);
  fs.rmSync(path.join(old.v1Dir, 'index.json'));
  assert.equal(run('--check', '--v1-dir', old.v1Dir).status, 1);
  // A file built for another universe than the one next to it.
  const other = fixtureTree({ universe: mini.universe.concat('MORE') });
  fs.writeFileSync(other.target, JSON.stringify(make()));
  const wrongUniverse = run('--check', '--v1-dir', other.v1Dir);
  assert.equal(wrongUniverse.status, 1);
  assert.match(wrongUniverse.stderr, /Universe count differs/);
  const big = fixtureTree(), source = row(make(), 'HAND');
  const rows = Array.from({ length: 60000 }, (_, i) => ({ ...source, t: 'T' + String(i).padStart(6, '0') }));
  fs.writeFileSync(big.target, JSON.stringify({ schema: 'findash-export/v1', generated_at: generatedAt, priceStoreUpdatedAt: stamp, universeCount: rows.length,
    skipped: Object.fromEntries(SKIP_REASONS.map(r => [r, 0])), rows }));
  assert.ok(fs.statSync(big.target).size > MAX_BYTES);
  const oversized = run('--check', '--v1-dir', big.v1Dir);
  assert.equal(oversized.status, 1);
  assert.match(oversized.stderr, /Size must be between/);
  assert.equal(run('--check', '--v1-dir', path.join(t.dir, 'nowhere')).status, 1);
  assert.equal(run('--unknown').status, 1);
  const self = run('--selftest');
  assert.equal(self.status, 0, self.stderr);
  assert.equal(sha(t.target), hash);
});

// Step order and fail-soft shape of the workflow step, checked on text so that a mutated copy can be shown red.
function workflowErrors(yaml) {
  const text = yaml.replace(/\r\n/g, '\n'), errors = [];
  const names = [...text.matchAll(/^ {6}- name: (.*)$/gm)].map(m => ({ name: m[1].trim(), at: m.index }));
  const at = name => names.filter(n => n.name === name);
  const step = at('Build and check preisschritt (additive, fail-soft)');
  if (step.length !== 1) return ['preisschritt step must exist exactly once (found ' + step.length + ')'];
  const filter = at('Build and check filter universe (additive, fail-soft)'), bewertung = at('Build and check bewertung (additive, fail-soft)');
  const guard = at('Oeffentlicher-Baum-Waechter'), deploy = at('Deploy Scoring Output to GitHub Pages');
  if (filter.length !== 1 || bewertung.length !== 1 || guard.length !== 1 || deploy.length !== 1) return ['anchor steps missing or duplicated'];
  if (!(filter[0].at < bewertung[0].at && bewertung[0].at < step[0].at)) errors.push('must run after the filter universe and bewertung steps');
  if (!(step[0].at < guard[0].at && guard[0].at < deploy[0].at)) errors.push('must run before the public-tree guard and the deploy');
  const next = names.find(n => n.at > step[0].at), body = text.slice(step[0].at, next ? next.at : undefined);
  const run = body.split('\n').filter(l => !l.trim().startsWith('#'));
  if (!/write-preisschritt-export\.js --prices-dir /.test(body) || !/write-preisschritt-export\.js --check/.test(body)) errors.push('must build and then check');
  if (body.indexOf('write-preisschritt-export.js --prices-dir') > body.indexOf('write-preisschritt-export.js --check')) errors.push('check must follow the build');
  if (!/git archive FETCH_HEAD prices\/history/.test(body) || !/git fetch --no-tags origin main/.test(body)) errors.push('must read the store of the main tip, not the stale trigger checkout');
  if (/git (checkout|reset|pull|rebase|merge)/.test(run.join('\n'))) errors.push('must not touch the working tree');
  if (!run.some(l => /rm -rf outputs\/findash-export\/v1\/filter\/preisschritt\.json\*/.test(l))) errors.push('failure must remove only preisschritt.json*');
  if (run.some(l => /rm -rf outputs\/findash-export\/v1\/filter(?!\/preisschritt)/.test(l))) errors.push('must never remove the filter folder or other files');
  if (!run.some(l => /\|\| \{ rm -rf .*; false; \} \|\| true\s*$/.test(l))) errors.push('must be fail-soft (ends with || true)');
  if (/continue-on-error/.test(body.replace(/^\s*#.*$/gm, ''))) errors.push('fail-soft belongs in the shell, as in the bewertung step');
  return errors;
}

test('workflow: the step runs after bewertung, before the public-tree guard and the deploy, and is fail-soft', () => {
  const yaml = fs.readFileSync(workflowFile, 'utf8').replace(/\r\n/g, '\n');
  assert.deepEqual(workflowErrors(yaml), []);
  const sabotage = {
    'step removed': y => y.replace('Build and check preisschritt (additive, fail-soft)', 'Something else'),
    'step moved before bewertung': y => {
      const m = y.match(/\r?\n {6}# A5\/P240[\s\S]*?\|\| true(?=\r?\n)/);
      return y.replace(m[0], '').replace(/\r?\n( {6}# A5\/S2 \(private research tab\))/, m[0] + '\n\n$1');
    },
    'step moved after the guard': y => {
      const m = y.match(/\r?\n {6}# A5\/P240[\s\S]*?\|\| true(?=\r?\n)/);
      return y.replace(m[0], '').replace(/(\r?\n {6}- name: Deploy Scoring Output to GitHub Pages)/, m[0] + '\n$1');
    },
    'fail-soft tail removed': y => y.replace(/(preisschritt\.json could not be built or checked[^\n]*; false; \}) \|\| true/, '$1'),
    'cleanup removed': y => y.replace('rm -rf outputs/findash-export/v1/filter/preisschritt.json*;', ''),
    'cleanup widens to the filter folder': y => y.replace('rm -rf outputs/findash-export/v1/filter/preisschritt.json*;', 'rm -rf outputs/findash-export/v1/filter;'),
    'stale trigger checkout read instead of main tip': y => y.replace('git archive FETCH_HEAD prices/history', 'git archive HEAD prices/history'),
    'working tree touched': y => y.replace('git fetch --no-tags origin main &&', 'git fetch --no-tags origin main && git checkout FETCH_HEAD -- prices/history &&'),
    'check dropped': y => y.replace(/ &&\r?\n\s*node scripts\/write-preisschritt-export\.js --check/, ''),
  };
  for (const [name, mutate] of Object.entries(sabotage)) {
    const broken = mutate(yaml);
    assert.notEqual(broken, yaml, name + ' changed nothing');
    assert.ok(workflowErrors(broken).length > 0, name);
  }
});
