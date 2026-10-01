'use strict';

// Break-once targets memory-only modules/tables. Never target a writing test or live artifact.
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { Module, createRequire } = require('module');
const { applyFinancialCases, financialReasons, validateTable, table, MISSING_REASONS } = require('../lib/financial-known-cases.js');
const { applyZeroGuard, modeForReplay, policy, validatePolicy } = require('../lib/zero-financials-guard.js');
const { norm } = require('../src/scoring/snapshot.js');
const fixture = require('./fixtures/financial-known-cases.json').snapshots;
const clone = x => structuredClone(x), serial = JSON.stringify;
const value = row => typeof row === 'number' ? row : row?.value;
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const liveFiles = ['configs/financial-known-cases.json','configs/zero-financials-policy.json','lib/financial-known-cases.js',
  'lib/zero-financials-guard.js','lib/reload-history.js','lib/yahoo-q4-known-cases.js','src/scoring/score.js'];
const hashes = liveFiles.map(f => [f, sha(path.join(__dirname, '..', f))]);
let passed = 0, breaks = 0;
function test(name, fn) { fn(); passed++; console.log('ok ' + name); }
function moduleCopy(relative, transform, overrides = {}) {
  const file = path.resolve(__dirname, '..', relative), m = new Module(file, module), realRequire = createRequire(file);
  m.filename = file; m.paths = module.paths;
  m.require = id => Object.hasOwn(overrides, id) ? overrides[id] : realRequire(id);
  m._compile(transform(fs.readFileSync(file, 'utf8')), file);
  return m.exports;
}
function replaceLine(source, oldLine, newLine) {
  const lines = source.split(/\r?\n/);
  assert.equal(lines.filter(l => l === oldLine).length, 1, 'Exact whole-line mutation anchor');
  return lines.map(l => l === oldLine ? newLine : l).join('\n');
}

test('all 97 authorized cells and one mixed-issuer packet have auditable sources', () => {
  assert.equal(table.cases.length, 97); assert.equal(table.quarantines.length, 1);
  assert.throws(() => validateTable({}), /Invalid/);
  const duplicate = clone(table); duplicate.cases.push(duplicate.cases[0]); assert.throws(() => validateTable(duplicate), /duplicate/);
  const undocumented = clone(table); undocumented.cases[0].sources[0].quote = ''; assert.throws(() => validateTable(undocumented), /Invalid/);
});

// M1: a basis-wrong series (any non-null replacement) needs exactly one coverage entry.
test('coverage is mandatory for basis-wrong series, unique, and absent for single false values', () => {
  const need = new Set(table.cases.filter(c => c.replacementValue !== null && !c.singleFalseValue).map(c => c.ticker + '|' + c.field));
  assert.deepEqual([...need].sort(), ['ARCC', 'BANPU.BK', 'BBDC', 'BXSL', 'CSWC', 'FSK', 'GBDC', 'HTGC', 'KBDC', 'MAIN', 'MSDL',
    'OBDC', 'OTF', 'PSEC', 'TRIN', 'TSLX'].map(t => t + '|revenueQ'));
  assert.deepEqual(table.coverage.map(v => v.ticker + '|' + v.field).sort(), [...need].sort());
  const noHtgc = clone(table); noHtgc.coverage = noHtgc.coverage.filter(v => v.ticker !== 'HTGC');
  assert.throws(() => validateTable(noHtgc), /Missing financial coverage: HTGC\|revenueQ/);
  const noKey = clone(table); delete noKey.coverage; assert.throws(() => validateTable(noKey), /Invalid financial hand table/);
  const notArray = clone(table); notArray.coverage = {}; assert.throws(() => validateTable(notArray), /Invalid financial hand table/);
  const dupCoverage = clone(table); dupCoverage.coverage.push(clone(dupCoverage.coverage[0]));
  assert.throws(() => validateTable(dupCoverage), /Invalid financial coverage \(bad or duplicate\): HTGC/);
  const dupId = clone(table); dupId.cases[1].caseId = dupId.cases[0].caseId; assert.throws(() => validateTable(dupId), /duplicate/);
  // Absence: false-zero series (null replacement) validate without coverage; the real table passes.
  assert.equal(validateTable(clone(table)).cases.length, 97);
  // Break-once in memory: without the coverage requirement the HTGC gap validates silently.
  const broken = moduleCopy('lib/financial-known-cases.js', s => replaceLine(s,
    "  for (const key of basisWrong) if (!covered.has(key)) throw new Error('Missing financial coverage: ' + key);", ''));
  assert.throws(() => assert.throws(() => broken.validateTable(noHtgc), /Missing/), assert.AssertionError); breaks++;
});
for (const c of table.cases) test(c.caseId + ' real cached input, absence, idempotency', () => {
  const input = clone(fixture[c.ticker]), original = serial(input);
  const i = input.timeseries[c.field + 'Ends'].indexOf(c.period);
  const factor = input.meta.fxRateApplied;
  assert.equal(value(input.timeseries[c.field][i]), c.expectedBadValue * factor);
  const result = applyFinancialCases(input).snapshot;
  assert.equal(norm(result, c.field)[i], c.replacementValue === null ? null : c.replacementValue * factor);
  assert.equal(serial(input), original);
  assert.equal(serial(applyFinancialCases(result).snapshot), serial(result));
  assert.ok(financialReasons(result).includes(c.reason));
  const other = clone(input); other.meta.ticker = 'UNLISTED';
  assert.equal(applyFinancialCases(other).snapshot, other);
  // Every authority entry is broken once independently, not just the first row.
  const broken = clone(table); broken.cases = broken.cases.filter(x => x.caseId !== c.caseId);
  // Coverage is mandatory (M1); keep it valid for the remaining cases. The dropped period then
  // arrives raw (false zeros) or withheld (basis-wrong series), never as the verified replacement.
  broken.coverage = broken.coverage.map(v => v.ticker !== c.ticker ? v : { ...v, coversThrough:
    broken.cases.filter(x => x.ticker === v.ticker && x.field === v.field).map(x => x.period).sort().at(-1) });
  const guard = config => assert.equal(norm(applyFinancialCases(input, { table: config }).snapshot, c.field)[i],
    c.replacementValue === null ? null : c.replacementValue * factor);
  assert.throws(() => guard(broken), assert.AssertionError); guard(table); breaks++;
});

test('stale values, wrong units/currency/source and duplicate dates become missing with a reason code', () => {
  for (const [code, change] of [
    ['vendor-value-changed', s => { s.timeseries.revenueQ[0].value++; }],
    ['context-changed', s => { s.timeseries.revenueQ[0].currency = 'EUR'; }],
    ['context-changed', s => { s.timeseries.revenueQ[0].multiplier = 1000; }],
    ['context-changed', s => { s.timeseries.revenueQ[0].periodType = '12M'; }],
    ['context-changed', s => { s.timeseries.revenueQ[0].source = 'SEC'; }],
    ['context-changed', s => { s.meta.reportingCurrencyOriginal = 'EUR'; }],
    ['context-changed', s => { s.timeseries.revenueQEnds[1] = s.timeseries.revenueQEnds[0]; }],
  ]) {
    const input = clone(fixture.HTGC); change(input);
    const original = serial(input);
    const r = applyFinancialCases(input);
    const row = r.snapshot.timeseries.revenueQ[0];
    assert.equal(value(row), null, 'Stale vendor value is withheld, never kept or zeroed');
    assert.equal(row.financialMissing.reasonCode, code);
    assert.equal(row.financialMissing.reason, MISSING_REASONS[code]);
    assert.ok(financialReasons(r.snapshot).includes(MISSING_REASONS[code]));
    assert.ok(r.events.some(e => e.status === 'stale' && e.reasonCode === code && e.index === 0));
    assert.equal(serial(input), original, 'Input is not mutated');
    const again = applyFinancialCases(r.snapshot);
    assert.equal(serial(again.snapshot), serial(r.snapshot), 'Idempotent');
    assert.ok(again.events.some(e => e.status === 'stale' && e.index === 0), 'Still counted on a later pass');
  }
  // Absence: an unchanged HTGC packet has no stale event at all.
  assert.ok(!applyFinancialCases(clone(fixture.HTGC)).events.some(e => e.status === 'stale'));
});

// HIGH-1: a vendor quarter newer than the last primary-source-verified period must not pass silently.
const nextQuarter = (s, v = 60e6) => {
  const ts = s.timeseries;
  ts.revenueQ = [{ value: v }, ...ts.revenueQ].slice(0, ts.revenueQ.length);
  ts.revenueQEnds = ['2026-09-30', ...ts.revenueQEnds].slice(0, ts.revenueQEnds.length);
  return s;
};
test('coversThrough: newer vendor quarter is missing and stale; covered quarters corrected; unrelated ticker untouched', () => {
  assert.deepEqual(table.coverage.map(v => v.ticker).sort(), ['ARCC', 'BANPU.BK', 'BBDC', 'BXSL', 'CSWC', 'FSK', 'GBDC', 'HTGC',
    'KBDC', 'MAIN', 'MSDL', 'OBDC', 'OTF', 'PSEC', 'TRIN', 'TSLX']);
  for (const ticker of table.coverage.map(v => v.ticker).filter(t => t !== 'BANPU.BK')) {
    const input = nextQuarter(clone(fixture[ticker])), original = serial(input);
    const r = applyFinancialCases(input);
    const row = r.snapshot.timeseries.revenueQ[0];
    assert.equal(value(row), null);
    assert.equal(row.financialMissing.reasonCode, 'period-after-coverage');
    assert.equal(row.financialMissing.originalVendorRow.value, 60e6);
    assert.ok(financialReasons(r.snapshot).includes(MISSING_REASONS['period-after-coverage']));
    assert.equal(r.events.filter(e => e.status === 'stale').length, 1);
    assert.equal(r.events.find(e => e.status === 'stale').period, '2026-09-30');
    // Covered periods are still corrected.
    for (const c of table.cases.filter(c => c.ticker === ticker)) {
      const i = r.snapshot.timeseries.revenueQEnds.indexOf(c.period);
      if (i >= 0) assert.equal(value(r.snapshot.timeseries.revenueQ[i]), c.replacementValue * input.meta.fxRateApplied);
    }
    assert.equal(serial(input), original);
    assert.equal(serial(applyFinancialCases(r.snapshot).snapshot), serial(r.snapshot));
    // Derived growth sees "missing": the quarterly leg drops, no fallback 0 enters the ratio.
    const axes = require('../src/scoring/axes.js');
    assert.equal(axes.revQuartalsYoY(r.snapshot), null);
    const g = axes.revGrowthLevel(r.snapshot);
    assert.ok(g === null || Math.abs(g / 100 - axes.revAnnualYoY(r.snapshot)) < 1e-12, 'Only the annual leg may carry growth');
  }
  // Unrelated ticker with the same new quarter: byte-identical, no event.
  const other = nextQuarter(clone(fixture.HTGC)); other.meta.ticker = 'UNLISTED';
  const u = applyFinancialCases(other);
  assert.equal(u.snapshot, other); assert.equal(u.events.length, 0);
  // Covered history without a new quarter: no stale event (presence and absence).
  assert.ok(!applyFinancialCases(clone(fixture.ARCC)).events.some(e => e.status === 'stale'));
  // coversThrough must equal the last verified period.
  const bad = clone(table); bad.coverage[0].coversThrough = '2026-09-30';
  assert.throws(() => validateTable(bad), /Invalid financial coverage/);
  // Break-once in memory: without the coverage guard the new quarter passes as raw vendor data.
  const broken = moduleCopy('lib/financial-known-cases.js', s => replaceLine(s,
    '  const fields = new Set([...config.coverage, ...config.cases].filter(x => listed(x, ticker)).map(x => x.field));',
    '  const fields = new Set();'));
  const guard = fn => assert.equal(value(fn(nextQuarter(clone(fixture.HTGC))).snapshot.timeseries.revenueQ[0]), null);
  assert.throws(() => guard(broken.applyFinancialCases), assert.AssertionError); guard(applyFinancialCases); breaks++;
});

// L1: a value without a usable period end never passes raw in a series with hand-table authority.
test('missing or short *Ends array and undated entries are withheld as period-not-verified', () => {
  const check = (ticker, field, change, indexes, code = 'period-not-verified') => {
    const input = clone(fixture[ticker]); change(input.timeseries);
    const original = serial(input), r = applyFinancialCases(input);
    for (const i of indexes) {
      const row = r.snapshot.timeseries[field][i];
      assert.equal(value(row), null, ticker + ' index ' + i);
      assert.equal(row.financialMissing.reasonCode, code);
      assert.ok(r.events.some(e => e.status === 'stale' && e.reasonCode === code && e.index === i));
    }
    assert.equal(serial(input), original);
    assert.equal(serial(applyFinancialCases(r.snapshot).snapshot), serial(r.snapshot), 'Idempotent');
    return r;
  };
  const n = fixture.HTGC.timeseries.revenueQ.length;
  // Covered series: whole Ends array gone, and one value row beyond a shortened Ends array.
  check('HTGC', 'revenueQ', ts => { delete ts.revenueQEnds; }, [...Array(n).keys()]);
  const short = check('HTGC', 'revenueQ', ts => { ts.revenueQEnds = ts.revenueQEnds.slice(0, n - 1); }, [n - 1]);
  assert.equal(value(short.snapshot.timeseries.revenueQ[0]), 149114000, 'Dated verified rows still corrected');
  // Case-only false-zero series: the known-wrong 0 without dates must not pass raw.
  const g = fixture['YSN.DE'].timeseries.grossProfitQ.length;
  // Single false-value series: own text, never the basis-wrong wording (R5).
  const ysn = check('YSN.DE', 'grossProfitQ', ts => { delete ts.grossProfitQEnds; }, [...Array(g).keys()].filter(i =>
    value(fixture['YSN.DE'].timeseries.grossProfitQ[i]) != null), 'period-undated');
  assert.deepEqual(financialReasons(ysn.snapshot), [MISSING_REASONS['period-undated']]);
  assert.ok(!financialReasons(ysn.snapshot).some(t => t.includes('falsche Basis')));
  // Absence: intact YSN.DE and an unrelated ticker without Ends are untouched.
  assert.ok(!applyFinancialCases(clone(fixture['YSN.DE'])).events.some(e => e.status === 'stale'));
  const other = clone(fixture.HTGC); other.meta.ticker = 'UNLISTED'; delete other.timeseries.revenueQEnds;
  assert.equal(applyFinancialCases(other).snapshot, other);
  // Break-once in memory: the old guard skipped a series whose Ends array is missing.
  const broken = moduleCopy('lib/financial-known-cases.js', s => replaceLine(s,
    '      const p = Array.isArray(ends) ? ends[i] : undefined;', '      if (!Array.isArray(ends)) return; const p = ends[i];'));
  const guard = fn => { const s = clone(fixture.HTGC); delete s.timeseries.revenueQEnds;
    assert.equal(value(fn(s).snapshot.timeseries.revenueQ[0]), null); };
  assert.throws(() => guard(broken.applyFinancialCases), assert.AssertionError); guard(applyFinancialCases); breaks++;
});

test('stale count raises a ::warning:: summary line; clean run has none', () => {
  // The summary is emitted on process exit, so it is observed in a child process (no files written).
  const summary = snap => {
    const r = require('child_process').spawnSync(process.execPath, ['-e',
      "require('./lib/yahoo-q4-known-cases.js').prepareSnapshot(JSON.parse(require('fs').readFileSync(0,'utf8')))"],
      { cwd: path.join(__dirname, '..'), input: serial(snap), encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stderr.split(/\r?\n/).find(l => l.includes('[financial-hand-table-summary]'));
  };
  assert.ok(summary(nextQuarter(clone(fixture.HTGC))).startsWith('::warning::[financial-hand-table-summary]'));
  assert.ok(summary(clone(fixture.HTGC)).startsWith('[financial-hand-table-summary]'));
  // M2: a drifted quarantine fingerprint also raises the warning.
  const drift = clone(fixture['BANPU.BK']); drift.meta.sharesOutstanding *= 1.001;
  assert.ok(summary(drift).startsWith('::warning::[financial-hand-table-summary]'));
  assert.ok(summary(clone(fixture['BANPU.BK'])).startsWith('[financial-hand-table-summary]'));
});

test('BANPU hold is an exact three-anchor packet, not a ticker rule; raw mixed metrics are preserved', () => {
  const input = clone(fixture['BANPU.BK']);
  const exact = applyFinancialCases(input), result = exact.snapshot;
  assert.equal(result.meta.financialDataIssue.caseId, 'banpu-mixed-issuer-packet-20260929');
  assert.ok(!exact.events.some(e => e.status === 'stale'), 'Exact packet: hold without warning');
  assert.equal(serial(result.metrics), serial(input.metrics));
  assert.equal(serial(result.annual), serial(input.annual));
  const { isDataSuspect } = require('../src/scoring/score.js');
  assert.equal(isDataSuspect(result, [], 'route'), true);
  assert.equal(isDataSuspect(result, [], 'survival'), true);
  const scored = require('../src/scoring/score.js').scoreUniverse([result], require('../src/scoring/formulas/index.js'))[0];
  assert.equal(scored.score, null);
  assert.equal(scored.reason, 'data-suspect', 'Stable code: it is the excluded bucket key');
  assert.equal(scored.reasonText, result.meta.financialDataIssue.reason, 'Text rides in a separate field');
  // M2: a drifted anchor (e.g. shares +0.1 %) keeps the hold until a human re-verifies, and warns.
  const drifted = r => {
    assert.equal(r.snapshot.meta.financialDataIssue?.caseId, 'banpu-mixed-issuer-packet-20260929');
    assert.equal(require('../src/scoring/score.js').isDataSuspect(r.snapshot, [], 'route'), true);
    const stale = r.events.filter(e => e.status === 'stale');
    assert.equal(stale.length, 1);
    assert.equal(stale[0].reasonCode, 'quarantine-fingerprint-changed');
    assert.equal(stale[0].caseId, 'banpu-mixed-issuer-packet-20260929');
  };
  for (const anchor of table.quarantines[0].fingerprint) {
    const other = clone(input); const parent = anchor.path.slice(0,-1).reduce((v,k) => v[k], other);
    parent[anchor.path.at(-1)] *= 1.001;
    const r = applyFinancialCases(other); drifted(r);
    assert.equal(serial(applyFinancialCases(r.snapshot).snapshot), serial(r.snapshot), 'Idempotent');
    assert.ok(applyFinancialCases(r.snapshot).events.some(e => e.reasonCode === 'quarantine-fingerprint-changed'), 'Still warned later');
  }
  // Absence: another ticker with the same drifted packet and no quarantine is untouched.
  const unlisted = clone(input); unlisted.meta.ticker = 'UNLISTED'; unlisted.meta.sharesOutstanding *= 1.001;
  const u = applyFinancialCases(unlisted); assert.equal(u.snapshot, unlisted); assert.equal(u.events.length, 0);
  // Break-once in memory: the old silent release when the fingerprint no longer matches.
  const lapse = moduleCopy('lib/financial-known-cases.js', s => replaceLine(s,
    '    const matches = matchesQuarantine(snapshot, q);',
    '    const matches = matchesQuarantine(snapshot, q); if (!matches) continue;'));
  const sharesDrift = clone(input); sharesDrift.meta.sharesOutstanding *= 1.001;
  assert.throws(() => drifted(lapse.applyFinancialCases(sharesDrift)), assert.AssertionError); breaks++;
  const rollover = clone(input);
  for (const field of ['annualRev','annualGP']) {
    rollover.annual[field].unshift({value:null});
    rollover.annual[field+'Ends'].unshift(null);
  }
  // A year rollover is still the exact packet: hold without a fingerprint warning.
  const assertHold = fn => {
    const r = fn(rollover);
    assert.equal(require('../src/scoring/score.js').scoreUniverse([r.snapshot], require('../src/scoring/formulas/index.js'))[0].score, null);
    assert.ok(!r.events.some(e => e.status === 'stale'), 'Rollover matches the fingerprint');
  };
  assertHold(applyFinancialCases);
  const oldIndex = moduleCopy('lib/financial-known-cases.js', s => replaceLine(s,
    '    const matches = matchesQuarantine(snapshot, q);',
    '    const matches = q.fingerprint.every(a => a.path.reduce((v, k) => v?.[k], snapshot) === a.expected);'));
  assert.throws(() => assertHold(oldIndex.applyFinancialCases), assert.AssertionError); breaks++;
  const mismatch = clone(rollover); mismatch.annual.annualGP.unshift({value:null});
  drifted(applyFinancialCases(mismatch));
  const dated = clone(rollover);
  dated.annual.annualRevEnds[1] = dated.annual.annualGPEnds[1] = '2025-12-31';
  assert.ok(!applyFinancialCases(dated).events.some(e => e.status === 'stale'));
  dated.annual.annualGPEnds[1] = '2024-12-31';
  drifted(applyFinancialCases(dated));
  const broken = moduleCopy('src/scoring/score.js', s => replaceLine(s,
    '  if (s?.meta?.financialDataIssue) return true;', '  // Deliberately removed in-memory wrong-issuer guard.'));
  assert.throws(() => assert.equal(broken.isDataSuspect(result, [], 'route'), true), assert.AssertionError); breaks++;
});

test('zero rule requires actual zero and date-aligned evidence or a nonzero neighbor', () => {
  const s = { meta:{ticker:'ZERO'}, timeseries:{
    revenueQ:[{value:100},{value:0},{value:120},{value:null}], revenueQEnds:['2026-06-30','2026-03-31','2025-12-31','2025-09-30'],
    grossProfitQ:[{value:0},{value:-2},{value:0},{value:null}], grossProfitQEnds:['2026-06-30','2026-03-31','2025-12-31','2025-09-30'] } };
  const before = serial(s), active = applyZeroGuard(s,{mode:'active'});
  assert.deepEqual(norm(active.snapshot,'revenueQ'),[100,null,120,null]);
  assert.deepEqual(norm(active.snapshot,'grossProfitQ'),[null,-2,null,null]);
  assert.equal(active.events.length,3); assert.equal(serial(s),before);
  assert.equal(serial(applyZeroGuard(active.snapshot,{mode:'active'}).snapshot),serial(active.snapshot));
  assert.equal(applyZeroGuard(s,{mode:'shadow'}).snapshot,s);
  const noEvidence={timeseries:{revenueQ:[{value:0}],grossProfitQ:[{value:0}]}};
  assert.equal(applyZeroGuard(noEvidence,{mode:'active'}).snapshot,noEvidence);
  const misaligned={timeseries:{revenueQ:[{value:100}],revenueQEnds:['2026-06-30'],grossProfitQ:[{value:0}],grossProfitQEnds:['2025-06-30']}};
  assert.equal(applyZeroGuard(misaligned,{mode:'active'}).snapshot,misaligned);
  const undated={annual:{annualRev:[{value:100}],annualGP:[{value:0}]}};
  assert.equal(applyZeroGuard(undated,{mode:'active'}).snapshot,undated);
  const genuine=clone(s); genuine.timeseries.grossProfitQ[0].reportedZeroEvidence={url:'https://issuer.example/filing',period:'2026-06-30'};
  assert.equal(norm(applyZeroGuard(genuine,{mode:'active'}).snapshot,'grossProfitQ')[0],0);
  const scalar={annual:{annualGP:[5,0,-4]}};
  assert.deepEqual(norm(applyZeroGuard(scalar,{mode:'active'}).snapshot,'annualGP'),[5,null,-4]);
  const cost={timeseries:{revenueQ:[{value:0}],revenueQEnds:['2026-06-30'],costOfRevenueQ:[{value:30}],costOfRevenueQEnds:['2026-06-30']}};
  assert.equal(norm(applyZeroGuard(cost,{mode:'active'}).snapshot,'revenueQ')[0],null);
  const broken=moduleCopy('lib/zero-financials-guard.js',s=>replaceLine(s,
    '        if (valueOf(row) !== 0) continue;', '        if (valueOf(row) !== 100) continue;'));
  assert.throws(()=>assert.deepEqual(norm(broken.applyZeroGuard(s,{mode:'active'}).snapshot,'revenueQ'),[100,null,120,null]),assert.AssertionError); breaks++;
});

test('more than 50 visible changes forces shadow; exactly 50 remains eligible', () => {
  assert.equal(modeForReplay(50),'active'); assert.equal(modeForReplay(51),'shadow');
  assert.equal(policy.mode,'shadow');
  assert.throws(()=>validatePolicy({...policy,mode:'guess'}),/Invalid/);
  assert.throws(()=>modeForReplay(NaN),/Invalid/);
  const broken=moduleCopy('lib/zero-financials-guard.js',s=>replaceLine(s,
    "  return visibleScoreChanges > policy.visibleScoreChangeLimit ? 'shadow' : 'active';",
    "  return visibleScoreChanges > 50000 ? 'shadow' : 'active';"));
  assert.throws(()=>assert.equal(broken.modeForReplay(51),'shadow'),assert.AssertionError); breaks++;
});

test('real native/USD producer, readers, PIT and exported reasons field use the same overlay', () => {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'financial-cases-test-'));
  const live=path.resolve(__dirname,'../snapshots');
  assert.notEqual(path.resolve(tmp),live); assert.ok(!path.resolve(tmp).startsWith(live+path.sep));
  for(const [ticker,s] of Object.entries(fixture)) fs.writeFileSync(path.join(tmp,ticker+'.json'),serial(s));
  process.env.FINDASH_SNAPSHOTS_DIR=tmp;
  const { _convertSnapshotToUSD }=require('../pull-yahoo.js');
  const { readScoringSnapshot }=require('../src/scoring/run-screener.js');
  const before=sha(path.join(tmp,'BANPU.BK.json'));
  const c=clone(fixture['BANPU.BK']); _convertSnapshotToUSD(c);
  assert.ok(c.meta.financialDataIssue); assert.equal(c.timeseries.revenueQ[0].value,1340143000);
  const once=serial(c); _convertSnapshotToUSD(c); assert.equal(serial(c),once);
  const native=clone(fixture.HTGC); native.meta.fxConverted=false; _convertSnapshotToUSD(native);
  assert.equal(native.timeseries.revenueQ[0].value,149114000);
  assert.equal(readScoringSnapshot(path.join(tmp,'HTGC.json')).timeseries.revenueQ[0].value,149114000);
  assert.equal(sha(path.join(tmp,'BANPU.BK.json')),before);
  const exporter=require('../scripts/write-findash-export.js');
  for(const map of [exporter.mapBoardRow,exporter.mapOverviewRow,exporter.mapSurvivalRow]) {
    const row=map({ticker:'YSN.DE',lamps:['peakMargin'],score:50,track:'profitable'},0);
    assert.deepEqual(row.lamps,['peakMargin'],'lamps stay closed registry keys');
    assert.ok(row.financialDataReasons[0].startsWith('Bruttogewinn fehlt:'),'Reason rides in the additive field');
    const clean=map({ticker:'UNLISTED',lamps:[],score:50,track:'profitable'},0);
    assert.ok(!Object.hasOwn(clean,'financialDataReasons'),'Field absent when there is no reason');
  }
  const adapter=require('../lib/yahoo-q4-known-cases.js');
  const broken=moduleCopy('lib/yahoo-q4-known-cases.js',s=>s,{
    './financial-known-cases.js':{applyFinancialCases:s=>({snapshot:s,events:[]})},
  });
  const guard=fn=>assert.equal(fn(clone(fixture.HTGC)).timeseries.revenueQ[0].value,149114000);
  assert.throws(()=>guard(broken.prepareSnapshot),assert.AssertionError);guard(adapter.prepareSnapshot);breaks++;
});

// L2: a hand-table failure in the scoring loaders turns the run red instead of dropping the company.
test('scoring loaders rethrow hand-table failures; an ordinary broken file is still only counted', () => {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'financial-cases-loader-'));
  const live=path.resolve(__dirname,'../snapshots');
  assert.notEqual(path.resolve(tmp),live); assert.ok(!path.resolve(tmp).startsWith(live+path.sep));
  fs.writeFileSync(path.join(tmp,'HTGC.json'),serial(fixture.HTGC));
  const q4=require('../lib/yahoo-q4-known-cases.js');
  const failing={...q4,prepareSnapshot:()=>{const e=new Error('hand table broken');e.code=q4.FAILURE_CODE;throw e;}};
  const rs=moduleCopy('src/scoring/run-screener.js',s=>s,{'../../lib/yahoo-q4-known-cases.js':failing});
  assert.throws(()=>rs.loadSmallcapUniverse(tmp,path.join(tmp,'none.json')),/hand table broken/);
  assert.throws(()=>rs.loadUniverse(tmp,path.join(tmp,'none.json')),/hand table broken/);
  // Absence: a plain unreadable file is still counted as a parse failure, not thrown.
  const bad=fs.mkdtempSync(path.join(os.tmpdir(),'financial-cases-loader-bad-'));
  fs.writeFileSync(path.join(bad,'BROKEN.json'),'{');
  assert.equal(require('../src/scoring/run-screener.js').loadSmallcapUniverse(bad,path.join(bad,'none.json')),null);
  // Break-once in memory: the old swallowing catch drops the company silently.
  const old=moduleCopy('src/scoring/run-screener.js',s=>replaceLine(s,
    '    catch (e) { if (e.code === HAND_TABLE_FAILED) throw e; parseFail++; continue; }',
    '    catch (e) { parseFail++; continue; }'),{'../../lib/yahoo-q4-known-cases.js':failing});
  assert.throws(()=>assert.throws(()=>old.loadSmallcapUniverse(tmp,path.join(tmp,'none.json')),/hand table broken/),assert.AssertionError); breaks++;
});

// LOW-6: the daily pull's own converter (processOne -> _convertSnapshotToUSDGuarded), then disk,
// then the scoring job's reader. Temp dir only; never the live snapshot store.
test('end to end: pull converter -> disk -> scoring reader for HTGC, BANPU, secunet and a new HTGC quarter', () => {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'financial-cases-e2e-'));
  const live=path.resolve(__dirname,'../snapshots');
  assert.notEqual(path.resolve(tmp),live); assert.ok(!path.resolve(tmp).startsWith(live+path.sep));
  const { _convertSnapshotToUSDGuarded }=require('../pull-yahoo.js');
  const { readScoringSnapshot }=require('../src/scoring/run-screener.js');
  const through=(name,snap)=>{
    assert.equal(_convertSnapshotToUSDGuarded(snap),true);
    const file=path.join(tmp,name+'.json'); fs.writeFileSync(file,serial(snap));
    return readScoringSnapshot(file);
  };
  const htgc=clone(fixture.HTGC); htgc.meta.fxConverted=false; // native USD packet as pulled
  assert.deepEqual(norm(through('HTGC',htgc),'revenueQ'),[149114000,141536000,137430000,138093000,137459000]);
  const banpu=through('BANPU.BK',clone(fixture['BANPU.BK']));
  assert.equal(norm(banpu,'revenueQ')[0],1340143000); assert.ok(banpu.meta.financialDataIssue);
  const ysn=through('YSN.DE',clone(fixture['YSN.DE']));
  assert.deepEqual(norm(ysn,'grossProfitQ'),[null,null,null,null],'False zeros arrive as missing, not 0');
  assert.ok(ysn.timeseries.grossProfitQ.every(r=>r.financialCorrection?.replacementNativeValue===null));
  const next=nextQuarter(clone(fixture.HTGC)); next.meta.fxConverted=false;
  const n=through('HTGC-next',next);
  assert.equal(norm(n,'revenueQ')[0],null);
  assert.equal(n.timeseries.revenueQ[0].financialMissing.reasonCode,'period-after-coverage');
  assert.equal(norm(n,'revenueQ')[1],149114000);
  // Absence: an unrelated company goes through the same path unchanged.
  const other=clone(fixture.HTGC); other.meta.ticker='UNLISTED'; other.meta.fxConverted=false;
  assert.equal(norm(through('UNLISTED',other),'revenueQ')[0],158252000);
});

// R3b: the excluded-list row of a quarantined packet shows no value its own reason calls unreliable.
test('excluded list: a quarantined packet has null sector, industry, market cap and growth; the reason stays', () => {
  const { buildExcludedList } = require('../scripts/write-excluded-list.js');
  const banpu = applyFinancialCases(clone(fixture['BANPU.BK'])).snapshot;
  const other = clone(banpu); other.meta = { ...other.meta, ticker: 'UNLISTED', name: 'Unlisted Power Inc',
    industry: 'Utilities - Independent Power Producers' };
  delete other.meta.financialDataIssue;
  const result = (s, ticker) => ({ ticker, name: 'Test', action: 'exclude', reason: 'data-suspect', sector: 'Utilities',
    marketCap: 1334574183, revGrowthYoYPct: 4.4 });
  const build = fn => fn([result(banpu, 'BANPU.BK'), result(other, 'UNLISTED')], [banpu, other]).rows;
  const check = rows => {
    const b = rows.find(r => r.ticker === 'BANPU.BK'), u = rows.find(r => r.ticker === 'UNLISTED');
    for (const f of ['sector', 'industry', 'marketCap', 'revGrowthYoYPct']) assert.equal(b[f], null, 'BANPU ' + f);
    assert.equal(b.reason, 'data-suspect');
    assert.ok(b.financialDataReasons[0].startsWith('Score fehlt:'), 'Reason text kept');
    // Absence: the same values stay visible on a row without a quarantine.
    assert.deepEqual([u.sector, u.industry, u.marketCap, u.revGrowthYoYPct],
      ['Utilities', 'Utilities - Independent Power Producers', 1334574183, 4.4]);
  };
  check(build(buildExcludedList));
  // Break-once in memory: without the quarantine check the unreliable values reach the list.
  const broken = moduleCopy('scripts/write-excluded-list.js', s => replaceLine(s,
    '  const suspekt = !!(meta && meta.financialDataIssue);', '  const suspekt = false;'));
  assert.throws(() => check(build(broken.buildExcludedList)), assert.AssertionError); breaks++;
});

// R2: other listings of the same issuer carry the identical false cells (checked in the 29.09. archive).
test('listing aliases: YSNG.VI, PDN.TO and PALAF are corrected like their primary; unrelated ticker untouched', () => {
  const aliases = Object.fromEntries(table.cases.filter(c => c.listingAliases).map(c => [c.ticker, c.listingAliases]));
  assert.deepEqual(aliases, { 'YSN.DE': ['YSNG.VI'], 'PDN.AX': ['PDN.TO', 'PALAF'] });
  const leg = (primary, alias) => { const s = clone(fixture[primary]); s.meta.ticker = alias; return s; };
  for (const [primary, list] of Object.entries(aliases)) for (const alias of list) {
    const input = leg(primary, alias), original = serial(input), r = applyFinancialCases(input);
    const primaryOut = applyFinancialCases(clone(fixture[primary])).snapshot;
    assert.equal(serial(r.snapshot.timeseries), serial(primaryOut.timeseries), alias + ' corrected like ' + primary);
    assert.ok(r.events.some(e => e.status === 'missing' && e.ticker === alias));
    assert.equal(serial(input), original);
  }
  // Absence: an unrelated ticker with the identical packet stays raw.
  const other = leg('YSN.DE', 'YSN2.XX'); assert.equal(applyFinancialCases(other).snapshot, other);
  // Validation: an alias that is another case's primary ticker is rejected; so is a malformed alias list.
  const clash = clone(table); clash.cases.find(c => c.ticker === 'YSN.DE').listingAliases = ['HTGC'];
  assert.throws(() => validateTable(clash), /Invalid financial listing alias/);
  const notArray = clone(table); notArray.cases.find(c => c.ticker === 'YSN.DE').listingAliases = 'YSNG.VI';
  assert.throws(() => validateTable(notArray), /Invalid financial listing alias/);
  const dupKey = clone(table); dupKey.cases.find(c => c.ticker === 'PDN.AX').listingAliases = ['YSNG.VI'];
  const ysnPeriod = table.cases.find(c => c.ticker === 'YSN.DE').period;
  dupKey.cases.find(c => c.ticker === 'PDN.AX').period = ysnPeriod; dupKey.cases.find(c => c.ticker === 'PDN.AX').field = 'grossProfitQ';
  assert.throws(() => validateTable(dupKey), /duplicate/);
  // Break-once in memory: primary-ticker-only matching leaves the alias leg with its false zeros.
  const broken = moduleCopy('lib/financial-known-cases.js', s => replaceLine(s,
    'const listed = (x, ticker) => listings(x).includes(ticker);', 'const listed = (x, ticker) => x.ticker === ticker;'));
  const guard = fn => assert.equal(norm(fn(leg('YSN.DE', 'YSNG.VI')).snapshot, 'grossProfitQ')[0], null);
  assert.throws(() => guard(broken.applyFinancialCases), assert.AssertionError); guard(applyFinancialCases); breaks++;
});

// R5: a corrected cell that later becomes withheld drops its old correction marker and reason.
test('withheld cell drops an older financialCorrection; reasons prefer the missing text', () => {
  const corrected = applyFinancialCases(clone(fixture.HTGC)).snapshot;
  assert.ok(corrected.timeseries.revenueQ[0].financialCorrection);
  const changed = clone(corrected); changed.timeseries.revenueQ[0].currency = 'EUR';
  const r = applyFinancialCases(changed).snapshot, row = r.timeseries.revenueQ[0];
  assert.equal(value(row), null); assert.equal(row.financialMissing.reasonCode, 'context-changed');
  assert.ok(!Object.hasOwn(row, 'financialCorrection'), 'Old correction marker dropped');
  assert.ok(row.financialMissing.originalVendorRow.financialCorrection, 'Audit trail keeps the prior row');
  assert.equal(serial(applyFinancialCases(r).snapshot), serial(r), 'Idempotent');
  // Absence: an untouched corrected row keeps its marker.
  assert.ok(r.timeseries.revenueQ[1].financialCorrection);
  // Reader order: a hand-made row with both markers shows the missing reason.
  const both = { timeseries: { revenueQ: [{ value: null, financialCorrection: { reason: 'alt' }, financialMissing: { reason: 'neu' } }] } };
  assert.deepEqual(financialReasons(both), ['neu']);
  const broken = moduleCopy('lib/financial-known-cases.js', s => replaceLine(s,
    '      write(event.field, event.index, { ...rest, value: null,',
    '      write(event.field, event.index, { ...rest, financialCorrection, value: null,'));
  assert.throws(() => assert.ok(!Object.hasOwn(broken.applyFinancialCases(changed).snapshot.timeseries.revenueQ[0], 'financialCorrection')),
    assert.AssertionError); breaks++;
});

// R1: the daily pull runs preserveReloadHistory between conversion and disk. A hand-table hole
// (verified false value or withheld cell) is authoritative and must never be refilled from the prior disk.
test('end to end with reload history: withheld cells stay withheld on disk and at the scoring reader', () => {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'financial-cases-reload-'));
  const live=path.resolve(__dirname,'../snapshots');
  assert.notEqual(path.resolve(tmp),live); assert.ok(!path.resolve(tmp).startsWith(live+path.sep));
  const { _convertSnapshotToUSDGuarded }=require('../pull-yahoo.js');
  const { readScoringSnapshot }=require('../src/scoring/run-screener.js');
  const yahooQ4=require('../lib/yahoo-q4-known-cases.js');
  const Q=['revenueQ','opIncQ','grossProfitQ','netIncomeQ'];
  // The full pull stamps comparable statement periods (setPeriods); without them nothing is retained.
  const periods=(s,at)=>{ const ccy=s.meta.reportingCurrencyOriginal||s.meta.reportingCurrency; s.meta.statementPeriods={};
    for(const f of Q){ const e=s.timeseries[f+'Ends']||s.timeseries.revenueQEnds||[];
      s.meta.statementPeriods[f]=(s.timeseries[f]||[]).map((_,i)=>e[i]?{end:e[i],duration:'3M',currency:ccy,unit:'currency',basis:'yahoo-statement',fetchedAt:at}:null); }
    return s; };
  const native=(t,at)=>{ const s=periods(clone(fixture[t]),at); if(s.meta.reportingCurrencyOriginal==='USD') s.meta.fxConverted=false; return s; };
  // pull-yahoo.js order: convert -> preserveReloadHistory(prior disk with Q4 overlay) -> disk -> scoring reader.
  const pull=(preserve,name,priorDisk,next)=>{
    assert.equal(_convertSnapshotToUSDGuarded(next),true);
    preserve(next,yahooQ4.applyKnownCases(priorDisk).snapshot);
    const file=path.join(tmp,name+'.json'); fs.writeFileSync(file,serial(next));
    return { disk:JSON.parse(fs.readFileSync(file,'utf8')), scored:readScoringSnapshot(file), retained:next.meta.reloadHistoryRetained||[] };
  };
  const day1=preserve=>pull(preserve,'HTGC-d1',periods(clone(fixture.HTGC),'2026-09-29T09:00:00.000Z'),native('HTGC','2026-09-30T09:00:00.000Z'));
  const day2=(preserve,priorDisk)=>{ const n=native('HTGC','2026-10-01T09:00:00.000Z'); n.timeseries.revenueQ[0].value++;
    return pull(preserve,'HTGC-d2',priorDisk,n); };
  const withheld=(r,field,i,code)=>{
    assert.equal(value(r.disk.timeseries[field][i]),null,'disk '+field+'['+i+']');
    assert.equal(norm(r.scored,field)[i],null,'reader '+field+'['+i+']');
    if(code) assert.equal(r.disk.timeseries[field][i].financialMissing.reasonCode,code);
    assert.ok(!r.retained.some(x=>x.field===field&&x.end===r.disk.timeseries[field+'Ends'][i]),'not retained');
  };
  const { preserveReloadHistory }=require('../lib/reload-history.js');
  // Prior disk raw (main era): verified false zeros stay missing, never refilled with the stored 0.
  const ysn=pull(preserveReloadHistory,'YSN.DE',periods(clone(fixture['YSN.DE']),'2026-09-29T09:00:00.000Z'),native('YSN.DE','2026-09-30T09:00:00.000Z'));
  for(const i of [0,1,2,3]) withheld(ysn,'grossProfitQ',i);
  // Prior disk raw, vendor restated the verified cell today: withheld, not the raw prior value.
  const raw=day2(preserveReloadHistory,periods(clone(fixture.HTGC),'2026-09-29T09:00:00.000Z'));
  withheld(raw,'revenueQ',0,'vendor-value-changed');
  // Prior disk corrected (day 1 output), vendor restated on day 2: withheld, not the old correction.
  const d1=day1(preserveReloadHistory);
  assert.equal(norm(d1.disk,'revenueQ')[0],149114000);
  const d2=day2(preserveReloadHistory,d1.disk);
  withheld(d2,'revenueQ',0,'vendor-value-changed');
  assert.ok(!d2.disk.timeseries.revenueQ[0].financialCorrection,'No stale correction marker');
  assert.deepEqual(norm(d2.scored,'revenueQ').slice(1),[141536000,137430000,138093000,137459000]);
  // Absence: an ordinary hole in an unrelated company is still refilled from the prior disk.
  const prior=periods(clone(fixture.HTGC),'2026-09-29T09:00:00.000Z'); prior.meta.ticker='UNLISTED';
  const hole=native('HTGC','2026-09-30T09:00:00.000Z'); hole.meta.ticker='UNLISTED'; hole.timeseries.revenueQ[1]={value:null};
  const u=pull(preserveReloadHistory,'UNLISTED',prior,hole);
  assert.equal(norm(u.disk,'revenueQ')[1],value(fixture.HTGC.timeseries.revenueQ[1]));
  assert.ok(u.retained.some(x=>x.field==='revenueQ'));
  // Break-once in memory: the old Q4-only gap test writes the old correction back on day 2.
  const old=moduleCopy('lib/reload-history.js',s=>replaceLine(s,
    '  || x?.financialCorrection?.replacementNativeValue === null || x?.financialMissing != null);','  );'));
  assert.throws(()=>withheld(day2(old.preserveReloadHistory,day1(old.preserveReloadHistory).disk),'revenueQ',0),assert.AssertionError); breaks++;
});

// BDC flag 1: KBDC's packet has no vendor financialCurrency (ccyAmbiguous) on a NYSE USD/USD listing.
// The verified USD cases apply there; a genuinely ambiguous packet stays withheld.
test('ccyAmbiguous: US-exchange USD/USD packet takes its USD cases; LSE, OTC, assumed or non-USD packets stay withheld', () => {
  const axes = require('../src/scoring/axes.js');
  const kbdc = table.cases.filter(c => c.ticker === 'KBDC');
  assert.equal(kbdc.length, 5); assert.equal(fixture.KBDC.meta.ccyAmbiguous, true);
  assert.deepEqual([fixture.KBDC.meta.exchangeName, fixture.KBDC.meta.tradingCurrency, fixture.KBDC.meta.reportingCurrencyOriginal], ['NYSE', 'USD', 'USD']);
  const corrected = fn => {
    const r = fn(clone(fixture.KBDC));
    for (const c of kbdc) assert.equal(value(r.snapshot.timeseries.revenueQ[r.snapshot.timeseries.revenueQEnds.indexOf(c.period)]), c.replacementValue);
    assert.ok(!r.events.some(e => e.status === 'stale'));
    assert.equal(axes.revGrowthLevel(r.snapshot).toFixed(1), '-2.8', 'SEC quarters: 55.703 vs 57.298 million');
  };
  corrected(applyFinancialCases);
  // Absence: each genuinely ambiguous variant withholds all five cells (context-changed), never the case value.
  const withheld = (change, fn = applyFinancialCases) => {
    const input = clone(fixture.KBDC); change(input.meta);
    const r = fn(input), rows = r.snapshot.timeseries.revenueQ;
    assert.deepEqual(rows.map(value), [null, null, null, null, null]);
    assert.ok(rows.every(row => row.financialMissing.reasonCode === 'context-changed'));
    assert.equal(r.events.filter(e => e.status === 'stale').length, 5);
  };
  for (const change of [m => { m.exchangeName = 'LSE'; }, m => { m.exchangeName = 'OTC Markets OTCPK'; },
    m => { m.tradingCurrencyAssumed = true; }, m => { m._ccyMissingCompletely = true; },
    m => { m.tradingCurrency = 'EUR'; m.reportingCurrencyOriginal = 'EUR'; }]) withheld(change);
  // A non-USD case never applies on the resolved USD/USD packet.
  const eur = clone(table); for (const c of eur.cases) if (c.ticker === 'KBDC') c.currency = 'EUR';
  assert.ok(applyFinancialCases(clone(fixture.KBDC), { table: eur }).snapshot.timeseries.revenueQ.every(row => value(row) === null));
  // Unchanged rule for a packet with a vendor currency: same correction.
  const known = clone(fixture.KBDC); known.meta.ccyAmbiguous = false;
  assert.equal(value(applyFinancialCases(known).snapshot.timeseries.revenueQ[0]), 55703000);
  // Break-once in memory (presence): the old blanket ccyAmbiguous rule withholds KBDC's verified cells.
  const old = moduleCopy('lib/financial-known-cases.js', s => replaceLine(s,
    "  if (!m || m.fxConversionFailed || (m.ccyAmbiguous && !usdListing(m)) || (m.source && !/^yahoo/i.test(m.source))) return null;",
    "  if (!m || m.fxConversionFailed || m.ccyAmbiguous || (m.source && !/^yahoo/i.test(m.source))) return null;"));
  assert.throws(() => corrected(old.applyFinancialCases), assert.AssertionError); breaks++;
  // Break-once in memory (absence): without the exchange check an LSE USD packet would take the cases.
  const loose = moduleCopy('lib/financial-known-cases.js', s => replaceLine(s,
    "  /^(NYSE|NYSE American|NYSEArca|NasdaqGS|NasdaqGM|NasdaqCM|Cboe US)$/.test(m.exchangeName || '');", '  true;'));
  assert.throws(() => withheld(m => { m.exchangeName = 'LSE'; }, loose.applyFinancialCases), assert.AssertionError); breaks++;
});

// BDC flag 4: OXLC is one false vendor zero in a series whose other checked quarters agree with the issuer.
test('singleFalseValue: OXLC gets the issuer quarter without coverage; neighbours and new quarters stay vendor', () => {
  const axes = require('../src/scoring/axes.js');
  const c = table.cases.find(x => x.ticker === 'OXLC');
  assert.deepEqual([c.singleFalseValue, c.expectedBadValue, c.replacementValue], [true, 0, 94000000]);
  assert.ok(/gerundet/.test(c.reason) && /issuer-rounded/.test(c.sources[0].unit), 'Rounding is recorded in the entry');
  assert.ok(!table.coverage.some(v => v.ticker === 'OXLC'));
  const input = clone(fixture.OXLC), r = applyFinancialCases(input);
  assert.deepEqual(norm(r.snapshot, 'revenueQ'), [94000000, 124000000, 121161000, 0], 'Only the verified zero is replaced');
  assert.ok(!r.events.some(e => e.status === 'stale'));
  assert.equal(axes.revGrowthLevel(r.snapshot).toFixed(1), '-22.4', '94.0 vs 121.161 million');
  // Without coverage a newer vendor quarter passes as vendor data (the series basis is not wrong).
  const next = nextQuarter(clone(fixture.OXLC), 95e6);
  assert.equal(value(applyFinancialCases(next).snapshot.timeseries.revenueQ[0]), 95e6);
  // Absence: the flag is required to skip coverage, and only allowed with a replacement value.
  const noFlag = clone(table); delete noFlag.cases.find(x => x.ticker === 'OXLC').singleFalseValue;
  assert.throws(() => validateTable(noFlag), /Missing financial coverage: OXLC\|revenueQ/);
  const nullFlag = clone(table); Object.assign(nullFlag.cases.find(x => x.ticker === 'YSN.DE'), { singleFalseValue: true });
  assert.throws(() => validateTable(nullFlag), /Invalid or duplicate financial case/);
  const notTrue = clone(table); notTrue.cases.find(x => x.ticker === 'OXLC').singleFalseValue = 'yes';
  assert.throws(() => validateTable(notTrue), /Invalid or duplicate financial case/);
  // Break-once in memory: without the opt-out the real table no longer validates (the module throws on load).
  assert.throws(() => moduleCopy('lib/financial-known-cases.js', s => replaceLine(s,
    '    if (c.replacementValue !== null && !c.singleFalseValue) for (const t of listings(c)) basisWrong.add(`${t}|${c.field}`);',
    '    if (c.replacementValue !== null) for (const t of listings(c)) basisWrong.add(`${t}|${c.field}`);')),
  /Missing financial coverage: OXLC\|revenueQ/); breaks++;
});

for(const [file,before] of hashes) assert.equal(sha(path.join(__dirname,'..',file)),before,'Live artifact unchanged: '+file);
console.log(`financial-known-cases: ${passed} passed; ${breaks} break-once canaries fired; live hashes unchanged`);
