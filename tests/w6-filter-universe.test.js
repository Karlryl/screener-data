'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { buildUniverse, evImplausible, growth3, salesMultiples, validateUniverse, build, ROW_KEYS, NUMBER_KEYS, MAX_BYTES } = require('../scripts/write-filter-universe.js');
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

test('negative or zero sales multiples are withheld with a reason, never shown (Kinnevik)', () => {
  // Shapes from the stored snapshots of 2026-08-29: KINV-A.ST (revenue TTM -843 M USD, Yahoo P/S -2.18,
  // EV/S -1.27), a Pershing-like row (negative revenue AND negative EV: EV/S positive but meaningless) and
  // a net-cash bank-like row (positive revenue, EV/S -1.14).
  const cases = [
    ['KINV-A.ST', { revenueTTM: -843022392, priceSales: -2.1796038, enterpriseToRevenue: -1.274 }, undefined, undefined, 'umsatz-negativ'],
    ['PSHLIKE', { revenueTTM: -1e8, priceSales: -10.6, enterpriseToRevenue: 10.01 }, undefined, undefined, 'umsatz-negativ'],
    ['NOREV', { priceSales: -3.3 }, undefined, undefined, 'umsatz-negativ'],
    ['NETCASH', { revenueTTM: 5e8, priceSales: 2.43, enterpriseToRevenue: -1.14 }, 2.43, undefined, 'ev-negativ'],
    ['EVZERO', { revenueTTM: 5e8, priceSales: 2, enterpriseToRevenue: 0 }, 2, undefined, 'ev-negativ'],
    ['OK', { revenueTTM: 5e8, priceSales: 2, enterpriseToRevenue: 0.004 }, 2, 0.004, null],
    ['REVZERO', { revenueTTM: 0, priceSales: 2, enterpriseToRevenue: 3 }, 2, 3, null],
  ];
  const list = cases.map(([ticker, values]) => {
    const copy = structuredClone(snapshots[0]);
    copy.meta.ticker = ticker;
    for (const [key, value] of Object.entries(values)) copy.metrics[key] = { value };
    if (!Object.hasOwn(values, 'revenueTTM')) delete copy.metrics.revenueTTM;
    if (!Object.hasOwn(values, 'enterpriseToRevenue')) delete copy.metrics.enterpriseToRevenue;
    return copy;
  });
  const feed = buildUniverse({ snapshots: list, excluded: new Map(cases.map(([t]) => [t, ['non-operating-rev']])), generatedAt });
  assert.deepEqual(validateUniverse(feed, Buffer.byteLength(JSON.stringify(feed))), []);
  for (const [ticker, , ps, evs, reason] of cases) {
    const row = feed.rows.find(r => r.t === ticker);
    assert.equal(row.ps, ps, ticker + '.ps');
    assert.equal(row.evs, evs, ticker + '.evs');
    for (const code of ['umsatz-negativ', 'ev-negativ']) assert.equal(row.aus.includes(code), code === reason, ticker + ' ' + code);
  }
  // A currency verdict that already withholds both ratios adds no sales reason.
  assert.deepEqual(salesMultiples(list[0], true), { ps: null, evs: null, reason: null });
  for (const mutate of [r => { r.ps = -2.18; }, r => { r.evs = -1.27; }, r => { r.ps = 0; }, r => { r.evs = 1; }]) {
    const bad = structuredClone(feed);
    mutate(bad.rows.find(r => r.t === 'KINV-A.ST'));
    assert.ok(validateUniverse(bad, 1000).length, 'validator must reject ' + mutate);
  }
  const evBack = structuredClone(feed);
  evBack.rows.find(r => r.t === 'NETCASH').evs = 1;
  assert.ok(validateUniverse(evBack, 1000).some(e => e.includes('inconsistent ev reason')));
});

test('CAGR requires both positive endpoints and preserves missing slots', () => {
  for (const [a, b] of [[null, 100], [100, null], [0, 100], [100, 0], [-100, 100], [100, -100]]) {
    assert.equal(growth3({ annual: { annualRev: [{ value: a }, { value: 9 }, { value: 8 }, { value: b }] } }), null);
  }
  assert.equal(growth3({ annual: { annualRev: [{ value: 133.1 }, null, null, { value: 100 }], annualRevEnds: ['2025-12-31', '2024-12-31', '2023-12-31', '2022-12-31'] } }), 10);
  // Period gate round 2 (30.10.2026): no ends, no proven span.
  assert.equal(growth3({ annual: { annualRev: [{ value: 133.1 }, null, null, { value: 100 }] } }), null);
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
    if (!(source.metrics?.forwardPE?.value > 0)) assert.equal(row.fpe, undefined, row.t + '.fpe non-positive');
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
    // 22.10.2026 ceilings: every reason matches the source in both directions and no shown value is beyond its ceiling.
    const gmValue = source.metrics?.grossMargin?.value, dyValue = source.metrics?.dividendYield?.value, poValue = source.metrics?.payoutRatio?.value;
    const dyStatus = source.metrics?.dividendStatus?.value;
    assert.equal(row.aus.includes('gm-implausible'), Number.isFinite(gmValue) && Math.abs(Math.round(gmValue * 100) / 100) > 100, row.t + '.gm reason');
    assert.equal(row.aus.includes('dy-implausible'), Number.isFinite(dyValue) && dyValue > 50 && (dyStatus == null || dyStatus === 'zahlt'), row.t + '.dy reason');
    assert.equal(row.aus.includes('po-implausible'), Number.isFinite(poValue) && (poValue > 100000 || poValue < 0), row.t + '.po reason');
    const fpeValue = mischVal(source.metrics?.forwardPE, row.aus.includes('mischwaehrung'));
    assert.equal(row.aus.includes('fpe-implausible'), fpeValue > 0 && Math.round(fpeValue * 100) / 100 < 1.5, row.t + '.fpe reason');
    if (row.fpe !== undefined) assert.ok(row.fpe >= 1.5, row.t + '.fpe floor');
    if (row.gm !== undefined) assert.ok(Math.abs(row.gm) <= 100, row.t + '.gm ceiling');
    if (row.dy !== undefined) assert.ok(row.dy <= 50, row.t + '.dy ceiling');
    if (row.po !== undefined) assert.ok(row.po >= 0 && row.po <= 100000, row.t + '.po ceiling');
    assert.ok(!(row.aus.includes('evs-waehrung') && row.aus.includes('evs-implausible')), row.t + '.evs one code');
    const withheld = mischVerhaeltnisUnkorrigiert(source.meta);
    const revenue = source.metrics?.revenueTTM?.value, rawPs = mischVal(source.metrics?.priceSales, withheld);
    const negativeRevenue = (Number.isFinite(revenue) && revenue < 0) || (rawPs !== null && rawPs <= 0);
    for (const [key, sourceKey] of [['ps', 'priceSales'], ['evs', 'enterpriseToRevenue']]) {
      const value = mischVal(source.metrics?.[sourceKey], withheld);
      if (key === 'evs' && value > 0 && !negativeRevenue && !row.aus.includes('evs-waehrung')) assert.equal(row.aus.includes('evs-implausible'), evImplausible(source), row.t + '.evs implausible reason');
      if (value === null || value <= 0 || negativeRevenue || (key === 'evs' && (row.aus.includes('evs-waehrung') || row.aus.includes('evs-implausible')))) assert.equal(row[key], undefined, row.t + '.' + key + ' PIT/sign/currency guard');
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

// ---- Filter outliers 22.10.2026 (gross margin, dividend yield, payout, EV/S currency) ----
const withMetrics = (patch, ticker = 'PAY') => {
  const copy = structuredClone(snapshots[0]);
  for (const [key, value] of Object.entries(patch)) copy.metrics[key] = { value };
  copy.meta.ticker = ticker;
  return copy;
};
const rowOf = (snapshot, aus = ['non-operating-rev']) => buildUniverse({ snapshots: [snapshot], excluded: new Map([[snapshot.meta.ticker, aus]]), generatedAt }).rows[0];

test('gross margin beyond plus or minus 100 percent is withheld with a reason, the boundary and float noise survive', () => {
  for (const [value, expected] of [[100, 100], [100.004, 100], [99.99, 99.99], [-100, -100], [-99.99, -99.99], [100.01, undefined], [195.83, undefined],
    [-100.6, undefined], [-270.79, undefined], [0, undefined]]) {
    const row = rowOf(withMetrics({ grossMargin: value }));
    assert.equal(row.gm, expected, 'gm ' + value);
    assert.equal(row.aus.includes('gm-implausible'), value !== 0 && Math.abs(Math.round(value * 100) / 100) > 100, 'reason ' + value);
    assert.deepEqual(validateUniverse(buildUniverse({ snapshots: [withMetrics({ grossMargin: value })], excluded: new Map([['PAY', ['non-operating-rev']]]), generatedAt }), 1000), []);
  }
});

test('dividend yield above 50 percent is withheld as unknown with a reason; its payout zero does not resurface', () => {
  for (const [value, expected, state] of [[25.01, 25.01, 'zahlt'], [50, 50, 'zahlt'], [50.01, undefined, 'unbekannt'], [182, undefined, 'unbekannt'], [0.001, 0.001, 'zahlt']]) {
    const row = rowOf(withMetrics({ dividendYield: value, dividendStatus: 'zahlt', payoutRatio: 0 }));
    assert.equal(row.dy, expected, 'dy ' + value);
    assert.equal(row.dySt, state, 'state ' + value);
    assert.equal(row.aus.includes('dy-implausible'), value > 50, 'reason ' + value);
    // SBB-D.ST regression: payout zero is a placeholder next to a payer, also when the yield itself is withheld.
    assert.equal(row.po, undefined, 'po placeholder ' + value);
  }
  // A non-payer keeps its real zero payout.
  assert.equal(rowOf(withMetrics({ dividendYield: null, dividendStatus: 'keine', payoutRatio: 0 })).po, 0);
});

test('forward P/E below the floor is withheld with a reason; true small values stay (30.10.2026)', () => {
  const one = row => ({ schema: make().schema, generated_at: generatedAt, snapshotCount: 1, rows: [row] });
  // Vendor values of 30.10.2026 (AZUL3.SA: 24.10.2026) against the second source: AZUL3.SA none, ENIC 11.01, KYIV 8.29, 4763.TW none, 3697.T 19.79.
  for (const [name, value] of [['AZUL3.SA', 0.0000009], ['ENIC', 0.01963268], ['KYIV', 0.19332632], ['4763.TW', 0.4474929], ['3697.T', 1.44], ['boundary', 1.49], ['rounds to 1.49', 1.494]]) {
    const row = rowOf(withMetrics({ forwardPE: value }));
    assert.equal(row.fpe, undefined, name);
    assert.ok(row.aus.includes('fpe-implausible'), name + ' reason');
    assert.deepEqual(validateUniverse(one(row), 1000), [], name + ' valid');
  }
  // Second source agrees that these are small: TURSG.IS 2.12, BBAR.BA 1.82, DEC 1.58, BHC 2.12, CLVT 2.44. 1.495 rounds to the shown 1.5.
  for (const [name, value, shown] of [['boundary', 1.5, 1.5], ['rounds to 1.5', 1.495, 1.5], ['TURSG.IS', 1.59, 1.59], ['BBAR.BA', 1.79, 1.79], ['DEC', 1.97, 1.97], ['BHC', 2.08, 2.08], ['CLVT', 2.27, 2.27]]) {
    const row = rowOf(withMetrics({ forwardPE: value }));
    assert.equal(row.fpe, shown, name);
    assert.ok(!row.aus.includes('fpe-implausible'), name + ' no reason');
  }
  // A forecast loss is missing, not implausible.
  for (const value of [-12, 0]) assert.ok(!rowOf(withMetrics({ forwardPE: value })).aus.includes('fpe-implausible'), 'loss ' + value);
  // Only fpe and aus move; the trailing P/E of ENIC stays.
  const enic = rowOf(withMetrics({ forwardPE: 0.01963268, pe: 10.85 }));
  assert.equal(enic.pe, 10.85);
  assert.equal(enic.peSt, 'vorhanden');
  // Validator, both directions.
  const shown = rowOf(withMetrics({ forwardPE: 15 }));
  assert.ok(validateUniverse(one({ ...shown, fpe: 1.49 }), 1000).some(e => e.includes('forward P/E below floor')));
  assert.ok(validateUniverse(one({ ...shown, aus: [...shown.aus, 'fpe-implausible'] }), 1000).some(e => e.includes('inconsistent fpe reason')));
});

test('payout above 100000 percent or negative is withheld with a reason; high real ratios stay', () => {
  for (const [value, expected] of [[100000, 100000], [99999.99, 99999.99], [100000.01, undefined], [2788100, undefined], [15375, 15375], [-0.01, undefined], [-50, undefined], [0.001, 0.001]]) {
    const row = rowOf(withMetrics({ payoutRatio: value, dividendStatus: 'zahlt', dividendYield: 2 }));
    assert.equal(row.po, expected, 'po ' + value);
    assert.equal(row.aus.includes('po-implausible'), value > 100000 || value < 0, 'reason ' + value);
  }
  // 000059.SZ shape: payout 347 next to dividend yield 0 / dySt 'keine'; the yield field is the broken one -> payout shown.
  const sz = rowOf(withMetrics({ payoutRatio: 347, dividendYield: null, dividendStatus: 'keine' }));
  assert.equal(sz.dySt, 'keine');
  assert.equal(sz.po, 347);
  assert.ok(!sz.aus.includes('po-implausible'));
  // A withheld yield (dy-implausible) keeps its payout.
  const wy = rowOf(withMetrics({ payoutRatio: 40, dividendYield: 182, dividendStatus: 'zahlt' }));
  assert.equal(wy.po, 40);
  assert.ok(!wy.aus.includes('po-implausible'));
  // SLG shape: payout 15375 of a payer is a correct number -> shown.
  const slg = rowOf(withMetrics({ payoutRatio: 15375, dividendYield: 4.5, dividendStatus: 'zahlt' }));
  assert.equal(slg.po, 15375);
  assert.ok(!slg.aus.includes('po-implausible'));
  for (const r of [sz, wy, slg]) assert.deepEqual(validateUniverse({ schema: make().schema, generated_at: generatedAt, snapshotCount: 1, rows: [r] }, 1000), []);
});

test('EV/S built from a reporting-currency enterprise value is withheld (KXIAY), local listings and near-parity pairs are untouched', () => {
  // KXIAY shape from the 22.10.2026 snapshot: JPY reporter, USD ADR, pull factor 157.32, EV still in JPY.
  const base = (patch = {}) => {
    const s = withMetrics({ priceSales: 1.88, enterpriseToRevenue: 292.3, enterpriseValue: 6988309725184, revenueTTM: 23912394607 }, 'KXIAY');
    Object.assign(s.meta, { reportingCurrency: 'USD', reportingCurrencyOriginal: 'JPY', tradingCurrency: 'USD', tradingCurrencyOriginal: 'USD', mischVerhaeltnisFaktor: 157.32 });
    s.marketCap = { value: 45007671296 };
    s.annual.annualBalance = [{ totalDebt: 6658750445, totalCash: 2991997126 }];
    for (const [path, value] of Object.entries(patch)) { const [a, b] = path.split('.'); s[a][b] = value; }
    return s;
  };
  const kx = rowOf(base());
  assert.equal(kx.evs, undefined);
  assert.equal(kx.ps, 1.88);
  assert.ok(kx.aus.includes('evs-waehrung'));
  // EV in the trading currency (USD ADR whose EV is already USD): kept.
  assert.equal(rowOf(base({ 'metrics.enterpriseValue': { value: 48e9 } })).evs, 292.3);
  // Local HKD listing of a USD reporter (factor 0.127, EV in HKD): the pull's reading is right, kept.
  const hk = base({ 'metrics.enterpriseValue': { value: 5.3e10 }, 'meta.mischVerhaeltnisFaktor': 0.127 });
  hk.meta.reportingCurrencyOriginal = 'USD'; hk.meta.tradingCurrencyOriginal = 'HKD';
  assert.ok(!rowOf(hk).aus.includes('evs-waehrung'));
  // Near parity (EUR/USD 0.89): both readings are within the noise, never flagged.
  assert.ok(!rowOf(base({ 'meta.mischVerhaeltnisFaktor': 0.8924 })).aus.includes('evs-waehrung'));
  // Without balance data the EV/market-cap ratio decides: 155 as is, 0.99 divided by the factor -> flagged; 1.2 -> kept.
  const noBalance = patch => { const s = base(patch); delete s.annual.annualBalance; return s; };
  assert.ok(rowOf(noBalance()).aus.includes('evs-waehrung'));
  assert.ok(!rowOf(noBalance({ 'metrics.enterpriseValue': { value: 54e9 } })).aus.includes('evs-waehrung'));
  // Missing enterprise value or market cap: nothing to judge, nothing flagged.
  assert.ok(!rowOf(base({ 'metrics.enterpriseValue': { value: null } })).aus.includes('evs-waehrung'));
});

test('EV/S fitting neither reading is withheld as implausible (KAJMF); the EV factor bound is e', () => {
  // check = mcap + debt - cash; KAJMF shape: factor 158, ev/check about 20, ev/(check*factor) about 0.13.
  const mcap = 45e9, debt = 6e9, cash = 3e9, check = mcap + debt - cash;
  const shaped = (factor, ev) => {
    const s = withMetrics({ priceSales: 0.8, enterpriseToRevenue: 18.68, enterpriseValue: ev, revenueTTM: 5e10 }, 'KAJMF');
    Object.assign(s.meta, { reportingCurrency: 'USD', reportingCurrencyOriginal: 'JPY', tradingCurrency: 'USD', tradingCurrencyOriginal: 'USD', mischVerhaeltnisFaktor: factor });
    s.marketCap = { value: mcap };
    s.annual.annualBalance = [{ totalDebt: debt, totalCash: cash }];
    return rowOf(s);
  };
  const kajmf = shaped(158, 20 * check);
  assert.equal(kajmf.evs, undefined);
  assert.equal(kajmf.ps, 0.8);
  assert.ok(kajmf.aus.includes('evs-implausible'));
  assert.ok(!kajmf.aus.includes('evs-waehrung'));
  // ev/check = 3 (ln 1.1) is plausible: kept.
  const ok3 = shaped(158, 3 * check);
  assert.equal(ok3.evs, 18.68);
  assert.ok(!ok3.aus.some(a => a.startsWith('evs-')));
  // Factor 2.5 (inside 1/e..e) with ev = check * factor: never a currency verdict, and ln 2.5 is plausible -> not flagged by design.
  const f25 = shaped(2.5, 2.5 * check);
  assert.equal(f25.evs, 18.68);
  assert.ok(!f25.aus.some(a => a.startsWith('evs-')));
  // Factor 3 with ev = check * factor: the currency reading wins -> evs-waehrung only.
  const f3 = shaped(3, 3 * check);
  assert.equal(f3.evs, undefined);
  assert.deepEqual(f3.aus.filter(a => a.startsWith('evs-')), ['evs-waehrung']);
  for (const r of [kajmf, ok3, f25, f3]) assert.deepEqual(validateUniverse({ schema: make().schema, generated_at: generatedAt, snapshotCount: 1, rows: [r] }, 1000), []);
});

test('EV/S of a factor < 1 listing whose balance fits mcap + (debt - cash) * factor is shown (HCLTECH.NS, 23.10.2026 snapshot)', () => {
  // ln(ev / check1) = 2.23 as delivered, but ev / (mcap + (debt - cash) * factor) = ln -0.05 -> shown.
  const shaped = (factor, evs = 2.542313588871) => {
    const s = withMetrics({ priceSales: 2.74, enterpriseToRevenue: evs, enterpriseValue: 37750839837.581375, revenueTTM: 1.485e10 }, 'HCLTECH.NS');
    Object.assign(s.meta, { reportingCurrency: 'USD', reportingCurrencyOriginal: 'USD', tradingCurrency: 'INR', tradingCurrencyOriginal: 'INR', mischVerhaeltnisFaktor: factor });
    s.marketCap = { value: 40660683802.23747 };
    s.annual.annualBalance = [{ totalDebt: 1590000000, totalCash: 82120000000 }];
    return rowOf(s);
  };
  const hcl = shaped(0.010523823);
  assert.equal(hcl.evs, 2.54);
  assert.ok(!hcl.aus.some(a => a.startsWith('evs-')));
  assert.deepEqual(validateUniverse({ schema: make().schema, generated_at: generatedAt, snapshotCount: 1, rows: [hcl] }, 1000), []);
  // Same numbers with factor >= 1 and no currency verdict (inside 1/e..e): the third reading is not accepted -> implausible.
  const f2 = shaped(2);
  assert.equal(f2.evs, undefined);
  assert.deepEqual(f2.aus.filter(a => a.startsWith('evs-')), ['evs-implausible']);
});

test('validator rejects every outlier ceiling and every reason without its empty field (both directions)', () => {
  const feed = buildUniverse({ snapshots: [withMetrics({ grossMargin: 50, dividendYield: 2, dividendStatus: 'zahlt', payoutRatio: 40 })], excluded: new Map([['PAY', ['non-operating-rev']]]), generatedAt });
  assert.deepEqual(validateUniverse(feed, 1000), []);
  const mutations = [r => { r.gm = 100.01; }, r => { r.gm = -100.01; }, r => { r.aus.push('gm-implausible'); }, r => { r.dy = 50.01; },
    r => { r.aus.push('dy-implausible'); }, r => { r.po = 100000.01; }, r => { r.po = -1; }, r => { r.aus.push('po-implausible'); }, r => { r.evs = 1; r.aus.push('evs-waehrung'); },
    r => { r.evs = 1; r.aus.push('evs-implausible'); }, r => { delete r.evs; r.aus.push('evs-waehrung', 'evs-implausible'); }];
  for (const mutate of mutations) { const bad = structuredClone(feed); mutate(bad.rows[0]); assert.ok(validateUniverse(bad, 1000).length, 'validator must reject ' + mutate); }
});

test('contract text names every new reason code', () => {
  const contract = fs.readFileSync(path.join(__dirname, '..', 'docs', 'findash-export-v1.md'), 'utf8');
  for (const code of ['gm-implausible', 'dy-implausible', 'po-implausible', 'fpe-implausible', 'evs-waehrung', 'evs-implausible']) assert.ok(contract.includes(code), code);
});

test('forward P/E is shown only when positive; zero or negative (forecast loss) stays missing and the validator rejects it (24.10.2026)', () => {
  const one = row => ({ schema: make().schema, generated_at: generatedAt, snapshotCount: 1, rows: [row] });
  // 0.001 is withheld since the 1.5 floor of 30.10.2026 (it was shown as 0.001 before).
  for (const [value, expected] of [[-12, undefined], [0, undefined], [15, 15], [0.001, undefined]]) {
    const row = rowOf(withMetrics({ forwardPE: value }));
    assert.equal(row.fpe, expected, 'fpe ' + value);
    assert.deepEqual(validateUniverse(one(row), 1000), [], 'valid row for fpe ' + value);
  }
  for (const bad of [-12, 0]) {
    const row = rowOf(withMetrics({ forwardPE: 15 }));
    row.fpe = bad;
    assert.ok(validateUniverse(one(row), 1000).some(e => e.includes('non-positive forward P/E')), 'validator must reject fpe ' + bad);
  }
});
