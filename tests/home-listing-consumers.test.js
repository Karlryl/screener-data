'use strict';
// Codex R1 on PR 89 (12.11.2026), both P1: the class-sum writer (merge job) and the Rule-of-40 reader chose an issuer's listing
// with the P290 comparator but without the coverage the scoring computes, so a thin home listing pushed out a ranked one.
// Probe: the sealed ALNY fixture as two listings of one firm, same growth month; PROBE.VI full data (4/7, rank 1), PROBE.DE
// revenue only (2/7, no rank) and the evidenced home listing. Both consumers must keep PROBE.VI.
// Break-once on the code in memory only (the coverage lines removed); live files are hashed before and after.
process.env.RUN_DATE_UTC = process.env.RUN_DATE_UTC || '2026-11-11';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), Module = require('node:module');
const root = path.resolve(__dirname, '..');
const live = ['lib/mcap-class-sum.js', 'scripts/write-rule40-export.js', 'src/scoring/score.js', 'protocol/gqs-00/1.1.0/golden-fixtures.json'];
const hashes = () => live.map((f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'));
const before = hashes();
const S = require('../src/scoring/score.js'), F = require('../src/scoring/formulas/index.js'), W = require('../scripts/write-findash-export.js');
const { prepareSnapshot } = require('../lib/yahoo-q4-known-cases.js');
const { homeListingRank, shownGrowthMonth } = require('../lib/home-listing.js');

const golden = JSON.parse(fs.readFileSync(path.join(root, 'protocol/gqs-00/1.1.0/golden-fixtures.json'), 'utf8')).cases.find((c) => c.ticker === 'ALNY');
function pair(extra = (s) => s) {
  const good = structuredClone(golden.rawSnapshot);
  good.meta = { ...good.meta, ticker: 'PROBE.VI', country: 'Germany', name: 'Review Quality Probe', exchangeName: 'Vienna', tradingCurrency: 'USD', reportingCurrency: 'USD', reportingCurrencyOriginal: 'USD' };
  good.marketCap = { value: 2e9 };
  extra(good);
  const bad = structuredClone(good);
  bad.meta.ticker = 'PROBE.DE'; bad.meta.exchangeName = 'Xetra'; bad.marketCap = { value: 1e9 };
  const keepAnnual = (f) => f.startsWith('annualRev') || ['annualFCF', 'annualOCF'].includes(f);
  for (const k of Object.keys(bad)) {
    if (k === 'timeseries') bad[k] = Object.fromEntries(Object.entries(bad[k]).filter(([f]) => f.startsWith('revenue')));
    else if (k === 'annual') bad[k] = Object.fromEntries(Object.entries(bad[k]).filter(([f]) => keepAnnual(f)));
    else if (k === 'metrics') bad[k] = Object.fromEntries(Object.entries(bad[k]).filter(([f]) => ['fcfMarginTTM', 'revenueTTM', 'ebitdaMargins'].includes(f)));
    else if (!['meta', 'marketCap', 'timeseries', 'annual'].includes(k)) delete bad[k];
  }
  return [bad, good];
}
const ranked = (snaps) => {
  const rows = S.scoreUniverse(snaps.map((s) => prepareSnapshot(structuredClone(s))), F);
  W.vergebeRaenge(rows.filter((e) => e.action === 'route'), 'probe', { warn: false });
  return rows.filter((e) => e.action === 'route').map((e) => [e.ticker, e.coverageAxes, e.rank]);
};
// The module under test with one line replaced, compiled in memory (the live file stays as it is).
function patched(rel, from, to) {
  const file = path.join(root, rel), lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  assert.equal(lines.filter((l) => l === from).length, 1, 'exact whole-line anchor in ' + rel);
  const m = new Module(file, module);
  m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(lines.map((l) => (l === from ? to : l)).join('\n'), file);
  return m.exports;
}

test('probe premise: same month, PROBE.DE is the home listing, and the scoring alone keeps PROBE.VI with rank 1', () => {
  const [bad, good] = pair();
  assert.equal(shownGrowthMonth(bad), shownGrowthMonth(good));
  assert.ok(homeListingRank('PROBE.DE', 'Germany') < homeListingRank('PROBE.VI', 'Germany'));
  assert.deepEqual(ranked([bad, good]), [['PROBE.VI', '4/7', 1]]);
});

test('class sum: the sum goes to the listing the scoring keeps, through writeFirm, prepareSnapshot, scoreUniverse and the ranks', () => {
  const C = require('../lib/mcap-class-sum.js');
  const entry = { issuer: 'Review Quality Probe', classes: [{ ticker: 'PROBE.DE', class: 'A', shares: 100, asOf: '2026-06-30' }, { ticker: 'PROBE.VI', class: 'B', shares: 100, asOf: '2026-06-30' }] };
  const sum = { value: 2e9, date: '2026-11-10', legs: [], reason: null };
  const run = (mod) => {
    const snaps = Object.fromEntries(pair().map((s) => [s.meta.ticker, s]));
    const { shown } = mod.writeFirm(snaps, entry, sum, null);
    return { shown, rows: ranked(Object.values(snaps)) };
  };
  assert.deepEqual(run(C), { shown: 'PROBE.VI', rows: [['PROBE.VI', '4/7', 1]] });
  // Break-once: without the scoring's own entry the choice falls back to the home listing and the ranked line is emptied.
  const broken = patched('lib/mcap-class-sum.js',
    "    .map((s) => ({ ...asScored(s), ticker: s.meta.ticker, s, stale: staleQuote(s) }))",
    "    .map((s) => ({ ticker: s.meta.ticker, s, stale: staleQuote(s), snapshot: { ...s, marketCap: { ...s.marketCap, value: priorValue(s) } } }))");
  const red = run(broken);
  assert.equal(red.shown, 'PROBE.DE', 'break-once did not fire');
  assert.notDeepEqual(red.rows, [['PROBE.VI', '4/7', 1]]);
});

test('Rule of 40: only PROBE.VI on the full board, both raw snapshots; the reader keeps PROBE.VI with its engine score', () => {
  const fx = require('./rule40-fixture.js');
  const withFcf = (s) => { s.metrics.fcfMarginTTM = { value: 30 }; s.annual.annualFCF = [120e6, 100e6, 80e6].map((value) => ({ value })); s.annual.annualOCF = [150e6, 130e6, 110e6].map((value) => ({ value })); };
  const [bad, good] = pair(withFcf);
  const rows = S.scoreUniverse([bad, good].map((s) => structuredClone(s)), F);
  W.vergebeRaenge(rows.filter((e) => e.action === 'route'), 'probe', { warn: false });
  const row = rows.find((e) => e.action === 'route');
  assert.equal(row.ticker, 'PROBE.VI');
  const fixture = fx.baueExport([{ row: fx.boardZeile({ ...row }), snap: good, reihe: false, branch: 'health-care' }], { generatedAt: '2026-11-11T10:56:54.395Z' });
  fs.writeFileSync(path.join(fixture.snapshotsDir, 'PROBE.DE.json'), JSON.stringify(bad));
  const pick = (mod) => { const k = mod.sammleKandidaten(fixture).kandidaten; return { k: k.map((x) => [x.ticker, x.onBoard]), out: mod.baueZeilen(k).rows.map((x) => [x.ticker, x.coverageAxes, x.score !== null]) }; };
  assert.deepEqual(pick(require('../scripts/write-rule40-export.js')), { k: [['PROBE.VI', true]], out: [['PROBE.VI', '4/7', true]] });
  const broken = patched('scripts/write-rule40-export.js', '      _dedupCoverage: dedupCoverage(routeEntry(snapshot, scoringFormulas)) || undefined,', '');
  assert.deepEqual(pick(broken).k, [['PROBE.DE', false]], 'break-once did not fire');
});

test('live files unchanged', () => assert.deepEqual(hashes(), before));
