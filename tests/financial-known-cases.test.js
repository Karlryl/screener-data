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

test('all 195 authorized cells (182 quarterly, 13 annual) and ten held packets have auditable sources', () => {
  assert.equal(table.cases.length, 195);
  assert.equal(table.cases.filter(c => c.periodType === '12M').length, 13);
  assert.deepEqual(table.quarantines.map(q => q.ticker), ['BANPU.BK', 'KBDC', 'HOS', 'TYG', 'OLPX', 'HLX', '2670.HK', 'ENGI3.SA', 'Z98.DE', '2637.TW']);
  assert.throws(() => validateTable({}), /Invalid/);
  const duplicate = clone(table); duplicate.cases.push(duplicate.cases[0]); assert.throws(() => validateTable(duplicate), /duplicate/);
  const undocumented = clone(table); undocumented.cases[0].sources[0].quote = ''; assert.throws(() => validateTable(undocumented), /Invalid/);
});

// M1: a series with any non-null value (replaced or confirmed) needs exactly one coverage entry.
test('coverage is mandatory for every series with a non-null value, unique, and absent for false-zero series', () => {
  const need = new Set(table.cases.filter(c => c.replacementValue !== null).map(c => c.ticker + '|' + c.field));
  assert.deepEqual([...need].sort(), [...['ARCC', 'BANPU.BK', 'BBDC', 'BXSL', 'CSWC', 'FSK', 'GBDC', 'HTGC', 'KBDC', 'MAIN', 'MSDL',
    'OBDC', 'OTF', 'OXLC', 'PSEC', 'TRIN', 'TSLX'].map(t => t + '|revenueQ'),
    ...['CARG', 'DCO', 'INFQ', 'PLUS', 'SLCE3.SA'].flatMap(t => [t + '|grossProfitQ', t + '|revenueQ']),
    ...['CARG', 'DCO', 'HIVE', 'INFQ', 'PLUS', 'SLCE3.SA'].map(t => t + '|opIncQ')].sort());
  assert.deepEqual(table.coverage.map(v => v.ticker + '|' + v.field).sort(), [...need].sort());
  const noHtgc = clone(table); noHtgc.coverage = noHtgc.coverage.filter(v => v.ticker !== 'HTGC');
  assert.throws(() => validateTable(noHtgc), /Missing financial coverage: HTGC\|revenueQ/);
  const noKey = clone(table); delete noKey.coverage; assert.throws(() => validateTable(noKey), /Invalid financial hand table/);
  const notArray = clone(table); notArray.coverage = {}; assert.throws(() => validateTable(notArray), /Invalid financial hand table/);
  const dupCoverage = clone(table); dupCoverage.coverage.push(clone(dupCoverage.coverage[0]));
  assert.throws(() => validateTable(dupCoverage), /Invalid financial coverage \(bad or duplicate\): HTGC/);
  const dupId = clone(table); dupId.cases[1].caseId = dupId.cases[0].caseId; assert.throws(() => validateTable(dupId), /duplicate/);
  // Absence: false-zero series (null replacement) validate without coverage; the real table passes.
  assert.equal(validateTable(clone(table)).cases.length, 195);
  // Break-once in memory: without the coverage requirement the HTGC gap validates silently.
  const broken = moduleCopy('lib/financial-known-cases.js', s => replaceLine(s,
    "  for (const key of basisWrong) if (!covered.has(key)) throw new Error('Missing financial coverage: ' + key);", ''));
  assert.throws(() => assert.throws(() => broken.validateTable(noHtgc), /Missing/), assert.AssertionError); breaks++;
});
for (const c of table.cases.filter(x => x.periodType === '3M')) test(c.caseId + ' real cached input, absence, idempotency', () => {
  const input = clone(fixture[c.ticker]), original = serial(input);
  const i = input.timeseries[c.field + 'Ends'].indexOf(c.period);
  const factor = input.meta.fxRateApplied;
  assert.equal(value(input.timeseries[c.field][i]), c.expectedBadValue * factor);
  const result = applyFinancialCases(input).snapshot;
  assert.equal(norm(result, c.field)[i], c.replacementValue === null ? null : c.replacementValue * factor);
  assert.equal(serial(input), original);
  assert.equal(serial(applyFinancialCases(result).snapshot), serial(result));
  // A confirmed cell (expectedBadValue === replacementValue) keeps the vendor row byte for byte: no marker, no visible reason.
  if (c.expectedBadValue === c.replacementValue) assert.equal(serial(result.timeseries[c.field][i]), serial(input.timeseries[c.field][i]));
  else assert.ok(financialReasons(result).includes(c.reason));
  const other = clone(input); other.meta.ticker = 'UNLISTED';
  assert.equal(applyFinancialCases(other).snapshot, other);
  // Every authority entry is broken once independently, not just the first row.
  const broken = clone(table); broken.cases = broken.cases.filter(x => x.caseId !== c.caseId);
  // Coverage is mandatory (M1); keep it valid for the remaining cases. The dropped period then
  // arrives raw (false zeros) or withheld (basis-wrong series), never as the verified replacement.
  broken.coverage = broken.coverage.map(v => v.ticker !== c.ticker ? v : { ...v, coversThrough:
    broken.cases.filter(x => x.ticker === v.ticker && x.field === v.field).map(x => x.period).sort().at(-1) })
    .filter(v => v.coversThrough); // a series whose only case was dropped has no authority left
  // A dropped withheld case inside a covered series stays empty by the coverage rule, so the guard also pins the
  // case's own marker (its source and reason), not just the value.
  const guard = config => {
    const out = applyFinancialCases(input, { table: config }).snapshot;
    assert.equal(norm(out, c.field)[i], c.replacementValue === null ? null : c.replacementValue * factor);
    if (c.expectedBadValue !== c.replacementValue) assert.equal(out.timeseries[c.field][i].financialCorrection?.caseId, c.caseId);
  };
  assert.throws(() => guard(broken), assert.AssertionError); guard(table); breaks++;
});

// Annual withhold cells (01.10.): a false vendor year becomes missing (value null plus a marker with the reason,
// never 0). Undated series: position plus the exact vendor value; dated series: fiscal-year end.
const annualIndex = (s, c) => { const e = s.annual[c.field + 'Ends']; return Array.isArray(e) && e.some(Boolean) ? e.indexOf(c.period) : c.index; };
for (const c of table.cases.filter(x => x.periodType === '12M')) test(c.caseId + ' annual cell: withheld on real input, others untouched, idempotent', () => {
  const input = clone(fixture[c.ticker]), original = serial(input), i = annualIndex(input, c);
  assert.equal(value(input.annual[c.field][i]), c.expectedBadValue * (input.meta.fxRateApplied || 1));
  const r = applyFinancialCases(input), out = r.snapshot, row = out.annual[c.field][i];
  assert.equal(norm(out, c.field)[i], null); assert.equal(row.value, null);
  assert.equal(row.financialCorrection.caseId, c.caseId); assert.equal(row.financialCorrection.replacementNativeValue, null);
  assert.equal(serial(row.financialCorrection.originalVendorRow), serial(input.annual[c.field][i]));
  assert.ok(financialReasons(out).includes(c.reason));
  assert.ok(r.events.some(e => e.caseId === c.caseId && e.status === 'missing' && e.container === 'annual' && e.index === i));
  // Absence: every annual cell without its own case keeps the vendor row byte for byte, except a present cell older
  // than the newest withheld year, which the no-gap rule withholds too (HL 2022).
  const own = new Set(table.cases.filter(x => listedIn(x, c.ticker) && x.field === c.field).map(x => annualIndex(input, x)));
  const newestOwn = Math.min(...own);
  input.annual[c.field].forEach((x, j) => {
    if (own.has(j)) return;
    if (j > newestOwn && value(x) != null) assert.equal(out.annual[c.field][j].financialMissing?.reasonCode, 'annual-older-than-withheld', 'cell ' + j);
    else assert.equal(serial(out.annual[c.field][j]), serial(x));
  });
  assert.equal(serial(input), original);
  assert.equal(serial(applyFinancialCases(out).snapshot), serial(out), 'idempotent: an already withheld cell stays withheld');
  const other = clone(fixture[c.ticker]); other.meta.ticker = 'UNLISTED'; assert.equal(applyFinancialCases(other).snapshot, other);
  // Fail closed: a changed vendor value withholds every present cell of the series (stale, reason visible, never 0).
  const moved = clone(fixture[c.ticker]); moved.annual[c.field][i].value += 1;
  const m = applyFinancialCases(moved);
  assert.ok(norm(m.snapshot, c.field).every(x => x === null));
  m.snapshot.annual[c.field].forEach((row, j) => assert.equal(row.financialMissing.reasonCode, 'annual-value-changed', 'cell ' + j));
  assert.ok(m.events.some(e => e.caseId === c.caseId && e.status === 'stale' && e.reasonCode === 'annual-value-changed'));
  assert.ok(financialReasons(m.snapshot).includes(MISSING_REASONS['annual-value-changed']));
  const again = applyFinancialCases(m.snapshot);
  assert.equal(serial(again.snapshot), serial(m.snapshot), 'fail-closed pass is idempotent');
  assert.ok(again.events.some(e => e.status === 'stale' && e.reasonCode === 'annual-value-changed'), 'and keeps warning');
  // Break-once on test data: a table without this cell shows the false vendor value again, or (an older year
  // under a newer withheld one) loses the cell's own sourced reason.
  const broken = clone(table); broken.cases = broken.cases.filter(x => x.caseId !== c.caseId);
  const guard = config => {
    const out = applyFinancialCases(clone(fixture[c.ticker]), { table: config }).snapshot;
    assert.equal(norm(out, c.field)[i], null); assert.equal(out.annual[c.field][i].financialCorrection?.caseId, c.caseId);
  };
  assert.throws(() => guard(broken), assert.AssertionError); guard(table); breaks++;
});
const driftLine = '    const drift = hits.find(({ c, i }) => !env || env.currency !== c.currency || valueOf(rows[i]) !== c.expectedBadValue * env.factor);';
function listedIn(x, ticker) { return [x.ticker, ...(x.listingAliases || [])].includes(ticker); }

test('annual cells: dated by fiscal-year end, undated by position plus value, withhold only; no annual case touches nothing', () => {
  const t = clone(table); t.quarantines = t.quarantines.filter(q => q.ticker !== 'KBDC');
  const template = table.cases.find(c => c.caseId === 'otf-2024-12-31-annualRev');
  t.cases.push({ ...clone(template), caseId: 'test-kbdc-2024-annualRev', ticker: 'KBDC', period: '2024-12-31', index: 0, expectedBadValue: 123757000 });
  // Dated KBDC series: the fiscal-year end decides, not the (deliberately wrong) index 0; older years go too (no gaps).
  assert.deepEqual(norm(applyFinancialCases(clone(fixture.KBDC), { table: t }).snapshot, 'annualRev'), [102145000, null, null, null]);
  const rolled = clone(fixture.KBDC); rolled.annual.annualRev.unshift({ value: 1 }); rolled.annual.annualRevEnds.unshift('2026-12-31');
  assert.deepEqual(norm(applyFinancialCases(rolled, { table: t }).snapshot, 'annualRev'), [1, 102145000, null, null, null]);
  const gone = clone(fixture.KBDC); gone.annual.annualRevEnds[1] = '2024-06-30';
  assert.equal(serial(applyFinancialCases(gone, { table: t }).snapshot.annual), serial(gone.annual), 'year absent: nothing touched');
  // Undated rollover (vendor puts FY2025 in front): position plus value no longer match -> the whole series fails closed.
  const infq = clone(fixture.INFQ);
  for (const f of ['annualRev', 'annualGP']) { infq.annual[f].unshift({ value: f === 'annualRev' ? 31108000 : 11380000 }); infq.annual[f].pop(); }
  const ir = applyFinancialCases(infq);
  assert.deepEqual(norm(ir.snapshot, 'annualRev'), [null, null]); assert.deepEqual(norm(ir.snapshot, 'annualGP'), [null, null]);
  assert.equal(ir.events.filter(e => e.container === 'annual' && e.status === 'stale' && e.reasonCode === 'annual-value-changed').length, 4);
  // Absence: without annual cases no annual block of any fixture changes.
  const noAnnual = clone(table); noAnnual.cases = noAnnual.cases.filter(c => c.periodType === '3M');
  for (const [ticker, s] of Object.entries(fixture)) assert.equal(serial(applyFinancialCases(clone(s), { table: noAnnual }).snapshot.annual), serial(s.annual), ticker);
  // Withhold only: a value, a missing index, a quarterly period type or annual coverage are entry errors.
  const bad = mutate => { const x = clone(table); mutate(x.cases.find(c => c.caseId === 'infq-2024-12-31-annualRev'), x); return x; };
  assert.throws(() => validateTable(bad(c => { c.replacementValue = 28094000; c.reason = 'Umsatz korrigiert'; })), /Invalid annual cell/);
  assert.throws(() => validateTable(bad(c => { delete c.index; })), /Invalid annual cell/);
  assert.throws(() => validateTable(bad(c => { c.periodType = '3M'; })), /Invalid or duplicate/);
  assert.throws(() => validateTable(bad((c, x) => { x.coverage.push({ ticker: 'INFQ', field: 'annualRev', coversThrough: '2024-12-31' }); })), /Invalid financial coverage/);
  // Break-once in memory (whole-line anchors): without the validation a replacement value would pass;
  // without the value check a changed vendor value would be blanked; without the match nothing is withheld.
  const lib = 'lib/financial-known-cases.js';
  const noValidation = moduleCopy(lib, s => replaceLine(s,
    '    if (annual.has(c.field) && (c.replacementValue !== null || !Number.isInteger(c.index) || c.index < 0)) {', '    if (false) {'));
  assert.throws(() => assert.throws(() => noValidation.validateTable(bad(c => { delete c.index; })), /Invalid annual cell/), assert.AssertionError); breaks++;
  const noValueCheck = moduleCopy(lib, s => replaceLine(s, driftLine, '    const drift = hits.find(({ c, i }) => !env || env.currency !== c.currency);'));
  const changed = clone(fixture.INFQ); changed.annual.annualRev[0].value += 1;
  const failsClosed = fn => assert.equal(fn(clone(changed)).snapshot.annual.annualRev[0].financialMissing?.reasonCode, 'annual-value-changed');
  assert.throws(() => failsClosed(noValueCheck.applyFinancialCases), assert.AssertionError); failsClosed(applyFinancialCases); breaks++;
  const noMatch = moduleCopy(lib, s => replaceLine(s, '    for (const { c, i } of hits) {', '    for (const { c, i } of []) {'));
  const withheld = fn => assert.equal(norm(fn(clone(fixture.INFQ)).snapshot, 'annualRev')[0], null);
  assert.throws(() => withheld(noMatch.applyFinancialCases), assert.AssertionError); withheld(applyFinancialCases); breaks++;
});

// Review round 2 (M1, N1, N2): an annual series fails closed on drift, never has a gap in front or in the middle,
// and the currency, the FX factor, an unusable envelope and index -1 are each pinned by a test.
test('annual series fail closed on drift, withhold older years (no gaps), check currency, FX factor and index', () => {
  const lib = 'lib/financial-known-cases.js';
  const blank = (s, f) => norm(s, f).every(x => x === null);
  const closed = (r, f) => {
    assert.ok(blank(r.snapshot, f), f + ' all withheld');
    r.snapshot.annual[f].forEach(row => assert.equal(row.financialMissing?.reasonCode, 'annual-value-changed'));
    assert.ok(r.events.some(e => e.field === f && e.status === 'stale' && e.reasonCode === 'annual-value-changed'));
  };
  // Presence: new year in front (series grows), restated value, envelope null, wrong currency -> the whole series is withheld.
  const grown = clone(fixture.CARG); for (const f of ['annualRev', 'annualGP']) grown.annual[f].unshift({ value: 950000000 });
  for (const f of ['annualRev', 'annualGP']) closed(applyFinancialCases(grown), f);
  const restated = clone(fixture.CARG); restated.annual.annualGP[3].value = 664128530;
  const rr = applyFinancialCases(restated); closed(rr, 'annualGP');
  // Absence: the other series of the same company (annualRev still matches) keeps its verified cut.
  assert.deepEqual(norm(rr.snapshot, 'annualRev'), [906980000, 798044000, 698421000, null]);
  assert.equal(rr.snapshot.annual.annualRev[3].financialCorrection.caseId, 'carg-2022-12-31-annualRev');
  const noEnv = clone(fixture.OTF); noEnv.meta.fxConversionFailed = true;
  closed(applyFinancialCases(noEnv), 'annualRev');
  const eur = clone(fixture.INFQ); eur.meta.reportingCurrencyOriginal = 'EUR';
  for (const f of ['annualRev', 'annualGP']) closed(applyFinancialCases(eur), f);
  // Absence: the unchanged matching case withholds only its own cell, no stale event, newer years byte for byte.
  const ok = applyFinancialCases(clone(fixture.CARG));
  assert.deepEqual(norm(ok.snapshot, 'annualRev'), [906980000, 798044000, 698421000, null]);
  assert.equal(ok.events.filter(e => e.container === 'annual' && e.status === 'stale').length, 0);
  for (const j of [0, 1, 2]) assert.equal(serial(ok.snapshot.annual.annualGP[j]), serial(fixture.CARG.annual.annualGP[j]));
  // FX factor != 1: a converted packet matches expectedBadValue * fxRateApplied and is withheld by its case;
  // an unscaled native value in the same packet is drift and fails closed.
  const t = clone(table);
  for (const c of t.cases.filter(c => c.ticker === 'INFQ' && c.periodType === '12M')) c.currency = 'EUR';
  const fx = clone(fixture.INFQ); fx.meta.reportingCurrencyOriginal = 'EUR'; fx.meta.fxRateApplied = 1.25;
  for (const f of ['annualRev', 'annualGP']) for (const row of fx.annual[f]) row.value *= 1.25;
  const fxCut = fn => {
    const r = fn(clone(fx), { table: t });
    assert.ok(blank(r.snapshot, 'annualRev'));
    assert.equal(r.snapshot.annual.annualRev[0].financialCorrection?.caseId, 'infq-2024-12-31-annualRev');
    assert.equal(r.events.filter(e => e.status === 'stale' && e.container === 'annual').length, 0);
  };
  fxCut(applyFinancialCases);
  const unscaled = clone(fx); unscaled.annual.annualRev[0].value = 28836000;
  closed(applyFinancialCases(unscaled, { table: t }), 'annualRev');
  // No gaps: a withheld middle year withholds every older present year (same reason, status missing, not stale);
  // a withheld newest year withholds the whole series. Newer years stay byte for byte.
  const gaps = (index, period, bad) => { const x = clone(table); x.cases = x.cases.filter(c => c.ticker !== 'CARG' || c.periodType !== '12M');
    x.cases.push({ ...clone(table.cases.find(c => c.caseId === 'carg-2022-12-31-annualRev')), caseId: 'test-carg-annualRev-' + index, period, index, expectedBadValue: bad });
    return x; };
  const middle = gaps(1, '2024-12-31', 798044000), mr = applyFinancialCases(clone(fixture.CARG), { table: middle });
  assert.deepEqual(norm(mr.snapshot, 'annualRev'), [906980000, null, null, null]);
  assert.equal(serial(mr.snapshot.annual.annualRev[0]), serial(fixture.CARG.annual.annualRev[0]));
  for (const j of [2, 3]) {
    const row = mr.snapshot.annual.annualRev[j];
    assert.equal(row.financialMissing.reasonCode, 'annual-older-than-withheld'); assert.equal(row.financialMissing.reason, middle.cases.at(-1).reason);
  }
  assert.ok(mr.events.filter(e => e.reasonCode === 'annual-older-than-withheld').every(e => e.status === 'missing'));
  assert.equal(serial(applyFinancialCases(mr.snapshot, { table: middle }).snapshot), serial(mr.snapshot), 'idempotent');
  assert.ok(blank(applyFinancialCases(clone(fixture.CARG), { table: gaps(0, '2025-12-31', 906980000) }).snapshot, 'annualRev'));
  // A missing snapshot or annual block passes through untouched (callers probe with null).
  assert.equal(applyFinancialCases(null).snapshot, null);
  const noBlock = { meta: clone(fixture.INFQ.meta), annual: null }; assert.equal(applyFinancialCases(noBlock).snapshot, noBlock);
  // Index -1 (and a fraction) are entry errors.
  const badIndex = v => { const x = clone(table); x.cases.find(c => c.caseId === 'carg-2022-12-31-annualRev').index = v; return x; };
  for (const v of [-1, 1.5]) assert.throws(() => validateTable(badIndex(v)), /Invalid annual cell/);
  // Break-once in memory (whole-line anchors), one per new guard, each on test data only. Every mutant is built
  // BEFORE assert.throws, so a missed anchor fails the test instead of passing as a caught break.
  const mutant = (from, part, to) => {
    const line = part === null ? to : from.replace(part, to);
    assert.notEqual(line, from, 'mutation changes the line');
    return moduleCopy(lib, s => replaceLine(s, from, line)).applyFinancialCases;
  };
  const red = (check, fn, error = assert.AssertionError) => { assert.throws(() => check(fn), error); check(applyFinancialCases); breaks++; };
  red(fn => closed(fn(clone(grown)), 'annualRev'), mutant('    if (drift || heldOpen) {', null, '    if (false) {'));
  red(fn => assert.deepEqual(norm(fn(clone(fixture.CARG), { table: middle }).snapshot, 'annualRev'), [906980000, null, null, null]),
    mutant('    if (newest) rows.forEach((row, j) => {', 'if (newest)', 'if (false)'));
  red(fn => closed(fn(clone(eur)), 'annualRev'), mutant(driftLine, 'env.currency !== c.currency || ', ''));
  red(fxCut, mutant(driftLine, ' * env.factor', ''));
  // Without the envelope check the null envelope crashes (TypeError) instead of failing closed.
  red(fn => closed(fn(clone(noEnv)), 'annualRev'), mutant(driftLine, '!env || ', ''), TypeError);
  const validationLine = '    if (annual.has(c.field) && (c.replacementValue !== null || !Number.isInteger(c.index) || c.index < 0)) {';
  const noNegative = moduleCopy(lib, s => replaceLine(s, validationLine, validationLine.replace(' || c.index < 0', '')));
  assert.throws(() => assert.throws(() => noNegative.validateTable(badIndex(-1)), /Invalid annual cell/), assert.AssertionError); breaks++;
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
  const revenueCovered = table.coverage.filter(v => v.field === 'revenueQ').map(v => v.ticker);
  assert.deepEqual(revenueCovered.slice().sort(), ['ARCC', 'BANPU.BK', 'BBDC', 'BXSL', 'CARG', 'CSWC', 'DCO', 'FSK', 'GBDC', 'HTGC',
    'INFQ', 'KBDC', 'MAIN', 'MSDL', 'OBDC', 'OTF', 'OXLC', 'PLUS', 'PSEC', 'SLCE3.SA', 'TRIN', 'TSLX']);
  for (const ticker of revenueCovered.filter(t => t !== 'BANPU.BK')) {
    const input = nextQuarter(clone(fixture[ticker])), original = serial(input);
    const r = applyFinancialCases(input);
    const row = r.snapshot.timeseries.revenueQ[0];
    assert.equal(value(row), null);
    assert.equal(row.financialMissing.reasonCode, 'period-after-coverage');
    assert.equal(row.financialMissing.originalVendorRow.value, 60e6);
    assert.ok(financialReasons(r.snapshot).includes(MISSING_REASONS['period-after-coverage']));
    assert.equal(r.events.filter(e => e.status === 'stale').length, 1);
    assert.equal(r.events.find(e => e.status === 'stale').period, '2026-09-30');
    // Covered periods are still corrected (or withheld where the table withholds them).
    for (const c of table.cases.filter(c => c.ticker === ticker && c.field === 'revenueQ')) {
      const i = r.snapshot.timeseries.revenueQEnds.indexOf(c.period);
      if (i >= 0) assert.equal(value(r.snapshot.timeseries.revenueQ[i]), c.replacementValue === null ? null : c.replacementValue * input.meta.fxRateApplied);
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
  assert.deepEqual(aliases, { 'YSN.DE': ['YSNG.VI'], 'PDN.AX': ['PDN.TO', 'PALAF'], HIVE: ['HIVE.TO'], HL: ['HL.SW'] });
  const leg = (primary, alias) => { const s = clone(fixture[primary]); s.meta.ticker = alias; return s; };
  for (const [primary, list] of Object.entries(aliases)) for (const alias of list) {
    const input = leg(primary, alias), original = serial(input), r = applyFinancialCases(input);
    const primaryOut = applyFinancialCases(clone(fixture[primary])).snapshot;
    assert.equal(serial(r.snapshot.timeseries), serial(primaryOut.timeseries), alias + ' corrected like ' + primary);
    assert.equal(serial(r.snapshot.annual), serial(primaryOut.annual), alias + ' annual like ' + primary);
    // False zeros are withheld (missing); HIVE's operating income is replaced (corrected).
    assert.ok(r.events.some(e => e.status === (primary === 'HIVE' ? 'corrected' : 'missing') && e.ticker === alias));
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
// The verified USD cases apply there (covered series only); a genuinely ambiguous packet stays withheld.
test('ccyAmbiguous: US-exchange USD listing takes its USD cases in a covered series; LSE, OTC, assumed, non-USD or uncovered stay withheld', () => {
  const axes = require('../src/scoring/axes.js');
  const kbdc = table.cases.filter(c => c.ticker === 'KBDC');
  assert.equal(kbdc.length, 5); assert.equal(fixture.KBDC.meta.ccyAmbiguous, true);
  assert.deepEqual([fixture.KBDC.meta.exchangeName, fixture.KBDC.meta.tradingCurrency, fixture.KBDC.meta.reportingCurrencyOriginal], ['NYSE', 'USD', 'USD']);
  const cells = s => kbdc.map(c => value(s.timeseries.revenueQ[s.timeseries.revenueQEnds.indexOf(c.period)]));
  const corrected = fn => {
    const r = fn(clone(fixture.KBDC));
    assert.deepEqual(cells(r.snapshot), kbdc.map(c => c.replacementValue));
    assert.ok(!r.events.some(e => e.status === 'stale'));
    assert.equal(axes.revGrowthLevel(r.snapshot).toFixed(1), '-2.8', 'SEC quarters: 55.703 vs 57.298 million');
  };
  corrected(applyFinancialCases);
  // Presence at pull time: native packet (not yet converted, no reportingCurrencyOriginal) through the pull's converter.
  const pulled = clone(fixture.KBDC); pulled.meta.fxConverted = false;
  delete pulled.meta.reportingCurrencyOriginal; delete pulled.meta.fxRateApplied;
  assert.equal(require('../pull-yahoo.js')._convertSnapshotToUSDGuarded(pulled), true);
  assert.deepEqual(cells(pulled), kbdc.map(c => c.replacementValue));
  // Absence: each genuinely ambiguous variant withholds all five cells (context-changed), never the case value.
  const withheld = (change, fn = applyFinancialCases) => {
    const input = clone(fixture.KBDC); change(input.meta);
    const r = fn(input), rows = r.snapshot.timeseries.revenueQ;
    assert.deepEqual(rows.map(value), [null, null, null, null, null]);
    assert.ok(rows.every(row => row.financialMissing.reasonCode === 'context-changed'));
    assert.equal(r.events.filter(e => e.status === 'stale').length, 5);
  };
  const tradingEur = m => { m.tradingCurrency = 'EUR'; };
  for (const change of [m => { m.exchangeName = 'LSE'; }, m => { m.exchangeName = 'OTC Markets OTCPK'; },
    m => { m.tradingCurrencyAssumed = true; }, m => { delete m.tradingCurrencyAssumed; }, m => { m._ccyMissingCompletely = true; },
    tradingEur, m => { m.tradingCurrency = 'EUR'; m.reportingCurrencyOriginal = 'EUR'; }, m => { m.country = 'United Kingdom'; },
    m => { delete m.country; }]) withheld(change);
  // A non-USD case never applies on the resolved USD packet.
  const eur = clone(table); for (const c of eur.cases) if (c.ticker === 'KBDC') c.currency = 'EUR';
  assert.ok(applyFinancialCases(clone(fixture.KBDC), { table: eur }).snapshot.timeseries.revenueQ.every(row => value(row) === null));
  // Absence: an ambiguous packet in a series without coverage (VCTR gross profit, one withheld false value on a
  // US/USD listing) stays context-changed; with a vendor currency the case applies (withheld as a known false value).
  const vi = fixture.VCTR.timeseries.grossProfitQEnds.indexOf('2025-12-31');
  const ambiguousVctr = clone(fixture.VCTR); ambiguousVctr.meta.ccyAmbiguous = true;
  const uncovered = fn => {
    const row = fn(ambiguousVctr).snapshot.timeseries.grossProfitQ[vi];
    assert.equal(value(row), null);
    assert.equal(row.financialMissing?.reasonCode, 'context-changed');
  };
  uncovered(applyFinancialCases);
  const plainVctr = applyFinancialCases(clone(fixture.VCTR)).snapshot.timeseries.grossProfitQ[vi];
  assert.equal(value(plainVctr), null); assert.equal(plainVctr.financialCorrection.replacementNativeValue, null);
  // Presence: OXLC is now a covered series, so even an ambiguous OXLC packet takes its verified USD values.
  const ambiguousOxlc = clone(fixture.OXLC); ambiguousOxlc.meta.ccyAmbiguous = true;
  assert.deepEqual(norm(applyFinancialCases(ambiguousOxlc).snapshot, 'revenueQ'), [94000000, 124000000, 121161000, null]);
  assert.equal(value(applyFinancialCases(clone(fixture.OXLC)).snapshot.timeseries.revenueQ[0]), 94000000);
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
  // Break-once in memory (absence): without the trading-currency check a EUR-traded packet would take USD cases.
  const anyCcy = moduleCopy('lib/financial-known-cases.js', s => replaceLine(s,
    "const usdListing = m => m.tradingCurrency === 'USD' && m.tradingCurrencyAssumed === false && m._ccyMissingCompletely !== true &&",
    'const usdListing = m => m.tradingCurrencyAssumed === false && m._ccyMissingCompletely !== true &&'));
  assert.throws(() => withheld(tradingEur, anyCcy.applyFinancialCases), assert.AssertionError); breaks++;
  // Break-once in memory (absence): without the coverage gate the uncovered ambiguous packet takes its case.
  const ungated = moduleCopy('lib/financial-known-cases.js', s => replaceLine(s,
    '    if (!env || ambiguousUncovered || env.currency !== c.currency || matches.length !== 1 || !unitOk) {',
    '    if (!env || env.currency !== c.currency || matches.length !== 1 || !unitOk) {'));
  assert.throws(() => uncovered(ungated.applyFinancialCases), assert.AssertionError); breaks++;
  // Break-once in memory (absence): without the country check a USD listing of a foreign company would take USD cases.
  const anyCountry = moduleCopy('lib/financial-known-cases.js', s => replaceLine(s, "  m.country === 'United States' &&", '  true &&'));
  assert.throws(() => withheld(m => { m.country = 'United Kingdom'; }, anyCountry.applyFinancialCases), assert.AssertionError); breaks++;
  // Absence (review round 2): the coverage gate is per field. Covered revenueQ does not open an uncovered
  // flagged grossProfitQ case on the same ambiguous packet.
  const gpPacket = clone(fixture.KBDC);
  gpPacket.timeseries.grossProfitQ = [{ value: 1e6 }, ...gpPacket.timeseries.grossProfitQ.slice(1)];
  gpPacket.timeseries.grossProfitQEnds = gpPacket.timeseries.revenueQEnds.slice();
  const gpTable = clone(table);
  // A withheld false value needs no coverage, so the grossProfitQ series stays uncovered while revenueQ is covered.
  gpTable.cases.push({ ...clone(kbdc[0]), caseId: 'test-kbdc-gp', field: 'grossProfitQ', period: gpPacket.timeseries.revenueQEnds[0],
    expectedBadValue: 1e6, replacementValue: null });
  const gpWithheld = fn => {
    const row = fn(clone(gpPacket), { table: gpTable }).snapshot.timeseries.grossProfitQ[0];
    assert.equal(value(row), null); assert.equal(row.financialMissing?.reasonCode, 'context-changed');
  };
  gpWithheld(applyFinancialCases);
  const fieldBlind = moduleCopy('lib/financial-known-cases.js', s => replaceLine(s,
    '    const ambiguousUncovered = snapshot.meta?.ccyAmbiguous && !config.coverage.some(v => listed(v, ticker) && v.field === c.field);',
    '    const ambiguousUncovered = snapshot.meta?.ccyAmbiguous && !config.coverage.some(v => listed(v, ticker));'));
  assert.throws(() => gpWithheld(fieldBlind.applyFinancialCases), assert.AssertionError); breaks++;
});

// Confirmed cells (expectedBadValue === replacementValue) replace the removed singleFalseValue opt-out (deleted
// together with its tests): OXLC now has coverage through its last verified quarter, so a new false vendor zero is
// withheld instead of showing -100 % growth.
test('confirmed cells: OXLC today unchanged; a next vendor quarter (also 0) is withheld; a moved confirmed cell is withheld', () => {
  const axes = require('../src/scoring/axes.js');
  const oxlc = table.cases.filter(x => x.ticker === 'OXLC');
  assert.deepEqual(oxlc.map(c => [c.period, c.expectedBadValue, c.replacementValue]), [['2026-03-31', 0, 94000000], ['2024-09-30', 0, null],
    ['2025-06-30', 124000000, 124000000], ['2025-03-31', 121161000, 121161000]]);
  assert.ok(!table.cases.some(c => Object.hasOwn(c, 'singleFalseValue')), 'The single-cell flag is gone');
  const rounded = oxlc.find(c => c.period === '2026-03-31');
  assert.ok(/gerundet/.test(rounded.reason) && /issuer-rounded/.test(rounded.sources[0].unit), 'Rounding is recorded in the entry');
  // Entry guard: a vendor value copied under a "korrigiert" reason, or a "bestätigt" reason on a changed value, is rejected.
  const copied = clone(table); copied.cases.find(c => c.caseId === 'carg-2025-12-31-revenueQ').replacementValue = 209093000;
  const mislabelled = clone(table); mislabelled.cases.find(c => c.caseId === 'carg-2026-06-30-revenueQ').replacementValue = 250971001;
  const entryGuard = lib => {
    assert.throws(() => lib.validateTable(copied), /Invalid confirmed cell .*CARG\|revenueQ\|2025-12-31/);
    assert.throws(() => lib.validateTable(mislabelled), /Invalid confirmed cell .*CARG\|revenueQ\|2026-06-30/);
  };
  entryGuard({ validateTable });
  const unguarded = moduleCopy('lib/financial-known-cases.js', s => replaceLine(s,
    "    if ((c.expectedBadValue === c.replacementValue) !== /bestätigt:/.test(c.reason)) throw new Error('Invalid confirmed cell (value and reason disagree): ' + key);", ''));
  assert.throws(() => entryGuard(unguarded), assert.AssertionError); breaks++;
  assert.deepEqual(table.coverage.filter(v => v.ticker === 'OXLC'), [{ ticker: 'OXLC', field: 'revenueQ', coversThrough: '2026-03-31' }]);
  const today = fn => {
    const input = clone(fixture.OXLC), r = fn(input);
    assert.deepEqual(norm(r.snapshot, 'revenueQ'), [94000000, 124000000, 121161000, null]);
    assert.ok(!r.events.some(e => e.status === 'stale'));
    // Confirmed rows stay byte-identical to the vendor rows: no marker, no visible reason.
    for (const i of [1, 2]) assert.equal(serial(r.snapshot.timeseries.revenueQ[i]), serial(input.timeseries.revenueQ[i]));
    assert.ok(!r.events.some(e => [1, 2].includes(e.index)), 'No event for a confirmed cell');
    assert.equal(axes.revGrowthLevel(r.snapshot).toFixed(1), '-22.4', '94.0 vs 121.161 million');
  };
  today(applyFinancialCases);
  // A next vendor quarter is not verified: withheld (period-after-coverage), whether it is a false 0 or a plausible value.
  const withheldNext = (fn, v, config) => {
    const r = fn(nextQuarter(clone(fixture.OXLC), v), config ? { table: config } : undefined), row = r.snapshot.timeseries.revenueQ[0];
    assert.equal(value(row), null);
    assert.equal(row.financialMissing?.reasonCode, 'period-after-coverage');
    assert.ok(r.events.some(e => e.status === 'stale' && e.period === '2026-09-30'));
    assert.notEqual(axes.revGrowthLevel(r.snapshot), -100, 'never the old -100 %');
  };
  withheldNext(applyFinancialCases, 0); withheldNext(applyFinancialCases, 95e6);
  // Absence: a vendor change of a confirmed cell, or the known false zero on a shifted end date, is withheld.
  const moved = clone(fixture.OXLC); moved.timeseries.revenueQ[1].value = 125e6;
  const m = applyFinancialCases(moved).snapshot.timeseries.revenueQ[1];
  assert.equal(value(m), null); assert.equal(m.financialMissing.reasonCode, 'vendor-value-changed');
  const shifted = clone(fixture.OXLC); shifted.timeseries.revenueQEnds[0] = '2026-03-30';
  const sh = applyFinancialCases(shifted).snapshot.timeseries.revenueQ[0];
  assert.equal(value(sh), null); assert.equal(sh.financialMissing.reasonCode, 'period-not-verified');
  // A confirmed cell gives the table authority over its series, so coverage is required.
  const noCoverage = clone(table); noCoverage.coverage = noCoverage.coverage.filter(v => v.ticker !== 'OXLC');
  assert.throws(() => validateTable(noCoverage), /Missing financial coverage: OXLC\|revenueQ/);
  const confirmedOnly = clone(noCoverage);
  confirmedOnly.cases = confirmedOnly.cases.filter(c => c.ticker !== 'OXLC' || c.expectedBadValue === c.replacementValue);
  const needsCoverage = lib => assert.throws(() => lib.validateTable(confirmedOnly), /Missing financial coverage: OXLC\|revenueQ/);
  needsCoverage({ validateTable });
  const exempt = moduleCopy('lib/financial-known-cases.js', s => replaceLine(s,
    '    if (c.replacementValue !== null) for (const t of listings(c)) basisWrong.add(`${t}|${c.field}`);',
    '    if (c.replacementValue !== null && c.expectedBadValue !== c.replacementValue) for (const t of listings(c)) basisWrong.add(`${t}|${c.field}`);'));
  assert.throws(() => needsCoverage(exempt), assert.AssertionError); breaks++;
  // Break-once in memory (presence): if confirmed periods do not count as verified, today's true quarters are withheld.
  const unconfirmed = moduleCopy('lib/financial-known-cases.js', s => replaceLine(s,
    '    const verified = new Set(config.cases.filter(c => listed(c, ticker) && c.field === field).map(c => c.period));',
    '    const verified = new Set(config.cases.filter(c => listed(c, ticker) && c.field === field && c.expectedBadValue !== c.replacementValue).map(c => c.period));'));
  assert.throws(() => today(unconfirmed.applyFinancialCases), assert.AssertionError); breaks++;
  // Break-once in memory (presence): without the unchanged-cell exit a confirmed row gains a correction marker.
  const marked = moduleCopy('lib/financial-known-cases.js', s => replaceLine(s, '    if (old === replacement) continue;', ''));
  assert.throws(() => today(marked.applyFinancialCases), assert.AssertionError); breaks++;
  // Break-once on test data (absence): the former shape (OXLC without coverage) lets the next vendor zero through.
  const oldShape = moduleCopy('lib/financial-known-cases.js', s => replaceLine(s,
    "  for (const key of basisWrong) if (!covered.has(key)) throw new Error('Missing financial coverage: ' + key);", ''));
  assert.throws(() => withheldNext(oldShape.applyFinancialCases, 0, noCoverage), assert.AssertionError); breaks++;
});

// SEC double check 01.10. (CARG, PLUS, DCO, INFQ) and SLC Agricola: both series covered; every stored quarter is an
// issuer value (replaced or confirmed). The board's growth pair stays formable with issuer values.
test('covered company series: growth pair formable with issuer values; next quarter withheld per field; VCTR false value withheld', () => {
  const axes = require('../src/scoring/axes.js');
  const pairs = { CARG: [250971, 221998], PLUS: [649113, 642775], DCO: [224492, 200803], INFQ: [13538, 5277], 'SLCE3.SA': [2175612, 1862135] };
  const growth = fn => {
    for (const [ticker, [now, ago]] of Object.entries(pairs)) {
      const r = fn(clone(fixture[ticker]));
      assert.ok(!r.events.some(e => e.status === 'stale'), ticker + ' no stale');
      assert.ok(Math.abs(axes.revQuartalsYoY(r.snapshot) - (now / ago - 1)) < 1e-12, ticker + ' quarterly leg from issuer values');
      for (const field of ['revenueQ', 'grossProfitQ']) assert.ok(norm(r.snapshot, field).every(Number.isFinite), ticker + ' ' + field + ' complete');
    }
  };
  growth(applyFinancialCases);
  // A next vendor quarter of gross profit is withheld as well (coverage is per field), revenue untouched.
  for (const ticker of Object.keys(pairs)) {
    const s = clone(fixture[ticker]), ts = s.timeseries;
    ts.grossProfitQ = [{ value: 1e6 }, ...ts.grossProfitQ].slice(0, ts.grossProfitQ.length);
    ts.grossProfitQEnds = ['2026-09-30', ...ts.grossProfitQEnds].slice(0, ts.grossProfitQEnds.length);
    const r = applyFinancialCases(s);
    assert.equal(r.snapshot.timeseries.grossProfitQ[0].financialMissing?.reasonCode, 'period-after-coverage', ticker);
    assert.equal(r.events.filter(e => e.status === 'stale').length, 1, ticker);
  }
  // VCTR (impossible Q4 2025 gross profit, no gross-profit line filed) and Celesc (2Q25 gross profit matches no filed line):
  // the one false value is withheld, never estimated; the other quarters and revenue stay as stored.
  for (const [ticker, period] of [['VCTR', '2025-12-31'], ['CLSC3.SA', '2025-06-30']]) {
    const v = applyFinancialCases(clone(fixture[ticker])).snapshot, vi = fixture[ticker].timeseries.grossProfitQEnds.indexOf(period);
    assert.deepEqual(norm(v, 'grossProfitQ'), norm(fixture[ticker], 'grossProfitQ').map((x, i) => i === vi ? null : x), ticker);
    assert.equal(serial(v.timeseries.revenueQ), serial(fixture[ticker].timeseries.revenueQ));
    assert.ok(!table.coverage.some(x => x.ticker === ticker), 'A withheld value alone needs no coverage');
  }
  // Break-once on test data: without the verified SLC year-ago quarter the partner is withheld and the pair is gone.
  const broken = clone(table); broken.cases = broken.cases.filter(c => c.caseId !== 'slce3.sa-2025-06-30-revenueQ');
  assert.throws(() => growth(s => applyFinancialCases(s, { table: broken })), assert.AssertionError); breaks++;
});

// 01.10. (annual cells): every reader of the annual series treats a withheld year as missing, through the real code.
test('annual readers: INFQ badge, gross-profit growth and annual fallback empty; CARG without 2022; OTF back on the board', () => {
  const axes = require('../src/scoring/axes.js'), { overviewMetric } = require('../src/scoring/overview.js');
  const score = require('../src/scoring/score.js'), formulas = require('../src/scoring/formulas/index.js');
  const noAnnual = clone(table); noAnnual.cases = noAnnual.cases.filter(c => c.periodType === '3M');
  const infq = cfg => applyFinancialCases(clone(fixture.INFQ), cfg && { table: cfg }).snapshot;
  const readersInfq = s => {
    assert.equal(overviewMetric(s, {}).value, null, 'badge empty');
    assert.equal(axes.gpGrowth(s), null); assert.equal(axes.revAnnualLegYoY(s), null); assert.equal(axes.dilution(s), null);
    // The next vendor quarter is withheld (period-after-coverage): growth is empty, not the FY2024/FY2023 pair (+163.3 %).
    assert.equal(axes.revGrowthLevel(applyFinancialCases(nextQuarter(clone(fixture.INFQ))).snapshot), null);
    assert.ok(financialReasons(s).some(r => r.startsWith('Jahreszahlen fehlen:')));
  };
  readersInfq(infq());
  assert.equal(axes.revGrowthLevel(applyFinancialCases(nextQuarter(clone(fixture.INFQ)), { table: noAnnual }).snapshot).toFixed(2), '163.34');
  assert.throws(() => readersInfq(infq(noAnnual)), assert.AssertionError); breaks++;
  // CARG: 2025/2024 badge and growth unchanged; the margin path starts in 2023 (same basis), not in 2022 with CarOffer.
  const carg = applyFinancialCases(clone(fixture.CARG)).snapshot, cargOld = applyFinancialCases(clone(fixture.CARG), { table: noAnnual }).snapshot;
  assert.equal(overviewMetric(carg, {}).value, overviewMetric(cargOld, {}).value);
  assert.equal(axes.revAnnualLegYoY(carg), axes.revAnnualLegYoY(cargOld));
  assert.equal(axes.gpGrowth(carg).toFixed(6), (841513 / 727697 - 1 + 841513 / 906980 - 636611 / 698421).toFixed(6));
  assert.equal(axes.gpGrowth(cargOld).toFixed(6), (841513 / 727697 - 1 + 841513 / 906980 - 657553 / 1655035).toFixed(6));
  // OTF: scored again with the verified quarters; the revenue badge is empty and the reason is visible.
  const otf = applyFinancialCases(clone(fixture.OTF)).snapshot;
  assert.equal(otf.meta.financialDataIssue, undefined);
  const scored = score.scoreUniverse([otf], formulas)[0];
  assert.notEqual(scored.reason, 'data-suspect'); assert.equal(scored.formulaId, 'financials');
  assert.equal(overviewMetric(otf, { gpClass: 'degenerate' }).value, null);
  assert.equal(axes.revAnnualLegYoY(otf), null);
  assert.equal((axes.revQuartalsYoY(otf) * 100).toFixed(2), (338032 / 319467 * 100 - 100).toFixed(2));
  assert.ok(financialReasons(otf).some(r => r.startsWith('Jahresumsatz fehlt:')));
});

// Review round 2: KBDC carries a vendor ANNUAL revenue series that contradicts its SEC filings. It stays held off
// the boards with a visible reason: withholding its annual cells would put it back with a false profit streak
// ("0 Jahre, letzter Verlust 2025" from the SEC bulk operating income, which is the negated net expenses).
// OTF was held the same way until 01.10.; its four false annual cells are now withheld instead (test above).
// 01.10.: HOS (packet of a former company under a reused ticker), TYG (statements end 2017), OLPX (delisted, all
// gross profits 0) are held the same way. 02.10.: HLX (retired ticker, price and market cap frozen since 01.09.).
// 02.10. review round 2: 2670.HK (pre-split price), ENGI3.SA (one class price x all classes), Z98.DE (JBS wrong count on
// a non-USD leg): wrong market caps the share-count table cannot carry; held until a price- or class-aware fix exists.
// E4 (02.10.): 2637.TW (Wisdom Marine reports in USD; the vendor packet is in TWD under a USD label).
test('holds KBDC, HOS, TYG, OLPX, HLX, 2670.HK, ENGI3.SA, Z98.DE, 2637.TW: off the boards with the reason; cases still apply; drift keeps the hold and warns', () => {
  const score = require('../src/scoring/score.js'), formulas = require('../src/scoring/formulas/index.js');
  for (const ticker of ['KBDC', 'HOS', 'TYG', 'OLPX', 'HLX', '2670.HK', 'ENGI3.SA', 'Z98.DE', '2637.TW']) {
    const q = table.quarantines.find(x => x.ticker === ticker);
    const held = (fn, input = clone(fixture[ticker])) => {
      const r = fn(input);
      assert.equal(r.snapshot.meta.financialDataIssue?.caseId, q.caseId, ticker + ' held');
      assert.equal(score.isDataSuspect(r.snapshot, [], 'route'), true);
      const scored = score.scoreUniverse([r.snapshot], formulas)[0];
      assert.equal(scored.score, null); assert.equal(scored.reason, 'data-suspect'); assert.equal(scored.reasonText, q.reason);
      assert.ok(financialReasons(r.snapshot).includes(q.reason));
      return r;
    };
    const exact = held(applyFinancialCases);
    assert.ok(!exact.events.some(e => e.status === 'stale'), ticker + ': exact packet holds without warning');
    // Cases and hold together: every verified quarter is still the issuer value.
    for (const c of table.cases.filter(x => x.ticker === ticker)) {
      const i = exact.snapshot.timeseries.revenueQEnds.indexOf(c.period);
      assert.equal(value(exact.snapshot.timeseries.revenueQ[i]), c.replacementValue);
    }
    // A drifted anchor never releases the hold; it warns until a human re-verifies.
    for (const anchor of q.fingerprint) {
      const other = clone(fixture[ticker]); const parent = anchor.path.slice(0, -1).reduce((x, k) => x[k], other);
      const key = anchor.path.at(-1);
      parent[key] = parent[key] === 0 ? 1 : parent[key] * 1.001; // a zero anchor (OLPX gross profit) drifts to 1
      const r = held(applyFinancialCases, other);
      assert.ok(r.events.some(e => e.status === 'stale' && e.reasonCode === 'quarantine-fingerprint-changed' && e.caseId === q.caseId));
    }
    // A new fiscal year in front of the vendor series is still the same packet: hold without warning.
    const rollover = clone(fixture[ticker]);
    for (const f of ['annualRev', 'annualNetIncome']) {
      rollover.annual[f].unshift({ value: null });
      if (Array.isArray(rollover.annual[f + 'Ends'])) rollover.annual[f + 'Ends'].unshift(null);
    }
    assert.ok(!held(applyFinancialCases, rollover).events.some(e => e.status === 'stale'));
    // Absence: the same packet under another ticker is not held.
    const unlisted = clone(fixture[ticker]); unlisted.meta.ticker = 'UNLISTED';
    assert.equal(applyFinancialCases(unlisted).snapshot.meta.financialDataIssue, undefined);
    // Break-once on test data: a table without this hold lets the row score again.
    const noHold = clone(table); noHold.quarantines = noHold.quarantines.filter(x => x.ticker !== ticker);
    assert.throws(() => held(s => applyFinancialCases(s, { table: noHold })), assert.AssertionError); breaks++;
  }
});

// E4 (02.10.): a replacement must trace to its own sources: equal to one numeric source value, the difference of
// two (year minus nine months), or within the rounding of an issuer-rounded source. Cases without any numeric
// source value are exempt (legacy). validateTable runs at module load (a throw would stop every snapshot reader),
// so the rule is counted here against the real table: first every case that existed before E4, then all.
const e4Case = c => c.field === 'opIncQ' || ['HL', '002128.SZ'].includes(c.ticker);
const traceKind = c => {
  const vals = c.sources.map(s => s.value).filter(Number.isFinite), r = c.replacementValue;
  if (r === null) return 'null';
  if (!vals.length) return 'exempt';
  if (vals.includes(r)) return 'single';
  if (vals.some(a => vals.some(b => a - b === r))) return 'difference';
  return c.sources.some(s => /rounded/.test(s.unit || '') && Math.abs(r - s.value) <= 50000) ? 'rounded' : 'none';
};
const TRACE_LINE = "    if (!traceable(c)) throw new Error('Replacement matches no source value: ' + key);";
test('replacement values trace to their sources: the whole real table passes, a typo throws at validation', () => {
  const count = cases => cases.reduce((m, c) => { const k = traceKind(c); m[k] = (m[k] || 0) + 1; return m; }, {});
  // The 162 cases of revision 2026-10-01c: 16 derived quarters (BDC Q4 cells, ARCC, INFQ, PSEC) and one
  // issuer-rounded confirmation (OXLC 2025-03-31, "$121.2 million") pass; none fails.
  assert.deepEqual(count(table.cases.filter(c => !e4Case(c))), { single: 106, difference: 16, rounded: 1, exempt: 10, null: 29 });
  assert.deepEqual(count(table.cases.filter(c => c.field === 'opIncQ')), { single: 26, difference: 4 });
  assert.equal(count(table.cases).none, undefined);
  assert.equal(validateTable(clone(table)).cases.length, table.cases.length);
  // Presence: a typo in a single-source, a derived and an issuer-rounded case each rejects the whole table.
  const typo = (id, mutate) => { const x = clone(table); mutate(x.cases.find(c => c.caseId === id)); return x; };
  const bad = [typo('hive-2026-06-30-opIncQ', c => { c.replacementValue -= 1000; }),
    typo('hive-2026-03-31-opIncQ', c => { c.replacementValue -= 1000; }),
    typo('oxlc-2025-03-31-revenueQ', c => { c.replacementValue = c.expectedBadValue = 121100000; })];
  // Absence: within the issuer's rounding (121.15 vs "121.2 million") and an exempt legacy case (no source value) pass.
  const ok = [typo('oxlc-2025-03-31-revenueQ', c => { c.replacementValue = c.expectedBadValue = 121150000; }),
    typo('htgc-2026-06-30-revenueQ', c => { c.replacementValue += 1; })];
  const guard = lib => { for (const x of bad) assert.throws(() => lib.validateTable(x), /Replacement matches no source value/); for (const x of ok) lib.validateTable(x); };
  guard({ validateTable });
  // Break-once in memory (whole-line anchor): without the rule every typo validates silently.
  const unguarded = moduleCopy('lib/financial-known-cases.js', s => replaceLine(s, TRACE_LINE, ''));
  assert.throws(() => guard(unguarded), assert.AssertionError); breaks++;
});

// E4 Part A (02.10.): quarterly operating income (opIncQ) in the hand table, same semantics as revenue and gross
// profit: exact vendor value per period, coverage through the last verified quarter, withheld on drift.
const OPINC = ['HIVE', 'SLCE3.SA', 'INFQ', 'CARG', 'PLUS', 'DCO'];
const ALLOWED_LINE = "const allowed = new Set(['revenueQ', 'grossProfitQ', 'opIncQ']);";
test('opIncQ: six companies x five covered quarters, none unverified; readers on the fixed day; drift withheld', () => {
  const axes = require('../src/scoring/axes.js'), { profitTierOf } = require('../src/scoring/profit-tier.js');
  const { newestQtrSuspect } = require('../src/scoring/lamps.js');
  const score = require('../src/scoring/score.js'), formulas = require('../src/scoring/formulas/index.js');
  const cal = require('../board-history/2026-10-01/calibration.json');
  const bounds = cal.winsorBounds.opMargin;
  const op = table.cases.filter(c => c.field === 'opIncQ');
  assert.deepEqual(OPINC.map(t => op.filter(c => c.ticker === t).length), [5, 5, 5, 5, 5, 5]);
  assert.equal(op.length, 30);
  assert.deepEqual(table.coverage.filter(v => v.field === 'opIncQ').map(v => v.ticker + '|' + v.coversThrough).sort(),
    OPINC.map(t => t + '|2026-06-30').sort());
  const noOp = clone(table); noOp.cases = noOp.cases.filter(c => c.field !== 'opIncQ'); noOp.coverage = noOp.coverage.filter(v => v.field !== 'opIncQ');
  const readers = s => ({ trajectory: axes.marginTrajectory(s, bounds), tier: profitTierOf(s), lamp: newestQtrSuspect(s) });
  // Raw marginTrajectory (newest minus oldest present margin) before -> after; the other three companies are
  // corrected only in middle cells, so all three readers stay unchanged until November.
  const moved = { HIVE: [-1.806246, -2.568238], 'SLCE3.SA': [0, 0.067951], INFQ: [-1.357418, -1.377674] };
  for (const t of OPINC) {
    const r = applyFinancialCases(clone(fixture[t])), fx = fixture[t].meta.fxRateApplied;
    assert.ok(!r.events.some(e => e.field === 'opIncQ' && e.status === 'stale'), t + ' no opIncQ withheld');
    assert.ok(!r.events.some(e => e.reasonCode === 'period-not-verified'), t + ' zero period-not-verified');
    assert.deepEqual(norm(r.snapshot, 'opIncQ'), r.snapshot.timeseries.opIncQEnds.map(p =>
      op.find(c => c.ticker === t && c.period === p).replacementValue * fx), t + ' every quarter is an issuer value');
    const before = readers(applyFinancialCases(clone(fixture[t]), { table: noOp }).snapshot), after = readers(r.snapshot);
    if (moved[t]) assert.deepEqual([before.trajectory, after.trajectory].map(x => +x.toFixed(6)), moved[t], t);
    else assert.deepEqual(after, before, t + ' readers unchanged');
    assert.equal(after.tier, before.tier); assert.equal(after.lamp, before.lamp);
  }
  // CARG, PLUS, DCO: the scored row is byte-identical on the fixed day (stored calibration of 01.10.).
  for (const t of ['CARG', 'PLUS', 'DCO']) {
    const row = cfg => score.scoreUniverse([applyFinancialCases(clone(fixture[t]), cfg && { table: cfg }).snapshot], formulas, { refCalibration: cal })[0];
    assert.equal(serial(row()), serial(row(noOp)), t + ' scored row byte-identical');
  }
  // A new vendor quarter is withheld until it is verified (empty trajectory, never the vendor value or 0).
  const next = clone(fixture.HIVE), ts = next.timeseries;
  ts.opIncQ = [{ value: -1e6 }, ...ts.opIncQ].slice(0, 5); ts.opIncQEnds = ['2026-09-30', ...ts.opIncQEnds].slice(0, 5);
  const nq = applyFinancialCases(next);
  assert.equal(nq.snapshot.timeseries.opIncQ[0].financialMissing?.reasonCode, 'period-after-coverage');
  assert.equal(nq.events.filter(e => e.status === 'stale').length, 1);
  assert.equal(axes.marginTrajectory(nq.snapshot, bounds), null);
  // A changed vendor value and a changed currency are withheld (vendor-value-changed, context-changed).
  const restated = clone(fixture.HIVE); restated.timeseries.opIncQ[2].value += 1;
  assert.equal(applyFinancialCases(restated).snapshot.timeseries.opIncQ[2].financialMissing?.reasonCode, 'vendor-value-changed');
  const eur = clone(fixture['SLCE3.SA']); eur.meta.reportingCurrencyOriginal = 'EUR';
  assert.ok(applyFinancialCases(eur).snapshot.timeseries.opIncQ.every(row => row.financialMissing?.reasonCode === 'context-changed'));
  // Absence: the identical packet under another ticker stays byte for byte.
  const other = clone(fixture.HIVE); other.meta.ticker = 'UNLISTED';
  assert.equal(applyFinancialCases(other).snapshot, other);
  // Break-once in memory (whole-line anchor): without opIncQ in the field list the table is rejected at load.
  const guard = lib => assert.equal(lib.validateTable(clone(table)).cases.length, table.cases.length);
  guard({ validateTable });
  assert.throws(() => guard(moduleCopy('lib/financial-known-cases.js', s => replaceLine(s, ALLOWED_LINE,
    "const allowed = new Set(['revenueQ', 'grossProfitQ']);"))), /Invalid or duplicate financial case: HIVE\|opIncQ/); breaks++;
});

// E4 Part B (02.10.): Hecla recast 2023-2025 after the Casa Berardi sale (8-K of 2026-08-28). Only the annual gross
// profit is withheld (the shown +213.9 % badge is +178.3 % recast); annual revenue stays (growth error 0.24 pp), so the
// revenue-based axes and the asset-growth penalty keep their values.
test('HL: annual gross profit withheld (badge and gross-profit growth empty with reason), revenue axes unchanged, HL.SW alike', () => {
  const axes = require('../src/scoring/axes.js'), { overviewMetric } = require('../src/scoring/overview.js');
  const noHl = clone(table); noHl.cases = noHl.cases.filter(c => c.ticker !== 'HL');
  const r = applyFinancialCases(clone(fixture.HL)), hl = r.snapshot, old = applyFinancialCases(clone(fixture.HL), { table: noHl }).snapshot;
  assert.deepEqual(norm(old, 'annualGP'), [622203000, 198210000, 112949000, 116156000]);
  assert.deepEqual(norm(hl, 'annualGP'), [null, null, null, null]);
  assert.deepEqual([0, 1, 2].map(i => hl.annual.annualGP[i].financialCorrection.caseId), ['hl-2025-12-31-annualGP', 'hl-2024-12-31-annualGP', 'hl-2023-12-31-annualGP']);
  assert.equal(hl.annual.annualGP[3].financialMissing.reasonCode, 'annual-older-than-withheld', 'FY2022 by the no-gap rule');
  assert.ok(!r.events.some(e => e.status === 'stale'));
  // Absence: revenue, operating income and every quarter stay byte for byte.
  for (const f of ['annualRev', 'annualOpInc', 'annualNetIncome']) assert.equal(serial(hl.annual[f]), serial(fixture.HL.annual[f]), f);
  assert.equal(serial(hl.timeseries), serial(fixture.HL.timeseries));
  // Readers: badge and gross-profit growth empty with the reason; acceleration, dilution and capital efficiency unchanged.
  assert.equal(overviewMetric(old, {}).value.toFixed(3), '2.139');
  assert.equal(overviewMetric(hl, {}).value, null);
  assert.notEqual(axes.gpGrowth(old), null); assert.equal(axes.gpGrowth(hl), null);
  for (const f of ['revGrowthLevel', 'revAcceleration', 'dilution', 'capitalEfficiency', 'marginTrajectory']) assert.equal(axes[f](hl), axes[f](old), f);
  assert.ok(financialReasons(hl).some(t => t.startsWith('Bruttogewinn-Jahreswerte fehlen:')));
  // Drift: a new year in front (or a restated value) withholds the whole series and warns; never the old values.
  const grown = clone(fixture.HL); grown.annual.annualGP.unshift({ value: 700e6 });
  const g = applyFinancialCases(grown);
  assert.ok(norm(g.snapshot, 'annualGP').every(x => x === null));
  assert.ok(g.events.some(e => e.status === 'stale' && e.reasonCode === 'annual-value-changed'));
  // Absence: the same packet under another ticker is untouched; HL.SW (identical annual packet) is withheld alike.
  const other = clone(fixture.HL); other.meta.ticker = 'UNLISTED'; assert.equal(applyFinancialCases(other).snapshot, other);
  // Break-once on test data: without the three cases the badge shows +213.9 % again.
  const guard = cfg => assert.equal(overviewMetric(applyFinancialCases(clone(fixture.HL), cfg && { table: cfg }).snapshot, {}).value, null);
  assert.throws(() => guard(noHl), assert.AssertionError); guard(); breaks++;
});

// E4 Part C (02.10.): the Wisdom Marine hold is fingerprinted on the EXACT stored annual floats and is position-free:
// on the fixed day it holds without a warning, also when a new quarter arrives; a rounded fingerprint would warn.
test('2637.TW hold: exact annual floats, no fingerprint warning on the fixed day or with a new quarter; rounded anchors would warn', () => {
  const q = table.quarantines.find(x => x.ticker === '2637.TW');
  assert.deepEqual(q.fingerprint.map(a => [a.path.join('.'), a.expected]),
    [['annual.annualRev.0.value', 16948954566.336], ['annual.annualNetIncome.0.value', 3948354422.1056]]);
  const warned = (r) => r.events.some(e => e.reasonCode === 'quarantine-fingerprint-changed');
  const held = fn => {
    const r = fn(clone(fixture['2637.TW']));
    assert.equal(r.snapshot.meta.financialDataIssue?.caseId, q.caseId); assert.ok(!warned(r));
    const next = clone(fixture['2637.TW']), ts = next.timeseries;
    for (const f of ['revenueQ', 'grossProfitQ', 'opIncQ']) { ts[f] = [{ value: 1 }, ...ts[f]]; ts[f + 'Ends'] = ['2026-09-30', ...ts[f + 'Ends']]; }
    assert.ok(!warned(fn(next)), 'a new quarter is still the same packet');
  };
  held(applyFinancialCases);
  // Break-once on test data: the plan's rounded values (16,948,954,566) never match exactly and warn from the first run.
  const rounded = clone(table); rounded.quarantines.find(x => x.ticker === '2637.TW').fingerprint[0].expected = 16948954566;
  assert.throws(() => held(s => applyFinancialCases(s, { table: rounded })), assert.AssertionError); breaks++;
});

for(const [file,before] of hashes) assert.equal(sha(path.join(__dirname,'..',file)),before,'Live artifact unchanged: '+file);
console.log(`financial-known-cases: ${passed} passed; ${breaks} break-once canaries fired; live hashes unchanged`);
