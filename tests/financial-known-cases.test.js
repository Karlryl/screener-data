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
  'lib/zero-financials-guard.js','lib/yahoo-q4-known-cases.js','src/scoring/score.js'];
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

test('all 36 authorized cells and one mixed-issuer packet have auditable sources', () => {
  assert.equal(table.cases.length, 36); assert.equal(table.quarantines.length, 1);
  assert.throws(() => validateTable({}), /Invalid/);
  const duplicate = clone(table); duplicate.cases.push(duplicate.cases[0]); assert.throws(() => validateTable(duplicate), /duplicate/);
  const undocumented = clone(table); undocumented.cases[0].sources[0].quote = ''; assert.throws(() => validateTable(undocumented), /Invalid/);
});

// M1: a basis-wrong series (any non-null replacement) needs exactly one coverage entry.
test('coverage is mandatory for basis-wrong series, unique, and absent for single false values', () => {
  const need = new Set(table.cases.filter(c => c.replacementValue !== null).map(c => c.ticker + '|' + c.field));
  assert.deepEqual([...need].sort(), ['ARCC|revenueQ', 'BANPU.BK|revenueQ', 'FSK|revenueQ', 'HTGC|revenueQ']);
  assert.deepEqual(table.coverage.map(v => v.ticker + '|' + v.field).sort(), [...need].sort());
  const noHtgc = clone(table); noHtgc.coverage = noHtgc.coverage.filter(v => v.ticker !== 'HTGC');
  assert.throws(() => validateTable(noHtgc), /Missing financial coverage: HTGC\|revenueQ/);
  const noKey = clone(table); delete noKey.coverage; assert.throws(() => validateTable(noKey), /Invalid financial hand table/);
  const notArray = clone(table); notArray.coverage = {}; assert.throws(() => validateTable(notArray), /Invalid financial hand table/);
  const dupCoverage = clone(table); dupCoverage.coverage.push(clone(dupCoverage.coverage[0]));
  assert.throws(() => validateTable(dupCoverage), /Invalid financial coverage \(bad or duplicate\): HTGC/);
  const dupId = clone(table); dupId.cases[1].caseId = dupId.cases[0].caseId; assert.throws(() => validateTable(dupId), /duplicate/);
  // Absence: false-zero series (null replacement) validate without coverage; the real table passes.
  assert.equal(validateTable(clone(table)).cases.length, 36);
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
  assert.deepEqual(table.coverage.map(v => v.ticker).sort(), ['ARCC', 'BANPU.BK', 'FSK', 'HTGC']);
  for (const ticker of ['HTGC', 'ARCC', 'FSK']) {
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
    '  const fields = new Set([...config.coverage, ...config.cases].filter(x => x.ticker === ticker).map(x => x.field));',
    '  const fields = new Set();'));
  const guard = fn => assert.equal(value(fn(nextQuarter(clone(fixture.HTGC))).snapshot.timeseries.revenueQ[0]), null);
  assert.throws(() => guard(broken.applyFinancialCases), assert.AssertionError); guard(applyFinancialCases); breaks++;
});

// L1: a value without a usable period end never passes raw in a series with hand-table authority.
test('missing or short *Ends array and undated entries are withheld as period-not-verified', () => {
  const check = (ticker, field, change, indexes) => {
    const input = clone(fixture[ticker]); change(input.timeseries);
    const original = serial(input), r = applyFinancialCases(input);
    for (const i of indexes) {
      const row = r.snapshot.timeseries[field][i];
      assert.equal(value(row), null, ticker + ' index ' + i);
      assert.equal(row.financialMissing.reasonCode, 'period-not-verified');
      assert.ok(r.events.some(e => e.status === 'stale' && e.reasonCode === 'period-not-verified' && e.index === i));
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
  check('YSN.DE', 'grossProfitQ', ts => { delete ts.grossProfitQEnds; }, [...Array(g).keys()].filter(i =>
    value(fixture['YSN.DE'].timeseries.grossProfitQ[i]) != null));
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

for(const [file,before] of hashes) assert.equal(sha(path.join(__dirname,'..',file)),before,'Live artifact unchanged: '+file);
console.log(`financial-known-cases: ${passed} passed; ${breaks} break-once canaries fired; live hashes unchanged`);
