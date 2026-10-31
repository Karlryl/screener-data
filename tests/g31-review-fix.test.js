'use strict';
// Exact source snapshots from run 41027769596. Mutations exist only in memory.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Module, createRequire } = require('node:module');
const G = require('../lib/g31-recency.js');
const X = require('../lib/exchange-quarter-check.js');
const H = require('../lib/financial-known-cases.js');
const { prepareSnapshot } = require('../lib/yahoo-q4-known-cases.js');
const F = require('./fixtures/g31-review-fix.json');
const C = require('./fixtures/g31-older-quarter-pair.json');
const root = path.resolve(__dirname, '..');
const files = ['lib/g31-recency.js', 'configs/financial-known-cases.json'];
const hash = f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex');
const hashes = files.map(hash);
const snap = t => structuredClone(F.snapshots[t] || C.snapshots[t]);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const withStore = (cn, fn) => {
  const keep = X.defaultContext;
  X.defaultContext = () => ({ stores: { cn, tw: null }, baseline: { rows: new Map(), date: null }, warnings: [] });
  try { return fn(); } finally { X.defaultContext = keep; }
};
function mutant(anchor, replacement) {
  const file = path.join(root, files[0]), lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  assert.equal(lines.filter(l => l === anchor).length, 1, 'unique whole-line anchor');
  const m = new Module(file, module);
  m.filename = file; m.paths = module.paths; m.require = createRequire(file);
  m._compile(lines.map(l => l === anchor ? replacement : l).join('\n'), file);
  return m.exports;
}
const proofLine = "    if (!['agree', 'would-fill'].includes(res?.category) || !res.pairs?.some(p => p.status === 'agree' && p.end === q.sourcePeriodEnd && p.priorEnd === q.sourcePriorPeriodEnd)) return true;";

test('Pepco: hold only the 30 September 2024 revenue cell that includes Poundland; retain the annual rate', () => {
  const raw = snap('PCO.WA'), saved = JSON.stringify(raw), at = raw.timeseries.revenueQEnds.indexOf('2024-09-30');
  const c = H.table.cases.find(c => c.caseId === 'pco.wa-2024-09-30-revenueQ');
  assert.deepEqual([c.expectedBadValue, c.replacementValue, c.currency], [1486000000, null, 'EUR']);
  assert.deepEqual([c.revision, c.verifiedAt], ['2026-10-30-pr49', '2026-10-30']);
  const s = prepareSnapshot(raw);
  assert.equal(s.timeseries.revenueQ[at].value, null);
  assert.match(s.timeseries.revenueQ[at].financialCorrection.reason, /Poundland/);
  for (let i = 0; i < raw.timeseries.revenueQ.length; i++) {
    if (i !== at) assert.deepEqual(s.timeseries.revenueQ[i], raw.timeseries.revenueQ[i]);
  }
  assert.equal(JSON.stringify(raw), saved);
  const leg = G.g31Shadow(s).v1;
  assert.deepEqual([leg.basis, leg.periodEnd], ['year', '2025-09-30']);
  close(leg.pct, 8.726218724281342);
  assert.deepEqual(prepareSnapshot(s), s, 'hold is idempotent');
  // Removing this one authority row must make this exact regression fail again.
  const table = structuredClone(H.table);
  table.cases = table.cases.filter(x => x.caseId !== c.caseId);
  const unheld = H.applyFinancialCases(raw, { table }).snapshot;
  const broken = G.g31Shadow(unheld).v1;
  close(broken.pct, -26.51413189771198);
  assert.throws(() => assert.equal(broken.basis, 'year'), assert.AssertionError);
});

for (const state of ['no-store-entry', 'no-own-read', 'no-checkable-pair']) {
  test(`000595.SZ: ${state} cannot authorize its older pair, even with no annual growth`, () => {
    const store = structuredClone(C.store.cn), s = snap('000595.SZ');
    if (state === 'no-store-entry') delete store.companies['000595.SZ'];
    if (state === 'no-own-read') store.companies['000595.SZ'] = { ytd: {}, noData: {} };
    if (state === 'no-checkable-pair') delete store.companies['000595.SZ'].ytd['2025-06-30'];
    withStore(store, () => {
      assert.equal(X.evaluate(X.stripOwn(s), X.defaultContext()).why, state);
      const leg = G.g31Shadow(s).v1;
      assert.equal(leg.basis, 'year'); close(leg.pct, 5.976444598488317);
      const broken = mutant(proofLine, '').g31Shadow(s).v1;
      assert.throws(() => assert.equal(broken.basis, 'year'), assert.AssertionError);
      close(broken.pct, 187.07453425011892);
      s.annual.annualRev[1] = null;
      assert.equal(G.g31Shadow(s).v1.pct, null);
      assert.match(G.g31Shadow(s).v1.reason, /beiden Perioden.*Börsenabgleich/);
    });
  });
}

test('an exactly checked real pair is admitted; company-wide agreement on another pair is insufficient in CN and TW', () => {
  const s = snap('002448.SZ');
  withStore(C.store.cn, () => {
    const verdict = X.evaluate(X.stripOwn(s), X.defaultContext());
    assert.ok(verdict.pairs.some(p => p.status === 'agree' && p.end === '2026-06-30' && p.priorEnd === '2025-06-30'));
    close(G.g31Shadow(s).v1.pct, 28.53102510166723);
    const evaluate = X.evaluate;
    try {
      for (const ticker of ['002448.SZ', 'PAIR.TW', 'PAIR.TWO']) {
        s.meta.ticker = ticker;
        X.evaluate = () => structuredClone(verdict);
        assert.equal(G.g31Shadow(s).v1.basis, 'quarter');
        X.evaluate = () => ({ ...structuredClone(verdict), category: 'agree', withhold: [], pairs: [{ status: 'agree', end: '2026-03-31', priorEnd: '2025-03-31' }] });
        assert.equal(G.g31Shadow(s).v1.basis, 'year');
        for (const category of ['unchecked', 'unknown', 'would-withhold-growth']) {
          X.evaluate = () => ({ ...structuredClone(verdict), category, withhold: [] });
          assert.equal(G.g31Shadow(s).v1.basis, 'year');
        }
      }
    } finally { X.evaluate = evaluate; }
  });
});

test('unchanged ODC cannot use April 2026 before its known July 2026 fiscal year end', () => {
  const s = prepareSnapshot(snap('ODC'));
  assert.equal(s.annual.annualRevEnds[0], '2026-07-31');
  const leg = G.g31Shadow(s).v1;
  assert.equal(leg.pct, null);
  assert.match(leg.reason, /neuesten bekannten Geschäftsjahresende/);
  assert.deepEqual(leg.bonusComponents, []);
  const broken = mutant("    if (q.sourcePeriodEnd < latestAnnualEnd) return blocked('Das ältere Quartalspaar endet vor dem neuesten bekannten Geschäftsjahresende.');", '').g31Shadow(s).v1;
  close(broken.pct, 9.37481060770038);
  assert.throws(() => assert.equal(broken.pct, null), assert.AssertionError);
});

test('A17U.SI: invalid annual operands retain the date bound; missing annual dates retain the missing-recency reason', () => {
  const original = prepareSnapshot(snap('A17U.SI'));
  assert.equal(G.g31Shadow(original).v1.basis, 'year');
  for (const prior of [null, { value: 0 }, { value: -1 }]) {
    const s = structuredClone(original); s.annual.annualRev[1] = prior;
    assert.equal(G.g31Shadow(s).v1.pct, null);
    assert.match(G.g31Shadow(s).v1.reason, /neuesten bekannten Geschäftsjahresende/);
  }
  const undated = structuredClone(original); delete undated.annual.annualRevEnds;
  const leg = G.g31Shadow(undated).v1;
  assert.equal(leg.basis, 'year'); assert.equal(leg.periodEnd, null);
  assert.match(leg.reason, /Aktualität ist nicht belegbar/);
  const broken = mutant("  if (!latestAnnualEnd) return blocked('Das neueste Jahresende fehlt; die Aktualität eines älteren Quartalspaars ist nicht belegbar.');", '').g31Shadow(undated).v1;
  assert.equal(broken.periodEnd, '2019-09-30');
  assert.throws(() => assert.equal(broken.basis, 'year'), assert.AssertionError);
});

test('all break-once mutations leave the production code and hand table byte-identical', () => {
  assert.deepEqual(files.map(hash), hashes);
});
