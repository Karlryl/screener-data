'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const test = require('node:test');
const os = require('node:os');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const { gunzipSync } = require('node:zlib');
const root = path.resolve(__dirname, '..');
const live = path.join(root, 'scripts', 'tagesdifferenz.js');
const modulePath = process.env.P167_TEST_MODULE || live;
assert(!process.env.P167_TEST_MODULE || fs.realpathSync(modulePath).startsWith(fs.realpathSync(os.tmpdir()) + path.sep), 'Mutation must stay in the temp folder');
const tool = require(modulePath);
const fixture = path.join(__dirname, 'fixtures', 'tagesdifferenz');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const sample = (ticker, day = 0) => read(path.join(fixture, ['20261007', '20261008'][day], 'snapshots', (ticker === 'SAME' ? '_' : '') + ticker + '.json'));
const boards = [0, 1].map(i => read(path.join(fixture, 'boards', ['2026-10-07', '2026-10-08'][i], 'fixture.json')));
const cases = read(path.join(fixture, 'financial-known-cases.json')).cases;
const row = (ticker, day) => boards[day].cohort.profitable.find(r => r.ticker === ticker);
const classify = (a, b, overlays = []) => tool.classify(a, b, a && b ? tool.differences(a, b) : [], overlays);
const options = { before: path.join(fixture, '20261007', 'snapshots'), after: path.join(fixture, '20261008', 'snapshots'), boards: path.join(fixture, 'boards'), 'hand-table': path.join(fixture, 'financial-known-cases.json') };
let scratch;
function temp() {
  if (!scratch) scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'p167-'));
  return scratch;
}
test.after(() => {
  if (!scratch) return;
  assert(fs.realpathSync(scratch).startsWith(fs.realpathSync(os.tmpdir()) + path.sep));
  fs.rmSync(scratch, { recursive: true });
});

test('NEUES QUARTAL requires an advancing period with a finite value', () => {
  const a = sample('NEW'), b = sample('NEW', 1);
  assert.equal(classify(a, b), 'NEUES QUARTAL');
  b.timeseries.revenueQ[0].value = null;
  assert.equal(classify(a, b), 'NACHLADEN');
});

test('impossible quarter dates cannot establish a new quarter', () => {
  const a = sample('NEW'), b = sample('NEW', 1);
  for (const date of ['2026-06-31', '2026-13-01', 'invalid']) {
    b.timeseries.revenueQEnds[0] = date;
    assert.notEqual(classify(a, b), 'NEUES QUARTAL');
  }
});
test('HANDTABELLE is confirmed against actual PIT, currency and period', () => {
  const a = sample('HAND'), b = sample('HAND', 1);
  const e = tool.tableEvidence('HAND', a, b, row('HAND', 0), row('HAND', 1), cases);
  assert.equal(e.confirmed.length, 1);
  assert.equal(classify(a, b, e.confirmed), 'HANDTABELLE');
  assert.equal(e.confirmed[0].observedAfterUSD, 120);
});
test('RÜCKHALT preserves null as distinct from zero', () => {
  const a = sample('HOLD'), b = sample('HOLD', 1), fresh = structuredClone(row('HOLD', 1));
  assert.equal(classify(a, b, tool.tableEvidence('HOLD', a, b, row('HOLD', 0), fresh, cases).confirmed), 'RÜCKHALT');
  fresh.pit.revenueQ[0] = 0;
  assert.equal(tool.tableEvidence('HOLD', a, b, row('HOLD', 0), fresh, cases).confirmed.length, 0);
});
test('NUR KURS price-only input is not a fundamental reload', () => {
  assert.equal(classify(sample('PRICE'), sample('PRICE', 1)), 'NUR KURS');
  const a = sample('PRICE'), b = sample('PRICE', 1);
  delete a.price; b._quality = { staleSincePriceOnly: '2026-10-08' };
  assert.equal(classify(a, b), 'NUR KURS');
});
test('market field names must match completely', () => {
  for (const field of ['peerCount', 'pensionLiability']) {
    const a = sample('SAME'), b = sample('SAME', 1);
    a.metrics = { [field]: 1 }; b.metrics = { [field]: 2 };
    assert.equal(classify(a, b), 'NACHLADEN');
  }
});
test('NACHLADEN includes reloaded fundamentals, first snapshot and fetchedAt', () => {
  const a = sample('SAME'), b = sample('SAME', 1);
  b.annual.annualRev[1] = 950;
  assert.equal(classify(a, b), 'NACHLADEN');
  assert.equal(classify(null, b), 'NACHLADEN');
  const c = sample('SAME', 1); c.meta.fetchedAt = '2026-10-08T10:00:00Z';
  assert.equal(classify(a, c), 'NACHLADEN');
});
test('NACHLADEN membership explains a first snapshot and prior-day fetch before first ranking', () => {
  const u = [new Map(), new Map([['NEW', []]])], ex = [new Map(), new Map()];
  const detail = { presentBefore: false, presentAfter: true };
  assert.equal(tool.membership('NEW', 'entry', u, ex, detail).reasonClass, 'NACHLADEN');
  const prior = { presentBefore: true, presentAfter: true, snapshotDates: ['2026-10-07', '2026-10-08'], fetchedAt: ['2026-10-07T12:00:00Z', '2026-10-07T12:00:00Z'] };
  const why = tool.membership('NEW', 'entry', u, ex, prior);
  assert.equal(why.reasonClass, 'NACHLADEN'); assert.equal(why.silent, false);
  assert.match(why.reason, /vorherigen Vergleichstag/);
  assert.match(tool.csv([{ ticker: 'NEW', ...why }]), /vorherigen Vergleichstag/);
  for (const fetchedAt of [undefined, null, { absent: true }, 'invalid', '2026-10-06T12:00:00Z', '2026-10-08T12:00:00Z']) {
    assert.equal(tool.membership('NEW', 'entry', u, ex, { ...prior, fetchedAt: [fetchedAt] }).reasonClass, 'UNGEKLÄRT');
  }
  assert.equal(tool.membership('NEW', 'exit', u, ex, prior).reasonClass, 'UNGEKLÄRT');
  assert.equal(tool.membership('NEW', 'entry', u, ex, { ...prior, presentAfter: false }).reasonClass, 'UNGEKLÄRT');
});
test('UNVERÄNDERTE EINGABE ignores timestamps and JSON key order', () => {
  const a = sample('SAME'), b = sample('SAME', 1);
  b.meta = Object.fromEntries(Object.entries(b.meta).reverse());
  assert.equal(classify(a, b), 'UNVERÄNDERTE EINGABE');
});
test('SNAPSHOT FEHLT does not invent a size-floor cause', () => {
  assert.equal(classify(sample('SAME'), null), 'SNAPSHOT FEHLT');
  const why = tool.membership('SAME', 'exit', [new Map([['SAME', []]]), new Map()], [new Map(), new Map()], { presentBefore: true, presentAfter: false });
  assert.equal(why.reasonClass, 'UNGEKLÄRT'); assert.equal(why.silent, true);
});
test('LISTINGWECHSEL requires an excluded alias and a retained representative', () => {
  const ex = tool.exclusions({ rows: [{ ticker: 'OLD', issuerKey: 'issuer', imBoardAls: 'NEW', beine: [{ ticker: 'OLD', reason: 'dup-issuer' }] }] });
  const u = [new Map([['OLD', []]]), new Map([['NEW', []]])];
  const why = tool.membership('OLD', 'exit', u, [new Map(), ex], {});
  assert.equal(why.reasonClass, 'LISTINGWECHSEL'); assert.equal(why.replacementTicker, 'NEW');
  assert.equal(why.exclusions[0].issuerKey, 'issuer');
  u[1].clear(); assert.notEqual(tool.membership('OLD', 'exit', u, [new Map(), ex], {}).reasonClass, 'LISTINGWECHSEL');
});
test('BÖRSENWERTGRENZE requires explicit dated exclusion evidence', () => {
  const ex = tool.exclusions({ rows: [{ ticker: 'LOW', reason: 'market-cap-floor', marketCap: 790000000, threshold: 800000000 }] });
  const why = tool.membership('LOW', 'exit', [new Map([['LOW', []]]), new Map()], [new Map(), ex], { presentBefore: true, presentAfter: false });
  assert.equal(why.reasonClass, 'BÖRSENWERTGRENZE'); assert.equal(why.exclusions[0].threshold, 800000000);
});
test('actual additive sizeExits schema supports the next heartbeat day', () => {
  const exit = { ticker: 'LOW', marketCapUsd: 790000000, floorUsd: 800000000, date: '2026-10-08', source: 'price-only' };
  const doc = { generated_at: '2026-10-08T12:00:00Z', rows: [], sizeExits: [exit] };
  const ex = tool.exclusions(doc);
  assert.equal(tool.membership('LOW', 'exit', [new Map(), new Map()], [new Map(), ex], {}).reasonClass, 'BÖRSENWERTGRENZE');
  for (const patch of [{ marketCapUsd: null }, { marketCapUsd: 800000000 }, { date: '2026-10-07' }]) {
    assert.throws(() => tool.exclusions({ ...doc, sizeExits: [{ ...exit, ...patch }] }), /Invalid\/stale/);
  }
});
test('missing, null and zero remain different evidence values', () => {
  assert.deepEqual(tool.differences({ metrics: {} }, { metrics: { x: null } }), [{ field: 'metrics.x', old: { absent: true }, new: null }]);
  assert.deepEqual(tool.differences({ metrics: { x: null } }, { metrics: { x: 0 } }), [{ field: 'metrics.x', old: null, new: 0 }]);
});
test('current table, wrong currency/period and annual entries cannot prove activation', () => {
  const a = sample('HAND'), b = sample('HAND', 1), old = row('HAND', 0), fresh = row('HAND', 1);
  for (const changes of [{ currency: 'EUR' }, { period: '2026-06-30' }, { field: 'annualRev' }]) {
    assert.equal(tool.tableEvidence('HAND', a, b, old, fresh, [{ ...cases[0], ...changes }]).confirmed.length, 0);
  }
  assert.equal(tool.tableEvidence('HAND', a, b, old, old, cases).confirmed.length, 0);
  const zero = structuredClone(old); zero.pit.revenueQ[0] = 0;
  a.timeseries.revenueQ[0].value = 0; b.timeseries.revenueQ[0].value = 0;
  assert.equal(tool.tableEvidence('HAND', a, b, zero, fresh, [{ ...cases[0], expectedBadValue: null }]).confirmed.length, 0);
});
test('table listing aliases and USD conversion are validated', () => {
  const c = { ...cases[0], ticker: 'OTHER', listingAliases: ['HAND'], currency: 'EUR' };
  const old = structuredClone(row('HAND', 0)), fresh = structuredClone(row('HAND', 1));
  const a = sample('HAND'), b = sample('HAND', 1);
  for (const r of [old, fresh]) { r.pit.reportingCurrencyOriginal = 'EUR'; r.pit.fxRateApplied = 2; r.pit.revenueQ = r.pit.revenueQ.map(x => x * 2); }
  for (const s of [a, b]) s.timeseries.revenueQ = s.timeseries.revenueQ.map(x => ({ value: x.value * 2 }));
  assert.equal(tool.tableEvidence('HAND', a, b, old, fresh, [c]).confirmed.length, 1);
});
test('fixture run is byte-deterministic and has exactly ten snapshots/two boards', () => {
  const out = path.join(temp(), 'outputs');
  const first = tool.run({ ...options, out });
  const before = fs.readdirSync(out).map(n => [n, fs.readFileSync(path.join(out, n), 'utf8')]);
  const second = tool.run({ ...options, out });
  assert.deepEqual(first.summary, second.summary);
  assert.deepEqual(before, fs.readdirSync(out).map(n => [n, fs.readFileSync(path.join(out, n), 'utf8')]));
  assert.deepEqual(first.summary.historyTickers, [5, 5]);
  assert.equal(first.summary.snapshots.before + first.summary.snapshots.after, 10);
  assert.equal(first.summary.boardCounts.length, 1);
  assert.equal(first.rows.find(r => r.ticker === 'SAME').evidence.sources[0].endsWith('_SAME.json'), true);
  assert.match(tool.markdown(first, tool.load(options)), /keine angezeigten Ränge/);
});
test('unchanged null scores/ranks do not manufacture changed rows', () => {
  const d = tool.load(options);
  for (const day of d.boards) for (const b of day.values()) for (const r of b.cohort.profitable) {
    if (r.ticker === 'SAME') { r.rank = null; r.score = null; }
  }
  assert.equal(tool.analyze(d).rows.some(r => r.ticker === 'SAME'), false);
});
test('global membership is separate from cohort changes', () => {
  const d = tool.load(options), b = d.boards[1].get('fixture');
  const moved = b.cohort.profitable.pop(); b.cohort.unprofitable = [moved];
  const result = tool.analyze(d);
  assert.equal(result.exits.length, 0); assert.equal(result.entries.length, 0);
  assert.equal(result.rows.filter(r => r.reasonClass === 'LISTENWECHSEL').length, 2);
});
test('moves20 includes exactly twenty places in both directions, excludes nineteen', () => {
  for (const [delta, expected] of [[-21, 1], [-20, 1], [-19, 0], [0, 0], [19, 0], [20, 1], [21, 1]]) {
    const d = tool.load(options);
    for (const bs of d.boards) for (const b of bs.values()) for (const r of b.cohort.profitable) r.rank = 100;
    d.boards[1].get('fixture').cohort.profitable.find(r => r.ticker === 'SAME').rank += delta;
    const result = tool.analyze(d);
    assert.equal(result.summary.historyMoves20, expected, String(delta));
    assert.equal(result.summary.boardCounts[0].moves20, expected, String(delta));
  }
});
test('artifact size exits explain removals without an exclusion export and carry a source hash', () => {
  const d = tool.load(options);
  for (const rows of [undefined, null, false, '']) {
    assert.throws(() => tool.exclusions({ date: '2026-10-08', rows }, d.sizeManifests[1]), /must contain rows/);
  }
  const b = d.boards[1].get('fixture');
  b.cohort.profitable = b.cohort.profitable.filter(r => r.ticker !== 'PRICE');
  const result = tool.analyze(d);
  assert.equal(result.summary.floorExits, 1);
  assert.equal(result.summary.silentExits, 0);
  assert.deepEqual(result.summary.excludedAvailable, [false, false]);
  assert.deepEqual(result.summary.sizeManifestAvailable, [true, true]);
  assert.deepEqual(result.summary.sizeExitsKnown, [true, true]);
  const input = d.inputs.find(i => i.source === path.join(options.after, '_manifest-size-exits.json'));
  assert.equal(input.sha256, crypto.createHash('sha256').update(fs.readFileSync(input.source)).digest('hex'));
  d.exDocs[1] = { date: '2026-10-08', rows: [], sizeExitsKnown: true, sizeExits: d.sizeManifests[1].exits };
  d.sizeManifests[1].known = false;
  const unknown = tool.analyze(d);
  assert.equal(unknown.summary.floorExits, 0);
  assert.equal(unknown.summary.silentExits, 1);
  assert.match(unknown.exits[0].reason, /Größenabgänge sind unbekannt/);
});
test('reversed dates, partial boards and stale exclusions fail closed', () => {
  assert.throws(() => tool.load({ ...options, before: options.after, after: options.before }), /ascending/);
  const copy = path.join(temp(), 'boards'); fs.cpSync(options.boards, copy, { recursive: true });
  const p = path.join(copy, '2026-10-08', 'fixture.json'); const b = read(p); b.date = '2026-10-06'; fs.writeFileSync(p, JSON.stringify(b));
  assert.throws(() => tool.load({ ...options, boards: copy }), /Wrong date/);
  b.date = '2026-10-08'; delete b.cohort.profitable;
  fs.writeFileSync(p, JSON.stringify(b));
  assert.throws(() => tool.load({ ...options, boards: copy }), /Missing declared board cohort/);
  b.cohort.profitable = boards[1].cohort.profitable.slice(1);
  fs.writeFileSync(p, JSON.stringify(b));
  assert.throws(() => tool.load({ ...options, boards: copy }), /Truncated board cohort/);
  const excluded = path.join(temp(), 'excluded.json'); fs.writeFileSync(excluded, JSON.stringify({ date: '2026-10-06', rows: [] }));
  assert.throws(() => tool.load({ ...options, 'excluded-after': excluded }), /Stale/);
});
test('empty snapshot dates fail instead of appearing fresh', () => {
  const base = path.join(temp(), 'bad-date'); fs.cpSync(options.after, path.join(base, '20261008', 'snapshots'), { recursive: true });
  const p = path.join(base, '20261008', 'snapshots', 'NEW.json'), s = read(p);
  s.meta.asOf = ''; fs.writeFileSync(p, JSON.stringify(s));
  assert.throws(() => tool.analyze(tool.load({ ...options, after: path.dirname(p) })), /Undated/);
});
test('snapshot identity comes from meta.ticker even after filename changes', () => {
  const base = path.join(temp(), 'rename', '20261008', 'snapshots'); fs.cpSync(options.after, base, { recursive: true });
  fs.renameSync(path.join(base, 'NEW.json'), path.join(base, '_different-name.json'));
  const result = tool.analyze(tool.load({ ...options, after: base }));
  assert.equal(result.summary.snapshots.removed, 0); assert.equal(result.summary.snapshots.added, 0);
  assert.equal(result.rows.find(r => r.ticker === 'NEW').class, 'NEUES QUARTAL');
  fs.writeFileSync(path.join(base, '_manifest-size-exits.json'), '[]');
  assert.throws(() => tool.load({ ...options, after: base }), /size-exits\/v2 manifest/);
  const manifest = read(path.join(options.after, '_manifest-size-exits.json'));
  for (const patch of [{ schema: 'size-exits/v1' }, { known: 'true' }, { runDate: '2026-10-07' }, { exits: {} }]) {
    fs.writeFileSync(path.join(base, '_manifest-size-exits.json'), JSON.stringify({ ...manifest, ...patch }));
    assert.throws(() => tool.load({ ...options, after: base }), /size-exits\/v2 manifest/);
  }
  fs.writeFileSync(path.join(base, '_manifest-size-exits.json'), JSON.stringify(manifest));
  assert.equal(tool.analyze(tool.load({ ...options, after: base })).summary.snapshots.after, 5);
});
test('underscore-prefixed boards are validated and unknown metadata fails closed', () => {
  const copy = path.join(temp(), 'underscore-boards');
  fs.cpSync(options.boards, copy, { recursive: true });
  for (const day of ['2026-10-07', '2026-10-08']) {
    fs.copyFileSync(path.join(copy, day, 'fixture.json'), path.join(copy, day, '_board.json'));
    fs.writeFileSync(path.join(copy, day, 'calibration.json'), '{}');
    fs.writeFileSync(path.join(copy, day, 'regime.json'), '{}');
    fs.writeFileSync(path.join(copy, day, '_excluded.json'), JSON.stringify({ date: day, rows: [] }));
  }
  const loaded = tool.load({ ...options, boards: copy });
  assert.deepEqual([...loaded.boards[0].keys()], ['_board', 'fixture']);
  assert.equal(loaded.exDocs[1].date, '2026-10-08');
  fs.writeFileSync(path.join(copy, '2026-10-08', '_unknown.json'), '{}');
  assert.throws(() => tool.load({ ...options, boards: copy }), /Wrong date or missing cohort: _unknown.json/);
});

test('board directory junction cannot escape the declared input root', () => {
  const base = path.join(temp(), 'junction-boards'); fs.mkdirSync(base);
  fs.symlinkSync(path.join(options.boards, '2026-10-07'), path.join(base, '2026-10-07'), 'junction');
  assert.throws(() => tool.load({ ...options, boards: base }), /regular file within/);
});
test('CSV text cannot become an executable spreadsheet formula', () => {
  const text = tool.csv([{ ticker: '=1+1', name: ' @SUM(1)', scoreDelta: -5 }]);
  assert(text.includes('"\'=1+1"')); assert(text.includes('"\' @SUM(1)"'));
  assert(text.includes('"-5"')); assert(!text.includes('"\'-5"'));
});
test('CSV preserves missing, null, empty text and zero, including board rank and score', () => {
  const cells = line => [...line.matchAll(/"((?:""|[^"])*)"(?:,|$)/g)].map(m => m[1].replaceAll('""', '"'));
  const text = tool.csv([{ rankBefore: null, scoreBefore: 0, name: '' }]).trimEnd().split('\n');
  const record = Object.fromEntries(cells(text[0]).map((key, i) => [key, cells(text[1])[i]]));
  assert.equal(record.rankBefore, 'null');
  assert.equal(record.rankAfter, '{"absent":true}');
  assert.equal(record.scoreBefore, '0'); assert.equal(record.name, '');
  const d = tool.load(options), a = d.boards[0].get('fixture').cohort.profitable[0], b = d.boards[1].get('fixture').cohort.profitable.find(r => r.ticker === a.ticker);
  a.rank = null; delete b.rank; a.score = 0; b.score = null;
  const changed = tool.analyze(d).rows.find(r => r.ticker === a.ticker);
  assert.equal(changed.rankBefore, null); assert.deepEqual(changed.rankAfter, { absent: true });
  assert.equal(changed.scoreBefore, 0); assert.equal(changed.scoreAfter, null);
  assert.match(tool.csv([changed]), /"null","\{""absent"":true\}","null","0","null"/);
});
test('input output overlap and replacement of prior results are rejected', () => {
  assert.throws(() => tool.run({ ...options, out: path.join(options.before, 'no-write') }), /overlaps|outside/);
  assert.equal(fs.existsSync(path.join(options.before, 'no-write')), false);
  const out = path.join(temp(), 'existing'); fs.mkdirSync(out); fs.writeFileSync(path.join(out, 'abgaenge.csv'), 'retained history');
  assert.throws(() => tool.run({ ...options, out }), /Refusing to overwrite/);
  assert.equal(fs.readFileSync(path.join(out, 'abgaenge.csv'), 'utf8'), 'retained history');
  assert.throws(() => tool.run({ ...options, out: path.join(root, 'forbidden-output') }), /outside/);
});

test('AUSSCHLUSS preserves explicit non-listing exclusion reasons', () => {
  const ex = tool.exclusions({ rows: [{ ticker: 'LOW', reason: 'missing-market-cap' }] });
  const why = tool.membership('LOW', 'exit', [new Map(), new Map()], [new Map(), ex], {});
  assert.equal(why.reasonClass, 'AUSSCHLUSS');
  assert.equal(why.silent, false);
});

test('UNGEKLÄRT leaves unexplained entries visible', () => {
  const why = tool.membership('SAME', 'entry', [new Map(), new Map()], [new Map(), new Map()], { presentBefore: true, presentAfter: true });
  assert.equal(why.reasonClass, 'UNGEKLÄRT');
  assert.equal(why.silent, true);
});

test('P155 retained size exits do not become new daily exits', () => {
  const exit = { ticker: 'LOW', marketCapUsd: 790000000, floorUsd: 800000000, date: '2026-10-09', source: 'price-only' };
  const doc = { generated_at: '2026-10-10T12:00:00Z', rows: [], sizeExitsKnown: true, sizeExits: [exit] };
  assert.equal(tool.exclusions(doc).has('LOW'), false);
  assert.equal(tool.exclusions({ ...doc, sizeExits: [{ ...exit, date: '2026-10-10' }] }).has('LOW'), true);
  for (const date of ['2026-10-11', '2026-02-30', 'invalid']) {
    assert.throws(() => tool.exclusions({ ...doc, sizeExits: [{ ...exit, date }] }), /Invalid\/stale/);
  }
});
test('P155 unknown size coverage retains historical evidence without aborting or inventing exits', () => {
  const prior = { ticker: 'LOW', marketCapUsd: 790000000, floorUsd: 800000000, date: '2026-10-09', source: 'price-only' };
  const doc = { generated_at: '2026-10-10T12:00:00Z', rows: [], sizeExitsKnown: false, sizeExits: [prior, { ...prior, ticker: 'TODAY', date: '2026-10-10' }] };
  const ex = tool.exclusions(doc);
  assert.equal(ex.size, 0);
  const why = tool.membership('LOW', 'exit', [new Map(), new Map()], [new Map(), ex], {}, [true, false]);
  assert.equal(why.reasonClass, 'UNGEKLÄRT'); assert.equal(why.silent, true);
  assert.match(why.reason, /kein vollständiger Bericht dieses Laufs/);
  assert.match(tool.csv([{ ticker: 'LOW', ...why }]), /kein vollständiger Bericht dieses Laufs/);
  assert.throws(() => tool.exclusions({ ...doc, sizeExits: [{ ...prior, marketCapUsd: null }] }), /Invalid\/stale/);
});

test('default output is compact and full changes are explicitly gzip-compressed', () => {
  const out = path.join(temp(), 'compact');
  const result = tool.run({ ...options, out });
  assert.deepEqual(fs.readdirSync(out).sort(), ['abgaenge.csv', 'nachweis.json', 'tagesdifferenz-2026-10-07-2026-10-08.md', 'zugaenge.csv']);
  assert.equal(Object.values(result.summary.classCounts).reduce((a, b) => a + b, 0), result.rows.length);
  assert.match(tool.markdown(result, tool.load(options)), /nur mit --full-changes/);
  const full = path.join(temp(), 'full');
  tool.run({ ...options, out: full, 'full-changes': true });
  const bytes = fs.readFileSync(path.join(full, 'aenderungen.csv.gz'));
  assert.match(fs.readFileSync(path.join(full, 'tagesdifferenz-2026-10-07-2026-10-08.md'), 'utf8'), /sowie in aenderungen\.csv\.gz/);
  assert.equal(gunzipSync(bytes).toString(), tool.csv(result.rows));
  const second = path.join(temp(), 'full-again');
  tool.run({ ...options, out: second, 'full-changes': true });
  assert.deepEqual(fs.readdirSync(full).sort(), fs.readdirSync(second).sort());
  for (const name of fs.readdirSync(full)) assert.deepEqual(fs.readFileSync(path.join(full, name)), fs.readFileSync(path.join(second, name)));
});

test('output is required and checkout paths, junctions and conflicting files fail closed', () => {
  assert.throws(() => tool.run(options), /Required: --out/);
  const checkoutAlias = path.join(temp(), 'checkout-alias');
  fs.symlinkSync(root, checkoutAlias, 'junction');
  assert.throws(() => tool.run({ ...options, out: path.join(checkoutAlias, 'no-write') }), /outside/);
  const inputAlias = path.join(temp(), 'input-alias');
  fs.symlinkSync(options.before, inputAlias, 'junction');
  assert.throws(() => tool.run({ ...options, out: path.join(inputAlias, 'no-write') }), /outside|overlaps/);
  const out = path.join(temp(), 'linked-output');
  fs.mkdirSync(out);
  fs.symlinkSync(options.boards, path.join(out, 'abgaenge.csv'), 'junction');
  assert.throws(() => tool.run({ ...options, out }), /Refusing/);
  assert.equal(fs.existsSync(path.join(out, 'nachweis.json')), false);
  const conflict = path.join(temp(), 'gzip-conflict');
  fs.mkdirSync(conflict);
  fs.writeFileSync(path.join(conflict, 'aenderungen.csv.gz'), 'retained bytes');
  assert.throws(() => tool.run({ ...options, out: conflict, 'full-changes': true }), /Refusing/);
  assert.equal(fs.readFileSync(path.join(conflict, 'aenderungen.csv.gz'), 'utf8'), 'retained bytes');
  assert.equal(fs.existsSync(path.join(conflict, 'nachweis.json')), false);
});

test('CLI accepts the gzip flag and rejects missing output without writing', () => {
  const args = Object.entries(options).flatMap(([key, v]) => ['--' + key, v]);
  const out = path.join(temp(), 'cli');
  const ok = cp.spawnSync(process.execPath, [live, ...args, '--out', out, '--full-changes'], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Vom 2026-10-07 zum 2026-10-08/);
  assert(fs.existsSync(path.join(out, 'aenderungen.csv.gz')));
  const bad = cp.spawnSync(process.execPath, [live, ...args], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Required: --out/);
});

test('break-once turns the pure NUR KURS class test red and preserves the live source', t => {
  // Only the read-only class test is targeted; tests that write are never mutation targets.
  const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  const before = hash(live), source = fs.readFileSync(live, 'utf8');
  const target = path.join(temp(), 'mutant.js');
  assert(path.resolve(target) !== fs.realpathSync(live));
  assert(fs.realpathSync(path.dirname(target)).startsWith(fs.realpathSync(os.tmpdir()) + path.sep));
  const anchor = "  return deltas.length ? 'NUR KURS' : 'UNVERÄNDERTE EINGABE';";
  const lines = source.split(/\r?\n/);
  assert.equal(lines.filter(line => line === anchor).length, 1, 'Whole-line anchor must occur exactly once');
  lines[lines.indexOf(anchor)] = "  return 'UNVERÄNDERTE EINGABE';";
  try {
    fs.writeFileSync(target, lines.join('\n'), { flag: 'wx' });
    assert.equal(hash(live), before);
    const env = { ...process.env, P167_TEST_MODULE: target };
    for (const key of Object.keys(env)) if (key.toUpperCase() === 'NODE_TEST_CONTEXT') delete env[key];
    const result = cp.spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern=^NUR KURS ', __filename], { encoding: 'utf8', env });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /not ok.*NUR KURS/);
    assert.match(result.stdout, /# fail 1\b/);
    t.diagnostic(result.stdout.trim());
    t.diagnostic(JSON.stringify({ expectedExit: 1, actualExit: result.status, liveSha256Before: before, liveSha256After: hash(live) }));
  } finally {
    assert.equal(hash(live), before, 'Live source changed; abort');
  }
});

test('break-once kills the entry-rule and inclusive-twenty mutants without changing live files', t => {
  // Only read-only membership and analysis tests are targeted, never writing tests.
  const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  const before = hash(live), source = fs.readFileSync(live, 'utf8');
  const mutations = [
    ['entry', "  if (direction === 'entry' && !detail.presentBefore && detail.presentAfter) return { reasonClass: 'NACHLADEN', silent: false, confidencePct: 95, reason: 'Der Firmensnapshot ist erstmals im neueren Eingang vorhanden.', exclusions: [] };", '', '^NACHLADEN membership'],
    ['twenty', '        if (rankDelta !== null && Math.abs(rankDelta) >= 20) count.moves20++;', '        if (rankDelta !== null && Math.abs(rankDelta) > 20) count.moves20++;', '^moves20 includes']
  ];
  for (const [name, anchor, replacement, pattern] of mutations) {
    const target = path.join(temp(), 'mutant-' + name + '.js');
    assert(path.resolve(target) !== fs.realpathSync(live));
    assert(fs.realpathSync(path.dirname(target)).startsWith(fs.realpathSync(os.tmpdir()) + path.sep));
    const lines = source.split(/\r?\n/);
    assert.equal(lines.filter(line => line === anchor).length, 1, 'Whole-line anchor must occur exactly once');
    lines[lines.indexOf(anchor)] = replacement;
    try {
      fs.writeFileSync(target, lines.join('\n'), { flag: 'wx' });
      assert.equal(hash(live), before);
      const env = { ...process.env, P167_TEST_MODULE: target };
      for (const key of Object.keys(env)) if (key.toUpperCase() === 'NODE_TEST_CONTEXT') delete env[key];
      const result = cp.spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern=' + pattern, __filename], { encoding: 'utf8', env });
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stdout, new RegExp('not ok.*' + pattern.slice(1)));
      assert.match(result.stdout, /# fail 1\b/);
      t.diagnostic(JSON.stringify({ mutant: name, expectedExit: 1, actualExit: result.status, liveSha256Before: before, liveSha256After: hash(live) }));
    } finally {
      assert.equal(hash(live), before, 'Live source changed; abort');
    }
  }
});
