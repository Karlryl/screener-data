'use strict';
// tests/exchange-quarter-check-wiring.test.js — standalone runner (exit 0/1). Tag 1403 (G2b) wiring:
// prepareSnapshot runs the exchange step at read time (committed mode fill-only), the pull never runs it
// (critique 2: a persisted fill or guard null would block the November reload), board history records it
// additively, the reason reaches financialReasons. Active mode is injected only into memory module copies.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { Module, createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const X = require('../lib/exchange-quarter-check.js');
const q4 = require('../lib/yahoo-q4-known-cases.js');
const { applyKnownCases } = q4;
const { applyFinancialCases, financialReasons } = require('../lib/financial-known-cases.js');
const { applyZeroGuard } = require('../lib/zero-financials-guard.js');
const { historyIsThinner } = require('../lib/reload-history.js');
const F = require('./fixtures/exchange-quarter-check.json');

const ROOT = path.resolve(__dirname, '..');
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex');
const LIVE = ['lib/yahoo-q4-known-cases.js', 'pull-yahoo.js', 'scripts/write-board-history.js', 'lib/exchange-quarter-check.js',
  'configs/exchange-quarter-policy.json', 'lib/stale-quarter-reload.js'];
const liveBefore = LIVE.map(sha);
const clone = x => structuredClone(x), serial = JSON.stringify;
let pass = 0, fail = 0, breaks = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.stack || e)); }
}
function moduleCopy(relative, transform, overrides = {}) {
  const file = path.join(ROOT, relative), m = new Module(file, module), real = createRequire(file);
  m.filename = file; m.paths = module.paths;
  m.require = id => Object.hasOwn(overrides, id) ? overrides[id] : real(id);
  m._compile(transform(fs.readFileSync(file, 'utf8')), file);
  return m.exports;
}
function replaceLine(source, oldLine, newLine) {
  const lines = source.split(/\r?\n/);
  assert.equal(lines.filter(l => l === oldLine).length, 1, 'Exact whole-line mutation anchor: ' + oldLine);
  return lines.map(l => l === oldLine ? newLine : l).join('\n');
}
const CTX = { stores: { cn: F.store.cn, tw: F.store.tw, warnings: [] },
  baseline: { date: F.baseline.date, rows: new Map(Object.entries(F.baseline.rows)), warnings: [] }, warnings: [] };
// The step with mode active and the fixture store: what G2c would switch on, in memory only.
const activeStep = { ...X, defaultContext: () => CTX,
  applyExchangeCheck: (s, o = {}) => X.applyExchangeCheck(s, { mode: o.mode ?? 'active', context: CTX }) };
const quiet = fn => { const w = console.warn, e = console.error; console.warn = console.error = () => {};
  try { return fn(); } finally { console.warn = w; console.error = e; } };
const q4Active = moduleCopy('lib/yahoo-q4-known-cases.js', s => s, { './exchange-quarter-check.js': activeStep });
const fillStep = { ...X, defaultContext: () => CTX,
  applyExchangeCheck: (s, o = {}) => X.applyExchangeCheck(s, { ...o, context: CTX }) };
const q4Fill = moduleCopy('lib/yahoo-q4-known-cases.js', s => s, { './exchange-quarter-check.js': fillStep });
const q4Off = moduleCopy('lib/yahoo-q4-known-cases.js', s => s, { './exchange-quarter-check.js': {
  ...fillStep, applyExchangeCheck: s => X.applyExchangeCheck(s, { mode: 'off' }) } });
const marked = s => serial(s).includes('"exchangeFill"') || /exchange-(pair|annual|quarter)-mismatch/.test(serial(s));
// P138: only the identity and fill-only tests exclude 000688.SZ, whose hand-table corrections change the raw snapshot.
const T = Object.keys(F.snapshots);
const noHandTable = T.filter(t => t !== '000688.SZ');

test('explicit mode off: prepareSnapshot equals the hand-table chain of origin/main for every fixture snapshot', () => {
  for (const t of noHandTable) {
    const s = clone(F.snapshots[t]);
    const chain = applyZeroGuard(applyFinancialCases(applyKnownCases(clone(s)).snapshot).snapshot).snapshot;
    const out = quiet(() => q4Off.prepareSnapshot(s));
    assert.equal(serial(out), serial(chain), t);
    assert.equal(out, s, t + ': identical object (no hand-table hit, step is a no-op)');
  }
});

test('prepareSnapshot calls the step: in an active copy the known wrong rows are withheld and fills are applied', () => {
  const w = quiet(() => q4Active.prepareSnapshot(clone(F.snapshots['000599.SZ'])));
  assert.ok(w.timeseries.revenueQ.some(c => c?.financialMissing?.reasonCode === 'exchange-pair-mismatch'));
  const f = quiet(() => q4Active.prepareSnapshot(clone(F.snapshots['000002.SZ'])));
  assert.ok(f.timeseries.revenueQ.some(c => c?.exchangeFill));
  assert.ok(financialReasons(f).some(r => /^Umsatz 3\. Quartal 2025 fehlte beim Datenanbieter/.test(r)), 'fill reason reaches financialDataReasons');
  assert.ok(financialReasons(w).includes(X.REASONS.level), 'guard reason reaches financialDataReasons');
  // Break-once: without the call line the copy is inert.
  const broken = moduleCopy('lib/yahoo-q4-known-cases.js', s => replaceLine(s,
    "    const exchange = applyExchangeCheck(zero.snapshot);",
    "    const exchange = { snapshot: zero.snapshot, mode: 'off' };"), { './exchange-quarter-check.js': activeStep });
  assert.throws(() => assert.ok(marked(quiet(() => broken.prepareSnapshot(clone(F.snapshots['000599.SZ'])))), 'step not called'), assert.AssertionError);
  breaks++;
});

test('pull: the step never runs at pull time, so no persisted snapshot carries a marker (even with mode active)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'pull-yahoo.js'), 'utf8');
  assert.equal(src.split('yahooQ4.prepareSnapshot(').length - 1, 1, 'one pull call site');
  assert.ok(src.includes('  const q4Checked = yahooQ4.prepareSnapshot(snap, { atPull: true });'));
  for (const t of T) assert.ok(!marked(quiet(() => q4Active.prepareSnapshot(clone(F.snapshots[t]), { atPull: true }))), t);
  const pull = moduleCopy('pull-yahoo.js', s => s, { './lib/yahoo-q4-known-cases.js': q4Active });
  for (const t of ['000599.SZ', '000002.SZ', '6446.TW', '600150.SS']) {
    const s = clone(F.snapshots[t]);
    quiet(() => pull._convertSnapshotToUSD(s));
    assert.ok(!marked(s), t + ': pull output has no marker');
    assert.equal(serial(s.timeseries), serial(F.snapshots[t].timeseries));
  }
  // Break-once: a pull that runs the read-time step would persist it.
  const brokenPull = moduleCopy('pull-yahoo.js', s => replaceLine(s, '  const q4Checked = yahooQ4.prepareSnapshot(snap, { atPull: true });',
    '  const q4Checked = yahooQ4.prepareSnapshot(snap);'), { './lib/yahoo-q4-known-cases.js': q4Active });
  const s = clone(F.snapshots['000002.SZ']);
  quiet(() => brokenPull._convertSnapshotToUSD(s));
  assert.throws(() => assert.ok(!marked(s)), assert.AssertionError); breaks++;
});

test('reload: historyIsThinner is unaffected; a persisted fill would have blocked the next reload (why the pull skips)', () => {
  const prior = clone(F.snapshots['000002.SZ']), next = clone(F.snapshots['000002.SZ']);
  quiet(() => moduleCopy('pull-yahoo.js', s => s, { './lib/yahoo-q4-known-cases.js': q4Active })._convertSnapshotToUSD(prior));
  assert.equal(historyIsThinner(next, prior), historyIsThinner(clone(F.snapshots['000002.SZ']), clone(F.snapshots['000002.SZ'])));
  assert.equal(historyIsThinner(next, prior), false);
  const persistedFill = X.applyExchangeCheck(clone(F.snapshots['000002.SZ']), { mode: 'active', context: CTX }).snapshot;
  assert.equal(historyIsThinner(next, persistedFill), true, 'critique 2 mechanism reproduced');
});

test('stale-quarter reload: latestReportedQuarter is the same with the step active (newest cell never touched, no fill at index 0)', () => {
  const real = require('../lib/stale-quarter-reload.js');
  const act = moduleCopy('lib/stale-quarter-reload.js', s => s, { './yahoo-q4-known-cases.js': q4Active });
  for (const t of T) assert.equal(quiet(() => act.latestReportedQuarter(clone(F.snapshots[t]))), real.latestReportedQuarter(clone(F.snapshots[t])), t);
});

test('board history: pit.revenueQExchange only with markers (active), with the original vendor values; absent in mode off', () => {
  const W = require('../scripts/write-board-history.js');
  for (const t of ['000599.SZ', '000002.SZ', '600150.SS']) {
    const off = W.buildPit(quiet(() => q4Off.prepareSnapshot(clone(F.snapshots[t]))), new Set(), t);
    assert.ok(!Object.hasOwn(off, 'revenueQExchange'), t);
    const on = W.buildPit(quiet(() => q4Active.prepareSnapshot(clone(F.snapshots[t]))), new Set(), t);
    const rec = on.revenueQExchange;
    assert.ok(rec && (rec.filled.length || rec.withheld.length), t);
    assert.deepEqual(Object.keys(on).slice(0, -1), Object.keys(off), t + ': additive at the end');
    for (const w of rec.withheld.filter(x => x.field === 'revenueQ')) {
      const i = F.snapshots[t].timeseries.revenueQEnds.indexOf(w.period);
      assert.equal(w.originalVendorValue, F.snapshots[t].timeseries.revenueQ[i].value);
      assert.equal(on.revenueQ[i], null);
    }
  }
});

test('store older than the limit: the rows stay unchecked and the process prints exactly one ::warning:: line (spec M3)', () => {
  const lines = [], e = console.error, w = console.warn;
  console.error = (...a) => lines.push(a.join(' ')); console.warn = () => {};
  const out = [];
  try {
    for (const t of ['000002.SZ', '000599.SZ']) {
      const s = clone(F.snapshots[t]); s.meta.fetchedAt = '2026-10-11T09:00:00.000Z'; // 9 days after the store
      out.push([serial(s), serial(q4Active.prepareSnapshot(s))]);
    }
  } finally { console.error = e; console.warn = w; }
  for (const [a, b] of out) assert.equal(b, a, 'unchecked: nothing applied');
  assert.equal(lines.filter(l => l.startsWith('::warning::[exchange-check]') && l.includes('store-old')).length, 1, lines.join('\n'));
});

function noOwnReadChild(tickers, source = fs.readFileSync(path.join(ROOT, 'lib/yahoo-q4-known-cases.js'), 'utf8')) {
  return spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
    const { Module, createRequire } = require('node:module');
    const X = require('./lib/exchange-quarter-check.js'), F = require('./tests/fixtures/exchange-quarter-check.json');
    const st = structuredClone(F.store);
    st.tw.sources.fresh = { fetchedAt: '2026-10-20T07:00:00.000Z', read: ['2548.TW 115Q2'] };
    for (const [ticker, code] of [['2885.TW', 'no-line'], ['1312A.TW', 'bad-id']]) {
      st.tw.companies[ticker] = { companyId: ticker.split('.')[0], seasons: {},
        noData: { '115Q2': { at: '2026-10-20T07:00:00.000Z', code } } };
    }
    const ctx = { stores: { ...st, warnings: [] }, baseline: { rows: new Map() }, warnings: [] };
    const file = path.resolve('lib/yahoo-q4-known-cases.js'), m = new Module(file), real = createRequire(file);
    m.filename = file; m.paths = module.paths;
    m.require = id => id === './exchange-quarter-check.js' ? { ...X, defaultContext: () => ctx,
      applyExchangeCheck: s => X.applyExchangeCheck(s, { context: ctx }) } : real(id);
    m._compile(fs.readFileSync(0, 'utf8'), file);
    for (const ticker of ${JSON.stringify(tickers)}) {
      const s = structuredClone(F.snapshots['6446.TW']);
      Object.assign(s.meta, { ticker, fetchedAt: '2026-10-20T09:00:00.000Z',
        industry: ticker === '2885.TW' ? 'Financial Conglomerates' : 'Chemicals' });
      const before = JSON.stringify(s);
      assert.equal(m.exports.prepareSnapshot(s), s);
      assert.equal(JSON.stringify(s), before);
    }
  `], { cwd: ROOT, encoding: 'utf8', input: source, timeout: 30000 });
}

test('no-own-read wiring: two never-read rows and one old own read have separate exit counters and one warning', () => {
  const child = noOwnReadChild(['2885.TW', '1312A.TW', '6446.TW']);
  assert.equal(child.status, 0, child.stderr);
  const lines = child.stderr.trim().split(/\r?\n/), warnings = lines.filter(l => l.startsWith('::warning::'));
  const summary = lines.filter(l => l.startsWith('[exchange-check-summary] '));
  assert.equal(summary.length, 1, child.stderr);
  assert.deepEqual(JSON.parse(summary[0].slice('[exchange-check-summary] '.length)),
    { 'unchecked(no-own-read)': 2, 'unchecked(store-old)': 1 });
  assert.equal(warnings.length, 1, child.stderr); assert.match(warnings[0], /store-old/);
  assert.ok(!warnings.some(l => l.includes('no-own-read')), child.stderr);
});

test('no-own-read only: two unchecked rows print one summary and no warnings; break-once red', () => {
  const tickers = ['2885.TW', '1312A.TW'];
  const check = child => {
    assert.equal(child.status, 0, child.stderr);
    const lines = child.stderr.trim().split(/\r?\n/);
    const summary = lines.filter(line => line.startsWith('[exchange-check-summary] '));
    assert.equal(summary.length, 1, child.stderr);
    assert.deepEqual(JSON.parse(summary[0].slice('[exchange-check-summary] '.length)),
      { 'unchecked(no-own-read)': 2 });
    assert.equal(lines.filter(line => line.startsWith('::warning::')).length, 0,
      'no-own-read rows must not warn\n' + child.stderr);
  };
  check(noOwnReadChild(tickers));
  const file = 'lib/yahoo-q4-known-cases.js', before = sha(file);
  const broken = replaceLine(fs.readFileSync(path.join(ROOT, file), 'utf8'),
    "  if (result.why === 'store-old' && !exchangeStoreOldWarned) {",
    "  if ((result.why === 'store-old' || result.why === 'no-own-read') && !exchangeStoreOldWarned) {");
  let red;
  try {
    assert.throws(() => check(noOwnReadChild(tickers, broken)), error => {
      red = error;
      return error instanceof assert.AssertionError && error.actual === 1 && error.expected === 0
        && error.message.startsWith('no-own-read rows must not warn');
    });
  } finally {
    assert.equal(sha(file), before, 'live source changed during no-own-read break-once');
  }
  breaks++;
  console.log('  BREAK_ONCE no-own-read ' + red.name + ': ' + red.message);
  check(noOwnReadChild(tickers));
});

test('committed fill-only is wired through prepareSnapshot but never through the pull; break-once red', () => {
  assert.equal(X.policy.mode, 'fill-only');
  const check = reader => {
    for (const t of noHandTable) {
      const original = clone(F.snapshots[t]), before = serial(original);
      const expected = X.applyExchangeCheck(clone(original), { mode: 'fill-only', context: CTX }).snapshot;
      const read = quiet(() => reader.prepareSnapshot(original));
      assert.equal(serial(read), serial(expected), t);
      assert.equal(serial(original), before, t + ': read-time only');
      assert.equal(serial(quiet(() => reader.prepareSnapshot(clone(original), { atPull: true }))), before, t + ': pull has no fill');
    }
  };
  check(q4Fill);
  const inert = moduleCopy('lib/yahoo-q4-known-cases.js', s => replaceLine(s,
    '    const exchange = applyExchangeCheck(zero.snapshot);', "    const exchange = { snapshot: zero.snapshot, mode: 'off' };"),
    { './exchange-quarter-check.js': fillStep });
  assert.throws(() => check(inert), assert.AssertionError); breaks++;
  const persists = moduleCopy('lib/yahoo-q4-known-cases.js', s => replaceLine(s,
    '    if (options.atPull) return zero.snapshot;', ''), { './exchange-quarter-check.js': fillStep });
  assert.throws(() => check(persists), assert.AssertionError); breaks++;
  const pull = moduleCopy('pull-yahoo.js', s => s, { './lib/yahoo-q4-known-cases.js': q4Fill });
  const checkPull = lib => {
    for (const t of noHandTable) {
      const s = clone(F.snapshots[t]); quiet(() => lib._convertSnapshotToUSD(s));
      assert.ok(!marked(s), t);
      assert.equal(serial(s.timeseries), serial(F.snapshots[t].timeseries), t);
    }
  };
  checkPull(pull);
  const brokenPull = moduleCopy('pull-yahoo.js', s => replaceLine(s,
    '  const q4Checked = yahooQ4.prepareSnapshot(snap, { atPull: true });', '  const q4Checked = yahooQ4.prepareSnapshot(snap);'),
    { './lib/yahoo-q4-known-cases.js': q4Fill });
  assert.throws(() => checkPull(brokenPull), assert.AssertionError); breaks++;
  check(q4Fill); checkPull(pull);
});

test('live files unchanged by this test run', () => assert.deepEqual(LIVE.map(sha), liveBefore));

console.log(`exchange-quarter-check-wiring: ${pass} passed, ${fail} failed, ${breaks} break-once red`);
process.exit(fail ? 1 : 0);
