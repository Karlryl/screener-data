'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const fixtures = require('./fixtures/market-cap-p205.json');
const guard = require('../lib/market-cap-guard.js');
const { route } = require('../src/scoring/router.js');
const { smallcapRoute } = require('../src/scoring/smallcap-route.js');
const { boardZeile } = require('./rule40-fixture.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p205-export-build-'));
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data)); };
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const errors = [], warnings = [], original = { error: console.error, warn: console.warn };
let checks = 0;
function check(name, fn) { fn(); checks++; console.log('PASS ' + name); }
function caseAt(value) {
  const s = structuredClone(fixtures.QH);
  s.price.regularMarketPrice = value / guard.table.QH.shares;
  s.marketCap.value = s.price.regularMarketPrice * guard.table.QH.wrongShares[0];
  return s;
}
console.error = (...args) => errors.push(args.join(' '));
console.warn = (...args) => warnings.push(args.join(' '));
try {
  // Execute the real writer with its root redirected to isolated fixture outputs.
  const script = require.resolve('../scripts/write-findash-export.js');
  const mod = { exports: {} }, snapshots = path.join(root, 'snapshots');
  const env = { FINDASH_SNAPSHOTS_DIR: process.env.FINDASH_SNAPSHOTS_DIR, FINDASH_SMALLCAP_SNAPSHOTS_DIR: process.env.FINDASH_SMALLCAP_SNAPSHOTS_DIR };
  process.env.FINDASH_SNAPSHOTS_DIR = snapshots;
  process.env.FINDASH_SMALLCAP_SNAPSHOTS_DIR = path.join(root, 'absent-smallcap-snapshots');
  try {
    vm.runInThisContext(Module.wrap(fs.readFileSync(script, 'utf8').replace(/^#![^\n]*/, '')), { filename: script })(
      mod.exports, Module.createRequire(script), mod, script, path.join(root, 'scripts'));
  } finally {
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
  const writer = mod.exports, source = path.join(root, 'outputs', 'hypergrowth');
  const out = path.join(root, 'outputs', 'findash-export', 'v1');
  const qh = caseAt(500e6), normal = structuredClone(fixtures.MSFT);
  write(path.join(snapshots, 'QH.json'), qh);
  const makeRow = (ticker, score) => boardZeile({ ticker, name: ticker, score, marketCap: ticker === 'QH' ? qh.marketCap.value : normal.marketCap.value,
    ipoRecency: 'mature', profitStreak: null, coverageAxes: '7/7', track: 'profitable', revGrowthYoYPct: null });
  const good = Array.from({ length: 101 }, (_, i) => makeRow('GOOD' + i, 80 - i / 10));
  for (const row of good) { const s = structuredClone(normal); s.meta.ticker = row.ticker; write(path.join(snapshots, row.ticker + '.json'), s); }
  const bad = makeRow('QH', 99), fullRows = [bad, ...good];
  const counts = {};
  for (const branch of writer.BRANCHES) {
    const rows = branch === 'software-comm-services' ? fullRows : [];
    counts[branch] = { profitable: rows.length, unprofitable: 0 };
    write(path.join(source, branch + '.json'), { profitable: rows.slice(0, 100), unprofitable: [] });
    write(path.join(source, 'full', branch + '.json'), { profitable: rows, unprofitable: [] });
  }
  write(path.join(source, 'index.json'), { generatedFromSnapshots: 102, branches: writer.BRANCHES, counts, survivalCount: 2, excluded: {} });
  const overview = row => ({ ...row, formulaId: 'software-comm-services', overviewKind: 'gp', overviewValue: 10, overviewCompanion: null });
  write(path.join(source, 'overview.json'), [bad, good[0]].map(overview));
  write(path.join(source, 'survival.json'), [bad, good[0]].map(row => ({ ...row, runwayQuarters: 20 })));
  for (const family of ['quality', 'smallcap']) {
    const id = family + '-software-comm-services', dir = path.join(root, 'outputs', family);
    write(path.join(dir, id + '.json'), { profitable: [bad, good[0]], unprofitable: [] });
    write(path.join(dir, 'overview.json'), [bad, good[0]].map(overview));
    write(path.join(dir, 'index.json'), { generatedFromSnapshots: 102, boards: [id], boardStatus: { [id]: 'diagnostic' },
      counts: { [id]: { profitable: 2, unprofitable: 0 } }, excluded: {} });
  }
  let result, beforeProof;
  check('a corrected floor-gap row is dropped; the complete build still writes every board', () => {
    assert.doesNotThrow(() => { result = writer.build({ writeProvenance(files, options) {
      beforeProof = read(path.join(out, 'software-comm-services.json'));
      return require('../lib/export-provenance.js').writeProvenance(files, options);
    } }); });
    for (const branch of writer.BRANCHES) for (const prefix of ['', 'full']) assert.ok(fs.existsSync(path.join(out, prefix, branch + '.json')));
    const top = read(path.join(out, 'software-comm-services.json')), full = read(path.join(out, 'full', 'software-comm-services.json'));
    assert.equal(top.profitable.length, 100); assert.equal(full.profitable.length, 101);
    // The existing provenance step annotates top boards only; compare the complete rows before it.
    assert.deepEqual(beforeProof.profitable, full.profitable.slice(0, 100));
    assert.ok(top.profitable.every(row => row.provenance && row.verification));
    assert.equal(top.profitable[99].ticker, 'GOOD99', 'one surviving tail row fills the top-list gap');
    assert.equal(full.profitable.some(row => row.ticker === 'QH'), false);
    const index = read(path.join(out, 'index.json'));
    assert.equal(index.counts['software-comm-services'].profitable, 101);
    assert.equal(index.survivalCount, 1);
    assert.equal(read(path.join(out, 'survival.json')).rows[0].rank, 1);
    assert.equal(read(path.join(out, 'overview.json')).rows.length, 1);
    for (const [board, mode] of [[top, 'topN'], [full, 'full']]) {
      const problems = []; writer.validateCohortDelivery(board, 'software-comm-services', problems, { mode, counts: index.counts['software-comm-services'] });
      assert.deepEqual(problems, []);
    }
    const dropped = errors.filter(line => line.startsWith('::error::'));
    assert.ok(dropped.length > 0); assert.ok(dropped.every(line => /QH/.test(line) && /Börsenwert|Mindestgröße/.test(line)));
    assert.equal(result.mcapGenullt.verworfen, dropped.length, 'one error per dropped export row, counted independently of FX nulls');
  });
  check('smallcap main-store fallback uses 300M and keeps the corrected 500M row', () => {
    const board = read(path.join(out, 'smallcap', 'software-comm-services.json'));
    assert.equal(board.profitable[0].ticker, 'QH');
    assert.ok(Math.abs(board.profitable[0].marketCap - 500e6) < 1e-6);
    assert.equal(read(path.join(out, 'smallcap', 'index.json')).counts['smallcap-software-comm-services'].profitable, 2);
    assert.equal(read(path.join(out, 'quality', 'software-comm-services.json')).profitable.length, 1);
    assert.equal(read(path.join(out, 'quality', 'index.json')).counts['quality-software-comm-services'].profitable, 1);
    assert.equal(writer.mapBoardRow(bad, 0, 'main'), null, 'cached main evidence must not retain the smallcap floor');
    assert.ok(writer.mapBoardRow(bad, 0, 'main', 300e6), 'explicit smallcap context works in both cache orders');
  });
  check('main default is the pull floor; legitimate 900M cases stay on the main board', () => {
    assert.equal(guard.marketCapFloor({}), 800e6);
    for (const value of ['bad', '-1', 'Infinity']) assert.equal(guard.marketCapFloor({ MIN_MCAP_USD: value }), 800e6);
    assert.equal(guard.marketCapFloor({ MIN_MCAP_USD: '0' }), 0);
    const s = guard.prepareMarketCap(caseAt(900e6));
    assert.equal(route(s, guard.marketCapFloor({})).action, 'route');
    assert.equal(route(s, 1e9).reason, 'skipped-mcap');
    assert.equal(smallcapRoute(guard.prepareMarketCap(caseAt(500e6))).action, 'route');
  });
  check('full-pull correction retains the quote evidence required by a later read', () => {
    const s = caseAt(900e6), price = s.price.regularMarketPrice;
    delete s.price; delete s.meta.priceCurrency;
    assert.equal(guard.applyMarketCapGuard(s, price).status, 'corrected');
    assert.deepEqual(guard.prepareMarketCap(s), s);
    assert.equal(s.price.regularMarketPrice, price);
    assert.equal(s.price.currencyUnit, 'USD');
    assert.equal(s.price.asOf, s.marketCap.asOf);
    const pull = require('../pull-yahoo.js');
    for (const [status, count] of [['corrected', guard.table.QH.wrongShares[0]], ['confirmed', guard.table.QH.shares]]) {
      const yahoo = { price: { currency: 'USD', regularMarketPrice: price }, financialData: { financialCurrency: 'USD' }, summaryDetail: { marketCap: price * count } };
      const full = pull.mapYahooToCanonical(yahoo, { ticker: 'QH' }, '2026-10-10T09:11:34.636Z');
      pull._convertSnapshotToUSD(full);
      assert.equal(full.price, undefined, 'real full mapper starts without a saved quote');
      assert.equal(pull._applyAdsHandTable(full, 'QH', price).status, status);
      assert.equal(guard.prepareMarketCap(full).marketCap.value, full.marketCap.value);
      assert.ok(Math.abs(full.marketCap.value - 900e6) < 1e-6);
      assert.equal(full.price.regularMarketPrice, price);
      assert.equal(full.price.asOf, full.marketCap.asOf);
    }
  });
  check('provider-confirmed cases cannot export a stale board cap in any feed', () => {
    const s = caseAt(900e6); s.marketCap.value = 900e6;
    const prepared = guard.prepareMarketCap(s);
    assert.equal(prepared.meta.marketCapReason, undefined);
    const oldRow = { ...bad, marketCap: 314702102528 };
    const boards = new Map([['QH', { branch: 'software-comm-services', row: oldRow }]]);
    const feed = require('../scripts/write-filter-universe.js').buildUniverse({ snapshots: [prepared], boards, generatedAt: '2026-10-10T09:52:42Z' });
    assert.equal(feed.rows[0].mc, 900e6);
    assert.equal(require('../scripts/write-rule40-export.js').mcapBelegt({ row: oldRow }, prepared, prepared.meta, {}), 900e6);
    const dir = path.join(root, 'provider-confirmed'); write(path.join(dir, 'QH.json'), s);
    const child = require('node:child_process').spawnSync(process.execPath, ['-e', `
      const assert=require('node:assert/strict'),writer=require('./scripts/write-findash-export.js');
      for(const mapper of [writer.mapBoardRow,writer.mapOverviewRow,writer.mapSurvivalRow]) {
        const row=mapper({ticker:'QH',marketCap:314702102528,score:20,mcapBand:'mega'},0);
        assert.equal(row.marketCap,900e6);assert.equal(row.mcapBand,null);
      }`], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, FINDASH_SNAPSHOTS_DIR: dir }, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stdout + child.stderr);
  });
  check('filter drops stale board rows with a count, and does not exclude a retained corrected row', () => {
    const filter = require('../scripts/write-filter-universe.js');
    const snapshots = [guard.prepareMarketCap(qh), normal];
    const boards = new Map(snapshots.map(s => [s.meta.ticker, { branch: 'software-comm-services', row: { marketCap: s.marketCap.value, score: 20, rank: 1 } }]));
    const offset = errors.length, feed = filter.buildUniverse({ snapshots, boards, generatedAt: '2026-10-10T09:52:42Z' });
    assert.equal(feed.snapshotCount, 2); assert.equal(feed.marketCapDropped, 1);
    assert.equal(feed.rows.length, 1); assert.equal(feed.rows[0].t, 'MSFT');
    assert.equal(errors.length - offset, 1); assert.match(errors[offset], /^::error::.*QH/);
    assert.deepEqual(filter.validateUniverse(feed, Buffer.byteLength(JSON.stringify(feed))), []);
    const retained = guard.prepareMarketCap(caseAt(900e6));
    const row = filter.buildUniverse({ snapshots: [retained], boards, generatedAt: '2026-10-10T09:52:42Z' }).rows[0];
    assert.equal(row.b, 'software-comm-services'); assert.equal(row.mc, 900e6);
    assert.ok(!row.aus.includes(retained.meta.marketCapReason));
    assert.deepEqual(filter.validateUniverse({ ...feed, marketCapDropped: -1 }, 100).includes('Snapshot count mismatch'), true);
  });
  check('Rule40 drops the same known floor case once and records it in its diagnostics', () => {
    const offset = errors.length;
    const result = require('../scripts/write-rule40-export.js').sammleKandidaten({ v1Dir: out, snapshotsDir: snapshots });
    assert.equal(result.abgewiesen.marketCap, 1);
    assert.equal(result.kandidaten.some(row => row.ticker === 'QH'), false);
    // QH already left the v1 boards with its own ::error:: in the board export above; Rule40 only counts it,
    // so one dropped row gives one alarm, and a withheld snapshot off the boards (ISBTR.IS) gives none.
    assert.equal(errors.length - offset, 0);
    // Counter-case: if the board export and Rule40 ever disagree and QH is still on a v1 board, it must alarm.
    const v1 = fs.mkdtempSync(path.join(os.tmpdir(), 'p205-r40-board-'));
    fs.cpSync(out, v1, { recursive: true });
    const boardFile = path.join(v1, 'full', 'software-comm-services.json');
    const board = JSON.parse(fs.readFileSync(boardFile, 'utf8'));
    board.profitable = [{ ...board.profitable[0], ticker: 'QH' }, ...board.profitable];
    fs.writeFileSync(boardFile, JSON.stringify(board));
    const offset2 = errors.length;
    require('../scripts/write-rule40-export.js').sammleKandidaten({ v1Dir: v1, snapshotsDir: snapshots });
    assert.equal(errors.length - offset2, 1);
    assert.match(errors[offset2], /^::error::QH: Rule40-Zeile verworfen/);
  });
  check('expiry warns for corrections and holds; obsolete reasons are cleared without touching raw data', () => {
    for (const ticker of ['QH', 'ISBTR.IS']) {
      const s = structuredClone(fixtures[ticker]); s.marketCap.asOf = '2027-01-01';
      const offset = warnings.length;
      assert.equal(guard.prepareMarketCap(s).marketCap.value, null);
      assert.ok(warnings.slice(offset).some(line => line.startsWith('::warning::') && line.includes(ticker) && line.includes('reviewBy')));
    }
    assert.match(guard.holds['ISBTR.IS'].reviewBy, /^\d{4}-\d{2}-\d{2}$/);
    for (const ticker of ['MSFT', 'QH']) {
      const s = structuredClone(fixtures[ticker]); s.meta.marketCapReason = 'stale reason';
      if (ticker === 'QH') s.marketCap.asOf = '2026-07-16';
      const before = JSON.stringify(s), prepared = guard.prepareMarketCap(s);
      assert.equal(prepared.meta.marketCapReason, undefined); assert.equal(JSON.stringify(s), before);
      assert.equal(prepared.marketCap.value, s.marketCap.value);
      assert.equal(guard.applyMarketCapGuard(s).status, 'no-row'); assert.equal(s.meta.marketCapReason, undefined);
    }
  });
} finally { console.error = original.error; console.warn = original.warn; }
console.log(`P205 export correction: ${checks} checks passed; complete writer, fallback, diagnostics and lifecycle verified.`);
