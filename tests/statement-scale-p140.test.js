'use strict';

const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { Module } = require('node:module');
let lib = require('../lib/financial-known-cases.js');
const axes = require('../src/scoring/axes.js');
const { FIELD_REGISTRY } = require('../src/scoring/snapshot.js');
const clone = structuredClone, value = x => typeof x === 'number' ? x : x?.value;
const root = path.resolve(__dirname, '..'), file = path.join(root, 'lib/financial-known-cases.js');
const fixtureFile = path.join(__dirname, 'fixtures/p140-indomim-ns-20261006.json');
// Byte copy of P129/roh-20261006/INDOMIM.NS.json, frozen on 2026-10-06.
const fixtureSha = '3a83255930cf2c69433602ffbf83925194ab7b917a26bc2b15e2b61b3056a7cc';
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const liveFiles = [file, path.join(root, 'configs/financial-known-cases.json'), fixtureFile];
const hashes = liveFiles.map(sha);
const raw = JSON.parse(fs.readFileSync(fixtureFile, 'utf8')), fx = raw.meta.fxRateApplied;
const rule = lib.table.statementScales[0], cases = lib.table.cases.filter(c => c.ticker === 'INDOMIM.BO');
const anchors = rule.anchors.map(a => {
  const c = cases.find(c => c.caseId === a.caseId);
  return c ? { ...a, expectedBadValue: c.expectedBadValue, provenValue: c.replacementValue } : a;
});
const ends = (s, f) => s.annual[f + 'Ends'] ?? (f === 'annualCostOfRevenue' ? s.annual.annualRevEnds : []);
const ulp = n => n === 0 ? Number.MIN_VALUE : 2 ** (Math.floor(Math.log2(Math.abs(n))) - 52);
function close(a, b, label) { assert.ok(Number.isFinite(a) && Math.abs(a - b) <= ulp(b), label + ': ' + a + ' != ' + b); }
function cells(s) {
  return rule.scale.flatMap(field => (s.annual[field] || []).flatMap((row, index) =>
    (field === 'annualBalance' ? rule.balance.keys : [null]).map(key => ({ field, key, index, period: ends(s, field)[index],
      value: key ? row?.[key] : value(row) }))));
}
function sameOnReread(apply, first) {
  const before = JSON.stringify(first.snapshot);
  assert.equal(JSON.stringify(apply(first.snapshot).snapshot), before, 'idempotent snapshot');
}
const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
check('all 83 monetary cells scale with exact anchors and scalar shapes', apply => {
  assert.equal(sha(fixtureFile), fixtureSha);
  assert.equal(cases.length, 4); assert.equal(anchors.length, 18);
  assert.ok(cases.every(c => c.field === 'annualRev' && c.revision === rule.revision));
  for (const ticker of ['INDOMIM.NS', 'INDOMIM.BO']) {
    const input = clone(raw); input.meta.ticker = ticker; input.meta.exchangeName = ticker.endsWith('.BO') ? 'BSE' : 'NSE';
    const saved = clone(input), result = apply(input), out = result.snapshot;
    assert.deepEqual(input, saved, 'input is immutable');
    let populated = 0;
    for (const c of cells(input)) {
      const row = out.annual[c.field][c.index], actual = c.key ? row[c.key] : value(row);
      if (c.value == null) { assert.equal(actual, c.value); continue; }
      populated++;
      const anchor = anchors.find(a => a.line === c.field && (a.key || null) === c.key && a.period === c.period);
      if (anchor) assert.equal(actual, anchor.provenValue * fx, c.field + ': exact printed anchor');
      else close(actual, c.value * 10, c.field);
      assert.notEqual(actual, 0);
      if (typeof input.annual[c.field][c.index] === 'number') assert.equal(typeof row, 'number', 'scalar stays scalar');
      const event = result.events.filter(e => e.field === c.field && (e.key || null) === c.key && e.index === c.index);
      assert.equal(event.length, 1, 'one event per cell'); assert.equal(event[0].status, 'corrected');
      assert.equal(event[0].container, 'annual'); assert.equal(event[0].oldValue, c.value); assert.equal(event[0].newValue, actual);
      if (c.field !== 'annualRev') { assert.equal(event[0].reasonCode, 'statement-scale'); assert.equal(event[0].reason, rule.reason); }
      if (c.field !== 'annualRev' && typeof row === 'object') {
        assert.equal(row.financialCorrection.caseId, rule.caseId);
        assert.deepEqual(row.financialCorrection.originalVendorRow, input.annual[c.field][c.index]);
        assert.equal(row.financialCorrection.revision, rule.revision);
        assert.ok(row.financialCorrection.sources.length >= 18);
      }
    }
    assert.equal(populated, 83); assert.equal(result.events.length, 83);
    const again = apply(out); assert.deepEqual(again.snapshot, out); assert.deepEqual(again.events, []);
    assert.equal(lib.financialReasons(out).filter(r => r === rule.reason).length, 1);
    for (const field of Object.keys(input.annual).filter(f => f.endsWith('Ends'))) assert.deepEqual(out.annual[field], input.annual[field]);
    for (const field of Object.keys(input).filter(f => !['annual', 'meta'].includes(f))) assert.deepEqual(out[field], input[field]);
    const { financialStatementScale, ...meta } = out.meta; assert.deepEqual(meta, input.meta);
    assert.equal(financialStatementScale.basis, 'five independently proven lines');
  }
});
const axisNames = ['gpGrowth','marginLevel','dilution','capitalEfficiency','ruleOfX','revGrowthLevel','revAcceleration'];
check('seven axes retain the uniformly scaled annual ratios', apply => {
  const out = apply(clone(raw)).snapshot;
  for (const name of axisNames) {
    const before = axes[name](raw), after = axes[name](out);
    assert.notEqual(before, null, name + ' fixture must exercise the axis');
    assert.ok(Math.abs(after - before) <= Math.abs(before) * 1e-9, name + ': ' + before + ' != ' + after);
  }
});
check('share counts per-share ratios dates flags gaps and genuine zeros stay unchanged', apply => {
  const input = clone(raw);
  for (const f of ['annualShares','annualSharesBasic','annualEarningsPerShare','annualGrossMargin']) {
    input.annual[f] = [100, 99, null, 0]; input.annual[f + 'Ends'] = clone(input.annual.annualRevEnds);
  }
  input.annual.annualBalance[0]._debtPartial = true;
  input.annual.annualBalance[0]._debtPartialReason = 'Synthetic flag.';
  input.annual.annualCapex[0] = 0;
  input.annual.annualGP[1] = { value: null, flag: true };
  const out = apply(input).snapshot;
  for (const f of ['annualShares','annualSharesBasic','annualEarningsPerShare','annualGrossMargin']) assert.deepEqual(out.annual[f], input.annual[f]);
  assert.equal(out.annual.annualBalance[0]._debtPartial, true);
  assert.equal(out.annual.annualBalance[0]._debtPartialReason, 'Synthetic flag.');
  assert.equal(out.annual.annualCapex[0], 0); assert.deepEqual(out.annual.annualGP[1], input.annual.annualGP[1]);
  assert.equal(out.annual.annualRnD[0], null);
  close(value(out.annual.annualOpInc[0]), value(input.annual.annualOpInc[0]) * 10, 'monetary field still scales');
});
check('unclassified annual array is withheld with a visible reason', apply => {
  const input = clone(raw); input.annual.annualNewMoney = [123, null];
  input.annual.annualNewMoneyEnds = ['2026-03-31','2025-03-31'];
  const r = apply(input), row = r.snapshot.annual.annualNewMoney[0];
  assert.equal(value(row), null); assert.equal(row.financialMissing.reasonCode, 'statement-scale-unclassified');
  assert.equal(row.financialMissing.originalVendorRow, 123); assert.equal(r.snapshot.annual.annualNewMoney[1], null);
  assert.ok(r.events.some(e => e.field === 'annualNewMoney' && e.status === 'stale')); sameOnReread(apply, r);
});
for (const [name, edit] of [
  ['vendor fixes all anchors without a marker', s => { for (const c of cells(s)) if (c.value != null) {
    const row=s.annual[c.field][c.index]; if(c.key) row[c.key]*=10; else if(typeof row==='number') s.annual[c.field][c.index]*=10; else row.value*=10;
  } }],
  ['one anchor drifts', s => { s.annual.annualNetIncome[0].value++; }],
  ['mixed anchor scales', s => { s.annual.annualNetIncome[0].value=anchors.find(a=>a.line==='annualNetIncome').provenValue*fx; }],
  ['new fiscal year in front', s => { s.annual.annualOpInc.unshift({value:111}); s.annual.annualOpIncEnds.unshift('2027-03-31'); }],
  ['anchor line missing', s => { delete s.annual.annualSBC; }],
  ['wrong currency', s => { s.meta.reportingCurrencyOriginal='EUR'; }],
  ['unusable envelope', s => { s.meta.fxConversionFailed=true; }],
  ['missing FX factor', s => { delete s.meta.fxRateApplied; }],
  ['foreign source', s => { s.meta.source='SEC'; }],
  ['anchor row currency mismatch', s => { s.annual.annualNetIncome.forEach(row=>{row.currency='INR';}); }],
  ['anchor row duration mismatch', s => { s.annual.annualNetIncome.forEach(row=>{row.periodType='3M';}); }],
  ['new unproven anchor year', s => { s.annual.annualSBC[2]=123; }],
]) check('fail closed: ' + name, apply => {
  const input = clone(raw); edit(input); const saved = clone(input), result = apply(input);
  for (const c of cells(input).filter(c => c.field !== 'annualRev' && c.value != null && c.value !== 0)) {
    const row = result.snapshot.annual[c.field][c.index]; assert.equal(c.key ? row[c.key] : value(row), null, c.field);
    assert.equal(row.financialMissing.caseId, rule.caseId); assert.equal(row.financialMissing.revision, rule.revision);
    assert.equal(row.financialMissing.reasonCode, 'statement-scale-changed');
  }
  assert.ok(result.events.some(e => e.status === 'stale' && e.reasonCode === 'statement-scale-changed'));
  assert.deepEqual(input, saved); sameOnReread(apply, result);
});
check('older undated and duplicate-period cells are withheld without filling gaps', apply => {
  for (const period of ['2022-03-31', undefined, '2026-03-31']) {
    const input = clone(raw); input.annual.annualCapex.push(-123);
    if (period !== undefined) input.annual.annualCapexEnds.push(period);
    const r = apply(input), row = r.snapshot.annual.annualCapex.at(-1);
    assert.equal(value(row), null); assert.equal(row.financialMissing.originalVendorRow, -123);
    assert.equal(row.financialMissing.reasonCode, 'statement-scale-changed'); sameOnReread(apply, r);
  }
  for (const malformed of [null, {}, {0:'2026-03-31'}]) {
    const input=clone(raw); input.annual.annualOpIncEnds=malformed;
    const r=apply(input); assert.ok(r.snapshot.annual.annualOpInc.every(row=>value(row)===null)); sameOnReread(apply,r);
  }
});
check('a drift after correction drops the stale statement reason and stays withheld', apply => {
  const input=apply(clone(raw)).snapshot; input.annual.annualNetIncome[0].value++;
  const r=apply(input);
  assert.equal(r.snapshot.meta.financialStatementScale,undefined);
  assert.equal(value(r.snapshot.annual.annualGP[0]),null);
  assert.ok(!lib.financialReasons(r.snapshot).includes(rule.reason)); sameOnReread(apply,r);
});
check('annual revenue provenance names the four hand-table cases', apply => {
  const out = apply(clone(raw)).snapshot;
  const { captureSnapshot } = require('../lib/export-provenance.js');
  for (let i=0;i<3;i++) {
    const s = clone(out); s.timeseries = {}; s.annual.annualRev=s.annual.annualRev.slice(i); s.annual.annualRevEnds=s.annual.annualRevEnds.slice(i);
    const inputs=captureSnapshot(s).inputs;
    assert.equal(inputs.length,2);
    assert.deepEqual(inputs.map(x=>x.sourceType),['handTable','handTable']);
    assert.deepEqual(inputs.map(x=>x.correctionCaseId),cases.slice(i,i+2).map(c=>c.caseId));
  }
});
check('native pull then actual FX conversion then read preserves values and provenance', apply => {
  const input = { meta: clone(raw.meta), annual: clone(raw.annual) };
  input.meta.reportingCurrency = 'INR'; input.meta.fxConverted = false;
  for (const c of cells(input)) if (c.value != null) {
    const row=input.annual[c.field][c.index];
    if(c.key) row[c.key]/=fx; else if(typeof row==='number') input.annual[c.field][c.index]/=fx; else row.value/=fx;
  }
  // Inverse floating-point division is not exact. Restore only independently proven native anchors.
  for (const a of anchors) {
    const i=ends(input,a.line).indexOf(a.period), row=input.annual[a.line][i];
    const stored=a.key?raw.annual[a.line][i][a.key]:value(raw.annual[a.line][i]);
    assert.equal(a.expectedBadValue*fx,stored,'proven native input roundtrips exactly');
    if(a.key) row[a.key]=a.expectedBadValue; else if(typeof row==='number') input.annual[a.line][i]=a.expectedBadValue; else row.value=a.expectedBadValue;
  }
  const source=fs.readFileSync(path.join(root,'pull-yahoo.js'),'utf8');
  const extract=name=>{
    const start=source.indexOf('function '+name+'('); assert.ok(start>=0);
    const end=source.indexOf('\n}',start); assert.ok(end>start); return source.slice(start,end+2);
  };
  const stmt=require('../lib/statement-currency-hand-table.js');
  // Execute the real converter without importing the network client's startup code.
  const convert=Function('yahooQ4','statementFactor','STATEMENT_CCY_TABLE','FX_TO_USD','FX_SOURCE',
    'const FX_PROVENANCE={INR:"live"}, FX_PROVENANCE_HARDCODED="fallback-hardcoded", FX_MARKER_HARDCODED="hardcoded-fallback";\n'+
    ['_isValidFxRate','_statementFactor','_skaliereHandelsMetriken','_convertSnapshotToUSD'].map(extract).join('\n')+'\nreturn _convertSnapshotToUSD;')(
      require('../lib/yahoo-q4-known-cases.js'),stmt.statementFactor,stmt.loadStatementCurrencyTable(),{INR:fx},raw.meta.fxRateSourceReporting);
  const native=apply(input).snapshot;
  assert.equal(value(native.annual.annualRev[0]),cases[0].replacementValue);
  assert.equal(native.meta.financialStatementScale?.caseId,rule.caseId);
  const converted=convert(clone(native)), reread=apply(converted), direct=apply({meta:clone(raw.meta),annual:clone(raw.annual)}).snapshot;
  assert.deepEqual(reread.events,[]); assert.deepEqual(reread.snapshot,converted,'read pass does not rescale after FX');
  assert.deepEqual(reread.snapshot.meta,direct.meta,'persisted statement marker survives the real pull converter');
  for(const c of cells(direct)) {
    const row=reread.snapshot.annual[c.field][c.index], actual=c.key?row[c.key]:value(row);
    if(c.value==null) assert.equal(actual,c.value); else close(actual,c.value,c.field+' pull/read');
  }
  // Audit origins intentionally retain each path's actual input currency, as the existing P50 path does.
  assert.deepEqual(direct.annual.annualRev[0].financialCorrection.originalVendorRow,raw.annual.annualRev[0]);
  assert.deepEqual(reread.snapshot.annual.annualRev[0].financialCorrection.originalVendorRow,input.annual.annualRev[0]);
  assert.notDeepEqual(reread.snapshot.annual.annualRev[0].financialCorrection.originalVendorRow,direct.annual.annualRev[0].financialCorrection.originalVendorRow);
  for(const s of [reread.snapshot,direct]) {
    const proof=require('../lib/export-provenance.js').captureSnapshot({...s,timeseries:{}}).inputs;
    assert.deepEqual(proof.map(x=>x.correctionCaseId),cases.slice(0,2).map(c=>c.caseId));
    assert.ok(proof.every(x=>x.sourceType==='handTable'));
  }
});
function moduleCopy(transform) {
  const m = new Module(file, module); m.filename = file; m.paths = module.paths;
  m._compile(transform(fs.readFileSync(file, 'utf8')), file); return m.exports;
}
function replaceLine(source, oldLine, newLine) {
  const lines = source.split(/\r?\n/); assert.equal(lines.filter(l => l === oldLine).length, 1, 'whole-line anchor');
  return lines.map(l => l === oldLine ? newLine : l).join('\n');
}
let passed = 0, failed = 0, breaks = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch(e) { failed++; console.error('FAIL ' + name + ': ' + e.stack); }
}
// CLI red proof still changes only a module copy in memory.
if (process.env.P140_DISABLE_STAGE === '1') lib = moduleCopy(s => replaceLine(s,
  '  for (const rule of config.statementScales || []) {', '  for (const rule of []) {'));
for (const c of checks) test(c.name, () => c.fn(lib.applyFinancialCases));
test('registry classify-or-fail includes every annual consumer field', () => {
  const classify = registry => { for (const [f, spec] of Object.entries(registry)) if (spec[0] === 'annual')
    assert.ok(rule.scale.includes(f) || rule.exempt.includes(f), 'Unclassified annual field: ' + f); };
  classify(FIELD_REGISTRY);
  assert.throws(() => classify({...FIELD_REGISTRY, annualFutureMoney:['annual','value']}), /Unclassified/); breaks++;
});
test('optional statementScales and every invalid authority are validated', () => {
  const without=clone(lib.table); delete without.statementScales; assert.equal(lib.validateTable(without),without);
  assert.equal(lib.validateTable(lib.table),lib.table);
  const bad = [
    c=>{c.statementScales={};}, c=>{c.statementScales[0].anchors=c.statementScales[0].anchors.filter(a=>a.line!=='annualSBC');},
    c=>{c.statementScales[0].anchors[4].provenValue++;}, c=>{c.statementScales[0].anchors[4].sources=[];},
    c=>{c.statementScales[0].caseId=c.cases[0].caseId;}, c=>{c.statementScales.push(clone(c.statementScales[0]));},
    c=>{c.statementScales[0].listingAliases=['8570.T'];}, c=>{c.cases[0].listingAliases=['INDOMIM.BO'];},
    c=>{c.statementScales[0].listingAliases.push('INDOMIM.NS');},
    c=>{c.statementScales[0].scale.push('annualRev');}, c=>{c.statementScales[0].exempt.push('annualShares');},
    c=>{c.statementScales[0].balance.keys.push('totalCash');}, c=>{c.statementScales[0].exempt.push('annualGP');},
    c=>{c.statementScales[0].anchors.push(clone(c.statementScales[0].anchors[0]));},
    c=>{c.statementScales[0].anchors[0].caseId='missing-case';},
    c=>{c.statementScales[0].listingAliases.push('YSNG.VI'); c.cases.filter(x=>x.ticker==='INDOMIM.BO').forEach(x=>x.listingAliases.push('YSNG.VI'));},
    c=>{c.statementScales[0].anchors[4].expectedBadValue=0; c.statementScales[0].anchors[4].provenValue=0; c.statementScales[0].anchors[4].sources[0].value=0;},
    ...['annualShares','annualSharesBasic','annualEPS','annualEarningsPerShare','annualGrossMargin','annualRevEnds','annualFlag'].map(f=>c=>{c.statementScales[0].scale.push(f);}),
    ...[0,1,-1,Infinity,NaN,'10'].map(factor=>c=>{c.statementScales[0].factor=factor;}),
    ...[['url','http://example.invalid/report'],['page',null],['quote',''],['value',123],['unit','million'],['currency','USD'],
      ['start','2025-04-02'],['end','2026-03-30'],['start','2025-02-30']].map(([k,v])=>c=>{c.statementScales[0].anchors[4].sources[0][k]=v;}),
  ];
  for (const [i,edit] of bad.entries()) { const c=clone(lib.table); edit(c); assert.throws(()=>lib.validateTable(c), Error, 'negative '+i); }
  console.log('validation negatives: '+bad.length);
});
test('V-B1c-1 omitted vendor year keeps newer years and withholds older years', () => {
  const {fixture,fixtureTable}=require('./annual-financial-replacements.test.js');
  const table=fixtureTable();
  const guard = apply => {
    for (const index of [1,2]) {
      const input=fixture(); input.annual.annualRev.splice(index,1); input.annual.annualRevEnds.splice(index,1);
      const r=apply(input,{table}), rows=r.snapshot.annual.annualRev;
      assert.ok(rows.slice(0,index).every(r=>value(r)>0));
      assert.ok(rows.slice(index).every(r=>value(r)===null && r.financialMissing.reasonCode==='annual-older-than-withheld'));
      assert.equal(axes.revAcceleration(r.snapshot),null);
      assert.deepEqual(apply(r.snapshot,{table}).snapshot,r.snapshot);
    }
  };
  guard(lib.applyFinancialCases);
  const broken=moduleCopy(s=>replaceLine(s,'    if (gap) for (const { j, p } of dated) {','    if (false) for (const { j, p } of dated) {'));
  assert.throws(()=>guard(broken.applyFinancialCases),assert.AssertionError); breaks++;
  console.log('RED without lock extension: V-B1c-1 omitted vendor year');
});
test('break-once state factor exemption period guards and disabled stage', () => {
  for (const [line, replacement, name] of [
    ['    const canScale = unscaled && !marked;', '    const canScale = true;', 'fail closed: one anchor drifts'],
    ['          const replacement = a ? a.provenValue * env?.factor : oldValue * rule.factor;',
      '          const replacement = a ? a.provenValue : oldValue * rule.factor;', 'all 83 monetary cells scale with exact anchors and scalar shapes'],
    ["      if (!Array.isArray(rows) || field.endsWith('Ends') || rule.exempt.includes(field) || numericFields.has(field)) continue;",
      "      if (!Array.isArray(rows) || field.endsWith('Ends') || numericFields.has(field)) continue;", 'share counts per-share ratios dates flags gaps and genuine zeros stay unchanged'],
    ['        const periodOk = periods.includes(period) && ends.indexOf(period) === ends.lastIndexOf(period);',
      '        const periodOk = true;', 'older undated and duplicate-period cells are withheld without filling gaps'],
  ]) {
    const broken=moduleCopy(s=>{
      let changed=replaceLine(s,line,replacement);
      if(name.startsWith('share counts')) changed=replaceLine(changed,
        '      const classified = rule.scale.includes(field);', '      const classified = true;');
      return changed;
    });
    assert.throws(()=>checks.find(c=>c.name===name).fn(broken.applyFinancialCases),assert.AssertionError); breaks++;
    console.log('RED mutation: '+name);
  }
  const disabled=moduleCopy(s=>replaceLine(s,'  for (const rule of config.statementScales || []) {','  for (const rule of []) {'));
  const reds=[];
  for (const c of checks) { try { c.fn(disabled.applyFinancialCases); } catch(e) { assert.ok(e instanceof assert.AssertionError); reds.push(c.name); } }
  assert.ok(reds.includes(checks[0].name)); assert.ok(reds.includes(checks[1].name)); assert.ok(reds.length>=12);
  breaks+=reds.length; console.log('RED without stage:\n'+reds.map(n=>'  '+n).join('\n'));
});
const corrected=lib.applyFinancialCases(clone(raw)).snapshot;
console.log('AXES '+axisNames.join(' | '));
for (const [label,s] of [['raw',raw],['corrected',corrected]]) console.log(label+' '+axisNames.map(n=>axes[n](s)?.toPrecision(12) ?? 'null').join(' | '));
console.log('ABSOLUTE field | vendor INR | corrected INR | printed INR million | corrected USD');
for (const a of anchors.filter(a=>a.period==='2026-03-31')) {
  const v=a.key?corrected.annual[a.line][0][a.key]:value(corrected.annual[a.line][0]);
  console.log([a.line+(a.key?'.'+a.key:''),a.expectedBadValue,a.provenValue,a.provenValue/1e6,v].join(' | '));
}
test('all memory probes preserve live hashes',()=>assert.deepEqual(liveFiles.map(sha),hashes));
console.log(`statement-scale-p140: ${passed} passed; ${failed} failed; ${breaks} red probes caught`);
if(failed) process.exitCode=1;
