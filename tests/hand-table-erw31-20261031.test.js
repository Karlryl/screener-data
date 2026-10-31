'use strict';
// Repairs from the check of the data run of 31.10.2026 (run 41184535364, export of 09:47 UTC).
// - 7911.T: the vendor moved to the post-split count without treasury shares (561,108,050). The row still held the issued
//   count with treasury (589,412,480), so the vendor value counted as unknown and the firm left every board for a day.
//   Both counts are right and the vendor has used both within a month: the row now confirms either.
// - 3471.T, ALK.TO: the vendor skips a fiscal year on this listing. #73 withheld revenue; gross profit still paired the two
//   years around the gap and fed the score as annual growth (+65.1 %, +623.8 %).
// - Expectations bound to one ticker of a firm whose board leg changes daily, and ranks taken from a list position.
// Every probe changes an in-memory copy or a temp dir; live files are hashed before and after.
// Break-once on test data: `node tests/hand-table-erw31-20261031.test.js --prove-red` runs the after-checks on the state
// before this change and must exit 1.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { applyFinancialCases, financialReasons, validateTable, table } = require('../lib/financial-known-cases.js');
const { applyShareCountTable, loadShareCountTable } = require('../lib/ads-hand-table.js');
const guard = require('../lib/market-cap-guard.js');
const axes = require('../src/scoring/axes.js');
const { run } = require('../scripts/tageslauf-erwartungen.js');
const fixtures = require('./fixtures/hand-table-zahlenjagd-20261030.json').snapshots;
const root = path.resolve(__dirname, '..');
const live = ['configs/financial-known-cases.json', 'configs/share-count-hand-table.json', 'data-health/erwartungen.json'];
const liveHashes = () => live.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'));
const beforeHashes = liveHashes();
const REV = '2026-10-31-erw31';
const snap = t => structuredClone(fixtures[t]);
const cell = row => (typeof row === 'number' ? row : row?.value ?? null);

// The real vendor state of 31.10.2026: value and USD price as stored in the snapshot of run 41184535364.
const VENDOR_31 = { value: 7578497556.846791, px: 13.506306951 };
const toppan31 = () => {
  const s = snap('7911.T');
  s.marketCap = { ...s.marketCap, value: VENDOR_31.value, source: 'yahoo_quote', asOf: '2026-10-31T08:59:25.213Z' };
  s.price = { ...s.price, regularMarketPrice: VENDOR_31.px };
  s.meta.asOf = '2026-10-31T08:59:25.213Z';
  return s;
};
const { alsoRightShares: _second, ...rowWithoutSecond } = guard.table['7911.T'];
const OLD_ROW = { ...rowWithoutSecond, shares: 589412480 };
const tableBefore = () => {
  const copy = structuredClone(table);
  copy.cases = copy.cases.filter(c => c.revision !== REV);
  return validateTable(copy);
};

if (process.argv.includes('--prove-red')) {
  // The state before this change: the row with the issued count withholds, and gross profit stays a two-year pair.
  const s = toppan31();
  assert.equal(applyShareCountTable(s, '7911.T', VENDOR_31.px, { '7911.T': OLD_ROW }).status, 'confirmed');
  console.log('hand-table-erw31-20261031: --prove-red did NOT fire');
  process.exit(0);
}

test('Toppan: the row is issued shares minus treasury shares, as the filings give them', () => {
  const row = guard.table['7911.T'];
  assert.equal(row.shares, 589412480 - 2 * (13947987 + 204248));
  assert.deepEqual(row.alsoRightShares, [589412480]);
  assert.match(row.source.quote, /589,412,480/);
  assert.match(row.source.treasuryQuote, /204,248/);
  assert.match(row.source.treasuryPage, /13,947,987/);
  assert.equal(row.sharesAsOf, '2026-09-30', 'the older of the two counts');
  assert.equal(row.withholdUnverified, true);
  assert.ok(row.reason.includes('01.10.2026') && row.reason.includes('30.09.2026'), 'the reason names both days');
});

test('Toppan: the vendor state of 31.10.2026 is reproduced as withheld under the old row and confirmed under the new one', () => {
  const held = toppan31();
  assert.equal(applyShareCountTable(held, '7911.T', VENDOR_31.px, { '7911.T': OLD_ROW }).status, 'stale', 'the failure of 31.10.2026');
  const out = guard.prepareMarketCap(toppan31());
  assert.equal(out.marketCap.value, VENDOR_31.value, 'the vendor value stays');
  assert.equal(out.marketCap.source, 'yahoo_quote');
  assert.equal(out.meta.marketCapReason, undefined);
  assert.equal(out.meta._shareCountHandTableStale, undefined);
  assert.ok(out.marketCap.value > 6.8e9 && out.marketCap.value < 9.5e9, 'inside the expectation of 6.8 to 9.5 bn USD');
  assert.equal(guard.correctedBelowFloor(out), false);
});

test('Toppan: a held snapshot of 31.10.2026 comes back through the price-only path', () => {
  // What pull-yahoo.js does on a quote: value and source are overwritten and the missing flag goes, then the guard runs.
  const s = toppan31();
  guard.applyMarketCapGuard(s, undefined);
  assert.equal(s.marketCap.source, 'yahoo_quote');
  const held = { ...s, marketCap: { ...s.marketCap, value: null, missing: true, source: 'hand-table:market-cap-hold', yahooValue: VENDOR_31.value } };
  assert.equal(guard.applyMarketCapGuard(structuredClone(held)).status, 'withheld', 'the stored hold alone never releases itself');
  const quote = structuredClone(held);
  quote.marketCap.value = VENDOR_31.value; quote.marketCap.source = 'yahoo_quote'; delete quote.marketCap.missing;
  assert.equal(guard.applyMarketCapGuard(quote, VENDOR_31.px).status, 'confirmed');
  assert.equal(quote.marketCap.yahooValue, undefined);
});

test('Toppan: the pre-split count of 30.10.2026 is still corrected, now to the count without treasury shares', () => {
  const out = guard.prepareMarketCap(snap('7911.T'));
  assert.equal(out.marketCap.source, 'hand-table:shares');
  assert.ok(Math.abs(out.marketCap.value / (out.price.regularMarketPrice * 561108010) - 1) < 1e-9);
  assert.equal(out.meta.marketCapReason, guard.table['7911.T'].reason);
});

test('Toppan: the vendor on the issued count is confirmed too; only this row has a second count; a third count is withheld', () => {
  const issued = toppan31();
  issued.marketCap.value = VENDOR_31.px * 589412480;
  const out = guard.prepareMarketCap(issued);
  assert.equal(out.marketCap.value, VENDOR_31.px * 589412480, 'the vendor value stays');
  assert.equal(out.meta.marketCapReason, undefined);
  assert.ok(out.marketCap.value > 6.8e9 && out.marketCap.value < 9.5e9, 'inside the expectation of 6.8 to 9.5 bn USD');
  assert.equal(applyShareCountTable(toppan31(), '7911.T', VENDOR_31.px, { '7911.T': rowWithoutSecond }).status, 'confirmed', 'the first count alone holds the state of 31.10.2026');
  const issuedWithoutSecond = toppan31();
  issuedWithoutSecond.marketCap.value = VENDOR_31.px * 589412480;
  assert.equal(applyShareCountTable(issuedWithoutSecond, '7911.T', VENDOR_31.px, { '7911.T': rowWithoutSecond }).status, 'stale', 'the second count is what confirms the issued state');
  assert.deepEqual(Object.entries(loadShareCountTable()).filter(([, r]) => r.alsoRightShares).map(([k]) => k), ['7911.T']);
  const third = toppan31();
  third.marketCap.value = VENDOR_31.px * 3e9;
  const held = guard.prepareMarketCap(third);
  assert.equal(held.marketCap.value, null);
  assert.match(held.meta.marketCapReason, /^Börsenwert nicht verlässlich:/);
});

test('the loader refuses a malformed second count (fail loud)', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'erw31-table-')), 't.json');
  const good = { shares: 100, sharesAsOf: '2026-07-30', reviewBy: '2026-11-16', wrongShares: [200], source: { url: 'https://x.test/a', quote: 'q' }, verifiedAt: 'v' };
  fs.writeFileSync(file, JSON.stringify({ X: { ...good, alsoRightShares: [105] } }));
  assert.deepEqual(loadShareCountTable(file).X.alsoRightShares, [105]);
  for (const bad of [[], [0], [100.5], [205], 'x']) {
    fs.writeFileSync(file, JSON.stringify({ X: { ...good, alsoRightShares: bad } }));
    assert.throws(() => loadShareCountTable(file), /alsoRightShares/, JSON.stringify(bad));
  }
});

test('3471.T and ALK.TO: gross profit no longer pairs two years, the reason says why, revenue and the newest year stay', () => {
  for (const [t, end, gpOld, gpNew] of [['3471.T', '31.07.2024', 12206983000, 20157154000], ['ALK.TO', '30.06.2024', 70085000, 507289000]]) {
    const was = applyFinancialCases(snap(t), { table: tableBefore() }).snapshot;
    assert.ok(axes.gpGrowth(was) > (t === 'ALK.TO' ? 6 : 0.6), t + ': the two-year pair fed the axis');
    const out = applyFinancialCases(snap(t)).snapshot;
    assert.equal(axes.gpGrowth(out), null, t);
    const native = out.annual.annualGP.map(r => (cell(r) === null ? null : Math.round(cell(r) / out.meta.fxRateApplied)));
    assert.deepEqual(native, [gpNew, null, null, null], t);
    assert.equal(table.cases.find(c => c.ticker === t && c.field === 'annualGP' && c.revision === REV).expectedBadValue, gpOld, t);
    assert.ok(financialReasons(out).some(r => r.startsWith(`Bruttogewinn 2024 (Ende ${end}) zurückgehalten`)), t);
    assert.deepEqual(out.annual.annualRev.map(cell), was.annual.annualRev.map(cell), t + ': revenue as before');
  }
});

test('3471.T: a changed vendor gross profit empties the series instead of being trusted', () => {
  const s = snap('3471.T');
  s.annual.annualGP[1] = { ...s.annual.annualGP[1], value: cell(s.annual.annualGP[1]) * 1.1 };
  const out = applyFinancialCases(s).snapshot;
  assert.deepEqual(out.annual.annualGP.map(cell), [null, null, null, null]);
});

test('the two holds are the only rows of this revision and carry a source each', () => {
  const own = table.cases.filter(c => c.revision === REV);
  assert.deepEqual(own.map(c => c.ticker).sort(), ['3471.T', 'ALK.TO']);
  for (const c of own) {
    assert.ok(c.sources.length && c.sources.every(s => s.url.startsWith('https://') && s.quote && s.page && s.verifiedAt === '2026-10-31'), c.caseId);
    assert.equal(c.replacementValue, null, 'a hold never invents a number');
    assert.ok(!/ [-–—] /.test(c.reason), c.caseId + ': no dash as punctuation');
  }
});

// Export stub in the file shape the script reads; the expectation rows are the committed ones.
const ROWS = JSON.parse(fs.readFileSync(path.join(root, 'data-health/erwartungen.json'), 'utf8'));
async function verdicts(ids, board, rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erw31-export-'));
  fs.mkdirSync(path.join(dir, 'full'));
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ generated_at: '2026-11-03T09:00:00.000Z', branches: [board] }));
  fs.writeFileSync(path.join(dir, 'full', board + '.json'), JSON.stringify({ profitable: rows, unprofitable: [] }));
  const list = path.join(dir, 'erwartungen.json');
  const picked = ROWS.filter(e => ids(e));
  assert.ok(picked.length, 'rows found');
  fs.writeFileSync(list, JSON.stringify(picked));
  const { report } = await run({ exportBase: dir, erwartungen: list, datum: '2026-11-03' });
  return report.ergebnisse.map(r => r.urteil);
}
const led = (ticker, extra) => ({ ticker, track: 'profitable', ...extra });
const alk = e => /^(pr73-ALKTO|pr\d+-ALKAX)/.test(e.id);

test('Alkane: whichever leg leads, the check holds on the right numbers and fails on the old wrong ones', async () => {
  const name = 'Alkane Resources Ltd';
  const ax = { name, revGrowthYoYPct: 256.69, rank: 26, rankGrund: null };
  const to = { name, revGrowthYoYPct: null, rank: null, rankGrund: 'zuWenigBelegteAchsen' };
  assert.deepEqual([...new Set(await verdicts(alk, 'materials', [led('ALK.AX', ax)]))], ['erfüllt']);
  assert.deepEqual([...new Set(await verdicts(alk, 'materials', [led('ALK.TO', to)]))], ['erfüllt']);
  // The state before #73 on the old leg, and a wrong rank on the new one.
  assert.ok((await verdicts(alk, 'materials', [led('ALK.TO', { name, revGrowthYoYPct: 443.2, rank: 2, rankGrund: null })])).every(u => u === 'nicht erfüllt'));
  assert.ok((await verdicts(alk, 'materials', [led('ALK.AX', { ...ax, revGrowthYoYPct: 443.2, rank: 2 })])).every(u => u === 'nicht erfüllt'));
  assert.ok((await verdicts(alk, 'materials', [led('OTHER', { name: 'x', revGrowthYoYPct: 1, rank: 1, rankGrund: null })])).every(u => u === 'nicht erfüllt'), 'a missing firm never passes');
});

test('IONOS: the check follows the firm on either leg and fails on the old wrong number', async () => {
  const ios = e => e.id.startsWith('pr73-IOSDE');
  const name = 'IONOS Group SE';
  const right = { name, revGrowthYoYPct: 5.51, revGrowthBasis: 'year', rank: 41 };
  for (const t of ['IOS.DE', 'IOS.VI']) assert.deepEqual([...new Set(await verdicts(ios, 'it-services', [led(t, right)]))], ['erfüllt'], t);
  assert.deepEqual(await verdicts(ios, 'it-services', [led('IOS.VI', { name, revGrowthYoYPct: -21.4, revGrowthBasis: 'quarter', rank: 43 })]), ['nicht erfüllt', 'nicht erfüllt', 'erfüllt']);
});

test('Enel, 3471.T, Jio: an empty rank passes only with its reason, the old prediction and the old wrong rank fail', async () => {
  for (const [ids, board, who] of [
    [e => /ENEL-rang/.test(e.id), 'utilities', { name: 'Enel SpA' }],
    [e => /3471T-(rang|ranggrund)$/.test(e.id), 'real-estate', { ticker: '3471.T' }],
  ]) {
    const row = extra => ({ ticker: 'X', track: 'profitable', ...who, ...extra });
    assert.deepEqual([...new Set(await verdicts(ids, board, [row({ rank: null, rankGrund: 'zuWenigBelegteAchsen' })]))], ['erfüllt'], board);
    assert.ok((await verdicts(ids, board, [row({ rank: 197, rankGrund: null })])).every(u => u === 'nicht erfüllt'), board);
    assert.ok((await verdicts(ids, board, [row({ rank: null, rankGrund: 'dupIssuer' })])).includes('nicht erfüllt'), board + ': another reason is not this result');
  }
  const jio = e => e.id === 'pr73-JIOFINBO-rang';
  const row = rank => ({ ticker: 'JIOFIN.BO', name: 'Jio Financial Services Limited', track: 'profitable', rank });
  assert.deepEqual(await verdicts(jio, 'financials', [row(43)]), ['erfüllt']);
  for (const wrong of [8, 81]) assert.deepEqual(await verdicts(jio, 'financials', [row(wrong)]), ['nicht erfüllt'], String(wrong));
});

test('firms below the size floor end on 31.10.2026 and are no longer measured on Tuesday', async () => {
  const ended = ['pr62-AHCO-wachstum', 'pr71-SGML-score', 'pr71-SGML-achsen'];
  for (const id of ended) {
    const e = ROWS.find(x => x.id === id);
    assert.equal(e.gueltigBis, '2026-10-31', id);
    assert.match(e.grund, /Größengrenze/, id);
  }
  assert.deepEqual(await verdicts(e => ended.includes(e.id), 'materials', []), ['abgelaufen', 'abgelaufen', 'abgelaufen']);
});

test('live files are unchanged by this test', () => {
  assert.deepEqual(liveHashes(), beforeHashes);
});
