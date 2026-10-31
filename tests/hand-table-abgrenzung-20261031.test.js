'use strict';
// Three rows of 31.10.2026 where the board number follows a vendor definition, read against the firms' filings.
// - BRBI: the vendor's revenue is interest revenues and gains before the almost equal interest expenses and losses, plus service
//   revenues (2,095,599 + 85,912 = 2,181,511 thousand BRL). The statement line Total revenues/(expenses) is 130,099. Shown -31.4 %, filed -6.6 %.
// - GAU: the vendor's year and its Q3 and Q4 2025 leave out the gold hedges, its other quarters contain them, so the series mixed two
//   bases. Reconciled to the thousand: 2025 36,543 + 119,324 hedges - 2,889 accretion = 152,978; 2024 20,486 + 23,121 - 2,246 + 13,063
//   termination - 2,432 - 976 - 1,416 joint venture = 49,600. All cells now follow the filed line, the only basis a filing prints.
// - BURE.ST: the number is right and means something else, net sales are 0, the vendor counts dividends and interest. No number moves;
//   the listing carries a checked definition hint (configs/g31-hinweise.json, key definitionen), shown behind the growth.
// Real vendor packets: BRBI and GAU in tests/fixtures/financial-known-cases.json, BURE.ST in tests/fixtures/hand-table-abgrenzung-20261031.json. Every red probe changes an in-memory copy only; live
// files are hashed before and after. Break-once on test data: `node tests/hand-table-abgrenzung-20261031.test.js --prove-red` must exit 1.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
process.env.FINDASH_SNAPSHOTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'abgrenzung-20261031-'));
const { applyFinancialCases, financialReasons, validateTable, table } = require('../lib/financial-known-cases.js');
const { g31Shadow } = require('../lib/g31-recency.js');
const { opIncYahooAdjusted } = require('../src/scoring/lamps.js');
const W = require('../scripts/write-findash-export.js');
const axes = require('../src/scoring/axes.js');
const { safeSnapshotFilename } = require('../lib/snapshot-fs.js');
const hints = require('../configs/g31-hinweise.json');
const fixtures = { ...require('./fixtures/financial-known-cases.json').snapshots, ...require('./fixtures/hand-table-abgrenzung-20261031.json').snapshots };

const root = path.resolve(__dirname, '..');
const live = ['configs/financial-known-cases.json', 'configs/g31-hinweise.json', 'lib/financial-known-cases.js', 'scripts/write-findash-export.js', 'tests/fixtures/hand-table-abgrenzung-20261031.json', 'tests/fixtures/financial-known-cases.json'];
const liveHashes = () => live.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'));
const beforeHashes = liveHashes();
const REV = '2026-10-31-sdabgr', FIRMS = ['BRBI', 'GAU'];
const value = row => (row && typeof row === 'object' ? row.value ?? null : row ?? null);
const snap = t => structuredClone(fixtures[t]);
const apply = (t, cfg) => applyFinancialCases(snap(t), cfg && { table: cfg }).snapshot;
const native = (s, box, field) => s[box][field].map(r => (value(r) === null ? null : Math.round(value(r) / s.meta.fxRateApplied)));
const leg = s => { const v = g31Shadow(s).v1; return [v.basis, v.periodEnd, v.priorPeriodEnd, v.pct === null ? null : Math.round(v.pct * 10) / 10]; };
function before() {
  const copy = structuredClone(table);
  copy.cases = copy.cases.filter(c => c.revision !== REV);
  copy.coverage = copy.coverage.filter(v => !FIRMS.includes(v.ticker));
  return validateTable(copy);
}
const BRBI_AFTER = ['quarter', '2026-06-30', '2025-06-30', -6.6];

if (process.argv.includes('--prove-red')) {
  assert.deepEqual(leg(apply('BRBI', before())), BRBI_AFTER);
  console.log('hand-table-abgrenzung-20261031: --prove-red did NOT fire');
  process.exit(0);
}

const own = table.cases.filter(c => c.revision === REV);

test('19 sourced rows validate, two coverage rows, every reason names its period, no substitute 0, no dash as punctuation', () => {
  assert.equal(own.length, 19);
  assert.deepEqual(FIRMS.map(t => own.filter(c => c.ticker === t).length), [8, 11]);
  assert.deepEqual(table.coverage.filter(v => FIRMS.includes(v.ticker)).map(v => v.ticker + v.field + v.coversThrough), ['BRBIrevenueQ2026-06-30', 'GAUopIncQ2026-06-30']);
  assert.ok(table.cases.slice(-19).every(c => c.revision === REV), 'appended last');
  const de = p => p.split('-').reverse().join('.');
  for (const c of own) {
    assert.ok(c.replacementValue !== 0 && c.replacementValue !== null, c.caseId);
    assert.ok(c.sources.length && c.sources.every(s => s.url.startsWith('https://www.sec.gov/Archives/edgar/data/') && s.quote && s.page && s.form && s.accession && s.filed && s.verifiedAt === '2026-10-31' && s.sourceUnit), c.caseId);
    assert.ok(c.reason.includes(de(c.period)), `${c.caseId} names its period`);
    assert.doesNotMatch(c.reason, /[–—]| - |kauf|verkauf|w7b|sdabgr/i, c.caseId);
    assert.match(c.reason, /Geprüft am 31\.10\.2026\.$/, c.caseId);
    if (c.replacementValue === c.expectedBadValue) assert.match(c.reason, /^bestätigt:/, c.caseId);
    else assert.doesNotMatch(c.reason, /bestätigt:/, c.caseId);
  }
});

test('the quotes print the replacement values', () => {
  const k = (id, n) => { const c = own.find(x => x.caseId === id); assert.ok(c, id); assert.ok(c.sources.some(s => s.quote.includes(n)), `${id} ${n}`); };
  for (const [id, n] of [['brbi-2026-06-30-revenueQ-20261031', '130,099'], ['brbi-2025-06-30-revenueQ-20261031', '139,289'], ['brbi-2026-03-31-revenueQ-20261031', '134,807'],
    ['brbi-2025-09-30-revenueQ-20261031', '133,287'], ['brbi-2025-12-31-revenueQ-20261031', '531,380'], ['brbi-2025-12-31-revenueQ-20261031', '400,062'],
    ['brbi-2025-12-31-annualRev-20261031', '531,380'], ['brbi-2024-12-31-annualRev-20261031', '581,219'], ['brbi-2023-12-31-annualRev-20261031', '435,813'], ['gau-2026-06-30-opIncQ-20261031', '90,368'],
    ['gau-2026-03-31-opIncQ-20261031', '66,256'], ['gau-2025-12-31-opIncQ-20261031', '43,915'], ['gau-2025-09-30-opIncQ-20261031', ' 176 '], ['gau-2025-06-30-opIncQ-20261031', '19,118'],
    ['gau-2025-03-31-opIncQ-20261031', '(26,327)'], ['gau-2025-12-31-annualOpInc-20261031', '36,543'], ['gau-2024-12-31-annualOpInc-20261031', '20,486'], ['gau-2023-12-31-annualOpInc-20261031', '20,122'], ['gau-2022-12-31-annualOpInc-20261031', '39,419'], ['gau-2021-12-31-annualOpInc-20261031', '(60,576)']]) k(id, n);
});

test('BRBI: the shown growth is the filed one, the vendor cell is the sum the statement prints in two lines, the error is back without the rows', () => {
  assert.deepEqual(leg(apply('BRBI', before())), ['quarter', '2026-06-30', '2025-06-30', -31.4]);
  const out = apply('BRBI');
  assert.deepEqual(leg(out), BRBI_AFTER);
  assert.deepEqual(native(out, 'timeseries', 'revenueQ'), [130099000, 134807000, 131318000, 133287000, 139289000]);
  assert.deepEqual(native(out, 'annual', 'annualRev'), [531380000, 581219000, 435813000, null]);
  const raw = snap('BRBI');
  assert.deepEqual(native(raw, 'timeseries', 'revenueQ').slice(0, 1), [2095599000 + 85912000]);
  assert.deepEqual(native(raw, 'timeseries', 'revenueQ').slice(4, 5), [3101487000 + 77732000]);
  assert.deepEqual(native(raw, 'annual', 'annualRev').slice(0, 2), [12107943000 + 319804000, 7049611000 + 364822000]);
  assert.deepEqual(native(raw, 'annual', 'annualRev').slice(2, 3), [6310038000 + 246665000]);
  assert.equal(value(raw.metrics.revenueGrowthYoY), -6.6000000000000005, 'the vendor summary field agrees with the filed line');
  // Sibling fields keep the vendor cell, which ties to filed lines: total revenues minus personnel; profit before tax.
  assert.deepEqual(native(out, 'timeseries', 'grossProfitQ').slice(0, 1), [130099000 - 49989000]);
  assert.deepEqual(native(out, 'annual', 'annualOpInc').slice(0, 2), [232651000, 239430000]);
});

test('GAU: every cell on the filed line, the year reconciles to the thousand, the source lamp goes out, revenue and gross profit stay', () => {
  const was = snap('GAU');
  assert.equal(opIncYahooAdjusted(was), true);
  assert.equal(value(was.annual.annualOpInc[0]), 36543000 + 119324000 - 2889000);
  assert.equal(value(was.annual.annualOpInc[1]), 20486000 + 23121000 - 2246000 + 13063000 - 2432000 - 976000 - 1416000);
  assert.equal(value(was.timeseries.opIncQ[3]), 38375000 - 729000, 'Q3 2025 is the first filing before the hedges moved, less accretion');
  const out = apply('GAU');
  assert.deepEqual(out.timeseries.opIncQ.map(value), [90368000, 66256000, 43915000, 176000, 19118000, -26327000]);
  assert.deepEqual(out.annual.annualOpInc.map(value), [36543000, 20486000, 20122000, 39419000, -60576000], "the older years are the filed line, as the vendor has them");
  assert.equal(opIncYahooAdjusted(out), false, 'all shown years are issuer cells');
  assert.deepEqual(out.timeseries.revenueQ.map(value), was.timeseries.revenueQ.map(value));
  assert.deepEqual(out.annual.annualGP.map(value), was.annual.annualGP.map(value));
  assert.deepEqual(leg(out), leg(was), 'revenue growth does not move');
  assert.deepEqual(leg(out), ['quarter', '2026-06-30', '2025-06-30', 60.9]);
  assert.ok(financialReasons(out).some(r => r.includes('119,3 Mio. USD')));
});

test('fail closed: a changed vendor cell and a quarter after coverage are withheld, never shown as verified', () => {
  const moved = snap('BRBI');
  moved.timeseries.revenueQ[0] = { value: value(moved.timeseries.revenueQ[0]) * 1.5 };
  assert.equal(value(applyFinancialCases(moved).snapshot.timeseries.revenueQ[0]), null);
  const newer = snap('GAU');
  newer.timeseries.opIncQ.unshift({ value: 123000000 });
  newer.timeseries.opIncQEnds.unshift('2026-09-30');
  const held = applyFinancialCases(newer).snapshot.timeseries.opIncQ[0];
  assert.equal(value(held), null);
  assert.equal(held.financialMissing.reasonCode, 'period-after-coverage');
});

test('BURE.ST: no number moves, the hint is on the row, with any growth, and only on this listing', () => {
  assert.deepEqual(own.filter(c => c.ticker === 'BURE.ST'), []);
  const s = snap('BURE.ST');
  assert.deepEqual(native(applyFinancialCases(s).snapshot, 'annual', 'annualRev').slice(0, 2), [268000000, 241000000]);
  assert.deepEqual(native(s, 'timeseries', 'revenueQ').slice(0, 1), [206000000 + 5000000]);
  assert.deepEqual(native(s, 'timeseries', 'revenueQ').slice(3, 4), [193000000 + 2000000]);
  fs.writeFileSync(path.join(process.env.FINDASH_SNAPSHOTS_DIR, safeSnapshotFilename('BURE.ST')), JSON.stringify(s));
  const row = { ticker: 'BURE.ST', score: 76.6, revGrowthYoYPct: axes.revGrowthLevel(s), overview: { kind: 'gp', value: 0.061, companion: 162.8 } };
  const hint = W.mapBoardRow(row, 0, 'main').g31Hinweis;
  assert.equal(hint.code, 'abgrenzung');
  assert.match(hint.reason, /Net sales 0/);
  assert.equal(W.mapBoardRow({ ...row, revGrowthYoYPct: 12.5 }, 1, 'main').g31Hinweis.code, 'abgrenzung', 'a definition does not depend on the shown pair');
  assert.equal(W.mapBoardRow({ ...row, ticker: '_NO_HINT' }, 2, 'main').g31Hinweis, null);
});

test('definition table: one row, checked code, quoted sources, plain German; lib/g31-recency.js does not read it', () => {
  assert.deepEqual(hints.definitionen.map(d => d.ticker), ['BURE.ST']);
  for (const d of hints.definitionen) {
    assert.equal(d.code, 'abgrenzung');
    assert.equal(d.verifiedAt, '2026-10-31');
    assert.ok(d.sources.length >= 3 && d.sources.every(s => s.url.startsWith('https://') && s.page && s.quote && s.form && s.published), d.ticker);
    assert.doesNotMatch(d.reason, /[–—]| - |kauf|verkauf/i);
    assert.match(d.reason, /Geschäftsjahr 2025/, 'names its period');
  }
  assert.ok(!hints.entries.some(e => e.code === 'abgrenzung'), 'the sealed hint loader accepts two codes only');
});

test('live files are unchanged by this test', () => {
  assert.deepEqual(liveHashes(), beforeHashes);
});
