'use strict';

// Break-once targets memory-only modules/tables. Never target a writing test or live artifact.
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { Module, createRequire } = require('module');
const { applyFinancialCases, financialReasons, validateTable, table } = require('../lib/financial-known-cases.js');
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
  const guard = config => assert.equal(norm(applyFinancialCases(input, { table: config }).snapshot, c.field)[i],
    c.replacementValue === null ? null : c.replacementValue * factor);
  assert.throws(() => guard(broken), assert.AssertionError); guard(table); breaks++;
});

test('stale values, wrong units/currency/source, duplicate dates and non-target rows stay byte-identical', () => {
  for (const change of [
    s => { s.timeseries.revenueQ[0].value++; },
    s => { s.timeseries.revenueQ[0].currency = 'EUR'; },
    s => { s.timeseries.revenueQ[0].multiplier = 1000; },
    s => { s.timeseries.revenueQ[0].periodType = '12M'; },
    s => { s.timeseries.revenueQ[0].source = 'SEC'; },
    s => { s.meta.reportingCurrencyOriginal = 'EUR'; },
    s => { s.timeseries.revenueQEnds[1] = s.timeseries.revenueQEnds[0]; },
  ]) {
    const input = clone(fixture.HTGC); change(input);
    const original = serial(input.timeseries.revenueQ[0]);
    const r = applyFinancialCases(input);
    assert.equal(serial(r.snapshot.timeseries.revenueQ[0]), original);
    assert.ok(r.events.some(e => e.status === 'stale'));
  }
});

test('BANPU hold is an exact three-anchor packet, not a ticker rule; raw mixed metrics are preserved', () => {
  const input = clone(fixture['BANPU.BK']);
  const result = applyFinancialCases(input).snapshot;
  assert.equal(result.meta.financialDataIssue.caseId, 'banpu-mixed-issuer-packet-20260929');
  assert.equal(serial(result.metrics), serial(input.metrics));
  assert.equal(serial(result.annual), serial(input.annual));
  const { isDataSuspect } = require('../src/scoring/score.js');
  assert.equal(isDataSuspect(result, [], 'route'), true);
  assert.equal(isDataSuspect(result, [], 'survival'), true);
  const scored = require('../src/scoring/score.js').scoreUniverse([result], require('../src/scoring/formulas/index.js'))[0];
  assert.equal(scored.score, null);
  assert.equal(scored.reason, result.meta.financialDataIssue.reason, 'Existing excluded-list consumer shows this reason verbatim');
  for (const anchor of table.quarantines[0].fingerprint) {
    const other = clone(input); const parent = anchor.path.slice(0,-1).reduce((v,k) => v[k], other);
    parent[anchor.path.at(-1)]++;
    assert.equal(applyFinancialCases(other).snapshot.meta.financialDataIssue, undefined);
  }
  const rollover = clone(input);
  for (const field of ['annualRev','annualGP']) {
    rollover.annual[field].unshift({value:null});
    rollover.annual[field+'Ends'].unshift(null);
  }
  const assertHold = fn => {
    const held = fn(rollover).snapshot;
    assert.equal(require('../src/scoring/score.js').scoreUniverse([held], require('../src/scoring/formulas/index.js'))[0].score, null);
  };
  assertHold(applyFinancialCases);
  const oldIndex = moduleCopy('lib/financial-known-cases.js', s => replaceLine(s,
    '    const matches = matchesQuarantine(snapshot, q);',
    '    const matches = q.fingerprint.every(a => a.path.reduce((v, k) => v?.[k], snapshot) === a.expected);'));
  assert.throws(() => assertHold(oldIndex.applyFinancialCases), assert.AssertionError); breaks++;
  const mismatch = clone(rollover); mismatch.annual.annualGP.unshift({value:null});
  assert.equal(applyFinancialCases(mismatch).snapshot.meta.financialDataIssue, undefined);
  const dated = clone(rollover);
  dated.annual.annualRevEnds[1] = dated.annual.annualGPEnds[1] = '2025-12-31';
  assert.ok(applyFinancialCases(dated).snapshot.meta.financialDataIssue);
  dated.annual.annualGPEnds[1] = '2024-12-31';
  assert.equal(applyFinancialCases(dated).snapshot.meta.financialDataIssue, undefined);
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

test('real native/USD producer, readers, PIT and exported visible lamp use the same overlay', () => {
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
    const row=map({ticker:'YSN.DE',lamps:[],score:50,track:'profitable'},0);
    assert.ok(row.lamps[0].startsWith('Bruttogewinn fehlt:'),'Existing lamps consumer renders reason');
  }
  const adapter=require('../lib/yahoo-q4-known-cases.js');
  const broken=moduleCopy('lib/yahoo-q4-known-cases.js',s=>s,{
    './financial-known-cases.js':{applyFinancialCases:s=>({snapshot:s,events:[]})},
  });
  const guard=fn=>assert.equal(fn(clone(fixture.HTGC)).timeseries.revenueQ[0].value,149114000);
  assert.throws(()=>guard(broken.prepareSnapshot),assert.AssertionError);guard(adapter.prepareSnapshot);breaks++;
});

for(const [file,before] of hashes) assert.equal(sha(path.join(__dirname,'..',file)),before,'Live artifact unchanged: '+file);
console.log(`financial-known-cases: ${passed} passed; ${breaks} break-once canaries fired; live hashes unchanged`);
