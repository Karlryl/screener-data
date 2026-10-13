'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { buildUniverse, growth3, validateUniverse, build, ROW_KEYS, NUMBER_KEYS, MAX_BYTES } = require('../scripts/write-filter-universe.js');
const { mischVal, mischVerhaeltnisUnkorrigiert } = require('../scripts/write-board-history.js');
const { MAX_FCF_MARGIN_PCT } = require('../scripts/write-rule40-export.js');
const snapshots = require('./fixtures/w6/snapshots.json');
const generatedAt = '2026-10-10T12:00:00Z';
const boards = new Map([['PAY', { branch: 'software-comm-services', row: { score: 73.456, rank: 7, marketCap: 1e9, revGrowthYoYPct: 10 } }]]);
const excluded = new Map([['MIX', ['dup-issuer']], ['BANK', ['balance-sheet-bank']], ['DUP', ['dup-issuer']], ['BAD', ['data-suspect']]]);
const make = (list = snapshots) => buildUniverse({ snapshots: list, boards, excluded, generatedAt });

test('all snapshots survive, official score/rank are exact, and flags survive', () => {
  const before = JSON.stringify(snapshots), feed = make();
  assert.equal(feed.rows.length, snapshots.length);
  assert.equal(JSON.stringify(snapshots), before);
  assert.deepEqual(validateUniverse(feed, Buffer.byteLength(JSON.stringify(feed))), []);
  const payer = feed.rows.find(r => r.t === 'PAY');
  assert.equal(payer.sc, 73.456);
  assert.equal(payer.rk, 7);
  assert.equal(payer.b, 'software-comm-services');
  assert.equal(payer.d52, -20);
  assert.equal(payer.g3, 10);
  assert.equal(payer.fcf, 20);
  assert.equal(payer.r40, 30);
  assert.equal(payer.asOf, '2026-10-02');
  for (const row of feed.rows) {
    assert.deepEqual(Object.keys(row), ROW_KEYS.filter(key => Object.hasOwn(row, key)));
    for (const key of ['t', 'peSt', 'dySt', 'aus']) assert.ok(Object.hasOwn(row, key));
    assert.ok(Object.values(row).every(value => value !== null));
    assert.ok(!Object.hasOwn(row, 'g10'));
  }
  for (const ticker of ['DUP', 'BAD', 'BANK']) {
    const row = feed.rows.find(r => r.t === ticker);
    assert.equal(row.b, undefined);
    assert.equal(row.sc, undefined);
    assert.equal(row.rk, undefined);
    assert.deepEqual(row.aus, ticker === 'BAD' ? ['data-suspect'] : [...excluded.get(ticker), 'data-suspect']);
  }
});

test('sales ratios follow PIT FX evidence while both PE ratios stay strict', () => {
  const row = make().rows.find(r => r.t === 'MIX');
  assert.equal(row.ps, 4);
  assert.equal(row.evs, 5);
  for (const field of ['pe', 'fpe']) assert.equal(row[field], undefined);
  assert.equal(row.peSt, 'waehrung');
  assert.ok(row.aus.includes('mischwaehrung'));
  for (const factor of [undefined, null, '0.03', NaN, Infinity]) {
    const copy = structuredClone(snapshots);
    copy[1].meta.mischVerhaeltnisFaktor = factor;
    const uncorrected = make(copy).rows.find(r => r.t === 'MIX');
    for (const field of ['ps', 'evs', 'pe', 'fpe']) assert.equal(uncorrected[field], undefined);
    assert.equal(uncorrected.peSt, 'waehrung');
  }
  const pence = structuredClone(snapshots);
  pence[0].meta.reportingCurrencyOriginal = 'GBP';
  pence[0].meta.tradingCurrencyOriginal = 'GBp';
  const pennyRow = make(pence).rows.find(r => r.t === 'PAY');
  assert.equal(pennyRow.ps, 4);
  assert.equal(pennyRow.evs, 5);
  for (const field of ['pe', 'fpe']) assert.equal(pennyRow[field], undefined);
  assert.equal(pennyRow.peSt, 'waehrung');
  for (const list of [snapshots, pence]) for (const source of list) {
    const actual = make(list).rows.find(r => r.t === source.meta.ticker);
    const withheld = mischVerhaeltnisUnkorrigiert(source.meta);
    assert.equal(actual.ps ?? null, mischVal(source.metrics.priceSales, withheld));
    assert.equal(actual.evs ?? null, mischVal(source.metrics.enterpriseToRevenue, withheld));
  }
});

test('CAGR requires both positive endpoints and preserves missing slots', () => {
  for (const [a, b] of [[null, 100], [100, null], [0, 100], [100, 0], [-100, 100], [100, -100]]) {
    assert.equal(growth3({ annual: { annualRev: [{ value: a }, { value: 9 }, { value: 8 }, { value: b }] } }), null);
  }
  assert.equal(growth3({ annual: { annualRev: [{ value: 133.1 }, null, null, { value: 100 }] } }), 10);
  assert.equal(growth3({ annual: { annualRev: [{ value: 100 }] } }), null);
  const gapped = structuredClone(snapshots[0]);
  gapped.annual.annualRevEnds[3] = '2020-12-31';
  assert.equal(growth3(gapped), null);
});

test('missing metrics are omitted; real zero is preserved and old dividend null is unknown', () => {
  const feed = make(), bank = feed.rows.find(r => r.t === 'BANK'), dup = feed.rows.find(r => r.t === 'DUP');
  for (const key of NUMBER_KEYS) assert.equal(bank[key], undefined, key);
  assert.equal(bank.peSt, 'verlust');
  assert.equal(bank.dySt, 'unbekannt');
  // W6c: no gross-margin zero has source evidence; payout zero remains valid without payer status.
  assert.equal(dup.gm, undefined);
  assert.equal(dup.po, 0);
  assert.equal(feed.rows.find(r => r.t === 'MIX').dySt, 'keine');
  const copy = structuredClone(snapshots);
  delete copy[0].metrics.dividendStatus;
  assert.equal(make(copy).rows.find(r => r.t === 'PAY').dySt, 'zahlt');
  copy[0].metrics.dividendYield.value = 0.001;
  const small = make(copy);
  assert.equal(small.rows.find(r => r.t === 'PAY').dy, 0.001);
  assert.equal(small.rows.find(r => r.t === 'PAY').dySt, 'zahlt');
  assert.deepEqual(validateUniverse(small, Buffer.byteLength(JSON.stringify(small))), []);
  copy[0].metrics.dividendStatus = { value: 'unbekannt' };
  const unknown = make(copy).rows.find(r => r.t === 'PAY');
  assert.equal(unknown.dy, undefined);
  assert.equal(unknown.dySt, 'unbekannt');
});

test('payer payout and all gross-margin zeros are missing; other payout zeros survive', () => {
  const copy = structuredClone(snapshots);
  copy[0].metrics.payoutRatio.value = 0;
  copy[0].metrics.grossMargin.value = 0;
  copy[2].metrics.grossMargin = { value: 0 };
  copy[2].metrics.payoutRatio = { value: 0 };
  const feed = make(copy);
  assert.equal(feed.rows.find(r => r.t === 'PAY').po, undefined);
  // W6c replaces the non-financial zero pin because these margins are also undocumented.
  assert.equal(feed.rows.find(r => r.t === 'PAY').gm, undefined);
  assert.equal(feed.rows.find(r => r.t === 'BANK').gm, undefined);
  assert.equal(feed.rows.find(r => r.t === 'BANK').po, 0);
  copy[2].metrics.grossMargin.value = 0.001;
  assert.equal(make(copy).rows.find(r => r.t === 'BANK').gm, 0.001);
  for (const index of [0, 2]) for (const value of [0, -0, undefined, null, NaN, Infinity, 0.001, -0.001, 60, -20]) {
    copy[index].metrics.grossMargin.value = value;
    const result = make(copy);
    const row = result.rows.find(r => r.t === copy[index].meta.ticker);
    assert.equal(row.gm, Number.isFinite(value) && value !== 0 ? value : undefined);
    assert.deepEqual(validateUniverse(result, Buffer.byteLength(JSON.stringify(result))), []);
  }
  copy[0].metrics.payoutRatio.value = 0.001;
  assert.equal(make(copy).rows.find(r => r.t === 'PAY').po, 0.001);
});

test('52-week distance clamps small new highs and flags implausible scale differences', () => {
  for (const [price, high, expected, implausible = false] of [[130, 125, 0], [125, 125, 0], [100, 125, -20],
    [150, 125, 0], [150.01, 125, undefined, true], [5, 100, -95], [4.999, 100, undefined, true],
    [1e-6, 125, undefined, true],
    // Actual 10 October source pairs: MOHCF, 8303.T and BCG.L.
    [72.89, 24.45, undefined, true], [9.068159625, 350979580.530933, undefined, true], [2.6355895776, 352.72276875, undefined, true],
    [0, 125, undefined], [-1, 125, undefined], [100, 0, undefined], [100, -1, undefined], [NaN, 125, undefined], [100, Infinity, undefined]]) {
    const copy = structuredClone(snapshots);
    copy[0].price.regularMarketPrice = price;
    copy[0].metrics.fiftyTwoWeekHigh.value = high;
    const row = make(copy).rows.find(r => r.t === 'PAY');
    assert.equal(row.d52, expected);
    assert.equal(row.aus.includes('d52-implausible'), implausible);
    assert.deepEqual(validateUniverse(make(copy), 1000), []);
  }
});

test('asOf keeps the oldest source UTC date, including timestamp offsets', () => {
  const copy = structuredClone(snapshots);
  copy[0].metrics.pe.asOf = '2026-10-01T00:30:00+02:00';
  assert.equal(make(copy).rows.find(r => r.t === 'PAY').asOf, '2026-09-30');
  copy[4].meta.asOf = null;
  assert.equal(make(copy).rows.find(r => r.t === 'BAD').asOf, undefined);
});

test('invalid FCF never becomes a growth-only rule of 40', () => {
  for (const change of [s => { delete s.metrics.fcfMarginTTM; }, s => { s.annual.annualFCF = []; }, s => { s.meta.fcfMarginTTMSuppressed = true; },
    s => { s.metrics.fcfMarginTTM.value = MAX_FCF_MARGIN_PCT + 0.001; }]) {
    const copy = structuredClone(snapshots); change(copy[0]);
    const row = make(copy).rows.find(r => r.t === 'PAY');
    assert.equal(row.fcf, undefined);
    assert.equal(row.r40, undefined);
  }
  const copy = structuredClone(snapshots);
  copy[0].metrics.fcfMarginTTM.value = MAX_FCF_MARGIN_PCT;
  assert.equal(make(copy).rows.find(r => r.t === 'PAY').fcf, MAX_FCF_MARGIN_PCT);
  assert.equal(make(copy).rows.find(r => r.t === 'PAY').r40, 110);
  copy[0].annual.annualRev[1].value = 1;
  assert.equal(make(copy).rows.find(r => r.t === 'PAY').r40, undefined);
});

test('Rule40 percentage bounds stay in the correct unit when winsorization activates', () => {
  const list = Array.from({ length: 200 }, (_, i) => {
    const snapshot = structuredClone(snapshots[0]);
    snapshot.meta.ticker = 'PAY' + i;
    return snapshot;
  });
  const official = new Map(list.map(s => [s.meta.ticker, boards.get('PAY')]));
  const feed = buildUniverse({ snapshots: list, boards: official, generatedAt });
  assert.equal(feed.rows.length, 200);
  for (const row of feed.rows) { assert.equal(row.g, 10); assert.equal(row.fcf, 20); assert.equal(row.r40, 30); }
});

test('validator rejects bad shape, both directions of states, currencies, count and size', () => {
  const mutations = [
    f => { delete f.rows[0].dySt; }, f => { f.rows[0].dy = 0; },
    f => { delete f.rows[0].peSt; }, f => { f.rows[0].g3 = null; },
    f => { f.rows.find(r => r.t === 'PAY').dySt = 'unbekannt'; },
    f => { f.rows.find(r => r.t === 'PAY').peSt = 'verlust'; },
    f => { f.rows.find(r => r.t === 'MIX').fpe = 1; },
    f => { f.rows[0].g = '0'; }, f => { f.rows[0].g = Infinity; },
    f => { f.rows.push(f.rows[0]); f.snapshotCount++; }, f => { f.snapshotCount--; },
    f => { f.rows[0].unexpected = 1; }, f => { f.rows[0].asOf = 'not-a-date'; },
    f => { f.rows[0].asOf = '2026-10-10T12:00:00Z'; }, f => { f.rows[0].asOf = '2026-02-30'; },
    f => { f.rows[0].d52 = 0.01; }, f => { f.rows[0].d52 = -100.01; },
    f => { f.rows.find(r => r.t === 'PAY').aus.push('d52-implausible'); },
    f => { f.rows[0].fcf = MAX_FCF_MARGIN_PCT + 0.01; },
    f => { f.rows.find(r => r.t === 'PAY').po = 0; },
    f => { f.rows.find(r => r.t === 'BANK').gm = 0; },
    f => { f.rows.find(r => r.t === 'PAY').gm = 0; },
  ];
  for (const mutate of mutations) { const feed = make(); mutate(feed); assert.ok(validateUniverse(feed, 1000).length); }
  assert.ok(validateUniverse(make(), MAX_BYTES + 1).some(e => e.includes('Size')));
  assert.deepEqual(validateUniverse(make(), MAX_BYTES), []);
  const absent = make(); delete absent.rows.find(r => r.t === 'PAY').g3;
  assert.deepEqual(validateUniverse(absent, Buffer.byteLength(JSON.stringify(absent))), []);
});

test('filter contract is appended after the unchanged section numbers 15 and 16', () => {
  const contract = fs.readFileSync(path.resolve(__dirname, '../docs/findash-export-v1.md'), 'utf8');
  const headings = contract.split(/\r?\n/).filter(line => /^## \d+\./.test(line));
  assert.match(headings.at(-3), /^## 15\. `fcfShadow`/);
  assert.match(headings.at(-2), /^## 16\. `annualPairsShadow`/);
  assert.match(headings.at(-1), /^## 17\. `filter\/`/);
});

test('CLI checks a real file and rejects a corrupted copy without touching the good file', () => {
  // Only generated fixture copies are break targets; never mutate a writer or live artifact.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w6-check-'));
  const good = path.join(dir, 'good'), bad = path.join(dir, 'bad');
  const live = path.resolve(__dirname, '../outputs/findash-export/v1/filter/universum.json');
  for (const destination of [good, bad]) {
    const target = path.resolve(destination, 'filter/universum.json');
    assert.notEqual(target.toLowerCase(), live.toLowerCase());
    assert.ok(target.startsWith(path.resolve(dir) + path.sep));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(make()));
  }
  const file = path.join(good, 'filter/universum.json');
  const hash = () => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const before = hash();
  const run = destination => spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/write-filter-universe.js'), '--check', '--v1-dir', destination], { encoding: 'utf8' });
  assert.equal(run(good).status, 0);
  const corrupt = make(); corrupt.rows[0].dy = 0;
  fs.writeFileSync(path.join(bad, 'filter/universum.json'), JSON.stringify(corrupt));
  assert.equal(run(bad).status, 1);
  for (const ticker of ['BANK', 'PAY']) {
    const zeroMargin = make(); zeroMargin.rows.find(row => row.t === ticker).gm = 0;
    fs.writeFileSync(path.join(bad, 'filter/universum.json'), JSON.stringify(zeroMargin));
    const rejected = run(bad);
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, new RegExp(ticker + ': placeholder gross margin'));
  }
  assert.equal(run(good).status, 0);
  assert.equal(hash(), before);
});

test('the writer retains snapshots outside the scoring watchlist with an explicit reason', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w6-build-'));
  const snapshotsDir = path.join(dir, 'snapshots'), v1Dir = path.join(dir, 'v1');
  fs.mkdirSync(snapshotsDir);
  fs.mkdirSync(path.join(v1Dir, 'full'), { recursive: true });
  const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
  for (const snapshot of snapshots) write(path.join(snapshotsDir, snapshot.meta.ticker + '.json'), snapshot);
  const watchlistFile = path.join(dir, 'watchlist.json');
  write(watchlistFile, snapshots.filter(s => s.meta.ticker !== 'DUP').map(s => ({ ticker: s.meta.ticker })));
  const header = { schema: 'findash-export/v1', generated_at: generatedAt, generatedFromSnapshots: snapshots.length - 1 };
  write(path.join(v1Dir, 'index.json'), { ...header, branches: ['software-comm-services'] });
  write(path.join(v1Dir, 'full/software-comm-services.json'), { ...header, profitable: [{ ticker: 'PAY', ...boards.get('PAY').row }], unprofitable: [] });
  write(path.join(v1Dir, 'excluded.json'), { ...header, rows: [...excluded].filter(([ticker]) => ticker !== 'DUP').map(([ticker, reasons]) => ({ beine: [{ ticker, reason: reasons[0] }] })) });
  const options = { snapshotsDir, v1Dir, watchlistFile, athFile: path.join(dir, 'missing-ath.json') };
  const result = build(options);
  assert.equal(result.feed.rows.length, snapshots.length);
  const outside = result.feed.rows.find(row => row.t === 'DUP');
  assert.equal(outside.b, undefined);
  assert.equal(outside.sc, undefined);
  assert.equal(outside.rk, undefined);
  assert.deepEqual(outside.aus, ['outside-watchlist', 'data-suspect']);
  assert.deepEqual(validateUniverse(result.feed, result.bytes), []);
  write(path.join(v1Dir, 'index.json'), { ...header, generatedFromSnapshots: snapshots.length, branches: ['software-comm-services'] });
  assert.throws(() => build(options), /Snapshot\/board population mismatch/);
});

test('scan every row for missing source values becoming zero', () => {
  const file = process.env.W6_REAL_FEED, dir = process.env.W6_REAL_SNAPSHOTS;
  assert.equal(Boolean(file), Boolean(dir), 'real-data seams must be supplied together');
  const feed = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : make();
  const { safeSnapshotFilename, isMetadataSnapshot } = require('../lib/snapshot-fs.js');
  const { prepareSnapshot } = require('../lib/yahoo-q4-known-cases.js');
  if (dir) assert.equal(feed.rows.length, fs.readdirSync(dir).filter(f => f.endsWith('.json') && !isMetadataSnapshot(f)).length);
  const fields = { ps: 'priceSales', evs: 'enterpriseToRevenue', pe: 'pe', fpe: 'forwardPE', dy: 'dividendYield', po: 'payoutRatio', roe: 'returnOnEquity', gm: 'grossMargin', fcf: 'fcfMarginTTM' };
  for (const row of feed.rows) {
    const source = dir ? prepareSnapshot(JSON.parse(fs.readFileSync(path.join(dir, safeSnapshotFilename(row.t)), 'utf8'))) : snapshots.find(s => s.meta.ticker === row.t);
    assert.ok(source, row.t);
    for (const [key, sourceKey] of Object.entries(fields)) {
      if (!Number.isFinite(source.metrics?.[sourceKey]?.value)) assert.equal(row[key], undefined, row.t + '.' + key);
    }
    if (!Number.isFinite(source.marketCap?.value)) assert.equal(row.mc, undefined, row.t + '.mc');
    if (!(source.annual?.annualRev?.[0]?.value > 0) || !(source.annual?.annualRev?.[3]?.value > 0)) assert.equal(row.g3, undefined, row.t + '.g3');
    if (!(source.price?.regularMarketPrice > 0) || !(source.metrics?.fiftyTwoWeekHigh?.value > 0)) assert.equal(row.d52, undefined, row.t + '.d52');
    const high = source.metrics?.fiftyTwoWeekHigh?.value, price = source.price?.regularMarketPrice;
    const highRatio = Number.isFinite(high) && high > 0 && Number.isFinite(price) && price > 0 ? price / high : null;
    const implausible = highRatio !== null && (highRatio > 1.20 || highRatio < 0.05);
    assert.equal(row.aus.includes('d52-implausible'), implausible, row.t + '.d52 reason');
    if (implausible) assert.equal(row.d52, undefined, row.t + '.d52 implausible high');
    if (row.d52 !== undefined) assert.ok(row.d52 >= -100 && row.d52 <= 0, row.t + '.d52 range');
    if (source.metrics?.payoutRatio?.value === 0 && row.dySt === 'zahlt') assert.equal(row.po, undefined, row.t + '.po placeholder');
    if (source.metrics?.grossMargin?.value === 0) assert.equal(row.gm, undefined, row.t + '.gm placeholder');
    assert.notEqual(row.gm, 0, row.t + '.gm zero');
    if (source.metrics?.fcfMarginTTM?.value > MAX_FCF_MARGIN_PCT) assert.equal(row.fcf, undefined, row.t + '.fcf ceiling');
    if (row.asOf !== undefined) assert.match(row.asOf, /^\d{4}-\d{2}-\d{2}$/, row.t + '.asOf date');
    const withheld = mischVerhaeltnisUnkorrigiert(source.meta);
    for (const [key, sourceKey] of [['ps', 'priceSales'], ['evs', 'enterpriseToRevenue']]) {
      const value = mischVal(source.metrics?.[sourceKey], withheld);
      if (value === null) assert.equal(row[key], undefined, row.t + '.' + key + ' PIT guard');
      else {
        const rounded = Math.round(value * 100) / 100;
        const expected = rounded === 0 && value !== 0 ? Number(value.toPrecision(2)) : rounded;
        assert.equal(row[key], expected, row.t + '.' + key + ' exact rounded PIT value');
      }
    }
    if (row.fcf === undefined) assert.equal(row.r40, undefined, row.t + '.r40');
    if (row.b === undefined) { assert.equal(row.sc, undefined); assert.equal(row.rk, undefined); }
  }
  console.log('Missing-value scan: ' + feed.rows.length + ' rows; source=' + (dir || 'tests/fixtures/w6/snapshots.json'));
});
