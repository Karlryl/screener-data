'use strict';
// PR75 round 3: unchanged 30 October source packets; all negative mutations stay in memory.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Module,createRequire}=require('node:module');
const G=require('../lib/g31-recency.js'),H=require('../lib/financial-known-cases.js'),X=require('../lib/exchange-quarter-check.js');
const {prepareSnapshot}=require('../lib/yahoo-q4-known-cases.js');
const F=require('./fixtures/g31-pr75-r3.json');
const root=path.resolve(__dirname,'..'),source=path.join(root,'lib/g31-recency.js');
const protectedFiles=['lib/g31-recency.js','configs/financial-known-cases.json'];
const hashes=()=>protectedFiles.map(f=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex'));
const beforeHashes=hashes(),snap=t=>structuredClone(F.snapshots[t]);
const value=r=>typeof r==='number'?r:r?.value??null;
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function mutant(anchor,replacement){
  const lines=fs.readFileSync(source,'utf8').split(/\r?\n/);
  assert.equal(lines.filter(l=>l===anchor).length,1,'unique whole-line anchor');
  const m=new Module(source,module);m.filename=source;m.paths=module.paths;m.require=createRequire(source);
  m._compile(lines.map(l=>l===anchor?replacement:l).join('\n'),source);return m.exports;
}
const zeroLine='    if (!(q.current > 0)) continue; // An older vendor zero/negative value cannot open the fallback path.';
function withStore(fn){const keep=X.defaultContext;X.defaultContext=()=>({stores:{cn:F.store.cn,tw:null},baseline:{rows:new Map(),date:null},warnings:[]});try{return fn();}finally{X.defaultContext=keep;}}

for(const ticker of ['MB.MI','MB.VI','MDIBF'])test(`${ticker}: older zero is skipped; removing that guard reproduces -100 percent`,()=>{
  const s=prepareSnapshot(snap(ticker)),original=JSON.stringify(s);
  const good=G.g31Shadow(s).v1;assert.equal(good.basis,'year');close(good.pct,1.4749916823777243);
  assert.equal(G.quarterCandidate(s,'revenueQ',1).pct,-100,'the general candidate contract is unchanged');
  const broken=mutant(zeroLine,'').g31Shadow(s).v1;assert.equal(broken.pct,-100);
  assert.throws(()=>assert.equal(broken.basis,'year'),assert.AssertionError);
  s.timeseries.revenueQ[1].value=-1;assert.equal(G.g31Shadow(s).v1.basis,'year');
  s.timeseries.revenueQ[1].value=0;assert.equal(JSON.stringify(s),original);
  assert.equal(G.g31Shadow(s).v1.basis,'year');
});

test('a current index-0 zero remains a valid -100 percent comparison',()=>{
  const s={meta:{ticker:'CURRENT',reportingCurrency:'USD'},timeseries:{revenueQ:[{value:0},{value:10}],revenueQEnds:['2026-06-30','2025-06-30']},annual:{annualRev:[{value:120},{value:100}],annualRevEnds:['2025-12-31','2024-12-31']}};
  assert.equal(G.quarterCandidate(s).pct,-100);assert.equal(G.g31Shadow(s).v1.pct,-100);
});

test('1KINV.MI: only the proved quarterly aliases close the false +174.28 percent path',()=>{
  const raw=snap('1KINV.MI'),out=H.applyFinancialCases(raw).snapshot;
  assert.equal(G.g31Shadow(out).v1.pct,null);assert.deepEqual(out.annual,raw.annual,'different annual vendor packet remains untouched');
  const table=structuredClone(H.table);
  for(const c of table.cases)c.listingAliases=c.listingAliases?.filter(a=>a!=='1KINV.MI');
  const broken=G.g31Shadow(H.applyFinancialCases(raw,{table}).snapshot).v1;
  close(broken.pct,174.2811501597444);assert.throws(()=>assert.equal(broken.pct,null),assert.AssertionError);
  assert.equal(G.g31Shadow(H.applyFinancialCases(raw).snapshot).v1.pct,null);
});

for(const alias of [...new Set(F.aliasAdditions.map(x=>x.alias))])test(`${alias}: all audited alias keys apply to exact real cells and fail without the alias`,()=>{
  const raw=snap(alias),out=H.applyFinancialCases(raw).snapshot,table=structuredClone(H.table);
  for(const section of ['cases','coverage','metricHolds'])for(const c of table[section]||[])c.listingAliases=c.listingAliases?.filter(a=>a!==alias);
  const old=H.applyFinancialCases(raw,{table}).snapshot;
  const cases=F.aliasAdditions.filter(x=>x.alias===alias&&x.section==='cases');let checked=0;
  for(const a of cases){
    const c=H.table.cases.find(x=>x.caseId===a.caseId);assert.ok(c.listingAliases.includes(alias));
    const box=c.field.startsWith('annual')?'annual':'timeseries',i=raw[box][c.field+'Ends'].indexOf(c.period);
    if(i<0){
      assert.equal(a.present,false);
      const restored=structuredClone(raw),at=restored[box][c.field].length;
      const vendor=c.expectedBadValue*(raw.meta.fxConverted?raw.meta.fxRateApplied:1);
      restored[box][c.field].push({value:vendor});restored[box][c.field+'Ends'].push(c.period);
      const check=cfg=>{
        const expected=c.replacementValue===null?null:c.replacementValue*(raw.meta.fxConverted?raw.meta.fxRateApplied:1);
        assert.equal(value(H.applyFinancialCases(restored,{table:cfg}).snapshot[box][c.field][at]),expected);
      };
      check(H.table);
      if(c.replacementValue===null||c.replacementValue!==c.expectedBadValue){
        assert.throws(()=>check(table),assert.AssertionError);check(H.table);checked++;
      }else{
        // An unchanged confirmation has no numeric effect; test its authority separately.
        check(table);
        const authority=cfg=>assert.ok(cfg.cases.find(x=>x.caseId===c.caseId).listingAliases.includes(alias));
        authority(H.table);assert.throws(()=>authority(table),assert.AssertionError);authority(H.table);
      }
      continue;
    }
    const expected=c.replacementValue===null?null:c.replacementValue*(raw.meta.fxConverted?raw.meta.fxRateApplied:1);
    assert.equal(value(out[box][c.field][i]),expected,c.caseId);
    if(c.replacementValue===null||c.replacementValue!==c.expectedBadValue) assert.equal(out[box][c.field][i].financialCorrection.caseId,c.caseId);
    else assert.deepEqual(out[box][c.field][i],raw[box][c.field][i],'a confirmed unchanged cell needs no correction marker');
    if(c.replacementValue===null||c.replacementValue!==c.expectedBadValue){assert.throws(()=>assert.equal(value(old[box][c.field][i]),expected),assert.AssertionError);checked++;}
  }
  for(const a of F.aliasAdditions.filter(x=>x.alias===alias&&x.section==='coverage')){
    const c=H.table.coverage.find(x=>x.ticker===a.ticker&&x.field===a.field);assert.ok(c.listingAliases.includes(alias));
    const next=structuredClone(raw);
    next.timeseries[c.field].unshift({value:123456789});next.timeseries[c.field+'Ends'].unshift('2026-09-30');
    const check=cfg=>assert.equal(H.applyFinancialCases(next,{table:cfg}).snapshot.timeseries[c.field][0].financialMissing?.reasonCode,'period-after-coverage');
    check(H.table);assert.throws(()=>check(table),assert.AssertionError);check(H.table);checked++;
  }
  if(alias==='1IONQ.MI'){
    assert.equal(value(out.metrics.ebitdaMargins),null);assert.equal(value(old.metrics.ebitdaMargins),0);
    assert.throws(()=>assert.equal(value(old.metrics.ebitdaMargins),null),assert.AssertionError);checked++;
  }
  assert.ok(checked>0,'at least one real wrong value was removed, with a failing absence proof');
  assert.deepEqual(H.applyFinancialCases(out).snapshot,out,'idempotent');assert.deepEqual(snap(alias),raw,'fixture unchanged');
});

test('Healthgen keeps Q1 growth and bonus but labels the newer stored Q2 comparison gap',()=>withStore(()=>{
  const s=prepareSnapshot(snap('688765.SS')),leg=G.g31Shadow(s).v1;
  close(leg.pct,132.39157760203946);assert.equal(leg.sourcePeriodEnd,'2026-03-31');assert.equal(leg.sourcePriorPeriodEnd,'2025-03-31');assert.equal(leg.reason,null);
  const hint=G.g31Hinweis(s);assert.equal(hint.code,'aelteres-quartalspaar');assert.match(hint.reason,/ältere.*31\.03\.2026/);assert.match(hint.reason,/neuere.*30\.06\.2026.*kein gültiger Vorjahresvergleich/);
  const broken=mutant("  const newestEnd = iso(periodEnds(s, 'revenueQ')[0]);",'  const newestEnd = null;');
  assert.equal(broken.g31Hinweis(s),null);assert.throws(()=>assert.ok(broken.g31Hinweis(s)),assert.AssertionError);
  assert.deepEqual(broken.g31Shadow(s).v1,leg,'label does not change any numeric input, source period or bonus');
  assert.deepEqual(G.g31Shadow(s).v1,leg);assert.ok(G.g31Hinweis(s));
  // Supplying the missing Q2 partner makes Q2 the selected current pair; the old-pair hint disappears.
  const filled=structuredClone(s);filled.timeseries.revenueQ.push({value:8570000*s.meta.fxRateApplied});filled.timeseries.revenueQEnds.push('2025-06-30');
  assert.equal(G.g31Shadow(filled).v1.sourcePeriodEnd,'2026-06-30');assert.equal(G.g31Hinweis(filled)?.code==='aelteres-quartalspaar',false);
  for(const change of [x=>{x.timeseries.revenueQ[0]=null;},x=>{x.timeseries.revenueQEnds[0]=null;}]){const absent=structuredClone(s);change(absent);assert.equal(G.g31Hinweis(absent)?.code==='aelteres-quartalspaar',false);}
  const newerYear=structuredClone(s);newerYear.annual.annualRevEnds=['2026-06-30','2025-06-30'];newerYear.annual.annualRev=[s.annual.annualRev[0],null];
  assert.equal(G.g31Shadow(newerYear).v1.pct,null);assert.match(G.g31Shadow(newerYear).v1.reason,/Geschäftsjahresende/);
}));

test('checked source hint remains intact when the recency message is appended',()=>{
  const C=require('./fixtures/g31-older-quarter-pair.json'),s=structuredClone(C.snapshots['603991.SS']),keep=X.defaultContext;
  X.defaultContext=()=>({stores:{cn:C.store.cn,tw:null},baseline:{rows:new Map(),date:null},warnings:[]});
  try{const checked=require('../configs/g31-hinweise.json').entries.find(e=>e.ticker==='603991.SS'&&e.periodEnd==='2026-06-30');const hint=G.g31Hinweis(s);assert.equal(hint.code,checked.code);assert.ok(hint.reason.startsWith(checked.reason+' '));assert.match(hint.reason,/30\.09\.2026/);}finally{X.defaultContext=keep;}
});

test('all negative probes leave production files byte-identical',()=>assert.deepEqual(hashes(),beforeHashes));
