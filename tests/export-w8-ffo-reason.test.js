'use strict';
// W8 EX-02 (28.10.2026): every row whose FFO pill (overview kind 'ffo-badge') is empty carries ffoReason
// {code, reason}: the exit of growthVerdict('ffo-badge') in src/scoring/overview.js that left it empty, as a German
// sentence naming the fiscal years involved. Rows with a value carry no key. If the snapshot cannot explain the
// empty pill, the reason starts with "Grund nicht im Datenstand".
// Fixtures: real rows of full/real-estate.json and overview.json of the export of 28.10.2026 and the real snapshots
// of the same daily run (CI run 40657077252, artifact "snapshots").
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FIX = path.join(__dirname, 'fixtures', 'export-w8');
process.env.FINDASH_SNAPSHOTS_DIR = path.join(FIX, 'snapshot-files');
process.env.FINDASH_SMALLCAP_SNAPSHOTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'w8-ffo-sc-'));
const W = require('../scripts/write-findash-export.js');
const { prepareSnapshot } = require('../lib/yahoo-q4-known-cases.js');
const { overviewMetric } = require('../src/scoring/overview.js');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message); }
}
const readFix = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8'));
const snap = (t) => prepareSnapshot(JSON.parse(fs.readFileSync(path.join(FIX, 'snapshot-files', t + '.json'), 'utf8')));
const rows = readFix('real-estate-rows.json').rows;
const row = (t) => structuredClone(rows.find((r) => r.ticker === t));
const DAY = /\d{2}\.\d{2}\.\d{4}/;
// Today's exit per ticker (measured on the export of 28.10.2026: 65 / 58 / 4 / 6 of 133 empty pills).
const EXPECTED = {
  'CBDK.JK': 'keinJahrMitBeidenWerten', 'LTE.JO': 'keinJahrMitBeidenWerten', 'HMSO.L': 'vorjahrNichtPositiv',
  'PUBLI.OL': 'nurEinJahr', 'WEWORK.NS': 'nurEinJahr', 'KRT.BO': 'jahreNichtHintereinander',
};

check('F1 ffoGrund names the real exit for each fixture firm, with a date and no dash', () => {
  for (const [t, code] of Object.entries(EXPECTED)) {
    const g = W.ffoGrund(snap(t));
    assert.equal(g.code, code, t);
    assert.match(g.reason, DAY, t + ' names the period');
    assert.doesNotMatch(g.reason, / [-–—] /, t + ' no dash as punctuation');
    assert.ok(W.FFO_GRUND_CODES.includes(g.code));
  }
  assert.match(W.ffoGrund(snap('CBDK.JK')).reason, /Abschreibungen fehlen beim Anbieter für alle Jahre \(geprüft wurden die Geschäftsjahre mit Ende zwischen 31\.12\.2022 und 31\.12\.2025\)/);
  assert.match(W.ffoGrund(snap('LTE.JO')).reason, /nie für dasselbe Geschäftsjahr/);
  assert.match(W.ffoGrund(snap('HMSO.L')).reason, /Vorjahreswert für das Geschäftsjahr bis 31\.12\.2024 nicht positiv.*bis 31\.12\.2025/);
  assert.match(W.ffoGrund(snap('PUBLI.OL')).reason, /nur für das Geschäftsjahr bis 31\.12\.2022 zusammen/);
  assert.match(W.ffoGrund(snap('KRT.BO')).reason, /bis 31\.03\.2026 und das Geschäftsjahr bis 31\.03\.2024.*nicht direkt aufeinander folgen/);
});

check('F2 the reason only explains a pill the snapshot re-derives as empty', () => {
  for (const t of Object.keys(EXPECTED)) assert.equal(overviewMetric(snap(t), { specialTrack: 'reit' }).value, null, t);
  const dar = W.ffoGrund(snap('DAR.L'));
  assert.ok(overviewMetric(snap('DAR.L'), { specialTrack: 'reit' }).value !== null);
  assert.equal(dar.code, 'grundNichtImDatenstand');
  assert.equal(dar.reason, 'Grund nicht im Datenstand: Der Datenstand dieses Exports ergibt eine FFO-Näherung, die Rangliste zeigt keine.');
  const none = W.ffoGrund(null);
  assert.equal(none.code, 'grundNichtImDatenstand');
  assert.match(none.reason, /^Grund nicht im Datenstand: Zum Datenstand dieses Exports/);
});

check('F3 mapBoardRow sets ffoReason on every empty FFO pill of the real rows and on no row with a value', () => {
  for (const r of rows) {
    const out = W.mapBoardRow(structuredClone(r), 0);
    assert.equal(out.overview.kind, 'ffo-badge');
    if (out.overview.value === null) {
      assert.deepEqual(out.ffoReason, W.ffoGrund(snap(r.ticker)), r.ticker);
      assert.equal(out.ffoReason.code, EXPECTED[r.ticker], r.ticker);
    } else {
      assert.equal(Object.hasOwn(out, 'ffoReason'), false, r.ticker + ' has a value, so no key');
    }
  }
  const dar = W.mapBoardRow(row('DAR.L'), 0);
  assert.ok(Number.isFinite(dar.overview.value) && !Object.hasOwn(dar, 'ffoReason'));
});

check('F4 the flat overview row gets the same field', () => {
  const [r] = readFix('overview-ffo-row.json').rows;
  const out = W.mapOverviewRow(structuredClone(r), 0);
  assert.equal(out.overviewKind, 'ffo-badge');
  assert.equal(out.overviewValue, null);
  assert.equal(out.ffoReason.code, 'keinJahrMitBeidenWerten');
});

check('F5 the new key follows the growth fields, the shadow keys stay last, no older key changes', () => {
  const { G31_TRAILING_KEYS } = require('../lib/g31-recency.js');
  for (const r of rows) {
    const out = W.mapBoardRow(structuredClone(r), 0);
    if (!out.ffoReason) continue;
    const keys = Object.keys(out).filter((k) => k !== 'revGrowthReason' && !G31_TRAILING_KEYS.includes(k));
    assert.equal(keys.at(-1), 'ffoReason', r.ticker);
    assert.ok(keys.indexOf('revGrowthSourcePriorPeriodEnd') < keys.indexOf('ffoReason'), r.ticker);
    assert.deepEqual(Object.keys(out).slice(-2), ['g31Shadow', 'g31OverviewShadow'], r.ticker);
    const again = W.mapBoardRow(structuredClone(r), 0);
    delete again.ffoReason; delete again.revGrowthReason;
    const without = { ...out }; delete without.ffoReason; delete without.revGrowthReason;
    assert.deepEqual(without, again);
    assert.equal(out.overview.value, null, 'the pill stays empty, no replacement number');
  }
});

check('F6 a net-income cell withheld by the hand table is named with its year', () => {
  const s = { meta: { ticker: 'TST' }, annual: {
    annualNetIncome: [{ value: null, financialMissing: { reason: 'x', period: '2025-12-31' } }, { value: 5 }, { value: null }, { value: 4 }],
    annualNetIncomeEnds: ['2025-12-31', '2024-12-31', '2023-12-31', '2022-12-31'], annualDepreciation: [1, 1, 1, 1] } };
  const g = W.ffoGrund(s);
  assert.equal(g.code, 'jahreNichtHintereinander');
  assert.match(g.reason, /bis 31\.12\.2024 und das Geschäftsjahr bis 31\.12\.2022/);
  assert.match(g.reason, /Der Jahresüberschuss für das Geschäftsjahr bis 31\.12\.2025 ist absichtlich leer/);
});

check('F7 --check rejects a broken ffoReason and one on a row without an empty FFO pill', () => {
  const run = (r) => { const errs = []; W.checkTextGruende(r, 'x', errs); return errs.join(';'); };
  const ok = W.mapBoardRow(row('CBDK.JK'), 0);
  assert.equal(run(ok), '');
  assert.match(run({ ...ok, ffoReason: { code: 'erfunden', reason: 'x' } }), /ffoReason=/);
  assert.match(run({ ...ok, ffoReason: { code: 'nurEinJahr', reason: '' } }), /ffoReason=/);
  assert.match(run({ ...ok, overview: { ...ok.overview, value: 0.1 } }), /without an empty FFO pill/);
  assert.match(run({ ...ok, overview: { ...ok.overview, kind: 'gp' } }), /without an empty FFO pill/);
  const errs = [];
  W.validateBoardRow({ ...ok, ffoReason: 'Text' }, 'b', errs, new Set([ok.ticker]));
  assert.match(errs.join(';'), /b: ffoReason="Text"/);
});

console.log(`\nexport-w8-ffo-reason: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
