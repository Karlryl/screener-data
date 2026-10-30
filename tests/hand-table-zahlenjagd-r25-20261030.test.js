'use strict';
// Hand tables from the board check of ranks 11 to 25 of 30.10.2026 (lane zahlenjagd). One confirmer and one refuter read each
// filing; the real vendor packets of run 41027769596 are in tests/fixtures/hand-table-zahlenjagd-r25-20261030.json.
// - ENEL.VI: revenue quarters and years match no statement line (shown +30.3 %, filed year +1.8 %, half year +0.3 %).
// - ACE.MI: Q2 2025 is the half year without Acea Energia minus Q1 with it, no quarter at all (shown +121.4 %).
// - 301297.SZ: Q2 2025 is pre-merger, Q2 2026 post-merger (shown +265 %, comparable +15.6 %).
// - GGP.L: annual revenue 1,191.2 and 461.4 against filed 2,259 and 957 M AUD (shown +158.2 %, filed +136 %).
// - 5871.TW, 9941.TW: lenders; the vendor strips interest income, so a firm with +27.2 bn TWD operating income showed a loss
//   on the unprofitable board. Held as packets with the reason, like 402340.KS, so they cannot land on the survival list.
// - 2590.HK, SOFF.OL: market cap from a share count no filing supports. 688428.SS, 003535.KS: all share classes at one price.
// Every red probe changes an in-memory copy only; live files are hashed before and after.
// Break-once on test data: `node tests/hand-table-zahlenjagd-r25-20261030.test.js --prove-red` must exit 1.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { applyFinancialCases, financialReasons, validateTable, table } = require('../lib/financial-known-cases.js');
const { g31Shadow } = require('../lib/g31-recency.js');
const guard = require('../lib/market-cap-guard.js');
const fixtures = require('./fixtures/hand-table-zahlenjagd-r25-20261030.json').snapshots;
const root = path.resolve(__dirname, '..');
const live = ['configs/financial-known-cases.json', 'configs/share-count-hand-table.json', 'lib/financial-known-cases.js', 'lib/market-cap-guard.js', 'tests/fixtures/hand-table-zahlenjagd-r25-20261030.json'];
const liveHashes = () => live.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'));
const beforeHashes = liveHashes();
const REV = '2026-10-30-sdz2';
const value = row => typeof row === 'number' ? row : row?.value ?? null;
const snap = t => structuredClone(fixtures[t]);
const apply = (t, cfg) => applyFinancialCases(snap(t), cfg && { table: cfg }).snapshot;
const native = (s, box, field) => s[box][field].map(r => value(r) === null ? null : Math.round(value(r) / s.meta.fxRateApplied));
const leg = s => { const v = g31Shadow(s).v1; return [v.basis, v.periodEnd, v.priorPeriodEnd, v.pct === null ? null : Math.round(v.pct * 10) / 10]; };
function before() {
  const copy = structuredClone(table);
  copy.cases = copy.cases.filter(c => c.revision !== REV);
  copy.quarantines = copy.quarantines.filter(q => !['5871.TW', '9941.TW'].includes(q.ticker));
  return validateTable(copy);
}
const ENEL_AFTER = ['year', '2025-12-31', '2024-12-31', 1.8];

if (process.argv.includes('--prove-red')) {
  assert.deepEqual(leg(apply('ENEL.VI', before())), ENEL_AFTER);
  console.log('hand-table-zahlenjagd-r25-20261030: --prove-red did NOT fire');
  process.exit(0);
}

const own = table.cases.filter(c => c.revision === REV);

test('22 sourced rows validate; every reason names the period of its cell, no substitute 0, no dash as punctuation', () => {
  assert.equal(own.length, 22);
  const n = t => own.filter(c => c.ticker === t).length;
  assert.deepEqual(['ENEL.VI', 'ACE.MI', '301297.SZ', 'GGP.L'].map(n), [13, 3, 4, 2]);
  for (const c of own) {
    assert.ok(c.sources.length && c.sources.every(s => s.url.startsWith('https://') && s.quote && s.page && s.verifiedAt === '2026-10-30'), c.caseId);
    assert.ok(c.reason.includes(c.period.split('-').reverse().join('.')), c.caseId + ': the period of this cell');
    assert.match(c.reason, /Geprüft am 30\.10\.2026\.$/, c.caseId);
    assert.doesNotMatch(c.reason, / [–—-] /, c.caseId + ': dash as punctuation');
    assert.notEqual(c.replacementValue, 0, c.caseId);
    if (c.periodType === '3M') assert.equal(c.replacementValue, null, c.caseId + ': no coverage, newer vendor quarters stay visible');
  }
  assert.deepEqual(table.coverage.filter(v => ['ENEL.VI', 'ACE.MI', '301297.SZ', 'GGP.L'].includes(v.ticker)), []);
});

test('Enel: revenue and gross profit quarters withheld, filed years give +1.8 % instead of +30.3 %; other listings follow', () => {
  assert.deepEqual(leg(apply('ENEL.VI', before())), ['quarter', '2026-06-30', '2025-06-30', 30.3]);
  for (const t of ['ENEL.VI', 'ENEL.MI']) {
    const out = apply(t);
    assert.deepEqual(native(out, 'timeseries', 'revenueQ'), [null, null, null, null, null], t);
    assert.deepEqual(native(out, 'timeseries', 'grossProfitQ'), [null, null, null, null, null], t);
    assert.deepEqual(native(out, 'annual', 'annualRev'), [80346000000, 78947000000, null, null], t);
    assert.deepEqual(native(out, 'annual', 'annualGP'), [null, null, null, null], t);
    assert.deepEqual(leg(out), ENEL_AFTER, t);
  }
});

test('ACEA: the invented quarter and its operating income are gone, 2023 with Acea Energia too; growth is the year pair +0.3 %', () => {
  assert.deepEqual(leg(apply('ACE.MI', before())), ['quarter', '2026-06-30', '2025-06-30', 121.4]);
  const out = apply('ACE.MI');
  assert.equal(value(out.timeseries.revenueQ[4]), null);
  assert.equal(value(out.timeseries.opIncQ[4]), null);
  assert.deepEqual(native(out, 'annual', 'annualRev').slice(0, 3), [2751469000, 2743406000, null]);
  assert.deepEqual(leg(out), ['year', '2025-12-31', '2024-12-31', 0.3]);
  assert.ok(financialReasons(out).some(r => r.includes('rund +3,4 %')));
});

test('Ferrotec: the pre-merger quarter and siblings are withheld, growth is the filed year pair +7.5 %, the reason names +15.6 %', () => {
  assert.deepEqual(leg(apply('301297.SZ', before())), ['quarter', '2026-06-30', '2025-06-30', 265]);
  const out = apply('301297.SZ');
  for (const f of ['revenueQ', 'grossProfitQ', 'opIncQ']) assert.equal(value(out.timeseries[f][3]), null, f);
  assert.deepEqual(native(out, 'annual', 'annualRev').slice(0, 3), [2866526438, 2667482418, null]);
  assert.deepEqual(leg(out), ['year', '2025-12-31', '2024-12-31', 7.5]);
  assert.ok(financialReasons(out).some(r => r.includes('rund +15,6 %')));
});

test('Greatland: filed revenue gives +136 % instead of +158.2 %', () => {
  assert.deepEqual(leg(apply('GGP.L', before())), ['year', '2026-06-30', '2025-06-30', 158.2]);
  const out = apply('GGP.L');
  assert.deepEqual(native(out, 'annual', 'annualRev').slice(0, 2), [2259000000, 957000000]);
  assert.deepEqual(leg(out), ['year', '2026-06-30', '2025-06-30', 136.1]);
});

test('Chailease and Taiwan Acceptance: held packets carry the reason; other tickers and a changed packet stay as designed', () => {
  for (const t of ['5871.TW', '9941.TW']) {
    const q = table.quarantines.find(x => x.ticker === t);
    assert.ok(q && q.reasonDate === '2026-10-30' && q.sources.every(s => s.url.startsWith('https://') && s.quote), t);
    assert.match(q.reason, /^Score fehlt:/);
    const r = applyFinancialCases(snap(t));
    assert.equal(r.snapshot.meta.financialDataIssue.caseId, q.caseId, t);
    assert.equal(r.events.some(e => e.status === 'stale'), false, t + ': fingerprint matches the real packet');
    assert.equal(applyFinancialCases(snap(t), { table: before() }).snapshot.meta.financialDataIssue, undefined, t + ': no hold without the row');
    const drift = snap(t); drift.meta.name = 'Another Issuer';
    assert.ok(applyFinancialCases(drift).events.some(e => e.reasonCode === 'quarantine-fingerprint-changed'), t + ': drift warns and keeps the hold');
  }
});

test('a changed vendor value is never replaced by the old correction', () => {
  const s = snap('ENEL.VI');
  s.annual.annualRev[0] = { ...s.annual.annualRev[0], value: value(s.annual.annualRev[0]) * 1.1 };
  assert.equal(value(applyFinancialCases(s).snapshot.annual.annualRev[0]), null);
});

const CAP = {
  '2590.HK': { shares: 1337286998, usd: 1036e6 },
  '688428.SS': { shares: 860109566, usd: 3146e6 },
  'SOFF.OL': { shares: 82346796, usd: 629e6 },
  '003535.KS': { shares: 223091000, usd: 963e6 },
};
const withImplied = (t, shares) => { const s = snap(t); s.marketCap.value = s.price.regularMarketPrice * shares; return s; };

test('market cap: the four rows land on price x issuer count with reason, derived ratios blanked; Solstad falls below the floor', () => {
  for (const [t, w] of Object.entries(CAP)) {
    const out = guard.prepareMarketCap(snap(t));
    assert.equal(out.marketCap.source, 'hand-table:shares', t);
    assert.ok(Math.abs(out.marketCap.value / w.usd - 1) < 0.01, `${t}: ${out.marketCap.value}`);
    assert.equal(out.marketCap.yahooValue, fixtures[t].marketCap.value, t);
    assert.equal(out.meta.marketCapReason, guard.table[t].reason, t);
    for (const f of ['priceSales', 'enterpriseValue', 'enterpriseToRevenue', 'enterpriseToEbitda']) assert.equal(out.metrics[f] ?? null, null, `${t}: ${f}`);
  }
  assert.equal(guard.correctedBelowFloor(guard.prepareMarketCap(snap('SOFF.OL'))), true);
  for (const t of ['2590.HK', '688428.SS', '003535.KS']) assert.equal(guard.correctedBelowFloor(guard.prepareMarketCap(snap(t))), false, t);
});

test('market cap: a fixed vendor count is confirmed, an unknown count is withheld with reason', () => {
  for (const [t, w] of Object.entries(CAP)) {
    assert.notEqual(guard.prepareMarketCap(withImplied(t, w.shares)).marketCap.source, 'hand-table:shares', t);
    const out = guard.prepareMarketCap(withImplied(t, 5e9));
    assert.equal(out.marketCap.value, null, t);
    assert.match(out.meta.marketCapReason, /^Börsenwert nicht verlässlich:/, t);
  }
});

test('live files are unchanged by this test', () => {
  assert.deepEqual(liveHashes(), beforeHashes);
});
