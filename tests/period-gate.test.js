'use strict';
// Period gate (Daylauf 7, 24.10.2026, formula draft): growth only from pairs whose period ends are one year apart.
// Annual pairs 334..397 days, quarter/half-year pairs 350..380 days; otherwise null with a German reason that names
// both ends. Covers the score path (revGrowthLevel, gpGrowth, growth bonus) and the shown value (revGrowthLeg,
// g31Shadow v1, overview revenue badge). Run: node tests/period-gate.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const P = require('../lib/annual-pairs.js');
const G = require('../lib/g31-recency.js');
const A = require('../src/scoring/axes.js');
const { revGrowthLeg } = require('../lib/rev-growth-basis.js');
const { overviewMetric } = require('../src/scoring/overview.js');

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

check('missing period end: not judged, the existing "Periodenenden fehlen" reason stays', () => {
  const s = dated(null);
  close(A.revGrowthLevel(s), 30);
  assert.equal(G.g31Shadow(s).v1.reason, 'Periodenenden fehlen; die Aktualität ist nicht belegbar.');
  assert.ok(Number.isFinite(A.gpGrowth(s)));
  assert.equal(P.periodGateReason('year', END, null), null);
});

check('newer-year record two years apart is empty, the stored years are not substituted', () => {
  const s = dated(365);
  s.meta.annualRevNewerYear = { end: '2026-08-31', priorEnd: '2024-08-31', revenue: 180, priorRevenue: 130, priorStored: 130 };
  const v1 = G.g31Shadow(s).v1;
  assert.equal(v1.pct, null);
  assert.equal(v1.reason, reason('31.08.2026', '31.08.2024', 730));
  assert.equal(A.revGrowthLevel(s), null);
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
  ['../lib/annual-pairs.js', '  if (days >= window[0] && days <= window[1]) return null;', '  return null;',
    api => assert.equal(api.periodGateReason('year', END, minus(END, 91)), reason('30.06.2026', '31.03.2026', 91))],
  ['../lib/g31-recency.js', '  if (gate) return missing(gate);', '',
    api => assert.equal(api.g31Shadow(dated(91)).v1.pct, null, '91-day pair must be empty')],
  ['../src/scoring/axes.js', "  if (periodGateReason('year', ...annualPeriodEnds(s, 'annualGP').slice(0, 2))) return null;", '',
    api => assert.equal(api.gpGrowth(dated(730)), null, '730-day GP pair must drop the axis')],
]) {
  check('break-once: ' + rel + ' without its gate line turns the real assertion red', () => {
    const file = require.resolve(rel);
    const digest = () => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const before = digest(), source = fs.readFileSync(file, 'utf8');
    assert.equal(source.split(/\r?\n/).filter(line => line === anchor).length, 1, 'whole-line anchor occurs exactly once');
    const module = { exports: {} };
    vm.runInThisContext('(function(require,module,exports){' + source.replace(anchor, mutant) + '\n})',
      { filename: file + '.period-gate-mutant' })(createRequire(file), module, module.exports);
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
