'use strict';
// Period gate (Daylauf 7, 24.10.2026; round 2 after Codex's NOT RELEASED, 30.10.2026, both formula drafts): growth and
// acceleration only from pairs of two dated periods one year apart. Annual pairs 334..397 days, and the prior year's own
// length must not contradict a full year; quarter/half-year pairs 350..380 days; otherwise null with a German reason that
// names the period. Covers the score path (revGrowthLevel, revAcceleration, gpGrowth, capitalEfficiency penalty, growth
// bonus) and the shown values (revGrowthLeg, g31Shadow v1, overview badges, growth3). Run: node tests/period-gate.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const P = require('../lib/annual-pairs.js');
const G = require('../lib/g31-recency.js');
const A = require('../src/scoring/axes.js');
const { revGrowthLeg } = require('../lib/rev-growth-basis.js');
const { overviewMetric } = require('../src/scoring/overview.js');
const { growth3 } = require('../scripts/write-filter-universe.js');

let passed = 0;
function check(name, fn) { fn(); passed++; console.log('  ok ' + name); }
const minus = (iso, days) => new Date(Date.parse(iso + 'T00:00:00Z') - days * 86400000).toISOString().slice(0, 10);
const END = '2026-06-30';
// Two fiscal years of revenue and gross profit whose ends lie `days` apart (prior end null = undated).
const dated = (days) => {
  const prior = days === null ? null : minus(END, days);
  return { meta: {}, timeseries: {},
    annual: { annualRev: [130, 100], annualRevEnds: [END, prior], annualGP: [65, 50], annualGPEnds: [END, prior] } };
};
const reason = (a, b, n) => `Perioden ${a} und ${b} liegen ${n} Tage auseinander, kein Jahrespaar; Wachstum nicht gezeigt.`;
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
// Real rows of the snapshots of data day 30.10.2026 (stored value order: newest first; USD as stored, ends as delivered).
const row = (annualRev, annualRevEnds) => ({ meta: {}, timeseries: {}, annual: { annualRev: annualRev.map(value => ({ value })), annualRevEnds } });
const DAIFUKU = () => row([4202009726.42, 3888813334.285, 3828046353.01, 3257873360.94], ['2025-12-31', '2024-03-31', '2023-03-31', '2022-03-31']);
const ALK = () => row([661091891.31624, 121704659.23434, 134041791.82698, 116089772.4174], ['2026-06-30', '2024-06-30', '2023-06-30', '2022-06-30']);
const NESTLE = () => row([2127375779.7, 2568859571.175, 2014142837.25], ['2025-03-31', '2024-03-31', '2023-12-31']);
const CLEAN = () => row([180, 120, 100, 80], ['2025-12-31', '2024-12-31', '2023-12-31', '2022-12-31']);

check('91-day pair (395400.KS class): growth, GP axis and badge empty, reason names both ends', () => {
  const s = dated(91), before = JSON.stringify(s);
  const v1 = G.g31Shadow(s).v1;
  assert.equal(v1.pct, null);
  assert.equal(v1.basis, 'none');
  assert.equal(v1.reason, reason('30.06.2026', '31.03.2026', 91));
  assert.equal(A.revGrowthLevel(s), null);
  assert.deepEqual(A.revYoYComponents(s), []);
  assert.equal(A.gpGrowth(s), null);
  assert.equal(revGrowthLeg(s).pct, null);
  assert.equal(overviewMetric(s, { gpClass: 'degenerate' }).value, null);
  assert.equal(JSON.stringify(s), before, 'snapshot unchanged');
});

check('365-day pair: unchanged values, no reason', () => {
  const s = dated(365);
  close(A.revGrowthLevel(s), 30);
  close(G.g31Shadow(s).v1.pct, 30);
  assert.equal(G.g31Shadow(s).v1.reason, null);
  assert.ok(Number.isFinite(A.gpGrowth(s)));
  close(revGrowthLeg(s).pct, 30);
});

check('730-day pair (MIN.AX class): empty, never another year', () => {
  const s = dated(730);
  s.annual.annualRev.push(90); s.annual.annualRevEnds.push(minus(END, 1095));
  assert.equal(A.revGrowthLevel(s), null);
  assert.equal(G.g31Shadow(s).v1.reason, reason('30.06.2026', '30.06.2024', 730));
  assert.equal(A.gpGrowth(s), null);
});

check('Codex finding 1: the blocked two-year pair gives no acceleration (18.89 points at #40 head)', () => {
  const s = dated(730);
  s.annual.annualRev.push(90); s.annual.annualRevEnds.push(minus(END, 1095));
  assert.equal(A.revAcceleration(s), null);
  // ALK.TO, 30.10.: +452.4 points from 30.06.2026 against 30.06.2024 at #40 head.
  assert.equal(A.revAcceleration(ALK()), null);
  // The older pair blocks as well: 2026 against 2025 is fine, 2025 against 2023 is not.
  const older = row([180, 120, 100], ['2026-06-30', '2025-06-30', '2023-06-30']);
  assert.equal(A.revAcceleration(older), null);
});

check('Codex finding 2: a missing period end empties growth with a reason that names the known period', () => {
  const s = dated(null);
  assert.equal(A.revGrowthLevel(s), null);
  assert.equal(revGrowthLeg(s).pct, null);
  assert.equal(revGrowthLeg(s).basis, 'none');
  assert.equal(G.g31Shadow(s).v1.reason, 'Periodenende des Vorjahres fehlt (Zeitraum bis 30.06.2026); Wachstum nicht gezeigt.');
  // Not judged on the score axes: every sealed golden fixture is undated (see revAcceleration in axes.js); 0 such rows on 30.10.
  close(A.gpGrowth(s), 0.3);
  const metric = overviewMetric(s, { gpClass: 'degenerate' });
  assert.equal(metric.value, null); assert.equal(metric.valuePresent, false); assert.equal(metric.reason, G.g31Shadow(s).v1.reason);
  assert.equal(P.periodGateReason('year', null, END), 'Periodenende des neueren Werts fehlt (Vorjahr bis 30.06.2026); Wachstum nicht gezeigt.');
  assert.equal(P.periodGateReason('year', null, undefined), 'Periodenenden fehlen, der Zeitraum ist nicht belegt; Wachstum nicht gezeigt.');
  const noList = { meta: {}, timeseries: {}, annual: { annualRev: [130, 100, 90] } };
  assert.equal(A.revGrowthLevel(noList), null);
  close(A.revAcceleration(noList), 0.3 - 1 / 9);
  assert.equal(growth3({ annual: { annualRev: [133.1, null, null, 100] } }), null);
});

check('undated quarters by position: no growth, the dated year carries; the acceleration axis stays by position', () => {
  const q = { revenueQ: [120, 110, 105, 102, 100, 90] };
  const s = { meta: {}, timeseries: q, annual: { annualRev: [130, 100], annualRevEnds: [END, minus(END, 365)] } };
  assert.equal(G.quarterCandidate(s).pct, null);
  assert.match(G.quarterCandidate(s).reason, /^Periodenenden fehlen/);
  assert.equal(revGrowthLeg(s).basis, 'year');
  close(A.revAcceleration(s), 120 / 100 - 110 / 90);
  const dq = { ...q, revenueQEnds: ['2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30', '2025-03-31'] };
  close(A.revAcceleration({ meta: {}, timeseries: dq, annual: {} }), 120 / 100 - 110 / 90);
});

check('a stored 6M against a 3M quarter forms no acceleration pair, as it forms no growth pair', () => {
  const ends = ['2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30', '2025-03-31'];
  const s = { timeseries: { revenueQ: [120, 110, 105, 102, 100, 90], revenueQEnds: ends }, annual: {},
    meta: { statementPeriods: { revenueQ: ends.map((end, i) => ({ end, duration: i === 4 ? '6M' : '3M' })) } } };
  assert.equal(G.quarterDurations(s, 'revenueQ', 0, 4).reason, 'Die beiden Werte umfassen unterschiedlich lange Zeiträume.');
  assert.equal(G.quarterDurations(s, 'revenueQ', 1, 5).reason, null);
  assert.equal(A.revAcceleration(s), null, 'one pair left: no change rate');
});

check('Daifuku (6383.T), 30.10.: the real row is empty at 640 days, its quarter still carries; the 3.75-year CAGR is gone', () => {
  const s = DAIFUKU();
  assert.equal(G.g31Shadow(s).v1.reason, reason('31.12.2025', '31.03.2024', 640));
  assert.equal(A.revAcceleration(s), null);
  assert.equal(growth3(s), null, 'calendar years differ by 3, the period by 1371 days');
  const withQuarter = { ...s, timeseries: { revenueQ: [120, 110, 105, 102, 100], revenueQEnds: ['2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'] } };
  assert.equal(revGrowthLeg(withQuarter).basis, 'quarter');
});

check('Daifuku with its nine-month year stored (constructed): 365 days apart, still empty', () => {
  // Source: Daifuku's fiscal year to 31.12.2024 ran nine months from 01.04.2024. The vendor lacks that year; this row adds it.
  const s = row([4202009726.42, 3700000000, 3888813334.285, 3828046353.01], ['2025-12-31', '2024-12-31', '2024-03-31', '2023-03-31']);
  assert.equal(P.periodGateReason('year', '2025-12-31', '2024-12-31'), null, 'distance alone would pass');
  assert.equal(A.revGrowthLevel(s), null);
  assert.equal(G.g31Shadow(s).v1.reason, 'Das Vorjahr bis 31.12.2024 endet 275 Tage nach dem Abschluss 31.03.2024, ein volles Jahr ist nicht belegt; Wachstum nicht gezeigt.');
  assert.equal(A.revAcceleration(s), null);
});

check('NESTLEIND.BO, 30.10.: 365 days apart against a 15-month year labelled 12M is empty', () => {
  const s = NESTLE();
  s.meta.statementPeriods = { annualRev: s.annual.annualRevEnds.map(end => ({ end, duration: '12M' })) };
  assert.equal(A.revGrowthLevel(s), null, 'the stored label says 12M, the position in the series says otherwise');
  assert.match(G.g31Shadow(s).v1.reason, /^Das Vorjahr bis 31\.03\.2024 endet 91 Tage nach dem Abschluss 31\.12\.2023/);
});

check('a long prior gap empties the pair; a missing older year (700+ days) says nothing about the prior year', () => {
  const long = row([3204253713.6, 2539340002.9, 1714389383.1], ['2025-12-31', '2024-12-31', '2023-06-30']);
  assert.equal(A.revGrowthLevel(long), null, 'MNSO class: 550 days, the length of the prior year is not proven');
  const gap = row([180, 120, 100], ['2025-12-31', '2024-12-31', '2022-12-31']);
  close(A.revGrowthLevel(gap), 50);
  assert.equal(A.revAcceleration(gap), null, 'the older pair of the acceleration spans the gap');
});

check('a clean one-year pair keeps every value; the penalty and the 3-year CAGR too', () => {
  const s = CLEAN();
  close(A.revGrowthLevel(s), 50);
  close(A.revAcceleration(s), 0.5 - 0.2);
  assert.equal(G.g31Shadow(s).v1.reason, null);
  assert.equal(growth3(s), Math.round((Math.cbrt(180 / 80) - 1) * 10000) / 100);
});

check('capital efficiency: a blocked revenue pair drops the axis, no penalty of 0 rewards it (T2)', () => {
  const build = (ends) => ({ meta: {}, timeseries: {}, annual: { annualRev: [100, 90], annualRevEnds: ends, annualOpInc: [20, 18], annualOpIncEnds: ends,
    annualBalance: [{ totalAssets: 300, totalCurrentLiabilities: 50, currentLiabilities: 50 }, { totalAssets: 100, totalCurrentLiabilities: 50, currentLiabilities: 50 }], annualBalanceEnds: ends } });
  const ok = A.capitalEfficiency(build(['2025-12-31', '2024-12-31']));
  const blocked = A.capitalEfficiency(build(['2025-12-31', '2023-12-31']));
  assert.ok(Number.isFinite(ok));
  assert.equal(blocked, null);
});

check('52/53-week year at 371 days passes, the window edges 334/397 and 350/380 are inclusive', () => {
  close(A.revGrowthLevel(dated(371)), 30);
  assert.ok(Number.isFinite(A.gpGrowth(dated(371))));
  for (const [basis, lo, hi] of [['year', 334, 397], ['yearNewerRecord', 334, 397], ['quarter', 350, 380], ['halfYear', 350, 380], ['ttm', 350, 380]]) {
    for (const [days, open] of [[lo - 1, false], [lo, true], [hi, true], [hi + 1, false]]) {
      assert.equal(P.periodGateReason(basis, END, minus(END, days)) === null, open, `${basis} ${days}`);
    }
  }
  const q = { timeseries: { revenueQ: [120, 100], revenueQEnds: [END, minus(END, 371)] } };
  close(G.quarterCandidate(q).pct, 20);
  assert.throws(() => P.periodGateReason('decade', END, END), TypeError);
  assert.throws(() => P.periodGateReason('toString', END, END), TypeError);
});

check('newer-year record two years apart is empty, the stored years are not substituted', () => {
  const s = dated(365);
  s.meta.annualRevNewerYear = { end: '2026-08-31', priorEnd: '2024-08-31', revenue: 180, priorRevenue: 130, priorStored: 130 };
  const v1 = G.g31Shadow(s).v1;
  assert.equal(v1.pct, null);
  assert.equal(v1.reason, reason('31.08.2026', '31.08.2024', 730));
  assert.equal(A.revGrowthLevel(s), null);
});

check('newer-year record with a short prior year in the stored series is empty as well', () => {
  const s = row([130, 100], ['2025-06-30', '2025-01-31']);
  s.meta.annualRevNewerYear = { end: '2026-06-30', priorEnd: '2025-06-30', revenue: 180, priorRevenue: 130, priorStored: 130 };
  assert.match(G.g31Shadow(s).v1.reason, /^Das Vorjahr bis 30\.06\.2025 endet 150 Tage nach dem Abschluss 31\.01\.2025/);
});

check('a gated year leaves the valid year-over-year quarter as the newest valid candidate (G31)', () => {
  const s = dated(730);
  s.timeseries = { revenueQ: [120, 110, 105, 102, 100],
    revenueQEnds: ['2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30', '2025-03-31'] };
  const v1 = G.g31Shadow(s).v1;
  assert.equal(v1.basis, 'quarter');
  close(v1.pct, 20);
  assert.deepEqual(v1.bonusComponents.map(x => Math.round(x * 1e9) / 1e9), [0.2], 'the gated year leaves the growth bonus');
});

check('hand-table hold keeps precedence: a held cell gives its own reason, not the gate reason', () => {
  const s = dated(91);
  s.annual.annualRev[1] = { value: null, financialMissing: { caseId: 'probe', reason: 'held' } };
  const v1 = G.g31Shadow(s).v1;
  assert.equal(v1.pct, null);
  assert.equal(v1.reason, 'Kein gültiges Wertepaar mit positivem Vorjahreswert vorhanden.');
});

// Break-once: each gate line is disabled in a discarded in-memory copy; the real assertion must then fail.
for (const [rel, anchor, mutant, probe] of [
  ['../lib/annual-pairs.js', '  if (days < window[0] || days > window[1]) {', '  if (false) {',
    api => assert.equal(api.periodGateReason('quarter', END, minus(END, 91)), reason('30.06.2026', '31.03.2026', 91))],
  ['../lib/annual-pairs.js', "  if (older === null) return `Periodenende des Vorjahres fehlt (Zeitraum bis ${dayDe(end)}); Wachstum nicht gezeigt.`;", '  if (older === null) return null;',
    api => assert.equal(api.periodGateReason('year', END, null), 'Periodenende des Vorjahres fehlt (Zeitraum bis 30.06.2026); Wachstum nicht gezeigt.')],
  ['../lib/annual-pairs.js', "  if (code === 'adjacent') return null;", '  return null;',
    api => assert.match(api.periodGateReason('year', '2025-12-31', '2024-12-31', '2024-03-31'), /^Das Vorjahr bis 31\.12\.2024/)],
  ['../lib/g31-recency.js', '  if (gate) return missing(gate);', '',
    api => assert.equal(api.g31Shadow(dated(91)).v1.pct, null, '91-day pair must be empty')],
  ['../src/scoring/axes.js', "  if (!annualPairPasses(checkAnnualPair(s, 'annualGP', 0, 1))) return null;", '',
    api => assert.equal(api.gpGrowth(dated(730)), null, '730-day GP pair must drop the axis')],
  ['../src/scoring/axes.js', "    if (!annualPairPasses(checkAnnualPair(s, 'annualRev', 0, 1))) return null;", '',
    api => assert.equal(api.capitalEfficiency({ meta: {}, timeseries: {}, annual: { annualRev: [100, 90], annualRevEnds: ['2025-12-31', '2023-12-31'], annualOpInc: [20, 18], annualOpIncEnds: ['2025-12-31', '2023-12-31'],
      annualBalance: [{ totalAssets: 300, totalCurrentLiabilities: 50, currentLiabilities: 50 }, { totalAssets: 100, totalCurrentLiabilities: 50, currentLiabilities: 50 }], annualBalanceEnds: ['2025-12-31', '2023-12-31'] } }), null, 'a blocked pair must drop the axis')],
  ['../src/scoring/axes.js', '    if (!annualPairPasses(checkAnnualAcceleration(s))) return null;', '',
    api => assert.equal(api.revAcceleration(ALK()), null, 'blocked annual pair must drop the axis')],
  ['../src/scoring/axes.js', "    if (quarterDurations(s, 'revenueQ', i, v.idx).reason) continue; // Period gate (30.10.2026): unequal stored durations", '',
    api => { const ends = ['2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30', '2025-03-31'];
      assert.equal(api.revAcceleration({ annual: {}, timeseries: { revenueQ: [120, 110, 105, 102, 100, 90], revenueQEnds: ends },
        meta: { statementPeriods: { revenueQ: ends.map((end, i) => ({ end, duration: i === 4 ? '6M' : '3M' })) } } }), null, 'a 6M year-ago cell must not carry the axis'); }],
  ['../scripts/write-filter-universe.js', "  if (!ends[0] || !ends[3] || days < 3 * ANNUAL_PAIR_MIN_DAYS || days > 3 * ANNUAL_PAIR_MAX_DAYS) return null;", '',
    api => assert.equal(api.growth3(DAIFUKU()), null, 'a 3.75-year span is no 3-year CAGR')],
]) {
  check('break-once: ' + rel + ' without "' + anchor.trim().slice(0, 40) + '" turns the real assertion red', () => {
    const file = require.resolve(rel);
    const digest = () => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const before = digest(), source = fs.readFileSync(file, 'utf8');
    assert.equal(source.split(/\r?\n/).filter(line => line === anchor).length, 1, 'whole-line anchor occurs exactly once');
    const module = { exports: {} };
    vm.runInThisContext('(function(require,module,exports,__filename,__dirname){' + source.replace(/^#!.*/, '').replace(anchor, () => mutant) + '\n})',
      { filename: file + '.period-gate-mutant' })(createRequire(file), module, module.exports, file, path.dirname(file));
    assert.throws(() => probe(module.exports), error => {
      assert.equal(error.code, 'ERR_ASSERTION');
      console.log(`  BREAK-ONCE ERR_ASSERTION ${rel}: actual ${error.actual}, expected ${error.expected}`);
      return true;
    });
    probe(require(rel));
    assert.equal(digest(), before, 'live source unchanged; only the in-memory mutant was discarded');
  });
}

console.log(`period-gate.test.js: ${passed} ok, 0 fail`);
