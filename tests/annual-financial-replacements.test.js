'use strict';

// Break-once probes use only memory objects, never a writing test or a live data file.
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { applyFinancialCases, validateTable, table, MISSING_REASONS } = require('../lib/financial-known-cases.js');
const axes = require('../src/scoring/axes.js');
const { norm } = require('../src/scoring/snapshot.js');
const value = x => typeof x === 'number' ? x : x?.value;
const clone = structuredClone;
const files = ['lib/financial-known-cases.js', 'configs/financial-known-cases.json'];
const hashes = () => files.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', f))).digest('hex'));
const beforeHashes = hashes();
const cases = table.cases.filter(c => c.ticker === 'INDOMIM.BO' && c.field === 'annualRev');
const expected = [41410560000, 32784690000, 28404910000, 26653210000];
const fx = 0.010384216;
// Embedded USD annual rows from P129/roh-20261006/INDOMIM.BO.json, SHA256
// 43b74a6e0f5c938d92e11ff0485fd106744ea1b8d9fb196b29a2b308cf7d5729.
// INDOMIM.NS.json has identical annual rows, SHA256
// 3a83255930cf2c69433602ffbf83925194ab7b917a26bc2b15e2b61b3056a7cc.
// Tests never open either external file. Both lack annualShares/annualSharesBasic;
// the share-count sentinels below are synthetic, solely to test the explicit exception.
const storedValues = {
  annualRev: [43001619.972095996, 34044330.245304, 29496272.090056, 27677268.973336],
  annualOpInc: [8835503.641544, 7619813.090208, 5909636.557168, 6590944.968928],
  annualNetIncome: [5540425.757288, 4400145.382544, 2946355.142544, 4804704.053688],
  annualGP: [25008670.84036, 20760539.995839998, 17286510.917256, 16568255.464968],
  annualFCF: [6853333.338816, 1350623.05404, 854454.829344, 2124620.977816],
  annualOCF: [11186303.228056, 5257227.418536, 4759439.256144, 6289875.39444],
  annualCostOfRevenue: [17992949.131736, 13283790.249464, 12209761.1728, 11109013.508368],
};
const storedScalars = {
  annualRnD: [null, null, null, null],
  annualSBC: [150726.89524, 59802.699944, null, null],
  annualCapex: [-4332969.88924, -3906604.364496, -3904984.4268, -4165254.416624],
  annualSGA: [2571484.944944, 2643322.951232, 2280280.375656, 2131028.039088],
  annualDepreciation: [2285192.109824, 2064475.598744, 1810633.438624, 1567892.005408],
  annualDividendsPaid: [null, -2958255.45408, -3879273.107984, -1356448.599216],
  annualNetCommonStockIssuance: [2201.453792, null, 1102471.444288, null],
};
const storedBalance = [
  { totalCash:4045295.953392, totalDebt:11323862.937408, totalAssets:50854963.695928, accountsReceivable:7931329.185992, netPPE:22987019.7484, currentAssets:25668899.29364, currentLiabilities:12278359.303696, totalLiabilities:21576105.936264, totalEquity:29278857.759664 },
  { totalCash:1813281.413704, totalDebt:12951142.27412, totalAssets:42999387.365656, accountsReceivable:6685565.94512, netPPE:19388141.240848, currentAssets:22092336.466272, currentLiabilities:12862533.758992, totalLiabilities:20159989.631912, totalEquity:22839397.733744 },
  { totalCash:2418037.385112, totalDebt:11266998.970592, totalAssets:39018826.614808, accountsReceivable:5755379.028488, netPPE:18563478.727208, currentAssets:18976469.381744, currentLiabilities:9279771.554671999, totalLiabilities:17725877.480432, totalEquity:21292949.134376 },
  { totalCash:3441879.545848, totalDebt:8389491.180128, totalAssets:35103281.440336, accountsReceivable:5251256.494336, netPPE:16576697.832576, currentAssets:17444579.453208, currentLiabilities:7004070.618272, totalLiabilities:14339387.342728, totalEquity:20763894.097608 },
];
/** Build the embedded issuer fixture, with synthetic share-count controls.
 * @param {string} ticker Either verified listing.
 * @param {number} factor One for native INR, or the frozen USD FX rate.
 * @returns {object} Independent snapshot with every frozen annual currency series.
 */
function fixture(ticker = 'INDOMIM.BO', factor = fx) {
  const convert = n => n === null || factor === fx ? n : Math.round(n / fx);
  const ends = ['2026-03-31', '2025-03-31', '2024-03-31', '2023-03-31'];
  const annual = Object.fromEntries(Object.entries(storedValues).map(([f, rows]) => [f, rows.map(n => ({ value: convert(n) }))]));
  for (const [f, rows] of Object.entries(storedScalars)) annual[f] = rows.map(convert);
  annual.annualBalance = storedBalance.map(row => Object.fromEntries(Object.entries(row).map(([k, n]) => [k, convert(n)])));
  for (const field of Object.keys(annual)) if (field !== 'annualCostOfRevenue') annual[field + 'Ends'] = ends.slice();
  annual.annualRepurchaseEnds = [];
  annual.annualSharesEnds = [];
  annual.annualShares = [101, 100, 99, 98];
  annual.annualSharesBasic = [100, 99, 98, 97];
  return { meta: { ticker, source: 'yahoo', reportingCurrency: factor === 1 ? 'INR' : 'USD',
    reportingCurrencyOriginal: 'INR', fxConverted: factor !== 1, fxRateApplied: factor, opIncSource: 'yahoo-adjusted' },
    annual, timeseries: { revenueQ:[], opIncQ:[], grossProfitQ:[], netIncomeQ:[], revenueQEnds:[], grossProfitQEnds:[], opIncQEnds:[] },
    metrics: { fcfMarginTTM:null } };
}
let passed = 0, breaks = 0;
function test(name, fn) { fn(); passed++; console.log('ok ' + name); }
function guard(snapshot, factor = fx) {
  assert.deepEqual(snapshot.annual.annualRev.map(value), expected.map(n => n * factor), 'vendor values must never return');
}
function statementGuard(snapshot, factor = fx) {
  guard(snapshot, factor);
  for (const [field, rows] of Object.entries(snapshot.annual)) {
    if (!Array.isArray(rows) || /Ends$/.test(field) || ['annualShares', 'annualSharesBasic'].includes(field)) continue;
    for (const [i, row] of rows.entries()) {
      if (row?.financialCorrection && Number.isFinite(row.financialCorrection.replacementNativeValue)) {
        const c = table.cases.find(c => c.caseId === row.financialCorrection.caseId);
        assert.ok(c && c.field === field && c.period === snapshot.annual[field + 'Ends'][i]);
        assert.equal(value(row), c.replacementValue * factor);
        assert.deepEqual(row.financialCorrection.sources, c.sources);
      } else {
        assert.equal(value(row), null, field + '/' + i + ': no vendor value');
        assert.equal(row.financialMissing?.reasonCode, 'annual-statement-scale');
        assert.equal(row.financialMissing.reason, MISSING_REASONS['annual-statement-scale']);
        const period = snapshot.annual[field + 'Ends']?.[i] ?? snapshot.meta.statementPeriods?.[field]?.[i]?.end ?? null;
        const c = cases.find(c => c.period === period) || cases[0];
        assert.equal(row.financialMissing.caseId, c.caseId);
        assert.equal(row.financialMissing.period, period);
        assert.equal(row.financialMissing.revision, c.revision);
        if (field === 'annualBalance') assert.ok(!Object.values(row).some(Number.isFinite));
      }
    }
  }
}
if (require.main === module) {
test('four exact, sourced annual cases with both listings and no annual coverage', () => {
  assert.equal(cases.length, 4);
  assert.deepEqual(cases.map(c => c.replacementValue), expected);
  assert.deepEqual(cases.map(c => c.expectedBadValue), expected.map(n => n / 10));
  for (const [i,c] of cases.entries()) {
    assert.equal(c.period, fixture().annual.annualRevEnds[i]);
    assert.equal(c.unit, 'currency'); assert.equal(c.currency, 'INR');
    assert.equal(c.sources[0].page, i < 2 ? 253 : 284);
    assert.equal(c.sources[0].value, expected[i]); assert.equal(c.sources[0].end, c.period);
    assert.deepEqual(c.listingAliases, ['INDOMIM.NS']);
    assert.equal(c.vendorScale, 'whole-annual-statement');
  }
  assert.ok(!table.coverage.some(c => c.ticker === 'INDOMIM.BO'));
});
test('native and USD-converted inputs, both listings, unchanged input and second pass', () => {
  for (const ticker of ['INDOMIM.BO','INDOMIM.NS']) for (const factor of [1,fx]) {
    const raw = fixture(ticker,factor), before = clone(raw);
    const result = applyFinancialCases(raw); statementGuard(result.snapshot,factor);
    assert.deepEqual(raw,before);
    for (const field of ['annualShares', 'annualSharesBasic', ...Object.keys(raw.annual).filter(f => /Ends$/.test(f))]) {
      assert.deepEqual(result.snapshot.annual[field], raw.annual[field], field + ' unchanged');
    }
    assert.deepEqual(result.snapshot.meta, raw.meta);
    assert.deepEqual(result.snapshot.timeseries, raw.timeseries);
    assert.equal(result.events.filter(e => e.status === 'corrected').length,4);
    for (const [i,row] of result.snapshot.annual.annualRev.entries()) {
      assert.equal(row.financialCorrection.caseId,cases[i].caseId);
      assert.equal(row.financialCorrection.replacementNativeValue,expected[i]);
      assert.equal(row.financialCorrection.nativeCurrency,'INR');
      assert.deepEqual(row.financialCorrection.sources,cases[i].sources);
    }
    assert.deepEqual(applyFinancialCases(result.snapshot).snapshot,result.snapshot);
    assert.deepEqual(applyFinancialCases(result.snapshot).events, [], 'no events on a second pass');
    for (const event of result.events.filter(e => e.reasonCode === 'annual-statement-scale')) {
      const row = result.snapshot.annual[event.field][event.index];
      assert.equal(event.container, 'annual'); assert.equal(event.status, 'missing'); assert.equal(event.newValue, null);
      assert.deepEqual(row.financialMissing.originalVendorRow, raw.annual[event.field][event.index]);
      assert.deepEqual(event.oldValue, event.field === 'annualBalance' ? raw.annual[event.field][event.index]
        : value(raw.annual[event.field][event.index]) ?? null);
      assert.equal(result.events.filter(e => e.field === event.field && e.index === event.index).length, 1);
    }
  }
});
test('already correct vendor values need sourced markers under scale authority; unrelated tickers stay unchanged', () => {
  const raw = fixture(); raw.meta.ticker = 'OTHER'; assert.equal(applyFinancialCases(raw).snapshot,raw);
  const correct = fixture(); correct.annual.annualRev = expected.map(n => ({value:n*fx}));
  const unflagged = clone(table); for (const c of unflagged.cases) delete c.vendorScale;
  assert.equal(applyFinancialCases(correct, { table:unflagged }).snapshot,correct, 'unflagged exact-match behavior unchanged');
  const held = applyFinancialCases(correct).snapshot;
  assert.ok(held.annual.annualRev.every(row => row.value === null && row.financialMissing.reasonCode === 'annual-statement-scale'));
  // Review P50 round 2: an uncovered older year is not shown in an unverified scale next to replaced years.
  const extra = fixture(); extra.annual.annualRev.push({value:123}); extra.annual.annualRevEnds.push('2022-03-31');
  const older = applyFinancialCases(extra).snapshot.annual.annualRev;
  assert.deepEqual(older.map(value),[...expected.map(n=>n*fx),null]);
  assert.equal(older[4].financialMissing.reasonCode,'annual-older-than-cases');
  assert.deepEqual(applyFinancialCases(applyFinancialCases(extra).snapshot).snapshot,applyFinancialCases(extra).snapshot);
});
test('review P50 round 2: a new vendor year in front or inserted withholds the whole series with a reason', () => {
  for (const [label, edit] of [
    ['new year in front', s=>{ s.annual.annualRev.unshift({value:s.annual.annualRev[0].value*1.2}); s.annual.annualRevEnds.unshift('2027-03-31'); }],
    ['inserted year', s=>{ s.annual.annualRev.splice(1,0,{value:999}); s.annual.annualRevEnds.splice(1,0,'2025-09-30'); }],
  ]) {
    const raw=fixture(); edit(raw); const r=applyFinancialCases(raw), rows=r.snapshot.annual.annualRev;
    assert.deepEqual(rows.map(value),rows.map(()=>null),label+': series empty');
    assert.ok(rows.every(x=>x.financialMissing.reasonCode==='annual-value-changed'),label+': reason');
    assert.ok(r.events.some(e=>e.reasonCode==='annual-value-changed' && e.period===raw.annual.annualRevEnds[label==='inserted year'?1:0]),label+': event for the new year');
    assert.deepEqual(applyFinancialCases(r.snapshot).snapshot,r.snapshot,label+': idempotent');
  }
});
test('currency, unit, source, duplicate date, missing date and vendor drift fail closed per cell', () => {
  for (const change of [
    s=>{s.meta.reportingCurrencyOriginal='EUR';},
    s=>{s.annual.annualRev[0].currency='INR';},
    s=>{s.annual.annualRev[0].unit='million';},
    s=>{s.annual.annualRev[0].multiplier=1000000;},
    s=>{s.annual.annualRev[0].source='SEC';},
    s=>{s.annual.annualRev[0].periodType='3M';},
    s=>{s.annual.annualRevEnds[1]='2026-03-31';},
    s=>{delete s.annual.annualRevEnds;},
    s=>{s.annual.annualRev[0].value+=1;}
  ]) {
    const raw=fixture(); change(raw); const saved=clone(raw); const r=applyFinancialCases(raw);
    assert.equal(value(r.snapshot.annual.annualRev[0]),null);
    assert.ok(r.events.some(e=>e.status==='stale' && e.container==='annual'));
    assert.deepEqual(raw,saved);
    assert.deepEqual(applyFinancialCases(r.snapshot).snapshot,r.snapshot);
  }
  // P99 merge condition: a withheld newest year withholds every older year too (no comparison across the hole).
  const drift=fixture(); drift.annual.annualRev[0].value++;
  assert.deepEqual(applyFinancialCases(drift).snapshot.annual.annualRev.map(value),[null,null,null,null]);
});
test('P99 lock 1: a withheld middle year withholds every older year; newer corrected year stays; idempotent', () => {
  const { revAcceleration } = require('../src/scoring/axes.js');
  const raw=fixture(); raw.annual.annualRev[1].value+=1; // FY2025 vendor value drifted -> held
  const r=applyFinancialCases(raw), rows=r.snapshot.annual.annualRev;
  assert.deepEqual(rows.map(value),[expected[0]*fx,null,null,null]);
  assert.equal(rows[1].financialMissing.reasonCode,'vendor-value-changed');
  assert.deepEqual(rows.slice(2).map(x=>x.financialMissing.reasonCode),['annual-older-than-withheld','annual-older-than-withheld']);
  assert.deepEqual(rows.slice(2).map(x=>x.financialMissing.caseId),[cases[2].caseId,cases[3].caseId]);
  assert.deepEqual(applyFinancialCases(r.snapshot).snapshot,r.snapshot,'second pass is idempotent');
  // The annual fallback of revAcceleration() needs three present years; it must not pair FY2026 with FY2024.
  assert.equal(revAcceleration({ ...r.snapshot, timeseries:{} }, null),null);
  // Break once: without the lock the older years stay present and the fallback compares across the hole.
  const unlocked=clone(rows); unlocked[2]={value:expected[2]*fx}; unlocked[3]={value:expected[3]*fx};
  assert.notEqual(revAcceleration({ ...r.snapshot, annual:{ ...r.snapshot.annual, annualRev:unlocked }, timeseries:{} }, null),null); breaks++;
});
test('review D15 H1: a stored state stays withheld after a table revision change (both drift variants)', () => {
  const { revAcceleration } = require('../src/scoring/axes.js');
  const next = clone(table); next.revision = '2026-10-07a';
  for (const [i, want] of [[1,[expected[0]*fx,null,null,null]], [0,[null,null,null,null]]]) {
    const raw=fixture(); raw.annual.annualRev[i].value+=1;
    const stored=applyFinancialCases(raw).snapshot;                 // persisted with the old revision
    const again=applyFinancialCases(stored,{table:next}).snapshot;  // read later with a new revision
    assert.deepEqual(again.annual.annualRev.map(value),want,'drift at '+i+': withheld years stay withheld');
    assert.equal(revAcceleration({ ...again, timeseries:{} }, null),null);
  }
});
test('P99 lock 2: reload never refills a withheld annual hand-table hole, not even with an earlier corrected value', () => {
  const { preserveReloadHistory } = require('../lib/reload-history.js');
  const period = (end, fetchedAt) => ({ end, duration:'12M', currency:'INR', unit:'currency', basis:'reported', fetchedAt });
  const ends=fixture().annual.annualRevEnds;
  const previous=applyFinancialCases(fixture()).snapshot; // stored, fully corrected
  previous.meta={ ...previous.meta, fetchedAt:'2026-10-01T00:00:00Z', statementPeriods:{ annualRev: ends.map(e=>period(e,'2026-10-01T00:00:00Z')) } };
  const raw=fixture(); raw.annual.annualRev[1].value+=1;
  const next=applyFinancialCases(raw).snapshot; // FY2025 and older withheld
  next.meta={ ...next.meta, fetchedAt:'2026-10-06T00:00:00Z', statementPeriods:{ annualRev: ends.map(e=>period(e,'2026-10-06T00:00:00Z')) } };
  const kept=preserveReloadHistory(clone(next), previous);
  assert.deepEqual(kept.annual.annualRev.map(value),[expected[0]*fx,null,null,null],'withheld years stay withheld');
  // Break once: an unmarked hole IS refilled, so the protection comes from the hand-table marker.
  const plain=clone(next); for (const i of [1,2,3]) plain.annual.annualRev[i]=null;
  assert.notEqual(value(preserveReloadHistory(plain, previous).annual.annualRev[1]),null); breaks++;
});
test('source period, amount, currency, unit and zero replacement are rejected at load time', () => {
  for(const change of [
    c=>{c.replacementValue=0;}, c=>{c.unit='million';}, c=>{c.sources[0].currency='USD';},
    c=>{c.sources[0].unit='million';}, c=>{delete c.sources[0].value;},
    c=>{c.sources[0].value+=1;}, c=>{c.sources[0].end='2025-03-31';},
    c=>{c.sources[0].start='2024-04-01';}, c=>{delete c.sources[0].end;}, c=>{c.sources[0].start='2026-04-01';}
    ,c=>{c.sources[0].start='2026-01-01';},c=>{c.sources[0].start='2026-03-31';}
  ]) {
    const config=clone(table); change(config.cases.find(c=>c.caseId===cases[0].caseId));
    assert.throws(()=>validateTable(config), /Invalid annual replacement|Replacement matches no source/);
  }
});
test('undated annual values fail closed even with invalid FX or a changed vendor value', () => {
  for (const change of [s=>{s.meta.fxConversionFailed=true;},s=>{s.annual.annualRev[0].value++;}]) {
    const raw=fixture(); delete raw.annual.annualRevEnds; change(raw);
    const result=applyFinancialCases(raw);
    assert.deepEqual(result.snapshot.annual.annualRev.map(value),[null,null,null,null]);
    assert.ok(result.events.filter(e=>e.field==='annualRev').every(e=>e.status==='stale' && e.reasonCode==='period-undated'));
    assert.ok(result.events.filter(e=>e.field!=='annualRev').every(e=>e.status==='missing' && e.reasonCode==='annual-statement-scale'));
    assert.deepEqual(applyFinancialCases(result.snapshot).snapshot,result.snapshot);
  }
});
test('break once: every old 10x-small vendor value makes the output guard red', () => {
  const good=applyFinancialCases(fixture()).snapshot; guard(good);
  for(let i=0;i<4;i++) {
    const bad=clone(good); bad.annual.annualRev[i].value=expected[i]/10*fx;
    assert.throws(()=>guard(bad),assert.AssertionError); breaks++;
    const config=clone(table); config.cases=config.cases.filter(c=>c.caseId!==cases[i].caseId);
    assert.throws(()=>guard(applyFinancialCases(fixture(),{table:config}).snapshot),assert.AssertionError); breaks++;
  }
  guard(applyFinancialCases(fixture()).snapshot);
});
test('break once: currency and zero invalid tables fail; clean table still loads', () => {
  for (const change of [c=>{c.sources[0].currency='USD';},c=>{c.replacementValue=0;}]) {
    const bad=clone(table); change(bad.cases.find(c=>c.caseId===cases[0].caseId));
    assert.throws(()=>validateTable(bad),/Invalid annual replacement/); breaks++;
  }
  assert.equal(validateTable(table),table);
});
test('whole-statement authority validates only on numeric annual cases', () => {
  for (const scale of [null, '', true, 'annual', undefined]) {
    const bad = clone(table); bad.cases.find(c => c.caseId === cases[0].caseId).vendorScale = scale;
    assert.throws(() => validateTable(bad), /Invalid financial vendorScale/);
  }
  for (const select of [c => c.periodType === '3M', c => c.periodType === '12M' && c.replacementValue === null]) {
    const bad = clone(table); bad.cases.find(select).vendorScale = 'whole-annual-statement';
    assert.throws(() => validateTable(bad), /Invalid financial vendorScale/);
  }
  // A zero peer replacement is invalid even for the already supported annualGP field.
  const badPeer = clone(table), peer = badPeer.cases.find(c => c.caseId === cases[0].caseId);
  peer.field = 'annualGP'; peer.replacementValue = 0;
  assert.throws(() => validateTable(badPeer), /Invalid annual replacement/); breaks++;
});
test('all currency inputs are table-sourced or missing; the five axes cannot consume mixed scales', () => {
  for (const ticker of ['INDOMIM.BO', 'INDOMIM.NS']) for (const factor of [1, fx]) {
    const raw = fixture(ticker, factor), out = applyFinancialCases(raw).snapshot;
    for (const name of ['gpGrowth', 'marginLevel', 'dilution', 'capitalEfficiency']) assert.equal(axes[name](out), null, name);
    assert.notEqual(axes.gpGrowth(out), 0.20292044569055287);
    assert.notEqual(axes.marginLevel(out), 0.058157508616159745);
    assert.deepEqual(norm(out, 'annualBalance', 'totalAssets'), [null, null, null, null]);
    assert.deepEqual(norm(out, 'annualBalance', 'currentLiabilities'), [null, null, null, null]);
    assert.equal(axes.ruleOfX(out), 2.3 * ((expected[0] * factor / (expected[1] * factor) - 1) * 100),
      'Rule of X keeps only sourced revenue growth; no FCF term');
    for (const c of table.cases.filter(c => c.ticker === ticker && c.replacementValue !== null)) {
      assert.ok(Math.abs(c.replacementValue - 10 * c.expectedBadValue) <= 5000000, c.caseId);
      assert.equal(value(raw.annual[c.field][c.index]), c.expectedBadValue * factor, c.caseId + ' exact native fingerprint');
    }
  }
});
test('break once: each scale flag and every withheld vendor cell is guarded', () => {
  const raw = fixture(), good = applyFinancialCases(raw).snapshot; statementGuard(good);
  for (const c of cases) {
    const bad = clone(table); delete bad.cases.find(x => x.caseId === c.caseId).vendorScale;
    assert.throws(() => statementGuard(applyFinancialCases(raw, { table:bad }).snapshot), assert.AssertionError); breaks++;
  }
  for (const [field, rows] of Object.entries(good.annual)) {
    if (!Array.isArray(rows) || /Ends$/.test(field)) continue;
    for (const [i, row] of rows.entries()) if (row?.financialMissing &&
        (Number.isFinite(value(raw.annual[field][i])) || field === 'annualBalance')) {
      const bad = clone(good); bad.annual[field][i] = clone(raw.annual[field][i]);
      assert.throws(() => statementGuard(bad), assert.AssertionError); breaks++;
    }
  }
  statementGuard(applyFinancialCases(raw).snapshot);
});
test('whole-statement hold uses period metadata or newest case and covers future fields without touching nonarrays', () => {
  const raw = fixture();
  raw.annual.futureCurrency = [0, { value:17 }];
  raw.annual.note = 'unchanged';
  raw.meta.statementPeriods = { futureCurrency:[{ end:'2024-03-31' }, { end:'2027-03-31' }] };
  const before = clone(raw), result = applyFinancialCases(raw);
  assert.deepEqual(result.snapshot.annual.futureCurrency.map(value), [null, null]);
  assert.deepEqual(result.snapshot.annual.futureCurrency.map(row => row.financialMissing.caseId), [cases[2].caseId, cases[0].caseId]);
  assert.deepEqual(result.snapshot.meta.statementPeriods, raw.meta.statementPeriods);
  assert.equal(result.snapshot.annual.note, raw.annual.note);
  assert.deepEqual(raw, before);
  assert.deepEqual(applyFinancialCases(result.snapshot), { snapshot:result.snapshot, events:[] });
});
assert.deepEqual(hashes(),beforeHashes,'live library and table hashes unchanged by memory-only break probes');
console.log(`annual-financial-replacements: ${passed} passed; ${breaks} red probes caught; live hashes unchanged`);
}
module.exports = { fixture };
