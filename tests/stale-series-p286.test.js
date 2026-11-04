'use strict';
// P286 and P287: a dated quarterly series or a growth pair too far behind the data day is no current figure. Limits and before and
// after: PR text. Break-once on test data in memory only; RUN_DATE_UTC is set per test and restored.
// Run: node --test tests/stale-series-p286.test.js
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { Module, createRequire } = require('node:module');

const P = require('../lib/annual-pairs.js');
const G = require('../lib/g31-recency.js');
const A = require('../src/scoring/axes.js');
const { financialReasons } = require('../lib/financial-known-cases.js');
const { prepareSnapshot } = require('../lib/yahoo-q4-known-cases.js');
const { belegPunkte } = require('../scripts/write-findash-export.js');

const DAY = '2026-10-31';
const withDay = (day, fn) => {
  const keep = process.env.RUN_DATE_UTC;
  if (day) process.env.RUN_DATE_UTC = day; else delete process.env.RUN_DATE_UTC;
  try { return fn(); } finally { if (keep === undefined) delete process.env.RUN_DATE_UTC; else process.env.RUN_DATE_UTC = keep; }
};
const cells = values => values.map(value => (value === null ? null : { value }));
const minusDays = n => new Date(Date.parse(DAY + 'T00:00:00Z') - n * 86400000).toISOString().slice(0, 10);
const yearBefore = iso => `${+iso.slice(0, 4) - 1}${iso.slice(4)}`;
const quarters = (newest, values = [120, 110, 105, 102, 100, 90]) => {
  const ends = values.map((_, i) => new Date(Date.parse(newest + 'T00:00:00Z') - i * 91 * 86400000).toISOString().slice(0, 10));
  ends[4] = yearBefore(ends[0]); ends[5] = yearBefore(ends[1]);
  return { revenueQ: cells(values), revenueQEnds: ends };
};
// Annual revenue by default: without any, the revenue series stays as the proof of revenue (see its own test).
const ANNUAL = { annualRev: cells([130, 100]), annualRevEnds: ['2025-12-31', '2024-12-31'] };
const pkt = (timeseries, annual = ANNUAL) => ({ meta: { ticker: 'XX' }, timeseries, annual });
const rows = (s, f) => s.timeseries[f].map(r => (r && typeof r === 'object' ? r.value : r));
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`);

test('quarterly series: 365 days behind still counts, 366 days do not, each cell empty with a dated reason and the vendor row kept', () => {
  withDay(DAY, () => {
    const fresh = pkt(quarters(minusDays(365)));
    assert.equal(P.maskStaleQuarterSeries(fresh), fresh, 'the limit day passes and the object stays the same');
    const stale = pkt(quarters(minusDays(366)));
    const before = JSON.stringify(stale);
    const out = P.maskStaleQuarterSeries(stale);
    assert.equal(JSON.stringify(stale), before, 'input not mutated');
    assert.deepEqual(rows(out, 'revenueQ'), [null, null, null, null, null, null]);
    const cell = out.timeseries.revenueQ[0];
    assert.equal(cell.financialMissing.reasonCode, 'series-stale');
    assert.deepEqual(cell.financialMissing.originalVendorRow, { value: 120 });
    assert.equal(cell.financialMissing.period, minusDays(366));
    assert.notEqual(cell.value, 0, 'never a replacement zero');
    const [de] = financialReasons(out);
    assert.match(de, /^Quartalsumsatz fehlt: Die neueste Zahl dieser Reihe endet am \d\d\.\d\d\.\d{4}, mehr als 365 Tage vor dem Datenstand; Periodenstand veraltet\.$/);
  });
});

test('each series is judged on its own ends: a stale revenue series does not touch a fresh gross-profit series, and an undated one stays', () => {
  withDay(DAY, () => {
    const s = pkt({ ...quarters(minusDays(800)), grossProfitQ: cells([30, 20]), grossProfitQEnds: [minusDays(10), minusDays(101)], netIncomeQ: cells([5, 4]) });
    const out = P.maskStaleQuarterSeries(s);
    assert.deepEqual(rows(out, 'revenueQ'), [null, null, null, null, null, null]);
    assert.deepEqual(rows(out, 'grossProfitQ'), [30, 20]);
    assert.deepEqual(rows(out, 'netIncomeQ'), [5, 4], 'no end list: age unknown, not stale');
    const noEnds = pkt({ revenueQ: cells([1, 2]) });
    assert.equal(P.maskStaleQuarterSeries(noEnds), noEnds);
  });
});

test('the newest value decides: an old value under a fresh one stays, a fresh empty cell above old values does not rescue them, a fresh zero is a value', () => {
  withDay(DAY, () => {
    const fresh = pkt({ revenueQ: cells([50, 40]), revenueQEnds: [minusDays(30), minusDays(3000)] });
    assert.equal(P.maskStaleQuarterSeries(fresh), fresh);
    const emptyTop = pkt({ revenueQ: cells([null, 40]), revenueQEnds: [minusDays(30), minusDays(3000)] });
    assert.deepEqual(rows(P.maskStaleQuarterSeries(emptyTop), 'revenueQ'), [null, null]);
    assert.equal(P.maskStaleQuarterSeries(emptyTop).timeseries.revenueQ[0], null, 'an empty cell stays as it was');
    const zero = pkt({ revenueQ: cells([0, 40]), revenueQEnds: [minusDays(30), minusDays(121)] });
    assert.equal(P.maskStaleQuarterSeries(zero), zero);
  });
});

test('without a data day nothing is masked or judged, and a sealed fixture never is', () => {
  const s = pkt(quarters('2018-03-31'));
  withDay(null, () => {
    assert.equal(P.maskStaleQuarterSeries(s), s);
    assert.equal(P.staleReason('year', '2008-12-31'), null);
  });
  withDay('not a day', () => assert.equal(P.maskStaleQuarterSeries(s), s));
  // The sealed ALNY packet as filed stays whole even on a data day that makes its quarters stale; a fixture name over other
  // statements is no fixture (Codex on #72, 04.11.2026) and is masked like any other row.
  const golden = require('../protocol/gqs-00/1.1.0/golden-fixtures.json');
  const sealed = structuredClone(golden.cases.find(c => c.rawSnapshot.meta.ticker === 'ALNY').rawSnapshot);
  withDay('2028-01-31', () => assert.equal(P.maskStaleQuarterSeries(sealed), sealed));
  const shifted = structuredClone(sealed); shifted.meta.fetchedAt = '2026-08-02T15:08:52.193Z';
  withDay('2028-01-31', () => assert.notEqual(P.maskStaleQuarterSeries(shifted), shifted, 'the same packet 1 ms later is masked'));
  const named = { ...s, meta: { ticker: 'ALNY', fetchedAt: '2026-08-02T15:08:52.192Z' } };
  withDay(DAY, () => assert.notEqual(P.maskStaleQuarterSeries(named), named));
});

test('growth pairs: a quarter pair ends after 365 days, an annual pair after 550; the partner is old by nature and is not judged', () => {
  withDay(DAY, () => {
    assert.equal(P.staleReason('quarter', minusDays(365)), null);
    assert.match(P.staleReason('quarter', minusDays(366)), /^Periodenstand veraltet: Das neueste Wertepaar endet am .*mehr als 365 Tage vor dem Datenstand; Wachstum nicht gezeigt\.$/);
    assert.equal(P.staleReason('halfYear', minusDays(366)) !== null, true);
    assert.equal(P.staleReason('year', minusDays(550)), null);
    assert.match(P.staleReason('year', minusDays(551)), /mehr als 550 Tage/);
    assert.equal(P.staleReason('year', null), null, 'an unknown age is no verdict; the period gate speaks');
    const annual = end => ({ annualRev: cells([130, 100]), annualRevEnds: [end, yearBefore(end)] });
    const fresh = G.g31Shadow(pkt({}, annual(minusDays(550)))).v1;
    assert.equal(fresh.basis, 'year');
    assert.ok(Math.abs(fresh.pct - 30) < 1e-9);
    const stale = G.g31Shadow(pkt({}, annual(minusDays(551)))).v1;
    assert.equal(stale.pct, null);
    assert.equal(stale.basis, 'none');
    assert.match(stale.reason, /Periodenstand veraltet/);
  });
});

test('axes: an annual anchor more than 550 days back drops gross profit and acceleration; a fresh pair keeps them, its older pair is not judged for age', () => {
  withDay(DAY, () => {
    const end = i => yearsBack(minusDays(100), i);
    const yearsBack = (iso, i) => `${+iso.slice(0, 4) - i}${iso.slice(4)}`;
    const annual = anchor => ({ annualRev: cells([130, 100, 90]), annualRevEnds: [0, 1, 2].map(i => yearsBack(anchor, i)), annualGP: cells([65, 50, 45]), annualGPEnds: [0, 1, 2].map(i => yearsBack(anchor, i)) });
    const fresh = pkt({}, annual(end(0)));
    assert.notEqual(A.gpGrowth(fresh), null);
    assert.notEqual(A.revAcceleration(fresh), null, 'the older year of the acceleration is more than 550 days back and still counts');
    const stale = pkt({}, annual('2024-06-30'));
    assert.equal(A.gpGrowth(stale), null);
    assert.equal(A.revAcceleration(stale), null);
    // Pop Mart pattern (Codex R16, Claude 04.11.2026): FY2024 is 669 days back; the axes drop with the shown figure at 550 days.
    const gap = pkt({}, annual('2024-12-31'));
    assert.equal(A.gpGrowth(gap), null);
    assert.equal(A.revAcceleration(gap), null);
    assert.equal(G.g31Shadow(gap).v1.pct, null);
    assert.match(G.g31Shadow(gap).v1.reason, /Periodenstand veraltet/);
    // The limit day itself still passes: 550 days keep the axis, 551 drop it.
    const gp = anchor => A.gpGrowth(pkt({}, { annualGP: cells([65, 50]), annualGPEnds: [anchor, yearBefore(anchor)] }));
    assert.notEqual(gp(minusDays(550)), null);
    assert.equal(gp(minusDays(551)), null);
  });
});

test('acceleration: the newest quarter pair it uses is judged for age on both ways the old quarters stay (Codex R16)', () => {
  withDay(DAY, () => {
    const old = { revenueQ: cells([120, 110, 100, 90, 80, 70]), revenueQEnds: ['2018-06-30', '2018-03-31', '2017-12-31', '2017-09-30', '2017-06-30', '2017-03-31'] };
    // Way 1: without annual revenue the old quarters stay as the proof that the firm has revenue; they carry no axis.
    const proof = P.maskStaleQuarterSeries(pkt(structuredClone(old), {}));
    assert.deepEqual(rows(proof, 'revenueQ'), [120, 110, 100, 90, 80, 70], 'the proof stays');
    assert.equal(G.g31Shadow(proof).v1.pct, null);
    assert.equal(A.revAcceleration(proof), null);
    // Way 2: a fresh quarter without its year-ago partner keeps the series; the 2018 pairs give way to the annual fallback.
    const fresh = structuredClone(old); fresh.revenueQ.unshift({ value: 200 }); fresh.revenueQEnds.unshift(minusDays(31));
    const both = P.maskStaleQuarterSeries(pkt(fresh, { annualRev: cells([120, 100, 90]), annualRevEnds: ['2025-12-31', '2024-12-31', '2023-12-31'] }));
    close(A.revAcceleration(both), (120 / 100 - 1) - (100 / 90 - 1));
    // A fresh pair still counts, with its older comparison pair (old by nature).
    const ok = pkt(quarters(minusDays(30)));
    assert.notEqual(A.revAcceleration(ok), null);
  });
});

test('a process that writes board numbers needs its data day; tests and tools do not (Codex R16)', () => {
  withDay(null, () => {
    for (const entry of ['C:/x/src/scoring/run-screener.js', '/x/scripts/write-findash-export.js', 'C:\\x\\scripts\\write-filter-universe.js', '/x/scripts/write-board-history.js']) {
      assert.throws(() => P.requireDataDay(entry), /schreibt Board-Zahlen ohne gültiges RUN_DATE_UTC/, entry);
    }
    for (const entry of ['/x/scripts/write-findash-export.check.js', '/x/tests/stale-series-p286.test.js', '/x/scripts/gqs00-freeze.js', null]) P.requireDataDay(entry);
    process.env.AGE_RULE_OFF = '1';
    try { P.requireDataDay('/x/src/scoring/run-screener.js'); } finally { delete process.env.AGE_RULE_OFF; }
  });
  withDay('not a day', () => assert.throws(() => P.requireDataDay('/x/scripts/write-rule40-export.js')));
  withDay(DAY, () => P.requireDataDay('/x/scripts/write-rule40-export.js'));
});

test('a masked series reaches every reader: growth leaves the old quarters, the annual pair stands, the export counts no quarter points and no span', () => {
  withDay(DAY, () => {
    const annual = { annualRev: cells([130, 100]), annualRevEnds: ['2025-12-31', '2024-12-31'] };
    const raw = pkt(quarters('2018-03-31'), annual);
    const unmasked = G.g31Shadow(pkt(quarters('2026-09-30'), annual)).v1;
    assert.equal(unmasked.basis, 'quarter');
    const out = P.maskStaleQuarterSeries(raw);
    const leg = G.g31Shadow(out).v1;
    assert.equal(leg.basis, 'year');
    assert.ok(Math.abs(leg.pct - 30) < 1e-9);
    assert.deepEqual(belegPunkte(out.timeseries), { qPunkte: 0, qSpanTage: null });
    const live = belegPunkte(pkt(quarters('2026-09-30')).timeseries);
    assert.equal(live.qPunkte, 6);
    assert.ok(live.qSpanTage > 0, 'a live series keeps its span');
    // Codex R22: without annual revenue the 2018 quarters stay as the proof of revenue, but count no evidence points or span.
    const proof = P.maskStaleQuarterSeries(pkt(quarters('2018-06-30'), {}));
    assert.equal(rows(proof, 'revenueQ').filter(Number.isFinite).length, 6, 'the proof stays in the series');
    assert.deepEqual(belegPunkte(proof.timeseries), { qPunkte: 0, qSpanTage: null });
  });
  withDay(null, () => assert.equal(belegPunkte(pkt(quarters('2018-06-30'), {}).timeseries).qPunkte, 6, 'without a data day nothing is judged'));
});

test('every board writer stops before reading a snapshot when RUN_DATE_UTC is missing (Codex R22: the export swallowed it)', () => {
  const { spawnSync } = require('node:child_process');
  const here = path.resolve(__dirname, '..');
  const writers = ['write-findash-export', 'write-excluded-list', 'write-rule40-export', 'write-filter-universe', 'write-bewertung-export', 'write-board-history'];
  const env = { ...process.env }; delete env.RUN_DATE_UTC; delete env.AGE_RULE_OFF;
  for (const w of writers) {
    // The check is the entry's first act, outside every catch; read first, so a missing check never starts a real write.
    const src = fs.readFileSync(path.join(here, 'scripts', w + '.js'), 'utf8');
    assert.equal(src.split("require('../lib/annual-pairs.js').requireDataDay()").length, 2, w + ': exactly one entry check');
    const r = spawnSync(process.execPath, [path.join(here, 'scripts', w + '.js')], { cwd: here, env, encoding: 'utf8', timeout: 120000 });
    assert.equal(r.status, 1, w + ' exit');
    assert.match(r.stderr, /\[age-rule\] .* schreibt Board-Zahlen ohne gültiges RUN_DATE_UTC/, w);
  }
  // Every workflow that starts a writer gives it a data day or says on purpose that the rule is off (exchange-check-shadow).
  const WRITER = /node (src\/scoring\/run-screener|scripts\/write-(findash-export|excluded-list|rule40-export|filter-universe|bewertung-export|board-history))\.js( |$)/m;
  const dir = path.join(here, '.github', 'workflows');
  const starting = fs.readdirSync(dir).filter(f => f.endsWith('.yml') && WRITER.test(fs.readFileSync(path.join(dir, f), 'utf8')));
  assert.ok(starting.includes('daily-pull.yml') && starting.includes('exchange-check-shadow.yml'), starting.join(', '));
  for (const f of starting) {
    const y = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(/^\s+RUN_DATE_UTC: \$\{\{/m.test(y) || /^\s+AGE_RULE_OFF: '1'$/m.test(y), f + ': no data day and no AGE_RULE_OFF');
  }
});

test('prepareSnapshot applies it, the pull path does not', () => {
  withDay(DAY, () => {
    const raw = pkt(quarters('2018-03-31'));
    assert.deepEqual(rows(prepareSnapshot(structuredClone(raw)), 'revenueQ'), [null, null, null, null, null, null]);
    assert.deepEqual(rows(prepareSnapshot(structuredClone(raw), { atPull: true }), 'revenueQ'), [120, 110, 105, 102, 100, 90], 'stored data stay as delivered');
  });
});

test('a stale series is no proof of "no revenue": without annual revenue the cells stay and the firm is not routed to the list without revenue', () => {
  const { isPreRevenue } = require('../src/scoring/router.js');
  withDay(DAY, () => {
    const noAnnual = pkt(quarters('2014-12-31'), { annualRev: cells([null, null]), annualRevEnds: ['2025-12-31', '2020-12-31'] });
    const out = P.maskStaleQuarterSeries(noAnnual);
    assert.equal(out, noAnnual, 'the revenue series stays');
    assert.equal(isPreRevenue(out), false);
    assert.equal(G.g31Shadow(out).v1.pct, null, 'and shows no growth');
    const withAnnual = pkt(quarters('2014-12-31'), { annualRev: cells([130, 100]), annualRevEnds: ['2025-12-31', '2024-12-31'] });
    assert.deepEqual(rows(P.maskStaleQuarterSeries(withAnnual), 'revenueQ'), [null, null, null, null, null, null], 'annual revenue proves it, the old quarters go');
    const noGuard = mutant('lib/annual-pairs.js', "    if (field === 'revenueQ' && !norm(snapshot, 'annualRev').some((v) => Number.isFinite(v) && v !== 0)) continue;", '');
    assert.equal(isPreRevenue(noGuard.maskStaleQuarterSeries(noAnnual)), true, 'break-once: the firm would land on the list without revenue');
  });
});

test('every shown or fed annual figure has the age limit: overview pair, three-year rate; a fresh one passes', () => {
  const { growth3 } = require('../scripts/write-filter-universe.js');
  const annual = (newest) => ({ annualRev: cells([133, 121, 110, 100]), annualRevEnds: [0, 1, 2, 3].map(i => `${+newest.slice(0, 4) - i}${newest.slice(4)}`) });
  withDay(DAY, () => {
    assert.equal(P.annualPairGateReason(pkt({}, annual('2025-12-31')), 'annualRev', 0, 1), null);
    assert.match(P.annualPairGateReason(pkt({}, annual('2024-12-31')), 'annualRev', 0, 1), /Periodenstand veraltet/);
    assert.notEqual(growth3(pkt({}, annual('2025-12-31'))), null);
    assert.equal(growth3(pkt({}, annual('2024-12-31'))), null);
  });
  assert.notEqual(growth3(pkt({}, annual('2024-12-31'))), null, 'no data day, no age rule');
  assert.equal(P.annualPairGateReason(pkt({}, annual('2024-12-31')), 'annualRev', 0, 1), null);
});

test('an FFO pill emptied by age says so: the two years do follow each other', () => {
  const { ffoGrund } = require('../scripts/write-findash-export.js');
  const reit = newest => ({ meta: { ticker: 'XX' }, timeseries: {}, annual: { annualNetIncome: cells([50, 40]), annualNetIncomeEnds: [newest, yearBefore(newest)], annualDepreciation: [10, 10] } });
  withDay(DAY, () => {
    const g = ffoGrund(reit('2024-12-31'));
    assert.equal(g.code, 'jahreVeraltet');
    assert.match(g.reason, /Geschäftsjahr bis 31\.12\.2024 mehr als 550 Tage vor dem Datenstand/);
    assert.equal(ffoGrund(reit('2025-12-31')).code, 'grundNichtImDatenstand', 'a fresh pair has a value');
  });
});

test('acceleration: a vendor zero or a gap at position 0 does not hide an old anchor', () => {
  withDay(DAY, () => {
    const hidden = lead => pkt({}, { annualRev: cells([lead, 130, 100, 90]), annualRevEnds: ['2025-12-31', '2018-12-31', '2017-12-31', '2016-12-31'] });
    assert.equal(P.annualAccelerationGatePasses(hidden(0)), false);
    assert.equal(P.annualAccelerationGatePasses(hidden(null)), false);
    assert.equal(A.revAcceleration(hidden(null)), null);
    const noGuard = mutant('lib/annual-pairs.js', "  if (!sealedEraSnapshot(snapshot) && staleReason('axis', annualPeriodEnds(snapshot, 'annualRev')[pairs[0].iNew])) return false;", '');
    assert.equal(noGuard.annualAccelerationGatePasses(hidden(null)), true, 'break-once: the years 2018 to 2016 would feed the axis');
  });
});

test('the reload planner reads what the vendor delivered, the masked view never hides a stored quarter from it', () => {
  const { latestReportedQuarter } = require('../lib/stale-quarter-reload.js');
  const raw = pkt(quarters('2018-03-31'));
  const now = Date.parse(DAY + 'T12:00:00Z');
  assert.equal(withDay(DAY, () => latestReportedQuarter(structuredClone(raw), now)), '2018-03-31');
  assert.equal(withDay(null, () => latestReportedQuarter(structuredClone(raw), now)), '2018-03-31');
});

test('Hub Group: the withdrawn statements hold the packet, a drifted name stays held and says so', () => {
  const { applyFinancialCases, table } = require('../lib/financial-known-cases.js');
  const hubg = name => ({ meta: { ticker: 'HUBG', name, reportingCurrency: 'USD' }, timeseries: {}, annual: { annualRev: cells([3946390000, 4202585000]), annualRevEnds: ['2024-12-31', '2023-12-31'] } });
  const { snapshot, events } = applyFinancialCases(hubg('Hub Group, Inc.'));
  assert.equal(snapshot.meta.financialDataIssue?.caseId, 'hubg-withdrawn-statements-20261101');
  assert.ok(!events.some(e => e.status === 'stale'));
  assert.ok(applyFinancialCases(hubg('Hub Group')).events.some(e => e.status === 'stale'));
  assert.ok(table.quarantines.find(q => q.ticker === 'HUBG').sources.every(s => s.url.startsWith('https://www.sec.gov/')));
});

test('a run on Actions without a data day says the age rule is off', () => {
  const { ageRuleOffWarning } = require('../scripts/write-findash-export.js');
  const keep = process.env.GITHUB_ACTIONS;
  try {
    process.env.GITHUB_ACTIONS = 'true';
    assert.match(withDay(null, () => ageRuleOffWarning()), /^::warning::\[age-rule-off\]/);
    assert.equal(withDay(DAY, () => ageRuleOffWarning()), null);
    delete process.env.GITHUB_ACTIONS;
    assert.equal(withDay(null, () => ageRuleOffWarning()), null, 'local tools stay quiet');
  } finally { if (keep === undefined) delete process.env.GITHUB_ACTIONS; else process.env.GITHUB_ACTIONS = keep; }
});

test('the scoring job carries the frozen run date', () => {
  const yml = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/daily-pull.yml'), 'utf8').split(/\r?\n/);
  const at = yml.indexOf('  scoring:');
  const end = yml.findIndex((l, i) => i > at && /^ {2}\S.*:$/.test(l));
  assert.ok(at > 0 && end > at);
  assert.ok(yml.slice(at, end).some(l => l.startsWith('      RUN_DATE_UTC: ${{ needs.prep.outputs.run_date }}')), 'without it the age rule stays off in the live run');
});

// Break-once: each guard line removed in memory turns its check red; the live files stay byte-identical.
const root = path.resolve(__dirname, '..');
const hash = rel => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex');
function mutant(rel, anchor, replacement) {
  const file = path.join(root, rel);
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  assert.equal(lines.filter(l => l === anchor).length, 1, 'whole-line anchor occurs exactly once: ' + anchor);
  const m = new Module(file, module);
  m.filename = file;
  m.paths = module.paths;
  m.require = createRequire(file);
  m._compile(lines.map(l => (l === anchor ? replacement : l)).join('\n'), file);
  return m.exports;
}

test('break-once: the limit, the series test and the axis anchor each fail when removed', () => {
  const before = ['lib/annual-pairs.js', 'lib/g31-recency.js'].map(hash);
  withDay(DAY, () => {
    const limit = mutant('lib/annual-pairs.js', "  if (today === null || newer === null || today - newer <= STALE_DAYS[basis]) return null;", '  if (today === null || newer === null) return null;');
    assert.notEqual(limit.staleReason('quarter', minusDays(10)), null, 'a fresh pair would be called stale');
    const series = mutant('lib/annual-pairs.js', '    if (today - _tagesnummer(newest) <= STALE_DAYS.quarter) continue;', '');
    assert.deepEqual(rows(series.maskStaleQuarterSeries(pkt(quarters(minusDays(30)))), 'revenueQ'), [null, null, null, null, null, null], 'a fresh series would be emptied');
    const noAnchor = mutant('lib/annual-pairs.js', "  if (iNew === 0 && !sealedEraSnapshot(snapshot) && staleReason('axis', ends[0])) return true; // P287: only the newest anchor is judged for age", '');
    const stale = pkt({}, { annualGP: cells([65, 50]), annualGPEnds: ['2024-06-30', '2023-06-30'] });
    assert.equal(noAnchor.axisPairBlocked(stale, 'annualGP', 0, 1), false, 'an old pair would feed the axis');
    assert.equal(P.axisPairBlocked(stale, 'annualGP', 0, 1), true);
    const noGrowth = mutant('lib/g31-recency.js', '  const gate = periodGateReason(basis, sourceEnd, sourcePriorEnd) || staleReason(basis, sourceEnd);', '  const gate = periodGateReason(basis, sourceEnd, sourcePriorEnd);');
    const old = pkt({}, { annualRev: cells([130, 100]), annualRevEnds: ['2018-12-31', '2017-12-31'] });
    assert.ok(Math.abs(noGrowth.g31Shadow(old).v1.pct - 30) < 1e-9, 'a 2018 pair would show again');
    assert.equal(G.g31Shadow(old).v1.pct, null);
    // Codex R16: the acceleration's own age check and the data-day requirement.
    const proof = pkt({ revenueQ: cells([120, 110, 100, 90, 80, 70]), revenueQEnds: ['2018-06-30', '2018-03-31', '2017-12-31', '2017-09-30', '2017-06-30', '2017-03-31'] }, {});
    const noAcc = mutant('src/scoring/axes.js', '  if (yoy.length >= 2 && !stale) return yoy[0] - yoy[yoy.length - 1];', '  if (yoy.length >= 2) return yoy[0] - yoy[yoy.length - 1];');
    assert.notEqual(noAcc.revAcceleration(proof), null, 'the 2018 pairs would carry the axis');
    assert.equal(A.revAcceleration(proof), null);
  });
  withDay(null, () => {
    const noDay = mutant('lib/annual-pairs.js', "  if (dataDay() !== null || !entry || !BOARD_WRITERS.test(entry) || process.env.AGE_RULE_OFF === '1') return;", '  return;');
    assert.doesNotThrow(() => noDay.requireDataDay('/x/scripts/write-findash-export.js'), 'without the check a writer runs silently');
    assert.throws(() => P.requireDataDay('/x/scripts/write-findash-export.js'));
  });
  assert.deepEqual(['lib/annual-pairs.js', 'lib/g31-recency.js'].map(hash), before);
});
